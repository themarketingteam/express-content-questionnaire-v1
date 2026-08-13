/**
 * Express Question Validation Status Helpers
 * 
 * Calculates display status for each questionnaire question by combining:
 * - Required-field completion status
 * - Touched state
 * - Text validation status (for questions 3 and 12)
 */

// Status constants
export const QUESTION_STATUS = {
  not_started: 'not_started',
  in_progress: 'in_progress',
  complete: 'complete',
  needs_attention: 'needs_attention',
  needs_validation: 'needs_validation',
  validating: 'validating',
  dirty: 'dirty',
  error: 'error',
};

// Status label mapping
export const STATUS_LABELS = {
  [QUESTION_STATUS.not_started]: 'Not started',
  [QUESTION_STATUS.in_progress]: 'In progress',
  [QUESTION_STATUS.complete]: 'Complete',
  [QUESTION_STATUS.needs_attention]: 'Needs attention',
  [QUESTION_STATUS.needs_validation]: 'Needs validation',
  [QUESTION_STATUS.validating]: 'Validating',
  [QUESTION_STATUS.dirty]: 'Edited since validation',
  [QUESTION_STATUS.error]: 'Validation unavailable',
};

// Status tone mapping
export const STATUS_TONES = {
  [QUESTION_STATUS.not_started]: 'slate',
  [QUESTION_STATUS.in_progress]: 'blue',
  [QUESTION_STATUS.complete]: 'green',
  [QUESTION_STATUS.needs_attention]: 'amber',
  [QUESTION_STATUS.needs_validation]: 'amber',
  [QUESTION_STATUS.validating]: 'blue',
  [QUESTION_STATUS.dirty]: 'amber',
  [QUESTION_STATUS.error]: 'red',
};

/**
 * Get human-readable label for status
 */
export function getQuestionStatusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS[QUESTION_STATUS.not_started];
}

/**
 * Get tone name for status (for Tailwind color classes)
 */
export function getQuestionStatusTone(status) {
  return STATUS_TONES[status] || STATUS_TONES[QUESTION_STATUS.not_started];
}

/**
 * Normalize unknown status values to valid status
 */
export function normalizeQuestionStatus(status) {
  if (Object.values(QUESTION_STATUS).includes(status)) {
    return status;
  }
  return QUESTION_STATUS.not_started;
}

// Map question IDs to their form fields
export const EXPRESS_QUESTION_FIELD_MAP = {
  "1": ["itCompanyType", "itCompanyTypeOther"],
  "2": ["serviceOfferings", "serviceOfferingsOther"],
  "3": ["differentiation"],
  "4": ["geographicAreas", "geographicAreaMeta"],
  "5": ["pricingPackaging", "pricingPackagingOther"],
  "6": ["companyGoals", "companyGoalsOther"],
  "7": ["brandTone", "brandToneOther"],
  "8": ["targetIndustries", "targetIndustriesOther"],
  "9": ["clientSize"],
  "10": ["clientChallenges", "clientChallengesOther"],
  "11": ["clientOutcomes", "clientOutcomesOther"],
  "12": ["idealClient"],
};

/**
 * Check if a question has been touched
 */
export function getQuestionTouched(questionId, touchedQuestions) {
  if (!touchedQuestions) return false;
  return !!touchedQuestions[questionId];
}

/**
 * Check if a value has meaningful content
 */
export function hasMeaningfulValue(value) {
  // Arrays: check length
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  
  // Strings: check trimmed length
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  
  // Objects: check for geographic meta or other meaningful structure
  if (value && typeof value === 'object') {
    // Geographic meta with label
    if (value.label) {
      return value.label.trim().length > 0;
    }
    // Other objects: check if any non-empty string value exists
    return Object.values(value).some(v => 
      (typeof v === 'string' && v.trim().length > 0) ||
      (Array.isArray(v) && v.length > 0)
    );
  }
  
  // Other types: treat as not meaningful
  return false;
}

/**
 * Get basic completion status for a question (before validation overlay)
 */
