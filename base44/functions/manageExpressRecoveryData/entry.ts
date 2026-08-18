import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { secrets } from 'base44:runtime';
import { backupIsStale } from '../../shared/backupPolicy.ts';
import {
  confirmationHash,
  createLifecycleToken,
  DELETION_REASON_CODES,
  expectedDeletionConfirmation,
  restoreConfirmation,
  verifyLifecycleToken,
} from '../../shared/manualDataLifecycle.ts';
import { getPrivateObject, purgeAllObjectVersions, sha256Hex } from '../../shared/privateS3.ts';
import { loadPrivateS3Config } from '../../shared/privateS3Config.ts';
import { authorizeRecoveryRequest } from '../../shared/recoveryAuthorization.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};
const ROOT_ENTITIES = {
  draft: 'FormDraft',
  submission: 'FormSubmission',
  intake: 'FormSubmissionIntake',
} as const;
const ENTITY_DELETE_ORDER = [
  'FormDraftEvent',
  'ExpressIdentityResolutionAttempt',
  'SubmissionPdfVersion',
  'FormSubmissionIntake',
  'FormSubmission',
  'FormDraft',
] as const;

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function secret(name: string): string {
  try { return (secrets.get(name) || '').trim(); } catch { return ''; }
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function unique(records: Array<Record<string, any>>): Array<Record<string, any>> {
  const map = new Map<string, Record<string, any>>();
  for (const record of records) if (record?.id) map.set(String(record.id), record);
  return [...map.values()];
}

async function filter(base44: any, entityName: string, query: Record<string, unknown>): Promise<Array<Record<string, any>>> {
  const output: Array<Record<string, any>> = [];
  const pageSize = 1_000;
  for (let skip = 0; ; skip += pageSize) {
    const page = await base44.asServiceRole.entities[entityName].filter(query, 'created_date', pageSize, skip);
    output.push(...(page || []));
    if (!page || page.length < pageSize) break;
  }
  return output;
}

async function resolveGraph(base44: any, rootType: keyof typeof ROOT_ENTITIES, rootId: string) {
  const root = await base44.asServiceRole.entities[ROOT_ENTITIES[rootType]].get(rootId).catch(() => null);
  if (!root) throw new Error('The requested recovery record no longer exists.');
  const session = text(root.session_id || root.questionnaire_session_id, 1_000);
  const drafts = unique([
    ...(rootType === 'draft' ? [root] : []),
    ...(session ? await filter(base44, 'FormDraft', { session_id: session }) : []),
    ...(rootType === 'submission' && root.linked_draft_id
      ? [await base44.asServiceRole.entities.FormDraft.get(root.linked_draft_id).catch(() => null)].filter(Boolean)
      : []),
  ]);
  const draftIds = drafts.map((record) => String(record.id));
  const finalSubmissionIds = drafts.map((record) => text(record.final_submission_id, 200)).filter(Boolean);
  const submissions = unique([
    ...(rootType === 'submission' ? [root] : []),
    ...(session ? await filter(base44, 'FormSubmission', { questionnaire_session_id: session }) : []),
    ...await Promise.all(finalSubmissionIds.map((id) => base44.asServiceRole.entities.FormSubmission.get(id).catch(() => null))),
    ...await Promise.all(draftIds.map((id) => filter(base44, 'FormSubmission', { linked_draft_id: id }))).then((groups) => groups.flat()),
  ].filter(Boolean));
  const submissionIds = submissions.map((record) => String(record.id));
  const intakes = unique([
    ...(rootType === 'intake' ? [root] : []),
    ...(session ? await filter(base44, 'FormSubmissionIntake', { questionnaire_session_id: session }) : []),
    ...await Promise.all(submissionIds.map((id) => filter(base44, 'FormSubmissionIntake', { linked_submission_id: id }))).then((groups) => groups.flat()),
  ]);
  const intakeIds = intakes.map((record) => String(record.id));
  const events = session ? await filter(base44, 'FormDraftEvent', { session_id: session }) : [];
  const pdfs = unique([
    ...(session ? await filter(base44, 'SubmissionPdfVersion', { questionnaire_session_id: session }) : []),
    ...await Promise.all(draftIds.map((id) => filter(base44, 'SubmissionPdfVersion', { draft_id: id }))).then((groups) => groups.flat()),
    ...await Promise.all(submissionIds.map((id) => filter(base44, 'SubmissionPdfVersion', { submission_id: id }))).then((groups) => groups.flat()),
  ]);
  const identities = unique([
    ...(session ? await filter(base44, 'ExpressIdentityResolutionAttempt', { questionnaire_session_id: session }) : []),
    ...await Promise.all(draftIds.map((id) => filter(base44, 'ExpressIdentityResolutionAttempt', { record_type: 'draft', record_id: id }))).then((groups) => groups.flat()),
    ...await Promise.all(intakeIds.map((id) => filter(base44, 'ExpressIdentityResolutionAttempt', { record_type: 'intake', record_id: id }))).then((groups) => groups.flat()),
  ]);
  const byEntity: Record<string, Array<Record<string, any>>> = {
    FormDraft: drafts,
    FormSubmission: submissions,
    FormSubmissionIntake: intakes,
    FormDraftEvent: unique(events),
    SubmissionPdfVersion: pdfs,
    ExpressIdentityResolutionAttempt: identities,
  };
  const sourceIds = Object.values(byEntity).flat().map((record) => String(record.id));
  const sessionHash = session ? await sha256Hex(`session:${session}`) : '';
  const backupObjects = unique([
    ...await Promise.all(sourceIds.map((id) => filter(base44, 'ExpressBackupObject', { source_record_id: id }))).then((groups) => groups.flat()),
    ...(sessionHash ? await filter(base44, 'ExpressBackupObject', { session_id_hash: sessionHash }) : []),
  ]);
  return { root, session, sessionHash, byEntity, backupObjects };
}

function graphCounts(graph: Awaited<ReturnType<typeof resolveGraph>>): Record<string, number> {
  return Object.fromEntries([
    ...Object.entries(graph.byEntity).map(([entity, records]) => [entity, records.length]),
    ['ExpressBackupObject', graph.backupObjects.length],
  ]);
}

async function deleteRecordIds(base44: any, entityName: string, records: Array<Record<string, any>>): Promise<void> {
  const ids = records.map((record) => String(record.id));
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    const result = await base44.asServiceRole.entities[entityName].deleteMany({ id: { $in: batch } });
    if (!result?.success || Number(result.deleted) !== batch.length) {
      throw new Error(`${entityName} deletion did not remove the complete prepared batch.`);
    }
  }
}

