import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildExpressSubmissionPayload,
  getInitialExpressFormData,
} from "../src/lib/expressQuestionnairePayload.js";
import { sanitizePdfVersion } from "../base44/shared/pdfVersionPrivacy.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("PDF metadata returned to clients excludes private URIs, public URLs, and payload snapshots", () => {
  const safe = sanitizePdfVersion({
    id: "pdf-1",
    draft_id: "draft-1",
    payload_hash: "a".repeat(64),
    payload_json: JSON.stringify({ secret: "full client payload" }),
    pdf_file_url: "https://public.example/client.pdf",
    pdf_file_uri: "private://base44/client.pdf",
    pdf_filename: "client.pdf",
  });

  assert.equal(safe.storage_available, true);
  assert.equal(safe.storage_visibility, "private");
  assert.equal("payload_json" in safe, false);
  assert.equal("pdf_file_url" in safe, false);
  assert.equal("pdf_file_uri" in safe, false);
});

test("admin PDF flow uses private storage and short-lived authorized downloads", async () => {
  const [manager, storage, recovery, entity] = await Promise.all([
    read("src/components/admin/DraftPdfManager.jsx"),
    read("base44/functions/draftPdfStorage/entry.ts"),
    read("base44/functions/draftRecoveryData/entry.ts"),
    read("base44/entities/submission-pdf-version.jsonc"),
  ]);

  assert.doesNotMatch(manager, /Core\.UploadFile|pdfFileUrl|payloadJson|pdf_file_url/);
  assert.match(manager, /functions\.invoke\("draftPdfStorage"/);
  assert.match(storage, /UploadPrivateFile/);
  assert.match(storage, /CreateFileSignedUrl/);
  assert.match(storage, /SIGNED_URL_TTL_SECONDS = 120/);
  assert.match(storage, /withEntityLease/);
  assert.match(storage, /\$unset:[\s\S]*pdf_file_url:[\s\S]*payload_json:/);
  assert.match(recovery, /sanitizePdfVersions/);
  assert.match(recovery, /Public PDF version creation is disabled/);
  assert.equal(JSON.parse(entity).required.includes("pdf_file_url"), false);
});

test("anonymous submission path persists every raw input and serializes idempotent writes", async () => {
  const [fallback, submissionEntity, draftEntity] = await Promise.all([
    read("base44/functions/submitExpressQuestionnaireFallback/entry.ts"),
    read("base44/entities/FormSubmission.jsonc"),
    read("base44/entities/FormDraft.jsonc"),
  ]);

  assert.match(fallback, /Access-Control-Allow-Origin': '\*'/);
  assert.doesNotMatch(fallback, /auth\.me\s*\(/);
  assert.match(fallback, /responses_json: safeJsonStringify\(rawResponseSnapshot/);
  assert.match(fallback, /raw_responses_json:\s+safeJsonStringify\(rawResponseSnapshot/);
  assert.match(fallback, /transformed_payload_json:\s+safeJsonStringify\(payload/);
  assert.match(fallback, /return await withSubmissionSessionLease/);
  assert.match(fallback, /upsertIntake/);

  const parsedSubmissionEntity = JSON.parse(submissionEntity);
  const submissionProperties = parsedSubmissionEntity.properties;
  const draftProperties = JSON.parse(draftEntity).properties;
  assert.ok(submissionProperties.raw_responses_json);
  assert.ok(submissionProperties.transformed_payload_json);
  assert.ok(draftProperties.responses_json);
  assert.ok(draftProperties.mapped_payload_json);
  assert.ok(draftProperties.idempotency_lock_token);
  assert.equal(parsedSubmissionEntity.rls.create.user_condition.role, "admin");

  const repairSources = await Promise.all([
    read("base44/functions/autoRepairRetryIntake/entry.ts"),
    read("base44/functions/retryQuestionnaireIntakeSubmission/entry.ts"),
    read("base44/functions/repairExpressQuestionnaireIntakeSubmission/entry.ts"),
  ]);
  for (const source of repairSources) {
    assert.match(source, /withSubmissionSessionLease/);
    assert.match(source, /raw_responses_json/);
    assert.match(source, /transformed_payload_json/);
  }
  const browserResilience = await read("src/lib/expressSubmissionResilience.js");
  assert.doesNotMatch(browserResilience, /entities\.FormSubmission\.create/);

  const formData = Object.fromEntries(
    Object.keys(getInitialExpressFormData()).map((key) => [key, `sentinel:${key}`]),
  );
  const arrayFields = new Set([
    "itCompanyType",
    "serviceOfferings",
    "targetIndustries",
    "clientChallenges",
    "clientOutcomes",
  ]);
  for (const field of arrayFields) formData[field] = [`sentinel:${field}`];
  formData.geographicAreaMeta = {
    label: "Worldwide",
    lat: 1,
    lon: 2,
    place_id: "global-place",
    source: "google",
  };

  const payload = buildExpressSubmissionPayload({
    formData,
    businessName: "Global Client",
    domain: "global.example",
    sessionId: "anonymous-session",
    submitAttemptId: "attempt-1",
  });
  const serialized = JSON.stringify(payload.userdata);
  for (const key of Object.keys(formData)) {
    const sentinel = key === "geographicAreaMeta"
      ? "global-place"
      : key === "geographicAreas"
        ? "Worldwide"
        : `sentinel:${key}`;
    assert.match(serialized, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
