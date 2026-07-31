# ForkLight M3 Hub Readable Dependency and Lineage Contract

Status: Main-owned implementation contract  
Date: 2026-07-31  
Scope: ForkLight Hub and its safe read projections only. No consumer App writes.

## Product outcome

A person opening a Plan or Task can answer, without reading IDs or event names:

1. Why is this work waiting or able to start?
2. What work came immediately before it?
3. What will it unlock or hand off to next?
4. Is this the original Task, a correction, or a cross-Worker continuation?

This slice does not add another technical graph. It turns existing durable Plan,
dependency, handoff, and Task evidence into a short, truthful story.

## Reading order

Primary copy follows:

```text
current position -> why -> next dependency or handoff -> technical evidence
```

- Prefer Task and milestone names. Raw UUIDs and event codes belong only in a
  keyboard-reachable technical disclosure.
- Use one sentence per relationship. Do not render both a raw dependency list
  and a second human summary at equal visual weight.
- Missing names or legacy evidence stay unknown. Do not invent ancestry or
  imply that a dependency is complete merely because its Task exists.
- English and Chinese framing are written independently. Stored Task names may
  remain in their original language and must be labelled as original content
  when needed.

## Plan Board contract

Each Plan item shows:

- its current stage in plain language;
- when waiting, the named immediate prerequisite and its current result;
- when unblocked, that it can start now;
- when terminal, whether it completed or stopped the chain;
- the named immediate items it unlocks, when any.

The existing five lanes remain. Dependency explanation is not a sixth lane and
does not mutate scheduling. A failed prerequisite must not be presented as
ordinary waiting. More than three relationships are summarized as a count with
the complete bounded list in a disclosure.

## Task Detail lineage contract

Add one compact `Where this Task sits` section to the existing four-part Task
Overview only when durable context exists. It may consume:

- the Plan and Plan item that own the Task;
- immediate named prerequisites and dependents;
- existing cross-Worker handoff source/successor evidence;
- existing bounded Attempt/correction/reverification presentation.

It produces at most four primary facts:

1. `Started as` - original Plan milestone or standalone Task.
2. `Continued from` - named immediate prerequisite or handoff source.
3. `This run` - original Worker run, bounded correction, zero-Worker recheck,
   or cross-Worker continuation, only when existing evidence proves it.
4. `Unlocks next` - named dependent item or handoff successor.

Do not create a new lineage truth source. Do not infer ancestry by timestamp,
similar names, changed files, Provider identity, or free text.

## Safe projection boundary

The server may add optional, bounded fields to existing Hub read models:

- named dependency and dependent references;
- Plan/item context for a Task;
- a privacy-safe relationship role and state;
- optional technical IDs for disclosure only.

Limits:

- at most 20 dependency/dependent references in the API projection;
- names at most 200 visible characters after control-character stripping;
- no prompts, logs, file contents, private workspace paths, secrets, raw event
  payloads, or arbitrary failure output;
- malformed or stale relationships fail closed to `unavailable`.

CLI, MCP, scheduler, Goal, Plan, Task, handoff, correction, verification,
Integration, Provider, routing, and persistence behavior remain unchanged.

## Interaction and visual direction

- Keep the current calm Plan columns and Task Detail hierarchy.
- Use a short relationship sentence and a thin connector or restrained label;
  do not add a node graph, arrows crossing columns, gradients, or animated lines.
- Relationship disclosures are keyboard reachable and preserve visible focus.
- At 390px, Plan lanes may retain their existing horizontal behavior, but each
  item must remain readable without horizontal scrolling inside the card.
- Do not make technical IDs copyable primary content in this slice.

## Scenarios

### Ready item

Given every immediate prerequisite succeeded, the item says it can start now
and names what it will unlock. It does not repeat `satisfied, satisfied`.

### Waiting item

Given one prerequisite is active or queued, the item says it is waiting for the
named prerequisite and describes that prerequisite's current stage.

### Failed chain

Given one prerequisite failed, the dependent item says the chain is blocked by
that named failed work and points Main to the failed Task. It does not recommend
changing Token, duration, or file limits unless evidence says a limit caused it.

### Cross-Worker continuation

Given a durable handoff source and successor, both Task Details name the
relationship and Worker change without calling the successor a retry or
claiming that retained work was accepted.

### Standalone or legacy Task

Given no Plan or handoff relationship exists, the four-part Task Overview stays
unchanged. Missing lineage does not create an empty card.

## Allowed first slice

- Enrich the existing Board/Hub safe read projections with bounded named direct
  dependency, dependent, and Task-to-Plan context.
- Replace raw Plan dependency-state strings with readable bilingual position,
  reason, and next-step copy.
- Add the conditional Task Detail `Where this Task sits` section using only
  durable existing evidence.
- Add focused model, server, and UI behavior tests for ready, waiting, failed,
  handoff, standalone, malformed, bilingual, and bounded-list cases.

## Out of scope

- Archive/delete/move mutations, new persistence tables, schema migrations, or
  automatic cleanup of completed Plans and Tasks.
- Scheduler, dependency, handoff, correction, retry, Goal, Main-review,
  Integration, Provider, routing, economics, or Token calculation changes.
- A general graph visualization, new navigation, new dependencies, broad CSS
  redesign, consumer App writes, commit, or push.

## Acceptance

1. Plan cards explain ready, waiting, blocked-by-failure, completed, and failed
   dependency positions with names rather than raw item IDs.
2. Named direct dependents explain what each item unlocks; more than three are
   summarized without hiding the bounded full list.
3. Task Detail conditionally explains Plan origin and existing handoff lineage;
   standalone Tasks do not gain an empty section.
4. A handoff successor is explicitly a continuation, not a retry; retained work
   is not relabelled as accepted output.
5. All relationships come from durable Store/event evidence and fail closed on
   malformed or missing records.
6. Existing actions, lanes, filters, scheduling, APIs used by CLI/MCP, and the
   four-part Task truth remain unchanged.
7. English and Chinese behavior tests prove independently readable copy and no
   raw UUID/event-code lead text.
8. Focused tests, full project check, build, Hub syntax, and diff hygiene run
   once; unrelated load-sensitive failures are reported rather than looped.

