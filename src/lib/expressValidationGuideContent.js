/**
 * Express Validation Guide Content
 * 
 * Educational content explaining validation behavior in the Express questionnaire.
 * This content helps users understand what validation checks, which answers are validated,
 * and what each validation status means.
 */

/**
 * Guide title
 */
export const EXPRESS_VALIDATION_GUIDE_TITLE = "Answer Quality Guide";

/**
 * Guide summary
 */
export const EXPRESS_VALIDATION_GUIDE_SUMMARY = "A few written answers are checked to make sure they include enough useful detail for the team to work from.";

/**
 * Validation guide sections
 */
export const EXPRESS_VALIDATION_GUIDE_SECTIONS = [
  {
    id: "what_validation_checks",
    title: "What validation checks",
    body: "Validation is a light-touch review of your written answers. It looks for answers that are blank, too vague, unfinished, placeholder text, or unrelated to the question.",
    bullets: [
      "It does not grade your writing style.",
      "It does not require perfect grammar.",
      "It only checks whether the answer has enough useful business context.",
    ],
  },
  {
    id: "which_answers",
    title: "Which answers are checked",
    body: "The main written answers are checked, especially the answers about what makes your company different and who your ideal client is.",
    bullets: [
      "Multiple-choice and checkbox answers still need to be completed.",
      "Optional 'Other' details may be reviewed later if they contain text.",
      "You can keep editing after validation.",
    ],
  },
  {
    id: "status_meanings",
    title: "What the statuses mean",
    body: "Each question can show a status to help you understand what still needs attention.",
    bullets: [
      "Complete means the answer appears ready.",
      "Needs attention means the answer may be missing or too thin.",
      "Needs validation means a written answer should be checked before submit.",
      "Edited since validation means the answer changed after it was last checked.",
      "Validation unavailable means the check could not run, usually because of a temporary connection or service issue.",
    ],
  },
  {
    id: "how_to_fix",
    title: "How to improve an answer",
    body: "If an answer needs more detail, add specific context that would help someone understand your business.",
    bullets: [
      "Mention the type of clients you serve.",
      "Mention specific services, outcomes, or business problems.",
      "Avoid placeholder answers like 'test,' 'n/a,' or 'not sure.'",
      "A short but specific answer is better than a long vague answer.",
    ],
  },
  {
    id: "submit_time_check",
    title: "What happens when you submit",
    body: "Before final submission, the form may re-check written answers that were never validated or were edited after validation.",
    bullets: [
      "If an answer is incomplete, you will be asked to add more detail before submitting.",
      "If an answer could be improved but is still usable, you may see a warning.",
      "Your answers are not submitted until blocking issues are resolved.",
    ],
  },
];

/**
 * Get validation guide sections
 * @returns {Array} Array of section objects
 */
export function getExpressValidationGuideSections() {
  return EXPRESS_VALIDATION_GUIDE_SECTIONS;
}

/**
 * Get help text for a validation status
 * @param {string} status - The validation status
 * @returns {string} Help text for the status
 */
export function getExpressValidationStatusHelp(status) {
  const statusHelp = {
    not_started: "This question has not been started yet.",
    in_progress: "This question has some information but may not be complete yet.",
    complete: "This question appears complete.",
    needs_attention: "This question needs more detail or a required selection.",
    needs_validation: "This written answer should be checked before submit.",
    validating: "This answer is being checked.",
    dirty: "This answer was edited after it was last checked.",
    error: "Validation could not be completed right now.",
  };

  return statusHelp[status] || "";
}