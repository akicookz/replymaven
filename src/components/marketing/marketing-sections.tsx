import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { StartTrialCta } from "@/components/marketing/marketing-layout";
import { Cta } from "@/components/ui/cta";
import { cn } from "@/lib/utils";

interface MarketingSectionProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

interface FeatureProofProps {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
  href?: string;
  reverse?: boolean;
  className?: string;
}

export function MarketingSection({
  children,
  className,
  id,
}: MarketingSectionProps) {
  return (
    <section id={id} className={cn("px-6 py-20 sm:py-28", className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center")}>
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-soft">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-3 text-balance font-heading text-3xl font-medium leading-[1.04] tracking-[-0.025em] text-ink-1 sm:text-5xl">
        {title}
      </h2>
      {description && (
        <p className="mt-5 max-w-2xl text-pretty text-base leading-7 text-ink-5 sm:text-lg">
          {description}
        </p>
      )}
    </div>
  );
}

export function FeatureProof({
  eyebrow,
  title,
  description,
  children,
  href,
  reverse,
  className,
}: FeatureProofProps) {
  return (
    <div
      className={cn(
        "grid items-center gap-10 lg:grid-cols-2 lg:gap-16",
        className,
      )}
    >
      <div className={cn(reverse && "lg:order-2")}>
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-soft">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-3 text-balance font-heading text-3xl font-medium leading-[1.04] tracking-[-0.025em] text-ink-1 sm:text-5xl">
          {title}
        </h2>
        <p className="mt-5 max-w-xl text-pretty text-base leading-7 text-ink-5 sm:text-lg">
          {description}
        </p>
        {href && (
          <Link
            to={href}
            className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-medium text-ink-2 transition-colors duration-150 hover:text-white"
          >
            Explore the feature
            <ArrowRight className="size-4" />
          </Link>
        )}
      </div>
      <div className={cn(reverse && "lg:order-1")}>{children}</div>
    </div>
  );
}

export function JobGrid({
  jobs,
}: {
  jobs: { title: string; description: string; icon?: ReactNode }[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {jobs.map((job) => (
        <article
          key={job.title}
          className="rounded-2xl bg-white/[0.03] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.065)] transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-white/[0.045] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.11),0_20px_40px_-32px_rgba(0,0,0,0.95)]"
        >
          {job.icon && (
            <span className="mb-5 flex size-10 items-center justify-center rounded-xl bg-brand/12 text-brand-soft">
              {job.icon}
            </span>
          )}
          <h3 className="text-balance text-base font-semibold text-ink-1">
            {job.title}
          </h3>
          <p className="mt-2 text-pretty text-sm leading-6 text-ink-6">
            {job.description}
          </p>
        </article>
      ))}
    </div>
  );
}

export function ClosingCta() {
  return (
    <MarketingSection className="pb-8 pt-12 sm:pb-10 sm:pt-20">
      <div className="relative overflow-hidden rounded-[32px] bg-[#11141c] px-6 py-16 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_40px_120px_-50px_rgba(37,99,235,0.65)] sm:px-10 sm:py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-16 -top-32 h-64 rounded-full bg-brand/30 blur-[100px]"
        />
        <div className="relative mx-auto max-w-3xl">
          <h2 className="text-balance font-heading text-4xl font-medium leading-[1.02] tracking-[-0.03em] text-ink-1 sm:text-6xl">
            Turn support into a word-of-mouth growth engine.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-7 text-ink-5 sm:text-lg">
            Give every customer a fast answer. Keep your time for the
            conversations that matter.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <StartTrialCta />
            <Cta variant="outline" size="lg" asChild>
              <Link to="/docs">Read the docs</Link>
            </Cta>
          </div>
        </div>
      </div>
    </MarketingSection>
  );
}

export function RelatedFeatures({
  links,
}: {
  links: { label: string; title: string; to: string }[];
}) {
  return (
    <MarketingSection className="py-12 sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-7">
        Keep exploring
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="group rounded-2xl bg-white/[0.03] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.065)] transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-white/[0.045] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.11)]"
          >
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-soft">
              {link.label}
            </span>
            <span className="mt-3 flex items-center justify-between gap-4 text-balance text-xl font-medium text-ink-1">
              {link.title}
              <ArrowRight className="size-5 shrink-0 text-ink-6 transition-[transform,color] duration-200 group-hover:translate-x-1 group-hover:text-ink-1" />
            </span>
          </Link>
        ))}
      </div>
    </MarketingSection>
  );
}
