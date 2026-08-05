# Customers Table Design

## Goal

Make the Customers page feel native to the existing ReplyMaven dashboard. Reuse the visual patterns already present on Dashboard, Knowledge, Settings, and Inbox.

## Layout

- Use the standard full-width dashboard content area and `space-y-6` page rhythm.
- Use the existing compact page header: `text-xl md:text-2xl font-bold`, a short muted description, and one primary `Create customer` button on the right.
- Remove the `Workspace` eyebrow, centered `max-w-6xl` wrapper, oversized search shell, glass effects, and duplicate create button.

## Customer Table

- Render the directory inside one `bg-card rounded-xl` surface, matching the Recent Conversations table.
- Put a compact search field in the table toolbar.
- Use the columns `Customer`, `External ID`, `Conversations`, and `Last active`.
- Show the customer initial, name, and email together in the first column.
- Make each row a keyboard-accessible link to the customer detail page.
- Use subtle background change on hover. Do not animate rows vertically or add decorative outlines.
- Use tabular numerals for conversation counts.

## Responsive Behavior

- Keep the customer identity visible at every width.
- Hide lower-priority columns as space becomes limited instead of forcing horizontal scrolling.
- Show conversations before last activity when only one metadata column fits.

## States

- Loading uses table-shaped skeleton rows inside the same card surface.
- The initial empty state appears inside the table surface and relies on the header's single `Create customer` button.
- A search with no matches keeps the search field visible and shows a compact no-results state.
- Errors use the same surface with a retry action.

## Scope

- Keep existing customer fetching, pagination, realtime updates, search debounce, creation dialog, and detail routes unchanged.
- Do not change dashboard navigation, customer APIs, or customer data models.

## Verification

- Verify empty, loading, error, populated, search, pagination, keyboard focus, and responsive layouts.
- Compare the final page against Dashboard and Knowledge in Chrome.
- Run TypeScript, focused lint, production build, and `git diff --check`.
