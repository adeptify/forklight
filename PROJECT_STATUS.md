# ForkLight Project Status

Last updated: 2026-07-25 (multi-wave dogfood close-out)

## Product boundary

ForkLight is the local execution, safety, and observability layer for bounded
external coding Workers. Main Codex remains accountable for intent, Task
Contract quality, independent review, user authorization, and the decision to
integrate. A Worker never receives arbitrary Shell, web, original-project
write, Git commit, or push authority.

The Console is a read-only decision surface, not a second orchestration brain.

## Current milestone: multi-wave dogfood engineering close-out

Lean core is on `main`. Multi-wave dogfood close-out disposed every
authoritative open engineering item as **fixed**, **already-fixed**,
**external**, **product-vision**, or **ux-session**. Shared call chains for
progress, quality, summary, and budget each have one implementation.

### Fixed this multi-wave pass

- **FL-D92** MCP `maxBudgetUsd: number | null` via `resolveMaxBudgetUsd`
  (`src/core/budget.ts`); validate reports budget source / runtime flag.
- **FL-D18** DeepSeek Setup variants list Flash + Pro families, not only default.
- **FL-D10** MCP validate returns `integrationFeasibility` (CLI parity).
- **FL-D114** Competition compare labels `evaluationKind`: `stored` vs
  `ephemeral-preview` with an honest note.
- **FL-D15/D16 (terminal)** Auth failures → distinct summary +
  `failureCategory: authentication` even when envelope subtype is misleading.
- **FL-D83 / FL-D70 / FL-D112** (prior same-day passes) status progress and
  placeholder hard/soft split remain in force.

### Lean-core already-fixed clusters (R1–R8)

Verification split, change-budget modes, checkpoint, async Integration four
stages, build identity, Main Review binding, delivery lineage, source
affected-path gates, event-aware wait — see dogfood root-cause reconciliation.

## Validation

```bash
npm run check
npx tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters
git diff --check
```

## External limits (never claimed fixed)

- DeepSeek `deepseek-v4-pro[1m]` official-price catalog identity unsupported;
  Claude-side runtime estimate is not a Provider bill.
- MiniMax official cost often `per-request-usage-required`.
- Provider keychain ready ≠ this model/endpoint probe verified.
- Workers never commit or push.

## Deferred product-vision / session UX (not open engineering bugs)

- FL-D01: open a new Codex session after plugin install for Skill/MCP discovery.
- Config-center rewrite, task tiers, cancel/pause control plane, mid-retry
  live counters, failure-taxonomy statistics productization, Plan patch-stack,
  full `plans/p3`/`p4` graphs.
- Mid-flight provider retry *count while still running* without structured
  runtime events remains product/runtime instrumentation — terminal auth
  classification is fixed.

See `forklight-dogfood-log.md` §2 inventory (reclassified) and final
reconciliation for the full disposition map.
