import { expect, test } from "bun:test";
import { classifyTaskScope } from "./classify-task-scope";

test("page context cannot override an unrelated request's scope decision", () => {
  const withoutContext = classifyTaskScope({ message: "tell me a joke" });
  const withContext = classifyTaskScope({
    message: "tell me a joke",
    pageContext: { currentPageUrl: "https://example.com/pricing" },
  });

  expect(withContext).toEqual(withoutContext);
  expect(withContext.kind).toBe("out_of_scope_general");
});
