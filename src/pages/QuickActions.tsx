import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Zap,
  Plus,
  Trash2,
  AlertCircle,
  Link as LinkIcon,
  MessageSquareText,
  Sparkles,
  ExternalLink,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Clock,
  Inbox,
  Type,
  AlignLeft,
  Settings,
  X,
  FileText,
  Mail,
  Calendar,
  Bell,
  Folder,
  Globe,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MobileMenuButton } from "@/components/PageHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionType = "prompt" | "link" | "inquiry";

interface QuickAction {
  id: string;
  type: ActionType;
  label: string;
  action: string;
  icon: string;
  showOnHome: boolean;
  sortOrder: number;
}

interface InquiryField {
  label: string;
  type: "text" | "textarea";
  required: boolean;
}

interface InquiryConfig {
  enabled: boolean;
  description: string | null;
  fields: InquiryField[];
}

interface InquirySubmission {
  id: string;
  visitorId: string | null;
  data: Record<string, string>;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ICON_OPTIONS = [
  { value: "link", label: "Link", Icon: LinkIcon },
  { value: "docs", label: "Docs", Icon: FileText },
  { value: "mail", label: "Mail", Icon: Mail },
  { value: "calendar", label: "Calendar", Icon: Calendar },
  { value: "bell", label: "Bell", Icon: Bell },
  { value: "folder", label: "Folder", Icon: Folder },
  { value: "globe", label: "Globe", Icon: Globe },
  { value: "external", label: "External", Icon: ExternalLink },
  { value: "sparkle", label: "AI", Icon: Sparkles },
  { value: "chat", label: "Chat", Icon: MessageSquareText },
];

const TYPE_CONFIG: Record<
  ActionType,
  { label: string; description: string; RightIcon: typeof ChevronRight; iconColor: string }
> = {
  prompt: {
    label: "Prompt",
    description: "Sends a message to the AI",
    RightIcon: Sparkles,
    iconColor: "text-primary",
  },
  link: {
    label: "External Link",
    description: "Opens a URL in a new tab",
    RightIcon: ExternalLink,
    iconColor: "text-status-replied",
  },
  inquiry: {
    label: "Inquiry",
    description: "Opens the inquiry form",
    RightIcon: ChevronRight,
    iconColor: "text-status-active",
  },
};

function getIconComponent(icon: string) {
  const found = ICON_OPTIONS.find((o) => o.value === icon);
  return found?.Icon ?? LinkIcon;
}

// ─── Main Component ───────────────────────────────────────────────────────────

function QuickActions() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"actions" | "inquiry">("actions");

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 md:w-6 md:h-6" />
            Quick Actions
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Buttons displayed on the widget home screen and chat view. Configure
            inquiry form settings here too.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {(
          [
            { key: "actions", label: "Actions" },
            { key: "inquiry", label: "Inquiries" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "actions" && <ActionsTab projectId={projectId!} queryClient={queryClient} />}
      {activeTab === "inquiry" && <InquiriesTab projectId={projectId!} queryClient={queryClient} />}
    </div>
  );
}

// ─── Actions Tab ──────────────────────────────────────────────────────────────

function ActionsTab({
  projectId,
  queryClient,
}: {
  projectId: string;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [newType, setNewType] = useState<ActionType>("prompt");
  const [newLabel, setNewLabel] = useState("");
  const [newAction, setNewAction] = useState("");
  const [newIcon, setNewIcon] = useState("sparkle");
  const [newShowOnHome, setNewShowOnHome] = useState(false);

  const {
    data: actions,
    isLoading,
    isError,
  } = useQuery<QuickAction[]>({
    queryKey: ["quick-actions", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/quick-actions`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const addAction = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/quick-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          label: newLabel,
          action: newAction,
          icon: newIcon,
          showOnHome: newShowOnHome,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quick-actions", projectId] });
      setNewLabel("");
      setNewAction("");
      setNewShowOnHome(false);
    },
  });

  const deleteAction = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/quick-actions/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quick-actions", projectId] });
    },
  });

  const toggleHome = useMutation({
    mutationFn: async ({ id, showOnHome }: { id: string; showOnHome: boolean }) => {
      const res = await fetch(
        `/api/projects/${projectId}/quick-actions/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ showOnHome }),
        },
      );
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quick-actions", projectId] });
    },
  });

  // Update default icon when type changes
  useEffect(() => {
    const defaults: Record<ActionType, string> = {
      prompt: "sparkle",
      link: "link",
      inquiry: "mail",
    };
    setNewIcon(defaults[newType]);
  }, [newType]);

  const hasInquiry = actions?.some((a) => a.type === "inquiry");

  return (
    <div className="space-y-6">
      {/* Add Action Form */}
      <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Add action</h3>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addAction.mutate();
          }}
          className="space-y-3"
        >
          {/* Row 1: Type + Icon */}
          <div className="flex flex-wrap gap-2">
            <Select
              value={newType}
              onValueChange={(val) => setNewType(val as ActionType)}
            >
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="prompt" disabled={false}>
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Prompt
                  </span>
                </SelectItem>
                <SelectItem value="link" disabled={false}>
                  <span className="flex items-center gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5" />
                    External Link
                  </span>
                </SelectItem>
                <SelectItem
                  value="inquiry"
                  disabled={!!hasInquiry}
                >
                  <span className="flex items-center gap-1.5">
                    <MessageSquareText className="w-3.5 h-3.5" />
                    Inquiry
                    {hasInquiry && (
                      <span className="text-[10px] text-muted-foreground ml-1">(exists)</span>
                    )}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            <Select value={newIcon} onValueChange={setNewIcon}>
              <SelectTrigger className="w-full sm:w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ICON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-1.5">
                      <opt.Icon className="w-3.5 h-3.5" />
                      {opt.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Row 2: Label + Action */}
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label"
              required
              className="flex-1 px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {(newType === "prompt" || newType === "link") && (
              <input
                type={newType === "link" ? "url" : "text"}
                value={newAction}
                onChange={(e) => setNewAction(e.target.value)}
                placeholder={newType === "link" ? "https://example.com" : "Pre-filled message"}
                required
                className="flex-1 px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}
          </div>

          {/* Row 3: Show on home + submit */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Checkbox
                id="show-on-home"
                checked={newShowOnHome}
                onCheckedChange={(checked) => setNewShowOnHome(checked === true)}
              />
              <Label
                htmlFor="show-on-home"
                className="text-sm text-muted-foreground font-normal cursor-pointer"
              >
                Show on home screen
              </Label>
            </div>
            <Button type="submit" size="sm" disabled={addAction.isPending}>
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
        </form>

        {addAction.isError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {addAction.error.message}
          </div>
        )}
      </div>

      {/* Actions List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to load quick actions
        </div>
      ) : actions && actions.length > 0 ? (
        <div className="space-y-2">
          {actions.map((action) => {
            const IconComp = getIconComponent(action.icon);
            const typeConf = TYPE_CONFIG[action.type as ActionType];
            if (!typeConf) return null;
            return (
              <div
                key={action.id}
                className="flex items-center gap-3 px-4 py-3 bg-card/50 rounded-xl border border-border group"
              >
                {/* Left icon */}
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <IconComp className="w-4 h-4 text-muted-foreground" />
                </div>

                {/* Label + meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {action.label}
                    </p>
                    <Badge variant="outline" className="text-[10px] shrink-0 gap-1">
                      <typeConf.RightIcon className={cn("w-3 h-3", typeConf.iconColor)} />
                      {typeConf.label}
                    </Badge>
                  </div>
                  {action.action && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {action.action}
                    </p>
                  )}
                </div>

                {/* Home toggle */}
                <button
                  onClick={() =>
                    toggleHome.mutate({
                      id: action.id,
                      showOnHome: !action.showOnHome,
                    })
                  }
                  className={cn(
                    "p-1.5 rounded-lg transition-colors",
                    action.showOnHome
                      ? "text-primary hover:bg-primary/10"
                      : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted",
                  )}
                  title={action.showOnHome ? "Shown on home screen" : "Hidden from home screen"}
                >
                  {action.showOnHome ? (
                    <Eye className="w-4 h-4" />
                  ) : (
                    <EyeOff className="w-4 h-4" />
                  )}
                </button>

                {/* Delete */}
                <button
                  onClick={() => deleteAction.mutate(action.id)}
                  disabled={deleteAction.isPending}
                  className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-destructive disabled:opacity-50 transition-opacity"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
            <Zap className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            No quick actions yet
          </h2>
          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            Add actions like AI prompts, external links, and inquiry form
            buttons. They appear on the widget home screen and chat view.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Inquiries Tab ────────────────────────────────────────────────────────────

