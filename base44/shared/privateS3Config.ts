import { secrets } from 'base44:runtime';
import type { PrivateS3Config } from './privateS3.ts';
import { validatePrivateS3Config } from './privateS3.ts';

export type PrivateS3Role = 'writer' | 'purge';

function secret(name: string): string {
  try { return (secrets.get(name) || '').trim(); } catch { return ''; }
}

export function loadPrivateS3Config(role: PrivateS3Role): {
  configured: boolean;
  config: PrivateS3Config;
  missing: string[];
} {
  const prefix = role === 'writer' ? 'EXPRESS_BACKUP_AWS' : 'EXPRESS_PURGE_AWS';
  const config: PrivateS3Config = {
    bucket: secret('EXPRESS_BACKUP_S3_BUCKET'),
    region: secret('EXPRESS_BACKUP_AWS_REGION') || 'us-east-1',
    kmsKeyId: secret('EXPRESS_BACKUP_KMS_KEY_ID'),
    credentials: {
      accessKeyId: secret(`${prefix}_ACCESS_KEY_ID`),
      secretAccessKey: secret(`${prefix}_SECRET_ACCESS_KEY`),
      sessionToken: secret(`${prefix}_SESSION_TOKEN`) || undefined,
    },
  };
  const missing = validatePrivateS3Config(config);
  return { configured: missing.length === 0, config, missing };
}

export function loadManifestSigningKey(): string {
  return secret('EXPRESS_BACKUP_MANIFEST_SIGNING_KEY');
}
