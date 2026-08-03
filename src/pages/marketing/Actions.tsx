import { Database, GitBranch, ShieldCheck, Workflow } from "lucide-react";
import { FeaturePage } from "@/components/marketing/feature-page";
import { ActionsVisual } from "@/components/marketing/marketing-visuals";

function Actions() {
  return (
    <FeaturePage
      metadata={{
        title: "AI Support Actions and Integrations | ReplyMaven",
        description:
          "Let Maven pull live customer data, trigger workflows, escalate requests, and create Linear or GitHub issues.",
      }}
      eyebrow="Actions"
      title="Give Maven the tools to finish the job"
      description="Connect ReplyMaven to your product and support stack. Maven pulls live customer data, triggers workflows, escalates urgent requests, and creates Linear or GitHub issues with the full conversation attached."
      visual={<ActionsVisual />}
      jobsHeading="Resolve the request, not just the question"
      jobs={[
        {
          icon: <Database className="size-5" />,
          title: "Pull customer data",
          description:
            "Check accounts, orders, subscriptions, and product status before replying.",
        },
        {
          icon: <Workflow className="size-5" />,
          title: "Take action",
          description:
            "Process upgrades, refunds, account changes, and custom workflows through your APIs.",
        },
        {
          icon: <ShieldCheck className="size-5" />,
          title: "Escalate with context",
          description:
            "Send high-stakes cases to your team with customer history and resolution attempts attached.",
        },
        {
          icon: <GitBranch className="size-5" />,
          title: "Create product tickets",
          description:
            "Turn confirmed bugs into Linear or GitHub issues without copying the conversation by hand.",
        },
      ]}
      scenario={{
        eyebrow: "Connected resolution",
        title: "One request can cross your whole stack",
        description:
          "Give Maven narrow, auditable tools for the support jobs your team repeats every day.",
        proof: [
          "Live plan and product data",
          "Approved billing action completed",
          "Reproducible bug filed in Linear or GitHub",
          "Customer reply and action log attached",
        ],
      }}
      related={[
        {
          label: "AI Agent",
          title: "See how Maven uses actions in conversation",
          to: "/ai-agent",
        },
        {
          label: "MCP",
          title: "Bring support context into product work",
          to: "/mcp",
        },
      ]}
    />
  );
}

export default Actions;
