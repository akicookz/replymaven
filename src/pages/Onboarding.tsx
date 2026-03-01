import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Globe,
  Building2,
  Sparkles,
  Palette,
  MessageSquare,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
  Copy,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/color-picker";

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

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Building2 className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground">
          Tell us about your business
        </h2>
        <p className="text-sm text-muted-foreground">
          We'll use this to set up your AI support agent
        </p>
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

      <Button
        onClick={onNext}
        disabled={!isValid || isPending}
        className="w-full"
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
  const hasFired = useRef(false);

  const scrapeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/onboarding/${projectId}/scrape`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to scrape");
      return res.json() as Promise<{ context: string; scraped: boolean }>;
    },
    onSuccess: (data) => {
      setScraped(data.scraped);
      if (data.scraped && data.context) {
        setContext(data.context);
      }
    },
    onError: () => {
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

  useEffect(() => {
    if (!hasFired.current) {
      hasFired.current = true;
      scrapeMutation.mutate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleContinue() {
    if (isEditing || !scraped) {
      saveContextMutation.mutate(undefined, { onSuccess: onNext });
    } else {
      onNext();
    }
  }

  // Loading state
  if (scrapeMutation.isPending) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-4 py-12">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-foreground">
              Scanning your website...
            </h2>
            <p className="text-sm text-muted-foreground">
              We're analyzing your site to build your bot's knowledge base
            </p>
          </div>
          <div className="flex justify-center gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-primary/40 animate-pulse"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
        </div>
        <Button variant="ghost" onClick={onBack} className="w-full">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground">
          {scraped
            ? "Here's what we found"
            : "Tell us about your business"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {scraped
            ? "Review the context we built from your site. Edit if needed."
            : "We couldn't extract much from your site. Describe your business so the bot knows how to help."}
        </p>
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
          placeholder="Describe what your company does, your products/services, pricing, policies, and anything your support bot should know..."
          className="w-full px-4 py-3 rounded-xl border border-input bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
        <p className="text-xs text-muted-foreground">
          This context helps your bot answer questions accurately.
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
      <div className="text-center space-y-2">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Palette className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground">
          Style your widget
        </h2>
        <p className="text-sm text-muted-foreground">
          Match the chat widget to your brand
        </p>
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

// ─── Step 4: Test Your Bot ────────────────────────────────────────────────────

function Step4({
  projectId,
  slug,
  onBack,
}: {
  projectId: string;
  slug: string;
  onBack: () => void;
}) {
  const navigate = useNavigate();
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

  // Success state
  if (completed) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-4 py-8">
          <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-foreground">
              You're all set!
            </h2>
            <p className="text-sm text-muted-foreground">
              Your AI support bot is live and ready to help your customers.
            </p>
          </div>
        </div>
        <Button onClick={() => navigate("/app")} className="w-full">
          Go to Dashboard
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <MessageSquare className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground">
          Test your bot
        </h2>
        <p className="text-sm text-muted-foreground">
          Send your first message to complete the setup
        </p>
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

      <Button variant="outline" onClick={onBack} className="w-full">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back
      </Button>
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                isActive
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
                className={`w-6 h-px transition-colors ${
                  isCompleted ? "bg-primary" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
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
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectSlug, setProjectSlug] = useState<string | null>(null);
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // Check for existing projects to resume incomplete onboarding
  const { data: existingProjects } = useQuery<ExistingProject[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  useEffect(() => {
    if (!existingProjects) return;

    // If there's an incomplete project, resume it at step 1
    const incomplete = existingProjects.find((p) => !p.onboarded);
    if (incomplete && !projectId) {
      setProjectId(incomplete.id);
      setProjectSlug(incomplete.slug);
      setStep(1);
    }
  }, [existingProjects, projectId]);

  // Step 1 state
  const [step1Data, setStep1Data] = useState<Step1Data>({
    websiteName: "",
    websiteUrl: "",
    companyName: "",
    industry: "",
  });

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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">ReplyMaven</span>
          </div>
          <ProgressBar currentStep={step} />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center px-6 py-12">
        <div className="w-full max-w-xl">
          <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-8">
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
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default Onboarding;
