import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { draftAllowsAccess, withoutDraftAccessHashes } from '../base44/shared/draftAccess.ts';
import { normalizeIdentityValue, createQuestionnaireVersion } from '../base44/shared/questionnaireVersions.ts';
import { applyDurableDraftMutation } from '../base44/shared/durableDraftMutation.ts';
import { startQuestionnaireRevision } from '../base44/shared/startQuestionnaireRevision.ts';
import { buildExpressSubmissionPayload } from '../src/lib/expressQuestionnairePayload.js';
import { acknowledgeCompletedRevisionRequest, completedDraftRecovery, confirmedRevisionUrl, prepareCompletedRevisionRequest, preserveCompletedRecovery, readCompletedRecovery, readCompletedRevisionRequest, revisionStateFromCompleted } from '../src/lib/completedDraftRevision.js';
import { QUESTIONNAIRE_SESSION_STORAGE_KEY, QUESTIONNAIRE_DRAFT_ACCESS_KEY_STORAGE_KEY } from '../src/lib/questionnaireDraftIdentity.js';
import { createLocalApi } from '../scripts/local-preview-api.mjs';

const sessionId = 'synthetic-completed-session-1234567890';
const accessKey = 'synthetic-completed-access-key-12345678901234567890';
const targetSessionId = 'synthetic-revision-session-1234567890';
const targetAccessKey = 'synthetic-revision-access-key-12345678901234567890';
const revisionRequestId = 'synthetic-revision-request-1234567890';
const hash = async (value) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
const tree = { format: 'page-tree-v1', pages: [{ id: 'stable-parent', label: 'Cloud Services', source: 'custom', catalogId: null, children: [{ id: 'stable-child', label: 'Microsoft 365', source: 'custom', catalogId: null, children: [] }] }] };
function record(responses = { differentiation: 'Submitted answer', serviceOfferingsStructure: tree, serviceOfferings: [], serviceOfferingsOther: 'Cloud Services, Microsoft 365' }) {
  const payload = buildExpressSubmissionPayload({ formData: responses, businessName: 'Synthetic Revision Test', domain: 'revision.example', sessionId });
  return { id: 'completed-source', session_id: sessionId, status: 'submitted', final_submission_id: 'original-receipt', responses_json: JSON.stringify(responses), mapped_payload_json: JSON.stringify({ metadata: payload.metadata, userdata: payload.userdata }), business_name: 'Synthetic Revision Test', domain: 'revision.example', last_confirmed_revision: 9, submitted_at: '2026-11-17T12:00:00.000Z', submit_attempt_id: 'old-attempt', last_saved_at: '2026-11-17T12:00:00.000Z' };
}

async function harness(initial = record(), { failMaterialization = false, dropCreatedFields = [] } = {}) {
  const rows = [{ ...initial, draft_access_key_hash: await hash(accessKey) }];
  const versions = [];
  let failOnce = failMaterialization;
  const equalQuery = (row, query) => Object.entries(query).every(([key, value]) => value && typeof value === 'object' && '$gt' in value ? row[key] > value.$gt : value === null ? row[key] == null : row[key] === value);
  const base44 = { asServiceRole: { entities: {
    FormDraft: {
      filter: async (query) => rows.filter((row) => equalQuery(row, query)).map((row) => structuredClone(row)),
      get: async (id) => structuredClone(rows.find((row) => row.id === id)),
      create: async (value) => {
        const echoed = { ...structuredClone(value), id: `draft-${rows.length}` };
        const stored = structuredClone(echoed);
        for (const key of dropCreatedFields) delete stored[key];
        rows.push(stored); return echoed;
      },
      update: async (id, value) => { const row = rows.find((item) => item.id === id); Object.assign(row, structuredClone(value)); return structuredClone(row); },
      updateMany: async (query, update) => {
        const row = rows.find((item) => equalQuery(item, query));
        if (!row) return { success: true, updated: 0, has_more: false };
        if (failOnce && update.$set.last_materialized_version_id) { failOnce = false; throw new Error('Synthetic interrupted materialization'); }
        Object.assign(row, structuredClone(update.$set)); return { success: true, updated: 1, has_more: false };
      },
    },
    QuestionnaireVersion: {
      filter: async (query) => versions.filter((row) => equalQuery(row, query)),
      create: async (value) => { const row = { id: `version-${versions.length}`, ...structuredClone(value) }; versions.push(row); return row; },
    },
  } } };
  let handler;
  const source = await readFile(new URL('../base44/functions/questionnaireDraftData/entry.ts', import.meta.url), 'utf8');
  vm.runInNewContext(stripTypeScriptTypes(source.replace(/^import[\s\S]*?;\n/gm, '')), {
    Response, TextEncoder, crypto, console,
    draftAllowsAccess, withoutDraftAccessHashes, normalizeIdentityValue, createQuestionnaireVersion, applyDurableDraftMutation, startQuestionnaireRevision,
    createClientFromRequest: () => base44, Deno: { serve: (value) => { handler = value; } },
  });
  return { rows, versions, base44, send: async (body) => {
    const response = await handler(new Request('https://example.test/draft', { method: 'POST', body: JSON.stringify({ sessionId, accessKey, ...body }) }));
    return { status: response.status, body: await response.json() };
  } };
}
const request = (draft) => ({ action: 'start_revision', targetSessionId, targetAccessKey, revisionRequestId, ...(draft ? { draft } : {}) });
const sourceAnswers = (value) => ({ status: value.status, receipt: value.final_submission_id, responses: value.responses_json, submittedAt: value.submitted_at, revision: value.last_confirmed_revision, attempt: value.submit_attempt_id });

