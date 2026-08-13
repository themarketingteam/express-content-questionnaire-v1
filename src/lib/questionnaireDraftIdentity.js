const SESSION_STORAGE_KEY = "express_questionnaire_session_id";
const ACCESS_KEY_STORAGE_KEY = "express_questionnaire_draft_access_key";
const HASH_SESSION_KEY = "draft_session";
const HASH_ACCESS_KEY = "draft_key";

const SESSION_PATTERN = /^[A-Za-z0-9_-]{20,160}$/;
const ACCESS_KEY_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;

function randomBase64Url(byteLength = 32, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure browser randomness is required to create a questionnaire draft.");
  }
  const bytes = new Uint8Array(byteLength);
  cryptoApi.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createSessionId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  return `express_${Date.now()}_${randomBase64Url(16, cryptoApi)}`;
}

export function readDraftIdentityFromHash(hash = "") {
  const params = new URLSearchParams(String(hash).replace(/^#/, ""));
  const sessionId = params.get(HASH_SESSION_KEY) || "";
  const accessKey = params.get(HASH_ACCESS_KEY) || "";
  if (!SESSION_PATTERN.test(sessionId) || !ACCESS_KEY_PATTERN.test(accessKey)) return null;
  return { sessionId, accessKey };
}

export function buildDraftIdentityHash(hash, identity) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  params.set(HASH_SESSION_KEY, identity.sessionId);
  params.set(HASH_ACCESS_KEY, identity.accessKey);
  return `#${params.toString()}`;
}

export function getOrCreateQuestionnaireDraftIdentity({
  storage = globalThis.localStorage,
  location = globalThis.location,
  history = globalThis.history,
  cryptoApi = globalThis.crypto,
} = {}) {
  const hashIdentity = readDraftIdentityFromHash(location?.hash || "");
  let sessionId = hashIdentity?.sessionId || "";
  let accessKey = hashIdentity?.accessKey || "";

  try {
    if (!sessionId) {
      const storedSessionId = storage?.getItem(SESSION_STORAGE_KEY) || "";
      if (SESSION_PATTERN.test(storedSessionId)) sessionId = storedSessionId;
    }
    if (!accessKey) {
      const storedAccessKey = storage?.getItem(ACCESS_KEY_STORAGE_KEY) || "";
      if (ACCESS_KEY_PATTERN.test(storedAccessKey)) accessKey = storedAccessKey;
    }
  } catch {
    // Storage may be unavailable; the URL fragment remains the recovery source.
  }

  if (!sessionId) sessionId = createSessionId(cryptoApi);
  if (!accessKey) accessKey = randomBase64Url(32, cryptoApi);

  try {
    storage?.setItem(SESSION_STORAGE_KEY, sessionId);
    storage?.setItem(ACCESS_KEY_STORAGE_KEY, accessKey);
  } catch {
    // The URL fragment still preserves the identity when storage is unavailable.
  }

  if (location && history?.replaceState) {
    const nextHash = buildDraftIdentityHash(location.hash, { sessionId, accessKey });
    if (nextHash !== location.hash) {
      history.replaceState(history.state ?? null, "", `${location.pathname || ""}${location.search || ""}${nextHash}`);
    }
  }

  return { sessionId, accessKey };
}

export function clearQuestionnaireDraftIdentity({
  storage = globalThis.localStorage,
  location = globalThis.location,
  history = globalThis.history,
} = {}) {
  try {
    storage?.removeItem(SESSION_STORAGE_KEY);
    storage?.removeItem(ACCESS_KEY_STORAGE_KEY);
  } catch {
    // ignored
  }

  if (location && history?.replaceState) {
    const params = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    params.delete(HASH_SESSION_KEY);
    params.delete(HASH_ACCESS_KEY);
    const nextHash = params.toString() ? `#${params.toString()}` : "";
    history.replaceState(history.state ?? null, "", `${location.pathname || ""}${location.search || ""}${nextHash}`);
  }
}

export const QUESTIONNAIRE_SESSION_STORAGE_KEY = SESSION_STORAGE_KEY;
export const QUESTIONNAIRE_DRAFT_ACCESS_KEY_STORAGE_KEY = ACCESS_KEY_STORAGE_KEY;
