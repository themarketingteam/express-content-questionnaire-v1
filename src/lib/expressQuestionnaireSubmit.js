import { base44 } from "@/api/base44Client";
import {
  buildExpressSubmissionPayload,
  mapExpressPayloadToFormSubmissionRecord,
  safeJsonStringify,
  serializeExpressError,
} from "@/lib/expressQuestionnairePayload";
import {
  repairExpressSubmissionPayload,
  validateExpressSubmissionPayload,
} from "@/lib/expressPayloadRepair";
import {
  createExpressFormSubmissionWithFallback,
  serializeSubmitError,
  buildExpressPayloadFeatureSummary,
} from "@/lib/expressSubmissionResilience";
import { sendExpressZapierSafe, buildExpressZapierPayload } from "@/lib/expressZapierDelivery";
import { writeLocalFailedSubmissionBackup } from "@/lib/localRecoveryBackup";
import {
  hasDurableSubmissionReceipt,
  isFinalSubmissionConfirmed,
  wasSubmissionIntakeCaptured,
} from "@/lib/submissionReceipt";

// Best-effort Zapier delivery status persistence
export async function updateZapierDeliveryStatusSafe(args) {
  const { submissionId, intakeId, zapierResult, createDraftEvent, questionnaireSessionId, businessName, domain } = args;
  
  const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;
  const timestamp = new Date().toISOString();
  
  // Build safe delivery update values
  const update = zapierResult.ok
    ? {
        zapier_delivery_status: "sent",
        zapier_sent: true,
        zapier_sent_at: timestamp,
        zapier_error_json: "",
        zapier_attempt_count: 1,
      }
    : {
        zapier_delivery_status: "failed",
        zapier_sent: false,
        zapier_sent_at: "",
        zapier_error_json: safeJsonStringify(zapierResult.error || {}),
        zapier_attempt_count: 1,
      };
  
  // Update FormSubmission if submissionId exists
  if (submissionId) {
    try {
      await base44.entities.FormSubmission.update(submissionId, update);
    } catch (err) {
      if (isDev) {
        console.warn('[updateZapierDeliveryStatusSafe] Could not update FormSubmission:', err.message);
      }
    }
  }
  
  // Update FormSubmissionIntake if no submissionId but intakeId exists
  if (!submissionId && intakeId) {
    try {
      await base44.entities.FormSubmissionIntake.update(intakeId, {
        zapier_sent: update.zapier_sent,
        zapier_error_json: update.zapier_error_json,
      });
    } catch (err) {
      if (isDev) {
        console.warn('[updateZapierDeliveryStatusSafe] Could not update FormSubmissionIntake:', err.message);
      }
    }
  }
  
  // Create draft event
  if (createDraftEvent) {
    const eventType = zapierResult.ok ? "zapier_sent" : "zapier_failed";
    await createDraftEventSafe({
      createDraftEvent,
      event: {
        eventType,
        questionId: "",
        questionType: "submit",
        value: {
          stage: eventType,
          session_id: questionnaireSessionId,
          business_name: businessName,
          domain,
          submissionId: submissionId || null,
          intakeId: intakeId || null,
          zapierResult: zapierResult.ok ? { ok: true } : { ok: false, error: zapierResult.error },
        },
      },
    });
  }
}

// Custom error class for submit flow failures
export class SubmitFlowError extends Error {
  constructor({ userMessage, recoveryCode, failureKind, stage, serializedError, intakeId, sessionId, submitAttemptId, safeMessage }) {
    super(userMessage);
    this.name = "SubmitFlowError";
    this.userMessage = userMessage;
    this.safeMessage = safeMessage || userMessage;
    this.recoveryCode = recoveryCode;
    this.failureKind = failureKind;
    this.stage = stage;
    this.serializedError = serializedError;
    this.intakeId = intakeId || null;
    this.sessionId = sessionId || null;
    this.submitAttemptId = submitAttemptId || null;
  }
}



