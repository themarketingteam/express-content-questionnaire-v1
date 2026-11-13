import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalApi } from '../scripts/local-preview-api.mjs';
import { buildExpressSubmissionPayload } from '../src/lib/expressQuestionnairePayload.js';
import { createDraftMutationEnvelope } from '../src/lib/draftSaveReliability.js';
import { addPage, createPageNode, createPageStructure, movePage } from '../src/lib/pageOrganizerModel.js';
import { normalizeExpressPageOrganizerFormData } from '../src/lib/expressPageOrganizer.js';
import { assertCurrentOrganizerSnapshot, parseOrganizerResponses, prepareOrganizerWireDraft, preserveOrganizerRecoveryCopy, preserveUnchangedOrganizerQuestions, readOrganizerBaseRevision, readOrganizerRecoveryArchive, reconcileOrganizerAcknowledgement, reconcileOrganizerHydration, reconcilePendingOrganizerDraft, rememberOrganizerBaseRevision } from '../src/lib/expressOrganizerRecovery.js';

const sessionId = 'express_recovery_session_1234567890';
const accessKey = 'express_recovery_access_key_12345678901234567890';
const storage = () => { const data = new Map(); return { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value) }; };
const state = (formData, savedAt = '2026-11-13T14:00:00Z') => ({ formData, savedAt, questionnaireSessionId: sessionId });
const withTree = (formData, tree) => normalizeExpressPageOrganizerFormData({ ...formData, serviceOfferingsStructure: tree });
const envelope = (tab, formData, sequence) => {
  const payload = buildExpressSubmissionPayload({ formData, businessName: tab.draft.business_name, domain: tab.draft.domain, sessionId });
  return createDraftMutationEnvelope({ ...tab.draft, responses_json: JSON.stringify(formData), mapped_payload_json: JSON.stringify(payload), client_revision: sequence }, { clientInstanceId: tab.name, baseRevision: tab.revision, previousDraft: tab.draft });
};
const setup = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'express-organizer-recovery-'));
  const api = createLocalApi(process.cwd(), { dataDirectory: directory });
  const initial = api.invoke('questionnaireDraftData', { action: 'bootstrap', sessionId, accessKey }).draft;
  const legacy = parseOrganizerResponses(initial.responses_json);
  const tree = createPageStructure('2', legacy.serviceOfferings, legacy.serviceOfferingsOther, [...legacy.serviceOfferings]);
  const adopted = withTree(legacy, tree);
  const seed = { name: 'seed-tab', draft: initial, revision: 0 };
  const save = (draft, action = 'save') => api.invoke('questionnaireDraftData', { action, checkpointType: 'explicit_clear', sessionId, accessKey, draft });
  const result = save(envelope(seed, adopted, 1));
  return { directory, save, tab: (name) => ({ name, draft: structuredClone(result.draft), revision: result.lastConfirmedRevision, formData: structuredClone(adopted) }) };
};

