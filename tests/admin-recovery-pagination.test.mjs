import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildRecoveryListQuery,
  normalizeRecoveryRequest,
  RECOVERY_RECORD_CONFIG,
  recordMatchesArchiveState,
} from "../base44/shared/recoveryPagination.ts";
import {
  isRetentionCandidate,
  MAX_RETENTION_BATCH_SIZE,
  normalizeRetentionRequest,
} from "../base44/shared/recoveryRetention.ts";
import {
  ADMIN_RECOVERY_PAGE_SIZE,
  createLatestRecoveryRequestGate,
  createRecoveryListPayload,
  getPaginationControls,
  getVisibleRecordRange,
  requestRecoveryPage,
  requestRecoveryRecord,
} from "../src/lib/adminRecoveryPagination.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("list requests are normalized, bounded, filtered, and projected to collapsed fields", () => {
  const normalized = normalizeRecoveryRequest({
    action: "list",
    recordType: "draft",
    page: -4,
    pageSize: 10_000,
    status: "submit_failed",
    archiveState: "active",
    search: "  Client.*  ",
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.page, 1);
  assert.equal(normalized.value.pageSize, 100);
  const query = buildRecoveryListQuery(normalized.value);
  assert.equal(query.status, "submit_failed");
  assert.deepEqual(query.archived, { $ne: true });
  assert.equal(query.$or.length, 4);
  assert.equal(query.$or[0].business_name.$regex, "Client\\.\\*");

  for (const config of Object.values(RECOVERY_RECORD_CONFIG)) {
    for (const sensitiveField of [
      "responses_json",
      "mapped_payload_json",
      "transformed_payload_json",
      "raw_responses_json",
      "diagnostics_json",
      "primary_error_json",
      "ai_repair_report_json",
      "pdf_file_uri",
    ]) {
      assert.equal(config.listFields.includes(sensitiveField), false, `${sensitiveField} must not be listed`);
    }
  }
});

test("unsupported filters and invalid detail IDs are rejected", () => {
  assert.deepEqual(
    normalizeRecoveryRequest({ action: "list", recordType: "draft", status: "DROP", archiveState: "active" }),
    { ok: false, error: "Unsupported status filter." },
  );
  assert.deepEqual(
    normalizeRecoveryRequest({ action: "get", recordType: "draft", recordId: "../secret", archiveState: "all" }),
    { ok: false, error: "A valid recordId is required." },
  );
  assert.equal(recordMatchesArchiveState({ archived: true }, "active"), false);
  assert.equal(recordMatchesArchiveState({ archived: true }, "archived"), true);
});

test("the browser requests one page with server filters and fetches detail by ID", async () => {
  const calls = [];
  const invoke = async (functionName, payload) => {
    calls.push({ functionName, payload });
    if (payload.action === "get") return { data: { success: true, record: { id: payload.recordId, secret: "full" } } };
    return {
      data: {
        success: true,
        records: [{ id: "draft-1" }],
        page: payload.page,
        pageSize: payload.pageSize,
        hasMore: false,
        hasAnyRecords: true,
      },
    };
  };

  const page = await requestRecoveryPage({
    invoke,
    recordType: "draft",
    recoveryGrant: "grant",
    page: 3,
    pageSize: ADMIN_RECOVERY_PAGE_SIZE,
    status: "submitted",
    archiveState: "all",
    search: "client",
  });
  assert.equal(page.records.length, 1);
  assert.deepEqual(calls[0].payload, createRecoveryListPayload({
    recordType: "draft",
    recoveryGrant: "grant",
    page: 3,
    pageSize: 25,
    status: "submitted",
    archiveState: "all",
    search: "client",
  }));

  const record = await requestRecoveryRecord({
    invoke,
    recordType: "draft",
    recordId: "draft-1",
    archiveState: "all",
    recoveryGrant: "grant",
  });
  assert.equal(record.secret, "full");
  assert.equal(calls[1].payload.action, "get");
  assert.equal(calls[1].payload.recordId, "draft-1");
});

