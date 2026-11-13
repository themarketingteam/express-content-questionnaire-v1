import { useState } from 'react';
import { generatePDF } from '../components/questionnaire/PDFGenerator.js';
export default function LocalThankYouModal({ businessName, domain, formData }) {
  const [message, setMessage] = useState('');
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><section role="dialog" aria-modal="true" aria-label="Local submission captured" className="max-w-lg space-y-4 rounded-xl bg-white p-7 shadow-xl">
    <h2 className="text-2xl font-bold text-[#004B87]">Local submission captured</h2>
    <p>Your answers for <strong>{businessName}</strong> were saved on this computer. Base44 and Zapier remain disconnected.</p>
    <button type="button" className="w-full rounded bg-[#004B87] px-4 py-3 font-semibold text-white" onClick={async () => { setMessage('Generating PDF…'); const result = await generatePDF(formData, businessName, domain); setMessage(result.success ? 'PDF downloaded.' : 'The PDF could not be generated. Your local capture is saved.'); }}>Download responses as PDF</button>
    {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
    <button type="button" onClick={() => window.location.reload()} className="w-full rounded border px-4 py-3">Start another local test</button>
    <p className="text-xs text-slate-500">Use Submission captures in the local toolbar to inspect or export the exact saved JSON.</p>
  </section></div>;
}
