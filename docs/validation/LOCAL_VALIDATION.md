# Local validation — November 13, 2026

Both previews are running locally with separate storage and credentials. Neither Git branch has been pushed. No Base44 resource, client record, live webhook, or Zapier workflow was changed. The canonical main checkouts remain clean.

| Preview | Address | Questions |
| --- | --- | --- |
| Pro | http://localhost:5173 | Q3 services; Q4 industries |
| Express | http://localhost:5174 | Q2 services; Q8 industries |

Express preserves its 3–6 service and 1–3 industry limits. Every page counts once, including custom parents. Pro retains its own counting rules and combined limit of 25. Category headings in both pickers are display-only.

## Automated checks

- Pro: 509 tests in 56 files passed; local build passed.
- Express: 199 Node tests passed; full ESLint passed with zero warnings; frontend TypeScript check passed; local build passed.
- Coverage includes legacy compatibility, compact export, raw editor IDs, validation, persistence, submission records, admin/recovery/repair mappings, PDFs, local network isolation, concurrent edits, monotonic save sequences, pagehide envelopes, clear checkpoints, restored versions, and atomic write rollback.
- Cached backend Deno checking still fails on existing baseline diagnostics: 193 in the original Express checkout and 191 here, with no introduced diagnostics. See [the reproducible comparison and release limitation](BACKEND_TYPECHECK.md). Hosted Base44 behavior has not been verified.
- The builds retain the existing large-bundle advisory; it does not fail the local build.

## Browser observations

1. A legacy sample exported its existing arrays and Other fields without organizer structures or a version marker. Viewing the questions did not adopt them.
2. Listed and custom pages entered one organizer. Root/child reassignment and sibling arrow ordering survived reload, including rapid consecutive edits. Dropdown parent choices excluded child pages. Limits disabled additional choices at six services and three industries.
3. Two tabs opened the same draft. A new service in the first tab survived an unrelated goals answer from the older tab. The older tree could not overwrite the newer structure; a separate recovery copy and reload requirement protected the affected organizer.
4. A restored draft submitted immediately after reload without save warnings. Confirmation showed numbered parent/child hierarchy. Both submission routes captured the exact compact payload locally; the actual webhook wire capture contained only metadata and userdata, with no item IDs/catalog IDs or leaf children arrays. A responses PDF downloaded successfully.
5. Explicit clear retained adopted empty structures. The first service/industry edits after clear saved and reloaded successfully.
6. Restoring history created a separate draft with fresh mutation authority while preserving the original draft and its history. A fresh browser copy of organized server data opened without a false recovery warning. Further ordering and reload kept the controls usable and the structure intact.
7. Both preview tabs were retained. The Express tab contains a populated example with six service pages and three industry pages. The existing Pro selections were preserved. The default browser layout had no horizontal overflow.

## Review artifacts

- [Complete synthetic Express wire payload](../examples/full-express-submission-example.json), generated using the actual mapper, integrity checks, and wire builder with network access disabled.
- [Express contract and later integration notes](../EXPRESS_ORGANIZER_CONTRACT.md).
- [Service organizer screenshot](express-services-organizer.jpg).
- [Industry organizer screenshot](express-industries-organizer.jpg).
- [Local submission receipt screenshot](local-submission-captured.jpg).

The local toolbar can inspect/export the current answers, show exact submission captures, and restore historical versions into new drafts. Local drafts/captures are in the ignored `.local-preview/state.json`; they are not included in Git.
