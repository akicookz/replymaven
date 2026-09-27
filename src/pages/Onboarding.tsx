import { useState, useEffect, useMemo, useRef } from "react";
import { Navigate, useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import {
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  Copy,
  Globe,
  ImagePlus,
  Moon,
  Pencil,
  PictureInPicture2,
  SquareRoundCorner,
  Sun,
  Type,
  Loader2,
  LogOut,
  Mail,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo, LogoIcon } from "@/components/Logo";
import { useSubscription } from "@/hooks/use-subscription";
import {
  buildPreviewHtml,
  type PreviewGreetingPayload,
  type WidgetPreviewMode,
} from "@/hooks/use-widget-settings";
import { signOut } from "@/lib/auth-client";
import { resetFirstPartyPostHog } from "@/lib/posthog";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { WIDGET_FONTS } from "../../shared/widget-fonts";
import { widgetRadiusPreset, widgetRadiusStoredPx } from "../../shared/widget-radius";
import { EXTRA_SEAT_PRICE_USD, PLANS, TRIAL_AI_MESSAGES } from "../../shared/plans";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "website" | "brand" | "trial" | "install" | "docs" | "voice" | "team" | "done";

const STEP_ORDER: Step[] = ["website", "brand", "trial", "install", "docs", "voice", "team", "done"];

const STEP_META: Record<Exclude<Step, "done">, { title: string; description: string }> = {
  website: { title: "Website", description: "We read it to set up your widget and Maven." },
  brand: { title: "Widget", description: "Matched to your site. Adjust anything." },
  trial: { title: "Free trial", description: "Maven starts answering once the trial is on." },
  install: { title: "Install", description: "Paste the tag before </body> on every page." },
  docs: { title: "Help docs", description: "Pick your help center. We index every page under it." },
  voice: { title: "Voice", description: "How Maven sounds, and when your team is online." },
  team: { title: "Team", description: "Invite the people who answer support." },
};

interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  onboarded: boolean;
}

interface OnboardingState {
  slug: string;
  name: string;
  domain: string | null;
  onboarded: boolean;
  step: Step;
  iconUrl: string | null;
  docsSuggestions: Array<{ url: string; label: string }>;
  docsResourceId: string | null;
  scanned: boolean;
}

interface WidgetStyle {
  primaryColor: string;
  textColor: string;
  backgroundColor: string;
  borderRadius: number;
  fontFamily: string;
  position: "bottom-right" | "bottom-left" | "center-inline";
  avatarUrl: string | null;
  bannerUrl: string | null;
  /** Company name; saved as the project name and widget header. */
  name: string;
}

type WidgetConfig = Omit<WidgetStyle, "name">;

const COLOR_PRESETS = ["#2563eb", "#7c3aed", "#059669", "#dc2626", "#ea580c", "#0891b2", "#db2777", "#475569"];

const TONES = ["friendly", "professional", "casual", "formal"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function faviconFallback(domain: string | null): string | null {
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function domainFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.includes(".")) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function readableTextOn(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#ffffff";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? "#111111" : "#ffffff";
}

function embedSnippet(slug: string): string {
  return `<script src="https://widget.replymaven.com/widget-embed.js" data-project="${slug}"></script>`;
}

const INSTALL_GUIDE_URL = "https://replymaven.com/docs/getting-started/install-the-chat-widget";

function agentPrompt(snippet: string, domain: string | null): string {
  return [
    `Add the ReplyMaven chat widget to ${domain ?? "this site"}.`,
    "",
    "Paste this script tag right before the closing </body> tag so it loads on every page:",
    "",
    snippet,
    "",
    `Framework-specific steps (Next.js, React, Vue, Webflow, WordPress, Shopify) and troubleshooting: ${INSTALL_GUIDE_URL}.md`,
    "",
    "After deploying, open the site and send a test message in the chat to confirm it loads.",
  ].join("\n");
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

function celebrate() {
  const colors = ["#2563eb", "#60a5fa", "#ffffff"];
  confetti({ particleCount: 90, spread: 70, origin: { y: 0.55 }, colors });
}

// ─── Layout Pieces ────────────────────────────────────────────────────────────

function SiteIcon({ iconUrl, domain, large, className }: { iconUrl: string | null; domain: string | null; large?: boolean; className?: string }) {
  const candidates = useMemo(
    () => [iconUrl, faviconFallback(domain)].filter((url): url is string => Boolean(url)),
    [iconUrl, domain],
  );
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [candidates]);
  const src = candidates[index];

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden bg-glass-raised inset-ring inset-ring-hairline-strong shadow-lg",
        large ? "size-10 rounded-md sm:size-12 sm:rounded-lg" : "size-10 rounded-md",
        className,
      )}
    >
      {src && <img src={src} alt="" className={large ? "size-6 object-contain sm:size-7" : "size-6 object-contain"} onError={() => setIndex((i) => i + 1)} />}
      {!src && domain && <span className="text-xl font-semibold text-ink-3">{domain.charAt(0).toUpperCase()}</span>}
      {!src && !domain && <Globe className={large ? "size-5 text-ink-4" : "size-4 text-ink-4"} />}
    </span>
  );
}

function OnboardingHeader({ canExit }: { canExit: boolean }) {
  const navigate = useNavigate();
  async function handleSignOut() {
    resetFirstPartyPostHog();
    await signOut();
    navigate("/");
  }
  return (
    <header className="flex items-center justify-between px-6 py-4">
      <Logo size="sm" />
      {canExit ? (
        <Button variant="ghost" size="sm" onClick={() => navigate("/app")} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4 mr-2" />
          Back to dashboard
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground">
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </Button>
      )}
    </header>
  );
}

