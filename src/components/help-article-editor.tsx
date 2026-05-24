import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import type { MarkdownStorage } from "tiptap-markdown";
import { ImageIcon, Loader2, Undo2, Redo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildExtensions } from "@/components/help-editor/extensions";
import { EditorBubbleMenu } from "@/components/help-editor/bubble-menu";

export interface DerivedMeta {
  title: string;
  excerpt: string;
}

interface HelpArticleEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onMetaChange?: (meta: DerivedMeta) => void;
  placeholder?: string;
  variant?: "card" | "page";
}

function getMarkdown(editor: TiptapEditor): string {
  const storage = editor.storage as unknown as { markdown: MarkdownStorage };
  return storage.markdown.getMarkdown();
}

function deriveMeta(editor: TiptapEditor): DerivedMeta {
  let title = "";
  let excerpt = "";
  let titleFound = false;
  editor.state.doc.descendants((node) => {
    if (!titleFound) {
      if (node.type.name === "heading" && node.attrs.level === 1) {
        title = node.textContent.trim();
        titleFound = true;
      }
      return true;
    }
    if (!excerpt && node.type.name === "paragraph") {
      const t = node.textContent.trim();
      if (t) {
        excerpt = t.slice(0, 280);
        return false;
      }
    }
    return true;
  });
  return { title, excerpt };
}

function HelpArticleEditor({
  value,
  onChange,
  onMetaChange,
  placeholder,
  variant = "card",
}: HelpArticleEditorProps) {
  const [uploading, setUploading] = useState(false);
  const lastSyncedRef = useRef<string>(value);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingEditorRef = useRef<TiptapEditor | null>(null);
  const onMetaChangeRef = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;

  const openImagePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const extensions = useMemo(
    () =>
      buildExtensions({
        placeholder,
        openImagePicker,
      }),
    [placeholder, openImagePicker],
  );

  const editor = useEditor({
    extensions,
    content: value || "<h1></h1><p></p>",
    editorProps: {
      attributes: {
        class:
          variant === "page"
            ? "prose prose-lg max-w-none min-h-[60vh] focus:outline-none help-editor-surface help-editor-surface-page"
            : "prose prose-sm max-w-none min-h-[420px] px-5 py-6 focus:outline-none help-editor-surface",
      },
    },
    onUpdate: ({ editor }) => {
      const md = getMarkdown(editor);
      lastSyncedRef.current = md;
      onChange(md);
      onMetaChangeRef.current?.(deriveMeta(editor));
    },
    onCreate: ({ editor }) => {
      onMetaChangeRef.current?.(deriveMeta(editor));
    },
  });

  pendingEditorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    if (value === lastSyncedRef.current) return;
    lastSyncedRef.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
    onMetaChangeRef.current?.(deriveMeta(editor));
  }, [value, editor]);

  async function handleFile(file: File) {
    const editor = pendingEditorRef.current;
    if (!editor) return;

    // Insert a placeholder image at the current cursor with a blob URL so the
    // user sees instant feedback while we upload.
    const tempUrl = URL.createObjectURL(file);
    editor.chain().focus().setImage({ src: tempUrl, alt: "" }).run();

    function findImagePos(url: string): number | null {
      let pos: number | null = null;
      editor!.state.doc.descendants((node, nodePos) => {
        if (node.type.name === "image" && node.attrs.src === url) {
          pos = nodePos;
          return false;
        }
        return true;
      });
      return pos;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: "Upload failed" }));
        throw new Error(body.error ?? "Upload failed");
      }
      const body = (await res.json()) as { url: string };

      const pos = findImagePos(tempUrl);
      if (pos !== null) {
        editor.chain().setNodeSelection(pos).updateAttributes("image", { src: body.url }).run();
      } else {
        // User deleted the placeholder before upload finished — just drop it.
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
      const pos = findImagePos(tempUrl);
      if (pos !== null) {
        editor.chain().setNodeSelection(pos).deleteSelection().run();
      }
    } finally {
      URL.revokeObjectURL(tempUrl);
      setUploading(false);
    }
  }

  if (!editor) {
    return (
      <div
        className={
          variant === "page"
            ? "min-h-[60vh] flex items-center justify-center"
            : "rounded-xl bg-card border border-border min-h-[480px] flex items-center justify-center"
        }
      >
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (variant === "page") {
    return (
      <div className="help-editor-page">
        <EditorContent editor={editor} />
        <EditorBubbleMenu editor={editor} />
        <div className="help-editor-floating-tools" contentEditable={false}>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={openImagePicker}
            disabled={uploading}
            title="Insert image"
            aria-label="Insert image"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ImageIcon className="w-4 h-4" />
            )}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo"
            aria-label="Undo"
          >
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo"
            aria-label="Redo"
          >
            <Redo2 className="w-4 h-4" />
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/30 border-b border-border">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={openImagePicker}
          disabled={uploading}
          className="gap-1.5"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ImageIcon className="w-4 h-4" />
          )}
          Image
        </Button>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">
          Press <kbd className="px-1 py-0.5 rounded border border-border bg-background text-[10px]">/</kbd> to insert a block
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
          >
            Undo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
          >
            Redo
          </Button>
        </div>
      </div>
      <EditorContent editor={editor} />
      <EditorBubbleMenu editor={editor} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export default HelpArticleEditor;
