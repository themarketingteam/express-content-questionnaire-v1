import React from "react";
import { Info, RotateCcw, ChevronDown } from "lucide-react";
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
  onInfoClick,
  isOpen = true,
  onClick
}) {
  const hasOtherValue = (otherValue || "").trim().length > 0;
  const hasRadioSelection = selected && selected.trim().length > 0;

  const isRadioDisabled = (option) => {
    return hasOtherValue;
  };

  const isOtherDisabled = () => {
    return hasRadioSelection;
  };

  const handleRadioSelect = (option) => {
    onSelect(option);
    if (onOtherChange && hasOtherValue) {
      onOtherChange("");
    }
  };

  const handleOtherChange = (value) => {
    onOtherChange(value);
    if (value.trim().length > 0 && hasRadioSelection) {
      onSelect("");
    }
  };

  const handleClearSelection = (e) => {
    e.stopPropagation();
    onSelect("");
    if (onOtherChange) {
      onOtherChange("");
    }
  };

  const hasAnySelection = hasRadioSelection || hasOtherValue;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div 
          className={`flex-1 ${!isOpen ? 'cursor-pointer' : ''}`}
          onClick={() => {
            if (!isOpen && onClick) {
              onClick();
            }
          }}
        >
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
              <ChevronDown className="w-5 h-5 text-slate-400" />
            )}
          </div>
          {isOpen && hint && <span className="text-sm text-slate-500 italic mt-1 block">{hint}</span>}
        </div>
        {isOpen && hasAnySelection && (
          <button
            type="button"
            onClick={handleClearSelection}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-all"
            title="Clear selection"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        )}
      </div>

      {isOpen && (
        <>
          {hasOtherValue && (
            <div className="text-sm text-amber-600 font-medium bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
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
              message={isOtherDisabled() ? "A radio option is selected. Click 'Reset' above to use 'Other'." : null}
            />
          )}
        </>
      )}
    </div>
  );
}