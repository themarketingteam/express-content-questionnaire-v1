import React, { useState } from "react";
import { LockKeyhole, Loader2 } from "lucide-react";
import "@fontsource/figtree/300.css";
import "@fontsource/figtree/400.css";
import "@fontsource/figtree/500.css";
import "@fontsource/figtree/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EXPRESS_TEMPLATE_LOGO_DATA_URI } from "@/components/questionnaire/expressTemplateLogo.js";
import { useDraftRecoveryAccess } from "@/lib/DraftRecoveryAccessContext";
import "@/pages/FormDraftRecovery.css";

export default function DraftRecoveryAccessGate({ children }) {
  const { recoveryGrant, isChecking, error, unlock } = useDraftRecoveryAccess();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isChecking) {
    return (
      <main className="draft-recovery-brand draft-recovery-gate">
        <div className="draft-recovery-gate__checking" role="status">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p>Checking recovery access...</p>
        </div>
      </main>
    );
  }
  if (recoveryGrant) return children;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!password) return;
    setIsSubmitting(true);
    try {
      const granted = await unlock(password);
      if (granted) setPassword("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="draft-recovery-brand draft-recovery-gate">
      <form onSubmit={handleSubmit} className="draft-recovery-gate__card" aria-labelledby="draft-recovery-access-title">
        <div className="draft-recovery-gate__logo-wrap">
          <img
            src={EXPRESS_TEMPLATE_LOGO_DATA_URI}
            alt="Kaseya MSP Success Digital"
            className="draft-recovery-brand__logo draft-recovery-gate__logo"
          />
        </div>

        <div className="draft-recovery-gate__body">
          <div className="draft-recovery-gate__icon" aria-hidden="true">
            <LockKeyhole className="w-5 h-5" />
          </div>
          <p className="draft-recovery-brand__section-kicker">Admin support workspace</p>
          <h1 id="draft-recovery-access-title">Draft Recovery Access</h1>
          <p className="draft-recovery-gate__copy">
            Enter the admin password to open draft recovery. Access remains available in this browser for seven days.
          </p>

          <label htmlFor="draft-recovery-password" className="draft-recovery-gate__label">Password</label>
          <Input
            id="draft-recovery-password"
            type="password"
            autoComplete="current-password"
            aria-label="Recovery password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            className="draft-recovery-gate__input"
          />
          {error && <p role="alert" className="draft-recovery-gate__error">{error}</p>}
          <Button type="submit" className="brand-button-primary w-full" disabled={isSubmitting || !password}>
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting ? "Unlocking..." : "Unlock draft recovery"}
          </Button>
        </div>
      </form>
    </main>
  );
}
