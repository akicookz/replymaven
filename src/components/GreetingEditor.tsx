import { useEffect, useRef, useState } from "react";
import { Image, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
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
import PageVisibilityInput from "@/components/PageVisibilityInput";
import type { AuthorOption } from "@/hooks/use-widget-settings";
import type { GreetingData } from "@/hooks/use-greetings";

export interface GreetingFormState {
  enabled: boolean;
  imageUrl: string | null;
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

interface GreetingEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: GreetingData | null;
  authors: AuthorOption[];
  uploadImage: (file: File) => Promise<string>;
  onSubmit: (form: GreetingFormState) => Promise<void>;
  submitting: boolean;
}

function GreetingEditor({
  open,
  onOpenChange,
  initial,
  authors,
  uploadImage,
  onSubmit,
  submitting,
}: GreetingEditorProps) {
  const [form, setForm] = useState<GreetingFormState>(emptyForm());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(initial ? fromGreeting(initial) : emptyForm());
      setUploadError(null);
      setSubmitError(null);
    }
  }, [open, initial]);

  function update<K extends keyof GreetingFormState>(
    key: K,
    value: GreetingFormState[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const url = await uploadImage(file);
      update("imageUrl", url);
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

  const isRich = Boolean(form.imageUrl) || Boolean(form.ctaText.trim());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle>{initial ? "Edit greeting" : "New greeting"}</SheetTitle>
          <SheetDescription>
            Pop-out card shown above the chat trigger. Add an image or CTA to
            turn it into a rich card; otherwise it shows as a compact bubble.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5">
          <div className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3">
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

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Image{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <div
              className="relative w-full h-36 rounded-xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
              style={form.imageUrl ? { borderStyle: "solid" } : undefined}
              onClick={() => fileInputRef.current?.click()}
            >
              {form.imageUrl ? (
                <>
                  <img
                    src={form.imageUrl}
                    alt="Greeting"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    className="absolute top-2 right-2 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70"
                    onClick={(e) => {
                      e.stopPropagation();
                      update("imageUrl", null);
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
                    {uploading ? "Uploading..." : "Click to upload image"}
                  </span>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
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
                Recommended: 800x420px. JPG, PNG, or WebP.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Title
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="What's new at Acme"
              maxLength={120}
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground text-right">
              {form.title.length}/120
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Description{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Tell visitors what changed and why they should care."
              rows={3}
              maxLength={500}
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">
              {form.description.length}/500
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                CTA text
              </label>
              <input
                type="text"
                value={form.ctaText}
                onChange={(e) => update("ctaText", e.target.value)}
                placeholder="Read more"
                maxLength={40}
                className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                CTA link
              </label>
              <input
                type="url"
                value={form.ctaLink}
                onChange={(e) => update("ctaLink", e.target.value)}
                placeholder="https://example.com/changelog"
                maxLength={2048}
                className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {!isRich ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Author
              </label>
              <p className="text-xs text-muted-foreground">
                Choose who the compact greeting appears to be from.
              </p>
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

          {submitError ? (
            <div className="text-sm text-destructive">{submitError}</div>
          ) : null}
        </div>

        <SheetFooter className="px-6 py-4 border-t border-border bg-background/80 backdrop-blur-sm">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || uploading}>
            {submitting ? "Saving..." : initial ? "Save changes" : "Create greeting"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default GreetingEditor;
