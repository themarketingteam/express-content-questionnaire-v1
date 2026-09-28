import assert from "node:assert/strict";
import test from "node:test";

import { applyDurableDraftMutation } from "../base44/shared/durableDraftMutation.ts";
import { createDraftMutationEnvelope } from "../src/lib/draftSaveReliability.js";

function mockBase44(initialDraft, { failVersionWrites = 0, failMaterializations = 0 } = {}) {
  let draft = structuredClone(initialDraft);
  const versions = [];
  let versionFailures = failVersionWrites;
  let materializationFailures = failMaterializations;

  const FormDraft = {
    async get(id) {
      assert.equal(id, draft.id);
      return structuredClone(draft);
    },
    async updateMany(query, update) {
      if (query.id !== draft.id) return { updated: 0 };
      if (Object.prototype.hasOwnProperty.call(query, "idempotency_lock_token")) {
        const expected = query.idempotency_lock_token;
        const actual = draft.idempotency_lock_token ?? null;
        if (expected !== actual) return { updated: 0 };
      }
      Object.assign(draft, structuredClone(update.$set || {}));
      return { updated: 1 };
    },
    async update(id, patch) {
      assert.equal(id, draft.id);
      if (Object.prototype.hasOwnProperty.call(patch, "last_materialized_version_id") && materializationFailures > 0) {
        materializationFailures -= 1;
        throw new Error("simulated materialization failure");
      }
      Object.assign(draft, structuredClone(patch));
      return structuredClone(draft);
    },
  };
  const QuestionnaireVersion = {
    async filter(query) {
      return versions.filter((version) => version.version_key === query.version_key).map((version) => structuredClone(version));
    },
    async create(value) {
      if (versionFailures > 0) {
        versionFailures -= 1;
        throw new Error("simulated immutable write failure");
      }
      const created = { id: `version-${versions.length + 1}`, ...structuredClone(value) };
      versions.push(created);
      return structuredClone(created);
    },
  };
  return {
    client: { asServiceRole: { entities: { FormDraft, QuestionnaireVersion } } },
    state: () => structuredClone(draft),
    versions: () => structuredClone(versions),
  };
}

function baseDraft(overrides = {}) {
  return {
    id: "draft-1",
    session_id: "session-12345678901234567890",
    status: "draft",
    responses_json: JSON.stringify({ differentiation: "Original" }),
    last_confirmed_revision: 0,
    client_revision: 0,
    idempotency_lock_token: "",
    idempotency_lock_key: "",
    idempotency_lock_expires_at: new Date(0).toISOString(),
    ...overrides,
  };
}

function mutation(base44, overrides = {}) {
  return applyDurableDraftMutation({
    base44,
    draftId: "draft-1",
    nextValues: { responses_json: JSON.stringify({ differentiation: "Updated" }) },
    metadata: {
      mutationId: "mutation-1",
      clientInstanceId: "tab-a",
      clientSequence: 1,
      baseRevision: 0,
      changedKeys: ["differentiation"],
      deletedKeys: [],
    },
    versionType: "autosave",
    ...overrides,
  });
}

test("an accepted mutation writes an immutable full snapshot before advancing the draft", async () => {
  const store = mockBase44(baseDraft());
  const result = await mutation(store.client);
  assert.equal(result.accepted, true);
  assert.equal(store.versions().length, 1);
  assert.equal(JSON.parse(store.versions()[0].snapshot_json).responses_json, JSON.stringify({ differentiation: "Updated" }));
  assert.equal(store.state().last_materialized_version_id, store.versions()[0].id);
  assert.equal(store.state().last_confirmed_revision, 1);
});

test("a version-write failure cannot advance the materialized draft", async () => {
  const store = mockBase44(baseDraft(), { failVersionWrites: 1 });
  await assert.rejects(() => mutation(store.client), /immutable write failure/);
  assert.equal(store.versions().length, 0);
  assert.equal(JSON.parse(store.state().responses_json).differentiation, "Original");
  assert.equal(store.state().last_confirmed_revision, 0);
});

test("retrying a retained mutation finishes materialization without duplicating history", async () => {
  const store = mockBase44(baseDraft(), { failMaterializations: 1 });
  await assert.rejects(() => mutation(store.client), /materialization failure/);
  assert.equal(store.versions().length, 1);
  assert.equal(JSON.parse(store.state().responses_json).differentiation, "Original");
  const retried = await mutation(store.client);
  assert.equal(retried.accepted, true);
  assert.equal(retried.duplicate, true);
  assert.equal(store.versions().length, 1);
  assert.equal(JSON.parse(store.state().responses_json).differentiation, "Updated");
});

test("concurrent clients cannot apply an older base revision after a newer save", async () => {
  const store = mockBase44(baseDraft());
  const [first, second] = await Promise.all([
    mutation(store.client),
    mutation(store.client, {
      nextValues: { responses_json: JSON.stringify({ differentiation: "Stale other tab" }) },
      metadata: {
        mutationId: "mutation-other-tab",
        clientInstanceId: "tab-b",
        clientSequence: 1,
        baseRevision: 0,
        changedKeys: ["differentiation"],
        deletedKeys: [],
      },
    }),
  ]);
  assert.equal(first.accepted, true);
  assert.equal(second.stale, true);
  assert.equal(store.versions().length, 1);
  assert.equal(JSON.parse(store.state().responses_json).differentiation, "Updated");
});

test("a finalized questionnaire cannot be downgraded by an autosave", async () => {
  const store = mockBase44(baseDraft({ status: "submitted", final_submission_id: "submission-1" }));
  const result = await mutation(store.client);
  assert.equal(result.accepted, false);
  assert.equal(result.finalized, true);
  assert.equal(store.versions().length, 0);
  assert.equal(store.state().status, "submitted");
});

test("explicit deletion metadata differs from missing state", () => {
  const previous = { responses_json: JSON.stringify({ differentiation: "Keep me", idealClient: "Client" }) };
  const envelope = createDraftMutationEnvelope({
    client_revision: 2,
    responses_json: JSON.stringify({ differentiation: "", idealClient: "Client" }),
  }, {
    clientInstanceId: "tab-a",
    baseRevision: 1,
    previousDraft: previous,
  });
  assert.deepEqual(JSON.parse(envelope.changed_keys_json), ["differentiation"]);
  assert.deepEqual(JSON.parse(envelope.deleted_keys_json), ["differentiation"]);
});
