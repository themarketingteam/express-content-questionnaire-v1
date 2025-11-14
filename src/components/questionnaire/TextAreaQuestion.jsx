import React from "react";
import { Info, ChevronDown } from "lucide-react";

export default function TextAreaQuestion({
  questionNumber,
  title,
  hint,
  value,
  onChange,
  minLength = 0,
  onInfoClick,
  isOpen = true,
  onClick
}) {
  const charCount = (value || "").length;
  const isValid = charCount >= minLength;

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
        </label>
      </div>

      {isOpen && (
        <div className="relative">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            placeholder="Share your thoughts..."
            className="w-full p-4 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
          />
          {minLength > 0 && (
            <div className={`text-sm mt-2 ${isValid ? "text-green-600" : "text-slate-500"}`}>
              {charCount} / {minLength} characters {isValid && "✓"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}