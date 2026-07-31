# M3 terminal Task follow-up operation observability contract

## 用户结果

一个 Task 已经显示 `failed` 或 `succeeded` 后，Main 仍可能在本地执行两类后续检查：

1. 复验已经保留的 Candidate，不重新调用 Worker；
2. 验证 Main 对原项目的修复，不重新调用 Worker。

原 Task 的机器结果必须保持不变，但 Board、Task Detail、CLI `status` 与 `wait` 需要明确说明
后续检查仍在进行。这样 Main 不会因为看到旧的失败状态而重复启动复验、修复或 Worker，用户也不会把
“正在本地检查”误解为“Worker 又跑了一次”。

## 生产与消费

### Durable events 与 Core 投影

Core 从已有有序事件识别尚未闭合的后续检查：

- 最近的 `candidate.reverification.started` 晚于最近的
  `candidate.reverification.completed`，表示 Candidate 复验尚无完成记录；
- 最近的 `remediation.check.started` 晚于最近的 `remediation.check.completed`，表示
  Main 修复验收尚无完成记录。

若两种异常地同时保持打开，只展示开始序号更新的一个，不猜测另一个已经结束。投影使用关闭词表，
不读取事件 summary、命令、输出、路径、原因或 Provider 信息。

后续检查打开时：

- `TaskRecord.status`、`finishedAt`、Board lane、失败分类和 Main 决策都不改变；
- canonical `liveStage` 显示正在复验 Candidate 或正在验证 Main 修复；
- `activity` 根据相关 durable evidence 的时间只投影为 `active` 或 `quiet`；
- `quiet` 只表示暂时没有新完成证据，不表示失败、卡死、取消或允许自动重试。

完成事件出现后，投影恢复原 Task 的 terminal stage。若进程崩溃而没有完成事件，界面持续诚实显示
“检查已经开始，但尚无完成记录”，最终由显式人工操作处理。

### CLI 与 MCP wait

`forklight wait --until terminal` 不能只看原 Task 的 terminal status。CLI 本地读取完整事件并使用同一
Core 投影；MCP wait 使用 Decision View 已经生成的同一投影。只有原 Task terminal 且没有打开的后续
检查时才返回 `terminal`。

`--until change` 仍以 status、event sequence、Attempt 与 updatedAt cursor 判断变化；后续检查的事件推进
可以正常唤醒它。等待本身不重试、不恢复、不调用 Provider。

### Hub

Board 保留原来的成功/失败列和主结果 badge，同时增加 active/quiet 活动提示，并优先用白话显示：

- “正在复验保留的 Candidate，不会再次调用 Worker”；或
- “正在本地验证 Main 修复，不会再次调用 Worker”。

Task Detail 的“现在发生什么”使用同一投影，说明原任务结果没有改变，下一步是在等待本地检查结果。
完成后继续展示原来的最终结果和历史证据。

## 边界

- 不修改 Task 状态、Attempt、Main Review、Candidate、remediation disposition 或 Integration 语义。
- 不启动 Worker、Provider、重试、续跑、Goal、Competition 或后台轮询。
- 不把本地检查描述成 Worker 执行，不声称节省了确定 Token，也不生成 ETA 或百分比。
- 不新增数据库字段、事件类型、接口、依赖或第二套状态机。
- 不改变重复操作的 admission、验收命令、超时、Token、文件数、行数或质量策略。
- 不解析自由文本，不暴露命令、输出、Prompt、路径、凭据、endpoint 或失败原文。

## 验收场景

1. failed Task 出现 Candidate 复验 start 后，机器失败事实和 failed lane 不变，但活动投影为
   Candidate 复验；command/verification/revision 事件出现后仍保持该阶段，直到 completion。
2. Candidate 复验 completion 出现后，投影恢复 Task 当前 terminal 结果；复验通过把 failed Task 更新为
   succeeded 的现有行为保持不变。
3. terminal Task 出现 remediation start 后，投影为 Main 本地修复验收；completion 后恢复 terminal。
4. start 后超过 quiet window 仍没有 completion，只显示暂无新证据，不变成失败、不自动重试。
5. 普通 succeeded/failed/interrupted Task 没有打开检查时，现有 terminal 投影完全不变。
6. `wait --until terminal` 遇到打开检查不会立即返回；completion 后返回 terminal；崩溃无 completion 时
   只会按调用者给定 timeout 返回 timeout。
7. Board 的列、主 badge 与 machine result 不变；Board 和 Task Detail 的中英文都明确这是本地后续检查、
   不会再次调用 Worker。
8. latest-only 调用者在没有完整事件证据时保持保守 terminal，不根据单个模糊事件猜测打开检查。

## 调用链

```text
原 Task 得出机器结果
  -> Main 显式启动 Candidate 复验或 Main 修复验收
  -> 既有 durable start event
  -> Core 从完整事件投影打开的后续检查
  -> CLI / MCP wait、Board、Task Detail 消费同一投影
  -> 既有 completion event 闭合检查
  -> 投影恢复原 Task terminal 结果
```
