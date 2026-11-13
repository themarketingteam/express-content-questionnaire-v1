/**
 * Pure page-organizer persistence contract. No SDK/network/browser dependencies.
 * Shared by the isolated local API and future Base44 function bundles.
 */
export const PAGE_STRUCTURE_FORMAT = 'page-tree-v1';
export const ORGANIZER_QUESTIONS = Object.freeze([
  { questionId: '2', responseKey: 'serviceOfferingsStructure', rawField: 'serviceOfferings', otherField: 'serviceOfferingsOther', field: 'service_offerings', structureField: 'service_offerings_structure' },
  { questionId: '8', responseKey: 'targetIndustriesStructure', rawField: 'targetIndustries', otherField: 'targetIndustriesOther', field: 'target_industries', structureField: 'target_industries_structure' }
]);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const plain = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!plain(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
};
const same = (left, right) => JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
const outcome = (errors, organizedQuestions = [], code = 'INVALID_PAGE_STRUCTURE', status = 400) => ({
  ok: errors.length === 0,
  errors,
  organizedQuestions,
  ...(errors.length ? { code, status } : {})
});

export const validatePageStructure = (structure, { path = 'structure' } = {}) => {
  const errors = [];
  if (!plain(structure)) return outcome([`${path} must be an object.`]);
  if (structure.format !== PAGE_STRUCTURE_FORMAT) errors.push(`${path}.format must be ${PAGE_STRUCTURE_FORMAT}.`);
  Object.keys(structure).forEach((key) => {
    if (!['format', 'pages'].includes(key)) errors.push(`${path}.${key} is not supported.`);
  });
  if (!Array.isArray(structure.pages)) return outcome([...errors, `${path}.pages must be an array.`]);
  const seenIds = new Set();
  const seenCatalogIds = new Set();
  const visited = new Set();
  let total = 0;
  const visit = (nodes, depth, nodePath) => {
    if (nodes.length > 100) errors.push(`${nodePath} exceeds 100 pages.`);
    for (const [index, node] of nodes.entries()) {
      const itemPath = `${nodePath}[${index}]`;
      total += 1;
      if (total > 100) { errors.push(`${path} exceeds 100 total pages.`); return; }
      if (!plain(node)) { errors.push(`${itemPath} must be an object.`); continue; }
      if (visited.has(node)) { errors.push(`${itemPath} contains a cycle or repeated node.`); continue; }
      visited.add(node);
      Object.keys(node).forEach((key) => {
        if (!['id', 'label', 'source', 'catalogId', 'children'].includes(key)) errors.push(`${itemPath}.${key} is not supported.`);
      });
      if (typeof node.id !== 'string' || !node.id.trim() || node.id.length > 160) {
        errors.push(`${itemPath}.id must be a nonempty string of at most 160 characters.`);
      } else if (seenIds.has(node.id)) errors.push(`${itemPath}.id must be unique within its question.`);
      else seenIds.add(node.id);
      if (typeof node.label !== 'string' || !node.label.trim() || node.label.length > 500) {
        errors.push(`${itemPath}.label must be a nonempty string of at most 500 characters.`);
      }
      if (!['predefined', 'custom'].includes(node.source)) errors.push(`${itemPath}.source must be predefined or custom.`);
      if (node.source === 'predefined') {
        if (typeof node.catalogId !== 'string' || !node.catalogId.trim() || node.catalogId.length > 2000) {
          errors.push(`${itemPath}.catalogId must identify a predefined selection.`);
        } else if (seenCatalogIds.has(node.catalogId)) errors.push(`${itemPath}.catalogId must be unique within its question.`);
        else seenCatalogIds.add(node.catalogId);
      } else if (node.catalogId !== null) {
        errors.push(`${itemPath}.catalogId must be null for custom pages.`);
      }
      if (!Array.isArray(node.children)) errors.push(`${itemPath}.children must be an array.`);
      else if (depth >= 2 && node.children.length) errors.push(`${itemPath} exceeds the parent and child depth limit.`);
      else visit(node.children, depth + 1, `${itemPath}.children`);
    }
  };
  visit(structure.pages, 1, `${path}.pages`);
  return outcome(errors);
};

