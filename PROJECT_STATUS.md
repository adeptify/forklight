# ForkLight Project Status

Last updated: 2026-07-25 (multi-wave dogfood close-out + engineering cleanup)

## Product boundary

ForkLight is the local execution, safety, and observability layer for bounded
external coding Workers. Main Codex remains accountable for intent, Task
Contract quality, independent review, user authorization, and the decision to
integrate. A Worker never receives arbitrary Shell, web, original-project
write, Git commit, or push authority.

The Console is a read-only decision surface, not a second orchestration brain.

## Current milestone: dogfood engineering close-out complete

Lean core is on `main`. The multi-wave dogfood close-out disposed every
authoritative open engineering item as **fixed**, **already-fixed**,
**external**, **product-vision**, or **ux-session**. There are no uncategorized
dangling defects; shared call chains for progress, quality, summary, budget,
and failure taxonomy each have one implementation.

### Fixed this multi-wave pass

- **FL-D92** MCP `maxBudgetUsd: number | null` via `resolveMaxBudgetUsd`
  (`src/core/budget.ts`); validate reports budget source / runtime flag.
- **FL-D18** DeepSeek Setup variants list Flash + Pro families, not only default.
- **FL-D10** MCP validate returns `integrationFeasibility` (CLI parity).
- **FL-D114** Competition compare labels `evaluationKind`: `stored` vs
  `ephemeral-preview` with an honest note.
- **FL-D15/D16 (terminal)** Auth failures -> distinct summary +
  `failureCategory: authentication` even when envelope subtype is misleading.
- **FL-D83 / FL-D70 / FL-D112** status progress (latest-event activity) and
  placeholder hard/soft split remain in force.
- **FL-D115** failure-taxonomy statistics: `classifyFailure` +
  `failureDistribution` (`src/core/statistics.ts`) rendered as classification
  pill badges in the Console Insights view; success rate no longer compresses
  distinct failure reasons.

### Lean-core already-fixed clusters (R1–R8)

Verification split, change-budget modes, checkpoint, async Integration four
stages, build identity, Main Review binding, delivery lineage, source
affected-path gates, event-aware wait - see dogfood root-cause reconciliation.

### Engineering cleanup pass (2026-07-25)

Audit-driven (repo-wide grep verification) redundancy and boundary cleanup,
all behind the standard gates (759 tests, strict `tsc --noUnusedLocals`,
`git diff --check`):

- Dropped ~20 dead exports (module-local types/helpers with zero importers),
  dead Console/Setup CSS and the orphan `th()` helper, and a redundant
  `failureCategory` spread in `forklight_status`.
- Deduplicated the Worker `terminal` usage fields (4x -> `terminalFields`),
  `expandHome` (task + plan -> `parse-helpers`), the competition `TERMINAL` set
  (-> shared `isTerminalTaskStatus`), and the loopback HTTP layer
  (`MIME` / `SECURITY_HEADERS` / `safeJson` -> `src/server-http.ts`, fixing the
  divergent `safeJson` error string).
- Consistency: daemon `direct_codex_*` handlers use the normalized `params`;
  `forklight_direct_codex_inbox` `structuredContent` uses a named `{ samples }`
  key like every other list tool.
- UI/a11y polish: `prefers-reduced-motion`, `::selection`, thin dark
  scrollbars (Console + Setup). The Console already carried `:focus-visible`
  outlines, transitions, empty/loading states, and responsive breakpoints.
- Stale FL-D status lines (D02/D16/D25/D51/D57/D97/D111/D110/D113/D115)
  synced to the §2 / 2026-07-25 disposition.

## Validation

```bash
npm run check
npx tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters
git diff --check
```

Final acceptance on 2026-07-25: 759/759 tests pass, strict typecheck clean,
`git diff --check` clean.

## External limits (never claimed fixed)

- DeepSeek `deepseek-v4-pro[1m]` official-price catalog identity unsupported;
  Claude-side runtime estimate is not a Provider bill.
- MiniMax official cost often `per-request-usage-required`.
- Provider keychain ready ≠ this model/endpoint probe verified.
- Workers never commit or push.

## Deferred product-vision / session UX (not open engineering bugs)

- FL-D01: open a new Codex session after plugin install for Skill/MCP discovery.
- Config-center rewrite, task tiers, cancel/pause control plane, mid-retry
  live counters, Plan patch-stack, full `plans/p3`/`p4` graphs.
- Mid-flight provider retry *count while still running* without structured
  runtime events remains product/runtime instrumentation - terminal auth
  classification is fixed.

See `forklight-dogfood-log.md` §2 inventory (reclassified) and the
2026-07-25 reconciliation for the full per-item disposition map.
