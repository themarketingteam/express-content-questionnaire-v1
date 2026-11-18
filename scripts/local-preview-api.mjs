import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildExpressSubmissionPayload, mapExpressPayloadToFormSubmissionRecord } from '../src/lib/expressQuestionnairePayload.js';
import { requireExpressSubmissionIntegrity } from '../src/lib/expressSubmissionIntegrity.js';
import { guardOrganizedDraftMutation, preserveOrganizedMappedPayload, validateOrganizedPayload, validateOrganizedSubmission } from '../base44/shared/pageOrganizerContract.js';
import { localExpressFixture } from './local-preview-fixtures.mjs';
import { EXPRESS_SERVICE_OPTIONS, EXPRESS_ACCEPTED_INDUSTRY_OPTIONS } from '../src/components/questionnaire/pageOrganizerCatalog.js';
import { flattenPageStructure, getPageCatalogId } from '../src/lib/pageOrganizerModel.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const fail = (message, status = 400, code = 'LOCAL_REQUEST_REJECTED') => { throw Object.assign(new Error(message), { status, code }); };
const parse = (value, fallback = {}) => {
  if (value && typeof value === 'object') return clone(value);
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fail('Invalid local draft JSON.'); }
};
const assertValid = (result) => { if (!result.ok) fail(result.errors?.join(' ') || 'Invalid page organization.', result.status || 400, result.code); };
const organizerFields = [
  ['serviceOfferingsStructure', 'serviceOfferings', 'serviceOfferingsOther'],
  ['targetIndustriesStructure', 'targetIndustries', 'targetIndustriesOther']
];

