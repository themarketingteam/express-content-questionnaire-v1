import { jsPDF } from "jspdf";
import { format } from "date-fns";
import { normalizeExpressFormData } from "../../lib/expressQuestionnairePayload.js";
import { EXPRESS_TEMPLATE_LOGO_DATA_URI } from "./expressTemplateLogo.js";

export const EXPRESS_PDF_TEMPLATE_VERSION = "express-template-v1";

export const QUESTIONS = [
  { id: 1, title: "What type of IT company are you?", field: "itCompanyType", otherField: "itCompanyTypeOther" },
  { id: 2, title: "What are your primary service offerings?", field: "serviceOfferings", otherField: "serviceOfferingsOther" },
  { id: 3, title: "What makes your company different from other MSPs in your area?", field: "differentiation" },
  { id: 4, title: "What is your primary city of service or geological region of service?", field: "geographicAreas" },
  { id: 5, title: "How do you typically price or package your services?", field: "pricingPackaging", otherField: "pricingPackagingOther" },
  { id: 6, title: "What are your company's biggest goals over the next year?", field: "companyGoals", otherField: "companyGoalsOther" },
  { id: 7, title: "What tone best describes how you want your brand to sound on your website?", field: "brandTone", otherField: "brandToneOther" },
  { id: 8, title: "What types of businesses do you primarily serve?", field: "targetIndustries", otherField: "targetIndustriesOther" },
  { id: 9, title: "What is the typical size of your client companies?", field: "clientSize" },
  { id: 10, title: "What are the main IT challenges your clients come to you for help with?", field: "clientChallenges", otherField: "clientChallengesOther" },
  { id: 11, title: "What outcomes do your clients want most from working with you?", field: "clientOutcomes", otherField: "clientOutcomesOther" },
  { id: 12, title: "Briefly describe your ideal client.", field: "idealClient" },
];

const TEMPLATE = Object.freeze({
  pageWidth: 612,
  minimumPageHeight: 1978.4,
  contentLeft: 39.6,
  contentRight: 572.35,
  contentWidth: 532.75,
  questionColumnWidth: 266.35,
  answerColumnLeft: 306,
  businessLabelWidth: 177.55,
  businessAnswerLeft: 217.2,
  businessAnswerWidth: 355.15,
  businessBarHeight: 22.35,
  businessRowGap: 0.05,
  sectionBarHeight: 22.45,
  sectionToRowGap: 15.15,
  rowGap: 17.15,
  bottomMargin: 122.55,
});

const COLORS = Object.freeze({
  purple: "#6464FF",
  questionPurple: "#3030FF",
  palePurple: "#ECECFF",
  paleRule: "#C7C7FF",
  divider: "#E2E2E9",
  label: "#4B4F63",
  black: "#000000",
  white: "#FFFFFF",
  unanswered: "#6B7280",
});

// These minimums reproduce the row proportions in Express_Template.pdf.
const QUESTION_MIN_HEIGHTS = Object.freeze([
  75.95,
  103.95,
  117.95,
  89.95,
  89.95,
  89.95,
  89.95,
  89.95,
  75.95,
  103.95,
  103.95,
  103.95,
]);

function toPdfText(value) {
  const normalized = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");

  return Array.from(normalized)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === 10 || (codePoint >= 32 && codePoint !== 127);
    })
    .join("")
    .trim();
}

