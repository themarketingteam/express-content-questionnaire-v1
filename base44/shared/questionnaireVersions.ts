const SNAPSHOT_FIELDS = [
  'business_name', 'domain', 'user_id', 'user_name', 'user_email',
  'normalized_user_id', 'normalized_user_email', 'normalized_business_name',
  'normalized_domain', 'status',
  'current_question_id', 'last_changed_question_id', 'responses_json',
  'validation_status_json', 'touched_questions_json', 'expanded_questions_json',
  'metadata_json', 'userdata_json', 'mapped_payload_json', 'payload_edited_at',
  'draft_metadata_json', 'save_error', 'submit_error', 'submit_attempted_at',
  'submitted_at', 'last_changed_at', 'last_saved_at', 'last_non_empty_answers_json',
  'field_history_json', 'last_local_persisted_at', 'client_revision',
  'last_confirmed_revision', 'bootstrap_confirmed_at', 'bootstrap_attempt_count',
  'persistence_health_status', 'last_persistence_telemetry_at', 'storage_available',
  'url_credential_persisted', 'last_save_failure_code', 'final_submission_id',
  'ai_repair_status', 'ai_repair_attempt_count', 'last_ai_repair_at',
  'ai_repair_error_json', 'ai_repair_report_json', 'ai_repaired_payload_json',
  'ai_repair_applied', 'ai_repair_source', 'identity_latest_attempt_id',
  'identity_recovery_status', 'identity_input_fingerprint', 'identity_recovery_version',
  'last_identity_recovery_at', 'identity_recovery_attempt_count',
  'identity_business_name_candidate', 'identity_business_name_confidence',
  'identity_domain_candidate', 'identity_domain_confidence', 'identity_evidence_json',
  'submit_attempt_id', 'archived', 'archived_at', 'active_investigation', 'legal_hold',
  'retention_hold', 'retention_policy', 'retention_policy_version',
  'retention_protected_at', 'recovery_copy_source_draft_id',
  'recovery_copy_source_version_id', 'recovery_copy_created_at',
] as const;

const QUESTION_FIELDS = [
  ['itCompanyType', 'itCompanyTypeOther'],
  ['serviceOfferings', 'serviceOfferingsOther'],
  ['differentiation'],
  ['geographicAreas', 'geographicAreaMeta'],
  ['pricingPackaging', 'pricingPackagingOther'],
  ['companyGoals', 'companyGoalsOther'],
  ['brandTone', 'brandToneOther'],
  ['targetIndustries', 'targetIndustriesOther'],
  ['clientSize'],
  ['clientChallenges', 'clientChallengesOther'],
  ['clientOutcomes', 'clientOutcomesOther'],
  ['idealClient'],
] as const;

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function populated(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(populated);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(populated);
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined && value !== false;
}

export function questionnaireMetrics(snapshot: Record<string, unknown>): { answerCount: number; progressPercent: number } {
  const responses = parseObject(snapshot.responses_json);
  const answerCount = Object.values(responses).filter(populated).length;
  const completeQuestions = QUESTION_FIELDS.filter((fields) => fields.some((field) => populated(responses[field]))).length;
  return {
    answerCount,
    progressPercent: Math.round((completeQuestions / QUESTION_FIELDS.length) * 100),
  };
}

export function normalizeIdentityValue(value: unknown, kind: 'text' | 'email' | 'domain' = 'text'): string {
  let normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (kind === 'domain') {
    normalized = normalized.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').split('/')[0];
  }
  if (kind === 'email') normalized = normalized.replace(/\s+/g, '');
  return normalized.replace(/\s+/g, kind === 'text' ? ' ' : '');
}

