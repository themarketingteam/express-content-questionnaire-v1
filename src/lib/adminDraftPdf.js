import { EXPRESS_PDF_TEMPLATE_VERSION } from "../components/questionnaire/PDFGenerator.js";
import { buildExpressDraftSubmissionPreview } from "./expressDraftSubmissionPreview.js";
import { normalizeExpressFormData } from "./expressQuestionnairePayload.js";

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function canonicalPayloadToFormData(payload) {
  const userdata = payload?.userdata || {};
  return normalizeExpressFormData({
    itCompanyType: userdata.it_company_type,
    itCompanyTypeOther: userdata.it_company_type_other,
    serviceOfferings: userdata.service_offerings,
    serviceOfferingsOther: userdata.service_offerings_other,
    differentiation: userdata.differentiation,
    geographicAreas: userdata.geographic_areas,
    geographicAreaMeta: userdata.geographic_area_meta,
    pricingPackaging: userdata.pricing_packaging,
    pricingPackagingOther: userdata.pricing_packaging_other,
    companyGoals: userdata.company_goals,
    companyGoalsOther: userdata.company_goals_other,
    brandTone: userdata.brand_tone,
    brandToneOther: userdata.brand_tone_other,
    targetIndustries: userdata.target_industries,
    targetIndustriesOther: userdata.target_industries_other,
    clientSize: userdata.client_size,
    clientChallenges: userdata.client_challenges,
    clientChallengesOther: userdata.client_challenges_other,
    clientOutcomes: userdata.client_outcomes,
    clientOutcomesOther: userdata.client_outcomes_other,
    idealClient: userdata.ideal_client,
  });
}

function submissionToCanonicalPayload(submission) {
  if (!submission) return null;
  return {
    metadata: {
      business_name: String(submission.business_name || ""),
      businessDomain: String(submission.business_domain || ""),
      submission_datetime: String(submission.submission_datetime || submission.created_date || ""),
      service_type: "express",
      questionnaire_session_id: String(submission.questionnaire_session_id || ""),
      submit_attempt_id: String(submission.submit_attempt_id || ""),
    },
    userdata: {
      it_company_type: submission.it_company_type || [],
      it_company_type_other: submission.it_company_type_other || "",
      service_offerings: submission.service_offerings || [],
      service_offerings_other: submission.service_offerings_other || "",
      differentiation: submission.differentiation || "",
      geographic_areas: submission.geographic_areas || "",
      geographic_area_meta: submission.geographic_area_meta || {},
      pricing_packaging: submission.pricing_packaging || "",
      pricing_packaging_other: submission.pricing_packaging_other || "",
      company_goals: submission.company_goals || [],
      company_goals_other: submission.company_goals_other || "",
      brand_tone: submission.brand_tone || "",
      brand_tone_other: submission.brand_tone_other || "",
      target_industries: submission.target_industries || [],
      target_industries_other: submission.target_industries_other || "",
      client_size: submission.client_size || "",
      client_challenges: submission.client_challenges || [],
      client_challenges_other: submission.client_challenges_other || "",
      client_outcomes: submission.client_outcomes || [],
      client_outcomes_other: submission.client_outcomes_other || "",
      ideal_client: submission.ideal_client || "",
    },
  };
}

function newestTimestamp(...values) {
  return values.reduce((latest, value) => {
    const time = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(time) && time > latest ? time : latest;
  }, 0);
}

function parseCanonicalPayload(value) {
  const parsed = safeJsonParse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!parsed.userdata || typeof parsed.userdata !== "object" || Array.isArray(parsed.userdata)) return null;
  return parsed;
}

