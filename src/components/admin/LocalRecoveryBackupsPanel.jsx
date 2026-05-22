import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  listLocalFailedSubmissionBackups,
  removeLocalFailedSubmissionBackup,
} from "@/lib/localRecoveryBackup";

function formatDate(value) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString();
  } catch {
    return "—";
  }
}

function sanitizeBackupForCopy(backup) {
  return {
    id: backup.id || "",
    session_id: backup.session_id || "",
    submit_attempt_id: backup.submit_attempt_id || "",
    business_name: backup.business_name || "",
    domain: backup.domain || "",
    stage: backup.stage || "",
    created_at: backup.created_at || "",
    error: backup.error || null,
    diagnostics: backup.diagnostics || {},
    transformed_payload: backup.transformed_payload
      ? {
          metadata: backup.transformed_payload.metadata || {},
          userdata: backup.transformed_payload.userdata || {},
        }
      : null,
  };
}

export default function LocalRecoveryBackupsPanel() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadBackups = () => {
    setLoading(true);
    try {
      const list = listLocalFailedSubmissionBackups();
      setBackups(list);
    } catch (err) {
      console.error("[local-backups] load failed:", err);
      toast.error("Failed to load local backups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const handleCopyBackup = (backup) => {
    try {
      const sanitized = sanitizeBackupForCopy(backup);
      navigator.clipboard.writeText(JSON.stringify(sanitized, null, 2));
      toast.success("Backup summary copied");
    } catch (err) {
      console.error("[local-backups] copy failed:", err);
      toast.error("Could not copy backup summary");
    }
  };

  const handleRemoveBackup = (backupId) => {
    const confirmed = window.confirm(
      "Remove this local browser backup? This cannot be undone."
    );
    if (!confirmed) return;

    try {
      const removed = removeLocalFailedSubmissionBackup(backupId);
      if (removed) {
        toast.success("Local backup removed");
        loadBackups();
      } else {
        toast.error("Failed to remove backup");
      }
    } catch (err) {
      console.error("[local-backups] remove failed:", err);
      toast.error("Failed to remove backup");
    }
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-bold text-slate-800">
          Local Browser Recovery Backups
        </CardTitle>
        <p className="text-xs text-slate-500 mt-1">
          These backups exist only in this browser. They are useful when support is working from the same browser where a failed submission occurred.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between mb-4">
          <Button
            size="sm"
            variant="outline"
            onClick={loadBackups}
            disabled={loading}
            className="text-xs gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh Local Backups
          </Button>
          <Badge variant="outline" className="text-xs">
            {backups.length} backup{backups.length !== 1 ? "s" : ""} found
          </Badge>
        </div>

        {backups.length === 0 ? (
          <p className="text-sm text-slate-500">
            No local failed-submission backups found in this browser.
          </p>
        ) : (
          <div className="space-y-2">
            {backups.map((backup) => (
              <div
                key={backup.id}
                className="border border-slate-200 rounded-lg p-3 bg-white hover:bg-slate-50 transition-colors"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs mb-3">
                  <div>
                    <p className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">Backup ID</p>
                    <p className="text-slate-700 font-mono truncate">{backup.id}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">Session ID</p>
                    <p className="text-slate-700 font-mono truncate">{backup.session_id}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">Submit Attempt ID</p>
                    <p className="text-slate-700 font-mono truncate">{backup.submit_attempt_id || "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">Business Name</p>
                    <p className="text-slate-700 truncate">{backup.business_name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">Domain</p>
                    <p className="text-slate-700 truncate">{backup.domain || "—"}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">Stage</p>
                      <p className="text-slate-700 truncate">{backup.stage || "—"}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">Created</p>
                      <p className="text-slate-700 truncate">{formatDate(backup.created_at)}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopyBackup(backup)}
                    className="text-xs gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy Backup Summary
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRemoveBackup(backup.id)}
                    className="text-xs gap-1.5 text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}