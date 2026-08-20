import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Save,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { ProxySetupBody } from "@/components/ProxySetupGuide";
import {
  CustomCssEditor,
  HELP_CUSTOM_CSS_CLASSES,
} from "@/components/custom-css-editor";
import HelpTopNavEditor, {
  type HelpTopNavItem,
} from "@/components/help-top-nav-editor";
import { useSubscription } from "@/hooks/use-subscription";
import { canAccessFeature } from "@/lib/plan";

interface ProjectSettingsData {
  helpCustomUrl: string | null;
  helpTopNav: HelpTopNavItem[] | null;
  helpCustomCss: string | null;
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
  const [topNav, setTopNav] = useState<HelpTopNavItem[]>([]);
  const [topNavError, setTopNavError] = useState<string | null>(null);
  const [customCss, setCustomCss] = useState("");
  const { data: subData } = useSubscription();
  const canCustomCss = canAccessFeature(subData?.limits ?? null, "customCss");

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
      setTopNav(Array.isArray(settings.helpTopNav) ? settings.helpTopNav : []);
      setCustomCss(settings.helpCustomCss ?? "");
    }
  }, [settings]);

  function validateTopNav(items: HelpTopNavItem[]): string | null {
    if (items.length > 3) return "Maximum 3 top-nav links";
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const label = item.label.trim();
      const href = item.href.trim();
      if (!label) return `Link ${i + 1}: label is required`;
      if (label.length > 40) return `Link ${i + 1}: label too long (max 40)`;
      if (!href) return `Link ${i + 1}: URL is required`;
      if (href.length > 2048) return `Link ${i + 1}: URL too long`;
      let parsed: URL;
      try {
        parsed = new URL(href);
      } catch {
        return `Link ${i + 1}: URL is not valid`;
      }
      if (parsed.protocol !== "https:") {
        return `Link ${i + 1}: must use HTTPS`;
      }
      const host = parsed.hostname.toLowerCase();
      if (host === "replymaven.com" || host.endsWith(".replymaven.com")) {
        return `Link ${i + 1}: cannot point at replymaven.com`;
      }
      if (item.classes !== null && item.classes !== undefined) {
        if (typeof item.classes !== "string" || item.classes.length > 300) {
          return `Link ${i + 1}: classes too long`;
        }
        if (!/^[a-zA-Z0-9:/_\-[\]().,%! ]*$/.test(item.classes)) {
          return `Link ${i + 1}: classes contain invalid characters`;
        }
      }
    }
    return null;
  }

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

      const normalizedTopNav = topNav.map((item) => ({
        label: item.label.trim(),
        href: item.href.trim(),
        classes: item.classes ? item.classes.trim() || null : null,
      }));
      const topNavMsg = validateTopNav(normalizedTopNav);
      if (topNavMsg) {
        setTopNavError(topNavMsg);
        throw new Error(topNavMsg);
      }
      setTopNavError(null);

      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          helpCustomUrl: trimmed || null,
          helpTopNav:
            normalizedTopNav.length === 0 ? null : normalizedTopNav,
          helpCustomCss: customCss.trim() || null,
        }),
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

  const savedTopNav = settings?.helpTopNav ?? [];
  const dirty =
    (settings?.helpCustomUrl ?? "") !== customUrl ||
    JSON.stringify(savedTopNav) !== JSON.stringify(topNav) ||
    (settings?.helpCustomCss ?? "") !== customCss;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to={`/app/projects/${projectId}/knowledgebase/help-center`}>
            <ArrowLeft className="w-4 h-4" />
            Back to Articles
          </Link>
        </Button>
        <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
          Help Center Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure how your help center is served.
        </p>
      </div>

      <div className="rounded-2xl bg-card/50 backdrop-blur-xl border border-border p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Custom Domain
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Serve help on your domain with a 200 rewrite, then save that URL
            here. Set up the rewrite first. After you save,{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">
              replymaven.com/help/{project?.slug ?? "your-slug"}
            </code>{" "}
            301s to your path. Leave empty to keep the hosted URL.
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
          {project?.slug && (
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="ml-auto">
                  <BookOpen className="h-4 w-4" />
                  Reverse proxy setup
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="inset-y-3 right-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] sm:max-w-xl rounded-2xl border border-border p-0 gap-0 overflow-hidden"
              >
                <SheetHeader className="px-6 pt-6 pb-4 pr-14">
                  <SheetTitle>Reverse proxy setup</SheetTitle>
                  <SheetDescription>
                    Rewrite <code>/docs</code> on your domain to ReplyMaven
                    with a 200. Do not 301. Send the proxy header, test the
                    connection, then save the custom URL.
                  </SheetDescription>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto px-6 pb-6">
                  <ProxySetupBody projectSlug={project.slug} />
                </div>
              </SheetContent>
            </Sheet>
          )}
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

      <div className="rounded-2xl bg-card/50 backdrop-blur-xl border border-border p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Top navigation
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Add up to 3 links or buttons that appear in the top-right of your
            help center.
          </p>
        </div>

        <HelpTopNavEditor
          value={topNav}
          onChange={(next) => {
            setTopNav(next);
            setTopNavError(null);
          }}
          disabled={isLoading || saveSettings.isPending}
        />

        {topNavError && (
          <p className="text-xs text-destructive">{topNavError}</p>
        )}
      </div>

      <div className="rounded-2xl bg-card/50 backdrop-blur-xl border border-border p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Custom CSS
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Override help center styles. Type . to insert a class. Set
            --help-heading-weight on :root to change all headings. Changes can
            take up to two minutes to show on the live pages.
          </p>
        </div>

        <CustomCssEditor
          value={customCss}
          onChange={setCustomCss}
          classes={HELP_CUSTOM_CSS_CLASSES}
          disabled={
            isLoading ||
            saveSettings.isPending ||
            (!canCustomCss && !customCss.trim())
          }
          placeholder={`:root {
  --help-heading-weight: 600;
}`}
        />

        {!canCustomCss && (
          <p className="text-xs text-muted-foreground">
            Custom CSS is available on the Business plan.
          </p>
        )}

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
      </div>

    </div>
  );
}

export default HelpCenterSettings;
