import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { X } from "lucide-react";
import {
  parseHelpHomeBlockLine,
  parsePopularArticleIds,
  serializeHelpHomeBlock,
} from "../../../shared/help-home-markdown";
import { HelpHomeBlockPreview } from "./help-home-previews";

export type HelpHomeBlockKind = "search" | "categories" | "popular";

const KINDS: HelpHomeBlockKind[] = ["search", "categories", "popular"];

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
  const parsed = parseHelpHomeBlockLine(getLine(state, startLine));
  if (!parsed) return false;
  if (silent) return true;
  const idsAttr =
    parsed.kind === "popular" && parsed.articleIds.length > 0
      ? ` data-article-ids="${parsed.articleIds.join(",")}"`
      : "";
  const open = state.push("html_block", "", 0) as { content: string };
  open.content = `<div data-help-block="${parsed.kind}"${idsAttr}></div>\n`;
  state.line = startLine + 1;
  return true;
}

function articleIdsFromAttrs(value: unknown): string[] {
  if (Array.isArray(value)) return parsePopularArticleIds(value.join(","));
  if (typeof value === "string") return parsePopularArticleIds(value);
  return [];
}

function HelpHomeBlockView({
  node,
  deleteNode,
  selected,
  updateAttributes,
}: NodeViewProps) {
  const kind = (node.attrs.kind as HelpHomeBlockKind) ?? "search";
  const articleIds = articleIdsFromAttrs(node.attrs.articleIds);
  return (
    <NodeViewWrapper
      className={selected ? "help-editor-live is-selected" : "help-editor-live"}
      data-help-block={kind}
    >
      <div className="help-editor-live-toolbar" contentEditable={false}>
        <button
          type="button"
          className="help-editor-live-remove"
          contentEditable={false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => deleteNode()}
          aria-label="Remove block"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        className={
          kind === "popular"
            ? "help-editor-live-preview is-editable"
            : "help-editor-live-preview"
        }
        contentEditable={false}
        onClick={(event) => event.stopPropagation()}
      >
        <HelpHomeBlockPreview
          kind={kind}
          articleIds={articleIds}
          onArticleIdsChange={(ids) => updateAttributes({ articleIds: ids })}
        />
      </div>
    </NodeViewWrapper>
  );
}

export const HelpHomeBlock = Node.create({
  name: "helpHomeBlock",
  group: "block",
  atom: true,
  selectable: false,

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
      articleIds: {
        default: [] as string[],
        parseHTML: (element) =>
          parsePopularArticleIds(element.getAttribute("data-article-ids")),
        renderHTML: (attrs) => {
          const ids = articleIdsFromAttrs(attrs.articleIds);
          if (ids.length === 0) return {};
          return { "data-article-ids": ids.join(",") };
        },
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
          state.write(
            serializeHelpHomeBlock(kind, articleIdsFromAttrs(node.attrs.articleIds)),
          );
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
