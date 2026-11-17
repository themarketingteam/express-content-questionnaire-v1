import { withEntityLease } from './entityLease.ts';
import { applyDurableDraftMutation } from './durableDraftMutation.ts';
import { draftAllowsAccess } from './draftAccess.ts';

const COPY_FIELDS = [
  'business_name', 'domain', 'user_id', 'user_name', 'user_email',
  'normalized_user_id', 'normalized_user_email', 'normalized_business_name', 'normalized_domain',
  'responses_json', 'validation_status_json', 'touched_questions_json', 'expanded_questions_json',
  'last_non_empty_answers_json', 'field_history_json',
] as const;

function parseMap(value: unknown): Record<string, any> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* Fail closed before creating a revision. */ }
  throw Object.assign(new Error('The completed answers could not be read. Keep your recovery copy and contact support.'), { code: 'DRAFT_SNAPSHOT_INVALID', status: 409 });
}

/** The completed source remains immutable. A stable request resumes the same copy after a lost response. */
export async function startQuestionnaireRevision({ base44, sourceDraftId, sourceAccessHash, targetSessionId, targetAccessHash, requestHash, clientDraft }: {
  base44: any; sourceDraftId: string; sourceAccessHash: string;
  targetSessionId: string; targetAccessHash: string; requestHash: string;
  clientDraft?: Record<string, string> | null;
}): Promise<Record<string, any>> {
  const entity = base44.asServiceRole.entities.FormDraft;
  return await withEntityLease({ entity, entityId: sourceDraftId, purpose: `start-revision:${requestHash}`, leaseDurationMs: 30_000, waitTimeoutMs: 20_000 }, async (sourceLease) => {
    const source = await entity.get(sourceDraftId);
    if (!draftAllowsAccess(source, sourceAccessHash)) throw Object.assign(new Error('Draft access was denied.'), { code: 'DRAFT_ACCESS_DENIED', status: 403 });
    if (source.status !== 'submitted' && !source.final_submission_id) throw Object.assign(new Error('Only a completed questionnaire can start a new revision.'), { code: 'DRAFT_NOT_COMPLETED', status: 409 });
    parseMap(source.responses_json);
    const matches = await entity.filter({ revision_request_id_hash: requestHash }, '-created_date', 2);
    if (matches.length > 1) throw Object.assign(new Error('This revision request requires recovery review.'), { code: 'AMBIGUOUS_DRAFT_SESSION', status: 409 });
    let target = matches[0];
    if (target && (target.session_id !== targetSessionId || target.revision_source_draft_id !== sourceDraftId || !draftAllowsAccess(target, targetAccessHash))) throw Object.assign(new Error('Revision access was denied.'), { code: 'DRAFT_ACCESS_DENIED', status: 403 });
    const now = new Date().toISOString();
    // Receipt/attempt/delivery state belongs to the completed source, never its editable copy.
    const values: Record<string, unknown> = Object.fromEntries(COPY_FIELDS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
    for (const field of ['responses_json', 'validation_status_json', 'touched_questions_json', 'expanded_questions_json', 'last_non_empty_answers_json', 'field_history_json']) {
      if (clientDraft && Object.hasOwn(clientDraft, field)) values[field] = clientDraft[field];
    }
    const incomingPayload = parseMap(clientDraft?.mapped_payload_json || source.mapped_payload_json || '{}');
    const metadata = { ...(incomingPayload.metadata || {}), questionnaire_session_id: targetSessionId };
    delete metadata.submit_attempt_id;
    const mapped = { metadata, userdata: incomingPayload.userdata || {} };
    Object.assign(values, { session_id: targetSessionId, status: 'draft', submitted_at: '', submit_attempted_at: '', submit_attempt_id: '', final_submission_id: '', submit_error: '', save_error: '', metadata_json: JSON.stringify(metadata), userdata_json: JSON.stringify(mapped.userdata), mapped_payload_json: JSON.stringify(mapped), last_changed_at: now, last_saved_at: now });
    if (!target) {
      const collision = await entity.filter({ session_id: targetSessionId }, '-created_date', 1);
      if (collision.length) throw Object.assign(new Error('The new revision session is already in use.'), { code: 'REVISION_SESSION_CONFLICT', status: 409 });
      await sourceLease.assertOwned();
      target = await entity.create({
        ...Object.fromEntries(COPY_FIELDS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])),
        session_id: targetSessionId, status: 'draft', final_submission_id: '', submitted_at: '', submit_attempt_id: '',
        metadata_json: '{}', userdata_json: '{}', mapped_payload_json: source.mapped_payload_json || '{}',
        draft_access_key_hash: targetAccessHash, client_revision: 0, last_confirmed_revision: 0,
        draft_origin: 'completed_revision', bootstrap_confirmed_at: now, last_changed_at: now, last_saved_at: now,
        revision_source_draft_id: sourceDraftId, revision_source_submission_id: String(source.final_submission_id || ''),
        revision_request_id_hash: requestHash, revision_created_at: now,
        retention_policy: 'indefinite_until_manual_deletion', retention_policy_version: '2026-08-18', retention_protected_at: now,
      });
      // Entity creation responses may echo fields that the deployed schema did
      // not retain. Read the row before promising a retryable revision identity.
      const storedTarget = target?.id ? await entity.get(String(target.id)) : null;
      if (!storedTarget || storedTarget.id !== target.id || storedTarget.session_id !== targetSessionId
        || storedTarget.revision_source_draft_id !== sourceDraftId || storedTarget.revision_request_id_hash !== requestHash
        || String(storedTarget.revision_source_submission_id || '') !== String(source.final_submission_id || '')
        || storedTarget.revision_created_at !== now || !draftAllowsAccess(storedTarget, targetAccessHash)
        || storedTarget.responses_json !== source.responses_json) {
        throw Object.assign(new Error('The new revision identity and source copy could not be verified. Your completed answers are unchanged. Keep your recovery copy and retry after the service is restored.'), { code: 'REVISION_NOT_CONFIRMED', status: 409 });
      }
      target = storedTarget;
    }
    const result = await applyDurableDraftMutation({ base44, draftId: String(target.id), nextValues: values,
      metadata: { mutationId: `start-revision:${requestHash}`, clientInstanceId: `revision:${requestHash}`, clientSequence: 1, baseRevision: 0 },
      versionType: 'autosave', sourceRecordId: sourceDraftId, additionalMeaningfulReasons: ['explicit_completed_revision'],
      assertCurrent: (current) => { if (!draftAllowsAccess(current, targetAccessHash)) throw Object.assign(new Error('Revision access was denied.'), { code: 'DRAFT_ACCESS_DENIED', status: 403 }); },
    });
    if ((!result.accepted && !result.version) || Number(result.draft?.last_confirmed_revision || 0) < 1) throw Object.assign(new Error('The new revision has not been durably confirmed. Retry this same request.'), { code: 'REVISION_NOT_CONFIRMED', status: 409 });
    return result;
  });
}
