/**
 * Parses client-size range strings into numeric smallest/largest values.
 *
 * Supported patterns:
 *   "1-50 employees"
 *   "1 - 50 employees"
 *   "500+ employees"
 *   "1000+"
 *   "1000+ employees"
 *
 * Returns { smallest, largest, parsed } where `parsed` indicates whether
 * the string was successfully recognized. If parsing fails but the input
 * is a non-empty string, `parsed` is false — callers should preserve the
 * original value rather than wiping it.
 */
export function parseClientSizeValue(value, { minValue = 1, maxValue = 50 } = {}) {
  const fallback = { smallest: minValue, largest: maxValue, parsed: false };

  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  // Pattern: "N+ employees" or "N+"
  const plusMatch = trimmed.match(/^(\d+)\s*\+\s*(?:employees)?\s*$/i);
  if (plusMatch) {
    const num = parseInt(plusMatch[1], 10);
    if (!isNaN(num) && num >= 1) {
      return { smallest: minValue, largest: num > 1000 ? 1001 : num, parsed: true };
    }
  }

  // Pattern: "N-M employees" or "N - M employees"
  const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)\s*(?:employees)?\s*$/i);
  if (rangeMatch) {
    const small = parseInt(rangeMatch[1], 10);
    const large = parseInt(rangeMatch[2], 10);
    if (!isNaN(small) && !isNaN(large) && small >= 1 && large >= small) {
      return {
        smallest: small,
        largest: large > 1000 ? 1001 : large,
        parsed: true,
      };
    }
  }

  // Could not parse — return fallback but signal that the string is non-empty
  return fallback;
}

/**
 * Flexible validator for client-size strings.
 * Returns true if the value is a plausible employee-range string.
 * Only returns false for missing/empty/non-string values.
 */
export function isValidClientSizeValue(value) {
  if (typeof value !== "string") return false;
  return value.trim().length > 0;
}