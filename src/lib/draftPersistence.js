/**
 * Express draft persistence helper.
 * Mirrors the Pro draft persistence architecture for FormDraft (Express-specific entity).
 */

import {
  buildExpressSubmissionPayload,
  getInitialExpressFormData,
  safeJsonStringify,
  serializeExpressError
} from "@/lib/expressQuestionnairePayload";
import {
  normalizeExpressFormData,
  normalizeValidationStatus,
  normalizeTouchedQuestions,
  normalizeExpandedQuestions
} from "@/lib/expressPersistedState";

function safeNowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

function safeGetUserAgent() {
  try {
    return navigator?.userAgent || "";
  } catch {
    return "";
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // silently ignore storage errors
  }
}

export function sanitizeCredentialsForDraft(credentials = {}) {
  return {
    businessName: credentials.businessName || "",
    domain: credentials.domain || "",
    userId: credentials.userId || "",
    userName: credentials.userName || "",
    userEmail: credentials.userEmail || ""
  };
}

export function createFindExistingDraftBySessionId({ draftRecordIdRef }) {
  return async function findExistingDraftBySessionId({ sessionId, entities }) {
    if (draftRecordIdRef.current) {
      return { id: draftRecordIdRef.current };
    }

    const results = await entities.FormDraft.filter({ session_id: sessionId });
    if (!results || results.length === 0) return null;

    const sorted = [...results].sort((a, b) => {
      const aTime = a.last_saved_at || a.created_date || "";
      const bTime = b.last_saved_at || b.created_date || "";
      return bTime.localeCompare(aTime);
    });

    const newest = sorted[0];
    draftRecordIdRef.current = newest.id;
    return newest;
  };
}

const INITIAL_FORM_DATA = getInitialExpressFormData();

function safeJsonParseLocal(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Determine if a field value should be considered "empty" for merge purposes.
 * Empty values do NOT overwrite existing recovery data.
 */
function isFieldValueEmpty(key, value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    if (value.trim() === "") return true;
    // The default clientSize is auto-filled, not user-entered
    if (key === "clientSize" && value === INITIAL_FORM_DATA.clientSize) return true;
    return false;
  }
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    // geographicAreaMeta with only { source: "google" } is a default stub
    return !Object.entries(value).some(([k, v]) =>
      k !== "source" && v !== null && v !== undefined && v !== ""
    );
  }
  return false;
}

/**
 * Per-field merge: new non-empty values override existing; empty values retain
 * the last-known answer. This ensures recovery holds data even after the user
 * clears the form locally or refreshes the page.
 */
function mergeFormResponses(existing, incoming) {
  const merged = { ...existing };
  for (const key of Object.keys(INITIAL_FORM_DATA)) {
    const incomingValue = incoming[key];
    if (!isFieldValueEmpty(key, incomingValue)) {
      merged[key] = incomingValue;
    } else if (merged[key] === undefined) {
      merged[key] = incomingValue;
    }
  }
  return merged;
}