/** Mapped trees are compact. Historical wholly ID-bearing trees remain readable. */
export const validateMappedPageStructure = (structure, { path = 'structure' } = {}) => {
  if (!plain(structure)) return outcome([`${path} must be an object.`]);
  const errors = [];
  if (structure.format !== PAGE_STRUCTURE_FORMAT) errors.push(`${path}.format must be ${PAGE_STRUCTURE_FORMAT}.`);
  Object.keys(structure).forEach((key) => {
    if (!['format', 'pages'].includes(key)) errors.push(`${path}.${key} is not supported.`);
  });
  if (!Array.isArray(structure.pages)) return outcome([...errors, `${path}.pages must be an array.`]);
  const rich = structure.pages.some((page) => plain(page) && (
    own(page, 'id') || own(page, 'catalogId')
    || (Array.isArray(page.children) && page.children.some((child) => own(child, 'id') || own(child, 'catalogId')))
  ));
  // A partially stripped rich tree must not bypass identity validation.
  if (rich) return validatePageStructure(structure, { path });
  const visited = new Set();
  let total = 0;
  const visit = (node, depth, itemPath) => {
    total += 1;
    if (total > 100) { errors.push(`${path} exceeds 100 total pages.`); return; }
    if (!plain(node)) { errors.push(`${itemPath} must be an object.`); return; }
    if (visited.has(node)) { errors.push(`${itemPath} contains a cycle or repeated node.`); return; }
    visited.add(node);
    const allowed = depth === 1 ? ['label', 'source', 'children'] : ['label', 'source'];
    Object.keys(node).forEach((key) => {
      if (!allowed.includes(key)) errors.push(`${itemPath}.${key} is not supported.`);
    });
    if (typeof node.label !== 'string' || !node.label.trim() || node.label.length > 500) errors.push(`${itemPath}.label must be a nonempty string of at most 500 characters.`);
    if (!['predefined', 'custom'].includes(node.source)) errors.push(`${itemPath}.source must be predefined or custom.`);
    if (depth === 1 && own(node, 'children')) {
      if (!Array.isArray(node.children) || node.children.length === 0) errors.push(`${itemPath}.children must be a nonempty array when present.`);
      else {
        if (node.children.length > 100) errors.push(`${itemPath}.children exceeds 100 pages.`);
        node.children.slice(0, 101).forEach((child, index) => visit(child, 2, `${itemPath}.children[${index}]`));
      }
    }
  };
  if (structure.pages.length > 100) errors.push(`${path}.pages exceeds 100 pages.`);
  structure.pages.slice(0, 101).forEach((page, index) => visit(page, 1, `${path}.pages[${index}]`));
  return outcome(errors);
};

/** Serialize logical page content without editor identity or empty child arrays. */
export const serializePageStructure = (structure) => {
  const validation = validateMappedPageStructure(structure);
  if (!validation.ok) throw Object.assign(new Error(validation.errors.join(' ')), { code: validation.code, status: validation.status });
  return {
    format: PAGE_STRUCTURE_FORMAT,
    pages: structure.pages.map((page) => ({
      label: page.label,
      source: page.source,
      ...(page.children?.length ? { children: page.children.map((child) => ({ label: child.label, source: child.source })) } : {})
    }))
  };
};

/** Invalid or unknown formats never compare equal, even to themselves. */
export const samePageStructure = (left, right) => {
  try { return same(serializePageStructure(left), serializePageStructure(right)); }
  catch { return false; }
};

export const projectOrganizedPages = (structure) => {
  const selections = [];
  const otherValues = [];
  const visit = (pages) => {
    pages.forEach((page) => {
      (page.source === 'predefined' ? selections : otherValues).push(page.label);
      if (page.children) visit(page.children);
    });
  };
  visit(serializePageStructure(structure).pages);
  return { selections, otherValues, other: otherValues.join(', ') };
};

export const validateOrganizedResponses = (responses = {}) => {
  const errors = [];
  const organizedQuestions = [];
  for (const question of ORGANIZER_QUESTIONS) {
    if (!own(responses, question.responseKey)) continue;
    organizedQuestions.push(question.questionId);
    errors.push(...validatePageStructure(responses[question.responseKey], { path: question.responseKey }).errors);
  }
  return outcome(errors, organizedQuestions);
};

