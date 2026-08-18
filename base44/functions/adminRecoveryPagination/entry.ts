import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { secrets } from 'base44:runtime';
import { authorizeRecoveryRequest, safeRecoveryLog } from '../../shared/recoveryAuthorization.ts';
import {
  buildRecoveryListQuery,
  isExactSubmissionIdSearch,
  normalizeRecoveryRequest,
  projectRecoveryListRecord,
  RECOVERY_RECORD_CONFIG,
  recordMatchesArchiveState,
} from '../../shared/recoveryPagination.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
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
  if (!authorization.authorized) return json({ success: false, error: authorization.error }, 403);

  const normalized = normalizeRecoveryRequest(body);
  if (!normalized.ok) return json({ success: false, error: normalized.error }, 400);
  const request = normalized.value;
  const config = RECOVERY_RECORD_CONFIG[request.recordType];
  const entity = request.recordType === 'draft'
    ? base44.asServiceRole.entities.FormDraft
    : request.recordType === 'intake'
      ? base44.asServiceRole.entities.FormSubmissionIntake
      : base44.asServiceRole.entities.FormSubmission;

  safeRecoveryLog({
    functionName: 'adminRecoveryPagination',
    authorizationMode: authorization.mode,
    identifier: request.action === 'get' ? request.recordId : request.recordType,
    deliveryStage: request.action,
  });

  try {
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

      if (request.recordType === 'draft') {
        let linkedSubmission: Record<string, unknown> | null = null;
        if (record.final_submission_id) {
          try {
            linkedSubmission = await base44.asServiceRole.entities.FormSubmission.get(String(record.final_submission_id));
          } catch {
            linkedSubmission = null;
          }
        }
        if (!linkedSubmission && record.session_id) {
          const matches = await base44.asServiceRole.entities.FormSubmission.filter(
            { questionnaire_session_id: record.session_id },
            '-created_date',
            1,
          );
          linkedSubmission = matches?.[0] || null;
        }
        record = { ...record, linked_submission: linkedSubmission };
      }
      return json({ success: true, record });
    }

    if (isExactSubmissionIdSearch(request)) {
      let exactRecord: Record<string, unknown> | null = null;
      try {
        exactRecord = await entity.get(request.search);
      } catch {
        exactRecord = null;
      }

      if (exactRecord) {
        const statusMatches = request.status === 'all'
          || exactRecord[config.statusField] === request.status;
        const records = statusMatches && recordMatchesArchiveState(exactRecord, request.archiveState)
          ? [projectRecoveryListRecord(exactRecord, config.listFields)]
          : [];
        return json({
          success: true,
          records,
          page: request.page,
          pageSize: request.pageSize,
          hasMore: false,
          hasAnyRecords: true,
        });
      }
    }

    const skip = (request.page - 1) * request.pageSize;
    const pageRecords = await entity.filter(
      buildRecoveryListQuery(request),
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
  } catch (error) {
    console.error('Admin recovery pagination request failed', error);
    return json({ success: false, error: 'The recovery pagination request failed.' }, 500);
  }
});
