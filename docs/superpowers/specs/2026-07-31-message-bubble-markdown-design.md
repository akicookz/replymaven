# Message Bubble Markdown Rendering Design

## Context

ReplyMaven currently renders chat-message Markdown through two nearly identical regex-based renderers: one in the dashboard and one embedded in the widget. Both discard empty input lines before grouping text into paragraphs, so deliberate paragraph breaks disappear. Maintaining two custom parsers also creates unnecessary correctness and security risk.

Inline code uses a generic muted surface color. On blue message bubbles this becomes a dark, high-contrast block that does not belong to the bubble's color treatment.

## Goals

- Replace both custom message parsers with one shared library-backed renderer.
- Preserve an empty Markdown line as a paragraph boundary in dashboard and widget messages.
- Keep a single newline as a visible line break.
- Give inline and fenced code a subtle, readable treatment on colored and neutral bubbles.
- Retain safe links, emphasis, headings, lists, and bare-URL linking.
- Keep dashboard and widget behavior synchronized.

## Non-goals

- Syntax highlighting or language-specific code themes.
- Changing stored message content or backend chat behavior.
- Changing message bubble layout, typography, or colors outside code elements.
- Allowing arbitrary HTML or inline Markdown images in message content.

## Design

### Shared Marked adapter

Create `shared/chat-markdown.ts` around the repository's existing `marked` dependency. A single `Marked` instance will use `gfm: true`, `breaks: true`, and synchronous parsing. Marked will own block parsing, paragraph boundaries, inline formatting, lists, bare URLs, inline code, and fenced code blocks.

The dashboard utility module will re-export `renderMarkdown(text: string): string`, preserving existing dashboard imports. `widget/index.ts` will import the same function directly and delete its local parser.

With `breaks: true`:

```text
line one

line two
```

renders as two `<p>` elements, while `line one\nline two` renders as one `<p>` containing a `<br>`.

### Safety policy

Marked intentionally does not sanitize output, so the shared adapter will provide a narrow renderer policy:

- Raw HTML tokens are escaped and displayed as text.
- Link destinations are allowed only when URL parsing resolves them to `http:`, `https:`, `mailto:`, or `tel:`.
- Link attributes and raw text are HTML-escaped.
- Links retain `target="_blank"` and `rel="noopener noreferrer"`.
- Inline Markdown images render as escaped alt text; uploaded message images continue through the existing attachment renderer.

Regression tests will cover raw HTML, dangerous protocols, safe links, and attribute escaping.

### Code styling

Inline code keeps semantic `<code>` markup. Fenced code uses Marked's `<pre><code>` output.

- Inline code derives a low-opacity background from `currentColor`, producing a light translucent chip on blue bubbles and a dark translucent chip on light bubbles.
- Fenced blocks use the same adaptive surface on the `<pre>` container, with transparent nested `<code>` styling and horizontal scrolling for long lines.
- Existing monospace typography and compact rounded corners remain.

No borders or separators are added.

## Data flow

Stored message content remains unchanged. Both clients pass it to the shared Marked adapter, receive safe HTML, and insert that HTML through their existing rendering paths. CSS applies the appropriate code surface based on inherited message text color.

Streaming widget messages continue rerendering through the same synchronous function, so partial, completed, and restored messages use identical parsing.

## Bundle impact

The installed Marked ESM build is 12.8 KB gzip before tree-shaking; the existing widget is 32.4 KB gzip. The implementation will measure the actual production-bundle delta after integration and report it. No separate sanitizer library will be bundled because the adapter's allowlist policy disables the unsafe constructs supported by message Markdown.

## Testing and verification

Add Bun tests proving:

- A blank line produces separate paragraphs.
- A single newline remains a `<br>` inside one paragraph.
- Inline and fenced code produce semantic markup.
- Bare URLs and safe Markdown links remain clickable.
- Raw HTML is escaped.
- `javascript:` and `data:` links are not emitted as anchors.
- Link attributes are escaped.

Run the focused tests first, followed by the full test suite, lint, the application build, and the widget build. Measure the widget's gzip size before and after integration, then visually inspect representative dashboard and widget bubbles containing inline code, fenced code, and a blank line.
