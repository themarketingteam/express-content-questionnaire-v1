import React, { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown, ChevronUp, Copy, AlertTriangle, CheckCircle2,
  Loader2, RefreshCw, Wrench, Stethoscope, RotateCcw, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import LocalRecoveryBackupsPanel from "@/components/admin/LocalRecoveryBackupsPanel";
import { writeLocalFailedSubmissionBackup } from "@/lib/localRecoveryBackup";
import QuestionnaireIntakeRecovery from "@/components/admin/QuestionnaireIntakeRecovery";
import { buildExpressDraftSubmissionPreview } from "@/lib/expressDraftSubmissionPreview";
import PayloadEditor from "@/components/admin/PayloadEditor";
import DraftPdfManager from "@/components/admin/DraftPdfManager";
import AdminFloatingMenu from "@/components/admin/AdminFloatingMenu";
import { EXPRESS_TEMPLATE_LOGO_DATA_URI } from "@/components/questionnaire/expressTemplateLogo.js";
import { useDraftRecoveryAccess } from "@/lib/DraftRecoveryAccessContext";
import { getBackendErrorMessage } from "@/lib/draftRecoveryAccess";
import { useAdminRecoveryPagination } from "@/hooks/useAdminRecoveryPagination";
import {
  getPaginationControls,
  getVisibleRecordRange,
  requestRecoveryRecord,
} from "@/lib/adminRecoveryPagination";
import "./FormDraftRecovery.css";

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
  draft: "brand-status-badge--neutral",
  submit_attempted: "brand-status-badge--warning",
  submit_failed: "brand-status-badge--danger",
  submitted: "brand-status-badge--submitted",
  auto_repair_pending: "brand-status-badge--info",
  auto_repair_failed: "brand-status-badge--danger",
};

const AI_REPAIR_STATUS_STYLE = {
  diagnosed: "bg-blue-50 text-blue-700 border-blue-200",
  repaired: "bg-violet-50 text-violet-700 border-violet-200",
  applied: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  needs_manual_review: "bg-amber-50 text-amber-700 border-amber-200",
};

function StatusBadge({ status }) {
  const cls = STATUS_BADGE[status] || "brand-status-badge--neutral";
  return <Badge variant="outline" className={`brand-status-badge ${cls}`}>{(status || "unknown").replace(/_/g, " ")}</Badge>;
}

