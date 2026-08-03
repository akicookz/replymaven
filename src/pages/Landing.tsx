import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Github,
  MessageSquareText,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import {
  MarketingLayout,
  StartTrialCta,
} from "@/components/marketing/marketing-layout";
import { useMarketingActions } from "@/components/marketing/marketing-context";
import {
  ClosingCta,
  FeatureProof,
  MarketingSection,
  SectionHeading,
} from "@/components/marketing/marketing-sections";
import {
  ActionsVisual,
  HandoffVisual,
  HelpCenterVisual,
  HeroInboxVisual,
  InboxVisual,
  McpVisual,
} from "@/components/marketing/marketing-visuals";
import { PricingCards } from "@/components/PricingCards";
import { Cta } from "@/components/ui/cta";

const faqItems = [
  {
    question: "How quickly can we go live?",
    answer:
      "Most teams can connect their knowledge and install the widget in minutes. You can test Maven before making it visible to customers.",
  },
  {
    question: "What can Maven take action on?",
    answer:
      "Connect your APIs and workflows for jobs such as account lookups, upgrades, refunds, internal escalation, and issue creation. You control each tool and when Maven can use it.",
  },
  {
    question: "What happens when Maven is not confident?",
    answer:
      "Maven brings in your team with the customer history, its research, and previous resolution attempts attached. The customer stays in the same conversation.",
  },
  {
    question: "Does the help center train Maven?",
    answer:
      "Yes. Published help-center articles become trusted sources for Maven, so customers and the AI receive the same answer.",
  },
  {
    question: "Which AI clients work with ReplyMaven MCP?",
    answer:
      "ReplyMaven works with MCP-compatible clients such as Claude and Cursor. OAuth scopes control which projects, conversations, and knowledge tools each client can access.",
  },
] as const;

function HomepagePricing() {
  const {
    currentPlan,
    currentInterval,
    selectPlan,
    managePlan,
  } = useMarketingActions();

  return (
    <PricingCards
      currentPlan={currentPlan}
      currentInterval={currentInterval}
      onCtaClick={selectPlan}
      onManagePlan={managePlan}
    />
  );
}

