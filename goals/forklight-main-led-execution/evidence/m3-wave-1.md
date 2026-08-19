# M3 Wave 1 — executable advice and Competition execution truth

Date: 2026-08-16 (Asia/Shanghai)

## Delivered Candidates

| slice | Task | exact Revision | changed paths/lines | result |
| --- | --- | --- | ---: | --- |
| M3-C1 | `4112a313-566b-4d24-988f-e1bfb2c57735` | `e2cf75bd-ad83-4721-bf8f-4b4a4cebb793` | 2 / 176 | candidate Profile execution truth frozen before Competition persistence |
| M3-A | `293724e0-5873-4bb1-9eef-3d685cf56bcf` | `c1538142-703e-4994-9869-745cde9739da` | 8 / 982 | one canonical executable routing result with current readiness |

Both Workers used Grok CLI 4.6 Xhigh native Goal in isolated Workspaces. C1 activation interrupted
M3-A Attempt `4387e13c-5391-4796-90cb-1dfc62b4792c`; ForkLight durably resumed the same Task,
Session and Workspace as Attempt `9f1acd29-3179-4d31-b13e-0d7f845ca8ea`. No replacement, fallback,
model switch or Main correction occurred.

## Verification, review and Integration

- C1 digest `f6365dd501356f5bf01d5603bd9f20f8cf556e3cb46f8beb18ec261109d0e166` passed build,
  `tests/competition.test.ts` and `git diff --check`. Review Graph
  `cd1b0459-da68-4a4a-8786-6c253b70f8a7` returned two usable accepts. Main accepted the exact
  Revision; Integration `eac989dd-5a91-4862-8fe3-bc9f0cd4b483` passed source apply, verification,
  build and activation.
- M3-A digest `75ad2645ef41a22ac31364a477915d8ad80be1d72de18d8dd4a726f63dc75525`
  passed build, 187 focused tests and diff validation. Review Graph
  `877dfabf-c95a-498d-b67e-21637c781377` returned two usable accepts after one authorized
  same-DeepSeek-Judge schema-only result repair Task
  `ff46f4ec-20ea-4397-ba1f-5f78e38bb322`; the Candidate was not rerun. Main accepted the exact
  Revision; Integration `f249f15d-44ce-41ee-8fae-84220cdc95f1` passed all four delivery stages.
- Post-Wave source `npm run check` passed 2,984/2,984. Main restarted only the idle Daemon after the
  build regenerated its identity; client and activated Daemon then matched exactly.

## Activated natural-history results

All four commands used new exact task classes plus an explicit family, so they read existing family
history without creating a Task, Competition, Review Graph or Provider run.

| family | result | executable/current truth | confidence/reason |
| --- | --- | --- | --- |
| `forklight-storage-lifecycle` | `recommended` | DeepSeek Pro; `claude-code`; high; single-run; launchable | `0.909090...` |
| `worker-runtime` | `cannot-determine` | all three Profiles expose their own Runtime/effort/mode/readiness | `score-gap-too-small` |
| `hub-product-comprehension` | `cannot-determine` | both Profiles launchable; no substituted winner | `score-gap-too-small` |
| unseen family | `cannot-determine` | both Profiles excluded only from evidence cohort, readiness still explicit | `insufficient-relevant-samples` |

Every response reports Competition intent `none`, `shouldRunCompetition: false`. Historical Hub
labels are only read; no Hub/UI work occurred.

M3-A acceptance 1–8 and M3-C1 acceptance 1–6 pass. M3-B is now dependency-ready. Three bounded
non-blocking observations are recorded under Goal Later rather than promoted into Tasks: absent
internal readiness-map reason projection, future async adapter doctor handling, and generic
reviewer packet size guidance.

The next serial contract is
`execution/m3-wave-2/01-m3-b-durable-routing-override.yaml`. Its launch-time advisory is
`cannot-determine` / `insufficient-relevant-samples`; Task
`f5481469-2d82-4223-972d-2f250470e15f` therefore records the user's Grok preference instead of a
historical recommendation. M3-C2 remains dependency-held.
