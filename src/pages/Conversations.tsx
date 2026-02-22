import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Send,
  User,
  Bot,
  Headphones,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Conversation {
  id: string;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  role: "visitor" | "bot" | "agent";
  content: string;
  createdAt: string;
}

function Conversations() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const { data: conversations, isLoading } = useQuery<Conversation[]>({
    queryKey: ["conversations", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/conversations`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: convoDetail } = useQuery<{
    conversation: Conversation;
    messages: Message[];
  }>({
    queryKey: ["conversation-detail", selectedConvo],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!selectedConvo,
  });

  const sendReply = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: replyText }),
        },
      );
      if (!res.ok) throw new Error("Failed to send reply");
      return res.json();
    },
    onSuccess: () => {
      setReplyText("");
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", selectedConvo],
      });
      queryClient.invalidateQueries({
        queryKey: ["conversations", projectId],
      });
    },
  });

  const closeConversation = useMutation({
    mutationFn: async (convId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${convId}/close`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to close conversation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", selectedConvo],
      });
      queryClient.invalidateQueries({
        queryKey: ["conversations", projectId],
      });
    },
  });

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    waiting_agent: "bg-yellow-100 text-yellow-700",
    agent_replied: "bg-blue-100 text-blue-700",
    closed: "bg-muted text-muted-foreground",
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Conversations</h1>
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Conversations</h1>

      <div className="flex gap-4 h-[calc(100vh-12rem)]">
        {/* Conversation List */}
        <div className="w-80 border border-border rounded-2xl overflow-hidden flex flex-col">
          <div className="p-3 border-b border-border bg-muted/30">
            <p className="text-sm font-medium text-muted-foreground">
              {conversations?.length ?? 0} conversations
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations?.map((convo) => (
              <button
                key={convo.id}
                onClick={() => setSelectedConvo(convo.id)}
                className={cn(
                  "w-full p-3 text-left border-b border-border hover:bg-muted/30 transition-colors",
                  selectedConvo === convo.id && "bg-muted/50",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground truncate">
                    {convo.visitorName ?? convo.visitorId.slice(0, 8)}
                  </span>
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full",
                      statusColors[convo.status] ?? statusColors.active,
                    )}
                  >
                    {convo.status.replace("_", " ")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(convo.updatedAt).toLocaleString()}
                </p>
              </button>
            ))}
            {(!conversations || conversations.length === 0) && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No conversations yet
              </div>
            )}
          </div>
        </div>

        {/* Message Thread */}
        <div className="flex-1 border border-border rounded-2xl overflow-hidden flex flex-col">
          {selectedConvo && convoDetail ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground">
                    {convoDetail.conversation.visitorName ??
                      convoDetail.conversation.visitorId.slice(0, 8)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {convoDetail.conversation.visitorEmail ?? "No email"}
                  </p>
                </div>
                {convoDetail.conversation.status !== "closed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => closeConversation.mutate(convoDetail.conversation.id)}
                    disabled={closeConversation.isPending}
                    className="text-destructive hover:text-destructive"
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1.5" />
                    {closeConversation.isPending ? "Closing..." : "Close"}
                  </Button>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {convoDetail.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex gap-2 max-w-[80%]",
                      msg.role === "visitor" ? "mr-auto" : "ml-auto flex-row-reverse",
                    )}
                  >
                    <div
                      className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs",
                        msg.role === "visitor" &&
                          "bg-muted text-muted-foreground",
                        msg.role === "bot" && "bg-primary/10 text-primary",
                        msg.role === "agent" && "bg-blue-100 text-blue-700",
                      )}
                    >
                      {msg.role === "visitor" && <User className="w-3.5 h-3.5" />}
                      {msg.role === "bot" && <Bot className="w-3.5 h-3.5" />}
                      {msg.role === "agent" && <Headphones className="w-3.5 h-3.5" />}
                    </div>
                    <div
                      className={cn(
                        "rounded-xl px-3 py-2 text-sm",
                        msg.role === "visitor" &&
                          "bg-muted text-foreground",
                        msg.role === "bot" && "bg-primary/10 text-foreground",
                        msg.role === "agent" && "bg-blue-50 text-foreground",
                      )}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply Input */}
              <div className="p-3 border-t border-border">
                {convoDetail.conversation.status === "closed" ? (
                  <p className="text-sm text-muted-foreground text-center py-1">
                    This conversation is closed
                  </p>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (replyText.trim()) sendReply.mutate();
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type your reply..."
                      className="flex-1 px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!replyText.trim() || sendReply.isPending}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </form>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              <div className="text-center space-y-2">
                <MessageSquare className="w-8 h-8 mx-auto opacity-30" />
                <p>Select a conversation to view</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Conversations;
