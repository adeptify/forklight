# M3 Profile Worker 槽释放契约

## 用户结果

同一个 Worker Profile 的模型进程已经退出后，ForkLight 不再因为前一条 Task
仍在执行本地验证而把下一条同 Profile Task 一直留在队列里。下一条 Worker
可以在全局在途任务上限允许时启动；前一条 Task 的验证、Candidate 记录与最终
状态继续独立完成。

这不是提高所有并发，也不是取消本地资源保护。本切片只纠正 Profile 模型名额的
占用语义：模型名额跟随 Worker 进程，Task 生命周期仍由现有全局并发上限约束。

## 输入、输出与边界

### 输入

- Daemon 当前 queued jobs 与完整 active Task 生命周期；
- Task 不可变 `effectivePolicy.profileId` 与 `maxConcurrency`；
- Worker runtime 返回终态这一既有事实；
- 全局 `execution.maxConcurrency` 或测试 override。

### 输出

- Daemon 内部维护一个与完整 active Task 分离的 Profile Worker 占用集合；
- Worker runtime 返回后，该 Task 的 Profile 占用恰好释放一次并立即重新 pump；
- `activeTaskIds` 继续表示仍在准备、运行或验证的完整 Task，不被改写成 Worker PID 列表；
- queued Task 在 Profile 有空位且全局在途 Task 尚未到上限时可启动。

### 保留的硬边界

- 全局并发仍按完整 `active` Task 数量限制。本切片不允许在已有 N 条本地验证时
  再无限启动 Worker，也不新增 verification concurrency 设置。
- workspace preparation 与 Worker 启动前检查仍占用 Profile 名额，避免同一 Profile
  同时穿透已有启动门禁。
- Task 只有在完整执行 Promise 结束后才离开 `activeTaskIds`；Daemon shutdown、Goal、
  Competition、Review Graph 与恢复逻辑继续等待真实终态。
- Worker 失败、doctor 失败、认证失败、准备失败或异常退出不得泄漏 Profile 名额。
- 不新增 retry、resume、adaptation、Competition、Provider probe、timeout 或后台轮询。

## 模块行为与调用链

### Daemon scheduler

- 消费全局在途上限、Profile 上限、队列和两个不同集合：完整 active Task 与当前
  Worker Profile 占用。
- 选择任务时，全局门继续看完整 active Task 数；Profile 门只看 Worker 占用集合。
- 启动一个 queued job 时先登记 Profile 占用；任何未进入/未完成 Worker 的异常路径
  在 job finally 中兜底释放。

### Attempt runner release hook

- 在选定 runtime 的 `run()` 已返回、duration/interrupt forwarding 已清理后通知
  Coordinator：模型进程不再占用 Profile 名额。
- 通知发生在独立 verification 之前；通知本身不得改变 Worker、verification 或 Task
  成败，也不得被普通直跑调用者要求提供。
- Coordinator 收到通知后幂等删除该 Task 的 Worker 占用并重新 pump。

### Existing lifecycle

- 新 Task 可以启动后，旧 Task 继续进入 `verifying`、生成 patch、记录 CandidateRevision
  并最终 succeeded/failed。
- 原 job 的 Promise 仍留在完整 active 集合；结束时再次兜底释放是幂等操作，然后
  执行既有 Goal/Plan/Competition/Review Graph reconciliation。

## 必须通过的场景

1. 全局上限 2、同 Profile 上限 1：Task A Worker 返回但验证被 gate 暂停时，Task B
   同 Profile 从队列启动；A、B 同时仍在 `activeTaskIds`。
2. 全局上限 1：即使 A Worker 已返回并验证暂停，B 仍不能启动，证明本切片没有绕过
   全局本地资源上限。
3. 两个不同 Profile：原有选择与公平扫描保持，不因新集合回退为只看队首。
4. Worker runtime 失败或 doctor 抛错：Profile 名额释放，后续 queued Task 不被永久阻塞。
5. workspace preparation / authentication 在 Worker 前失败：job finally 释放名额，不创建
   伪 Worker 成功或重试。
6. 直接调用 `executeAttempt`、`resumeTask`、`correctTask` 的既有调用方省略 hook 时行为兼容。
7. shutdown 与 health：验证中的 Task 仍属于 active；完整结束后 active 与 queued 都清空。

## 非目标

- 不把 global `maxConcurrency` 改成 Worker-only；不增加第二个 UI 配置项。
- 不并行化单条 Task 内的 acceptance commands，不修改 verifier、patch、Candidate 或 Integration。
- 不增加公开 Worker-slot API、Hub 卡片或新的 Task 状态。
- 不修改外部项目、SDK/消费者目录、凭据、Daemon 端口、commit 或 push。

## 验收

- 调度测试使用可控 Worker 与 verification gate 证明上述 Profile/global 两层语义，不依赖
  墙钟猜测或长时间 sleep。
- Worker/doctor/准备失败均有无泄漏回归。
- focused daemon/runner tests、全量 `npm test`、`npm run build` 与 `git diff --check` 通过。
