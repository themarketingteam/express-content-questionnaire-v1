import { getInitialExpressFormData } from "@/lib/expressQuestionnairePayload";
import { safeLocalStorageGet, safeLocalStorageSet, safeJsonParse } from "@/lib/browserSafety";

/** @typedef {Record<string, *>} ExpressFormData */
/** @typedef {{ label: string, lat: number | null, lon: number | null, place_id: string | null, source: string }} GeographicAreaMeta */
/** @typedef {{ status?: string, message?: string, reason_codes?: string[], suggestions?: string[], answerHash?: string, validatedAt?: string }} ValidationStatus */
/** @typedef {{ version: number, savedAt: string, formData: ExpressFormData, validationStatus: Record<string, ValidationStatus>, touchedQuestions: Record<string, boolean>, expandedQuestions: Record<string, boolean>, questionnaireSessionId: string }} PersistedState */
/** @typedef {{ ok: boolean, state: PersistedState, migrated: boolean, repaired: boolean, discarded: boolean, error: Error | null, diagnostics: Record<string, *> }} ParseResult */

export const EXPRESS_PERSISTED_STATE_VERSION = 2;
export const EXPRESS_COOKIE_KEY = "msp_questionnaire_data_v2";

// v3 localStorage keys
export const EXPRESS_LS_KEY_GLOBAL = "msp_questionnaire_data_v3";
export const getExpressLsKeySession = (sessionId) => `msp_questionnaire_data_v3_session_${sessionId}`;

/**
 * Save state to localStorage (v3). Uses both a global key and a per-session key.
 */
export function saveStateToLocalStorage(state, sessionId) {
  const serialized = serializePersistedState(state);
  safeLocalStorageSet(EXPRESS_LS_KEY_GLOBAL, serialized);
  if (sessionId) {
    safeLocalStorageSet(getExpressLsKeySession(sessionId), serialized);
  }
}

/**
 * Load the newest valid v3 state from localStorage.
 * Compares per-session and global keys by savedAt timestamp, choosing the newest.
 * Falls back to null if nothing valid found.
 * Returns { state, source } where source is 'localStorage_session', 'localStorage_global', or null.
 */
export function loadStateFromLocalStorage(sessionId) {
  let sessionState = null;
  let globalState = null;

  if (sessionId) {
    const raw = safeLocalStorageGet(getExpressLsKeySession(sessionId));
    if (raw) {
      const parsed = safeJsonParse(raw);
      if (parsed && parsed.version && parsed.formData) {
        sessionState = parsed;
      }
    }
  }

  const rawGlobal = safeLocalStorageGet(EXPRESS_LS_KEY_GLOBAL);
  if (rawGlobal) {
    const parsed = safeJsonParse(rawGlobal);
    if (parsed && parsed.version && parsed.formData) {
      globalState = parsed;
    }
  }

  if (sessionState && globalState) {
    const sessionTime = new Date(sessionState.savedAt || 0).getTime() || 0;
    const globalTime = new Date(globalState.savedAt || 0).getTime() || 0;
    return sessionTime >= globalTime
      ? { state: sessionState, source: 'localStorage_session' }
      : { state: globalState, source: 'localStorage_global' };
  }

  if (sessionState) return { state: sessionState, source: 'localStorage_session' };
  if (globalState) return { state: globalState, source: 'localStorage_global' };

  return { state: null, source: null };
}

/**
 * Clear all localStorage persisted-state keys (session + global).
 */
export function clearStateFromLocalStorage(sessionId) {
  try { localStorage.removeItem(EXPRESS_LS_KEY_GLOBAL); } catch { /* ignore */ }
  if (sessionId) {
    try { localStorage.removeItem(getExpressLsKeySession(sessionId)); } catch { /* ignore */ }
  }
}

/**
 * Write a small marker cookie for legacy compatibility.
 * Only stores session id, savedAt, and version — no form data.
 */
export function writeStateMarkerCookie(sessionId, savedAt) {
  try {
    const marker = JSON.stringify({
      version: EXPRESS_PERSISTED_STATE_VERSION,
      savedAt: savedAt || new Date().toISOString(),
      questionnaireSessionId: sessionId || "",
      storage: "localStorage",
    });
    document.cookie = `${EXPRESS_COOKIE_KEY}=${encodeURIComponent(marker)}; expires=${new Date(Date.now() + 365 * 864e5).toUTCString()}; path=/; SameSite=Lax`;
  } catch { /* ignore */ }
}

