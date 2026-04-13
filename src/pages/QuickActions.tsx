import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
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
  Type,
  AlignLeft,
  FileText,
  Mail,
  Calendar,
  Bell,
  Folder,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

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
import { ToolsPanel } from "./Tools";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const searchTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<"actions" | "tools">(
    searchTab === "tools" ? "tools" : "actions",
  );

  useEffect(() => {
    setActiveTab(searchTab === "tools" ? "tools" : "actions");
  }, [searchTab]);

  function handleTabChange(tab: "actions" | "tools") {
    setActiveTab(tab);
    if (tab === "tools") {
      setSearchParams({ tab: "tools" }, { replace: true });
      return;
    }

    setSearchParams({}, { replace: true });
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 md:w-6 md:h-6" />
            Quick Actions and Tools
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Manage widget shortcuts, inquiry behavior, and bot tools from one
            place.
          </p>
        </div>
      </div>

      {/* Segment Control */}
      <div className="inline-flex rounded-lg bg-muted p-1 mb-6">
        {(
          [
            { key: "actions", label: "Actions" },
            { key: "tools", label: "Tools" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              activeTab === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={activeTab !== "actions" ? "hidden" : ""}>
        <ActionsTab projectId={projectId!} queryClient={queryClient} />
      </div>
      <div className={activeTab !== "tools" ? "hidden" : ""}>
        <ToolsPanel projectId={projectId!} embedded />
      </div>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    label: string;
    action: string;
    icon: string;
    showOnHome: boolean;
    inquiryEnabled: boolean;
    inquiryDescription: string;
    inquiryFields: InquiryField[];
  }>({
    label: "",
    action: "",
    icon: "link",
    showOnHome: false,
    inquiryEnabled: false,
    inquiryDescription: "We'll get back to you within 1-2 hours.",
    inquiryFields: [],
  });
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "textarea">("text");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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

  const { data: inquiryConfig } = useQuery<InquiryConfig>({
    queryKey: ["inquiry-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/inquiries`);
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

  function expandAction(action: QuickAction) {
    if (expandedId === action.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(action.id);
    setEditForm({
      label: action.label,
      action: action.action,
      icon: action.icon,
      showOnHome: action.showOnHome,
      inquiryEnabled: inquiryConfig?.enabled ?? false,
      inquiryDescription: inquiryConfig?.description ?? "We'll get back to you within 1-2 hours.",
      inquiryFields: inquiryConfig?.fields ?? [],
    });
    setNewFieldLabel("");
    setNewFieldType("text");
    setNewFieldRequired(false);
  }

  async function handleSave(action: QuickAction) {
    setIsSaving(true);
    try {
      const promises: Promise<Response>[] = [
        fetch(`/api/projects/${projectId}/quick-actions/${action.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: editForm.label.trim(),
            action: editForm.action.trim(),
            icon: editForm.icon,
            showOnHome: editForm.showOnHome,
          }),
        }),
      ];
      if (action.type === "inquiry") {
        promises.push(
          fetch(`/api/projects/${projectId}/inquiries`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              enabled: editForm.inquiryEnabled,
              description: editForm.inquiryDescription,
              fields: editForm.inquiryFields,
            }),
          }),
        );
      }
      const results = await Promise.all(promises);
      if (results.some((r) => !r.ok)) throw new Error("Failed to save");
      queryClient.invalidateQueries({ queryKey: ["quick-actions", projectId] });
      queryClient.invalidateQueries({ queryKey: ["inquiry-config", projectId] });
      setExpandedId(null);
    } catch {
      // Keep panel open on error
    } finally {
      setIsSaving(false);
    }
  }

  function addEditField() {
    if (!newFieldLabel.trim()) return;
    if (editForm.inquiryFields.length >= 10) return;
    setEditForm((prev) => ({
      ...prev,
      inquiryFields: [
        ...prev.inquiryFields,
        { label: newFieldLabel.trim(), type: newFieldType, required: newFieldRequired },
      ],
    }));
    setNewFieldLabel("");
    setNewFieldType("text");
    setNewFieldRequired(false);
  }

  function removeEditField(index: number) {
    setEditForm((prev) => ({
      ...prev,
      inquiryFields: prev.inquiryFields.filter((_, i) => i !== index),
    }));
  }

  function moveEditField(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    setEditForm((prev) => {
      const newFields = [...prev.inquiryFields];
      if (targetIndex < 0 || targetIndex >= newFields.length) return prev;
      [newFields[index], newFields[targetIndex]] = [newFields[targetIndex], newFields[index]];
      return { ...prev, inquiryFields: newFields };
    });
  }

  return (
    <div className="space-y-6">
      {/* Add Action Form */}
      <div className="bg-card rounded-2xl p-5 space-y-4">
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

            <div className="flex flex-wrap gap-1.5">
              {ICON_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setNewIcon(opt.value)}
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                    newIcon === opt.value
                      ? "bg-brand text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                  title={opt.label}
                >
                  <opt.Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
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
              <Switch
                id="show-on-home"
                checked={newShowOnHome}
                onCheckedChange={(checked) => setNewShowOnHome(checked)}
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
            const isExpanded = expandedId === action.id;
            return (
              <div
                key={action.id}
                className="bg-card rounded-xl overflow-hidden group"
              >
                {/* Collapsed Row */}
                <div
                  className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => expandAction(action)}
                >
                  {/* Chevron + Icon */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                      <IconComp className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>

                  {/* Label + type badge + action text */}
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

                  {/* Right-side: toggle + delete */}
                  <div className="flex items-center gap-1 sm:gap-3 shrink-0">
                    <Switch
                      checked={action.showOnHome}
                      onCheckedChange={(checked) => {
                        toggleHome.mutate({ id: action.id, showOnHome: checked });
                      }}
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAction.mutate(action.id);
                      }}
                      disabled={deleteAction.isPending}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded Edit Panel */}
                {isExpanded && (
                  <div className="px-4 py-4 space-y-4">
                    {/* Label */}
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Label</Label>
                      <Input
                        value={editForm.label}
                        onChange={(e) =>
                          setEditForm((prev) => ({ ...prev, label: e.target.value }))
                        }
                        placeholder="Button label"
                      />
                    </div>

                    {/* Action/URL/Prompt (hidden for inquiry) */}
                    {action.type !== "inquiry" && (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">
                          {action.type === "link" ? "URL" : "Prompt"}
                        </Label>
                        <Input
                          value={editForm.action}
                          onChange={(e) =>
                            setEditForm((prev) => ({ ...prev, action: e.target.value }))
                          }
                          placeholder={
                            action.type === "link"
                              ? "https://example.com"
                              : "Pre-filled message for the AI"
                          }
                        />
                      </div>
                    )}

                    {/* Icon picker grid */}
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Icon</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {ICON_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              setEditForm((prev) => ({ ...prev, icon: opt.value }))
                            }
                            className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                              editForm.icon === opt.value
                                ? "bg-brand text-white"
                                : "bg-muted text-muted-foreground hover:bg-muted/80",
                            )}
                            title={opt.label}
                          >
                            <opt.Icon className="w-4 h-4" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Show on home */}
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={editForm.showOnHome}
                        onCheckedChange={(checked) =>
                          setEditForm((prev) => ({ ...prev, showOnHome: checked }))
                        }
                      />
                      <Label className="text-sm text-muted-foreground font-normal">
                        Show on home screen
                      </Label>
                    </div>

                    {/* ─── Inquiry Form Config (only for inquiry type) ─── */}
                    {action.type === "inquiry" && (
                      <>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
                          <div>
                            <p className="text-sm font-semibold text-foreground">Inquiry form</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Configure the form visitors see when they tap this action.
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge variant={editForm.inquiryEnabled ? "secondary" : "outline"}>
                              {editForm.inquiryEnabled ? "Enabled" : "Disabled"}
                            </Badge>
                            <Switch
                              checked={editForm.inquiryEnabled}
                              onCheckedChange={(checked) =>
                                setEditForm((prev) => ({ ...prev, inquiryEnabled: checked }))
                              }
                            />
                          </div>
                        </div>

                        {editForm.inquiryEnabled && (
                          <>
                            {/* Form description */}
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">Form description</Label>
                              <textarea
                                value={editForm.inquiryDescription}
                                onChange={(e) =>
                                  setEditForm((prev) => ({ ...prev, inquiryDescription: e.target.value }))
                                }
                                placeholder="We'll get back to you within 1-2 hours."
                                rows={2}
                                className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                              />
                            </div>

                            {/* Fields list */}
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs text-muted-foreground">Form fields</Label>
                                <span className="text-xs text-muted-foreground">
                                  {editForm.inquiryFields.length}/10
                                </span>
                              </div>

                              {editForm.inquiryFields.length > 0 && (
                                <div className="space-y-1.5">
                                  {editForm.inquiryFields.map((field, index) => (
                                    <div
                                      key={index}
                                      className="flex items-center gap-2 px-3 py-2 bg-background rounded-lg group/field"
                                    >
                                      <div className="flex flex-col -space-y-1">
                                        <button
                                          type="button"
                                          onClick={() => moveEditField(index, "up")}
                                          disabled={index === 0}
                                          className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                                        >
                                          <ChevronUp className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => moveEditField(index, "down")}
                                          disabled={index === editForm.inquiryFields.length - 1}
                                          className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                                        >
                                          <ChevronDown className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                      <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0">
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
                                          {field.type === "textarea" ? "Multi-line" : "Single-line"}
                                          {field.required && " — Required"}
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => removeEditField(index)}
                                        className="p-1 rounded-md opacity-0 group-hover/field:opacity-100 hover:bg-destructive/10 text-destructive transition-opacity"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {editForm.inquiryFields.length === 0 && (
                                <div className="py-6 text-center border-2 border-dashed border-muted rounded-xl">
                                  <Type className="w-6 h-6 mx-auto text-muted-foreground/40 mb-2" />
                                  <p className="text-xs text-muted-foreground">
                                    No fields yet. Add your first field below.
                                  </p>
                                </div>
                              )}

                              {editForm.inquiryFields.length < 10 && (
                                <div className="space-y-3 p-3 bg-background rounded-xl border-2 border-dashed border-muted">
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <Input
                                      type="text"
                                      value={newFieldLabel}
                                      onChange={(e) => setNewFieldLabel(e.target.value)}
                                      placeholder="Field label (e.g. Email)"
                                      className="flex-1"
                                    />
                                    <Select
                                      value={newFieldType}
                                      onValueChange={(val) =>
                                        setNewFieldType(val as "text" | "textarea")
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
                                      <Switch
                                        checked={newFieldRequired}
                                        onCheckedChange={(checked) => setNewFieldRequired(checked)}
                                      />
                                      <Label className="text-sm text-muted-foreground font-normal cursor-pointer">
                                        Required field
                                      </Label>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={!newFieldLabel.trim()}
                                      onClick={addEditField}
                                      className="gap-1"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      Add
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </>
                    )}

                    {/* Save / Cancel */}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleSave(action)}
                        disabled={isSaving || !editForm.label.trim()}
                      >
                        {isSaving ? "Saving..." : "Save Changes"}
                      </Button>
                    </div>
                  </div>
                )}
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

export default QuickActions;
