import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("service-role recovery functions authorize before resolving protected records", async () => {
  for (const path of [
    "base44/functions/repairExpressQuestionnaireIntakeSubmission/entry.ts",
    "base44/functions/retryQuestionnaireIntakeSubmission/entry.ts",
    "base44/functions/submitExpressAdminIntake/entry.ts",
  ]) {
    const source = await read(path);
    const handlerStart = source.indexOf("Deno.serve");
    const authorization = source.indexOf("await authorizeRecoveryRequest", handlerStart);
    const protectedLookup = source.indexOf("await base44.asServiceRole", authorization);

    assert.notEqual(authorization, -1, `${path} must authorize recovery access`);
    assert.notEqual(protectedLookup, -1, `${path} must contain a protected lookup`);
    assert.ok(authorization < protectedLookup, `${path} must authorize before service-role data access`);
    assert.doesNotMatch(source, /Intentionally public: this action is part of the password-free recovery page/);
  }
});

test("every recovery UI caller sends its recovery grant", async () => {
  for (const path of [
    "src/pages/FormDraftRecovery.jsx",
    "src/components/admin/PayloadEditor.jsx",
    "src/components/admin/QuestionnaireIntakeRecovery.jsx",
  ]) {
    const source = await read(path);
    const calls = source.match(/base44\.functions\.invoke\("(?:retryQuestionnaireIntakeSubmission|repairExpressQuestionnaireIntakeSubmission)"[\s\S]*?\n\s*\}\);/g) || [];
    assert.ok(calls.length > 0, `${path} must invoke a recovery function`);
    for (const call of calls) assert.match(call, /recoveryGrant/);
  }
});
