# Main 主导的本地交付手册

一位本地开发者的 CLI 检查单：就绪 → Goal → 同 Task 续跑 → 验证 / Judge → Main 裁决 → 精确 Candidate Integration → 终态空间。
不是路线图或证据日志。选项与旗标见 [operations.md](operations.md)。

不要打开 Store、手删工作区、手打补丁、commit/push，也不依赖 Hub。

## 谁决定什么

| 步骤 | Main | Worker | ForkLight |
| --- | --- | --- | --- |
| 就绪 | 读 health，选用可启动 Profile | — | 报告 build 身份与 Worker 就绪 |
| 提交 | 提交已接受 Goal / Task，记下 ID | — | 持久化 Goal、Plan、Task |
| 执行 | 只观察；不重提、不重路由 | 隔离工作区内研究、实现、自检 | 调度、隔离、独立验收 |
| 中断 | 用原 ID 再观察；需要时重启 daemon | 同一 Task / Session 继续 | `system-daemon-restart` 续跑 |
| 审查 | 按冻结数创建 Judge，自己裁决 | Judge 只读出证 | Review Graph 与决策包 |
| 修正 | 决定修正、交接或停止 | 只修剩余缺口 | 复用已接受路径 |
| 集成 | 对**当前精确 Candidate** preflight 并 `--confirm` apply | — | 异步 apply；观察不重放 |
| 空间 | audit / preview 后确认回收 | — | 保护未决；只回收可再生目录 |

Worker 不写原项目。Main 拥有验收、审查和 Integration 授权。

## 记下这些 ID

`<goal-id>`、`<plan-id>`、`<task-id>`、`<candidate-revision-id>`、Review Graph / `<reviewer-task-id>`、`<receipt-id>`、`<operation-id>`；交接后还有 `<successor-task-id>`（后继，不是重试）。
Grok `native-goal` 绑定该 Task 的同一 Session / Goal；显式 `persistent-session` 只绑定 Session。不要靠聊天记录回忆 ID。

## 观察中断不是失败

`forklight wait` 与 `forklight integration wait` 的超时、断开或传输超时，只结束**这一次观察**。
不表示 Task / Integration 失败，也不授权再提交、`resume`、再 apply、再 reclaim、换模型或开 Competition。
用同一 `<task-id>` 或 `<operation-id>` 再看。daemon 已停则 `forklight daemon start`，不要当成新 apply。

## 1. 就绪

```bash
forklight health --json
```

1. `identityStatus` 为 `matched` 才能改状态。不匹配则重建并 `forklight daemon restart`。
2. 选用 `canLaunch=true` 的 Worker，按打印的 `execution: <preference> -> <resolved>` 记录标签，不要改写。
3. 可启动的 Grok Build（`grok-4-6-xhigh`：`grok-build` / `xai` / `grok-4.6` / `xhigh`）解析为 `native-goal`（Grok CLI `/goal`，同一 Task Session）。显式 `persistent-session` 仍是 `--session-id` 随后 `--resume`。省略字段的旧 Profile 是 `single-run`。Codex CLI 也可冻结 `native-goal`。
4. Grok 不可启动时改用另一条 `canLaunch=true` 的 Profile，并记下真实解析模式。不要对已知缺认证的 Provider 反复 probe。

