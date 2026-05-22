import { base44 } from "@/api/base44Client";
import { serializeSubmitError } from "@/lib/expressSubmissionResilience";
import { cleanExpressDomain } from "@/lib/expressQuestionnairePayload";

// Constants
export const DEFAULT_ZAPIER_TIMEOUT_MS = 8000;

/**
 * Timeout wrapper for promises with client-side protection.
 * @param {Function} promiseFactory - Function that returns a promise
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise} - Resolves with promise result or rejects with TimeoutError
 */
export function withClientTimeout(promiseFactory, timeoutMs = DEFAULT_ZAPIER_TIMEOUT_MS) {
  return Promise.race([
    promiseFactory(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Zapier delivery timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Build a clean Express Zapier payload from the full transformed payload.
 * @param {Object} payload - Full Express transformed payload with metadata and userdata
 * @returns {Object} - Clean payload with only metadata and userdata
 */
export function buildExpressZapierPayload(payload) {
  if (!payload || !payload.metadata || !payload.userdata) {
    throw new Error("Invalid Express payload: missing metadata or userdata");
  }

  // Clean business domain
  const businessDomain = cleanExpressDomain(payload.metadata.businessDomain);

  return {
    metadata: {
      ...payload.metadata,
      businessDomain: businessDomain,
      service_type: "express", // Force express service type
    },
    userdata: { ...payload.userdata },
  };
}

/**
 * Send Express questionnaire payload to Zapier via server-side function.
 * Never exposes the raw webhook URL to the browser.
 * 
 * @param {Object} payload - Express payload with metadata and userdata
 * @param {Object} options - Optional configuration
 * @param {number} options.timeoutMs - Client-side timeout in ms (default: 8000)
 * @returns {Promise<Object>} - Normalized result: { ok: boolean, error?, response?, zapierStatus?, zapierBody? }
 */
export async function sendExpressZapierSafe(payload, options = {}) {
  const { timeoutMs = DEFAULT_ZAPIER_TIMEOUT_MS } = options;

  try {
    // Build clean payload (metadata + userdata only)
    const cleanPayload = buildExpressZapierPayload(payload);

    // Invoke server-side function with timeout protection
    const response = await withClientTimeout(
      () => base44.functions.invoke("sendExpressToZapier", cleanPayload),
      timeoutMs
    );

    // Check response success
    if (response?.data?.success === false) {
      // Server-side Zapier call failed
      const result = {
        ok: false,
        error: response.data.error || "Zapier delivery failed",
        zapierStatus: response.data.zapierStatus || null,
        zapierBody: response.data.zapierBody || null,
      };

      // Log in development
      if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
        console.warn("[Express Zapier] Delivery failed:", result);
      }

      return result;
    }

    // Success
    const result = {
      ok: true,
      response: response.data,
    };

    // Log in development
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
      console.log("[Express Zapier] Delivery successful:", result);
    }

    return result;
  } catch (error) {
    // Client-side error (timeout, network, etc.)
    const result = {
      ok: false,
      error: error?.message || "Zapier delivery failed",
    };

    // Log in development
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
      console.error("[Express Zapier] Delivery error:", error);
    }

    return result;
  }
}