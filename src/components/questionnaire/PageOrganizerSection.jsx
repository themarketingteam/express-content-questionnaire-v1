import { ChevronDown, Info } from 'lucide-react';
import PageOrganizerQuestion from './PageOrganizerQuestion';

/** @param {any} props */
export default function PageOrganizerSection({ questionNumber, title, hint, isOpen, onClick, onInfoClick, readOnly = false, ...organizerProps }) {
  const panelId = `express-organizer-question-${questionNumber}`;
  return <section className="min-w-0 flex-1" data-testid={`question-wrapper-${questionNumber}`}>
    <div className="flex items-start gap-3">
      <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={onClick} className="flex min-h-10 min-w-0 flex-1 items-start gap-3 rounded text-left text-lg font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C82DE]">
        <span className="min-w-0 flex-1">{questionNumber}. {title}</span>
        <ChevronDown aria-hidden="true" className={`mt-1.5 h-5 w-5 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <button type="button" onClick={onInfoClick} aria-label={`More information for question ${questionNumber}`} className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C82DE]"><Info aria-hidden="true" className="h-3.5 w-3.5" /></button>
    </div>
    {isOpen && <div id={panelId} className="mt-2 space-y-4">
      <p className="text-sm italic text-slate-500">{hint}</p>
      <fieldset disabled={readOnly} aria-label={`Question ${questionNumber} page organization`} className="m-0 min-w-0 border-0 p-0">
        <PageOrganizerQuestion questionId={String(questionNumber)} readOnly={readOnly} {...organizerProps} />
      </fieldset>
    </div>}
  </section>;
}
