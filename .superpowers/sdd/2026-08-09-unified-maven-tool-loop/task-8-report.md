# Task 8 report: configure HTTP-tool audiences and access

## Outcome

The existing **Actions & Tools → Tools** experience now configures each HTTP tool for visitor conversations, private sidechat, or both, and classifies the tool as read or write. The same compact controls are present in custom-tool editing and expanded presets. This task adds no MCP connection, sidechat, approval, or provider-specific UI.

The authenticated Worker boundary remains authoritative: project owners/admins may change policy, members may create with the existing public/read defaults and may continue making allowed non-policy edits, and members cannot change audience or access. Policy arrays are validated before service calls, serialized only by `ToolService`, and returned as parsed API fields rather than storage JSON.

## RED evidence

Production changes followed focused failing tests:

| RED checkpoint | Observed failure before the fix | GREEN implementation |
| --- | --- | --- |
| Route boundary extraction | The route test could not import `./tool-handlers` because the production boundary did not exist. | Added the smallest typed route helper and routed the existing Hono endpoints through it. |
| Custom and preset controls | Corrected UI harness ran two tests and both failed because `Available to visitors`, `Available in sidechat`, and policy state were absent. | Added one reused `ToolPolicyFields` component to both editors. |
| Preset create payload | A preset POST with `headers: null` failed Zod validation before reaching storage. | Accepted the existing nullable preset header shape while retaining bounded string validation for supplied headers. |
| Mobile HTTP row | The 390px regression expected the endpoint group to wrap, but the existing row had no `flex-wrap` and the input had no full-width narrow layout. | Wrapped method/endpoint/timeout on narrow screens and restored the single-row layout at `sm`. |
| Canonical execution fingerprint | The executor test expected the persisted `stored-contract-v1`, but received a parameters-only computed hash. | Centralized the canonical HTTP contract fingerprint and made stale-call authorization use the persisted authoritative value. |
| Member non-policy edit | Focused tests expected status 201 for explicit public/read defaults and 200 for unchanged policy during a member rename; both returned 403. | Permit only exact default/unchanged submissions, then strip member policy fields before persistence; real policy differences still return 403. |

The last member-policy RED command was:

```text
bun test worker/routes/tool-handlers.test.ts --test-name-pattern 'member creation|owner and admin'
0 pass, 2 fail
Expected 201, received 403
Expected 200, received 403
```

After the minimum production change, the same command returned `2 pass, 0 fail`.

## API boundary behavior

- `serializeToolResponse` is shared by list, create, and update. It safely parses parameters and response mapping, returns masked headers, parses `allowedChannels`, and normalizes `access` to `read | write`.
- Malformed legacy audience JSON deterministically fails closed to `[]`; it is never returned as a raw string and does not fail the entire list.
- Create/update run through `createToolSchema`/`updateToolSchema` before any `ToolService` mutation. Empty, duplicate, unknown, and non-array audiences return 400.
- Route helpers pass validated `MavenChannel[]` values to `ToolService`; the service remains the only layer that serializes policy to JSON.
- Owner/admin requests may select public-only, sidechat-only, both, read, or write.
- A member create without policy uses public/read. Explicit public/read is accepted so the existing form can submit defaults; sidechat/write or any other custom policy is rejected.
- A member PATCH may include fields equal to authoritative policy so ordinary edits from the shared form still work, but these fields are removed from the service update. Any actual policy change returns 403.
- Header encryption/masking, tool-count cap, duplicate-name handling, test execution, logs, and project/not-found scoping retain their existing route behavior.
- Creation fingerprints machine name, description, and parameters with the canonical utility. Description/parameter changes replace the fingerprint. Endpoint/header/timeout/enabled/policy-only edits preserve it.
- HTTP execution compares against the persisted full-contract fingerprint, preserving the stale-call guard after the contract scope was widened.

## UI and responsive behavior