// Safe draft save wrapper with indexed backup
export async function safeDraftSave(args) {
  const { 
    saveDraftNow, 
    draftData, 
    questionnaireSessionId,
    submitAttemptId,
    businessName,
    domain,
    responses,
    transformedPayload,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    stage,
  } = args;
  
  try {
    if (saveDraftNow) {
      await saveDraftNow({ ...draftData, businessName, domain });
    }
    return true;
  } catch (saveErr) {
    // Write indexed local backup if draft save fails during submit-related stages
    const isSubmitRelated = stage && (
      stage.startsWith('submit_') || 
      draftData?.status === 'submit_attempted' ||
      draftData?.status === 'submit_failed' ||
      draftData?.status === 'submitted'
    );
    
    if (isSubmitRelated) {
      try {
        writeLocalFailedSubmissionBackup({
          sessionId: questionnaireSessionId,
          submitAttemptId: submitAttemptId || "",
          businessName: businessName || "",
          domain: domain || "",
          responses: responses || draftData?.responsesSnapshot || {},
          transformedPayload: transformedPayload || null,
          validationStatus: validationStatus || draftData?.validationStatusSnapshot || {},
          touchedQuestions: touchedQuestions || draftData?.touchedQuestionsSnapshot || {},
          expandedQuestions: expandedQuestions || draftData?.expandedQuestionsSnapshot || {},
          stage: stage || "draft_save_failed",
          error: saveErr,
          diagnostics: {
            source: "safeDraftSave",
            draftData,
            failedAt: new Date().toISOString(),
          },
        });
      } catch {
        // ignore backup write errors
      }
    }
    return false;
  }
}

// Safe draft event creation wrapper
export async function createDraftEventSafe(args) {
  const { createDraftEvent, event } = args;
  try {
    if (createDraftEvent) {
      await createDraftEvent(event);
    }
    return true;
  } catch {
    // Silently ignore event creation failures
    return false;
  }
}

