import React, { useEffect, useState } from "react";
import { X, CheckCircle, AlertCircle, Download, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { generatePDF } from "./PDFGenerator";

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

export default function ConfirmModal({ formData, onConfirm, onCancel, initialBusinessName, initialDomain, isSubmitting = false }) {
  const [businessName, setBusinessName] = useState(capitalizeBusinessName(initialBusinessName || ""));
  const [domain, setDomain] = useState(initialDomain || "");
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

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
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').trim();
  };

  const isFormValid = businessName.trim().length > 0 && domain.trim().length > 0;

  const handleConfirm = () => {
    if (isFormValid) {
      onConfirm(businessName, cleanDomain(domain));
    }
  };

  const handleDownloadPDF = async () => {
    if (!businessName.trim()) {
      toast.error("Please enter a business name before downloading.");
      return;
    }
    setIsGeneratingPDF(true);
    try {
      const result = await generatePDF(formData, businessName.trim(), cleanDomain(domain));
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

  const sections = [
    {
      title: "Section 1: About Your Business",
      questions: [
        {
          number: 1,
          question: "What type of IT company are you?",
          answer: formatAnswer(formData.itCompanyType),
          other: formData.itCompanyTypeOther
        },
        {
          number: 2,
          question: "What are your primary service offerings?",
          answer: formatAnswer(formData.serviceOfferings),
          other: formData.serviceOfferingsOther
        },
        {
          number: 3,
          question: "What makes your company different from other MSPs in your area?",
          answer: formData.differentiation || "Not answered"
        },
        {
          number: 4,
          question: "What geographic area do you primarily serve?",
          answer: formData.geographicAreaMeta?.label || formData.geographicAreas || "Not answered"
        },
        {
          number: 5,
          question: "How do you typically price or package your services?",
          answer: formData.pricingPackaging || "Not answered",
          other: formData.pricingPackagingOther
        },
        {
          number: 6,
          question: "What are your company's biggest goals over the next year?",
          answer: formatAnswer(formData.companyGoals),
          other: formData.companyGoalsOther
        },
        {
          number: 7,
          question: "What tone best describes how you want your brand to sound on your website?",
          answer: formData.brandTone || "Not answered",
          other: formData.brandToneOther
        }
      ]
    },
    {
      title: "Section 2: About Your Target Clients",
      questions: [
        {
          number: 8,
          question: "What types of businesses do you primarily serve?",
          answer: formatAnswer(formData.targetIndustries),
          other: formData.targetIndustriesOther
        },
        {
          number: 9,
          question: "What is the typical size of your client companies?",
          answer: formData.clientSize || "Not answered"
        },
        {
          number: 10,
          question: "What are the main IT challenges your clients come to you for help with?",
          answer: formatAnswer(formData.clientChallenges),
          other: formData.clientChallengesOther
        },
        {
          number: 11,
          question: "What outcomes do your clients want most from working with you?",
          answer: formatAnswer(formData.clientOutcomes),
          other: formData.clientOutcomesOther
        },
        {
          number: 12,
          question: "If you could describe your ideal client in one sentence, what would you say?",
          answer: formData.idealClient || "Not answered"
        }
      ]
    }
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
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
            onClick={onCancel}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
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
            <p className="text-sm text-blue-800">Please confirm or enter your business information below (required)</p>
            
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
                  className="w-full p-3 border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">Any format accepted — we'll clean it up automatically.</p>
              </div>
            </div>

            {!isFormValid && (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <AlertCircle className="w-4 h-4" />
                <span>
                  {businessName.trim().length === 0 && domain.trim().length === 0
                    ? 'Both business name and domain are required to submit'
                    : businessName.trim().length === 0
                    ? 'Business name is required to submit'
                    : 'Domain is required to submit'}
                </span>
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

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 p-6 flex gap-3">
          <button
            onClick={handleConfirm}
            disabled={!isFormValid || isGeneratingPDF}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
          >
            <CheckCircle className="w-5 h-5" />
            Confirm & Submit
          </button>
          <button
            onClick={handleDownloadPDF}
            disabled={isGeneratingPDF}
            type="button"
            className="px-6 py-3 border-2 border-blue-400 hover:border-blue-500 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed text-blue-700 font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
          >
            {isGeneratingPDF ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Generating...</>
            ) : (
              <><Download className="w-4 h-4" />Download PDF</>
            )}
          </button>
          <button
            onClick={onCancel}
            className="px-6 py-3 border-2 border-slate-300 hover:border-slate-400 text-slate-700 font-semibold rounded-xl transition-all duration-200"
          >
            Go Back & Edit
          </button>
        </div>
      </motion.div>
    </div>
  );
}