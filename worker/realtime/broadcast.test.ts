import { expect, test } from "bun:test";
import type { AppEnv } from "../types";
import { broadcastCustomerUpdated } from "./broadcast";

test("broadcasts customer changes through the project customer room", async () => {
  const roomNames: string[] = [];
  const requests: Request[] = [];
  const pending: Promise<unknown>[] = [];
  const env = {
    INTERNAL_BROADCAST_SECRET: "internal-secret",
    CONVERSATION_DO: {
      idFromName(name: string) {
        roomNames.push(name);
        return name;
      },
      get() {
        return {
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            requests.push(new Request(input, init));
            return new Response("ok");
          },
        };
      },
    },
  } as unknown as AppEnv;
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  } as unknown as ExecutionContext;
  broadcastCustomerUpdated(env, ctx, "project-1", ["customer-1", "customer-2"]);
  await Promise.all(pending);

  expect(roomNames).toEqual(["customer-project:project-1"]);
  expect(await requests[0]?.json()).toEqual({
    event: {
      type: "customer:updated",
      projectId: "project-1",
      customerIds: ["customer-1", "customer-2"],
      updatedAt: expect.any(Number),
    },
    audience: "agents",
  });
});
