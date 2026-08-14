import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BUSINESS_NAME_THRESHOLD,
  DOMAIN_THRESHOLD,
  createIdentityFingerprint,
  extractNarrativeEvidence,
  getChicagoScheduleParts,
  isChicagoIdentityRecoveryWindow,
  isMissingIdentityValue,
  isPublicHostname,
  normalizeNarrativeText,
  resolveSubmissionIdentity,
  scoreBusinessNameCandidate,
  scoreDomainCandidate,
} from "../base44/shared/submissionIdentityRecovery.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function nexusEvidence() {
  const text = normalizeNarrativeText(`Why Nexus Consulting

Security is at the center of everything we do. Nexus Consulting helps construction organizations protect their systems.`);
  return [{ path: "responses.why_choose_us_page.why_choose_us_description", text, preferred: true }];
}

function fakeBase44({ inference } = {}) {
  const updates = [];
  const attempts = [];
  const entity = {
    async get() { throw new Error("Source get should not run in read-only diagnosis."); },
    async update(id, patch) { updates.push({ id, patch }); },
  };
  return {
    updates,
    attempts,
    asServiceRole: {
      integrations: {
        Core: {
          async InvokeLLM() {
            return inference || { candidate: null, confidence: 0, evidence_paths: [], conflicts: [], rationale: "ambiguous" };
          },
        },
      },
      entities: {
        FormDraft: entity,
        FormSubmissionIntake: entity,
        ExpressIdentityResolutionAttempt: {
          async filter() { return []; },
          async create(record) {
            const created = { id: `attempt-${attempts.length + 1}`, ...record };
            attempts.push(created);
            return created;
          },
        },
      },
    },
  };
}

function mutableBase44(record, inference) {
  const state = structuredClone(record);
  const updates = [];
  const attempts = [];
  const entity = {
    async get() { return structuredClone(state); },
    async update(id, patch) {
      assert.equal(id, state.id);
      Object.assign(state, structuredClone(patch));
      updates.push(structuredClone(patch));
      return structuredClone(state);
    },
  };
  return {
    state,
    updates,
    attempts,
    asServiceRole: {
      integrations: { Core: { async InvokeLLM() { return inference; } } },
      entities: {
        FormDraft: entity,
        FormSubmissionIntake: entity,
        ExpressIdentityResolutionAttempt: {
          async filter() { return []; },
          async create(value) {
            const created = { id: `attempt-${attempts.length + 1}`, ...value };
            attempts.push(created);
            return created;
          },
        },
      },
    },
  };
}

test("placeholder values are treated as missing identity", () => {
  for (const value of ["", "unknown", "NULL", "n/a", "Unnamed business", "—", null, undefined]) {
    assert.equal(isMissingIdentityValue(value), true, String(value));
  }
  assert.equal(isMissingIdentityValue("Nexus Consulting"), false);
});

test("paragraph boundaries prevent manufacturing Nexus Consulting Security", () => {
  const evidence = nexusEvidence();
  const supported = scoreBusinessNameCandidate({
    candidate: "Nexus Consulting",
    modelConfidence: 0.97,
    evidence,
    conflicts: [],
  });
  const manufactured = scoreBusinessNameCandidate({
    candidate: "Nexus Consulting Security",
    modelConfidence: 0.99,
    evidence,
    conflicts: [],
  });
  assert.equal(supported.autoEligible, true);
  assert.ok(supported.confidence >= BUSINESS_NAME_THRESHOLD);
  assert.equal(manufactured.autoEligible, false);
  assert.equal(manufactured.confidence, 0);
});

test("model confidence cannot bypass deterministic evidence or conflicts", () => {
  const absent = scoreBusinessNameCandidate({
    candidate: "Unrelated Vendor",
    modelConfidence: 1,
    evidence: nexusEvidence(),
    conflicts: [],
  });
  const conflict = scoreBusinessNameCandidate({
    candidate: "Nexus Consulting",
    modelConfidence: 1,
    evidence: nexusEvidence(),
    conflicts: ["Nexus Construction"],
  });
  assert.equal(absent.autoEligible, false);
  assert.equal(conflict.autoEligible, false);
});

test("business-name thresholds are inclusive and deterministic", () => {
  const below = scoreBusinessNameCandidate({ candidate: "Nexus Consulting", modelConfidence: 0.899, evidence: nexusEvidence(), conflicts: [] });
  const at = scoreBusinessNameCandidate({ candidate: "Nexus Consulting", modelConfidence: 0.90, evidence: nexusEvidence(), conflicts: [] });
  assert.equal(below.autoEligible, false);
  assert.equal(at.autoEligible, true);
});

