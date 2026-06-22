import {
  normalizeExpressFormData,
  normalizeValidationStatus,
  normalizeTouchedQuestions,
  normalizeExpandedQuestions,
} from "@/lib/expressPersistedState";

// Allowed client size values from Express questionnaire
const ALLOWED_CLIENT_SIZE_VALUES = [
  "1-50 employees",
  "51-200 employees",
  "201-500 employees",
  "500+ employees",
];

// Known response fields (from expressQuestionnairePayload.js)
const KNOWN_RESPONSE_FIELDS = [
  "itCompanyType",
  "itCompanyTypeOther",
  "serviceOfferings",
  "serviceOfferingsOther",
  "differentiation",
  "geographicAreas",
  "geographicAreaMeta",
  "pricingPackaging",
  "pricingPackagingOther",
  "companyGoals",
  "companyGoalsOther",
  "brandTone",
  "brandToneOther",
  "targetIndustries",
  "targetIndustriesOther",
  "clientSize",
  "clientChallenges",
  "clientChallengesOther",
  "clientOutcomes",
  "clientOutcomesOther",
  "idealClient",
];

/**
 * Validates and repairs questionnaire state to prevent rendering/persistence failures.
 * Returns normalized safe state with list of repairs and warnings.
 * 
 * @param {Object} params
 * @param {Object} params.formData - Raw form data
 * @param {Object} params.validationStatus - Raw validation status map
 * @param {Object} params.touchedQuestions - Raw touched questions map
 * @param {Object} params.expandedQuestions - Raw expanded questions map
 * @returns {Object} Validated and repaired state
 */
