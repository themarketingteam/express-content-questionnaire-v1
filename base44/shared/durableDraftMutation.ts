import { withEntityLease } from './entityLease.ts';
import { createQuestionnaireVersion, snapshotFromDraft } from './questionnaireVersions.ts';

export type DraftMutationMetadata = {
  mutationId: string;
  clientInstanceId?: string;
  clientSequence?: number;
  baseRevision?: number;
  changedKeys?: string[];
  deletedKeys?: string[];
  serverTimestamp?: string;
};

type DurableDraftMutationOptions = {
  base44: any;
  draftId: string;
  nextValues: Record<string, unknown>;
  metadata: DraftMutationMetadata;
  versionType?: string;
  sourceRecordId?: string;
  sourceVersionId?: string;
  additionalMeaningfulReasons?: string[];
  allowFinalized?: boolean;
};

function safeInteger(value: unknown): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function cleanKeys(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 250))]
    .sort();
}

function withoutEntityMetadata(snapshot: Record<string, unknown>): Record<string, unknown> {
  const materialized = { ...snapshot };
  delete materialized.id;
  delete materialized.created_date;
  delete materialized.updated_date;
  delete materialized.created_by;
  delete materialized.updated_by;
  delete materialized.idempotency_lock_token;
  delete materialized.idempotency_lock_key;
  delete materialized.idempotency_lock_expires_at;
  return materialized;
}

function parseSnapshot(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function findMutationVersion(entity: any, versionKey: string): Promise<Record<string, any> | null> {
  const records = await entity.filter({ version_key: versionKey }, '-created_date', 1, 0, [
    'id', 'draft_id', 'version_key', 'snapshot_json', 'snapshot_hash', 'captured_at',
  ]);
  return records?.[0] || null;
}

/**
 * Version-first serialized mutation contract.
 *
 * The immutable QuestionnaireVersion is written before FormDraft is advanced.
 * If materialization fails, the same mutation ID finds the retained version and
 * safely finishes materialization on retry. No accepted mutation is acknowledged
 * until both steps are durable.
 */
export async function applyDurableDraftMutation({
  base44,
  draftId,
  nextValues,
  metadata,
  versionType = 'autosave',
  sourceRecordId = '',
  sourceVersionId = '',
  additionalMeaningfulReasons = [],
  allowFinalized = false,
}: DurableDraftMutationOptions): Promise<Record<string, any>> {
  if (!draftId) throw new Error('A draft ID is required for a durable mutation.');
  const mutationId = String(metadata?.mutationId || '').trim();
  if (!mutationId || mutationId.length > 500) throw new Error('A stable mutation ID is required.');

  const draftEntity = base44.asServiceRole.entities.FormDraft;
  const versionEntity = base44.asServiceRole.entities.QuestionnaireVersion;
  const versionKey = `${draftId}:mutation:${mutationId}`;

  return await withEntityLease({
    entity: draftEntity,
    entityId: draftId,
    purpose: `questionnaire-mutation:${mutationId}`,
    leaseDurationMs: 30_000,
    waitTimeoutMs: 20_000,
  }, async () => {
    let current = await draftEntity.get(draftId);
    const currentRevision = safeInteger(current.last_confirmed_revision);
    const clientSequence = safeInteger(metadata.clientSequence);
    const baseRevision = safeInteger(metadata.baseRevision);
    const clientInstanceId = String(metadata.clientInstanceId || '').slice(0, 300);
    const changedKeys = cleanKeys(metadata.changedKeys);
    const deletedKeys = cleanKeys(metadata.deletedKeys);
    const serverTimestamp = metadata.serverTimestamp || new Date().toISOString();

    const existingVersion = await findMutationVersion(versionEntity, versionKey);
    if (existingVersion) {
      if (String(current.last_materialized_version_id || '') !== String(existingVersion.id)) {
        const retainedSnapshot = parseSnapshot(existingVersion.snapshot_json);
        if (!retainedSnapshot) throw new Error('The retained mutation snapshot is unreadable.');
        current = await draftEntity.update(draftId, {
          ...withoutEntityMetadata(retainedSnapshot),
          last_mutation_id: mutationId,
          last_materialized_version_id: String(existingVersion.id),
          last_client_instance_id: clientInstanceId,
          last_client_sequence: clientSequence,
          last_base_revision: baseRevision,
          last_changed_keys_json: JSON.stringify(changedKeys),
          last_deleted_keys_json: JSON.stringify(deletedKeys),
          authoritative_server_timestamp: String(existingVersion.captured_at || serverTimestamp),
        });
      }
      return {
        accepted: true,
        duplicate: true,
        stale: false,
        draft: current,
        version: existingVersion,
      };
    }

    if (!allowFinalized && (String(current.status || '') === 'submitted' || current.final_submission_id)) {
      return { accepted: false, duplicate: false, stale: true, finalized: true, draft: current };
    }
    const sameOrderedClient = Boolean(
      clientInstanceId
      && clientInstanceId === String(current.last_client_instance_id || '')
      && clientSequence > safeInteger(current.last_client_sequence),
    );
    if (baseRevision !== currentRevision && !sameOrderedClient) {
      return { accepted: false, duplicate: false, stale: true, draft: current };
    }
    if (clientInstanceId
      && clientInstanceId === String(current.last_client_instance_id || '')
      && clientSequence > 0
      && clientSequence <= safeInteger(current.last_client_sequence)) {
      return { accepted: false, duplicate: false, stale: true, draft: current };
    }

    const nextRevision = Math.max(currentRevision + 1, clientSequence || 0);
    const nextDraft = {
      ...current,
      ...nextValues,
      id: draftId,
      session_id: String(nextValues.session_id || current.session_id || ''),
      client_revision: nextRevision,
      last_confirmed_revision: nextRevision,
      last_mutation_id: mutationId,
      last_client_instance_id: clientInstanceId,
      last_client_sequence: clientSequence,
      last_base_revision: baseRevision,
      last_changed_keys_json: JSON.stringify(changedKeys),
      last_deleted_keys_json: JSON.stringify(deletedKeys),
      authoritative_server_timestamp: serverTimestamp,
    };

    const version = await createQuestionnaireVersion({
      base44,
      draft: nextDraft,
      previous: current,
      versionType,
      additionalMeaningfulReasons,
      sourceRecordId: sourceRecordId || draftId,
      sourceVersionId,
      capturedAt: serverTimestamp,
      versionKey,
      mutationMetadata: {
        mutationId,
        clientInstanceId,
        clientSequence,
        baseRevision,
        changedKeys,
        deletedKeys,
        serverTimestamp,
      },
    });
    if (!version?.id) throw new Error('The immutable questionnaire version was not retained.');

    const materialized = await draftEntity.update(draftId, {
      ...withoutEntityMetadata(snapshotFromDraft(nextDraft)),
      last_materialized_version_id: String(version.id),
    });
    return {
      accepted: true,
      duplicate: false,
      stale: false,
      draft: materialized,
      version,
    };
  });
}
