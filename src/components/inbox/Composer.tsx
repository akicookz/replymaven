import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { Paperclip, ArrowUp, ChevronDown, X } from "lucide-react";

export interface ComposerProps {
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onSend: (
    content?: string,
    opts?: { imageUrl?: string | null; asEmail?: boolean },
  ) => void;
  onResolve: (convId: string) => void;
  onRewrite: () => void;
  convId: string;
  visitorEmail: string | null;
}

export default function Composer({
  draft,
  setDraft,
  onSend,
  onResolve,
  onRewrite,
  convId,
  visitorEmail,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  // Auto-grow: expand to content, capped by max-h-[200px] via CSS.
  function handleInput() {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }

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

  function send(opts?: { asEmail?: boolean }) {
    if (!draft.trim() && !pendingImage) return;
    onSend(draft || undefined, {
      imageUrl: pendingImage,
      asEmail: opts?.asEmail,
    });
    setPendingImage(null);
    setShowMenu(false);
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
    <div className="sticky bottom-0 z-[5] glass-bar px-4 pt-3 pb-4">
      <div className="rounded-[20px] border border-hairline-strong bg-glass-button p-[14px_14px_11px_18px]">
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
          onInput={handleInput}
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

          {/* Right: Rewrite / Resolve / Send */}
          <div className="flex items-center gap-[7px]">
            <button
              type="button"
              className="keycap cursor-pointer hover:opacity-80"
              onClick={onRewrite}
              title="Rewrite with AI"
            >
              R
            </button>
            <button
              type="button"
              className="keycap cursor-pointer hover:opacity-80"
              onClick={() => onResolve(convId)}
              title="Resolve conversation"
            >
              E
            </button>

            {/* Send button + email dropdown */}
            <div className="relative flex items-center gap-0.5">
              <button
                type="button"
                className="flex items-center justify-center rounded-full bg-bubble-sent text-white w-8 h-8 hover:opacity-90 disabled:opacity-40 transition-opacity"
                onClick={() => send()}
                disabled={!canSend}
                title="Send (⌘↵)"
              >
                <ArrowUp size={15} strokeWidth={2.5} />
              </button>

              {/* Caret — opens "Send as email" option */}
              <button
                type="button"
                className="glass-button flex items-center justify-center rounded-[6px] w-5 h-5 text-ink-5 hover:text-ink-2"
                onClick={() => setShowMenu((v) => !v)}
                title="More send options"
              >
                <ChevronDown size={11} />
              </button>

              {showMenu && (
                <>
                  {/* Click-away backdrop */}
                  <div
                    className="fixed inset-0 z-[9]"
                    onClick={() => setShowMenu(false)}
                  />
                  <div className="absolute bottom-full right-0 mb-1.5 z-[10] rounded-[10px] border border-hairline-strong bg-glass-reading backdrop-blur-[24px] shadow-lg overflow-hidden min-w-[150px]">
                    <button
                      type="button"
                      className="block w-full text-left px-3 py-[8px] text-[12.5px] text-ink-2 hover:bg-glass-raised disabled:opacity-40"
                      onClick={() => send()}
                      disabled={!canSend}
                    >
                      Send
                    </button>
                    <button
                      type="button"
                      className="block w-full text-left px-3 py-[8px] text-[12.5px] text-ink-2 hover:bg-glass-raised disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => send({ asEmail: true })}
                      disabled={!visitorEmail || !canSend}
                      title={!visitorEmail ? "No visitor email on file" : undefined}
                    >
                      Send as email
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
