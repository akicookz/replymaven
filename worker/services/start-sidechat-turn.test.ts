import { expect, test } from "bun:test";
import {
  runStartSidechatTurn,
  type StartSidechatTurnPort,
} from "./start-sidechat-turn";

function createPort(overrides: Partial<StartSidechatTurnPort> = {}): {
  port: StartSidechatTurnPort;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    port: {
      async getPublicConversation() {
        calls.push("load");
        return { archivedAt: null };
      },
      async registerSidechat() {
        calls.push("register");
        return { status: "idle" };
      },
      claimWorking() {
        calls.push("claim");
        return "claimed";
      },
      async writeLastSidechatTurnOrigin(origin) {
        calls.push(`origin:${origin ?? "cleared"}`);
      },
      async submitServerSidechatTurn(input) {
        calls.push(`submit:${input.actorUserId}:${input.text}`);
        return true;
      },
      async releaseClaim() {
        calls.push("release");
      },
      confirmWorking() {
        calls.push("confirm");
      },
      ...overrides,
    },
  };
}

test("accepts an idle conversation and starts a server turn", async () => {
  const { port, calls } = createPort();
  await expect(runStartSidechatTurn({
    conversationId: "conv-1",
    text: "check his billing",
    actorUserId: "user-1",
    origin: "telegram",
  }, port)).resolves.toEqual({ accepted: true, status: "working" });
  expect(calls).toEqual([
    "load",
    "register",
    "claim",
    "origin:telegram",
    "submit:user-1:check his billing",
    "confirm",
  ]);
});

test("is busy when another start already claimed working", async () => {
  const { port, calls } = createPort({
    claimWorking() {
      calls.push("claim");
      return "busy";
    },
  });
  await expect(runStartSidechatTurn({
    conversationId: "conv-1",
    text: "check his billing",
    actorUserId: "user-1",
    origin: "telegram",
  }, port)).resolves.toEqual({ accepted: false, reason: "busy" });
  expect(calls).toEqual(["load", "register", "claim"]);
});

test("fails when the Sidechat child is missing", async () => {
  const { port, calls } = createPort({
    claimWorking() {
      calls.push("claim");
      return "failed";
    },
  });
  await expect(runStartSidechatTurn({
    conversationId: "conv-1",
    text: "check his billing",
    actorUserId: "user-1",
    origin: "telegram",
  }, port)).resolves.toEqual({ accepted: false, reason: "failed" });
  expect(calls).toEqual(["load", "register", "claim"]);
});

test("is busy when Sidechat is already working", async () => {
  const { port, calls } = createPort({
    async registerSidechat() {
      return { status: "working" };
    },
  });
  await expect(runStartSidechatTurn({
    conversationId: "conv-1",
    text: "check his billing",
    actorUserId: "user-1",
    origin: "slack",
  }, port)).resolves.toEqual({ accepted: false, reason: "busy" });
  expect(calls).toEqual(["load"]);
});

test("is busy when Sidechat is waiting for approval", async () => {
  const { port } = createPort({
    async registerSidechat() {
      return { status: "waiting_approval" };
    },
  });
  await expect(runStartSidechatTurn({
    conversationId: "conv-1",
    text: "check his billing",
    actorUserId: "user-1",
    origin: "mcp",
  }, port)).resolves.toEqual({ accepted: false, reason: "busy" });
});

test("is archived when the public conversation is missing", async () => {
  const { port, calls } = createPort({
    async getPublicConversation() {
      calls.push("load");
      return null;
    },
  });
  await expect(runStartSidechatTurn({
    conversationId: "conv-1",
    text: "check his billing",
    actorUserId: "user-1",
    origin: "mcp",
  }, port)).resolves.toEqual({ accepted: false, reason: "archived" });
  expect(calls).toEqual(["load"]);
});

test("is archived when the public conversation is archived", async () => {
  const { port } = createPort({
    async getPublicConversation() {
      return { archivedAt: 9 };
    },
  });
  await expect(runStartSidechatTurn({
    conversationId: "conv-1",
    text: "check his billing",
    actorUserId: "user-1",
    origin: "mcp",
  }, port)).resolves.toEqual({ accepted: false, reason: "archived" });
});

test("clears origin for a dashboard-started turn", async () => {
  const { port, calls } = createPort();
  await expect(runStartSidechatTurn({
    conversationId: "conv-1",
    text: "check his billing",
    actorUserId: "user-1",
    origin: "dashboard",
  }, port)).resolves.toEqual({ accepted: true, status: "working" });
  expect(calls).toContain("origin:cleared");
  expect(calls).toContain("confirm");
});

test("releases the claim when the child rejects the server submit", async () => {
  const { port, calls } = createPort({
    async submitServerSidechatTurn() {
      calls.push("submit");
      return false;
    },
  });
  await expect(runStartSidechatTurn({
    conversationId: "conv-1",
    text: "check his billing",
    actorUserId: "user-1",
    origin: "mcp",
  }, port)).resolves.toEqual({ accepted: false, reason: "failed" });
  expect(calls).toEqual([
    "load",
    "register",
    "claim",
    "origin:mcp",
    "submit",
    "release",
  ]);
});

test("releases the claim when origin write throws", async () => {
  const { port, calls } = createPort({
    async writeLastSidechatTurnOrigin() {
      calls.push("origin");
      throw new Error("origin write failed");
    },
  });
  await expect(runStartSidechatTurn({
    conversationId: "conv-1",
    text: "check his billing",
    actorUserId: "user-1",
    origin: "telegram",
  }, port)).rejects.toThrow("origin write failed");
  expect(calls).toEqual(["load", "register", "claim", "origin", "release"]);
});

test("releases the claim when submit throws", async () => {
  const { port, calls } = createPort({
    async submitServerSidechatTurn() {
      calls.push("submit");
      throw new Error("submit failed");
    },
  });
  await expect(runStartSidechatTurn({
    conversationId: "conv-1",
    text: "check his billing",
    actorUserId: "user-1",
    origin: "slack",
  }, port)).rejects.toThrow("submit failed");
  expect(calls).toEqual([
    "load",
    "register",
    "claim",
    "origin:slack",
    "submit",
    "release",
  ]);
});
