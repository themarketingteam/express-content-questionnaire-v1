import { base44 } from "@/api/base44Client";
import { serializeExpressError } from "@/lib/expressQuestionnairePayload";

const DEFAULT_FALLBACK_TIMEOUT_MS = 30000;
const DEFAULT_FALLBACK_ATTEMPTS = 2;

// Timer API for timeout wrapper
function getTimerApi() {
  let timeoutId = null;
  let settled = false;

  const clear = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const withTimeout = (promise, timeoutMs) => {
    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          clear();
          reject(new Error("Fallback invocation timed out"));
        }
      }, timeoutMs);

      promise
        .then((value) => {
          if (!settled) {
            settled = true;
            clear();
            resolve(value);
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            clear();
            reject(err);
          }
        });
    });
  };

  return { withTimeout, clear };
}

// Simple delay helper
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wrap a promise factory in a timeout
async function withFallbackTimeout(promiseFactory, timeoutMs = DEFAULT_FALLBACK_TIMEOUT_MS) {
  const timer = getTimerApi();
  try {
    return await timer.withTimeout(promiseFactory(), timeoutMs);
  } finally {
    timer.clear();
  }
}

// Determine if an error is retryable
function isRetryableFallbackError(error) {
  if (!error) return false;

  const message = (error.message || "").toLowerCase();
  const kind = (error.failureKind || "").toLowerCase();
  const status = error.status ?? error.code ?? null;

  // Explicit failure kinds
  if (["timeout", "network", "rate_limit", "server", "unknown"].includes(kind)) {
    return true;
  }

  // Timeout indicators
  if (message.includes("timed out") || message.includes("timeout") || message.includes("aborted")) {
    return true;
  }

  // Network indicators
  if (message.includes("network") || message.includes("fetch") || message.includes("cors") || message.includes("offline")) {
    return true;
  }

  // Rate limit
  if (status === 429) {
    return true;
  }

  // Server errors
  if (status && status >= 500 && status < 600) {
    return true;
  }

  // Unknown without HTTP status -> retry once
  if (kind === "unknown" && !status) {
    return true;
  }

  return false;
}

// Normalize error for safe serialization
function normalizeFallbackError(error) {
  const serialized = serializeExpressError(error);
  return {
    message: error?.message || "Fallback invocation failed",
    failureKind: error?.failureKind || "unknown",
    status: error?.status ?? null,
    serialized,
  };
}

// Build the fallback body expected by submitExpressQuestionnaireFallback
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
    questionnaireSessionId: questionnaireSessionId || "",
    transformFailed: Boolean(transformFailed),
    validationFailed: Boolean(validationFailed),
    transformError: transformError ? serializeExpressError(transformError) : null,
    validationError: validationError ? serializeExpressError(validationError) : null,
    primaryError: primaryError ? serializeExpressError(primaryError) : null,
    submitContext: submitContext || null,
    diagnostics: diagnostics || null,
  };
}

// Invoke the server fallback function with timeout and retry
export async function invokeExpressSubmissionFallback(body, options = {}) {
  const {
    attempts = DEFAULT_FALLBACK_ATTEMPTS,
    timeoutMs = DEFAULT_FALLBACK_TIMEOUT_MS,
    baseDelayMs = 500,
  } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await withFallbackTimeout(
        () => base44.functions.invoke("submitExpressQuestionnaireFallback", body),
        timeoutMs
      );

      const data = result?.data || result;

      // Accept: success:true OR received:true OR intakeId present
      if (data?.success || data?.received || data?.intakeId) {
        const submissionId = data?.submissionId || data?.submission?.id || "";
        const intakeId = data?.intakeId || "";
        return {
          ok: true,
          data,
          received: Boolean(data?.received || data?.success),
          submissionCreated: Boolean(data?.submissionCreated),
          submission: data?.submission || null,
          submissionId,
          intakeId,
          usedFallback: true,
          zapierSent: Boolean(data?.zapierSent),
        };
      }

      // Treat unexpected shape as failure
      lastError = new Error("Fallback returned unexpected response");
      lastError.failureKind = "unknown";
    } catch (err) {
      lastError = err;
      lastError.failureKind = err?.failureKind || "unknown";

      // Retry only if retryable and attempts remain
      if (isRetryableFallbackError(err) && attempt < attempts) {
        const delayMs = baseDelayMs * attempt;
        await delay(delayMs);
        continue;
      }

      // Non-retryable or out of attempts
      break;
    }
  }

  const normalizedError = normalizeFallbackError(lastError);

  return {
    ok: false,
    data: null,
    error: normalizedError,
    received: false,
    submissionCreated: false,
    submission: null,
    submissionId: "",
    intakeId: "",
    usedFallback: true,
  };
}