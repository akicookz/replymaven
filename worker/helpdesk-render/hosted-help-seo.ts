import { normalizeHelpCustomUrl } from "./build-help-url";
import {
  isReplyMavenHostname,
  normalizeUrlHost,
} from "../lib/help-host";

export const HELP_PROXY_HEADER = "x-replymaven-help-proxy";
export const OWN_DOCS_DISPATCH_HEADER = "x-replymaven-own-docs";

export function stripOwnDocsDispatchHeader(request: Request): Request {
  if (!request.headers.has(OWN_DOCS_DISPATCH_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(OWN_DOCS_DISPATCH_HEADER);
  return new Request(request.url, {
    method: request.method,
    headers,
    redirect: request.redirect,
  });
}

export function isOwnDocsDispatch(
  request: Request,
  projectSlug: string,
): boolean {
  return (
    projectSlug === "replymaven" &&
    request.headers.get(OWN_DOCS_DISPATCH_HEADER) === "1"
  );
}

export function isHelpProxyPass(
  request: Request,
  customUrl: string | null,
): boolean {
  if (request.headers.get(HELP_PROXY_HEADER) === "1") return true;
  if (!customUrl) return false;
  let customHost: string;
  try {
    const url = new URL(customUrl);
    if (isReplyMavenHostname(url.hostname)) return false;
    customHost = normalizeUrlHost(url.host);
  } catch {
    return false;
  }
  const forwarded = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  if (!forwarded) return false;
  return normalizeUrlHost(forwarded) === customHost;
}

export function hostedHelpShouldNoindex(input: {
  ownDocsDispatch: boolean;
  proxyPass: boolean;
  helpCustomUrl: string | null;
}): boolean {
  if (input.ownDocsDispatch) return false;
  if (input.proxyPass && input.helpCustomUrl) return false;
  return true;
}

export function hostedHelpRedirectUrl(input: {
  requestUrl: string;
  projectSlug: string;
  customUrl: string;
}): string {
  const incoming = new URL(input.requestUrl);
  const prefix = `/help/${input.projectSlug}`;
  const suffix = incoming.pathname.startsWith(prefix)
    ? incoming.pathname.slice(prefix.length).replace(/\/+$/, "")
    : "";
  return `${normalizeHelpCustomUrl(input.customUrl)}${suffix}${incoming.search}`;
}
