import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { getOrCreateQuestionnaireDraftIdentity, clearQuestionnaireSessionId } from "@/lib/sessionId";
import { getInitialExpressFormData, serializeExpressError } from "@/lib/expressQuestionnairePayload";
import { EXPRESS_COOKIE_KEY, parsePersistedStateCookie, buildPersistedState, serializePersistedState, getDefaultExpandedQuestions, saveStateToLocalStorage, loadStateFromLocalStorage, writeStateMarkerCookie, clearStateFromLocalStorage } from "@/lib/expressPersistedState";
import { clearExpressQuestionnaireLocalState, createLocalStateResetDiagnostic } from "@/lib/localQuestionnaireReset";
import { buildDraftEventRecord } from "@/lib/draftEvents";
import { createSaveDraftSnapshot, writeDraftFailureBackup } from "@/lib/draftPersistence";
import { createQuestionnaireDraftApi, createSerialDraftSaveQueue } from "@/lib/questionnaireDraftApi";
import {
  buildPersistedStateFromRemoteDraft,
  parseRemoteAnswerHistory,
  selectNewestPersistedState,
} from "@/lib/remoteDraftState";
import { submitExpressQuestionnaire, SubmitFlowError } from "@/lib/expressQuestionnaireSubmit";
import {
  createSubmitAttemptId,
  readActiveSubmitAttempt,
  writeActiveSubmitAttempt,
  clearActiveSubmitAttempt,
  hasActiveSubmitAttemptForSession,
} from "@/lib/submitAttempt";
import {
  readLatestLocalFailedSubmissionBackup,
} from "@/lib/localRecoveryBackup";
import { useExpressTextValidation } from "@/lib/hooks/useExpressTextValidation";
import { isExpressTextValidationField, createAnswerHash } from "@/lib/expressTextValidation";
import { runSubmitTextValidation } from "@/lib/expressSubmitTextValidation";
import { getExpressQuestionDisplayStatus } from "@/lib/questionValidationStatus";
import QuestionValidationBadge from "@/components/questionnaire/QuestionValidationBadge";
import IncompleteQuestionSummary from "@/components/questionnaire/IncompleteQuestionSummary";
import { buildIncompleteQuestionSummary, getFirstBlockingQuestionId, hasBlockingIncompleteItems } from "@/lib/incompleteQuestionSummary";
import { motion, AnimatePresence } from "framer-motion";
import CheckboxQuestion from "../components/questionnaire/CheckboxQuestion";
import CategorizedCheckboxQuestion from "../components/questionnaire/CategorizedCheckboxQuestion";
import RadioQuestion from "../components/questionnaire/RadioQuestion";
import TextAreaQuestion from "../components/questionnaire/TextAreaQuestion";
import GeographicQuestion from "../components/questionnaire/GeographicQuestion";
import NumericRangeQuestion from "../components/questionnaire/NumericRangeQuestion";
import InfoModal from "../components/questionnaire/InfoModal";
import ConfirmModal from "../components/questionnaire/ConfirmModal";
import ThankYouModal from "../components/questionnaire/ThankYouModal";
import ValidationGuideModal from "../components/questionnaire/ValidationGuideModal";
import ExpressDataValidator from "@/components/questionnaire/ExpressDataValidator";
import DestructiveActionConfirmModal from "@/components/questionnaire/DestructiveActionConfirmModal";
import { Info } from "lucide-react";
import { Toaster, toast } from "sonner";
import { useExpressAnswerHistory } from "@/lib/hooks/useExpressAnswerHistory";
import { parseAnswerHistory } from "@/lib/expressAnswerHistory";
import RecoverLastAnswerNotice from "@/components/questionnaire/RecoverLastAnswerNotice";
import SubmitRecoveryCard from "@/components/questionnaire/SubmitRecoveryCard";
import ExpressDraftSaveStatus from "@/components/questionnaire/ExpressDraftSaveStatus";
import { HELPER_COPY } from "@/lib/questionnaireHelperCopy";

const STORAGE_KEY = EXPRESS_COOKIE_KEY;

// Cookie helpers
const setCookie = (name, value, days = 365) => {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
};

const getCookie = (name) => {
  return document.cookie.split('; ').reduce((r, v) => {
    const parts = v.split('=');
    return parts[0] === name ? decodeURIComponent(parts[1]) : r;
  }, '');
};

const deleteCookie = (name) => {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
};

// HELPER_COPY is imported from @/lib/questionnaireHelperCopy above

const FIELD_TO_QUESTION = {
  itCompanyType: "1", itCompanyTypeOther: "1",
  serviceOfferings: "2", serviceOfferingsOther: "2",
  differentiation: "3",
  geographicAreas: "4", geographicAreaMeta: "4",
  pricingPackaging: "5", pricingPackagingOther: "5",
  companyGoals: "6", companyGoalsOther: "6",
  brandTone: "7", brandToneOther: "7",
  targetIndustries: "8", targetIndustriesOther: "8",
  clientSize: "9",
  clientChallenges: "10", clientChallengesOther: "10",
  clientOutcomes: "11", clientOutcomesOther: "11",
  idealClient: "12",
};

