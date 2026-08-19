# M3 routing graduation

Date: 2026-08-17 (Asia/Shanghai)

## Boundary result

M3 is graduated. ForkLight now returns one canonical, read-only routing projection that keeps
historical scoring separate from current launch readiness, freezes Main's actual selection or
override on admitted Tasks, separates execution-mode history, and explains Competition/Judge
history without creating work or changing Main authority.

No synthetic Task, Provider run, Competition, Review Graph or Hub/UI work was created for the
boundary. The final health check reported matched client/Daemon build
`33666e662a22932b109acce4e9ef00bc60335ec244081759cae75b78b82873c3`, no active Tasks and no queued
Tasks.

## Delivered Work Items

| Work Item | Exact delivery | Independent quality chain |
| --- | --- | --- |
| M3-A executable routing advice | Task `293724e0-5873-4bb1-9eef-3d685cf56bcf`; Revision `c1538142-703e-4994-9869-745cde9739da`; Integration `f249f15d-44ce-41ee-8fae-84220cdc95f1` | ForkLight verification, two usable different-view Judges after one authorized same-Judge schema repair, Main accept, four-stage safe Integration |
| M3-C1 Competition execution truth | Task `4112a313-566b-4d24-988f-e1bfb2c57735`; Revision `e2cf75bd-ad83-4721-bf8f-4b4a4cebb793`; Integration `eac989dd-5a91-4862-8fe3-bc9f0cd4b483` | ForkLight verification, two usable different-view Judges, Main accept, four-stage safe Integration |
| M3-B durable routing choice/override | Recovery Task `aa524fdd-1558-4d92-8d5a-ae49f738c9b4`; Revision `72fe6e93-764c-4872-9a49-e5d825fbc775`; Integration `8b45d56a-7b7a-4ff6-9e5e-3223bac0fa87` | Exact 11-path partial reuse, 466/466 focused tests, two fresh usable Judges, Main accept, four-stage safe Integration |
| M3-C2 strategy/policy advice | Replacement Task `68f16585-1fec-447c-8799-4867a4731b0f`; Revision `5d3ee57c-be94-48ee-bdc2-458dcadc302c`; digest `d42635d3a9bba5b142863ae23c34976424558b2b0c72a6e7219d347f3fc65bad`; Integration `a0d07d2d-2261-4036-ba65-da124663567c` | 14 paths/2,223 changed lines, four independent commands, two usable different-view Judges, Main exact-diff accept, four-stage safe Integration |

M3-C2 reused the protected output of original Task `bbec21f9-ae21-4bfd-9cc4-9476aea3f73a` instead of
restarting the implementation. The first recovery Task `588fc40f-afad-448e-8306-e05859166842`
proved only that Grok's Workspace sandbox could not read a sibling Task's absolute baseline. The
final replacement packaged the same exact 14-path seed inside its own Workspace, started fresh
native Goal `847f8b7c-afdd-42ed-be1a-5fdb893614f1`, and closed the seven scoped gaps in one Worker
round. No model switch, third Judge, automatic Competition or scope expansion occurred.

The two M3-C2 Judges were Codex Luna Max Task `c2b8b02c-1ff8-4a88-a5a7-160198922887` and DeepSeek
Pro Task `c4d6660a-fa22-4c6f-aed1-9ef08068aae0` under Review Graph
`8a2ebcf3-675c-496e-8f4a-44c918a9c5fe`; both returned usable accept opinions. Main treated the
Codex Judge's generic reviewer-packet warning as the already-recorded non-blocking Later item,
because the accepted Task contract and actual Candidate used the correct 15-file/2,400-line warning
budget.

## Verification

M3-C2 independent acceptance passed:

```text
node goals/forklight-main-led-execution/execution/m3-wave-3/m3-c2-workspace-local-seed-bootstrap.test.mjs
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/statistics.test.ts tests/model-routing.test.ts tests/competition.test.ts tests/review-graph.test.ts tests/main-failure-attribution.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

The focused suite passed 560/560. At the Milestone boundary, `npm run check` passed 3,022/3,022
with zero failures, cancellations, skips or todos. That command rebuilt the local CLI, so Main
restarted the idle Daemon once; the subsequent health response was `ok` with matched source digest
`f29db348dc3a045e9de7d76933d00f99903cb78c23d66ddfae057e07b13882ba`.

## Natural-history projections

The accepted four read-only queries used the same natural task families as the M3 entry audit:

1. `forklight-storage-lifecycle` returned `recommended` at task-family scope. DeepSeek Pro
   `default` was the complete launchable `single-run` recommendation with confidence
   `0.9090909090909091`; Grok 4.6 Xhigh remained visible as a distinct `native-goal` candidate.
   Strategy history itself truthfully returned `cannot-determine / incomplete-family-coverage`.
   Judge history was explanatory only, and Competition intent `none` produced `not-advised` and
   `createsWork: false`.
2. `worker-runtime` returned `cannot-determine / score-gap-too-small` with DeepSeek Flash and Codex
   Luna tied at score `2.7`. Their `single-run` and `native-goal` identities stayed distinct.
   Strategy history reported incomplete family coverage; Main-direct history was shown separately
   and `comparedAsWorkerEvidence` stayed false.
3. Historical `hub-product-comprehension` records were read without executing Hub work. The result
   remained `cannot-determine / score-gap-too-small`; Judge requirement was not inferred and
   Competition intent `none` created no work.
4. `m3-boundary-unseen-family-20260817` returned evidence scope `none`,
   `cannot-determine / insufficient-relevant-samples`, zero strategy rows, no usable Judge history
   and no Competition.

Two queries in the first concurrent observation exceeded the client request window. Per the Goal
contract this ended only those observations; Main repeated the same read-only inputs serially and
received the results above. No Task was canceled, recreated or rerouted, and the final health
response still had empty active/queued sets.

## Exit mapping and limits

- Three representative natural families have reviewable final projections; one has a supported
  executable recommendation and two retain honest uncertainty.
- The separate unseen-family projection proves missing evidence stays explicit.
- Execution modes are distinct historical identities; legacy missing-mode rows remain visible but
  do not become executable recommendations.
- Competition and Judge projections are explanation only. They do not vote, assign, retry, switch
  Workers or authorize Integration.
- Main's frozen choice/override remains durable Task truth and is not rescored on display.
- No Hub/UI implementation occurred.

Official Grok Worker Token usage for the M3-C2 replacement is unavailable; ForkLight's Runtime
estimate is USD `0.90912668`. This is reported as an estimate, not an official usage record. M3
makes no Main-Token-saving claim: valid same-scope, same-acceptance pair evidence remains the M4
graduation requirement.
