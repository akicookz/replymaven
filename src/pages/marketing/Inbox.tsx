import { BrainCircuit, Command, Focus, Sparkles } from "lucide-react";
import { FeaturePage } from "@/components/marketing/feature-page";
import { InboxVisual } from "@/components/marketing/marketing-visuals";

function Inbox() {
  return (
    <FeaturePage
      metadata={{
        title: "Fast AI Support Inbox | ReplyMaven",
        description:
          "Browse, research, draft, and resolve customer conversations in one keyboard-first support inbox.",
      }}
      eyebrow="Support inbox"
      title="Go through your support inbox in minutes"
      description="ReplyMaven gives you the context and helps draft the reply. Browse, research, draft, and resolve in one screen, without reaching for your mouse."
      visual={<InboxVisual />}
      jobsHeading="Built to get you out of the inbox"
      jobs={[
        {
          icon: <Focus className="size-5" />,
          title: "One conversation at a time",
          description:
            "Focus View removes the queue and keeps the customer in front of you.",
        },
        {
          icon: <Command className="size-5" />,
          title: "Keyboard from start to finish",
          description:
            "Move, draft, prioritize, snooze, and resolve without reaching for the mouse.",
        },
        {
          icon: <Sparkles className="size-5" />,
          title: "Draft from an instruction",
          description:
            "Write the point you want to make. ReplyMaven turns it into a customer-ready reply.",
        },
        {
          icon: <BrainCircuit className="size-5" />,
          title: "Context stays on screen",
          description:
            "See customer history, account details, page context, and previous attempts beside the thread.",
        },
      ]}
      scenario={{
        eyebrow: "Focus View",
        title: "Research, reply, next",
        description:
          "The inbox keeps the work moving without losing customer context between conversations.",
        proof: [
          "Customer history stays visible",
          "Suggested reply ready",
          "Priority and snooze shortcuts",
          "Resolve and advance instantly",
        ],
      }}
      related={[
        {
          label: "AI Agent",
          title: "Let Maven resolve routine support first",
          to: "/ai-agent",
        },
        {
          label: "MCP",
          title: "Work support from the AI tools you already use",
          to: "/mcp",
        },
      ]}
    />
  );
}

export default Inbox;
