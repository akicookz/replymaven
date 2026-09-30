import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Copy, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WidgetSectionCard } from "@/components/WidgetSettings";

interface ApiKeySummary {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(body?.error ?? fallback);
}

// Mount with key={projectId}: changing projects must discard the one-time secret.
export function ProjectApiKeys({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [selected, setSelected] = useState<ApiKeySummary | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const keys = useQuery<{ apiKeys: ApiKeySummary[] }>({
    queryKey: ["project-api-keys", projectId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/projects/${projectId}/api-keys`, { signal });
      if (!response.ok) throw await responseError(response, "Could not load API keys");
      return response.json();
    },
  });

  const create = useMutation({
    retry: false,
    mutationFn: async () => {
      const controller = new AbortController();
      request.current = controller;
      const response = await fetch(`/api/projects/${projectId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
        signal: controller.signal,
      });
      if (!response.ok) throw await responseError(response, "Could not create API key");
      const result = await response.json() as { key: string };
      if (!controller.signal.aborted) setSecret(result.key);
      // Returning void keeps plaintext out of TanStack's mutation cache.
    },
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ["project-api-keys", projectId] });
      toast.success("API key created");
    },
  });

  const revoke = useMutation({
    mutationFn: async (keyId: string) => {
      const response = await fetch(`/api/projects/${projectId}/api-keys/${keyId}`, { method: "DELETE" });
      if (!response.ok) throw await responseError(response, "Could not revoke API key");
    },
    onSuccess() {
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ["project-api-keys", projectId] });
      toast.success("API key revoked");
    },
  });

  function closeCreation() {
    if (create.isPending) return;
    setSecret(null);
    setLabel("");
    setCreating(false);
    create.reset();
  }

  async function copyKey() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success("API key copied");
    } catch {
      toast.error("Could not copy API key");
    }
  }

  return (
    <WidgetSectionCard title="API keys" action={
      <Button onClick={() => setCreating(true)}><Plus />Create key</Button>
    }>
      {keys.isPending && <p role="status" className="text-sm text-muted-foreground">Loading API keys…</p>}
      {keys.isError && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="alert" className="text-sm text-destructive">{keys.error.message}</p>
          <Button variant="outline" onClick={() => void keys.refetch()} disabled={keys.isFetching}>Retry</Button>
        </div>
      )}
      {keys.data?.apiKeys.length === 0 && <p className="text-sm text-muted-foreground">No API keys yet.</p>}
      <div className="space-y-2">
        {keys.data?.apiKeys.map((key) => (
          <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 rounded-glass bg-muted/40 p-3">
            <div className="min-w-0 space-y-1">
              <p className="break-words text-sm font-medium">{key.label}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{key.prefix}…</span>
                <span className="ml-3">{new Date(key.createdAt).toLocaleDateString()}</span>
              </p>
            </div>
            <Button variant="ghost" size="sm" aria-label={`Manage ${key.label}`} onClick={() => {
              revoke.reset();
              setSelected(key);
            }}>Manage<ChevronRight /></Button>
          </div>
        ))}
      </div>

      <Dialog open={creating} onOpenChange={(open) => { if (!open) closeCreation(); }}>
        <DialogContent showCloseButton={!create.isPending}>
          <DialogHeader className="text-left pr-6">
            <DialogTitle>{secret ? "API key created" : "Create API key"}</DialogTitle>
            <DialogDescription>This key can submit customer and teammate messages for this project.</DialogDescription>
          </DialogHeader>
          {!secret && (
            <form id="create-project-api-key" className="space-y-2" onSubmit={(event) => {
              event.preventDefault();
              if (label.trim() && !create.isPending) create.mutate();
            }}>
              <Label htmlFor="api-key-label">Label</Label>
              <Input id="api-key-label" value={label} maxLength={100} autoFocus disabled={create.isPending}
                onChange={(event) => setLabel(event.target.value)} placeholder="Website backend" />
            </form>
          )}
          {secret && (
            <div className="space-y-3">
              <code className="block break-all rounded-lg bg-muted/40 p-3 text-sm select-all">{secret}</code>
              <p className="text-sm text-muted-foreground">Copy this key now. It will not be shown again.</p>
            </div>
          )}
          {create.isError && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
          <DialogFooter className="grid grid-cols-1 min-[480px]:grid-cols-2">
            <Button variant="outline" onClick={closeCreation} disabled={create.isPending}>{secret ? "Done" : "Cancel"}</Button>
            {secret && <Button onClick={() => void copyKey()}><Copy />Copy key</Button>}
            {!secret && <Button type="submit" form="create-project-api-key" disabled={!label.trim() || create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />}Create key
            </Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open && !revoke.isPending) setSelected(null); }}>
        <DialogContent showCloseButton={!revoke.isPending}>
          <DialogHeader className="text-left pr-6">
            <DialogTitle>Revoke {selected?.label}?</DialogTitle>
            <DialogDescription>Requests using this key will stop working.</DialogDescription>
          </DialogHeader>
          <p className="font-mono text-sm text-muted-foreground">{selected?.prefix}…</p>
          {revoke.isError && <p role="alert" className="text-sm text-destructive">{revoke.error.message}</p>}
          <DialogFooter className="grid grid-cols-1 min-[480px]:grid-cols-2">
            <Button variant="destructive" disabled={revoke.isPending} onClick={() => { if (selected) revoke.mutate(selected.id); }}>
              {revoke.isPending && <Loader2 className="animate-spin" />}Revoke key
            </Button>
            <Button variant="outline" disabled={revoke.isPending} onClick={() => setSelected(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WidgetSectionCard>
  );
}
