/**
 * Express Questionnaire Payload Utilities
 * Centralizes payload construction for the Express questionnaire flow.
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

export function buildExpressSubmissionPayload({ formData, businessName, domain, sessionId }) {
  return {
    _rawFormData: { ...formData },
    metadata: {
      business_name: businessName,
      businessDomain: cleanExpressDomain(domain),
      submission_datetime: new Date().toISOString(),
      service_type: "express",
      questionnaire_session_id: sessionId || ""
    },
    userdata: {
      it_company_type: formData.itCompanyType,
      it_company_type_other: formData.itCompanyTypeOther,
      service_offerings: formData.serviceOfferings,
      service_offerings_other: formData.serviceOfferingsOther,
      differentiation: formData.differentiation,
      geographic_areas: formData.geographicAreaMeta?.label || formData.geographicAreas,
      geographic_area_meta: formData.geographicAreaMeta,
      pricing_packaging: formData.pricingPackaging,
      pricing_packaging_other: formData.pricingPackagingOther,
      company_goals: formData.companyGoals,
      company_goals_other: formData.companyGoalsOther,
      brand_tone: formData.brandTone,
      brand_tone_other: formData.brandToneOther,
      target_industries: formData.targetIndustries,
      target_industries_other: formData.targetIndustriesOther,
      client_size: formData.clientSize,
      client_challenges: formData.clientChallenges,
      client_challenges_other: formData.clientChallengesOther,
      client_outcomes: formData.clientOutcomes,
      client_outcomes_other: formData.clientOutcomesOther,
      ideal_client: formData.idealClient
    }
  };
}

export function mapExpressPayloadToFormSubmissionRecord(payload) {
  const ud = payload.userdata;
  const md = payload.metadata;

  const companyGoals = Array.isArray(ud.company_goals)
    ? ud.company_goals
    : (ud.company_goals ? [ud.company_goals] : []);

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
    company_goals: companyGoals,
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
    ideal_client: ud.ideal_client
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
    const isDev = import.meta.env?.DEV === true;
    return {
      message: error?.message || "Unknown error",
      name: error?.name || "Error",
      status: error?.status ?? error?.statusCode ?? null,
      ...(isDev && error?.stack ? { stack: error.stack } : {})
    };
  } catch {
    return { message: "Unknown error", name: "Error", status: null };
  }
}