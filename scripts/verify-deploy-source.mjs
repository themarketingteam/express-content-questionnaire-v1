import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function normalizeGitRemote(value) {
  return String(value || "")
    .trim()
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/")
    .replace(/\.git\/?$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function validateDeploymentIdentity(actual, expected, { requireReleaseState = true } = {}) {
  const errors = [];

  if (actual.appId !== expected.base44AppId) {
    errors.push(`Base44 app mismatch: expected ${expected.base44AppId}, received ${actual.appId || "none"}.`);
  }
  if (normalizeGitRemote(actual.origin) !== normalizeGitRemote(expected.canonicalOrigin)) {
    errors.push(`Git origin mismatch: expected ${expected.canonicalOrigin}, received ${actual.origin || "none"}.`);
  }

  if (requireReleaseState) {
    if (actual.dirty) errors.push("The working tree is dirty. Commit every deployable change first.");
    if (actual.branch !== expected.deploymentBranch) {
      errors.push(`Deployments must run from ${expected.deploymentBranch}, not ${actual.branch || "detached HEAD"}.`);
    }
    if (!actual.remoteHead || actual.head !== actual.remoteHead) {
      errors.push(`Local HEAD ${actual.head || "unknown"} is not the exact GitHub ${expected.deploymentBranch} commit ${actual.remoteHead || "unknown"}.`);
    }
  }

  return errors;
}

function runGit(args, cwd, { optional = false } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (optional) return "";
    throw error;
  }
}

function readBase44AppId(repoRoot) {
  const appConfigPath = path.join(repoRoot, "base44", ".app.jsonc");
  if (!existsSync(appConfigPath)) return "";
  const match = readFileSync(appConfigPath, "utf8").match(/"id"\s*:\s*"([^"]+)"/);
  return match?.[1] || "";
}

export function inspectDeploymentSource(cwd, { queryRemote = true } = {}) {
  const repoRoot = runGit(["rev-parse", "--show-toplevel"], cwd);
  const expectedPath = path.join(repoRoot, ".base44-deployment-source.json");
  if (!existsSync(expectedPath)) {
    throw new Error(`Missing deployment source manifest: ${expectedPath}`);
  }
  const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
  const branch = runGit(["branch", "--show-current"], repoRoot, { optional: true });
  const remoteHead = queryRemote
    ? runGit(["ls-remote", "--exit-code", "origin", `refs/heads/${expected.deploymentBranch}`], repoRoot, { optional: true }).split(/\s+/)[0] || ""
    : runGit(["rev-parse", `refs/remotes/origin/${expected.deploymentBranch}`], repoRoot, { optional: true });

  return {
    repoRoot,
    expected,
    actual: {
      appId: readBase44AppId(repoRoot),
      origin: runGit(["remote", "get-url", "origin"], repoRoot, { optional: true }),
      branch,
      dirty: Boolean(runGit(["status", "--porcelain"], repoRoot, { optional: true })),
      head: runGit(["rev-parse", "HEAD"], repoRoot, { optional: true }),
      remoteHead,
    },
  };
}

function main() {
  const requireReleaseState = !process.argv.includes("--identity-only");
  const { repoRoot, actual, expected } = inspectDeploymentSource(process.cwd(), {
    queryRemote: requireReleaseState,
  });
  const errors = validateDeploymentIdentity(actual, expected, { requireReleaseState });
  if (errors.length) {
    console.error("Base44 deployment source verification failed:\n");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Verified Base44 deployment source: ${repoRoot}`);
  console.log(`App: ${actual.appId}`);
  console.log(`Origin: ${actual.origin}`);
  if (requireReleaseState) console.log(`Release commit: ${actual.head}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
