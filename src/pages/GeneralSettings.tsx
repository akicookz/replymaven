import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Copy, RefreshCw, Save } from "lucide-react";
import { MobileMenuButton } from "@/components/PageHeader";
import { WidgetSectionCard } from "@/components/WidgetSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface ProjectData {
  id: string;
  name: string;
  slug: string;
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

const textareaClass =
  "w-full min-h-0 rounded-lg border border-border bg-input-background px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 resize-none";

function Field({
  label,
  hint,
  optional,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>
        {label}
        {optional ? (
          <span className="font-normal text-muted-foreground">(optional)</span>
        ) : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function GeneralSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    projectName: "",
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

  const { data: project } = useQuery<ProjectData>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      return res.json();
    },
  });

  useEffect(() => {
    if (!settings) return;
    setForm((prev) => ({
      ...prev,
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
    }));
  }, [settings]);

  useEffect(() => {
    if (!project) return;
    setForm((prev) => ({ ...prev, projectName: project.name }));
  }, [project]);

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
      const projectName = form.projectName.trim();
      if (!projectName) {
        throw new Error("Project name is required");
      }
      if (projectName.length > 100) {
        throw new Error("Project name must be 100 characters or less");
      }

      const projectRes = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName }),
      });
      if (!projectRes.ok) {
        const err = await projectRes
          .json()
          .catch(() => ({ error: "Failed to save project name" }));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to save project name",
        );
      }

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
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
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

  const canRefreshContext = hasResources || Boolean(form.companyUrl.trim());

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <MobileMenuButton />
          <div>
            <h1 className="text-balance text-xl font-bold text-foreground md:text-2xl">
              Company info
            </h1>
            <p className="mt-1 text-pretty text-xs text-muted-foreground md:text-sm">
              Names, voice, and how conversations behave.
            </p>
          </div>
        </div>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || isLoading}
          className="w-full transition-transform active:scale-[0.96] sm:w-auto"
        >
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {save.isError && (
        <div className="flex items-center gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {save.error.message}
        </div>
      )}
      {refreshContext.isError && (
        <div className="flex items-center gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {refreshContext.error.message}
        </div>
      )}

      <WidgetSectionCard
        title="Project"
        description="Dashboard switcher and help center navbar."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            htmlFor="project-name"
            label="Project name"
            hint="Shown in the project switcher and on the public help center."
          >
            <Input
              id="project-name"
              type="text"
              value={form.projectName}
              maxLength={100}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  projectName: e.target.value.slice(0, 100),
                }))
              }
              placeholder="LovableHTML"
            />
          </Field>
          <Field
            label="Project slug"
            hint="Widget embed, help URL, and inbound email. This cannot change."
          >
            <div className="flex h-9 items-center gap-1 rounded-lg bg-muted/40 px-3">
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                {project?.slug ?? ""}
              </span>
              <button
                type="button"
                aria-label="Copy slug"
                onClick={copySlug}
                className="-mr-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </Field>
        </div>
      </WidgetSectionCard>

      <WidgetSectionCard
        title="Company"
        description="Who the assistant is representing."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field htmlFor="company-name" label="Company name">
            <Input
              id="company-name"
              type="text"
              value={form.companyName}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, companyName: e.target.value }))
              }
              placeholder="Your company name"
            />
          </Field>
          <Field htmlFor="company-url" label="Website URL">
            <Input
              id="company-url"
              type="url"
              value={form.companyUrl}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, companyUrl: e.target.value }))
              }
              placeholder="https://example.com"
            />
          </Field>
        </div>
      </WidgetSectionCard>

      <WidgetSectionCard
        title="Assistant"
        description="How the bot names itself and how it sounds."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            htmlFor="bot-name"
            label="Assistant name"
            hint="No spaces, max 16 characters. Used in chat and Telegram commands."
          >
            <Input
              id="bot-name"
              type="text"
              value={form.botName}
              onChange={(e) => {
                const val = e.target.value.replace(/[^a-zA-Z0-9_-]/g, "");
                setForm((prev) => ({ ...prev, botName: val.slice(0, 16) }));
              }}
              placeholder="e.g. Luna, Alex, Maya"
            />
          </Field>
          <Field
            htmlFor="agent-name"
            label="Human agent label"
            hint="What the bot calls your team when handing off to a human."
          >
            <Input
              id="agent-name"
              type="text"
              value={form.agentName}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  agentName: e.target.value.slice(0, 50),
                }))
              }
              placeholder="e.g. a team member, an engineer"
            />
          </Field>
        </div>

        <Field label="Tone of voice">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {toneOptions.map((tone) => (
              <button
                key={tone}
                type="button"
                onClick={() =>
                  setForm((prev) => ({ ...prev, toneOfVoice: tone }))
                }
                className={cn(
                  "rounded-lg px-3 py-2 text-sm capitalize transition-colors",
                  form.toneOfVoice === tone
                    ? "bg-primary/10 font-medium text-foreground"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {tone}
              </button>
            ))}
          </div>
        </Field>
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
            className={textareaClass}
          />
        )}
      </WidgetSectionCard>

      <WidgetSectionCard
        title="Company context"
        description="Background the assistant uses when the knowledge base does not cover a topic."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshContext.mutate()}
            disabled={refreshContext.isPending || !canRefreshContext}
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                refreshContext.isPending && "animate-spin",
              )}
            />
            {hasResources ? "Regenerate" : "Refresh"}
          </Button>
        }
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
          className={textareaClass}
        />
      </WidgetSectionCard>

      <WidgetSectionCard
        title="Conversation"
        description="Lifecycle and availability details shared with visitors."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="Auto-close inactive conversations"
            hint="Close conversations automatically after this much inactivity."
          >
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
              <SelectTrigger className="w-full">
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
          </Field>
          <Field
            htmlFor="working-hours"
            label="Working hours"
            optional
            hint="Shared when visitors ask when your team is available."
          >
            <Input
              id="working-hours"
              type="text"
              value={form.workingHours}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  workingHours: e.target.value.slice(0, 200),
                }))
              }
              placeholder="e.g. Mon-Fri, 9:00-18:00 CET"
            />
          </Field>
          <Field
            htmlFor="avg-response-time"
            label="Average response time"
            optional
            hint="Sets visitor expectations for human follow-ups."
          >
            <Input
              id="avg-response-time"
              type="text"
              value={form.avgResponseTime}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  avgResponseTime: e.target.value.slice(0, 200),
                }))
              }
              placeholder="e.g. under 2 hours on business days"
            />
          </Field>
        </div>
      </WidgetSectionCard>
    </div>
  );
}

export default GeneralSettings;
