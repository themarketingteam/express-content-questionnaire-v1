import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import test, { after } from 'node:test';
import ts from 'typescript';
import { createLocalApi } from '../scripts/local-preview-api.mjs';
import { createLatestDraftSaveQueue, createQuestionnaireDraftApi } from '../src/lib/questionnaireDraftApi.js';
import { createDraftMutationEnvelope, reserveClientSequence, synchronizeClientSequence, retryDraftOperation } from '../src/lib/draftSaveReliability.js';
import { getInitialExpressFormData } from '../src/lib/expressQuestionnairePayload.js';
import { createPageStructure } from '../src/lib/pageOrganizerModel.js';
import { parseAuthoritativeDraftResponses, buildPersistedStateFromRemoteDraft } from '../src/lib/remoteDraftState.js';
import * as recovery from '../src/lib/expressOrganizerRecovery.js';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const source = fs.readFileSync(path.join(root, 'src/pages/Questionnaire.jsx'), 'utf8');
const ast = ts.createSourceFile('Questionnaire.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) return nextResolve(new URL(`../src/${specifier.slice(2)}.js`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
after(() => hooks.deregister());
const { buildImmediateDraftRecord, createSaveDraftSnapshot } = await import('../src/lib/draftPersistence.js');
const { buildPersistedState, getDefaultExpandedQuestions } = await import('../src/lib/expressPersistedState.js');

// Execute the production callbacks with controlled IO, without a duplicate
// implementation of their ordering, guards, or state transitions.
function callback(name, context, factory = false) {
  let expression;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(expression, `Production callback ${name} exists`);
  const javascript = ts.transpileModule(`(${expression.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText.trim().replace(/;$/, '');
  const result = new Function('context', `with (context) { return ${javascript}; }`)(context);
  return factory ? result() : result;
}
function harness({ failCheckpoint = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'express-production-save-'));
  const local = createLocalApi(root, { dataDirectory: directory });
  const identity = { sessionId: 'local_callback_session_123456789012345', accessKey: 'local_callback_access_key_12345678901234567890123456789' };
  const boot = local.invoke('questionnaireDraftData', { ...identity, action: 'bootstrap' });
  const original = JSON.parse(boot.draft.responses_json);
  original.serviceOfferingsStructure = createPageStructure('2', original.serviceOfferings);
  const effects = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let heldSave = false;
  const context = {
    ...recovery, createLatestDraftSaveQueue, createDraftMutationEnvelope, retryDraftOperation,
    reserveClientSequence, synchronizeClientSequence, parseAuthoritativeDraftResponses,
    getInitialExpressFormData, buildImmediateDraftRecord, getDefaultExpandedQuestions, buildPersistedState,
    clearInProgressRef: { current: false }, lastClearSequenceRef: { current: 0 },
    draftRequestVersionRef: { current: 0 }, draftSaveTimeoutRef: { current: null },
    draftRevisionRef: { current: 1 }, clientInstanceIdRef: { current: 'callback-tab' },
    submitInFlightRef: { current: false }, hasFinalSubmittedRef: { current: false },
    draftBootstrapReadyRef: { current: true }, lockedOrganizerQuestionsRef: { current: new Set() },
    remoteDraftRef: { current: boot.draft }, lastConfirmedRevisionRef: { current: 0 },
    latestOrganizerFormRef: { current: original }, latestPendingDraftRef: { current: null },
    businessDetailsRef: { current: { businessName: boot.draft.business_name, domain: boot.draft.domain } },
    questionnaireSessionId: identity.sessionId, urlCredentials: {},
    textValidation: { resetAllFields() { effects.push(['reset-validation']); } },
    setFormData(value) { effects.push(['form', value]); context.latestOrganizerFormRef.current = value; },
    setDraftSaveStatus(value) { effects.push(['status', typeof value === 'function' ? value({}) : value]); },
    preserveOrganizerConflict(value) { effects.push(['conflict', value]); },
    assertOrganizerDraftCurrent() {}, reportPersistenceTelemetry: async () => {},
    createDraftEvent() {}, saveStateToLocalStorage() {}, rememberOrganizerBaseRevision() {},
    writeStateMarkerCookie() {}, getOrganizerBrowserStorage: () => null,
    toast: { error: value => effects.push(['error', value]), success: value => effects.push(['success', value]) },
    console: { error() {} }, clearTimeout,
  };
  for (const key of ['setIsClearingAll', 'setShowClearAllConfirm', 'setTouchedQuestions', 'setOpenQuestions', 'setSubmitValidationIssues', 'setSubmitValidationWarnings', 'setSubmitError', 'setRecoveryCode']) context[key] = () => {};
  context.draftApi = createQuestionnaireDraftApi({ ...identity, invoke: async (_name, body) => {
    if (body.action === 'save' && !heldSave) { heldSave = true; await gate; }
    if (body.action === 'checkpoint' && failCheckpoint) throw Object.assign(new Error('unavailable checkpoint'), { status: 400 });
    effects.push(['wire', body]);
    return { data: local.invoke('questionnaireDraftData', body) };
  } });
  context.reconcileAuthoritativeOrganizerDraft = callback('reconcileAuthoritativeOrganizerDraft', context);
  context.enqueueDraftSave = callback('enqueueDraftSave', context, true);
  const clear = callback('performClearAllAnswers', context);
  const pending = createDraftMutationEnvelope(buildImmediateDraftRecord({ sessionId: identity.sessionId, responses: original, validationStatus: {}, touchedQuestions: {}, expandedQuestions: {}, clientRevision: 1 }), { clientInstanceId: 'callback-tab', baseRevision: 0, previousDraft: boot.draft });
  return { context, original, effects, clear, release, pending, local, identity, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('real Clear all callback waits for an in-flight autosave and commits an authoritative empty tree', async () => {
  const h = harness();
  try {
    const older = h.context.enqueueDraftSave(h.pending);
    const clearing = h.clear();
    assert.equal(h.context.clearInProgressRef.current, true);
    assert.deepEqual(h.context.latestOrganizerFormRef.current, h.original, 'Do not empty visible answers while waiting.');
    assert.equal(h.effects.some(([type]) => type === 'form'), false);
    h.release();
    await Promise.all([older, clearing]);
    const wires = h.effects.filter(([type]) => type === 'wire').map(([, body]) => body);
    assert.deepEqual(wires.map(body => body.action), ['save', 'checkpoint']);
    assert.equal(wires[1].checkpointType, 'explicit_clear');
    assert.equal(wires[1].draft.base_revision, 1, 'Clear rebases after prior authoritative acknowledgement.');
    assert.ok(wires[1].draft.client_sequence > wires[0].draft.client_sequence);
    const server = h.local.invoke('questionnaireDraftData', { ...h.identity, action: 'load' }).draft;
    assert.deepEqual(JSON.parse(server.responses_json).serviceOfferingsStructure, { format: 'page-tree-v1', pages: [] });
    assert.equal(JSON.parse(server.responses_json).differentiation, '');
    assert.equal(h.context.latestPendingDraftRef.current, null);
    assert.equal(h.context.clearInProgressRef.current, false);
    assert.ok(h.effects.some(([type]) => type === 'success'));
    const latePersist = callback('persistDraftRecord', h.context);
    await assert.rejects(latePersist(h.pending), error => error.draftSaveSuperseded === true);
    assert.equal(h.local.invoke('questionnaireDraftData', { ...h.identity, action: 'load' }).draft.last_confirmed_revision, 2);
  } finally { h.cleanup(); }
});

test('rejected clear leaves visible answers intact and disables subsequent remote writes until reload', async () => {
  const h = harness({ failCheckpoint: true });
  try {
    const older = h.context.enqueueDraftSave(h.pending);
    const clearing = h.clear(); h.release(); await Promise.all([older, clearing]);
    assert.deepEqual(h.context.latestOrganizerFormRef.current, h.original);
    assert.equal(h.context.draftBootstrapReadyRef.current, false);
    assert.equal(h.context.latestPendingDraftRef.current, null);
    assert.equal(h.effects.some(([type]) => type === 'success'), false);
    assert.equal(h.effects.some(([type]) => type === 'form'), false);
    assert.ok(h.effects.some(([type, status]) => type === 'status' && status.state === 'save_rejected'));
  } finally { h.cleanup(); }
});

test('late validation completion saves current answers after edits and after a completed clear', async () => {
  for (const rejectValidation of [false, true]) {
    let release;
    const gate = new Promise((resolve, reject) => { release = () => rejectValidation ? reject(new Error('unavailable')) : resolve({ status: 'complete' }); });
    const context = {
      formData: { differentiation: 'Before validation' }, latestOrganizerFormRef: { current: { differentiation: 'Before validation' } },
      FIELD_TO_QUESTION: { differentiation: '3' }, getQuestionMetaForField: () => ({ type: 'textarea' }),
      createDraftEvent() {}, urlCredentials: {}, textValidation: { validateField: () => gate },
      queueDraftSave(_id, answers) { context.saved = answers; },
    };
    const validating = callback('handleValidateTextField', context)('differentiation');
    context.latestOrganizerFormRef.current = { differentiation: '' };
    release(); await validating;
    assert.deepEqual(context.saved, { differentiation: '' });
  }
});

test('saveNow treats HTTP 200 stale/finalized responses as unconfirmed snapshots', async () => {
  for (const result of [{ saved: false, stale: true }, { saved: false, stale: true, finalized: true }]) {
    const context = {
      clearInProgressRef: { current: false }, draftBootstrapReadyRef: { current: true }, isHydratedRef: { current: true },
      draftRevisionRef: { current: 10 }, reserveClientSequence, openQuestions: [],
      questionnaireSessionId: 'session', latestOrganizerFormRef: { current: { differentiation: 'Reviewed answer' } },
      textValidation: { getAllFieldStatuses: () => ({}) }, touchedQuestions: {}, urlCredentials: {},
      businessDetailsRef: { current: {} }, businessNameParam: '', domainParam: '', lastChangedQuestionIdRef: { current: '' },
      saveDraftSnapshot: async () => result,
    };
    await assert.rejects(callback('saveDraftNow', context)({ responsesSnapshot: context.latestOrganizerFormRef.current }), error => error.code === 'DRAFT_SNAPSHOT_NOT_CONFIRMED');
    assert.equal(context.draftRevisionRef.current, 11);
    context.draftBootstrapReadyRef.current = false;
    await assert.rejects(callback('saveDraftNow', context)({ responsesSnapshot: {} }), error => error.code === 'DRAFT_NOT_READY');
  }
});

test('quota failures preserve all unique in-memory recovery copies and never mix sessions', () => {
  const denied = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
  const first = recovery.preserveOrganizerRecoveryCopy(denied, 'one', { questionIds: ['2'], formData: { differentiation: 'First unsaved answer' } });
  const second = recovery.preserveOrganizerRecoveryCopy(denied, 'one', { questionIds: ['2'], formData: { differentiation: 'Second unsaved answer' } }, first.archive);
  const third = recovery.preserveOrganizerRecoveryCopy(denied, 'one', { questionIds: ['2'], formData: { differentiation: 'Second unsaved answer' }, serverRevision: 99 }, second.archive);
  assert.equal(third.archive.conflicts.length, 2);
  assert.equal(third.storageSaved, false);
  assert.equal(recovery.preserveOrganizerRecoveryCopy(denied, 'two', { questionIds: ['8'], formData: {} }, third.archive).archive.conflicts.length, 1);
});

test('malformed server answers cannot become an empty authoritative hydration', () => {
  for (const responses_json of ['{broken', 'null', '[]', '"text"']) {
    assert.throws(() => buildPersistedStateFromRemoteDraft({ responses_json }, 'session'), error => error.code === 'DRAFT_SERVER_SNAPSHOT_INVALID');
  }
  assert.deepEqual(parseAuthoritativeDraftResponses({ responses_json: '{}' }), {});
});

test('a normalization exception never calls persistence with blank replacement answers', async () => {
  let saves = 0;
  const responses = { differentiation: 'Keep this answer', get geographicAreas() { throw new Error('Broken input state'); } };
  const save = createSaveDraftSnapshot({ entities: {}, draftRecordIdRef: { current: '' }, findExistingDraftBySessionId: async () => null, persistDraftRecord: async () => { saves += 1; } });
  await assert.rejects(save({ sessionId: 'session', responses }), error => error.code === 'DRAFT_NORMALIZATION_FAILED');
  assert.equal(saves, 0);
  assert.equal(responses.differentiation, 'Keep this answer');
});