async function graphFingerprint(graph: Awaited<ReturnType<typeof resolveGraph>>): Promise<string> {
  const ids = Object.entries(graph.byEntity)
    .flatMap(([entity, records]) => records.map((record) => `${entity}:${record.id}`))
    .sort();
  return await sha256Hex(ids.join('\n'));
}

async function backupStatus(base44: any) {
  const runs = await base44.asServiceRole.entities.ExpressBackupRun.list('-started_at', 10);
  const latest = runs?.[0] || null;
  const completedRuns = await base44.asServiceRole.entities.ExpressBackupRun.filter({ status: 'completed' }, '-completed_at', 1);
  const lastSuccess = completedRuns?.[0] || null;
  const writer = loadPrivateS3Config('writer');
  const purge = loadPrivateS3Config('purge');
  return {
    policy: 'indefinite_until_manual_deletion',
    configured: writer.configured && purge.configured && Boolean(secret('EXPRESS_BACKUP_MANIFEST_SIGNING_KEY')),
    writerConfigured: writer.configured,
    purgeConfigured: purge.configured,
    latest: latest ? {
      runId: latest.run_id,
      status: latest.status,
      startedAt: latest.started_at,
      completedAt: latest.completed_at,
      metrics: latest.metrics_json,
      errorCode: latest.error_code,
    } : null,
    lastSuccessAt: lastSuccess?.completed_at || null,
    stale: backupIsStale(lastSuccess?.completed_at),
    alertAfterHours: 36,
  };
}

async function prepareDeletion(base44: any, body: Record<string, any>, lifecycleSecret: string, authorizedBy: string) {
  const rootType = text(body.recordType, 30) as keyof typeof ROOT_ENTITIES;
  const rootId = text(body.recordId, 200);
  const reasonCode = text(body.reasonCode, 100);
  const typed = text(body.confirmation, 1_000);
  if (!ROOT_ENTITIES[rootType] || !rootId || !DELETION_REASON_CODES.has(reasonCode)) {
    return json({ ok: false, error: 'A valid record, reason, and confirmation are required.' }, 400);
  }
  const graph = await resolveGraph(base44, rootType, rootId);
  const expected = expectedDeletionConfirmation(graph.root);
  if (!expected || typed !== expected) return json({ ok: false, error: 'The typed business name or session ID does not match.' }, 400);
  const counts = graphCounts(graph);
  const token = await createLifecycleToken({
    action: 'delete', rootType, rootId, reasonCode, authorizedBy,
    confirmationHash: await confirmationHash(typed),
    graphFingerprint: await graphFingerprint(graph), counts,
  }, lifecycleSecret);
  return json({ ok: true, token, expiresInSeconds: 600, counts, expectedConfirmation: expected });
}

