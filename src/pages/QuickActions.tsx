import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap, MessageCircle, Plus, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QuickAction {
  id: string;
  label: string;
  action: string;
  icon: string | null;
  sortOrder: number;
}

interface QuickTopic {
  id: string;
  label: string;
  prompt: string;
  sortOrder: number;
}

function QuickActions() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  // Quick Actions state
  const [actionLabel, setActionLabel] = useState("");
  const [actionAction, setActionAction] = useState("");

  // Quick Topics state
  const [topicLabel, setTopicLabel] = useState("");
  const [topicPrompt, setTopicPrompt] = useState("");

  const {
    data: actions,
    isLoading: actionsLoading,
    isError: actionsError,
  } = useQuery<QuickAction[]>({
    queryKey: ["quick-actions", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/quick-actions`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const {
    data: topics,
    isLoading: topicsLoading,
    isError: topicsError,
  } = useQuery<QuickTopic[]>({
    queryKey: ["quick-topics", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/quick-topics`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const addAction = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/quick-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: actionLabel, action: actionAction }),
      });
      if (!res.ok) throw new Error("Failed to add quick action");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["quick-actions", projectId],
      });
      setActionLabel("");
      setActionAction("");
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
      queryClient.invalidateQueries({
        queryKey: ["quick-actions", projectId],
      });
    },
  });

  const addTopic = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/quick-topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: topicLabel, prompt: topicPrompt }),
      });
      if (!res.ok) throw new Error("Failed to add quick topic");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["quick-topics", projectId],
      });
      setTopicLabel("");
      setTopicPrompt("");
    },
  });

  const deleteTopic = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/quick-topics/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["quick-topics", projectId],
      });
    },
  });

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Quick Actions */}
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Zap className="w-6 h-6" />
          Quick Actions
        </h1>
        <p className="text-sm text-muted-foreground">
          Buttons displayed in the chat widget for quick navigation or actions.
        </p>

        {/* Add Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addAction.mutate();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={actionLabel}
            onChange={(e) => setActionLabel(e.target.value)}
            placeholder="Button label"
            required
            className="flex-1 px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="text"
            value={actionAction}
            onChange={(e) => setActionAction(e.target.value)}
            placeholder="Action (URL or prompt)"
            required
            className="flex-1 px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" size="sm" disabled={addAction.isPending}>
            <Plus className="w-4 h-4" />
          </Button>
        </form>

        {addAction.isError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {addAction.error.message}
          </div>
        )}

        {/* List */}
        {actionsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-14 rounded-xl bg-muted animate-pulse"
              />
            ))}
          </div>
        ) : actionsError ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Failed to load quick actions
          </div>
        ) : (
          <div className="space-y-2">
            {actions?.map((action) => (
              <div
                key={action.id}
                className="flex items-center gap-3 px-4 py-2.5 bg-card/50 rounded-xl border border-border"
              >
                <Zap className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {action.label}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {action.action}
                  </p>
                </div>
                <button
                  onClick={() => deleteAction.mutate(action.id)}
                  disabled={deleteAction.isPending}
                  className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {actions?.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No quick actions yet
              </p>
            )}
          </div>
        )}
      </div>

      {/* Quick Topics */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <MessageCircle className="w-5 h-5" />
          Quick Topics
        </h2>
        <p className="text-sm text-muted-foreground">
          Topic suggestions shown above the chat input to help visitors start a
          conversation.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addTopic.mutate();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={topicLabel}
            onChange={(e) => setTopicLabel(e.target.value)}
            placeholder="Topic label"
            required
            className="flex-1 px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="text"
            value={topicPrompt}
            onChange={(e) => setTopicPrompt(e.target.value)}
            placeholder="Pre-filled message"
            required
            className="flex-1 px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" size="sm" disabled={addTopic.isPending}>
            <Plus className="w-4 h-4" />
          </Button>
        </form>

        {addTopic.isError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {addTopic.error.message}
          </div>
        )}

        {topicsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-14 rounded-xl bg-muted animate-pulse"
              />
            ))}
          </div>
        ) : topicsError ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Failed to load quick topics
          </div>
        ) : (
          <div className="space-y-2">
            {topics?.map((topic) => (
              <div
                key={topic.id}
                className="flex items-center gap-3 px-4 py-2.5 bg-card/50 rounded-xl border border-border"
              >
                <MessageCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {topic.label}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {topic.prompt}
                  </p>
                </div>
                <button
                  onClick={() => deleteTopic.mutate(topic.id)}
                  disabled={deleteTopic.isPending}
                  className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {topics?.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No quick topics yet
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default QuickActions;
