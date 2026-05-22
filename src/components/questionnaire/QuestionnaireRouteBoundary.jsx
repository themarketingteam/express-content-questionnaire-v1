import React, { useMemo, useCallback } from "react";
import QuestionnaireErrorBoundary from "./QuestionnaireErrorBoundary";
import { clearExpressQuestionnaireLocalState, createLocalStateResetDiagnostic } from "@/lib/localQuestionnaireReset";
import { getOrCreateQuestionnaireSessionId } from "@/lib/sessionId";

export default function QuestionnaireRouteBoundary({ children }) {
  // Get or create session id safely - this should not throw
  const questionnaireSessionId = React.useMemo(() => {
    try {
      return getOrCreateQuestionnaireSessionId();
    } catch {
      return "unknown-session";
    }
  }, []);

  // Handle reset - clear local state without touching server data
  const handleQuestionnaireBoundaryReset = React.useCallback(() => {
    try {
      const result = clearExpressQuestionnaireLocalState({
        clearSession: true,
        clearSubmitAttempt: true,
        clearFailedBackups: false,
      });
      return result;
    } catch (err) {
      console.error("[route-boundary] reset failed:", err);
      throw err;
    }
  }, []);

  // Write diagnostic before reset
  const handleQuestionnaireBoundaryBeforeReset = React.useCallback(({ error, errorInfo }) => {
    try {
      const diagnostic = createLocalStateResetDiagnostic('questionnaire_error_boundary');
      
      localStorage.setItem(
        `express_questionnaire_error_diagnostic_${questionnaireSessionId}`,
        JSON.stringify({
          ...diagnostic,
          session_id: questionnaireSessionId,
          stage: "questionnaire_error_boundary",
          error_message: error?.message || "Unknown error",
          has_error_info: !!errorInfo,
          component_stack: import.meta.env.DEV ? errorInfo?.componentStack : undefined,
          timestamp: new Date().toISOString(),
        })
      );
    } catch {
      // Ignore storage errors
    }
  }, [questionnaireSessionId]);

  return (
    <QuestionnaireErrorBoundary
      recoveryCode={questionnaireSessionId}
      onResetLocalState={handleQuestionnaireBoundaryReset}
      onBeforeReset={handleQuestionnaireBoundaryBeforeReset}
    >
      {children}
    </QuestionnaireErrorBoundary>
  );
}