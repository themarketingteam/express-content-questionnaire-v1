import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { getExpressPageTitle } from "../src/lib/pageTitles.js";

test("all application routes use the Express title convention", () => {
  const expectations = new Map([
    ["/", "Express | Website Content Questionnaire"],
    ["/Questionnaire", "Express | Website Content Questionnaire"],
    ["/ThankYou", "Express | Thank You"],
    ["/admin/draft-recovery", "Express | Form Draft Recovery"],
    ["/admin/submit-intake", "Express | Admin Intake Submission"],
    ["/admin/questionnaire-intake-recovery", "Express | Questionnaire Intake Recovery"],
    ["/TestZapier", "Express | Test Submission Tool"],
    ["/Login", "Express | Log In"],
    ["/Register", "Express | Create Account"],
    ["/ForgotPassword", "Express | Forgot Password"],
    ["/ResetPassword", "Express | Reset Password"],
    ["/OAuthConsent", "Express | Authorize Access"],
  ]);

  for (const [pathname, expected] of expectations) {
    assert.equal(getExpressPageTitle(pathname), expected, pathname);
  }
  assert.equal(getExpressPageTitle("/not-a-real-page"), "Express | Page Not Found");
});

test("the shared navigation tracker owns runtime document titles", async () => {
  const [tracker, questionnaire, html] = await Promise.all([
    readFile(new URL("../src/lib/NavigationTracker.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Questionnaire.jsx", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);

  assert.match(tracker, /document\.title = getExpressPageTitle\(location\.pathname\)/);
  assert.doesNotMatch(questionnaire, /document\.title\s*=/);
  assert.match(html, /<title>Express \| Website Content Questionnaire<\/title>/);
});
