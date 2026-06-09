/**
 * Deterministic payload repair for Express questionnaire submissions.
 * Fixes structural/type issues before fallback/intake creation — without inventing answers.
 */

const MAX_STRING_LENGTH = 20000;

// Fields that must be arrays of clean strings
const ARRAY_FIELDS = [
  "it_company_type",
  "service_offerings",
  "target_industries",
  "client_challenges",
  "client_outcomes",
];

// Fields that must be trimmed strings
const SCALAR_FIELDS = [
  "it_company_type_other",
  "service_offerings_other",
  "differentiation",
  "geographic_areas",
  "pricing_packaging",
  "pricing_packaging_other",
  "company_goals",
  "company_goals_other",
  "brand_tone",
  "brand_tone_other",
  "target_industries_other",
  "client_size",
  "client_challenges_other",
  "client_outcomes_other",
  "ideal_client",
];

/**
 * Returns true if the value is a plain JSON-serializable object (not null, array, class instance).
 */
function isPlainObject(val) {
  if (val === null || typeof val !== "object" || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

/**
 * Returns true if the value is non-serializable (File, Blob, DOM node, Function, Symbol, circular).
 */
function isNonSerializable(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === "function") return true;
  if (typeof val === "symbol") return true;
  if (typeof val === "object") {
    if (typeof File !== "undefined" && val instanceof File) return true;
    if (typeof Blob !== "undefined" && val instanceof Blob) return true;
    if (typeof Event !== "undefined" && val instanceof Event) return true;
    if (typeof Node !== "undefined" && val instanceof Node) return true;
  }
  return false;
}

/**
 * Safely serializes a value for diagnostics, stripping non-serializable values.
 */
export function safeStringifyForDiagnostics(value) {
  if (value === null || value === undefined) return "null";
  try {
    return JSON.stringify(value, (_, v) => {
      if (v === undefined) return null;
      if (isNonSerializable(v)) return "[non-serializable]";
      if (typeof v === "bigint") return String(v);
      return v;
    });
  } catch {
    try {
      return JSON.stringify(String(value));
    } catch {
      return '"[unserializable]"';
    }
  }
}

/**
 * Attempts to parse a JSON string; returns the parsed value or the original if not a string / invalid.
 */
function tryParseJson(val) {
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return val;
  try {
    return JSON.parse(trimmed);
  } catch {
    return val;
  }
}

/**
 * Ensures a value is a plain object. Returns {} if not.
 */
function ensurePlainObject(val, fieldPath, changedPaths, warnings) {
  const parsed = tryParseJson(val);
  if (isPlainObject(parsed)) return parsed;
  if (parsed !== val) {
    changedPaths.push({ path: fieldPath, before: typeof val, after: "object", reason: "parsed embedded JSON string into object" });
    return isPlainObject(parsed) ? parsed : {};
  }
  if (val !== null && val !== undefined) {
    warnings.push(`${fieldPath} was not a plain object (got ${Array.isArray(val) ? "array" : typeof val}); replaced with {}`);
    changedPaths.push({ path: fieldPath, before: typeof val, after: "{}", reason: "invalid type replaced with empty object" });
  }
  return {};
}

/**
 * Normalizes a value to an array of clean, non-empty strings.
 * Scalar string → one-item array. Invalid → [].
 */
function normalizeArray(val, fieldPath, changedPaths) {
  if (Array.isArray(val)) {
    const cleaned = val
      .filter((item) => item !== null && item !== undefined && !isNonSerializable(item))
      .map((item) => (typeof item === "string" ? item.trim() : String(item)))
      .filter(Boolean);
    if (cleaned.length !== val.length || cleaned.some((v, i) => v !== val[i])) {
      changedPaths.push({ path: fieldPath, before: `array[${val.length}]`, after: `array[${cleaned.length}]`, reason: "cleaned array items" });
    }
    return cleaned;
  }
  if (typeof val === "string" && val.trim()) {
    changedPaths.push({ path: fieldPath, before: "string", after: "array[1]", reason: "converted scalar string to one-item array" });
    return [val.trim()];
  }
  if (val !== null && val !== undefined && val !== "") {
    changedPaths.push({ path: fieldPath, before: typeof val, after: "[]", reason: "invalid value replaced with empty array" });
  } else if (val === null || val === undefined) {
    changedPaths.push({ path: fieldPath, before: String(val), after: "[]", reason: "null/undefined replaced with empty array" });
  }
  return [];
}

/**
 * Normalizes a value to a trimmed string, truncating if over MAX_STRING_LENGTH.
 */
function normalizeScalar(val, fieldPath, changedPaths, warnings) {
  if (val === null || val === undefined) {
    return "";
  }
  if (isNonSerializable(val)) {
    changedPaths.push({ path: fieldPath, before: "[non-serializable]", after: '""', reason: "removed non-serializable value" });
    return "";
  }
  let str;
  if (Array.isArray(val)) {
    str = val.filter(Boolean).map(String).join(", ");
    changedPaths.push({ path: fieldPath, before: `array[${val.length}]`, after: "string", reason: "joined array into string" });
  } else {
    str = String(val);
  }
  str = str.trim();
  if (str.length > MAX_STRING_LENGTH) {
    warnings.push(`${fieldPath} exceeded ${MAX_STRING_LENGTH} characters and was truncated.`);
    changedPaths.push({ path: fieldPath, before: `string[${str.length}]`, after: `string[${MAX_STRING_LENGTH}]`, reason: "truncated overly long string" });
    str = str.slice(0, MAX_STRING_LENGTH);
  }
  return str;
}

/**
 * Strips undefined, non-serializable, and Symbol values from a plain object (shallow).
 */
function stripBadValues(obj, prefix, changedPaths) {
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) {
      changedPaths.push({ path: `${prefix}.${key}`, before: "undefined", after: "[removed]", reason: "removed undefined value" });
      continue;
    }
    if (isNonSerializable(val)) {
      changedPaths.push({ path: `${prefix}.${key}`, before: "[non-serializable]", after: "[removed]", reason: "removed non-serializable value" });
      continue;
    }
    out[key] = val;
  }
  return out;
}

