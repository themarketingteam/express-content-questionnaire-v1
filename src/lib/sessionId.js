import {
  clearQuestionnaireDraftIdentity,
  getOrCreateQuestionnaireDraftIdentity,
} from "./questionnaireDraftIdentity.js";

export const getOrCreateQuestionnaireSessionId = () => {
  return getOrCreateQuestionnaireDraftIdentity().sessionId;
};

export const clearQuestionnaireSessionId = () => {
  clearQuestionnaireDraftIdentity();
};

export { getOrCreateQuestionnaireDraftIdentity };