/**
 * Get default expanded questions state
 * @returns {Record<string, boolean>}
 */
export function getDefaultExpandedQuestions() {
  return {
    "1": true,
    "2": false,
    "3": false,
    "4": false,
    "5": false,
    "6": false,
    "7": false,
    "8": false,
    "9": false,
    "10": false,
    "11": false,
    "12": false
  };
}

/**
 * Get default persisted state
 * @returns {PersistedState}
 */
export function getDefaultPersistedState() {
  return {
    version: EXPRESS_PERSISTED_STATE_VERSION,
    savedAt: "",
    formData: getInitialExpressFormData(),
    validationStatus: {},
    touchedQuestions: {},
    expandedQuestions: getDefaultExpandedQuestions(),
    questionnaireSessionId: ""
  };
}

/**
 * Check if value is a plain object
 * @param {*} value
 * @returns {boolean}
 */
export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalize string value
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */
export function normalizeLiveString(value, fallback = "") {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
}

export function normalizeStoredString(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim();
  }
  return fallback;
}

export function normalizeString(value, fallback = "") {
  return normalizeStoredString(value, fallback);
}

/**
 * Normalize string array value
 * @param {*} value
 * @returns {string[]}
 */
export function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .filter(v => typeof v === "string" && v.trim().length > 0)
      .map(v => v.trim());
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
}

/**
 * Normalize geographic area metadata
 * @param {*} value
 * @param {string} fallbackLabel
 * @returns {GeographicAreaMeta}
 */
export function normalizeGeographicAreaMeta(value, fallbackLabel = "") {
  if (!isPlainObject(value)) {
    return {
      label: fallbackLabel,
      lat: null,
      lon: null,
      place_id: null,
      source: "google"
    };
  }

  return {
    label: normalizeLiveString(value.label, fallbackLabel),
    lat: typeof value.lat === "number" ? value.lat : null,
    lon: typeof value.lon === "number" ? value.lon : null,
    place_id: normalizeString(value.place_id, ""),
    source: normalizeString(value.source, "google")
  };
}

/**
 * Normalize Express form data to current schema
 * @param {*} value
 * @returns {ExpressFormData}
 */
export function normalizeExpressFormData(value) {
  const initial = getInitialExpressFormData();

  if (!isPlainObject(value)) {
    return initial;
  }

  return {
    itCompanyType: normalizeStringArray(value.itCompanyType),
    itCompanyTypeOther: normalizeLiveString(value.itCompanyTypeOther, ""),
    serviceOfferings: normalizeStringArray(value.serviceOfferings),
    serviceOfferingsOther: normalizeLiveString(value.serviceOfferingsOther, ""),
    differentiation: normalizeLiveString(value.differentiation, ""),
    geographicAreas: normalizeLiveString(value.geographicAreas, ""),
    geographicAreaMeta: normalizeGeographicAreaMeta(
      value.geographicAreaMeta,
      normalizeLiveString(value.geographicAreas, "")
    ),
    pricingPackaging: normalizeLiveString(value.pricingPackaging, ""),
    pricingPackagingOther: normalizeLiveString(value.pricingPackagingOther, ""),
    companyGoals: normalizeLiveString(value.companyGoals, ""),
    companyGoalsOther: normalizeLiveString(value.companyGoalsOther, ""),
    brandTone: normalizeLiveString(value.brandTone, ""),
    brandToneOther: normalizeLiveString(value.brandToneOther, ""),
    targetIndustries: normalizeStringArray(value.targetIndustries),
    targetIndustriesOther: normalizeLiveString(value.targetIndustriesOther, ""),
    clientSize: normalizeLiveString(value.clientSize, "1-50 employees") || "1-50 employees",
    clientChallenges: normalizeStringArray(value.clientChallenges),
    clientChallengesOther: normalizeLiveString(value.clientChallengesOther, ""),
    clientOutcomes: normalizeStringArray(value.clientOutcomes),
    clientOutcomesOther: normalizeLiveString(value.clientOutcomesOther, ""),
    idealClient: normalizeLiveString(value.idealClient, "")
  };
}

/**
 * Normalize validation status
 * @param {*} value
 * @returns {Record<string, ValidationStatus>}
 */
