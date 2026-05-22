import React from "react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import {
  isExpressAdminUser,
  getAdminAccessDeniedMessage,
  getAdminAccessLoadingLabel,
} from "@/lib/adminAccess";

export default function AdminOnly({ children }) {
  const { user, isLoadingAuth, isLoadingPublicSettings, isAuthenticated, navigateToLogin } =
    useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 border-4 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
        <p className="text-sm text-slate-500">{getAdminAccessLoadingLabel()}</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="fixed inset-0 flex items-center justify-center px-6">
        <div className="w-full max-w-sm border border-slate-200 rounded-xl bg-white shadow-sm p-8 flex flex-col items-center text-center gap-4">
          <h2 className="text-lg font-semibold text-slate-800">Sign in required</h2>
          <p className="text-sm text-slate-500">
            Please sign in with an authorized admin account to view Express questionnaire admin tools.
          </p>
          <Button
            onClick={() =>
              navigateToLogin
                ? navigateToLogin()
                : window.location.assign("/login")
            }
            className="w-full"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  if (!isExpressAdminUser(user)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center px-6">
        <div className="w-full max-w-sm border border-slate-200 rounded-xl bg-white shadow-sm p-8 flex flex-col items-center text-center gap-4">
          <h2 className="text-lg font-semibold text-slate-800">Access denied</h2>
          <p className="text-sm text-slate-500">{getAdminAccessDeniedMessage()}</p>
          {user?.email && (
            <p className="text-xs text-slate-400">Signed in as {user.email}</p>
          )}
        </div>
      </div>
    );
  }

  return children;
}