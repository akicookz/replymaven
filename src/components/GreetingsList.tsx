import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import GreetingEditor, {
  type GreetingFormState,
} from "@/components/GreetingEditor";
import {
  useGreetings,
  type GreetingData,
} from "@/hooks/use-greetings";
import type { AuthorOption } from "@/hooks/use-widget-settings";

interface GreetingsListProps {
  projectId: string;
  authors: AuthorOption[];
  onPreviewChange?: (greetings: GreetingData[]) => void;
}

function GreetingsList({
  projectId,
  authors,
  onPreviewChange,
}: GreetingsListProps) {
  const greetingsApi = useGreetings(projectId);
  const greetings = greetingsApi.greetings;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<GreetingData | null>(null);

  useEffect(() => {
    if (onPreviewChange) onPreviewChange(greetings);
  }, [greetings, onPreviewChange]);

  const submitting =
    greetingsApi.create.isPending || greetingsApi.update.isPending;

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(g: GreetingData) {
    setEditing(g);
    setEditorOpen(true);
  }

  async function handleSubmit(form: GreetingFormState) {
    const payload = {
      enabled: form.enabled,
      imageUrl: form.imageUrl,
      title: form.title.trim(),
      description: form.description.trim() || null,
      ctaText: form.ctaText.trim() || null,
      ctaLink: form.ctaLink.trim() || null,
      authorId: form.authorId,
      allowedPages: form.allowedPages.length > 0 ? form.allowedPages : null,
      delaySeconds: form.delaySeconds,
      durationSeconds: form.durationSeconds,
    };

    if (editing) {
      await greetingsApi.update.mutateAsync({
        id: editing.id,
        updates: payload,
      });
    } else {
      await greetingsApi.create.mutateAsync(payload);
    }
    setEditorOpen(false);
  }

  async function toggleEnabled(g: GreetingData, enabled: boolean) {
    await greetingsApi.update.mutateAsync({
      id: g.id,
      updates: { enabled },
    });
  }

  async function handleDelete(g: GreetingData) {
    if (!confirm(`Delete greeting "${g.title}"?`)) return;
    await greetingsApi.remove.mutateAsync(g.id);
  }

  const sorted = useMemo(
    () => [...greetings].sort((a, b) => a.sortOrder - b.sortOrder),
    [greetings],
  );

  return (
    <div className="space-y-3">
      {greetingsApi.query.isLoading ? (
        <div className="space-y-2">
          <div className="h-16 rounded-xl bg-muted/40 animate-pulse" />
          <div className="h-16 rounded-xl bg-muted/40 animate-pulse" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="px-4 py-6 rounded-xl bg-muted/30 border-2 border-dashed border-muted text-sm text-muted-foreground text-center">
          No greetings yet. Add one to welcome visitors or announce something
          new.
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((g) => (
            <li
              key={g.id}
              className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5"
            >
              <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                {g.imageUrl ? (
                  <img
                    src={g.imageUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-semibold text-muted-foreground">
                    {g.title.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {g.title || "(untitled)"}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {g.description ||
                    (g.ctaText ? `CTA: ${g.ctaText}` : "Compact bubble")}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Switch
                  size="sm"
                  checked={g.enabled}
                  onCheckedChange={(v) => toggleEnabled(g, v)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => openEdit(g)}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(g)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openCreate}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add greeting
      </Button>

      <GreetingEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editing}
        authors={authors}
        uploadImage={greetingsApi.uploadImage}
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </div>
  );
}

export default GreetingsList;
