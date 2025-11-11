import React from "react";
import { Info } from "lucide-react";
import OtherField from "./OtherField";

export default function CheckboxQuestion({
  questionNumber,
  title,
  hint,
  options,
  selected = [],
  onToggle,
  otherValue = "",
  onOtherChange,
  limit = 3,
  onInfoClick
}) {
  // Count "Other" as a selection if it has content
  const hasOtherValue = (otherValue || "").trim().length > 0;
  const totalSelections = selected.length + (hasOtherValue ? 1 : 0);
  const isAtLimit = totalSelections >= limit;

  const isCheckboxDisabled = (value) => {
    // Disable if at limit and this checkbox is not already selected
    return isAtLimit && !selected.includes(value);
  };

  const isOtherDisabled = () => {
    // Disable "Other" field if we're at limit and it doesn't already have content
    return isAtLimit && !hasOtherValue;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <label className="block flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-slate-900">
              {questionNumber}. {title}
            </span>
            {onInfoClick && (
              <button
                type="button"
                onClick={onInfoClick}
                className="w-6 h-6 rounded-full border border-slate-300 hover:border-slate-400 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all"
                aria-label="More information"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {hint && <span className="text-sm text-slate-500 italic mt-1 block">{hint}</span>}
        </label>
      </div>

      {/* Selection counter */}
      <div className="text-sm text-slate-600">
        <span className={totalSelections >= limit ? "text-amber-600 font-medium" : ""}>
          {totalSelections} of {limit} selected
        </span>
        {totalSelections >= limit && (
          <span className="ml-2 text-amber-600">• Maximum reached</span>
        )}
      </div>

      <div className="space-y-2.5">
        {options.map((option) => {
          const isChecked = selected.includes(option);
          const disabled = isCheckboxDisabled(option);

          return (
            <label
              key={option}
              className={`flex items-center gap-3 p-4 border rounded-xl transition-all ${
                isChecked
                  ? "border-blue-500 bg-blue-50"
                  : disabled
                  ? "border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggle(option)}
                disabled={disabled}
                className="w-5 h-5 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
              />
              <span className="text-slate-700 select-none">{option}</span>
            </label>
          );
        })}
      </div>

      <OtherField
        value={otherValue}
        onChange={onOtherChange}
        disabled={isOtherDisabled()}
        countsAsSelection={true}
      />
    </div>
  );
}