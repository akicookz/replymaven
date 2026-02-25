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
  CalendarClock,
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
  Phone,
  User,
  XCircle,
  CalendarDays,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionType = "prompt" | "link" | "contact_form" | "booking";

interface QuickAction {
  id: string;
  type: ActionType;
  label: string;
  action: string;
  icon: string;
  showOnHome: boolean;
  sortOrder: number;
}

interface ContactFormField {
  label: string;
  type: "text" | "textarea";
  required: boolean;
}

interface ContactFormConfig {
  enabled: boolean;
  description: string | null;
  fields: ContactFormField[];
}

interface ContactFormSubmission {
  id: string;
  visitorId: string | null;
  data: Record<string, string>;
  createdAt: string;
}

interface BookingConfig {
  id?: string;
  enabled: boolean;
  timezone: string;
  slotDuration: number;
  bufferTime: number;
  bookingWindowDays: number;
  minAdvanceHours: number;
}

interface AvailabilityRule {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface Booking {
  id: string;
  visitorName: string;
  visitorEmail: string;
  visitorPhone: string | null;
  notes: string | null;
  startTime: string;
  endTime: string;
  timezone: string;
  status: "confirmed" | "cancelled";
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
    iconColor: "text-violet-500",
  },
  link: {
    label: "External Link",
    description: "Opens a URL in a new tab",
    RightIcon: ExternalLink,
    iconColor: "text-blue-500",
  },
  contact_form: {
    label: "Contact Form",
    description: "Opens the contact form",
    RightIcon: ChevronRight,
    iconColor: "text-emerald-500",
  },
  booking: {
    label: "Booking",
    description: "Opens the booking calendar",
    RightIcon: ChevronRight,
    iconColor: "text-amber-500",
  },
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Stockholm",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
];

function getIconComponent(icon: string) {
  const found = ICON_OPTIONS.find((o) => o.value === icon);
  return found?.Icon ?? LinkIcon;
}

// ─── Main Component ───────────────────────────────────────────────────────────

function QuickActions() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"actions" | "contact_form" | "booking">("actions");

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="space-y-1 mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Zap className="w-6 h-6" />
          Quick Actions
        </h1>
        <p className="text-sm text-muted-foreground">
          Buttons displayed on the widget home screen and chat view. Configure
          contact form and booking settings here too.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {(
          [
            { key: "actions", label: "Actions" },
            { key: "contact_form", label: "Contact Form" },
            { key: "booking", label: "Booking" },
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
      {activeTab === "contact_form" && <ContactFormTab projectId={projectId!} queryClient={queryClient} />}
      {activeTab === "booking" && <BookingTab projectId={projectId!} queryClient={queryClient} />}
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
      contact_form: "mail",
      booking: "calendar",
    };
    setNewIcon(defaults[newType]);
  }, [newType]);

  const hasContactForm = actions?.some((a) => a.type === "contact_form");
  const hasBooking = actions?.some((a) => a.type === "booking");

  return (
    <div className="space-y-6">
      {/* Add Action Form */}
      <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Add action</h3>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addAction.mutate();
          }}
          className="space-y-3"
        >
          {/* Row 1: Type + Icon */}
          <div className="flex gap-2">
            <Select
              value={newType}
              onValueChange={(val) => setNewType(val as ActionType)}
            >
              <SelectTrigger className="w-44">
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
                  value="contact_form"
                  disabled={!!hasContactForm}
                >
                  <span className="flex items-center gap-1.5">
                    <MessageSquareText className="w-3.5 h-3.5" />
                    Contact Form
                    {hasContactForm && (
                      <span className="text-[10px] text-muted-foreground ml-1">(exists)</span>
                    )}
                  </span>
                </SelectItem>
                <SelectItem
                  value="booking"
                  disabled={!!hasBooking}
                >
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="w-3.5 h-3.5" />
                    Booking
                    {hasBooking && (
                      <span className="text-[10px] text-muted-foreground ml-1">(exists)</span>
                    )}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            <Select value={newIcon} onValueChange={setNewIcon}>
              <SelectTrigger className="w-28">
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
          <div className="flex gap-2">
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
          <div className="flex items-center justify-between">
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
            const typeConf = TYPE_CONFIG[action.type];
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
            Add actions like AI prompts, external links, contact forms, and booking
            buttons. They appear on the widget home screen and chat view.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Contact Form Tab ─────────────────────────────────────────────────────────

