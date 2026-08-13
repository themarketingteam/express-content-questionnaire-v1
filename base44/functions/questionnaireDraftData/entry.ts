import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

const encoder = new TextEncoder();
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{20,160}$/;
const ACCESS_KEY_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;

const stringFieldLimits: Record<string, number> = {
  business_name: 500,
  domain: 500,
  user_id: 500,
  user_name: 500,
  user_email: 500,
  status: 100,
  current_question_id: 100,
  last_changed_question_id: 100,
  responses_json: 1_000_000,
  validation_status_json: 1_000_000,
  touched_questions_json: 250_000,
  expanded_questions_json: 250_000,
  metadata_json: 1_000_000,
  userdata_json: 1_000_000,
  mapped_payload_json: 2_000_000,
  draft_metadata_json: 250_000,
  save_error: 10_000,
  submit_error: 100_000,
  submit_attempted_at: 100,
  submitted_at: 100,
  last_changed_at: 100,
  last_saved_at: 100,
  final_submission_id: 500,
  last_non_empty_answers_json: 1_000_000,
  field_history_json: 1_000_000,
  last_local_persisted_at: 100,
};

function isValidIdentity(sessionId: unknown, accessKey: unknown): sessionId is string {
  return typeof sessionId === 'string'
    && SESSION_ID_PATTERN.test(sessionId)
    && typeof accessKey === 'string'
    && ACCESS_KEY_PATTERN.test(accessKey);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashAccessKey(accessKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(accessKey));
  return bytesToHex(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function sanitizeDraft(rawDraft: unknown, sessionId: string): Record<string, string> | null {
  if (!rawDraft || typeof rawDraft !== 'object' || Array.isArray(rawDraft)) return null;

  const source = rawDraft as Record<string, unknown>;
  const draft: Record<string, string> = { session_id: sessionId };

  for (const [field, maxLength] of Object.entries(stringFieldLimits)) {
    if (!(field in source)) continue;
    const value = source[field];
    if (typeof value !== 'string' || value.length > maxLength) return null;
    draft[field] = value;
  }

  for (const jsonField of [
    'responses_json',
    'validation_status_json',
    'touched_questions_json',
    'expanded_questions_json',
    'metadata_json',
    'userdata_json',
    'mapped_payload_json',
    'draft_metadata_json',
    'last_non_empty_answers_json',
    'field_history_json',
  ]) {
    if (!draft[jsonField]) continue;
    try {
      const parsed = JSON.parse(draft[jsonField]);
      if (!parsed || typeof parsed !== 'object') return null;
    } catch {
      return null;
    }
  }

  return draft;
}

function newestRecord(records: any[]): any | null {
  return [...(records || [])].sort((left, right) => {
    const leftTime = new Date(left.last_saved_at || left.updated_date || left.created_date || 0).getTime() || 0;
    const rightTime = new Date(right.last_saved_at || right.updated_date || right.created_date || 0).getTime() || 0;
    return rightTime - leftTime;
  })[0] || null;
}

function clientSafeDraft(draft: Record<string, unknown>): Record<string, unknown> {
  const { draft_access_key_hash: _accessKeyHash, ...safeDraft } = draft;
  return safeDraft;
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

  if (!isValidIdentity(body.sessionId, body.accessKey)) {
    return json({ success: false, error: 'A valid draft identity is required.' }, 400);
  }

  const sessionId = body.sessionId;
  const accessKeyHash = await hashAccessKey(body.accessKey as string);
  const base44 = createClientFromRequest(req);

  try {
    const matches = await base44.asServiceRole.entities.FormDraft.filter(
      { session_id: sessionId },
      '-last_saved_at',
      10,
    );
    const existing = newestRecord(matches || []);

    if (body.action === 'load') {
      if (!existing) return json({ success: true, draft: null });
      if (!existing.draft_access_key_hash
        || !constantTimeEqual(existing.draft_access_key_hash, accessKeyHash)) {
        return json({ success: false, error: 'Draft access was denied.' }, 403);
      }
      return json({ success: true, draft: clientSafeDraft(existing) });
    }

    if (body.action !== 'save') {
      return json({ success: false, error: 'Unsupported action.' }, 400);
    }

    const draft = sanitizeDraft(body.draft, sessionId);
    if (!draft) return json({ success: false, error: 'Draft data is invalid.' }, 400);

    if (existing?.draft_access_key_hash
      && !constantTimeEqual(existing.draft_access_key_hash, accessKeyHash)) {
      return json({ success: false, error: 'Draft access was denied.' }, 403);
    }

    const incomingTime = new Date(draft.last_changed_at || draft.last_saved_at || 0).getTime() || 0;
    const existingTime = new Date(existing?.last_changed_at || existing?.last_saved_at || 0).getTime() || 0;
    if (existing && incomingTime > 0 && existingTime > incomingTime) {
      return json({
        success: true,
        saved: false,
        stale: true,
        draftId: existing.id,
        lastSavedAt: existing.last_saved_at || existing.updated_date || '',
      });
    }

    const nextDraft = {
      ...draft,
      draft_access_key_hash: accessKeyHash,
      last_saved_at: draft.last_saved_at || new Date().toISOString(),
    };
    const saved = existing
      ? await base44.asServiceRole.entities.FormDraft.update(existing.id, nextDraft)
      : await base44.asServiceRole.entities.FormDraft.create(nextDraft);

    console.info(JSON.stringify({
      functionName: 'questionnaireDraftData',
      deliveryStage: existing ? 'draft_updated' : 'draft_created',
      identifier: sessionId,
    }));

    return json({
      success: true,
      saved: true,
      stale: false,
      draftId: saved.id,
      lastSavedAt: saved.last_saved_at || saved.updated_date || nextDraft.last_saved_at,
    });
  } catch (error) {
    console.error('Questionnaire draft request failed', error);
    return json({ success: false, error: 'The questionnaire draft request failed.' }, 500);
  }
});
