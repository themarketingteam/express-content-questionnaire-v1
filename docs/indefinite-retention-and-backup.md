# Express indefinite retention and recovery

## Policy

`FormDraft`, `FormSubmission`, `FormSubmissionIntake`, `FormDraftEvent`, `SubmissionPdfVersion`, and `ExpressIdentityResolutionAttempt` are retained under `indefinite_until_manual_deletion`. Three years is a minimum, not a deletion date. The former age-based retention endpoint is a fail-closed compatibility tombstone and always returns HTTP 410.

Direct entity deletion is admin-only. Normal users can create/update their drafts and draft events, but cannot delete retained records. Administrators must use the two-step Draft Recovery deletion workflow so S3 object versions are purged before Base44 records.

Base44's platform-level recently-deleted window is 30 days. It is not an independent backup and is not used as the recovery guarantee.

## AWS provisioning

Deploy `infrastructure/aws/express-recovery-backup.yaml` in the same region as the existing backup bucket. The current production target is `s3://express-tier-bucket/contentDraftEntry/` in `us-east-2`:

```bash
aws cloudformation deploy \
  --region us-east-2 \
  --stack-name express-recovery-backup \
  --template-file infrastructure/aws/express-recovery-backup.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    BackupBucketName=express-tier-bucket \
    BackupPrefix=contentDraftEntry \
    AlertEmail=YOUR-ALERT-ADDRESS
```

The stack preserves existing bucket-policy statements, including the CloudFront read grant for `assets/`. It enables versioning, public-access blocking, access logging, and TLS enforcement for the bucket, then requires the stack's KMS key for every upload beneath `contentDraftEntry/`. It does not change the bucket-wide default encryption because this is a shared bucket and doing so could unexpectedly KMS-encrypt unrelated website assets.

Client names, domains, emails, and answers never appear in object paths or logs. Records are stored under opaque hashed identifiers. Business names and draft-start timestamps remain inside the KMS-encrypted record bodies so administrators can search and restore through the Base44 recovery indexes without exposing identity in S3 keys.

The stack intentionally does not create IAM access keys. An AWS administrator must create one key for each named user and enter it directly into Base44 secrets. Never put credentials in Git, shell history, logs, or CloudFormation outputs.

Required Base44 secrets:

- `EXPRESS_BACKUP_S3_BUCKET`
- `EXPRESS_BACKUP_S3_PREFIX` (`contentDraftEntry` in production)
- `EXPRESS_BACKUP_AWS_REGION`
- `EXPRESS_BACKUP_KMS_KEY_ID`
- `EXPRESS_BACKUP_AWS_ACCESS_KEY_ID`
- `EXPRESS_BACKUP_AWS_SECRET_ACCESS_KEY`
- optional `EXPRESS_BACKUP_AWS_SESSION_TOKEN`
- `EXPRESS_PURGE_AWS_ACCESS_KEY_ID`
- `EXPRESS_PURGE_AWS_SECRET_ACCESS_KEY`
- optional `EXPRESS_PURGE_AWS_SESSION_TOKEN`
- `EXPRESS_BACKUP_MANIFEST_SIGNING_KEY` (at least 32 random bytes)
- `EXPRESS_DATA_LIFECYCLE_SIGNING_KEY` (a different value, at least 32 random bytes)
- `EXPRESS_BACKUP_SCHEDULE_ENABLED=true`

The writer can upload, list, and verify/read objects for backup and PDF downloads, but has an explicit delete denial. The purge user can list and delete object versions, but has an explicit read denial and no KMS permission. Object Lock is intentionally not enabled because authorized deletion must remain possible.

After secrets are configured, change the three `backupExpressRecoveryData` automations in its `function.jsonc` to active and redeploy. Two DST-safe starters invoke at 09:00/10:00 UTC but only the invocation occurring at 3 AM America/Chicago starts a run. The 15-minute worker only continues a running resumable backup.

## First backup and PDF migration

1. Run the production metadata migration and verify entity counts do not decrease.
2. In Draft Recovery, choose **Run Backup Now**.
3. Leave the worker enabled until the initial run reaches `completed`. The run cursor makes retries and duplicate invocations safe.
4. Verify the signed manifest, entity counts, checksums, and CloudWatch `BackupAgeHours` metric.
5. Verify all `SubmissionPdfVersion` records with files have `s3_object_key` and can download through a short-lived signed URL.
6. Request Base44 support to remove the superseded legacy Base44 file objects after the S3 copies and downloads have been verified. Base44 currently exposes no documented private-file deletion API, so the application does not pretend those legacy bytes were removed.

## Restore drill

Use a synthetic questionnaire session only. Delete its Base44 entity records outside the controlled purge workflow so the S3 backup and `ExpressBackupObject` indexes remain. In Draft Recovery, preview by session ID, verify checksums/conflicts, type the generated `RESTORE N RECORDS` phrase, and apply. Existing records are always skipped; overwrite is not supported. If Base44 does not preserve stable IDs on create, the restore stops immediately instead of creating a broken graph.

## Controlled deletion

1. Open the draft or standalone submission and choose **Delete Client Data**.
2. Select the required reason and type the exact business name (or session ID when no business name exists).
3. Review the resolved graph counts and confirm before the 10-minute authorization expires.
4. The service purges every S3 version first. Any S3 error or unmigrated PDF leaves all Base44 client records intact.
5. After external purge succeeds, connected events, identity attempts, PDFs, intakes, submissions, and drafts are deleted in dependency order.
6. A payload-free `ExpressDeletionAudit` remains with hashed identifiers, counts, administrator mode, reason, status, and timestamp.

Never link or delete records by business name. Graph resolution uses stable record IDs, final-submission IDs, linked-draft IDs, and questionnaire session IDs only.
