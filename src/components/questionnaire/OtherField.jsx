import React from "react";

export default function OtherField({ value, onChange }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
      <label className="block">
        <span className="font-semibold text-slate-900 text-sm">Other (please specify):</span>
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
          placeholder="Enter one option only..."
          className="w-full mt-3 p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </label>
    </div>
  );
}