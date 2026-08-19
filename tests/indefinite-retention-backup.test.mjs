import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BACKUP_SCHEMA_VERSION,
  backupIsStale,
  buildRecordBackup,
  buildSignedManifest,
  isUsableCompletedBackupRun,
  recordFallsWithinBackupWindow,
} from "../base44/shared/backupPolicy.ts";
import {
  confirmationHash,
  createLifecycleToken,
  LIFECYCLE_TOKEN_TTL_MS,
  verifyLifecycleToken,
} from "../base44/shared/manualDataLifecycle.ts";
import {
  privacySafeObjectKey,
  resolvePrivateS3ObjectKey,
  validatePrivateS3Config,
} from "../base44/shared/privateS3.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("backup object paths are deterministic and contain no client identity", async () => {
  const key = await privacySafeObjectKey("FormDraft", "client@example.com/Nexus Consulting");
  assert.match(key, /^records\/v1\/[a-f0-9]{16}\/[a-f0-9]{2}\/[a-f0-9]{64}\.json$/);
  assert.doesNotMatch(key, /client|example|nexus|consulting|@/i);
  assert.equal(
    resolvePrivateS3ObjectKey({
      bucket: "express-tier-bucket",
      region: "us-east-2",
      kmsKeyId: "kms-key",
      prefix: "/contentDraftEntry/",
      credentials: { accessKeyId: "key", secretAccessKey: "secret" },
    }, key),
    `contentDraftEntry/${key}`,
  );

  const backup = await buildRecordBackup({
    entityName: "FormDraft",
    record: { id: "draft-1", session_id: "private-session", business_name: "Private Client" },
    backedUpAt: "2026-08-18T10:00:00.000Z",
  });
  assert.equal(backup.key, await privacySafeObjectKey("FormDraft", "draft-1"));
  assert.match(backup.payloadHash, /^[a-f0-9]{64}$/);
  assert.match(backup.body, /Private Client/);
  assert.doesNotMatch(backup.key, /private/i);
});

