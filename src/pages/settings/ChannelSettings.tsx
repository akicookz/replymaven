import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  MoreHorizontal,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { WidgetSectionCard } from "@/components/WidgetSettings";
import {
  EmailLogoIcon,
  SlackLogoIcon,
  TelegramLogoIcon,
} from "@/components/icons/nav-icons";
import { cn } from "@/lib/utils";

const EMAIL_FORWARDING_DOCS_URL =
  "https://replymaven.com/docs/integrations/forward-your-support-inbox";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelegramData {
  telegramBotToken: string | null;
  telegramChatId: string | null;
}

interface SlackData {
  slackBotToken: string | null;
  slackSigningSecret: string | null;
  slackChannelId: string | null;
  authorScopeMissing?: boolean;
}

interface InboundAddress {
  id: string;
  address: string;
  label: string | null;
  ignored: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface InboundEmailData {
  forwardTo: string;
  addresses: InboundAddress[];
}

type SaveStatus = "idle" | "success" | "error";

interface TestResult {
  success: boolean;
  message: string;
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {children}
      {required && <span className="text-destructive"> *</span>}
    </label>
  );
}

function SaveNotice({ status, label }: { status: SaveStatus; label: string }) {
  if (status === "error") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <AlertCircle className="size-4 shrink-0" />
        Failed to save {label} settings.
      </div>
    );
  }
  if (status === "success") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
        <CheckCircle2 className="size-4 shrink-0" />
        Settings saved.
      </div>
    );
  }
  return null;
}

function TestNotice({ result }: { result: TestResult | null }) {
  if (!result) return null;
  return (
    <div
      className={cn(
        "max-h-48 overflow-auto rounded-lg p-3 text-xs",
        result.success
          ? "bg-success/10 text-success"
          : "bg-destructive/10 text-destructive",
      )}
    >
      {result.message}
    </div>
  );
}

function useTestMutation(path: string, setResult: (result: TestResult | null) => void) {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(path, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Test failed");
      return data;
    },
    onSuccess: () => {
      setResult({ success: true, message: "Test message sent successfully!" });
      setTimeout(() => setResult(null), 5000);
    },
    onError: (err: Error) => {
      setResult({ success: false, message: err.message });
      setTimeout(() => setResult(null), 5000);
    },
  });
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

