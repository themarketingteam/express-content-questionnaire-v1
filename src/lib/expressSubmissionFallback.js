import { base44 } from "@/api/base44Client";

// Constants
const DEFAULT_FALLBACK_TIMEOUT_MS = 15000;
const DEFAULT_FALLBACK_ATTEMPTS = 2;

// Safe error serializer (fallback if not available from payload utils)
function serializeErrorSafe(error) {
  if (!error) return null;
  if (typeof error === "string") {
    try {
      return JSON.stringify({ message: error });
    } catch {
      return JSON.stringify({ message: "Unknown error" });
    }
  }
  try {
    return JSON.stringify({
      message: error?.message || "Unknown error",
      name: error?.name || "Error",
      status: error?.status || error?.response?.status,
      statusText: error?.statusText || error?.response?.statusText,
      kind: error?.failureKind || null,
    });
  } catch {
    return JSON.stringify({ message: "Serialization failed" });
  }
}

// Timer API for timeout management
function getTimerApi() {
  let timeoutId = null;
  let timeoutPromise = null;

  const createTimeout = (ms) => {
    timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error("Fallback invocation timed out");
        error.failureKind = "timeout";
        error.isTimeout = true;
        reject(error);
      }, ms);
    });
  };

  const clearTimeout = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    timeoutPromise = null;
  };

  return { createTimeout, clearTimeout, getTimeoutPromise: () => timeoutPromise };
}

// Delay helper
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wrap promise with timeout
async function withFallbackTimeout(promiseFactory, timeoutMs = DEFAULT_FALLBACK_TIMEOUT_MS) {
  const timer = getTimerApi();
  timer.createTimeout(timeoutMs);

  try {
    const result = await Promise.race([promiseFactory(), timer.getTimeoutPromise()]);
    return result;
  } finally {
    timer.clearTimeout();
  }
}

// Determine if fallback error is retryable
function isRetryableFallbackError(error) {
  if (!error) return false;

  const kind = error?.failureKind || error?.kind;
  const status = error?.status || error?.response?.status;
  const message = error?.message?.toLowerCase() || "";

  // Explicit timeout
  if (kind === "timeout" || error?.isTimeout) return true;

  // Network errors
  if (kind === "network") return true;
  if (message.includes("fetch") || message.includes("network") || message.includes("cors") || message.includes("offline")) return true;

  // Rate limit
  if (kind === "rate_limit" || status === 429) return true;

  // Server errors
  if (kind === "server" || (status && status >= 500 && status <= 599)) return true;

  // Unknown errors without HTTP status (likely network-related)
  if (kind === "unknown" && !status) return true;

  return false;
}

// Build fallback request body
export function buildExpressFallbackBody({
  transformedPayload,
  rawResponses,
  responseSnapshot,
  questionnaireSessionId,
  transformFailed,
  validationFailed,
  transformError,
  validationError,
  primaryError,
  submitContext,
  diagnostics,
}) {
  return {
    transformedPayload: transformedPayload || null,
    rawResponses: rawResponses || null,
    responseSnapshot: responseSnapshot || null,
    questionnaireSessionId: questionnaireSessionId || null,
    transformFailed: Boolean(transformFailed),
    validationFailed: Boolean(validationFailed),
    transformError: transformError ? serializeErrorSafe(transformError) : null,
    validationError: validationError ? serializeErrorSafe(validationError) : null,
    primaryError: primaryError
      ? {
          failureKind: primaryError?.failureKind || primaryError?.kind || "unknown",
          message: primaryError?.message || "Unknown error",
          serialized: serializeErrorSafe(primaryError),
        }
      : null,
    submitContext: submitContext || null,
    diagnostics: diagnostics || null,
  };
}

// Main fallback invocation function
export async function invokeExpressSubmissionFallback(body, options = {}) {
  const {
    attempts = DEFAULT_FALLBACK_ATTEMPTS,
    timeoutMs = DEFAULT_FALLBACK_TIMEOUT_MS,
    baseDelayMs = 1000,
  } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await withFallbackTimeout(
        () => base44.functions.invoke("submitExpressQuestionnaireFallback", body),
        timeoutMs
      );

      const data = result?.data || result;

      return {
        ok: true,
        data,
        received: Boolean(data?.received),
        submissionCreated: Boolean(data?.submissionCreated),
        submission: data?.submission || null,
        submissionId: data?.submissionId || data?.submission?.id || "",
        intakeId: data?.intakeId || "",
        usedFallback: true,
        zapierSent: Boolean(data?.zapierSent),
      };
    } catch (error) {
      lastError = error;

      // Determine if we should retry
      const shouldRetry = attempt < attempts && isRetryableFallbackError(error);

      if (shouldRetry) {
        const delayMs = baseDelayMs * attempt;
        await delay(delayMs);
        continue;
      }

      // Non-retryable or final attempt failed
      return {
        ok: false,
        data: null,
        error: {
          message: error?.message || "Fallback invocation failed",
          failureKind: error?.failureKind || error?.kind || "unknown",
          isTimeout: error?.isTimeout || false,
          status: error?.status || error?.response?.status,
          serialized: serializeErrorSafe(error),
        },
        received: false,
        submissionCreated: false,
        submission: null,
        submissionId: "",
        intakeId: "",
        usedFallback: true,
      };
    }
  }

  // Fallback after all attempts exhausted
  return {
    ok: false,
    data: null,
    error: {
      message: lastError?.message || "Fallback invocation failed after all attempts",
      failureKind: lastError?.failureKind || lastError?.kind || "unknown",
      isTimeout: lastError?.isTimeout || false,
      status: lastError?.status || lastError?.response?.status,
      serialized: serializeErrorSafe(lastError),
    },
    received: false,
    submissionCreated: false,
    submission: null,
    submissionId: "",
    intakeId: "",
    usedFallback: true,
  };
}

// Named exports for clarity
export {
  DEFAULT_FALLBACK_TIMEOUT_MS,
  DEFAULT_FALLBACK_ATTEMPTS,
  getTimerApi,
  delay,
  withFallbackTimeout,
  isRetryableFallbackError,
  serializeErrorSafe,
};