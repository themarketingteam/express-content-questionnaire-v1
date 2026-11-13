import { normalizePageStructure, projectPageStructure, countPageSelections, validatePageStructure } from './pageOrganizerModel.js';
import { ORGANIZER_QUESTIONS, serializePageStructure } from '../../base44/shared/pageOrganizerContract.js';

const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export const expressPageOrganizerFields = (formData = {}) => Object.fromEntries(
  ORGANIZER_QUESTIONS.filter((question) => owns(formData, question.responseKey)).map((question) => [question.responseKey, formData[question.responseKey]])
);

/** Preserve optional adoption; malformed saved trees stay intact for review. */
export function normalizeExpressPageOrganizerFormData(formData = {}) {
  const next = { ...formData };
  for (const question of ORGANIZER_QUESTIONS) {
    if (!owns(formData, question.responseKey)) continue;
    const tree = formData[question.responseKey];
    next[question.responseKey] = tree;
    if (!validatePageStructure(tree).ok) continue;
    const normalized = normalizePageStructure(tree);
    const projected = projectPageStructure(normalized);
    next[question.responseKey] = normalized;
    next[question.rawField] = projected.selections;
    next[question.otherField] = projected.otherValues.join(', ');
  }
  return next;
}

/** Only mapper output contains compact trees; raw form state keeps stable IDs. */
export function projectExpressPageOrganizerPayload(formData = {}) {
  const userdata = {};
  let adopted = false;
  for (const question of ORGANIZER_QUESTIONS) {
    if (!owns(formData, question.responseKey)) continue;
    // The editor contract is strict; compact trees cannot masquerade as raw state.
    const tree = normalizePageStructure(formData[question.responseKey]);
    const projected = projectPageStructure(tree);
    userdata[question.structureField] = serializePageStructure(tree);
    userdata[question.field] = projected.selections;
    userdata[`${question.field}_other`] = projected.otherValues.join(', ');
    adopted = true;
  }
  return { metadata: adopted ? { questionnaire_payload_version: 2 } : {}, userdata };
}

export function countExpressPageSelections(formData = {}, field) {
  const question = ORGANIZER_QUESTIONS.find((entry) => entry.rawField === field || entry.questionId === String(field));
  if (!question) throw new Error('Unknown Express page organizer question.');
  if (owns(formData, question.responseKey)) {
    return countPageSelections(normalizePageStructure(formData[question.responseKey]), question.questionId);
  }
  const values = Array.isArray(formData[question.rawField]) ? formData[question.rawField] : [];
  return values.length + (typeof formData[question.otherField] === 'string' && formData[question.otherField].trim() ? 1 : 0);
}
