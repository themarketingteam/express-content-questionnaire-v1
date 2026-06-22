import React, { useState } from "react";
import { AlertCircle } from "lucide-react";

export default function OtherField({ value, onChange, onFocus, disabled = false, message = null, helperText = null }) {
  const [showLimitMessage, setShowLimitMessage] = useState(false);

  const handleFocus = () => {
    if (disabled) {
      setShowLimitMessage(true);
      return;
    }
    if (onFocus) onFocus();
  };

  const handleChange = (e) => {
    if (disabled) return;
    const cleaned = e.target.value.replace(/[,;|]/g, "");
    onChange(cleaned);
  };

  return (
    <div className={`bg-slate-50 border border-slate-200 rounded-xl p-4 transition-all ${
      disabled ? "opacity-60" : ""
    }`}>
      <label className="block">
        <span className="font-semibold text-slate-900 text-sm">Other (please specify):</span>
        {helperText && (
          <span className="text-xs text-slate-500 block mt-1">{helperText}</span>
        )}
        {message && (
          <div className="flex items-center gap-2 mt-2 text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded-lg p-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{message}</span>
          </div>
        )}
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={() => setShowLimitMessage(false)}
          disabled={disabled}
          placeholder={disabled ? "Limit reached — uncheck an option to use Other" : "Enter one option only..."}
          className={`w-full mt-3 p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
            disabled ? "bg-slate-100 cursor-not-allowed" : ""
          }`}
        />
      </label>
    </div>
  );
}