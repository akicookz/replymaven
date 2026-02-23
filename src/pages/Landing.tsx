import { useState } from "react";
import { Link } from "react-router-dom";
import {
  MessageSquare,
  Globe,
  Bot,
  Code,
  FileText,
  Palette,
  BookOpen,
  BarChart3,
  Headphones,
  Check,
  ChevronDown,
  ArrowRight,
  Sparkles,
  Shield,
  Clock,
  Send,
  Star,
  Users,
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
      "ReplyMaven uses retrieval-augmented generation (RAG) over your actual knowledge base — docs, FAQs, and web pages you provide. The AI only answers from your content, so responses are grounded and accurate. When confidence is low, it automatically hands off to a human.",
  },
  {
    question: "Can I customize the widget's appearance?",
    answer:
      "Completely. You control colors, fonts, border radius, position, header text, avatar, tone of voice, intro message, quick actions, and even inject custom CSS. The widget will look native to your brand.",
  },
  {
    question: "What happens when the bot can't answer?",
    answer:
      "The conversation is seamlessly handed off to a live agent via Telegram. The agent sees the full conversation history and can reply directly — the visitor sees the response in the same chat window. No context is lost.",
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
    name: "Essential",
    price: "$19",
    period: "/mo",
    description: "For personal projects and small sites",
    highlighted: false,
    cta: "Get Started",
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
    name: "Startup",
    price: "$49",
    period: "/mo",
    description: "For growing teams that need more power",
    highlighted: true,
    cta: "Get Started",
    features: [
      "3 projects",
      "5,000 messages / month",
      "200 knowledge resources",
      "PDF, web page & FAQ indexing",
      "Telegram live agent handoff",
      "Custom tone of voice",
      "Quick actions & topics",
      "Priority support",
    ],
  },
  {
    name: "Business",
    price: "$99",
    period: "/mo",
    description: "For teams that run on customer experience",
    highlighted: false,
    cta: "Get Started",
    features: [
      "10 projects",
      "20,000 messages / month",
      "Unlimited resources",
      "Everything in Startup",
      "Conversation analytics",
      "Auto-drafted canned responses",
      "Custom CSS & branding",
      "Remove ReplyMaven branding",
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
    <div className="border border-border rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <span className="font-medium text-foreground pr-4">{question}</span>
        <ChevronDown
          className={`w-5 h-5 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid transition-all duration-200 ease-in-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <p className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Mock Chat Widget ─────────────────────────────────────────────────────────

function MockChatWidget({ className = "" }: { className?: string }) {
  return (
    <div
      className={`w-[340px] bg-white rounded-2xl shadow-[0_5px_40px_rgba(0,0,0,0.12)] overflow-hidden border border-black/5 ${className}`}
    >
      {/* Header */}
      <div className="bg-[#1a2e1a] px-4 py-3.5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
          <Bot className="w-4.5 h-4.5 text-white" />
        </div>
        <div>
          <p className="text-white text-sm font-semibold leading-tight">
            Support Assistant
          </p>
          <p className="text-white/60 text-xs">Typically replies instantly</p>
        </div>
      </div>

      {/* Messages */}
      <div className="bg-[#fafafa] p-4 space-y-3">
        {/* Bot message */}
        <div className="flex items-end gap-2">
          <div className="w-7 h-7 rounded-full bg-[#1a2e1a] flex items-center justify-center shrink-0">
            <Bot className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="bg-white rounded-[18px_18px_18px_4px] px-3.5 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.06)] max-w-[240px]">
            <p className="text-[13px] text-[#1f2937] leading-snug">
              Hi there! How can I help you today?
            </p>
          </div>
        </div>

        {/* Visitor message */}
        <div className="flex justify-end">
          <div className="bg-[#1a2e1a] rounded-[18px_18px_4px_18px] px-3.5 py-2.5 max-w-[240px]">
            <p className="text-[13px] text-white leading-snug">
              How do I integrate the widget on my site?
            </p>
          </div>
        </div>

        {/* Bot message with source */}
        <div className="flex items-end gap-2">
          <div className="w-7 h-7 rounded-full bg-[#1a2e1a] flex items-center justify-center shrink-0">
            <Bot className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="bg-white rounded-[18px_18px_18px_4px] px-3.5 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.06)] max-w-[240px]">
            <p className="text-[13px] text-[#1f2937] leading-snug">
              Just add a single script tag to your HTML. It takes about 30
              seconds!
            </p>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#1a2e1a]/60">
              <FileText className="w-3 h-3" />
              <span>From: Getting Started Guide</span>
            </div>
          </div>
        </div>

        {/* Typing indicator */}
        <div className="flex items-end gap-2">
          <div className="w-7 h-7 rounded-full bg-[#1a2e1a] flex items-center justify-center shrink-0">
            <Bot className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="bg-white rounded-[18px_18px_18px_4px] px-3 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
              <span
                className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                style={{ animationDelay: "0.15s" }}
              />
              <span
                className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                style={{ animationDelay: "0.3s" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Topics */}
      <div className="bg-[#fafafa] px-4 pb-2 flex gap-2 flex-wrap">
        <span className="text-[11px] px-3 py-1.5 rounded-full border border-[#1a2e1a]/15 text-[#1a2e1a]/70 bg-white">
          Pricing plans
        </span>
        <span className="text-[11px] px-3 py-1.5 rounded-full border border-[#1a2e1a]/15 text-[#1a2e1a]/70 bg-white">
          Setup help
        </span>
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-100 px-3 py-2.5 flex items-center gap-2">
        <div className="flex-1 bg-[#f5f5f5] rounded-3xl px-3.5 py-2 text-[13px] text-gray-400">
          Type a message...
        </div>
        <div className="w-8 h-8 rounded-full bg-[#1a2e1a] flex items-center justify-center">
          <Send className="w-3.5 h-3.5 text-white" />
        </div>
      </div>

      {/* Footer */}
      <div className="bg-white text-center py-1.5 border-t border-gray-50">
        <span className="text-[10px] text-gray-400">
          Powered by{" "}
          <span className="font-medium text-gray-500">ReplyMaven</span>
        </span>
      </div>
    </div>
  );
}

// ─── Mock Dashboard Card ──────────────────────────────────────────────────────

function MockDashboardPreview() {
  return (
    <div className="bg-card/80 rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-card-foreground">
          Conversations Today
        </span>
        <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="text-2xl font-bold text-card-foreground">247</div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-green-600 font-medium">+12.5%</span>
        <span className="text-xs text-muted-foreground">vs last week</span>
      </div>
      <div className="flex gap-1 items-end h-10">
        {[40, 65, 45, 80, 55, 70, 90].map((h, i) => (
          <div
            key={i}
            className="flex-1 bg-primary/20 rounded-t-sm"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function Landing() {
  return (
    <div className="min-h-screen bg-background scroll-smooth">
      {/* ── Sticky Header ────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/50">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground text-lg">
              ReplyMaven
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            <a
              href="#features"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Features
            </a>
            <a
              href="#pricing"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Pricing
            </a>
            <a
              href="#faq"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button variant="ghost" size="sm">
                Log in
              </Button>
            </Link>
            <Link to="/signup">
              <Button size="sm">
                Get Started Free
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 lg:pt-28 lg:pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left - Copy */}
          <div className="space-y-8">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/5 border border-primary/10 text-sm text-primary">
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI-powered support in minutes</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold text-foreground tracking-tight font-heading leading-[1.1]">
                Resolve 80% of Support Questions{" "}
                <span className="text-muted-foreground">Instantly</span>
              </h1>

              <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
                An AI chatbot that actually knows your product. It learns from
                your docs, matches your brand, and embeds on your site in one
                line of code. When it can't help, it hands off to your team.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Link to="/signup">
                <Button size="lg" className="text-base px-8">
                  Start Free
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button variant="outline" size="lg" className="text-base">
                  See How It Works
                </Button>
              </a>
            </div>

            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Check className="w-4 h-4 text-green-600" />
                No credit card required
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="w-4 h-4 text-green-600" />
                5-minute setup
              </span>
            </div>
          </div>

          {/* Right - Mock Chat Widget */}
          <div className="relative flex justify-center lg:justify-end">
            {/* Background glow */}
            <div className="absolute -inset-4 bg-primary/5 rounded-3xl blur-3xl" />

            {/* Mock website surface */}
            <div className="relative bg-white rounded-2xl shadow-xl border border-black/5 p-6 pt-8">
              {/* Browser dots */}
              <div className="absolute top-2.5 left-4 flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-300" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-300" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-300" />
              </div>

              {/* Fake page content behind widget */}
              <div className="space-y-3 mb-4 opacity-30">
                <div className="h-3 bg-gray-200 rounded-full w-3/4" />
                <div className="h-3 bg-gray-200 rounded-full w-1/2" />
                <div className="h-3 bg-gray-200 rounded-full w-5/6" />
                <div className="h-8 bg-gray-100 rounded-lg w-full mt-4" />
                <div className="h-3 bg-gray-200 rounded-full w-2/3" />
              </div>

              <MockChatWidget />
            </div>
          </div>
        </div>
      </section>

      {/* ── Social Proof Bar ─────────────────────────────────────────────── */}
      <section className="border-y border-border/50 bg-muted/30">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <p className="text-center text-sm font-medium text-muted-foreground mb-8">
            Powering customer support for fast-growing teams
          </p>
          <div className="flex items-center justify-center gap-8 md:gap-14 flex-wrap opacity-40">
            {/* Placeholder logos - styled as abstract company name shapes */}
            {[
              "Acme Corp",
              "Nebula",
              "Streamline",
              "Baseline",
              "Keystone",
              "Onward",
            ].map((name) => (
              <div
                key={name}
                className="flex items-center gap-1.5 text-foreground"
              >
                <div className="w-5 h-5 rounded-md bg-foreground/20" />
                <span className="text-sm font-semibold tracking-tight">
                  {name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground font-heading tracking-tight">
            Live in Three Steps
          </h2>
          <p className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
            Go from zero to a fully trained AI support bot on your website.
            No engineering required.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connecting line (desktop) */}
          <div className="hidden md:block absolute top-16 left-[20%] right-[20%] h-px bg-border" />

          {/* Step 1 */}
          <div className="relative text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center relative z-10">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              1
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Add Your Knowledge
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Upload docs, paste URLs, or write FAQs. We index everything
              automatically for AI retrieval.
            </p>
            {/* Mini visual - resource list */}
            <div className="bg-card/50 backdrop-blur-xl rounded-xl border border-border p-3 space-y-2 max-w-[220px] mx-auto text-left">
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs text-card-foreground truncate">
                  docs.example.com
                </span>
                <Check className="w-3 h-3 text-green-600 ml-auto" />
              </div>
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs text-card-foreground truncate">
                  product-guide.pdf
                </span>
                <Check className="w-3 h-3 text-green-600 ml-auto" />
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs text-card-foreground truncate">
                  12 FAQ entries
                </span>
                <Check className="w-3 h-3 text-green-600 ml-auto" />
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="relative text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center relative z-10">
              <Palette className="w-5 h-5 text-primary" />
            </div>
            <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              2
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Customize Your Bot
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Match your brand colors, set the tone of voice, and configure
              quick actions. Make it yours.
            </p>
            {/* Mini visual - color swatches */}
            <div className="bg-card/50 backdrop-blur-xl rounded-xl border border-border p-3 space-y-2.5 max-w-[220px] mx-auto text-left">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16">
                  Primary
                </span>
                <div className="flex gap-1.5">
                  <div className="w-5 h-5 rounded-full bg-[#1a2e1a] ring-2 ring-primary ring-offset-1" />
                  <div className="w-5 h-5 rounded-full bg-blue-600" />
                  <div className="w-5 h-5 rounded-full bg-purple-600" />
                  <div className="w-5 h-5 rounded-full bg-orange-500" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16">Tone</span>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  Friendly
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16">
                  Position
                </span>
                <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                  Bottom-right
                </span>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="relative text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center relative z-10">
              <Code className="w-5 h-5 text-primary" />
            </div>
            <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              3
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Embed & Go Live
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Copy one script tag into your site. That's it. Your AI support
              bot is live and ready to help visitors.
            </p>
            {/* Mini visual - code snippet */}
            <div className="bg-[#1a1a2e] rounded-xl p-3 max-w-[240px] mx-auto text-left overflow-x-auto">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <div className="w-2 h-2 rounded-full bg-yellow-400" />
                <div className="w-2 h-2 rounded-full bg-green-400" />
              </div>
              <code className="text-[10px] leading-relaxed text-green-400 font-mono whitespace-pre">
                {'<script\n  src="replymaven.com/\n    widget-embed.js"\n  data-project="my-bot"\n></script>'}
              </code>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Grid ────────────────────────────────────────────────── */}
      <section id="features" className="bg-muted/20">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground font-heading tracking-tight">
              Everything You Need to Deliver
              <br />
              <span className="text-muted-foreground">
                Exceptional Support
              </span>
            </h2>
            <p className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
              From AI-powered answers to live agent handoff, ReplyMaven covers
              the full support workflow.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 - Smart AI Responses with mini dashboard */}
            <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-card-foreground">
                Smart AI Responses
              </h3>
              <p className="text-sm text-muted-foreground">
                Powered by Gemini with RAG over your knowledge base. Accurate,
                context-aware answers grounded in your actual content.
              </p>
              {/* Mini mock - AI response with source */}
              <div className="bg-background/60 rounded-xl p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="w-2.5 h-2.5 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] text-card-foreground leading-snug">
                      Yes! You can customize the widget colors, position, and
                      tone of voice from the dashboard settings.
                    </p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <FileText className="w-2.5 h-2.5" />
                      Source: Widget Docs
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 2 - One-Line Embed */}
            <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Code className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-card-foreground">
                One-Line Embed
              </h3>
              <p className="text-sm text-muted-foreground">
                Add a single script tag to any website. Works with React,
                WordPress, Shopify, Webflow, or plain HTML. No build step
                needed.
              </p>
              {/* Mini mock - code snippet */}
              <div className="bg-[#1a1a2e] rounded-xl p-3 overflow-x-auto">
                <code className="text-[11px] leading-relaxed font-mono whitespace-pre">
                  <span className="text-gray-500">{'<!-- '}</span>
                  <span className="text-emerald-400">Add to your site</span>
                  <span className="text-gray-500">{' -->'}</span>
                  {'\n'}
                  <span className="text-blue-400">{'<'}</span>
                  <span className="text-red-400">script</span>
                  {'\n'}
                  <span className="text-purple-300">{'  src'}</span>
                  <span className="text-gray-400">{'='}</span>
                  <span className="text-emerald-400">{'"..widget-embed.js"'}</span>
                  {'\n'}
                  <span className="text-purple-300">{'  data-project'}</span>
                  <span className="text-gray-400">{'='}</span>
                  <span className="text-emerald-400">{'"my-bot"'}</span>
                  {'\n'}
                  <span className="text-blue-400">{'>'}</span>
                  <span className="text-blue-400">{'</'}</span>
                  <span className="text-red-400">script</span>
                  <span className="text-blue-400">{'>'}</span>
                </code>
              </div>
            </div>

            {/* Feature 3 - Live Agent Handoff */}
            <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Headphones className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-card-foreground">
                Live Agent Handoff
              </h3>
              <p className="text-sm text-muted-foreground">
                When AI can't help, conversations are seamlessly escalated to
                your team via Telegram. Full context preserved, zero friction.
              </p>
              {/* Mini mock - handoff flow */}
              <div className="bg-background/60 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
                    <Clock className="w-2.5 h-2.5 text-yellow-600" />
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    AI confidence low
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <Send className="w-2.5 h-2.5 text-blue-600" />
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Notifying agent via Telegram
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-green-600" />
                  </div>
                  <span className="text-[11px] text-card-foreground font-medium">
                    Agent replied in chat
                  </span>
                </div>
              </div>
            </div>

            {/* Feature 4 - Knowledge Management */}
            <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-card-foreground">
                Knowledge Management
              </h3>
              <p className="text-sm text-muted-foreground">
                Web pages, PDFs, and FAQs -- all automatically indexed and
                searchable. Keep your bot's knowledge fresh with one-click
                reindexing.
              </p>
              {/* Mini mock - resource list */}
              <div className="bg-background/60 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-[11px] text-card-foreground">docs.example.com</span>
                  </div>
                  <span className="text-[10px] text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded-full">Indexed</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[11px] text-card-foreground">product-guide.pdf</span>
                  </div>
                  <span className="text-[10px] text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded-full">Indexed</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[11px] text-card-foreground">14 FAQ entries</span>
                  </div>
                  <span className="text-[10px] text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded-full">Indexed</span>
                </div>
              </div>
            </div>

            {/* Feature 5 - Full Customization */}
            <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Palette className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-card-foreground">
                Full Customization
              </h3>
              <p className="text-sm text-muted-foreground">
                Colors, fonts, position, tone of voice, intro messages, quick
                actions, quick topics, and custom CSS. The widget looks native
                to your brand.
              </p>
              {/* Mini mock - customization panel */}
              <div className="bg-background/60 rounded-xl p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Primary Color</span>
                  <div className="flex gap-1.5">
                    <div className="w-4.5 h-4.5 rounded-full bg-[#1a2e1a] ring-2 ring-primary/40 ring-offset-1" />
                    <div className="w-4.5 h-4.5 rounded-full bg-blue-600" />
                    <div className="w-4.5 h-4.5 rounded-full bg-violet-600" />
                    <div className="w-4.5 h-4.5 rounded-full bg-rose-500" />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Tone of Voice</span>
                  <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Friendly</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Position</span>
                  <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Bottom Right</span>
                </div>
              </div>
            </div>

            {/* Feature 6 - Analytics with mini dashboard mock */}
            <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-card-foreground">
                Conversation Analytics
              </h3>
              <p className="text-sm text-muted-foreground">
                Track conversations, response quality, and resolution rates.
                Auto-generated canned response drafts save your team even more
                time.
              </p>
              <MockDashboardPreview />
            </div>
          </div>
        </div>
      </section>

      {/* ── Widget Demo Section ──────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left - Copy */}
          <div className="space-y-6 order-2 lg:order-1">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground font-heading tracking-tight">
              A Support Experience
              <br />
              <span className="text-muted-foreground">
                Your Visitors Will Love
              </span>
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              The chat widget feels fast, modern, and personal. Streaming AI
              responses appear in real time. Quick topic pills help visitors
              find answers without typing. And when they need a human, the
              handoff is seamless.
            </p>
            <ul className="space-y-3">
              {[
                "Real-time streaming responses",
                "Source citations for every answer",
                "Quick topics and suggested actions",
                "Visitor identification and context",
                "Mobile-responsive design",
                "Programmatic API (open, close, identify)",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm">
                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 text-primary" />
                  </div>
                  <span className="text-card-foreground">{item}</span>
                </li>
              ))}
            </ul>
            <Link to="/signup">
              <Button size="lg" className="mt-2">
                Try It Free
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>

          {/* Right - Full Widget Mock */}
          <div className="relative flex justify-center order-1 lg:order-2">
            <div className="absolute -inset-8 bg-primary/5 rounded-3xl blur-3xl" />

            {/* Mock website */}
            <div className="relative bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl shadow-xl border border-black/5 p-8 pt-10 min-h-[520px] w-full max-w-[480px]">
              {/* Browser chrome */}
              <div className="absolute top-3 left-4 flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-300" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-300" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-300" />
              </div>
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-white rounded-md px-8 py-1 text-[10px] text-gray-400 border border-gray-200">
                yoursite.com
              </div>

              {/* Page skeleton */}
              <div className="space-y-4 opacity-20">
                <div className="h-4 bg-gray-300 rounded-full w-2/3" />
                <div className="h-3 bg-gray-200 rounded-full w-full" />
                <div className="h-3 bg-gray-200 rounded-full w-4/5" />
                <div className="h-24 bg-gray-200 rounded-xl w-full" />
                <div className="h-3 bg-gray-200 rounded-full w-3/4" />
                <div className="h-3 bg-gray-200 rounded-full w-1/2" />
              </div>

              {/* Widget positioned at bottom-right */}
              <div className="absolute bottom-4 right-4">
                <MockChatWidget className="scale-[0.78] origin-bottom-right shadow-[0_8px_50px_rgba(0,0,0,0.15)]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="bg-muted/20">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground font-heading tracking-tight">
              Simple, Transparent Pricing
            </h2>
            <p className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
              Start free, upgrade when you're ready. No hidden fees, no
              long-term contracts.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {pricingPlans.map((plan) => (
              <div
                key={plan.name}
                className={`relative bg-card/50 backdrop-blur-xl rounded-2xl border p-6 flex flex-col ${
                  plan.highlighted
                    ? "border-primary shadow-lg shadow-primary/5 ring-1 ring-primary/20"
                    : "border-border"
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full flex items-center gap-1">
                    <Star className="w-3 h-3" />
                    Most Popular
                  </div>
                )}

                <div className="space-y-4 mb-6">
                  <h3 className="text-lg font-semibold text-card-foreground">
                    {plan.name}
                  </h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-foreground">
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

                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm"
                    >
                      <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <span className="text-card-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link to="/signup" className="mt-auto">
                  <Button
                    variant={plan.highlighted ? "default" : "outline"}
                    className="w-full"
                  >
                    {plan.cta}
                    <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                </Link>
              </div>
            ))}
          </div>

          {/* Enterprise - horizontal card */}
          <div className="mt-8 bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-8">
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              {/* Left - name + description */}
              <div className="space-y-2 md:max-w-xs shrink-0">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-semibold text-card-foreground">
                    Enterprise
                  </h3>
                  <span className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full font-medium">
                    Custom Pricing
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  For organizations with advanced needs.
                  Unlimited everything with dedicated support.
                </p>
              </div>

              {/* Center - features in 2x2 grid */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {[
                  "Unlimited projects & messages",
                  "SLA & uptime guarantee",
                  "Dedicated account manager",
                  "SSO & advanced security",
                ].map((feature) => (
                  <span
                    key={feature}
                    className="flex items-center gap-2 text-sm text-card-foreground"
                  >
                    <Check className="w-4 h-4 text-primary shrink-0" />
                    {feature}
                  </span>
                ))}
              </div>

              {/* Right - CTA */}
              <Link to="/signup" className="shrink-0">
                <Button variant="outline" size="lg">
                  Contact Sales
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-24">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground font-heading tracking-tight">
            Frequently Asked Questions
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Everything you need to know before getting started.
          </p>
        </div>

        <div className="space-y-3">
          {faqItems.map((item) => (
            <FaqItem
              key={item.question}
              question={item.question}
              answer={item.answer}
            />
          ))}
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="bg-primary">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-primary-foreground font-heading tracking-tight">
            Ready to Transform Your
            <br />
            Customer Support?
          </h2>
          <p className="mt-4 text-primary-foreground/70 text-lg max-w-xl mx-auto">
            Join hundreds of teams using ReplyMaven to deliver faster, smarter
            support. Set up in minutes, not months.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/signup">
              <Button
                size="lg"
                variant="secondary"
                className="text-base px-8"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-primary-foreground/50 text-sm flex items-center justify-center gap-4">
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              No credit card required
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              5-minute setup
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Cancel anytime
            </span>
          </p>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-background">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {/* Brand */}
            <div className="md:col-span-1 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-semibold text-foreground text-lg">
                  ReplyMaven
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                AI-powered customer support
                <br />
                that knows your product.
              </p>
            </div>

            {/* Product */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">
                Product
              </h4>
              <ul className="space-y-2">
                {["Features", "Pricing", "Documentation", "Changelog"].map(
                  (item) => (
                    <li key={item}>
                      <a
                        href={
                          item === "Features"
                            ? "#features"
                            : item === "Pricing"
                              ? "#pricing"
                              : "#"
                        }
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {item}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </div>

            {/* Company */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">
                Company
              </h4>
              <ul className="space-y-2">
                {["About", "Blog", "Careers", "Contact"].map((item) => (
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

            {/* Legal */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Legal</h4>
              <ul className="space-y-2">
                {["Privacy Policy", "Terms of Service", "Cookie Policy"].map(
                  (item) => (
                    <li key={item}>
                      <a
                        href="#"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {item}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} ReplyMaven. All rights
              reserved.
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
