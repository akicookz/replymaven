import { useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import { isGreetingVideoUrl } from "@/hooks/use-greetings";
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

function GreetingThumbnail({ greeting }: { greeting: GreetingData }) {
  // Legacy rows kept the video in imageUrl before video_url existed.
  const videoUrl =
    greeting.videoUrl ??
    (greeting.imageUrl && isGreetingVideoUrl(greeting.imageUrl)
      ? greeting.imageUrl
      : null);
  const posterUrl = videoUrl ? greeting.imageUrl : null;

  if (!videoUrl && !greeting.imageUrl) {
    return (
      <span className="text-sm font-semibold text-muted-foreground">
        {greeting.title.charAt(0).toUpperCase()}
      </span>
    );
  }

  if (videoUrl) {
    return (
      <video
        src={videoUrl}
        poster={posterUrl ?? undefined}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
        aria-label="Greeting video"
      />
    );
  }

  return (
    <img
      src={greeting.imageUrl ?? undefined}
      alt=""
      className="h-full w-full object-cover"
      style={
        greeting.imagePosition
          ? { objectPosition: greeting.imagePosition }
          : undefined
      }
    />
  );
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
    // Pinning means "show me this one now": the payload drops disabled
    // greetings and ones whose page rules miss the simulated path, and the
    // widget still honours delaySeconds before painting. Override all three
    // so the card appears immediately and stays up while it is being looked at.
    onPreviewChange(
      pinned
        ? [
            {
              ...pinned,
              enabled: true,
              allowedPages: null,
              delaySeconds: 0,
              durationSeconds: Math.max(pinned.durationSeconds, 3600),
            },
          ]
        : greetings,
    );
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
    // imageUrl is the poster when a video is set, so positioning and aspect
    // only apply to a standalone image.
    const isVideo = Boolean(form.videoUrl);
    const payload = {
      enabled: form.enabled,
      imageUrl: form.imageUrl,
      videoUrl: form.videoUrl,
      imagePosition: form.imageUrl && !isVideo ? form.imagePosition : null,
      imageAspect: form.imageUrl && !isVideo ? form.imageAspect : null,
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
          <div className="h-16 rounded-xl bg-glass-card animate-pulse" />
          <div className="h-16 rounded-xl bg-glass-card animate-pulse" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="px-4 py-6 rounded-lg glass-card border-2 border-dashed border-muted text-sm text-muted-foreground text-center">
          No greetings yet. Add one to welcome visitors or announce something
          new.
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((g) => (
            <li
              key={g.id}
              className="flex items-stretch gap-2 overflow-hidden rounded-xl bg-glass-card"
            >
              <button
                type="button"
                onClick={() => openEdit(g)}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-glass-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="w-12 h-12 rounded-lg bg-glass-button overflow-hidden shrink-0 flex items-center justify-center">
                  <GreetingThumbnail greeting={g} />
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
        uploadMedia={greetingsApi.uploadMedia}
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </div>
  );
}

export default GreetingsList;
