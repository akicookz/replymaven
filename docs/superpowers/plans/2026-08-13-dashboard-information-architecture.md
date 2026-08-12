# Dashboard Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace nested dashboard configuration tabs with first-class Knowledgebase, Support Chat, and Workspace navigation, including a two-tab Chat Widget page and an Installation drawer.

**Architecture:** A small pure route module defines canonical project paths and query normalization. `App.tsx` mounts existing domain pages at canonical routes and redirects legacy URLs. `ChatWidget.tsx` owns shared widget configuration state, tab state, header actions, and the Installation sheet while focused child panels render Appearance and Actions content.

**Tech Stack:** React 19, React Router DOM 7, TanStack React Query, Tailwind CSS 4, shadcn/Radix Tabs and Sheet, Vitest, Bun.

## Global Constraints

- Work directly on the explicitly authorized local `main` branch.
- Use Bun for every script and package operation.
- Use function declarations for named functions and React components; arrows are limited to inline callbacks.
- Do not add mocked DOM/component tests for styling, layout, focus, scrolling, or interactions; verify those behaviors in the real authenticated browser.
- Use semantic color tokens and the existing glass surface language.
- Do not add row separators, horizontal rules, or section-divider borders.
- Use first-class canonical routes and `replace` redirects for legacy URLs.
- Keep Page Visibility in Appearance and all installation/customer-continuity controls in the right drawer.
- Do not change Worker APIs, database schema, or persistence formats.
- Do not deploy or push.

---

### Task 1: Canonical dashboard route contract

**Files:**
- Create: `src/lib/dashboard-routes.ts`
- Create: `src/lib/dashboard-routes.test.ts`

**Interfaces:**
- Produces: `projectRoute(projectId, destination)`, `normalizeChatWidgetTab(value)`, and `getLegacySettingsDestination(projectId, value)`.
- Consumes: no application state or browser APIs.

- [ ] **Step 1: Write the failing pure contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  getLegacySettingsDestination,
  normalizeChatWidgetTab,
  projectRoute,
} from "./dashboard-routes";

