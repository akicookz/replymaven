import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import AuthModal from "@/components/AuthModal";
import { Logo } from "@/components/Logo";
import {
  MessageSquare,
  Code,
  Palette,
  User,
  Bell,
  Monitor,
  Settings,
  ChevronRight,
  Copy,
  Check,
  ArrowRight,
  ExternalLink,
  Terminal,
  Layers,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  children?: { id: string; label: string }[];
}

// ─── Navigation Structure ─────────────────────────────────────────────────────

const navItems: NavItem[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    icon: <Terminal className="w-4 h-4" />,
    children: [
      { id: "installation", label: "Installation" },
      { id: "basic-setup", label: "Basic Setup" },
      { id: "how-it-works", label: "How It Works" },
    ],
  },
  {
    id: "widget-api",
    label: "Widget API",
    icon: <Code className="w-4 h-4" />,
    children: [
      { id: "open-close", label: "Open / Close / Toggle" },
      { id: "send-message", label: "Send Message" },
      { id: "identify", label: "Identify Visitors" },
      { id: "set-metadata", label: "Set Custom Metadata" },
      { id: "page-context", label: "Page Context" },
      { id: "notifications", label: "Request Notifications" },
      { id: "open-inquiry-form", label: "Open Inquiry Form" },
    ],
  },
  {
    id: "customization",
    label: "Customization",
    icon: <Palette className="w-4 h-4" />,
    children: [
      { id: "colors-fonts", label: "Colors & Fonts" },
      { id: "position", label: "Widget Position" },
      { id: "header-avatar", label: "Header & Avatar" },
      { id: "home-screen", label: "Home Screen" },
      { id: "quick-actions", label: "Quick Actions" },
      { id: "quick-topics", label: "Quick Topics" },
      { id: "custom-css", label: "Custom CSS" },
    ],
  },
  {
    id: "visitor-identity",
    label: "Visitor Identity",
    icon: <User className="w-4 h-4" />,
    children: [
      { id: "identify-api", label: "identify() API" },
      { id: "auto-metadata", label: "Auto-Collected Metadata" },
      { id: "custom-metadata-guide", label: "Custom Metadata" },
      { id: "retroactive-updates", label: "Retroactive Updates" },
    ],
  },
  {
    id: "notifications-section",
    label: "Notifications",
    icon: <Bell className="w-4 h-4" />,
    children: [
      { id: "browser-notifications", label: "Browser Notifications" },
      { id: "unread-badge", label: "Unread Badge" },
      { id: "notification-timing", label: "When Notifications Trigger" },
    ],
  },
  {
    id: "conversations",
    label: "Conversations",
    icon: <MessageSquare className="w-4 h-4" />,
    children: [
      { id: "conversation-lifecycle", label: "Conversation Lifecycle" },
      { id: "persistence", label: "Session Persistence" },
      { id: "real-time-delivery", label: "Real-Time Delivery" },
      { id: "handoff", label: "Agent Handoff" },
    ],
  },
  {
    id: "knowledge-base",
    label: "Knowledge Base",
    icon: <Layers className="w-4 h-4" />,
    children: [
      { id: "web-pages", label: "Web Pages" },
      { id: "pdfs", label: "PDFs" },
      { id: "faqs", label: "FAQs" },
      { id: "rag-overview", label: "How RAG Works" },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    icon: <Settings className="w-4 h-4" />,
    children: [
      { id: "telegram", label: "Telegram" },
      { id: "inquiries", label: "Inquiries" },
      { id: "tone-of-voice", label: "Tone of Voice" },
      { id: "knowledge-refinement", label: "Knowledge Refinement" },
    ],
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: <Monitor className="w-4 h-4" />,
    children: [
      { id: "spa-integration", label: "SPA Integration" },
      { id: "csp", label: "Content Security Policy" },
      { id: "multiple-widgets", label: "Multiple Widgets" },
    ],
  },
];

// ─── Code Block Component ─────────────────────────────────────────────────────

