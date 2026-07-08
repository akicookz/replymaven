import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { Paperclip, ArrowUp, X, Loader2, ImagePlus } from "lucide-react";

export interface ComposerProps {
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onSend: (
    content?: string,
    opts?: { imageUrls?: string[] },
  ) => void;
  onResolve: (convId: string) => void;
  onCompose: () => void;
  composing: boolean;
  convId: string;
}

// Mirrors /api/upload's allowlist and agentReplySchema's imageUrls cap.
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
];
const MAX_IMAGES = 6;

export default function Composer({
  draft,
  setDraft,
  onSend,
  onResolve,
  onCompose,
  composing,
  convId,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  // dragenter/dragleave fire for every child crossed — track depth so the
  // overlay doesn't flicker while moving across the composer's children.
  const dragDepth = useRef(0);

  // Auto-grow: keep the textarea height synced to its content on EVERY draft
  // change — typed, pasted, programmatically filled, or cleared after send.
  // Driving this from a layout effect (rather than only an onInput handler,
  // which never fires on programmatic value changes) is what makes the box
  // follow a multiline paste and snap back to one row once the draft is
  // reset. Capped at max-h-[200px] via CSS; runs before paint so there's no
  // height flash.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [draft]);

  // The textarea is disabled while composing, which drops keyboard focus —
  // restore it (caret at the end) once the composed draft lands so the agent
  // can keep typing or hit ⌘↵ without reaching for the mouse.
  const wasComposing = useRef(false);
  useEffect(() => {
    if (wasComposing.current && !composing) {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
    wasComposing.current = composing;
  }, [composing]);

  // POST to /api/upload (field: "file") with one automatic retry — dev's
  // remote R2 binding (and real networks) hiccup transiently; a single retry
  // absorbs it. Throws with the server's error message when both fail.
  async function uploadOnce(file: File): Promise<string> {
    const attempt = async () => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "Upload failed");
      }
      const { url } = (await res.json()) as { url: string };
      return url;
    };
    try {
      return await attempt();
    } catch {
      await new Promise((r) => setTimeout(r, 600));
      return attempt();
    }
  }

  // Upload each image, append { url }s in completion order. Shared by the
  // paperclip picker and drag-and-drop.
  function uploadFiles(files: File[]) {
    const images = files.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    if (images.length < files.length) {
      toast.error("Only JPEG, PNG, WebP, or SVG images can be attached");
    }
    if (images.length === 0) return;

    const room = MAX_IMAGES - pendingImages.length - uploadingCount;
    const accepted = images.slice(0, Math.max(0, room));
    if (accepted.length < images.length) {
      toast.error(`You can attach up to ${MAX_IMAGES} images`);
    }

    // Parallel uploads, but chips append in selection order — completion
    // order would shuffle "screenshot 1, 2, 3" narratives.
    setUploadingCount((n) => n + accepted.length);
    void Promise.allSettled(accepted.map((file) => uploadOnce(file))).then(
      (results) => {
        const urls: string[] = [];
        results.forEach((result, i) => {
          if (result.status === "fulfilled") {
            urls.push(result.value);
          } else {
            const message =
              result.reason instanceof Error ? result.reason.message : "";
            toast.error(`${accepted[i].name}: ${message || "Upload failed"}`);
          }
        });
        setPendingImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
        setUploadingCount((n) => n - accepted.length);
      },
    );
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    uploadFiles(Array.from(e.target.files ?? []));
    // Reset file input so the same files can be re-selected.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function dragHasFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  function handleDragEnter(e: React.DragEvent) {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }

  function handleDragOver(e: React.DragEvent) {
    if (!dragHasFiles(e)) return;
    // preventDefault is what marks the composer as a valid drop target.
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!dragHasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  function handleDrop(e: React.DragEvent) {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    uploadFiles(Array.from(e.dataTransfer.files));
  }

  function removePendingImage(url: string) {
    setPendingImages((prev) => prev.filter((u) => u !== url));
  }

  function send() {
    if (composing || uploadingCount > 0) return;
    if (!draft.trim() && pendingImages.length === 0) return;
    onSend(draft || undefined, { imageUrls: pendingImages });
    setPendingImages([]);
  }

  // Cmd/Ctrl+Enter shortcut to send.
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault(); // keep focus in the textarea
      if (!composing && draft.trim().length > 0) onCompose();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  const canSend =
    (draft.trim().length > 0 || pendingImages.length > 0) &&
    uploadingCount === 0 &&
    !composing;

  return (
    <div className="sticky bottom-0 z-[5] px-4 pt-3 pb-4">
      <div
        className="relative rounded-[20px] border border-hairline-strong glass-bar p-[14px_14px_11px_18px]"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drop hint — covers the composer while dragging image files over it */}
        {dragActive && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-bubble-sent bg-glass-raised text-[13px] font-medium text-ink-2 pointer-events-none">
            <ImagePlus size={16} />
            Drop images to attach
          </div>
        )}

        {/* Attachment chips — one thumbnail per pending image with a corner
            remove button, pulse tiles while uploads are in flight */}
        {(uploadingCount > 0 || pendingImages.length > 0) && (
          <div className="flex flex-wrap items-center gap-2.5 pt-1.5 mb-3">
            {pendingImages.map((url) => (
              <div key={url} className="relative">
                <img
                  src={url}
                  alt="attachment"
                  className="w-14 h-14 rounded-[10px] object-cover border border-hairline-strong"
                />
                <button
                  type="button"
                  className="absolute -top-[7px] -right-[7px] flex items-center justify-center w-[18px] h-[18px] rounded-full bg-glass-raised border border-hairline-strong text-ink-4 hover:text-ink-1 transition-colors cursor-pointer"
                  onClick={() => removePendingImage(url)}
                  title="Remove attachment"
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              </div>
            ))}
            {Array.from({ length: uploadingCount }, (_, i) => (
              <div
                key={`uploading-${i}`}
                className="flex items-center justify-center w-14 h-14 rounded-[10px] bg-glass-raised animate-pulse text-ink-6"
              >
                <Loader2 size={15} className="animate-spin" />
              </div>
            ))}
          </div>
        )}

        {/* Reply textarea — auto-grows, capped at 200px */}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={composing ? "Composing…" : "Reply…"}
          rows={1}
          disabled={composing}
          className={`w-full resize-none bg-transparent outline-none text-ink-2 placeholder:text-ink-7 max-h-[200px] overflow-y-auto disabled:opacity-60${composing ? " animate-pulse" : ""}`}
          style={{ fontSize: "14.5px", lineHeight: "1.5" }}
        />

        {/* Action row */}
        <div className="flex items-center justify-between mt-[9px]">
          {/* Left: paperclip */}
          <div className="flex items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(",")}
              multiple
              className="hidden"
              onChange={handleFilePick}
            />
            <button
              type="button"
              className="glass-button flex items-center justify-center rounded-[8px] w-[30px] h-[30px] text-ink-5 hover:text-ink-2 disabled:opacity-40"
              onClick={() => fileInputRef.current?.click()}
              disabled={composing}
              title="Attach images"
            >
              <Paperclip size={14} />
            </button>
          </div>

          {/* Right: Compose / Resolve / Send */}
          <div className="flex items-center gap-[7px]">
            <button
              type="button"
              className={`flex items-center gap-1.5 text-[13px] transition-colors cursor-pointer ${
                composing ? "" : "text-ink-5 hover:text-ink-2 disabled:opacity-40"
              }`}
              onClick={onCompose}
              disabled={composing || draft.trim().length === 0}
              title="Turn your instruction into a reply, grounded in your docs (Shift+Tab)"
            >
              {composing ? (
                <span className="text-shimmer">Composing…</span>
              ) : (
                <>
                  Compose
                  <span className="keycap">⇧⇥</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="flex items-center gap-1.5 text-[13px] text-ink-5 hover:text-ink-2 transition-colors cursor-pointer"
              onClick={() => onResolve(convId)}
              title="Resolve conversation"
            >
              Resolve
              <span className="keycap">E</span>
            </button>

            {/* Send button */}
            <button
              type="button"
              className="flex items-center justify-center rounded-full bg-bubble-sent text-white w-8 h-8 hover:opacity-90 disabled:opacity-40 transition-opacity"
              onClick={send}
              disabled={!canSend}
              title="Send (⌘↵)"
            >
              <ArrowUp size={15} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
