const ACCESS_KEY_HASH_PATTERN = /^[a-f0-9]{64}$/;

export function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function draftAllowsAccess(
  draft: Record<string, unknown>,
  submittedAccessKeyHash: string,
): boolean {
  if (!ACCESS_KEY_HASH_PATTERN.test(submittedAccessKeyHash)) return false;
  const recoveryHashes = Array.isArray(draft.draft_recovery_access_key_hashes)
    ? draft.draft_recovery_access_key_hashes
    : [];
  const storedHashes = [draft.draft_access_key_hash, ...recoveryHashes]
    .filter((value): value is string => (
      typeof value === 'string' && ACCESS_KEY_HASH_PATTERN.test(value)
    ));
  return storedHashes.some((storedHash) => constantTimeEqual(storedHash, submittedAccessKeyHash));
}

export function appendDraftRecoveryAccessHash(
  currentValue: unknown,
  nextHash: string,
  maximumHashes = 20,
): string[] {
  const currentHashes = Array.isArray(currentValue) ? currentValue : [];
  const uniqueHashes = [...currentHashes, nextHash]
    .filter((value): value is string => (
      typeof value === 'string' && ACCESS_KEY_HASH_PATTERN.test(value)
    ))
    .filter((value, index, values) => values.indexOf(value) === index);
  return uniqueHashes.slice(-maximumHashes);
}

export function withoutDraftAccessHashes(
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const {
    draft_access_key_hash: _primaryAccessKeyHash,
    draft_recovery_access_key_hashes: _recoveryAccessKeyHashes,
    ...safeDraft
  } = draft;
  return safeDraft;
}
