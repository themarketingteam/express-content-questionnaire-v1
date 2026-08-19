const encoder = new TextEncoder();

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type PrivateS3Config = {
  bucket: string;
  region: string;
  kmsKeyId: string;
  prefix?: string;
  credentials: AwsCredentials;
};

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return bytesToHex(await crypto.subtle.digest('SHA-256', ownedBuffer(bytes)));
}

async function hmac(key: ArrayBuffer | Uint8Array, value: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    'raw',
    ownedBuffer(key instanceof Uint8Array ? key : new Uint8Array(key)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return await crypto.subtle.sign('HMAC', imported, encoder.encode(value));
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  return bytesToHex(await hmac(encoder.encode(secret), value));
}

function amzDate(date: Date): { full: string; short: string } {
  const full = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { full, short: full.slice(0, 8) };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(key: string): string {
  return `/${key.split('/').map(encodePathSegment).join('/')}`;
}

function canonicalQuery(params: URLSearchParams): string {
  return Array.from(params.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${encodePathSegment(key)}=${encodePathSegment(value)}`)
    .join('&');
}

export function normalizePrivateS3Prefix(value: string | undefined): string {
  const normalized = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  if (normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('The private S3 prefix is invalid.');
  }
  return normalized;
}

export function resolvePrivateS3ObjectKey(config: PrivateS3Config, key: string): string {
  const normalizedKey = String(key || '').replace(/^\/+/, '');
  if (!normalizedKey || normalizedKey.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('The private S3 object key is invalid.');
  }
  const prefix = normalizePrivateS3Prefix(config.prefix);
  return prefix ? `${prefix}/${normalizedKey}` : normalizedKey;
}

function endpoint(config: PrivateS3Config, key = ''): URL {
  const host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
  return new URL(`https://${host}${key ? canonicalPath(resolvePrivateS3ObjectKey(config, key)) : '/'}`);
}

async function signingKey(secret: string, shortDate: string, region: string): Promise<ArrayBuffer> {
  const dateKey = await hmac(encoder.encode(`AWS4${secret}`), shortDate);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, 's3');
  return await hmac(serviceKey, 'aws4_request');
}

async function signedHeaders({
  config,
  method,
  url,
  payloadHash,
  additionalHeaders = {},
  now = new Date(),
}: {
  config: PrivateS3Config;
  method: string;
  url: URL;
  payloadHash: string;
  additionalHeaders?: Record<string, string>;
  now?: Date;
}): Promise<Headers> {
  const timestamp = amzDate(now);
  const normalized = new Map<string, string>();
  normalized.set('host', url.host);
  normalized.set('x-amz-content-sha256', payloadHash);
  normalized.set('x-amz-date', timestamp.full);
  if (config.credentials.sessionToken) normalized.set('x-amz-security-token', config.credentials.sessionToken);
  Object.entries(additionalHeaders).forEach(([key, value]) => normalized.set(key.toLowerCase(), value.trim()));

  const sorted = Array.from(normalized.entries()).sort(([left], [right]) => left.localeCompare(right));
  const signedHeaderNames = sorted.map(([key]) => key).join(';');
  const canonicalHeaders = `${sorted.map(([key, value]) => `${key}:${value.replace(/\s+/g, ' ')}`).join('\n')}\n`;
  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname,
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join('\n');
  const scope = `${timestamp.short}/${config.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${timestamp.full}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
  const signature = bytesToHex(await hmac(
    await signingKey(config.credentials.secretAccessKey, timestamp.short, config.region),
    stringToSign,
  ));
  const headers = new Headers(additionalHeaders);
  headers.set('x-amz-content-sha256', payloadHash);
  headers.set('x-amz-date', timestamp.full);
  if (config.credentials.sessionToken) headers.set('x-amz-security-token', config.credentials.sessionToken);
  headers.set(
    'authorization',
    `AWS4-HMAC-SHA256 Credential=${config.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
  );
  return headers;
}

export function validatePrivateS3Config(config: Partial<PrivateS3Config> | null | undefined): string[] {
  const missing: string[] = [];
  if (!config?.bucket) missing.push('bucket');
  if (!config?.region) missing.push('region');
  if (!config?.kmsKeyId) missing.push('kmsKeyId');
  if (!config?.credentials?.accessKeyId) missing.push('accessKeyId');
  if (!config?.credentials?.secretAccessKey) missing.push('secretAccessKey');
  return missing;
}

export async function privacySafeObjectKey(entityName: string, recordId: string): Promise<string> {
  const entityHash = await sha256Hex(`entity:${entityName}`);
  const recordHash = await sha256Hex(`record:${entityName}:${recordId}`);
  return `records/v1/${entityHash.slice(0, 16)}/${recordHash.slice(0, 2)}/${recordHash}.json`;
}

export async function putPrivateObject({
  config,
  key,
  body,
  contentType = 'application/json',
  metadata = {},
}: {
  config: PrivateS3Config;
  key: string;
  body: Uint8Array;
  contentType?: string;
  metadata?: Record<string, string>;
}): Promise<{ versionId: string; etag: string }> {
  const url = endpoint(config, key);
  const additionalHeaders: Record<string, string> = {
    'content-type': contentType,
    'x-amz-server-side-encryption': 'aws:kms',
    'x-amz-server-side-encryption-aws-kms-key-id': config.kmsKeyId,
  };
  Object.entries(metadata).forEach(([name, value]) => {
    additionalHeaders[`x-amz-meta-${name.toLowerCase()}`] = value.slice(0, 1_000);
  });
  const headers = await signedHeaders({
    config,
    method: 'PUT',
    url,
    payloadHash: await sha256Hex(body),
    additionalHeaders,
  });
  const response = await fetch(url, { method: 'PUT', headers, body: ownedBuffer(body) });
  if (!response.ok) throw new Error(`Private backup upload failed with HTTP ${response.status}.`);
  return {
    versionId: response.headers.get('x-amz-version-id') || '',
    etag: (response.headers.get('etag') || '').replaceAll('"', ''),
  };
}

export async function getPrivateObject(config: PrivateS3Config, key: string, versionId = ''): Promise<Response> {
  const url = endpoint(config, key);
  if (versionId) url.searchParams.set('versionId', versionId);
  const headers = await signedHeaders({
    config,
    method: 'GET',
    url,
    payloadHash: await sha256Hex(new Uint8Array()),
  });
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Private backup read failed with HTTP ${response.status}.`);
  return response;
}

export async function presignPrivateObjectGet(
  config: PrivateS3Config,
  key: string,
  expiresInSeconds = 120,
  versionId = '',
): Promise<string> {
  const expires = Math.max(30, Math.min(900, Math.round(expiresInSeconds)));
  const url = endpoint(config, key);
  const timestamp = amzDate(new Date());
  const scope = `${timestamp.short}/${config.region}/s3/aws4_request`;
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${config.credentials.accessKeyId}/${scope}`);
  url.searchParams.set('X-Amz-Date', timestamp.full);
  url.searchParams.set('X-Amz-Expires', String(expires));
  url.searchParams.set('X-Amz-SignedHeaders', 'host');
  if (config.credentials.sessionToken) url.searchParams.set('X-Amz-Security-Token', config.credentials.sessionToken);
  if (versionId) url.searchParams.set('versionId', versionId);
  const canonicalRequest = [
    'GET',
    url.pathname,
    canonicalQuery(url.searchParams),
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = `AWS4-HMAC-SHA256\n${timestamp.full}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
  const signature = bytesToHex(await hmac(
    await signingKey(config.credentials.secretAccessKey, timestamp.short, config.region),
    stringToSign,
  ));
  url.searchParams.set('X-Amz-Signature', signature);
  return url.toString();
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]) : '';
}

export async function listObjectVersions(config: PrivateS3Config, key: string): Promise<Array<{ key: string; versionId: string }>> {
  const versions: Array<{ key: string; versionId: string }> = [];
  let keyMarker = '';
  let versionMarker = '';
  do {
    const url = endpoint(config);
    url.searchParams.set('versions', '');
    url.searchParams.set('prefix', key);
    if (keyMarker) url.searchParams.set('key-marker', keyMarker);
    if (versionMarker) url.searchParams.set('version-id-marker', versionMarker);
    const headers = await signedHeaders({
      config,
      method: 'GET',
      url,
      payloadHash: await sha256Hex(new Uint8Array()),
    });
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Private backup version listing failed with HTTP ${response.status}.`);
    const xml = await response.text();
    for (const match of xml.matchAll(/<(?:Version|DeleteMarker)>([\s\S]*?)<\/(?:Version|DeleteMarker)>/g)) {
      const foundKey = tag(match[1], 'Key');
      const versionId = tag(match[1], 'VersionId');
      if (foundKey === key && versionId) versions.push({ key: foundKey, versionId });
    }
    const truncated = tag(xml, 'IsTruncated') === 'true';
    keyMarker = truncated ? tag(xml, 'NextKeyMarker') : '';
    versionMarker = truncated ? tag(xml, 'NextVersionIdMarker') : '';
  } while (keyMarker || versionMarker);
  return versions;
}

export async function purgeAllObjectVersions(config: PrivateS3Config, key: string): Promise<number> {
  const versions = await listObjectVersions(config, key);
  for (const version of versions) {
    const url = endpoint(config, version.key);
    url.searchParams.set('versionId', version.versionId);
    const headers = await signedHeaders({
      config,
      method: 'DELETE',
      url,
      payloadHash: await sha256Hex(new Uint8Array()),
    });
    const response = await fetch(url, { method: 'DELETE', headers });
    if (!response.ok) throw new Error(`Private backup version purge failed with HTTP ${response.status}.`);
  }
  return versions.length;
}