export const validateOrganizedPayload = (payload) => {
  const errors = [];
  const organizedQuestions = [];
  for (const question of ORGANIZER_QUESTIONS) {
    if (!own(payload?.userdata, question.structureField)) continue;
    organizedQuestions.push(question.questionId);
    const structure = payload.userdata[question.structureField];
    const validation = validateMappedPageStructure(structure, { path: `userdata.${question.structureField}` });
    errors.push(...validation.errors);
    if (!validation.ok) continue;
    const projection = projectOrganizedPages(structure);
    if (!same(payload.userdata[question.field], projection.selections)) errors.push(`userdata.${question.field} must match its organized page projection.`);
    if (payload.userdata[`${question.field}_other`] !== projection.other) errors.push(`userdata.${question.field}_other must match its organized page projection.`);
  }
  const version = payload?.metadata?.questionnaire_payload_version;
  if (organizedQuestions.length && version !== 2) errors.push('metadata.questionnaire_payload_version must be 2 for organized questions.');
  if (!organizedQuestions.length && version !== undefined && version !== 1) errors.push('Unsupported or inconsistent questionnaire payload version.');
  return outcome(errors, organizedQuestions);
};

/**
 * Missing fields are never a request to downgrade an adopted question.
 * @param {{currentResponses?: Record<string, any>, incomingResponses?: Record<string, any>, changedKeys?: string[], deletedKeys?: string[], baseRevision?: number, currentRevision?: number}} options
 */
export const guardOrganizedDraftMutation = ({
  currentResponses = {}, incomingResponses = {}, changedKeys = [], deletedKeys = [], baseRevision, currentRevision
}) => {
  const validation = validateOrganizedResponses(incomingResponses);
  if (!validation.ok) return validation;
  const existing = validateOrganizedResponses(currentResponses);
  if (!existing.ok) return existing;
  let organizerChanged = false;
  for (const question of ORGANIZER_QUESTIONS) {
    const adopted = own(currentResponses, question.responseKey);
    const structureChanged = changedKeys.includes(question.responseKey)
      && own(incomingResponses, question.responseKey)
      && !same(currentResponses[question.responseKey], incomingResponses[question.responseKey]);
    if (deletedKeys.includes(question.responseKey) && adopted) {
      return outcome(['An organized question cannot be downgraded by deleting its structure.'], existing.organizedQuestions, 'ORGANIZER_DOWNGRADE_REJECTED', 409);
    }
    const legacyChanged = [question.rawField, question.otherField].some((key) => (
      (changedKeys.includes(key) && own(incomingResponses, key) && !same(currentResponses[key], incomingResponses[key]))
      || (deletedKeys.includes(key) && own(currentResponses, key))
    ));
    if (adopted && legacyChanged && !own(incomingResponses, question.responseKey)) {
      return outcome(['This question uses the page organizer. Reload before changing its selections.'], existing.organizedQuestions, 'ORGANIZER_CLIENT_UPGRADE_REQUIRED', 409);
    }
    if (adopted && legacyChanged && !changedKeys.includes(question.responseKey)) {
      return outcome(['Organized selections and their structure must be saved together.'], existing.organizedQuestions, 'ORGANIZER_STRUCTURE_REQUIRED', 409);
    }
    organizerChanged ||= structureChanged || (adopted && legacyChanged);
  }
  if (organizerChanged && (!Number.isInteger(baseRevision) || baseRevision !== currentRevision)) {
    return outcome(['The organized question changed in another tab. Reload before saving.'], existing.organizedQuestions, 'ORGANIZER_REVISION_CONFLICT', 409);
  }
  return outcome([], existing.organizedQuestions);
};

/** Derive compatibility values from authoritative structures; never re-group by catalog. */
export const preserveOrganizedMappedPayload = (payload, responses = {}) => {
  const validation = validateOrganizedResponses(responses);
  if (!validation.ok) throw Object.assign(new Error(validation.errors.join(' ')), { code: validation.code, status: 400 });
  const next = JSON.parse(JSON.stringify(payload || {}));
  const originalVersion = next?.metadata?.questionnaire_payload_version;
  if (originalVersion !== undefined && originalVersion !== 1 && originalVersion !== 2) {
    throw Object.assign(new Error('Unsupported questionnaire payload version.'), { code: 'INVALID_PAGE_STRUCTURE', status: 400 });
  }
  const structures = new Map();
  for (const question of ORGANIZER_QUESTIONS) {
    if (own(next.userdata, question.structureField)) {
      // Validate historical mapped content before any authoritative replacement.
      structures.set(question.structureField, serializePageStructure(next.userdata[question.structureField]));
    }
    if (own(responses, question.responseKey)) structures.set(question.structureField, serializePageStructure(responses[question.responseKey]));
  }
  if (!structures.size) {
    if (originalVersion === 2) throw Object.assign(new Error('Version 2 requires an organized question structure.'), { code: 'INVALID_PAGE_STRUCTURE', status: 400 });
    return next;
  }
  next.metadata = plain(next.metadata) ? next.metadata : {};
  next.userdata = plain(next.userdata) ? next.userdata : {};
  next.metadata.questionnaire_payload_version = 2;
  for (const question of ORGANIZER_QUESTIONS) {
    if (!structures.has(question.structureField)) continue;
    const structure = structures.get(question.structureField);
    const projection = projectOrganizedPages(structure);
    next.userdata[question.structureField] = structure;
    next.userdata[question.field] = projection.selections;
    next.userdata[`${question.field}_other`] = projection.other;
  }
  return next;
};

