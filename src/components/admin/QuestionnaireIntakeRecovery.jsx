import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Wrench,
  Search,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { normalizeExpressSubmitIntakePayload } from "@/lib/adminExpressIntakePayload";
import { writeLocalFailedSubmissionBackup } from "@/lib/localRecoveryBackup";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString();
};

const parseJson = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
};

const copyJson = async (value, successMessage) => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    toast.success(successMessage || "Copied to clipboard");
  } catch (err) {
    toast.error("Failed to copy: " + (err?.message || "Unknown error"));
  }
};

const getStatusStyle = (status) => {
  switch (status) {
    case "received_intake": return "bg-amber-100 text-amber-800 border-amber-300";
    case "retry_pending": return "bg-blue-100 text-blue-800 border-blue-300";
    case "retry_failed": return "bg-red-100 text-red-800 border-red-300";
    case "retry_success": return "bg-green-100 text-green-800 border-green-300";
    case "submitted": return "bg-slate-100 text-slate-800 border-slate-300";
    case "abandoned": return "bg-slate-100 text-slate-600 border-slate-200";
    default: return "bg-slate-100 text-slate-800 border-slate-300";
  }
};

const getAiRepairStatusStyle = (status) => {
  switch (status) {
    case "repaired": case "applied": return "bg-green-100 text-green-800 border-green-300";
    case "diagnosed": return "bg-blue-100 text-blue-800 border-blue-300";
    case "retried": return "bg-emerald-100 text-emerald-800 border-emerald-300";
    case "needs_manual_review": return "bg-amber-100 text-amber-800 border-amber-300";
    case "failed": return "bg-red-100 text-red-800 border-red-300";
    default: return "bg-slate-100 text-slate-600 border-slate-200";
  }
};

const RETRYABLE_STATUSES = new Set(["received_intake", "retry_failed", "retry_pending"]);
function isRetryable(record) {
  return RETRYABLE_STATUSES.has(record?.status) && !record?.linked_submission_id;
}

// ─── AI Repair Summary ────────────────────────────────────────────────────────

