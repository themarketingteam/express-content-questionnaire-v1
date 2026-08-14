import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { secrets } from 'base44:runtime';
import {
  createIdentityFingerprint,
  getChicagoScheduleParts,
  isChicagoIdentityRecoveryWindow,
  isMissingIdentityValue,
  resolveSubmissionIdentity,
} from './submissionIdentityRecovery.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};
const DRAFT_STATUSES = ['submit_attempted', 'submit_failed', 'auto_repair_pending', 'auto_repair_failed'];
const INTAKE_STATUSES = ['received_intake', 'auto_repair_pending', 'retry_pending', 'retry_failed'];
const MAX_RECORDS = 10;
const CONCURRENCY = 2;
const WORK_DEADLINE_MS = 150_000;

function readSecret(name: string): string {
  try { return secrets.get(name) || ''; } catch { return ''; }
}

function readBooleanSecret(name: string, fallback: boolean): boolean {
  const raw = readSecret(name).trim().toLowerCase();
  if (!raw) return fallback;
  return !['0', 'false', 'no', 'off', 'disabled'].includes(raw);
}

function identityMissing(recordType: 'draft' | 'intake', record: Record<string, unknown>): boolean {
  return isMissingIdentityValue(record.business_name) || isMissingIdentityValue(
    recordType === 'draft' ? record.domain : record.business_domain,
  );
}

function eligibleRecord(recordType: 'draft' | 'intake', record: Record<string, unknown>): boolean {
  if (record.archived === true || record.active_investigation === true || record.legal_hold === true || record.retention_hold === true) return false;
  if (recordType === 'draft' && record.final_submission_id) return false;
  if (recordType === 'intake' && record.linked_submission_id) return false;
  return identityMissing(recordType, record);
}

async function loadCandidates(base44: any): Promise<Array<{ recordType: 'draft' | 'intake'; record: Record<string, unknown> }>> {
  const output: Array<{ recordType: 'draft' | 'intake'; record: Record<string, unknown> }> = [];
  for (const status of DRAFT_STATUSES) {
    const records = await base44.asServiceRole.entities.FormDraft.filter(
      { status, archived: { $ne: true } },
      'last_identity_recovery_at',
      MAX_RECORDS,
    );
    for (const record of records || []) if (eligibleRecord('draft', record)) output.push({ recordType: 'draft', record });
  }
  for (const status of INTAKE_STATUSES) {
    const records = await base44.asServiceRole.entities.FormSubmissionIntake.filter(
      { status, archived: { $ne: true } },
      'last_identity_recovery_at',
      MAX_RECORDS,
    );
    for (const record of records || []) if (eligibleRecord('intake', record)) output.push({ recordType: 'intake', record });
  }
  const unique = new Map<string, { recordType: 'draft' | 'intake'; record: Record<string, unknown> }>();
  for (const candidate of output) unique.set(`${candidate.recordType}:${candidate.record.id}`, candidate);
  return [...unique.values()].sort((left, right) => {
    const leftDate = Date.parse(String(left.record.last_identity_recovery_at || left.record.updated_date || left.record.created_date || '')) || 0;
    const rightDate = Date.parse(String(right.record.last_identity_recovery_at || right.record.updated_date || right.record.created_date || '')) || 0;
    return leftDate - rightDate;
  });
}

async function attemptedToday(base44: any, candidate: { recordType: 'draft' | 'intake'; record: Record<string, unknown> }, runDate: string): Promise<boolean> {
  const fingerprint = await createIdentityFingerprint(candidate.recordType, candidate.record);
  const attempts = await base44.asServiceRole.entities.ExpressIdentityResolutionAttempt.filter({
    event_type: 'resolution',
    record_type: candidate.recordType,
    record_id: candidate.record.id,
    payload_fingerprint: fingerprint,
    trigger: 'scheduled',
  }, '-created_date', 1);
  const latest = attempts?.[0];
  return Boolean(latest?.created_date && getChicagoScheduleParts(new Date(latest.created_date)).date === runDate);
}

