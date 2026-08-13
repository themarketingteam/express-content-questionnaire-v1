import assert from "node:assert/strict";
import test from "node:test";

import { EXPRESS_PDF_TEMPLATE_VERSION } from "../src/components/questionnaire/PDFGenerator.js";
import {
  createPdfPayloadFingerprint,
  prepareDraftPdfInput,
  selectReusablePdfVersion,
  sortPdfVersions,
  stableStringify,
} from "../src/lib/adminDraftPdf.js";

function canonicalPayload(overrides = {}) {
  return {
    metadata: {
      business_name: "Draft Business",
      businessDomain: "draft.example.com",
      submission_datetime: "2026-08-10T15:00:00.000Z",
      questionnaire_session_id: "session-123",
      submit_attempt_id: "attempt-123",
      ...overrides.metadata,
    },
    userdata: {
      it_company_type: ["Managed Services Provider (MSP)"],
      service_offerings: ["Managed IT"],
      differentiation: "Draft differentiation",
      geographic_areas: "Nashville, TN",
      geographic_area_meta: { label: "Nashville, TN", source: "google" },
      pricing_packaging: "Flat-rate monthly (fully managed)",
      company_goals: "Acquire more clients",
      brand_tone: "Friendly & Approachable",
      target_industries: ["Healthcare / Medical"],
      client_size: "10-50 employees",
      client_challenges: ["Cybersecurity concerns or breaches"],
      client_outcomes: ["Peace of mind about security"],
      ideal_client: "A growing healthcare provider.",
      ...overrides.userdata,
    },
  };
}

function draftRecord(overrides = {}) {
  return {
    id: "draft-123",
    session_id: "session-123",
    business_name: "Draft Business",
    domain: "draft.example.com",
    mapped_payload_json: JSON.stringify(canonicalPayload()),
    updated_date: "2026-08-10T15:00:00.000Z",
    last_saved_at: "2026-08-10T15:00:00.000Z",
    created_date: "2026-08-01T12:00:00.000Z",
    final_submission_id: "submission-123",
    ...overrides,
  };
}

function submissionRecord(overrides = {}) {
  return {
    id: "submission-123",
    business_name: "Submitted Business",
    business_domain: "submitted.example.com",
    submission_datetime: "2026-08-11T15:00:00.000Z",
    updated_date: "2026-08-11T15:00:00.000Z",
    questionnaire_session_id: "session-123",
    submit_attempt_id: "attempt-123",
    it_company_type: ["Cybersecurity Provider"],
    service_offerings: ["Cybersecurity"],
    differentiation: "Submitted differentiation",
    geographic_areas: "Austin, TX",
    geographic_area_meta: { label: "Austin, TX", source: "google" },
    pricing_packaging: "Per-device / per-user pricing",
    company_goals: ["Expand into new markets"],
    brand_tone: "Technical & Expert-Driven",
    target_industries: ["Legal Firms"],
    client_size: "25-100 employees",
    client_challenges: ["Compliance and data protection needs"],
    client_outcomes: ["Compliance confidence"],
    ideal_client: "A regional law firm.",
    ...overrides,
  };
}

test("uses the final submission when it is newer than the draft payload", () => {
  const input = prepareDraftPdfInput({
    draft: draftRecord(),
    submission: submissionRecord(),
  });

  assert.equal(input.source, "form_submission");
  assert.equal(input.businessName, "Submitted Business");
  assert.equal(input.domain, "submitted.example.com");
  assert.deepEqual(input.formData.serviceOfferings, ["Cybersecurity"]);
  assert.equal(input.formData.idealClient, "A regional law firm.");
  assert.equal(input.submissionDateKey, "2026-08-11");
});

test("uses a changed draft payload when the draft is newer than the submission", () => {
  const changedPayload = canonicalPayload({
    metadata: { business_name: "Edited Draft Business" },
    userdata: { ideal_client: "A newly edited ideal client answer." },
  });
  const input = prepareDraftPdfInput({
    draft: draftRecord({
      business_name: "Edited Draft Business",
      mapped_payload_json: JSON.stringify(changedPayload),
      updated_date: "2026-08-12T15:00:00.000Z",
      last_saved_at: "2026-08-12T15:00:00.000Z",
    }),
    submission: submissionRecord(),
  });

  assert.equal(input.source, "mapped_payload_json");
  assert.equal(input.businessName, "Edited Draft Business");
  assert.equal(input.formData.idealClient, "A newly edited ideal client answer.");
});

test("uses an applied AI repair when no final submission exists", () => {
  const repairedPayload = canonicalPayload({
    metadata: { business_name: "Repaired Business", businessDomain: "repaired.example.com" },
    userdata: { ideal_client: "The repaired ideal client answer." },
  });
  const input = prepareDraftPdfInput({
    draft: draftRecord({
      final_submission_id: "",
      ai_repair_applied: true,
      ai_repaired_payload_json: JSON.stringify(repairedPayload),
      last_ai_repair_at: "2026-08-12T15:00:00.000Z",
      last_saved_at: "2026-08-10T15:00:00.000Z",
    }),
  });

  assert.equal(input.source, "ai_repaired_payload_json");
  assert.equal(input.businessName, "Repaired Business");
  assert.equal(input.domain, "repaired.example.com");
  assert.equal(input.formData.idealClient, "The repaired ideal client answer.");
});

test("creates stable fingerprints and changes them when rendered values change", async () => {
  const baseInput = prepareDraftPdfInput({ draft: draftRecord(), submission: null });
  const reorderedInput = {
    ...baseInput,
    formData: Object.fromEntries(Object.entries(baseInput.formData).reverse()),
  };
  const changedInput = {
    ...baseInput,
    formData: { ...baseInput.formData, idealClient: "A changed answer." },
  };

  assert.equal(stableStringify({ b: 2, a: 1 }), stableStringify({ a: 1, b: 2 }));
  assert.equal(
    await createPdfPayloadFingerprint(baseInput),
    await createPdfPayloadFingerprint(reorderedInput),
  );
  assert.notEqual(
    await createPdfPayloadFingerprint(baseInput),
    await createPdfPayloadFingerprint(changedInput),
  );
});

test("reuses the newest matching saved version and retains older versions", () => {
  const versions = [
    { id: "v1", version_number: 1, payload_hash: "old", template_version: EXPRESS_PDF_TEMPLATE_VERSION, pdf_file_url: "https://files.example/v1.pdf" },
    { id: "v3", version_number: 3, payload_hash: "current", template_version: EXPRESS_PDF_TEMPLATE_VERSION, pdf_file_url: "https://files.example/v3.pdf" },
    { id: "v2", version_number: 2, payload_hash: "current", template_version: EXPRESS_PDF_TEMPLATE_VERSION, pdf_file_url: "https://files.example/v2.pdf" },
  ];

  assert.deepEqual(sortPdfVersions(versions).map((version) => version.id), ["v3", "v2", "v1"]);
  assert.equal(selectReusablePdfVersion(versions, "current")?.id, "v3");
  assert.equal(selectReusablePdfVersion(versions, "missing"), null);
  assert.equal(
    selectReusablePdfVersion([
      { ...versions[1], template_version: "older-template" },
    ], "current"),
    null,
  );
});
