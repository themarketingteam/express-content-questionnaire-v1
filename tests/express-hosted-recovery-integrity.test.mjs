import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import * as organizer from '../base44/shared/pageOrganizerContract.js';
import { requireExpressRecoveryIntegrity, requireExpressRecoveryReceipt } from '../base44/shared/expressSubmissionIntegrity.js';
import { buildExpressSubmissionPayload, getInitialExpressFormData, mapExpressPayloadToFormSubmissionRecord } from '../src/lib/expressQuestionnairePayload.js';

function fixture() {
  const raw = { ...getInitialExpressFormData(), serviceOfferings: ['Cloud', 'Security', 'Help Desk'], targetIndustries: ['Healthcare'], differentiation: 'Complete saved differentiation.', geographicAreas: 'Chicago', idealClient: 'Complete saved client answer.' };
  const payload = buildExpressSubmissionPayload({ formData: raw, businessName: 'Synthetic recovery client', domain: 'example.test', sessionId: 'synthetic-session-123456789', submitAttemptId: 'synthetic-attempt' });
  const draft = { id: 'draft-1', session_id: payload.metadata.questionnaire_session_id, status: 'auto_repair_pending', responses_json: JSON.stringify(raw), mapped_payload_json: JSON.stringify(payload), business_name: payload.metadata.business_name, domain: 'example.test' };
  const intake = { id: 'intake-1', questionnaire_session_id: draft.session_id, submit_attempt_id: 'synthetic-attempt', raw_responses_json: JSON.stringify(raw), transformed_payload_json: JSON.stringify(payload), business_name: payload.metadata.business_name };
  return { raw, payload, draft, intake };
}

async function backend(name, { draft, intake, failLookup = false, existingSubmission = null }) {
  const calls = { creates: 0, deliveries: 0, updates: 0 };
  const base44 = { asServiceRole: { entities: {
    FormDraft: { get: async () => draft, filter: async () => [draft], update: async (_id, patch) => { Object.assign(draft, patch); return draft; } },
    FormSubmissionIntake: { get: async () => intake, filter: async () => [intake], update: async (_id, patch) => { calls.updates++; return { ...intake, ...patch }; } },
    FormSubmission: { get: async () => existingSubmission, filter: async () => { if (failLookup) throw new Error('synthetic lookup outage'); return existingSubmission ? [existingSubmission] : []; }, create: async (record) => { calls.creates++; return { id: 'final-1', ...record }; }, update: async () => ({}) },
  } } };
  let handler;
  const context = { ...organizer, requireExpressRecoveryIntegrity, requireExpressRecoveryReceipt, Response, Request, TextEncoder, crypto, console, AbortController, AbortSignal, setTimeout, clearTimeout,
    createClientFromRequest: () => base44,
    secrets: { get: () => 'synthetic-recovery-secret' },
    authorizeRecoveryRequest: async () => ({ authorized: true, mode: 'admin' }), safeRecoveryLog: () => {},
    withSubmissionSessionLease: async ({ operation }) => operation(draft, { assertOwned: async () => {}, update: async (patch) => { Object.assign(draft, patch); return draft; } }),
    createQuestionnaireVersion: async () => ({ id: 'version-1' }),
    resolveSubmissionIdentity: async () => ({ payload: JSON.parse(draft.mapped_payload_json), resolution: { businessName: { existing: draft.business_name }, domain: { existing: draft.domain }, currentPayloadFingerprint: '' } }),
    createIdentityFingerprint: async () => 'synthetic-fingerprint',
    fetch: async () => { calls.deliveries++; throw new Error('Unexpected network delivery'); },
    Deno: { serve: (value) => { handler = value; }, env: { get: () => '' } },
  };
  const source = await readFile(new URL(`../base44/functions/${name}/entry.ts`, import.meta.url), 'utf8');
  vm.runInNewContext(stripTypeScriptTypes(source.replace(/^import[\s\S]*?;\n/gm, '')), context);
  return { calls, processIntake: context.processIntake, base44,
    send: async (body) => { const response = await handler(new Request('https://example.test/recovery', { method: 'POST', body: JSON.stringify(body) })); return { status: response.status, body: await response.json() }; },
  };
}

