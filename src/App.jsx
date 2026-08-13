import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import AdminSubmitIntake from './pages/AdminSubmitIntake';
import TestZapier from './pages/TestZapier';
import FormDraftRecovery from './pages/FormDraftRecovery';
import AdminOnly from '@/components/admin/AdminOnly';
import QuestionnaireIntakeRecoveryPage from './pages/QuestionnaireIntakeRecovery';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import QuestionnaireRouteBoundary from '@/components/questionnaire/QuestionnaireRouteBoundary';
import { isPublicDraftRecoveryPath } from '@/lib/publicRoutes';
import { DraftRecoveryAccessProvider } from '@/lib/DraftRecoveryAccessContext';
import DraftRecoveryAccessGate from '@/components/admin/DraftRecoveryAccessGate';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/" element={
        mainPageKey === "Questionnaire" ? (
          <QuestionnaireRouteBoundary>
            <LayoutWrapper currentPageName={mainPageKey}>
              <MainPage />
            </LayoutWrapper>
          </QuestionnaireRouteBoundary>
        ) : (
          <LayoutWrapper currentPageName={mainPageKey}>
            <MainPage />
          </LayoutWrapper>
        )
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            path === "Questionnaire" ? (
              <QuestionnaireRouteBoundary>
                <LayoutWrapper currentPageName={path}>
                  <Page />
                </LayoutWrapper>
              </QuestionnaireRouteBoundary>
            ) : (
              <LayoutWrapper currentPageName={path}>
                <Page />
              </LayoutWrapper>
            )
          }
        />
      ))}
      <Route path="/admin/submit-intake" element={
        <AdminOnly>
          <LayoutWrapper currentPageName={"admin/submit-intake"}>
            <AdminSubmitIntake />
          </LayoutWrapper>
        </AdminOnly>
      } />
      <Route path="/admin/questionnaire-intake-recovery" element={
        <AdminOnly>
          <LayoutWrapper currentPageName={"admin/questionnaire-intake-recovery"}>
            <QuestionnaireIntakeRecoveryPage />
          </LayoutWrapper>
        </AdminOnly>
      } />
      <Route path="/TestZapier" element={
        <AdminOnly>
          <LayoutWrapper currentPageName={"TestZapier"}>
            <TestZapier />
          </LayoutWrapper>
        </AdminOnly>
      } />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

const AppContent = () => {
  const location = useLocation();

  // Keep the recovery route outside Base44 login redirects so password-grant
  // access can work. The suffix match supports deployments below a base path.
  if (isPublicDraftRecoveryPath(location.pathname)) {
    return (
      <DraftRecoveryAccessProvider>
        <DraftRecoveryAccessGate>
          <LayoutWrapper currentPageName={"admin/draft-recovery"}>
            <FormDraftRecovery />
          </LayoutWrapper>
        </DraftRecoveryAccessGate>
      </DraftRecoveryAccessProvider>
    );
  }

  return <AuthenticatedApp />;
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AppContent />
        </Router>
        <Toaster />
        <VisualEditAgent />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