export function normalizeValidationStatus(value) {
  const allowedStatuses = ["unknown", "validating", "complete", "needs_work", "incomplete", "error", "dirty"];

  if (!isPlainObject(value)) {
    return {};
  }

  /** @type {Record<string, ValidationStatus>} */
  const normalized = {};
  const validFields = [
    "differentiation",
    "idealClient",
    "itCompanyType",
    "serviceOfferings",
    "geographicAreas",
    "pricingPackaging",
    "companyGoals",
    "brandTone",
    "targetIndustries",
    "clientSize",
    "clientChallenges",
    "clientOutcomes"
  ];

  for (const fieldName of validFields) {
    const status = value[fieldName];
    if (isPlainObject(status)) {
      normalized[fieldName] = {
        status: allowedStatuses.includes(status.status) ? status.status : "unknown",
        message: normalizeString(status.message, ""),
        reason_codes: Array.isArray(status.reason_codes) ? status.reason_codes : [],
        suggestions: Array.isArray(status.suggestions) ? status.suggestions : [],
        answerHash: normalizeString(status.answerHash, ""),
        validatedAt: normalizeString(status.validatedAt, "")
      };
    } else {
      normalized[fieldName] = {
        status: "unknown",
        message: "",
        reason_codes: [],
        suggestions: [],
        answerHash: "",
        validatedAt: ""
      };
    }
  }

  return normalized;
}

/**
 * Normalize touched questions
 * @param {*} value
 * @returns {Record<string, boolean>}
 */
export function normalizeTouchedQuestions(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  /** @type {Record<string, boolean>} */
  const normalized = {};
  for (let i = 1; i <= 12; i++) {
    const key = String(i);
    normalized[key] = value[key] === true;
  }
  return normalized;
}

/**
 * Normalize expanded questions
 * @param {*} value
 * @returns {Record<string, boolean>}
 */
export function normalizeExpandedQuestions(value) {
  const defaults = getDefaultExpandedQuestions();

  if (!isPlainObject(value)) {
    return defaults;
  }

  /** @type {Record<string, boolean>} */
  const normalized = {};
  for (let i = 1; i <= 12; i++) {
    const key = String(i);
    normalized[key] = value[key] === true;
  }
  return normalized;
}

/**
 * Parse persisted state cookie with migration support and diagnostics
 * @param {string} rawValue
 * @returns {ParseResult}
 */
