import { getOrCreateQuestionnaireDraftIdentity, buildDraftIdentityHash } from './questionnaireDraftIdentity.js';

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const pendingKey = (sessionId) => `express_completed_revision_request_${sessionId}`;
const archiveKey = (sessionId) => `express_completed_recovery_${sessionId}`;
export const isCompletedQuestionnaireDraft = (draft) => Boolean(draft && (draft.status === 'submitted' || draft.final_submission_id));

export function completedDraftRecovery(sourceDraft, localState, remoteState) {
  if (!isCompletedQuestionnaireDraft(sourceDraft)) return null;
  const localCopy = localState?.formData && !same(localState.formData, remoteState?.formData) ? structuredClone(localState) : null;
  return { format: 'express-completed-recovery-v1', sessionId: sourceDraft.session_id, draftId: sourceDraft.id,
    finalSubmissionId: sourceDraft.final_submission_id || '', sourceState: structuredClone(remoteState), localState: localCopy };
}

export function preserveCompletedRecovery(storage, recovery) {
  try { if (!storage) return false; storage.setItem(archiveKey(recovery.sessionId), JSON.stringify(recovery)); return true; }
  catch { return false; }
}

export function readCompletedRecovery(storage, sessionId) {
  try { const saved = JSON.parse(storage?.getItem(archiveKey(sessionId)) || 'null'); return saved?.format === 'express-completed-recovery-v1' && saved.sessionId === sessionId ? saved : null; }
  catch { return null; }
}

/** Omitted organizer adoption is never converted back into a legacy answer list. */
export function revisionStateFromCompleted(recovery, includeLocal) {
  const source = recovery.sourceState;
  const chosen = includeLocal && recovery.localState ? recovery.localState : source;
  const formData = { ...(source?.formData || {}), ...(chosen?.formData || {}) };
  for (const [tree, values, other] of [['serviceOfferingsStructure', 'serviceOfferings', 'serviceOfferingsOther'], ['targetIndustriesStructure', 'targetIndustries', 'targetIndustriesOther']]) {
    if (Object.hasOwn(source?.formData || {}, tree) && !Object.hasOwn(chosen?.formData || {}, tree)) {
      for (const key of [tree, values, other]) if (Object.hasOwn(source.formData, key)) formData[key] = source.formData[key];
    }
  }
  return { ...source, ...chosen, formData };
}

/** Target credentials are stored separately; the active completed identity is unchanged until ACK. */
export function readCompletedRevisionRequest(storage, sourceSessionId) {
  try {
    const saved = JSON.parse(storage?.getItem(pendingKey(sourceSessionId)) || 'null');
    if (!saved?.acknowledged && saved?.sourceSessionId === sourceSessionId && saved.revisionRequestId && saved.targetSessionId && saved.targetAccessKey && saved.draft) return saved;
  } catch { /* Browser storage can be unavailable. */ }
  return null;
}

export function prepareCompletedRevisionRequest({ storage, sourceSessionId, draft, cryptoApi = globalThis.crypto }) {
  const saved = readCompletedRevisionRequest(storage, sourceSessionId);
  if (saved) return saved;
  const target = getOrCreateQuestionnaireDraftIdentity({ forceNew: true, storage: null, location: null, history: null, cryptoApi });
  const request = { sourceSessionId, targetSessionId: target.sessionId, targetAccessKey: target.accessKey,
    revisionRequestId: cryptoApi.randomUUID(), draft: { ...draft, session_id: target.sessionId } };
  try { storage?.setItem(pendingKey(sourceSessionId), JSON.stringify(request)); } catch { /* Keep current active identity and in-memory request. */ }
  return request;
}

export function acknowledgeCompletedRevisionRequest(storage, request, result) {
  try {
    if (!storage || !result?.revisionStarted || !result.saved || result.draft?.session_id !== request.targetSessionId || Number(result.lastConfirmedRevision) < 1) return false;
    const current = readCompletedRevisionRequest(storage, request.sourceSessionId);
    if (current && current.revisionRequestId !== request.revisionRequestId) return false;
    storage.setItem(pendingKey(request.sourceSessionId), JSON.stringify({ ...request, acknowledged: true, draftId: result.draft.id }));
    return true;
  } catch { return false; }
}

export function confirmedRevisionUrl(request, result, location) {
  if (!result?.revisionStarted || !result.saved || !result.draft?.id || result.draft.session_id !== request.targetSessionId || Number(result.lastConfirmedRevision) < 1) {
    throw Object.assign(new Error('The new revision has not been confirmed. Your completed questionnaire and recovery copy are unchanged.'), { code: 'REVISION_NOT_CONFIRMED' });
  }
  const url = new URL(location.href);
  for (const key of ['new_client', 'newClient', 'newClientRequestId', 'new_client_request', 'promptIdentity', 'prompt_identity', 'draft', 'key']) url.searchParams.delete(key);
  url.hash = buildDraftIdentityHash('', { sessionId: request.targetSessionId, accessKey: request.targetAccessKey });
  return url.toString();
}
