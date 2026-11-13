import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createLocalApi } from '../scripts/local-preview-api.mjs';
import { createLatestDraftSaveQueue } from '../src/lib/questionnaireDraftApi.js';
import { createDraftMutationEnvelope, reserveClientSequence, synchronizeClientSequence, retryDraftOperation } from '../src/lib/draftSaveReliability.js';
import { buildExpressSubmissionPayload } from '../src/lib/expressQuestionnairePayload.js';
import { createPageStructure, projectPageStructure } from '../src/lib/pageOrganizerModel.js';
import { EXPRESS_SERVICE_OPTIONS } from '../src/components/questionnaire/pageOrganizerCatalog.js';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const source = fs.readFileSync(path.join(root, 'src/pages/Questionnaire.jsx'), 'utf8');
const ast = ts.createSourceFile('Questionnaire.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const isReservation = (node) => ts.isCallExpression(node)
  && ts.isIdentifier(node.expression) && node.expression.text === 'reserveClientSequence'
  && node.arguments[0]?.getText(ast) === 'draftRevisionRef';

function reservationBinding(name, start) {
  for (let scope = start.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement) || statement.pos >= start.pos) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer;
      }
    }
  }
  return undefined;
}

test('every direct draft snapshot save supplies a reserved client sequence, including pre-submit', () => {
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'saveDraftSnapshot') calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(calls.length >= 4, 'Cover saveNow, debounce, hydration, and pre-submit checkpoint.');
  for (const call of calls) {
    const line = ast.getLineAndCharacterOfPosition(call.getStart(ast)).line + 1;
    const options = call.arguments[0];
    assert.ok(options && ts.isObjectLiteralExpression(options), `Review draft save options at line ${line}.`);
    const property = options.properties.find((item) => item.name?.getText(ast) === 'clientRevision');
    assert.ok(property, `Line ${line} omits clientRevision and would submit default sequence 0.`);
    const expression = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
    const reservation = expression && ts.isIdentifier(expression) ? reservationBinding(expression.text, call) : expression;
    assert.ok(reservation && isReservation(reservation), `Line ${line} must reserve its client sequence before persistence.`);
  }
});

test('an immediate pending draft is enveloped before pagehide can flush it', () => {
  let found = false;
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === 'latestPendingDraftRef.current' && node.right.getText(ast).includes('buildImmediateDraftRecord(')) {
      found = true;
      assert.ok(ts.isCallExpression(node.right) && node.right.expression.getText(ast) === 'createDraftMutationEnvelope', 'A pending debounce body needs its mutation ID and sequence before its timer runs.');
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(found);
});

test('pre-submit checkpoint and saveNow coalesce safely behind an in-flight autosave', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'express-submit-wiring-'));
  try {
    const api = createLocalApi(root, { dataDirectory: directory });
    const identity = { sessionId: 'local_wiring_session_12345678901234567890', accessKey: 'local_wiring_access_key_123456789012345678901234567890' };
    const boot = api.invoke('questionnaireDraftData', { ...identity, action: 'bootstrap' });
    const legacy = JSON.parse(boot.draft.responses_json);
    const structure = createPageStructure('2', legacy.serviceOfferings, '', {}, EXPRESS_SERVICE_OPTIONS);
    const projection = projectPageStructure(structure);
    const organized = { ...legacy, serviceOfferingsStructure: structure, serviceOfferings: projection.selections, serviceOfferingsOther: projection.otherValues.join(', ') };
    let remote = boot.draft;
    const counter = { current: 24 };
    synchronizeClientSequence(counter, boot.lastConfirmedRevision, remote.client_revision);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let first = true;
    let retries = 0;
    const sent = [];
    const queue = createLatestDraftSaveQueue((draft) => retryDraftOperation(async () => {
      if (first) { first = false; await gate; }
      sent.push(draft.client_sequence);
      const result = api.invoke('questionnaireDraftData', { ...identity, action: 'save', draft: { ...draft, base_revision: remote.last_confirmed_revision } });
      remote = result.draft;
      return result;
    }, { onRetry: () => { retries += 1; }, sleep: async () => assert.fail('Healthy save ordering must not retry') }));
    const prepare = (responses, status = 'draft') => createDraftMutationEnvelope({ responses_json: JSON.stringify(responses), client_revision: reserveClientSequence(counter), status }, { clientInstanceId: 'submission-wiring-client', baseRevision: remote.last_confirmed_revision, previousDraft: remote });
    const autosave = queue(prepare({ ...organized, differentiation: 'An earlier captured answer.' }));
    const finalResponses = { ...organized, differentiation: 'The exact answer reviewed in the confirmation modal.' };
    const checkpoint = queue(prepare(finalResponses));
    const saveNow = queue(prepare(finalResponses, 'submit_attempted'));
    release();
    const [, checkpointResult, saveNowResult] = await Promise.all([autosave, checkpoint, saveNow]);
    assert.deepEqual(sent, [25, 27]);
    assert.equal(checkpointResult.lastConfirmedRevision, saveNowResult.lastConfirmedRevision);
    assert.equal(retries, 0);
    assert.equal(remote.last_confirmed_revision, 2);
    assert.equal(remote.last_client_sequence, 27);
    assert.deepEqual(JSON.parse(remote.responses_json), finalResponses);
    const payload = buildExpressSubmissionPayload({ formData: finalResponses, businessName: boot.draft.business_name, domain: boot.draft.domain, sessionId: identity.sessionId, submitAttemptId: 'local-wiring-submit' });
    assert.equal(api.invoke('submitExpressQuestionnaireFallback', { questionnaireSessionId: identity.sessionId, rawResponses: finalResponses, transformedPayload: payload }).submissionCreated, true);
    assert.deepEqual(api.state.submissions[0].raw_responses.serviceOfferingsStructure, structure);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
