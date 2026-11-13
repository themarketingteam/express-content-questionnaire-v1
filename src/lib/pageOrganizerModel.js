export const PAGE_STRUCTURE_FORMAT = 'page-tree-v1';
export const MAX_PAGE_COUNT = 100;
export const MAX_PAGE_LABEL_LENGTH = 500;
export const MAX_PAGE_ID_LENGTH = 160;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const requireQuestionId = (questionId) => {
  const id = String(questionId);
  if (id !== '2' && id !== '8') throw new Error('Page organization is available for questions 2 and 8 only.');
  return id;
};

let nextPageId = 0;
const newPageId = () => {
  if (globalThis.crypto?.randomUUID) return `page-${globalThis.crypto.randomUUID()}`;
  nextPageId += 1;
  return `page-${Date.now().toString(36)}-${nextPageId.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getPageCatalogId = (questionId, label, kind = 'option') => {
  const id = requireQuestionId(questionId);
  if (!['parent', 'option'].includes(kind)) throw new Error('Unknown catalog entry kind.');
  if (typeof label !== 'string' || !label.trim()) throw new Error('A catalog entry needs a label.');
  return `q${id}:${kind}:${encodeURIComponent(label.trim())}`;
};

/** @param {'2'|'8'|string|number} questionId @param {string} label @param {{source?: 'predefined'|'custom', catalogId?: string|null, id?: string}} options */
export function createPageNode(questionId, label, { source = 'custom', catalogId = null, id = undefined } = {}) {
  requireQuestionId(questionId);
  const node = { id: id || newPageId(), label: typeof label === 'string' ? label.trim() : label, source, catalogId, children: [] };
  const result = validatePageStructure({ format: PAGE_STRUCTURE_FORMAT, pages: [node] });
  if (!result.ok) throw new Error(result.errors.join(' '));
  return node;
}

export function validatePageStructure(structure) {
  const errors = [];
  if (!isRecord(structure)) return { ok: false, errors: ['Page structure must be an object.'] };
  if (structure.format !== PAGE_STRUCTURE_FORMAT) errors.push('Unsupported page structure format.');
  if (!Array.isArray(structure.pages)) return { ok: false, errors: [...errors, 'Page structure pages must be an array.'] };
  Object.keys(structure).forEach((key) => {
    if (!['format', 'pages'].includes(key)) errors.push(`Unknown page structure property: ${key}.`);
  });

  const seenIds = new Set();
  const seenCatalogIds = new Set();
  let count = 0;
  const visit = (node, depth, path) => {
    count += 1;
    if (!isRecord(node)) { errors.push(`${path} must be a page object.`); return; }
    Object.keys(node).forEach((key) => {
      if (!['id', 'label', 'source', 'catalogId', 'children'].includes(key)) errors.push(`${path} has an unknown property: ${key}.`);
    });
    if (typeof node.id !== 'string' || !node.id.trim() || node.id.length > MAX_PAGE_ID_LENGTH) {
      errors.push(`${path} needs a nonblank ID of at most ${MAX_PAGE_ID_LENGTH} characters.`);
    } else if (seenIds.has(node.id)) {
      errors.push(`Duplicate page ID: ${node.id}.`);
    } else seenIds.add(node.id);
    if (typeof node.label !== 'string' || !node.label.trim() || node.label.length > MAX_PAGE_LABEL_LENGTH) {
      errors.push(`${path} needs a label of at most ${MAX_PAGE_LABEL_LENGTH} characters.`);
    }
    if (!['predefined', 'custom'].includes(node.source)) errors.push(`${path} has an invalid source.`);
    if (node.source === 'predefined') {
      if (typeof node.catalogId !== 'string' || !node.catalogId.trim() || node.catalogId.length > 2000) {
        errors.push(`${path} needs its original catalog identity.`);
      } else if (seenCatalogIds.has(node.catalogId)) {
        errors.push(`Duplicate catalog identity: ${node.catalogId}.`);
      } else seenCatalogIds.add(node.catalogId);
    } else if (node.source === 'custom' && node.catalogId !== null) {
      errors.push(`${path} must have a null catalog identity for a custom page.`);
    }
    if (!Array.isArray(node.children)) { errors.push(`${path} children must be an array.`); return; }
    if (depth === 2 && node.children.length) { errors.push(`${path} exceeds the two-level page limit.`); return; }
    node.children.forEach((child, index) => visit(child, depth + 1, `${path}.children[${index}]`));
  };
  structure.pages.forEach((node, index) => visit(node, 1, `pages[${index}]`));
  if (count > MAX_PAGE_COUNT) errors.push(`A question can contain at most ${MAX_PAGE_COUNT} pages.`);
  return { ok: errors.length === 0, errors };
}

// Validation precedes cloning: malformed or future formats are never silently
// converted to an empty answer, and unknown fields cannot disappear unnoticed.
export function normalizePageStructure(structure) {
  const result = validatePageStructure(structure);
  if (!result.ok) throw new Error(result.errors.join(' '));
  const clone = (node) => ({ ...node, label: node.label.trim(), children: node.children.map(clone) });
  return { format: PAGE_STRUCTURE_FORMAT, pages: structure.pages.map(clone) };
}

export function flattenPageStructure(structure) {
  const normalized = normalizePageStructure(structure);
  return normalized.pages.flatMap((page) => [page, ...page.children]);
}

export function projectPageStructure(structure) {
  const selections = [];
  const otherValues = [];
  flattenPageStructure(structure).forEach((node) => {
    if (node.source === 'predefined') selections.push(node.label);
    else otherValues.push(node.label);
  });
  return { selections, otherValues };
}

export function countPageSelections(structure, questionId, _groupedOptions = {}) {
  requireQuestionId(questionId);
  return flattenPageStructure(structure).length;
}

const legacyLabels = (value, field) => {
  const entries = value == null ? [] : Array.isArray(value) ? value : [value];
  return entries.map((entry) => {
    if (typeof entry === 'string') return entry.trim();
    if (isRecord(entry)) {
      for (const key of ['label', 'value', 'name', 'title']) {
        if (typeof entry[key] === 'string' && entry[key].trim()) return entry[key].trim();
      }
    }
    throw new Error(`${field} contains an unsupported legacy value; preserve it for review before conversion.`);
  }).filter(Boolean);
};

// A deterministic ID makes opening the same old draft repeatable before the
// first edit adopts the structure. Interactive additions use random IDs instead.
const legacyHash = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

/** @param {string|number} questionId @param {any} selections @param {string|any[]} other @param {any} groupedOptions @param {string[]} options */
export function createPageStructure(questionId, selections = [], other = [], groupedOptions = {}, options = []) {
  const id = requireQuestionId(questionId);
  if (isRecord(selections) && 'format' in selections) return normalizePageStructure(selections);
  const catalogOptions = Array.isArray(groupedOptions) ? groupedOptions
    : options.length ? options : Object.values(groupedOptions || {}).flat();
  const knownOptions = new Set(catalogOptions);
  const pages = [];
  const ids = new Set();
  const seenMain = new Set();
  const makeNode = (label, source, occurrence) => {
    const catalogId = source === 'predefined' ? getPageCatalogId(id, label) : null;
    const stem = `legacy-q${id}-${legacyHash(`${source}|${catalogId || label}|${occurrence}`)}`;
    let nodeId = stem;
    let collision = 1;
    while (ids.has(nodeId)) { collision += 1; nodeId = `${stem}-${collision}`; }
    ids.add(nodeId);
    return createPageNode(id, label, { source, catalogId, id: nodeId });
  };
  // Express category headings were never selected pages. Migration stays flat.
  legacyLabels(selections, 'Selections').forEach((label) => {
    if (seenMain.has(label)) return;
    seenMain.add(label);
    pages.push(makeNode(label, knownOptions.has(label) ? 'predefined' : 'custom', 'main'));
  });
  // Historical Other is one exact answer; commas do not imply page boundaries.
  legacyLabels(other, 'Custom selections').forEach((label, index) => pages.push(makeNode(label, 'custom', `other-${index}`)));
  return normalizePageStructure({ format: PAGE_STRUCTURE_FORMAT, pages });
}

const findLocation = (structure, pageId) => {
  for (let index = 0; index < structure.pages.length; index += 1) {
    const page = structure.pages[index];
    if (page.id === pageId) return { siblings: structure.pages, index, node: page, parent: null };
    const childIndex = page.children.findIndex((child) => child.id === pageId);
    if (childIndex !== -1) return { siblings: page.children, index: childIndex, node: page.children[childIndex], parent: page };
  }
  throw new Error(`Page not found: ${pageId}.`);
};

const targetSiblings = (structure, parentId) => {
  if (parentId == null) return structure.pages;
  const target = findLocation(structure, parentId);
  if (target.parent) throw new Error('Only a top-level page can contain children.');
  return target.node.children;
};

const insertionIndex = (index, length) => {
  if (index == null) return length;
  if (!Number.isInteger(index) || index < 0 || index > length) throw new Error('Page position is outside the sibling list.');
  return index;
};

export function addPage(structure, node, parentId = null, index) {
  const next = normalizePageStructure(structure);
  const addition = normalizePageStructure({ format: PAGE_STRUCTURE_FORMAT, pages: [node] }).pages[0];
  if (parentId != null && addition.children.length) throw new Error('Move child pages out before nesting their parent.');
  const siblings = targetSiblings(next, parentId);
  siblings.splice(insertionIndex(index, siblings.length), 0, addition);
  return normalizePageStructure(next);
}

// index is the final index in the destination sibling array, after removal.
export function movePage(structure, pageId, parentId = null, index) {
  const next = normalizePageStructure(structure);
  const location = findLocation(next, pageId);
  if (pageId === parentId) throw new Error('A page cannot be its own parent.');
  if (parentId != null && location.node.children.length) throw new Error('Move child pages out before nesting their parent.');
  // Resolve the destination first so an invalid move cannot remove a page.
  const siblings = targetSiblings(next, parentId);
  location.siblings.splice(location.index, 1);
  siblings.splice(insertionIndex(index, siblings.length), 0, location.node);
  return normalizePageStructure(next);
}

// Removing a parent keeps its children as standalone pages at its old priority.
export function removePage(structure, pageId) {
  const next = normalizePageStructure(structure);
  const location = findLocation(next, pageId);
  location.siblings.splice(location.index, 1, ...location.node.children);
  return normalizePageStructure(next);
}
