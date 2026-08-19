const IMAGE_EXTENSIONS = new Set(["jpeg", "jpg", "png", "webp", "svg"]);

/**
 * A pasted blob of text that is only an http(s) image-file URL. Query strings
 * are kept. Anything else (markdown, sentences, extensionless CDN paths) is
 * left for the default paste so a later bookmark card can take those URLs.
 */
export function pastedImageUrl(text: string): string | null {
  const trimmed = unwrapOuter(text.trim());
  if (!trimmed || /[\s]/.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;

  const file = parsed.pathname.split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = file.slice(dot + 1).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return null;

  return parsed.href;
}

function unwrapOuter(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (
    (first === '"' && last === '"') ||
    (first === "'" && last === "'") ||
    (first === "<" && last === ">")
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}
