import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { useSubscription } from "@/hooks/use-subscription";
import {
  Globe,
  Building2,
  Palette,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
  AlertCircle,
  CreditCard,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PricingCardsSelect, BillingToggle, getCtaLabel } from "@/components/PricingCards";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/color-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { WIDGET_FONTS as FONT_OPTIONS } from "../../shared/widget-fonts";
import { INDUSTRIES } from "../../shared/industries";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  "#2563eb",
  "#7c3aed",
  "#059669",
  "#dc2626",
  "#ea580c",
  "#0891b2",
  "#db2777",
  "#475569",
] as const;

const ONBOARDING_CONTENT_CLASS = "w-full max-w-2xl mx-auto shrink-0";

// ─── Step 1: Add Your Website ─────────────────────────────────────────────────

function Step1({
  websiteUrl,
  onChange,
  onNext,
  isPending,
  error,
}: {
  websiteUrl: string;
  onChange: (url: string) => void;
  onNext: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const isValid = websiteUrl.trim().includes(".");

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl glow-surface flex items-center justify-center shrink-0">
          <Globe className="w-6 h-6 text-brand" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground">
            Add your website
          </h2>
          <p className="text-sm text-muted-foreground">
            We'll analyze your site and set up your AI support agent for you
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (isValid && !isPending) onNext();
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Website URL
          </label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={websiteUrl}
              onChange={(e) => onChange(e.target.value)}
              placeholder="example.com"
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-input bg-input-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <Button type="submit" disabled={!isValid || isPending} className="w-full">
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating project...
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
      </form>
    </div>
  );
}

// ─── Step 2: Review Company Profile ───────────────────────────────────────────

interface CompanyProfile {
  websiteName: string;
  companyName: string;
  industry: string;
  context: string;
}

function hasSavedCompanyProfile(settings: {
  companyName: string | null;
  industry: string | null;
  companyContext: string | null;
} | undefined): boolean {
  return Boolean(
    settings?.companyContext?.trim() &&
      settings?.companyName?.trim() &&
      settings?.industry,
  );
}

