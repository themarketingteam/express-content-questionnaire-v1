/**
 * Local Recovery Backup Utility for Express Questionnaire
 * 
 * Provides browser-local storage for failed submission backups.
 * Ensures users can recover their answers even if draft save,
 * final DB save, fallback intake, or Zapier delivery fails.
 * 
 * Key features:
 * - Browser-local only (localStorage)
 * - Non-blocking (never throws uncaught errors)
 * - Includes recovery code/session id and submit attempt id
 * - Stores raw responses and transformed payload when available
 * - Safe serialized error data with truncation
 * - Limited to 5 most recent backups per session
 * - Copyable recovery data for support
 */

// Constants
const FAILED_BACKUP_INDEX_KEY = "express_questionnaire_failed_backup_index";
const FAILED_BACKUP_PREFIX = "express_questionnaire_failed_backup_";
const MAX_FAILED_BACKUPS = 5;
const MAX_ERROR_SIZE = 2000; // Truncate large errors

/**
 * Check if safe storage (localStorage) is available
 * @returns {boolean}
 */
export function safeStorageAvailable() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }
    const testKey = "__storage_test__";
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely serialize any value for backup storage
 * Handles circular references and truncates large data
 * @param {any} value
 * @returns {string}
 */
export function safeSerializeForBackup(value) {
  if (value === undefined || value === null) {
    return "";
  }

  try {
    const seen = new WeakSet();
    const serialized = JSON.stringify(value, (key, val) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) {
          return "[Circular]";
        }
        seen.add(val);
      }
      return val;
    });

    // Truncate if too large
    if (serialized && serialized.length > 100000) {
      return serialized.substring(0, 100000) + "...[truncated]";
    }

    return serialized;
  } catch {
    return "[Serialization failed]";
  }
}

/**
 * Create a unique backup ID
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} [params.submitAttemptId]
 * @returns {string}
 */
export function createLocalBackupId({ sessionId, submitAttemptId }) {
  const timestamp = Date.now();
  const attemptPart = submitAttemptId ? `_${submitAttemptId.slice(0, 8)}` : "";
  return `${sessionId}${attemptPart}_${timestamp}`;
}

/**
 * Truncate error data safely for storage
 * @param {any} error
 * @returns {Object}
 */
function truncateErrorForStorage(error) {
  if (!error) return {};

  const truncated = {
    message: typeof error.message === "string" ? error.message.slice(0, MAX_ERROR_SIZE) : String(error.message || error).slice(0, MAX_ERROR_SIZE),
    name: error.name || "Error",
    stage: error.stage || "unknown",
    failureKind: error.failureKind || "unknown",
    timestamp: error.timestamp || new Date().toISOString(),
  };

  // Include safe additional fields if present
  if (error.recoveryCode) truncated.recoveryCode = error.recoveryCode;
  if (error.sessionId) truncated.sessionId = error.sessionId;

  return truncated;
}

/**
 * Write a local failed submission backup
 * 
 * @param {Object} args
 * @param {string} args.sessionId - Questionnaire session ID
 * @param {string} [args.submitAttemptId] - Submit attempt ID
 * @param {string} [args.businessName] - Business name
 * @param {string} [args.domain] - Business domain
 * @param {Object} [args.responses] - Raw form responses
 * @param {Object} [args.transformedPayload] - Transformed Express payload
 * @param {Object} [args.validationStatus] - Validation status map
 * @param {Object} [args.touchedQuestions] - Touched questions map
 * @param {Object} [args.expandedQuestions] - Expanded questions map
 * @param {string} [args.stage] - Failure stage (e.g., "payload_transform_failed", "submit_failed")
 * @param {any} [args.error] - Error object or message
 * @param {Object} [args.diagnostics] - Diagnostic metadata
 * 
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export async function writeLocalFailedSubmissionBackup(args) {
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
      return { ok: false, error: "Storage not available" };
    }

    if (!sessionId) {
      return { ok: false, error: "Session ID required" };
    }

    const backupId = createLocalBackupId({ sessionId, submitAttemptId });
    const storageKey = `${FAILED_BACKUP_PREFIX}${backupId}`;
    const timestamp = new Date().toISOString();

    // Build backup record
    const backupRecord = {
      id: backupId,
      session_id: sessionId,
      submit_attempt_id: submitAttemptId || "",
      business_name: businessName || "",
      domain: domain || "",
      responses: responses || {},
      transformed_payload: transformedPayload || null,
      validation_status: validationStatus || {},
      touched_questions: touchedQuestions || {},
      expanded_questions: expandedQuestions || {},
      stage: stage || "unknown",
      error: truncateErrorForStorage(error),
      diagnostics: diagnostics || {},
      created_at: timestamp,
      app: "express_questionnaire",
    };

    // Serialize and store
    const serialized = safeSerializeForBackup(backupRecord);
    localStorage.setItem(storageKey, serialized);

    // Update index
    await updateBackupIndex({ backupId, sessionId, timestamp });

    // Prune old backups
    await pruneLocalFailedSubmissionBackups();

    return { ok: true, id: backupId };
  } catch (storageErr) {
    console.error("[localRecoveryBackup] Write failed:", storageErr);
    return { ok: false, error: storageErr.message || "Storage write failed" };
  }
}

/**
 * Update the backup index with a new entry
 * @param {Object} params
 * @param {string} params.backupId
 * @param {string} params.sessionId
 * @param {string} params.timestamp
 */
