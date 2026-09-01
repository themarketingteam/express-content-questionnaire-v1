import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Save, Cloud, CloudOff, AlertCircle, CheckCircle2, Loader2, Clock } from "lucide-react";

const STATUS_CONFIG = {
  initializing: {
    icon: Clock,
    iconClass: "text-slate-400",
    text: "Restoring saved answers...",
    textClass: "text-slate-500",
    spin: false,
  },
  bootstrap_connecting: {
    icon: Loader2,
    iconClass: "text-blue-500",
    text: "Creating your secure recovery draft...",
    textClass: "text-blue-600",
    spin: true,
  },
  bootstrap_retrying: {
    icon: Loader2,
    iconClass: "text-amber-500",
    text: "Recovery service unavailable — reconnecting before the form opens",
    textClass: "text-amber-700",
    spin: true,
  },
  bootstrap_blocked: {
    icon: AlertCircle,
    iconClass: "text-red-500",
    text: "Recovery draft access could not be confirmed. The form is locked to protect your answers.",
    textClass: "text-red-700",
    spin: false,
  },
  ready: {
    icon: Cloud,
    iconClass: "text-blue-500",
    text: "Secure auto-save is ready",
    textClass: "text-slate-600",
    spin: false,
  },
  saved_local: {
    icon: Save,
    iconClass: "text-slate-500",
    text: "Saved locally",
    textClass: "text-slate-500",
    spin: false,
  },
  changes_pending: {
    icon: Clock,
    iconClass: "text-amber-500",
    text: "Changes waiting for server confirmation",
    textClass: "text-amber-700",
    spin: false,
  },
  saving_server: {
    icon: Loader2,
    iconClass: "text-blue-500",
    text: "Saving secure draft...",
    textClass: "text-blue-600",
    spin: true,
  },
  saved_server: {
    icon: CheckCircle2,
    iconClass: "text-green-600",
    text: "Backed up to server",
    textClass: "text-green-700",
    spin: false,
  },
  saved_server_no_local: {
    icon: CheckCircle2,
    iconClass: "text-green-600",
    text: "Backed up to server · browser storage is blocked",
    textClass: "text-green-700",
    spin: false,
  },
  retrying_server: {
    icon: Loader2,
    iconClass: "text-amber-500",
    text: "Save not confirmed — retrying",
    textClass: "text-amber-700",
    spin: true,
  },
  retry_exhausted: {
    icon: AlertCircle,
    iconClass: "text-red-500",
    text: "Save not confirmed — automatic retries will continue",
    textClass: "text-red-700",
    spin: false,
  },
  save_rejected: {
    icon: AlertCircle,
    iconClass: "text-red-500",
    text: "Server rejected this save — answers are not confirmed",
    textClass: "text-red-700",
    spin: false,
  },
  storage_blocked_pending: {
    icon: CloudOff,
    iconClass: "text-red-500",
    text: "Browser storage blocked · changes waiting for server confirmation",
    textClass: "text-red-700",
    spin: false,
  },
  offline_server_pending: {
    icon: CloudOff,
    iconClass: "text-amber-500",
    text: "Offline · changes are not yet confirmed by the server",
    textClass: "text-amber-700",
    spin: false,
  },
  server_error: {
    icon: AlertCircle,
    iconClass: "text-amber-500",
    text: "Save issue — retrying",
    textClass: "text-amber-600",
    spin: false,
  },
  offline_saved_local: {
    icon: CloudOff,
    iconClass: "text-slate-400",
    text: "Offline — saved locally",
    textClass: "text-slate-500",
    spin: false,
  },
  submit_pending: {
    icon: Loader2,
    iconClass: "text-blue-500",
    text: "Submitting...",
    textClass: "text-blue-600",
    spin: true,
  },
  submit_failed: {
    icon: AlertCircle,
    iconClass: "text-amber-500",
    text: "Submission failed — check the server backup status before leaving",
    textClass: "text-amber-600",
    spin: false,
  },
  submit_success: {
    icon: CheckCircle2,
    iconClass: "text-green-600",
    text: "Submitted",
    textClass: "text-green-700",
    spin: false,
  },
};

function formatTimeAgo(isoString) {
  if (!isoString) return null;
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    if (diff < 5000) return "just now";
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return null;
  }
}

export default function ExpressDraftSaveStatus({ saveStatus }) {
  const {
    state = "initializing",
    lastLocalSavedAt,
    lastServerSavedAt,
    lastError,
    pendingLocalChanges,
    pendingRevision,
    lastConfirmedRevision,
  } = saveStatus || {};

  const config = STATUS_CONFIG[state] || STATUS_CONFIG.initializing;
  const Icon = config.icon;

  if (!state) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={state}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="flex items-center gap-1.5"
        aria-live="polite"
        aria-atomic="true"
      >
        <Icon
          className={`w-3.5 h-3.5 shrink-0 ${config.iconClass} ${config.spin ? "animate-spin" : ""}`}
        />
        <span className={`text-xs ${config.textClass}`}>{config.text}</span>

        {(state === "saved_server" || state === "saved_server_no_local") && lastServerSavedAt && (
          <span className="text-xs text-slate-400">· {formatTimeAgo(lastServerSavedAt)}</span>
        )}

        {Number.isFinite(lastConfirmedRevision) && lastConfirmedRevision > 0 && (
          <span className="text-xs text-slate-400">· revision {lastConfirmedRevision} confirmed</span>
        )}

        {pendingLocalChanges && Number.isFinite(pendingRevision) && pendingRevision > lastConfirmedRevision && (
          <span className="text-xs text-amber-500">· revision {pendingRevision} pending</span>
        )}

        {/* Show local save time when saved_local or offline */}
        {(state === "saved_local" || state === "offline_saved_local") && lastLocalSavedAt && (
          <span className="text-xs text-slate-400">· {formatTimeAgo(lastLocalSavedAt)}</span>
        )}

        {/* Show pending indicator */}
        {pendingLocalChanges && state === "saved_server" && (
          <span className="text-xs text-slate-400">· unsaved changes</span>
        )}

        {/* Show error hint when relevant */}
        {["server_error", "retry_exhausted", "save_rejected", "bootstrap_blocked"].includes(state) && lastError && (
          <span className="text-xs text-amber-500 truncate max-w-[140px]" title={lastError}>
            · {lastError.length > 40 ? lastError.slice(0, 40) + "…" : lastError}
          </span>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
