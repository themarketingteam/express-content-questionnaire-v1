import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalApi, createLocalApiMiddleware } from '../scripts/local-preview-api.mjs';
import { buildExpressSubmissionPayload } from '../src/lib/expressQuestionnairePayload.js';
import { createPageStructure, createPageNode, addPage, movePage, projectPageStructure } from '../src/lib/pageOrganizerModel.js';
import { EXPRESS_SERVICE_OPTIONS, EXPRESS_ACCEPTED_INDUSTRY_OPTIONS } from '../src/components/questionnaire/pageOrganizerCatalog.js';
import config from '../vite.local.config.js';
import { installLocalNetworkGuard } from '../src/local/networkGuard.js';
import { synchronizeClientSequence, reserveClientSequence, hasPendingClientMutation, createDraftMutationEnvelope, createKeepaliveDraftSaver, attachDraftLifecycleFlush, retryDraftOperation } from '../src/lib/draftSaveReliability.js';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const sessionId = 'local_test_session_12345678901234567890';
const accessKey = 'local_test_access_key_123456789012345678901234567890';
const credentials = { sessionId, accessKey };
const clone = (value) => JSON.parse(JSON.stringify(value));
let sequence = 0;
const temporary = [];
test.afterEach(() => { for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const setup = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'express-local-api-')); temporary.push(directory);
  const api = createLocalApi(root, { dataDirectory: directory });
  const boot = api.invoke('questionnaireDraftData', { ...credentials, action: 'bootstrap' });
  return { api, boot, directory };
};
const responsesOf = (api) => JSON.parse(api.invoke('questionnaireDraftData', { ...credentials, action: 'load' }).draft.responses_json);
const payloadOf = (responses) => buildExpressSubmissionPayload({ formData: responses, businessName: 'Local Example Networks', domain: 'local-example.test', sessionId, submitAttemptId: 'local-attempt' });
const adopted = (responses, number = '2') => {
  const field = number === '2' ? 'serviceOfferings' : 'targetIndustries';
  const structure = createPageStructure(number, responses[field], responses[`${field}Other`], {}, number === '2' ? EXPRESS_SERVICE_OPTIONS : EXPRESS_ACCEPTED_INDUSTRY_OPTIONS);
  const projection = projectPageStructure(structure);
  return { [field]: projection.selections, [`${field}Other`]: projection.otherValues.join(', '), [`${field}Structure`]: structure };
};
const mutation = (api, patch, overrides = {}) => {
  sequence += 1;
  const draft = api.invoke('questionnaireDraftData', { ...credentials, action: 'load' }).draft;
  return { ...credentials, action: 'save', draft: {
    mutation_id: `mutation-${sequence}`, client_instance_id: 'local-test-tab', client_sequence: sequence,
    base_revision: draft.last_confirmed_revision, client_revision: sequence,
    responses_json: JSON.stringify({ ...JSON.parse(draft.responses_json), ...patch }),
    changed_keys_json: JSON.stringify(Object.keys(patch)), deleted_keys_json: '[]', ...overrides
  } };
};
const save = (api, patch, overrides) => api.invoke('questionnaireDraftData', mutation(api, patch, overrides));

test('legacy bootstrap is idempotent, remains flat, and resumes from disk without adopting either organizer', () => {
  const { api, boot, directory } = setup();
  assert.equal(boot.bootstrapConfirmed, true);
  assert.equal(Object.keys(api.state.drafts).length, 1);
  const before = fs.readFileSync(api.statePath, 'utf8');
  const responses = responsesOf(api);
  assert.equal(responses.serviceOfferings.length, 3);
  assert.equal(responses.targetIndustries.length, 1);
  assert.equal(Object.hasOwn(responses, 'serviceOfferingsStructure'), false);
  assert.equal(Object.hasOwn(responses, 'targetIndustriesStructure'), false);
  assert.deepEqual(api.invoke('questionnaireDraftData', { ...credentials, action: 'bootstrap' }).draft, boot.draft);
  assert.equal(fs.readFileSync(api.statePath, 'utf8'), before);
  assert.equal(before.includes(accessKey), false);
  const restarted = createLocalApi(root, { dataDirectory: directory });
  assert.deepEqual(responsesOf(restarted), responses);
});

