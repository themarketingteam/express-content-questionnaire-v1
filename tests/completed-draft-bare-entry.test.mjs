import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createLocalApi } from '../scripts/local-preview-api.mjs';
import { getInitialExpressFormData, buildExpressSubmissionPayload } from '../src/lib/expressQuestionnairePayload.js';
import { buildPersistedStateFromRemoteDraft } from '../src/lib/remoteDraftState.js';
import * as completed from '../src/lib/completedDraftRevision.js';
import { getOrCreateQuestionnaireDraftIdentity, hasExplicitQuestionnaireDraftReference, readQuestionnaireSessionIdForDiagnostics, readDraftIdentityFromHash } from '../src/lib/questionnaireDraftIdentity.js';
import { readInitialQuestionnaireLaunchIntent, ensureNewClientRequestInUrl, navigateToNewClient } from '../src/lib/questionnaireLaunchIntent.js';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const source = fs.readFileSync(path.join(root, 'src/pages/Questionnaire.jsx'), 'utf8');
const ast = ts.createSourceFile('Questionnaire.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const oldSession = 'completed_browser_session_12345678901234567890';
const oldKey = 'completed_browser_access_key_123456789012345678901234567890';
const storageKey = `msp_questionnaire_data_v3_session_${oldSession}`;
function memoryStorage() {
  const values = new Map([
    ['express_questionnaire_session_id', oldSession],
    ['express_questionnaire_draft_access_key', oldKey],
    [storageKey, JSON.stringify({ formData: { differentiation: 'Preserved browser-only edit' } })],
  ]);
  return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)) };
}
function browser(search = '', hash = '') {
  const location = { pathname: '/', search, hash, assignCalls: [] };
  const apply = (href) => { const url = new URL(href, 'https://express.example.test'); Object.assign(location, { pathname: url.pathname, search: url.search, hash: url.hash }); };
  location.assign = href => { location.assignCalls.push(href); apply(href); };
  const history = { state: null, replaceState(_state, _title, href) { apply(href); } };
  return { location, history };
}
function productionCallback(name, context) {
  let callback;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(callback, `Production ${name} callback exists`);
  return new Function('context', `with(context) { return (${callback.getText(ast)}); }`)(context);
}
function handoffContext(launchIntent, store) {
  const context = {
    ...completed, launchIntent, navigateToNewClient, buildPersistedStateFromRemoteDraft, getInitialExpressFormData,
    questionnaireSessionId: oldSession, completedEntryHandoffRef: { current: false }, completedRecoveryRef: { current: null },
    hasFinalSubmittedRef: { current: false }, draftSaveTimeoutRef: { current: null }, latestPendingDraftRef: { current: { pending: true } },
    latestOrganizerFormRef: { current: {} }, remoteDraftRef: { current: null }, getOrganizerBrowserStorage: () => store,
    clearTimeout, setFormData() {}, setCompletedRecovery() {}, setOpenQuestions() {}, setShowConfirmModal() {}, setDraftSaveStatus() {},
    buildPersistedState: () => ({ formData: {} }),
  };
  context.recognizeCompletedDraft = productionCallback('recognizeCompletedDraft', context);
  return { context, run: productionCallback('startNewClientAfterCompletedRestore', context) };
}

test('the route boundary reads diagnostics without injecting a cached draft into a bare entry', () => {
  const store = memoryStorage(); const environment = browser();
  const boundary = fs.readFileSync(path.join(root, 'src/components/questionnaire/QuestionnaireRouteBoundary.jsx'), 'utf8');
  const boundaryAst = ts.createSourceFile('QuestionnaireRouteBoundary.jsx', boundary, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  let initializer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.name?.getText(boundaryAst) === 'questionnaireSessionId') initializer = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(boundaryAst);
  const readDiagnostic = new Function('readQuestionnaireSessionIdForDiagnostics', `return (${initializer.getText(boundaryAst)});`)(() => readQuestionnaireSessionIdForDiagnostics({ ...environment, storage: store }));
  const before = [...store.values];
  assert.equal(readDiagnostic(), oldSession);
  assert.equal(environment.location.hash, '');
  assert.deepEqual([...store.values], before);
  const intent = readInitialQuestionnaireLaunchIntent(environment.location);
  const restored = getOrCreateQuestionnaireDraftIdentity({ ...environment, storage: store });
  assert.equal(restored.sessionId, oldSession);
  assert.equal(hasExplicitQuestionnaireDraftReference(environment.location), true);
  assert.equal(intent.hasExplicitDraftReference, false, 'The initial entry remains bare even after recovery adds the hash.');
});

