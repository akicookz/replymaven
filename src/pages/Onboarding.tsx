import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@/hooks/use-subscription";
import {
  Globe,
  Building2,
  Sparkles,
  Palette,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
  Copy,
  AlertCircle,
  CreditCard,
  MessageSquare,
  LogOut,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { PricingCardsSelect, BillingToggle } from "@/components/PricingCards";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/color-picker";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Constants ────────────────────────────────────────────────────────────────

const INDUSTRIES = [
  "SaaS",
  "E-commerce",
  "Healthcare",
  "Education",
  "Real Estate",
  "Finance & Banking",
  "Agency & Consulting",
  "Restaurant & Food",
  "Travel & Hospitality",
  "Fitness & Wellness",
  "Legal",
  "Non-profit",
  "Media & Entertainment",
  "Retail",
  "Technology",
  "Other",
] as const;

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

const FONT_OPTIONS = [
  { value: "system-ui", label: "System Default" },
  { value: "Inter", label: "Inter" },
  { value: "DM Sans", label: "DM Sans" },
  { value: "Plus Jakarta Sans", label: "Plus Jakarta Sans" },
  { value: "Space Grotesk", label: "Space Grotesk" },
  { value: "JetBrains Mono", label: "JetBrains Mono" },
] as const;

const STEPS = [
  { label: "Company", icon: Building2 },
  { label: "Context", icon: Sparkles },
  { label: "Widget", icon: Palette },
  { label: "Test", icon: MessageSquare },
  { label: "Plan", icon: CreditCard },
] as const;



// ─── Step 1: Company Info ─────────────────────────────────────────────────────

interface Step1Data {
  websiteName: string;
  websiteUrl: string;
  companyName: string;
  industry: string;
}

function Step1({
  data,
  onChange,
  onNext,
  isPending,
  error,
}: {
  data: Step1Data;
  onChange: (data: Step1Data) => void;
  onNext: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const isValid =
    data.websiteName.trim() &&
    data.websiteUrl.trim() &&
    data.companyName.trim() &&
    data.industry;

  const continueButton = (
    <Button
      onClick={onNext}
      disabled={!isValid || isPending}
    >
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
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl glow-surface flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6 text-brand" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-foreground">
              Tell us about your business
            </h2>
            <p className="text-sm text-muted-foreground">
              We'll use this to set up your AI support agent
            </p>
          </div>
        </div>
        <div className="hidden md:block shrink-0">
          {continueButton}
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Website Name
          </label>
          <input
            type="text"
            value={data.websiteName}
            onChange={(e) =>
              onChange({ ...data, websiteName: e.target.value })
            }
            placeholder="My Awesome App"
            className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Website URL
          </label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="url"
              value={data.websiteUrl}
              onChange={(e) =>
                onChange({ ...data, websiteUrl: e.target.value })
              }
              placeholder="https://example.com"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Company Name
          </label>
          <input
            type="text"
            value={data.companyName}
            onChange={(e) =>
              onChange({ ...data, companyName: e.target.value })
            }
            placeholder="Acme Inc."
            className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Industry
          </label>
          <Select
            value={data.industry}
            onValueChange={(val) =>
              onChange({ ...data, industry: val })
            }
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
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="md:hidden">
        {continueButton}
      </div>
    </div>
  );
}

// ─── Step 2: Site Context ─────────────────────────────────────────────────────

function Step2({
  projectId,
  context,
  setContext,
  onNext,
  onBack,
}: {
  projectId: string;
  context: string;
  setContext: (ctx: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [scraped, setScraped] = useState<boolean | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const hasFired = useRef(false);
  const skippedRef = useRef(false);

  const scrapeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/onboarding/${projectId}/scrape`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to scrape");
      return res.json() as Promise<{ context: string; scraped: boolean }>;
    },
    onSuccess: (data) => {
      if (skippedRef.current) return;
      setScraped(data.scraped);
      if (data.scraped && data.context) {
        setContext(data.context);
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
        body: JSON.stringify({ companyContext: context }),
      });
      if (!res.ok) throw new Error("Failed to save context");
    },
  });

  // Fire scrape on mount — skip if context is already pre-filled
  useEffect(() => {
    if (!hasFired.current) {
      hasFired.current = true;
      if (context.trim()) {
        setScraped(true);
      } else {
        scrapeMutation.mutate();
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleContinue() {
    if (isEditing || !scraped) {
      saveContextMutation.mutate(undefined, { onSuccess: onNext });
    } else {
      onNext();
    }
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
                We're crawling your site to build your agent's knowledge base
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
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
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
        <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-3">
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
          <Sparkles className="w-6 h-6 text-brand" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground">
            {scraped
              ? "Here's what we found"
              : "Tell us about your business"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {scraped
              ? "Review the context we built from your site. Edit if needed."
              : "We couldn't extract much from your site. Describe your business so your AI agent knows how to help."}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">
            Company Context
          </label>
          {scraped && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-xs text-primary hover:underline"
            >
              Edit
            </button>
          )}
        </div>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          readOnly={scraped === true && !isEditing}
          rows={10}
          placeholder="Describe what your company does, your products/services, pricing, policies, and anything your AI support agent should know..."
          className="w-full px-4 py-3 rounded-xl border border-input bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
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
          disabled={!context.trim() || saveContextMutation.isPending}
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

interface WidgetStyle {
  primaryColor: string;
  borderRadius: number;
  fontFamily: string;
}

function Step3({
  style,
  onChange,
  onNext,
  onBack,
  projectId,
}: {
  style: WidgetStyle;
  onChange: (style: WidgetStyle) => void;
  onNext: () => void;
  onBack: () => void;
  projectId: string;
}) {
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/onboarding/${projectId}/widget`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(style),
      });
      if (!res.ok) throw new Error("Failed to save widget config");
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Controls */}
        <div className="space-y-5">
          {/* Color Presets */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Primary Color
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() =>
                    onChange({ ...style, primaryColor: color })
                  }
                  className="w-8 h-8 rounded-lg border-2 transition-all"
                  style={{
                    backgroundColor: color,
                    borderColor:
                      style.primaryColor === color
                        ? color
                        : "transparent",
                    transform:
                      style.primaryColor === color
                        ? "scale(1.15)"
                        : "scale(1)",
                  }}
                >
                  {style.primaryColor === color && (
                    <Check className="w-4 h-4 text-white mx-auto" />
                  )}
                </button>
              ))}
              <ColorPicker
                value={style.primaryColor}
                onChange={(color) =>
                  onChange({
                    ...style,
                    primaryColor: color,
                  })
                }
                className="w-8 h-8 gap-0 px-0 border-dashed [&>span:first-child]:size-full [&>span:first-child]:rounded-lg [&>span:nth-child(2)]:hidden [&>svg]:hidden"
              />
            </div>
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
        </div>

        {/* Mini Preview */}
        <div className="flex items-center justify-center">
          <div
            className="w-72 shadow-xl overflow-hidden"
            style={{
              borderRadius: `${style.borderRadius}px`,
              fontFamily: style.fontFamily,
              background: "rgba(0,0,0,0.18)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 8px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06)",
            }}
          >
            <div
              className="px-4 py-3 font-medium text-sm text-white"
              style={{
                background: `${style.primaryColor}4d`,
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              Chat with us
            </div>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <div
                  className="w-6 h-6 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: `${style.primaryColor}33`,
                  }}
                />
                <div
                  className="rounded-lg px-3 py-2 text-xs max-w-[80%] text-white"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  Hi there! How can I help you today?
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <div
                  className="rounded-lg px-3 py-2 text-xs max-w-[80%] text-white"
                  style={{ backgroundColor: style.primaryColor }}
                >
                  I have a question about pricing
                </div>
              </div>
            </div>
            <div className="px-4 pb-3">
              <div className="flex gap-2">
                <div
                  className="flex-1 px-3 py-2 text-xs"
                  style={{
                    borderRadius: `${Math.min(style.borderRadius, 12)}px`,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.35)",
                  }}
                >
                  Type a message...
                </div>
                <div
                  className="w-8 h-8 flex items-center justify-center text-white"
                  style={{
                    backgroundColor: style.primaryColor,
                    borderRadius: `${Math.min(style.borderRadius, 12)}px`,
                  }}
                >
                  <ArrowRight className="w-3 h-3" />
                </div>
              </div>
            </div>
          </div>
        </div>
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

