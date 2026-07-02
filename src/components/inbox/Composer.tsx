import { useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { Paperclip, ArrowUp, X } from "lucide-react";

export interface ComposerProps {
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onSend: (
    content?: string,
    opts?: { imageUrl?: string | null },
  ) => void;
  onResolve: (convId: string) => void;
  convId: string;
}

export default function Composer({
  draft,
  setDraft,
  onSend,
  onResolve,
  convId,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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

  // Upload attachment to /api/upload (field: "file"), take back { url }.
  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = (await res.json()) as { url: string };
      setPendingImage(url);
    } catch {
      toast.error("Failed to upload image");
    } finally {
      setUploading(false);
      // Reset file input so the same file can be re-selected.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function send() {
    if (!draft.trim() && !pendingImage) return;
    onSend(draft || undefined, { imageUrl: pendingImage });
    setPendingImage(null);
  }

  // Cmd/Ctrl+Enter shortcut to send.
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  const canSend = (draft.trim().length > 0 || !!pendingImage) && !uploading;

  return (
    <div className="sticky bottom-0 z-[5] px-4 pt-3 pb-4">
      <div className="rounded-[20px] border border-hairline-strong glass-bar p-[14px_14px_11px_18px]">
        {/* Attachment chip — shown while uploading or when a pending image exists */}
        {(uploading || pendingImage) && (
          <div className="flex items-center gap-2 mb-[10px]">
            {uploading ? (
              <span className="text-[11.5px] text-ink-6">Uploading…</span>
            ) : pendingImage ? (
              <div className="relative inline-flex items-center gap-1 rounded-[10px] overflow-hidden bg-glass-raised pr-1.5">
                <img
                  src={pendingImage}
                  alt="attachment"
                  className="w-10 h-10 object-cover"
                />
                <button
                  type="button"
                  className="flex items-center justify-center text-ink-5 hover:text-ink-1 p-0.5"
                  onClick={() => setPendingImage(null)}
                  title="Remove attachment"
                >
                  <X size={11} />
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* Reply textarea — auto-grows, capped at 200px */}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Reply…"
          rows={1}
          className="w-full resize-none bg-transparent outline-none text-ink-2 placeholder:text-ink-7 max-h-[200px] overflow-y-auto"
          style={{ fontSize: "14.5px", lineHeight: "1.5" }}
        />

        {/* Action row */}
        <div className="flex items-center justify-between mt-[9px]">
          {/* Left: paperclip */}
          <div className="flex items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
              className="hidden"
              onChange={handleFilePick}
            />
            <button
              type="button"
              className="glass-button flex items-center justify-center rounded-[8px] w-[30px] h-[30px] text-ink-5 hover:text-ink-2 disabled:opacity-40"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Attach image"
            >
              <Paperclip size={14} />
            </button>
          </div>

          {/* Right: Resolve / Send */}
          <div className="flex items-center gap-[7px]">
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
