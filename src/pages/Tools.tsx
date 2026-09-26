import { useEffect, useId, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  AlertCircle,
  Cable,
  Play,
  X,
  Loader2,
  Github,
  Search,
  Slack,
  Zap,
  CheckCircle2,
  Send,
  Inbox,
  Hash,
  Headset,
  Copy,
  MoreHorizontal,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetHeaderActions,
  SheetHeaderContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { SwitchCard } from "@/components/ui/switch-card";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  HeaderFields,
  type HeaderField,
} from "@/components/tools/header-fields";
import { EndpointField } from "@/components/tools/endpoint-field";
import { ExpandableToolCard } from "@/components/tools/ExpandableToolCard";
import { MobileMenuButton } from "@/components/PageHeader";
import McpConnections from "@/components/tools/McpConnections";

const EMAIL_FORWARDING_DOCS_URL =
  "https://replymaven.com/docs/integrations/forward-your-support-inbox";

function inboundEmailSubtitle(
  addresses: ReadonlyArray<{ address: string }>,
): string {
  const [first, ...rest] = addresses;
  if (!first) return "Forward support mail into ReplyMaven";
  return rest.length > 0 ? `${first.address} +${rest.length}` : first.address;
}

function connectorStatus(configured: boolean): string {
  return configured ? "Configure" : "Connect";
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  enum?: string[];
}

interface ResponseMapping {
  resultPath?: string;
  summaryTemplate?: string;
}

interface Tool {
  id: string;
  name: string;
  displayName: string;
  description: string;
  endpoint: string;
  method: "GET" | "POST";
  headers: Record<string, string> | null;
  parameters: ToolParameter[];
  responseMapping: ResponseMapping | null;
  enabled: boolean;
  timeout: number;
  sortOrder: number;
  allowedChannels: ToolAudience[];
  access: ToolAccess;
  createdAt: string;
  updatedAt: string;
}

interface ToolExecution {
  id: string;
  toolId: string;
  conversationId: string | null;
  input: string | null;
  output: string | null;
  status: "success" | "error" | "timeout";
  httpStatus: number | null;
  duration: number | null;
  errorMessage: string | null;
  createdAt: string;
}

function executionLine(exec: ToolExecution): string {
  const time = new Date(exec.createdAt).toLocaleString();
  const duration = exec.duration != null ? `${exec.duration}ms` : "no duration";
  if (exec.errorMessage) {
    return `${exec.status} · ${duration} · ${time} · ${exec.errorMessage}`;
  }
  return `${exec.status} · ${duration} · ${time}`;
}

interface ToolFormData {
  name: string;
  displayName: string;
  description: string;
  endpoint: string;
  method: "GET" | "POST";
  headers: { key: string; value: string }[];
  parameters: ToolParameter[];
  responseMapping: ResponseMapping;
  enabled: boolean;
  timeout: number;
  allowedChannels: ToolAudience[];
  access: ToolAccess;
}

type ToolAudience = "public" | "sidechat";
type ToolAccess = "read" | "write";

interface ToolPolicyValue {
  allowedChannels: ToolAudience[];
  access: ToolAccess;
}

const defaultToolPolicy: ToolPolicyValue = {
  allowedChannels: ["public"],
  access: "read",
};

const emptyForm: ToolFormData = {
  name: "",
  displayName: "",
  description: "",
  endpoint: "",
  method: "POST",
  headers: [],
  parameters: [],
  responseMapping: { resultPath: "", summaryTemplate: "" },
  enabled: true,
  timeout: 10000,
  ...defaultToolPolicy,
};

type DrawerKind = "http" | "mcp";
type McpAuthMode = "oauth" | "bearer" | "headers" | "none";

interface McpFormData {
  name: string;
  url: string;
  authMode: McpAuthMode;
  bearerToken: string;
  headers: HeaderField[];
}

const emptyMcpForm: McpFormData = {
  name: "",
  url: "",
  authMode: "oauth",
  bearerToken: "",
  headers: [],
};

function toHeaderRecord(headers: HeaderField[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const header of headers) {
    const key = header.key.trim();
    const value = header.value.trim();
    if (key && value) record[key] = value;
  }
  return record;
}

// Editing a connector never reveals stored header values, so the empty list
// has to say whether saving now keeps or drops them.
function describeStoredHeaders(input: {
  editing: boolean;
  hasStoredHeaders: boolean;
  dirty: boolean;
}): { title: string; detail: string } | null {
  if (!input.editing || !input.hasStoredHeaders) return null;
  if (!input.dirty) {
    return {
      title: "Saved headers are hidden.",
      detail: "They will be kept unless you add replacements.",
    };
  }
  return {
    title: "Saved headers will be removed.",
    detail: "Add replacements to keep authentication configured.",
  };
}

const PARAMETER_TYPE_OPTIONS = [
  { value: "string" as const, label: "String" },
  { value: "number" as const, label: "Number" },
  { value: "boolean" as const, label: "Boolean" },
];

const MCP_AUTH_OPTIONS: ReadonlyArray<{ value: McpAuthMode; label: string }> = [
  { value: "oauth", label: "OAuth" },
  { value: "bearer", label: "Bearer token" },
  { value: "headers", label: "Headers" },
  { value: "none", label: "None" },
];

// ─── Tool Presets ─────────────────────────────────────────────────────────────

interface PresetField {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password";
  help?: string;
  optional?: boolean;
  multiline?: boolean;
}

interface ToolPreset {
  name: string;
  label: string;
  blurb: string;
  icon: typeof Slack;
  iconBg: string;
  iconColor: string;
  fields: PresetField[];
  build: (
    values: Record<string, string>,
    existing: Tool | undefined,
    dirtyFields: ReadonlySet<string>,
  ) => PresetToolPayload;
  extract: (tool: Tool) => Record<string, string>;
}

interface ToolFormPayload {
  name: string;
  displayName: string;
  description: string;
  endpoint: string;
  method: "GET" | "POST";
  headers: Record<string, string> | null;
  parameters: ToolParameter[];
  responseMapping: ResponseMapping | null;
  enabled: boolean;
  timeout: number;
  allowedChannels: ToolAudience[];
  access: ToolAccess;
}

