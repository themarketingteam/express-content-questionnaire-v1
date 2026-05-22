import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Info, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EXPRESS_VALIDATION_GUIDE_TITLE,
  EXPRESS_VALIDATION_GUIDE_SUMMARY,
  getExpressValidationGuideSections,
} from "@/lib/expressValidationGuideContent";

const sectionIcons = {
  what_validation_checks: Info,
  which_answers: CheckCircle2,
  status_meanings: AlertTriangle,
  how_to_fix: Info,
  submit_time_check: CheckCircle2,
};

export default function ValidationGuideModal({ isOpen, onClose }) {
  // Handle Escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  const sections = getExpressValidationGuideSections();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-50"
            aria-hidden="true"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="validation-guide-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          >
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <Info className="w-5 h-5 text-blue-600" />
                  </div>
                  <h2
                    id="validation-guide-title"
                    className="text-xl font-bold text-slate-900"
                  >
                    {EXPRESS_VALIDATION_GUIDE_TITLE}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                  aria-label="Close validation guide"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* Summary */}
                <p className="text-slate-600 mb-6 leading-relaxed">
                  {EXPRESS_VALIDATION_GUIDE_SUMMARY}
                </p>

                {/* Sections */}
                <div className="space-y-6">
                  {sections.map((section) => {
                    const IconComponent = sectionIcons[section.id] || Info;

                    return (
                      <div
                        key={section.id}
                        className="border border-slate-200 rounded-lg p-4"
                      >
                        <div className="flex items-start gap-3 mb-3">
                          <div className="p-1.5 bg-slate-50 rounded-md mt-0.5">
                            <IconComponent className="w-4 h-4 text-slate-600" />
                          </div>
                          <h3 className="font-semibold text-slate-900">
                            {section.title}
                          </h3>
                        </div>

                        <p className="text-slate-600 mb-3 leading-relaxed">
                          {section.body}
                        </p>

                        {section.bullets && section.bullets.length > 0 && (
                          <ul className="space-y-2">
                            {section.bullets.map((bullet, index) => (
                              <li
                                key={index}
                                className="flex items-start gap-2 text-sm text-slate-600"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-slate-200 bg-slate-50">
                <Button
                  type="button"
                  onClick={onClose}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
                >
                  Got it
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}