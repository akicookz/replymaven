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
