import { withEntityLease } from './entityLease.ts';

function compareDrafts(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftCreated = Date.parse(String(left.created_date || '')) || 0;
  const rightCreated = Date.parse(String(right.created_date || '')) || 0;
  if (leftCreated !== rightCreated) return leftCreated - rightCreated;
  return String(left.id || '').localeCompare(String(right.id || ''));
}

async function findCoordinators(base44: any, sessionId: string): Promise<Array<Record<string, unknown>>> {
  const drafts = await base44.asServiceRole.entities.FormDraft.filter(
    { session_id: sessionId },
    'created_date',
    100,
  );
  return [...(drafts || [])].sort(compareDrafts);
}

export async function ensureSubmissionCoordinator({
  base44,
  sessionId,
  initialSnapshot = {},
}: {
  base44: any;
  sessionId: string;
  initialSnapshot?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!sessionId) throw new Error('A submission coordination key is required.');

  let drafts = await findCoordinators(base44, sessionId);
  if (drafts[0]) return drafts[0];

  await base44.asServiceRole.entities.FormDraft.create({
    session_id: sessionId,
    status: 'submitting',
    retention_policy: 'indefinite_until_manual_deletion',
    retention_policy_version: '2026-08-18',
    retention_protected_at: new Date().toISOString(),
    ...initialSnapshot,
  });

  // Normal form sessions already have a draft. This stabilization window only
  // reconciles concurrent recovery requests that both found a missing draft.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 75 * (attempt + 1)));
    drafts = await findCoordinators(base44, sessionId);
    if (drafts[0]) return drafts[0];
  }
  throw new Error('Unable to establish a persistence coordinator for this submission.');
}

export async function withSubmissionSessionLease<T>({
  base44,
  sessionId,
  purpose,
  initialSnapshot = {},
  operation,
}: {
  base44: any;
  sessionId: string;
  purpose: string;
  initialSnapshot?: Record<string, unknown>;
  operation: (coordinator: Record<string, unknown>) => Promise<T>;
}): Promise<T> {
  const coordinator = await ensureSubmissionCoordinator({ base44, sessionId, initialSnapshot });
  return await withEntityLease(
    {
      entity: base44.asServiceRole.entities.FormDraft,
      entityId: String(coordinator.id),
      purpose,
      leaseDurationMs: 60_000,
      waitTimeoutMs: 20_000,
    },
    () => operation(coordinator),
  );
}
