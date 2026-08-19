import { hmacSha256Hex, privacySafeObjectKey, sha256Hex } from './privateS3.ts';

export const BACKUP_SCHEMA_VERSION = 'express-recovery-backup-v1';
export const BACKUP_ENTITY_NAMES = [
  'FormDraft',
  'FormSubmission',
  'FormSubmissionIntake',
  'FormDraftEvent',
  'SubmissionPdfVersion',
  'ExpressIdentityResolutionAttempt',
] as const;

export type BackupEntityName = typeof BACKUP_ENTITY_NAMES[number];

export function recordFallsWithinBackupWindow(
  record: Record<string, unknown>,
  since: string,
  cutoff: string,
): boolean {
  const sourceTimestamp = Date.parse(String(record.updated_date || record.created_date || ''));
  const sinceTimestamp = Date.parse(since || '');
  const cutoffTimestamp = Date.parse(cutoff || '');
  if (!Number.isFinite(sourceTimestamp)) return !since;
  if (Number.isFinite(sinceTimestamp) && sourceTimestamp <= sinceTimestamp) return false;
  return !Number.isFinite(cutoffTimestamp) || sourceTimestamp <= cutoffTimestamp;
}

export function isUsableCompletedBackupRun(run: Record<string, unknown>): boolean {
  if (run.status !== 'completed' || !run.completed_at) return false;
  let metrics: Record<string, unknown> = {};
  try { metrics = JSON.parse(String(run.metrics_json || '{}')); } catch { return false; }
  const records = Number(metrics.records || 0);
  return records > 0 || metrics.fullSnapshot === false;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)]),
  );
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sessionIdentifier(record: Record<string, unknown>): string {
  const candidate = record.session_id || record.questionnaire_session_id;
  return typeof candidate === 'string' ? candidate.trim() : '';
}

export async function buildRecordBackup({
  entityName,
  record,
  backedUpAt,
}: {
  entityName: BackupEntityName;
  record: Record<string, unknown>;
  backedUpAt: string;
}): Promise<{
  key: string;
  body: string;
  payloadHash: string;
  recordIdHash: string;
  sessionIdHash: string;
}> {
  const recordId = String(record.id || '').trim();
  if (!recordId) throw new Error('A stable source record ID is required for backup.');
  const envelope = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    entityName,
    recordId,
    backedUpAt,
    record,
  };
  const body = stableJson(envelope);
  const sessionId = sessionIdentifier(record);
  return {
    key: await privacySafeObjectKey(entityName, recordId),
    body,
    payloadHash: await sha256Hex(body),
    recordIdHash: await sha256Hex(`record:${entityName}:${recordId}`),
    sessionIdHash: sessionId ? await sha256Hex(`session:${sessionId}`) : '',
  };
}

export async function buildSignedManifest({
  runId,
  startedAt,
  completedAt,
  counts,
  checksums = {},
  signingKey,
}: {
  runId: string;
  startedAt: string;
  completedAt: string;
  counts: Record<string, number>;
  checksums?: Record<string, string>;
  signingKey: string;
}): Promise<{ body: string; hash: string; signature: string; key: string }> {
  if (!signingKey) throw new Error('Manifest signing is not configured.');
  const unsigned = stableJson({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    runId,
    status: 'completed',
    startedAt,
    completedAt,
    counts,
    checksums,
  });
  const hash = await sha256Hex(unsigned);
  const signature = await hmacSha256Hex(signingKey, hash);
  const body = stableJson({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    manifest: JSON.parse(unsigned),
    hash,
    signature: { algorithm: 'HMAC-SHA256', value: signature },
  });
  const runHash = await sha256Hex(`backup-run:${runId}`);
  return { body, hash, signature, key: `manifests/v1/${runHash}.json` };
}

export function backupIsStale(lastSuccessAt: string | null | undefined, now = Date.now()): boolean {
  const timestamp = Date.parse(lastSuccessAt || '');
  return !Number.isFinite(timestamp) || now - timestamp > 36 * 60 * 60 * 1_000;
}