for (const name of ['retryQuestionnaireIntakeSubmission', 'repairExpressQuestionnaireIntakeSubmission']) {
  test(`${name} holds partial legacy payloads before final creation or delivery`, async () => {
    const data = fixture();
    data.payload.userdata.service_offerings = ['Cloud'];
    data.intake.transformed_payload_json = JSON.stringify(data.payload);
    data.draft.mapped_payload_json = JSON.stringify(data.payload);
    const harness = await backend(name, data);
    const result = await harness.send({ intakeId: data.intake.id, mode: 'repair_and_retry', recoveryGrant: 'synthetic-grant' });
    assert.equal(result.status, 422, JSON.stringify(result.body));
    assert.equal(result.body.code, 'payload_integrity_mismatch');
    assert.equal(harness.calls.creates, 0);
    assert.equal(harness.calls.deliveries, 0);
  });
  test(`${name} fails closed when a final-submission lookup is unavailable`, async () => {
    const data = fixture();
    const harness = await backend(name, { ...data, failLookup: true });
    const result = await harness.send({ intakeId: data.intake.id, mode: 'repair_and_retry', recoveryGrant: 'synthetic-grant' });
    assert.equal(result.status, 500, JSON.stringify(result.body));
    assert.match(JSON.stringify(result.body), /deduplication is unavailable/);
    assert.equal(harness.calls.creates, 0);
    assert.equal(harness.calls.deliveries, 0);
  });
}

test('scheduled auto repair holds partial raw-to-mapped answers and missing raw evidence', async () => {
  for (const missing of [false, true]) {
    const data = fixture();
    if (missing) { data.intake.raw_responses_json = '{}'; data.draft.responses_json = '{}'; }
    else { data.payload.userdata.ideal_client = 'Shortened'; data.intake.transformed_payload_json = JSON.stringify(data.payload); }
    const harness = await backend('autoRepairRetryIntake', data);
    await assert.rejects(() => harness.processIntake(harness.base44, data.intake), { code: 'payload_integrity_mismatch' });
    assert.equal(harness.calls.creates, 0);
    assert.equal(harness.calls.deliveries, 0);
  }
});

test('scheduled auto repair cannot create through a failed duplicate lookup', async () => {
  const data = fixture();
  const harness = await backend('autoRepairRetryIntake', { ...data, failLookup: true });
  await assert.rejects(() => harness.processIntake(harness.base44, data.intake), /deduplication is unavailable/);
  assert.equal(harness.calls.creates, 0);
});

test('scheduled auto repair preserves a complete submission and its raw snapshot', async () => {
  const data = fixture();
  const harness = await backend('autoRepairRetryIntake', data);
  const result = await harness.processIntake(harness.base44, data.intake);
  assert.equal(result.ok, true);
  assert.equal(harness.calls.creates, 1);
  assert.equal(data.draft.final_submission_id, 'final-1');
});

function existingFinal(data) {
  return { ...mapExpressPayloadToFormSubmissionRecord(data.payload), id: 'existing-final', raw_responses_json: JSON.stringify(data.raw), transformed_payload_json: JSON.stringify(data.payload) };
}

for (const name of ['retryQuestionnaireIntakeSubmission', 'repairExpressQuestionnaireIntakeSubmission']) {
  test(`${name} cannot acknowledge a historically damaged final row`, async () => {
    for (const linked of [false, true]) {
      const data = fixture();
      const final = existingFinal(data); final.service_offerings = [];
      if (linked) data.intake.linked_submission_id = final.id;
      const original = structuredClone(final);
      const harness = await backend(name, { ...data, existingSubmission: final });
      const result = await harness.send({ intakeId: data.intake.id, mode: 'repair_and_retry' });
      assert.equal(result.status, 409, JSON.stringify(result.body));
      assert.equal(result.body.code, 'existing_submission_integrity_mismatch');
      assert.equal(harness.calls.creates, 0);
      assert.equal(harness.calls.deliveries, 0);
      assert.deepEqual(final, original);
    }
  });
}

test('scheduled auto repair verifies an existing receipt rather than acknowledging a damaged mapping', async () => {
  for (const damaged of [false, true]) {
    const data = fixture();
    const final = existingFinal(data);
    if (damaged) final.transformed_payload_json = '{}';
    const harness = await backend('autoRepairRetryIntake', { ...data, existingSubmission: final });
    if (damaged) await assert.rejects(() => harness.processIntake(harness.base44, data.intake), { code: 'existing_submission_integrity_mismatch' });
    else assert.equal((await harness.processIntake(harness.base44, data.intake)).alreadyExists, true);
    assert.equal(harness.calls.creates, 0);
    assert.equal(harness.calls.deliveries, 0);
  }
});

test('force retry reuses an intact attempt-only historical receipt', async () => {
  const data = fixture();
  data.intake.questionnaire_session_id = '';
  data.payload.metadata.questionnaire_session_id = '';
  data.intake.transformed_payload_json = JSON.stringify(data.payload);
  const harness = await backend('retryQuestionnaireIntakeSubmission', { ...data, existingSubmission: existingFinal(data) });
  const result = await harness.send({ intakeId: data.intake.id, forceRetry: true });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.alreadySubmitted, true);
  assert.equal(harness.calls.creates, 0);
});