test('actual completed-restore callback preserves the old submission and creates one independent blank new-client draft', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'express-bare-completed-'));
  const originalLocation = globalThis.location;
  const fetch = test.mock.method(globalThis, 'fetch', () => { throw new Error('No external requests allowed'); });
  try {
    const api = createLocalApi(root, { dataDirectory: directory });
    const boot = api.invoke('questionnaireDraftData', { action: 'bootstrap', sessionId: oldSession, accessKey: oldKey });
    const responses = JSON.parse(boot.draft.responses_json);
    const payload = buildExpressSubmissionPayload({ formData: responses, businessName: boot.draft.business_name, domain: boot.draft.domain, sessionId: oldSession });
    api.invoke('submitExpressQuestionnaireFallback', { questionnaireSessionId: oldSession, rawResponses: responses, transformedPayload: payload });
    const submitted = api.invoke('questionnaireDraftData', { action: 'load', sessionId: oldSession, accessKey: oldKey }).draft;
    const original = structuredClone(submitted);
    const environment = browser(); globalThis.location = environment.location;
    const store = memoryStorage(); const originalBrowserCopy = store.getItem(storageKey);
    const intent = readInitialQuestionnaireLaunchIntent(environment.location);
    getOrCreateQuestionnaireDraftIdentity({ ...environment, storage: store });
    const { context, run } = handoffContext(intent, store);
    const local = { formData: { ...responses, differentiation: 'Preserved browser-only edit' }, questionnaireSessionId: oldSession };
    assert.equal(run(submitted, local), true);
    assert.equal(run(submitted, local), true, 'Repeated bootstrap completion stays in the same handoff.');
    assert.equal(environment.location.assignCalls.length, 1);
    assert.equal(environment.location.hash, '', 'The new launch does not carry the submitted draft capability.');
    assert.equal(context.hasFinalSubmittedRef.current, true, 'The outgoing page cannot autosave while navigation is pending.');
    assert.equal(context.latestPendingDraftRef.current, null);
    assert.equal(store.getItem(storageKey), originalBrowserCopy);
    assert.equal(completed.readCompletedRecovery(store, oldSession).localState.formData.differentiation, local.formData.differentiation);
    const nextIntent = readInitialQuestionnaireLaunchIntent(environment.location);
    assert.equal(nextIntent.newClient, true);
    assert.equal(nextIntent.promptIdentity, true);
    assert.equal(nextIntent.businessName, ''); assert.equal(nextIntent.domain, '');
    assert.ok(nextIntent.newClientRequestId);
    ensureNewClientRequestInUrl(nextIntent, environment.location, environment.history);
    const nextOptions = { ...environment, storage: store, forceNew: true, newClientRequestId: nextIntent.newClientRequestId };
    const nextIdentity = getOrCreateQuestionnaireDraftIdentity(nextOptions);
    const repeatedIdentity = getOrCreateQuestionnaireDraftIdentity(nextOptions);
    assert.equal(repeatedIdentity.sessionId, nextIdentity.sessionId);
    assert.notEqual(nextIdentity.sessionId, oldSession);
    const next = api.invoke('questionnaireDraftData', { action: 'bootstrap_new_client', ...nextIdentity, newClientRequestId: nextIntent.newClientRequestId, identity: {} });
    const repeated = api.invoke('questionnaireDraftData', { action: 'bootstrap_new_client', ...nextIdentity, newClientRequestId: nextIntent.newClientRequestId, identity: {} });
    assert.equal(next.draftId, repeated.draftId);
    assert.equal(next.draft.status, 'draft'); assert.equal(Boolean(next.draft.final_submission_id), false);
    assert.deepEqual(JSON.parse(next.draft.responses_json), getInitialExpressFormData());
    assert.notEqual(next.draft.business_name, submitted.business_name);
    assert.equal(Object.keys(api.state.drafts).length, 2);
    assert.equal(api.state.submissions.length, 1);
    assert.deepEqual(api.invoke('questionnaireDraftData', { action: 'load', sessionId: oldSession, accessKey: oldKey }).draft, original);
    assert.equal(fetch.mock.callCount(), 0);
  } finally { globalThis.location = originalLocation; fetch.mock.restore(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('explicit completed links, cached active drafts, and explicit new-client launches do not automatically roll over', () => {
  const cases = [
    { environment: browser('', `#draft=${oldSession}&key=${oldKey}`), server: { status: 'submitted' } },
    { environment: browser(), server: { status: 'draft' } },
    { environment: browser(), server: { status: 'submit_failed' } },
    { environment: browser(), server: null },
    { environment: browser('?newClient=true'), server: { status: 'submitted' } },
  ];
  for (const { environment, server } of cases) {
    const intent = readInitialQuestionnaireLaunchIntent(environment.location);
    const { context, run } = handoffContext(intent, memoryStorage());
    assert.equal(run(server), false);
    assert.equal(context.completedEntryHandoffRef.current, false);
    assert.equal(context.hasFinalSubmittedRef.current, false);
    assert.equal(environment.location.assignCalls.length, 0);
  }
});

test('receipt-linked completed drafts roll over with only identity explicitly supplied by the incoming URL', () => {
  const originalLocation = globalThis.location;
  const environment = browser('?businessName=Fresh+Client&domainName=fresh.example&userEmail=new%40example.test');
  globalThis.location = environment.location;
  try {
    const intent = readInitialQuestionnaireLaunchIntent(environment.location);
    const { run } = handoffContext(intent, memoryStorage());
    assert.equal(run({ status: 'draft', final_submission_id: 'receipt', session_id: oldSession, responses_json: '{}', business_name: 'Old client', domain: 'old.example' }, { formData: {} }), true);
    const next = new URLSearchParams(environment.location.search);
    assert.equal(next.get('businessName'), 'Fresh Client'); assert.equal(next.get('domainName'), 'fresh.example');
    assert.equal(next.get('userEmail'), 'new@example.test');
    assert.equal(next.get('promptIdentity'), null);
    assert.equal(environment.location.hash, '');
  } finally { globalThis.location = originalLocation; }
});

test('malformed explicit draft references cannot load or overwrite the browser client or trigger a new client', () => {
  for (const [search, hash] of [['', '#draft=broken'], ['', '#key='], ['', '#draft_session=broken&draft_key=bad'], ['?draft=broken', '']]) {
    const environment = browser(search, hash); const store = memoryStorage(); const before = [...store.values];
    const intent = readInitialQuestionnaireLaunchIntent(environment.location);
    assert.equal(intent.hasExplicitDraftReference, true);
    const identity = getOrCreateQuestionnaireDraftIdentity({ ...environment, storage: store });
    assert.equal(identity.invalidExplicitReference, true);
    assert.equal(identity.sessionId, '');
    assert.equal(readDraftIdentityFromHash(environment.location.hash), null);
    assert.equal(environment.location.hash, hash); assert.equal(environment.location.search, search);
    assert.deepEqual([...store.values], before);
    assert.equal(handoffContext(intent, store).run({ status: 'submitted' }), false);
  }
  const blocked = source.indexOf('if (draftIdentity.invalidExplicitReference)');
  assert.ok(blocked > 0 && blocked < source.indexOf('let localResult = null;', blocked));
  assert.ok(source.indexOf('startNewClientAfterCompletedRestore(remoteDraft, localResult?.state)') < source.indexOf('const detectedIdentityConflict ='));
});
