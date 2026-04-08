import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Check, ExternalLink, Lightbulb, RefreshCw, Save, X } from "lucide-react";
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
  autoCloseMinutes: number | null;
  autoRefinement: boolean;
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
    autoCloseMinutes: 30 as number | null,
    autoRefinement: true,
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
      autoCloseMinutes: settings.autoCloseMinutes ?? 30,
      autoRefinement: settings.autoRefinement ?? true,
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
        autoCloseMinutes: companyForm.autoCloseMinutes,
        autoRefinement: companyForm.autoRefinement,
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

  // ─── Context Suggestions ──────────────────────────────────────────────────

  interface ContextSuggestion {
    id: string;
    type: "update_context";
    sourceConversationId: string | null;
    suggestion: string;
    reasoning: string | null;
  }

  const { data: contextSuggestions } = useQuery<ContextSuggestion[]>({
    queryKey: ["knowledge-suggestions-context", projectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions?type=update_context`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 60_000,
  });

  const approveContext = useMutation({
    mutationFn: async (sugId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions/${sugId}/approve`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to approve");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions-context", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestion-counts", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-settings", projectId] });
    },
  });

  const rejectContext = useMutation({
    mutationFn: async (sugId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-suggestions/${sugId}/reject`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to reject");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestions-context", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-suggestion-counts", projectId] });
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

      {/* Context Suggestions */}
      {contextSuggestions && contextSuggestions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              AI Suggestions
            </h2>
            <span className="inline-flex items-center justify-center px-1.5 h-5 text-[10px] font-bold bg-primary text-primary-foreground rounded-full">
              {contextSuggestions.length}
            </span>
          </div>
          {contextSuggestions.map((s) => {
            const payload = JSON.parse(s.suggestion);
            return (
              <div
                key={s.id}
                className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-primary/20 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-primary">
                      Add to company context
                    </p>
                    {s.reasoning && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {s.reasoning}
                      </p>
                    )}
                    {s.sourceConversationId && (
                      <Link
                        to={`/app/projects/${projectId}/conversations?id=${s.sourceConversationId}`}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground mt-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View conversation
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => approveContext.mutate(s.id)}
                      disabled={approveContext.isPending}
                      className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors"
                      title="Approve and apply"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectContext.mutate(s.id)}
                      disabled={rejectContext.isPending}
                      className="p-1.5 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                      title="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="bg-muted/30 rounded-xl p-3">
                  <p className="text-xs text-foreground whitespace-pre-wrap">
                    {payload.appendText}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

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

        {/* ─── Auto-Close ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-foreground">
                Auto-Close Inactive Conversations
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automatically close conversations with no activity after a set period.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={companyForm.autoCloseMinutes !== null}
              onClick={() =>
                setCompanyForm((prev) => ({
                  ...prev,
                  autoCloseMinutes: prev.autoCloseMinutes === null ? 30 : null,
                }))
              }
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors",
                companyForm.autoCloseMinutes !== null ? "bg-primary" : "bg-input",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform mt-0.5",
                  companyForm.autoCloseMinutes !== null ? "translate-x-[22px]" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
          {companyForm.autoCloseMinutes !== null && (
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={5}
                max={1440}
                value={companyForm.autoCloseMinutes}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setCompanyForm((prev) => ({
                    ...prev,
                    autoCloseMinutes: isNaN(val) ? 30 : Math.min(1440, Math.max(5, val)),
                  }));
                }}
                className="w-24 px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-sm text-muted-foreground">minutes of inactivity</span>
            </div>
          )}
        </div>

        {/* ─── Auto-Refinement ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-foreground">
              Auto-Suggest Knowledgebase Improvements
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">
              After conversations close, the AI analyzes them and suggests improvements to your knowledge base.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={companyForm.autoRefinement}
            onClick={() =>
              setCompanyForm((prev) => ({
                ...prev,
                autoRefinement: !prev.autoRefinement,
              }))
            }
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors",
              companyForm.autoRefinement ? "bg-primary" : "bg-input",
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform mt-0.5",
                companyForm.autoRefinement ? "translate-x-[22px]" : "translate-x-0.5",
              )}
            />
          </button>
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
