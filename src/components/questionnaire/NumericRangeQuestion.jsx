import React, { useState, useEffect } from "react";
import { Info, ChevronDown } from "lucide-react";

export default function NumericRangeQuestion({
  questionNumber,
  title,
  hint,
  minValue = 1,
  maxValue = 50,
  onChange,
  onInfoClick,
  isOpen = true,
  onClick
}) {
  const [smallest, setSmallest] = useState(minValue);
  const [largest, setLargest] = useState(maxValue);
  const [largestInput, setLargestInput] = useState(maxValue.toString());
  const emptyTimerRef = React.useRef(null);

  useEffect(() => {
    const largestDisplay = largest > 1000 ? "1000+" : largest;
    const value = `${smallest}-${largestDisplay} employees`;
    onChange(value);
  }, [smallest, largest, onChange]);

  const handleSmallestChange = (e) => {
    const value = parseInt(e.target.value) || 1;
    setSmallest(Math.max(1, value));
  };

  const handleLargestChange = (e) => {
    const inputValue = e.target.value;
    setLargestInput(inputValue);

    // Clear any existing timer
    if (emptyTimerRef.current) {
      clearTimeout(emptyTimerRef.current);
      emptyTimerRef.current = null;
    }

    if (inputValue === "" || inputValue === null) {
      // Start 5-second timer to restore default
      emptyTimerRef.current = setTimeout(() => {
        setLargestInput(maxValue.toString());
        setLargest(maxValue);
      }, 5000);
    } else {
      const parsedValue = parseInt(inputValue);
      if (!isNaN(parsedValue)) {
        const clampedValue = Math.max(1, parsedValue);
        setLargest(clampedValue > 1000 ? 1001 : clampedValue);
      }
    }
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (emptyTimerRef.current) {
        clearTimeout(emptyTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div 
          className="block flex-1 cursor-pointer"
          onClick={() => {
            if (onClick) {
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
              <ChevronDown className="w-5 h-5 text-slate-400 ml-auto" />
            )}
          </div>
          {isOpen && hint && <span className="text-sm text-slate-500 italic mt-1 block">{hint}</span>}
        </div>
      </div>

      {isOpen && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Smallest company size
              </label>
              <input
                type="number"
                min="1"
                value={smallest}
                onChange={handleSmallestChange}
                className="w-full p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="text-2xl text-slate-400 font-bold pt-6">—</div>

            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Largest company size
              </label>
              <input
                type="number"
                min="1"
                value={largest > 1000 ? "" : largestInput}
                onChange={handleLargestChange}
                placeholder={largest > 1000 ? "1000+" : ""}
                className="w-full p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="pt-6">
              <span className="text-slate-600 font-medium">employees</span>
            </div>
          </div>

          <div className="mt-4 text-sm text-slate-600">
            <span className="font-medium">Result: </span>
            <span className="text-slate-900">
              {smallest}-{largest > 1000 ? "1000+" : largest} employees
            </span>
          </div>
        </div>
      )}
    </div>
  );
}