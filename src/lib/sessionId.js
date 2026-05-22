const SESSION_STORAGE_KEY = "express_questionnaire_session_id";

const createSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `express_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

export const getOrCreateQuestionnaireSessionId = () => {
  try {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const id = createSessionId();
    localStorage.setItem(SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    return createSessionId();
  }
};

export const clearQuestionnaireSessionId = () => {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
};