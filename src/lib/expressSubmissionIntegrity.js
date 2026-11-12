import { inspectExpressSubmissionIntegrity } from "../../base44/shared/expressSubmissionIntegrity.js";

export const SUBMISSION_INTEGRITY_MESSAGE = "We could not safely prepare all of your answers for submission. Your answers are still available. Please retry or contact support with your recovery code.";

/** Fail before persistence or delivery if transformation changes a captured answer. */
export function requireExpressSubmissionIntegrity(responses, payload) {
  const result = inspectExpressSubmissionIntegrity(responses, payload);
  if (!result.ok) {
    throw Object.assign(new Error(SUBMISSION_INTEGRITY_MESSAGE), {
      code: "payload_integrity_mismatch",
      safeMessage: SUBMISSION_INTEGRITY_MESSAGE,
      mismatchedFields: result.mismatchedFields,
    });
  }
  return result;
}
