import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, FileJson2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  initialExpressAdminIntakePayload,
  repairExpressAdminIntakePayload,
  validateExpressAdminIntakePayload,
} from "@/lib/adminExpressIntakePayload";
import { EXPRESS_TEMPLATE_LOGO_DATA_URI } from "@/components/questionnaire/expressTemplateLogo.js";
import AdminFloatingMenu from "@/components/admin/AdminFloatingMenu";
import { useDraftRecoveryAccess } from "@/lib/DraftRecoveryAccessContext";
import { getBackendErrorMessage } from "@/lib/draftRecoveryAccess";
import "./FormDraftRecovery.css";
import "./AdminSubmitIntake.css";

// Auto-fix common JSON formatting issues
function autoFixJson(raw) {
  let s = raw;
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
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
  const { recoveryGrant, lock } = useDraftRecoveryAccess();
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

      const validation = validateExpressAdminIntakePayload(repairedPayload);
      if (!validation.ok) {
        setSaveError("Validation failed:\n" + validation.errors.join("\n"));
        toast.error("Validation failed. See errors above.");
        return;
      }

      try {
        const response = await base44.functions.invoke("submitExpressAdminIntake", {
          payload: repairedPayload,
          recoveryGrant,
        });
        const result = response?.data || response;
        if (!result?.success || !result?.submissionId) {
          throw new Error(result?.error || "The intake submission could not be saved.");
        }
        const id = result.submissionId;
        const normalizedPayload = result.normalizedPayload || repairedPayload;

        setSubmittedId(id);
        setPayload(normalizedPayload);
        setRawJson(JSON.stringify(normalizedPayload, null, 2));

        if (result.zapierSent) {
          toast.success(`Submission saved (id: ${id}) and sent to Zapier.`);
        } else {
          toast.warning(`Submission saved (id: ${id}), but Zapier delivery failed: ${result.zapierError || "Unknown Zapier error"}`);
        }
      } catch (createErr) {
        const status = createErr?.response?.status || createErr?.status;
        if (status === 401 || status === 403) lock();
        const message = getBackendErrorMessage(createErr, "Unknown submission error");
        setSaveError(`Submission failed: ${message}`);
        toast.error(`Failed to save submission: ${message}`);
      }
    } finally {
      // Always clear submitting state
      setSubmitting(false);
    }
  };

  return (
    <main className="draft-recovery-brand draft-recovery-brand-page admin-submit-intake-page">
      <AdminFloatingMenu currentPage="submit-intake" />
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
            <h1>Express Admin Intake Submission</h1>
            <p className="draft-recovery-brand__hero-copy">
              Review, repair, and securely submit an Express questionnaire payload to FormSubmission and Zapier.
            </p>
          </div>
        </header>

        <div className="draft-recovery-brand__content">
          {submittedId && (
            <div className="brand-panel admin-submit-intake__notice admin-submit-intake__notice--success" role="status">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>Submitted successfully — ID: <span className="font-mono font-semibold">{submittedId}</span></span>
            </div>
          )}

          {saveError && (
            <div className="brand-panel admin-submit-intake__notice admin-submit-intake__notice--error" role="alert">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <section className="brand-panel admin-submit-intake__panel" aria-labelledby="intake-payload-heading">
            <div className="brand-section-header">
              <p className="draft-recovery-brand__section-kicker">Create a questionnaire record</p>
              <h2 id="intake-payload-heading" className="brand-section-title">Express Submission Payload</h2>
              <p className="draft-recovery-brand__section-copy">
                Edit the JSON as needed. The payload is repaired and validated again on the server before any record is created.
              </p>
            </div>

            <div className="admin-submit-intake__body">
              <div className="admin-submit-intake__security-note">
                <FileJson2 className="w-5 h-5" aria-hidden="true" />
                <div>
                  <p>Password-protected admin session</p>
                  <span>The same seven-day access grant is shared with Draft Recovery and revalidated by the backend.</span>
                </div>
              </div>

              <div className="brand-action-group">
                <p className="brand-action-label">Actions</p>
                <div className="brand-action-buttons">
                  {!editing ? (
                    <>
                      <Button onClick={handleSubmit} disabled={submitting} className="brand-button-primary">
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        {submitting ? "Submitting..." : "Submit Now"}
                      </Button>
                      <Button variant="outline" onClick={handleEdit} disabled={submitting} className="brand-button-secondary">
                        Edit JSON
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={handleSaveJson} className="brand-button-primary">Save JSON</Button>
                      <Button variant="outline" onClick={handleCancelEdit} className="brand-button-secondary">Cancel</Button>
                    </>
                  )}
                </div>
              </div>

              <div className="admin-submit-intake__json-shell">
                <div className="admin-submit-intake__json-heading">
                  <span>{editing ? "Editing payload" : "Payload preview"}</span>
                  <span>JSON</span>
                </div>
                {editing ? (
                  <Textarea
                    aria-label="Express submission payload JSON"
                    value={rawJson}
                    onChange={(event) => setRawJson(event.target.value)}
                    className="admin-submit-intake__editor"
                    spellCheck={false}
                  />
                ) : (
                  <pre className="admin-submit-intake__preview">{JSON.stringify(payload, null, 2)}</pre>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