test("narrative extraction excludes email, IDs, URLs, and tokens", () => {
  const record = {
    responses_json: JSON.stringify({
      why_choose_us_description: "Nexus Consulting helps construction companies with managed IT.",
      user_email: "person@example.com",
      session_id: "private-session",
      access_token: "secret-value",
      website_url: "https://example.com",
    }),
  };
  const evidence = extractNarrativeEvidence("draft", record);
  assert.equal(evidence.length, 1);
  assert.match(evidence[0].path, /why_choose_us_description/);
});

test("diagnose does not write the source record and blocks domain search without a confirmed name", async () => {
  const base44 = fakeBase44({
    inference: { candidate: "Maybe Company", confidence: 0.5, evidence_paths: ["responses.description"], conflicts: [], rationale: "weak" },
  });
  const record = {
    id: "draft-1",
    session_id: "session-1",
    business_name: "",
    domain: "",
    responses_json: JSON.stringify({ description: "Maybe Company was mentioned once.", geographic_areas: "Austin, TX" }),
  };
  const result = await resolveSubmissionIdentity({
    base44,
    recordType: "draft",
    record,
    trigger: "admin_diagnose",
    apply: false,
    serpApiKey: "",
    webSearchEnabled: true,
  });
  assert.equal(result.resolution.businessName.autoEligible, false);
  assert.equal(result.resolution.domain.decision, "blocked_missing_business_name");
  assert.equal(base44.updates.length, 0);
  assert.equal(base44.attempts.length, 1);
});

test("domain discovery is blocked when a confirmed name has no primary location", async () => {
  const base44 = fakeBase44();
  const record = {
    id: "intake-1",
    questionnaire_session_id: "session-1",
    business_name: "Nexus Consulting",
    business_domain: "",
    transformed_payload_json: JSON.stringify({ metadata: { business_name: "Nexus Consulting" }, userdata: { differentiation: "Managed IT" } }),
  };
  const result = await resolveSubmissionIdentity({
    base44,
    recordType: "intake",
    record,
    trigger: "admin_diagnose",
    apply: false,
    serpApiKey: "",
  });
  assert.equal(result.resolution.domain.decision, "blocked_missing_location");
  assert.equal(base44.updates.length, 0);
});

test("Repair Only applies a high-confidence name without overwriting raw responses or workflow status", async () => {
  const record = {
    id: "draft-apply",
    session_id: "session-apply",
    status: "submit_failed",
    business_name: "",
    domain: "",
    responses_json: JSON.stringify({ why_choose_us_description: nexusEvidence()[0].text, geographic_areas: "Bristol, CT" }),
    mapped_payload_json: JSON.stringify({ metadata: {}, userdata: { geographic_areas: "Bristol, CT" } }),
  };
  const base44 = mutableBase44(record, {
    candidate: "Nexus Consulting",
    confidence: 0.97,
    evidence_paths: ["responses_json.why_choose_us_description"],
    conflicts: [],
    rationale: "Repeated company self-reference",
  });
  const result = await resolveSubmissionIdentity({
    base44,
    recordType: "draft",
    record,
    trigger: "admin_repair",
    apply: true,
    webSearchEnabled: false,
    withSessionLease: async ({ operation }) => operation(),
  });
  assert.equal(result.resolution.businessName.decision, "applied");
  assert.equal(base44.state.business_name, "Nexus Consulting");
  assert.equal(base44.state.status, "submit_failed");
  assert.equal(base44.state.responses_json, record.responses_json);
  assert.equal(JSON.parse(base44.state.mapped_payload_json).metadata.business_name, "Nexus Consulting");
  assert.equal(base44.state.domain, "");
});

test("existing non-placeholder identity values are never overwritten", async () => {
  const record = {
    id: "intake-existing",
    questionnaire_session_id: "session-existing",
    status: "retry_failed",
    business_name: "Confirmed Company",
    business_domain: "confirmed.example",
    transformed_payload_json: JSON.stringify({ metadata: { business_name: "Confirmed Company", businessDomain: "confirmed.example" }, userdata: {} }),
  };
  const base44 = mutableBase44(record, {
    candidate: "Wrong Company",
    confidence: 1,
    evidence_paths: [],
    conflicts: [],
    rationale: "should never be called",
  });
  await resolveSubmissionIdentity({
    base44,
    recordType: "intake",
    record,
    trigger: "admin_repair",
    apply: true,
    webSearchEnabled: false,
    withSessionLease: async ({ operation }) => operation(),
  });
  assert.equal(base44.state.business_name, "Confirmed Company");
  assert.equal(base44.state.business_domain, "confirmed.example");
  assert.equal(base44.state.status, "retry_failed");
});