export function createSaveDraftSnapshot({ entities, draftRecordIdRef, findExistingDraftBySessionId, persistDraftRecord }) {
  // Cache the last merged state so subsequent saves don't need a server round-trip.
  // Reset to null on page load; populated after the first save.
  const lastMergedResponsesRef = { current: null };
  const lastMergedBusinessNameRef = { current: "" };
  const lastMergedDomainRef = { current: "" };

  return async function saveDraftSnapshot({
    sessionId,
    responses,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    credentials,
    businessNameParam,
    domainParam,
    currentQuestionId,
    lastChangedQuestionId,
    status = "draft",
    saveError = "",
    submitError = "",
    finalSubmissionId = "",
    submitAttemptId = "",
    lastNonEmptyAnswers = null,
    fieldHistory = null,
    lastLocalPersistedAt = ""
  }) {
    const creds = sanitizeCredentialsForDraft(credentials);
    const businessName = businessNameParam || creds.businessName || "";
    const domain = domainParam || creds.domain || "";

    // Normalize all state sections before saving
    let normalizedResponses, normalizedValidationStatus, normalizedTouchedQuestions, normalizedExpandedQuestions;
    let normalizationError = "";
    
    try {
      normalizedResponses = normalizeExpressFormData(responses || {});
      normalizedValidationStatus = normalizeValidationStatus(validationStatus || {});
      normalizedTouchedQuestions = normalizeTouchedQuestions(touchedQuestions || {});
      normalizedExpandedQuestions = normalizeExpandedQuestions(expandedQuestions || {});
    } catch (err) {
      // If normalization fails, use defaults and continue
      normalizationError = err?.message || "Normalization failed";
      normalizedResponses = normalizeExpressFormData({});
      normalizedValidationStatus = normalizeValidationStatus({});
      normalizedTouchedQuestions = normalizeTouchedQuestions({});
      normalizedExpandedQuestions = normalizeExpandedQuestions({});
    }

    // Find existing draft first — needed for per-field merge
    const existing = await findExistingDraftBySessionId({ sessionId, entities });

    // Retrieve last-known responses for merge (cache → server fallback)
    let existingResponses = {};
    let existingBusinessName = "";
    let existingDomain = "";

    if (lastMergedResponsesRef.current) {
      existingResponses = lastMergedResponsesRef.current;
      existingBusinessName = lastMergedBusinessNameRef.current;
      existingDomain = lastMergedDomainRef.current;
    } else if (existing && existing.responses_json) {
      existingResponses = safeJsonParseLocal(existing.responses_json, {});
      existingBusinessName = existing.business_name || "";
      existingDomain = existing.domain || "";
    }

    // Per-field merge: new non-empty values override; empty values retain existing.
    // This ensures recovery holds answers even after local clear/refresh.
    const mergedResponses = mergeFormResponses(existingResponses, normalizedResponses);
    const mergedBusinessName = businessName || existingBusinessName;
    const mergedDomain = domain || existingDomain;

    // Update cache for next save
    lastMergedResponsesRef.current = mergedResponses;
    lastMergedBusinessNameRef.current = mergedBusinessName;
    lastMergedDomainRef.current = mergedDomain;

    // Build payload from merged responses so the recovery JSON always reflects
    // the full set of known answers, not just the current form state.
    const mappedPayload = buildExpressSubmissionPayload({
      formData: mergedResponses,
      businessName: mergedBusinessName,
      domain: mergedDomain,
      sessionId,
      submitAttemptId
    });

    const now = safeNowIso();
    const isSubmitAttempted = status === "submit_attempted" || status === "submit_failed";
    const isSubmitted = status === "submitted";

    const draftMetadata = {
      app: "express_questionnaire",
      source: "real_time_draft",
      path: typeof window !== "undefined" ? window.location.pathname : "",
      userAgent: safeGetUserAgent(),
      schema_version: "2",
      normalized: true,
      normalization_source: "draft_save",
      merge_applied: true,
      normalization_error: normalizationError || ""
    };

    const draftRecord = {
      session_id: sessionId,
      business_name: mergedBusinessName,
      domain: mergedDomain,
      user_id: creds.userId,
      user_name: creds.userName,
      user_email: creds.userEmail,
      status,
      current_question_id: String(currentQuestionId || ""),
      last_changed_question_id: String(lastChangedQuestionId || ""),
      responses_json: safeJsonStringify(mergedResponses),
      validation_status_json: safeJsonStringify(normalizedValidationStatus),
      touched_questions_json: safeJsonStringify(normalizedTouchedQuestions),
      expanded_questions_json: safeJsonStringify(normalizedExpandedQuestions),
      metadata_json: safeJsonStringify(mappedPayload.metadata),
      userdata_json: safeJsonStringify(mappedPayload.userdata),
      mapped_payload_json: safeJsonStringify({ metadata: mappedPayload.metadata, userdata: mappedPayload.userdata }),
      draft_metadata_json: safeJsonStringify(draftMetadata),
      save_error: saveError || normalizationError || "",
      submit_error: submitError || "",
      final_submission_id: finalSubmissionId || "",
      submit_attempted_at: isSubmitAttempted ? now : "",
      submitted_at: isSubmitted ? now : "",
      last_changed_at: now,
      last_saved_at: now,
      ...(lastNonEmptyAnswers !== null ? { last_non_empty_answers_json: safeJsonStringify(lastNonEmptyAnswers) } : {}),
      ...(fieldHistory !== null ? { field_history_json: safeJsonStringify(fieldHistory) } : {}),
      ...(lastLocalPersistedAt ? { last_local_persisted_at: lastLocalPersistedAt } : {})
    };

    if (persistDraftRecord) {
      const result = await persistDraftRecord(draftRecord);
      if (result?.draftId) {
        draftRecordIdRef.current = result.draftId;
      }
      return result;
    }

    if (existing?.id) {
      await entities.FormDraft.update(existing.id, draftRecord);
    } else {
      const created = await entities.FormDraft.create(draftRecord);
      if (created?.id) {
        draftRecordIdRef.current = created.id;
      }
    }
  };
}

export function writeDraftFailureBackup({
  questionnaireSessionId,
  responses,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  error,
  submitAttemptId
}) {
  const key = `express_questionnaire_local_backup_${questionnaireSessionId}`;
  safeLocalStorageSet(key, {
    session_id: questionnaireSessionId,
    submit_attempt_id: submitAttemptId || "",
    responses: responses || {},
    validationStatus: validationStatus || {},
    touchedQuestions: touchedQuestions || {},
    expandedQuestions: expandedQuestions || {},
    error: serializeExpressError(error),
    savedAt: safeNowIso()
  });
}
