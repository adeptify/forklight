# M4-E Work Item — fresh preflight binding

## Authorization and user result

一骏于 2026-08-18 明确确认并授权：撤销 final recovery 的
`no-further-replacement` 边界，只创建本次 fresh-preflight 两路径修正 Task。

用户结果不变：`delivery decide --decision accept` 第一次执行时一定基于刚记录的精确
Main accept 创建一份新的 Integration preflight；如果调用在观察或 Integration 期间中断，
完全相同的重入只复用这次 decide 已经建立的 receipt/operation。更早的 granular preflight
不能污染或替代这条链。

## Background and current evidence

Final recovery Task `2d774265-344f-43ea-8f69-79e2624765d3` 的精确 19 路径 Candidate、
ForkLight verification `2986` 和两份 usable Judge accept 都是可复用成果。Main 实际 diff
审查发现 `decideMainDelivery` 在记录 accept 后调用 `findLatestReceipt`，因此会把任意历史
receipt 当成本次 decide 的 receipt。Main 已 reject；该 Task 没有 preflight 或 Integration。

唯一 stop packet 是
`goals/forklight-main-led-execution/evidence/m4-e-fresh-preflight-stop-decision-packet.md`。

## `depends_on`

- 复用 final recovery 的 exact 19-path Candidate 和当前 source base；不重新实现 M4-E。
- M4-A、M4-B、M4-C 已激活；M4-D 的 negative/incomplete truth 保持不变。
- 当前 ForkLight health 必须 build-matched，`grok-4-6-xhigh` 必须真实解析为
  `grok-4.6 / xhigh / native-goal`。
- 本 Work Item 是 M4-E 当前唯一 Writer。fresh worker-runtime pair 继续依赖本修正激活。

## Inputs

- `goals/forklight-main-led-execution/execution/m4-e/retained-candidate.diff`：已验收的精确
  19 路径基础 Candidate。
- 当前 Task 的 ordered events、Main review payload、Integration receipt 和 operation/result；
  这些现有 Store 记录是唯一绑定真相。
- 当前 M4-E Spec、stop packet 和 456 项既有聚焦测试。

## Outputs

- 在 retained Candidate 上只修改 `src/core/main-delivery.ts` 和
  `tests/main-delivery.test.ts`。
- 第一条 exact accept 调用忽略所有早于本次 bound Main review 的 receipt，并创建 fresh
  preflight。
- exact re-entry 只使用 matching Main review 之后为该链建立的首份 receipt，以及引用该
  receipt 的 operation/result；后来的 unrelated receipt 不得替换它。
- 一份通过全部既有命令和新增混合 granular/delivery 回归的 exact 19-path Candidate。

## Minimal design and decisions

1. 在 `decideMainDelivery` 进入时区分“本调用刚记录 Main review”与“已有完全相同的 bound
   Main review”。第一次 accept 无条件运行 fresh preflight；不得查询并复用旧 receipt。
2. 重入从现有 ordered Task events 找到 matching `main-review.completed` 的 sequence，只选择
   该 sequence 之后的第一份 `integration.preflight.completed`。后续 granular receipt 不能把
   这份绑定替换掉。
3. operation 必须引用该 bound receipt；历史 operation/result 不能仅因 Task id 相同而被复用。
4. 一份 bound rejected receipt 在完全相同的重入中继续阻断；不得用自动 retry 掩盖真实
   preflight 失败。bound passing/unconsumed receipt 可启动一次 Integration，bound consumed
   receipt 只观察其已有 operation/result。
5. 只用当前 Store event sequence、receipt id 和 operation 的 receipt id。不得增加实体、
   schema、锁、租约、checksum/content hash、版本握手或重复一致性校验。

这里的 sequence 只解决一个具体错误：防止旧 receipt 被错误 Integration。它不是多人/分布式
协调协议。

## Scenarios and acceptance

1. **Older rejected granular receipt**：Main accept 前已有一份因缺少 accept 而 rejected 的
   granular preflight。第一次 decide/accept 必须创建第二份 fresh passing receipt并完成一次
   Integration；旧 rejection 不阻断。
