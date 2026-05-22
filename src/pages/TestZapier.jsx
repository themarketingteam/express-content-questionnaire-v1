import React, { useState } from "react";
import { toast } from "sonner";
import { Toaster } from "sonner";
import { FlaskConical, Send, Loader2 } from "lucide-react";
import ThankYouModal from "../components/questionnaire/ThankYouModal";
import { sendExpressZapierSafe, buildExpressZapierPayload } from "@/lib/expressZapierDelivery";

const MOCK_DEFAULTS = {
  businessName: "Acme IT Solutions",
  domain: "acmeit.com",
  differentiation: "We're a locally owned MSP with 24/7 support and an average 10-minute response time. Our team explains issues in plain English and includes proactive security-by-default.",
  idealClient: "A healthcare or dental practice with 20–100 employees that values proactive IT management, clear communication, and a long-term partnership.",
};

function buildMockFormData(businessName, domain, differentiation, idealClient) {
  return {
    itCompanyType: ["Managed Services Provider (MSP)", "Co-Managed IT Partner"],
    itCompanyTypeOther: "",
    serviceOfferings: ["Managed IT", "Cybersecurity", "Data Backup & Recovery", "Microsoft 365", "IT Help Desk", "Cloud Services"],
    serviceOfferingsOther: "",
    differentiation,
    geographicAreas: "Nashville, Tennessee",
    geographicAreaMeta: { label: "Nashville, Tennessee", lat: 36.1627, lon: -86.7816, place_id: "test", source: "google" },
    pricingPackaging: "Flat-rate monthly (fully managed)",
    pricingPackagingOther: "",
    companyGoals: "Acquire more clients",
    companyGoalsOther: "",
    brandTone: "Friendly & Approachable",
    brandToneOther: "",
    targetIndustries: ["Healthcare / Medical", "Financial / Accounting / CPA", "Legal Firms"],
    targetIndustriesOther: "",
    clientSize: "26–100 employees",
    clientChallenges: ["Cybersecurity concerns or breaches", "Unreliable backups or disaster recovery", "Lack of internal IT expertise"],
    clientChallengesOther: "",
    clientOutcomes: ["Peace of mind about security", "Predictable monthly IT costs"],
    clientOutcomesOther: "",
    idealClient,
  };
}

