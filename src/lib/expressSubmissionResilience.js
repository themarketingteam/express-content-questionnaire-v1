import { invokeExpressSubmissionFallback, buildExpressFallbackBody } from "@/lib/expressSubmissionFallback";

// Constants
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 1000;
const MAX_RAW_LENGTH = 500;

// Custom TimeoutError class
export class TimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

// Classify submit error into categories
export function classifySubmitError(error) {
  if (!error) return "unknown";

  const message = (error.message || "").toLowerCase();
  const name = (error.name || "").toLowerCase();
  const code = String(error.code || error.status || error.statusCode || "");

  // Timeout
  if (
    name === "timeouterror" ||
    code === "timeout" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    name === "aborterror" ||
    message.includes("aborted")
  ) {
    return "timeout";
  }

  // Auth errors
  if (
    code === "401" ||
    message.includes("401") ||
    message.includes("auth") ||
    message.includes("unauthorized") ||
    message.includes("session") ||
    message.includes("login") ||
    message.includes("token") ||
    message.includes("jwt")
  ) {
    return "auth";
  }

  // Permission errors
  if (
    code === "403" ||
    message.includes("403") ||
    message.includes("permission") ||
    message.includes("rls") ||
    message.includes("policy") ||
    message.includes("access denied") ||
    message.includes("forbidden")
  ) {
    return "permission";
  }

  // Rate limit
  if (
    code === "429" ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  ) {
    return "rate_limit";
  }

  // Schema errors
  if (
    (code === "400" || code === "422") &&
    (message.includes("schema") || message.includes("invalid type") || message.includes("required"))
  ) {
    return "schema";
  }

  // Validation errors
  if (
    (code === "400" || code === "422") &&
    (message.includes("validation") || message.includes("invalid value") || message.includes("does not match"))
  ) {
    return "validation";
  }

  // Network errors
  if (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("cors") ||
    message.includes("offline") ||
    message.includes("connection") ||
    name === "typeerror" && message.includes("fetch")
  ) {
    return "network";
  }

  // Server errors
  if (
    code.startsWith("5") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("internal server")
  ) {
    return "server";
  }

  return "unknown";
}

// Safely serialize error for storage
export function serializeSubmitError(error) {
  if (!error) return null;

  const serialized = {
    name: error.name || "Error",
    message: truncateString(error.message, MAX_MESSAGE_LENGTH),
    stack: error.stack ? truncateString(error.stack, MAX_STACK_LENGTH) : undefined,
    code: error.code || error.status || error.statusCode,
    kind: classifySubmitError(error),
  };

  // Add extra context if present
  if (error.response) {
    serialized.responseStatus = error.response.status;
    serialized.responseText = truncateString(
      typeof error.response.data === "string"
        ? error.response.data
        : JSON.stringify(error.response.data),
      MAX_RAW_LENGTH
    );
  }

  return JSON.stringify(serialized);
}

// Check if error is retryable
export function isRetryableSubmitError(error) {
  const kind = classifySubmitError(error);
  // Don't retry auth, permission, schema, or validation errors
  return !["auth", "permission", "schema", "validation"].includes(kind);
}

