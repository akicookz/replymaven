---
title: MCP permissions
slug: mcp-permissions
excerpt: The four OAuth scopes an MCP client can be granted, and what each allows.
---

Permissions are approved during OAuth authorization and can be revoked at any time from the dashboard under **MCP Connections**.

| Permission | Allows |
| --- | --- |
| `projects:read` | Read projects, resources, conversations, and help center content. |
| `conversations:reply` | Send agent replies to conversations. |
| `resources:write` | Create and update knowledge resources. |
| `helpdesk:write` | Create, publish, and manage help center content. |

Guidelines:

- Grant the smallest set that does the job. A reporting client needs `projects:read` only.
- Every write tool also requires `confirm: true` per call, so a granted scope alone does not allow silent mutations.
- Revoking access in the dashboard invalidates the client's tokens immediately.
