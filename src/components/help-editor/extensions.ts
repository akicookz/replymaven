import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import { Markdown } from "tiptap-markdown";
import { ImageWithAlt } from "./image-with-alt";
import { Callout } from "./callout";
import { Steps, Step } from "./steps";
import { ApiEndpoint, ApiStatus, ApiParams, ApiExamples } from "./api-blocks";
import { createSlashCommand } from "./slash-command";
import type { SlashItemContext } from "./slash-command-items";

const lowlight = createLowlight();
lowlight.register("js", javascript);
lowlight.register("javascript", javascript);
lowlight.register("ts", typescript);
lowlight.register("typescript", typescript);
lowlight.register("json", json);
lowlight.register("html", xml);
lowlight.register("xml", xml);
lowlight.register("css", css);
lowlight.register("bash", bash);
lowlight.register("sh", bash);
lowlight.register("shell", bash);
lowlight.register("python", python);
lowlight.register("py", python);
lowlight.register("sql", sql);

export interface BuildExtensionsArgs extends SlashItemContext {
  placeholder?: string;
}

export function buildExtensions(args: BuildExtensionsArgs) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: "noopener noreferrer" },
    }),
    ImageWithAlt,
    Placeholder.configure({
      placeholder: ({ node, editor }) => {
        if (node.type.name === "heading" && node.attrs.level === 1) {
          return "Untitled article";
        }
        if (!editor.isFocused) return args.placeholder ?? "Write your article…";
        if (node.type.name === "paragraph") return "Press / for commands…";
        return "";
      },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    Steps,
    Step,
    ApiEndpoint,
    ApiStatus,
    ApiParams,
    ApiExamples,
    createSlashCommand({ openImagePicker: args.openImagePicker }),
    Markdown.configure({
      // `html: true` lets us roundtrip <img width="..."> (resizable images).
      // The editor's parseDOM only accepts known schema nodes, so unknown
      // tags are filtered; sanitize-html still runs on public output.
      html: true,
      tightLists: true,
      bulletListMarker: "-",
      linkify: true,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}
