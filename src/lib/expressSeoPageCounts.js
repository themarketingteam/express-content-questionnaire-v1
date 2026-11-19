import { countExpressPageSelections } from './expressPageOrganizer.js';
import { serializeStoredPageStructure } from '../../base44/shared/pageOrganizerContract.js';

const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const missing = { present: false, count: null };
const unreadable = { present: true, count: null };
const fields = {
  services: ['serviceOfferings', 'serviceOfferingsOther', 'serviceOfferingsStructure', 'service_offerings', 'service_offerings_other', 'service_offerings_structure'],
  industries: ['targetIndustries', 'targetIndustriesOther', 'targetIndustriesStructure', 'target_industries', 'target_industries_other', 'target_industries_structure'],
};

function parseRecord(value) {
  if (value === undefined || value === null || value === '') return { missing: true };
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return isObject(parsed) ? { value: parsed } : { invalid: true };
  } catch { return { invalid: true }; }
}

function countAnswer(container, field, mapped = false) {
  if (container.invalid) return unreadable;
  if (!container.value) return missing;
  const value = container.value;
  const [raw, other, structure, mappedRaw, mappedOther, mappedStructure] = fields[field];
  const listKey = mapped ? mappedRaw : raw;
  const otherKey = mapped ? mappedOther : other;
  const treeKey = mapped ? mappedStructure : structure;
  if (owns(value, treeKey) && !(mapped && value[treeKey] === null)) {
    try {
      if (!mapped) return { present: true, count: countExpressPageSelections(value, raw) };
      // Normalize documented entity-read padding, never a damaged adopted
      // tree into a different flat-list answer or a guessed zero.
      const tree = serializeStoredPageStructure(value[treeKey]);
      return { present: true, count: tree.pages.reduce((sum, page) => sum + 1 + (page.children?.length || 0), 0) };
    } catch { return unreadable; }
  }
  if (!owns(value, listKey) && !owns(value, otherKey)) {
    return container.unansweredIsZero ? { present: true, count: 0 } : missing;
  }
  if (!mapped && ((owns(value, listKey) && value[listKey] === null) || (owns(value, otherKey) && value[otherKey] === null))) return unreadable;
  // Base44 pads an uncaptured receipt with [] plus null Other. That is no
  // evidence of an answered question. Explicit Other:'' establishes known
  // empty mapped answers; a valid raw draft map remains authoritative above.
  if (mapped && (value[listKey] == null || (Array.isArray(value[listKey]) && value[listKey].length === 0)) && value[otherKey] == null) return missing;
  const selections = value[listKey] ?? [];
  const custom = value[otherKey] ?? '';
  if (!Array.isArray(selections) || selections.some((item) => typeof item !== 'string') || typeof custom !== 'string') return unreadable;
  return { present: true, count: countExpressPageSelections({ [raw]: selections, [other]: custom }, raw) };
}

function mappedUserdata(value) {
  const parsed = parseRecord(value);
  if (!parsed.value) return parsed;
  return owns(parsed.value, 'userdata') ? parseRecord(parsed.value.userdata) : { missing: true };
}

function rawAnswers(value, finalReceipt = false, rawAvailable = undefined) {
  const parsed = parseRecord(value);
  // A valid raw working-draft map is authoritative even before either answer
  // exists. Final receipt DTOs use {} when the raw snapshot was not retained;
  // in that case consult that same receipt's mapped content instead.
  if (rawAvailable === false) return { missing: true };
  return { ...parsed, unansweredIsZero: Boolean(parsed.value) && !(rawAvailable !== true && finalReceipt && Object.keys(parsed.value).length === 0) };
}

/** Pure display calculation for the selected questionnaire/version only. */
export function buildExpressSeoPageCounts({ draft = null, submission = null, version = null } = {}) {
  const sources = [];
  if (draft) {
    sources.push([rawAnswers(draft.responses_json, draft.status === 'submitted' || Boolean(draft.final_submission_id), version?.rawAvailable), false]);
    sources.push([mappedUserdata(draft.mapped_payload_json), true]);
    sources.push([parseRecord(draft.userdata_json), true]);
  }
  // A linked receipt may fill a mapped-only final snapshot. Another retained
  // session or a working draft cannot inherit the root's final counts.
  const matchingReceipt = submission && (!draft || (draft.final_submission_id && draft.final_submission_id === submission.id));
  if (matchingReceipt) {
    sources.push([rawAnswers(submission.raw_responses_json, true), false]);
    sources.push([mappedUserdata(submission.transformed_payload_json), true]);
    sources.push([{ value: submission }, true]);
  }
  const count = (field) => {
    for (const [container, mapped] of sources) {
      const result = countAnswer(container, field, mapped);
      if (result.present) return result.count;
    }
    return null;
  };
  const services = count('services');
  const industries = count('industries');
  return { services, industries, total: services === null || industries === null ? null : services + industries };
}
