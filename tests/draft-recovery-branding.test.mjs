import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectUrl = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, projectUrl), "utf8");
}

test("admin tools and their shared access gate use the scoped MSP Success brand shell", async () => {
  const [page, intake, menu, gate, styles, intakeStyles] = await Promise.all([
    readProjectFile("src/pages/FormDraftRecovery.jsx"),
    readProjectFile("src/pages/AdminSubmitIntake.jsx"),
    readProjectFile("src/components/admin/AdminFloatingMenu.jsx"),
    readProjectFile("src/components/admin/DraftRecoveryAccessGate.jsx"),
    readProjectFile("src/pages/FormDraftRecovery.css"),
    readProjectFile("src/pages/AdminSubmitIntake.css"),
  ]);

  assert.match(page, /draft-recovery-brand draft-recovery-brand-page/);
  assert.match(page, /Admin support workspace/);
  assert.match(page, /<h1><span className="draft-recovery-brand__product-name">Express<\/span> \| Form Draft Recovery<\/h1>/);
  assert.match(page, /Kaseya MSP Success Digital/);
  assert.match(page, /<AdminFloatingMenu currentPage="draft-recovery" \/>/);
  assert.match(intake, /draft-recovery-brand draft-recovery-brand-page admin-submit-intake-page/);
  assert.match(intake, /Admin support workspace/);
  assert.match(intake, /<h1><span className="draft-recovery-brand__product-name">Express<\/span> \| Admin Intake Submission<\/h1>/);
  assert.match(intake, /Kaseya MSP Success Digital/);
  assert.match(intake, /<AdminFloatingMenu currentPage="submit-intake" \/>/);
  assert.match(intake, /brand-section-header/);
  assert.match(intake, /brand-button-primary/);
  assert.match(gate, /draft-recovery-brand draft-recovery-gate/);
  assert.match(gate, /Admin Workspace Access/);
  assert.match(gate, /Access remains available in this browser for seven days/);
  assert.match(menu, /Pro Form Recovery/);
  assert.match(menu, /import \{ ExternalLink, FileInput, History \} from "lucide-react"/);
  assert.match(menu, /<ExternalLink aria-hidden="true" \/>[\s\S]*?Pro Form Recovery/);
  assert.match(menu, /<InternalLinkIcon aria-hidden="true" \/>[\s\S]*?\{internalLink\.label\}/);
  assert.match(menu, /https:\/\/proform\.tmtwebsiteresources\.xyz\/admin\/draft-recovery/);
  assert.match(menu, /target="_blank"/);
  assert.match(menu, /rel="noopener noreferrer"/);
  assert.match(menu, /Submit Intake \(JSON\)/);
  assert.match(menu, /to: "\/admin\/submit-intake"/);
  assert.match(menu, /label: "Draft Recovery", to: "\/admin\/draft-recovery"/);
  assert.match(menu, /aria-expanded=\{isOpen\}/);
  assert.match(menu, /event\.key === "Escape"/);

  assert.match(styles, /--msp-blue-900:\s*#0c0c33/);
  assert.match(styles, /--msp-blue-500:\s*#3d3dff/);
  assert.match(styles, /--msp-teal-400:\s*#11f6c8/);
  assert.match(styles, /--msp-express-accent:\s*#d8c9ae/);
  assert.match(styles, /\.draft-recovery-brand__eyebrow\s*\{[\s\S]*?color:\s*var\(--msp-express-accent\)/);
  assert.match(styles, /\.draft-recovery-brand__product-name\s*\{[\s\S]*?color:\s*var\(--msp-express-accent\)/);
  assert.match(page, /submitted:\s*"brand-status-badge--submitted"/);
  assert.match(styles, /\.brand-status-badge--submitted\s*\{[\s\S]*?background:\s*rgba\(216,\s*201,\s*174,\s*0\.75\);[\s\S]*?color:\s*var\(--msp-blue-900\);/);
  assert.match(styles, /"Figtree", Arial, sans-serif/);
  assert.match(styles, /"Plus Jakarta Sans", Arial, sans-serif/);
  assert.match(styles, /\.admin-floating-menu\s*\{[\s\S]*position:\s*fixed/);
  assert.match(styles, /\.admin-floating-menu__trigger\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(styles, /\.admin-floating-menu__line:nth-child\(1\)\s*\{[\s\S]*?align-self:\s*flex-start/);
  assert.match(styles, /\.admin-floating-menu__line:nth-child\(3\)\s*\{[\s\S]*?align-self:\s*flex-end/);
  assert.match(styles, /\.admin-floating-menu__trigger:not\(\.is-open\):hover[\s\S]*?width:\s*100%/);
  assert.match(styles, /\.admin-floating-menu__links\.is-open/);
  assert.match(styles, /\.admin-floating-menu__link svg\s*\{[\s\S]*?width:\s*0\.95rem/);
  assert.match(page, /className="brand-json-panel__source"/);
  assert.match(page, /className="brand-json-panel__warning"/);
  assert.match(styles, /\.brand-json-panel__meta\s*\{[\s\S]*?font-size:\s*0\.78rem;[\s\S]*?line-height:\s*1\.55;/);
  assert.match(styles, /\.brand-json-panel__source\s*\{[\s\S]*?color:\s*#dedfff;/);
  assert.match(styles, /\.brand-json-panel__warning\s*\{[\s\S]*?color:\s*#ffd166;[\s\S]*?font-weight:\s*500;/);
  assert.match(styles, /@media \(max-width: 44rem\)/);
  assert.match(styles, /@media \(max-width: 44rem\)[\s\S]*?\.draft-recovery-brand__hero\s*\{[\s\S]*?padding-top:\s*4rem/);
  assert.match(intakeStyles, /admin-submit-intake__json-shell/);
  assert.match(intakeStyles, /var\(--msp-blue-900\)/);
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
  const retryIndex = page.indexOf("Retry Submission", actionsIndex);
  const payloadEditorIndex = page.indexOf("<PayloadEditor", actionsIndex);

  assert.ok(expandedPanelIndex >= 0, "expanded record panel is present");
  assert.ok(pdfManagerIndex > expandedPanelIndex, "PDF controls render only after a record is expanded");
  assert.ok(pdfManagerIndex < recordEndIndex, "PDF controls remain inside the expanded record");
  assert.match(page, /^\s+Retry Submission$/m);
  assert.match(page, /^\s+Diagnose$/m);
  assert.match(page, /^\s+Repair Only$/m);
  assert.match(page, /^\s+Repair \+ Retry$/m);
  assert.match(page, /^\s+<Copy[^\n]+\/> Endpoint Payload$/m);
  assert.match(page, /^\s+<Copy[^\n]+\/> Raw Draft$/m);
  assert.doesNotMatch(page, /^\s+Resubmit to Zapier$/m);
  assert.doesNotMatch(page, /^\s+AI Diagnose$/m);
  assert.doesNotMatch(page, /^\s+AI Repair Only$/m);
  assert.doesNotMatch(page, /^\s+AI Repair \+ Retry$/m);
  assert.doesNotMatch(page, /^\s+<Copy[^\n]+\/> Copy Endpoint Payload$/m);
  assert.doesNotMatch(page, /^\s+<Copy[^\n]+\/> Copy Raw Draft Data$/m);
  assert.ok(actionsIndex >= 0, "Actions section is present");
  assert.ok(editDraftIndex > actionsIndex, "Edit Draft renders inside Actions");
  assert.ok(editDraftIndex < retryIndex, "Edit Draft renders left of Retry Submission");
  assert.ok(payloadEditorIndex > retryIndex, "the controlled editor panel remains in the Actions section");
  assert.doesNotMatch(page, /Manual Payload Editor/);
  assert.doesNotMatch(payloadEditor, /Manual Payload Editor/);
  assert.match(payloadEditor, /Save Changes/);
  assert.match(payloadEditor, /Save &amp; Retry Submission/);
  assert.match(page, /<RawDraftDataSection/);
});