export function buildQuestionnairePdfFilename(businessName, generatedAt = new Date()) {
  const cleanName = toPdfText(businessName).replace(/[^a-zA-Z0-9]/g, "") || "Business";
  const date = generatedAt instanceof Date ? generatedAt : new Date(generatedAt || Date.now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${cleanName}_Questionnaire_Responses_${format(safeDate, "M-d-yy")}.pdf`;
}

export function formatAnswer(field, formData, otherField) {
  const value = formData?.[field];
  const otherValue = otherField ? formData?.[otherField] : "";
  let parts = [];

  if (field === "geographicAreas") {
    const meta = formData?.geographicAreaMeta;
    const label = meta?.label || (typeof value === "string" ? value : "");
    parts = label && String(label).trim() ? [String(label).trim()] : [];
  } else if (Array.isArray(value)) {
    parts = value.filter(Boolean).map(String);
  } else if (value && typeof value === "object" && value.label) {
    parts = [String(value.label)];
  } else if (typeof value === "string" && value.trim()) {
    parts = [value.trim()];
  }

  if (otherValue && String(otherValue).trim()) {
    parts.push(`Other: ${String(otherValue).trim()}`);
  }

  return toPdfText(parts.length > 0 ? parts.join(", ") : "Not answered");
}

function splitText(pdf, text, width, { size = 10, style = "normal" } = {}) {
  pdf.setFont("helvetica", style);
  pdf.setFontSize(size);
  return pdf.splitTextToSize(toPdfText(text), width);
}

function calculateBusinessRows(pdf, businessName, domain, submissionDate) {
  return [businessName, domain, submissionDate].map((answer) => {
    const lines = splitText(pdf, answer || "Not provided", TEMPLATE.businessAnswerWidth - 17, {
      size: 10.5,
    });
    const height = Math.max(33.95, 13 + lines.length * 12.6);
    return { answer: answer || "Not provided", lines, height };
  });
}

function calculateQuestionRows(pdf, formData) {
  return QUESTIONS.map((question, index) => {
    const answer = formatAnswer(question.field, formData, question.otherField);
    const questionLines = splitText(pdf, question.title, TEMPLATE.questionColumnWidth - 17, {
      size: 10,
      style: "bold",
    });
    const answerLines = splitText(pdf, answer, TEMPLATE.questionColumnWidth - 17, {
      size: 10,
      style: answer === "Not answered" ? "italic" : "normal",
    });
    const questionContentHeight = 35.75 + questionLines.length * 12.1 + 9;
    const answerContentHeight = 18 + answerLines.length * 12.6 + 10;
    const height = Math.max(
      QUESTION_MIN_HEIGHTS[index],
      questionContentHeight,
      answerContentHeight,
    );

    return {
      ...question,
      answer,
      answerLines,
      questionLines,
      height,
      y: 0,
    };
  });
}

function calculateLayout(pdf, formData, businessName, domain, submittedAt) {
  const submissionDate = format(submittedAt, "M/d/yyyy");
  const businessRows = calculateBusinessRows(pdf, businessName, domain, submissionDate);
  const questionRows = calculateQuestionRows(pdf, formData);

  const businessRowsTop = 335;
  const businessRowsBottom = businessRowsTop
    + businessRows.reduce((sum, row) => sum + row.height, 0)
    + TEMPLATE.businessRowGap * (businessRows.length - 1);
  const sectionOneTop = businessRowsBottom + 19.65;
  let cursorY = sectionOneTop + TEMPLATE.sectionBarHeight + TEMPLATE.sectionToRowGap;

  questionRows.slice(0, 7).forEach((row) => {
    row.y = cursorY;
    cursorY += row.height + TEMPLATE.rowGap;
  });

  const sectionTwoTop = cursorY;
  cursorY = sectionTwoTop + TEMPLATE.sectionBarHeight + TEMPLATE.sectionToRowGap;

  questionRows.slice(7).forEach((row, index, sectionRows) => {
    row.y = cursorY;
    cursorY += row.height;
    if (index < sectionRows.length - 1) cursorY += TEMPLATE.rowGap;
  });

  const pageHeight = Math.max(
    TEMPLATE.minimumPageHeight,
    cursorY + TEMPLATE.bottomMargin,
  );

  return {
    businessRows,
    businessRowsBottom,
    businessRowsTop,
    pageHeight,
    questionRows,
    sectionOneTop,
    sectionTwoTop,
    submissionDate,
  };
}

function drawHeader(pdf) {
  pdf.addImage(EXPRESS_TEMPLATE_LOGO_DATA_URI, "PNG", 48.65, 89.45, 183.6, 35.3);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(27);
  pdf.setTextColor(COLORS.purple);
  pdf.text("Website Content", 39.7, 165);
  pdf.text("Questionnaire", 39.7, 195.1);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10.5);
  pdf.setTextColor(COLORS.black);
  pdf.text("MSP Success - Express Service", 39.7, 219.6);

  pdf.setDrawColor(COLORS.paleRule);
  pdf.setLineWidth(0.75);
  pdf.line(TEMPLATE.contentLeft, 288.1, TEMPLATE.contentRight, 288.1);
}

/** @param {number} height */
function drawSectionBar(pdf, y, label, height = TEMPLATE.sectionBarHeight) {
  pdf.setFillColor(COLORS.purple);
  pdf.rect(TEMPLATE.contentLeft, y, TEMPLATE.contentWidth, height, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10.5);
  pdf.setTextColor(COLORS.white);
  pdf.text(label, 48.2, y + 15.4);
}

function drawBusinessInformation(pdf, layout) {
  drawSectionBar(pdf, 297.5, "Business Information", TEMPLATE.businessBarHeight);

  const labels = ["Business Name", "Domain", "Submission Date"];
  let y = layout.businessRowsTop;

  layout.businessRows.forEach((row, index) => {
    pdf.setFillColor(COLORS.palePurple);
    pdf.rect(TEMPLATE.contentLeft, y, TEMPLATE.businessLabelWidth, row.height, "F");
    pdf.setFillColor(COLORS.white);
    pdf.rect(TEMPLATE.businessAnswerLeft, y, TEMPLATE.businessAnswerWidth, row.height, "F");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(COLORS.label);
    pdf.text(labels[index], 47.95, y + 22.5);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10.5);
    pdf.setTextColor(COLORS.black);
    pdf.text(row.lines, 225, y + 21.5, { lineHeightFactor: 1.2 });

    y += row.height;
    if (index < layout.businessRows.length - 1) y += TEMPLATE.businessRowGap;
    pdf.setDrawColor(COLORS.divider);
    pdf.setLineWidth(0.5);
    pdf.line(TEMPLATE.contentLeft, y + 0.25, TEMPLATE.businessAnswerLeft, y + 0.25);
  });
}

function drawQuestionRow(pdf, row) {
  pdf.setFillColor(COLORS.palePurple);
  pdf.rect(TEMPLATE.contentLeft, row.y, TEMPLATE.questionColumnWidth, row.height, "F");
  pdf.setFillColor(COLORS.white);
  pdf.rect(TEMPLATE.answerColumnLeft, row.y, TEMPLATE.questionColumnWidth, row.height, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(COLORS.questionPurple);
  pdf.text(`Question ${row.id}:`, 47.95, row.y + 16.5);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(COLORS.black);
  pdf.text(row.questionLines, 47.95, row.y + 35.75, { lineHeightFactor: 1.21 });

  const unanswered = row.answer === "Not answered";
  pdf.setFont("helvetica", unanswered ? "italic" : "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(unanswered ? COLORS.unanswered : COLORS.black);
  pdf.text(row.answerLines, 314.35, row.y + 18, { lineHeightFactor: 1.26 });
}

export function createQuestionnairePDF(formData, businessName, domain, options = {}) {
  const normalizedFormData = normalizeExpressFormData(formData || {});
  const submittedAt = options.submittedAt instanceof Date
    ? options.submittedAt
    : new Date(options.submittedAt || Date.now());
  const safeBusinessName = toPdfText(businessName) || "Not provided";
  const safeDomain = toPdfText(domain) || "Not provided";

  const measurementPdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: [TEMPLATE.pageWidth, TEMPLATE.minimumPageHeight],
    compress: true,
  });
  const layout = calculateLayout(
    measurementPdf,
    normalizedFormData,
    safeBusinessName,
    safeDomain,
    submittedAt,
  );

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: [TEMPLATE.pageWidth, layout.pageHeight],
    compress: true,
  });

  pdf.setProperties({
    title: `${safeBusinessName} Website Content Questionnaire`,
    subject: "MSP Success - Express questionnaire responses",
    author: "Kaseya MSP Success Digital",
    creator: "MSP Success - Express",
    keywords: "Kaseya, MSP, Success, Digital, website, content, questionnaire",
  });

  drawHeader(pdf);
  drawBusinessInformation(pdf, layout);
  drawSectionBar(pdf, layout.sectionOneTop, "Section 1: About Your Business");
  layout.questionRows.slice(0, 7).forEach((row) => drawQuestionRow(pdf, row));
  drawSectionBar(pdf, layout.sectionTwoTop, "Section 2: About Your Target Clients");
  layout.questionRows.slice(7).forEach((row) => drawQuestionRow(pdf, row));

  return { layout, pdf };
}

export async function generatePDF(formData, businessName, domain) {
  const filename = buildQuestionnairePdfFilename(businessName);

  try {
    const { pdf } = createQuestionnairePDF(formData, businessName, domain);
    pdf.save(filename);
    return { success: true, filename };
  } catch (error) {
    return { success: false, error: error?.message || "Unable to generate PDF" };
  }
}
