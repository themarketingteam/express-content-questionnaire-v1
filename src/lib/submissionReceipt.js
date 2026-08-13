export function hasDurableSubmissionReceipt(result) {
  return Boolean(result?.submissionId || result?.intakeId);
}

export function wasSubmissionIntakeCaptured(result) {
  return Boolean(result?.receivedViaIntake || result?.intakeId);
}

export function isFinalSubmissionConfirmed(submitResult, zapierResult) {
  return Boolean(
    submitResult?.ok
    && hasDurableSubmissionReceipt(submitResult)
    && zapierResult?.ok,
  );
}
