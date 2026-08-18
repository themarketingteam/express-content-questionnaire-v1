import React, { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getBackendErrorMessage } from "@/lib/draftRecoveryAccess";

const REASONS = [
  ["client_request", "Client request"],
  ["privacy_request", "Privacy request"],
  ["duplicate_or_test", "Duplicate or test data"],
  ["contract_request", "Contract request"],
  ["other_authorized", "Other authorized reason"],
];

function responseData(response) {
  return response?.data || response || {};
}

export default function ClientDataDeletionDialog({ recordType, record, recoveryGrant, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [prepared, setPrepared] = useState(null);
  const [loading, setLoading] = useState(false);
  const expected = useMemo(
    () => record?.business_name || record?.session_id || record?.questionnaire_session_id || "",
    [record],
  );

  const reset = () => {
    setReasonCode("");
    setConfirmation("");
    setPrepared(null);
    setLoading(false);
  };

  const prepare = async () => {
    setLoading(true);
    try {
      const result = responseData(await base44.functions.invoke("manageExpressRecoveryData", {
        action: "prepareDeletion",
        recordType,
        recordId: record.id,
        reasonCode,
        confirmation,
        recoveryGrant,
      }));
      if (!result.ok) throw new Error(result.error || "Deletion preparation failed.");
      setPrepared(result);
    } catch (error) {
      toast.error(getBackendErrorMessage(error, "Deletion preparation failed."));
    } finally {
      setLoading(false);
    }
  };

  const execute = async () => {
    setLoading(true);
    try {
      const result = responseData(await base44.functions.invoke("manageExpressRecoveryData", {
        action: "executeDeletion",
        token: prepared.token,
        confirmation,
        recoveryGrant,
      }));
      if (!result.ok) throw new Error(result.error || "Client data deletion failed.");
      toast.success("Client data and all private backup versions were deleted.");
      setOpen(false);
      reset();
      await onDeleted?.();
    } catch (error) {
      toast.error(getBackendErrorMessage(error, "Client data deletion failed."));
    } finally {
      setLoading(false);
    }
  };

  const total = prepared
    ? Object.values(prepared.counts || {}).reduce((sum, count) => sum + Number(count || 0), 0)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="brand-button-danger">
          <Trash2 className="w-3.5 h-3.5" /> Delete Client Data
        </Button>
      </DialogTrigger>
      <DialogContent className="brand-lifecycle-dialog">
        <DialogHeader>
          <DialogTitle>Delete Client Data</DialogTitle>
          <DialogDescription>
            This permanently purges every private S3 object version first, then deletes the connected Base44 records. Base44 may retain deleted entity records in its platform-level recently-deleted area for 30 days.
          </DialogDescription>
        </DialogHeader>

        {!prepared ? (
          <div className="space-y-4">
            <div className="brand-lifecycle-warning"><AlertTriangle className="w-4 h-4" /> This action cannot be undone from the independent backup.</div>
            <div>
              <label className="brand-lifecycle-label" htmlFor={`delete-reason-${record.id}`}>Required reason</label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger id={`delete-reason-${record.id}`}><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>{REASONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="brand-lifecycle-label" htmlFor={`delete-confirm-${record.id}`}>Type exactly: <strong>{expected}</strong></label>
              <Input id={`delete-confirm-${record.id}`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="brand-lifecycle-warning"><AlertTriangle className="w-4 h-4" /> Final confirmation: {total} connected records or backup-index entries will be processed.</div>
            <div className="brand-lifecycle-counts">
              {Object.entries(prepared.counts || {}).map(([name, count]) => <span key={name}><strong>{name}</strong> {count}</span>)}
            </div>
            <p className="text-sm">The authorization expires in 10 minutes. The typed confirmation and record graph must remain unchanged.</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
          {!prepared ? (
            <Button className="brand-button-danger-solid" onClick={prepare} disabled={loading || !reasonCode || confirmation !== expected}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Review Deletion Scope
            </Button>
          ) : (
            <Button className="brand-button-danger-solid" onClick={execute} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Permanently Delete Client Data
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
