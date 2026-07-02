import { describe, expect, test } from "bun:test";
import { isRenderedAskUserMessageValid } from "./render-ask-user-message";

describe("isRenderedAskUserMessageValid", () => {
  test("accepts a single on-topic question", () => {
    expect(
      isRenderedAskUserMessageValid({
        asksExactlyOneQuestion: true,
        introducesNewTopics: false,
      }),
    ).toBe(true);
  });

  test("rejects multi-question renders", () => {
    expect(
      isRenderedAskUserMessageValid({
        asksExactlyOneQuestion: false,
        introducesNewTopics: false,
      }),
    ).toBe(false);
  });

  test("rejects renders that drift onto new topics", () => {
    expect(
      isRenderedAskUserMessageValid({
        asksExactlyOneQuestion: true,
        introducesNewTopics: true,
      }),
    ).toBe(false);
  });
});
