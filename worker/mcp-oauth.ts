import { type Context } from "hono";
import { type HonoAppContext } from "./types";
import {
  getClientRedirectUris,
  getClientScopes,
  getUnknownMcpScopes,
  MCP_OAUTH_SCOPES,
  type McpOAuthScope,
  McpOAuthService,
  normalizeScopeString,
  parseScopeString,
} from "./services/mcp-oauth-service";
import { renderMcpConsentPage } from "./oauth-render/consent-page";
import { type McpOAuthClientRow } from "./db";

// ─── Metadata ────────────────────────────────────────────────────────────────

export function buildMcpAuthenticateHeader(origin: string): string {
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource`;
  const scopes = MCP_OAUTH_SCOPES.join(" ");
  return `Bearer resource_metadata="${metadataUrl}", scope="${scopes}"`;
}

export function handleMcpAuthorizationServerMetadata(
  c: Context<HonoAppContext>,
): Response {
  const origin = getOrigin(c);

  return c.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/authorize`,
    token_endpoint: `${origin}/api/mcp/token`,
    revocation_endpoint: `${origin}/api/mcp/revoke`,
    registration_endpoint: `${origin}/api/mcp/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: MCP_OAUTH_SCOPES,
  });
}

export function handleMcpProtectedResourceMetadata(
  c: Context<HonoAppContext>,
): Response {
  const origin = getOrigin(c);

  return c.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: MCP_OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
  });
}

// ─── Client Registration ─────────────────────────────────────────────────────

export async function handleMcpClientRegistration(
  c: Context<HonoAppContext>,
): Promise<Response> {
  const body = await readJsonRecord(c);
  const redirectUris = readStringArray(body, "redirect_uris");
  const service = new McpOAuthService(c.get("db"));

  try {
    const client = await service.registerClient({
      clientName: readString(body, "client_name"),
      redirectUris,
      grantTypes: readStringArray(body, "grant_types"),
      responseTypes: readStringArray(body, "response_types"),
      scope: readString(body, "scope"),
    });

    return c.json(
      {
        client_id: client.id,
        client_name: client.clientName,
        redirect_uris: getClientRedirectUris(client),
        grant_types: JSON.parse(client.grantTypes) as string[],
        response_types: JSON.parse(client.responseTypes) as string[],
        token_endpoint_auth_method: "none",
        scope: client.scope,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      },
      201,
    );
  } catch (err) {
    return c.json(
      {
        error: "invalid_client_metadata",
        error_description: err instanceof Error ? err.message : "Invalid client metadata",
      },
      400,
    );
  }
}

// ─── Authorization Endpoint ──────────────────────────────────────────────────

export async function handleMcpAuthorizeGet(
  c: Context<HonoAppContext>,
): Promise<Response> {
  const user = c.get("user");
  if (!user) return redirectToLogin(c);

  const validation = await validateAuthorizeParams(c, getUrlParams(c));
  if (!validation.ok) return validation.response;

  const request = validation.request;
  const page = renderMcpConsentPage({
    clientName: request.client.clientName,
    userName: user.name,
    scopes: parseScopeString(request.scope),
    hiddenFields: {
      response_type: "code",
      client_id: request.client.id,
      redirect_uri: request.redirectUri,
      state: request.state ?? "",
      code_challenge: request.codeChallenge,
      code_challenge_method: request.codeChallengeMethod,
    },
  });

  return c.html(`<!doctype html>${page.toString()}`, 200, {
    "Cache-Control": "no-store",
  });
}

export async function handleMcpAuthorizePost(
  c: Context<HonoAppContext>,
): Promise<Response> {
  const user = c.get("user");
  if (!user) return redirectToLogin(c);

  const form = await c.req.formData();
  const validation = await validateAuthorizeParams(c, form);
  if (!validation.ok) return validation.response;

  if (readFormString(form, "decision") !== "allow") {
    return redirectWithOAuthError(
      validation.request.redirectUri,
      validation.request.state,
      "access_denied",
      "The authorization request was denied.",
    );
  }

  // Every box cleared reads as a refusal, not as the default scope.
  if (!readScopeParam(form)) {
    return redirectWithOAuthError(
      validation.request.redirectUri,
      validation.request.state,
      "access_denied",
      "No permissions were granted.",
    );
  }

  const service = new McpOAuthService(c.get("db"));
  const code = await service.createAuthorizationCode({
    clientId: validation.request.client.id,
    userId: user.id,
    redirectUri: validation.request.redirectUri,
    scope: validation.request.scope,
    codeChallenge: validation.request.codeChallenge,
    codeChallengeMethod: validation.request.codeChallengeMethod,
  });

  const redirectUrl = new URL(validation.request.redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (validation.request.state) {
    redirectUrl.searchParams.set("state", validation.request.state);
  }

  return c.redirect(redirectUrl.toString(), 302);
}

// ─── Token Endpoint ──────────────────────────────────────────────────────────

export async function handleMcpToken(
  c: Context<HonoAppContext>,
): Promise<Response> {
  const body = await readOAuthBody(c);
  const grantType = body.grant_type;
  const clientId = body.client_id;

  if (!clientId) {
    return tokenError(c, "invalid_request", "client_id is required");
  }

  const service = new McpOAuthService(c.get("db"));

  try {
    if (grantType === "authorization_code") {
      const code = body.code;
      const redirectUri = body.redirect_uri;
      const codeVerifier = body.code_verifier;
      if (!code || !redirectUri || !codeVerifier) {
        return tokenError(
          c,
          "invalid_request",
          "code, redirect_uri, and code_verifier are required",
        );
      }

      const token = await service.exchangeAuthorizationCode({
        code,
        clientId,
        redirectUri,
        codeVerifier,
      });
      return c.json(token, 200, { "Cache-Control": "no-store" });
    }

    if (grantType === "refresh_token") {
      const refreshToken = body.refresh_token;
      if (!refreshToken) {
        return tokenError(c, "invalid_request", "refresh_token is required");
      }

      const token = await service.refreshToken({
        clientId,
        refreshToken,
      });
      return c.json(token, 200, { "Cache-Control": "no-store" });
    }

    return tokenError(c, "unsupported_grant_type", "Unsupported grant_type");
  } catch (err) {
    return tokenError(
      c,
      "invalid_grant",
      err instanceof Error ? err.message : "Invalid grant",
    );
  }
}

export async function handleMcpTokenRevocation(
  c: Context<HonoAppContext>,
): Promise<Response> {
  const body = await readOAuthBody(c);
  const token = body.token;
  if (!token) return c.body(null, 200);

  const service = new McpOAuthService(c.get("db"));
  await service.revokeToken(token, body.client_id);
  return c.body(null, 200);
}

// ─── Authorization Validation ────────────────────────────────────────────────

interface ValidAuthorizeRequest {
  client: McpOAuthClientRow;
  redirectUri: string;
  scope: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

type AuthorizeValidation =
  | { ok: true; request: ValidAuthorizeRequest }
  | { ok: false; response: Response };

async function validateAuthorizeParams(
  c: Context<HonoAppContext>,
  params: URLSearchParams | FormData,
): Promise<AuthorizeValidation> {
  const clientId = readParam(params, "client_id");
  if (!clientId) {
    return badAuthorizeRequest(c, "client_id is required");
  }

  const service = new McpOAuthService(c.get("db"));
  const client = await service.getClient(clientId);
  if (!client) return badAuthorizeRequest(c, "Unknown client_id");

  const redirectUri = readParam(params, "redirect_uri");
  if (!redirectUri || !getClientRedirectUris(client).includes(redirectUri)) {
    return badAuthorizeRequest(c, "Invalid redirect_uri");
  }

  const state = readParam(params, "state");
  const responseType = readParam(params, "response_type");
  if (responseType !== "code") {
    return {
      ok: false,
      response: redirectWithOAuthError(
        redirectUri,
        state,
        "unsupported_response_type",
        "Only response_type=code is supported.",
      ),
    };
  }

  const codeChallenge = readParam(params, "code_challenge");
  const codeChallengeMethod = readParam(params, "code_challenge_method");
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return {
      ok: false,
      response: redirectWithOAuthError(
        redirectUri,
        state,
        "invalid_request",
        "S256 PKCE is required.",
      ),
    };
  }

  const rawScope = readScopeParam(params) ?? client.scope;
  const unknownScopes = getUnknownMcpScopes(rawScope);
  if (unknownScopes.length > 0) {
    return {
      ok: false,
      response: redirectWithOAuthError(
        redirectUri,
        state,
        "invalid_scope",
        `Unsupported scope: ${unknownScopes.join(" ")}`,
      ),
    };
  }

  // Downgrade to what this client actually holds instead of rejecting, so
  // adding a scope never breaks clients registered before it existed.
  const clientScopes = new Set(getClientScopes(client));
  const scope = normalizeScopeString(rawScope)
    .split(" ")
    .filter((value) => clientScopes.has(value as McpOAuthScope))
    .join(" ");
  if (!scope) {
    return {
      ok: false,
      response: redirectWithOAuthError(
        redirectUri,
        state,
        "invalid_scope",
        "Requested scope is not available to this client.",
      ),
    };
  }

  return {
    ok: true,
    request: {
      client,
      redirectUri,
      scope,
      state,
      codeChallenge,
      codeChallengeMethod: "S256",
    },
  };
}

function badAuthorizeRequest(
  c: Context<HonoAppContext>,
  message: string,
): AuthorizeValidation {
  return {
    ok: false,
    response: c.text(message, 400),
  };
}

function redirectWithOAuthError(
  redirectUri: string,
  state: string | null,
  error: string,
  description: string,
): Response {
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("error", error);
  redirectUrl.searchParams.set("error_description", description);
  if (state) redirectUrl.searchParams.set("state", state);
  return Response.redirect(redirectUrl.toString(), 302);
}

function redirectToLogin(c: Context<HonoAppContext>): Response {
  const url = new URL(c.req.url);
  const loginUrl = new URL("/", url.origin);
  loginUrl.searchParams.set("show_auth", "true");
  loginUrl.searchParams.set("callback", `${url.pathname}${url.search}`);
  return c.redirect(loginUrl.toString(), 302);
}

// ─── Request Parsing ─────────────────────────────────────────────────────────

function getUrlParams(c: Context<HonoAppContext>): URLSearchParams {
  return new URL(c.req.url).searchParams;
}

function readParam(params: URLSearchParams | FormData, name: string): string | null {
  const value = params.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Consent posts one `scope` entry per checked box; clients send one string. */
function readScopeParam(params: URLSearchParams | FormData): string | null {
  const joined = params
    .getAll("scope")
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .trim();
  return joined ? joined : null;
}

function readFormString(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

async function readJsonRecord(
  c: Context<HonoAppContext>,
): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Fall through to the empty object below.
  }
  return {};
}

async function readOAuthBody(
  c: Context<HonoAppContext>,
): Promise<Record<string, string>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await c.req.text();
    const params = new URLSearchParams(text);
    return Object.fromEntries(
      [...params.entries()].filter(([, value]) => value.trim()),
    );
  }

  const record = await readJsonRecord(c);
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.trim()) {
      output[key] = value.trim();
    }
  }
  return output;
}

function readString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function tokenError(
  c: Context<HonoAppContext>,
  error: string,
  description: string,
): Response {
  return c.json(
    {
      error,
      error_description: description,
    },
    400,
    { "Cache-Control": "no-store" },
  );
}

function getOrigin(c: Context<HonoAppContext>): string {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}
