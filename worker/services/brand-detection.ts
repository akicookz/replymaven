import { WIDGET_FONTS } from "../../shared/widget-fonts";
import { widgetRadiusStoredPx } from "../../shared/widget-radius";
import { type AiService } from "./ai-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetectedBrand {
  primaryColor: string;
  textColor: string;
  backgroundColor: string;
  borderRadius: number;
  fontFamily: string;
  /** Absolute URL of the best icon found, or null. */
  iconUrl: string | null;
  /** Brand name in the site's own casing, e.g. "LinkyCal". */
  name: string | null;
}

export interface DocsSuggestion {
  url: string;
  label: string;
}

const USER_AGENT = "ReplyMaven Bot/1.0 (https://replymaven.com)";
const FETCH_TIMEOUT_MS = 4_000;
const MAX_STYLESHEETS = 24;
const MAX_CSS_BYTES = 400_000;

// ─── Fetch Helpers ────────────────────────────────────────────────────────────

/** Reads at most `maxBytes` of a body, then stops the download. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const room = merged.byteLength - offset;
    if (room <= 0) break;
    merged.set(chunk.subarray(0, room), offset);
    offset += Math.min(chunk.byteLength, room);
  }
  return new TextDecoder().decode(merged);
}

async function fetchText(url: string, accept: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return await readCapped(res, MAX_CSS_BYTES);
  } catch {
    return null;
  }
}

/** True when the URL serves an image over https (used before saving an avatar). */
async function isHttpsImage(url: string): Promise<boolean> {
  if (!url.startsWith("https://")) return false;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    await res.body?.cancel();
    const type = res.headers.get("content-type") ?? "";
    return res.ok && (type.startsWith("image/") || type.includes("icon"));
  } catch {
    return false;
  }
}

async function isReachableHtml(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.ok && (res.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  }
}

function absolute(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!match) return null;
  return (match[2] ?? match[3] ?? match[4] ?? "").trim();
}

function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
}

// ─── Colors ───────────────────────────────────────────────────────────────────

