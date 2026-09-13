# MCP reconnect without losing permissions

## Problem and evidence

An existing MCP connection can retain an authorization URL after its OAuth state expires or is consumed. The Tools page opens that saved URL directly. Its Refresh action only reconciles transport and tool discovery; it does not restart authorization for a failed or authenticating connection.

Captured Stripe callbacks reported `State not found or already used`, before token exchange. This spec fixes recovery from that condition. It does not claim to fix the unconfirmed original Stripe token-exchange failure, and does not restore PR #2 or its speculative Stripe scope override.

The existing disconnect action deletes `sidechat_mcp_connections`, `sidechat_mcp_tool_policy`, and `sidechat_always_allow_grants`. Reconnect must not call that application disconnect path.

## User behavior

- No saved connection: show Connect and use the current create flow.
- Saved OAuth connection that needs authorization (authenticating, failed, disconnected, or an equivalent unavailable SDK state): show Reconnect. Always ask the backend for a new attempt; never open a cached authorization URL from a list response.
- A working connection keeps the current Connected card and tool settings behavior. Its settings menu may offer Reconnect for an explicit fresh authorization.
- While reconnect is running, show Reconnecting and prevent repeated clicks. After the response, follow only the new authorization URL. Existing transport/discovery states continue using the current settling behavior.
- Reconnect failure leaves the saved connection and permissions intact, shows a short error, and permits another attempt.
- Non-OAuth custom connections retain their current refresh behavior. Do not pretend an OAuth reconnect can repair a rejected bearer token or custom header.
- Read-only project members cannot reconnect. Owner/admin access rules remain the same as other connection mutations.

Use the existing shadcn Button, dropdown, and toast components. Do not add dependencies, borders, labels above headings, or new visual patterns.

## API and Agent contract

Add `POST /api/projects/:projectId/sidechat/mcp/connections/:connectionId/reconnect` next to the existing refresh route. Reuse the same project authorization and connection-ID validation. Resolve the connection's saved server URL/name/preset in the owning project Agent; the request must not accept a replacement server URL or credentials.

The Agent method returns the normal `{ connection }` response with the same connection ID and either a fresh OAuth authorization URL or an accurate connection state. Missing connections return 404. Unsupported authentication modes return a clear bounded client error. Network/provider failures return a bounded error without deleting application data.

Use the existing per-project MCP operation queue to serialize reconnect with connect, refresh, policy changes, and disconnect. Trace callback concurrency too: a late callback from an older attempt must not authorize the replacement attempt or damage a completed connection.

Keep the application connection ID, name, preset, URL, creation time, and policy/grant rows. Restart only the SDK transport/OAuth state for that saved connection. Use the installed Agents SDK's public APIs and the project's OAuth provider, rather than editing node_modules or accessing SDK private fields. Read the installed implementation before selecting the exact reset sequence.

Each explicit reconnect must produce new state and PKCE verifier. Invalidate outstanding attempts for that connection so an old consent tab cannot redeem against the new attempt. Preserve one-time state validation, expiry, issuer validation, and exact callback routing. Scope any OAuth storage cleanup to that connection; never clear another connection's credentials. If authentication credentials must be reset, preserve application metadata and permissions even if re-registration fails.

Preserve the configured callback origin and `/api/sidechat/mcp/oauth/{projectId}` path across restart and Durable Object restore. A pending attempt must survive eviction. Read-only presets must keep their scope restrictions on reconnect and callback, including after restore.

Do not change the database schema or run migrations. Do not change scopes or upgrade packages as part of this work.

## Permission preservation

Reconnect must not clear tool rows while authentication or discovery is pending or fails. On successful catalog discovery, reuse the existing normalization rules with the saved policies:

- Unchanged tools retain enabled state and read/write access.
- Existing always-allow grants remain valid for an unchanged tool fingerprint and access.
- Changed tool definitions/access follow the current approval invalidation rules.
- Successfully discovered removed tools follow current removal rules.

A failed or incomplete discovery is not proof that every tool was removed. Do not synchronize an empty catalog caused by failure over the user's settings.

## Callback feedback

Stop discarding the callback result. Map failures to a small set of safe error categories and show actionable UI copy, such as `Authorization expired. Reconnect to try again.` The return URL must not contain provider error text, codes, tokens, state, or verifiers. Consume/remove the feedback query parameter after displaying it so refresh does not repeat the toast.

If logging is needed, log only bounded categories and connection/preset identifiers. Do not log raw callback URLs, request/response bodies, OAuth error descriptions, credentials, or authorization URLs. A valid callback must still trigger SDK connection establishment and tool discovery.

## Validation and checkpoints

Never write tests. Use existing runtime checks and browser click-through.

1. Commit this spec.
2. Commit the backend reconnect and safe callback handling after type/lint review.
3. Commit the Tools page integration after browser verification.

Run `bunx tsc -b --force`, lint, and the production build. Record existing failures separately. The current package has no `test:agents` script and no unit-test files; do not create a test suite.

Use a local authenticated browser and a local MCP OAuth fixture if needed. Exercise Connect vs Reconnect, double-click prevention, failed authorization followed by a fresh attempt, old callback rejection, and permission preservation after successful reconnect. Do not use production Stripe consent or change production connections for validation. Verify the same connection ID and saved settings before and after the flow. If local authentication or services prevent a check, report that limit precisely.

No push, deploy, migration, or production connection change is authorized by this implementation request.

## Implementation validation

- Backend checkpoint: `8cd42fb`.
- Forced TypeScript check and production build pass. Lint still reports the pre-existing 8 errors and 25 warnings, including the old nested worktree. No tests were written.
- Authenticated local browser: verified Connect for an unsaved preset, Reconnect for a saved pending connection, and the Reconnect action in a working connection's menu.
- A reconnect of the local PostHog connection retained its exact application ID and all 326 tool policies, including one disabled tool. Application metadata and permission rows matched the pre-reconnect snapshot. The local connection had no always-allow grant rows, so grant preservation was reviewed in code only.
- The resulting attempt had a state value, PKCE challenge, and the local callback URL. An invalid local callback returned only the bounded `expired` category and left the pending state and PKCE unchanged. The browser displayed the expiry toast and removed its query parameter.
- Automatic approval review blocked opening the PostHog authorization origin because it treated that as a production authorization flow. No provider consent was completed. Successful token exchange, permission preservation after successful discovery, old-attempt replay across multiple fresh attempts, and eviction recovery remain unverified at runtime. This does not establish a fix for the original Stripe token-exchange failure.

### Approved live verification

The user subsequently approved the live PostHog check and its requested read-only permissions. Authorization was limited to `LaunchFast / ReplyMaven`. The provider returned through the local callback successfully, the saved authorization URL was cleared, and the browser showed PostHog Connected.

The application connection ID and metadata stayed unchanged. All 326 prior tool definitions retained their fingerprints, enabled settings, and access settings. Discovery added 11 tools, for 337 active tools total, with none removed. There were no saved always-allow grants in this local connection. Successful token exchange and permission preservation after discovery are now verified for PostHog. This does not verify the original Stripe failure.
