import { getInitialExpressFormData } from '../src/lib/expressQuestionnairePayload.js';

export function localExpressFixture(kind = 'legacy') {
  const formData = getInitialExpressFormData();
  if (kind === 'blank') return { formData, businessName: '', domain: '' };
  return {
    businessName: 'Local Example Networks', domain: 'local-example.test',
    formData: {
      ...formData,
      itCompanyType: ['Managed Services Provider (MSP)'],
      serviceOfferings: ['Managed IT', 'Microsoft 365', 'Cybersecurity'],
      differentiation: 'Our local team helps professional services firms simplify technology with responsive support, clear monthly plans, and practical security guidance.',
      geographicAreas: 'Louisville, KY', geographicAreaMeta: { label: 'Louisville, KY', source: 'manual' },
      pricingPackaging: 'Flat-rate monthly (fully managed)',
      companyGoals: 'Acquire more clients', brandTone: 'Professional & Corporate',
      targetIndustries: ['Healthcare / Medical'], clientSize: '1-50 employees',
      clientChallenges: ['Cybersecurity concerns or breaches'], clientOutcomes: ['Faster response and resolution'],
      idealClient: 'Our ideal client is a growing healthcare practice with 10 to 50 employees that values reliable technology, responsive support, and a long-term IT partner.'
    }
  };
}
