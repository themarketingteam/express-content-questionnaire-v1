import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCcw, X } from "lucide-react";

/**
 * Non-intrusive inline notice shown when a field was cleared but a previous answer exists.
 * Does NOT auto-restore. User must click Restore.
 */
export default function RecoverLastAnswerNotice({ field, entry, onRestore, onDismiss }) {
  if (!entry) return null;

  const isArray = Array.isArray(entry.value);
  const preview = isArray
    ? entry.value.slice(0, 2).join(", ") + (entry.value.length > 2 ? "…" : "")
    : typeof entry.value === "string"
    ? entry.value.slice(0, 80) + (entry.value.length > 80 ? "…" : "")
    : null;

  if (!preview) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={`recover-notice-${field}`}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18 }}
        className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800"
        role="alert"
      >
        <RotateCcw className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-600" />
        <div className="flex-1 min-w-0">
          <span className="font-medium">You cleared this answer. </span>
          <span className="text-amber-700">Previous: </span>
          <span className="italic text-amber-800 truncate">{preview}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => onRestore(field, entry.value)}
            className="font-semibold text-amber-800 hover:text-amber-900 underline underline-offset-1 transition-colors"
          >
            Restore
          </button>
          <button
            type="button"
            onClick={() => onDismiss(field)}
            className="text-amber-500 hover:text-amber-700 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}