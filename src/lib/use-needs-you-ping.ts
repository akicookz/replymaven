import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { playChime } from "./ping-sound";

export interface PingItem {
  id: string;
  visitorName: string | null;
  visitorEmail: string | null;
  summary: string | null;
  summaryMessageId: string | null;
  updatedAt: number;
}

const sinceKey = (projectId: string) => `rm-ping-since:${projectId}`;

// try/catch-guarded localStorage access — Safari private mode (and any
// environment with storage disabled/over quota) throws on read/write rather
// than silently no-op'ing like other browsers.
function readSince(projectId: string): string | null {
  try {
    return localStorage.getItem(sinceKey(projectId));
  } catch {
    return null;
  }
}

function writeSince(projectId: string, value: string): void {
  try {
    localStorage.setItem(sinceKey(projectId), value);
  } catch {
    // Storage unavailable — there's no in-memory fallback, so every later
    // readSince() call fails too and looks like a first-ever poll. Net
    // effect: this session never pings at all (not "re-baseline on reload").
  }
}

// Pure: whether a raw localStorage read represents "no prior watermark for
// this project" (first-ever poll). Exported for unit testing without a DOM.
export function isFirstPollFor(raw: string | null): boolean {
  return (parseInt(raw ?? "0", 10) || 0) === 0;
}

// Pure: identity key for a ping item — dedupes on (id, updatedAt) so an item
// that re-enters Needs You later (new updatedAt) can ping again.
export function pingKey(item: { id: string; updatedAt: number }): string {
  return `${item.id}:${item.updatedAt}`;
}

// Pure: items not already pinged this session, given the seen-key set.
export function selectFreshItems<T extends { id: string; updatedAt: number }>(
  items: T[],
  seen: ReadonlySet<string>,
): T[] {
  return items.filter((i) => !seen.has(pingKey(i)));
}

// Watches for conversations newly entering Needs You and fires the ping
// surfaces: toast + chime + (backgrounded tab) browser notification. The
// watermark persists in localStorage so reloads don't re-ping old items.
export function useNeedsYouPing(projectId: string | undefined): void {
  const navigate = useNavigate();
  const seenRef = useRef<Set<string>>(new Set());

  // One-time notification permission request, deferred to the first user
  // gesture (required by most browsers).
  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    const ask = () => { Notification.requestPermission().catch(() => {}); };
    window.addEventListener("pointerdown", ask, { once: true });
    return () => window.removeEventListener("pointerdown", ask);
  }, []);

  const { data } = useQuery<{ serverTime: number; items: PingItem[] }>({
    queryKey: ["needs-review-updates", projectId],
    queryFn: async () => {
      const since = readSince(projectId!) ?? "0";
      const res = await fetch(
        `/api/projects/${projectId}/needs-review-updates?since=${since}`,
      );
      if (!res.ok) throw new Error("ping poll failed");
      return res.json();
    },
    enabled: !!projectId,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true, // background tabs must still ping
  });

  useEffect(() => {
    if (!data || !projectId) return;
    const isFirstPoll = isFirstPollFor(readSince(projectId));
    writeSince(projectId, String(data.serverTime));
    if (isFirstPoll) return; // baseline poll: watermark only, never ping the backlog

    const fresh = selectFreshItems(data.items, seenRef.current);
    fresh.forEach((i) => seenRef.current.add(pingKey(i)));
    if (fresh.length === 0) return;

    playChime();
    for (const item of fresh) {
      const who = item.visitorName || item.visitorEmail || "A visitor";
      const url =
        `/app/projects/${projectId}/conversations?filter=needs-you&id=${item.id}` +
        (item.summaryMessageId ? `&msg=${item.summaryMessageId}` : "");
      toast(`${who} needs your review`, {
        description: item.summary ? item.summary.slice(0, 140) : undefined,
        action: { label: "View", onClick: () => navigate(url) },
        duration: 10_000,
      });
      if (
        "Notification" in window &&
        Notification.permission === "granted" &&
        document.visibilityState === "hidden"
      ) {
        const n = new Notification(`${who} needs your review`, {
          body: item.summary?.slice(0, 140) ?? "Open the inbox to reply.",
          tag: pingKey(item),
        });
        n.onclick = () => { window.focus(); navigate(url); n.close(); };
      }
    }
  }, [data, projectId, navigate]);
}
