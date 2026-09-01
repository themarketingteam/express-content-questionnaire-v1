import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  attachDraftLifecycleFlush,
  classifyDraftFailure,
  createKeepaliveDraftSaver,
  retryDraftOperation,
} from "../src/lib/draftSaveReliability.js";
import {
  getOrCreateQuestionnaireDraftIdentity,
  readDraftIdentityFromHash,
} from "../src/lib/questionnaireDraftIdentity.js";
import { createQuestionnaireDraftApi } from "../src/lib/questionnaireDraftApi.js";

function createEventTarget(initial = {}) {
  const listeners = new Map();
  return {
    ...initial,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) || []) listener({ type });
    },
  };
}

test("storage-denied browsers retain a recovery credential in the URL fragment", () => {
  const location = { pathname: "/", search: "", hash: "" };
  const history = {
    state: null,
    replaceState(_state, _title, nextUrl) {
      location.hash = new URL(nextUrl, "https://example.test").hash;
    },
  };
  const deniedStorage = {
    getItem() { throw new Error("storage denied"); },
    setItem() { throw new Error("storage denied"); },
  };
  const cryptoApi = {
    randomUUID: () => "f23f4508-7516-4b1b-81e5-14e0d3d43b05",
    getRandomValues(bytes) {
      bytes.forEach((_, index) => { bytes[index] = index + 1; });
      return bytes;
    },
  };

  const identity = getOrCreateQuestionnaireDraftIdentity({
    storage: deniedStorage,
    location,
    history,
    cryptoApi,
  });

  assert.equal(identity.storageAvailable, false);
  assert.equal(identity.urlCredentialPersisted, true);
  assert.deepEqual(readDraftIdentityFromHash(location.hash), {
    sessionId: identity.sessionId,
    accessKey: identity.accessKey,
  });
});

test("blocked Base44 saves retry and preserve the same pending operation", async () => {
  let calls = 0;
  const retries = [];
  const result = await retryDraftOperation(async () => {
    calls += 1;
    if (calls < 3) throw new TypeError("Failed to fetch");
    return { success: true, lastConfirmedRevision: 7 };
  }, {
    delays: [1, 1],
    sleep: async () => {},
    onRetry: (event) => retries.push(event.code),
  });

  assert.equal(calls, 3);
  assert.deepEqual(retries, ["network_blocked", "network_blocked"]);
  assert.equal(result.lastConfirmedRevision, 7);
});

test("rejected credentials do not generate duplicate save attempts", async () => {
  let calls = 0;
  const error = Object.assign(new Error("denied"), { status: 403 });
  await assert.rejects(() => retryDraftOperation(async () => {
    calls += 1;
    throw error;
  }, { delays: [1, 1], sleep: async () => {} }), /denied/);
  assert.equal(calls, 1);
  assert.deepEqual(classifyDraftFailure(error), { code: "access_denied", retryable: false });
});

test("mobile backgrounding, immediate tab closure, and reconnect flush pending data", async () => {
  const documentTarget = createEventTarget({ visibilityState: "visible" });
  const windowTarget = createEventTarget();
  const flushed = [];
  const lifecycleEvents = [];
  let onlineRetries = 0;
  const pending = { client_revision: 12, responses_json: "{\"idealClient\":\"saved\"}" };
  const cleanup = attachDraftLifecycleFlush({
    documentTarget,
    windowTarget,
    getPendingDraft: () => pending,
    flushDraft: async (draft) => { flushed.push(draft.client_revision); },
    retryPendingDraft: async () => { onlineRetries += 1; },
    onLifecycleEvent: (eventType) => lifecycleEvents.push(eventType),
  });

  documentTarget.visibilityState = "hidden";
  documentTarget.dispatch("visibilitychange");
  windowTarget.dispatch("pagehide");
  windowTarget.dispatch("online");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(flushed, [12, 12]);
  assert.equal(onlineRetries, 1);
  assert.deepEqual(lifecycleEvents, ["visibility_flush", "pagehide_flush", "online_recovery"]);
  cleanup();
});

test("keepalive flush uses the non-null function endpoint and omits credentials", async () => {
  const calls = [];
  const saver = createKeepaliveDraftSaver({
    endpoint: "https://base44.example/api/apps/app-id/functions/questionnaireDraftData",
    sessionId: "session_12345678901234567890",
    accessKey: "abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ success: true, lastConfirmedRevision: 4 }) };
    },
  });

  await saver({ client_revision: 4 });
  assert.doesNotMatch(calls[0].url, /null|undefined/);
  assert.equal(calls[0].options.keepalive, true);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(JSON.parse(calls[0].options.body).draft.client_revision, 4);
});

test("bootstrap is a first-class authenticated draft operation", async () => {
  const calls = [];
  const api = createQuestionnaireDraftApi({
    sessionId: "session_12345678901234567890",
    accessKey: "abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890",
    invoke: async (_name, body) => {
      calls.push(body);
      return { data: { success: true, bootstrapConfirmed: true, draftId: "draft-1", draft: { id: "draft-1" } } };
    },
  });
  const result = await api.bootstrap({ business_name: "Managed 247" }, {
    storageAvailable: false,
    urlCredentialPersisted: true,
  }, 2);

  assert.equal(result.bootstrapConfirmed, true);
  assert.equal(calls[0].action, "bootstrap");
  assert.equal(calls[0].identity.business_name, "Managed 247");
  assert.equal(calls[0].storageAvailable, false);
  assert.equal(calls[0].attempt, 2);
});

test("hung Base44 requests time out so background retries can continue", async () => {
  const api = createQuestionnaireDraftApi({
    sessionId: "session_12345678901234567890",
    accessKey: "abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890",
    requestTimeoutMs: 2,
    invoke: async () => new Promise(() => {}),
  });

  await assert.rejects(() => api.save({ responses_json: "{}" }), (error) => {
    assert.equal(error.code, "timeout");
    assert.equal(error.status, 408);
    return true;
  });
});

test("questionnaire wiring locks editing until bootstrap and reports only confirmed saves", async () => {
  const [questionnaire, status, modal, backend] = await Promise.all([
    readFile(new URL("../src/pages/Questionnaire.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/questionnaire/ExpressDraftSaveStatus.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/questionnaire/ConfirmModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../base44/functions/questionnaireDraftData/entry.ts", import.meta.url), "utf8"),
  ]);

  assert.match(questionnaire, /while \(active && !bootstrapResult\)/);
  assert.match(questionnaire, /draftBootstrapReadyRef\.current = true;[\s\S]*setIsDraftHydrating\(false\)/);
  assert.match(questionnaire, /isDraftHydrating \? "pointer-events-none opacity-60"/);
  assert.match(questionnaire, /attachDraftLifecycleFlush/);
  assert.match(questionnaire, /window\.setInterval[\s\S]*retryLatestDraft/);
  assert.match(status, /Changes waiting for server confirmation/);
  assert.match(status, /revision \{lastConfirmedRevision\} confirmed/);
  assert.match(modal, /onBusinessDetailsChange\?\.\(businessName\.trim\(\), cleanDomain\(domain\)\)/);
  assert.match(backend, /body\.action === 'bootstrap'/);
  assert.match(backend, /last_confirmed_revision: incomingRevision/);
});
