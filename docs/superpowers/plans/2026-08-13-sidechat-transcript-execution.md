# Sidechat Transcript and Execution Visibility Implementation Plan

> **Execution rule:** UI behavior is verified in the authenticated browser. Do not add mocked component/UI tests.

**Goal:** Make Sidechat open at the newest message, reveal older messages in 25-message increments, and show a collapsible private execution trace with provider reasoning summaries and exact credential-redacted tool input/output.

**Architecture:** Keep Cloudflare `AIChatAgent` as the only transcript owner. The client continues receiving the SDK transcript, but `ChatThread` renders only the newest 25 messages and expands its render window upward by 25 while preserving the scroll anchor. Native AI SDK message parts remain the execution record: reasoning parts and tool parts are persisted in the private agent transcript after recursive secret redaction, adapted into Sidechat-only trace items, and rendered as a flat execution block immediately above the final Maven answer bubble. Approval is a state of the same tool entry, not a second message.

**Constraints:** No public visitor transcript/reply changes. No second message database. No raw credentials, auth headers, cookies, tokens, API keys, private keys, or system instructions in the browser. Ordinary customer and business data stays visible to the authenticated human. Do not start the dev server from the integrated terminal.

## Task 1: Remove misleading UI tests and record the browser-first rule

- Add the UI verification rule to `AGENTS.md`.
- Delete the Sidechat component tests that assert DOM/class behavior.
- Preserve pure protocol/state tests and backend credential-redaction tests.

## Task 2: Add bottom-first transcript windowing

- Make the shared `ChatThread` own its scroll viewport.
- Initially render the last 25 messages.
- On upward scroll, render 25 more and restore the previous visual anchor.
- Stick to the bottom only while the human is already near the bottom.
- Show a compact scroll-to-latest control while reading older messages.
- Reset the window and open at the bottom when the conversation changes.

## Task 3: Preserve a private, inspectable execution record

- Enable provider reasoning summaries in the Sidechat stream.
- Project presentation metadata for every connected tool, not only write tools.
- Recursively redact credential fields from streamed and persisted tool input/output.
- Preserve normal business/customer payload fields.
- Persist completed/error/denied tool states and reasoning parts in the private transcript.

## Task 4: Adapt native message parts into Sidechat trace items

- Add typed reasoning and tool trace items to the Sidechat message presentation model.
- Map reasoning text and all tool states from AI SDK parts.
- Associate approval IDs and actions with the matching tool call.
- Stop generating a duplicate approval message row.

## Task 5: Render the Sidechat execution trace

- Add a compact collapsible Thought/execution block before Maven's answer bubble.
- Render each tool call as its own flat `Used [provider icon] MCP · Tool name` disclosure; do not add an aggregate provider header.
- Keep status and duration as small neutral metadata without green or amber emphasis.
- Expanding the tool row shows exact credential-redacted Request and Response as plain text without cards or nested surfaces.
- Keep `Always allow` and `Allow once` on the same tool entry as its pending state.
- Keep the activity block flat and bubble-free; only the final answer uses the normal Maven bubble.
- Reuse existing typography, spacing, icons, and chat rhythm.

## Task 6: Verify real behavior

- Run TypeScript, relevant backend/protocol tests, changed-file lint, and production build without starting the dev server.
- In the already-running authenticated dashboard, verify Sidechat starts at the bottom, renders 25 messages, loads 25 more upward without jumping, and exposes a scroll-to-latest control.
- Run a read-only connected tool in Sidechat and verify reasoning/tool status/request/result/approval transitions remain in one trace and survive refresh.
- Verify credentials are absent and no public visitor reply is sent.