test('rich editor IDs survive save/restart while mapped payloads contain only compact ordered nodes', () => {
  const { api, directory } = setup();
  const patch = adopted(responsesOf(api));
  const original = patch.serviceOfferingsStructure;
  const nested = movePage(original, original.pages[1].id, original.pages[0].id);
  const projection = projectPageStructure(nested);
  save(api, { ...patch, serviceOfferingsStructure: nested, serviceOfferings: projection.selections });
  const restarted = createLocalApi(root, { dataDirectory: directory });
  assert.deepEqual(responsesOf(restarted).serviceOfferingsStructure, nested);
  const mapped = JSON.parse(restarted.invoke('questionnaireDraftData', { ...credentials, action: 'load' }).draft.mapped_payload_json);
  assert.equal(mapped.metadata.questionnaire_payload_version, 2);
  assert.deepEqual(mapped.userdata.service_offerings_structure.pages[0], { label: 'Managed IT', source: 'predefined', children: [{ label: 'Microsoft 365', source: 'predefined' }] });
  assert.equal(JSON.stringify(mapped.userdata.service_offerings_structure).includes('catalogId'), false);
  assert.equal(JSON.stringify(mapped.userdata.service_offerings_structure).includes('"id"'), false);
});

test('future formats, stale organizer edits, and legacy downgrades do not modify disk', () => {
  const { api } = setup();
  const legacy = responsesOf(api);
  const patch = adopted(legacy); save(api, patch);
  const before = fs.readFileSync(api.statePath, 'utf8');
  assert.throws(() => save(api, { serviceOfferingsStructure: { format: 'future', pages: [] } }), /page-tree-v1/);
  assert.throws(() => save(api, { serviceOfferings: ['Cybersecurity'] }, { responses_json: JSON.stringify({ ...legacy, serviceOfferings: ['Cybersecurity'] }) }), /Reload before changing/);
  const different = clone(patch.serviceOfferingsStructure); different.pages.reverse();
  assert.throws(() => save(api, { serviceOfferingsStructure: different }, { base_revision: 0, client_instance_id: 'stale-tab' }), /another tab/);
  assert.throws(() => save(api, {}, { deleted_keys_json: '["serviceOfferingsStructure"]' }), /cannot be downgraded/);
  assert.equal(fs.readFileSync(api.statePath, 'utf8'), before);
});

test('an unrelated old-tab change preserves an existing organizer and its mapped projections', () => {
  const { api } = setup(); const legacy = responsesOf(api); const patch = adopted(legacy); save(api, patch);
  save(api, { differentiation: 'Updated text.' }, { responses_json: JSON.stringify({ ...legacy, differentiation: 'Updated text.' }), base_revision: 0, client_instance_id: 'legacy-tab' });
  assert.deepEqual(responsesOf(api).serviceOfferingsStructure, patch.serviceOfferingsStructure);
  assert.equal(responsesOf(api).differentiation, 'Updated text.');
});

test('explicit empty organized reset persists without resurrecting legacy values', () => {
  const { api, directory } = setup(); save(api, adopted(responsesOf(api)));
  const empty = { format: 'page-tree-v1', pages: [] };
  save(api, { serviceOfferings: [], serviceOfferingsOther: '', serviceOfferingsStructure: empty });
  const restarted = createLocalApi(root, { dataDirectory: directory });
  assert.deepEqual(responsesOf(restarted).serviceOfferingsStructure, empty);
  assert.deepEqual(responsesOf(restarted).serviceOfferings, []);
  assert.equal(responsesOf(restarted).targetIndustries.length, 1);
});

