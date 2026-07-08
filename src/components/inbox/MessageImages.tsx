import { useState } from "react";
import { parseMessageImageUrls } from "../../../shared/message-images";
import ImageLightbox from "./ImageLightbox";

/** Renders a message's attached images inside its bubble: one image at its
 *  natural size, several as a uniform 2-up grid. Clicking opens the lightbox
 *  at that image. */
export default function MessageImages({
  imageUrl,
}: {
  imageUrl: string | null | undefined;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const images = parseMessageImageUrls(imageUrl);
  if (images.length === 0) return null;

  return (
    <>
      {images.length === 1 ? (
        <img
          src={images[0]}
          alt="attachment"
          className="block max-w-full max-h-70 rounded-lg object-contain cursor-zoom-in"
          onClick={() => setLightboxIndex(0)}
        />
      ) : (
        <div className="grid grid-cols-2 gap-1 w-[360px] max-w-full">
          {images.map((url, i) => (
            <img
              key={`${url}-${i}`}
              src={url}
              alt={`attachment ${i + 1}`}
              className="w-full aspect-[4/3] rounded-lg object-cover cursor-zoom-in"
              onClick={() => setLightboxIndex(i)}
            />
          ))}
        </div>
      )}
      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}
