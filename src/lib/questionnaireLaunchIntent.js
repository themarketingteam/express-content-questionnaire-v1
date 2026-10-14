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
