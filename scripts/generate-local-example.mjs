// Generates a synthetic wire-payload example through the real mapper and repair
// functions. No SDK client is loaded and network access is disabled.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { getInitialExpressFormData, buildExpressSubmissionPayload } from '../src/lib/expressQuestionnairePayload.js';
import { repairExpressSubmissionPayload, validateExpressSubmissionPayload } from '../src/lib/expressPayloadRepair.js';
import { normalizeExpressPageOrganizerFormData, countExpressPageSelections } from '../src/lib/expressPageOrganizer.js';
import { createPageNode, getPageCatalogId } from '../src/lib/pageOrganizerModel.js';
import { inspectExpressSubmissionIntegrity } from '../base44/shared/expressSubmissionIntegrity.js';

const root = fileURLToPath(new URL('../', import.meta.url));
globalThis.fetch = async () => { throw new Error('Network is disabled during example generation.'); };
const predefined = (questionId, label) => createPageNode(questionId, label, { source: 'predefined', catalogId: getPageCatalogId(questionId, label) });
const managed = createPageNode('2', 'Managed Services');
managed.children = [predefined('2', 'Managed IT'), predefined('2', 'IT Help Desk'), createPageNode('2', 'Security Reviews')];
const cloud = predefined('2', 'Cloud Services');
cloud.children = [predefined('2', 'Microsoft 365')];
const finance = predefined('8', 'Financial');
finance.children = [predefined('8', 'CPA')];
const formData = normalizeExpressPageOrganizerFormData({
  ...getInitialExpressFormData(),
  itCompanyType: ['Managed Services Provider (MSP)'],
  serviceOfferingsStructure: { format: 'page-tree-v1', pages: [managed, cloud] },
  differentiation: 'Our local team provides practical guidance, clear monthly plans, and responsive support for growing professional services businesses.',
  geographicAreas: 'Chicago, IL', geographicAreaMeta: { label: 'Chicago, IL', source: 'manual' },
  pricingPackaging: 'Flat-rate monthly (fully managed)',
  companyGoals: 'Acquire more clients', brandTone: 'Friendly & Approachable',
  targetIndustriesStructure: { format: 'page-tree-v1', pages: [finance, createPageNode('8', 'Vet Clinics')] },
  clientSize: '5-50 employees',
  clientChallenges: ['Cybersecurity concerns or breaches', 'Frequent downtime or outages'],
  clientOutcomes: ['Reduced downtime', 'Peace of mind about security'],
  idealClient: 'Our ideal client is a growing business with 5 to 50 employees that values dependable technology, clear communication, and an ongoing relationship with its IT provider.'
});
const transformed = buildExpressSubmissionPayload({ formData, businessName: 'Example Express IT', domain: 'example.com', sessionId: 'example-express-session', submitAttemptId: 'example-express-submission' });
transformed.metadata.submission_datetime = '2026-11-13T18:00:00.000Z';
const repaired = repairExpressSubmissionPayload(transformed).payload;
const validation = validateExpressSubmissionPayload(repaired);
if (!validation.ok) throw new Error(JSON.stringify(validation));
const integrity = inspectExpressSubmissionIntegrity(formData, repaired);
if (!integrity.ok) throw new Error(JSON.stringify(integrity));

const sdkStub = '\0example-offline-sdk';
const server = await createServer({
  root, configFile: false, envDir: false, logLevel: 'silent',
  optimizeDeps: { noDiscovery: true, entries: [], include: [] },
  plugins: [{ name: 'example-offline-sdk', resolveId: (id) => id === sdkStub ? id : null, load: (id) => id === sdkStub ? 'export const base44 = {};' : null }],
  resolve: { alias: [{ find: '@/api/base44Client', replacement: sdkStub }, { find: '@', replacement: path.join(root, 'src') }] },
  server: { middlewareMode: true }, appType: 'custom'
});
try {
  const { buildExpressZapierPayload } = await server.ssrLoadModule('/src/lib/expressZapierDelivery.js');
  const payload = buildExpressZapierPayload(repaired);
  if ('_rawFormData' in payload) throw new Error('Internal raw state leaked into the wire example.');
  const output = path.join(root, 'docs/examples/full-express-submission-example.json');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(payload, null, 2) + '\n');
  console.log(JSON.stringify({ output, services: countExpressPageSelections(formData, 'serviceOfferings'), industries: countExpressPageSelections(formData, 'targetIndustries'), validation: 'passed', payload }, null, 2));
} finally { await server.close(); }
