import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthModal from "@/components/AuthModal";
import { Logo } from "@/components/Logo";
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
  Calendar,
  ClipboardList,
  Wrench,
  Phone,
  Mail,
  ChevronLeft,
  ChevronRight,
  Heart,
  Search,
  Loader2,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PricingCards } from "@/components/PricingCards";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
      "Yes. Sign up for free and explore the full dashboard, add knowledge sources, and test the widget on your site.",
  },
];

// ─── Chat Animation Data ──────────────────────────────────────────────────────

interface ChatMessage {
  role: "bot" | "visitor";
  content: string;
  source?: string;
}

const chatSequence: ChatMessage[] = [
  {
    role: "bot",
    content: "Hi there! How can I help you today?",
  },
  {
    role: "visitor",
    content: "How do I integrate the widget on my site?",
  },
  {
    role: "bot",
    content:
      "Just add a single script tag to your HTML. It takes about 30 seconds to set up!",
    source: "Getting Started Guide",
  },
  {
    role: "visitor",
    content: "Can I customize the colors?",
  },
  {
    role: "bot",
    content:
      "Absolutely! You can match colors, fonts, position, and tone of voice from the dashboard.",
    source: "Widget Customization Docs",
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
    <div className="border-b border-white/[0.06] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-left cursor-pointer group"
      >
        <span className="font-normal text-card-foreground text-[15px] pr-4 group-hover:text-brand transition-colors">
          {question}
        </span>
        <ChevronDown
          className={`w-5 h-5 text-quaternary shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
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

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <Sparkles className="w-3 h-3 text-brand" />
      </div>
      <div className="bg-secondary rounded-[16px_16px_16px_4px] px-4 py-3">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-soft/60 animate-[typingDot_1.4s_ease-in-out_infinite]" />
          <span className="w-1.5 h-1.5 rounded-full bg-brand-soft/60 animate-[typingDot_1.4s_ease-in-out_0.2s_infinite]" />
          <span className="w-1.5 h-1.5 rounded-full bg-brand-soft/60 animate-[typingDot_1.4s_ease-in-out_0.4s_infinite]" />
        </div>
      </div>
    </div>
  );
}

// ─── Animated Mock Chat Widget (Hero) ─────────────────────────────────────────

function AnimatedChatWidget() {
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function showNext(index: number) {
      if (index >= chatSequence.length) {
        timeoutRef.current = setTimeout(() => {
          setVisibleMessages([]);
          setIsTyping(false);
          showNext(0);
        }, 4000);
        return;
      }

      const msg = chatSequence[index];

      if (msg.role === "bot") {
        setIsTyping(true);
        timeoutRef.current = setTimeout(() => {
          setIsTyping(false);
          setVisibleMessages((prev) => [...prev, msg]);
          timeoutRef.current = setTimeout(
            () => showNext(index + 1),
            1200
          );
        }, 1500);
      } else {
        timeoutRef.current = setTimeout(() => {
          setVisibleMessages((prev) => [...prev, msg]);
          timeoutRef.current = setTimeout(
            () => showNext(index + 1),
            800
          );
        }, 1000);
      }
    }

    timeoutRef.current = setTimeout(() => showNext(0), 800);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [visibleMessages, isTyping]);

  return (
    <div
      className={cn(
        cardVariants({ variant: "glow-secondary" }),
        "w-full max-w-[420px] h-[520px] flex flex-col overflow-hidden",
      )}
    >
      {/* Header */}
      <div className="px-4 py-3.5 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-brand" />
        </div>
        <div className="flex-1">
          <p className="text-card-foreground text-sm font-medium leading-tight">
            Chat with us
          </p>
          <p className="text-quaternary text-[11px]">
            We typically reply instantly
          </p>
        </div>
        <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="p-4 space-y-3 flex-1 overflow-y-auto scrollbar-none">
        {visibleMessages.map((msg, i) => (
          <div
            key={`${i}-${msg.content.slice(0, 10)}`}
            className="animate-[messageIn_0.3s_ease-out_forwards]"
          >
            {msg.role === "bot" ? (
              <div className="flex items-end gap-2">
                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Sparkles className="w-3 h-3 text-brand" />
                </div>
                <div className="bg-secondary rounded-[16px_16px_16px_4px] px-3.5 py-2.5 max-w-[240px] border border-white/[0.04]">
                  <p className="text-[13px] text-secondary-foreground leading-snug">
                    {msg.content}
                  </p>
                  {msg.source && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-brand-soft/50">
                      <FileText className="w-2.5 h-2.5" />
                      <span>From: {msg.source}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex justify-end">
                <div className="bg-brand/15 border border-brand/20 rounded-[16px_16px_4px_16px] px-3.5 py-2.5 max-w-[240px]">
                  <p className="text-[13px] text-card-foreground leading-snug">
                    {msg.content}
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}
        {isTyping && (
          <div className="animate-[messageIn_0.3s_ease-out_forwards]">
            <TypingIndicator />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-2.5 flex items-center gap-2 shrink-0">
        <div className="flex-1 bg-white/[0.05] rounded-full px-3.5 py-2 text-[13px] text-quaternary border border-white/[0.06]">
          Type a message...
        </div>
        <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center">
          <Send className="w-3.5 h-3.5 text-brand" />
        </div>
      </div>
    </div>
  );
}

// ─── Mock Booking UI ──────────────────────────────────────────────────────────

function MockBookingUI() {
  const days = [
    { day: "Mon", date: "12", month: "Jan" },
    { day: "Tue", date: "13", month: "Jan", selected: true },
    { day: "Wed", date: "14", month: "Jan" },
    { day: "Thu", date: "15", month: "Jan" },
    { day: "Fri", date: "16", month: "Jan" },
  ];

  const slots = [
    { time: "9:00 AM", available: true },
    { time: "9:30 AM", available: true, selected: true },
    { time: "10:00 AM", available: false },
    { time: "10:30 AM", available: true },
    { time: "11:00 AM", available: true },
    { time: "11:30 AM", available: true },
  ];

  return (
    <div
      className={cn(
        cardVariants({ variant: "glow-secondary" }),
        "w-full overflow-hidden bg-black/80 backdrop-blur-2xl",
      )}
    >
      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 rounded-full bg-brand/15 flex items-center justify-center">
          <Calendar className="w-4.5 h-4.5 text-brand" />
        </div>
        <div>
          <p className="text-card-foreground text-[15px] font-medium leading-tight">
            Book a demo
          </p>
          <p className="text-quaternary text-[12px]">
            30 min · Select a date & time
          </p>
        </div>
      </div>

      {/* Date picker */}
      <div className="px-5 pt-4 pb-3 flex-1">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] text-muted-foreground">January 2026</span>
          <div className="flex gap-1">
            <div className="w-6 h-6 rounded-md bg-white/[0.05] flex items-center justify-center border border-white/[0.06]">
              <ChevronLeft className="w-3 h-3 text-quaternary" />
            </div>
            <div className="w-6 h-6 rounded-md bg-white/[0.05] flex items-center justify-center border border-white/[0.06]">
              <ChevronRight className="w-3 h-3 text-quaternary" />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {days.map((d) => (
            <div
              key={d.date}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-xl border text-center transition-colors ${d.selected
                ? "bg-brand/15 border-brand/25"
                : "bg-white/[0.02] border-white/[0.06]"
                }`}
            >
              <span className={`text-[10px] ${d.selected ? "text-brand" : "text-quaternary"}`}>
                {d.day}
              </span>
              <span className={`text-[15px] font-medium ${d.selected ? "text-brand" : "text-card-foreground"}`}>
                {d.date}
              </span>
              <span className={`text-[9px] ${d.selected ? "text-brand-soft/60" : "text-quaternary"}`}>
                {d.month}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Time slots */}
      <div className="px-5 pb-3 flex-1">
        <p className="text-[11px] text-quaternary mb-2 uppercase tracking-wider">
          Available times
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {slots.map((s) => (
            <div
              key={s.time}
              className={`py-2 rounded-lg text-center text-[12px] border transition-colors ${s.selected
                ? "bg-brand/15 border-brand/25 text-brand"
                : s.available
                  ? "bg-white/[0.02] border-white/[0.06] text-secondary-foreground"
                  : "bg-white/[0.01] border-white/[0.03] text-disabled line-through"
                }`}
            >
              {s.time}
            </div>
          ))}
        </div>
      </div>

      {/* Quick form */}
      <div className="px-5 pb-5 space-y-2.5 flex-1">
        <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] px-3 py-2 flex items-center gap-2.5">
          <Mail className="w-3.5 h-3.5 text-quaternary shrink-0" />
          <span className="text-[12px] text-muted-foreground">sarah@example.com</span>
        </div>
        <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] px-3 py-2 flex items-center gap-2.5">
          <Phone className="w-3.5 h-3.5 text-quaternary shrink-0" />
          <span className="text-[12px] text-quaternary">Phone (optional)</span>
        </div>
        <div className="bg-brand/15 border border-brand/25 rounded-lg py-2.5 text-center text-[13px] text-brand font-medium">
          Confirm Booking
        </div>
      </div>
    </div>
  );
}

