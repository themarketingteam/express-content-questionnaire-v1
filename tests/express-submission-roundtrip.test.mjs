import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { after } from "node:test";
import { getInitialExpressFormData, buildExpressSubmissionPayload } from "../src/lib/expressQuestionnairePayload.js";

// Exercise the real orchestrator and transformations; only remote IO is mocked.
const sdkUrl = "test:express-submission-sdk";
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/api/base44Client") return { url: sdkUrl, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.js`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === sdkUrl) return {
      format: "module", shortCircuit: true,
      source: `
        export const state = { calls: [], corruptBeforeDelivery: false, rejectExisting: false };
        export const base44 = {
          functions: { invoke: async (name, body) => {
            state.calls.push({ name, body: structuredClone(body) });
            if (name === 'submitExpressQuestionnaireFallback') {
              if (state.rejectExisting) throw Object.assign(new Error('Conflict'), {
                response: {status: 409, data: {code:'existing_submission_integrity_mismatch', error:{message:'Saved answer integrity conflict'}}}
              });
              if (state.corruptBeforeDelivery) body.transformedPayload.userdata.service_offerings = [];
              return { data: { success: true, submissionCreated: true, submissionId: 'synthetic-submission' } };
            }
            if (name === 'sendExpressToZapier') return { data: { success: true } };
            throw new Error('Unexpected remote call: ' + name);
          } },
          entities: { FormSubmission: { update: async () => ({}) } }
        };
      `,
    };
    return nextLoad(url, context);
  },
});
after(() => hooks.deregister());

const { state } = await import(sdkUrl);
const { submitExpressQuestionnaire } = await import("../src/lib/expressQuestionnaireSubmit.js");

function completeAnswers() {
  return {
    ...getInitialExpressFormData(),
    itCompanyType: ["Managed Services Provider (MSP)"],
    itCompanyTypeOther: "Additional type", serviceOfferings: ["Cybersecurity", "Cloud"],
    serviceOfferingsOther: "Additional service", differentiation: "Distinctive expertise.",
    geographicAreas: "Chicago", geographicAreaMeta: { label: "Chicago, IL", source: "google", place_id: "synthetic" },
    pricingPackaging: "Per user", pricingPackagingOther: "Custom packages", companyGoals: "Growth",
    companyGoalsOther: "Long-term relationships", brandTone: "Professional", brandToneOther: "Approachable",
    targetIndustries: ["Manufacturing"], targetIndustriesOther: "Additional industry", clientSize: "50-100 employees",
    clientChallenges: ["Downtime"], clientChallengesOther: "Additional challenge",
    clientOutcomes: ["Productivity"], clientOutcomesOther: "Additional outcome", idealClient: "A growing local business.",
  };
}

function request(responses, overrides = {}) {
  return {
    responses, businessName: "Synthetic roundtrip", domain: "example.test",
    questionnaireSessionId: "synthetic-session", submitAttemptId: "synthetic-attempt",
    validationStatus: {}, touchedQuestions: {}, expandedQuestions: {}, credentials: {}, saveDraftNow: async () => ({ saved: true }),
    ...overrides,
  };
}

