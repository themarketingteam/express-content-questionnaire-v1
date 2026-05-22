import { base44 } from "@/api/base44Client";
import {
  buildExpressSubmissionPayload,
  mapExpressPayloadToFormSubmissionRecord,
  safeJsonStringify,
  serializeExpressError,
} from "@/lib/expressQuestionnairePayload";
import {
  createExpressFormSubmissionWithFallback,
  serializeSubmitError,
  buildExpressPayloadFeatureSummary,
} from "@/lib/expressSubmissionResilience";
import { sendExpressZapierSafe, buildExpressZapierPayload } from "@/lib/expressZapierDelivery";

// Custom error class for submit flow failures
export class SubmitFlowError extends Error {
  constructor({ userMessage, recoveryCode, failureKind, stage, serializedError }) {
    super(userMessage);
    this.name = "SubmitFlowError";
    this.userMessage = userMessage;
    this.recoveryCode = recoveryCode;
    this.failureKind = failureKind;
    this.stage = stage;
    this.serializedError = serializedError;
  }
}

// Write failed submission backup to localStorage
export function writeFailedExpressSubmissionBackup({ questionnaireSessionId, responseSnapshot, transformedPayload, error }) {
  try {
    const backup = {
      session_id: questionnaireSessionId,
      responses: responseSnapshot,
      transformedPayload,
      error: serializeSubmitError(error),
      createdAt: new Date().toISOString(),
    };
    const key = `failed_express_submission_${Date.now()}`;
    localStorage.setItem(key, JSON.stringify(backup));
  } catch (storageErr) {
    // Silently ignore storage errors
  }
}

