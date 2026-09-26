export interface SidechatMcpAvatar {
  id: string;
  name: string;
  icon: string | null;
}

interface SidechatMcpAvatarSource {
  connections: Array<{
    id: string;
    name: string;
    presetKey: string | null;
    url?: string | null;
    state: string;
  }>;
  presets: Array<{
    key: string;
    icon: string;
  }>;
}

const HOSTNAME = /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/;

// Same favicon URL the worker sends for tool rows (worker/lib/connector-favicon.ts).
function faviconUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return HOSTNAME.test(host)
      ? `https://www.google.com/s2/favicons?domain=${host}&sz=64`
      : null;
  } catch {
    return null;
  }
}

export function readConnectedMcpAvatars(
  input: SidechatMcpAvatarSource,
): SidechatMcpAvatar[] {
  return input.connections
    .filter((connection) => connection.state === "ready")
    .map((connection) => ({
      id: connection.id,
      name: connection.name,
      icon: input.presets.find((preset) => preset.key === connection.presetKey)
        ?.icon ?? faviconUrl(connection.url),
    }));
}