// ─── Step 4: Test Your Agent ──────────────────────────────────────────────────

function Step4({
  projectId,
  slug,
  onBack,
  onNext,
}: {
  projectId: string;
  slug: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedQuestion, setCopiedQuestion] = useState(false);
  const [completed, setCompleted] = useState(false);
  const widgetInjected = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const embedCode = `<script src="${window.location.origin}/api/widget-embed.js" data-project="${slug}"></script>`;

  // Fetch sample question
  const { data: sampleData } = useQuery<{ question: string }>({
    queryKey: ["sample-question", projectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/onboarding/${projectId}/sample-question`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/onboarding/${projectId}/complete`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to complete");
    },
    onSuccess: () => {
      setCompleted(true);
    },
  });

  // Inject widget script
  useEffect(() => {
    if (widgetInjected.current) return;
    widgetInjected.current = true;

    const script = document.createElement("script");
    script.src = `/api/widget-embed.js`;
    script.setAttribute("data-project", slug);
    document.body.appendChild(script);

    return () => {
      // Clean up widget on unmount
      script.remove();
      const widgetContainer = document.getElementById("sb-widget-container");
      if (widgetContainer) widgetContainer.remove();
      const widgetStyles = document.getElementById("sb-widget-styles");
      if (widgetStyles) widgetStyles.remove();
    };
  }, [slug]);

  // Poll for conversations
  useEffect(() => {
    if (completed) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/conversations`,
        );
        if (res.ok) {
          const conversations = (await res.json()) as Array<{
            id: string;
          }>;
          if (conversations.length > 0) {
            if (pollRef.current) clearInterval(pollRef.current);
            completeMutation.mutate();
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [completed, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  function copyToClipboard(text: string, type: "embed" | "question") {
    navigator.clipboard.writeText(text);
    if (type === "embed") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopiedQuestion(true);
      setTimeout(() => setCopiedQuestion(false), 2000);
    }
  }

  // Success state — move to plan selection
  if (completed) {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-4 py-8">
          <div className="w-12 h-12 rounded-2xl glow-surface flex items-center justify-center shrink-0">
            <Check className="w-6 h-6 text-brand" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-foreground">
              Your AI customer support agent is live
            </h2>
            <p className="text-sm text-muted-foreground">
              Start your free trial to go live on your website.
            </p>
          </div>
        </div>
        <Button onClick={onNext} className="w-full">
          Start your free trial
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl glow-surface flex items-center justify-center shrink-0">
          <MessageSquare className="w-6 h-6 text-brand" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground">
            Test your AI agent
          </h2>
          <p className="text-sm text-muted-foreground">
            Send a test message to see your AI agent in action
          </p>
        </div>
      </div>

      {/* Embed Code */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Embed Code
        </label>
        <div className="relative">
          <pre className="px-4 py-3 rounded-xl bg-muted/50 border border-border text-xs font-mono overflow-x-auto text-foreground">
            {embedCode}
          </pre>
          <button
            type="button"
            onClick={() => copyToClipboard(embedCode, "embed")}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-background/80 border border-border hover:bg-muted transition-colors"
            title="Copy embed code"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-600" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Add this snippet to your website's HTML to embed the chat widget.
        </p>
      </div>

      {/* Sample Question */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Try sending this message
        </label>
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/5 border border-primary/20">
          <p className="flex-1 text-sm text-foreground">
            {sampleData?.question ?? "Loading a question for you..."}
          </p>
          {sampleData?.question && (
            <button
              type="button"
              onClick={() =>
                copyToClipboard(sampleData.question, "question")
              }
              className="shrink-0 p-1.5 rounded-lg hover:bg-primary/10 transition-colors"
              title="Copy question"
            >
              {copiedQuestion ? (
                <Check className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4 text-primary" />
              )}
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Copy this message and paste it into the chat widget in the bottom
          right corner.
        </p>
      </div>

      {/* Waiting indicator */}
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Waiting for your first message...
      </div>

      <Button variant="outline" onClick={onBack} className="w-full md:w-auto">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back
      </Button>
    </div>
  );
}

// ─── Step 5: Choose Plan ──────────────────────────────────────────────────────

function Step5({
  onBack,
}: {
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: subData } = useSubscription();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("annual");

  // Check if returning from Stripe Checkout
  const searchParams = new URLSearchParams(window.location.search);
  const checkoutSuccess = searchParams.get("checkout") === "success";

  const currentPlan = subData?.subscription?.plan as "starter" | "standard" | "business" | undefined;
  const currentInterval = subData?.subscription?.interval as "monthly" | "annual" | undefined;

  useEffect(() => {
    if (checkoutSuccess) {
      // Clean up URL params
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      const nextUrl = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ""}`;
      window.history.replaceState({}, "", nextUrl);

      // Invalidate subscription cache so OnboardingGuard sees the new subscription
      queryClient.invalidateQueries({ queryKey: ["subscription"] });

      // Auto-redirect to dashboard after a brief delay
      const timer = setTimeout(() => {
        navigate("/app", { replace: true });
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [checkoutSuccess, queryClient, navigate]);

  async function handleSelectPlan(plan: "starter" | "standard" | "business", interval: "monthly" | "annual") {
    setLoadingPlan(plan);
    try {

      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          interval,
          successUrl: `${window.location.origin}/app/onboarding?step=4&checkout=success`,
          cancelUrl: `${window.location.origin}/app/onboarding?step=4`,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create checkout session");
      }

      const data = (await res.json()) as { url: string };
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Checkout error:", err);
      setLoadingPlan(null);
    }
  }

  function handleManagePlan() {
    navigate("/app/account");
  }

  if (checkoutSuccess) {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-4 py-8">
          <div className="w-12 h-12 rounded-2xl glow-surface flex items-center justify-center shrink-0">
            <Check className="w-6 h-6 text-brand" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-foreground">Welcome aboard!</h2>
            <p className="text-sm text-muted-foreground">
              Your trial has started. Redirecting you to the dashboard...
            </p>
          </div>
        </div>
        <Button onClick={() => navigate("/app", { replace: true })} className="w-full md:w-auto">
          Go to Dashboard
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
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
        onSelectPlan={handleSelectPlan}
        loadingPlan={loadingPlan}
        interval={billingInterval}
        currentPlan={currentPlan}
        currentInterval={currentInterval}
        onManagePlan={handleManagePlan}
      />

      {currentPlan ? (
        <Button onClick={() => navigate("/app", { replace: true })} className="w-full md:w-auto">
          Go to Dashboard
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      ) : (
        <Button variant="outline" onClick={onBack} className="w-full md:w-auto">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      )}
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {STEPS.map((step, i) => {
        const StepIcon = step.icon;
        const isActive = i === currentStep;
        const isCompleted = i < currentStep;

        return (
          <div key={step.label} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${isActive
                ? "bg-primary text-primary-foreground"
                : isCompleted
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
                }`}
            >
              {isCompleted ? (
                <Check className="w-3 h-3" />
              ) : (
                <StepIcon className="w-3 h-3" />
              )}
              <span className="hidden sm:inline">{step.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-6 h-px transition-colors ${isCompleted ? "bg-primary" : "bg-border"
                  }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Onboarding Skeleton ──────────────────────────────────────────────────────

function OnboardingSkeleton() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Logo size="md" />
          {/* Skeleton progress bar */}
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2">
                <Skeleton className="h-7 w-20 rounded-full" />
                {i < STEPS.length - 1 && (
                  <div className="w-6 h-px bg-border" />
                )}
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* Content skeleton */}
      <main className="flex-1 flex items-start justify-center px-6 py-12">
        <div className="w-full max-w-2xl space-y-8">
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectSlug, setProjectSlug] = useState<string | null>(null);
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [autoCheckoutPending, setAutoCheckoutPending] = useState(false);

  // ─── URL-based step tracking ──────────────────────────────────────────────
  const rawStepParam = searchParams.get("step");
  const parsedStep = rawStepParam !== null ? parseInt(rawStepParam, 10) : null;
  // step is null until we've determined the correct one from data
  const step = parsedStep !== null && !isNaN(parsedStep) && parsedStep >= 0 && parsedStep <= 4
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
        setProjectSlug(incomplete.slug);
      } else if (existingProjects.length > 0 && !projectId && step === 4) {
        const latestProject = existingProjects[existingProjects.length - 1];
        if (latestProject) {
          setProjectId(latestProject.id);
          setProjectSlug(latestProject.slug);
        }
      }
      return;
    }

    // Step not yet in URL — determine it from data
    const checkoutParam = searchParams.get("checkout");

    // If there's an incomplete project, resume it
    const incomplete = existingProjects.find((p) => !p.onboarded);
    if (incomplete && !projectId) {
      setProjectId(incomplete.id);
      setProjectSlug(incomplete.slug);

      if (checkoutParam === "success") {
        setStep(4);
      } else {
        setStep(1);
      }
    } else if (existingProjects.length > 0 && checkoutParam === "success") {
      // User has onboarded projects but came back from Stripe
      const latestProject = existingProjects[existingProjects.length - 1];
      if (latestProject) {
        setProjectId(latestProject.id);
        setProjectSlug(latestProject.slug);
        setStep(4);
      }
    } else {
      // No existing projects, fresh onboarding
      setStep(0);
    }
  }, [existingProjects, projectId, stepResolved, step, searchParams, setStep]);

  // Step 1 state
  const [step1Data, setStep1Data] = useState<Step1Data>({
    websiteName: "",
    websiteUrl: "",
    companyName: "",
    industry: "",
  });

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

  useEffect(() => {
    if (!projectData || !settingsData) return;
    const isEmpty =
      !step1Data.websiteName &&
      !step1Data.websiteUrl &&
      !step1Data.companyName &&
      !step1Data.industry;
    if (isEmpty) {
      setStep1Data({
        websiteName: projectData.name ?? "",
        websiteUrl:
          settingsData.companyUrl ??
          (projectData.domain ? `https://${projectData.domain}` : ""),
        companyName: settingsData.companyName ?? "",
        industry: settingsData.industry ?? "",
      });
    }
    // Also pre-fill context if available and not already set
    if (!context && settingsData.companyContext) {
      setContext(settingsData.companyContext);
    }
  }, [projectData, settingsData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 2 state
  const [context, setContext] = useState("");

  // Step 3 state
  const [widgetStyle, setWidgetStyle] = useState<WidgetStyle>({
    primaryColor: "#2563eb",
    borderRadius: 16,
    fontFamily: "system-ui",
  });

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(step1Data),
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
      setProjectSlug(data.slug);
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
      {/* Header */}
      <header className="px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Logo size="md" />
          <div className="flex items-center gap-4">
            <ProgressBar currentStep={step} />
            <button
              type="button"
              onClick={async () => {
                await signOut();
                navigate("/");
              }}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center px-6 py-12">
        <div className="w-full max-w-6xl">
          {step === 0 && (
            <Step1
              data={step1Data}
              onChange={setStep1Data}
              onNext={handleStep1Next}
              isPending={createProjectMutation.isPending}
              error={step1Error}
            />
          )}
          {step === 1 && projectId && (
            <Step2
              projectId={projectId}
              context={context}
              setContext={setContext}
              onNext={() => setStep(2)}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && projectId && (
            <Step3
              style={widgetStyle}
              onChange={setWidgetStyle}
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
              projectId={projectId}
            />
          )}
          {step === 3 && projectId && projectSlug && (
            <Step4
              projectId={projectId}
              slug={projectSlug}
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
            />
          )}
          {step === 4 && (
            <Step5 onBack={() => setStep(3)} />
          )}
        </div>
      </main>
    </div>
  );
}

export default Onboarding;