test('completed save is explicitly finalized; revision preserves receipt and IDs and retries the same durable copy', async () => {
  const server = await harness();
  const original = sourceAnswers(server.rows[0]);
  const lateSave = await server.send({ action: 'save', draft: { responses_json: '{"differentiation":"Late browser edit"}', client_revision: 10 } });
  assert.equal(lateSave.body.finalized, true);
  assert.equal(lateSave.body.saved, false);
  const created = await server.send(request());
  assert.equal(created.status, 200);
  assert.equal(created.body.revisionStarted, true);
  const draft = created.body.draft;
  assert.notEqual(draft.id, 'completed-source');
  assert.equal(draft.session_id, targetSessionId);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.final_submission_id, '');
  assert.equal(draft.submit_attempt_id, '');
  assert.equal(draft.revision_source_submission_id, 'original-receipt');
  assert.deepEqual(JSON.parse(draft.responses_json).serviceOfferingsStructure, tree);
  assert.equal(JSON.parse(draft.mapped_payload_json).metadata.questionnaire_session_id, targetSessionId);
  assert.equal(JSON.parse(draft.mapped_payload_json).metadata.questionnaire_payload_version, 2);
  assert.deepEqual(sourceAnswers(server.rows[0]), original);
  const retried = await server.send(request());
  assert.equal(retried.body.draftId, draft.id);
  assert.equal(retried.body.duplicate, true);
  assert.equal(server.rows.length, 2);
  assert.equal(server.versions.length, 1);
  const loaded = await server.send({ action: 'load', sessionId: targetSessionId, accessKey: targetAccessKey });
  assert.equal(loaded.body.draft.responses_json, draft.responses_json);
});

test('lost materialization response resumes retained version; subsequent revision edits are not rewound by original request', async () => {
  const server = await harness(record(), { failMaterialization: true });
  assert.equal((await server.send(request())).status, 500);
  assert.equal(server.rows.length, 2);
  assert.equal(server.versions.length, 1, 'The initial copy is retained before acknowledging it.');
  const resumed = await server.send(request());
  assert.equal(resumed.body.saved, true);
  assert.equal(server.versions.length, 1);
  const responses = { ...JSON.parse(resumed.body.draft.responses_json), differentiation: 'Edited inside the new revision' };
  const payload = buildExpressSubmissionPayload({ formData: responses, businessName: 'Synthetic Revision Test', domain: 'revision.example', sessionId: targetSessionId });
  const edit = await server.send({ action: 'save', sessionId: targetSessionId, accessKey: targetAccessKey, mutationId: 'revision-edit', baseRevision: 1, clientSequence: 2, clientInstanceId: 'revision-tab', draft: { responses_json: JSON.stringify(responses), mapped_payload_json: JSON.stringify({ metadata: payload.metadata, userdata: payload.userdata }), client_revision: 2 } });
  assert.equal(edit.body.saved, true);
  const retry = await server.send(request());
  assert.equal(retry.body.saved, true);
  assert.equal(JSON.parse(retry.body.draft.responses_json).differentiation, responses.differentiation);
  assert.equal(server.rows[0].final_submission_id, 'original-receipt');
});

