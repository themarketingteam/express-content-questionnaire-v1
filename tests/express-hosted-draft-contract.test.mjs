import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { draftAllowsAccess, withoutDraftAccessHashes } from '../base44/shared/draftAccess.ts';
import { normalizeIdentityValue, createQuestionnaireVersion } from '../base44/shared/questionnaireVersions.ts';
import { applyDurableDraftMutation } from '../base44/shared/durableDraftMutation.ts';

const sessionId = 'synthetic-session-12345678901234567890';
const accessKey = 'synthetic-access-key-12345678901234567890';
const accessKeyHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessKey))), (value) => value.toString(16).padStart(2, '0')).join('');
const otherHash = 'b'.repeat(64);
function draft(id, hash = accessKeyHash) { return { id, session_id: sessionId, draft_access_key_hash: hash, status: 'draft', responses_json: '{"differentiation":"Saved answer"}', last_confirmed_revision: 1, last_client_instance_id: 'other-tab', last_client_sequence: 1, idempotency_lock_token: '', idempotency_lock_expires_at: new Date(0).toISOString() }; }

async function harness(rows) {
  const versions = [];
  let writes = 0;
  const base44 = { asServiceRole: { entities: {
    FormDraft: {
      filter: async (query) => rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value)).map((row) => structuredClone(row)),
      get: async (id) => structuredClone(rows.find((row) => row.id === id)),
      update: async (id, values) => { writes++; const row = rows.find((item) => item.id === id); Object.assign(row, structuredClone(values)); return structuredClone(row); },
      updateMany: async (query, update) => {
        const row = rows.find((item) => Object.entries(query).every(([key, value]) => value && typeof value === 'object' && '$gt' in value ? item[key] > value.$gt : value === null ? item[key] == null : item[key] === value));
        if (!row) return { updated: 0 };
        writes++; Object.assign(row, structuredClone(update.$set)); return { updated: 1 };
      },
    },
    QuestionnaireVersion: { filter: async (query) => versions.filter((row) => row.version_key === query.version_key), create: async (value) => { const row = { id: `version-${versions.length}`, ...value }; versions.push(row); return row; } },
  } } };
  let handler;
  const source = await readFile(new URL('../base44/functions/questionnaireDraftData/entry.ts', import.meta.url), 'utf8');
  vm.runInNewContext(stripTypeScriptTypes(source.replace(/^import[\s\S]*?;\n/gm, '')), {
    Response, TextEncoder, crypto, console,
    draftAllowsAccess, withoutDraftAccessHashes, normalizeIdentityValue, createQuestionnaireVersion, applyDurableDraftMutation,
    createClientFromRequest: () => base44, Deno: { serve: (value) => { handler = value; } },
  });
  return { versions, writes: () => writes, send: async (body) => { const response = await handler(new Request('https://example.test/draft', { method: 'POST', body: JSON.stringify({ sessionId, accessKey, ...body }) })); return { status: response.status, body: await response.json() }; } };
}

test('public load and save resolve the only credential-authorized row among historical duplicates', async () => {
  const rows = [draft('authorized'), draft('unrelated', otherHash)];
  const server = await harness(rows);
  const loaded = await server.send({ action: 'load' });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.draft.id, 'authorized');
  const saved = await server.send({ action: 'save', mutationId: 'new-mutation', clientInstanceId: 'current-tab', clientSequence: 2, baseRevision: 1, draft: { responses_json: '{"differentiation":"New answer"}', client_revision: 2 } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.saved, true);
  assert.equal(saved.body.draft.id, 'authorized');
  assert.equal(JSON.parse(rows[0].responses_json).differentiation, 'New answer');
  assert.equal(JSON.parse(rows[1].responses_json).differentiation, 'Saved answer');
});

test('same-credential duplicate rows hold bootstrap/load/save without picking or mutating answers', async () => {
  const rows = [draft('first'), draft('second')];
  const server = await harness(rows);
  for (const action of ['bootstrap', 'load', 'save']) {
    const result = await server.send({ action, draft: { responses_json: '{}' } });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'AMBIGUOUS_DRAFT_SESSION');
  }
  assert.equal(server.writes(), 0);
  assert.equal(server.versions.length, 0);
});

test('stale explicit clear returns the authoritative saved draft without acknowledging clear', async () => {
  const rows = [draft('authorized')];
  const server = await harness(rows);
  const result = await server.send({ action: 'checkpoint', checkpointType: 'explicit_clear', mutationId: 'stale-clear', clientInstanceId: 'stale-tab', clientSequence: 1, baseRevision: 0, draft: { responses_json: '{}', client_revision: 1 } });
  assert.equal(result.status, 200);
  assert.equal(result.body.saved, false);
  assert.equal(result.body.stale, true);
  assert.equal(result.body.draft.responses_json, rows[0].responses_json);
  assert.equal(result.body.lastConfirmedRevision, 1);
  assert.equal(server.versions.length, 0);
});