test('submission and webhook paths capture locally, deduplicate submissions, and never fetch', () => {
  const { api, directory } = setup(); const fetch = test.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected external request'); });
  try {
    save(api, { ...adopted(responsesOf(api)), ...adopted(responsesOf(api), '8') });
    const responses = responsesOf(api); const payload = payloadOf(responses);
    const body = { questionnaireSessionId: sessionId, rawResponses: responses, transformedPayload: payload };
    const result = api.invoke('submitExpressQuestionnaireFallback', body);
    assert.equal(result.submissionCreated, true);
    assert.equal(api.invoke('submitExpressQuestionnaireFallback', body).duplicate, true);
    const clean = { metadata: payload.metadata, userdata: payload.userdata };
    assert.equal(api.invoke('sendExpressToZapier', clean).localOnly, true);
    assert.equal(api.state.submissions.length, 1); assert.equal(api.state.captures.length, 2);
    assert.deepEqual(api.state.captures[0].payload, clean);
    assert.equal(Object.hasOwn(api.state.captures[0].payload, '_rawFormData'), false);
    assert.equal(fetch.mock.callCount(), 0);
    const restarted = createLocalApi(root, { dataDirectory: directory });
    assert.deepEqual(restarted.state.captures, api.state.captures);
  } finally { fetch.mock.restore(); }
});

test('submission rejects mismatched trees and counts custom parent pages toward the Express cap', () => {
  const { api } = setup(); const patch = adopted(responsesOf(api)); save(api, patch);
  const changed = clone(responsesOf(api)); changed.serviceOfferingsStructure.pages.reverse();
  assert.throws(() => api.invoke('submitExpressQuestionnaireFallback', { questionnaireSessionId: sessionId, rawResponses: changed, transformedPayload: payloadOf(changed) }), /does not match the saved draft/);
  let structure = patch.serviceOfferingsStructure;
  for (let index = 0; index < 4; index += 1) structure = addPage(structure, createPageNode('2', `Custom ${index}`));
  const projection = projectPageStructure(structure);
  save(api, { serviceOfferingsStructure: structure, serviceOfferings: projection.selections, serviceOfferingsOther: projection.otherValues.join(', ') });
  const responses = responsesOf(api);
  assert.throws(() => api.invoke('submitExpressQuestionnaireFallback', { questionnaireSessionId: sessionId, rawResponses: responses, transformedPayload: payloadOf(responses) }), /3–6 services/);
  assert.equal(api.state.captures.length, 0);
});

test('disk failure rolls back memory and retrying the same mutation durably saves it', () => {
  const { api, directory } = setup(); const before = fs.readFileSync(api.statePath, 'utf8'); const body = mutation(api, { idealClient: 'This exact answer must survive a retry and restart.' });
  const rename = test.mock.method(fs, 'renameSync', () => { throw new Error('Simulated rename failure'); });
  try { assert.throws(() => api.invoke('questionnaireDraftData', body), /rename failure/); }
  finally { rename.mock.restore(); }
  assert.deepEqual(clone(api.state), JSON.parse(before)); assert.equal(fs.readFileSync(api.statePath, 'utf8'), before); assert.equal(fs.existsSync(`${api.statePath}.tmp`), false);
  api.invoke('questionnaireDraftData', body);
  assert.equal(responsesOf(createLocalApi(root, { dataDirectory: directory })).idealClient, 'This exact answer must survive a retry and restart.');
});

test('failed submission persistence creates no phantom receipt or capture', () => {
  const { api, directory } = setup(); const responses = responsesOf(api); const body = { questionnaireSessionId: sessionId, rawResponses: responses, transformedPayload: payloadOf(responses) };
  const write = test.mock.method(fs, 'writeFileSync', () => { throw new Error('Simulated disk failure'); });
  try { assert.throws(() => api.invoke('submitExpressQuestionnaireFallback', body), /disk failure/); }
  finally { write.mock.restore(); }
  assert.equal(api.state.submissions.length, 0); assert.equal(api.state.captures.length, 0);
  api.invoke('submitExpressQuestionnaireFallback', body);
  assert.equal(createLocalApi(root, { dataDirectory: directory }).state.submissions.length, 1);
});

