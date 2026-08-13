import { createClientFromRequest } from 'npm:@base44/sdk@0.8.39';
import { secrets } from 'base44:runtime';
import { authorizeRecoveryRequest, safeRecoveryLog } from '../../shared/recoveryAuthorization.ts';

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

const PDF_VERSION_LIST_LIMIT = 100;

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isValidHttpsUrl(value: unknown): value is string {
  if (!isNonEmptyString(value, 2_000)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

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

  const base44 = createClientFromRequest(req);

  let recoverySecret = '';
  try {
    recoverySecret = secrets.get('DRAFT_RECOVERY_PASSWORD') || '';
  } catch {
    return json({ success: false, error: 'Draft recovery access is not configured.' }, 503);
  }
  const authorization = await authorizeRecoveryRequest({
    base44,
    recoveryGrant: body.recoveryGrant,
    recoverySecret,
  });
  if (!authorization.authorized) {
    return json({ success: false, error: authorization.error }, 403);
  }
  const identifier = typeof body.draftId === 'string' ? body.draftId : String(body.action || '');
  safeRecoveryLog({
    functionName: 'draftRecoveryData',
    authorizationMode: authorization.mode,
    identifier,
    deliveryStage: String(body.action || 'unknown_action'),
  });

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

      case 'listPdfVersions': {
        if (!isNonEmptyString(body.draftId, 200)) {
          return json({ success: false, error: 'draftId is required.' }, 400);
        }
        const pdfVersions = await base44.asServiceRole.entities.SubmissionPdfVersion.filter(
          { draft_id: body.draftId },
          '-version_number',
          PDF_VERSION_LIST_LIMIT,
        );
        return json({ success: true, pdfVersions });
      }

      case 'getPdfContext': {
        if (!isNonEmptyString(body.draftId, 200)) {
          return json({ success: false, error: 'draftId is required.' }, 400);
        }

        const draft = await base44.asServiceRole.entities.FormDraft.get(body.draftId);
        let submission = null;

        if (draft?.final_submission_id) {
          try {
            submission = await base44.asServiceRole.entities.FormSubmission.get(draft.final_submission_id);
          } catch {
            submission = null;
          }
        }

        if (!submission && draft?.session_id) {
          const matchingSubmissions = await base44.asServiceRole.entities.FormSubmission.filter(
            { questionnaire_session_id: draft.session_id },
            '-created_date',
            1,
          );
          submission = matchingSubmissions?.[0] || null;
        }

        const pdfVersions = await base44.asServiceRole.entities.SubmissionPdfVersion.filter(
          { draft_id: body.draftId },
          '-version_number',
          PDF_VERSION_LIST_LIMIT,
        );

        return json({ success: true, draft, submission, pdfVersions });
      }

      case 'createPdfVersion': {
        if (!isNonEmptyString(body.draftId, 200)) {
          return json({ success: false, error: 'draftId is required.' }, 400);
        }
        if (typeof body.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.payloadHash)) {
          return json({ success: false, error: 'payloadHash is invalid.' }, 400);
        }
        if (!isValidHttpsUrl(body.pdfFileUrl)) {
          return json({ success: false, error: 'pdfFileUrl must be a valid HTTPS URL.' }, 400);
        }
        if (!isNonEmptyString(body.pdfFilename, 255)) {
          return json({ success: false, error: 'pdfFilename is required.' }, 400);
        }
        if (!isNonEmptyString(body.templateVersion, 100)) {
          return json({ success: false, error: 'templateVersion is required.' }, 400);
        }
        if (typeof body.payloadJson !== 'string' || body.payloadJson.length > 2_000_000) {
          return json({ success: false, error: 'payloadJson is invalid.' }, 400);
        }
        try {
          const parsedPayload = JSON.parse(body.payloadJson);
          if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
            return json({ success: false, error: 'payloadJson must contain a JSON object.' }, 400);
          }
        } catch {
          return json({ success: false, error: 'payloadJson must contain valid JSON.' }, 400);
        }

        const draft = await base44.asServiceRole.entities.FormDraft.get(body.draftId);
        const matchingVersions = await base44.asServiceRole.entities.SubmissionPdfVersion.filter(
          {
            draft_id: body.draftId,
            payload_hash: body.payloadHash,
            template_version: body.templateVersion,
          },
          '-version_number',
          1,
        );
        if (matchingVersions?.[0]?.pdf_file_url) {
          return json({ success: true, version: matchingVersions[0], reused: true });
        }

        const latestVersions = await base44.asServiceRole.entities.SubmissionPdfVersion.filter(
          { draft_id: body.draftId },
          '-version_number',
          1,
        );
        const versionNumber = Math.max(0, Number(latestVersions?.[0]?.version_number || 0)) + 1;
        const generatedAt = new Date().toISOString();
        const pdfByteSize = Number(body.pdfByteSize);

        const version = await base44.asServiceRole.entities.SubmissionPdfVersion.create({
          draft_id: body.draftId,
          questionnaire_session_id: String(body.questionnaireSessionId || draft?.session_id || ''),
          submission_id: String(body.submissionId || draft?.final_submission_id || ''),
          submit_attempt_id: String(body.submitAttemptId || ''),
          payload_hash: body.payloadHash,
          payload_source: String(body.payloadSource || 'unknown').slice(0, 100),
          payload_json: body.payloadJson,
          source_updated_at: String(body.sourceUpdatedAt || generatedAt),
          pdf_file_url: body.pdfFileUrl,
          pdf_filename: body.pdfFilename,
          pdf_byte_size: Number.isFinite(pdfByteSize) && pdfByteSize >= 0 ? Math.round(pdfByteSize) : 0,
          template_version: body.templateVersion,
          version_number: versionNumber,
          business_name: String(body.businessName || draft?.business_name || '').slice(0, 500),
          business_domain: String(body.businessDomain || draft?.domain || '').slice(0, 500),
          generated_at: generatedAt,
        });

        return json({ success: true, version, reused: false });
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
          updates.payload_edited_at = new Date().toISOString();
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