export function getBasicQuestionCompletionStatus({ 
  questionId,
  formData, 
  touchedQuestions,
  isQuestionComplete 
}) {
  // Check if question is complete using existing logic
  if (isQuestionComplete && isQuestionComplete(Number(questionId))) {
    return QUESTION_STATUS.complete;
  }
  
  const isTouched = getQuestionTouched(questionId, touchedQuestions);
  const fields = EXPRESS_QUESTION_FIELD_MAP[questionId] || [];
  
  // Check if any field has meaningful value
  const hasValue = fields.some(field => {
    const value = formData?.[field];
    return hasMeaningfulValue(value);
  });
  
  if (isTouched && hasValue) {
    return QUESTION_STATUS.in_progress;
  }
  
  if (isTouched && !hasValue) {
    return QUESTION_STATUS.needs_attention;
  }
  
  return QUESTION_STATUS.not_started;
}

/**
 * Get text validation status for a question
 */
export function getTextValidationQuestionStatus({ 
  questionId: _questionId,
  fieldName, 
  validationStatus,
  isValidating 
}) {
  // Check if currently validating
  if (isValidating && isValidating(fieldName)) {
    return QUESTION_STATUS.validating;
  }
  
  // Get validation status for field
  const fieldStatus = validationStatus?.[fieldName];
  
  if (!fieldStatus || !fieldStatus.status) {
    return QUESTION_STATUS.needs_validation;
  }
  
  const status = fieldStatus.status;
  
  // Map validation status to question status
  if (status === 'complete') {
    return QUESTION_STATUS.complete;
  }
  
  if (status === 'needs_work') {
    return QUESTION_STATUS.needs_attention;
  }
  
  if (status === 'incomplete') {
    return QUESTION_STATUS.needs_attention;
  }
  
  if (status === 'dirty') {
    return QUESTION_STATUS.dirty;
  }
  
  if (status === 'error') {
    return QUESTION_STATUS.error;
  }
  
  return QUESTION_STATUS.needs_validation;
}

/**
 * Check if a field is currently validating (supports both array and object shapes)
 */
function isFieldCurrentlyValidating(validatingFields, fieldName) {
  if (Array.isArray(validatingFields)) {
    return validatingFields.includes(fieldName);
  }
  if (validatingFields && typeof validatingFields === "object") {
    return Boolean(validatingFields[fieldName]);
  }
  return false;
}

/**
 * Get final display status for an Express question
 * 
 * Combines base completion status with text validation status for questions 3 and 12
 */
export function getExpressQuestionDisplayStatus({ 
  questionId, 
  formData, 
  touchedQuestions, 
  validationStatus, 
  validatingFields,
  isQuestionComplete 
}) {
  // Get base completion status
  const baseStatus = getBasicQuestionCompletionStatus({
    questionId,
    formData,
    touchedQuestions,
    isQuestionComplete,
  });
  
  // Questions 3 and 12 have text validation overlay
  const textValidationFields = {
    "3": "differentiation",
    "12": "idealClient",
  };
  
  const textField = textValidationFields[questionId];
  
  // If not a text validation question, return base status
  if (!textField) {
    return baseStatus;
  }
  
  // If base status is not complete, return base status
  if (baseStatus !== QUESTION_STATUS.complete) {
    return baseStatus;
  }
  
  // Base is complete, check text validation status
  const isValidating = (fieldName) => {
    return isFieldCurrentlyValidating(validatingFields, fieldName);
  };
  
  const validationQuestionStatus = getTextValidationQuestionStatus({
    questionId,
    fieldName: textField,
    validationStatus,
    isValidating,
  });
  
  // Validation is an optional quality check. Once a required text answer is
  // non-empty, validation feedback must not make the question incomplete or
  // reduce progress. Keep only the transient validating indicator.
  if (validationQuestionStatus === QUESTION_STATUS.validating) {
    return QUESTION_STATUS.validating;
  }

  return QUESTION_STATUS.complete;
}
