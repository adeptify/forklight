# M3 Worker Profile 路由身份契约

## 用户结果

当用户在 CLI、MCP 或 Hub 里比较 Worker 时，ForkLight 必须比较真正保存过的 Worker Profile，而不是只比较一对 `provider/model` 文本。

用户看到的候选、历史证据和最终建议必须始终指向同一个 Worker。两个 Worker 即使使用相同模型，只要 runtime、effort 或 Profile 不同，也不能被合并成一个候选。

## 白话定义

- **Worker Profile**：一个可执行 Worker 的已保存配置。它有稳定的 Profile ID 和用户可读名称，并在请求发生时解析为 provider、model、runtime、effort。
- **完整 Worker 身份**：`provider + model + runtime + effort`。历史统计按这四项匹配。
- **Profile 身份**：用于界面和请求的稳定 `workerProfileId`。它告诉用户“选的是哪个 Worker”，但不改变统计的四项完整身份规则。
- **旧式候选**：只有 provider/model 的历史调用方式。它继续兼容，但不得伪装成 Profile 路由，也不得与完整身份候选混用。

## 输入、输出与边界

### 输入

新的主路径接收 2–10 个 `workerProfileIds`。每个 ID 必须唯一、格式合法，并且当前 Settings 中真实存在。

CLI 使用 `--profiles <json-array>`；它与 `--candidates` 互斥。MCP 和 daemon protocol 同样只允许 `workerProfileIds` 或旧式 `candidates` 二选一。

### 解析

daemon 是唯一可信解析方。它从当前 Settings 读取 Worker Profile 和 Model Catalog，生成冻结候选：

- `workerProfileId`
- `workerLabel`
- `provider`
- `model`
- `runtime`
- `effort`

endpoint、Keychain service、凭据、预算和其他执行策略不得进入路由输出。

### 输出

Profile 路由返回的每个候选都保留 `workerProfileId` 和 `workerLabel`。若产生推荐，推荐也必须明确指向同一个 Profile；排序后不得把名称贴到另一个 Worker 上。

旧式 provider/model 路由继续返回旧式结果，不凭空补造 Profile ID。

## 模块行为

### 1. Profile 解析层

消费：`workerProfileIds`、当前 Worker Profiles、Model Catalog、Provider defaults。

生产：只含安全展示字段的冻结候选。

边界：不探测 Provider，不启动 Worker，不改 Settings，不返回 endpoint 或认证信息。

### 2. 路由证据层

消费：冻结候选、taskClass、可选 taskFamily、Main 的 Competition 意图和触发条件。

生产：按完整 Worker 身份匹配的证据、未知或推荐、独立的 Competition 建议。

边界：证据不足仍为 unknown；没有 Main 明确意图和已启用触发条件时，不建议 Competition。

### 3. 对外入口

CLI、MCP 和 Hub 只负责传 Profile ID 和展示 daemon 的结果，不各自复制 Profile 解析逻辑。

旧式 candidates 保留兼容；新旧输入同时出现、Profile 重复、Profile 不存在或数量越界都在评估前失败。

### 4. Hub 展示

Hub 候选列表只展示已保存 Worker Profiles，以 Profile ID 为选项值。名称后可用人话补充 runtime 和 model，帮助用户区分同模型的不同 Worker。

现有页面结构不重做。结果先说明“这次比较了哪些 Worker、证据是否足够”，技术评分保持次要。不得把模型目录里尚未成为 Worker 的条目混入候选。

## 调用链

1. 用户从已保存 Worker 中选择至少两个 Profile。
2. CLI、MCP 或 Hub 只发送 Profile ID 与任务分类信息。
3. daemon 从同一份 Settings 解析并冻结每个 Worker 的安全身份。
4. 路由核心按完整 Worker 身份读取历史并计算建议。
5. daemon 将 Profile ID 和名称重新绑定到候选与推荐。
6. 调用方展示“比较了谁、知道什么、不知道什么”，但不自动执行任务。

## 必须通过的场景

1. 两个 Profile 使用同一 provider/model，但 runtime 或 effort 不同：两者仍是不同候选，历史不能串线。
2. 两个 Profile 完整身份相同但 Profile ID 不同：仍保留两个用户选择；由于统计证据等价，结果不得声称能区分模型质量，也不得丢失任一 Profile。
3. Profile 不存在、重复、空值或新旧输入同时出现：在读取统计前失败，不发 Provider 请求。
4. Profile 依赖 Model Catalog：请求时解析当前 catalog 值，并在返回中冻结这次评估使用的 model。
5. 零历史：返回 unknown，保留所有 Profile 身份，不启动 Competition。
6. 旧式 provider/model 请求：继续可用，结果不含伪造的 Profile 字段。
7. Hub：只从 Worker Profiles 建候选，不按 provider/model 去重，不展示未绑定 Worker 的 catalog 模型。
8. 隐私：所有返回、错误和页面均不含 endpoint、Keychain、API key、任务正文或日志。

## 非目标

- 不自动选择、切换或启动 Worker。
- 不在本切片执行真实模型 smoke、Provider 探测或 Competition。
- 不修改评分权重、样本门槛、成本口径、失败归因和统计数据库。
- 不改变 Worker Profile 的保存格式、执行策略或默认 Worker。
- 不重做 Hub 视觉风格，也不触碰其他 App、SDK 或 Elsewhere。

## 验收重点

- CLI 不再丢弃 runtime/effort，并提供 Profile 主路径。
- daemon/MCP 对 Profile 主路径做严格闭合验证，解析权只在 daemon。
- 核心结果排序后 Profile 绑定仍正确。
- Hub 同模型不同 Profile 不折叠，模型目录不再混入候选。
- 所有入口保持只读、无 Provider 请求、无任务创建、无 Settings 变更。
- 聚焦测试、全量测试、build、Hub JS 语法和 `git diff --check` 全部通过。
