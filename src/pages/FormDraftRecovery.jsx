import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown, ChevronUp, Copy, AlertTriangle, CheckCircle2,
  Loader2, RefreshCw, Wrench, Stethoscope, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import LocalRecoveryBackupsPanel from "@/components/admin/LocalRecoveryBackupsPanel";
import { writeLocalFailedSubmissionBackup } from "@/lib/localRecoveryBackup";
import QuestionnaireIntakeRecovery from "@/components/admin/QuestionnaireIntakeRecovery";
import { normalizeExpressSubmitIntakePayload } from "@/lib/adminExpressIntakePayload";
import { buildExpressDraftSubmissionPreview } from "@/lib/expressDraftSubmissionPreview";
import PayloadEditor from "@/components/admin/PayloadEditor";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function canParseJson(value) {
  if (!value) return false;
  try { JSON.parse(value); return true; } catch { return false; }
}

function formatDate(value) {
  if (!value) return "—";
  try { const d = new Date(value); return isNaN(d.getTime()) ? "—" : d.toLocaleString(); } catch { return "—"; }
}

const STATUS_BADGE = {
  draft: "bg-slate-100 text-slate-700 border-slate-300",
  submit_attempted: "bg-yellow-50 text-yellow-800 border-yellow-300",
  submit_failed: "bg-red-50 text-red-700 border-red-300",
  submitted: "bg-green-50 text-green-700 border-green-300",
  auto_repair_pending: "bg-blue-50 text-blue-700 border-blue-300",
  auto_repair_failed: "bg-red-100 text-red-800 border-red-400",
};

const AI_REPAIR_STATUS_STYLE = {
  diagnosed: "bg-blue-50 text-blue-700 border-blue-200",
  repaired: "bg-violet-50 text-violet-700 border-violet-200",
  applied: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  needs_manual_review: "bg-amber-50 text-amber-700 border-amber-200",
};

function StatusBadge({ status }) {
  const cls = STATUS_BADGE[status] || "bg-slate-100 text-slate-600 border-slate-300";
  return <Badge variant="outline" className={`text-xs font-medium border ${cls}`}>{status || "unknown"}</Badge>;
}

function Detail({ label, value, mono = false }) {
  return (
    <div>
      <p className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">{label}</p>
      <p className={`text-slate-700 truncate mt-0.5 ${mono ? "font-mono text-xs" : "text-xs"}`}>{value || "—"}</p>
    </div>
  );
}

// ─── DraftAiRepairSection ─────────────────────────────────────────────────────

