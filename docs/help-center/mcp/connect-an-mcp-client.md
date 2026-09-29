# Connect an MCP client

Connect an MCP-compatible client to inspect ReplyMaven projects, manage knowledge resources and help-center content, manage widget greeting cards, and work with conversations. ReplyMaven uses OAuth. You choose the scopes the client receives in the browser.

The remote MCP endpoint is:

```text
https://replymaven.com/api/mcp
```

## Add the server to your client

Use the setup method for your client. In ReplyMaven, find active client connections under **Settings → Connected apps** for the project.

### Codex

Add the server and sign in:

```bash
codex mcp add replymaven --url https://replymaven.com/api/mcp
codex mcp login replymaven
```

Codex opens a browser window for OAuth authorization.

### Claude Code

Run this command in a terminal:

```bash
claude mcp add --transport http --scope user replymaven https://replymaven.com/api/mcp
```

### Cursor

Add this server to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "replymaven": {
      "type": "http",
      "url": "https://replymaven.com/api/mcp"
    }
  }
}
```

### VS Code

Add this server to your workspace's `.vscode/mcp.json`:

```json
{
  "servers": {
    "replymaven": {
      "type": "http",
      "url": "https://replymaven.com/api/mcp"
    }
  }
}
```

Your client opens ReplyMaven in a browser to authorize access. Review the requested scopes and approve only the access you want to grant. You can revoke a connection at any time under **Settings → Connected apps**.

## Confirm changes

Write tools require the caller to send `confirm: true`. This value is an input check. The MCP server does not verify that a person approved a prompt in the client. Set up your client to ask you before it sends a write call with this value.

The server can read projects, knowledge resources, conversations, and help-center content. It can also create or update FAQs and web-page resources; create, edit, publish, unpublish, or delete help-center content; create widget greeting cards; send visitor-visible replies; and ask Maven to work in a private team thread. A webpage crawl or knowledge-index update starts in the background. Check its status in ReplyMaven after the tool call.

`create_webpage_resource` and `reindex_resource` do not support PDF upload or PDF reindexing through MCP. Upload PDFs from the dashboard.

See [Available MCP tools](https://replymaven.com/docs/mcp/available-mcp-tools) for each tool's inputs and [MCP permissions](https://replymaven.com/docs/mcp/mcp-permissions) for scope details.
