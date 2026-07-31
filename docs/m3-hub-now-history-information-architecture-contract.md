# ForkLight M3 Hub Now and History Information Architecture Contract

Status: Main-owned implementation contract  
Date: 2026-07-31  
Scope: ForkLight Task Board read model and Hub presentation only

## Product outcome

The Task Board answers two different questions before it shows implementation
detail:

1. `Now` — what still needs Worker, Main, Integration, or recovery attention?
2. `History` — what has reached an end-to-end closed outcome?

This is information organization, not data removal. Search and `All` keep every
loaded record available. No Task is archived, deleted, moved, or assigned a new
machine status.

## Source of truth

Board placement is a canonical Core read projection. It consumes the existing
Task status, Decision Stage, and verified repaired-delivery disposition, and
produces closed privacy-safe codes. Hub translates those codes; it must not
rebuild workflow semantics from status strings.

### `Now`

Keep a Task in `Now` when any work or decision is still open:

- queued, waiting, blocked, preparing, running, or verifying;
- machine verification passed but Main review is pending;
- Main requested a bounded revision;
- Main accepted and Integration is pending or running;
- source was applied but runtime activation is pending;
- Integration failed or the machine Task stopped without a closed Main outcome;
- evidence is unknown or contradictory.

### `History`

Move a Task to `History` only when durable evidence proves a closed outcome:

- Integration delivered or activated the accepted Candidate;
- Main explicitly rejected the Candidate;
- Main independently verified repaired source as delivered, even when the
  original Worker Task status remains failed or interrupted.

Machine `succeeded` alone is never enough for History. Machine `failed` alone is
never a final product outcome. Unknown evidence stays in Now so it is not hidden.

## Read projection

Add optional backward-compatible fields to `SafeTaskSummary`:

- `boardScope`: `now | history`;
- `boardReason`: a closed code describing why, such as active-work,
  awaiting-main, revision-requested, integration-pending, unresolved-failure,
  delivered, activated, repaired-delivered, or main-rejected.

The projection must be pure, deterministic, and privacy-safe. It contains no
review reason, prompt, path, command, error body, event payload, or free text.
Legacy callers that omit Decision evidence fail open to `now`, never History.

## Hub reading order

The board defaults to `Now` and presents:

```text
scope and count -> current stage groups -> search/filter -> task cards
```

- Scope choices are `Now`, `History`, and `All`, with truthful counts.
- `Now` retains the familiar four machine lanes so active execution remains
  scannable, but its heading explains that it also includes Main and Integration
  decisions still waiting.
- `History` uses end-to-end outcome groups rather than machine lanes:
  `Delivered` and `Stopped`. A repaired failed Task belongs to Delivered;
  Main-rejected work belongs to Stopped.
- `All` keeps the existing four machine lanes for technical cross-checking.
- Search and lane/outcome filters compose with the selected scope and clearing
  filters does not switch the chosen scope.
- History is labelled as recent loaded history; the UI must not claim it is an
  exhaustive archive when the server projection is bounded.
- Task Detail remains the place for input, output, failure, correction,
  verification, and Integration evidence. Cards do not duplicate it.

## Human language and visual direction

- Chinese and English are written independently, using ordinary verbs such as
  “等你验收”, “等待合入”, “已经交付”, and “已停止”.
- Avoid “terminal”, “projection”, “decision stage”, “remediation disposition”,
  event names, and raw IDs in primary copy.
- Keep the existing calm visual system. Scope is the strongest board control;
  lane filters are secondary. Do not add gradients, decorative animation, a
  second navigation rail, or dense explanatory cards.
- At 390px the scope control wraps or scrolls as one compact row, Task cards
  remain one readable column, and focus remains visible.

## Scenarios

### Worker passed, Main has not reviewed

The Task is in Now under completed-machine work, and its copy says Main review
is next. It never appears as delivered history.

### Accepted, waiting for Integration

The Task remains in Now and says it is ready to merge. The UI does not imply
that accepted means already delivered.

### Repaired Worker failure

The original machine status may remain failed, but independently verified
repaired delivery places the Task in History / Delivered. The original failure
remains visible in Task Detail.

### Main rejected

The Task is in History / Stopped, with copy that a deliberate Main decision
closed it. It is not presented as a runtime failure or a pending retry.

### Unknown legacy evidence

The Task stays in Now with a neutral “needs review” reason. ForkLight does not
invent a delivery outcome to make the board look tidy.

## Allowed first slice

- Add the canonical Core scope/reason projection and focused truth-table tests.
- Expose only those closed codes through the existing bounded Hub Task API.
- Add Now, History, and All scope controls with counts and composed filtering.
- Render History with Delivered and Stopped outcome groups; keep existing Task
  cards, actions, Detail navigation, themes, and responsive shell.
- Add independent English and Chinese behavior tests and focused layout rules.

## Out of scope

- Archive/delete/move mutations, database migrations, retention policy, infinite
  scroll, pagination, global search, or claiming a complete historical archive.
- Scheduler, Task status, Main review, correction, retry, Integration, Provider,
  routing, Competition, Goal, Plan, economics, or Token calculation changes.
- Task Detail redesign, new dependencies, consumer App writes, commit, or push.

## Acceptance

1. Core truth-table tests prove the exact Now/History boundary, including
   machine success awaiting Main, accepted waiting Integration, delivered,
   activated, integration failure, Main rejection, repaired failure, and unknown.
2. Safe Task summaries and `/api/ops/tasks` expose only closed board scope/reason
   codes and do not expose new private text or paths.
3. Hub defaults to Now, offers Now/History/All counts, and composes scope,
   search, and secondary filters without mutating Task data.
4. History groups repaired/delivered work under Delivered and Main-rejected work
   under Stopped; it never treats raw machine status as the product outcome.
5. Existing machine lanes and Task card/detail actions remain compatible.
6. English and Chinese tests prove plain-language labels, recent-history honesty,
   no raw lifecycle jargon in primary copy, and usable 390px behavior.
7. Focused tests, full project check, build, Hub syntax, and diff hygiene run once;
   unrelated load-sensitive failures are reported rather than looped.
