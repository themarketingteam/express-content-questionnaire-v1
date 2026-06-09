# Express Content Questionnaire — Draft Recovery Hardening

_Last updated: 2026-06-09_

---

## 1. Recovery Layer Overview

The system uses multiple redundant layers to prevent data loss.

### Layer 1 — localStorage v3 (Real-Time / Primary)

- **Key:** `express_questionnaire_v3_<sessionId>`
- **Written:** on every `formData` state change (debounced ~300 ms) and on `beforeunload`
- **Read:** on first mount, after cookie is checked
- **Survives:** tab close, reload, short network outage
- **Format:** versioned JSON `{ version: 3, formData, validationStatus, touchedQuestions, expandedQuestions, sessionId }`

### Layer 2 — Cookie v2 (Fallback Compatibility)

- **Key:** `express_questionnaire_state` (see `EXPRESS_COOKIE_KEY`)
- **Written:** alongside localStorage, and on `beforeunload`
- **Read:** on first mount if localStorage is empty or missing
- **Survives:** tab close, reload; expires after 365 days
- **Migration:** v1 (plain JSON) and v2 (wrapped) cookies are auto-migrated on read

### Layer 3 — Server FormDraft (Reliable Cross-Device)

- **Entity:** `FormDraft`
- **Written:** debounced ~600 ms after every answer change via `saveDraftSnapshot`
- **Read:** admin-only via `/admin/draft-recovery`
- **Survives:** browser wipe, device change (requires re-authentication or sessionId match)
- **Includes:** `responses_json`, `validation_status_json`, `touched_questions_json`, `expanded_questions_json`, `mapped_payload_json`, `last_non_empty_answers_json`, `field_history_json`, `last_local_persisted_at`

### Layer 4 — FormDraftEvent Audit Trail

- **Entity:** `FormDraftEvent`
- **Written:** on every significant action: answer change, question open/close, submit attempts, validation events, recovery events
- **Purpose:** forensic replay, support diagnostics
- **Admin access:** via `/admin/draft-recovery` → expand draft row

### Layer 5 — FormSubmissionIntake Fallback

- **Entity:** `FormSubmissionIntake`
- **Written:** when primary `FormSubmission.create()` or Zapier delivery fails
- **Purpose:** ensures raw payload is never lost even on server errors
- **Includes:** `transformed_payload_json`, `raw_responses_json`, `diagnostics_json`, `status`, `intake_reason`

### Layer 6 — Admin Retry / Resend

- **Page:** `/admin/questionnaire-intake-recovery`
- **Function:** `retryQuestionnaireIntakeSubmission`
- **Purpose:** admin can retry creating `FormSubmission` from an intake record without user re-entering data

### Layer 7 — AI Diagnose / Repair / Retry

- **Function:** `repairExpressQuestionnaireIntakeSubmission`
- **Agent:** `express_submission_repair_agent`
- **Page:** `/admin/questionnaire-intake-recovery`
- **Steps:** Diagnose → Repair Only → Repair + Retry
- **Stores:** `ai_repair_report_json`, `ai_repaired_payload_json`, `ai_repair_status`, `ai_repair_source`
- **Safety:** AI cannot invent answers; it only repairs structural/format issues

### Layer 8 — Last Non-Empty Answer Recovery (Client-Side)

- **Hook:** `useExpressAnswerHistory`
- **Library:** `src/lib/expressAnswerHistory.js`
- **Stored:** in `FormDraft.last_non_empty_answers_json` and `field_history_json`
- **UI:** `RecoverLastAnswerNotice` component (shown for `differentiation` and `idealClient`)
- **Purpose:** lets user restore accidentally deleted text without affecting submission until they explicitly click Restore

---

## 2. Manual QA Checklist

