import React, { useEffect } from "react";
import { X, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";

export default function ConfirmModal({ formData, onConfirm, onCancel }) {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") onCancel();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [onCancel]);

  const formatAnswer = (value) => {
    if (Array.isArray(value)) {
      return value.length > 0 ? value.join(", ") : "Not answered";
    }
    if (typeof value === "object" && value !== null) {
      return value.label || "Not answered";
    }
    return value || "Not answered";
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
            onClick={onConfirm}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
          >
            <CheckCircle className="w-5 h-5" />
            Confirm & Submit
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