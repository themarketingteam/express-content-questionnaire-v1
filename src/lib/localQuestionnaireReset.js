/**
 * Local Questionnaire State Reset Utility
 * 
 * Provides safe browser-local state clearing without touching server-side records.
 * Used by error boundary and recovery flows.
 */

import { EXPRESS_COOKIE_KEY, EXPRESS_LS_KEY_GLOBAL, clearStateFromLocalStorage } from './expressPersistedState';
import { clearQuestionnaireSessionId } from './sessionId';
import { ACTIVE_SUBMIT_ATTEMPT_KEY } from './submitAttempt';
import { clearLocalFailedSubmissionBackup } from './localRecoveryBackup';

/**
 * Clear a cookie by name for both current path and root path
 */
export const clearCookieByName = (name) => {
  const cleared = [];
  const errors = [];

  try {
    // Clear for current path
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=${window.location.pathname}; SameSite=Lax`;
    cleared.push(`${name} (path=${window.location.pathname})`);
  } catch (err) {
    errors.push(`Failed to clear ${name} for current path: ${err.message}`);
  }

  try {
    // Clear for root path
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`;
    cleared.push(`${name} (path=/)`);
  } catch (err) {
    errors.push(`Failed to clear ${name} for root path: ${err.message}`);
  }

  return { ok: errors.length === 0, cleared, errors };
};

/**
 * Clear Express questionnaire local state
 * 
 * @param {Object} options
 * @param {boolean} [options.clearSession=true] - Clear questionnaire session ID
 * @param {boolean} [options.clearSubmitAttempt=true] - Clear active submit attempt lock
 * @param {boolean} [options.clearFailedBackups=false] - Clear local failed submission backups
 * @returns {Object} Result with cleared items and any errors
 */
export const clearExpressQuestionnaireLocalState = (options = {}) => {
  const {
    clearSession = true,
    clearSubmitAttempt = true,
    clearFailedBackups = false,
  } = options;

  const cleared = [];
  const errors = [];

  // Always clear the Express questionnaire cookie
  try {
    const cookieResult = clearCookieByName(EXPRESS_COOKIE_KEY);
    cleared.push(...cookieResult.cleared);
    if (!cookieResult.ok) {
      errors.push(...cookieResult.errors);
    }
  } catch (err) {
    errors.push(`Failed to clear questionnaire cookie: ${err.message}`);
  }

  // Clear localStorage persisted-state keys (primary persistence layer)
  try {
    // Clear global key directly
    localStorage.removeItem(EXPRESS_LS_KEY_GLOBAL);
    cleared.push(`${EXPRESS_LS_KEY_GLOBAL} (localStorage)`);
    // Clear per-session keys if we can derive them
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('msp_questionnaire_data_v3_session_')) {
        localStorage.removeItem(key);
        cleared.push(`${key} (localStorage)`);
      }
    }
  } catch (err) {
    errors.push(`Failed to clear localStorage state: ${err.message}`);
  }

  // Clear legacy cookie keys if they exist
  const legacyKeys = ['msp_questionnaire_data_v2', 'express_questionnaire_session_id'];
  legacyKeys.forEach((key) => {
    try {
      const result = clearCookieByName(key);
      if (result.cleared.length > 0) {
        cleared.push(...result.cleared.map((c) => `${key} (legacy)`));
      }
    } catch {
      // Ignore legacy key errors
    }
  });

  // Clear session ID if requested
  if (clearSession) {
    try {
      clearQuestionnaireSessionId();
      cleared.push('questionnaire_session_id');
    } catch (err) {
      errors.push(`Failed to clear session ID: ${err.message}`);
    }
  }

  // Clear active submit attempt if requested
  if (clearSubmitAttempt) {
    try {
      localStorage.removeItem(ACTIVE_SUBMIT_ATTEMPT_KEY);
      cleared.push(`${ACTIVE_SUBMIT_ATTEMPT_KEY} (localStorage)`);
    } catch (err) {
      errors.push(`Failed to clear submit attempt: ${err.message}`);
    }
  }

  // Clear failed backups only if explicitly requested
  if (clearFailedBackups) {
    try {
      clearLocalFailedSubmissionBackup();
      cleared.push('local_failed_submission_backups');
    } catch (err) {
      errors.push(`Failed to clear failed backups: ${err.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    cleared,
    errors,
  };
};

/**
 * Create a local state reset diagnostic record
 * 
 * @param {string} reason - Reason for the reset (e.g. "corrupted_state", "user_requested")
 * @returns {Object} Diagnostic record with timestamp and context
 */
export const createLocalStateResetDiagnostic = (reason) => {
  return {
    reason,
    at: new Date().toISOString(),
    app: 'express_questionnaire',
  };
};