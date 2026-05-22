/**
 * Local Questionnaire State Reset Utility
 * 
 * Safely clears browser-local questionnaire state without touching server-side records.
 * Used by error boundary and reset recovery flows.
 * 
 * DOES NOT clear:
 * - FormDraft entities
 * - FormDraftEvent entities
 * - FormSubmissionIntake entities
 * - FormSubmission entities
 * - Any server-side data
 */

import { EXPRESS_COOKIE_KEY } from "@/lib/expressPersistedState";
import { clearQuestionnaireSessionId } from "@/lib/sessionId";
import { clearActiveSubmitAttempt } from "@/lib/submitAttempt";
import { 
  readLatestLocalFailedSubmissionBackup,
  clearLocalFailedSubmissionBackup 
} from "@/lib/localRecoveryBackup";

/**
 * Known legacy localStorage keys to clean up
 */
const LEGACY_STORAGE_KEYS = [
  "msp_questionnaire_data_v2",
  "express_questionnaire_session_id",
];

/**
 * Clear a cookie by name for both current path and root path
 * @param {string} name - Cookie name to clear
 * @returns {{ success: boolean, error?: string }}
 */
export function clearCookieByName(name) {
  try {
    // Clear for current path
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`;
    
    // Clear for root path explicitly
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
    
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Clear Express questionnaire local state
 * 
 * @param {Object} options - Clear options
 * @param {boolean} [options.clearSession=true] - Clear questionnaire session ID
 * @param {boolean} [options.clearSubmitAttempt=true] - Clear active submit attempt lock
 * @param {boolean} [options.clearFailedBackups=false] - Clear local failed submission backups
 * 
 * @returns {{ 
 *   ok: boolean, 
 *   cleared: string[], 
 *   errors?: Array<{ item: string, error: string }> 
 * }}
 */
export function clearExpressQuestionnaireLocalState(options = {}) {
  const {
    clearSession = true,
    clearSubmitAttempt = true,
    clearFailedBackups = false,
  } = options;

  const cleared = [];
  const errors = [];

  // 1. Clear Express persisted state cookie
  const cookieResult = clearCookieByName(EXPRESS_COOKIE_KEY);
  if (cookieResult.success) {
    cleared.push(EXPRESS_COOKIE_KEY);
  } else {
    errors.push({ item: `cookie:${EXPRESS_COOKIE_KEY}`, error: cookieResult.error });
  }

  // 2. Clear questionnaire session ID (if enabled)
  if (clearSession) {
    try {
      clearQuestionnaireSessionId();
      cleared.push("questionnaire_session_id");
    } catch (error) {
      errors.push({ 
        item: "questionnaire_session_id", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // 3. Clear active submit attempt lock (if enabled)
  if (clearSubmitAttempt) {
    try {
      // Clear for any session - the utility handles session-specific cleanup
      clearActiveSubmitAttempt();
      cleared.push("active_submit_attempt");
    } catch (error) {
      errors.push({ 
        item: "active_submit_attempt", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // 4. Clear local failed submission backups (only if explicitly requested)
  if (clearFailedBackups) {
    try {
      // Read latest backup to get session ID for targeted cleanup
      // Note: This is a best-effort cleanup - we clear what we can find
      const backup = readLatestLocalFailedSubmissionBackup();
      if (backup) {
        clearLocalFailedSubmissionBackup(backup.id);
        cleared.push("failed_submission_backup");
      }
    } catch (error) {
      // Don't fail the entire operation if backup cleanup fails
      errors.push({ 
        item: "failed_submission_backup", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // 5. Clear legacy storage keys (best effort)
  LEGACY_STORAGE_KEYS.forEach(key => {
    try {
      localStorage.removeItem(key);
      cleared.push(`legacy:${key}`);
    } catch (error) {
      // Ignore errors for legacy key cleanup
      errors.push({ 
        item: `legacy:${key}`, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  return {
    ok: errors.length === 0,
    cleared,
    ...(errors.length > 0 && { errors }),
  };
}

/**
 * Create a diagnostic record for local state reset
 * 
 * @param {string} reason - Reason for the reset (e.g. "error_boundary_caught", "user_requested")
 * @returns {{
 *   reason: string,
 *   at: string,
 *   app: string
 * }}
 */
export function createLocalStateResetDiagnostic(reason) {
  return {
    reason,
    at: new Date().toISOString(),
    app: "express_questionnaire",
  };
}