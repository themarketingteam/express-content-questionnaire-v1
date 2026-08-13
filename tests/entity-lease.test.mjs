import assert from "node:assert/strict";
import test from "node:test";

import { acquireEntityLease, withEntityLease } from "../base44/shared/entityLease.ts";

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
        value === null ? record[key] == null : record[key] === value
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
