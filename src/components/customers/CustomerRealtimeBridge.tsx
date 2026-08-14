import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAgent } from "agents/react";
import type { SidechatSummarySessionResponse } from "../../../shared/sidechat-agent";
import {
  buildConversationDirectoryAgentOptions,
  readMavenProjectEvent,
} from "@/hooks/use-conversation-directory-agent";
import { useSidechatSummarySession } from "@/hooks/use-sidechat-agent";
import { invalidateCustomerProjectQueries } from "@/lib/customers";

function ConnectedBridge({
  projectId,
  session,
}: {
  projectId: string;
  session: SidechatSummarySessionResponse;
}) {
  const queryClient = useQueryClient();
  const onMessage = useCallback((event: MessageEvent) => {
    const parsed = readMavenProjectEvent(event.data);
    if (parsed?.type !== "customer-updated") return;
    void invalidateCustomerProjectQueries(queryClient, projectId);
  }, [projectId, queryClient]);
  useAgent({
    ...buildConversationDirectoryAgentOptions(session),
    onMessage,
  });
  return null;
}

export function CustomerRealtimeBridge({
  projectId,
}: {
  projectId: string | undefined;
}) {
  const session = useSidechatSummarySession(projectId);
  if (!projectId || !session.data) return null;
  return <ConnectedBridge projectId={projectId} session={session.data} />;
}
