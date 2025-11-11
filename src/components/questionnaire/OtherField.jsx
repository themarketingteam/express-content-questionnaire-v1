import React from "react";

export default function OtherField({ value, onChange, disabled = false, countsAsSelection = false }) {
  return (
    <div className={`bg-slate-50 border border-slate-200 rounded-xl p-4 transition-all ${
      disabled ? "opacity-50" : ""
    }`}>
      <label className="block">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-900 text-sm">
            Other (please specify):
            {countsAsSelection && value && (
              <span className="ml-2 text-xs text-blue-600 font-normal">• Counts as 1 selection</span>
            )}
          </span>
          {disabled && (
            <span className="text-xs text-amber-600 font-medium">Maximum selections reached</span>
          )}
        </div>
        <span className="text-xs text-slate-500 block mt-1">
          Enter a single option only (no commas or multiple items)
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const cleaned = e.target.value.replace(/[,;|]/g, "");
            onChange(cleaned);
          }}
          disabled={disabled}
          placeholder={disabled ? "Maximum selections reached" : "Enter one option only..."}
          className="w-full mt-3 p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-500"
        />
      </label>
    </div>
  );
}