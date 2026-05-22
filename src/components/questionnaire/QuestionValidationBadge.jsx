import React from "react";
import { 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  Circle, 
  Clock, 
  AlertCircle 
} from "lucide-react";
import { 
  getQuestionStatusLabel, 
  getQuestionStatusTone, 
  normalizeQuestionStatus,
  QUESTION_STATUS 
} from "@/lib/questionValidationStatus";

const statusIcons = {
  [QUESTION_STATUS.not_started]: Circle,
  [QUESTION_STATUS.in_progress]: Clock,
  [QUESTION_STATUS.complete]: CheckCircle2,
  [QUESTION_STATUS.needs_attention]: AlertTriangle,
  [QUESTION_STATUS.needs_validation]: AlertTriangle,
  [QUESTION_STATUS.validating]: Loader2,
  [QUESTION_STATUS.dirty]: Clock,
  [QUESTION_STATUS.error]: AlertCircle,
};

const statusColorClasses = {
  slate: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-200",
    icon: "text-slate-500",
  },
  blue: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    icon: "text-blue-600",
  },
  green: {
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
    icon: "text-green-600",
  },
  amber: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    icon: "text-amber-600",
  },
  red: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    icon: "text-red-600",
  },
};

/**
 * Compact validation status badge for question headers
 * 
 * @param {string} status - Status from QUESTION_STATUS
 * @param {string} label - Optional custom label (uses default if omitted)
 * @param {string} message - Optional message for title attribute or display
 * @param {boolean} compact - If true, shows icon only with tooltip
 */
export default function QuestionValidationBadge({ 
  status = QUESTION_STATUS.not_started, 
  label, 
  message,
  compact = false 
}) {
  const normalizedStatus = normalizeQuestionStatus(status);
  const tone = getQuestionStatusTone(normalizedStatus);
  const displayLabel = label || getQuestionStatusLabel(normalizedStatus);
  const IconComponent = statusIcons[normalizedStatus] || Circle;
  const colors = statusColorClasses[tone] || statusColorClasses.slate;
  
  const isSpinning = normalizedStatus === QUESTION_STATUS.validating;
  
  if (compact) {
    return (
      <div 
        className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${colors.bg} ${colors.border} border`}
        title={message || displayLabel}
      >
        <IconComponent className={`w-3.5 h-3.5 ${colors.icon} ${isSpinning ? "animate-spin" : ""}`} />
      </div>
    );
  }
  
  return (
    <div 
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.border} border`}
      title={message}
    >
      <IconComponent className={`w-3.5 h-3.5 ${colors.icon} ${isSpinning ? "animate-spin" : ""}`} />
      <span className={colors.text}>{displayLabel}</span>
    </div>
  );
}