import { requireExpressRecoveryIntegrity, requireExpressRecoveryReceipt } from '../../shared/expressSubmissionIntegrity.js';
import { organizedPayloadRecordFields, validateExpressOrganizerLimits, validateOrganizedSubmission } from '../../shared/pageOrganizerContract.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { secrets } from 'base44:runtime';
import { authorizeRecoveryRequest, safeRecoveryLog } from '../../shared/recoveryAuthorization.ts';
import { withSubmissionSessionLease } from '../../shared/submissionCoordinator.ts';

// ─── CORS ─────────────────────────────────────────────────────────────────────

// Legacy recovery JSON has optional, historically inconsistent fields. Validate
// its wire shape and raw-answer preservation before using it for submission.
type JsonRecord = Record<string, any>;
type BackendClient = ReturnType<typeof createClientFromRequest>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const parsePayload = (value: unknown): any => {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
};

const safeError = (error: unknown) => {
  try {
    return {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Error',
      stack: error instanceof Error ? error.stack || null : null,
    };
  } catch {
    return { message: String(error) };
  }
};

const incrementRetryCount = (value: unknown) => {
  if (typeof value === 'number' && !isNaN(value)) return value + 1;
  return 1;
};

const nowIso = () => new Date().toISOString();

// Sanitize geographic_area_meta: remove null lat/lon/place_id
function sanitizeGeoMeta(raw: JsonRecord | null | undefined) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: { label?: string; lat?: number; lon?: number; place_id?: string; source?: string } = {};
  if (typeof raw.label === 'string' && raw.label.trim()) out.label = raw.label.trim();
  if (typeof raw.lat === 'number' && isFinite(raw.lat)) out.lat = raw.lat;
  if (typeof raw.lon === 'number' && isFinite(raw.lon)) out.lon = raw.lon;
  if (raw.place_id && typeof raw.place_id === 'string' && raw.place_id.trim()) out.place_id = raw.place_id.trim();
  if (typeof raw.source === 'string' && raw.source.trim()) out.source = raw.source.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