- Custom tool create/edit: policy controls sit above the existing HTTP Configuration section and initialize from API values or public/read defaults.
- Presets: the expanded preset area uses the same controls; new presets default to public/read and configured presets initialize from their current policy. Preset saves use the existing PATCH endpoint so policy is preserved or changed intentionally.
- The final enabled audience switch is disabled, and the nearby copy states `At least one audience must stay enabled.` The other row remains a full compact label hit target.
- Access uses the existing compact Select primitive with `Read` and `Write` values.
- At 390px, copy wraps, switches and access remain reachable, and the HTTP method/endpoint/timeout row wraps without horizontal scrolling. Browser measurement after the fix: `clientWidth: 390`, `scrollWidth: 390`.
- Keyboard inspection showed visible focus for both audience switches and the access select.

## Interface-polish review

### Native surface and hierarchy

| Principle | Before | After |
| --- | --- | --- |
| Reuse the product surface language | No policy controls existed in the Tools experience. | Custom tools reuse `rounded-xl bg-muted/20 p-4`; presets stay within their existing expanded muted area, without a new card stack. |
| Preserve typography | Policy state was unavailable. | Labels use the existing 14px medium/semibold scale; supporting copy uses the existing 12px muted scale and `text-pretty`. |
| Avoid ornamental assistant styling | Not applicable. | No gradient, glow, sparkle, badge, banner, divider, or assistant brand treatment was introduced. |

### Interaction, hit area, and responsiveness

| Principle | Before | After |
| --- | --- | --- |
| Minimum practical hit area | No audience inputs existed. | Each audience label row is clickable and at least 40px high; compact native Switch and Select primitives keep their established visual size. |
| Explain constrained controls | An empty audience could only be prevented server-side. | The sole enabled switch is disabled and adjacent muted copy explains why at least one audience must stay enabled. |
| Design narrow layouts deliberately | The existing HTTP endpoint row overflowed at 390px in the visual fixture. | The row wraps at narrow width and returns to its existing desktop alignment at `sm`; measured document width equals viewport width. |
| Visible keyboard state | No new policy controls existed. | Existing primitive focus rings remain visible on switches and the Select trigger. |

### Motion and performance

| Principle | Before | After |
| --- | --- | --- |
| Preserve targeted motion | Existing primitives owned interaction motion. | Controls reuse Switch/Select behavior; no decorative animation or `transition-all` was added. |
| Keep render work local | Not applicable. | Policy state remains local to the current editor/preset row and uses no new global subscription or layout measurement. |

## Verification

| Command | Result |
| --- | --- |
| `bun test worker/services/tool-service.test.ts worker/validation.test.ts worker/routes/tool-handlers.test.ts src/pages/Tools.test.tsx worker/chat-runtime/tools/build-maven-tool-registry.test.ts` | 74 pass, 0 fail, 213 assertions. |
| `bun test worker shared` | 362 pass, 0 fail, 1078 assertions. |
| `bun ./node_modules/typescript/bin/tsc -p tsconfig.worker.json --noEmit` | Exit 0. |
| `bun ./node_modules/typescript/bin/tsc -b` | Exit 0. |
| `bun ./node_modules/eslint/bin/eslint.js <all changed TS/TSX files>` | Exit 0, no findings. |
| `git diff --check` | Exit 0. |
| `bun ./node_modules/vite/bin/vite.js build` | Exit 0; SSR and client builds completed. Wrangler emitted only the sandbox `EPERM` warning for its user log file, and Vite retained the repository's existing large-chunk warning. |
| `bun run build` | Known worktree launcher failure reproduced before scripts: `error loading current directory` / `CouldntReadCurrentDirectory`. Direct TypeScript and Vite binaries above were used as required by the brief. |

## Visual evidence

- Desktop custom tool, both audiences + write: `.superpowers/sdd/2026-08-09-unified-maven-tool-loop/evidence/task-8-desktop.png`
- Desktop expanded preset, same controls: `.superpowers/sdd/2026-08-09-unified-maven-tool-loop/evidence/task-8-preset.png`
- Mobile 390px custom tool after overflow fix: `.superpowers/sdd/2026-08-09-unified-maven-tool-loop/evidence/task-8-mobile.png`

