import React from 'react';
import { buildExpressSubmittedReview } from '../../lib/expressSubmittedReview.js';

/** @param {any} props */
export default function SubmittedQuestionnaireReview({ formData, businessName, domain, onCopyLink, onDownloadPdf, isGeneratingPdf = false, receivedForProcessing = false }) {
  return <section aria-label="Submitted questionnaire answers" className="space-y-6">
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-xl font-bold text-slate-900">{receivedForProcessing ? 'Your received answers' : 'Your submitted answers'}</h2>
      <dl className="mt-4 space-y-2 text-sm">
        <div><dt className="font-semibold">Business name</dt><dd className="whitespace-pre-wrap break-words">{businessName || 'Not provided'}</dd></div>
        <div><dt className="font-semibold">Domain</dt><dd className="whitespace-pre-wrap break-words">{domain || 'Not provided'}</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={onCopyLink} className="min-h-11 rounded border border-blue-800 px-4 py-2 font-semibold text-blue-900">Copy questionnaire link</button>
        <button type="button" onClick={onDownloadPdf} disabled={isGeneratingPdf} className="min-h-11 rounded bg-blue-800 px-4 py-2 font-semibold text-white disabled:opacity-60">{isGeneratingPdf ? 'Generating PDF…' : 'Download responses (PDF)'}</button>
      </div>
    </div>
    {buildExpressSubmittedReview(formData).map((question) => <details key={question.number} open className="rounded-lg border border-slate-200 bg-white p-5">
      <summary className="cursor-pointer text-lg font-semibold text-slate-900">{question.number}. {question.title}</summary>
      <div className="mt-4 whitespace-pre-wrap break-words text-slate-800">
        {question.pages ? question.pages.length ? <ol className="list-decimal space-y-3 pl-6">{question.pages.map((page, index) => <li key={page.id || index}>
          <span className="font-semibold">{page.label}</span>
          {page.children?.length > 0 && <ol className="mt-2 list-decimal space-y-1 pl-6">{page.children.map((child, childIndex) => <li key={child.id || childIndex}>{child.label}</li>)}</ol>}
        </li>)}</ol> : <p>No pages selected.</p> : <>
          {question.values.length > 0 ? <ul className={question.values.length > 1 ? 'list-disc space-y-1 pl-5' : 'list-none'}>{question.values.map((value, index) => <li key={index}>{value}</li>)}</ul> : !question.other && <p className="text-slate-500">Not provided</p>}
          {question.other && <p className="mt-2"><span className="font-semibold">Custom answer: </span>{question.other}</p>}
        </>}
      </div>
    </details>)}
  </section>;
}
