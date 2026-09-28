import React, { useMemo } from "react";
import { AlertTriangle, CopyPlus, History, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { questionnaireVersionOptionLabel } from "@/lib/questionnaireVersionHistory";

function displayDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export default function QuestionnaireVersionSelector({
  catalog,
  mode,
  selectedVersionId,
  selectedVersion,
  loading,
  detailLoading,
  error,
  onModeChange,
  onSelect,
  onCreateCopy,
  copyLoading,
}) {
  const versions = catalog?.versions || [];
  const showSession = Number(catalog?.sessionCount || 0) > 1;
  const grouped = useMemo(() => {
    if (!showSession) return [];
    const groups = new Map();
    versions.forEach((version) => {
      const sessionId = version.sessionId || "Unknown session";
      groups.set(sessionId, [...(groups.get(sessionId) || []), version]);
    });
    return [...groups.entries()];
  }, [showSession, versions]);

  return (
    <section className="questionnaire-version-panel" aria-label="Questionnaire version history">
      <div className="questionnaire-version-panel__header">
        <div>
          <p className="questionnaire-version-panel__kicker"><History aria-hidden="true" /> Questionnaire Version</p>
          <p className="questionnaire-version-panel__copy">
            Choose a retained version. Every detail, payload, copy action, and PDF below uses the selected version.
          </p>
        </div>
        <div className="questionnaire-version-panel__totals">
          <span>{Number(catalog?.totalVersions || 0)} retained version{Number(catalog?.totalVersions || 0) === 1 ? "" : "s"}</span>
          {Number(catalog?.sessionCount || 0) > 1 && <span>{catalog.sessionCount} related sessions</span>}
        </div>
      </div>

      {loading ? (
        <div className="questionnaire-version-panel__loading" role="status">
          <Loader2 className="animate-spin" /> Loading retained versions…
        </div>
      ) : error ? (
        <div className="questionnaire-version-panel__error" role="alert">
          <AlertTriangle /> {error}
        </div>
      ) : (
        <>
          <div className="questionnaire-version-panel__controls">
            <select
              value={selectedVersionId || ""}
              onChange={(event) => onSelect(event.target.value)}
              disabled={detailLoading || versions.length === 0}
              aria-label="Select retained questionnaire version"
            >
              {!selectedVersionId && <option value="">Select a retained version</option>}
              {showSession ? grouped.map(([sessionId, sessionVersions]) => (
                <optgroup key={sessionId} label={`Session ${sessionId}`}>
                  {sessionVersions.map((version) => (
                    <option key={version.id} value={version.id}>{questionnaireVersionOptionLabel(version, { formatDate: displayDate })}</option>
                  ))}
                </optgroup>
              )) : versions.map((version) => (
                <option key={version.id} value={version.id}>{questionnaireVersionOptionLabel(version, { formatDate: displayDate })}</option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="brand-button-secondary questionnaire-version-panel__mode"
              onClick={() => onModeChange(mode === "all" ? "meaningful" : "all")}
              disabled={loading}
            >
              {mode === "all"
                ? `Show Key Versions (${Number(catalog?.keyVersionCount || 0)})`
                : `Show All Autosaves (${Number(catalog?.totalVersions || 0)})`}
            </Button>
          </div>

          {catalog?.truncated && (
            <p className="questionnaire-version-panel__truncated">
              <AlertTriangle /> This catalog reached its {catalog.safetyCeiling?.toLocaleString?.() || catalog.safetyCeiling} version safety ceiling. Older versions remain retained but are not shown here.
            </p>
          )}

          {selectedVersion && (
            <div className="questionnaire-version-panel__selection" aria-live="polite">
              <span className={`questionnaire-version-panel__badge questionnaire-version-panel__badge--${selectedVersion.status === "submitted" ? "submitted" : "draft"}`}>
                {selectedVersion.status === "submitted" ? "submitted snapshot" : "draft snapshot"}
              </span>
              <span>Saved {displayDate(selectedVersion.capturedAt)}</span>
              <span>·</span>
              <span>{selectedVersion.answerCount} populated answers</span>
              <span>·</span>
              <span>Source: {selectedVersion.type}</span>
              {detailLoading && <Loader2 className="animate-spin" aria-label="Loading selected version" />}
            </div>
          )}

          {selectedVersion?.readOnly && (
            <div className="questionnaire-version-panel__readonly">
              <div>
                <strong>Read-only historical version</strong>
                <p>Editing, retrying, AI repair, deletion, and client-link actions are disabled so this retained snapshot cannot overwrite the active draft.</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="brand-button-secondary"
                disabled={copyLoading || detailLoading}
                onClick={onCreateCopy}
              >
                {copyLoading ? <Loader2 className="animate-spin" /> : <CopyPlus />}
                {copyLoading ? "Creating Copy…" : "Create Editable Recovery Copy"}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
