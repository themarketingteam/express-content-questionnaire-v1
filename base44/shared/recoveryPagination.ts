export const DEFAULT_RECOVERY_PAGE_SIZE = 25;
export const MAX_RECOVERY_PAGE_SIZE = 100;
const MAX_PAGE = 10_000;
const MAX_SEARCH_LENGTH = 160;

export const RECOVERY_RECORD_CONFIG = {
  draft: {
    entityName: 'FormDraft',
    statusField: 'status',
    statuses: new Set([
      'all',
      'draft',
      'submit_attempted',
      'submit_failed',
      'submitted',
      'auto_repair_pending',
      'auto_repair_failed',
    ]),
    searchFields: ['business_name', 'domain', 'user_name', 'user_email', 'user_id', 'session_id', 'responses_json'],
    listFields: [
      'id',
      'status',
      'business_name',
      'domain',
      'user_email',
      'user_name',
      'user_id',
      'session_id',
      'last_saved_at',
      'last_changed_question_id',
      'current_question_id',
      'final_submission_id',
      'ai_repair_status',
      'bootstrap_confirmed_at',
      'persistence_health_status',
      'last_confirmed_revision',
      'storage_available',
      'archived',
      'archived_at',
      'created_date',
      'updated_date',
    ],
  },
  intake: {
    entityName: 'FormSubmissionIntake',
    statusField: 'status',
    statuses: new Set([
      'all',
      'received_intake',
      'auto_repair_pending',
      'retry_pending',
      'retry_failed',
      'retry_success',
      'submitted',
      'abandoned',
    ]),
    searchFields: [
      'business_name',
      'business_domain',
      'user_email',
      'questionnaire_session_id',
      'linked_submission_id',
    ],
    listFields: [
      'id',
      'status',
      'business_name',
      'business_domain',
      'user_email',
      'questionnaire_session_id',
      'created_at_server',
      'primary_failure_kind',
      'linked_submission_id',
      'zapier_sent',
      'ai_repair_status',
      'archived',
      'archived_at',
      'created_date',
      'updated_date',
    ],
  },
  submission: {
    entityName: 'FormSubmission',
    statusField: 'zapier_delivery_status',
    statuses: new Set([
      'all',
      'not_attempted',
      'sent',
      'failed',
    ]),
    searchFields: [
      'business_name',
      'business_domain',
      'user_email',
      'questionnaire_session_id',
      'submit_attempt_id',
      'id',
    ],
    listFields: [
      'id',
      'business_name',
      'business_domain',
      'user_email',
      'submission_datetime',
      'service_type',
      'questionnaire_session_id',
      'submit_attempt_id',
      'zapier_delivery_status',
      'zapier_sent',
      'zapier_sent_at',
      'linked_draft_id',
      'archived',
      'archived_at',
      'retention_policy',
      'created_date',
      'updated_date',
    ],
  },
} as const;

type RecordType = keyof typeof RECOVERY_RECORD_CONFIG;
type ArchiveState = 'active' | 'archived' | 'all';
type IdentityState = 'all' | 'identified' | 'unidentified';

export type NormalizedRecoveryListRequest = {
  action: 'list';
  recordType: RecordType;
  page: number;
  pageSize: number;
  status: string;
  archiveState: ArchiveState;
  identityState: IdentityState;
  search: string;
};

export type NormalizedRecoveryGetRequest = {
  action: 'get';
  recordType: RecordType;
  recordId: string;
  archiveState: ArchiveState;
};

type NormalizedRequestResult =
  | { ok: true; value: NormalizedRecoveryListRequest | NormalizedRecoveryGetRequest }
  | { ok: false; error: string };

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(numeric)));
}

function normalizeArchiveState(value: unknown): ArchiveState | null {
  const normalized = typeof value === 'string' ? value : 'active';
  return normalized === 'active' || normalized === 'archived' || normalized === 'all'
    ? normalized
    : null;
}

function normalizeIdentityState(value: unknown): IdentityState | null {
  const normalized = typeof value === 'string' ? value : 'all';
  return normalized === 'all' || normalized === 'identified' || normalized === 'unidentified'
    ? normalized
    : null;
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  }).join('');
}