function AiRepairSummary({ record }) {
  const [expanded, setExpanded] = useState(false);
  const report = parseJson(record.ai_repair_report_json);
  if (!report && !record.ai_repair_status) return null;

  return (
    <div className="mt-3 border border-purple-200 rounded-lg overflow-hidden bg-purple-50">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-purple-800 hover:bg-purple-100 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5" />
          AI Repair
          {record.ai_repair_status && (
            <Badge variant="outline" className={`text-xs ml-1 ${getAiRepairStatusStyle(record.ai_repair_status)}`}>
              {record.ai_repair_status.replace(/_/g, " ")}
            </Badge>
          )}
          {record.ai_repair_attempt_count > 0 && (
            <span className="text-purple-500 font-normal ml-1">({record.ai_repair_attempt_count} attempt{record.ai_repair_attempt_count !== 1 ? "s" : ""})</span>
          )}
        </span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 text-xs">
          {record.last_ai_repair_at && (
            <p className="text-purple-600">Last repair: {formatDate(record.last_ai_repair_at)}</p>
          )}
          {record.ai_repair_source && (
            <p className="text-purple-600">Source: <span className="font-medium">{record.ai_repair_source}</span></p>
          )}
          {report?.summary && (
            <p className="text-slate-700">{report.summary}</p>
          )}
          {report?.changedPaths?.length > 0 && (
            <div>
              <p className="font-semibold text-slate-600 mb-1">Changed paths ({report.changedPaths.length})</p>
              <ul className="space-y-0.5">
                {report.changedPaths.map((cp, i) => (
                  <li key={i} className="text-slate-600 font-mono">
                    <span className="text-slate-500">{cp.path}:</span> {cp.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report?.warnings?.length > 0 && (
            <div className="p-2 bg-amber-50 border border-amber-200 rounded">
              {report.warnings.map((w, i) => <p key={i} className="text-amber-700">⚠ {w}</p>)}
            </div>
          )}
          {report?.manualReviewReasons?.length > 0 && (
            <div className="p-2 bg-red-50 border border-red-200 rounded">
              <p className="font-semibold text-red-700 mb-1">Manual review required:</p>
              {report.manualReviewReasons.map((r, i) => <p key={i} className="text-red-600">• {r}</p>)}
            </div>
          )}
          {record.linked_submission_id && record.ai_repair_applied && (
            <div className="flex items-center gap-1.5 text-green-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Submission created: {record.linked_submission_id}</span>
            </div>
          )}
          {record.ai_repair_error_json && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 font-mono">
              {(() => { const e = parseJson(record.ai_repair_error_json); return e?.message || record.ai_repair_error_json; })()}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 pt-1">
            {record.ai_repaired_payload_json && (
              <Button size="sm" variant="outline" className="text-xs h-7 gap-1"
                onClick={() => copyJson(parseJson(record.ai_repaired_payload_json), "AI repaired payload copied")}>
                <Copy className="w-3 h-3" /> Copy AI Repaired Payload
              </Button>
            )}
            {record.ai_repair_report_json && (
              <Button size="sm" variant="outline" className="text-xs h-7 gap-1"
                onClick={() => copyJson(report, "AI repair report copied")}>
                <Copy className="w-3 h-3" /> Copy AI Report
              </Button>
            )}
            {record.ai_repair_retry_result_json && (
              <Button size="sm" variant="outline" className="text-xs h-7 gap-1"
                onClick={() => copyJson(parseJson(record.ai_repair_retry_result_json), "AI retry result copied")}>
                <Copy className="w-3 h-3" /> Copy Retry Result
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Intake Record Row ────────────────────────────────────────────────────────

function IntakeRecordRow({ record, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState(null); // null | 'retry' | 'force_retry' | 'diagnose' | 'repair_only' | 'repair_and_retry'

  const runAiAction = async (mode) => {
    setActionLoading(mode);
    try {
      const response = await base44.functions.invoke("repairExpressQuestionnaireIntakeSubmission", {
        intakeId: record.id,
        questionnaireSessionId: record.questionnaire_session_id,
        mode,
      });
      const data = response?.data || response;
      if (data?.ok) {
        const labels = { diagnose_only: "Diagnosis", repair_only: "Repair", repair_and_retry: "Repair + Retry" };
        toast.success(`${labels[mode] || mode} completed`);
        if (mode === "repair_and_retry" && data.createdSubmissionId) {
          toast.success(`Submission created: ${data.createdSubmissionId}`);
        }
        if (mode === "repair_and_retry" && data.repairedPayload) {
          try {
            writeLocalFailedSubmissionBackup({
              sessionId: record.questionnaire_session_id || "",
              submitAttemptId: record.submit_attempt_id || "",
              businessName: record.business_name || "",
              domain: record.business_domain || "",
              responses: parseJson(record.raw_responses_json) || {},
              transformedPayload: data.repairedPayload,
              validationStatus: {},
              touchedQuestions: {},
              expandedQuestions: {},
              stage: "ai_repair_retry_success",
              diagnostics: { source: "QuestionnaireIntakeRecovery", submissionId: data.createdSubmissionId || null, timestamp: new Date().toISOString() },
            });
          } catch { /* ignore */ }
          if (data.zapierSent) toast.success("Payload sent to Zapier");
          else toast.error(`Zapier delivery failed: ${data.zapierError || "unknown"}`);
        }
      } else {
        toast.error(data?.error || `${mode} failed`);
      }
    } catch (err) {
      toast.error(err?.message || `${mode} failed`);
    } finally {
      setActionLoading(null);
      onRefresh?.();
    }
  };

  const handleRetry = async ({ forceRetry = false } = {}) => {
    setActionLoading(forceRetry ? "force_retry" : "retry");
    try {
      const response = await base44.functions.invoke("retryQuestionnaireIntakeSubmission", {
        intakeId: record.id,
        questionnaireSessionId: record.questionnaire_session_id,
        forceRetry,
      });
      const data = response?.data || response;
      if (data?.success) {
        // Surface Zapier delivery result clearly
        if (data.zapierSent) {
          const countLabel = data.resubmitCount ? ` (resubmit #${data.resubmitCount})` : "";
          toast.success(`Payload sent to Zapier${countLabel}`);
        } else if (data.zapierError) {
          toast.error(`Zapier delivery failed: ${data.zapierError}`);
        } else if (data.alreadySubmitted) {
          toast.success("Already linked to a submission. Use Force Retry to re-send to Zapier.");
        } else {
          toast.success(forceRetry ? "Force retry completed" : "Retry completed");
        }
      } else {
        toast.error(data?.error?.message || "Retry failed");
      }
    } catch (err) {
      toast.error(err?.message || "Retry failed");
    } finally {
      setActionLoading(null);
      onRefresh?.();
    }
  };

  const isLoading = actionLoading !== null;

  return (
    <Card className="overflow-hidden">
      <div
        className="p-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center">
            <div className="col-span-3 font-semibold text-slate-800 truncate">
              {record.business_name || "Unnamed"}
            </div>
            <div className="col-span-2 text-xs text-slate-500 truncate">{record.business_domain || "—"}</div>
            <div className="col-span-2 text-xs font-mono text-slate-500 truncate" title={record.questionnaire_session_id || ""}>
              {record.questionnaire_session_id ? record.questionnaire_session_id.slice(0, 16) + "…" : "—"}
            </div>
            <div className="col-span-2 text-xs text-slate-500">
              {formatDate(record.created_at_server || record.created_date)}
            </div>
            <div className="col-span-1">
              <Badge className={getStatusStyle(record.status)} variant="outline">
                {record.status?.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="col-span-1 text-xs text-slate-500">{record.primary_failure_kind || "—"}</div>
            <div className="col-span-1 text-xs font-mono text-slate-500">{record.linked_submission_id ? "✓" : "—"}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            {record.ai_repair_status && (
              <Badge variant="outline" className={`text-xs ${getAiRepairStatusStyle(record.ai_repair_status)}`}>
                AI: {record.ai_repair_status.replace(/_/g, " ")}
              </Badge>
            )}
            <Badge variant="outline" className={record.zapier_sent ? "bg-green-50 text-green-700 border-green-300" : "bg-slate-50 text-slate-600 border-slate-300"}>
              Zapier: {record.zapier_sent ? "Yes" : "No"}
            </Badge>
            {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </div>
        </div>
      </div>

      {expanded && (
        <CardContent className="p-4 border-t bg-slate-50 space-y-4">
          {/* Key fields */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {[
              ["User Email", record.user_email],
              ["User ID", record.user_id],
              ["Submit Attempt ID", record.submit_attempt_id],
              ["Intake Reason", record.intake_reason],
              ["Source", record.source],
              ["Fallback Failure", record.fallback_failure_kind],
              ["Retry Count", record.retry_count ?? 0],
              ["Last Retry", formatDate(record.last_retry_at)],
              ["Linked Submission", record.linked_submission_id || "—"],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="text-slate-400 uppercase text-[10px] font-medium tracking-wide">{label}</p>
                <p className="text-slate-700 truncate font-mono text-xs mt-0.5">{val || "—"}</p>
              </div>
            ))}
          </div>

          {/* Errors */}
          <div className="space-y-2">
            {record.primary_error_json && (
              <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
                <span className="font-semibold text-red-700">Primary Error: </span>
                {parseJson(record.primary_error_json)?.message || record.primary_error_json}
              </div>
            )}
            {record.fallback_error_json && (
              <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-600">
                <span className="font-semibold text-amber-700">Fallback Error: </span>
                {parseJson(record.fallback_error_json)?.message || record.fallback_error_json}
              </div>
            )}
            {record.retry_error_json && (
              <div className="p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-600">
                <span className="font-semibold text-orange-700">Retry Error: </span>
                {parseJson(record.retry_error_json)?.message || record.retry_error_json}
              </div>
            )}
          </div>

          {/* AI Repair section */}
          <AiRepairSummary record={record} />

          {/* Action buttons */}
          <div className="space-y-2">
            {/* Standard retry buttons */}
            <div className="flex flex-wrap gap-2">
              {record.linked_submission_id ? (
                <>
                  <Button variant="destructive" size="sm" disabled={isLoading}
                    onClick={() => {
                      if (window.confirm("This intake is already linked to a submission. Force retry may create a duplicate. Continue?")) {
                        handleRetry({ forceRetry: true });
                      }
                    }}>
                    {actionLoading === "force_retry" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                    Force Retry
                  </Button>
                  <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 self-center">
                    Already linked — use only if relinking is intentional.
                  </span>
                </>
              ) : isRetryable(record) ? (
                <Button variant="default" size="sm" disabled={isLoading}
                  className={record.status === "retry_failed" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}
                  onClick={() => handleRetry()}>
                  {actionLoading === "retry" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                  Retry Submission
                </Button>
              ) : (
                <span className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                  Not currently retryable.
                </span>
              )}
            </div>

            {/* AI action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={isLoading}
                className="text-xs border-purple-300 text-purple-700 hover:bg-purple-50"
                onClick={() => runAiAction("diagnose_only")}>
                {actionLoading === "diagnose_only" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-1.5" />}
                AI Diagnose
              </Button>
              <Button size="sm" variant="outline" disabled={isLoading}
                className="text-xs border-purple-300 text-purple-700 hover:bg-purple-50"
                onClick={() => runAiAction("repair_only")}>
                {actionLoading === "repair_only" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5 mr-1.5" />}
                AI Repair Only
              </Button>
              <Button size="sm" variant="outline" disabled={isLoading}
                className="text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={() => {
                  if (record.linked_submission_id && !window.confirm("This intake already has a linked submission. Repair + Retry may create a duplicate. Continue?")) return;
                  runAiAction("repair_and_retry");
                }}>
                {actionLoading === "repair_and_retry" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                AI Repair + Retry
              </Button>
            </div>

            {/* Copy buttons */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-xs gap-1"
                onClick={() => {
                  const p = parseJson(record.transformed_payload_json);
                  if (p) copyJson(p, "Payload copied"); else toast.error("No valid payload JSON");
                }}>
                <Copy className="w-3 h-3" /> Copy Payload
              </Button>
              <Button size="sm" variant="outline" className="text-xs gap-1"
                onClick={() => {
                  const r = parseJson(record.raw_responses_json);
                  if (r) copyJson(r, "Raw responses copied"); else toast.error("No raw responses JSON");
                }}>
                <Copy className="w-3 h-3" /> Copy Raw Responses
              </Button>
              <Button size="sm" variant="outline" className="text-xs gap-1"
                onClick={() => {
                  const bundle = {
                    id: record.id,
                    questionnaire_session_id: record.questionnaire_session_id,
                    submit_attempt_id: record.submit_attempt_id,
                    business_name: record.business_name,
                    status: record.status,
                    intake_reason: record.intake_reason,
                    retry_count: record.retry_count,
                    linked_submission_id: record.linked_submission_id,
                    ai_repair_status: record.ai_repair_status,
                    transformed_payload: parseJson(record.transformed_payload_json),
                    raw_responses: parseJson(record.raw_responses_json),
                    diagnostics: parseJson(record.diagnostics_json),
                    primary_error: parseJson(record.primary_error_json),
                    fallback_error: parseJson(record.fallback_error_json),
                    retry_error: parseJson(record.retry_error_json),
                  };
                  copyJson(bundle, "Recovery bundle copied");
                }}>
                <Copy className="w-3 h-3" /> Copy Recovery Bundle
              </Button>
              <Button size="sm" variant="outline" className="text-xs gap-1"
                onClick={() => {
                  const t = parseJson(record.transformed_payload_json);
                  if (!t?.metadata || !t?.userdata) { toast.error("No valid submit-intake payload"); return; }
                  const result = normalizeExpressSubmitIntakePayload({ metadata: { ...t.metadata }, userdata: { ...t.userdata } });
                  if (!result.ok) { toast.error("Could not normalize payload"); return; }
                  copyJson(result.payload, "Submit-intake payload copied");
                }}>
                <Copy className="w-3 h-3" /> Copy Submit-Intake Payload
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function QuestionnaireIntakeRecovery() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState("received_intake");
  const [searchTerm, setSearchTerm] = useState("");

  const loadRecords = async () => {
    try {
      setLoading(true);
      setLoadError("");
      const data = await base44.entities.FormSubmissionIntake.list();
      data.sort((a, b) => {
        const aDate = new Date(a.created_at_server || a.created_date || a.last_retry_at || 0).getTime();
        const bDate = new Date(b.created_at_server || b.created_date || b.last_retry_at || 0).getTime();
        return bDate - aDate;
      });
      setRecords(data);
    } catch (err) {
      setLoadError("Failed to load intake records: " + (err?.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRecords(); }, []);

  const filtered = useMemo(() => records.filter((record) => {
    if (statusFilter !== "all" && record.status !== statusFilter) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const fields = [record.business_name, record.business_domain, record.user_email,
        record.questionnaire_session_id, record.linked_submission_id, record.intake_reason].filter(Boolean);
      return fields.some((f) => String(f).toLowerCase().includes(q));
    }
    return true;
  }), [records, statusFilter, searchTerm]);

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  }

  if (loadError) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
          <AlertTriangle className="w-4 h-4" />{loadError}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Input
          placeholder="Search by business, domain, email, session ID…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 min-w-[240px]"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="received_intake">Received Intake</SelectItem>
            <SelectItem value="retry_pending">Retry Pending</SelectItem>
            <SelectItem value="retry_failed">Retry Failed</SelectItem>
            <SelectItem value="retry_success">Retry Success</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="abandoned">Abandoned</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={loadRecords} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
        <span className="text-xs text-slate-500">{filtered.length} records</span>
      </div>

      {/* Records */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-slate-500 text-sm">No intake records found</CardContent></Card>
        ) : (
          filtered.map((record) => (
            <IntakeRecordRow key={record.id} record={record} onRefresh={loadRecords} />
          ))
        )}
      </div>
    </div>
  );
}