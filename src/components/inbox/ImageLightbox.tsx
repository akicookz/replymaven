import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface ImageLightboxProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

/** Full-screen image viewer: backdrop/image click or Esc closes, ←/→ and
 *  arrow buttons navigate when the message has multiple images. */
export default function ImageLightbox({
  images,
  initialIndex,
  onClose,
}: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const many = images.length > 1;

  // Read onClose through a ref so a parent re-render (inline callback prop)
  // doesn't tear down/re-add the listener and scroll lock every commit.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "ArrowLeft" && many) {
        setIndex((i) => (i - 1 + images.length) % images.length);
      }
      if (e.key === "ArrowRight" && many) {
        setIndex((i) => (i + 1) % images.length);
      }
    }
    window.addEventListener("keydown", handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [images.length, many]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm cursor-zoom-out animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
    >
      <img
        src={images[index]}
        alt={`Attachment ${index + 1} of ${images.length}`}
        className="max-w-[92vw] max-h-[88vh] object-contain rounded-lg shadow-2xl"
      />

      <button
        type="button"
        className="absolute top-4 right-4 flex items-center justify-center w-9 h-9 rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors cursor-pointer"
        onClick={onClose}
        aria-label="Close"
      >
        <X size={17} />
      </button>

      {many && (
        <>
          <button
            type="button"
            className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => (i - 1 + images.length) % images.length);
            }}
            aria-label="Previous image"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => (i + 1) % images.length);
            }}
            aria-label="Next image"
          >
            <ChevronRight size={20} />
          </button>
          <span className="absolute bottom-5 left-1/2 -translate-x-1/2 text-[12.5px] font-medium text-white/85">
            {index + 1} / {images.length}
          </span>
        </>
      )}
    </div>,
    document.body,
  );
}
