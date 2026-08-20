# M5-B supplement — Main-only Worker assignment guidance

## User result

A user can write a short instruction for each saved Worker describing the work it is suited for,
when Main should prefer it and any assignment caveat. ForkLight Main reads those instructions
before choosing a Worker and records the actual selection reason. The instruction is never sent to
the Worker as part of its execution prompt.

## Background and current evidence

ForkLight already makes Main authority explicit:

- a Task selects an exact saved `workerProfileId`;
- that profile resolves the Runtime, Provider, model, effort and execution policy;
- `routingDecision.shortlist`, `selectedWorker` and `selectedBecause` freeze Main's actual judgment;
- optional `forklight_model_routing` evidence advises between an already chosen shortlist but does
  not list profiles or choose work automatically.

The saved Worker Profile has no user-authored assignment guidance, and the MCP Main has no compact
read-only catalog to inspect before constructing its shortlist. Setup CLI and Hub can list/edit the
same profiles, so no new persistence entity or routing engine is needed.

## `depends_on`

- Graduated M3 Main-authoritative routing decision and current saved Worker Profile contracts.
- Graduated M5-A1 CLI/MCP setup surface and M5-B human-first Hub System area.
- Current `settings.workerProfiles` remains the only durable source; `routingDecision` remains the
  only historical selection record.

## Inputs

- One optional user-authored `assignmentGuidance` string on each Worker Profile.
- Current saved Worker identities, default profile, model catalog and Runtime/model readiness.
- The Task contract, user Provider preference and optional historical routing advisory available to
  Main at selection time.

## Outputs

- Backward-compatible Worker Profile persistence with trimmed optional guidance bounded to 1,200
  characters; blank input removes the guidance.
- A read-only `forklight_worker_catalog` MCP tool and setup-list projection showing exact saved
  Worker identity, default status and optional guidance before Main chooses.
- Main installation guidance that requires consideration of user guidance alongside task fit and
  current readiness, records the final reason, and prohibits forwarding the text to the Worker.
- A bilingual Hub Worker editor using human copy, plus a compact saved-row summary.

## Behavior and decisions

1. `assignmentGuidance` is advisory input to Main, not executable policy. It cannot force an
   unavailable Worker, override explicit user selection, authorize Competition, weaken acceptance
   or bypass Main's final judgment.
2. ForkLight does not automatically rank or select from the text. Main reads the catalog, forms the
   genuinely considered shortlist, optionally consults existing routing evidence, then submits the
   same explicit `workerProfileId` and `routingDecision` used today.
3. The guidance is never added to `ResolvedWorkerSelection`, Task contract context, Worker runtime
   arguments, generated Worker prompt, Attempt, Candidate or historical Task projection. A later
   profile edit cannot rewrite the frozen `selectedBecause.note` on past Tasks.
4. The Hub calls it “什么时候把任务交给它” / “When Main should choose this Worker”, and explains
   that only Main sees it for selection. The primary Worker row shows the saved purpose without
   exposing another raw configuration field.
5. Existing profiles with no field remain valid and behave exactly as before. No migration or
   schema-version handshake is added.

## Modules and call chain

1. Hub or settings input passes through `validateWorkerProfile`, which normalizes and persists the
   optional bounded string in the existing Worker Profile.
2. Hub status and setup service read the same profile. The Hub edits it; setup CLI can display it.
3. `forklight_worker_catalog` reads `settings_get`, resolves only safe Worker identity fields and
   returns guidance to Main without a Provider call or Store mutation.
4. The installed ForkLight Main skill directs Main to read the catalog, consider task fit,
   guidance, user preference and readiness, then freeze its actual `selectedBecause` reason.
5. Existing submit/resolve/runtime paths consume only the selected identity and execution fields;
   guidance terminates at Main's selection boundary.

## Orthogonality and execution order

This is one cross-layer vertical slice. Core profile validation is consumed by Setup, MCP and Hub;
the plugin contract depends on the exact MCP field, and the UI save path depends on the exact Core
field. Those shared interfaces create real ordering, so the Work Item is serial rather than split
between Writers. Main implements and integrates it directly, consistent with 一骏's current UI
execution direction. Goal SSOT updates remain Main-only and occur after acceptance.

## Allowed paths

- `src/core/worker-profiles.ts`
- `src/setup/types.ts`, `src/setup/service.ts`, `src/cli/setup.ts`
- `src/mcp/server.ts`
- `plugins/forklight/skills/forklight-orchestrator/SKILL.md`
- `src/hub/public/app.js`, `src/hub/public/app.css`, `src/hub/public/i18n.js`
- focused tests in `tests/worker-profiles.test.ts`, `tests/setup-service.test.ts`,
  `tests/cli-setup.test.ts`, `tests/mcp.test.ts`, `tests/main-install-skill.test.ts`,
  `tests/hub-settings.test.ts`, `tests/hub-ui-assets.test.ts` and
  `tests/hub-responsive-layout.test.ts`
- this accepted Spec and the existing ForkLight Goal SSOT/evidence directory

## Forbidden paths and non-goals

- Worker runtime prompt builders, Runtime adapters, Task/Attempt/Candidate schemas, Store event
  schema, routing score algorithm, automatic assignment, automatic Competition or automatic retry.
- A new Worker/Work Item entity, second settings store, profile migration, team roles, shared-editor
  coordination, hash, lock, lease, version handshake or distributed consistency mechanism.
- Provider credentials, paid probes, saved live-Store mutation during browser acceptance, commit,
  push or reset.

## Acceptance

- Guidance persists through create/edit/read; leading/trailing whitespace is trimmed, blank removes
  it, more than 1,200 characters is rejected, and legacy profiles remain valid.
- Resolved Worker selection and generated Task input contain no guidance text.
- The MCP catalog is read-only/closed-world, returns every saved profile with exact safe identity,
  default truth and its optional guidance, and makes no Task, Provider or settings mutation.
- Setup JSON and human list expose the same optional guidance without changing Worker selection.
- The installed Main skill instructs Main to consult the catalog, treat guidance as advisory, never
  forward it, and keep final `routingDecision` identity/reason exact.
- Hub create/edit draft captures, restores, saves and clears the field; current profiles without a
  value show a plain absence state. Chinese and English copy explains the boundary without raw
  “Prompt engineering” vocabulary.
- Desktop and actual narrow Worker layouts contain the textarea and saved summary, retain 44px
  controls, preserve draft across language/route rebuild and introduce no horizontal overflow.
- Existing Worker configuration, readiness, selection, model routing and Task execution tests stay
  passing.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/worker-profiles.test.ts tests/setup-service.test.ts tests/cli-setup.test.ts tests/mcp.test.ts tests/main-install-skill.test.ts tests/hub-settings.test.ts
node --disable-warning=ExperimentalWarning --test --import tsx tests/hub-ui-assets.test.ts tests/hub-responsive-layout.test.ts tests/hub-contract-quality.test.ts tests/hub-settings.test.ts tests/hub-operations.test.ts tests/hub-ops-mutations.test.ts
git diff --check
```

Each acceptance command keeps the existing local 30-minute command safety breaker. This Work Item
has no absolute duration, Token, no-progress or Main-observation deadline.

## Handoff and workspace disposition

Handoff names the durable field, MCP catalog shape, non-injection proof, setup and Hub behavior,
focused/full command results, real browser states and any unrun check. Preserve the shared dirty
worktree and all earlier M2–M5 evidence. This Main-direct slice creates no ForkLight Candidate or
isolated Workspace to reclaim. Do not commit, push or reset.