export function parsePersistedStateCookie(rawValue) {
  const diagnostics = {
    detectedFormat: "unknown",
    missingFields: [],
    droppedFields: [],
    repairedFields: [],
    invalidSections: [],
    versionFrom: null,
    versionTo: EXPRESS_PERSISTED_STATE_VERSION
  };

  if (!rawValue) {
    return {
      ok: false,
      state: getDefaultPersistedState(),
      migrated: false,
      repaired: false,
      discarded: false,
      error: new Error("No cookie value"),
      diagnostics
    };
  }

  try {
    const parsed = JSON.parse(rawValue);

    // Check if this is old raw form data format (no version field)
    if (!parsed.version) {
      // Check if it looks like raw form data
      if (parsed.itCompanyType !== undefined || parsed.differentiation !== undefined) {
        diagnostics.detectedFormat = "raw_form_data";
        diagnostics.versionFrom = 0;

        // Track missing sections
        if (!parsed.validationStatus) diagnostics.missingFields.push("validationStatus");
        if (!parsed.touchedQuestions) diagnostics.missingFields.push("touchedQuestions");
        if (!parsed.expandedQuestions) diagnostics.missingFields.push("expandedQuestions");

        // Migrate old format to versioned state
        const migratedState = {
          version: EXPRESS_PERSISTED_STATE_VERSION,
          savedAt: new Date().toISOString(),
          formData: normalizeExpressFormData(parsed),
          validationStatus: {},
          touchedQuestions: {},
          expandedQuestions: getDefaultExpandedQuestions(),
          questionnaireSessionId: ""
        };

        return {
          ok: true,
          state: migratedState,
          migrated: true,
          repaired: false,
          discarded: false,
          error: null,
          diagnostics
        };
      }

      // Unknown format, return default
      diagnostics.detectedFormat = "unknown_format";
      diagnostics.discarded = true;

      return {
        ok: true,
        state: getDefaultPersistedState(),
        migrated: false,
        repaired: false,
        discarded: true,
        error: null,
        diagnostics
      };
    }

    // Versioned format - normalize all sections and track repairs
    diagnostics.detectedFormat = "versioned_state";
    diagnostics.versionFrom = parsed.version || 0;

    // Track dropped unknown fields from formData
    const knownFormFields = [
      "itCompanyType", "itCompanyTypeOther", "serviceOfferings", "serviceOfferingsOther",
      "differentiation", "geographicAreas", "geographicAreaMeta", "pricingPackaging",
      "pricingPackagingOther", "companyGoals", "companyGoalsOther", "brandTone",
      "brandToneOther", "targetIndustries", "targetIndustriesOther", "clientSize",
      "clientChallenges", "clientChallengesOther", "clientOutcomes", "clientOutcomesOther",
      "idealClient"
    ];

    if (parsed.formData && typeof parsed.formData === "object") {
      const unknownFields = Object.keys(parsed.formData).filter(f => !knownFormFields.includes(f));
      if (unknownFields.length > 0) {
        diagnostics.droppedFields.push(...unknownFields.map(f => `formData.${f}`));
      }
    }

    // Normalize and track repairs
    const normalizedFormData = normalizeExpressFormData(parsed.formData || parsed);
    const normalizedValidationStatus = normalizeValidationStatus(parsed.validationStatus || {});
    const normalizedTouchedQuestions = normalizeTouchedQuestions(parsed.touchedQuestions || {});
    const normalizedExpandedQuestions = normalizeExpandedQuestions(parsed.expandedQuestions || {});

    // Track repaired fields
    if (parsed.validationStatus && typeof parsed.validationStatus === "object") {
      for (const [fieldName, originalStatus] of Object.entries(parsed.validationStatus)) {
        const normalized = normalizedValidationStatus[fieldName];
        if (normalized && originalStatus && originalStatus.status !== normalized.status) {
          diagnostics.repairedFields.push(`validationStatus.${fieldName}`);
        }
      }
    }

    // Track invalid sections that were defaulted
    if (!parsed.validationStatus || typeof parsed.validationStatus !== "object") {
      diagnostics.invalidSections.push("validationStatus");
    }
    if (!parsed.touchedQuestions || typeof parsed.touchedQuestions !== "object") {
      diagnostics.invalidSections.push("touchedQuestions");
    }
    if (!parsed.expandedQuestions || typeof parsed.expandedQuestions !== "object") {
      diagnostics.invalidSections.push("expandedQuestions");
    }

    const normalizedState = {
      version: EXPRESS_PERSISTED_STATE_VERSION,
      savedAt: normalizeString(parsed.savedAt, ""),
      formData: normalizedFormData,
      validationStatus: normalizedValidationStatus,
      touchedQuestions: normalizedTouchedQuestions,
      expandedQuestions: normalizedExpandedQuestions,
      questionnaireSessionId: normalizeString(parsed.questionnaireSessionId, "")
    };

    const wasRepaired = diagnostics.repairedFields.length > 0 || diagnostics.invalidSections.length > 0;

    return {
      ok: true,
      state: normalizedState,
      migrated: false,
      repaired: wasRepaired,
      discarded: false,
      error: null,
      diagnostics
    };
  } catch (error) {
    // Corrupted JSON - discard and return default state
    diagnostics.detectedFormat = "corrupted_json";
    diagnostics.discarded = true;

    return {
      ok: false,
      state: getDefaultPersistedState(),
      migrated: false,
      repaired: false,
      discarded: true,
      error,
      diagnostics
    };
  }
}

/**
 * Serialize persisted state to JSON string
 * @param {PersistedState} state
 * @returns {string}
 */
export function serializePersistedState(state) {
  return JSON.stringify({
    version: state.version,
    savedAt: state.savedAt,
    formData: state.formData,
    validationStatus: state.validationStatus,
    touchedQuestions: state.touchedQuestions,
    expandedQuestions: state.expandedQuestions,
    questionnaireSessionId: state.questionnaireSessionId
  });
}

/**
 * Build persisted state from current values
 * @param {Object} params
 * @param {ExpressFormData} params.formData
 * @param {Record<string, ValidationStatus>} params.validationStatus
 * @param {Record<string, boolean>} params.touchedQuestions
 * @param {Record<string, boolean>} params.expandedQuestions
 * @param {string} params.questionnaireSessionId
 * @returns {PersistedState}
 */
export function buildPersistedState({
  formData,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  questionnaireSessionId
}) {
  return {
    version: EXPRESS_PERSISTED_STATE_VERSION,
    savedAt: new Date().toISOString(),
    formData,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    questionnaireSessionId
  };
}
