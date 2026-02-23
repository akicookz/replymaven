import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Palette, Save, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/color-picker";

interface WidgetConfigData {
  id: string;
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  headerText: string;
  avatarUrl: string | null;
  position: "bottom-right" | "bottom-left";
  borderRadius: number;
  fontFamily: string;
  customCss: string | null;
}

function WidgetConfig() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Partial<WidgetConfigData>>({});

  const { data, isLoading } = useQuery<WidgetConfigData>({
    queryKey: ["widget-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/widget-config`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/widget-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["widget-config", projectId] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Widget Config</h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-80 rounded-2xl bg-muted/50 animate-pulse" />
          <div className="h-80 rounded-2xl bg-muted/50 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Widget Config</h1>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {save.isSuccess && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 text-green-700 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Widget config saved successfully
        </div>
      )}
      {save.isError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to save widget config. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Config Form */}
        <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
          <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
            <Palette className="w-5 h-5" />
            Appearance
          </h2>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Primary
              </label>
              <ColorPicker
                value={form.primaryColor ?? "#2563eb"}
                onChange={(color) =>
                  setForm({ ...form, primaryColor: color })
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Background
              </label>
              <ColorPicker
                value={form.backgroundColor ?? "#ffffff"}
                onChange={(color) =>
                  setForm({ ...form, backgroundColor: color })
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Text
              </label>
              <ColorPicker
                value={form.textColor ?? "#1f2937"}
                onChange={(color) =>
                  setForm({ ...form, textColor: color })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Header Text
            </label>
            <input
              type="text"
              value={form.headerText ?? ""}
              onChange={(e) =>
                setForm({ ...form, headerText: e.target.value })
              }
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Position
            </label>
            <Select
              value={form.position ?? "bottom-right"}
              onValueChange={(val) =>
                setForm({
                  ...form,
                  position: val as "bottom-right" | "bottom-left",
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select position" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bottom-right">Bottom Right</SelectItem>
                <SelectItem value="bottom-left">Bottom Left</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Border Radius: {form.borderRadius ?? 16}px
            </label>
            <input
              type="range"
              min="0"
              max="50"
              value={form.borderRadius ?? 16}
              onChange={(e) =>
                setForm({ ...form, borderRadius: Number(e.target.value) })
              }
              className="w-full"
            />
          </div>
        </div>

        {/* Live Preview */}
        <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6">
          <h2 className="text-lg font-semibold text-card-foreground mb-4">
            Preview
          </h2>
          <div className="relative bg-muted/30 rounded-xl p-4 min-h-[400px] flex items-end justify-end">
            <div
              className="w-80 shadow-xl overflow-hidden"
              style={{
                backgroundColor: form.backgroundColor ?? "#ffffff",
                borderRadius: `${form.borderRadius ?? 16}px`,
                color: form.textColor ?? "#1f2937",
              }}
            >
              <div
                className="px-4 py-3 text-white font-medium text-sm"
                style={{ backgroundColor: form.primaryColor ?? "#2563eb" }}
              >
                {form.headerText ?? "Chat with us"}
              </div>
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: form.primaryColor ?? "#2563eb",
                      opacity: 0.2,
                    }}
                  />
                  <div
                    className="rounded-lg px-3 py-2 text-xs max-w-[80%]"
                    style={{
                      backgroundColor: `${form.primaryColor ?? "#2563eb"}15`,
                    }}
                  >
                    Hi there! How can I help you today?
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <div className="rounded-lg px-3 py-2 text-xs bg-muted max-w-[80%]">
                    I need help with my account
                  </div>
                </div>
              </div>
              <div className="px-4 pb-3">
                <div className="flex gap-2">
                  <div className="flex-1 px-3 py-2 rounded-lg border text-xs opacity-50">
                    Type a message...
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WidgetConfig;
