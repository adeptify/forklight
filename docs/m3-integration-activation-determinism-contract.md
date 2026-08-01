# M3 Integration 后台激活确定性契约

## 用户结果

ForkLight 已接受的候选在进入安全合入时，不能因为测试机器一时繁忙就随机卡在
`outcome-unknown`。后台激活可以合理等待，但必须持续留下可判断的状态；成功时可靠收口，失败时可靠清理，
不能遗留临时 Daemon 干扰后续任务。

这不是把超时数字无限放大，也不是失败后自动重试。一次 Integration 仍然只有一次执行权威；超时只表示当前
观察窗口没有得到终局，不能制造第二个激活进程。

## 已确认的问题

- 同一个已接受 Candidate 在 Worker 隔离环境全量 `2,211/2,211` 通过。
- 第一次 Integration 与另一个全量测试并发时为 `2,209/2,211`；队列清空后只重试一次仍为 `2,210/2,211`。
- 第二次唯一失败是 `tests/integration-operation.test.ts` 的 detached activation 在 10 秒观察窗口内返回
  `outcome-unknown`；该文件不在被合入候选的修改范围内。
- 精确 PID、命令行和 socket 审计发现 13 个长时间存活的测试 Daemon；其 home 来自
  `forklight-hub-cli-json-privacy-*`、`forklight-hub-cli-human-noopen-*` 与 `forklight-restart-stopped-*`，
  不是 activation fixture。它们会持续增加全量测试负载，因此 activation 当前首先是被污染环境中的受害者。
- 第一个 activation 修复候选尝试暴露 runner PID 并移除 `ensureDaemon`，但新增竞态、收窄真实 60 秒启动窗口，
  相关测试和 build 均失败，已被 Main 拒绝；这个方向不得复用。

## 输入、输出和边界

### 输入

- 一条已持久化、仍处于 activation-pending 的 Integration operation。
- 由该 operation 创建的一次性 activation handoff。
- detached activation runner 的进程生命周期、持久化结果与测试独占的临时 home。

### 输出

- 一次后台激活最终只产生一个 durable terminal result。
- 观察超时保持 `outcome-unknown`，但不启动第二个 runner、第二个 Daemon 或第二次 Integration。
- 测试无论通过、断言失败还是 runner 延迟，都在返回前证明自己拥有的临时进程和 endpoint 已结束。

### 不变量

1. 生产流程仍由 operation / task / receipt 三元组授权；环境变量和 PID 不是授权来源。
2. handoff 仍为一次性消费；完成仍由新/现有 Daemon 校验后写入 durable result。
3. 不把“等待更久”当成成功，不把 `outcome-unknown` 改写成 completed。
4. 不扫描进程名、不终止用户 Daemon、不清理不属于测试的 home。
5. 不修改 Provider、Worker、路由、Competition、Task retry、凭据或 Hub 产品语义。

## 模块行为

### 1. Activation runner 生命周期

消费：一次性 handoff、activation commands、activation checks。

生产：一份通过或失败的 runtime-activated evidence，并向正确 Daemon提交一次终局。

边界：不自动重复命令；异常写入有界日志；不得因调用方观察断线而取消。

### 2. Integration operation 观察

消费：durable result 与当前 operation 状态。

生产：running、outcome-unknown 或 terminal view。

边界：只观察，不启动/替换 Daemon；一次客户端超时不改变 operation 权威。

### 3. 测试生命周期

消费：测试自己创建的临时 home、确切 Daemon/runner 身份和 durable operation。

生产：在合理系统负载下稳定证明 detached activation 能完成；失败路径也完成精确清理。

边界：只能操作该 fixture 的 home 与它创建/采用的确切 PID；不能使用 `pkill`、进程名扫描或全局临时目录清理。

## 必须通过的场景

1. activation command 很快完成，但 detached runner 的启动被人为延迟：同一 operation 最终完成，不启动第二个 runner。
2. 5ms 的早期观察返回 `outcome-unknown`；后续有界观察得到 durable completed。
3. 测试断言在 runner 完成前抛出：teardown 等待或收养该 fixture 产生的确切进程并证明 endpoint 消失。
4. runner 或 activation command 失败：保存 failed evidence，不伪造成功，不留下临时 Daemon。
5. 相同 focused 场景连续执行至少 3 次均通过，并且每次结束后没有该轮 fixture-owned 进程/socket。
6. 完整 `npm test`、build 与 diff hygiene 通过。

## 实现选择约束

- 先定位 runner 为什么会超过测试观察窗口，以及失败后为何可能在 teardown 之后继续启动 Daemon。
- 可以引入窄的可观察/清理 seam，或让测试使用已有 exact-ownership fixture；不得把生产执行改成测试专用行为。
- 可以调整测试的等待策略，但“单纯把 10 秒改成更大的固定数字”不能作为唯一修改。等待必须绑定 durable progress
  或精确 runner 生命周期，并有最终清理证明。
- 不要降低全量测试并发来掩盖一个用例，不要给整个 suite 加自动 retry。
- 保留现有 observer 不自启、handoff authorization、single-runner 和 fail-closed 语义。

## 非目标

- 不修改已经验收但尚未合入的 runtime-authority Candidate。
- 不重新设计 Integration、Daemon 或 Hub；不新增通用进程管理系统。
- 不触碰 Elsewhere、Client-Core、client-app-adeptify、SDK 发布目录或相关消费者/Nexus 文档。
- 不提交，不 push。

## 验收

- 新增确定性慢启动、早期超时、失败清理与 single-runner 回归测试。
- detached activation focused 测试连续 3 次通过，测试自己证明无 fixture-owned 残留。
- `tests/integration-operation.test.ts`、相关 activation/daemon 生命周期测试通过。
- 全量测试、TypeScript/build 与 `git diff --check` 通过。
