/**
 * Express draft persistence helper.
 * Mirrors the Pro draft persistence architecture for FormDraft (Express-specific entity).
 */

import {
  buildExpressSubmissionPayload,
  safeJsonStringify,
  serializeExpressError
} from "@/lib/expressQuestionnairePayload";

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
    finalSubmissionId = ""
  }) {
    const creds = sanitizeCredentialsForDraft(credentials);
    const businessName = businessNameParam || creds.businessName || "";
    const domain = domainParam || creds.domain || "";

    const mappedPayload = buildExpressSubmissionPayload({
      formData: responses || {},
      businessName,
      domain,
      sessionId
    });

    const now = safeNowIso();
    const isSubmitAttempted = status === "submit_attempted" || status === "submit_failed";
    const isSubmitted = status === "submitted";

    const draftMetadata = {
      app: "express_questionnaire",
      source: "real_time_draft",
      path: typeof window !== "undefined" ? window.location.pathname : "",
      userAgent: safeGetUserAgent()
    };

    const draftRecord = {
      session_id: sessionId,
      business_name: businessName,
      domain,
      user_id: creds.userId,
      user_name: creds.userName,
      user_email: creds.userEmail,
      status,
      current_question_id: String(currentQuestionId || ""),
      last_changed_question_id: String(lastChangedQuestionId || ""),
      responses_json: safeJsonStringify(responses || {}),
      validation_status_json: safeJsonStringify(validationStatus || {}),
      touched_questions_json: safeJsonStringify(touchedQuestions || {}),
      expanded_questions_json: safeJsonStringify(expandedQuestions || {}),
      metadata_json: safeJsonStringify(mappedPayload.metadata),
      userdata_json: safeJsonStringify(mappedPayload.userdata),
      mapped_payload_json: safeJsonStringify({ metadata: mappedPayload.metadata, userdata: mappedPayload.userdata }),
      draft_metadata_json: safeJsonStringify(draftMetadata),
      save_error: saveError || "",
      submit_error: submitError || "",
      final_submission_id: finalSubmissionId || "",
      submit_attempted_at: isSubmitAttempted ? now : "",
      submitted_at: isSubmitted ? now : "",
      last_changed_at: now,
      last_saved_at: now
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
  error
}) {
  const key = `express_questionnaire_local_backup_${questionnaireSessionId}`;
  safeLocalStorageSet(key, {
    session_id: questionnaireSessionId,
    responses: responses || {},
    validationStatus: validationStatus || {},
    touchedQuestions: touchedQuestions || {},
    expandedQuestions: expandedQuestions || {},
    error: serializeExpressError(error),
    savedAt: safeNowIso()
  });
}