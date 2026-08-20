const HELP_HOME_BACKGROUND_URL_MAX = 500;
const HELP_HOME_BACKGROUND_URL_RE = /^\/api\/uploads\/[A-Za-z0-9._/-]+$/;
const HELP_HOME_BACKGROUND_POSITION_RE =
  /^(?:100|\d{1,2})% (?:100|\d{1,2})%$/;

export const HELP_HOME_BACKGROUND_FITS = ["cover", "contain", "repeat"] as const;
export type HelpHomeBackgroundFit = (typeof HELP_HOME_BACKGROUND_FITS)[number];

export function sanitizeHelpHomeBackgroundUrl(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length > HELP_HOME_BACKGROUND_URL_MAX) return null;
  if (trimmed.includes("..") || trimmed.includes("//")) return null;
  if (!HELP_HOME_BACKGROUND_URL_RE.test(trimmed)) return null;
  return trimmed;
}

export function sanitizeHelpHomeBackgroundPosition(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  return HELP_HOME_BACKGROUND_POSITION_RE.test(trimmed) ? trimmed : null;
}

export function sanitizeHelpHomeBackgroundFit(
  input: string | null | undefined,
): HelpHomeBackgroundFit {
  if (input === "contain" || input === "repeat") return input;
  return "cover";
}

export function helpHomeBackgroundImageCss(input: {
  url: string;
  position?: string | null;
  fit?: string | null;
}): string {
  const position =
    sanitizeHelpHomeBackgroundPosition(input.position) ?? "50% 50%";
  const fit = sanitizeHelpHomeBackgroundFit(input.fit);
  const size = fit === "repeat" ? "auto" : fit;
  const repeat = fit === "repeat" ? "repeat" : "no-repeat";
  return (
    `.help-home-bg{` +
    `--help-home-bg-image:url(${JSON.stringify(input.url)});` +
    `--help-home-bg-position:${position};` +
    `--help-home-bg-size:${size};` +
    `--help-home-bg-repeat:${repeat}` +
    `}`
  );
}
