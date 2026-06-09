/**
 * expressDraftSubmissionPreview.js
 *
 * Builds a canonical Express endpoint payload preview from a FormDraft record.
 * Uses the same mapping/normalization logic as the actual submit path.
 * Pure display helper — never mutates records or triggers side effects.
 */

import {
  buildExpressSubmissionPayload,
  normalizeExpressFormData,
  cleanExpressDomain,
} from "@/lib/expressQuestionnairePayload";

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Check whether a parsed object looks like the canonical endpoint shape:
 * { metadata: { ... }, userdata: { ... } }
 */
function isCanonicalExpressPayload(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    typeof obj.metadata === "object" &&
    typeof obj.userdata === "object"
  );
}

/**
 * Normalize a canonical payload object so all fields have guaranteed types.
 */
function normalizeCanonicalPayload(raw, overrides = {}) {
  const md = raw.metadata || {};
  const ud = raw.userdata || {};

  const ensureArray = (v) => Array.isArray(v) ? v : (v ? [v] : []);
  const ensureString = (v) => (v == null ? "" : String(v));
  const ensureObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

  return {
    metadata: {
      business_name: ensureString(overrides.business_name ?? md.business_name),
      businessDomain: ensureString(overrides.businessDomain ?? md.businessDomain ?? md.business_domain ?? ""),
      submission_datetime: ensureString(md.submission_datetime || md.created_at || ""),
      service_type: "express",
      questionnaire_session_id: ensureString(md.questionnaire_session_id || overrides.session_id || ""),
      submit_attempt_id: ensureString(md.submit_attempt_id || overrides.submit_attempt_id || ""),
    },
    userdata: {
      it_company_type: ensureArray(ud.it_company_type),
      it_company_type_other: ensureString(ud.it_company_type_other),
      service_offerings: ensureArray(ud.service_offerings),
      service_offerings_other: ensureString(ud.service_offerings_other),
      differentiation: ensureString(ud.differentiation),
      geographic_areas: ensureString(ud.geographic_areas),
      geographic_area_meta: ensureObject(ud.geographic_area_meta),
      pricing_packaging: ensureString(ud.pricing_packaging),
      pricing_packaging_other: ensureString(ud.pricing_packaging_other),
      company_goals: ensureString(ud.company_goals),
      company_goals_other: ensureString(ud.company_goals_other),
      brand_tone: ensureString(ud.brand_tone),
      brand_tone_other: ensureString(ud.brand_tone_other),
      target_industries: ensureArray(ud.target_industries),
      target_industries_other: ensureString(ud.target_industries_other),
      client_size: ensureString(ud.client_size),
      client_challenges: ensureArray(ud.client_challenges),
      client_challenges_other: ensureString(ud.client_challenges_other),
      client_outcomes: ensureArray(ud.client_outcomes),
      client_outcomes_other: ensureString(ud.client_outcomes_other),
      ideal_client: ensureString(ud.ideal_client),
    },
  };
}

/**
 * Build the canonical endpoint payload preview from a FormDraft record.
 *
 * Source priority:
 *   1. draft.mapped_payload_json  — canonical shape stored at submit time
 *   2. draft.responses_json       — raw questionnaire answers, reconstructed via buildExpressSubmissionPayload
 *   3. Empty canonical schema     — with warnings
 *
 * Returns:
 *   { ok, payload, source, warnings, validationErrors, missingRequiredFields }
 */
