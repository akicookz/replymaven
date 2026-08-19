import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import type { MarkdownStorage } from "tiptap-markdown";
import { ImageIcon, Loader2, Undo2, Redo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildExtensions } from "@/components/help-editor/extensions";
import { EditorBubbleMenu } from "@/components/help-editor/bubble-menu";
import { splitGluedImageBlocks } from "../../shared/markdown-repair";

export interface DerivedMeta {
  title: string;
  excerpt: string;
}

// Mirrors /api/upload's image allowlist and its 10MB cap, so a file that would
// be rejected server-side never leaves the browser.
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface HelpArticleEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onMetaChange?: (meta: DerivedMeta) => void;
  /** Fires while image uploads are in flight. The body holds `blob:` URLs
   *  until each upload lands, so saving during that window persists dead
   *  links — the page uses this to hold the Save button. */
  onUploadingChange?: (uploading: boolean) => void;
  placeholder?: string;
  variant?: "card" | "page";
  /** Slash items for the help-center home page (search, categories, popular). */
  includeHomeBlocks?: boolean;
  /** Project's published accent (widget primaryColor) so links/badges in the
   *  editor match the live help center. Defaults to the published default. */
  accentColor?: string | null;
}

/**
 * Image files carried by a paste or drop. Matches on the broad `image/` prefix
 * rather than the allowlist so an unsupported image is intercepted and
 * explained, instead of falling through to the browser opening the file.
 */
