# Dashboard Information Architecture Design

**Date:** 2026-08-09

## Goal

Make frequently used project configuration easy to discover by promoting the current tab-contained Knowledge, Widget, Actions, Tools, Company, and MCP surfaces into clearly labeled sidebar groups and first-class routes.

## Approved Navigation

The project sidebar keeps Inbox first, then presents the following groups in order:

### Knowledgebase

- Sources
- Help Center
- SOPs
- Company info

### Support Chat

- Chat Widget
- Greetings
- Tools

### Workspace

- Dashboard
- Customers
- MCP Connections
- Settings

The existing Configure group is removed. Settings moves into Workspace so the sidebar does not retain a one-item group after Widget and Actions move elsewhere.

## Canonical Routes

Each sidebar item receives a stable, first-class project route.

| Sidebar item | Canonical route |
| --- | --- |
| Sources | `/app/projects/:projectId/knowledgebase/sources` |
| Help Center | `/app/projects/:projectId/knowledgebase/help-center` |
| SOPs | `/app/projects/:projectId/knowledgebase/sops` |
| Company info | `/app/projects/:projectId/knowledgebase/company-info` |
| Chat Widget | `/app/projects/:projectId/support-chat/widget` |
| Greetings | `/app/projects/:projectId/support-chat/greetings` |
| Tools | `/app/projects/:projectId/support-chat/tools` |
| Dashboard | `/app/projects/:projectId` |
| Customers | `/app/projects/:projectId/customers` |
| MCP Connections | `/app/projects/:projectId/mcp-connections` |
| Settings | `/app/projects/:projectId/settings` |

Help Center child routes follow the same namespace:

- `/app/projects/:projectId/knowledgebase/help-center/settings`
- `/app/projects/:projectId/knowledgebase/help-center/articles/new`
- `/app/projects/:projectId/knowledgebase/help-center/articles/:articleId`

## Page Ownership

### Knowledgebase pages

Sources renders the existing resource-management experience directly, without the `Knowledge` tab wrapper. Help Center renders the current article and category manager directly. SOPs renders the existing SOP manager directly.

Company info renders the complete current General Settings experience, as approved. This includes:

- Company identity
- Assistant and human-agent names
- Project slug
- Tone of voice
- Company context
- Conversation lifecycle and availability settings

The page heading and description should identify this as Company info rather than General Settings. Its existing API calls and persistence behavior do not change.

### Support Chat pages

Chat Widget is the one intentionally tabbed configuration surface. It has exactly two tabs:

- Appearance
- Actions

The active tab is represented by `?tab=appearance` or `?tab=actions`; Appearance is the default when the parameter is absent or invalid. The page owns one shared `Chat Widget` heading and a top-right action cluster. Installation is always present as a secondary button. Appearance also shows Save Changes; Actions also shows Add Action. Child panels do not render duplicate page headings.

Greetings becomes a direct page using the existing greetings editor and live preview. The user-facing page title becomes `Greetings`; explanatory text may continue to mention news or announcement cards.

Tools becomes a direct page using the existing tools management UI. It is no longer a tab under Actions.

### Workspace pages

MCP Connections renders the existing MCP connections UI directly rather than as a Settings tab.

Settings retains Team, Billing, and Profile. General moves to Company info and MCP moves to MCP Connections. Opening Settings without a valid tab selects Team. Existing account-level redirects to Billing and Profile remain valid.

## Chat Widget Composition

The Chat Widget page owns the shared header, tab control, and Installation drawer state. It composes two focused panels:

- `WidgetAppearance` continues to own widget configuration state, save behavior, and preview rendering. It gains Page Visibility as its final settings card.
- The existing Actions editor is extracted from the combined Actions & Tools page so it can render as the Actions tab without the old page header or Tools segment.

Changing tabs updates the URL with history replacement, matching the current settings behavior. After first render, both panels remain mounted and the inactive one is hidden so changing tabs does not submit or discard unsaved Appearance state.

## Installation Drawer

The Installation button appears in the top-right action area of Chat Widget on both tabs. It opens a right-side shadcn Sheet with an accessible title, description, and close control.

The drawer contains all current installation-specific controls except Page Visibility:

- Widget embed code and copy action
- Customer signing-secret creation and rotation
- One-time secret display and copy action
- Server signing example
- Browser identify lifecycle example
- Trust-boundary guidance

The drawer is scrollable independently of the main page and is wide enough for code samples on desktop while remaining full-width on narrow screens. Copy and secret actions retain their current success/error feedback. Opening `/widget/installation` or another legacy installation URL redirects to Chat Widget with `?install=open`, which opens the drawer automatically.

## Page Visibility

The existing Page Visibility card moves unchanged from Installation to the bottom of Appearance. Its page simulator remains connected to the Appearance preview so a user can test path rules where they edit them. Saving Appearance persists `allowedPages` together with the other widget configuration fields through the existing mutation.

