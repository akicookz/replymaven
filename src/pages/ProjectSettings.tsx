import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Copy, Code, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProjectSettingsData {
  id: string;
  toneOfVoice: string;
  customTonePrompt: string | null;
  introMessage: string;
  autoCannedDraft: boolean;
}

function ProjectSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    toneOfVoice: "professional",
    customTonePrompt: "",
    introMessage: "Hi there! How can I help you today?",
    autoCannedDraft: true,
  });

  const { data: project } = useQuery<{ slug: string }>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data, isLoading } = useQuery<ProjectSettingsData>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  useEffect(() => {
    if (data) {
      setForm({
        toneOfVoice: data.toneOfVoice,
        customTonePrompt: data.customTonePrompt ?? "",
        introMessage: data.introMessage,
        autoCannedDraft: data.autoCannedDraft,
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        toneOfVoice: form.toneOfVoice,
        introMessage: form.introMessage,
        autoCannedDraft: form.autoCannedDraft,
      };
      if (form.toneOfVoice === "custom") {
        body.customTonePrompt = form.customTonePrompt;
      }

      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["project-settings", projectId],
      });
    },
  });

  const embedSnippet = `<script src="${window.location.origin}/api/widget-embed.js" data-project="${project?.slug ?? "your-project"}"></script>`;

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <div className="h-24 rounded-2xl bg-muted/50 animate-pulse" />
        <div className="h-32 rounded-2xl bg-muted/50 animate-pulse" />
        <div className="h-28 rounded-2xl bg-muted/50 animate-pulse" />
        <div className="h-20 rounded-2xl bg-muted/50 animate-pulse" />
        <div className="h-16 rounded-2xl bg-muted/50 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </div>

      {save.isSuccess && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 text-green-700 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Settings saved successfully
        </div>
      )}
      {save.isError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to save settings. Please try again.
        </div>
      )}

      {/* Embed Code */}
      <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-3">
        <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
          <Code className="w-5 h-5" />
          Embed Code
        </h2>
        <p className="text-sm text-muted-foreground">
          Add this script tag to your website to embed the chat widget.
        </p>
        <div className="relative">
          <pre className="bg-muted/50 rounded-xl p-4 text-xs font-mono overflow-x-auto">
            {embedSnippet}
          </pre>
          <button
            onClick={() => navigator.clipboard.writeText(embedSnippet)}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-background border border-border hover:bg-muted"
            title="Copy"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tone of Voice */}
      <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-3">
        <h2 className="text-lg font-semibold text-card-foreground">
          Tone of Voice
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {["professional", "friendly", "casual", "formal", "custom"].map(
            (tone) => (
              <button
                key={tone}
                onClick={() => setForm({ ...form, toneOfVoice: tone })}
                className={`px-4 py-2.5 rounded-xl border text-sm capitalize transition-colors ${
                  form.toneOfVoice === tone
                    ? "border-primary bg-primary/10 text-foreground font-medium"
                    : "border-input bg-background text-muted-foreground hover:border-primary/50"
                }`}
              >
                {tone}
              </button>
            ),
          )}
        </div>
        {form.toneOfVoice === "custom" && (
          <textarea
            value={form.customTonePrompt}
            onChange={(e) =>
              setForm({ ...form, customTonePrompt: e.target.value })
            }
            placeholder="Describe the tone you want your bot to use..."
            rows={3}
            className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        )}
      </div>

      {/* Intro Message */}
      <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-3">
        <h2 className="text-lg font-semibold text-card-foreground">
          Intro Message
        </h2>
        <p className="text-sm text-muted-foreground">
          The first message visitors see when they open the chat widget.
        </p>
        <textarea
          value={form.introMessage}
          onChange={(e) =>
            setForm({ ...form, introMessage: e.target.value })
          }
          rows={2}
          className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Auto Canned Drafts */}
      <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-card-foreground">
              Auto-Draft Canned Responses
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Automatically generate canned response drafts from completed
              conversations.
            </p>
          </div>
          <button
            onClick={() =>
              setForm({ ...form, autoCannedDraft: !form.autoCannedDraft })
            }
            className={`w-11 h-6 rounded-full transition-colors ${
              form.autoCannedDraft ? "bg-primary" : "bg-muted"
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                form.autoCannedDraft ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProjectSettings;
