import type { Editor, Range } from "@tiptap/core";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Table as TableIcon,
  Minus,
  ImageIcon,
  Info,
  AlertTriangle,
  Lightbulb,
  AlertOctagon,
} from "lucide-react";
import type { CalloutVariant } from "./callout";

export interface SlashItem {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  icon: React.ComponentType<{ className?: string }>;
  command: (args: { editor: Editor; range: Range }) => void;
}

export interface SlashItemContext {
  openImagePicker: () => void;
}

export function buildSlashItems(ctx: SlashItemContext): SlashItem[] {
  const setCallout =
    (variant: CalloutVariant) =>
    ({ editor, range }: { editor: Editor; range: Range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "callout",
          attrs: { variant },
          content: [{ type: "paragraph" }],
        })
        .run();
    };

  return [
    {
      id: "h1",
      title: "Heading 1",
      description: "Large section heading",
      keywords: ["h1", "heading", "title"],
      icon: Heading1,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
    },
    {
      id: "h2",
      title: "Heading 2",
      description: "Medium section heading",
      keywords: ["h2", "heading"],
      icon: Heading2,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
    },
    {
      id: "h3",
      title: "Heading 3",
      description: "Small section heading",
      keywords: ["h3", "heading"],
      icon: Heading3,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
    },
    {
      id: "ul",
      title: "Bulleted list",
      description: "Unordered list",
      keywords: ["ul", "bullet", "unordered", "list"],
      icon: List,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      id: "ol",
      title: "Numbered list",
      description: "Ordered list",
      keywords: ["ol", "ordered", "numbered", "list"],
      icon: ListOrdered,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      id: "task",
      title: "Task list",
      description: "Checkable to-do items",
      keywords: ["task", "todo", "checklist", "check"],
      icon: ListChecks,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      id: "quote",
      title: "Quote",
      description: "Blockquote",
      keywords: ["quote", "blockquote"],
      icon: Quote,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      id: "callout-info",
      title: "Info callout",
      description: "Highlighted info block",
      keywords: ["callout", "info", "note"],
      icon: Info,
      command: setCallout("info"),
    },
    {
      id: "callout-warning",
      title: "Warning callout",
      description: "Highlighted warning block",
      keywords: ["callout", "warning", "warn"],
      icon: AlertTriangle,
      command: setCallout("warning"),
    },
    {
      id: "callout-tip",
      title: "Tip callout",
      description: "Highlighted tip block",
      keywords: ["callout", "tip", "hint"],
      icon: Lightbulb,
      command: setCallout("tip"),
    },
    {
      id: "callout-danger",
      title: "Danger callout",
      description: "Highlighted danger block",
      keywords: ["callout", "danger", "alert"],
      icon: AlertOctagon,
      command: setCallout("danger"),
    },
    {
      id: "code",
      title: "Code block",
      description: "Syntax-highlighted code",
      keywords: ["code", "snippet", "fenced"],
      icon: Code2,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      id: "table",
      title: "Table",
      description: "3×3 table with header row",
      keywords: ["table", "grid"],
      icon: TableIcon,
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      id: "image",
      title: "Image",
      description: "Upload an image with alt text",
      keywords: ["image", "picture", "photo"],
      icon: ImageIcon,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        ctx.openImagePicker();
      },
    },
    {
      id: "divider",
      title: "Divider",
      description: "Horizontal rule",
      keywords: ["divider", "hr", "rule", "separator"],
      icon: Minus,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
  ];
}

export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.includes(q)),
  );
}
