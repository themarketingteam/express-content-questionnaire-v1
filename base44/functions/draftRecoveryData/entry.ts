import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { secrets } from 'base44:runtime';
import { authorizeRecoveryRequest, safeRecoveryLog } from '../../shared/recoveryAuthorization.ts';
import { sanitizePdfVersions } from '../../shared/pdfVersionPrivacy.ts';
import {
  appendDraftRecoveryAccessHash,
  withoutDraftAccessHashes,
} from '../../shared/draftAccess.ts';
import {
  buildRecoveryListQuery,
  normalizeRecoveryRequest,
  RECOVERY_RECORD_CONFIG,
  recordMatchesArchiveState,
} from '../../shared/recoveryPagination.ts';
import {
  createQuestionnaireVersion,
  normalizeIdentityValue,
  questionnaireMetrics,
  snapshotFromDraft,
} from '../../shared/questionnaireVersions.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

const updateLimits: Record<string, number> = {
  business_name: 500,
  domain: 500,
  mapped_payload_json: 2_000_000,
};

const PDF_VERSION_LIST_LIMIT = 100;
const VERSION_PAGE_SIZE = 250;
const VERSION_CATALOG_CEILING = 5_000;
const RELATED_SESSION_CEILING = 100;
const WORKING_SESSION_GAP_MS = 30 * 60 * 1_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{20,160}$/;
const encoder = new TextEncoder();

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hashAccessKey(accessKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(accessKey));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

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

function uniqueRecords(records: Array<Record<string, any>>): Array<Record<string, any>> {
  const unique = new Map<string, Record<string, any>>();
  for (const record of records) if (record?.id) unique.set(String(record.id), record);
  return [...unique.values()];
}

function strongIdentityMatch(root: Record<string, any>, candidate: Record<string, any>): boolean {
  if (String(root.id || '') === String(candidate.id || '')) return true;
  if (root.session_id && String(root.session_id) === String(candidate.session_id || '')) return true;
  const rootUserId = normalizeIdentityValue(root.user_id);
  const candidateUserId = normalizeIdentityValue(candidate.user_id);
  if (rootUserId && rootUserId === candidateUserId) return true;
  const rootEmail = normalizeIdentityValue(root.user_email, 'email');
  const candidateEmail = normalizeIdentityValue(candidate.user_email, 'email');
  if (rootEmail && rootEmail === candidateEmail) return true;
  const rootDomain = normalizeIdentityValue(root.domain, 'domain');
  const candidateDomain = normalizeIdentityValue(candidate.domain, 'domain');
  const rootBusiness = normalizeIdentityValue(root.business_name);
  const candidateBusiness = normalizeIdentityValue(candidate.business_name);
  return Boolean(rootDomain && rootBusiness && rootDomain === candidateDomain && rootBusiness === candidateBusiness);
}

async function paginatedFilter(
  entity: any,
  query: Record<string, unknown>,
  sort: string,
  fields: string[] | undefined,
  ceiling: number,
): Promise<{ records: Array<Record<string, any>>; truncated: boolean }> {
  const records: Array<Record<string, any>> = [];
  for (let skip = 0; skip < ceiling; skip += VERSION_PAGE_SIZE) {
    const limit = Math.min(VERSION_PAGE_SIZE, ceiling - skip);
    const page = await entity.filter(query, sort, limit, skip, fields);
    records.push(...(page || []));
    if (!page || page.length < limit) return { records, truncated: false };
  }
  return { records, truncated: true };
}

