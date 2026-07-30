const encoder = new TextEncoder();

export const DRAFT_RECOVERY_PASSWORD_SECRET = 'DRAFT_RECOVERY_PASSWORD';
export const DRAFT_RECOVERY_ACCESS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

type AccessTokenPayload = {
  version: 1;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function encodeBase64Url(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export function getDraftRecoveryPassword(): string | null {
  const password = Deno.env.get(DRAFT_RECOVERY_PASSWORD_SECRET);
  return password && password.length > 0 ? password : null;
}

export async function passwordMatches(candidate: string, expected: string): Promise<boolean> {
  if (!candidate || candidate.length > 512) return false;
  const [candidateDigest, expectedDigest] = await Promise.all([
    digest(candidate),
    digest(expected),
  ]);
  return constantTimeEqual(candidateDigest, expectedDigest);
}

export async function issueDraftRecoveryAccessToken(secret: string): Promise<{
  accessToken: string;
  expiresAt: string;
}> {
  const issuedAt = Date.now();
  const payload: AccessTokenPayload = {
    version: 1,
    issuedAt,
    expiresAt: issuedAt + DRAFT_RECOVERY_ACCESS_DURATION_MS,
    nonce: crypto.randomUUID(),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const key = await importSigningKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload)),
  );

  return {
    accessToken: `${encodedPayload}.${encodeBase64Url(signature)}`,
    expiresAt: new Date(payload.expiresAt).toISOString(),
  };
}

export async function validateDraftRecoveryAccessToken(
  accessToken: unknown,
  secret = getDraftRecoveryPassword(),
): Promise<AccessTokenPayload | null> {
  if (typeof accessToken !== 'string' || !secret || accessToken.length > 4096) return null;

  const parts = accessToken.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  try {
    const [encodedPayload, encodedSignature] = parts;
    const key = await importSigningKey(secret);
    const validSignature = await crypto.subtle.verify(
      'HMAC',
      key,
      decodeBase64Url(encodedSignature).buffer as ArrayBuffer,
      encoder.encode(encodedPayload),
    );
    if (!validSignature) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(encodedPayload)),
    ) as AccessTokenPayload;
    const now = Date.now();

    if (
      payload?.version !== 1 ||
      !Number.isFinite(payload.issuedAt) ||
      !Number.isFinite(payload.expiresAt) ||
      typeof payload.nonce !== 'string' ||
      payload.issuedAt > now + 60_000 ||
      payload.expiresAt <= now ||
      payload.expiresAt - payload.issuedAt > DRAFT_RECOVERY_ACCESS_DURATION_MS
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
