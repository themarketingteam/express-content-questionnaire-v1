import { createClientFromRequest } from 'npm:@base44/sdk@0.8.39';

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

  // This service-role gateway is intentionally public so the password-free
  // recovery page can read admin-restricted intake records and perform edits.
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
