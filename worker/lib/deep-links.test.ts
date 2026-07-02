import { describe, expect, test } from "bun:test";
import { buildConversationDeepLink } from "./deep-links";

describe("buildConversationDeepLink", () => {
  test("builds a needs-you conversation link without a message id", () => {
    expect(
      buildConversationDeepLink("https://app.example.com", "proj_1", "conv_1"),
    ).toBe(
      "https://app.example.com/app/projects/proj_1/conversations?filter=needs-you&id=conv_1",
    );
  });

  test("appends the msg param when a message id is given", () => {
    expect(
      buildConversationDeepLink(
        "https://app.example.com",
        "proj_1",
        "conv_1",
        "msg_9",
      ),
    ).toBe(
      "https://app.example.com/app/projects/proj_1/conversations?filter=needs-you&id=conv_1&msg=msg_9",
    );
  });

  test("omits the msg param when the message id is null", () => {
    expect(
      buildConversationDeepLink(
        "https://app.example.com",
        "proj_1",
        "conv_1",
        null,
      ),
    ).toBe(
      "https://app.example.com/app/projects/proj_1/conversations?filter=needs-you&id=conv_1",
    );
  });

  test("omits the msg param when the message id is undefined", () => {
    expect(
      buildConversationDeepLink(
        "https://app.example.com",
        "proj_1",
        "conv_1",
        undefined,
      ),
    ).toBe(
      "https://app.example.com/app/projects/proj_1/conversations?filter=needs-you&id=conv_1",
    );
  });
});