type PresetToolPayload = Omit<
  ToolFormPayload,
  "enabled" | "allowedChannels" | "access" | "headers"
> & {
  headers?: Record<string, string> | null;
};

function webhookPreset(input: {
  name: string;
  label: string;
  blurb: string;
  icon: typeof Slack;
  iconBg: string;
  iconColor: string;
  urlLabel: string;
  urlPlaceholder: string;
  help?: string;
  description: string;
  parameters: ToolParameter[];
  method?: "GET" | "POST";
}): ToolPreset {
  return {
    name: input.name,
    label: input.label,
    blurb: input.blurb,
    icon: input.icon,
    iconBg: input.iconBg,
    iconColor: input.iconColor,
    fields: [
      {
        key: "endpoint",
        label: input.urlLabel,
        placeholder: input.urlPlaceholder,
        help: input.help,
      },
    ],
    build: (values, existing) => ({
      name: input.name,
      displayName: input.label,
      description: input.description,
      endpoint: values.endpoint.trim(),
      method: input.method ?? "POST",
      ...(!existing ? { headers: null } : {}),
      parameters: input.parameters,
      responseMapping: null,
      timeout: 10000,
    }),
    extract: (tool) => ({ endpoint: tool.endpoint }),
  };
}

const TOOL_PRESETS: ToolPreset[] = [
  webhookPreset({
    name: "send_to_slack",
    label: "Send to Slack",
    blurb: "Post a message to a channel via incoming webhook.",
    icon: Slack,
    iconBg: "bg-[#611f69]/20",
    iconColor: "text-[#e0a8e6]",
    urlLabel: "Webhook URL",
    urlPlaceholder: "https://hooks.slack.com/services/...",
    help: "Slack \u2192 Apps \u2192 Incoming Webhooks \u2192 Add to a channel, then paste the URL.",
    description:
      "Post a short notification to the team's Slack channel. Use when the visitor reports something urgent or asks for the team to be notified.",
    parameters: [
      {
        name: "text",
        type: "string",
        description:
          "The message to post. Include the visitor's name or email and a one-sentence summary of what they need.",
        required: true,
      },
    ],
  }),
  webhookPreset({
    name: "send_to_discord",
    label: "Send to Discord",
    blurb: "Post a message to a channel via webhook.",
    icon: Hash,
    iconBg: "bg-[#5865F2]/15",
    iconColor: "text-[#7f8bf5]",
    urlLabel: "Webhook URL",
    urlPlaceholder: "https://discord.com/api/webhooks/...",
    help: "Channel settings \u2192 Integrations \u2192 Webhooks \u2192 New Webhook, then copy the URL.",
    description:
      "Post a short notification to the team's Discord channel. Use when the visitor reports something urgent or asks for the team to be notified.",
    parameters: [
      {
        name: "content",
        type: "string",
        description:
          "The message to post. Include the visitor's name or email and a one-sentence summary of what they need.",
        required: true,
      },
    ],
  }),
  webhookPreset({
    name: "trigger_automation",
    label: "Automation Webhook",
    blurb: "Trigger a Zapier or Make scenario with context.",
    icon: Zap,
    iconBg: "bg-orange-500/15",
    iconColor: "text-orange-400",
    urlLabel: "Webhook URL",
    urlPlaceholder: "https://hooks.zapier.com/hooks/catch/...",
    help: "Create a Zapier Zap or Make scenario with a webhook trigger, then paste its catch URL.",
    description:
      "Trigger the team's automation workflow with conversation context. Use when the visitor's request should kick off an internal process.",
    parameters: [
      {
        name: "summary",
        type: "string",
        description: "One-sentence summary of the visitor's request.",
        required: true,
      },
      {
        name: "visitor_email",
        type: "string",
        description: "The visitor's email address, if known.",
        required: false,
      },
    ],
  }),
  {
    name: "check_order_status",
    label: "HTTP Lookup",
    blurb: "GET request with a parameter, e.g. order status.",
    icon: Search,
    iconBg: "bg-sky-500/15",
    iconColor: "text-sky-400",
    fields: [
      {
        key: "endpoint",
        label: "Endpoint URL",
        placeholder: "https://api.example.com/orders",
        help: "The bot appends ?order_id=... to this URL. Edit the connector afterwards to rename the parameter.",
      },
      {
        key: "headers",
        label: "Headers",
        placeholder: "Authorization: Bearer sk-...\nX-API-Key: ...",
        help: "One per line as Name: Value.",
        optional: true,
        multiline: true,
      },
    ],
    build: (values, existing, dirtyFields) => {
      const headers: Record<string, string> = {};
      for (const line of (values.headers ?? "").split("\n")) {
        const idx = line.indexOf(":");
        if (idx <= 0) continue;
        const name = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (name && value) headers[name] = value;
      }
      const payload: PresetToolPayload = {
        name: "check_order_status",
        displayName: "Check Order Status",
        description:
          "Look up the current status of an order by its ID. Use when a visitor asks where their order is or whether it shipped.",
        endpoint: values.endpoint.trim(),
        method: "GET",
        parameters: [
          {
            name: "order_id",
            type: "string",
            description: "The order ID the visitor provided.",
            required: true,
          },
        ],
        responseMapping: null,
        timeout: 10000,
      };
      if (!existing) {
        payload.headers = Object.keys(headers).length > 0 ? headers : null;
      } else if (
        dirtyFields.has("headers") &&
        Object.keys(headers).length > 0
      ) {
        payload.headers = headers;
      }
      return payload;
    },
    extract: (tool) => ({
      endpoint: tool.endpoint,
      headers: "",
    }),
  },
  {
    name: "create_github_issue",
    label: "Create GitHub Issue",
    blurb: "File a bug report in your repository.",
    icon: Github,
    iconBg: "bg-glass-button",
    iconColor: "text-foreground",
    fields: [
      {
        key: "repo",
        label: "Repository",
        placeholder: "owner/repo",
      },
      {
        key: "token",
        label: "GitHub Token",
        placeholder: "ghp_... (fine-grained token with Issues write)",
        type: "password",
      },
    ],
    build: (values, existing, dirtyFields) => {
      const token = values.token.trim();
      const payload: PresetToolPayload = {
        name: "create_github_issue",
        displayName: "Create GitHub Issue",
        description:
          "Create a GitHub issue for a confirmed bug report. Use only when the visitor has described a reproducible problem the team should fix.",
        endpoint: `https://api.github.com/repos/${values.repo.trim()}/issues`,
        method: "POST",
        parameters: [
          {
            name: "title",
            type: "string",
            description: "Short issue title summarizing the bug.",
            required: true,
          },
          {
            name: "body",
            type: "string",
            description:
              "Issue body: steps to reproduce, expected vs actual behavior, and the visitor's environment if mentioned.",
            required: true,
          },
        ],
        responseMapping: null,
        timeout: 10000,
      };
      if (!existing || (dirtyFields.has("token") && token.length > 0)) {
        payload.headers = {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "ReplyMaven-Bot",
        };
      }
      return payload;
    },
    extract: (tool) => {
      const match = tool.endpoint.match(/repos\/(.+?)\/issues/);
      return { repo: match?.[1] ?? "", token: "" };
    },
  },
];

