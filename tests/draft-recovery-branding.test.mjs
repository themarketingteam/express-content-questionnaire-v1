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
  const page = await readProjectFile("src/pages/FormDraftRecovery.jsx");
  const expandedPanelIndex = page.indexOf("{expanded && (");
  const pdfManagerIndex = page.indexOf("<DraftPdfManager", expandedPanelIndex);
  const recordEndIndex = page.indexOf("</article>", expandedPanelIndex);

  assert.ok(expandedPanelIndex >= 0, "expanded record panel is present");
  assert.ok(pdfManagerIndex > expandedPanelIndex, "PDF controls render only after a record is expanded");
  assert.ok(pdfManagerIndex < recordEndIndex, "PDF controls remain inside the expanded record");
  assert.match(page, /Resubmit to Zapier/);
  assert.match(page, /AI Repair \+ Retry/);
  assert.match(page, /Copy Endpoint Payload/);
  assert.match(page, /<PayloadEditor/);
  assert.match(page, /<RawDraftDataSection/);
});
