import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";
import { hydrateFormSubmissionEntity } from "./helpers/base44EntityHydration.mjs";
import { inspectExpressSubmissionIntegrity, payloadFromStoredExpressSubmission } from "../base44/shared/expressSubmissionIntegrity.js";
import { buildExpressSubmissionPayload, getInitialExpressFormData, mapExpressPayloadToFormSubmissionRecord } from "../src/lib/expressQuestionnairePayload.js";

function completeAnswers() {
  return {
    ...getInitialExpressFormData(),
    itCompanyType: ["Managed Services", "Consulting"],
    itCompanyTypeOther: "Specialized consulting",
    serviceOfferings: ["Cloud", "Security"],
    serviceOfferingsOther: "Custom application support",
    differentiation: "Our complete differentiation answer.",
    geographicAreas: "Chicago",
    geographicAreaMeta: { label: "Chicago, Illinois", lat: 41.88, lon: -87.63, source: "google", place_id: "synthetic-place" },
    pricingPackaging: "Monthly plans",
    pricingPackagingOther: "Custom plans",
    companyGoals: "Grow sustainably",
    companyGoalsOther: "Develop staff",
    brandTone: "Professional",
    brandToneOther: "Approachable",
    targetIndustries: ["Healthcare", "Manufacturing"],
    targetIndustriesOther: "Specialty services",
    clientSize: "10-50 employees",
    clientChallenges: ["Downtime", "Security"],
    clientChallengesOther: "Legacy applications",
    clientOutcomes: ["Reliability", "Growth"],
    clientOutcomesOther: "Predictable costs",
    idealClient: "A complete ideal-client answer.",
  };
}

function build(raw) {
  return buildExpressSubmissionPayload({ formData: raw, businessName: "Synthetic integrity test", domain: "example.test", sessionId: "test-session", submitAttemptId: "test-attempt" });
}

test("integrity guard verifies every mapped questionnaire field without exposing answers", () => {
  const raw = completeAnswers();
  const payload = build(raw);
  const result = inspectExpressSubmissionIntegrity(raw, payload);
  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.checkedFields.length, Object.keys(raw).length);
  for (const field of Object.keys(payload.userdata)) {
    const missing = structuredClone(payload);
    delete missing.userdata[field];
    const rejected = inspectExpressSubmissionIntegrity(raw, missing);
    assert.equal(rejected.ok, false, field);
    assert.ok(rejected.mismatchedFields.includes(`userdata.${field}`), field);
    assert.ok(!JSON.stringify(rejected).includes("Our complete differentiation"));
  }
});

test("integrity guard detects partial array loss, replacement, malformed values and scalar truncation", () => {
  const raw = completeAnswers();
  for (const replacement of [[], ["Cloud"], ["Other"], "Cloud, Security", null]) {
    const payload = build(raw);
    payload.userdata.service_offerings = replacement;
    assert.deepEqual(inspectExpressSubmissionIntegrity(raw, payload).mismatchedFields, ["userdata.service_offerings"]);
  }
  const longRaw = { idealClient: "x".repeat(20001) };
  const truncated = build(longRaw);
  truncated.userdata.ideal_client = truncated.userdata.ideal_client.slice(0, 20000);
  assert.deepEqual(inspectExpressSubmissionIntegrity(longRaw, truncated).mismatchedFields, ["userdata.ideal_client"]);
  const malformed = { serviceOfferings: [{ unexpected: "answer" }] };
  assert.equal(inspectExpressSubmissionIntegrity(malformed, build(malformed)).ok, false);
});

test("integrity guard permits blanks and supported lossless normalization", () => {
  for (const raw of [
    getInitialExpressFormData(),
    { serviceOfferings: " Cloud ", differentiation: ["First", "Second"] },
    { targetIndustries: { label: "Healthcare" }, idealClient: { label: "Client description" } },
    { brandTone: "", targetIndustries: [], geographicAreaMeta: {}, idealClient: null },
  ]) assert.equal(inspectExpressSubmissionIntegrity(raw, build(raw)).ok, true);
});

