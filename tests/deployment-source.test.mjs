import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeGitRemote,
  validateDeploymentIdentity,
} from "../scripts/verify-deploy-source.mjs";

const expected = {
  base44AppId: "6913611c0ea0f6b631343af8",
  canonicalOrigin: "https://github.com/themarketingteam/express-content-questionnaire-v1.git",
  deploymentBranch: "main",
};

const valid = {
  appId: expected.base44AppId,
  origin: expected.canonicalOrigin,
  dirty: false,
  branch: "main",
  head: "abc123",
  remoteHead: "abc123",
};

test("normalizes HTTPS and SSH GitHub remotes to the same repository", () => {
  assert.equal(
    normalizeGitRemote("git@github.com:themarketingteam/express-content-questionnaire-v1.git"),
    normalizeGitRemote(expected.canonicalOrigin),
  );
});

test("accepts only the canonical app, origin, clean branch, and published commit", () => {
  assert.deepEqual(validateDeploymentIdentity(valid, expected), []);
  assert.match(validateDeploymentIdentity({ ...valid, appId: "wrong" }, expected).join(" "), /app mismatch/i);
  assert.match(validateDeploymentIdentity({ ...valid, origin: "https://github.com/example/express-content-questionnaire-v1.git" }, expected).join(" "), /origin mismatch/i);
  assert.match(validateDeploymentIdentity({ ...valid, dirty: true }, expected).join(" "), /working tree is dirty/i);
  assert.match(validateDeploymentIdentity({ ...valid, branch: "feature" }, expected).join(" "), /must run from main/i);
  assert.match(validateDeploymentIdentity({ ...valid, head: "local-only" }, expected).join(" "), /not the exact github/i);
});

test("identity-only checks support CI and local diagnostics without authorizing deployment", () => {
  assert.deepEqual(
    validateDeploymentIdentity({ ...valid, dirty: true, branch: "feature", remoteHead: "different" }, expected, { requireReleaseState: false }),
    [],
  );
});
