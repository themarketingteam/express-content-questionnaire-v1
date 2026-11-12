import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExpressSubmissionPayload,
  mapExpressPayloadToFormSubmissionRecord,
} from "../src/lib/expressQuestionnairePayload.js";
import {
  repairExpressSubmissionPayload,
  safeStringifyForDiagnostics,
  validateExpressSubmissionPayload,
} from "../src/lib/expressPayloadRepair.js";

function completeAnswers() {
  return {
    itCompanyType: ["Managed Services Provider (MSP)", "Cybersecurity Provider"],
    itCompanyTypeOther: "Specialized IT partner",
    serviceOfferings: ["Managed IT", "Cloud Services", "Security"],
    serviceOfferingsOther: "Application integration",
    differentiation: "We provide a dedicated technical team and local support.",
    geographicAreas: "Austin, TX",
    geographicAreaMeta: {
      label: "Austin, TX, USA",
      lat: 30.2672,
      lon: -97.7431,
      place_id: "synthetic-austin-place",
      source: "google",
    },
    pricingPackaging: "Per-user pricing",
    pricingPackagingOther: "Custom projects",
    companyGoals: "Grow our managed services business",
    companyGoalsOther: "Expand into a neighboring city",
    brandTone: "Professional",
    brandToneOther: "Approachable",
    targetIndustries: ["Healthcare", "Professional Services"],
    targetIndustriesOther: "Nonprofit organizations",
    clientSize: "51-100 employees",
    clientChallenges: ["Cybersecurity threats", "Legacy systems"],
    clientChallengesOther: "Office relocation",
    clientOutcomes: ["Improved productivity", "Reduced risk"],
    clientOutcomesOther: "Reliable budgeting",
    idealClient: "A growing local business looking for a long-term IT partner.",
  };
}

function buildFixture() {
  return buildExpressSubmissionPayload({
    formData: completeAnswers(),
    businessName: "Synthetic Preservation Test",
    domain: "example.test",
    sessionId: "preservation-test-session",
    submitAttemptId: "preservation-test-attempt",
  });
}

test("normal submission repair preserves every question, other answer, and geographic value", () => {
  const payload = buildFixture();
  const expected = structuredClone(payload);
  // This shared-reference shape is produced by the real submission builder.
  assert.equal(payload._rawFormData.itCompanyType, payload.userdata.it_company_type);
  assert.equal(payload._rawFormData.geographicAreaMeta, payload.userdata.geographic_area_meta);

  const repaired = repairExpressSubmissionPayload(payload);

  assert.deepEqual(repaired.payload, expected);
  assert.deepEqual(repaired.changedPaths, []);
  assert.equal(repaired.repaired, false);
  assert.equal(validateExpressSubmissionPayload(repaired.payload).ok, true);
});

test("diagnostic serialization preserves shared objects in sibling branches and repeated array elements", () => {
  const shared = { answer: "Keep this answer", choices: ["one", "two"] };
  const input = { first: shared, second: shared, items: [shared, shared] };
  assert.deepEqual(JSON.parse(safeStringifyForDiagnostics(input)), {
    first: { answer: "Keep this answer", choices: ["one", "two"] },
    second: { answer: "Keep this answer", choices: ["one", "two"] },
    items: [
      { answer: "Keep this answer", choices: ["one", "two"] },
      { answer: "Keep this answer", choices: ["one", "two"] },
    ],
  });
});

test("real ancestor cycles are removed while non-circular answers remain intact", () => {
  const shared = { answer: "Retain me" };
  shared.self = shared;
  const input = { first: shared, second: shared, array: ["keep"] };
  input.array.push(input.array);
  input.self = input;

  assert.deepEqual(JSON.parse(safeStringifyForDiagnostics(input)), {
    first: { answer: "Retain me" },
    second: { answer: "Retain me" },
    array: ["keep"],
  });
  assert.equal(input.self, input);
  assert.equal(shared.self, shared);
  assert.equal(input.array[1], input.array);
});

test("repair does not mutate the input or leave shared output answer arrays", () => {
  const payload = buildFixture();
  const original = structuredClone(payload);
  const result = repairExpressSubmissionPayload(payload);

  assert.deepEqual(payload, original);
  result.payload.userdata.it_company_type.push("Changed output only");
  result.payload.userdata.geographic_area_meta.label = "Changed output location";
  assert.deepEqual(payload, original);
  assert.deepEqual(result.payload._rawFormData, original._rawFormData);
});

test("the database record mapper retains all repaired endpoint answers", () => {
  const built = buildFixture();
  const expectedRecord = mapExpressPayloadToFormSubmissionRecord(structuredClone(built));
  const repaired = repairExpressSubmissionPayload(built);
  const record = mapExpressPayloadToFormSubmissionRecord(repaired.payload);

  assert.deepEqual(record, expectedRecord);
  for (const field of ["it_company_type", "service_offerings", "target_industries", "client_challenges", "client_outcomes"]) {
    assert.ok(record[field].length > 0, `${field} must not be emptied during submission`);
  }
  assert.deepEqual(record.geographic_area_meta, built.userdata.geographic_area_meta);
});

test("long questionnaire text is preserved without silent truncation", () => {
  const payload = buildFixture();
  const longAnswer = `${"A complete client answer. ".repeat(1000)}Keep this final sentence.`;
  payload.userdata.differentiation = longAnswer;
  payload._rawFormData.differentiation = longAnswer;

  const repaired = repairExpressSubmissionPayload(payload);

  assert.ok(longAnswer.length > 20000);
  assert.equal(repaired.payload.userdata.differentiation, longAnswer);
  assert.equal(repaired.payload._rawFormData.differentiation, longAnswer);
  assert.equal(mapExpressPayloadToFormSubmissionRecord(repaired.payload).differentiation, longAnswer);
  assert.deepEqual(repaired.changedPaths, []);
});
