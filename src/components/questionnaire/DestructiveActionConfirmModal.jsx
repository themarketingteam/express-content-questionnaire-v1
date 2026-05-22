import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DestructiveActionConfirmModal({
  isOpen,
  title = "Are you sure?",
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  isWorking = false,
  requireTypedConfirmation = false,
  typedConfirmationText = "",
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
      if (!isWorking) onCancel();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, isWorking, onCancel]);

  const handleBackdropClick = isWorking ? undefined : onCancel;
  const isConfirmDisabled = isWorking || (requireTypedConfirmation && typedValue !== typedConfirmationText);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={handleBackdropClick}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full"
          >
            {/* Header */}
            <div className="border-b border-slate-200 p-6 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-red-50 rounded-lg">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{title}</h3>
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
            {description && (
              <div className="p-6">
                <p className="text-slate-700 leading-relaxed">{description}</p>
                
                {requireTypedConfirmation && typedConfirmationText && (
                  <div className="mt-4">
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                      Type "{typedConfirmationText}" to confirm:
                    </label>
                    <input
                      type="text"
                      value={typedValue}
                      onChange={(e) => setTypedValue(e.target.value)}
                      disabled={isWorking}
                      className="w-full p-3 border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:bg-slate-100"
                      placeholder={`Type "${typedConfirmationText}"`}
                      autoComplete="off"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-slate-200 p-4 flex gap-3">
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
                onClick={onConfirm}
                disabled={isConfirmDisabled}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {isWorking ? "Processing..." : confirmLabel}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}