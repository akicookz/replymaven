import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { PublicTurnOutcomeStore } from "./public-turn-outcome";

test("public turn outcomes survive recovery and are consumed once", () => {
  const sqlite = new Database(":memory:");
  const sql = {
    execute<T>(query: string, bindings: Array<string | number | null>): T[] {
      return sqlite.query(query).all(...bindings) as T[];
    },
  };
  const first = new PublicTurnOutcomeStore(sql);
  first.begin({
    messageId: "assistant-1",
    ownershipRevision: 7,
    aiInvoked: true,
    createdAt: 100,
  });
  expect(first.markPendingHumanTakeover()).toEqual(["assistant-1"]);
  first.complete({
    messageId: "assistant-1",
    ownershipRevision: 7,
    internalTokens: ["[HANDOFF_REQUESTED]"],
    createdAt: 100,
  });

  const recovered = new PublicTurnOutcomeStore(sql);
  expect(recovered.get("assistant-1")).toEqual({
    messageId: "assistant-1",
    ownershipRevision: 7,
    internalTokens: ["[HANDOFF_REQUESTED]"],
    status: "completed",
    humanTakeover: true,
    aiInvoked: true,
    createdAt: 100,
  });
  expect(recovered.take("assistant-1")).toEqual({
    messageId: "assistant-1",
    ownershipRevision: 7,
    internalTokens: ["[HANDOFF_REQUESTED]"],
    status: "completed",
    humanTakeover: true,
    aiInvoked: true,
    createdAt: 100,
  });
  expect(recovered.take("assistant-1")).toBeNull();
});

test("marks only unfinished turns for human takeover", () => {
  const sqlite = new Database(":memory:");
  const sql = {
    execute<T>(query: string, bindings: Array<string | number | null>): T[] {
      return sqlite.query(query).all(...bindings) as T[];
    },
  };
  const store = new PublicTurnOutcomeStore(sql);
  store.begin({
    messageId: "assistant-pending",
    ownershipRevision: 2,
    aiInvoked: false,
    createdAt: 100,
  });
  store.begin({
    messageId: "assistant-complete",
    ownershipRevision: 2,
    aiInvoked: false,
    createdAt: 101,
  });
  store.complete({
    messageId: "assistant-complete",
    ownershipRevision: 2,
    internalTokens: [],
    createdAt: 101,
  });

  expect(store.markPendingHumanTakeover()).toEqual(["assistant-pending"]);
  expect(store.get("assistant-pending")).toMatchObject({
    status: "pending",
    humanTakeover: true,
  });
  expect(store.get("assistant-complete")).toMatchObject({
    status: "completed",
    humanTakeover: false,
  });
});
