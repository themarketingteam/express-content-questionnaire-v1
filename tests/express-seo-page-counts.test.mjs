import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import ts from 'typescript';
import { buildExpressSeoPageCounts } from '../src/lib/expressSeoPageCounts.js';
import { countExpressPageSelections } from '../src/lib/expressPageOrganizer.js';
import { createPageStructure } from '../src/lib/pageOrganizerModel.js';
import { hydrateFormSubmissionEntity } from './helpers/base44EntityHydration.mjs';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const services = ['Managed IT', 'Microsoft 365', 'Cloud Services', 'IT Help Desk', 'Cybersecurity'];
const industries = ['Financial', 'CPA', 'Accounting'];
const rawDraft = (responses, extra = {}) => ({ responses_json: JSON.stringify(responses), ...extra });
const mappedDraft = (userdata, extra = {}) => ({ mapped_payload_json: JSON.stringify({ userdata }), ...extra });

async function loadSummary() {
  const filename = path.join(root, 'src/components/admin/ExpressSeoPageCounts.jsx');
  const output = await build({ entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const module = { exports: {} };
  vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, require: createRequire(filename), console });
  return module.exports.default;
}

test('five services and three industries display eight SEO pages with Express limits', async () => {
  const draft = rawDraft({ serviceOfferings: services, targetIndustries: industries });
  const before = structuredClone(draft);
  assert.deepEqual(buildExpressSeoPageCounts({ draft }), { services: 5, industries: 3, total: 8 });
  const Summary = await loadSummary();
  const html = renderToStaticMarkup(React.createElement(Summary, { draft }));
  for (const text of ['Services:', 'Industries:', 'Total SEO:', '5 / 6', '3 / 3', '8 / 9']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/class="brand-detail"/g) || []).length, 3);
  assert.doesNotMatch(html, /<(button|input|form)\b/);
  assert.deepEqual(draft, before, 'The display cannot write to or normalize saved answers.');
});

test('raw legacy and organized counts exactly match the form, including one unsplit Other and every parent/child', () => {
  const legacy = { serviceOfferings: services.slice(0, 2), serviceOfferingsOther: 'Support, audits and planning', targetIndustries: ['Financial / Accounting / CPA'], targetIndustriesOther: 'Private practices, hospitals' };
  assert.deepEqual(buildExpressSeoPageCounts({ draft: rawDraft(legacy) }), { services: 3, industries: 2, total: 5 });
  const tree = createPageStructure('2', ['Managed IT', 'Managed IT', 'Cloud Services'], 'Custom, comma retained', {}, services);
  tree.pages[0].children.push(tree.pages.pop());
  const responses = { serviceOfferingsStructure: tree, targetIndustries: industries };
  const before = structuredClone(responses);
  const result = buildExpressSeoPageCounts({ draft: rawDraft(responses) });
  assert.equal(result.services, countExpressPageSelections(responses, '2'));
  assert.equal(result.services, 3, 'Migration already de-duplicates selections, while parent and custom child both count.');
  assert.deepEqual(responses, before);
  assert.equal(buildExpressSeoPageCounts({ draft: rawDraft({ serviceOfferings: [...services, 'VoIP', 'Another service'], targetIndustries: industries }) }).services, 7, 'Actual over-limit values are not clamped.');
});

test('a mapped-only final receipt counts compact and Base44-padded structure nodes without splitting custom labels', () => {
  const receipt = hydrateFormSubmissionEntity({
    id: 'final-receipt', questionnaire_payload_version: 2,
    service_offerings_structure: { format: 'page-tree-v1', pages: [{ label: 'Managed IT', source: 'predefined', children: [
      { label: 'Microsoft 365', source: 'predefined' }, { label: 'Planning, audits and support', source: 'custom' },
    ] }, { label: 'Cloud Services', source: 'predefined' }, { label: 'Cybersecurity', source: 'predefined' }] },
    service_offerings: ['Stale projection'], service_offerings_other: 'Not an extra page',
    target_industries: industries, target_industries_other: '', raw_responses_json: '{}',
  });
  const before = structuredClone(receipt);
  assert.deepEqual(buildExpressSeoPageCounts({ submission: receipt }), { services: 5, industries: 3, total: 8 });
  assert.deepEqual(buildExpressSeoPageCounts({ draft: rawDraft({}, { status: 'submitted', final_submission_id: receipt.id }), submission: receipt, version: { rawAvailable: false } }), { services: 5, industries: 3, total: 8 });
  assert.deepEqual(receipt, before);
  const mapped = mappedDraft({ service_offerings: services, service_offerings_structure: null, target_industries: industries, target_industries_structure: null }, { status: 'submitted', responses_json: '{}' });
  assert.deepEqual(buildExpressSeoPageCounts({ draft: mapped }), { services: 5, industries: 3, total: 8 });
});

