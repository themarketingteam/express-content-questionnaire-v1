import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuestionnairePDF, formatAnswer } from '../src/components/questionnaire/PDFGenerator.js';
import { formatOrganizedAnswer, normalizeExpressDisplayFormData } from '../src/lib/pageOrganizerDisplay.js';
import { createPdfPayloadFingerprint, prepareDraftPdfInput } from '../src/lib/adminDraftPdf.js';
import { buildExpressDraftSubmissionPreview } from '../src/lib/expressDraftSubmissionPreview.js';
import { normalizeExpressSubmitIntakePayload, repairExpressAdminIntakePayload } from '../src/lib/adminExpressIntakePayload.js';

const compact = () => ({ format: 'page-tree-v1', pages: [
  { label: 'Cloud Services', source: 'predefined', children: [
    { label: 'Microsoft 365', source: 'predefined' },
    { label: 'Compliance Consulting (HIPAA, SOC 2)', source: 'custom' },
  ] },
  { label: 'Managed IT', source: 'predefined' },
] });
const rich = () => ({ format: 'page-tree-v1', pages: compact().pages.map((page, index) => ({
  ...page, id: `page-${index}`, catalogId: `q2:option:${encodeURIComponent(page.label)}`,
  children: (page.children || []).map((child, childIndex) => ({ ...child, id: `child-${childIndex}`, catalogId: child.source === 'custom' ? null : `q2:option:${encodeURIComponent(child.label)}`, children: [] })),
})) });
const payload = () => ({
  metadata: { business_name: 'Local Example', businessDomain: 'example.test', questionnaire_payload_version: 2, submission_datetime: '2026-11-13T12:00:00Z' },
  userdata: {
    service_offerings: ['Cloud Services', 'Microsoft 365', 'Managed IT'], service_offerings_other: 'Compliance Consulting (HIPAA, SOC 2)', service_offerings_structure: compact(),
    target_industries: ['Healthcare / Medical'], target_industries_other: '', differentiation: 'Responsive support.', geographic_areas: 'Chicago, IL', ideal_client: 'A growing local firm.',
  },
});
const draft = (mapped) => ({ id: 'draft-local', mapped_payload_json: JSON.stringify(mapped), last_saved_at: '2026-11-13T12:00:00Z' });

test('rich editor trees and compact saved trees display identical priorities without duplicate custom Other', () => {
  const expected = '1. Cloud Services\n    1. Microsoft 365\n    2. Compliance Consulting (HIPAA, SOC 2)\n2. Managed IT';
  for (const structure of [compact(), rich()]) {
    const data = { serviceOfferings: ['Stale value'], serviceOfferingsOther: 'Compliance Consulting (HIPAA, SOC 2)', serviceOfferingsStructure: structure };
    assert.equal(formatOrganizedAnswer(structure), expected);
    assert.equal(formatAnswer('serviceOfferings', data, 'serviceOfferingsOther'), expected);
    const normalized = normalizeExpressDisplayFormData(data);
    assert.deepEqual(normalized.serviceOfferingsStructure, compact());
    assert.ok(!JSON.stringify(normalized.serviceOfferingsStructure).includes('catalogId'));
    assert.equal((formatAnswer('serviceOfferings', data, 'serviceOfferingsOther').match(/HIPAA, SOC 2/g) || []).length, 1);
  }
});

test('PDF layout renders both organized questions in the saved hierarchy and grows for long lists', () => {
  const many = { format: 'page-tree-v1', pages: [{ label: 'Services', source: 'custom', children: Array.from({ length: 15 }, (_, index) => ({ label: `Service ${index + 1}`, source: 'custom' })) }] };
  const industries = { format: 'page-tree-v1', pages: [{ label: 'Professional Services', source: 'predefined', children: [{ label: 'Legal Firms', source: 'predefined' }] }] };
  const { layout, pdf } = createQuestionnairePDF({ serviceOfferingsStructure: many, targetIndustriesStructure: industries }, 'Local Example', 'example.test', { submittedAt: new Date('2026-11-13T12:00:00Z') });
  const servicesRow = layout.questionRows.find((row) => row.id === 2);
  assert.ok(servicesRow.height > 103.95);
  assert.ok(servicesRow.answer.includes('    15. Service 15'));
  assert.ok(servicesRow.answerLines.some((line) => line.startsWith('    1. Service 1')));
  assert.equal(layout.questionRows.find((row) => row.id === 8).answer, '1. Professional Services\n    1. Legal Firms');
  assert.equal(Buffer.from(pdf.output('arraybuffer')).subarray(0, 4).toString(), '%PDF');
});

