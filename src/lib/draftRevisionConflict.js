/** Never give an old full answer snapshot a newer foreign tab's revision. */
export function hasForeignDraftRevision(draft, serverDraft) {
  const captured = Number(draft?.__captured_base_revision ?? draft?.base_revision);
  const current = Number(serverDraft?.last_confirmed_revision);
  if (!Number.isSafeInteger(captured) || !Number.isSafeInteger(current) || current <= captured) return false;
  return !draft?.client_instance_id || String(serverDraft?.last_client_instance_id || '') !== String(draft.client_instance_id);
}

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const populated = (value) => Array.isArray(value) ? value.some(populated) : value && typeof value === 'object'
  ? Object.values(value).some(populated) : value !== '' && value !== null && value !== undefined && value !== false;

export function browserDraftRequiresReview(localState, remoteState, knownBaseRevision, serverRevision) {
  if (!localState?.formData || !remoteState?.formData || !populated(remoteState.formData)) return false;
  if (JSON.stringify(canonical(localState.formData)) === JSON.stringify(canonical(remoteState.formData))) return false;
  // A timestamp can be rewritten by an old tab's unload handler. Only the
  // captured authoritative revision permits replay into a populated draft.
  return !Number.isSafeInteger(knownBaseRevision) || knownBaseRevision !== serverRevision;
}