// Main Express questionnaire submit orchestrator
export async function submitExpressQuestionnaire(args) {
  const {
    businessName,
    domain,
    responses,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    credentials,
    domainParam: _domainParam,
    questionnaireSessionId,
    saveDraftNow,
    createDraftEvent,
    onFinalSubmitSuccess,
    onFinalSubmitFailure,
    submitAttemptId,
  } = args;

  const recoveryCode = questionnaireSessionId || "unknown-session";
  const timestamp = new Date().toISOString();

  // Step 1: Create response snapshot
  const responseSnapshot = { ...responses };

  // Step 2: Record submit_started event
  if (createDraftEvent) {
    await createDraftEventSafe({
      createDraftEvent,
      event: {
        eventType: "submit_started",
        questionId: "",
        questionType: "submit",
        value: {
          stage: "submit_started",
          session_id: questionnaireSessionId,
          business_name: businessName,
          domain,
          submit_attempt_id: submitAttemptId || "",
        },
      },
    });
  }

  // Step 3: Create draft event: submit_attempted
  if (createDraftEvent) {
    await createDraftEventSafe({
      createDraftEvent,
      event: {
        eventType: "submit_attempted",
        questionId: "",
        questionType: "submit",
        value: {
          stage: "submit_attempted",
          session_id: questionnaireSessionId,
          business_name: businessName,
          domain,
          submit_attempt_id: submitAttemptId || "",
        },
      },
    });
  }

  // Step 4: Save draft with status: submit_attempted
  await safeDraftSave({
    saveDraftNow,
    draftData: {
      status: "submit_attempted",
      responsesSnapshot: responseSnapshot,
      validationStatusSnapshot: validationStatus || {},
      touchedQuestionsSnapshot: touchedQuestions || {},
      expandedQuestionsSnapshot: expandedQuestions || {},
      submitAttemptId,
    },
    questionnaireSessionId,
    submitAttemptId,
    businessName,
    domain,
    responses: responseSnapshot,
    transformedPayload: null,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    stage: "submit_attempted",
  });

  // Step 5: Build transformed Express payload
  let transformedPayload;
  try {
    transformedPayload = buildExpressSubmissionPayload({
      formData: responseSnapshot,
      businessName,
      domain,
      sessionId: questionnaireSessionId,
      submitAttemptId,
    });
  } catch (transformErr) {
    const serializedError = serializeExpressError(transformErr);

    // Record stage: payload_transform_failed
    if (createDraftEvent) {
      await createDraftEventSafe({
        createDraftEvent,
        event: {
          eventType: "submit_failed",
          questionId: "",
          questionType: "submit",
          value: {
            stage: "payload_transform_failed",
            session_id: questionnaireSessionId,
            business_name: businessName,
            domain,
            submit_attempt_id: submitAttemptId || "",
            error: serializedError,
          },
        },
      });
    }

    // Save draft status: submit_failed
    await safeDraftSave({
      saveDraftNow,
      draftData: {
        status: "submit_failed",
        submitError: safeJsonStringify(serializedError || {}),
        responsesSnapshot: responseSnapshot,
        validationStatusSnapshot: validationStatus || {},
        touchedQuestionsSnapshot: touchedQuestions || {},
        expandedQuestionsSnapshot: expandedQuestions || {},
        submitAttemptId,
      },
      questionnaireSessionId,
      submitAttemptId,
      businessName,
      domain,
      responses: responseSnapshot,
      transformedPayload: null,
      validationStatus,
      touchedQuestions,
      expandedQuestions,
      stage: "payload_transform_failed",
    });

    // Write local failed submission backup
    writeLocalFailedSubmissionBackup({
      sessionId: questionnaireSessionId,
      submitAttemptId,
      businessName,
      domain,
      responses: responseSnapshot,
      transformedPayload: null,
      validationStatus: validationStatus || {},
      touchedQuestions: touchedQuestions || {},
      expandedQuestions: expandedQuestions || {},
      stage: "payload_transform_failed",
      error: transformErr,
      diagnostics: {
        questionnaireSessionId,
        businessNamePresent: !!businessName,
        domainPresent: !!domain,
        stage: "payload_transform_failed",
        timestamp,
      },
    });

    // Call fallback with transformFailed: true
    const submitContext = {
      businessName,
      business_name: businessName,
      domain,
      businessDomain: domain,
      business_domain: domain,
      userEmail: credentials?.userEmail || "",
      user_email: credentials?.userEmail || "",
      userId: credentials?.userId || "",
      user_id: credentials?.userId || "",
      createdAt: timestamp,
      created_at_client: timestamp,
      source: "express_questionnaire_submit",
    };

    const diagnostics = {
      questionnaireSessionId,
      businessNamePresent: !!businessName,
      domainPresent: !!domain,
      stage: "payload_transform_failed",
      timestamp,
    };

    const fallbackResult = await createExpressFormSubmissionWithFallback({
      payload: null,
      formSubmissionRecord: null,
      responseSnapshot,
      rawResponses: responseSnapshot,
      transformFailed: true,
      transformError: transformErr,
      validationFailed: false,
      validationError: null,
      questionnaireSessionId,
      draftId: null,
      submitContext,
      diagnostics,
    });

    if (fallbackResult.ok && fallbackResult.receivedViaIntake) {
      const safeMessage = "We saved your answers for recovery, but the submission payload could not be prepared for Zapier.";
      if (onFinalSubmitFailure) {
        onFinalSubmitFailure({
          error: { message: safeMessage },
          recoveryCode,
          failureKind: "transform",
          intakeId: fallbackResult.intakeId,
          intakeCaptured: true,
          sessionId: questionnaireSessionId,
          submitAttemptId,
          safeMessage,
        });
      }
      throw new SubmitFlowError({
        userMessage: `${safeMessage} Recovery code: ${recoveryCode}`,
        safeMessage,
        recoveryCode,
        failureKind: "transform",
        stage: "payload_transform_failed",
        serializedError,
        intakeId: fallbackResult.intakeId,
        sessionId: questionnaireSessionId,
        submitAttemptId,
      });
    }

    // Fallback failed - throw SubmitFlowError
    throw new SubmitFlowError({
      userMessage: `We saved your progress, but final submission could not complete. Please try again and share this recovery code with support if needed: ${recoveryCode}`,
      safeMessage: "Submission could not be completed due to a payload error. Your answers are saved.",
      recoveryCode,
      failureKind: fallbackResult.failureKind || "transform",
      stage: "payload_transform_failed",
      serializedError,
      intakeId: null,
      sessionId: questionnaireSessionId,
      submitAttemptId,
    });
  }

  // Step 6: Deterministic payload repair
  let payloadRepairResult = { payload: transformedPayload, changedPaths: [], warnings: [], repaired: false };
  try {
    payloadRepairResult = repairExpressSubmissionPayload(transformedPayload, {
      businessName,
      sessionId: questionnaireSessionId,
      submitAttemptId,
    });
    transformedPayload = payloadRepairResult.payload;

    // Record repair event if any changes were made
    if (payloadRepairResult.repaired && createDraftEvent) {
      await createDraftEventSafe({
        createDraftEvent,
        event: {
          eventType: "payload_repaired",
          questionId: "",
          questionType: "submit",
          value: {
            stage: "payload_repaired",
            session_id: questionnaireSessionId,
            changedPaths: payloadRepairResult.changedPaths,
            warnings: payloadRepairResult.warnings,
          },
        },
      });
    }
  } catch (repairErr) {
    // Repair failure is non-fatal — continue with original payload
    payloadRepairResult.warnings.push(repairErr?.message || "Repair step threw unexpectedly");
  }

  // Step 6b: Validate repaired payload
  const payloadValidation = validateExpressSubmissionPayload(transformedPayload);
  if (!payloadValidation.ok) {
    if (createDraftEvent) {
      await createDraftEventSafe({
        createDraftEvent,
        event: {
          eventType: "payload_validation_failed",
          questionId: "",
          questionType: "submit",
          value: {
            stage: "payload_validation_failed",
            session_id: questionnaireSessionId,
            validationErrors: payloadValidation.errors,
            warnings: payloadValidation.warnings,
          },
        },
      });
    }

    // Send to intake/fallback path with validation failure flag
    const submitContextValidFail = {
      businessName,
      business_name: businessName,
      domain,
      businessDomain: domain,
      business_domain: domain,
      userEmail: credentials?.userEmail || "",
      user_email: credentials?.userEmail || "",
      userId: credentials?.userId || "",
      user_id: credentials?.userId || "",
      createdAt: timestamp,
      created_at_client: timestamp,
      source: "express_questionnaire_submit",
    };
    const diagnosticsValidFail = {
      questionnaireSessionId,
      businessNamePresent: !!businessName,
      domainPresent: !!domain,
      stage: "payload_validation_failed",
      validationErrors: payloadValidation.errors,
      payloadRepair: {
        repaired: payloadRepairResult.repaired,
        changedPaths: payloadRepairResult.changedPaths,
        warnings: payloadRepairResult.warnings,
      },
      timestamp,
    };
    const fallbackValidFail = await createExpressFormSubmissionWithFallback({
      payload: transformedPayload,
      formSubmissionRecord: null,
      responseSnapshot,
      rawResponses: responseSnapshot,
      transformFailed: false,
      transformError: null,
      validationFailed: true,
      validationError: { errors: payloadValidation.errors, warnings: payloadValidation.warnings },
      questionnaireSessionId,
      draftId: null,
      submitContext: submitContextValidFail,
      diagnostics: diagnosticsValidFail,
    });

    if (fallbackValidFail.ok && fallbackValidFail.receivedViaIntake) {
      const safeMessage = "We saved your answers for recovery, but validation prevented Zapier delivery.";
      if (onFinalSubmitFailure) {
        onFinalSubmitFailure({
          error: { message: safeMessage },
          recoveryCode,
          failureKind: "validation",
          intakeId: fallbackValidFail.intakeId,
          intakeCaptured: true,
          sessionId: questionnaireSessionId,
          submitAttemptId,
          safeMessage,
        });
      }
      throw new SubmitFlowError({
        userMessage: `${safeMessage} Recovery code: ${recoveryCode}`,
        safeMessage,
        recoveryCode,
        failureKind: "validation",
        stage: "payload_validation_failed",
        serializedError: serializeExpressError({ message: payloadValidation.errors.join("; ") }),
        intakeId: fallbackValidFail.intakeId,
        sessionId: questionnaireSessionId,
        submitAttemptId,
      });
    }

    throw new SubmitFlowError({
      userMessage: `We saved your progress, but submission could not be confirmed. Recovery code: ${recoveryCode}`,
      safeMessage: "Submission could not be confirmed due to a validation issue. Your answers are saved.",
      recoveryCode,
      failureKind: "validation",
      stage: "payload_validation_failed",
      serializedError: serializeExpressError({ message: payloadValidation.errors.join("; ") }),
      intakeId: null,
      sessionId: questionnaireSessionId,
      submitAttemptId,
    });
  }

  // Step 7: Map final FormSubmission record
  const formSubmissionRecord = mapExpressPayloadToFormSubmissionRecord(transformedPayload);

  // Step 8: Prepare submit context and diagnostics
  const submitContext = {
    businessName,
    business_name: businessName,
    domain,
    businessDomain: domain,
    business_domain: domain,
    userEmail: credentials?.userEmail || "",
    user_email: credentials?.userEmail || "",
    userId: credentials?.userId || "",
    user_id: credentials?.userId || "",
    createdAt: timestamp,
    created_at_client: timestamp,
    source: "express_questionnaire_submit",
    submitAttemptId,
    submit_attempt_id: submitAttemptId || "",
  };

  // Build validation status summary if available
  const validationSummary = validationStatus ? (() => {
    const statusCounts = { complete: 0, needs_work: 0, incomplete: 0, dirty: 0, error: 0, unknown: 0 };
    const blockingFields = [];
    
    Object.entries(validationStatus).forEach(([field, status]) => {
      const statusValue = status?.status || 'unknown';
      statusCounts[statusValue] = (statusCounts[statusValue] || 0) + 1;
      
      if (statusValue === 'incomplete' || statusValue === 'error') {
        blockingFields.push(field);
      }
    });
    
    return {
      status_counts: statusCounts,
      blocking_fields: blockingFields,
      total_fields: Object.keys(validationStatus).length,
    };
  })() : null;
  
  const diagnostics = {
    questionnaireSessionId,
    businessNamePresent: !!businessName,
    domainPresent: !!domain,
    draftIdPresent: false,
    payloadFeatureSummary: buildExpressPayloadFeatureSummary(transformedPayload),
    validation_summary: validationSummary,
    timestamp,
    submitAttemptId: submitAttemptId || "",
    payloadRepair: {
      repaired: payloadRepairResult.repaired,
      changedPaths: payloadRepairResult.changedPaths,
      warnings: payloadRepairResult.warnings,
    },
  };

  // Step 8: Submit through resilient fallback-aware flow
  const submitResult = await createExpressFormSubmissionWithFallback({
    payload: transformedPayload,
    formSubmissionRecord,
    responseSnapshot,
    rawResponses: responseSnapshot,
    transformFailed: false,
    transformError: null,
    validationFailed: false,
    validationError: null,
    questionnaireSessionId,
    draftId: null,
    submitContext,
    diagnostics,
  });

  if (submitResult.ok && !hasDurableSubmissionReceipt(submitResult)) {
    submitResult.ok = false;
    submitResult.error = new Error("Submission backend did not return a durable receipt.");
    submitResult.failureKind = "receipt";
  }

  // Step 9: Handle successful result
  if (submitResult.ok) {
    // Zapier delivery: send after successful save/fallback
    let zapierSent = false;
    let zapierError = null;
    let zapierResult = { ok: false, error: null };
    
    try {
      const zapierPayload = buildExpressZapierPayload(transformedPayload);
      zapierResult = await sendExpressZapierSafe(zapierPayload);
      
      if (zapierResult.ok) {
        zapierSent = true;
      } else {
        zapierError = zapierResult.error;
      }
    } catch (zapierErr) {
      zapierError = zapierErr.message || 'Zapier delivery failed';
      zapierResult = { ok: false, error: zapierError };
    }
    
    // Best-effort persist Zapier status to FormSubmission or FormSubmissionIntake
    await updateZapierDeliveryStatusSafe({
      submissionId: submitResult.submissionId,
      intakeId: submitResult.intakeId,
      zapierResult,
      createDraftEvent,
      questionnaireSessionId,
      businessName,
      domain,
    });

    if (!isFinalSubmissionConfirmed(submitResult, zapierResult)) {
      const deliveryMessage = typeof zapierError === "string"
        ? zapierError
        : (zapierError?.message || "Zapier did not accept the Express submission.");
      const serializedDeliveryError = serializeExpressError({
        message: deliveryMessage,
        status: zapierResult.zapierStatus,
      });
      await safeDraftSave({
        saveDraftNow,
        draftData: {
          status: "auto_repair_pending",
          submitError: safeJsonStringify(serializedDeliveryError || {}),
          responsesSnapshot: responseSnapshot,
          validationStatusSnapshot: validationStatus || {},
          touchedQuestionsSnapshot: touchedQuestions || {},
          expandedQuestionsSnapshot: expandedQuestions || {},
          submitAttemptId,
        },
        questionnaireSessionId,
        submitAttemptId,
        businessName,
        domain,
        responses: responseSnapshot,
        transformedPayload,
        validationStatus,
        touchedQuestions,
        expandedQuestions,
        stage: "zapier_failed",
      });
      writeLocalFailedSubmissionBackup({
        sessionId: questionnaireSessionId,
        submitAttemptId,
        businessName,
        domain,
        responses: responseSnapshot,
        transformedPayload,
        validationStatus: validationStatus || {},
        touchedQuestions: touchedQuestions || {},
        expandedQuestions: expandedQuestions || {},
        stage: "zapier_failed",
        error: { message: deliveryMessage },
        diagnostics: {
          submissionId: submitResult.submissionId || null,
          intakeId: submitResult.intakeId || null,
          zapierStatus: zapierResult.zapierStatus ?? null,
          zapierEndpoint: zapierResult.zapierEndpoint || null,
          timestamp: new Date().toISOString(),
        },
      });
      const failureDetails = {
        error: { message: deliveryMessage },
        recoveryCode,
        failureKind: "delivery",
        intakeId: submitResult.intakeId || null,
        intakeCaptured: hasDurableSubmissionReceipt(submitResult),
        sessionId: questionnaireSessionId,
        submitAttemptId,
        safeMessage: deliveryMessage,
      };
      if (onFinalSubmitFailure) onFinalSubmitFailure(failureDetails);
      throw new SubmitFlowError({
        userMessage: `${deliveryMessage} Recovery code: ${recoveryCode}`,
        safeMessage: deliveryMessage,
        recoveryCode,
        failureKind: "delivery",
        stage: "zapier_failed",
        serializedError: serializedDeliveryError,
        intakeId: submitResult.intakeId || null,
        sessionId: questionnaireSessionId,
        submitAttemptId,
      });
    }

    // Record submit success stage
    if (createDraftEvent) {
      const successEventType = submitResult.receivedViaIntake ? "submit_received_via_intake" : "submit_succeeded";
      await createDraftEventSafe({
        createDraftEvent,
        event: {
          eventType: successEventType,
          questionId: "",
          questionType: "submit",
          value: {
            stage: successEventType,
            session_id: questionnaireSessionId,
            business_name: businessName,
            domain,
            submit_attempt_id: submitAttemptId || "",
            submissionId: submitResult.submissionId,
            intakeId: submitResult.intakeId,
          },
        },
      });
    }

    // Save draft status — intake-only is treated as submitted from user perspective
    const draftStatus = submitResult.submissionCreated ? "submitted" : (submitResult.receivedViaIntake ? "submitted" : "submitted");
    await safeDraftSave({
      saveDraftNow,
      draftData: {
        status: draftStatus,
        finalSubmissionId: submitResult.submissionId || "",
        submitError: submitResult.receivedViaIntake
          ? null
          : null,
        responsesSnapshot: responseSnapshot,
        validationStatusSnapshot: validationStatus || {},
        touchedQuestionsSnapshot: touchedQuestions || {},
        expandedQuestionsSnapshot: expandedQuestions || {},
        submitAttemptId,
      },
      questionnaireSessionId,
      submitAttemptId,
      businessName,
      domain,
      responses: responseSnapshot,
      transformedPayload,
      validationStatus,
      touchedQuestions,
      expandedQuestions,
      stage: draftStatus,
    });

    // Call success callback with Zapier status
    if (onFinalSubmitSuccess) {
      onFinalSubmitSuccess({
        ok: true,
        accepted: true,
        submissionCreated: submitResult.submissionCreated || false,
        receivedViaIntake: submitResult.receivedViaIntake || false,
        intakeId: submitResult.intakeId || null,
        submissionId: submitResult.submissionId,
        submission: submitResult.submission,
        recoveryCode,
        zapierSent,
        zapierError,
      });
    }

    return {
      ok: true,
      accepted: true,
      submissionCreated: submitResult.submissionCreated || false,
      receivedViaIntake: submitResult.receivedViaIntake || false,
      intakeId: submitResult.intakeId || null,
      submissionId: submitResult.submissionId,
      submission: submitResult.submission,
      recoveryCode,
      zapierSent,
      zapierError,
    };
  }

  // Step 10: Handle failure result
  const failureTimestamp = new Date().toISOString();
  const serializedError = serializeSubmitError(submitResult.error);

  // Record submit failed stage
  if (createDraftEvent) {
    await createDraftEventSafe({
      createDraftEvent,
      event: {
        eventType: "submit_failed",
        questionId: "",
        questionType: "submit",
        value: {
          stage: "submit_failed",
          session_id: questionnaireSessionId,
          business_name: businessName,
          domain,
          submit_attempt_id: submitAttemptId || "",
          error: serializedError,
        },
      },
    });
  }

  const intakeCaptured = wasSubmissionIntakeCaptured(submitResult);

  // Save draft status — always use auto_repair_pending since data was captured
  const draftFailStatus = "auto_repair_pending";

  await safeDraftSave({
    saveDraftNow,
    draftData: {
      status: draftFailStatus,
      submitError: safeJsonStringify(serializedError || {}),
      responsesSnapshot: responseSnapshot,
      validationStatusSnapshot: validationStatus || {},
      touchedQuestionsSnapshot: touchedQuestions || {},
      expandedQuestionsSnapshot: expandedQuestions || {},
      submitAttemptId,
    },
    questionnaireSessionId,
    submitAttemptId,
    businessName,
    domain,
    responses: responseSnapshot,
    transformedPayload,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    stage: draftFailStatus,
  });

  // Write local failed submission backup
  writeLocalFailedSubmissionBackup({
    sessionId: questionnaireSessionId,
    submitAttemptId,
    businessName,
    domain,
    responses: responseSnapshot,
    transformedPayload,
    validationStatus: validationStatus || {},
    touchedQuestions: touchedQuestions || {},
    expandedQuestions: expandedQuestions || {},
    stage: submitResult.failureKind || "submit_failed",
    error: submitResult.error,
    diagnostics: {
      questionnaireSessionId,
      businessNamePresent: !!businessName,
      domainPresent: !!domain,
      stage: draftFailStatus,
      failureKind: submitResult.failureKind || "unknown",
      intakeCaptured,
      timestamp: failureTimestamp,
    },
  });

  // Intake capture preserves the answers, but it is not final success until Zapier accepts them.
  if (intakeCaptured) {
    if (onFinalSubmitFailure) {
      onFinalSubmitFailure({
        error: submitResult.error,
        recoveryCode,
        failureKind: submitResult.failureKind,
        intakeId: submitResult.intakeId || null,
        intakeCaptured: true,
        sessionId: questionnaireSessionId,
        submitAttemptId,
        safeMessage: "Your answers were saved for recovery, but final delivery was not confirmed.",
      });
    }
    throw new SubmitFlowError({
      userMessage: `Your answers were saved, but final delivery was not confirmed. Recovery code: ${recoveryCode}`,
      safeMessage: "Your answers were saved for recovery, but final delivery was not confirmed.",
      recoveryCode,
      failureKind: submitResult.failureKind || "delivery",
      stage: "submit_recovery_pending",
      serializedError,
      intakeId: submitResult.intakeId || null,
      sessionId: questionnaireSessionId,
      submitAttemptId,
    });
  }

  // No intake capture — surface error to user normally
  if (onFinalSubmitFailure) {
    onFinalSubmitFailure({
      error: submitResult.error,
      recoveryCode,
      failureKind: submitResult.failureKind,
      intakeId: submitResult.intakeId || null,
      intakeCaptured: false,
      sessionId: questionnaireSessionId,
      submitAttemptId,
      safeMessage: "We could not confirm your submission. Your answers are still saved in this browser.",
    });
  }

  // Throw SubmitFlowError
  throw new SubmitFlowError({
    userMessage: `We could not confirm your submission was received. Please copy the recovery details and try again. Recovery code: ${recoveryCode}`,
    safeMessage: "We could not confirm your submission. Your answers are still saved in this browser.",
    recoveryCode,
    failureKind: submitResult.failureKind || "unknown",
    stage: "submit_failed",
    serializedError,
    intakeId: submitResult.intakeId || null,
    sessionId: questionnaireSessionId,
    submitAttemptId,
  });
}
