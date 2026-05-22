import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import { toast } from "sonner";
import { normalizeExpressSubmitIntakePayload } from "@/lib/adminExpressIntakePayload";

// Helper: format date
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString();
};

// Helper: parse JSON safely
const parseJson = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

// Helper: copy JSON to clipboard
const copyJson = async (value, successMessage) => {
  try {
    const text = JSON.stringify(value, null, 2);
    await navigator.clipboard.writeText(text);
    toast.success(successMessage || "Copied to clipboard");
  } catch (err) {
    toast.error("Failed to copy: " + (err?.message || "Unknown error"));
  }
};

// Status badge styles
const getStatusStyle = (status) => {
  switch (status) {
    case "received_intake":
      return "bg-amber-100 text-amber-800 border-amber-300";
    case "retry_pending":
      return "bg-blue-100 text-blue-800 border-blue-300";
    case "retry_failed":
      return "bg-red-100 text-red-800 border-red-300";
    case "retry_success":
      return "bg-green-100 text-green-800 border-green-300";
    case "submitted":
      return "bg-slate-100 text-slate-800 border-slate-300";
    case "abandoned":
      return "bg-slate-100 text-slate-600 border-slate-200";
    default:
      return "bg-slate-100 text-slate-800 border-slate-300";
  }
};

// Retryable status helper
const RETRYABLE_STATUSES = new Set(["received_intake", "retry_failed", "retry_pending"]);

function isRetryableIntake(record) {
  return RETRYABLE_STATUSES.has(record?.status) && !record?.linked_submission_id;
}

