import React from "react";
import { AlertCircle, RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default class QuestionnaireErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      resetting: false
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    
    // Call onBeforeReset if provided (for diagnostic backup)
    if (this.props.onBeforeReset) {
      try {
        this.props.onBeforeReset({ error, errorInfo });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = async () => {
    const confirmed = window.confirm(
      "This will clear locally saved questionnaire answers in this browser. Continue?"
    );
    
    if (!confirmed) return;

    this.setState({ resetting: true });
    
    try {
      if (this.props.onResetLocalState) {
        await this.props.onResetLocalState();
      }
    } catch {
      // Continue with reload even if reset fails
    }
    
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-6">
          <Card className="max-w-lg w-full shadow-lg">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-red-600" />
              </div>
              <CardTitle className="text-2xl font-bold" style={{ fontFamily: 'Raleway, sans-serif', color: '#004B87' }}>
                Something went wrong loading the questionnaire
              </CardTitle>
              <CardDescription className="text-base mt-2" style={{ fontFamily: 'Lato, sans-serif', color: '#3D5A73' }}>
                Your saved browser data may be outdated or corrupted. You can reload the page or reset local saved questionnaire data and start fresh.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {this.props.recoveryCode && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center">
                  <p className="text-sm font-semibold text-slate-700">Recovery code:</p>
                  <p className="text-lg font-mono text-slate-900 mt-1">{this.props.recoveryCode}</p>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  onClick={this.handleReload}
                  disabled={this.state.resetting}
                  className="flex-1"
                  style={{ backgroundColor: '#009ADD', fontFamily: 'Lato, sans-serif' }}
                >
                  <RefreshCcw className="w-4 h-4 mr-2" />
                  Reload Page
                </Button>
                <Button
                  onClick={this.handleReset}
                  disabled={this.state.resetting}
                  variant="outline"
                  className="flex-1"
                  style={{ borderColor: '#004B87', color: '#004B87', fontFamily: 'Lato, sans-serif' }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {this.state.resetting ? "Resetting..." : "Reset Local Saved Data"}
                </Button>
              </div>

              {import.meta.env.DEV && this.state.error && (
                <Alert variant="destructive" className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Development Error Details</AlertTitle>
                  <AlertDescription className="mt-2 font-mono text-xs whitespace-pre-wrap">
                    {this.state.error.toString()}
                    {this.state.errorInfo?.componentStack && (
                      <div className="mt-2 pt-2 border-t border-slate-200">
                        <strong>Component Stack:</strong>
                        {this.state.errorInfo.componentStack}
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}