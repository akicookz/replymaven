import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Save, Zap, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TelegramData {
  telegramBotToken: string | null;
  telegramChatId: string | null;
}

function TelegramConfig() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");

  const { data, isLoading } = useQuery<TelegramData>({
    queryKey: ["telegram", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/telegram`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  useEffect(() => {
    if (data) {
      setChatId(data.telegramChatId ?? "");
    }
  }, [data]);

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
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegram", projectId] });
      setBotToken("");
    },
  });

  const test = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/telegram/test`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to test");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground">Telegram</h1>
        <div className="h-16 rounded-xl bg-muted animate-pulse" />
        <div className="h-16 rounded-xl bg-muted animate-pulse" />
        <div className="h-10 w-40 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground">
        Telegram Integration
      </h1>

      <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
          <Send className="w-5 h-5" />
          Live Agent Handoff
        </h2>
        <p className="text-sm text-muted-foreground">
          Connect your Telegram bot to receive live support requests. When the
          AI can't answer, visitors will be connected to you via Telegram.
        </p>

        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Bot Token
            </label>
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={
                data?.telegramBotToken ?? "Paste your bot token from @BotFather"
              }
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Chat ID
            </label>
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="Your Telegram chat ID"
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Send /start to your bot, then use @userinfobot to find your chat
              ID.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {save.isPending ? "Saving..." : "Save"}
          </Button>
          <Button
            variant="outline"
            onClick={() => test.mutate()}
            disabled={test.isPending || !data?.telegramBotToken}
          >
            <Zap className="w-4 h-4 mr-2" />
            {test.isPending ? "Testing..." : "Test Connection"}
          </Button>
        </div>

        {save.isSuccess && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 text-green-700 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Telegram settings saved successfully
          </div>
        )}
        {save.isError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Failed to save settings. Please try again.
          </div>
        )}
        {test.isSuccess && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 text-green-700 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Connection test successful! Check your Telegram.
          </div>
        )}
        {test.isError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Connection test failed. Check your bot token and chat ID.
          </div>
        )}
      </div>
    </div>
  );
}

export default TelegramConfig;
