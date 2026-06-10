import { useEffect, useRef, useState } from "react";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Loader2 } from "lucide-react";

const MIN_WIDTH = 80;

function ImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const src = (node.attrs.src as string | undefined) ?? "";
  const alt = (node.attrs.alt as string | null | undefined) ?? "";
  const title = (node.attrs.title as string | null | undefined) ?? "";
  const width = node.attrs.width as number | null | undefined;
  const uploading = src.startsWith("blob:");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [draftWidth, setDraftWidth] = useState<number | null>(width ?? null);

  // Keep local draft synced when other edits change the attr.
  useEffect(() => {
    setDraftWidth(width ?? null);
  }, [width]);

  function startResize(startX: number) {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return;
    const maxWidth = container.getBoundingClientRect().width;
    const startWidth = img.getBoundingClientRect().width;

    function onMove(ev: PointerEvent) {
      const next = Math.max(
        MIN_WIDTH,
        Math.min(maxWidth, Math.round(startWidth + (ev.clientX - startX))),
      );
      setDraftWidth(next);
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const next = Math.max(
        MIN_WIDTH,
        Math.min(maxWidth, Math.round(startWidth + (ev.clientX - startX))),
      );
      // If the image is full-container wide, drop the explicit width.
      const final = next >= maxWidth - 1 ? null : next;
      updateAttributes({ width: final });
      setDraftWidth(final);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const editable = editor.isEditable;
  const renderedWidth = draftWidth ?? undefined;

  return (
    <NodeViewWrapper
      className={`help-editor-image ${selected ? "is-selected" : ""}${
        uploading ? " is-uploading" : ""
      }`.trim()}
    >
      <div
        ref={containerRef}
        className="help-editor-image-frame"
        style={{ width: renderedWidth ? `${renderedWidth}px` : undefined }}
      >
        {src ? (
          <img ref={imgRef} src={src} alt={alt} title={title || undefined} />
        ) : (
          <div className="help-editor-image-empty">No image</div>
        )}
        {uploading && (
          <span className="help-editor-image-uploading-badge" contentEditable={false}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Uploading…
          </span>
        )}
        {editable && src && !uploading && (
          <span
            className="help-editor-image-resize"
            role="slider"
            aria-label="Resize image"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startResize(e.clientX);
            }}
          />
        )}
      </div>
      {!uploading && (
        <input
          type="text"
          value={alt}
          onChange={(e) => updateAttributes({ alt: e.target.value })}
          placeholder="Add alt text (describe the image for screen readers and AI)"
          className="help-editor-image-alt"
          aria-label="Image alt text"
          contentEditable={false}
        />
      )}
    </NodeViewWrapper>
  );
}

export const ImageWithAlt = Image.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      width: {
        default: null,
        parseHTML: (element) => {
          const w = element.getAttribute("width");
          if (!w) return null;
          const n = parseInt(w, 10);
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attrs) => {
          if (!attrs.width) return {};
          return { width: String(attrs.width) };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const src = (node.attrs.src as string | undefined) ?? "";
          const alt = (node.attrs.alt as string | null | undefined) ?? "";
          const title = (node.attrs.title as string | null | undefined) ?? "";
          const width = node.attrs.width as number | null | undefined;

          if (width) {
            // HTML form preserves width across roundtrips.
            const attrs = [
              `src="${escapeAttr(src)}"`,
              `alt="${escapeAttr(alt)}"`,
              `width="${width}"`,
            ];
            if (title) attrs.push(`title="${escapeAttr(title)}"`);
            state.write(`<img ${attrs.join(" ")} />`);
            state.closeBlock(node);
            return;
          }
          // Default markdown form.
          const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
          state.write(`![${alt.replace(/[[\]]/g, "")}](${src}${titlePart})`);
          // The image is a block node — without closeBlock the following
          // block gets glued onto this line (`![](url)## Heading`).
          state.closeBlock(node);
        },
        parse: {
          // Inline <img> tags handled by markdown-it when html: true.
        },
      },
    };
  },
});

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export default ImageWithAlt;
