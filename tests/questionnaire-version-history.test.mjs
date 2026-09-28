import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  chooseDefaultQuestionnaireVersion,
  calculateMeaningfulQuestionnaireVersions,
  createQuestionnaireVersionLoadGate,
  filterMeaningfulQuestionnaireVersions,
  isSameQuestionnaireClient,
  questionnaireVersionOptionLabel,
  withQuestionnaireVersionRequestTimeout,
} from "../src/lib/questionnaireVersionHistory.js";

const projectUrl = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, projectUrl), "utf8");

test("durable submitted snapshots win over newer incomplete autosaves", () => {
  const selected = chooseDefaultQuestionnaireVersion([
    { id: "newer", type: "autosave", status: "draft", answerCount: 2, progressPercent: 8, capturedAt: "2026-09-28T12:00:00Z" },
    { id: "submitted", type: "submitted_snapshot", status: "submitted", answerCount: 22, progressPercent: 100, capturedAt: "2026-09-27T12:00:00Z" },
  ]);
  assert.equal(selected.id, "submitted");
});

test("the most complete version wins when no durable submission exists", () => {
  const selected = chooseDefaultQuestionnaireVersion([
    { id: "newer", type: "autosave", status: "draft", answerCount: 4, progressPercent: 25, capturedAt: "2026-09-28T12:00:00Z" },
    { id: "complete", type: "autosave", status: "draft", answerCount: 18, progressPercent: 92, capturedAt: "2026-09-27T12:00:00Z" },
  ]);
  assert.equal(selected.id, "complete");
});

test("key versions use chronological global high-water marks and retain the state before a reset", () => {
  const calculated = calculateMeaningfulQuestionnaireVersions([
    { id: "one", sessionId: "s", answerCount: 2, progressPercent: 10, capturedAt: "2026-09-28T10:00:00Z" },
    { id: "peak", sessionId: "s", answerCount: 12, progressPercent: 80, capturedAt: "2026-09-28T10:10:00Z" },
    { id: "lower", sessionId: "s", answerCount: 8, progressPercent: 60, capturedAt: "2026-09-28T10:11:00Z" },
    { id: "not-new-high", sessionId: "s", answerCount: 10, progressPercent: 70, capturedAt: "2026-09-28T10:12:00Z" },
  ]);
  const peak = calculated.find((version) => version.id === "peak");
  const lower = calculated.find((version) => version.id === "lower");
  const later = calculated.find((version) => version.id === "not-new-high");
  assert.ok(peak.meaningfulReasons.includes("answer_count_high_water"));
  assert.ok(peak.meaningfulReasons.includes("before_substantial_deletion"));
  assert.ok(!lower.meaningfulReasons.includes("answer_count_high_water"));
  assert.ok(!later.meaningfulReasons.includes("answer_count_high_water"));
});

test("client grouping accepts only strong deterministic identities", () => {
  const root = { id: "a", session_id: "one", business_name: "Acme IT", domain: "https://www.acme.example/", user_email: "Owner@Acme.Example" };
  assert.equal(isSameQuestionnaireClient(root, { id: "b", session_id: "two", user_email: "owner@acme.example" }), true);
  assert.equal(isSameQuestionnaireClient(root, { id: "c", session_id: "three", business_name: "Acme IT", domain: "acme.example" }), true);
  assert.equal(isSameQuestionnaireClient(root, { id: "d", session_id: "four", business_name: "Acme IT", domain: "different.example" }), false);
  assert.equal(isSameQuestionnaireClient(root, { id: "e", session_id: "five", business_name: "Acme IT" }), false);
});

test("meaningful filtering and version option labels remain deterministic", () => {
  const versions = [
    { id: "a", meaningful: true, label: "Saved draft", answerCount: 3, progressPercent: 25, capturedAt: "2026-09-28T10:00:00Z" },
    { id: "b", meaningful: false, label: "Saved draft", answerCount: 3, progressPercent: 25, capturedAt: "2026-09-28T10:01:00Z" },
  ];
  assert.deepEqual(filterMeaningfulQuestionnaireVersions(versions).map(version => version.id), ["a"]);
  assert.equal(
    questionnaireVersionOptionLabel(versions[0], { formatDate: value => value }),
    "Saved draft · 2026-09-28T10:00:00Z · 3 answers · 25%",
  );
});

test("version catalog loading is single-flight and never auto-retries forever", async () => {
  const gate = createQuestionnaireVersionLoadGate();
  assert.equal(gate.shouldAutoLoad({ expanded: true, detailReady: true, hasCatalog: false }), true);
  let calls = 0;
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const first = gate.run(async () => {
    calls += 1;
    await deferred;
    return "loaded";
  });
  const duplicate = gate.run(async () => {
    calls += 1;
    return "duplicate";
  });
  release();
  assert.equal(await first, "loaded");
  assert.equal(await duplicate, "loaded");
  assert.equal(calls, 1);
  assert.equal(gate.shouldAutoLoad({ expanded: true, detailReady: true, hasCatalog: false }), false);
});

test("a stalled version request becomes a retryable timeout instead of a permanent spinner", async () => {
  await assert.rejects(
    withQuestionnaireVersionRequestTimeout(new Promise(() => {}), 5),
    /took too long to load/i,
  );
});

test("protected backend implements pagination, isolation, immutable copies, and stale-submission protection", async () => {
  const [backend, draftApi, submitBackend, entity, page, selector, styles] = await Promise.all([
    read("base44/functions/draftRecoveryData/entry.ts"),
    read("base44/functions/questionnaireDraftData/entry.ts"),
    read("base44/functions/submitExpressQuestionnaireFallback/entry.ts"),
    read("base44/entities/questionnaire-version.jsonc"),
    read("src/pages/FormDraftRecovery.jsx"),
    read("src/components/admin/QuestionnaireVersionSelector.jsx"),
    read("src/pages/FormDraftRecovery.css"),
  ]);

  assert.match(backend, /authorizeRecoveryRequest/);
  assert.match(backend, /case 'list_versions'/);
  assert.match(backend, /case 'get_version'/);
  assert.match(backend, /case 'create_version_copy'/);
  assert.match(backend, /paginatedFilter/);
  assert.match(backend, /VERSION_CATALOG_CEILING/);
  assert.match(backend, /truncated/);
  assert.match(backend, /strongIdentityMatch/);
  assert.match(backend, /rootDomain && rootBusiness/);
  assert.match(backend, /recovery_copy_source_version_id/);
  assert.match(entity, /"update": false/);
  assert.match(entity, /"delete": false/);
  assert.match(draftApi, /existing\.status === 'submitted' \|\| existing\.final_submission_id/);
  assert.match(draftApi, /applyDurableDraftMutation/);
  assert.match(draftApi, /versionType: checkpointType/);
  assert.match(draftApi, /baseRevision/);
  assert.match(backend, /applyDurableDraftMutation/);
  assert.doesNotMatch(backend, /buildVersionCatalog\(base44, rootDraft, 'all'\);\s*const summary/);
  assert.match(submitBackend, /versionType: 'submitted_snapshot'/);
  assert.match(page, /isHistoricalVersion/);
  assert.match(page, /disabled=\{isLoading \|\| isHistoricalVersion\}/);
  assert.match(page, /readOnly=\{isHistoricalVersion\}/);
  assert.match(selector, /Create Editable Recovery Copy/);
  assert.match(selector, /Read-only historical version/);
  assert.match(styles, /@media \(max-width: 44rem\)[\s\S]*?questionnaire-version-panel__controls/);
});
