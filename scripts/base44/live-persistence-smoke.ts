// Prepared through the actual Express mapper + repair + integrity validator.
// Execute ONLY after deployment with the authenticated Base44 exec command.
// Calls public persistence functions only; never calls a webhook/email function.
// Every created row uses one new random session and is retained, clearly marked.
// A failed create can use the existing recovery queue, so the catch handler
// immediately holds this run's own pending intakes; it never touches other data.
const FIXTURE = {
  "raw": {
    "itCompanyType": [
      "Managed Services Provider (MSP)"
    ],
    "itCompanyTypeOther": "",
    "serviceOfferings": [],
    "serviceOfferingsOther": "SYNTHETIC Managed IT, SYNTHETIC Help Desk, SYNTHETIC Security",
    "differentiation": "SYNTHETIC RELEASE SMOKE ONLY. Complete test answers for verifying durable questionnaire persistence; do not deliver or contact anyone.",
    "geographicAreas": "Chicago, IL",
    "geographicAreaMeta": {
      "label": "Chicago, IL",
      "source": "manual"
    },
    "pricingPackaging": "Flat-rate monthly (fully managed)",
    "pricingPackagingOther": "",
    "companyGoals": "Acquire more clients",
    "companyGoalsOther": "",
    "brandTone": "Friendly & Approachable",
    "brandToneOther": "",
    "targetIndustries": [],
    "targetIndustriesOther": "SYNTHETIC Professional Services, SYNTHETIC Accounting",
    "clientSize": "5-50 employees",
    "clientChallenges": [
      "Cybersecurity concerns or breaches"
    ],
    "clientChallengesOther": "",
    "clientOutcomes": [
      "Reduced downtime"
    ],
    "clientOutcomesOther": "",
    "idealClient": "SYNTHETIC RELEASE SMOKE ONLY. This invented business is used exclusively to verify persistence and compact page trees. No contact details or real client data are included.",
    "serviceOfferingsStructure": {
      "format": "page-tree-v1",
      "pages": [
        {
          "id": "smoke-managed",
          "label": "SYNTHETIC Managed IT",
          "source": "custom",
          "catalogId": null,
          "children": [
            {
              "id": "smoke-help",
              "label": "SYNTHETIC Help Desk",
              "source": "custom",
              "catalogId": null,
              "children": []
            },
            {
              "id": "smoke-security",
              "label": "SYNTHETIC Security",
              "source": "custom",
              "catalogId": null,
              "children": []
            }
          ]
        }
      ]
    },
    "targetIndustriesStructure": {
      "format": "page-tree-v1",
      "pages": [
        {
          "id": "smoke-industry",
          "label": "SYNTHETIC Professional Services",
          "source": "custom",
          "catalogId": null,
          "children": [
            {
              "id": "smoke-finance",
              "label": "SYNTHETIC Accounting",
              "source": "custom",
              "catalogId": null,
              "children": []
            }
          ]
        }
      ]
    }
  },
  "payload": {
    "metadata": {
      "business_name": "SYNTHETIC RELEASE SMOKE",
      "businessDomain": "example.test",
      "submission_datetime": "2026-11-14T18:46:17.307Z",
      "service_type": "express",
      "questionnaire_session_id": "synthetic-placeholder-session",
      "submit_attempt_id": "synthetic-placeholder-attempt",
      "questionnaire_payload_version": 2
    },
    "userdata": {
      "it_company_type": [
        "Managed Services Provider (MSP)"
      ],
      "it_company_type_other": "",
      "service_offerings": [],
      "service_offerings_other": "SYNTHETIC Managed IT, SYNTHETIC Help Desk, SYNTHETIC Security",
      "differentiation": "SYNTHETIC RELEASE SMOKE ONLY. Complete test answers for verifying durable questionnaire persistence; do not deliver or contact anyone.",
      "geographic_areas": "Chicago, IL",
      "geographic_area_meta": {
        "label": "Chicago, IL",
        "source": "manual"
      },
      "pricing_packaging": "Flat-rate monthly (fully managed)",
      "pricing_packaging_other": "",
      "company_goals": "Acquire more clients",
      "company_goals_other": "",
      "brand_tone": "Friendly & Approachable",
      "brand_tone_other": "",
      "target_industries": [],
      "target_industries_other": "SYNTHETIC Professional Services, SYNTHETIC Accounting",
      "client_size": "5-50 employees",
      "client_challenges": [
        "Cybersecurity concerns or breaches"
      ],
      "client_challenges_other": "",
      "client_outcomes": [
        "Reduced downtime"
      ],
      "client_outcomes_other": "",
      "ideal_client": "SYNTHETIC RELEASE SMOKE ONLY. This invented business is used exclusively to verify persistence and compact page trees. No contact details or real client data are included.",
      "service_offerings_structure": {
        "format": "page-tree-v1",
        "pages": [
          {
            "label": "SYNTHETIC Managed IT",
            "source": "custom",
            "children": [
              {
                "label": "SYNTHETIC Help Desk",
                "source": "custom"
              },
              {
                "label": "SYNTHETIC Security",
                "source": "custom"
              }
            ]
          }
        ]
      },
      "target_industries_structure": {
        "format": "page-tree-v1",
        "pages": [
          {
            "label": "SYNTHETIC Professional Services",
            "source": "custom",
            "children": [
              {
                "label": "SYNTHETIC Accounting",
                "source": "custom"
              }
            ]
          }
        ]
      }
    },
    "_rawFormData": {
      "itCompanyType": [
        "Managed Services Provider (MSP)"
      ],
      "itCompanyTypeOther": "",
      "serviceOfferings": [],
      "serviceOfferingsOther": "SYNTHETIC Managed IT, SYNTHETIC Help Desk, SYNTHETIC Security",
      "differentiation": "SYNTHETIC RELEASE SMOKE ONLY. Complete test answers for verifying durable questionnaire persistence; do not deliver or contact anyone.",
      "geographicAreas": "Chicago, IL",
      "geographicAreaMeta": {
        "label": "Chicago, IL",
        "source": "manual"
      },
      "pricingPackaging": "Flat-rate monthly (fully managed)",
      "pricingPackagingOther": "",
      "companyGoals": "Acquire more clients",
      "companyGoalsOther": "",
      "brandTone": "Friendly & Approachable",
      "brandToneOther": "",
      "targetIndustries": [],
      "targetIndustriesOther": "SYNTHETIC Professional Services, SYNTHETIC Accounting",
      "clientSize": "5-50 employees",
      "clientChallenges": [
        "Cybersecurity concerns or breaches"
      ],
      "clientChallengesOther": "",
      "clientOutcomes": [
        "Reduced downtime"
      ],
      "clientOutcomesOther": "",
      "idealClient": "SYNTHETIC RELEASE SMOKE ONLY. This invented business is used exclusively to verify persistence and compact page trees. No contact details or real client data are included.",
      "serviceOfferingsStructure": {
        "format": "page-tree-v1",
        "pages": [
          {
            "id": "smoke-managed",
            "label": "SYNTHETIC Managed IT",
            "source": "custom",
            "catalogId": null,
            "children": [
              {
                "id": "smoke-help",
                "label": "SYNTHETIC Help Desk",
                "source": "custom",
                "catalogId": null,
                "children": []
              },
              {
                "id": "smoke-security",
                "label": "SYNTHETIC Security",
                "source": "custom",
                "catalogId": null,
                "children": []
              }
            ]
          }
        ]
      },
      "targetIndustriesStructure": {
        "format": "page-tree-v1",
        "pages": [
          {
            "id": "smoke-industry",
            "label": "SYNTHETIC Professional Services",
            "source": "custom",
            "catalogId": null,
            "children": [
              {
                "id": "smoke-finance",
                "label": "SYNTHETIC Accounting",
                "source": "custom",
                "catalogId": null,
                "children": []
              }
            ]
          }
        ]
      }
    }
  },
  "clearRaw": {
    "itCompanyType": [],
    "itCompanyTypeOther": "",
    "serviceOfferings": [],
    "serviceOfferingsOther": "",
    "differentiation": "",
    "geographicAreas": "",
    "geographicAreaMeta": {},
    "pricingPackaging": "",
    "pricingPackagingOther": "",
    "companyGoals": "",
    "companyGoalsOther": "",
    "brandTone": "",
    "brandToneOther": "",
    "targetIndustries": [],
    "targetIndustriesOther": "",
    "clientSize": "1-50 employees",
    "clientChallenges": [],
    "clientChallengesOther": "",
    "clientOutcomes": [],
    "clientOutcomesOther": "",
    "idealClient": "",
    "serviceOfferingsStructure": {
      "format": "page-tree-v1",
      "pages": []
    },
    "targetIndustriesStructure": {
      "format": "page-tree-v1",
      "pages": []
    }
  },
  "clearPayload": {
    "_rawFormData": {
      "itCompanyType": [],
      "itCompanyTypeOther": "",
      "serviceOfferings": [],
      "serviceOfferingsOther": "",
      "differentiation": "",
      "geographicAreas": "",
      "geographicAreaMeta": {},
      "pricingPackaging": "",
      "pricingPackagingOther": "",
      "companyGoals": "",
      "companyGoalsOther": "",
      "brandTone": "",
      "brandToneOther": "",
      "targetIndustries": [],
      "targetIndustriesOther": "",
      "clientSize": "1-50 employees",
      "clientChallenges": [],
      "clientChallengesOther": "",
      "clientOutcomes": [],
      "clientOutcomesOther": "",
      "idealClient": "",
      "serviceOfferingsStructure": {
        "format": "page-tree-v1",
        "pages": []
      },
      "targetIndustriesStructure": {
        "format": "page-tree-v1",
        "pages": []
      }
    },
    "metadata": {
      "business_name": "SYNTHETIC RELEASE SMOKE",
      "businessDomain": "example.test",
      "submission_datetime": "2026-11-14T18:46:17.344Z",
      "service_type": "express",
      "questionnaire_session_id": "",
      "submit_attempt_id": "",
      "questionnaire_payload_version": 2
    },
    "userdata": {
      "it_company_type": [],
      "it_company_type_other": "",
      "service_offerings": [],
      "service_offerings_other": "",
      "differentiation": "",
      "geographic_areas": "",
      "geographic_area_meta": {},
      "pricing_packaging": "",
      "pricing_packaging_other": "",
      "company_goals": "",
      "company_goals_other": "",
      "brand_tone": "",
      "brand_tone_other": "",
      "target_industries": [],
      "target_industries_other": "",
      "client_size": "1-50 employees",
      "client_challenges": [],
      "client_challenges_other": "",
      "client_outcomes": [],
      "client_outcomes_other": "",
      "ideal_client": "",
      "service_offerings_structure": {
        "format": "page-tree-v1",
        "pages": []
      },
      "target_industries_structure": {
        "format": "page-tree-v1",
        "pages": []
      }
    }
  }
};
const runId = crypto.randomUUID();
const sessionId = `release_smoke_${runId}`;
const accessKey = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const businessName = `SYNTHETIC RELEASE SMOKE ${runId.slice(0, 8)} DO NOT DELIVER`;
const domain = `release-smoke-${runId.slice(0, 8)}.example.test`;
const submitAttemptId = `release_smoke_attempt_${runId}`;
const clientInstanceId = `release_smoke_client_${runId}`;
const ids = { sessionId, draftId: '', submissionId: '', intakeId: '' };
let stage = 'bootstrap';
const expect = (condition, message) => { if (!condition) throw new Error(`${stage}: ${message}`); };
const invoke = async (name, body) => { const result = await base44.functions.invoke(name, body); return result?.data || result; };
const draftCall = (body) => invoke('questionnaireDraftData', { sessionId, accessKey, ...body });
const raw = JSON.parse(JSON.stringify(FIXTURE.raw));
const clearRaw = JSON.parse(JSON.stringify(FIXTURE.clearRaw));
const withIdentity = (source) => ({ ...JSON.parse(JSON.stringify(source)), metadata: { ...source.metadata, business_name: businessName, businessDomain: domain, questionnaire_session_id: sessionId, submit_attempt_id: submitAttemptId, submission_datetime: new Date().toISOString() } });
const payload = withIdentity(FIXTURE.payload);
const clearPayload = withIdentity(FIXTURE.clearPayload);
const draftValues = (responses, mapped, revision) => ({ status: 'draft', business_name: businessName, domain, responses_json: JSON.stringify(responses), mapped_payload_json: JSON.stringify(mapped), metadata_json: JSON.stringify(mapped.metadata), userdata_json: JSON.stringify(mapped.userdata), client_revision: revision });
const save = (responses, mapped, sequence, baseRevision, clear = false) => draftCall({ action: clear ? 'checkpoint' : 'save', ...(clear ? { checkpointType: 'explicit_clear' } : {}), mutationId: `release-smoke-${runId}-${sequence}`, clientInstanceId, clientSequence: sequence, baseRevision, changedKeys: Object.keys(responses), deletedKeys: [], draft: draftValues(responses, mapped, sequence) });
try {
  const boot = await draftCall({ action: 'bootstrap_new_client', newClientRequestId: `release_smoke_new_${runId}`, identity: { business_name: businessName, domain }, storageAvailable: true, urlCredentialPersisted: true });
  expect(boot.success && boot.bootstrapConfirmed && boot.draftId, 'bootstrap did not confirm a new draft');
  ids.draftId = boot.draftId;
  let revision = Number(boot.lastConfirmedRevision || 0);
  stage = 'save and reload';
  const saved = await save(raw, payload, 1, revision);
  expect(saved.success && saved.saved && !saved.stale, 'first save not confirmed');
  revision = saved.lastConfirmedRevision;
  let loaded = await draftCall({ action: 'load' });
  expect(loaded.draft?.responses_json === JSON.stringify(raw), 'rich answers did not reload exactly');
  expect(JSON.parse(loaded.draft.mapped_payload_json).metadata.questionnaire_payload_version === 2, 'version marker missing');
  stage = 'explicit clear';
  const cleared = await save(clearRaw, clearPayload, 2, revision, true);
  expect(cleared.saved && cleared.materialized && !cleared.stale, 'clear was not durably acknowledged');
  revision = cleared.lastConfirmedRevision;
  loaded = await draftCall({ action: 'load' });
  expect(loaded.draft?.responses_json === JSON.stringify(clearRaw), 'cleared values did not reload');
  stage = 'restore';
  const restored = await save(raw, payload, 3, revision);
  expect(restored.saved && !restored.stale, 'restore did not save');
  revision = restored.lastConfirmedRevision;
  stage = 'final persistence without delivery';
  const submissionBody = { questionnaireSessionId: sessionId, submitAttemptId, draftId: ids.draftId, draftAccessKey: accessKey, rawResponses: raw, transformedPayload: payload, submitContext: { businessName, domain, source: 'synthetic_release_smoke_no_delivery' } };
  const submitted = await invoke('submitExpressQuestionnaireFallback', submissionBody);
  ids.submissionId = submitted.submissionId || '';
  ids.intakeId = submitted.intakeId || '';
  expect(submitted.success && submitted.submissionCreated && ids.submissionId && submitted.zapierSent === false, 'fallback did not create an undelivered final receipt');
  const final = await base44.entities.FormSubmission.get(ids.submissionId);
  expect(final.raw_responses_json === JSON.stringify(raw), 'final record lost rich raw answers');
  expect(final.questionnaire_payload_version === 2, 'flattened final version missing');
  expect(final.zapier_sent !== true && final.zapier_delivery_status === 'not_attempted', 'unexpected delivery status');
  const compactStoredDto = (tree) => {
    expect(tree?.format === 'page-tree-v1' && Array.isArray(tree.pages), 'stored DTO has no page tree');
    const read = (page, child = false) => {
      expect(page && Object.keys(page).every((key) => ['id', 'label', 'source', 'catalogId', 'children'].includes(key)), 'stored DTO has unsupported fields');
      expect(page.id == null && page.catalogId == null, 'new compact DTO has unexpected real editor identity');
      expect(typeof page.label === 'string' && ['predefined', 'custom'].includes(page.source), 'stored DTO page content is invalid');
      expect(page.children === undefined || Array.isArray(page.children), 'stored DTO children are invalid');
      expect(!child || !page.children?.length, 'stored DTO contains grandchildren');
      return { label: page.label, source: page.source, ...(!child && page.children?.length ? { children: page.children.map((value) => read(value, true)) } : {}) };
    };
    return { format: tree.format, pages: tree.pages.map((page) => read(page)) };
  };
  const storedPayload = JSON.parse(final.transformed_payload_json);
  for (const field of ['service_offerings_structure', 'target_industries_structure']) {
    const wireStructure = JSON.stringify(storedPayload.userdata[field]);
    expect(!wireStructure.includes('catalogId') && !wireStructure.includes('"id":'), 'serialized submission leaked editor identity');
    expect(JSON.stringify(compactStoredDto(final[field])) === wireStructure, 'entity DTO differs from compact serialized page content');
  }
  expect(JSON.stringify(storedPayload.userdata.service_offerings_structure).includes('SYNTHETIC Help Desk'), 'compact serialized structure is missing pages');
  stage = 'idempotent retry';
  const duplicate = await invoke('submitExpressQuestionnaireFallback', submissionBody);
  expect(duplicate.success && duplicate.alreadySubmitted && duplicate.submissionId === ids.submissionId && duplicate.zapierSent === false, 'retry did not reuse the exact receipt');
  const finals = await base44.entities.FormSubmission.filter({ submit_attempt_id: submitAttemptId }, '-created_date', 10);
  expect(finals.length === 1, 'duplicate final records exist');
  stage = 'finalized stale-save and clear holds';
  const stale = await save(clearRaw, clearPayload, 4, revision);
  expect(stale.saved === false && stale.finalized === true, 'a stale save was not held');
  const heldClear = await save(clearRaw, clearPayload, 5, revision, true);
  expect(heldClear.saved === false && heldClear.finalized === true, 'a finalized clear was not held');
  loaded = await draftCall({ action: 'load' });
  expect(loaded.draft.responses_json === JSON.stringify(raw) && loaded.draft.final_submission_id === ids.submissionId, 'finalized state changed');
  const intakes = await base44.entities.FormSubmissionIntake.filter({ questionnaire_session_id: sessionId }, '-created_date', 20);
  expect(intakes.every((intake) => intake.status !== 'auto_repair_pending'), 'synthetic intake entered automatic delivery queue');
  const versions = await base44.entities.QuestionnaireVersion.filter({ draft_id: ids.draftId }, 'created_date', 30);
  expect(versions.some((version) => version.version_type === 'explicit_clear') && versions.some((version) => version.version_type === 'submitted_snapshot'), 'clear/submitted history missing');
  console.log(JSON.stringify({ ok: true, ...ids, checks: ['bootstrap', 'save', 'reload', 'clear', 'restore', 'compact-v2-final', 'idempotent-retry', 'finalized-save-hold', 'finalized-clear-hold', 'retained-history'], webhookInvoked: false, automaticRepairPending: false, retainedSyntheticRows: true }));
} catch (error) {
  let recoveryHoldConfirmed = true;
  try {
    const pending = await base44.entities.FormSubmissionIntake.filter({ questionnaire_session_id: sessionId }, '-created_date', 20);
    for (const intake of pending) {
      if (intake.status === 'auto_repair_pending') await base44.entities.FormSubmissionIntake.update(intake.id, { status: 'received_intake', active_investigation: true, primary_error_json: JSON.stringify({ code: 'synthetic_release_smoke_no_delivery', message: 'SYNTHETIC ONLY: automatic delivery held after persistence smoke failure.' }) });
    }
  } catch { recoveryHoldConfirmed = false; }
  console.log(JSON.stringify({ ok: false, ...ids, stage, error: error instanceof Error ? error.message : 'Smoke assertion failed', recoveryHoldConfirmed, webhookInvoked: false }));
  throw new Error(`Synthetic persistence smoke failed at ${stage}. Inspect only session ${sessionId}; recovery hold confirmed: ${recoveryHoldConfirmed}.`);
}