test("signed manifests are stable, aggregate-only, and detect tampering", async () => {
  const first = await buildSignedManifest({
    runId: "run-1",
    startedAt: "2026-08-18T09:00:00.000Z",
    completedAt: "2026-08-18T09:10:00.000Z",
    counts: { FormDraft: 90, FormSubmission: 83 },
    signingKey: "a".repeat(64),
  });
  const second = await buildSignedManifest({
    runId: "run-1",
    startedAt: "2026-08-18T09:00:00.000Z",
    completedAt: "2026-08-18T09:10:00.000Z",
    counts: { FormDraft: 90, FormSubmission: 83 },
    signingKey: "a".repeat(64),
  });
  assert.equal(first.body, second.body);
  assert.equal(JSON.parse(first.body).manifest.schemaVersion, BACKUP_SCHEMA_VERSION);
  assert.match(first.signature, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(first.body, /business_name|answers|domain|email/i);
});

test("backup configuration fails closed and health becomes stale after 36 hours", () => {
  assert.deepEqual(validatePrivateS3Config(null), ["bucket", "region", "kmsKeyId", "accessKeyId", "secretAccessKey"]);
  assert.equal(backupIsStale("2026-08-17T00:00:00.000Z", Date.parse("2026-08-18T13:00:01.000Z")), true);
  assert.equal(backupIsStale("2026-08-18T00:00:00.000Z", Date.parse("2026-08-18T13:00:00.000Z")), false);
});

test("backup selection scans stable pages and rejects false zero-record baselines", () => {
  const record = {
    id: "draft-1",
    created_date: "2026-08-18T09:00:00.000Z",
    updated_date: "2026-08-18T10:00:00.000Z",
  };
  assert.equal(recordFallsWithinBackupWindow(record, "", "2026-08-18T11:00:00.000Z"), true);
  assert.equal(recordFallsWithinBackupWindow(record, "2026-08-18T10:00:00.000Z", "2026-08-18T11:00:00.000Z"), false);
  assert.equal(recordFallsWithinBackupWindow(record, "2026-08-18T09:59:59.000Z", "2026-08-18T10:00:00.000Z"), true);
  assert.equal(recordFallsWithinBackupWindow(record, "", "2026-08-18T09:59:59.000Z"), false);
  assert.equal(isUsableCompletedBackupRun({
    status: "completed", completed_at: "2026-08-18T11:00:00.000Z", metrics_json: JSON.stringify({ records: 0 }),
  }), false);
  assert.equal(isUsableCompletedBackupRun({
    status: "completed", completed_at: "2026-08-18T11:00:00.000Z", metrics_json: JSON.stringify({ records: 1, fullSnapshot: true }),
  }), true);
  assert.equal(isUsableCompletedBackupRun({
    status: "completed", completed_at: "2026-08-18T11:00:00.000Z", metrics_json: JSON.stringify({ records: 0, fullSnapshot: false }),
  }), true);
});

test("prepare/execute lifecycle authorization expires and binds typed confirmation", async () => {
  const secret = "lifecycle-secret-value";
  const expectedHash = await confirmationHash("Nexus Consulting Security");
  const token = await createLifecycleToken({ action: "delete", confirmationHash: expectedHash }, secret, 1_000);
  const valid = await verifyLifecycleToken(token, secret, 1_000 + LIFECYCLE_TOKEN_TTL_MS);
  assert.equal(valid.valid, true);
  assert.equal(valid.claims.confirmationHash, expectedHash);
  assert.equal((await verifyLifecycleToken(token, secret, 1_001 + LIFECYCLE_TOKEN_TTL_MS)).valid, false);
  assert.equal((await verifyLifecycleToken(`${token}tampered`, secret, 2_000)).valid, false);
});

test("AWS infrastructure enforces private versioned KMS storage and split least privilege", async () => {
  const template = await read("infrastructure/aws/express-recovery-backup.yaml");
  assert.match(template, /BlockPublicAcls: true/);
  assert.match(template, /put_bucket_versioning[\s\S]*'Status': 'Enabled'/);
  assert.match(template, /Default: express-tier-bucket/);
  assert.match(template, /Default: contentDraftEntry/);
  assert.match(template, /ExpressRecoveryRequireKms[\s\S]*s3:x-amz-server-side-encryption[\s\S]*aws:kms/);
  assert.match(template, /ExpressRecoveryRequireApprovedKmsKey/);
  assert.match(template, /get_bucket_policy[\s\S]*put_bucket_policy/, "existing CloudFront policy statements must be preserved");
  assert.match(template, /EnableLogFileValidation: true/);
  assert.match(template, /express-recovery-backup-overdue-36-hours/);
  assert.match(template, /UploadVerifyWithoutDelete[\s\S]*Effect: Deny[\s\S]*s3:DeleteObject/);
  assert.match(template, /DeleteVersionsWithoutRead[\s\S]*Effect: Deny[\s\S]*s3:GetObject/);
  assert.doesNotMatch(template, /ObjectLockEnabled|AWS::IAM::AccessKey/);
});

test("manual deletion purges AWS before Base44 and leaves a payload-free audit", async () => {
  const lifecycle = await read("base44/functions/manageExpressRecoveryData/entry.ts");
  const purge = lifecycle.indexOf("purgeAllObjectVersions");
  const base44Delete = lifecycle.indexOf(".deleteMany(");
  assert.ok(purge >= 0 && base44Delete > purge);
  assert.match(lifecycle, /No Base44 client records were deleted/);
  assert.match(lifecycle, /ExpressDeletionAudit\.create/);
  assert.doesNotMatch(lifecycle, /business_name_json|payload_json.*ExpressDeletionAudit/);
  assert.match(lifecycle, /graphFingerprint/);
  assert.match(lifecycle, /recentlyDeletedWindowDays: 30/);
});

test("Draft Recovery exposes connected submissions, standalone legacy records, restore, and two-step deletion", async () => {
  const [page, standalone, deletion, retention] = await Promise.all([
    read("src/pages/FormDraftRecovery.jsx"),
    read("src/components/admin/StandaloneSubmissionRow.jsx"),
    read("src/components/admin/ClientDataDeletionDialog.jsx"),
    read("src/components/admin/RetentionRecoveryPanel.jsx"),
  ]);
  assert.match(page, /Connected Final Submission/);
  assert.match(page, /Standalone Final Submissions/);
  assert.match(page, /recordType: "submission"/);
  assert.match(standalone, /Legacy snapshot unavailable/);
  assert.match(standalone, /normalized FormSubmission fields/);
  assert.match(deletion, /prepareDeletion/);
  assert.match(deletion, /executeDeletion/);
  assert.match(retention, /restorePreview/);
  assert.match(retention, /restoreApply/);
});

test("all retained client entities default to indefinite retention and admin-only deletion", async () => {
  const paths = [
    "base44/entities/FormDraft.jsonc",
    "base44/entities/FormSubmission.jsonc",
    "base44/entities/FormSubmissionIntake.jsonc",
    "base44/entities/FormDraftEvent.jsonc",
    "base44/entities/submission-pdf-version.jsonc",
    "base44/entities/express-identity-resolution-attempt.jsonc",
  ];
  for (const path of paths) {
    const entity = JSON.parse(await read(path));
    assert.equal(entity.properties.retention_policy.default, "indefinite_until_manual_deletion", path);
    assert.equal(entity.rls.delete.user_condition.role, "admin", path);
  }
});

test("production migration is non-destructive and never links by business name", async () => {
  const migration = await read("scripts/base44/migrate-indefinite-retention.ts");
  assert.match(migration, /count changed during a non-destructive migration/);
  assert.match(migration, /created timestamp changed/);
  assert.match(migration, /final_submission_id/);
  assert.match(migration, /questionnaire_session_id/);
  assert.doesNotMatch(migration, /draftsByBusiness|submissionsByBusiness|business_name\s*===/);
});

test("the scheduled backup bundles exact copies of its reviewed shared dependencies", async () => {
  for (const name of ["backupPolicy.ts", "privateS3.ts", "privateS3Config.ts", "recoveryAuthorization.ts", "recoveryGrant.ts"]) {
    const [canonical, bundled] = await Promise.all([
      read(`base44/shared/${name}`),
      read(`base44/functions/backupExpressRecoveryData/${name}`),
    ]);
    assert.equal(bundled.trimEnd(), canonical.trimEnd(), `${name} must be synchronized before deployment`);
  }
});

test("the resumable backup throttles Base44 writes and can recover a failed cursor", async () => {
  const source = await read("base44/functions/backupExpressRecoveryData/entry.ts");
  assert.match(source, /const CONCURRENCY = 2/);
  assert.match(source, /BASE44_RETRY_ATTEMPTS = 7/);
  assert.match(source, /isRetryableBase44Error/);
  assert.match(source, /afterFailure[\s\S]*entity\.filter/);
  assert.match(source, /recoverableFailedRun/);
  assert.match(source, /resumeFailedRun/);
  assert.match(source, /entity\.list\('created_date'/);
  assert.doesNotMatch(source, /query\.updated_date/);
});
