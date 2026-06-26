import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(value, max = 500) {
  if (value === null || value === undefined) return null;
  const s = typeof value === 'string' ? value : String(value);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function safeJsonStringify(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function classifyError(error) {
  if (!error) return 'unknown';
  const msg = (error.message || '').toLowerCase();
  const name = (error.name || '').toLowerCase();
  const status = error.status || error.statusCode || 0;

  if (name === 'aborterror' || msg.includes('timeout') || msg.includes('aborted') || msg.includes('timed out')) return 'timeout';
  if (status === 401 || msg.includes('auth') || msg.includes('token') || msg.includes('session') || msg.includes('unauthorized')) return 'auth';
  if (status === 403 || msg.includes('permission') || msg.includes('rls') || msg.includes('policy') || msg.includes('access denied') || msg.includes('forbidden')) return 'permission';
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) return 'rate_limit';
  if ((status === 400 || status === 422) && (msg.includes('schema') || msg.includes('invalid field') || msg.includes('unknown field'))) return 'schema';
  if ((status === 400 || status === 422) && (msg.includes('validation') || msg.includes('required') || msg.includes('missing'))) return 'validation';
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('cors') || msg.includes('offline') || msg.includes('net::')) return 'network';
  if (status >= 500 || msg.includes('internal server') || msg.includes('bad gateway') || msg.includes('service unavailable') || msg.includes('gateway timeout')) return 'server';
  return 'unknown';
}

// Sanitize geographic_area_meta: remove null lat/lon/place_id
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

function normalizePayload(payload, questionnaireSessionId, primaryError) {
  const meta = { ...(payload?.metadata || {}) };
  const userdata = { ...(payload?.userdata || {}) };

  meta.service_type = 'express';
  meta.questionnaire_session_id = questionnaireSessionId;
  meta.submission_path = 'server_fallback';
  meta.browser_create_failed = true;
  meta.primary_failure_kind = primaryError?.failureKind || null;

  return { metadata: meta, userdata };
}

function mapExpressPayloadToFormSubmissionRecord(payload, questionnaireSessionId, submitAttemptId) {
  const meta = payload?.metadata || {};
  const ud = payload?.userdata || {};

  let companyGoals = ud.company_goals ?? meta.company_goals;
  if (Array.isArray(companyGoals)) {
    // fine
  } else if (companyGoals && typeof companyGoals === 'string') {
    companyGoals = [companyGoals];
  } else {
    companyGoals = [];
  }

  const geoMeta = sanitizeGeoMeta(ud.geographic_area_meta ?? meta.geographic_area_meta);

  const record = {
    business_name:            ud.business_name        ?? meta.business_name        ?? null,
    business_domain:          ud.business_domain      ?? meta.businessDomain       ?? meta.business_domain ?? null,
    submission_datetime:      meta.submission_datetime                              ?? nowIso(),
    service_type:             'express',
    it_company_type:          ud.it_company_type       ?? meta.it_company_type      ?? [],
    it_company_type_other:    ud.it_company_type_other ?? meta.it_company_type_other ?? null,
    service_offerings:        ud.service_offerings     ?? meta.service_offerings    ?? [],
    service_offerings_other:  ud.service_offerings_other ?? meta.service_offerings_other ?? null,
    differentiation:          ud.differentiation       ?? meta.differentiation      ?? null,
    geographic_areas:         ud.geographic_areas      ?? meta.geographic_areas     ?? null,
    pricing_packaging:        ud.pricing_packaging     ?? meta.pricing_packaging    ?? null,
    pricing_packaging_other:  ud.pricing_packaging_other ?? meta.pricing_packaging_other ?? null,
    company_goals:            companyGoals,
    company_goals_other:      ud.company_goals_other   ?? meta.company_goals_other  ?? null,
    brand_tone:               ud.brand_tone            ?? meta.brand_tone           ?? null,
    brand_tone_other:         ud.brand_tone_other      ?? meta.brand_tone_other     ?? null,
    target_industries:        ud.target_industries     ?? meta.target_industries    ?? [],
    target_industries_other:  ud.target_industries_other ?? meta.target_industries_other ?? null,
    client_size:              ud.client_size           ?? meta.client_size          ?? null,
    client_challenges:        ud.client_challenges     ?? meta.client_challenges    ?? [],
    client_challenges_other:  ud.client_challenges_other ?? meta.client_challenges_other ?? null,
    client_outcomes:          ud.client_outcomes       ?? meta.client_outcomes      ?? [],
    client_outcomes_other:    ud.client_outcomes_other ?? meta.client_outcomes_other ?? null,
    ideal_client:             ud.ideal_client          ?? meta.ideal_client         ?? null,
    questionnaire_session_id: questionnaireSessionId   ?? meta.questionnaire_session_id ?? '',
    submit_attempt_id:        submitAttemptId          ?? meta.submit_attempt_id    ?? '',
    zapier_delivery_status:   'not_attempted',
    zapier_sent:              false,
    zapier_sent_at:           '',
    zapier_error_json:        '',
    zapier_attempt_count:     0,
  };

  if (geoMeta) record.geographic_area_meta = geoMeta;

  return record;
}