function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{8}$/.test(v)) return v.slice(0, 7);
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(v);
  if (rgb) {
    const parts = rgb.slice(1, 4).map((n) => Math.min(255, Number(n)));
    return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

function rgbOf(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Near-gray colors (low saturation) are rarely a brand accent. */
function isColorful(hex: string): boolean {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return false;
  const saturation = (max - min) / max;
  const lum = luminance(hex);
  return saturation > 0.28 && lum > 0.03 && lum < 0.85;
}

function readableTextOn(hex: string): string {
  return luminance(hex) > 0.45 ? "#111111" : "#ffffff";
}

// ─── CSS Signals ──────────────────────────────────────────────────────────────

interface CssSignals {
  brandVarColors: string[];
  /** Every colorful custom property, e.g. ["--color-indigo", "#5e6ad2"]. */
  colorVars: Array<[string, string]>;
  backgroundVarColors: string[];
  /** Raw value of every custom property, for resolving var() references. */
  rawVars: Map<string, string>;
  fontVars: string[];
  buttonColors: string[];
  buttonRadii: number[];
  /** "selector { border-radius: … }" snippets from button rules, for the model. */
  buttonRadiusRules: string[];
  fontFaceFamilies: string[];
  bodyFonts: string[];
  bodyBackgrounds: string[];
}

function toPx(value: string): number | null {
  const match = /^([\d.]+)(px|rem|em)?$/.exec(value.trim().split(/\s+/)[0] ?? "");
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  return match[2] === "rem" || match[2] === "em" ? n * 16 : n;
}

function collectCssSignals(css: string): CssSignals {
  const signals: CssSignals = {
    brandVarColors: [],
    colorVars: [],
    backgroundVarColors: [],
    rawVars: new Map(),
    fontVars: [],
    buttonColors: [],
    buttonRadii: [],
    buttonRadiusRules: [],
    fontFaceFamilies: [],
    bodyFonts: [],
    bodyBackgrounds: [],
  };

  for (const match of css.matchAll(/--([\w-]+)\s*:\s*([^;}]+)/g)) {
    const name = match[1] ?? "";
    if (!signals.rawVars.has(name)) signals.rawVars.set(name, (match[2] ?? "").trim());
    if (/font/i.test(name) && /sans|inter|serif|,/i.test(match[2] ?? "")) signals.fontVars.push(match[2] ?? "");
    const hex = normalizeHex(match[2] ?? "");
    if (!hex) continue;
    if (/(^|-)(bg|background)(-|$)/i.test(name) && /primary|base|default|page|app|body/i.test(name)) {
      signals.backgroundVarColors.push(hex);
    }
    if (!isColorful(hex)) continue;
    signals.colorVars.push([name, hex]);
    const brandNamed = /brand/i.test(name) && !/text|foreground|border/i.test(name);
    const accentNamed = /primary|accent/i.test(name) && !/foreground|text|contrast|light|dark|muted|hover|border|bg|background|link/i.test(name);
    if (brandNamed || accentNamed) {
      signals.brandVarColors.push(hex);
    }
  }

  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? "").toLowerCase();
    const body = rule[2] ?? "";
    if (/(^|[\s,.#])(button|btn|cta)([\s,.:#[_-]|$)/.test(selector)) {
      const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(body);
      const hex = bg ? normalizeHex(bg[1] ?? "") : null;
      if (hex) signals.buttonColors.push(hex);
      const radius = /border-radius\s*:\s*([^;]+)/i.exec(body);
      const px = radius ? toPx(radius[1] ?? "") : null;
      if (px !== null) signals.buttonRadii.push(px);
      if (radius) signals.buttonRadiusRules.push(`${selector.trim().slice(0, 80)} { border-radius: ${(radius[1] ?? "").trim().slice(0, 60)} }`);
    }
    if (selector.trim() === "@font-face") {
      const family = /font-family\s*:\s*([^;]+)/i.exec(body);
      if (family) signals.fontFaceFamilies.push((family[1] ?? "").trim().replace(/^["']|["']$/g, ""));
    }
    if (/(^|,)\s*(html|body|:root)\s*(,|$)/.test(selector)) {
      const font = /font-family\s*:\s*([^;]+)/i.exec(body);
      if (font) signals.bodyFonts.push(font[1] ?? "");
      const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(body);
      const hex = bg ? normalizeHex(bg[1] ?? "") : null;
      if (hex) signals.bodyBackgrounds.push(hex);
    }
  }
  return signals;
}

function mostCommon<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, count] of counts) {
    if (count > bestCount) {
      best = v;
      bestCount = count;
    }
  }
  return best;
}

function resolveVars(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 4) return value;
  return value.replace(/var\(\s*--([\w-]+)\s*(?:,([^)]*))?\)/g, (_, name: string, fallback?: string) =>
    resolveVars(vars.get(name) ?? fallback ?? "", vars, depth + 1),
  );
}

