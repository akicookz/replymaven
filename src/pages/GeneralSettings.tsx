import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Copy, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  workingHours: string | null;
  avgResponseTime: string | null;
}

const toneOptions: ToneOfVoice[] = [
  "professional",
  "friendly",
  "casual",
  "formal",
  "custom",
];

const AUTO_CLOSE_OPTIONS = [
  { value: 15, label: "After 15 minutes" },
  { value: 30, label: "After 30 minutes" },
  { value: 60, label: "After 1 hour" },
  { value: 240, label: "After 4 hours" },
  { value: 720, label: "After 12 hours" },
  { value: 1440, label: "After 1 day" },
];

const inputClass =
  "w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

function GeneralSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    companyName: "",
    companyUrl: "",
    companyContext: "",
    toneOfVoice: "professional" as ToneOfVoice,
    customTonePrompt: "",
    botName: "",
    agentName: "",
    autoCloseMinutes: 30 as number | null,
    workingHours: "",
    avgResponseTime: "",
  });

  const { data: settings, isLoading } = useQuery<ProjectSettingsData>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch project settings");
      return res.json();
    },
  });

  const { data: project } = useQuery<{ slug: string }>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      return res.json();
    },
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      companyName: settings.companyName ?? "",
      companyUrl: settings.companyUrl ?? "",
      companyContext: settings.companyContext ?? "",
      toneOfVoice: settings.toneOfVoice ?? "professional",
      customTonePrompt: settings.customTonePrompt ?? "",
      botName: settings.botName ?? "",
      agentName: settings.agentName ?? "",
      autoCloseMinutes: settings.autoCloseMinutes ?? 30,
      workingHours: settings.workingHours ?? "",
      avgResponseTime: settings.avgResponseTime ?? "",
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

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        companyName: form.companyName.trim() || null,
        companyUrl: form.companyUrl.trim() || null,
        companyContext: form.companyContext.trim() || null,
        toneOfVoice: form.toneOfVoice,
        customTonePrompt:
          form.toneOfVoice === "custom"
            ? form.customTonePrompt.trim() || null
            : null,
        botName: form.botName.trim() || null,
        agentName: form.agentName.trim() || null,
        autoCloseMinutes: form.autoCloseMinutes,
        workingHours: form.workingHours.trim() || null,
        avgResponseTime: form.avgResponseTime.trim() || null,
      };
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const [lastContextRefreshSource, setLastContextRefreshSource] = useState<
    "resources" | "website" | null
  >(null);

  const refreshContext = useMutation({
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
      setForm((prev) => ({ ...prev, companyContext: data.context }));
      queryClient.invalidateQueries({
        queryKey: ["project-settings", projectId],
      });
      toast.success("Context refreshed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function copySlug() {
    if (!project?.slug) return;
    navigator.clipboard
      .writeText(project.slug)
      .then(() => toast.success("Slug copied"))
      .catch(() => toast.error("Failed to copy"));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            General
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Company profile, voice, and conversation behavior.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => refreshContext.mutate()}
            disabled={
              refreshContext.isPending ||
              (!hasResources && !form.companyUrl.trim())
            }
          >
            <RefreshCw
              className={cn(
                "w-4 h-4 mr-2",
                refreshContext.isPending && "animate-spin",
              )}
            />
            {hasResources ? "Regenerate Context" : "Refresh from Website"}
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || isLoading}
          >
            <Save className="w-4 h-4 mr-2" />
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {save.isError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {save.error.message}
        </div>
      )}
      {refreshContext.isError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {refreshContext.error.message}
        </div>
      )}

      <SectionCard
        title="Company"
        description="Who the assistant is representing."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Company Name
            </label>
            <input
              type="text"
              value={form.companyName}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, companyName: e.target.value }))
              }
              placeholder="Your company name"
              className={inputClass}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Website URL
            </label>
            <input
              type="url"
              value={form.companyUrl}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, companyUrl: e.target.value }))
              }
              placeholder="https://example.com"
              className={inputClass}
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
              value={form.botName}
              onChange={(e) => {
                const val = e.target.value.replace(/[^a-zA-Z0-9_-]/g, "");
                setForm((prev) => ({ ...prev, botName: val.slice(0, 16) }));
              }}
              placeholder="e.g. Luna, Alex, Maya"
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">
              No spaces, max 16 characters. Used in conversations and Telegram
              commands.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Human Agent Label
            </label>
            <input
              type="text"
              value={form.agentName}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  agentName: e.target.value.slice(0, 50),
                }))
              }
              placeholder="e.g. a team member, an engineer, our support team"
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">
              What the bot calls your team when handing off to a human.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl bg-muted/30 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Project Slug</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Used in your widget embed, help center URL, and inbound email
              address, so it can't be changed.
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="font-mono text-sm text-foreground">
              {project?.slug ?? ""}
            </span>
            <button
              type="button"
              aria-label="Copy slug"
              onClick={copySlug}
              className="p-1.5 rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Tone of Voice"
        description="How the assistant sounds in every reply."
      >
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {toneOptions.map((tone) => (
            <button
              key={tone}
              onClick={() =>
                setForm((prev) => ({ ...prev, toneOfVoice: tone }))
              }
              className={`px-4 py-2.5 rounded-xl border text-sm capitalize transition-colors ${
                form.toneOfVoice === tone
                  ? "border-primary bg-primary/10 text-foreground font-medium"
                  : "border-input bg-background text-muted-foreground hover:border-primary/50"
              }`}
            >
              {tone}
            </button>
          ))}
        </div>
        {form.toneOfVoice === "custom" && (
          <textarea
            value={form.customTonePrompt}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                customTonePrompt: e.target.value,
              }))
            }
            rows={3}
            placeholder="Describe the tone you want your bot to use..."
            className={cn(inputClass, "resize-none")}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Company Context"
        description="Background knowledge the assistant uses when the knowledge base doesn't cover a topic."
      >
        {refreshContext.isSuccess && (
          <p className="text-sm text-success">
            {lastContextRefreshSource === "resources"
              ? "Company context regenerated from resources."
              : "Company context refreshed from website."}
          </p>
        )}
        <textarea
          value={form.companyContext}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, companyContext: e.target.value }))
          }
          rows={8}
          placeholder="Describe your business, products, policies, and anything the assistant should know."
          className={cn(inputClass, "resize-none px-4 py-3")}
        />
      </SectionCard>

      <SectionCard
        title="Conversation"
        description="Lifecycle and availability details shared with visitors."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl bg-muted/30 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Auto-Close Inactive Conversations
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Close conversations automatically after this much inactivity.
            </p>
          </div>
          <Select
            value={
              form.autoCloseMinutes === null
                ? "disabled"
                : String(form.autoCloseMinutes)
            }
            onValueChange={(v) =>
              setForm((prev) => ({
                ...prev,
                autoCloseMinutes: v === "disabled" ? null : parseInt(v, 10),
              }))
            }
          >
            <SelectTrigger className="w-full sm:w-48 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">Disabled</SelectItem>
              {AUTO_CLOSE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
              {form.autoCloseMinutes !== null &&
                !AUTO_CLOSE_OPTIONS.some(
                  (o) => o.value === form.autoCloseMinutes,
                ) && (
                  <SelectItem value={String(form.autoCloseMinutes)}>
                    {form.autoCloseMinutes} minutes
                  </SelectItem>
                )}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Working Hours{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <input
              type="text"
              value={form.workingHours}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  workingHours: e.target.value.slice(0, 200),
                }))
              }
              placeholder="e.g. Mon-Fri, 9:00-18:00 CET"
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">
              The assistant shares this when visitors ask when your team is
              available.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Average Response Time{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <input
              type="text"
              value={form.avgResponseTime}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  avgResponseTime: e.target.value.slice(0, 200),
                }))
              }
              placeholder="e.g. under 2 hours on business days"
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">
              Sets visitor expectations for human follow-ups.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

export default GeneralSettings;
