import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Plus, Check, X, Trash2, AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CannedResponse {
  id: string;
  trigger: string;
  response: string;
  status: "draft" | "approved" | "rejected";
  createdAt: string;
}

interface ProjectSettingsData {
  autoCannedDraft: boolean;
}

function CannedResponses() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [trigger, setTrigger] = useState("");
  const [response, setResponse] = useState("");

  const { data: projectSettings } = useQuery<ProjectSettingsData>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch project settings");
      return res.json();
    },
  });

  const toggleAutoDraft = useMutation({
    mutationFn: async () => {
      const nextValue = !(projectSettings?.autoCannedDraft ?? true);
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoCannedDraft: nextValue }),
      });
      if (!res.ok) throw new Error("Failed to update auto-draft setting");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-settings", projectId] });
    },
  });

  const {
    data: cannedResponses,
    isLoading,
    isError,
  } = useQuery<CannedResponse[]>({
    queryKey: ["canned-responses", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/canned-responses`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const createCR = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/canned-responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger, response }),
      });
      if (!res.ok) throw new Error("Failed to create canned response");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["canned-responses", projectId],
      });
      setShowForm(false);
      setTrigger("");
      setResponse("");
    },
  });

  const approveCR = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/canned-responses/${id}/approve`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to approve");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["canned-responses", projectId],
      });
    },
  });

  const deleteCR = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/canned-responses/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["canned-responses", projectId],
      });
    },
  });

  const drafts = cannedResponses?.filter((cr) => cr.status === "draft") ?? [];
  const approved =
    cannedResponses?.filter((cr) => cr.status === "approved") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">
          Canned Responses
        </h1>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Response
        </Button>
      </div>

      <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Auto-Draft Canned Responses
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Automatically create draft canned responses from closed conversations.
            </p>
          </div>
          <button
            onClick={() => toggleAutoDraft.mutate()}
            disabled={toggleAutoDraft.isPending}
            className={`w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${
              (projectSettings?.autoCannedDraft ?? true) ? "bg-primary" : "bg-muted"
            }`}
            title="Toggle auto-draft"
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                (projectSettings?.autoCannedDraft ?? true)
                  ? "translate-x-5"
                  : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createCR.mutate();
            }}
            className="space-y-3"
          >
            <input
              type="text"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder="Trigger phrase (e.g. 'pricing', 'refund policy')"
              required
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="Response text..."
              required
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={createCR.isPending}>
                {createCR.isPending ? "Adding..." : "Add"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
          {createCR.isError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {createCR.error.message}
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-xl bg-muted animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to load canned responses. Please try refreshing the page.
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* Pending Drafts */}
          {drafts.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Bot className="w-5 h-5" />
                AI-Generated Drafts ({drafts.length})
              </h2>
              {drafts.map((cr) => (
                <div
                  key={cr.id}
                  className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {cr.trigger}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {cr.response}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-4">
                      <button
                        onClick={() => approveCR.mutate(cr.id)}
                        disabled={approveCR.isPending}
                        className="p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50"
                        title="Approve"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteCR.mutate(cr.id)}
                        disabled={deleteCR.isPending}
                        className="p-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                        title="Reject"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Approved Responses */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">
              Active Responses ({approved.length})
            </h2>
            {approved.map((cr) => (
              <div
                key={cr.id}
                className="bg-card/50 backdrop-blur-xl rounded-xl border border-border p-4 flex items-start justify-between"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {cr.trigger}
                  </p>
                  <p className="text-sm text-muted-foreground">{cr.response}</p>
                </div>
                <button
                  onClick={() => deleteCR.mutate(cr.id)}
                  disabled={deleteCR.isPending}
                  className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive shrink-0 ml-4 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {approved.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No canned responses yet. Add them manually or enable auto-drafting above.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default CannedResponses;