The production Worker dev launcher could not be used in this worktree because Bun failed to read the current directory and Wrangler attempted remote Cloudflare preview bindings. Visual inspection therefore used the brief-authorized narrow frontend-only fixture with mocked Tools and Telegram reads. The fixture was deleted after desktop, preset, mobile, and keyboard inspection; no fixture code remains in production or the commit.

## Self-review, scope expansions, and concerns

Documented narrow expansions beyond the two primary files:

- `worker/routes/tool-handlers.ts` and its test: typed, route-level extraction needed to prove validation, role, serialization, header masking, and service-call behavior without importing the full Worker app.
- `worker/chat-runtime/tools/tool-capability.ts`: one canonical full HTTP contract fingerprint helper; no second hash format.
- `worker/chat-runtime/tools/http-tool-executor.ts` and registry regression test: stale-call execution must compare the persisted full-contract fingerprint produced by this task.
- `worker/validation.ts` and test: preserve the preset's existing `headers: null` create shape.
- `tsconfig.app.json`: exclude new frontend `.test.tsx`/`.spec.tsx` files from the production app compilation, matching the existing TypeScript test exclusions.
- `src/pages/Tools.test.tsx`: focused behavior/accessibility/responsive regression harness.

Self-review confirmed no MCP connection UI, sidechat UI, approval UI, new route/page, deployment, push, new aesthetic, or unrelated feature change. No unresolved Task 8 concern remains. The local preview limitation and non-fatal build warnings are recorded above.

## Fix Round 1 — preserve policy-only edits

This review round is limited to the three official findings: masked credential preservation, authoritative contract-fingerprint preservation, and native keyboard expansion for preset rows.

### Review findings and resolution

| Finding | RED evidence | Resolution |
| --- | --- | --- |
| A configured HTTP Lookup or GitHub preset could submit masked bullets as replacement credentials during a policy-only save. | The corrected UI boundary suite failed because both PATCH bodies contained `headers`; HTTP Lookup also initialized its editable textarea with two masked header lines. | Preset state now tracks explicitly dirty credential fields. Existing policy-only saves omit `headers`; explicit HTTP header or GitHub token replacements still submit normally. HTTP Lookup shows an empty field with `Leave blank to keep the current headers`, so the client never attempts to recover or resubmit a secret. Route regressions prove omitted headers cause no encryption call and preserve the authoritative ciphertext. |
| A full PATCH containing description/parameters identical to the authoritative row replaced an existing fingerprint such as `legacy-v1`. | `bun test worker/routes/tool-handlers.test.ts --test-name-pattern 'full PATCH repeats'` returned 0 pass / 2 fail: both cases expected `legacy-v1` but received newly computed canonical hashes. | The route now canonicalizes and compares the authoritative and candidate HTTP contracts. It writes a new fingerprint only for a semantic description/parameter change. Identical full custom/preset PATCHes and endpoint/header/timeout/enabled/audience/access-only edits preserve the persisted value; real contract edits recompute with the existing canonical utility. |
| Preset expansion depended on a pointer-only clickable container with nested interactive controls. | UI semantics tests could not find a native expander button for either configured or unconfigured presets. | Each preset now has a real `button` with `aria-expanded` and `aria-controls`; enabled and delete controls are sibling actions, never nested inside it. Enter toggles the region and the contained focus ring remains visible. |

### Credential and contract boundary evidence

- Configured HTTP Lookup and GitHub policy-only PATCH requests omit the `headers` key entirely.
- Explicit HTTP header replacement and explicit GitHub token replacement remain supported and are covered at the UI boundary.
- Omitted-header route updates call encryption zero times, leave the authoritative encrypted string unchanged, and return the normal masked response.
- Explicit replacement still encrypts and persists the new credentials.
- Full custom and preset payloads whose parameter objects differ only in key order preserve `legacy-v1`; real description or semantic parameter changes recompute the canonical fingerprint.

### Interface-polish before/after

#### Native semantics, focus, and hit areas

