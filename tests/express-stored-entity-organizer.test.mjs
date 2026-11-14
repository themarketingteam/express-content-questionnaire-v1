import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeStoredPageStructure, normalizeStoredOrganizedRecord, serializePageStructure, validateMappedPageStructure, validatePageStructure } from '../base44/shared/pageOrganizerContract.js';
import { payloadFromStoredExpressSubmission } from '../base44/shared/expressSubmissionIntegrity.js';
import { hydrateFormSubmissionEntity } from './helpers/base44EntityHydration.mjs';

const compact = () => ({ format: 'page-tree-v1', pages: [{ label: 'Managed IT', source: 'custom', children: [{ label: 'Help Desk', source: 'custom' }, { label: 'Security', source: 'custom' }] }] });
const record = () => ({ questionnaire_payload_version: 2, service_offerings_structure: compact(), service_offerings: [], service_offerings_other: 'Managed IT, Help Desk, Security' });

test('actual entity-schema padding normalizes to the original compact tree without changing raw or wire contracts', () => {
  const original = record();
  const hydrated = hydrateFormSubmissionEntity(original);
  assert.deepEqual(hydrated.service_offerings_structure.pages[0].children[0], { id: null, label: 'Help Desk', source: 'custom', catalogId: null, children: [] });
  assert.equal(validateMappedPageStructure(hydrated.service_offerings_structure).ok, false);
  assert.equal(validatePageStructure(hydrated.service_offerings_structure).ok, false);
  assert.throws(() => serializePageStructure(hydrated.service_offerings_structure));
  assert.deepEqual(serializeStoredPageStructure(hydrated.service_offerings_structure), compact());
  const normalized = normalizeStoredOrganizedRecord(hydrated);
  assert.deepEqual(normalized.service_offerings_structure, compact());
  assert.equal(Object.hasOwn(normalized, 'target_industries_structure'), false);
  assert.deepEqual(payloadFromStoredExpressSubmission(hydrated).userdata.service_offerings_structure, compact());
  assert.equal(hydrated.service_offerings_structure.pages[0].id, null);
});

test('stored DTO tolerance cannot conceal mixed identity, unknown fields, bad source or grandchildren', () => {
  for (const mutate of [
    (tree) => { tree.pages[0].id = 'half-stripped-id'; },
    (tree) => { tree.pages[0].catalogId = 'half-stripped-catalog'; },
    (tree) => { tree.pages[0].unexpected = 'discard me'; },
    (tree) => { tree.pages[0].source = 'folder'; },
    (tree) => { tree.pages[0].children[0].children = [{ label: 'Grandchild', source: 'custom' }]; },
  ]) {
    const tree = hydrateFormSubmissionEntity(record()).service_offerings_structure;
    mutate(tree);
    assert.throws(() => serializeStoredPageStructure(tree));
  }
});

test('platform nulls on unadopted legacy rows are absence, never inferred version-two adoption', () => {
  const legacy = hydrateFormSubmissionEntity({ service_offerings: ['Managed IT'], service_offerings_other: '' });
  const normalized = normalizeStoredOrganizedRecord(legacy);
  assert.equal(Object.hasOwn(normalized, 'questionnaire_payload_version'), false);
  assert.equal(Object.hasOwn(normalized, 'service_offerings_structure'), false);
  assert.throws(() => normalizeStoredOrganizedRecord({ ...legacy, questionnaire_payload_version: 2 }));
  assert.throws(() => normalizeStoredOrganizedRecord({ ...record(), questionnaire_payload_version: null }));
});
