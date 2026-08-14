import React, { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, SearchCheck, X } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getBackendErrorMessage } from "@/lib/draftRecoveryAccess";

function percent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : "—";
}

function decisionLabel(value) {
  return String(value || "unresolved").replace(/_/g, " ");
}

function CandidateCard({
  field,
  label,
  candidate,
  existing,
  confidence,
  decision,
  threshold,
  reasons,
  evidence,
  inspected,
  disabled,
  domainBlocked,
  loading,
  onReview,
}) {
  const hasCandidate = Boolean(candidate);
  const canReview = hasCandidate && !["applied", "confirmed_existing", "rejected_previously"].includes(decision);
  return (
    <section className="identity-resolution__candidate">
      <div className="identity-resolution__candidate-heading">
        <div>
          <p>{label}</p>
          <strong>{existing || candidate || "No candidate found"}</strong>
        </div>
        <div className="identity-resolution__candidate-badges">
          {(hasCandidate || existing) && <Badge variant="outline" className="identity-resolution__badge">{percent(existing ? 1 : confidence)}</Badge>}
          <Badge variant="outline" className="identity-resolution__badge">{decisionLabel(decision)}</Badge>
        </div>
      </div>

      {!existing && hasCandidate && (
        <p className="identity-resolution__threshold">
          Automatic threshold: {Math.round(threshold * 100)}%
        </p>
      )}
      {Array.isArray(reasons) && reasons.length > 0 && (
        <ul className="identity-resolution__reasons">
          {reasons.map((reason, index) => <li key={index}>{reason}</li>)}
        </ul>
      )}
      {Array.isArray(evidence) && evidence.length > 0 && (
        <div className="identity-resolution__evidence">
          <p>Supporting questionnaire evidence</p>
          {evidence.slice(0, 5).map((item, index) => (
            <blockquote key={`${item.path}-${index}`}>
              <span>{item.path}</span>
              {item.text || item.excerpt}
            </blockquote>
          ))}
        </div>
      )}
      {Array.isArray(inspected) && inspected.length > 0 && (
        <div className="identity-resolution__evidence">
          <p>Website evidence</p>
          {inspected.slice(0, 5).map((item, index) => {
            const href = item.fetchedUrl || item.result?.link;
            return (
              <div className="identity-resolution__website" key={`${item.hostname}-${index}`}>
                <span>{item.hostname || "Unverified result"} · {percent(item.confidence)}</span>
                {href && <a href={href} target="_blank" rel="noreferrer">View source <ExternalLink /></a>}
              </div>
            );
          })}
        </div>
      )}

      {canReview && (
        <div className="identity-resolution__actions">
          <Button
            type="button"
            size="sm"
            className="brand-button-primary"
            disabled={disabled || loading || (field === "domain" && domainBlocked)}
            title={field === "domain" && domainBlocked ? "Accept or enter the Business Name first." : undefined}
            onClick={() => onReview(field, "apply")}
          >
            {loading === `${field}:apply` ? <Loader2 className="animate-spin" /> : <Check />}
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="brand-button-secondary"
            disabled={disabled || loading}
            onClick={() => onReview(field, "reject")}
          >
            {loading === `${field}:reject` ? <Loader2 className="animate-spin" /> : <X />}
            Reject
          </Button>
        </div>
      )}
    </section>
  );
}

export default function IdentityResolutionPanel({ resolution, recoveryGrant = "", onReviewed = null }) {
  const [current, setCurrent] = useState(resolution || null);
  const [loading, setLoading] = useState("");

  useEffect(() => setCurrent(resolution || null), [resolution]);
  const fingerprint = current?.currentPayloadFingerprint || current?.payloadFingerprint || "";
  const nameConfirmed = useMemo(() => Boolean(
    current?.businessName?.existing || ["applied", "confirmed_existing"].includes(current?.businessName?.decision),
  ), [current]);

  if (!current) return null;

  const review = async (field, decision) => {
    if (!current.attemptId) {
      toast.error("This result has no reviewable audit attempt.");
      return;
    }
    setLoading(`${field}:${decision}`);
    try {
      const response = await base44.functions.invoke("reviewExpressIdentityResolution", {
        attemptId: current.attemptId,
        field,
        decision,
        expectedFingerprint: fingerprint,
        recoveryGrant,
      });
      const data = response?.data || response;
      if (!data?.ok) throw { response: { data } };
      setCurrent((previous) => {
        const key = field === "business_name" ? "businessName" : "domain";
        const selected = previous?.[key] || {};
        return {
          ...previous,
          currentPayloadFingerprint: data.payloadFingerprint || previous.currentPayloadFingerprint,
          [key]: {
            ...selected,
            decision: decision === "apply" ? "applied" : "rejected",
            existing: decision === "apply" ? selected.candidate : selected.existing,
          },
        };
      });
      toast.success(`${field === "business_name" ? "Business Name" : "Domain"} ${decision === "apply" ? "applied" : "rejected"}.`);
      onReviewed?.(data);
    } catch (error) {
      toast.error(getBackendErrorMessage(error, "Identity review failed."));
    } finally {
      setLoading("");
    }
  };

  return (
    <div className="identity-resolution" data-status={current.status || "unknown"}>
      <div className="identity-resolution__heading">
        <span><SearchCheck /> Identity Recovery</span>
        <Badge variant="outline" className="identity-resolution__badge">{decisionLabel(current.status)}</Badge>
      </div>
      <p className="identity-resolution__meta">
        Primary location: <strong>{current.primaryLocation || "Not found"}</strong>
        {current.resolverVersion ? ` · ${current.resolverVersion}` : ""}
      </p>
      <div className="identity-resolution__grid">
        <CandidateCard
          field="business_name"
          label="Business Name"
          threshold={0.90}
          {...current.businessName}
          loading={loading}
          onReview={review}
        />
        <CandidateCard
          field="domain"
          label="Domain"
          threshold={0.92}
          {...current.domain}
          domainBlocked={!nameConfirmed}
          loading={loading}
          onReview={review}
        />
      </div>
      {current.errors?.length > 0 && (
        <div className="identity-resolution__errors">
          {current.errors.map((error, index) => <p key={index}>{error}</p>)}
        </div>
      )}
    </div>
  );
}
