import { describe, expect, test } from "bun:test";
import { detectSmallTalk } from "./small-talk";

describe("detectSmallTalk", () => {
  test.each(["hi", "Hi!", "hello", "hey there", "good morning", "yo"])(
    "detects greeting: %s",
    (message) => {
      expect(detectSmallTalk(message)).toBe("greeting");
    },
  );

  test.each(["thanks", "thank you!", "that worked", "got it, thanks", "all good", "bye"])(
    "detects resolution: %s",
    (message) => {
      expect(detectSmallTalk(message)).toBe("resolution");
    },
  );

  test.each([
    "hi, my widget is broken",
    "thanks, but one more thing: how do I change the color?",
    "how does it work?",
    "hello@example.com is my email",
  ])("does not flag substantive messages: %s", (message) => {
    expect(detectSmallTalk(message)).toBeNull();
  });
});
