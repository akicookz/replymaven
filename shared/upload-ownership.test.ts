import { describe, expect, test } from "bun:test";
import {
  isConversationUploadUrl,
  isProjectChatUploadUrl,
} from "./upload-ownership";

describe("message upload ownership", () => {
  test("accepts only the current project's widget upload namespace", () => {
    expect(isProjectChatUploadUrl(
      "/api/uploads/project-1/chat-images/image.png",
      "project-1",
    )).toBe(true);
    expect(isProjectChatUploadUrl(
      "/api/uploads/project-2/chat-images/image.png",
      "project-1",
    )).toBe(false);
    expect(isProjectChatUploadUrl(
      "/api/uploads/../project-1/chat-images/image.png",
      "project-1",
    )).toBe(false);
  });

  test("accepts only the current conversation's attachment namespace", () => {
    expect(isConversationUploadUrl(
      "/api/uploads/project-1/conversation-attachments/conv-1/image.png",
      "project-1",
      "conv-1",
    )).toBe(true);
    expect(isConversationUploadUrl(
      "/api/uploads/project-1/conversation-attachments/conv-2/image.png",
      "project-1",
      "conv-1",
    )).toBe(false);
    expect(isConversationUploadUrl(
      "/api/uploads/project-2/conversation-attachments/conv-1/image.png",
      "project-1",
      "conv-1",
    )).toBe(false);
  });
});
