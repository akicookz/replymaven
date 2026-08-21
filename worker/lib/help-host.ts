export function normalizeDnsHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, "");
}

export function normalizeUrlHost(host: string): string {
  const lower = host.toLowerCase();
  const colon = lower.lastIndexOf(":");
  if (colon !== -1 && !lower.startsWith("[")) {
    const hostname = normalizeDnsHostname(lower.slice(0, colon));
    const port = lower.slice(colon + 1);
    return port ? `${hostname}:${port}` : hostname;
  }
  return normalizeDnsHostname(lower);
}

export function isReplyMavenHostname(hostname: string): boolean {
  const host = normalizeDnsHostname(hostname);
  return host === "replymaven.com" || host.endsWith(".replymaven.com");
}
