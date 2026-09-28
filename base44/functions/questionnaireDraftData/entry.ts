import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { draftAllowsAccess, withoutDraftAccessHashes } from '../../shared/draftAccess.ts';
import {
  createQuestionnaireVersion,
  normalizeIdentityValue,
} from '../../shared/questionnaireVersions.ts';
import { applyDurableDraftMutation } from '../../shared/durableDraftMutation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

const encoder = new TextEncoder();
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{20,160}$/;
const ACCESS_KEY_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;
const TELEMETRY_EVENT_TYPES = new Set([
  'bootstrap_failed',
  'bootstrap_recovered',
  'storage_blocked',
  'save_rejected',
  'save_retrying',
  'retry_exhausted',
  'visibility_flush',
  'pagehide_flush',
  'online_recovery',
]);

const stringFieldLimits: Record<string, number> = {
  business_name: 500,
  domain: 500,
  user_id: 500,
  user_name: 500,
  user_email: 500,
  status: 100,
  current_question_id: 100,
  last_changed_question_id: 100,
  responses_json: 1_000_000,
  validation_status_json: 1_000_000,
  touched_questions_json: 250_000,
  expanded_questions_json: 250_000,
  metadata_json: 1_000_000,
  userdata_json: 1_000_000,
  mapped_payload_json: 2_000_000,
  draft_metadata_json: 250_000,
  save_error: 10_000,
  submit_error: 100_000,
  submit_attempted_at: 100,
  submitted_at: 100,
  last_changed_at: 100,
  last_saved_at: 100,
  final_submission_id: 500,
  last_non_empty_answers_json: 1_000_000,
  field_history_json: 1_000_000,
  last_local_persisted_at: 100,
};

function isValidIdentity(sessionId: unknown, accessKey: unknown): sessionId is string {
  return typeof sessionId === 'string'
    && SESSION_ID_PATTERN.test(sessionId)
    && typeof accessKey === 'string'
    && ACCESS_KEY_PATTERN.test(accessKey);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashAccessKey(accessKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(accessKey));
  return bytesToHex(new Uint8Array(digest));
}

function sanitizeDraft(rawDraft: unknown, sessionId: string): Record<string, string> | null {
  if (!rawDraft || typeof rawDraft !== 'object' || Array.isArray(rawDraft)) return null;

  const source = rawDraft as Record<string, unknown>;
  const draft: Record<string, string> = { session_id: sessionId };

  for (const [field, maxLength] of Object.entries(stringFieldLimits)) {
    if (!(field in source)) continue;
    const value = source[field];
    if (typeof value !== 'string' || value.length > maxLength) return null;
    draft[field] = value;
  }

  for (const jsonField of [
    'responses_json',
    'validation_status_json',
    'touched_questions_json',
    'expanded_questions_json',
    'metadata_json',
    'userdata_json',
    'mapped_payload_json',
    'draft_metadata_json',
    'last_non_empty_answers_json',
    'field_history_json',
  ]) {
    if (!draft[jsonField]) continue;
    try {
      const parsed = JSON.parse(draft[jsonField]);
      if (!parsed || typeof parsed !== 'object') return null;
    } catch {
      return null;
    }
  }

  return draft;
}

function sanitizeRevision(value: unknown): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? Math.min(numeric, 2_147_483_647) : 0;
}

function sanitizeMutationString(value: unknown, maxLength = 500): string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
    ? value.trim()
    : '';
}

function sanitizeMutationKeys(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 250))]
    .sort();
}

function sanitizeIdentity(rawIdentity: unknown): Record<string, string> {
  const source = rawIdentity && typeof rawIdentity === 'object' && !Array.isArray(rawIdentity)
    ? rawIdentity as Record<string, unknown>
    : {};
  const limits: Record<string, number> = {
    business_name: 500,
    domain: 500,
    user_id: 500,
    user_name: 500,
    user_email: 500,
  };
  const identity: Record<string, string> = {};
  for (const [field, limit] of Object.entries(limits)) {
    const value = source[field];
    if (typeof value === 'string' && value.trim() && value.length <= limit) identity[field] = value.trim();
  }
  return identity;
}

