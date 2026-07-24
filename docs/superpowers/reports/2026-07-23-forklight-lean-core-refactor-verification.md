# ForkLight Lean Core 重构验收报告

日期：2026-07-24
基线：`main@0b1d04a`
工作分支：`codex/lean-core-refactor`

## 结论

五个 Wave 已完成，A–L 验收项均有代码、自动化或真实运行证据。
ForkLight 已从“Worker 跑完后给一个 succeeded”收敛为一条可归因、可纠正、
可恢复的交付链：

```text
Contract
  → isolated Worker
  → bounded checkpoint
  → independent verification
  → Main Codex review / revise
  → explicit Integration confirm
  → source applied / verified / built / activated
```

本轮没有新增数据库表，没有给 Worker 开放任意 Shell、Web、原项目写入、
原项目 Git、commit 或 push。

## A–L 验收矩阵

| 项 | 权威证据 | 验收方法 | 结果 | 剩余限制 |
| --- | --- | --- | --- | --- |
| A 先复现再修 | Spec 分组、Dogfood 失败 Events、对应 regression tests | 逐波 focused tests + 完整 check | 通过 | 历史过程以 Git Diff、Event 账本和 Dogfood Log 审计 |
| B 全量回归 | `tests/*.test.ts` | `npm run check` | 723/723 通过 | 只证明当前仓库覆盖的场景 |
| C unused / 精简 / 无新实体 | `tsconfig.json`、引用审计、现有 Store schema | `tsc --noUnusedLocals --noUnusedParameters`；符号检索；schema review | 通过 | 未机械删除稳定公共接口 |
| D 全命令与 remediation | `src/core/verifier.ts`、`src/core/remediation.ts` | 失败首命令后仍执行后续命令的 tests | 通过 | 命令输出继续有界 |
| E Worker claim 归因 | `src/core/task-decision-view.ts` | authority matrix + Console 人工验收 | 通过 | 默认只显示 360 字预览，全文在 deep inspect |
| F 缓存与三类 Diff | `src/workspace/path-policy.ts`、`patch.ts` | nested cache / non-destructive workspace tests | 通过 | `dist` 等可能是业务交付，不默认视为噪音 |
| G Verifier-only Git | `src/workspace/verifier-git.ts` | 无 workspace `.git` 的 `git diff --check` test | 通过 | Worker 仍无 Git/Shell 工具 |
| H 一次性额外 Attempt | `src/core/attempt-authorization.ts` | 满额拒绝、单次授权、预算 `null` 与重复授权 tests | 通过 | 每 Task 最多一次额外授权 |
| I 异步 Integration / identity | `integration-operation.ts`、`build-identity.ts`、daemon protocol | timeout/outcome-unknown tests；真实四阶段激活 | 通过 | 后台失败保留真实 stage，不自动猜测修复 |
| J Console 可读性 | canonical `TaskDecisionView` + Console drawer | in-app browser 检查真实 Task；0 console errors | 通过 | Timeline/Economics 仍是可下钻审计层 |
| K 真实自举 | Task `cce02568-5653-4123-9d8d-e246cfdb28d0` | 3 Attempts、2 checkpoints、review revise/accept、四阶段 Integration | 通过 | 只代表 DeepSeek Pro + 本仓库任务类 |
| L 完整交付 | 本报告、`PROJECT_STATUS.md`、operations、Dogfood log | Diff / secret / status review | 通过 | 外部费用限制明确保留 |

## Spec 分组证据

### 1. 验证闭环

- Verifier 不再首错即停；每条命令独立记录 exit code、timeout、duration
  和有界输出。
- `VerificationResult` 明确区分 `behaviorPassed`、`policyPassed`、
  `sourceCompatible`、source audit 和三类 Patch 证据。
- Resume 使用完整 `RemediationPacket`，不再只读取最后一条命令。
- Checkpoint 只能按 `acceptance-N` 运行合同命令。真实 MCP 初始化为
  `connected`；缺失、命令不全、失败或超时均阻止 Task 伪装成功。

### 2. 工作区与 Diff

- `PathPolicy` 统一快照、context、Diff、Verifier 和 Integration 口径。
- Patch 计算非破坏；Business、Generated、Integration 三类证据并存。
- affected-path source conflict 是 hard fail；unrelated drift 保留审计但不误杀。
- Workspace Context 最多显示 200 个优先路径并保留总量提示。
- Verifier-only Git 位于 Task 私有根目录，不进入 Worker workspace 或 Diff。

### 3. 可控纠正与主审

- 一次性授权只改变一个 Attempt 的上限和预算，不改 Task/global settings。
- Main Review Event 绑定确切 Attempt 和 verification sequence；旧 review
  不再支配新 Attempt。
- Lineage 同时展示 hop churn、combined delivery diff 和 correction attempts。

### 4. Integration、激活与身份

- `integration apply` 立即返回 `operationId`；status/wait/history 使用同一身份。
- stage Events 与最终 `IntegrationResultRecord.id` 复用同一个 operation ID，
  没有 Operation 表。
- wait timeout 为 `outcome-unknown`；socket deadline 覆盖用户请求的等待时间。
- Build 与 activation 命令来自创建时快照的 `delivery`；安全 handoff 为
  0600、一次消费。