async function relatedDrafts(base44: any, root: Record<string, any>): Promise<{ drafts: Array<Record<string, any>>; truncated: boolean }> {
  const entity = base44.asServiceRole.entities.FormDraft;
  const groups: Array<Array<Record<string, any>>> = [[root]];
  let truncated = false;
  const fields = [
    'id', 'session_id', 'business_name', 'domain', 'user_id', 'user_name', 'user_email',
    'normalized_user_id', 'normalized_user_email', 'normalized_business_name', 'normalized_domain',
    'status', 'responses_json', 'validation_status_json', 'touched_questions_json',
    'expanded_questions_json', 'metadata_json', 'userdata_json', 'mapped_payload_json',
    'last_saved_at', 'last_changed_at', 'submitted_at', 'submit_attempted_at',
    'current_question_id', 'last_changed_question_id', 'final_submission_id',
    'client_revision', 'last_confirmed_revision', 'created_date', 'updated_date',
  ];
  const queries: Array<Record<string, unknown>> = [];
  if (root.session_id) queries.push({ session_id: root.session_id });
  if (root.user_id) queries.push({ user_id: root.user_id });
  if (root.user_email) queries.push({ user_email: root.user_email });
  if (root.domain && root.business_name) queries.push({ domain: root.domain, business_name: root.business_name });
  const normalizedUserId = normalizeIdentityValue(root.normalized_user_id || root.user_id);
  const normalizedEmail = normalizeIdentityValue(root.normalized_user_email || root.user_email, 'email');
  const normalizedBusiness = normalizeIdentityValue(root.normalized_business_name || root.business_name);
  const normalizedDomain = normalizeIdentityValue(root.normalized_domain || root.domain, 'domain');
  if (normalizedUserId) queries.push({ normalized_user_id: normalizedUserId });
  if (normalizedEmail) queries.push({ normalized_user_email: normalizedEmail });
  if (normalizedBusiness && normalizedDomain) queries.push({
    normalized_business_name: normalizedBusiness,
    normalized_domain: normalizedDomain,
  });
  for (const query of queries) {
    const result = await paginatedFilter(entity, query, '-last_saved_at', fields, RELATED_SESSION_CEILING);
    groups.push(result.records);
    truncated ||= result.truncated;
  }
  return {
    drafts: uniqueRecords(groups.flat()).filter((candidate) => strongIdentityMatch(root, candidate)),
    truncated,
  };
}

function versionLabel(type: string): string {
  const labels: Record<string, string> = {
    current_draft: 'Current draft',
    autosave: 'Saved draft',
    submission_checkpoint: 'Submission checkpoint',
    submitted_snapshot: 'Submitted draft',
    final_submission: 'Final submission',
    intake_snapshot: 'Submission checkpoint',
    admin_edit: 'Administrative edit',
    explicit_clear: 'Explicit clear',
    recovery_copy: 'Recovery copy',
  };
  return labels[type] || type.replace(/_/g, ' ');
}

function versionSummary({
  id,
  draftId,
  sessionId,
  type,
  status,
  capturedAt,
  answerCount,
  progressPercent,
  meaningful,
  reasons = [],
  readOnly = true,
  rawAvailable = true,
}: Record<string, any>): Record<string, unknown> {
  return {
    id,
    draftId,
    sessionId,
    type,
    label: versionLabel(type),
    status: status || 'draft',
    capturedAt,
    answerCount: Number(answerCount || 0),
    progressPercent: Math.max(0, Math.min(100, Number(progressPercent || 0))),
    meaningful: Boolean(meaningful),
    meaningfulReasons: reasons,
    readOnly: Boolean(readOnly),
    rawAvailable: Boolean(rawAvailable),
  };
}

function submissionAsDraft(submission: Record<string, any>, owningDraft: Record<string, any>): Record<string, unknown> {
  const transformed = parseObject(submission.transformed_payload_json);
  const metadata = parseObject(transformed.metadata);
  const userdata = parseObject(transformed.userdata);
  const fallbackPayload = {
    metadata: {
      business_name: submission.business_name || owningDraft.business_name || '',
      businessDomain: submission.business_domain || owningDraft.domain || '',
      submission_datetime: submission.submission_datetime || submission.created_date || '',
      service_type: 'express',
      questionnaire_session_id: submission.questionnaire_session_id || owningDraft.session_id || '',
      submit_attempt_id: submission.submit_attempt_id || '',
    },
    userdata: {
      it_company_type: submission.it_company_type || [],
      it_company_type_other: submission.it_company_type_other || '',
      service_offerings: submission.service_offerings || [],
      service_offerings_other: submission.service_offerings_other || '',
      differentiation: submission.differentiation || '',
      geographic_areas: submission.geographic_areas || '',
      geographic_area_meta: submission.geographic_area_meta || {},
      pricing_packaging: submission.pricing_packaging || '',
      pricing_packaging_other: submission.pricing_packaging_other || '',
      company_goals: submission.company_goals || [],
      company_goals_other: submission.company_goals_other || '',
      brand_tone: submission.brand_tone || '',
      brand_tone_other: submission.brand_tone_other || '',
      target_industries: submission.target_industries || [],
      target_industries_other: submission.target_industries_other || '',
      client_size: submission.client_size || '',
      client_challenges: submission.client_challenges || [],
      client_challenges_other: submission.client_challenges_other || '',
      client_outcomes: submission.client_outcomes || [],
      client_outcomes_other: submission.client_outcomes_other || '',
      ideal_client: submission.ideal_client || '',
    },
  };
  const payload = Object.keys(metadata).length && Object.keys(userdata).length ? transformed : fallbackPayload;
  return {
    id: owningDraft.id,
    session_id: submission.questionnaire_session_id || owningDraft.session_id || '',
    business_name: submission.business_name || owningDraft.business_name || '',
    domain: submission.business_domain || owningDraft.domain || '',
    user_email: submission.user_email || owningDraft.user_email || '',
    user_id: owningDraft.user_id || '',
    user_name: owningDraft.user_name || '',
    status: 'submitted',
    responses_json: submission.raw_responses_json || '{}',
    validation_status_json: '{}',
    touched_questions_json: '{}',
    expanded_questions_json: '{}',
    metadata_json: JSON.stringify(payload.metadata || {}),
    userdata_json: JSON.stringify(payload.userdata || {}),
    mapped_payload_json: JSON.stringify(payload),
    final_submission_id: submission.id,
    submit_attempt_id: submission.submit_attempt_id || '',
    submitted_at: submission.submission_datetime || submission.created_date || '',
    last_saved_at: submission.submission_datetime || submission.created_date || '',
    last_changed_at: submission.submission_datetime || submission.created_date || '',
    created_date: submission.created_date || '',
    updated_date: submission.updated_date || '',
  };
}