// Timeout wrapper for promises
export function withTimeout(promiseFactory, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return Promise.race([
    promiseFactory(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// Helper: truncate string
function truncateString(str, maxLength) {
  if (!str) return str;
  if (typeof str !== "string") str = String(str);
  return str.length > maxLength ? str.slice(0, maxLength) + "..." : str;
}

// Build Express payload feature summary
export function buildExpressPayloadFeatureSummary(payload) {
  const metadata = payload?.metadata || {};
  const userdata = payload?.userdata || {};

  const serviceOfferings = userdata?.service_offerings || [];
  const targetIndustries = userdata?.target_industries || [];
  const clientChallenges = userdata?.client_challenges || [];
  const clientOutcomes = userdata?.client_outcomes || [];

  return {
    serviceOfferingCount: serviceOfferings.length,
    targetIndustryCount: targetIndustries.length,
    clientChallengeCount: clientChallenges.length,
    clientOutcomeCount: clientOutcomes.length,
    hasDifferentiation: !!userdata?.differentiation,
    hasIdealClient: !!userdata?.ideal_client,
    hasGeographicArea: !!metadata?.geographic_area,
    payloadSizeChars: JSON.stringify(payload).length,
  };
}

// Build Express submit diagnostics
export function buildExpressSubmitDiagnostics(args) {
  const {
    questionnaireSessionId,
    businessName,
    domain,
    draftId,
    primaryResult,
    fallbackResult,
    browserOnline,
    pageUrl,
    userAgent,
    payload,
  } = args;

  return {
    questionnaireSessionId,
    businessNamePresent: !!businessName,
    domainPresent: !!domain,
    draftIdPresent: !!draftId,
    primaryOk: primaryResult?.ok || false,
    primaryFailureKind: primaryResult?.failureKind || null,
    primaryStatus: primaryResult?.error?.status || primaryResult?.error?.code || null,
    primaryCode: primaryResult?.error?.code || null,
    fallbackAttempted: !!fallbackResult,
    fallbackOk: fallbackResult?.ok || false,
    fallbackFailureKind: fallbackResult?.failureKind || null,
    fallbackStatus: fallbackResult?.error?.status || fallbackResult?.error?.code || null,
    usedFallback: fallbackResult?.usedFallback || false,
    browserOnline: browserOnline ?? navigator.onLine,
    pageUrlPresent: !!pageUrl,
    userAgentPresent: !!userAgent,
    payloadSizeChars: payload ? JSON.stringify(payload).length : 0,
    payloadFeatureSummary: payload ? buildExpressPayloadFeatureSummary(payload) : null,
    timestamp: new Date().toISOString(),
  };
}

// Create FormSubmission with fallback
export async function createExpressFormSubmissionWithFallback(args) {
  const {
    payload,
    formSubmissionRecord,
    responseSnapshot,
    rawResponses,
    transformFailed,
    transformError,
    validationFailed,
    validationError,
    questionnaireSessionId,
    draftId,
    submitContext,
    diagnostics,
    onPrimaryFailure: _onPrimaryFailure,
    onFallbackAttempt,
    onFallbackSuccess,
    onFallbackFailure,
  } = args;

  // Server is now the primary submit path — skip direct browser entity creation
  // and go directly to the server fallback function for all valid payloads.
  if (formSubmissionRecord || transformFailed || validationFailed) {
    if (onFallbackAttempt) {
      onFallbackAttempt();
    }

    const fallbackBody = buildExpressFallbackBody({
      transformedPayload: payload,
      responseSnapshot,
      rawResponses,
      transformFailed,
      transformError,
      validationFailed,
      validationError,
      questionnaireSessionId,
      draftId,
      submitContext,
      diagnostics,
      primaryError: null,
    });

    const fallbackResult = await invokeExpressSubmissionFallback(fallbackBody);

    if (fallbackResult.ok) {
      if (onFallbackSuccess) {
        onFallbackSuccess(fallbackResult);
      }

      // intakeId-only is a full success — admin can recover
      const submissionId = fallbackResult.submissionId || null;
      const intakeId = fallbackResult.intakeId || null;
      const receivedViaIntake = !submissionId && !!intakeId;

      return {
        ok: true,
        accepted: true,
        submission: fallbackResult.submission || null,
        submissionId,
        intakeId,
        submissionCreated: !!submissionId,
        receivedViaIntake,
        usedFallback: true,
        primaryResult: null,
        fallbackResult,
      };
    }

    if (onFallbackFailure) {
      onFallbackFailure(fallbackResult);
    }

    return {
      ok: false,
      submission: null,
      error: fallbackResult.error,
      usedFallback: true,
      failureKind: fallbackResult.failureKind,
      primaryResult: null,
      fallbackResult,
    };
  }

  // Nothing to submit
  return {
    ok: false,
    submission: null,
    error: new Error("No valid submission record and no fallback trigger"),
    usedFallback: false,
    failureKind: "unknown",
    primaryResult: null,
    fallbackResult: null,
  };
}
