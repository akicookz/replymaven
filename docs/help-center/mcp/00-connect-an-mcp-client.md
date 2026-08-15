---
title: Connect an MCP client
slug: connect-an-mcp-client
excerpt: Plug Claude, Cursor, or any MCP-compatible client into your ReplyMaven account.
---

Connect an MCP-compatible AI client to ReplyMaven to inspect projects, read support conversations, reply as an agent, manage knowledge resources, and manage your help center. ReplyMaven uses OAuth, so each client only receives the permissions you approve.

The remote MCP endpoint is:

```
https://replymaven.com/api/mcp
```

## Connect with Claude Code

```bash
claude mcp add --transport http --scope user replymaven https://replymaven.com/api/mcp
```

Your client opens ReplyMaven in the browser to authorize access. Approve the permissions you want the client to have; you can revoke them at any time from the dashboard.

> [!INFO]
> Write tools require an explicit `confirm: true` argument, so an AI client cannot mutate your account without a deliberate confirmation step.

See [Available MCP tools](/help/replymaven/mcp/available-mcp-tools) and [MCP permissions](/help/replymaven/mcp/mcp-permissions).