function intakeAsDraft(intake: Record<string, any>, owningDraft: Record<string, any>): Record<string, unknown> {
  const payload = parseObject(intake.transformed_payload_json);
  return {
    id: owningDraft.id,
    session_id: intake.questionnaire_session_id || owningDraft.session_id || '',
    business_name: intake.business_name || owningDraft.business_name || '',
    domain: intake.business_domain || owningDraft.domain || '',
    user_email: intake.user_email || owningDraft.user_email || '',
    user_id: intake.user_id || owningDraft.user_id || '',
    user_name: owningDraft.user_name || '',
    status: intake.status || 'submit_attempted',
    responses_json: intake.raw_responses_json || '{}',
    validation_status_json: '{}',
    touched_questions_json: '{}',
    expanded_questions_json: '{}',
    metadata_json: JSON.stringify(parseObject(payload.metadata)),
    userdata_json: JSON.stringify(parseObject(payload.userdata)),
    mapped_payload_json: intake.transformed_payload_json || '{}',
    final_submission_id: intake.linked_submission_id || '',
    submit_attempt_id: intake.submit_attempt_id || '',
    submit_attempted_at: intake.created_at_server || intake.created_date || '',
    last_saved_at: intake.created_at_server || intake.created_date || '',
    last_changed_at: intake.created_at_server || intake.created_date || '',
  };
}

async function linkedRecords(base44: any, drafts: Array<Record<string, any>>) {
  const submissions: Array<Record<string, any>> = [];
  const intakes: Array<Record<string, any>> = [];
  const draftIds = drafts.map((draft) => String(draft.id || '')).filter(Boolean);
  const sessionIds = drafts.map((draft) => String(draft.session_id || '')).filter(Boolean);
  const finalSubmissionIds = drafts.map((draft) => String(draft.final_submission_id || '')).filter(Boolean);
  submissions.push(...(await Promise.all(finalSubmissionIds.map((id) => (
    base44.asServiceRole.entities.FormSubmission.get(id).catch(() => null)
  )))).filter(Boolean));
  if (draftIds.length) {
    submissions.push(...(await paginatedFilter(
      base44.asServiceRole.entities.FormSubmission,
      { linked_draft_id: { $in: draftIds } },
      '-created_date',
      undefined,
      VERSION_CATALOG_CEILING,
    )).records);
  }
  if (sessionIds.length) {
    submissions.push(...(await paginatedFilter(
      base44.asServiceRole.entities.FormSubmission,
      { questionnaire_session_id: { $in: sessionIds } },
      '-created_date',
      undefined,
      VERSION_CATALOG_CEILING,
    )).records);
    intakes.push(...(await paginatedFilter(
      base44.asServiceRole.entities.FormSubmissionIntake,
      { questionnaire_session_id: { $in: sessionIds } },
      '-created_date',
      undefined,
      VERSION_CATALOG_CEILING,
    )).records);
  }
  return { submissions: uniqueRecords(submissions), intakes: uniqueRecords(intakes) };
}

