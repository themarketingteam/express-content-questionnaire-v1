import React, { useState, useEffect, useRef } from "react";
import { Info, ChevronDown } from "lucide-react";
import { parseClientSizeValue } from "@/lib/clientSizeParser";

export default function NumericRangeQuestion({
  questionNumber,
  title,
  hint,
  value = "",
  minValue = 1,
  maxValue = 50,
  onChange,
  onInfoClick,
  isOpen = true,
  onClick
}) {
  const initial = parseClientSizeValue(value, { minValue, maxValue });
  const [smallest, setSmallest] = useState(initial.smallest);
  const [largest, setLargest] = useState(initial.largest);
  const [largestInput, setLargestInput] = useState(
    initial.largest > 1000 ? "" : String(initial.largest)
  );
  const emptyTimerRef = useRef(null);
  const hasMountedRef = useRef(false);

  const buildValueString = (small, large) => {
    const largestDisplay = large > 1000 ? "1000+" : large;
    return `${small}-${largestDisplay} employees`;
  };

  // On first mount: only emit a default if the parent value is genuinely empty.
  // If a saved value exists (even unparseable), do NOT overwrite it.
  useEffect(() => {
    hasMountedRef.current = true;
    if (!value || !value.trim()) {
      onChange(buildValueString(smallest, largest));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync internal state when the parent value changes externally
  // (e.g., restored from draft, or cleared). Only runs after initial mount.
  useEffect(() => {
    if (!hasMountedRef.current) return;
    if (!value || !value.trim()) return;

    const currentDisplay = buildValueString(smallest, largest);
    if (value !== currentDisplay) {
      const parsed = parseClientSizeValue(value, { minValue, maxValue });
      setSmallest(parsed.smallest);
      setLargest(parsed.largest);
      setLargestInput(parsed.largest > 1000 ? "" : String(parsed.largest));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleSmallestChange = (e) => {
    const val = parseInt(e.target.value) || 1;
    const newSmallest = Math.max(1, val);
    setSmallest(newSmallest);
    onChange(buildValueString(newSmallest, largest));
  };

  const handleLargestChange = (e) => {
    const inputValue = e.target.value;
    setLargestInput(inputValue);

    if (emptyTimerRef.current) {
      clearTimeout(emptyTimerRef.current);
      emptyTimerRef.current = null;
    }

    if (inputValue === "" || inputValue === null) {
      emptyTimerRef.current = setTimeout(() => {
        setLargestInput(maxValue.toString());
        setLargest(maxValue);
        onChange(buildValueString(smallest, maxValue));
      }, 5000);
    } else {
      const parsedValue = parseInt(inputValue);
      if (!isNaN(parsedValue)) {
        const clampedValue = Math.max(1, parsedValue);
        const newLargest = clampedValue > 1000 ? 1001 : clampedValue;
        setLargest(newLargest);
        onChange(buildValueString(smallest, newLargest));
      }
    }
  };

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