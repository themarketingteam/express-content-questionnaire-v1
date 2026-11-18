import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { build } from 'esbuild';
import { appendDraftRecoveryAccessHash, draftAllowsAccess, withoutDraftAccessHashes } from '../base44/shared/draftAccess.ts';
import { withEntityLease } from '../base44/shared/entityLease.ts';
import { buildExpressSubmittedReview } from '../src/lib/expressSubmittedReview.js';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const read = (name) => fs.readFile(path.join(root, name), 'utf8');
const sha = async (value) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');

async function loadJsx(relativePath) {
  const filename = path.join(root, relativePath);
  const output = await build({ entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const module = { exports: {} };
  vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, require: createRequire(filename), console, process, setTimeout, clearTimeout });
  return module.exports.default;
}

test('submitted review shows exact flat/custom answers and ordered page hierarchy as accessible copyable text', async () => {
  const formData = {
    itCompanyType: ['MSP'], itCompanyTypeOther: 'A custom specialty',
    serviceOfferings: ['Stale projection'], serviceOfferingsOther: 'Stale custom projection',
    serviceOfferingsStructure: { pages: [{ id: 'p1', label: 'Managed IT', children: [{ id: 'c1', label: 'Priority child first' }, { id: 'c2', label: 'Priority child second' }] }, { id: 'p2', label: 'Standalone service', children: [] }] },
    targetIndustries: ['Financial / Accounting / CPA'], targetIndustriesOther: 'Custom legacy industry, comma intact',
    differentiation: 'Line one\nLine two', geographicAreas: 'Chicago and surrounding areas', clientSize: '10–500 employees',
  };
  const before = structuredClone(formData);
  const Review = await loadJsx('src/components/questionnaire/SubmittedQuestionnaireReview.jsx');
  const html = renderToStaticMarkup(React.createElement(Review, { formData, businessName: 'Submitted business', domain: 'submitted.example', onCopyLink() {}, onDownloadPdf() {} }));
  for (const value of ['Submitted business', 'submitted.example', 'Managed IT', 'Standalone service', 'Priority child first', 'Financial / Accounting / CPA', 'Custom legacy industry, comma intact', 'Line one\nLine two', 'Chicago and surrounding areas', '10–500 employees']) assert.ok(html.includes(value), value);
  assert.ok(html.indexOf('Priority child first') < html.indexOf('Priority child second'));
  assert.ok(html.indexOf('Priority child second') < html.indexOf('Standalone service'));
  assert.equal((html.match(/<details open=""/g) || []).length, 12);
  assert.doesNotMatch(html, /<(input|textarea|select|form)\b|\binert\b|draggable|Start a revision|Stale projection|Stale custom projection/);
  assert.match(html, /Copy questionnaire link/);
  assert.match(html, /Download responses \(PDF\)/);
  assert.deepEqual(formData, before);
  assert.equal(buildExpressSubmittedReview(formData)[7].other, formData.targetIndustriesOther);
});

test('submitted recovery selection cannot disable the original questionnaire copy-link action', async () => {
  const source = await read('src/pages/FormDraftRecovery.jsx');
  const ast = ts.createSourceFile('FormDraftRecovery.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  let copyButton;
  const visit = (node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'Button' && node.children.some((child) => ts.isJsxText(child) && child.text.includes('Copy Draft Link'))) copyButton = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(copyButton);
  const disabled = copyButton.openingElement.attributes.properties.find((attribute) => attribute.name?.getText(ast) === 'disabled');
  const evaluate = new Function('isHistoricalVersion', 'isLoading', 'draftRecoveryLinkLoading', `return (${disabled.initializer.expression.getText(ast)});`);
  assert.equal(evaluate(true, true, false), false, 'Selecting submitted history or running an unrelated action cannot require an editable copy.');
  assert.equal(evaluate(true, false, true), true, 'An in-flight link request alone may prevent duplicate clicks.');
  assert.match(source, /action: "createDraftRecoveryLink",\s*draftId: draftSummary.id/);
  const linkMarkup = source.slice(source.indexOf('<div className="brand-draft-link"'), source.indexOf('          {detailLoading ?'));
  assert.ok(source.indexOf('<div className="brand-draft-link"') < source.indexOf('          {detailLoading ?'), 'Link panel is accessible even when historical details fail to load.');
  assert.doesNotMatch(linkMarkup, /isHistoricalVersion|create an editable/i);
  assert.match(linkMarkup, /original questionnaire/);
});

test('completion screen provides a direct review handoff and copies the existing link', async () => {
  const source = await read('src/pages/Questionnaire.jsx');
  const ast = ts.createSourceFile('Questionnaire.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  let success;
  let thankYou;
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'onFinalSubmitSuccess') success = node.initializer;
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'ThankYouModal') thankYou = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(success && thankYou);
  for (const receivedViaIntake of [false, true]) {
    const calls = [];
    const getCallback = new Function('hasFinalSubmittedRef', 'draftSaveTimeoutRef', 'clearTimeout', 'setLastSubmitContext', 'setIsRetryingSubmit', 'setSubmittedData', 'setShowConfirmModal', 'recognizeCompletedDraft', 'remoteDraftRef', 'draftRecordIdRef', 'questionnaireSessionId', 'rawFormData', 'toast', 'setShowThankYouModal', 'businessName', 'domain', 'setReceivedForProcessing', `return (${success.getText(ast)});`);
    const snapshot = { differentiation: 'Exact submitted value', targetIndustries: ['Financial / Accounting / CPA'] };
    const callback = getCallback({ current: false }, { current: null }, clearTimeout, () => {}, () => {}, () => {}, () => {}, (draft) => calls.push(['readonly', draft]), { current: {} }, { current: 'source-draft' }, 'source-session', snapshot, { success() {} }, (open) => calls.push(['thankyou', open]), 'Business', 'example.test', () => {});
    callback({ receivedViaIntake, submissionId: receivedViaIntake ? null : 'receipt-id' });
    if (receivedViaIntake) assert.deepEqual(calls, [['thankyou', true]], 'Intake receipt must not claim finalized answers.');
    else {
      assert.equal(calls[0][0], 'readonly');
      assert.deepEqual(JSON.parse(calls[0][1].responses_json), snapshot);
      assert.deepEqual(calls[1], ['thankyou', true]);
    }
  }
  assert.ok(thankYou.attributes.properties.some((attribute) => attribute.name?.getText(ast) === 'onViewAnswers'));
  assert.ok(thankYou.attributes.properties.some((attribute) => attribute.name?.getText(ast) === 'onCopyLink'));
  assert.doesNotMatch(source, /Start a revision|startCompletedRevision|includeCompletedBrowserEdits/);
});

