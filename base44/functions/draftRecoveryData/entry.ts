import { createClientFromRequest } from 'npm:@base44/sdk@0.8.39';
import { validateDraftRecoveryAccessToken } from '../_shared/draftRecoveryAccess.ts';

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'Invalid request' }, 400);
  }

  if (!(await validateDraftRecoveryAccessToken(body.accessToken))) {
    return json({ success: false, error: 'Draft recovery access is required.' }, 401);
  }

  const base44 = createClientFromRequest(req);

  try {
    switch (body.action) {
      case 'listDrafts': {
        const drafts = await base44.asServiceRole.entities.FormDraft.list();
        return json({ success: true, drafts });
      }

      case 'listIntakes': {
        const intakes = await base44.asServiceRole.entities.FormSubmissionIntake.list();
        return json({ success: true, intakes });
      }

      case 'updateDraft': {
        if (typeof body.draftId !== 'string' || !body.draftId) {
          return json({ success: false, error: 'draftId is required.' }, 400);
        }
        if (!body.updates || typeof body.updates !== 'object' || Array.isArray(body.updates)) {
          return json({ success: false, error: 'updates are required.' }, 400);
        }

        const allowedFields = new Set(['business_name', 'domain', 'mapped_payload_json']);
        const updates = Object.fromEntries(
          Object.entries(body.updates).filter(([key]) => allowedFields.has(key)),
        );
        if (Object.keys(updates).length === 0) {
          return json({ success: false, error: 'No supported fields were provided.' }, 400);
        }

        const draft = await base44.asServiceRole.entities.FormDraft.update(body.draftId, updates);
        return json({ success: true, draft });
      }

      default:
        return json({ success: false, error: 'Unsupported action.' }, 400);
    }
  } catch (error) {
    console.error('Draft recovery data request failed', error);
    return json({ success: false, error: 'The draft recovery request failed.' }, 500);
  }
});