async function updateBackupIndex({ backupId, sessionId, timestamp }) {
  try {
    if (!safeStorageAvailable()) return;

    const indexData = localStorage.getItem(FAILED_BACKUP_INDEX_KEY);
    let index = [];

    if (indexData) {
      try {
        index = JSON.parse(indexData);
        if (!Array.isArray(index)) index = [];
      } catch {
        index = [];
      }
    }

    // Add new entry
    index.push({ backupId, sessionId, timestamp });

    // Sort by timestamp descending (newest first)
    index.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Store updated index
    localStorage.setItem(FAILED_BACKUP_INDEX_KEY, safeSerializeForBackup(index));
  } catch {
    // Silently ignore index update failures
  }
}

/**
 * Read a local failed submission backup by ID
 * 
 * @param {string} id - Backup ID
 * @returns {Promise<{ ok: boolean, data?: Object, error?: string }>}
 */
export async function readLocalFailedSubmissionBackup(id) {
  try {
    if (!safeStorageAvailable()) {
      return { ok: false, error: "Storage not available" };
    }

    if (!id) {
      return { ok: false, error: "Backup ID required" };
    }

    const storageKey = `${FAILED_BACKUP_PREFIX}${id}`;
    const serialized = localStorage.getItem(storageKey);

    if (!serialized) {
      return { ok: false, error: "Backup not found" };
    }

    try {
      const data = JSON.parse(serialized);
      return { ok: true, data };
    } catch (parseErr) {
      return { ok: false, error: "Backup data corrupted" };
    }
  } catch (readErr) {
    console.error("[localRecoveryBackup] Read failed:", readErr);
    return { ok: false, error: readErr.message || "Storage read failed" };
  }
}

/**
 * Read the latest local failed submission backup for a session
 * 
 * @param {string} sessionId - Questionnaire session ID
 * @returns {Promise<{ ok: boolean, data?: Object, error?: string }>}
 */
