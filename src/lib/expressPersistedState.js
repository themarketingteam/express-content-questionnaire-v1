import { getInitialExpressFormData } from "@/lib/expressQuestionnairePayload";

export const EXPRESS_PERSISTED_STATE_VERSION = 2;
export const EXPRESS_COOKIE_KEY = "msp_questionnaire_data_v2";

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
    "12": false,
  };
}

/**
 * Get default persisted state object
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
    questionnaireSessionId: "",
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
 * Normalize a string value
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */
export function normalizeString(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim();
  }
  return fallback;
}

/**
 * Normalize a string array value
 * @param {*} value
 * @returns {string[]}
 */
export function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
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
      source: "google",
    };
  }

  return {
    label: normalizeString(value.label, fallbackLabel),
    lat: typeof value.lat === "number" ? value.lat : null,
    lon: typeof value.lon === "number" ? value.lon : null,
    place_id: normalizeString(value.place_id, ""),
    source: normalizeString(value.source, "google"),
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
    itCompanyTypeOther: normalizeString(value.itCompanyTypeOther, ""),
    serviceOfferings: normalizeStringArray(value.serviceOfferings),
    serviceOfferingsOther: normalizeString(value.serviceOfferingsOther, ""),
    differentiation: normalizeString(value.differentiation, ""),
    geographicAreas: normalizeString(value.geographicAreas, ""),
    geographicAreaMeta: normalizeGeographicAreaMeta(
      value.geographicAreaMeta,
      normalizeString(value.geographicAreas, "")
    ),
    pricingPackaging: normalizeString(value.pricingPackaging, ""),
    pricingPackagingOther: normalizeString(value.pricingPackagingOther, ""),
    companyGoals: normalizeString(value.companyGoals, ""),
    companyGoalsOther: normalizeString(value.companyGoalsOther, ""),
    brandTone: normalizeString(value.brandTone, ""),
    brandToneOther: normalizeString(value.brandToneOther, ""),
    targetIndustries: normalizeStringArray(value.targetIndustries),
    targetIndustriesOther: normalizeString(value.targetIndustriesOther, ""),
    clientSize: normalizeString(value.clientSize, ""),
    clientChallenges: normalizeStringArray(value.clientChallenges),
    clientChallengesOther: normalizeString(value.clientChallengesOther, ""),
    clientOutcomes: normalizeStringArray(value.clientOutcomes),
    clientOutcomesOther: normalizeString(value.clientOutcomesOther, ""),
    idealClient: normalizeString(value.idealClient, ""),
  };
}

/**
 * Normalize validation status object
 * @param {*} value
 * @returns {Record<string, ValidationStatus>}
 */
export function normalizeValidationStatus(value) {
  const allowedStatuses = new Set([
    "unknown",
    "validating",
    "complete",
    "needs_work",
    "incomplete",
    "error",
    "dirty",
  ]);

  if (!isPlainObject(value)) {
    return {};
  }

  const normalized = {};
  for (const [fieldName, status] of Object.entries(value)) {
    if (typeof status === "object" && status !== null) {
      const statusValue = normalizeString(status.status, "unknown");
      normalized[fieldName] = {
        status: allowedStatuses.has(statusValue) ? statusValue : "unknown",
        message: normalizeString(status.message, ""),
        reason_codes: normalizeStringArray(status.reason_codes || []),
        suggestions: normalizeStringArray(status.suggestions || []),
        answerHash: normalizeString(status.answerHash, ""),
        validatedAt: normalizeString(status.validatedAt, ""),
      };
    } else {
      normalized[fieldName] = {
        status: "unknown",
        message: "",
        reason_codes: [],
        suggestions: [],
        answerHash: "",
        validatedAt: "",
      };
    }
  }

  return normalized;
}

/**
 * Normalize touched questions map
 * @param {*} value
 * @returns {Record<string, boolean>}
 */
export function normalizeTouchedQuestions(value) {
  const result = {};
  for (let i = 1; i <= 12; i++) {
    const key = String(i);
    if (isPlainObject(value) && typeof value[key] === "boolean") {
      result[key] = value[key];
    } else {
      result[key] = false;
    }
  }
  return result;
}

/**
 * Normalize expanded questions map
 * @param {*} value
 * @returns {Record<string, boolean>}
 */
export function normalizeExpandedQuestions(value) {
  const defaults = getDefaultExpandedQuestions();
  const result = {};
  for (let i = 1; i <= 12; i++) {
    const key = String(i);
    if (isPlainObject(value) && typeof value[key] === "boolean") {
      result[key] = value[key];
    } else {
      result[key] = defaults[key];
    }
  }
  return result;
}

/**
 * Parse persisted state cookie with migration support
 * @param {string} rawValue
 * @returns {ParseResult}
 */
export function parsePersistedStateCookie(rawValue) {
  let parsed;
  let parseError = null;

  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    parseError = error;
    return {
      ok: false,
      state: getDefaultPersistedState(),
      migrated: false,
      error: parseError,
    };
  }

  // Detect old format: raw form data (array or object without version)
  if (!parsed.version) {
    if (Array.isArray(parsed) || (isPlainObject(parsed) && !parsed.formData)) {
      // Migrate old raw form data to versioned state
      const migratedState = {
        version: EXPRESS_PERSISTED_STATE_VERSION,
        savedAt: new Date().toISOString(),
        formData: normalizeExpressFormData(parsed),
        validationStatus: {},
        touchedQuestions: {},
        expandedQuestions: getDefaultExpandedQuestions(),
        questionnaireSessionId: "",
      };

      return {
        ok: true,
        state: migratedState,
        migrated: true,
        error: null,
      };
    }
  }

  // Handle versioned format
  if (parsed.version && isPlainObject(parsed)) {
    const normalizedState = {
      version: EXPRESS_PERSISTED_STATE_VERSION,
      savedAt: normalizeString(parsed.savedAt, ""),
      formData: normalizeExpressFormData(parsed.formData || {}),
      validationStatus: normalizeValidationStatus(parsed.validationStatus || {}),
      touchedQuestions: normalizeTouchedQuestions(parsed.touchedQuestions || {}),
      expandedQuestions: normalizeExpandedQuestions(parsed.expandedQuestions || {}),
      questionnaireSessionId: normalizeString(parsed.questionnaireSessionId, ""),
    };

    return {
      ok: true,
      state: normalizedState,
      migrated: parsed.version !== EXPRESS_PERSISTED_STATE_VERSION,
      error: null,
    };
  }

  // Unknown format - return default
  return {
    ok: true,
    state: getDefaultPersistedState(),
    migrated: false,
    error: null,
  };
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
    questionnaireSessionId: state.questionnaireSessionId,
  });
}

/**
 * Build current versioned persisted state
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
  questionnaireSessionId,
}) {
  return {
    version: EXPRESS_PERSISTED_STATE_VERSION,
    savedAt: new Date().toISOString(),
    formData,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    questionnaireSessionId,
  };
}