function Detail({ label, value, mono = false }) {
  return (
    <div className="brand-detail">
      <p className="brand-detail__label">{label}</p>
      <p className={`brand-detail__value ${mono ? "font-mono" : ""}`}>{value || "—"}</p>
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
    <div className="brand-ai-panel border border-violet-200 rounded-lg overflow-hidden">
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
    <div className="brand-raw-panel border border-slate-200 rounded-lg overflow-hidden">
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

function DraftRow({ draft: draftSummary, isDuplicate, onRefresh, onLoadDetail, recoveryGrant }) {
  const [expanded, setExpanded] = useState(false);
  const [fullDraft, setFullDraft] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [payloadEditorOpen, setPayloadEditorOpen] = useState(false);
  const draft = fullDraft || draftSummary;
  const payloadEditorId = `payload-editor-${draft.id}`;

  const loadDetails = useCallback(async () => {
    setDetailLoading(true);
    setDetailError("");
    try {
      const record = await onLoadDetail(draftSummary.id);
      setFullDraft(record);
    } catch (error) {
      setDetailError(getBackendErrorMessage(error, "Failed to load the complete draft."));
    } finally {
      setDetailLoading(false);
    }
  }, [draftSummary.id, onLoadDetail]);

  const toggleExpanded = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!fullDraft && !detailLoading) loadDetails();
  };

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
    try {
      const res = await base44.functions.invoke("retryQuestionnaireIntakeSubmission", {
        questionnaireSessionId: draft.session_id,
        forceRetry: true,
        payload: preview?.payload || mappedPayload || null,
        recoveryGrant,
      });
      const data = res?.data || res;
      if (data?.success) {
        // Save local backup of the submission payload
        try {
          writeLocalFailedSubmissionBackup({
            sessionId: draft.session_id,
            submitAttemptId: metadata?.submit_attempt_id || "",
            businessName: draft.business_name || "",
            domain: draft.domain || "",
            responses: responses || {},
            transformedPayload: mappedPayload || preview?.payload || null,
            validationStatus: validationStatus || {},
            touchedQuestions: safeJsonParse(draft.touched_questions_json, {}) || {},
            expandedQuestions: safeJsonParse(draft.expanded_questions_json, {}) || {},
            stage: "admin_retry_success",
            diagnostics: { source: "FormDraftRecovery", linkedSubmissionId: data.linkedSubmissionId || null, timestamp: new Date().toISOString() },
          });
        } catch { /* ignore local backup errors */ }
        // Surface Zapier delivery result with clear feedback
        if (data.zapierSent) {
          const countLabel = data.resubmitCount ? ` (resubmit #${data.resubmitCount})` : "";
          toast.success(`Payload sent to Zapier${countLabel}`);
        } else if (data.zapierError) {
          toast.error(`Zapier delivery failed: ${data.zapierError}`);
        } else {
          toast.success("Retry completed");
        }
      } else {
        toast.error(getBackendErrorMessage({ response: { data } }, "Retry failed"));
      }
    } catch (err) {
      const msg = getBackendErrorMessage(err, "Retry failed");
      toast.error(msg);
    }
  });

  const handleAiAction = (mode) => handleAction(mode, async () => {
    try {
      const res = await base44.functions.invoke("repairExpressQuestionnaireIntakeSubmission", {
        draftId: draft.id,
        questionnaireSessionId: draft.session_id,
        mode,
        recoveryGrant,
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
      toast.error(getBackendErrorMessage({ response: { data } }, "AI action failed"));
    }
    } catch (err) {
      const msg = getBackendErrorMessage(err, "AI action failed");
      toast.error(msg);
    }
  });

  const isLoading = !!actionLoading;

  return (
    <article className={`brand-record-card ${expanded ? "brand-record-card--expanded" : ""}`}>
      <button
        type="button"
        onClick={toggleExpanded}
        className="brand-record-trigger"
        aria-expanded={expanded}
      >
        <div className="brand-record-primary">
          <strong>{draft.business_name || "Unnamed business"}</strong>
          <span>{draft.domain || "—"}</span>
        </div>
        <div className="brand-record-field">
          <span className="brand-record-label">User Email</span>
          <span className="brand-record-value">{draft.user_email || "—"}</span>
        </div>
        <div className="brand-record-status">
          <StatusBadge status={draft.status} />
          {isDuplicate && (
            <Badge variant="outline" className="brand-status-badge brand-status-badge--warning">
              <AlertTriangle className="w-3 h-3" /> Duplicate
            </Badge>
          )}
          {draft.ai_repair_status && (
            <Badge variant="outline" className={`brand-status-badge ${AI_REPAIR_STATUS_STYLE[draft.ai_repair_status] || "brand-status-badge--info"}`}>
              AI: {draft.ai_repair_status.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        <div className="brand-record-field">
          <span className="brand-record-label">Last Saved</span>
          <span className="brand-record-value">{formatDate(draft.last_saved_at || draft.created_date)}</span>
        </div>
        <div className="brand-record-field brand-record-field--question">
          <span className="brand-record-label">Last Changed Question</span>
          <span className="brand-record-value">{draft.last_changed_question_id || draft.current_question_id || "—"}</span>
        </div>
        <div className="brand-record-field brand-record-field--session">
          <span className="brand-record-label">Session ID</span>
          <span className="brand-record-value font-mono">{draft.session_id || "—"}</span>
        </div>
        <div className="brand-record-chevron" aria-hidden="true">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="brand-expanded-panel">
          {detailLoading ? (
            <div className="draft-recovery-brand__loading" role="status">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading complete draft…
            </div>
          ) : detailError ? (
            <div className="draft-recovery-brand__detail-error" role="alert">
              <span><AlertTriangle className="w-4 h-4" /> {detailError}</span>
              <Button type="button" size="sm" variant="outline" onClick={loadDetails}>Retry</Button>
            </div>
          ) : fullDraft ? (
            <>
          <div className="brand-detail-grid">
            <Detail label="Business name" value={draft.business_name} />
            <Detail label="Domain" value={draft.domain} />
            <Detail label="User name" value={draft.user_name} />
            <Detail label="User email" value={draft.user_email} />
            <Detail label="User ID" value={draft.user_id} mono />
            <Detail label="Final submission ID" value={draft.final_submission_id} mono />
            <Detail label="Submit attempt ID" value={metadata?.submit_attempt_id} mono />
            <Detail label="Submit attempted" value={formatDate(draft.submit_attempted_at)} />
            <Detail label="Submitted at" value={formatDate(draft.submitted_at)} />
            <Detail label="Current question" value={draft.current_question_id} />
            <Detail label="Last changed at" value={formatDate(draft.last_changed_at)} />
            <Detail label="Last saved at" value={formatDate(draft.last_saved_at)} />
            {mappedPayload && <>
              <Detail label="Zapier status" value={mappedPayload.zapier_delivery_status} />
              <Detail label="Zapier sent" value={mappedPayload.zapier_sent ? "Yes" : "No"} />
            </>}
          </div>

          <div className="brand-data-flags">
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

          <DraftPdfManager draft={draft} recoveryGrant={recoveryGrant} />

          <div className="brand-action-group">
            <p className="brand-action-label">Actions</p>
            <div className="brand-action-buttons">
              <Button size="sm" variant="outline" className="brand-button-secondary"
                disabled={isLoading}
                onClick={() => setPayloadEditorOpen(value => !value)}
                aria-expanded={payloadEditorOpen}
                aria-controls={payloadEditorId}>
                <Pencil className="w-3.5 h-3.5" />
                Edit Draft
              </Button>
              <Button size="sm" className="brand-button-primary"
                disabled={isLoading}
                onClick={handleRetry}
                title="Re-sends the payload to Zapier every time. The webhook handles de-duplication.">
                {actionLoading === "retry" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Retry Submission
              </Button>
            </div>
            <PayloadEditor
              draft={draft}
              initialPayload={preview.payload}
              onRefresh={onRefresh}
              recoveryGrant={recoveryGrant}
              open={payloadEditorOpen}
              panelId={payloadEditorId}
            />
          </div>

          <div className="brand-action-group">
            <p className="brand-action-label">AI Actions</p>
            <div className="brand-action-buttons">
              <Button size="sm" variant="outline" className="brand-button-secondary"
                disabled={isLoading}
                onClick={() => handleAiAction("diagnose_only")}>
                {actionLoading === "diagnose_only" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5" />}
                Diagnose
              </Button>
              <Button size="sm" variant="outline" className="brand-button-secondary"
                disabled={isLoading}
                onClick={() => handleAiAction("repair_only")}>
                {actionLoading === "repair_only" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                Repair Only
              </Button>
              <Button size="sm" className="brand-button-dark"
                disabled={isLoading}
                title="For draft rows: prefer intake retry for safest recovery. This uses the draft payload directly."
                onClick={() => { if (window.confirm("AI Repair + Retry from draft will attempt to create a FormSubmission from the repaired draft payload. For safer recovery, use intake retry from the Submission Intake Recovery section. Continue?")) handleAiAction("repair_and_retry"); }}>
                {actionLoading === "repair_and_retry" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                Repair + Retry
              </Button>
            </div>
          </div>

          <div className="brand-action-group">
            <p className="brand-action-label">Data Copy Options (JSON)</p>
            <div className="brand-action-buttons">
              <Button size="sm" variant="outline" className="brand-button-secondary"
                onClick={() => { navigator.clipboard.writeText(JSON.stringify(preview.payload, null, 2)); toast.success("Endpoint payload copied"); }}>
                <Copy className="w-3 h-3" /> Endpoint Payload
              </Button>
              <Button size="sm" variant="outline" className="brand-button-secondary"
                onClick={() => {
                  const bundle = { session_id: draft.session_id, business_name: draft.business_name, domain: draft.domain, status: draft.status, last_saved_at: draft.last_saved_at, submitted_at: draft.submitted_at, final_submission_id: draft.final_submission_id, responses };
                  navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
                  toast.success("Raw draft data copied");
                }}>
                <Copy className="w-3 h-3" /> Raw Draft
              </Button>
              {aiRepairedPayload && (
                <Button size="sm" variant="outline" className="brand-button-secondary"
                  onClick={() => { navigator.clipboard.writeText(JSON.stringify(aiRepairedPayload, null, 2)); toast.success("AI repaired payload copied"); }}>
                  <Copy className="w-3 h-3" /> Copy AI Repaired Payload
                </Button>
              )}
              {aiRepairReport && (
                <Button size="sm" variant="outline" className="brand-button-secondary"
                  onClick={() => { navigator.clipboard.writeText(JSON.stringify(aiRepairReport, null, 2)); toast.success("AI repair report copied"); }}>
                  <Copy className="w-3 h-3" /> Copy AI Repair Report
                </Button>
              )}
            </div>
          </div>

          <DraftAiRepairSection draft={draft} />

          <div className="brand-json-panel">
            <div className="brand-json-panel__header">
              <p>Endpoint Submission Payload</p>
              {preview.ok
                ? <span className="brand-status-badge brand-status-badge--success">Valid</span>
                : <span className="brand-status-badge brand-status-badge--warning">Incomplete</span>
              }
            </div>
            <div className="brand-json-panel__meta">
              <p className="brand-json-panel__source"><span className="font-semibold">Source:</span> {SOURCE_LABEL[preview.source] || preview.source}</p>
              {preview.missingRequiredFields.length > 0 && (
                <p className="brand-json-panel__warning"><span className="font-semibold">Missing required:</span> {preview.missingRequiredFields.join(", ")}</p>
              )}
              {preview.warnings.map((warning, index) => (
                <p key={index} className="brand-json-panel__warning flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {warning}
                </p>
              ))}
            </div>
            <pre>{JSON.stringify(preview.payload, null, 2)}</pre>
          </div>

          <RawDraftDataSection draft={draft} />
            </>
          ) : null}
        </div>
      )}
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

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
  const { recoveryGrant } = useDraftRecoveryAccess();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [archiveState, setArchiveState] = useState("active");
  const [intakeAvailable, setIntakeAvailable] = useState(null);
  const pagination = useAdminRecoveryPagination({
    recordType: "draft",
    recoveryGrant,
    status: statusFilter,
    archiveState,
    search,
  });
  const drafts = pagination.records;

  const loadDraftDetail = useCallback((recordId) => requestRecoveryRecord({
    invoke: (functionName, payload) => base44.functions.invoke(functionName, payload),
    recordType: "draft",
    recordId,
    archiveState,
    recoveryGrant,
  }), [archiveState, recoveryGrant]);

  const duplicateSessionIds = useMemo(() => {
    const counts = {};
    drafts.forEach(d => { if (d.session_id) counts[d.session_id] = (counts[d.session_id] || 0) + 1; });
    return new Set(Object.keys(counts).filter(k => counts[k] > 1));
  }, [drafts]);

  const visibleRange = getVisibleRecordRange({
    page: pagination.page,
    pageSize: pagination.pageSize,
    recordCount: drafts.length,
  });
  const paginationControls = getPaginationControls({
    page: pagination.page,
    hasMore: pagination.hasMore,
    loading: pagination.loading,
  });

  return (
    <main className="draft-recovery-brand draft-recovery-brand-page">
      <AdminFloatingMenu currentPage="draft-recovery" />
      <div className="draft-recovery-brand__shell">
        <header className="draft-recovery-brand__hero">
          <div className="draft-recovery-brand__logo-plate">
            <img
              className="draft-recovery-brand__logo"
              src={EXPRESS_TEMPLATE_LOGO_DATA_URI}
              alt="Kaseya MSP Success Digital"
            />
          </div>
          <div>
            <p className="draft-recovery-brand__eyebrow">Admin support workspace</p>
            <h1><span className="draft-recovery-brand__product-name">Express</span> | Form Draft Recovery</h1>
            <p className="draft-recovery-brand__hero-copy">
              Review questionnaire drafts, recover failed submissions, and manage saved client PDFs.
            </p>
          </div>
        </header>

        <div className="draft-recovery-brand__content">
          <section className="brand-panel" aria-labelledby="draft-filters-heading">
            <div className="brand-section-header">
              <p className="draft-recovery-brand__section-kicker">Find a questionnaire</p>
              <h2 id="draft-filters-heading" className="brand-section-title">Draft Filters</h2>
              <p className="draft-recovery-brand__section-copy">Narrow the records by workflow status or client details.</p>
            </div>

            <div className="draft-recovery-brand__filter-controls">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger aria-label="Filter by status"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={archiveState} onValueChange={setArchiveState}>
                <SelectTrigger aria-label="Filter by archive state"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active Records</SelectItem>
                  <SelectItem value="archived">Archived Records</SelectItem>
                  <SelectItem value="all">All Records</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Search by business name, domain, user email, or session ID"
                value={search}
                onChange={event => setSearch(event.target.value)}
                className="draft-recovery-brand__filter-search"
                aria-label="Search questionnaire drafts"
              />
              <Button
                type="button"
                variant="outline"
                onClick={pagination.refresh}
                disabled={pagination.loading}
                className="brand-button-secondary draft-recovery-brand__refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${pagination.loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {pagination.lastRefreshedAt && (
              <p className="draft-recovery-brand__refresh-meta">
                {pagination.isSearchDebouncing ? "Waiting for search input… · " : ""}
                Last updated {pagination.lastRefreshedAt.toLocaleTimeString()}
              </p>
            )}
          </section>

          {pagination.error && (
            <div className="brand-panel draft-recovery-brand__error" role="alert">
              <span><AlertTriangle className="w-4 h-4" /> {pagination.error}</span>
              <Button type="button" size="sm" variant="outline" onClick={pagination.retry}>Retry</Button>
            </div>
          )}

          <section className="draft-recovery-brand__list" aria-labelledby="questionnaire-drafts-heading">
            <div className="draft-recovery-brand__list-heading">
              <h2 id="questionnaire-drafts-heading">Questionnaire Drafts</h2>
              <p>
                {drafts.length === 0
                  ? `Page ${pagination.page} · no visible records`
                  : `Showing ${visibleRange.start}–${visibleRange.end} · Page ${pagination.page}`}
              </p>
            </div>

            {pagination.loading ? (
              <div className="brand-panel draft-recovery-brand__loading" role="status">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading drafts…
              </div>
            ) : !pagination.error && drafts.length === 0 ? (
              <div className="brand-panel draft-recovery-brand__loading">No matching drafts found.</div>
            ) : !pagination.error ? (
              drafts.map(draft => (
                <DraftRow
                  key={`${draft.id}:${pagination.refreshVersion}`}
                  draft={draft}
                  isDuplicate={duplicateSessionIds.has(draft.session_id)}
                  onRefresh={pagination.refresh}
                  onLoadDetail={loadDraftDetail}
                  recoveryGrant={recoveryGrant}
                />
              ))
            ) : null}

            <div className="draft-recovery-brand__pagination" aria-label="Draft pagination">
              <Button
                type="button"
                variant="outline"
                onClick={pagination.goToPreviousPage}
                disabled={paginationControls.previousDisabled}
              >
                Previous
              </Button>
              <span>Page {pagination.page}</span>
              <Button
                type="button"
                variant="outline"
                onClick={pagination.goToNextPage}
                disabled={paginationControls.nextDisabled}
              >
                Next
              </Button>
            </div>
          </section>

          {intakeAvailable !== false && (
            <section className="brand-secondary-section" aria-labelledby="intake-recovery-heading">
              <div className="draft-recovery-brand__list-heading">
                <div>
                  <h2 id="intake-recovery-heading">Submission Intake Recovery</h2>
                  <p>Retry, diagnose, and repair failed Express questionnaire submissions.</p>
                </div>
              </div>
              <div className="brand-panel brand-secondary-body">
                <QuestionnaireIntakeRecovery
                  recoveryGrant={recoveryGrant}
                  onAvailabilityChange={setIntakeAvailable}
                />
              </div>
            </section>
          )}

          <section className="brand-secondary-section" aria-labelledby="local-backups-heading">
            <div className="draft-recovery-brand__list-heading">
              <h2 id="local-backups-heading">Local Browser Recovery Backups</h2>
            </div>
            <div className="brand-panel brand-secondary-body">
              <LocalRecoveryBackupsPanel embedded />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
