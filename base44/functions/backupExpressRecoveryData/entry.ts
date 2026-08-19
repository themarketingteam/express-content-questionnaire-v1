import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { secrets } from 'base44:runtime';
import {
  BACKUP_ENTITY_NAMES,
  BACKUP_SCHEMA_VERSION,
  buildRecordBackup,
  buildSignedManifest,
  isUsableCompletedBackupRun,
  recordFallsWithinBackupWindow,
} from './backupPolicy.ts';
import { putPrivateObject, sha256Hex } from './privateS3.ts';
import { loadManifestSigningKey, loadPrivateS3Config } from './privateS3Config.ts';
import { authorizeRecoveryRequest } from './recoveryAuthorization.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};
const PAGE_SIZE = 5_000;
const MAX_RECORDS_PER_INVOCATION = 1_000;
const MAX_SCANNED_PER_INVOCATION = 40_000;
const CONCURRENCY = 8;
const DEADLINE_MS = 130_000;
const BASE44_RETRY_ATTEMPTS = 7;
const BULK_WRITE_SIZE = 100;
const TRUSTED_PDF_SOURCE_HOSTS = new Set(['base44.app', 'media.base44.com']);
const MAX_PDF_REDIRECTS = 3;

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers });
}

function readSecret(name: string): string {
  try { return (secrets.get(name) || '').trim(); } catch { return ''; }
}

function enabled(name: string): boolean {
  return ['1', 'true', 'yes', 'enabled'].includes(readSecret(name).toLowerCase());
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function trustedPdfSourceUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !TRUSTED_PDF_SOURCE_HOSTS.has(url.hostname)) {
    throw new Error('PDF source host is not approved for migration.');
  }
  return url;
}

async function fetchTrustedPdfSource(sourceUrl: string): Promise<Response> {
  let current = trustedPdfSourceUrl(sourceUrl);
  for (let redirect = 0; redirect <= MAX_PDF_REDIRECTS; redirect += 1) {
    const response = await fetch(current, { redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location || redirect === MAX_PDF_REDIRECTS) throw new Error('PDF source redirect could not be resolved safely.');
    current = trustedPdfSourceUrl(new URL(location, current).toString());
  }
  throw new Error('PDF source exceeded the approved redirect limit.');
}

function isRetryableBase44Error(error: unknown): boolean {
  const candidate = error as { message?: string; status?: number; response?: { status?: number } };
  const message = String(candidate?.message || '').toLowerCase();
  return candidate?.status === 429
    || candidate?.response?.status === 429
    || message.includes('rate limit')
    || message.includes('too many requests');
}

async function withBase44Retry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < BASE44_RETRY_ATTEMPTS; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (!isRetryableBase44Error(error) || attempt === BASE44_RETRY_ATTEMPTS - 1) throw error;
      await delay(Math.min(12_000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 250));
    }
  }
  throw lastError;
}

function parseJson(value: unknown, fallback: Record<string, any>): Record<string, any> {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function chicagoParts(date = new Date()): { date: string; hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    weekday: get('weekday'),
  };
}

function scheduledStartAllowed(now = new Date()): boolean {
  const parts = chicagoParts(now);
  return parts.hour === 3;
}

