export const EXPRESS_TITLE_PREFIX = "Express";

const PAGE_NAMES_BY_PATH = new Map([
  ["/", "Website Content Questionnaire"],
  ["/home", "Home"],
  ["/questionnaire", "Website Content Questionnaire"],
  ["/thankyou", "Thank You"],
  ["/login", "Log In"],
  ["/register", "Create Account"],
  ["/forgotpassword", "Forgot Password"],
  ["/resetpassword", "Reset Password"],
  ["/oauthconsent", "Authorize Access"],
  ["/admin/draft-recovery", "Form Draft Recovery"],
  ["/admin/submit-intake", "Admin Intake Submission"],
  ["/admin/questionnaire-intake-recovery", "Questionnaire Intake Recovery"],
  ["/testzapier", "Test Submission Tool"],
]);

function normalizePathname(pathname) {
  const normalized = `/${String(pathname || "")
    .split("?")[0]
    .split("#")[0]
    .split("/")
    .filter(Boolean)
    .join("/")}`.toLowerCase();
  return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
}

export function getExpressPageName(pathname) {
  return PAGE_NAMES_BY_PATH.get(normalizePathname(pathname)) || "Page Not Found";
}

export function getExpressPageTitle(pathname) {
  return `${EXPRESS_TITLE_PREFIX} | ${getExpressPageName(pathname)}`;
}
