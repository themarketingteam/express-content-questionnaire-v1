// Shared by the browser and backend. Return field names only: answer values
// must never become diagnostic messages or telemetry.
const ANSWER_FIELDS = [
  ["itCompanyType", "it_company_type", "array"],
  ["itCompanyTypeOther", "it_company_type_other", "string"],
  ["serviceOfferings", "service_offerings", "array"],
  ["serviceOfferingsOther", "service_offerings_other", "string"],
  ["differentiation", "differentiation", "string"],
  ["geographicAreas", "geographic_areas", "string"],
  ["geographicAreaMeta", "geographic_area_meta", "geo"],
  ["pricingPackaging", "pricing_packaging", "string"],
  ["pricingPackagingOther", "pricing_packaging_other", "string"],
  ["companyGoals", "company_goals", "string"],
  ["companyGoalsOther", "company_goals_other", "string"],
  ["brandTone", "brand_tone", "string"],
  ["brandToneOther", "brand_tone_other", "string"],
  ["targetIndustries", "target_industries", "array"],
  ["targetIndustriesOther", "target_industries_other", "string"],
  ["clientSize", "client_size", "string"],
  ["clientChallenges", "client_challenges", "array"],
  ["clientChallengesOther", "client_challenges_other", "string"],
  ["clientOutcomes", "client_outcomes", "array"],
  ["clientOutcomesOther", "client_outcomes_other", "string"],
  ["idealClient", "ideal_client", "string"],
];

/** @returns {value is Record<string, any>} */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBlank(value) {
  return value === null || value === undefined
    || (typeof value === "string" && !value.trim())
    || (Array.isArray(value) && value.length === 0)
    || (isObject(value) && Object.keys(value).length === 0);
}

function normalizeSource(value, kind) {
  if (isBlank(value)) return { value: kind === "array" ? [] : (kind === "geo" ? {} : ""), valid: true };
  if (kind === "geo") {
    if (!isObject(value)) return { value: {}, valid: false };
    const geo = {};
    for (const key of ["label", "place_id", "source"]) {
      if (typeof value[key] === "string" && value[key].trim()) geo[key] = value[key].trim();
    }
    for (const key of ["lat", "lon"]) {
      if (typeof value[key] === "number" && Number.isFinite(value[key])) geo[key] = value[key];
    }
    return { value: geo, valid: true };
  }
  if (kind === "array") {
    if (Array.isArray(value)) {
      const values = value.filter(Boolean);
      return { value: values, valid: values.every((item) => typeof item === "string") };
    }
    if (typeof value === "string") return { value: [value.trim()], valid: true };
    if (isObject(value) && typeof value.label === "string") return { value: [value.label], valid: true };
    return { value: [], valid: false };
  }
  if (typeof value === "string") return { value: value.trim(), valid: true };
  if (Array.isArray(value)) {
    return { value: value.join(", "), valid: value.every((item) => typeof item === "string") };
  }
  if (isObject(value) && typeof value.label === "string") return { value: value.label, valid: true };
  return { value: "", valid: false };
}

function equalValue(expected, actual) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length
      && expected.every((value, index) => equalValue(value, actual[index]));
  }
  if (isObject(expected)) {
    return isObject(actual) && Object.entries(expected).every(([key, value]) => equalValue(value, actual[key]));
  }
  return expected === actual;
}

/**
 * Verify every populated captured answer is represented in the final payload.
 * This is preservation validation, not required-field/answer-quality validation.
 * A missing raw snapshot cannot establish preservation and fails explicitly.
 * @param {unknown} rawResponses
 * @param {unknown} payload
 * @returns {{ok: boolean, available: boolean, reason: string, mismatchedFields: string[], checkedFields: string[]}}
 */
export function inspectExpressSubmissionIntegrity(rawResponses, payload) {
  const result = { ok: false, available: false, reason: "raw_snapshot_unavailable", mismatchedFields: [], checkedFields: [] };
  if (!isObject(rawResponses)) return result;
  const fields = ANSWER_FIELDS.filter(([rawField]) => Object.hasOwn(rawResponses, rawField));
  if (fields.length === 0) return result;
  result.available = true;
  const userdata = isObject(payload) && isObject(payload.userdata) ? payload.userdata : {};
  const geo = normalizeSource(rawResponses.geographicAreaMeta, "geo").value;
  for (const [rawField, payloadField, kind] of fields) {
    let expected = normalizeSource(rawResponses[rawField], kind);
    if (rawField === "geographicAreas" && isObject(geo) && geo.source === "google" && geo.place_id && geo.label) {
      expected = { value: geo.label, valid: true };
    }
    // An intentionally blank answer is not a lost answer. Required-question
    // validation is a separate responsibility of the questionnaire.
    if (expected.valid && isBlank(expected.value)) continue;
    const path = `userdata.${payloadField}`;
    result.checkedFields.push(path);
    if (!expected.valid || !equalValue(expected.value, userdata[payloadField])) result.mismatchedFields.push(path);
  }
  result.ok = result.mismatchedFields.length === 0;
  result.reason = result.ok ? "preserved" : "answer_mismatch";
  return result;
}
