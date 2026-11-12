import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { withSubmissionSessionLease } from '../../shared/submissionCoordinator.ts';
import { createQuestionnaireVersion } from '../../shared/questionnaireVersions.ts';
import { inspectExpressSubmissionIntegrity } from '../../shared/expressSubmissionIntegrity.js';

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

function normalizeIdentity(value: unknown, kind = 'text') {
  let normalized = String(value || '').trim().toLowerCase();
  if (kind === 'domain') normalized = normalized.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  return normalized.replace(/\s+/g, ' ');
}

function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result: Record<string, any>, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {} as Record<string, any>);
}

async function sha256Json(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function buildSubmissionFingerprints({ businessName, businessDomain, rawResponses }: any) {
  const identity = {
    business_name: normalizeIdentity(businessName),
    business_domain: normalizeIdentity(businessDomain, 'domain'),
  };
  return {
    identityFingerprint: await sha256Json(identity),
    submissionFingerprint: await sha256Json({ identity, raw_responses: rawResponses || {} }),
  };
}

async function existingSubmissionMatches(existing: any, incoming: any): Promise<boolean> {
  const existingIdentityFingerprint = existing.identity_fingerprint || await sha256Json({
    business_name: normalizeIdentity(existing.business_name),
    business_domain: normalizeIdentity(existing.business_domain, 'domain'),
  });
  let existingSubmissionFingerprint = existing.submission_fingerprint || '';
  if (!existingSubmissionFingerprint && existing.raw_responses_json) {
    try {
      existingSubmissionFingerprint = (await buildSubmissionFingerprints({
        businessName: existing.business_name,
        businessDomain: existing.business_domain,
        rawResponses: JSON.parse(existing.raw_responses_json),
      })).submissionFingerprint;
    } catch {
      existingSubmissionFingerprint = '';
    }
  }
  return existingIdentityFingerprint === incoming.identityFingerprint
    && existingSubmissionFingerprint === incoming.submissionFingerprint;
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

function mapExpressPayloadToFormSubmissionRecord(
  payload,
  questionnaireSessionId,
  submitAttemptId,
  rawResponseSnapshot,
) {
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
    user_email:               meta.user_email         ?? ud.user_email             ?? null,
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
    submission_fingerprint:   '',
    identity_fingerprint:     '',
    raw_responses_json:       safeJsonStringify(rawResponseSnapshot ?? {}),
    transformed_payload_json: safeJsonStringify(payload ?? {}),
    zapier_delivery_status:   'not_attempted',
    zapier_sent:              false,
    zapier_sent_at:           '',
    zapier_error_json:        '',
    zapier_attempt_count:     0,
    retention_policy:         'indefinite_until_manual_deletion',
    retention_policy_version: '2026-08-18',
    retention_protected_at:   nowIso(),
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
    retention_policy: 'indefinite_until_manual_deletion',
    retention_policy_version: '2026-08-18',
    retention_protected_at: nowIso(),
    ...nextData,
  });
}

