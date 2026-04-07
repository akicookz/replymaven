import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  AlertCircle,
  Wrench,
  Pencil,
  Play,
  ChevronDown,
  ChevronRight,
  X,
  Loader2,
  History,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { MobileMenuButton } from "@/components/PageHeader";

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
}

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
};

// ─── Telegram Preset Types ────────────────────────────────────────────────────

interface TelegramData {
  telegramBotToken: string | null;
  telegramChatId: string | null;
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
  const [showLogs, setShowLogs] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ToolFormData>(emptyForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testParams, setTestParams] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ success: boolean; data: unknown } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Telegram preset state
  const [telegramExpanded, setTelegramExpanded] = useState(false);
  const [telegramEditing, setTelegramEditing] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramSaveStatus, setTelegramSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [telegramTestResult, setTelegramTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [detectingChatId, setDetectingChatId] = useState(false);
  const [detectedChats, setDetectedChats] = useState<Array<{ id: string; type: string; title: string }> | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);

  // ─── Queries ──────────────────────────────────────────────────────────────

  const {
    data: tools,
    isLoading,
    isError,
  } = useQuery<Tool[]>({
    queryKey: ["tools", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/tools`);
      if (!res.ok) throw new Error("Failed to fetch tools");
      return res.json();
    },
  });

  const { data: executions, isLoading: executionsLoading } = useQuery<ToolExecution[]>({
    queryKey: ["tool-executions", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/tool-executions`);
      if (!res.ok) throw new Error("Failed to fetch executions");
      return res.json();
    },
    enabled: showLogs,
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
        const err = await res.json().catch(() => ({ error: "Failed to create tool" }));
        throw new Error((err as { error?: string }).error ?? "Failed to create tool");
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
        const err = await res.json().catch(() => ({ error: "Failed to update tool" }));
        throw new Error((err as { error?: string }).error ?? "Failed to update tool");
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
      if (!res.ok) throw new Error("Failed to delete tool");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools", projectId] });
      if (expandedId) setExpandedId(null);
    },
  });

  const toggleTool = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await fetch(`/api/projects/${projectId}/tools/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle tool");
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
      setTelegramEditing(false);
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
  }

  function startEdit(tool: Tool) {
    setEditingId(tool.id);
    setForm({
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      endpoint: tool.endpoint,
      method: tool.method,
      headers: tool.headers
        ? Object.entries(tool.headers).map(([key, value]) => ({ key, value }))
        : [],
      parameters: tool.parameters,
      responseMapping: tool.responseMapping ?? { resultPath: "", summaryTemplate: "" },
      enabled: tool.enabled,
      timeout: tool.timeout,
    });
    setFormError(null);
    setShowForm(true);
    setExpandedId(null);
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (editingId) {
      updateTool.mutate({ id: editingId, data: form });
    } else {
      createTool.mutate(form);
    }
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

  function addHeader() {
    setForm((prev) => ({
      ...prev,
      headers: [...prev.headers, { key: "", value: "" }],
    }));
  }

  function updateHeader(index: number, field: "key" | "value", value: string) {
    setForm((prev) => ({
      ...prev,
      headers: prev.headers.map((h, i) => (i === index ? { ...h, [field]: value } : h)),
    }));
  }

  function removeHeader(index: number) {
    setForm((prev) => ({
      ...prev,
      headers: prev.headers.filter((_, i) => i !== index),
    }));
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <MobileMenuButton />
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-foreground">
                Tools
              </h1>
              <p className="text-xs md:text-sm text-muted-foreground mt-1">
                Configure external API tools your bot can call during
                conversations.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {showLogs ? "Execution Log" : "Tools"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {showLogs
              ? "Review recent tool calls and responses."
              : "Configure external API tools your bot can call during conversations."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showLogs ? (
            <Button
              variant="outline"
              onClick={() => setShowLogs(false)}
            >
              <ChevronRight className="w-4 h-4 mr-2 rotate-180" />
              Back to Tools
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setShowLogs(true)}
              >
                <History className="w-4 h-4 mr-2" />
                View Logs
              </Button>
            </>
          )}
          {!showLogs && (
          <Button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            disabled={(tools?.length ?? 0) >= 20}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Tool
          </Button>
          )}
        </div>
      </div>

      {/* Tool limit warning */}
      {!showLogs && (tools?.length ?? 0) >= 20 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-warning/10 border border-warning/25 text-warning text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Maximum of 20 tools reached. Delete an existing tool to add a new one.
        </div>
      )}

      {/* ─── Create / Edit Form ──────────────────────────────────────────── */}
      {!showLogs && showForm && (
        <div className="bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-border p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              {editingId ? "Edit Tool" : "New Tool"}
            </h2>
            <button onClick={resetForm} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {formError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Basic Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Machine Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="check_order_status"
                  required
                  disabled={!!editingId}
                  className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase letters, numbers, underscores. Cannot be changed after creation.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Display Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder="Check Order Status"
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Description <span className="text-destructive">*</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Looks up the current status of a customer order by order ID. Returns tracking info and estimated delivery."
                required
                rows={2}
                className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                The AI uses this to decide when to call this tool. Be specific about what it does and when to use it.
              </p>
            </div>

            {/* HTTP Config */}
            <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold text-foreground">HTTP Configuration</h3>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Endpoint</label>
                <div className="flex gap-2">
                  <div className="shrink-0">
                    <div className="flex h-[42px] rounded-xl border border-input bg-background overflow-hidden">
                      {(["POST", "GET"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, method: m }))}
                          className={cn(
                            "px-4 text-sm font-medium transition-colors",
                            form.method === m
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="url"
                    value={form.endpoint}
                    onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
                    placeholder="https://api.example.com/orders/status"
                    required
                    className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Timeout</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    value={form.timeout}
                    onChange={(e) => setForm((f) => ({ ...f, timeout: Number(e.target.value) }))}
                    min={1000}
                    max={30000}
                    step={1000}
                    className="flex-1 accent-primary h-1.5 cursor-pointer"
                  />
                  <span className="text-sm tabular-nums text-muted-foreground w-14 text-right">{(form.timeout / 1000).toFixed(0)}s</span>
                </div>
              </div>
            </div>

            {/* Headers */}
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Headers</h3>
                <Button type="button" variant="ghost" size="sm" onClick={addHeader} className="h-7 text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add
                </Button>
              </div>
              {form.headers.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">No custom headers. Add authentication or other headers above.</p>
              )}
              <div className="space-y-2">
                {form.headers.map((header, i) => (
                  <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <input
                      type="text"
                      value={header.key}
                      onChange={(e) => updateHeader(i, "key", e.target.value)}
                      placeholder="Header name"
                      className="w-full sm:w-[180px] shrink-0 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono text-xs"
                    />
                    <input
                      type="text"
                      value={header.value}
                      onChange={(e) => updateHeader(i, "value", e.target.value)}
                      placeholder="Value"
                      className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() => removeHeader(i)}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Parameters */}
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
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
              {form.parameters.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">
                  No parameters. The AI will call this tool without any input data.
                </p>
              )}
              <div className="space-y-2">
                {form.parameters.map((param, i) => (
                  <div key={i} className="rounded-lg border border-border bg-background p-3 space-y-2">
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                      <input
                        type="text"
                        value={param.name}
                        onChange={(e) => updateParameter(i, { name: e.target.value })}
                        placeholder="parameter_name"
                        className="flex-1 px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono text-xs"
                      />
                      <div className="flex h-[34px] rounded-lg border border-input bg-background overflow-hidden shrink-0">
                        {(["string", "number", "boolean"] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => updateParameter(i, { type: t })}
                            className={cn(
                              "px-2.5 text-xs font-medium transition-colors capitalize",
                              param.type === t
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            )}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                        <Switch
                          checked={param.required}
                          onCheckedChange={(checked) => updateParameter(i, { required: checked })}
                          size="sm"
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
                    <input
                      type="text"
                      value={param.description}
                      onChange={(e) => updateParameter(i, { description: e.target.value })}
                      placeholder="Description — helps the AI understand what to provide"
                      className="w-full px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring text-muted-foreground"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Response Mapping */}
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Response Mapping</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Optional. Configure how the API response is processed.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Result JSON Path</label>
                  <input
                    type="text"
                    value={form.responseMapping.resultPath ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        responseMapping: { ...f.responseMapping, resultPath: e.target.value },
                      }))
                    }
                    placeholder="data.result"
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">Dot-notation path to extract from the response.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Summary Template</label>
                  <input
                    type="text"
                    value={form.responseMapping.summaryTemplate ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        responseMapping: { ...f.responseMapping, summaryTemplate: e.target.value },
                      }))
                    }
                    placeholder="Order {{order_id}} is {{status}}"
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">Template for the AI to summarize the result.</p>
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={createTool.isPending || updateTool.isPending}>
                {(createTool.isPending || updateTool.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editingId ? "Update Tool" : "Create Tool"}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ─── Tools Tab ───────────────────────────────────────────────────── */}
      {!showLogs && (
        <>
          {/* Loading */}
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Failed to load tools. Please try refreshing the page.
            </div>
          )}

          {/* Tool List */}
          {!isLoading && !isError && (
            <div className="space-y-2">
              {/* ─── Telegram Preset Tool ──────────────────────────────────── */}
              <div
                className={cn(
                  "bg-white/[0.04] backdrop-blur-xl rounded-xl border overflow-hidden",
                  telegramConfigured ? "border-border" : "border-dashed border-border",
                )}
              >
                {/* Telegram Row */}
                <div
                  className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => {
                    if (!telegramConfigured && !telegramEditing) {
                      setTelegramEditing(true);
                      setTelegramExpanded(true);
                    } else {
                      setTelegramExpanded(!telegramExpanded);
                    }
                  }}
                >
                  <div className="flex items-center gap-2 shrink-0">
                    {telegramExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center",
                      telegramConfigured ? "bg-[#229ED9]/15" : "bg-muted",
                    )}>
                      <Send className={cn(
                        "w-4 h-4",
                        telegramConfigured ? "text-[#229ED9]" : "text-muted-foreground",
                      )} />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">
                        Telegram Handoff
                      </p>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        Preset
                      </Badge>
                      {!telegramConfigured && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-warning border-warning/30">
                          Not configured
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {telegramConfigured
                        ? "Live agent handoff via Telegram when the bot cannot answer"
                        : "Set up Telegram to receive live handoff notifications"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 sm:gap-3 shrink-0">
                    {telegramConfigured && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTelegramEditing(true);
                            setTelegramExpanded(true);
                          }}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTelegramTesting(true);
                            setTelegramExpanded(true);
                            setTelegramTestResult(null);
                          }}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                          title="Test"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Telegram Expanded Details (configured, not editing) */}
                {telegramExpanded && telegramConfigured && !telegramEditing && !telegramTesting && (
                  <div className="border-t border-border px-4 py-4 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Bot Token</p>
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {telegramData?.telegramBotToken ?? "Not set"}
                        </code>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Chat ID</p>
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {telegramData?.telegramChatId ?? "Not set"}
                        </code>
                      </div>
                    </div>
                    {telegramSaveStatus === "success" && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 text-success text-sm">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        Settings saved successfully.
                      </div>
                    )}
                  </div>
                )}

                {/* Telegram Edit Form */}
                {telegramExpanded && telegramEditing && (
                  <div className="border-t border-border px-4 py-4 space-y-4 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-foreground">
                        {telegramConfigured ? "Edit Telegram Configuration" : "Set Up Telegram Handoff"}
                      </h4>
                      <button
                        onClick={() => {
                          setTelegramEditing(false);
                          if (!telegramConfigured) setTelegramExpanded(false);
                          setTelegramBotToken("");
                          setTelegramChatId("");
                        }}
                        className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      When the bot cannot answer a question or the visitor requests a human, the conversation will be forwarded to your Telegram.
                    </p>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Bot Token <span className="text-destructive">*</span>
                        </label>
                        <input
                          type="password"
                          value={telegramBotToken}
                          onChange={(e) => setTelegramBotToken(e.target.value)}
                          placeholder={telegramConfigured ? "Enter new token to update" : "Paste your bot token from @BotFather"}
                          className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <Accordion type="single" collapsible>
                          <AccordionItem value="bot-token-help" className="border-0">
                            <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:text-foreground hover:no-underline">
                              How do I get a bot token?
                            </AccordionTrigger>
                            <AccordionContent className="text-xs text-muted-foreground pb-1">
                              <ol className="list-decimal list-inside space-y-1">
                                <li>Open Telegram and search for <strong className="text-foreground">@BotFather</strong></li>
                                <li>Send <code className="bg-muted px-1 rounded">/newbot</code> and follow the prompts to name your bot</li>
                                <li>BotFather will reply with a token like <code className="bg-muted px-1 rounded">123456:ABC-DEF...</code> — copy it</li>
                                <li>Paste it in the field above</li>
                              </ol>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Chat ID <span className="text-destructive">*</span>
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={telegramChatId}
                            onChange={(e) => { setTelegramChatId(e.target.value); setDetectedChats(null); setDetectError(null); }}
                            placeholder={telegramData?.telegramChatId ?? "Your Telegram chat or group ID"}
                            className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!telegramBotToken || detectingChatId}
                            onClick={async () => {
                              setDetectingChatId(true);
                              setDetectError(null);
                              setDetectedChats(null);
                              try {
                                const res = await fetch("/api/telegram/detect-chat-id", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ botToken: telegramBotToken }),
                                });
                                const data = await res.json() as { chats?: Array<{ id: string; type: string; title: string }>; error?: string };
                                if (!res.ok) {
                                  setDetectError(data.error ?? "Detection failed");
                                } else if (!data.chats?.length) {
                                  setDetectError("No chats found. Send /start to your bot first, then try again.");
                                } else if (data.chats.length === 1) {
                                  setTelegramChatId(data.chats[0].id);
                                  setDetectedChats(null);
                                } else {
                                  setDetectedChats(data.chats);
                                }
                              } catch {
                                setDetectError("Failed to connect");
                              } finally {
                                setDetectingChatId(false);
                              }
                            }}
                            className="shrink-0"
                          >
                            {detectingChatId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Detect"}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Send <code className="bg-muted px-1 rounded">/start</code> to your bot in Telegram (or add it to a group and send a message), then click <strong>Detect</strong>.
                        </p>
                        {detectError && (
                          <p className="text-xs text-destructive">{detectError}</p>
                        )}
                        {detectedChats && detectedChats.length > 1 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">Multiple chats found — pick one:</p>
                            <div className="space-y-1">
                              {detectedChats.map((chat) => (
                                <button
                                  key={chat.id}
                                  type="button"
                                  onClick={() => { setTelegramChatId(chat.id); setDetectedChats(null); }}
                                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/60 text-sm transition-colors"
                                >
                                  <span className="text-foreground">{chat.title}</span>
                                  <span className="text-xs text-muted-foreground">{chat.type} · {chat.id}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    {telegramSaveStatus === "error" && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        Failed to save Telegram settings.
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => saveTelegram.mutate()}
                        disabled={saveTelegram.isPending || (!telegramBotToken && !telegramChatId)}
                      >
                        {saveTelegram.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                        {telegramConfigured ? "Update" : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTelegramEditing(false);
                          if (!telegramConfigured) setTelegramExpanded(false);
                          setTelegramBotToken("");
                          setTelegramChatId("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Telegram Test Panel */}
                {telegramExpanded && telegramTesting && telegramConfigured && (
                  <div className="border-t border-border px-4 py-4 space-y-3 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-foreground">Test Connection</h4>
                      <button
                        onClick={() => {
                          setTelegramTesting(false);
                          setTelegramTestResult(null);
                        }}
                        className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Send a test message to your configured Telegram chat to verify the connection.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => testTelegram.mutate()}
                      disabled={testTelegram.isPending}
                    >
                      {testTelegram.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      Send Test Message
                    </Button>
                    {telegramTestResult && (
                      <div
                        className={cn(
                          "rounded-lg p-3 text-xs max-h-48 overflow-auto",
                          telegramTestResult.success
                            ? "bg-success/10 border border-success/25 text-success"
                            : "bg-destructive/10 border border-destructive/25 text-destructive",
                        )}
                      >
                        {telegramTestResult.message}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ─── Custom Tools ──────────────────────────────────────────── */}
              {tools?.map((tool) => (
                <div
                  key={tool.id}
                  className="bg-white/[0.04] backdrop-blur-xl rounded-xl border border-border overflow-hidden"
                >
                  {/* Tool Row */}
                  <div
                    className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedId(expandedId === tool.id ? null : tool.id)}
                  >
                    <div className="flex items-center gap-2 shrink-0">
                      {expandedId === tool.id ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                        <Wrench className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">
                          {tool.displayName}
                        </p>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {tool.method}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{tool.description}</p>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-3 shrink-0">
                      <Switch
                        checked={tool.enabled}
                        onCheckedChange={(checked) => {
                          toggleTool.mutate({ id: tool.id, enabled: checked });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        size="sm"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(tool);
                        }}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startTest(tool);
                        }}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                        title="Test"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTool.mutate(tool.id);
                        }}
                        disabled={deleteTool.isPending}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedId === tool.id && (
                    <div className="border-t border-border px-4 py-4 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Machine Name</p>
                          <code className="text-xs bg-muted px-2 py-1 rounded">{tool.name}</code>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Endpoint</p>
                          <p className="text-xs text-foreground truncate">{tool.endpoint}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Timeout</p>
                          <p className="text-xs text-foreground">{tool.timeout}ms</p>
                        </div>
                      </div>

                      {tool.parameters.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">Parameters</p>
                          <div className="space-y-1">
                            {tool.parameters.map((param, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <code className="bg-muted px-1.5 py-0.5 rounded">{param.name}</code>
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{param.type}</Badge>
                                {param.required && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">required</Badge>
                                )}
                                {param.description && (
                                  <span className="text-muted-foreground">{param.description}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {tool.responseMapping && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Response Mapping</p>
                          <div className="text-xs space-y-0.5">
                            {tool.responseMapping.resultPath && (
                              <p><span className="text-muted-foreground">Path:</span> <code className="bg-muted px-1 rounded">{tool.responseMapping.resultPath}</code></p>
                            )}
                            {tool.responseMapping.summaryTemplate && (
                              <p><span className="text-muted-foreground">Template:</span> {tool.responseMapping.summaryTemplate}</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Test Panel */}
                  {testingId === tool.id && (
                    <div className="border-t border-border px-4 py-4 space-y-3 bg-muted/20">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-foreground">Test Tool</h4>
                        <button
                          onClick={() => {
                            setTestingId(null);
                            setTestResult(null);
                          }}
                          className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {tool.parameters.length > 0 ? (
                        <div className="space-y-2">
                          {tool.parameters.map((param) => (
                            <div key={param.name} className="flex flex-col sm:flex-row sm:items-center gap-2">
                              <label className="text-xs font-medium text-muted-foreground w-full sm:w-28 shrink-0">
                                {param.name}
                                {param.required && <span className="text-destructive ml-0.5">*</span>}
                              </label>
                              <input
                                type="text"
                                value={testParams[param.name] ?? ""}
                                onChange={(e) =>
                                  setTestParams((prev) => ({ ...prev, [param.name]: e.target.value }))
                                }
                                placeholder={`${param.type}${param.description ? ` — ${param.description}` : ""}`}
                                className="flex-1 px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">This tool takes no parameters.</p>
                      )}
                      <Button
                        size="sm"
                        onClick={() => {
                          const parsed: Record<string, unknown> = {};
                          for (const param of tool.parameters) {
                            const val = testParams[param.name] ?? "";
                            if (param.type === "number") parsed[param.name] = Number(val);
                            else if (param.type === "boolean") parsed[param.name] = val === "true";
                            else parsed[param.name] = val;
                          }
                          testTool.mutate({ id: tool.id, params: parsed });
                        }}
                        disabled={testTool.isPending}
                      >
                        {testTool.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        Run Test
                      </Button>
                      {testResult && (
                        <div
                          className={cn(
                            "rounded-lg p-3 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-auto",
                            testResult.success
                              ? "bg-success/10 border border-success/25 text-success"
                              : "bg-destructive/10 border border-destructive/25 text-destructive",
                          )}
                        >
                          {typeof testResult.data === "string"
                            ? testResult.data
                            : JSON.stringify(testResult.data, null, 2)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {(!tools || tools.length === 0) && (
                <div className="text-center py-12">
                  <Wrench className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No tools configured yet. Add external API tools for your bot to call during conversations.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── Execution Log Tab ───────────────────────────────────────────── */}
      {showLogs && (
        <>
          {executionsLoading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {!executionsLoading && (
            <div className="space-y-2">
              {executions && executions.length > 0 ? (
                executions.map((exec) => {
                  const tool = tools?.find((t) => t.id === exec.toolId);
                  const isLogExpanded = expandedLogId === exec.id;
                  const StatusIcon =
                    exec.status === "success"
                      ? CheckCircle2
                      : exec.status === "timeout"
                        ? Clock
                        : XCircle;
                  const statusColor =
                    exec.status === "success"
                      ? "text-success"
                      : exec.status === "timeout"
                        ? "text-warning"
                        : "text-destructive";

                  let parsedInput: Record<string, unknown> | null = null;
                  let parsedOutput: Record<string, unknown> | null = null;
                  if (isLogExpanded) {
                    try {
                      parsedInput = exec.input ? JSON.parse(exec.input) : null;
                    } catch { parsedInput = null; }
                    try {
                      parsedOutput = exec.output ? JSON.parse(exec.output) : null;
                    } catch { parsedOutput = null; }
                  }

                  return (
                    <div
                      key={exec.id}
                      className="bg-white/[0.04] backdrop-blur-xl rounded-xl border border-border overflow-hidden"
                    >
                      {/* Summary row */}
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedLogId(isLogExpanded ? null : exec.id)
                        }
                        className="w-full px-4 py-3 flex items-center gap-4 hover:bg-white/[0.02] transition-colors"
                      >
                        <StatusIcon className={cn("w-4 h-4 shrink-0", statusColor)} />
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-medium text-foreground truncate">
                            {tool?.displayName ?? exec.toolId}
                          </p>
                          {exec.errorMessage && (
                            <p className="text-xs text-destructive truncate">{exec.errorMessage}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 sm:gap-4 shrink-0 text-xs text-muted-foreground flex-wrap">
                          {exec.httpStatus && (
                            <span>HTTP {exec.httpStatus}</span>
                          )}
                          {exec.duration != null && (
                            <span>{exec.duration}ms</span>
                          )}
                          <span>
                            {new Date(exec.createdAt).toLocaleString()}
                          </span>
                          {isLogExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                      </button>

                      {/* Expanded details */}
                      {isLogExpanded && (
                        <div className="border-t border-border/50 px-4 py-3 space-y-3">
                          {/* Input */}
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
                              Input Parameters
                            </p>
                            {parsedInput && Object.keys(parsedInput).length > 0 ? (
                              <pre className="bg-black/20 rounded-lg p-3 text-xs text-muted-foreground font-mono overflow-x-auto max-h-48 overflow-y-auto">
                                {JSON.stringify(parsedInput, null, 2)}
                              </pre>
                            ) : (
                              <p className="text-xs text-muted-foreground/50 italic">
                                No input parameters
                              </p>
                            )}
                          </div>

                          {/* Output */}
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
                              Output
                            </p>
                            {parsedOutput ? (
                              <pre className="bg-black/20 rounded-lg p-3 text-xs text-muted-foreground font-mono overflow-x-auto max-h-48 overflow-y-auto">
                                {JSON.stringify(parsedOutput, null, 2)}
                              </pre>
                            ) : exec.output ? (
                              <pre className="bg-black/20 rounded-lg p-3 text-xs text-muted-foreground font-mono overflow-x-auto max-h-48 overflow-y-auto">
                                {exec.output}
                              </pre>
                            ) : (
                              <p className="text-xs text-muted-foreground/50 italic">
                                No output data
                              </p>
                            )}
                          </div>

                          {/* Error message (if present and not already shown) */}
                          {exec.errorMessage && (
                            <div>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
                                Error
                              </p>
                              <div className="bg-destructive/10 rounded-lg p-3 text-xs text-destructive">
                                {exec.errorMessage}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-12">
                  <History className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No tool executions yet. Executions will appear here once your bot starts calling tools.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
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
