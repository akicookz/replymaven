import { describe, expect, test } from "bun:test";
import {
  getLocalUploadKey,
  isConversationUploadKeyOwnedByConversation,
  isConversationUploadUrl,
  isProjectChatUploadUrl,
} from "./upload-ownership";

describe("message upload ownership", () => {
  test("extracts conversation keys from absolute ReplyMaven upload URLs", () => {
    expect(getLocalUploadKey(
      "https://replymaven.test/api/uploads/project-1/conversation-attachments/conversation-1/image.png?version=1",
    )).toBe(
      "project-1/conversation-attachments/conversation-1/image.png",
    );
  });

  test("rejects percent-encoded traversal in upload keys", () => {
    expect(getLocalUploadKey(
      "/api/uploads/%2e%2e/project-1/chat-images/image.png",
    )).toBeNull();
    expect(getLocalUploadKey(
      "/api/uploads/..%2fproject-1/chat-images/image.png",
    )).toBeNull();
    expect(getLocalUploadKey(
      "/api/uploads/%252e%252e/project-1/chat-images/image.png",
    )).toBeNull();
    expect(getLocalUploadKey(
      "/api/uploads/project-1/chat-images/image%20name.png",
    )).toBe("project-1/chat-images/image name.png");
  });

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

  test("proves ownership from a conversation-scoped object key", () => {
    expect(isConversationUploadKeyOwnedByConversation(
      "project-1/conversation-attachments/conv-1/image.png",
      "conv-1",
    )).toBe(true);
    expect(isConversationUploadKeyOwnedByConversation(
      "project-1/conversation-attachments/conv-2/image.png",
      "conv-1",
    )).toBe(false);
    expect(isConversationUploadKeyOwnedByConversation(
      "project-1/chat-images/image.png",
      "conv-1",
    )).toBe(false);
    expect(isConversationUploadKeyOwnedByConversation(
      "project-1/conversation-attachments/conv-1/../shared.png",
      "conv-1",
    )).toBe(false);
  });
});
