import { useRef, useState } from "react";
import { Move } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImagePositionerProps {
  src: string;
  alt?: string;
  /** Focal point as "X% Y%" (integers); null renders centered. */
  position: string | null;
  onChange: (position: string) => void;
  className?: string;
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function parsePosition(value: string | null): { x: number; y: number } {
  const match = /^(\d{1,3})% (\d{1,3})%$/.exec(value ?? "");
  if (!match) return { x: 50, y: 50 };
  return { x: clampPct(Number(match[1])), y: clampPct(Number(match[2])) };
}

/**
 * Cover-fit image preview that lets the user drag the image to choose its
 * focal point. Dragging maps 1:1 to the cropped-off overflow on each axis;
 * an axis with no overflow (image fully visible) can't move.
 */
export function ImagePositioner({
  src,
  alt = "",
  position,
  onChange,
  className,
}: ImagePositionerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const pos = parsePosition(position);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    containerRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: pos.x,
      startY: pos.y,
    };
    setDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const container = containerRef.current;
    const img = imgRef.current;
    if (
      !drag ||
      drag.pointerId !== e.pointerId ||
      !container ||
      !img?.naturalWidth ||
      !img.naturalHeight
    ) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const scale = Math.max(
      rect.width / img.naturalWidth,
      rect.height / img.naturalHeight,
    );
    const overflowX = img.naturalWidth * scale - rect.width;
    const overflowY = img.naturalHeight * scale - rect.height;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;

    // Dragging the image right reveals more of its left side = lower X%.
    const x =
      overflowX > 0.5 ? clampPct(drag.startX - (dx / overflowX) * 100) : pos.x;
    const y =
      overflowY > 0.5 ? clampPct(drag.startY - (dy / overflowY) * 100) : pos.y;
    if (x !== pos.x || y !== pos.y) {
      onChange(`${x}% ${y}%`);
    }
  }

  function handlePointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "group/positioner relative h-full w-full touch-none select-none overflow-hidden",
        dragging ? "cursor-grabbing" : "cursor-grab",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className="h-full w-full object-cover"
        style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
      />
      <div
        className={cn(
          "pointer-events-none absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white transition-opacity",
          dragging
            ? "opacity-0"
            : "opacity-0 group-hover/positioner:opacity-100",
        )}
      >
        <Move className="h-3 w-3" />
        Drag to reposition
      </div>
    </div>
  );
}