test('valid empty and partial raw drafts are authoritative rather than inheriting stale mapped answers', () => {
  const staleMapped = mappedDraft({ service_offerings: services, target_industries: industries });
  assert.deepEqual(buildExpressSeoPageCounts({ draft: rawDraft({}, staleMapped) }), { services: 0, industries: 0, total: 0 });
  assert.deepEqual(buildExpressSeoPageCounts({ draft: rawDraft({ serviceOfferings: services }, staleMapped) }), { services: 5, industries: 0, total: 5 });
  const emptyAdopted = { serviceOfferings: services, serviceOfferingsStructure: { format: 'page-tree-v1', pages: [] }, targetIndustries: [] };
  assert.deepEqual(buildExpressSeoPageCounts({ draft: rawDraft(emptyAdopted, staleMapped) }), { services: 0, industries: 0, total: 0 });
});

test('historical counts use the selected version and never another root or receipt', async () => {
  const selected = rawDraft({ serviceOfferings: ['Microsoft 365'], targetIndustries: ['CPA'] }, { id: 'historical', session_id: 'old-session' });
  const latestReceipt = { id: 'latest', service_offerings: services, target_industries: industries };
  assert.deepEqual(buildExpressSeoPageCounts({ draft: selected, submission: latestReceipt }), { services: 1, industries: 1, total: 2 });
  assert.deepEqual(buildExpressSeoPageCounts({ draft: { id: 'missing-history' }, submission: latestReceipt }), { services: null, industries: null, total: null });
  const noRawVersion = mappedDraft({ service_offerings: services.slice(0, 2), target_industries: ['CPA'] }, { responses_json: '{}' });
  assert.deepEqual(buildExpressSeoPageCounts({ draft: noRawVersion, version: { rawAvailable: false } }), { services: 2, industries: 1, total: 3 });
  const source = await fs.readFile(path.join(root, 'src/pages/FormDraftRecovery.jsx'), 'utf8');
  const ast = ts.createSourceFile('FormDraftRecovery.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  let summary;
  const visit = (node) => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'ExpressSeoPageCounts') summary = node; ts.forEachChild(node, visit); };
  visit(ast);
  const bound = (name) => summary.attributes.properties.find((attribute) => attribute.name?.getText(ast) === name)?.initializer.expression.getText(ast);
  assert.equal(bound('draft'), 'draft');
  assert.equal(bound('submission'), 'linkedSubmission');
  assert.equal(bound('version'), 'selectedVersion');
});

test('missing or unreadable answers show unknown counts; malformed adoption never falls back to flat projections', async () => {
  const unknown = { services: null, industries: null, total: null };
  assert.deepEqual(buildExpressSeoPageCounts(), unknown);
  const emptyReceipt = hydrateFormSubmissionEntity({ id: 'receipt-without-captured-answers' });
  assert.deepEqual(emptyReceipt.service_offerings, []);
  assert.equal(emptyReceipt.service_offerings_other, null);
  assert.deepEqual(buildExpressSeoPageCounts({ submission: emptyReceipt }), unknown, 'Schema padding cannot invent known zero counts.');
  assert.deepEqual(buildExpressSeoPageCounts({ submission: { ...emptyReceipt, service_offerings_other: '', target_industries_other: '' } }), { services: 0, industries: 0, total: 0 });
  assert.deepEqual(buildExpressSeoPageCounts({ draft: { responses_json: '{broken' } }), unknown);
  assert.deepEqual(buildExpressSeoPageCounts({ draft: { status: 'submitted', responses_json: '{}' } }), unknown);
  for (const value of [null, 'Broken list', { unsupported: true }]) {
    assert.deepEqual(buildExpressSeoPageCounts({ draft: rawDraft({ serviceOfferings: value, targetIndustries: [] }) }), { services: null, industries: 0, total: null });
  }
  const invalid = rawDraft({ serviceOfferings: services, serviceOfferingsStructure: null, targetIndustries: ['CPA'] });
  assert.deepEqual(buildExpressSeoPageCounts({ draft: invalid }), { services: null, industries: 1, total: null });
  const Summary = await loadSummary();
  const html = renderToStaticMarkup(React.createElement(Summary, { draft: invalid }));
  assert.ok(html.includes('— / 6'));
  assert.ok(html.includes('1 / 3'));
  assert.ok(html.includes('— / 9'));
});
