import type {
  OAuthClientMetadata,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/client";
import { DurableObjectOAuthClientProvider } from "agents";

const OIDC_IDENTITY_SCOPES = new Set(["openid", "profile", "email"]);

function isReadOnlyOAuthScope(scope: string): boolean {
  return OIDC_IDENTITY_SCOPES.has(scope) || scope.endsWith(":read");
}

export function authorizationRequestsNonReadScope(authUrl: URL): boolean {
  const scope = authUrl.searchParams.get("scope");
  if (!scope) return false;
  return scope
    .split(/\s+/u)
    .filter(Boolean)
    .some((value) => !isReadOnlyOAuthScope(value));
}

export function restrictOAuthDiscoveryToReadScopes(
  state: OAuthDiscoveryState,
): string {
  const resourceMetadata = state.resourceMetadata;
  const scopes = resourceMetadata?.scopes_supported;
  if (!scopes) return "";
  const readScopes = scopes.filter(isReadOnlyOAuthScope);
  resourceMetadata.scopes_supported = readScopes;
  return readScopes.join(" ");
}

export class ReadOnlyMcpOAuthClientProvider extends DurableObjectOAuthClientProvider {
  constructor(
    storage: DurableObjectStorage,
    clientName: string,
    callbackUrl: string,
    private readonly shouldRestrictServer: (serverId: string) => boolean,
    private readonly resolveServerScope: (
      serverId: string,
    ) => string | undefined = () => undefined,
  ) {
    super(storage, clientName, callbackUrl);
  }

  private shouldRestrictCurrentServer(): boolean {
    try {
      return this.shouldRestrictServer(this.serverId);
    } catch {
      return false;
    }
  }

  // The MCP client resolves scope as
  // `requested ?? resourceMetadata.scopes_supported ?? clientMetadata.scope`.
  // Servers that publish no `scopes_supported` (Stripe) otherwise authorize
  // and exchange tokens with no scope at all.
  override get clientMetadata(): OAuthClientMetadata {
    const base = super.clientMetadata;
    let scope: string | undefined;
    try {
      scope = this.resolveServerScope(this.serverId);
    } catch {
      scope = undefined;
    }
    return scope ? { ...base, scope } : base;
  }

  override async saveDiscoveryState(
    state: OAuthDiscoveryState,
  ): Promise<void> {
    if (this.shouldRestrictCurrentServer()) {
      restrictOAuthDiscoveryToReadScopes(state);
    }
    await super.saveDiscoveryState(state);
  }

  override async redirectToAuthorization(authUrl: URL): Promise<void> {
    if (
      this.shouldRestrictCurrentServer() &&
      authorizationRequestsNonReadScope(authUrl)
    ) {
      throw new Error("Read-only MCP authorization requested a non-read scope");
    }
    await super.redirectToAuthorization(authUrl);
  }
}