test('restore creates a separate draft and does not replace original history', async () => {
  const { api, boot } = setup(); save(api, adopted(responsesOf(api)));
  const before = clone(api.state.drafts[boot.draftId]); const baseline = before.versions[0];
  const restored = await api.handle(new URL('http://localhost:5174/_local/api/restore'), { ...credentials, versionId: baseline.id }, 'POST');
  assert.notEqual(restored.sessionId, sessionId); assert.deepEqual(api.state.drafts[boot.draftId], before);
  const draft = api.invoke('questionnaireDraftData', { ...restored, action: 'load' }).draft;
  assert.equal(Object.hasOwn(JSON.parse(draft.responses_json), 'serviceOfferingsStructure'), false);
  assert.equal(JSON.parse(draft.mapped_payload_json).metadata.questionnaire_session_id, restored.sessionId);
  assert.equal(Object.hasOwn(draft, 'final_submission_id'), false);
});

test('unknown credentials, functions, production routes, and direct submission writes fail closed', async () => {
  const { api } = setup(); assert.throws(() => api.invoke('questionnaireDraftData', { ...credentials, accessKey: 'wrong', action: 'load' }), /credential/);
  assert.throws(() => api.invoke('unknownProductionFunction', {}), /No remote fallback/);
  await assert.rejects(api.handle(new URL('http://localhost:5174/api/apps/production/functions/sendExpressToZapier'), {}, 'POST'), /Remote forwarding is disabled/);
  await assert.rejects(api.handle(new URL('http://localhost:5174/_local/api/entities/FormSubmission/create'), {}, 'POST'), /durable local submission endpoint/);
});

test('middleware denies cross-origin writes before mutating local disk', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'express-local-middleware-')); temporary.push(directory);
  const middleware = createLocalApiMiddleware(directory); const request = { url: '/_local/api/fixture', method: 'POST', headers: { host: 'localhost:5174', origin: 'https://external.example' }, async *[Symbol.asyncIterator]() { yield '{"fixture":"blank"}'; } };
  let responseBody = ''; const response = { statusCode: 200, setHeader() {}, end(text) { responseBody = text; } };
  await middleware(request, response, () => assert.fail('must not forward'));
  assert.equal(response.statusCode, 403); assert.equal(JSON.parse(responseBody).success, false);
  assert.equal(fs.existsSync(path.join(directory, '.local-preview/state.json')), false);
});

test('catalog provenance cannot be forged to submit an unknown predefined page', () => {
  const { api } = setup(); const patch = adopted(responsesOf(api));
  patch.serviceOfferingsStructure.pages[0].catalogId = 'q2:option:Forged'; save(api, patch);
  const responses = responsesOf(api);
  assert.throws(() => api.invoke('submitExpressQuestionnaireFallback', { questionnaireSessionId: sessionId, rawResponses: responses, transformedPayload: payloadOf(responses) }), /unknown catalog identity/);
  assert.equal(api.state.submissions.length, 0);
});

test('local configuration removes trackers, aliases relative/native SDK paths, and defaults to the isolated runtime', () => {
  const isolation = config.plugins.find((plugin) => plugin?.name === 'isolated-local-express');
  const html = isolation.transformIndexHtml.handler('<script src="https://analytics.example/tracker.js"></script>');
  assert.match(html, /src\/local\/main.jsx/); assert.doesNotMatch(html, /https?:\/\/|clarity|hotjar/);
  const match = (source) => config.resolve.alias.find((entry) => entry.find instanceof RegExp && entry.find.test(source))?.replacement;
  for (const source of ['@/api/base44Client', '../api/base44Client.js', './base44Client.js']) assert.match(match(source), /src\/local\/base44Client.js$/);
  for (const source of ['../components/questionnaire/GeographicQuestion', '@/components/questionnaire/GeographicQuestion', './GeographicQuestion']) assert.match(match(source), /LocalGeographicQuestion.jsx$/);
  assert.equal(config.server.host, '127.0.0.1'); assert.equal(config.server.port, 5174); assert.equal(config.server.strictPort, true);
  assert.equal(config.server.proxy, undefined); assert.equal(config.envDir, false);
  assert.match(config.server.headers['Content-Security-Policy'], /connect-src 'self' ws:\/\/localhost:5174 ws:\/\/127.0.0.1:5174;/);
  assert.doesNotMatch(config.server.headers['Content-Security-Policy'], /https?:\/\/|\*/);
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  for (const key of ['dev', 'build', 'preview']) assert.match(scripts[key], /vite.local.config.js/);
});

