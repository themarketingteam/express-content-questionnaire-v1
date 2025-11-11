import React from "react";
import { Info } from "lucide-react";
import OtherField from "./OtherField";

export default function RadioQuestion({
  questionNumber,
  title,
  hint,
  options,
  selected,
  onSelect,
  otherValue = "",
  onOtherChange,
  onInfoClick
}) {
  // For radio buttons, if a regular option is selected, "Other" should be cleared
  // and if "Other" has content, no radio should be selected
  const hasOtherValue = (otherValue || "").trim().length > 0;
  const hasRadioSelection = selected && selected.trim().length > 0;

  const isRadioDisabled = (option) => {
    // Disable radio buttons if "Other" field has content
    return hasOtherValue;
  };

  const isOtherDisabled = () => {
    // Disable "Other" field if a radio button is selected
    return hasRadioSelection;
  };

  const handleRadioSelect = (option) => {
    onSelect(option);
    // Clear "Other" when selecting a radio button
    if (onOtherChange && hasOtherValue) {
      onOtherChange("");
    }
  };

  const handleOtherChange = (value) => {
    onOtherChange(value);
    // Clear radio selection when typing in "Other"
    if (value.trim().length > 0 && hasRadioSelection) {
      onSelect("");
    }
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

      {hasOtherValue && (
        <div className="text-sm text-amber-600 font-medium">
          Using custom "Other" option • Radio buttons disabled
        </div>
      )}

      <div className="space-y-2.5">
        {options.map((option) => {
          const isSelected = selected === option;
          const disabled = isRadioDisabled(option);

          return (
            <label
              key={option}
              className={`flex items-center gap-3 p-4 border rounded-xl transition-all ${
                isSelected
                  ? "border-blue-500 bg-blue-50"
                  : disabled
                  ? "border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer"
              }`}
            >
              <input
                type="radio"
                checked={isSelected}
                onChange={() => handleRadioSelect(option)}
                disabled={disabled}
                className="w-5 h-5 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
              />
              <span className="text-slate-700 select-none">{option}</span>
            </label>
          );
        })}
      </div>

      {onOtherChange && (
        <OtherField
          value={otherValue}
          onChange={handleOtherChange}
          disabled={isOtherDisabled()}
          countsAsSelection={false}
        />
      )}
    </div>
  );
}