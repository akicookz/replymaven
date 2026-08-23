import { useEffect, type ReactNode } from "react";
import {
  McpDocsMock,
  McpReplyMock,
  SharedInboxMock,
  SidechatMock,
  SummonMock,
  TelegramCommandMock,
} from "@/components/marketing/animated-mocks";

function Block({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-ink-1">
          {title}
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-5">{note}</p>
      </div>
      {children}
    </section>
  );
}

export default function LandingMocks() {
  useEffect(() => {
    document.title = "Landing mocks · ReplyMaven";
  }, []);

  return (
    <div className="dark min-h-screen bg-background text-foreground antialiased">
      <div className="mx-auto max-w-[1180px] space-y-16 px-4 py-12 sm:px-6">
        <header className="space-y-2">
          <p className="text-[13px] font-medium text-ink-6">Preview only</p>
          <h1 className="text-[34px] font-semibold tracking-[-0.04em] text-ink-1">
            Landing mocks from the dashboard
          </h1>
          <p className="max-w-[640px] text-[15px] leading-relaxed text-ink-4">
            These are the inbox, Focus view, Sidechat, and help article editor.
            Telegram and Slack have no dashboard chrome, so those stories show
            the inbox after the event.
          </p>
        </header>

        <Block
          title="Shared inbox"
          note="Message list and reading pane. Click a row."
        >
          <SharedInboxMock />
        </Block>

        <Block
          title="Maven brings you in"
          note="Same inbox after Maven looks up the invoice and flags the thread."
        >
          <SummonMock />
        </Block>

        <Block
          title="After @Maven"
          note="The command itself is never stored. The inbox shows Alex assigned Maven, then the visitor-facing reply."
        >
          <TelegramCommandMock />
        </Block>

        <Block
          title="Sidechat"
          note="Focus view plus the private Sidechat pane. Add to reply writes into the public composer."
        >
          <SidechatMock />
        </Block>

        <Block
          title="MCP reply"
          note="Reading pane after a client drafts a reply into the composer."
        >
          <McpReplyMock />
        </Block>

        <Block
          title="MCP docs"
          note="Help article editor after the seats step is rewritten."
        >
          <McpDocsMock />
        </Block>
      </div>
    </div>
  );
}