| Before | After |
| --- | --- |
| The whole preset heading was a pointer-clickable non-button container. | A native expander button owns expansion, Enter/Space behavior, `aria-expanded`, and `aria-controls`. |
| Enabled and delete actions lived inside the clickable expansion ancestor. | Enabled and delete are sibling controls, eliminating nested interactive semantics and accidental expansion. |
| The remove affordance used only small icon padding. | The same understated icon treatment now has a 40px target without changing the row’s visual density. |
| Keyboard expansion had no dedicated focus boundary. | The expander uses the existing inset focus-ring language, contained to the actual button rather than the entire action row. |

#### Credential clarity and information hierarchy

| Before | After |
| --- | --- |
| Configured HTTP headers appeared as masked bullets inside an editable textarea. | The field stays empty and the placeholder explains that blank preserves current headers. |
| Policy-only saves serialized masked display values as though they were new secrets. | An explicit dirty/unchanged contract omits unedited credential fields; only deliberate replacement sends credential data. |
| Secret-display state and editable input state were conflated. | The API remains authoritative for stored credentials, while the UI exposes only replacement input and never attempts client-side recovery. |

#### Responsive layout and restrained visual language

| Before | After |
| --- | --- |
| The pointer-only row made expansion and actions one ambiguous interaction zone. | Expansion and row actions are optically aligned but behaviorally distinct, while preserving the existing muted surface, typography, spacing, and chevron. |
| The reviewed markup had no verified narrow-width keyboard state. | At 390×844, the focused native expander and all HTTP controls remain reachable with `clientWidth: 390` and `scrollWidth: 390`. |
| No additional treatment was required for the fix. | No new card stack, divider, gradient, glow, badge, animation, or assistant aesthetic was introduced. |

### Visual QA

- Desktop: configured preset preserves the existing compact row and expanded muted surface; focus remains on the real expander instead of wrapping enabled/delete actions.
- Keyboard: browser inspection changed HTTP Lookup `aria-expanded` from `false` to `true` after Enter.
- Mobile 390×844: `bodyScrollWidth: 390`, `clientWidth: 390`, `scrollWidth: 390`; focused element was the native `BUTTON`, with no horizontal overflow.
- The brief-authorized frontend fixture was removed after inspection. No visual-QA fixture remains in the worktree.

### Fix Round 1 verification

| Command | Result |
| --- | --- |
| `bun test worker/services/tool-service.test.ts worker/validation.test.ts worker/routes/tool-handlers.test.ts src/pages/Tools.test.tsx worker/chat-runtime/tools/build-maven-tool-registry.test.ts` | 85 pass, 0 fail, 252 assertions. |
| `bun test worker shared` | 367 pass, 0 fail, 1098 assertions. |
| `bun ./node_modules/typescript/bin/tsc -p tsconfig.worker.json --noEmit` | Exit 0. |
| `bun ./node_modules/typescript/bin/tsc -b` | Exit 0. |
| `bun ./node_modules/eslint/bin/eslint.js src/pages/Tools.tsx src/pages/Tools.test.tsx worker/routes/tool-handlers.ts worker/routes/tool-handlers.test.ts` | Exit 0, no findings. |
| `git diff --check` | Exit 0. |
| `bun ./node_modules/vite/bin/vite.js build` | Exit 0; SSR and client builds completed. Wrangler emitted only the known sandbox `EPERM` warning for its user log file, and Vite retained the repository's existing large-chunk warning. |

No unresolved Fix Round 1 concern remains. There was no push, deployment, MCP UI, sidechat UI, approval UI, or unrelated behavior change.

## Fix Round 2 — keep preset credentials and controls safe

This review round is limited to the two fresh findings: preserving configured HTTP Lookup credentials after replacement text is cleared, and making the configured preset enabled control named and safely targetable.

### RED evidence and resolution

The focused RED command exercised both UI failures and the authoritative server preservation boundary:

```text
bun test src/pages/Tools.test.tsx worker/routes/tool-handlers.test.ts --test-name-pattern 'replacement text is cleared|named 40px|omitted cleared'
1 pass, 2 fail
Expected the enabled switch name "Enable HTTP Lookup"; received null.
Expected the cleared replacement PATCH to omit headers; received headers: null.
```

The server regression passed during RED because the authenticated route already preserves ciphertext when `headers` is omitted. The required production defect was therefore isolated to preset payload construction; no server behavior was broadened.

