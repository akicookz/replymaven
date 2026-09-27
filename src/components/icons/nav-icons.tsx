// Sidebar and settings icons. 16px grid, 1.5 stroke; `active` tints the main shape.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface NavIconProps {
  active?: boolean;
  className?: string;
}

function Svg({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
    >
      {children}
    </svg>
  );
}

function tint(active: boolean | undefined) {
  return active ? { fill: "currentColor", fillOpacity: 0.22 } : {};
}

export function NeedsYouIcon({ className }: NavIconProps) {
  return (
    <Svg className={className}>
      <path d="M5.25 8.5V4.75a1 1 0 0 1 2 0V7.5M7.25 7V3.25a1 1 0 0 1 2 0V7M9.25 7V4a1 1 0 0 1 2 0v4" />
      <path d="M11.25 8V6a1 1 0 0 1 2 0v3.5a4.5 4.5 0 0 1-4.5 4.5h-.6a4 4 0 0 1-3.1-1.5L2.9 10.1a1.05 1.05 0 0 1 1.6-1.35l.75.85" />
    </Svg>
  );
}

export function InboxIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <rect x="2.5" y="3" width="11" height="10" rx="2" {...tint(active)} />
      <path d="M2.5 9h3l1 1.5h3l1-1.5h3" />
    </Svg>
  );
}

export function CustomersIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <rect x="2" y="3" width="12" height="10" rx="2" {...tint(active)} />
      <circle cx="6" cy="7" r="1.5" />
      <path d="M3.75 10.5c.4-.95 1.2-1.5 2.25-1.5s1.85.55 2.25 1.5M10 6.5h2M10 9h1.5" />
    </Svg>
  );
}

export function MoreIcon({ className }: NavIconProps) {
  return (
    <Svg className={className}>
      <circle cx="3.75" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.25" cy="8" r="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function SnoozedIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="5.5" {...tint(active)} />
      <path d="M8 5v3l2 1.5" />
    </Svg>
  );
}

export function ResolvedIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="5.5" {...tint(active)} />
      <path d="m5.75 8.1 1.6 1.6 2.9-3.2" />
    </Svg>
  );
}

export function ArchivedIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <rect x="2" y="3" width="12" height="3" rx="1" {...tint(active)} />
      <path d="M3.5 6v5.5A1.5 1.5 0 0 0 5 13h6a1.5 1.5 0 0 0 1.5-1.5V6M6.5 8.75h3" />
    </Svg>
  );
}

export function SpamIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="5.5" {...tint(active)} />
      <path d="m4.25 4.25 7.5 7.5" />
    </Svg>
  );
}

export function KnowledgeIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <path d="M8 2.5 13.5 5.25 8 8 2.5 5.25Z" {...tint(active)} />
      <path d="m2.5 8 5.5 2.75L13.5 8M2.5 10.75 8 13.5l5.5-2.75" />
    </Svg>
  );
}

export function BehaviorIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="5.75" {...tint(active)} />
      <path d="M10.5 5.5 9 9l-3.5 1.5L7 7Z" fill="currentColor" fillOpacity={active ? 1 : 0} />
    </Svg>
  );
}

export function ConnectorsIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <rect x="2.5" y="2.5" width="5" height="5" rx="1.5" {...tint(active)} />
      <rect x="8.5" y="8.5" width="5" height="5" rx="1.5" {...tint(active)} />
      <path d="M7.5 5H9a2 2 0 0 1 2 2v1.5" />
    </Svg>
  );
}

export function GreetingsIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <rect x="2" y="2.5" width="9.5" height="6" rx="1.75" {...tint(active)} />
      <path d="M4.5 5.5h4.5" />
      <circle cx="12" cy="12" r="2" />
    </Svg>
  );
}

export function ArticlesIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <path
        d="M9.5 2.5H5A1.5 1.5 0 0 0 3.5 4v8A1.5 1.5 0 0 0 5 13.5h6a1.5 1.5 0 0 0 1.5-1.5V5.5Z"
        {...tint(active)}
      />
      <path d="M9.5 2.5v3h3M6 8.5h4M6 10.75h2.5" />
    </Svg>
  );
}