test('revision requires source credential, completed source, and matching target credential on replay', async () => {
  const server = await harness();
  assert.equal((await server.send({ ...request(), accessKey: 'wrong-source-key-1234567890123456789012345' })).status, 403);
  assert.equal(server.rows.length, 1);
  await server.send(request());
  assert.equal((await server.send({ ...request(), targetAccessKey: 'wrong-target-key-1234567890123456789012345' })).status, 403);
  const active = await harness({ ...record(), status: 'draft', final_submission_id: '' });
  assert.equal((await active.send(request())).status, 409);
  assert.equal(active.rows.length, 1);
});

test('legacy revision remains flat without adopting a v2 marker', async () => {
  const responses = { serviceOfferings: ['Managed IT', 'Cloud Services'], serviceOfferingsOther: 'Custom, comma retained', targetIndustries: ['Financial / Accounting / CPA'], targetIndustriesOther: '' };
  const server = await harness(record(responses));
  const result = await server.send(request());
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body.draft.responses_json), responses);
  const payload = JSON.parse(result.body.draft.mapped_payload_json);
  assert.equal(Object.hasOwn(payload.metadata, 'questionnaire_payload_version'), false);
  assert.equal(Object.hasOwn(payload.userdata, 'service_offerings_structure'), false);
});

test('a missing historical receipt does not trap authenticated completed answers, while unreadable answers fail closed', async () => {
  const server = await harness({ ...record(), final_submission_id: '' });
  const started = await server.send(request());
  assert.equal(started.body.revisionStarted, true);
  assert.equal(started.body.draft.revision_source_draft_id, 'completed-source');
  assert.equal(started.body.draft.revision_source_submission_id, '');
  const malformed = await harness({ ...record(), responses_json: '{broken' });
  assert.equal((await malformed.send(request())).status, 409);
  assert.equal(malformed.rows.length, 1);
});

test('silent deployed-schema drops cannot acknowledge a non-retryable revision identity or switch the browser', async () => {
  for (const key of ['revision_request_id_hash', 'revision_source_draft_id', 'revision_created_at', 'draft_access_key_hash', 'responses_json']) {
    const server = await harness(record(), { dropCreatedFields: [key] });
    const original = sourceAnswers(server.rows[0]);
    const result = await server.send(request());
    assert.equal(result.status, 409, `${key} must be verified by reading the created entity.`);
    assert.equal(result.body.code, 'REVISION_NOT_CONFIRMED');
    assert.notEqual(result.body.revisionStarted, true);
    assert.equal(server.versions.length, 0);
    assert.deepEqual(sourceAnswers(server.rows[0]), original);
    assert.throws(() => confirmedRevisionUrl({ targetSessionId, targetAccessKey }, result.body, { href: 'https://example.test/' }), /not been confirmed/);
  }
});