export function validateAndRepairQuestionnaireState({
  formData = {},
  validationStatus = {},
  touchedQuestions = {},
  expandedQuestions = {},
} = {}) {
  const repairs = [];
  const warnings = [];
  let changed = false;

  // Safety check: ensure inputs are objects
  if (typeof formData !== "object" || formData === null) {
    formData = {};
    repairs.push("Form data was not an object, reset to empty object");
    changed = true;
  }

  if (typeof validationStatus !== "object" || validationStatus === null) {
    validationStatus = {};
    repairs.push("Validation status was not an object, reset to empty object");
    changed = true;
  }

  if (typeof touchedQuestions !== "object" || touchedQuestions === null) {
    touchedQuestions = {};
    repairs.push("Touched questions was not an object, reset to empty object");
    changed = true;
  }

  if (typeof expandedQuestions !== "object" || expandedQuestions === null) {
    expandedQuestions = {};
    repairs.push("Expanded questions was not an object, reset to empty object");
    changed = true;
  }

  // Store original state for comparison
  const originalFormData = JSON.stringify(formData);
  const originalValidationStatus = JSON.stringify(validationStatus);
  const originalTouchedQuestions = JSON.stringify(touchedQuestions);
  const originalExpandedQuestions = JSON.stringify(expandedQuestions);

  // Step 1: Normalize form data using existing helper
  let normalizedFormData = normalizeExpressFormData(formData);
  
  // Step 2: Remove unknown/stale fields
  const cleanedFormData = {};
  for (const field of KNOWN_RESPONSE_FIELDS) {
    if (normalizedFormData.hasOwnProperty(field)) {
      cleanedFormData[field] = normalizedFormData[field];
    }
  }
  
  // Check if we removed unknown fields
  const originalFieldCount = Object.keys(normalizedFormData).length;
  const cleanedFieldCount = Object.keys(cleanedFormData).length;
  if (originalFieldCount !== cleanedFieldCount) {
    repairs.push(`Removed ${originalFieldCount - cleanedFieldCount} unknown response fields`);
    changed = true;
  }
  
  normalizedFormData = cleanedFormData;

  // Step 3: Repair clientSize if missing or invalid
  if (!normalizedFormData.clientSize || !ALLOWED_CLIENT_SIZE_VALUES.includes(normalizedFormData.clientSize)) {
    const oldValue = normalizedFormData.clientSize;
    normalizedFormData.clientSize = "1-50 employees";
    repairs.push(`Repaired invalid clientSize "${oldValue || "missing"}" to default "1-50 employees"`);
    changed = true;
  }

  // Step 4: Repair geographic area/meta synchronization
  const geoArea = normalizedFormData.geographicAreas || "";
  const geoMeta = normalizedFormData.geographicAreaMeta || {};
  const metaLabel = geoMeta?.label || "";

  // If meta has label but geographicAreas is empty, sync it
  if (metaLabel && !geoArea) {
    normalizedFormData.geographicAreas = metaLabel;
    repairs.push("Synced geographicAreas from geographicAreaMeta.label");
    changed = true;
  }

  // If geographicAreas has value but meta label is empty, create minimal manual metadata
  // (never fake Google metadata — only real Google selections get source: "google")
  if (geoArea && !metaLabel) {
    normalizedFormData.geographicAreaMeta = {
      label: geoArea,
      lat: geoMeta?.lat || null,
      lon: geoMeta?.lon || null,
      place_id: geoMeta?.place_id || null,
      source: "manual",
    };
    repairs.push("Synced geographicAreaMeta from geographicAreas (manual)");
    changed = true;
  }

  // Step 5: Repair arrays saved as strings
  const arrayFields = [
    "itCompanyType",
    "serviceOfferings",
    "targetIndustries",
    "clientChallenges",
    "clientOutcomes",
  ];
  
  for (const field of arrayFields) {
    const value = normalizedFormData[field];
    if (typeof value === "string") {
      // Try to parse as JSON array first
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          normalizedFormData[field] = parsed;
          repairs.push(`Converted stringified array to array for ${field}`);
          changed = true;
        } else {
          // Single string value, wrap in array
          normalizedFormData[field] = [value];
          repairs.push(`Wrapped string value in array for ${field}`);
          changed = true;
        }
      } catch {
        // Not valid JSON, wrap in array
        normalizedFormData[field] = [value];
        repairs.push(`Wrapped string value in array for ${field}`);
        changed = true;
      }
    } else if (Array.isArray(value)) {
      // Remove empty values from arrays
      const filteredValue = value.filter(v => v !== "" && v !== null && v !== undefined);
      if (filteredValue.length !== value.length) {
        normalizedFormData[field] = filteredValue;
        repairs.push(`Removed empty values from ${field} array`);
        changed = true;
      }
    }
  }

  // Step 6: Repair strings saved as arrays
  const stringFields = [
    "itCompanyTypeOther",
    "serviceOfferingsOther",
    "differentiation",
    "geographicAreas",
    "pricingPackaging",
    "pricingPackagingOther",
    "companyGoals",
    "companyGoalsOther",
    "brandTone",
    "brandToneOther",
    "targetIndustriesOther",
    "clientSize",
    "clientChallengesOther",
    "clientOutcomesOther",
    "idealClient",
  ];
  
  for (const field of stringFields) {
    const value = normalizedFormData[field];
    if (Array.isArray(value)) {
      // Convert array to string (join if multiple, take first if single)
      normalizedFormData[field] = value.join(", ");
      repairs.push(`Converted array to string for ${field}`);
      changed = true;
    }
  }

  // Guard: preserve exact whitespace in string fields during live typing.
  // If the only difference between original and normalized is whitespace,
  // restore the original value to prevent the validator from eating spaces.
  const LIVE_STRING_FIELDS = [
    "itCompanyTypeOther", "serviceOfferingsOther", "differentiation",
    "geographicAreas", "pricingPackaging", "pricingPackagingOther",
    "companyGoals", "companyGoalsOther", "brandTone", "brandToneOther",
    "targetIndustriesOther", "clientSize", "clientChallengesOther",
    "clientOutcomesOther", "idealClient"
  ];
  for (const field of LIVE_STRING_FIELDS) {
    const orig = formData[field];
    const norm = normalizedFormData[field];
    if (typeof orig === "string" && typeof norm === "string" && orig !== norm && orig.trim() === norm.trim()) {
      normalizedFormData[field] = orig;
    }
  }

  // Step 7: Normalize validation status
  let normalizedValidationStatus = normalizeValidationStatus(validationStatus);
  if (JSON.stringify(normalizedValidationStatus) !== originalValidationStatus) {
    repairs.push("Repaired validation status");
    changed = true;
  }
  validationStatus = normalizedValidationStatus;

  // Step 8: Normalize touched questions
  let normalizedTouchedQuestions = normalizeTouchedQuestions(touchedQuestions);
  if (JSON.stringify(normalizedTouchedQuestions) !== originalTouchedQuestions) {
    repairs.push("Repaired touched questions map");
    changed = true;
  }
  touchedQuestions = normalizedTouchedQuestions;

  // Step 9: Normalize expanded questions
  let normalizedExpandedQuestions = normalizeExpandedQuestions(expandedQuestions);
  if (JSON.stringify(normalizedExpandedQuestions) !== originalExpandedQuestions) {
    repairs.push("Repaired expanded question state");
    changed = true;
  }
  expandedQuestions = normalizedExpandedQuestions;

  // Final comparison for form data
  if (JSON.stringify(normalizedFormData) !== originalFormData) {
    if (!repairs.includes("Normalized form data fields")) {
      repairs.push("Normalized form data fields");
    }
    changed = true;
  }

  return {
    formData: normalizedFormData,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    changed,
    repairs,
    warnings,
  };
}

/**
 * Returns a short summary of validation/repair results.
 * 
 * @param {Object} result - Result from validateAndRepairQuestionnaireState
 * @returns {string} Human-readable summary
 */
export function getSelfHealingSummary(result) {
  if (!result || !result.repairs || result.repairs.length === 0) {
    return "Questionnaire state is valid.";
  }
  
  const count = result.repairs.length;
  return `${count} questionnaire state repair${count === 1 ? "" : "s"} applied.`;
}

/**
 * Determines if repaired state should be persisted.
 * 
 * @param {Object} result - Result from validateAndRepairQuestionnaireState
 * @returns {boolean} True if state was changed and should be saved
 */
export function shouldPersistRepairedState(result) {
  return result?.changed === true;
}