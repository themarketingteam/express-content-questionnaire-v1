import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import {
  clearRecoveryGrant,
  getBackendErrorMessage,
  revalidateSavedRecoveryGrant,
  saveRecoveryGrant,
} from "@/lib/draftRecoveryAccess";

const DraftRecoveryAccessContext = createContext(null);

export function DraftRecoveryAccessProvider({ children }) {
  const [recoveryGrant, setRecoveryGrant] = useState("");
  const [expiresAt, setExpiresAt] = useState(null);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState("");

  const verifySavedGrant = useCallback(async (savedGrant) => {
    const response = await base44.functions.invoke("verifyDraftRecoveryAccess", {
      recoveryGrant: savedGrant,
    });
    return response?.data || response;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      // Retain the existing storage key so previously authorized draft-recovery
      // sessions also authorize every password-protected admin route.
      const verified = await revalidateSavedRecoveryGrant({
        storage: window.localStorage,
        verifyGrant: verifySavedGrant,
      });
      if (!active) return;
      if (verified) {
        setRecoveryGrant(verified.recoveryGrant);
        setExpiresAt(verified.expiresAt);
      }
      setIsChecking(false);
    })();
    return () => { active = false; };
  }, [verifySavedGrant]);

  const unlock = useCallback(async (password) => {
    setError("");
    try {
      const response = await base44.functions.invoke("verifyDraftRecoveryAccess", { password });
      const data = response?.data || response;
      if (!data?.valid || !data?.recoveryGrant || !Number.isInteger(data?.expiresAt)) {
        throw new Error(data?.error || "Recovery access was not granted.");
      }
      saveRecoveryGrant(window.localStorage, data);
      setRecoveryGrant(data.recoveryGrant);
      setExpiresAt(data.expiresAt);
      return true;
    } catch (unlockError) {
      clearRecoveryGrant(window.localStorage);
      setRecoveryGrant("");
      setExpiresAt(null);
      setError(getBackendErrorMessage(unlockError, "Recovery access was not granted."));
      return false;
    }
  }, []);

  const lock = useCallback(() => {
    clearRecoveryGrant(window.localStorage);
    setRecoveryGrant("");
    setExpiresAt(null);
  }, []);

  return (
    <DraftRecoveryAccessContext.Provider value={{ recoveryGrant, expiresAt, isChecking, error, unlock, lock }}>
      {children}
    </DraftRecoveryAccessContext.Provider>
  );
}

export function useDraftRecoveryAccess() {
  const context = useContext(DraftRecoveryAccessContext);
  if (!context) throw new Error("useDraftRecoveryAccess must be used within DraftRecoveryAccessProvider");
  return context;
}
