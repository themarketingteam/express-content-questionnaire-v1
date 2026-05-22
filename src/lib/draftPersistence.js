/**
 * Express Draft Persistence Helper
 * Manages server-side draft snapshots in the FormDraft entity.
 */

import {
  buildExpressSubmissionPayload,
  safeJsonStringify,
  serializeExpressError,
} from "./expressQuestionnairePayload.js";

// ─── Browser-safe internal helpers ───────────────────────────────────────────

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
    // ignore storage errors
  }
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

export function sanitizeCredentialsForDraft(credentials = {}) {
  return {
    businessName: credentials.businessName || "",
    domain: credentials.domain || "",
    userId: credentials.userId || "",
    userName: credentials.userName || "",
    userEmail: credentials.userEmail || "",
  };
}

export function createFindExistingDraftBySessionId({ draftRecordIdRef }) {
  return async function findExistingDraftBySessionId({ sessionId, entities }) {
    if (draftRecordIdRef.current) {
      return { id: draftRecordIdRef.current };
    }

    const drafts = await entities.FormDraft.filter({ session_id: sessionId });

    if (!drafts || drafts.length === 0) {
      return null;
    }

    // Sort newest first by last_saved_at, falling back to created_date
    const sorted = [...drafts].sort((a, b) => {
      const dateA = new Date(a.last_saved_at || a.created_date || 0).getTime();
      const dateB = new Date(b.last_saved_at || b.created_date || 0).getTime();
      return dateB - dateA;
    });

    const newest = sorted[0];
    draftRecordIdRef.current = newest.id;
    return newest;
  };
}

export function createSaveDraftSnapshot({ entities, draftRecordIdRef, findExistingDraftBySessionId }) {
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
  }) {
    const sanitized = sanitizeCredentialsForDraft(credentials);
    const businessName = businessNameParam || sanitized.businessName || "";
    const domain = domainParam || sanitized.domain || "";

    const mappedPayload = buildExpressSubmissionPayload({
      formData: responses || {},
      businessName,
      domain,
      sessionId,
    });

    const now = safeNowIso();

    const isSubmitAttempt = status === "submit_attempted" || status === "submit_failed";
    const isSubmitted = status === "submitted";

    let safePath = "";
    try {
      safePath = window?.location?.pathname || "";
    } catch {
      safePath = "";
    }

    const draftRecord = {
      session_id: sessionId,
      business_name: businessName,
      domain,
      user_id: sanitized.userId,
      user_name: sanitized.userName,
      user_email: sanitized.userEmail,
      status,
      current_question_id: currentQuestionId || "",
      last_changed_question_id: lastChangedQuestionId || "",
      responses_json: safeJsonStringify(responses || {}),
      validation_status_json: safeJsonStringify(validationStatus || {}),
      touched_questions_json: safeJsonStringify(touchedQuestions || []),
      expanded_questions_json: safeJsonStringify(expandedQuestions || []),
      metadata_json: safeJsonStringify(mappedPayload.metadata),
      userdata_json: safeJsonStringify(mappedPayload.userdata),
      mapped_payload_json: safeJsonStringify(mappedPayload),
      draft_metadata_json: safeJsonStringify({
        app: "express_questionnaire",
        source: "real_time_draft",
        path: safePath,
        userAgent: safeGetUserAgent(),
      }),
      save_error: saveError ? serializeExpressError(saveError) : "",
      submit_error: submitError ? serializeExpressError(submitError) : "",
      final_submission_id: finalSubmissionId || "",
      submit_attempted_at: isSubmitAttempt ? now : "",
      submitted_at: isSubmitted ? now : "",
      last_changed_at: now,
      last_saved_at: now,
    };

    const existing = await findExistingDraftBySessionId({ sessionId, entities });

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
}) {
  safeLocalStorageSet(
    `express_questionnaire_local_backup_${questionnaireSessionId}`,
    {
      session_id: questionnaireSessionId,
      responses,
      validationStatus,
      touchedQuestions,
      expandedQuestions,
      error: serializeExpressError(error),
      savedAt: safeNowIso(),
    }
  );
}