test("integrity guard understands Google geographic label substitution and metadata order", () => {
  const raw = completeAnswers();
  const payload = build(raw);
  payload.userdata.geographic_area_meta = { place_id: "synthetic-place", source: "google", lon: -87.63, lat: 41.88, label: "Chicago, Illinois" };
  assert.equal(inspectExpressSubmissionIntegrity(raw, payload).ok, true);
  payload.userdata.geographic_area_meta.lat = 0;
  assert.deepEqual(inspectExpressSubmissionIntegrity(raw, payload).mismatchedFields, ["userdata.geographic_area_meta"]);
});

test("missing or unrecognized raw snapshots never claim verified preservation", () => {
  for (const raw of [null, undefined, "{}", [], {}, { metadata: {}, userdata: {} }, { unrecognized: "value" }]) {
    assert.deepEqual(inspectExpressSubmissionIntegrity(raw, build({})), {
      ok: false, available: false, reason: "raw_snapshot_unavailable", mismatchedFields: [], checkedFields: [],
    });
  }
});

async function backendHarness({ failRetention = false, existingSubmission = null, savedDraft = {}, failLookup = false } = {}) {
  const source = await readFile(new URL("../base44/functions/submitExpressQuestionnaireFallback/entry.ts", import.meta.url), "utf8");
  const executable = stripTypeScriptTypes(source.replace(/^import .*;\n/gm, ""));
  const captures = { intakes: [], checkpointWrites: 0, finalWrites: 0, finalUpdates: 0, initialSnapshot: null, versionTypes: [] };
  const draft = { id: "draft-1", business_name: "Synthetic integrity test", domain: "example.test", responses_json: '{"checkpoint":"original"}', mapped_payload_json: "original-payload", ...savedDraft };
  let handler;
  vm.runInNewContext(executable, {
    Response, TextEncoder, crypto, console,
    inspectExpressSubmissionIntegrity, payloadFromStoredExpressSubmission,
    Deno: { serve(value) { handler = value; } },
    createClientFromRequest() {
      return { asServiceRole: { entities: {
        FormDraft: { update(_id, value) {
          captures.checkpointWrites += 1;
          if (!existingSubmission) throw new Error("Unexpected checkpoint overwrite");
          return Promise.resolve({ ...draft, ...value });
        } },
        FormSubmission: {
          filter() { if (failLookup) throw new Error('Synthetic final lookup outage'); return existingSubmission ? [existingSubmission] : []; },
          update() { captures.finalUpdates += 1; return Promise.resolve(existingSubmission); },
          create() { captures.finalWrites += 1; throw new Error("Unexpected final creation"); },
        },
        FormSubmissionIntake: {
          filter() { return []; },
          create(value) {
            if (failRetention) throw new Error("Simulated diagnostics failure");
            captures.intakes.push(value);
            return { id: "rejected-intake-1", ...value };
          },
        },
      } } };
    },
    withSubmissionSessionLease({ initialSnapshot, operation }) {
      captures.initialSnapshot = initialSnapshot;
      return operation(draft, { assertOwned: async () => {}, update: async (value) => {
        captures.checkpointWrites++;
        if (!existingSubmission && !failLookup) throw new Error('Unexpected checkpoint overwrite');
        return { ...draft, ...value };
      } });
    },
    createQuestionnaireVersion(options) {
      captures.versionTypes.push(options.versionType);
      captures.checkpointWrites += 1;
      if (!existingSubmission) throw new Error("Unexpected checkpoint overwrite");
      return { id: `version-${captures.checkpointWrites}` };
    },
  });
  return { captures, draft, send: async (raw, payload) => {
    const response = await handler(new Request("https://example.test/functions/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawResponses: raw, transformedPayload: payload, questionnaireSessionId: "test-session", submitAttemptId: "test-attempt" }),
    }));
    return { status: response.status, body: await response.json() };
  } };
}

