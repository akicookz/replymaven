import { useState } from "react";
import { cn } from "@/lib/utils";

// Site icon with a fallback chain: a direct image (`src`), or a `domain`
// whose favicon is tried on the host, then each parent domain
// (mcp.linear.app -> linear.app), then the first letter of `name`.
// Usage: <Favicon domain="mcp.linear.app" name="Linear" className="size-5" />

const FAVICON_SERVICE = "https://www.google.com/s2/favicons";
// The service answers a missing icon with a 16x16 globe, not an error.
const MISSING_ICON_SIZE = 16;

function candidateUrls(domain: string): string[] {
  const labels = domain.toLowerCase().split(".");
  const urls: string[] = [];
  for (let start = 0; labels.length - start >= 2; start += 1) {
    urls.push(`${FAVICON_SERVICE}?domain=${labels.slice(start).join(".")}&sz=64`);
  }
  return urls;
}

interface FaviconProps {
  name: string;
  src?: string | null;
  domain?: string | null;
  className?: string;
  imageClassName?: string;
  letterClassName?: string;
}

export function Favicon({
  name,
  src,
  domain,
  className,
  imageClassName,
  letterClassName,
}: FaviconProps) {
  const sources = src ? [src] : domain ? candidateUrls(domain) : [];
  const key = sources.join("|");
  const [state, setState] = useState({ key, index: 0 });
  const index = state.key === key ? state.index : 0;
  const current = sources[index];

  function next() {
    setState({ key, index: index + 1 });
  }

  return (
    <span className={cn("flex items-center justify-center overflow-hidden", className)}>
      {current ? (
        <img
          key={current}
          src={current}
          alt=""
          aria-hidden="true"
          className={cn("size-full object-contain", imageClassName)}
          onError={next}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (
              !src &&
              image.naturalWidth === MISSING_ICON_SIZE &&
              image.naturalHeight === MISSING_ICON_SIZE
            ) {
              next();
            }
          }}
        />
      ) : (
        <span aria-hidden="true" className={cn("font-semibold text-ink-4", letterClassName)}>
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
    </span>
  );
}