export function buildExpressDraftSubmissionPreview(draft, options = {}) {
  if (!draft) {
    return {
      ok: false,
      payload: _emptySchema(),
      source: "empty_schema",
      warnings: ["No draft provided."],
      validationErrors: [],
      missingRequiredFields: ["business_name"],
    };
  }

  const warnings = [];
  const validationErrors = [];
  const missingRequiredFields = [];

  const businessName = draft.business_name || "";
  const domain = draft.domain || "";
  const sessionId = draft.session_id || "";

  // Extract submit_attempt_id from stored metadata if available
  const storedMeta = safeJsonParse(draft.metadata_json, {});
  const submitAttemptId = storedMeta?.submit_attempt_id || "";

  // ── Source A: draft.mapped_payload_json ───────────────────────────────────
  const mappedRaw = safeJsonParse(draft.mapped_payload_json, null);
  if (mappedRaw && isCanonicalExpressPayload(mappedRaw)) {
    const payload = normalizeCanonicalPayload(mappedRaw, {
      business_name: businessName || mappedRaw.metadata?.business_name,
      businessDomain: domain || mappedRaw.metadata?.businessDomain,
      session_id: sessionId,
      submit_attempt_id: submitAttemptId || mappedRaw.metadata?.submit_attempt_id,
    });

    if (!payload.metadata.business_name) {
      warnings.push("business_name is required before final submission can be created.");
      missingRequiredFields.push("business_name");
    }

    return { ok: true, payload, source: "mapped_payload_json", warnings, validationErrors, missingRequiredFields };
  }

  if (draft.mapped_payload_json && !mappedRaw) {
    warnings.push("mapped_payload_json is present but could not be parsed.");
  } else if (mappedRaw && !isCanonicalExpressPayload(mappedRaw)) {
    warnings.push("mapped_payload_json exists but is not in the canonical endpoint shape — reconstructing from responses.");
  }

  // ── Source B: draft.responses_json (reconstruct via submit mapping) ───────
  const responses = safeJsonParse(draft.responses_json, null);
  if (responses && typeof responses === "object" && !Array.isArray(responses)) {
    try {
      const built = buildExpressSubmissionPayload({
        formData: responses,
        businessName,
        domain,
        sessionId,
        submitAttemptId,
      });

      // buildExpressSubmissionPayload includes _rawFormData — strip it for display
      const { _rawFormData: _, ...cleanBuilt } = built;
      const payload = normalizeCanonicalPayload(cleanBuilt, {
        business_name: businessName,
        businessDomain: domain,
        session_id: sessionId,
        submit_attempt_id: submitAttemptId,
      });

      if (!payload.metadata.business_name) {
        warnings.push("business_name is required before final submission can be created.");
        missingRequiredFields.push("business_name");
      }

      return {
        ok: true,
        payload,
        source: "reconstructed_from_responses_json",
        warnings,
        validationErrors,
        missingRequiredFields,
      };
    } catch (err) {
      warnings.push(`Reconstruction from responses_json failed: ${err?.message || "unknown error"}`);
    }
  }

  // ── Fallback: empty canonical schema ─────────────────────────────────────
  warnings.push("Could not reconstruct a valid endpoint payload. Showing empty schema.");
  missingRequiredFields.push("business_name");

  return {
    ok: false,
    payload: _emptySchema({ business_name: businessName, sessionId, submitAttemptId }),
    source: "empty_schema",
    warnings,
    validationErrors,
    missingRequiredFields,
  };
}

function _emptySchema({ business_name = "", sessionId = "", submitAttemptId = "" } = {}) {
  return {
    metadata: {
      business_name,
      businessDomain: "",
      submission_datetime: "",
      service_type: "express",
      questionnaire_session_id: sessionId,
      submit_attempt_id: submitAttemptId,
    },
    userdata: {
      it_company_type: [],
      it_company_type_other: "",
      service_offerings: [],
      service_offerings_other: "",
      differentiation: "",
      geographic_areas: "",
      geographic_area_meta: {},
      pricing_packaging: "",
      pricing_packaging_other: "",
      company_goals: "",
      company_goals_other: "",
      brand_tone: "",
      brand_tone_other: "",
      target_industries: [],
      target_industries_other: "",
      client_size: "",
      client_challenges: [],
      client_challenges_other: "",
      client_outcomes: [],
      client_outcomes_other: "",
      ideal_client: "",
    },
  };
}