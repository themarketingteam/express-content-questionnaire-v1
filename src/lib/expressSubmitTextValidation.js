/**
 * Submit-time text validation utility for Express questionnaire
 * Determines which free-text answers must be revalidated before final submission
 */

import {
  EXPRESS_TEXT_VALIDATION_FIELDS,
  validateExpressTextAnswer,
  runLocalExpressTextValidation,
} from "@/lib/expressTextValidation";

/**
 * Statuses that block submission
 */
export const TEXT_SUBMIT_BLOCKING_STATUSES = new Set([
  "incomplete",
  "error",
]);

/**
 * Statuses that show warnings but don't block (unless configured to)
 */
export const TEXT_SUBMIT_WARNING_STATUSES = new Set([
  "needs_work",
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
  
  // Unknown status = not fresh
  if (statusRecord.status === "unknown") {
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
  const hoursSinceValidation = (now - validatedAt) / (1000 * 60 * 60);
  
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
  const validationFields = getSubmitTextValidationFields();
  
  for (const fieldName of validationFields) {
    const answer = formData[fieldName];
    const statusRecord = validationStatus?.[fieldName];
    
    // Skip empty optional fields
    if (!answer || (typeof answer === "string" && answer.trim().length === 0)) {
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
      const hoursSinceValidation = (now - validatedAt) / (1000 * 60 * 60);
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
 * @returns {object} { ok, blockingIssues, warnings, resultsByField }
 */
export async function runSubmitTextValidation({
  formData,
  validationStatus,
  businessName,
  domain,
  onFieldResult,
}) {
  const { fieldsToValidate, freshStatuses } = collectTextFieldsNeedingSubmitValidation({
    formData,
    validationStatus,
  });
  
  const blockingIssues = [];
  const warnings = [];
  const resultsByField = {};
  
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
      const result = await validateExpressTextAnswer({
        answer,
        fieldName,
        businessName,
        domain,
        questionId,
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
        blockingIssues.push({
          fieldName,
          status: result.status,
          message: result.message,
          suggestions: result.suggestions,
        });
      } else if (result.status === "error") {
        // Only block on error if no previous complete result exists
        const previousStatus = validationStatus?.[fieldName];
        if (previousStatus?.status !== "complete") {
          blockingIssues.push({
            fieldName,
            status: result.status,
            message: result.message || "Validation service unavailable",
          });
        } else {
          // Use cached complete result
          resultsByField[fieldName] = {
            status: "complete",
            validatedAt: previousStatus.validatedAt,
            source: "cached",
          };
        }
      } else if (result.status === "needs_work") {
        warnings.push({
          fieldName,
          status: result.status,
          message: result.message,
          suggestions: result.suggestions,
        });
      }
      // "complete" passes without issues
    } catch (error) {
      // Validation service error
      const previousStatus = validationStatus?.[fieldName];
      
      if (previousStatus?.status === "complete") {
        // Use cached complete result
        resultsByField[fieldName] = {
          status: "complete",
          validatedAt: previousStatus.validatedAt,
          source: "cached",
        };
      } else {
        blockingIssues.push({
          fieldName,
          status: "error",
          message: "Validation service unavailable",
        });
      }
    }
  }
  
  return {
    ok: blockingIssues.length === 0,
    blockingIssues,
    warnings,
    resultsByField,
  };
}