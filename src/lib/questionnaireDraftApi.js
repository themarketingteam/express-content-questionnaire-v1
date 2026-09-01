function responseData(response) {
  return response?.data || response || {};
}

export function createQuestionnaireDraftApi({ invoke, sessionId, accessKey, requestTimeoutMs = 12000 }) {
  if (typeof invoke !== "function") throw new Error("A Base44 function invoker is required.");

  const request = async (body) => {
    try {
      let timeoutId;
      const response = await Promise.race([
        invoke("questionnaireDraftData", {
          ...body,
          sessionId,
          accessKey,
        }),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(Object.assign(
            new Error("The questionnaire draft request timed out."),
            { code: "timeout", status: 408 },
          )), requestTimeoutMs);
        }),
      ]).finally(() => clearTimeout(timeoutId));
      const data = responseData(response);
      if (!data.success) {
        const error = Object.assign(
          new Error(data.error || "The questionnaire draft request failed."),
          {
            status: Number(response?.status || 0),
            code: data.code || "",
          },
        );
        throw error;
      }
      return data;
    } catch (error) {
      if (error && typeof error === "object") {
        const details = /** @type {any} */ (error);
        Object.assign(error, {
          status: Number(details.status || details.response?.status || 0),
          code: details.code || details.response?.data?.code || "",
        });
      }
      throw error;
    }
  };

  return {
    async bootstrap(identity = {}, capabilities = {}, attempt = 1) {
      return request({ action: "bootstrap", identity, ...capabilities, attempt });
    },
    async load() {
      const data = await request({ action: "load" });
      return data.draft || null;
    },
    async save(draft) {
      return request({ action: "save", draft });
    },
    async telemetry(eventType, telemetry = {}) {
      return request({ action: "telemetry", eventType, telemetry });
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