test('browser guard blocks external fetch, XHR and beacons while permitting only this loopback origin', async () => {
  const names = ['window', 'navigator', 'XMLHttpRequest'];
  const previous = Object.fromEntries(names.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const calls = [];
  class LocalXhr { open(...args) { calls.push(args); } }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hostname: 'localhost', origin: 'http://localhost:5174', href: 'http://localhost:5174/' }, fetch: async (...args) => { calls.push(args); return { ok: true }; } } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon: () => assert.fail('Beacon transport must not run') } });
  Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: LocalXhr });
  try {
    installLocalNetworkGuard();
    assert.throws(() => globalThis.window.fetch('https://base44.app/api/apps/live/entities'), /blocked external/);
    assert.throws(() => globalThis.window.fetch(new URL('http://localhost:5173/_local/api/state')), /blocked external/);
    assert.throws(() => new globalThis.XMLHttpRequest().open('POST', 'https://webhook.example/submit'), /blocked external/);
    assert.throws(() => navigator.sendBeacon('https://analytics.example/event'), /blocked external/);
    assert.equal(calls.length, 0);
    await globalThis.window.fetch('/_local/api/health'); assert.equal(calls.length, 1);
    assert.equal(navigator.sendBeacon('/_local/analytics'), false);
  } finally { for (const key of names) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; } }
});

test('reload hydration cannot rewind sequences when newer autosaves finish before its acknowledgment', async () => {
  const { api } = setup();
  save(api, adopted(responsesOf(api)), { client_instance_id: 'before-reload-client', client_revision: 24, client_sequence: 24, mutation_id: 'before-reload-24' });
  const bootstrap = api.invoke('questionnaireDraftData', { ...credentials, action: 'bootstrap' });
  const counter = { current: 0 };
  synchronizeClientSequence(counter, bootstrap.lastConfirmedRevision, bootstrap.draft.client_revision);
  assert.equal(counter.current, 24);
  let acknowledge;
  const delayedAcknowledgment = new Promise((resolve) => { acknowledge = resolve; });
  const sent = [];
  const send = (patch, sequence, action = 'save') => {
    sent.push(sequence);
    const body = mutation(api, patch, { client_instance_id: 'reloaded-client', client_revision: sequence, client_sequence: sequence, mutation_id: `reloaded-${sequence}` });
    body.action = action;
    return api.invoke('questionnaireDraftData', body);
  };
  const hydration = (async () => {
    const reserved = reserveClientSequence(counter);
    const result = send({}, reserved);
    await delayedAcknowledgment;
    // Completion is an observation, never an assignment of the earlier counter.
    synchronizeClientSequence(counter, result.lastConfirmedRevision, result.draft.client_revision);
  })();
  send({ differentiation: 'First rapid edit during hydration.' }, reserveClientSequence(counter));
  send({ differentiation: 'Second rapid edit during hydration.' }, reserveClientSequence(counter));
  acknowledge(); await hydration;
  let attempts = 0;
  await retryDraftOperation(async () => { attempts += 1; return send({}, reserveClientSequence(counter), 'checkpoint'); }, { sleep: async () => assert.fail('A healthy post-reload checkpoint must not retry') });
  assert.equal(attempts, 1);
  assert.deepEqual(sent, [25, 26, 27, 28]);
  const responses = responsesOf(api);
  assert.equal(responses.differentiation, 'Second rapid edit during hydration.');
  assert.equal(api.invoke('submitExpressQuestionnaireFallback', { questionnaireSessionId: sessionId, rawResponses: responses, transformedPayload: payloadOf(responses) }).submissionCreated, true);
  const stale = mutation(api, {}, { client_instance_id: 'reloaded-client', client_revision: 26, client_sequence: 26, mutation_id: 'reused-sequence-with-new-id' });
  assert.throws(() => api.invoke('questionnaireDraftData', stale), /newer saved mutation/);
});