export default function QuestionnaireIntakeRecovery() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState("received_intake");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [retryingId, setRetryingId] = useState(null);

  // Load intake records on mount
  useEffect(() => {
    const loadRecords = async () => {
      try {
        setLoading(true);
        setLoadError("");
        const data = await base44.entities.FormSubmissionIntake.list();
        // Sort newest first
        data.sort((a, b) => {
          const aDate = new Date(
            a.created_at_server || a.created_date || a.last_retry_at || 0
          ).getTime();
          const bDate = new Date(
            b.created_at_server || b.created_date || b.last_retry_at || 0
          ).getTime();
          return bDate - aDate;
        });
        setRecords(data);
      } catch (err) {
        setLoadError("Failed to load intake records: " + (err?.message || "Unknown error"));
        toast.error("Failed to load intake records");
      } finally {
        setLoading(false);
      }
    };

    loadRecords();
  }, []);

  // Filter and search records
  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      // Status filter
      if (statusFilter !== "all" && record.status !== statusFilter) {
        return false;
      }

      // Search filter
      if (searchTerm.trim()) {
        const search = searchTerm.toLowerCase();
        const fields = [
          record.business_name,
          record.business_domain,
          record.user_email,
          record.questionnaire_session_id,
          record.linked_submission_id,
          record.intake_reason,
          record.primary_failure_kind,
          record.fallback_failure_kind,
        ].filter(Boolean);

        return fields.some((field) =>
          String(field).toLowerCase().includes(search)
        );
      }

      return true;
    });
  }, [records, statusFilter, searchTerm]);

  const handleCopyPayload = (record) => {
    const payload = parseJson(record.transformed_payload_json);
    if (payload) {
      copyJson(payload, "Payload copied");
    } else {
      toast.error("Invalid payload JSON");
    }
  };

  const handleCopyRawResponses = (record) => {
    const responses = parseJson(record.raw_responses_json);
    if (responses) {
      copyJson(responses, "Raw responses copied");
    } else {
      toast.error("Invalid responses JSON");
    }
  };

  const handleCopyRecoveryBundle = (record) => {
    const bundle = {
      id: record.id,
      questionnaire_session_id: record.questionnaire_session_id,
      submit_attempt_id: record.submit_attempt_id || "",
      business_name: record.business_name,
      business_domain: record.business_domain,
      user_email: record.user_email,
      status: record.status,
      intake_reason: record.intake_reason,
      primary_failure_kind: record.primary_failure_kind,
      fallback_failure_kind: record.fallback_failure_kind,
      retry_count: record.retry_count,
      linked_submission_id: record.linked_submission_id,
      zapier_sent: record.zapier_sent,
      zapier_error: parseJson(record.zapier_error_json),
      transformed_payload: parseJson(record.transformed_payload_json),
      raw_responses: parseJson(record.raw_responses_json),
      diagnostics: parseJson(record.diagnostics_json),
      primary_error: parseJson(record.primary_error_json),
      fallback_error: parseJson(record.fallback_error_json),
      retry_error: parseJson(record.retry_error_json),
    };
    copyJson(bundle, "Recovery bundle copied");
  };

  const handleCopySubmitIntakePayload = (record) => {
    const transformed = parseJson(record.transformed_payload_json);
    if (!transformed || !transformed.metadata || !transformed.userdata) {
      toast.error("No valid submit-intake payload is available for this intake record.");
      return;
    }

    const payload = {
      metadata: { ...transformed.metadata },
      userdata: { ...transformed.userdata },
    };

    // Normalize the payload
    const result = normalizeExpressSubmitIntakePayload(payload);
    
    if (!result.ok) {
      toast.error("Could not prepare a valid submit-intake payload from this intake record.");
      return;
    }

    copyJson(result.payload, "Submit-intake payload copied");
  };

  const handleRetry = async (record, { forceRetry = false } = {}) => {
    try {
      setRetryingId(record.id);
      const response = await base44.functions.invoke("retryQuestionnaireIntakeSubmission", {
        intakeId: record.id,
        questionnaireSessionId: record.questionnaire_session_id,
        forceRetry,
      });

      const data = response?.data || response;

      if (data?.success) {
        if (data.alreadySubmitted) {
          toast.info("Already linked to a submission");
        } else if (forceRetry) {
          toast.success("Force retry completed");
        } else {
          toast.success("Submission retry completed");
        }
      } else {
        toast.error(data?.error?.message || "Retry failed");
      }
    } catch (err) {
      toast.error(err?.message || "Retry failed");
    } finally {
      setRetryingId(null);
      // Refresh records
      try {
        const data = await base44.entities.FormSubmissionIntake.list();
        data.sort((a, b) => {
          const aDate = new Date(
            a.created_at_server || a.created_date || a.last_retry_at || 0
          ).getTime();
          const bDate = new Date(
            b.created_at_server || b.created_date || b.last_retry_at || 0
          ).getTime();
          return bDate - aDate;
        });
        setRecords(data);
      } catch {
        // ignore refresh errors
      }
    }
  };

  const handleCopyRetryDiagnostics = (record) => {
    const diagnostics = {
      id: record.id,
      questionnaire_session_id: record.questionnaire_session_id,
      status: record.status,
      retry_count: record.retry_count || 0,
      last_retry_at: record.last_retry_at,
      linked_submission_id: record.linked_submission_id,
      zapier_sent: record.zapier_sent,
      retry_error: parseJson(record.retry_error_json),
      primary_error: parseJson(record.primary_error_json),
      fallback_error: parseJson(record.fallback_error_json),
      primary_failure_kind: record.primary_failure_kind,
      fallback_failure_kind: record.fallback_failure_kind,
    };
    copyJson(diagnostics, "Retry diagnostics copied");
  };

  const getStatusNote = (status) => {
    switch (status) {
      case "retry_success":
        return "Retry created or linked a final submission.";
      case "retry_failed":
        return "Retry failed. Review retry diagnostics before trying again.";
      case "received_intake":
        return "Intake has been received and is ready for admin review.";
      case "submitted":
        return "Submission was created during fallback handling.";
      default:
        return "";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5" />
          <span>{loadError}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">
          Express Questionnaire Intake Recovery
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          View and manage failed questionnaire submission intakes
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex-1 min-w-[280px]">
          <Input
            placeholder="Search by business, domain, email, session ID, or reason..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full"
          />
        </div>
        <div className="w-[200px]">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
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
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <RefreshCw className="w-4 h-4" />
          <span>{filteredRecords.length} records</span>
        </div>
      </div>

      {/* Records list */}
      <div className="space-y-3">
        {filteredRecords.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-slate-500">
              No intake records found
            </CardContent>
          </Card>
        ) : (
          filteredRecords.map((record) => (
            <Card key={record.id} className="overflow-hidden">
              {/* Collapsed row */}
              <div
                className="p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() =>
                  setExpandedId(expandedId === record.id ? null : record.id)
                }
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-3 font-semibold text-slate-800">
                      {record.business_name || "Unnamed business"}
                    </div>
                    <div className="col-span-2 text-sm text-slate-600">
                      {record.business_domain || "—"}
                    </div>
                    <div className="col-span-2 text-xs font-mono text-slate-500" title={record.submit_attempt_id || ""}>
                      {record.submit_attempt_id ? `Session: ${record.questionnaire_session_id} | Attempt: ${record.submit_attempt_id}` : record.questionnaire_session_id || "—"}
                    </div>
                    <div className="col-span-2 text-xs text-slate-500">
                      {formatDate(record.created_at_server || record.created_date)}
                    </div>
                    <div className="col-span-1">
                      <Badge
                        className={getStatusStyle(record.status)}
                        variant="outline"
                      >
                        {record.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="col-span-1 text-xs text-slate-500">
                      {record.primary_failure_kind || "—"}
                    </div>
                    <div className="col-span-1 text-xs font-mono text-slate-500">
                      {record.linked_submission_id ? "✓" : "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <Badge
                      variant="outline"
                      className={
                        record.zapier_sent
                          ? "bg-green-50 text-green-700 border-green-300"
                          : "bg-slate-50 text-slate-600 border-slate-300"
                      }
                    >
                      Zapier: {record.zapier_sent ? "Yes" : "No"}
                    </Badge>
                    {expandedId === record.id ? (
                      <ChevronUp className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded row */}
              {expandedId === record.id && (
                <CardContent className="p-4 border-t bg-slate-50">
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <div className="text-xs text-slate-500 mb-1">User Email</div>
                      <div className="text-sm font-medium">{record.user_email || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">User ID</div>
                      <div className="text-sm font-mono text-slate-600">{record.user_id || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Submit Attempt ID</div>
                      <div className="text-sm font-mono text-slate-600">{record.submit_attempt_id || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Intake Reason</div>
                      <div className="text-sm">{record.intake_reason || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Source</div>
                      <div className="text-sm">{record.source || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Fallback Failure Kind</div>
                      <div className="text-sm">{record.fallback_failure_kind || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Retry Count</div>
                      <div className="text-sm">{record.retry_count || 0}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Last Retry At</div>
                      <div className="text-sm">{formatDate(record.last_retry_at)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Linked Submission ID</div>
                      <div className="text-sm font-mono">{record.linked_submission_id || "—"}</div>
                    </div>
                  </div>

                  {/* Error messages */}
                  <div className="space-y-2 mb-4">
                    {record.primary_error_json && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="text-xs font-semibold text-red-700 mb-1">Primary Error</div>
                        <div className="text-xs text-red-600 font-mono whitespace-pre-wrap">
                          {(() => {
                            const err = parseJson(record.primary_error_json);
                            return err?.message || record.primary_error_json;
                          })()}
                        </div>
                      </div>
                    )}
                    {record.fallback_error_json && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="text-xs font-semibold text-amber-700 mb-1">Fallback Error</div>
                        <div className="text-xs text-amber-600 font-mono whitespace-pre-wrap">
                          {(() => {
                            const err = parseJson(record.fallback_error_json);
                            return err?.message || record.fallback_error_json;
                          })()}
                        </div>
                      </div>
                    )}
                    {record.retry_error_json && (
                      <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="text-xs font-semibold text-orange-700 mb-1">Retry Error</div>
                        <div className="text-xs text-orange-600 font-mono whitespace-pre-wrap">
                          {(() => {
                            const err = parseJson(record.retry_error_json);
                            return err?.message || record.retry_error_json;
                          })()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Retry Diagnostics */}
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-slate-700 mb-2">Retry Diagnostics</div>
                    <div className="p-3 bg-white border border-slate-200 rounded-lg">
                      <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Status:</span>
                          <Badge className={getStatusStyle(record.status)} variant="outline">
                            {record.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Retry Count:</span>
                          <span className="font-medium">{record.retry_count || 0}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Last Retry:</span>
                          <span className="font-medium">{formatDate(record.last_retry_at)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Linked Submission:</span>
                          <span className="font-mono text-slate-700">{record.linked_submission_id || "—"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Zapier Sent:</span>
                          <span className={record.zapier_sent ? "text-green-700 font-medium" : "text-slate-700 font-medium"}>
                            {record.zapier_sent ? "Yes" : "No"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Primary Failure:</span>
                          <span className="font-medium">{record.primary_failure_kind || "—"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Fallback Failure:</span>
                          <span className="font-medium">{record.fallback_failure_kind || "—"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Retry Error:</span>
                          <span className="font-medium text-slate-700">
                            {(() => {
                              const err = parseJson(record.retry_error_json);
                              return err?.message || "—";
                            })()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Zapier Sent:</span>
                          <span className={record.zapier_sent ? "text-green-700 font-medium" : "text-slate-700 font-medium"}>
                            {record.zapier_sent ? "Yes" : "No"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Zapier Error:</span>
                          <span className="font-medium text-slate-700">
                            {(() => {
                              const err = parseJson(record.zapier_error_json);
                              return err?.message || (record.zapier_error_json ? record.zapier_error_json : "—");
                            })()}
                          </span>
                        </div>
                      </div>
                      {/* Status note */}
                      {getStatusNote(record.status) && (
                        <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">
                          {getStatusNote(record.status)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Availability Summary */}
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-slate-700 mb-2">Data Availability</div>
                    <div className="p-3 bg-white border border-slate-200 rounded-lg">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Payload Available:</span>
                          {(() => {
                            const p = parseJson(record.transformed_payload_json);
                            const valid = p && p.metadata && p.userdata;
                            return (
                              <span className={valid ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
                                {valid ? "Yes" : "No"}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Raw Responses Available:</span>
                          {(() => {
                            const r = parseJson(record.raw_responses_json);
                            return (
                              <span className={r ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
                                {r ? "Yes" : "No"}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Diagnostics Available:</span>
                          {(() => {
                            const d = parseJson(record.diagnostics_json);
                            return (
                              <span className={d ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
                                {d ? "Yes" : "No"}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Linked Submission:</span>
                          <span className="font-medium text-slate-700">{record.linked_submission_id || "—"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Zapier Sent:</span>
                          <span className={record.zapier_sent ? "text-green-700 font-medium" : "text-slate-700 font-medium"}>
                            {record.zapier_sent ? "Yes" : "No"}
                          </span>
                        </div>
                      </div>
                      {/* Parse warnings */}
                      {(() => {
                        const payloadValid = parseJson(record.transformed_payload_json);
                        const responsesValid = parseJson(record.raw_responses_json);
                        const diagnosticsValid = parseJson(record.diagnostics_json);
                        const warnings = [];
                        if (!payloadValid) warnings.push("Transformed payload JSON could not be parsed.");
                        if (!responsesValid) warnings.push("Raw responses JSON could not be parsed.");
                        if (!diagnosticsValid) warnings.push("Diagnostics JSON could not be parsed.");
                        if (warnings.length === 0) return null;
                        return (
                          <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                            <div className="text-xs text-amber-700 space-y-1">
                              {warnings.map((w, i) => (
                                <div key={i}>⚠ {w}</div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Diagnostics */}
                  {record.diagnostics_json && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-slate-700 mb-2">Diagnostics</div>
                      <div className="p-3 bg-white border border-slate-200 rounded-lg">
                        {(() => {
                          const diag = parseJson(record.diagnostics_json);
                          if (!diag) return <div className="text-sm text-slate-500">Invalid diagnostics JSON</div>;
                          return (
                            <div className="grid grid-cols-3 gap-3 text-xs">
                              <div>
                                <span className="text-slate-500">Online:</span>{" "}
                                <span className="font-medium">{diag.browser_online ? "Yes" : "No"}</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Payload Size:</span>{" "}
                                <span className="font-medium">{diag.payload_size_bytes || "—"} bytes</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Fallback Attempted:</span>{" "}
                                <span className="font-medium">{diag.fallback_attempted ? "Yes" : "No"}</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Used Fallback:</span>{" "}
                                <span className="font-medium">{diag.used_fallback ? "Yes" : "No"}</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Primary Failure:</span>{" "}
                                <span className="font-medium">{diag.primary_failure_kind || "—"}</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Fallback Failure:</span>{" "}
                                <span className="font-medium">{diag.fallback_failure_kind || "—"}</span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Retry button */}
                  <div className="flex flex-wrap gap-2 mb-2">
                    {record.linked_submission_id ? (
                      <>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            if (window.confirm("This intake record is already linked to a submission. Force retry may create a duplicate FormSubmission. Continue?")) {
                              handleRetry(record, { forceRetry: true });
                            }
                          }}
                          disabled={retryingId === record.id}
                        >
                          {retryingId === record.id ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Retrying...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Force Retry
                            </>
                          )}
                        </Button>
                        <span className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                          Use only when support intentionally needs to create or relink a submission from this intake payload.
                        </span>
                      </>
                    ) : isRetryableIntake(record) ? (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleRetry(record)}
                        disabled={retryingId === record.id}
                        className={
                          record.status === "retry_failed"
                            ? "bg-red-600 hover:bg-red-700"
                            : "bg-blue-600 hover:bg-blue-700"
                        }
                      >
                        {retryingId === record.id ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Retrying...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Retry Submission
                          </>
                        )}
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                        This intake status is not currently retryable.
                      </span>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopySubmitIntakePayload(record)}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Submit-Intake Payload
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyRetryDiagnostics(record)}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Retry Diagnostics
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyPayload(record)}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Payload
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyRawResponses(record)}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Raw Responses
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyRecoveryBundle(record)}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Recovery Bundle
                    </Button>
                  </div>
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}