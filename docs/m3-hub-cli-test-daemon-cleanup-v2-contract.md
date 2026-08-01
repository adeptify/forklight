# M3 Hub CLI 测试后台进程清理契约 v2

## 用户结果

Hub CLI 的真实进程测试在正常启动完成后，必须准确停止自己创建的 Hub 与 Daemon，并证明 PID、socket、home 均已消失。
启动尚未完成就超时的竞态用可控 seam 验证，不再由全量测试主动制造一个没有 Daemon PID 所有权的后台进程。

## 为什么调整

上一版同时要求真实 CLI 使用 1 秒最小启动超时、又要求 teardown 只从尚未出现的 Daemon endpoint 获取确切 PID。
两者在当前产品接口下不能同时满足。两轮 Candidate 均证明：延长 cleanup 等待只能改变失败时间，不能补出所有权证据。

本版保留真正重要的边界：

- 不更改产品的 startup timeout、返回结构或正式生命周期。
- 真实 CLI 测试使用正常 readiness 窗口；返回后 Hub PID 和 Daemon endpoint owner 都是已知证据。
- timeout / late-start、断言抛错、owner mismatch、幂等清理由 test seam 确定性覆盖。
- teardown 只 signal 已追踪 Hub PID 和已从独占 home endpoint 收养的 Daemon PID。
- 证明进程与 socket 消失后才删除该 fixture home；异常不得吞掉。
- 不使用全局扫描、测试重跑、降低并发或 suite 结束后的统一清扫。

## 调用链

1. 测试先创建独占 fixture home。
2. JSON / human CLI 各启动一次 detached Hub，使用正常 readiness 窗口。
3. CLI 一返回就注册其确切 Hub PID；真实 ready 路径已经存在可查询的 Daemon owner。
4. finally 先停止并证明 Hub 退出，再从该 home endpoint 收养 Daemon PID并停止。
5. fixture 证明两个 PID、socket 与 home 均消失，并把 cleanup 结果交给测试断言。
6. pre-readiness timeout 用 seam 提供确切的事件顺序和 owner，不启动真实后台进程。

## 必须通过

- JSON / human 两条真实 CLI 测试继续验证隐私、`--no-open` 和有限返回，并明确断言 cleanup proof。
- seam 覆盖 late-start、断言抛错、未知 owner 拒绝和重复 cleanup。
- 三轮 focused stress 不产生新的 `forklight-hub-cli-*` 或 `forklight-restart-*` 进程残留。
- lifecycle 组合、全量测试、build 和 `git diff --check` 全绿。

## 边界

- 只修改测试与 test helper；不修改 `src/`、Hub UI、Provider、Worker、Integration、activation 或其他仓库。
- 不 commit、不 push。
- 本轮是上一版失败后的唯一重划边界；若仍失败则停止该路线，由 Main 保留证据并改走产品级生命周期设计，不继续调参重试。
