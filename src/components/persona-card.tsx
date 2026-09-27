import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RowCard } from "@/components/ui/row-card";
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
import { cn } from "@/lib/utils";

type ToneOfVoice = "professional" | "friendly" | "casual" | "formal" | "custom";

const TONE_OPTIONS: ToneOfVoice[] = [
  "professional",
  "friendly",
  "casual",
  "formal",
  "custom",
];

interface PersonaSettings {
  botName: string | null;
  agentName: string | null;
  toneOfVoice: ToneOfVoice;
  customTonePrompt: string | null;
}

interface PersonaForm {
  botName: string;
  agentName: string;
  toneOfVoice: ToneOfVoice;
  customTonePrompt: string;
}

function formFrom(settings: PersonaSettings): PersonaForm {
  return {
    botName: settings.botName ?? "",
    agentName: settings.agentName ?? "",
    toneOfVoice: settings.toneOfVoice ?? "professional",
    customTonePrompt: settings.customTonePrompt ?? "",
  };
}

const EMPTY_FORM: PersonaForm = {
  botName: "",
  agentName: "",
  toneOfVoice: "professional",
  customTonePrompt: "",
};

export function PersonaCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PersonaForm>(EMPTY_FORM);
  const [open, setOpen] = useState(false);

  const { data: settings } = useQuery<PersonaSettings>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch project settings");
      return res.json();
    },
    enabled: Boolean(projectId),
  });

  const botNameLocked = Boolean(settings?.botName?.trim());
  const saved = settings ? formFrom(settings) : EMPTY_FORM;
  const dirty = (Object.keys(form) as (keyof PersonaForm)[]).some(
    (key) => form[key] !== saved[key],
  );

  function update(patch: Partial<PersonaForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(botNameLocked ? {} : { botName: form.botName.trim() || null }),
          agentName: form.agentName.trim() || null,
          toneOfVoice: form.toneOfVoice,
          customTonePrompt:
            form.toneOfVoice === "custom" ? form.customTonePrompt.trim() || null : null,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to save persona");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-settings", projectId] });
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openDrawer() {
    setForm(saved);
    setOpen(true);
  }

  const toneLabel = saved.toneOfVoice.charAt(0).toUpperCase() + saved.toneOfVoice.slice(1);
  const summary = [
    saved.botName || "No assistant name yet",
    `${toneLabel} tone`,
    saved.agentName ? `hands off to ${saved.agentName}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <>
      <RowCard
        icon={<UserRound className="size-4" />}
        title="Persona"
        summary={summary}
        onClick={openDrawer}
      />

      <Sheet open={open} onOpenChange={(next) => !save.isPending && setOpen(next)}>
        <SheetContent side="right" aria-describedby={undefined} className="sm:max-w-xl">
          <SheetHeader>
            <SheetHeaderContent>
              <SheetTitle>Persona</SheetTitle>
            </SheetHeaderContent>
            <SheetHeaderActions>
              <SheetCloseButton label="Close persona" />
            </SheetHeaderActions>
          </SheetHeader>

          <SheetBody className="space-y-5 px-6 py-5">
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="bot-name">Assistant name</Label>
                {botNameLocked ? (
                  <div
                    id="bot-name"
                    className="flex h-9 items-center rounded-glass glass-card px-3 text-sm text-foreground"
                  >
                    {settings?.botName}
                  </div>
                ) : (
                  <Input
                    id="bot-name"
                    value={form.botName}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^a-zA-Z0-9_-]/g, "");
                      update({ botName: val.slice(0, 16) });
                    }}
                    placeholder="e.g. Luna, Alex, Maya"
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {botNameLocked
                    ? "Used in chat and Telegram commands. It cannot change."
                    : "No spaces, max 16 characters. You can set it once."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-name">Human agent label</Label>
                <Input
                  id="agent-name"
                  value={form.agentName}
                  onChange={(e) => update({ agentName: e.target.value.slice(0, 50) })}
                  placeholder="e.g. a team member, an engineer"
                />
                <p className="text-xs text-muted-foreground">
                  What Maven calls your team when handing off.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tone of voice</Label>
              <div className="grid grid-cols-5 gap-1.5">
                {TONE_OPTIONS.map((tone) => (
                  <button
                    key={tone}
                    type="button"
                    aria-pressed={form.toneOfVoice === tone}
                    onClick={() => update({ toneOfVoice: tone })}
                    className={cn(
                      "h-9 rounded-glass px-1 text-sm capitalize transition-colors",
                      form.toneOfVoice === tone
                        ? "bg-primary/10 font-medium text-foreground inset-ring inset-ring-primary/30"
                        : "bg-glass-card text-muted-foreground hover:bg-glass-button hover:text-foreground",
                    )}
                  >
                    {tone}
                  </button>
                ))}
              </div>
              {form.toneOfVoice === "custom" && (
                <Textarea
                  value={form.customTonePrompt}
                  onChange={(e) => update({ customTonePrompt: e.target.value })}
                  rows={3}
                  placeholder="Describe the tone you want Maven to use..."
                  className="min-h-0"
                />
              )}
            </div>
          </SheetBody>

          <SheetFooter>
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