function Landing() {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      document.getElementById(id)?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    });
  }, [location.hash]);

  return (
    <MarketingLayout
      title="ReplyMaven | Turn Support Into Word-of-Mouth Growth"
      description="Give troubleshooting, upgrades, refunds, account changes, and repetitive support work to Maven, your AI support hire."
    >
      <section className="relative overflow-hidden px-6 pb-14 pt-36 sm:pb-20 sm:pt-44">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[620px] w-[1100px] -translate-x-1/2 rounded-full bg-brand/14 blur-[140px]"
        />
        <div className="relative mx-auto max-w-6xl">
          <div className="max-w-5xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-soft">
              AI support that takes action
            </p>
            <h1 className="mt-5 max-w-5xl text-balance font-heading text-[3rem] font-medium leading-[0.96] tracking-[-0.04em] text-ink-1 sm:text-7xl lg:text-[5.4rem]">
              Turn support into a word-of-mouth growth engine.
            </h1>
            <p className="mt-7 max-w-3xl text-pretty text-lg leading-8 text-ink-5 sm:text-xl">
              Hand troubleshooting, upgrades, refunds, account changes, and
              repetitive questions to your new AI support hire. Maven learns
              your docs and product, takes action for customers, and brings you
              in only when the stakes are high and judgment is needed.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <StartTrialCta />
              <Cta variant="outline" size="lg" asChild>
                <Link to="/ai-agent">
                  See ReplyMaven in action
                  <ArrowRight className="size-4" />
                </Link>
              </Cta>
            </div>
          </div>
          <div className="mt-16 sm:mt-20">
            <HeroInboxVisual />
          </div>
        </div>
      </section>

      <MarketingSection className="pt-12 sm:pt-20">
        <div className="grid gap-6 lg:grid-cols-2">
          <article className="flex flex-col overflow-hidden rounded-[28px] bg-white/[0.025] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.065)] sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-soft">
              Inbox
            </p>
            <h2 className="mt-3 text-balance font-heading text-3xl font-medium leading-[1.04] tracking-[-0.025em] text-ink-1 sm:text-4xl">
              Go through your support inbox in minutes
            </h2>
            <p className="mt-4 text-pretty text-base leading-7 text-ink-5">
              ReplyMaven gives you the context and helps draft the reply.
              Browse, research, draft, and resolve in one screen, without
              reaching for your mouse.
            </p>
            <Link
              to="/inbox"
              className="mb-7 mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-ink-2 transition-colors duration-150 hover:text-white"
            >
              Explore the inbox
              <ArrowRight className="size-4" />
            </Link>
            <div className="mt-auto">
              <InboxVisual />
            </div>
          </article>

          <article className="flex flex-col overflow-hidden rounded-[28px] bg-white/[0.025] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.065)] sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-soft">
              Help center
            </p>
            <h2 className="mt-3 text-balance font-heading text-3xl font-medium leading-[1.04] tracking-[-0.025em] text-ink-1 sm:text-4xl">
              Keep your help center up to date, on autopilot
            </h2>
            <p className="mt-4 text-pretty text-base leading-7 text-ink-5">
              Reduce support-related churn. Write and maintain helpful docs with
              ReplyMaven's built-in help center. Maven keeps articles current
              and suggests additions and refreshes.
            </p>
            <Link
              to="/help-center"
              className="mb-7 mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-ink-2 transition-colors duration-150 hover:text-white"
            >
              Explore the help center
              <ArrowRight className="size-4" />
            </Link>
            <div className="mt-auto">
              <HelpCenterVisual />
            </div>
          </article>
        </div>
      </MarketingSection>

      <MarketingSection>
        <FeatureProof
          eyebrow="Actions"
          title="Give Maven the tools to finish the job"
          description="Connect ReplyMaven to your product and support stack. Maven pulls live customer data, triggers workflows, escalates urgent requests, and creates Linear or GitHub issues with the full conversation attached."
          href="/actions"
        >
          <ActionsVisual />
        </FeatureProof>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: CheckCircle2,
              title: "Pull customer data",
              text: "Accounts, orders, subscriptions, product status.",
            },
            {
              icon: Workflow,
              title: "Take action",
              text: "Upgrades, refunds, account changes, workflows.",
            },
            {
              icon: ShieldCheck,
              title: "Escalate with context",
              text: "Customer history and resolution attempts attached.",
            },
            {
              icon: Github,
              title: "Create product tickets",
              text: "Confirmed bugs filed in Linear or GitHub.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl bg-white/[0.025] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.055)]"
            >
              <item.icon className="size-5 text-brand-soft" />
              <p className="mt-4 text-sm font-semibold text-ink-2">
                {item.title}
              </p>
              <p className="mt-2 text-pretty text-xs leading-5 text-ink-7">
                {item.text}
              </p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection className="bg-white/[0.012]">
        <FeatureProof
          eyebrow="Human handoff"
          title="Maven knows when to bring you in"
          description="Set the guardrails. Maven resolves routine work and hands high-stakes conversations to your team with the customer history, what it found, and what it already tried."
          href="/ai-agent"
          reverse
        >
          <HandoffVisual />
        </FeatureProof>
      </MarketingSection>

      <MarketingSection>
        <FeatureProof
          eyebrow="Model Context Protocol"
          title="Turn support tickets into product decisions"
          description="Bring real customer conversations into Claude, Cursor, and other MCP clients. Find recurring problems, prioritize feature requests, update your knowledge base, and reply to customers from the same workflow."
          href="/mcp"
        >
          <McpVisual />
        </FeatureProof>
        <div className="mt-10 flex flex-wrap gap-2">
          {[
            "Find repeat bugs",
            "Group feature requests",
            "Draft product briefs",
            "Update FAQs",
            "Reply to customers",
          ].map((item) => (
            <span
              key={item}
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/[0.035] px-4 text-xs text-ink-5 shadow-[0_0_0_1px_rgba(255,255,255,0.055)]"
            >
              <MessageSquareText className="size-3.5 text-brand-soft" />
              {item}
            </span>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection id="pricing" className="bg-white/[0.012]">
        <SectionHeading
          eyebrow="Pricing"
          title="Your first support hire starts at $19"
          description="Try the full support workflow for seven days. Upgrade when your customer volume grows."
        />
        <div className="mt-12">
          <HomepagePricing />
        </div>
      </MarketingSection>

      <MarketingSection id="faq">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <SectionHeading
            eyebrow="FAQ"
            title="Before you hand Maven the queue"
          />
          <div className="space-y-3">
            {faqItems.map((item) => (
              <details
                key={item.question}
                className="group rounded-2xl bg-white/[0.025] px-5 shadow-[0_0_0_1px_rgba(255,255,255,0.055)] open:bg-white/[0.04]"
              >
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-semibold text-ink-2 [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <ChevronDown className="size-4 shrink-0 text-ink-6 transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="pb-5 text-pretty text-sm leading-6 text-ink-6">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </MarketingSection>

      <ClosingCta />
    </MarketingLayout>
  );
}

export default Landing;