const PRESET_NAMES = new Set(TOOL_PRESETS.map((p) => p.name));

const TIMEOUT_OPTIONS = [5000, 10000, 15000, 20000, 30000];

// ─── Tool Policy Controls ────────────────────────────────────────────────────

function ToolPolicyFields({
  value,
  onChange,
  compact = false,
}: {
  value: ToolPolicyValue;
  onChange: (value: ToolPolicyValue) => void;
  compact?: boolean;
}) {
  const id = useId();

  function updateAudience(audience: ToolAudience, checked: boolean): void {
    const allowedChannels = checked
      ? Array.from(new Set([...value.allowedChannels, audience]))
      : value.allowedChannels.filter((channel) => channel !== audience);
    onChange({ ...value, allowedChannels });
  }

  return (
    <div className={cn("space-y-2", compact && "pt-1")}>
      <SwitchCard
        id={`${id}-public`}
        title="Available to visitors"
        checked={value.allowedChannels.includes("public")}
        onCheckedChange={(checked) => updateAudience("public", checked)}
      />
      <SwitchCard
        id={`${id}-sidechat`}
        title="Available in sidechat"
        checked={value.allowedChannels.includes("sidechat")}
        onCheckedChange={(checked) => updateAudience("sidechat", checked)}
      />
      <SwitchCard
        id={`${id}-access`}
        title="Can make changes"
        checked={value.access === "write"}
        onCheckedChange={(checked) =>
          onChange({ ...value, access: checked ? "write" : "read" })
        }
      />
    </div>
  );
}

// ─── Preset Tool Row ──────────────────────────────────────────────────────────

