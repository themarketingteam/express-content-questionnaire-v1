function responseData(response) {
  return response?.data || response || {};
}

export function createQuestionnaireDraftApi({ invoke, sessionId, accessKey }) {
  if (typeof invoke !== "function") throw new Error("A Base44 function invoker is required.");

  const request = async (body) => {
    const response = await invoke("questionnaireDraftData", {
      ...body,
      sessionId,
      accessKey,
    });
    const data = responseData(response);
    if (!data.success) throw new Error(data.error || "The questionnaire draft request failed.");
    return data;
  };

  return {
    async load() {
      const data = await request({ action: "load" });
      return data.draft || null;
    },
    async save(draft) {
      return request({ action: "save", draft });
    },
  };
}

export function createSerialDraftSaveQueue(saveDraft) {
  let saveChain = Promise.resolve();
  return (draft) => {
    const pendingSave = saveChain
      .catch(() => undefined)
      .then(() => saveDraft(draft));
    saveChain = pendingSave;
    return pendingSave;
  };
}
