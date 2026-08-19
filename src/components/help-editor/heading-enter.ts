import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { slashPluginKey } from "./slash-command";

export function isEmptyParagraphNode(node: PMNode | null): node is PMNode {
  if (!node || node.type.name !== "paragraph") return false;
  if (node.content.size === 0) return true;
  let empty = true;
  node.forEach((child) => {
    if (child.type.name === "hardBreak") return;
    if (child.isText && !child.text?.replace(/\u00A0/g, "").trim()) return;
    empty = false;
  });
  return empty;
}

/**
 * Enter in a heading must start a paragraph. ProseMirror splitBlock keeps
 * heading type when the cursor is not at the end of the line, and TrailingNode
 * already keeps an empty paragraph after the last heading — splitting there
 * leaves two blank lines.
 */
export const HeadingEnterParagraph = Extension.create({
  name: "headingEnterParagraph",
  // Ahead of the default keymap (priority 100) so this Enter runs first.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (slashPluginKey.getState(this.editor.state)?.active) return false;
        const { $from } = this.editor.state.selection;
        if ($from.parent.type.name !== "heading") return false;
        if ($from.parentOffset !== $from.parent.content.size) {
          return this.editor.chain().splitBlock().setParagraph().run();
        }
        return this.editor.commands.command(({ state, tr, dispatch }) => {
          const paragraph = state.schema.nodes.paragraph;
          if (!paragraph) return false;
          const pos = $from.after();
          const next = state.doc.nodeAt(pos);
          if (!dispatch) return true;
          if (isEmptyParagraphNode(next)) {
            const extraPos = pos + next.nodeSize;
            const extra = state.doc.nodeAt(extraPos);
            if (isEmptyParagraphNode(extra)) {
              tr.delete(extraPos, extraPos + extra.nodeSize);
            }
            tr.setSelection(TextSelection.create(tr.doc, pos + 1));
            return true;
          }
          tr.insert(pos, paragraph.create());
          tr.setSelection(TextSelection.create(tr.doc, pos + 1));
          return true;
        });
      },
    };
  },
});
