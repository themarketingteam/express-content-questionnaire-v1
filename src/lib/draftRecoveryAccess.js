export const DRAFT_RECOVERY_STORAGE_KEY = "express_draft_recovery_access_v1";

export function getBackendErrorMessage(error, fallback = "Request failed") {
  const bodyError = error?.response?.data?.error;
  if (typeof bodyError === "string" && bodyError.trim()) return bodyError;
  if (typeof bodyError?.message === "string" && bodyError.message.trim()) return bodyError.message;
  if (typeof error?.message === "string" && error.message.trim()) return error.message;
  return fallback;
}

export function readSavedRecoveryGrant(storage, nowMs = Date.now()) {
  try {
    const parsed = JSON.parse(storage?.getItem(DRAFT_RECOVERY_STORAGE_KEY) || "null");
    if (!parsed?.recoveryGrant || !Number.isInteger(parsed?.expiresAt)) return null;
    if (parsed.expiresAt * 1000 <= nowMs) return null;
    return { recoveryGrant: parsed.recoveryGrant, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function saveRecoveryGrant(storage, grant) {
  storage?.setItem(DRAFT_RECOVERY_STORAGE_KEY, JSON.stringify({
    recoveryGrant: grant.recoveryGrant,
    expiresAt: grant.expiresAt,
  }));
}

export function clearRecoveryGrant(storage) {
  try { storage?.removeItem(DRAFT_RECOVERY_STORAGE_KEY); } catch { /* ignored */ }
}

export async function revalidateSavedRecoveryGrant({ storage, verifyGrant, nowMs = Date.now() }) {
  const saved = readSavedRecoveryGrant(storage, nowMs);
  if (!saved) {
    clearRecoveryGrant(storage);
    return null;
  }

  try {
    const verified = await verifyGrant(saved.recoveryGrant);
    if (!verified?.valid || !verified?.recoveryGrant || !Number.isInteger(verified?.expiresAt)) {
      clearRecoveryGrant(storage);
      return null;
    }
    saveRecoveryGrant(storage, verified);
    return { recoveryGrant: verified.recoveryGrant, expiresAt: verified.expiresAt };
  } catch {
    clearRecoveryGrant(storage);
    return null;
  }
}