test('client acknowledgment is scoped to its client sequence, never the server revision or another tab', () => {
  const pending = { client_revision: 28, client_sequence: 28 };
  assert.equal(hasPendingClientMutation(pending, { last_confirmed_revision: 500, last_client_instance_id: 'other-tab', last_client_sequence: 300 }, 'this-tab'), true);
  assert.equal(hasPendingClientMutation(pending, { last_confirmed_revision: 500, last_client_instance_id: 'this-tab', last_client_sequence: 27 }, 'this-tab'), true);
  assert.equal(hasPendingClientMutation(pending, { last_confirmed_revision: 2, last_client_instance_id: 'this-tab', last_client_sequence: 28 }, 'this-tab'), false);
  const counter = { current: 28 }; synchronizeClientSequence(counter, 2, 24); assert.equal(reserveClientSequence(counter), 29);
  assert.throws(() => reserveClientSequence({ current: Number.MAX_SAFE_INTEGER }), /counter is exhausted/);
});

test('pagehide sends an immediately enveloped pending mutation before the debounce timer runs', async () => {
  const { api, boot } = setup(); const original = responsesOf(api);
  const pending = createDraftMutationEnvelope({ responses_json: JSON.stringify({ ...original, idealClient: 'An immediate pagehide edit.' }), client_revision: 24 }, { clientInstanceId: 'pagehide-client', baseRevision: boot.lastConfirmedRevision, previousDraft: boot.draft });
  const requests = [];
  const keepalive = createKeepaliveDraftSaver({ endpoint: '/_local/api/functions/questionnaireDraftData', ...credentials, fetchImpl: async (endpoint, options) => {
    requests.push({ endpoint, options });
    const body = JSON.parse(options.body); const data = api.invoke('questionnaireDraftData', body);
    return { ok: true, json: async () => data };
  } });
  const windowTarget = new EventTarget(); const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let flushed;
  const cleanup = attachDraftLifecycleFlush({ documentTarget, windowTarget, getPendingDraft: () => pending, flushDraft: (draft) => { flushed = keepalive(draft); return flushed; }, retryPendingDraft: async () => {} });
  windowTarget.dispatchEvent(new Event('pagehide')); const result = await flushed; cleanup();
  assert.equal(requests.length, 1); assert.equal(requests[0].options.keepalive, true);
  const wire = JSON.parse(requests[0].options.body).draft;
  assert.equal(wire.client_instance_id, 'pagehide-client'); assert.equal(wire.client_sequence, 24); assert.equal(wire.mutation_id, 'save:pagehide-client:24');
  assert.equal(responsesOf(api).idealClient, 'An immediate pagehide edit.');
  assert.equal(hasPendingClientMutation(pending, result.draft, 'pagehide-client'), false);
});

test('revision conflicts require review and do not retry the same stale mutation', async () => {
  let calls = 0;
  await assert.rejects(retryDraftOperation(async () => { calls += 1; throw Object.assign(new Error('Another tab changed the draft.'), { status: 409 }); }, { sleep: async () => assert.fail('A revision conflict cannot be fixed by retrying unchanged data') }), /Another tab/);
  assert.equal(calls, 1);
});