- CLI/MCP/daemon 暴露 protocol/package/build identity。状态 mutation 在
  mismatch 时 fail closed；`shutdown` 仅作为替换旧 daemon 的恢复例外。

### 5. 统一决策视图

CLI compact inspect、MCP summary 和 Console 共用纯
`TaskDecisionView`。默认视图直接显示：

- current stage / next action；
- Worker Provider/Model 与明确的 unverified claim；
- checkpoint 和独立 verification；
- Main Codex decision / reason；
- explicit Integration confirm；
- 四阶段 Integration/Activation；
- correction lineage。

Worker 长输出默认限制为 360 字并标记截断，Event 与 deep inspect 不改写。

## 真实 Dogfood

最终任务：`cce02568-5653-4123-9d8d-e246cfdb28d0`

| 阶段 | 真实结果 |
| --- | --- |
| Contract | 100/100，Integration feasibility 通过 |
| Attempt 1 | checkpoint MCP 未连接；独立命令虽绿，Task 仍明确 failed |
| Runtime correction | 修复 sandbox 运行依赖、父路径与 daemon socket 最小权限 |
| Attempt 2 | MCP connected；3/3 checkpoint commands 通过；独立验证通过 |
| Main Review 1 | `revise`：发现 “can invoke” 与 “required” 自相矛盾 |
| Attempt 3 | 改为 “must invoke”；3/3 checkpoint commands 再次通过 |
| Main Review 2 | `accept`，绑定 verification event 68 |
| User gate | preflight + `--confirm` |
| Integration | operation `03c8226b-b8b4-43c8-8712-3fde8147db3d` |
| Activation | source-applied / source-verified / artifact-built / runtime-activated 全绿 |
| Console | 浏览器可直接回答权限与下一步；Worker claim 已压缩；0 console errors |

此外，前两轮真实任务分别验证了跨 operation result 归因和 stale Main
Review 修复。首次激活失败与一次 rolled-back Integration 均保留在历史中，
没有被后来的成功覆盖。

## 删除与替代清单

| 删除/收敛项 | 替代事实链 | 理由 |
| --- | --- | --- |
| CLI 内重复 `taskSummary` 拼装 | `src/core/task-summary.ts` | CLI/MCP 使用同一摘要 |
| `latestVerificationFeedback` 单命令反馈 | `RemediationPacket` | 必须保留全部失败与策略证据 |
| verifier 内重复 Diff measure/source 拼装 | `WorkspacePatchReport` + `PathPolicy` | 避免验证与 Integration 口径分叉 |
| 把 `dist/build/.next` 一律当噪音的硬编码 | 显式 generated path policy | 这些目录可能是真实交付 |
| 首错即停的命令循环 | all-command results | 防止连续追逐局部失败 |
| 旧同步 apply 返回路径 | async operation/status/wait | 前台 timeout 不应伪造失败 |
| 无语义的 import、参数、fixture/helper | 直接删除 | TypeScript unused 与引用审计确认 |
| 约 760 行过期 PROJECT_STATUS 累积叙事 | 当前精简状态页 + 本报告 + Dogfood log | 状态页不再充当历史流水账 |

删除没有触及 Provider、Pricing、Economics、Plan、Competition 的稳定核心。

## 新旧结构边界

旧结构允许多个消费端自行拼结论，并把 `TaskStatus=succeeded` 误当成交付完成。
新结构的边界是：

- Store 仍只持久化既有五类核心记录；
- checkpoint、review、stage progress 使用结构化 Event；
- operation 复用最终 Integration Result ID；
- `TaskDecisionView`、Remediation 与 Lineage 都是读取时派生；
- Console 只消费统一事实，不拥有 mutation 或审批能力。

## 最终命令

```bash
npm run check
# 723 tests, 723 pass, 0 fail

npx tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters
# pass

git diff --check
# pass
```

人工验收还确认：

- active CLI build 与 daemon build identity matched；
- checkpoint MCP 在 macOS sandbox 内可真实连接和执行；
- Console 页面无 JavaScript error；
- 没有 secret 被写入仓库 Diff；
- Worker 未获得 commit 或 push 权限；分支交付由 Main Codex 按用户授权执行。

## 外部限制与仍开放事项

- `deepseek-v4-pro[1m]` 当前官方价格 catalog 不支持精确身份，official cost
  为 `unsupported-model`；Claude-side runtime estimate 不能冒充账单。
- MiniMax aggregate terminal usage 缺请求级 tier 信息，official cost 为
  `per-request-usage-required`。
- Provider cached probe 的历史 failed 状态不会因 Keychain 已配置而自动改写。
- FL-D70 / FL-D112 的自然语言 placeholder 误伤未纳入本次 lean-core Goal；
  已于 2026-07-25 后续迭代关闭（hard sentinel 与 soft wording 拆分）。
  同期关闭 FL-D83 status progress（latest-event activity）。详见
  `PROJECT_STATUS.md` 与 `forklight-dogfood-log.md` 对账节。
- 本次真实 Dogfood 不能外推为所有 Provider、模型、仓库和任务类型均已验证。
