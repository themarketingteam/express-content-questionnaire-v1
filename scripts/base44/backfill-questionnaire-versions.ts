const APPLY = false;
const RUN_KEY = 'express-questionnaire-version-backfill-v1';
const PAGE_SIZE = 25;
const POLICY = 'indefinite_until_manual_deletion';
const POLICY_VERSION = '2026-08-18';
const knownVersionKeys = new Set();

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (!text(value)) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalize(value, kind = 'text') {
  let result = text(value).toLowerCase();
  if (kind === 'domain') result = result.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].replace(/\/$/, '');
  if (kind === 'email') result = result.replace(/\s+/g, '');
  return result.replace(/\s+/g, kind === 'text' ? ' ' : '');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, stable(nested)]));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function populated(value) {
  if (Array.isArray(value)) return value.some(populated);
  if (value && typeof value === 'object') return Object.values(value).some(populated);
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined && value !== false;
}

const QUESTION_FIELDS = [
  ['itCompanyType', 'itCompanyTypeOther'], ['serviceOfferings', 'serviceOfferingsOther'],
  ['differentiation'], ['geographicAreas', 'geographicAreaMeta'],
  ['pricingPackaging', 'pricingPackagingOther'], ['companyGoals', 'companyGoalsOther'],
  ['brandTone', 'brandToneOther'], ['targetIndustries', 'targetIndustriesOther'],
  ['clientSize'], ['clientChallenges', 'clientChallengesOther'],
  ['clientOutcomes', 'clientOutcomesOther'], ['idealClient'],
];

function metrics(snapshot) {
  const responses = parseObject(snapshot.responses_json);
  const answerCount = Object.values(responses).filter(populated).length;
  const completed = QUESTION_FIELDS.filter((fields) => fields.some((field) => populated(responses[field]))).length;
  return { answerCount, progressPercent: Math.round(completed / QUESTION_FIELDS.length * 100) };
}

function snapshotFromDraft(draft) {
  const blocked = new Set([
    'draft_access_key_hash', 'draft_recovery_access_key_hashes',
    'idempotency_lock_token', 'idempotency_lock_key', 'idempotency_lock_expires_at',
  ]);
  return Object.fromEntries(Object.entries(draft).filter(([key]) => !blocked.has(key)));
}

async function loadAll(entityName, sort = 'created_date') {
  const records = [];
  for (let skip = 0; ; skip += 5000) {
    const page = await base44.entities[entityName].list(sort, 5000, skip);
    records.push(...page);
    if (page.length < 5000) return records;
  }
}

async function createVersionIfMissing({ draft, snapshot, versionKey, type, capturedAt, sourceRecordId, reconstructionLabel = '', reasons = [] }) {
  if (knownVersionKeys.has(versionKey)) return { created: false, id: '' };
  const serialized = JSON.stringify(stable(snapshot));
  const hash = await sha256(serialized);
  const valueMetrics = metrics(snapshot);
  if (APPLY) {
    const created = await base44.entities.QuestionnaireVersion.create({
      draft_id: draft.id,
      session_id: draft.session_id,
      version_key: versionKey,
      version_type: type,
      status: snapshot.status || draft.status || 'draft',
      snapshot_json: serialized,
      snapshot_hash: hash,
      answer_count: valueMetrics.answerCount,
      progress_percent: valueMetrics.progressPercent,
      client_revision: Number(snapshot.last_confirmed_revision || snapshot.client_revision || 0),
      meaningful: true,
      meaningful_reasons_json: JSON.stringify(reasons),
      captured_at: capturedAt || draft.last_saved_at || draft.updated_date || draft.created_date,
      source_record_id: sourceRecordId || draft.id,
      normalized_user_id: normalize(draft.user_id),
      normalized_email: normalize(draft.user_email, 'email'),
      normalized_business_name: normalize(draft.business_name),
      normalized_domain: normalize(draft.domain, 'domain'),
      reconstruction_label: reconstructionLabel,
      retention_policy: POLICY,
      retention_policy_version: POLICY_VERSION,
      retention_protected_at: new Date().toISOString(),
    });
    knownVersionKeys.add(versionKey);
    return { created: true, id: created.id };
  }
  return { created: true, id: '' };
}

