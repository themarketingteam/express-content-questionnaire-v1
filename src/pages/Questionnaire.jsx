import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { getOrCreateQuestionnaireSessionId, clearQuestionnaireSessionId } from "@/lib/sessionId";
import { getInitialExpressFormData, serializeExpressError } from "@/lib/expressQuestionnairePayload";
import { EXPRESS_COOKIE_KEY, parsePersistedStateCookie, buildPersistedState, serializePersistedState, getDefaultExpandedQuestions } from "@/lib/expressPersistedState";
import { buildDraftEventRecord } from "@/lib/draftEvents";
import {
  createFindExistingDraftBySessionId,
  createSaveDraftSnapshot,
  writeDraftFailureBackup,
} from "@/lib/draftPersistence";
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
import QuestionnaireErrorBoundary from "../components/questionnaire/QuestionnaireErrorBoundary";
import { Save, Info } from "lucide-react";
import { Toaster, toast } from "sonner";

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

const HELPER_COPY = {
  q1: {
    title: "What type of IT company are you?",
    why: "This helps us align your site to your operating model. A Managed Services Provider markets differently than a Cloud Hosting Provider or a Cybersecurity Specialist. Matching your model ensures the right language, examples, and CTAs that attract the right clients.",
    guidance: "Pick up to three that describe your business today (not future plans). If you don't see a perfect fit, choose the closest items and use 'Other' to clarify briefly.",
    type: "checkbox",
    examples: {
      selections: ["Managed Services Provider (MSP)", "Cybersecurity Provider", "Co-Managed IT Partner"],
      mixed: ["Managed Services Provider (MSP)", "Co-Managed IT Partner"],
      other: "IT Staff Augmentation and Fractional IT Management",
      shortAnswer: ""
    }
  },
  q2: {
    title: "What are your primary service offerings?",
    why: "Your service focus drives navigation, page structure, and SEO priorities. Choosing your top services ensures the site showcases what you most want to sell, not just a generic list.",
    guidance: "Select up to three of your strongest or most profitable services. If unlisted, use 'Other' with the label you use in sales calls.",
    type: "checkbox",
    examples: {
      selections: ["Managed IT Services", "Microsoft 365 Services", "Security Awareness Training"],
      mixed: ["Managed IT Services", "Cybersecurity Services", "Data Backup & Recovery"],
      other: "Fractional vCISO Support and Compliance Consulting",
      shortAnswer: ""
    }
  },
  q3: {
    title: "What makes your company different from other MSPs in your area?",
    why: "This is your unique selling proposition (USP). Prospects compare providers; we'll use this answer for headlines, hero copy, and proof points that make you memorable.",
    guidance: "Write 2–3 sentences focusing on outcomes, responsiveness, specialization, or experience. Avoid vague claims—back them up with something measurable or tangible.",
    type: "short",
    examples: {
      selections: [],
      mixed: [],
      other: "",
      shortAnswer: "We're a locally owned MSP with a live-help desk and an average 10-minute response time. Clients stay with us because we explain issues in plain English and include proactive security-by-default—patching, backups, and 24/7 monitoring—without surprise fees."
    }
  },
  q4: {
    title: "What is your primary city of service or geological region of service?",
    why: "Your service region shapes local SEO and credibility. Listing a specific city or county helps nearby businesses find you and signals that you're truly local to the area.",
    guidance: "We recommend selecting a specific city or town for best results. If you serve a broader area, you may select a county or region. State and country selections are less effective for local SEO. Choose a validated option from the dropdown list.",
    type: "short",
    examples: {
      selections: [],
      mixed: [],
      other: "",
      shortAnswer: "Nashville, Tennessee or Davidson County, Tennessee"
    }
  },
  q5: {
    title: "How do you typically price or package your services?",
    why: "Clarity on pricing models helps us set accurate expectations on your site. Flat-rate MSPs should sound predictable; project-based firms should sound flexible.",
    guidance: "Pick the model you use most. If you mix models, choose the most common and add any nuance under 'Other'.",
    type: "multiple",
    examples: {
      selections: ["Flat-rate monthly (fully managed)", "Hourly or project-based", "Hybrid"],
      mixed: ["Flat-rate monthly (fully managed)", "Hybrid"],
      other: "Flat monthly plan for SMBs with hourly options for specialized projects",
      shortAnswer: ""
    }
  },
  q6: {
    title: "What are your company's biggest goals over the next year?",
    why: "Your goals guide UX, copy, and CTA strategy. If you want leads, we optimize for conversions; if rebranding or recruiting, we emphasize tone and credibility.",
    guidance: "Select up to three priorities that truly reflect your next 12 months. We'll align page structure and messaging to support those outcomes.",
    type: "checkbox",
    examples: {
      selections: ["Acquire more clients", "Improve recurring revenue", "Expand into new markets"],
      mixed: ["Acquire more clients", "Strengthen cybersecurity offering", "Rebrand / modernize web presence"],
      other: "Launch a managed cloud division targeting medical practices",
      shortAnswer: ""
    }
  },
  q7: {
    title: "What tone best describes how you want your brand to sound on your website?",
    why: "Tone shapes how prospects feel about you. Technical signals expertise; friendly signals approachability; bold can drive action. We'll match content to your voice.",
    guidance: "Pick the tone that matches how you talk to clients today. Use 'Other' if you want a blended voice (e.g., friendly but evidence-led).",
    type: "multiple",
    examples: {
      selections: ["Technical and expert-driven", "Friendly and approachable", "Bold and confident"],
      mixed: ["Friendly and approachable", "Technical and expert-driven"],
      other: "Down-to-earth and educational—plain English with evidence",
      shortAnswer: ""
    }
  },
  q8: {
    title: "What types of businesses do you primarily serve?",
    why: "Industry targeting improves relevance and conversion. Healthcare, legal, and manufacturing audiences need different language, visuals, and compliance cues.",
    guidance: "Check the industries you actively serve. If you have a niche that isn't listed, use 'Other' and name it clearly.",
    type: "checkbox",
    examples: {
      selections: ["Healthcare / Medical", "Financial / Accounting / CPA", "Manufacturing / Construction"],
      mixed: ["Legal Firms", "Nonprofits / Education", "Professional Services (Marketing, Real Estate, etc.)"],
      other: "Architecture & Engineering Firms",
      shortAnswer: ""
    }
  },
  q9: {
    title: "What is the typical size of your client companies?",
    why: "Company size affects needs and budgets. This helps us address the right buyers (owners vs. IT directors) and frame the value you deliver.",
    guidance: "Pick the range that best matches your average client. If many are larger than 100+ employees, choose the corresponding bracket.",
    type: "multiple",
    examples: {
      selections: ["1–25 employees", "26–50 employees", "51–100 employees", "100–250 employees", "250+ employees"],
      mixed: ["51–100 employees", "100–250 employees"],
      other: "",
      shortAnswer: ""
    }
  },
  q10: {
    title: "What are the main IT challenges your clients come to you for help with?",
    why: "Stating real pain points helps visitors feel understood. We'll echo these problems on your homepage and service pages to build trust quickly.",
    guidance: "Choose up to three issues clients mention most often in discovery calls or tickets. Use 'Other' for anything specific to your niche.",
    type: "checkbox",
    examples: {
      selections: ["Cybersecurity concerns or breaches", "Frequent downtime or slow networks", "Unreliable backups or disaster recovery"],
      mixed: ["Compliance and data protection needs", "Difficulty scaling with growth", "Outdated or inefficient systems"],
      other: "Struggling to meet HIPAA or CMMC compliance requirements",
      shortAnswer: ""
    }
  },
  q11: {
    title: "What outcomes do your clients want most from working with you?",
    why: "Benefits sell better than features. We'll highlight outcomes in headlines and case studies to show what clients get—not just what you do.",
    guidance: "Pick up to two results clients consistently achieve with you. Think of what they thank you for after a few months together.",
    type: "checkbox",
    examples: {
      selections: ["Predictable monthly IT costs", "Peace of mind about security", "Fewer day-to-day IT problems"],
      mixed: ["Faster response and resolution", "Strategic technology guidance", "Compliance confidence"],
      other: "Improved internal IT team performance through co-managed support",
      shortAnswer: ""
    }
  },
  q12: {
    title: "Briefly describe your ideal client.",
    why: "This defines who your site should speak to, so you attract more of the right clients. It also helps filter out poor fit leads early.",
    guidance: "Write one sentence that includes size, industry, location, and mindset. Imagine describing your favorite client to a friend.",
    type: "short",
    examples: {
      selections: [],
      mixed: [],
      other: "",
      shortAnswer: "A healthcare or dental practice with 20–100 employees in the Nashville area that values proactive IT management, clear communication, and a long-term partnership."
    }
  }
};

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

  const [showSaveIndicator, setShowSaveIndicator] = useState(false);
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

  // Memoized incomplete question summary
  const incompleteSummary = React.useMemo(() => {
    return buildIncompleteQuestionSummary({
      formData,
      touchedQuestions,
      validationStatus: textValidation.getAllFieldStatuses(),
      validatingFields: textValidation.validatingFields || [],
      isQuestionComplete,
    });
  }, [formData, touchedQuestions, textValidation, isQuestionComplete]);

  // Text validation hook
  const textValidation = useExpressTextValidation();

  const submitInFlightRef = useRef(false);
  const activeSubmitAttemptIdRef = useRef("");

  const questionRefs = useRef({});
  const draftSaveTimeoutRef = useRef(null);
  const draftTextEventTimeoutsRef = useRef({});
  const draftRecordIdRef = useRef("");
  const lastChangedQuestionIdRef = useRef("");
  const hasFinalSubmittedRef = useRef(false);

  const [questionnaireSessionId] = useState(() => getOrCreateQuestionnaireSessionId());

  const urlParams = new URLSearchParams(window.location.search);
  const businessNameParam = urlParams.get("businessName") || "";
  const rawDomain = urlParams.get("domainName") || "";
  const domainParam = rawDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
  const urlCredentials = {
    businessName: businessNameParam,
    domain: domainParam,
    userId: urlParams.get("userId") || "",
    userEmail: urlParams.get("userEmail") || "",
    userName: urlParams.get("userName") || "",
  };

  const findExistingDraftBySessionId = useCallback(
    createFindExistingDraftBySessionId({ draftRecordIdRef }),
    []
  );

  const saveDraftSnapshot = useCallback(
    createSaveDraftSnapshot({ entities: base44.entities, draftRecordIdRef, findExistingDraftBySessionId }),
    [findExistingDraftBySessionId]
  );

  const saveDraftNow = useCallback(async ({
    status,
    submitError,
    finalSubmissionId,
    responsesSnapshot,
    validationStatusSnapshot,
    touchedQuestionsSnapshot,
    expandedQuestionsSnapshot: expandedSnapshotArg,
  } = {}) => {
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
      businessNameParam,
      domainParam,
      currentQuestionId: lastChangedQuestionIdRef.current,
      lastChangedQuestionId: lastChangedQuestionIdRef.current,
      status: status || "draft",
      submitError: submitError || "",
      finalSubmissionId: finalSubmissionId || "",
    });
  }, [saveDraftSnapshot, questionnaireSessionId, formData, touchedQuestions, openQuestions, businessNameParam, domainParam, textValidation]);

  const queueDraftSave = useCallback((changedQuestionId, nextFormData) => {
    if (hasFinalSubmittedRef.current) return;
    lastChangedQuestionIdRef.current = String(changedQuestionId || "");
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
        });
      } catch (err) {
        console.error("[draft] save failed:", err?.message || err);
        writeDraftFailureBackup({
          questionnaireSessionId,
          responses: nextFormData,
          validationStatus: textValidation.getAllFieldStatuses(),
          touchedQuestions,
          expandedQuestions: Object.fromEntries(
            Array.from({ length: 12 }, (_, i) => [String(i + 1), openQuestions.includes(i + 1)])
          ),
          error: err,
        });
      }
    }, 600);
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
    
    const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
    link.type = 'image/png';
    link.rel = 'icon';
    link.href = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6913611c0ea0f6b631343af8/c380ae371_kaseya-logo.png';
    document.head.appendChild(link);
  }, []);



  // Load saved data and validation status
  useEffect(() => {
    const saved = getCookie(STORAGE_KEY);
    const result = parsePersistedStateCookie(saved);
    
    if (result.ok) {
      // Restore form data
      setFormData(prev => ({ ...prev, ...result.state.formData }));
      
      // Restore validation status if available
      if (result.state.validationStatus && typeof result.state.validationStatus === 'object') {
        Object.entries(result.state.validationStatus).forEach(([fieldName, status]) => {
          textValidation.setFieldValidation(fieldName, status);
        });
      }
      
      // Restore touched questions
      if (result.state.touchedQuestions && typeof result.state.touchedQuestions === 'object') {
        setTouchedQuestions(result.state.touchedQuestions);
      }
      
      // Restore expanded questions
      if (result.state.expandedQuestions && typeof result.state.expandedQuestions === 'object') {
        const expandedNums = [];
        for (let i = 1; i <= 12; i++) {
          if (result.state.expandedQuestions[String(i)]) {
            expandedNums.push(i);
          }
        }
        setOpenQuestions(expandedNums.length > 0 ? expandedNums : [1]);
      }
      
      // Log diagnostics in development
      if (import.meta.env.DEV) {
        if (result.migrated) {
          console.log("[persisted-state] Migrated from old format:", result.diagnostics);
        }
        if (result.repaired) {
          console.log("[persisted-state] Repaired invalid fields:", result.diagnostics);
        }
        if (result.discarded) {
          console.warn("[persisted-state] Discarded corrupted state:", result.diagnostics);
        }
      }
    } else if (result.error) {
      if (import.meta.env.DEV) {
        console.warn("[persisted-state] Failed to parse cookie, using defaults:", result.error.message);
      }
    }
    
    // Create draft event for migration/repair/discard if session exists
    if (questionnaireSessionId && (result.migrated || result.repaired || result.discarded)) {
      const eventType = result.migrated ? "persisted_state_migrated"
        : result.repaired ? "persisted_state_repaired"
        : result.discarded ? "persisted_state_discarded"
        : null;
      
      if (eventType) {
        // Best-effort event creation - don't block if it fails
        setTimeout(() => {
          createDraftEvent({
            eventType,
            questionId: "",
            questionType: "persistence",
            value: {
              session_id: questionnaireSessionId,
              ...result.diagnostics,
              timestamp: new Date().toISOString(),
            },
          }).catch(() => {
            // Silently ignore draft event failures
          });
        }, 100);
      }
    }
    
    // If state was discarded and local backup utility exists, write diagnostic
    if (result.discarded && questionnaireSessionId) {
      try {
        localStorage.setItem(
          `express_questionnaire_recovery_${questionnaireSessionId}`,
          JSON.stringify({
            session_id: questionnaireSessionId,
            stage: "persisted_state_discarded",
            reason: "corrupted_json",
            timestamp: new Date().toISOString(),
          })
        );
      } catch {
        // Ignore storage errors
      }
    }
  }, []);

  // Auto-save with validation status
  useEffect(() => {
    if (hasFinalSubmittedRef.current) {
      return;
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
      
      // Save serialized versioned state
      setCookie(STORAGE_KEY, serializePersistedState(persistedState));
      setShowSaveIndicator(true);
      setTimeout(() => setShowSaveIndicator(false), 3000);
    }, 300);

    return () => clearTimeout(saveTimer);
  }, [formData, textValidation, touchedQuestions, openQuestions, questionnaireSessionId]);

  // Save before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Skip autosave after final submission
      if (hasFinalSubmittedRef.current) return;
      
      // Save versioned persisted state
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
      setCookie(STORAGE_KEY, serializePersistedState(persistedState));
      
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
      const next = { ...prev, [field]: value };
      queueDraftSave(questionId, next);
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
      queueDraftSave(questionId, next);
      queueDraftEvent({ eventType: "selection_changed", questionId: qId, questionType: qType, value: next[field] });
      return next;
    });
  }, [queueDraftSave, questionnaireSessionId]);

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
      
      // Save updated validation status to draft
      const updatedValidationStatus = textValidation.getAllFieldStatuses();
      await saveDraftSnapshot({
        sessionId: questionnaireSessionId,
        responses: rawFormData,
        validationStatus: updatedValidationStatus,
        touchedQuestions,
        expandedQuestions: Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [String(i + 1), openQuestions.includes(i + 1)])
        ),
        credentials: urlCredentials,
        businessNameParam,
        domainParam,
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
        validationStatus: {},
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
          
          // Full success: clear cookie, session, reset form
          deleteCookie(STORAGE_KEY);
          clearQuestionnaireSessionId();
          handleReset();
          setShowThankYouModal(true);
        },
        onFinalSubmitFailure: (failureResult) => {
          setSubmitError(failureResult.error);
          setRecoveryCode(failureResult.recoveryCode || questionnaireSessionId);
          
          // Read latest local backup for recovery bundle
          const latestBackup = readLatestLocalFailedSubmissionBackup(questionnaireSessionId);
          if (latestBackup) {
            setLocalRecoveryBackupId(latestBackup.id || "");
            setLatestLocalRecoveryBackup({
              id: latestBackup.id,
              created_at: latestBackup.created_at,
              stage: latestBackup.stage,
              business_name: latestBackup.business_name,
              domain: latestBackup.domain,
            });
          }
        },
      });

      // Success is handled in onFinalSubmitSuccess callback
    } catch (error) {
      // Handle SubmitFlowError or unexpected errors
      const recoveryCodeValue = error.recoveryCode || questionnaireSessionId;
      setSubmitError(error);
      setRecoveryCode(recoveryCodeValue);
      
      // Show user-safe message
      alert(`We saved your progress, but final submission could not complete. Please try again. Recovery code: ${recoveryCodeValue}`);
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
      clearActiveSubmitAttempt(activeSubmitAttemptIdRef.current);
    }
  }, [isSubmitting, formData, touchedQuestions, openQuestions, questionnaireSessionId, urlCredentials, domainParam, saveDraftNow, createDraftEvent]);

  const handleReset = () => {
    setFormData(getInitialExpressFormData());
    setTouchedQuestions({});
    setOpenQuestions([1]);
    textValidation.resetAllFields();
    setSubmitError(null);
    setRecoveryCode("");
  };

  // Get display status for each question
  const getQuestionDisplayStatus = (questionId) => {
    return getExpressQuestionDisplayStatus({
      questionId: String(questionId),
      formData,
      touchedQuestions,
      validationStatus: textValidation.getAllFieldStatuses(),
      validatingFields: textValidation.validatingFields || [],
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

  return (
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
          <AnimatePresence>
            {showSaveIndicator && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-sm"
              >
                <Save className="w-4 h-4 text-green-600" />
                <span className="text-slate-600">Auto-saved</span>
              </motion.div>
            )}
          </AnimatePresence>
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

        {/* Inline incomplete question summary */}
        <div className="mb-8">
          <IncompleteQuestionSummary
            summary={incompleteSummary}
            onGoToQuestion={goToQuestion}
            onOpenValidationGuide={() => setShowValidationGuide(true)}
            compact={!submitAttemptedWithIncomplete}
          />
        </div>

        <form onSubmit={handleSubmit} className="space-y-16">
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
                    <span className="text-xs text-slate-500">This quick check looks for enough useful detail, not perfect wording.</span>
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
                      incomplete: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', label: 'Needs more detail before submission' },
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
                          <p className="text-xs text-slate-600 mt-2">Try adding specific clients, services, outcomes, or business problems.</p>
                        )}
                        {status.status === 'dirty' && (
                          <p className="text-xs text-slate-600 mt-2">You edited this after the last check. Validate again before submitting.</p>
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
                    <span className="text-xs text-slate-500">This quick check looks for enough useful detail, not perfect wording.</span>
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
                      incomplete: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', label: 'Needs more detail before submission' },
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
                          <p className="text-xs text-slate-600 mt-2">Try adding specific clients, services, outcomes, or business problems.</p>
                        )}
                        {status.status === 'dirty' && (
                          <p className="text-xs text-slate-600 mt-2">You edited this after the last check. Validate again before submitting.</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </section>

          <div className="flex gap-4 pt-8 border-t" style={{ borderColor: '#009ADD' }}>
            <button
              type="submit"
              disabled={!isFormValid()}
              className="flex-1 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold transition-all tracking-wider uppercase"
              style={{
                backgroundColor: isFormValid() ? '#8DC641' : '#7D868D',
                borderRadius: '2px',
                height: '48px',
                letterSpacing: '0.8px',
                fontSize: '18px',
                fontFamily: 'Lato, sans-serif'
              }}
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
              Clear All
            </button>
          </div>
        </form>

        <div className="mt-16 rounded-xl p-6" style={{ backgroundColor: '#E6F4FF', border: '1px solid #009ADD' }}>
          <h3 className="font-semibold mb-2" style={{ color: '#004B87', fontFamily: 'Raleway, sans-serif' }}>💾 Auto-Save</h3>
          <p className="text-sm" style={{ color: '#3D5A73', fontFamily: 'Lato, sans-serif' }}>
            Your responses are automatically saved as a secure cookie. Your progress is preserved even if you close this page or return later.
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

      <Toaster richColors position="top-center" />
    </div>
  );
}