test("backend rejects an emptied payload before checkpoint or final writes and retains raw answers separately", async () => {
  const harness = await backendHarness();
  const raw = completeAnswers();
  const payload = build(raw);
  payload.userdata.service_offerings = [];
  const result = await harness.send(raw, payload);
  assert.equal(result.status, 422);
  assert.equal(result.body.code, "payload_integrity_mismatch");
  assert.equal(result.body.success, false);
  assert.equal(result.body.received, false);
  assert.equal(result.body.submissionCreated, false);
  assert.equal(result.body.zapierSent, false);
  assert.equal(harness.captures.checkpointWrites, 0);
  assert.equal(harness.captures.finalWrites, 0);
  assert.equal(harness.draft.responses_json, '{"checkpoint":"original"}');
  assert.equal(harness.captures.initialSnapshot.mapped_payload_json, "");
  assert.equal(harness.captures.intakes.length, 1);
  assert.equal(harness.captures.intakes[0].status, "received_intake");
  assert.deepEqual(JSON.parse(harness.captures.intakes[0].raw_responses_json), raw);
});

test("backend still rejects partial delivery when rejection retention fails or raw evidence is missing", async () => {
  const harness = await backendHarness({ failRetention: true });
  const result = await harness.send(undefined, build(completeAnswers()));
  assert.equal(result.status, 422);
  assert.equal(result.body.error.reason, "raw_snapshot_unavailable");
  assert.equal(result.body.intakeId, null);
  assert.equal(harness.captures.checkpointWrites, 0);
  assert.equal(harness.captures.finalWrites, 0);
});

function storedSubmission(raw, payload) {
  return {
    ...mapExpressPayloadToFormSubmissionRecord(payload),
    id: "existing-submission-1",
    raw_responses_json: JSON.stringify(raw),
    transformed_payload_json: JSON.stringify(payload),
  };
}

test("deduplication rejects corrupted stored payload or normalized answers without modifying the historical row", async () => {
  const raw = completeAnswers();
  const payload = build(raw);
  const mutations = [
    (record) => {
      const savedPayload = JSON.parse(record.transformed_payload_json);
      savedPayload.userdata.service_offerings = [];
      record.transformed_payload_json = JSON.stringify(savedPayload);
    },
    (record) => { record.service_offerings = []; },
    (record) => { record.transformed_payload_json = ""; },
    (record) => { record.transformed_payload_json = "malformed-json"; },
    (record) => { record.ideal_client = "A shortened answer"; },
  ];
  for (const mutate of mutations) {
    const existingSubmission = storedSubmission(raw, payload);
    mutate(existingSubmission);
    const original = structuredClone(existingSubmission);
    const harness = await backendHarness({ existingSubmission });
    const result = await harness.send(raw, payload);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "existing_submission_integrity_mismatch");
    assert.equal(result.body.success, false);
    assert.equal(result.body.received, false);
    assert.equal(result.body.submissionCreated, false);
    assert.equal(result.body.zapierSent, false);
    assert.equal(result.body.submissionId, undefined);
    assert.equal(harness.captures.finalUpdates, 0);
    assert.equal(harness.captures.finalWrites, 0);
    assert.equal(harness.captures.intakes.length, 0);
    assert.deepEqual(existingSubmission, original);
  }
});

test("deduplication accepts an intact saved submission including array-stored company goals", async () => {
  const raw = completeAnswers();
  const payload = build(raw);
  const existingSubmission = storedSubmission(raw, payload);
  assert.deepEqual(existingSubmission.company_goals, [raw.companyGoals]);
  const harness = await backendHarness({ existingSubmission });
  const result = await harness.send(raw, payload);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.alreadySubmitted, true);
  assert.equal(result.body.submissionId, existingSubmission.id);
  assert.equal(harness.captures.finalWrites, 0);
});

