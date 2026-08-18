import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { LayoutGrid, Search, TrendingUp } from "lucide-react";

export type HelpHomeBlockKind = "search" | "categories" | "popular";

const KINDS: HelpHomeBlockKind[] = ["search", "categories", "popular"];

const KIND_LABEL: Record<HelpHomeBlockKind, string> = {
  search: "Search",
  categories: "Categories",
  popular: "Popular articles",
};

interface MdState {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  line: number;
  push(type: string, tag: string, nesting: number): { content?: string; attrSet(name: string, value: string): void };
}
interface MdLike {
  block: {
    ruler: {
      before(
        beforeName: string,
        ruleName: string,
        rule: (
          state: MdState,
          startLine: number,
          endLine: number,
          silent: boolean,
        ) => boolean,
      ): void;
    };
  };
}

function getLine(state: MdState, line: number): string {
  return state.src.slice(
    state.bMarks[line] + state.tShift[line],
    state.eMarks[line],
  );
}

function helpHomeBlockRule(
  state: MdState,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean {
  const match = /^::help-(search|categories|popular)\s*$/.exec(
    getLine(state, startLine),
  );
  if (!match) return false;
  if (silent) return true;
  const open = state.push("html_block", "", 0) as { content: string };
  open.content = `<div data-help-block="${match[1]}"></div>\n`;
  state.line = startLine + 1;
  return true;
}

function HelpHomeBlockView({ node }: NodeViewProps) {
  const kind = (node.attrs.kind as HelpHomeBlockKind) ?? "search";
  const Icon =
    kind === "search" ? Search : kind === "popular" ? TrendingUp : LayoutGrid;
  return (
    <NodeViewWrapper
      className="help-editor-home-block"
      data-help-block={kind}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{KIND_LABEL[kind]}</span>
    </NodeViewWrapper>
  );
}

export const HelpHomeBlock = Node.create({
  name: "helpHomeBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      kind: {
        default: "search" as HelpHomeBlockKind,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-help-block") ?? "search";
          return KINDS.includes(raw as HelpHomeBlockKind) ? raw : "search";
        },
        renderHTML: (attrs) => ({ "data-help-block": attrs.kind }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-help-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(HelpHomeBlockView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const kind = (node.attrs.kind as HelpHomeBlockKind) ?? "search";
          state.write(`::help-${kind}`);
          state.closeBlock(node);
        },
        parse: {
          setup(md: MdLike) {
            md.block.ruler.before("fence", "helpHomeBlock", helpHomeBlockRule);
          },
        },
      },
    };
  },
});
