import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import {
  MarketingLayout,
  StartTrialCta,
} from "@/components/marketing/marketing-layout";
import {
  ClosingCta,
  JobGrid,
  MarketingSection,
  RelatedFeatures,
  SectionHeading,
} from "@/components/marketing/marketing-sections";
import { Cta } from "@/components/ui/cta";

interface FeaturePageProps {
  metadata: {
    title: string;
    description: string;
  };
  eyebrow: string;
  title: string;
  description: string;
  visual: ReactNode;
  jobsHeading: string;
  jobs: {
    title: string;
    description: string;
    icon?: ReactNode;
  }[];
  scenario: {
    eyebrow: string;
    title: string;
    description: string;
    proof: string[];
  };
  related: { label: string; title: string; to: string }[];
}

export function FeaturePage({
  metadata,
  eyebrow,
  title,
  description,
  visual,
  jobsHeading,
  jobs,
  scenario,
  related,
}: FeaturePageProps) {
  return (
    <MarketingLayout title={metadata.title} description={metadata.description}>
      <section className="relative overflow-hidden px-6 pb-16 pt-36 sm:pb-24 sm:pt-44">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-brand/12 blur-[120px]"
        />
        <div className="relative mx-auto max-w-6xl">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-soft">
              {eyebrow}
            </p>
            <h1 className="mt-5 text-balance font-heading text-[2.85rem] font-medium leading-[0.98] tracking-[-0.035em] text-ink-1 sm:text-7xl">
              {title}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-8 text-ink-5 sm:text-xl">
              {description}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <StartTrialCta />
              <Cta variant="outline" size="lg" asChild>
                <Link to="/docs">
                  Read the docs
                  <ArrowRight className="size-4" />
                </Link>
              </Cta>
            </div>
          </div>
          <div className="mx-auto mt-14 max-w-5xl sm:mt-18">{visual}</div>
        </div>
      </section>

      <MarketingSection className="pt-12 sm:pt-20">
        <SectionHeading title={jobsHeading} align="center" />
        <div className="mx-auto mt-12 max-w-5xl">
          <JobGrid jobs={jobs} />
        </div>
      </MarketingSection>

      <MarketingSection className="py-12 sm:py-20">
        <div className="grid items-start gap-8 rounded-[28px] bg-white/[0.025] p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.065)] sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-soft">
              {scenario.eyebrow}
            </p>
            <h2 className="mt-3 text-balance font-heading text-3xl font-medium leading-[1.05] tracking-[-0.025em] text-ink-1 sm:text-4xl">
              {scenario.title}
            </h2>
            <p className="mt-5 text-pretty text-base leading-7 text-ink-5">
              {scenario.description}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2" aria-label="Outcome details">
            {scenario.proof.map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-2xl bg-black/20 p-4"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-soft" />
                <span className="text-pretty text-sm leading-6 text-ink-4">
                  {item}
                </span>
              </div>
            ))}
          </div>
        </div>
      </MarketingSection>

      <RelatedFeatures links={related} />
      <ClosingCta />
    </MarketingLayout>
  );
}
