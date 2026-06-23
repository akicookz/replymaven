import { and, eq, isNull, or } from "drizzle-orm";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import {
  mcpOAuthAuthCodes,
  mcpOAuthAuthorizations,
  mcpOAuthClients,
  mcpOAuthTokens,
  type McpOAuthClientRow,
} from "../db";

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90;
const AUTH_CODE_TTL_SECONDS = 60 * 10;

export const MCP_OAUTH_SCOPES = [
  "projects:read",
  "conversations:reply",
  "resources:write",
] as const;

export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

type AppDb = DrizzleD1Database<Record<string, unknown>>;

interface RegisterClientInput {
  clientName?: string;
  redirectUris: string[];
  grantTypes?: string[];
  responseTypes?: string[];
  scope?: string;
}

interface CreateAuthorizationCodeInput {
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

interface ExchangeAuthorizationCodeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

interface RefreshTokenInput {
  clientId: string;
  refreshToken: string;
}

export interface McpTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface ValidatedMcpToken {
  userId: string;
  clientId: string;
  scopes: McpOAuthScope[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class McpOAuthService {
  constructor(private db: AppDb) {}

  async registerClient(input: RegisterClientInput): Promise<McpOAuthClientRow> {
    const redirectUris = normalizeRedirectUris(input.redirectUris);
    const grantTypes = normalizeGrantTypes(input.grantTypes);
    const responseTypes = normalizeResponseTypes(input.responseTypes);
    const unknownScopes = getUnknownMcpScopes(input.scope);
    if (unknownScopes.length > 0) {
      throw new Error(`Unsupported scope: ${unknownScopes.join(" ")}`);
    }

    const scope = normalizeScopeString(input.scope);
    const clientName = (input.clientName?.trim() || "MCP Client").slice(0, 120);
    const id = `mcp_client_${createRandomToken(24)}`;

    await this.db.insert(mcpOAuthClients).values({
      id,
      clientName,
      redirectUris: JSON.stringify(redirectUris),
      grantTypes: JSON.stringify(grantTypes),
      responseTypes: JSON.stringify(responseTypes),
      scope,
    });

    const client = await this.getClient(id);
    if (!client) throw new Error("Failed to register MCP OAuth client");
    return client;
  }

  async getClient(clientId: string): Promise<McpOAuthClientRow | null> {
    const rows = await this.db
      .select()
      .from(mcpOAuthClients)
      .where(eq(mcpOAuthClients.id, clientId))
      .limit(1);

    return rows[0] ?? null;
  }

  async createAuthorizationCode(
    input: CreateAuthorizationCodeInput,
  ): Promise<string> {
    if (input.codeChallengeMethod !== "S256") {
      throw new Error("Only S256 PKCE is supported");
    }

    const code = `rm_code_${createRandomToken(32)}`;
    const codeHash = await hashSecret(code);
    const now = new Date();
    const expiresAt = addSeconds(now, AUTH_CODE_TTL_SECONDS);

    await this.db.insert(mcpOAuthAuthCodes).values({
      id: crypto.randomUUID(),
      codeHash,
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      scope: normalizeScopeString(input.scope),
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      expiresAt,
    });

    return code;
  }

  async exchangeAuthorizationCode(
    input: ExchangeAuthorizationCodeInput,
  ): Promise<McpTokenResponse> {
    const codeHash = await hashSecret(input.code);
    const rows = await this.db
      .select()
      .from(mcpOAuthAuthCodes)
      .where(eq(mcpOAuthAuthCodes.codeHash, codeHash))
      .limit(1);
    const codeRow = rows[0];

    if (!codeRow) throw new Error("Invalid authorization code");
    if (codeRow.usedAt) throw new Error("Authorization code has already been used");
    if (codeRow.expiresAt.getTime() <= Date.now()) {
      throw new Error("Authorization code has expired");
    }
    if (codeRow.clientId !== input.clientId) {
      throw new Error("Authorization code client mismatch");
    }
    if (codeRow.redirectUri !== input.redirectUri) {
      throw new Error("Authorization code redirect URI mismatch");
    }

    const pkceValid = await verifyCodeChallenge(
      input.codeVerifier,
      codeRow.codeChallenge,
    );
    if (!pkceValid) throw new Error("Invalid PKCE verifier");

    const now = new Date();
    await this.db
      .update(mcpOAuthAuthCodes)
      .set({ usedAt: now })
      .where(eq(mcpOAuthAuthCodes.id, codeRow.id));

    const authorizationId = crypto.randomUUID();
    await this.db.insert(mcpOAuthAuthorizations).values({
      id: authorizationId,
      userId: codeRow.userId,
      clientId: codeRow.clientId,
      scope: codeRow.scope,
    });

    return this.issueTokenPair({
      authorizationId,
      userId: codeRow.userId,
      clientId: codeRow.clientId,
      scope: codeRow.scope,
    });
  }

  async refreshToken(input: RefreshTokenInput): Promise<McpTokenResponse> {
    const refreshTokenHash = await hashSecret(input.refreshToken);
    const rows = await this.db
      .select()
      .from(mcpOAuthTokens)
      .where(eq(mcpOAuthTokens.refreshTokenHash, refreshTokenHash))
      .limit(1);
    const token = rows[0];

    if (!token) throw new Error("Invalid refresh token");
    if (token.revokedAt) throw new Error("Refresh token has been revoked");
    if (token.clientId !== input.clientId) {
      throw new Error("Refresh token client mismatch");
    }
    if (token.refreshExpiresAt.getTime() <= Date.now()) {
      throw new Error("Refresh token has expired");
    }

    const authorization = await this.getActiveAuthorization(
      token.authorizationId,
    );
    if (!authorization) throw new Error("Authorization has been revoked");

    const now = new Date();
    await this.db
      .update(mcpOAuthTokens)
      .set({ revokedAt: now })
      .where(eq(mcpOAuthTokens.id, token.id));

    return this.issueTokenPair({
      authorizationId: token.authorizationId,
      userId: token.userId,
      clientId: token.clientId,
      scope: token.scope,
    });
  }

  async validateAccessToken(
    accessToken: string,
  ): Promise<ValidatedMcpToken | null> {
    const accessTokenHash = await hashSecret(accessToken);
    const rows = await this.db
      .select()
      .from(mcpOAuthTokens)
      .where(eq(mcpOAuthTokens.accessTokenHash, accessTokenHash))
      .limit(1);
    const token = rows[0];

    if (!token) return null;
    if (token.revokedAt) return null;
    if (token.accessExpiresAt.getTime() <= Date.now()) return null;

    const authorization = await this.getActiveAuthorization(
      token.authorizationId,
    );
    if (!authorization) return null;

    return {
      userId: token.userId,
      clientId: token.clientId,
      scopes: parseScopeString(token.scope),
    };
  }

  async revokeToken(tokenValue: string, clientId: string | undefined): Promise<void> {
    const tokenHash = await hashSecret(tokenValue);
    const rows = await this.db
      .select()
      .from(mcpOAuthTokens)
      .where(
        or(
          eq(mcpOAuthTokens.accessTokenHash, tokenHash),
          eq(mcpOAuthTokens.refreshTokenHash, tokenHash),
        ),
      )
      .limit(1);
    const token = rows[0];
    if (!token) return;
    if (clientId && token.clientId !== clientId) return;

    const now = new Date();
    await this.db
      .update(mcpOAuthAuthorizations)
      .set({ revokedAt: now })
      .where(eq(mcpOAuthAuthorizations.id, token.authorizationId));
    await this.db
      .update(mcpOAuthTokens)
      .set({ revokedAt: now })
      .where(eq(mcpOAuthTokens.authorizationId, token.authorizationId));
  }

  private async getActiveAuthorization(
    authorizationId: string,
  ): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: mcpOAuthAuthorizations.id })
      .from(mcpOAuthAuthorizations)
      .where(
        and(
          eq(mcpOAuthAuthorizations.id, authorizationId),
          isNull(mcpOAuthAuthorizations.revokedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  private async issueTokenPair(input: {
    authorizationId: string;
    userId: string;
    clientId: string;
    scope: string;
  }): Promise<McpTokenResponse> {
    const accessToken = `rm_mcp_at_${createRandomToken(32)}`;
    const refreshToken = `rm_mcp_rt_${createRandomToken(40)}`;
    const now = new Date();

    await this.db.insert(mcpOAuthTokens).values({
      id: crypto.randomUUID(),
      authorizationId: input.authorizationId,
      userId: input.userId,
      clientId: input.clientId,
      accessTokenHash: await hashSecret(accessToken),
      refreshTokenHash: await hashSecret(refreshToken),
      scope: input.scope,
      accessExpiresAt: addSeconds(now, ACCESS_TOKEN_TTL_SECONDS),
      refreshExpiresAt: addSeconds(now, REFRESH_TOKEN_TTL_SECONDS),
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: input.scope,
    };
  }
}

// ─── Client Metadata Helpers ─────────────────────────────────────────────────

export function getClientRedirectUris(
  client: McpOAuthClientRow,
): string[] {
  return parseJsonStringArray(client.redirectUris);
}

export function getClientScopes(client: McpOAuthClientRow): McpOAuthScope[] {
  return parseScopeString(client.scope);
}

export function normalizeScopeString(scope: string | undefined): string {
  const requested = (scope ?? MCP_OAUTH_SCOPES.join(" "))
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const allowed = new Set<McpOAuthScope>(MCP_OAUTH_SCOPES);
  const normalized = requested.filter((value): value is McpOAuthScope =>
    allowed.has(value as McpOAuthScope),
  );

  return [...new Set(normalized)].join(" ") || "projects:read";
}

export function parseScopeString(scope: string): McpOAuthScope[] {
  return normalizeScopeString(scope).split(" ") as McpOAuthScope[];
}

export function isMcpOAuthScope(scope: string): scope is McpOAuthScope {
  return MCP_OAUTH_SCOPES.includes(scope as McpOAuthScope);
}

export function getUnknownMcpScopes(scope: string | undefined): string[] {
  if (!scope) return [];
  return scope
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value && !isMcpOAuthScope(value));
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

function normalizeRedirectUris(redirectUris: string[]): string[] {
  const normalized = redirectUris
    .map((uri) => uri.trim())
    .filter(Boolean)
    .map((uri) => validateRedirectUri(uri));

  if (normalized.length === 0) {
    throw new Error("At least one redirect URI is required");
  }
  if (normalized.length > 20) {
    throw new Error("Too many redirect URIs");
  }

  return [...new Set(normalized)];
}

function validateRedirectUri(rawUri: string): string {
  let url: URL;
  try {
    url = new URL(rawUri);
  } catch {
    throw new Error("Invalid redirect URI");
  }

  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();

  if (["javascript:", "data:", "file:", "blob:"].includes(protocol)) {
    throw new Error("Unsupported redirect URI scheme");
  }

  if (protocol === "http:") {
    const isLoopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1";
    if (!isLoopback) throw new Error("HTTP redirect URIs must be loopback");
  }

  return rawUri;
}

function normalizeGrantTypes(grantTypes: string[] | undefined): string[] {
  const defaults = ["authorization_code", "refresh_token"];
  const requested = grantTypes?.length ? grantTypes : defaults;
  const allowed = new Set(defaults);
  const normalized = requested.filter((value) => allowed.has(value));

  if (!normalized.includes("authorization_code")) {
    normalized.push("authorization_code");
  }
  if (!normalized.includes("refresh_token")) {
    normalized.push("refresh_token");
  }

  return [...new Set(normalized)];
}

function normalizeResponseTypes(responseTypes: string[] | undefined): string[] {
  const requested = responseTypes?.length ? responseTypes : ["code"];
  const normalized = requested.filter((value) => value === "code");
  return normalized.length ? ["code"] : ["code"];
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

// ─── Crypto Helpers ──────────────────────────────────────────────────────────

async function verifyCodeChallenge(
  codeVerifier: string,
  expectedChallenge: string,
): Promise<boolean> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const actualChallenge = base64UrlEncode(new Uint8Array(digest));
  return timingSafeEqual(actualChallenge, expectedChallenge);
}

async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createRandomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}
