import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import CheckboxQuestion from "../components/questionnaire/CheckboxQuestion";
import RadioQuestion from "../components/questionnaire/RadioQuestion";
import TextAreaQuestion from "../components/questionnaire/TextAreaQuestion";
import GeographicQuestion from "../components/questionnaire/GeographicQuestion";
import OtherField from "../components/questionnaire/OtherField";
import InfoModal from "../components/questionnaire/InfoModal";
import ConfirmModal from "../components/questionnaire/ConfirmModal";
import { Save, CheckCircle2 } from "lucide-react";

const STORAGE_KEY = "msp_questionnaire_data_v2";

const QUESTIONS_CONFIG = {
  q1: {
    title: "What type of IT company are you?",
    hint: "Check all that apply. Maximum 3 selections.",
    why: "This helps us align your site to your operating model. A Managed Services Provider markets differently than a Cloud Hosting Provider or a Cybersecurity Specialist.",
    guidance: "Pick up to three that describe your business today (not future plans). If you don't see a perfect fit, choose the closest items and use 'Other' to clarify briefly.",
    examples: {
      selections: ["Managed Services Provider (MSP)", "Cybersecurity Provider", "Co-Managed IT Partner"],
      mixed: ["Managed Services Provider (MSP)", "Co-Managed IT Partner"],
      other: "IT Staff Augmentation and Fractional IT Management"
    }
  },
  q2: {
    title: "What are your primary service offerings?",
    hint: "Select your core services. Maximum 3 selections.",
    why: "Your service focus drives navigation, page structure, and SEO priorities. Choosing your top services ensures the site showcases what you most want to sell.",
    guidance: "Select up to three of your strongest or most profitable services. If unlisted, use 'Other' with the label you use in sales calls.",
    examples: {
      selections: ["Managed IT Services", "Microsoft 365 Services", "Security Awareness Training"],
      mixed: ["Managed IT Services", "Cybersecurity Services", "Data Backup & Recovery"],
      other: "Fractional vCISO Support and Compliance Consulting"
    }
  }
};