## Legacy URL Compatibility

Existing bookmarks and documentation links must continue to land on the equivalent surface:

| Legacy route or state | Destination |
| --- | --- |
| `/knowledge` default or `?tab=articles` | Knowledgebase / Help Center |
| `/knowledge?tab=sources`, `/knowledgebase`, `/resources` | Knowledgebase / Sources |
| `/knowledge?tab=sops`, `/knowledgebase/sops` | Knowledgebase / SOPs |
| `/company`, `/settings?tab=general` | Knowledgebase / Company info |
| `/configuration` appearance states, `/widget`, `/widget/home` | Support Chat / Chat Widget Appearance |
| `/configuration` action states, `/quick-actions` | Support Chat / Chat Widget Actions |
| `/configuration` greeting states, `/widget/greetings` | Support Chat / Greetings |
| `/quick-actions?tab=tools`, `/tools`, `/widget/tools` | Support Chat / Tools |
| `/configuration` installation states, `/widget/installation` | Support Chat / Chat Widget with Installation drawer open |
| `/settings?tab=mcp` | Workspace / MCP Connections |
| Existing `/help/...` routes | Matching Knowledgebase / Help Center child route |

Redirects should use `replace` so obsolete routes do not create broken back-button loops. Redirect helpers must preserve the current project ID and any child entity ID required by the destination.

## Active Navigation and Project Switching

Sidebar items are active for their canonical route subtree. Help Center remains active while editing an article or changing Help Center settings. Chat Widget remains active for either Appearance or Actions and while the Installation drawer is open.

Switching projects replaces only the `/projects/:projectId` portion of the current canonical URL, preserving the selected page, Chat Widget tab, and drawer query state when possible.

Collapsed navigation retains icons and accessible titles for every item. Expanded navigation uses the approved group labels exactly: `Knowledgebase`, `Support Chat`, and `Workspace`.

## Component Boundaries

Implementation should keep existing domain components and introduce only the wrappers needed to remove tab coupling:

- `Layout` defines the three approved navigation groups and their active-state behavior.
- Route-level Knowledgebase pages render `Resources`, `HelpCenter`, `Sops`, and the renamed General Settings content directly.
- A Chat Widget route component owns tabs and Installation drawer state.
- A dedicated Installation drawer component owns installation queries and secret actions.
- Appearance owns Page Visibility and widget save behavior.
- An extracted Actions panel owns quick actions and contact-form editing.
- A direct Tools route renders the existing tools panel.
- Settings owns only Team, Billing, and Profile tabs.

No database schema, Worker API, or persistence format changes are required.

## Interaction and Visual Details

- Reuse the existing shadcn Tabs, Button, and Sheet primitives.
- Keep the current glass surface language and semantic color tokens.
- Installation and other icon buttons maintain at least a 40-by-40-pixel hit area.
- Buttons use the established subtle `active:scale-[0.96]` press response where appropriate.
- Transitions name specific properties; no `transition-all` is added.
- Page headings use balanced wrapping and descriptions use pretty wrapping when touched.
- The drawer uses surface contrast and spacing instead of row-separator borders.
- Keyboard focus, Sheet focus trapping, labels, and ARIA descriptions remain functional.

## Error Handling

- Existing loading and mutation error states remain visible on their new direct pages.
- Installation secret rotation failures continue to use toast feedback.
- Unknown Chat Widget tab values fall back to Appearance.
- An invalid Settings tab falls back to Team, except legacy General and MCP values, which redirect to their new first-class pages.
- Legacy redirects never silently drop an article ID or the `install=open` intent.

## Verification

Implementation is complete when:

1. The expanded sidebar shows the approved groups, order, labels, and items.
2. Every sidebar item opens a direct, reload-safe URL and highlights correctly.
3. Knowledgebase pages no longer display the old Articles / External Sources / SOPs tab bar.
4. Chat Widget displays only Appearance and Actions tabs.
5. Greetings and Tools are independent pages without the old parent tab controls.
6. Installation opens from the Chat Widget header as a right drawer on either tab.
7. Installation no longer contains Page Visibility.
8. Appearance contains Page Visibility, previews path rules, and saves them successfully.
9. MCP Connections is absent from Settings and available in Workspace.
10. Company info contains the entire former General Settings experience.
11. Team, Billing, and Profile still work from Settings.
12. Legacy routes redirect to the correct canonical page without navigation loops.
13. Mobile and collapsed sidebar navigation remain keyboard accessible and usable.
14. `bun run lint` and `bun run build` pass.
15. Browser screenshots verify the expanded sidebar, Chat Widget Appearance, Chat Widget Actions, and open Installation drawer at desktop and narrow widths.