export function normalizeRecoveryRequest(body: Record<string, unknown>): NormalizedRequestResult {
  const action = body.action;
  if (action !== 'list' && action !== 'get') {
    return { ok: false, error: 'action must be list or get.' };
  }

  const recordType = body.recordType;
  if (recordType !== 'draft' && recordType !== 'intake' && recordType !== 'submission') {
    return { ok: false, error: 'Unsupported recordType.' };
  }

  const archiveState = normalizeArchiveState(body.archiveState);
  if (!archiveState) return { ok: false, error: 'Unsupported archiveState.' };

  if (action === 'get') {
    const recordId = typeof body.recordId === 'string' ? body.recordId.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(recordId)) {
      return { ok: false, error: 'A valid recordId is required.' };
    }
    return { ok: true, value: { action, recordType, recordId, archiveState } };
  }

  const status = typeof body.status === 'string' ? body.status : 'all';
  if (!RECOVERY_RECORD_CONFIG[recordType].statuses.has(status)) {
    return { ok: false, error: 'Unsupported status filter.' };
  }
  const identityState = normalizeIdentityState(body.identityState);
  if (!identityState || (recordType !== 'draft' && identityState !== 'all')) {
    return { ok: false, error: 'Unsupported identityState.' };
  }

  const search = replaceControlCharacters(typeof body.search === 'string' ? body.search : '')
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);

  return {
    ok: true,
    value: {
      action,
      recordType,
      page: clampInteger(body.page, 1, 1, MAX_PAGE),
      pageSize: clampInteger(body.pageSize, DEFAULT_RECOVERY_PAGE_SIZE, 1, MAX_RECOVERY_PAGE_SIZE),
      status,
      archiveState,
      identityState,
      search,
    },
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildRecoveryListQuery(request: NormalizedRecoveryListRequest): Record<string, unknown> {
  const config = RECOVERY_RECORD_CONFIG[request.recordType];
  const query: Record<string, unknown> = {};

  if (request.status !== 'all') query[config.statusField] = request.status;
  if (request.archiveState === 'active') query.archived = { $ne: true };
  if (request.archiveState === 'archived') query.archived = true;

  if (request.search) {
    const pattern = escapeRegex(request.search);
    // Base44 entity IDs are not ordinary filterable fields. Exact submission-ID
    // searches are handled with entity.get() after authorization; including id
    // in this $or can cause otherwise-valid collection searches to return no
    // records on the production entity service.
    query.$or = config.searchFields
      .filter((field) => field !== 'id')
      .map((field) => ({ [field]: { $regex: pattern, $options: 'i' } }));
  }

  const appendClause = (clause: Record<string, unknown>) => {
    if (Array.isArray(query.$and)) {
      (query.$and as Record<string, unknown>[]).push(clause);
    } else if (query.$or) {
      query.$and = [{ $or: query.$or }, clause];
      delete query.$or;
    } else {
      query.$and = [clause];
    }
  };

  if (request.recordType === 'draft' && request.identityState === 'identified') {
    appendClause({
      $and: [
        { business_name: { $exists: true, $ne: '' } },
        { domain: { $exists: true, $ne: '' } },
      ],
    });
  }
  if (request.recordType === 'draft' && request.identityState === 'unidentified') {
    appendClause({
      $or: [
        { business_name: { $exists: false } }, { business_name: '' }, { business_name: null },
        { domain: { $exists: false } }, { domain: '' }, { domain: null },
      ],
    });
  }

  // Connected submissions are nested beneath their draft. The submission
  // collection on Draft Recovery normally shows only legacy or otherwise
  // standalone final records so clients are not duplicated in the UI. During
  // search, all submissions are eligible so connected records remain
  // discoverable by submission ID, session ID, and available email.
  if (request.recordType === 'submission' && !request.search) {
    const standalone = {
      $or: [
        { linked_draft_id: { $exists: false } },
        { linked_draft_id: '' },
        { linked_draft_id: null },
      ],
    };
    if (query.$and || query.$or) appendClause(standalone);
    else Object.assign(query, standalone);
  }

  return query;
}

export function isExactSubmissionIdSearch(
  request: NormalizedRecoveryListRequest,
): boolean {
  return request.recordType === 'submission' && /^[a-f0-9]{24}$/i.test(request.search);
}

export function projectRecoveryListRecord(
  record: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(fields
    .filter((field) => Object.prototype.hasOwnProperty.call(record, field))
    .map((field) => [field, record[field]]));
}

export function recordMatchesArchiveState(
  record: Record<string, unknown>,
  archiveState: ArchiveState,
): boolean {
  if (archiveState === 'all') return true;
  return archiveState === 'archived' ? record.archived === true : record.archived !== true;
}