test('explicit empty and invalid structures never display stale flat fallback answers', () => {
  assert.equal(formatAnswer('serviceOfferings', { serviceOfferings: ['Stale'], serviceOfferingsStructure: { format: 'page-tree-v1', pages: [] } }), 'Not answered');
  for (const structure of [null, { format: 'future-format', pages: [] }]) {
    assert.match(formatAnswer('serviceOfferings', { serviceOfferings: ['Stale'], serviceOfferingsStructure: structure }), /needs review/);
  }
  assert.equal(formatAnswer('targetIndustries', { targetIndustries: ['Healthcare / Medical'], targetIndustriesOther: 'Regional practices' }, 'targetIndustriesOther'), 'Healthcare / Medical, Other: Regional practices');
});

test('mapped draft preview, admin repair and intake normalization preserve compact hierarchy and version', () => {
  const source = payload();
  const original = structuredClone(source);
  const preview = buildExpressDraftSubmissionPreview(draft(source));
  assert.equal(preview.ok, true);
  for (const candidate of [preview.payload, repairExpressAdminIntakePayload(source).payload, normalizeExpressSubmitIntakePayload(source).payload]) {
    assert.equal(candidate.metadata.questionnaire_payload_version, 2);
    assert.deepEqual(candidate.userdata.service_offerings_structure, compact());
    assert.deepEqual(candidate.userdata.service_offerings, source.userdata.service_offerings);
    assert.equal(candidate.userdata.service_offerings_other, source.userdata.service_offerings_other);
  }
  assert.deepEqual(source, original);
});

test('raw draft reconstruction keeps rich IDs in the source while its preview and PDF use compact hierarchy', () => {
  const raw = { serviceOfferings: ['Stale value'], serviceOfferingsOther: 'Stale Other', serviceOfferingsStructure: rich(), targetIndustries: ['Healthcare / Medical'] };
  const original = structuredClone(raw);
  const record = { id: 'draft-raw-local', business_name: 'Local Example', domain: 'example.test', responses_json: JSON.stringify(raw), last_saved_at: '2026-11-13T12:00:00Z' };
  const preview = buildExpressDraftSubmissionPreview(record);
  assert.equal(preview.ok, true);
  assert.equal(preview.source, 'reconstructed_from_responses_json');
  assert.deepEqual(preview.payload.userdata.service_offerings_structure, compact());
  assert.equal(preview.payload.metadata.questionnaire_payload_version, 2);
  assert.deepEqual(prepareDraftPdfInput({ draft: record }).formData.serviceOfferingsStructure, compact());
  assert.deepEqual(raw, original);
  assert.ok(raw.serviceOfferingsStructure.pages[0].id);
});

test('admin normalization accepts all-custom organized services and rejects invalid versions without downgrading', () => {
  const custom = payload();
  custom.userdata.service_offerings = [];
  custom.userdata.service_offerings_other = 'Specialty support';
  custom.userdata.service_offerings_structure = { format: 'page-tree-v1', pages: [{ label: 'Specialty support', source: 'custom' }] };
  assert.equal(normalizeExpressSubmitIntakePayload(custom).ok, true);
  const invalid = payload();
  invalid.userdata.service_offerings_structure.format = 'future-format';
  const preview = buildExpressDraftSubmissionPreview(draft(invalid));
  assert.equal(preview.ok, false);
  assert.deepEqual(preview.payload.userdata.service_offerings_structure, invalid.userdata.service_offerings_structure);
  assert.equal(repairExpressAdminIntakePayload(invalid).ok, false);
  assert.equal(normalizeExpressSubmitIntakePayload(invalid).ok, false);
});

test('admin PDFs preserve compact pages from drafts and flattened final submissions without inventing editor IDs', async () => {
  const source = payload();
  const fromDraft = prepareDraftPdfInput({ draft: draft(source) });
  const fromSubmission = prepareDraftPdfInput({ draft: { ...draft(source), last_saved_at: '2026-11-12T12:00:00Z' }, submission: { id: 'local-final', business_name: 'Local Example', business_domain: 'example.test', submission_datetime: '2026-11-13T12:00:00Z', questionnaire_payload_version: 2, ...source.userdata } });
  assert.equal(fromSubmission.source, 'form_submission');
  for (const input of [fromDraft, fromSubmission]) {
    assert.deepEqual(input.formData.serviceOfferingsStructure, compact());
    assert.equal(input.payloadSnapshot.metadata.questionnaire_payload_version, 2);
    assert.equal(formatAnswer('serviceOfferings', input.formData), formatOrganizedAnswer(compact()));
  }
  const originalHash = await createPdfPayloadFingerprint(fromDraft);
  assert.equal(await createPdfPayloadFingerprint({ ...fromDraft, formData: { ...fromDraft.formData, serviceOfferingsStructure: rich() } }), originalHash);
  const reordered = compact(); reordered.pages.reverse();
  assert.notEqual(await createPdfPayloadFingerprint({ ...fromDraft, formData: { ...fromDraft.formData, serviceOfferingsStructure: reordered } }), originalHash);
});
