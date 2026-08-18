const APPLY = false;
const POLICY = 'indefinite_until_manual_deletion';
const POLICY_VERSION = '2026-08-18';
const ENTITY_NAMES = [
  'FormDraft',
  'FormSubmission',
  'FormSubmissionIntake',
  'FormDraftEvent',
  'SubmissionPdfVersion',
  'ExpressIdentityResolutionAttempt',
];

async function loadAll(entityName) {
  const records = [];
  const pageSize = 5_000;
  for (let skip = 0; ; skip += pageSize) {
    const page = await base44.entities[entityName].list('created_date', pageSize, skip);
    records.push(...page);
    if (page.length < pageSize) break;
  }
  return records;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parse(value) {
  if (typeof value !== 'string' || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function findEmail(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEmail(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of ['user_email', 'userEmail', 'email']) {
    const candidate = text(value[key]);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return candidate.slice(0, 500);
  }
  for (const nested of Object.values(value)) {
    const found = findEmail(nested, depth + 1);
    if (found) return found;
  }
  return '';
}

const before = {};
const originalCreatedDates = new Map();
for (const entityName of ENTITY_NAMES) {
  before[entityName] = await loadAll(entityName);
  for (const record of before[entityName]) originalCreatedDates.set(`${entityName}:${record.id}`, record.created_date || '');
}

const planned = { retentionBackfills: {}, submissionLinks: 0, draftLinkRepairs: 0, emailBackfills: 0, skippedAmbiguousSessions: 0 };
const protectedAt = new Date().toISOString();

async function updateAllMatching(entityName, query, values) {
  for (;;) {
    const result = await base44.entities[entityName].updateMany(query, { $set: values });
    if (!result.has_more) return;
  }
}

for (const entityName of ENTITY_NAMES) {
  planned.retentionBackfills[entityName] = 0;
  for (const record of before[entityName]) {
    if (record.retention_policy === POLICY && record.retention_policy_version === POLICY_VERSION && record.retention_protected_at) continue;
    planned.retentionBackfills[entityName] += 1;
  }
  if (APPLY && planned.retentionBackfills[entityName] > 0) {
    await updateAllMatching(entityName, { retention_policy: { $ne: POLICY } }, {
      retention_policy: POLICY,
      retention_policy_version: POLICY_VERSION,
      retention_protected_at: protectedAt,
    });
    await updateAllMatching(entityName, {
      retention_policy: POLICY,
      retention_policy_version: { $ne: POLICY_VERSION },
    }, { retention_policy_version: POLICY_VERSION });
    await updateAllMatching(entityName, {
      retention_policy: POLICY,
      retention_protected_at: { $exists: false },
    }, { retention_protected_at: protectedAt });
  }
}

const drafts = before.FormDraft;
const submissions = before.FormSubmission;
const submissionById = new Map(submissions.map((record) => [String(record.id), record]));
const draftsBySession = new Map();
const submissionsBySession = new Map();
for (const draft of drafts) {
  const session = text(draft.session_id);
  if (!session) continue;
  draftsBySession.set(session, [...(draftsBySession.get(session) || []), draft]);
}
for (const submission of submissions) {
  const session = text(submission.questionnaire_session_id);
  if (!session) continue;
  submissionsBySession.set(session, [...(submissionsBySession.get(session) || []), submission]);
}

const desiredSubmissionLinks = new Map();
const desiredDraftLinks = new Map();
for (const draft of drafts) {
  const finalId = text(draft.final_submission_id);
  if (finalId && submissionById.has(finalId)) {
    const existing = desiredSubmissionLinks.get(finalId);
    if (!existing || existing === draft.id) desiredSubmissionLinks.set(finalId, draft.id);
    continue;
  }
  const session = text(draft.session_id);
  const sessionDrafts = draftsBySession.get(session) || [];
  const sessionSubmissions = submissionsBySession.get(session) || [];
  if (session && sessionDrafts.length === 1 && sessionSubmissions.length === 1) {
    desiredSubmissionLinks.set(sessionSubmissions[0].id, draft.id);
    desiredDraftLinks.set(draft.id, sessionSubmissions[0].id);
  } else if (session && sessionSubmissions.length > 0) {
    planned.skippedAmbiguousSessions += 1;
  }
}
for (const submission of submissions) {
  if (text(submission.linked_draft_id)) continue;
  const session = text(submission.questionnaire_session_id);
  const sessionDrafts = draftsBySession.get(session) || [];
  if (session && sessionDrafts.length === 1) desiredSubmissionLinks.set(submission.id, sessionDrafts[0].id);
}

for (const submission of submissions) {
  const updates = {};
  const desiredDraftId = desiredSubmissionLinks.get(submission.id);
  if (desiredDraftId && !text(submission.linked_draft_id)) {
    updates.linked_draft_id = desiredDraftId;
    planned.submissionLinks += 1;
  }
  if (!text(submission.user_email)) {
    const email = findEmail(parse(submission.raw_responses_json)) || findEmail(parse(submission.transformed_payload_json));
    if (email) {
      updates.user_email = email;
      planned.emailBackfills += 1;
    }
  }
  if (APPLY && Object.keys(updates).length) await base44.entities.FormSubmission.update(submission.id, updates);
}

for (const draft of drafts) {
  const desiredSubmissionId = desiredDraftLinks.get(draft.id);
  if (!desiredSubmissionId || text(draft.final_submission_id) === desiredSubmissionId) continue;
  planned.draftLinkRepairs += 1;
  if (APPLY) await base44.entities.FormDraft.update(draft.id, { final_submission_id: desiredSubmissionId });
}

const after = {};
for (const entityName of ENTITY_NAMES) after[entityName] = APPLY ? await loadAll(entityName) : before[entityName];
for (const entityName of ENTITY_NAMES) {
  if (after[entityName].length !== before[entityName].length) {
    throw new Error(`${entityName} count changed during a non-destructive migration.`);
  }
  for (const record of after[entityName]) {
    if ((record.created_date || '') !== originalCreatedDates.get(`${entityName}:${record.id}`)) {
      throw new Error(`${entityName}:${record.id} original created timestamp changed.`);
    }
    if (APPLY && (
      record.retention_policy !== POLICY
      || record.retention_policy_version !== POLICY_VERSION
      || !record.retention_protected_at
    )) {
      throw new Error(`${entityName}:${record.id} retention metadata was not fully backfilled.`);
    }
  }
}

const finalSubmissions = after.FormSubmission;
const connected = APPLY
  ? finalSubmissions.filter((record) => text(record.linked_draft_id)).length
  : finalSubmissions.filter((record) => text(record.linked_draft_id) || desiredSubmissionLinks.has(record.id)).length;

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry_run',
  policy: POLICY,
  countsBefore: Object.fromEntries(ENTITY_NAMES.map((name) => [name, before[name].length])),
  countsAfter: Object.fromEntries(ENTITY_NAMES.map((name) => [name, after[name].length])),
  planned,
  submissionDiscovery: { total: finalSubmissions.length, connected, standalone: finalSubmissions.length - connected },
  createdTimestampsPreserved: true,
}, null, 2));
