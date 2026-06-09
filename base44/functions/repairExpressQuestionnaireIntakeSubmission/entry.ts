import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function safeError(error) {
  try {
    return {
      message: error?.message || String(error),
      name: error?.name || 'Error',
      stack: error?.stack || null,
    };
  } catch {
    return { message: String(error) };
  }
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

const ARRAY_FIELDS = ['it_company_type', 'service_offerings', 'target_industries', 'client_challenges', 'client_outcomes'];
const SCALAR_FIELDS = [
  'it_company_type_other', 'service_offerings_other', 'differentiation', 'geographic_areas',
  'pricing_packaging', 'pricing_packaging_other', 'company_goals', 'company_goals_other',
  'brand_tone', 'brand_tone_other', 'target_industries_other', 'client_size',
  'client_challenges_other', 'client_outcomes_other', 'ideal_client',
];

function sanitizeGeoMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  if (typeof raw.label === 'string' && raw.label.trim()) out.label = raw.label.trim();
  if (typeof raw.lat === 'number' && isFinite(raw.lat)) out.lat = raw.lat;
  if (typeof raw.lon === 'number' && isFinite(raw.lon)) out.lon = raw.lon;
  if (raw.place_id && typeof raw.place_id === 'string' && raw.place_id.trim()) out.place_id = raw.place_id.trim();
  if (typeof raw.source === 'string' && raw.source.trim()) out.source = raw.source.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

// ─── Deterministic Repair ────────────────────────────────────────────────────

function deterministicRepair(payload, context = {}) {
  const changedPaths = [];
  const warnings = [];

  const track = (path, before, after, reason) => {
    changedPaths.push({ path, before: String(before ?? 'null'), after: String(after ?? 'null'), reason });
  };

  let working = payload;
  if (!isPlainObject(working)) {
    if (typeof working === 'string') {
      try { working = JSON.parse(working); } catch { working = {}; track('.', 'non-parseable string', '{}', 'reset'); }
    } else {
      working = {};
      track('.', typeof payload, '{}', 'was not a plain object');
    }
  }

  if (!isPlainObject(working.metadata)) {
    track('metadata', typeof working.metadata, '{}', 'was not a plain object');
    working = { ...working, metadata: {} };
  }
  if (!isPlainObject(working.userdata)) {
    track('userdata', typeof working.userdata, '{}', 'was not a plain object');
    working = { ...working, userdata: {} };
  }

  const meta = { ...working.metadata };
  const ud = { ...working.userdata };

  if (meta.service_type !== 'express') {
    track('metadata.service_type', meta.service_type, 'express', 'normalized to express');
    meta.service_type = 'express';
  }

  if (!meta.business_name && context.businessName) {
    track('metadata.business_name', meta.business_name, context.businessName, 'filled from trusted context');
    meta.business_name = context.businessName;
  }

  if (meta.businessDomain && typeof meta.businessDomain !== 'string') {
    track('metadata.businessDomain', meta.businessDomain, '', 'non-string domain cleared');
    meta.businessDomain = '';
  }

  const isValidIso = (v) => typeof v === 'string' && v.length > 0 && !isNaN(new Date(v).getTime());
  if (!isValidIso(meta.submission_datetime)) {
    const now = nowIso();
    track('metadata.submission_datetime', meta.submission_datetime, now, 'missing or invalid; filled');
    meta.submission_datetime = now;
  }

  if (!meta.questionnaire_session_id && context.sessionId) {
    track('metadata.questionnaire_session_id', meta.questionnaire_session_id, context.sessionId, 'filled from context');
    meta.questionnaire_session_id = context.sessionId;
  }

  if (!meta.submit_attempt_id && context.submitAttemptId) {
    track('metadata.submit_attempt_id', meta.submit_attempt_id, context.submitAttemptId, 'filled from context');
    meta.submit_attempt_id = context.submitAttemptId;
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
      const fixed = Array.isArray(ud[field]) && ud[field].length > 0
        ? ud[field].filter(Boolean).join(', ')
        : '';
      track(`userdata.${field}`, JSON.stringify(ud[field]), JSON.stringify(fixed), 'normalized to string');
      ud[field] = fixed;
    }
  }

  if (ud.geographic_area_meta !== undefined && !isPlainObject(ud.geographic_area_meta)) {
    warnings.push('userdata.geographic_area_meta was not a plain object; reset to {}');
    track('userdata.geographic_area_meta', typeof ud.geographic_area_meta, '{}', 'invalid; reset');
    ud.geographic_area_meta = {};
  }

  return {
    payload: { metadata: meta, userdata: ud },
    changedPaths,
    warnings,
    repaired: changedPaths.length > 0,
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validatePayload(payload) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(payload)) { errors.push('payload must be a plain object'); return { ok: false, errors, warnings }; }
  if (!isPlainObject(payload.metadata)) { errors.push('metadata must be a plain object'); }
  else {
    if (!payload.metadata.business_name) errors.push('metadata.business_name is required');
    if (payload.metadata.service_type !== 'express') errors.push('metadata.service_type must be "express"');
    if (!payload.metadata.questionnaire_session_id) warnings.push('metadata.questionnaire_session_id is missing');
  }
  if (!isPlainObject(payload.userdata)) { errors.push('userdata must be a plain object'); }
  else {
    for (const f of ARRAY_FIELDS) { if (!Array.isArray(payload.userdata[f])) errors.push(`userdata.${f} must be an array`); }
    for (const f of SCALAR_FIELDS) { if (typeof payload.userdata[f] !== 'string') errors.push(`userdata.${f} must be a string`); }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ─── FormSubmission mapper ────────────────────────────────────────────────────

function mapToFormSubmissionRecord(payload) {
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
    zapier_delivery_status: 'not_attempted',
    zapier_sent: false,
    zapier_sent_at: '',
    zapier_error_json: '',
    zapier_attempt_count: 0,
  };

  if (geoMeta) record.geographic_area_meta = geoMeta;
  return record;
}

// ─── Source resolution ────────────────────────────────────────────────────────

async function resolveSource(base44, { draftId, intakeId, questionnaireSessionId }) {
  // Try intake first by ID
  if (intakeId) {
    const records = await base44.asServiceRole.entities.FormSubmissionIntake.filter({ id: intakeId });
    if (records && records.length > 0) return { type: 'intake', record: records[0] };
  }

  // Try draft by ID
  if (draftId) {
    const records = await base44.asServiceRole.entities.FormDraft.filter({ id: draftId });
    if (records && records.length > 0) return { type: 'draft', record: records[0] };
  }

  // Try intake by session
  if (questionnaireSessionId) {
    const intakes = await base44.asServiceRole.entities.FormSubmissionIntake.filter(
      { questionnaire_session_id: questionnaireSessionId }, '-created_date', 1
    );
    if (intakes && intakes.length > 0) return { type: 'intake', record: intakes[0] };

    const drafts = await base44.asServiceRole.entities.FormDraft.filter(
      { session_id: questionnaireSessionId }, '-last_saved_at', 1
    );
    if (drafts && drafts.length > 0) return { type: 'draft', record: drafts[0] };
  }

  return null;
}

function extractPayloadFromSource(source) {
  if (source.type === 'intake') {
    const r = source.record;
    return parseJson(r.transformed_payload_json) ||
           parseJson(r.raw_responses_json) ||
           null;
  }
  if (source.type === 'draft') {
    const r = source.record;
    return parseJson(r.mapped_payload_json) ||
           parseJson(r.responses_json) ||
           null;
  }
  return null;
}

function buildRepairContext(source) {
  const r = source.record;
  if (source.type === 'intake') {
    return {
      businessName: r.business_name || '',
      sessionId: r.questionnaire_session_id || '',
      submitAttemptId: r.submit_attempt_id || '',
    };
  }
  if (source.type === 'draft') {
    const meta = parseJson(r.metadata_json) || {};
    return {
      businessName: r.business_name || meta.business_name || '',
      sessionId: r.session_id || meta.questionnaire_session_id || '',
      submitAttemptId: meta.submit_attempt_id || '',
    };
  }
  return {};
}

// ─── AI Agent invocation ──────────────────────────────────────────────────────

async function callRepairAgent(base44, { sourceRecord, sourceType, rawPayload, repairContext }) {
  const r = sourceRecord;
  const prompt = `You are the Express questionnaire submission repair agent.

Source type: ${sourceType}
Business name: ${repairContext.businessName || 'unknown'}
Session ID: ${repairContext.sessionId || 'unknown'}

Here is the data available for repair:

transformed_payload_json: ${JSON.stringify(rawPayload)}
business_name: ${repairContext.businessName || ''}
business_domain: ${sourceType === 'intake' ? (r.business_domain || '') : (r.domain || '')}
questionnaire_session_id: ${repairContext.sessionId || ''}
submit_attempt_id: ${repairContext.submitAttemptId || ''}

${sourceType === 'intake' && r.raw_responses_json ? `raw_responses_json: ${r.raw_responses_json}` : ''}
${sourceType === 'draft' && r.responses_json ? `responses_json: ${r.responses_json}` : ''}
${sourceType === 'draft' && r.userdata_json ? `userdata_json: ${r.userdata_json}` : ''}
${sourceType === 'draft' && r.metadata_json ? `metadata_json: ${r.metadata_json}` : ''}

Return ONLY the JSON response contract described in your instructions. No other text.`;

  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        repair_source: { type: 'string' },
        summary: { type: 'string' },
        repaired_payload: { type: 'object' },
        changed_paths: { type: 'array' },
        warnings: { type: 'array' },
        manual_review_reasons: { type: 'array' },
      },
      required: ['status', 'repaired_payload'],
    },
    model: 'claude_sonnet_4_6',
  });

  return result;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
  }

  try {
    const base44 = createClientFromRequest(req);

    // Admin auth
    let user;
    try { user = await base44.auth.me(); } catch { /* ignore */ }
    const isAdmin = user?.role === 'admin';
    const isBenjamin = user?.email?.toLowerCase() === 'benjamin.hines8@gmail.com';
    if (!isAdmin && !isBenjamin) {
      return Response.json({ ok: false, error: 'Forbidden: Admin access required' }, { status: 403, headers: corsHeaders });
    }

    const { draftId, intakeId, questionnaireSessionId, mode = 'repair_only', forceRetry = false } = body;

    if (!draftId && !intakeId && !questionnaireSessionId) {
      return Response.json({ ok: false, error: 'draftId, intakeId, or questionnaireSessionId is required' }, { status: 400, headers: corsHeaders });
    }

    const validModes = ['diagnose_only', 'repair_only', 'repair_and_retry'];
    if (!validModes.includes(mode)) {
      return Response.json({ ok: false, error: `mode must be one of: ${validModes.join(', ')}` }, { status: 400, headers: corsHeaders });
    }

    // Resolve source record
    const source = await resolveSource(base44, { draftId, intakeId, questionnaireSessionId });
    if (!source) {
      return Response.json({ ok: false, error: 'No matching draft or intake record found' }, { status: 404, headers: corsHeaders });
    }

    const sourceId = source.record.id;
    const sourceType = source.type;
    const repairContext = buildRepairContext(source);
    const rawPayload = extractPayloadFromSource(source);

    const now = nowIso();

    // ── DIAGNOSE ONLY ──────────────────────────────────────────────────────────
    if (mode === 'diagnose_only') {
      const deterministicResult = rawPayload
        ? deterministicRepair(rawPayload, repairContext)
        : { payload: null, changedPaths: [], warnings: ['No payload found to diagnose'], repaired: false };

      const validation = deterministicResult.payload
        ? validatePayload(deterministicResult.payload)
        : { ok: false, errors: ['No payload available'], warnings: [] };

      const report = {
        summary: validation.ok
          ? 'Payload appears structurally valid after deterministic repair.'
          : `Deterministic repair found ${deterministicResult.changedPaths.length} issue(s); validation ${validation.ok ? 'passed' : 'failed'}.`,
        changedPaths: deterministicResult.changedPaths,
        warnings: [...deterministicResult.warnings, ...validation.warnings],
        manualReviewReasons: validation.ok ? [] : validation.errors,
        validationOk: validation.ok,
        validationErrors: validation.errors,
      };

      const aiRepairFields = {
        ai_repair_status: 'diagnosed',
        ai_repair_attempt_count: incrementCount(source.record.ai_repair_attempt_count),
        last_ai_repair_at: now,
        ai_repair_report_json: JSON.stringify(report),
        ai_repair_source: 'deterministic',
      };

      if (sourceType === 'intake') {
        await base44.asServiceRole.entities.FormSubmissionIntake.update(sourceId, aiRepairFields);
      } else {
        await base44.asServiceRole.entities.FormDraft.update(sourceId, aiRepairFields);
      }

      return Response.json({
        ok: true,
        mode: 'diagnose_only',
        sourceType,
        sourceId,
        status: 'diagnosed',
        repairReport: report,
      }, { headers: corsHeaders });
    }

    // ── REPAIR ONLY / REPAIR AND RETRY ────────────────────────────────────────

    // Step 1: Deterministic repair
    let deterministicResult = rawPayload
      ? deterministicRepair(rawPayload, repairContext)
      : { payload: null, changedPaths: [], warnings: ['No payload found'], repaired: false };

    let validation = deterministicResult.payload
      ? validatePayload(deterministicResult.payload)
      : { ok: false, errors: ['No payload available'], warnings: [] };

    let finalPayload = deterministicResult.payload;
    let allChangedPaths = [...deterministicResult.changedPaths];
    let allWarnings = [...deterministicResult.warnings, ...validation.warnings];
    let repairSource = deterministicResult.repaired ? 'deterministic' : 'deterministic';
    let aiReport = null;

    // Step 2: Call AI agent if deterministic repair couldn't produce a valid payload
    if (!validation.ok) {
      try {
        aiReport = await callRepairAgent(base44, {
          sourceRecord: source.record,
          sourceType,
          rawPayload,
          repairContext,
        });

        if (aiReport && aiReport.repaired_payload && isPlainObject(aiReport.repaired_payload)) {
          // Run one more deterministic pass on the AI result for safety
          const aiDeterministicPass = deterministicRepair(aiReport.repaired_payload, repairContext);
          finalPayload = aiDeterministicPass.payload;
          allChangedPaths = [...allChangedPaths, ...(aiReport.changed_paths || []), ...aiDeterministicPass.changedPaths];
          allWarnings = [...allWarnings, ...(aiReport.warnings || []), ...aiDeterministicPass.warnings];
          repairSource = deterministicResult.repaired ? 'deterministic_plus_ai' : 'ai';
          validation = validatePayload(finalPayload);
        }
      } catch (aiErr) {
        allWarnings.push(`AI repair call failed: ${aiErr?.message || 'unknown'}`);
      }
    }

    const repairStatus = validation.ok ? 'repaired' : 'needs_manual_review';

    const report = {
      summary: aiReport?.summary || (validation.ok
        ? `Payload repaired successfully via ${repairSource}.`
        : `Repair attempted but validation still has errors. Manual review required.`),
      changedPaths: allChangedPaths,
      warnings: allWarnings,
      manualReviewReasons: validation.ok ? [] : validation.errors,
      validationOk: validation.ok,
      validationErrors: validation.errors,
      aiStatus: aiReport?.status || null,
    };

    const repairedPayloadJson = finalPayload ? JSON.stringify(finalPayload) : null;

    const aiRepairFields = {
      ai_repair_status: repairStatus,
      ai_repair_attempt_count: incrementCount(source.record.ai_repair_attempt_count),
      last_ai_repair_at: now,
      ai_repair_report_json: JSON.stringify(report),
      ai_repaired_payload_json: repairedPayloadJson,
      ai_repair_applied: false,
      ai_repair_source: repairSource,
    };

    // ── REPAIR ONLY: update source record and return ──
    if (mode === 'repair_only') {
      if (sourceType === 'intake') {
        await base44.asServiceRole.entities.FormSubmissionIntake.update(sourceId, aiRepairFields);
      } else {
        await base44.asServiceRole.entities.FormDraft.update(sourceId, aiRepairFields);
      }

      return Response.json({
        ok: true,
        mode: 'repair_only',
        sourceType,
        sourceId,
        status: repairStatus,
        repairReport: report,
        repairedPayload: finalPayload,
      }, { headers: corsHeaders });
    }

    // ── REPAIR AND RETRY ──────────────────────────────────────────────────────
    // Only proceed if validation passed
    if (!validation.ok) {
      if (sourceType === 'intake') {
        await base44.asServiceRole.entities.FormSubmissionIntake.update(sourceId, {
          ...aiRepairFields,
          ai_repair_retry_attempted: true,
          ai_repair_retry_result_json: JSON.stringify({ ok: false, reason: 'validation_failed', errors: validation.errors }),
        });
      } else {
        await base44.asServiceRole.entities.FormDraft.update(sourceId, aiRepairFields);
      }

      return Response.json({
        ok: false,
        mode: 'repair_and_retry',
        sourceType,
        sourceId,
        status: 'needs_manual_review',
        error: 'Repaired payload still fails validation; cannot create FormSubmission without manual review.',
        details: { validationErrors: validation.errors, mode: 'repair_and_retry', sourceType },
      }, { status: 422, headers: corsHeaders });
    }

    // Dedupe checks
    const sessionId = finalPayload.metadata?.questionnaire_session_id || repairContext.sessionId;
    const submitAttemptId = finalPayload.metadata?.submit_attempt_id || repairContext.submitAttemptId;

    if (!forceRetry) {
      if (sessionId) {
        try {
          const existing = await base44.asServiceRole.entities.FormSubmission.filter(
            { questionnaire_session_id: sessionId }, '-created_date', 1
          );
          if (existing && existing.length > 0) {
            const existingId = existing[0].id;
            const retryResult = { ok: true, alreadySubmitted: true, linkedSubmissionId: existingId };

            if (sourceType === 'intake') {
              await base44.asServiceRole.entities.FormSubmissionIntake.update(sourceId, {
                ...aiRepairFields,
                status: 'retry_success',
                linked_submission_id: existingId,
                ai_repair_retry_attempted: true,
                ai_repair_retry_result_json: JSON.stringify(retryResult),
                ai_repair_applied: true,
              });
            }

            return Response.json({
              ok: true, mode: 'repair_and_retry', sourceType, sourceId,
              status: 'retried', linkedSubmissionId: existingId,
              repairReport: report,
            }, { headers: corsHeaders });
          }
        } catch { /* skip */ }
      }

      if (submitAttemptId) {
        try {
          const existing = await base44.asServiceRole.entities.FormSubmission.filter(
            { submit_attempt_id: submitAttemptId }, '-created_date', 1
          );
          if (existing && existing.length > 0) {
            const existingId = existing[0].id;
            if (sourceType === 'intake') {
              await base44.asServiceRole.entities.FormSubmissionIntake.update(sourceId, {
                ...aiRepairFields, status: 'retry_success', linked_submission_id: existingId,
                ai_repair_retry_attempted: true, ai_repair_applied: true,
                ai_repair_retry_result_json: JSON.stringify({ ok: true, alreadySubmitted: true }),
              });
            }
            return Response.json({
              ok: true, mode: 'repair_and_retry', sourceType, sourceId,
              status: 'retried', linkedSubmissionId: existingId,
              repairReport: report,
            }, { headers: corsHeaders });
          }
        } catch { /* skip */ }
      }
    }

    // Create FormSubmission
    const submissionRecord = mapToFormSubmissionRecord(finalPayload);
    let createdSubmission;

    try {
      createdSubmission = await base44.asServiceRole.entities.FormSubmission.create(submissionRecord);
    } catch (createErr) {
      const createErrorJson = JSON.stringify(safeError(createErr));
      if (sourceType === 'intake') {
        await base44.asServiceRole.entities.FormSubmissionIntake.update(sourceId, {
          ...aiRepairFields,
          ai_repair_retry_attempted: true,
          ai_repair_retry_result_json: JSON.stringify({ ok: false, error: safeError(createErr) }),
        });
      }
      return Response.json({
        ok: false, mode: 'repair_and_retry', sourceType, sourceId,
        error: 'FormSubmission creation failed after repair.',
        details: { mode: 'repair_and_retry', sourceType, validationErrors: [] },
      }, { status: 500, headers: corsHeaders });
    }

    const createdId = createdSubmission.id;

    // Update source record
    const retrySuccessFields = {
      ...aiRepairFields,
      ai_repair_applied: true,
      ai_repair_retry_attempted: true,
      ai_repair_retry_result_json: JSON.stringify({ ok: true, createdSubmissionId: createdId }),
    };

    if (sourceType === 'intake') {
      await base44.asServiceRole.entities.FormSubmissionIntake.update(sourceId, {
        ...retrySuccessFields,
        status: 'retry_success',
        linked_submission_id: createdId,
        retry_count: incrementCount(source.record.retry_count),
        last_retry_at: now,
      });
    } else {
      await base44.asServiceRole.entities.FormDraft.update(sourceId, {
        ...retrySuccessFields,
        status: 'submitted',
        final_submission_id: createdId,
      });
    }

    // Cross-link: if we repaired a draft, also try to update related intake
    if (sourceType === 'draft' && sessionId) {
      try {
        const relatedIntakes = await base44.asServiceRole.entities.FormSubmissionIntake.filter(
          { questionnaire_session_id: sessionId }, '-created_date', 1
        );
        if (relatedIntakes && relatedIntakes.length > 0) {
          await base44.asServiceRole.entities.FormSubmissionIntake.update(relatedIntakes[0].id, {
            status: 'retry_success',
            linked_submission_id: createdId,
            last_retry_at: now,
          });
        }
      } catch { /* best effort */ }
    }

    return Response.json({
      ok: true,
      mode: 'repair_and_retry',
      sourceType,
      sourceId,
      status: 'retried',
      createdSubmissionId: createdId,
      repairReport: report,
      repairedPayload: finalPayload,
    }, { headers: corsHeaders });

  } catch (error) {
    return Response.json(
      { ok: false, error: safeError(error).message },
      { status: 500, headers: corsHeaders }
    );
  }
});