export default function TestZapier() {
  const [businessName, setBusinessName] = useState(MOCK_DEFAULTS.businessName);
  const [domain, setDomain] = useState(MOCK_DEFAULTS.domain);
  const [differentiation, setDifferentiation] = useState(MOCK_DEFAULTS.differentiation);
  const [idealClient, setIdealClient] = useState(MOCK_DEFAULTS.idealClient);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [submittedData, setSubmittedData] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!businessName.trim() || !domain.trim()) {
      toast.error("Business name and domain are required.");
      return;
    }

    setIsSubmitting(true);
    const formData = buildMockFormData(businessName, domain, differentiation, idealClient);
    const payload = {
      metadata: {
        business_name: businessName,
        businessDomain: domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').trim(),
        submission_datetime: new Date().toISOString(),
        service_type: "express",
        questionnaire_session_id: "test-zapier",
      },
      userdata: {
        it_company_type: formData.itCompanyType,
        service_offerings: formData.serviceOfferings,
        differentiation: formData.differentiation,
        geographic_areas: formData.geographicAreas,
        pricing_packaging: formData.pricingPackaging,
        company_goals: formData.companyGoals,
        brand_tone: formData.brandTone,
        target_industries: formData.targetIndustries,
        client_size: formData.clientSize,
        client_challenges: formData.clientChallenges,
        client_outcomes: formData.clientOutcomes,
        ideal_client: formData.idealClient,
      },
    };

    try {
      const result = await sendExpressZapierSafe(payload);
      if (result.ok) {
        toast.success("Test submission sent successfully via server-side wrapper.");
        setSubmittedData({ businessName, domain, formData });
        setShowModal(true);
      } else {
        toast.error(`Submission failed: ${result.error || "Unknown error"}`);
      }
    } catch (err) {
      toast.error(`Submission failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <div className="border-b" style={{ borderColor: "#009ADD", backgroundColor: "#004B87" }}>
        <div className="max-w-2xl mx-auto px-6 py-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(0,154,221,0.25)" }}>
            <FlaskConical className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white" style={{ fontFamily: "Raleway, sans-serif" }}>
              Test Submission Tool
            </h1>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.65)", fontFamily: "Lato, sans-serif" }}>
              Simulate a questionnaire submission and test the PDF download flow
            </p>
          </div>
        </div>
      </div>

      {/* Notice Banner */}
      <div className="max-w-2xl mx-auto px-6 pt-6">
        <div className="rounded-lg px-4 py-3 flex items-start gap-3 text-sm" style={{ backgroundColor: "#FFF8E6", border: "1px solid #FDB913" }}>
          <span className="text-lg leading-none">⚠️</span>
          <p style={{ color: "#7D5A00", fontFamily: "Lato, sans-serif" }}>
            <strong>Internal use only.</strong> This page sends test data through the Base44 sendExpressToZapier function. Configure EXPRESS_ZAPIER_WEBHOOK_URL in the Base44 function environment.
          </p>
        </div>
      </div>

      {/* Form */}
      <main className="max-w-2xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Business Details */}
          <div className="rounded-xl border bg-white p-6 space-y-4 shadow-sm" style={{ borderColor: "#e2e8f0" }}>
            <h2 className="text-base font-bold" style={{ color: "#004B87", fontFamily: "Raleway, sans-serif" }}>
              Business Details
            </h2>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-slate-700" style={{ fontFamily: "Lato, sans-serif" }}>
                Business Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ borderColor: "#cbd5e1", fontFamily: "Lato, sans-serif" }}
                placeholder="e.g. Acme IT Solutions"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-slate-700" style={{ fontFamily: "Lato, sans-serif" }}>
                Domain <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ borderColor: "#cbd5e1", fontFamily: "Lato, sans-serif" }}
                placeholder="e.g. acmeit.com"
              />
            </div>
          </div>

          {/* Sample Answers */}
          <div className="rounded-xl border bg-white p-6 space-y-4 shadow-sm" style={{ borderColor: "#e2e8f0" }}>
            <h2 className="text-base font-bold" style={{ color: "#004B87", fontFamily: "Raleway, sans-serif" }}>
              Sample Answers <span className="text-xs font-normal text-slate-500">(pre-filled with mock data)</span>
            </h2>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-slate-700" style={{ fontFamily: "Lato, sans-serif" }}>
                Q3 · What makes your company different?
              </label>
              <textarea
                value={differentiation}
                onChange={(e) => setDifferentiation(e.target.value)}
                rows={3}
                className="w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                style={{ borderColor: "#cbd5e1", fontFamily: "Lato, sans-serif" }}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-slate-700" style={{ fontFamily: "Lato, sans-serif" }}>
                Q12 · Describe your ideal client
              </label>
              <textarea
                value={idealClient}
                onChange={(e) => setIdealClient(e.target.value)}
                rows={3}
                className="w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                style={{ borderColor: "#cbd5e1", fontFamily: "Lato, sans-serif" }}
              />
            </div>

            <div className="rounded-lg px-4 py-3 text-xs" style={{ backgroundColor: "#f8fbff", border: "1px solid #009ADD", color: "#3D5A73", fontFamily: "Lato, sans-serif" }}>
              All other fields (service offerings, industries, pricing model, etc.) are auto-populated with representative mock data.
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 font-bold transition-all tracking-wider uppercase disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              backgroundColor: isSubmitting ? "#7D868D" : "#009ADD",
              color: "white",
              borderRadius: "2px",
              height: "52px",
              fontSize: "15px",
              letterSpacing: "0.8px",
              fontFamily: "Lato, sans-serif",
            }}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Sending Test Data...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Submit Test Data
              </>
            )}
          </button>
        </form>
      </main>

      {showModal && submittedData && (
        <ThankYouModal
          businessName={submittedData.businessName}
          domain={submittedData.domain}
          formData={submittedData.formData}
        />
      )}

      <Toaster richColors position="top-center" />
    </div>
  );
}