function ContactFormTab({
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
  const [fields, setFields] = useState<ContactFormField[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<"text" | "textarea">("text");
  const [newRequired, setNewRequired] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: config, isLoading } = useQuery<ContactFormConfig>({
    queryKey: ["contact-form", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/contact-form`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: submissions, isLoading: submissionsLoading } = useQuery<
    ContactFormSubmission[]
  >({
    queryKey: ["contact-form-submissions", projectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/contact-form/submissions`,
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
      const res = await fetch(`/api/projects/${projectId}/contact-form`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, description, fields }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["contact-form", projectId],
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
            Contact Form
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
            No contact form configured
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">
            Let visitors leave a message when you're away. Set up a form with
            custom fields like name, email, and message. Then add a "Contact Form"
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
              Configure your contact form fields and behavior
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
              <Label>Enable contact form</Label>
              <p className="text-xs text-muted-foreground">
                Enables the contact form feature for your widget
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
                  <Label>Form fields</Label>
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
                    <div className="flex gap-2">
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
                        <SelectTrigger className="w-[130px]">
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

// ─── Booking Tab ──────────────────────────────────────────────────────────────

function BookingTab({
  projectId,
  queryClient,
}: {
  projectId: string;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState("America/New_York");
  const [slotDuration, setSlotDuration] = useState(30);
  const [bufferTime, setBufferTime] = useState(0);
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: configData, isLoading: configLoading } = useQuery<{
    config: BookingConfig;
    rules: AvailabilityRule[];
  }>({
    queryKey: ["booking-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/booking/config`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: bookings, isLoading: bookingsLoading } = useQuery<Booking[]>({
    queryKey: ["bookings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/bookings`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  useEffect(() => {
    if (configData) {
      setEnabled(configData.config.enabled);
      setTimezone(configData.config.timezone);
      setSlotDuration(configData.config.slotDuration);
      setBufferTime(configData.config.bufferTime);
      setRules(
        configData.rules.map((r) => ({
          dayOfWeek: r.dayOfWeek,
          startTime: r.startTime,
          endTime: r.endTime,
        })),
      );
      setHasChanges(false);
    }
  }, [configData]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      // Save config and availability rules together
      const [configRes, rulesRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/booking/config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled,
            timezone,
            slotDuration: String(slotDuration),
            bufferTime,
          }),
        }),
        fetch(`/api/projects/${projectId}/booking/availability`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules }),
        }),
      ]);
      if (!configRes.ok || !rulesRes.ok) throw new Error("Failed to save");
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["booking-config", projectId],
      });
      setHasChanges(false);
    },
  });

  const cancelBooking = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/bookings/${bookingId}`,
        { method: "PATCH" },
      );
      if (!res.ok) throw new Error("Failed to cancel");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings", projectId] });
    },
  });

  function addTimeBlock(dayOfWeek: number) {
    setRules([...rules, { dayOfWeek, startTime: "09:00", endTime: "17:00" }]);
    setHasChanges(true);
  }

  function removeTimeBlock(index: number) {
    setRules(rules.filter((_, i) => i !== index));
    setHasChanges(true);
  }

  function updateTimeBlock(
    index: number,
    field: "startTime" | "endTime",
    value: string,
  ) {
    const updated = [...rules];
    updated[index] = { ...updated[index], [field]: value };
    setRules(updated);
    setHasChanges(true);
  }

  function getRulesForDay(dayOfWeek: number) {
    return rules
      .map((r, idx) => ({ ...r, _index: idx }))
      .filter((r) => r.dayOfWeek === dayOfWeek);
  }

  if (configLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded-xl bg-muted animate-pulse" />
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  const isConfigured =
    configData?.config?.enabled &&
    configData.rules.length > 0;

  const upcomingBookings = (bookings ?? []).filter(
    (b) =>
      b.status === "confirmed" &&
      new Date(b.startTime).getTime() > Date.now(),
  );
  const pastBookings = (bookings ?? []).filter(
    (b) =>
      b.status !== "confirmed" ||
      new Date(b.startTime).getTime() <= Date.now(),
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <CalendarClock className="w-5 h-5" />
            Bookings
          </h2>
          <p className="text-sm text-muted-foreground">
            Meetings booked by visitors through your widget.
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

      {/* Bookings list or empty state */}
      {!isConfigured ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
            <CalendarDays className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            No bookings configured
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">
            Let visitors book meetings directly from your widget. Set up your
            availability and meeting preferences, then add a "Booking" quick
            action on the Actions tab.
          </p>
          <Button onClick={() => setSettingsOpen(true)} className="gap-1.5">
            <Settings className="w-4 h-4" />
            Set up bookings
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-3 mb-1">
            <Badge variant="secondary" className="gap-1">
              <CalendarClock className="w-3 h-3" />
              {upcomingBookings.length} upcoming
            </Badge>
            <Badge variant="outline" className="gap-1">
              {(bookings ?? []).length} total
            </Badge>
          </div>

          {bookingsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 rounded-xl bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : !bookings || bookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Inbox className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                No bookings yet. They'll appear here when visitors book
                meetings.
              </p>
            </div>
          ) : (
            <>
              {upcomingBookings.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Upcoming ({upcomingBookings.length})
                  </h3>
                  {upcomingBookings.map((booking) => (
                    <BookingCard
                      key={booking.id}
                      booking={booking}
                      onCancel={() => cancelBooking.mutate(booking.id)}
                      cancelling={cancelBooking.isPending}
                    />
                  ))}
                </div>
              )}

              {pastBookings.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Past & Cancelled ({pastBookings.length})
                  </h3>
                  {pastBookings.map((booking) => (
                    <BookingCard
                      key={booking.id}
                      booking={booking}
                      past
                    />
                  ))}
                </div>
              )}
            </>
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
              Booking settings
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure your availability and meeting preferences
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
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable bookings</Label>
              <p className="text-xs text-muted-foreground">
                Enables the booking feature for your widget
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
              {/* Timezone */}
              <div className="space-y-2">
                <Label>Your timezone</Label>
                <Select
                  value={timezone}
                  onValueChange={(val) => {
                    setTimezone(val);
                    setHasChanges(true);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Meeting duration */}
              <div className="space-y-2">
                <Label>Meeting duration</Label>
                <div className="flex gap-2">
                  {[15, 30, 60].map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        setSlotDuration(d);
                        setHasChanges(true);
                      }}
                      className={cn(
                        "flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors",
                        slotDuration === d
                          ? "border-primary bg-primary/8 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {d} min
                    </button>
                  ))}
                </div>
              </div>

              {/* Buffer time */}
              <div className="space-y-2">
                <Label>Buffer between meetings</Label>
                <p className="text-xs text-muted-foreground">
                  Extra time between consecutive bookings
                </p>
                <Select
                  value={String(bufferTime)}
                  onValueChange={(val) => {
                    setBufferTime(parseInt(val));
                    setHasChanges(true);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">No buffer</SelectItem>
                    <SelectItem value="5">5 minutes</SelectItem>
                    <SelectItem value="10">10 minutes</SelectItem>
                    <SelectItem value="15">15 minutes</SelectItem>
                    <SelectItem value="30">30 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Weekly availability */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-semibold">
                    Weekly availability
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Set your available hours. Times are in{" "}
                    <span className="font-medium">
                      {timezone.replace(/_/g, " ")}
                    </span>
                    .
                  </p>
                </div>

                <div className="space-y-2">
                  {[1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => {
                    const dayRules = getRulesForDay(dayOfWeek);
                    return (
                      <div
                        key={dayOfWeek}
                        className="flex items-start gap-3 py-2.5 border-b border-border last:border-0"
                      >
                        <div className="w-20 shrink-0 pt-2">
                          <span className="text-sm font-medium text-foreground">
                            {DAY_NAMES[dayOfWeek]}
                          </span>
                        </div>

                        <div className="flex-1 space-y-2">
                          {dayRules.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">
                              Unavailable
                            </p>
                          ) : (
                            dayRules.map((rule) => (
                              <div
                                key={rule._index}
                                className="flex items-center gap-2"
                              >
                                <Input
                                  type="time"
                                  value={rule.startTime}
                                  onChange={(e) =>
                                    updateTimeBlock(
                                      rule._index,
                                      "startTime",
                                      e.target.value,
                                    )
                                  }
                                  className="w-28"
                                />
                                <span className="text-muted-foreground text-xs">
                                  to
                                </span>
                                <Input
                                  type="time"
                                  value={rule.endTime}
                                  onChange={(e) =>
                                    updateTimeBlock(
                                      rule._index,
                                      "endTime",
                                      e.target.value,
                                    )
                                  }
                                  className="w-28"
                                />
                                <button
                                  onClick={() => removeTimeBlock(rule._index)}
                                  className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))
                          )}

                          {dayRules.length < 4 && (
                            <button
                              onClick={() => addTimeBlock(dayOfWeek)}
                              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors py-1"
                            >
                              <Plus className="w-3 h-3" />
                              Add time block
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Drawer footer with single save button */}
        <div className="px-6 py-4 border-t border-border flex items-center gap-3">
          <Button
            onClick={() => saveSettings.mutate()}
            disabled={!hasChanges || saveSettings.isPending}
            className="flex-1"
          >
            {saveSettings.isPending ? "Saving..." : "Save changes"}
          </Button>
          {saveSettings.isError && (
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

// ─── Booking Card Component ───────────────────────────────────────────────────

function BookingCard({
  booking,
  onCancel,
  cancelling,
  past,
}: {
  booking: Booking;
  onCancel?: () => void;
  cancelling?: boolean;
  past?: boolean;
}) {
  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);

  const dateStr = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = `${start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })} - ${end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })}`;

  return (
    <div
      className={cn(
        "px-5 py-4 bg-card rounded-xl border border-border",
        past && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CalendarClock className="w-4 h-4 text-primary" />
              {dateStr}
            </div>
            <span className="text-sm text-muted-foreground">{timeStr}</span>
            <Badge
              variant={booking.status === "confirmed" ? "default" : "secondary"}
              className="text-[11px]"
            >
              {booking.status}
            </Badge>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              {booking.visitorName}
            </span>
            <span className="flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" />
              {booking.visitorEmail}
            </span>
            {booking.visitorPhone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" />
                {booking.visitorPhone}
              </span>
            )}
          </div>

          {booking.notes && (
            <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="line-clamp-2">{booking.notes}</span>
            </div>
          )}
        </div>

        {!past && booking.status === "confirmed" && onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={cancelling}
            className="text-muted-foreground hover:text-destructive shrink-0"
          >
            <XCircle className="w-4 h-4 mr-1" />
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export default QuickActions;