function matchWidgetFont(families: string[]): string {
  for (const raw of families) {
    for (const name of raw.split(",")) {
      const clean = name.trim().replace(/^["']|["']$/g, "").toLowerCase();
      // "Inter Variable" or "Inter Display" should still map to Inter.
      const font = WIDGET_FONTS.find((f) => f.value !== "system-ui" && (clean === f.value.toLowerCase() || clean.startsWith(`${f.value.toLowerCase()} `)));
      if (font) return font.value;
    }
  }
  return "system-ui";
}

function radiusPreset(px: number | null): number {
  if (px === null) return widgetRadiusStoredPx("rounded");
  if (px <= 2) return widgetRadiusStoredPx("sharp");
  if (px >= 20) return widgetRadiusStoredPx("pill");
  return widgetRadiusStoredPx("rounded");
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function iconCandidates(html: string, baseUrl: string): string[] {
  const found: Array<{ url: string; score: number }> = [];
  for (const tag of tags(html, "link")) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href || !rel.includes("icon")) continue;
    const url = absolute(href, baseUrl);
    if (!url) continue;
    const size = Number((attr(tag, "sizes") ?? "").split("x")[0]) || 0;
    const score = (rel.includes("apple-touch") ? 1000 : 0) + (url.endsWith(".svg") ? 500 : 0) + size;
    found.push({ url: url.replace(/^http:\/\//, "https://"), score });
  }
  const ranked = found.sort((a, b) => b.score - a.score).map((f) => f.url);
  const fallback = absolute("/favicon.ico", baseUrl);
  if (fallback) ranked.push(fallback.replace(/^http:\/\//, "https://"));
  return [...new Set(ranked)].slice(0, 4);
}

async function pickIcon(html: string, baseUrl: string): Promise<string | null> {
  for (const url of iconCandidates(html, baseUrl)) {
    if (await isHttpsImage(url)) return url;
  }
  return null;
}

// ─── Brand ────────────────────────────────────────────────────────────────────

async function pickBrandColorWithModel(
  ai: AiService,
  pageUrl: string,
  signals: CssSignals,
): Promise<string | null> {
  const seen = new Set<string>();
  const vars = signals.colorVars.filter(([name]) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  }).slice(0, 40);
  const buttons = [...new Set(signals.buttonColors.filter(isColorful))].slice(0, 10);
  if (vars.length === 0 && buttons.length === 0) return null;
  const json = await ai.generateJsonObject({
    prompt: `Pick the primary brand color of ${pageUrl} for a chat widget's buttons and header.

CSS color variables:
${vars.map(([name, hex]) => `--${name}: ${hex}`).join("\n") || "(none)"}

Button background colors:
${buttons.join(", ") || "(none)"}

Prefer the color the brand is known for (logo, main call-to-action). Avoid status colors (success, error, warning, info) and syntax-highlighting colors. Return ONLY JSON: {"color": "#rrggbb"}`,
    maxOutputTokens: 60,
  });
  const color = typeof json?.color === "string" ? normalizeHex(json.color) : null;
  return color && isColorful(color) ? color : null;
}

function metaContent(html: string, key: string): string | null {
  const tag = tags(html, "meta").find((t) => (attr(t, "property") ?? attr(t, "name") ?? "").toLowerCase() === key);
  return tag ? attr(tag, "content") : null;
}

interface ModelBrandFacts {
  name: string | null;
  radiusPx: number | null;
  font: string | null;
}

/** Name, button radius, and font as the model reads them from the page's own signals. */
async function readBrandFactsWithModel(
  ai: AiService,
  pageUrl: string,
  html: string,
  signals: CssSignals,
): Promise<ModelBrandFacts> {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const logoAlts = tags(html, "img")
    .filter((t) => /logo/i.test(`${attr(t, "class") ?? ""} ${attr(t, "src") ?? ""} ${attr(t, "alt") ?? ""}`))
    .map((t) => attr(t, "alt"))
    .filter((alt): alt is string => Boolean(alt))
    .slice(0, 3);
  const radiusVars = [...signals.rawVars].filter(([name]) => /radius|rounded/i.test(name)).slice(0, 15);
  const fonts = [...new Set([
    ...signals.bodyFonts,
    ...signals.fontVars,
  ].map((f) => resolveVars(f, signals.rawVars).trim()))].slice(0, 8);
  const googleFonts = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi)]
    .flatMap((m) => [...(m[1] ?? "").matchAll(/family=([^:&]+)/g)].map((f) => decodeURIComponent((f[1] ?? "").replace(/\+/g, " "))))
    .slice(0, 5);
  const fontChoices = WIDGET_FONTS.map((f) => f.value);

  const json = await ai.generateJsonObject({
    prompt: `Read the brand of ${pageUrl} so its support chat widget matches the site.

Page title: ${title || "(none)"}
og:site_name: ${metaContent(html, "og:site_name") ?? "(none)"}
application-name: ${metaContent(html, "application-name") ?? metaContent(html, "apple-mobile-web-app-title") ?? "(none)"}
Logo alt text: ${logoAlts.join(" | ") || "(none)"}

Button border-radius rules:
${signals.buttonRadiusRules.slice(0, 15).join("\n") || "(none)"}

Radius variables:
${radiusVars.map(([name, value]) => `--${name}: ${value}`).join("\n") || "(none)"}

Font declarations:
${fonts.join("\n") || "(none)"}
@font-face families: ${[...new Set(signals.fontFaceFamilies)].slice(0, 8).join(", ") || "(none)"}
Google Fonts: ${googleFonts.join(", ") || "(none)"}

Return ONLY JSON:
{"name": "the brand name exactly as the company writes it, with its own casing (e.g. LinkyCal, iPhone, GitHub); never the domain, no tagline", "buttonRadiusPx": number for the main call-to-action buttons (use 999 for pill-shaped), or null if unknown, "font": one of ${JSON.stringify(fontChoices)} that is the site's main body font or its closest match, or null if none is close}`,
    maxOutputTokens: 1000,
  });

  const name = typeof json?.name === "string" ? json.name.trim().slice(0, 60) : "";
  const radius = typeof json?.buttonRadiusPx === "number" && Number.isFinite(json.buttonRadiusPx) ? json.buttonRadiusPx : null;
  const font = typeof json?.font === "string" && fontChoices.includes(json.font) ? json.font : null;
  return { name: name && !/\.[a-z]{2,}$/i.test(name) ? name : null, radiusPx: radius, font };
}

export async function detectBrand(
  html: string,
  pageUrl: string,
  ai: AiService | null = null,
): Promise<DetectedBrand> {
  const inlineCss = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? []).join("\n");
  // Site-wide tokens usually live in a layout/global sheet, often far down the list.
  const globalSheet = /layout|global|app|main|theme|base|index|style/i;
  const sheetUrls = [...new Set(
    tags(html, "link")
      .filter((tag) => (attr(tag, "rel") ?? "").toLowerCase().includes("stylesheet"))
      .map((tag) => absolute(attr(tag, "href") ?? "", pageUrl))
      .filter((url): url is string => Boolean(url)),
  )]
    .sort((a, b) => Number(globalSheet.test(b.split("/").pop() ?? "")) - Number(globalSheet.test(a.split("/").pop() ?? "")))
    .slice(0, MAX_STYLESHEETS);
  const sheets = await Promise.all(sheetUrls.map((url) => fetchText(url, "text/css")));
  const css = [inlineCss, ...sheets.filter((s): s is string => Boolean(s))].join("\n");
  const signals = collectCssSignals(css);

  const metaTheme = tags(html, "meta")
    .filter((tag) => (attr(tag, "name") ?? "").toLowerCase() === "theme-color")
    .map((tag) => normalizeHex(attr(tag, "content") ?? ""))
    .filter((hex): hex is string => Boolean(hex));

  const bodyBgHex = signals.bodyBackgrounds[0] ?? null;
  const colorful = (list: string[]) => list.filter(isColorful);
  const pageBackground = bodyBgHex ?? signals.backgroundVarColors[0] ?? metaTheme[0] ?? null;
  const darkSite = (pageBackground !== null && luminance(pageBackground) < 0.08) ||
    /<meta[^>]+name=["']color-scheme["'][^>]+content=["']dark/i.test(html);

  const [modelColor, facts, iconUrl] = await Promise.all([
    ai ? pickBrandColorWithModel(ai, pageUrl, signals).catch(() => null) : null,
    ai ? readBrandFactsWithModel(ai, pageUrl, html, signals).catch(() => null) : null,
    pickIcon(html, pageUrl).catch(() => null),
  ]);
  const primaryColor =
    modelColor ??
    mostCommon(colorful(signals.brandVarColors)) ??
    mostCommon(colorful(signals.buttonColors)) ??
    colorful(metaTheme)[0] ??
    // Monochrome brands: a neutral reads as theirs; our blue would not.
    (darkSite ? "#f5f5f5" : "#111111");

  return {
    primaryColor,
    textColor: readableTextOn(primaryColor),
    backgroundColor: darkSite ? "#111111" : "#ffffff",
    borderRadius: radiusPreset(facts?.radiusPx ?? mostCommon(signals.buttonRadii)),
    fontFamily: facts?.font ?? matchWidgetFont(
      [...signals.bodyFonts, ...signals.fontVars].map((f) => resolveVars(f, signals.rawVars)),
    ),
    iconUrl,
    name: facts?.name ?? null,
  };
}

// ─── Help Docs ────────────────────────────────────────────────────────────────

const DOCS_WORDS = /^(help|docs?|documentation|support|faq|faqs|knowledge|kb|guides?|learn|academy|manual|help-?cent(er|re)|knowledge-?base)$/i;
// Link text is noisy ("Learn more"), so it only counts for unambiguous words.
const DOCS_TEXT = /\b(help cent(er|re)|help|docs|documentation|support|faq|knowledge base)\b/i;

function siteHost(host: string): string {
  return host.replace(/^www\./, "").toLowerCase();
}

/** Same site: the host itself or one of its subdomains, never a sibling on a shared suffix. */
function isSameSite(host: string, site: string): boolean {
  const h = siteHost(host);
  return h === site || h.endsWith(`.${site}`);
}

export async function suggestDocsUrls(
  html: string,
  pageUrl: string,
  ai: AiService | null,
): Promise<DocsSuggestion[]> {
  const site = siteHost(new URL(pageUrl).hostname);
  const candidates = new Map<string, string>();

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(match[1] ?? "", "href");
    const text = (match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!href) continue;
    const url = absolute(href, pageUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (!isSameSite(parsed.hostname, site)) continue;
    const subdomainHit = DOCS_WORDS.test(parsed.hostname.split(".")[0] ?? "");
    const pathHit = DOCS_WORDS.test(parsed.pathname.split("/").filter(Boolean)[0] ?? "");
    if (!subdomainHit && !pathHit && !DOCS_TEXT.test(text)) continue;
    // A text-only hit must still point somewhere docs-like, not a product page.
    if (!subdomainHit && !pathHit && parsed.pathname.split("/").filter(Boolean).length > 1) continue;
    // Keep the section entry point, not a deep article.
    const entry = subdomainHit
      ? `${parsed.protocol}//${parsed.hostname}/`
      : `${parsed.protocol}//${parsed.hostname}/${parsed.pathname.split("/").filter(Boolean)[0] ?? ""}`;
    if (!candidates.has(entry)) candidates.set(entry, text);
  }

  for (const sub of ["help", "docs", "support", "kb"]) {
    const url = `https://${sub}.${site}/`;
    if (!candidates.has(url)) candidates.set(url, "");
  }

  const checked = await Promise.all(
    [...candidates.entries()].slice(0, 12).map(async ([url, text]) => ({
      url,
      text,
      ok: await isReachableHtml(url),
    })),
  );
  const reachable = checked.filter((c) => c.ok);
  if (reachable.length === 0) return [];

  if (ai && reachable.length > 1) {
    const ranked = await rankDocsWithModel(ai, pageUrl, reachable);
    if (ranked.length > 0) return ranked;
  }

  return reachable.slice(0, 3).map((c) => ({ url: c.url, label: shortLabel(c.text) || new URL(c.url).hostname }));
}

function shortLabel(text: string): string {
  if (text.length <= 32) return text;
  const cut = text.slice(0, 32);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 12)).trim();
}

