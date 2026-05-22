/**
 * Express draft event helper.
 * Builds safe, compact event records for FormDraftEvent.
 * Never throws during summary generation.
 */

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
}

export function getValueSummary(value) {
  try {
    if (value === null || value === undefined) return "Empty value";
    if (typeof value === "string") {
      return value.trim().length > 0
        ? `Text answer, ${value.length} characters`
        : "Empty text answer";
    }
    if (Array.isArray(value)) {
      return `Array answer, ${value.length} selected/value item(s)`;
    }
    if (typeof value === "object") {
      // Check for validation result objects
      if (value.status !== undefined) {
        return `Validation status: ${value.status}`;
      }
      // Check for clear-all action objects
      if (value.cleared_at && value.session_id) {
        return "Answers cleared";
      }
      return "Object answer";
    }
    return `${typeof value} value`;
  } catch {
    return "Empty value";
  }
}

export function getValueLength(value) {
  try {
    if (typeof value === "string") return value.length;
    if (Array.isArray(value)) return value.length;
    if (value !== null && typeof value === "object") {
      return JSON.stringify(value).length;
    }
    return 0;
  } catch {
    return 0;
  }
}

export function getSelectedOptionCount(value) {
  try {
    if (Array.isArray(value)) return value.length;
    if (typeof value === "string" && value.trim().length > 0) return 1;
    if (value !== null && value !== undefined && typeof value === "object") return 1;
    return 0;
  } catch {
    return 0;
  }
}

export function buildDraftEventRecord({
  sessionId,
  eventType,
  questionId,
  questionType,
  value,
  businessName,
  domain,
  userId,
  submitAttemptId
}) {
  return {
    session_id: sessionId,
    event_type: eventType,
    question_id: questionId || "",
    question_type: questionType || "",
    value_json: safeJsonStringify(value),
    value_summary: getValueSummary(value),
    value_length: getValueLength(value),
    selected_option_count: getSelectedOptionCount(value),
    business_name: businessName || "",
    domain: domain || "",
    user_id: userId || "",
    submit_attempt_id: submitAttemptId || "",
    created_at_iso: new Date().toISOString()
  };
}