function buildDraftSnapshot({
  businessName,
  businessDomain,
  userEmail,
  userId,
  submitAttemptId,
  transformedPayload,
  rawResponseSnapshot,
  diagnostics,
  submitContext,
}) {
  const now = nowIso();
  return {
    business_name: truncate(businessName) || '',
    domain: truncate(businessDomain) || '',
    user_email: truncate(userEmail) || '',
    user_id: truncate(userId) || '',
    submit_attempt_id: truncate(submitAttemptId) || '',
    responses_json: safeJsonStringify(rawResponseSnapshot ?? {}),
    metadata_json: safeJsonStringify(transformedPayload?.metadata ?? {}),
    userdata_json: safeJsonStringify(transformedPayload?.userdata ?? {}),
    mapped_payload_json: safeJsonStringify(transformedPayload ?? {}),
    draft_metadata_json: safeJsonStringify({ diagnostics: diagnostics ?? {}, submitContext: submitContext ?? {} }),
    last_saved_at: now,
    last_changed_at: now,
    submit_attempted_at: now,
    status: 'submitting',
  };
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

    const rawResponseSnapshot = rawResponses ?? responseSnapshot ?? {};
    const finalPayloadCandidate = !transformFailed && !validationFailed
      && transformedPayload && transformedPayload.metadata && transformedPayload.userdata;
    const payloadIntegrity = inspectExpressSubmissionIntegrity(rawResponseSnapshot, transformedPayload);
    const integrityRejected = finalPayloadCandidate && !payloadIntegrity.ok;
    const incomingFingerprints = await buildSubmissionFingerprints({
      businessName,
      businessDomain,
      rawResponses: rawResponseSnapshot,
    });
    const draftSnapshot = buildDraftSnapshot({
      businessName,
      businessDomain,
      userEmail,
      userId,
      submitAttemptId,
      transformedPayload,
      rawResponseSnapshot,
      diagnostics,
      submitContext,
    });
    return await withSubmissionSessionLease(
      {
        base44,
        sessionId: questionnaireSessionId,
        purpose: `submission:${questionnaireSessionId}:${submitAttemptId || 'session'}`,
        // A rejected payload must not seed a new coordinator with partial answers.
        initialSnapshot: integrityRejected ? {
          ...draftSnapshot,
          mapped_payload_json: '',
          userdata_json: '',
          metadata_json: '',
          status: 'submit_failed',
        } : draftSnapshot,
        operation: async (coordinatorDraft) => {
        const draftBusiness = normalizeIdentity(coordinatorDraft.business_name);
        const draftDomain = normalizeIdentity(coordinatorDraft.domain, 'domain');
        const incomingBusiness = normalizeIdentity(businessName);
        const incomingDomain = normalizeIdentity(businessDomain, 'domain');
        if ((draftBusiness && incomingBusiness && draftBusiness !== incomingBusiness)
          || (draftDomain && incomingDomain && draftDomain !== incomingDomain)) {
          return Response.json({
            success: false,
            received: false,
            usedFallback: true,
            code: 'draft_identity_conflict',
            error: { message: 'This browser draft belongs to a different client. Start a new client draft before submitting.' },
          }, { status: 409, headers: corsHeaders });
        }
        if (integrityRejected) {
          const integrityError = {
            code: 'payload_integrity_mismatch',
            failureKind: 'validation',
            message: 'The submission payload did not preserve the captured answers. Nothing was submitted. Please reload the form and try again.',
            reason: payloadIntegrity.reason,
            mismatchedFields: payloadIntegrity.mismatchedFields,
          };
          // Retain this rejected attempt separately. Do not replace a good
          // checkpoint/intake or enqueue the partial JSON for automated delivery.
          let rejectedIntakeId = null;
          try {
            const previousRejections = submitAttemptId
              ? await base44.asServiceRole.entities.FormSubmissionIntake.filter({
                questionnaire_session_id: questionnaireSessionId,
                submit_attempt_id: submitAttemptId,
                intake_reason: 'payload_integrity_mismatch',
              }, '-created_date', 1)
              : [];
            const rejectedIntake = previousRejections?.[0] || await base44.asServiceRole.entities.FormSubmissionIntake.create({
              questionnaire_session_id: questionnaireSessionId,
              ...buildIntakePayload({
                status: 'received_intake',
                intakeReason: 'payload_integrity_mismatch',
                businessName, businessDomain, userEmail, userId, submitAttemptId,
                primaryError: integrityError,
                transformedPayload,
                rawResponses: rawResponseSnapshot,
                diagnostics: { payloadIntegrity },
                source,
                createdAtClient,
              }),
              active_investigation: true,
              retention_policy: 'indefinite_until_manual_deletion',
              retention_policy_version: '2026-08-18',
              retention_protected_at: nowIso(),
            });
            rejectedIntakeId = rejectedIntake?.id || null;
          } catch {
            // Failure to retain diagnostics cannot authorize a partial submission.
            console.error(JSON.stringify({ functionName: 'submitExpressQuestionnaireFallback', stage: 'integrity_rejection_retention_failed' }));
          }
          return Response.json({
            success: false,
            received: false,
            submissionCreated: false,
            usedFallback: true,
            zapierSent: false,
            code: 'payload_integrity_mismatch',
            intakeId: rejectedIntakeId,
            error: integrityError,
          }, { status: 422, headers: corsHeaders });
        }
        // Persist the complete incoming snapshot before any validation or create
        // attempt. Anonymous and authenticated clients therefore have the same
        // server-side recovery guarantee.
        const checkpointNext = { ...coordinatorDraft, ...draftSnapshot, id: coordinatorDraft.id };
        const checkpointVersion = await createQuestionnaireVersion({
          base44,
          draft: checkpointNext,
          previous: coordinatorDraft,
          versionType: 'submission_checkpoint',
          sourceRecordId: String(coordinatorDraft.id),
          capturedAt: String(checkpointNext.submit_attempted_at || nowIso()),
          versionKey: `${coordinatorDraft.id}:submission-checkpoint:${submitAttemptId || questionnaireSessionId}`,
          mutationMetadata: {
            mutationId: `submission-checkpoint:${submitAttemptId || questionnaireSessionId}`,
            clientInstanceId: 'submission-fallback',
            clientSequence: Number(coordinatorDraft.last_confirmed_revision || 0) + 1,
            baseRevision: Number(coordinatorDraft.last_confirmed_revision || 0),
            changedKeys: Object.keys(draftSnapshot),
            deletedKeys: [],
            serverTimestamp: String(checkpointNext.submit_attempted_at || nowIso()),
          },
        });
        if (!checkpointVersion?.id) throw new Error('Submission checkpoint history was not retained.');
        const checkpointDraft = await base44.asServiceRole.entities.FormDraft.update(coordinatorDraft.id, {
          ...draftSnapshot,
          last_materialized_version_id: checkpointVersion.id,
          last_mutation_id: `submission-checkpoint:${submitAttemptId || questionnaireSessionId}`,
        });

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
        rawResponses: rawResponseSnapshot,
        diagnostics,
        source,
        createdAtClient,
      });

      const intake = await upsertIntake(base44, questionnaireSessionId, intakeData);
      const failedNext = {
        ...checkpointDraft,
        status: 'auto_repair_pending',
        submit_error: intakeData.primary_error_json || intakeReason,
      };
      const failedVersion = await createQuestionnaireVersion({
        base44, draft: failedNext, previous: checkpointDraft,
        versionType: 'failed_submission_checkpoint', sourceRecordId: String(coordinatorDraft.id),
        capturedAt: nowIso(),
        versionKey: `${coordinatorDraft.id}:failed-submission:${submitAttemptId || questionnaireSessionId}:${intakeReason}`,
      });
      if (!failedVersion?.id) throw new Error('Failed-submission history was not retained.');
      await base44.asServiceRole.entities.FormDraft.update(coordinatorDraft.id, {
        status: failedNext.status,
        submit_error: failedNext.submit_error,
        last_materialized_version_id: failedVersion.id,
      });

      return Response.json({
        success: true, received: true, submissionCreated: false,
        intakeId: intake?.id || null, usedFallback: true, zapierSent: false,
      }, { headers: corsHeaders });
    }

    // A submit-attempt receipt is the primary idempotency key. Session-level
    // dedupe is accepted only when both identity and payload fingerprints match.
    let existingSubmission = null;
    if (submitAttemptId) {
      try {
        const existingByAttempt = await base44.asServiceRole.entities.FormSubmission.filter(
          { submit_attempt_id: submitAttemptId }, '-created_date', 1
        );
        if (existingByAttempt && existingByAttempt.length > 0) {
          existingSubmission = existingByAttempt[0];
        }
      } catch {
        // filter may not be supported - continue
      }
    }

    if (!existingSubmission) {
      try {
        const existingBySession = await base44.asServiceRole.entities.FormSubmission.filter(
          { questionnaire_session_id: questionnaireSessionId }, '-created_date', 1
        );
        if (existingBySession && existingBySession.length > 0) existingSubmission = existingBySession[0];
      } catch {
        // filter may not be supported - continue
      }
    }

    if (existingSubmission) {
      const exactMatch = await existingSubmissionMatches(existingSubmission, incomingFingerprints);
      if (!exactMatch) {
        const conflictAt = nowIso();
        await base44.asServiceRole.entities.FormDraft.update(coordinatorDraft.id, {
          status: 'submit_failed',
          submit_error: JSON.stringify({
            code: 'submission_identity_conflict',
            message: 'This draft session already belongs to a different submitted client or payload.',
          }),
          last_saved_at: conflictAt,
        }).catch(() => null);
        return Response.json({
          success: false,
          received: true,
          usedFallback: true,
          code: 'submission_identity_conflict',
          error: { message: 'This draft is connected to a different submitted client. Start a new client draft and submit again.' },
        }, { status: 409, headers: corsHeaders });
      }
      const existingSubmissionId = existingSubmission.id;
      await base44.asServiceRole.entities.FormSubmission.update(existingSubmissionId, {
        linked_draft_id: coordinatorDraft.id,
        submission_fingerprint: incomingFingerprints.submissionFingerprint,
        identity_fingerprint: incomingFingerprints.identityFingerprint,
        retention_policy: 'indefinite_until_manual_deletion',
        retention_policy_version: '2026-08-18',
        retention_protected_at: nowIso(),
      }).catch(() => null);
      // Already submitted - upsert intake and return idempotent success
      const intakeData = buildIntakePayload({
        status: 'submitted',
        intakeReason: 'already_submitted_deduped',
        businessName, businessDomain, userEmail, userId, submitAttemptId,
        primaryError,
        transformedPayload,
        rawResponses: rawResponseSnapshot,
        diagnostics, source, createdAtClient,
        linkedSubmissionId: existingSubmissionId,
      });
      const intake = await upsertIntake(base44, questionnaireSessionId, intakeData);
      const submittedNext = {
        ...checkpointDraft,
        status: 'submitted',
        submitted_at: nowIso(),
        final_submission_id: existingSubmissionId,
      };
      const submittedVersion = await createQuestionnaireVersion({
        base44,
        draft: submittedNext,
        previous: checkpointDraft,
        versionType: 'submitted_snapshot',
        sourceRecordId: existingSubmissionId,
        capturedAt: String(submittedNext.submitted_at || nowIso()),
        versionKey: `${coordinatorDraft.id}:submitted:${existingSubmissionId}`,
      });
      if (!submittedVersion?.id) throw new Error('Submitted questionnaire history was not retained.');
      await base44.asServiceRole.entities.FormDraft.update(coordinatorDraft.id, {
        status: submittedNext.status,
        submitted_at: submittedNext.submitted_at,
        final_submission_id: submittedNext.final_submission_id,
        last_materialized_version_id: submittedVersion.id,
      });

      return Response.json({
        success: true, received: true, alreadySubmitted: true,
        submissionCreated: false, submissionId: existingSubmissionId,
        intakeId: intake?.id || null, usedFallback: true, zapierSent: false,
      }, { headers: corsHeaders });
    }

    // Attempt FormSubmission create
    const normalized = normalizePayload(transformedPayload, questionnaireSessionId, primaryError);
    const record = mapExpressPayloadToFormSubmissionRecord(
      normalized,
      questionnaireSessionId,
      submitAttemptId,
      rawResponseSnapshot,
    );
    record.submission_fingerprint = incomingFingerprints.submissionFingerprint;
    record.identity_fingerprint = incomingFingerprints.identityFingerprint;
    if (!record.user_email && userEmail) record.user_email = truncate(userEmail) || '';

    let submission = null;
    let submissionError = null;

    try {
      submission = await base44.asServiceRole.entities.FormSubmission.create({
        ...record,
        linked_draft_id: coordinatorDraft.id,
      });
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
        rawResponses: rawResponseSnapshot,
        diagnostics, source, createdAtClient,
        linkedSubmissionId: submissionId,
      });

      const intake = await upsertIntake(base44, questionnaireSessionId, intakeData);
      const submittedNext = {
        ...checkpointDraft,
        status: 'submitted',
        submitted_at: nowIso(),
        final_submission_id: submissionId || '',
        mapped_payload_json: safeJsonStringify(normalized),
      };
      const submittedVersion = await createQuestionnaireVersion({
        base44,
        draft: submittedNext,
        previous: checkpointDraft,
        versionType: 'submitted_snapshot',
        sourceRecordId: String(submissionId || coordinatorDraft.id),
        capturedAt: String(submittedNext.submitted_at || nowIso()),
        versionKey: `${coordinatorDraft.id}:submitted:${submissionId || submitAttemptId || questionnaireSessionId}`,
      });
      if (!submittedVersion?.id) throw new Error('Submitted questionnaire history was not retained.');
      await base44.asServiceRole.entities.FormDraft.update(coordinatorDraft.id, {
        status: submittedNext.status,
        submitted_at: submittedNext.submitted_at,
        final_submission_id: submittedNext.final_submission_id,
        mapped_payload_json: submittedNext.mapped_payload_json,
        last_materialized_version_id: submittedVersion.id,
      });

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
      rawResponses: rawResponseSnapshot,
      diagnostics, source, createdAtClient,
    });

    const intake = await upsertIntake(base44, questionnaireSessionId, intakeData);
    const failedNext = {
      ...checkpointDraft,
      status: 'auto_repair_pending',
      submit_error: safeJsonStringify(submissionError),
      mapped_payload_json: safeJsonStringify(normalized),
    };
    const failedVersion = await createQuestionnaireVersion({
      base44, draft: failedNext, previous: checkpointDraft,
      versionType: 'failed_submission_checkpoint', sourceRecordId: String(coordinatorDraft.id),
      capturedAt: nowIso(),
      versionKey: `${coordinatorDraft.id}:failed-submission:${submitAttemptId || questionnaireSessionId}:create-failed`,
    });
    if (!failedVersion?.id) throw new Error('Failed-submission history was not retained.');
    await base44.asServiceRole.entities.FormDraft.update(coordinatorDraft.id, {
      status: failedNext.status,
      submit_error: failedNext.submit_error,
      mapped_payload_json: failedNext.mapped_payload_json,
      last_materialized_version_id: failedVersion.id,
    });

    return Response.json({
      success: true, received: true, submissionCreated: false,
      intakeId: intake?.id || null, usedFallback: true, zapierSent: false,
    }, { headers: corsHeaders });
        },
      },
    );

  } catch (error) {
    return Response.json({
      success: false, received: false, usedFallback: true,
      error: { message: error.message },
    }, { status: 500, headers: corsHeaders });
  }
});