test('team can generate concurrent submitted questionnaire links while every older link remains authorized', async () => {
  const oldHashes = await Promise.all(Array.from({ length: 30 }, (_, index) => sha(`old-client-key-${index}`)));
  const row = { id: 'submitted-root', session_id: 'submitted_session_12345678901234567890', status: 'submitted', final_submission_id: 'receipt', last_confirmed_revision: 7, responses_json: '{"differentiation":"Original submitted answer"}', mapped_payload_json: '{"userdata":{}}', draft_access_key_hash: await sha('original-primary-key'), draft_recovery_access_key_hashes: oldHashes };
  const protectedAnswers = JSON.stringify([row.status, row.final_submission_id, row.last_confirmed_revision, row.responses_json, row.mapped_payload_json]);
  const entity = {
    get: async () => structuredClone(row),
    updateMany: async (query, change) => {
      const matches = Object.entries(query).every(([key, value]) => value && typeof value === 'object' && '$gt' in value ? row[key] > value.$gt : value === null ? row[key] == null : row[key] === value);
      if (!matches) return { updated: 0 };
      Object.assign(row, structuredClone(change.$set));
      return { updated: 1 };
    },
  };
  let handler;
  const source = await read('base44/functions/draftRecoveryData/entry.ts');
  vm.runInNewContext(stripTypeScriptTypes(source.replace(/^import[\s\S]*?;\n/gm, '')), {
    Response, TextEncoder, crypto, console, btoa,
    appendDraftRecoveryAccessHash, withoutDraftAccessHashes, withEntityLease,
    createClientFromRequest: () => ({ asServiceRole: { entities: { FormDraft: entity } } }),
    secrets: { get: () => 'synthetic-team-secret' },
    authorizeRecoveryRequest: async ({ recoveryGrant }) => ({ authorized: recoveryGrant === 'team-grant', mode: 'recovery_grant', error: 'Team authorization required' }),
    safeRecoveryLog() {}, Deno: { serve: (value) => { handler = value; } },
  });
  const send = async (grant = 'team-grant') => {
    const response = await handler(new Request('https://example.test/recovery', { method: 'POST', body: JSON.stringify({ action: 'createDraftRecoveryLink', draftId: row.id, recoveryGrant: grant }) }));
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await send('client-link-is-not-a-team-grant')).status, 403);
  const generated = await Promise.all([send(), send(), send(), send()]);
  for (const result of generated) {
    assert.equal(result.status, 200);
    assert.equal(result.body.sessionId, row.session_id);
    assert.equal(draftAllowsAccess(row, await sha(result.body.accessKey)), true);
  }
  for (const oldHash of oldHashes) assert.equal(draftAllowsAccess(row, oldHash), true);
  assert.equal(draftAllowsAccess(row, await sha('original-primary-key')), true);
  assert.equal(row.draft_recovery_access_key_hashes.length, 34);
  assert.equal(JSON.stringify([row.status, row.final_submission_id, row.last_confirmed_revision, row.responses_json, row.mapped_payload_json]), protectedAnswers);
});
