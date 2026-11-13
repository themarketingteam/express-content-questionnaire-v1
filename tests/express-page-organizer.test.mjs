import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as contract from '../base44/shared/pageOrganizerContract.js';
import { buildExpressSubmissionPayload, getInitialExpressFormData, normalizeExpressFormData, mapExpressPayloadToFormSubmissionRecord } from '../src/lib/expressQuestionnairePayload.js';
import { normalizeExpressPageOrganizerFormData, countExpressPageSelections } from '../src/lib/expressPageOrganizer.js';
import { addPage, createPageNode, createPageStructure, getPageCatalogId, movePage } from '../src/lib/pageOrganizerModel.js';
import { serializePageStructure, validateOrganizedPayload, validateOrganizedSubmission, validateExpressOrganizerLimits, restoreOrganizedProjections, guardOrganizedDraftMutation } from '../base44/shared/pageOrganizerContract.js';
import { inspectExpressSubmissionIntegrity } from '../base44/shared/expressSubmissionIntegrity.js';
import { repairExpressSubmissionPayload, validateExpressSubmissionPayload } from '../src/lib/expressPayloadRepair.js';
import { applyDurableDraftMutation } from '../base44/shared/durableDraftMutation.ts';
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/api/base44Client') return { url: 'test:organizer-disabled-sdk', shortCircuit: true };
    if (specifier.startsWith('@/')) return nextResolve(new URL(`../src/${specifier.slice(2)}.js`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) { if (url === 'test:organizer-disabled-sdk') return { format: 'module', shortCircuit: true, source: 'export const base44 = {};' }; return nextLoad(url, context); }
});
after(() => hooks.deregister());
const persisted = await import('../src/lib/expressPersistedState.js');
const { validateAndRepairQuestionnaireState } = await import('../src/lib/expressQuestionnaireStateValidator.js');
const { buildExpressZapierPayload } = await import('../src/lib/expressZapierDelivery.js');
const services = ['Managed IT', 'IT Help Desk', 'Microsoft 365'];
const node = (id, label, source = 'predefined', children = []) => ({ id, label, source, catalogId: source === 'predefined' ? getPageCatalogId('2', label) : null, children });
const tree = () => ({ format: 'page-tree-v1', pages: [node('managed', 'Managed IT', 'predefined', [node('help', 'IT Help Desk'), node('custom', 'Support, planning and compliance', 'custom')])] });
const raw = () => ({ ...getInitialExpressFormData(), serviceOfferings: services, targetIndustries: ['Healthcare / Medical'], differentiation: 'Local expertise.', geographicAreas: 'Austin', idealClient: 'A growing local business.' });
const build = value => buildExpressSubmissionPayload({ formData: value, businessName: 'Synthetic Example IT', domain: 'example.test', sessionId: 'test-session', submitAttemptId: 'test-attempt' });