// ─── Mock Contact Form UI ─────────────────────────────────────────────────────

function MockContactFormUI() {
  return (
    <div
      className={cn(
        cardVariants({ variant: "glow-secondary" }),
        "w-full overflow-hidden bg-black/80 backdrop-blur-2xl",
      )}
    >
      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-brand/15 flex items-center justify-center">
          <ClipboardList className="w-4.5 h-4.5 text-brand" />
        </div>
        <div>
          <p className="text-card-foreground text-[15px] font-medium leading-tight">
            Contact Us
          </p>
          <p className="text-quaternary text-[12px]">
            We'll get back to you within 1-2 hours.
          </p>
        </div>
      </div>

      {/* Form fields */}
      <div className="px-5 py-5 space-y-3.5 flex-1">
        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            Name <span className="text-red-400">*</span>
          </label>
          <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] px-3.5 py-2.5">
            <span className="text-[13px] text-secondary-foreground">Sarah Johnson</span>
          </div>
        </div>

        {/* Email */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            Email <span className="text-red-400">*</span>
          </label>
          <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] px-3.5 py-2.5">
            <span className="text-[13px] text-secondary-foreground">sarah@example.com</span>
          </div>
        </div>

        {/* Company */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wider">
            Company
          </label>
          <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] px-3.5 py-2.5">
            <span className="text-[13px] text-secondary-foreground">Acme Inc</span>
          </div>
        </div>

        {/* Message */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            Message <span className="text-red-400">*</span>
          </label>
          <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] px-3.5 py-2.5 min-h-[72px]">
            <span className="text-[13px] text-secondary-foreground leading-relaxed">
              I'd like to learn more about the enterprise plan and SSO integration options.
            </span>
          </div>
        </div>

        {/* Submit */}
        <div className="bg-brand/15 border border-brand/25 rounded-lg py-3 text-center text-[13px] text-brand font-medium mt-1">
          Send Message
        </div>
      </div>
    </div>
  );
}

// ─── Mock Tool Call UI ────────────────────────────────────────────────────────

