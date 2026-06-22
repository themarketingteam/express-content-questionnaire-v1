import React, { useEffect, useRef } from "react";
import {
  validateAndRepairQuestionnaireState,
  shouldPersistRepairedState,
  getSelfHealingSummary,
} from "@/lib/expressQuestionnaireStateValidator";

/**
 * ExpressDataValidator - Self-healing validator component
 * 
 * Monitors questionnaire state and automatically repairs malformed data
 * to prevent rendering errors, autosave failures, and submission issues.
 * 
 * Props:
 * - formData, validationStatus, touchedQuestions, expandedQuestions: current state
 * - setFormData, setValidationStatus, setTouchedQuestions, setExpandedQuestions: setters
 * - onRepair: callback when repairs are applied
 * - createDraftEvent: draft event creator
 * - disabled: disable validation
 */
export default function ExpressDataValidator({
  formData,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  setFormData,
  setValidationStatus,
  setTouchedQuestions,
  setExpandedQuestions,
  onRepair,
  createDraftEvent,
  disabled = false,
}) {
  const lastRepairedSignatureRef = useRef(null);
  const isApplyingRepairRef = useRef(false);

  // Compute a stable signature from state
  const computeSignature = (fd, vs, tq, eq) => {
    try {
      return JSON.stringify({
        fd: fd || {},
        vs: vs || {},
        tq: tq || {},
        eq: eq || {},
      });
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (disabled || isApplyingRepairRef.current) {
      return;
    }

    // Validate current state
    const result = validateAndRepairQuestionnaireState({
      formData,
      validationStatus,
      touchedQuestions,
      expandedQuestions,
    });

    // Skip if no repairs needed
    if (!result.changed) {
      lastRepairedSignatureRef.current = computeSignature(
        formData,
        validationStatus,
        touchedQuestions,
        expandedQuestions
      );
      return;
    }

    // Guard: skip repairs that only differ by whitespace in string fields
    // (prevents the validator from eating spaces while the user is typing)
    const hasStructuralDifference = (() => {
      const origFd = formData || {};
      const normFd = result.formData || {};
      const allKeys = new Set([...Object.keys(origFd), ...Object.keys(normFd)]);
      for (const key of allKeys) {
        const orig = origFd[key];
        const norm = normFd[key];
        if (orig === norm) continue;
        if (typeof orig === "string" && typeof norm === "string" && orig.trim() === norm.trim()) {
          continue;
        }
        return true;
      }
      return false;
    })();

    if (!hasStructuralDifference) {
      lastRepairedSignatureRef.current = computeSignature(
        result.formData,
        result.validationStatus,
        result.touchedQuestions,
        result.expandedQuestions
      );
      return;
    }

    // Prevent infinite loops: check if we already repaired this exact state
    const newSignature = computeSignature(
      result.formData,
      result.validationStatus,
      result.touchedQuestions,
      result.expandedQuestions
    );

    if (newSignature === lastRepairedSignatureRef.current) {
      return;
    }

    // Apply repairs
    isApplyingRepairRef.current = true;

    try {
      setFormData(result.formData);
      setValidationStatus(result.validationStatus);
      setTouchedQuestions(result.touchedQuestions);
      setExpandedQuestions(result.expandedQuestions);

      // Mark as repaired
      lastRepairedSignatureRef.current = newSignature;

      // Callback
      if (onRepair) {
        onRepair(result);
      }

      // Best-effort draft event
      if (createDraftEvent) {
        try {
          createDraftEvent({
            eventType: "questionnaire_state_repaired",
            questionId: "",
            questionType: "self_healing",
            value: {
              repairs: result.repairs,
              warnings: result.warnings,
              summary: getSelfHealingSummary(result),
              timestamp: new Date().toISOString(),
            },
          });
        } catch {
          // Ignore draft event failures
        }
      }
    } finally {
      // Allow future validations after a short delay
      setTimeout(() => {
        isApplyingRepairRef.current = false;
      }, 100);
    }
  }, [
    formData,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    disabled,
    setFormData,
    setValidationStatus,
    setTouchedQuestions,
    setExpandedQuestions,
    onRepair,
    createDraftEvent,
  ]);

  // No UI rendering
  return null;
}