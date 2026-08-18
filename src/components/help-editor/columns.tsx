import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";

interface MdToken {
  attrSet(name: string, value: string): void;
  block: boolean;
}
interface MdState {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  line: number;
  env: unknown;
  tokens: unknown[];
  md: {
    block: {
      parse(src: string, md: unknown, env: unknown, tokens: unknown[]): void;
    };
  };
  push(type: string, tag: string, nesting: number): MdToken;
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

function columnsBlockRule(
  state: MdState,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (!/^:::columns\s*$/.test(getLine(state, startLine))) return false;
  let closeLine = -1;
  for (let i = startLine + 1; i < endLine; i++) {
    if (/^:::\s*$/.test(getLine(state, i))) {
      closeLine = i;
      break;
    }
  }
  if (closeLine === -1) return false;
  if (silent) return true;

  const columns: { body: string }[] = [];
  let current: { body: string } | null = null;
  for (let i = startLine + 1; i < closeLine; i++) {
    const line = getLine(state, i);
    if (/^::column\b[ \t]*$/.test(line)) {
      current = { body: "" };
      columns.push(current);
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  if (columns.length === 0) columns.push({ body: "" }, { body: "" });

  state.push("columns_open", "div", 1).attrSet("data-columns", "");
  for (const column of columns) {
    state.push("column_open", "div", 1).attrSet("data-column", "");
    state.md.block.parse(column.body, state.md, state.env, state.tokens);
    state.push("column_close", "div", -1);
  }
  state.push("columns_close", "div", -1);
  state.line = closeLine + 1;
  return true;
}

function ColumnsView({ editor, node, getPos }: NodeViewProps) {
  const addColumn = () => {
    if (node.childCount >= 2) return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor
      .chain()
      .focus()
      .insertContentAt(pos + node.nodeSize - 1, {
        type: "column",
        content: [{ type: "paragraph" }],
      })
      .run();
  };
  return (
    <NodeViewWrapper className="help-editor-columns">
      <NodeViewContent />
      {node.childCount < 2 && (
        <button
          type="button"
          className="help-editor-columns-add"
          contentEditable={false}
          onClick={addColumn}
        >
          + Add column
        </button>
      )}
    </NodeViewWrapper>
  );
}

function ColumnView({ deleteNode, editor, getPos }: NodeViewProps) {
  const removeColumn = () => {
    const pos = getPos();
    if (typeof pos === "number") {
      const $pos = editor.state.doc.resolve(pos);
      if ($pos.parent.type.name === "columns" && $pos.parent.childCount <= 1) {
        editor
          .chain()
          .focus()
          .deleteRange({ from: $pos.before(), to: $pos.after() })
          .run();
        return;
      }
    }
    deleteNode();
  };
  return (
    <NodeViewWrapper className="help-editor-column">
      <button
        type="button"
        className="help-editor-column-remove"
        contentEditable={false}
        onClick={removeColumn}
        aria-label="Remove column"
      >
        ×
      </button>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

export const Column = Node.create({
  name: "column",
  content: "block+",
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-column": "" }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          state.renderContent(node);
        },
        parse: {},
      },
    };
  },
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column+",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-columns": "" }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnsView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          state.write(":::columns");
          state.ensureNewLine();
          node.forEach((column) => {
            state.write("::column");
            state.ensureNewLine();
            state.renderContent(column);
            state.ensureNewLine();
          });
          state.write(":::");
          state.closeBlock(node);
        },
        parse: {
          setup(md: MdLike) {
            md.block.ruler.before("fence", "helpColumns", columnsBlockRule);
          },
        },
      },
    };
  },
});
