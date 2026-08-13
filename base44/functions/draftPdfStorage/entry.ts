import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { secrets } from 'base44:runtime';
import { withEntityLease } from '../../shared/entityLease.ts';
import { sanitizePdfVersion } from '../../shared/pdfVersionPrivacy.ts';
import { authorizeRecoveryRequest, safeRecoveryLog } from '../../shared/recoveryAuthorization.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 120;

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function stringField(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isPayloadHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_000) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

async function parseRequest(req: Request): Promise<{
  body: Record<string, unknown>;
  file: File | null;
}> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const body: Record<string, unknown> = {};
    let file: File | null = null;
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        if (key === 'file') file = value;
      } else {
        body[key] = value;
      }
    }
    return { body, file };
  }
  return { body: await req.json(), file: null };
}

async function validatePdf(file: File | null): Promise<string | null> {
  if (!file) return 'A PDF file is required.';
  if (file.size <= 0 || file.size > MAX_PDF_BYTES) return 'The PDF file size is invalid.';
  if (file.type && file.type !== 'application/pdf') return 'Only PDF files are accepted.';
  const signature = await file.slice(0, 5).text();
  return signature === '%PDF-' ? null : 'The uploaded file is not a valid PDF.';
}

function privateFileUri(result: Record<string, unknown> | null | undefined): string {
  const nested = result?.data as Record<string, unknown> | undefined;
  return stringField(result?.file_uri || nested?.file_uri, 2_000);
}

function signedFileUrl(result: Record<string, unknown> | null | undefined): string {
  const nested = result?.data as Record<string, unknown> | undefined;
  return stringField(result?.signed_url || nested?.signed_url, 5_000);
}

async function uploadPrivatePdf(base44: any, file: File): Promise<string> {
  const result = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
  const fileUri = privateFileUri(result);
  if (!fileUri) throw new Error('Private PDF storage did not return a file URI.');
  return fileUri;
}