async function executeDeletion(base44: any, body: Record<string, any>, lifecycleSecret: string, authorizationMode: string) {
  const verified = await verifyLifecycleToken(body.token, lifecycleSecret);
  if (!verified.valid || verified.claims.action !== 'delete') return json({ ok: false, error: verified.valid ? 'Invalid deletion authorization.' : verified.error }, 403);
  const claims = verified.claims;
  const typedHash = await confirmationHash(body.confirmation);
  if (typedHash !== claims.confirmationHash) return json({ ok: false, error: 'The deletion confirmation no longer matches.' }, 400);
  const graph = await resolveGraph(base44, claims.rootType, claims.rootId);
  if (await graphFingerprint(graph) !== claims.graphFingerprint) {
    return json({ ok: false, error: 'The client record graph changed. Prepare deletion again before continuing.' }, 409);
  }
  const unmigratedPdf = graph.byEntity.SubmissionPdfVersion.find((pdf) => !pdf.s3_object_key && (pdf.pdf_file_uri || pdf.pdf_file_url));
  if (unmigratedPdf) return json({ ok: false, retryable: true, error: 'A saved PDF has not completed private S3 migration. Run and verify backup before deletion.' }, 409);
  const purge = loadPrivateS3Config('purge');
  if (!purge.configured) return json({ ok: false, retryable: true, setupRequired: true, error: 'The isolated AWS purge role is not configured. No Base44 data was deleted.' }, 503);
  const keys = new Set<string>();
  graph.backupObjects.forEach((object) => { if (object.s3_object_key) keys.add(object.s3_object_key); });
  graph.byEntity.SubmissionPdfVersion.forEach((pdf) => { if (pdf.s3_object_key) keys.add(pdf.s3_object_key); });
  let purgedVersions = 0;
  try {
    for (const key of keys) purgedVersions += await purgeAllObjectVersions(purge.config, key);
  } catch (error) {
    console.error('External purge failed before Base44 deletion', error instanceof Error ? error.message : 'unknown');
    return json({ ok: false, retryable: true, error: 'AWS purge failed. No Base44 client records were deleted.' }, 502);
  }

  const deletionJobId = crypto.randomUUID();
  const counts = graphCounts(graph);
  try {
    for (const entityName of ENTITY_DELETE_ORDER) {
      await deleteRecordIds(base44, entityName, graph.byEntity[entityName] || []);
    }
    await deleteRecordIds(base44, 'ExpressBackupObject', graph.backupObjects);
    await base44.asServiceRole.entities.ExpressDeletionAudit.create({
      deletion_job_id: deletionJobId,
      root_record_type: claims.rootType,
      root_record_id_hash: await sha256Hex(`deleted-root:${claims.rootType}:${claims.rootId}`),
      ...(graph.sessionHash ? { session_id_hash: graph.sessionHash } : {}),
      reason_code: claims.reasonCode,
      authorized_by: text(claims.authorizedBy, 200) || 'recovery_administrator',
      authorization_mode: authorizationMode,
      record_counts_json: JSON.stringify(counts),
      backup_purge_count: purgedVersions,
      deleted_at: new Date().toISOString(),
      status: 'completed',
    });
    return json({ ok: true, deletionJobId, counts, purgedVersions, recentlyDeletedWindowDays: 30 });
  } catch (error) {
    console.error('Base44 deletion failed after successful AWS purge', error instanceof Error ? error.message : 'unknown');
    await base44.asServiceRole.entities.ExpressDeletionAudit.create({
      deletion_job_id: deletionJobId,
      root_record_type: claims.rootType,
      root_record_id_hash: await sha256Hex(`deleted-root:${claims.rootType}:${claims.rootId}`),
      ...(graph.sessionHash ? { session_id_hash: graph.sessionHash } : {}),
      reason_code: claims.reasonCode,
      authorized_by: text(claims.authorizedBy, 200) || 'recovery_administrator',
      authorization_mode: authorizationMode,
      record_counts_json: JSON.stringify(counts),
      backup_purge_count: purgedVersions,
      deleted_at: new Date().toISOString(),
      status: 'partial',
    }).catch(() => null);
    return json({ ok: false, retryable: true, deletionJobId, error: 'AWS purge succeeded, but Base44 deletion was incomplete. Retry using the audit job.' }, 500);
  }
}

