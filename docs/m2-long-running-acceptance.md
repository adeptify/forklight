# M2 long-running execution acceptance

> Supporting acceptance evidence, not current project status. The authoritative
> Goal, milestone state, and action items live in [`PROJECT.md`](../PROJECT.md).

Last updated: 2026-07-30

## What M2 gives the user

A Main can align one multi-step outcome, let ForkLight continue across Worker
and daemon interruptions, inspect key milestones, retain useful partial work,
hand a bounded remainder to another Worker, and make the final review and
delivery decision. Unlimited wall time never becomes unlimited retries.

M2 is complete as a product capability. Natural disagreement between two usable
judges remains useful future evidence, but it is not an exit gate and must not be
manufactured by rerunning equivalent work.

## Requirement-by-requirement evidence

| User capability | Authoritative live evidence | Result |
| --- | --- | --- |
| Continue one feature through 4–8 dependent Tasks | `Durable Goal live explicit-recovery proof` completed 4/4. Relay Gmail durable incremental sync completed 5/5 with machine, Main, and Integration milestone gates. | Satisfied |
| Continue after Main/daemon interruption | Goal and Task truth live in the durable Store rather than a Main chat. The four-Task Goal resumed its interrupted foundation after a daemon restart. Handoff successor `9c69323e-af1c-43de-afb5-59129904dadf` recorded `worker.interrupted`, one `handoff-daemon-restart` authorization, then `worker.resumed` and succeeded. A new stateless CLI process still projects the completed Goals from the same Task IDs. | Satisfied |
| Give a retained partial Candidate to a different Worker | Relay source Task `decbae4e-4ac8-48c3-a5d2-78801662ccb4` retained four paths from MiniMax-M3. Handoff `74baeddc-e4dd-43f1-b06e-d4f32a6a6ed4` created one successor `dd837113-bb99-4557-b5ae-c08fc9881549` using Volcengine `glm-5.2[1M]`; the successor succeeded. | Satisfied |
| Avoid whole-task reruns and preserve accepted work | The handoff imported only the four explicitly reusable paths and described five remaining gaps. The source Task remains failed and immutable; the successor is a separate Task. Elsewhere and Relay also used zero-Worker reverification or bounded Main repair when the implementation was already useful. | Satisfied |
| Keep adaptation finite even with no time limit | Relay history froze correction rounds at 3 and review rounds at 2. `Goal finite-idle stop across restart` durably stopped with `no-progress`. `Goal explicit no-new-evidence cap across restart` stopped at exactly two empty advances. Both preserved `maxDurationMs:null` across restart and launched no replacement Worker. | Satisfied |
| Keep Main at alignment, milestone review, correction choice, and final delivery | Goal automatically admitted dependency-ready Tasks and stopped at frozen machine/Main/Integration gates. Main decided what to retain, whether to hand off or repair, reviewed key UI and acceptance evidence, and authorized final delivery. No Worker, judge aggregate, or retry policy made a Main decision or integrated automatically. | Satisfied |

## Evidence identities

- Relay durable Goal: `examples/dogfood/relay-gmail-history-goal.json`, 5/5,
  status `completed`.
- Four-Task restart Goal: `/private/tmp/forklight-goal-live.m4ZT8R/goal-v2.json`,
  4/4, status `completed`.
- Finite idle proof: `examples/dogfood/m2-goal-live-no-progress.json`, status
  `stopped / no-progress` after restart.
- No-new-evidence proof: `examples/dogfood/m2-goal-live-evidence-cap.json`,
  status `stopped / no-new-evidence-cap`, counter 2 after restart.
- Relay cross-Provider handoff: MiniMax source
  `decbae4e-4ac8-48c3-a5d2-78801662ccb4` → GLM successor
  `dd837113-bb99-4557-b5ae-c08fc9881549`.
- Isolated restart handoff: MiniMax source
  `0d829248-7cbc-4f10-83d8-afb3531b31f2` → Grok successor
  `9c69323e-af1c-43de-afb5-59129904dadf`.

## Boundaries that remain true

- Goal duration may be unlimited; correction, review, no-progress, and
  no-new-evidence authority remain finite and visible.
- Handoff is explicit, one-hop, revision-bound, and file-bounded. It is not an
  automatic retry or a hidden change of model.
- Review Graph provides evidence, not votes. Main must record a fresh decision.
- Machine failure, Main repair, exact Candidate Integration, and amended
  acceptance remain different delivery facts.
- Worker Tokens, Main exchange, Provider estimates, and exact-pair savings stay
  separate. M2 does not claim Token savings without an M4 baseline.

## Stage decision

M2 exits on demonstrated user capability, not on collecting every possible
failure shape. The evidence above covers the complete long-running chain, so the
active product milestone moves to **M3 evidence-based model routing**. M1 clean
new-user evidence remains open in parallel; it does not reopen M2.
