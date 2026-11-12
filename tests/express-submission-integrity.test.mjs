import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";
import { inspectExpressSubmissionIntegrity } from "../base44/shared/expressSubmissionIntegrity.js";
import { buildExpressSubmissionPayload, getInitialExpressFormData } from "../src/lib/expressQuestionnairePayload.js";

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

async function backendHarness({ failRetention = false } = {}) {
  const source = await readFile(new URL("../base44/functions/submitExpressQuestionnaireFallback/entry.ts", import.meta.url), "utf8");
  const executable = stripTypeScriptTypes(source.replace(/^import .*;\n/gm, ""));
  const captures = { intakes: [], checkpointWrites: 0, finalWrites: 0, initialSnapshot: null };
  const draft = { id: "draft-1", business_name: "Synthetic integrity test", domain: "example.test", responses_json: "original-checkpoint", mapped_payload_json: "original-payload" };
  let handler;
  vm.runInNewContext(executable, {
    Response, TextEncoder, crypto, console,
    inspectExpressSubmissionIntegrity,
    Deno: { serve(value) { handler = value; } },
    createClientFromRequest() {
      return { asServiceRole: { entities: {
        FormDraft: { update() { captures.checkpointWrites += 1; throw new Error("Unexpected checkpoint overwrite"); } },
        FormSubmission: { create() { captures.finalWrites += 1; throw new Error("Unexpected final creation"); } },
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
      return operation(draft);
    },
    createQuestionnaireVersion() { captures.checkpointWrites += 1; throw new Error("Unexpected checkpoint overwrite"); },
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
  assert.equal(harness.draft.responses_json, "original-checkpoint");
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
