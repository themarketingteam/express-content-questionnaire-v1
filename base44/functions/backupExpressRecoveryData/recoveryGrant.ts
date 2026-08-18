const encoder = new TextEncoder();

export const RECOVERY_GRANT_VERSION = 1;
export const RECOVERY_GRANT_SCOPE = 'draft-recovery';
export const MAX_RECOVERY_GRANT_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export type RecoveryGrantPayload = {
  version: number;
  scope: string;
  issuedAt: number;
  expiresAt: number;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
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
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (left[index] || 0) ^ (right[index] || 0);
  }
  return mismatch === 0;
}

export async function verifyRecoveryPassword(providedPassword: unknown, expectedPassword: string): Promise<boolean> {
  if (typeof providedPassword !== 'string' || !providedPassword || !expectedPassword) return false;
  const [providedDigest, expectedDigest] = await Promise.all([
    digest(providedPassword),
    digest(expectedPassword),
  ]);
  return constantTimeEqual(providedDigest, expectedDigest);
}

export async function createRecoveryGrant(
  secret: string,
  options: {
    nowMs?: number;
    lifetimeSeconds?: number;
    scope?: string;
    version?: number;
  } = {},
): Promise<{ recoveryGrant: string; payload: RecoveryGrantPayload }> {
  if (!secret) throw new Error('Recovery grant signing secret is unavailable.');

  const issuedAt = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const lifetimeSeconds = Math.min(
    Math.max(1, Math.floor(options.lifetimeSeconds ?? MAX_RECOVERY_GRANT_LIFETIME_SECONDS)),
    MAX_RECOVERY_GRANT_LIFETIME_SECONDS,
  );
  const payload: RecoveryGrantPayload = {
    version: options.version ?? RECOVERY_GRANT_VERSION,
    scope: options.scope ?? RECOVERY_GRANT_SCOPE,
    issuedAt,
    expiresAt: issuedAt + lifetimeSeconds,
  };
  const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload)));

  return {
    recoveryGrant: `${encodedPayload}.${bytesToBase64Url(signature)}`,
    payload,
  };
}

export async function issueRecoveryGrant(
  providedPassword: unknown,
  expectedPassword: string,
  options: { nowMs?: number; lifetimeSeconds?: number } = {},
): Promise<{ recoveryGrant: string; payload: RecoveryGrantPayload } | null> {
  if (!await verifyRecoveryPassword(providedPassword, expectedPassword)) return null;
  return createRecoveryGrant(expectedPassword, options);
}

export async function validateRecoveryGrant(
  recoveryGrant: unknown,
  secret: string,
  options: { nowMs?: number } = {},
): Promise<{ valid: true; payload: RecoveryGrantPayload } | { valid: false; error: string }> {
  if (typeof recoveryGrant !== 'string' || !recoveryGrant || !secret) {
    return { valid: false, error: 'Missing recovery grant.' };
  }

  const parts = recoveryGrant.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, error: 'Invalid recovery grant.' };
  }

  try {
    const [encodedPayload, encodedSignature] = parts;
    const key = await importHmacKey(secret);
    const signatureValid = await crypto.subtle.verify(
      'HMAC',
      key,
      ownedBuffer(base64UrlToBytes(encodedSignature)),
      ownedBuffer(encoder.encode(encodedPayload)),
    );
    if (!signatureValid) return { valid: false, error: 'Invalid recovery grant signature.' };

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload))) as RecoveryGrantPayload;
    const now = Math.floor((options.nowMs ?? Date.now()) / 1000);

    if (payload.version !== RECOVERY_GRANT_VERSION) return { valid: false, error: 'Unsupported recovery grant version.' };
    if (payload.scope !== RECOVERY_GRANT_SCOPE) return { valid: false, error: 'Invalid recovery grant scope.' };
    if (!Number.isInteger(payload.issuedAt) || !Number.isInteger(payload.expiresAt)) {
      return { valid: false, error: 'Invalid recovery grant timestamps.' };
    }
    if (payload.issuedAt > now) return { valid: false, error: 'Recovery grant is not active yet.' };
    if (payload.expiresAt <= payload.issuedAt) return { valid: false, error: 'Invalid recovery grant lifetime.' };
    if (payload.expiresAt - payload.issuedAt > MAX_RECOVERY_GRANT_LIFETIME_SECONDS) {
      return { valid: false, error: 'Recovery grant lifetime exceeds the maximum.' };
    }
    if (payload.expiresAt <= now) return { valid: false, error: 'Recovery grant has expired.' };

    return { valid: true, payload };
  } catch {
    return { valid: false, error: 'Invalid recovery grant.' };
  }
}

