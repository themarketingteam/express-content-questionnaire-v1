import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, DatabaseBackup, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBackendErrorMessage } from "@/lib/draftRecoveryAccess";

function data(response) { return response?.data || response || {}; }

export default function RetentionRecoveryPanel({ recoveryGrant }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [preview, setPreview] = useState(null);
  const [confirmation, setConfirmation] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = data(await base44.functions.invoke("manageExpressRecoveryData", { action: "status", recoveryGrant }));
      if (!result.ok) throw new Error(result.error || "Backup status could not be loaded.");
      setStatus(result);
    } catch (error) {
      toast.error(getBackendErrorMessage(error, "Backup status could not be loaded."));
    } finally { setLoading(false); }
  }, [recoveryGrant]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const runBackup = async () => {
    setLoading(true);
    try {
      const result = data(await base44.functions.invoke("backupExpressRecoveryData", { action: "start", recoveryGrant }));
      if (!result.ok) throw new Error(result.error || (result.setupRequired ? "AWS backup setup is required." : "Backup could not start."));
      toast.success(result.complete ? "Independent backup completed." : `Backup started; ${result.processed || 0} records processed in this chunk.`);
      await loadStatus();
    } catch (error) { toast.error(getBackendErrorMessage(error, "Backup could not start.")); }
    finally { setLoading(false); }
  };

  const restorePreview = async () => {
    setLoading(true);
    try {
      const result = data(await base44.functions.invoke("manageExpressRecoveryData", { action: "restorePreview", sessionId, recoveryGrant }));
      if (!result.ok) throw new Error(result.error || "Restore preview failed.");
      setPreview(result);
      setConfirmation("");
    } catch (error) { toast.error(getBackendErrorMessage(error, "Restore preview failed.")); }
    finally { setLoading(false); }
  };

  const restoreApply = async () => {
    setLoading(true);
    try {
      const result = data(await base44.functions.invoke("manageExpressRecoveryData", { action: "restoreApply", token: preview.token, confirmation, recoveryGrant }));
      if (!result.ok) throw new Error(result.error || "Restore failed.");
      toast.success(`Restored ${result.restored} missing records; ${result.conflicts} existing records were not overwritten.`);
      setPreview(null); setSessionId(""); setConfirmation("");
    } catch (error) { toast.error(getBackendErrorMessage(error, "Restore failed.")); }
    finally { setLoading(false); }
  };

  return (
    <div className="brand-retention-panel">
      <div className="brand-retention-panel__heading">
        <div>
          <p className="brand-action-label">Independent Data Protection</p>
          <h3>Indefinite retention and private AWS backup</h3>
          <p>Records remain in Base44 until an administrator deliberately deletes a complete client graph.</p>
        </div>
        <Button size="sm" variant="outline" className="brand-button-secondary" onClick={loadStatus} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh Status
        </Button>
      </div>

      <div className={`brand-backup-health ${status?.configured && !status?.stale ? "brand-backup-health--healthy" : "brand-backup-health--warning"}`}>
        {status?.configured && !status?.stale ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
        <div>
          <strong>{status?.configured ? (status?.stale ? "Backup overdue" : "Backup protection configured") : "AWS backup setup required"}</strong>
          <span>{status?.lastSuccessAt ? `Last success ${new Date(status.lastSuccessAt).toLocaleString()}` : "No successful independent backup has been recorded."}</span>
        </div>
        <Button size="sm" className="brand-button-primary" onClick={runBackup} disabled={loading || !status?.configured}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DatabaseBackup className="w-3.5 h-3.5" />} Run Backup Now
        </Button>
      </div>

      <div className="brand-restore-panel">
        <div>
          <p className="brand-action-label">Restore Preview</p>
          <p>Checks encrypted objects, checksums, and conflicts. Existing records are never overwritten.</p>
        </div>
        <div className="brand-restore-panel__controls">
          <Input placeholder="Questionnaire session ID" value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
          <Button size="sm" variant="outline" onClick={restorePreview} disabled={loading || !sessionId || !status?.configured}>Preview Restore</Button>
        </div>
        {preview && (
          <div className="brand-restore-confirmation">
            <p><strong>{preview.missing}</strong> missing records can be restored; <strong>{preview.conflicts}</strong> conflicts will be skipped.</p>
            <label className="brand-lifecycle-label">Type exactly: <strong>{preview.confirmation}</strong></label>
            <div className="brand-restore-panel__controls">
              <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              <Button size="sm" className="brand-button-primary" onClick={restoreApply} disabled={loading || confirmation !== preview.confirmation}>Restore Missing Records</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
