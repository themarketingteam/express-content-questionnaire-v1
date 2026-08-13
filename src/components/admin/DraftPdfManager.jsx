import React, { useCallback, useState } from "react";
import { ChevronDown, ChevronUp, Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import {
  buildQuestionnairePdfFilename,
  createQuestionnairePDF,
  EXPRESS_PDF_TEMPLATE_VERSION,
} from "@/components/questionnaire/PDFGenerator.js";
import {
  createPdfPayloadFingerprint,
  prepareDraftPdfInput,
  selectReusablePdfVersion,
  sortPdfVersions,
} from "@/lib/adminDraftPdf";

function responseData(response) {
  return response?.data || response || {};
}

function displayDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function downloadStoredVersion(version) {
  try {
    const response = await fetch(version.pdf_file_url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Stored PDF returned ${response.status}`);
    const blob = await response.blob();
    triggerBlobDownload(blob, version.pdf_filename || "Express_Questionnaire_Responses.pdf");
  } catch {
    const anchor = document.createElement("a");
    anchor.href = version.pdf_file_url;
    anchor.download = version.pdf_filename || "Express_Questionnaire_Responses.pdf";
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
  }
}

export default function DraftPdfManager({ draft, recoveryGrant = "" }) {
  const [versions, setVersions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [downloadingVersionId, setDownloadingVersionId] = useState("");

  const loadHistory = useCallback(async ({ silent = false } = {}) => {
    if (!draft?.id) return [];
    if (!silent) setLoadingHistory(true);
    try {
      const response = await base44.functions.invoke("draftRecoveryData", {
        action: "listPdfVersions",
        draftId: draft.id,
        recoveryGrant,
      });
      const data = responseData(response);
      if (!data.success) throw new Error(data.error || "Failed to load saved PDFs.");
      const sorted = sortPdfVersions(data.pdfVersions || []);
      setVersions(sorted);
      return sorted;
    } catch (error) {
      if (!silent) toast.error(error?.message || "Failed to load saved PDFs.");
      return [];
    } finally {
      if (!silent) setLoadingHistory(false);
    }
  }, [draft?.id, recoveryGrant]);

  const handleToggleHistory = async () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    await loadHistory();
    setHistoryOpen(true);
  };

  const handleDownloadCurrentPdf = async () => {
    if (preparing || !draft?.id) return;
    setPreparing(true);

    try {
      const contextResponse = await base44.functions.invoke("draftRecoveryData", {
        action: "getPdfContext",
        draftId: draft.id,
        recoveryGrant,
      });
      const context = responseData(contextResponse);
      if (!context.success) throw new Error(context.error || "Failed to load the latest submission values.");

      const input = prepareDraftPdfInput({
        draft: context.draft || draft,
        submission: context.submission || null,
      });
      const payloadHash = await createPdfPayloadFingerprint(input);
      const currentVersions = sortPdfVersions(context.pdfVersions || versions);
      const reusableVersion = selectReusablePdfVersion(currentVersions, payloadHash);

      if (reusableVersion) {
        setVersions(currentVersions);
        await downloadStoredVersion(reusableVersion);
        toast.success(`Downloaded saved PDF version ${reusableVersion.version_number}.`);
        return;
      }

      const { pdf } = createQuestionnairePDF(
        input.formData,
        input.businessName,
        input.domain,
        { submittedAt: input.submittedAt },
      );
      const pdfBlob = pdf.output("blob");
      const filename = buildQuestionnairePdfFilename(input.businessName);
      const file = new File([pdfBlob], filename, { type: "application/pdf" });
      const uploadResult = await base44.integrations.Core.UploadFile({ file });
      const fileUrl = uploadResult?.file_url || uploadResult?.data?.file_url;
      if (!fileUrl) throw new Error("The PDF was generated, but Base44 did not return a saved file URL.");

      const saveResponse = await base44.functions.invoke("draftRecoveryData", {
        action: "createPdfVersion",
        draftId: input.draftId,
        questionnaireSessionId: input.questionnaireSessionId,
        submissionId: input.submissionId,
        submitAttemptId: input.submitAttemptId,
        payloadHash,
        payloadSource: input.source,
        payloadJson: JSON.stringify(input.payloadSnapshot),
        sourceUpdatedAt: input.sourceUpdatedAt,
        pdfFileUrl: fileUrl,
        pdfFilename: filename,
        pdfByteSize: file.size,
        templateVersion: EXPRESS_PDF_TEMPLATE_VERSION,
        businessName: input.businessName,
        businessDomain: input.domain,
        recoveryGrant,
      });
      const saveData = responseData(saveResponse);
      if (!saveData.success || !saveData.version) {
        throw new Error(saveData.error || "The PDF was generated but its saved version could not be recorded.");
      }

      const updatedVersions = sortPdfVersions([
        saveData.version,
        ...currentVersions.filter((version) => version.id !== saveData.version.id),
      ]);
      setVersions(updatedVersions);
      triggerBlobDownload(pdfBlob, saveData.version.pdf_filename || filename);
      toast.success(
        saveData.reused
          ? `Downloaded saved PDF version ${saveData.version.version_number}.`
          : `Created, saved, and downloaded PDF version ${saveData.version.version_number}.`,
      );
    } catch (error) {
      toast.error(error?.message || "Failed to prepare the submission PDF.");
    } finally {
      setPreparing(false);
    }
  };

  const handleDownloadVersion = async (version) => {
    if (!version?.pdf_file_url) return;
    setDownloadingVersionId(version.id || String(version.version_number));
    try {
      await downloadStoredVersion(version);
      toast.success(`Downloaded PDF version ${version.version_number}.`);
    } finally {
      setDownloadingVersionId("");
    }
  };

  return (
    <div className="w-full border border-indigo-200 rounded-lg bg-indigo-50/60 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
          disabled={preparing}
          onClick={handleDownloadCurrentPdf}
          title="Downloads the newest saved PDF when the payload is unchanged, or creates and saves a new version when values changed."
        >
          {preparing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {preparing ? "Preparing PDF..." : "Download PDF"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="text-xs gap-1.5 border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50"
          disabled={loadingHistory}
          onClick={handleToggleHistory}
        >
          {loadingHistory ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          Saved PDFs ({versions.length})
          {historyOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </Button>

        <p className="text-[10px] text-indigo-700">
          Payload changes automatically create a new retained version.
        </p>
      </div>

      {historyOpen && (
        <div className="border-t border-indigo-200 pt-2 space-y-1.5">
          {versions.length === 0 ? (
            <p className="text-xs text-slate-500">No PDF has been saved yet. The first download will generate and save version 1.</p>
          ) : versions.map((version, index) => {
            const versionId = version.id || String(version.version_number);
            const isDownloading = downloadingVersionId === versionId;
            return (
              <div key={versionId} className="flex flex-wrap items-center justify-between gap-2 bg-white border border-indigo-100 rounded px-2.5 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700">
                    Version {version.version_number}
                    {index === 0 && <span className="ml-1.5 text-[10px] text-indigo-700">Latest saved</span>}
                  </p>
                  <p className="text-[10px] text-slate-500 truncate">
                    {displayDate(version.generated_at || version.created_date)} · {version.payload_source || "unknown source"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] gap-1"
                  disabled={isDownloading}
                  onClick={() => handleDownloadVersion(version)}
                >
                  {isDownloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                  Download v{version.version_number}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
