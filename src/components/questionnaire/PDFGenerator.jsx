import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { format } from "date-fns";

const QUESTIONS = [
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

function formatAnswer(field, formData, otherField) {
  const value = formData[field];
  const otherValue = otherField ? formData[otherField] : "";

  let parts = [];

  if (field === "geographicAreas") {
    const meta = formData.geographicAreaMeta;
    const label = meta?.label || value || "";
    parts = label ? [label] : [];
  } else if (Array.isArray(value)) {
    parts = value.filter(Boolean);
  } else if (typeof value === "object" && value !== null) {
    parts = value.label ? [value.label] : [];
  } else if (typeof value === "string" && value.trim()) {
    parts = [value.trim()];
  }

  if (otherValue && otherValue.trim()) {
    parts.push(`Other: ${otherValue.trim()}`);
  }

  return parts.length > 0 ? parts.join(", ") : "Not answered";
}

function buildHTML(formData, businessName, domain) {
  const dateStr = format(new Date(), "M/d/yyyy");
  const blue = "#004B87";
  const lightBlue = "#009ADD";
  const grey = "#7D868D";

  const questionRows = QUESTIONS.map((q) => {
    const answer = formatAnswer(q.field, formData, q.otherField);
    const isNotAnswered = answer === "Not answered";
    return `
      <div style="margin-bottom: 22px; page-break-inside: avoid;">
        <div style="
          border-left: 4px solid ${lightBlue};
          padding: 14px 18px;
          background: #f8fbff;
          border-radius: 0 6px 6px 0;
        ">
          <div style="
            font-size: 11px;
            font-weight: 700;
            color: ${grey};
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin-bottom: 4px;
            font-family: 'Lato', Arial, sans-serif;
          ">Question ${q.id}</div>
          <div style="
            font-size: 13px;
            font-weight: 700;
            color: ${blue};
            margin-bottom: 8px;
            font-family: 'Raleway', Arial, sans-serif;
          ">${q.title}</div>
          <div style="
            font-size: 13px;
            color: ${isNotAnswered ? grey : "#1e293b"};
            font-style: ${isNotAnswered ? "italic" : "normal"};
            line-height: 1.6;
            font-family: 'Lato', Arial, sans-serif;
            white-space: pre-wrap;
          ">${answer}</div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="
      font-family: 'Lato', Arial, sans-serif;
      background: #ffffff;
      width: 794px;
      padding: 0;
    ">
      <!-- Header -->
      <div style="
        background: ${blue};
        padding: 40px 48px 32px;
        margin-bottom: 0;
      ">
        <div style="
          font-size: 11px;
          font-weight: 700;
          color: rgba(255,255,255,0.65);
          text-transform: uppercase;
          letter-spacing: 1.5px;
          margin-bottom: 8px;
          font-family: 'Lato', Arial, sans-serif;
        ">MSP Success - Express</div>
        <div style="
          font-size: 26px;
          font-weight: 700;
          color: #ffffff;
          font-family: 'Raleway', Arial, sans-serif;
          line-height: 1.2;
          margin-bottom: 6px;
        ">Website Content Questionnaire</div>
        <div style="
          font-size: 13px;
          color: rgba(255,255,255,0.75);
          font-family: 'Lato', Arial, sans-serif;
        ">Submitted Responses</div>
      </div>

      <!-- Business Info Bar -->
      <div style="
        background: ${lightBlue};
        padding: 18px 48px;
        display: flex;
        gap: 40px;
        flex-wrap: wrap;
        margin-bottom: 0;
      ">
        <div>
          <div style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.75); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 2px; font-family: 'Lato', Arial, sans-serif;">Business</div>
          <div style="font-size: 14px; font-weight: 700; color: #ffffff; font-family: 'Raleway', Arial, sans-serif;">${businessName}</div>
        </div>
        <div>
          <div style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.75); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 2px; font-family: 'Lato', Arial, sans-serif;">Domain</div>
          <div style="font-size: 14px; font-weight: 700; color: #ffffff; font-family: 'Lato', Arial, sans-serif;">${domain}</div>
        </div>
        <div>
          <div style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.75); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 2px; font-family: 'Lato', Arial, sans-serif;">Submitted</div>
          <div style="font-size: 14px; font-weight: 700; color: #ffffff; font-family: 'Lato', Arial, sans-serif;">${dateStr}</div>
        </div>
      </div>

      <!-- Content -->
      <div style="padding: 36px 48px 48px;">

        <!-- Section 1 -->
        <div style="margin-bottom: 32px;">
          <div style="
            border-bottom: 3px solid ${lightBlue};
            padding-bottom: 10px;
            margin-bottom: 24px;
          ">
            <div style="
              font-size: 16px;
              font-weight: 700;
              color: ${blue};
              font-family: 'Raleway', Arial, sans-serif;
            ">Section 1: About Your Business</div>
          </div>
          ${QUESTIONS.slice(0, 7).map((q) => {
            const answer = formatAnswer(q.field, formData, q.otherField);
            const isNotAnswered = answer === "Not answered";
            return `
              <div style="margin-bottom: 20px;">
                <div style="border-left: 4px solid ${lightBlue}; padding: 14px 18px; background: #f8fbff; border-radius: 0 6px 6px 0;">
                  <div style="font-size: 10px; font-weight: 700; color: ${grey}; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 3px; font-family: 'Lato', Arial, sans-serif;">Question ${q.id}</div>
                  <div style="font-size: 13px; font-weight: 700; color: ${blue}; margin-bottom: 7px; font-family: 'Raleway', Arial, sans-serif;">${q.title}</div>
                  <div style="font-size: 13px; color: ${isNotAnswered ? grey : "#1e293b"}; font-style: ${isNotAnswered ? "italic" : "normal"}; line-height: 1.6; font-family: 'Lato', Arial, sans-serif; white-space: pre-wrap;">${answer}</div>
                </div>
              </div>
            `;
          }).join("")}
        </div>

        <!-- Section 2 -->
        <div>
          <div style="
            border-bottom: 3px solid ${lightBlue};
            padding-bottom: 10px;
            margin-bottom: 24px;
          ">
            <div style="
              font-size: 16px;
              font-weight: 700;
              color: ${blue};
              font-family: 'Raleway', Arial, sans-serif;
            ">Section 2: About Your Target Clients</div>
          </div>
          ${QUESTIONS.slice(7).map((q) => {
            const answer = formatAnswer(q.field, formData, q.otherField);
            const isNotAnswered = answer === "Not answered";
            return `
              <div style="margin-bottom: 20px;">
                <div style="border-left: 4px solid ${lightBlue}; padding: 14px 18px; background: #f8fbff; border-radius: 0 6px 6px 0;">
                  <div style="font-size: 10px; font-weight: 700; color: ${grey}; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 3px; font-family: 'Lato', Arial, sans-serif;">Question ${q.id}</div>
                  <div style="font-size: 13px; font-weight: 700; color: ${blue}; margin-bottom: 7px; font-family: 'Raleway', Arial, sans-serif;">${q.title}</div>
                  <div style="font-size: 13px; color: ${isNotAnswered ? grey : "#1e293b"}; font-style: ${isNotAnswered ? "italic" : "normal"}; line-height: 1.6; font-family: 'Lato', Arial, sans-serif; white-space: pre-wrap;">${answer}</div>
                </div>
              </div>
            `;
          }).join("")}
        </div>

        <!-- Footer -->
        <div style="
          margin-top: 36px;
          padding-top: 18px;
          border-top: 1px solid #e2e8f0;
          text-align: center;
          color: ${grey};
          font-size: 11px;
          font-family: 'Lato', Arial, sans-serif;
        ">© 2025 Kaseya Limited. MSP Success - Express Website Questionnaire.</div>

      </div>
    </div>
  `;
}

export async function generatePDF(formData, businessName, domain) {
  const cleanName = businessName.replace(/[^a-zA-Z0-9]/g, "");
  const dateStr = format(new Date(), "M-d-yy");
  const filename = `${cleanName}_Questionnaire_Responses_${dateStr}.pdf`;

  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "794px";
  container.style.background = "#ffffff";
  container.innerHTML = buildHTML(formData, businessName, domain);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });

    const imgWidth = 210; // mm (A4 width)
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [imgWidth, imgHeight],
    });

    const imgData = canvas.toDataURL("image/png");
    pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
    pdf.save(filename);

    return { success: true, filename };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    document.body.removeChild(container);
  }
}