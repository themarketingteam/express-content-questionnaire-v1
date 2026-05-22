/**
 * Admin Express intake payload utilities.
 * Provides the default payload shape, repair, and validation
 * for the /admin/submit-intake page.
 */

import { cleanExpressDomain, normalizeExpressFormData } from "@/lib/expressQuestionnairePayload";

export function initialExpressAdminIntakePayload() {
  return {
    metadata: {
      business_name: "Example MSP",
      businessDomain: "example.com",
      submission_datetime: new Date().toISOString(),
      service_type: "express",
      questionnaire_session_id: ""
    },
    userdata: {
      it_company_type: ["Managed Services Provider (MSP)"],
      it_company_type_other: "",
      service_offerings: ["Managed IT", "Cybersecurity Services", "Microsoft 365"],
      service_offerings_other: "",
      differentiation: "Example short differentiation answer.",
      geographic_areas: "Nashville, Tennessee",
      geographic_area_meta: { label: "Nashville, TN, USA", lat: null, lon: null, place_id: null, source: "manual" },
      pricing_packaging: "Flat-rate monthly (fully managed)",
      pricing_packaging_other: "",
      company_goals: "Acquire more clients",
      company_goals_other: "",
      brand_tone: "Friendly & Approachable",
      brand_tone_other: "",
      target_industries: ["Healthcare / Medical"],
      target_industries_other: "",
      client_size: "1-50 employees",
      client_challenges: ["Cybersecurity concerns or breaches"],
      client_challenges_other: "",
      client_outcomes: ["Peace of mind about security"],
      client_outcomes_other: "",
      ideal_client: "A growing business that needs reliable IT support."
    }
  };
}

export function repairExpressAdminIntakePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, payload: null, errors: ["Payload is null or not an object"] };
  }

  const md = payload.metadata || {};
  const ud = payload.userdata || {};

  // Normalize userdata first using shared helper
  const normalizedUserdata = normalizeExpressFormData({
    itCompanyType: ud.it_company_type,
    itCompanyTypeOther: ud.it_company_type_other,
    serviceOfferings: ud.service_offerings,
    serviceOfferingsOther: ud.service_offerings_other,
    differentiation: ud.differentiation,
    geographicAreas: ud.geographic_areas,
    geographicAreaMeta: ud.geographic_area_meta,
    pricingPackaging: ud.pricing_packaging,
    pricingPackagingOther: ud.pricing_packaging_other,
    companyGoals: ud.company_goals,
    companyGoalsOther: ud.company_goals_other,
    brandTone: ud.brand_tone,
    brandToneOther: ud.brand_tone_other,
    targetIndustries: ud.target_industries,
    targetIndustriesOther: ud.target_industries_other,
    clientSize: ud.client_size,
    clientChallenges: ud.client_challenges,
    clientChallengesOther: ud.client_challenges_other,
    clientOutcomes: ud.client_outcomes,
    clientOutcomesOther: ud.client_outcomes_other,
    idealClient: ud.ideal_client,
  });

  const repairedMetadata = {
    business_name: String(md.business_name || "").trim(),
    businessDomain: cleanExpressDomain(md.businessDomain || ""),
    submission_datetime: md.submission_datetime || new Date().toISOString(),
    service_type: "express",
    questionnaire_session_id: String(md.questionnaire_session_id || "").trim()
  };

  // Use normalized userdata fields (already properly typed)
  const repairedUserdata = {
    it_company_type: normalizedUserdata.itCompanyType,
    it_company_type_other: normalizedUserdata.itCompanyTypeOther,
    service_offerings: normalizedUserdata.serviceOfferings,
    service_offerings_other: normalizedUserdata.serviceOfferingsOther,
    differentiation: normalizedUserdata.differentiation,
    geographic_areas: normalizedUserdata.geographicAreas,
    geographic_area_meta: normalizedUserdata.geographicAreaMeta,
    pricing_packaging: normalizedUserdata.pricingPackaging,
    pricing_packaging_other: normalizedUserdata.pricingPackagingOther,
    company_goals: normalizedUserdata.companyGoals,
    company_goals_other: normalizedUserdata.companyGoalsOther,
    brand_tone: normalizedUserdata.brandTone,
    brand_tone_other: normalizedUserdata.brandToneOther,
    target_industries: normalizedUserdata.targetIndustries,
    target_industries_other: normalizedUserdata.targetIndustriesOther,
    client_size: normalizedUserdata.clientSize,
    client_challenges: normalizedUserdata.clientChallenges,
    client_challenges_other: normalizedUserdata.clientChallengesOther,
    client_outcomes: normalizedUserdata.clientOutcomes,
    client_outcomes_other: normalizedUserdata.clientOutcomesOther,
    ideal_client: normalizedUserdata.idealClient
  };

  const repairedPayload = { metadata: repairedMetadata, userdata: repairedUserdata };

  // Validate repaired payload has minimum required structure
  if (!repairedPayload.metadata.business_name || !repairedPayload.metadata.businessDomain) {
    return { ok: false, payload: null, errors: ["Cannot repair: missing business_name or businessDomain"] };
  }

  return { ok: true, payload: repairedPayload, errors: [] };
}

export function validateExpressAdminIntakePayload(payload) {
  const errors = [];
  const md = payload?.metadata || {};
  const ud = payload?.userdata || {};

  // Required metadata fields
  if (!String(md.business_name || "").trim()) errors.push("metadata.business_name is required");
  if (!String(md.businessDomain || "").trim()) errors.push("metadata.businessDomain is required");
  if (md.service_type !== "express") errors.push("metadata.service_type must be 'express'");

  // Required userdata fields for Express recovery
  if (!Array.isArray(ud.service_offerings) || ud.service_offerings.length === 0) {
    errors.push("userdata.service_offerings must be a non-empty array");
  }
  if (!String(ud.differentiation || "").trim()) errors.push("userdata.differentiation is required");
  if (!String(ud.geographic_areas || "").trim()) errors.push("userdata.geographic_areas is required");
  if (!String(ud.ideal_client || "").trim()) errors.push("userdata.ideal_client is required");

  // Normalize array fields
  if (!Array.isArray(ud.it_company_type)) errors.push("userdata.it_company_type must be an array");
  if (!Array.isArray(ud.target_industries)) errors.push("userdata.target_industries must be an array");
  if (!Array.isArray(ud.client_challenges)) errors.push("userdata.client_challenges must be an array");
  if (!Array.isArray(ud.client_outcomes)) errors.push("userdata.client_outcomes must be an array");

  return { ok: errors.length === 0, errors };
}