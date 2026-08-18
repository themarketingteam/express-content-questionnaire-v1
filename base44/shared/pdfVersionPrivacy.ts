const SAFE_PDF_VERSION_FIELDS = [
  'id',
  'draft_id',
  'questionnaire_session_id',
  'submission_id',
  'submit_attempt_id',
  'payload_hash',
  'payload_source',
  'source_updated_at',
  'pdf_filename',
  'pdf_byte_size',
  'template_version',
  'version_number',
  'business_name',
  'business_domain',
  'generated_at',
  'created_date',
  'updated_date',
] as const;

export function sanitizePdfVersion(
  version: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!version) return null;
  const safe: Record<string, unknown> = {};
  for (const field of SAFE_PDF_VERSION_FIELDS) {
    if (field in version) safe[field] = version[field];
  }
  safe.storage_available = Boolean(version.s3_object_key || version.pdf_file_uri || version.pdf_file_url);
  safe.storage_visibility = version.s3_object_key || version.pdf_file_uri ? 'private' : 'legacy_public';
  return safe;
}

export function sanitizePdfVersions(
  versions: Array<Record<string, unknown>> | null | undefined,
): Array<Record<string, unknown>> {
  return (versions || [])
    .map(sanitizePdfVersion)
    .filter((version): version is Record<string, unknown> => Boolean(version));
}
