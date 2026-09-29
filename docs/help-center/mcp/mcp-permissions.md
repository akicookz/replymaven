# MCP permissions

OAuth shows the scopes requested by a client before you connect it. You can review and revoke active connections under **Settings → Connected apps** in the project.

| Scope | Allows |
| --- | --- |
| `projects:read` | Read projects, settings, resources, conversations, and help-center tabs, categories, and articles. It can also list widget greeting cards. |
| `conversations:reply` | Send visitor-visible replies, send a message to Maven in a private conversation thread, and read that thread's working, approval, and draft status. Maven may act on the conversation when asked. |
| `resources:write` | Create and update FAQ resources, add web-page resources, and reindex webpages or FAQs. PDF upload and reindex are not supported through MCP. |
| `helpdesk:write` | Create, update, publish, unpublish, archive, and delete help-center tabs, categories, and articles. It also allows the client to upload or import images for article content. |
| `widget:write` | Create, edit, delete, and reorder widget greeting cards. It can also list greeting cards. |

## Scope details

- Read tools usually need `projects:read`. Two exceptions are `get_sidechat_status`, which needs `conversations:reply`, and `list_greetings`, which accepts either `projects:read` or `widget:write`.
- `conversations:reply` includes `ask_maven`. Maven can look up knowledge and can reply to the visitor, assign, close, or block a conversation. Review the client's request before granting this scope.
- A granted scope does not replace team and project access checks. Each call is still limited to projects the authenticated user can access.

## Confirm changes

Every write tool requires a `confirm: true` argument. The MCP server checks that the caller sends this value. It does not verify that a person approved a confirmation prompt in the client. Configure your client to ask before it sends a write call with `confirm: true`.

Page crawls and AI Search indexing can continue after a tool returns. The write scope lets the client start these operations; check their status in the dashboard.

See [Available MCP tools](https://replymaven.com/docs/mcp/available-mcp-tools) for the inputs and scope of each tool, and [Connect an MCP client](https://replymaven.com/docs/mcp/connect-an-mcp-client) for setup steps.
