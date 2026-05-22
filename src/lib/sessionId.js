/**
 * Stable questionnaire session ID utility.
 * Generates once per browser session and persists in localStorage.
 */

const SESSION_ID_KEY = "express_questionnaire_session_id";

function generateSessionId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `eq_${timestamp}_${random}`;
}

export function getOrCreateQuestionnaireSessionId() {
  try {
    const existing = localStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const newId = generateSessionId();
    localStorage.setItem(SESSION_ID_KEY, newId);
    return newId;
  } catch {
    return generateSessionId();
  }
}