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
    async bootstrapNewClient(identity = {}, newClientRequestId, capabilities = {}, attempt = 1) {
      try {
        return await request({
          action: "bootstrap_new_client",
          identity,
          newClientRequestId,
          ...capabilities,
          attempt,
        });
      } catch (error) {
        const details = /** @type {any} */ (error);
        const serverMessage = String(details.response?.data?.error || details.message || "");
        const rollingDeploymentFallback = Number(details.status || details.response?.status || 0) === 400
          && /unsupported action/i.test(serverMessage);
        if (!rollingDeploymentFallback) throw error;

        // Older anonymous function routes may briefly lag the deployed backend.
        // The identity has already been rotated and persisted in the URL, so the
        // established bootstrap action still creates an isolated, retry-safe draft.
        const result = await request({ action: "bootstrap", identity, ...capabilities, attempt });
        return { ...result, newClient: true, rollingDeploymentFallback: true };
      }
    },
    async load() {
      const data = await request({ action: "load" });
      return data.draft || null;
    },
    async save(draft) {
      return request({ action: "save", draft });
    },
    async checkpoint(draft, checkpointType) {
      return request({ action: "checkpoint", draft, checkpointType });
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

export function createLatestDraftSaveQueue(saveDraft) {
  let running = false;
  let queued = null;
  let queuedWaiters = [];

  const drain = async (draft, waiters) => {
    running = true;
    try {
      const result = await saveDraft(draft);
      for (const waiter of waiters) waiter.resolve(result);
    } catch (error) {
      for (const waiter of waiters) waiter.reject(error);
    } finally {
      if (queued) {
        const next = queued;
        const nextWaiters = queuedWaiters;
        queued = null;
        queuedWaiters = [];
        void drain(next, nextWaiters);
      } else {
        running = false;
      }
    }
  };

  return (draft) => new Promise((resolve, reject) => {
    if (!running) {
      void drain(draft, [{ resolve, reject }]);
      return;
    }
    queued = draft;
    queuedWaiters.push({ resolve, reject });
  });
}