async function buildVersionCatalog(base44: any, rootDraft: Record<string, any>, mode: string) {
  const related = await relatedDrafts(base44, rootDraft);
  const draftById = new Map(related.drafts.map((draft) => [String(draft.id), draft]));
  const sessionDraft = new Map(related.drafts.map((draft) => [String(draft.session_id || ''), draft]));
  const summaries: Array<Record<string, any>> = [];
  let truncated = related.truncated;

  for (const draft of related.drafts) {
    const metrics = questionnaireMetrics(draft);
    summaries.push(versionSummary({
      id: `current:${draft.id}`,
      draftId: draft.id,
      sessionId: draft.session_id,
      type: 'current_draft',
      status: draft.status,
      capturedAt: draft.last_saved_at || draft.updated_date || draft.created_date,
      answerCount: metrics.answerCount,
      progressPercent: metrics.progressPercent,
      meaningful: true,
      reasons: ['current_materialized_draft'],
      readOnly: String(draft.id) !== String(rootDraft.id),
    }));

  }

  const draftIds = related.drafts.map((draft) => String(draft.id));
  if (draftIds.length) {
    const result = await paginatedFilter(
      base44.asServiceRole.entities.QuestionnaireVersion,
      { draft_id: { $in: draftIds } },
      '-captured_at',
      [
        'id', 'draft_id', 'session_id', 'version_type', 'status', 'answer_count',
        'progress_percent', 'meaningful', 'meaningful_reasons_json', 'captured_at',
      ],
      Math.max(0, VERSION_CATALOG_CEILING - summaries.length),
    );
    truncated ||= result.truncated;
    for (const version of result.records) {
      let reasons: string[] = [];
      try { reasons = JSON.parse(version.meaningful_reasons_json || '[]'); } catch { reasons = []; }
      summaries.push(versionSummary({
        id: `snapshot:${version.id}`,
        draftId: version.draft_id,
        sessionId: version.session_id,
        type: version.version_type,
        status: version.status,
        capturedAt: version.captured_at || version.created_date,
        answerCount: version.answer_count,
        progressPercent: version.progress_percent,
        meaningful: version.meaningful,
        reasons,
        readOnly: true,
      }));
    }
  }

  const linked = await linkedRecords(base44, related.drafts);
  for (const submission of linked.submissions) {
    const draft = draftById.get(String(submission.linked_draft_id || ''))
      || sessionDraft.get(String(submission.questionnaire_session_id || ''));
    if (!draft) continue;
    const snapshot = submissionAsDraft(submission, draft);
    const metrics = questionnaireMetrics(snapshot);
    summaries.push(versionSummary({
      id: `submission:${submission.id}`,
      draftId: draft.id,
      sessionId: submission.questionnaire_session_id || draft.session_id,
      type: 'final_submission',
      status: 'submitted',
      capturedAt: submission.submission_datetime || submission.created_date,
      answerCount: metrics.answerCount,
      progressPercent: 100,
      meaningful: true,
      reasons: ['linked_final_submission'],
      readOnly: true,
      rawAvailable: Object.keys(parseObject(submission.raw_responses_json)).length > 0,
    }));
  }
  for (const intake of linked.intakes) {
    const draft = sessionDraft.get(String(intake.questionnaire_session_id || ''));
    if (!draft) continue;
    const snapshot = intakeAsDraft(intake, draft);
    const metrics = questionnaireMetrics(snapshot);
    summaries.push(versionSummary({
      id: `intake:${intake.id}`,
      draftId: draft.id,
      sessionId: intake.questionnaire_session_id || draft.session_id,
      type: 'intake_snapshot',
      status: intake.status,
      capturedAt: intake.created_at_server || intake.created_date,
      answerCount: metrics.answerCount,
      progressPercent: metrics.progressPercent,
      meaningful: true,
      reasons: ['submission_barrier_intake'],
      readOnly: true,
      rawAvailable: Object.keys(parseObject(intake.raw_responses_json)).length > 0,
    }));
  }

  const unique = new Map<string, Record<string, any>>();
  for (const summary of summaries) unique.set(String(summary.id), summary);
  const all = [...unique.values()].sort((left, right) => (
    (Date.parse(String(right.capturedAt || '')) || 0) - (Date.parse(String(left.capturedAt || '')) || 0)
  ));
  const bySession = new Map<string, Array<Record<string, any>>>();
  for (const summary of all) {
    const sessionId = String(summary.sessionId || '');
    bySession.set(sessionId, [...(bySession.get(sessionId) || []), summary]);
  }
  for (const sessionVersions of bySession.values()) {
    const ascending = [...sessionVersions].sort((left, right) => (
      (Date.parse(String(left.capturedAt || '')) || 0) - (Date.parse(String(right.capturedAt || '')) || 0)
    ));
    ascending.forEach((summary, index) => {
      if (index === 0) summary.meaningful = true;
      if (index === ascending.length - 1) summary.meaningful = true;
      const nextTime = Date.parse(String(ascending[index + 1]?.capturedAt || '')) || 0;
      const currentTime = Date.parse(String(summary.capturedAt || '')) || 0;
      if (nextTime && currentTime && nextTime - currentTime >= WORKING_SESSION_GAP_MS) {
        summary.meaningful = true;
        summary.meaningfulReasons = [...new Set([...(summary.meaningfulReasons || []), 'working_session_end'])];
      }
    });
  }

  const submitted = all.filter((version) => version.type === 'submitted_snapshot');
  const finalSubmissions = all.filter((version) => version.type === 'final_submission');
  const rank = (version: Record<string, any>) => (
    (version.type === 'submitted_snapshot' ? 1_000_000 : 0)
    + (version.type === 'final_submission' ? 900_000 : 0)
    + (version.status === 'submitted' ? 800_000 : 0)
    + Number(version.progressPercent || 0) * 1_000
    + Number(version.answerCount || 0) * 10
    + Math.floor((Date.parse(String(version.capturedAt || '')) || 0) / 1_000_000_000)
  );
  const preferredPool = submitted.length ? submitted : finalSubmissions.length ? finalSubmissions : all;
  const defaultVersion = [...preferredPool].sort((left, right) => rank(right) - rank(left))[0] || null;
  const visible = mode === 'all' ? all : all.filter((version) => version.meaningful);
  return {
    versions: visible,
    defaultVersionId: defaultVersion?.id || `current:${rootDraft.id}`,
    totalVersions: all.length,
    keyVersionCount: all.filter((version) => version.meaningful).length,
    sessionCount: new Set(all.map((version) => version.sessionId).filter(Boolean)).size,
    truncated,
    relatedDraftIds: new Set(related.drafts.map((draft) => String(draft.id))),
    relatedDrafts: related.drafts,
    linked,
  };
}