export default function Questionnaire() {
  const [formData, setFormData] = useState(getInitialExpressFormData);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showThankYouModal, setShowThankYouModal] = useState(false);
  const [submittedData, setSubmittedData] = useState(null);
  const [infoModalData, setInfoModalData] = useState(null);
  const [showValidationGuide, setShowValidationGuide] = useState(false);
  const [openQuestions, setOpenQuestions] = useState([1]);
  const [touchedQuestions, setTouchedQuestions] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localRecoveryBackupId, setLocalRecoveryBackupId] = useState("");
  const [latestLocalRecoveryBackup, setLatestLocalRecoveryBackup] = useState(null);
  const [submitValidationIssues, setSubmitValidationIssues] = useState([]);
  const [submitValidationWarnings, setSubmitValidationWarnings] = useState([]);
  const [isSubmitValidatingText, setIsSubmitValidatingText] = useState(false);
  const [submitAttemptedWithIncomplete, setSubmitAttemptedWithIncomplete] = useState(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [isDraftHydrating, setIsDraftHydrating] = useState(true);
  const [draftSaveStatus, setDraftSaveStatus] = useState(/** @type {{ state: string, lastServerSavedAt?: string, lastLocalSavedAt?: string, pendingLocalChanges?: boolean, lastError?: string }} */ ({ state: "initializing" }));

  // Last-failed submit context — drives the recovery card
  const [lastSubmitContext, setLastSubmitContext] = useState(null);
  const [isRetryingSubmit, setIsRetryingSubmit] = useState(false);

  // Answer history — recovery layer only (not submitted)
  const answerHistory = useExpressAnswerHistory();

  // Text validation hook - must be declared before use
  const textValidation = useExpressTextValidation();

  // Question completion checker - must be declared before incompleteSummary
  const isQuestionComplete = (questionNum) => {
    const hasAnswer = (field, otherField) => {
      const selected = (formData[field] || []).length;
      const hasOther = (otherField && (formData[otherField] || "").trim().length > 0);
      return selected > 0 || hasOther;
    };

    const hasMinimumAnswer = (field, otherField, minRequired) => {
      const selected = (formData[field] || []).length;
      const hasOther = (otherField && (formData[otherField] || "").trim().length > 0);
      const total = selected + (hasOther ? 1 : 0);
      return total >= minRequired;
    };

    const hasRadioAnswer = (field, otherField) => {
      const selected = (formData[field] || "").trim().length > 0;
      const hasOther = (otherField && (formData[otherField] || "").trim().length > 0);
      return selected || hasOther;
    };

    const hasText = (val) => (val || "").trim().length > 0;

    switch(questionNum) {
      case 1: return hasAnswer("itCompanyType", "itCompanyTypeOther");
      case 2: return hasMinimumAnswer("serviceOfferings", "serviceOfferingsOther", 3);
      case 3: return hasText(formData.differentiation);
      case 4: return hasText(formData.geographicAreas);
      case 5: return hasRadioAnswer("pricingPackaging", "pricingPackagingOther");
      case 6: return hasRadioAnswer("companyGoals", "companyGoalsOther");
      case 7: return hasRadioAnswer("brandTone", "brandToneOther");
      case 8: return hasAnswer("targetIndustries", "targetIndustriesOther");
      case 9: return hasText(formData.clientSize);
      case 10: return hasAnswer("clientChallenges", "clientChallengesOther");
      case 11: return hasAnswer("clientOutcomes", "clientOutcomesOther");
      case 12: return hasText(formData.idealClient);
      default: return false;
    }
  };

  // Normalize validatingFields to support both object and array shapes
  const validatingFieldsForDisplay = React.useMemo(() => {
    const vf = textValidation.validatingFields || {};
    if (Array.isArray(vf)) return vf;
    if (vf && typeof vf === "object") {
      return Object.keys(vf).filter((fieldName) => Boolean(vf[fieldName]));
    }
    return [];
  }, [textValidation.validatingFields]);

  // Memoized incomplete question summary - must come after textValidation and isQuestionComplete
  const incompleteSummary = React.useMemo(() => {
    return buildIncompleteQuestionSummary({
      formData,
      touchedQuestions,
      validationStatus: textValidation.getAllFieldStatuses(),
      validatingFields: validatingFieldsForDisplay,
      isQuestionComplete,
    });
  }, [formData, touchedQuestions, textValidation, validatingFieldsForDisplay, isQuestionComplete]);

  const submitInFlightRef = useRef(false);
  const activeSubmitAttemptIdRef = useRef("");
  const isHydratedRef = useRef(false); // true after cookie/persisted state has been loaded into formData

  const questionRefs = useRef({});
  const draftSaveTimeoutRef = useRef(null);
  const draftTextEventTimeoutsRef = useRef({});
  const draftRecordIdRef = useRef("");
  const remoteDraftRef = useRef(null);
  const draftRequestVersionRef = useRef(0);
  const lastChangedQuestionIdRef = useRef("");
  const hasFinalSubmittedRef = useRef(false);

  const [draftIdentity] = useState(() => getOrCreateQuestionnaireDraftIdentity());
  const questionnaireSessionId = draftIdentity.sessionId;

  const urlParams = new URLSearchParams(window.location.search);
  const businessNameParam = urlParams.get("businessName") || urlParams.get("business_name") || urlParams.get("name") || "";
  const domainParam = "";
  const urlCredentials = {
    businessName: businessNameParam,
    domain: domainParam,
    userId: urlParams.get("userId") || "",
    userEmail: urlParams.get("userEmail") || "",
    userName: urlParams.get("userName") || "",
  };

  const draftApi = useMemo(() => createQuestionnaireDraftApi({
    invoke: (name, body) => base44.functions.invoke(name, body),
    sessionId: draftIdentity.sessionId,
    accessKey: draftIdentity.accessKey,
  }), [draftIdentity]);
  const enqueueDraftSave = useMemo(
    () => createSerialDraftSaveQueue((draftRecord) => draftApi.save(draftRecord)),
    [draftApi]
  );

  const findExistingDraftBySessionId = useCallback(async () => remoteDraftRef.current, []);

  const persistDraftRecord = useCallback(async (draftRecord) => {
    const requestVersion = draftRequestVersionRef.current + 1;
    draftRequestVersionRef.current = requestVersion;
    setDraftSaveStatus((previous) => ({
      ...previous,
      state: "saving_server",
      pendingLocalChanges: true,
      lastError: "",
    }));

    const performSave = async () => {
      let result;
      try {
        result = await enqueueDraftSave(draftRecord);
      } catch (error) {
        if (requestVersion !== draftRequestVersionRef.current && error && typeof error === "object") {
          error.draftSaveSuperseded = true;
        }
        throw error;
      }
      if (requestVersion !== draftRequestVersionRef.current) return result;

      if (result.stale) {
        const currentDraft = await draftApi.load();
        remoteDraftRef.current = currentDraft;
        setDraftSaveStatus({
          state: "saved_server",
          lastServerSavedAt: currentDraft?.last_saved_at || result.lastSavedAt || "",
          pendingLocalChanges: false,
          lastError: "",
        });
        return result;
      }

      const savedAt = result.lastSavedAt || draftRecord.last_saved_at || new Date().toISOString();
      remoteDraftRef.current = {
        ...(remoteDraftRef.current || {}),
        ...draftRecord,
        id: result.draftId || remoteDraftRef.current?.id || "",
        last_saved_at: savedAt,
      };
      setDraftSaveStatus({
        state: "saved_server",
        lastServerSavedAt: savedAt,
        pendingLocalChanges: false,
        lastError: "",
      });
      return result;
    };

    return performSave();
  }, [draftApi, enqueueDraftSave]);

  const saveDraftSnapshot = useCallback(
    createSaveDraftSnapshot({
      entities: base44.entities,
      draftRecordIdRef,
      findExistingDraftBySessionId,
      persistDraftRecord,
    }),
    [findExistingDraftBySessionId, persistDraftRecord]
  );

  const saveDraftNow = useCallback(async (options = {}) => {
    const {
      status,
      submitError,
      finalSubmissionId,
      responsesSnapshot,
      validationStatusSnapshot,
      touchedQuestionsSnapshot,
      expandedQuestionsSnapshot: expandedSnapshotArg,
      submitAttemptId,
      businessName: modalBusinessName,
      domain: modalDomain,
    } = /** @type {any} */ (options);
    if (!isHydratedRef.current && !responsesSnapshot) return; // Block pre-hydration saves unless caller passes an explicit snapshot
    const expandedSnap = expandedSnapshotArg || Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [String(i + 1), openQuestions.includes(i + 1)])
    );
    // Use text validation hook status as canonical validation status
    const canonicalValidationStatus = validationStatusSnapshot || textValidation.getAllFieldStatuses();
    await saveDraftSnapshot({
      sessionId: questionnaireSessionId,
      responses: responsesSnapshot || formData,
      validationStatus: canonicalValidationStatus,
      touchedQuestions: touchedQuestionsSnapshot || touchedQuestions,
      expandedQuestions: expandedSnap,
      credentials: urlCredentials,
      businessNameParam: modalBusinessName || businessNameParam,
      domainParam: modalDomain || domainParam,
      currentQuestionId: lastChangedQuestionIdRef.current,
      lastChangedQuestionId: lastChangedQuestionIdRef.current,
      status: status || "draft",
      submitError: submitError || "",
      finalSubmissionId: finalSubmissionId || "",
      submitAttemptId: submitAttemptId || "",
    });
  }, [saveDraftSnapshot, questionnaireSessionId, formData, touchedQuestions, openQuestions, businessNameParam, domainParam, textValidation]);

  const queueDraftSave = useCallback((changedQuestionId, nextFormData, historySnapshot) => {
    if (hasFinalSubmittedRef.current) return;
    if (!isHydratedRef.current) return; // Don't save before cookie state is loaded
    lastChangedQuestionIdRef.current = String(changedQuestionId || "");
    setDraftSaveStatus((previous) => ({
      ...previous,
      state: "saved_local",
      pendingLocalChanges: true,
      lastLocalSavedAt: new Date().toISOString(),
    }));
    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
    draftSaveTimeoutRef.current = setTimeout(async () => {
      try {
        const expandedSnap = Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [String(i + 1), openQuestions.includes(i + 1)])
        );
        // Include validation status from hook
        const validationStatus = textValidation.getAllFieldStatuses();
        await saveDraftSnapshot({
          sessionId: questionnaireSessionId,
          responses: nextFormData,
          validationStatus,
          touchedQuestions,
          expandedQuestions: expandedSnap,
          credentials: urlCredentials,
          businessNameParam,
          domainParam,
          currentQuestionId: String(changedQuestionId || ""),
          lastChangedQuestionId: String(changedQuestionId || ""),
          status: "draft",
          submitError: "",
          finalSubmissionId: "",
          submitAttemptId: "",
          lastNonEmptyAnswers: historySnapshot || answerHistory.lastNonEmptyAnswers,
          fieldHistory: answerHistory.fieldHistory,
          lastLocalPersistedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error("[draft] save failed:", err?.message || err);
        if (!err?.draftSaveSuperseded) {
          setDraftSaveStatus((previous) => ({
            ...previous,
            state: navigator.onLine === false ? "offline_saved_local" : "server_error",
            pendingLocalChanges: true,
            lastError: err?.message || "Secure draft save failed",
          }));
        }
        writeDraftFailureBackup({
          questionnaireSessionId,
          responses: nextFormData,
          validationStatus: textValidation.getAllFieldStatuses(),
          touchedQuestions,
          expandedQuestions: Object.fromEntries(
            Array.from({ length: 12 }, (_, i) => [String(i + 1), openQuestions.includes(i + 1)])
          ),
          error: err,
          submitAttemptId: "",
        });
      }
    }, 1800);
  }, [saveDraftSnapshot, questionnaireSessionId, touchedQuestions, openQuestions, businessNameParam, domainParam, textValidation]);

  // Cleanup draft save timeout on unmount
  useEffect(() => {
    return () => {
      if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
      Object.values(draftTextEventTimeoutsRef.current).forEach(clearTimeout);
    };
  }, []);

  const QUESTION_META = {
    itCompanyType: { id: "1", type: "checkbox" },
    itCompanyTypeOther: { id: "1", type: "checkbox" },
    serviceOfferings: { id: "2", type: "categorized_checkbox" },
    serviceOfferingsOther: { id: "2", type: "categorized_checkbox" },
    differentiation: { id: "3", type: "textarea" },
    geographicAreas: { id: "4", type: "geographic" },
    geographicAreaMeta: { id: "4", type: "geographic" },
    pricingPackaging: { id: "5", type: "radio" },
    pricingPackagingOther: { id: "5", type: "radio" },
    companyGoals: { id: "6", type: "radio" },
    companyGoalsOther: { id: "6", type: "radio" },
    brandTone: { id: "7", type: "radio" },
    brandToneOther: { id: "7", type: "radio" },
    targetIndustries: { id: "8", type: "checkbox" },
    targetIndustriesOther: { id: "8", type: "checkbox" },
    clientSize: { id: "9", type: "numeric_range" },
    clientChallenges: { id: "10", type: "checkbox" },
    clientChallengesOther: { id: "10", type: "checkbox" },
    clientOutcomes: { id: "11", type: "checkbox" },
    clientOutcomesOther: { id: "11", type: "checkbox" },
    idealClient: { id: "12", type: "textarea" },
  };

  const getQuestionMetaForField = (field) => QUESTION_META[field] || { id: "", type: "" };

  const createDraftEvent = async ({ eventType, questionId, questionType, value }) => {
    if (!questionnaireSessionId) return;
    try {
      const record = buildDraftEventRecord({
        sessionId: questionnaireSessionId,
        eventType,
        questionId,
        questionType,
        value,
        businessName: urlCredentials.businessName,
        domain: urlCredentials.domain,
        userId: urlCredentials.userId,
        submitAttemptId: "",
      });
      await base44.entities.FormDraftEvent.create(record);
    } catch (err) {
      console.error("[draftEvent] write failed:", err?.message || err);
    }
  };

  const queueDraftEvent = ({ eventType, questionId, questionType, value }) => {
    const isText = questionType === "textarea" || questionType === "text";
    if (isText) {
      if (draftTextEventTimeoutsRef.current[questionId]) {
        clearTimeout(draftTextEventTimeoutsRef.current[questionId]);
      }
      draftTextEventTimeoutsRef.current[questionId] = setTimeout(() => {
        createDraftEvent({ eventType: "text_changed", questionId, questionType, value });
        delete draftTextEventTimeoutsRef.current[questionId];
      }, 1000);
    } else {
      createDraftEvent({ eventType, questionId, questionType, value });
    }
  };

  // Set favicon and page title
  useEffect(() => {
    document.title = 'MSP Success - Express | Website Content Questionnaire';
    
    const link = /** @type {HTMLLinkElement} */ (document.querySelector("link[rel*='icon']") || document.createElement('link'));
    link.type = 'image/png';
    link.rel = 'icon';
    link.href = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6913611c0ea0f6b631343af8/c380ae371_kaseya-logo.png';
    document.head.appendChild(link);
  }, []);



  // Restore the newest valid browser or secure-server snapshot before accepting edits.
  useEffect(() => {
    let active = true;

    const hydrateDraft = async () => {
      let localResult = null;
      let localSource = null;
      const lsResult = loadStateFromLocalStorage(questionnaireSessionId);
      const localStateSessionId = lsResult.state?.questionnaireSessionId || "";
      const localStateMatchesSession = !localStateSessionId
        || localStateSessionId === questionnaireSessionId;

      if (lsResult.state && localStateMatchesSession) {
        localResult = {
          ok: true,
          state: lsResult.state,
          migrated: false,
          repaired: false,
          discarded: false,
          error: null,
          diagnostics: { detectedFormat: "localStorage", source: lsResult.source },
        };
        localSource = lsResult.source;
      }

      if (!localResult) {
        const saved = getCookie(STORAGE_KEY);
        const cookieResult = parsePersistedStateCookie(saved);
        const cookieSessionId = cookieResult.state?.questionnaireSessionId || "";
        const cookieMatchesSession = !cookieSessionId || cookieSessionId === questionnaireSessionId;
        if (cookieResult.ok && cookieResult.state?.formData && cookieMatchesSession) {
          localResult = cookieResult;
          localSource = "cookie_fallback";
        }
      }

      let remoteDraft = null;
      let remoteError = null;
      try {
        remoteDraft = await draftApi.load();
      } catch (error) {
        remoteError = error;
        console.error("[draft] secure restore failed:", error?.message || error);
      }

      if (!active) return;

      remoteDraftRef.current = remoteDraft;
      draftRecordIdRef.current = remoteDraft?.id || "";
      const remoteState = buildPersistedStateFromRemoteDraft(remoteDraft, questionnaireSessionId);
      const selected = selectNewestPersistedState(localResult?.state || null, remoteState);
      const restoredState = selected.state;

      if (restoredState?.formData) {
        setFormData((previous) => ({ ...previous, ...restoredState.formData }));

        if (restoredState.validationStatus && typeof restoredState.validationStatus === "object") {
          Object.entries(restoredState.validationStatus).forEach(([fieldName, status]) => {
            textValidation.setFieldValidation(fieldName, status);
          });
        }
        if (restoredState.touchedQuestions && typeof restoredState.touchedQuestions === "object") {
          setTouchedQuestions(restoredState.touchedQuestions);
        }
        if (restoredState.expandedQuestions && typeof restoredState.expandedQuestions === "object") {
          const expandedNums = [];
          for (let questionNumber = 1; questionNumber <= 12; questionNumber += 1) {
            if (restoredState.expandedQuestions[String(questionNumber)]) expandedNums.push(questionNumber);
          }
          setOpenQuestions(expandedNums.length > 0 ? expandedNums : [1]);
        }

        // Repopulate browser storage after a server recovery so subsequent reloads are instant.
        saveStateToLocalStorage(restoredState, questionnaireSessionId);
        writeStateMarkerCookie(questionnaireSessionId, restoredState.savedAt);
      }

      const remoteHistory = selected.source === "server_draft"
        ? parseRemoteAnswerHistory(remoteDraft)
        : null;
      if (remoteHistory) {
        answerHistory.hydrateFromStored(remoteHistory);
      } else {
        try {
          const historyRaw = localStorage.getItem(`express_questionnaire_answer_history_${questionnaireSessionId}`);
          if (historyRaw) answerHistory.hydrateFromStored(parseAnswerHistory(historyRaw));
        } catch {
          // Ignore browser storage errors.
        }
      }

      if (import.meta.env.DEV && restoredState) {
        console.log(`[persisted-state] Loaded from ${selected.source || localSource}`);
      }

      if (remoteDraft) {
        setDraftSaveStatus({
          state: "saved_server",
          lastServerSavedAt: remoteDraft.last_saved_at || remoteDraft.updated_date || "",
          pendingLocalChanges: selected.source === "local",
          lastError: "",
        });
      } else if (remoteError) {
        setDraftSaveStatus({
          state: navigator.onLine === false ? "offline_saved_local" : "server_error",
          lastLocalSavedAt: restoredState?.savedAt || "",
          pendingLocalChanges: Boolean(restoredState),
          lastError: remoteError?.message || "Secure restore failed",
        });
      } else if (restoredState) {
        setDraftSaveStatus({
          state: "saved_local",
          lastLocalSavedAt: restoredState.savedAt || "",
          pendingLocalChanges: true,
          lastError: "",
        });
      } else {
        setDraftSaveStatus({
          state: "ready",
          pendingLocalChanges: false,
          lastError: "",
        });
      }

      isHydratedRef.current = true;
      setIsDraftHydrating(false);

      // Upload a newer browser snapshot (including legacy cookie data) immediately.
      if (restoredState && selected.source === "local") {
        try {
          await saveDraftSnapshot({
            sessionId: questionnaireSessionId,
            responses: restoredState.formData,
            validationStatus: restoredState.validationStatus || {},
            touchedQuestions: restoredState.touchedQuestions || {},
            expandedQuestions: restoredState.expandedQuestions || getDefaultExpandedQuestions(),
            credentials: urlCredentials,
            businessNameParam,
            domainParam,
            currentQuestionId: "",
            lastChangedQuestionId: "",
            status: "draft",
            submitError: "",
            finalSubmissionId: "",
            submitAttemptId: "",
            lastNonEmptyAnswers: remoteHistory || answerHistory.lastNonEmptyAnswers,
            fieldHistory: answerHistory.fieldHistory,
            lastLocalPersistedAt: restoredState.savedAt || new Date().toISOString(),
          });
        } catch (error) {
          if (!active) return;
          setDraftSaveStatus({
            state: navigator.onLine === false ? "offline_saved_local" : "server_error",
            lastLocalSavedAt: restoredState.savedAt || "",
            pendingLocalChanges: true,
            lastError: error?.message || "Secure draft save failed",
          });
        }
      }
    };

    hydrateDraft();
    return () => {
      active = false;
    };
  }, []);

  // Auto-save with validation status
  useEffect(() => {
    if (hasFinalSubmittedRef.current) {
      return;
    }
    if (!isHydratedRef.current) {
      return; // Don't auto-save before cookie state is loaded
    }

    const saveTimer = setTimeout(() => {
      const validationStatus = textValidation.getAllFieldStatuses();
      const expandedQuestions = Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [String(i + 1), openQuestions.includes(i + 1)])
      );
      
      // Build versioned persisted state
      const persistedState = buildPersistedState({
        formData,
        validationStatus,
        touchedQuestions,
        expandedQuestions,
        questionnaireSessionId,
      });
      
      // Save full state to localStorage (primary persistence layer)
      saveStateToLocalStorage(persistedState, questionnaireSessionId);
      // Write a small marker cookie for legacy compatibility (no form data)
      writeStateMarkerCookie(questionnaireSessionId, persistedState.savedAt);
    }, 300);

    return () => clearTimeout(saveTimer);
  }, [formData, textValidation, touchedQuestions, openQuestions, questionnaireSessionId]);

  // Save before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Skip autosave after final submission
      if (hasFinalSubmittedRef.current) return;
      
      // Save versioned persisted state to localStorage (primary)
      const validationStatus = textValidation.getAllFieldStatuses();
      const expandedQuestions = Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [String(i + 1), openQuestions.includes(i + 1)])
      );
      const persistedState = buildPersistedState({
        formData,
        validationStatus,
        touchedQuestions,
        expandedQuestions,
        questionnaireSessionId,
      });
      saveStateToLocalStorage(persistedState, questionnaireSessionId);
      writeStateMarkerCookie(questionnaireSessionId, persistedState.savedAt);
      
      // Local draft backup on unload
      try {
        localStorage.setItem(
          `express_questionnaire_local_backup_${questionnaireSessionId}`,
          JSON.stringify({
            session_id: questionnaireSessionId,
            responses: formData,
            touchedQuestions,
            expandedQuestions,
            savedAt: new Date().toISOString(),
          })
        );
      } catch {
        // ignore storage errors
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [formData, touchedQuestions, openQuestions, questionnaireSessionId, textValidation]);



  const updateField = useCallback((field, value) => {
    const questionId = FIELD_TO_QUESTION[field] || "";
    const { id: qId, type: qType } = getQuestionMetaForField(field);
    setTouchedQuestions(prev => questionId ? { ...prev, [questionId]: true } : prev);
    setFormData(prev => {
      const previousValue = prev[field];
      const next = { ...prev, [field]: value };
      const nextHistory = answerHistory.recordFieldChange(field, previousValue, value, {
        source: qType === "geographic" ? "selection" : "typing",
        questionId,
      });
      queueDraftSave(questionId, next, nextHistory);
      return next;
    });
    const eventType = qType === "textarea" || qType === "text" ? "text_changed"
      : qType === "geographic" ? "location_changed"
      : qType === "radio" ? "selection_changed"
      : "answer_changed";
    queueDraftEvent({ eventType, questionId: qId, questionType: qType, value });
    
    // Mark text validation fields as dirty if they have a validation result and answer changed
    if (isExpressTextValidationField(field)) {
      const status = textValidation.getFieldStatus(field);
      if (status.status !== 'unknown' && status.status !== 'dirty') {
        // Compare answer hash to detect if answer changed since validation
        const currentHash = createAnswerHash(value);
        const previousHash = status.answerHash;
        
        // Only mark dirty if hash changed (answer actually changed)
        if (previousHash && previousHash !== currentHash) {
          textValidation.markFieldDirty(field);
          // Create draft event for validation dirty
          createDraftEvent({
            eventType: "validation_dirty",
            questionId,
            questionType: qType,
            value: { fieldName: field, previousStatus: status.status, previousHash, currentHash },
          });
        }
      }
    }
  }, [queueDraftSave, questionnaireSessionId, textValidation, createDraftEvent]);

  const updateArrayField = useCallback((field, value, limit = 3, otherField = null) => {
    const questionId = FIELD_TO_QUESTION[field] || "";
    const { id: qId, type: qType } = getQuestionMetaForField(field);
    setTouchedQuestions(prev => questionId ? { ...prev, [questionId]: true } : prev);
    setFormData(prev => {
      const current = prev[field] || [];
      const index = current.indexOf(value);
      const hasOtherText = otherField && (prev[otherField] || "").trim().length > 0;
      const totalSelections = current.length + (hasOtherText ? 1 : 0);

      let next;
      if (index > -1) {
        next = { ...prev, [field]: current.filter(v => v !== value) };
      } else {
        if (totalSelections >= limit) return prev;
        next = { ...prev, [field]: [...current, value] };
      }
      const nextHistory = answerHistory.recordFieldChange(field, current, next[field], {
        source: "selection",
        questionId,
      });
      queueDraftSave(questionId, next, nextHistory);
      queueDraftEvent({ eventType: "selection_changed", questionId: qId, questionType: qType, value: next[field] });
      return next;
    });
  }, [queueDraftSave, questionnaireSessionId, answerHistory]);

  const handleQuestionClick = (questionNum) => {
    let isOpening;
    setOpenQuestions(prev => {
      if (prev.includes(questionNum)) {
        isOpening = false;
        return prev.filter(q => q !== questionNum);
      } else {
        isOpening = true;
        return [...prev, questionNum];
      }
    });

    createDraftEvent({
      eventType: isOpening ? "question_opened" : "question_collapsed",
      questionId: String(questionNum),
      questionType: "question_container",
      value: { open: isOpening },
    });

    // Scroll to question with appropriate offset
    setTimeout(() => {
      const questionElement = questionRefs.current[questionNum];
      if (questionElement) {
        const offset = questionNum === 1 ? 0 : 100;
        const elementPosition = questionElement.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - offset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    }, 0);
  };

  const goToQuestion = (questionId) => {
    const qId = String(questionId);
    const qNum = Number(questionId);
    
    // Ensure question is open
    setOpenQuestions(prev => {
      if (prev.includes(qNum)) {
        return prev;
      }
      return [...prev, qNum];
    });

    // Scroll to question after it opens
    setTimeout(() => {
      const questionElement = questionRefs.current[qId];
      if (questionElement) {
        questionElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  };

  const isFormValid = () => {
    for (let i = 1; i <= 12; i++) {
      if (!isQuestionComplete(i)) return false;
    }
    return true;
  };

  const handleExpandAll = () => {
    setOpenQuestions([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  };

  const handleCollapseAll = () => {
    setOpenQuestions([]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Check for blocking incomplete items
    const hasBlocking = hasBlockingIncompleteItems(incompleteSummary);
    
    if (hasBlocking) {
      // Show incomplete summary prominently
      setSubmitAttemptedWithIncomplete(true);
      
      // Find and scroll to first blocking question
      const firstBlockingId = getFirstBlockingQuestionId(incompleteSummary);
      if (firstBlockingId) {
        goToQuestion(firstBlockingId);
      }
      
      // Show user-friendly message
      toast.error("Please complete the highlighted questions before submitting.");
      return;
    }
    
    // No blocking items - proceed with confirmation modal
    setSubmitAttemptedWithIncomplete(false);
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = useCallback(async (businessName, domain) => {
    // Prevent duplicate submits
    if (isSubmitting || submitInFlightRef.current || isSubmitValidatingText) return;
    
    // Check for active submit attempt
    if (hasActiveSubmitAttemptForSession(questionnaireSessionId)) {
      const active = readActiveSubmitAttempt();
      if (active) {
        // Active attempt exists and is not expired - prevent duplicate
        return;
      }
    }
    
    // Create new submit attempt
    const submitAttemptId = createSubmitAttemptId(questionnaireSessionId);
    activeSubmitAttemptIdRef.current = submitAttemptId;
    writeActiveSubmitAttempt({
      sessionId: questionnaireSessionId,
      attemptId: submitAttemptId,
      startedAt: new Date().toISOString(),
    });
    
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    setRecoveryCode("");
    setSubmitValidationIssues([]);
    setSubmitValidationWarnings([]);

    const rawFormData = { ...formData };

    try {
      // Step 1: Run submit-time text validation
      setIsSubmitValidatingText(true);
      
      // Create validation started event
      createDraftEvent({
        eventType: "submit_text_validation_started",
        questionId: "",
        questionType: "submit_validation",
        value: {
          session_id: questionnaireSessionId,
          fields_checked: ["differentiation", "idealClient"],
          startedAt: new Date().toISOString(),
        },
      });
      
      const validationResult = await runSubmitTextValidation({
        formData: rawFormData,
        validationStatus: textValidation.getAllFieldStatuses(),
        businessName,
        domain,
        onFieldResult: (fieldName, result) => {
          // Update canonical validation status
          textValidation.setFieldValidation(fieldName, result);
          
          // Create field validation result event
          createDraftEvent({
            eventType: "submit_text_field_validated",
            questionId: FIELD_TO_QUESTION[fieldName] || "",
            questionType: "submit_validation",
            value: {
              fieldName,
              status: result.status,
              message: result.message,
              reason_codes: result.reason_codes,
              validatedAt: new Date().toISOString(),
            },
          });
        },
      });
      
      // React state updates from onFieldResult are asynchronous. Merge the
      // results returned by this run so the draft and final submission receive
      // the exact validation snapshot that was just shown to the user.
      const finalValidationStatus = Object.entries(validationResult.resultsByField).reduce(
        (statuses, [fieldName, result]) => ({
          ...statuses,
          [fieldName]: {
            ...(statuses[fieldName] || {}),
            ...result,
          },
        }),
        textValidation.getAllFieldStatuses(),
      );
      
      // Save updated validation status to draft — use modal inputs for business name/domain
      await saveDraftSnapshot({
        sessionId: questionnaireSessionId,
        responses: rawFormData,
        validationStatus: finalValidationStatus,
        touchedQuestions,
        expandedQuestions: Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [String(i + 1), openQuestions.includes(i + 1)])
        ),
        credentials: urlCredentials,
        businessNameParam: businessName || businessNameParam,
        domainParam: domain || domainParam,
        currentQuestionId: "",
        lastChangedQuestionId: "",
        status: "draft",
        submitError: "",
        finalSubmissionId: "",
      });
      
      // Check for blocking issues
      if (validationResult.blockingIssues.length > 0) {
        setSubmitValidationIssues(validationResult.blockingIssues);
        setIsSubmitValidatingText(false);
        setIsSubmitting(false);
        submitInFlightRef.current = false;
        clearActiveSubmitAttempt(submitAttemptId);
        
        // Create draft event for blocked submit
        createDraftEvent({
          eventType: "submit_text_validation_blocked",
          questionId: "",
          questionType: "submit_validation",
          value: {
            session_id: questionnaireSessionId,
            blockingIssues: validationResult.blockingIssues,
            warnings: validationResult.warnings,
            blockedAt: new Date().toISOString(),
          },
        });
        
        // Keep modal open, show user-safe error
        return;
      }
      
      // Handle warnings (don't block, but track)
      if (validationResult.warnings.length > 0) {
        setSubmitValidationWarnings(validationResult.warnings);
      }
      
      // Create validation passed event
      createDraftEvent({
        eventType: "submit_text_validation_passed",
        questionId: "",
        questionType: "submit_validation",
        value: {
          session_id: questionnaireSessionId,
          warnings: validationResult.warnings,
          passedAt: new Date().toISOString(),
        },
      });
      
      setIsSubmitValidatingText(false);
      
      const result = await submitExpressQuestionnaire({
        businessName,
        domain,
        responses: rawFormData,
        validationStatus: finalValidationStatus,
        touchedQuestions,
        expandedQuestions: Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [String(i + 1), openQuestions.includes(i + 1)])
        ),
        credentials: urlCredentials,
        domainParam,
        questionnaireSessionId,
        saveDraftNow,
        createDraftEvent,
        submitAttemptId: activeSubmitAttemptIdRef.current,
        onFinalSubmitSuccess: (successResult) => {
          hasFinalSubmittedRef.current = true;
          if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);

          // Clear recovery card on success
          setLastSubmitContext(null);
          setIsRetryingSubmit(false);

          setSubmittedData({ 
            businessName, 
            domain, 
            formData: rawFormData 
          });
          setShowConfirmModal(false);
          
          // Intake-only receipt: do NOT reset form or clear cookie/session
          if (successResult.receivedViaIntake) {
            // Keep formData intact, preserve cookie, keep session id
            toast.success(`Your submission was safely received. Recovery code: ${questionnaireSessionId}`);
            setShowThankYouModal(true);
            return;
          }
          
          // Full success: clear cookie, session, reset form silently
          deleteCookie(STORAGE_KEY);
          clearQuestionnaireSessionId();
          resetQuestionnaireStateAfterFullSuccess();
          setShowThankYouModal(true);
        },
        onFinalSubmitFailure: (_failureResult) => {
          const errorMessage = _failureResult?.safeMessage || _failureResult?.error?.message || "Final delivery could not be confirmed.";
          setSubmitError(errorMessage);
          setRecoveryCode(_failureResult?.recoveryCode || questionnaireSessionId);
          setLastSubmitContext({
            businessName,
            businessDomain: domain,
            sessionId: questionnaireSessionId,
            lastSubmitAttemptId: activeSubmitAttemptIdRef.current,
            failedAt: new Date().toISOString(),
            recoveryCode: _failureResult?.recoveryCode || questionnaireSessionId,
            errorMessage,
            intakeId: _failureResult?.intakeId || null,
            intakeCaptured: Boolean(_failureResult?.intakeCaptured),
          });
          setShowConfirmModal(false);
          setShowThankYouModal(false);
          toast.error(errorMessage);
        },
      });

      // Success is handled in onFinalSubmitSuccess callback
    } catch (error) {
      const errorMessage = error?.safeMessage || error?.response?.data?.error?.message || error?.message || "Final delivery could not be confirmed.";
      setSubmitError(errorMessage);
      setRecoveryCode(error?.recoveryCode || questionnaireSessionId);
      setLastSubmitContext((current) => current || {
        businessName,
        businessDomain: domain,
        sessionId: questionnaireSessionId,
        lastSubmitAttemptId: activeSubmitAttemptIdRef.current,
        failedAt: new Date().toISOString(),
        recoveryCode: error?.recoveryCode || questionnaireSessionId,
        errorMessage,
        intakeId: error?.intakeId || null,
        intakeCaptured: Boolean(error?.intakeId),
      });
      setShowConfirmModal(false);
      setShowThankYouModal(false);
      toast.error(errorMessage);
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
      setIsRetryingSubmit(false);
      clearActiveSubmitAttempt(activeSubmitAttemptIdRef.current);
      // Close confirm modal on failure so recovery card is visible to user
      if (!hasFinalSubmittedRef.current) {
        setShowConfirmModal(false);
      }
    }
  }, [isSubmitting, formData, touchedQuestions, openQuestions, questionnaireSessionId, urlCredentials, domainParam, saveDraftNow, createDraftEvent]);

  const performClearAllAnswers = useCallback(async () => {
    setIsClearingAll(true);
    
    try {
      // Create cleared state values
      const clearedFormData = getInitialExpressFormData();
      const clearedValidationStatus = /** @type {Record<string, import("@/lib/expressPersistedState").ValidationStatus>} */ ({});
      const clearedTouchedQuestions = /** @type {Record<string, boolean>} */ ({});
      const clearedExpandedQuestions = getDefaultExpandedQuestions();
      
      // Set state using exact cleared values
      setFormData(clearedFormData);
      textValidation.resetAllFields();
      setTouchedQuestions(clearedTouchedQuestions);
      setOpenQuestions([1]);
      
      // Clear submit validation issues/warnings
      setSubmitValidationIssues([]);
      setSubmitValidationWarnings([]);
      
      // Clear submit error/recovery UI
      setSubmitError(null);
      setRecoveryCode("");
      
      // Save cleared state to draft snapshot
      if (!hasFinalSubmittedRef.current) {
        // Intentionally do NOT save cleared data to the server.
        // The recovery draft retains the last-known answers via per-field merge.
        // Only local state (form, localStorage, cookie) is cleared below.
        // When the user enters new answers, queueDraftSave merges them in.

        // Create draft event for destructive action
        createDraftEvent({
          eventType: "answers_cleared",
          questionId: "",
          questionType: "destructive_action",
          value: {
            session_id: questionnaireSessionId,
            cleared_at: new Date().toISOString(),
            cleared_fields_count: Object.keys(clearedFormData).length,
          },
        });
      }
      
      // Save cleared state to localStorage and write marker cookie
      const persistedState = buildPersistedState({
        formData: clearedFormData,
        validationStatus: clearedValidationStatus,
        touchedQuestions: clearedTouchedQuestions,
        expandedQuestions: clearedExpandedQuestions,
        questionnaireSessionId,
      });
      saveStateToLocalStorage(persistedState, questionnaireSessionId);
      writeStateMarkerCookie(questionnaireSessionId, persistedState.savedAt);
      
      toast.success("All answers cleared");
    } catch (err) {
      console.error("[clear-all] failed:", err);
      toast.error("Failed to clear answers. Please try again.");
    } finally {
      setIsClearingAll(false);
      setShowClearAllConfirm(false);
    }
  }, [questionnaireSessionId, textValidation, createDraftEvent]);

  // Silent reset after full successful submission (no confirmation modal)
  const resetQuestionnaireStateAfterFullSuccess = useCallback(() => {
    const clearedFormData = getInitialExpressFormData();
    const clearedTouchedQuestions = {};
    const defaultExpanded = getDefaultExpandedQuestions();
    const defaultOpenQuestions = Object.entries(defaultExpanded)
      .filter(([_, isOpen]) => isOpen)
      .map(([num]) => Number(num));
    
    // Reset state silently
    setFormData(clearedFormData);
    textValidation.resetAllFields();
    setTouchedQuestions(clearedTouchedQuestions);
    setOpenQuestions(defaultOpenQuestions.length > 0 ? defaultOpenQuestions : [1]);
    setSubmitValidationIssues([]);
    setSubmitValidationWarnings([]);
    setSubmitError(null);
    setRecoveryCode("");
    setLocalRecoveryBackupId("");
    setLatestLocalRecoveryBackup(null);
    
    // Do NOT save to draft, do NOT create events, do NOT open confirmation modal
  }, [textValidation]);

  const handleReset = () => {
    setShowClearAllConfirm(true);
  };

  // Retry submit from the recovery card — fresh attempt ID, same form data
  const handleRetrySubmit = useCallback(async () => {
    if (isRetryingSubmit || isSubmitting || submitInFlightRef.current) return;

    const ctx = lastSubmitContext;
    if (!ctx) return;

    // Open the confirm modal pre-filled with the last known business details
    // The confirm modal already holds businessName/domain from the last attempt via initialBusinessName/initialDomain
    // Re-open it so the user can confirm (and so validation reruns)
    setShowConfirmModal(true);
    setIsRetryingSubmit(false);
  }, [isRetryingSubmit, isSubmitting, lastSubmitContext]);

  const handleResetLocalState = () => {
    // Use centralized reset utility
    const result = clearExpressQuestionnaireLocalState({
      clearSession: true,
      clearSubmitAttempt: true,
      clearFailedBackups: false,
    });
    
    // Log result in development
    if (import.meta.env.DEV) {
      console.log('[reset] Local state cleared:', result);
    }
    
    // Reload page after reset
    window.location.reload();
  };

  const handleLocalStateRecovery = () => {
    const confirmed = window.confirm(
      'This will clear locally saved questionnaire answers and recovery session data in this browser only. Server-side drafts and submissions will not be deleted. Continue?'
    );
    
    if (!confirmed) return;
    
    handleResetLocalState();
  };

  const handleBeforeReset = ({ error, errorInfo }) => {
    // Write diagnostic backup before reset using centralized utility
    const diagnostic = createLocalStateResetDiagnostic('error_boundary_caught');
    
    try {
      localStorage.setItem(
        `express_questionnaire_error_diagnostic_${questionnaireSessionId}`,
        JSON.stringify({
          ...diagnostic,
          session_id: questionnaireSessionId,
          stage: "error_boundary_caught",
          error_message: error?.message || "Unknown error",
          has_error_info: !!errorInfo,
          component_stack: import.meta.env.DEV ? errorInfo?.componentStack : undefined,
        })
      );
    } catch {
      // Ignore storage errors
    }
  };

  // Get display status for each question
  const getQuestionDisplayStatus = (questionId) => {
    return getExpressQuestionDisplayStatus({
      questionId: String(questionId),
      formData,
      touchedQuestions,
      validationStatus: textValidation.getAllFieldStatuses(),
      validatingFields: validatingFieldsForDisplay,
      isQuestionComplete,
    });
  };

  // Handle text field validation
  const handleValidateTextField = useCallback(async (fieldName) => {
    const answer = formData[fieldName] || "";
    const questionId = FIELD_TO_QUESTION[fieldName] || "";
    const { type: qType } = getQuestionMetaForField(fieldName);
    
    // Create validation started event
    createDraftEvent({
      eventType: "validation_started",
      questionId,
      questionType: "text_validation",
      value: { fieldName },
    });
    
    try {
      // Call validation
      const result = await textValidation.validateField(fieldName, answer, {
        businessName: urlCredentials.businessName,
        domain: urlCredentials.domain,
        formData,
      });
      
      // Create validation completed event
      createDraftEvent({
        eventType: "validation_completed",
        questionId,
        questionType: "text_validation",
        value: {
          fieldName,
          status: result.status,
          message: result.message,
          reason_codes: result.reason_codes,
          validatedAt: new Date().toISOString(),
        },
      });
      
      // Queue draft save after validation
      queueDraftSave(questionId, formData);
    } catch (error) {
      // Create validation unavailable event
      createDraftEvent({
        eventType: "validation_unavailable",
        questionId,
        questionType: "text_validation",
        value: {
          fieldName,
          error: error?.message || "Validation failed",
          timestamp: new Date().toISOString(),
        },
      });
      
      // Still queue draft save to capture the error state
      queueDraftSave(questionId, formData);
    }
  }, [formData, textValidation, urlCredentials, createDraftEvent, queueDraftSave]);

  const initialBusinessName = businessNameParam;
  const initialDomain = domainParam;

  // Helper functions for converting between openQuestions array and expandedQuestions object
  const openQuestionsToExpandedQuestionsObject = (openQuestionsArray) => {
    return Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [String(i + 1), openQuestionsArray.includes(i + 1)])
    );
  };

  const expandedQuestionsObjectToOpenQuestions = (expandedQuestionsObject) => {
    const openNums = [];
    for (let i = 1; i <= 12; i++) {
      if (expandedQuestionsObject[String(i)]) {
        openNums.push(i);
      }
    }
    return openNums.length > 0 ? openNums : [1];
  };

  // Build expanded questions object for validator
  const expandedQuestionsSnapshot = openQuestionsToExpandedQuestionsObject(openQuestions);

  return (
    <>
      {/* Self-healing data validator - repairs malformed state silently */}
      <ExpressDataValidator
        formData={formData}
        validationStatus={textValidation.getAllFieldStatuses()}
        touchedQuestions={touchedQuestions}
        expandedQuestions={expandedQuestionsSnapshot}
        setFormData={setFormData}
        setValidationStatus={(vs) => {
          // Apply validation status repairs to hook
          Object.entries(vs).forEach(([fieldName, status]) => {
            textValidation.setFieldValidation(fieldName, status);
          });
        }}
        setTouchedQuestions={setTouchedQuestions}
        setExpandedQuestions={(nextExpanded) => {
          setOpenQuestions(expandedQuestionsObjectToOpenQuestions(nextExpanded));
        }}
        createDraftEvent={createDraftEvent}
        disabled={hasFinalSubmittedRef.current}
        onRepair={(result) => {
          if (import.meta.env.DEV) {
            console.info("[Express Questionnaire] Self-healing repairs applied", result.repairs);
          }
          // Only queue draft save after hydration, using result.formData from the validator
          // (which was applied to state via setFormData above)
          if (isHydratedRef.current) {
            queueDraftSave("self_healing", result.formData);
          }
        }}
      />
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <header className="shadow-sm" style={{
                      backgroundImage: 'url(https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6913611c0ea0f6b631343af8/724c89c4d_banner.jpg)',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}>
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-5xl font-bold text-white tracking-tight drop-shadow-lg" style={{ paddingTop: '75px', fontFamily: 'Raleway, sans-serif' }}>MSP Success - Express | Website Content Questionnaire</h1>
            <p className="text-white mt-1 drop-shadow-md text-lg" style={{ paddingBottom: '75px', fontFamily: 'Lato, sans-serif' }}>Help us get to know your business.</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="flex gap-3 mb-8">
          <button
            type="button"
            onClick={handleExpandAll}
            className="px-6 py-3 hover:opacity-90 font-bold transition-all text-sm tracking-wider uppercase"
            style={{ 
              backgroundColor: '#009ADD', 
              color: 'white',
              borderRadius: '2px',
              height: '48px',
              letterSpacing: '0.8px',
              fontFamily: 'Lato, sans-serif'
            }}
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={handleCollapseAll}
            className="px-6 py-3 hover:opacity-90 font-bold transition-all text-sm tracking-wider uppercase"
            style={{ 
              backgroundColor: '#7D868D', 
              color: 'white',
              borderRadius: '2px',
              height: '48px',
              letterSpacing: '0.8px',
              fontFamily: 'Lato, sans-serif'
            }}
          >
            Collapse All
          </button>
          <button
            type="button"
            onClick={() => setShowValidationGuide(true)}
            className="px-6 py-3 hover:opacity-90 font-bold transition-all text-sm tracking-wider uppercase flex items-center gap-2"
            style={{ 
              border: '2px solid #004B87',
              color: '#004B87',
              borderRadius: '2px',
              height: '48px',
              letterSpacing: '0.8px',
              fontFamily: 'Lato, sans-serif'
            }}
          >
            <Info className="w-4 h-4" />
            Answer Quality Guide
          </button>
        </div>

        <div className="mb-6 min-h-5">
          <ExpressDraftSaveStatus saveStatus={draftSaveStatus} />
        </div>

        <form
          onSubmit={handleSubmit}
          aria-busy={isDraftHydrating}
          className={`space-y-16 transition-opacity ${isDraftHydrating ? "pointer-events-none opacity-60" : ""}`}
        >
          <section className="space-y-8">
            <div className="pb-6 border-b-2" style={{ borderColor: '#009ADD' }}>
              <h2 className="text-2xl font-bold" style={{ color: '#004B87', fontFamily: 'Raleway, sans-serif' }}>Section 1: About Your Business</h2>
            </div>

            <div ref={el => questionRefs.current[1] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <CheckboxQuestion
                  questionNumber={1}
                  title="What type of IT company are you?"
                  hint="Check all that apply. Maximum 3 selections."
                  options={[
                    "Managed Services Provider (MSP)",
                    "IT Consulting / Project-Based Services",
                    "Cybersecurity Provider",
                    "Cloud / Hosting Provider",
                    "Co-Managed IT Partner",
                    "Break-Fix / On-Demand Support"
                  ]}
                  selected={formData.itCompanyType}
                  onToggle={(value) => updateArrayField("itCompanyType", value, 3, "itCompanyTypeOther")}
                  otherValue={formData.itCompanyTypeOther}
                  onOtherChange={(value) => updateField("itCompanyTypeOther", value)}
                  limit={3}
                  onInfoClick={() => setInfoModalData(HELPER_COPY.q1)}
                  isOpen={openQuestions.includes(1)}
                  onClick={() => handleQuestionClick(1)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("1")} compact />
              </div>
            </div>

            <div ref={el => questionRefs.current[2] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <CategorizedCheckboxQuestion
                  questionNumber={2}
                  title="What are your primary service offerings?"
                  hint="Select at least 3 core services. Maximum 6 selections."
                  categories={[
                  {
                    name: "CLOUD & INFRASTRUCTURE",
                    options: ["Cloud Services", "Hybrid Cloud Services", "Internet Services", "Microsoft 365", "Private Cloud Services", "Structured Cabling"]
                  },
                  {
                    name: "COMPLIANCE",
                    options: ["CMMC Compliance", "FTC Compliance", "HIPAA Compliance", "IT Compliance", "NIST Framework Compliance", "PCI Compliance", "SOC2 Compliance"]
                  },
                  {
                    name: "IT SERVICES",
                    options: ["Co-Managed IT", "Hourly IT Support", "IT Consulting", "IT Help Desk", "Managed IT", "Outsourced IT Help Desk"]
                  },
                  {
                    name: "SECURITY",
                    options: ["Cybersecurity", "Ransomware Removal", "Security Awareness Training", "Video Surveillance Solutions"]
                  },
                  {
                    name: "HARDWARE & RECOVERY",
                    options: ["Data Backup & Recovery", "Disaster Recovery Planning", "Hardware as a Service", "Printer & Office Machine", "VoIP Phone Systems"]
                  }
                ]}
                selected={formData.serviceOfferings}
                onToggle={(value) => updateArrayField("serviceOfferings", value, 6, "serviceOfferingsOther")}
                otherValue={formData.serviceOfferingsOther}
                onOtherChange={(value) => updateField("serviceOfferingsOther", value)}
                limit={6}
                onInfoClick={() => setInfoModalData(HELPER_COPY.q2)}
                isOpen={openQuestions.includes(2)}
                onClick={() => handleQuestionClick(2)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("2")} compact />
              </div>
            </div>

            <div ref={el => questionRefs.current[3] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <TextAreaQuestion
                 questionNumber={3}
                 title="What makes your company different from other MSPs in your area?"
                 hint="Focus on the unique value clients get from working with you—your responsiveness, customer experience, tools, or results they consistently praise."
                 value={formData.differentiation}
                 onChange={(value) => updateField("differentiation", value)}
                 minLength={0}
                 onInfoClick={() => setInfoModalData(HELPER_COPY.q3)}
                 isOpen={openQuestions.includes(3)}
                 onClick={() => handleQuestionClick(3)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("3")} compact />
                </div>
                <RecoverLastAnswerNotice
                field="differentiation"
                entry={answerHistory.getRecoverable("differentiation", formData.differentiation)}
                onRestore={(field, value) => { answerHistory.restoreField(field, value); updateField(field, value); }}
                onDismiss={answerHistory.dismissField}
                />

                {/* Validation controls for differentiation */}
              {openQuestions.includes(3) && (
                <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleValidateTextField("differentiation")}
                      disabled={textValidation.isFieldValidating("differentiation")}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      {textValidation.isFieldValidating("differentiation") ? "Validating..." : "Validate Answer"}
                    </button>
                    <span className="text-xs text-slate-500">Optional check only. Any non-empty answer can continue and submit.</span>
                    <button
                      type="button"
                      onClick={() => setShowValidationGuide(true)}
                      className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      What does this mean?
                    </button>
                  </div>
                  
                  {(() => {
                    const status = textValidation.getFieldStatus("differentiation");
                    if (status.status === 'unknown') return null;
                    
                    const statusConfig = {
                      complete: { color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', label: 'Looks complete' },
                      needs_work: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Could use a little more detail' },
                      incomplete: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Optional suggestion' },
                      dirty: { color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200', label: 'Edited since last validation' },
                      error: { color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200', label: 'Validation unavailable right now' },
                    };
                    
                    const config = statusConfig[status.status] || statusConfig.error;
                    
                    return (
                      <div className={`p-3 rounded-lg border ${config.bg} ${config.border}`}>
                        <p className={`text-sm font-semibold ${config.color}`}>{config.label}</p>
                        {status.message && status.status !== 'dirty' && (
                          <p className="text-xs text-slate-600 mt-1">{status.message}</p>
                        )}
                        {status.suggestions?.length > 0 && status.status !== 'dirty' && (
                          <ul className="mt-2 space-y-1">
                            {status.suggestions.map((suggestion, idx) => (
                              <li key={idx} className="text-xs text-slate-600 flex items-start gap-2">
                                <span className="text-slate-400">•</span>
                                <span>{suggestion}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {(status.status === 'needs_work' || status.status === 'incomplete') && (
                          <p className="text-xs text-slate-600 mt-2">You may submit this answer as-is or add more specific clients, services, outcomes, or business problems.</p>
                        )}
                        {status.status === 'dirty' && (
                          <p className="text-xs text-slate-600 mt-2">You can submit now or run the optional check again.</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div ref={el => questionRefs.current[4] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <GeographicQuestion
                  questionNumber={4}
                  value={formData.geographicAreas}
                  selectedMeta={formData.geographicAreaMeta}
                  onChange={(value) => updateField("geographicAreas", value)}
                  onSelect={(meta) => {
                    updateField("geographicAreaMeta", meta);
                    updateField("geographicAreas", meta.label);
                  }}
                  onClear={() => {
                    updateField("geographicAreas", "");
                    updateField("geographicAreaMeta", { label: "", lat: null, lon: null, place_id: null, source: "google" });
                  }}
                  onClearMetaOnly={() => {
                    updateField("geographicAreaMeta", { label: "", lat: null, lon: null, place_id: null, source: "manual" });
                  }}
                  onInfoClick={() => setInfoModalData(HELPER_COPY.q4)}
                  isOpen={openQuestions.includes(4)}
                  onClick={() => handleQuestionClick(4)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("4")} compact />
              </div>
            </div>

            <div ref={el => questionRefs.current[5] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <RadioQuestion
                  questionNumber={5}
                  title="How do you typically price or package your services?"
                  options={[
                    "Flat-rate monthly (fully managed)",
                    "Per-device / per-user pricing",
                    "Hourly or project-based",
                    "Hybrid (mix of the above)"
                  ]}
                  selected={formData.pricingPackaging}
                  onSelect={(value) => updateField("pricingPackaging", value)}
                  otherValue={formData.pricingPackagingOther}
                  onOtherChange={(value) => updateField("pricingPackagingOther", value)}
                  onInfoClick={() => setInfoModalData(HELPER_COPY.q5)}
                  isOpen={openQuestions.includes(5)}
                  onClick={() => handleQuestionClick(5)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("5")} compact />
              </div>
            </div>

            <div ref={el => questionRefs.current[6] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <RadioQuestion
                  questionNumber={6}
                  title="What are your company's biggest goals over the next year?"
                  options={[
                    "Acquire more clients",
                    "Improve recurring revenue",
                    "Strengthen cybersecurity offering",
                    "Expand into new markets",
                    "Rebrand / modernize web presence",
                    "Recruit or retain top technical staff"
                  ]}
                  selected={formData.companyGoals}
                  onSelect={(value) => updateField("companyGoals", value)}
                  otherValue={formData.companyGoalsOther}
                  onOtherChange={(value) => updateField("companyGoalsOther", value)}
                  onInfoClick={() => setInfoModalData(HELPER_COPY.q6)}
                  isOpen={openQuestions.includes(6)}
                  onClick={() => handleQuestionClick(6)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("6")} compact />
              </div>
            </div>

            <div ref={el => questionRefs.current[7] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <RadioQuestion
                  questionNumber={7}
                  title="What tone best describes how you want your brand to sound on your website?"
                  options={[
                    "Professional & Corporate",
                    "Friendly & Approachable",
                    "Technical & Expert-Driven",
                    "Modern & Innovative",
                    "Confident & Authoritative Expert",
                    "High-End & Premium",
                    "Story-Driven & Mission-Focused"
                  ]}
                  selected={formData.brandTone}
                  onSelect={(value) => updateField("brandTone", value)}
                  otherValue={formData.brandToneOther}
                  onOtherChange={(value) => updateField("brandToneOther", value)}
                  onInfoClick={() => setInfoModalData(HELPER_COPY.q7)}
                  isOpen={openQuestions.includes(7)}
                  onClick={() => handleQuestionClick(7)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("7")} compact />
              </div>
            </div>
          </section>

          <section className="space-y-8">
            <div className="pb-6 border-b-2" style={{ borderColor: '#009ADD' }}>
              <h2 className="text-2xl font-bold" style={{ color: '#004B87', fontFamily: 'Raleway, sans-serif' }}>Section 2: About Your Target Clients</h2>
            </div>

            <div ref={el => questionRefs.current[8] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <CheckboxQuestion
                  questionNumber={8}
                  title="What types of businesses do you primarily serve?"
                  hint="Check all that apply. Maximum 3 selections."
                  options={[
                    "Healthcare / Medical",
                    "Dental Practices",
                    "Financial / Accounting / CPA",
                    "Legal Firms",
                    "Manufacturing / Construction",
                    "Nonprofits / Education",
                    "Professional Services (Marketing, Real Estate, etc.)",
                    "Retail / Hospitality",
                    "Government / Municipalities",
                    "Real Estate / Property Management",
                    "Transportation / Logistics",
                    "Engineering / Architecture Firms",
                    "Energy / Oil & Gas",
                    "Insurance Agencies",
                    "Technology / SaaS Companies",
                    "Agriculture / Farming"
                  ]}
                  selected={formData.targetIndustries}
                  onToggle={(value) => updateArrayField("targetIndustries", value, 3, "targetIndustriesOther")}
                  otherValue={formData.targetIndustriesOther}
                  onOtherChange={(value) => updateField("targetIndustriesOther", value)}
                  limit={3}
                  onInfoClick={() => setInfoModalData(HELPER_COPY.q8)}
                  isOpen={openQuestions.includes(8)}
                  onClick={() => handleQuestionClick(8)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("8")} compact />
              </div>
            </div>

            <div ref={el => questionRefs.current[9] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <NumericRangeQuestion
                  questionNumber={9}
                  title="What is the typical size of your client companies?"
                  hint="Enter the range of employee count"
                  value={formData.clientSize}
                  minValue={1}
                  maxValue={50}
                  onChange={(value) => updateField("clientSize", value)}
                  onInfoClick={() => setInfoModalData(HELPER_COPY.q9)}
                  isOpen={openQuestions.includes(9)}
                  onClick={() => handleQuestionClick(9)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("9")} compact />
              </div>
            </div>

            <div ref={el => questionRefs.current[10] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <CheckboxQuestion
                  questionNumber={10}
                  title="What are the main IT challenges your clients come to you for help with?"
                  hint="Select up to three."
                  options={[
                    "Frequent downtime or slow networks",
                    "Cybersecurity concerns or breaches",
                    "Compliance and data protection needs",
                    "Lack of internal IT expertise",
                    "Unreliable backups or disaster recovery",
                    "Difficulty scaling with growth",
                    "Outdated or inefficient systems"
                  ]}
                  selected={formData.clientChallenges}
                  onToggle={(value) => updateArrayField("clientChallenges", value, 3, "clientChallengesOther")}
                  otherValue={formData.clientChallengesOther}
                  onOtherChange={(value) => updateField("clientChallengesOther", value)}
                  limit={3}
                  onInfoClick={() => setInfoModalData(HELPER_COPY.q10)}
                  isOpen={openQuestions.includes(10)}
                  onClick={() => handleQuestionClick(10)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("10")} compact />
              </div>
            </div>

            <div ref={el => questionRefs.current[11] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <CheckboxQuestion
                  questionNumber={11}
                  title="What outcomes do your clients want most from working with you?"
                  hint="Select up to two."
                  options={[
                    "Faster response and resolution",
                    "Peace of mind about security",
                    "Predictable monthly IT costs",
                    "Strategic technology guidance",
                    "Compliance confidence",
                    "Fewer day-to-day IT problems"
                  ]}
                  selected={formData.clientOutcomes}
                  onToggle={(value) => updateArrayField("clientOutcomes", value, 2, "clientOutcomesOther")}
                  otherValue={formData.clientOutcomesOther}
                  onOtherChange={(value) => updateField("clientOutcomesOther", value)}
                  limit={2}
                  onInfoClick={() => setInfoModalData(HELPER_COPY.q11)}
                  isOpen={openQuestions.includes(11)}
                  onClick={() => handleQuestionClick(11)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("11")} compact />
              </div>
            </div>

            <div ref={el => questionRefs.current[12] = el}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <TextAreaQuestion
                 questionNumber={12}
                 title="Briefly describe your ideal client."
                 hint="Include who they are, the problems they're facing, and why they value your partnership."
                 value={formData.idealClient}
                 onChange={(value) => updateField("idealClient", value)}
                 minLength={0}
                 onInfoClick={() => setInfoModalData(HELPER_COPY.q12)}
                 isOpen={openQuestions.includes(12)}
                 onClick={() => handleQuestionClick(12)}
                />
                <QuestionValidationBadge status={getQuestionDisplayStatus("12")} compact />
                </div>
                <RecoverLastAnswerNotice
                field="idealClient"
                entry={answerHistory.getRecoverable("idealClient", formData.idealClient)}
                onRestore={(field, value) => { answerHistory.restoreField(field, value); updateField(field, value); }}
                onDismiss={answerHistory.dismissField}
                />

                {/* Validation controls for idealClient */}
              {openQuestions.includes(12) && (
                <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleValidateTextField("idealClient")}
                      disabled={textValidation.isFieldValidating("idealClient")}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      {textValidation.isFieldValidating("idealClient") ? "Validating..." : "Validate Answer"}
                    </button>
                    <span className="text-xs text-slate-500">Optional check only. Any non-empty answer can continue and submit.</span>
                    <button
                      type="button"
                      onClick={() => setShowValidationGuide(true)}
                      className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      What does this mean?
                    </button>
                  </div>
                  
                  {(() => {
                    const status = textValidation.getFieldStatus("idealClient");
                    if (status.status === 'unknown') return null;
                    
                    const statusConfig = {
                      complete: { color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', label: 'Looks complete' },
                      needs_work: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Could use a little more detail' },
                      incomplete: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Optional suggestion' },
                      dirty: { color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200', label: 'Edited since last validation' },
                      error: { color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200', label: 'Validation unavailable right now' },
                    };
                    
                    const config = statusConfig[status.status] || statusConfig.error;
                    
                    return (
                      <div className={`p-3 rounded-lg border ${config.bg} ${config.border}`}>
                        <p className={`text-sm font-semibold ${config.color}`}>{config.label}</p>
                        {status.message && status.status !== 'dirty' && (
                          <p className="text-xs text-slate-600 mt-1">{status.message}</p>
                        )}
                        {status.suggestions?.length > 0 && status.status !== 'dirty' && (
                          <ul className="mt-2 space-y-1">
                            {status.suggestions.map((suggestion, idx) => (
                              <li key={idx} className="text-xs text-slate-600 flex items-start gap-2">
                                <span className="text-slate-400">•</span>
                                <span>{suggestion}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {(status.status === 'needs_work' || status.status === 'incomplete') && (
                          <p className="text-xs text-slate-600 mt-2">You may submit this answer as-is or add more specific clients, services, outcomes, or business problems.</p>
                        )}
                        {status.status === 'dirty' && (
                          <p className="text-xs text-slate-600 mt-2">You can submit now or run the optional check again.</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </section>

          {/* Recovery card — shown when submit fails, answers remain intact */}
          {lastSubmitContext && (
            <SubmitRecoveryCard
              context={lastSubmitContext}
              isRetrying={isRetryingSubmit}
              onRetry={handleRetrySubmit}
              onDismiss={() => setLastSubmitContext(null)}
            />
          )}

          <div className="flex gap-4 pt-8 border-t" style={{ borderColor: '#009ADD' }}>
            <button
              type="submit"
              className="flex-1 hover:opacity-90 text-white font-bold transition-all tracking-wider uppercase"
              style={{
                backgroundColor: isFormValid() ? '#8DC641' : '#7D868D',
                borderRadius: '2px',
                height: '48px',
                letterSpacing: '0.8px',
                fontSize: '18px',
                fontFamily: 'Lato, sans-serif',
                cursor: isFormValid() ? 'pointer' : 'not-allowed',
                opacity: isFormValid() ? 1 : 0.7
              }}
              title={!isFormValid() ? 'Complete the highlighted questions before submitting.' : ''}
            >
              Submit Questionnaire
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-6 font-bold hover:opacity-90 transition-all tracking-wider uppercase"
              style={{
                border: '2px solid #004B87',
                color: '#004B87',
                borderRadius: '2px',
                height: '48px',
                letterSpacing: '0.8px',
                fontSize: '18px',
                fontFamily: 'Lato, sans-serif'
              }}
            >
              Clear All Answers
            </button>
          </div>

          <p className="text-xs text-slate-500 mt-3">
            This clears the answers shown in the form, but does not delete server-side recovery records.
          </p>

          {/* Show incomplete questions only after submit attempt */}
          {submitAttemptedWithIncomplete && (
            <div className="mt-8">
              <IncompleteQuestionSummary
                summary={incompleteSummary}
                onGoToQuestion={goToQuestion}
                onOpenValidationGuide={() => setShowValidationGuide(true)}
                compact={false}
              />
            </div>
          )}

          {/* Local state recovery option */}
          <div className="pt-6 border-t mt-8" style={{ borderColor: '#E0E0E0' }}>
            <button
              type="button"
              onClick={handleLocalStateRecovery}
              className="text-sm text-slate-500 hover:text-red-600 transition-colors underline underline-offset-2"
            >
              Having trouble? Reset saved browser data
            </button>
            <p className="text-xs text-slate-400 mt-2">
              Use this only if the form appears stuck or old browser data will not clear.
            </p>
          </div>
        </form>

        <div className="mt-16 rounded-xl p-6" style={{ backgroundColor: '#E6F4FF', border: '1px solid #009ADD' }}>
          <h3 className="font-semibold mb-2" style={{ color: '#004B87', fontFamily: 'Raleway, sans-serif' }}>💾 Auto-Save</h3>
          <p className="text-sm" style={{ color: '#3D5A73', fontFamily: 'Lato, sans-serif' }}>
            A few seconds after each answer changes, it is backed up to your secure server draft. Keep this page bookmarked or return through your browser history to restore those answers even if this browser's saved data is cleared.
          </p>
        </div>
      </main>

      <footer className="border-t bg-white mt-16" style={{ borderColor: '#009ADD' }}>
        <div className="max-w-4xl mx-auto px-6 py-8 text-center text-sm" style={{ color: '#7D868D', fontFamily: 'Lato, sans-serif' }}>
          <p>© 2025 Kaseya Limited. Express Website Questionnaire.</p>
        </div>
      </footer>

      {infoModalData && (
        <InfoModal
          data={infoModalData}
          onClose={() => setInfoModalData(null)}
        />
      )}

      {showConfirmModal && (
        <ConfirmModal
          formData={formData}
          onConfirm={handleConfirmSubmit}
          onCancel={() => !isSubmitting && setShowConfirmModal(false)}
          initialBusinessName={initialBusinessName}
          initialDomain={initialDomain}
          isSubmitting={isSubmitting}
          isSubmitValidatingText={isSubmitValidatingText}
          submitValidationIssues={submitValidationIssues}
          submitValidationWarnings={submitValidationWarnings}
          submitError={submitError}
          recoveryCode={recoveryCode}
          submitAttemptId={activeSubmitAttemptIdRef.current}
          localRecoveryBackupId={localRecoveryBackupId}
          latestLocalRecoveryBackup={latestLocalRecoveryBackup}
          onOpenValidationGuide={() => setShowValidationGuide(true)}
        />
      )}

      {showThankYouModal && submittedData && (
        <ThankYouModal
          businessName={submittedData.businessName}
          domain={submittedData.domain}
          formData={submittedData.formData}
        />
      )}

      <ValidationGuideModal
        isOpen={showValidationGuide}
        onClose={() => setShowValidationGuide(false)}
      />

      <DestructiveActionConfirmModal
        isOpen={showClearAllConfirm}
        title="Clear all questionnaire answers?"
        description="This will clear the answers currently shown in this browser. Server-side recovery records and local failed-submission backups will not be deleted."
        confirmLabel="Clear All Answers"
        cancelLabel="Keep Answers"
        onConfirm={performClearAllAnswers}
        onCancel={() => setShowClearAllConfirm(false)}
        isWorking={isClearingAll}
        requireTypedConfirmation={false}
      />

      <Toaster richColors position="top-center" />
    </div>
    </>
  );
}
