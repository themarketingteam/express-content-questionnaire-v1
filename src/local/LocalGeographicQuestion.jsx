export default function LocalGeographicQuestion({ questionNumber = 4, value = '', onSelect, onClear, isOpen = true, onClick }) {
  return <div className="w-full rounded-lg border border-slate-200 bg-white">
    <button type="button" className="w-full p-4 text-left font-semibold text-[#004B87]" onClick={onClick}>{questionNumber}. What is your primary city of service or geological region of service?</button>
    {isOpen && <div className="space-y-2 border-t p-4">
      <p className="text-xs text-slate-500">Local preview: enter a location manually. Google Places is disconnected.</p>
      <div className="flex gap-2"><input aria-label="Primary service location" className="min-w-0 flex-1 rounded border p-3" value={value} onChange={(event) => onSelect({ label: event.target.value, source: 'manual' })} placeholder="e.g., Louisville, KY" /><button type="button" onClick={onClear} className="rounded border px-3 text-sm">Clear</button></div>
    </div>}
  </div>;
}
