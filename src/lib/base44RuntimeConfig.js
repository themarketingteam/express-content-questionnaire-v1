const INVALID_RUNTIME_VALUES = new Set(["", "null", "undefined", "nan"]);

function normalizeRuntimeString(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return INVALID_RUNTIME_VALUES.has(normalized.toLowerCase()) ? "" : normalized;
}

export function isUsableBase44AppId(value) {
  return /^[a-zA-Z0-9_-]{8,128}$/.test(normalizeRuntimeString(value));
}

export function sanitizeBase44AppId(value, fallback) {
  const candidate = normalizeRuntimeString(value);
  if (isUsableBase44AppId(candidate)) return candidate;

  const safeFallback = normalizeRuntimeString(fallback);
  if (!isUsableBase44AppId(safeFallback)) {
    throw new Error("Base44 configuration error: a valid app ID is required.");
  }
  return safeFallback;
}

export function sanitizeBase44ServerUrl(value, fallback = "https://base44.app") {
  const candidates = [normalizeRuntimeString(value), normalizeRuntimeString(fallback)];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      if (!parsed.hostname) continue;
      return parsed.origin;
    } catch {
      // Try the production fallback next.
    }
  }

  throw new Error("Base44 configuration error: a valid server URL is required.");
}

export function sanitizeOptionalRuntimeValue(value, fallback = undefined) {
  const candidate = normalizeRuntimeString(value);
  if (candidate) return candidate;
  const safeFallback = normalizeRuntimeString(fallback);
  return safeFallback || undefined;
}

export function resolveBase44RuntimeConfig(candidate = {}, fallback = {}) {
  const appId = sanitizeBase44AppId(candidate.appId, fallback.appId);
  const serverUrl = sanitizeBase44ServerUrl(candidate.serverUrl, fallback.serverUrl);
  const token = sanitizeOptionalRuntimeValue(candidate.token, fallback.token) || null;
  const functionsVersion = sanitizeOptionalRuntimeValue(
    candidate.functionsVersion,
    fallback.functionsVersion,
  );
  const fromUrl = sanitizeOptionalRuntimeValue(candidate.fromUrl, fallback.fromUrl) || "";

  return {
    appId,
    serverUrl,
    token,
    functionsVersion,
    fromUrl,
  };
}

export function buildBase44FunctionEndpoint(runtimeConfig, functionName) {
  const appId = sanitizeBase44AppId(runtimeConfig?.appId, "");
  const serverUrl = sanitizeBase44ServerUrl(runtimeConfig?.serverUrl);
  const safeFunctionName = normalizeRuntimeString(functionName);

  if (!/^[a-zA-Z0-9_-]+$/.test(safeFunctionName)) {
    throw new Error("Base44 configuration error: a valid function name is required.");
  }

  const endpoint = `${serverUrl}/api/apps/${encodeURIComponent(appId)}/functions/${encodeURIComponent(safeFunctionName)}`;
  if (/\/(?:null|undefined)(?:\/|$)/i.test(endpoint) || endpoint.includes("/apps//")) {
    throw new Error("Base44 configuration error: unsafe function endpoint.");
  }
  return endpoint;
}