test("every checkpoint answer reaches persistence and webhook unchanged", async () => {
  state.calls = [];
  state.corruptBeforeDelivery = false;
  const responses = completeAnswers();
  const original = structuredClone(responses);
  const checkpoints = [];
  const result = await submitExpressQuestionnaire(request(responses, {
    saveDraftNow: async (snapshot) => { checkpoints.push(structuredClone(snapshot)); return { saved: true }; },
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(responses, original);
  const stored = state.calls.find(call => call.name === "submitExpressQuestionnaireFallback").body;
  const delivered = state.calls.find(call => call.name === "sendExpressToZapier").body;
  const expected = buildExpressSubmissionPayload({formData: original}).userdata;
  assert.deepEqual(stored.rawResponses, original);
  assert.deepEqual(stored.transformedPayload.userdata, expected);
  assert.deepEqual(delivered.userdata, expected);
  assert.equal(checkpoints.length, 2);
  for (const checkpoint of checkpoints) assert.deepEqual(checkpoint.responsesSnapshot, original);
});

test("editing a referenced array during async submission cannot change the captured answers", async () => {
  state.calls = [];
  state.corruptBeforeDelivery = false;
  const responses = completeAnswers();
  const original = structuredClone(responses);
  await submitExpressQuestionnaire(request(responses, {
    createDraftEvent: async () => { responses.serviceOfferings.splice(0); },
  }));
  const stored = state.calls.find(call => call.name === "submitExpressQuestionnaireFallback").body;
  assert.deepEqual(stored.rawResponses, original);
  assert.deepEqual(stored.transformedPayload.userdata.service_offerings, original.serviceOfferings);
});

test("answer loss detected at the delivery boundary prevents sending and final success", async () => {
  state.calls = [];
  state.corruptBeforeDelivery = true;
  let succeeded = false;
  const saved = [];
  let failure;
  try {
    await assert.rejects(submitExpressQuestionnaire(request(completeAnswers(), {
      onFinalSubmitSuccess: () => { succeeded = true; },
      onFinalSubmitFailure: details => { failure = details; },
      saveDraftNow: async snapshot => { saved.push(structuredClone(snapshot)); return { saved: true }; },
    })), error => {
      assert.match(error.message, /could not safely prepare all/i);
      assert.equal(error.failureKind, "integrity");
      assert.equal(error.serializedError.code, "payload_integrity_mismatch");
      return true;
    });
    assert.equal(state.calls.some(call => call.name === "sendExpressToZapier"), false);
    assert.equal(succeeded, false);
    assert.equal(saved.at(-1).status, "submit_failed");
    assert.equal(saved.some(snapshot => snapshot.status === "auto_repair_pending"), false);
    assert.deepEqual(saved.at(-1).responsesSnapshot, completeAnswers());
    assert.equal(JSON.parse(saved.at(-1).submitError).code, "payload_integrity_mismatch");
    assert.equal(failure.error.code, "payload_integrity_mismatch");
  } finally {
    state.corruptBeforeDelivery = false;
  }
});

test("a damaged existing submission stays out of automatic repair and delivery", async () => {
  state.calls = [];
  state.rejectExisting = true;
  const saved = [];
  try {
    await assert.rejects(submitExpressQuestionnaire(request(completeAnswers(), {
      saveDraftNow: async snapshot => { saved.push(structuredClone(snapshot)); return { saved: true }; },
    })), /contact support/i);
    assert.equal(state.calls.filter(call => call.name === "submitExpressQuestionnaireFallback").length, 1);
    assert.equal(state.calls.some(call => call.name === "sendExpressToZapier"), false);
    assert.equal(saved.at(-1).status, "submit_failed");
    assert.deepEqual(saved.at(-1).responsesSnapshot, completeAnswers());
  } finally {
    state.rejectExisting = false;
  }
});

test('failed, stale, finalized and missing final-save confirmations prevent persistence and delivery', async () => {
  for (const outcome of [null, undefined, { saved: false, stale: true }, { saved: false, finalized: true }, 'throw']) {
    state.calls = [];
    let failure;
    await assert.rejects(() => submitExpressQuestionnaire(request(completeAnswers(), {
      saveDraftNow: async () => { if (outcome === 'throw') throw new Error('Synthetic save conflict'); return outcome; },
      onFinalSubmitFailure: (value) => { failure = value; },
    })), (error) => error.failureKind === 'persistence' && error.stage === 'submit_checkpoint');
    assert.equal(failure.intakeCaptured, false);
    assert.equal(state.calls.length, 0);
  }
});

test('draft credentials travel only to the persistence transport and never to outbound content', async () => {
  state.calls = [];
  const draftAccessKey = 'synthetic-private-draft-key-1234567890';
  await submitExpressQuestionnaire(request(completeAnswers(), { draftId: 'draft-123', draftAccessKey }));
  const persisted = state.calls.find((call) => call.name === 'submitExpressQuestionnaireFallback').body;
  const webhook = state.calls.find((call) => call.name === 'sendExpressToZapier').body;
  assert.equal(persisted.draftId, 'draft-123');
  assert.equal(persisted.draftAccessKey, draftAccessKey);
  for (const content of [persisted.transformedPayload, persisted.diagnostics, persisted.submitContext, webhook]) assert.equal(JSON.stringify(content).includes(draftAccessKey), false);
});
