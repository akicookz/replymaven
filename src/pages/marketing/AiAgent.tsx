import {
  BookOpenCheck,
  BrainCircuit,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { FeaturePage } from "@/components/marketing/feature-page";
import { AgentVisual } from "@/components/marketing/marketing-visuals";

function AiAgent() {
  return (
    <FeaturePage
      metadata={{
        title: "AI Customer Support Agent | ReplyMaven",
        description:
          "Give troubleshooting, upgrades, refunds, and repetitive support work to Maven, your action-taking AI support hire.",
      }}
      eyebrow="AI support hire"
      title="Give repetitive support work to Maven"
      description="Troubleshooting, upgrades, refunds, account changes. Maven answers from your knowledge, calls the right tools, and brings you in when the stakes are high."
      visual={<AgentVisual />}
      jobsHeading="Answers are only the start"
      jobs={[
        {
          icon: <BookOpenCheck className="size-5" />,
          title: "Answers from your knowledge",
          description:
            "Train Maven on your docs, FAQs, help center, website, and product guidance.",
        },
        {
          icon: <Wrench className="size-5" />,
          title: "Takes approved actions",
          description:
            "Look up live data, trigger workflows, update accounts, and complete configured requests.",
        },
        {
          icon: <ShieldCheck className="size-5" />,
          title: "Knows when to stop",
          description:
            "Set the guardrails. Maven escalates high-stakes work before taking the wrong action.",
        },
        {
          icon: <BrainCircuit className="size-5" />,
          title: "Keeps the full context",
          description:
            "Customer identity, past conversations, page context, and previous attempts stay attached.",
        },
      ]}
      scenario={{
        eyebrow: "A resolved request",
        title: "From upgrade problem to working account",
        description:
          "Maven finds the answer, checks the account, and fixes the issue before the customer waits for your team.",
        proof: [
          "Correct plan and payment status",
          "Account entitlements restored",
          "Customer confirmation sent",
          "Full action log retained",
        ],
      }}
      related={[
        {
          label: "Actions",
          title: "Give Maven the tools to finish the job",
          to: "/actions",
        },
        {
          label: "Inbox",
          title: "Go through your support inbox in minutes",
          to: "/inbox",
        },
      ]}
    />
  );
}

export default AiAgent;