const mapExpressPayloadToFormSubmissionRecord = (payload: JsonRecord, rawResponses: unknown): JsonRecord => {
  const { metadata, userdata } = payload;
  const normalizedMetadata = { ...metadata, service_type: 'express' };

  const geoMeta = sanitizeGeoMeta(userdata.geographic_area_meta);

  const cleanDomain = (domain: unknown) => {
    if (!domain) return '';
    return String(domain).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').trim();
  };

  const record: JsonRecord = {
    ...(payload?.metadata?.questionnaire_payload_version !== undefined ? organizedPayloadRecordFields(payload) : {}),
    business_name: normalizedMetadata.business_name || '',
    business_domain: cleanDomain(normalizedMetadata.businessDomain || normalizedMetadata.business_domain || userdata.business_domain || ''),
    user_email: normalizedMetadata.user_email || userdata.user_email || '',
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
    raw_responses_json: typeof rawResponses === 'string'
      ? rawResponses
      : JSON.stringify(rawResponses || {}),
    transformed_payload_json: JSON.stringify(payload || {}),
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

const getNewestRecord = (records: JsonRecord[]) => {
  if (!records || records.length === 0) return null;
  if (records.length === 1) return records[0];
  return records.reduce((newest, current) => {
    const newestTime = new Date(newest.last_retry_at || newest.created_at_server || newest.created_date || '1970-01-01').getTime();
    const currentTime = new Date(current.last_retry_at || current.created_at_server || current.created_date || '1970-01-01').getTime();
    return currentTime > newestTime ? current : newest;
  });
};

// Domain is optional - only require metadata, userdata, and business_name
const hasRequiredExpressPayloadFields = (payload: JsonRecord) => {
  if (!payload || typeof payload !== 'object') return false;
  if (!payload.metadata || typeof payload.metadata !== 'object') return false;
  if (!payload.userdata || typeof payload.userdata !== 'object' || Array.isArray(payload.userdata)) return false;
  if (!payload.metadata.business_name || typeof payload.metadata.business_name !== 'string') return false;
  return true;
};

// ─── Zapier delivery ──────────────────────────────────────────────────────────

function buildZapierPayload(payload: JsonRecord) {
  {
    const validation = validateExpressOrganizerLimits(payload);
    if (!validation.ok) throw new Error(validation.errors.join(' '));
  }
  const { metadata = {}, userdata = {} } = payload || {};
  const cleanDomain = (domain: unknown) => {
    if (!domain) return "";
    return String(domain).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').trim();
  };
  const cleanedDomain = cleanDomain(metadata.businessDomain || metadata.business_domain || "");

  return {
    metadata: {
      ...(metadata.questionnaire_payload_version !== undefined ? { questionnaire_payload_version: metadata.questionnaire_payload_version } : {}),
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

async function deliverToZapier(payload: JsonRecord) {
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
      error: (err instanceof Error && err.name === 'AbortError') ? 'Zapier delivery timed out' : ((err instanceof Error ? err.message : String(err)) || 'Zapier delivery failed'),
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
    const { intakeId, questionnaireSessionId, forceRetry = false, payload: providedPayload, recoveryGrant } = body;

    let recoverySecret = '';
    try {
      recoverySecret = secrets.get('DRAFT_RECOVERY_PASSWORD') || '';
    } catch {
      return Response.json({ success: false, error: { message: 'Draft recovery access is not configured.' } }, { status: 503, headers: corsHeaders });
    }
    const authorization = await authorizeRecoveryRequest({ base44, recoveryGrant, recoverySecret });
    if (!authorization.authorized) {
      return Response.json({ success: false, error: { message: authorization.error } }, { status: 403, headers: corsHeaders });
    }
    safeRecoveryLog({
      functionName: 'retryQuestionnaireIntakeSubmission',
      authorizationMode: authorization.mode,
      identifier: intakeId || questionnaireSessionId || providedPayload?.metadata?.questionnaire_session_id,
      deliveryStage: 'authorized',
    });

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
      const linked = await base44.asServiceRole.entities.FormSubmission.get(intakeRecord.linked_submission_id);
      requireExpressRecoveryReceipt(linked, parsePayload(linked?.transformed_payload_json), intakeRecord.raw_responses_json);
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
      : parsePayload(intakeRecord?.transformed_payload_json);
    if (!transformed) {
      const errorPayload = { message: 'Malformed transformed payload JSON' };
      if (intakeIdActual) {
        await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
          status: 'retry_failed',
          retry_error_json: JSON.stringify(errorPayload),
          last_retry_at: nowIso(),
          retry_count: incrementRetryCount(intakeRecord?.retry_count),
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
          retry_count: incrementRetryCount(intakeRecord?.retry_count),
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
    const updateIntake = async (data: JsonRecord) => {
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

    return await withSubmissionSessionLease({
      base44,
      sessionId: sessionId || `retry:${submitAttemptId || intakeIdActual || 'manual'}`,
      purpose: `submission-retry:${sessionId || submitAttemptId || intakeIdActual || 'manual'}`,
      operation: async (coordinatorDraft, lease) => {
      let currentResponses: Record<string, unknown> = {};
      try { const serializedResponses = coordinatorDraft?.responses_json; if (typeof serializedResponses === 'string') currentResponses = JSON.parse(serializedResponses); } catch { /* Legacy snapshots can be unavailable. */ }
      requireExpressRecoveryIntegrity(transformed, intakeRecord?.raw_responses_json, coordinatorDraft?.responses_json);
      if (Object.hasOwn(currentResponses, 'serviceOfferingsStructure') || Object.hasOwn(currentResponses, 'targetIndustriesStructure')) {
        const organizerGuard = validateOrganizedSubmission({ payload: transformed, responses: currentResponses });
        if (!organizerGuard.ok) throw Object.assign(new Error(organizerGuard.errors.join(' ')), { code: organizerGuard.code, status: organizerGuard.status });
      }

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
            requireExpressRecoveryReceipt(existingSubmissions[0], transformed, intakeRecord?.raw_responses_json, coordinatorDraft.responses_json);
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
        } catch (error) { if ((error as { code?: string })?.code === 'existing_submission_integrity_mismatch') throw error; throw new Error(`Submission deduplication is unavailable: ${error instanceof Error ? error.message : "lookup failed"}`); }
      }

      if (submitAttemptId) {
        try {
          const existingByAttempt = await base44.asServiceRole.entities.FormSubmission.filter(
            { submit_attempt_id: submitAttemptId }, '-created_date', 1
          );
          if (existingByAttempt && existingByAttempt.length > 0) {
            requireExpressRecoveryReceipt(existingByAttempt[0], transformed, intakeRecord?.raw_responses_json, coordinatorDraft.responses_json);
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
        } catch (error) { if ((error as { code?: string })?.code === 'existing_submission_integrity_mismatch') throw error; throw new Error(`Submission deduplication is unavailable: ${error instanceof Error ? error.message : "lookup failed"}`); }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // At this point:
    //   - forceRetry=true: ALWAYS proceed to create/update + Zapier delivery
    //   - forceRetry=false: no existing submission found, so create one
    // ═══════════════════════════════════════════════════════════════════════════

    let submissionId = null;
    let existingSubmission: JsonRecord | null = null;
    let isExistingSubmission = false;

    // For forceRetry: check if a FormSubmission already exists for this session
    if (forceRetry && sessionId) {
      try {
        const existing = await base44.asServiceRole.entities.FormSubmission.filter(
          { questionnaire_session_id: sessionId }, '-created_date', 1
        );
        if (existing && existing.length > 0) {
          requireExpressRecoveryReceipt(existing[0], transformed, intakeRecord?.raw_responses_json, coordinatorDraft.responses_json);
          existingSubmission = existing[0];
          submissionId = existing[0].id;
          isExistingSubmission = true;
        }
      } catch (error) { if ((error as { code?: string })?.code === 'existing_submission_integrity_mismatch') throw error; throw new Error(`Submission deduplication is unavailable: ${error instanceof Error ? error.message : "lookup failed"}`); }
    }

    if (forceRetry && !existingSubmission && submitAttemptId) {
      const byAttempt = await base44.asServiceRole.entities.FormSubmission.filter({ submit_attempt_id: submitAttemptId }, '-created_date', 1);
      if (byAttempt?.[0]) {
        requireExpressRecoveryReceipt(byAttempt[0], transformed, intakeRecord?.raw_responses_json, coordinatorDraft.responses_json);
        existingSubmission = byAttempt[0];
        submissionId = byAttempt[0].id;
        isExistingSubmission = true;
      }
    }
    if (isExistingSubmission && existingSubmission) {
      // ── Update existing FormSubmission: increment resubmit_count ──
      const newResubmitCount = (existingSubmission?.resubmit_count || 0) + 1;
      try {
        await base44.asServiceRole.entities.FormSubmission.update(submissionId, {
          resubmit_count: newResubmitCount,
        });
      } catch { /* best effort */ }
    } else {
      // ── Create new FormSubmission ──
      const submissionRecord = mapExpressPayloadToFormSubmissionRecord(
        transformed,
        intakeRecord?.raw_responses_json || providedPayload,
      );
      submissionRecord.resubmit_count = 1;
      const linkedDrafts = sessionId
        ? await base44.asServiceRole.entities.FormDraft.filter({ session_id: sessionId }, '-last_saved_at', 2).catch(() => [])
        : [];
      if (linkedDrafts.length === 1) submissionRecord.linked_draft_id = linkedDrafts[0].id;
      submissionRecord.retention_policy = 'indefinite_until_manual_deletion';
      submissionRecord.retention_policy_version = '2026-08-18';
      submissionRecord.retention_protected_at = nowIso();

      await lease.assertOwned();
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
    await lease.assertOwned();
    const zapierResult = await deliverToZapier(transformed);
    const now = nowIso();
    const currentZapierCount = (existingSubmission?.zapier_attempt_count || 0) + 1;
    const currentResubmitCount = isExistingSubmission
      ? (existingSubmission?.resubmit_count || 0) + 1
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
      },
    });

  } catch (error) {
    const organizerError = error as { code?: string; status?: number; message?: string };
    if (organizerError?.code === 'existing_submission_integrity_mismatch') {
      return Response.json({ success: false, ok: false, code: organizerError.code, error: organizerError.message }, { status: 409, headers: corsHeaders });
    }
    if (organizerError?.code === 'payload_integrity_mismatch') {
      return Response.json({ success: false, ok: false, code: organizerError.code, error: organizerError.message }, { status: 422, headers: corsHeaders });
    }
    if (organizerError?.code?.startsWith('ORGANIZER_') || organizerError?.code === 'INVALID_PAGE_STRUCTURE' || ['DRAFT_LEASE_LOST', 'DRAFT_WRITE_UNVERIFIED', 'DRAFT_SNAPSHOT_INVALID'].includes(organizerError?.code || '') || organizerError?.code === 'AMBIGUOUS_DRAFT_SESSION') {
      return Response.json({ success: false, ok: false, code: organizerError.code, error: organizerError.message || 'Page organization requires review.' }, { status: organizerError.status === 409 ? 409 : 400, headers: corsHeaders });
    }
    return Response.json(
      { success: false, error: safeError(error) },
      { status: 500, headers: corsHeaders }
    );
  }
});
