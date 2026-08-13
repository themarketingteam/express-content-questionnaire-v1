import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { getBackendErrorMessage } from "@/lib/draftRecoveryAccess";

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Given an editable payload object, business name, and domain,
 * returns a new payload with those values patched in.
 */
function patchPayload(payload, businessName, businessDomain) {
  if (!payload) return payload;
  const next = JSON.parse(JSON.stringify(payload)); // deep clone
  if (next.metadata) {
    if (businessName !== undefined) next.metadata.business_name = businessName;
    if (businessDomain !== undefined) {
      next.metadata.businessDomain = businessDomain;
      next.metadata.business_domain = businessDomain;
    }
  }
  if (next.userdata) {
    if (businessName !== undefined) next.userdata.business_name = businessName;
  }
  return next;
}

export default function PayloadEditor({ draft, initialPayload, onRefresh, recoveryGrant }) {
  const [open, setOpen] = useState(false);

  // Editable fields
  const [businessName, setBusinessName] = useState(draft.business_name || "");
  const [businessDomain, setBusinessDomain] = useState(draft.domain || "");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize JSON editor from payload whenever it changes or panel opens
  useEffect(() => {
    if (open && initialPayload) {
      const patched = patchPayload(initialPayload, businessName, businessDomain);
      setJsonText(JSON.stringify(patched, null, 2));
    }
  }, [open]);

  // Keep JSON in sync when business name / domain change
  const handleBusinessNameChange = (val) => {
    setBusinessName(val);
    try {
      const parsed = JSON.parse(jsonText);
      const patched = patchPayload(parsed, val, businessDomain);
      setJsonText(JSON.stringify(patched, null, 2));
      setJsonError("");
    } catch {
      // JSON is currently invalid — just update the field, user will fix JSON
    }
  };

  const handleBusinessDomainChange = (val) => {
    setBusinessDomain(val);
    try {
      const parsed = JSON.parse(jsonText);
      const patched = patchPayload(parsed, businessName, val);
      setJsonText(JSON.stringify(patched, null, 2));
      setJsonError("");
    } catch {
      // JSON is currently invalid — just update the field
    }
  };

  const handleJsonChange = (val) => {
    setJsonText(val);
    try {
      const parsed = JSON.parse(val);
      setJsonError("");
      // Sync business name / domain fields from JSON if metadata exists
      if (parsed?.metadata?.business_name) setBusinessName(parsed.metadata.business_name);
      if (parsed?.metadata?.businessDomain) setBusinessDomain(parsed.metadata.businessDomain);
      else if (parsed?.metadata?.business_domain) setBusinessDomain(parsed.metadata.business_domain);
    } catch {
      setJsonError("Invalid JSON — fix syntax before saving.");
    }
  };

  const getValidPayload = () => {
    try {
      return { ok: true, payload: JSON.parse(jsonText) };
    } catch {
      return { ok: false, payload: null };
    }
  };

  // Save edited payload back to the draft record
  const handleSavePayload = async () => {
    const { ok, payload } = getValidPayload();
    if (!ok) { toast.error("Fix JSON errors before saving."); return; }

    setIsSaving(true);
    try {
      const response = await base44.functions.invoke("draftRecoveryData", {
        action: "updateDraft",
        draftId: draft.id,
        updates: {
          business_name: businessName,
          domain: businessDomain,
          mapped_payload_json: JSON.stringify(payload),
        },
        recoveryGrant,
      });
      const data = response?.data || response || {};
      if (!data.success) throw new Error(data.error || "Failed to save draft.");
      toast.success("Draft updated — payload, business name, and domain saved.");
      onRefresh?.();
    } catch (err) {
      toast.error(getBackendErrorMessage(err, "Failed to save draft."));
    } finally {
      setIsSaving(false);
    }
  };

  // Save + immediately retry submission with the edited payload
  const handleSaveAndRetry = async () => {
    const { ok, payload } = getValidPayload();
    if (!ok) { toast.error("Fix JSON errors before retrying."); return; }
    if (!businessName?.trim()) { toast.error("Business Name is required."); return; }

    setIsSubmitting(true);
    try {
      // 1. Persist edits to draft
      const updateResponse = await base44.functions.invoke("draftRecoveryData", {
        action: "updateDraft",
        draftId: draft.id,
        updates: {
          business_name: businessName,
          domain: businessDomain,
          mapped_payload_json: JSON.stringify(payload),
        },
        recoveryGrant,
      });
      const updateData = updateResponse?.data || updateResponse || {};
      if (!updateData.success) throw new Error(updateData.error || "Failed to save draft.");

      // 2. Trigger retry via retryQuestionnaireIntakeSubmission with the edited payload
      const res = await base44.functions.invoke("retryQuestionnaireIntakeSubmission", {
        questionnaireSessionId: draft.session_id,
        forceRetry: true,
        payload,
        recoveryGrant,
      });
      const data = res?.data || res;

      if (data?.success) {
        if (data.zapierSent) {
          const countLabel = data.resubmitCount ? ` (resubmit #${data.resubmitCount})` : "";
          toast.success(`Payload sent to Zapier${countLabel}!`);
        } else if (data.zapierError) {
          toast.error(`Zapier delivery failed: ${data.zapierError}`);
        } else {
          toast.success("Retry submission succeeded!");
        }
      } else {
        toast.error(data?.error?.message || "Retry failed — check intake recovery for details.");
      }
      onRefresh?.();
    } catch (err) {
      toast.error(getBackendErrorMessage(err, "Save + Retry failed."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading = isSaving || isSubmitting;

  return (
    <div className="border border-amber-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-amber-50 hover:bg-amber-100 transition-colors text-xs font-semibold text-amber-800"
      >
        <span className="flex items-center gap-2">
          <Send className="w-3.5 h-3.5" />
          Manual Payload Editor
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="p-4 bg-white border-t border-amber-100 space-y-4">
          {/* Business Name + Domain */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Business Name</label>
              <Input
                value={businessName}
                onChange={e => handleBusinessNameChange(e.target.value)}
                placeholder="e.g. Acme IT Solutions"
                className="h-8 text-sm"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Business Domain</label>
              <Input
                value={businessDomain}
                onChange={e => handleBusinessDomainChange(e.target.value)}
                placeholder="e.g. acmeit.com"
                className="h-8 text-sm"
                disabled={isLoading}
              />
            </div>
          </div>

          {/* JSON editor */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              Submission Payload JSON
              <span className="ml-1 text-slate-400 normal-case font-normal">(metadata + userdata)</span>
            </label>
            <textarea
              value={jsonText}
              onChange={e => handleJsonChange(e.target.value)}
              disabled={isLoading}
              spellCheck={false}
              className="w-full h-72 font-mono text-xs bg-slate-50 border border-slate-200 rounded-md p-3 text-slate-700 resize-y focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
            />
            {jsonError && (
              <p className="text-xs text-red-600 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {jsonError}
              </p>
            )}
            {!jsonError && jsonText && (
              <p className="text-xs text-green-600 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Valid JSON
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5 border-slate-300"
              onClick={handleSavePayload}
              disabled={isLoading || !!jsonError}
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Save Changes
            </Button>
            <Button
              size="sm"
              className="text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleSaveAndRetry}
              disabled={isLoading || !!jsonError}
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Save &amp; Retry Submission
            </Button>
          </div>

          <p className="text-[10px] text-slate-400">
            "Save Changes" updates the draft record only. "Save &amp; Retry Submission" saves then immediately attempts resubmission via the intake retry function.
          </p>
        </div>
      )}
    </div>
  );
}
