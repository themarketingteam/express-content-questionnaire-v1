import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isAdminSubmitIntakePath,
  isPasswordProtectedAdminPath,
  isPublicDraftRecoveryPath,
} from "../src/lib/publicRoutes.js";
import {
  DRAFT_RECOVERY_STORAGE_KEY,
  readSavedRecoveryGrant,
  revalidateSavedRecoveryGrant,
  saveRecoveryGrant,
} from "../src/lib/draftRecoveryAccess.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("both admin routes use the same password-protected route boundary", async () => {
  assert.equal(isPublicDraftRecoveryPath("/admin/draft-recovery"), true);
  assert.equal(isAdminSubmitIntakePath("/admin/submit-intake"), true);
  assert.equal(isPasswordProtectedAdminPath("/admin/draft-recovery"), true);
  assert.equal(isPasswordProtectedAdminPath("/ADMIN/SUBMIT-INTAKE/"), true);
  assert.equal(isPasswordProtectedAdminPath("/Questionnaire"), false);

  const app = await read("src/App.jsx");
  const protectedBoundary = app.indexOf("if (isPasswordProtectedAdminPath(location.pathname))");
  const provider = app.indexOf("<DraftRecoveryAccessProvider>", protectedBoundary);
  const gate = app.indexOf("<DraftRecoveryAccessGate>", provider);
  const intake = app.indexOf("isSubmitIntake ? <AdminSubmitIntake /> : <FormDraftRecovery />", gate);
  assert.ok(protectedBoundary >= 0);
  assert.ok(provider > protectedBoundary);
  assert.ok(gate > provider);
  assert.ok(intake > gate);
  assert.doesNotMatch(app, /<AdminOnly>[\s\S]{0,180}<AdminSubmitIntake/);
});

test("one saved seven-day grant is reusable across either admin route", async () => {
  const storage = memoryStorage();
  const grant = { recoveryGrant: "signed-admin-grant", expiresAt: 2_000_000_000 };
  saveRecoveryGrant(storage, grant);

  assert.equal(DRAFT_RECOVERY_STORAGE_KEY, "express_draft_recovery_access_v1");
  assert.deepEqual(readSavedRecoveryGrant(storage, 1_900_000_000_000), grant);

  let verifiedGrant = "";
  const revalidated = await revalidateSavedRecoveryGrant({
    storage,
    nowMs: 1_900_000_000_000,
    verifyGrant: async (value) => {
      verifiedGrant = value;
      return { valid: true, ...grant };
    },
  });
  assert.equal(verifiedGrant, grant.recoveryGrant);
  assert.deepEqual(revalidated, grant);
});

test("password-only submit intake writes through an authorized backend function", async () => {
  const [page, backend] = await Promise.all([
    read("src/pages/AdminSubmitIntake.jsx"),
    read("base44/functions/submitExpressAdminIntake/entry.ts"),
  ]);

  assert.match(page, /functions\.invoke\("submitExpressAdminIntake"/);
  assert.match(page, /payload: repairedPayload,[\s\S]*recoveryGrant/);
  assert.doesNotMatch(page, /entities\.FormSubmission\.(?:create|update)/);

  const authorization = backend.indexOf("await authorizeRecoveryRequest");
  const create = backend.indexOf("asServiceRole.entities.FormSubmission.create", authorization);
  assert.ok(authorization >= 0, "backend authorization is present");
  assert.ok(create > authorization, "service-role create happens only after authorization");
  assert.match(backend, /normalizePayload\(body\.payload\)/);
  assert.match(backend, /transformed_payload_json: JSON\.stringify\(payload\)/);
  assert.match(backend, /EXPRESS_ZAPIER_WEBHOOK_URL/);
  assert.match(backend, /zapier_delivery_status: zapier\.sent \? 'sent' : 'failed'/);
});
