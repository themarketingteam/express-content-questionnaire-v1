/**
 * Express questionnaire payload builder utility.
 * Provides domain cleaning, default form data, payload building,
 * and DB record mapping for the Express questionnaire.
 */

export function cleanExpressDomain(rawDomain) {
  if (!rawDomain) return "";
  const str = String(rawDomain);
  return str
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .trim();
}

export function sanitizeGeoMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  if (typeof raw.label === 'string' && raw.label.trim()) out.label = raw.label.trim();
  if (typeof raw.lat === 'number' && isFinite(raw.lat)) out.lat = raw.lat;
  if (typeof raw.lon === 'number' && isFinite(raw.lon)) out.lon = raw.lon;
  if (raw.place_id && typeof raw.place_id === 'string' && raw.place_id.trim()) out.place_id = raw.place_id.trim();
  if (typeof raw.source === 'string' && raw.source.trim()) out.source = raw.source.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

export function getInitialExpressFormData() {
  return {
    itCompanyType: [],
    itCompanyTypeOther: "",
    serviceOfferings: [],
    serviceOfferingsOther: "",
    differentiation: "",
    geographicAreas: "",
    geographicAreaMeta: {},
    pricingPackaging: "",
    pricingPackagingOther: "",
    companyGoals: "",
    companyGoalsOther: "",
    brandTone: "",
    brandToneOther: "",
    targetIndustries: [],
    targetIndustriesOther: "",
    clientSize: "1-50 employees",
    clientChallenges: [],
    clientChallengesOther: "",
    clientOutcomes: [],
    clientOutcomesOther: "",
    idealClient: ""
  };
}

/**
 * Normalize Express form data to ensure consistent types and prevent downstream errors.
 * This function repairs malformed state where arrays became strings or vice versa.
 * @param {Object} formData - Raw form data from questionnaire
 * @returns {Object} - Normalized form data with guaranteed types
 */
export function normalizeExpressFormData(formData) {
  const fd = formData || {};
  
  // Helper to ensure array type
  const ensureArray = (val) => {
    if (Array.isArray(val)) return val.filter(Boolean);
    if (typeof val === "string" && val.trim()) return [val.trim()];
    if (val && typeof val === "object" && val.label) return [val.label];
    return [];
  };
  
  // Helper to ensure string type
  const ensureString = (val, defaultVal = "") => {
    if (typeof val === "string") return val.trim();
    if (Array.isArray(val) && val.length > 0) return val.join(", ");
    if (val && typeof val === "object" && val.label) return val.label;
    return defaultVal;
  };
  
  return {
    itCompanyType: ensureArray(fd.itCompanyType),
    itCompanyTypeOther: ensureString(fd.itCompanyTypeOther, ""),
    serviceOfferings: ensureArray(fd.serviceOfferings),
    serviceOfferingsOther: ensureString(fd.serviceOfferingsOther, ""),
    differentiation: ensureString(fd.differentiation, ""),
    geographicAreas: ensureString(fd.geographicAreas, ""),
    geographicAreaMeta: sanitizeGeoMeta(fd.geographicAreaMeta) || {},
    pricingPackaging: ensureString(fd.pricingPackaging, ""),
    pricingPackagingOther: ensureString(fd.pricingPackagingOther, ""),
    companyGoals: ensureString(fd.companyGoals, ""),
    companyGoalsOther: ensureString(fd.companyGoalsOther, ""),
    brandTone: ensureString(fd.brandTone, ""),
    brandToneOther: ensureString(fd.brandToneOther, ""),
    targetIndustries: ensureArray(fd.targetIndustries),
    targetIndustriesOther: ensureString(fd.targetIndustriesOther, ""),
    clientSize: ensureString(fd.clientSize, "1-50 employees"),
    clientChallenges: ensureArray(fd.clientChallenges),
    clientChallengesOther: ensureString(fd.clientChallengesOther, ""),
    clientOutcomes: ensureArray(fd.clientOutcomes),
    clientOutcomesOther: ensureString(fd.clientOutcomesOther, ""),
    idealClient: ensureString(fd.idealClient, "")
  };
}