function InquiriesTab({
  projectId,
  queryClient,
}: {
  projectId: string;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [description, setDescription] = useState(
    "We'll get back to you within 1-2 hours.",
  );
  const [fields, setFields] = useState<InquiryField[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<"text" | "textarea">("text");
  const [newRequired, setNewRequired] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: config, isLoading } = useQuery<InquiryConfig>({
    queryKey: ["inquiry-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/inquiries`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: submissions, isLoading: submissionsLoading } = useQuery<
    InquirySubmission[]
  >({
    queryKey: ["inquiries", projectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/inquiries/submissions`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  useEffect(() => {
    if (config) {
      setEnabled(config.enabled);
      setDescription(
        config.description ?? "We'll get back to you within 1-2 hours.",
      );
      setFields(config.fields);
      setHasChanges(false);
    }
  }, [config]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/inquiries`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, description, fields }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["inquiry-config", projectId],
      });
      setHasChanges(false);
    },
  });

  function addField() {
    if (!newLabel.trim()) return;
    if (fields.length >= 10) return;
    setFields([
      ...fields,
      { label: newLabel.trim(), type: newType, required: newRequired },
    ]);
    setNewLabel("");
    setNewType("text");
    setNewRequired(false);
    setHasChanges(true);
  }

  function removeField(index: number) {
    setFields(fields.filter((_, i) => i !== index));
    setHasChanges(true);
  }

  function moveField(index: number, direction: "up" | "down") {
    const newFields = [...fields];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newFields.length) return;
    [newFields[index], newFields[targetIndex]] = [
      newFields[targetIndex],
      newFields[index],
    ];
    setFields(newFields);
    setHasChanges(true);
  }

  const isConfigured = config?.enabled && (config?.fields?.length ?? 0) > 0;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded-xl bg-muted animate-pulse" />
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Inquiries
          </h2>
          <p className="text-sm text-muted-foreground">
            Messages from visitors who used the "Leave a message" form.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSettingsOpen(true)}
          className="gap-1.5"
        >
          <Settings className="w-4 h-4" />
          Settings
        </Button>
      </div>

      {/* Submissions or empty state */}
      {!isConfigured ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
            <MessageSquareText className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            No inquiry form configured
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">
            Let visitors leave a message when you're away. Set up a form with
            custom fields like name, email, and message. Then add an "Inquiry"
            quick action on the Actions tab to show it in your widget.
          </p>
          <Button onClick={() => setSettingsOpen(true)} className="gap-1.5">
            <Settings className="w-4 h-4" />
            Set up form
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 mb-1">
            <Badge variant="secondary" className="gap-1">
              <Inbox className="w-3 h-3" />
              {submissions?.length ?? 0} submissions
            </Badge>
            {config?.fields && (
              <Badge variant="outline" className="gap-1">
                {config.fields.length} field{config.fields.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {submissionsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 rounded-xl bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : submissions && submissions.length > 0 ? (
            <div className="space-y-2">
              {[...submissions].reverse().map((sub) => (
                <div
                  key={sub.id}
                  className="px-5 py-4 bg-card rounded-xl border border-border"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(sub.createdAt).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      at{" "}
                      {new Date(sub.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    {sub.visitorId && (
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {sub.visitorId}
                      </span>
                    )}
                  </div>
                  <div className="grid gap-2">
                    {Object.entries(sub.data).map(([key, value]) => (
                      <div key={key} className="flex gap-3">
                        <span className="text-xs font-medium text-muted-foreground w-24 shrink-0 pt-0.5">
                          {key}
                        </span>
                        <span className="text-sm text-foreground whitespace-pre-wrap break-words min-w-0">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Inbox className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                No submissions yet. They'll appear here when visitors submit the
                form.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Settings Slide-over Panel */}
      <div
        className={cn(
          "fixed inset-0 bg-black/40 z-40 transition-opacity",
          settingsOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        onClick={() => setSettingsOpen(false)}
      />

      <div
        className={cn(
          "fixed top-0 right-0 h-full w-full max-w-lg bg-background border-l border-border z-50 flex flex-col transition-transform duration-300 ease-in-out",
          settingsOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Form settings
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure your inquiry form fields and behavior
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(false)}
            className="h-8 w-8"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable inquiry form</Label>
              <p className="text-xs text-muted-foreground">
                Enables the inquiry form feature for your widget
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => {
                setEnabled(checked);
                setHasChanges(true);
              }}
            />
          </div>

          {enabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="form-description">Form description</Label>
                <p className="text-xs text-muted-foreground">
                  Shown at the top of the form. Let visitors know when to expect
                  a reply.
                </p>
                <textarea
                  id="form-description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="We'll get back to you within 1-2 hours."
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Inquiry form fields</Label>
                  <span className="text-xs text-muted-foreground">
                    {fields.length}/10
                  </span>
                </div>

                {fields.length > 0 && (
                  <div className="space-y-1.5">
                    {fields.map((field, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg group"
                      >
                        <div className="flex flex-col -space-y-1">
                          <button
                            type="button"
                            onClick={() => moveField(index, "up")}
                            disabled={index === 0}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveField(index, "down")}
                            disabled={index === fields.length - 1}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="w-7 h-7 rounded-md bg-background border border-border flex items-center justify-center shrink-0">
                          {field.type === "textarea" ? (
                            <AlignLeft className="w-3.5 h-3.5 text-muted-foreground" />
                          ) : (
                            <Type className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {field.label}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {field.type === "textarea"
                              ? "Multi-line"
                              : "Single-line"}
                            {field.required && " -- Required"}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeField(index)}
                          className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-destructive transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {fields.length === 0 && (
                  <div className="py-6 text-center border border-dashed border-border rounded-xl">
                    <Type className="w-6 h-6 mx-auto text-muted-foreground/40 mb-2" />
                    <p className="text-xs text-muted-foreground">
                      No fields yet. Add your first field below.
                    </p>
                  </div>
                )}

                {fields.length < 10 && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      addField();
                    }}
                    className="space-y-3 p-3 bg-muted/30 rounded-xl border border-dashed border-border"
                  >
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        type="text"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="Field label (e.g. Email)"
                        className="flex-1"
                      />
                      <Select
                        value={newType}
                        onValueChange={(val) =>
                          setNewType(val as "text" | "textarea")
                        }
                      >
                        <SelectTrigger className="w-full sm:w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">
                            <Type className="w-3.5 h-3.5" />
                            Text input
                          </SelectItem>
                          <SelectItem value="textarea">
                            <AlignLeft className="w-3.5 h-3.5" />
                            Text area
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="new-field-required"
                          checked={newRequired}
                          onCheckedChange={(checked) =>
                            setNewRequired(checked === true)
                          }
                        />
                        <Label
                          htmlFor="new-field-required"
                          className="text-sm text-muted-foreground font-normal cursor-pointer"
                        >
                          Required field
                        </Label>
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={!newLabel.trim()}
                        className="gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center gap-3">
          <Button
            onClick={() => saveConfig.mutate()}
            disabled={!hasChanges || saveConfig.isPending}
            className="flex-1"
          >
            {saveConfig.isPending ? "Saving..." : "Save changes"}
          </Button>
          {saveConfig.isError && (
            <div className="flex items-center gap-1.5 text-destructive text-xs">
              <AlertCircle className="w-3.5 h-3.5" />
              Failed
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default QuickActions;
