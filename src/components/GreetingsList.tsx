import { useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import GreetingEditor, {
  type GreetingFormState,
} from "@/components/GreetingEditor";
import {
  useGreetings,
  type GreetingData,
} from "@/hooks/use-greetings";
import type { AuthorOption } from "@/hooks/use-widget-settings";

export interface GreetingsListHandle {
  openCreate: () => void;
}

interface GreetingsListProps {
  projectId: string;
  authors: AuthorOption[];
  onPreviewChange?: (greetings: GreetingData[]) => void;
  /** Lets the page trigger the create editor from outside (header button). */
  handleRef?: Ref<GreetingsListHandle>;
}

function GreetingsList({
  projectId,
  authors,
  onPreviewChange,
  handleRef,
}: GreetingsListProps) {
  const greetingsApi = useGreetings(projectId);
  const greetings = greetingsApi.greetings;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<GreetingData | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (!onPreviewChange) return;
    const pinned = previewId
      ? greetings.find((g) => g.id === previewId)
      : undefined;
    // The preview payload drops disabled greetings, so pinning one has to
    // force it on or Preview looks broken for anything not already live.
    onPreviewChange(pinned ? [{ ...pinned, enabled: true }] : greetings);
  }, [greetings, onPreviewChange, previewId]);

  const submitting =
    greetingsApi.create.isPending || greetingsApi.update.isPending;

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  useImperativeHandle(handleRef, () => ({ openCreate }), []);

  function openEdit(g: GreetingData) {
    setEditing(g);
    setEditorOpen(true);
  }

  async function handleSubmit(form: GreetingFormState) {
    const payload = {
      enabled: form.enabled,
      imageUrl: form.imageUrl,
      imagePosition: form.imageUrl ? form.imagePosition : null,
      imageAspect: form.imageUrl ? form.imageAspect : null,
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
              className="flex items-stretch gap-2 overflow-hidden rounded-xl bg-muted/40"
            >
              <button
                type="button"
                onClick={() => openEdit(g)}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                  {g.imageUrl ? (
                    <img
                      src={g.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      style={
                        g.imagePosition
                          ? { objectPosition: g.imagePosition }
                          : undefined
                      }
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
              </button>
              <div className="flex shrink-0 items-center pr-3">
                <Button
                  type="button"
                  variant={previewId === g.id ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={previewId === g.id}
                  onClick={() =>
                    setPreviewId((current) => (current === g.id ? null : g.id))
                  }
                >
                  Preview
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <GreetingEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onDelete={editing ? () => handleDelete(editing) : undefined}
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
