const encoder = new TextEncoder();

export const IDENTITY_RESOLVER_VERSION = 'express-identity-v1';
export const BUSINESS_NAME_THRESHOLD = 0.90;
export const DOMAIN_THRESHOLD = 0.92;

const PLACEHOLDER_VALUES = new Set([
  '', 'unknown', 'null', 'undefined', 'n/a', 'n a', 'na', 'none', 'not provided',
  'unnamed', 'unnamed business', 'tbd', '-', '—',
]);

const EXCLUDED_PATH = /(?:^|\.)(?:[^.[\]]*(?:email|user_?id|session_?id|submit_?attempt_?id|password|token|secret|authorization|cookie|user_?agent|diagnostic|created_?at|updated_?at|submission_?datetime|domain|url|website)[^.[\]]*)(?:\.|\[|$)/i;
const PREFERRED_NARRATIVE_PATH = /(?:description|differentiation|ideal_client|why_choose|company_goals|brand|about|overview|service|content|answer|response)/i;
const LOCATION_PATH = /(?:primary.*(?:location|area)|(?:location|area).*primary|geographic_area_meta\.label|geographic_areas?|service_areas?|locations?)/i;
const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain', 'metadata.google.internal',
  '169.254.169.254', 'metadata.aws.internal',
]);
const BLOCKED_RESULT_HOSTS = [
  /(^|\.)facebook\.com$/i, /(^|\.)linkedin\.com$/i, /(^|\.)instagram\.com$/i,
  /(^|\.)x\.com$/i, /(^|\.)twitter\.com$/i, /(^|\.)youtube\.com$/i,
  /(^|\.)yelp\.com$/i, /(^|\.)bbb\.org$/i, /(^|\.)clutch\.co$/i,
  /(^|\.)crunchbase\.com$/i, /(^|\.)zoominfo\.com$/i, /(^|\.)mapquest\.com$/i,
  /(^|\.)yellowpages\.com$/i, /(^|\.)chamberofcommerce\.com$/i,
];
const LEGAL_SUFFIXES = new Set(['llc', 'inc', 'incorporated', 'ltd', 'limited', 'corp', 'corporation', 'company', 'co', 'pllc']);

export function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeNarrativeText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n\s*\n+/g, '. ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function normalizeForMatch(value) {
  return normalizeNarrativeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9&' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForPhraseMatch(value) {
  return normalizeNarrativeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9&' -]+/g, ' | ')
    .replace(/[\t ]+/g, ' ')
    .trim();
}

export function isMissingIdentityValue(value) {
  if (value === null || value === undefined) return true;
  return PLACEHOLDER_VALUES.has(normalizeForMatch(value));
}

