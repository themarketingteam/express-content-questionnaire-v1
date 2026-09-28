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
  const submitted = all.filter(version => version.type === "submitted_snapshot" && version.rawAvailable !== false);
  const finals = all.filter(version => version.type === "final_submission");
  const barriers = all.filter(version => [
    "submission_checkpoint", "failed_submission_checkpoint", "intake_snapshot", "submission_intake",
  ].includes(version.type));
  const nonEmpty = all.filter(version => Number(version.answerCount || 0) > 0);
  const current = all.filter(version => version.type === "current_draft");
  const pool = submitted.length
    ? submitted
    : finals.length
      ? finals
      : barriers.length
        ? barriers
        : nonEmpty.length
          ? nonEmpty
          : current.length
            ? current
            : all;
  return [...pool].sort((left, right) => versionRank(right) - versionRank(left))[0] || null;
}

export function calculateMeaningfulQuestionnaireVersions(versions, workingSessionGapMs = 30 * 60 * 1000) {
  const bySession = new Map();
  (versions || []).forEach((version) => {
    const key = String(version.sessionId || "");
    bySession.set(key, [...(bySession.get(key) || []), { ...version }]);
  });
  const result = [];
  for (const sessionVersions of bySession.values()) {
    const ascending = sessionVersions.sort((left, right) => (
      (Date.parse(left.capturedAt || "") || 0) - (Date.parse(right.capturedAt || "") || 0)
      || String(left.id || "").localeCompare(String(right.id || ""))
    ));
    let answerHighWater = -1;
    let progressHighWater = -1;
    ascending.forEach((version, index) => {
      const reasons = new Set(version.meaningfulReasons || []);
      if (index === 0) reasons.add("first_retained_revision");
      if (index === ascending.length - 1) reasons.add("latest_retained_revision");
      if (Number(version.answerCount || 0) > answerHighWater) reasons.add("answer_count_high_water");
      if (Number(version.progressPercent || 0) > progressHighWater) reasons.add("progress_high_water");
      answerHighWater = Math.max(answerHighWater, Number(version.answerCount || 0));
      progressHighWater = Math.max(progressHighWater, Number(version.progressPercent || 0));
      const next = ascending[index + 1];
      if (next && (
        Number(version.answerCount || 0) - Number(next.answerCount || 0) >= 3
        || Number(version.progressPercent || 0) - Number(next.progressPercent || 0) >= 20
      )) reasons.add("before_substantial_deletion");
      const currentTime = Date.parse(version.capturedAt || "") || 0;
      const nextTime = Date.parse(next?.capturedAt || "") || 0;
      if (nextTime && currentTime && nextTime - currentTime >= workingSessionGapMs) reasons.add("working_session_end");
      result.push({ ...version, meaningful: reasons.size > 0, meaningfulReasons: [...reasons] });
    });
  }
  return result;
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

export function createQuestionnaireVersionLoadGate() {
  let attempted = false;
  let inFlight = null;

  return {
    shouldAutoLoad({ expanded, detailReady, hasCatalog }) {
      return Boolean(expanded && detailReady && !hasCatalog && !attempted && !inFlight);
    },
    run(factory, { force = false } = {}) {
      if (inFlight) return inFlight;
      if (attempted && !force) return Promise.resolve(null);
      attempted = true;
      const request = Promise.resolve().then(factory);
      const wrappedRequest = request.finally(() => {
        if (inFlight === wrappedRequest) inFlight = null;
      });
      inFlight = wrappedRequest;
      return wrappedRequest;
    },
  };
}

export function withQuestionnaireVersionRequestTimeout(request, timeoutMs = 20_000) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Questionnaire versions took too long to load. Please retry."));
    }, timeoutMs);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timeoutId));
}
