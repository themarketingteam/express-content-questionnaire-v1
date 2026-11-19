import React from "react";
import QuestionnaireErrorBoundary from "./QuestionnaireErrorBoundary";
import { clearExpressQuestionnaireLocalState, createLocalStateResetDiagnostic } from "@/lib/localQuestionnaireReset";
import { readQuestionnaireSessionIdForDiagnostics } from "@/lib/questionnaireDraftIdentity";

export default function QuestionnaireRouteBoundary({ children }) {
  // Diagnostics must not create identity or add a recovery hash before the form
  // distinguishes an explicitly linked questionnaire from a bare URL visit.
  const [questionnaireSessionId, setQuestionnaireSessionId] = React.useState(() => {
    try {
      return readQuestionnaireSessionIdForDiagnostics();
    } catch {
      return "unknown-session";
    }
  });

  // The child initializes its actual draft identity during render. Resolve the
  // diagnostic code afterward without changing how that child entered the app.
  React.useEffect(() => {
    try { setQuestionnaireSessionId(readQuestionnaireSessionIdForDiagnostics()); }
    catch { /* A blocked browser store cannot prevent the form from opening. */ }
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
