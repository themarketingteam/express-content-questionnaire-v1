import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Reusable confirmation modal for destructive questionnaire actions.
 * 
 * Props:
 * - isOpen: boolean - controls modal visibility
 * - title: string - modal title (default: "Are you sure?")
 * - description: string - explanation of consequences
 * - confirmLabel: string - text for confirm button
 * - cancelLabel: string - text for cancel button (default: "Cancel")
 * - onConfirm: () => void - callback when user confirms
 * - onCancel: () => void - callback when user cancels
 * - isWorking: boolean - disables interactions while action is in progress (default: false)
 * - requireTypedConfirmation: boolean - requires user to type confirmation text (default: false)
 * - typedConfirmationText: string - text user must type to confirm (default: "")
 */
export default function DestructiveActionConfirmModal({
  isOpen,
  title = "Are you sure?",
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  isWorking = false,
  requireTypedConfirmation = false,
  typedConfirmationText = ""
}) {
  const [typedValue, setTypedValue] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setTypedValue("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === "Escape" && !isWorking) {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, isWorking, onCancel]);

  const handleBackdropClick = isWorking ? undefined : onCancel;
  const handleConfirmClick = () => {
    if (!isWorking && (!requireTypedConfirmation || typedValue === typedConfirmationText)) {
      onConfirm();
    }
  };

  const isConfirmDisabled = isWorking || (requireTypedConfirmation && typedValue !== typedConfirmationText);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby="destructive-modal-title"
        aria-describedby="destructive-modal-description"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl max-w-lg w-full"
        >
          {/* Header */}
          <div className="flex items-start justify-between p-6 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 id="destructive-modal-title" className="text-xl font-bold text-slate-900">
                  {title}
                </h3>
              </div>
            </div>
            <button
              type="button"
              onClick={isWorking ? undefined : onCancel}
              disabled={isWorking}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-4">
            <p id="destructive-modal-description" className="text-slate-700">
              {description}
            </p>

            {requireTypedConfirmation && typedConfirmationText && (
              <div className="space-y-2">
                <label htmlFor="typed-confirmation" className="block text-sm font-semibold text-slate-900">
                  Type "{typedConfirmationText}" to confirm
                </label>
                <input
                  id="typed-confirmation"
                  type="text"
                  value={typedValue}
                  onChange={(e) => setTypedValue(e.target.value)}
                  disabled={isWorking}
                  placeholder={typedConfirmationText}
                  className="w-full px-4 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:bg-slate-100 disabled:cursor-not-allowed"
                  autoComplete="off"
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 p-6 border-t border-slate-200">
            <Button
              type="button"
              onClick={onCancel}
              disabled={isWorking}
              variant="outline"
              className="flex-1"
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              onClick={handleConfirmClick}
              disabled={isConfirmDisabled}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold"
            >
              {isWorking ? "Processing..." : confirmLabel}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}