# M3 routing decision readiness contract

## 用户结果

Insights 不能因为“完整选择记录达到 30 条”就暗示 ForkLight 已经知道哪个 Worker 更好。
用户需要直接看见这批选择当时有多少属于：

1. Main 只考虑了一个 Worker，因此没有发生模型比较；
2. Main 考虑了两个以上 Worker，而且当时已有同范围、可比较的证据；
3. Main 考虑了两个以上 Worker，但证据仍不足，最终选择来自 Main 判断而不是模型排名。

这是一张“选择证据成熟度”说明，不是模型排行榜，也不是新的路由算法。

## 生产与消费

### Core 统计

Core 只读取 terminal ordinary Task 中已经保存的 `taskClass`、`taskFamily` 和不可变
`routingDecision`。对完整选择记录，使用创建时冻结的 shortlist 与
`evidenceSnapshot.scope` 计算以下互斥计数：

- `singleWorkerDecisionCount`：shortlist 只有一个冻结 Worker 身份；
- `comparableMultiWorkerDecisionCount`：shortlist 至少两个，且 scope 为
  `exact-class` 或 `task-family`；
- `unknownMultiWorkerDecisionCount`：shortlist 至少两个，且 scope 为 `none`；
- `unusableDecisionCount`：形状不完整或 scope 无法安全解释，保持不可用而不是猜测。

同时保留 exact 与 family 的可比较子计数，且上述四类之和必须等于
`withCompleteRoutingDecisionCount`。旧 Task 不回填、不推断。

### Daemon 与 Hub

Daemon 继续通过现有只读 `routing_evidence_coverage` 返回这一组聚合事实，不创建新接口、
不调用 Provider、不读取 Worker 日志、不扫描 Candidate，也不改变 Task。

Hub 在现有 Worker 选择证据卡中先解释：

- 完整记录数量只说明“选择过程可追溯”；
- 多 Worker + comparable 才说明当时具备公平比较的证据；
- single Worker 不是失败，只表示 Main 有意避免无价值竞争；
- unknown multi-Worker 不能被展示成模型并列或推荐。

技术细节可说明 exact/family 数量，但默认不展示模型名、Worker Profile、family/class 名、
Main 私有选择理由、分数、Prompt、路径或日志。

## 边界

- 不重算当前 family readiness，不把历史快照冒充今天的最新建议。
- 不改变 routing score、Competition policy、Worker 选择、Task admission、重试、纠正、
  Integration 或任何设置。
- 不把单 Worker 选择描述为证据失败，也不把多 Worker shortlist 描述为已运行 Competition。
- 不新增高频数据库工作；计算只使用 `listTasks()` 已有 Task metadata，不能读取每个 Task 的
  events、attempts、diff 或 Integration history。
- 不把总样本数、机器成功率或全局 Provider 统计作为模型优劣结论。

## 验收场景

1. 一个完整单 Worker 决策只进入 single，不进入 comparable 或 unknown multi-Worker。
2. 两个 Worker、scope `exact-class` 进入 comparable 与 exact 子计数。
3. 两个 Worker、scope `task-family` 进入 comparable 与 family 子计数。
4. 两个 Worker、scope `none` 进入 unknown multi-Worker。
5. 缺少 shortlist/evidence scope 的异常存储形状进入 unusable，不抛出、不猜测。
6. reviewer Task、running Task 和缺少完整 class/family/decision 的旧 Task不进入成熟度分母。
7. 中英文 Hub 明确区分“可追溯记录”“公平比较”“Main 单 Worker判断”和“证据仍未知”。
8. 现有覆盖计数、路由、Competition、economics 与 Hub 其他 Insights 卡保持不变。

## 调用链

```text
Task 创建时冻结 routingDecision
  → Task 结束
  → Statistics 只读聚合 decision-time snapshot
  → Daemon 通过现有 coverage route 返回互斥计数
  → Hub 用白话解释这 30 条记录到底能证明什么
```