test('legacy payload and raw snapshot stay unchanged without eager adoption', () => {
  const value = { ...raw(), serviceOfferingsOther: 'Consulting, audits and planning' };
  const payload = build(value);
  assert.equal(Object.hasOwn(payload.metadata, 'questionnaire_payload_version'), false);
  assert.equal(Object.hasOwn(payload.userdata, 'service_offerings_structure'), false);
  assert.deepEqual(payload.userdata.service_offerings, services);
  assert.equal(payload.userdata.service_offerings_other, value.serviceOfferingsOther);
  assert.equal(Object.hasOwn(payload._rawFormData, 'serviceOfferingsStructure'), false);
  assert.equal(Object.hasOwn(getInitialExpressFormData(), 'serviceOfferingsStructure'), false);
});
test('migration stays flat, preserves retired labels, and keeps comma-containing Other whole', () => {
  const value = createPageStructure('2', ['Managed IT', 'Retired service'], 'Compliance, audits and advice', { 'IT SERVICES': services }, services);
  assert.deepEqual(value.pages.map(page => page.label), ['Managed IT', 'Retired service', 'Compliance, audits and advice']);
  assert.ok(value.pages.every(page => page.children.length === 0));
  assert.equal(value.pages[1].source, 'custom');
  assert.equal(countExpressPageSelections({ serviceOfferingsStructure: value }, '2'), 3);
});
test('Q2 adoption exports compact ordered content while retaining editor identity internally', () => {
  const source = { ...raw(), serviceOfferingsStructure: tree(), serviceOfferingsOther: 'stale' };
  const payload = build(source);
  assert.equal(payload.metadata.questionnaire_payload_version, 2);
  assert.deepEqual(payload._rawFormData.serviceOfferingsStructure, tree());
  assert.deepEqual(payload.userdata.service_offerings_structure, { format: 'page-tree-v1', pages: [{ label: 'Managed IT', source: 'predefined', children: [{ label: 'IT Help Desk', source: 'predefined' }, { label: 'Support, planning and compliance', source: 'custom' }] }] });
  assert.deepEqual(payload.userdata.service_offerings, ['Managed IT', 'IT Help Desk']);
  assert.equal(payload.userdata.service_offerings_other, 'Support, planning and compliance');
  assert.deepEqual(payload.userdata.target_industries, source.targetIndustries);
  assert.equal(Object.hasOwn(payload.userdata, 'target_industries_structure'), false);
  assert.equal(inspectExpressSubmissionIntegrity(source, payload).ok, true);
});
test('Q8-only and explicitly empty adoption remain distinct from legacy absence', () => {
  const industry = createPageStructure('8', ['Healthcare / Medical'], 'Private clinics, hospitals', {}, ['Healthcare / Medical']);
  const payload = build({ ...raw(), targetIndustriesStructure: industry });
  assert.equal(payload.metadata.questionnaire_payload_version, 2);
  assert.equal(Object.hasOwn(payload.userdata, 'service_offerings_structure'), false);
  assert.equal(payload.userdata.target_industries_structure.pages[1].label, 'Private clinics, hospitals');
  const empty = build({ ...raw(), serviceOfferingsStructure: { format: 'page-tree-v1', pages: [] } });
  assert.deepEqual(empty.userdata.service_offerings, []);
  assert.equal(empty.metadata.questionnaire_payload_version, 2);
  assert.equal(validateExpressSubmissionPayload(empty).ok, false);
});
test('both normalizers, state validation, and local serialization keep rich structures atomically', () => {
  const source = { ...raw(), serviceOfferingsStructure: tree() };
  for (const normalize of [normalizeExpressFormData, persisted.normalizeExpressFormData]) {
    const next = normalize(source);
    assert.deepEqual(next.serviceOfferingsStructure, tree());
    assert.deepEqual(next.serviceOfferings, ['Managed IT', 'IT Help Desk']);
    assert.equal(next.serviceOfferingsOther, 'Support, planning and compliance');
  }
  const checked = validateAndRepairQuestionnaireState({ formData: source });
  assert.deepEqual((checked.formData || checked.state?.formData || {}).serviceOfferingsStructure, tree());
  const serialized = persisted.serializePersistedState({ formData: source, questionnaireSessionId: 'test-session' });
  assert.deepEqual(JSON.parse(serialized).formData.serviceOfferingsStructure, tree());
});
test('malformed/future adopted trees remain reviewable and cannot silently become legacy', () => {
  for (const malformed of [null, { format: 'future', pages: [] }, serializePageStructure(tree())]) {
    const source = { ...raw(), serviceOfferingsStructure: malformed };
    assert.deepEqual(persisted.normalizeExpressFormData(source).serviceOfferingsStructure, malformed);
    assert.throws(() => build(source));
    assert.throws(() => countExpressPageSelections(source, 'serviceOfferings'));
  }
});
test('priority and parenting round trip through repair, flattened storage, and webhook shaping', () => {
  let organized = tree();
  const extra = createPageNode('2', 'Microsoft 365', { source: 'predefined', catalogId: getPageCatalogId('2', 'Microsoft 365') });
  organized = movePage(addPage(organized, extra), extra.id, null, 0);
  const source = normalizeExpressPageOrganizerFormData({ ...raw(), serviceOfferingsStructure: organized });
  const mapped = repairExpressSubmissionPayload(build(source)).payload;
  assert.equal(validateExpressSubmissionPayload(mapped).ok, true);
  const record = mapExpressPayloadToFormSubmissionRecord(mapped);
  const wire = buildExpressZapierPayload(mapped);
  assert.deepEqual(record.service_offerings_structure, serializePageStructure(organized));
  assert.deepEqual(wire.userdata.service_offerings_structure, record.service_offerings_structure);
  assert.equal(wire.metadata.questionnaire_payload_version, 2);
  assert.equal(wire.metadata.business_domain, 'example.test');
  assert.equal(Object.hasOwn(wire, '_rawFormData'), false);
  assert.equal(inspectExpressSubmissionIntegrity(source, wire).ok, true);
});
test('all pages count including parent and multiple custom pages', () => {
  const many = { format: 'page-tree-v1', pages: Array.from({ length: 7 }, (_, index) => node(`custom-${index}`, `Custom ${index}`, 'custom')) };
  const source = { ...raw(), serviceOfferingsStructure: many };
  assert.equal(countExpressPageSelections(source, 'serviceOfferings'), 7);
  assert.equal(validateExpressOrganizerLimits(build(source)).ok, false);
  assert.equal(inspectExpressSubmissionIntegrity(source, build(source)).ok, false);
  assert.equal(countExpressPageSelections({ serviceOfferingsStructure: tree() }, 'serviceOfferings'), 3);
});
test('integrity rejects missing, reordered, relabeled and reparented structured content', () => {
  const source = { ...raw(), serviceOfferingsStructure: tree() };
  for (const mutate of [
    payload => { delete payload.userdata.service_offerings_structure; },
    payload => { payload.userdata.service_offerings_structure.pages[0].children.reverse(); },
    payload => { payload.userdata.service_offerings_structure.pages[0].children[0].label = 'Replacement'; },
    payload => { payload.userdata.service_offerings_structure.pages.push(payload.userdata.service_offerings_structure.pages[0].children.pop()); },
    payload => { payload.metadata.questionnaire_payload_version = 99; }
  ]) { const payload = build(source); mutate(payload); assert.equal(inspectExpressSubmissionIntegrity(source, payload).ok, false); }
});
test('unknown envelope versions cannot be silently repaired into version 2', () => {
  const payload = build({ ...raw(), serviceOfferingsStructure: tree() }); payload.metadata.questionnaire_payload_version = 99;
  assert.throws(() => restoreOrganizedProjections(payload));
  const repaired = repairExpressSubmissionPayload(payload).payload;
  assert.equal(repaired.metadata.questionnaire_payload_version, 99);
  assert.equal(validateOrganizedPayload(repaired).ok, false);
});
test('draft and submission guards retain strict identity plus logical tree agreement', () => {
  const current = normalizeExpressPageOrganizerFormData({ ...raw(), serviceOfferingsStructure: tree() });
  const incoming = structuredClone(current); incoming.serviceOfferingsStructure.pages[0].children.reverse();
  assert.equal(guardOrganizedDraftMutation({ currentResponses: current, incomingResponses: incoming, changedKeys: ['serviceOfferingsStructure'], baseRevision: 1, currentRevision: 2 }).ok, false);
  assert.equal(validateOrganizedSubmission({ payload: build(incoming), responses: current }).ok, false);
  assert.equal(validateOrganizedSubmission({ payload: build(current), responses: current }).ok, true);
});
test('real durable mutation retains rich raw state/compact output and blocks old-tab writes before version creation', async () => {
  const initial = normalizeExpressPageOrganizerFormData({ ...raw(), serviceOfferingsStructure: tree() });
  let draft = { id: 'organizer-draft', session_id: 'organizer-test-session', status: 'draft', last_confirmed_revision: 0, responses_json: JSON.stringify(initial), mapped_payload_json: JSON.stringify(build(initial)), idempotency_lock_token: '', idempotency_lock_key: '', idempotency_lock_expires_at: new Date(0).toISOString() };
  const versions = [];
  const base44 = { asServiceRole: { entities: {
    FormDraft: {
      get: async () => structuredClone(draft),
      updateMany: async (query, update) => { if (Object.hasOwn(query, 'idempotency_lock_token') && query.idempotency_lock_token !== (draft.idempotency_lock_token ?? null)) return { updated: 0 }; Object.assign(draft, structuredClone(update.$set || {})); return { updated: 1 }; },
      update: async (_, patch) => { Object.assign(draft, structuredClone(patch)); return structuredClone(draft); }
    },
    QuestionnaireVersion: { filter: async query => versions.filter(item => item.version_key === query.version_key), create: async value => { const row = { id: `v${versions.length}`, ...structuredClone(value) }; versions.push(row); return row; } }
  } } };
  await assert.rejects(applyDurableDraftMutation({ base44, draftId: draft.id, nextValues: { responses_json: JSON.stringify({ ...raw(), serviceOfferings: [] }) }, metadata: { mutationId: 'old-tab', clientInstanceId: 'old', clientSequence: 1, baseRevision: 0, changedKeys: ['serviceOfferings'] } }), /page organizer|structure/i);
  assert.equal(versions.length, 0);
  const next = structuredClone(initial); next.serviceOfferingsStructure.pages[0].children.reverse();
  const result = await applyDurableDraftMutation({ base44, draftId: draft.id, nextValues: { responses_json: JSON.stringify(next), mapped_payload_json: JSON.stringify(build(next)) }, metadata: { mutationId: 'new-tab', clientInstanceId: 'new', clientSequence: 1, baseRevision: 0, changedKeys: ['serviceOfferingsStructure'] } });
  assert.equal(result.accepted, true);
  assert.deepEqual(JSON.parse(draft.responses_json).serviceOfferingsStructure, next.serviceOfferingsStructure);
  assert.deepEqual(JSON.parse(draft.mapped_payload_json).userdata.service_offerings_structure, serializePageStructure(next.serviceOfferingsStructure));
  assert.deepEqual(JSON.parse(JSON.parse(versions[0].snapshot_json).responses_json).serviceOfferingsStructure, next.serviceOfferingsStructure);
});

