// Question validation status constants and utilities

export const QUESTION_STATUS = {
  not_started: "not_started",
  in_progress: "in_progress",
  complete: "complete",
  needs_attention: "needs_attention",
  needs_validation: "needs_validation",
  validating: "validating",
  dirty: "dirty",
  error: "error",
};

/**
 * Get human-readable label for a question status
 */
export function getQuestionStatusLabel(status) {
  const labels = {
    [QUESTION_STATUS.not_started]: "Not started",
    [QUESTION_STATUS.in_progress]: "In progress",
    [QUESTION_STATUS.complete]: "Complete",
    [QUESTION_STATUS.needs_attention]: "Needs attention",
    [QUESTION_STATUS.needs_validation]: "Needs validation",
    [QUESTION_STATUS.validating]: "Validating",
    [QUESTION_STATUS.dirty]: "Edited since validation",
    [QUESTION_STATUS.error]: "Validation unavailable",
  };
  
  return labels[status] || labels[QUESTION_STATUS.not_started];
}

/**
 * Get color tone for a question status
 */
export function getQuestionStatusTone(status) {
  const tones = {
    [QUESTION_STATUS.not_started]: "slate",
    [QUESTION_STATUS.in_progress]: "blue",
    [QUESTION_STATUS.complete]: "green",
    [QUESTION_STATUS.needs_attention]: "amber",
    [QUESTION_STATUS.needs_validation]: "amber",
    [QUESTION_STATUS.validating]: "blue",
    [QUESTION_STATUS.dirty]: "slate",
    [QUESTION_STATUS.error]: "red",
  };
  
  return tones[status] || "slate";
}

/**
 * Normalize unknown status values to valid status
 */
export function normalizeQuestionStatus(status) {
  const validStatuses = Object.values(QUESTION_STATUS);
  
  if (validStatuses.includes(status)) {
    return status;
  }
  
  // Map common variations
  const mappings = {
    "not-started": QUESTION_STATUS.not_started,
    "notstarted": QUESTION_STATUS.not_started,
    "in-progress": QUESTION_STATUS.in_progress,
    "inprogress": QUESTION_STATUS.in_progress,
    "needs-attention": QUESTION_STATUS.needs_attention,
    "needsattention": QUESTION_STATUS.needs_attention,
    "needs-validation": QUESTION_STATUS.needs_validation,
    "needsvalidation": QUESTION_STATUS.needs_validation,
    "edited": QUESTION_STATUS.dirty,
    "validation-error": QUESTION_STATUS.error,
    "validationerror": QUESTION_STATUS.error,
  };
  
  return mappings[status] || QUESTION_STATUS.not_started;
}