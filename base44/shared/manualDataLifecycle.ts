import { hmacSha256Hex, sha256Hex } from './privateS3.ts';

export const DELETION_REASON_CODES = new Set([
  'client_request',
  'privacy_request',
  'duplicate_or_test',
  'contract_request',
  'other_authorized',
]);
export const LIFECYCLE_TOKEN_TTL_MS = 10 * 60 * 1_000;

function encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function decode(value: string): string {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export async function createLifecycleToken(
  claims: Record<string, unknown>,
  secret: string,
  now = Date.now(),
): Promise<string> {
  if (!secret) throw new Error('Lifecycle authorization is not configured.');
  const payload = encode(JSON.stringify({ ...claims, issuedAt: now, expiresAt: now + LIFECYCLE_TOKEN_TTL_MS }));
  return `${payload}.${await hmacSha256Hex(secret, payload)}`;
}

export async function verifyLifecycleToken(
  token: unknown,
  secret: string,
  now = Date.now(),
): Promise<{ valid: true; claims: Record<string, any> } | { valid: false; error: string }> {
  if (typeof token !== 'string' || !token.includes('.') || !secret) return { valid: false, error: 'Invalid lifecycle authorization.' };
  const [payload, signature, ...extra] = token.split('.');
  if (extra.length || !payload || !signature) return { valid: false, error: 'Invalid lifecycle authorization.' };
  const expected = await hmacSha256Hex(secret, payload);
  if (signature.length !== expected.length) return { valid: false, error: 'Invalid lifecycle authorization.' };
  let mismatch = 0;
  for (let index = 0; index < signature.length; index += 1) mismatch |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  if (mismatch !== 0) return { valid: false, error: 'Invalid lifecycle authorization.' };
  try {
    const claims = JSON.parse(decode(payload));
    if (!Number.isFinite(claims.expiresAt) || now > claims.expiresAt) return { valid: false, error: 'Lifecycle authorization expired.' };
    return { valid: true, claims };
  } catch {
    return { valid: false, error: 'Invalid lifecycle authorization.' };
  }
}

export async function confirmationHash(value: unknown): Promise<string> {
  return await sha256Hex(`confirmation:${typeof value === 'string' ? value.trim() : ''}`);
}

export function expectedDeletionConfirmation(record: Record<string, unknown>): string {
  const businessName = typeof record.business_name === 'string' ? record.business_name.trim() : '';
  const session = typeof (record.session_id || record.questionnaire_session_id) === 'string'
    ? String(record.session_id || record.questionnaire_session_id).trim()
    : '';
  return businessName || session;
}

export function restoreConfirmation(count: number): string {
  return `RESTORE ${count} RECORDS`;
}
