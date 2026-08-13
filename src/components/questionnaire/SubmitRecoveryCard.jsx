import React, { useState } from "react";
import { AlertCircle, RefreshCw, Copy, CheckCircle2, Clock } from "lucide-react";

/**
 * Shown when a submit attempt fails.
 * Lets the user retry or copy structured recovery details.
 *
 * Props:
 *   context: {
 *     businessName, businessDomain, sessionId,
 *     lastSubmitAttemptId, failedAt, recoveryCode,
 *     errorMessage, intakeId, intakeCaptured
 *   }
 *   isRetrying: bool
 *   onRetry: () => void
 *   onDismiss: () => void   -- optional, hides card
 */
export default function SubmitRecoveryCard({ context, isRetrying, onRetry, onDismiss }) {
  const [copied, setCopied] = useState(false);

  if (!context) return null;

  const {
    businessName,
    businessDomain,
    sessionId,
    lastSubmitAttemptId,
    failedAt,
    recoveryCode,
    errorMessage,
    intakeId,
    intakeCaptured,
  } = context;

  const displayCode = recoveryCode || sessionId || "—";
  const failedTime = failedAt ? new Date(failedAt).toLocaleString() : "—";

  const handleCopy = async () => {
    const lines = [
      "=== Express Questionnaire Recovery Details ===",
      `Session ID:          ${sessionId || "—"}`,
      `Recovery Code:       ${recoveryCode || "—"}`,
      `Business Name:       ${businessName || "—"}`,
      businessDomain ? `Business Domain:     ${businessDomain}` : null,
      `Submit Attempt ID:   ${lastSubmitAttemptId || "—"}`,
      intakeId ? `Intake ID:           ${intakeId}` : null,
      `Failed At:           ${failedTime}`,
      errorMessage ? `Error:               ${errorMessage}` : null,
      "==============================================",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(lines);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback: no-op
    }
  };

  return (
    <div
      className="mt-6 rounded-xl border-2 p-5 space-y-4"
      style={{ borderColor: "#FDB913", backgroundColor: "#FFFBF0" }}
      role="alert"
      aria-live="polite"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "#C8880A" }} />
        <div>
          <p className="font-bold text-base" style={{ color: "#7A4F00", fontFamily: "Raleway, sans-serif" }}>
            {intakeCaptured
              ? "Your answers were safely captured."
              : "Submission couldn't be confirmed — your answers are still saved."}
          </p>
          <p className="text-sm mt-0.5" style={{ color: "#8A6000", fontFamily: "Lato, sans-serif" }}>
            {intakeCaptured
              ? "Our team can complete the recovery using your code below. You may also try again."
              : "Nothing was lost. You can try submitting again below or contact support with your recovery code."}
          </p>
        </div>
      </div>

      {/* Details grid */}
      <div
        className="rounded-lg px-4 py-3 text-sm space-y-1.5"
        style={{ backgroundColor: "#FFF3CC", fontFamily: "Lato, sans-serif" }}
      >
        <DetailRow label="Your answers are still saved" value="✓ Preserved in this browser" />
        <DetailRow label="Recovery Code" value={displayCode} mono />
        <DetailRow label="Failed At" value={failedTime} />
        {intakeId && <DetailRow label="Intake ID" value={intakeId} mono />}
        {errorMessage && (
          <DetailRow label="Details" value={errorMessage} />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 pt-1">
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="flex items-center gap-2 px-5 py-2.5 font-bold text-sm uppercase tracking-wider transition-opacity disabled:opacity-50"
          style={{
            backgroundColor: "#8DC641",
            color: "white",
            borderRadius: "2px",
            fontFamily: "Lato, sans-serif",
            letterSpacing: "0.8px",
          }}
        >
          <RefreshCw className={`w-4 h-4 ${isRetrying ? "animate-spin" : ""}`} />
          {isRetrying ? "Retrying…" : "Try Submit Again"}
        </button>

        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-2 px-5 py-2.5 font-bold text-sm uppercase tracking-wider transition-opacity"
          style={{
            border: "2px solid #004B87",
            color: "#004B87",
            borderRadius: "2px",
            fontFamily: "Lato, sans-serif",
            letterSpacing: "0.8px",
            backgroundColor: "transparent",
          }}
        >
          {copied ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              Copy Recovery Details
            </>
          )}
        </button>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="px-4 py-2.5 text-sm transition-opacity"
            style={{ color: "#7D868D", fontFamily: "Lato, sans-serif" }}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start gap-2">
      <span className="font-semibold text-xs uppercase tracking-wide w-36 flex-shrink-0" style={{ color: "#8A6000" }}>
        {label}
      </span>
      <span className={`text-xs break-all ${mono ? "font-mono" : ""}`} style={{ color: "#5A3C00" }}>
        {value}
      </span>
    </div>
  );
}
