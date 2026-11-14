import { readFile } from 'node:fs/promises';
const schema = JSON.parse(await readFile(new URL('../../base44/entities/FormSubmission.jsonc', import.meta.url), 'utf8'));

// Reproduces the actual Base44 FormSubmission DTO observed in the synthetic
// hosted smoke: missing optional scalars/objects become null; arrays become [].
function hydrate(value, field) {
  if (value === undefined) return field.type === 'array' ? [] : null;
  if (value === null) return null;
  if (field.type === 'array') return value.map((item) => hydrate(item, field.items || {}));
  if (field.type !== 'object' || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = { ...value };
  for (const [key, property] of Object.entries(field.properties || {})) result[key] = hydrate(value[key], property);
  return result;
}
export const hydrateFormSubmissionEntity = (record) => hydrate(record, schema);