/** Generic legacy string cleanup must not truncate a structured projection. */
export const restoreOrganizedProjections = (payload) => preserveOrganizedMappedPayload(payload);

export const validateOrganizedSubmission = ({ payload, responses = {}, allowMissingPayload = false }) => {
  const validation = validateOrganizedResponses(responses);
  if (!validation.ok) return validation;
  if (!payload && allowMissingPayload) return validation;
  const payloadValidation = validateOrganizedPayload(payload);
  if (!payloadValidation.ok) return payloadValidation;
  for (const question of ORGANIZER_QUESTIONS) {
    const adopted = own(responses, question.responseKey);
    const supplied = own(payload?.userdata, question.structureField);
    if ((adopted || supplied) && (!adopted || !supplied || !samePageStructure(responses[question.responseKey], payload.userdata[question.structureField]))) {
      return outcome(['The submitted page structure does not match the saved draft. Reload and save before submitting.'], validation.organizedQuestions, 'ORGANIZER_SUBMISSION_CONFLICT', 409);
    }
  }
  return payloadValidation;
};

/** Recover a missing mapped tree only from its exact saved raw response tree. */
export const reconcileOrganizedRepairPayload = (payload, responses = {}) => {
  const sourceValidation = validateOrganizedResponses(responses);
  if (!sourceValidation.ok) return { ...sourceValidation, payload: null };
  const payloadValidation = validateOrganizedPayload(payload);
  if (!payloadValidation.ok) return { ...payloadValidation, payload: null };
  for (const question of ORGANIZER_QUESTIONS) {
    if (own(responses, question.responseKey) && own(payload?.userdata, question.structureField)
      && !samePageStructure(responses[question.responseKey], payload.userdata[question.structureField])) {
      return { ...outcome(['The saved raw and mapped page structures disagree; human review is required.'], sourceValidation.organizedQuestions, 'ORGANIZER_REPAIR_CONFLICT', 409), payload: null };
    }
  }
  return { ...outcome([], [...new Set([...sourceValidation.organizedQuestions, ...payloadValidation.organizedQuestions])]), payload: preserveOrganizedMappedPayload(payload, responses) };
};

/** Express persists final answers as flattened entity fields. */
export const organizedPayloadRecordFields = (payload) => {
  const validation = validateOrganizedPayload(payload);
  if (!validation.ok) throw Object.assign(new Error(validation.errors.join(' ')), { code: validation.code, status: validation.status });
  if (!validation.organizedQuestions.length) return {};
  return {
    questionnaire_payload_version: 2,
    ...Object.fromEntries(ORGANIZER_QUESTIONS
      .filter((question) => own(payload?.userdata, question.structureField))
      .map((question) => [question.structureField, serializePageStructure(payload.userdata[question.structureField])]))
  };
};

/** Existing Express limits apply to all adopted pages, including parent pages. */
export const validateExpressOrganizerLimits = (payload) => {
  const validation = validateOrganizedPayload(payload);
  if (!validation.ok) return validation;
  const errors = [];
  for (const question of ORGANIZER_QUESTIONS) {
    if (!own(payload?.userdata, question.structureField)) continue;
    const tree = serializePageStructure(payload.userdata[question.structureField]);
    const count = tree.pages.reduce((total, page) => total + 1 + (page.children?.length || 0), 0);
    const min = question.questionId === '2' ? 3 : 1;
    const max = question.questionId === '2' ? 6 : 3;
    if (count < min || count > max) errors.push(`Question ${question.questionId} requires ${min}–${max} selected pages, including parent and custom pages.`);
  }
  return outcome(errors, validation.organizedQuestions);
};
