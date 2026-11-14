import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertProductionModules, inspectProductionBuild, validateProductionBuild } from '../scripts/production-build-guard.mjs';

const expected = { base44AppId: 'expected-app' };
const head = 'release-commit';
const fixture = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'questionnaire-build-proof-'));
  fs.mkdirSync(path.join(directory, 'dist'));
  fs.writeFileSync(path.join(directory, 'dist/index.html'), '<main>Production questionnaire</main>');
  const digest = createHash('sha256').update(fs.readFileSync(path.join(directory, 'dist/index.html'))).digest('hex');
  const proof = { target: 'production', localPreview: false, appId: expected.base44AppId, gitHead: head, moduleCount: 42, files: { 'index.html': digest } };
  fs.writeFileSync(path.join(directory, 'dist/production-build.json'), JSON.stringify(proof));
  return { directory, proof, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
};

test('production deployment rejects local adapters anywhere in the real module graph', () => {
  assert.doesNotThrow(() => assertProductionModules(['/app/src/main.jsx', '/app/src/api/base44Client.js']));
  for (const id of ['/app/src/local/main.jsx', '/app/src/local/base44Client.js', '/app/scripts/local-preview-api.mjs', 'C:\\app\\src\\local\\main.jsx']) {
    assert.throws(() => assertProductionModules([id]), /local testing module/);
  }
});

test('verified production assets cannot be swapped, removed, or reused for another app or commit', () => {
  const { directory, proof, close } = fixture();
  try {
    assert.deepEqual(inspectProductionBuild(directory, expected, head), []);
    assert.match(validateProductionBuild(proof, expected, 'older-commit').join(), /current release commit/);
    assert.match(validateProductionBuild(proof, { base44AppId: 'another-app' }, head).join(), /app ID/);
    assert.match(validateProductionBuild({ ...proof, localPreview: true }, expected, head).join(), /production build/);
    fs.writeFileSync(path.join(directory, 'dist/index.html'), '<main>Local preview</main>');
    assert.match(inspectProductionBuild(directory, expected, head).join(), /asset changed/);
    fs.unlinkSync(path.join(directory, 'dist/index.html'));
    assert.match(inspectProductionBuild(directory, expected, head).join(), /asset is missing/);
    fs.unlinkSync(path.join(directory, 'dist/production-build.json'));
    assert.match(inspectProductionBuild(directory, expected, head).join(), /Missing production build proof/);
  } finally { close(); }
});

test('hosted builds use the production config while developer previews remain isolated', () => {
  const root = process.cwd();
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  const config = JSON.parse(fs.readFileSync(path.join(root, 'base44/config.jsonc'), 'utf8'));
  assert.equal(config.site.buildCommand, 'npm run build:production');
  assert.equal(config.site.outputDirectory, './dist');
  assert.equal(scripts['build:production'], 'vite build --config vite.config.js');
  assert.equal(scripts.build, 'npm run build:production');
  assert.match(scripts['build:local'], /vite.local.config.js/);
  assert.match(scripts['dev:local'], /vite.local.config.js/);
  assert.match(scripts['deploy:base44:site'], /verify-deploy-source/);
});
