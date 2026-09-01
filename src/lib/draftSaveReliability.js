function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function classifyDraftFailure(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const message = String(error?.message || "").toLowerCase();
  if (status === 400) return { code: "invalid_request", retryable: false };
  if (status === 401 || status === 403) return { code: "access_denied", retryable: false };
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return { code: `http_${status}`, retryable: true };
  }
  if (message.includes("offline")) return { code: "offline", retryable: true };
  if (message.includes("timeout")) return { code: "timeout", retryable: true };
  if (message.includes("network") || message.includes("fetch") || message.includes("cors")) {
    return { code: "network_blocked", retryable: true };
  }
  return { code: status ? `http_${status}` : "unknown", retryable: true };
}

export async function retryDraftOperation(operation, {
  delays = [750, 1500, 3000, 6000],
  sleep = wait,
  onRetry = (_event) => {},
  onExhausted = (_event) => {},
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= delays.length + 1; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const failure = classifyDraftFailure(error);
      if (!failure.retryable || attempt > delays.length) {
        onExhausted({ attempt, error, ...failure });
        throw error;
      }
      onRetry({ attempt, nextAttempt: attempt + 1, delayMs: delays[attempt - 1], error, ...failure });
      await sleep(delays[attempt - 1]);
    }
  }
  throw lastError || new Error("Draft persistence failed.");
}

export function createKeepaliveDraftSaver({ endpoint, sessionId, accessKey, fetchImpl = fetch }) {
  if (!endpoint || !sessionId || !accessKey) throw new Error("A complete keepalive draft configuration is required.");
  return async function keepaliveSave(draft) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", sessionId, accessKey, draft }),
      keepalive: true,
      credentials: "omit",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const error = Object.assign(
        new Error(data.error || `Draft flush failed (${response.status}).`),
        { status: response.status },
      );
      throw error;
    }
    return data;
  };
}

export function attachDraftLifecycleFlush({
  documentTarget,
  windowTarget,
  getPendingDraft,
  flushDraft,
  retryPendingDraft,
  onLifecycleEvent = (_eventType, _draft) => {},
}) {
  const flush = (eventType) => {
    const draft = getPendingDraft();
    if (!draft) return;
    onLifecycleEvent(eventType, draft);
    void flushDraft(draft).catch(() => undefined);
  };
  const onVisibilityChange = () => {
    if (documentTarget.visibilityState === "hidden") flush("visibility_flush");
  };
  const onPageHide = () => flush("pagehide_flush");
  const onOnline = () => {
    onLifecycleEvent("online_recovery", getPendingDraft());
    void retryPendingDraft();
  };

  documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  windowTarget.addEventListener("pagehide", onPageHide);
  windowTarget.addEventListener("online", onOnline);

  return () => {
    documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
    windowTarget.removeEventListener("pagehide", onPageHide);
    windowTarget.removeEventListener("online", onOnline);
  };
}