function dateKeyFromValues(...values) {
  for (const value of values) {
    if (!value) continue;
    const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function localMiddayFromDateKey(dateKey) {
  const parsed = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function prepareDraftPdfInput({ draft, submission = null }) {
  if (!draft) throw new Error("A draft is required to prepare the PDF.");

  const draftPreview = buildExpressDraftSubmissionPreview(draft);
  const repairedPayload = draft.ai_repair_applied
    ? parseCanonicalPayload(draft.ai_repaired_payload_json)
    : null;
  const submissionPayload = submissionToCanonicalPayload(submission);
  const draftHasPayload = draftPreview.source !== "empty_schema";
  const draftPayloadTimestamp = newestTimestamp(
    draft.payload_edited_at,
    draft.last_saved_at,
    draft.last_changed_at,
    draft.created_date,
  );
  const submissionTimestamp = newestTimestamp(
    submission?.updated_date,
    submission?.submission_datetime,
    submission?.created_date,
  );
  const useSubmission = Boolean(
    submissionPayload && (!draftHasPayload || submissionTimestamp >= draftPayloadTimestamp),
  );
  const useAppliedRepair = Boolean(
    !useSubmission
      && repairedPayload
      && (!draftHasPayload || newestTimestamp(draft.last_ai_repair_at) >= draftPayloadTimestamp),
  );

  const payload = useSubmission
    ? submissionPayload
    : useAppliedRepair
      ? repairedPayload
      : draftPreview.payload;
  const source = useSubmission
    ? "form_submission"
    : useAppliedRepair
      ? "ai_repaired_payload_json"
      : draftPreview.source;
  const sourceTimestamp = useSubmission
    ? submissionTimestamp
    : useAppliedRepair
      ? newestTimestamp(draft.last_ai_repair_at)
      : draftPayloadTimestamp;
  const metadata = payload?.metadata || {};
  const businessName = String(metadata.business_name || draft.business_name || submission?.business_name || "").trim();
  const domain = String(
    metadata.businessDomain
      || metadata.business_domain
      || draft.domain
      || submission?.business_domain
      || "",
  ).trim();
  const submissionDateKey = dateKeyFromValues(
    metadata.submission_datetime,
    useSubmission ? submission?.submission_datetime : draft.submitted_at,
    useSubmission ? submission?.created_date : draft.last_saved_at,
    draft.created_date,
  );

  return {
    businessName,
    domain,
    draftId: draft.id || "",
    formData: canonicalPayloadToFormData(payload),
    payloadSnapshot: payload,
    questionnaireSessionId: String(
      metadata.questionnaire_session_id || draft.session_id || submission?.questionnaire_session_id || "",
    ),
    source,
    sourceUpdatedAt: new Date(sourceTimestamp || Date.now()).toISOString(),
    submissionDateKey,
    submissionId: String(submission?.id || draft.final_submission_id || ""),
    submitAttemptId: String(metadata.submit_attempt_id || submission?.submit_attempt_id || ""),
    submittedAt: localMiddayFromDateKey(submissionDateKey),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
      }, {});
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export async function createPdfPayloadFingerprint(input) {
  const material = stableStringify({
    businessName: input.businessName,
    domain: input.domain,
    formData: normalizeExpressFormData(input.formData || {}),
    submissionDate: input.submissionDateKey,
    templateVersion: EXPRESS_PDF_TEMPLATE_VERSION,
  });
  const bytes = new TextEncoder().encode(material);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sortPdfVersions(versions) {
  return [...(versions || [])].sort((left, right) => {
    const versionDifference = Number(right.version_number || 0) - Number(left.version_number || 0);
    if (versionDifference !== 0) return versionDifference;
    return newestTimestamp(right.generated_at, right.created_date)
      - newestTimestamp(left.generated_at, left.created_date);
  });
}

export function selectReusablePdfVersion(versions, payloadHash) {
  return sortPdfVersions(versions).find((version) => (
    version.payload_hash === payloadHash
    && version.template_version === EXPRESS_PDF_TEMPLATE_VERSION
    && typeof version.pdf_file_url === "string"
    && version.pdf_file_url.length > 0
  )) || null;
}

export function parseStoredPayload(version) {
  return safeJsonParse(version?.payload_json, null);
}