async function resolveVersion(base44: any, rootDraft: Record<string, any>, versionId: string) {
  const catalog = await buildVersionCatalog(base44, rootDraft, 'all');
  const summary = catalog.versions.find((version: Record<string, any>) => version.id === versionId);
  if (!summary) return null;
  const owningDraft = catalog.relatedDrafts.find((draft: Record<string, any>) => String(draft.id) === String(summary.draftId));
  if (!owningDraft) return null;
  let draft: Record<string, unknown> | null = null;
  let submission: Record<string, unknown> | null = null;
  if (versionId.startsWith('current:')) {
    draft = withoutDraftAccessHashes(await base44.asServiceRole.entities.FormDraft.get(String(summary.draftId)));
  } else if (versionId.startsWith('snapshot:')) {
    const entityId = versionId.slice('snapshot:'.length);
    const version = await base44.asServiceRole.entities.QuestionnaireVersion.get(entityId).catch(() => null);
    if (!version || !catalog.relatedDraftIds.has(String(version.draft_id))) return null;
    draft = parseObject(version.snapshot_json);
    draft.id = version.draft_id;
  } else if (versionId.startsWith('submission:')) {
    const entityId = versionId.slice('submission:'.length);
    const record = catalog.linked.submissions.find((candidate: Record<string, any>) => String(candidate.id) === entityId);
    if (!record) return null;
    submission = record;
    draft = submissionAsDraft(record, owningDraft);
  } else if (versionId.startsWith('intake:')) {
    const entityId = versionId.slice('intake:'.length);
    const record = catalog.linked.intakes.find((candidate: Record<string, any>) => String(candidate.id) === entityId);
    if (!record) return null;
    draft = intakeAsDraft(record, owningDraft);
  }
  return draft ? { summary, draft, submission } : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'Invalid request' }, 400);
  }

  const base44 = createClientFromRequest(req);

  let recoverySecret = '';
  try {
    recoverySecret = secrets.get('DRAFT_RECOVERY_PASSWORD') || '';
  } catch {
    return json({ success: false, error: 'Draft recovery access is not configured.' }, 503);
  }
  const authorization = await authorizeRecoveryRequest({
    base44,
    recoveryGrant: body.recoveryGrant,
    recoverySecret,
  });
  if (!authorization.authorized) {
    return json({ success: false, error: authorization.error }, 403);
  }
  const identifier = typeof body.draftId === 'string' ? body.draftId : String(body.action || '');
  safeRecoveryLog({
    functionName: 'draftRecoveryData',
    authorizationMode: authorization.mode,
    identifier,
    deliveryStage: String(body.action || 'unknown_action'),
  });

  try {
    if (body.action === 'list' || body.action === 'get') {
      const normalized = normalizeRecoveryRequest(body);
      if (!normalized.ok) return json({ success: false, error: normalized.error }, 400);

      const request = normalized.value;
      const config = RECOVERY_RECORD_CONFIG[request.recordType];
      const entity = request.recordType === 'draft'
        ? base44.asServiceRole.entities.FormDraft
        : request.recordType === 'intake'
          ? base44.asServiceRole.entities.FormSubmissionIntake
          : base44.asServiceRole.entities.FormSubmission;

      if (request.action === 'get') {
        let record: Record<string, unknown> | null = null;
        try {
          record = await entity.get(request.recordId);
        } catch {
          record = null;
        }
        if (!record || !recordMatchesArchiveState(record, request.archiveState)) {
          return json({ success: false, error: 'Record not found.' }, 404);
        }
        return json({
          success: true,
          record: request.recordType === 'draft' ? withoutDraftAccessHashes(record) : record,
        });
      }

      const skip = (request.page - 1) * request.pageSize;
      const query = buildRecoveryListQuery(request);
      const pageRecords = await entity.filter(
        query,
        '-updated_date',
        request.pageSize + 1,
        skip,
        [...config.listFields],
      );
      const sourceProbe = await entity.list('-updated_date', 1, 0, ['id']);
      const hasMore = pageRecords.length > request.pageSize;

      return json({
        success: true,
        records: hasMore ? pageRecords.slice(0, request.pageSize) : pageRecords,
        page: request.page,
        pageSize: request.pageSize,
        hasMore,
        hasAnyRecords: sourceProbe.length > 0,
      });
    }

    switch (body.action) {
      case 'list_versions':
      case 'listVersions': {
        if (!isNonEmptyString(body.recordId || body.draftId, 200)) {
          return json({ success: false, error: 'recordId is required.' }, 400);
        }
        const mode = body.mode === 'all' ? 'all' : 'meaningful';
        const rootDraft = await base44.asServiceRole.entities.FormDraft.get(String(body.recordId || body.draftId)).catch(() => null);
        if (!rootDraft) return json({ success: false, error: 'Draft not found.' }, 404);
        const catalog = await buildVersionCatalog(base44, rootDraft, mode);
        return json({
          success: true,
          mode,
          versions: catalog.versions,
          defaultVersionId: catalog.defaultVersionId,
          totalVersions: catalog.totalVersions,
          keyVersionCount: catalog.keyVersionCount,
          sessionCount: catalog.sessionCount,
          truncated: catalog.truncated,
          safetyCeiling: VERSION_CATALOG_CEILING,
        });
      }

      case 'get_version':
      case 'getVersion': {
        if (!isNonEmptyString(body.recordId || body.draftId, 200) || !isNonEmptyString(body.versionId, 300)) {
          return json({ success: false, error: 'recordId and versionId are required.' }, 400);
        }
        const rootDraft = await base44.asServiceRole.entities.FormDraft.get(String(body.recordId || body.draftId)).catch(() => null);
        if (!rootDraft) return json({ success: false, error: 'Draft not found.' }, 404);
        const resolved = await resolveVersion(base44, rootDraft, body.versionId);
        if (!resolved) return json({ success: false, error: 'Questionnaire version not found for this client.' }, 404);
        return json({
          success: true,
          version: resolved.summary,
          draft: withoutDraftAccessHashes(resolved.draft),
          submission: resolved.submission,
        });
      }

      case 'create_version_copy':
      case 'createVersionCopy': {
        if (!isNonEmptyString(body.recordId || body.draftId, 200) || !isNonEmptyString(body.versionId, 300)) {
          return json({ success: false, error: 'recordId and versionId are required.' }, 400);
        }
        const rootDraft = await base44.asServiceRole.entities.FormDraft.get(String(body.recordId || body.draftId)).catch(() => null);
        if (!rootDraft) return json({ success: false, error: 'Draft not found.' }, 404);
        let resolved = await resolveVersion(base44, rootDraft, body.versionId);
        if (!resolved) return json({ success: false, error: 'Questionnaire version not found for this client.' }, 404);

        if (resolved.summary.type === 'final_submission' && !resolved.summary.rawAvailable) {
          const catalog = await buildVersionCatalog(base44, rootDraft, 'all');
          const replacement = catalog.versions
            .filter((version: Record<string, any>) => (
              version.sessionId === resolved?.summary.sessionId
              && version.id !== resolved?.summary.id
              && version.rawAvailable !== false
              && Number(version.answerCount || 0) > 0
            ))
            .sort((left: Record<string, any>, right: Record<string, any>) => (
              Number(right.progressPercent || 0) - Number(left.progressPercent || 0)
              || Number(right.answerCount || 0) - Number(left.answerCount || 0)
              || (Date.parse(String(right.capturedAt || '')) || 0) - (Date.parse(String(left.capturedAt || '')) || 0)
            ))[0];
          if (!replacement) {
            return json({
              success: false,
              error: 'This final submission does not retain a raw questionnaire answer map, and no durable draft revision is available for an editable copy.',
            }, 409);
          }
          resolved = await resolveVersion(base44, rootDraft, String(replacement.id));
          if (!resolved) return json({ success: false, error: 'A safe recovery source could not be loaded.' }, 409);
        }

        const source = snapshotFromDraft(resolved.draft);
        const now = new Date().toISOString();
        const sessionId = crypto.randomUUID();
        const accessKey = randomBase64Url();
        const accessKeyHash = await hashAccessKey(accessKey);
        const copyValues: Record<string, unknown> = {
          ...source,
          session_id: sessionId,
          status: 'draft',
          final_submission_id: '',
          submit_attempt_id: '',
          submit_attempted_at: '',
          submitted_at: '',
          submit_error: '',
          save_error: '',
          client_revision: 0,
          last_confirmed_revision: 0,
          draft_access_key_hash: accessKeyHash,
          draft_recovery_access_key_hashes: [],
          recovery_copy_source_draft_id: String(resolved.summary.draftId || rootDraft.id),
          recovery_copy_source_version_id: String(resolved.summary.id),
          recovery_copy_created_at: now,
          normalized_user_id: normalizeIdentityValue(source.user_id),
          normalized_user_email: normalizeIdentityValue(source.user_email, 'email'),
          normalized_business_name: normalizeIdentityValue(source.business_name),
          normalized_domain: normalizeIdentityValue(source.domain, 'domain'),
          bootstrap_confirmed_at: now,
          bootstrap_attempt_count: 1,
          persistence_health_status: 'healthy',
          last_changed_at: now,
          last_saved_at: now,
          retention_policy: 'indefinite_until_manual_deletion',
          retention_policy_version: '2026-08-18',
          retention_protected_at: now,
        };
        delete copyValues.id;
        delete copyValues.created_date;
        delete copyValues.updated_date;
        delete copyValues.created_by;
        delete copyValues.updated_by;
        const copy = await base44.asServiceRole.entities.FormDraft.create(copyValues);
        await createQuestionnaireVersion({
          base44,
          draft: copy,
          previous: null,
          versionType: 'recovery_copy',
          sourceRecordId: String(resolved.summary.draftId || rootDraft.id),
          sourceVersionId: String(resolved.summary.id),
          capturedAt: now,
        });
        return json({
          success: true,
          draft: withoutDraftAccessHashes(copy),
          sessionId,
          accessKey,
          sourceVersionId: resolved.summary.id,
        });
      }

      case 'listDrafts': {
        return json({
          success: false,
          error: 'Unpaginated draft listing has been retired. Use action=list and recordType=draft.',
        }, 410);
      }

      case 'listIntakes': {
        return json({
          success: false,
          error: 'Unpaginated intake listing has been retired. Use action=list and recordType=intake.',
        }, 410);
      }

      case 'listPdfVersions': {
        if (!isNonEmptyString(body.draftId, 200)) {
          return json({ success: false, error: 'draftId is required.' }, 400);
        }
        const pdfVersions = await base44.asServiceRole.entities.SubmissionPdfVersion.filter(
          { draft_id: body.draftId },
          '-version_number',
          PDF_VERSION_LIST_LIMIT,
        );
        return json({ success: true, pdfVersions: sanitizePdfVersions(pdfVersions) });
      }

      case 'getPdfContext': {
        if (!isNonEmptyString(body.draftId, 200)) {
          return json({ success: false, error: 'draftId is required.' }, 400);
        }

        const draft = await base44.asServiceRole.entities.FormDraft.get(body.draftId);
        let submission = null;

        if (draft?.final_submission_id) {
          try {
            submission = await base44.asServiceRole.entities.FormSubmission.get(draft.final_submission_id);
          } catch {
            submission = null;
          }
        }

        if (!submission && draft?.session_id) {
          const matchingSubmissions = await base44.asServiceRole.entities.FormSubmission.filter(
            { questionnaire_session_id: draft.session_id },
            '-created_date',
            1,
          );
          submission = matchingSubmissions?.[0] || null;
        }

        const pdfVersions = await base44.asServiceRole.entities.SubmissionPdfVersion.filter(
          { draft_id: body.draftId },
          '-version_number',
          PDF_VERSION_LIST_LIMIT,
        );

        return json({
          success: true,
          draft: withoutDraftAccessHashes(draft),
          submission,
          pdfVersions: sanitizePdfVersions(pdfVersions),
        });
      }

      case 'createDraftRecoveryLink': {
        if (!isNonEmptyString(body.draftId, 200)) {
          return json({ success: false, error: 'draftId is required.' }, 400);
        }
        const draft = await base44.asServiceRole.entities.FormDraft.get(body.draftId);
        if (!draft || typeof draft.session_id !== 'string' || !SESSION_ID_PATTERN.test(draft.session_id)) {
          return json({ success: false, error: 'This draft does not have a valid recovery session.' }, 409);
        }

        const accessKey = randomBase64Url();
        const accessKeyHash = await hashAccessKey(accessKey);
        const recoveryHashes = appendDraftRecoveryAccessHash(
          draft.draft_recovery_access_key_hashes,
          accessKeyHash,
        );
        await base44.asServiceRole.entities.FormDraft.update(draft.id, {
          draft_recovery_access_key_hashes: recoveryHashes,
        });

        return json({
          success: true,
          sessionId: draft.session_id,
          accessKey,
        });
      }

      case 'createPdfVersion': {
        return json({
          success: false,
          error: 'Public PDF version creation is disabled. Use draftPdfStorage.',
        }, 410);
      }

      case 'updateDraft': {
        if (typeof body.draftId !== 'string' || !body.draftId) {
          return json({ success: false, error: 'draftId is required.' }, 400);
        }
        if (!body.updates || typeof body.updates !== 'object' || Array.isArray(body.updates)) {
          return json({ success: false, error: 'updates are required.' }, 400);
        }

        const submittedUpdates = body.updates as Record<string, unknown>;
        const updates: Record<string, string> = {};
        for (const [field, maxLength] of Object.entries(updateLimits)) {
          if (!(field in submittedUpdates)) continue;
          const value = submittedUpdates[field];
          if (typeof value !== 'string' || value.length > maxLength) {
            return json({ success: false, error: `${field} is invalid.` }, 400);
          }
          updates[field] = value;
        }
        if (Object.keys(updates).length === 0) {
          return json({ success: false, error: 'No supported fields were provided.' }, 400);
        }
        if (updates.mapped_payload_json) {
          try {
            const parsedPayload = JSON.parse(updates.mapped_payload_json);
            if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
              return json({ success: false, error: 'mapped_payload_json must contain a JSON object.' }, 400);
            }
          } catch {
            return json({ success: false, error: 'mapped_payload_json must contain valid JSON.' }, 400);
          }
          updates.payload_edited_at = new Date().toISOString();
        }
        const previousDraft = await base44.asServiceRole.entities.FormDraft.get(body.draftId);
        if ('business_name' in updates) {
          updates.normalized_business_name = normalizeIdentityValue(updates.business_name);
        }
        if ('domain' in updates) {
          updates.normalized_domain = normalizeIdentityValue(updates.domain, 'domain');
        }

        await createQuestionnaireVersion({
          base44,
          draft: previousDraft,
          previous: previousDraft,
          versionType: 'autosave',
          sourceRecordId: String(previousDraft.id),
          capturedAt: String(previousDraft.last_saved_at || previousDraft.updated_date || new Date().toISOString()),
          versionKey: `${previousDraft.id}:materialized-before-admin-edit:${previousDraft.last_confirmed_revision || 0}:${previousDraft.updated_date || ''}`,
        });

        const draft = await base44.asServiceRole.entities.FormDraft.update(body.draftId, updates);
        await createQuestionnaireVersion({
          base44,
          draft,
          previous: previousDraft,
          versionType: 'admin_edit',
          sourceRecordId: String(draft.id),
          capturedAt: String(draft.payload_edited_at || new Date().toISOString()),
        });
        return json({ success: true, draft: withoutDraftAccessHashes(draft) });
      }

      default:
        return json({ success: false, error: 'Unsupported action.' }, 400);
    }
  } catch (error) {
    console.error('Draft recovery data request failed', error);
    return json({ success: false, error: 'The draft recovery request failed.' }, 500);
  }
});