function imageFilesFrom(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
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
  onUploadingChange,
  placeholder,
  variant = "card",
  includeHomeBlocks = false,
  accentColor,
}: HelpArticleEditorProps) {
  const accentStyle = accentColor
    ? ({ "--help-accent": accentColor } as React.CSSProperties)
    : undefined;
  const [uploadingCount, setUploadingCount] = useState(0);
  const uploading = uploadingCount > 0;
  const lastSyncedRef = useRef<string>(value);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingEditorRef = useRef<TiptapEditor | null>(null);
  const onMetaChangeRef = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;
  const onUploadingChangeRef = useRef(onUploadingChange);
  onUploadingChangeRef.current = onUploadingChange;
  // editorProps are captured when the editor is created, so paste/drop reach
  // the upload routine through a ref rather than a stale closure.
  const uploadFilesRef = useRef<
    ((files: File[], insertPos?: number) => void) | null
  >(null);

  const openImagePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const extensions = useMemo(
    () =>
      buildExtensions({
        placeholder,
        openImagePicker,
        includeHomeBlocks,
      }),
    [placeholder, openImagePicker, includeHomeBlocks],
  );

  const editor = useEditor({
    extensions,
    // Repair legacy image-glued markdown on the way in so corrupted articles
    // parse correctly — they heal permanently on the next save.
    content: value ? splitGluedImageBlocks(value) : "<h1></h1><p></p>",
    editorProps: {
      attributes: {
        class:
          variant === "page"
            ? "prose prose-lg max-w-none min-h-[60vh] focus:outline-none help-editor-surface help-editor-surface-page"
            : "prose prose-sm max-w-none min-h-[420px] pl-10 pr-5 py-6 focus:outline-none help-editor-surface",
      },
      handlePaste: (_view, event) => {
        const images = imageFilesFrom(event.clipboardData?.files);
        if (images.length === 0) return false;
        event.preventDefault();
        uploadFilesRef.current?.(images);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        // `moved` is a node being dragged within the document, not a new file.
        if (moved) return false;
        const images = imageFilesFrom(event.dataTransfer?.files);
        if (images.length === 0) return false;
        event.preventDefault();
        // Drop coordinates, so the image lands where it was released rather
        // than wherever the cursor happened to be.
        const coords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        uploadFilesRef.current?.(images, coords?.pos);
        return true;
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
    onUploadingChangeRef.current?.(uploading);
  }, [uploading]);

  useEffect(() => {
    if (!editor) return;
    if (value === lastSyncedRef.current) return;
    lastSyncedRef.current = value;
    editor.commands.setContent(splitGluedImageBlocks(value), {
      emitUpdate: false,
    });
    onMetaChangeRef.current?.(deriveMeta(editor));
  }, [value, editor]);

  // POST to /api/upload with one automatic retry — dev's remote R2 binding and
  // real networks hiccup transiently, and a retry costs less than losing the
  // placeholder the user is watching.
  async function uploadOnce(file: File): Promise<string> {
    const attempt = async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Upload failed");
      }
      const body = (await res.json()) as { url: string };
      return body.url;
    };
    try {
      return await attempt();
    } catch {
      await new Promise((r) => setTimeout(r, 600));
      return attempt();
    }
  }

  function findImagePos(editor: TiptapEditor, url: string): number | null {
    let pos: number | null = null;
    editor.state.doc.descendants((node, nodePos) => {
      if (node.type.name === "image" && node.attrs.src === url) {
        pos = nodePos;
        return false;
      }
      return true;
    });
    return pos;
  }

  async function uploadFiles(files: File[], insertPos?: number) {
    const editor = pendingEditorRef.current;
    if (!editor) return;

    const accepted = files.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    if (accepted.length < files.length) {
      toast.error("Only JPEG, PNG, WebP, or SVG images can be inserted");
    }
    const sized = accepted.filter((f) => f.size <= MAX_IMAGE_BYTES);
    if (sized.length < accepted.length) {
      toast.error("Images must be 10MB or smaller");
    }
    if (sized.length === 0) return;

    // Insert every placeholder up front so multiple files keep the order they
    // were dropped regardless of which upload finishes first.
    //
    // One insertContent with all the nodes, not a setImage per file: setImage
    // leaves the selection *on* the image it just inserted, so a second call
    // replaces the first instead of following it, and chaining them aborts the
    // whole chain. Inserting them as one fragment sidesteps both.
    const pending = sized.map((file) => ({
      file,
      tempUrl: URL.createObjectURL(file),
    }));
    const chain = editor.chain().focus();
    if (insertPos !== undefined) chain.setTextSelection(insertPos);
    chain
      .insertContent(
        pending.map(({ tempUrl }) => ({
          type: "image",
          attrs: { src: tempUrl, alt: "" },
        })),
      )
      .run();

    setUploadingCount((n) => n + pending.length);
    await Promise.allSettled(
      pending.map(async ({ file, tempUrl }) => {
        try {
          const url = await uploadOnce(file);
          const pos = findImagePos(editor, tempUrl);
          // A null pos means the user deleted the placeholder mid-upload.
          if (pos !== null) {
            editor
              .chain()
              .setNodeSelection(pos)
              .updateAttributes("image", { src: url })
              .run();
          }
        } catch (err) {
          toast.error(
            `${file.name}: ${err instanceof Error ? err.message : "Upload failed"}`,
          );
          const pos = findImagePos(editor, tempUrl);
          if (pos !== null) {
            editor.chain().setNodeSelection(pos).deleteSelection().run();
          }
        } finally {
          URL.revokeObjectURL(tempUrl);
        }
      }),
    );
    setUploadingCount((n) => n - pending.length);
  }

  uploadFilesRef.current = (files, insertPos) => {
    void uploadFiles(files, insertPos);
  };

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
      <div className="help-editor-page" style={accentStyle}>
        <EditorContent editor={editor} className="help-editor-canvas help-editor-canvas-page" />
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
          multiple
          className="hidden"
          onChange={(e) => {
            void uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="rounded-xl bg-card border border-border overflow-hidden"
      style={accentStyle}
    >
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
      <EditorContent editor={editor} className="help-editor-canvas" />
      <EditorBubbleMenu editor={editor} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        multiple
        className="hidden"
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}

export default HelpArticleEditor;