function CodeBlock({
  code,
  language = "html",
  title,
}: {
  code: string;
  language?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden my-4">
      {title && (
        <div className="bg-muted/50 px-4 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {title}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
            {language}
          </span>
        </div>
      )}
      <div className="relative group">
        <pre className="bg-[#1a1a2e] text-[#e2e8f0] p-4 overflow-x-auto text-[13px] leading-relaxed font-mono">
          <code>{code}</code>
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-3 right-3 p-1.5 rounded-md bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-all opacity-0 group-hover:opacity-100"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Info Callout ─────────────────────────────────────────────────────────────

function Callout({
  type = "info",
  title,
  children,
}: {
  type?: "info" | "warning" | "tip";
  title?: string;
  children: React.ReactNode;
}) {
  const styles = {
    info: "bg-primary/[0.04] border-primary/15 text-foreground",
    warning: "bg-warning/[0.06] border-warning/20 text-foreground",
    tip: "bg-success/[0.06] border-success/20 text-foreground",
  };
  const labels = { info: "Note", warning: "Warning", tip: "Tip" };

  return (
    <div className={`rounded-xl border p-4 my-4 ${styles[type]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {title ?? labels[type]}
      </p>
      <div className="text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

// ─── Property Table ───────────────────────────────────────────────────────────

function PropTable({
  rows,
}: {
  rows: { name: string; type: string; required?: boolean; description: string }[];
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden my-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/40 border-b border-border text-left">
            <th className="px-4 py-2.5 font-semibold text-foreground">
              Property
            </th>
            <th className="px-4 py-2.5 font-semibold text-foreground">Type</th>
            <th className="px-4 py-2.5 font-semibold text-foreground hidden sm:table-cell">
              Required
            </th>
            <th className="px-4 py-2.5 font-semibold text-foreground">
              Description
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.name}
              className="border-b border-border last:border-b-0"
            >
              <td className="px-4 py-2.5 font-mono text-[13px] text-primary whitespace-nowrap">
                {row.name}
              </td>
              <td className="px-4 py-2.5 font-mono text-[13px] text-muted-foreground whitespace-nowrap">
                {row.type}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                {row.required ? "Yes" : "No"}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">
                {row.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Section Heading ──────────────────────────────────────────────────────────

function SectionHeading({
  id,
  level = 2,
  children,
}: {
  id: string;
  level?: 2 | 3;
  children: React.ReactNode;
}) {
  const Tag = level === 2 ? "h2" : "h3";
  const className =
    level === 2
      ? "text-2xl font-bold text-foreground tracking-tight mt-14 mb-4 scroll-mt-24"
      : "text-lg font-semibold text-foreground mt-10 mb-3 scroll-mt-24";

  return (
    <Tag id={id} className={className}>
      <a href={`#${id}`} className="group">
        {children}
        <span className="ml-2 opacity-0 group-hover:opacity-40 transition-opacity text-muted-foreground">
          #
        </span>
      </a>
    </Tag>
  );
}

// ─── Inline Code ──────────────────────────────────────────────────────────────

function IC({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-muted px-1.5 py-0.5 rounded-md text-[13px] font-mono text-foreground">
      {children}
    </code>
  );
}

// ─── Docs Page ────────────────────────────────────────────────────────────────

function Docs() {
  const [activeSection, setActiveSection] = useState("installation");
  const [authOpen, setAuthOpen] = useState(false);

  // Track scroll position to highlight active nav item
  useEffect(() => {
    function handleScroll() {
      const headings = document.querySelectorAll("[id]");
      let current = "installation";
      for (const heading of headings) {
        const el = heading as HTMLElement;
        if (el.getBoundingClientRect().top <= 120) {
          current = el.id;
        }
      }
      setActiveSection(current);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/">
              <Logo size="sm" variant="subtle" />
            </Link>
            <span className="text-sm text-muted-foreground font-medium hidden sm:block">
              Documentation
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="rounded-full h-8 text-[13px] px-4"
              onClick={() => setAuthOpen(true)}
            >
              Log in
            </Button>
            <Button
              className="rounded-full glow-surface h-8 text-[13px] px-4"
              onClick={() => setAuthOpen(true)}
            >
              Get Started
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto flex pt-14">
        {/* ── Sidebar Navigation ──────────────────────────────────────── */}
        <aside className="hidden lg:block w-64 shrink-0 border-r border-border sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-6 px-4">
          <nav className="space-y-1">
            {navItems.map((item) => (
              <div key={item.id}>
                <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-foreground">
                  {item.icon}
                  {item.label}
                </div>
                {item.children && (
                  <div className="ml-6 space-y-0.5 mb-3">
                    {item.children.map((child) => (
                      <a
                        key={child.id}
                        href={`#${child.id}`}
                        className={`block px-3 py-1.5 text-[13px] rounded-md transition-colors ${
                          activeSection === child.id
                            ? "text-primary bg-primary/[0.06] font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        }`}
                      >
                        {child.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        {/* ── Main Content ────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 px-6 lg:px-12 py-10 pb-32">
          <div className="max-w-3xl">
            {/* Hero */}
            <div className="mb-12">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/[0.06] border border-primary/10 text-xs text-primary font-medium mb-4">
                <Code className="w-3 h-3" />
                Developer Documentation
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight mb-4">
                ReplyMaven Documentation
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Everything you need to install, customize, and integrate
                the ReplyMaven chat widget on your website.
              </p>
            </div>

            {/* ── Getting Started ──────────────────────────────────────── */}
            <SectionHeading id="installation">Installation</SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Add the ReplyMaven widget to your website with a single script tag.
              Place it anywhere in your HTML -- typically just before the
              closing <IC>{"</body>"}</IC> tag.
            </p>
            <CodeBlock
              title="Add to your HTML"
              language="html"
              code={`<script src="https://widget.replymaven.com/widget-embed.js"
        data-project="your-project-slug"></script>`}
            />
            <p className="text-muted-foreground leading-relaxed mb-2">
              Replace <IC>your-project-slug</IC> with your project's slug
              from the dashboard. You can find it under{" "}
              <strong>Settings &rarr; Installation</strong>.
            </p>

            <Callout type="tip">
              The widget script is lightweight (~12KB gzipped) and loads asynchronously.
              It won't block your page rendering.
            </Callout>

            <SectionHeading id="basic-setup" level={3}>
              Basic Setup
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Once the script loads, the widget automatically appears as a
              floating button in the bottom-right corner of your page (configurable).
              Your visitors can click it to open the chat window and start
              talking to your AI assistant.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Before deploying, make sure you've:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4 ml-1">
              <li>Created a project in the dashboard</li>
              <li>
                Added at least one knowledge source (web page, FAQ, or PDF)
              </li>
              <li>Customized the widget appearance to match your brand</li>
              <li>Tested the chatbot with a few sample questions</li>
            </ol>

            <SectionHeading id="how-it-works" level={3}>
              How It Works
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              When a visitor sends a message:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4 ml-1">
              <li>
                The message is sent to the ReplyMaven API
              </li>
              <li>
                The API searches your knowledge base (web pages, PDFs, FAQs)
                using RAG (Retrieval-Augmented Generation)
              </li>
              <li>
                Relevant context is passed to the AI model along with your
                tone of voice configuration
              </li>
              <li>
                The AI response is streamed back in real-time (SSE) and
                displayed in the chat
              </li>
              <li>
                If the AI can't answer confidently, it hands off to a human
                agent via Telegram
              </li>
            </ol>

            {/* ── Widget API ──────────────────────────────────────────── */}
            <SectionHeading id="open-close">
              Widget API: Open / Close / Toggle
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              The widget exposes a JavaScript API on{" "}
              <IC>window.ReplyMaven</IC> that you can use to control the
              widget programmatically.
            </p>
            <CodeBlock
              title="Open, close, or toggle the widget"
              language="javascript"
              code={`// Open the chat widget
window.ReplyMaven.open();

// Close the chat widget
window.ReplyMaven.close();

// Toggle open/close
window.ReplyMaven.toggle();`}
            />

            <SectionHeading id="send-message" level={3}>
              Send Message
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Programmatically send a message on behalf of the visitor. This
              opens the widget if it's closed, creates a conversation if
              needed, and triggers the AI response.
            </p>
            <CodeBlock
              title="Send a message programmatically"
              language="javascript"
              code={`window.ReplyMaven.sendMessage("How do I reset my password?");`}
            />
            <Callout type="tip">
              Use this to trigger contextual help. For example, on an error
              page you could automatically send "I'm seeing an error on the
              checkout page" to start the conversation.
            </Callout>

            <SectionHeading id="identify" level={3}>
              Identify Visitors
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Associate visitor identity and custom metadata with the
              conversation. This information is visible to agents in the
              dashboard and helps provide personalized support.
            </p>
            <CodeBlock
              title="Identify a visitor"
              language="javascript"
              code={`window.ReplyMaven.identify({
  name: "Jane Smith",
  email: "jane@example.com",
  phone: "+1-555-0123",
  metadata: {
    plan: "pro",
    accountId: "acc_12345",
    company: "Acme Corp",
  },
});`}
            />

            <PropTable
              rows={[
                {
                  name: "name",
                  type: "string",
                  description: "Visitor's display name",
                },
                {
                  name: "email",
                  type: "string",
                  description:
                    "Visitor's email address. Used for handoff notifications.",
                },
                {
                  name: "phone",
                  type: "string",
                  description: "Visitor's phone number",
                },
                {
                  name: "metadata",
                  type: "Record<string, string>",
                  description:
                    "Arbitrary key-value pairs. Visible in the dashboard conversation detail.",
                },
              ]}
            />

            <Callout type="info">
              If a conversation already exists, calling <IC>identify()</IC>{" "}
              will retroactively update the conversation record on the
              server. You don't need to call it before the first message.
            </Callout>

            <SectionHeading id="set-metadata" level={3}>
              Set Custom Metadata
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Set or update arbitrary metadata on the current conversation
              without changing visitor identity. Useful for tracking
              application state.
            </p>
            <CodeBlock
              title="Set custom metadata"
              language="javascript"
              code={`window.ReplyMaven.setMetadata({
  currentPage: "/checkout",
  cartTotal: "$149.99",
  itemCount: "3",
  experimentGroup: "variant-b",
});`}
            />
            <Callout type="warning">
              Metadata values must be strings. Numbers, booleans, and
              objects are not supported -- convert them to strings first.
            </Callout>

            <SectionHeading id="notifications" level={3}>
              Request Notifications
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Request browser notification permission. By default, this is
              triggered automatically when a conversation is handed off to a
              human agent. You can also call it earlier if you want to prompt
              the visitor sooner.
            </p>
            <CodeBlock
              title="Request notification permission"
              language="javascript"
              code={`window.ReplyMaven.requestNotifications();`}
            />

            <SectionHeading id="open-inquiry-form" level={3}>
              Open Inquiry Form
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Open the inquiry form programmatically. If the widget is
              closed, it will be opened first. The inquiry form must be
              enabled in your project settings under{" "}
              <strong>Inquiries</strong>.
            </p>
            <CodeBlock
              title="Open the inquiry form"
              language="javascript"
              code={`window.ReplyMaven.openInquiryForm();`}
            />
            <Callout type="tip">
              Use this to trigger the inquiry form from custom buttons or
              links on your page -- for example, a "Contact Us" button in
              your navigation.
            </Callout>

            {/* ── Customization ───────────────────────────────────────── */}
            <SectionHeading id="colors-fonts">
              Customization: Colors & Fonts
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              All visual customization is done through the dashboard under{" "}
              <strong>Widget &rarr; Appearance</strong>. Changes are applied
              immediately to all pages using your widget.
            </p>

            <div className="rounded-xl border border-border overflow-hidden my-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-left">
                    <th className="px-4 py-2.5 font-semibold text-foreground">
                      Setting
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-foreground">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      Brand Color
                    </td>
                    <td className="px-4 py-2.5">
                      Used for the trigger button, header tint, send button,
                      visitor bubbles, and accent elements. Hex format (e.g.,
                      #2563eb). The chat window uses a frosted glass style
                      with this color as a tint.
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      Brand Text
                    </td>
                    <td className="px-4 py-2.5">
                      Text color on branded elements (buttons, icons, header).
                      Hex format (e.g., #ffffff).
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      Font Family
                    </td>
                    <td className="px-4 py-2.5">
                      Custom font for the widget. Falls back to the system
                      font stack.
                    </td>
                  </tr>
                  <tr className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      Border Radius
                    </td>
                    <td className="px-4 py-2.5">
                      Controls the roundness of the chat window corners (0-50px).
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <SectionHeading id="position" level={3}>
              Widget Position
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              The widget can be positioned in either corner of the screen:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-4 ml-1">
              <li>
                <strong>Bottom Right</strong> (default) -- standard position
                for most websites
              </li>
              <li>
                <strong>Bottom Left</strong> -- useful if you have other
                elements in the bottom-right corner
              </li>
            </ul>

            <SectionHeading id="header-avatar" level={3}>
              Header & Avatar
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Configure the chat window header text and bot avatar. The
              avatar appears in:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-4 ml-1">
              <li>The floating trigger button (replaces the default chat icon)</li>
              <li>The chat header</li>
              <li>The home screen</li>
              <li>Next to each bot/agent message</li>
              <li>Browser notification icon</li>
            </ul>
            <Callout type="tip">
              Upload a square image (at least 128x128px) for the best results.
              PNG or WebP with a transparent background works well.
            </Callout>

            <SectionHeading id="home-screen" level={3}>
              Home Screen
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              The home screen is the first thing visitors see when they open
              the widget. It includes:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-4 ml-1">
              <li>
                <strong>Banner image</strong> -- a header visual (falls back
                to primary color)
              </li>
              <li>
                <strong>Title & subtitle</strong> -- e.g., "How can we help?"
              </li>
              <li>
                <strong>Ask box</strong> -- a quick input that transitions
                to the chat view
              </li>
              <li>
                <strong>Home links</strong> -- up to 5 links to external
                resources (docs, blog, status page)
              </li>
              <li>
                <strong>Leave a message</strong> -- a contact form button
                (if enabled)
              </li>
            </ul>

            <SectionHeading id="quick-actions" level={3}>
              Quick Actions
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Quick actions are buttons displayed on the home screen. Each
              action has a label, an icon, and a predefined action (message
              to send). They help visitors get started quickly.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Configure them in the dashboard under{" "}
              <strong>Quick Actions</strong>. You can set the sort order to
              control the display order.
            </p>

            <SectionHeading id="quick-topics" level={3}>
              Quick Topics
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Quick topics are suggestion chips shown above the chat input.
              When clicked, they send a predefined prompt to the AI. Topics
              disappear after the first message is sent.
            </p>

            <SectionHeading id="custom-css" level={3}>
              Custom CSS
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              For advanced styling needs, you can inject custom CSS that
              applies to the widget. This is useful for overriding specific
              styles or matching complex brand guidelines.
            </p>
            <CodeBlock
              title="Example custom CSS"
              language="css"
              code={`/* Make the trigger button larger */
.rm-trigger {
  width: 72px;
  height: 72px;
}

/* Custom message bubble style */
.rm-message-row.bot .rm-message {
  background: #f0f9ff;
  border: 1px solid #bae6fd;
}

/* Hide the powered-by footer */
.rm-powered {
  display: none;
}`}
            />
            <Callout type="warning">
              Custom CSS operates on the widget's internal class names
              (prefixed with <IC>rm-</IC>). These are considered stable but
              may change in major updates.
            </Callout>

            {/* ── Visitor Identity ────────────────────────────────────── */}
            <SectionHeading id="identify-api">
              Visitor Identity: identify() API
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              The <IC>identify()</IC> method links a visitor's identity to
              their chat conversation. Call it as soon as you know who the
              visitor is -- typically after they log in.
            </p>
            <CodeBlock
              title="Identify after login"
              language="javascript"
              code={`// After your auth callback
function onUserLogin(user) {
  window.ReplyMaven.identify({
    name: user.fullName,
    email: user.email,
    metadata: {
      userId: user.id,
      plan: user.subscription.plan,
      signupDate: user.createdAt,
    },
  });
}`}
            />

            <SectionHeading id="auto-metadata" level={3}>
              Auto-Collected Metadata
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              The widget automatically collects the following metadata for
              every conversation. This data is visible in the dashboard
              conversation detail panel.
            </p>

            <PropTable
              rows={[
                {
                  name: "browser",
                  type: "string",
                  description:
                    'Parsed browser name and version (e.g., "Chrome 120")',
                },
                {
                  name: "os",
                  type: "string",
                  description:
                    'Parsed operating system (e.g., "macOS 14", "iOS 17")',
                },
                {
                  name: "device",
                  type: "string",
                  description:
                    '"desktop", "tablet", or "mobile"',
                },
                {
                  name: "screenResolution",
                  type: "string",
                  description:
                    'Screen dimensions (e.g., "1920x1080")',
                },
                {
                  name: "language",
                  type: "string",
                  description:
                    'Browser language (e.g., "en-US")',
                },
                {
                  name: "referrer",
                  type: "string",
                  description: "The page that linked to the current page",
                },
                {
                  name: "currentPageUrl",
                  type: "string",
                  description: "Full URL of the page where the widget is loaded",
                },
                {
                  name: "pageTitle",
                  type: "string",
                  description: "The document title of the current page",
                },
                {
                  name: "online",
                  type: "string",
                  description:
                    '"active" if the tab is visible, "inactive" if hidden',
                },
                {
                  name: "country",
                  type: "string",
                  description:
                    "Visitor's country (auto-detected server-side via Cloudflare)",
                },
                {
                  name: "city",
                  type: "string",
                  description: "Visitor's city (server-side)",
                },
                {
                  name: "timezone",
                  type: "string",
                  description: "Visitor's timezone (server-side)",
                },
                {
                  name: "ip",
                  type: "string",
                  description: "Visitor's IP address (server-side)",
                },
              ]}
            />

            <Callout type="info">
              The first 9 fields are collected client-side by the widget.
              The last 4 are enriched server-side from Cloudflare headers.
            </Callout>

            <SectionHeading id="custom-metadata-guide" level={3}>
              Custom Metadata
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              In addition to auto-collected data, you can attach any
              key-value pairs to a conversation using either{" "}
              <IC>identify({"{ metadata }"})</IC> or{" "}
              <IC>setMetadata()</IC>.
            </p>
            <CodeBlock
              title="Common metadata patterns"
              language="javascript"
              code={`// E-commerce: track cart context
window.ReplyMaven.setMetadata({
  cartTotal: "$249.99",
  itemCount: "5",
  couponApplied: "SAVE20",
});

// SaaS: track subscription context
window.ReplyMaven.identify({
  name: "John Doe",
  email: "john@company.com",
  metadata: {
    plan: "enterprise",
    mrr: "$499",
    accountAge: "18 months",
    teamSize: "25",
  },
});

// Support: track page context
window.ReplyMaven.setMetadata({
  currentPage: window.location.pathname,
  lastAction: "clicked-upgrade-button",
  errorCode: "ERR_PAYMENT_DECLINED",
});`}
            />

            {/* ── Page Context ──────────────────────────────────────── */}
            <SectionHeading id="page-context" level={3}>
              Page Context
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Use <IC>setPageContext()</IC> to send contextual data that the
              AI <strong>actively uses</strong> when generating responses. This
              is different from <IC>setMetadata()</IC>, which is only visible
              on your dashboard — page context is injected into the AI prompt
              so the bot can tailor its answers.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              The widget automatically sends the current page URL and title
              with every message, so basic page awareness works out of the box.
              Use <IC>setPageContext()</IC> to add richer, app-specific data.
            </p>
            <CodeBlock
              title="Set page context on a pricing page"
              language="javascript"
              code={`// On your pricing page — the AI will know the visitor
// is looking at pricing and can answer accordingly
window.ReplyMaven.setPageContext({
  page: "Pricing",
  plan: "Pro",
  billingCycle: "annual",
  cartTotal: "$249.00",
});`}
            />
            <CodeBlock
              title="Update context on SPA route changes"
              language="javascript"
              code={`// In a React app, update context when the route changes
useEffect(() => {
  window.ReplyMaven.setPageContext({
    page: location.pathname,
    section: "account-settings",
  });
}, [location.pathname]);`}
            />
            <p className="text-muted-foreground leading-relaxed mb-4">
              <strong>Key behaviors:</strong>
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4 ml-1">
              <li>
                Context is sent <strong>per-message</strong>, not stored on
                the conversation — it reflects where the visitor is right now.
              </li>
              <li>
                Each call <strong>replaces</strong> the previous context
                (it does not merge).
              </li>
              <li>
                Keys are freeform <IC>{"Record<string, string>"}</IC> — you
                decide what data is relevant for your use case.
              </li>
            </ul>

            <SectionHeading id="retroactive-updates" level={3}>
              Retroactive Updates
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Both <IC>identify()</IC> and <IC>setMetadata()</IC> work
              retroactively. If a conversation already exists, the widget
              automatically syncs the updated data to the server via a PATCH
              request. The new metadata is merged with existing
              metadata -- it doesn't replace it.
            </p>
            <CodeBlock
              title="Update identity mid-conversation"
              language="javascript"
              code={`// Visitor starts chatting anonymously, then logs in
// The existing conversation is updated with their identity
window.ReplyMaven.identify({
  name: "Jane Smith",
  email: "jane@example.com",
});

// Later, update just the metadata
window.ReplyMaven.setMetadata({
  lastPurchase: "2024-01-15",
  lifetimeValue: "$1,200",
});`}
            />

            {/* ── Notifications ───────────────────────────────────────── */}
            <SectionHeading id="browser-notifications">
              Browser Notifications
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              ReplyMaven uses the browser's{" "}
              <a
                href="https://developer.mozilla.org/en-US/docs/Web/API/Notification"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Notification API
                <ExternalLink className="w-3 h-3 inline ml-0.5 -mt-0.5" />
              </a>{" "}
              to alert visitors when an agent replies. This works as long as
              the page is open (it does not require a service worker).
            </p>

            <h4 className="font-semibold text-foreground mt-6 mb-2">
              Permission Flow
            </h4>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4 ml-1">
              <li>
                By default, the widget requests notification permission when
                a conversation is <strong>handed off to a human agent</strong>
              </li>
              <li>
                The browser shows its native permission prompt
              </li>
              <li>
                If granted, the visitor receives desktop notifications for
                new agent messages while the widget is minimized or the tab is
                in the background
              </li>
              <li>
                Clicking the notification opens and focuses the widget
              </li>
            </ol>

            <Callout type="tip">
              If you want to request permission earlier (e.g., when the
              visitor first opens the widget), call{" "}
              <IC>window.ReplyMaven.requestNotifications()</IC>.
            </Callout>

            <SectionHeading id="unread-badge" level={3}>
              Unread Badge
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              When new messages arrive while the widget is closed, a red
              badge with the unread count appears on the trigger button. The
              badge automatically clears when the visitor opens the widget.
            </p>

            <SectionHeading id="notification-timing" level={3}>
              When Notifications Trigger
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Notifications and unread badges are triggered when:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-4 ml-1">
              <li>
                A new <strong>agent message</strong> arrives (from Telegram
                or dashboard) while the widget is closed
              </li>
              <li>
                A new <strong>bot message</strong> arrives via polling while
                the widget is closed
              </li>
              <li>
                The tab is in the background (
                <IC>document.hidden === true</IC>)
              </li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Notifications are <strong>not</strong> shown when the widget
              is open and the tab is active -- the visitor is already
              looking at the chat.
            </p>

            {/* ── Conversations ────────────────────────────────────────── */}
            <SectionHeading id="conversation-lifecycle">
              Conversation Lifecycle
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Every conversation goes through these states:
            </p>
            <div className="rounded-xl border border-border p-5 my-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="w-24 text-[13px] font-mono font-medium text-primary">
                  active
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                <span className="text-sm text-muted-foreground">
                  Visitor is chatting with the AI bot
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-24 text-[13px] font-mono font-medium text-warning">
                  waiting_agent
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                <span className="text-sm text-muted-foreground">
                  Human help was requested; AI may continue until an agent replies
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-24 text-[13px] font-mono font-medium text-success">
                  agent_replied
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                <span className="text-sm text-muted-foreground">
                  Agent has replied; AI stays silent until `@BotName` hands control back
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-24 text-[13px] font-mono font-medium text-muted-foreground">
                  closed
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                <span className="text-sm text-muted-foreground">
                  Conversation ended by agent from the dashboard
                </span>
              </div>
            </div>

            <SectionHeading id="persistence" level={3}>
              Session Persistence
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              The widget persists conversations across page navigations and
              refreshes:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-4 ml-1">
              <li>
                <strong>Visitor ID</strong> is stored in{" "}
                <IC>localStorage</IC> and reused across sessions
              </li>
              <li>
                <strong>Conversation ID</strong> is stored in{" "}
                <IC>localStorage</IC> (per project) and restored on page
                load
              </li>
              <li>
                On widget init, the full message history is loaded from the
                server and rendered
              </li>
              <li>
                If the conversation ID is lost (e.g., localStorage cleared),
                the widget looks up the most recent active conversation by
                visitor ID as a fallback
              </li>
              <li>
                Closed conversations are automatically cleared -- a new
                conversation starts fresh
              </li>
            </ul>

            <SectionHeading id="real-time-delivery" level={3}>
              Real-Time Message Delivery
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Messages are delivered via two mechanisms:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4 ml-1">
              <li>
                <strong>SSE Streaming</strong> -- AI bot responses are
                streamed in real-time as the visitor sends a message. Text
                appears word-by-word.
              </li>
              <li>
                <strong>Polling</strong> -- The widget polls for new messages
                to deliver agent replies (from Telegram or the dashboard).
                Polling runs at 3-second intervals during agent handoff, and
                10-second intervals during normal conversation.
              </li>
            </ul>
            <Callout type="info">
              Polling automatically starts when a conversation exists and
              stops when the conversation is closed. It only fetches
              messages newer than the last known timestamp, keeping requests
              minimal.
            </Callout>

            <SectionHeading id="handoff" level={3}>
              Agent Handoff
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              When the AI determines it can't answer confidently (or the
              visitor explicitly asks for a human), the conversation is
              handed off:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4 ml-1">
              <li>
                The AI includes a <IC>[HANDOFF_REQUESTED]</IC> token in its
                response
              </li>
              <li>The conversation status changes to <IC>waiting_agent</IC></li>
              <li>
                A notification is sent to the configured Telegram chat with
                conversation context
              </li>
              <li>
                The widget shows a handoff card asking for the visitor's
                email
              </li>
              <li>
                Browser notification permission is requested
              </li>
              <li>Polling switches to fast mode (every 3 seconds)</li>
              <li>
                When the agent replies (via Telegram or dashboard), the
                message appears in real-time with a desktop notification
              </li>
            </ol>

            {/* ── Knowledge Base ───────────────────────────────────────── */}
            <SectionHeading id="web-pages">
              Knowledge Base: Web Pages
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Add web pages as knowledge sources by entering a URL. The
              system will crawl the page, extract text content, and index it
              for AI retrieval.
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-4 ml-1">
              <li>
                Sub-pages can be auto-crawled to build a comprehensive
                knowledge base
              </li>
              <li>
                Crawled content can be reviewed and edited in the dashboard
              </li>
              <li>
                Individual pages can be re-crawled to pick up changes
              </li>
            </ul>

            <SectionHeading id="pdfs" level={3}>
              PDFs
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Upload PDF documents (up to 10MB) as knowledge sources. The
              content is extracted, stored in cloud storage, and indexed
              for AI retrieval.
            </p>

            <SectionHeading id="faqs" level={3}>
              FAQs
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Create structured FAQ pairs (question + answer). These are
              particularly effective because the AI can match visitor
              questions to specific FAQ entries with high confidence.
            </p>
            <Callout type="tip">
              FAQs are the highest-quality knowledge source. Start with
              your most common customer questions for the best results.
            </Callout>

            <SectionHeading id="rag-overview" level={3}>
              How RAG Works
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              ReplyMaven uses Retrieval-Augmented Generation (RAG) to ground
              AI responses in your actual content:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4 ml-1">
              <li>
                Your resources (web pages, PDFs, FAQs) are stored in
                Cloudflare R2 and indexed by AI Search
              </li>
              <li>
                When a visitor sends a message, the most relevant chunks
                (up to 5) are retrieved from the index
              </li>
              <li>
                Only chunks with a relevance score above 0.3 are included
              </li>
              <li>
                The retrieved context is passed to the AI model along with
                the conversation history
              </li>
              <li>
                Source references are resolved and displayed below the bot's
                response as clickable links
              </li>
            </ol>

            {/* ── Integrations ────────────────────────────────────────── */}
            <SectionHeading id="telegram">
              Integrations: Telegram
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Connect a Telegram bot to receive live agent handoff
              notifications and reply directly from Telegram.
            </p>
            <h4 className="font-semibold text-foreground mt-6 mb-2">
              Setup
            </h4>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4 ml-1">
              <li>
                Create a Telegram bot via{" "}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  @BotFather
                  <ExternalLink className="w-3 h-3 inline ml-0.5 -mt-0.5" />
                </a>
              </li>
              <li>
                Copy the bot token and paste it in{" "}
                <strong>Telegram &rarr; Bot Token</strong>
              </li>
              <li>
                Add the bot to your Telegram group or get your chat ID
              </li>
              <li>Paste the chat ID and click "Test Connection"</li>
            </ol>
            <h4 className="font-semibold text-foreground mt-6 mb-2">
              How It Works
            </h4>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-4 ml-1">
              <li>
                When a handoff occurs, the bot sends a message to your
                Telegram chat with the conversation summary and visitor info
              </li>
              <li>
                Reply to the bot's message in Telegram to send a response
                directly to the visitor's chat
              </li>
              <li>
                The visitor sees the agent's reply in real-time (via polling)
                with a desktop notification
              </li>
            </ul>

            <SectionHeading id="inquiries" level={3}>
              Inquiries
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Enable a "Leave a message" inquiry form on the widget's home
              screen. Visitors can submit structured information when they
              prefer not to chat. Configure fields in{" "}
              <strong>Inquiries</strong> in the dashboard.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              You can also open the inquiry form programmatically using{" "}
              <IC>window.ReplyMaven.openInquiryForm()</IC>.
            </p>

            <SectionHeading id="tone-of-voice" level={3}>
              Tone of Voice
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Choose how the AI communicates with your visitors. Available
              presets:
            </p>
            <div className="rounded-xl border border-border overflow-hidden my-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-left">
                    <th className="px-4 py-2.5 font-semibold text-foreground">
                      Tone
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-foreground">
                      Style
                    </th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      Professional
                    </td>
                    <td className="px-4 py-2.5">
                      Clear, polished, and business-appropriate
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      Friendly
                    </td>
                    <td className="px-4 py-2.5">
                      Warm and approachable, with a conversational feel
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      Casual
                    </td>
                    <td className="px-4 py-2.5">
                      Relaxed and informal, like chatting with a friend
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      Formal
                    </td>
                    <td className="px-4 py-2.5">
                      Structured and authoritative, suitable for enterprise
                    </td>
                  </tr>
                  <tr className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      Custom
                    </td>
                    <td className="px-4 py-2.5">
                      Write your own system prompt for full control over the
                      AI's personality (max 2000 characters)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <SectionHeading id="knowledge-refinement" level={3}>
              Knowledge Refinement
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              After conversations close, the AI analyzes them and suggests
              improvements to your knowledgebase. Suggestions can include
              new FAQ entries, SOP updates, or company context enrichments.
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-4 ml-1">
              <li>
                <strong>Automatic</strong> -- Enable auto-refinement in your
                knowledgebase settings. The AI will analyze closed
                conversations and create suggestions.
              </li>
              <li>
                <strong>Review</strong> -- Pending suggestions appear as
                badges on your Knowledgebase page. Approve to auto-apply
                changes, or reject to dismiss.
              </li>
            </ul>

            {/* ── Advanced ────────────────────────────────────────────── */}
            <SectionHeading id="spa-integration">
              Advanced: SPA Integration
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              If your site is a Single-Page Application (React, Vue, Next.js,
              etc.), the widget script only needs to be loaded once. It
              persists across route changes automatically.
            </p>
            <CodeBlock
              title="React example"
              language="jsx"
              code={`// Add to your root layout or index.html
// The widget loads once and persists across route changes

// Option 1: In index.html
<script src="https://widget.replymaven.com/widget-embed.js"
        data-project="your-project-slug"></script>

// Option 2: Load dynamically in a React effect
useEffect(() => {
  const script = document.createElement("script");
  script.src = "https://widget.replymaven.com/widget-embed.js";
  script.setAttribute("data-project", "your-project-slug");
  script.async = true;
  document.body.appendChild(script);

  return () => {
    document.body.removeChild(script);
  };
}, []);`}
            />
            <CodeBlock
              title="Update metadata on route change"
              language="javascript"
              code={`// In your router's afterEach hook or a useEffect
window.ReplyMaven?.setMetadata({
  currentPage: window.location.pathname,
  pageTitle: document.title,
});`}
            />

            <SectionHeading id="csp" level={3}>
              Content Security Policy
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              If your site uses a Content Security Policy, add the following
              directives:
            </p>
            <CodeBlock
              title="CSP directives"
              language="text"
              code={`script-src 'self' https://widget.replymaven.com;
connect-src 'self' https://replymaven.com https://widget.replymaven.com;
style-src 'self' 'unsafe-inline';`}
            />

            <SectionHeading id="multiple-widgets" level={3}>
              Multiple Widgets
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Only one widget instance is supported per page. If you need
              different configurations for different sections of your site,
              use different project slugs:
            </p>
            <CodeBlock
              title="Different projects for different pages"
              language="html"
              code={`<!-- On your marketing site -->
<script src="https://widget.replymaven.com/widget-embed.js"
        data-project="marketing-bot"></script>

<!-- On your app/dashboard -->
<script src="https://widget.replymaven.com/widget-embed.js"
        data-project="app-support-bot"></script>`}
            />

            {/* ── Complete API Reference ──────────────────────────────── */}
            <SectionHeading id="api-reference">
              Complete API Reference
            </SectionHeading>
            <p className="text-muted-foreground leading-relaxed mb-4">
              All methods available on <IC>window.ReplyMaven</IC>:
            </p>
            <div className="rounded-xl border border-border overflow-hidden my-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-left">
                    <th className="px-4 py-2.5 font-semibold text-foreground">
                      Method
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-foreground">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-mono text-[13px] text-primary whitespace-nowrap">
                      open()
                    </td>
                    <td className="px-4 py-2.5">Open the chat widget</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-mono text-[13px] text-primary whitespace-nowrap">
                      close()
                    </td>
                    <td className="px-4 py-2.5">Close the chat widget</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-mono text-[13px] text-primary whitespace-nowrap">
                      toggle()
                    </td>
                    <td className="px-4 py-2.5">Toggle the widget open or closed</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-mono text-[13px] text-primary whitespace-nowrap">
                      sendMessage(text)
                    </td>
                    <td className="px-4 py-2.5">
                      Send a message. Opens the widget if closed.
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-mono text-[13px] text-primary whitespace-nowrap">
                      {"identify({ ... })"}
                    </td>
                    <td className="px-4 py-2.5">
                      Set visitor name, email, phone, and custom metadata.
                      Syncs retroactively if conversation exists.
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2.5 font-mono text-[13px] text-primary whitespace-nowrap">
                      {"setMetadata({ ... })"}
                    </td>
                    <td className="px-4 py-2.5">
                      Set arbitrary key-value metadata. Merged with existing
                      metadata.
                    </td>
                  </tr>
                  <tr className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 font-mono text-[13px] text-primary whitespace-nowrap">
                      requestNotifications()
                    </td>
                    <td className="px-4 py-2.5">
                      Request browser notification permission.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── CTA ─────────────────────────────────────────────────── */}
            <div className="mt-16 rounded-2xl border border-border bg-card p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-primary/[0.08] flex items-center justify-center mx-auto mb-4">
                <Smartphone className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">
                Ready to get started?
              </h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Create your first project, add your knowledge base, and
                deploy the widget in under 5 minutes.
              </p>
              <div className="flex items-center justify-center gap-3">
                <Button
                  className="rounded-full glow-surface px-6"
                  onClick={() => setAuthOpen(true)}
                >
                  Start Free
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full px-6"
                  onClick={() => setAuthOpen(true)}
                >
                  Log in
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Auth Modal */}
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  );
}

export default Docs;