function Step2({
  projectId,
  profile,
  setProfile,
  onNext,
  onBack,
  settingsReady,
  hasExistingProfile,
}: {
  projectId: string;
  profile: CompanyProfile;
  setProfile: (profile: CompanyProfile) => void;
  onNext: () => void;
  onBack: () => void;
  settingsReady: boolean;
  hasExistingProfile: boolean;
}) {
  const queryClient = useQueryClient();
  const [scraped, setScraped] = useState<boolean | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const hasFired = useRef(false);
  const skippedRef = useRef(false);

  const scrapeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/onboarding/${projectId}/scrape`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to scrape");
      return res.json() as Promise<{
        context: string;
        scraped: boolean;
        websiteName?: string;
        companyName?: string;
        industry?: string;
      }>;
    },
    onSuccess: (data) => {
      if (skippedRef.current) return;
      setScraped(data.scraped);
      if (data.scraped && data.context) {
        setProfile({
          websiteName: data.websiteName || profile.websiteName,
          companyName: data.companyName || profile.companyName,
          industry: data.industry || profile.industry,
          context: data.context,
        });
        // The scrape persisted the profile server-side too
        queryClient.invalidateQueries({ queryKey: ["project", projectId] });
        queryClient.invalidateQueries({
          queryKey: ["project-settings", projectId],
        });
      }
    },
    onError: () => {
      if (skippedRef.current) return;
      setScraped(false);
    },
  });

  const saveContextMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/onboarding/${projectId}/context`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteName: profile.websiteName,
          companyName: profile.companyName,
          industry: profile.industry,
          companyContext: profile.context,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
  });

  // Wait for saved settings before deciding whether to scrape
  useEffect(() => {
    if (!settingsReady || hasFired.current) return;
    hasFired.current = true;
    if (hasExistingProfile || profile.context.trim()) {
      setScraped(true);
      return;
    }
    scrapeMutation.mutate();
  }, [settingsReady, hasExistingProfile, profile.context]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show "Enter manually" after 10 seconds of crawling
  useEffect(() => {
    if (!scrapeMutation.isPending || skippedRef.current) return;
    const timer = setTimeout(() => setShowManualEntry(true), 10_000);
    return () => clearTimeout(timer);
  }, [scrapeMutation.isPending]);

  function handleSkipCrawl() {
    skippedRef.current = true;
    setScraped(false);
    setShowManualEntry(false);
  }

  const isValid =
    profile.websiteName.trim() &&
    profile.companyName.trim() &&
    profile.industry &&
    profile.context.trim();

  function handleContinue() {
    saveContextMutation.mutate(undefined, { onSuccess: onNext });
  }

  if (!settingsReady) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Loading state — skeleton UI (unless user skipped)
  if (scrapeMutation.isPending && !skippedRef.current) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl glow-surface flex items-center justify-center shrink-0">
              <Globe className="w-6 h-6 text-brand" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-foreground">
                Analyzing your website...
              </h2>
              <p className="text-sm text-muted-foreground">
                We're reading your site and filling in your company details
                for you
              </p>
              {showManualEntry && (
                <button
                  type="button"
                  onClick={handleSkipCrawl}
                  className="md:hidden text-sm text-primary hover:underline pt-1"
                >
                  Enter manually instead
                </button>
              )}
            </div>
          </div>
          {showManualEntry && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkipCrawl}
              className="hidden md:inline-flex shrink-0 text-primary hover:text-primary"
            >
              Enter manually
            </Button>
          )}
        </div>

        {/* Skeleton: URL bar with progress */}
        <div className="rounded-xl bg-muted/30 p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Globe className="w-4 h-4 text-muted-foreground animate-pulse" />
            <div className="h-4 w-48 rounded-md bg-muted animate-pulse" />
            <div className="flex-1" />
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full w-2/3 rounded-full bg-primary/30 animate-pulse" />
          </div>
        </div>

        {/* Skeleton: Extracted content lines */}
        <div className="rounded-xl bg-muted/30 p-5 space-y-3">
          <div className="h-3 w-24 rounded bg-muted animate-pulse" />
          <div className="space-y-2.5">
            <div className="h-3.5 w-full rounded bg-muted animate-pulse" />
            <div className="h-3.5 w-5/6 rounded bg-muted animate-pulse" style={{ animationDelay: "100ms" }} />
            <div className="h-3.5 w-full rounded bg-muted animate-pulse" style={{ animationDelay: "200ms" }} />
            <div className="h-3.5 w-2/3 rounded bg-muted animate-pulse" style={{ animationDelay: "300ms" }} />
            <div className="h-3.5 w-4/5 rounded bg-muted animate-pulse" style={{ animationDelay: "400ms" }} />
            <div className="h-3.5 w-full rounded bg-muted animate-pulse" style={{ animationDelay: "500ms" }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl glow-surface flex items-center justify-center shrink-0">
          <Building2 className="w-6 h-6 text-brand" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground">
            {scraped
              ? "Here's what we found"
              : "Tell us about your business"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {scraped
              ? "We generated this from your website. Review and edit anything before continuing."
              : "We couldn't extract much from your site. Fill in the details so your AI agent knows."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Website Name
          </label>
          <input
            type="text"
            value={profile.websiteName}
            onChange={(e) =>
              setProfile({ ...profile, websiteName: e.target.value })
            }
            placeholder="My Awesome App"
            className="w-full px-4 py-2.5 rounded-xl border border-input bg-input-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Company Name
          </label>
          <input
            type="text"
            value={profile.companyName}
            onChange={(e) =>
              setProfile({ ...profile, companyName: e.target.value })
            }
            placeholder="Acme Inc."
            className="w-full px-4 py-2.5 rounded-xl border border-input bg-input-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Industry
        </label>
        <Select
          value={profile.industry}
          onValueChange={(val) => setProfile({ ...profile, industry: val })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select your industry" />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRIES.map((industry) => (
              <SelectItem key={industry} value={industry}>
                {industry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Company Context
        </label>
        <textarea
          value={profile.context}
          onChange={(e) =>
            setProfile({ ...profile, context: e.target.value })
          }
          rows={8}
          placeholder="Describe what your company does, your products/services, pricing, policies, and anything your AI support agent should know..."
          className="w-full px-4 py-3 rounded-xl border border-input bg-input-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
        <p className="text-xs text-muted-foreground">
          This context helps your AI agent answer questions accurately.
        </p>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button
          onClick={handleContinue}
          disabled={!isValid || saveContextMutation.isPending}
          className="flex-1"
        >
          {saveContextMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Step 3: Widget Styling ───────────────────────────────────────────────────

type WidgetPosition = "bottom-right" | "bottom-left" | "center-inline";

const WIDGET_POSITIONS: { value: WidgetPosition; label: string }[] = [
  { value: "bottom-right", label: "Bottom Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "center-inline", label: "Center Inline" },
];

interface WidgetStyle {
  primaryColor: string;
  textColor: string;
  borderRadius: number;
  fontFamily: string;
  position: WidgetPosition;
}

function hexToRgb(hex: string): string {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return "37, 99, 235";
  return `${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}`;
}

function widgetPreviewFontFamily(fontFamily: string): string {
  if (fontFamily === "system-ui") {
    return "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  }
  return `"${fontFamily}", system-ui, -apple-system, sans-serif`;
}

function formatPreviewDomain(url: string): string {
  if (!url.trim()) return "yoursite.com";
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return (
      url
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./, "")
        .split("/")[0] || "yoursite.com"
    );
  }
}

function getFaviconCandidates(domain: string, size: number): string[] {
  if (!domain || domain === "yoursite.com") return [];
  const encoded = encodeURIComponent(domain);
  return [
    `https://${domain}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${encoded}&sz=${size * 2}`,
    `https://icons.duckduckgo.com/ip3/${encoded}.ico`,
  ];
}

function PreviewFaviconAvatar({
  domain,
  size,
  className,
  primaryColor,
  rgb,
}: {
  domain: string;
  size: number;
  className: string;
  primaryColor: string;
  rgb: string;
}) {
  const candidates = getFaviconCandidates(domain, size);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const showFallback =
    candidates.length === 0 || candidateIndex >= candidates.length;

  useEffect(() => {
    setCandidateIndex(0);
  }, [domain]);

  if (showFallback) {
    return (
      <div
        className={`flex items-center justify-center shrink-0 ${className}`}
        style={{
          background: `rgba(${rgb}, 0.08)`,
          color: primaryColor,
        }}
      >
        <Sparkles className={size >= 28 ? "w-4 h-4" : "w-2.5 h-2.5"} />
      </div>
    );
  }

  return (
    <div className={`overflow-hidden shrink-0 ${className}`}>
      <img
        src={candidates[candidateIndex]}
        alt=""
        className="w-full h-full object-cover"
        onError={() => setCandidateIndex((index) => index + 1)}
      />
    </div>
  );
}

function WidgetStylePreview({
  style,
  websiteUrl,
}: {
  style: WidgetStyle;
  websiteUrl: string;
}) {
  const domain = formatPreviewDomain(websiteUrl);
  const rgb = hexToRgb(style.primaryColor);
  const inputRadius = Math.min(style.borderRadius * 0.875, 14);

  useEffect(() => {
    const font = FONT_OPTIONS.find((option) => option.value === style.fontFamily);
    if (!font?.url) return;

    const linkId = "onboarding-widget-preview-font";
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = font.url;
  }, [style.fontFamily]);

  const isInline = style.position === "center-inline";
  const viewportAlign =
    style.position === "bottom-left"
      ? "items-end justify-start"
      : style.position === "center-inline"
        ? "items-end justify-center"
        : "items-end justify-end";

  const chatPanel = (
    <div
      className={`flex flex-col overflow-hidden border border-border/80 bg-white shadow-[0_12px_32px_rgba(15,15,20,0.14)] ${
        isInline ? "w-full max-w-[280px]" : "w-full max-w-[248px]"
      }`}
      style={{
        borderRadius: `${style.borderRadius}px`,
        fontFamily: widgetPreviewFontFamily(style.fontFamily),
      }}
    >
      <div className="flex items-center gap-2.5 px-4 py-3.5">
        <PreviewFaviconAvatar
          domain={domain}
          size={32}
          className="w-8 h-8 rounded-[10px]"
          primaryColor={style.primaryColor}
          rgb={rgb}
        />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-[#18181b] leading-tight truncate">
            Chat with us
          </p>
          <p className="text-xs text-[#71717a] leading-tight mt-0.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            Online
          </p>
        </div>
        <div className="w-8 h-8 rounded-full bg-[#f4f4f5] flex items-center justify-center text-[#71717a] shrink-0">
          <X className="w-4 h-4" />
        </div>
      </div>

      <div className="px-4 pb-2 space-y-3">
        <div className="flex items-end gap-2 max-w-[92%]">
          <PreviewFaviconAvatar
            domain={domain}
            size={18}
            className="w-[18px] h-[18px] rounded-[5px]"
            primaryColor={style.primaryColor}
            rgb={rgb}
          />
          <div
            className="px-3.5 py-2.5 text-sm text-[#18181b] leading-snug"
            style={{
              background: "#f4f4f5",
              borderRadius: "18px 18px 18px 4px",
            }}
          >
            Hi there! How can I help you today?
          </div>
        </div>

        <div className="flex justify-end">
          <div
            className="px-3.5 py-2.5 text-sm leading-snug max-w-[85%]"
            style={{
              background: style.primaryColor,
              color: style.textColor,
              borderRadius: "18px 18px 4px 18px",
            }}
          >
            I have a question about pricing
          </div>
        </div>
      </div>

      {!isInline && (
        <div className="px-4 pb-3 pt-1 flex items-center gap-2">
          <div
            className="flex-1 px-3 py-2 text-sm text-[#a1a1aa]"
            style={{
              background: "#f4f4f5",
              borderRadius: `${inputRadius}px`,
            }}
          >
            Type a message...
          </div>
          <div
            className="w-9 h-9 flex items-center justify-center shrink-0"
            style={{
              background: style.primaryColor,
              color: style.textColor,
              borderRadius: `${inputRadius}px`,
            }}
          >
            <ArrowRight className="w-4 h-4" />
          </div>
        </div>
      )}
    </div>
  );

  const inlineBar = (
    <div
      className="w-full max-w-[300px] flex items-center gap-2 px-3 py-2.5 bg-white border border-border/80 shadow-sm"
      style={{ borderRadius: `${style.borderRadius}px` }}
    >
      <div
        className="flex-1 px-3 py-2 text-sm text-[#a1a1aa]"
        style={{
          background: "#f4f4f5",
          borderRadius: `${inputRadius}px`,
        }}
      >
        Type a message...
      </div>
      <div
        className="w-9 h-9 flex items-center justify-center shrink-0"
        style={{
          background: style.primaryColor,
          color: style.textColor,
          borderRadius: `${inputRadius}px`,
        }}
      >
        <ArrowRight className="w-4 h-4" />
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-border/70 overflow-hidden bg-input-background shadow-sm">
      <div className="flex items-center gap-2.5 px-3 py-2.5 bg-muted/50">
        <div className="flex items-center gap-1.5 shrink-0" aria-hidden>
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/90" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/90" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]/90" />
        </div>
        <div className="flex-1 flex items-center gap-2 min-w-0 px-3 py-1.5 rounded-lg bg-background text-xs text-muted-foreground">
          <Globe className="w-3.5 h-3.5 shrink-0 text-muted-foreground/80" />
          <span className="truncate">{domain}</span>
        </div>
      </div>

      <div
        className={`relative min-h-[320px] p-4 bg-gradient-to-b from-muted/15 to-muted/35 flex ${
          isInline ? "flex-col items-center justify-end gap-2" : viewportAlign
        }`}
      >
        {chatPanel}
        {isInline && inlineBar}
      </div>
    </div>
  );
}

function Step3({
  style,
  onChange,
  onNext,
  onBack,
  projectId,
  websiteUrl,
}: {
  style: WidgetStyle;
  onChange: (style: WidgetStyle) => void;
  onNext: () => void;
  onBack: () => void;
  projectId: string;
  websiteUrl: string;
}) {
  const saveMutation = useMutation({
    mutationFn: async () => {
      const widgetRes = await fetch(`/api/onboarding/${projectId}/widget`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(style),
      });
      if (!widgetRes.ok) throw new Error("Failed to save widget config");

      const completeRes = await fetch(`/api/onboarding/${projectId}/complete`, {
        method: "POST",
      });
      if (!completeRes.ok) throw new Error("Failed to complete onboarding");
    },
    onSuccess: onNext,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl glow-surface flex items-center justify-center shrink-0">
          <Palette className="w-6 h-6 text-brand" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground">
            Style your widget
          </h2>
          <p className="text-sm text-muted-foreground">
            Match the chat widget to your brand
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Brand Color
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLOR_PRESETS.map((color) => {
                const isSelected = style.primaryColor === color;
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() =>
                      onChange({ ...style, primaryColor: color })
                    }
                    className={`w-6 h-6 rounded-md transition-all flex items-center justify-center ${
                      isSelected ? "" : "hover:scale-105"
                    }`}
                    style={{
                      backgroundColor: color,
                      boxShadow: isSelected
                        ? `0 0 0 2px var(--background), 0 0 0 4px ${color}`
                        : undefined,
                    }}
                    title={color}
                  >
                    {isSelected && (
                      <Check className="w-3 h-3 text-white drop-shadow-sm" />
                    )}
                  </button>
                );
              })}
              <ColorPicker
                value={style.primaryColor}
                onChange={(color) =>
                  onChange({
                    ...style,
                    primaryColor: color,
                  })
                }
                className={`h-6 w-6 min-w-6 shrink-0 gap-0 rounded-md border-2 border-dashed p-0 [&>span:first-child]:size-full [&>span:first-child]:rounded-md [&>span:nth-child(2)]:hidden [&>svg]:hidden ${
                  !COLOR_PRESETS.includes(
                    style.primaryColor as (typeof COLOR_PRESETS)[number],
                  )
                    ? "border-foreground/30"
                    : "border-input"
                }`}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Brand Text
            </label>
            <ColorPicker
              value={style.textColor}
              onChange={(color) =>
                onChange({
                  ...style,
                  textColor: color,
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              Text on buttons and visitor messages.
            </p>
          </div>

          {/* Border Radius */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Border Radius: {style.borderRadius}px
            </label>
            <input
              type="range"
              min="0"
              max="50"
              value={style.borderRadius}
              onChange={(e) =>
                onChange({
                  ...style,
                  borderRadius: Number(e.target.value),
                })
              }
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Sharp</span>
              <span>Rounded</span>
            </div>
          </div>

          {/* Font */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Font Family
            </label>
            <Select
              value={style.fontFamily}
              onValueChange={(val) =>
                onChange({ ...style, fontFamily: val })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a font" />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map((font) => (
                  <SelectItem key={font.value} value={font.value}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Placement
            </label>
            <Select
              value={style.position}
              onValueChange={(val) =>
                onChange({
                  ...style,
                  position: val as WidgetPosition,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select placement" />
              </SelectTrigger>
              <SelectContent>
                {WIDGET_POSITIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <WidgetStylePreview style={style} websiteUrl={websiteUrl} />
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="flex-1"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Step 4: Choose Plan ──────────────────────────────────────────────────────

function celebrateCheckout() {
  const colors = ["#f97316", "#fb923c", "#2563eb", "#ffffff"];
  const duration = 2200;
  const end = Date.now() + duration;

  confetti({
    particleCount: 80,
    spread: 72,
    origin: { y: 0.55 },
    colors,
  });

  function burst() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 50,
      origin: { x: 0, y: 0.55 },
      colors,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 50,
      origin: { x: 1, y: 0.55 },
      colors,
    });
    if (Date.now() < end) {
      requestAnimationFrame(burst);
    }
  }

  burst();
}

function Step5({
  onBack,
}: {
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: subData } = useSubscription();
  const [selectedPlan, setSelectedPlan] = useState<
    "starter" | "standard" | "business"
  >("standard");
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [portalPending, setPortalPending] = useState(false);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("annual");

  const [searchParams] = useSearchParams();
  const isStripeReturn = searchParams.get("checkout") === "success";
  const isCelebratePreview = searchParams.get("celebrate") === "1";
  const showCelebration = isStripeReturn || isCelebratePreview;

  const currentPlan = subData?.subscription?.plan as "starter" | "standard" | "business" | undefined;
  const currentInterval = subData?.subscription?.interval as "monthly" | "annual" | undefined;
  const confettiFired = useRef(false);

  useEffect(() => {
    if (currentPlan) setSelectedPlan(currentPlan);
  }, [currentPlan]);

  useEffect(() => {
    if (currentInterval) setBillingInterval(currentInterval);
  }, [currentInterval]);

  useEffect(() => {
    if (!showCelebration) return;

    if (!confettiFired.current) {
      confettiFired.current = true;
      celebrateCheckout();
    }

    if (isCelebratePreview) return;

    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    const nextUrl = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ""}`;
    window.history.replaceState({}, "", nextUrl);

    queryClient.invalidateQueries({ queryKey: ["subscription"] });

    const timer = setTimeout(() => {
      navigate("/app", { replace: true });
    }, 2800);
    return () => clearTimeout(timer);
  }, [
    showCelebration,
    isCelebratePreview,
    queryClient,
    navigate,
  ]);

  async function handleManagePlan() {
    setPortalPending(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/app/onboarding?step=3`,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create portal session");
      }

      const data = (await res.json()) as { url: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setPortalPending(false);
      }
    } catch (err) {
      console.error("Portal error:", err);
      setPortalPending(false);
    }
  }

  async function handleStartTrial() {
    setCheckoutPending(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: selectedPlan,
          interval: billingInterval,
          successUrl: `${window.location.origin}/app/onboarding?step=3&checkout=success`,
          cancelUrl: `${window.location.origin}/app/onboarding?step=3`,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create checkout session");
      }

      const data = (await res.json()) as { url: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setCheckoutPending(false);
      }
    } catch (err) {
      console.error("Checkout error:", err);
      setCheckoutPending(false);
    }
  }

  if (showCelebration) {
    return (
      <div className="flex flex-col items-center text-center py-16 space-y-4">
        <div className="w-16 h-16 rounded-2xl glow-surface flex items-center justify-center">
          <Check className="w-8 h-8 text-brand" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-foreground">Welcome aboard!</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            {isCelebratePreview
              ? "Preview mode — confetti only, no redirect."
              : "Your trial has started. Taking you to the dashboard..."}
          </p>
        </div>
        {isCelebratePreview ? (
          <Button
            variant="outline"
            onClick={() => navigate("/app/onboarding?step=3", { replace: true })}
            className="mt-2"
          >
            Back to plan step
          </Button>
        ) : (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mt-2" />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header row: icon + title left, toggle right */}
      <div className="flex items-start flex-col md:flex-row justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl glow-surface flex items-center justify-center shrink-0">
            <CreditCard className="w-6 h-6 text-brand" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-foreground">
              {currentPlan ? "Your Plan" : "Start your free trial"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {currentPlan
                ? "You're already subscribed. Manage or change your plan below."
                : "7-day free trial, cancel anytime."}
            </p>
          </div>
        </div>
        <BillingToggle interval={billingInterval} onChange={setBillingInterval} />
      </div>

      <PricingCardsSelect
        selectedPlan={selectedPlan}
        onSelectedPlanChange={setSelectedPlan}
        interval={billingInterval}
        currentPlan={currentPlan}
        currentInterval={currentInterval}
      />

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        {currentPlan ? (
          <Button
            onClick={handleManagePlan}
            disabled={portalPending}
            className="flex-1"
          >
            {portalPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Redirecting...
              </>
            ) : (
              <>
                {getCtaLabel(
                  selectedPlan,
                  billingInterval,
                  currentPlan,
                  currentInterval,
                )}
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        ) : (
          <Button
            onClick={handleStartTrial}
            disabled={checkoutPending}
            className="flex-1"
          >
            {checkoutPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Redirecting...
              </>
            ) : (
              <>
                Start 7-day free trial
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Onboarding Skeleton ──────────────────────────────────────────────────────

function OnboardingSkeleton() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 flex flex-col px-6">
        <div className="flex-[2] min-h-0 shrink" aria-hidden />
        <div className={`${ONBOARDING_CONTENT_CLASS} space-y-8`}>
          {/* Title area */}
          <div className="space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-96" />
          </div>

          {/* Form fields */}
          <div className="space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          </div>

          {/* Button */}
          <div className="flex justify-end">
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>
        </div>
        <div className="flex-[3] min-h-0 shrink" aria-hidden />
      </main>
    </div>
  );
}

// ─── Main Onboarding Component ────────────────────────────────────────────────

interface ExistingProject {
  id: string;
  slug: string;
  name: string;
  onboarded: boolean;
}

function Onboarding() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [autoCheckoutPending, setAutoCheckoutPending] = useState(false);

  // ─── URL-based step tracking ──────────────────────────────────────────────
  const rawStepParam = searchParams.get("step");
  const parsedStep = rawStepParam !== null ? parseInt(rawStepParam, 10) : null;
  // step is null until we've determined the correct one from data
  const step = parsedStep !== null && !isNaN(parsedStep) && parsedStep >= 0 && parsedStep <= 3
    ? parsedStep
    : null;
  // Track whether step has been resolved (either from URL or from data)
  const [stepResolved, setStepResolved] = useState(step !== null);

  const setStep = useCallback(
    (newStep: number) => {
      setStepResolved(true);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("step", String(newStep));
          next.delete("checkout");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Auto-fire Stripe checkout if landing page passed plan + interval params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const plan = params.get("plan");
    const interval = params.get("interval");

    if (
      plan &&
      interval &&
      ["starter", "standard", "business"].includes(plan) &&
      ["monthly", "annual"].includes(interval)
    ) {
      // Clean URL params immediately
      const url = new URL(window.location.href);
      url.searchParams.delete("plan");
      url.searchParams.delete("interval");
      window.history.replaceState({}, "", url.pathname);

      setAutoCheckoutPending(true);
      fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          interval,
          successUrl: `${window.location.origin}/app/onboarding`,
          cancelUrl: `${window.location.origin}/app/onboarding`,
        }),
      })
        .then((res) => res.json() as Promise<{ url?: string }>)
        .then((data) => {
          if (data.url) {
            window.location.href = data.url;
          } else {
            setAutoCheckoutPending(false);
          }
        })
        .catch(() => setAutoCheckoutPending(false));
    }
  }, []);

  // Check for existing projects to resume incomplete onboarding
  const { data: existingProjects, isPending: projectsLoading } = useQuery<ExistingProject[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  // Determine the correct step once projects data loads
  useEffect(() => {
    if (!existingProjects) return;
    // If step is already resolved from the URL, only handle project resumption
    if (stepResolved) {
      // Still need to populate projectId/slug for incomplete projects
      const incomplete = existingProjects.find((p) => !p.onboarded);
      if (incomplete && !projectId) {
        setProjectId(incomplete.id);
      } else if (existingProjects.length > 0 && !projectId && step === 3) {
        const latestProject = existingProjects[existingProjects.length - 1];
        if (latestProject) {
          setProjectId(latestProject.id);
        }
      }
      return;
    }

    // Step not yet in URL — determine it from data
    const checkoutParam = searchParams.get("checkout");
    const incomplete = existingProjects.find((p) => !p.onboarded);

    // Incomplete project: bind projectId and let the settings effect pick step 1/2
    if (incomplete) {
      if (!projectId) {
        setProjectId(incomplete.id);
      }
      if (checkoutParam === "success") {
        setStep(3);
      }
      return;
    }

    if (existingProjects.length > 0 && checkoutParam === "success") {
      // User has onboarded projects but came back from Stripe
      const latestProject = existingProjects[existingProjects.length - 1];
      if (latestProject) {
        setProjectId(latestProject.id);
        setStep(3);
      }
      return;
    }

    // No existing projects — fresh onboarding
    setStep(0);
  }, [existingProjects, projectId, stepResolved, step, searchParams, setStep]);

  // Step 1 state
  const [websiteUrl, setWebsiteUrl] = useState("");

  // Pre-fill step 1 data when resuming an existing project
  const { data: projectData } = useQuery<{
    name: string;
    domain: string | null;
  }>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: settingsData } = useQuery<{
    companyName: string | null;
    companyUrl: string | null;
    industry: string | null;
    companyContext: string | null;
  }>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
    enabled: !!projectId,
  });

  // Infer resume step once project settings are available
  useEffect(() => {
    if (!projectId || !settingsData || stepResolved) return;

    const incomplete = existingProjects?.find(
      (project) => !project.onboarded && project.id === projectId,
    );
    if (!incomplete) return;

    if (searchParams.get("checkout") === "success") {
      setStep(3);
      return;
    }

    setStep(hasSavedCompanyProfile(settingsData) ? 2 : 1);
  }, [
    projectId,
    settingsData,
    stepResolved,
    existingProjects,
    searchParams,
    setStep,
  ]);

  // Step 2 state — AI-generated company profile, reviewed by the user
  const [profile, setProfile] = useState<CompanyProfile>({
    websiteName: "",
    companyName: "",
    industry: "",
    context: "",
  });

  useEffect(() => {
    if (!projectData || !settingsData) return;
    if (!websiteUrl) {
      setWebsiteUrl(
        settingsData.companyUrl ??
        (projectData.domain ? `https://${projectData.domain}` : ""),
      );
    }
    // Pre-fill the profile if it hasn't been touched yet
    const isEmpty =
      !profile.websiteName &&
      !profile.companyName &&
      !profile.industry &&
      !profile.context;
    if (isEmpty) {
      // Project creation names the project after its hostname as a
      // placeholder — don't surface that as the website name.
      const placeholderName = projectData.domain?.replace(/^www\./, "");
      setProfile({
        websiteName:
          projectData.name && projectData.name !== placeholderName
            ? projectData.name
            : "",
        companyName: settingsData.companyName ?? "",
        industry: settingsData.industry ?? "",
        context: settingsData.companyContext ?? "",
      });
    }
  }, [projectData, settingsData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 3 state
  const [widgetStyle, setWidgetStyle] = useState<WidgetStyle>({
    primaryColor: "#2563eb",
    textColor: "#ffffff",
    borderRadius: 16,
    fontFamily: "system-ui",
    position: "bottom-right",
  });

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      const trimmed = websiteUrl.trim();
      const normalizedUrl = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: normalizedUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          (data as { error?: string }).error ?? "Failed to create project",
        );
      }
      return res.json() as Promise<{ projectId: string; slug: string }>;
    },
    onSuccess: (data) => {
      setProjectId(data.projectId);
      setStep1Error(null);
      setStep(1);
    },
    onError: (err) => {
      setStep1Error(err.message);
    },
  });

  const handleStep1Next = useCallback(() => {
    createProjectMutation.mutate();
  }, [createProjectMutation]);

  // Show loading screen while auto-checkout redirect is in progress
  if (autoCheckoutPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Setting up your trial...</p>
        </div>
      </div>
    );
  }

  // Show skeleton until projects data loads and step is determined
  if (projectsLoading || step === null) {
    return <OnboardingSkeleton />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 flex flex-col px-6">
        <div className="flex-[2] min-h-0 shrink" aria-hidden />
        <div className={ONBOARDING_CONTENT_CLASS}>
          {step === 0 && (
            <Step1
              websiteUrl={websiteUrl}
              onChange={setWebsiteUrl}
              onNext={handleStep1Next}
              isPending={createProjectMutation.isPending}
              error={step1Error}
            />
          )}
          {step === 1 && projectId && (
            <Step2
              projectId={projectId}
              profile={profile}
              setProfile={setProfile}
              onNext={() => setStep(2)}
              onBack={() => setStep(0)}
              settingsReady={!!settingsData}
              hasExistingProfile={hasSavedCompanyProfile(settingsData)}
            />
          )}
          {step === 2 && projectId && (
            <Step3
              style={widgetStyle}
              onChange={setWidgetStyle}
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
              projectId={projectId}
              websiteUrl={websiteUrl}
            />
          )}
          {step === 3 && (
            <Step5 onBack={() => setStep(2)} />
          )}
        </div>
        <div className="flex-[3] min-h-0 shrink" aria-hidden />
      </main>
    </div>
  );
}

export default Onboarding;
