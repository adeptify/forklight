# ForkLight M3 Hub Human Information Architecture Contract

Status: Main-owned implementation contract  
Date: 2026-07-30  
Scope: ForkLight Hub only. No changes to any consumer App.

## Product outcome

A person opening the Hub can answer three questions within a few seconds:

1. What happened?
2. Is it normal, or does it need attention?
3. What should I do next?

The Hub keeps its full evidence. This change is not an information-removal pass. It changes reading order and progressive disclosure so ordinary conclusions come before implementation terms.

## Plain-language rule

Every primary surface follows this order:

```text
result -> meaning -> next action -> supporting process -> technical evidence
```

- Use one primary sentence for one fact. Do not repeat the same status in the hero, a seven-step story, a retained-Candidate card, and another conclusion block.
- Write Chinese and English independently. A Provider/model/task name may stay in its original language, but the surrounding explanation must remain readable in the selected locale.
- Internal terms such as Candidate, Attempt, Integration, runtime, receipt, digest, lineage, boundary reduction, and durable event never lead the primary explanation. When shown, explain them or place them in a technical disclosure.
- Worker-authored text and unlocalized task content must be visibly labelled as original content. It must not visually merge with ForkLight's conclusion.
- Missing evidence stays unknown. Do not turn it into zero, success, failure, or a guessed explanation.

## Overview hierarchy

The Overview is an operations home, not a permanent onboarding document.

### First viewport

Show, in order:

1. A compact current-state strip: active Workers, queued work, concurrency, and one overall health sentence.
2. `Needs attention` when any item needs action. Each row states the item, the user-facing cause, and the next action. Do not make the user open Task Detail merely to learn the failure class.
3. Active work: running Tasks, Goals, Plans, or Competitions. Empty categories do not occupy equal visual weight.

### Secondary content

- Setup guidance is prominent only while setup is incomplete. Once ready, collapse it to one `Setup ready` row with a link to settings.
- Source/build/Daemon alignment is prominent only when mismatched or unknown. When current, show one compact healthy row; keep the three-layer proof in a disclosure.
- Self-upgrade streak is a milestone/evidence row, not a permanent large card after its target is satisfied.
- The guided sample is prominent only before the first sample is submitted. Afterward it becomes a compact completed hint or disappears from the operations home.
- Provider probes and Daemon lifecycle controls remain available but sit below operational work or behind a system-status disclosure when healthy.
- Remove the generic four-column `what this page does` story from Overview. The page title and live content already provide that context.

## Task Detail hierarchy

Task Detail is a readable collaboration report, not a database record.

### Hero

The hero contains exactly four primary facts:

- task name;
- one final/current status;
- `What happened` in one evidence-backed sentence;
- `What you should do now` in one evidence-backed sentence.

Do not repeat the same status with a second badge or another adjacent explanation.

### Overview tab

Replace the current seven equal-weight steps with four readable sections:

1. `Main asked` - the Main-authored summary and expected output.
2. `Worker returned` - Worker identity, changed-file count, and a clearly labelled original Worker report preview.
3. `Independent result` - passed/failed checks, the first concrete failure summary when present, and Main's handling.
4. `Final output / next action` - accepted files or retained partial work, delivery state, and the single next action.

Retained Candidate evidence belongs inside `Worker returned` or a disclosure below it. It must not restate the entire outcome as another primary card.

The existing dedicated tabs keep the complete brief, timeline, files, checks, actions, and deep evidence. The Overview does not need to reproduce all of them.

### Input and output truth

- `Main asked` is always visible when a bounded presentation summary exists.
- `Worker returned` distinguishes the Worker's self-report from accepted output.
- `Final output` lists only accepted/delivered files. A rejected Worker file list cannot be relabelled as final output.
- When Main repaired a partial result, explain what was kept, what Main changed, and what was rechecked without claiming a full Worker rerun.

## Failure explanation contract

A verification failure cannot stop at `two checks failed`.

For each failed verification command, the safe Task journey may expose a bounded `failureSummary` produced by the server:

- maximum 240 visible characters;
- derived from the first meaningful stderr line, otherwise stdout;
- strips ANSI control codes, absolute home paths, secret-like values, URLs with credentials/query secrets, and unbounded stack/log noise;
- never exposes API keys, auth headers, prompts, full logs, environment dumps, or raw private source content;
- if no safe line remains, omit the summary and say that detailed evidence is unavailable rather than inventing a cause.

The Task hero and Overview show at most the first safe failure summary plus the readable check label. The Checks tab may show every bounded failed summary. Exact commands, exit codes, and deeper evidence remain under technical disclosure.

The recommended action follows evidence:

- authentication -> fix credentials, then one bounded probe;
- connectivity -> check Daemon network environment, then one bounded smoke test;
- budget/Token -> change limits only when the recorded limit caused the stop;
- contract infeasible -> revise scope or acceptance; do not retry unchanged;
- verification -> correct the specific failing behavior, then rerun the same checks once;
- unknown -> inspect the first failed check; do not recommend changing settings by default.

## Visual and interaction direction

- Keep the existing calm dark navigation and light work surface, but reduce nested card-within-card framing.
- Use whitespace, type weight, thin rules, and restrained state tint for hierarchy. Do not solve hierarchy by adding more badges, icons, gradients, or decorative containers.
- Primary actions use one accent. Destructive and retry actions must not look equivalent.
- Original Worker prose is visually secondary and bounded; it must not dominate the page.
- Technical disclosures are keyboard reachable, have explicit labels, and keep focus visible.
- Motion is limited to tab/detail transitions and state changes. No decorative staggered entrances.
- Preserve light/dark themes and the current responsive shell.

## Implementation boundaries

Allowed first slice:

- `src/hub/server.ts`: add the bounded safe verification failure summary projection.
- `src/hub/public/app.js`: Overview hierarchy and Task Detail Overview composition only.
- `src/hub/public/i18n.js`: independently authored Chinese and English copy for the new hierarchy.
- `src/hub/public/app.css`: hierarchy, spacing, and responsive styling for these surfaces.
- focused Hub tests and fixtures required to prove the contract.

Out of scope for this slice:

- changing Task, Goal, Competition, Worker, Main-review, or Integration semantics;
- changing routing or economics arithmetic;
- changing Provider configuration;
- removing raw evidence from APIs used by CLI/deep audit;
- a full visual redesign of every Hub page;
- writing to Elsewhere or any other consumer App;
- automatic retry, automatic Main decision, or automatic Integration.

## Acceptance

1. Overview first viewport prioritizes live state, attention, and active work; completed setup/version evidence no longer dominates.
2. A failed Task hero names the readable failed check and shows a safe concrete failure summary when evidence exists.
3. Task Detail Overview has four primary sections, not seven repeated status steps.
4. Main input, Worker original output, independent result, and final output remain distinguishable.
5. Successful, failed, repaired, legacy/missing-evidence, running, and queued fixtures remain truthful.
6. Chinese and English fixtures contain no mixed-language ForkLight framing. Original external content is labelled.
7. No raw secrets, full logs, prompts, absolute home paths, or unbounded command output reach the safe Hub projection.
8. Existing complete evidence remains available in dedicated tabs or technical disclosures.
9. Focused Hub tests, full project check, syntax check, and diff hygiene pass.
10. Main visually verifies Overview and successful/failed Task Detail at desktop width, then stops after one batched correction pass.