| # | Scenario | Expected Result |
|---|----------|-----------------|
| 1 | Start form, type answer in Q3, reload page | Answer restores from localStorage/cookie |
| 2 | Start form, type answer, go offline, type more | Save status shows "Saved locally" or offline indicator |
| 3 | Come back online after offline typing | Server draft save resumes; FormDraft updated |
| 4 | Type long text in Q3 or Q12, then delete it entirely | `RecoverLastAnswerNotice` appears with "Restore last answer" option |
| 5 | Dismiss restore notice | Current blank value stays blank; history preserved (notice won't re-appear for that session) |
| 6 | Type replacement text after dismissing | Replacement becomes the new `last_non_empty` value |
| 7 | Submit with valid complete data | `FormSubmission` created; ThankYou modal shown; cookie + session cleared |
| 8 | Simulate submit failure (network off at submit) | Answers remain in form; recovery card shows sessionId / recovery code |
| 9 | Retry submit from confirm modal recovery card | Submission retries without re-entering answers; uses same sessionId |
| 10 | Admin opens `/admin/draft-recovery` | Draft shows AI repair fields, field history, last non-empty answers JSON |
| 11 | Admin opens `/admin/questionnaire-intake-recovery` | Intake records listed; AI Diagnose button available |
| 12 | Admin clicks "AI Repair Only" | `ai_repaired_payload_json` and `ai_repair_report_json` saved; status = `repaired` |
| 13 | Admin clicks "AI Repair + Retry" | Final `FormSubmission` created (or deduped if already exists); status = `retry_success` |
| 14 | Submit without `businessDomain` | Form submits successfully; `business_domain` is empty string or null, not a blocker |
| 15 | Rapid double-click submit | Second submit attempt blocked by `submitInFlightRef` and `hasActiveSubmitAttemptForSession` |
| 16 | Zapier delivery | `sendExpressToZapier` called after `FormSubmission` creation; `zapier_sent` set to `true` |

---

## 3. Data Safety Notes

- **Current `formData` is the only client-submitted source of truth.** The submission payload is built from `formData` at the moment of submit — not from draft snapshots.
- **`last_non_empty_answers_json` is recovery-only.** It is never included in the submission payload unless the user explicitly clicks "Restore" in the UI.
- **AI repair cannot invent answers.** The `repairExpressQuestionnaireIntakeSubmission` function is restricted to structural/format corrections (e.g., fixing array types, normalizing strings). It does not generate or modify answer content.
- **AI repair requires admin action.** No repair is applied automatically. All AI repair steps are gated behind admin-only UI.
- **`domain` is optional for Express.** The `businessDomain` field is not required for form submission or Zapier delivery. Missing domain does not block any submission path.
- **Duplicate submit protection** is enforced at two levels: client-side (`submitInFlightRef` + `activeSubmitAttempt` localStorage) and server-side (deduplication by `questionnaire_session_id` + `submit_attempt_id`).

---

## 4. Troubleshooting

### Finding Local Backups
- Open browser DevTools → Application → Local Storage
- Keys to check:
  - `express_questionnaire_v3_<sessionId>` — primary persisted state
  - `express_questionnaire_local_backup_<sessionId>` — `beforeunload` snapshot
  - `express_questionnaire_failed_submission_<sessionId>` — failed submit backup
  - `express_questionnaire_answer_history_<sessionId>` — last non-empty answer history
  - `express_questionnaire_error_diagnostic_<sessionId>` — error boundary diagnostics

### Finding FormDraft Records
- Admin page: `/admin/draft-recovery`
- Filter by session ID, business name, or status
- Expand a draft row to see: responses, validation status, AI repair fields, last non-empty answers, field history

### Finding FormSubmissionIntake Records
- Admin page: `/admin/questionnaire-intake-recovery`
- Filter by status (`received_intake`, `retry_pending`, `retry_success`, `retry_failed`, `abandoned`)
- Expand a row to see: raw responses, transformed payload, diagnostics, AI repair history

### Copying Recovery Bundle
- In `/admin/draft-recovery`, click "Copy Recovery Bundle" on any draft row
- Bundle includes: session ID, business name, responses, validation status, mapped payload, and error info
- Use this when escalating to engineering

### Using AI Repair Safely
1. Open `/admin/questionnaire-intake-recovery`
2. Find the failing intake record
3. Click **AI Diagnose** — reads the issue without changing data
4. Review the diagnosis in `ai_repair_report_json`
5. Click **AI Repair Only** to generate a repaired payload (still not applied to submission)
6. Review `ai_repaired_payload_json` to verify no content was fabricated
7. Click **AI Repair + Retry** only when the repaired payload looks correct
8. Check `ai_repair_retry_result_json` and `linked_submission_id` to confirm success

### Retrying / Resending Without AI
- Use **Retry Submission** button in `/admin/questionnaire-intake-recovery`
- Calls `retryQuestionnaireIntakeSubmission` directly with the stored payload
- Safe to retry multiple times — deduplication prevents duplicate `FormSubmission` records
- To resend Zapier: check `zapier_sent` field; if false, the retry will attempt delivery again