import React from "react";
import { Info, ChevronDown } from "lucide-react";
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
  onInfoClick,
  isOpen = true,
  onClick
}) {
  const hasOtherText = (otherValue || "").trim().length > 0;
  const totalSelections = selected.length + (hasOtherText ? 1 : 0);
  const isAtLimit = totalSelections >= limit;

  const isCheckboxDisabled = (value) => {
    return isAtLimit && !selected.includes(value);
  };

  const isOtherDisabled = isAtLimit && !hasOtherText;

  return (
    <div className="space-y-4">
      <div 
        className={`flex items-start gap-3 ${!isOpen ? 'cursor-pointer' : ''}`}
        onClick={!isOpen ? onClick : undefined}
      >
        <label className="block flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-slate-900">
              {questionNumber}. {title}
            </span>
            {onInfoClick && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onInfoClick();
                }}
                className="w-6 h-6 rounded-full border border-slate-300 hover:border-slate-400 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all"
                aria-label="More information"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            )}
            {!isOpen && (
              <ChevronDown className="w-5 h-5 text-slate-400 ml-auto" />
            )}
          </div>
          {isOpen && hint && <span className="text-sm text-slate-500 italic mt-1 block">{hint}</span>}
          {isOpen && limit > 0 && limit < 999 && (
            <span className={`text-sm font-medium mt-1 block ${
              isAtLimit ? "text-amber-600" : "text-slate-600"
            }`}>
              {totalSelections} / {limit} selections {isAtLimit && "(limit reached)"}
            </span>
          )}
        </label>
      </div>

      {isOpen && (
        <>
          <div className="space-y-2.5">
            {options.map((option) => {
              const isChecked = selected.includes(option);
              const disabled = isCheckboxDisabled(option);

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
            disabled={isOtherDisabled}
            message={isOtherDisabled ? `You've reached the limit of ${limit} selections. Uncheck an option to use "Other".` : null}
          />
        </>
      )}
    </div>
  );
}