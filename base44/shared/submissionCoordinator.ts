import { withEntityLease, type EntityLease } from './entityLease.ts';
import { draftAllowsAccess } from './draftAccess.ts';

type CoordinatorAuthority = { draftId?: string; accessKeyHash?: string; trustedDraftId?: string };

function requireUnambiguousDrafts(drafts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (drafts.length > 1) throw Object.assign(new Error('Multiple saved drafts share this session. Recovery review is required before saving or submitting.'), { code: 'AMBIGUOUS_DRAFT_SESSION', status: 409 });
  return drafts;
}

function compareDrafts(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftCreated = Date.parse(String(left.created_date || '')) || 0;
  const rightCreated = Date.parse(String(right.created_date || '')) || 0;
  if (leftCreated !== rightCreated) return leftCreated - rightCreated;
  return String(left.id || '').localeCompare(String(right.id || ''));
}

async function findCoordinators(base44: any, sessionId: string, authority: CoordinatorAuthority = {}): Promise<Array<Record<string, unknown>>> {
  const drafts = await base44.asServiceRole.entities.FormDraft.filter(
    { session_id: sessionId },
    'created_date',
    100,
  );
  const candidates = [...(drafts || [])].sort(compareDrafts);
  if (authority.trustedDraftId) {
    const trusted = candidates.find((draft) => draft.id === authority.trustedDraftId);
    if (!trusted) throw Object.assign(new Error('The recovery source does not belong to this draft session.'), { code: 'DRAFT_ACCESS_DENIED', status: 403 });
    return [trusted];
  }
  if (authority.draftId || authority.accessKeyHash) {
    const scoped = candidates.filter((draft) => draftAllowsAccess(draft, authority.accessKeyHash || ''));
    if (!authority.draftId || !authority.accessKeyHash || !scoped.length || !scoped.some((draft) => draft.id === authority.draftId)) {
      throw Object.assign(new Error('Draft access was denied.'), { code: 'DRAFT_ACCESS_DENIED', status: 403 });
    }
    return requireUnambiguousDrafts(scoped);
  }
  return requireUnambiguousDrafts(candidates);
}

export async function ensureSubmissionCoordinator({
  base44,
  sessionId,
  initialSnapshot = {},
  authority = {},
}: {
  base44: any;
  sessionId: string;
  initialSnapshot?: Record<string, unknown>;
  authority?: CoordinatorAuthority;
}): Promise<Record<string, unknown>> {
  if (!sessionId) throw new Error('A submission coordination key is required.');

  let drafts = await findCoordinators(base44, sessionId, authority);
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
    drafts = await findCoordinators(base44, sessionId, authority);
    if (drafts[0]) return drafts[0];
  }
  throw new Error('Unable to establish a persistence coordinator for this submission.');
}

export async function withSubmissionSessionLease<T>({
  base44,
  sessionId,
  purpose,
  initialSnapshot = {},
  authority = {},
  operation,
}: {
  base44: any;
  sessionId: string;
  purpose: string;
  initialSnapshot?: Record<string, unknown>;
  authority?: CoordinatorAuthority;
  operation: (coordinator: Record<string, unknown>, lease: EntityLease) => Promise<T>;
}): Promise<T> {
  const coordinator = await ensureSubmissionCoordinator({ base44, sessionId, initialSnapshot, authority });
  return await withEntityLease(
    {
      entity: base44.asServiceRole.entities.FormDraft,
      entityId: String(coordinator.id),
      purpose,
      leaseDurationMs: 60_000,
      waitTimeoutMs: 20_000,
    },
    // The discovery read can precede another writer's lease. Always inspect the
    // authoritative checkpoint after our lease has actually been acquired.
    async (lease) => {
      await findCoordinators(base44, sessionId, authority);
      const current = await base44.asServiceRole.entities.FormDraft.get(String(coordinator.id));
      if (authority.accessKeyHash && !draftAllowsAccess(current, authority.accessKeyHash)) throw Object.assign(new Error('Draft access was denied.'), { code: 'DRAFT_ACCESS_DENIED', status: 403 });
      return operation(current, lease);
    },
  );
}
