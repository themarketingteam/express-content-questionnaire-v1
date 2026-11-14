import assert from "node:assert/strict";
import test from "node:test";

import { acquireEntityLease, withEntityLease } from "../base44/shared/entityLease.ts";
import { withSubmissionSessionLease } from "../base44/shared/submissionCoordinator.ts";

function createAtomicEntity(initial = {}) {
  const record = {
    id: "draft-1",
    idempotency_lock_token: "",
    idempotency_lock_key: "",
    idempotency_lock_expires_at: new Date(0).toISOString(),
    ...initial,
  };

  return {
    record,
    async get(id) {
      assert.equal(id, record.id);
      return { ...record };
    },
    async updateMany(query, update) {
      const matches = Object.entries(query).every(([key, value]) => (
        value && typeof value === 'object' && '$gt' in value ? record[key] > value.$gt
          : value === null ? record[key] == null : record[key] === value
      ));
      if (matches && update.$set) Object.assign(record, update.$set);
      return { updated: matches ? 1 : 0 };
    },
  };
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("compare-and-set lease serializes concurrent check-and-create operations", async () => {
  const entity = createAtomicEntity();
  const submissions = [];
  let active = 0;
  let maximumActive = 0;

  await Promise.all(Array.from({ length: 12 }, (_, index) => withEntityLease(
    {
      entity,
      entityId: "draft-1",
      purpose: `submission:session-1:attempt-${index}`,
      leaseDurationMs: 2_000,
      waitTimeoutMs: 5_000,
      retryDelayMs: 2,
    },
    async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await pause(3);
      if (!submissions.some((entry) => entry.sessionId === "session-1")) {
        submissions.push({ sessionId: "session-1" });
      }
      active -= 1;
    },
  )));

  assert.equal(maximumActive, 1);
  assert.equal(submissions.length, 1);
  assert.equal(entity.record.idempotency_lock_token, "");
});

test("drafts created before lease fields existed can acquire their first lease", async () => {
  const entity = createAtomicEntity();
  delete entity.record.idempotency_lock_token;
  delete entity.record.idempotency_lock_key;
  delete entity.record.idempotency_lock_expires_at;

  const lease = await acquireEntityLease({
    entity,
    entityId: "draft-1",
    purpose: "submission:legacy-draft",
    waitTimeoutMs: 1_000,
    retryDelayMs: 1,
  });

  assert.equal(entity.record.idempotency_lock_token, lease.token);
  await lease.release();
});

test("expired leases can be recovered and release is idempotent", async () => {
  const entity = createAtomicEntity({
    idempotency_lock_token: "abandoned-token",
    idempotency_lock_key: "old-operation",
    idempotency_lock_expires_at: new Date(Date.now() - 1_000).toISOString(),
  });

  const lease = await acquireEntityLease({
    entity,
    entityId: "draft-1",
    purpose: "pdf:payload-hash:template",
    waitTimeoutMs: 1_000,
    retryDelayMs: 1,
  });

  assert.equal(entity.record.idempotency_lock_token, lease.token);
  await lease.release();
  await lease.release();
  assert.equal(entity.record.idempotency_lock_token, "");
});

test("submission reads the authoritative checkpoint after waiting for a draft writer", async () => {
  const entity = createAtomicEntity({ responses_json: JSON.stringify({ differentiation: "Before save" }), last_confirmed_revision: 0 });
  let discovered;
  const discoveredPromise = new Promise((resolve) => { discovered = resolve; });
  entity.filter = async () => { discovered(); return [{ ...entity.record }]; };
  const writer = await acquireEntityLease({ entity, entityId: "draft-1", purpose: "autosave" });
  const submit = withSubmissionSessionLease({
    base44: { asServiceRole: { entities: { FormDraft: entity } } }, sessionId: "session-1", purpose: "submit",
    operation: async (checkpoint) => checkpoint,
  });
  await discoveredPromise;
  entity.record.responses_json = JSON.stringify({ differentiation: "After save" });
  entity.record.last_confirmed_revision = 1;
  await writer.release();
  const checkpoint = await submit;
  assert.equal(checkpoint.last_confirmed_revision, 1);
  assert.equal(JSON.parse(checkpoint.responses_json).differentiation, "After save");
});

test('long operations renew their lease so another writer cannot enter after the initial expiry', async () => {
  const entity = createAtomicEntity();
  let active = 0;
  let maximumActive = 0;
  await Promise.all([0, 1].map((index) => withEntityLease({ entity, entityId: 'draft-1', purpose: `slow-${index}`, leaseDurationMs: 60, waitTimeoutMs: 1000, retryDelayMs: 2 }, async (lease) => {
    active++; maximumActive = Math.max(maximumActive, active);
    await pause(150);
    await lease.update({ value: index });
    active--;
  })));
  assert.equal(maximumActive, 1);
});

