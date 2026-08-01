# M3 Integration 测试生命周期证明契约

## 用户结果

ForkLight 的真实 Integration 可以在机器繁忙时继续后台完成；测试不能因为固定的毫秒门槛偶发红灯，也不能在断言失败后先关闭临时 Daemon、让尚未启动或尚未结束的 activation runner 变成孤儿。

本切片只修正测试如何证明现有生产行为，不修改生产协议。测试应跟随同一个 durable operation 到终局，并证明自己创建的 endpoint/home 被清理；不得把 runner PID 加进 CLI、MCP、Hub 或公共 Integration 状态。

## 已确认事实

- 真实 ForkLight Integration `7f2fb427-81c4-43db-b6b1-3ffe41ac4135` 在 55 秒观察窗口后继续后台完成，四阶段最终全部通过；观察超时不是第二次执行的理由。
- 被拦住的 runtime-authority Candidate 在隔离环境 2,211/2,211 通过；两次 Integration 回滚都只剩 detached activation 或 observer 的固定时序断言。
- Task `040d4acc-092d-49f2-8fd3-b5ed3ba759f5` 已停止。它证明 1 秒 PID 轮询和公开 `runnerPid` 是错误方向；一次 Main reverify 后，新 activation 场景通过，但旧 `daemon-cli` 的 1.5–3 秒墙钟断言仍在全量负载下偶发失败。
- `integration status/wait/history` 是否误启动 Daemon 已有更强证据：endpoint、socket、pid/log/home 是否出现；这些事实比墙钟快慢可靠。

## 输入、输出和边界

### 输入

- 测试自己创建的临时 ForkLight home、源码 fixture、Daemon 与 Integration operation。
- 只读 observer 的退出码、错误语义与 exact-home endpoint 事实。
- detached activation 的 durable operation 状态、结果、handoff 清理和 fixture marker。

### 输出

- 测试在关闭临时 Daemon 前等待同一 operation 得到 `completed` 或 `failed`；短观察仍可先返回 `outcome-unknown`。
- 测试断言中途抛出时，`finally` 仍收口该 operation，再关闭 exact-home Daemon，并证明 socket/home 无残留。
- observer 测试通过“没有启动 Daemon、没有 endpoint/log、副作用”为真相，不再把调度器繁忙误判为逻辑失败。
- 已完成 operation 的 wait 通过返回相同 durable result、没有新进程/新事件来证明只读，不依赖 1.5 秒阈值。

### 硬边界

1. 不修改 `src/**` 生产代码、公共类型、daemon protocol、CLI/MCP/Hub 输出或 Settings。
2. 不新增或暴露 runner PID、进程命令、绝对路径、原始日志或测试专用公共 API。
3. 不把固定超时简单放大成更大的“必须够快”；有限等待只能作为测试最终退出上限，正确性必须由 durable 状态和 exact-home 副作用证明。
4. 不加 suite retry、不降低并发、不自动重跑 Integration、不改变 Provider/Worker/路由/Competition。
5. 只清理测试自己创建的 home、endpoint 和已跟踪 Daemon；不扫描进程名，不触碰用户 Daemon。

## 模块行为

### Detached Integration fixture

消费：operation id、临时 home、短观察结果。

生产：一个 terminal Integration view、原有 stage/result 断言、handoff 清理和 finally-safe teardown。

边界：只观察同一 operation；不启动第二个 runner；不在 operation 未收口时关闭 fixture Daemon。

### Observer CLI tests

消费：CLI status/wait/history 的返回和 exact-home lifecycle 证据。

生产：observer 不调用 ensure/start、已完成 wait 不制造新生命周期的确定性证明。

边界：墙钟只允许记录诊断，不作为行为成败条件。

### Exact-home cleanup

消费：测试创建的 home、Daemon 和 socket。

生产：无 endpoint、无 daemon log/新任务副作用、home 可安全移除。

边界：不得信号未跟踪 PID，不得扫描全局临时目录或用户进程。

## 调用链

1. 测试启动 exact-home Daemon，并提交一次 Integration。
2. 5ms 观察可以得到 `outcome-unknown`，但测试保留同一 operation id。
3. 测试通过 bounded observer loop 等待 durable terminal result；循环不启动、不恢复、不替换任何进程。
4. 即使测试体抛出，finally 仍先完成第 3 步，再关闭该 Daemon。
5. observer CLI 测试比较 exact-home 运行前后事实，证明没有启动或额外生命周期，而不是比较机器用时。

## 必须通过的场景

1. activation 快速完成：5ms 先 unknown，之后同一 operation completed，四阶段与 marker 正确。
2. activation 人为延迟：测试不会在 runner 启动前关闭 Daemon，最终仍只得到一个 terminal result。
3. 测试体在 activation 完成前抛出：finally 等待终局，随后 exact-home endpoint 消失，无 late Daemon。
4. activation 命令失败：durable result 为 failed/retained-failure，清理仍完成。
5. fresh-home status/wait/history：全部失败且 endpoint/log/task 数没有变化；机器繁忙不造成假失败。
6. completed wait：立即返回同一 result 且 daemon pid、事件/结果数量不变；不以 1.5 秒判断正确性。
7. focused 场景连续 3 次、相关测试、全量测试、build 与 diff hygiene 全部通过。

## 非目标

- 不重新设计 activation runner、Integration operation 或 Daemon shutdown。
- 不合入此前失败 Candidate 的 `runnerPid` 或 `reachDaemon` 改动。
- 不触碰 Elsewhere、Client-Core、client-app-adeptify、SDK 发布目录或相关消费者/Nexus 文档。
- 不提交，不 push。