export function HelpHomeIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <rect x="2" y="3" width="12" height="10" rx="2" {...tint(active)} />
      <path d="M2 6.25h12" />
      <circle cx="4.25" cy="4.6" r=".5" fill="currentColor" stroke="none" />
      <circle cx="5.9" cy="4.6" r=".5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function SettingsIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 5h5.5M12.5 5h1M2.5 11h1M8 11h5.5" />
      <circle cx="10.25" cy="5" r="1.75" {...tint(active)} />
      <circle cx="5.75" cy="11" r="1.75" {...tint(active)} />
    </Svg>
  );
}

export function AppearanceIcon({ className }: NavIconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function QuickActionsIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <rect x="1.75" y="3.5" width="10" height="5" rx="2.5" {...tint(active)} />
      <path d="m9.5 8 4.25 1.75-1.85.75-.8 1.9Z" fill="currentColor" />
    </Svg>
  );
}

export function InstallIcon({ className }: NavIconProps) {
  return (
    <Svg className={className}>
      <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3.5l-2 9" />
    </Svg>
  );
}

export function ChannelsIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7l-2.5 2v-2a2 2 0 0 1-2-2Z" {...tint(active)} />
      <path d="M5.5 5.5h5M5.5 7.5h3" />
    </Svg>
  );
}

export function GlobeIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="5.5" {...tint(active)} />
      <path d="M2.5 8h11M8 2.5c1.5 1.5 2.25 3.35 2.25 5.5S9.5 12 8 13.5C6.5 12 5.75 10.15 5.75 8S6.5 4 8 2.5Z" />
    </Svg>
  );
}

export function ConnectedAppsIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <rect x="9" y="4" width="4.5" height="8" rx="1.5" {...tint(active)} />
      <rect x="4" y="5.75" width="3" height="4.5" rx="1" />
      <path d="M1.75 8H4M7 7h2M7 9h2" />
    </Svg>
  );
}

export function ProjectIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <path d="M8 2 13.5 5v6L8 14l-5.5-3V5Z" {...tint(active)} />
      <path d="M2.5 5 8 8l5.5-3M8 8v6" />
    </Svg>
  );
}

export function TeamIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <circle cx="6" cy="5.75" r="2.25" {...tint(active)} />
      <path d="M2 13c0-2.2 1.8-3.75 4-3.75s4 1.55 4 3.75M10.5 3.6a2.25 2.25 0 0 1 0 4.3M11.75 9.4c1.3.45 2.25 1.75 2.25 3.6" />
    </Svg>
  );
}

export function BillingIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <rect x="1.75" y="3.5" width="12.5" height="9" rx="2" {...tint(active)} />
      <path d="M1.75 6.5h12.5M4.5 10H7" />
    </Svg>
  );
}

export function ProfileIcon({ active, className }: NavIconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="5.75" {...tint(active)} />
      <circle cx="8" cy="6.75" r="2" />
      <path d="M4.3 12.2c.8-1.35 2.15-2.2 3.7-2.2s2.9.85 3.7 2.2" />
    </Svg>
  );
}

export function SearchIcon({ className }: NavIconProps) {
  return (
    <Svg className={className}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.25 3.25" />
    </Svg>
  );
}

// Brand marks for channel rows, masked to one colour so they follow the row's text colour.
function LogoImage({ src, className }: { src: string; className?: string }) {
  const mask = `url(${src}) center / contain no-repeat`;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-4 shrink-0 bg-current", className)}
      style={{ mask, WebkitMask: mask }}
    />
  );
}

export function EmailLogoIcon({ className }: NavIconProps) {
  return <LogoImage src="/integrations/gmail.svg" className={className} />;
}

export function TelegramLogoIcon({ className }: NavIconProps) {
  return <LogoImage src="/integrations/telegram.svg" className={className} />;
}

export function SlackLogoIcon({ className }: NavIconProps) {
  return <LogoImage src="/integrations/slack.svg" className={className} />;
}
