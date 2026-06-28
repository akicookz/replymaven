// Stub — Task 11 replaces this with the real composer (attachments + email).
// Props here are the contract Task 11 must match exactly.
import type { Dispatch, SetStateAction } from "react";

interface ComposerProps {
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onSend: (content?: string) => void;
  onResolve: (convId: string) => void;
  onRewrite: () => void;
}

export default function Composer({
  draft,
  setDraft,
  onSend,
  onResolve,
  onRewrite,
}: ComposerProps) {
  // Task 11 wires these up — reference them here so TypeScript validates the
  // prop contract even though the stub renders a placeholder.
  void setDraft;
  void onSend;
  void onResolve;
  void onRewrite;

  return (
    <div className="sticky bottom-0 z-[5] glass-bar px-[30px] py-4 text-ink-7 text-sm">
      {/* Task 11: render composer input here. draft="{draft}" */}
      <span className="sr-only">{draft}</span>
    </div>
  );
}
