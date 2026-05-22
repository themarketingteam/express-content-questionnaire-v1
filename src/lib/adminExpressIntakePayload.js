/**
 * Admin Express intake payload utilities.
 * Provides the default payload shape, repair, and validation
 * for the /admin/submit-intake page.
 */

export function initialExpressAdminIntakePayload() {
  return {
    metadata: {
      business_name: "",
      businessDomain: "",
      submission_datetime: new Date().toISOString(),
      service_type: "express",
      questionnaire_session_id: ""
    },
    userdata: {
      it_company_type: [],
      it_company_type_other: "",
      service_offerings: [],
      service_offerings_other: "",
      differentiation: "",
      geographic_areas: "",
      geographic_area_meta: { label: "", lat: null, lon: null, place_id: null, source: "manual" },
      pricing_packaging: "",
      pricing_packaging_other: "",
      company_goals: "",
      company_goals_other: "",
      brand_tone: "",
      brand_tone_other: "",
      target_industries: [],
      target_industries_other: "",
      client_size: "",
      client_challenges: [],
      client_challenges_other: "",
      client_outcomes: [],
      client_outcomes_other: "",
      ideal_client: ""
    }
  };
}

export function repairExpressAdminIntakePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const md = payload.metadata || {};
  const ud = payload.userdata || {};

  const ensureArray = (v) => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "string" && v.trim()) return [v];
    return [];
  };

  const repairedMetadata = {
    business_name: String(md.business_name || "").trim(),
    businessDomain: String(md.businessDomain || "").trim(),
    submission_datetime: md.submission_datetime || new Date().toISOString(),
    service_type: "express",
    questionnaire_session_id: String(md.questionnaire_session_id || "").trim()
  };

  const repairedUserdata = {
    it_company_type: ensureArray(ud.it_company_type),
    it_company_type_other: String(ud.it_company_type_other || ""),
    service_offerings: ensureArray(ud.service_offerings),
    service_offerings_other: String(ud.service_offerings_other || ""),
    differentiation: String(ud.differentiation || ""),
    geographic_areas: String(ud.geographic_areas || ""),
    geographic_area_meta: ud.geographic_area_meta && typeof ud.geographic_area_meta === "object"
      ? ud.geographic_area_meta
      : { label: "", lat: null, lon: null, place_id: null, source: "manual" },
    pricing_packaging: String(ud.pricing_packaging || ""),
    pricing_packaging_other: String(ud.pricing_packaging_other || ""),
    company_goals: ud.company_goals || "",
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
    ideal_client: String(ud.ideal_client || "")
  };

  return { metadata: repairedMetadata, userdata: repairedUserdata };
}

export function validateExpressAdminIntakePayload(payload) {
  const errors = [];
  const md = payload?.metadata || {};
  const ud = payload?.userdata || {};

  if (!String(md.business_name || "").trim()) errors.push("metadata.business_name is required");
  if (!String(md.businessDomain || "").trim()) errors.push("metadata.businessDomain is required");
  if (md.service_type !== "express") errors.push("metadata.service_type must be 'express'");
  if (!Array.isArray(ud.it_company_type)) errors.push("userdata.it_company_type must be an array");
  if (!Array.isArray(ud.service_offerings)) errors.push("userdata.service_offerings must be an array");

  return { valid: errors.length === 0, errors };
}