async function migrateLegacyVersion(base44: any, version: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (version.pdf_file_uri) return version;
  if (!isHttpsUrl(version.pdf_file_url)) throw new Error('This saved PDF does not have an available private file.');

  const legacyResponse = await fetch(version.pdf_file_url, { redirect: 'error' });
  if (!legacyResponse.ok) throw new Error('The legacy PDF could not be read for private migration.');
  const declaredSize = Number(legacyResponse.headers.get('content-length') || 0);
  if (declaredSize > MAX_PDF_BYTES) throw new Error('The legacy PDF is too large to migrate.');

  const legacyBlob = await legacyResponse.blob();
  if (legacyBlob.size <= 0 || legacyBlob.size > MAX_PDF_BYTES) {
    throw new Error('The legacy PDF size is invalid.');
  }
  const legacyFile = new File(
    [legacyBlob],
    stringField(version.pdf_filename, 255) || 'Express_Questionnaire_Responses.pdf',
    { type: 'application/pdf' },
  );
  const validationError = await validatePdf(legacyFile);
  if (validationError) throw new Error(validationError);

  const fileUri = await uploadPrivatePdf(base44, legacyFile);
  await base44.asServiceRole.entities.SubmissionPdfVersion.updateMany(
    { id: version.id },
    {
      $set: {
        pdf_file_uri: fileUri,
        storage_visibility: 'private',
      },
      $unset: {
        pdf_file_url: '',
        payload_json: '',
      },
    },
  );
  return await base44.asServiceRole.entities.SubmissionPdfVersion.get(version.id);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);

  let parsed: { body: Record<string, unknown>; file: File | null };
  try {
    parsed = await parseRequest(req);
  } catch {
    return json({ success: false, error: 'Invalid request.' }, 400);
  }

  const { body, file } = parsed;
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
  if (!authorization.authorized) return json({ success: false, error: authorization.error }, 403);

  const action = stringField(body.action, 40);
  const draftId = stringField(body.draftId, 200);
  safeRecoveryLog({
    functionName: 'draftPdfStorage',
    authorizationMode: authorization.mode,
    identifier: draftId || stringField(body.versionId, 200),
    deliveryStage: action || 'unknown_action',
  });

  if (!draftId) return json({ success: false, error: 'draftId is required.' }, 400);

  try {
    const draft = await base44.asServiceRole.entities.FormDraft.get(draftId);
    if (!draft) return json({ success: false, error: 'Draft not found.' }, 404);

    if (action === 'upload') {
      if (!isPayloadHash(body.payloadHash)) {
        return json({ success: false, error: 'payloadHash is invalid.' }, 400);
      }
      const templateVersion = stringField(body.templateVersion, 100);
      const pdfFilename = stringField(body.pdfFilename, 255);
      if (!templateVersion || !pdfFilename) {
        return json({ success: false, error: 'templateVersion and pdfFilename are required.' }, 400);
      }
      const validationError = await validatePdf(file);
      if (validationError) return json({ success: false, error: validationError }, 400);

      const result = await withEntityLease(
        {
          entity: base44.asServiceRole.entities.FormDraft,
          entityId: draftId,
          purpose: `pdf:${body.payloadHash}:${templateVersion}`,
          leaseDurationMs: 60_000,
          waitTimeoutMs: 20_000,
        },
        async () => {
          const matches = await base44.asServiceRole.entities.SubmissionPdfVersion.filter(
            {
              draft_id: draftId,
              payload_hash: body.payloadHash,
              template_version: templateVersion,
            },
            '-version_number',
            10,
          );
          const privateMatch = matches?.find((version: Record<string, unknown>) => version.pdf_file_uri);
          if (privateMatch) {
            return { version: sanitizePdfVersion(privateMatch), reused: true };
          }

          const fileUri = await uploadPrivatePdf(base44, file as File);
          const latest = await base44.asServiceRole.entities.SubmissionPdfVersion.filter(
            { draft_id: draftId },
            '-version_number',
            1,
          );
          const versionNumber = Math.max(0, Number(latest?.[0]?.version_number || 0)) + 1;
          const generatedAt = new Date().toISOString();
          const pdfByteSize = Number(body.pdfByteSize);
          const created = await base44.asServiceRole.entities.SubmissionPdfVersion.create({
            draft_id: draftId,
            questionnaire_session_id: stringField(body.questionnaireSessionId || draft.session_id, 500),
            submission_id: stringField(body.submissionId || draft.final_submission_id, 200),
            submit_attempt_id: stringField(body.submitAttemptId, 200),
            payload_hash: body.payloadHash,
            payload_source: stringField(body.payloadSource, 100) || 'unknown',
            source_updated_at: stringField(body.sourceUpdatedAt, 100) || generatedAt,
            pdf_file_uri: fileUri,
            storage_visibility: 'private',
            idempotency_key: `${draftId}:${body.payloadHash}:${templateVersion}`.slice(0, 1_000),
            pdf_filename: pdfFilename,
            pdf_byte_size: Number.isFinite(pdfByteSize) && pdfByteSize >= 0
              ? Math.round(pdfByteSize)
              : (file as File).size,
            template_version: templateVersion,
            version_number: versionNumber,
            business_name: stringField(body.businessName || draft.business_name, 500),
            business_domain: stringField(body.businessDomain || draft.domain, 500),
            generated_at: generatedAt,
          });
          return { version: sanitizePdfVersion(created), reused: false };
        },
      );
      return json({ success: true, ...result });
    }

    if (action === 'download') {
      const versionId = stringField(body.versionId, 200);
      if (!versionId) return json({ success: false, error: 'versionId is required.' }, 400);

      const result = await withEntityLease(
        {
          entity: base44.asServiceRole.entities.FormDraft,
          entityId: draftId,
          purpose: `pdf-download:${versionId}`,
          leaseDurationMs: 60_000,
          waitTimeoutMs: 20_000,
        },
        async () => {
          let version = await base44.asServiceRole.entities.SubmissionPdfVersion.get(versionId);
          if (!version || version.draft_id !== draftId) throw new Error('PDF version not found for this draft.');
          version = await migrateLegacyVersion(base44, version);
          const signedResult = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
            file_uri: version.pdf_file_uri,
            expires_in: SIGNED_URL_TTL_SECONDS,
          });
          const signedUrl = signedFileUrl(signedResult);
          if (!isHttpsUrl(signedUrl)) throw new Error('Private PDF download could not be authorized.');
          return {
            signedUrl,
            expiresIn: SIGNED_URL_TTL_SECONDS,
            version: sanitizePdfVersion(version),
          };
        },
      );
      return json({ success: true, ...result });
    }

    return json({ success: false, error: 'Unsupported action.' }, 400);
  } catch (error) {
    console.error('Private draft PDF operation failed', error);
    return json({ success: false, error: error instanceof Error ? error.message : 'PDF operation failed.' }, 500);
  }
});