test('a queued pre-clear snapshot cannot restore pages even if its worker rebases to the latest server revision', () => {
  const { api } = setup(); const patch = adopted(responsesOf(api)); save(api, patch);
  const queuedBeforeClear = mutation(api, patch);
  const clear = mutation(api, { serviceOfferings: [], serviceOfferingsOther: '', serviceOfferingsStructure: { format: 'page-tree-v1', pages: [] } });
  clear.action = 'checkpoint';
  const accepted = api.invoke('questionnaireDraftData', clear);
  const diskAfterClear = fs.readFileSync(api.statePath, 'utf8');
  queuedBeforeClear.draft.base_revision = accepted.lastConfirmedRevision;

  assert.throws(() => api.invoke('questionnaireDraftData', queuedBeforeClear), /newer saved mutation/);
  assert.equal(fs.readFileSync(api.statePath, 'utf8'), diskAfterClear);
  assert.deepEqual(responsesOf(api).serviceOfferingsStructure.pages, []);
  assert.deepEqual(responsesOf(api).serviceOfferings, []);
});

test('retrying an already accepted pre-clear mutation acknowledges current empty pages instead of materializing its old body', () => {
  const { api } = setup(); const patch = adopted(responsesOf(api));
  const original = mutation(api, patch); api.invoke('questionnaireDraftData', original);
  const clear = mutation(api, { serviceOfferings: [], serviceOfferingsOther: '', serviceOfferingsStructure: { format: 'page-tree-v1', pages: [] } });
  clear.action = 'checkpoint'; api.invoke('questionnaireDraftData', clear);
  const duplicate = api.invoke('questionnaireDraftData', original);

  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(JSON.parse(duplicate.draft.responses_json).serviceOfferingsStructure.pages, []);
  assert.deepEqual(responsesOf(api).serviceOfferings, []);
});

test('a restored record accepts its first fresh sequence even when the original browser client had reached a much higher sequence', async () => {
  const { api, boot } = setup();
  const patch = adopted(responsesOf(api));
  save(api, patch, { client_instance_id: 'same-browser-client', client_revision: 100, client_sequence: 100, mutation_id: 'original-100' });
  save(api, { idealClient: 'A later answer retained in the original record.' }, { client_instance_id: 'same-browser-client', client_revision: 101, client_sequence: 101, mutation_id: 'original-101' });
  const original = clone(api.state.drafts[boot.draftId]);
  const version = original.versions.find((entry) => entry.draft.last_client_sequence === 100);
  assert.ok(version);
  const restoredIdentity = await api.handle(new URL('http://localhost:5174/_local/api/restore'), { ...credentials, versionId: version.id }, 'POST');
  const restored = api.invoke('questionnaireDraftData', { ...restoredIdentity, action: 'load' }).draft;
  assert.notEqual(restored.id, original.id);
  assert.equal(restored.client_revision, 0);
  assert.equal(restored.last_confirmed_revision, 0);
  assert.equal(restored.last_client_instance_id, '');
  assert.equal(restored.last_client_sequence, 0);
  assert.deepEqual(api.state.drafts[restored.id].clients, {});
  assert.deepEqual(api.state.drafts[restored.id].mutations, {});
  const responses = { ...JSON.parse(restored.responses_json), idealClient: 'First edit in the restored draft.' };
  const firstSave = createDraftMutationEnvelope({ responses_json: JSON.stringify(responses), client_revision: 1 }, { clientInstanceId: 'same-browser-client', baseRevision: 0, previousDraft: restored });
  const result = api.invoke('questionnaireDraftData', { ...restoredIdentity, action: 'save', draft: firstSave });
  assert.equal(result.saved, true);
  assert.equal(result.lastConfirmedRevision, 1);
  assert.equal(result.draft.last_client_sequence, 1);
  assert.deepEqual(JSON.parse(result.draft.responses_json).serviceOfferingsStructure, patch.serviceOfferingsStructure);
  assert.equal(JSON.parse(result.draft.responses_json).idealClient, 'First edit in the restored draft.');
  assert.deepEqual(api.state.drafts[boot.draftId], original);
});
