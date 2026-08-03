import { FilePenLine, ListTree, MessageSquareReply, Search } from "lucide-react";
import { FeaturePage } from "@/components/marketing/feature-page";
import { McpVisual } from "@/components/marketing/marketing-visuals";

function Mcp() {
  return (
    <FeaturePage
      metadata={{
        title: "MCP Server for Customer Support | ReplyMaven",
        description:
          "Bring customer conversations into Claude, Cursor, and other MCP clients to turn support into product decisions.",
      }}
      eyebrow="Model Context Protocol"
      title="Turn support tickets into product decisions"
      description="Bring real customer conversations into Claude, Cursor, and other MCP clients. Find recurring problems, prioritize feature requests, update your knowledge base, and reply to customers from the same workflow."
      visual={<McpVisual />}
      jobsHeading="Customer context where product work happens"
      jobs={[
        {
          icon: <Search className="size-5" />,
          title: "Ask across support",
          description:
            "Find what blocks upgrades, creates churn risk, or produces repeat tickets.",
        },
        {
          icon: <ListTree className="size-5" />,
          title: "Spot product patterns",
          description:
            "Group bugs and feature requests by frequency, customer, and urgency.",
        },
        {
          icon: <FilePenLine className="size-5" />,
          title: "Update support knowledge",
          description:
            "Create and refresh FAQs using the conversations that exposed the gap.",
        },
        {
          icon: <MessageSquareReply className="size-5" />,
          title: "Reply from your AI client",
          description:
            "Send an agent reply and close the loop without returning to the dashboard.",
        },
      ]}
      scenario={{
        eyebrow: "From signal to decision",
        title: "Use the words your customers already gave you",
        description:
          "ReplyMaven makes support history available to the AI tools used for research, planning, and documentation.",
        proof: [
          "Recurring customer problems grouped",
          "Strongest evidence summarized",
          "Prioritized product brief ready",
          "Documentation and follow-up replies drafted",
        ],
      }}
      related={[
        {
          label: "Actions",
          title: "Send support work into Linear and GitHub",
          to: "/actions",
        },
        {
          label: "Help Center",
          title: "Keep public answers aligned with the product",
          to: "/help-center",
        },
      ]}
    />
  );
}

export default Mcp;