test('a two-tab unrelated acknowledgement loads remote pages before the next reorder can use its revision', () => {
  const { directory, save, tab } = setup();
  try {
    const a = tab('a'), b = tab('b');
    const newTree = addPage(a.formData.serviceOfferingsStructure, createPageNode('2', 'Added in tab A'));
    save(envelope(a, withTree(a.formData, newTree), 2));
    const sent = { ...b.formData, companyGoals: 'Unrelated tab B edit' };
    const result = save(envelope(b, sent, 2));
    const server = parseOrganizerResponses(result.draft.responses_json);
    const reconciled = reconcileOrganizerAcknowledgement({ currentFormData: sent, sentFormData: sent, serverFormData: server });
    assert.deepEqual(reconciled.formData.serviceOfferingsStructure, newTree);
    const staleTree = movePage(b.formData.serviceOfferingsStructure, b.formData.serviceOfferingsStructure.pages[0].id, null, 1);
    assert.throws(() => prepareOrganizerWireDraft(envelope(b, withTree(sent, staleTree), 3), server, new Set(reconciled.questionIds), result.lastConfirmedRevision), /Reload/);
    const reloaded = { ...b, draft: result.draft, revision: result.lastConfirmedRevision };
    const safeReorder = movePage(newTree, newTree.pages.at(-1).id, null, 0);
    assert.deepEqual(parseOrganizerResponses(save(envelope(reloaded, withTree(reconciled.formData, safeReorder), 3)).draft.responses_json).serviceOfferingsStructure, safeReorder);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('captured rapid same-tab edits rebase only after their own acknowledged predecessor', () => {
  const { directory, save, tab } = setup();
  try {
    const a = tab('a');
    const firstTree = addPage(a.formData.serviceOfferingsStructure, createPageNode('2', 'First new page'));
    const nextTree = addPage(firstTree, createPageNode('2', 'Second new page'));
    const capturedFirst = envelope(a, withTree(a.formData, firstTree), 2);
    const capturedNext = envelope(a, withTree(a.formData, nextTree), 3);
    const first = save(capturedFirst);
    const server = parseOrganizerResponses(first.draft.responses_json);
    const ack = reconcileOrganizerAcknowledgement({ currentFormData: withTree(a.formData, nextTree), sentFormData: withTree(a.formData, firstTree), serverFormData: server });
    assert.equal(ack.conflict, null);
    assert.deepEqual(ack.formData.serviceOfferingsStructure, nextTree);
    const wire = prepareOrganizerWireDraft(capturedNext, server, new Set(), first.lastConfirmedRevision);
    assert.deepEqual(parseOrganizerResponses(save(wire).draft.responses_json).serviceOfferingsStructure, nextTree);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('conflicting pending trees are retained separately and unrelated pending answers can still save', () => {
  const { directory, save, tab } = setup();
  try {
    const a = tab('a'), b = tab('b');
    const newTree = addPage(a.formData.serviceOfferingsStructure, createPageNode('2', 'Server page'));
    save(envelope(a, withTree(a.formData, newTree), 2));
    const sent = { ...b.formData, companyGoals: 'Sent legacy edit' };
    const result = save(envelope(b, sent, 2));
    const localTree = movePage(b.formData.serviceOfferingsStructure, b.formData.serviceOfferingsStructure.pages[0].id, null, 1);
    const pending = withTree({ ...sent, differentiation: 'Unsent legacy answer' }, localTree);
    const server = parseOrganizerResponses(result.draft.responses_json);
    const ack = reconcileOrganizerAcknowledgement({ currentFormData: pending, sentFormData: sent, serverFormData: server });
    const disk = storage(); preserveOrganizerRecoveryCopy(disk, sessionId, ack.conflict);
    const safeDraft = reconcilePendingOrganizerDraft(envelope(b, pending, 3), server, ack.questionIds);
    const retained = parseOrganizerResponses(safeDraft.responses_json);
    assertCurrentOrganizerSnapshot(retained, server, new Set(ack.questionIds));
    assert.equal(retained.differentiation, 'Unsent legacy answer');
    assert.deepEqual(retained.serviceOfferingsStructure, newTree);
    const reloaded = { ...b, draft: result.draft, revision: result.lastConfirmedRevision };
    save(envelope(reloaded, retained, 3));
    disk.setItem('msp_questionnaire_data_v3', JSON.stringify(state(retained)));
    assert.deepEqual(readOrganizerRecoveryArchive(disk, sessionId).conflicts[0].formData.serviceOfferingsStructure, localTree);
    assert.equal(readOrganizerRecoveryArchive(disk, 'another-session'), null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('reload never trusts a later timestamp without the exact recorded organizer base revision', () => {
  const { directory, tab } = setup();
  try {
    const b = tab('b');
    const localTree = movePage(b.formData.serviceOfferingsStructure, b.formData.serviceOfferingsStructure.pages[0].id, null, 1);
    const local = state(withTree({ ...b.formData, companyGoals: 'Offline legacy edit' }, localTree));
    const remoteTree = addPage(b.formData.serviceOfferingsStructure, createPageNode('2', 'Remote page'));
    const remote = state(withTree(b.formData, remoteTree), '2026-11-13T13:00:00Z');
    for (const base of [null, 1]) {
      const result = reconcileOrganizerHydration({ selectedState: local, localState: local, remoteState: remote, knownBaseRevision: base, serverRevision: 2 });
      assert.deepEqual(result.state.formData.serviceOfferingsStructure, remoteTree);
      assert.equal(result.state.formData.companyGoals, 'Offline legacy edit');
      assert.deepEqual(result.conflict.formData.serviceOfferingsStructure, localTree);
    }
    const disk = storage(); rememberOrganizerBaseRevision(disk, sessionId, local, 2);
    assert.equal(readOrganizerBaseRevision(disk, sessionId, local), 2);
    assert.equal(readOrganizerBaseRevision(disk, sessionId, { ...local, savedAt: 'altered' }), null);
    const allowed = reconcileOrganizerHydration({ selectedState: local, localState: local, remoteState: remote, knownBaseRevision: 2, serverRevision: 2 });
    assert.deepEqual(allowed.state.formData.serviceOfferingsStructure, localTree);
    const clockSkew = reconcileOrganizerHydration({ selectedState: remote, localState: local, remoteState: remote, knownBaseRevision: 2, serverRevision: 2 });
    assert.deepEqual(clockSkew.conflict.formData.serviceOfferingsStructure, localTree);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('an old client cannot downgrade an explicitly empty adopted server question', () => {
  const local = state({ serviceOfferings: ['Managed IT'], companyGoals: 'Legacy edit' });
  const remote = state({ serviceOfferings: [], serviceOfferingsOther: '', serviceOfferingsStructure: { format: 'page-tree-v1', pages: [] } });
  const result = reconcileOrganizerHydration({ selectedState: local, localState: local, remoteState: remote, knownBaseRevision: 4, serverRevision: 4 });
  assert.deepEqual(result.state.formData.serviceOfferingsStructure, remote.formData.serviceOfferingsStructure);
  assert.deepEqual(result.state.formData.serviceOfferings, []);
  assert.equal(result.state.formData.companyGoals, 'Legacy edit');
});

test('an explicit clear acknowledgement establishes the next edit baseline without a reload', () => {
  const { directory, save, tab } = setup();
  try {
    const b = tab('b');
    const cleared = withTree(b.formData, { format: 'page-tree-v1', pages: [] });
    const checkpoint = save(envelope(b, cleared, 2), 'checkpoint');
    const server = parseOrganizerResponses(checkpoint.draft.responses_json);
    assert.equal(reconcileOrganizerAcknowledgement({ currentFormData: cleared, sentFormData: cleared, serverFormData: server }).conflict, null);
    const current = { ...b, draft: checkpoint.draft, revision: checkpoint.lastConfirmedRevision };
    const nextTree = addPage(cleared.serviceOfferingsStructure, createPageNode('2', 'New first page'));
    assert.deepEqual(parseOrganizerResponses(save(envelope(current, withTree(cleared, nextTree), 3)).draft.responses_json).serviceOfferingsStructure, nextTree);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('acknowledgements cannot silently strip an adopted raw tree', () => {
  const adopted = { serviceOfferingsStructure: { format: 'page-tree-v1', pages: [] } };
  assert.throws(() => reconcileOrganizerAcknowledgement({ currentFormData: adopted, sentFormData: adopted, serverFormData: {} }), /did not preserve/);
});

test('a delayed unrelated text callback cannot replace a newer same-tab organizer tree', () => {
  const { directory, tab } = setup();
  try {
    const a = tab('a');
    const oldSnapshot = { ...a.formData, differentiation: 'Finished asynchronous text check' };
    const newTree = addPage(a.formData.serviceOfferingsStructure, createPageNode('2', 'Newest own page'));
    const current = withTree(a.formData, newTree);
    const next = preserveUnchangedOrganizerQuestions(oldSnapshot, current, '3');
    assert.equal(next.differentiation, oldSnapshot.differentiation);
    assert.deepEqual(next.serviceOfferingsStructure, newTree);
    assert.deepEqual(next.serviceOfferingsOther, current.serviceOfferingsOther);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a restored draft first-save callback reconciles an older sent snapshot without locking already-current trees', () => {
  const { directory, tab } = setup();
  try {
    const a = tab('restored-tab');
    const industries = createPageStructure('8', ['Financial', 'CPA'], '', ['Financial', 'CPA']);
    const current = normalizeExpressPageOrganizerFormData({ ...a.formData, targetIndustriesStructure: industries });
    const oldSent = { ...current };
    delete oldSent.serviceOfferingsStructure;
    delete oldSent.targetIndustriesStructure;
    const result = reconcileOrganizerAcknowledgement({ currentFormData: current, sentFormData: oldSent, serverFormData: structuredClone(current) });
    assert.deepEqual(result.questionIds, ['2', '8']);
    assert.equal(result.conflict, null);
    assert.deepEqual(result.formData.serviceOfferingsStructure, current.serviceOfferingsStructure);
    assert.deepEqual(result.formData.targetIndustriesStructure, current.targetIndustriesStructure);
    const pending = reconcilePendingOrganizerDraft(envelope(a, oldSent, 2), current, result.questionIds);
    assert.deepEqual(parseOrganizerResponses(pending.responses_json).targetIndustriesStructure, industries);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a benign already-current question does not hide a real conflict in the other organizer', () => {
  const { directory, tab } = setup();
  try {
    const a = tab('restored-tab');
    const industries = createPageStructure('8', ['Financial', 'CPA'], '', ['Financial', 'CPA']);
    const server = normalizeExpressPageOrganizerFormData({ ...a.formData, targetIndustriesStructure: industries });
    const current = { ...a.formData, targetIndustriesStructure: movePage(industries, industries.pages[0].id, null, 1) };
    const sent = { ...a.formData };
    delete sent.serviceOfferingsStructure;
    const result = reconcileOrganizerAcknowledgement({ currentFormData: current, sentFormData: sent, serverFormData: server });
    assert.deepEqual(result.questionIds, ['2', '8']);
    assert.deepEqual(result.conflict.questionIds, ['8']);
    assert.deepEqual(result.conflict.formData.targetIndustriesStructure, current.targetIndustriesStructure);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a fresh browser recovers adopted server pages without archiving an imaginary local snapshot', () => {
  const { directory, tab } = setup();
  try {
    const restored = tab('fresh-browser');
    const industries = createPageStructure('8', ['Financial', 'CPA'], '', ['Financial', 'CPA']);
    const remote = state(normalizeExpressPageOrganizerFormData({ ...restored.formData, targetIndustriesStructure: industries }));
    const result = reconcileOrganizerHydration({ selectedState: remote, localState: null, remoteState: remote, knownBaseRevision: null, serverRevision: 0 });
    assert.equal(result.state, remote);
    assert.deepEqual(result.questionIds, []);
    assert.equal(result.conflict, null);
    // An actual old snapshot lacking trees remains a real downgrade conflict.
    const legacyLocal = state({ serviceOfferings: ['Managed IT'], targetIndustries: ['Financial'] });
    const olderClient = reconcileOrganizerHydration({ selectedState: legacyLocal, localState: legacyLocal, remoteState: remote, knownBaseRevision: null, serverRevision: 0 });
    assert.deepEqual(olderClient.questionIds, ['2', '8']);
    assert.deepEqual(olderClient.state.formData.serviceOfferingsStructure, remote.formData.serviceOfferingsStructure);
    assert.deepEqual(olderClient.state.formData.targetIndustriesStructure, industries);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
