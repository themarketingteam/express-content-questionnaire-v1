import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  appendDraftRecoveryAccessHash,
  draftAllowsAccess,
  withoutDraftAccessHashes,
} from "../base44/shared/draftAccess.ts";
import { copyTextToClipboard } from "../src/lib/clipboard.js";

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
  assert.match(pageSource, />Draft Link</);
  assert.match(pageSource, /className="brand-draft-link__value"/);
  assert.match(pageSource, /requestDraftRecoveryLink\(\)\.catch/);
  assert.match(pageSource, /const link = draftRecoveryLink \|\| await requestDraftRecoveryLink\(\)/);
  assert.match(pageSource, /await copyTextToClipboard\(link\)/);
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

test("clipboard helper copies the complete recovery URL with the modern API", async () => {
  const writes = [];
  const recoveryUrl = "https://expressform.tmtwebsiteresources.xyz/#draft=f23f4508-7516-4b1b-81e5-14e0d3d43b05&key=secure_recovery_key_12345678901234567890";

  await copyTextToClipboard(recoveryUrl, {
    navigatorObject: {
      clipboard: {
        writeText: async (value) => writes.push(value),
      },
    },
  });

  assert.deepEqual(writes, [recoveryUrl]);
});

test("clipboard helper falls back to a selected textarea when the modern API is denied", async () => {
  let selectedValue = "";
  let removed = false;
  const textarea = {
    value: "",
    style: {},
    setAttribute() {},
    focus() {},
    select() { selectedValue = this.value; },
    setSelectionRange() {},
    remove() { removed = true; },
  };
  const recoveryUrl = "https://expressform.tmtwebsiteresources.xyz/#draft=f23f4508-7516-4b1b-81e5-14e0d3d43b05&key=secure_recovery_key_12345678901234567890";

  await copyTextToClipboard(recoveryUrl, {
    navigatorObject: {
      clipboard: {
        writeText: async () => { throw new Error("NotAllowedError"); },
      },
    },
    documentObject: {
      activeElement: null,
      body: { appendChild() {} },
      createElement: () => textarea,
      execCommand: (command) => command === "copy",
    },
  });

  assert.equal(selectedValue, recoveryUrl);
  assert.equal(removed, true);
});
