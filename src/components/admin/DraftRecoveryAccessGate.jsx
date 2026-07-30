import React, { createContext, useContext, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, Loader2, LockKeyhole } from "lucide-react";

const STORAGE_KEY = "express_draft_recovery_access_v1";
const DraftRecoveryAccessContext = createContext(null);

function readStoredAccessToken() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storeAccessToken(accessToken) {
  try {
    window.localStorage.setItem(STORAGE_KEY, accessToken);
  } catch {
    // Access still works for this tab when browser storage is unavailable.
  }
}

function removeStoredAccessToken() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else to clear when browser storage is unavailable.
  }
}

function responseData(response) {
  return response?.data || response || {};
}

export function useDraftRecoveryAccess() {
  const context = useContext(DraftRecoveryAccessContext);
  if (!context) {
    throw new Error("useDraftRecoveryAccess must be used within DraftRecoveryAccessGate");
  }
  return context;
}

export default function DraftRecoveryAccessGate({ children }) {
  const [accessToken, setAccessToken] = useState(() => readStoredAccessToken());
  const [status, setStatus] = useState(() => accessToken ? "checking" : "locked");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  useEffect(() => {
    if (!accessToken || status !== "checking") return;

    let cancelled = false;
    const validateStoredToken = async () => {
      try {
        const response = await base44.functions.invoke("verifyDraftRecoveryAccess", { accessToken });
        const data = responseData(response);
        if (!cancelled && data.success && data.authorized) {
          setExpiresAt(data.expiresAt || "");
          setStatus("unlocked");
          return;
        }
      } catch {
        // Invalid and expired tokens use the same locked state.
      }

      if (!cancelled) {
        removeStoredAccessToken();
        setAccessToken("");
        setStatus("locked");
      }
    };

    validateStoredToken();
    return () => { cancelled = true; };
  }, [accessToken, status]);

  const unlock = async (event) => {
    event.preventDefault();
    if (!password) {
      setError("Enter the draft recovery password.");
      return;
    }

    setStatus("submitting");
    setError("");
    try {
      const response = await base44.functions.invoke("verifyDraftRecoveryAccess", { password });
      const data = responseData(response);
      if (!data.success || !data.authorized || !data.accessToken) {
        throw new Error(data.error || "Access could not be verified.");
      }

      storeAccessToken(data.accessToken);
      setAccessToken(data.accessToken);
      setExpiresAt(data.expiresAt || "");
      setPassword("");
      setStatus("unlocked");
    } catch (requestError) {
      const message = requestError?.response?.data?.error
        || requestError?.message
        || "Access could not be verified.";
      setError(message);
      setStatus("locked");
    }
  };

  const lock = () => {
    removeStoredAccessToken();
    setAccessToken("");
    setExpiresAt("");
    setStatus("locked");
  };

  if (status === "checking") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-slate-50 px-6">
        <Loader2 className="h-6 w-6 animate-spin text-[#004B87]" aria-hidden="true" />
        <p className="text-sm text-slate-500">Checking draft recovery access…</p>
      </div>
    );
  }

  if (status !== "unlocked") {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-slate-50 px-6">
        <form onSubmit={unlock} className="w-full max-w-sm space-y-5 border border-slate-200 bg-white p-8 shadow-sm">
          <div className="space-y-2 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-[#004B87]">
              <LockKeyhole className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold text-slate-800" style={{ fontFamily: "Raleway, sans-serif" }}>
              Draft Recovery
            </h1>
            <p className="text-sm text-slate-500">
              Enter the admin password to continue. Access remains active in this browser for seven days.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="draft-recovery-password" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Password
            </label>
            <Input
              id="draft-recovery-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              disabled={status === "submitting"}
              aria-describedby={error ? "draft-recovery-password-error" : undefined}
              aria-invalid={Boolean(error)}
            />
            {error ? (
              <p id="draft-recovery-password-error" className="text-sm text-red-600" role="alert">{error}</p>
            ) : null}
          </div>

          <Button
            type="submit"
            className="w-full gap-2 rounded-sm bg-[#004B87] text-sm font-bold uppercase tracking-wider text-white hover:bg-[#003b6a]"
            disabled={status === "submitting"}
          >
            {status === "submitting" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            )}
            {status === "submitting" ? "Verifying…" : "Unlock"}
          </Button>
        </form>
      </main>
    );
  }

  return (
    <DraftRecoveryAccessContext.Provider value={{ accessToken, expiresAt, lock }}>
      {children}
    </DraftRecoveryAccessContext.Provider>
  );
}
