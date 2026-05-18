import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Save,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileMenuButton } from "@/components/PageHeader";
import ProxySetupGuide from "@/components/ProxySetupGuide";

interface ProjectSettingsData {
  helpCustomUrl: string | null;
}

interface ProjectData {
  id: string;
  name: string;
  slug: string;
}

interface TestProxyResponse {
  ok: boolean;
  status: number;
  snippet?: string;
  error?: string;
}

function HelpCenterSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [customUrl, setCustomUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestProxyResponse | null>(null);

  const { data: project } = useQuery<ProjectData>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      return res.json();
    },
  });

  const { data: settings, isLoading } = useQuery<ProjectSettingsData>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch project settings");
      return res.json();
    },
  });

  useEffect(() => {
    if (settings) {
      setCustomUrl(settings.helpCustomUrl ?? "");
    }
  }, [settings]);

  function validateCustomUrl(value: string): string | null {
    if (!value) return null;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return "Must be a valid URL";
    }
    if (parsed.protocol !== "https:") return "Must use HTTPS";
    if (value.endsWith("/")) return "Must not end with a trailing slash";
    const host = parsed.hostname.toLowerCase();
    if (host === "replymaven.com" || host.endsWith(".replymaven.com")) {
      return "Cannot point at replymaven.com";
    }
    return null;
  }

  const saveSettings = useMutation({
    mutationFn: async () => {
      const trimmed = customUrl.trim();
      const error = validateCustomUrl(trimmed);
      if (error) {
        setValidationError(error);
        throw new Error(error);
      }
      setValidationError(null);

      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ helpCustomUrl: trimmed || null }),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to save settings" }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to save settings",
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["project-settings", projectId],
      });
      toast.success("Settings saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const testProxy = useMutation({
    mutationFn: async (): Promise<TestProxyResponse> => {
      const trimmed = customUrl.trim();
      const error = validateCustomUrl(trimmed);
      if (error) throw new Error(error);

      const res = await fetch(`/api/projects/${projectId}/help/test-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customUrl: trimmed }),
      });
      const data = (await res.json()) as TestProxyResponse;
      return data;
    },
    onSuccess: (data) => {
      setTestResult(data);
      if (data.ok) {
        toast.success("Proxy is configured correctly");
      } else {
        toast.error(data.error ?? "Proxy test failed");
      }
    },
    onError: (err: Error) => {
      setTestResult(null);
      toast.error(err.message);
    },
  });

  const dirty = (settings?.helpCustomUrl ?? "") !== customUrl;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <MobileMenuButton />
        <div className="flex-1">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link to={`/app/projects/${projectId}/help`}>
              <ArrowLeft className="w-4 h-4" />
              Back to Help Center
            </Link>
          </Button>
          <h1 className="font-heading text-3xl tracking-tight">
            Help Center Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure how your help center is served.
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-card/50 backdrop-blur-xl border border-border p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Custom Domain
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Host your help center under your own domain. Configure a reverse
            proxy on your side to forward requests here. Leave empty to use
            replymaven.com/help/{project?.slug ?? "your-slug"}.
          </p>
        </div>

        <div className="space-y-2">
          <Input
            type="url"
            placeholder="https://yourdomain.com/docs"
            value={customUrl}
            onChange={(e) => {
              setCustomUrl(e.target.value);
              setValidationError(null);
              setTestResult(null);
            }}
            disabled={isLoading || saveSettings.isPending}
          />
          {validationError && (
            <p className="text-xs text-destructive">{validationError}</p>
          )}
          {!validationError && customUrl && (
            <p className="text-xs text-muted-foreground">
              Your help center will be served at{" "}
              <code className="rounded bg-muted px-1.5 py-0.5">
                {customUrl}
              </code>
              .
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => saveSettings.mutate()}
            disabled={!dirty || saveSettings.isPending}
          >
            {saveSettings.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={() => testProxy.mutate()}
            disabled={!customUrl.trim() || testProxy.isPending}
          >
            {testProxy.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            Test connection
          </Button>
        </div>

        {testResult && (
          <div
            className={
              testResult.ok
                ? "rounded-xl bg-status-active/10 px-4 py-3 text-sm"
                : "rounded-xl bg-destructive/10 px-4 py-3 text-sm"
            }
          >
            <div className="flex items-start gap-2">
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-status-active" />
              ) : (
                <XCircle className="h-4 w-4 mt-0.5 text-destructive" />
              )}
              <div className="flex-1">
                <p className="font-medium">
                  {testResult.ok
                    ? `Connected (HTTP ${testResult.status})`
                    : `Failed (HTTP ${testResult.status})`}
                </p>
                {testResult.error && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {testResult.error}
                  </p>
                )}
                {testResult.snippet && (
                  <pre className="text-xs text-muted-foreground mt-2 overflow-x-auto rounded bg-muted/40 p-2">
                    <code>{testResult.snippet}</code>
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {project?.slug && <ProxySetupGuide projectSlug={project.slug} />}
    </div>
  );
}

export default HelpCenterSettings;