function PresetToolRow({
  preset,
  tool,
  projectId,
}: {
  preset: ToolPreset;
  tool: Tool | undefined;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(
    () => new Set(),
  );
  const [policy, setPolicy] = useState<ToolPolicyValue>(defaultToolPolicy);
  const configured = !!tool;

  useEffect(() => {
    if (tool) {
      setValues(preset.extract(tool));
      setPolicy({
        allowedChannels: tool.allowedChannels,
        access: tool.access,
      });
    } else {
      setValues({});
      setPolicy(defaultToolPolicy);
    }
    setDirtyFields(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool?.id, tool?.updatedAt]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...preset.build(values, tool, dirtyFields),
        enabled: tool?.enabled ?? true,
        ...policy,
      };
      const res = await fetch(
        tool
          ? `/api/projects/${projectId}/tools/${tool.id}`
          : `/api/projects/${projectId}/tools`,
        {
          method: tool ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to save" }));
        throw new Error((err as { error?: string }).error ?? "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      setDirtyFields(new Set());
      queryClient.invalidateQueries({ queryKey: ["tools", projectId] });
    },
  });

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch(`/api/projects/${projectId}/tools/${tool!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["tools", projectId] }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/tools/${tool!.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () => {
      setExpanded(false);
      queryClient.invalidateQueries({ queryKey: ["tools", projectId] });
    },
  });

  const requiredFilled = preset.fields.every((f) => {
    if (f.optional) return true;
    if (f.type === "password" && configured) return true;
    return (values[f.key] ?? "").trim().length > 0;
  });

  const Icon = preset.icon;

  function updateField(key: string, value: string): void {
    setValues((current) => ({ ...current, [key]: value }));
    setDirtyFields((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }

  return (
    <ExpandableToolCard
      mark={
        <div
          className={cn(
            "w-8 h-8 rounded-glass flex items-center justify-center",
            configured ? preset.iconBg : "bg-glass-button",
          )}
        >
          <Icon
            className={cn(
              "w-4 h-4",
              configured ? preset.iconColor : "text-muted-foreground",
            )}
          />
        </div>
      }
      title={preset.label}
      subtitle={preset.blurb}
      status={connectorStatus(configured)}
      configured={configured}
      open={expanded}
      onOpenChange={setExpanded}
      panelId={panelId}
    >
      <div className="px-4 py-4 space-y-3">
          {configured && (
            <SwitchCard
              title="Enabled"
              checked={tool!.enabled}
              onCheckedChange={(checked) => toggle.mutate(checked)}
            />
          )}
          {preset.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {field.label}{" "}
                {field.optional ? (
                  <span className="font-normal">(optional)</span>
                ) : (
                  <span className="text-destructive">*</span>
                )}
              </label>
              {field.multiline ? (
                <Textarea
                  value={values[field.key] ?? ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  rows={2}
                  placeholder={
                    configured && field.key === "headers"
                      ? "Leave blank to keep the current headers"
                      : field.placeholder
                  }
                />
              ) : (
                <Input
                  type={field.type ?? "text"}
                  value={values[field.key] ?? ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  placeholder={
                    field.type === "password" && configured
                      ? "Leave blank to keep the current value"
                      : field.placeholder
                  }
                />
              )}
              {field.help && (
                <p className="text-xs text-muted-foreground">{field.help}</p>
              )}
            </div>
          ))}
          <ToolPolicyFields value={policy} onChange={setPolicy} compact />
          {save.isError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {save.error.message}
            </div>
          )}
          {save.isSuccess && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 text-success text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Saved.
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            {configured ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
                className="-ml-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Remove
              </Button>
            ) : (
              <span />
            )}
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={save.isPending || !requiredFilled}
            >
              {save.isPending && <Loader2 className="animate-spin" />}
              {configured ? "Update" : "Save"}
            </Button>
          </div>
        </div>
    </ExpandableToolCard>
  );
}

// ─── Telegram Preset Types ────────────────────────────────────────────────────

interface TelegramData {
  telegramBotToken: string | null;
  telegramChatId: string | null;
}

interface SlackData {
  slackBotToken: string | null;
  slackSigningSecret: string | null;
  slackChannelId: string | null;
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

interface ToolsPanelProps {
  projectId: string;
  embedded?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ToolsPanel({
  projectId,
  embedded = false,
}: ToolsPanelProps) {
  const queryClient = useQueryClient();

  // UI state
  const [drawerKind, setDrawerKind] = useState<DrawerKind | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ToolFormData>(emptyForm);
  const [mcpForm, setMcpForm] = useState<McpFormData>(emptyMcpForm);
  const [customHeadersDirty, setCustomHeadersDirty] = useState(false);
  const [customHasStoredHeaders, setCustomHasStoredHeaders] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testParams, setTestParams] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ success: boolean; data: unknown } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Telegram preset state
  const [telegramExpanded, setTelegramExpanded] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramSaveStatus, setTelegramSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [telegramTestResult, setTelegramTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [slackExpanded, setSlackExpanded] = useState(false);
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackSigningSecret, setSlackSigningSecret] = useState("");
  const [slackChannelId, setSlackChannelId] = useState("");
  const [slackSaveStatus, setSlackSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [slackTestResult, setSlackTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [emailExpanded, setEmailExpanded] = useState(false);
  const [forwardCopied, setForwardCopied] = useState(false);

  // ─── Queries ──────────────────────────────────────────────────────────────

  const {
    data: tools,
    isLoading,
    isError,
  } = useQuery<Tool[]>({
    queryKey: ["tools", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/tools`);
      if (!res.ok) throw new Error("Failed to fetch connectors");
      return res.json();
    },
  });

  const customTools = (tools ?? []).filter((tool) => !PRESET_NAMES.has(tool.name));
  const editingTool = (tools ?? []).find((tool) => tool.id === editingId) ?? null;
  const executionsOpen = Boolean(editingId);

  const { data: executions, isLoading: executionsLoading } = useQuery<ToolExecution[]>({
    queryKey: ["tool-executions", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/tool-executions`);
      if (!res.ok) throw new Error("Failed to fetch executions");
      return res.json();
    },
    enabled: executionsOpen,
  });

  // ─── Telegram Preset Query ────────────────────────────────────────────────

  const { data: telegramData } = useQuery<TelegramData>({
    queryKey: ["telegram-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/telegram`);
      if (!res.ok) throw new Error("Failed to fetch telegram config");
      return res.json();
    },
  });

  const telegramConfigured = !!(telegramData?.telegramBotToken && telegramData?.telegramChatId);

  const { data: slackData } = useQuery<SlackData>({
    queryKey: ["slack-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/slack`);
      if (!res.ok) throw new Error("Failed to fetch slack config");
      return res.json();
    },
  });

  const slackConfigured = !!(slackData?.slackBotToken && slackData.slackSigningSecret);

  const { data: inboundEmail } = useQuery<InboundEmailData>({
    queryKey: ["inbound-email", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/inbound-email`);
      if (!res.ok) throw new Error("Failed to fetch email config");
      return res.json();
    },
  });

  // ─── Mutations ────────────────────────────────────────────────────────────

  const createTool = useMutation({
    mutationFn: async (data: ToolFormData) => {
      const body = {
        ...data,
        headers: data.headers.length > 0
          ? Object.fromEntries(data.headers.filter((h) => h.key).map((h) => [h.key, h.value]))
          : undefined,
        responseMapping: data.responseMapping.resultPath || data.responseMapping.summaryTemplate
          ? data.responseMapping
          : null,
      };
      const res = await fetch(`/api/projects/${projectId}/tools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to create connector" }));
        throw new Error((err as { error?: string }).error ?? "Failed to create connector");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools", projectId] });
      resetForm();
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const updateTool = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ToolFormData> }) => {
      const body: Record<string, unknown> = { ...data };
      if (data.headers !== undefined) {
        body.headers = data.headers.length > 0
          ? Object.fromEntries(data.headers.filter((h) => h.key).map((h) => [h.key, h.value]))
          : null;
      }
      if (data.responseMapping !== undefined) {
        body.responseMapping = data.responseMapping.resultPath || data.responseMapping.summaryTemplate
          ? data.responseMapping
          : null;
      }
      const res = await fetch(`/api/projects/${projectId}/tools/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to update connector" }));
        throw new Error((err as { error?: string }).error ?? "Failed to update connector");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools", projectId] });
      resetForm();
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const deleteTool = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/projects/${projectId}/tools/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete connector");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools", projectId] });
    },
  });

  const toggleTool = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await fetch(`/api/projects/${projectId}/tools/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle connector");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools", projectId] });
    },
  });

  const testTool = useMutation({
    mutationFn: async ({ id, params }: { id: string; params: Record<string, unknown> }) => {
      const res = await fetch(`/api/projects/${projectId}/tools/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Test failed");
      return data;
    },
    onSuccess: (data) => {
      setTestResult({ success: true, data });
    },
    onError: (err: Error) => {
      setTestResult({ success: false, data: err.message });
    },
  });

  // ─── Telegram Mutations ────────────────────────────────────────────────────

  const saveTelegram = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (telegramBotToken) body.telegramBotToken = telegramBotToken;
      if (telegramChatId) body.telegramChatId = telegramChatId;
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
      setTelegramSaveStatus("success");
      setTelegramBotToken("");
      queryClient.invalidateQueries({ queryKey: ["telegram-config", projectId] });
      setTimeout(() => setTelegramSaveStatus("idle"), 3000);
    },
    onError: () => {
      setTelegramSaveStatus("error");
      setTimeout(() => setTelegramSaveStatus("idle"), 3000);
    },
  });

  const testTelegram = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/telegram/test`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Test failed");
      return data;
    },
    onSuccess: () => {
      setTelegramTestResult({ success: true, message: "Test message sent successfully!" });
      setTimeout(() => setTelegramTestResult(null), 5000);
    },
    onError: (err: Error) => {
      setTelegramTestResult({ success: false, message: err.message });
      setTimeout(() => setTelegramTestResult(null), 5000);
    },
  });

  const saveSlack = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (slackBotToken) body.slackBotToken = slackBotToken;
      if (slackSigningSecret) body.slackSigningSecret = slackSigningSecret;
      if (slackChannelId) body.slackChannelId = slackChannelId;
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
      setSlackSaveStatus("success");
      setSlackBotToken("");
      setSlackSigningSecret("");
      queryClient.invalidateQueries({ queryKey: ["slack-config", projectId] });
      setTimeout(() => setSlackSaveStatus("idle"), 3000);
    },
    onError: () => {
      setSlackSaveStatus("error");
      setTimeout(() => setSlackSaveStatus("idle"), 3000);
    },
  });

  const testSlack = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/slack/test`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Test failed");
      return data;
    },
    onSuccess: () => {
      setSlackTestResult({ success: true, message: "Test message sent successfully!" });
      setTimeout(() => setSlackTestResult(null), 5000);
    },
    onError: (err: Error) => {
      setSlackTestResult({ success: false, message: err.message });
      setTimeout(() => setSlackTestResult(null), 5000);
    },
  });

  const createMcp = useMutation({
    mutationFn: async (input: {
      name: string;
      url: string;
      authMode: McpAuthMode;
      bearerToken?: string;
      headers?: Record<string, string>;
    }) => {
      const res = await fetch(`/api/projects/${projectId}/sidechat/mcp/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Could not connect" }));
        throw new Error((err as { error?: string }).error ?? "Could not connect");
      }
      return res.json() as Promise<{ connection: { authUrl?: string; name: string } }>;
    },
    onSuccess: ({ connection }) => {
      queryClient.invalidateQueries({ queryKey: ["sidechat-mcp", projectId] });
      resetForm();
      if (connection.authUrl) {
        window.location.assign(connection.authUrl);
      }
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const ignoreInboundAddress = useMutation({
    mutationFn: async ({
      addressId,
      ignored,
    }: {
      addressId: string;
      ignored: boolean;
    }) => {
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function resetForm() {
    setDrawerKind(null);
    setEditingId(null);
    setForm(emptyForm);
    setMcpForm(emptyMcpForm);
    setCustomHeadersDirty(false);
    setCustomHasStoredHeaders(false);
    setFormError(null);
    setTestingId(null);
    setTestResult(null);
  }

  function openHttpAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setCustomHeadersDirty(false);
    setCustomHasStoredHeaders(false);
    setFormError(null);
    setTestingId(null);
    setTestResult(null);
    setDrawerKind("http");
  }

  function openMcpAdd() {
    setEditingId(null);
    setMcpForm(emptyMcpForm);
    setFormError(null);
    setDrawerKind("mcp");
  }

  function startEdit(tool: Tool) {
    setCustomHasStoredHeaders(Boolean(tool.headers && Object.keys(tool.headers).length > 0));
    setCustomHeadersDirty(false);
    setEditingId(tool.id);
    setForm({
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      endpoint: tool.endpoint,
      method: tool.method,
      headers: [],
      parameters: tool.parameters,
      responseMapping: tool.responseMapping ?? { resultPath: "", summaryTemplate: "" },
      enabled: tool.enabled,
      timeout: tool.timeout,
      allowedChannels: tool.allowedChannels,
      access: tool.access,
    });
    setFormError(null);
    setDrawerKind("http");
  }

  function startTest(tool: Tool) {
    setTestingId(tool.id);
    setTestResult(null);
    const params: Record<string, string> = {};
    for (const p of tool.parameters) {
      params[p.name] = "";
    }
    setTestParams(params);
  }

  function handleSubmit() {
    setFormError(null);
    if (editingId) {
      const data: Partial<ToolFormData> = { ...form };
      if (!customHeadersDirty) delete data.headers;
      updateTool.mutate({ id: editingId, data });
      return;
    }
    createTool.mutate(form);
  }

  function submitMcp() {
    setFormError(null);
    if (!mcpForm.name.trim() || !mcpForm.url.trim()) {
      setFormError("Enter a server name and HTTPS URL.");
      return;
    }
    const input: {
      name: string;
      url: string;
      authMode: McpAuthMode;
      bearerToken?: string;
      headers?: Record<string, string>;
    } = {
      name: mcpForm.name.trim(),
      url: mcpForm.url.trim(),
      authMode: mcpForm.authMode,
    };
    if (mcpForm.authMode === "bearer") {
      if (!mcpForm.bearerToken) {
        setFormError("Paste a bearer token.");
        return;
      }
      input.bearerToken = mcpForm.bearerToken;
    }
    if (mcpForm.authMode === "headers") {
      const headers = toHeaderRecord(mcpForm.headers);
      if (Object.keys(headers).length === 0) {
        setFormError("Add at least one header with a name and a value.");
        return;
      }
      input.headers = headers;
    }
    createMcp.mutate(input);
  }

  function addParameter() {
    setForm((prev) => ({
      ...prev,
      parameters: [
        ...prev.parameters,
        { name: "", type: "string" as const, description: "", required: true },
      ],
    }));
  }

  function updateParameter(index: number, updates: Partial<ToolParameter>) {
    setForm((prev) => ({
      ...prev,
      parameters: prev.parameters.map((p, i) => (i === index ? { ...p, ...updates } : p)),
    }));
  }

  function removeParameter(index: number) {
    setForm((prev) => ({
      ...prev,
      parameters: prev.parameters.filter((_, i) => i !== index),
    }));
  }

  const emailReceiving = (inboundEmail?.addresses.length ?? 0) > 0;

  const toolExecutions = (executions ?? [])
    .filter((exec) => exec.toolId === editingTool?.id)
    .slice(0, 8);

  const storedHeaderNotice = describeStoredHeaders({
    editing: Boolean(editingId),
    hasStoredHeaders: customHasStoredHeaders,
    dirty: customHeadersDirty,
  });

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <MobileMenuButton />
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-foreground">
                Connectors
              </h1>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Connector
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem
                disabled={(tools?.length ?? 0) >= 20}
                onSelect={openHttpAdd}
              >
                HTTP Request
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openMcpAdd}>
                MCP Server
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <McpConnections projectId={projectId} />

      {/* Tool limit warning */}
      {(tools?.length ?? 0) >= 20 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-warning/10 text-warning text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Maximum of 20 connectors reached. Delete an existing connector to add a new one.
        </div>
      )}

      <Sheet
        open={drawerKind !== null}
        onOpenChange={(open) => {
          if (!open) resetForm();
        }}
      >
        <SheetContent side="right" aria-describedby={undefined} className="sm:max-w-xl">
          <SheetHeader>
            <SheetHeaderContent>
              <SheetTitle>
                {drawerKind === "mcp" ? "MCP Server" : "HTTP Request"}
              </SheetTitle>
            </SheetHeaderContent>
            <SheetHeaderActions>
              <SheetCloseButton label="Close connector" />
            </SheetHeaderActions>
          </SheetHeader>

          <SheetBody className="space-y-5 px-6 py-5">
            {formError && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {formError}
              </div>
            )}

            {drawerKind === "http" && (
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                handleSubmit();
              }}
            >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Machine Name <span className="text-destructive">*</span>
                </label>
                <Input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="check_order_status"
                  required
                  disabled={!!editingId}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Display Name <span className="text-destructive">*</span>
                </label>
                <Input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder="Check Order Status"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Description <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Looks up the current status of a customer order by order ID. Returns tracking info and estimated delivery."
                required
                rows={2}
                className="min-h-[72px]"
              />
              <p className="text-xs text-muted-foreground">
                Maven uses this to decide when to call it.
              </p>
            </div>

            <div className="space-y-2">
              {editingTool && (
                <SwitchCard
                  title="Enabled"
                  checked={form.enabled}
                  onCheckedChange={(checked) => {
                    setForm((current) => ({ ...current, enabled: checked }));
                    toggleTool.mutate({ id: editingTool.id, enabled: checked });
                  }}
                />
              )}
              <ToolPolicyFields
                value={{
                  allowedChannels: form.allowedChannels,
                  access: form.access,
                }}
                onChange={(policy) =>
                  setForm((current) => ({ ...current, ...policy }))
                }
              />
            </div>
            <EndpointField
              label="Endpoint"
              url={form.endpoint}
              onUrlChange={(endpoint) => setForm((f) => ({ ...f, endpoint }))}
              placeholder="https://api.example.com/orders/status"
              required
              method={form.method}
              onMethodChange={(method) => setForm((f) => ({ ...f, method }))}
              timeout={form.timeout}
              timeoutOptions={TIMEOUT_OPTIONS}
              onTimeoutChange={(timeout) => setForm((f) => ({ ...f, timeout }))}
            />

            <HeaderFields
              value={form.headers}
              onChange={(headers) => {
                setCustomHeadersDirty(true);
                setForm((f) => ({ ...f, headers }));
              }}
              emptyState={
                storedHeaderNotice && (
                  <p className="py-1 text-xs text-muted-foreground">
                    <strong className="font-semibold text-foreground">
                      {storedHeaderNotice.title}
                    </strong>{" "}
                    {storedHeaderNotice.detail}
                  </p>
                )
              }
            />

            {/* Parameters */}
            <div className="space-y-3 rounded-lg glass-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Parameters</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addParameter}
                  disabled={form.parameters.length >= 10}
                  className="h-7 text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                {form.parameters.map((param, i) => (
                  <div key={i} className="rounded-lg glass-card p-3 space-y-2">
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                      <Input
                        type="text"
                        value={param.name}
                        onChange={(e) => updateParameter(i, { name: e.target.value })}
                        placeholder="parameter_name"
                        className="flex-1 font-mono text-xs"
                      />
                      <Segmented
                        size="sm"
                        label="Parameter type"
                        value={param.type}
                        options={PARAMETER_TYPE_OPTIONS}
                        onValueChange={(type) => updateParameter(i, { type })}
                      />
                      <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                        <Checkbox
                          checked={param.required}
                          onCheckedChange={(checked) =>
                            updateParameter(i, { required: checked === true })
                          }
                        />
                        <span className="text-xs text-muted-foreground">Required</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => removeParameter(i)}
                        className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <Input
                      type="text"
                      value={param.description}
                      onChange={(e) => updateParameter(i, { description: e.target.value })}
                      placeholder="What the AI should provide"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Response Mapping */}
            <div className="space-y-3 rounded-lg glass-card p-4">
              <h3 className="text-sm font-semibold text-foreground">Response Mapping</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Result JSON Path</label>
                  <Input
                    type="text"
                    value={form.responseMapping.resultPath ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        responseMapping: { ...f.responseMapping, resultPath: e.target.value },
                      }))
                    }
                    placeholder="data.result"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Summary Template</label>
                  <Input
                    type="text"
                    value={form.responseMapping.summaryTemplate ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        responseMapping: { ...f.responseMapping, summaryTemplate: e.target.value },
                      }))
                    }
                    placeholder="Order {{order_id}} is {{status}}"
                  />
                </div>
              </div>
            </div>
            </form>
            )}

            {drawerKind === "http" && editingTool && (
              <div className="space-y-4">
                {testingId === editingTool.id && (
                  <div className="space-y-3 rounded-lg glass-card p-3">
                    {editingTool.parameters.length > 0 ? (
                      <div className="space-y-2">
                        {editingTool.parameters.map((param) => (
                          <label key={param.name} className="space-y-1.5 text-sm font-medium">
                            {param.name}
                            <Input
                              type="text"
                              value={testParams[param.name] ?? ""}
                              onChange={(event) =>
                                setTestParams((prev) => ({
                                  ...prev,
                                  [param.name]: event.target.value,
                                }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">This connector takes no parameters.</p>
                    )}
                    <Button
                      size="sm"
                      onClick={() => {
                        const parsed: Record<string, unknown> = {};
                        for (const param of editingTool.parameters) {
                          const val = testParams[param.name] ?? "";
                          if (param.type === "number") parsed[param.name] = Number(val);
                          else if (param.type === "boolean") parsed[param.name] = val === "true";
                          else parsed[param.name] = val;
                        }
                        testTool.mutate({ id: editingTool.id, params: parsed });
                      }}
                      disabled={testTool.isPending}
                    >
                      {testTool.isPending
                        ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        : <Play className="mr-1.5 h-3.5 w-3.5" />}
                      Run Test
                    </Button>
                    {testResult && (
                      <pre
                        className={cn(
                          "max-h-48 overflow-auto whitespace-pre-wrap rounded-lg p-3 font-mono text-xs",
                          testResult.success
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive",
                        )}
                      >
                        {typeof testResult.data === "string"
                          ? testResult.data
                          : JSON.stringify(testResult.data, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Recent executions</p>
                  {executionsLoading && (
                    <p className="text-xs text-muted-foreground">Loading executions.</p>
                  )}
                  {!executionsLoading && toolExecutions.length === 0 && (
                    <p className="text-xs text-muted-foreground">No recent executions.</p>
                  )}
                  {!executionsLoading &&
                    toolExecutions.map((exec) => (
                      <p key={exec.id} className="text-xs text-muted-foreground">
                        {executionLine(exec)}
                      </p>
                    ))}
                </div>
              </div>
            )}

            {drawerKind === "mcp" && (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Server name
                  </label>
                  <Input
                    value={mcpForm.name}
                    onChange={(event) =>
                      setMcpForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Customer data"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    HTTPS server URL
                  </label>
                  <Input
                    type="url"
                    value={mcpForm.url}
                    onChange={(event) =>
                      setMcpForm((current) => ({ ...current, url: event.target.value }))
                    }
                    placeholder="https://mcp.example.com/mcp"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Authentication
                  </label>
                  <Segmented
                    label="Authentication method"
                    value={mcpForm.authMode}
                    options={MCP_AUTH_OPTIONS}
                    onValueChange={(authMode) =>
                      setMcpForm((current) => ({ ...current, authMode }))
                    }
                  />
                </div>
                {mcpForm.authMode === "bearer" && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      Bearer token
                    </label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={mcpForm.bearerToken}
                      onChange={(event) =>
                        setMcpForm((current) => ({ ...current, bearerToken: event.target.value }))
                      }
                      placeholder="Paste token"
                    />
                  </div>
                )}
                {mcpForm.authMode === "headers" && (
                  <HeaderFields
                    value={mcpForm.headers}
                    onChange={(headers) =>
                      setMcpForm((current) => ({ ...current, headers }))
                    }
                  />
                )}
              </div>
            )}
          </SheetBody>

          <SheetFooter className="justify-between">
            {drawerKind === "http" && editingTool ? (
              <Button
                type="button"
                variant="ghost"
                disabled={deleteTool.isPending}
                onClick={() =>
                  deleteTool.mutate(editingTool.id, { onSuccess: resetForm })
                }
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {deleteTool.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
            {drawerKind === "http" && editingTool && (
              <Button
                type="button"
                variant="outline"
                onClick={() => startTest(editingTool)}
              >
                <Play />
                Test
              </Button>
            )}
            <Button
              type="button"
              disabled={
                drawerKind === "mcp"
                  ? createMcp.isPending
                  : createTool.isPending || updateTool.isPending
              }
              onClick={() => {
                if (drawerKind === "mcp") submitMcp();
                else handleSubmit();
              }}
            >
              {(createTool.isPending || updateTool.isPending || createMcp.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {drawerKind === "mcp" ? "Connect" : editingId ? "Update" : "Create"}
            </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ─── Tools Tab ───────────────────────────────────────────────────── */}
          {/* Loading */}
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-glass-button animate-pulse" />
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Failed to load connectors. Please try refreshing the page.
            </div>
          )}

          {/* Tool List */}
          {!isLoading && !isError && (
            <div className="space-y-2">
              {/* ─── Presets (2-col grid) ──────────────────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 items-start">
              {/* ─── Telegram Preset Tool ──────────────────────────────────── */}
              <ExpandableToolCard
                mark={
                  <div className={cn(
                    "w-8 h-8 rounded-glass flex items-center justify-center",
                    telegramConfigured ? "bg-[#229ED9]/15" : "bg-glass-button",
                  )}>
                    <Send className={cn(
                      "w-4 h-4",
                      telegramConfigured ? "text-[#229ED9]" : "text-muted-foreground",
                    )} />
                  </div>
                }
                title="Telegram Handoff"
                subtitle={
                  telegramConfigured
                    ? "Live agent handoff via Telegram when the bot cannot answer"
                    : "Set up Telegram to receive live handoff notifications"
                }
                status={connectorStatus(telegramConfigured)}
                configured={telegramConfigured}
                open={telegramExpanded}
                onOpenChange={setTelegramExpanded}
                panelId="telegram-preset-panel"
              >
                <div className="px-4 py-4 space-y-4">
                    <p className="text-xs text-muted-foreground">
                      When the bot cannot answer a question or the visitor requests a human, the conversation will be forwarded to your Telegram.
                    </p>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Bot Token <span className="text-destructive">*</span>
                        </label>
                        <Input
                          type="password"
                          value={telegramBotToken}
                          onChange={(e) => setTelegramBotToken(e.target.value)}
                          placeholder={telegramConfigured ? "Enter new token to update" : "Paste your bot token from @BotFather"}
                        />
                        <p className="text-xs text-muted-foreground">
                          Get a token from @BotFather in Telegram.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Chat ID
                        </label>
                        <Input
                          type="text"
                          value={telegramChatId}
                          onChange={(e) => setTelegramChatId(e.target.value)}
                          placeholder={telegramData?.telegramChatId ?? "Connects on its own — or paste an ID"}
                        />
                        <p className="text-xs text-muted-foreground">
                          Save the token, then add the bot to your group and send any message. The chat connects itself and the bot confirms in the group. Paste an ID here only if you want a specific chat.
                        </p>
                      </div>
                    </div>
                    {telegramSaveStatus === "error" && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        Failed to save Telegram settings.
                      </div>
                    )}
                    {telegramSaveStatus === "success" && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 text-success text-sm">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        Settings saved.
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => saveTelegram.mutate()}
                        disabled={saveTelegram.isPending || (!telegramBotToken && !telegramChatId)}
                      >
                        {saveTelegram.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                        {telegramConfigured ? "Update" : "Save"}
                      </Button>
                      {telegramConfigured && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setTelegramTestResult(null);
                            testTelegram.mutate();
                          }}
                          disabled={testTelegram.isPending}
                        >
                          {testTelegram.isPending ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5 mr-1.5" />
                          )}
                          Send Test Message
                        </Button>
                      )}
                    </div>
                    {telegramTestResult && (
                      <div
                        className={cn(
                          "rounded-lg p-3 text-xs max-h-48 overflow-auto",
                          telegramTestResult.success
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive",
                        )}
                      >
                        {telegramTestResult.message}
                      </div>
                    )}
                </div>
              </ExpandableToolCard>

              <ExpandableToolCard
                mark={
                  <div className={cn(
                    "w-8 h-8 rounded-glass flex items-center justify-center",
                    slackConfigured ? "bg-[#4A154B]/15" : "bg-glass-button",
                  )}>
                    <Headset className={cn(
                      "w-4 h-4",
                      slackConfigured ? "text-[#4A154B]" : "text-muted-foreground",
                    )} />
                  </div>
                }
                title="Slack Handoff"
                subtitle={
                  slackConfigured
                    ? "Live agent handoff via Slack when the bot cannot answer"
                    : "Set up Slack to receive live handoff notifications"
                }
                status={connectorStatus(slackConfigured)}
                configured={slackConfigured}
                open={slackExpanded}
                onOpenChange={setSlackExpanded}
                panelId="slack-preset-panel"
              >
                <div className="px-4 py-4 space-y-4">
                    <p className="text-xs text-muted-foreground">
                      When the bot cannot answer a question or the visitor requests a human, the conversation will be forwarded to your Slack channel. This is separate from the Send to Slack connector.
                    </p>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Bot Token <span className="text-destructive">*</span>
                        </label>
                        <Input
                          type="password"
                          value={slackBotToken}
                          onChange={(e) => setSlackBotToken(e.target.value)}
                          placeholder={slackConfigured ? "Enter new token to update" : "Paste your Slack bot token"}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Signing Secret <span className="text-destructive">*</span>
                        </label>
                        <Input
                          type="password"
                          value={slackSigningSecret}
                          onChange={(e) => setSlackSigningSecret(e.target.value)}
                          placeholder={slackConfigured ? "Enter new signing secret to update" : "Paste the Slack signing secret"}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Channel ID
                        </label>
                        <Input
                          type="text"
                          value={slackChannelId}
                          onChange={(e) => setSlackChannelId(e.target.value)}
                          placeholder={slackData?.slackChannelId ?? "Connects on its own — or paste a channel ID"}
                        />
                        <p className="text-xs text-muted-foreground">
                          {`Point the Slack Events URL at /api/slack/events/${projectId}. The first verified message binds the channel, or paste an ID here.`}
                        </p>
                      </div>
                    </div>
                    {slackSaveStatus === "error" && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        Failed to save Slack settings.
                      </div>
                    )}
                    {slackSaveStatus === "success" && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 text-success text-sm">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        Settings saved.
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => saveSlack.mutate()}
                        disabled={saveSlack.isPending || (!slackBotToken && !slackSigningSecret && !slackChannelId)}
                      >
                        {saveSlack.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                        {slackConfigured ? "Update" : "Save"}
                      </Button>
                      {slackConfigured && slackData?.slackChannelId && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSlackTestResult(null);
                            testSlack.mutate();
                          }}
                          disabled={testSlack.isPending}
                        >
                          {testSlack.isPending ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5 mr-1.5" />
                          )}
                          Send Test Message
                        </Button>
                      )}
                    </div>
                    {slackTestResult && (
                      <div
                        className={cn(
                          "rounded-lg p-3 text-xs max-h-48 overflow-auto",
                          slackTestResult.success
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive",
                        )}
                      >
                        {slackTestResult.message}
                      </div>
                    )}
                </div>
              </ExpandableToolCard>

              <ExpandableToolCard
                mark={
                  <div className={cn(
                    "w-8 h-8 rounded-glass flex items-center justify-center",
                    emailReceiving ? "bg-brand/15" : "bg-glass-button",
                  )}>
                    <Inbox className={cn(
                      "w-4 h-4",
                      emailReceiving
                        ? "text-brand"
                        : "text-muted-foreground",
                    )} />
                  </div>
                }
                title="Email"
                subtitle={
                  emailReceiving
                    ? inboundEmailSubtitle(inboundEmail?.addresses ?? [])
                    : "Forward support mail into ReplyMaven"
                }
                status="Configure"
                configured={emailReceiving}
                open={emailExpanded}
                onOpenChange={setEmailExpanded}
                panelId="inbound-email-panel"
              >
                <div className="space-y-4 px-4 py-4">
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-foreground">
                      Support inbox
                    </p>
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
                  </div>
                  {(inboundEmail?.addresses.length ?? 0) > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">Addresses</p>
                      {inboundEmail?.addresses.map((address) => (
                        <div
                          key={address.id}
                          className={cn(
                            "flex min-h-10 items-center justify-between gap-3 rounded-lg px-1",
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
                                  ignoreInboundAddress.mutate({
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
                </div>
              </ExpandableToolCard>

              {/* ─── Preset Tools ──────────────────────────────────────────── */}
              {TOOL_PRESETS.map((preset) => (
                <PresetToolRow
                  key={preset.name}
                  preset={preset}
                  tool={tools?.find((t) => t.name === preset.name)}
                  projectId={projectId}
                />
              ))}
              </div>

              {/* ─── Custom Tools ──────────────────────────────────────────── */}
              {customTools.map((tool) => {
                return (
                  <ExpandableToolCard
                    key={tool.id}
                    mark={
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-glass-button">
                        <Cable className="h-4 w-4 text-muted-foreground" />
                      </div>
                    }
                    title={tool.displayName}
                    subtitle={tool.description}
                    status={connectorStatus(true)}
                    configured
                    mode="action"
                    onActivate={() => startEdit(tool)}
                  />
                );
              })}

            </div>
          )}
    </div>
  );
}

function Tools() {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) return null;

  return <ToolsPanel projectId={projectId} />;
}

export default Tools;
