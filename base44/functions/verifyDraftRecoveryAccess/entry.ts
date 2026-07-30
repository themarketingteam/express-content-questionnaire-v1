import {
  DRAFT_RECOVERY_PASSWORD_SECRET,
  getDraftRecoveryPassword,
  issueDraftRecoveryAccessToken,
  passwordMatches,
  validateDraftRecoveryAccessToken,
} from '../_shared/draftRecoveryAccess.ts';

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
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  const configuredPassword = getDraftRecoveryPassword();
  if (!configuredPassword) {
    console.error(`${DRAFT_RECOVERY_PASSWORD_SECRET} is not configured`);
    return json({
      success: false,
      error: 'Draft recovery access is not configured. Contact an administrator.',
    }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'Invalid request' }, 400);
  }

  if (body.accessToken) {
    const payload = await validateDraftRecoveryAccessToken(
      body.accessToken,
      configuredPassword,
    );
    if (!payload) {
      return json({ success: false, error: 'Access has expired. Enter the password again.' }, 401);
    }
    return json({
      success: true,
      authorized: true,
      expiresAt: new Date(payload.expiresAt).toISOString(),
    });
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!(await passwordMatches(password, configuredPassword))) {
    // Add a small delay so repeated guesses are more expensive.
    await new Promise((resolve) => setTimeout(resolve, 750));
    return json({ success: false, error: 'Incorrect password.' }, 401);
  }

  const session = await issueDraftRecoveryAccessToken(configuredPassword);
  return json({
    success: true,
    authorized: true,
    ...session,
  });
});
