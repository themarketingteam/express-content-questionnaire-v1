
import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import CheckboxQuestion from "../components/questionnaire/CheckboxQuestion";
import RadioQuestion from "../components/questionnaire/RadioQuestion";
import TextAreaQuestion from "../components/questionnaire/TextAreaQuestion";
import GeographicQuestion from "../components/questionnaire/GeographicQuestion";
import NumericRangeQuestion from "../components/questionnaire/NumericRangeQuestion";
import InfoModal from "../components/questionnaire/InfoModal";
import ConfirmModal from "../components/questionnaire/ConfirmModal";
import { Save } from "lucide-react"; // Removed CheckCircle2 as it's no longer used

const STORAGE_KEY = "msp_questionnaire_data_v2";

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
    title: "What geographic area do you primarily serve?",
    why: "Your service region shapes local SEO and credibility. Listing a validated city/county/region helps nearby businesses find you and signals that you're truly local.",
    guidance: "Enter a city, county, region, state/province, country, or continent (no street addresses). Choose a validated option from the list so we can store it accurately.",
    type: "short",
    examples: {
      selections: [],
      mixed: [],
      other: "",
      shortAnswer: "Davidson County, Tennessee and the Greater Nashville metro area."
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
    companyGoals: "",
    companyGoalsOther: "",
    brandTone: "",
    brandToneOther: "",
    targetIndustries: [],
    targetIndustriesOther: "",
    clientSize: "1-50 employees",
    clientChallenges: [],
    clientChallengesOther: "",
    clientOutcomes: [],
    clientOutcomesOther: "",
    idealClient: ""
  });

  const [showSaveIndicator, setShowSaveIndicator] = useState(false);
  // const [showSuccess, setShowSuccess] = useState(false); // Removed, as we are redirecting on success
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [infoModalData, setInfoModalData] = useState(null);
  const [openQuestion, setOpenQuestion] = useState(1);
  const [autoAdvancing, setAutoAdvancing] = useState(false);

  const questionRefs = useRef({});

  // Load saved data
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Migrate old array format to string for companyGoals if needed
        if (Array.isArray(parsed.companyGoals)) {
          parsed.companyGoals = parsed.companyGoals.length > 0 ? parsed.companyGoals[0] : "";
        }
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
      // Send to Zapier webhook
      const hookId = import.meta.env.VITE_API_HOOK_ID;
      const hookKey = import.meta.env.VITE_API_HOOK_KEY;
      const zapierUrl = `https://hooks.zapier.com/hooks/catch/${hookId}/${hookKey}`;

      console.log('=== FORM SUBMISSION DEBUG ===');
      console.log('Sending data to:', zapierUrl);
      console.log('Payload structure:', JSON.stringify(data, null, 2));

      const response = await fetch(zapierUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });

      console.log('Zapier response status:', response.status);
      console.log('Zapier response OK:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Zapier error response:', errorText);
        throw new Error('Failed to submit to Zapier');
      }

      const zapierResult = await response.json();
      console.log('Zapier success response:', zapierResult);

      // Also save to Base44 for backup
      console.log('Saving backup to Base44...');
      const base44Result = await base44.entities.FormSubmission.create(data);
      console.log('Base44 backup saved successfully:', base44Result);
      console.log('=== END SUBMISSION DEBUG ===');

      return { response: zapierResult, businessName: data.metadata.business_name };
    },
    onSuccess: (data) => {
      console.log('✅ Form submission successful! Redirecting to thank you page...');
      localStorage.removeItem(STORAGE_KEY);
      // Redirect to thank you page with business name
      window.location.href = `/ThankYou?business=${encodeURIComponent(data.businessName)}`;
    },
    onError: (error) => {
      console.error('❌ Form submission failed:', error);
      alert('There was an error submitting your form. Please try again or contact support.');
    }
  });

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateArrayField = (field, value, limit = 3, otherField = null) => {
    setFormData(prev => {
      const current = prev[field] || [];
      const index = current.indexOf(value);

      const hasOtherText = otherField && (prev[otherField] || "").trim().length > 0;
      const totalSelections = current.length + (hasOtherText ? 1 : 0);

      if (index > -1) {
        return { ...prev, [field]: current.filter(v => v !== value) };
      } else {
        if (totalSelections >= limit) return prev;
        return { ...prev, [field]: [...current, value] };
      }
    });
  };

  const isQuestionComplete = (questionNum) => {
    const hasAnswer = (field, otherField) => {
      const selected = (formData[field] || []).length;
      const hasOther = (otherField && (formData[otherField] || "").trim().length > 0);
      return selected > 0 || hasOther;
    };

    const hasRadioAnswer = (field, otherField) => {
      const selected = (formData[field] || "").trim().length > 0;
      const hasOther = (otherField && (formData[otherField] || "").trim().length > 0);
      return selected || hasOther;
    };

    const hasText = (val) => (val || "").trim().length > 0;

    switch(questionNum) {
      case 1: return hasAnswer("itCompanyType", "itCompanyTypeOther");
      case 2: return hasAnswer("serviceOfferings", "serviceOfferingsOther");
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

  useEffect(() => {
    if (autoAdvancing || openQuestion > 12) return;

    if (isQuestionComplete(openQuestion)) {
      setAutoAdvancing(true);
      const timer = setTimeout(() => {
        const nextQuestion = openQuestion + 1;
        if (nextQuestion <= 12) {
          setOpenQuestion(nextQuestion);
        }
        setAutoAdvancing(false);
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [formData, openQuestion, autoAdvancing]);

  const handleQuestionClick = (questionNum) => {
    if (questionNum !== openQuestion) {
      setOpenQuestion(questionNum);
    }
  };

  const isFormValid = () => {
    for (let i = 1; i <= 12; i++) {
      if (!isQuestionComplete(i)) return false;
    }
    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isFormValid()) {
      setShowConfirmModal(true);
    } else {
      alert("Please complete all required fields before submitting.");
    }
  };

  const handleConfirmSubmit = (businessName, domain) => {
    const payload = {
      metadata: {
        business_name: businessName,
        businessDomain: domain,
        submission_datetime: new Date().toISOString(),
        service_type: "express"
      },
      userdata: {
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
      }
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
      companyGoals: "",
      companyGoalsOther: "",
      brandTone: "",
      brandToneOther: "",
      targetIndustries: [],
      targetIndustriesOther: "",
      clientSize: "1-50 employees",
      clientChallenges: [],
      clientChallengesOther: "",
      clientOutcomes: [],
      clientOutcomesOther: "",
      idealClient: ""
    });
    setOpenQuestion(1); // Reset to first question
  };

  const urlParams = new URLSearchParams(window.location.search);
  const initialBusinessName = urlParams.get("businessName") || "";
  const domainSL = urlParams.get("domainSL") || "";
  const domainTL = urlParams.get("domainTL") || "";
  const initialDomain = (domainSL && domainTL) ? `${domainSL}.${domainTL}` : "";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Website Content Questionnaire</h1>
            <p className="text-slate-600 mt-1">Help us get to know your business.</p>
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

      {/* The AnimatePresence block for showSuccess is removed as redirection replaces its functionality */}

      <main className="max-w-4xl mx-auto px-6 py-12">
        <form onSubmit={handleSubmit} className="space-y-16">
          <section className="space-y-8">
            <div className="pb-6 border-b-2 border-slate-200">
              <h2 className="text-2xl font-bold text-slate-900">Section 1: About Your Business</h2>
            </div>

            <div ref={el => questionRefs.current[1] = el}>
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
                isOpen={openQuestion === 1}
                onClick={() => handleQuestionClick(1)}
              />
            </div>

            <div ref={el => questionRefs.current[2] = el}>
              <CheckboxQuestion
                questionNumber={2}
                title="What are your primary service offerings?"
                hint="Select your core services. Maximum 3 selections."
                options={[
                  "Cloud Services", "CMMC Compliance", "Co-Managed IT",
                  "Cybersecurity", "Data Backup & Recovery",
                  "Disaster Recovery Planning", "FTC Compliance", "Hardware as a Service",
                  "HIPAA Compliance", "Hourly IT Support", "Hybrid Cloud Services", "Internet Services",
                  "IT Compliance", "IT Consulting", "IT Help Desk", "Managed IT",
                  "Microsoft 365", "NIST Framework Compliance",
                  "Outsourced IT Help Desk", "PCI Compliance", "Printer & Office Machine",
                  "Private Cloud Services", "Ransomware Removal", "Security Awareness Training",
                  "SOC2 Compliance", "Structured Cabling", "Video Surveillance Solutions",
                  "VoIP Phone Systems"
                ]}
                selected={formData.serviceOfferings}
                onToggle={(value) => updateArrayField("serviceOfferings", value, 3, "serviceOfferingsOther")}
                otherValue={formData.serviceOfferingsOther}
                onOtherChange={(value) => updateField("serviceOfferingsOther", value)}
                limit={3}
                onInfoClick={() => setInfoModalData(HELPER_COPY.q2)}
                isOpen={openQuestion === 2}
                onClick={() => handleQuestionClick(2)}
              />
            </div>

            <div ref={el => questionRefs.current[3] = el}>
              <TextAreaQuestion
                questionNumber={3}
                title="What makes your company different from other MSPs in your area?"
                hint="Focus on the unique value clients get from working with you—your responsiveness, customer experience, tools, or results they consistently praise."
                value={formData.differentiation}
                onChange={(value) => updateField("differentiation", value)}
                minLength={0}
                onInfoClick={() => setInfoModalData(HELPER_COPY.q3)}
                isOpen={openQuestion === 3}
                onClick={() => handleQuestionClick(3)}
              />
            </div>

            <div ref={el => questionRefs.current[4] = el}>
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
                isOpen={openQuestion === 4}
                onClick={() => handleQuestionClick(4)}
              />
            </div>

            <div ref={el => questionRefs.current[5] = el}>
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
                isOpen={openQuestion === 5}
                onClick={() => handleQuestionClick(5)}
              />
            </div>

            <div ref={el => questionRefs.current[6] = el}>
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
                isOpen={openQuestion === 6}
                onClick={() => handleQuestionClick(6)}
              />
            </div>

            <div ref={el => questionRefs.current[7] = el}>
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
                isOpen={openQuestion === 7}
                onClick={() => handleQuestionClick(7)}
              />
            </div>
          </section>

          <section className="space-y-8">
            <div className="pb-6 border-b-2 border-slate-200">
              <h2 className="text-2xl font-bold text-slate-900">Section 2: About Your Target Clients</h2>
            </div>

            <div ref={el => questionRefs.current[8] = el}>
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
                isOpen={openQuestion === 8}
                onClick={() => handleQuestionClick(8)}
              />
            </div>

            <div ref={el => questionRefs.current[9] = el}>
              <NumericRangeQuestion
                questionNumber={9}
                title="What is the typical size of your client companies?"
                hint="Enter the range of employee count"
                minValue={1}
                maxValue={50}
                onChange={(value) => updateField("clientSize", value)}
                onInfoClick={() => setInfoModalData(HELPER_COPY.q9)}
                isOpen={openQuestion === 9}
                onClick={() => handleQuestionClick(9)}
              />
            </div>

            <div ref={el => questionRefs.current[10] = el}>
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
                isOpen={openQuestion === 10}
                onClick={() => handleQuestionClick(10)}
              />
            </div>

            <div ref={el => questionRefs.current[11] = el}>
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
                isOpen={openQuestion === 11}
                onClick={() => handleQuestionClick(11)}
              />
            </div>

            <div ref={el => questionRefs.current[12] = el}>
              <TextAreaQuestion
                questionNumber={12}
                title="Briefly describe your ideal client."
                hint="Include who they are, the problems they're facing, and why they value your partnership."
                value={formData.idealClient}
                onChange={(value) => updateField("idealClient", value)}
                minLength={0}
                onInfoClick={() => setInfoModalData(HELPER_COPY.q12)}
                isOpen={openQuestion === 12}
                onClick={() => handleQuestionClick(12)}
              />
            </div>
          </section>

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

        <div className="mt-16 bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h3 className="font-semibold text-blue-900 mb-2">💾 Auto-Save</h3>
          <p className="text-blue-800 text-sm">
            Your responses are automatically saved to your browser. If you accidentally close this page, your data will be restored when you return.
          </p>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white mt-16">
        <div className="max-w-4xl mx-auto px-6 py-8 text-center text-slate-600 text-sm">
          <p>© 2024 MSP Questionnaire. Built with modern web technologies.</p>
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
          onCancel={() => setShowConfirmModal(false)}
          initialBusinessName={initialBusinessName}
          initialDomain={initialDomain}
        />
      )}
    </div>
  );
}
