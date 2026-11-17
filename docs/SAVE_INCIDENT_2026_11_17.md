# Completed questionnaire revision repair — November 17, 2026

The Pro production incident revealed a shared completed-draft UX mismatch. Express also exposed a submitted copy as editable although its persistence layer protects the completed receipt. Completed Express answers are now visible read-only, with an explicit Start a revision action. Any different browser copy stays separately recoverable and is included only by explicit choice.

The authenticated server action creates an idempotent working draft with optional source/request lineage and a durable version/checkpoint before acknowledging it. Target credentials stay separate until confirmation; a full URL reload starts the new editing session. Repeated or lost responses reuse the same working copy. Completed source answers, prior receipts, and delivery state remain intact.

Active-draft recovery now holds a stale full snapshot when a newer foreign revision is observed, rather than stamping that snapshot with the current server revision. The entire local copy stays downloadable while the authoritative server copy is shown. Unknown browser bases cannot replay into populated server answers based solely on a newer local timestamp.

Local preview supports the same explicit revision flow and retains disk history. Existing organizer data fields were verified directly through the live API; they are already recognized. Only optional revision lineage is added. No customer migration, deletion, Zapier/email delivery, or downstream reprocessing is required for this release. Final validation artifacts live under /Users/isaachines/.codex/backups/questionnaire-save-incident-20261117.
