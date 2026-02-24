import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  Plus,
  Trash2,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  Settings,
  X,
  Clock,
  Inbox,
  MessageSquareText,
  Type,
  AlignLeft,
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

function ContactForm() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  // Settings panel state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Form config state
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
      <div className="space-y-4 max-w-4xl mx-auto">
        <div className="h-8 w-48 rounded-xl bg-muted animate-pulse" />
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Mail className="w-6 h-6" />
            Contact Form
          </h1>
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

      {/* ─── Main Content: Submissions or Empty State ──────────────────── */}
      {!isConfigured ? (
        // Empty state -- form not set up yet
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
            <MessageSquareText className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            No contact form configured
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">
            Let visitors leave a message when you're away. Set up a form with
            custom fields like name, email, and message. It shows as a "Leave a
            message" button on your widget's home screen.
          </p>
          <Button onClick={() => setSettingsOpen(true)} className="gap-1.5">
            <Settings className="w-4 h-4" />
            Set up form
          </Button>
        </div>
      ) : (
        // Submissions list
        <div className="space-y-3">
          {/* Stats bar */}
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

      {/* ─── Settings Slide-over Panel ─────────────────────────────────── */}
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-black/40 z-40 transition-opacity",
          settingsOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        onClick={() => setSettingsOpen(false)}
      />

      {/* Panel */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-full max-w-lg bg-background border-l border-border z-50 flex flex-col transition-transform duration-300 ease-in-out",
          settingsOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Panel header */}
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

        {/* Panel body (scrollable) */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable contact form</Label>
              <p className="text-xs text-muted-foreground">
                Adds a "Leave a message" button to your widget
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
              {/* Description */}
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

              {/* Fields */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Form fields</Label>
                  <span className="text-xs text-muted-foreground">
                    {fields.length}/10
                  </span>
                </div>

                {/* Field list */}
                {fields.length > 0 && (
                  <div className="space-y-1.5">
                    {fields.map((field, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg group"
                      >
                        {/* Reorder arrows */}
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

                        {/* Icon */}
                        <div className="w-7 h-7 rounded-md bg-background border border-border flex items-center justify-center shrink-0">
                          {field.type === "textarea" ? (
                            <AlignLeft className="w-3.5 h-3.5 text-muted-foreground" />
                          ) : (
                            <Type className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </div>

                        {/* Label + meta */}
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

                        {/* Delete */}
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

                {/* Add field */}
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

        {/* Panel footer */}
        <div className="px-6 py-4 border-t border-border flex items-center gap-3">
          <Button
            onClick={() => {
              saveConfig.mutate();
            }}
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

export default ContactForm;