async function backendFunctions(name, expose = []) {
  const source = await readFile(new URL(`../base44/functions/${name}/entry.ts`, import.meta.url), 'utf8');
  const executable = stripTypeScriptTypes(source.replace(/^import[\s\S]*?;\n/gm, ''));
  const captured = { fetches: 0, handler: null };
  const context = { ...contract, console, TextEncoder, Response, Request, crypto, AbortController, setTimeout, clearTimeout,
    createClientFromRequest: () => { throw new Error('No live SDK is available in these tests.'); },
    fetch: () => { captured.fetches += 1; throw new Error('No network is permitted in these tests.'); },
    Deno: { serve: handler => { captured.handler = handler; }, env: { get: () => '' } }
  };
  vm.runInNewContext(`${executable}\n;globalThis.exposed = { ${expose.join(',')} };`, context);
  return { ...context.exposed, captured };
}
test('actual webhook function rejects unsupported versions and over-limit pages before network IO', async () => {
  const { captured } = await backendFunctions('sendExpressToZapier');
  const valid = build({ ...raw(), serviceOfferingsStructure: tree() });
  const future = structuredClone(valid); future.metadata.questionnaire_payload_version = 99;
  const excessive = build({ ...raw(), serviceOfferingsStructure: { format: 'page-tree-v1', pages: Array.from({ length: 7 }, (_, index) => node(`p${index}`, `Custom ${index}`, 'custom')) } });
  for (const payload of [future, excessive]) {
    const response = await captured.handler(new Request('http://localhost/submit', { method: 'POST', body: JSON.stringify(payload) }));
    assert.equal(response.status, 400);
  }
  assert.equal(captured.fetches, 0);
});
test('actual admin backend permits all-custom pages and preserves compact structures/version', async () => {
  const { normalizePayload, mapSubmissionRecord } = await backendFunctions('submitExpressAdminIntake', ['normalizePayload', 'mapSubmissionRecord']);
  const custom = { format: 'page-tree-v1', pages: Array.from({ length: 3 }, (_, index) => node(`p${index}`, `Custom ${index}`, 'custom')) };
  const payload = build({ ...raw(), serviceOfferingsStructure: custom });
  const normalized = normalizePayload(payload);
  assert.equal(normalized.ok, true);
  assert.equal(normalized.payload.metadata.questionnaire_payload_version, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.payload.userdata.service_offerings_structure)), serializePageStructure(custom));
  const record = mapSubmissionRecord(normalized.payload);
  assert.equal(record.questionnaire_payload_version, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(record.service_offerings_structure)), serializePageStructure(custom));
});
test('both actual backend repair helpers preserve valid compact content and reject unknown formats', async () => {
  for (const name of ['repairExpressQuestionnaireIntakeSubmission', 'autoRepairRetryIntake']) {
    const { deterministicRepair, validatePayload } = await backendFunctions(name, ['deterministicRepair', 'validatePayload']);
    const payload = build({ ...raw(), serviceOfferingsStructure: tree() });
    const repaired = deterministicRepair(payload).payload;
    assert.equal(validatePayload(repaired).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(repaired.userdata.service_offerings_structure)), serializePageStructure(tree()));
    const future = structuredClone(payload); future.userdata.service_offerings_structure.format = 'future';
    assert.equal(validatePayload(deterministicRepair(future).payload).ok, false);
  }
});