function storage() { const values = new Map(); return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)) }; }
test('completed browser edits are archived, explicitly selected, and cannot switch identity before durable ACK', () => {
  const source = record();
  const remote = { formData: JSON.parse(source.responses_json), questionnaireSessionId: sessionId, savedAt: '2026-11-17T12:00:00Z' };
  const local = { ...remote, savedAt: '2026-11-17T15:00:00Z', formData: { differentiation: 'Unsubmitted browser edit', serviceOfferings: ['Stale legacy choice'] } };
  const recovery = completedDraftRecovery(source, local, remote);
  const store = storage();
  store.setItem(QUESTIONNAIRE_SESSION_STORAGE_KEY, sessionId); store.setItem(QUESTIONNAIRE_DRAFT_ACCESS_KEY_STORAGE_KEY, accessKey);
  assert.equal(preserveCompletedRecovery(store, recovery), true);
  assert.deepEqual(readCompletedRecovery(store, sessionId).localState, local);
  assert.equal(revisionStateFromCompleted(recovery, false).formData.differentiation, 'Submitted answer');
  const selected = revisionStateFromCompleted(recovery, true).formData;
  assert.equal(selected.differentiation, 'Unsubmitted browser edit');
  assert.deepEqual(selected.serviceOfferingsStructure, tree, 'A missing local tree cannot remove server adoption.');
  const pending = prepareCompletedRevisionRequest({ storage: store, sourceSessionId: sessionId, draft: { responses_json: JSON.stringify(selected) } });
  assert.equal(store.getItem(QUESTIONNAIRE_SESSION_STORAGE_KEY), sessionId);
  assert.equal(store.getItem(QUESTIONNAIRE_DRAFT_ACCESS_KEY_STORAGE_KEY), accessKey);
  assert.deepEqual(prepareCompletedRevisionRequest({ storage: store, sourceSessionId: sessionId, draft: { responses_json: '{}' } }), pending, 'Reload retries the original retained copy and target identity.');
  assert.deepEqual(readCompletedRevisionRequest(store, sessionId), pending, 'The UI can show that this retry uses the frozen copy.');
  assert.throws(() => confirmedRevisionUrl(pending, { saved: false }, { href: 'https://example.test/?newClient=true#old' }), /not been confirmed/);
  const href = confirmedRevisionUrl(pending, { saved: true, revisionStarted: true, lastConfirmedRevision: 1, draft: { id: 'revision', session_id: pending.targetSessionId } }, { href: 'https://example.test/?businessName=Synthetic&newClient=true&newClientRequestId=old#old' });
  const url = new URL(href);
  assert.equal(url.searchParams.get('newClient'), null);
  assert.equal(url.searchParams.get('businessName'), 'Synthetic');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('draft'), pending.targetSessionId);
  assert.deepEqual(readCompletedRecovery(store, sessionId).localState, local, 'Successful ACK does not destroy the old recovery copy.');
  assert.equal(acknowledgeCompletedRevisionRequest(store, pending, { saved: false }), false);
  assert.deepEqual(readCompletedRevisionRequest(store, sessionId), pending, 'Failure never releases the idempotent request.');
  assert.equal(acknowledgeCompletedRevisionRequest(store, pending, { saved: true, revisionStarted: true, lastConfirmedRevision: 1, draft: { id: 'revision', session_id: pending.targetSessionId } }), true);
  assert.equal(readCompletedRevisionRequest(store, sessionId), null);
  const nextExplicit = prepareCompletedRevisionRequest({ storage: store, sourceSessionId: sessionId, draft: { responses_json: '{}' } });
  assert.notEqual(nextExplicit.revisionRequestId, pending.revisionRequestId, 'A later explicit action from the original receipt may create another revision.');
  assert.equal(store.getItem(QUESTIONNAIRE_SESSION_STORAGE_KEY), sessionId);
});

test('local preview finalizes once and creates one independent revision that survives restart without external requests', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'express-completed-revision-'));
  const root = path.resolve(new URL('../', import.meta.url).pathname);
  const fetch = test.mock.method(globalThis, 'fetch', () => { throw new Error('No external requests are allowed'); });
  try {
    const api = createLocalApi(root, { dataDirectory: directory });
    const boot = api.invoke('questionnaireDraftData', { sessionId, accessKey, action: 'bootstrap' });
    const responses = JSON.parse(boot.draft.responses_json);
    const payload = buildExpressSubmissionPayload({ formData: responses, businessName: boot.draft.business_name, domain: boot.draft.domain, sessionId });
    const receipt = api.invoke('submitExpressQuestionnaireFallback', { questionnaireSessionId: sessionId, rawResponses: responses, transformedPayload: payload });
    const original = api.invoke('questionnaireDraftData', { sessionId, accessKey, action: 'load' }).draft;
    const lateSave = api.invoke('questionnaireDraftData', { sessionId, accessKey, action: 'save', draft: { responses_json: '{}' } });
    assert.equal(lateSave.finalized, true);
    const body = { sessionId, accessKey, ...request() };
    const revision = api.invoke('questionnaireDraftData', body);
    assert.equal(revision.revisionStarted, true);
    assert.equal(revision.draft.revision_source_submission_id, receipt.submissionId);
    assert.equal(revision.draft.final_submission_id, '');
    assert.deepEqual(JSON.parse(revision.draft.responses_json), responses);
    assert.equal(api.invoke('questionnaireDraftData', body).draftId, revision.draftId);
    const restarted = createLocalApi(root, { dataDirectory: directory });
    assert.deepEqual(restarted.invoke('questionnaireDraftData', { sessionId, accessKey, action: 'load' }).draft, original);
    assert.equal(restarted.invoke('questionnaireDraftData', body).draftId, revision.draftId);
    assert.equal(restarted.state.submissions.length, 1);
    assert.equal(Object.keys(restarted.state.drafts).length, 2);
    assert.equal(fetch.mock.callCount(), 0);
  } finally { fetch.mock.restore(); fs.rmSync(directory, { recursive: true, force: true }); }
});
