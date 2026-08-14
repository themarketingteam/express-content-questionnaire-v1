import React from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { isPasswordProtectedAdminPath } from "@/lib/publicRoutes";
import {
  isExpressAdminUser,
  getAdminAccessDeniedMessage,
  getAdminAccessLoadingLabel,
} from "@/lib/adminAccess";

export default function AdminOnly({ children }) {
  const location = useLocation();
  const { user, isLoadingAuth, isLoadingPublicSettings, isAuthenticated, navigateToLogin } = useAuth();

  // Defensive fallback if Base44 regenerates this route inside an admin wrapper.
  if (isPasswordProtectedAdminPath(location.pathname)) {
    return children;
  }

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 border-4 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
        <p className="text-sm text-slate-500">{getAdminAccessLoadingLabel()}</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center px-6">
        <div className="max-w-sm w-full bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center space-y-4">
          <h2 className="text-lg font-bold text-slate-800" style={{ fontFamily: "Raleway, sans-serif" }}>
            Sign in required
          </h2>
          <p className="text-sm text-slate-500">
            Please sign in with an authorized admin account to view Express questionnaire admin tools.
          </p>
          <Button
            onClick={() => navigateToLogin ? navigateToLogin() : window.location.assign("/login")}
            className="w-full font-bold uppercase tracking-wider text-sm"
            style={{ backgroundColor: "#004B87", color: "white", borderRadius: "2px" }}
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
        <div className="max-w-sm w-full bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center space-y-4">
          <h2 className="text-lg font-bold text-slate-800" style={{ fontFamily: "Raleway, sans-serif" }}>
            Access denied
          </h2>
          <p className="text-sm text-slate-500">{getAdminAccessDeniedMessage()}</p>
          {user.email && (
            <p className="text-xs text-slate-400">Signed in as {user.email}</p>
          )}
        </div>
      </div>
    );
  }

  return children;
}
