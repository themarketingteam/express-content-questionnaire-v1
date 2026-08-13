import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectUrl = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, projectUrl), "utf8");
}

test("draft recovery and its access gate use the scoped MSP Success brand shell", async () => {
  const [page, gate, styles] = await Promise.all([
    readProjectFile("src/pages/FormDraftRecovery.jsx"),
    readProjectFile("src/components/admin/DraftRecoveryAccessGate.jsx"),
    readProjectFile("src/pages/FormDraftRecovery.css"),
  ]);

  assert.match(page, /draft-recovery-brand draft-recovery-brand-page/);
  assert.match(page, /Admin support workspace/);
  assert.match(page, /Kaseya MSP Success Digital/);
  assert.match(gate, /draft-recovery-brand draft-recovery-gate/);
  assert.match(gate, /Access remains available in this browser for seven days/);

  assert.match(styles, /--msp-blue-900:\s*#0c0c33/);
  assert.match(styles, /--msp-blue-500:\s*#3d3dff/);
  assert.match(styles, /--msp-teal-400:\s*#11f6c8/);
  assert.match(styles, /"Figtree", Arial, sans-serif/);
  assert.match(styles, /"Plus Jakarta Sans", Arial, sans-serif/);
  assert.match(styles, /@media \(max-width: 44rem\)/);
});

test("draft PDF and recovery actions remain inside each expanded record", async () => {
  const [page, payloadEditor] = await Promise.all([
    readProjectFile("src/pages/FormDraftRecovery.jsx"),
    readProjectFile("src/components/admin/PayloadEditor.jsx"),
  ]);
  const expandedPanelIndex = page.indexOf("{expanded && (");
  const pdfManagerIndex = page.indexOf("<DraftPdfManager", expandedPanelIndex);
  const recordEndIndex = page.indexOf("</article>", expandedPanelIndex);
  const actionsIndex = page.indexOf(">Actions</p>", expandedPanelIndex);
  const editDraftIndex = page.indexOf("Edit Draft", actionsIndex);
  const resubmitIndex = page.indexOf("Resubmit to Zapier", actionsIndex);
  const payloadEditorIndex = page.indexOf("<PayloadEditor", actionsIndex);

  assert.ok(expandedPanelIndex >= 0, "expanded record panel is present");
  assert.ok(pdfManagerIndex > expandedPanelIndex, "PDF controls render only after a record is expanded");
  assert.ok(pdfManagerIndex < recordEndIndex, "PDF controls remain inside the expanded record");
  assert.match(page, /Resubmit to Zapier/);
  assert.match(page, /AI Repair \+ Retry/);
  assert.match(page, /Copy Endpoint Payload/);
  assert.ok(actionsIndex >= 0, "Actions section is present");
  assert.ok(editDraftIndex > actionsIndex, "Edit Draft renders inside Actions");
  assert.ok(editDraftIndex < resubmitIndex, "Edit Draft renders left of Resubmit to Zapier");
  assert.ok(payloadEditorIndex > resubmitIndex, "the controlled editor panel remains in the Actions section");
  assert.doesNotMatch(page, /Manual Payload Editor/);
  assert.doesNotMatch(payloadEditor, /Manual Payload Editor/);
  assert.match(payloadEditor, /Save Changes/);
  assert.match(payloadEditor, /Save &amp; Retry Submission/);
  assert.match(page, /<RawDraftDataSection/);
});