describe("dashboard routes", () => {
  it("builds every canonical first-class project route", () => {
    expect(projectRoute("project-1", "sources")).toBe(
      "/app/projects/project-1/knowledgebase/sources",
    );
    expect(projectRoute("project-1", "chat-widget")).toBe(
      "/app/projects/project-1/support-chat/widget",
    );
    expect(projectRoute("project-1", "mcp-connections")).toBe(
      "/app/projects/project-1/mcp-connections",
    );
  });

  it("falls back invalid widget tabs to appearance", () => {
    expect(normalizeChatWidgetTab("actions")).toBe("actions");
    expect(normalizeChatWidgetTab("appearance")).toBe("appearance");
    expect(normalizeChatWidgetTab("installation")).toBe("appearance");
    expect(normalizeChatWidgetTab(null)).toBe("appearance");
  });

  it("moves legacy general and MCP settings to first-class pages", () => {
    expect(getLegacySettingsDestination("project-1", "general")).toBe(
      "/app/projects/project-1/knowledgebase/company-info",
    );
    expect(getLegacySettingsDestination("project-1", "mcp")).toBe(
      "/app/projects/project-1/mcp-connections",
    );
    expect(getLegacySettingsDestination("project-1", "billing")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run: `bunx vitest run src/lib/dashboard-routes.test.ts`

Expected: FAIL because `src/lib/dashboard-routes.ts` does not exist.

- [ ] **Step 3: Implement the route contract**

Define a `ProjectDestination` union for `sources`, `help-center`, `sops`, `company-info`, `chat-widget`, `greetings`, `tools`, `dashboard`, `customers`, `mcp-connections`, and `settings`. Map each destination to its exact suffix and return `/app/projects/${projectId}${suffix}`. Export `ChatWidgetTab = "appearance" | "actions"`, normalize only those values, and return canonical Company info/MCP destinations only for the two legacy Settings values.

- [ ] **Step 4: Run the contract test and confirm GREEN**

Run: `bunx vitest run src/lib/dashboard-routes.test.ts`

Expected: 3 tests pass with no warnings.

- [ ] **Step 5: Commit the route contract**

```bash
git add src/lib/dashboard-routes.ts src/lib/dashboard-routes.test.ts
git commit -m "feat: define canonical dashboard routes"
```

---

### Task 2: First-class routes and grouped sidebar

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/GeneralSettings.tsx`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/pages/WidgetGreetings.tsx`
- Modify: `src/pages/Resources.tsx`
- Delete after redirects replace it: `src/pages/Knowledge.tsx`
- Delete after Chat Widget replaces it: `src/pages/Configuration.tsx`

**Interfaces:**
- Consumes: `projectRoute()` and the existing domain page default exports.
- Produces: canonical route mounting, legacy redirects, and active sidebar state.

- [ ] **Step 1: Replace sidebar navigation arrays**

In `Layout.tsx`, build these arrays with `projectRoute(currentProject.id, ...)`:

```ts
const knowledgebaseNav = [
  { label: "Sources", destination: "sources", icon: Database },
  { label: "Help Center", destination: "help-center", icon: BookOpen },
  { label: "SOPs", destination: "sops", icon: ListChecks },
  { label: "Company info", destination: "company-info", icon: Building2 },
];
const supportChatNav = [
  { label: "Chat Widget", destination: "chat-widget", icon: MessageSquare },
  { label: "Greetings", destination: "greetings", icon: MessagesSquare },
  { label: "Tools", destination: "tools", icon: Wrench },
];
const workspaceNav = [
  { label: "Dashboard", destination: "dashboard", icon: LayoutDashboard, exact: true },
  { label: "Customers", destination: "customers", icon: Users },
  { label: "MCP Connections", destination: "mcp-connections", icon: Plug },
  { label: "Settings", destination: "settings", icon: SettingsIcon },
];
```

Render `Knowledgebase`, `Support Chat`, and `Workspace` in that order after Inbox. Give collapsed links a `title` and preserve query strings when switching projects.

- [ ] **Step 2: Mount canonical routes**

Import and mount `Resources`, `HelpCenter`, `Sops`, `GeneralSettings`, `ChatWidget`, `WidgetGreetings`, `Tools`, and `McpConnections` at the paths specified in the design spec. Mount Help Center settings and article editor routes under `/knowledgebase/help-center/...`.

- [ ] **Step 3: Add legacy redirect components and routes**

Add focused redirect components that inspect the old query parameters:

- `LegacyKnowledgeRedirect`: articles/default → Help Center, sources → Sources, sops → SOPs.
- `LegacyConfigurationRedirect`: greetings → Greetings, installation → Chat Widget `?install=open`, actions → Chat Widget `?tab=actions`, otherwise Appearance.
- `LegacyQuickActionsRedirect`: `?tab=tools` → Tools, otherwise Chat Widget Actions.
- `LegacySettingsRedirect`: general → Company info, mcp → MCP Connections, otherwise render Settings.

Keep old `/company`, `/knowledgebase`, `/resources`, `/widget/*`, `/tools`, and `/help/*` aliases with `replace` navigation and preserve article IDs.

- [ ] **Step 4: Retitle the promoted pages**

Change the General Settings header to `Company info`, Sources header to `Sources`, and Greetings header to `Greetings`. Add `MobileMenuButton` to SOPs if it is absent. Apply `text-balance` to touched headings and `text-pretty` to touched descriptions.

- [ ] **Step 5: Reduce Settings to Team, Billing, and Profile**

Remove General and MCP tabs/imports from `Settings.tsx`; default invalid tabs to Team. Keep billing/profile query links working. `LegacySettingsRedirect` must route old General/MCP queries before rendering Settings.

- [ ] **Step 6: Run static verification**

Run: `bun run lint`

Expected: exit 0 with no errors.

- [ ] **Step 7: Commit the navigation and routes**

```bash
git add src/App.tsx src/components/Layout.tsx src/pages/GeneralSettings.tsx src/pages/Settings.tsx src/pages/WidgetGreetings.tsx src/pages/Resources.tsx src/pages/Sops.tsx src/pages/Knowledge.tsx src/pages/Configuration.tsx
git commit -m "feat: promote dashboard settings to sidebar routes"
```

---

### Task 3: Compose Chat Widget and Installation drawer

**Files:**
- Create: `src/pages/ChatWidget.tsx`
- Create: `src/components/widget-installation-drawer.tsx`
- Modify: `src/pages/WidgetAppearance.tsx`
- Modify: `src/pages/WidgetInstallation.tsx` or delete it after extracting the drawer
- Modify: `src/pages/QuickActions.tsx`
- Modify: `src/components/WidgetSettings.tsx`

**Interfaces:**
- Consumes: `normalizeChatWidgetTab`, `useWidgetSettings(projectId)`, existing quick-action APIs, Sheet primitives, and installation snippets.
- Produces: `ChatWidget` default page, `WidgetAppearancePanel`, `WidgetActionsPanel`, and `WidgetInstallationDrawer`.

- [ ] **Step 1: Make WidgetPageShell usable without a duplicate header**

Add `showHeader?: boolean` defaulting to `true`. When false, omit the page header and render only status feedback and the content grid. Keep the existing wrapper and preview behavior unchanged.

- [ ] **Step 2: Convert Appearance into a controlled panel**

Export `WidgetAppearancePanel({ state })`, where `state` is `ReturnType<typeof useWidgetSettings>`. Render its existing cards with `WidgetPageShell showHeader={false}`. Move the Page Visibility parsing, setter, `PageVisibilityInput`, and `Globe` icon from Installation to a final Appearance card. Pass preview page-path props so visibility rules remain testable in the preview.

- [ ] **Step 3: Extract a focused Actions panel**

Remove Tools and query-tab ownership from `QuickActions.tsx`. Export `WidgetActionsPanel` that obtains its own query client, receives `projectId`, `showAddForm`, and `onCloseAddForm`, and renders the existing action editor without a page header.

- [ ] **Step 4: Extract Installation into a Sheet**

Create `WidgetInstallationDrawer` with props:

```ts
interface WidgetInstallationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  embedSnippet: string;
}
```

Use `SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl"`. Retain embed-copy, signing-secret queries/mutations, code samples, trust guidance, success indicators, and toast errors. Do not render Page Visibility or a widget preview. Use `SheetHeader`, `SheetTitle`, and `SheetDescription` for accessibility.

- [ ] **Step 5: Build the shared Chat Widget page**

`ChatWidget.tsx` owns `useWidgetSettings`, URL tab normalization, drawer query state, and add-action state. The header contains:

- Mobile menu button and `Chat Widget` title/description.
- Installation secondary button on both tabs.
- Save Changes on Appearance.
- Add Action on Actions.

Below the header, render the Appearance/Actions tab control. Keep both panels mounted once visited by rendering them in hidden containers rather than conditionally unmounting the active panel. On drawer close, remove `install` from the URL with `replace`; opening it sets `install=open`.

- [ ] **Step 6: Run focused and static verification**

Run:

```bash
bunx vitest run src/lib/dashboard-routes.test.ts
bun run lint
bun run build
```

Expected: route tests pass; lint and build exit 0.

- [ ] **Step 7: Commit Chat Widget composition**

```bash
git add src/pages/ChatWidget.tsx src/components/widget-installation-drawer.tsx src/pages/WidgetAppearance.tsx src/pages/WidgetInstallation.tsx src/pages/QuickActions.tsx src/components/WidgetSettings.tsx
git commit -m "feat: compose chat widget settings and install drawer"
```

---

### Task 4: Real-dashboard verification and cleanup

**Files:**
- Modify only files implicated by real-browser defects.
- Modify: `docs/superpowers/plans/2026-08-13-dashboard-information-architecture.md` to check completed steps.

**Interfaces:**
- Consumes: the running authenticated ReplyMaven dashboard.
- Produces: verified navigation, drawer, responsive layout, and legacy compatibility.

- [ ] **Step 1: Start the local dashboard**

Run `bun run dev` in a persistent terminal session and use the real authenticated browser selected for the local URL.

- [ ] **Step 2: Verify desktop navigation**

At a desktop viewport, confirm the sidebar shows Inbox, Knowledgebase, Support Chat, and Workspace in order. Open all eleven promoted items, confirm their URL and active state, and verify Help Center stays active on its settings and article-editor child routes.

- [ ] **Step 3: Verify Chat Widget behavior**

On Chat Widget, switch between Appearance and Actions, start an unsaved Appearance edit and confirm it survives tab switches, open Installation on both tabs, exercise copy feedback, close/reopen the drawer, and confirm Page Visibility exists only in Appearance.

- [ ] **Step 4: Verify narrow and collapsed navigation**

At a narrow viewport, open the mobile sidebar, navigate to Chat Widget, and open/close the full-width Installation drawer. At desktop width, collapse the sidebar and confirm every icon link has a readable title and a minimum 40-pixel hit area.

- [ ] **Step 5: Verify representative legacy routes**

Open `/knowledge?tab=sources`, `/settings?tab=general`, `/settings?tab=mcp`, `/configuration?section=installation`, `/quick-actions?tab=tools`, and a Help Center article route. Confirm each replaces to the correct canonical URL without a back-button loop.

- [ ] **Step 6: Capture visual evidence**

Capture screenshots for the expanded sidebar, Chat Widget Appearance, Chat Widget Actions, desktop Installation drawer, and narrow Installation drawer.

- [ ] **Step 7: Run final verification**

Run fresh:

```bash
bunx vitest run src/lib/dashboard-routes.test.ts
bun run lint
bun run build
git diff --check
```

Expected: all commands exit 0, route tests report zero failures, and `git diff --check` prints nothing.

- [ ] **Step 8: Review and commit verified fixes**

Review the complete diff against the design spec. Fix Critical and Important findings, rerun Step 7, and commit any remaining verified changes without pushing or deploying.

