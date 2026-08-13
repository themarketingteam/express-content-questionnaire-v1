/**
 * autoRepairRetryIntake.js
 *
 * Scheduled backend function — runs every 5 minutes.
 * Finds FormSubmissionIntake records with status "auto_repair_pending"
 * that are at least 10 minutes old, then runs AI repair + retry.
 * If repair/retry fails, marks draft as "auto_repair_failed".
 *
 * Also finds FormDraft records with status "auto_repair_pending"
 * for the same purpose.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { withSubmissionSessionLease } from '../../shared/submissionCoordinator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const RETRY_DELAY_MINUTES = 10;
const ARRAY_FIELDS = ['it_company_type', 'service_offerings', 'target_industries', 'client_challenges', 'client_outcomes'];
const SCALAR_FIELDS = [
  'it_company_type_other', 'service_offerings_other', 'differentiation', 'geographic_areas',
  'pricing_packaging', 'pricing_packaging_other', 'company_goals', 'company_goals_other',
  'brand_tone', 'brand_tone_other', 'target_industries_other', 'client_size',
  'client_challenges_other', 'client_outcomes_other', 'ideal_client',
];

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function incrementCount(v) {
  return typeof v === 'number' && !isNaN(v) ? v + 1 : 1;
}

function sanitizeGeoMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  if (typeof raw.label === 'string' && raw.label.trim()) out.label = raw.label.trim();
  if (typeof raw.lat === 'number' && isFinite(raw.lat)) out.lat = raw.lat;
  if (typeof raw.lon === 'number' && isFinite(raw.lon)) out.lon = raw.lon;
  if (raw.place_id && typeof raw.place_id === 'string') out.place_id = raw.place_id.trim();
  if (typeof raw.source === 'string' && raw.source.trim()) out.source = raw.source.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

function deterministicRepair(payload, context = {}) {
  const changedPaths = [];
  const warnings = [];
  const track = (path, before, after, reason) => changedPaths.push({ path, before: String(before ?? 'null'), after: String(after ?? 'null'), reason });

  let working = payload;
  if (!isPlainObject(working)) {
    working = typeof working === 'string' ? (() => { try { return JSON.parse(working); } catch { return {}; } })() : {};
  }

  if (!isPlainObject(working.metadata)) { track('metadata', typeof working.metadata, '{}', 'not plain object'); working = { ...working, metadata: {} }; }
  if (!isPlainObject(working.userdata)) { track('userdata', typeof working.userdata, '{}', 'not plain object'); working = { ...working, userdata: {} }; }

  const meta = { ...working.metadata };
  const ud = { ...working.userdata };

  if (meta.service_type !== 'express') { track('metadata.service_type', meta.service_type, 'express', 'normalized'); meta.service_type = 'express'; }
  if (!meta.business_name && context.businessName) { track('metadata.business_name', meta.business_name, context.businessName, 'filled'); meta.business_name = context.businessName; }
  if (!meta.questionnaire_session_id && context.sessionId) { track('metadata.questionnaire_session_id', '', context.sessionId, 'filled'); meta.questionnaire_session_id = context.sessionId; }
  if (!meta.submission_datetime || isNaN(new Date(meta.submission_datetime).getTime())) {
    const now = nowIso(); track('metadata.submission_datetime', meta.submission_datetime, now, 'filled'); meta.submission_datetime = now;
  }

  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(ud[field])) {
      const fixed = typeof ud[field] === 'string' && ud[field].trim() ? [ud[field].trim()] : [];
      track(`userdata.${field}`, JSON.stringify(ud[field]), JSON.stringify(fixed), 'normalized to array');
      ud[field] = fixed;
    }
  }

  for (const field of SCALAR_FIELDS) {
    if (typeof ud[field] !== 'string') {
      const fixed = Array.isArray(ud[field]) && ud[field].length > 0 ? ud[field].filter(Boolean).join(', ') : '';
      track(`userdata.${field}`, JSON.stringify(ud[field]), JSON.stringify(fixed), 'normalized to string');
      ud[field] = fixed;
    }
  }

  if (ud.geographic_area_meta !== undefined && !isPlainObject(ud.geographic_area_meta)) {
    warnings.push('geographic_area_meta reset'); track('userdata.geographic_area_meta', typeof ud.geographic_area_meta, '{}', 'reset'); ud.geographic_area_meta = {};
  }

  return { payload: { metadata: meta, userdata: ud }, changedPaths, warnings, repaired: changedPaths.length > 0 };
}

function validatePayload(payload) {
  const errors = [];
  if (!isPlainObject(payload)) { errors.push('payload must be a plain object'); return { ok: false, errors }; }
  if (!isPlainObject(payload.metadata)) { errors.push('metadata must be a plain object'); }
  else {
    if (!payload.metadata.business_name) errors.push('metadata.business_name is required');
    if (payload.metadata.service_type !== 'express') errors.push('service_type must be express');
  }
  if (!isPlainObject(payload.userdata)) { errors.push('userdata must be a plain object'); }
  else {
    for (const f of ARRAY_FIELDS) { if (!Array.isArray(payload.userdata[f])) errors.push(`userdata.${f} must be an array`); }
    for (const f of SCALAR_FIELDS) { if (typeof payload.userdata[f] !== 'string') errors.push(`userdata.${f} must be a string`); }
  }
  return { ok: errors.length === 0, errors };
}

function mapToFormSubmissionRecord(payload, rawResponses) {
  const meta = payload.metadata || {};
  const ud = payload.userdata || {};
  let companyGoals = ud.company_goals;
  if (Array.isArray(companyGoals)) { /* ok */ }
  else if (companyGoals && typeof companyGoals === 'string') { companyGoals = [companyGoals]; }
  else { companyGoals = []; }
  const geoMeta = sanitizeGeoMeta(ud.geographic_area_meta);
  const record = {
    business_name: meta.business_name || '',
    submission_datetime: meta.submission_datetime || nowIso(),
    service_type: 'express',
    it_company_type: Array.isArray(ud.it_company_type) ? ud.it_company_type : [],
    it_company_type_other: ud.it_company_type_other || '',
    service_offerings: Array.isArray(ud.service_offerings) ? ud.service_offerings : [],
    service_offerings_other: ud.service_offerings_other || '',
    differentiation: ud.differentiation || '',
    geographic_areas: ud.geographic_areas || '',
    pricing_packaging: ud.pricing_packaging || '',
    pricing_packaging_other: ud.pricing_packaging_other || '',
    company_goals: companyGoals,
    company_goals_other: ud.company_goals_other || '',
    brand_tone: ud.brand_tone || '',
    brand_tone_other: ud.brand_tone_other || '',
    target_industries: Array.isArray(ud.target_industries) ? ud.target_industries : [],
    target_industries_other: ud.target_industries_other || '',
    client_size: ud.client_size || '',
    client_challenges: Array.isArray(ud.client_challenges) ? ud.client_challenges : [],
    client_challenges_other: ud.client_challenges_other || '',
    client_outcomes: Array.isArray(ud.client_outcomes) ? ud.client_outcomes : [],
    client_outcomes_other: ud.client_outcomes_other || '',
    ideal_client: ud.ideal_client || '',
    questionnaire_session_id: meta.questionnaire_session_id || '',
    submit_attempt_id: meta.submit_attempt_id || '',
    raw_responses_json: typeof rawResponses === 'string'
      ? rawResponses
      : JSON.stringify(rawResponses || {}),
    transformed_payload_json: JSON.stringify(payload || {}),
    zapier_delivery_status: 'not_attempted',
    zapier_sent: false,
    zapier_sent_at: '',
    zapier_error_json: '',
    zapier_attempt_count: 0,
  };
  if (geoMeta) record.geographic_area_meta = geoMeta;
  return record;
}