function hasScopedAccess(draft: Record<string, unknown> | null): boolean {
  return Boolean(
    draft?.draft_access_key_hash
    || (Array.isArray(draft?.draft_recovery_access_key_hashes)
      && draft.draft_recovery_access_key_hashes.length > 0),
  );
}

function classifyFailureCode(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9_-]{1,80}$/.test(normalized) ? normalized : 'unknown';
}

async function recordPersistenceTelemetry({
  base44,
  existing,
  sessionId,
  eventType,
  telemetry,
}: {
  base44: any;
  existing: Record<string, unknown>;
  sessionId: string;
  eventType: string;
  telemetry: Record<string, unknown>;
}): Promise<void> {
  const now = new Date().toISOString();
  const pendingRevision = sanitizeRevision(telemetry.pendingRevision);
  const lastConfirmedRevision = sanitizeRevision(telemetry.lastConfirmedRevision);
  const failureCode = classifyFailureCode(telemetry.failureCode);
  const safeTelemetry = {
    attempt: Math.min(100, Math.max(0, sanitizeRevision(telemetry.attempt))),
    pending_revision: pendingRevision,
    last_confirmed_revision: lastConfirmedRevision,
    failure_code: failureCode,
    online: telemetry.online !== false,
    storage_available: telemetry.storageAvailable !== false,
    url_credential_persisted: telemetry.urlCredentialPersisted !== false,
  };

  await base44.asServiceRole.entities.FormDraftEvent.create({
    session_id: sessionId,
    event_type: eventType,
    question_id: '',
    question_type: 'persistence_telemetry',
    value_json: JSON.stringify(safeTelemetry),
    value_summary: `Persistence telemetry: ${eventType}`,
    value_length: JSON.stringify(safeTelemetry).length,
    selected_option_count: 0,
    business_name: typeof existing.business_name === 'string' ? existing.business_name : '',
    domain: typeof existing.domain === 'string' ? existing.domain : '',
    user_id: typeof existing.user_id === 'string' ? existing.user_id : '',
    submit_attempt_id: '',
    created_at_iso: now,
    retention_policy: 'indefinite_until_manual_deletion',
    retention_policy_version: '2026-08-18',
    retention_protected_at: now,
  });

  const healthStatus = eventType === 'retry_exhausted'
    ? 'retry_exhausted'
    : eventType === 'save_retrying' || eventType === 'save_rejected'
      ? 'retrying'
      : 'healthy';
  await base44.asServiceRole.entities.FormDraft.update(String(existing.id), {
    persistence_health_status: healthStatus,
    last_persistence_telemetry_at: now,
    last_save_failure_code: healthStatus === 'healthy' ? '' : failureCode,
    ...(eventType === 'storage_blocked' ? { storage_available: false } : {}),
  });
}