test("pagination controls, ranges, and stale response gate are deterministic", () => {
  assert.deepEqual(getVisibleRecordRange({ page: 3, pageSize: 25, recordCount: 8 }), { start: 51, end: 58 });
  assert.deepEqual(getVisibleRecordRange({ page: 1, pageSize: 25, recordCount: 0 }), { start: 0, end: 0 });
  assert.deepEqual(getPaginationControls({ page: 1, hasMore: true }), {
    previousDisabled: true,
    nextDisabled: false,
  });
  assert.deepEqual(getPaginationControls({ page: 2, hasMore: false }), {
    previousDisabled: false,
    nextDisabled: true,
  });

  const gate = createLatestRecoveryRequestGate();
  const oldSearch = gate.begin();
  const newSearch = gate.begin();
  assert.equal(gate.isLatest(oldSearch), false, "an older search response cannot replace newer results");
  assert.equal(gate.isLatest(newSearch), true);
});

test("frontend uses protected pagination, resets filters to page one, lazy-loads details, and hides an empty fallback", async () => {
  const [page, intake, hook, backend] = await Promise.all([
    read("src/pages/FormDraftRecovery.jsx"),
    read("src/components/admin/QuestionnaireIntakeRecovery.jsx"),
    read("src/hooks/useAdminRecoveryPagination.js"),
    read("base44/functions/draftRecoveryData/entry.ts"),
  ]);

  assert.doesNotMatch(page, /action:\s*["']listDrafts["']/);
  assert.doesNotMatch(intake, /action:\s*["']listIntakes["']/);
  assert.match(page, /useAdminRecoveryPagination\(\{[\s\S]*recordType: "draft"/);
  assert.match(intake, /useAdminRecoveryPagination\(\{[\s\S]*recordType: "intake"/);
  assert.match(hook, /setPage\(1\);[\s\S]*\[status, archiveState, search\]/);
  assert.match(hook, /createLatestRecoveryRequestGate/);
  assert.match(page, /requestRecoveryRecord\(\{[\s\S]*recordType: "draft"/);
  assert.match(intake, /requestRecoveryRecord\(\{[\s\S]*recordType: "intake"/);
  assert.match(page, /intakeAvailable !== false/);
  assert.match(intake, /onAvailabilityChange\?\.\(pagination\.hasAnyRecords\)/);

  const authorization = backend.indexOf("await authorizeRecoveryRequest");
  const protectedRead = backend.indexOf("await entity.get", authorization);
  assert.ok(authorization >= 0 && protectedRead > authorization, "authorization must precede service-role detail reads");
  assert.match(backend, /request\.pageSize \+ 1/);
  assert.match(backend, /\[\.\.\.config\.listFields\]/);

  for (const capability of [
    /<PayloadEditor/,
    /<DraftPdfManager/,
    /retryQuestionnaireIntakeSubmission/,
    /repairExpressQuestionnaireIntakeSubmission/,
    /Endpoint Payload/,
    /Raw Draft/,
  ]) assert.match(page, capability);
  assert.match(intake, /retryQuestionnaireIntakeSubmission/);
  assert.match(intake, /repairExpressQuestionnaireIntakeSubmission/);
});

test("retention is bounded, hold-aware, dry-run-first, and archive-idempotent", async () => {
  const cutoff = "2025-01-01T00:00:00.000Z";
  const normalized = normalizeRetentionRequest({
    action: "archive",
    recordType: "draft",
    olderThan: cutoff,
    batchSize: 5000,
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.batchSize, MAX_RETENTION_BATCH_SIZE);
  assert.equal(normalized.value.dryRun, true);

  const oldActive = { updated_date: "2024-01-01T00:00:00.000Z", archived: false };
  assert.equal(isRetentionCandidate(oldActive, normalized.value), true);
  assert.equal(isRetentionCandidate({ ...oldActive, archived: true }, normalized.value), false);
  assert.equal(isRetentionCandidate({ ...oldActive, legal_hold: true }, normalized.value), false);

  const retention = await read("base44/functions/draftRecoveryRetention/entry.ts");
  assert.match(retention, /request\.batchSize/);
  assert.match(retention, /DRAFT_RECOVERY_PERMANENT_DELETION_ENABLED/);
  assert.match(retention, /Permanent deletion is disabled until retention periods are approved/);
  assert.match(retention, /safeRecoveryLog/);
  assert.doesNotMatch(retention, /console\.(?:log|info|error)\([^)]*(?:payload|responses|diagnostics)/i);
});
