/**
 * Express Questionnaire Payload Builder
 * Builds the structured submission payload from raw Express form responses.
 */

export function safeJsonStringify(value) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

export function serializeExpressError(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify({
      message: error.message || String(error),
      name: error.name || "",
      stack: error.stack || "",
    });
  } catch {
    return String(error);
  }
}

/**
 * Builds the Express submission payload (metadata + userdata) from raw form responses.
 * Mirrors the shape used by the Zapier webhook and FormSubmission entity.
 */
export function buildExpressSubmissionPayload({ formData = {}, businessName = "", domain = "", sessionId = "" }) {
  const cleanDomain = (raw) =>
    (raw || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").trim();

  return {
    metadata: {
      business_name: businessName,
      businessDomain: cleanDomain(domain),
      submission_datetime: new Date().toISOString(),
      service_type: "express",
      session_id: sessionId,
    },
    userdata: {
      it_company_type: formData.itCompanyType || [],
      it_company_type_other: formData.itCompanyTypeOther || "",
      service_offerings: formData.serviceOfferings || [],
      service_offerings_other: formData.serviceOfferingsOther || "",
      differentiation: formData.differentiation || "",
      geographic_areas: formData.geographicAreaMeta?.label || formData.geographicAreas || "",
      geographic_area_meta: formData.geographicAreaMeta || {},
      pricing_packaging: formData.pricingPackaging || "",
      pricing_packaging_other: formData.pricingPackagingOther || "",
      company_goals: formData.companyGoals || "",
      company_goals_other: formData.companyGoalsOther || "",
      brand_tone: formData.brandTone || "",
      brand_tone_other: formData.brandToneOther || "",
      target_industries: formData.targetIndustries || [],
      target_industries_other: formData.targetIndustriesOther || "",
      client_size: formData.clientSize || "",
      client_challenges: formData.clientChallenges || [],
      client_challenges_other: formData.clientChallengesOther || "",
      client_outcomes: formData.clientOutcomes || [],
      client_outcomes_other: formData.clientOutcomesOther || "",
      ideal_client: formData.idealClient || "",
    },
  };
}