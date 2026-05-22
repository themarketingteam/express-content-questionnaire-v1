// Submit attempt/idempotency helper for Express questionnaire
// Prevents duplicate final submissions and provides stable attempt tracking

const ACTIVE_SUBMIT_ATTEMPT_KEY = "express_questionnaire_active_submit_attempt";
const ATTEMPT_EXPIRY_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Create a unique submit attempt ID
 * @param {string} sessionId - The questionnaire session ID (must be non-PII generated)
 * @returns {string} - Unique attempt ID prefixed with "express_submit_"
 */
export function createSubmitAttemptId(sessionId) {
  let uuid;
  
  // Use crypto.randomUUID if available
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    uuid = crypto.randomUUID();
  } else {
    // Fallback: timestamp + random string
    uuid = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
  
  // Prefix with express_submit_ and include session id only if it's a non-PII generated session id
  const sessionIdPart = sessionId ? `_${sessionId}` : "";
  return `express_submit_${uuid}${sessionIdPart}`;
}

/**
 * Read active submit attempt from localStorage
 * @returns {{sessionId: string, attemptId: string, startedAt: string} | null} - Active attempt or null if missing/expired/malformed
 */
export function readActiveSubmitAttempt() {
  try {
    const raw = localStorage.getItem(ACTIVE_SUBMIT_ATTEMPT_KEY);
    if (!raw) return null;
    
    const parsed = JSON.parse(raw);
    
    // Validate required fields
    if (!parsed.sessionId || !parsed.attemptId || !parsed.startedAt) {
      return null;
    }
    
    // Check if expired (older than 20 minutes)
    const startedAt = new Date(parsed.startedAt).getTime();
    const now = Date.now();
    if (now - startedAt > ATTEMPT_EXPIRY_MS) {
      return null;
    }
    
    return parsed;
  } catch {
    // Malformed or storage unavailable
    return null;
  }
}

/**
 * Write active submit attempt to localStorage
 * @param {{sessionId: string, attemptId: string, startedAt: string}} attempt - Attempt data
 */
export function writeActiveSubmitAttempt(attempt) {
  try {
    localStorage.setItem(ACTIVE_SUBMIT_ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    // Silently ignore storage errors
  }
}

/**
 * Clear active submit attempt if it matches or if there's no active attempt
 * @param {string} attemptId - The attempt ID to clear
 */
export function clearActiveSubmitAttempt(attemptId) {
  try {
    const active = readActiveSubmitAttempt();
    
    // Clear only if no active attempt or the active attempt ID matches
    if (!active || active.attemptId === attemptId) {
      localStorage.removeItem(ACTIVE_SUBMIT_ATTEMPT_KEY);
    }
  } catch {
    // Silently ignore storage errors
  }
}

/**
 * Check if there's an active submit attempt for a given session
 * @param {string} sessionId - The questionnaire session ID
 * @returns {boolean} - True if active attempt exists and matches the session ID
 */
export function hasActiveSubmitAttemptForSession(sessionId) {
  const active = readActiveSubmitAttempt();
  return !!(active && active.sessionId === sessionId);
}