async function mapWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  let index = 0;
  const results: R[] = [];
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function backupPdfIfNeeded(base44: any, config: any, record: Record<string, any>): Promise<Record<string, any>> {
  const existingKey = String(record.s3_object_key || '');
  if (existingKey) return record;
  let sourceUrl = '';
  if (record.pdf_file_uri) {
    const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: record.pdf_file_uri,
      expires_in: 120,
    });
    sourceUrl = String(signed?.signed_url || signed?.data?.signed_url || '');
  } else if (typeof record.pdf_file_url === 'string' && record.pdf_file_url.startsWith('https://')) {
    sourceUrl = record.pdf_file_url;
  }
  if (!sourceUrl) return record;
  const response = await fetchTrustedPdfSource(sourceUrl);
  if (!response.ok) throw new Error(`PDF source read failed with HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
    throw new Error('PDF source did not contain a valid PDF signature.');
  }
  const objectHash = await sha256Hex(`pdf:${record.id}`);
  const key = `pdf/v1/${objectHash.slice(0, 2)}/${objectHash}.pdf`;
  const uploaded = await putPrivateObject({
    config,
    key,
    body: bytes,
    contentType: 'application/pdf',
    metadata: { schema: BACKUP_SCHEMA_VERSION },
  });
  const pdfSha256 = await sha256Hex(bytes);
  await withBase44Retry(() => base44.asServiceRole.entities.SubmissionPdfVersion.update(record.id, {
    s3_object_key: key,
    s3_object_version_id: uploaded.versionId,
    s3_object_sha256: pdfSha256,
    storage_visibility: 'private',
  }));
  return {
    ...record,
    s3_object_key: key,
    s3_object_version_id: uploaded.versionId,
    s3_object_sha256: pdfSha256,
    storage_visibility: 'private',
  };
}

async function loadBackupIndexMap(base44: any, entityName: string): Promise<Map<string, any>> {
  const entity = base44.asServiceRole.entities.ExpressBackupObject;
  const map = new Map<string, any>();
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await withBase44Retry<any[]>(() => entity.filter(
      { entity_name: entityName }, 'source_record_id', PAGE_SIZE, skip, ['id', 'source_record_id'],
    ));
    page.forEach((record) => map.set(String(record.source_record_id), record));
    if (page.length < PAGE_SIZE) break;
  }
  return map;
}

async function bulkCreateMissingIndexes(
  base44: any,
  entityName: string,
  pendingValues: Array<Record<string, any>>,
): Promise<void> {
  const entity = base44.asServiceRole.entities.ExpressBackupObject;
  let pending = pendingValues;
  for (let attempt = 0; attempt < BASE44_RETRY_ATTEMPTS && pending.length > 0; attempt += 1) {
    try { await entity.bulkCreate(pending); return; }
    catch (error) {
      if (!isRetryableBase44Error(error) || attempt === BASE44_RETRY_ATTEMPTS - 1) throw error;
      await delay(Math.min(12_000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 250));
      const current = await loadBackupIndexMap(base44, entityName);
      pending = pending.filter((values) => !current.has(String(values.source_record_id)));
    }
  }
}

async function upsertBackupIndexes(base44: any, entityName: string, values: Array<Record<string, any>>): Promise<void> {
  if (values.length === 0) return;
  const entity = base44.asServiceRole.entities.ExpressBackupObject;
  const existing = await loadBackupIndexMap(base44, entityName);
  const updates = values
    .filter((item) => existing.has(String(item.source_record_id)))
    .map((item) => ({ ...item, id: existing.get(String(item.source_record_id)).id }));
  const creates = values.filter((item) => !existing.has(String(item.source_record_id)));
  for (let index = 0; index < updates.length; index += BULK_WRITE_SIZE) {
    await withBase44Retry(() => entity.bulkUpdate(updates.slice(index, index + BULK_WRITE_SIZE)));
  }
  for (let index = 0; index < creates.length; index += BULK_WRITE_SIZE) {
    await bulkCreateMissingIndexes(base44, entityName, creates.slice(index, index + BULK_WRITE_SIZE));
  }
}

async function processRecord(base44: any, config: any, run: any, entityName: any, source: Record<string, any>): Promise<{
  hash: string;
  bytes: number;
  index: Record<string, any>;
}> {
  const now = new Date().toISOString();
  const record = entityName === 'SubmissionPdfVersion'
    ? await backupPdfIfNeeded(base44, config, source)
    : source;
  const backup = await buildRecordBackup({ entityName, record, backedUpAt: now });
  const uploaded = await putPrivateObject({
    config,
    key: backup.key,
    body: new TextEncoder().encode(backup.body),
    metadata: { schema: BACKUP_SCHEMA_VERSION, entity: await sha256Hex(entityName) },
  });
  const index = {
    entity_name: entityName,
    source_record_id: String(record.id),
    record_id_hash: backup.recordIdHash,
    ...(backup.sessionIdHash ? { session_id_hash: backup.sessionIdHash } : {}),
    s3_object_key: backup.key,
    s3_object_version_id: uploaded.versionId,
    payload_hash: backup.payloadHash,
    source_updated_at: String(record.updated_date || record.created_date || now),
    backed_up_at: now,
    run_id: run.run_id,
    status: 'available',
  };
  return { hash: backup.payloadHash, bytes: new TextEncoder().encode(backup.body).byteLength, index };
}

async function newestCompletedRun(base44: any): Promise<any | null> {
  const runs = await withBase44Retry<any[]>(() => base44.asServiceRole.entities.ExpressBackupRun.filter({ status: 'completed' }, '-completed_at', 20));
  return runs?.find((run: Record<string, unknown>) => isUsableCompletedBackupRun(run)) || null;
}

async function runningRun(base44: any): Promise<any | null> {
  const runs = await withBase44Retry<any[]>(() => base44.asServiceRole.entities.ExpressBackupRun.filter({ status: 'running' }, 'started_at', 5));
  return runs?.[0] || null;
}

async function recoverableFailedRun(base44: any): Promise<any | null> {
  const runs = await withBase44Retry<any[]>(() => base44.asServiceRole.entities.ExpressBackupRun.filter(
    { status: 'failed' }, '-updated_date', 10,
  ));
  return runs?.find((run: Record<string, unknown>) =>
    run.error_code === 'backup_failed' && Boolean(run.cursor_json)) || null;
}

async function resumeFailedRun(base44: any, run: any): Promise<any> {
  const values = { status: 'running', error_code: '', configuration_status: 'configured' };
  await withBase44Retry(() => base44.asServiceRole.entities.ExpressBackupRun.update(run.id, values));
  return { ...run, ...values };
}

async function createRun(base44: any, trigger: string): Promise<any> {
  const existing = await runningRun(base44);
  if (existing) return existing;
  const previous = await newestCompletedRun(base44);
  const startedAt = new Date().toISOString();
  const values = {
    run_id: crypto.randomUUID(),
    status: 'running', trigger, schema_version: BACKUP_SCHEMA_VERSION, started_at: startedAt,
    cursor_json: JSON.stringify({
      entityIndex: 0, offset: 0, since: previous?.completed_at || '', cutoff: startedAt, counts: {},
    }),
    metrics_json: '{}', configuration_status: 'configured',
  };
  for (let attempt = 0; attempt < BASE44_RETRY_ATTEMPTS; attempt += 1) {
    try { return await base44.asServiceRole.entities.ExpressBackupRun.create(values); }
    catch (error) {
      if (!isRetryableBase44Error(error) || attempt === BASE44_RETRY_ATTEMPTS - 1) throw error;
      await delay(Math.min(12_000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 250));
      const afterFailure = await runningRun(base44);
      if (afterFailure) return afterFailure;
    }
  }
  throw new Error('Unable to create a resumable backup run.');
}

async function completeRun(base44: any, config: any, run: any, cursor: Record<string, any>): Promise<any> {
  const completedAt = new Date().toISOString();
  const manifest = await buildSignedManifest({
    runId: run.run_id,
    startedAt: run.started_at,
    completedAt,
    counts: cursor.counts || {},
    checksums: cursor.checksums || {},
    signingKey: loadManifestSigningKey(),
  });
  const uploaded = await putPrivateObject({
    config,
    key: manifest.key,
    body: new TextEncoder().encode(manifest.body),
    metadata: { schema: BACKUP_SCHEMA_VERSION, kind: 'manifest' },
  });
  const values = {
    status: 'completed',
    completed_at: completedAt,
    last_success_at: completedAt,
    cursor_json: JSON.stringify(cursor),
    metrics_json: JSON.stringify({
      counts: cursor.counts || {},
      records: cursor.total || 0,
      fullSnapshot: !cursor.since,
    }),
    manifest_key: manifest.key,
    manifest_hash: manifest.hash,
    configuration_status: 'configured',
  };
  await withBase44Retry(() => base44.asServiceRole.entities.ExpressBackupRun.update(run.id, values));
  return { ...run, ...values, manifestVersionId: uploaded.versionId };
}

async function continueRun(base44: any, config: any, run: any): Promise<{ run: any; complete: boolean; processed: number }> {
  const started = Date.now();
  const cursor = parseJson(run.cursor_json, { entityIndex: 0, offset: 0, since: '', cutoff: run.started_at, counts: {} });
  let processed = 0;
  let scanned = 0;
  while (
    cursor.entityIndex < BACKUP_ENTITY_NAMES.length
    && processed < MAX_RECORDS_PER_INVOCATION
    && scanned < MAX_SCANNED_PER_INVOCATION
    && Date.now() - started < DEADLINE_MS
  ) {
    const entityName = BACKUP_ENTITY_NAMES[cursor.entityIndex];
    const entity = base44.asServiceRole.entities[entityName];
    const scanLimit = Math.min(PAGE_SIZE, MAX_SCANNED_PER_INVOCATION - scanned);
    const records = await withBase44Retry(() => entity.list('created_date', scanLimit, cursor.offset)) as Array<Record<string, any>>;
    const selected: Array<Record<string, any>> = [];
    let consumed = 0;
    const remainingRecords = MAX_RECORDS_PER_INVOCATION - processed;
    for (const record of records || []) {
      consumed += 1;
      if (recordFallsWithinBackupWindow(record, String(cursor.since || ''), String(cursor.cutoff || ''))) {
        selected.push(record);
        if (selected.length >= remainingRecords) break;
      }
    }
    const results = await mapWithConcurrency(selected, (record) => processRecord(base44, config, run, entityName, record));
    await upsertBackupIndexes(base44, entityName, results.map((result) => result.index));
    const count = selected.length;
    cursor.counts[entityName] = Number(cursor.counts[entityName] || 0) + count;
    cursor.bytes = Number(cursor.bytes || 0) + results.reduce((sum, result) => sum + result.bytes, 0);
    cursor.checksums = cursor.checksums || {};
    if (count > 0) {
      cursor.checksums[entityName] = await sha256Hex(
        `${cursor.checksums[entityName] || ''}:${results.map((result) => result.hash).sort().join(':')}`,
      );
    }
    cursor.total = Number(cursor.total || 0) + count;
    processed += count;
    scanned += consumed;
    cursor.offset += consumed;
    if ((records?.length || 0) < scanLimit && consumed === (records?.length || 0)) {
      cursor.entityIndex += 1;
      cursor.offset = 0;
    }
  }
  if (cursor.entityIndex >= BACKUP_ENTITY_NAMES.length) {
    if (!cursor.since && Number(cursor.total || 0) === 0) {
      const sourceHasRecords = (await Promise.all(BACKUP_ENTITY_NAMES.map(async (entityName) => {
        const probe = await withBase44Retry<any[]>(() => base44.asServiceRole.entities[entityName].list('created_date', 1, 0, ['id']));
        return probe.length > 0;
      }))).some(Boolean);
      if (sourceHasRecords) throw new Error('Initial backup scanned source data but selected zero records.');
    }
    return { run: await completeRun(base44, config, run, cursor), complete: true, processed };
  }
  await withBase44Retry(() => base44.asServiceRole.entities.ExpressBackupRun.update(run.id, {
    cursor_json: JSON.stringify(cursor),
    metrics_json: JSON.stringify({
      counts: cursor.counts,
      records: cursor.total || 0,
      fullSnapshot: !cursor.since,
      scanned,
    }),
  }));
  return { run: { ...run, cursor_json: JSON.stringify(cursor) }, complete: false, processed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* scheduled calls may omit args */ }
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const trigger = String(body.args?.trigger || '');
  const scheduled = trigger === 'scheduled_backup_start' || trigger === 'scheduled_backup_worker';
  if (!scheduled && user?.role !== 'admin') {
    const authorization = await authorizeRecoveryRequest({
      base44,
      recoveryGrant: body.recoveryGrant,
      recoverySecret: readSecret('DRAFT_RECOVERY_PASSWORD'),
    });
    if (!authorization.authorized) return json({ ok: false, error: authorization.error }, 403);
  }
  if (scheduled && !enabled('EXPRESS_BACKUP_SCHEDULE_ENABLED')) {
    return json({ ok: true, skipped: true, reason: 'backup_schedule_disabled' });
  }

  const writer = loadPrivateS3Config('writer');
  const signingKey = loadManifestSigningKey();
  if (!writer.configured || !signingKey) {
    const now = new Date().toISOString();
    const missing = [...writer.missing, ...(!signingKey ? ['manifestSigningKey'] : [])];
    if (user?.role === 'admin' && body.action === 'start') {
      await withBase44Retry(() => base44.asServiceRole.entities.ExpressBackupRun.create({
        run_id: crypto.randomUUID(), status: 'setup_required', trigger: 'manual',
        schema_version: BACKUP_SCHEMA_VERSION, started_at: now, completed_at: now,
        error_code: 'aws_setup_required', configuration_status: `missing:${missing.join(',')}`,
      }));
    }
    return json({ ok: false, setupRequired: true, missing }, 503);
  }

  try {
    if (trigger === 'scheduled_backup_start' && !scheduledStartAllowed()) {
      return json({ ok: true, skipped: true, reason: 'outside_3am_america_chicago_window' });
    }
    let run = await runningRun(base44);
    const shouldStart = body.action === 'start' || trigger === 'scheduled_backup_start';
    if (!run && shouldStart) {
      const recoverable = await recoverableFailedRun(base44);
      run = recoverable
        ? await resumeFailedRun(base44, recoverable)
        : await createRun(base44, scheduled ? 'scheduled' : 'manual');
    }
    if (!run) return json({ ok: true, skipped: true, reason: 'no_running_backup' });
    const result = await continueRun(base44, writer.config, run);
    return json({ ok: true, runId: result.run.run_id, complete: result.complete, processed: result.processed });
  } catch (error) {
    const run = await runningRun(base44);
    if (run) await withBase44Retry(() => base44.asServiceRole.entities.ExpressBackupRun.update(run.id, {
      status: 'failed', completed_at: new Date().toISOString(), error_code: 'backup_failed',
    })).catch(() => null);
    console.error('Express independent backup failed', error instanceof Error ? error.message : 'unknown');
    return json({ ok: false, error: 'The independent backup failed. Source records were not changed.' }, 500);
  }
});
