import React, { useCallback, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ClientDataDeletionDialog from "@/components/admin/ClientDataDeletionDialog";
import { getBackendErrorMessage } from "@/lib/draftRecoveryAccess";

function displayDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function parse(value) {
  if (typeof value !== "string" || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function safeSubmissionSnapshot(submission) {
  const transformed = parse(submission.transformed_payload_json);
  if (transformed) return { source: "transformed_payload_json", payload: transformed, legacy: false };
  const raw = parse(submission.raw_responses_json);
  if (raw) return { source: "raw_responses_json", payload: raw, legacy: false };
  const excluded = new Set(["created_by", "updated_by", "retention_protected_at"]);
  return {
    source: "normalized FormSubmission fields",
    legacy: true,
    payload: Object.fromEntries(Object.entries(submission).filter(([key]) => !excluded.has(key))),
  };
}

export default function StandaloneSubmissionRow({ submission: summary, onLoadDetail, recoveryGrant, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const record = full || summary;
  const snapshot = safeSubmissionSnapshot(record);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setFull(await onLoadDetail(summary.id)); }
    catch (loadError) { setError(getBackendErrorMessage(loadError, "Submission details could not be loaded.")); }
    finally { setLoading(false); }
  }, [onLoadDetail, summary.id]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !full && !loading) load();
  };

  return (
    <article className={`brand-record-card ${expanded ? "brand-record-card--expanded" : ""}`}>
      <button type="button" className="brand-record-trigger brand-record-trigger--submission" onClick={toggle} aria-expanded={expanded}>
        <div className="brand-record-primary"><strong>{record.business_name || "Unnamed business"}</strong><span>{record.business_domain || "—"}</span></div>
        <div className="brand-record-field"><span className="brand-record-label">User Email</span><span className="brand-record-value">{record.user_email || "—"}</span></div>
        <div className="brand-record-status">
          <Badge variant="outline" className={`brand-status-badge ${record.zapier_delivery_status === "sent" ? "brand-status-badge--submitted" : record.zapier_delivery_status === "failed" ? "brand-status-badge--danger" : "brand-status-badge--neutral"}`}>
            {record.zapier_delivery_status || "submitted"}
          </Badge>
          {!record.raw_responses_json && !record.transformed_payload_json && <Badge variant="outline" className="brand-status-badge brand-status-badge--warning">Legacy snapshot unavailable</Badge>}
        </div>
        <div className="brand-record-field"><span className="brand-record-label">Submitted</span><span className="brand-record-value">{displayDate(record.submission_datetime || record.created_date)}</span></div>
        <div className="brand-record-field brand-record-field--session"><span className="brand-record-label">Session ID</span><span className="brand-record-value font-mono">{record.questionnaire_session_id || "—"}</span></div>
        <div className="brand-record-field brand-record-field--session"><span className="brand-record-label">Submission ID</span><span className="brand-record-value font-mono">{record.id}</span></div>
        <div className="brand-record-chevron">{expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</div>
      </button>

      {expanded && (
        <div className="brand-expanded-panel">
          {loading ? <div className="draft-recovery-brand__loading"><Loader2 className="w-4 h-4 animate-spin" /> Loading submission…</div>
            : error ? <div className="draft-recovery-brand__detail-error"><span><AlertTriangle className="w-4 h-4" /> {error}</span><Button size="sm" variant="outline" onClick={load}>Retry</Button></div>
              : full ? <>
                <div className="brand-detail-grid brand-detail-grid--submission">
                  <div className="brand-detail-column">
                    <p className="brand-detail"><span className="brand-detail__label">Business Name:</span><span>{record.business_name || "—"}</span></p>
                    <p className="brand-detail"><span className="brand-detail__label">Domain:</span><span>{record.business_domain || "—"}</span></p>
                    <p className="brand-detail"><span className="brand-detail__label">User Email:</span><span>{record.user_email || "—"}</span></p>
                  </div>
                  <div className="brand-detail-column">
                    <p className="brand-detail"><span className="brand-detail__label">Submission ID:</span><span className="font-mono">{record.id}</span></p>
                    <p className="brand-detail"><span className="brand-detail__label">Submit Attempt ID:</span><span className="font-mono">{record.submit_attempt_id || "—"}</span></p>
                    <p className="brand-detail"><span className="brand-detail__label">Retention:</span><span>{record.retention_policy || "indefinite_until_manual_deletion"}</span></p>
                  </div>
                </div>
                {snapshot.legacy && <div className="brand-legacy-warning"><AlertTriangle className="w-4 h-4" /><span>The original raw/transformed snapshot was never captured for this legacy submission. Its normalized submission fields remain available and are shown below.</span></div>}
                <div className="brand-action-group">
                  <p className="brand-action-label">Actions</p>
                  <div className="brand-action-buttons">
                    <Button size="sm" variant="outline" className="brand-button-secondary" onClick={() => { navigator.clipboard.writeText(JSON.stringify(snapshot.payload, null, 2)); toast.success("Submission payload copied"); }}><Copy className="w-3.5 h-3.5" /> Copy Available Payload</Button>
                    <ClientDataDeletionDialog recordType="submission" record={record} recoveryGrant={recoveryGrant} onDeleted={onRefresh} />
                  </div>
                </div>
                <div className="brand-json-panel"><div className="brand-json-panel__header"><p>Available Submission Payload</p><span>{snapshot.source}</span></div><pre>{JSON.stringify(snapshot.payload, null, 2)}</pre></div>
              </> : null}
        </div>
      )}
    </article>
  );
}
