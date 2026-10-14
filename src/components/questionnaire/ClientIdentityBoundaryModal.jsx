import React, { useEffect, useState } from "react";
import { AlertTriangle, Building2, Loader2, X } from "lucide-react";

function ModalShell({ children, onClose = null, closeDisabled = false }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !closeDisabled) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "unset";
    };
  }, [closeDisabled, onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            className="absolute right-6 top-6 rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

export function ClientIdentityConflictModal({ conflict, onStartNew, onContinueExisting, onCancel }) {
  const existingName = conflict?.businessName?.existing || conflict?.domain?.existing || "the saved client";
  const incomingName = conflict?.businessName?.incoming || conflict?.domain?.incoming || "the client in this link";
  return (
    <ModalShell onClose={onCancel}>
      <div className="border-b border-slate-200 p-6">
        <div className="flex items-start gap-3 pr-10">
          <div className="rounded-xl bg-amber-100 p-2 text-amber-700"><AlertTriangle className="h-6 w-6" /></div>
          <div>
            <h2 className="text-xl font-bold text-slate-950">Choose which client to open</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This browser is currently connected to <strong>{existingName}</strong>, but this link is for <strong>{incomingName}</strong>. We stopped before changing either client.
            </p>
          </div>
        </div>
      </div>
      <div className="p-6 text-sm text-slate-600">
        Start a new client to create a separate blank draft, or continue the existing saved draft without applying this link’s business details.
      </div>
      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 p-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-3 font-semibold text-slate-700">Cancel</button>
        <button type="button" onClick={onContinueExisting} className="rounded-lg border border-blue-500 px-4 py-3 font-semibold text-blue-700">Continue Existing Draft</button>
        <button type="button" onClick={onStartNew} className="rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800">Start New Client</button>
      </div>
    </ModalShell>
  );
}

export function NewClientIdentityModal({ initialBusinessName = "", initialDomain = "", onSave, onSkip }) {
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [domain, setDomain] = useState(initialDomain);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await onSave(businessName.trim(), domain.trim()); }
    finally { setSaving(false); }
  };
  return (
    <ModalShell closeDisabled={saving}>
      <div className="border-b border-slate-200 p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-blue-100 p-2 text-blue-700"><Building2 className="h-6 w-6" /></div>
          <div>
            <h2 className="text-xl font-bold text-slate-950">New client draft created</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Add the client identity now, or skip and complete it later when you submit.</p>
          </div>
        </div>
      </div>
      <div className="space-y-4 p-6">
        <label className="block text-sm font-semibold text-slate-800">Business Name
          <input value={businessName} onChange={(event) => setBusinessName(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 font-normal" autoFocus />
        </label>
        <label className="block text-sm font-semibold text-slate-800">Website Domain <span className="font-normal text-slate-500">(optional)</span>
          <input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 font-normal" />
        </label>
      </div>
      <div className="flex gap-3 border-t border-slate-200 p-4">
        <button type="button" onClick={onSkip} disabled={saving} className="flex-1 rounded-lg border border-slate-300 px-4 py-3 font-semibold text-slate-700">Skip for Now</button>
        <button type="button" onClick={save} disabled={saving || (!businessName.trim() && !domain.trim())} className="flex-1 rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white disabled:bg-slate-300">
          {saving ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Saving…</span> : "Save & Continue"}
        </button>
      </div>
    </ModalShell>
  );
}
