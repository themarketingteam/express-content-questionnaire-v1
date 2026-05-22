/**
 * Express draft event record builder.
 * Builds safe, compact event records for the FormDraftEvent entity.
 * Does not write to Base44 — callers are responsible for persistence.
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
    if (Array.isArray(value)) return `Array answer, ${value.length} selected/value item(s)`;
    if (typeof value === "string") {
      return value.trim().length > 0
        ? `Text answer, ${value.length} characters`
        : "Empty text answer";
    }
    if (typeof value === "object") return "Object answer";
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
      try { return JSON.stringify(value).length; } catch { return 0; }
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
  userId
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
    created_at_iso: new Date().toISOString()
  };
}