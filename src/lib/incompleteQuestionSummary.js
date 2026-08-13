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
 * Human-readable labels for Express questionnaire questions
 */
export const EXPRESS_QUESTION_LABELS = {
  "1": "Company type",
  "2": "Services offered",
  "3": "What makes your company different",
  "4": "Geographic service area",
  "5": "Pricing and packaging",
  "6": "Company goals",
  "7": "Brand tone",
  "8": "Target industries",
  "9": "Typical client size",
  "10": "Client challenges",
  "11": "Desired client outcomes",
  "12": "Ideal client"
};

/**
 * Get human-readable label for a question
 * @param {string} questionId - Question ID (1-12)
 * @returns {string} Human-readable label
 */
export function getQuestionSummaryLabel(questionId) {
  return EXPRESS_QUESTION_LABELS[questionId] || `Question ${questionId}`;
}

/**
 * Build a comprehensive summary of incomplete, invalid, and attention-needed questions
 * 
 * @param {Object} params
 * @param {Object} params.formData - Current form data
 * @param {Object} params.touchedQuestions - Map of touched questions
 * @param {Object} params.validationStatus - Map of text validation statuses
 * @param {string[]} params.validatingFields - Array of fields currently being validated
 * @param {Function} params.isQuestionComplete - Function to check if a question is complete
 * @returns {Object} Summary object with counts and categorized items
 */
export function buildIncompleteQuestionSummary({
  formData: _formData,
  touchedQuestions: _touchedQuestions,
  validationStatus,
  validatingFields = [],
  isQuestionComplete,
}) {
  const incompleteItems = [];
  const attentionItems = [];
  const validationItems = [];
  const warningItems = [];
  const allItems = [];
  let completeCount = 0;

  // Process all 12 questions
  for (let questionId = 1; questionId <= 12; questionId++) {
    const qId = String(questionId);
    const label = getQuestionSummaryLabel(qId);
    const isComplete = isQuestionComplete(questionId);
    
    // Track complete count
    if (isComplete) {
      completeCount++;
    }

    // Build base item
    const item = {
      questionId: qId,
      label,
      isComplete,
      blocking: false,
      status: 'complete',
      reason: '',
      fieldName: null,
      message: ''
    };

    // Check if question is incomplete (blocking)
    if (!isComplete) {
      incompleteItems.push({
        ...item,
        blocking: true,
        status: 'incomplete',
        reason: 'Required answer missing'
      });
      allItems.push({
        ...item,
        blocking: true,
        status: 'incomplete',
        reason: 'Required answer missing'
      });
      continue;
    }

    // For text questions (3 and 12), check validation status
    if (questionId === 3 || questionId === 12) {
      const fieldName = questionId === 3 ? 'differentiation' : 'idealClient';
      const valStatus = validationStatus?.[fieldName];
      const isValStatusUnknown = !valStatus || valStatus.status === 'unknown';
      const isValStatusDirty = valStatus?.status === 'dirty';
      const isValStatusIncomplete = valStatus?.status === 'incomplete';
      const isValStatusNeedsWork = valStatus?.status === 'needs_work';
      const isValStatusError = valStatus?.status === 'error';
      const isValidating = isFieldCurrentlyValidating(validatingFields, fieldName);

      // Question is complete, but validation status is unknown/not yet validated
      if (isValStatusUnknown && !isValidating) {
        validationItems.push({
          ...item,
          blocking: false,
          status: 'pending_validation',
          reason: 'Written answer should be validated',
          fieldName
        });
        allItems.push({
          ...item,
          blocking: false,
          status: 'pending_validation',
          reason: 'Written answer should be validated',
          fieldName
        });
      }
      // Validation status is dirty (edited since last validation)
      else if (isValStatusDirty) {
        validationItems.push({
          ...item,
          blocking: false,
          status: 'dirty',
          reason: 'Edited since last validation',
          fieldName
        });
        allItems.push({
          ...item,
          blocking: false,
          status: 'dirty',
          reason: 'Edited since last validation',
          fieldName
        });
      }
      // Validation status is incomplete (blocking)
      else if (isValStatusIncomplete) {
        attentionItems.push({
          ...item,
          blocking: true,
          status: 'incomplete',
          reason: valStatus.message || 'Needs more detail before submission',
          fieldName,
          message: valStatus.message,
          suggestions: valStatus.suggestions
        });
        allItems.push({
          ...item,
          blocking: true,
          status: 'incomplete',
          reason: valStatus.message || 'Needs more detail before submission',
          fieldName,
          message: valStatus.message,
          suggestions: valStatus.suggestions
        });
      }
      // Validation status is needs_work (warning, non-blocking)
      else if (isValStatusNeedsWork) {
        warningItems.push({
          ...item,
          blocking: false,
          status: 'needs_work',
          reason: valStatus.message || 'Could use a little more detail',
          fieldName,
          message: valStatus.message,
          suggestions: valStatus.suggestions
        });
        allItems.push({
          ...item,
          blocking: false,
          status: 'needs_work',
          reason: valStatus.message || 'Could use a little more detail',
          fieldName,
          message: valStatus.message,
          suggestions: valStatus.suggestions
        });
      }
      // Validation status is error
      else if (isValStatusError) {
        validationItems.push({
          ...item,
          blocking: false,
          status: 'error',
          reason: 'Validation unavailable',
          fieldName
        });
        allItems.push({
          ...item,
          blocking: false,
          status: 'error',
          reason: 'Validation unavailable',
          fieldName
        });
      }
    }

    // Add to allItems if not already added
    if (!allItems.find(i => i.questionId === qId)) {
      allItems.push(item);
    }
  }

  return {
    completeCount,
    totalCount: 12,
    incompleteItems,
    attentionItems,
    validationItems,
    warningItems,
    allItems
  };
}

/**
 * Check if there are any blocking incomplete items
 * 
 * @param {Object} summary - Summary object from buildIncompleteQuestionSummary
 * @returns {boolean} True if there are blocking items
 */
export function hasBlockingIncompleteItems(summary) {
  return summary.incompleteItems.some(item => item.blocking) ||
         summary.attentionItems.some(item => item.blocking);
}

/**
 * Get the first blocking question ID
 * 
 * @param {Object} summary - Summary object from buildIncompleteQuestionSummary
 * @returns {string} First blocking question ID or empty string
 */
export function getFirstBlockingQuestionId(summary) {
  // Check incomplete items first (ordered by question ID)
  const incomplete = summary.incompleteItems.find(item => item.blocking);
  if (incomplete) {
    return incomplete.questionId;
  }

  // Check attention items
  const attention = summary.attentionItems.find(item => item.blocking);
  if (attention) {
    return attention.questionId;
  }

  return '';
}
