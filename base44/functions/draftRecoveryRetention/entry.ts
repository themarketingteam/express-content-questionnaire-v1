import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { secrets } from 'base44:runtime';
import { authorizeRecoveryRequest, safeRecoveryLog } from '../../shared/recoveryAuthorization.ts';
import {
  buildRetentionQuery,
  normalizeRetentionRequest,
} from '../../shared/recoveryRetention.ts';

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

  const normalized = normalizeRetentionRequest(body);
  if (!normalized.ok) return json({ success: false, error: normalized.error }, 400);
  const request = normalized.value;

  let deletionEnabled = false;
  try {
    deletionEnabled = secrets.get('DRAFT_RECOVERY_PERMANENT_DELETION_ENABLED') === 'true';
  } catch {
    deletionEnabled = false;
  }
  if (request.action === 'delete' && !request.dryRun && !deletionEnabled) {
    return json({
      success: false,
      error: 'Permanent deletion is disabled until retention periods are approved.',
    }, 409);
  }

  const entity = request.recordType === 'draft'
    ? base44.asServiceRole.entities.FormDraft
    : base44.asServiceRole.entities.FormSubmissionIntake;
  const sort = request.action === 'archive' ? 'updated_date' : 'archived_at';
  const candidates = await entity.filter(
    buildRetentionQuery(request),
    sort,
    request.batchSize,
    0,
    ['id'],
  );

  let processed = 0;
  let failed = 0;
  if (!request.dryRun) {
    for (const candidate of candidates) {
      try {
        if (request.action === 'archive') {
          const result = await entity.updateMany(
            { id: candidate.id, archived: { $ne: true } },
            { $set: { archived: true, archived_at: new Date().toISOString() } },
          );
          processed += Number(result?.updated || 0);
        } else {
          await entity.delete(candidate.id);
          processed += 1;
        }
      } catch {
        failed += 1;
      }
    }
  }

  safeRecoveryLog({
    functionName: 'draftRecoveryRetention',
    authorizationMode: authorization.mode,
    identifier: request.recordType,
    deliveryStage: `${request.action}:${request.dryRun ? 'dry_run' : 'apply'}:${candidates.length}:${processed}:${failed}`,
  });

  return json({
    success: true,
    action: request.action,
    recordType: request.recordType,
    dryRun: request.dryRun,
    candidateCount: candidates.length,
    processedCount: processed,
    failedCount: failed,
    hasMore: candidates.length === request.batchSize,
  });
});
