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
  // Escape raw control characters inside string literals (tabs, newlines, etc.)
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = c.charCodeAt(0);
    if (inStr) {
      if (esc) { out += c; esc = false; }
      else if (c === "\\") { out += c; esc = true; }
      else if (c === '"') { out += c; inStr = false; }
      else if (code < 0x20) {
        if (c === "\n") out += "\\n";
        else if (c === "\r") out += "\\r";
        else if (c === "\t") out += "\\t";
        else out += "\\u" + code.toString(16).padStart(4, "0");
      } else out += c;
    } else {
      if (c === '"') inStr = true;
      out += c;
    }
  }
  s = out;
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
        const errorMsg = repairResult.errors?.length > 0 
          ? "Repair failed:\n" + repairResult.errors.join("\n")
          : "Payload could not be repaired. Please check the JSON structure.";
        setSaveError(errorMsg);
        toast.error("Submission payload is not valid.");
        return;
      }

      const repairedPayload = repairResult.payload;

      // Enforce Express-only safety on domain and service_type
      repairedPayload.metadata.service_type = "express";
      repairedPayload.metadata.businessDomain = cleanExpressDomain(repairedPayload.metadata.businessDomain);

      const validation = validateExpressAdminIntakePayload(repairedPayload);
      if (!validation.ok) {
        setSaveError("Validation failed:\n" + validation.errors.join("\n"));
        toast.error("Validation failed. See errors above.");
        return;
      }

      // Map to DB record — _rawFormData is never included
      const record = mapExpressPayloadToFormSubmissionRecord(repairedPayload);

      // Wrap FormSubmission.create in try/catch/finally
      try {
        const res = await base44.entities.FormSubmission.create(record);
        const id = res?.id || res?.data?.id || null;

        setSubmittedId(id);
        setPayload(repairedPayload);
        setRawJson(JSON.stringify(repairedPayload, null, 2));

        toast.success("Submission saved" + (id ? ` (id: ${id})` : "") + " — sending to Zapier…");

        // Send to Zapier via the backend function
        try {
          const zapierPayload = { metadata: repairedPayload.metadata, userdata: repairedPayload.userdata };
          const zapRes = await base44.functions.invoke("sendExpressToZapier", zapierPayload);
          const zapData = zapRes?.data || zapRes;

          if (zapData?.success) {
            // Update FormSubmission zapier fields
            if (id) {
              await base44.entities.FormSubmission.update(id, {
                zapier_sent: true,
                zapier_delivery_status: "sent",
                zapier_sent_at: new Date().toISOString(),
                zapier_attempt_count: 1,
              });
            }
            toast.success("Sent to Zapier successfully.");
          } else {
            const zapErrMsg = zapData?.error || "Zapier delivery failed";
            if (id) {
              await base44.entities.FormSubmission.update(id, {
                zapier_sent: false,
                zapier_delivery_status: "failed",
                zapier_error_json: JSON.stringify({ message: zapErrMsg }),
                zapier_attempt_count: 1,
              });
            }
            toast.warning(`Submission saved but Zapier delivery failed: ${zapErrMsg}`);
          }
        } catch (zapErr) {
          const zapErrMsg = zapErr?.message || "Unknown Zapier error";
          if (id) {
            await base44.entities.FormSubmission.update(id, {
              zapier_sent: false,
              zapier_delivery_status: "failed",
              zapier_error_json: JSON.stringify({ message: zapErrMsg }),
              zapier_attempt_count: 1,
            });
          }
          toast.warning(`Submission saved but Zapier delivery failed: ${zapErrMsg}`);
        }
      } catch (createErr) {
        const message = createErr?.message || createErr?.toString() || "Unknown error";
        setSaveError(`Submission failed: ${message}`);
        toast.error(`Failed to save submission: ${message}`);
      }
    } finally {
      // Always clear submitting state
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
          Saves a FormSubmission to the database and delivers it to Zapier via the sendExpressToZapier function.
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