async function rankDocsWithModel(
  ai: AiService,
  pageUrl: string,
  candidates: Array<{ url: string; text: string }>,
): Promise<DocsSuggestion[]> {
  const list = candidates.map((c, i) => `${i + 1}. ${c.url}${c.text ? ` (link text: "${c.text}")` : ""}`).join("\n");
  const json = await ai.generateJsonObject({
    prompt: `A company's website is ${pageUrl}. We want to index its help center or product documentation so a support assistant can answer customer questions.

Candidate URLs found on the site (all load):
${list}

Pick up to 3 candidates that are most likely the entry point of the help center, docs, knowledge base, or FAQ. Skip blogs, careers, legal, status, and login pages. Return ONLY JSON:
{"picks": [{"index": 1, "label": "Short label, e.g. Help center"}]}`,
    maxOutputTokens: 300,
  });
  const picks = Array.isArray(json?.picks) ? json.picks : [];
  const result: DocsSuggestion[] = [];
  for (const pick of picks) {
    if (!pick || typeof pick !== "object") continue;
    const index = Number((pick as Record<string, unknown>).index) - 1;
    const label = (pick as Record<string, unknown>).label;
    const candidate = candidates[index];
    if (!candidate || result.some((r) => r.url === candidate.url)) continue;
    result.push({
      url: candidate.url,
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 40) : new URL(candidate.url).hostname,
    });
    if (result.length === 3) break;
  }
  return result;
}