function TelegramSection() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const { data } = useQuery<TelegramData>({
    queryKey: ["telegram-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/telegram`);
      if (!res.ok) throw new Error("Failed to fetch telegram config");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
  const configured = Boolean(data?.telegramBotToken && data?.telegramChatId);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (botToken) body.telegramBotToken = botToken;
      if (chatId) body.telegramChatId = chatId;
      const res = await fetch(`/api/projects/${projectId}/telegram`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to save" }));
        throw new Error((err as { error?: string }).error ?? "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      setSaveStatus("success");
      setBotToken("");
      queryClient.invalidateQueries({ queryKey: ["telegram-config", projectId] });
      setTimeout(() => setSaveStatus("idle"), 3000);
    },
    onError: () => {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    },
  });

  const test = useTestMutation(`/api/projects/${projectId}/telegram/test`, setTestResult);

  return (
    <WidgetSectionCard
      title="Telegram"
      description="Maven pings this chat when a customer needs a person."
      icon={TelegramLogoIcon}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <FieldLabel required>Bot Token</FieldLabel>
          <Input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={configured ? "Enter new token to update" : "Paste your bot token from @BotFather"}
          />
          <p className="text-xs text-muted-foreground">
            Get a token from @BotFather in Telegram.
          </p>
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Chat ID</FieldLabel>
          <Input
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder={data?.telegramChatId ?? "Connects on its own — or paste an ID"}
          />
          <p className="text-xs text-muted-foreground">
            Save the token, then add the bot to your group and send any message. The chat connects itself.
          </p>
        </div>
      </div>
      <SaveNotice status={saveStatus} label="Telegram" />
      <div className="flex items-center justify-end gap-2">
        {configured && (
          <Button
            variant="outline"
            onClick={() => {
              setTestResult(null);
              test.mutate();
            }}
            disabled={test.isPending}
          >
            {test.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            Send Test Message
          </Button>
        )}
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || (!botToken && !chatId)}
        >
          {save.isPending && <Loader2 className="animate-spin" />}
          {configured ? "Update" : "Save"}
        </Button>
      </div>
      <TestNotice result={testResult} />
    </WidgetSectionCard>
  );
}

// ─── Slack ────────────────────────────────────────────────────────────────────

function SlackSection() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [channelId, setChannelId] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const { data } = useQuery<SlackData>({
    queryKey: ["slack-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/slack`);
      if (!res.ok) throw new Error("Failed to fetch slack config");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
  const configured = Boolean(data?.slackBotToken && data.slackSigningSecret);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (botToken) body.slackBotToken = botToken;
      if (signingSecret) body.slackSigningSecret = signingSecret;
      if (channelId) body.slackChannelId = channelId;
      const res = await fetch(`/api/projects/${projectId}/slack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to save" }));
        throw new Error((err as { error?: string }).error ?? "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      setSaveStatus("success");
      setBotToken("");
      setSigningSecret("");
      queryClient.invalidateQueries({ queryKey: ["slack-config", projectId] });
      setTimeout(() => setSaveStatus("idle"), 3000);
    },
    onError: () => {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    },
  });

  const test = useTestMutation(`/api/projects/${projectId}/slack/test`, setTestResult);

  return (
    <WidgetSectionCard
      title="Slack"
      description="Maven posts in this channel when a customer needs a person."
      icon={SlackLogoIcon}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <FieldLabel required>Bot Token</FieldLabel>
          <Input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={configured ? "Enter new token to update" : "Paste your Slack bot token"}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel required>Signing Secret</FieldLabel>
          <Input
            type="password"
            value={signingSecret}
            onChange={(e) => setSigningSecret(e.target.value)}
            placeholder={configured ? "Enter new signing secret to update" : "Paste the Slack signing secret"}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Channel ID</FieldLabel>
          <Input
            type="text"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder={data?.slackChannelId ?? "Connects on its own — or paste a channel ID"}
          />
          <p className="text-xs text-muted-foreground">
            {`Point the Slack Events URL at /api/slack/events/${projectId}. The first verified message binds the channel.`}
          </p>
        </div>
      </div>
      <SaveNotice status={saveStatus} label="Slack" />
      {data?.authorScopeMissing && (
        <p className="text-sm text-muted-foreground">
          Reinstall the Slack app with the users:read.email scope so Maven knows who is writing.
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {configured && data?.slackChannelId && (
          <Button
            variant="outline"
            onClick={() => {
              setTestResult(null);
              test.mutate();
            }}
            disabled={test.isPending}
          >
            {test.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            Send Test Message
          </Button>
        )}
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || (!botToken && !signingSecret && !channelId)}
        >
          {save.isPending && <Loader2 className="animate-spin" />}
          {configured ? "Update" : "Save"}
        </Button>
      </div>
      <TestNotice result={testResult} />
    </WidgetSectionCard>
  );
}

// ─── Email ────────────────────────────────────────────────────────────────────

function formatInboundAge(iso: string): string {
  const elapsed = Date.now() - Date.parse(iso);
  if (!Number.isFinite(elapsed) || elapsed < 60 * 1000) return "New";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function inboundAddressStatus(address: InboundAddress): string {
  if (address.ignored) return "Ignored";
  const seenSpan =
    Date.parse(address.lastSeenAt) - Date.parse(address.firstSeenAt);
  if (!Number.isFinite(seenSpan) || seenSpan < 5 * 60 * 1000) return "New";
  return `Receiving · ${formatInboundAge(address.lastSeenAt)}`;
}

function EmailSection() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [forwardCopied, setForwardCopied] = useState(false);

  const { data: inboundEmail } = useQuery<InboundEmailData>({
    queryKey: ["inbound-email", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/inbound-email`);
      if (!res.ok) throw new Error("Failed to fetch email config");
      return res.json();
    },
    enabled: Boolean(projectId),
  });

  const ignoreAddress = useMutation({
    mutationFn: async ({ addressId, ignored }: { addressId: string; ignored: boolean }) => {
      const res = await fetch(
        `/api/projects/${projectId}/inbound-email/addresses/${addressId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ignored }),
        },
      );
      if (!res.ok) throw new Error("Failed to update address");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbound-email", projectId] });
    },
  });

  const addresses = inboundEmail?.addresses ?? [];

  return (
    <WidgetSectionCard title="Email" icon={EmailLogoIcon}>
      <p className="text-sm text-muted-foreground">
        Forward your emails to{" "}
        <button
          type="button"
          onClick={() => {
            if (!inboundEmail?.forwardTo) return;
            void navigator.clipboard.writeText(inboundEmail.forwardTo);
            setForwardCopied(true);
            setTimeout(() => setForwardCopied(false), 1500);
          }}
          className="inset-ring inset-ring-border hover:bg-glass-card inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 align-baseline font-mono text-xs text-foreground transition-colors"
        >
          {inboundEmail?.forwardTo ?? ""}
          {forwardCopied
            ? <CheckCircle2 className="size-3" />
            : <Copy className="size-3" />}
        </button>{" "}
        to be handled by Maven.{" "}
        <a
          href={EMAIL_FORWARDING_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline underline-offset-2"
        >
          Learn more &rarr;
        </a>
      </p>

      {addresses.length > 0 && (
        <div className="space-y-1">
          {addresses.map((address) => (
            <div
              key={address.id}
              className={cn(
                "flex min-h-10 items-center justify-between gap-3 rounded-lg",
                address.ignored && "opacity-50",
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">
                  {address.address}
                </p>
                <p className="text-xs text-muted-foreground">
                  {inboundAddressStatus(address)}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-glass-card"
                    aria-label={`Address actions for ${address.address}`}
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-32">
                  <DropdownMenuItem
                    onSelect={() =>
                      ignoreAddress.mutate({
                        addressId: address.id,
                        ignored: !address.ignored,
                      })
                    }
                  >
                    {address.ignored ? "Receive again" : "Ignore"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}
    </WidgetSectionCard>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ChannelsSettings() {
  return (
    <SettingsPage title="Channels">
      <EmailSection />
      <TelegramSection />
      <SlackSection />
    </SettingsPage>
  );
}
