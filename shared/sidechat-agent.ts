import type { JSONSchema7 } from "json-schema";

export type SidechatStatus =
  | "idle"
  | "working"
  | "waiting_approval"
  | "ready"
  | "failed";

export interface SidechatSummary {
  conversationId: string;
  childName: string;
  status: SidechatStatus;
  updatedAt: number;
}

export interface MavenProjectState {
  sidechats: Record<string, SidechatSummary>;
}

export interface SidechatSessionResponse {
  parentAgent: "MavenProjectAgent";
  parentName: string;
  childAgent: "MavenChatAgent";
  childName: string;
  token: string;
  expiresAt: number;
  created: boolean;
  canApproveOnce: boolean;
  canAlwaysAllow: boolean;
}

interface SidechatClaimBase {
  userId: string;
  effectiveUserId: string;
  projectId: string;
  parentName: string;
  role: "owner" | "admin" | "member";
  iat: number;
  exp: number;
  aud: "replymaven-sidechat";
  v: 1;
}

export interface SidechatParentClaims extends SidechatClaimBase {
  scope: "parent";
}

export interface SidechatChildClaims extends SidechatClaimBase {
  scope: "child";
  conversationId: string;
  childName: string;
  canSubmit: boolean;
  canApproveOnce: boolean;
  canAlwaysAllow: boolean;
}

export type SidechatActorClaims =
  | SidechatParentClaims
  | SidechatChildClaims;

export interface SidechatSummarySessionResponse {
  summaries: SidechatSummary[];
  parentAgent: "MavenProjectAgent";
  parentName: string;
  token: string;
  expiresAt: number;
}

export interface ReplyDraftData {
  type: "data-reply-draft";
  id: string;
  data: {
    text: string;
    createdAt: number;
  };
}

export interface SidechatCustomerContext {
  projectId: string;
  conversationId: string;
  conversationStatus: string;
  archivedAt: number | null;
  customer: {
    id: string;
    name: string | null;
    externalId: string | null;
    email: string | null;
  } | null;
  publicSummary: string | null;
  recentPublicMessages: Array<{
    id: string;
    role: "visitor" | "bot" | "agent" | "system";
    content: string;
    createdAt: number;
  }>;
}

export interface SidechatToolDescriptor {
  connectionId: string;
  toolName: string;
  exposedName: string;
  displayName: string;
  description: string;
  inputSchema: JSONSchema7;
  catalogFingerprint: string;
  audience: "sidechat";
  access: "read" | "write";
  enabled: boolean;
  alwaysAllowed?: boolean;
}

export interface ExecuteProjectToolRequest {
  childName: string;
  conversationId: string;
  actorUserId: string;
  connectionId: string;
  toolName: string;
  catalogFingerprint: string;
  access: "read" | "write";
  approvalMode: "none" | "once" | "always";
  input: unknown;
}

export interface PendingSidechatApprovalScope {
  approvalId: string;
  toolCallId: string;
  exposedName: string;
}

export interface ExecuteProjectToolResult {
  status: "completed" | "denied" | "unavailable" | "ambiguous" | "failed";
  output?: unknown;
  safeActivity: string;
  errorCode?: string;
}

export interface AlwaysAllowScope {
  projectId: string;
  connectionId: string;
  toolName: string;
  catalogFingerprint: string;
}

export interface SidechatToolAuditMetadata {
  projectId: string;
  childName: string;
  conversationId: string;
  connectionId: string;
  toolName: string;
  catalogFingerprint: string;
  access: "read" | "write";
  actorUserId: string | null;
  approvalMode: "none" | "once" | "always";
  status: ExecuteProjectToolResult["status"];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  safeActivity: string;
  errorCode?: string;
}
