import { ORGANIZER_QUESTIONS } from '../../base44/shared/pageOrganizerContract.js';
import { normalizeExpressPageOrganizerFormData } from './expressPageOrganizer.js';
import { buildExpressSubmissionPayload } from './expressQuestionnairePayload.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const copy = (value) => structuredClone(value);
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
export const parseOrganizerResponses = (value) => {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
};
const keys = (question) => [question.rawField, question.otherField, question.responseKey];
const block = (data, question) => Object.fromEntries(keys(question).filter((key) => own(data, key)).map((key) => [key, data[key]]));
const trees = (data) => Object.fromEntries(ORGANIZER_QUESTIONS.filter((q) => own(data, q.responseKey)).map((q) => [q.responseKey, data[q.responseKey]]));
const applyServer = (data, server, questions) => {
  const next = { ...data };
  questions.forEach((question) => { keys(question).forEach((key) => delete next[key]); Object.assign(next, block(server, question)); });
  return normalizeExpressPageOrganizerFormData(next);
};

export function reconcileOrganizerAcknowledgement({ currentFormData, sentFormData, serverFormData }) {
  const server = normalizeExpressPageOrganizerFormData(serverFormData || {});
  const downgraded = ORGANIZER_QUESTIONS.filter((q) => own(sentFormData, q.responseKey) && !own(server, q.responseKey));
  if (downgraded.length) throw Object.assign(new Error('The draft service did not preserve the saved page organization. Reload before saving.'), { status: 409, code: 'ORGANIZER_SERVER_DOWNGRADE' });
  const changed = ORGANIZER_QUESTIONS.filter((q) => (
    (own(server, q.responseKey) || own(sentFormData, q.responseKey))
    && !same(server[q.responseKey], sentFormData?.[q.responseKey])
  ));
  // An old identity/autosave snapshot may predate hydration while the visible
  // form already contains this exact server tree. Reconcile it without locking.
  const conflicting = changed.filter((q) => !same(currentFormData?.[q.responseKey], server[q.responseKey]));
  return {
    formData: applyServer(currentFormData, server, changed),
    questionIds: changed.map((q) => q.questionId),
    conflict: conflicting.length ? { questionIds: conflicting.map((q) => q.questionId), formData: copy(currentFormData), reason: 'another_tab_updated_pages' } : null,
  };
}

export function reconcileOrganizerHydration({ selectedState, localState, remoteState, knownBaseRevision, serverRevision }) {
  if (!selectedState || !remoteState) return { state: selectedState, questionIds: [], conflict: null };
  // A fresh browser has nothing to replay or archive. Missing browser storage
  // is normal server recovery, not an old client trying to remove adoption.
  if (!localState) return { state: selectedState, questionIds: [], conflict: null };
  const local = localState?.formData || {};
  const server = normalizeExpressPageOrganizerFormData(remoteState.formData || {});
  const revisionMatches = Number.isInteger(knownBaseRevision) && knownBaseRevision === serverRevision;
  const differing = ORGANIZER_QUESTIONS.filter((q) => (
    (own(local, q.responseKey) || own(server, q.responseKey)) && !same(block(local, q), block(server, q))
  ));
  // Missing local structures may never downgrade an already adopted server question.
  const blocked = differing.filter((q) => selectedState !== localState || !revisionMatches || (own(server, q.responseKey) && !own(local, q.responseKey)));
  const next = { ...selectedState, formData: applyServer(selectedState.formData || {}, server, blocked) };
  for (const slice of ['validationStatus', 'touchedQuestions', 'expandedQuestions']) {
    next[slice] = { ...(selectedState[slice] || {}) };
    blocked.forEach((q) => { delete next[slice][q.questionId]; if (own(remoteState[slice], q.questionId)) next[slice][q.questionId] = remoteState[slice][q.questionId]; });
  }
  return {
    state: next, questionIds: blocked.map((q) => q.questionId),
    conflict: blocked.length ? { questionIds: blocked.map((q) => q.questionId), formData: copy(local), localState: copy(localState), reason: 'offline_revision_requires_review', baseRevision: knownBaseRevision ?? null, serverRevision } : null,
  };
}

export function assertCurrentOrganizerSnapshot(formData, serverFormData, lockedQuestionIds) {
  const conflicting = ORGANIZER_QUESTIONS.filter((q) => lockedQuestionIds.has(q.questionId) && !same(block(formData, q), block(serverFormData, q)));
  if (conflicting.length) throw Object.assign(new Error('Page organization changed in another tab. Reload before changing those pages; your local recovery copy has been preserved.'), { status: 409, code: 'ORGANIZER_RELOAD_REQUIRED', questionIds: conflicting.map((q) => q.questionId) });
}

