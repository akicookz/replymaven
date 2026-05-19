export const HELP_ICON_NAMES = [
  "BookOpen",
  "Book",
  "BookText",
  "GraduationCap",
  "Lightbulb",
  "Rocket",
  "Settings",
  "Cog",
  "User",
  "Users",
  "CreditCard",
  "DollarSign",
  "Wallet",
  "MessageCircle",
  "MessageSquare",
  "Mail",
  "Phone",
  "Code",
  "Terminal",
  "Database",
  "Cloud",
  "Cpu",
  "Globe",
  "Lock",
  "Shield",
  "Key",
  "CircleAlert",
  "CircleHelp",
  "FileText",
  "Folder",
  "Image",
  "Video",
  "Mic",
  "Tag",
  "Sparkles",
  "Wrench",
  "Hammer",
  "Box",
  "Package",
  "ShoppingCart",
  "Heart",
  "Star",
  "Zap",
  "Bell",
  "Activity",
  "Layers",
  "Workflow",
] as const;

export type HelpIconName = (typeof HELP_ICON_NAMES)[number];

export function isHelpIconName(value: string): value is HelpIconName {
  return (HELP_ICON_NAMES as readonly string[]).includes(value);
}

export function isImageIcon(value: string | null | undefined): boolean {
  if (!value) return false;
  return (
    value.startsWith("/") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  );
}
