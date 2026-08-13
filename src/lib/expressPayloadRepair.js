/**
 * Deterministic payload repair and validation for Express questionnaire submissions.
 * Does not invoke AI — runs synchronously in the browser before the submit path.
 */

const MAX_STRING_LENGTH = 20000;

const ARRAY_FIELDS = [
  "it_company_type",
  "service_offerings",
  "target_industries",
  "client_challenges",
  "client_outcomes",
];

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

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isUnsafeValue(v) {
  if (typeof v === "undefined") return true;
  if (typeof v === "symbol") return true;
  if (typeof v === "function") return true;
  if (typeof v === "object" && v !== null) {
    if (typeof File !== "undefined" && v instanceof File) return true;
    if (typeof Blob !== "undefined" && v instanceof Blob) return true;
    if (typeof Event !== "undefined" && v instanceof Event) return true;
    if (typeof Node !== "undefined" && v instanceof Node) return true;
  }
  return false;
}

function stripUnsafe(value, seen = new WeakSet()) {
  if (isUnsafeValue(value)) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return undefined; // circular
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((v) => stripUnsafe(v, seen)).filter((v) => v !== undefined);
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const cleaned = stripUnsafe(v, seen);
    if (cleaned !== undefined) out[k] = cleaned;
  }
  return out;
}

function truncateString(value, warnings, path) {
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    warnings.push(`${path} truncated from ${value.length} to ${MAX_STRING_LENGTH} characters`);
    return value.slice(0, MAX_STRING_LENGTH);
  }
  return value;
}

function normalizeArrayField(value) {
  if (Array.isArray(value)) {
    return value
      .filter((v) => typeof v === "string" && v.trim())
      .map((v) => v.trim());
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function normalizeScalarField(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && value.length > 0) return value.filter(Boolean).join(", ");
  return "";
}

/**
 * Repair an Express submission payload deterministically.
 * @param {*} payload - The payload to repair (may be malformed)
 * @param {Object} context - Trusted context: { businessName, sessionId, submitAttemptId }
 * @returns {{ payload: object, changedPaths: Array, warnings: Array, repaired: boolean }}
 */
export function repairExpressSubmissionPayload(payload, context = {}) {
  const changedPaths = [];
  const warnings = [];

  const track = (path, before, after, reason) => {
    changedPaths.push({ path, before: String(before ?? "null"), after: String(after ?? "null"), reason });
  };

  // 1. Ensure payload is a plain object
  let working = payload;
  if (!isPlainObject(working)) {
    if (typeof working === "string") {
      try {
        working = JSON.parse(working);
      } catch {
        working = {};
        track(".", payload, "{}", "payload was a non-parseable string; reset to empty object");
      }
    } else {
      working = {};
      track(".", payload, "{}", "payload was not a plain object; reset to empty object");
    }
  }

  // 2. Strip unsafe values from the entire payload
  working = stripUnsafe(working) || {};

  // 3. Ensure metadata is a plain object
  if (!isPlainObject(working.metadata)) {
    track("metadata", typeof working.metadata, "{}", "metadata was not a plain object");
    working = { ...working, metadata: {} };
  }

  // 4. Ensure userdata is a plain object
  if (!isPlainObject(working.userdata)) {
    track("userdata", typeof working.userdata, "{}", "userdata was not a plain object");
    working = { ...working, userdata: {} };
  }

  const meta = { ...working.metadata };
  const ud = { ...working.userdata };

  // 5. Normalize service_type
  if (meta.service_type !== "express") {
    track("metadata.service_type", meta.service_type, "express", "normalized to express");
    meta.service_type = "express";
  }

  // 6. Fill business_name from trusted context only
  if (!meta.business_name && context.businessName) {
    track("metadata.business_name", meta.business_name, context.businessName, "filled from trusted context");
    meta.business_name = context.businessName;
  }

  // 7. businessDomain is optional — clean if present, don't require
  if (meta.businessDomain && typeof meta.businessDomain !== "string") {
    track("metadata.businessDomain", meta.businessDomain, "", "non-string domain cleared");
    meta.businessDomain = "";
  }

  // 8. submission_datetime
  const isValidIso = (v) => typeof v === "string" && v.length > 0 && !isNaN(new Date(v).getTime());
  if (!isValidIso(meta.submission_datetime)) {
    const now = new Date().toISOString();
    track("metadata.submission_datetime", meta.submission_datetime, now, "missing or invalid; filled with current timestamp");
    meta.submission_datetime = now;
  }

  // 9. questionnaire_session_id from context if missing
  if (!meta.questionnaire_session_id && context.sessionId) {
    track("metadata.questionnaire_session_id", meta.questionnaire_session_id, context.sessionId, "filled from context");
    meta.questionnaire_session_id = context.sessionId;
  }

  // 10. submit_attempt_id from context if missing
  if (!meta.submit_attempt_id && context.submitAttemptId) {
    track("metadata.submit_attempt_id", meta.submit_attempt_id, context.submitAttemptId, "filled from context");
    meta.submit_attempt_id = context.submitAttemptId;
  }

  // 11. Normalize array fields in userdata
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(ud[field])) {
      const fixed = normalizeArrayField(ud[field]);
      track(`userdata.${field}`, JSON.stringify(ud[field]), JSON.stringify(fixed), "normalized to array");
      ud[field] = fixed;
    }
  }

  // 12. Normalize scalar string fields in userdata
  for (const field of SCALAR_FIELDS) {
    if (typeof ud[field] !== "string") {
      const fixed = normalizeScalarField(ud[field]);
      track(`userdata.${field}`, JSON.stringify(ud[field]), JSON.stringify(fixed), "normalized to string");
      ud[field] = fixed;
    }
    // Truncate very long strings
    if (typeof ud[field] === "string" && ud[field].length > MAX_STRING_LENGTH) {
      ud[field] = truncateString(ud[field], warnings, `userdata.${field}`);
    }
  }

  // 13. geographic_area_meta must be a plain object
  if (ud.geographic_area_meta !== undefined && !isPlainObject(ud.geographic_area_meta)) {
    warnings.push("userdata.geographic_area_meta was not a plain object; reset to {}");
    track("userdata.geographic_area_meta", typeof ud.geographic_area_meta, "{}", "invalid; reset to empty object");
    ud.geographic_area_meta = {};
  }

  // 14. Preserve _rawFormData only for diagnostics; remove from final payload top level
  const rawFormData = working._rawFormData;
  const repairedPayload = {
    metadata: meta,
    userdata: ud,
  };

  // Keep _rawFormData only if it was present (for diagnostics)
  if (rawFormData !== undefined) {
    repairedPayload._rawFormData = rawFormData;
  }

  return {
    payload: repairedPayload,
    changedPaths,
    warnings,
    repaired: changedPaths.length > 0,
  };
}

