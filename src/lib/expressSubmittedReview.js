const questions = [
  ['What type of IT company are you?', 'itCompanyType', 'itCompanyTypeOther'],
  ['What are your primary service offerings?', 'serviceOfferings', 'serviceOfferingsOther', 'serviceOfferingsStructure'],
  ['What makes your company different from other MSPs in your area?', 'differentiation'],
  ['What geographic areas do you serve?', 'geographicAreas'],
  ['How do you typically price or package your services?', 'pricingPackaging', 'pricingPackagingOther'],
  ['What are your company’s biggest goals over the next year?', 'companyGoals', 'companyGoalsOther'],
  ['What tone best describes how you want your brand to sound on your website?', 'brandTone', 'brandToneOther'],
  ['What types of businesses do you primarily serve?', 'targetIndustries', 'targetIndustriesOther', 'targetIndustriesStructure'],
  ['What is the typical size of your client companies?', 'clientSize'],
  ['What are the main IT challenges your clients come to you for help with?', 'clientChallenges', 'clientChallengesOther'],
  ['What outcomes do your clients want most from working with you?', 'clientOutcomes', 'clientOutcomesOther'],
  ['Briefly describe your ideal client.', 'idealClient'],
];

/** Display the retained answers without normalizing/re-projecting old selections. */
export function buildExpressSubmittedReview(formData = {}) {
  return questions.map(([title, field, other, structure], index) => ({
    number: index + 1,
    title,
    values: (Array.isArray(formData[field]) ? formData[field] : [formData[field]])
      .filter((value) => value !== undefined && value !== null && String(value).trim())
      .map(String),
    other: other && typeof formData[other] === 'string' ? formData[other] : '',
    pages: structure && Array.isArray(formData[structure]?.pages) ? formData[structure].pages : null,
  }));
}