async function processIntake(base44, intake) {
  const now = nowIso();
  const sessionId = intake.questionnaire_session_id || '';
  const businessName = intake.business_name || '';

  // Extract payload
  const rawPayload = parseJson(intake.transformed_payload_json) || parseJson(intake.raw_responses_json);
  if (!rawPayload) {
    await base44.asServiceRole.entities.FormSubmissionIntake.update(intake.id, {
      status: 'retry_failed',
      ai_repair_status: 'failed',
      ai_repair_error_json: JSON.stringify({ message: 'No payload found for auto repair' }),
      last_ai_repair_at: now,
      ai_repair_attempt_count: incrementCount(intake.ai_repair_attempt_count),
    });
    // Mark draft as auto_repair_failed if linked
    await markDraftAutoRepairFailed(base44, sessionId, 'No payload found in intake');
    return { ok: false, reason: 'no_payload' };
  }

  // Deterministic repair
  const repairContext = { businessName, sessionId, submitAttemptId: intake.submit_attempt_id || '' };
  const repairResult = deterministicRepair(rawPayload, repairContext);
  const validation = validatePayload(repairResult.payload);

  if (!validation.ok) {
    await base44.asServiceRole.entities.FormSubmissionIntake.update(intake.id, {
      status: 'retry_failed',
      ai_repair_status: 'failed',
      ai_repair_error_json: JSON.stringify({ message: 'Auto repair validation failed', errors: validation.errors }),
      ai_repaired_payload_json: JSON.stringify(repairResult.payload),
      last_ai_repair_at: now,
      ai_repair_attempt_count: incrementCount(intake.ai_repair_attempt_count),
    });
    await markDraftAutoRepairFailed(base44, sessionId, `Validation failed: ${validation.errors.join('; ')}`);
    return { ok: false, reason: 'validation_failed', errors: validation.errors };
  }

  return await withSubmissionSessionLease({
    base44,
    sessionId: sessionId || `repair-intake:${intake.id}`,
    purpose: `submission-repair:${sessionId || intake.id}:${intake.submit_attempt_id || 'intake'}`,
    operation: async () => {
  // Dedupe check
  if (sessionId) {
    try {
      const existing = await base44.asServiceRole.entities.FormSubmission.filter(
        { questionnaire_session_id: sessionId }, '-created_date', 1
      );
      if (existing && existing.length > 0) {
        await base44.asServiceRole.entities.FormSubmissionIntake.update(intake.id, {
          status: 'retry_success',
          linked_submission_id: existing[0].id,
          ai_repair_status: 'applied',
          ai_repair_applied: true,
          last_ai_repair_at: now,
        });
        await markDraftSubmitted(base44, sessionId, existing[0].id);
        return { ok: true, alreadyExists: true, submissionId: existing[0].id };
      }
    } catch { /* skip */ }
  }

  // Create FormSubmission
  const record = mapToFormSubmissionRecord(repairResult.payload, intake.raw_responses_json);
  let created;
  try {
    created = await base44.asServiceRole.entities.FormSubmission.create(record);
  } catch (createErr) {
    await base44.asServiceRole.entities.FormSubmissionIntake.update(intake.id, {
      status: 'retry_failed',
      ai_repair_status: 'failed',
      ai_repair_error_json: JSON.stringify({ message: createErr?.message || 'FormSubmission create failed' }),
      ai_repaired_payload_json: JSON.stringify(repairResult.payload),
      last_ai_repair_at: now,
      ai_repair_attempt_count: incrementCount(intake.ai_repair_attempt_count),
      retry_error_json: JSON.stringify({ message: createErr?.message || 'create failed' }),
      last_retry_at: now,
      retry_count: incrementCount(intake.retry_count),
    });
    await markDraftAutoRepairFailed(base44, sessionId, createErr?.message || 'create failed');
    return { ok: false, reason: 'create_failed', error: createErr?.message };
  }

  // Success — update intake and draft
  await base44.asServiceRole.entities.FormSubmissionIntake.update(intake.id, {
    status: 'retry_success',
    linked_submission_id: created.id,
    ai_repair_status: 'applied',
    ai_repair_applied: true,
    ai_repaired_payload_json: JSON.stringify(repairResult.payload),
    ai_repair_report_json: JSON.stringify({ changedPaths: repairResult.changedPaths, warnings: repairResult.warnings, source: 'auto_repair' }),
    last_ai_repair_at: now,
    ai_repair_attempt_count: incrementCount(intake.ai_repair_attempt_count),
    retry_count: incrementCount(intake.retry_count),
    last_retry_at: now,
    ai_repair_source: 'deterministic',
  });

  await markDraftSubmitted(base44, sessionId, created.id);

  // Best-effort Zapier delivery
  try {
    const webhookUrl = Deno.env.get('EXPRESS_ZAPIER_WEBHOOK_URL')?.trim();
    if (webhookUrl) {
      const zapPayload = { metadata: repairResult.payload.metadata, userdata: repairResult.payload.userdata };
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zapPayload),
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        await base44.asServiceRole.entities.FormSubmission.update(created.id, {
          zapier_sent: true, zapier_delivery_status: 'sent', zapier_sent_at: now, zapier_attempt_count: 1,
        });
      }
    }
  } catch { /* best effort */ }

  return { ok: true, submissionId: created.id };
    },
  });
}