/**
 * Validate an Express submission payload (post-repair).
 * @param {*} payload
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateExpressSubmissionPayload(payload) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(payload)) {
    errors.push("payload must be a plain object");
    return { ok: false, errors, warnings };
  }

  if (!isPlainObject(payload.metadata)) {
    errors.push("metadata must be a plain object");
  } else {
    if (!payload.metadata.business_name || typeof payload.metadata.business_name !== "string") {
      errors.push("metadata.business_name is required and must be a non-empty string");
    }
    if (payload.metadata.service_type !== "express") {
      errors.push(`metadata.service_type must be "express", got "${payload.metadata.service_type}"`);
    }
    if (!payload.metadata.questionnaire_session_id) {
      warnings.push("metadata.questionnaire_session_id is missing");
    }
    // businessDomain is intentionally optional
  }

  if (!isPlainObject(payload.userdata)) {
    errors.push("userdata must be a plain object");
  } else {
    for (const field of ARRAY_FIELDS) {
      if (!Array.isArray(payload.userdata[field])) {
        errors.push(`userdata.${field} must be an array`);
      }
    }
    for (const field of SCALAR_FIELDS) {
      if (typeof payload.userdata[field] !== "string") {
        errors.push(`userdata.${field} must be a string`);
      }
    }
    if (
      payload.userdata.geographic_area_meta !== undefined &&
      !isPlainObject(payload.userdata.geographic_area_meta)
    ) {
      errors.push("userdata.geographic_area_meta must be a plain object or undefined");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Safely serialize a value for draft/intake diagnostics.
 * Strips circular references and unsafe values before serializing.
 * @param {*} value
 * @returns {string}
 */
export function safeStringifyForDiagnostics(value) {
  try {
    const cleaned = stripUnsafe(value);
    return JSON.stringify(cleaned ?? null);
  } catch {
    try {
      return JSON.stringify({ _serializationError: true });
    } catch {
      return "{}";
    }
  }
}
