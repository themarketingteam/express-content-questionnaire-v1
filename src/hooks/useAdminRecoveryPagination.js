import { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import {
  ADMIN_RECOVERY_PAGE_SIZE,
  ADMIN_RECOVERY_SEARCH_DELAY_MS,
  createLatestRecoveryRequestGate,
  requestRecoveryPage,
} from "@/lib/adminRecoveryPagination";
import { getBackendErrorMessage } from "@/lib/draftRecoveryAccess";

function useDebouncedValue(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);

  return debouncedValue;
}

export function useAdminRecoveryPagination({
  recordType,
  recoveryGrant,
  status = "all",
  archiveState = "active",
  search = "",
  pageSize = ADMIN_RECOVERY_PAGE_SIZE,
}) {
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [hasAnyRecords, setHasAnyRecords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestGateRef = useRef(null);
  if (!requestGateRef.current) requestGateRef.current = createLatestRecoveryRequestGate();
  const debouncedSearch = useDebouncedValue(search, ADMIN_RECOVERY_SEARCH_DELAY_MS);

  useEffect(() => {
    setPage(1);
  }, [status, archiveState, search]);

  const loadPage = useCallback(async () => {
    if (!recoveryGrant) return;
    const requestId = requestGateRef.current.begin();
    setLoading(true);
    setError("");

    try {
      const data = await requestRecoveryPage({
        invoke: (functionName, payload) => base44.functions.invoke(functionName, payload),
        recordType,
        recoveryGrant,
        page,
        pageSize,
        status,
        archiveState,
        search: debouncedSearch,
      });
      if (!requestGateRef.current.isLatest(requestId)) return;

      if ((data.records || []).length === 0 && page > 1 && data.hasAnyRecords) {
        setPage((current) => Math.max(1, current - 1));
        return;
      }

      setRecords(data.records || []);
      setHasMore(Boolean(data.hasMore));
      setHasAnyRecords(Boolean(data.hasAnyRecords));
      setLastRefreshedAt(new Date());
    } catch (requestError) {
      if (!requestGateRef.current.isLatest(requestId)) return;
      setError(getBackendErrorMessage(requestError, "Failed to load recovery records."));
    } finally {
      if (requestGateRef.current.isLatest(requestId)) setLoading(false);
    }
  }, [archiveState, debouncedSearch, page, pageSize, recordType, recoveryGrant, refreshVersion, status]);

  useEffect(() => {
    loadPage();
    return () => requestGateRef.current.invalidate();
  }, [loadPage]);

  const refresh = useCallback(() => {
    setRefreshVersion((version) => version + 1);
  }, []);

  const goToPreviousPage = useCallback(() => {
    setPage((current) => Math.max(1, current - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setPage((current) => current + 1);
  }, []);

  return {
    records,
    page,
    pageSize,
    hasMore,
    hasAnyRecords,
    loading,
    error,
    lastRefreshedAt,
    refreshVersion,
    isSearchDebouncing: search !== debouncedSearch,
    refresh,
    retry: loadPage,
    goToPreviousPage,
    goToNextPage,
  };
}
