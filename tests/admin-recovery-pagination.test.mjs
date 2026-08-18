import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildRecoveryListQuery,
  isExactSubmissionIdSearch,
  normalizeRecoveryRequest,
  projectRecoveryListRecord,
  RECOVERY_RECORD_CONFIG,
  recordMatchesArchiveState,
} from "../base44/shared/recoveryPagination.ts";
import {
  AUTOMATED_RETENTION_DISABLED_ERROR,
  isRetentionCandidate,
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

test("standalone submissions are the default while submission searches include connected records", () => {
  const standalone = normalizeRecoveryRequest({
    action: "list", recordType: "submission", status: "all", archiveState: "active", search: "",
  });
  assert.equal(standalone.ok, true);
  assert.equal(buildRecoveryListQuery(standalone.value).$or.length, 3);

  const searched = normalizeRecoveryRequest({
    action: "list", recordType: "submission", status: "all", archiveState: "active", search: "submission-123",
  });
  assert.equal(searched.ok, true);
  const query = buildRecoveryListQuery(searched.value);
  assert.equal(query.$or.length, RECOVERY_RECORD_CONFIG.submission.searchFields.length - 1);
  assert.equal(query.$and, undefined);
  assert.equal(query.$or.some((clause) => Object.hasOwn(clause, "id")), false);
  assert.ok(RECOVERY_RECORD_CONFIG.submission.searchFields.includes("user_email"));
  assert.ok(RECOVERY_RECORD_CONFIG.submission.searchFields.includes("id"));

  const exact = normalizeRecoveryRequest({
    action: "list", recordType: "submission", status: "all", archiveState: "active",
    search: "6a729e1a824959283d5c8955",
  });
  assert.equal(exact.ok, true);
  assert.equal(isExactSubmissionIdSearch(exact.value), true);
  assert.equal(isExactSubmissionIdSearch(searched.value), false);

  assert.deepEqual(
    projectRecoveryListRecord({ id: "safe", business_name: "Client", mapped_payload_json: "secret" }, ["id", "business_name"]),
    { id: "safe", business_name: "Client" },
  );
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
  assert.equal(calls[0].functionName, "adminRecoveryPagination");
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
  assert.equal(calls[1].functionName, "adminRecoveryPagination");
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
    read("base44/functions/adminRecoveryPagination/entry.ts"),
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
  assert.match(backend, /isExactSubmissionIdSearch\(request\)/);
  assert.match(backend, /await entity\.get\(request\.search\)/);
  assert.match(backend, /projectRecoveryListRecord\(exactRecord, config\.listFields\)/);
  assert.match(backend, /functionName: 'adminRecoveryPagination'/);

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

test("age-based retention and every scheduled mutation are permanently disabled", async () => {
  const normalized = normalizeRetentionRequest({
    action: "delete",
    recordType: "draft",
  });
  assert.equal(normalized.ok, false);
  assert.equal(normalized.error, AUTOMATED_RETENTION_DISABLED_ERROR);

  const oldActive = { updated_date: "2024-01-01T00:00:00.000Z", archived: false };
  assert.equal(isRetentionCandidate(oldActive, {}), false);
  assert.equal(isRetentionCandidate({ ...oldActive, legal_hold: false }, {}), false);

  const retention = await read("base44/functions/draftRecoveryRetention/entry.ts");
  assert.match(retention, /},\s*410\);/);
  assert.match(retention, /indefinite_until_manual_deletion/);
  assert.doesNotMatch(retention, /createClientFromRequest|\.delete\(|\.update\(|updateMany|DRAFT_RECOVERY_PERMANENT_DELETION_ENABLED/);
});
