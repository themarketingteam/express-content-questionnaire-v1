import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  initialExpressAdminIntakePayload,
  repairExpressAdminIntakePayload,
  validateExpressAdminIntakePayload,
} from "@/lib/adminExpressIntakePayload";
import { mapExpressPayloadToFormSubmissionRecord } from "@/lib/expressQuestionnairePayload";

// Auto-fix common JSON formatting issues
function autoFixJson(raw) {
  let s = raw;
  // Normalize smart quotes
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  // Remove block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments
  s = s.replace(/\/\/[^\n]*/g, "");
  // Remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, "$1");
  // Balance missing closing braces/brackets
  const opens = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
  if (opens > 0) s += "}".repeat(opens);
  if (openBrackets > 0) s += "]".repeat(openBrackets);
  return s;
}

export default function AdminSubmitIntake() {
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState(null);
  const [payload, setPayload] = useState(initialExpressAdminIntakePayload());
  const [editing, setEditing] = useState(false);
  const [rawJson, setRawJson] = useState(() => JSON.stringify(initialExpressAdminIntakePayload(), null, 2));
  const [saveError, setSaveError] = useState("");
  const [originalBeforeEdit, setOriginalBeforeEdit] = useState(null);

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

  const handleEdit = () => {
    setOriginalBeforeEdit(payload);
    setRawJson(JSON.stringify(payload, null, 2));
    setEditing(true);
    setSaveError("");
  };

  const handleCancelEdit = () => {
    setPayload(originalBeforeEdit);
    setRawJson(JSON.stringify(originalBeforeEdit, null, 2));
    setEditing(false);
    setSaveError("");
  };

  const handleSaveJson = () => {
    let fixed = autoFixJson(rawJson);
    try {
      const parsed = JSON.parse(fixed);
      setPayload(parsed);
      setRawJson(JSON.stringify(parsed, null, 2));
      setEditing(false);
      setSaveError("");
    } catch (err) {
      setSaveError(`Invalid JSON: ${err.message}`);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSaveError("");

    const repaired = repairExpressAdminIntakePayload(payload);
    if (!repaired) {
      setSaveError("Payload could not be repaired. Please check the JSON structure.");
      toast.error("Submission payload is not valid.");
      setSubmitting(false);
      return;
    }

    const { valid, errors } = validateExpressAdminIntakePayload(repaired);
    if (!valid) {
      setSaveError(`Validation failed:\n${errors.join("\n")}`);
      toast.error("Submission payload is not valid.");
      setSubmitting(false);
      return;
    }

    const record = mapExpressPayloadToFormSubmissionRecord(repaired);
    const res = await base44.entities.FormSubmission.create(record);
    const id = res?.id || res?.data?.id || null;

    setSubmittedId(id);
    setPayload(repaired);
    setRawJson(JSON.stringify(repaired, null, 2));

    // Zapier resend is intentionally handled by the later server-side Zapier wrapper resource.

    toast.success(`Submission saved${id ? ` (id: ${id})` : ""}`);
    setSubmitting(false);
  };

  if (loadingAuth) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-slate-600 text-lg">You must be signed in to access this page.</p>
        <Button onClick={() => base44.auth.redirectToLogin(window.location.pathname)}>
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800" style={{ fontFamily: "Raleway, sans-serif" }}>
          Admin — Submit Express Intake
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Signed in as <span className="font-medium">{user?.email}</span>
        </p>
      </div>

      {submittedId && (
        <div className="flex items-center gap-2 mb-6 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Submitted — id: <span className="font-mono font-semibold">{submittedId}</span></span>
        </div>
      )}

      {saveError && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm whitespace-pre-wrap">
          {saveError}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {!editing ? (
          <>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Submit Now
            </Button>
            <Button variant="outline" onClick={handleEdit} disabled={submitting}>
              Edit JSON
            </Button>
          </>
        ) : (
          <>
            <Button onClick={handleSaveJson}>Save JSON</Button>
            <Button variant="outline" onClick={handleCancelEdit}>Cancel</Button>
          </>
        )}
      </div>

      {editing ? (
        <Textarea
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          className="font-mono text-xs min-h-[600px] resize-y border-slate-300"
          spellCheck={false}
        />
      ) : (
        <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-mono overflow-auto max-h-[600px] whitespace-pre-wrap text-slate-700">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}