function Shell({ canExit, children }: { canExit: boolean; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <OnboardingHeader canExit={canExit} />
      <main className="flex-1 overflow-x-hidden px-6 pb-24 pt-10 md:pt-20">
        <div className="mx-auto w-full min-w-0 max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

function ActionRow({ primary, secondary }: { primary: React.ReactNode; secondary?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <div className="-ml-3">{secondary}</div>
      {primary}
    </div>
  );
}

/** One quiet status line; replaces the old boxed status cards. */
function StatusLine({ tone, children }: { tone: "waiting" | "ok" | "error"; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-center gap-2 text-sm", tone === "error" ? "text-destructive" : "text-muted-foreground")}>
      {tone === "waiting" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
      {tone === "ok" && <Check className="size-3.5 shrink-0 text-dot-green" />}
      {tone === "error" && <X className="size-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
    </p>
  );
}

function PrimaryAction({
  onClick,
  label = "Continue",
  pending,
  disabled,
  type = "button",
}: {
  onClick?: () => void;
  label?: string;
  pending?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <Button type={type} onClick={onClick} disabled={disabled || pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {label}
      {!pending && <ArrowRight className="size-4" />}
    </Button>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

type ItemState = "done" | "active" | "todo";

/** Fading rail above the current step; clicking it views the previous step. */
function PreviousRail({ label, onClick }: { label: string | null; onClick?: () => void }) {
  if (!label || !onClick) return <li aria-hidden className="h-4" />;
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={`Back to ${label}`}
        className="group relative flex h-14 w-full cursor-pointer items-center pl-10 text-left"
      >
        <span aria-hidden className="absolute left-[7px] top-0 bottom-0 w-px bg-gradient-to-b from-transparent to-hairline transition-colors group-hover:to-ink-5" />
        <span className="text-sm text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">Back to {label}</span>
      </button>
    </li>
  );
}

function TimelineItem({
  state,
  title,
  description,
  last,
  children,
}: {
  state: ItemState;
  title: string;
  description: React.ReactNode;
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="relative pl-10">
      {!last && <span aria-hidden className="absolute left-[7px] top-6 bottom-0 w-px bg-hairline" />}
      {last && <span aria-hidden className="absolute left-[7px] top-6 h-16 w-px bg-gradient-to-b from-hairline to-transparent" />}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1 flex size-[15px] items-center justify-center rounded-full",
          state === "active" && "inset-ring-2 inset-ring-foreground bg-background",
          state === "done" && "bg-primary",
          state === "todo" && "inset-ring inset-ring-hairline-strong bg-background",
        )}
      >
        {state === "done" && <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />}
      </span>
      <div className={cn(state === "active" ? "pb-12" : "pb-9")}>
        <h3 className={cn("text-base font-semibold", state === "todo" ? "text-ink-7" : "text-foreground")}>{title}</h3>
        {state === "active" && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {state === "active" && children && <div className="mt-5 space-y-5">{children}</div>}

      </div>
    </li>
  );
}

// ─── Preview ──────────────────────────────────────────────────────────────────

function greetingPreview(companyName: string): PreviewGreetingPayload {
  return {
    id: "onboarding-welcome",
    enabled: true,
    imageUrl: null,
    mediaType: null,
    imagePosition: null,
    imageAspect: null,
    title: `Hi there! Questions about ${companyName}? Ask here.`,
    description: null,
    ctaText: null,
    ctaLink: null,
    author: null,
    allowedPages: null,
    delaySeconds: 0,
    durationSeconds: 0,
    sortOrder: 0,
  };
}

const PREVIEW_VIEWS: Array<{ value: WidgetPreviewMode; label: string }> = [
  { value: "launcher", label: "Greeting" },
  { value: "open", label: "Home" },
  { value: "chat", label: "Chat" },
];

function useIsDesktop(): boolean {
  const query = "(min-width: 1024px)";
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return matches;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Browser chrome around the preview; the address bar shows the customer's site. */
function BrowserFrame({
  address,
  iconUrl,
  focused,
  children,
}: {
  address: string;
  iconUrl: string | null;
  focused?: boolean;
  children: React.ReactNode;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => setIconFailed(false), [iconUrl]);
  return (
    <div className="overflow-hidden rounded-lg bg-background inset-ring inset-ring-hairline">
      <div className="flex h-12 items-center gap-3 bg-glass-card/60 px-4">
        <div aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-ink-8" />
          <span className="size-2.5 rounded-full bg-ink-8" />
          <span className="size-2.5 rounded-full bg-ink-8" />
        </div>
        <div
          className={cn(
            "flex h-7 w-full max-w-sm items-center gap-2 rounded-md bg-glass-button px-2.5 text-xs transition-shadow",
            focused && "inset-ring inset-ring-primary/60 shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_18%,transparent)]",
          )}
        >
          {iconUrl && !iconFailed ? (
            <img src={iconUrl} alt="" className="size-3.5 shrink-0 rounded-sm object-contain" onError={() => setIconFailed(true)} />
          ) : (
            <Globe className="size-3.5 shrink-0 text-ink-6" />
          )}
          <span className={cn("truncate", address ? "text-ink-2" : "text-ink-7")}>{address || "yourwebsite.com"}</span>
          {focused && <span aria-hidden className="-ml-1.5 h-3.5 w-px animate-pulse bg-ink-3" />}
        </div>
      </div>
      {children}
    </div>
  );
}

function WidgetPreview({ slug, style, address, iconUrl }: {
  slug: string;
  style: WidgetStyle;
  address: string;
  iconUrl: string | null;
}) {
  const { theme } = useTheme();
  const [view, setView] = useState<WidgetPreviewMode>("open");
  const debounced = useDebounced(style, 250);
  const companyName = debounced.name.trim() || "your site";

  const html = useMemo(
    () =>
      buildPreviewHtml({
        projectSlug: slug,
        form: { ...debounced, headerText: companyName, homeTitle: "How can we help?" },
        greetings: [greetingPreview(companyName)],
        previewMode: view,
        theme,
        pagePath: "/",
        hiddenByPageRules: false,
        replayNonce: 0,
      }),
    [slug, companyName, debounced, theme, view],
  );

  return (
    <div className="space-y-3">
      <Segmented className="w-fit" size="sm" label="Preview" value={view} onValueChange={setView} options={PREVIEW_VIEWS} />
      <BrowserFrame address={address} iconUrl={iconUrl}>
        <iframe title="Widget preview" srcDoc={html} sandbox="allow-scripts allow-same-origin" className="block h-[660px] w-full" />
      </BrowserFrame>
    </div>
  );
}

function BlankPage() {
  return (
    <div className="flex h-[660px] flex-col justify-between p-8">
      <div className="space-y-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      {/* Where the widget launcher will sit on their site. */}
      <span className="ml-auto flex size-14 items-center justify-center rounded-full bg-primary shadow-lg">
        <LogoIcon className="h-6 w-auto text-primary-foreground" />
      </span>
    </div>
  );
}

// ─── Step Bodies ──────────────────────────────────────────────────────────────

function WebsiteBody({ url, setUrl, onCreated }: { url: string; setUrl: (v: string) => void; onCreated: (projectId: string) => void }) {
  const domain = domainFromInput(url);
  const create = useMutation({
    mutationFn: async () => {
      const trimmed = url.trim();
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}` }),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not create the project"));
      return (await res.json()) as { projectId: string };
    },
    onSuccess: (data) => onCreated(data.projectId),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (domain && !create.isPending) create.mutate();
      }}
    >
      <div className="flex gap-2">
        <Input id="website-url" aria-label="Website URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com" autoFocus />
        <PrimaryAction type="submit" disabled={!domain} pending={create.isPending} />
      </div>
    </form>
  );
}

const THEME_OPTIONS = [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }];
const POSITION_OPTIONS = [{ value: "bottom-right", label: "Bottom right" }, { value: "bottom-left", label: "Bottom left" }];
const CORNER_OPTIONS = [{ value: "sharp", label: "Sharp" }, { value: "rounded", label: "Soft" }, { value: "pill", label: "Round" }];

async function uploadImage(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body });
  if (!res.ok) throw new Error(await readError(res, "Upload failed"));
  return ((await res.json()) as { url: string }).url;
}

function ImageUploadButton({ onUploaded, label, className, badge, children }: {
  onUploaded: (url: string) => void;
  label: string;
  className?: string;
  badge: React.ReactNode;
  children: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useMutation({ mutationFn: uploadImage, onSuccess: onUploaded, onError: (err: Error) => toast.error(err.message) });
  return (
    <button type="button" aria-label={label} disabled={upload.isPending} onClick={() => inputRef.current?.click()} className={cn("group/upload relative", className)}>
      {children}
      <span className={cn("absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/20 text-white opacity-0 transition-opacity group-hover/upload:opacity-100", upload.isPending && "bg-black/45 opacity-100")}>
        {upload.isPending && <Loader2 className="size-4 animate-spin" />}
      </span>
      {badge}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file);
        }}
      />
    </button>
  );
}

function PropertyMenu({ label, icon, value, options, onValueChange }: {
  label: string;
  icon: React.ReactNode;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}) {
  const current = options.find((o) => o.value === value)?.label ?? options[0]?.label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} className="gap-1.5 px-2 font-normal text-ink-3 data-[state=open]:bg-glass-button [&_svg]:text-ink-6">
          {icon}
          {current}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" avoidCollisions={false} className="max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))]">
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColorButton({ value, swatches, onChange }: { value: string; swatches: string[]; onChange: (color: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Brand color" className="data-[state=open]:bg-glass-button">
          <span className="size-4 rounded-full inset-ring inset-ring-white/15" style={{ backgroundColor: value }} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2.5">
        <div className="flex items-center gap-2">
          {swatches.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Brand color ${color}`}
              onClick={() => onChange(color)}
              className="flex size-8 shrink-0 items-center justify-center rounded-md inset-ring inset-ring-hairline"
              style={{
                backgroundColor: color,
                boxShadow: value === color ? `0 0 0 2px var(--popover), 0 0 0 4px ${color}` : undefined,
              }}
            >
              {value === color && <Check className="size-3.5" style={{ color: readableTextOn(color) }} />}
            </button>
          ))}
          <ColorPicker variant="swatch" selected={!swatches.includes(value)} value={value} onChange={onChange} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NameField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  function commit() {
    const next = draft.trim();
    if (next) onChange(next);
    else setDraft(value);
    setEditing(false);
  }
  if (editing) {
    return (
      <Input
        autoFocus
        aria-label="Company name"
        value={draft}
        maxLength={100}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="-mx-2 h-8 w-[calc(100%+1rem)] px-2 md:text-[15px] font-medium"
      />
    );
  }
  return (
    <button
      type="button"
      aria-label="Edit company name"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className="group/name -mx-2 flex h-8 max-w-[calc(100%+1rem)] items-center gap-2 rounded-[8px] px-2 hover:bg-glass-button"
    >
      <span className="truncate text-[15px] font-medium text-foreground">{value}</span>
      <Pencil className="size-3.5 shrink-0 text-ink-6 transition-colors group-hover/name:text-foreground" />
    </button>
  );
}

function IdentityCard({ style, domain, swatches, onChange }: {
  style: WidgetStyle;
  domain: string | null;
  swatches: string[];
  onChange: (patch: Partial<WidgetStyle>) => void;
}) {
  const isLight = style.backgroundColor === "#ffffff";
  return (
    <div className="overflow-hidden rounded-lg bg-card inset-ring inset-ring-hairline">
      <div className="relative">
        <ImageUploadButton
          label="Upload banner"
          onUploaded={(url) => onChange({ bannerUrl: url })}
          className="block h-28 w-full overflow-hidden"
          badge={
            <span className={cn("absolute top-2.5 flex h-7 items-center gap-1.5 rounded-md bg-black/40 px-2 text-xs font-medium text-white backdrop-blur-sm transition-colors group-hover/upload:bg-black/60", style.bannerUrl ? "right-11" : "right-2.5")}>
              <ImagePlus className="size-3.5" />
              {style.bannerUrl ? "Change banner" : "Add banner"}
            </span>
          }
        >
          <span
            className="block size-full bg-cover bg-center"
            style={{ backgroundColor: style.primaryColor, backgroundImage: style.bannerUrl ? `url(${style.bannerUrl})` : undefined }}
          />
        </ImageUploadButton>
        {style.bannerUrl && (
          <button
            type="button"
            aria-label="Remove banner"
            onClick={() => onChange({ bannerUrl: null })}
            className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-md bg-black/40 text-white backdrop-blur-sm hover:bg-black/60"
          >
            <X className="size-3.5" />
          </button>
        )}
        <ImageUploadButton
          label="Upload avatar"
          onUploaded={(url) => onChange({ avatarUrl: url })}
          className="absolute -bottom-7 left-5 size-14 rounded-full shadow-md ring-[3px] ring-card"
          badge={
            <span className="absolute -right-1.5 -bottom-1 flex size-7 items-center justify-center rounded-full bg-popover text-ink-2 shadow-sm ring-[3px] ring-card transition-colors group-hover/upload:text-foreground">
              <Camera className="size-3.5" />
            </span>
          }
        >
          {style.avatarUrl ? (
            <img src={style.avatarUrl} alt="" className="size-full rounded-full bg-white object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center rounded-full" style={{ backgroundColor: style.primaryColor, color: style.textColor }}>
              <LogoIcon className="h-5 w-auto" />
            </span>
          )}
        </ImageUploadButton>
      </div>
      <div className="px-5 pt-10 pb-3">
        <NameField value={style.name} onChange={(name) => onChange({ name })} />
        {domain && domain !== style.name && <p className="truncate text-[13px] text-muted-foreground">{domain}</p>}
        <div className="-mx-2 mt-3 flex flex-wrap items-center gap-0.5">
          <ColorButton value={style.primaryColor} swatches={swatches} onChange={(color) => onChange({ primaryColor: color, textColor: readableTextOn(color) })} />
          <PropertyMenu
            label="Widget theme"
            icon={isLight ? <Sun /> : <Moon />}
            value={isLight ? "light" : "dark"}
            options={THEME_OPTIONS}
            onValueChange={(v) => onChange({ backgroundColor: v === "light" ? "#ffffff" : "#111111" })}
          />
          <PropertyMenu
            label="Position"
            icon={<PictureInPicture2 />}
            value={style.position === "bottom-left" ? "bottom-left" : "bottom-right"}
            options={POSITION_OPTIONS}
            onValueChange={(v) => onChange({ position: v as WidgetStyle["position"] })}
          />
          <PropertyMenu
            label="Corners"
            icon={<SquareRoundCorner />}
            value={widgetRadiusPreset(style.borderRadius)}
            options={CORNER_OPTIONS}
            onValueChange={(v) => onChange({ borderRadius: widgetRadiusStoredPx(v as Parameters<typeof widgetRadiusStoredPx>[0]) })}
          />
          <PropertyMenu label="Font" icon={<Type />} value={style.fontFamily} options={WIDGET_FONTS} onValueChange={(v) => onChange({ fontFamily: v })} />
        </div>
      </div>
    </div>
  );
}

function BrandBody({
  style,
  detectedColor,
  onChange,
  onSave,
  saving,
  scanning,
  domain,
}: {
  style: WidgetStyle | null;
  detectedColor: string | null;
  onChange: (patch: Partial<WidgetStyle>) => void;
  onSave: () => void;
  saving: boolean;
  scanning: boolean;
  domain: string | null;
}) {
  if (scanning || !style) {
    return (
      <div className="flex items-center gap-3 rounded-glass bg-muted/40 px-4 py-3.5 text-sm text-ink-2">
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        Reading {domain ?? "your site"}…
      </div>
    );
  }
  const swatches = [...new Set([detectedColor, ...COLOR_PRESETS].filter((c): c is string => Boolean(c)))].slice(0, 5);

  return (
    <>
      <IdentityCard style={style} domain={domain} swatches={swatches} onChange={onChange} />
      <ActionRow primary={<PrimaryAction onClick={onSave} pending={saving} />} />
    </>
  );
}

function TrialBody() {
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const plan = PLANS.business;
  const price = interval === "monthly" ? plan.monthlyPriceUsd : Math.floor((plan.annualPriceUsd ?? 0) / 12);
  const checkout = useMutation({
    mutationFn: async () => {
      const base = `${window.location.origin}/app/onboarding`;
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "business", interval, successUrl: `${base}?checkout=success`, cancelUrl: base }),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not start checkout"));
      return ((await res.json()) as { url: string }).url;
    },
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const lines = [
    `${TRIAL_AI_MESSAGES} AI messages during the trial, then ${(plan.limits.aiMessagesPerMonth ?? 0).toLocaleString()} a month`,
    `${plan.limits.seats} seats included, extra seats $${EXTRA_SEAT_PRICE_USD.monthly}/mo`,
    "Every feature, cancel anytime before the trial ends",
  ];

  return (
    <>
      <div className="rounded-lg bg-glass-card p-5 space-y-4 inset-ring inset-ring-hairline">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{plan.name}</p>
            <p className="mt-1 flex items-baseline gap-1">
              <span className="text-3xl font-medium tracking-tight text-foreground tabular-nums">${price}</span>
              <span className="text-sm text-muted-foreground">/mo after 7 days</span>
            </p>
          </div>
          <Segmented
            className="w-fit"
            size="sm"
            label="Billing interval"
            value={interval}
            onValueChange={setInterval}
            options={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Annual" }]}
          />
        </div>
        <ul className="space-y-2">
          {lines.map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-sm text-ink-3">
              <Check className="mt-0.5 size-4 shrink-0 text-ink-5" />
              {line}
            </li>
          ))}
        </ul>
      </div>
      <ActionRow primary={<PrimaryAction onClick={() => checkout.mutate()} label="Start free trial" pending={checkout.isPending} />} />
    </>
  );
}

const AGENT_TARGETS = [
  { name: "Claude Code", logo: "/integrations/claude.svg", href: (p: string) => `https://claude.ai/code?prompt=${encodeURIComponent(p)}` },
  { name: "Cursor", logo: "/integrations/cursor.svg", href: (p: string) => `https://cursor.com/link/prompt?text=${encodeURIComponent(p)}` },
  { name: "ChatGPT", logo: "/integrations/openai.svg", href: (p: string) => `https://chatgpt.com/?q=${encodeURIComponent(p)}` },
] as const;

const AGENT_LOGOS = ["/integrations/openai.svg", "/integrations/claude.svg", "/integrations/cursor.svg", "/integrations/lovable.svg"];

/** Brand marks are white or colored, so they always sit on the same solid dark chip. */
const CHIP_BG = "bg-[#2a2a2e]"; // fixed, opaque: logos must not show through overlaps in either theme

function LogoChip({ src, className }: { src: string; className?: string }) {
  return (
    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", CHIP_BG, className)}>
      <img src={src} alt="" className="size-3.5 object-contain" />
    </span>
  );
}

function ShareTile({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <span className="flex h-full w-full flex-col gap-4 rounded-md p-3.5 text-left transition-colors group-hover:bg-glass-button group-data-[state=open]:bg-glass-button">
      <span className="flex items-start justify-between">
        {icon}
        <ArrowUpRight className="size-4 text-ink-6 transition-colors group-hover:text-foreground" />
      </span>
      <span className="block text-sm font-medium text-foreground">{title}</span>
    </span>
  );
}

function ShareInstallCard({ projectId, snippet, domain }: { projectId: string; snippet: string; domain: string | null }) {
  const prompt = agentPrompt(snippet, domain);
  const [promptCopied, setPromptCopied] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [devEmail, setDevEmail] = useState("");

  const sendToDev = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/onboarding/${projectId}/send-to-developer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: devEmail.trim() }),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not send the email"));
    },
    onSuccess: () => {
      toast.success(`Sent to ${devEmail.trim()}`);
      setDevEmail("");
      setDevOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 2000);
  }

  return (
    <div className="grid grid-cols-1 gap-1 rounded-lg bg-glass-card p-1 inset-ring inset-ring-hairline sm:grid-cols-2">
      <Popover>
        <PopoverTrigger className="group rounded-md outline-none focus-visible:inset-ring focus-visible:inset-ring-hairline-strong">
          <ShareTile
            title="Send to your agent"
            icon={
              <span className="flex -space-x-1.5">
                {AGENT_LOGOS.map((logo) => <LogoChip key={logo} src={logo} />)}
              </span>
            }
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-1">
          {AGENT_TARGETS.map((target) => (
            <a
              key={target.name}
              href={target.href(prompt)}
              target="_blank"
              rel="noreferrer"
              className="flex h-9 items-center gap-2.5 rounded-md px-2 text-sm text-ink-2 hover:bg-glass-button hover:text-foreground"
            >
              <LogoChip src={target.logo} className="size-6" />
              <span className="flex-1">Open in {target.name}</span>
              <ArrowUpRight className="size-3.5 text-ink-6" />
            </a>
          ))}
          <button
            type="button"
            onClick={copyPrompt}
            className="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-ink-2 hover:bg-glass-button hover:text-foreground"
          >
            <span className="flex size-6 shrink-0 items-center justify-center">
              {promptCopied ? <Check className="size-3.5 text-dot-green" /> : <Copy className="size-3.5" />}
            </span>
            <span className="flex-1">{promptCopied ? "Prompt copied" : "Copy prompt"}</span>
          </button>
        </PopoverContent>
      </Popover>

      <Popover open={devOpen} onOpenChange={setDevOpen}>
        <PopoverTrigger className="group rounded-md outline-none focus-visible:inset-ring focus-visible:inset-ring-hairline-strong">
          <ShareTile
            title="Send to your developer"
            icon={
              <span className={cn("flex size-7 items-center justify-center rounded-full", CHIP_BG)}>
                <Mail className="size-3.5 text-white" />
              </span>
            }
          />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (devEmail.includes("@")) sendToDev.mutate();
            }}
          >
            <Input
              type="email"
              size={1}
              value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)}
              placeholder="developer@company.com"
              aria-label="Developer email"
              autoFocus
              className="h-8"
            />
            <Button type="submit" size="sm" disabled={!devEmail.includes("@") || sendToDev.isPending} className="shrink-0">
              {sendToDev.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Send
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function InstallBody({ projectId, state, onNext }: { projectId: string; state: OnboardingState; onNext: () => void }) {
  const snippet = embedSnippet(state.slug);
  const [copied, setCopied] = useState(false);

  const status = useQuery<{ verified: boolean; host: string | null }>({
    queryKey: ["install-status", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/onboarding/${projectId}/install-status`);
      if (!res.ok) throw new Error("Failed to check install");
      return res.json();
    },
    refetchInterval: (query) => (query.state.data?.verified ? false : 4000),
  });

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const verified = status.data?.verified === true;

  return (
    <>
      <div className="relative">
        <pre className="whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-glass-button p-4 pr-12 font-mono text-xs leading-relaxed text-ink-2">{snippet}</pre>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy snippet"}
          title={copied ? "Copied" : "Copy"}
          className="absolute right-2 top-2 size-7 text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-dot-green" /> : <Copy className="size-3.5" />}
        </Button>
      </div>

      <ShareInstallCard projectId={projectId} snippet={snippet} domain={state.domain} />

      {verified && <StatusLine tone="ok">Verified on {status.data?.host}</StatusLine>}

      <ActionRow
        primary={<PrimaryAction onClick={onNext} disabled={!verified} />}
        secondary={!verified && <Button variant="ghost" onClick={onNext} className="text-muted-foreground">Do this later</Button>}
      />
    </>
  );
}

function docsActionLabel(showPicker: boolean, failed: boolean): string {
  if (!showPicker) return "Continue";
  return failed ? "Try again" : "Start indexing";
}

interface ResourceSummary {
  id: string;
  status: string;
  pageCount?: number;
}

function DocsBody({ projectId, state, onNext }: { projectId: string; state: OnboardingState; onNext: () => void }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(state.docsSuggestions[0]?.url ?? "");
  const resourceId = state.docsResourceId;

  const start = useMutation({
    mutationFn: async (target: string) => {
      const res = await fetch(`/api/onboarding/${projectId}/docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: /^https?:\/\//i.test(target) ? target : `https://${target}` }),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not start indexing"));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["onboarding-state", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["resources", projectId, "onboarding"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resources = useQuery<ResourceSummary[]>({
    queryKey: ["resources", projectId, "onboarding"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources`);
      if (!res.ok) throw new Error("Failed to load resources");
      return res.json();
    },
    enabled: Boolean(resourceId),
    refetchInterval: (query) => {
      const current = query.state.data?.find((r) => r.id === resourceId);
      return current && (current.status === "indexed" || current.status === "failed") ? false : 3000;
    },
  });
  const resource = resources.data?.find((r) => r.id === resourceId);
  const indexing = Boolean(resourceId) && (!resource || resource.status === "crawling" || resource.status === "pending");
  const pages = resource?.pageCount ?? 0;
  const failed = Boolean(resourceId) && !indexing && (resource?.status === "failed" || pages === 0);
  const showPicker = !resourceId || failed;

  return (
    <>
      {failed && <StatusLine tone="error">Couldn't read pages there. Try another URL.</StatusLine>}
      {!showPicker && (
        <StatusLine tone={indexing ? "waiting" : "ok"}>
          {indexing ? `Indexing… ${pages.toLocaleString()} pages so far` : `${pages.toLocaleString()} pages indexed`}
        </StatusLine>
      )}
      {showPicker && (
        <div className="space-y-2">
          {state.docsSuggestions.map((s) => (
            <button
              key={s.url}
              type="button"
              onClick={() => setUrl(s.url)}
              className={cn(
                "flex w-full items-center gap-3 rounded-glass px-4 py-3 text-left inset-ring transition-colors",
                url === s.url ? "inset-ring-primary bg-primary/5" : "inset-ring-hairline hover:bg-glass-button",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-1">{s.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.url}</span>
              </span>
              {url === s.url && <Check className="size-4 shrink-0 text-primary" />}
            </button>
          ))}
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="help.example.com" aria-label="Help docs URL" />
        </div>
      )}
      <ActionRow
        primary={
          <PrimaryAction
            onClick={() => (showPicker ? start.mutate(url.trim()) : onNext())}
            label={docsActionLabel(showPicker, failed)}
            disabled={showPicker && !url.includes(".")}
            pending={start.isPending}
          />
        }
        secondary={showPicker && <Button variant="ghost" onClick={onNext} className="text-muted-foreground">Skip</Button>}
      />
    </>
  );
}

function VoiceBody({ projectId, onNext }: { projectId: string; onNext: () => void }) {
  const queryClient = useQueryClient();
  const settings = useQuery<{ toneOfVoice: string; workingHours: string | null }>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
  });
  const [tone, setTone] = useState<string | null>(null);
  const [hours, setHours] = useState<string | null>(null);
  const toneValue = tone ?? settings.data?.toneOfVoice ?? "friendly";
  const hoursValue = hours ?? settings.data?.workingHours ?? "";

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toneOfVoice: toneValue, workingHours: hoursValue.trim() || null }),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not save"));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-settings", projectId] });
      onNext();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Tone of voice</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TONES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTone(t)}
              className={cn(
                "h-10 rounded-glass text-sm capitalize transition-colors",
                toneValue === t ? "bg-primary/10 font-medium text-foreground inset-ring inset-ring-primary/40" : "bg-glass-card text-muted-foreground hover:bg-glass-button",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <label htmlFor="working-hours" className="text-sm font-medium text-foreground">Working hours</label>
        <Input id="working-hours" value={hoursValue} onChange={(e) => setHours(e.target.value.slice(0, 200))} placeholder="Mon-Fri, 9:00-18:00 CET" />
        <p className="text-xs text-muted-foreground">Maven follows this when telling visitors you are offline.</p>
      </div>
      <ActionRow primary={<PrimaryAction onClick={() => save.mutate()} pending={save.isPending} disabled={settings.isPending} />} />
    </>
  );
}

function TeamBody({ onNext }: { onNext: () => void }) {
  const { data: subData } = useSubscription();
  const [emails, setEmails] = useState<string[]>([""]);
  const maxSeats = subData?.seats.max ?? null;
  const free = maxSeats === null ? Number.POSITIVE_INFINITY : Math.max(0, maxSeats - (subData?.seats.current ?? 1));
  const valid = emails.map((e) => e.trim()).filter((e) => e.includes("@"));

  const invite = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/team/invite/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invites: valid.map((email) => ({ email, role: "member" })), accessAllProjects: true }),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not send invites"));
    },
    onSuccess: () => {
      toast.success(`Invited ${valid.length} ${valid.length === 1 ? "person" : "people"}`);
      onNext();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {maxSeats === null
          ? "Invite as many teammates as you need."
          : `${free} of ${maxSeats} seats free. Extra seats are $${EXTRA_SEAT_PRICE_USD.monthly}/mo.`}
      </p>
      <div className="space-y-2">
        {emails.map((email, i) => (
          <div key={i} className="flex gap-2">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmails((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
              placeholder="teammate@company.com"
              aria-label={`Teammate email ${i + 1}`}
            />
            {emails.length > 1 && (
              <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setEmails((list) => list.filter((_, j) => j !== i))}>
                <X className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {emails.length < Math.max(1, Math.min(free, 20)) && (
          <Button variant="ghost" size="sm" onClick={() => setEmails((list) => [...list, ""])} className="text-muted-foreground">
            <Plus className="size-4" />
            Add another
          </Button>
        )}
      </div>
      <ActionRow
        primary={
          <PrimaryAction
            onClick={() => (valid.length > 0 ? invite.mutate() : onNext())}
            label={valid.length > 0 ? "Send invites" : "Continue"}
            pending={invite.isPending}
            disabled={valid.length > free}
          />
        }
        secondary={valid.length > 0 && <Button variant="ghost" onClick={onNext} className="text-muted-foreground">Skip</Button>}
      />
    </>
  );
}

function DoneBlock({ projectId, domain }: { projectId: string; domain: string | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    celebrate();
    fetch(`/api/onboarding/${projectId}/complete`, { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error("Could not finish setup");
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
        setReady(true);
      })
      .catch((err: Error) => toast.error(err.message));
  }, [projectId, queryClient]);

  return (
    <div className="space-y-4 pl-10">
      <div>
        <h3 className="text-xl font-semibold text-foreground">You're live</h3>
        <p className="mt-1 text-sm text-muted-foreground">Maven is ready to answer on {domain ?? "your site"}.</p>
      </div>
      <Button onClick={() => navigate("/app", { replace: true })} disabled={!ready}>
        {!ready && <Loader2 className="size-4 animate-spin" />}
        Go to inbox
        <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function resolveStep(stored: Step, hasSubscription: boolean): Step {
  const step = stored === "website" ? "brand" : stored;
  if (hasSubscription && step === "trial") return "install";
  if (!hasSubscription && STEP_ORDER.indexOf(step) > STEP_ORDER.indexOf("trial")) return "trial";
  return step;
}

function Onboarding() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const checkoutReturn = searchParams.get("checkout") === "success";
  // Set by "Create project" in the dashboard: start a new project, don't resume one.
  const startNew = searchParams.get("new") === "1";
  const [autoCheckout, setAutoCheckout] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const settledDomain = useDebounced(domainFromInput(websiteUrl), 700);
  // Viewing an earlier step never moves saved progress back.
  const [viewStep, setViewStep] = useState<Step | null>(null);
  const isDesktop = useIsDesktop();
  const { data: subData, refetch: refetchSubscription } = useSubscription();
  const hasSubscription = Boolean(subData?.subscription);
  const subLoaded = subData !== undefined;

  // Landing CTA: /app/onboarding?plan=business&interval=… goes straight to Stripe.
  const autoCheckoutStarted = useRef(false);
  useEffect(() => {
    const plan = searchParams.get("plan");
    const interval = searchParams.get("interval");
    if (plan !== "business" || (interval !== "monthly" && interval !== "annual")) return;
    if (!subLoaded || autoCheckoutStarted.current) return;
    autoCheckoutStarted.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("plan");
        next.delete("interval");
        return next;
      },
      { replace: true },
    );
    if (hasSubscription) return;
    setAutoCheckout(true);
    const base = `${window.location.origin}/app/onboarding`;
    fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, interval, successUrl: `${base}?checkout=success`, cancelUrl: base }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (res.ok && data.url) {
          window.location.href = data.url;
          return;
        }
        throw new Error(data.error ?? "Could not start checkout");
      })
      .catch((err: Error) => {
        toast.error(err.message);
        setAutoCheckout(false);
      });
  }, [searchParams, setSearchParams, subLoaded, hasSubscription]);

  // Stripe return: the webhook writes the subscription a moment later.
  const [checkoutTimedOut, setCheckoutTimedOut] = useState(false);
  useEffect(() => {
    if (!checkoutReturn) return;
    if (hasSubscription) {
      celebrate();
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("checkout");
          return next;
        },
        { replace: true },
      );
      return;
    }
    const timer = window.setInterval(() => void refetchSubscription(), 2000);
    const giveUp = window.setTimeout(() => setCheckoutTimedOut(true), 30_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(giveUp);
    };
  }, [checkoutReturn, hasSubscription, refetchSubscription, setSearchParams]);

  const { data: projects, isPending: projectsPending } = useQuery<ProjectSummary[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  // Pinned once chosen, so finishing (which marks it onboarded) keeps the done screen.
  const [pinnedProjectId, setPinnedProjectId] = useState<string | null>(() => searchParams.get("project"));
  const activeProject = useMemo(() => {
    if (!projects || !subLoaded) return null;
    if (pinnedProjectId) return projects.find((p) => p.id === pinnedProjectId) ?? { id: pinnedProjectId } as ProjectSummary;
    if (startNew && hasSubscription) return null;
    const incomplete = projects.find((p) => !p.onboarded);
    if (incomplete) return incomplete;
    // All projects set up but no plan yet: finish the trial on the latest one.
    if (!hasSubscription && projects.length > 0) return projects[projects.length - 1];
    return null;
  }, [projects, pinnedProjectId, hasSubscription, startNew, subLoaded]);
  const projectId = activeProject?.id ?? null;
  const canExit = Boolean(projects?.some((p) => p.onboarded)) && hasSubscription;
  useEffect(() => {
    if (projectId && !pinnedProjectId) setPinnedProjectId(projectId);
  }, [projectId, pinnedProjectId]);
  // Keep the chosen project in the URL so a reload resumes it instead of starting over.
  useEffect(() => {
    if (!pinnedProjectId || searchParams.get("project") === pinnedProjectId) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("project", pinnedProjectId);
        next.delete("new");
        return next;
      },
      { replace: true },
    );
  }, [pinnedProjectId, searchParams, setSearchParams]);

  const stateQuery = useQuery<OnboardingState>({
    queryKey: ["onboarding-state", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/onboarding/${projectId}/state`);
      if (!res.ok) throw new Error("Failed to load onboarding");
      return res.json();
    },
    enabled: Boolean(projectId),
    // The scan runs in the background on the server; poll until it lands.
    refetchInterval: (query) => (query.state.data && !query.state.data.scanned ? 2000 : false),
  });
  const state = stateQuery.data ?? null;

  // Site scan: brand, docs suggestions, company profile. Runs once per project.
  const scanStarted = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || !state || state.scanned || scanStarted.current === projectId) return;
    scanStarted.current = projectId;
    void fetch(`/api/onboarding/${projectId}/scrape`, { method: "POST" }).catch(() => null);
  }, [projectId, state]);
  const scanDone = Boolean(state?.scanned);

  const configQuery = useQuery<WidgetConfig>({
    queryKey: ["widget-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/widget-config`);
      if (!res.ok) throw new Error("Failed to load widget");
      return res.json();
    },
    enabled: Boolean(projectId) && (scanDone || Boolean(state?.scanned)),
  });

  const [style, setStyle] = useState<WidgetStyle | null>(null);
  useEffect(() => {
    if (!configQuery.data || style) return;
    const c = configQuery.data;
    setStyle({
      primaryColor: c.primaryColor,
      textColor: c.textColor,
      backgroundColor: c.backgroundColor,
      borderRadius: c.borderRadius,
      fontFamily: c.fontFamily || "system-ui",
      position: c.position,
      avatarUrl: c.avatarUrl,
      bannerUrl: c.bannerUrl,
      name: state?.name ?? "",
    });
  }, [configQuery.data, style, state?.name]);

  const advance = useMutation({
    mutationFn: async (next: Step) => {
      const res = await fetch(`/api/onboarding/${projectId}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: next }),
      });
      if (!res.ok) throw new Error("Could not save progress");
      return next;
    },
    onMutate: (next) => {
      queryClient.setQueryData<OnboardingState>(["onboarding-state", projectId], (prev) => (prev ? { ...prev, step: next } : prev));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveWidget = useMutation({
    mutationFn: async () => {
      if (!style) return;
      const res = await fetch(`/api/onboarding/${projectId}/widget`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(style),
      });
      if (!res.ok) throw new Error(await readError(res, "Could not save the widget"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Onboarding, checkout, and invites are owner-only; teammates use the dashboard.
  if (subLoaded && subData?.role && subData.role !== "owner") {
    return <Navigate to="/app" replace />;
  }

  if (checkoutReturn && !hasSubscription && checkoutTimedOut) {
    return (
      <Shell canExit={canExit}>
        <div className="flex flex-col items-center gap-4 py-24 text-center">
          <p className="text-sm text-muted-foreground">Your payment went through, but the trial hasn't shown up yet.</p>
          <Button variant="outline" onClick={() => window.location.assign("/app/account/billing")}>Open billing</Button>
        </div>
      </Shell>
    );
  }

  if (autoCheckout || (checkoutReturn && !hasSubscription)) {
    return (
      <Shell canExit={canExit}>
        <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">{autoCheckout ? "Opening checkout…" : "Starting your trial…"}</p>
        </div>
      </Shell>
    );
  }

  if (projectsPending || !subLoaded || (projectId && stateQuery.isPending)) {
    return (
      <Shell canExit={canExit}>
        <Skeleton className="h-16 w-80 rounded-2xl" />
      </Shell>
    );
  }

  const storedStep: Step = projectId && state ? resolveStep(state.step, hasSubscription) : "website";
  const step: Step =
    viewStep && STEP_ORDER.indexOf(viewStep) < STEP_ORDER.indexOf(storedStep) ? viewStep : storedStep;
  const domain = state?.domain ?? settledDomain;
  const typedAddress = websiteUrl.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const address = state?.domain ?? typedAddress;
  const addressIcon = state?.iconUrl ?? (settledDomain && settledDomain === domainFromInput(websiteUrl) ? faviconFallback(settledDomain) : null);

  function goNext(next: Step) {
    setViewStep(null);
    if (STEP_ORDER.indexOf(next) > STEP_ORDER.indexOf(storedStep)) advance.mutate(next);
  }
  const timelineSteps = (Object.keys(STEP_META) as Array<Exclude<Step, "done">>).filter(
    (s) => s !== "trial" || !hasSubscription,
  );
  const currentIndex = step === "done" ? timelineSteps.length : timelineSteps.indexOf(step as Exclude<Step, "done">);
  const scanning = step === "brand" && !style;
  // Like Resend: the current step, then the next one dimmed. Nothing else.
  const visibleSteps = currentIndex < 0 ? [] : timelineSteps.slice(currentIndex, currentIndex + 2);
  const previous = currentIndex > 0 ? timelineSteps[currentIndex - 1] : undefined;
  const backTarget = previous && previous !== "website" && previous !== "trial" && projectId ? previous : undefined;

  function itemState(index: number): ItemState {
    if (index < currentIndex) return "done";
    if (index === currentIndex) return "active";
    return "todo";
  }

  function body(s: Exclude<Step, "done">): React.ReactNode {
    if (s === "website") {
      return (
        <WebsiteBody
          url={websiteUrl}
          setUrl={setWebsiteUrl}
          onCreated={(id) => {
            setPinnedProjectId(id);
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
          }}
        />
      );
    }
    if (!projectId || !state) return null;
    if (s === "brand") {
      return (
        <BrandBody
          style={style}
          detectedColor={configQuery.data?.primaryColor ?? null}
          onChange={(patch) => setStyle((prev) => (prev ? { ...prev, ...patch } : prev))}
          onSave={() =>
            saveWidget.mutate(undefined, {
              onSuccess: () => {
                void queryClient.invalidateQueries({ queryKey: ["widget-config", projectId] });
                void queryClient.invalidateQueries({ queryKey: ["onboarding-state", projectId] });
                void queryClient.invalidateQueries({ queryKey: ["projects"] });
                goNext(hasSubscription ? "install" : "trial");
              },
            })
          }
          saving={saveWidget.isPending}
          scanning={scanning}
          domain={state.domain}
        />
      );
    }
    if (s === "trial") return <TrialBody />;
    if (s === "install") return <InstallBody projectId={projectId} state={state} onNext={() => goNext("docs")} />;
    if (s === "docs") return <DocsBody projectId={projectId} state={state} onNext={() => goNext("voice")} />;
    if (s === "voice") return <VoiceBody projectId={projectId} onNext={() => goNext("team")} />;
    return <TeamBody onNext={() => goNext("done")} />;
  }

  const previewReady = Boolean(projectId && state && style);

  return (
    <Shell canExit={canExit}>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:gap-16">
        <div className="min-w-0">
          <div className="mb-8 flex items-start gap-3 sm:mb-12 sm:gap-4">
            <SiteIcon large className="mt-1" iconUrl={state?.iconUrl ?? null} domain={domain} />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {state?.name ? `Set up ${state.name}` : "Set up ReplyMaven"}
              </h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground sm:mt-1 sm:text-sm">Your AI support agent, live in about 15 minutes.</p>
            </div>
          </div>

          {step !== "done" && (
            <ol>
              <PreviousRail
                label={backTarget ? STEP_META[backTarget].title : null}
                onClick={backTarget ? () => setViewStep(backTarget) : undefined}
              />
              {visibleSteps.map((s) => {
                const i = timelineSteps.indexOf(s);
                return (
                  <TimelineItem
                    key={s}
                    state={itemState(i)}
                    title={STEP_META[s].title}
                    description={
                      s === "install" ? (
                        <>
                          {STEP_META.install.description}{" "}
                          <a href={INSTALL_GUIDE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-ink-2 underline decoration-hairline-strong underline-offset-4 hover:text-foreground">
                            Install guide
                            <ArrowUpRight className="size-3" />
                          </a>
                        </>
                      ) : (
                        STEP_META[s].description
                      )
                    }
                    last={s === visibleSteps[visibleSteps.length - 1]}
                  >
                    {itemState(i) === "active" && body(s)}
                  </TimelineItem>
                );
              })}
            </ol>
          )}

          {step === "done" && projectId && <DoneBlock projectId={projectId} domain={domain} />}

          {/* On small screens the preview follows the widget controls. */}
          {!isDesktop && step === "brand" && previewReady && style && state && (
            <div className="mt-8">
              <WidgetPreview slug={state.slug} style={style} address={address} iconUrl={addressIcon} />
            </div>
          )}
        </div>

        {isDesktop && (
        <div>
          <div className="sticky top-8">
            {previewReady && style && state ? (
              <WidgetPreview slug={state.slug} style={style} address={address} iconUrl={addressIcon} />
            ) : (
              <div className="pt-11">
                <BrowserFrame address={address} iconUrl={addressIcon} focused={step === "website"}>
                  <BlankPage />
                </BrowserFrame>
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </Shell>
  );
}

export default Onboarding;
