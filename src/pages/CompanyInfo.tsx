import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToneOfVoice = "professional" | "friendly" | "casual" | "formal" | "custom";

interface ProjectSettingsData {
  id: string;
  companyName: string | null;
  companyUrl: string | null;
  companyContext: string | null;
  toneOfVoice: ToneOfVoice;
  customTonePrompt: string | null;
  botName: string | null;
  agentName: string | null;
}

const toneOptions: ToneOfVoice[] = [
  "professional",
  "friendly",
  "casual",
  "formal",
  "custom",
];

function CompanyInfo() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [companyForm, setCompanyForm] = useState({
    companyName: "",
    companyUrl: "",
    companyContext: "",
    toneOfVoice: "professional" as ToneOfVoice,
    customTonePrompt: "",
    botName: "",
    agentName: "",
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
    if (!settings) return;
    setCompanyForm({
      companyName: settings.companyName ?? "",
      companyUrl: settings.companyUrl ?? "",
      companyContext: settings.companyContext ?? "",
      toneOfVoice: settings.toneOfVoice ?? "professional",
      customTonePrompt: settings.customTonePrompt ?? "",
      botName: settings.botName ?? "",
      agentName: settings.agentName ?? "",
    });
  }, [settings]);

  const { data: resources } = useQuery<{ id: string }[]>({
    queryKey: ["resources", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources`);
      if (!res.ok) throw new Error("Failed to fetch resources");
      return res.json();
    },
  });
  const hasResources = (resources?.length ?? 0) > 0;

  const saveCompanyInfo = useMutation({
    mutationFn: async () => {
      const body = {
        companyName: companyForm.companyName.trim() || null,
        companyUrl: companyForm.companyUrl.trim() || null,
        companyContext: companyForm.companyContext.trim() || null,
        toneOfVoice: companyForm.toneOfVoice,
        customTonePrompt:
          companyForm.toneOfVoice === "custom"
            ? companyForm.customTonePrompt.trim() || null
            : null,
        botName: companyForm.botName.trim() || null,
        agentName: companyForm.agentName.trim() || null,
      };
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to save company info" }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to save company info",
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["project-settings", projectId],
      });
    },
  });

  const [lastContextRefreshSource, setLastContextRefreshSource] = useState<
    "resources" | "website" | null
  >(null);

  const refreshCompanyContext = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/context/refresh`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to refresh context" }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to refresh context",
        );
      }
      return res.json() as Promise<{
        context: string;
        refreshed: boolean;
        source: "resources" | "website";
      }>;
    },
    onSuccess: (data) => {
      setLastContextRefreshSource(data.source);
      setCompanyForm((prev) => ({
        ...prev,
        companyContext: data.context,
      }));
      queryClient.invalidateQueries({
        queryKey: ["project-settings", projectId],
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link
          to={`/app/projects/${projectId}/knowledgebase`}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            Company Information
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Set up your company context and tone of voice for AI responses.
          </p>
        </div>
      </div>

      <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => refreshCompanyContext.mutate()}
              disabled={
                refreshCompanyContext.isPending ||
                (!hasResources && !companyForm.companyUrl.trim())
              }
            >
              <RefreshCw
                className={cn(
                  "w-4 h-4 mr-2",
                  refreshCompanyContext.isPending && "animate-spin",
                )}
              />
              {hasResources
                ? "Regenerate from Resources"
                : "Refresh from Website"}
            </Button>
            <Button
              onClick={() => saveCompanyInfo.mutate()}
              disabled={saveCompanyInfo.isPending}
            >
              <Save className="w-4 h-4 mr-2" />
              {saveCompanyInfo.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        {saveCompanyInfo.isError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {saveCompanyInfo.error.message}
          </div>
        )}
        {refreshCompanyContext.isError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {refreshCompanyContext.error.message}
          </div>
        )}
        {saveCompanyInfo.isSuccess && (
          <p className="text-sm text-success">Company info saved.</p>
        )}
        {refreshCompanyContext.isSuccess && (
          <p className="text-sm text-success">
            {lastContextRefreshSource === "resources"
              ? "Company context regenerated from resources."
              : "Company context refreshed from website."}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Company Name
            </label>
            <input
              type="text"
              value={companyForm.companyName}
              onChange={(e) =>
                setCompanyForm((prev) => ({
                  ...prev,
                  companyName: e.target.value,
                }))
              }
              placeholder="Your company name"
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Website URL
            </label>
            <input
              type="url"
              value={companyForm.companyUrl}
              onChange={(e) =>
                setCompanyForm((prev) => ({
                  ...prev,
                  companyUrl: e.target.value,
                }))
              }
              placeholder="https://example.com"
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Assistant Name
            </label>
            <input
              type="text"
              value={companyForm.botName}
              onChange={(e) => {
                const val = e.target.value.replace(/[^a-zA-Z0-9_-]/g, "");
                setCompanyForm((prev) => ({
                  ...prev,
                  botName: val.slice(0, 16),
                }));
              }}
              placeholder="e.g. Luna, Alex, Maya"
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Give your chatbot a name. No spaces, max 16 characters. Used in
              conversations and Telegram commands.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Human Agent Label
            </label>
            <input
              type="text"
              value={companyForm.agentName}
              onChange={(e) =>
                setCompanyForm((prev) => ({
                  ...prev,
                  agentName: e.target.value.slice(0, 50),
                }))
              }
              placeholder="e.g. a team member, an engineer, our support team"
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              What should the bot call your team when handing off to a human?
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Tone of Voice
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {toneOptions.map((tone) => (
              <button
                key={tone}
                onClick={() =>
                  setCompanyForm((prev) => ({ ...prev, toneOfVoice: tone }))
                }
                className={`px-4 py-2.5 rounded-xl border text-sm capitalize transition-colors ${
                  companyForm.toneOfVoice === tone
                    ? "border-primary bg-primary/10 text-foreground font-medium"
                    : "border-input bg-background text-muted-foreground hover:border-primary/50"
                }`}
              >
                {tone}
              </button>
            ))}
          </div>
          {companyForm.toneOfVoice === "custom" && (
            <textarea
              value={companyForm.customTonePrompt}
              onChange={(e) =>
                setCompanyForm((prev) => ({
                  ...prev,
                  customTonePrompt: e.target.value,
                }))
              }
              rows={3}
              placeholder="Describe the tone you want your bot to use..."
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Company Context
          </label>
          <textarea
            value={companyForm.companyContext}
            onChange={(e) =>
              setCompanyForm((prev) => ({
                ...prev,
                companyContext: e.target.value,
              }))
            }
            rows={8}
            placeholder="Describe your business, products, policies, and anything the assistant should know."
            className="w-full px-4 py-3 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {isLoading && (
          <p className="text-xs text-muted-foreground">
            Loading company info...
          </p>
        )}
      </div>
    </div>
  );
}

export default CompanyInfo;
