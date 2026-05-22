import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
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
import { ChevronDown, ChevronUp, Copy, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function canParseJson(value) {
  if (!value) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function formatDate(value) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
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

// ─── Draft Row ───────────────────────────────────────────────────────────────

function DraftRow({ draft, isDuplicate }) {
  const [expanded, setExpanded] = useState(false);

  const responsesParseOk = canParseJson(draft.responses_json);
  const mappedParseOk = canParseJson(draft.mapped_payload_json);
  const validationParseOk = canParseJson(draft.validation_status_json);

  const responses = safeJsonParse(draft.responses_json, {});
  const validationStatus = safeJsonParse(draft.validation_status_json, {});
  const metadata = safeJsonParse(draft.metadata_json, {});
  const userdata = safeJsonParse(draft.userdata_json, {});
  const mappedPayload = safeJsonParse(draft.mapped_payload_json, null);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(responses, null, 2));
    toast.success("Responses JSON copied.");
  };

  const handleCopyBundle = () => {
    const bundle = {
      session_id: draft.session_id,
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
    };
    navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    toast.success("Recovery bundle copied.");
  };

  const handleCopySubmitIntake = () => {
    // Prefer mapped_payload_json; fallback to metadata + userdata
    let base = mappedPayload && mappedPayload.metadata && mappedPayload.userdata
      ? { metadata: { ...mappedPayload.metadata }, userdata: { ...mappedPayload.userdata } }
      : { metadata: { ...metadata }, userdata: { ...userdata } };

    // Force express service type and ensure session id is present
    base.metadata.service_type = "express";
    if (!base.metadata.questionnaire_session_id) {
      base.metadata.questionnaire_session_id = draft.session_id || "";
    }

    navigator.clipboard.writeText(JSON.stringify(base, null, 2));
    toast.success("Submit-intake payload copied.");
  };

  const hasResponses = Object.keys(responses).length > 0;
  const hasMapped = mappedPayload !== null && Object.keys(mappedPayload).length > 0;
  const hasValidation = Object.keys(validationStatus).length > 0;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      {/* Summary row */}
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

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 space-y-4">
          {/* Meta grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
            <Detail label="User name" value={draft.user_name} />
            <Detail label="User ID" value={draft.user_id} mono />
            <Detail label="Submit attempted" value={formatDate(draft.submit_attempted_at)} />
            <Detail label="Submitted at" value={formatDate(draft.submitted_at)} />
            <Detail label="Final submission ID" value={draft.final_submission_id} mono />
            <Detail label="Current question" value={draft.current_question_id} />
            <Detail label="Last changed at" value={formatDate(draft.last_changed_at)} />
            <Detail label="Last saved at" value={formatDate(draft.last_saved_at)} />
          </div>

          {/* Availability summary */}
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

          {/* Parse warnings */}
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
              {typeof draft.submit_error === "string"
                ? draft.submit_error
                : JSON.stringify(draft.submit_error)}
            </div>
          )}

          {/* Actions */}
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

          {/* Parsed responses */}
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

// ─── Page ────────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "submit_attempted", label: "Submit Attempted" },
  { value: "submit_failed", label: "Submit Failed" },
  { value: "submitted", label: "Submitted" },
];

export default function FormDraftRecovery() {
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState(null);

  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Auth check on mount
  useEffect(() => {
    base44.auth.isAuthenticated().then(async (isAuth) => {
      if (isAuth) {
        const me = await base44.auth.me();
        setUser(me);
        setAuthed(true);
      }
      setLoadingAuth(false);
    });
  }, []);

  // Load drafts only after auth
  useEffect(() => {
    if (!authed) return;
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
  }, [authed]);

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

  // Auth loading
  if (loadingAuth) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-6 h-6 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated
  if (!authed) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-slate-600 text-sm">Please sign in to view Express draft recovery data.</p>
        <Button
          onClick={() => base44.auth.redirectToLogin(window.location.pathname)}
          style={{ backgroundColor: "#004B87", color: "white", borderRadius: "2px" }}
          className="px-8 py-2 font-bold text-sm uppercase tracking-wider hover:opacity-90"
        >
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* Header */}
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

      {/* Filters */}
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
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Load error */}
      {loadError && (
        <Card className="border-red-200 bg-red-50 mb-6">
          <CardContent className="pt-4 text-sm text-red-700">{loadError}</CardContent>
        </Card>
      )}

      {/* Draft list */}
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
    </div>
  );
}