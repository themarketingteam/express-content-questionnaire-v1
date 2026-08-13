function parseObject(value, fallback = {}) {
  if (!value) return fallback;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function buildPersistedStateFromRemoteDraft(draft, sessionId) {
  if (!draft?.responses_json) return null;
  return {
    version: 2,
    savedAt: draft.last_saved_at || draft.updated_date || draft.created_date || "",
    questionnaireSessionId: draft.session_id || sessionId || "",
    formData: parseObject(draft.responses_json),
    validationStatus: parseObject(draft.validation_status_json),
    touchedQuestions: parseObject(draft.touched_questions_json),
    expandedQuestions: parseObject(draft.expanded_questions_json),
  };
}

function savedAtMs(state) {
  return new Date(state?.savedAt || 0).getTime() || 0;
}

export function selectNewestPersistedState(localState, remoteState) {
  if (!localState) return remoteState ? { state: remoteState, source: "server_draft" } : { state: null, source: null };
  if (!remoteState) return { state: localState, source: "local" };
  return savedAtMs(remoteState) > savedAtMs(localState)
    ? { state: remoteState, source: "server_draft" }
    : { state: localState, source: "local" };
}

export function parseRemoteAnswerHistory(draft) {
  return parseObject(draft?.last_non_empty_answers_json, null);
}
