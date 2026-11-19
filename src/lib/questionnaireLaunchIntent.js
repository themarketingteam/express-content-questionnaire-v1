import { hasExplicitQuestionnaireDraftReference } from './questionnaireDraftIdentity.js';

const IDENTITY_QUERY_KEYS = [
  "businessName",
  "business_name",
  "name",
  "domain",
  "domainName",
  "businessDomain",
  "business_domain",
];

function clean(value) {
  return String(value || "").trim();
}

function normalizeIdentityValue(value, kind = "text") {
  const cleaned = clean(value).toLowerCase();
  if (kind === "domain") {
    return cleaned
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[/?#].*$/, "")
      .replace(/\.$/, "");
  }
  return cleaned.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function findQuestionnaireIdentityConflict(existing = {}, incoming = {}) {
  const checks = [
    ["businessName", existing.business_name || existing.businessName, incoming.business_name || incoming.businessName, "text"],
    ["domain", existing.domain, incoming.domain, "domain"],
  ];
  const conflicts = {};
  for (const [field, existingValue, incomingValue, kind] of checks) {
    const current = clean(existingValue);
    const next = clean(incomingValue);
    if (!current || !next) continue;
    if (normalizeIdentityValue(current, kind) !== normalizeIdentityValue(next, kind)) {
      conflicts[field] = { existing: current, incoming: next };
    }
  }
  return Object.keys(conflicts).length > 0 ? conflicts : null;
}

export function createNewClientRequestId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) throw new Error("Secure browser randomness is required.");
  const bytes = new Uint8Array(24);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseQuestionnaireLaunchIntent(search = "", cryptoApi = globalThis.crypto) {
  const params = new URLSearchParams(String(search).replace(/^\?/, ""));
  const newClient = /^(1|true|yes)$/i.test(clean(params.get("newClient")));
  let newClientRequestId = clean(params.get("newClientRequestId"));
  if (newClient && !newClientRequestId) newClientRequestId = createNewClientRequestId(cryptoApi);

  return {
    newClient,
    newClientRequestId,
    promptIdentity: /^(1|true|yes)$/i.test(clean(params.get("promptIdentity"))),
    businessName: clean(params.get("businessName") || params.get("business_name") || params.get("name")),
    domain: clean(params.get("domainName") || params.get("domain") || params.get("businessDomain") || params.get("business_domain")),
    userId: clean(params.get("userId")),
    userEmail: clean(params.get("userEmail")),
    userName: clean(params.get("userName")),
  };
}

/** Capture entry provenance before browser identity recovery adds a URL hash. */
export function readInitialQuestionnaireLaunchIntent(location = globalThis.location) {
  return {
    ...parseQuestionnaireLaunchIntent(location?.search || ""),
    hasExplicitDraftReference: hasExplicitQuestionnaireDraftReference(location),
  };
}

export function ensureNewClientRequestInUrl(intent, location = globalThis.location, history = globalThis.history) {
  if (!intent?.newClient || !intent.newClientRequestId || !location || !history?.replaceState) return;
  const params = new URLSearchParams(location.search || "");
  if (params.get("newClientRequestId") === intent.newClientRequestId) return;
  params.set("newClientRequestId", intent.newClientRequestId);
  history.replaceState(
    history.state ?? null,
    "",
    `${location.pathname || ""}?${params.toString()}${location.hash || ""}`,
  );
}

export function consumeNewClientLaunchFlags(location = globalThis.location, history = globalThis.history) {
  if (!location || !history?.replaceState) return;
  const params = new URLSearchParams(location.search || "");
  params.delete("newClient");
  params.delete("newClientRequestId");
  params.delete("promptIdentity");
  const query = params.toString();
  history.replaceState(
    history.state ?? null,
    "",
    `${location.pathname || ""}${query ? `?${query}` : ""}${location.hash || ""}`,
  );
}

export function navigateToNewClient({ promptIdentity = false, identity = null } = {}) {
  const params = new URLSearchParams(globalThis.location?.search || "");
  for (const key of IDENTITY_QUERY_KEYS) params.delete(key);
  params.set("newClient", "true");
  params.set("newClientRequestId", createNewClientRequestId());
  if (promptIdentity) params.set("promptIdentity", "true");
  else params.delete("promptIdentity");
  if (identity?.businessName) params.set("businessName", clean(identity.businessName));
  if (identity?.domain) params.set("domainName", clean(identity.domain));
  const query = params.toString();
  globalThis.location.assign(`${globalThis.location.pathname}?${query}`);
}

export function removeIncomingIdentityParameters(location = globalThis.location, history = globalThis.history) {
  if (!location || !history?.replaceState) return;
  const params = new URLSearchParams(location.search || "");
  for (const key of IDENTITY_QUERY_KEYS) params.delete(key);
  const query = params.toString();
  history.replaceState(
    history.state ?? null,
    "",
    `${location.pathname || ""}${query ? `?${query}` : ""}${location.hash || ""}`,
  );
}