test("deduplication accepts an intact version-two flattened record and rejects damaged tree metadata", async () => {
  const raw = completeAnswers();
  raw.serviceOfferingsStructure = {
    format: "page-tree-v1",
    pages: [
      { id: "service-1", label: "Cloud", source: "predefined", catalogId: "q2:option:Cloud", children: [
        { id: "service-2", label: "Security", source: "predefined", catalogId: "q2:option:Security", children: [] },
      ] },
      { id: "service-3", label: "Custom application support", source: "custom", catalogId: null, children: [] },
    ],
  };
  const payload = build(raw);
  for (const damaged of [false, true]) {
    const existingSubmission = storedSubmission(raw, payload);
    assert.equal(existingSubmission.questionnaire_payload_version, 2);
    if (damaged) delete existingSubmission.questionnaire_payload_version;
    const harness = await backendHarness({ existingSubmission: hydrateFormSubmissionEntity(existingSubmission) });
    const result = await harness.send(raw, payload);
    assert.equal(result.status, damaged ? 409 : 200);
    assert.equal(result.body.success, !damaged);
    assert.equal(harness.captures.finalWrites, 0);
  }
});

test('a finalized submission rejects changed answers without replacing its saved checkpoint', async () => {
  const raw = completeAnswers();
  const payload = build(raw);
  const saved = { ...raw, idealClient: 'Authoritative submitted answer' };
  const harness = await backendHarness({ savedDraft: { status: 'submitted', final_submission_id: 'final-1', responses_json: JSON.stringify(saved) } });
  const result = await harness.send(raw, payload);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'draft_finalized');
  assert.equal(harness.captures.checkpointWrites, 0);
  assert.equal(harness.captures.finalWrites, 0);
  assert.equal(harness.draft.responses_json, JSON.stringify(saved));
});

test('an intact finalized receipt does not write another in-progress checkpoint', async () => {
  const raw = completeAnswers();
  const payload = build(raw);
  const existingSubmission = storedSubmission(raw, payload);
  const harness = await backendHarness({ existingSubmission, savedDraft: { status: 'submitted', final_submission_id: existingSubmission.id, responses_json: JSON.stringify(raw) } });
  const result = await harness.send(raw, payload);
  assert.equal(result.status, 200);
  assert.equal(result.body.alreadySubmitted, true);
  assert.deepEqual(harness.captures.versionTypes, ['submitted_snapshot']);
  assert.equal(harness.draft.status, 'submitted');
});

test('a newer saved answer holds an older submit snapshot before checkpoint writes', async () => {
  const raw = completeAnswers();
  const harness = await backendHarness({ savedDraft: { responses_json: JSON.stringify({ ...raw, differentiation: 'Newer answer from another tab' }) } });
  const result = await harness.send(raw, build(raw));
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'draft_changed_before_submit');
  assert.equal(harness.captures.checkpointWrites, 0);
  assert.equal(harness.captures.finalWrites, 0);
});

test('a failed duplicate lookup cannot authorize another final record', async () => {
  const raw = completeAnswers();
  const harness = await backendHarness({ existingSubmission: storedSubmission(raw, build(raw)), failLookup: true });
  const result = await harness.send(raw, build(raw));
  assert.equal(result.status, 500);
  assert.match(result.body.error.message, /deduplication is unavailable/);
  assert.equal(harness.captures.finalWrites, 0);
});


test('legacy receipts remain readable when Base44 adds null organizer fields', async () => {
  const raw = completeAnswers();
  const payload = build(raw);
  const hydrated = hydrateFormSubmissionEntity(storedSubmission(raw, payload));
  assert.equal(hydrated.questionnaire_payload_version, null);
  assert.equal(hydrated.service_offerings_structure, null);
  const harness = await backendHarness({ existingSubmission: hydrated });
  const result = await harness.send(raw, payload);
  assert.equal(result.status, 200);
  assert.equal(result.body.alreadySubmitted, true);
});
