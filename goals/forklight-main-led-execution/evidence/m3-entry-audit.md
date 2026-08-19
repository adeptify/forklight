# M3 entry audit — natural routing and policy evidence

Date: 2026-08-16 (Asia/Shanghai)

## Boundary and preflight

一骏 explicitly confirmed entry into M3. The long-term Goal remains active at 2/5 graduated
Milestones. A current direct Grok 4.6 Xhigh smoke returned `M3_GROK_46_XHIGH_OK`. The baseline build
changed only the local generated build identity, so Main restarted the idle Daemon once; the client
and Daemon then share build identity `243478d8...`. `forklight health --json` is `ok`; saved Profile
`grok-4-6-xhigh` resolves xAI/Grok 4.6/grok-build/xhigh and wrapper-free `native-goal`. Existing dirty
source work is preserved; no reset, overwrite, commit or push occurred.

Main and two fresh-context read-only auditors inspected only the M3 call chain: Task/Attempt/Event,
exact failure attribution, statistics, model routing, Profile/readiness/execution-mode resolution,
Task routing decision, Competition, Review Graph and Daemon/CLI/MCP projections. No Provider Task,
Competition, Review Graph or Store mutation was created during the audit.

## Baseline verification

Commands:

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/model-routing.test.ts tests/statistics.test.ts tests/main-failure-attribution.test.ts tests/worker-readiness.test.ts tests/competition.test.ts tests/review-graph.test.ts tests/task.test.ts tests/task-preview.test.ts
```

Result: build passed; 443/443 focused tests passed.

## Durable coverage

The read-only `routing_evidence_coverage` projection reports:

| fact | count |
| --- | ---: |
| eligible terminal ordinary Tasks | 313 |
| with taskClass | 313 |
| with taskFamily | 266 |
| complete frozen routing decision | 81 |
| distinct taskClass | 277 |
| distinct taskFamily | 49 |
| single-Worker decisions | 20 |
| comparable multi-Worker decisions | 2 |
| comparable exact-class decisions | 0 |
| comparable task-family decisions | 2 |
| unknown-scope multi-Worker decisions | 59 |
| unusable decisions | 0 |

The 59 unknown-scope decisions are not retroactively upgraded. Current history is used honestly;
no rerun will be manufactured to improve ranking.

## Representative natural families

All calls were read-only and used a new exact taskClass plus explicit existing taskFamily, proving
family fallback without mutating history.

| task family | candidates | result | evidence |
| --- | --- | --- | --- |
| `forklight-storage-lifecycle` | Grok 4.6 Xhigh, DeepSeek Pro | recommends DeepSeek Pro | family scope; confidence `0.909090...`; all candidates compared; Competition false |
| `worker-runtime` | DeepSeek Flash, Grok 4.5, Codex Luna Max | cannot determine | family scope; three identities; top score tied and gap below threshold; Competition false |
| `hub-product-comprehension` | DeepSeek Flash, Grok 4.5 | cannot determine | family scope; both have sufficient samples but score gap below threshold; Competition false |
| unseen family | Grok 4.6 Xhigh, DeepSeek Pro | cannot determine | scope none; both insufficient; no active factors; Competition false |

The Hub-named family is historical evidence only. No Hub/UI implementation or new Hub Task is
allowed before M5.

## Existing truth and real gaps

Reusable truth:

- exact taskClass evidence wins; explicit taskFamily is complete-set fallback;
- provider/model/Runtime/effort identities remain distinct;
- exact Main failure attribution isolates model-quality, non-model and ambiguous failures;
- missing evidence and insufficient gap return unknown without automatic Competition;
- Competition intent is explicit and Review Graph opinions never vote away Main authority;
- Task admission binds the selected frozen Worker to the actual Task identity.

M3 gaps:

1. The recommendation object drops Runtime, effort, resolved execution mode and current readiness,
   so it is not a complete executable recommendation.
2. The durable Task decision cannot show whether Main followed or overrode one exact advisory.
3. Statistics merge different execution modes under one Worker identity.
4. Competition candidate cloning may inherit the source Task's execution mode instead of resolving
   the candidate Profile's mode, which would pollute future strategy history.
5. Natural Competition/Judge history has no bounded read-only policy explanation. It must remain
   explicit Main policy, not become automatic work.

## Accepted work and order

- M3-A: `specs/m3-a-executable-routing-advice/spec.md`.
- M3-B: `specs/m3-b-durable-routing-override/spec.md`, depends on M3-A.
- M3-C: `specs/m3-c-strategy-policy-learning/spec.md`.
- M3-C1: `specs/m3-c-strategy-policy-learning/work-items/competition-execution-truth/spec.md`.

Wave 1 is M3-A plus M3-C1. C1 owns only `src/core/competition.ts` and
`tests/competition.test.ts`; neither path is writable by M3-A, and each has an independent focused
test surface. Workers use isolated ForkLight Workspaces; Main integrates serially. M3-B and M3-C2
remain serial because they share Task/statistics/routing/Daemon/CLI/MCP paths.

Wave 1 launch evidence:

- M3-A Task `293724e0-5873-4bb1-9eef-3d685cf56bcf`, Session
  `3696733d-e512-4322-8c35-fd6b22bc11dd`;
- M3-C1 Task `4112a313-566b-4d24-988f-e1bfb2c57735`, Session
  `35d0e839-8db4-4110-8101-50815589efd6`.

Both Task files passed quality 100, safe Integration feasibility and Workspace boundary
`clear/7 covered/0 visible`. Both resolve Grok 4.6 Xhigh `native-goal`, have no duration, Token or
no-progress ceiling, and freeze scope-none/user-specified routing truth without a fake
recommendation or Competition.

No checksum, content hash, lock, lease, handshake, migration, multi-user/distributed mechanism,
synthetic rerun, global model ranking, automatic Competition/Judge, Hub/UI, commit, push or reset is
authorized.
