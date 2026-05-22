import { base44 } from "@/api/base44Client";
import { serializeExpressError } from "@/lib/expressQuestionnairePayload";

//lib/expressQuestionnairePayload";

// Default timeout for Zapier delivery
export const DEFAULT_ZAPIER_TIMEOUT_MS = 8000;

/**
 * Client-side timeout wrapper for promises
 * @param {Function} promiseFactory - Function that returns a promise
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<any>} - Resolves with promise result or rejects with timeout error
 */
export function withClientTimeout(promiseFactory, timeoutMs = DEFAULT_ZAPIER_TIMEOUT_MS) {
  return Promise.race([
    promiseFactory(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Build Zapier delivery payload from Express transformed payload
 * @param {Object} transformedPayload - Full Express transformed payload with metadata and userdata
 * @returns {Object} - Cleaned payload with only metadata and userdata for Zapier
 */
export function buildExpressZapierPayload(transformedPayload) {
  if (!transformedPayload || !transformedPayload.metadata || !transformedPayload.userdata) {
    throw new Error('Invalid transformed payload: missing metadata or userdata');
  }

  // Clean business domain using existing helper
  const cleanDomain = (domain) => {
    if (!domain) return "";
    const str = String(domain);
    return str
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '')
      .trim();
  };

  return {
    metadata: {
      business_name: transformedPayload.metadata.business_name || "",
      businessDomain: cleanDomain(transformedPayload.metadata.businessDomain || transformedPayload.metadata.business_domain || ""),
      submission_datetime: transformedPayload.metadata.submission_datetime || new Date().toISOString(),
      service_type: "express", // Force service_type to express
      questionnaire_session_id: transformedPayload.metadata.questionnaire_session_id || "",
    },
    userdata: { ...transformedPayload.userdata },
  };
}

/**
 * Send Express payload to Zapier via server-side function
 * @param {Object} payload - Express payload (metadata + userdata)
 * @param {Object} options - Optional configuration
 * @param {number} options.timeoutMs - Custom timeout in milliseconds
 * @returns {Promise<Object>} - Result with ok, error, zapierStatus, zapierBody
 */
export async function sendExpressZapierSafe(payload, options = {}) {
  const { timeoutMs = DEFAULT_ZAPIER_TIMEOUT_MS } = options;

  try {
    // Invoke server-side function with timeout
    const response = await withClientTimeout(
      () => base44.functions.invoke("sendExpressToZapier", payload),
      timeoutMs
    );

    const data = response?.data || response;

    // Check if server-side function reported failure
    if (data?.success === false) {
      return {
        ok: false,
        error: data.error || 'Zapier delivery failed',
        zapierStatus: data.zapierStatus || null,
        zapierBody: data.zapierBody || null,
      };
    }

    // Success
    return {
      ok: true,
      response: data,
    };
  } catch (error) {
    // Log error in development
    const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;
    if (isDev) {
      console.error('[sendExpressZapierSafe] Error:', serializeExpressError(error));
    }

    return {
      ok: false,
      error: error.message || 'Failed to invoke Zapier delivery function',
      zapierStatus: null,
      zapierBody: null,
    };
  }
}