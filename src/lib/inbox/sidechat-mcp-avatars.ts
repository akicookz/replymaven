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
    state: string;
  }>;
  presets: Array<{
    key: string;
    icon: string;
  }>;
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
        ?.icon ?? null,
    }));
}
