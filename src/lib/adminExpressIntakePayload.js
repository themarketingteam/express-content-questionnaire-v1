const normalizeDomain = (raw = "") =>
  raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").trim();

const toArray = (val) => {
  if (Array.isArray(val)) return val;
  if (val && typeof val === "string" && val.trim()) return [val.trim()];
  return [];
};

export const initialExpressAdminIntakePayload = {
  metadata: {
    business_name: "Example MSP",
    businessDomain: "example.com",
    submission_datetime: new Date().toISOString(),
    service_type: "express",
    questionnaire_session_id: "",
  },
  userdata: {
    it_company_type: ["Managed Services Provider (MSP)"],
    it_company_type_other: "",
    service_offerings: ["Managed IT", "Cybersecurity Services", "Microsoft 365"],
    service_offerings_other: "",
    differentiation: "Example short differentiation answer.",
    geographic_areas: "Nashville, Tennessee",
    geographic_area_meta: {
      label: "Nashville, TN, USA",
      lat: null,
      lon: null,
      place_id: null,
      source: "manual",
    },
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
    ideal_client: "A growing business that needs reliable IT support.",
  },
};

export const repairExpressAdminIntakePayload = (payload) => {
  const errors = [];
  const p = { ...payload };

  // Ensure top-level sections exist
  const metadata = { ...(p.metadata || {}) };
  const userdata = { ...(p.userdata || {}) };

  // Clean domain
  if (metadata.businessDomain) {
    metadata.businessDomain = normalizeDomain(metadata.businessDomain);
  }

  // Ensure service_type
  metadata.service_type = "express";

  // Ensure submission_datetime
  if (!metadata.submission_datetime) {
    metadata.submission_datetime = new Date().toISOString();
  }

  // Normalize array fields
  userdata.it_company_type = toArray(userdata.it_company_type);
  userdata.service_offerings = toArray(userdata.service_offerings);
  userdata.target_industries = toArray(userdata.target_industries);
  userdata.client_challenges = toArray(userdata.client_challenges);
  userdata.client_outcomes = toArray(userdata.client_outcomes);

  // company_goals can be string or array — leave as-is
  // geographic_area_meta — ensure exists
  if (!userdata.geographic_area_meta || typeof userdata.geographic_area_meta !== "object") {
    userdata.geographic_area_meta = {
      label: userdata.geographic_areas || "",
      lat: null,
      lon: null,
      place_id: null,
      source: "manual",
    };
  }

  // Collect errors for required fields
  if (!metadata.business_name?.trim()) errors.push("metadata.business_name is required");
  if (!metadata.businessDomain?.trim()) errors.push("metadata.businessDomain is required");
  if (!userdata.service_offerings?.length) errors.push("userdata.service_offerings is required");
  if (!userdata.differentiation?.trim()) errors.push("userdata.differentiation is required");
  if (!userdata.geographic_areas?.trim()) errors.push("userdata.geographic_areas is required");
  if (!userdata.ideal_client?.trim()) errors.push("userdata.ideal_client is required");

  return {
    ok: errors.length === 0,
    payload: { metadata, userdata },
    errors,
  };
};

export const validateExpressAdminIntakePayload = (payload) => {
  const errors = [];
  const metadata = payload?.metadata || {};
  const userdata = payload?.userdata || {};

  if (!metadata.business_name?.trim()) errors.push("Business name is required");
  if (!metadata.businessDomain?.trim()) errors.push("Business domain is required");
  if (!userdata.service_offerings?.length) errors.push("At least one service offering is required");
  if (!userdata.differentiation?.trim()) errors.push("Differentiation is required");
  if (!userdata.geographic_areas?.trim()) errors.push("Geographic area is required");
  if (!userdata.ideal_client?.trim()) errors.push("Ideal client description is required");

  return { ok: errors.length === 0, errors };
};