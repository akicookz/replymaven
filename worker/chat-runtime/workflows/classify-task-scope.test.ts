import { describe, expect, test } from "bun:test";
import { classifyTaskScope } from "./classify-task-scope";

describe("classifyTaskScope", () => {
  test("automatic page context does not make a joke request in scope", () => {
    const withoutContext = classifyTaskScope({ message: "tell me a joke" });
    const withContext = classifyTaskScope({
      message: "tell me a joke",
      pageContext: {
        currentPageUrl: "https://replymaven.com/pricing",
        pageTitle: "Pricing",
      },
    });

    expect(withContext).toEqual(withoutContext);
    expect(withContext.kind).toBe("out_of_scope_general");
  });

  test("support wording remains in scope with or without page context", () => {
    expect(
      classifyTaskScope({ message: "How do I configure the widget?" }).kind,
    ).toBe("in_scope_support");
    expect(
      classifyTaskScope({
        message: "How do I configure the widget?",
        pageContext: { plan: "Pro" },
      }).kind,
    ).toBe("in_scope_support");
  });
});
