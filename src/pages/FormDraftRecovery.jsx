import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Copy, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import LocalRecoveryBackupsPanel from "@/components/admin/LocalRecoveryBackupsPanel";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  try {
    const d = new Date(value);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString();
  } catch { return "—"; }
}

const STATUS_BADGE = {
  draft: "bg-slate-100 text-slate-700 border-slate-300",
  submit_attempted: "bg-yellow-50 text-yellow-800 border-yellow-300",
  submit_failed: "bg-red-50 text-red-700 border-red-300",
  submitted: "bg-green-50 text-green-700 border-green-300",
};

function StatusBadge({ status }) {
  const cls = STATUS_BADGE[status] || "bg-slate-100 text-slate-600 border-slate-300";
  return (
    <Badge variant="outline" className={`text-xs font-medium border ${cls}`}>
      {status || "unknown"}
    </Badge>
  );
}

// ─── Detail Cell ─────────────────────────────────────────────────────────────

function Detail({ label, value, mono = false }) {
  return (
    <div>
      <p className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">{label}</p>
      <p className={`text-slate-700 truncate mt-0.5 ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </p>
    </div>
  );
}

// ─── Draft Row ────────────────────────────────────────────────────────────────

function DraftRow({ draft, isDuplicate }) {
  const [expanded, setExpanded] = useState(false);

  const responsesParseOk = canParseJson(draft.responses_json);
  const mappedParseOk = canParseJson(draft.mapped_payload_json);

  const responses = safeJsonParse(draft.responses_json, {});
  const validationStatus = safeJsonParse(draft.validation_status_json, {});
  const metadata = safeJsonParse(draft.metadata_json, {});
  const userdata = safeJsonParse(draft.userdata_json, {});
  const mappedPayload = safeJsonParse(draft.mapped_payload_json, null);

  const hasResponses = Object.keys(responses).length > 0;
  const hasMapped = mappedPayload !== null && Object.keys(mappedPayload).length > 0;
  const hasValidation = Object.keys(validationStatus).length > 0;

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(responses, null, 2));
    toast.success("Responses JSON copied.");
  };

  const handleCopyBundle = () => {
    const bundle = {
      session_id: draft.session_id,
      submit_attempt_id: metadata?.submit_attempt_id || "",
      business_name: draft.business_name,
      domain: draft.domain,
      status: draft.status,
      last_saved_at: draft.last_saved_at,
      submitted_at: draft.submitted_at,
      final_submission_id: draft.final_submission_id,
      metadata,
      userdata,
      mapped_payload: mappedPayload,
      responses,
      validation_status: validationStatus,
      // Include Zapier delivery status if present in mapped payload
      zapier_delivery_status: mappedPayload?.zapier_delivery_status,
      zapier_sent: mappedPayload?.zapier_sent,
      zapier_error: mappedPayload?.zapier_error_json,
    };
    navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    toast.success("Recovery bundle copied.");
  };

  const handleCopySubmitIntake = () => {
    const base = mappedPayload?.metadata && mappedPayload?.userdata
      ? { metadata: { ...mappedPayload.metadata }, userdata: { ...mappedPayload.userdata } }
      : { metadata: { ...metadata }, userdata: { ...userdata } };
    base.metadata.service_type = "express";
    if (!base.metadata.questionnaire_session_id) {
      base.metadata.questionnaire_session_id = draft.session_id || "";
    }
    // Preserve submit_attempt_id if present
    if (metadata?.submit_attempt_id) {
      base.metadata.submit_attempt_id = metadata.submit_attempt_id;
    }
    navigator.clipboard.writeText(JSON.stringify(base, null, 2));
    toast.success("Submit-intake payload copied.");
  };

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 bg-white hover:bg-slate-50 transition-colors flex items-start gap-3"
      >
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1">
          <div>
            <p className="text-sm font-semibold text-slate-800 truncate">
              {draft.business_name || "Unnamed business"}
            </p>
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
                <AlertTriangle className="w-3 h-3" /> Duplicate session
              </Badge>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">{formatDate(draft.last_saved_at || draft.created_date)}</p>
            {draft.last_changed_question_id && (
              <p className="text-xs text-slate-400">Last Q: {draft.last_changed_question_id}</p>
            )}
          </div>
        </div>
        <div className="shrink-0 ml-2 mt-0.5 text-slate-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
            <Detail label="User name" value={draft.user_name} />
            <Detail label="User ID" value={draft.user_id} mono />
            <Detail label="Submit attempt ID" value={metadata?.submit_attempt_id || "—"} mono />
            <Detail label="Submit attempted" value={formatDate(draft.submit_attempted_at)} />
            <Detail label="Submitted at" value={formatDate(draft.submitted_at)} />
            <Detail label="Final submission ID" value={draft.final_submission_id} mono />
            <Detail label="Current question" value={draft.current_question_id} />
            <Detail label="Last changed at" value={formatDate(draft.last_changed_at)} />
            <Detail label="Last saved at" value={formatDate(draft.last_saved_at)} />
            {mappedPayload && (
              <>
                <Detail label="Zapier status" value={mappedPayload.zapier_delivery_status} />
                <Detail label="Zapier sent" value={mappedPayload.zapier_sent ? "Yes" : "No"} />
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-slate-600 bg-white border border-slate-200 rounded px-3 py-2">
            <span>
              <span className="font-medium text-slate-500">Mapped Payload:</span>{" "}
              <span className={hasMapped ? "text-green-700" : "text-slate-400"}>{hasMapped ? "Yes" : "No"}</span>
            </span>
            <span>
              <span className="font-medium text-slate-500">Responses:</span>{" "}
              <span className={hasResponses ? "text-green-700" : "text-slate-400"}>{hasResponses ? "Yes" : "No"}</span>
            </span>
            <span>
              <span className="font-medium text-slate-500">Validation Status:</span>{" "}
              <span className={hasValidation ? "text-green-700" : "text-slate-400"}>{hasValidation ? "Yes" : "No"}</span>
            </span>
          </div>

          {draft.responses_json && !responsesParseOk && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Responses JSON could not be parsed.
            </p>
          )}
          {draft.mapped_payload_json && !mappedParseOk && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Mapped payload JSON could not be parsed.
            </p>
          )}
          {draft.save_error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              <span className="font-semibold">Save error:</span> {draft.save_error}
            </div>
          )}
          {draft.submit_error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              <span className="font-semibold">Submit error:</span>{" "}
              {typeof draft.submit_error === "string" ? draft.submit_error : JSON.stringify(draft.submit_error)}
            </div>
          )}
          {draft.status === "submitted" && draft.final_submission_id && (
            <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>Submission Accepted: Yes (ID: {draft.final_submission_id})</span>
            </div>
          )}
          {draft.status === "submit_failed" && draft.submit_error && (() => {
            const err = safeJsonParse(draft.submit_error);
            if (err?.intakeId) {
              return (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Received via Durable Intake: Yes (ID: {err.intakeId})</span>
                </div>
              );
            }
            return null;
          })()}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={handleCopyJson} className="text-xs gap-1.5">
              <Copy className="w-3.5 h-3.5" /> Copy JSON
            </Button>
            <Button size="sm" variant="outline" onClick={handleCopyBundle} className="text-xs gap-1.5">
              <Copy className="w-3.5 h-3.5" /> Copy Recovery Bundle
            </Button>
            <Button size="sm" variant="outline" onClick={handleCopySubmitIntake} className="text-xs gap-1.5">
              <Copy className="w-3.5 h-3.5" /> Copy Submit-Intake Payload
            </Button>
          </div>

          {hasResponses && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">Parsed Responses</p>
              <pre className="bg-white border border-slate-200 rounded p-3 text-xs font-mono overflow-auto max-h-64 text-slate-700 whitespace-pre-wrap">
                {JSON.stringify(responses, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "submit_attempted", label: "Submit Attempted" },
  { value: "submit_failed", label: "Submit Failed" },
  { value: "submitted", label: "Submitted" },
];

export default function FormDraftRecovery() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    base44.entities.FormDraft.list()
      .then((data) => {
        const sorted = [...(data || [])].sort((a, b) => {
          const ta = new Date(a.last_saved_at || a.created_date || 0).getTime();
          const tb = new Date(b.last_saved_at || b.created_date || 0).getTime();
          return tb - ta;
        });
        setDrafts(sorted);
      })
      .catch((err) => setLoadError(err?.message || "Failed to load drafts."))
      .finally(() => setLoading(false));
  }, []);

  const duplicateSessionIds = useMemo(() => {
    const counts = {};
    drafts.forEach((d) => {
      if (d.session_id) counts[d.session_id] = (counts[d.session_id] || 0) + 1;
    });
    return new Set(Object.keys(counts).filter((k) => counts[k] > 1));
  }, [drafts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drafts.filter((d) => {
      const matchStatus = statusFilter === "all" || d.status === statusFilter;
      const matchSearch =
        !q ||
        (d.business_name || "").toLowerCase().includes(q) ||
        (d.domain || "").toLowerCase().includes(q) ||
        (d.user_email || "").toLowerCase().includes(q) ||
        (d.session_id || "").toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [drafts, search, statusFilter]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800" style={{ fontFamily: "Raleway, sans-serif" }}>
          Express Form Draft Recovery
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Review recent Express questionnaire drafts and copy recovery data for support.
        </p>
        {user?.email && (
          <p className="text-xs text-slate-400 mt-1">Signed in as {user.email}</p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <Input
          placeholder="Search by business, domain, email, or session id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loadError && (
        <Card className="border-red-200 bg-red-50 mb-6">
          <CardContent className="pt-4 text-sm text-red-700">{loadError}</CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading drafts…</p>
      ) : filtered.length === 0 ? (
        <p className="text-slate-500 text-sm">No matching drafts found.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((draft) => (
            <DraftRow
              key={draft.id}
              draft={draft}
              isDuplicate={duplicateSessionIds.has(draft.session_id)}
            />
          ))}
        </div>
      )}

      {/* Local Browser Recovery Backups Panel */}
      <div className="mt-8">
        <LocalRecoveryBackupsPanel />
      </div>
    </div>
  );
}