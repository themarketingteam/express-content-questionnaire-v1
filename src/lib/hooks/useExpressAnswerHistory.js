import { useState, useCallback } from "react";
import {
  isMeaningfulAnswer,
  updateLastNonEmptyAnswers,
  getRecoverableAnswer,
} from "@/lib/expressAnswerHistory";

/**
 * Hook that manages last-non-empty answer history for Express questionnaire fields.
 * This is a RECOVERY layer only — does not affect submission.
 */
export function useExpressAnswerHistory() {
  const [lastNonEmptyAnswers, setLastNonEmptyAnswers] = useState({});
  const [fieldHistory, setFieldHistory] = useState({});
  const [dismissedFields, setDismissedFields] = useState({});

  /**
   * Record a field change. Returns the updated history object synchronously
   * so callers can pass it immediately to draft save.
   */
  const recordFieldChange = useCallback((field, previousValue, nextValue, options = {}) => {
    let nextHistory;
    setLastNonEmptyAnswers(prev => {
      nextHistory = updateLastNonEmptyAnswers(prev, field, previousValue, nextValue, options);
      return nextHistory;
    });
    // Clear dismissed notice when a new meaningful value is provided
    if (isMeaningfulAnswer(nextValue)) {
      setDismissedFields(prev => {
        if (!prev[field]) return prev;
        const updated = { ...prev };
        delete updated[field];
        return updated;
      });
    }
    return nextHistory;
  }, []);

  /**
   * Returns the recoverable entry for a field when currentValue is empty and history exists.
   * Returns null when not applicable.
   */
  const getRecoverable = useCallback((field, currentValue) => {
    if (dismissedFields[field]) return null;
    return getRecoverableAnswer(field, currentValue, lastNonEmptyAnswers);
  }, [lastNonEmptyAnswers, dismissedFields]);

  const dismissField = useCallback((field) => {
    setDismissedFields(prev => ({ ...prev, [field]: true }));
  }, []);

  const restoreField = useCallback((field, value) => {
    // Caller is responsible for calling updateField(field, value).
    // Mark as not dismissed since a restore is an explicit user action.
    setDismissedFields(prev => {
      const updated = { ...prev };
      delete updated[field];
      return updated;
    });
    // Update history entry source to "restore"
    setLastNonEmptyAnswers(prev => {
      if (!prev[field]) return prev;
      return {
        ...prev,
        [field]: { ...prev[field], source: "restore", savedAt: new Date().toISOString() }
      };
    });
  }, []);

  const hydrateFromStored = useCallback((storedHistory) => {
    if (storedHistory && typeof storedHistory === "object") {
      setLastNonEmptyAnswers(storedHistory);
    }
  }, []);

  const resetHistory = useCallback(() => {
    setLastNonEmptyAnswers({});
    setFieldHistory({});
    setDismissedFields({});
  }, []);

  return {
    lastNonEmptyAnswers,
    fieldHistory,
    dismissedFields,
    recordFieldChange,
    getRecoverable,
    dismissField,
    restoreField,
    hydrateFromStored,
    resetHistory,
  };
}