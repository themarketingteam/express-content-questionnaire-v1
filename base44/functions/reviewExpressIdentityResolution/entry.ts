import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { secrets } from 'base44:runtime';
import { authorizeRecoveryRequest, safeRecoveryLog } from '../../shared/recoveryAuthorization.ts';
import { withSubmissionSessionLease } from '../../shared/submissionCoordinator.ts';
import { reviewIdentityResolution } from '../../shared/submissionIdentityRecovery.js';

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
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }

  const base44 = createClientFromRequest(req);
  let recoverySecret = '';
  try { recoverySecret = secrets.get('DRAFT_RECOVERY_PASSWORD') || ''; } catch { /* handled below */ }
  if (!recoverySecret) return json({ ok: false, error: 'Draft recovery access is not configured.' }, 503);

  const authorization = await authorizeRecoveryRequest({
    base44,
    recoveryGrant: body.recoveryGrant,
    recoverySecret,
  });
  if (!authorization.authorized) return json({ ok: false, error: authorization.error }, 403);

  const attemptId = typeof body.attemptId === 'string' ? body.attemptId.trim() : '';
  const field = body.field;
  const decision = body.decision;
  const expectedFingerprint = typeof body.expectedFingerprint === 'string' ? body.expectedFingerprint.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(attemptId)) return json({ ok: false, error: 'A valid attemptId is required.' }, 400);
  if (field !== 'business_name' && field !== 'domain') return json({ ok: false, error: 'field must be business_name or domain.' }, 400);
  if (decision !== 'apply' && decision !== 'reject') return json({ ok: false, error: 'decision must be apply or reject.' }, 400);
  if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) return json({ ok: false, error: 'A valid expectedFingerprint is required.' }, 400);

  let attempt;
  try {
    attempt = await base44.asServiceRole.entities.ExpressIdentityResolutionAttempt.get(attemptId);
  } catch {
    return json({ ok: false, error: 'Identity resolution attempt not found.' }, 404);
  }

  safeRecoveryLog({
    functionName: 'reviewExpressIdentityResolution',
    authorizationMode: authorization.mode,
    identifier: attemptId,
    deliveryStage: `${decision}:${field}`,
  });

  try {
    const result = await reviewIdentityResolution({
      base44,
      attempt,
      field,
      decision,
      expectedFingerprint,
      withSessionLease: withSubmissionSessionLease,
      reviewerId: authorization.userId || authorization.mode,
    });
    return json(result);
  } catch (error) {
    const message = error?.message || 'Identity review failed.';
    const status = /changed after|changed while|fingerprint/i.test(message) ? 409 : 422;
    return json({ ok: false, error: message }, status);
  }
});
