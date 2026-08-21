import {
  isReplyMavenHostname,
  normalizeDnsHostname,
} from "./help-host";

export const MAX_HELP_ANALYTICS_EMBEDS = 4;

export const POSTHOG_API_KEY_RE = /^phc_[A-Za-z0-9]{8,200}$/;
export const GTAG_MEASUREMENT_ID_RE = /^G-[A-Z0-9]{4,20}$/;
export const META_PIXEL_ID_RE = /^\d{5,20}$/;

export const HELP_ANALYTICS_PROVIDERS = [
  "posthog",
  "gtag",
  "meta",
  "custom",
] as const;

export type HelpAnalyticsProvider = (typeof HELP_ANALYTICS_PROVIDERS)[number];
export type PosthogHost = "us" | "eu";

export type HelpAnalyticsEmbed =
  | { provider: "posthog"; apiKey: string; host: PosthogHost }
  | { provider: "gtag"; measurementId: string }
  | { provider: "meta"; pixelId: string }
  | { provider: "custom"; src: string };

export interface HelpAnalyticsScript {
  src?: string;
  async?: boolean;
  js?: string;
  noscriptImgSrc?: string;
}

const POSTHOG_API_HOSTS = {
  us: "https://us.i.posthog.com",
  eu: "https://eu.i.posthog.com",
} as const;

// Official PostHog loader. api_host is interpolated only after host is
// narrowed to us/eu, so the assets URL rewrite stays on PostHog's CDN.
const POSTHOG_STUB =
  '!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);';

const META_STUB =
  "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');";

export function parseHelpAnalytics(
  raw: string | null | undefined,
): HelpAnalyticsEmbed[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return sanitizeHelpAnalytics(parsed);
}

export function sanitizeHelpAnalytics(input: unknown): HelpAnalyticsEmbed[] {
  if (!Array.isArray(input)) return [];
  const embeds: HelpAnalyticsEmbed[] = [];
  const seen = new Set<HelpAnalyticsProvider>();
  for (const candidate of input) {
    const embed = sanitizeHelpAnalyticsEmbed(candidate);
    if (!embed) continue;
    if (seen.has(embed.provider)) continue;
    seen.add(embed.provider);
    embeds.push(embed);
    if (embeds.length === MAX_HELP_ANALYTICS_EMBEDS) break;
  }
  return embeds;
}

export function helpAnalyticsCustomHost(
  customUrl: string | null | undefined,
): string | null {
  if (!customUrl) return null;
  let url: URL;
  try {
    url = new URL(customUrl);
  } catch {
    return null;
  }
  const hostname = normalizeDnsHostname(url.hostname);
  if (!hostname || isReplyMavenHostname(hostname)) return null;
  return url.port ? `${hostname}:${url.port}` : hostname;
}

export function sanitizeCustomScriptSrc(raw: string): string | null {
  const trimmed = raw.trim();
  if (/[<>"'`]/.test(trimmed) || /<\/script/i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = normalizeDnsHostname(url.hostname);
  if (!host || host.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (host.startsWith(".") || host.includes("..")) {
    return null;
  }
  if (isLiteralIpHost(host)) return null;
  if (host === "localhost") return null;
  if (isReplyMavenHostname(host)) return null;
  url.hostname = host;
  url.hash = "";
  const href = url.toString();
  if (/[<>"'`]/.test(href)) return null;
  return href;
}

export function buildHelpAnalyticsScripts(
  embeds: HelpAnalyticsEmbed[],
  options: { customHost: string | null },
): HelpAnalyticsScript[] {
  const scripts: HelpAnalyticsScript[] = [];
  for (const embed of embeds) {
    if (embed.provider === "posthog") {
      scripts.push({ js: posthogInitScript(embed.apiKey, embed.host) });
      continue;
    }
    if (embed.provider === "gtag") {
      scripts.push({
        src: `https://www.googletagmanager.com/gtag/js?id=${embed.measurementId}`,
        async: true,
      });
      scripts.push({ js: gtagInitScript(embed.measurementId) });
      continue;
    }
    if (embed.provider === "meta") {
      scripts.push({
        js: metaInitScript(embed.pixelId),
        noscriptImgSrc: `https://www.facebook.com/tr?id=${embed.pixelId}&ev=PageView&noscript=1`,
      });
      continue;
    }
    if (embed.provider === "custom") {
      if (!options.customHost) continue;
      scripts.push({ js: customScriptLoader(embed.src, options.customHost) });
      continue;
    }
    const _exhaustive: never = embed;
    void _exhaustive;
  }
  return scripts;
}

function sanitizeHelpAnalyticsEmbed(
  candidate: unknown,
): HelpAnalyticsEmbed | null {
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;
  const provider = record.provider;
  if (provider === "posthog") {
    if (typeof record.apiKey !== "string") return null;
    const apiKey = record.apiKey.trim();
    if (!POSTHOG_API_KEY_RE.test(apiKey)) return null;
    const host = record.host === "eu" ? "eu" : record.host === "us" ? "us" : null;
    if (!host) return null;
    return { provider: "posthog", apiKey, host };
  }
  if (provider === "gtag") {
    if (typeof record.measurementId !== "string") return null;
    const measurementId = record.measurementId.trim().toUpperCase();
    if (!GTAG_MEASUREMENT_ID_RE.test(measurementId)) return null;
    return { provider: "gtag", measurementId };
  }
  if (provider === "meta") {
    if (typeof record.pixelId !== "string" && typeof record.pixelId !== "number") {
      return null;
    }
    const pixelId = String(record.pixelId).trim();
    if (!META_PIXEL_ID_RE.test(pixelId)) return null;
    return { provider: "meta", pixelId };
  }
  if (provider === "custom") {
    if (typeof record.src !== "string") return null;
    const src = sanitizeCustomScriptSrc(record.src);
    if (!src) return null;
    return { provider: "custom", src };
  }
  return null;
}

function posthogInitScript(apiKey: string, host: PosthogHost): string {
  return `${POSTHOG_STUB}posthog.init(${JSON.stringify(apiKey)},{api_host:${JSON.stringify(POSTHOG_API_HOSTS[host])},disable_session_recording:true});`;
}

function gtagInitScript(measurementId: string): string {
  const id = JSON.stringify(measurementId);
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${id});`;
}

function metaInitScript(pixelId: string): string {
  const id = JSON.stringify(pixelId);
  return `${META_STUB}fbq('init',${id});fbq('track','PageView');`;
}

function customScriptLoader(src: string, customHost: string): string {
  return `(function(){if(location.host!==${JSON.stringify(customHost)})return;var s=document.createElement("script");s.src=${JSON.stringify(src)};s.async=true;document.head.appendChild(s);})();`;
}

function isLiteralIpHost(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (/^[0-9a-f:]+$/i.test(host) && host.includes(":")) return true;
  return false;
}
