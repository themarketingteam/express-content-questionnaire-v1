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

  const record = {
    business_name: normalizedMetadata.business_name || '',
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

    let user;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json(
        { success: false, error: { message: 'Forbidden: Admin access required' } },
        { status: 403, headers: corsHeaders }
      );
    }

    const isAdmin = user?.role === 'admin';
    const isBenjamin = user?.email?.toLowerCase() === 'benjamin.hines8@gmail.com';

    if (!isAdmin && !isBenjamin) {
      return Response.json(
        { success: false, error: { message: 'Forbidden: Admin access required' } },
        { status: 403, headers: corsHeaders }
      );
    }

    const { intakeId, questionnaireSessionId, forceRetry = false } = body;

    if (!intakeId && !questionnaireSessionId) {
      return Response.json(
        { success: false, error: { message: 'intakeId or questionnaireSessionId is required' } },
        { status: 400, headers: corsHeaders }
      );
    }

    let intakeRecord;
    if (intakeId) {
      const records = await base44.asServiceRole.entities.FormSubmissionIntake.filter({ id: intakeId });
      intakeRecord = records && records.length > 0 ? records[0] : null;
    } else {
      const records = await base44.asServiceRole.entities.FormSubmissionIntake.filter({
        questionnaire_session_id: questionnaireSessionId,
      });
      intakeRecord = getNewestRecord(records);
    }

    if (!intakeRecord) {
      return Response.json(
        { success: false, error: { message: 'Intake record not found' } },
        { status: 404, headers: corsHeaders }
      );
    }

    const intakeIdActual = intakeRecord.id;

    if (intakeRecord.linked_submission_id && !forceRetry) {
      return Response.json({
        success: true, alreadySubmitted: true,
        linkedSubmissionId: intakeRecord.linked_submission_id,
        intakeId: intakeIdActual,
      }, { headers: corsHeaders });
    }

    const transformed = parsePayload(intakeRecord.transformed_payload_json);
    if (!transformed) {
      const errorPayload = { message: 'Malformed transformed payload JSON' };
      await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(errorPayload),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intakeRecord.retry_count),
      });
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
      await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(errorPayload),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intakeRecord.retry_count),
      });
      return Response.json(
        { success: false, error: errorPayload, intakeId: intakeIdActual },
        { status: 400, headers: corsHeaders }
      );
    }

    // Resolve session id from intake or payload
    const sessionId = intakeRecord.questionnaire_session_id || transformed.metadata?.questionnaire_session_id || null;

    // Resolve submit_attempt_id
    const submitAttemptId =
      intakeRecord.submit_attempt_id ||
      transformed.metadata?.submit_attempt_id ||
      null;

    // Dedupe by session id
    if (sessionId && !forceRetry) {
      try {
        const existingSubmissions = await base44.asServiceRole.entities.FormSubmission.filter(
          { questionnaire_session_id: sessionId },
          '-created_date', 1
        );
        if (existingSubmissions && existingSubmissions.length > 0) {
          const existingId = existingSubmissions[0].id;
          await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
            status: 'retry_success',
            linked_submission_id: existingId,
            retry_error_json: '',
            last_retry_at: new Date().toISOString(),
            retry_count: incrementRetryCount(intakeRecord.retry_count),
          });
          return Response.json({
            success: true, alreadySubmitted: true,
            linkedSubmissionId: existingId,
            intakeId: intakeIdActual,
          }, { headers: corsHeaders });
        }
      } catch {
        // Filter may not be supported - skip safely
      }
    }

    // Also dedupe by submit_attempt_id
    if (submitAttemptId && !forceRetry) {
      try {
        const existingByAttempt = await base44.asServiceRole.entities.FormSubmission.filter(
          { submit_attempt_id: submitAttemptId }, '-created_date', 1
        );
        if (existingByAttempt && existingByAttempt.length > 0) {
          const existingId = existingByAttempt[0].id;
          await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
            status: 'retry_success',
            linked_submission_id: existingId,
            retry_error_json: '',
            last_retry_at: new Date().toISOString(),
            retry_count: incrementRetryCount(intakeRecord.retry_count),
          });
          return Response.json({
            success: true, alreadySubmitted: true,
            linkedSubmissionId: existingId,
            intakeId: intakeIdActual,
          }, { headers: corsHeaders });
        }
      } catch {
        // Filter may not be supported - skip safely
      }
    }

    // With forceRetry, prefer linking to existing submission if found
    if (forceRetry && sessionId) {
      try {
        const existingSubmissions = await base44.asServiceRole.entities.FormSubmission.filter(
          { questionnaire_session_id: sessionId }, '-created_date', 1
        );
        if (existingSubmissions && existingSubmissions.length > 0) {
          const existingId = existingSubmissions[0].id;
          await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
            status: 'retry_success',
            linked_submission_id: existingId,
            retry_error_json: '',
            last_retry_at: new Date().toISOString(),
            retry_count: incrementRetryCount(intakeRecord.retry_count),
          });
          return Response.json({
            success: true, alreadySubmitted: true,
            linkedSubmissionId: existingId,
            intakeId: intakeIdActual,
          }, { headers: corsHeaders });
        }
      } catch {
        // continue to create
      }
    }

    // Normalize and create FormSubmission
    transformed.metadata.service_type = 'express';
    if (sessionId) transformed.metadata.questionnaire_session_id = sessionId;
    if (submitAttemptId) transformed.metadata.submit_attempt_id = submitAttemptId;

    const submissionRecord = mapExpressPayloadToFormSubmissionRecord(transformed);

    let createdSubmission;
    try {
      createdSubmission = await base44.asServiceRole.entities.FormSubmission.create(submissionRecord);
    } catch (createError) {
      const errorPayload = safeError(createError);
      await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(errorPayload),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intakeRecord.retry_count),
      });
      return Response.json(
        { success: false, error: errorPayload, intakeId: intakeIdActual },
        { status: 500, headers: corsHeaders }
      );
    }

    await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
      status: 'retry_success',
      linked_submission_id: createdSubmission.id,
      retry_error_json: '',
      last_retry_at: new Date().toISOString(),
      retry_count: incrementRetryCount(intakeRecord.retry_count),
    });

    return Response.json({
      success: true,
      linkedSubmissionId: createdSubmission.id,
      intakeId: intakeIdActual,
    }, { headers: corsHeaders });

  } catch (error) {
    return Response.json(
      { success: false, error: safeError(error) },
      { status: 500, headers: corsHeaders }
    );
  }
});