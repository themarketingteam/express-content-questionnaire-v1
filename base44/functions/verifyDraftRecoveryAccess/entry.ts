import { secrets } from 'base44:runtime';
import {
  issueRecoveryGrant,
  validateRecoveryGrant,
  MAX_RECOVERY_GRANT_LIFETIME_SECONDS,
} from '../../shared/recoveryGrant.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};

const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: corsHeaders });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'Invalid request.' }, 400);
  }

  let recoveryPassword = '';
  try {
    recoveryPassword = secrets.get('DRAFT_RECOVERY_PASSWORD') || '';
  } catch {
    return json({ success: false, error: 'Draft recovery access is not configured.' }, 503);
  }
  if (!recoveryPassword) return json({ success: false, error: 'Draft recovery access is not configured.' }, 503);

  if (typeof body.recoveryGrant === 'string') {
    const validation = await validateRecoveryGrant(body.recoveryGrant, recoveryPassword);
    if (!validation.valid) return json({ success: false, valid: false, error: validation.error }, 403);
    return json({
      success: true,
      valid: true,
      recoveryGrant: body.recoveryGrant,
      expiresAt: validation.payload.expiresAt,
    });
  }

  const issued = await issueRecoveryGrant(body.password, recoveryPassword, {
    lifetimeSeconds: MAX_RECOVERY_GRANT_LIFETIME_SECONDS,
  });
  if (!issued) return json({ success: false, valid: false, error: 'Incorrect recovery password.' }, 403);

  console.info(JSON.stringify({
    functionName: 'verifyDraftRecoveryAccess',
    authorizationMode: 'recovery_password',
    deliveryStage: 'grant_issued',
    zapierStatus: null,
  }));
  return json({
    success: true,
    valid: true,
    recoveryGrant: issued.recoveryGrant,
    expiresAt: issued.payload.expiresAt,
  });
});