export function normalizeDomain(value) {
  if (isMissingIdentityValue(value)) return '';
  try {
    const raw = String(value).trim();
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return '';
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getSourceSnapshots(recordType, record) {
  const candidates = recordType === 'draft'
    ? [
        ['mapped_payload_json', record.mapped_payload_json],
        ['responses_json', record.responses_json],
        ['userdata_json', record.userdata_json],
        ['metadata_json', record.metadata_json],
      ]
    : [
        ['transformed_payload_json', record.transformed_payload_json],
        ['raw_responses_json', record.raw_responses_json],
      ];
  return candidates
    .map(([name, value]) => [name, parseJson(value)])
    .filter(([, value]) => value !== null && value !== undefined);
}

export function getSourcePayload(recordType, record) {
  if (recordType === 'draft') {
    return parseJson(record.mapped_payload_json) || parseJson(record.responses_json) || null;
  }
  return parseJson(record.transformed_payload_json) || parseJson(record.raw_responses_json) || null;
}

function collectStrings(value, path, output, depth = 0) {
  if (depth > 12 || output.length >= 120) return;
  if (typeof value === 'string') {
    const normalized = normalizeNarrativeText(value);
    if (
      normalized.length >= 4 && normalized.length <= 12_000 &&
      !EXCLUDED_PATH.test(path) &&
      !/^\S+@\S+\.\S+$/.test(normalized) &&
      !/^https?:\/\//i.test(normalized)
    ) {
      output.push({
        path,
        text: normalized.slice(0, 1_500),
        preferred: PREFERRED_NARRATIVE_PATH.test(path),
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 40).forEach((item, index) => collectStrings(item, `${path}[${index}]`, output, depth + 1));
    return;
  }
  if (isPlainObject(value)) {
    Object.entries(value).slice(0, 100).forEach(([key, item]) => {
      collectStrings(item, path ? `${path}.${key}` : key, output, depth + 1);
    });
  }
}

export function extractNarrativeEvidence(recordType, record) {
  const collected = [];
  for (const [snapshotName, snapshot] of getSourceSnapshots(recordType, record)) {
    collectStrings(snapshot, snapshotName, collected);
  }

  const unique = [];
  const seen = new Set();
  let totalCharacters = 0;
  for (const item of collected.sort((left, right) => Number(right.preferred) - Number(left.preferred))) {
    const key = `${item.path}:${item.text}`;
    if (seen.has(key)) continue;
    if (totalCharacters + item.text.length > 24_000) break;
    seen.add(key);
    totalCharacters += item.text.length;
    unique.push(item);
  }
  return unique;
}

function locationCandidate(value) {
  const normalized = normalizeNarrativeText(value);
  if (normalized.length < 2 || normalized.length > 180 || isMissingIdentityValue(normalized)) return '';
  return normalized;
}

function findLocationRecursively(value, path = '', depth = 0) {
  if (depth > 10) return '';
  if (typeof value === 'string' && LOCATION_PATH.test(path)) return locationCandidate(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLocationRecursively(item, path, depth + 1);
      if (found) return found;
    }
  } else if (isPlainObject(value)) {
    const entries = Object.entries(value);
    const primaryEntries = entries.filter(([key]) => /primary/i.test(key));
    for (const [key, item] of [...primaryEntries, ...entries]) {
      const nextPath = path ? `${path}.${key}` : key;
      const found = findLocationRecursively(item, nextPath, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

export function extractPrimaryLocation(recordType, record) {
  for (const [, snapshot] of getSourceSnapshots(recordType, record)) {
    const direct = snapshot?.userdata?.geographic_area_meta?.label;
    if (locationCandidate(direct)) return locationCandidate(direct);
    const geographicAreas = snapshot?.userdata?.geographic_areas;
    if (locationCandidate(geographicAreas)) return locationCandidate(geographicAreas);
  }
  for (const [, snapshot] of getSourceSnapshots(recordType, record)) {
    const found = findLocationRecursively(snapshot);
    if (found) return found;
  }
  return '';
}

function canonicalIdentity(recordType, record) {
  const payload = getSourcePayload(recordType, record) || {};
  const metadata = payload?.metadata || {};
  return {
    businessName: normalizeNarrativeText(
      record.business_name || metadata.business_name || payload?.userdata?.business_name || '',
    ),
    domain: normalizeDomain(
      (recordType === 'draft' ? record.domain : record.business_domain) ||
      metadata.businessDomain || metadata.business_domain || payload?.userdata?.business_domain || '',
    ),
  };
}

export async function createIdentityFingerprint(recordType, record) {
  const snapshots = getSourceSnapshots(recordType, record).map(([name, value]) => [name, stableValue(value)]);
  const identity = canonicalIdentity(recordType, record);
  return sha256(JSON.stringify(stableValue({ recordType, snapshots, identity })));
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function scoreBusinessNameCandidate({ candidate, modelConfidence, conflicts = [], evidence = [] }) {
  const normalizedCandidate = normalizeForMatch(candidate);
  if (!normalizedCandidate || isMissingIdentityValue(normalizedCandidate)) {
    return { confidence: 0, evidenceScore: 0, autoEligible: false, supportingEvidence: [], reasons: ['No usable candidate.'] };
  }

  const candidateExpression = `\\b${escapeRegex(normalizedCandidate).replace(/\\ /g, '\\s+')}\\b`;
  const supportingPattern = new RegExp(candidateExpression, 'i');
  const supportingEvidence = evidence.filter((item) => supportingPattern.test(normalizeForPhraseMatch(item.text)));
  if (supportingEvidence.length === 0) {
    return { confidence: 0, evidenceScore: 0, autoEligible: false, supportingEvidence: [], reasons: ['Candidate is not grounded in client-written text.'] };
  }

  const combined = supportingEvidence.map((item) => normalizeForPhraseMatch(item.text)).join(' | ');
  const candidatePattern = new RegExp(candidateExpression, 'gi');
  const occurrences = (combined.match(candidatePattern) || []).length;
  candidatePattern.lastIndex = 0;
  const subjectPattern = new RegExp(`\\b${escapeRegex(normalizedCandidate)}\\s+(?:helps|provides|offers|delivers|supports|specializes|partners|works|is|combines)\\b`, 'i');
  const headingPattern = new RegExp(`\\b(?:why|about|choose)\\s+${escapeRegex(normalizedCandidate)}\\b`, 'i');
  const hasSubjectReference = supportingEvidence.some((item) => subjectPattern.test(normalizeForPhraseMatch(item.text)));
  const hasHeadingReference = supportingEvidence.some((item) => headingPattern.test(normalizeForPhraseMatch(item.text)));
  const distinctPaths = new Set(supportingEvidence.map((item) => item.path)).size;

  let evidenceScore = 0.58;
  if (hasSubjectReference) evidenceScore += 0.16;
  if (hasHeadingReference) evidenceScore += 0.14;
  if (occurrences >= 2) evidenceScore += 0.08;
  if (distinctPaths >= 2) evidenceScore += 0.05;
  if (supportingEvidence.some((item) => item.preferred)) evidenceScore += 0.03;
  if (conflicts.length > 0) evidenceScore -= Math.min(0.40, 0.20 * conflicts.length);
  evidenceScore = clampConfidence(evidenceScore);

  const confidence = Math.min(clampConfidence(modelConfidence), evidenceScore);
  const reasons = [
    `Grounded in ${supportingEvidence.length} client-written excerpt(s).`,
    hasSubjectReference ? 'Used as the subject of a company self-description.' : 'No strong company-subject statement found.',
    hasHeadingReference ? 'Appears in a company/about-style heading.' : 'No company/about-style heading found.',
    conflicts.length ? `${conflicts.length} conflicting organization candidate(s) reported.` : 'No conflicting organization candidate reported.',
  ];
  return {
    confidence,
    evidenceScore,
    autoEligible: confidence >= BUSINESS_NAME_THRESHOLD && conflicts.length === 0,
    supportingEvidence: supportingEvidence.slice(0, 8),
    reasons,
  };
}

function buildNamePrompt(evidence) {
  const excerpts = evidence.slice(0, 40).map((item, index) => ({
    index,
    path: item.path,
    text: item.text,
  }));
  return `Identify the business that authored these Express questionnaire answers.

Return a candidate only when the client's own text explicitly supports it. Do not join words across sentence or paragraph boundaries. Do not select customers, vendors, software products, competitors, or target industries. A phrase such as "Security is..." after a paragraph boundary does not make "Security" part of the preceding company name. Preserve the supported brand wording; do not add LLC, Inc., or another legal suffix unless it appears in the excerpts.

Return JSON with candidate, confidence from 0 to 1, evidence_paths, conflicts, and rationale. Use candidate=null when ambiguous.

Client-written excerpts:
${JSON.stringify(excerpts)}`;
}

async function withTimeout(promise, milliseconds, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function inferBusinessName(base44, evidence) {
  if (!evidence.length) return { candidate: '', confidence: 0, conflicts: [], evidence_paths: [], rationale: 'No eligible narrative text.' };
  const result = await withTimeout(
    base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: buildNamePrompt(evidence),
      response_json_schema: {
        type: 'object',
        properties: {
          candidate: { type: ['string', 'null'] },
          confidence: { type: 'number' },
          evidence_paths: { type: 'array', items: { type: 'string' } },
          conflicts: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
        required: ['candidate', 'confidence', 'evidence_paths', 'conflicts', 'rationale'],
      },
    }),
    15_000,
    'Business-name inference timed out.',
  );
  return isPlainObject(result) ? result : {};
}

function isPrivateIpv4(hostname) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const values = match.slice(1).map(Number);
  if (values.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = values;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIpv6(hostname) {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
}

export function isPublicHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!normalized || BLOCKED_HOSTS.has(normalized) || normalized.endsWith('.local') || normalized.endsWith('.internal')) return false;
  if (isPrivateIpv4(normalized) || (normalized.includes(':') && isPrivateIpv6(normalized))) return false;
  return normalized.includes('.');
}

async function hostnameResolvesPublicly(hostname) {
  if (!isPublicHostname(hostname)) return false;
  const resolver = globalThis.Deno?.resolveDns;
  if (typeof resolver !== 'function') return false;
  try {
    const addresses = [];
    for (const type of ['A', 'AAAA']) {
      try { addresses.push(...await resolver(hostname, type)); } catch { /* one family may be absent */ }
    }
    return addresses.length > 0 && addresses.every((address) => isPublicHostname(String(address)));
  } catch {
    return false;
  }
}

async function readLimitedText(response, maxBytes = 350_000) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('Website response exceeded the size limit.');
  if (!response.body?.getReader) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Website response exceeded the size limit.');
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(combined);
}

async function fetchPublicHtml(inputUrl) {
  let current = new URL(inputUrl);
  if (current.protocol !== 'https:' && current.protocol !== 'http:') throw new Error('Unsupported website protocol.');
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (!await hostnameResolvesPublicly(current.hostname)) throw new Error('Website hostname did not pass public-network validation.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    try {
      const response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'ExpressIdentityResolver/1.0' },
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirect === 3) throw new Error('Unsafe or excessive website redirect.');
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`Website returned ${response.status}.`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('text/html')) throw new Error('Website did not return HTML.');
      return { url: current.toString(), html: await readLimitedText(response) };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('Website redirect limit exceeded.');
}

function htmlToText(html) {
  return normalizeNarrativeText(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'"));
}

function meaningfulNameTokens(name) {
  return normalizeForMatch(name).split(' ').filter((token) => token.length >= 3 && !LEGAL_SUFFIXES.has(token));
}

function locationTokens(location) {
  return normalizeForMatch(location).split(' ').filter((token) => token.length >= 2);
}

export function scoreDomainCandidate({ businessName, location, result, pageText }) {
  const hostname = normalizeDomain(result?.link || '');
  if (!hostname || BLOCKED_RESULT_HOSTS.some((pattern) => pattern.test(hostname))) {
    return { confidence: 0, autoEligible: false, hostname, reasons: ['Result is not an eligible first-party website.'] };
  }
  const combined = normalizeForMatch(`${result?.title || ''} ${result?.snippet || ''} ${pageText || ''}`);
  const nameTokens = meaningfulNameTokens(businessName);
  const locTokens = locationTokens(location);
  const nameMatch = nameTokens.length > 0 && nameTokens.every((token) => combined.includes(token));
  const serviceMatch = /\b(?:managed it|information technology|cybersecurity|cyber security|msp|it services|cloud services|technology solutions|network security)\b/i.test(combined);
  const locationMatch = locTokens.length > 0 && locTokens.every((token) => combined.includes(token));
  const compactHost = hostname.replace(/[^a-z0-9]/g, '');
  const domainBrandMatch = nameTokens.some((token) => compactHost.includes(token.replace(/[^a-z0-9]/g, '')));
  const position = Math.max(1, Number(result?.position || 5));

  let confidence = 0;
  if (nameMatch) confidence += 0.52;
  if (serviceMatch) confidence += 0.20;
  if (locationMatch) confidence += 0.18;
  if (domainBrandMatch) confidence += 0.05;
  confidence += Math.max(0.01, 0.06 - position * 0.01);
  confidence = clampConfidence(confidence);
  const reasons = [
    nameMatch ? 'Official site content matches the business name.' : 'Business-name match was insufficient.',
    serviceMatch ? 'Site describes IT/MSP/cybersecurity services.' : 'IT/MSP service evidence was insufficient.',
    locationMatch ? 'Site content matches the questionnaire location.' : 'Location evidence was insufficient.',
    domainBrandMatch ? 'Hostname contains a distinctive business-name token.' : 'Hostname did not match a distinctive business-name token.',
  ];
  return { confidence, autoEligible: confidence >= DOMAIN_THRESHOLD, hostname, reasons };
}

async function searchSerpApi({ apiKey, query }) {
  if (!apiKey) throw new Error('SERPAPI_API_KEY is not configured.');
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('num', '5');
  url.searchParams.set('api_key', apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`SerpAPI returned ${response.status}.`);
    const body = await response.json();
    if (body?.error) throw new Error(`SerpAPI error: ${body.error}`);
    return Array.isArray(body?.organic_results) ? body.organic_results.slice(0, 5).map((result, index) => ({
      position: Number(result.position || index + 1),
      title: normalizeNarrativeText(result.title || '').slice(0, 300),
      link: String(result.link || '').slice(0, 2_000),
      snippet: normalizeNarrativeText(result.snippet || '').slice(0, 800),
    })) : [];
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectDomainResults({ businessName, location, organicResults }) {
  const eligible = organicResults.filter((result) => {
    const hostname = normalizeDomain(result.link);
    return hostname && !BLOCKED_RESULT_HOSTS.some((pattern) => pattern.test(hostname));
  }).slice(0, 5);
  const inspected = await Promise.all(eligible.map(async (result) => {
    try {
      const fetched = await fetchPublicHtml(result.link);
      const pageText = htmlToText(fetched.html).slice(0, 80_000);
      return { result, fetchedUrl: fetched.url, ...scoreDomainCandidate({ businessName, location, result, pageText }) };
    } catch (error) {
      return {
        result,
        fetchedUrl: '',
        hostname: normalizeDomain(result.link),
        confidence: 0,
        autoEligible: false,
        reasons: [error?.message || 'Website inspection failed.'],
      };
    }
  }));
  return inspected.sort((left, right) => right.confidence - left.confidence);
}

function setIdentityInPayload(payload, businessName, domain) {
  const working = isPlainObject(payload) ? { ...payload } : {};
  const metadata = isPlainObject(working.metadata) ? { ...working.metadata } : {};
  if (businessName) metadata.business_name = businessName;
  if (domain) metadata.businessDomain = domain;
  return { ...working, metadata };
}

function getSourceEntity(base44, recordType) {
  return recordType === 'draft'
    ? base44.asServiceRole.entities.FormDraft
    : base44.asServiceRole.entities.FormSubmissionIntake;
}

function sourceSessionId(recordType, record) {
  return String(recordType === 'draft' ? record.session_id || '' : record.questionnaire_session_id || '');
}

function buildIdentitySourcePatch(recordType, record, businessName, domain) {
  const patch = {};
  if (businessName && isMissingIdentityValue(record.business_name)) patch.business_name = businessName;
  if (recordType === 'draft') {
    if (domain && isMissingIdentityValue(record.domain)) patch.domain = domain;
  } else if (domain && isMissingIdentityValue(record.business_domain)) {
    patch.business_domain = domain;
  }

  const payload = getSourcePayload(recordType, record);
  const updatedPayload = setIdentityInPayload(
    payload,
    patch.business_name || canonicalIdentity(recordType, record).businessName,
    (recordType === 'draft' ? patch.domain : patch.business_domain) || canonicalIdentity(recordType, record).domain,
  );

  if (recordType === 'draft') {
    if (parseJson(record.mapped_payload_json) || isPlainObject(payload?.metadata)) {
      patch.mapped_payload_json = JSON.stringify(updatedPayload);
    }
    const metadata = parseJson(record.metadata_json);
    if (isPlainObject(metadata)) {
      patch.metadata_json = JSON.stringify({
        ...metadata,
        ...(patch.business_name ? { business_name: patch.business_name } : {}),
        ...(patch.domain ? { businessDomain: patch.domain } : {}),
      });
    }
  } else {
    patch.transformed_payload_json = JSON.stringify(updatedPayload);
  }
  return { patch, payload: updatedPayload };
}

async function findRejectedCandidates(base44, recordType, recordId, fingerprint) {
  try {
    const reviews = await base44.asServiceRole.entities.ExpressIdentityResolutionAttempt.filter({
      event_type: 'review',
      record_type: recordType,
      record_id: recordId,
      payload_fingerprint: fingerprint,
      resolver_version: IDENTITY_RESOLVER_VERSION,
      review_decision: 'reject',
    }, '-created_date', 100);
    return new Set((reviews || []).map((item) => normalizeForMatch(item.candidate_value || '')));
  } catch {
    return new Set();
  }
}

async function findCachedSearch(base44, query) {
  try {
    const attempts = await base44.asServiceRole.entities.ExpressIdentityResolutionAttempt.filter({
      event_type: 'resolution',
      search_query: query,
      resolver_version: IDENTITY_RESOLVER_VERSION,
    }, '-created_date', 1);
    const attempt = attempts?.[0];
    const createdAt = Date.parse(attempt?.created_date || '');
    if (!attempt || !Number.isFinite(createdAt) || Date.now() - createdAt > 24 * 60 * 60 * 1000) return null;
    const cached = parseJson(attempt.search_results_json);
    return Array.isArray(cached) ? cached : null;
  } catch {
    return null;
  }
}

function safeEvidenceForAudit(resolution) {
  return {
    businessName: {
      reasons: resolution.businessName.reasons || [],
      evidence: (resolution.businessName.evidence || []).slice(0, 8).map((item) => ({
        path: item.path,
        excerpt: String(item.text || '').slice(0, 500),
      })),
      conflicts: resolution.businessName.conflicts || [],
    },
    domain: {
      reasons: resolution.domain.reasons || [],
      inspected: (resolution.domain.inspected || []).slice(0, 5).map((item) => ({
        hostname: item.hostname,
        url: item.fetchedUrl || item.result?.link || '',
        confidence: item.confidence,
        reasons: item.reasons,
      })),
    },
  };
}

async function createResolutionAudit(base44, details) {
  try {
    return await base44.asServiceRole.entities.ExpressIdentityResolutionAttempt.create(details);
  } catch (error) {
    console.error('Identity resolution audit creation failed.', error);
    return null;
  }
}

export async function resolveSubmissionIdentity({
  base44,
  recordType,
  record,
  trigger,
  apply = false,
  serpApiKey = '',
  recoveryEnabled = true,
  webSearchEnabled = true,
  withSessionLease,
}) {
  const startedAt = Date.now();
  const initialPayload = getSourcePayload(recordType, record);
  const fingerprint = await createIdentityFingerprint(recordType, record);
  const existing = canonicalIdentity(recordType, record);
  const primaryLocation = extractPrimaryLocation(recordType, record);
  const rejectedCandidates = await findRejectedCandidates(base44, recordType, record.id, fingerprint);
  const errors = [];

  const resolution = {
    resolverVersion: IDENTITY_RESOLVER_VERSION,
    trigger,
    recordType,
    recordId: record.id,
    payloadFingerprint: fingerprint,
    primaryLocation,
    status: 'needs_review',
    businessName: {
      existing: existing.businessName,
      candidate: '', confidence: existing.businessName ? 1 : 0,
      decision: existing.businessName ? 'confirmed_existing' : 'unresolved',
      autoEligible: Boolean(existing.businessName), evidence: [], reasons: [], conflicts: [],
    },
    domain: {
      existing: existing.domain,
      candidate: '', confidence: existing.domain ? 1 : 0,
      decision: existing.domain ? 'confirmed_existing' : 'unresolved',
      autoEligible: Boolean(existing.domain), reasons: [], inspected: [],
    },
    appliedFields: [],
    errors,
    attemptId: null,
    durationMs: 0,
  };

  if (!recoveryEnabled) {
    resolution.status = 'disabled';
    resolution.errors.push('Identity recovery is disabled.');
  } else if (!existing.businessName) {
    try {
      const evidence = extractNarrativeEvidence(recordType, record);
      const inference = await inferBusinessName(base44, evidence);
      const candidate = normalizeNarrativeText(inference.candidate || '');
      const scored = scoreBusinessNameCandidate({
        candidate,
        modelConfidence: inference.confidence,
        conflicts: Array.isArray(inference.conflicts) ? inference.conflicts : [],
        evidence,
      });
      const previouslyRejected = rejectedCandidates.has(normalizeForMatch(candidate));
      resolution.businessName = {
        existing: '',
        candidate,
        confidence: scored.confidence,
        evidenceScore: scored.evidenceScore,
        decision: previouslyRejected ? 'rejected_previously' : (scored.autoEligible ? 'auto_eligible' : (candidate ? 'needs_review' : 'unresolved')),
        autoEligible: scored.autoEligible && !previouslyRejected,
        evidence: scored.supportingEvidence,
        reasons: scored.reasons,
        conflicts: Array.isArray(inference.conflicts) ? inference.conflicts : [],
        rationale: String(inference.rationale || '').slice(0, 1_000),
      };
    } catch (error) {
      resolution.businessName.decision = 'provider_error';
      resolution.businessName.reasons = [error?.message || 'Business-name inference failed.'];
      errors.push(error?.message || 'Business-name inference failed.');
    }
  }

  const confirmedName = existing.businessName || (resolution.businessName.autoEligible ? resolution.businessName.candidate : '');
  let organicResults = [];
  let searchQuery = '';
  if (!existing.domain) {
    if (!confirmedName) {
      resolution.domain.decision = 'blocked_missing_business_name';
      resolution.domain.reasons = ['Domain discovery requires a confirmed business name.'];
    } else if (!primaryLocation) {
      resolution.domain.decision = 'blocked_missing_location';
      resolution.domain.reasons = ['Domain discovery requires a primary questionnaire location.'];
    } else if (!webSearchEnabled) {
      resolution.domain.decision = 'provider_disabled';
      resolution.domain.reasons = ['Web domain discovery is disabled.'];
    } else {
      searchQuery = `${confirmedName} IT Company ${primaryLocation}`;
      try {
        organicResults = await findCachedSearch(base44, searchQuery) || await searchSerpApi({ apiKey: serpApiKey, query: searchQuery });
        const inspected = await inspectDomainResults({ businessName: confirmedName, location: primaryLocation, organicResults });
        const best = inspected[0];
        resolution.domain = {
          existing: '',
          candidate: best?.hostname || '',
          confidence: best?.confidence || 0,
          decision: best?.autoEligible ? 'auto_eligible' : (best?.hostname ? 'needs_review' : 'unresolved'),
          autoEligible: Boolean(best?.autoEligible),
          reasons: best?.reasons || ['No eligible first-party domain was verified.'],
          inspected,
        };
        if (best?.hostname && rejectedCandidates.has(normalizeForMatch(best.hostname))) {
          resolution.domain.decision = 'rejected_previously';
          resolution.domain.autoEligible = false;
        }
      } catch (error) {
        resolution.domain.decision = 'provider_error';
        resolution.domain.reasons = [error?.message || 'Domain discovery failed.'];
        errors.push(error?.message || 'Domain discovery failed.');
      }
    }
  }

  const selectedName = existing.businessName || (resolution.businessName.autoEligible ? resolution.businessName.candidate : '');
  const selectedDomain = existing.domain || (resolution.domain.autoEligible ? resolution.domain.candidate : '');
  const nameToApply = existing.businessName ? '' : (resolution.businessName.autoEligible ? resolution.businessName.candidate : '');
  const domainToApply = existing.domain ? '' : (resolution.domain.autoEligible ? resolution.domain.candidate : '');
  let resolvedPayload = setIdentityInPayload(initialPayload, selectedName, selectedDomain);

  if (apply && (nameToApply || domainToApply)) {
    const applyOperation = async () => {
      const entity = getSourceEntity(base44, recordType);
      const current = await entity.get(record.id);
      const currentFingerprint = await createIdentityFingerprint(recordType, current);
      if (currentFingerprint !== fingerprint) {
        resolution.status = 'stale';
        errors.push('The record changed during identity resolution; no identity values were applied.');
        return;
      }
      const sourceUpdate = buildIdentitySourcePatch(recordType, current, nameToApply, domainToApply);
      const identityFields = recordType === 'draft'
        ? ['business_name', 'domain']
        : ['business_name', 'business_domain'];
      resolution.appliedFields = identityFields.filter((field) => Object.prototype.hasOwnProperty.call(sourceUpdate.patch, field));
      if (resolution.appliedFields.length > 0) {
        await entity.update(record.id, sourceUpdate.patch);
        resolvedPayload = sourceUpdate.payload;
        if (resolution.appliedFields.includes('business_name')) resolution.businessName.decision = 'applied';
        if (resolution.appliedFields.includes('domain') || resolution.appliedFields.includes('business_domain')) resolution.domain.decision = 'applied';
      }
    };
    if (typeof withSessionLease === 'function') {
      await withSessionLease({
        base44,
        sessionId: sourceSessionId(recordType, record) || `identity:${recordType}:${record.id}`,
        purpose: `identity-recovery:${recordType}:${record.id}`,
        operation: applyOperation,
      });
    } else {
      await applyOperation();
    }
  }

  const allResolved = Boolean(selectedName) && Boolean(selectedDomain);
  resolution.status = resolution.status === 'stale'
    ? 'stale'
    : (allResolved ? (resolution.appliedFields.length ? 'applied' : 'resolved') : (errors.length ? 'provider_error' : 'needs_review'));
  resolution.durationMs = Date.now() - startedAt;

  const attempt = await createResolutionAudit(base44, {
    event_type: 'resolution',
    record_type: recordType,
    record_id: String(record.id),
    questionnaire_session_id: sourceSessionId(recordType, record),
    trigger,
    resolver_version: IDENTITY_RESOLVER_VERSION,
    payload_fingerprint: fingerprint,
    status: resolution.status,
    primary_location: primaryLocation,
    business_name_candidate: resolution.businessName.candidate || '',
    business_name_confidence: resolution.businessName.confidence || 0,
    business_name_decision: resolution.businessName.decision,
    domain_candidate: resolution.domain.candidate || '',
    domain_confidence: resolution.domain.confidence || 0,
    domain_decision: resolution.domain.decision,
    search_query: searchQuery,
    search_results_json: JSON.stringify(organicResults.slice(0, 5)),
    identity_resolution_json: JSON.stringify({ ...resolution, attemptId: null }),
    evidence_json: JSON.stringify(safeEvidenceForAudit(resolution)),
    source_urls_json: JSON.stringify((resolution.domain.inspected || []).map((item) => item.fetchedUrl || item.result?.link || '').filter(Boolean)),
    applied_fields_json: JSON.stringify(resolution.appliedFields),
    errors_json: JSON.stringify(errors),
    duration_ms: resolution.durationMs,
  });
  resolution.attemptId = attempt?.id || null;
  resolution.currentPayloadFingerprint = fingerprint;

  if (apply) {
    try {
      const entity = getSourceEntity(base44, recordType);
      const current = await entity.get(record.id);
      resolution.currentPayloadFingerprint = await createIdentityFingerprint(recordType, current);
      await entity.update(record.id, {
        identity_latest_attempt_id: resolution.attemptId || '',
        identity_recovery_status: resolution.status,
        identity_input_fingerprint: resolution.currentPayloadFingerprint,
        identity_recovery_version: IDENTITY_RESOLVER_VERSION,
        last_identity_recovery_at: new Date().toISOString(),
        identity_recovery_attempt_count: Number(current.identity_recovery_attempt_count || 0) + 1,
        identity_business_name_candidate: resolution.businessName.candidate || '',
        identity_business_name_confidence: resolution.businessName.confidence || 0,
        identity_domain_candidate: resolution.domain.candidate || '',
        identity_domain_confidence: resolution.domain.confidence || 0,
        identity_evidence_json: JSON.stringify(safeEvidenceForAudit(resolution)),
      });
    } catch (error) {
      errors.push(error?.message || 'Identity summary update failed.');
    }
  }

  return { resolution, payload: resolvedPayload, fingerprint };
}

export async function reviewIdentityResolution({
  base44,
  attempt,
  field,
  decision,
  expectedFingerprint,
  withSessionLease,
  reviewerId = '',
}) {
  const original = parseJson(attempt.identity_resolution_json);
  if (!original || attempt.event_type !== 'resolution') throw new Error('Identity resolution attempt is invalid.');
  if (!['business_name', 'domain'].includes(field)) throw new Error('Unsupported identity field.');
  if (!['apply', 'reject'].includes(decision)) throw new Error('Unsupported review decision.');
  const candidate = field === 'business_name' ? original.businessName?.candidate : original.domain?.candidate;
  if (!candidate) throw new Error('This attempt has no candidate for the selected field.');

  const recordType = attempt.record_type;
  const entity = getSourceEntity(base44, recordType);
  const recordId = attempt.record_id;
  let postFingerprint = expectedFingerprint;
  let applied = false;

  const operation = async () => {
    const current = await entity.get(recordId);
    const currentFingerprint = await createIdentityFingerprint(recordType, current);
    if (!expectedFingerprint || currentFingerprint !== expectedFingerprint) {
      throw new Error('The record changed after this evidence was produced. Run Diagnose again before reviewing it.');
    }
    if (decision === 'apply') {
      if (field === 'domain' && isMissingIdentityValue(canonicalIdentity(recordType, current).businessName)) {
        throw new Error('Accept or enter a Business Name before applying a Domain.');
      }
      const currentValue = field === 'business_name'
        ? current.business_name
        : (recordType === 'draft' ? current.domain : current.business_domain);
      if (!isMissingIdentityValue(currentValue) && normalizeForMatch(currentValue) !== normalizeForMatch(candidate)) {
        throw new Error(`The existing ${field === 'business_name' ? 'Business Name' : 'Domain'} cannot be overwritten automatically.`);
      }
      const sourceUpdate = buildIdentitySourcePatch(
        recordType,
        current,
        field === 'business_name' ? candidate : '',
        field === 'domain' ? candidate : '',
      );
      await entity.update(recordId, sourceUpdate.patch);
      applied = true;
      const refreshed = await entity.get(recordId);
      postFingerprint = await createIdentityFingerprint(recordType, refreshed);
    }
  };

  const record = await entity.get(recordId);
  await withSessionLease({
    base44,
    sessionId: sourceSessionId(recordType, record) || `identity-review:${recordType}:${recordId}`,
    purpose: `identity-review:${attempt.id}:${field}`,
    operation,
  });

  await createResolutionAudit(base44, {
    event_type: 'review',
    parent_attempt_id: String(attempt.id),
    record_type: recordType,
    record_id: String(recordId),
    questionnaire_session_id: sourceSessionId(recordType, record),
    trigger: 'admin_review',
    resolver_version: IDENTITY_RESOLVER_VERSION,
    payload_fingerprint: expectedFingerprint,
    post_review_fingerprint: postFingerprint,
    status: applied ? 'applied' : 'rejected',
    field_name: field,
    review_decision: decision,
    candidate_value: String(candidate),
    reviewer_id: String(reviewerId || ''),
    applied_fields_json: JSON.stringify(applied ? [field] : []),
    reviewed_at: new Date().toISOString(),
    identity_resolution_json: JSON.stringify(original),
  });

  return {
    ok: true,
    applied,
    rejected: decision === 'reject',
    field,
    candidate,
    payloadFingerprint: postFingerprint,
  };
}

export function getChicagoScheduleParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    weekday: value('weekday'),
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour')),
    minute: Number(value('minute')),
  };
}

export function isChicagoIdentityRecoveryWindow(date = new Date()) {
  const parts = getChicagoScheduleParts(date);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday) && parts.hour === 4;
}
