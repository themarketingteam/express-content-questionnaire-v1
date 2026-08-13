import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDraftIdentityHash,
  getOrCreateQuestionnaireDraftIdentity,
  readDraftIdentityFromHash,
} from "../src/lib/questionnaireDraftIdentity.js";
import {
  createQuestionnaireDraftApi,
  createSerialDraftSaveQueue,
} from "../src/lib/questionnaireDraftApi.js";
import {
  buildPersistedStateFromRemoteDraft,
  parseRemoteAnswerHistory,
  selectNewestPersistedState,
} from "../src/lib/remoteDraftState.js";

function createStorage() {
  const values = new Map();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function createNavigation(initialHash = "") {
  const location = { pathname: "/", search: "?businessName=Acme", hash: initialHash };
  const history = {
    state: null,
    replaceState(_state, _title, nextUrl) {
      const parsed = new URL(nextUrl, "https://example.test");
      location.pathname = parsed.pathname;
      location.search = parsed.search;
      location.hash = parsed.hash;
    },
  };
  return { location, history };
}

const cryptoApi = {
  randomUUID: () => "11111111-2222-4333-8444-555555555555",
  getRandomValues(bytes) {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index + 1;
    return bytes;
  },
};

test("draft identity survives cleared browser storage through the URL fragment", () => {
  const storage = createStorage();
  const firstNavigation = createNavigation("#section=questionnaire");
  const firstIdentity = getOrCreateQuestionnaireDraftIdentity({
    storage,
    ...firstNavigation,
    cryptoApi,
  });

  assert.equal(firstIdentity.sessionId, "11111111-2222-4333-8444-555555555555");
  assert.match(firstIdentity.accessKey, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(readDraftIdentityFromHash(firstNavigation.location.hash)?.accessKey, firstIdentity.accessKey);

  storage.clear();
  const returnNavigation = createNavigation(firstNavigation.location.hash);
  const restoredIdentity = getOrCreateQuestionnaireDraftIdentity({
    storage,
    ...returnNavigation,
    cryptoApi: {
      ...cryptoApi,
      randomUUID: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    },
  });

  assert.deepEqual(restoredIdentity, firstIdentity);
});

test("draft identity hash preserves unrelated fragment parameters", () => {
  const identity = {
    sessionId: "11111111-2222-4333-8444-555555555555",
    accessKey: "abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890",
  };
  const hash = buildDraftIdentityHash("#section=two", identity);

  assert.equal(new URLSearchParams(hash.slice(1)).get("section"), "two");
  assert.deepEqual(readDraftIdentityFromHash(hash), identity);
});

test("remote draft is converted to a restorable questionnaire state", () => {
  const state = buildPersistedStateFromRemoteDraft({
    session_id: "session_12345678901234567890",
    last_saved_at: "2026-08-13T15:00:00.000Z",
    responses_json: JSON.stringify({ differentiation: "Fast response times" }),
    validation_status_json: JSON.stringify({ differentiation: { status: "complete" } }),
    touched_questions_json: JSON.stringify({ 3: true }),
    expanded_questions_json: JSON.stringify({ 3: true }),
  });

  assert.equal(state.formData.differentiation, "Fast response times");
  assert.equal(state.validationStatus.differentiation.status, "complete");
  assert.equal(state.touchedQuestions[3], true);
  assert.equal(state.savedAt, "2026-08-13T15:00:00.000Z");
});

test("newest snapshot wins and remote answer recovery history is parsed", () => {
  const localState = { savedAt: "2026-08-13T14:00:00.000Z", formData: { idealClient: "Local" } };
  const remoteState = { savedAt: "2026-08-13T15:00:00.000Z", formData: { idealClient: "Remote" } };
  const selected = selectNewestPersistedState(localState, remoteState);
  const history = parseRemoteAnswerHistory({
    last_non_empty_answers_json: JSON.stringify({ idealClient: { value: "Remote" } }),
  });

  assert.equal(selected.source, "server_draft");
  assert.equal(selected.state.formData.idealClient, "Remote");
  assert.equal(history.idealClient.value, "Remote");
});

test("questionnaire draft API includes the scoped identity on load and save", async () => {
  const calls = [];
  const api = createQuestionnaireDraftApi({
    sessionId: "session_12345678901234567890",
    accessKey: "abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890",
    invoke: async (name, body) => {
      calls.push({ name, body });
      return body.action === "load"
        ? { data: { success: true, draft: { id: "draft-1" } } }
        : { data: { success: true, saved: true, draftId: "draft-1" } };
    },
  });

  assert.equal((await api.load()).id, "draft-1");
  await api.save({ responses_json: "{}" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, "questionnaireDraftData");
  assert.equal(calls[0].body.sessionId, "session_12345678901234567890");
  assert.equal(calls[1].body.accessKey, "abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890");
});

test("draft saves are serialized so the first create finishes before later updates", async () => {
  let activeSaves = 0;
  let maximumActiveSaves = 0;
  const completed = [];
  const enqueueSave = createSerialDraftSaveQueue(async ({ revision }) => {
    activeSaves += 1;
    maximumActiveSaves = Math.max(maximumActiveSaves, activeSaves);
    await new Promise((resolve) => setTimeout(resolve, revision === 1 ? 15 : 1));
    completed.push(revision);
    activeSaves -= 1;
    return revision;
  });

  const results = await Promise.all([
    enqueueSave({ revision: 1 }),
    enqueueSave({ revision: 2 }),
    enqueueSave({ revision: 3 }),
  ]);

  assert.equal(maximumActiveSaves, 1);
  assert.deepEqual(completed, [1, 2, 3]);
  assert.deepEqual(results, [1, 2, 3]);
});