export async function readLatestLocalFailedSubmissionBackup(sessionId) {
  try {
    if (!safeStorageAvailable()) {
      return { ok: false, error: "Storage not available" };
    }

    if (!sessionId) {
      return { ok: false, error: "Session ID required" };
    }

    // Get index
    const indexData = localStorage.getItem(FAILED_BACKUP_INDEX_KEY);
    let index = [];

    if (indexData) {
      try {
        index = JSON.parse(indexData);
        if (!Array.isArray(index)) index = [];
      } catch {
        index = [];
      }
    }

    // Find latest backup for this session
    const sessionBackups = index
      .filter(entry => entry.sessionId === sessionId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (sessionBackups.length === 0) {
      return { ok: false, error: "No backups found for session" };
    }

    const latestBackupId = sessionBackups[0].backupId;
    return await readLocalFailedSubmissionBackup(latestBackupId);
  } catch (readErr) {
    console.error("[localRecoveryBackup] Read latest failed:", readErr);
    return { ok: false, error: readErr.message || "Storage read failed" };
  }
}

/**
 * List all local failed submission backups
 * Returns metadata only (not full backup data)
 * 
 * @returns {Promise<{ ok: boolean, backups?: Array, error?: string }>}
 */
export async function listLocalFailedSubmissionBackups() {
  try {
    if (!safeStorageAvailable()) {
      return { ok: false, error: "Storage not available" };
    }

    const indexData = localStorage.getItem(FAILED_BACKUP_INDEX_KEY);
    let index = [];

    if (indexData) {
      try {
        index = JSON.parse(indexData);
        if (!Array.isArray(index)) index = [];
      } catch {
        index = [];
      }
    }

    // Return index sorted by timestamp (newest first)
    return {
      ok: true,
      backups: index.map(entry => ({
        id: entry.backupId,
        session_id: entry.sessionId,
        timestamp: entry.timestamp,
      })),
    };
  } catch (listErr) {
    console.error("[localRecoveryBackup] List failed:", listErr);
    return { ok: false, error: listErr.message || "Storage list failed" };
  }
}

/**
 * Prune local failed submission backups beyond MAX_FAILED_BACKUPS
 * Keeps only the 5 most recent backups globally
 */
export async function pruneLocalFailedSubmissionBackups() {
  try {
    if (!safeStorageAvailable()) return;

    const indexData = localStorage.getItem(FAILED_BACKUP_INDEX_KEY);
    let index = [];

    if (indexData) {
      try {
        index = JSON.parse(indexData);
        if (!Array.isArray(index)) index = [];
      } catch {
        index = [];
      }
    }

    // Remove old backups beyond limit
    if (index.length > MAX_FAILED_BACKUPS) {
      const toRemove = index.slice(MAX_FAILED_BACKUPS);
      index = index.slice(0, MAX_FAILED_BACKUPS);

      // Delete old backup files
      for (const entry of toRemove) {
        try {
          const storageKey = `${FAILED_BACKUP_PREFIX}${entry.backupId}`;
          localStorage.removeItem(storageKey);
        } catch {
          // Silently ignore deletion failures
        }
      }

      // Update index
      localStorage.setItem(FAILED_BACKUP_INDEX_KEY, safeSerializeForBackup(index));
    }
  } catch (pruneErr) {
    console.error("[localRecoveryBackup] Prune failed:", pruneErr);
    // Silently ignore prune failures
  }
}

/**
 * Remove a local failed submission backup by ID
 * 
 * @param {string} id - Backup ID
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function removeLocalFailedSubmissionBackup(id) {
  try {
    if (!safeStorageAvailable()) {
      return { ok: false, error: "Storage not available" };
    }

    if (!id) {
      return { ok: false, error: "Backup ID required" };
    }

    const storageKey = `${FAILED_BACKUP_PREFIX}${id}`;
    localStorage.removeItem(storageKey);

    // Update index
    const indexData = localStorage.getItem(FAILED_BACKUP_INDEX_KEY);
    if (indexData) {
      try {
        let index = JSON.parse(indexData);
        if (Array.isArray(index)) {
          index = index.filter(entry => entry.backupId !== id);
          localStorage.setItem(FAILED_BACKUP_INDEX_KEY, safeSerializeForBackup(index));
        }
      } catch {
        // Silently ignore index update failures
      }
    }

    return { ok: true };
  } catch (removeErr) {
    console.error("[localRecoveryBackup] Remove failed:", removeErr);
    return { ok: false, error: removeErr.message || "Storage remove failed" };
  }
}

/**
 * Clear all local failed submission backups
 * Utility for testing or manual cleanup
 * 
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function clearAllLocalFailedSubmissionBackups() {
  try {
    if (!safeStorageAvailable()) {
      return { ok: false, error: "Storage not available" };
    }

    const indexData = localStorage.getItem(FAILED_BACKUP_INDEX_KEY);
    let index = [];

    if (indexData) {
      try {
        index = JSON.parse(indexData);
        if (!Array.isArray(index)) index = [];
      } catch {
        index = [];
      }
    }

    // Remove all backup files
    for (const entry of index) {
      try {
        const storageKey = `${FAILED_BACKUP_PREFIX}${entry.backupId}`;
        localStorage.removeItem(storageKey);
      } catch {
        // Silently ignore deletion failures
      }
    }

    // Clear index
    localStorage.removeItem(FAILED_BACKUP_INDEX_KEY);

    return { ok: true };
  } catch (clearErr) {
    console.error("[localRecoveryBackup] Clear all failed:", clearErr);
    return { ok: false, error: clearErr.message || "Storage clear failed" };
  }
}