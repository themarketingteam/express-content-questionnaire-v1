import { serializePageStructure } from '../../base44/shared/pageOrganizerContract.js';
import { normalizeExpressFormData } from './expressQuestionnairePayload.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
export const ORGANIZER_DISPLAY_FIELDS = Object.freeze({ serviceOfferings: 'serviceOfferingsStructure', targetIndustries: 'targetIndustriesStructure' });
export const hasOrganizedAnswer = (formData, field) => Boolean(ORGANIZER_DISPLAY_FIELDS[field]) && own(formData, ORGANIZER_DISPLAY_FIELDS[field]);

export function formatOrganizedAnswer(structure) {
  try {
    return serializePageStructure(structure).pages.flatMap((page, index) => [
      `${index + 1}. ${page.label}`,
      ...(page.children || []).map((child, childIndex) => `    ${childIndex + 1}. ${child.label}`),
    ]).join('\n') || 'Not answered';
  } catch { return 'Page organization needs review before it can be displayed.'; }
}

// Compact mapped pages are display snapshots, never editor state with invented IDs.
export function normalizeExpressDisplayFormData(formData = {}) {
  const source = formData && typeof formData === 'object' ? formData : {};
  const legacyFields = { ...source };
  Object.values(ORGANIZER_DISPLAY_FIELDS).forEach((key) => delete legacyFields[key]);
  const result = normalizeExpressFormData(legacyFields);
  Object.values(ORGANIZER_DISPLAY_FIELDS).forEach((key) => {
    if (own(source, key)) {
      try { result[key] = serializePageStructure(source[key]); }
      catch { result[key] = structuredClone(source[key]); }
    }
  });
  return result;
}

export function retainMappedPageStructures(source, target) {
  if (own(source?.metadata, 'questionnaire_payload_version')) target.metadata.questionnaire_payload_version = source.metadata.questionnaire_payload_version;
  for (const key of ['service_offerings_structure', 'target_industries_structure']) {
    if (own(source?.userdata, key)) target.userdata[key] = structuredClone(source.userdata[key]);
  }
  return target;
}
