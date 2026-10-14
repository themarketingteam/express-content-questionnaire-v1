import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  findQuestionnaireIdentityConflict,
  parseQuestionnaireLaunchIntent,
} from "../src/lib/questionnaireLaunchIntent.js";
import {
  getOrCreateQuestionnaireDraftIdentity,
  readNewClientRequestFromHash,
} from "../src/lib/questionnaireDraftIdentity.js";
import { createLatestDraftSaveQueue, createQuestionnaireDraftApi } from "../src/lib/questionnaireDraftApi.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("newClient accepts domainName and creates a stable request id", () => {
  const intent = parseQuestionnaireLaunchIntent(
    "?newClient=true&businessName=Acme%20IT&domainName=acme.example",
    { randomUUID: () => "request-1234567890-abcdef" },
  );
  assert.equal(intent.newClient, true);
  assert.equal(intent.businessName, "Acme IT");
  assert.equal(intent.domain, "acme.example");
  assert.equal(intent.newClientRequestId, "request-1234567890-abcdef");
});

test("frontend detects a reused draft URL carrying a different client identity", () => {
  assert.deepEqual(
    findQuestionnaireIdentityConflict(
      { business_name: "Acme IT, LLC", domain: "https://www.acme.example/" },
      { business_name: "Different Client", domain: "different.example" },
    ),
    {
      businessName: { existing: "Acme IT, LLC", incoming: "Different Client" },
      domain: { existing: "https://www.acme.example/", incoming: "different.example" },
    },
  );
  assert.equal(
    findQuestionnaireIdentityConflict(
      { business_name: "Acme IT, LLC", domain: "https://www.acme.example/" },
      { business_name: "Acme IT LLC", domain: "acme.example" },
    ),
    null,
  );
});

test("explicit new-client launch ignores an old browser identity and is stable across a rerender", () => {
  const location = { pathname: "/", search: "?newClient=true", hash: "#draft=old_session_12345678901234567890&key=old_access_key_123456789012345678901234567890" };
  const history = {
    state: null,
    replaceState(_state, _title, url) {
      const parsed = new URL(url, "https://example.test");
      location.hash = parsed.hash;
      location.search = parsed.search;
    },
  };
  let uuidCalls = 0;
  const cryptoApi = {
    randomUUID: () => `new_session_1234567890123456789${++uuidCalls}`,
    getRandomValues(bytes) { bytes.fill(7); return bytes; },
  };
  const storage = memoryStorage({
    express_questionnaire_session_id: "stored_old_session_123456789012345",
    express_questionnaire_draft_access_key: "stored_old_access_key_12345678901234567890",
  });
  const options = {
    storage,
    location,
    history,
    cryptoApi,
    forceNew: true,
    newClientRequestId: "request_12345678901234567890",
  };
  const first = getOrCreateQuestionnaireDraftIdentity(options);
  const second = getOrCreateQuestionnaireDraftIdentity(options);
  assert.equal(first.sessionId, second.sessionId);
  assert.notEqual(first.sessionId, "old_session_12345678901234567890");
  assert.equal(readNewClientRequestFromHash(location.hash), "request_12345678901234567890");
});

test("draft save queue keeps the in-flight save and coalesces queued changes to the newest revision", async () => {
  const saved = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const queue = createLatestDraftSaveQueue(async (draft) => {
    saved.push(draft.client_revision);
    if (draft.client_revision === 1) await firstGate;
    return { lastConfirmedRevision: draft.client_revision };
  });
  const first = queue({ client_revision: 1 });
  const second = queue({ client_revision: 2 });
  const third = queue({ client_revision: 3 });
  releaseFirst();
  await Promise.all([first, second, third]);
  assert.deepEqual(saved, [1, 3]);
});

test("new-client bootstrap safely falls back during a rolling public-function deployment", async () => {
  const actions = [];
  const api = createQuestionnaireDraftApi({
    sessionId: "fallback_session_123456789012345",
    accessKey: "fallback_access_key_123456789012345678901234",
    invoke: async (_name, body) => {
      actions.push(body.action);
      if (body.action === "bootstrap_new_client") {
        throw Object.assign(new Error("Request failed"), {
          response: { status: 400, data: { error: "Unsupported action." } },
        });
      }
      return { data: { success: true, bootstrapConfirmed: true, draftId: "draft-fallback", draft: { id: "draft-fallback" } } };
    },
  });
  const result = await api.bootstrapNewClient({}, "request_123456789012345", {}, 1);
  assert.deepEqual(actions, ["bootstrap_new_client", "bootstrap"]);
  assert.equal(result.rollingDeploymentFallback, true);
});

test("backend enforces server-first new-client bootstrap, identity conflicts, and fingerprinted submit dedupe", async () => {
  const [draftBackend, submitBackend, questionnaire] = await Promise.all([
    readFile(new URL("../base44/functions/questionnaireDraftData/entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../base44/functions/submitExpressQuestionnaireFallback/entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Questionnaire.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(draftBackend, /body\.action === 'bootstrap_new_client'/);
  assert.match(draftBackend, /new_client_request_id_hash/);
  assert.match(draftBackend, /identityConflict/);
  assert.match(submitBackend, /submission_identity_conflict/);
  assert.match(submitBackend, /draft_identity_conflict/);
  assert.match(submitBackend, /existingSubmissionMatches/);
  assert.match(submitBackend, /submit-attempt receipt is the primary idempotency key/);
  assert.match(questionnaire, /launchIntent\.newClient[\s\S]*bootstrapNewClient/);
  assert.match(questionnaire, /Start a completely new client\?/);
  assert.match(questionnaire, /ClientIdentityConflictModal/);
});
