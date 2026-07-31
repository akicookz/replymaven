# Message Bubble Markdown Rendering Design

## Context

ReplyMaven renders chat-message Markdown through two nearly identical lightweight renderers: one in the dashboard and one embedded in the widget. Both renderers discard empty input lines before grouping text into paragraphs. As a result, a message containing a deliberate blank line renders as consecutive line breaks without the intended paragraph spacing.

Inline code also uses a generic muted surface color. On blue message bubbles this becomes a dark, high-contrast block that does not belong to the bubble's color treatment.

## Goals

- Preserve an empty Markdown line as a paragraph boundary in dashboard and widget messages.
- Keep a single newline within a paragraph as a `<br>` line break.
- Give inline code a subtle, readable treatment on both colored and neutral bubbles.
- Keep dashboard and widget parsing behavior synchronized.
- Retain the current HTML escaping, links, emphasis, headings, and list behavior.

## Non-goals

- Replacing the lightweight message renderer with a full Markdown library.
- Adding fenced code blocks or syntax highlighting.
- Changing stored message content or backend chat behavior.
- Changing message bubble layout, typography, or colors outside inline code.

## Design

### Shared renderer

Move the duplicated rendering function into `shared/chat-markdown.ts`. The dashboard utility module will re-export it, preserving existing dashboard imports, while `widget/index.ts` will import the same function directly.

The renderer will continue escaping raw HTML before applying the supported Markdown transformations. During line processing, an empty line will flush the current paragraph instead of being discarded without effect. Non-empty consecutive lines remain in the same paragraph and join with `<br>`. Therefore:

```text
line one

line two
```

renders as two `<p>` elements, while `line one\nline two` renders as one `<p>` containing a `<br>`.

Consecutive empty lines may collapse to the same paragraph boundary, matching normal Markdown paragraph behavior.

### Inline-code styling

The HTML remains semantic `<code>` markup. Styling becomes bubble-aware:

- Dashboard sent bubbles and widget visitor bubbles use a low-opacity light surface with inherited text color.
- Dashboard received bubbles and widget bot/agent bubbles keep a subtle neutral surface suitable for their lighter background.
- Existing monospace typography, compact padding, wrapping, and rounded corners remain.

No borders or separators are added.

## Data flow

Stored message content remains unchanged. Both clients pass it to the shared renderer, receive escaped HTML, and insert that HTML through their existing rendering paths. CSS then applies the appropriate inline-code surface based on the surrounding message role.

Streaming widget messages continue rerendering through the same function, so completed and in-progress messages cannot drift from restored message history.

## Testing and verification

Add shared Bun tests that prove:

- A blank line produces separate paragraphs.
- A single newline remains a `<br>` inside one paragraph.
- Spaces surrounding inline code remain in the rendered HTML.
- Raw HTML remains escaped after extracting the renderer.

Run the focused tests first, followed by the full test suite, lint, the application build, and the widget build. Finally, visually inspect representative dashboard and widget bubbles containing inline code and a blank line.
