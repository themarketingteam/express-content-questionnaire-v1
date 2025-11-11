import React from "react";
import { AlertCircle } from "lucide-react";

export default function OtherField({ value, onChange, disabled = false, message = null }) {
  return (
    <div className={`bg-slate-50 border border-slate-200 rounded-xl p-4 transition-all ${
      disabled ? "opacity-50" : ""
    }`}>
      <label className="block">
        <span className="font-semibold text-slate-900 text-sm">Other (please specify):</span>
        <span className="text-xs text-slate-500 block mt-1">
          Enter a single option only (no commas or multiple items)
        </span>
        {message && (
          <div className="flex items-center gap-2 mt-2 text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded-lg p-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{message}</span>
          </div>
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const cleaned = e.target.value.replace(/[,;|]/g, "");
            onChange(cleaned);
          }}
          disabled={disabled}
          placeholder={disabled ? "Limit reached - uncheck an option first" : "Enter one option only..."}
          className={`w-full mt-3 p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
            disabled ? "bg-slate-100 cursor-not-allowed" : ""
          }`}
        />
      </label>
    </div>
  );
}