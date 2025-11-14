import React, { useEffect } from "react";
import { X } from "lucide-react";
import { motion } from "framer-motion";

export default function InfoModal({ data, onClose }) {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-slate-900">{data.title}</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          <div>
            <h4 className="font-semibold text-slate-900 mb-2">Why we ask</h4>
            <p className="text-slate-700">{data.why}</p>
          </div>

          <div>
            <h4 className="font-semibold text-slate-900 mb-2">How to answer</h4>
            <p className="text-slate-700">{data.guidance}</p>
          </div>

          {data.examples && (
            <div className="space-y-3">
              {/* Checkbox/Multiple choice examples */}
              {data.examples.selections && data.examples.selections.length > 0 && (
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="font-medium text-slate-900 mb-2">Example selections:</div>
                  <ul className="list-disc list-inside space-y-1">
                    {data.examples.selections.map((item, idx) => (
                      <li key={idx} className="text-slate-700">{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {data.examples.mixed && data.examples.mixed.length > 0 && (
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="font-medium text-slate-900 mb-2">Alternative mix:</div>
                  <ul className="list-disc list-inside space-y-1">
                    {data.examples.mixed.map((item, idx) => (
                      <li key={idx} className="text-slate-700">{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {data.examples.other && (
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="font-medium text-slate-900 mb-2">"Other" example:</div>
                  <div className="text-slate-700 italic">{data.examples.other}</div>
                </div>
              )}

              {/* Short answer examples */}
              {data.examples.shortAnswer && (
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="font-medium text-slate-900 mb-2">Example answer:</div>
                  <div className="text-slate-700 italic">{data.examples.shortAnswer}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}