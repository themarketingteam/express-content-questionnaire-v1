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
  const isDisabled = (value) => {
    return selected.length >= limit && !selected.includes(value);
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

      <div className="space-y-2.5">
        {options.map((option) => {
          const isChecked = selected.includes(option);
          const disabled = isDisabled(option);

          return (
            <label
              key={option}
              className={`flex items-center gap-3 p-4 border rounded-xl cursor-pointer transition-all ${
                isChecked
                  ? "border-blue-500 bg-blue-50"
                  : disabled
                  ? "border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggle(option)}
                disabled={disabled}
                className="w-5 h-5 accent-blue-600 cursor-pointer"
              />
              <span className="text-slate-700 select-none">{option}</span>
            </label>
          );
        })}
      </div>

      <OtherField
        value={otherValue}
        onChange={onOtherChange}
      />
    </div>
  );
}