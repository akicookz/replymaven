import { BookOpen, Bot, RefreshCw, Search } from "lucide-react";
import { FeaturePage } from "@/components/marketing/feature-page";
import { HelpCenterVisual } from "@/components/marketing/marketing-visuals";

function HelpCenter() {
  return (
    <FeaturePage
      metadata={{
        title: "AI Help Center That Stays Current | ReplyMaven",
        description:
          "Write helpful docs, keep articles current, and use the same knowledge for self-service and AI customer support.",
      }}
      eyebrow="Built-in help center"
      title="Keep your help center up to date, on autopilot"
      description="Reduce support-related churn. Write and maintain helpful docs with ReplyMaven's built-in help center. Maven keeps articles current and suggests additions and refreshes."
      visual={<HelpCenterVisual />}
      jobsHeading="Write once. Answer everywhere."
      jobs={[
        {
          icon: <RefreshCw className="size-5" />,
          title: "Keep articles current",
          description:
            "Review suggested refreshes when product changes make an article stale.",
        },
        {
          icon: <BookOpen className="size-5" />,
          title: "Publish on your brand",
          description:
            "Give customers a fast, searchable help center on your domain or subfolder.",
        },
        {
          icon: <Bot className="size-5" />,
          title: "Train Maven automatically",
          description:
            "Every published article becomes trusted knowledge for customer conversations.",
        },
        {
          icon: <Search className="size-5" />,
          title: "Find missing answers",
          description:
            "Use real support questions to spot what customers still cannot find.",
        },
      ]}
      scenario={{
        eyebrow: "One source of truth",
        title: "A product change becomes a better answer",
        description:
          "Keep public documentation and Maven's answers aligned as your product changes.",
        proof: [
          "Changed flow linked to the affected article",
          "Suggested copy scoped to the change",
          "Team approval before publishing",
          "One current answer for customers and Maven",
        ],
      }}
      related={[
        {
          label: "AI Agent",
          title: "Give Maven accurate knowledge to work from",
          to: "/ai-agent",
        },
        {
          label: "MCP",
          title: "Update support knowledge from your AI workflow",
          to: "/mcp",
        },
      ]}
    />
  );
}

export default HelpCenter;
