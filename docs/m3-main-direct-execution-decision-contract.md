# M3 Main 直做决定记录合同

## 用户结果

ForkLight 不只记录“Main 把任务派给了哪个 Worker”，也能记录“Main 判断这次不值得启动 Worker，决定自己直接做”。
用户在 Hub 能看到：为什么没有派 Worker、Main 是否已经做完、独立检查是否通过，以及这条记录不会冒充模型能力样本。

这解决一个实际盲区：今天的 CLI 假待办是一个边界清楚、约十分钟可修复的问题。Main 直接处理比再启动一个可能消耗数百万
Tokens 的 Worker 更合理，但现有 M3 统计只能靠 dogfood 文档记住这次判断，无法形成结构化长期证据。

## 两阶段记录

### 1. 开始前

Main 显式创建一条 `main-direct` execution decision。输入只允许：

- 明确的 `taskClass` 与 `taskFamily`；
- 为什么直做的结构化原因：`small-clear-change`、`urgent-fix`、`workers-unavailable`、
  `user-requested` 或 `main-judgment`；
- 一段有长度限制的白话说明；
- 0–4 个 Main 真正考虑过的 Worker Profile ID。

Daemon 在同一时刻解析这些 Profile 的冻结身份和 readiness，并只读生成当前 exact/family evidence scope 与样本数。
Profile 不可用可以被记录，但不会因此启动探测或 Provider 请求。没有考虑 Worker 时保持空集合，不编造 shortlist。

记录创建后不可改写，状态为 `open`。它不创建 Task、Attempt、Candidate、Workspace、Goal 或 Competition，不调用 Worker，
也不自动修改路由设置。

### 2. 完成后

Main 对同一记录显式关闭为：

- `completed`：直做工作完成；
- `abandoned`：Main 没有继续完成。

若为 completed，同时记录本地验收结果 `passed`、`failed` 或 `unavailable`。这只是 Main 对本地结果的有界事实，
不保存命令、输出、Prompt、Diff、路径或错误原文。关闭操作必须确认、幂等且不可重写；进程中断时保持 open，绝不自动猜完成。

## 生产与消费

| 模块 | 生产 | 消费 | 边界 |
| --- | --- | --- | --- |
| Store / Core | 不可变开始记录与一次性关闭结果 | CLI、MCP、Daemon、统计 | 独立于 Task；无 Provider、Workspace 或 Git 副作用 |
| Worker Profile / Routing | 创建时冻结的考虑对象与只读 evidence snapshot | 决定详情、聚合统计 | 不推荐、不启动、不探测；缺证据就是 none |
| CLI / MCP | start、complete、status、list | Main Runtime | 所有 mutation 显式 confirm；不接收自由形状 JSON |
| Statistics | open/completed/abandoned、verification 三态、原因分布 | Hub Insights | 不并入 Worker 成功率、路由 recommendation 或 30–50 Worker Task 样本 |
| Hub | 人话摘要和最近记录 | 用户 | 先说发生了什么与原因；内部 ID/时间作为次要证据 |

## 调用链

```text
Main 判断任务边界清楚、自己直做更划算
  -> 显式 start main-direct decision
  -> Store 冻结 task class/family、原因、考虑过的 Worker 与当时证据
  -> Main 在原项目完成有界工作并独立验证
  -> 显式 complete 为 completed/abandoned + verification 三态
  -> CLI/MCP/Hub/Insights 读取同一份记录
  -> 后续 M3 学习“什么时候不该委派”，但不把它算成某模型的成功或失败
```

## 关键场景

1. Main 考虑 DeepSeek 与 GLM，但 exact/family 都无可比证据；因修改小且根因明确选择 direct，记录 scope none，零 Worker 启动。
2. Main 开始后宿主退出；记录保持 open，Hub 说明还没有完成结论，不自动重试或关闭。
3. Main 完成并通过本地验收；记录关闭为 completed/passed，显示 ForkLight Worker Attempts 为 0，但不声称 Main Token 为 0。
4. Main 放弃；关闭为 abandoned，不要求伪造 verification，不计入成功。
5. 同一 complete 请求因网络重放且内容完全一致时返回原结果；不同 outcome 或 verification 的重放被拒绝。
6. 未知 Profile、重复 Profile、超过上限、坏 task class/family、空说明或未 confirm 在任何存储 mutation 前失败。
7. 历史 Main-direct dogfood 文档不回填为结构化记录；新能力只记录真正开始前创建的未来决定。
8. Insights 同时展示 Worker routing readiness 与 Main-direct decisions，但两组分母、标签和解释完全分开。

## 安全和诚实边界

- 不把 Main-direct 记录保存进 TaskSpec，不创建假的 succeeded Task。
- 不并入 Provider/model 成功率、成本、时长、Competition 排名、Worker routing coverage 或 exact-pair Token 结论。
- “ForkLight Worker Attempts = 0”只表示 ForkLight 没有启动外部 Worker；不能推出 Main/Codex Token、时间或总成本为 0。
- 不保存 Prompt、源码、Diff、命令、输出、绝对路径、错误正文、凭据、endpoint 或自由字段。
- 不自动完成、自动推荐、自动调参、自动探测、自动启动 Worker、自动 Competition、自动 retry 或自动 Integration。
- 不改变现有 Task、routingDecision、direct-Codex calibration、statistics 或 Hub Task Detail 的旧行为。

## 验收

1. Core/Store 对 start 与 complete 做关闭词表校验、限长、去重、不可变和幂等保护。
2. 创建一条 main-direct 记录不会增加 Task、Attempt、Worker 事件、Workspace 或 Provider 请求。
3. CLI、MCP 与 Daemon 对同一记录返回一致的 privacy-safe projection。
4. open、completed/passed、completed/failed、completed/unavailable 与 abandoned 都有确定性测试。
5. Hub 中英文先解释“Main 决定直接处理”，再显示原因、状态、验收和“没有 ForkLight Worker Attempt”；不说节省了确定 Token。
6. 聚合统计与现有 Worker routing readiness 分开，旧 Task 统计数字不变。
7. 完整测试、严格 TypeScript、production build、Hub JavaScript syntax 与 diff hygiene 通过。

