import { AUTOMATED_RETENTION_DISABLED_ERROR } from '../../shared/recoveryRetention.ts';

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
  return json({
    success: false,
    policy: 'indefinite_until_manual_deletion',
    error: AUTOMATED_RETENTION_DISABLED_ERROR,
  }, 410);
});