export function snapshotFromDraft(draft: Record<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    id: String(draft.id || ''),
    session_id: String(draft.session_id || ''),
  };
  for (const field of SNAPSHOT_FIELDS) {
    if (draft[field] !== undefined) snapshot[field] = draft[field];
  }
  return snapshot;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function meaningfulReasons({
  previous,
  next,
  versionType,
}: {
  previous?: Record<string, unknown> | null;
  next: Record<string, unknown>;
  versionType: string;
}): string[] {
  const reasons = new Set<string>();
  const previousMetrics = previous ? questionnaireMetrics(previous) : { answerCount: 0, progressPercent: 0 };
  const nextMetrics = questionnaireMetrics(next);
  if (!previous) reasons.add('first_retained_revision');
  if (nextMetrics.answerCount > previousMetrics.answerCount) reasons.add('answer_count_high_water');
  if (nextMetrics.progressPercent > previousMetrics.progressPercent) reasons.add('progress_high_water');
  if (previous && (
    previousMetrics.answerCount - nextMetrics.answerCount >= 3
    || previousMetrics.progressPercent - nextMetrics.progressPercent >= 20
  )) reasons.add('before_or_after_large_reset');
  if (versionType === 'submission_checkpoint') reasons.add('submission_checkpoint');
  if (versionType === 'submitted_snapshot') reasons.add('submitted_snapshot');
  if (versionType === 'admin_edit') reasons.add('administrative_edit');
  if (versionType === 'explicit_clear') reasons.add('explicit_clear');
  if (versionType === 'recovery_copy') reasons.add('recovery_copy');
  return [...reasons];
}

export async function createQuestionnaireVersion({
  base44,
  draft,
  previous = null,
  versionType = 'autosave',
  sourceRecordId = '',
  sourceVersionId = '',
  capturedAt = '',
  versionKey = '',
}: {
  base44: any;
  draft: Record<string, unknown>;
  previous?: Record<string, unknown> | null;
  versionType?: string;
  sourceRecordId?: string;
  sourceVersionId?: string;
  capturedAt?: string;
  versionKey?: string;
}): Promise<Record<string, unknown> | null> {
  const draftId = String(draft.id || '');
  const sessionId = String(draft.session_id || '');
  if (!draftId || !sessionId) return null;
  const snapshot = snapshotFromDraft(draft);
  const serialized = JSON.stringify(stableValue(snapshot));
  const snapshotHash = await sha256Hex(serialized);
  const revision = Math.max(0, Number(draft.last_confirmed_revision || draft.client_revision || 0) || 0);
  const resolvedCapturedAt = capturedAt || String(draft.last_saved_at || draft.updated_date || new Date().toISOString());
  const resolvedVersionKey = versionKey || `${draftId}:${versionType}:${revision}:${snapshotHash}`;
  const existing = await base44.asServiceRole.entities.QuestionnaireVersion.filter(
    { version_key: resolvedVersionKey },
    '-created_date',
    1,
    0,
    ['id'],
  );
  if (existing?.[0]) return existing[0];
  const metrics = questionnaireMetrics(snapshot);
  const reasons = meaningfulReasons({ previous, next: snapshot, versionType });
  return await base44.asServiceRole.entities.QuestionnaireVersion.create({
    draft_id: draftId,
    session_id: sessionId,
    version_key: resolvedVersionKey,
    version_type: versionType,
    status: String(draft.status || 'draft'),
    snapshot_json: serialized,
    snapshot_hash: snapshotHash,
    answer_count: metrics.answerCount,
    progress_percent: metrics.progressPercent,
    client_revision: revision,
    meaningful: reasons.length > 0,
    meaningful_reasons_json: JSON.stringify(reasons),
    captured_at: resolvedCapturedAt,
    source_record_id: sourceRecordId || draftId,
    source_version_id: sourceVersionId,
    normalized_user_id: normalizeIdentityValue(draft.user_id),
    normalized_email: normalizeIdentityValue(draft.user_email, 'email'),
    normalized_business_name: normalizeIdentityValue(draft.business_name),
    normalized_domain: normalizeIdentityValue(draft.domain, 'domain'),
    retention_policy: 'indefinite_until_manual_deletion',
    retention_policy_version: '2026-08-18',
    retention_protected_at: new Date().toISOString(),
  });
}
