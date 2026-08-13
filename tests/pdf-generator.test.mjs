import assert from "node:assert/strict";
import test from "node:test";

import {
  createQuestionnairePDF,
  formatAnswer,
} from "../src/components/questionnaire/PDFGenerator.js";

const FIXED_DATE = new Date("2026-08-13T12:00:00-05:00");

const completeFormData = {
  itCompanyType: ["Managed Services Provider (MSP)"],
  serviceOfferings: ["Managed IT", "Cybersecurity", "Microsoft 365"],
  differentiation: "A proactive, security-first service model.",
  geographicAreas: "Nashville, TN",
  geographicAreaMeta: { label: "Greater Nashville Area", source: "google" },
  pricingPackaging: "Flat-rate monthly (fully managed)",
  companyGoals: "Acquire more clients",
  brandTone: "Confident & Authoritative Expert",
  targetIndustries: ["Healthcare / Medical", "Legal Firms"],
  clientSize: "10-150 employees",
  clientChallenges: ["Cybersecurity concerns or breaches"],
  clientOutcomes: ["Peace of mind about security"],
  idealClient: "A growing organization that values a long-term technology partnership.",
};

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.01, `${message}: expected ${expected}, received ${actual}`);
}

test("uses geographic metadata and appends Other values", () => {
  assert.equal(
    formatAnswer("geographicAreas", completeFormData),
    "Greater Nashville Area",
  );
  assert.equal(
    formatAnswer(
      "serviceOfferings",
      { serviceOfferings: ["Managed IT"], serviceOfferingsOther: "vCIO" },
      "serviceOfferingsOther",
    ),
    "Managed IT, Other: vCIO",
  );
});

test("reproduces the reference template geometry", () => {
  const { layout, pdf } = createQuestionnairePDF(
    completeFormData,
    "Acme Managed Technology Group",
    "acme-example.com",
    { submittedAt: FIXED_DATE },
  );

  assertClose(pdf.internal.pageSize.getWidth(), 612, "page width");
  assertClose(pdf.internal.pageSize.getHeight(), 1978.4, "page height");
  assertClose(layout.sectionOneTop, 456.6, "section one top");
  assertClose(layout.sectionTwoTop, 1271.9, "section two top");

  const expectedRowTops = [
    494.2,
    587.3,
    708.4,
    843.5,
    950.6,
    1057.7,
    1164.8,
    1309.5,
    1416.6,
    1509.7,
    1630.8,
    1751.9,
  ];
  layout.questionRows.forEach((row, index) => {
    assertClose(row.y, expectedRowTops[index], `question ${row.id} top`);
  });

  assert.equal(layout.questionRows[0].answer, "Managed Services Provider (MSP)");
  assert.equal(layout.questionRows[3].answer, "Greater Nashville Area");
  assert.equal(pdf.getNumberOfPages(), 1);

  const bytes = Buffer.from(pdf.output("arraybuffer"));
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(bytes.length > 30000, "the generated PDF should include the embedded template logo");
});

test("expands long response rows instead of clipping content", () => {
  const longAnswer = Array.from(
    { length: 90 },
    (_, index) => `Detailed response segment ${index + 1}`,
  ).join(" ");
  const { layout, pdf } = createQuestionnairePDF(
    { ...completeFormData, idealClient: longAnswer },
    "Acme Managed Technology Group",
    "acme-example.com",
    { submittedAt: FIXED_DATE },
  );

  const finalRow = layout.questionRows.at(-1);
  assert.ok(finalRow.height > 103.95, "the final response row should grow beyond its template minimum");
  assert.ok(layout.pageHeight > 1978.4, "the single-page canvas should grow with the response row");
  assertClose(
    layout.pageHeight,
    finalRow.y + finalRow.height + 122.55,
    "expanded page bottom margin",
  );
  assertClose(pdf.internal.pageSize.getHeight(), layout.pageHeight, "expanded page height");
  assert.equal(pdf.getNumberOfPages(), 1);
});
