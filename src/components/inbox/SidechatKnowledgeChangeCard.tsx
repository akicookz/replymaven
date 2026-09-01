import { useId } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { MessageKnowledgeChange } from "@/lib/inbox/types";
import { knowledgeChangeHeading } from "../../../shared/knowledge-change";
import { diffKnowledgeText } from "../../../shared/text-diff";
import { cn } from "@/lib/utils";

interface SidechatKnowledgeChangeCardProps {
  change: MessageKnowledgeChange;
  readOnly: boolean;
  onApprove?: (approvalId: string, toolCallId: string) => void;
  onReject?: (approvalId: string, toolCallId: string) => void;
}

function DiffView({ before, after }: { before: string; after: string }) {
  const lines = diffKnowledgeText(before, after);
  if (lines.length === 0) {
    return (
      <p className="mt-3 text-[13px] leading-relaxed text-ink-5">
        No text change.
      </p>
    );
  }

  return (
    <div className="knowledge-diff mt-3 overflow-x-auto text-[13px] leading-relaxed">
      {lines.map((line, index) => (
        <div
          key={`${line.kind}:${index}`}
          className={cn(
            "knowledge-diff-line",
            line.kind === "add" && "knowledge-diff-line-add",
            line.kind === "remove" && "knowledge-diff-line-remove",
          )}
        >
          {line.spans.map((span, spanIndex) => (
            <span
              key={`${span.kind}:${spanIndex}`}
              className={cn(
                span.kind === "add" && "knowledge-diff-add",
                span.kind === "remove" && "knowledge-diff-remove",
              )}
            >
              {span.text.length > 0 ? span.text : " "}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function SidechatKnowledgeChangeCard({
  change,
  readOnly,
  onApprove,
  onReject,
}: SidechatKnowledgeChangeCardProps) {
  const titleId = useId();
  const { preview, status, approvalId, errorText } = change;
  const pending = status === "pending" && !readOnly && approvalId && onApprove && onReject;

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
          {knowledgeChangeHeading(preview.action)}
        </h3>
        {status === "applied" && (
          <span className="text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
            Applied
          </span>
        )}
        {status === "rejected" && (
          <span className="text-[12px] font-medium text-ink-5">Rejected</span>
        )}
        {status === "error" && (
          <span className="text-[12px] font-medium text-destructive">Failed</span>
        )}
      </div>

      <p className="mt-1 text-pretty text-[13px] text-ink-2">
        {preview.title}
        {preview.url ? (
          <>
            <span aria-hidden="true"> · </span>
            <span className="break-all text-ink-5">{preview.url}</span>
          </>
        ) : null}
      </p>
      {preview.reason && (
        <p className="mt-1 text-pretty text-[12.5px] text-ink-5">{preview.reason}</p>
      )}

      <DiffView before={preview.before} after={preview.after} />

      {errorText && status === "error" && (
        <p className="mt-2 text-pretty text-[12px] text-destructive">{errorText}</p>
      )}

      {pending && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="motion-safe:transition-[background-color,scale] motion-safe:active:scale-[0.96]"
            onClick={() => onReject(approvalId, change.toolCallId)}
          >
            <X aria-hidden="true" />
            Reject
          </Button>
          <Button
            type="button"
            size="sm"
            className="motion-safe:transition-[background-color,scale] motion-safe:active:scale-[0.96]"
            onClick={() => onApprove(approvalId, change.toolCallId)}
          >
            <Check aria-hidden="true" />
            Approve
          </Button>
        </div>
      )}
    </Card>
  );
}
