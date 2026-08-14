# Draft Recovery retention runbook

The application includes a protected `draftRecoveryRetention` backend function, but no automatic schedule or permanent-deletion permission is enabled. The active-retention and deletion periods must be approved before scheduling it.

## Required policy decisions

Record and approve two separate periods:

1. Active retention: how old an active `FormDraft` or `FormSubmissionIntake` must be before archival.
2. Archived retention: how old an archived record must be before permanent deletion.

The deletion period must be longer than the active-retention period. Permanent deletion remains blocked unless the `DRAFT_RECOVERY_PERMANENT_DELETION_ENABLED` secret is explicitly set to `true` after approval.

## Safe operation

- Invoke the function separately for `draft` and `intake` records.
- Start with `dryRun: true`, an explicit `olderThan` cutoff, and a bounded `batchSize` of at most 100.
- Review only the returned counts; the function does not log questionnaire contents.
- Archive runs select only non-archived records older than the cutoff.
- Delete runs select only archived records whose `archived_at` is older than the separate deletion cutoff.
- Records marked `active_investigation`, `legal_hold`, or `retention_hold` are excluded.
- Repeat bounded batches while `hasMore` is true. The archive operation is idempotent because already archived records are excluded and each update rechecks that condition.
- Schedule only after dry-run counts and both retention periods are approved. Use the narrowest supported Base44 scheduler identity and keep the existing admin authorization boundary.

Do not enable the permanent-deletion secret, create a deletion schedule, or remove held records without explicit approval.