export function createLocalApi(root, { dataDirectory = path.join(root, '.local-preview') } = {}) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const statePath = path.join(dataDirectory, 'state.json');
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { format: 'local-express-v1', drafts: {}, submissions: [], captures: [], events: [], records: {} };
  if (state.format !== 'local-express-v1') fail('Unsupported local data format. Existing data was preserved.');
  let transaction = false;
  let dirty = false;
  const writeState = () => {
    try { fs.writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2)); fs.renameSync(`${statePath}.tmp`, statePath); }
    catch (error) { try { fs.unlinkSync(`${statePath}.tmp`); } catch { /* The failed write may not have created a temporary file. */ } throw error; }
  };
  const persist = () => { if (transaction) dirty = true; else writeState(); };
  const transact = (operation) => {
    if (transaction) return operation();
    const before = clone(state); transaction = true; dirty = false;
    try { const result = operation(); if (dirty) writeState(); return result; }
    catch (error) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, before); throw error; }
    finally { transaction = false; dirty = false; }
  };
  const publicDraft = (draft) => clone(Object.fromEntries(Object.entries(draft).filter(([key]) => !['access_key_hash', 'versions', 'mutations', 'clients', 'newClientRequestId'].includes(key))));
  const findSession = (sessionId) => Object.values(state.drafts).find((draft) => draft.session_id === sessionId);
  const authorizedDraft = (body) => {
    const draft = findSession(body.sessionId);
    if (!draft || draft.access_key_hash !== hash(body.accessKey || '')) fail('This credential does not identify a local Express draft.', 403, 'LOCAL_DRAFT_ACCESS_DENIED');
    return draft;
  };
  const version = (draft, type = 'save') => ({ id: id('localversion'), revision: draft.last_confirmed_revision, capturedAt: now(), type, draft: publicDraft(draft) });
  const createDraft = (sessionId, accessKey, fixture = 'legacy', identity = {}, requestId = '') => {
    if (!/^[A-Za-z0-9_-]{20,160}$/.test(sessionId || '') || !/^[A-Za-z0-9_-]{32,160}$/.test(accessKey || '')) fail('A valid local draft identity is required.');
    const seed = localExpressFixture(fixture);
    const businessName = identity.business_name || seed.businessName;
    const domain = identity.domain || seed.domain;
    const payload = buildExpressSubmissionPayload({ formData: seed.formData, businessName, domain, sessionId });
    const draft = {
      id: id('localdraft'), session_id: sessionId, access_key_hash: hash(accessKey), business_name: businessName, domain,
      responses_json: JSON.stringify(seed.formData), mapped_payload_json: JSON.stringify(payload),
      validation_status_json: '{}', touched_questions_json: JSON.stringify(Object.fromEntries(Array.from({ length: 12 }, (_, index) => [String(index + 1), fixture !== 'blank']))),
      expanded_questions_json: JSON.stringify({ '2': true, '8': true }),
      status: 'draft', created_date: now(), last_saved_at: now(), last_confirmed_revision: 0,
      client_revision: 0, mutations: {}, clients: {}, versions: [], newClientRequestId: requestId
    };
    state.drafts[draft.id] = draft; draft.versions.push(version(draft, 'bootstrap')); persist(); return draft;
  };
  const bootstrap = (body) => {
    const existing = findSession(body.sessionId);
    if (existing) {
      authorizedDraft(body);
      return { success: true, bootstrapConfirmed: true, draftId: existing.id, draft: publicDraft(existing), lastConfirmedRevision: existing.last_confirmed_revision, lastSavedAt: existing.last_saved_at };
    }
    const draft = createDraft(body.sessionId, body.accessKey, body.action === 'bootstrap_new_client' ? 'blank' : 'legacy', body.identity || {}, body.newClientRequestId || '');
    return { success: true, bootstrapConfirmed: true, created: true, newClient: body.action === 'bootstrap_new_client', draftId: draft.id, draft: publicDraft(draft), lastConfirmedRevision: 0, lastSavedAt: draft.last_saved_at };
  };
  const save = (body) => {
    const draft = authorizedDraft(body);
    if (draft.status === 'submitted' || draft.final_submission_id) return { success: true, saved: false, stale: true, finalized: true, draftId: draft.id, lastConfirmedRevision: draft.last_confirmed_revision, draft: publicDraft(draft) };
    const incoming = body.draft || {};
    const mutationId = incoming.mutation_id;
    const clientId = incoming.client_instance_id;
    const sequence = Number(incoming.client_sequence);
    if (!mutationId || !clientId || !Number.isSafeInteger(sequence) || sequence < 0) fail('A local save requires a mutation identifier and client sequence.');
    if (draft.mutations[mutationId]) { persist(); return { success: true, saved: true, duplicate: true, draftId: draft.id, lastConfirmedRevision: draft.last_confirmed_revision, lastSavedAt: draft.last_saved_at, draft: publicDraft(draft) }; }
    if (owns(draft.clients, clientId) && sequence <= draft.clients[clientId]) fail('This tab has a newer saved mutation. Reload before saving.', 409, 'STALE_CLIENT_SEQUENCE');
    const currentResponses = parse(draft.responses_json);
    const incomingResponses = parse(incoming.responses_json);
    const changedKeys = parse(incoming.changed_keys_json, Object.keys(incomingResponses));
    const deletedKeys = parse(incoming.deleted_keys_json, []);
    if (!Array.isArray(changedKeys) || !Array.isArray(deletedKeys)) fail('Changed and cleared fields must be arrays.');
    assertValid(guardOrganizedDraftMutation({ currentResponses, incomingResponses, changedKeys, deletedKeys, baseRevision: Number(incoming.base_revision), currentRevision: draft.last_confirmed_revision }));
    const nextResponses = { ...currentResponses };
    for (const key of changedKeys) if (owns(incomingResponses, key)) nextResponses[key] = incomingResponses[key];
    for (const key of deletedKeys) {
      if (owns(incomingResponses, key)) nextResponses[key] = incomingResponses[key];
      else delete nextResponses[key];
    }
    const businessName = incoming.business_name || draft.business_name;
    const domain = incoming.domain || draft.domain;
    const mapped = preserveOrganizedMappedPayload(buildExpressSubmissionPayload({ formData: nextResponses, businessName, domain, sessionId: draft.session_id }), nextResponses);
    assertValid(validateOrganizedPayload(mapped));
    draft.versions.push(version(draft, body.checkpointType || 'save'));
    for (const key of ['validation_status_json', 'touched_questions_json', 'expanded_questions_json', 'last_non_empty_answers_json', 'field_history_json', 'current_question_id', 'last_changed_question_id']) if (owns(incoming, key)) draft[key] = incoming[key];
    Object.assign(draft, { business_name: businessName, domain, responses_json: JSON.stringify(nextResponses), mapped_payload_json: JSON.stringify(mapped), status: incoming.status || draft.status, client_revision: sequence, last_client_instance_id: clientId, last_client_sequence: sequence, last_saved_at: now(), last_confirmed_revision: draft.last_confirmed_revision + 1 });
    draft.clients[clientId] = sequence; draft.mutations[mutationId] = draft.last_confirmed_revision; persist();
    return { success: true, saved: true, stale: false, draftId: draft.id, lastSavedAt: draft.last_saved_at, lastConfirmedRevision: draft.last_confirmed_revision, mutationId, versionId: draft.versions.at(-1).id, draft: publicDraft(draft) };
  };
  const submission = (body) => {
    const payload = body.transformedPayload;
    const responses = body.rawResponses || body.responseSnapshot;
    if (!payload?.metadata?.business_name || !payload?.metadata?.businessDomain || !payload?.userdata || !responses) fail('A complete payload, business identity, and raw response snapshot are required.');
    const draft = findSession(body.questionnaireSessionId || payload.metadata.questionnaire_session_id);
    if (!draft) fail('Save a local recovery draft before submitting.', 409);
    const savedResponses = parse(draft.responses_json);
    assertValid(validateOrganizedSubmission({ payload, responses: savedResponses }));
    assertValid(validateOrganizedSubmission({ payload, responses }));
    for (const [rawKey] of organizerFields) if (owns(savedResponses, rawKey) && !owns(responses, rawKey)) fail('Reload before submitting this organized local draft.', 409);
    for (const [rawKey, number, options] of [['serviceOfferingsStructure', '2', EXPRESS_SERVICE_OPTIONS], ['targetIndustriesStructure', '8', EXPRESS_ACCEPTED_INDUSTRY_OPTIONS]]) {
      if (!owns(responses, rawKey)) continue;
      for (const page of flattenPageStructure(responses[rawKey])) {
        if (page.source === 'predefined' && (!options.includes(page.label) || page.catalogId !== getPageCatalogId(number, page.label))) fail('A predefined page has an unknown catalog identity or label. Review it before submitting.');
      }
    }
    const count = (main, other, tree) => owns(responses, tree)
      ? responses[tree].pages.reduce((total, page) => total + 1 + page.children.length, 0)
      : (responses[main] || []).length + (String(responses[other] || '').trim() ? 1 : 0);
    const services = count('serviceOfferings', 'serviceOfferingsOther', 'serviceOfferingsStructure');
    const industries = count('targetIndustries', 'targetIndustriesOther', 'targetIndustriesStructure');
    if (services < 3 || services > 6 || industries < 1 || industries > 3) fail('Choose 3–6 services and 1–3 industries before submitting.');
    requireExpressSubmissionIntegrity(responses, payload);
    const fingerprint = hash(JSON.stringify({ session: draft.session_id, responses, business: payload.metadata.business_name, domain: payload.metadata.businessDomain }));
    const prior = state.submissions.find((record) => record.local_fingerprint === fingerprint);
    if (prior) { persist(); return { success: true, received: true, submissionCreated: true, submissionId: prior.id, submission: clone(prior), duplicate: true, localOnly: true }; }
    if (draft.status === 'submitted' || draft.final_submission_id) fail('This questionnaire has already been finalized. Contact your team to request a revision.', 409, 'draft_finalized');
    const clean = { metadata: clone(payload.metadata), userdata: clone(payload.userdata) };
    const record = { ...mapExpressPayloadToFormSubmissionRecord(payload), id: id('localsubmission'), created_date: now(), raw_responses: clone(responses), local_payload: clean, local_fingerprint: fingerprint };
    state.submissions.push(record); draft.versions.push(version(draft, 'before_submission'));
    draft.responses_json = JSON.stringify(responses); draft.mapped_payload_json = JSON.stringify(payload); draft.status = 'submitted'; draft.final_submission_id = record.id; draft.last_saved_at = now();
    state.captures.push({ id: id('capture'), route: 'submitExpressQuestionnaireFallback', capturedAt: now(), submissionId: record.id, payload: clean, destination: 'LOCAL DISK ONLY — no Base44 or Zapier delivery' }); persist();
    return { success: true, received: true, submissionCreated: true, submissionId: record.id, submission: clone(record), localOnly: true, zapierSent: false };
  };
  const invokeOperation = (name, body = {}) => {
    if (name === 'questionnaireDraftData') {
      if (['bootstrap', 'bootstrap_new_client'].includes(body.action)) return bootstrap(body);
      if (body.action === 'load') return { success: true, draft: publicDraft(authorizedDraft(body)) };
      if (['save', 'checkpoint'].includes(body.action)) return save(body);
      if (body.action === 'start_revision') fail('Submitted questionnaires are read-only. Contact your team to request a revision.', 403, 'REVISION_REQUIRES_TEAM');
      if (body.action === 'telemetry') { authorizedDraft(body); state.events.push({ id: id('telemetry'), eventType: body.eventType, created_date: now() }); persist(); return { success: true, recorded: true }; }
      fail('Unsupported local draft action.');
    }
    if (name === 'validateExpressQuestionText') return { success: true, status: String(body.answer || '').trim() ? 'complete' : 'incomplete', score: 100, message: 'Local preview: remote AI validation is disconnected.', suggestions: [], reason_codes: [], fieldName: body.fieldName, questionId: body.questionId, validatedAt: now(), localOnly: true };
    if (name === 'submitExpressQuestionnaireFallback') return submission(body);
    if (name === 'sendExpressToZapier') {
      assertValid(validateOrganizedPayload(body));
      const record = [...state.submissions].reverse().find((item) => item.questionnaire_session_id === body.metadata?.questionnaire_session_id);
      if (!record) fail('No durable local submission exists for this delivery.', 409);
      requireExpressSubmissionIntegrity(record.raw_responses, body);
      state.captures.push({ id: id('capture'), route: name, capturedAt: now(), payload: clone(body), destination: 'LOCAL DISK ONLY — webhook intercepted' }); persist();
      return { success: true, localOnly: true, message: 'Captured on this computer; no webhook was called.' };
    }
    fail(`Function ${name} is unavailable locally. No remote fallback exists.`, 501, 'LOCAL_FUNCTION_UNAVAILABLE');
  };
  const invoke = (name, body) => transact(() => invokeOperation(name, body));
  const handleOperation = (url, body = {}, method = 'GET') => {
    if (url.pathname === '/_local/api/health') return { localOnly: true, format: state.format, draftCount: Object.keys(state.drafts).length };
    if (url.pathname === '/_local/api/state') return { localOnly: true, drafts: Object.values(state.drafts).map(publicDraft), captures: clone(state.captures), submissions: clone(state.submissions) };
    if (url.pathname === '/_local/api/fixture' && method === 'POST') {
      const sessionId = id('localexpress'); const accessKey = crypto.randomBytes(32).toString('base64url');
      const draft = createDraft(sessionId, accessKey, body.fixture === 'blank' ? 'blank' : 'legacy');
      return { success: true, sessionId, accessKey, draft: publicDraft(draft) };
    }
    if (url.pathname === '/_local/api/history') return { versions: authorizedDraft(body).versions.map(({ draft: _draft, ...entry }) => entry).reverse() };
    if (url.pathname === '/_local/api/restore' && method === 'POST') {
      const original = authorizedDraft(body); const saved = original.versions.find((entry) => entry.id === body.versionId) || fail('Local version not found.', 404);
      const sessionId = id('localexpress'); const accessKey = crypto.randomBytes(32).toString('base64url');
      const restored = createDraft(sessionId, accessKey, 'blank');
      Object.assign(restored, clone(saved.draft), { id: restored.id, session_id: sessionId, access_key_hash: hash(accessKey), created_date: now(), last_saved_at: now(), last_confirmed_revision: 0, client_revision: 0, clients: {}, mutations: {}, last_client_instance_id: '', last_client_sequence: 0, newClientRequestId: '', status: 'draft' });
      delete restored.final_submission_id;
      restored.mapped_payload_json = JSON.stringify(buildExpressSubmissionPayload({ formData: parse(restored.responses_json), businessName: restored.business_name, domain: restored.domain, sessionId, submitAttemptId: '' }));
      restored.versions = [version(restored, 'restored')]; persist(); return { success: true, sessionId, accessKey };
    }
    const functions = url.pathname.match(/^\/_local\/api\/functions\/([A-Za-z0-9_-]+)$/);
    if (functions && method === 'POST') return invoke(functions[1], body);
    const entities = url.pathname.match(/^\/_local\/api\/entities\/([A-Za-z0-9]+)\/(create|update|filter|get)$/);
    if (entities && method === 'POST') {
      const [, name, action] = entities;
      if (!['FormDraftEvent', 'FormSubmission', 'FormSubmissionIntake'].includes(name)) fail('Entity is unavailable locally.', 501);
      const records = name === 'FormSubmission' ? state.submissions : (state.records[name] ||= []);
      if (action === 'filter') return records.filter((record) => Object.entries(body.query || {}).every(([key, value]) => record[key] === value)).map(clone);
      if (action === 'get') return clone(records.find((record) => record.id === body.id) || fail('Local record not found.', 404));
      if (action === 'create') { if (name !== 'FormDraftEvent') fail('Use the durable local submission endpoint.'); const record = { ...body.data, id: id('localevent'), created_date: now() }; records.push(record); persist(); return clone(record); }
      const record = records.find((item) => item.id === body.id) || fail('Local record not found.', 404);
      const allowed = ['zapier_delivery_status', 'zapier_sent', 'zapier_sent_at', 'zapier_error_json', 'zapier_attempt_count', 'zapier_last_attempted_at'];
      if (Object.keys(body.data || {}).some((key) => !allowed.includes(key))) fail('Only local delivery status updates are allowed.');
      Object.assign(record, body.data); persist(); return clone(record);
    }
    fail('No local endpoint exists. Remote forwarding is disabled.', 404);
  };
  return { invoke, handle: async (url, body, method) => transact(() => handleOperation(url, body, method)), state, statePath, dataDirectory };
}

export function createLocalApiMiddleware(root) {
  const api = createLocalApi(root);
  return async (request, response, next) => {
    const url = new URL(request.url, 'http://localhost:5174');
    if (!url.pathname.startsWith('/_local/') && !url.pathname.startsWith('/api/')) return next();
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) fail('Cross-origin preview requests are blocked.', 403);
      let text = ''; for await (const chunk of request) { text += chunk; if (text.length > 5_000_000) fail('Local request exceeds 5 MB.', 413); }
      const result = await api.handle(url, text ? JSON.parse(text) : {}, request.method);
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result));
    } catch (error) { response.statusCode = error.status || 400; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ success: false, error: error.message, code: error.code || 'LOCAL_REQUEST_REJECTED' })); }
  };
}
