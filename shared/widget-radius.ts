export type WidgetRadiusPreset = "sharp" | "rounded" | "pill";

export interface WidgetRadiusTokens {
  window: number;
  card: number;
  /** 999 is a stadium once the element caps at 50%. */
  control: number;
}

export function widgetRadiusPreset(px: number): WidgetRadiusPreset {
  if (px === 0) return "sharp";
  if (px === 12) return "rounded";
  return "pill";
}

export function widgetRadiusStoredPx(preset: string): number {
  if (preset === "sharp") return 0;
  if (preset === "rounded") return 12;
  return 16;
}

export function widgetRadiusTokens(px: number): WidgetRadiusTokens {
  const preset = widgetRadiusPreset(px);
  if (preset === "sharp") return { window: 0, card: 0, control: 0 };
  if (preset === "rounded") return { window: 16, card: 12, control: 8 };
  return { window: 20, card: 16, control: 999 };
}