/**
 * Validates whether a submission_datetime string is a valid ISO date.
 */
function isValidIsoDate(val) {
  if (typeof val !== "string" || !val.trim()) return false;
  const d = new Date(val);
  return !isNaN(d.getTime());
}

/**
 * Repairs a malformed Express submission payload deterministically.
 * Does not invent answers. Only fixes structure, types, and safe metadata.
 *
 * @param {*} payload - The raw payload to repair
 * @param {Object} context - Trusted context: { businessName, sessionId, submitAttemptId }
 * @returns {{ payload: Object, changedPaths: Array, warnings: Array, repaired: boolean }}
 */
export function repairExpressSubmissionPayload(payload, context = {}) {
  const changedPaths = [];
  const warnings = [];

  // Ensure payload is a plain object
  let working = tryParseJson(payload);
  if (!isPlainObject(working)) {
    changedPaths.push({ path: ".", before: typeof payload, after: "object", reason: "payload was not a plain object; initialized empty shell" });
    warnings.push("Payload was not a plain object. Initialized empty structure.");
    working = {};
  }

  // Strip bad top-level values
  working = stripBadValues(working, "root", changedPaths);

  // Ensure metadata is a plain object
  let metadata = ensurePlainObject(working.metadata, "metadata", changedPaths, warnings);
  metadata = stripBadValues(metadata, "metadata", changedPaths);

  // Ensure userdata is a plain object
  // Check if userdata was accidentally embedded as JSON string
  let userdata = ensurePlainObject(working.userdata, "userdata", changedPaths, warnings);
  userdata = stripBadValues(userdata, "userdata", changedPaths);

  // --- Metadata repairs ---

  // service_type must be "express"
  if (metadata.service_type !== "express") {
    changedPaths.push({ path: "metadata.service_type", before: metadata.service_type ?? null, after: "express", reason: "normalized to express" });
    metadata.service_type = "express";
  }

  // business_name: only fill from trusted context if missing
  if (!metadata.business_name && context.businessName) {
    changedPaths.push({ path: "metadata.business_name", before: metadata.business_name ?? null, after: "[from context]", reason: "filled from trusted context.businessName" });
    metadata.business_name = context.businessName;
  }

  // businessDomain: optional — clean if present, never required
  if (metadata.businessDomain !== undefined && metadata.businessDomain !== null) {
    const cleaned = typeof metadata.businessDomain === "string"
      ? metadata.businessDomain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").trim()
      : "";
    if (cleaned !== metadata.businessDomain) {
      changedPaths.push({ path: "metadata.businessDomain", before: metadata.businessDomain, after: cleaned || "[removed]", reason: "cleaned domain string" });
    }
    metadata.businessDomain = cleaned;
  }

  // submission_datetime: fill only if missing or invalid
  if (!isValidIsoDate(metadata.submission_datetime)) {
    const newTs = new Date().toISOString();
    changedPaths.push({ path: "metadata.submission_datetime", before: metadata.submission_datetime ?? null, after: newTs, reason: "missing or invalid datetime; filled with current ISO timestamp" });
    metadata.submission_datetime = newTs;
  }

  // questionnaire_session_id: fill from context only if missing
  if (!metadata.questionnaire_session_id && context.sessionId) {
    changedPaths.push({ path: "metadata.questionnaire_session_id", before: null, after: "[from context]", reason: "filled from context.sessionId" });
    metadata.questionnaire_session_id = context.sessionId;
  }

  // submit_attempt_id: fill from context only if missing
  if (!metadata.submit_attempt_id && context.submitAttemptId) {
    changedPaths.push({ path: "metadata.submit_attempt_id", before: null, after: "[from context]", reason: "filled from context.submitAttemptId" });
    metadata.submit_attempt_id = context.submitAttemptId;
  }

  // --- Userdata repairs ---

  // Array fields
  for (const field of ARRAY_FIELDS) {
    userdata[field] = normalizeArray(userdata[field], `userdata.${field}`, changedPaths);
  }

  // Scalar string fields
  for (const field of SCALAR_FIELDS) {
    userdata[field] = normalizeScalar(userdata[field], `userdata.${field}`, changedPaths, warnings);
  }

  // geographic_area_meta: must be a plain object
  const rawGeoMeta = userdata.geographic_area_meta;
  if (rawGeoMeta !== undefined && !isPlainObject(rawGeoMeta)) {
    warnings.push("userdata.geographic_area_meta was not a plain object; replaced with {}.");
    changedPaths.push({ path: "userdata.geographic_area_meta", before: typeof rawGeoMeta, after: "{}", reason: "invalid geographic_area_meta replaced with empty object" });
    userdata.geographic_area_meta = {};
  } else if (rawGeoMeta === undefined) {
    userdata.geographic_area_meta = {};
  }

  // Preserve _rawFormData for diagnostics only (do not include in final repaired payload)
  const _rawFormData = working._rawFormData;

  // Assemble repaired payload (exclude _rawFormData from the repaired output)
  const repairedPayload = { metadata, userdata };
  if (_rawFormData !== undefined) {
    repairedPayload._rawFormData = _rawFormData;
  }

  return {
    payload: repairedPayload,
    changedPaths,
    warnings,
    repaired: changedPaths.length > 0,
  };
}

