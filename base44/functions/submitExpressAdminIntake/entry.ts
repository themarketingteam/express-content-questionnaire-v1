import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { secrets } from 'base44:runtime';
import { authorizeRecoveryRequest, safeRecoveryLog } from '../../shared/recoveryAuthorization.ts';

const MAX_PAYLOAD_CHARACTERS = 500_000;
const ZAPIER_TIMEOUT_MS = 8_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

function readSecret(name: string): string {
  try {
    return (secrets.get(name) || '').trim();
  } catch {
    try {
      return (Deno.env.get(name) || '').trim();
    } catch {
      return '';
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const single = asString(value);
  return single ? [single] : [];
}

function cleanDomain(value: unknown): string {
  return asString(value)
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .trim();
}

function normalizeSubmissionDate(value: unknown): string {
  const candidate = asString(value);
  if (!candidate) return new Date().toISOString();
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function sanitizeGeoMeta(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const sanitized: Record<string, unknown> = {};
  const label = asString(value.label);
  const source = asString(value.source);
  const placeId = asString(value.place_id);
  if (label) sanitized.label = label;
  if (typeof value.lat === 'number' && Number.isFinite(value.lat)) sanitized.lat = value.lat;
  if (typeof value.lon === 'number' && Number.isFinite(value.lon)) sanitized.lon = value.lon;
  if (placeId) sanitized.place_id = placeId;
  if (source) sanitized.source = source;
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function normalizePayload(payload: unknown) {
  if (!isPlainObject(payload) || !isPlainObject(payload.metadata) || !isPlainObject(payload.userdata)) {
    return { ok: false as const, errors: ['Payload must contain metadata and userdata objects.'] };
  }

  const metadata = payload.metadata;
  const userdata = payload.userdata;
  const normalizedMetadata = {
    business_name: asString(metadata.business_name),
    businessDomain: cleanDomain(metadata.businessDomain || metadata.business_domain),
    submission_datetime: normalizeSubmissionDate(metadata.submission_datetime),
    service_type: 'express',
    questionnaire_session_id: asString(metadata.questionnaire_session_id),
    submit_attempt_id: asString(metadata.submit_attempt_id),
  };
  const normalizedUserdata: Record<string, unknown> = {
    it_company_type: asStringArray(userdata.it_company_type),
    it_company_type_other: asString(userdata.it_company_type_other),
    service_offerings: asStringArray(userdata.service_offerings),
    service_offerings_other: asString(userdata.service_offerings_other),
    differentiation: asString(userdata.differentiation),
    geographic_areas: asString(userdata.geographic_areas),
    pricing_packaging: asString(userdata.pricing_packaging),
    pricing_packaging_other: asString(userdata.pricing_packaging_other),
    company_goals: asString(userdata.company_goals) || asStringArray(userdata.company_goals).join(', '),
    company_goals_other: asString(userdata.company_goals_other),
    brand_tone: asString(userdata.brand_tone),
    brand_tone_other: asString(userdata.brand_tone_other),
    target_industries: asStringArray(userdata.target_industries),
    target_industries_other: asString(userdata.target_industries_other),
    client_size: asString(userdata.client_size) || '1-50 employees',
    client_challenges: asStringArray(userdata.client_challenges),
    client_challenges_other: asString(userdata.client_challenges_other),
    client_outcomes: asStringArray(userdata.client_outcomes),
    client_outcomes_other: asString(userdata.client_outcomes_other),
    ideal_client: asString(userdata.ideal_client),
  };
  const geoMeta = sanitizeGeoMeta(userdata.geographic_area_meta);
  if (geoMeta) normalizedUserdata.geographic_area_meta = geoMeta;

  const errors: string[] = [];
  if (!normalizedMetadata.business_name) errors.push('metadata.business_name is required.');
  if (!normalizedMetadata.businessDomain) errors.push('metadata.businessDomain is required.');
  if ((normalizedUserdata.service_offerings as string[]).length === 0) {
    errors.push('userdata.service_offerings must contain at least one value.');
  }
  if (!normalizedUserdata.differentiation) errors.push('userdata.differentiation is required.');
  if (!normalizedUserdata.geographic_areas) errors.push('userdata.geographic_areas is required.');
  if (!normalizedUserdata.ideal_client) errors.push('userdata.ideal_client is required.');
  if (errors.length > 0) return { ok: false as const, errors };

  return {
    ok: true as const,
    payload: { metadata: normalizedMetadata, userdata: normalizedUserdata },
  };
}

function mapSubmissionRecord(payload: any) {
  const metadata = payload.metadata;
  const userdata = payload.userdata;
  const record: Record<string, unknown> = {
    business_name: metadata.business_name,
    business_domain: metadata.businessDomain,
    submission_datetime: metadata.submission_datetime,
    service_type: 'express',
    it_company_type: userdata.it_company_type,
    it_company_type_other: userdata.it_company_type_other,
    service_offerings: userdata.service_offerings,
    service_offerings_other: userdata.service_offerings_other,
    differentiation: userdata.differentiation,
    geographic_areas: userdata.geographic_areas,
    pricing_packaging: userdata.pricing_packaging,
    pricing_packaging_other: userdata.pricing_packaging_other,
    company_goals: asStringArray(userdata.company_goals),
    company_goals_other: userdata.company_goals_other,
    brand_tone: userdata.brand_tone,
    brand_tone_other: userdata.brand_tone_other,
    target_industries: userdata.target_industries,
    target_industries_other: userdata.target_industries_other,
    client_size: userdata.client_size,
    client_challenges: userdata.client_challenges,
    client_challenges_other: userdata.client_challenges_other,
    client_outcomes: userdata.client_outcomes,
    client_outcomes_other: userdata.client_outcomes_other,
    ideal_client: userdata.ideal_client,
    raw_responses_json: '{}',
    transformed_payload_json: JSON.stringify(payload),
    questionnaire_session_id: metadata.questionnaire_session_id,
    submit_attempt_id: metadata.submit_attempt_id,
    zapier_delivery_status: 'not_attempted',
    zapier_sent: false,
    zapier_sent_at: '',
    zapier_error_json: '',
    zapier_attempt_count: 0,
    resubmit_count: 0,
  };
  if (userdata.geographic_area_meta) record.geographic_area_meta = userdata.geographic_area_meta;
  return record;
}

async function deliverToZapier(payload: unknown): Promise<{ sent: boolean; error?: string; status?: number }> {
  const webhookUrl = readSecret('EXPRESS_ZAPIER_WEBHOOK_URL');
  if (!webhookUrl) return { sent: false, error: 'Express Zapier webhook is not configured.' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ZAPIER_TIMEOUT_MS);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { sent: false, error: `Express Zapier webhook returned HTTP ${response.status}.`, status: response.status };
    }
    return { sent: true, status: response.status };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Express Zapier webhook timed out.'
      : 'Express Zapier webhook request failed.';
    return { sent: false, error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON request.' }, 400);
  }

  const base44 = createClientFromRequest(req);
  const recoverySecret = readSecret('DRAFT_RECOVERY_PASSWORD');
  const authorization = await authorizeRecoveryRequest({
    base44,
    recoveryGrant: body.recoveryGrant,
    recoverySecret,
  });
  if (!authorization.authorized) return json({ success: false, error: authorization.error }, 403);

  let payloadSize = 0;
  try {
    payloadSize = JSON.stringify(body.payload).length;
  } catch {
    return json({ success: false, error: 'Payload cannot be serialized.' }, 400);
  }
  if (payloadSize > MAX_PAYLOAD_CHARACTERS) {
    return json({ success: false, error: 'Payload is too large.' }, 413);
  }

  const normalized = normalizePayload(body.payload);
  if (!normalized.ok) return json({ success: false, error: normalized.errors.join(' ') }, 400);

  safeRecoveryLog({
    functionName: 'submitExpressAdminIntake',
    authorizationMode: authorization.mode,
    deliveryStage: 'authorized',
  });

  let submission: any;
  try {
    submission = await base44.asServiceRole.entities.FormSubmission.create(mapSubmissionRecord(normalized.payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FormSubmission create failed.';
    return json({ success: false, error: message }, 500);
  }

  const submissionId = asString(submission?.id);
  const zapier = await deliverToZapier(normalized.payload);
  let statusUpdateWarning = '';
  if (submissionId) {
    try {
      await base44.asServiceRole.entities.FormSubmission.update(submissionId, {
        zapier_sent: zapier.sent,
        zapier_delivery_status: zapier.sent ? 'sent' : 'failed',
        zapier_sent_at: zapier.sent ? new Date().toISOString() : '',
        zapier_error_json: zapier.sent ? '' : JSON.stringify({ message: zapier.error || 'Zapier delivery failed.' }),
        zapier_attempt_count: 1,
      });
    } catch {
      statusUpdateWarning = 'The submission was saved, but its Zapier status could not be updated.';
    }
  }

  safeRecoveryLog({
    functionName: 'submitExpressAdminIntake',
    authorizationMode: authorization.mode,
    identifier: submissionId,
    deliveryStage: zapier.sent ? 'submission_saved_zapier_sent' : 'submission_saved_zapier_failed',
    zapierStatus: zapier.status || null,
  });

  return json({
    success: true,
    submissionId,
    zapierSent: zapier.sent,
    zapierError: zapier.error || null,
    statusUpdateWarning: statusUpdateWarning || null,
    normalizedPayload: normalized.payload,
  });
});
