import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
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

interface ProjectSummary {
  id: string;
  name: string;
}

export default function ProjectSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const { data: project } = useQuery<ProjectSummary>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to load project");
      return res.json();
    },
    enabled: Boolean(projectId),
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

  const name = project?.name ?? "";
  const confirmed = name.length > 0 && confirmText.trim() === name;

  return (
    <div className="space-y-6">
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
    </div>
  );
}
