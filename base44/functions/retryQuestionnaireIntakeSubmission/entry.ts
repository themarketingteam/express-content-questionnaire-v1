import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const parsePayload = (value) => {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
};

const safeError = (error) => {
  try {
    return {
      message: error?.message || String(error),
      name: error?.name || 'Error',
      stack: error?.stack || null,
    };
  } catch {
    return { message: String(error) };
  }
};

const incrementRetryCount = (value) => {
  if (typeof value === 'number' && !isNaN(value)) return value + 1;
  return 1;
};

const nowIso = () => new Date().toISOString();

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

const mapExpressPayloadToFormSubmissionRecord = (payload) => {
  const { metadata, userdata } = payload;
  const normalizedMetadata = { ...metadata, service_type: 'express' };

  const geoMeta = sanitizeGeoMeta(userdata.geographic_area_meta);

  const cleanDomain = (domain) => {
    if (!domain) return '';
    return String(domain).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').trim();
  };

  const record = {
    business_name: normalizedMetadata.business_name || '',
    business_domain: cleanDomain(normalizedMetadata.businessDomain || normalizedMetadata.business_domain || userdata.business_domain || ''),
    submission_datetime: normalizedMetadata.submission_datetime || new Date().toISOString(),
    service_type: 'express',
    it_company_type: Array.isArray(userdata.it_company_type) ? userdata.it_company_type : [],
    it_company_type_other: userdata.it_company_type_other || '',
    service_offerings: Array.isArray(userdata.service_offerings) ? userdata.service_offerings : [],
    service_offerings_other: userdata.service_offerings_other || '',
    differentiation: userdata.differentiation || '',
    geographic_areas: userdata.geographic_areas || '',
    pricing_packaging: userdata.pricing_packaging || '',
    pricing_packaging_other: userdata.pricing_packaging_other || '',
    company_goals: Array.isArray(userdata.company_goals) ? userdata.company_goals : (userdata.company_goals ? [userdata.company_goals] : []),
    company_goals_other: userdata.company_goals_other || '',
    brand_tone: userdata.brand_tone || '',
    brand_tone_other: userdata.brand_tone_other || '',
    target_industries: Array.isArray(userdata.target_industries) ? userdata.target_industries : [],
    target_industries_other: userdata.target_industries_other || '',
    client_size: userdata.client_size || '',
    client_challenges: Array.isArray(userdata.client_challenges) ? userdata.client_challenges : [],
    client_challenges_other: userdata.client_challenges_other || '',
    client_outcomes: Array.isArray(userdata.client_outcomes) ? userdata.client_outcomes : [],
    client_outcomes_other: userdata.client_outcomes_other || '',
    ideal_client: userdata.ideal_client || '',
    questionnaire_session_id: normalizedMetadata.questionnaire_session_id || '',
    submit_attempt_id: normalizedMetadata.submit_attempt_id || '',
    zapier_delivery_status: 'not_attempted',
    zapier_sent: false,
    zapier_sent_at: '',
    zapier_error_json: '',
    zapier_attempt_count: 0,
    resubmit_count: 0,
  };

  if (geoMeta) record.geographic_area_meta = geoMeta;

  return record;
};

const getNewestRecord = (records) => {
  if (!records || records.length === 0) return null;
  if (records.length === 1) return records[0];
  return records.reduce((newest, current) => {
    const newestTime = new Date(newest.last_retry_at || newest.created_at_server || newest.created_date || '1970-01-01').getTime();
    const currentTime = new Date(current.last_retry_at || current.created_at_server || current.created_date || '1970-01-01').getTime();
    return currentTime > newestTime ? current : newest;
  });
};

// Domain is optional - only require metadata, userdata, and business_name
const hasRequiredExpressPayloadFields = (payload) => {
  if (!payload || typeof payload !== 'object') return false;
  if (!payload.metadata || typeof payload.metadata !== 'object') return false;
  if (!payload.userdata || typeof payload.userdata !== 'object' || Array.isArray(payload.userdata)) return false;
  if (!payload.metadata.business_name || typeof payload.metadata.business_name !== 'string') return false;
  return true;
};

// ─── Zapier delivery ──────────────────────────────────────────────────────────

function buildZapierPayload(payload) {
  const { metadata = {}, userdata = {} } = payload || {};
  const cleanDomain = (domain) => {
    if (!domain) return "";
    return String(domain).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').trim();
  };
  const cleanedDomain = cleanDomain(metadata.businessDomain || metadata.business_domain || "");

  return {
    metadata: {
      business_name: metadata.business_name || "",
      businessDomain: cleanedDomain,
      business_domain: cleanedDomain,
      submission_datetime: metadata.submission_datetime || new Date().toISOString(),
      service_type: 'express',
      questionnaire_session_id: metadata.questionnaire_session_id || "",
      submit_attempt_id: metadata.submit_attempt_id || "",
      resubmitted_at: nowIso(),
    },
    userdata: { ...userdata },
  };
}

