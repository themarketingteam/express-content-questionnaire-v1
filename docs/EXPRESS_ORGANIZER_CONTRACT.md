# Express page organization contract

This implementation is local and unpushed. The hosted application and Zapier have not been changed.

## Submission shape

The complete synthetic example is [examples/full-express-submission-example.json](examples/full-express-submission-example.json). It is produced by the real Express mapper, integrity checks, and outbound wire builder; it is not a separately maintained mock contract.

Existing `metadata` and `userdata` fields remain. Questions 2 and 8 independently gain `service_offerings_structure` and `target_industries_structure` when edited or explicitly organized. Each structure has `format: "page-tree-v1"` and a `pages` array. A node contains `label`, `source` (`predefined` or `custom`), and, for parents with children, a `children` array. Children cannot contain children. Array position is priority, starting again within each parent. Editor IDs and catalog IDs are not exported.

`metadata.questionnaire_payload_version` is `2` when either question has an organization structure. A legacy submission has neither the marker nor invented structures. Opening a saved questionnaire does not convert it. The `format` marker identifies the tree contract; the metadata version identifies the overall submission variant.

The original predefined arrays and scalar Other fields remain as compatibility projections. A custom label containing commas is unambiguous in the tree; new consumers should read the tree rather than split the scalar Other field. Legacy combined industry choices remain intact until the client changes them. Category headings are display aids and never become selected pages automatically.

## Limits and persistence

Express retains 3–6 service pages and 1–3 industry pages. Every selected page counts once, regardless of source, root/child position, or whether it has children. Drafts can be incomplete; final submission enforces the limits.

Raw drafts keep stable editor IDs. Raw answers, compact projections, persisted records, recovery data, admin intake, retries, and PDF/confirmation displays preserve the organization. Invalid trees, lost adopted structures, inconsistent mapped payloads, and stale revisions fail rather than silently flattening saved data. Conflicting browser organization is archived separately for download while the current server organization is loaded. Explicit clearing retains empty adopted trees.

## Local review and later integration

Run both previews using the launcher in the Pro worktree, or start each with `npm run local:start`. Express uses port 5174 and its own `.local-preview/state.json`; Pro uses port 5173. The Express toolbar inspects the current mapped payload, exports JSON, restores historical versions into separate drafts, and shows exact local submission captures.

After local approval, a separate release can deploy the resource changes and test a duplicate Zapier workflow. That workflow can branch on `metadata.questionnaire_payload_version === 2`, use each available structure, and fall back to that question’s legacy fields when a structure is absent. The running Zap has not been edited or contacted.