- A configured HTTP Lookup now includes `headers` only when the parsed replacement contains at least one non-empty header. Typing a replacement and then clearing it omits the field, matching `Leave blank to keep the current headers`.
- A new/unconfigured HTTP Lookup still sends `headers: null` for an empty create, preserving the existing create contract.
- A non-empty configured replacement still sends the parsed header map and uses the existing encryption boundary.
- The configured preset enabled switch has the contextual accessible name `Enable {preset label}`.
- Its visible `size="sm"` track remains 24×14. A reserved 40×40 wrapper contains a 40×40 pseudo hit target on the actual switch, so the expander and delete targets do not overlap it.

### Interface-polish before/after

#### Credential interaction contract

| Before | After |
| --- | --- |
| Clearing replacement text after typing still serialized `headers: null`, contradicting the blank-field promise and clearing authoritative credentials. | A cleared configured replacement omits `headers`; the route preserves authoritative ciphertext without another encryption call. |
| Dirty state alone decided whether configured HTTP headers were submitted. | Dirty state plus at least one parsed non-empty header is required for replacement; new-preset empty creation retains its existing `headers: null` semantics. |

#### Accessible naming and hit geometry

| Before | After |
| --- | --- |
| The configured preset switch exposed only the generic `switch` role with no accessible name. | The existing primitive now exposes `Enable {preset label}`, giving screen-reader and test users the specific control purpose. |
| The visible 24×14 switch was also its entire pointer target. | A 40×40 reserved wrapper and same-size pseudo target extend the actual switch hit area while leaving its visual track unchanged. |
| Expander, enabled switch, and delete action were visually adjacent without measured target boundaries. | The 40px switch target stays inside its own flex item; its edge resolves to the named switch while the immediately adjacent point resolves to the expander. |

#### Responsive restraint

| Before | After |
| --- | --- |
| The new hit-area requirement had not been verified at the narrow breakpoint. | At 390×844 the row retains its existing typography, spacing, muted surface, small track, and delete treatment with no horizontal overflow. |
| No new visual treatment was needed. | No label text, card, divider, badge, gradient, glow, animation, or second aesthetic was added. |

### Fix Round 2 visual QA

- Browser viewport: 390×844.
- Widths: `bodyScrollWidth: 390`, `clientWidth: 390`, `scrollWidth: 390`.
- Visible switch: 24×14; reserved wrapper: 40×40; computed pseudo target: 40×40.
- The point two pixels inside the reserved edge resolved to role `switch` / name `Enable HTTP Lookup`; the adjacent point outside it resolved to the expanded preset button.
- Keyboard Tab focus landed on role `switch` with accessible name `Enable HTTP Lookup`; the existing focus treatment remained visible without changing row density.
- The brief-authorized fixture was deleted and the temporary Chrome viewport override was reset after inspection.

### Fix Round 2 verification

| Command | Result |
| --- | --- |
| `bun test worker/services/tool-service.test.ts worker/validation.test.ts worker/routes/tool-handlers.test.ts src/pages/Tools.test.tsx worker/chat-runtime/tools/build-maven-tool-registry.test.ts` | 88 pass, 0 fail, 266 assertions. |
| `bun test worker shared` | 368 pass, 0 fail, 1103 assertions. |
| `bun ./node_modules/typescript/bin/tsc -p tsconfig.worker.json --noEmit` | Exit 0. |
| `bun ./node_modules/typescript/bin/tsc -b` | Exit 0. |
| `bun ./node_modules/eslint/bin/eslint.js src/pages/Tools.tsx src/pages/Tools.test.tsx worker/routes/tool-handlers.test.ts` | Exit 0, no findings. |
| `git diff --check` | Exit 0. |
| `bun ./node_modules/vite/bin/vite.js build` | Exit 0; SSR and client builds completed. Wrangler emitted only the known sandbox `EPERM` warning for its user log file, and Vite retained the repository's existing large-chunk warning. |

No unresolved Fix Round 2 concern remains. There was no push, deployment, MCP UI, sidechat UI, approval UI, or unrelated behavior change.