export default function Questionnaire() {
  const [formData, setFormData] = useState({
    itCompanyType: [],
    itCompanyTypeOther: "",
    serviceOfferings: [],
    serviceOfferingsOther: "",
    differentiation: "",
    geographicAreas: "",
    geographicAreaMeta: { label: "", lat: null, lon: null, place_id: null, source: "google" },
    pricingPackaging: "",
    pricingPackagingOther: "",
    companyGoals: [],
    companyGoalsOther: "",
    brandTone: "",
    brandToneOther: "",
    targetIndustries: [],
    targetIndustriesOther: "",
    clientSize: "",
    clientChallenges: [],
    clientChallengesOther: "",
    clientOutcomes: [],
    clientOutcomesOther: "",
    idealClient: ""
  });

  const [showSaveIndicator, setShowSaveIndicator] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [infoModalData, setInfoModalData] = useState(null);

  // Load saved data
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setFormData(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error("Failed to parse saved data", e);
      }
    }
  }, []);

  // Auto-save
  useEffect(() => {
    const saveTimer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(formData));
      setShowSaveIndicator(true);
      setTimeout(() => setShowSaveIndicator(false), 3000);
    }, 1000);

    return () => clearTimeout(saveTimer);
  }, [formData]);

  const submitMutation = useMutation({
    mutationFn: async (data) => {
      return base44.entities.FormSubmission.create(data);
    },
    onSuccess: () => {
      setShowSuccess(true);
      localStorage.removeItem(STORAGE_KEY);
      setTimeout(() => {
        setShowSuccess(false);
        handleReset();
      }, 3000);
    }
  });

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateArrayField = (field, value, limit = 3) => {
    setFormData(prev => {
      const current = prev[field] || [];
      const index = current.indexOf(value);
      
      if (index > -1) {
        return { ...prev, [field]: current.filter(v => v !== value) };
      } else {
        if (current.length >= limit) return prev;
        return { ...prev, [field]: [...current, value] };
      }
    });
  };

  const isFormValid = () => {
    const checkboxValid = (field, otherField, limit = 3) => {
      const selected = (formData[field] || []).length;
      const hasOther = (formData[otherField] || "").trim().length > 0;
      return (selected >= 1 && selected <= limit) || (selected >= 0 && selected <= limit - 1 && hasOther);
    };

    const longEnough = (val) => (val || "").trim().length >= 150;

    return checkboxValid("itCompanyType", "itCompanyTypeOther") &&
           checkboxValid("serviceOfferings", "serviceOfferingsOther") &&
           longEnough(formData.differentiation) &&
           (formData.geographicAreaMeta?.label || !formData.geographicAreas) &&
           checkboxValid("companyGoals", "companyGoalsOther") &&
           checkboxValid("targetIndustries", "targetIndustriesOther", 999) &&
           checkboxValid("clientChallenges", "clientChallengesOther") &&
           checkboxValid("clientOutcomes", "clientOutcomesOther") &&
           longEnough(formData.idealClient);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isFormValid()) {
      setShowConfirmModal(true);
    } else {
      alert("Please complete all required fields before submitting.");
    }
  };

  const handleConfirmSubmit = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const businessName = urlParams.get("business_name") || "";

    const payload = {
      business_name: businessName,
      submission_datetime: new Date().toISOString(),
      service_type: "express",
      it_company_type: formData.itCompanyType,
      it_company_type_other: formData.itCompanyTypeOther,
      service_offerings: formData.serviceOfferings,
      service_offerings_other: formData.serviceOfferingsOther,
      differentiation: formData.differentiation,
      geographic_areas: formData.geographicAreaMeta?.label || formData.geographicAreas,
      geographic_area_meta: formData.geographicAreaMeta,
      pricing_packaging: formData.pricingPackaging,
      pricing_packaging_other: formData.pricingPackagingOther,
      company_goals: formData.companyGoals,
      company_goals_other: formData.companyGoalsOther,
      brand_tone: formData.brandTone,
      brand_tone_other: formData.brandToneOther,
      target_industries: formData.targetIndustries,
      target_industries_other: formData.targetIndustriesOther,
      client_size: formData.clientSize,
      client_challenges: formData.clientChallenges,
      client_challenges_other: formData.clientChallengesOther,
      client_outcomes: formData.clientOutcomes,
      client_outcomes_other: formData.clientOutcomesOther,
      ideal_client: formData.idealClient
    };

    submitMutation.mutate(payload);
    setShowConfirmModal(false);
  };

  const handleReset = () => {
    setFormData({
      itCompanyType: [],
      itCompanyTypeOther: "",
      serviceOfferings: [],
      serviceOfferingsOther: "",
      differentiation: "",
      geographicAreas: "",
      geographicAreaMeta: { label: "", lat: null, lon: null, place_id: null, source: "google" },
      pricingPackaging: "",
      pricingPackagingOther: "",
      companyGoals: [],
      companyGoalsOther: "",
      brandTone: "",
      brandToneOther: "",
      targetIndustries: [],
      targetIndustriesOther: "",
      clientSize: "",
      clientChallenges: [],
      clientChallengesOther: "",
      clientOutcomes: [],
      clientOutcomesOther: "",
      idealClient: ""
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Website Content Questionnaire</h1>
            <p className="text-slate-600 mt-1">Tell us about your IT business</p>
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

      {/* Success Message */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="max-w-4xl mx-auto px-6 mt-6"
          >
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span className="text-green-800 font-medium">Thank you! Your information has been received.</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <form onSubmit={handleSubmit} className="space-y-16">
          {/* Section 1 */}
          <section className="space-y-8">
            <div className="pb-6 border-b-2 border-slate-200">
              <h2 className="text-2xl font-bold text-slate-900">Section 1: About Your Business</h2>
            </div>

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
              onToggle={(value) => updateArrayField("itCompanyType", value, 3)}
              otherValue={formData.itCompanyTypeOther}
              onOtherChange={(value) => updateField("itCompanyTypeOther", value)}
              limit={3}
              onInfoClick={() => setInfoModalData(QUESTIONS_CONFIG.q1)}
            />

            <CheckboxQuestion
              questionNumber={2}
              title="What are your primary service offerings?"
              hint="Select your core services. Maximum 3 selections."
              options={[
                "Cloud Services", "CMMC Compliance Services", "Co-Managed IT", "Co-Managed IT Services",
                "Cybersecurity Services", "Data Backup & Recovery", "Data Backup & Recovery Services",
                "Disaster Recovery Planning", "FTC Compliance Services", "Hardware as a Service",
                "HIPAA Compliance Services", "Hourly IT Support", "Hybrid Cloud Services", "Internet Services",
                "IT Compliance Services", "IT Consulting", "IT Help Desk", "Managed IT Services",
                "Managed Print Services", "Microsoft 365 Services", "NIST Framework Compliance",
                "Outsourced IT Help Desk", "PCI Compliance Services", "Printer & Office Machine Services",
                "Private Cloud Services", "Ransomware Removal", "Security Awareness Training",
                "SOC2 Compliance Services", "Structured Cabling Services", "Video Surveillance Solutions",
                "VoIP Phone Systems"
              ]}
              selected={formData.serviceOfferings}
              onToggle={(value) => updateArrayField("serviceOfferings", value, 3)}
              otherValue={formData.serviceOfferingsOther}
              onOtherChange={(value) => updateField("serviceOfferingsOther", value)}
              limit={3}
              onInfoClick={() => setInfoModalData(QUESTIONS_CONFIG.q2)}
            />

            <TextAreaQuestion
              questionNumber={3}
              title="What makes your company different from other MSPs in your area?"
              hint="Short answer (minimum 150 characters)"
              value={formData.differentiation}
              onChange={(value) => updateField("differentiation", value)}
              minLength={150}
            />

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
            />

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
            />

            <CheckboxQuestion
              questionNumber={6}
              title="What are your company's biggest goals over the next year?"
              hint="Select up to three."
              options={[
                "Acquire more clients",
                "Improve recurring revenue",
                "Strengthen cybersecurity offering",
                "Expand into new markets",
                "Rebrand / modernize web presence",
                "Recruit or retain top technical staff"
              ]}
              selected={formData.companyGoals}
              onToggle={(value) => updateArrayField("companyGoals", value, 3)}
              otherValue={formData.companyGoalsOther}
              onOtherChange={(value) => updateField("companyGoalsOther", value)}
              limit={3}
            />

            <RadioQuestion
              questionNumber={7}
              title="What tone best describes how you want your brand to sound on your website?"
              options={[
                "Professional and corporate",
                "Friendly and approachable",
                "Technical and expert-driven",
                "Bold and sales-focused"
              ]}
              selected={formData.brandTone}
              onSelect={(value) => updateField("brandTone", value)}
              otherValue={formData.brandToneOther}
              onOtherChange={(value) => updateField("brandToneOther", value)}
            />
          </section>

          {/* Section 2 */}
          <section className="space-y-8">
            <div className="pb-6 border-b-2 border-slate-200">
              <h2 className="text-2xl font-bold text-slate-900">Section 2: About Your Target Clients</h2>
            </div>

            <CheckboxQuestion
              questionNumber={8}
              title="What types of businesses do you primarily serve?"
              hint="Check all that apply."
              options={[
                "Healthcare / Medical",
                "Dental Practices",
                "Financial / Accounting / CPA",
                "Legal Firms",
                "Manufacturing / Construction",
                "Nonprofits / Education",
                "Professional Services (Marketing, Real Estate, etc.)",
                "Retail / Hospitality"
              ]}
              selected={formData.targetIndustries}
              onToggle={(value) => updateArrayField("targetIndustries", value, 999)}
              otherValue={formData.targetIndustriesOther}
              onOtherChange={(value) => updateField("targetIndustriesOther", value)}
              limit={999}
            />

            <RadioQuestion
              questionNumber={9}
              title="What is the typical size of your client companies?"
              options={[
                "1–9 employees",
                "10–25 employees",
                "26–50 employees",
                "51–100 employees",
                "100–250 employees",
                "250+ employees"
              ]}
              selected={formData.clientSize}
              onSelect={(value) => updateField("clientSize", value)}
            />

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
              onToggle={(value) => updateArrayField("clientChallenges", value, 3)}
              otherValue={formData.clientChallengesOther}
              onOtherChange={(value) => updateField("clientChallengesOther", value)}
              limit={3}
            />

            <CheckboxQuestion
              questionNumber={11}
              title="What outcomes do your clients want most from working with you?"
              hint="Select up to three."
              options={[
                "Faster response and resolution",
                "Peace of mind about security",
                "Predictable monthly IT costs",
                "Strategic technology guidance",
                "Compliance confidence",
                "Fewer day-to-day IT problems"
              ]}
              selected={formData.clientOutcomes}
              onToggle={(value) => updateArrayField("clientOutcomes", value, 3)}
              otherValue={formData.clientOutcomesOther}
              onOtherChange={(value) => updateField("clientOutcomesOther", value)}
              limit={3}
            />

            <TextAreaQuestion
              questionNumber={12}
              title="If you could describe your ideal client in one sentence, what would you say?"
              hint="Short answer (minimum 150 characters)"
              value={formData.idealClient}
              onChange={(value) => updateField("idealClient", value)}
              minLength={150}
            />
          </section>

          {/* Actions */}
          <div className="flex gap-4 pt-8 border-t border-slate-200">
            <button
              type="submit"
              disabled={!isFormValid()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/20 hover:shadow-xl hover:shadow-blue-600/30"
            >
              Submit Questionnaire
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-6 py-4 border-2 border-slate-300 hover:border-slate-400 text-slate-700 font-semibold rounded-xl transition-all duration-200"
            >
              Clear All
            </button>
          </div>
        </form>

        {/* Info Box */}
        <div className="mt-16 bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h3 className="font-semibold text-blue-900 mb-2">💾 Auto-Save</h3>
          <p className="text-blue-800 text-sm">
            Your responses are automatically saved to your browser. If you accidentally close this page, your data will be restored when you return.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-16">
        <div className="max-w-4xl mx-auto px-6 py-8 text-center text-slate-600 text-sm">
          <p>© 2024 MSP Questionnaire. Built with modern web technologies.</p>
        </div>
      </footer>

      {/* Modals */}
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
          onCancel={() => setShowConfirmModal(false)}
        />
      )}
    </div>
  );
}