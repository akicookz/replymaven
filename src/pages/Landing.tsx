import { useState } from "react";
import { Link } from "react-router-dom";
import {
  MessageSquare,
  Globe,
  Bot,
  Code,
  FileText,
  Palette,
  BarChart3,
  Check,
  ChevronDown,
  ArrowRight,
  Sparkles,
  Clock,
  Send,
  Users,
  Zap,
  Twitter,
  Linkedin,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── FAQ Data ─────────────────────────────────────────────────────────────────

const faqItems = [
  {
    question: "How long does setup take?",
    answer:
      "Most teams are live in under 5 minutes. Add your knowledge sources, customize the look, copy one script tag onto your site, and you're done. No engineering work required.",
  },
  {
    question: "How accurate are the AI responses?",
    answer:
      "ReplyMaven uses retrieval-augmented generation (RAG) over your actual knowledge base -- docs, FAQs, and web pages you provide. The AI only answers from your content, so responses are grounded and accurate. When confidence is low, it automatically hands off to a human.",
  },
  {
    question: "Can I customize the widget's appearance?",
    answer:
      "Completely. You control colors, fonts, border radius, position, header text, avatar, tone of voice, intro message, quick actions, and even inject custom CSS. The widget will look native to your brand.",
  },
  {
    question: "What happens when the bot can't answer?",
    answer:
      "The conversation is seamlessly handed off to a live agent via Telegram. The agent sees the full conversation history and can reply directly -- the visitor sees the response in the same chat window. No context is lost.",
  },
  {
    question: "Is my data secure?",
    answer:
      "Your data stays on Cloudflare's global network. API keys and tokens are AES-GCM encrypted at rest. We don't train on your data or share it with third parties. Each project's knowledge base is fully isolated.",
  },
  {
    question: "Can I try it before committing?",
    answer:
      "Yes. Sign up for free and explore the full dashboard, add resources, and test the widget on your site. No credit card required to get started.",
  },
];

// ─── Pricing Data ─────────────────────────────────────────────────────────────

const pricingPlans = [
  {
    name: "ReplyMaven Essential",
    price: "$19",
    period: "/mo",
    description: "For personal projects and small sites.",
    highlighted: false,
    cta: "Try Essential free",
    features: [
      "1 project",
      "1,000 messages / month",
      "50 knowledge resources",
      "Web page & FAQ indexing",
      "Widget customization",
      "Email support",
    ],
  },
  {
    name: "ReplyMaven Startup",
    price: "$49",
    period: "/mo",
    description: "For growing teams that need more power.",
    highlighted: true,
    badge: "Save 20%",
    cta: "Get started",
    features: [
      "Everything in Essential",
      "3 projects",
      "5,000 messages / month",
      "PDF indexing",
      "Telegram live agent handoff",
      "Custom tone of voice",
    ],
  },
  {
    name: "ReplyMaven Business",
    price: "$99",
    period: "/mo",
    description: "For teams that run on customer experience.",
    highlighted: false,
    cta: "Contact sales",
    features: [
      "Everything in Startup",
      "10 projects",
      "20,000 messages / month",
      "Auto-drafted canned responses",
      "Custom CSS & branding",
      "Priority support",
    ],
  },
];

// ─── FAQ Accordion Item ───────────────────────────────────────────────────────

function FaqItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-left cursor-pointer group"
      >
        <span className="font-medium text-foreground text-[15px] pr-4 group-hover:text-primary transition-colors">
          {question}
        </span>
        <ChevronDown
          className={`w-5 h-5 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid transition-all duration-200 ease-in-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <p className="pb-5 text-sm text-muted-foreground leading-relaxed">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Mock Chat Widget (compact for hero) ──────────────────────────────────────

function MockChatWidget() {
  return (
    <div className="w-full max-w-[340px] bg-white/70 backdrop-blur-xl rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.08)] overflow-hidden border border-white/50">
      {/* Header */}
      <div className="bg-[#2d5a2d] px-4 py-3.5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <Bot className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-white text-sm font-semibold leading-tight">
            Support Assistant
          </p>
          <p className="text-white/60 text-[11px]">Typically replies instantly</p>
        </div>
      </div>

      {/* Messages */}
      <div className="bg-[#fafaf9] p-4 space-y-3">
        <div className="flex items-end gap-2">
          <div className="w-6 h-6 rounded-full bg-[#2d5a2d] flex items-center justify-center shrink-0">
            <Bot className="w-3 h-3 text-white" />
          </div>
          <div className="bg-white rounded-[16px_16px_16px_4px] px-3.5 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] max-w-[230px]">
            <p className="text-[13px] text-[#1f2937] leading-snug">
              Hi there! How can I help you today?
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <div className="bg-[#2d5a2d] rounded-[16px_16px_4px_16px] px-3.5 py-2.5 max-w-[230px]">
            <p className="text-[13px] text-white leading-snug">
              How do I integrate the widget?
            </p>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="w-6 h-6 rounded-full bg-[#2d5a2d] flex items-center justify-center shrink-0">
            <Bot className="w-3 h-3 text-white" />
          </div>
          <div className="bg-white rounded-[16px_16px_16px_4px] px-3.5 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] max-w-[230px]">
            <p className="text-[13px] text-[#1f2937] leading-snug">
              Just add a single script tag to your HTML. It takes about 30 seconds!
            </p>
            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[#2d5a2d]/50">
              <FileText className="w-2.5 h-2.5" />
              <span>From: Getting Started Guide</span>
            </div>
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-100 px-3 py-2.5 flex items-center gap-2">
        <div className="flex-1 bg-[#f5f5f4] rounded-full px-3.5 py-2 text-[13px] text-gray-400">
          Type a message...
        </div>
        <div className="w-8 h-8 rounded-full bg-[#2d5a2d] flex items-center justify-center">
          <Send className="w-3.5 h-3.5 text-white" />
        </div>
      </div>
    </div>
  );
}

// ─── Mock Dashboard Preview (for feature section) ─────────────────────────────

function MockDashboardPreview() {
  return (
    <div className="bg-white/60 backdrop-blur-xl rounded-xl border border-white/50 p-5 space-y-4 shadow-[0_8px_60px_rgba(0,0,0,0.06)]">
      <p className="text-sm font-semibold text-foreground">Conversations</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">247</p>
              <p className="text-[11px] text-muted-foreground">Today</p>
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">89%</p>
              <p className="text-[11px] text-muted-foreground">Resolved by AI</p>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Analytics</span>
          <span className="text-emerald-600 font-medium">+12.5%</span>
        </div>
        <div className="flex gap-1 items-end h-12">
          {[35, 55, 40, 70, 50, 65, 80, 55, 75, 90, 60, 85].map((h, i) => (
            <div
              key={i}
              className="flex-1 bg-primary/15 rounded-t-sm"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function Landing() {
  return (
    <div className="min-h-screen bg-background scroll-smooth">
      {/* ── Floating Header ──────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-4 px-4">
        <nav className="flex items-center gap-1 bg-white/60 backdrop-blur-xl border border-white/50 rounded-full px-2 py-1.5 shadow-[0_4px_30px_rgba(0,0,0,0.06)]">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 pl-3 pr-4">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <MessageSquare className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground text-[15px] tracking-tight">
              ReplyMaven
            </span>
          </Link>

          {/* Nav links */}
          <div className="hidden md:flex items-center">
            <a
              href="#features"
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Features
            </a>
            <a
              href="#benefits"
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Benefits
            </a>
            <a
              href="#pricing"
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Pricing
            </a>
            <a
              href="#faq"
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              FAQ
            </a>
          </div>

          {/* Spacer */}
          <div className="hidden md:block w-16" />

          {/* CTA */}
          <Link to="/signup">
            <Button className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-5 h-9 text-[13px] font-medium">
              Try ReplyMaven free
            </Button>
          </Link>
        </nav>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="pt-32 pb-20 lg:pt-40 lg:pb-28">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/[0.06] border border-primary/10 text-sm text-primary mb-8">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="font-medium">AI-powered support in minutes</span>
          </div>

          <h1 className="text-[2.75rem] sm:text-[3.5rem] lg:text-[4.25rem] font-bold text-foreground tracking-tight leading-[1.08] mb-6">
            Resolve support tickets,
            <br />
            <span className="text-muted-foreground">powered by your docs</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-10">
            An AI chatbot that actually knows your product. It learns from your docs,
            matches your brand, and embeds on your site in one line of code.
            When it can't help, it hands off to your team.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <Link to="/signup">
              <Button className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-8 h-12 text-[15px] font-medium">
                Start Free
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <a href="#how-it-works">
              <Button
                variant="outline"
                className="rounded-full px-8 h-12 text-[15px]"
              >
                See How It Works
              </Button>
            </a>
          </div>

          <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Check className="w-4 h-4 text-primary" />
              No credit card required
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="w-4 h-4 text-primary" />
              5-minute setup
            </span>
          </div>
        </div>

        {/* Hero visual - widget in browser mockup */}
        <div className="max-w-5xl mx-auto px-6 mt-16">
          <div className="relative">
            <div className="absolute -inset-4 bg-primary/[0.03] rounded-[2rem] blur-2xl" />
            <div className="relative bg-white/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_60px_rgba(0,0,0,0.06)] border border-white/50 p-6 pt-10">
              {/* Browser dots */}
              <div className="absolute top-3 left-5 flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              </div>
              <div className="absolute top-2.5 left-1/2 -translate-x-1/2 bg-white/50 backdrop-blur-sm rounded-lg px-12 py-1.5 text-[11px] text-muted-foreground border border-white/40">
                yoursite.com
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">
                {/* Fake page content */}
                <div className="space-y-4 opacity-20 py-4">
                  <div className="h-6 bg-gray-200 rounded-lg w-2/3" />
                  <div className="h-3 bg-gray-200 rounded-full w-full" />
                  <div className="h-3 bg-gray-200 rounded-full w-4/5" />
                  <div className="h-3 bg-gray-200 rounded-full w-3/4" />
                  <div className="h-32 bg-gray-100 rounded-xl w-full mt-4" />
                  <div className="h-3 bg-gray-200 rounded-full w-2/3" />
                  <div className="h-3 bg-gray-200 rounded-full w-1/2" />
                  <div className="h-3 bg-gray-200 rounded-full w-5/6" />
                  <div className="h-20 bg-gray-100 rounded-xl w-full" />
                </div>

                {/* Widget */}
                <div className="flex justify-end">
                  <MockChatWidget />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Social Proof Bar ─────────────────────────────────────────────── */}
      <section className="py-12 border-t border-border/40">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-center text-sm text-muted-foreground mb-8">
            Powering customer support for fast-growing teams
          </p>
          <div className="flex items-center justify-center gap-10 md:gap-16 flex-wrap opacity-30">
            {[
              "Acme Corp",
              "Nebula",
              "Streamline",
              "Baseline",
              "Keystone",
              "Onward",
            ].map((name) => (
              <span
                key={name}
                className="text-sm font-bold tracking-tight text-foreground"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              How It Works
            </p>
            <h2 className="text-3xl sm:text-[2.75rem] font-bold text-foreground tracking-tight leading-tight">
              Live in three simple steps
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Step 1 */}
            <div className="bg-card rounded-2xl border border-border p-7 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-foreground text-background text-xs font-bold">
                1
              </div>
              <h3 className="text-lg font-semibold text-foreground">
                Add your knowledge
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Upload docs, paste URLs, or write FAQs. We index everything automatically for AI retrieval.
              </p>
              {/* Mini resource list */}
              <div className="bg-background rounded-xl border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[12px] text-foreground truncate flex-1">docs.example.com</span>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                </div>
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[12px] text-foreground truncate flex-1">product-guide.pdf</span>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                </div>
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[12px] text-foreground truncate flex-1">12 FAQ entries</span>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="bg-card rounded-2xl border border-border p-7 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center">
                <Palette className="w-5 h-5 text-primary" />
              </div>
              <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-foreground text-background text-xs font-bold">
                2
              </div>
              <h3 className="text-lg font-semibold text-foreground">
                Customize your bot
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Match your brand colors, set the tone of voice, and configure quick actions. Make it yours.
              </p>
              {/* Mini customization panel */}
              <div className="bg-background rounded-xl border border-border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">Colors</span>
                  <div className="flex gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-[#2d5a2d] ring-2 ring-primary ring-offset-1" />
                    <div className="w-5 h-5 rounded-full bg-blue-600" />
                    <div className="w-5 h-5 rounded-full bg-violet-600" />
                    <div className="w-5 h-5 rounded-full bg-orange-500" />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">Tone</span>
                  <span className="text-[12px] bg-primary/[0.08] text-primary px-2.5 py-0.5 rounded-full font-medium">Friendly</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">Position</span>
                  <span className="text-[12px] bg-muted px-2.5 py-0.5 rounded-full text-muted-foreground">Bottom-right</span>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="bg-card rounded-2xl border border-border p-7 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center">
                <Code className="w-5 h-5 text-primary" />
              </div>
              <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-foreground text-background text-xs font-bold">
                3
              </div>
              <h3 className="text-lg font-semibold text-foreground">
                Embed & go live
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Copy one script tag into your site. That's it. Your AI support bot is live and ready.
              </p>
              {/* Mini code snippet */}
              <div className="bg-[#1a1a2e] rounded-xl p-3 overflow-x-auto">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-2 h-2 rounded-full bg-[#ff5f57]" />
                  <div className="w-2 h-2 rounded-full bg-[#febc2e]" />
                  <div className="w-2 h-2 rounded-full bg-[#28c840]" />
                </div>
                <code className="text-[11px] leading-relaxed text-emerald-400 font-mono whitespace-pre">
                  {'<script\n  src="replymaven.com/\n    widget-embed.js"\n  data-project="my-bot"\n></script>'}
                </code>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature Showcase (2-col wide cards) ──────────────────────────── */}
      <section id="features" className="py-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              Features
            </p>
            <h2 className="text-3xl sm:text-[2.75rem] font-bold text-foreground tracking-tight leading-tight">
              Built for support teams,
              <br />
              powered by simplicity
            </h2>
          </div>

          {/* 2 wide feature cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Smart AI - with customization visual */}
            <div className="bg-card rounded-2xl border border-border p-8 space-y-5">
              <h3 className="text-xl font-semibold text-foreground leading-snug max-w-xs">
                Smart, accurate, and built around your knowledge base
              </h3>
              {/* Visual: AI response mock */}
              <div className="bg-background rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-primary/[0.08] flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[13px] text-foreground leading-snug">
                      Yes! You can customize the widget colors, position, and tone of voice from the dashboard settings.
                    </p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      Source: Widget Documentation
                    </p>
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">Retrieval-augmented generation</span>. The AI searches your docs, FAQs, and web pages to provide grounded answers. No hallucination -- every response is backed by your content.
              </p>
            </div>

            {/* Live Agent Handoff */}
            <div className="bg-card rounded-2xl border border-border p-8 space-y-5">
              <h3 className="text-xl font-semibold text-foreground leading-snug max-w-xs">
                Seamless handoff to your team when AI can't help
              </h3>
              {/* Visual: handoff flow */}
              <div className="bg-background rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <Clock className="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <span className="text-[13px] text-muted-foreground">AI confidence is low</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Send className="w-3.5 h-3.5 text-blue-600" />
                  </div>
                  <span className="text-[13px] text-muted-foreground">Notifying agent via Telegram</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <span className="text-[13px] text-foreground font-medium">Agent replied in chat</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">Seamless escalation</span>. When the bot isn't confident, conversations are relayed to your team via Telegram. Full context is preserved -- no repetition needed.
              </p>
            </div>
          </div>

          {/* 3 smaller benefit cards */}
          <div id="benefits" className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-card rounded-2xl border border-border p-7 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center">
                <Code className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                One-line embed
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Add a single script tag to any website. Works with React, WordPress, Shopify, Webflow, or plain HTML.
              </p>
            </div>

            <div className="bg-card rounded-2xl border border-border p-7 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center">
                <Palette className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                Full customization
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Colors, fonts, position, tone of voice, intro messages, quick actions, and custom CSS. The widget looks native to your brand.
              </p>
            </div>

            <div className="bg-card rounded-2xl border border-border p-7 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                Conversation analytics
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Track conversations, response quality, and resolution rates. Auto-generated canned response drafts save time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature Detail Sections (alternating layout) ─────────────────── */}

      {/* Knowledge Management */}
      <section className="py-24 bg-muted/30">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Visual */}
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-br from-primary/[0.06] to-blue-100/30 rounded-[2rem] backdrop-blur-3xl" />
              <div className="relative bg-white/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_60px_rgba(0,0,0,0.06)] border border-white/50 p-6">
                <p className="text-sm font-semibold text-foreground mb-4">Knowledge Base</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2.5 border-b border-border/50">
                    <div className="flex items-center gap-3">
                      <Globe className="w-4 h-4 text-blue-500" />
                      <span className="text-[13px] text-foreground">docs.example.com</span>
                    </div>
                    <span className="text-[11px] text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium">Indexed</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5 border-b border-border/50">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-red-400" />
                      <span className="text-[13px] text-foreground">product-guide.pdf</span>
                    </div>
                    <span className="text-[11px] text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium">Indexed</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5 border-b border-border/50">
                    <div className="flex items-center gap-3">
                      <MessageSquare className="w-4 h-4 text-primary" />
                      <span className="text-[13px] text-foreground">14 FAQ entries</span>
                    </div>
                    <span className="text-[11px] text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium">Indexed</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3">
                      <Globe className="w-4 h-4 text-blue-500" />
                      <span className="text-[13px] text-foreground">help.example.com</span>
                    </div>
                    <span className="text-[11px] text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full font-medium">Pending</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Copy */}
            <div className="space-y-5">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Knowledge Management
              </p>
              <h2 className="text-3xl sm:text-[2.5rem] font-bold text-foreground tracking-tight leading-tight">
                Keep your bot's
                <br />
                knowledge fresh
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">Web pages, PDFs, and FAQs</span> -- all automatically indexed and searchable. Add a URL and we'll crawl it. Upload a PDF and we'll extract the content. Your bot always has the latest information.
              </p>
              <Link to="/signup">
                <Button className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 h-11 text-sm font-medium mt-2">
                  Try ReplyMaven free
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Analytics */}
      <section className="py-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Copy */}
            <div className="space-y-5 order-2 lg:order-1">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Analytics & Insights
              </p>
              <h2 className="text-3xl sm:text-[2.5rem] font-bold text-foreground tracking-tight leading-tight">
                Track performance,
                <br />
                improve over time
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">Conversation analytics</span>, response quality tracking, and auto-generated canned response drafts. See what your visitors are asking and how well your bot is performing.
              </p>

              {/* Feature pills */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                {[
                  { icon: BarChart3, label: "Analytics" },
                  { icon: Bot, label: "Auto-drafts" },
                  { icon: MessageSquare, label: "Conversations" },
                  { icon: Zap, label: "Quick Actions" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-border bg-card text-sm"
                  >
                    <item.icon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-foreground font-medium">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Visual */}
            <div className="relative order-1 lg:order-2">
              <div className="absolute -inset-4 bg-gradient-to-br from-primary/[0.06] to-blue-100/30 rounded-[2rem] backdrop-blur-3xl" />
              <div className="relative">
                <MockDashboardPreview />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 bg-muted/30">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              Pricing
            </p>
            <h2 className="text-3xl sm:text-[2.75rem] font-bold text-foreground tracking-tight leading-tight">
              Simple plans
              <br />
              for serious support
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {pricingPlans.map((plan) => (
              <div
                key={plan.name}
                className={`relative bg-card rounded-2xl border flex flex-col ${
                  plan.highlighted
                    ? "border-primary/20 shadow-lg shadow-primary/5 bg-gradient-to-b from-primary/[0.04] to-card"
                    : "border-border"
                }`}
              >
                <div className="p-7 pb-0 space-y-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm text-muted-foreground">{plan.name}</h3>
                    {plan.highlighted && plan.badge && (
                      <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                        {plan.badge}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-foreground tracking-tight">
                      {plan.price}
                    </span>
                    {plan.period && (
                      <span className="text-muted-foreground text-sm">
                        {plan.period}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {plan.description}
                  </p>
                </div>

                <ul className="p-7 space-y-3 flex-1">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm"
                    >
                      <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <span className="text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="p-7 pt-0">
                  <Link to="/signup" className="block">
                    <Button
                      className={`w-full rounded-xl h-11 text-sm font-medium ${
                        plan.highlighted
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "bg-muted text-foreground hover:bg-muted/80"
                      }`}
                      variant={plan.highlighted ? "default" : "secondary"}
                    >
                      {plan.cta}
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Enterprise card */}
          <div className="mt-8 bg-card rounded-2xl border border-border p-8">
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="space-y-2 md:max-w-xs shrink-0">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-semibold text-foreground">
                    Enterprise
                  </h3>
                  <span className="text-[11px] bg-primary/10 text-primary px-2.5 py-1 rounded-full font-medium">
                    Custom Pricing
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  For organizations with advanced needs. Unlimited everything with dedicated support.
                </p>
              </div>

              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {[
                  "Unlimited projects & messages",
                  "SLA & uptime guarantee",
                  "Dedicated account manager",
                  "SSO & advanced security",
                ].map((feature) => (
                  <span
                    key={feature}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <Check className="w-4 h-4 text-primary shrink-0" />
                    {feature}
                  </span>
                ))}
              </div>

              <Link to="/signup" className="shrink-0">
                <Button
                  variant="outline"
                  className="rounded-xl h-11 px-6"
                >
                  Contact Sales
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="py-24">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              FAQ
            </p>
            <h2 className="text-3xl sm:text-[2.75rem] font-bold text-foreground tracking-tight leading-tight">
              Frequently asked questions
            </h2>
          </div>

          <div>
            {faqItems.map((item) => (
              <FaqItem
                key={item.question}
                question={item.question}
                answer={item.answer}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="py-24">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl sm:text-[2.75rem] font-bold text-foreground tracking-tight leading-tight mb-5">
            Ready to get started
          </h2>
          <p className="text-muted-foreground text-lg mb-10">
            Set up ReplyMaven for free. No credit card required.
          </p>
          <Link to="/signup">
            <Button className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-8 h-12 text-[15px] font-medium">
              Try ReplyMaven free
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="pb-8 px-6">
        <div className="max-w-5xl mx-auto bg-card rounded-2xl border border-border p-10">
          <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr] gap-10 mb-10">
            {/* Brand */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                  <MessageSquare className="w-3.5 h-3.5 text-primary-foreground" />
                </div>
                <span className="font-semibold text-foreground text-[15px] tracking-tight">
                  ReplyMaven
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
                AI-powered customer support that knows your product. Built for startups and growing teams.
              </p>
              {/* Social icons */}
              <div className="flex items-center gap-2 pt-1">
                <a
                  href="#"
                  className="w-9 h-9 rounded-full bg-primary flex items-center justify-center hover:bg-primary/80 transition-colors"
                >
                  <Linkedin className="w-4 h-4 text-primary-foreground" />
                </a>
                <a
                  href="#"
                  className="w-9 h-9 rounded-full bg-primary flex items-center justify-center hover:bg-primary/80 transition-colors"
                >
                  <Twitter className="w-4 h-4 text-primary-foreground" />
                </a>
              </div>
            </div>

            {/* Pages */}
            <div className="space-y-4">
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Pages
              </h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Home", href: "#" },
                  { label: "Features", href: "#features" },
                  { label: "Pricing", href: "#pricing" },
                  { label: "FAQ", href: "#faq" },
                ].map((item) => (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Information */}
            <div className="space-y-4">
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Information
              </h4>
              <ul className="space-y-2.5">
                {[
                  "Contact",
                  "Privacy Policy",
                  "Terms of Service",
                ].map((item) => (
                  <li key={item}>
                    <a
                      href="#"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Copyright bar */}
          <div className="pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} ReplyMaven. All rights reserved.
            </p>
            <p className="text-sm text-muted-foreground">
              Built on Cloudflare Workers
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
