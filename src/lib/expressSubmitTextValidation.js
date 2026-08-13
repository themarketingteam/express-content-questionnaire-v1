/**
 * Submit-time text validation utility for Express questionnaire
 * Determines which free-text answers must be revalidated before final submission
 */

import {
  EXPRESS_TEXT_VALIDATION_FIELDS,
  createValidationUnavailableResult,
  validateExpressTextAnswer,
} from "./expressTextValidation.js";

/**
 * Create a simple stable hash for answer comparison
 * Uses normalized string + simple hash for local state only
 * @param {string} answer - The answer text
 * @returns {string} Hash string
 */
export function createAnswerHash(answer) {
  const normalized = (answer || "").toString().trim().toLowerCase();
  
  // Simple non-cryptographic hash (djb2 algorithm)
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return `hash_${Math.abs(hash).toString(16)}`;
}

/**
 * Statuses that block submission
 */
export const TEXT_SUBMIT_BLOCKING_STATUSES = new Set([
  "empty_required",
]);

/**
 * Statuses that show warnings but don't block (unless configured to)
 */
export const TEXT_SUBMIT_WARNING_STATUSES = new Set([
  "needs_work",
  "incomplete",
  "error",
  "dirty",
  "unknown",
]);

/**
 * Get the main Express text fields that require submit-time validation
 * @returns {string[]} Array of field names
 */
export function getSubmitTextValidationFields() {
  return ["differentiation", "idealClient"];
}



/**
 * Check if validation status is fresh enough for submission
 * @param {object} statusRecord - Validation status record
 * @param {string} currentAnswer - Current answer text
 * @returns {boolean} True if validation is fresh
 */
export function isValidationFresh(statusRecord, currentAnswer) {
  // No status record = not fresh
  if (!statusRecord) {
    return false;
  }
  
  // Dirty status = not fresh
  if (statusRecord.status === "dirty") {
    return false;
  }
  
  // Unknown or unavailable status = not fresh
  if (statusRecord.status === "unknown" || statusRecord.status === "error") {
    return false;
  }
  
  // No validatedAt = not fresh
  if (!statusRecord.validatedAt) {
    return false;
  }
  
  // Check if answer hash matches (if stored)
  if (statusRecord.answerHash) {
    const currentHash = createAnswerHash(currentAnswer);
    if (statusRecord.answerHash !== currentHash) {
      return false;
    }
  }
  
  // Check if status is older than 24 hours
  const validatedAt = new Date(statusRecord.validatedAt);
  const now = new Date();
  const hoursSinceValidation = (now.getTime() - validatedAt.getTime()) / (1000 * 60 * 60);
  
  if (hoursSinceValidation > 24) {
    return false;
  }
  
  return true;
}

/**
 * Collect fields that need validation before submission
 * @param {object} params
 * @param {object} params.formData - Current form data
 * @param {object} params.validationStatus - Current validation status map
 * @returns {object} { fieldsToValidate: [...], freshStatuses: [...] }
 */
export function collectTextFieldsNeedingSubmitValidation({ formData, validationStatus }) {
  const fieldsToValidate = [];
  const freshStatuses = [];
  const emptyRequiredFields = [];
  const validationFields = getSubmitTextValidationFields();
  
  for (const fieldName of validationFields) {
    const answer = formData[fieldName];
    const statusRecord = validationStatus?.[fieldName];
    
    // These two text answers are required by the questionnaire itself. AI
    // validation is optional, but a genuinely empty required answer is not.
    if (!answer || (typeof answer === "string" && answer.trim().length === 0)) {
      emptyRequiredFields.push({ fieldName, answer: answer || "" });
      continue;
    }
    
    // Check if validation is fresh
    const fresh = isValidationFresh(statusRecord, answer);
    
    if (fresh) {
      freshStatuses.push({
        fieldName,
        status: statusRecord.status,
        validatedAt: statusRecord.validatedAt,
      });
      continue;
    }
    
    // Determine reason why validation is needed
    let reason = "validation_required";
    
    if (!statusRecord) {
      reason = "no_status";
    } else if (statusRecord.status === "dirty") {
      reason = "edited_after_validation";
    } else if (statusRecord.status === "unknown") {
      reason = "unknown_status";
    } else if (statusRecord.status === "error") {
      reason = "previous_error";
    } else if (statusRecord.answerHash && statusRecord.answerHash !== createAnswerHash(answer)) {
      reason = "answer_changed";
    } else if (statusRecord.validatedAt) {
      const validatedAt = new Date(statusRecord.validatedAt);
      const now = new Date();
      const hoursSinceValidation = (now.getTime() - validatedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceValidation > 24) {
        reason = "validation_expired";
      }
    }
    
    fieldsToValidate.push({
      fieldName,
      answer,
      questionId: EXPRESS_TEXT_VALIDATION_FIELDS[fieldName]?.questionId,
      reason,
    });
  }
  
  return {
    fieldsToValidate,
    freshStatuses,
    emptyRequiredFields,
  };
}