const drafts = await loadAll('FormDraft', 'created_date');
const submissions = await loadAll('FormSubmission', 'created_date');
const intakes = await loadAll('FormSubmissionIntake', 'created_date');
const versionsBefore = await loadAll('QuestionnaireVersion', 'created_date');
for (const version of versionsBefore) knownVersionKeys.add(text(version.version_key));
const versionCountBefore = versionsBefore.length;
const draftsBySession = new Map();
for (const draft of drafts) {
  const session = text(draft.session_id);
  if (session) draftsBySession.set(session, [...(draftsBySession.get(session) || []), draft]);
}
const draftById = new Map(drafts.map((draft) => [String(draft.id), draft]));

let run = null;
let startCursor = 0;
if (APPLY) {
  const runs = await base44.entities.QuestionnaireVersionBackfillRun.filter({ run_key: RUN_KEY }, '-created_date', 1);
  run = runs?.[0] || await base44.entities.QuestionnaireVersionBackfillRun.create({
    run_key: RUN_KEY, status: 'running', mode: 'apply', cursor: 0, total_drafts: drafts.length,
    created_versions: 0, existing_versions: 0, normalized_drafts: 0, unrecoverable_records: 0,
    report_json: '{}', started_at: new Date().toISOString(),
  });
  startCursor = run.status === 'complete' ? 0 : Number(run.cursor || 0);
}

const report = {
  mode: APPLY ? 'apply' : 'dry_run',
  counts: { drafts: drafts.length, submissions: submissions.length, intakes: intakes.length, versionsBefore: versionCountBefore },
  plannedOrCreated: { baselines: 0, finalSubmissions: 0, submissionIntakes: 0, reconstructedCandidates: 0 },
  existingVersions: 0,
  normalizedDrafts: 0,
  unrecoverable: [],
  resumedAtCursor: startCursor,
};

for (let cursor = startCursor; cursor < drafts.length; cursor += PAGE_SIZE) {
  const page = drafts.slice(cursor, cursor + PAGE_SIZE);
  for (const draft of page) {
    const normalizedPatch = {
      normalized_user_id: normalize(draft.user_id),
      normalized_user_email: normalize(draft.user_email, 'email'),
      normalized_business_name: normalize(draft.business_name),
      normalized_domain: normalize(draft.domain, 'domain'),
    };
    if (Object.entries(normalizedPatch).some(([key, value]) => text(draft[key]) !== value)) {
      report.normalizedDrafts += 1;
      if (APPLY) await base44.entities.FormDraft.update(draft.id, normalizedPatch);
    }

    const baseline = await createVersionIfMissing({
      draft,
      snapshot: snapshotFromDraft({ ...draft, ...normalizedPatch }),
      versionKey: `${draft.id}:legacy-current-baseline-v1`,
      type: 'legacy_baseline',
      capturedAt: draft.last_saved_at || draft.updated_date || draft.created_date,
      sourceRecordId: draft.id,
      reconstructionLabel: 'Legacy current-state baseline; not claimed as a historical autosave',
      reasons: ['legacy_current_baseline'],
    });
    baseline.created ? report.plannedOrCreated.baselines += 1 : report.existingVersions += 1;

    const lastNonEmpty = parseObject(draft.last_non_empty_answers_json);
    if (Object.values(lastNonEmpty).some(populated)) {
      const currentResponses = parseObject(draft.responses_json);
      if (JSON.stringify(stable(lastNonEmpty)) !== JSON.stringify(stable(currentResponses))) {
        const candidateSnapshot = { ...snapshotFromDraft(draft), responses_json: JSON.stringify(lastNonEmpty) };
        const candidate = await createVersionIfMissing({
          draft, snapshot: candidateSnapshot,
          versionKey: `${draft.id}:reconstructed-last-non-empty-v1`,
          type: 'reconstructed_candidate',
          capturedAt: draft.last_saved_at || draft.updated_date || draft.created_date,
          sourceRecordId: draft.id,
          reconstructionLabel: 'Reconstructed recovery candidate from last_non_empty_answers_json; not an authentic autosave',
          reasons: ['reconstructed_recovery_candidate'],
        });
        candidate.created ? report.plannedOrCreated.reconstructedCandidates += 1 : report.existingVersions += 1;
      }
    }
  }
  if (APPLY && run) {
    await base44.entities.QuestionnaireVersionBackfillRun.update(run.id, {
      cursor: Math.min(drafts.length, cursor + page.length),
      created_versions: Object.values(report.plannedOrCreated).reduce((sum, value) => sum + value, 0),
      existing_versions: report.existingVersions,
      normalized_drafts: report.normalizedDrafts,
      report_json: JSON.stringify(report),
    });
  }
}

