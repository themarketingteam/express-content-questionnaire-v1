import { useState, useCallback, useRef } from "react";
import {
  validateExpressTextAnswer,
  runLocalExpressTextValidation,
  isExpressTextValidationField,
} from "@/lib/expressTextValidation";

// Debounce helper
function debounce(fn, delay) {
  let timeoutId = null;
  return (...args) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

/**
 * Hook for managing Express text answer validation state
 */
export function useExpressTextValidation() {
  const [validationStatus, setValidationStatus] = useState({});
  const [validatingFields, setValidatingFields] = useState({});
  
  // Track dirty fields (changed since last validation)
  const dirtyFieldsRef = useRef({});
  
  /**
   * Validate a field answer
   */
  const validateField = useCallback(async (fieldName, answer, context = {}) => {
    // Skip if not a validation field
    if (!isExpressTextValidationField(fieldName)) {
      return {
        success: true,
        status: 'complete',
        score: 100,
        message: '',
        suggestions: [],
        reason_codes: [],
        fieldName,
      };
    }
    
    // Mark as validating
    setValidatingFields(prev => ({ ...prev, [fieldName]: true }));
    
    try {
      const result = await validateExpressTextAnswer({
        fieldName,
        answer,
        businessName: context.businessName || '',
        domain: context.domain || '',
        context: context.extra || {},
      });
      
      // Update validation status
      setValidationStatus(prev => ({
        ...prev,
        [fieldName]: {
          status: result.success ? result.status : 'error',
          message: result.message || '',
          suggestions: result.suggestions || [],
          reason_codes: result.reason_codes || [],
          validatedAt: new Date().toISOString(),
          dirtySince: null,
          source: result.reason_codes?.includes('server_validation_unavailable') ? 'local_fallback' : 'server',
        },
      }));
      
      return result;
    } catch (err) {
      // Fallback to local validation
      const localResult = runLocalExpressTextValidation({ fieldName, answer });
      
      setValidationStatus(prev => ({
        ...prev,
        [fieldName]: {
          status: localResult.status,
          message: localResult.message || '',
          suggestions: localResult.suggestions || [],
          reason_codes: [...(localResult.reason_codes || []), 'server_validation_unavailable'],
          validatedAt: new Date().toISOString(),
          dirtySince: null,
          source: 'local_fallback',
        },
      }));
      
      return localResult;
    } finally {
      setValidatingFields(prev => ({ ...prev, [fieldName]: false }));
    }
  }, []);
  
  /**
   * Mark a field as dirty (changed since validation)
   */
  const markFieldDirty = useCallback((fieldName) => {
    dirtyFieldsRef.current[fieldName] = Date.now();
    
    setValidationStatus(prev => {
      const existing = prev[fieldName];
      if (!existing) return prev;
      
      return {
        ...prev,
        [fieldName]: {
          ...existing,
          status: 'dirty',
          dirtySince: new Date().toISOString(),
        },
      };
    });
  }, []);
  
  /**
   * Set validation result directly (for manual overrides)
   */
  const setFieldValidation = useCallback((fieldName, result) => {
    setValidationStatus(prev => ({
      ...prev,
      [fieldName]: {
        status: result.status || 'unknown',
        message: result.message || '',
        suggestions: result.suggestions || [],
        reason_codes: result.reason_codes || [],
        validatedAt: new Date().toISOString(),
        dirtySince: null,
        source: result.source || 'manual',
      },
    }));
  }, []);
  
  /**
   * Clear validation for a field
   */
  const clearFieldValidation = useCallback((fieldName) => {
    setValidationStatus(prev => {
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
    
    setValidatingFields(prev => {
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
    
    delete dirtyFieldsRef.current[fieldName];
  }, []);
  
  /**
   * Check if a field is currently validating
   */
  const isFieldValidating = useCallback((fieldName) => {
    return !!validatingFields[fieldName];
  }, [validatingFields]);
  
  /**
   * Get validation status for a field
   */
  const getFieldStatus = useCallback((fieldName) => {
    return validationStatus[fieldName] || {
      status: 'unknown',
      message: '',
      suggestions: [],
      reason_codes: [],
      validatedAt: null,
      dirtySince: null,
      source: 'none',
    };
  }, [validationStatus]);
  
  /**
   * Check if a field is dirty (changed since validation)
   */
  const isFieldDirty = useCallback((fieldName) => {
    return !!dirtyFieldsRef.current[fieldName];
  }, []);
  
  /**
   * Get all field validation statuses
   */
  const getAllFieldStatuses = useCallback(() => {
    return validationStatus;
  }, [validationStatus]);
  
  /**
   * Create a debounced validator for a specific field
   */
  const createDebouncedValidator = useCallback((fieldName, delay = 1000) => {
    return debounce((answer, context) => {
      validateField(fieldName, answer, context);
    }, delay);
  }, [validateField]);
  
  return {
    validationStatus,
    validatingFields,
    validateField,
    markFieldDirty,
    setFieldValidation,
    clearFieldValidation,
    isFieldValidating,
    getFieldStatus,
    isFieldDirty,
    getAllFieldStatuses,
    createDebouncedValidator,
  };
}