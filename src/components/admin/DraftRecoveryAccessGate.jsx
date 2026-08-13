import React, { useState } from "react";
import { LockKeyhole, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDraftRecoveryAccess } from "@/lib/DraftRecoveryAccessContext";

export default function DraftRecoveryAccessGate({ children }) {
  const { recoveryGrant, isChecking, error, unlock } = useDraftRecoveryAccess();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isChecking) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-slate-500" /></div>;
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-sm p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"><LockKeyhole className="w-5 h-5 text-slate-700" /></div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">Draft recovery access</h1>
            <p className="text-xs text-slate-500">Enter the Express recovery password.</p>
          </div>
        </div>
        <Input
          type="password"
          autoComplete="current-password"
          aria-label="Recovery password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
        />
        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
        <Button type="submit" className="w-full" disabled={isSubmitting || !password}>
          {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Unlock recovery
        </Button>
      </form>
    </div>
  );
}
