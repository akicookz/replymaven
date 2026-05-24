import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Info, AlertTriangle, Lightbulb, AlertOctagon } from "lucide-react";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";

export type CalloutVariant = "info" | "warning" | "tip" | "danger";

const VARIANTS: CalloutVariant[] = ["info", "warning", "tip", "danger"];

const VARIANT_LABEL: Record<CalloutVariant, string> = {
  info: "Info",
  warning: "Warning",
  tip: "Tip",
  danger: "Danger",
};

const VARIANT_ICON: Record<
  CalloutVariant,
  React.ComponentType<{ className?: string }>
> = {
  info: Info,
  warning: AlertTriangle,
  tip: Lightbulb,
  danger: AlertOctagon,
};

const VARIANT_CLASS: Record<CalloutVariant, string> = {
  info: "callout callout-info",
  warning: "callout callout-warning",
  tip: "callout callout-tip",
  danger: "callout callout-danger",
};

function CalloutView({ node, updateAttributes }: NodeViewProps) {
  const variant = (node.attrs.variant as CalloutVariant) ?? "info";
  const Icon = VARIANT_ICON[variant] ?? Info;
  return (
    <NodeViewWrapper
      className={VARIANT_CLASS[variant]}
      data-callout={variant}
    >
      <div className="callout-header" contentEditable={false}>
        <span className="callout-icon" aria-hidden="true">
          <Icon className="w-4 h-4" />
        </span>
        <select
          value={variant}
          onChange={(e) =>
            updateAttributes({ variant: e.target.value as CalloutVariant })
          }
          className="callout-variant-select"
          aria-label="Callout type"
        >
          {VARIANTS.map((v) => (
            <option key={v} value={v}>
              {VARIANT_LABEL[v]}
            </option>
          ))}
        </select>
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "paragraph+",
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: "info" as CalloutVariant,
        parseHTML: (element) => {
          const raw = (
            element.getAttribute("data-callout") ?? "info"
          ).toLowerCase();
          return VARIANTS.includes(raw as CalloutVariant) ? raw : "info";
        },
        renderHTML: (attrs) => ({ "data-callout": attrs.variant }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const variant = (node.attrs.variant as CalloutVariant) ?? "info";
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: VARIANT_CLASS[variant] }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const variant = (node.attrs.variant as CalloutVariant) ?? "info";
          state.write(`> [!${variant.toUpperCase()}]\n`);
          state.wrapBlock("> ", null, node, () => state.renderContent(node));
          state.closeBlock(node);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            // markdown-it renders `> [!INFO]\n> body` as a blockquote whose
            // first paragraph begins with `[!INFO]`. Rewrite those into our
            // callout DOM so parseHTML picks them up.
            const blockquotes = Array.from(element.querySelectorAll("blockquote"));
            for (const bq of blockquotes) {
              const firstPara = bq.querySelector(":scope > p");
              if (!firstPara) continue;
              const html = firstPara.innerHTML;
              const match = /^\s*\[!(INFO|WARNING|TIP|DANGER)\]\s*(<br\s*\/?>)?\s*/i.exec(
                html,
              );
              if (!match) continue;
              const variant = match[1].toLowerCase();

              const div = element.ownerDocument.createElement("div");
              div.setAttribute("data-callout", variant);
              div.className = `callout callout-${variant}`;

              const remainder = html.slice(match[0].length).trimStart();
              if (remainder) {
                firstPara.innerHTML = remainder;
              } else {
                firstPara.remove();
              }
              while (bq.firstChild) {
                div.appendChild(bq.firstChild);
              }
              bq.replaceWith(div);
            }
          },
        },
      },
    };
  },
});

export default Callout;
