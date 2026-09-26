import { useEffect, useRef, useState } from "react";
import { Expand, Image, Pause, Play, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImagePositioner } from "@/components/ImagePositioner";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetHeaderActions,
  SheetHeaderContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import PageVisibilityInput from "@/components/PageVisibilityInput";
import type { AuthorOption } from "@/hooks/use-widget-settings";
import type {
  GreetingData,
  GreetingImageAspect,
} from "@/hooks/use-greetings";

export interface GreetingFormState {
  enabled: boolean;
  /** Artwork when there is no video, poster frame when there is. */
  imageUrl: string | null;
  videoUrl: string | null;
  imagePosition: string | null;
  imageAspect: GreetingImageAspect;
  title: string;
  description: string;
  ctaText: string;
  ctaLink: string;
  authorId: string | null;
  allowedPages: string[];
  delaySeconds: number;
  durationSeconds: number;
}

function emptyForm(): GreetingFormState {
  return {
    enabled: true,
    imageUrl: null,
    videoUrl: null,
    imagePosition: null,
    imageAspect: "landscape",
    title: "",
    description: "",
    ctaText: "",
    ctaLink: "",
    authorId: null,
    allowedPages: [],
    delaySeconds: 3,
    durationSeconds: 15,
  };
}

function fromGreeting(g: GreetingData): GreetingFormState {
  return {
    enabled: g.enabled,
    imageUrl: g.imageUrl,
    videoUrl: g.videoUrl,
    imagePosition: g.imagePosition,
    imageAspect: g.imageAspect ?? "landscape",
    title: g.title,
    description: g.description ?? "",
    ctaText: g.ctaText ?? "",
    ctaLink: g.ctaLink ?? "",
    authorId: g.authorId,
    allowedPages: g.allowedPages ?? [],
    delaySeconds: g.delaySeconds,
    durationSeconds: g.durationSeconds,
  };
}

type GreetingKind = "message" | "announcement";

/** The widget renders the rich card whenever media or a CTA is present. */
function kindOf(g: GreetingData | null): GreetingKind {
  if (!g) return "message";
  return g.videoUrl || g.imageUrl || g.ctaText ? "announcement" : "message";
}

function getMediaFrameClass(
  hasMedia: boolean,
  isVideo: boolean,
  aspect: GreetingImageAspect,
): string {
  if (hasMedia && isVideo) return "w-full aspect-video";
  if (hasMedia && aspect === "square") return "w-56 h-56 mx-auto";
  return "w-full h-36";
}

interface GreetingEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: GreetingData | null;
  authors: AuthorOption[];
  uploadMedia: (file: File) => Promise<string>;
  onSubmit: (form: GreetingFormState) => Promise<void>;
  onDelete?: () => void | Promise<void>;
  submitting: boolean;
}

