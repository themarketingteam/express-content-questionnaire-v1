/**
 * Express Answer History — field-level last-non-empty recovery helpers.
 * This is a RECOVERY layer only. Current formData is the submission source of truth.
 */

const MAX_ENTRIES_PER_FIELD = 5;

/**
 * @typedef {Object} HistoryEntry
 * @property {*} value
 * @property {string} savedAt
 * @property {string} source
 * @property {string} field
 * @property {string} questionId
 */

/**
 * Returns true when a value is considered meaningful (non-empty).
 */
export function isMeaningfulAnswer(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isMeaningfulAnswer);
  if (typeof value === "object") {
    return Object.values(value).some(isMeaningfulAnswer);
  }
  return false;
}

/**
 * Update last-non-empty answers map when a field changes.
 * Never overwrites a meaningful previous value with an empty one.
 *
 * @param {Record<string, HistoryEntry>} previousHistory
 * @param {string} field
 * @param {*} previousValue
 * @param {*} nextValue
 * @param {{ source?: string, questionId?: string }} options
 * @returns {Record<string, HistoryEntry>}
 */
export function updateLastNonEmptyAnswers(previousHistory, field, previousValue, nextValue, options = {}) {
  const history = { ...(previousHistory || {}) };
  const source = options.source || "typing";
  const questionId = options.questionId || "";
  const now = new Date().toISOString();

  if (isMeaningfulAnswer(nextValue)) {
    // New value is meaningful — store it as latest
    history[field] = {
      value: nextValue,
      savedAt: now,
      source,
      field,
      questionId
    };
  } else if (isMeaningfulAnswer(previousValue) && !history[field]) {
    // Next is empty, previous was meaningful, and we have no stored history — preserve previous
    history[field] = {
      value: previousValue,
      savedAt: now,
      source,
      field,
      questionId
    };
  }
  // If nextValue is empty and we already have a stored history entry, keep it unchanged.

  return history;
}

/**
 * Returns the recoverable answer for a field if the current value is empty and history has one.
 * Returns null when currentValue is meaningful.
 *
 * @param {string} field
 * @param {*} currentValue
 * @param {Record<string, HistoryEntry>} history
 * @returns {HistoryEntry | null}
 */
export function getRecoverableAnswer(field, currentValue, history) {
  if (isMeaningfulAnswer(currentValue)) return null;
  const entry = history && history[field];
  if (!entry || !isMeaningfulAnswer(entry.value)) return null;
  return entry;
}

/**
 * Safely serialize answer history to JSON string.
 */
export function serializeAnswerHistory(history) {
  try {
    return JSON.stringify(history ?? {});
  } catch {
    return "{}";
  }
}

/**
 * Safely parse answer history from JSON string.
 */
export function parseAnswerHistory(text) {
  try {
    if (!text || typeof text !== "string") return {};
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

/**
 * Compact field history to avoid unbounded growth.
 * For now lastNonEmptyAnswers is one entry per field, so this is mostly a no-op safety trim.
 *
 * @param {Record<string, any>} history
 * @param {number} maxEntriesPerField
 * @returns {Record<string, any>}
 */
export function compactFieldHistory(history, maxEntriesPerField = MAX_ENTRIES_PER_FIELD) {
  if (!history || typeof history !== "object") return {};
  const compacted = {};
  for (const [field, entry] of Object.entries(history)) {
    if (Array.isArray(entry)) {
      compacted[field] = entry.slice(-maxEntriesPerField);
    } else {
      compacted[field] = entry;
    }
  }
  return compacted;
}