async function getIntakeBySession(base44, questionnaireSessionId) {
  const results = await base44.asServiceRole.entities.FormSubmissionIntake.filter(
    { questionnaire_session_id: questionnaireSessionId },
    '-created_date',
    1
  );
  return results?.[0] || null;
}

async function upsertIntake(base44, questionnaireSessionId, nextData) {
  const existing = await getIntakeBySession(base44, questionnaireSessionId);
  if (existing) {
    return await base44.asServiceRole.entities.FormSubmissionIntake.update(existing.id, nextData);
  }
  return await base44.asServiceRole.entities.FormSubmissionIntake.create({
    questionnaire_session_id: questionnaireSessionId,
    ...nextData,
  });
}

function buildIntakePayload({
  status, intakeReason, businessName, businessDomain, userEmail, userId,
  submitAttemptId, primaryError, fallbackError, transformedPayload,
  rawResponses, diagnostics, source, createdAtClient, linkedSubmissionId,
}) {
  return {
    status,
    intake_reason:            intakeReason             || null,
    business_name:            truncate(businessName)   || null,
    business_domain:          truncate(businessDomain) || null,
    user_email:               truncate(userEmail)      || null,
    user_id:                  truncate(userId)         || null,
    submit_attempt_id:        truncate(submitAttemptId) || null,
    primary_failure_kind:     primaryError?.failureKind || classifyError(primaryError) || null,
    fallback_failure_kind:    fallbackError ? classifyError(fallbackError) : null,
    primary_error_json:       primaryError  ? safeJsonStringify(primaryError)  : null,
    fallback_error_json:      fallbackError ? safeJsonStringify(fallbackError) : null,
    transformed_payload_json: transformedPayload ? safeJsonStringify(transformedPayload) : null,
    raw_responses_json:       rawResponses  ? safeJsonStringify(rawResponses)  : null,
    diagnostics_json:         diagnostics   ? safeJsonStringify(diagnostics)   : null,
    source:                   source        || 'submitExpressQuestionnaireFallback',
    created_at_client:        createdAtClient || null,
    created_at_server:        nowIso(),
    linked_submission_id:     linkedSubmissionId || null,
    zapier_sent:              false,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return Response.json({ success: false, error: { message: 'Method not allowed' } }, { status: 405, headers: corsHeaders });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: { message: 'Invalid JSON body' } }, { status: 400, headers: corsHeaders });
  }

  try {
    const base44 = createClientFromRequest(req);

    const {
      transformedPayload,
      rawResponses,
      responseSnapshot,
      questionnaireSessionId,
      transformFailed,
      validationFailed,
      transformError,
      validationError,
      primaryError,
      submitContext,
      diagnostics,
    } = body;

    // Resolve submit attempt ID from multiple sources
    const submitAttemptId =
      transformedPayload?.metadata?.submit_attempt_id ||
      body?.submitAttemptId ||
      submitContext?.submitAttemptId ||
      submitContext?.submit_attempt_id ||
      null;

    // Session ID is required
    if (!questionnaireSessionId) {
      return Response.json({
        success: false, received: false, usedFallback: true,
        error: { message: 'Missing questionnaire session' },
      }, { status: 400, headers: corsHeaders });
    }

    // Resolve business identity
    const businessName =
      transformedPayload?.metadata?.business_name ||
      transformedPayload?.userdata?.business_name ||
      submitContext?.businessName ||
      submitContext?.business_name ||
      null;

    const businessDomain =
      transformedPayload?.metadata?.businessDomain ||
      transformedPayload?.metadata?.business_domain ||
      submitContext?.businessDomain ||
      submitContext?.business_domain ||
      submitContext?.domain ||
      null;

    const userEmail =
      transformedPayload?.metadata?.user_email ||
      submitContext?.userEmail ||
      submitContext?.user_email ||
      null;

    const userId =
      transformedPayload?.metadata?.user_id ||
      submitContext?.userId ||
      submitContext?.user_id ||
      null;

    const createdAtClient =
      submitContext?.createdAt ||
      submitContext?.created_at_client ||
      null;

    const source =
      submitContext?.source ||
      'questionnaire_submit_fallback';

    // If payload is invalid/missing → intake only
    const hasValidPayload = !transformFailed && !validationFailed &&
      transformedPayload &&
      transformedPayload.metadata &&
      transformedPayload.userdata;

    if (!hasValidPayload) {
      const intakeReason = transformFailed
        ? 'payload_transform_failed'
        : validationFailed
          ? 'payload_validation_failed'
          : 'form_submission_create_failed';

      const intakeData = buildIntakePayload({
        status: 'auto_repair_pending',
        intakeReason,
        businessName,
        businessDomain,
        userEmail,
        userId,
        submitAttemptId,
        primaryError: primaryError || transformError || validationError,
        transformedPayload,
        rawResponses: rawResponses || responseSnapshot,
        diagnostics,
        source,
        createdAtClient,
      });

      const intake = await upsertIntake(base44, questionnaireSessionId, intakeData);

      return Response.json({
        success: true, received: true, submissionCreated: false,
        intakeId: intake?.id || null, usedFallback: true, zapierSent: false,
      }, { headers: corsHeaders });
    }

    // Idempotency: check for existing submission by session id
    let existingSubmissionId = null;
    try {
      const existing = await base44.asServiceRole.entities.FormSubmission.filter(
        { questionnaire_session_id: questionnaireSessionId }, '-created_date', 1
      );
      if (existing && existing.length > 0) {
        existingSubmissionId = existing[0].id;
      }
    } catch {
      // filter may not be supported - continue
    }

    // Also check by submit_attempt_id if available
    if (!existingSubmissionId && submitAttemptId) {
      try {
        const existingByAttempt = await base44.asServiceRole.entities.FormSubmission.filter(
          { submit_attempt_id: submitAttemptId }, '-created_date', 1
        );
        if (existingByAttempt && existingByAttempt.length > 0) {
          existingSubmissionId = existingByAttempt[0].id;
        }
      } catch {
        // filter may not be supported - continue
      }
    }

    if (existingSubmissionId) {
      // Already submitted - upsert intake and return idempotent success
      const intakeData = buildIntakePayload({
        status: 'submitted',
        intakeReason: 'already_submitted_deduped',
        businessName, businessDomain, userEmail, userId, submitAttemptId,
        primaryError,
        transformedPayload,
        rawResponses: rawResponses || responseSnapshot,
        diagnostics, source, createdAtClient,
        linkedSubmissionId: existingSubmissionId,
      });
      const intake = await upsertIntake(base44, questionnaireSessionId, intakeData);

      return Response.json({
        success: true, received: true, alreadySubmitted: true,
        submissionCreated: false, submissionId: existingSubmissionId,
        intakeId: intake?.id || null, usedFallback: true, zapierSent: false,
      }, { headers: corsHeaders });
    }

    // Attempt FormSubmission create
    const normalized = normalizePayload(transformedPayload, questionnaireSessionId, primaryError);
    const record = mapExpressPayloadToFormSubmissionRecord(normalized, questionnaireSessionId, submitAttemptId);

    let submission = null;
    let submissionError = null;

    try {
      submission = await base44.asServiceRole.entities.FormSubmission.create(record);
    } catch (err) {
      submissionError = err;
    }

    if (submission && !submissionError) {
      const submissionId = submission?.id || null;

      const intakeData = buildIntakePayload({
        status: 'submitted',
        intakeReason: 'server_fallback_submission_created',
        businessName, businessDomain, userEmail, userId, submitAttemptId,
        primaryError,
        transformedPayload: normalized,
        rawResponses: rawResponses || responseSnapshot,
        diagnostics, source, createdAtClient,
        linkedSubmissionId: submissionId,
      });

      const intake = await upsertIntake(base44, questionnaireSessionId, intakeData);

      return Response.json({
        success: true, received: true, submissionCreated: true,
        submissionId, submission, intakeId: intake?.id || null,
        usedFallback: true, zapierSent: false,
      }, { headers: corsHeaders });
    }

    // FormSubmission create failed → intake only, mark for auto repair in 10 minutes
    const intakeData = buildIntakePayload({
      status: 'auto_repair_pending',
      intakeReason: 'form_submission_create_failed',
      businessName, businessDomain, userEmail, userId, submitAttemptId,
      primaryError,
      fallbackError: submissionError,
      transformedPayload: normalized,
      rawResponses: rawResponses || responseSnapshot,
      diagnostics, source, createdAtClient,
    });

    const intake = await upsertIntake(base44, questionnaireSessionId, intakeData);

    return Response.json({
      success: true, received: true, submissionCreated: false,
      intakeId: intake?.id || null, usedFallback: true, zapierSent: false,
    }, { headers: corsHeaders });

  } catch (error) {
    return Response.json({
      success: false, received: false, usedFallback: true,
      error: { message: error.message },
    }, { status: 500, headers: corsHeaders });
  }
});