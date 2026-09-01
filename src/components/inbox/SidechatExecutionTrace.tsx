import { Brain, ChevronDown, Plug } from "lucide-react";
import type {
  SidechatToolTraceState,
  SidechatTraceItem,
} from "@/lib/inbox/types";
import { isSidechatToolRunning } from "@/lib/inbox/sidechat";
import { renderMarkdown } from "@/lib/utils";

interface SidechatExecutionTraceProps {
  items: SidechatTraceItem[];
  onApproval?: (
    approvalId: string,
    toolCallId: string,
    mode: "always" | "once",
  ) => void;
}

function toolStatus(state: SidechatToolTraceState): string {
  switch (state) {
    case "input-streaming":
    case "input-available":
      return "Running";
    case "approval-requested":
      return "Needs permission";
    case "approval-responded":
      return "Permission granted";
    case "output-available":
      return "Completed";
    case "output-denied":
      return "Denied";
    case "output-error":
      return "Errored";
  }
}

function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined) return null;
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round(
    (durationMs % 60_000) / 1_000,
  )}s`;
}

function reasoningPresentation(
  item: Extract<SidechatTraceItem, { type: "reasoning" }>,
): { title: string; body: string } {
  const [firstLine = "", ...rest] = item.text.split(/\r?\n/u);
  const title = firstLine
    .trim()
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^(?:\*\*|__)/u, "")
    .replace(/(?:\*\*|__)$/u, "")
    .trim();
  if (!title) {
    return {
      title: item.state === "streaming" ? "Thinking…" : "Thought",
      body: item.text.trim(),
    };
  }
  // A truncated title keeps the full first line in the body so nothing is lost.
  if (title.length > 160) {
    return { title: `${title.slice(0, 159).trimEnd()}…`, body: item.text.trim() };
  }
  return { title, body: rest.join("\n").trim() };
}

function prettyPayload(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function PayloadDisclosure({
  label,
  value,
}: {
  label: "Request" | "Response";
  value: unknown;
}) {
  const rendered = prettyPayload(value);
  if (!rendered) return null;
  return (
    <details className="group/payload relative ml-1 pl-6 before:absolute before:left-[3px] before:top-5 before:-bottom-2 before:w-px before:bg-ink-1/10">
      <summary className="relative flex min-h-9 cursor-pointer list-none items-center gap-2 text-[11.5px] font-medium text-ink-6 hover:text-ink-3 motion-safe:transition-colors motion-safe:duration-150 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="absolute -left-6 size-[7px] rounded-full bg-ink-7"
        />
        <span>{label}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform duration-150 group-open/payload:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all pr-2 pb-2 font-mono text-[11px] leading-relaxed text-ink-5 selection:bg-brand/30">
        {rendered}
      </pre>
    </details>
  );
}

function ToolTrace({
  item,
  onApproval,
}: {
  item: Extract<SidechatTraceItem, { type: "tool" }>;
  onApproval?: SidechatExecutionTraceProps["onApproval"];
}) {
  const status = toolStatus(item.state);
  const duration = formatDuration(item.durationMs);
  const waiting = item.state === "approval-requested" && item.approval;
  const running = isSidechatToolRunning(item.state);
  const sourceName = item.tool.source.name;

  return (
    <div data-sidechat-tool-call={item.toolCallId}>
      <details className="group/tool">
        <summary
          className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-[12.5px] text-ink-4 hover:text-ink-2 motion-safe:transition-colors motion-safe:duration-150 [&::-webkit-details-marker]:hidden"
          aria-label={`${sourceName}: ${item.tool.displayName}`}
        >
          <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-ink-1/5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
            {item.tool.source.icon ? (
              <img
                src={item.tool.source.icon}
                alt=""
                aria-hidden="true"
                className="size-full object-contain p-0.5"
              />
            ) : (
              <Plug aria-hidden="true" className="size-3 text-ink-5" />
            )}
          </span>
          {running ? (
            <span
              data-sidechat-tool-running
              className="rm-text-sweep min-w-0 truncate font-medium"
            >
              {sourceName} · {item.tool.displayName}
            </span>
          ) : (
            <>
              <span className="shrink-0">{sourceName}</span>
              <span aria-hidden="true" className="text-ink-7">
                ·
              </span>
              <strong className="min-w-0 truncate font-medium text-ink-3">
                {item.tool.displayName}
              </strong>
            </>
          )}
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 shrink-0 transition-transform duration-150 group-open/tool:rotate-180 motion-reduce:transition-none"
          />
        </summary>

        <div>
          <PayloadDisclosure label="Request" value={item.input} />
          <PayloadDisclosure label="Response" value={item.output} />

          <div className="relative ml-1 pl-6">
            <span
              aria-hidden="true"
              className="absolute left-0 top-[14px] size-[7px] rounded-full bg-ink-7"
            />
            <div className="flex min-h-9 items-center gap-1.5 text-[11px] font-normal tabular-nums text-ink-7">
              <span>{status}</span>
              {duration && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{duration}</span>
                </>
              )}
            </div>

            {item.errorText && (
              <p className="pb-2 text-pretty text-[11.5px] leading-relaxed text-ink-5">
                {item.errorText}
              </p>
            )}
          </div>
        </div>
      </details>

      {waiting && onApproval && (
        <div className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 pl-7">
          {waiting.canAlwaysAllow && (
            <button
              type="button"
              className="group flex min-h-10 shrink-0 items-center whitespace-nowrap text-[12px] font-medium motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.97]"
              onClick={() => onApproval(waiting.id, item.toolCallId, "always")}
            >
              <span className="rounded-full bg-ink-1/5 px-3 py-1 text-ink-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] group-hover:text-ink-2 motion-safe:transition-colors motion-safe:duration-150">
                Always allow
              </span>
            </button>
          )}
          <button
            type="button"
            className="group flex min-h-10 shrink-0 items-center whitespace-nowrap text-[12px] font-medium motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.97]"
            onClick={() => onApproval(waiting.id, item.toolCallId, "once")}
          >
            <span className="rounded-full bg-brand/15 px-3 py-1 text-brand-label ring-1 ring-inset ring-brand/25 group-hover:bg-brand/25 motion-safe:transition-colors motion-safe:duration-150">
              Allow once
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function ReasoningTrace({
  item,
}: {
  item: Extract<SidechatTraceItem, { type: "reasoning" }>;
}) {
  const { title, body } = reasoningPresentation(item);
  const titleClassName = item.state === "streaming"
    ? "rm-text-sweep min-w-0 truncate font-medium"
    : "min-w-0 truncate font-medium text-ink-3";

  if (!body) {
    return (
      <div className="flex min-h-10 items-center gap-2.5 text-[12.5px] text-ink-5">
        <Brain aria-hidden="true" className="size-4 shrink-0" />
        <span className={titleClassName}>{title}</span>
      </div>
    );
  }

  return (
    <details className="group/reasoning">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2.5 text-[12.5px] text-ink-5 hover:text-ink-2 motion-safe:transition-colors motion-safe:duration-150 [&::-webkit-details-marker]:hidden">
        <Brain aria-hidden="true" className="size-4 shrink-0" />
        <span className={titleClassName}>{title}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform duration-150 group-open/reasoning:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div
        className="ml-6 pb-2 pr-2 text-[12px] leading-relaxed text-ink-5"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
      />
    </details>
  );
}

export default function SidechatExecutionTrace({
  items,
  onApproval,
}: SidechatExecutionTraceProps) {
  return (
    <div
      data-sidechat-execution
      data-sidechat-execution-placement="before-answer"
      className="mb-1.5 w-full max-w-[94%] text-ink-5"
    >
      {items.map((item) =>
        item.type === "reasoning" ? (
          <ReasoningTrace key={item.id} item={item} />
        ) : (
          <ToolTrace key={item.id} item={item} onApproval={onApproval} />
        )
      )}
    </div>
  );
}
