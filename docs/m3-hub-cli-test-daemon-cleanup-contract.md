# M3 Hub CLI 测试后台进程清理契约

## 用户结果

ForkLight 的完整验收连续运行时，每个 Hub CLI 测试必须在结束前清理自己启动的 Hub 和 Daemon。一次超时、断言失败
或慢启动不能留下后台进程占用资源，让后面的 Integration 随机失败。

## 已确认的问题

- 进程审计发现并精确停止了 13 个旧测试 Daemon；正式 Daemon 不在目标集合内且保持运行。
- 每个残留进程都通过 PID、`src/daemon/main.ts` 命令和专属 `forklight.sock` 三重确认。
- 残留 home 分别来自 `forklight-hub-cli-json-privacy-*`、`forklight-hub-cli-human-noopen-*` 和
  `forklight-restart-stopped-*`。
- `tests/hub-cli.test.ts` 在 detached Hub 返回后先停 Hub PID，再 best-effort 调用 `stopDaemon`；失败会被吞掉并立刻
  删除 home。如果 Daemon 尚在启动或 shutdown 超时，teardown 就失去确切 owner，迟到进程继续存活。
- 已有 `DetachedDaemonFixture` 能追踪确切 PID、验证 socket 并拒绝不属于自己的 owner，但 Hub CLI 测试尚未完整复用
  这条所有权链。

## 输入、输出和边界

### 输入

- 测试独占的 `mkdtemp` home。
- `restartHubDetached` / CLI 返回的确切 Hub PID。
- 该独占 home endpoint 报告的确切 Daemon PID。
- 已有 exact-owner test fixture 的 tracked/adopted PID 集。

### 输出

- 每个测试 teardown 完成后，Hub PID、Daemon PID 与该 home socket 均不存在。
- cleanup 成功后只删除该 fixture home；失败时明确指出仍存活的确切 owner，不能吞掉。
- 测试超时仍保留失败，不自动重跑 Hub、不降低断言、不触碰用户 Daemon。

### 所有权规则

1. home 必须由当前 test fixture 创建且从未共享。
2. Hub 只能按 CLI/production 返回的确切 PID 停止。
3. Daemon 只有在该独占 home 的 health 报告确切 PID，且能证明由本 fixture 的 Hub 启动链产生时才可收养。
4. endpoint 报告未知或不匹配 owner 时拒绝发送 shutdown/signal；不使用进程名、端口或全局 temp 扫描补救。
5. cleanup 不能吞异常后继续删除 home；必须先证明进程和 socket 已消失。

## 模块行为

### 1. Hub CLI 生命周期 fixture

消费：测试独占 home、CLI 结果中的 Hub PID、endpoint health。

生产：被追踪的 Hub/Daemon owner 集，以及可重复调用的有界 cleanup。

边界：test-only；不改变 Hub 产品返回格式，不暴露 token、nonce、URL 或 home。

### 2. 精确进程清理

消费：确切 Hub PID 与已收养的 Daemon PID。

生产：优雅 shutdown、必要时对仍存活的已追踪 PID发送 TERM、退出与 socket 证明。

边界：不发送 SIGKILL 作为静默成功；如需最后手段必须仍限于已追踪 PID，并等待确认退出，否则测试失败。

### 3. Hub CLI 场景

消费：JSON / human detached restart 的既有调用和最小 startup timeout。

生产：原有隐私与输出断言，加上失败安全的 lifecycle teardown。

边界：不放宽 startup timeout、不改变 CLI/Hub 产品语义、不把清理实现复制成两套。

## 必须通过的场景

1. detached Hub 在 timeout 前 ready：测试结束后 Hub、Daemon 和 socket 全部消失。
2. CLI 在 Hub/Daemon 仍启动时超时返回：teardown 先固定 Hub owner，再收养/停止独占 home 的 Daemon，不留下迟到进程。
3. 测试断言在 CLI 返回后抛出：注册好的 teardown 仍执行并证明零残留。
4. endpoint owner 与 fixture 证据不匹配：拒绝 signal，测试明确失败，不删除 home掩盖证据。
5. JSON 与 human 两条 detached 场景连续执行至少 3 轮，每轮独立清理成功。
6. `hub-cli`、detached-daemon fixture、daemon CLI 生命周期、全量测试和 build 通过。

## 非目标

- 不修改 activation runner、Integration operation、Worker、Provider、路由、Competition、Hub UI 或正式 Daemon 生命周期。
- 不加入全局测试后清扫脚本，不把遗留进程当成可接受结果后再统一杀掉。
- 不扫描/删除其他测试 home，不触碰正式 ForkLight home、SDK、Elsewhere 或其他仓库。
- 不提交，不 push。

## 验收

- test-only fixture 覆盖 ready、late startup、assertion failure、owner mismatch 与 idempotent cleanup。
- Hub CLI JSON/human 场景共用同一 cleanup 路径，不再 best-effort 吞错。
- 三轮 focused stress 全过，且每轮 teardown 自己断言零 owner/socket/home 残留。
- 全量测试、build 与 `git diff --check` 通过。
