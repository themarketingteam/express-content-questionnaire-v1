const DEFAULT_RETENTION_BATCH_SIZE = 25;
export const MAX_RETENTION_BATCH_SIZE = 100;

export type RecoveryRetentionRequest = {
  action: 'archive' | 'delete';
  recordType: 'draft' | 'intake';
  olderThan: string;
  batchSize: number;
  dryRun: boolean;
};

type RetentionRequestResult =
  | { ok: true; value: RecoveryRetentionRequest }
  | { ok: false; error: string };

export function normalizeRetentionRequest(body: Record<string, unknown>): RetentionRequestResult {
  const action = body.action === 'delete' ? 'delete' : body.action === 'archive' ? 'archive' : null;
  if (!action) return { ok: false, error: 'action must be archive or delete.' };

  const recordType = body.recordType;
  if (recordType !== 'draft' && recordType !== 'intake') {
    return { ok: false, error: 'Unsupported recordType.' };
  }

  const olderThan = typeof body.olderThan === 'string' ? body.olderThan.trim() : '';
  const cutoffTime = Date.parse(olderThan);
  if (!olderThan || !Number.isFinite(cutoffTime) || cutoffTime >= Date.now()) {
    return { ok: false, error: 'olderThan must be a valid timestamp in the past.' };
  }

  const numericBatchSize = Number(body.batchSize);
  const batchSize = Number.isFinite(numericBatchSize)
    ? Math.min(MAX_RETENTION_BATCH_SIZE, Math.max(1, Math.trunc(numericBatchSize)))
    : DEFAULT_RETENTION_BATCH_SIZE;

  return {
    ok: true,
    value: {
      action,
      recordType,
      olderThan: new Date(cutoffTime).toISOString(),
      batchSize,
      dryRun: body.dryRun !== false,
    },
  };
}

export function isRetentionCandidate(
  record: Record<string, unknown>,
  request: RecoveryRetentionRequest,
): boolean {
  if (record.active_investigation === true || record.legal_hold === true || record.retention_hold === true) {
    return false;
  }

  if (request.action === 'archive') {
    if (record.archived === true) return false;
    const updatedAt = Date.parse(String(record.updated_date || record.last_saved_at || ''));
    return Number.isFinite(updatedAt) && updatedAt < Date.parse(request.olderThan);
  }

  if (record.archived !== true) return false;
  const archivedAt = Date.parse(String(record.archived_at || ''));
  return Number.isFinite(archivedAt) && archivedAt < Date.parse(request.olderThan);
}

export function buildRetentionQuery(request: RecoveryRetentionRequest): Record<string, unknown> {
  const holds = {
    active_investigation: { $ne: true },
    legal_hold: { $ne: true },
    retention_hold: { $ne: true },
  };

  return request.action === 'archive'
    ? { ...holds, archived: { $ne: true }, updated_date: { $lt: request.olderThan } }
    : { ...holds, archived: true, archived_at: { $lt: request.olderThan } };
}