test('expired holder cannot write after takeover, even when resumed after its ownership read', async () => {
  const entity = createAtomicEntity();
  const old = await acquireEntityLease({ entity, entityId: 'draft-1', purpose: 'old', leaseDurationMs: 10 });
  await pause(20);
  const next = await acquireEntityLease({ entity, entityId: 'draft-1', purpose: 'new' });
  await assert.rejects(() => old.update({ value: 'stale' }), { code: 'DRAFT_LEASE_LOST' });
  await next.update({ value: 'latest' });
  await old.release();
  assert.equal(entity.record.value, 'latest');
  assert.equal(entity.record.idempotency_lock_token, next.token);
  await next.release();
});

test('lease update is fenced if ownership changes between the read and the database update', async () => {
  const entity = createAtomicEntity();
  const lease = await acquireEntityLease({ entity, entityId: 'draft-1', purpose: 'writer' });
  const update = entity.updateMany;
  entity.updateMany = async (query, values) => {
    if (Object.hasOwn(values.$set || {}, 'value')) entity.record.idempotency_lock_token = 'other-owner';
    return update(query, values);
  };
  await assert.rejects(() => lease.update({ value: 'stale' }), { code: 'DRAFT_LEASE_LOST' });
  assert.equal(entity.record.value, undefined);
});

test('ambiguous session rows cannot select different save and submission coordinators', async () => {
  const entity = createAtomicEntity();
  entity.filter = async () => [{ ...entity.record }, { ...entity.record, id: 'draft-2' }];
  await assert.rejects(() => withSubmissionSessionLease({ base44: { asServiceRole: { entities: { FormDraft: entity } } }, sessionId: 'duplicate-session', purpose: 'submit', operation: async () => { throw new Error('Must not reach submission'); } }), { code: 'AMBIGUOUS_DRAFT_SESSION' });
});

test('a database acknowledgement that drops checkpoint values is not reported as a saved write', async () => {
  const entity = createAtomicEntity();
  const lease = await acquireEntityLease({ entity, entityId: 'draft-1', purpose: 'verify-write' });
  const update = entity.updateMany;
  entity.updateMany = async (query, values) => Object.hasOwn(values.$set || {}, 'responses_json') ? { updated: 1 } : update(query, values);
  await assert.rejects(() => lease.update({ responses_json: '{"answer":"retained"}' }), { code: 'DRAFT_WRITE_UNVERIFIED' });
  await lease.release();
});

test('verified public credentials select the same unique authorized row despite unrelated session duplicates', async () => {
  const accessKeyHash = 'a'.repeat(64);
  const entity = createAtomicEntity({ draft_access_key_hash: accessKeyHash });
  entity.filter = async () => [{ ...entity.record }, { ...entity.record, id: 'unrelated', draft_access_key_hash: 'b'.repeat(64) }];
  const base44 = { asServiceRole: { entities: { FormDraft: entity } } };
  const selected = await withSubmissionSessionLease({ base44, sessionId: 'session', purpose: 'submit', authority: { draftId: 'draft-1', accessKeyHash }, operation: async (draft) => draft.id });
  assert.equal(selected, 'draft-1');
  await assert.rejects(() => withSubmissionSessionLease({ base44, sessionId: 'session', purpose: 'submit', authority: { draftId: 'unrelated', accessKeyHash }, operation: async () => {} }), { code: 'DRAFT_ACCESS_DENIED' });
  await assert.rejects(() => withSubmissionSessionLease({ base44, sessionId: 'session', purpose: 'submit', authority: { draftId: 'draft-1' }, operation: async () => {} }), { code: 'DRAFT_ACCESS_DENIED' });
});

test('multiple rows sharing a credential remain held even if the caller supplies a row ID', async () => {
  const accessKeyHash = 'a'.repeat(64);
  const entity = createAtomicEntity({ draft_access_key_hash: accessKeyHash });
  entity.filter = async () => [{ ...entity.record }, { ...entity.record, id: 'duplicate' }];
  await assert.rejects(() => withSubmissionSessionLease({ base44: { asServiceRole: { entities: { FormDraft: entity } } }, sessionId: 'session', purpose: 'submit', authority: { draftId: 'draft-1', accessKeyHash }, operation: async () => {} }), { code: 'AMBIGUOUS_DRAFT_SESSION' });
});
