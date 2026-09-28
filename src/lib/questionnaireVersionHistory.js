export function normalizeQuestionnaireIdentity(value, kind = "text") {
  let normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (kind === "domain") {
    normalized = normalized.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").split("/")[0];
  }
  if (kind === "email") normalized = normalized.replace(/\s+/g, "");
  return normalized.replace(/\s+/g, kind === "text" ? " " : "");
}

export function isSameQuestionnaireClient(root, candidate) {
  if (!root || !candidate) return false;
  if (root.id && root.id === candidate.id) return true;
  if (root.session_id && root.session_id === candidate.session_id) return true;
  const userId = normalizeQuestionnaireIdentity(root.user_id);
  if (userId && userId === normalizeQuestionnaireIdentity(candidate.user_id)) return true;
  const email = normalizeQuestionnaireIdentity(root.user_email, "email");
  if (email && email === normalizeQuestionnaireIdentity(candidate.user_email, "email")) return true;
  const domain = normalizeQuestionnaireIdentity(root.domain, "domain");
  const business = normalizeQuestionnaireIdentity(root.business_name);
  return Boolean(
    domain
    && business
    && domain === normalizeQuestionnaireIdentity(candidate.domain, "domain")
    && business === normalizeQuestionnaireIdentity(candidate.business_name),
  );
}

function versionRank(version) {
  return (
    (version.type === "submitted_snapshot" ? 1_000_000 : 0)
    + (version.type === "final_submission" ? 900_000 : 0)
    + (version.status === "submitted" ? 800_000 : 0)
    + Number(version.progressPercent || 0) * 1_000
    + Number(version.answerCount || 0) * 10
    + Math.floor((Date.parse(version.capturedAt || "") || 0) / 1_000_000_000)
  );
}

export function chooseDefaultQuestionnaireVersion(versions) {
  const all = Array.isArray(versions) ? versions : [];
  const submitted = all.filter(version => version.type === "submitted_snapshot");
  const finals = all.filter(version => version.type === "final_submission");
  const pool = submitted.length ? submitted : finals.length ? finals : all;
  return [...pool].sort((left, right) => versionRank(right) - versionRank(left))[0] || null;
}

export function filterMeaningfulQuestionnaireVersions(versions) {
  return (versions || []).filter(version => version.meaningful === true);
}

export function questionnaireVersionOptionLabel(version, {
  showSession = false,
  formatDate = value => String(value || "Unknown date"),
} = {}) {
  const displayedDate = formatDate(version.capturedAt);
  const session = showSession && version.sessionId ? ` · Session ${String(version.sessionId).slice(0, 8)}…` : "";
  return `${version.label} · ${displayedDate} · ${version.answerCount} answer${version.answerCount === 1 ? "" : "s"} · ${version.progressPercent}%${session}`;
}
