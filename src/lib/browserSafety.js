/**
 * Safe browser helpers that never throw in private browsing, storage-full,
 * SSR, or malformed JSON situations.
 */

export function hasWindow() {
  return typeof window !== "undefined";
}

export function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return fallback;
  }
}

export function safeJsonParse(text, fallback = null) {
  if (!text || typeof text !== "string") return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function safeLocalStorageGet(key) {
  try {
    if (!hasWindow()) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalStorageSet(key, value) {
  try {
    if (!hasWindow()) return false;
    window.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function safeLocalStorageRemove(key) {
  try {
    if (!hasWindow()) return false;
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeSessionStorageGet(key) {
  try {
    if (!hasWindow()) return null;
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSessionStorageSet(key, value) {
  try {
    if (!hasWindow()) return false;
    window.sessionStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function safeNowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}