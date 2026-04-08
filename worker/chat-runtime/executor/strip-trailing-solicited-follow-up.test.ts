import { describe, expect, test } from "bun:test";
import { stripTrailingSolicitedFollowUp } from "./strip-trailing-solicited-follow-up";

describe("stripTrailingSolicitedFollowUp", () => {
  test("removes a trailing would-you-like question", () => {
    const response = `Great question. The API is for custom integrations and server-side workflows.

Would you like me to show an example of how to call it from your app?`;

    expect(stripTrailingSolicitedFollowUp(response)).toBe(
      "Great question. The API is for custom integrations and server-side workflows.",
    );
  });

  test("removes a trailing if-you'd-like offer", () => {
    const response =
      "The A record setup is the simplest option for most users. If you'd like, I can also walk through an API example.";

    expect(stripTrailingSolicitedFollowUp(response)).toBe(
      "The A record setup is the simplest option for most users.",
    );
  });

  test("keeps focused clarification questions untouched when they are the whole response", () => {
    const response = "What exact page, step, or error are you seeing when this happens?";

    expect(stripTrailingSolicitedFollowUp(response)).toBe(response);
  });

  test("leaves normal explanatory answers unchanged", () => {
    const response =
      "Use the API when you need programmatic control from your own backend or CI pipeline.";

    expect(stripTrailingSolicitedFollowUp(response)).toBe(response);
  });
});