2. **Older unconsumed receipt**：Main review 之前存在一份 durable unconsumed receipt。第一次
   decide/accept 不复用它；返回的 receipt 必须创建在 bound Main review 之后。
3. **Later unrelated receipt**：bound decide receipt 已存在后，又出现较新的 granular receipt。
   exact re-entry 仍复用原 bound receipt/operation，不按“latest Task receipt”漂移。
4. **Bound rejected receipt**：第一次 decide 创建的 fresh receipt 真实 rejected。exact re-entry
   返回同一 blocker/receipt，不自动再跑 preflight。
5. **Exact timeout re-entry**：通过的 receipt 和 operation 在观察 timeout 后只各有一份；重入
   观察同一 operation 并返回 durable result。
6. revise/reject、stale identity、review gate、source drift、privacy/size、CLI/Daemon/MCP 兼容
   行为保持既有测试真相。

## Allowed paths

### Retained Candidate paths

Candidate 继续包含原 19 路径；operational acceptance 对其中 17 路径逐一执行 retained seed
reverse check，证明它们没有被 Worker 改动。

### Only editable product/test paths

- `src/core/main-delivery.ts`
- `tests/main-delivery.test.ts`

Main 可修改本 Spec、M4-E operational files 和唯一 Goal SSOT。Worker 不写 Goal/Spec/evidence。

## Forbidden paths and non-goals

- 不修改其余 17 个 retained Candidate 路径，不重做 public schema、CLI、Daemon、MCP 或文档。
- 不修改 `src/core/integration.ts`、StateStore schema、receipt schema 或 EventType。
- 不创建新的 delivery persistence entity、caller token、lock/hash/lease/version protocol。
- 不自动重试 preflight、替换 Judge、增加第三位 Judge、切换模型、启动 Competition 或进入 M5。
- 不 commit、push、reset、触碰 remote、Provider credential、Hub/UI 或 storage reclaim。

## Verification commands

```text
node goals/forklight-main-led-execution/execution/m4-e/fresh-preflight-correction.test.mjs --candidate
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx \
  tests/main-delivery.test.ts \
  tests/cli-supervision.test.ts \
  tests/cli-exchange-receipts.test.ts \
  tests/review-graph.test.ts \
  tests/integration.test.ts \
  tests/daemon.test.ts \
  tests/daemon-cli.test.ts \
  tests/mcp.test.ts
git diff --check
```

Local acceptance command safety breaker remains 30 minutes per command. Worker has no absolute
duration, Token or no-progress ceiling。

## Execution, handoff and workspace disposition

- One serial Grok 4.6 Xhigh native `/goal` Writer, one base Attempt, zero extra Attempt,
  validation repair, Main correction/reverify, adaptation, retry, fallback or further replacement。
- ForkLight independently runs all commands. A corrected Revision requires two fresh different-view
  Judges; their proposals are evidence only。Main inspects actual diff and integrates serially only
  after an exact accept and a fresh safe preflight。
- Handoff names the exact Revision/digest, 17 frozen-path proof, changed two paths, new scenario
  results, verification sequence, Judge graph and any remaining blocker。
- Original three M4-E Workspaces and final rejected Revision remain immutable/protected。新 Workspace
  stays protected through review/Main decision/Integration；terminal disposition follows normal
  storage preview，but this Work Item performs no reclaim。
- 任一门失败形成新的 stop packet；不自动创建 replacement。

## Outcome

Delivered and activated on 2026-08-18. Task `3e2740eb-4c4e-4a55-9a80-86c51c35a5b5`, Revision
`fe127fd9-d4c3-42c2-826e-21eea52af2f4`, verification `2646`, two usable Judge accepts, exact Main
accept, fresh receipt `2b0075f8-b7fa-4dd0-b6e4-1b9de1e9b844` and Integration result
`c3879c21-0b57-4b64-be68-3dd666942181` all passed. Post-Integration build plus 3,084/3,084 tests and
matched Daemon confirm activation. Compact evidence:
`goals/forklight-main-led-execution/evidence/m4-e-main-efficient-delivery.md`.
