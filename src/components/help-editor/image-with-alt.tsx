import { useEffect, useRef, useState } from "react";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Loader2, Move } from "lucide-react";

const MIN_WIDTH_PCT = 20;
const MIN_HEIGHT_PCT = 15;

function ImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const src = (node.attrs.src as string | undefined) ?? "";
  const alt = (node.attrs.alt as string | null | undefined) ?? "";
  const title = (node.attrs.title as string | null | undefined) ?? "";
  const widthPct = parseWidthPct(node.attrs.width);
  const heightPct = parseHeightPct(node.attrs.height, node.attrs.width);
  const objectPosition =
    parseObjectPosition(node.attrs.objectPosition) ?? "50% 50%";
  const uploading = src.startsWith("blob:");

  const shellRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [draftWidthPct, setDraftWidthPct] = useState<number | null>(widthPct);
  const [draftHeightPct, setDraftHeightPct] = useState<number | null>(heightPct);
  const [draftPosition, setDraftPosition] = useState(objectPosition);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    setDraftWidthPct(widthPct);
  }, [widthPct]);
  useEffect(() => {
    setDraftHeightPct(heightPct);
  }, [heightPct]);
  useEffect(() => {
    setDraftPosition(objectPosition);
  }, [objectPosition]);

  const cropped = draftHeightPct != null;
  const editable = editor.isEditable;

  function shellWidth(): number {
    return shellRef.current?.getBoundingClientRect().width ?? 1;
  }

  function naturalHeightPct(): number | null {
    const img = imgRef.current;
    if (!img?.naturalWidth || !img.naturalHeight) return null;
    return (img.naturalHeight / img.naturalWidth) * 100;
  }

  function startResizeWidth(startX: number) {
    const maxWidth = shellWidth();
    const startWidth = frameRef.current?.getBoundingClientRect().width ?? maxWidth;
    const aspect = draftHeightPct;

    function onMove(ev: PointerEvent) {
      const next = clampWidthPct(
        Math.round(((startWidth + (ev.clientX - startX)) / maxWidth) * 100),
      );
      setDraftWidthPct(next >= 100 ? null : next);
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const next = clampWidthPct(
        Math.round(((startWidth + (ev.clientX - startX)) / maxWidth) * 100),
      );
      const finalWidth = next >= 100 ? null : next;
      updateAttributes({
        width: finalWidth,
        ...(aspect != null ? { height: aspect } : {}),
      });
      setDraftWidthPct(finalWidth);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startResizeHeight(startY: number) {
    const frame = frameRef.current;
    if (!frame) return;
    const frameW = frame.getBoundingClientRect().width;
    const startH = frame.getBoundingClientRect().height;
    const naturalPct = naturalHeightPct() ?? (startH / frameW) * 100;
    const enteringCrop = !cropped;
    const pinnedPos = enteringCrop
      ? pinTop(draftPosition)
      : (parseObjectPosition(draftPosition) ?? pinTop(draftPosition));
    if (enteringCrop) setDraftPosition(pinnedPos);

    function onMove(ev: PointerEvent) {
      const nextPct =
        ((startH + (ev.clientY - startY)) / frameW) * 100;
      if (nextPct >= naturalPct - 1) {
        setDraftHeightPct(null);
        return;
      }
      setDraftHeightPct(
        clampHeightPct(nextPct, MIN_HEIGHT_PCT, naturalPct),
      );
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const nextPct =
        ((startH + (ev.clientY - startY)) / frameW) * 100;
      if (nextPct >= naturalPct - 1) {
        updateAttributes({ height: null, objectPosition: null });
        setDraftHeightPct(null);
        setDraftPosition("50% 50%");
        return;
      }
      const committed = clampHeightPct(nextPct, MIN_HEIGHT_PCT, naturalPct);
      const width = draftWidthPct;
      updateAttributes({
        width,
        height: committed,
        objectPosition: pinnedPos,
      });
      setDraftHeightPct(committed);
      setDraftPosition(pinnedPos);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startPan(startClientX: number, startClientY: number) {
    const frame = frameRef.current;
    const img = imgRef.current;
    if (!frame || !img || !img.naturalWidth || !img.naturalHeight) return;
    const frameEl: HTMLDivElement = frame;
    const imgEl: HTMLImageElement = img;
    const start = parsePosition(draftPosition);
    let nextPos = draftPosition;
    setPanning(true);

    function onMove(ev: PointerEvent) {
      const rect = frameEl.getBoundingClientRect();
      const scale = Math.max(
        rect.width / imgEl.naturalWidth,
        rect.height / imgEl.naturalHeight,
      );
      const overflowX = imgEl.naturalWidth * scale - rect.width;
      const overflowY = imgEl.naturalHeight * scale - rect.height;
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      const x =
        overflowX > 0.5
          ? clampPct(start.x - (dx / overflowX) * 100)
          : start.x;
      const y =
        overflowY > 0.5
          ? clampPct(start.y - (dy / overflowY) * 100)
          : start.y;
      nextPos = `${x}% ${y}%`;
      setDraftPosition(nextPos);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPanning(false);
      updateAttributes({ objectPosition: nextPos });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function resetCrop() {
    updateAttributes({ height: null, objectPosition: null });
    setDraftHeightPct(null);
    setDraftPosition("50% 50%");
  }

  return (
    <NodeViewWrapper
      className={`help-editor-image ${selected ? "is-selected" : ""}${
        uploading ? " is-uploading" : ""
      }${cropped ? " is-cropped" : ""}`.trim()}
    >
      <div ref={shellRef} className="help-editor-image-shell">
        <div
          ref={frameRef}
          className={
            cropped
              ? "help-editor-image-frame is-cropped"
              : "help-editor-image-frame"
          }
          style={{
            width: draftWidthPct != null ? `${draftWidthPct}%` : undefined,
            aspectRatio:
              cropped && draftHeightPct != null
                ? `100 / ${draftHeightPct}`
                : undefined,
          }}
        >
          <div
            className={
              cropped
                ? "help-editor-image-clip is-cropped"
                : "help-editor-image-clip"
            }
            onPointerDown={
              editable && src && !uploading && cropped
                ? (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    startPan(e.clientX, e.clientY);
                  }
                : undefined
            }
            onDoubleClick={
              editable && cropped
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    resetCrop();
                  }
                : undefined
            }
          >
            {src ? (
              <img
                ref={imgRef}
                src={src}
                alt={alt}
                title={title || undefined}
                draggable={false}
                style={
                  cropped ? { objectPosition: draftPosition } : undefined
                }
              />
            ) : (
              <div className="help-editor-image-empty">No image</div>
            )}
            {uploading && (
              <span
                className="help-editor-image-uploading-badge"
                contentEditable={false}
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Uploading…
              </span>
            )}
            {editable && src && !uploading && cropped && (
              <span
                className={`help-editor-image-pan-hint${panning ? " is-panning" : ""}`}
                contentEditable={false}
              >
                <Move className="h-3 w-3" />
                Drag to reposition
              </span>
            )}
          </div>
          {editable && src && !uploading && (
            <>
              <span
                className="help-editor-image-resize help-editor-image-resize-x"
                role="slider"
                aria-label="Resize image"
                contentEditable={false}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startResizeWidth(e.clientX);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              />
              <span
                className="help-editor-image-resize help-editor-image-resize-y"
                role="slider"
                aria-label="Crop image"
                contentEditable={false}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startResizeHeight(e.clientY);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            </>
          )}
        </div>
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
        parseHTML: (element) => parseWidthPct(element.getAttribute("width")),
        renderHTML: (attrs) => {
          const pct = parseWidthPct(attrs.width);
          if (pct == null && !attrs.height) return {};
          return { width: `${pct ?? 100}%` };
        },
      },
      height: {
        default: null,
        parseHTML: (element) =>
          parseHeightPct(
            element.getAttribute("data-aspect") ??
              element.getAttribute("height"),
            element.getAttribute("width"),
          ),
        renderHTML: (attrs) => {
          const heightPct = parseHeightPct(attrs.height, attrs.width);
          if (heightPct == null) return {};
          return { "data-aspect": `100 / ${heightPct}` };
        },
      },
      objectPosition: {
        default: null,
        parseHTML: (element) =>
          parseObjectPosition(
            element.getAttribute("data-object-position") ||
              element.style.objectPosition,
          ),
        renderHTML: (attrs) => {
          if (!attrs.height) return {};
          const pos =
            parseObjectPosition(attrs.objectPosition) ?? "50% 0%";
          return { "data-object-position": pos };
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
          const widthPct = parseWidthPct(node.attrs.width);
          const heightPct = parseHeightPct(node.attrs.height, node.attrs.width);
          const objectPosition = parseObjectPosition(node.attrs.objectPosition);

          if (widthPct != null || heightPct != null) {
            const attrs = [
              `src="${escapeAttr(src)}"`,
              `alt="${escapeAttr(alt)}"`,
            ];
            if (widthPct != null) attrs.push(`width="${widthPct}%"`);
            else if (heightPct != null) attrs.push(`width="100%"`);
            if (heightPct != null) {
              attrs.push(`data-aspect="100 / ${heightPct}"`);
              attrs.push(
                `data-object-position="${objectPosition ?? "50% 0%"}"`,
              );
            }
            if (title) attrs.push(`title="${escapeAttr(title)}"`);
            state.write(`<img ${attrs.join(" ")} />`);
            state.closeBlock(node);
            return;
          }
          const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
          state.write(`![${alt.replace(/[[\]]/g, "")}](${src}${titlePart})`);
          state.closeBlock(node);
        },
        parse: {
          // Inline <img> tags handled by markdown-it when html: true.
        },
      },
    };
  },
});

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampWidthPct(value: number): number {
  return Math.min(100, Math.max(MIN_WIDTH_PCT, Math.round(value)));
}

function clampHeightPct(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function parseWidthPct(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    if (value > 100) return 100;
    return Math.round(value);
  }
  if (typeof value !== "string" || !value) return null;
  const trimmed = value.trim();
  const pct = /^(\d{1,3})%$/.exec(trimmed);
  if (pct) {
    const n = Number(pct[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(100, Math.round(n));
  }
  const px = parseInt(trimmed, 10);
  if (!Number.isFinite(px) || px <= 0) return null;
  // Legacy pixel width. Full-bleed instead of freezing editor pixels.
  return px > 100 ? 100 : Math.max(MIN_WIDTH_PCT, px);
}

function parseHeightPct(height: unknown, width: unknown): number | null {
  if (typeof height === "number" && Number.isFinite(height) && height > 0) {
    if (height <= 500) return Math.round(height);
    return null;
  }
  if (typeof height !== "string" || !height) return null;
  const trimmed = height.trim();
  const aspect = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (aspect) {
    const w = Number(aspect[1]);
    const h = Number(aspect[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return null;
    }
    return Math.max(1, Math.round((h / w) * 100));
  }
  const heightPct = /^(\d{1,3})%$/.exec(trimmed);
  if (heightPct) {
    const n = Number(heightPct[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n);
  }
  const heightPx = parseInt(trimmed, 10);
  const widthPx =
    typeof width === "number"
      ? width
      : typeof width === "string" && !width.includes("%")
        ? parseInt(width, 10)
        : null;
  if (
    Number.isFinite(heightPx) &&
    heightPx > 0 &&
    widthPx != null &&
    Number.isFinite(widthPx) &&
    widthPx > 0 &&
    widthPx > 100
  ) {
    return Math.max(1, Math.round((heightPx / widthPx) * 100));
  }
  return null;
}

function parseObjectPosition(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,3})%\s+(\d{1,3})%$/.exec(value.trim());
  if (!match) return null;
  const x = clampPct(Number(match[1]));
  const y = clampPct(Number(match[2]));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return `${x}% ${y}%`;
}

function parsePosition(value: string): { x: number; y: number } {
  const parsed = parseObjectPosition(value);
  if (!parsed) return { x: 50, y: 50 };
  const parts = parsed.split(" ");
  return { x: parseInt(parts[0] ?? "50", 10), y: parseInt(parts[1] ?? "50", 10) };
}

function pinTop(position: string): string {
  return `${parsePosition(position).x}% 0%`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export default ImageWithAlt;