async function markDraftAutoRepairFailed(base44, sessionId, reason) {
  if (!sessionId) return;
  try {
    const drafts = await base44.asServiceRole.entities.FormDraft.filter(
      { session_id: sessionId }, '-last_saved_at', 1
    );
    if (drafts && drafts.length > 0) {
      await base44.asServiceRole.entities.FormDraft.update(drafts[0].id, {
        status: 'auto_repair_failed',
        save_error: `Auto repair failed: ${reason}`,
      });
    }
  } catch { /* best effort */ }
}

async function markDraftSubmitted(base44, sessionId, submissionId) {
  if (!sessionId) return;
  try {
    const drafts = await base44.asServiceRole.entities.FormDraft.filter(
      { session_id: sessionId }, '-last_saved_at', 1
    );
    if (drafts && drafts.length > 0) {
      await base44.asServiceRole.entities.FormDraft.update(drafts[0].id, {
        status: 'submitted',
        final_submission_id: submissionId,
      });
    }
  } catch { /* best effort */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // This function runs as a scheduled automation (service role context)
    // but can also be invoked manually by an admin for testing
    const base44 = createClientFromRequest(req);

    // Find intakes pending auto repair that are at least RETRY_DELAY_MINUTES old
    const cutoff = new Date(Date.now() - RETRY_DELAY_MINUTES * 60 * 1000).toISOString();

    const pendingIntakes = await base44.asServiceRole.entities.FormSubmissionIntake.filter(
      { status: 'auto_repair_pending' }
    );

    const eligibleIntakes = (pendingIntakes || []).filter(intake => {
      const createdAt = intake.created_at_server || intake.created_date || '';
      return createdAt < cutoff;
    });

    const results = [];
    for (const intake of eligibleIntakes) {
      try {
        const result = await processIntake(base44, intake);
        results.push({ intakeId: intake.id, sessionId: intake.questionnaire_session_id, ...result });
      } catch (err) {
        results.push({ intakeId: intake.id, ok: false, reason: 'unexpected_error', error: err?.message });
      }
    }

    return Response.json({
      ok: true,
      processed: results.length,
      eligible: eligibleIntakes.length,
      total_pending: (pendingIntakes || []).length,
      results,
      ran_at: new Date().toISOString(),
    }, { headers: corsHeaders });

  } catch (error) {
    return Response.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500, headers: corsHeaders }
    );
  }
});
