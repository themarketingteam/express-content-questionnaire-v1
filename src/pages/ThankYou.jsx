import React from "react";
import { CheckCircle2, Home } from "lucide-react";

export default function ThankYou() {
  const urlParams = new URLSearchParams(window.location.search);
  const businessName = urlParams.get("business") || "your business";

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-6">
      <div className="max-w-2xl w-full text-center space-y-8">
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-12 h-12 text-green-600" />
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="text-4xl font-bold text-slate-900">Thank You!</h1>
          <p className="text-xl text-slate-600">
            We've received your questionnaire for <span className="font-semibold text-slate-900">{businessName}</span>
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-8 space-y-4 text-left">
          <h2 className="text-lg font-semibold text-slate-900">What happens next?</h2>
          <ul className="space-y-3 text-slate-700">
            <li className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-blue-600 font-semibold text-sm">1</span>
              </div>
              <div>
                <strong>Review:</strong> Our team will review your responses within 1-2 business days
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-blue-600 font-semibold text-sm">2</span>
              </div>
              <div>
                <strong>Contact:</strong> We'll reach out to discuss next steps and timeline
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-blue-600 font-semibold text-sm">3</span>
              </div>
              <div>
                <strong>Development:</strong> We'll begin crafting your custom website content
              </div>
            </li>
          </ul>
        </div>

        <div className="pt-4">
          <p className="text-sm text-slate-600 mb-4">
            You can safely close this page. We'll be in touch soon!
          </p>
        </div>
      </div>
    </div>
  );
}