export function prepareOrganizerWireDraft(draft, serverFormData, lockedQuestionIds, confirmedRevision) {
  assertCurrentOrganizerSnapshot(parseOrganizerResponses(draft.responses_json), serverFormData, lockedQuestionIds);
  return { ...draft, base_revision: confirmedRevision };
}

export function preserveUnchangedOrganizerQuestions(incomingFormData, currentFormData, changedQuestionId) {
  return applyServer(incomingFormData, currentFormData, ORGANIZER_QUESTIONS.filter((q) => q.questionId !== String(changedQuestionId)));
}

export function reconcilePendingOrganizerDraft(draft, serverFormData, questionIds) {
  if (!draft || !questionIds.length) return draft;
  const formData = applyServer(parseOrganizerResponses(draft.responses_json), serverFormData, ORGANIZER_QUESTIONS.filter((q) => questionIds.includes(q.questionId)));
  const originalPayload = parseOrganizerResponses(draft.mapped_payload_json);
  const payload = buildExpressSubmissionPayload({ formData, businessName: draft.business_name || originalPayload.metadata?.business_name, domain: draft.domain || originalPayload.metadata?.businessDomain, sessionId: draft.session_id || originalPayload.metadata?.questionnaire_session_id, submitAttemptId: originalPayload.metadata?.submit_attempt_id });
  return { ...draft, responses_json: JSON.stringify(formData), mapped_payload_json: JSON.stringify({ metadata: payload.metadata, userdata: payload.userdata }), metadata_json: JSON.stringify(payload.metadata), userdata_json: JSON.stringify(payload.userdata) };
}

const baseKey = (sessionId) => `express_organizer_base_${sessionId}`;
export function rememberOrganizerBaseRevision(storage, sessionId, state, baseRevision) {
  try { if (!storage || !Number.isInteger(baseRevision)) return false; storage.setItem(baseKey(sessionId), JSON.stringify({ sessionId, savedAt: state.savedAt, trees: trees(state.formData), baseRevision })); return true; }
  catch { return false; }
}
export function readOrganizerBaseRevision(storage, sessionId, state) {
  try { const saved = JSON.parse(storage?.getItem(baseKey(sessionId)) || 'null'); return saved?.sessionId === sessionId && saved.savedAt === state?.savedAt && same(saved.trees, trees(state?.formData)) && Number.isInteger(saved.baseRevision) ? saved.baseRevision : null; }
  catch { return null; }
}

const archiveKey = (sessionId) => `express_organizer_conflicts_${sessionId}`;
export function readOrganizerRecoveryArchive(storage, sessionId) {
  try { const value = JSON.parse(storage?.getItem(archiveKey(sessionId)) || 'null'); return value?.sessionId === sessionId && value.format === 'express-organizer-recovery-v1' && Array.isArray(value.conflicts) ? value : null; }
  catch { return null; }
}
export function preserveOrganizerRecoveryCopy(storage, sessionId, conflict, previousArchive = null) {
  const archive = { format: 'express-organizer-recovery-v1', sessionId, conflicts: [] };
  // A quota/storage failure must not make the next conflict replace the only
  // remaining in-memory copy. Merge durable and current-page recovery history.
  for (const source of [readOrganizerRecoveryArchive(storage, sessionId), previousArchive]) {
    if (source?.sessionId !== sessionId || source?.format !== archive.format || !Array.isArray(source.conflicts)) continue;
    for (const saved of source.conflicts) {
      if (!archive.conflicts.some((entry) => same(entry.formData, saved.formData) && same(entry.questionIds, saved.questionIds))) archive.conflicts.push(copy(saved));
    }
  }
  if (!archive.conflicts.some((saved) => same(saved.formData, conflict.formData) && same(saved.questionIds, conflict.questionIds))) archive.conflicts.push({ ...copy(conflict), capturedAt: new Date().toISOString() });
  try { if (!storage) throw new Error('Storage unavailable'); storage.setItem(archiveKey(sessionId), JSON.stringify(archive)); return { archive, storageSaved: true }; }
  catch { return { archive, storageSaved: false }; }
}

export function getOrganizerBrowserStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; }
  catch { return null; }
}