test("domain scoring requires name, service, location, and first-party hostname evidence", () => {
  const strong = scoreDomainCandidate({
    businessName: "Nexus Consulting",
    location: "Bristol, CT",
    result: { position: 1, link: "https://www.nexusmsp.us", title: "Nexus Consulting | Managed IT", snippet: "Bristol CT cybersecurity and IT services" },
    pageText: "Nexus Consulting provides managed IT and cybersecurity services to Bristol CT organizations.",
  });
  const wrongLocation = scoreDomainCandidate({
    businessName: "Nexus Consulting",
    location: "Bristol, CT",
    result: { position: 1, link: "https://www.nexusmsp.us", title: "Nexus Consulting | Managed IT", snippet: "IT services" },
    pageText: "Nexus Consulting provides managed IT in Phoenix Arizona.",
  });
  assert.ok(strong.confidence >= DOMAIN_THRESHOLD);
  assert.equal(strong.autoEligible, true);
  assert.equal(wrongLocation.autoEligible, false);
});

test("unsafe and directory/social hostnames are rejected", () => {
  for (const hostname of ["localhost", "127.0.0.1", "10.0.0.1", "169.254.169.254", "service.internal"]) {
    assert.equal(isPublicHostname(hostname), false, hostname);
  }
  const directory = scoreDomainCandidate({
    businessName: "Nexus Consulting",
    location: "Bristol CT",
    result: { position: 1, link: "https://linkedin.com/company/nexus", title: "Nexus", snippet: "Bristol CT managed IT" },
    pageText: "Nexus Consulting Bristol CT managed IT cybersecurity",
  });
  assert.equal(directory.autoEligible, false);
});

test("identity fingerprints change when questionnaire content changes", async () => {
  const base = { id: "draft", responses_json: JSON.stringify({ description: "First answer" }) };
  const first = await createIdentityFingerprint("draft", base);
  const second = await createIdentityFingerprint("draft", { ...base, responses_json: JSON.stringify({ description: "Changed answer" }) });
  assert.notEqual(first, second);
});

test("Chicago schedule runs at 4 AM on weekdays in both CST and CDT", () => {
  const winter = new Date("2026-01-12T10:00:00Z");
  const summer = new Date("2026-08-14T09:00:00Z");
  const weekend = new Date("2026-08-15T09:00:00Z");
  assert.equal(getChicagoScheduleParts(winter).hour, 4);
  assert.equal(getChicagoScheduleParts(summer).hour, 4);
  assert.equal(isChicagoIdentityRecoveryWindow(winter), true);
  assert.equal(isChicagoIdentityRecoveryWindow(summer), true);
  assert.equal(isChicagoIdentityRecoveryWindow(weekend), false);
});

test("the source-controlled scheduler is DST-safe, bounded, shadow-first, and never submits", () => {
  const config = read("base44/functions/recoverMissingSubmissionIdentity/function.jsonc");
  const worker = read("base44/functions/recoverMissingSubmissionIdentity/entry.ts");
  assert.match(config, /"cron_expression": "0 9 \* \* 1-5"/);
  assert.match(config, /"cron_expression": "0 10 \* \* 1-5"/);
  assert.match(worker, /IDENTITY_SCHEDULED_AUTO_APPLY_ENABLED', false/);
  assert.match(worker, /const MAX_RECORDS = 10/);
  assert.match(worker, /const CONCURRENCY = 2/);
  assert.match(worker, /const WORK_DEADLINE_MS = 150_000/);
  assert.doesNotMatch(worker, /FormSubmission\.create/);
  assert.doesNotMatch(worker, /EXPRESS_ZAPIER_WEBHOOK_URL/);
});

test("manual actions share identity recovery, require both fields for retry, and persist final domains", () => {
  const repair = read("base44/functions/repairExpressQuestionnaireIntakeSubmission/entry.ts");
  assert.match(repair, /resolveSubmissionIdentity/);
  assert.match(repair, /requireBusinessName: true, requireDomain: true/);
  assert.match(repair, /business_domain: cleanDomain\(meta\.businessDomain/);
  assert.match(repair, /mode !== 'diagnose_only'/);
  assert.match(repair, /The questionnaire changed while repair was running/);
});

test("identity review is protected by the shared recovery grant before service-role reads", () => {
  const review = read("base44/functions/reviewExpressIdentityResolution/entry.ts");
  const authIndex = review.indexOf("authorizeRecoveryRequest");
  const readIndex = review.indexOf("ExpressIdentityResolutionAttempt.get");
  assert.ok(authIndex >= 0 && readIndex > authIndex);
  assert.match(review, /expectedFingerprint/);
  assert.match(read("src/components/admin/IdentityResolutionPanel.jsx"), /reviewExpressIdentityResolution/);
});