export function buildExpressSubmissionPayload({ formData, businessName, domain, sessionId, submitAttemptId }) {
  // Normalize form data to ensure consistent types
  const safeFormData = normalizeExpressFormData(formData || {});
  
  return {
    _rawFormData: { ...safeFormData },
    metadata: {
      business_name: businessName,
      businessDomain: cleanExpressDomain(domain),
      submission_datetime: new Date().toISOString(),
      service_type: "express",
      questionnaire_session_id: sessionId || "",
      submit_attempt_id: submitAttemptId || ""
    },
    userdata: {
      it_company_type: safeFormData.itCompanyType,
      it_company_type_other: safeFormData.itCompanyTypeOther,
      service_offerings: safeFormData.serviceOfferings,
      service_offerings_other: safeFormData.serviceOfferingsOther,
      differentiation: safeFormData.differentiation,
      geographic_areas: (safeFormData.geographicAreaMeta?.source === "google" && safeFormData.geographicAreaMeta?.place_id)
        ? (safeFormData.geographicAreaMeta?.label || safeFormData.geographicAreas)
        : safeFormData.geographicAreas,
      geographic_area_meta: safeFormData.geographicAreaMeta || {},
      pricing_packaging: safeFormData.pricingPackaging,
      pricing_packaging_other: safeFormData.pricingPackagingOther,
      company_goals: safeFormData.companyGoals,
      company_goals_other: safeFormData.companyGoalsOther,
      brand_tone: safeFormData.brandTone,
      brand_tone_other: safeFormData.brandToneOther,
      target_industries: safeFormData.targetIndustries,
      target_industries_other: safeFormData.targetIndustriesOther,
      client_size: safeFormData.clientSize,
      client_challenges: safeFormData.clientChallenges,
      client_challenges_other: safeFormData.clientChallengesOther,
      client_outcomes: safeFormData.clientOutcomes,
      client_outcomes_other: safeFormData.clientOutcomesOther,
      ideal_client: safeFormData.idealClient
    }
  };
}

export function mapExpressPayloadToFormSubmissionRecord(payload) {
  const ud = payload.userdata || {};
  const md = payload.metadata || {};
  
  // Safely handle company_goals which may be string or array
  const rawGoals = ud.company_goals;
  const company_goals = Array.isArray(rawGoals)
    ? rawGoals.filter(Boolean)
    : (rawGoals && String(rawGoals).trim() ? [String(rawGoals).trim()] : []);

  // Helper to safely ensure array type for all array fields
  const ensureArray = (val) => {
    if (Array.isArray(val)) return val.filter(Boolean);
    if (typeof val === "string" && val.trim()) return [val.trim()];
    return [];
  };

  return {
    business_name: md.business_name || "",
    business_domain: md.businessDomain || md.business_domain || "",
    submission_datetime: md.submission_datetime || new Date().toISOString(),
    service_type: md.service_type || "express",
    it_company_type: ensureArray(ud.it_company_type),
    it_company_type_other: String(ud.it_company_type_other || ""),
    service_offerings: ensureArray(ud.service_offerings),
    service_offerings_other: String(ud.service_offerings_other || ""),
    differentiation: String(ud.differentiation || ""),
    geographic_areas: String(ud.geographic_areas || ""),
    geographic_area_meta: sanitizeGeoMeta(ud.geographic_area_meta) || undefined,
    pricing_packaging: String(ud.pricing_packaging || ""),
    pricing_packaging_other: String(ud.pricing_packaging_other || ""),
    company_goals,
    company_goals_other: String(ud.company_goals_other || ""),
    brand_tone: String(ud.brand_tone || ""),
    brand_tone_other: String(ud.brand_tone_other || ""),
    target_industries: ensureArray(ud.target_industries),
    target_industries_other: String(ud.target_industries_other || ""),
    client_size: String(ud.client_size || ""),
    client_challenges: ensureArray(ud.client_challenges),
    client_challenges_other: String(ud.client_challenges_other || ""),
    client_outcomes: ensureArray(ud.client_outcomes),
    client_outcomes_other: String(ud.client_outcomes_other || ""),
    ideal_client: String(ud.ideal_client || ""),
    questionnaire_session_id: md.questionnaire_session_id || "",
    submit_attempt_id: md.submit_attempt_id || "",
    zapier_delivery_status: "not_attempted",
    zapier_sent: false,
    zapier_sent_at: "",
    zapier_error_json: "",
    zapier_attempt_count: 0
  };
}

export function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return fallback;
  }
}

export function serializeExpressError(error) {
  try {
    const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;
    return {
      message: error?.message || String(error) || "Unknown error",
      name: error?.name || "Error",
      status: error?.status || error?.statusCode || null,
      ...(isDev && error?.stack ? { stack: error.stack } : {})
    };
  } catch {
    return { message: "Unknown error", name: "Error", status: null };
  }
}
