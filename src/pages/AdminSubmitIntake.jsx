import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  initialExpressAdminIntakePayload,
  repairExpressAdminIntakePayload,
  validateExpressAdminIntakePayload,
} from "@/lib/adminExpressIntakePayload";
import { mapExpressPayloadToFormSubmissionRecord, cleanExpressDomain } from "@/lib/expressQuestionnairePayload";

// Auto-fix common JSON formatting issues
function autoFixJson(raw) {
  let s = raw;
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/\/\/[^\n]*/g, "");
  s = s.replace(/,(\s*[}\]])/g, "$1");
  const opens = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
  if (opens > 0) s += "}".repeat(opens);
  if (openBrackets > 0) s += "]".repeat(openBrackets);
  return s;
}

export default function AdminSubmitIntake() {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState(null);
  const [payload, setPayload] = useState(initialExpressAdminIntakePayload());
  const [editing, setEditing] = useState(false);
  const [rawJson, setRawJson] = useState(() => JSON.stringify(initialExpressAdminIntakePayload(), null, 2));
  const [saveError, setSaveError] = useState("");
  const [originalBeforeEdit, setOriginalBeforeEdit] = useState(null);

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
    const fixed = autoFixJson(rawJson);
    try {
      const parsed = JSON.parse(fixed);
      setPayload(parsed);
      setRawJson(JSON.stringify(parsed, null, 2));
      setEditing(false);
      setSaveError("");
      // Editing JSON clears the submitted id so admin can safely resubmit
      setSubmittedId(null);
    } catch (err) {
      setSaveError(`JSON parse error: ${err.message} — Check for mismatched quotes, trailing commas, or unbalanced brackets.`);
    }
  };

  const handleSubmit = async () => {
    setSaveError("");

    // Duplicate-submission guard
    if (submittedId) {
      const confirmed = window.confirm(
        "This payload was already submitted (id: " + submittedId + ").\n\nSubmitting again will create a duplicate record. Continue anyway?"
      );
      if (!confirmed) return;
    }

    setSubmitting(true);

    try {
      const repairResult = repairExpressAdminIntakePayload(payload);
      if (!repairResult.ok) {
        setSaveError("Payload could not be repaired:\n" + repairResult.errors.join("\n"));
        toast.error("Submission payload is not valid.");
        setSubmitting(false);
        return;
      }

      const repaired = repairResult.payload;

      // Enforce Express-only safety on domain and service_type
      repaired.metadata.service_type = "express";
      repaired.metadata.businessDomain = cleanExpressDomain(repaired.metadata.businessDomain);

      const validation = validateExpressAdminIntakePayload(repaired);
      if (!validation.ok) {
        setSaveError("Validation failed:\n" + validation.errors.join("\n"));
        toast.error("Validation failed. See errors above.");
        setSubmitting(false);
        return;
      }

      // Map to DB record — _rawFormData is never included
      const record = mapExpressPayloadToFormSubmissionRecord(repaired);

      const res = await base44.entities.FormSubmission.create(record);
      const id = res?.id || res?.data?.id || null;

      setSubmittedId(id);
      setPayload(repaired);
      setRawJson(JSON.stringify(repaired, null, 2));

      toast.success("Submission saved" + (id ? ` (id: ${id})` : ""));
    } catch (err) {
      const message = err?.message || err || "Unknown error";
      setSaveError(`Submission failed: ${message}`);
      toast.error("Submission failed. See error details above.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800" style={{ fontFamily: "Raleway, sans-serif" }}>
          Express Admin Intake Submission
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Paste or edit an Express questionnaire payload, validate it, and save it to FormSubmission.
        </p>
        <p className="text-xs text-slate-400 mt-1">
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
              {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {submitting ? "Submitting..." : "Submit Now"}
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