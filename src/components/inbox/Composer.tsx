import { useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Paperclip, ArrowUp, X, Loader2, ImagePlus } from "lucide-react";
import { deriveComposerShiftTabIntent } from "@/lib/inbox/sidechat";
import SidechatStatusDot from "./SidechatStatusDot";
import type { SidechatStatus } from "../../../shared/ws-events";

export type ComposerMode =
  | {
      kind: "public";
      onStartSidechat: () => void;
      sidechatExists: boolean;
      sidechatStatus: SidechatStatus;
    }
  | { kind: "sidechat"; onSendPrivate: () => void; working: boolean };

interface ComposerBaseProps {
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onSend: (
    content?: string,
    opts?: { imageUrls?: string[] },
  ) => void;
  onResolve: (convId: string) => void;
  convId: string;
}

type ModernComposerProps = ComposerBaseProps & {
  mode: ComposerMode;
  onCompose?: never;
  composing?: never;
};

type LegacyComposerProps = ComposerBaseProps & {
  mode?: never;
  onCompose: () => void;
  composing: boolean;
};

export type ComposerProps = ModernComposerProps | LegacyComposerProps;

// Mirrors /api/upload's allowlist and agentReplySchema's imageUrls cap.
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
];
const MAX_IMAGES = 6;

export default function Composer(props: ComposerProps) {
  const { draft, setDraft, onSend, onResolve, mode, convId } = props;
  const legacyOnCompose = "onCompose" in props ? props.onCompose : undefined;
  const legacyComposing = "composing" in props && props.composing;
  const contract = mode?.kind ?? "legacy";
  const isPrivate = contract === "sidechat";
  const { projectId = "" } = useParams<{ projectId: string }>();
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

  // POST to /api/upload (field: "file") with one automatic retry — dev's
  // remote R2 binding (and real networks) hiccup transiently; a single retry
  // absorbs it. Throws with the server's error message when both fail.
  async function uploadOnce(file: File): Promise<string> {
    const attempt = async () => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("projectId", projectId);
      fd.append("conversationId", convId);
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
    if (isPrivate) return;
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
    if (mode?.kind === "sidechat") {
      if (mode.working || !draft.trim()) return;
      mode.onSendPrivate();
      return;
    }
    if (legacyComposing) return;
    if (uploadingCount > 0) return;
    if (!draft.trim() && pendingImages.length === 0) return;
    onSend(draft || undefined, { imageUrls: pendingImages });
    setPendingImages([]);
  }

  // Cmd/Ctrl+Enter shortcut to send.
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const shiftTabIntent = deriveComposerShiftTabIntent({
      contract,
      hasDraft: draft.trim().length > 0,
      key: e.key,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      isComposing: e.nativeEvent.isComposing,
      repeat: e.repeat,
    });
    if (shiftTabIntent) {
      e.preventDefault();
      if (shiftTabIntent === "start_sidechat" && mode?.kind === "public") {
        mode.onStartSidechat();
      } else if (shiftTabIntent === "legacy_compose") {
        legacyOnCompose?.();
      }
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  const canSend = mode?.kind === "sidechat"
    ? draft.trim().length > 0 && !mode.working
    : (draft.trim().length > 0 || pendingImages.length > 0) &&
      uploadingCount === 0 &&
      !legacyComposing;
  const publicSidechatLabel = mode?.kind === "public" && mode.sidechatExists
    ? "Open sidechat"
    : "Start sidechat";

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
        {!isPrivate && dragActive && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-bubble-sent bg-glass-raised text-[13px] font-medium text-ink-2 pointer-events-none">
            <ImagePlus size={16} />
            Drop images to attach
          </div>
        )}

        {/* Attachment chips — one thumbnail per pending image with a corner
            remove button, pulse tiles while uploads are in flight */}
        {!isPrivate &&
          (uploadingCount > 0 || pendingImages.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-1.5 mb-3">
            {pendingImages.map((url) => (
              <div key={url} className="relative mt-2">
                <img
                  src={url}
                  alt="attachment"
                  className="w-14 h-14 rounded-[10px] object-cover border border-hairline-strong"
                />
                <button
                  type="button"
                  className="absolute -right-3 -top-3 flex size-10 shrink-0 items-center justify-center text-ink-4 hover:text-ink-1 cursor-pointer motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96]"
                  onClick={() => removePendingImage(url)}
                  title="Remove attachment"
                  aria-label="Remove attachment"
                >
                  <span className="flex size-[18px] items-center justify-center rounded-full border border-hairline-strong bg-glass-raised">
                    <X size={10} strokeWidth={2.5} />
                  </span>
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
          data-public-composer={!isPrivate ? "true" : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isPrivate
            ? "Ask Maven…"
            : legacyComposing
              ? "Composing…"
              : "Reply…"}
          rows={1}
          disabled={mode?.kind === "sidechat" ? mode.working : legacyComposing}
          className={`w-full resize-none bg-transparent outline-none text-ink-2 placeholder:text-ink-7 max-h-[200px] overflow-y-auto disabled:opacity-60${legacyComposing ? " animate-pulse" : ""}`}
          style={{ fontSize: "14.5px", lineHeight: "1.5" }}
        />

        {/* Action row */}
        <div
          data-composer-action-row
          className="mt-[9px] flex flex-wrap items-center justify-between gap-x-2 gap-y-1"
        >
          {/* Left: paperclip */}
          {!isPrivate && (
            <div className="flex shrink-0 items-center gap-1.5">
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
                className="flex size-10 shrink-0 items-center justify-center text-ink-5 hover:text-ink-2 disabled:opacity-40 motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96]"
                onClick={() => fileInputRef.current?.click()}
                disabled={legacyComposing}
                title="Attach images"
                aria-label="Attach images"
              >
                <span className="glass-button flex size-[30px] items-center justify-center rounded-[8px]">
                  <Paperclip size={14} />
                </span>
              </button>
            </div>
          )}

          {/* Right: Sidechat / Resolve / Send */}
          <div
            data-composer-actions
            className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-[7px] gap-y-1"
          >
            {mode?.kind === "public" && (
              <>
                <button
                  type="button"
                  className="flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-5 hover:text-ink-2 cursor-pointer motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96]"
                  onClick={mode.onStartSidechat}
                  title={`${publicSidechatLabel} (Shift+Tab)`}
                >
                  {mode.sidechatExists && (
                    <SidechatStatusDot status={mode.sidechatStatus} />
                  )}
                  {publicSidechatLabel}
                  <span className="keycap">⇧⇥</span>
                </button>

                <button
                  type="button"
                  className="flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-5 hover:text-ink-2 cursor-pointer motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96]"
                  onClick={() => onResolve(convId)}
                  title="Resolve conversation"
                >
                  Resolve
                  <span className="keycap">E</span>
                </button>
              </>
            )}

            {contract === "legacy" && (
              <>
                <button
                  type="button"
                  className="flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-5 hover:text-ink-2 disabled:opacity-40 cursor-pointer motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96]"
                  onClick={legacyOnCompose}
                  disabled={legacyComposing || draft.trim().length === 0}
                  title="Turn your instruction into a reply, grounded in your docs (Shift+Tab)"
                >
                  {legacyComposing ? (
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
                  className="flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-5 hover:text-ink-2 cursor-pointer motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96]"
                  onClick={() => onResolve(convId)}
                  title="Resolve conversation"
                >
                  Resolve
                  <span className="keycap">E</span>
                </button>
              </>
            )}

            {/* Send button */}
            <button
              type="button"
              className="group flex size-10 shrink-0 items-center justify-center disabled:opacity-40 motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.96]"
              onClick={send}
              disabled={!canSend}
              title={isPrivate ? "Send to Maven (⌘↵)" : "Send (⌘↵)"}
              aria-label={isPrivate ? "Send to Maven" : "Send reply"}
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-bubble-sent text-white transition-opacity group-hover:opacity-90">
                <ArrowUp size={15} strokeWidth={2.5} />
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
