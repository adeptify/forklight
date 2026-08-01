# M3 执行运行环境权威契约

## 用户结果

当 ForkLight Daemon 与当前源码构建完全一致时，CLI 和 Hub 必须以 Daemon 的运行环境检查为准。Daemon 说某个 Worker runtime 可以启动时，不能因为打开 CLI/Hub 的终端 PATH 不同，再把这个 Worker 误报成不可用。

只有 Daemon 不可用、身份不可读、版本不一致或运行环境证据不完整时，才退回当前进程的本地检查，并明确告诉用户这是本地兜底结果。

## 已确认的问题

- 同一个 build-matched Daemon 报告 `claude-code` 与 `grok-build` 均可用。
- 普通 Codex 非 login shell 无法直接找到 `claude`、`grok`。
- 当前 `forklight health` 虽然正确使用 Daemon 的 Provider 事实，却仍使用调用方本地 runtime doctor，导致全部已保存 Worker 被误报为 `runtime-unavailable`。
- Hub 的 `/api/status` 和内部 Worker readiness 也会重新执行本地 runtime doctor，存在同类漂移。

## 输入、输出和边界

### 输入

- 当前 client build identity。
- 一次只读 Daemon health evidence。
- 当前调用进程的本地 runtime doctor 结果，作为有来源标记的兜底。

### 输出

- 一套有效 runtime facts，至少覆盖 `claude-code` 与 `grok-build` 的 `ok` 状态。
- `runtimeReadinessSource`: `daemon` 或 `local-fallback`。
- `runtimeReadinessSourceDetail`: `build-matched daemon`，或一个有界的兜底原因。
- CLI/Hub 的 Worker readiness 必须消费这套同源 runtime facts。

### 权威选择

1. Daemon 可达、证据成功、build identity 完全一致且 runtime 证据结构完整：使用 Daemon runtime facts。
2. Daemon 不可用：使用本地结果，原因 `daemon unavailable`。
3. build/protocol 不匹配：使用本地结果并明确具体 mismatch。
4. Daemon identity 不可读或 runtime evidence 缺失/畸形：使用本地结果并给出有界原因。
5. 不得把 Daemon 与本地 runtime 布尔值逐项混合；一次结果只能有一个权威来源。

## 模块行为

### 1. 纯运行环境事实解析器

消费：client identity、Daemon evidence、本地 runtime facts。

生产：来源明确、结构受限的 runtime facts。

边界：只读；不启动/重启 Daemon，不运行 Provider 请求，不读取凭据，不执行 Worker。

### 2. CLI health

消费：解析后的有效 runtime facts、现有 Provider facts、Provider verification。

生产：一致的 `runtimes`、`workers`、overall health 和来源说明。build-matched Daemon 的 `claudeCode`/runtime 展示不得被调用方 PATH 覆盖。

边界：保留既有 JSON 字段兼容；只新增有界来源字段，不泄露凭据、endpoint、私有路径或原始错误。

### 3. Hub status

消费：同一个解析器输出。

生产：`/api/status` 与内部 readiness 使用相同 runtime 权威，Worker 卡片不再受 Hub 启动终端 PATH 影响。

边界：不增加 Provider probe，不增加 Daemon health 轮询，不改变现有缓存和生命周期语义。

## 必须通过的场景

1. 本地 runtime 全不可用、exact-build Daemon 两个 runtime 可用：CLI 和 Hub 均显示两个 runtime 可用，相关 Worker 不得因 runtime 被阻塞。
2. 本地可用、exact-build Daemon 某 runtime 不可用：以 Daemon 为准，不得用本地结果粉饰实际执行环境。
3. Daemon 不在：保留当前本地检查行为，来源为 `local-fallback`。
4. Daemon build/protocol 不一致：不得使用旧 Daemon runtime 事实。
5. Daemon runtime evidence 缺项、类型错误或未知结构：整体回退本地，不混合真假来源。
6. CLI 人类输出和 JSON、Hub status 都能解释事实来自实际执行 Daemon还是本地兜底。
7. 所有健康检查保持只读、无 Provider 网络请求、无 Task/Settings/Daemon 生命周期变更。

## 非目标

- 不修改 Worker runtime 启动、模型路由、Competition、重试、纠正、Integration 或统计策略。
- 不借此切片解决所有历史 health 语义，也不重做 Hub UI。
- 不触碰 Elsewhere、Client-Core、Adeptify Shell、SDK 发布目录或相关文档。
- 不提交，不 push。

## 验收

- 纯 resolver 覆盖 exact match、unavailable、identity mismatch、malformed evidence 和相反本地结果。
- CLI health 聚焦测试证明 build-matched Daemon 不再被本地 PATH 误判覆盖。
- Hub `/api/status` 聚焦测试证明 Worker readiness 使用 Daemon runtime truth。
- 全量测试、build、Hub JS 语法和 `git diff --check` 通过。
