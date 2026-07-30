const PUBLIC_DRAFT_RECOVERY_SUFFIX = "/admin/draft-recovery";

export function isPublicDraftRecoveryPath(pathname) {
  const normalizedPath = `/${String(pathname || "")
    .split("/")
    .filter(Boolean)
    .join("/")}`.toLowerCase();

  return normalizedPath.endsWith(PUBLIC_DRAFT_RECOVERY_SUFFIX);
}
