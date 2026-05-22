import React from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasBlockingIncompleteItems } from "@/lib/incompleteQuestionSummary";

export default function IncompleteQuestionSummary({
  summary,
  onGoToQuestion,
  onOpenValidationGuide,
  compact = false,
}) {
  if (!summary) return null;

  const {
    completeCount,
    totalCount,
    incompleteItems,
    attentionItems,
    validationItems,
    warningItems,
  } = summary;

  const hasIssues =
    incompleteItems.length > 0 ||
    attentionItems.length > 0 ||
    validationItems.length > 0 ||
    warningItems.length > 0;

  const allComplete = completeCount === totalCount && !hasIssues;

  if (allComplete && !compact) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
        <CheckCircle2 className="w-4 h-4" />
        <span>All required questions are complete.</span>
      </div>
    );
  }

  if (!hasIssues) return null;

  const hasBlocking = hasBlockingIncompleteItems(summary);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">
          Questions that need attention
        </h4>
        <span className="text-xs text-slate-600">
          {completeCount} of {totalCount} required questions complete
        </span>
      </div>

      {incompleteItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
            <AlertTriangle className="w-4 h-4" />
            <span>Required answers missing</span>
          </div>
          <div className="space-y-2">
            {incompleteItems.map((item) => (
              <div
                key={item.questionId}
                className="flex items-start justify-between gap-3 bg-red-50 border border-red-200 rounded-lg p-3"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-900">
                    Question {item.questionId}: {item.label}
                  </p>
                  <p className="text-xs text-red-700 mt-1">{item.reason}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onGoToQuestion(item.questionId)}
                  className="text-red-700 border-red-300 hover:bg-red-100 hover:border-red-400"
                >
                  Go to question
                  <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {attentionItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
            <AlertTriangle className="w-4 h-4" />
            <span>Answers to check</span>
          </div>
          <div className="space-y-2">
            {attentionItems.map((item) => (
              <div
                key={item.questionId}
                className="flex items-start justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-900">
                    Question {item.questionId}: {item.label}
                  </p>
                  <p className="text-xs text-amber-700 mt-1">{item.reason}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onGoToQuestion(item.questionId)}
                  className="text-amber-700 border-amber-300 hover:bg-amber-100 hover:border-amber-400"
                >
                  Go to question
                  <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {validationItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
              <Info className="w-4 h-4" />
              <span>Answers to check</span>
            </div>
            {typeof onOpenValidationGuide === "function" && (
              <button
                type="button"
                onClick={onOpenValidationGuide}
                className="text-xs text-blue-700 hover:text-blue-900 hover:underline font-semibold"
              >
                Open Answer Quality Guide
              </button>
            )}
          </div>
          <div className="space-y-2">
            {validationItems.map((item) => (
              <div
                key={item.questionId}
                className="flex items-start justify-between gap-3 bg-blue-50 border border-blue-200 rounded-lg p-3"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-900">
                    Question {item.questionId}: {item.label}
                  </p>
                  <p className="text-xs text-blue-700 mt-1">{item.reason}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onGoToQuestion(item.questionId)}
                  className="text-blue-700 border-blue-300 hover:bg-blue-100 hover:border-blue-400"
                >
                  Go to question
                  <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {warningItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Info className="w-4 h-4" />
              <span>Optional improvements</span>
            </div>
            {typeof onOpenValidationGuide === "function" && (
              <button
                type="button"
                onClick={onOpenValidationGuide}
                className="text-xs text-slate-700 hover:text-slate-900 hover:underline font-semibold"
              >
                Open Answer Quality Guide
              </button>
            )}
          </div>
          <div className="space-y-2">
            {warningItems.map((item) => (
              <div
                key={item.questionId}
                className="flex items-start justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    Question {item.questionId}: {item.label}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">{item.reason}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onGoToQuestion(item.questionId)}
                  className="text-slate-700 border-slate-300 hover:bg-slate-100 hover:border-slate-400"
                >
                  Go to question
                  <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}