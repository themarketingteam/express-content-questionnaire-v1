import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  appendDraftRecoveryAccessHash,
  draftAllowsAccess,
  withoutDraftAccessHashes,
} from "../base44/shared/draftAccess.ts";

const PRIMARY_HASH = "a".repeat(64);
const RECOVERY_HASH = "b".repeat(64);

test("a generated recovery key authorizes the same draft without replacing its primary key", () => {
  const draft = {
    id: "draft-1",
    draft_access_key_hash: PRIMARY_HASH,
    draft_recovery_access_key_hashes: [RECOVERY_HASH],
  };

  assert.equal(draftAllowsAccess(draft, PRIMARY_HASH), true);
  assert.equal(draftAllowsAccess(draft, RECOVERY_HASH), true);
  assert.equal(draftAllowsAccess(draft, "c".repeat(64)), false);
});

test("generated recovery hashes are de-duplicated, bounded, and never exposed to clients", () => {
  const hashes = appendDraftRecoveryAccessHash([PRIMARY_HASH, PRIMARY_HASH], RECOVERY_HASH, 2);
  assert.deepEqual(hashes, [PRIMARY_HASH, RECOVERY_HASH]);

  const safe = withoutDraftAccessHashes({
    id: "draft-1",
    session_id: "session_12345678901234567890",
    draft_access_key_hash: PRIMARY_HASH,
    draft_recovery_access_key_hashes: hashes,
  });
  assert.deepEqual(safe, { id: "draft-1", session_id: "session_12345678901234567890" });
});

test("admin action and questionnaire load are wired to the secondary recovery key", async () => {
  const [adminSource, draftSource, pageSource] = await Promise.all([
    readFile(new URL("../base44/functions/draftRecoveryData/entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../base44/functions/questionnaireDraftData/entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/FormDraftRecovery.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(adminSource, /case 'createDraftRecoveryLink'/);
  assert.match(adminSource, /draft_recovery_access_key_hashes/);
  assert.match(draftSource, /draftAllowsAccess\(existing, accessKeyHash\)/);
  assert.match(pageSource, /Copy Draft Link/);
  assert.match(pageSource, /#?draftRecoveryData/);
  const actionsMarkup = pageSource.slice(
    pageSource.indexOf('<p className="brand-action-label">Actions</p>'),
    pageSource.indexOf('<p className="brand-action-label">AI Actions</p>'),
  );
  assert.ok(
    actionsMarkup.indexOf("Copy Draft Link") < actionsMarkup.indexOf("Edit Draft"),
    "Copy Draft Link should be the first action, before Edit Draft",
  );
});
