/**
 * Express admin access helper.
 * Centralized admin-only access control for Express questionnaire admin tools.
 */

export const EXPRESS_ADMIN_EMAILS = [
  "benjamin.hines8@gmail.com",
];

export function normalizeAdminEmail(email) {
  if (!email || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

export function isExpressAdminUser(user) {
  try {
    if (!user) return false;
    if (user.role === "admin") return true;
    const normalized = normalizeAdminEmail(user.email);
    return normalized.length > 0 && EXPRESS_ADMIN_EMAILS.includes(normalized);
  } catch {
    return false;
  }
}

export function getAdminAccessDeniedMessage() {
  return "You do not have permission to view Express questionnaire admin tools.";
}

export function getAdminAccessLoadingLabel() {
  return "Checking admin access...";
}