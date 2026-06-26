import React, { useEffect, useState } from "react";
import { X, CheckCircle, AlertCircle, Download, Loader2, Copy } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { generatePDF } from "./PDFGenerator";
import { normalizeExpressFormData } from "@/lib/expressQuestionnairePayload";

const capitalizeBusinessName = (name) => {
  return name
    .split(/\s+/)
    .map(word => {
      if (word.toLowerCase() === 'it') {
        return 'IT';
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
};

export default function ConfirmModal({ 
  formData, 
  onConfirm, 
  onCancel, 
  initialBusinessName, 
  initialDomain, 
  isSubmitting = false, 
  isSubmitValidatingText = false,
  submitError = null, 
  recoveryCode = "",
  submitAttemptId = "",
  localRecoveryBackupId = "",
  latestLocalRecoveryBackup = null,
  submitValidationIssues = [],
  submitValidationWarnings = [],
  onOpenValidationGuide
}) {
  // Normalize formData to prevent crashes from malformed state
  const normalizedFormData = normalizeExpressFormData(formData || {});
  
  const [businessName, setBusinessName] = useState(capitalizeBusinessName(initialBusinessName || ""));
  // Domain is always blank — never prefilled from URL params
  const [domain, setDomain] = useState("");
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isCopyingRecovery, setIsCopyingRecovery] = useState(false);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && !isSubmitting) onCancel();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [onCancel, isSubmitting]);

  // Prevent backdrop click during submit
  const handleBackdropClick = isSubmitting ? undefined : onCancel;

  const formatAnswer = (value) => {
    if (Array.isArray(value)) {
      return value.length > 0 ? value.join(", ") : "Not answered";
    }
    if (typeof value === "object" && value !== null) {
      return value.label || "Not answered";
    }
    return value || "Not answered";
  };

  const cleanDomain = (raw) => {
    if (!raw || !raw.trim()) return "";
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').trim();
  };

  // Validate that the input looks like a domain (accepts example.com, www.example.com,
  // https://example.com, sub.example.com, etc.)
  const isValidDomain = (raw) => {
    const cleaned = cleanDomain(raw);
    if (!cleaned) return false;
    if (!cleaned.includes('.')) return false;
    if (/\s/.test(cleaned)) return false;
    if (!/^[a-zA-Z0-9.-]+$/.test(cleaned)) return false;
    const parts = cleaned.split('.');
    if (parts.length < 2) return false;
    const lastPart = parts[parts.length - 1];
    if (!lastPart || lastPart.length < 2) return false;
    return true;
  };

  const domainValid = isValidDomain(domain);

  // Both business name and domain are required to submit
  const isFormValid = businessName.trim().length > 0 && domainValid;

  const handleConfirm = () => {
    if (isFormValid) {
      onConfirm(businessName, cleanDomain(domain));
    }
  };

  const handleDownloadPDF = async () => {
    if (!businessName.trim() || !domainValid) {
      toast.error("Please enter your business name and website domain before downloading.");
      return;
    }
    setIsGeneratingPDF(true);
    try {
      const result = await generatePDF(normalizedFormData, businessName.trim(), cleanDomain(domain));
      if (result?.success) {
        toast.success(`PDF downloaded: ${result.filename}`);
      } else {
        toast.error("Failed to generate PDF. Please try again.");
      }
    } catch {
      toast.error("Failed to generate PDF. Please try again.");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleCopyRecoveryDetails = async () => {
    if (isCopyingRecovery) return;
    
    setIsCopyingRecovery(true);
    try {
      const errorMessage = submitError?.message || submitError?.error?.message || "Submission failed";
      
      const recoveryBundle = {
        recovery_code: recoveryCode || "",
        submit_attempt_id: submitAttemptId || "",
        local_backup_id: localRecoveryBackupId || "",
        business_name: businessName.trim(),
        domain: cleanDomain(domain),
        error_message: typeof errorMessage === "string" ? errorMessage : JSON.stringify(errorMessage),
        backup_created_at: latestLocalRecoveryBackup?.created_at || "",
        backup_stage: latestLocalRecoveryBackup?.stage || "",
        support_note: "Use the recovery code to search Express FormDraft, FormDraftEvent, or FormSubmissionIntake admin tools."
      };

      const bundleText = JSON.stringify(recoveryBundle, null, 2);
      await navigator.clipboard.writeText(bundleText);
      toast.success("Recovery details copied");
    } catch (err) {
      console.error("[recovery-copy] failed:", err);
      toast.error("Could not copy recovery details");
    } finally {
      setIsCopyingRecovery(false);
    }
  };

  const sections = [
    {
      title: "Section 1: About Your Business",
      questions: [
        {
          number: 1,
          question: "What type of IT company are you?",
          answer: formatAnswer(normalizedFormData.itCompanyType),
          other: normalizedFormData.itCompanyTypeOther
        },
        {
          number: 2,
          question: "What are your primary service offerings?",
          answer: formatAnswer(normalizedFormData.serviceOfferings),
          other: normalizedFormData.serviceOfferingsOther
        },
        {
          number: 3,
          question: "What makes your company different from other MSPs in your area?",
          answer: normalizedFormData.differentiation || "Not answered"
        },
        {
          number: 4,
          question: "What geographic area do you primarily serve?",
          answer: normalizedFormData.geographicAreaMeta?.label || normalizedFormData.geographicAreas || "Not answered"
        },
        {
          number: 5,
          question: "How do you typically price or package your services?",
          answer: normalizedFormData.pricingPackaging || "Not answered",
          other: normalizedFormData.pricingPackagingOther
        },
        {
          number: 6,
          question: "What are your company's biggest goals over the next year?",
          answer: formatAnswer(normalizedFormData.companyGoals),
          other: normalizedFormData.companyGoalsOther
        },
        {
          number: 7,
          question: "What tone best describes how you want your brand to sound on your website?",
          answer: normalizedFormData.brandTone || "Not answered",
          other: normalizedFormData.brandToneOther
        }
      ]
    },
    {
      title: "Section 2: About Your Target Clients",
      questions: [
        {
          number: 8,
          question: "What types of businesses do you primarily serve?",
          answer: formatAnswer(normalizedFormData.targetIndustries),
          other: normalizedFormData.targetIndustriesOther
        },
        {
          number: 9,
          question: "What is the typical size of your client companies?",
          answer: normalizedFormData.clientSize || "Not answered"
        },
        {
          number: 10,
          question: "What are the main IT challenges your clients come to you for help with?",
          answer: formatAnswer(normalizedFormData.clientChallenges),
          other: normalizedFormData.clientChallengesOther
        },
        {
          number: 11,
          question: "What outcomes do your clients want most from working with you?",
          answer: formatAnswer(normalizedFormData.clientOutcomes),
          other: normalizedFormData.clientOutcomesOther
        },
        {
          number: 12,
          question: "If you could describe your ideal client in one sentence, what would you say?",
          answer: normalizedFormData.idealClient || "Not answered"
        }
      ]
    }
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 p-6 flex items-center justify-between z-10">
          <div>
            <h3 className="text-2xl font-bold text-slate-900">Review Your Answers</h3>
            <p className="text-slate-600 text-sm mt-1">Please review your responses before submitting</p>
          </div>
          <button
            type="button"
            onClick={isSubmitting ? undefined : onCancel}
            disabled={isSubmitting}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-8">
          {/* Business Details Section */}
          <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6 space-y-4">
            <h4 className="text-lg font-bold text-blue-900 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Verify Your Business Details
            </h4>
            <p className="text-sm text-blue-800">Please confirm or enter your business name below</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  Business Name *
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Enter your business name"
                  className="w-full p-3 border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  Website Domain *
                </label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="example.com or https://www.example.com"
                  className={`w-full p-3 border-2 rounded-lg focus:outline-none focus:ring-2 focus:border-transparent ${
                    domain.trim().length > 0 && !domainValid
                      ? 'border-amber-400 focus:ring-amber-500'
                      : 'border-slate-300 focus:ring-blue-500'
                  }`}
                  required
                />
                <p className="text-xs text-slate-500 mt-1">Enter your primary website domain (e.g. example.com).</p>
                {domain.trim().length > 0 && !domainValid && (
                  <p className="text-xs text-amber-700 mt-1">
                    Please enter a valid domain (e.g. example.com, www.example.com, or https://example.com).
                  </p>
                )}
              </div>
            </div>

            {!isFormValid && (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <AlertCircle className="w-4 h-4" />
                <span>Business name and website domain are both required to submit.</span>
              </div>
            )}
          </div>

          {/* Questionnaire Answers */}
          {sections.map((section, sectionIdx) => (
            <div key={sectionIdx} className="space-y-6">
              <h4 className="text-lg font-bold text-slate-900 border-b-2 border-slate-200 pb-2">
                {section.title}
              </h4>
              
              {section.questions.map((q) => (
                <div key={q.number} className="space-y-2">
                  <div className="font-semibold text-slate-900">
                    {q.number}. {q.question}
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <div className="text-slate-700 whitespace-pre-wrap">
                      {q.answer}
                    </div>
                    {q.other && q.other.trim().length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-300">
                        <span className="text-slate-600 text-sm font-medium">Other: </span>
                        <span className="text-slate-700">{q.other}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Submit-time text validation issues (blocking) */}
        {submitValidationIssues.length > 0 && (
          <div className="mx-6 mb-4 p-4 bg-red-50 border-2 border-red-200 rounded-xl space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800 mb-1">
                  A few answers need more detail before submitting
                </p>
                <p className="text-xs text-red-700 mb-3">
                  These answers need a little more detail before we can submit the questionnaire.
                </p>
                <div className="space-y-2 mt-3">
                  {submitValidationIssues.map((issue, idx) => (
                    <div key={idx} className="bg-red-100 border border-red-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-red-900">
                        Question {issue.fieldName === "differentiation" ? "3" : "12"}: {issue.fieldName === "differentiation" ? "What makes your company different?" : "Describe your ideal client"}
                      </p>
                      <p className="text-xs text-red-800 mt-1">{issue.message}</p>
                      {issue.suggestions?.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {issue.suggestions.map((suggestion, sIdx) => (
                            <li key={sIdx} className="text-xs text-red-700 flex items-start gap-2">
                              <span className="text-red-400">•</span>
                              <span>{suggestion}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-red-700 italic">
                    Use the Go Back button to update these answers, then return to submit again.
                  </p>
                  {typeof onOpenValidationGuide === 'function' && (
                    <button
                      type="button"
                      onClick={onOpenValidationGuide}
                      className="text-xs text-red-700 hover:text-red-900 hover:underline font-semibold"
                    >
                      Open Answer Quality Guide
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Submit-time text validation warnings (non-blocking) */}
        {submitValidationWarnings.length > 0 && (
          <div className="mx-6 mb-4 p-4 bg-amber-50 border-2 border-amber-200 rounded-xl space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800 mb-1">
                  Optional improvements
                </p>
                <p className="text-xs text-amber-700 mb-3">
                  These suggestions are optional, but improving them may help the team use your answers more effectively.
                </p>
                <div className="space-y-2 mt-3">
                  {submitValidationWarnings.map((warning, idx) => (
                    <div key={idx} className="bg-amber-100 border border-amber-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-amber-900">
                        Question {warning.fieldName === "differentiation" ? "3" : "12"}: {warning.fieldName === "differentiation" ? "What makes your company different?" : "Describe your ideal client"}
                      </p>
                      <p className="text-xs text-amber-800 mt-1">{warning.message}</p>
                      {warning.suggestions?.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {warning.suggestions.map((suggestion, sIdx) => (
                            <li key={sIdx} className="text-xs text-amber-700 flex items-start gap-2">
                              <span className="text-amber-400">•</span>
                              <span>{suggestion}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
                {typeof onOpenValidationGuide === 'function' && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={onOpenValidationGuide}
                      className="text-xs text-amber-700 hover:text-amber-900 hover:underline font-semibold"
                    >
                      Open Answer Quality Guide
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error display */}
        {submitError && (
          <div className="mx-6 mb-4 p-4 bg-red-50 border-2 border-red-200 rounded-xl space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800 mb-1">
                  We saved your progress, but final submission could not complete. Please try again.
                </p>
                {recoveryCode && (
                  <p className="text-xs text-red-700 font-mono bg-red-100 inline-block px-2 py-1 rounded">
                    Recovery code: {recoveryCode}
                  </p>
                )}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-800 mb-2">
                If this keeps happening, copy these recovery details and send them to support.
              </p>
              <button
                type="button"
                onClick={handleCopyRecoveryDetails}
                disabled={isCopyingRecovery}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 bg-amber-100 hover:bg-amber-200 disabled:bg-amber-50 text-amber-900 text-sm font-semibold rounded-lg transition-colors"
              >
                {isCopyingRecovery ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Copying...</>
                ) : (
                  <><Copy className="w-4 h-4" />Copy Recovery Details</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isFormValid || isSubmitting || isSubmitValidatingText || isGeneratingPDF || submitValidationIssues.length > 0}
            className="flex-1 min-w-[140px] bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
          >
            {isSubmitValidatingText ? (
              <><Loader2 className="w-5 h-5 animate-spin" />Checking answers...</>
            ) : isSubmitting ? (
              <><Loader2 className="w-5 h-5 animate-spin" />Submitting...</>
            ) : (
              <><CheckCircle className="w-5 h-5" />Confirm &amp; Submit</>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownloadPDF}
            disabled={isGeneratingPDF || isSubmitting}
            className="min-w-[140px] px-6 py-3 border-2 border-blue-400 hover:border-blue-500 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed text-blue-700 font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
          >
            {isGeneratingPDF ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Generating...</>
            ) : (
              <><Download className="w-4 h-4" />Download PDF</>
            )}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="min-w-[120px] px-6 py-3 border-2 border-slate-300 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 font-semibold rounded-xl transition-all duration-200"
          >
            Go Back
          </button>
        </div>
      </motion.div>
    </div>
  );
}