async function restorePreview(base44: any, body: Record<string, any>, lifecycleSecret: string) {
  const sessionId = text(body.sessionId, 1_000);
  const sourceRecordId = text(body.sourceRecordId, 200);
  if (!sessionId && !sourceRecordId) return json({ ok: false, error: 'A session ID or source record ID is required.' }, 400);
  const records = sessionId
    ? await filter(base44, 'ExpressBackupObject', { session_id_hash: await sha256Hex(`session:${sessionId}`), status: 'available' })
    : await filter(base44, 'ExpressBackupObject', { source_record_id: sourceRecordId, status: 'available' });
  if (!records.length) return json({ ok: false, error: 'No independently backed-up records matched.' }, 404);
  const writer = loadPrivateS3Config('writer');
  if (!writer.configured) return json({ ok: false, setupRequired: true, error: 'Private backup read access is not configured.' }, 503);
  const preview = [];
  for (const index of records) {
    const existing = await base44.asServiceRole.entities[index.entity_name].get(index.source_record_id).catch(() => null);
    const response = await getPrivateObject(writer.config, index.s3_object_key, index.s3_object_version_id);
    const bodyText = await response.text();
    const checksum = await sha256Hex(bodyText);
    if (checksum !== index.payload_hash) throw new Error('A backup checksum did not match its index.');
    const envelope = JSON.parse(bodyText);
    preview.push({ backupObjectId: index.id, entityName: index.entity_name, sourceRecordId: index.source_record_id, conflict: Boolean(existing), envelope });
  }
  const conflicts = preview.filter((item) => item.conflict).length;
  const missing = preview.length - conflicts;
  const confirmation = restoreConfirmation(missing);
  const token = await createLifecycleToken({
    action: 'restore', backupObjectIds: preview.map((item) => item.backupObjectId),
    missing, conflicts, confirmationHash: await confirmationHash(confirmation),
  }, lifecycleSecret);
  return json({
    ok: true, token, expiresInSeconds: 600, total: preview.length, missing, conflicts,
    confirmation, records: preview.map(({ envelope: _envelope, ...item }) => item),
    overwriteAllowed: false,
  });
}

