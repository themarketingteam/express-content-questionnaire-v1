const DRAFT_RECOVERY_SUFFIX = "/admin/draft-recovery";
const ADMIN_SUBMIT_INTAKE_SUFFIX = "/admin/submit-intake";

function normalizePath(pathname) {
  return `/${String(pathname || "")
    .split("/")
    .filter(Boolean)
    .join("/")}`.toLowerCase();
}

export function isPublicDraftRecoveryPath(pathname) {
  return normalizePath(pathname).endsWith(DRAFT_RECOVERY_SUFFIX);
}

export function isAdminSubmitIntakePath(pathname) {
  return normalizePath(pathname).endsWith(ADMIN_SUBMIT_INTAKE_SUFFIX);
}

export function isPasswordProtectedAdminPath(pathname) {
  return isPublicDraftRecoveryPath(pathname) || isAdminSubmitIntakePath(pathname);
}
