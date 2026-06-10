import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { X } from "lucide-react";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Steps container (Mintlify-style). Markdown form:
 *
 *   :::steps
 *   ::step First step title
 *   any markdown blocks...
 *   ::step Second step title
 *   ...
 *   :::
 *
 * Step titles are plain text stored as a node attribute; bodies are arbitrary
 * block content. The worker mirrors this grammar in render-markdown.ts
 * (stepsExtension) — keep both sides in sync.
 */

// Minimal structural types for the markdown-it instance tiptap-markdown
// hands to parse.setup — avoids depending on markdown-it's own types.
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

function stepsBlockRule(
  state: MdState,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (!/^:::steps\s*$/.test(getLine(state, startLine))) return false;
  let closeLine = -1;
  for (let i = startLine + 1; i < endLine; i++) {
    if (/^:::\s*$/.test(getLine(state, i))) {
      closeLine = i;
      break;
    }
  }
  if (closeLine === -1) return false;
  if (silent) return true;

  const steps: { title: string; body: string }[] = [];
  let current: { title: string; body: string } | null = null;
  for (let i = startLine + 1; i < closeLine; i++) {
    const line = getLine(state, i);
    const match = /^::step\b[ \t]*(.*)$/.exec(line);
    if (match) {
      current = { title: match[1].trim(), body: "" };
      steps.push(current);
    } else if (current) {
      current.body += `${line}\n`;
    } else if (line.trim()) {
      // Content before the first ::step — treat as an untitled step.
      current = { title: "", body: `${line}\n` };
      steps.push(current);
    }
  }
  if (steps.length === 0) steps.push({ title: "", body: "" });

  state.push("steps_open", "div", 1).attrSet("data-steps", "");
  for (const step of steps) {
    const open = state.push("step_open", "div", 1);
    open.attrSet("data-step", "");
    open.attrSet("data-title", step.title);
    // Block-level parse only — the outer core chain runs the inline pass.
    // A full md.parse here would leave inline children pre-filled and the
    // outer pass would parse them a second time, duplicating all text.
    state.md.block.parse(step.body, state.md, state.env, state.tokens);
    state.push("step_close", "div", -1);
  }
  state.push("steps_close", "div", -1);
  state.line = closeLine + 1;
  return true;
}

function StepsView({ editor, node, getPos }: NodeViewProps) {
  const addStep = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor
      .chain()
      .focus()
      .insertContentAt(pos + node.nodeSize - 1, {
        type: "step",
        attrs: { title: "" },
        content: [{ type: "paragraph" }],
      })
      .run();
  };
  return (
    <NodeViewWrapper className="help-editor-steps">
      <NodeViewContent />
      <button
        type="button"
        className="help-editor-steps-add"
        contentEditable={false}
        onClick={addStep}
      >
        + Add step
      </button>
    </NodeViewWrapper>
  );
}

function StepView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  getPos,
}: NodeViewProps) {
  const title = (node.attrs.title as string) ?? "";
  const removeStep = () => {
    // The schema demands step+, so deleting the only step would just make
    // ProseMirror refill the container with an empty one — remove the whole
    // steps block instead.
    const pos = getPos();
    if (typeof pos === "number") {
      const $pos = editor.state.doc.resolve(pos);
      if ($pos.parent.type.name === "steps" && $pos.parent.childCount <= 1) {
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
    <NodeViewWrapper className="help-editor-step">
      <div className="help-editor-step-header" contentEditable={false}>
        <span className="help-editor-step-badge" aria-hidden="true" />
        <input
          type="text"
          className="help-editor-step-title"
          value={title}
          onChange={(e) => updateAttributes({ title: e.target.value })}
          placeholder="Step title"
          aria-label="Step title"
        />
        <button
          type="button"
          className="help-editor-step-remove"
          onClick={removeStep}
          aria-label="Remove step"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <NodeViewContent className="help-editor-step-body" />
    </NodeViewWrapper>
  );
}

export const Step = Node.create({
  name: "step",
  content: "block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      title: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-title") ?? "",
        renderHTML: (attrs) => ({ "data-title": attrs.title }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-step]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-step": "" }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(StepView);
  },

  addStorage() {
    return {
      markdown: {
        // Steps drives serialization; this only runs if a bare step ever
        // escapes its container.
        serialize(state: MarkdownSerializerState, node: PMNode) {
          state.renderContent(node);
        },
        parse: {},
      },
    };
  },
});

export const Steps = Node.create({
  name: "steps",
  group: "block",
  content: "step+",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-steps]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-steps": "" }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(StepsView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          state.write(":::steps");
          state.ensureNewLine();
          node.forEach((step) => {
            const title = String(step.attrs.title ?? "")
              .replace(/\s*\n\s*/g, " ")
              .trim();
            state.write(`::step ${title}`.trimEnd());
            state.ensureNewLine();
            state.renderContent(step);
            state.ensureNewLine();
          });
          state.write(":::");
          state.closeBlock(node);
        },
        parse: {
          setup(md: MdLike) {
            md.block.ruler.before("fence", "helpSteps", stepsBlockRule);
          },
        },
      },
    };
  },
});
