import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hasDurableSubmissionReceipt,
  isFinalSubmissionConfirmed,
  wasSubmissionIntakeCaptured,
} from "../src/lib/submissionReceipt.js";

test("a durable receipt requires an intake or submission id", () => {
  assert.equal(hasDurableSubmissionReceipt({ ok: true }), false);
  assert.equal(hasDurableSubmissionReceipt({ intakeId: "intake-1" }), true);
  assert.equal(hasDurableSubmissionReceipt({ submissionId: "submission-1" }), true);
});

test("intake capture cannot become true merely because submission failed", () => {
  assert.equal(wasSubmissionIntakeCaptured({ ok: false, error: new Error("network") }), false);
  assert.equal(wasSubmissionIntakeCaptured({ receivedViaIntake: true }), true);
  assert.equal(wasSubmissionIntakeCaptured({ intakeId: "intake-1" }), true);
});

test("final success requires both a durable receipt and Zapier acceptance", () => {
  assert.equal(isFinalSubmissionConfirmed({ ok: true, submissionId: "submission-1" }, { ok: false }), false);
  assert.equal(isFinalSubmissionConfirmed({ ok: true }, { ok: true }), false);
  assert.equal(isFinalSubmissionConfirmed({ ok: false, intakeId: "intake-1" }, { ok: true }), false);
  assert.equal(isFinalSubmissionConfirmed({ ok: true, intakeId: "intake-1" }, { ok: true }), true);
});

test("failure UI cannot redirect to the thank-you modal", async () => {
  const source = await readFile(new URL("../src/pages/Questionnaire.jsx", import.meta.url), "utf8");
  const failureCallbackStart = source.indexOf("onFinalSubmitFailure:");
  const catchStart = source.indexOf("} catch (error) {", failureCallbackStart);
  const finallyStart = source.indexOf("} finally {", catchStart);

  assert.notEqual(failureCallbackStart, -1);
  assert.notEqual(catchStart, -1);
  assert.notEqual(finallyStart, -1);
  assert.match(source.slice(failureCallbackStart, catchStart), /setShowThankYouModal\(false\)/);
  assert.doesNotMatch(source.slice(failureCallbackStart, catchStart), /setShowThankYouModal\(true\)/);
  assert.match(source.slice(catchStart, finallyStart), /setShowThankYouModal\(false\)/);
  assert.doesNotMatch(source.slice(catchStart, finallyStart), /setShowThankYouModal\(true\)/);
});

test("submission flow contains no unconditional intake capture", async () => {
  const source = await readFile(new URL("../src/lib/expressQuestionnaireSubmit.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /intakeCaptured\s*=.*\|\|\s*true/);
  assert.match(source, /isFinalSubmissionConfirmed\(submitResult, zapierResult\)/);
});