// Safe draft save wrapper
export async function safeDraftSave(args) {
  const { saveDraftNow, draftData, questionnaireSessionId } = args;
  try {
    if (saveDraftNow) {
      await saveDraftNow(draftData);
    }
    return true;
  } catch (saveErr) {
    // Write local backup if draft save fails
    try {
      const backupKey = `failed_express_draft_${Date.now()}`;
      localStorage.setItem(backupKey, JSON.stringify({
        session_id: questionnaireSessionId,
        draftData,
        error: serializeSubmitError(saveErr),
        createdAt: new Date().toISOString(),
      }));
    } catch {
      // ignore
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
  } catch (eventErr) {
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
    domainParam,
    questionnaireSessionId,
    saveDraftNow,
    createDraftEvent,
    onFinalSubmitSuccess,
    onFinalSubmitFailure,
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
    },
    questionnaireSessionId,
  });

  // Step 5: Build transformed Express payload
  let transformedPayload;
  try {
    transformedPayload = buildExpressSubmissionPayload({
      formData: responseSnapshot,
      businessName,
      domain,
      sessionId: questionnaireSessionId,
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
      },
      questionnaireSessionId,
    });

    // Write failed local backup
    writeFailedExpressSubmissionBackup({
      questionnaireSessionId,
      responseSnapshot,
      transformedPayload: null,
      error: transformErr,
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
      // Fallback received intake - treat as handled recovery
      if (onFinalSubmitSuccess) {
        onFinalSubmitSuccess({
          ok: true,
          accepted: true,
          receivedViaIntake: true,
          submissionCreated: false,
          intakeId: fallbackResult.intakeId,
          submissionId: null,
          submission: null,
          recoveryCode,
          zapierSent: false,
          zapierError: null,
        });
      }
      return {
        ok: true,
        accepted: true,
        receivedViaIntake: true,
        submissionCreated: false,
        intakeId: fallbackResult.intakeId,
        submissionId: null,
        submission: null,
        recoveryCode,
        zapierSent: false,
        zapierError: null,
      };
    }

    // Fallback failed - throw SubmitFlowError
    throw new SubmitFlowError({
      userMessage: `We saved your progress, but final submission could not complete. Please try again and share this recovery code with support if needed: ${recoveryCode}`,
      recoveryCode,
      failureKind: fallbackResult.failureKind || "transform",
      stage: "payload_transform_failed",
      serializedError,
    });
  }

  // Step 6: Map final FormSubmission record
  const formSubmissionRecord = mapExpressPayloadToFormSubmissionRecord(transformedPayload);

  // Step 7: Prepare submit context and diagnostics
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
    draftIdPresent: false,
    payloadFeatureSummary: buildExpressPayloadFeatureSummary(transformedPayload),
    timestamp,
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

  // Step 9: Handle successful result
  if (submitResult.ok) {
    const successTimestamp = new Date().toISOString();

    // Zapier delivery: send after successful save/fallback
    let zapierSent = false;
    let zapierError = null;
    
    try {
      const zapierPayload = buildExpressZapierPayload(transformedPayload);
      const zapierResult = await sendExpressZapierSafe(zapierPayload);
      
      if (zapierResult.ok) {
        zapierSent = true;
        
        // Record zapier_sent event
        if (createDraftEvent) {
          await createDraftEventSafe({
            createDraftEvent,
            event: {
              eventType: "zapier_sent",
              questionId: "",
              questionType: "submit",
              value: {
                stage: "zapier_sent",
                session_id: questionnaireSessionId,
                business_name: businessName,
                domain,
                zapierSent: true,
              },
            },
          });
        }
      } else {
        zapierError = zapierResult.error;
        
        // Record zapier_failed event
        if (createDraftEvent) {
          await createDraftEventSafe({
            createDraftEvent,
            event: {
              eventType: "zapier_failed",
              questionId: "",
              questionType: "submit",
              value: {
                stage: "zapier_failed",
                session_id: questionnaireSessionId,
                business_name: businessName,
                domain,
                zapierError: serializeExpressError(new Error(zapierError)),
              },
            },
          });
        }
      }
    } catch (zapierErr) {
      // Silently ignore Zapier errors - don't fail the submission
      zapierError = zapierErr.message || 'Zapier delivery failed';
    }

    // Best-effort update FormSubmissionIntake if intake was received
    if (submitResult.receivedViaIntake && submitResult.intakeId) {
      try {
        await base44.entities.FormSubmissionIntake.update(submitResult.intakeId, {
          zapier_sent: zapierSent,
          zapier_error_json: zapierError ? JSON.stringify({ message: zapierError }) : null,
        });
      } catch (intakeUpdateErr) {
        // RLS may prevent client updates - log only in development
        const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;
        if (isDev) {
          console.warn('[submitExpressQuestionnaire] Could not update intake with Zapier status:', intakeUpdateErr.message);
        }
      }
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
            submissionId: submitResult.submissionId,
            intakeId: submitResult.intakeId,
          },
        },
      });
    }

    // Save draft status
    const draftStatus = submitResult.receivedViaIntake ? "submit_failed" : "submitted";
    await safeDraftSave({
      saveDraftNow,
      draftData: {
        status: draftStatus,
        finalSubmissionId: submitResult.submissionId || "",
        submitError: submitResult.receivedViaIntake
          ? safeJsonStringify({
              message: "Submission received via durable intake fallback",
              intakeId: submitResult.intakeId || "",
              recoveryCode,
            })
          : null,
        responsesSnapshot: responseSnapshot,
        validationStatusSnapshot: validationStatus || {},
        touchedQuestionsSnapshot: touchedQuestions || {},
        expandedQuestionsSnapshot: expandedQuestions || {},
      },
      questionnaireSessionId,
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
    },
    questionnaireSessionId,
  });

  // Write failed local backup
  writeFailedExpressSubmissionBackup({
    questionnaireSessionId,
    responseSnapshot,
    transformedPayload,
    error: submitResult.error,
  });

  // Call failure callback
  if (onFinalSubmitFailure) {
    onFinalSubmitFailure({
      error: submitResult.error,
      recoveryCode,
      failureKind: submitResult.failureKind,
    });
  }

  // Throw SubmitFlowError
  throw new SubmitFlowError({
    userMessage: `We saved your progress, but final submission could not complete. Please try again and share this recovery code with support if needed: ${recoveryCode}`,
    recoveryCode,
    failureKind: submitResult.failureKind || "unknown",
    stage: "submit_failed",
    serializedError,
  });
}