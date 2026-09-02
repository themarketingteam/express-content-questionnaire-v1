/**
 * Copy text with the async Clipboard API when available, then fall back to the
 * legacy selection command used by browsers with stricter clipboard policies.
 *
 * @param {string} value
 * @param {{ navigatorObject?: Navigator, documentObject?: Document }} [options]
 * @returns {Promise<void>}
 */
export async function copyTextToClipboard(value, options = {}) {
  const text = String(value || "");
  if (!text) throw new Error("There is no text available to copy.");

  const navigatorObject = options.navigatorObject || globalThis.navigator;
  const documentObject = options.documentObject || globalThis.document;
  let clipboardError = null;

  try {
    if (navigatorObject?.clipboard?.writeText) {
      await navigatorObject.clipboard.writeText(text);
      return;
    }
  } catch (error) {
    clipboardError = error;
  }

  if (!documentObject?.body || typeof documentObject.createElement !== "function") {
    throw clipboardError || new Error("Clipboard access is not available in this browser.");
  }

  const previouslyFocused = documentObject.activeElement;
  const textarea = documentObject.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto -9999px";
  textarea.style.opacity = "0";
  documentObject.body.appendChild(textarea);

  let copied = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    copied = Boolean(documentObject.execCommand?.("copy"));
  } finally {
    textarea.remove();
    if (globalThis.HTMLElement && previouslyFocused instanceof globalThis.HTMLElement) {
      try { previouslyFocused.focus({ preventScroll: true }); } catch { /* ignored */ }
    }
  }

  if (!copied) {
    throw clipboardError || new Error("Clipboard access was denied by the browser.");
  }
}
