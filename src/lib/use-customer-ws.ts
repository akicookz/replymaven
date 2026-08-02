import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WebSocket as ReconnectingWebSocket } from "partysocket";
import { type ServerEvent } from "../../shared/ws-events";
import { invalidateCustomerProjectQueries } from "./customers";

function buildCustomerWsUrl(projectId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/projects/${encodeURIComponent(projectId)}/customers/ws`;
}

export function useCustomerWs(projectId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId) return;
    const socket = new ReconnectingWebSocket(() => buildCustomerWsUrl(projectId));

    function handleMessage(event: MessageEvent<string>): void {
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(event.data) as ServerEvent;
      } catch {
        return;
      }
      if (parsed.type !== "customer:updated" || parsed.projectId !== projectId) {
        return;
      }
      void invalidateCustomerProjectQueries(queryClient, projectId);
    }

    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("message", handleMessage);
      socket.close();
    };
  }, [projectId, queryClient]);
}