function newestRecord(records: any[]): any | null {
  return [...(records || [])].sort((left, right) => {
    const leftTime = new Date(left.last_saved_at || left.updated_date || left.created_date || 0).getTime() || 0;
    const rightTime = new Date(right.last_saved_at || right.updated_date || right.created_date || 0).getTime() || 0;
    return rightTime - leftTime;
  })[0] || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'Invalid request.' }, 400);
  }

  if (!isValidIdentity(body.sessionId, body.accessKey)) {
    return json({ success: false, error: 'A valid draft identity is required.' }, 400);
  }

  const sessionId = body.sessionId;
  const accessKeyHash = await hashAccessKey(body.accessKey as string);
  const base44 = createClientFromRequest(req);

  try {
    const matches = await base44.asServiceRole.entities.FormDraft.filter(
      { session_id: sessionId },
      '-last_saved_at',
      10,
    );
    const existing = newestRecord(matches || []);

    if (body.action === 'bootstrap') {
      if (existing && hasScopedAccess(existing) && !draftAllowsAccess(existing, accessKeyHash)) {
        console.warn(JSON.stringify({
          functionName: 'questionnaireDraftData',
          deliveryStage: 'bootstrap_rejected',
          identifier: sessionId,
        }));
        return json({ success: false, error: 'Draft access was denied.', code: 'access_denied' }, 403);
      }

      const now = new Date().toISOString();
      const identity = sanitizeIdentity(body.identity);
      const attempt = Math.min(100, Math.max(1, sanitizeRevision(body.attempt) || 1));
      const updates: Record<string, unknown> = {
        draft_access_key_hash: existing?.draft_access_key_hash || accessKeyHash,
        bootstrap_confirmed_at: now,
        bootstrap_attempt_count: attempt,
        persistence_health_status: 'healthy',
        storage_available: body.storageAvailable !== false,
        url_credential_persisted: body.urlCredentialPersisted !== false,
        retention_policy: 'indefinite_until_manual_deletion',
        retention_policy_version: '2026-08-18',
        retention_protected_at: existing?.retention_protected_at || now,
      };
      for (const [field, value] of Object.entries(identity)) {
        if (!existing?.[field]) updates[field] = value;
      }
      const resolvedUserId = String(existing?.user_id || identity.user_id || '');
      const resolvedEmail = String(existing?.user_email || identity.user_email || '');
      const resolvedBusiness = String(existing?.business_name || identity.business_name || '');
      const resolvedDomain = String(existing?.domain || identity.domain || '');
      updates.normalized_user_id = normalizeIdentityValue(resolvedUserId);
      updates.normalized_user_email = normalizeIdentityValue(resolvedEmail, 'email');
      updates.normalized_business_name = normalizeIdentityValue(resolvedBusiness);
      updates.normalized_domain = normalizeIdentityValue(resolvedDomain, 'domain');

      const savedResult = existing
        ? await base44.asServiceRole.entities.FormDraft.update(existing.id, updates)
        : await base44.asServiceRole.entities.FormDraft.create({
          session_id: sessionId,
          status: 'draft',
          responses_json: '{}',
          validation_status_json: '{}',
          touched_questions_json: '{}',
          expanded_questions_json: '{}',
          metadata_json: '{}',
          userdata_json: '{}',
          mapped_payload_json: '{}',
          draft_metadata_json: JSON.stringify({
            app: 'express_questionnaire',
            source: 'server_bootstrap',
            schema_version: '3',
          }),
          client_revision: 0,
          last_confirmed_revision: 0,
          last_changed_at: now,
          last_saved_at: now,
          ...identity,
          ...updates,
        });
      const saved = { ...(existing || {}), ...(savedResult || {}) };
      const bootstrapVersion = await createQuestionnaireVersion({
        base44,
        draft: saved,
        previous: null,
        versionType: 'legacy_baseline',
        additionalMeaningfulReasons: ['server_bootstrap_baseline'],
        sourceRecordId: String(saved.id),
        capturedAt: String(saved.last_saved_at || saved.updated_date || now),
        versionKey: `${saved.id}:server-bootstrap-baseline`,
        reconstructionLabel: existing
          ? 'First server-confirmed baseline for an existing draft'
          : 'Server bootstrap baseline',
      });
      if (!bootstrapVersion?.id) throw new Error('The server draft baseline was not retained.');

      console.info(JSON.stringify({
        functionName: 'questionnaireDraftData',
        deliveryStage: existing ? 'bootstrap_confirmed' : 'bootstrap_created',
        identifier: sessionId,
        attempt,
      }));
      return json({
        success: true,
        bootstrapConfirmed: true,
        created: !existing,
        draftId: saved.id || existing?.id,
        lastSavedAt: saved.last_saved_at || saved.updated_date || now,
        lastConfirmedRevision: sanitizeRevision(saved.last_confirmed_revision),
        draft: withoutDraftAccessHashes(saved),
      });
    }

    if (body.action === 'load') {
      if (!existing) return json({ success: true, draft: null });
      if (!draftAllowsAccess(existing, accessKeyHash)) {
        return json({ success: false, error: 'Draft access was denied.' }, 403);
      }
      return json({ success: true, draft: withoutDraftAccessHashes(existing) });
    }

    if (body.action === 'telemetry') {
      if (!existing || !draftAllowsAccess(existing, accessKeyHash)) {
        return json({ success: false, error: 'Draft access was denied.', code: 'access_denied' }, 403);
      }
      const eventType = typeof body.eventType === 'string' ? body.eventType : '';
      if (!TELEMETRY_EVENT_TYPES.has(eventType)) {
        return json({ success: false, error: 'Unsupported telemetry event.' }, 400);
      }
      const telemetry = body.telemetry && typeof body.telemetry === 'object' && !Array.isArray(body.telemetry)
        ? body.telemetry as Record<string, unknown>
        : {};
      await recordPersistenceTelemetry({ base44, existing, sessionId, eventType, telemetry });
      console.info(JSON.stringify({
        functionName: 'questionnaireDraftData',
        deliveryStage: eventType,
        identifier: sessionId,
        pendingRevision: sanitizeRevision(telemetry.pendingRevision),
        lastConfirmedRevision: sanitizeRevision(telemetry.lastConfirmedRevision),
      }));
      return json({ success: true, recorded: true });
    }

    if (body.action !== 'save' && body.action !== 'checkpoint') {
      return json({ success: false, error: 'Unsupported action.' }, 400);
    }

    const draft = sanitizeDraft(body.draft, sessionId);
    if (!draft) return json({ success: false, error: 'Draft data is invalid.' }, 400);

    const existingHasScopedAccess = hasScopedAccess(existing);
    if (existingHasScopedAccess && !draftAllowsAccess(existing, accessKeyHash)) {
      return json({ success: false, error: 'Draft access was denied.' }, 403);
    }

    if (body.action === 'checkpoint') {
      if (!existing) return json({ success: false, error: 'Draft not found.' }, 404);
      if (existing.status === 'submitted' || existing.final_submission_id) {
        return json({ success: true, saved: false, finalized: true, draft: withoutDraftAccessHashes(existing) });
      }
      const checkpointType = body.checkpointType === 'explicit_clear' ? 'explicit_clear' : '';
      if (!checkpointType) return json({ success: false, error: 'Unsupported checkpoint type.' }, 400);
      const incomingRevision = sanitizeRevision((body.draft as Record<string, unknown>)?.client_revision);
      const mutationId = sanitizeMutationString(body.mutationId)
        || sanitizeMutationString((body.draft as Record<string, unknown>)?.mutation_id)
        || `${checkpointType}:${incomingRevision}`;
      const result = await applyDurableDraftMutation({
        base44,
        draftId: String(existing.id),
        nextValues: {
          ...draft,
          status: existing.status || 'draft',
          last_saved_at: new Date().toISOString(),
        },
        metadata: {
          mutationId,
          clientInstanceId: sanitizeMutationString(body.clientInstanceId || (body.draft as Record<string, unknown>)?.client_instance_id, 300),
          clientSequence: sanitizeRevision(body.clientSequence || (body.draft as Record<string, unknown>)?.client_sequence || incomingRevision),
          baseRevision: sanitizeRevision(body.baseRevision ?? (body.draft as Record<string, unknown>)?.base_revision ?? existing.last_confirmed_revision),
          changedKeys: sanitizeMutationKeys(body.changedKeys || (() => { try { return JSON.parse(String((body.draft as Record<string, unknown>)?.changed_keys_json || '[]')); } catch { return []; } })()),
          deletedKeys: sanitizeMutationKeys(body.deletedKeys || (() => { try { return JSON.parse(String((body.draft as Record<string, unknown>)?.deleted_keys_json || '[]')); } catch { return []; } })()),
        },
        versionType: checkpointType,
        sourceRecordId: String(existing.id),
        additionalMeaningfulReasons: ['explicit_clear'],
      });
      return json({
        success: true,
        saved: Boolean(result.accepted),
        stale: Boolean(result.stale),
        materialized: Boolean(result.accepted),
        versionId: result.version?.id || '',
        draftId: existing.id,
        lastConfirmedRevision: sanitizeRevision(result.draft?.last_confirmed_revision),
      });
    }

    // A finalized draft is immutable from the public autosave path. Delayed
    // pagehide/background/stale-tab saves receive the durable server state and
    // can never rematerialize or downgrade a completed questionnaire.
    if (existing && (existing.status === 'submitted' || existing.final_submission_id)) {
      return json({
        success: true,
        saved: false,
        stale: true,
        finalized: true,
        draftId: existing.id,
        lastSavedAt: existing.last_saved_at || existing.updated_date || '',
        lastConfirmedRevision: sanitizeRevision(existing.last_confirmed_revision),
        draft: withoutDraftAccessHashes(existing),
      });
    }

    if (!existing) {
      return json({ success: false, error: 'The server draft must be bootstrapped before saving.', code: 'bootstrap_required' }, 409);
    }

    const incomingRevision = sanitizeRevision((body.draft as Record<string, unknown>)?.client_revision);
    const existingRevision = sanitizeRevision(existing.last_confirmed_revision);

    const nextDraft: Record<string, unknown> = {
      ...draft,
      normalized_user_id: normalizeIdentityValue(draft.user_id || existing?.user_id),
      normalized_user_email: normalizeIdentityValue(draft.user_email || existing?.user_email, 'email'),
      normalized_business_name: normalizeIdentityValue(draft.business_name || existing?.business_name),
      normalized_domain: normalizeIdentityValue(draft.domain || existing?.domain, 'domain'),
      client_revision: incomingRevision,
      persistence_health_status: 'healthy',
      last_save_failure_code: '',
      // A generated recovery link may use the secondary access hash. Preserve
      // the client's original autosave key instead of rotating it on resume.
      draft_access_key_hash: existing?.draft_access_key_hash || accessKeyHash,
      last_saved_at: draft.last_saved_at || new Date().toISOString(),
      retention_policy: 'indefinite_until_manual_deletion',
      retention_policy_version: '2026-08-18',
      retention_protected_at: existing?.retention_protected_at || new Date().toISOString(),
    };
    const versionType = nextDraft.status === 'submitted'
      ? 'submitted_snapshot'
      : String(nextDraft.status || '') === 'submit_failed'
        ? 'failed_submission_checkpoint'
        : ['submitting', 'submit_attempted'].includes(String(nextDraft.status || ''))
          ? 'submission_checkpoint'
        : 'autosave';
    const mutationId = sanitizeMutationString(body.mutationId)
      || sanitizeMutationString((body.draft as Record<string, unknown>)?.mutation_id)
      || `client-revision:${incomingRevision}`;
    const result = await applyDurableDraftMutation({
      base44,
      draftId: String(existing.id),
      nextValues: nextDraft,
      metadata: {
        mutationId,
        clientInstanceId: sanitizeMutationString(body.clientInstanceId || (body.draft as Record<string, unknown>)?.client_instance_id, 300),
        clientSequence: sanitizeRevision(body.clientSequence || (body.draft as Record<string, unknown>)?.client_sequence || incomingRevision),
        baseRevision: sanitizeRevision(body.baseRevision ?? (body.draft as Record<string, unknown>)?.base_revision ?? existingRevision),
        changedKeys: sanitizeMutationKeys(body.changedKeys || (() => { try { return JSON.parse(String((body.draft as Record<string, unknown>)?.changed_keys_json || '[]')); } catch { return []; } })()),
        deletedKeys: sanitizeMutationKeys(body.deletedKeys || (() => { try { return JSON.parse(String((body.draft as Record<string, unknown>)?.deleted_keys_json || '[]')); } catch { return []; } })()),
      },
      versionType,
      sourceRecordId: String(existing.id),
    });
    const saved = result.draft;

    if (!result.accepted) {
      return json({
        success: true,
        saved: false,
        stale: true,
        finalized: Boolean(result.finalized),
        draftId: existing.id,
        lastSavedAt: saved?.last_saved_at || saved?.updated_date || '',
        lastConfirmedRevision: sanitizeRevision(saved?.last_confirmed_revision),
        draft: withoutDraftAccessHashes(saved),
      });
    }

    console.info(JSON.stringify({
      functionName: 'questionnaireDraftData',
      deliveryStage: result.duplicate ? 'draft_retry_materialized' : 'draft_versioned_and_materialized',
      identifier: sessionId,
    }));

    return json({
      success: true,
      saved: true,
      stale: false,
      draftId: saved.id,
      lastSavedAt: saved.last_saved_at || saved.updated_date || nextDraft.last_saved_at,
      lastConfirmedRevision: sanitizeRevision(saved.last_confirmed_revision),
      mutationId,
      versionId: result.version?.id || '',
      draft: withoutDraftAccessHashes(saved),
    });
  } catch (error) {
    console.error('Questionnaire draft request failed', error);
    return json({ success: false, error: 'The questionnaire draft request failed.' }, 500);
  }
});
