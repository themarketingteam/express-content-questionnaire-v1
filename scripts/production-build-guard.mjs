import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

export function assertProductionModules(moduleIds) {
  for (const moduleId of moduleIds) {
    const normalized = moduleId.replaceAll('\\', '/');
    if (/\/src\/local\/|\/scripts\/local-preview-|\/vite\.local\.config\./.test(normalized)) {
      throw new Error(`Production build contains a local testing module: ${moduleId}`);
    }
  }
}

export function productionBuildGuard({ appId }) {
  let root;
  let inspectedModules = [];
  return {
    name: 'questionnaire-production-build-guard',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
      if (path.resolve(root, config.build.outDir) !== path.join(root, 'dist')) {
        throw new Error('Production output must be dist; local previews use dist-local.');
      }
      if (config.define['import.meta.env.VITE_LOCAL_PREVIEW'] !== 'false') {
        throw new Error('Production build must explicitly disable VITE_LOCAL_PREVIEW.');
      }
    },
    generateBundle(_options, bundle) {
      const moduleIds = [...this.getModuleIds()];
      assertProductionModules(moduleIds);
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset' || /src\/local|Local testing workspace/.test(String(html.source))) {
        throw new Error('Production HTML entry is missing or points at the local preview.');
      }
      inspectedModules = moduleIds;
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      handler(_options, bundle) {
        // Hash final on-disk bytes after Vite's output hooks finish rewriting chunks.
        const files = Object.fromEntries(Object.keys(bundle).map(name => [name,
          createHash('sha256').update(readFileSync(path.join(root, 'dist', name))).digest('hex'),
        ]));
        const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
        const runtimePackages = [...new Set(inspectedModules.map(id => id.replaceAll('\\', '/').match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean))].sort();
        writeFileSync(path.join(root, 'dist/production-build.json'), JSON.stringify({
          target: 'production', appId, gitHead, localPreview: false, moduleCount: inspectedModules.length, runtimePackages, files,
        }, null, 2));
      },
    },
  };
}

export function validateProductionBuild(proof, expected, head) {
  const errors = [];
  if (proof?.target !== 'production' || proof?.localPreview !== false) errors.push('A verified production build is required.');
  if (proof?.appId !== expected.base44AppId) errors.push('Production build app ID does not match the linked app.');
  if (proof?.gitHead !== head) errors.push('Rebuild production assets from the current release commit before deployment.');
  if (!proof?.files?.['index.html'] || !Number.isInteger(proof?.moduleCount) || proof.moduleCount < 1) errors.push('Production module and asset proof is incomplete.');
  return errors;
}

export function inspectProductionBuild(repoRoot, expected, head) {
  let proof;
  try { proof = JSON.parse(readFileSync(path.join(repoRoot, 'dist/production-build.json'), 'utf8')); }
  catch { return ['Missing production build proof. Run npm run build:production before deployment.']; }
  const errors = validateProductionBuild(proof, expected, head);
  const output = path.join(repoRoot, 'dist');
  for (const [name, digest] of Object.entries(proof.files || {})) {
    const absolute = path.resolve(output, name);
    if (!absolute.startsWith(output + path.sep)) { errors.push(`Invalid production asset path: ${name}`); continue; }
    try {
      const actual = createHash('sha256').update(readFileSync(absolute)).digest('hex');
      if (actual !== digest) errors.push(`Production asset changed after its verified build: ${name}`);
    } catch { errors.push(`Production asset is missing: ${name}`); }
  }
  return errors;
}