async function claimDailyRun(base44: any, runDate: string, autoApplyEnabled: boolean) {
  const existing = await base44.asServiceRole.entities.ExpressIdentityRecoveryRun.filter({ run_date: runDate }, 'created_date', 10);
  if (existing?.length) return { claimed: false, run: existing[0] };

  const created = await base44.asServiceRole.entities.ExpressIdentityRecoveryRun.create({
    run_date: runDate,
    status: 'running',
    started_at: new Date().toISOString(),
    auto_apply_enabled: autoApplyEnabled,
    metrics_json: '{}',
  });
  await new Promise((resolve) => setTimeout(resolve, 125));
  const contenders = await base44.asServiceRole.entities.ExpressIdentityRecoveryRun.filter({ run_date: runDate }, 'created_date', 10);
  const winner = contenders?.[0];
  if (winner?.id !== created.id) {
    await base44.asServiceRole.entities.ExpressIdentityRecoveryRun.update(created.id, {
      status: 'duplicate',
      completed_at: new Date().toISOString(),
    });
    return { claimed: false, run: winner };
  }
  return { claimed: true, run: created };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  });
  await Promise.all(runners);
  return results;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return Response.json({ ok: false, error: 'Method not allowed.' }, { status: 405, headers: corsHeaders });

  const startedAt = Date.now();
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* scheduled calls may have no explicit args */ }
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const forcedByAdmin = body.force === true && user?.role === 'admin';
  const scheduledInvocation = body.args?.trigger === 'scheduled_identity_recovery';
  const now = new Date();

  if (!forcedByAdmin) {
    if (!scheduledInvocation) {
      return Response.json({ ok: false, error: 'Scheduled invocation or Base44 administrator access is required.' }, { status: 403, headers: corsHeaders });
    }
    if (!isChicagoIdentityRecoveryWindow(now)) {
      return Response.json({ ok: true, skipped: true, reason: 'outside_4am_america_chicago_window' }, { headers: corsHeaders });
    }
  }

  if (!readBooleanSecret('IDENTITY_RECOVERY_ENABLED', true)) {
    return Response.json({ ok: true, skipped: true, reason: 'identity_recovery_disabled' }, { headers: corsHeaders });
  }

  const schedule = getChicagoScheduleParts(now);
  const autoApplyEnabled = readBooleanSecret('IDENTITY_SCHEDULED_AUTO_APPLY_ENABLED', false);
  const claim = await claimDailyRun(base44, schedule.date, autoApplyEnabled);
  if (!claim.claimed && !forcedByAdmin) {
    return Response.json({ ok: true, skipped: true, reason: 'weekday_run_already_claimed', runId: claim.run?.id || null }, { headers: corsHeaders });
  }

  const run = claim.run;
  const metrics: Record<string, any> = {
    eligible: 0,
    attempted: 0,
    auto_eligible: 0,
    applied: 0,
    needs_review: 0,
    provider_failures: 0,
    stale_write_aborts: 0,
    skipped_unchanged_today: 0,
    remaining_backlog: 0,
    auto_apply_enabled: autoApplyEnabled,
  };

  try {
    const candidates = await loadCandidates(base44);
    metrics.eligible = candidates.length;
    const selected = [];
    for (const candidate of candidates) {
      if (selected.length >= MAX_RECORDS || Date.now() - startedAt >= WORK_DEADLINE_MS) break;
      if (await attemptedToday(base44, candidate, schedule.date)) {
        metrics.skipped_unchanged_today += 1;
        continue;
      }
      selected.push(candidate);
    }
    metrics.remaining_backlog = Math.max(0, candidates.length - selected.length - metrics.skipped_unchanged_today);

    const results = await mapWithConcurrency(selected, CONCURRENCY, async (candidate) => {
      if (Date.now() - startedAt >= WORK_DEADLINE_MS) return { ok: false, skipped: true, reason: 'work_deadline' };
      try {
        const result = await resolveSubmissionIdentity({
          base44,
          recordType: candidate.recordType,
          record: candidate.record,
          trigger: 'scheduled',
          apply: autoApplyEnabled,
          serpApiKey: readSecret('SERPAPI_API_KEY'),
          recoveryEnabled: true,
          webSearchEnabled: readBooleanSecret('IDENTITY_WEB_SEARCH_ENABLED', true),
        });
        const resolution = result.resolution;
        metrics.attempted += 1;
        if (resolution.businessName?.autoEligible || resolution.domain?.autoEligible) metrics.auto_eligible += 1;
        if (resolution.appliedFields?.length) metrics.applied += 1;
        if (resolution.status === 'needs_review') metrics.needs_review += 1;
        if (resolution.status === 'provider_error') metrics.provider_failures += 1;
        if (resolution.status === 'stale') metrics.stale_write_aborts += 1;
        return {
          ok: true,
          recordType: candidate.recordType,
          recordId: candidate.record.id,
          attemptId: resolution.attemptId,
          status: resolution.status,
          appliedFields: resolution.appliedFields,
        };
      } catch (error) {
        metrics.provider_failures += 1;
        return { ok: false, recordType: candidate.recordType, recordId: candidate.record.id, error: error?.message || 'Identity recovery failed.' };
      }
    });

    metrics.duration_ms = Date.now() - startedAt;
    await base44.asServiceRole.entities.ExpressIdentityRecoveryRun.update(run.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      metrics_json: JSON.stringify(metrics),
    });
    console.info(JSON.stringify({ functionName: 'recoverMissingSubmissionIdentity', runId: run.id, ...metrics }));
    return Response.json({ ok: true, runId: run.id, shadowMode: !autoApplyEnabled, metrics, results }, { headers: corsHeaders });
  } catch (error) {
    metrics.duration_ms = Date.now() - startedAt;
    await base44.asServiceRole.entities.ExpressIdentityRecoveryRun.update(run.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      metrics_json: JSON.stringify(metrics),
      error_json: JSON.stringify({ message: error?.message || 'Scheduled identity recovery failed.' }),
    }).catch(() => undefined);
    return Response.json({ ok: false, error: error?.message || 'Scheduled identity recovery failed.', metrics }, { status: 500, headers: corsHeaders });
  }
});
