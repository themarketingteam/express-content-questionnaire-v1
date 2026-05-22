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

export function getInitialExpressFormData() {
  return {
    itCompanyType: [],
    itCompanyTypeOther: "",
    serviceOfferings: [],
    serviceOfferingsOther: "",
    differentiation: "",
    geographicAreas: "",
    geographicAreaMeta: { label: "", lat: null, lon: null, place_id: null, source: "google" },
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

export function buildExpressSubmissionPayload({ formData, businessName, domain, sessionId, submitAttemptId }) {
  const fd = formData || {};
  return {
    _rawFormData: { ...fd },
    metadata: {
      business_name: businessName,
      businessDomain: cleanExpressDomain(domain),
      submission_datetime: new Date().toISOString(),
      service_type: "express",
      questionnaire_session_id: sessionId || "",
      submit_attempt_id: submitAttemptId || ""
    },
    userdata: {
      it_company_type: fd.itCompanyType,
      it_company_type_other: fd.itCompanyTypeOther,
      service_offerings: fd.serviceOfferings,
      service_offerings_other: fd.serviceOfferingsOther,
      differentiation: fd.differentiation,
      geographic_areas: fd.geographicAreaMeta?.label || fd.geographicAreas,
      geographic_area_meta: fd.geographicAreaMeta,
      pricing_packaging: fd.pricingPackaging,
      pricing_packaging_other: fd.pricingPackagingOther,
      company_goals: fd.companyGoals,
      company_goals_other: fd.companyGoalsOther,
      brand_tone: fd.brandTone,
      brand_tone_other: fd.brandToneOther,
      target_industries: fd.targetIndustries,
      target_industries_other: fd.targetIndustriesOther,
      client_size: fd.clientSize,
      client_challenges: fd.clientChallenges,
      client_challenges_other: fd.clientChallengesOther,
      client_outcomes: fd.clientOutcomes,
      client_outcomes_other: fd.clientOutcomesOther,
      ideal_client: fd.idealClient
    }
  };
}

export function mapExpressPayloadToFormSubmissionRecord(payload) {
  const ud = payload.userdata || {};
  const md = payload.metadata || {};
  const rawGoals = ud.company_goals;
  const company_goals = Array.isArray(rawGoals)
    ? rawGoals
    : (rawGoals && String(rawGoals).trim() ? [rawGoals] : []);

  return {
    business_name: md.business_name,
    submission_datetime: md.submission_datetime,
    service_type: md.service_type,
    it_company_type: ud.it_company_type,
    it_company_type_other: ud.it_company_type_other,
    service_offerings: ud.service_offerings,
    service_offerings_other: ud.service_offerings_other,
    differentiation: ud.differentiation,
    geographic_areas: ud.geographic_areas,
    geographic_area_meta: ud.geographic_area_meta,
    pricing_packaging: ud.pricing_packaging,
    pricing_packaging_other: ud.pricing_packaging_other,
    company_goals,
    company_goals_other: ud.company_goals_other,
    brand_tone: ud.brand_tone,
    brand_tone_other: ud.brand_tone_other,
    target_industries: ud.target_industries,
    target_industries_other: ud.target_industries_other,
    client_size: ud.client_size,
    client_challenges: ud.client_challenges,
    client_challenges_other: ud.client_challenges_other,
    client_outcomes: ud.client_outcomes,
    client_outcomes_other: ud.client_outcomes_other,
    ideal_client: ud.ideal_client,
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