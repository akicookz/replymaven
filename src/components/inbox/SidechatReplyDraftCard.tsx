import { useId } from "react";
import { Copy, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { MessageReplyDraft } from "@/lib/inbox/types";
import { renderMarkdown } from "@/lib/utils";

interface SidechatReplyDraftCardProps {
  draft: MessageReplyDraft;
  readOnly: boolean;
  sending: boolean;
  sendDisabled: boolean;
  onAddToReply?: (draft: string) => void;
  onSendAsMaven?: (sourceMessageId: string) => void;
}

export default function SidechatReplyDraftCard({
  draft,
  readOnly,
  sending,
  sendDisabled,
  onAddToReply,
  onSendAsMaven,
}: SidechatReplyDraftCardProps) {
  const titleId = useId();

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(draft.text);
      toast.success("Draft copied.");
    } catch {
      toast.error("Could not copy draft.");
    }
  }

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className="glass-focus w-full gap-0 rounded-2xl p-4"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3
          id={titleId}
          className="text-balance text-[13px] font-semibold text-ink-3"
        >
          Reply draft
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 px-2.5 text-ink-5 hover:text-ink-2 motion-safe:transition-[color,background-color,scale] motion-safe:active:scale-[0.96]"
          onClick={() => void handleCopy()}
          aria-label="Copy draft to clipboard"
        >
          <Copy aria-hidden="true" />
          Copy
        </Button>
      </div>

      <div
        className="prose-chat mt-3 text-pretty text-[14.5px] leading-normal text-ink-2"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.text) }}
      />

      {!readOnly && onAddToReply && onSendAsMaven && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="motion-safe:transition-[background-color,scale] motion-safe:active:scale-[0.96]"
            onClick={() => onAddToReply(draft.text)}
          >
            Add to reply
          </Button>
          <Button
            type="button"
            size="sm"
            className="motion-safe:transition-[background-color,scale] motion-safe:active:scale-[0.96]"
            disabled={sendDisabled}
            onClick={() => onSendAsMaven(draft.sourceMessageId)}
          >
            {sending ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Send aria-hidden="true" />
            )}
            Send as Maven
          </Button>
        </div>
      )}
    </Card>
  );
}