function DraftAiRepairSection({ draft }) {
  const [open, setOpen] = useState(false);
  const report = safeJsonParse(draft.ai_repair_report_json, null);
  const repairedPayload = safeJsonParse(draft.ai_repaired_payload_json, null);

  if (!draft.ai_repair_status) return null;

  return (
    <div className="border border-violet-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-violet-50 hover:bg-violet-100 transition-colors text-xs font-semibold text-violet-800"
      >
        <span className="flex items-center gap-2">
          <Wrench className="w-3.5 h-3.5" />
          AI Repair
          {draft.ai_repair_status && (
            <Badge variant="outline" className={`text-[10px] border ${AI_REPAIR_STATUS_STYLE[draft.ai_repair_status] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
              {draft.ai_repair_status.replace(/_/g, " ")}
            </Badge>
          )}
          {draft.ai_repair_attempt_count > 0 && (
            <span className="text-violet-500 font-normal">({draft.ai_repair_attempt_count} attempt{draft.ai_repair_attempt_count !== 1 ? "s" : ""})</span>
          )}
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="p-3 bg-white border-t border-violet-100 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-slate-500">Source:</span> <span className="font-medium">{draft.ai_repair_source || "—"}</span></div>
            <div><span className="text-slate-500">Last Repair:</span> <span className="font-medium">{formatDate(draft.last_ai_repair_at)}</span></div>
            <div><span className="text-slate-500">Applied:</span> <span className={draft.ai_repair_applied ? "text-green-700 font-medium" : "font-medium"}>{draft.ai_repair_applied ? "Yes" : "No"}</span></div>
          </div>

          {report?.summary && <div className="bg-slate-50 rounded p-2 text-slate-700">{report.summary}</div>}

          {report?.changedPaths?.length > 0 && (
            <div>
              <p className="font-semibold text-slate-600 mb-1">Changed Paths ({report.changedPaths.length})</p>
              <div className="space-y-1">
                {report.changedPaths.map((cp, i) => (
                  <div key={i} className="bg-slate-50 rounded px-2 py-1 flex items-start gap-2">
                    <span className="font-mono text-violet-700 shrink-0">{cp.path}</span>
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-600">{cp.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report?.warnings?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
              <p className="font-semibold text-amber-700">Warnings</p>
              {report.warnings.map((w, i) => <p key={i} className="text-amber-600">⚠ {w}</p>)}
            </div>
          )}

          {report?.manualReviewReasons?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-2 space-y-1">
              <p className="font-semibold text-red-700">Manual Review Required</p>
              {report.manualReviewReasons.map((r, i) => <p key={i} className="text-red-600">• {r}</p>)}
            </div>
          )}

          {draft.ai_repair_error_json && (
            <div className="bg-red-50 border border-red-200 rounded p-2">
              <p className="font-semibold text-red-700 mb-1">AI Repair Error</p>
              <p className="text-red-600 font-mono">{(() => { const e = safeJsonParse(draft.ai_repair_error_json); return e?.message || draft.ai_repair_error_json; })()}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {repairedPayload && (
              <Button size="sm" variant="outline" className="text-xs gap-1.5"
                onClick={() => { navigator.clipboard.writeText(JSON.stringify(repairedPayload, null, 2)); toast.success("AI repaired payload copied"); }}>
                <Copy className="w-3 h-3" /> Copy AI Repaired Payload
              </Button>
            )}
            {report && (
              <Button size="sm" variant="outline" className="text-xs gap-1.5"
                onClick={() => { navigator.clipboard.writeText(JSON.stringify(report, null, 2)); toast.success("AI repair report copied"); }}>
                <Copy className="w-3 h-3" /> Copy AI Report
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DraftRow ─────────────────────────────────────────────────────────────────

function RawDraftDataSection({ draft }) {
  const [open, setOpen] = useState(false);
  const responses = safeJsonParse(draft.responses_json, null);
  const mappedPayload = safeJsonParse(draft.mapped_payload_json, null);
  const aiRepairedPayload = safeJsonParse(draft.ai_repaired_payload_json, null);
  const metadata = safeJsonParse(draft.metadata_json, null);

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-100 hover:bg-slate-200 transition-colors text-xs font-semibold text-slate-600"
      >
        <span>Raw Draft Data — internal recovery format</span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="p-3 bg-white border-t border-slate-100 space-y-3">
          {responses && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">responses_json</p>
              <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono overflow-auto max-h-48 text-slate-700 whitespace-pre-wrap">
                {JSON.stringify(responses, null, 2)}
              </pre>
            </div>
          )}
          {mappedPayload && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">mapped_payload_json (updated on every auto-save)</p>
              <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono overflow-auto max-h-48 text-slate-700 whitespace-pre-wrap">
                {JSON.stringify(mappedPayload, null, 2)}
              </pre>
            </div>
          )}
          {aiRepairedPayload && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">ai_repaired_payload_json</p>
              <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono overflow-auto max-h-48 text-slate-700 whitespace-pre-wrap">
                {JSON.stringify(aiRepairedPayload, null, 2)}
              </pre>
            </div>
          )}
          {metadata && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">metadata_json</p>
              <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono overflow-auto max-h-32 text-slate-700 whitespace-pre-wrap">
                {JSON.stringify(metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SOURCE_LABEL = {
  mapped_payload_json: "mapped_payload_json",
  reconstructed_from_responses_json: "reconstructed from responses_json",
  reconstructed_from_form_data: "reconstructed from form data",
  empty_schema: "empty schema — no data available",
};

function DraftRow({ draft, isDuplicate, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);

  const metadata = safeJsonParse(draft.metadata_json, {});
  const responses = safeJsonParse(draft.responses_json, {});
  const validationStatus = safeJsonParse(draft.validation_status_json, {});
  const mappedPayload = safeJsonParse(draft.mapped_payload_json, null);
  const aiRepairedPayload = safeJsonParse(draft.ai_repaired_payload_json, null);
  const aiRepairReport = safeJsonParse(draft.ai_repair_report_json, null);
  const responsesParseOk = canParseJson(draft.responses_json);
  const mappedParseOk = canParseJson(draft.mapped_payload_json);
  const hasResponses = Object.keys(responses).length > 0;
  const hasMapped = mappedPayload !== null && Object.keys(mappedPayload).length > 0;
  const hasValidation = Object.keys(validationStatus).length > 0;

  // Build canonical endpoint payload preview
  const preview = buildExpressDraftSubmissionPreview(draft);

  const handleAction = async (actionKey, fn) => {
    setActionLoading(actionKey);
    try { await fn(); }
    finally { setActionLoading(null); await onRefresh?.(); }
  };

  const handleRetry = () => handleAction("retry", async () => {
    const res = await base44.functions.invoke("retryQuestionnaireIntakeSubmission", {
      questionnaireSessionId: draft.session_id,
      forceRetry: false,
    });
    const data = res?.data || res;
    if (data?.success) toast.success(data.alreadySubmitted ? "Already linked to submission" : "Retry completed");
    else toast.error(data?.error?.message || "Retry failed");
  });

  const handleAiAction = (mode) => handleAction(mode, async () => {
    const res = await base44.functions.invoke("repairExpressQuestionnaireIntakeSubmission", {
      draftId: draft.id,
      questionnaireSessionId: draft.session_id,
      mode,
    });
    const data = res?.data || res;
    if (data?.ok) {
      const labels = { diagnose_only: "Diagnosis complete", repair_only: "Repair complete", repair_and_retry: "Repair + retry complete" };
      const detail = data.createdSubmissionId ? ` — Submission: ${data.createdSubmissionId}` : "";
      toast.success((labels[mode] || "Done") + detail);
      if (mode === "repair_and_retry" && data.repairedPayload) {
        try {
          writeLocalFailedSubmissionBackup({
            sessionId: draft.session_id,
            submitAttemptId: metadata?.submit_attempt_id || "",
            businessName: draft.business_name || "",
            domain: draft.domain || "",
            responses: responses || {},
            transformedPayload: data.repairedPayload,
            validationStatus: validationStatus || {},
            touchedQuestions: safeJsonParse(draft.touched_questions_json, {}) || {},
            expandedQuestions: safeJsonParse(draft.expanded_questions_json, {}) || {},
            stage: "ai_repair_retry_success",
            diagnostics: { source: "FormDraftRecovery", submissionId: data.createdSubmissionId || null, timestamp: new Date().toISOString() },
          });
        } catch { /* ignore */ }
        if (data.zapierSent) toast.success("Payload sent to Zapier");
        else toast.error(`Zapier delivery failed: ${data.zapierError || "unknown"}`);
      }
    } else {
      toast.error(data?.error || "AI action failed");
    }
  });

  const isLoading = !!actionLoading;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-4 py-3 bg-white hover:bg-slate-50 transition-colors flex items-start gap-3"
      >
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1">
          <div>
            <p className="text-sm font-semibold text-slate-800 truncate">{draft.business_name || "Unnamed business"}</p>
            <p className="text-xs text-slate-500 truncate">{draft.domain || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 truncate">{draft.user_email || "—"}</p>
            <p className="text-xs text-slate-400 truncate font-mono">{draft.session_id}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={draft.status} />
            {isDuplicate && (
              <Badge variant="outline" className="text-xs border-orange-300 bg-orange-50 text-orange-700 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Duplicate
              </Badge>
            )}
            {draft.ai_repair_status && (
              <Badge variant="outline" className={`text-[10px] border ${AI_REPAIR_STATUS_STYLE[draft.ai_repair_status] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
                AI: {draft.ai_repair_status.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">{formatDate(draft.last_saved_at || draft.created_date)}</p>
            {draft.last_changed_question_id && <p className="text-xs text-slate-400">Last Q: {draft.last_changed_question_id}</p>}
          </div>
        </div>
        <div className="shrink-0 ml-2 mt-0.5 text-slate-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 space-y-4">
          {/* Detail fields */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Detail label="User name" value={draft.user_name} />
            <Detail label="User ID" value={draft.user_id} mono />
            <Detail label="Submit attempt ID" value={metadata?.submit_attempt_id} mono />
            <Detail label="Submit attempted" value={formatDate(draft.submit_attempted_at)} />
            <Detail label="Submitted at" value={formatDate(draft.submitted_at)} />
            <Detail label="Final submission ID" value={draft.final_submission_id} mono />
            <Detail label="Current question" value={draft.current_question_id} />
            <Detail label="Last changed at" value={formatDate(draft.last_changed_at)} />
            <Detail label="Last saved at" value={formatDate(draft.last_saved_at)} />
            {mappedPayload && <>
              <Detail label="Zapier status" value={mappedPayload.zapier_delivery_status} />
              <Detail label="Zapier sent" value={mappedPayload.zapier_sent ? "Yes" : "No"} />
            </>}
          </div>

          {/* Data flags */}
          <div className="flex flex-wrap gap-4 text-xs bg-white border border-slate-200 rounded px-3 py-2">
            <span><span className="text-slate-500 font-medium">Mapped Payload:</span> <span className={hasMapped ? "text-green-700" : "text-slate-400"}>{hasMapped ? "Yes" : "No"}</span></span>
            <span><span className="text-slate-500 font-medium">Responses:</span> <span className={hasResponses ? "text-green-700" : "text-slate-400"}>{hasResponses ? "Yes" : "No"}</span></span>
            <span><span className="text-slate-500 font-medium">Validation:</span> <span className={hasValidation ? "text-green-700" : "text-slate-400"}>{hasValidation ? `Yes (${Object.keys(validationStatus).length})` : "No"}</span></span>
          </div>

          {/* Parse warnings */}
          {draft.responses_json && !responsesParseOk && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Responses JSON could not be parsed.</p>}
          {draft.mapped_payload_json && !mappedParseOk && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Mapped payload JSON could not be parsed.</p>}
          {draft.save_error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2"><span className="font-semibold">Save error:</span> {draft.save_error}</div>}
          {draft.submit_error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2"><span className="font-semibold">Submit error:</span> {typeof draft.submit_error === "string" ? draft.submit_error : JSON.stringify(draft.submit_error)}</div>}
          {draft.status === "submitted" && draft.final_submission_id && (
            <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Submission Accepted (ID: {draft.final_submission_id})
            </div>
          )}

          {/* AI Repair Section */}
          <DraftAiRepairSection draft={draft} />

          {/* ── Endpoint Submission Payload ── */}
          <div className="border border-slate-300 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-white border-b border-slate-200 flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-700">Endpoint Submission Payload</p>
              <div className="flex items-center gap-2">
                {preview.ok
                  ? <span className="text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">Valid</span>
                  : <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Incomplete</span>
                }
              </div>
            </div>
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 space-y-1">
              <p className="text-[10px] text-slate-500">
                <span className="font-semibold">Source:</span> {SOURCE_LABEL[preview.source] || preview.source}
              </p>
              {preview.missingRequiredFields.length > 0 && (
                <p className="text-[10px] text-amber-700">
                  <span className="font-semibold">Missing required:</span> {preview.missingRequiredFields.join(", ")}
                </p>
              )}
              {preview.warnings.map((w, i) => (
                <p key={i} className="text-[10px] text-amber-600 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {w}
                </p>
              ))}
            </div>
            <pre className="bg-white p-3 text-xs font-mono overflow-auto max-h-72 text-slate-700 whitespace-pre-wrap">
              {JSON.stringify(preview.payload, null, 2)}
            </pre>
          </div>

          {/* ── Action buttons ── */}
          <div className="space-y-2">
            {/* Retry + AI actions */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-xs gap-1.5"
                disabled={isLoading}
                onClick={handleRetry}>
                {actionLoading === "retry" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Retry Submission
              </Button>
              <Button size="sm" variant="outline" className="text-xs gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
                disabled={isLoading}
                onClick={() => handleAiAction("diagnose_only")}>
                {actionLoading === "diagnose_only" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5" />}
                AI Diagnose
              </Button>
              <Button size="sm" variant="outline" className="text-xs gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50"
                disabled={isLoading}
                onClick={() => handleAiAction("repair_only")}>
                {actionLoading === "repair_only" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                AI Repair Only
              </Button>
              <Button size="sm" variant="outline" className="text-xs gap-1.5 border-green-200 text-green-700 hover:bg-green-50"
                disabled={isLoading}
                title="For draft rows: prefer intake retry for safest recovery. This uses the draft payload directly."
                onClick={() => { if (window.confirm("AI Repair + Retry from draft will attempt to create a FormSubmission from the repaired draft payload. For safer recovery, use intake retry from the Submission Intake Recovery section. Continue?")) handleAiAction("repair_and_retry"); }}>
                {actionLoading === "repair_and_retry" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                AI Repair + Retry
              </Button>
            </div>

            {/* Copy buttons */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-xs gap-1.5"
                onClick={() => { navigator.clipboard.writeText(JSON.stringify(preview.payload, null, 2)); toast.success("Endpoint payload copied"); }}>
                <Copy className="w-3 h-3" /> Copy Endpoint Payload
              </Button>
              <Button size="sm" variant="outline" className="text-xs gap-1.5"
                onClick={() => {
                  const bundle = { session_id: draft.session_id, business_name: draft.business_name, domain: draft.domain, status: draft.status, last_saved_at: draft.last_saved_at, submitted_at: draft.submitted_at, final_submission_id: draft.final_submission_id, responses };
                  navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
                  toast.success("Raw draft data copied");
                }}>
                <Copy className="w-3 h-3" /> Copy Raw Draft Data
              </Button>
              {aiRepairedPayload && (
                <Button size="sm" variant="outline" className="text-xs gap-1.5"
                  onClick={() => { navigator.clipboard.writeText(JSON.stringify(aiRepairedPayload, null, 2)); toast.success("AI repaired payload copied"); }}>
                  <Copy className="w-3 h-3" /> Copy AI Repaired Payload
                </Button>
              )}
              {aiRepairReport && (
                <Button size="sm" variant="outline" className="text-xs gap-1.5"
                  onClick={() => { navigator.clipboard.writeText(JSON.stringify(aiRepairReport, null, 2)); toast.success("AI repair report copied"); }}>
                  <Copy className="w-3 h-3" /> Copy AI Repair Report
                </Button>
              )}
            </div>
          </div>

          {/* Manual Payload Editor */}
          <PayloadEditor draft={draft} initialPayload={preview.payload} onRefresh={onRefresh} />

          {/* Raw Draft Data (collapsed) */}
          <RawDraftDataSection draft={draft} />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Fields that are auto-filled/pre-generated and do NOT count as user input.
 * A draft containing only these values is considered "empty".
 */
const AUTO_FILLED_RESPONSE_FIELDS = new Set([
  "clientSize",        // "1-50 employees" default
  "geographicAreaMeta", // { source: "google" } default
  "serviceType",       // "express" default
]);

const AUTO_FILLED_PAYLOAD_FIELDS = new Set([
  "submission_datetime",
  "questionnaire_session_id",
  "geographic_area_meta",
  "client_size",
  "service_type",
]);

/**
 * Returns true if the draft has at least one meaningful user-entered answer.
 * Auto-filled fields (submission_datetime, questionnaire_session_id,
 * geographic_area_meta stub, client_size default) are excluded from this check.
 */
function hasMeaningfulAnswers(draft) {
  // Always show submitted or non-draft statuses
  if (
    draft.status === "submitted" || draft.status === "submit_attempted" ||
    draft.status === "submit_failed" || draft.status === "auto_repair_pending" ||
    draft.status === "auto_repair_failed" || draft.final_submission_id
  ) {
    return true;
  }

  // Check touched_questions_json — only questions beyond the default numeric range (Q9)
  // Q9 (clientSize) is auto-filled, so we ignore it when checking touched questions
  try {
    const touched = JSON.parse(draft.touched_questions_json || "{}");
    const meaningfulTouched = Object.keys(touched).filter(qId => qId !== "9");
    if (meaningfulTouched.length > 0) return true;
  } catch { /* ignore */ }

  // Check responses_json, skipping auto-filled fields
  try {
    const responses = JSON.parse(draft.responses_json || "{}");
    if (responses && typeof responses === "object") {
      for (const [key, val] of Object.entries(responses)) {
        if (AUTO_FILLED_RESPONSE_FIELDS.has(key)) continue;
        if (Array.isArray(val) && val.length > 0) return true;
        if (typeof val === "string" && val.trim().length > 0) return true;
        // geographicAreaMeta with only { source: "google" } is auto-filled — skip
        if (val && typeof val === "object" && !Array.isArray(val)) {
          const keys = Object.keys(val).filter(k => k !== "source");
          if (keys.length > 0) return true;
        }
      }
    }
  } catch { /* ignore */ }

  return false;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "submit_attempted", label: "Submit Attempted" },
  { value: "submit_failed", label: "Submit Failed" },
  { value: "submitted", label: "Submitted" },
  { value: "auto_repair_pending", label: "Auto Repair Pending" },
  { value: "auto_repair_failed", label: "Failed to Auto Resend" },
];

export default function FormDraftRecovery() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const loadDrafts = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await base44.entities.FormDraft.list();
      const sorted = [...(data || [])].sort((a, b) => {
        const ta = new Date(a.last_saved_at || a.created_date || 0).getTime();
        const tb = new Date(b.last_saved_at || b.created_date || 0).getTime();
        return tb - ta;
      });
      // Merge updates: preserve existing array identity for unchanged records
      // so expanded rows are not collapsed and scroll position is not lost.
      setDrafts(prev => {
        const prevMap = new Map(prev.map(d => [d.id, d]));
        const merged = sorted.map(d => {
          const existing = prevMap.get(d.id);
          if (!existing) return d;
          // Only swap in the new object if something actually changed
          return existing.updated_date === d.updated_date ? existing : d;
        });
        return merged;
      });
      setLastRefreshedAt(new Date());
    } catch (err) {
      if (!silent) setLoadError(err?.message || "Failed to load drafts.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Load on mount; auto-refresh silently every 30 seconds (no state thrash, no scroll jump)
  useEffect(() => {
    loadDrafts();
    const interval = setInterval(() => loadDrafts({ silent: true }), 30000);
    return () => clearInterval(interval);
  }, []);

  const duplicateSessionIds = useMemo(() => {
    const counts = {};
    drafts.forEach(d => { if (d.session_id) counts[d.session_id] = (counts[d.session_id] || 0) + 1; });
    return new Set(Object.keys(counts).filter(k => counts[k] > 1));
  }, [drafts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drafts.filter(d => {
      const matchStatus = statusFilter === "all" || d.status === statusFilter;
      const matchSearch = !q || (d.business_name || "").toLowerCase().includes(q) || (d.domain || "").toLowerCase().includes(q) || (d.user_email || "").toLowerCase().includes(q) || (d.session_id || "").toLowerCase().includes(q);
      const matchEmpty = !hideEmpty || hasMeaningfulAnswers(d);
      return matchStatus && matchSearch && matchEmpty;
    });
  }, [drafts, search, statusFilter, hideEmpty]);

  const emptyDraftCount = useMemo(() => drafts.filter(d => !hasMeaningfulAnswers(d)).length, [drafts]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-12">
      {/* ── Draft Recovery ── */}
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800" style={{ fontFamily: "Raleway, sans-serif" }}>
            Express Form Draft Recovery
          </h1>
          <p className="text-sm text-slate-500 mt-1">Review Express questionnaire drafts and initiate AI-assisted or manual recovery.</p>
          {user?.email && <p className="text-xs text-slate-400 mt-1">Signed in as {user.email}</p>}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <Input placeholder="Search by business, domain, email, or session id…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            variant={hideEmpty ? "default" : "outline"}
            size="sm"
            onClick={() => setHideEmpty(v => !v)}
            className="gap-1.5 shrink-0 text-xs"
            title={hideEmpty ? "Click to show drafts with no answers" : "Click to hide drafts with no answers"}
          >
            {hideEmpty ? "Hiding Empty" : "Showing Empty"}
            {emptyDraftCount > 0 && <span className="ml-1 bg-white/20 text-current rounded px-1">{emptyDraftCount}</span>}
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadDrafts({ silent: true })} disabled={loading} className="gap-1.5 shrink-0">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
        {lastRefreshedAt && (
          <p className="text-xs text-slate-400 mb-4">
            Auto-refreshes every 15s — last updated {lastRefreshedAt.toLocaleTimeString()}
          </p>
        )}

        {loadError && (
          <Card className="border-red-200 bg-red-50 mb-6">
            <CardContent className="pt-4 text-sm text-red-700">{loadError}</CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading drafts…</div>
        ) : filtered.length === 0 ? (
          <p className="text-slate-500 text-sm">No matching drafts found.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map(draft => (
              <DraftRow key={draft.id} draft={draft} isDuplicate={duplicateSessionIds.has(draft.session_id)} onRefresh={loadDrafts} />
            ))}
          </div>
        )}
      </div>

      {/* ── Submission Intake Recovery ── */}
      <div>
        <div className="mb-4">
          <h2 className="text-xl font-bold text-slate-800" style={{ fontFamily: "Raleway, sans-serif" }}>
            Submission Intake Recovery
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            View and manage Express questionnaire submission intakes. Retry, AI-diagnose, and repair failed submissions.
          </p>
        </div>
        <QuestionnaireIntakeRecovery />
      </div>

      {/* ── Local Browser Recovery Backups ── */}
      <div>
        <LocalRecoveryBackupsPanel />
      </div>
    </div>
  );
}