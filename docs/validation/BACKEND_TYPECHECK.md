# Backend validation

On November 14, 2026, the release audit's cached Deno check passes with **zero diagnostics** for all nine critical Express backend files below, including their shared imports. The earlier local implementation had 191 diagnostics, compared with 193 in the unchanged `28e8729` baseline. Those remaining diagnostics have now been corrected rather than waived.

The corrections declare the dynamic legacy JSON boundaries, repair context and change records, optional intake fields, and Base44 client types. Unknown thrown values are narrowed before reading error properties. AI provider output must parse to an object. Runtime structure and raw-answer validation remain required; the JSON record types do not replace those checks. No `@ts-nocheck`, blanket diagnostic suppression, or relaxed compiler configuration was added.

Run from the Express organizer checkout:

```bash
deno check --cached-only --no-config \
  base44/functions/autoRepairRetryIntake/entry.ts \
  base44/functions/draftRecoveryData/entry.ts \
  base44/functions/questionnaireDraftData/entry.ts \
  base44/functions/repairExpressQuestionnaireIntakeSubmission/entry.ts \
  base44/functions/retryQuestionnaireIntakeSubmission/entry.ts \
  base44/functions/sendExpressToZapier/entry.ts \
  base44/functions/submitExpressAdminIntake/entry.ts \
  base44/functions/submitExpressQuestionnaireFallback/entry.ts \
  base44/shared/durableDraftMutation.ts

npm run typecheck
npm run lint
npm test
```

`--cached-only` prevents Deno dependency downloads. A missing cached dependency is an environment failure, not a passing check. Run the Node suite after dependency installation has finished.

The release regression tests exercise the actual hosted handlers with synthetic in-memory entities and blocked network access. They cover immutable-write recovery, monotonic mutation replay, finalized-draft protection, verified checkpoint acknowledgements, malformed snapshots, stale clear responses, credential-scoped duplicate-session selection, lease renewal and fenced writes, raw-to-mapped recovery integrity, failed duplicate lookups, compact version-two receipt verification, and the required pre-submit save confirmation.

Local checks do not prove a hosted deployment. Draft updates now compare the owner token and unexpired lease in the database update and verify the saved values. Cross-entity final-record creation, intake/history updates, and external webhook delivery cannot form one transaction; ambiguous or failed operations must be resolved through the durable receipt lookup and retained recovery evidence. External webhook delivery is not an exactly-once guarantee.
