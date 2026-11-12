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
        export const state = { calls: [], corruptBeforeDelivery: false };
        export const base44 = {
          functions: { invoke: async (name, body) => {
            state.calls.push({ name, body: structuredClone(body) });
            if (name === 'submitExpressQuestionnaireFallback') {
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
    validationStatus: {}, touchedQuestions: {}, expandedQuestions: {}, credentials: {},
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
    saveDraftNow: async (snapshot) => checkpoints.push(structuredClone(snapshot)),
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
  try {
    await assert.rejects(submitExpressQuestionnaire(request(completeAnswers(), {
      onFinalSubmitSuccess: () => { succeeded = true; },
    })), /could not safely prepare all/i);
    assert.equal(state.calls.some(call => call.name === "sendExpressToZapier"), false);
    assert.equal(succeeded, false);
  } finally {
    state.corruptBeforeDelivery = false;
  }
});
