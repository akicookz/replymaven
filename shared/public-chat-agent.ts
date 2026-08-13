import type { PublicConversationStatus } from "./maven-conversation";

export interface PublicChatChildClaims {
  v: 1;
  aud: "replymaven-public-chat";
  scope: "child";
  actor: "visitor" | "dashboard";
  projectId: string;
  parentName: string;
  conversationId: string;
  childName: `pub_${string}`;
  visitorId: string | null;
  canSubmitVisitor: boolean;
  canRead: boolean;
  iat: number;
  exp: number;
}

export interface PublicChatChildState {
  status: PublicConversationStatus;
  visitorPresence: "active" | "background";
  visitorLastOnlineAt: number | null;
  archived: boolean;
  revision: number;
}

export interface PublicChatSessionResponse {
  host: string;
  parentAgent: "MavenProjectAgent";
  parentName: string;
  childAgent: "MavenChatAgent";
  childName: `pub_${string}`;
  token: string;
  expiresAt: number;
}