function MockToolCallUI() {
  return (
    <div className="w-full space-y-3">
      {/* Chat context - visitor question */}
      <div className="flex justify-end">
        <div className="bg-brand/15 border border-brand/20 rounded-[16px_16px_4px_16px] px-4 py-3 max-w-[300px]">
          <p className="text-[13px] text-card-foreground leading-snug">
            What's the status of order #48291?
          </p>
        </div>
      </div>

      {/* Tool call card */}
      <div
        className={cn(
          cardVariants({ variant: "glow-secondary" }),
          "overflow-hidden bg-black/80 backdrop-blur-2xl",
        )}
      >
        {/* Tool header */}
        <div className="px-4 py-3 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-brand/10 flex items-center justify-center">
            <Wrench className="w-3.5 h-3.5 text-brand" />
          </div>
          <div className="flex-1">
            <p className="text-[12px] text-card-foreground font-medium">Calling tool</p>
            <p className="text-[11px] text-quaternary">get_order_status</p>
          </div>
          <span className="text-[10px] bg-brand/10 text-brand px-2 py-0.5 rounded-full">
            GET
          </span>
        </div>

        {/* Params */}
        <div className="px-4 py-3">
          <p className="text-[10px] text-quaternary uppercase tracking-wider mb-2">Parameters</p>
          <div className="bg-code rounded-lg p-3 font-mono text-[11px] text-muted-foreground border border-white/[0.04]">
            <span className="text-quaternary">{"{"}</span>
            {"\n"}
            {"  "}<span className="text-brand-soft/70">"order_id"</span>: <span className="text-amber-400/80">"48291"</span>
            {"\n"}
            <span className="text-quaternary">{"}"}</span>
          </div>
        </div>

        {/* Result */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[10px] text-quaternary uppercase tracking-wider">Result</p>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-brand" />
              <span className="text-[10px] text-brand">200 OK</span>
            </div>
            <span className="text-[10px] text-quaternary">· 142ms</span>
          </div>
          <div className="bg-code rounded-lg p-3 font-mono text-[11px] text-muted-foreground border border-white/[0.04]">
            <span className="text-quaternary">{"{"}</span>
            {"\n"}
            {"  "}<span className="text-brand-soft/70">"status"</span>: <span className="text-amber-400/80">"shipped"</span>,{"\n"}
            {"  "}<span className="text-brand-soft/70">"eta"</span>: <span className="text-amber-400/80">"Jan 15, 2026"</span>{"\n"}
            <span className="text-quaternary">{"}"}</span>
          </div>
        </div>
      </div>

      {/* AI response using tool result */}
      <div className="flex items-end gap-2">
        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Bot className="w-3.5 h-3.5 text-brand" />
        </div>
        <div className="bg-secondary rounded-[16px_16px_16px_4px] px-4 py-3 max-w-[320px] border border-white/[0.04]">
          <p className="text-[13px] text-secondary-foreground leading-snug">
            Your order #48291 has been <span className="text-brand">shipped</span> and is estimated to arrive by <span className="text-card-foreground">January 15, 2026</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Mock Dashboard Preview (bigger) ──────────────────────────────────────────

function MockDashboardPreview() {
  return (
    <div
      className={cn(
        cardVariants({ variant: "glow-secondary" }),
        "w-full overflow-hidden bg-black/80 backdrop-blur-2xl",
      )}
    >
      {/* Header */}
      <div className="px-5 py-4 shrink-0">
        <p className="text-[15px] font-medium text-card-foreground">Dashboard</p>
        <p className="text-[12px] text-quaternary">Last 7 days</p>
      </div>

      <div className="p-5 space-y-5 flex-1">
        {/* Stats row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-3">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-3.5 h-3.5 text-quaternary" />
              <span className="text-[10px] text-quaternary uppercase tracking-wider">Conversations</span>
            </div>
            <p className="text-xl font-semibold text-card-foreground">1,247</p>
            <p className="text-[11px] text-brand">+18.2%</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-3">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="w-3.5 h-3.5 text-quaternary" />
              <span className="text-[10px] text-quaternary uppercase tracking-wider">AI Resolved</span>
            </div>
            <p className="text-xl font-semibold text-card-foreground">89%</p>
            <p className="text-[11px] text-brand">+3.1%</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-3">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-3.5 h-3.5 text-quaternary" />
              <span className="text-[10px] text-quaternary uppercase tracking-wider">Avg. Time</span>
            </div>
            <p className="text-xl font-semibold text-card-foreground">1.2s</p>
            <p className="text-[11px] text-brand">-0.3s</p>
          </div>
        </div>

        {/* Chart */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-quaternary">Message volume</span>
            <span className="text-[11px] text-brand font-medium">+12.5%</span>
          </div>
          <div className="flex gap-1 items-end h-20">
            {[35, 55, 40, 70, 50, 65, 80, 55, 75, 90, 60, 85, 45, 70, 95, 68, 82, 58, 73, 88].map((h, i) => (
              <div
                key={i}
                className="flex-1 bg-brand/15 rounded-t-sm hover:bg-brand/25 transition-colors"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-quaternary">
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
            <span>Sun</span>
          </div>
        </div>

        {/* Recent conversations mini-list */}
        <div className="space-y-2">
          <p className="text-[11px] text-quaternary uppercase tracking-wider">Recent</p>
          {[
            { name: "Alex K.", topic: "Billing question", status: "resolved" },
            { name: "Maria S.", topic: "Widget setup help", status: "resolved" },
            { name: "James L.", topic: "API integration", status: "agent" },
          ].map((c) => (
            <div key={c.name} className="flex items-center justify-between py-1.5 last:border-b-0">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-white/[0.05] flex items-center justify-center text-[10px] text-muted-foreground">
                  {c.name[0]}
                </div>
                <div>
                  <p className="text-[12px] text-secondary-foreground">{c.name}</p>
                  <p className="text-[10px] text-quaternary">{c.topic}</p>
                </div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${c.status === "resolved"
                ? "bg-brand/10 text-brand"
                : "bg-blue-500/10 text-blue-400"
                }`}>
                {c.status === "resolved" ? "AI resolved" : "Agent"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Mock Docs Indexing UI (animated) ──────────────────────────────────────────

function MockDocsIndexingUI() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    function run() {
      setPhase(0);
      timers.push(setTimeout(() => setPhase(1), 600));
      timers.push(setTimeout(() => setPhase(2), 1400));
      timers.push(setTimeout(() => setPhase(3), 2200));
      timers.push(setTimeout(() => setPhase(4), 3400));
      timers.push(setTimeout(() => setPhase(5), 4400));
      timers.push(setTimeout(() => setPhase(6), 5600));
      timers.push(setTimeout(() => run(), 9000));
    }
    run();
    return () => timers.forEach(clearTimeout);
  }, []);

  const resources = [
    { icon: Globe, name: "docs.acme.com", color: "text-blue-400" },
    { icon: FileText, name: "product-guide.pdf", color: "text-red-400" },
    { icon: MessageSquare, name: "18 FAQ entries", color: "text-brand" },
  ];

  function resourceStatus(idx: number) {
    if (phase < idx + 1) return "pending";
    if (phase === idx + 1) return "indexing";
    return "indexed";
  }

  return (
    <div
      className={cn(
        cardVariants({ variant: "glow-secondary" }),
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.06]">
        <Search className="w-4 h-4 text-quaternary" />
        <span className="text-[13px] font-medium text-card-foreground">
          Knowledge Base
        </span>
        <span className="ml-auto text-[11px] text-quaternary">
          {phase >= 3 ? "3/3" : `${Math.min(phase, 3)}/3`} indexed
        </span>
      </div>

      <div className="p-5 h-[480px] flex flex-col">
        {/* Resource list */}
        <div className="space-y-2.5">
          <p className="text-[11px] text-quaternary uppercase tracking-wider">
            Resources
          </p>
          {resources.map((r, i) => {
            const status = resourceStatus(i);
            return (
              <div
                key={r.name}
                className={cn(
                  "flex items-center justify-between py-2 px-3 rounded-lg border transition-all duration-500",
                  status === "indexed"
                    ? "border-brand/15 bg-brand/[0.04]"
                    : "border-white/[0.06] bg-white/[0.02]",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <r.icon className={`w-3.5 h-3.5 ${r.color}`} />
                  <span className="text-[12px] text-secondary-foreground">
                    {r.name}
                  </span>
                </div>
                <span
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 transition-all duration-300",
                    status === "indexed" && "bg-brand/10 text-brand",
                    status === "indexing" && "bg-blue-500/10 text-blue-400",
                    status === "pending" && "bg-white/[0.05] text-quaternary",
                  )}
                >
                  {status === "indexing" && (
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  )}
                  {status === "indexed" && <Check className="w-2.5 h-2.5" />}
                  {status === "indexed"
                    ? "Indexed"
                    : status === "indexing"
                      ? "Indexing"
                      : "Pending"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.06] my-5" />

        {/* Chat area - fixed space so nothing shifts */}
        <div className="flex-1 space-y-3">
          {/* Visitor question */}
          <div
            className={cn(
              "transition-opacity duration-500",
              phase >= 4 ? "opacity-100" : "opacity-0",
            )}
          >
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-white/[0.08] flex items-center justify-center shrink-0 mt-0.5">
                <Users className="w-3.5 h-3.5 text-quaternary" />
              </div>
              <div className="bg-white/[0.04] rounded-xl rounded-tl-sm px-3.5 py-2.5">
                <p className="text-[13px] text-secondary-foreground leading-snug">
                  How do I reset my password?
                </p>
              </div>
            </div>
          </div>

          {/* Searching indicator */}
          <div
            className={cn(
              "transition-opacity duration-300",
              phase === 5 ? "opacity-100" : "opacity-0",
            )}
          >
            <div className="flex items-center gap-2 px-2">
              <Search className="w-3.5 h-3.5 text-brand animate-pulse" />
              <span className="text-[11px] text-quaternary">
                Searching knowledge base...
              </span>
            </div>
          </div>

          {/* AI response with source */}
          <div
            className={cn(
              "transition-opacity duration-500",
              phase >= 6 ? "opacity-100" : "opacity-0",
            )}
          >
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-3.5 h-3.5 text-brand" />
              </div>
              <div className="space-y-2">
                <div className="bg-brand/[0.06] rounded-xl rounded-tl-sm px-3.5 py-2.5">
                  <p className="text-[13px] text-secondary-foreground leading-snug">
                    Go to Settings &rarr; Account &rarr; Reset Password. You&apos;ll receive an email with a reset link.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 px-1">
                  <Shield className="w-3 h-3 text-brand/60" />
                  <span className="text-[10px] text-quaternary">
                    Grounded in{" "}
                    <span className="text-brand/80">docs.acme.com</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Mock Widget & Handoff UI (animated) ───────────────────────────────────────

function MockWidgetAndHandoffUI() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    function run() {
      setPhase(0);
      timers.push(setTimeout(() => setPhase(1), 800));
      timers.push(setTimeout(() => setPhase(2), 2000));
      timers.push(setTimeout(() => setPhase(3), 3200));
      timers.push(setTimeout(() => setPhase(4), 4400));
      timers.push(setTimeout(() => setPhase(5), 5600));
      timers.push(setTimeout(() => setPhase(6), 6800));
      timers.push(setTimeout(() => run(), 10000));
    }
    run();
    return () => timers.forEach(clearTimeout);
  }, []);

  const themeColor = phase >= 2 ? "#3b82f6" : "#f97316";

  return (
    <div
      className={cn(
        cardVariants({ variant: "glow-secondary" }),
        "w-full overflow-hidden bg-black/80 backdrop-blur-2xl",
      )}
    >
      {/* Customization toolbar */}
      <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-quaternary" />
          <span className="text-[13px] font-medium text-card-foreground">
            Widget Preview
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-quaternary">Theme</span>
          <div className="flex gap-1.5">
            {["#f97316", "#3b82f6", "#8b5cf6"].map((c) => (
              <div
                key={c}
                className={cn(
                  "w-4 h-4 rounded-full transition-all duration-300 cursor-pointer",
                  themeColor === c
                    ? "ring-2 ring-offset-1 ring-offset-card scale-110"
                    : "opacity-60",
                )}
                style={{
                  backgroundColor: c,
                  boxShadow: themeColor === c ? `0 0 8px ${c}40, 0 0 0 2px var(--card), 0 0 0 4px ${c}` : undefined,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="p-5">
        {/* Mini widget frame */}
        <div className="rounded-2xl border border-white/[0.08] overflow-hidden max-w-[320px] mx-auto">
          {/* Widget header */}
          <div
            className="px-4 py-3 flex items-center gap-3 transition-colors duration-700"
            style={{ backgroundColor: `${themeColor}20` }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-700"
              style={{ backgroundColor: `${themeColor}30` }}
            >
              <Bot
                className="w-4 h-4 transition-colors duration-700"
                style={{ color: themeColor }}
              />
            </div>
            <div>
              <p className="text-[12px] font-medium text-card-foreground">
                Acme Support
              </p>
              <div className="flex items-center gap-1">
                <div
                  className="w-1.5 h-1.5 rounded-full transition-colors duration-700"
                  style={{ backgroundColor: themeColor }}
                />
                <span className="text-[10px] text-quaternary">
                  Online
                </span>
              </div>
            </div>
          </div>

          {/* Chat area */}
          <div className="bg-white/[0.02] p-4 space-y-3 min-h-[200px]">
            {/* Bot intro */}
            <div
              className={cn(
                "transition-all duration-500",
                phase >= 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
              )}
            >
              <div className="flex items-start gap-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors duration-700"
                  style={{ backgroundColor: `${themeColor}20` }}
                >
                  <Bot
                    className="w-3 h-3 transition-colors duration-700"
                    style={{ color: themeColor }}
                  />
                </div>
                <div
                  className="rounded-xl rounded-tl-sm px-3 py-2 border border-white/[0.06]"
                  style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
                >
                  <p className="text-[12px] text-secondary-foreground leading-snug">
                    Hi! How can I help you today?
                  </p>
                </div>
              </div>
            </div>

            {/* Visitor message */}
            <div
              className={cn(
                "transition-all duration-500",
                phase >= 3 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
              )}
            >
              <div className="flex justify-end">
                <div
                  className="rounded-xl rounded-tr-sm px-3 py-2 max-w-[200px] transition-colors duration-700"
                  style={{ backgroundColor: themeColor }}
                >
                  <p className="text-[12px] text-white leading-snug">
                    I need help with my billing issue
                  </p>
                </div>
              </div>
            </div>

            {/* Bot handoff response */}
            <div
              className={cn(
                "transition-all duration-500",
                phase >= 4 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
              )}
            >
              <div className="flex items-start gap-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors duration-700"
                  style={{ backgroundColor: `${themeColor}20` }}
                >
                  <Bot
                    className="w-3 h-3 transition-colors duration-700"
                    style={{ color: themeColor }}
                  />
                </div>
                <div
                  className="rounded-xl rounded-tl-sm px-3 py-2 border border-white/[0.06]"
                  style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
                >
                  <p className="text-[12px] text-secondary-foreground leading-snug">
                    Let me connect you with our team.
                  </p>
                </div>
              </div>
            </div>

            {/* Handoff indicator */}
            <div
              className={cn(
                "transition-all duration-500",
                phase >= 5 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
              )}
            >
              <div className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-blue-500/[0.08] border border-blue-500/10">
                <Send className="w-3 h-3 text-blue-400" />
                <span className="text-[11px] text-blue-400">
                  Connecting via Telegram...
                </span>
                {phase === 5 && (
                  <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                )}
              </div>
            </div>

            {/* Agent reply */}
            <div
              className={cn(
                "transition-all duration-500",
                phase >= 6 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
              )}
            >
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Users className="w-3 h-3 text-emerald-400" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-emerald-400">
                      Agent Sarah
                    </span>
                    <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full">
                      Live
                    </span>
                  </div>
                  <div className="bg-emerald-500/[0.08] rounded-xl rounded-tl-sm px-3 py-2">
                    <p className="text-[12px] text-secondary-foreground leading-snug">
                      Hi! I can help with your billing. Let me pull up your account.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Feature Section: Bento Grid ──────────────────────────────────────────────

function FeatureBentoGrid() {
  return (
    <section id="features" className="min-h-screen flex items-center py-24">
      <div className="max-w-7xl mx-auto px-6 w-full">
        <div className="mb-16">
          <p className="text-sm font-medium text-brand uppercase tracking-wider mb-4">
            Features
          </p>
          <h2 className="text-3xl sm:text-[2.75rem] font-light text-foreground tracking-tight leading-tight">
            The complete AI support agent
            <br />
            equipped with tools and your docs
          </h2>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Top row: Big left card + 3 stacked right cards */}
          <div
            className={cn(
              cardVariants({ variant: "glow-primary" }),
              "lg:row-span-3 p-8 flex flex-col",
            )}
          >
            <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center mb-4">
              <Sparkles className="w-5 h-5 text-brand" />
            </div>
            <h3 className="text-xl font-medium text-card-foreground leading-snug mb-3">
              Smart answers, grounded in your docs
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              <span className="font-medium text-card-foreground">Retrieval-augmented generation</span> searches your docs, FAQs, and web pages. Every response is backed by your content -- no hallucination.
            </p>
            {/* Large mock: knowledge base + AI response */}
            <div className="flex-1 bg-white/[0.02] rounded-xl border border-white/[0.06] p-5 space-y-4">
              {/* Resource list */}
              <div className="space-y-2.5">
                <p className="text-[11px] text-quaternary uppercase tracking-wider">Indexed resources</p>
                {[
                  { icon: Globe, name: "docs.example.com", status: "Indexed", color: "text-blue-400" },
                  { icon: FileText, name: "product-guide.pdf", status: "Indexed", color: "text-red-400" },
                  { icon: MessageSquare, name: "24 FAQ entries", status: "Indexed", color: "text-brand" },
                  { icon: Globe, name: "help.example.com", status: "Pending", color: "text-blue-400" },
                ].map((r) => (
                  <div key={r.name} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2.5">
                      <r.icon className={`w-3.5 h-3.5 ${r.color}`} />
                      <span className="text-[12px] text-secondary-foreground">{r.name}</span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${r.status === "Indexed"
                      ? "bg-brand/10 text-brand"
                      : "bg-amber-500/10 text-amber-400"
                      }`}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
              {/* AI response using sources */}
              <div className="border-t border-white/[0.06] pt-4">
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="w-3.5 h-3.5 text-brand" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[13px] text-secondary-foreground leading-snug">
                      You can customize widget colors, position, and tone of voice from the dashboard settings.
                    </p>
                    <p className="text-[10px] text-quaternary flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      Source: Widget Documentation
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right column: 3 stacked cards */}
          <div
            className={cn(
              cardVariants({ variant: "glow-primary" }),
              "p-6 flex items-center gap-4",
            )}
          >
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                <Code className="w-5 h-5 text-brand" />
              </div>
              <div>
                <h3 className="text-base font-medium text-card-foreground mb-1.5">
                  One-line embed
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Add a single script tag to any website. Works with React, WordPress, Shopify, Webflow, or plain HTML.
                </p>
              </div>
            </div>
            {/* Mini code snippet */}
            <div className="hidden lg:block w-[170px] shrink-0 bg-code rounded-xl p-3 border border-white/[0.04]">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[#ff5f57]" />
                <div className="w-1.5 h-1.5 rounded-full bg-[#febc2e]" />
                <div className="w-1.5 h-1.5 rounded-full bg-[#28c840]" />
              </div>
              <code className="text-[9px] leading-relaxed text-brand font-mono whitespace-pre">{'<script\n  src="replymaven.com\n  /widget-embed.js"\n/>'}</code>
            </div>
          </div>

          <div
            className={cn(
              cardVariants({ variant: "glow-primary" }),
              "p-6 flex items-center gap-4",
            )}
          >
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                <Palette className="w-5 h-5 text-brand" />
              </div>
              <div>
                <h3 className="text-base font-medium text-card-foreground mb-1.5">
                  Full customization
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Colors, fonts, position, tone of voice, intro messages, quick actions, and custom CSS. Native to your brand.
                </p>
              </div>
            </div>
            {/* Mini customization panel */}
            <div className="hidden lg:block w-[170px] shrink-0 bg-white/[0.02] rounded-xl p-3 border border-white/[0.06] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-quaternary">Colors</span>
                <div className="flex gap-1">
                  <div className="w-4 h-4 rounded-full bg-brand ring-1 ring-brand/30 ring-offset-1 ring-offset-card" />
                  <div className="w-4 h-4 rounded-full bg-blue-500" />
                  <div className="w-4 h-4 rounded-full bg-violet-500" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-quaternary">Tone</span>
                <span className="text-[9px] bg-brand/10 text-brand px-2 py-0.5 rounded-full">Friendly</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-quaternary">Position</span>
                <span className="text-[9px] bg-white/[0.05] text-muted-foreground px-2 py-0.5 rounded-full">Bottom-right</span>
              </div>
            </div>
          </div>

          <div
            className={cn(
              cardVariants({ variant: "glow-primary" }),
              "p-6 flex items-center gap-4",
            )}
          >
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                <Wrench className="w-5 h-5 text-brand" />
              </div>
              <div>
                <h3 className="text-base font-medium text-card-foreground mb-1.5">
                  Tool calls
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Connect your AI to any external API. The bot can look up orders, check inventory, or trigger workflows -- autonomously.
                </p>
              </div>
            </div>
            {/* Mini API call graphic */}
            <div className="hidden lg:block w-[170px] shrink-0 bg-code rounded-xl p-3 border border-white/[0.04] space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] bg-brand/15 text-brand px-1.5 py-0.5 rounded font-mono">GET</span>
                <span className="text-[9px] text-quaternary font-mono truncate">/api/orders</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-brand" />
                <span className="text-[9px] text-brand font-mono">200 OK</span>
                <span className="text-[9px] text-quaternary">· 142ms</span>
              </div>
              <div className="text-[8px] text-quaternary font-mono bg-white/[0.03] rounded px-1.5 py-1 mt-1">
                {"{"} "status": "shipped" {"}"}
              </div>
            </div>
          </div>

          {/* Bottom row: 2 half-width cards */}
          <div
            className={cn(
              cardVariants({ variant: "glow-primary" }),
              "p-6 space-y-4 border border-primary/15",
            )}
          >
            <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
              <Send className="w-5 h-5 text-brand" />
            </div>
            <h3 className="text-base font-medium text-card-foreground">
              Live agent handoff
            </h3>
            <div className="bg-black/80 backdrop-blur-2xl rounded-xl border border-accent p-3.5 space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <Clock className="w-3 h-3 text-amber-400" />
                </div>
                <span className="text-[12px] text-muted-foreground">AI confidence is low</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Send className="w-3 h-3 text-blue-400" />
                </div>
                <span className="text-[12px] text-muted-foreground">Notifying agent via Telegram</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center">
                  <Check className="w-3 h-3 text-brand" />
                </div>
                <span className="text-[12px] text-card-foreground">Agent replied in chat</span>
              </div>
            </div>
          </div>

          <div
            className={cn(
              cardVariants({ variant: "glow-primary" }),
              "p-6 space-y-4",
            )}
          >
            <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-brand" />
            </div>
            <h3 className="text-base font-medium text-card-foreground">
              Conversation analytics
            </h3>
            <div className="rounded-xl border border-white/[0.06] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-quaternary">Resolution rate</span>
                <span className="text-[12px] text-brand font-medium">89%</span>
              </div>
              <div className="w-full bg-white/[0.05] rounded-full h-1.5">
                <div className="bg-brand/30 h-1.5 rounded-full" style={{ width: "89%" }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-quaternary">Avg. response time</span>
                <span className="text-[12px] text-card-foreground">1.2s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-quaternary">Auto-drafted responses</span>
                <span className="text-[12px] text-card-foreground">34 drafts</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Feature Section: Booking ─────────────────────────────────────────────────

function FeatureBooking() {
  return (
    <section className="min-h-screen flex items-center py-24">
      <div className="max-w-7xl mx-auto px-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Copy */}
          <div className="space-y-5">
            <p className="text-sm font-medium text-brand uppercase tracking-wider">
              Booking
            </p>
            <h2 className="text-3xl sm:text-[2.5rem] font-light text-foreground tracking-tight leading-tight">
              AI agent that can new demos
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-lg">
              <span className="font-medium text-card-foreground">Built-in scheduling</span> with configurable availability, time zones, slot durations, and buffer times. The AI can detect booking intent and open the scheduler automatically -- or visitors can trigger it from a quick action button.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              {[
                { icon: Calendar, label: "Date & time picker" },
                { icon: Globe, label: "Timezone support" },
                { icon: Mail, label: "Email confirmations" },
                { icon: Zap, label: "AI-triggered" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-brand/10 bg-white/[0.03] backdrop-blur-lg text-sm"
                >
                  <item.icon className="w-4 h-4 text-quaternary" />
                  <span className="text-card-foreground font-medium">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Visual */}
          <div className="relative overflow-hidden rounded-[2rem]">
            <div className="absolute -inset-8 bg-brand/[0.03] rounded-[2rem] blur-3xl" />
            <div className="relative">
              <MockBookingUI />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Feature Section: Contact Form ────────────────────────────────────────────

function FeatureContactForm() {
  return (
    <section className="min-h-screen flex items-center py-24 bg-white/[0.015]">
      <div className="max-w-7xl mx-auto px-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Visual */}
          <div className="relative order-2 lg:order-1 overflow-hidden rounded-[2rem]">
            <div className="absolute -inset-8 bg-brand/[0.03] rounded-[2rem] blur-3xl" />
            <div className="relative">
              <MockContactFormUI />
            </div>
          </div>

          {/* Copy */}
          <div className="space-y-5 order-1 lg:order-2">
            <p className="text-sm font-medium text-brand uppercase tracking-wider">
              Contact Forms
            </p>
            <h2 className="text-3xl sm:text-[2.5rem] font-light text-foreground tracking-tight leading-tight">
              Capture leads with
              <br />
              built-in contact forms
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-lg">
              <span className="font-medium text-card-foreground">Dynamic form builder</span> with custom fields -- text inputs, textareas, required field validation, and a configurable description message. Submissions are stored, show up in your dashboard, and notify your team via Telegram.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              {[
                { icon: ClipboardList, label: "Custom fields" },
                { icon: Check, label: "Validation" },
                { icon: Send, label: "Telegram alerts" },
                { icon: Users, label: "Lead capture" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-brand/10 bg-white/[0.03] backdrop-blur-lg text-sm"
                >
                  <item.icon className="w-4 h-4 text-quaternary" />
                  <span className="text-card-foreground font-medium">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Feature Section: Tool Calls ──────────────────────────────────────────────

function FeatureToolCalls() {
  return (
    <section className="min-h-screen flex items-center py-24">
      <div className="max-w-7xl mx-auto px-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Copy */}
          <div className="space-y-5">
            <p className="text-sm font-medium text-brand uppercase tracking-wider">
              Tool Calls
            </p>
            <h2 className="text-3xl sm:text-[2.5rem] font-light text-foreground tracking-tight leading-tight">
              Go beyond static answers,
              <br />
              resolve issues in real time
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-lg">
              <span className="font-medium text-card-foreground">Walk new users through onboarding</span> so more of them convert. Look up orders and billing details before frustration turns into a refund request. Resolve the repetitive issues that eat up your mornings -- automatically, around the clock. Connect any API and the hard part of support handles itself while you ship.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              {[
                { icon: Zap, label: "Boost activation" },
                { icon: Shield, label: "Prevent churn" },
                { icon: Search, label: "Secure data lookups" },
                { icon: Clock, label: "24/7 resolution" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-brand/10 bg-white/[0.03] backdrop-blur-lg text-sm"
                >
                  <item.icon className="w-4 h-4 text-quaternary" />
                  <span className="text-card-foreground font-medium">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Visual */}
          <div className="relative overflow-hidden rounded-2xl p-6">
            <div className="absolute -inset-8 bg-brand/[0.03] rounded-[2rem] blur-3xl" />
            <div className="relative">
              <MockToolCallUI />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Feature Section: Analytics ───────────────────────────────────────────────

function FeatureAnalytics() {
  return (
    <section className="min-h-screen flex items-center py-24">
      <div className="max-w-7xl mx-auto px-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Visual */}
          <div className="relative order-2 lg:order-1 overflow-hidden rounded-[2rem]">
            <div className="absolute -inset-8 bg-brand/[0.03] rounded-[2rem] blur-3xl" />
            <div className="relative">
              <MockDashboardPreview />
            </div>
          </div>

          {/* Copy */}
          <div className="space-y-5 order-1 lg:order-2">
            <p className="text-sm font-medium text-brand uppercase tracking-wider">
              Analytics & Insights
            </p>
            <h2 className="text-3xl sm:text-[2.5rem] font-light text-foreground tracking-tight leading-tight">
              Track performance,
              <br />
              improve over time
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-lg">
              <span className="font-medium text-card-foreground">Conversation analytics</span>, response quality tracking, and auto-generated canned response drafts. See what your visitors are asking and how well your bot is performing.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              {[
                { icon: BarChart3, label: "Analytics" },
                { icon: Bot, label: "Auto-drafts" },
                { icon: MessageSquare, label: "Conversations" },
                { icon: Zap, label: "Quick Actions" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-brand/10 bg-white/[0.03] backdrop-blur-lg text-sm"
                >
                  <item.icon className="w-4 h-4 text-quaternary" />
                  <span className="text-card-foreground font-medium">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Feature Section: Docs Indexing ───────────────────────────────────────────

function FeatureDocsIndexing() {
  return (
    <section className="min-h-screen flex items-center py-24 bg-white/[0.015]">
      <div className="max-w-7xl mx-auto px-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Copy */}
          <div className="space-y-5">
            <p className="text-sm font-medium text-brand uppercase tracking-wider">
              Knowledge Base
            </p>
            <h2 className="text-3xl sm:text-[2.5rem] font-light text-foreground tracking-tight leading-tight">
              Index your docs,
              <br />
              get grounded answers
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-lg">
              <span className="font-medium text-card-foreground">
                Retrieval-augmented generation
              </span>{" "}
              that actually works. Add web pages, upload PDFs, or create FAQ
              entries -- they&apos;re indexed automatically and searched every
              time a visitor asks a question. Every response cites its source, so
              your bot never hallucinates.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              {[
                { icon: Globe, label: "Web resources" },
                { icon: FileText, label: "PDF documents" },
                { icon: MessageSquare, label: "FAQ entries" },
                { icon: Sparkles, label: "External tools" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-brand/10 bg-white/[0.03] backdrop-blur-lg text-sm"
                >
                  <item.icon className="w-4 h-4 text-quaternary" />
                  <span className="text-card-foreground font-medium">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Visual */}
          <div className="relative overflow-hidden rounded-[2rem]">
            <div className="absolute -inset-8 bg-brand/[0.03] rounded-[2rem] blur-3xl" />
            <div className="relative">
              <MockDocsIndexingUI />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Feature Section: Widget & Handoff ────────────────────────────────────────

function FeatureWidgetAndHandoff() {
  return (
    <section className="min-h-screen flex items-center py-24 bg-white/[0.015]">
      <div className="max-w-7xl mx-auto px-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Visual */}
          <div className="relative order-2 lg:order-1 overflow-hidden rounded-[2rem]">
            <div className="absolute -inset-8 bg-brand/[0.03] rounded-[2rem] blur-3xl" />
            <div className="relative">
              <MockWidgetAndHandoffUI />
            </div>
          </div>

          {/* Copy */}
          <div className="space-y-5 order-1 lg:order-2">
            <p className="text-sm font-medium text-brand uppercase tracking-wider">
              Customization & Handoff
            </p>
            <h2 className="text-3xl sm:text-[2.5rem] font-light text-foreground tracking-tight leading-tight">
              Chat interface that blends in
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-lg">
              <span className="font-medium text-card-foreground">
                Full chat interface customization
              </span>{" "}
              -- colors, fonts, position, tone of voice, intro messages, quick
              actions, and custom CSS so the chat feels native to your site.
              When the AI can&apos;t answer or a visitor requests a human, the
              conversation is{" "}
              <span className="font-medium text-card-foreground">
                relayed to your Telegram
              </span>{" "}
              in real time. Agent replies sync back to the widget instantly.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              {[
                { icon: Palette, label: "Brand styling" },
                { icon: Code, label: "Custom CSS" },
                { icon: Send, label: "Telegram handoff" },
                { icon: Users, label: "Agent takeover" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-brand/10 bg-white/[0.03] backdrop-blur-lg text-sm"
                >
                  <item.icon className="w-4 h-4 text-quaternary" />
                  <span className="text-card-foreground font-medium">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function Landing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [authOpen, setAuthOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<{
    plan: string;
    interval: string;
  } | null>(null);

  // Auto-open auth modal when ?show_auth=true is in the URL
  useEffect(() => {
    if (searchParams.get("show_auth") === "true") {
      setAuthOpen(true);
      // Clean up the URL param
      searchParams.delete("show_auth");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  function handlePricingCta(planId: "starter" | "standard" | "business", interval: "monthly" | "annual") {
    setSelectedPlan({ plan: planId, interval });
    setAuthOpen(true);
  }

  function handleGenericCta() {
    setSelectedPlan(null);
    setAuthOpen(true);
  }

  const authCallbackUrl = selectedPlan
    ? `/app/onboarding?plan=${selectedPlan.plan}&interval=${selectedPlan.interval}`
    : "/app";

  return (
    <div className="min-h-screen bg-background scroll-smooth">
      {/* Inline keyframes for animations */}
      <style>{`
        @keyframes messageIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes typingDot {
          0%, 60%, 100% {
            opacity: 0.3;
            transform: translateY(0);
          }
          30% {
            opacity: 1;
            transform: translateY(-3px);
          }
        }
        @keyframes glowPulse {
          0%, 100% {
            opacity: 0.4;
          }
          50% {
            opacity: 0.7;
          }
        }
      `}</style>

      {/* ── Floating Header ──────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-4 px-4">
        <nav
          className={cn(
            cardVariants({ variant: "glow-secondary" }),
            "flex max-w-full items-center gap-1 bg-card/70 backdrop-blur-2xl rounded-full px-2 py-1.5",
          )}
        >
          {/* Logo */}
          <Link to="/" className="pl-3 pr-4">
            <Logo size="sm" variant="subtle" />
          </Link>

          {/* Nav links */}
          <div className="hidden md:flex items-center">
            <a
              href="#features"
              className="px-4 py-2 text-sm text-muted-foreground hover:text-card-foreground transition-colors"
            >
              Features
            </a>
            <a
              href="#pricing"
              className="px-4 py-2 text-sm text-muted-foreground hover:text-card-foreground transition-colors"
            >
              Pricing
            </a>
            <a
              href="#faq"
              className="px-4 py-2 text-sm text-muted-foreground hover:text-card-foreground transition-colors"
            >
              FAQ
            </a>
            <Link
              to="/docs"
              className="px-4 py-2 text-sm text-muted-foreground hover:text-card-foreground transition-colors"
            >
              Docs
            </Link>
          </div>

          {/* Spacer */}
          <div className="hidden md:block w-16" />

          {/* CTA */}
          <Button
            variant="glow-primary"
            onClick={handleGenericCta}
            className="rounded-full h-9 px-3 sm:px-5 text-[12px] sm:text-[13px] font-medium"
          >
            <span className="sm:hidden">Try free</span>
            <span className="hidden sm:inline">Try ReplyMaven free</span>
          </Button>
        </nav>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-24 pb-20 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-brand/[0.04] rounded-full blur-[120px] animate-[glowPulse_6s_ease-in-out_infinite]" />
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-brand-dark/[0.03] rounded-full blur-[100px] animate-[glowPulse_8s_ease-in-out_2s_infinite]" />
        </div>

        <div className="max-w-7xl mx-auto px-6 relative w-full">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_460px] gap-12 lg:gap-20 items-center">
            {/* Left - Copy */}
            <div>
              {/* <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand/[0.08] border border-brand/15 text-sm text-brand mb-8">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="font-medium">
                  Your AI support agent, live in minutes
                </span>
              </div> */}

              <h1 className="text-[2.75rem] sm:text-[3.5rem] lg:text-[4.5rem] font-light text-foreground tracking-tight leading-[1.06] mb-6">
                AI agent for {" "}
                <span className="text-muted-foreground">
                  90% of your support queries
                </span>
              </h1>

              <p className="text-lg text-muted-foreground max-w-xl leading-relaxed mb-10">
                AI customer support agent with expert knowledge of your product to automate support queries. Go live in minutes.
              </p>

              <div className="flex flex-col sm:flex-row items-start gap-4 mb-8">
                <Button
                  variant="glow-primary"
                  onClick={handleGenericCta}
                  className="rounded-full w-full sm:w-auto px-8 h-12 text-[15px] font-medium"
                >
                  Start Free
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button
                  variant="glow-secondary"
                  className="rounded-full w-full sm:w-auto px-8 h-12 text-[15px]"
                  onClick={() => { const rm = (window as unknown as Record<string, unknown>).ReplyMaven as { open?: () => void } | undefined; rm?.open?.(); }}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Try Interactive Demo
                </Button>
              </div>

              <div className="flex items-center gap-6 text-sm text-quaternary">
                <span className="flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand" />
                  7-day free trial
                </span>
                <span className="flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand" />
                  5-minute setup
                </span>
              </div>
            </div>

            {/* Right - Animated Widget */}
            <div className="flex justify-center lg:justify-end">
              <AnimatedChatWidget />
            </div>
          </div>
        </div>
      </section>
      {/* ── Feature Bento Grid ───────────────────────────────────────────── */}
      <FeatureBentoGrid />

      {/* ── Feature Detail Sections ──────────────────────────────────────── */}
      <FeatureDocsIndexing />
      <FeatureToolCalls />
      <FeatureWidgetAndHandoff />
      <FeatureBooking />
      <FeatureContactForm />
      <FeatureAnalytics />

      {/* ── How It Works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="min-h-screen flex items-center py-24">
        <div className="max-w-7xl mx-auto px-6 w-full">
          <div className="mb-16">
            <p className="text-sm font-medium text-brand uppercase tracking-wider mb-4">
              How It Works
            </p>
            <h2 className="text-3xl sm:text-[2.75rem] font-light text-foreground tracking-tight leading-tight">
              Go live in minutes
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Step 1 */}
            <div
              className={cn(
                cardVariants({ variant: "glow-secondary" }),
                "p-7 space-y-4",
              )}
            >
              <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
                <FileText className="w-5 h-5 text-brand" />
              </div>
              <h3 className="text-lg font-medium text-card-foreground flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-card-foreground text-background text-xs font-semibold">
                  1
                </span>
                Add your knowledge
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Upload docs, paste URLs, or write FAQs. We index everything
                automatically for AI retrieval.
              </p>
              {/* Mini resource list */}
              <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-brand" />
                  <span className="text-[12px] text-secondary-foreground truncate flex-1">
                    docs.example.com
                  </span>
                  <Check className="w-3.5 h-3.5 text-brand" />
                </div>
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-brand" />
                  <span className="text-[12px] text-secondary-foreground truncate flex-1">
                    product-guide.pdf
                  </span>
                  <Check className="w-3.5 h-3.5 text-brand" />
                </div>
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-brand" />
                  <span className="text-[12px] text-secondary-foreground truncate flex-1">
                    12 FAQ entries
                  </span>
                  <Check className="w-3.5 h-3.5 text-brand" />
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div
              className={cn(
                cardVariants({ variant: "glow-secondary" }),
                "p-7 space-y-4",
              )}
            >
              <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
                <Palette className="w-5 h-5 text-brand" />
              </div>

              <h3 className="text-lg font-medium text-card-foreground flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-card-foreground text-background text-xs font-semibold">
                  2
                </span> Customize your bot
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Match your brand colors, set the tone of voice, and configure
                quick actions. Make it yours.
              </p>
              {/* Mini customization panel */}
              <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-quaternary">Colors</span>
                  <div className="flex gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-brand ring-2 ring-brand/30 ring-offset-1 ring-offset-card" />
                    <div className="w-5 h-5 rounded-full bg-blue-500" />
                    <div className="w-5 h-5 rounded-full bg-violet-500" />
                    <div className="w-5 h-5 rounded-full bg-orange-500" />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-quaternary">Tone</span>
                  <span className="text-[12px] bg-brand/10 text-brand px-2.5 py-0.5 rounded-full font-medium">
                    Friendly
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-quaternary">Position</span>
                  <span className="text-[12px] bg-white/[0.05] px-2.5 py-0.5 rounded-full text-muted-foreground">
                    Bottom-right
                  </span>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div
              className={cn(
                cardVariants({ variant: "glow-secondary" }),
                "p-7 space-y-4",
              )}
            >
              <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
                <Code className="w-5 h-5 text-brand" />
              </div>
              <h3 className="text-lg font-medium text-card-foreground flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-card-foreground text-background text-xs font-semibold">
                  3
                </span>
                Embed & go live
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Copy one script tag into your site. That's it. Your AI support
                bot is live and ready.
              </p>
              {/* Mini code snippet */}
              <div className="bg-code rounded-xl p-3 overflow-x-auto border border-white/[0.04]">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-2 h-2 rounded-full bg-[#ff5f57]" />
                  <div className="w-2 h-2 rounded-full bg-[#febc2e]" />
                  <div className="w-2 h-2 rounded-full bg-[#28c840]" />
                </div>
                <code className="text-[11px] leading-relaxed text-brand font-mono whitespace-pre">
                  {
                    '<script\n  src="replymaven.com/\n    widget-embed.js"\n  data-project="my-bot"\n></script>'
                  }
                </code>
              </div>
            </div>
          </div>
        </div>
      </section>



      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="min-h-screen flex items-center py-24 bg-white/[0.015]">
        <div className="max-w-7xl mx-auto px-6 w-full">
          <div className="mb-16">
            <p className="text-sm font-medium text-brand uppercase tracking-wider mb-4">
              Pricing
            </p>
            <h2 className="text-3xl sm:text-[2.75rem] font-light text-foreground tracking-tight leading-tight">
              Powerful AI support agent
              <br />
              at unbeatable price
            </h2>
          </div>

          <PricingCards onCtaClick={handlePricingCta} />

          {/* Enterprise card */}
          <div
            className={cn(
              cardVariants({ variant: "glow-secondary" }),
              "mt-8 p-8",
            )}
          >
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="space-y-2 md:max-w-xs shrink-0">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-medium text-card-foreground">
                    Enterprise
                  </h3>
                  <span className="text-[11px] bg-brand/10 text-brand px-2.5 py-1 rounded-full font-medium">
                    Custom Pricing
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  For organizations with advanced needs. Unlimited everything
                  with dedicated support.
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
                    className="flex items-center gap-2 text-sm text-secondary-foreground"
                  >
                    <Check className="w-4 h-4 text-brand shrink-0" />
                    {feature}
                  </span>
                ))}
              </div>

              <Button
                variant="glow-secondary"
                onClick={handleGenericCta}
                className="shrink-0 rounded-xl h-11 px-6 bg-white/[0.05] hover:bg-white/[0.08] border-white/[0.06]"
              >
                Contact Sales
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="py-24">
        <div className="max-w-3xl mx-auto px-6">
          <div className="mb-12">
            <p className="text-sm font-medium text-brand uppercase tracking-wider mb-4">
              FAQ
            </p>
            <h2 className="text-3xl sm:text-[2.75rem] font-light text-foreground tracking-tight leading-tight">
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
      <section className="py-24 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-brand/[0.04] rounded-full blur-[100px]" />
        </div>

        <div className="max-w-7xl mx-auto px-6 relative">
          <h2 className="text-3xl sm:text-[2.75rem] font-light text-foreground tracking-tight leading-tight mb-5">
            Ready to get started
          </h2>
          <p className="text-muted-foreground text-lg mb-10">
            Set up ReplyMaven for free and get a 7-day free trial.
          </p>
          <Button
            variant="glow-primary"
            onClick={handleGenericCta}
            className="rounded-full px-8 h-12 text-[15px] font-medium"
          >
            Try ReplyMaven free
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="pb-8 px-6">
        <div
          className={cn(
            cardVariants({ variant: "glow-primary" }),
            "max-w-7xl mx-auto p-10 rounded-3xl",
          )}
        >
          <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr] gap-10 mb-10">
            {/* Brand */}
            <div className="space-y-4">
              <Logo size="sm" variant="subtle" />
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
                AI-powered customer support that knows your product. Built for
                startups and growing teams.
              </p>
              {/* Social icons */}
              <div className="flex items-center gap-2 pt-1">
                <a
                  href="#"
                  className="w-9 h-9 rounded-full bg-white/[0.05] flex items-center justify-center hover:bg-white/[0.1] transition-colors border border-white/[0.06]"
                >
                  <Linkedin className="w-4 h-4 text-muted-foreground" />
                </a>
                <a
                  href="#"
                  className="w-9 h-9 rounded-full bg-white/[0.05] flex items-center justify-center hover:bg-white/[0.1] transition-colors border border-white/[0.06]"
                >
                  <Twitter className="w-4 h-4 text-muted-foreground" />
                </a>
              </div>
            </div>

            {/* Pages */}
            <div className="space-y-4">
              <h4 className="text-[11px] font-medium text-quaternary uppercase tracking-wider">
                Pages
              </h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Home", href: "#" },
                  { label: "Features", href: "#features" },
                  { label: "Pricing", href: "#pricing" },
                  { label: "FAQ", href: "#faq" },
                  { label: "Documentation", href: "/docs" },
                ].map((item) => (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      className="text-sm text-muted-foreground hover:text-card-foreground transition-colors"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Information */}
            <div className="space-y-4">
              <h4 className="text-[11px] font-medium text-quaternary uppercase tracking-wider">
                Information
              </h4>
              <ul className="space-y-2.5">
                {["Contact", "Privacy Policy", "Terms of Service"].map(
                  (item) => (
                    <li key={item}>
                      <a
                        href="#"
                        className="text-sm text-muted-foreground hover:text-card-foreground transition-colors"
                      >
                        {item}
                      </a>
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>

          {/* Copyright bar */}
          <div className="pt-6 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-sm text-quaternary">
              &copy; {new Date().getFullYear()} ReplyMaven. All rights
              reserved.
            </p>
            <a href="https://launchfast.shop/" target="_blank" className="text-sm text-quaternary flex items-center gap-2 outline-brand outline-offset-4 hover:outline-brand/50 transition-all duration-300 underline decoration-dashed">
              <Heart className="w-4 h-4 text-brand/50" /> LaunchFast.shop product
            </a>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} callbackURL={authCallbackUrl} />
    </div>
  );
}

export default Landing;