async function deliverToZapier(payload) {
  const webhookUrl = Deno.env.get('EXPRESS_ZAPIER_WEBHOOK_URL')?.trim();
  if (!webhookUrl) {
    return { ok: false, error: 'EXPRESS_ZAPIER_WEBHOOK_URL not configured' };
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const zapierRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildZapierPayload(payload)),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (zapierRes.ok) return { ok: true };
    const text = await zapierRes.text().catch(() => '');
    return { ok: false, error: `Zapier returned ${zapierRes.status}: ${text}` };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === 'AbortError' ? 'Zapier delivery timed out' : (err?.message || 'Zapier delivery failed'),
    };
  }
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

    // Intentionally public: this action is part of the password-free recovery page.

    const { intakeId, questionnaireSessionId, forceRetry = false, payload: providedPayload } = body;

    // If a payload is provided directly (e.g. from a FormDraft), use it as the source of truth.
    // Otherwise, resolve the intake record and use its transformed_payload_json.
    const hasProvidedPayload = providedPayload !== undefined && providedPayload !== null;

    if (!intakeId && !questionnaireSessionId && !hasProvidedPayload) {
      return Response.json(
        { success: false, error: { message: 'intakeId, questionnaireSessionId, or payload is required' } },
        { status: 400, headers: corsHeaders }
      );
    }

    let intakeRecord = null;
    if (intakeId) {
      const records = await base44.asServiceRole.entities.FormSubmissionIntake.filter({ id: intakeId });
      intakeRecord = records && records.length > 0 ? records[0] : null;
    } else if (questionnaireSessionId) {
      const records = await base44.asServiceRole.entities.FormSubmissionIntake.filter({
        questionnaire_session_id: questionnaireSessionId,
      });
      intakeRecord = getNewestRecord(records);
    }

    // If no payload provided, we MUST have an intake record to get the payload from
    if (!hasProvidedPayload && !intakeRecord) {
      return Response.json(
        { success: false, error: { message: 'Intake record not found' } },
        { status: 404, headers: corsHeaders }
      );
    }

    const intakeIdActual = intakeRecord ? intakeRecord.id : null;

    // ── Non-force retry: if intake already linked, return early (dedup) ──
    // This path is for the "Retry Submission" button on intake recovery when
    // the intake has NOT been linked yet. If already linked, admin should use
    // "Force Retry" which always delivers to Zapier.
    if (!forceRetry && intakeRecord && intakeRecord.linked_submission_id) {
      return Response.json({
        success: true, alreadySubmitted: true,
        linkedSubmissionId: intakeRecord.linked_submission_id,
        intakeId: intakeIdActual,
        message: 'Already linked. Use Force Retry to re-send to Zapier.',
      }, { headers: corsHeaders });
    }

    // Use provided payload if available; otherwise fall back to intake record's payload
    const transformed = hasProvidedPayload
      ? parsePayload(providedPayload)
      : parsePayload(intakeRecord.transformed_payload_json);
    if (!transformed) {
      const errorPayload = { message: 'Malformed transformed payload JSON' };
      if (intakeIdActual) {
        await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
          status: 'retry_failed',
          retry_error_json: JSON.stringify(errorPayload),
          last_retry_at: nowIso(),
          retry_count: incrementRetryCount(intakeRecord.retry_count),
        });
      }
      return Response.json(
        { success: false, error: errorPayload, intakeId: intakeIdActual },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!hasRequiredExpressPayloadFields(transformed)) {
      const errorPayload = {
        message: 'Missing required Express payload fields',
        details: {
          hasMetadata: !!transformed.metadata,
          hasUserdata: !!transformed.userdata && !Array.isArray(transformed.userdata),
          hasBusinessName: !!transformed.metadata?.business_name,
        },
      };
      if (intakeIdActual) {
        await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
          status: 'retry_failed',
          retry_error_json: JSON.stringify(errorPayload),
          last_retry_at: nowIso(),
          retry_count: incrementRetryCount(intakeRecord.retry_count),
        });
      }
      return Response.json(
        { success: false, error: errorPayload, intakeId: intakeIdActual },
        { status: 400, headers: corsHeaders }
      );
    }

    // Resolve session id from intake or payload
    const sessionId = intakeRecord?.questionnaire_session_id || transformed.metadata?.questionnaire_session_id || questionnaireSessionId || null;

    // Resolve submit_attempt_id
    const submitAttemptId =
      intakeRecord?.submit_attempt_id ||
      transformed.metadata?.submit_attempt_id ||
      null;

    // Helper: safely update the intake record if it exists
    const updateIntake = async (data) => {
      if (!intakeIdActual) return;
      try {
        await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, data);
      } catch { /* best effort */ }
    };
    const retryCount = () => incrementRetryCount(intakeRecord?.retry_count);

    // Normalize payload
    transformed.metadata.service_type = 'express';
    if (sessionId) transformed.metadata.questionnaire_session_id = sessionId;
    if (submitAttemptId) transformed.metadata.submit_attempt_id = submitAttemptId;

    // ── Non-force retry: dedup by session_id or submit_attempt_id ──
    // If a FormSubmission already exists, return alreadySubmitted WITHOUT
    // delivering to Zapier (use Force Retry for that).
    if (!forceRetry) {
      if (sessionId) {
        try {
          const existingSubmissions = await base44.asServiceRole.entities.FormSubmission.filter(
            { questionnaire_session_id: sessionId }, '-created_date', 1
          );
          if (existingSubmissions && existingSubmissions.length > 0) {
            const existingId = existingSubmissions[0].id;
            await updateIntake({
              status: 'retry_success',
              linked_submission_id: existingId,
              retry_error_json: '',
              last_retry_at: nowIso(),
              retry_count: retryCount(),
            });
            return Response.json({
              success: true, alreadySubmitted: true,
              linkedSubmissionId: existingId,
              intakeId: intakeIdActual,
              message: 'Already linked. Use Force Retry to re-send to Zapier.',
            }, { headers: corsHeaders });
          }
        } catch { /* skip */ }
      }

      if (submitAttemptId) {
        try {
          const existingByAttempt = await base44.asServiceRole.entities.FormSubmission.filter(
            { submit_attempt_id: submitAttemptId }, '-created_date', 1
          );
          if (existingByAttempt && existingByAttempt.length > 0) {
            const existingId = existingByAttempt[0].id;
            await updateIntake({
              status: 'retry_success',
              linked_submission_id: existingId,
              retry_error_json: '',
              last_retry_at: nowIso(),
              retry_count: retryCount(),
            });
            return Response.json({
              success: true, alreadySubmitted: true,
              linkedSubmissionId: existingId,
              intakeId: intakeIdActual,
              message: 'Already linked. Use Force Retry to re-send to Zapier.',
            }, { headers: corsHeaders });
          }
        } catch { /* skip */ }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // At this point:
    //   - forceRetry=true: ALWAYS proceed to create/update + Zapier delivery
    //   - forceRetry=false: no existing submission found, so create one
    // ═══════════════════════════════════════════════════════════════════════════

    let submissionId = null;
    let existingSubmission = null;
    let isExistingSubmission = false;

    // For forceRetry: check if a FormSubmission already exists for this session
    if (forceRetry && sessionId) {
      try {
        const existing = await base44.asServiceRole.entities.FormSubmission.filter(
          { questionnaire_session_id: sessionId }, '-created_date', 1
        );
        if (existing && existing.length > 0) {
          existingSubmission = existing[0];
          submissionId = existing[0].id;
          isExistingSubmission = true;
        }
      } catch { /* continue to create */ }
    }

    if (isExistingSubmission) {
      // ── Update existing FormSubmission: increment resubmit_count ──
      const newResubmitCount = (existingSubmission.resubmit_count || 0) + 1;
      try {
        await base44.asServiceRole.entities.FormSubmission.update(submissionId, {
          resubmit_count: newResubmitCount,
        });
      } catch { /* best effort */ }
    } else {
      // ── Create new FormSubmission ──
      const submissionRecord = mapExpressPayloadToFormSubmissionRecord(transformed);
      submissionRecord.resubmit_count = 1;

      try {
        const created = await base44.asServiceRole.entities.FormSubmission.create(submissionRecord);
        submissionId = created.id;
      } catch (createError) {
        const errorPayload = safeError(createError);
        await updateIntake({
          status: 'retry_failed',
          retry_error_json: JSON.stringify(errorPayload),
          last_retry_at: nowIso(),
          retry_count: retryCount(),
        });
        return Response.json(
          { success: false, error: errorPayload, intakeId: intakeIdActual },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── ALWAYS deliver to Zapier (every retry sends the payload) ──
    const zapierResult = await deliverToZapier(transformed);
    const now = nowIso();
    const currentZapierCount = (existingSubmission?.zapier_attempt_count || 0) + 1;
    const currentResubmitCount = isExistingSubmission
      ? (existingSubmission.resubmit_count || 0) + 1
      : 1;

    try {
      await base44.asServiceRole.entities.FormSubmission.update(submissionId, zapierResult.ok
        ? {
            zapier_delivery_status: 'sent', zapier_sent: true, zapier_sent_at: now,
            zapier_error_json: '', zapier_attempt_count: currentZapierCount,
          }
        : {
            zapier_delivery_status: 'failed', zapier_sent: false,
            zapier_error_json: JSON.stringify({ message: zapierResult.error }),
            zapier_attempt_count: currentZapierCount,
          }
      );
    } catch { /* best effort */ }

    // Update intake record
    await updateIntake({
      status: 'retry_success',
      linked_submission_id: submissionId,
      retry_error_json: '',
      last_retry_at: now,
      retry_count: retryCount(),
      zapier_sent: zapierResult.ok,
      zapier_error_json: zapierResult.ok ? '' : JSON.stringify({ message: zapierResult.error }),
    });

    return Response.json({
      success: true,
      alreadySubmitted: isExistingSubmission,
      linkedSubmissionId: submissionId,
      intakeId: intakeIdActual,
      zapierSent: zapierResult.ok,
      zapierError: zapierResult.ok ? null : zapierResult.error,
      resubmitCount: currentResubmitCount,
      zapierAttemptCount: currentZapierCount,
    }, { headers: corsHeaders });

  } catch (error) {
    return Response.json(
      { success: false, error: safeError(error) },
      { status: 500, headers: corsHeaders }
    );
  }
});