/**
 * Run submit-time text validation for all fields needing validation
 * @param {object} params
 * @param {object} params.formData - Current form data
 * @param {object} params.validationStatus - Current validation status map
 * @param {string} params.businessName - Business name for context
 * @param {string} params.domain - Business domain for context
 * @param {function} params.onFieldResult - Callback: (fieldName, result) => void
 * @param {function} [params.validateAnswer] - Injectable validator used by automated tests
 * @returns {Promise<object>} { ok, blockingIssues, warnings, resultsByField }
 */
export async function runSubmitTextValidation({
  formData,
  validationStatus,
  businessName,
  domain,
  onFieldResult,
  validateAnswer = validateExpressTextAnswer,
}) {
  const { fieldsToValidate, freshStatuses, emptyRequiredFields } = collectTextFieldsNeedingSubmitValidation({
    formData,
    validationStatus,
  });
  
  const blockingIssues = [];
  const warnings = [];
  const resultsByField = {};

  for (const field of emptyRequiredFields) {
    blockingIssues.push({
      fieldName: field.fieldName,
      status: "empty_required",
      message: "This required answer cannot be empty.",
      suggestions: ["Please provide a response before submitting."],
    });
  }
  
  // Add fresh statuses to results
  for (const fresh of freshStatuses) {
    resultsByField[fresh.fieldName] = {
      status: fresh.status,
      validatedAt: fresh.validatedAt,
      source: "cached",
    };
  }
  
  // Validate each field that needs validation
  for (const field of fieldsToValidate) {
    const { fieldName, answer, questionId } = field;
    
    try {
      const result = await validateAnswer({
        answer,
        fieldName,
        businessName,
        domain,
        context: { questionId },
      });
      
      // Store result
      resultsByField[fieldName] = {
        ...result,
        source: "live",
      };
      
      // Callback for UI updates
      if (onFieldResult) {
        onFieldResult(fieldName, result);
      }
      
      // Categorize result
      if (result.status === "incomplete") {
        warnings.push({
          fieldName,
          status: result.status,
          message: result.message,
          suggestions: result.suggestions,
          kind: "optional_validation_feedback",
        });
      } else if (result.status === "error") {
        warnings.push({
          fieldName,
          status: result.status,
          message: result.message || "Validation is temporarily unavailable. Your answer is saved, and you can continue.",
          suggestions: [],
          kind: "validation_unavailable",
        });
      } else if (result.status === "needs_work") {
        warnings.push({
          fieldName,
          status: result.status,
          message: result.message,
          suggestions: result.suggestions,
          kind: "optional_validation_feedback",
        });
      }
      // "complete" passes without issues
    } catch {
      const unavailableResult = createValidationUnavailableResult({
        fieldName,
        questionId,
        answer,
      });
      resultsByField[fieldName] = {
        ...unavailableResult,
        source: "live",
      };
      if (onFieldResult) {
        onFieldResult(fieldName, unavailableResult);
      }
      warnings.push({
        fieldName,
        status: "error",
        message: unavailableResult.message,
        suggestions: [],
        kind: "validation_unavailable",
      });
    }
  }
  
  return {
    ok: blockingIssues.length === 0,
    blockingIssues,
    warnings,
    resultsByField,
  };
}
