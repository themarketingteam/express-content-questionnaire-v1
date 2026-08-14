export const ADMIN_RECOVERY_PAGE_SIZE = 25;
export const ADMIN_RECOVERY_SEARCH_DELAY_MS = 400;
export const ADMIN_RECOVERY_PAGINATION_FUNCTION = "adminRecoveryPagination";

function unwrapFunctionResponse(response) {
  const data = response?.data || response || {};
  if (!data.success) {
    throw Object.assign(new Error(data.error || "The recovery request failed."), {
      response: { data },
    });
  }
  return data;
}

export function createRecoveryListPayload({
  recordType,
  recoveryGrant,
  page = 1,
  pageSize = ADMIN_RECOVERY_PAGE_SIZE,
  status = "all",
  archiveState = "active",
  search = "",
}) {
  return {
    action: "list",
    recordType,
    page,
    pageSize,
    status,
    archiveState,
    search: search.trim(),
    recoveryGrant,
  };
}

export function createRecoveryGetPayload({ recordType, recordId, archiveState, recoveryGrant }) {
  return {
    action: "get",
    recordType,
    recordId,
    archiveState,
    recoveryGrant,
  };
}

export async function requestRecoveryPage({
  invoke,
  recordType,
  recoveryGrant,
  page,
  pageSize,
  status,
  archiveState,
  search,
}) {
  const response = await invoke(ADMIN_RECOVERY_PAGINATION_FUNCTION, createRecoveryListPayload({
    recordType,
    recoveryGrant,
    page,
    pageSize,
    status,
    archiveState,
    search,
  }));
  return unwrapFunctionResponse(response);
}

export async function requestRecoveryRecord({ invoke, recordType, recordId, archiveState, recoveryGrant }) {
  const response = await invoke(ADMIN_RECOVERY_PAGINATION_FUNCTION, createRecoveryGetPayload({
    recordType,
    recordId,
    archiveState,
    recoveryGrant,
  }));
  return unwrapFunctionResponse(response).record;
}

export function getVisibleRecordRange({ page, pageSize, recordCount }) {
  if (recordCount === 0) return { start: 0, end: 0 };
  const start = (page - 1) * pageSize + 1;
  return { start, end: start + recordCount - 1 };
}

export function getPaginationControls({ page, hasMore, loading = false }) {
  return {
    previousDisabled: loading || page <= 1,
    nextDisabled: loading || !hasMore,
  };
}

export function createLatestRecoveryRequestGate() {
  let latestRequestId = 0;
  return {
    begin() {
      latestRequestId += 1;
      return latestRequestId;
    },
    isLatest(requestId) {
      return requestId === latestRequestId;
    },
    invalidate() {
      latestRequestId += 1;
    },
  };
}