function GreetingEditor({
  open,
  onOpenChange,
  initial,
  authors,
  uploadMedia,
  onSubmit,
  onDelete,
  submitting,
}: GreetingEditorProps) {
  const [form, setForm] = useState<GreetingFormState>(emptyForm());
  const [kind, setKind] = useState<GreetingKind>("message");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [expandedVideoOpen, setExpandedVideoOpen] = useState(false);
  const [expandedVideoState, setExpandedVideoState] = useState({
    currentTime: 0,
    muted: true,
    playing: false,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const posterInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const expandedVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (open) {
      setForm(initial ? fromGreeting(initial) : emptyForm());
      setKind(kindOf(initial));
      setVideoPlaying(false);
      setExpandedVideoOpen(false);
      setUploadError(null);
      setSubmitError(null);
    }
  }, [open, initial]);

  // Card shape is derived from the data, so switching clears what the other
  // kind owns — otherwise a "message" keeping a CTA still renders rich.
  function selectKind(next: GreetingKind) {
    if (next === kind) return;
    setKind(next);
    setUploadError(null);
    setForm((prev) =>
      next === "message"
        ? {
            ...prev,
            imageUrl: null,
            videoUrl: null,
            imagePosition: null,
            ctaText: "",
            ctaLink: "",
          }
        : { ...prev, authorId: null },
    );
    setVideoPlaying(false);
  }

  function update<K extends keyof GreetingFormState>(
    key: K,
    value: GreetingFormState[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openExpandedVideo() {
    const video = videoRef.current;
    if (!video) return;
    setExpandedVideoState({
      currentTime: video.currentTime,
      muted: video.muted,
      playing: !video.paused,
    });
    video.pause();
    setExpandedVideoOpen(true);
  }

  function closeExpandedVideo() {
    const expandedVideo = expandedVideoRef.current;
    const sourceVideo = videoRef.current;
    if (expandedVideo && sourceVideo) {
      const wasPlaying = !expandedVideo.paused;
      expandedVideo.pause();
      sourceVideo.currentTime = expandedVideo.currentTime;
      sourceVideo.muted = expandedVideo.muted;
      if (wasPlaying) {
        void sourceVideo.play().catch(() => {
          setUploadError("This video could not be played");
        });
      }
    }
    setExpandedVideoOpen(false);
  }

  // A video goes to videoUrl and leaves imageUrl free to hold its poster.
  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const url = await uploadMedia(file);
      const isVideoFile = file.type.startsWith("video/");
      setForm((prev) => ({
        ...prev,
        videoUrl: isVideoFile ? url : null,
        imageUrl: isVideoFile ? prev.imageUrl : url,
        imagePosition: null,
      }));
      setVideoPlaying(false);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // The preview video is same-origin, so the canvas stays untainted.
  async function handleUseCurrentFrame() {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState < 2 || !video.videoWidth) {
      setUploadError("Let the video load, then pick a frame");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const scale = Math.min(1, 1280 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      if (!blob) throw new Error("no blob");
      const url = await uploadMedia(
        new File([blob], "thumbnail.jpg", { type: "image/jpeg" }),
      );
      setForm((prev) => ({ ...prev, imageUrl: url }));
    } catch {
      setUploadError("Could not capture this frame");
    } finally {
      setUploading(false);
    }
  }

  async function handlePosterFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const url = await uploadMedia(file);
      setForm((prev) => ({ ...prev, imageUrl: url }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    setSubmitError(null);
    if (!form.title.trim()) {
      setSubmitError("Title is required");
      return;
    }
    if (form.ctaText.trim() && !form.ctaLink.trim()) {
      setSubmitError("CTA text needs a link");
      return;
    }
    if (form.ctaLink.trim() && !form.ctaText.trim()) {
      setSubmitError("CTA link needs button text");
      return;
    }
    try {
      await onSubmit(form);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to save greeting",
      );
    }
  }

  const isVideo = Boolean(form.videoUrl);
  const hasMedia = Boolean(form.videoUrl ?? form.imageUrl);
  const mediaFrameClass = getMediaFrameClass(
    hasMedia,
    isVideo,
    form.imageAspect,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" aria-describedby={undefined} className="sm:max-w-xl">
        <SheetHeader>
          <SheetHeaderContent>
            <SheetTitle>{initial ? "Edit greeting" : "New greeting"}</SheetTitle>
          </SheetHeaderContent>
          <SheetHeaderActions>
            <SheetCloseButton label="Close greeting editor" />
          </SheetHeaderActions>
        </SheetHeader>

        <SheetBody className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                {
                  value: "message",
                  label: "Message",
                  hint: "A short note from a teammate.",
                },
                {
                  value: "announcement",
                  label: "Announcement",
                  hint: "Media, a headline, and a link.",
                },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={kind === option.value}
                onClick={() => selectKind(option.value)}
                className="rounded-xl p-3 text-left inset-ring inset-ring-border transition-[box-shadow,background-color] hover:inset-ring-hairline-strong aria-pressed:bg-primary/8 aria-pressed:inset-ring-primary"
              >
                <div className="text-sm font-medium">{option.label}</div>
                <div className="text-xs text-muted-foreground">
                  {option.hint}
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-xl glass-card px-4 py-3">
            <div>
              <div className="text-sm font-medium">Enabled</div>
              <div className="text-xs text-muted-foreground">
                Visitors only see enabled greetings.
              </div>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => update("enabled", v)}
            />
          </div>

          {kind === "announcement" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">
                Media{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              {form.imageUrl && !isVideo ? (
                <div className="flex gap-0.5 bg-glass-button rounded-lg p-0.5">
                  {(["landscape", "square"] as const).map((aspect) => (
                    <button
                      key={aspect}
                      type="button"
                      onClick={() => update("imageAspect", aspect)}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors",
                        form.imageAspect === aspect
                          ? "bg-glass-raised text-ink-1 shadow-[inset_0_1px_0_0_var(--hairline-strong)]"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {aspect}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div
              className={cn(
                "group/media relative flex items-center justify-center overflow-hidden rounded-xl bg-glass-card",
                mediaFrameClass,
                !hasMedia &&
                  "cursor-pointer transition-colors hover:bg-glass-button",
              )}
              role={hasMedia ? undefined : "button"}
              tabIndex={hasMedia ? undefined : 0}
              onKeyDown={
                hasMedia
                  ? undefined
                  : (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }
              }
              onClick={
                hasMedia ? undefined : () => fileInputRef.current?.click()
              }
            >
              {hasMedia ? (
                <>
                  {isVideo ? (
                    <>
                      <video
                        ref={videoRef}
                        src={form.videoUrl ?? undefined}
                        poster={form.imageUrl ?? undefined}
                        className="h-full w-full object-contain"
                        muted
                        loop
                        playsInline
                        controls
                        onPlay={() => setVideoPlaying(true)}
                        onPause={() => setVideoPlaying(false)}
                        onEnded={() => setVideoPlaying(false)}
                        aria-label="Greeting video preview"
                      />
                      <button
                        type="button"
                        aria-label="Play greeting video"
                        className={cn(
                          "absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-sm transition-opacity duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                          videoPlaying
                            ? "pointer-events-none opacity-0"
                            : "opacity-0 group-hover/media:opacity-100 group-focus-within/media:opacity-100",
                        )}
                        onClick={() => {
                          const video = videoRef.current;
                          if (!video) return;
                          if (video.paused) {
                            void video.play().catch(() => {
                              setUploadError("This video could not be played");
                            });
                          } else {
                            video.pause();
                          }
                        }}
                      >
                        {videoPlaying ? (
                          <Pause className="size-6 fill-current" />
                        ) : (
                          <Play className="ml-1 size-6 fill-current" />
                        )}
                      </button>
                      <button
                        type="button"
                        title="Expand video"
                        aria-label="Expand video"
                        className="absolute bottom-12 right-2 flex size-9 items-center justify-center rounded-full bg-black/50 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        onClick={openExpandedVideo}
                      >
                        <Expand className="size-4" />
                      </button>
                    </>
                  ) : null}
                  {!isVideo && form.imageUrl ? (
                    <ImagePositioner
                      src={form.imageUrl}
                      alt="Greeting"
                      position={form.imagePosition}
                      onChange={(value) => update("imagePosition", value)}
                    />
                  ) : null}
                  <button
                    type="button"
                    title="Replace media"
                    disabled={uploading}
                    className="absolute top-2 right-9 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70 disabled:opacity-50"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    title="Remove media"
                    className="absolute top-2 right-2 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70"
                    onClick={() => {
                      setForm((prev) => ({
                        ...prev,
                        imageUrl: null,
                        videoUrl: null,
                        imagePosition: null,
                      }));
                      setVideoPlaying(false);
                    }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                  {uploading ? (
                    <Upload className="w-6 h-6 animate-pulse" />
                  ) : (
                    <Image className="w-6 h-6" />
                  )}
                  <span className="text-xs">
                    {uploading ? "Uploading..." : "Click to upload media"}
                  </span>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/ogg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
            {uploadError ? (
              <p className="text-xs text-destructive">{uploadError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {isVideo
                  ? "MP4, WebM, or OGG. Max 50MB."
                  : `Recommended: ${form.imageAspect === "square" ? "800x800px" : "800x420px"}. JPG, PNG, or WebP.`}
              </p>
            )}
          </div>
          ) : null}

          {kind === "announcement" && isVideo ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4 rounded-xl glass-card p-3">
                <div className="min-w-0 space-y-2">
                  <div className="text-sm font-medium text-foreground">
                    Set a thumbnail
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploading}
                      onClick={handleUseCurrentFrame}
                    >
                      Use current frame
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploading}
                      onClick={() => posterInputRef.current?.click()}
                    >
                      {form.imageUrl ? "Replace" : "Upload"}
                    </Button>
                    {form.imageUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={uploading}
                        onClick={() => update("imageUrl", null)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div
                  className={cn(
                    "flex aspect-video w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-glass-button text-muted-foreground",
                    !form.imageUrl &&
                      "cursor-pointer transition-colors hover:bg-glass-raised",
                  )}
                  role={form.imageUrl ? undefined : "button"}
                  tabIndex={form.imageUrl ? undefined : 0}
                  onClick={
                    form.imageUrl
                      ? undefined
                      : () => posterInputRef.current?.click()
                  }
                  onKeyDown={
                    form.imageUrl
                      ? undefined
                      : (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            posterInputRef.current?.click();
                          }
                        }
                  }
                >
                  {form.imageUrl ? (
                    <img
                      src={form.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                  {!form.imageUrl && uploading ? (
                    <Upload className="w-4 h-4 animate-pulse" />
                  ) : null}
                  {!form.imageUrl && !uploading ? (
                    <Image className="w-4 h-4" />
                  ) : null}
                </div>
              </div>
              <input
                ref={posterInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePosterFile(file);
                  e.target.value = "";
                }}
              />
              <p className="text-xs text-muted-foreground">
                Shown before the video loads.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Title
            </label>
            <Input
              type="text"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder={
                kind === "message"
                  ? "Hi! Need a hand with anything?"
                  : "What's new at Acme"
              }
              maxLength={120}
            />
            <p className="text-xs text-muted-foreground text-right">
              {form.title.length}/120
            </p>
          </div>

          {kind === "announcement" ? (
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Message{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <Textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Tell visitors what changed and why they should care."
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground text-right">
              {form.description.length}/500
            </p>
          </div>
          ) : null}

          {kind === "announcement" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                CTA text
              </label>
              <Input
                type="text"
                value={form.ctaText}
                onChange={(e) => update("ctaText", e.target.value)}
                placeholder="Read more"
                maxLength={40}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                CTA link
              </label>
              <Input
                type="url"
                value={form.ctaLink}
                onChange={(e) => update("ctaLink", e.target.value)}
                placeholder="https://example.com/changelog"
                maxLength={2048}
              />
            </div>
          </div>
          ) : null}

          {kind === "message" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Author
              </label>
              <Select
                value={form.authorId ?? "none"}
                onValueChange={(value) =>
                  update("authorId", value === "none" ? null : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No author (bot message)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No author (bot message)</SelectItem>
                  {authors.map((author) => (
                    <SelectItem key={author.id} value={author.id}>
                      <div className="flex items-center gap-2">
                        {author.avatar ? (
                          <img
                            src={author.avatar}
                            alt={author.name}
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary">
                            {author.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span>{author.name}</span>
                        {author.workTitle ? (
                          <span className="text-muted-foreground">
                            - {author.workTitle}
                          </span>
                        ) : null}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Show after
              </label>
              <Select
                value={String(form.delaySeconds)}
                onValueChange={(v) => update("delaySeconds", Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Immediately</SelectItem>
                  <SelectItem value="1">After 1 second</SelectItem>
                  <SelectItem value="3">After 3 seconds</SelectItem>
                  <SelectItem value="5">After 5 seconds</SelectItem>
                  <SelectItem value="10">After 10 seconds</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Hide after
              </label>
              <Select
                value={String(form.durationSeconds)}
                onValueChange={(v) => update("durationSeconds", Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Never</SelectItem>
                  <SelectItem value="8">8 seconds</SelectItem>
                  <SelectItem value="15">15 seconds</SelectItem>
                  <SelectItem value="30">30 seconds</SelectItem>
                  <SelectItem value="60">1 minute</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Page visibility
            </label>
            <p className="text-xs text-muted-foreground">
              Limit this greeting to specific pages. Leave empty to show
              everywhere the widget is allowed.
            </p>
            <PageVisibilityInput
              value={form.allowedPages}
              onChange={(v) => update("allowedPages", v)}
              emptyHint="Shows on every page the widget appears on."
              showExamples={false}
            />
          </div>

          {onDelete ? (
            <div className="flex items-center justify-between gap-4 pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Delete greeting
                </p>
                <p className="text-xs text-muted-foreground">
                  This cannot be undone.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => void onDelete()}
                className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="mr-2 size-4" />
                Delete greeting
              </Button>
            </div>
          ) : null}

          {submitError ? (
            <div className="text-sm text-destructive">{submitError}</div>
          ) : null}
        </SheetBody>

        <SheetFooter className="grid grid-cols-1 gap-2 px-6 py-4 sm:grid-cols-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="order-2 w-full sm:order-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || uploading}
            className="order-1 w-full sm:order-2"
          >
            {submitting ? "Saving..." : initial ? "Save changes" : "Create greeting"}
          </Button>
        </SheetFooter>
      </SheetContent>
      <Dialog
        open={expandedVideoOpen}
        onOpenChange={(open) => {
          if (!open) closeExpandedVideo();
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-w-4xl border-0 bg-black/95 p-2 sm:max-w-4xl sm:p-3"
        >
          <DialogTitle className="sr-only">Expanded greeting video</DialogTitle>
          <video
            ref={expandedVideoRef}
            src={form.videoUrl ?? undefined}
            className="max-h-[80vh] w-full rounded-lg object-contain"
            controls
            muted={expandedVideoState.muted}
            playsInline
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              video.currentTime = expandedVideoState.currentTime;
              video.muted = expandedVideoState.muted;
              if (expandedVideoState.playing) {
                void video.play().catch(() => {
                  setUploadError("This video could not be played");
                });
              }
            }}
            onError={() => setUploadError("This video could not be loaded")}
          />
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

export default GreetingEditor;
