import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectApiKeys } from "@/components/settings/ProjectApiKeys";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { WidgetSectionCard } from "@/components/WidgetSettings";
import { useSubscription } from "@/hooks/use-subscription";

interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
}

interface AutoCloseSettings {
  autoCloseMinutes: number | null;
}

const AUTO_CLOSE_OPTIONS = [
  { value: 60, label: "After 1 hour" },
  { value: 240, label: "After 4 hours" },
  { value: 720, label: "After 12 hours" },
  { value: 1440, label: "After 1 day" },
  { value: 2880, label: "After 2 days" },
  { value: 4320, label: "After 3 days" },
];

export default function ProjectSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: subData } = useSubscription();
  const isOwner = subData?.role === "owner";
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [projectName, setProjectName] = useState("");
  const [autoCloseMinutes, setAutoCloseMinutes] = useState<number | null>(null);

  const { data: project } = useQuery<ProjectSummary>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to load project");
      return res.json();
    },
    enabled: Boolean(projectId),
  });

  const { data: settings } = useQuery<AutoCloseSettings>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch project settings");
      return res.json();
    },
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (project) setProjectName(project.name);
  }, [project]);

  useEffect(() => {
    if (settings) setAutoCloseMinutes(settings.autoCloseMinutes);
  }, [settings]);

  const dirty =
    (project != null && projectName !== project.name) ||
    (settings != null && autoCloseMinutes !== settings.autoCloseMinutes);

  const save = useMutation({
    mutationFn: async () => {
      const name = projectName.trim();
      if (!name) throw new Error("Project name is required");
      if (name.length > 100) throw new Error("Project name must be 100 characters or less");

      const projectRes = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!projectRes.ok) {
        const err = (await projectRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to save project name");
      }

      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoCloseMinutes }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to save settings");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-settings", projectId] });
      toast.success("Project saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not delete the project");
      }
      const listRes = await fetch("/api/projects");
      return listRes.ok ? ((await listRes.json()) as Array<ProjectSummary & { onboarded: boolean }>) : [];
    },
    onSuccess: (remaining) => {
      queryClient.setQueryData(["projects"], remaining);
      queryClient.removeQueries({ queryKey: ["project", projectId] });
      toast.success(`Deleted ${project?.name ?? "project"}`);
      // Prefer a finished project; an unfinished one resumes in onboarding.
      const next = remaining.find((p) => p.onboarded) ?? remaining[0];
      if (next?.onboarded) navigate(`/app/projects/${next.id}/conversations`, { replace: true });
      else if (next) navigate(`/app/onboarding?project=${next.id}`, { replace: true });
      else navigate("/app/onboarding?new=1", { replace: true });
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

  const name = project?.name ?? "";
  const confirmed = name.length > 0 && confirmText.trim() === name;

  return (
    <SettingsPage title="Project">
      <WidgetSectionCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              value={projectName}
              maxLength={100}
              onChange={(e) => setProjectName(e.target.value.slice(0, 100))}
            />
          </div>
          <div className="space-y-2">
            <Label>Project slug</Label>
            <div className="flex h-9 items-center gap-1 rounded-glass glass-card px-3">
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                {project?.slug ?? ""}
              </span>
              <button
                type="button"
                aria-label="Copy slug"
                onClick={copySlug}
                className="-mr-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-glass-button hover:text-foreground"
              >
                <Copy className="size-4" />
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Auto-close inactive conversations</Label>
            <Select
              value={autoCloseMinutes === null ? "disabled" : String(autoCloseMinutes)}
              onValueChange={(v) => setAutoCloseMinutes(v === "disabled" ? null : parseInt(v, 10))}
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
                {autoCloseMinutes !== null &&
                  !AUTO_CLOSE_OPTIONS.some((o) => o.value === autoCloseMinutes) && (
                    <SelectItem value={String(autoCloseMinutes)}>
                      {autoCloseMinutes} minutes
                    </SelectItem>
                  )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </div>
      </WidgetSectionCard>

      {projectId && (isOwner || subData?.role === "admin") && (
        <ProjectApiKeys key={projectId} projectId={projectId} />
      )}

      {isOwner && (
        <div className="glass-card flex flex-col gap-4 rounded-lg p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Delete project</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Removes {name || "this project"}, its conversations, and its knowledge. This cannot be undone.
            </p>
          </div>
          <Button variant="destructive" onClick={() => setOpen(true)} disabled={!project} className="shrink-0">
            <Trash2 className="size-4" />
            Delete project
          </Button>
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (remove.isPending) return;
          setOpen(next);
          if (!next) setConfirmText("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>Type the project name to confirm.</DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={name}
            aria-label="Project name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && confirmed && !remove.isPending) remove.mutate();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate()} disabled={!confirmed || remove.isPending}>
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}