[Health](operations.md#10-health-check) · [Execution preference](configuration.md#execution-preference) · [Grok Build](main-clients/grok-build.md)

## 2. 提交已接受 Goal

```bash
forklight validate-goal <goal.yaml> --json
forklight submit-goal <goal.yaml>
forklight goal status <goal-id>
```

保留打印的 `goalId`、`planId` 和各 `<task-id>`。只有一份已接受 Task 时用 `forklight validate` / `submit`。不要对仍在跑或可恢复的工作再提交。

[Submit](operations.md#1-submit-a-task) · [Work plans](operations.md#6-work-plans)

## 3. 观察同一 Task；故意重启后继续

```bash
forklight status <task-id>
forklight wait <task-id> --timeout-ms <ms>
forklight inspect <task-id> --summary
```

`--summary` 只给出决策包，不启动动作。`wait` 超时打印 `outcome: timeout`，Task 状态不变。

## 3a. Main 离线分段：派发后结束会话，有新证据再回来

长 Worker / Judge 期间不要把同一个 Codex 会话挂着轮询。现有 `delivery prepare` / `delivery decide` 的 `--timeout-ms` 只结束这一次观察，不会取消、失败或重建同一个 Task / Review Graph。

推荐分段：

1. **派发后停止。** `forklight delivery prepare --task <task-id> ... --timeout-ms <ms> --confirm`。超时或已派发后结束 Main 模型会话。
2. **非模型观察。** 用 `status` / `wait` / Review Graph 状态看持久化事件。不要为了“还在跑”再唤醒模型。
3. **审查再入。** 只有出现新的 Candidate 或 Judge 证据时，才用**同一** `<task-id>`、同一 Reviewer 顺序和同一 reason 再 `delivery prepare`。
4. **精确裁决。** 检查点就绪后再 `delivery decide`，绑定精确 Revision / digest；不要自动 accept。
5. **一次记完全部 Main 段。** 每个恢复过的 Codex 终端会话都是一段。全部提交给：

```bash
forklight main-token capture-episode --task-id <task-id> --comparison-id <id> \
  --role delegated-main --run-ref <episode-ref> --segments '<json-array>' --json
```

`--segments` 是有序数组：每项只有该段的 `runRef` 和完整五计数 `turn.completed`。Core 用现有严格适配器规范化后安全相加，写入**一条**角色样本。不要漏掉更早的派发/审查段来让 pair 更好看。观察超时不是 Task / Worker 失败，也不是节省证明。

[Two-call reviewed delivery](operations.md#3b-two-call-reviewed-delivery)

故意重启（证明续跑，不是重试）：先有可观察进展 → `forklight daemon restart` → 再 health 确认 `matched` → 用**同一个** `<task-id>` 观察。解析为 `native-goal` 时同一 Session / Goal 继续；显式 `persistent-session` 时同一 Session 继续。ForkLight 用 `system-daemon-restart` 授权同 Task 续跑。不要再 `submit`，也不要用 `forklight resume`（那是另一次 Attempt）。

[Monitor](operations.md#2-monitor-progress) · [Recovery](operations.md#recovery) · [Daemon start readiness](operations.md#daemon-start-readiness)

## 4. 验证与 Judge

Worker 自检非权威。Grok 不支持 checkpoint MCP，记 `checkpoint.skipped`。终态以 ForkLight 独立重跑原验收为准。

按 Task 冻结的 `requiredJudges` 建图：`0` 是显式跳过（Main 仍要裁决），普通交付 `1`，核心运行时 / 恢复 / Integration 等 `2`。

```bash
forklight review-graph create <task-id> --reviewer-profile <reviewer-profile-id> --reason "<why>" --confirm
forklight review-graph status <task-id>
```

Judge 是证据，不是投票，也不会自动 accept。Main 自己裁决。旗标、多名 Judge 与自动修复见 [Inspect](operations.md#3-inspect-results)、[Checkpoint](operations.md#checkpoint-worker-self-check)、[Validation repair](operations.md#3a-automatic-validation-repair-same-worker-finite)。

## 5. 接受、修正、交接或停止

```bash
forklight inspect <task-id> --summary
forklight main-review <task-id> --decision accept|revise|reject --reason "<bound reason>" --confirm
```

按证据选一条，不要扩范围：

- **accept** 当前精确 Candidate。
- **同一 Task 修正**：额度未尽则 `forklight correct <task-id> --feedback "<gap>" --confirm`。同一 Task、工作区、Session 保留。
- **一跳交接**：仅 Goal 里程碑，且同 Task 修正额度已尽。`forklight goal handoff <task-id> --revision <candidate-revision-id> --reusable '<json-array>' --gaps '<json-array>' --to-profile <worker-profile-id> --reason "<why>" --confirm`。后继不是重试，仍要重新验收和 Main 审查。独立 `submit` 的 Task 没有这条命令。
- **停止**：两轮有目的修正没有新证据、补丁互补偿、源已漂移、或必须越界。保留已接受路径，记下决策包。需要时 `forklight goal stop <goal-id> --confirm`。

不要整项重做、换模型或开 Competition。复验与其余旗标见 [Reuse a failed candidate](operations.md#4a-reuse-a-failed-candidate-at-the-cheapest-valid-layer)。

## 6. 精确 Candidate Integration

```bash
forklight integration preflight <task-id>
forklight integration apply <task-id> --receipt <receipt-id> --confirm
forklight integration wait <operation-id> --timeout-ms <ms>
```

只观察 `apply` 返回的 `<operation-id>`。`status` / `wait` / `history` 不启动 daemon，也不重放 apply。`wait` 超时可能打印 `outcome-unknown`：这不是失败。阶段、回滚与 `not-applicable` 见 [Review and integrate](operations.md#7-review-and-integrate)。

中断边界：

| 情况 | 做什么 |
| --- | --- |
| `wait` 超时或客户端断开 | 只丢了这次响应。用同一 `<operation-id>` 再 `status` / `wait`。不要再 apply。 |
| daemon 在 durable `source-applied: passed` 后被杀，且 Task **未**声明 build / activation / activation-check | **source-only**：重启后同一 `<operation-id>` 继续隔离源验收，**不第二次 apply**。等到 `applied` / `rolled-back` / `retained-failure`。恢复中再次重启仍不二次 apply。 |
| 声明了 build 或 activation，或阶段 / 源 / 备份无法证明 | 恢复**未实现**。保持 `outcome-unknown`。不要再 apply，不要换新 operation，不要手改源码。 |

source-only 续跑在 daemon 启动恢复时自动发生，没有第二条用户命令。

## 7. 终态空间

先有持久交付证据（Integration `applied`、交接后继已物化、或 Main 已关闭终态注意力）再回收。**active**（执行中）、**评审中**（审查中）、**未解决**（未决）、**reusable-partial**（可复用部分）、以及 **`outcome-unknown`** 的 Task 都保持 **protected**，绝不删除。**`unknown-orphan` 是独立于 protected 的非可回收分类**（unmapped-root / unmapped-process）：它不是"受保护、等待即可"，而是"无法归属、必须先查清"，必须在声称 all-clear 之前先处理它；all-eligible 预览只把 `reclaimable` 列入删除目标，并让 unknown-orphan 赢得唯一的 next action。

```bash
forklight storage audit
forklight storage preview --task <task-id>
forklight storage reclaim --task <task-id> --confirm
```

`audit` / `preview` 只读。reclaim 超时先再 preview，不要再下删除令。分类、拒绝条件与 `retain` 见 [Task storage lifecycle](operations.md#task-storage-lifecycle)。