async function restoreApply(base44: any, body: Record<string, any>, lifecycleSecret: string) {
  const verified = await verifyLifecycleToken(body.token, lifecycleSecret);
  if (!verified.valid || verified.claims.action !== 'restore') return json({ ok: false, error: verified.valid ? 'Invalid restore authorization.' : verified.error }, 403);
  if (await confirmationHash(body.confirmation) !== verified.claims.confirmationHash) return json({ ok: false, error: 'The explicit restore confirmation does not match.' }, 400);
  const writer = loadPrivateS3Config('writer');
  if (!writer.configured) return json({ ok: false, setupRequired: true, error: 'Private backup read access is not configured.' }, 503);
  let restored = 0;
  let conflicts = 0;
  const pending: Array<{ index: any; record: Record<string, any> }> = [];
  const idMap = new Map<string, string>();
  for (const backupObjectId of verified.claims.backupObjectIds || []) {
    const index = await base44.asServiceRole.entities.ExpressBackupObject.get(backupObjectId);
    if (!index || index.status !== 'available') throw new Error('A restore source changed. Run preview again.');
    const existing = await base44.asServiceRole.entities[index.entity_name].get(index.source_record_id).catch(() => null);
    if (existing) { conflicts += 1; idMap.set(String(index.source_record_id), String(existing.id)); continue; }
    const response = await getPrivateObject(writer.config, index.s3_object_key, index.s3_object_version_id);
    const bodyText = await response.text();
    if (await sha256Hex(bodyText) !== index.payload_hash) throw new Error('A backup checksum did not match its index.');
    const envelope = JSON.parse(bodyText);
    pending.push({ index, record: envelope.record });
  }

  const writableRecord = (source: Record<string, any>): Record<string, any> => {
    const copy = { ...source };
    for (const field of ['id', 'created_date', 'updated_date', 'created_by', 'updated_by']) delete copy[field];
    return copy;
  };
  const groups = new Map<string, Array<{ index: any; record: Record<string, any> }>>();
  for (const item of pending) groups.set(item.index.entity_name, [...(groups.get(item.index.entity_name) || []), item]);
  const createGroup = async (entityName: string, transform: (record: Record<string, any>) => Record<string, any>) => {
    for (const item of groups.get(entityName) || []) {
      const created = await base44.asServiceRole.entities[entityName].create(transform(writableRecord(item.record)));
      idMap.set(String(item.index.source_record_id), String(created.id));
      restored += 1;
    }
  };

  await createGroup('FormDraft', (record) => {
    delete record.final_submission_id;
    return record;
  });
  await createGroup('FormSubmission', (record) => {
    if (record.linked_draft_id) record.linked_draft_id = idMap.get(String(record.linked_draft_id)) || '';
    return record;
  });
  for (const item of groups.get('FormDraft') || []) {
    const restoredDraftId = idMap.get(String(item.index.source_record_id));
    const restoredSubmissionId = item.record.final_submission_id
      ? idMap.get(String(item.record.final_submission_id))
      : '';
    if (restoredDraftId && restoredSubmissionId) {
      await base44.asServiceRole.entities.FormDraft.update(restoredDraftId, { final_submission_id: restoredSubmissionId });
    }
  }
  await createGroup('FormSubmissionIntake', (record) => {
    if (record.linked_submission_id) record.linked_submission_id = idMap.get(String(record.linked_submission_id)) || '';
    return record;
  });
  await createGroup('FormDraftEvent', (record) => record);
  await createGroup('SubmissionPdfVersion', (record) => {
    if (record.draft_id) record.draft_id = idMap.get(String(record.draft_id)) || record.draft_id;
    if (record.submission_id) record.submission_id = idMap.get(String(record.submission_id)) || record.submission_id;
    return record;
  });
  await createGroup('ExpressIdentityResolutionAttempt', (record) => {
    if (record.record_id) record.record_id = idMap.get(String(record.record_id)) || record.record_id;
    delete record.parent_attempt_id;
    return record;
  });
  for (const item of groups.get('ExpressIdentityResolutionAttempt') || []) {
    const restoredAttemptId = idMap.get(String(item.index.source_record_id));
    const restoredParentId = item.record.parent_attempt_id
      ? idMap.get(String(item.record.parent_attempt_id))
      : '';
    if (restoredAttemptId && restoredParentId) {
      await base44.asServiceRole.entities.ExpressIdentityResolutionAttempt.update(restoredAttemptId, {
        parent_attempt_id: restoredParentId,
      });
    }
  }

  return json({ ok: true, restored, conflicts, overwritten: 0, remappedStableIds: restored });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
  const base44 = createClientFromRequest(req);
  const recoverySecret = secret('DRAFT_RECOVERY_PASSWORD');
  const authorization = await authorizeRecoveryRequest({ base44, recoveryGrant: body.recoveryGrant, recoverySecret });
  if (!authorization.authorized) return json({ ok: false, error: authorization.error }, 403);
  const lifecycleSecret = secret('EXPRESS_DATA_LIFECYCLE_SIGNING_KEY');
  if (!lifecycleSecret && body.action !== 'status') return json({ ok: false, setupRequired: true, error: 'Manual data lifecycle authorization is not configured.' }, 503);
  try {
    if (body.action === 'status') return json({ ok: true, ...(await backupStatus(base44)) });
    if (body.action === 'prepareDeletion') return await prepareDeletion(
      base44, body, lifecycleSecret,
      authorization.mode === 'admin' ? authorization.userId || 'base44_admin' : 'recovery_administrator',
    );
    if (body.action === 'executeDeletion') return await executeDeletion(base44, body, lifecycleSecret, authorization.mode);
    if (body.action === 'restorePreview') return await restorePreview(base44, body, lifecycleSecret);
    if (body.action === 'restoreApply') return await restoreApply(base44, body, lifecycleSecret);
    return json({ ok: false, error: 'Unsupported action.' }, 400);
  } catch (error) {
    console.error('Express recovery lifecycle request failed', error instanceof Error ? error.message : 'unknown');
    return json({ ok: false, error: 'The recovery lifecycle request failed without overwriting existing data.' }, 500);
  }
});