for (const submission of submissions) {
  const draft = draftById.get(String(submission.linked_draft_id || ''))
    || ((draftsBySession.get(text(submission.questionnaire_session_id)) || []).length === 1
      ? (draftsBySession.get(text(submission.questionnaire_session_id)) || [])[0]
      : null);
  if (!draft) {
    report.unrecoverable.push({ type: 'submission', id: submission.id, reason: 'no_strong_unique_draft_link' });
    continue;
  }
  const responses = parseObject(submission.raw_responses_json);
  if (!Object.keys(responses).length) {
    report.unrecoverable.push({ type: 'submission', id: submission.id, reason: 'raw_answers_not_retained' });
    continue;
  }
  const snapshot = { ...snapshotFromDraft(draft), status: 'submitted', responses_json: JSON.stringify(responses), final_submission_id: submission.id, submitted_at: submission.submission_datetime || submission.created_date };
  const result = await createVersionIfMissing({
    draft, snapshot, versionKey: `${draft.id}:legacy-final-submission:${submission.id}`,
    type: 'submitted_snapshot', capturedAt: snapshot.submitted_at, sourceRecordId: submission.id,
    reconstructionLabel: 'Backfilled from retained final-submission raw questionnaire answers',
    reasons: ['submitted_snapshot', 'backfilled_final_submission'],
  });
  result.created ? report.plannedOrCreated.finalSubmissions += 1 : report.existingVersions += 1;
}

for (const intake of intakes) {
  const candidates = draftsBySession.get(text(intake.questionnaire_session_id)) || [];
  if (candidates.length !== 1) {
    report.unrecoverable.push({ type: 'intake', id: intake.id, reason: 'no_strong_unique_draft_link' });
    continue;
  }
  const draft = candidates[0];
  const responses = parseObject(intake.raw_responses_json);
  if (!Object.keys(responses).length) {
    report.unrecoverable.push({ type: 'intake', id: intake.id, reason: 'raw_answers_not_retained' });
    continue;
  }
  const capturedAt = intake.created_at_server || intake.created_date;
  const snapshot = { ...snapshotFromDraft(draft), status: intake.status || 'submit_attempted', responses_json: JSON.stringify(responses), submit_attempt_id: intake.submit_attempt_id || '', submit_attempted_at: capturedAt };
  const result = await createVersionIfMissing({
    draft, snapshot, versionKey: `${draft.id}:legacy-submission-intake:${intake.id}`,
    type: 'submission_intake', capturedAt, sourceRecordId: intake.id,
    reconstructionLabel: 'Backfilled from a retained submission-intake raw questionnaire snapshot',
    reasons: ['submission_checkpoint', 'backfilled_submission_intake'],
  });
  result.created ? report.plannedOrCreated.submissionIntakes += 1 : report.existingVersions += 1;
}

report.unrecoverableCount = report.unrecoverable.length;
if (APPLY && run) {
  const versionsAfter = await loadAll('QuestionnaireVersion', 'created_date');
  report.counts.versionsAfter = versionsAfter.length;
  await base44.entities.QuestionnaireVersionBackfillRun.update(run.id, {
    status: 'complete', cursor: drafts.length,
    created_versions: versionsAfter.length - versionCountBefore,
    existing_versions: report.existingVersions,
    normalized_drafts: report.normalizedDrafts,
    unrecoverable_records: report.unrecoverable.length,
    report_json: JSON.stringify(report), completed_at: new Date().toISOString(),
  });
}

console.log(JSON.stringify(report, null, 2));
