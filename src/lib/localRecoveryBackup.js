/**
 * Local recovery backup utility for failed Express questionnaire submissions.
 * Provides browser-local storage for failed submission data with automatic pruning.
 */

const FAILED_BACKUP_INDEX_KEY = "express_questionnaire_failed_backup_index";
const FAILED_BACKUP_PREFIX = "express_questionnaire_failed_backup_";
const MAX_FAILED_BACKUPS = 5;

/**
 * Check if localStorage is safely available
 */
export function safeStorageAvailable() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const test = "__storage_test__";
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely serialize a value for backup storage
 */
export function safeSerializeForBackup(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return null;
  }
}

/**
 * Create a unique backup ID from session and attempt IDs
 */
export function createLocalBackupId({ sessionId, submitAttemptId }) {
  const timestamp = Date.now();
  const sessionPart = sessionId || "unknown";
  const attemptPart = submitAttemptId ? `_${submitAttemptId}` : "";
  return `${sessionPart}${attemptPart}_${timestamp}`;
}

/**
 * Write a failed submission backup to localStorage
 */
export function writeLocalFailedSubmissionBackup(args) {
  const {
    sessionId,
    submitAttemptId,
    businessName,
    domain,
    responses,
    transformedPayload,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    stage,
    error,
    diagnostics,
  } = args;

  try {
    if (!safeStorageAvailable()) {
      return { ok: false, error: "localStorage unavailable" };
    }

    const backupId = createLocalBackupId({ sessionId, submitAttemptId });
    const createdAt = new Date().toISOString();

    const backup = {
      id: backupId,
      session_id: sessionId || "",
      submit_attempt_id: submitAttemptId || "",
      business_name: businessName || "",
      domain: domain || "",
      responses: responses || {},
      transformed_payload: transformedPayload || null,
      validation_status: validationStatus || {},
      touched_questions: touchedQuestions || {},
      expanded_questions: expandedQuestions || {},
      stage: stage || "unknown",
      error: error ? serializeErrorForBackup(error) : null,
      diagnostics: diagnostics || {},
      created_at: createdAt,
      app: "express_questionnaire",
    };

    // Write backup record
    const backupKey = `${FAILED_BACKUP_PREFIX}${backupId}`;
    localStorage.setItem(backupKey, safeSerializeForBackup(backup));

    // Update index
    const index = readBackupIndex();
    index.unshift({ id: backupId, session_id: sessionId, created_at: createdAt });
    
    // Prune old backups
    while (index.length > MAX_FAILED_BACKUPS) {
      const oldest = index.pop();
      try {
        localStorage.removeItem(`${FAILED_BACKUP_PREFIX}${oldest.id}`);
      } catch {
        // ignore
      }
    }

    localStorage.setItem(FAILED_BACKUP_INDEX_KEY, safeSerializeForBackup(index));

    return { ok: true, id: backupId };
  } catch (err) {
    return { ok: false, error: err?.message || "Storage write failed" };
  }
}

/**
 * Read a specific backup by ID
 */
export function readLocalFailedSubmissionBackup(id) {
  try {
    if (!safeStorageAvailable()) return null;
    
    const key = `${FAILED_BACKUP_PREFIX}${id}`;
    const data = localStorage.getItem(key);
    if (!data) return null;
    
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Read the latest backup for a session
 */
export function readLatestLocalFailedSubmissionBackup(sessionId) {
  try {
    if (!safeStorageAvailable()) return null;
    
    const index = readBackupIndex();
    const sessionBackups = index.filter(b => b.session_id === sessionId);
    
    if (sessionBackups.length === 0) return null;
    
    // Return most recent
    const latest = sessionBackups[0];
    return readLocalFailedSubmissionBackup(latest.id);
  } catch {
    return null;
  }
}

/**
 * List all failed backups (newest first)
 */
export function listLocalFailedSubmissionBackups() {
  try {
    if (!safeStorageAvailable()) return [];
    
    const index = readBackupIndex();
    return index.map(entry => {
      const backup = readLocalFailedSubmissionBackup(entry.id);
      return backup || {
        id: entry.id,
        session_id: entry.session_id,
        created_at: entry.created_at,
        app: "express_questionnaire",
      };
    });
  } catch {
    return [];
  }
}

/**
 * Prune backups to MAX_FAILED_BACKUPS limit
 */
export function pruneLocalFailedSubmissionBackups() {
  try {
    if (!safeStorageAvailable()) return;
    
    const index = readBackupIndex();
    
    while (index.length > MAX_FAILED_BACKUPS) {
      const oldest = index.pop();
      try {
        localStorage.removeItem(`${FAILED_BACKUP_PREFIX}${oldest.id}`);
      } catch {
        // ignore
      }
    }
    
    localStorage.setItem(FAILED_BACKUP_INDEX_KEY, safeSerializeForBackup(index));
  } catch {
    // ignore
  }
}

/**
 * Remove a specific backup by ID
 */
export function removeLocalFailedSubmissionBackup(id) {
  try {
    if (!safeStorageAvailable()) return false;
    
    localStorage.removeItem(`${FAILED_BACKUP_PREFIX}${id}`);
    
    const index = readBackupIndex();
    const filtered = index.filter(entry => entry.id !== id);
    localStorage.setItem(FAILED_BACKUP_INDEX_KEY, safeSerializeForBackup(filtered));
    
    return true;
  } catch {
    return false;
  }
}

// Internal helpers

function readBackupIndex() {
  try {
    const data = localStorage.getItem(FAILED_BACKUP_INDEX_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeErrorForBackup(error) {
  try {
    return {
      message: error?.message || String(error) || "Unknown error",
      name: error?.name || "Error",
      stage: error?.stage || null,
    };
  } catch {
    return { message: "Unknown error", name: "Error" };
  }
}