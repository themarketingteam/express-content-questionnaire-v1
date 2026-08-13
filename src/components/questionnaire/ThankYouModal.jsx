import React, { useState } from "react";
import { CheckCircle2, Download, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { generatePDF } from "./PDFGenerator.js";

export default function ThankYouModal({ businessName, domain, formData }) {
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const handleDownloadPDF = async () => {
    setIsGeneratingPDF(true);
    try {
      const result = await generatePDF(formData, businessName, domain);
      if (result.success) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden"
      >
        {/* Header */}
        <div className="text-center px-8 pt-10 pb-6">
          <div className="flex justify-center mb-5">
            <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ backgroundColor: "#E6F4FF" }}>
              <CheckCircle2 className="w-10 h-10" style={{ color: "#004B87" }} />
            </div>
          </div>
          <h2 className="text-3xl font-bold mb-2" style={{ color: "#004B87", fontFamily: "Raleway, sans-serif" }}>
            Thank You!
          </h2>
          <p className="text-slate-600" style={{ fontFamily: "Lato, sans-serif" }}>
            We've received your questionnaire for{" "}
            <span className="font-semibold text-slate-900">{businessName}</span>.
          </p>
        </div>

        {/* What happens next */}
        <div className="mx-8 mb-6 rounded-xl p-5 space-y-3" style={{ backgroundColor: "#f8fbff", border: "1px solid #009ADD" }}>
          <p className="text-sm font-semibold" style={{ color: "#004B87", fontFamily: "Raleway, sans-serif" }}>What happens next?</p>
          <ul className="space-y-2">
            {[
              { n: 1, label: "Review", desc: "Our team will review your responses within 1–2 business days" },
              { n: 2, label: "Contact", desc: "We'll reach out to discuss next steps and timeline" },
              { n: 3, label: "Development", desc: "We'll begin crafting your custom website content" },
            ].map(({ n, label, desc }) => (
              <li key={n} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: "#009ADD" }}>
                  <span className="text-white font-bold text-xs">{n}</span>
                </div>
                <p className="text-sm text-slate-700" style={{ fontFamily: "Lato, sans-serif" }}>
                  <strong>{label}:</strong> {desc}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* Download Button */}
        <div className="px-8 pb-8 space-y-3">
          <button
            onClick={handleDownloadPDF}
            disabled={isGeneratingPDF}
            className="w-full flex items-center justify-center gap-2 font-bold transition-all tracking-wider uppercase disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              backgroundColor: isGeneratingPDF ? "#7D868D" : "#8DC641",
              color: "white",
              borderRadius: "2px",
              height: "52px",
              fontSize: "15px",
              letterSpacing: "0.8px",
              fontFamily: "Lato, sans-serif",
            }}
          >
            {isGeneratingPDF ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Download Your Responses (PDF)
              </>
            )}
          </button>
          <p className="text-center text-xs text-slate-500" style={{ fontFamily: "Lato, sans-serif" }}>
            You can safely close this page. We'll be in touch soon!
          </p>
        </div>
      </motion.div>
    </div>
  );
}
