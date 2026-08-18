export const INDEFINITE_RETENTION_POLICY = 'indefinite_until_manual_deletion';
export const RETENTION_POLICY_VERSION = '2026-08-18';
export const AUTOMATED_RETENTION_DISABLED_ERROR =
  'Automatic archival and deletion are disabled. Client recovery data is retained indefinitely until an authorized manual deletion.';

export type RecoveryRetentionRequest = never;

type RetentionRequestResult = { ok: false; error: string };

/**
 * Reject every legacy age-based request. Keeping this surface prevents stale
 * callers from failing open while making the indefinite policy irreversible
 * through a feature flag or an arbitrary cutoff timestamp.
 */
export function normalizeRetentionRequest(_body: Record<string, unknown>): RetentionRequestResult {
  return { ok: false, error: AUTOMATED_RETENTION_DISABLED_ERROR };
}

export function isRetentionCandidate(_record: Record<string, unknown>): false {
  return false;
}

export function buildRetentionQuery(): Record<string, unknown> {
  return { id: '__automatic_retention_is_disabled__' };
}

export function retentionPolicyFields(now = new Date()): Record<string, string> {
  return {
    retention_policy: INDEFINITE_RETENTION_POLICY,
    retention_policy_version: RETENTION_POLICY_VERSION,
    retention_protected_at: now.toISOString(),
  };
}
