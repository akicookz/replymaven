import { describe, expect, test } from "bun:test";

import { classifyAgentSessionFailure } from "./agent-session-response";

describe("classifyAgentSessionFailure", () => {
  test("keeps the stored conversation while the project is not cut over", () => {
    expect(classifyAgentSessionFailure(409, "agent_runtime_not_cut_over"))
      .toBe("unavailable");
  });

  test("retires only conversations the server identifies as missing or archived", () => {
    expect(classifyAgentSessionFailure(404, "not_found")).toBe("retire");
    expect(classifyAgentSessionFailure(409, "archived_conversation"))
      .toBe("retire");
  });

  test("does not destroy local state for transient and unrelated failures", () => {
    expect(classifyAgentSessionFailure(409, null)).toBe("unavailable");
    expect(classifyAgentSessionFailure(503, "unavailable"))
      .toBe("unavailable");
  });
});