/**
 * Validates a repaired Express submission payload.
 * Does not repair — only reports errors and warnings.
 *
 * @param {*} payload
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateExpressSubmissionPayload(payload) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(payload)) {
    errors.push("Payload is not a plain object.");
    return { ok: false, errors, warnings };
  }

  const { metadata, userdata } = payload;

  // metadata checks
  if (!isPlainObject(metadata)) {
    errors.push("metadata is missing or not a plain object.");
  } else {
    if (!metadata.business_name || typeof metadata.business_name !== "string" || !metadata.business_name.trim()) {
      errors.push("metadata.business_name is required and must be a non-empty string.");
    }
    if (metadata.service_type !== "express") {
      errors.push(`metadata.service_type must be "express" (got ${JSON.stringify(metadata.service_type)}).`);
    }
    if (!metadata.questionnaire_session_id) {
      warnings.push("metadata.questionnaire_session_id is missing.");
    }
    if (!isValidIsoDate(metadata.submission_datetime)) {
      errors.push("metadata.submission_datetime is missing or not a valid ISO date string.");
    }
  }

  // userdata checks
  if (!isPlainObject(userdata)) {
    errors.push("userdata is missing or not a plain object.");
  } else {
    for (const field of ARRAY_FIELDS) {
      if (!Array.isArray(userdata[field])) {
        errors.push(`userdata.${field} must be an array (got ${typeof userdata[field]}).`);
      }
    }
    for (const field of SCALAR_FIELDS) {
      if (typeof userdata[field] !== "string") {
        errors.push(`userdata.${field} must be a string (got ${typeof userdata[field]}).`);
      }
    }
    if (userdata.geographic_area_meta !== undefined && !isPlainObject(userdata.geographic_area_meta)) {
      errors.push("userdata.geographic_area_meta must be a plain object.");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}