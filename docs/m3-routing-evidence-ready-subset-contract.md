# M3 证据达标子组路由契约

## 用户结果

当 Main 同时考虑多个 Worker 时，一个尚无同类历史的新 Worker，不再让其他已经具备公平证据的 Worker 全部失去比较结论。

ForkLight 只在“证据已经达到门槛”的 Worker 子组里做比较；证据不足的 Worker 仍然可选、不会被记为零分、不会被永久排除。若产生建议，界面必须清楚说明这是“已验证子组内的建议”，不声称胜过尚未验证的 Worker。

## 白话定义

- **证据达标子组**：在同一个 evidence scope 下，达到当前样本门槛的不同 Worker 身份。
- **已验证子组内建议**：只回答“现有公平证据覆盖的 Worker 里，谁更合适”，不回答“未知 Worker 一定更差”。
- **未知 Worker**：当前任务类型或任务大类下样本不足。它保持可选，也不会因为缺数据得到合成零分。
- **不同 Worker 身份**：按路由现有的完整身份规则区分；两个 Profile 若解析为相同 provider、model、runtime、effort，不能伪装成两个独立对照对象。

## 判定规则

1. 若至少两个不同 Worker 身份分别达到 exact-class 门槛，使用 exact-class 子组。
2. 否则，若提供 taskFamily 且至少两个不同 Worker 身份分别达到 task-family 门槛，使用 task-family 子组。
3. 否则 evidence scope 仍为 none，不产生建议。
4. 选择 scope 后，只对达到该 scope 门槛的 Worker 计算可比较因素、分数和差距。
5. 未达到门槛的候选仍完整返回并保持 eligible，但其因素显示为证据不足，不参与排名，也不被合成成失败或零质量。
6. strict/flexible 的缺失因素规则只针对证据达标子组；一个未进入子组的新 Worker不能让整个子组失效。
7. accepted delivery、first-pass 和 budget reliability 等自己的覆盖门槛，必须使用当前 scope 的门槛：exact-class 用 `minRelevantSamples`，task-family 用 `familyMinRelevantSamples`。
8. Competition 仍只由 Main intent、已启用 trigger 和现有策略决定；未知 Worker 或部分子组建议本身不启动 Competition。

## 输出与解释

Canonical advisory 必须增加稳定、隐私安全的比较范围事实：

- 当前 scope；
- 候选总数；
- 实际进入比较的候选数与不同 Worker 身份数；
- 未进入比较的候选数；
- 是否覆盖全部候选；
- 每个候选是否进入比较、实际样本数和所需门槛；
- recommendation 若来自子组，明确标记为 `evidence-ready-subset`；覆盖全部候选时标记为 `all-candidates`。

字段命名可以服从现有类型风格，但 Core、CLI、daemon/MCP 和 Hub 必须消费同一事实，不能各自推断子组。

## 模块行为

### 1. 路由 Core

消费：候选 Worker 身份、exact evidence、可选 family evidence、当前 routing policy。

生产：一个 evidence-ready comparison cohort、每个候选的参与状态、可选 recommendation 和原有 Competition advice。

边界：不读取凭据，不请求 Provider，不启动 Worker，不改 Settings，不把未知样本写成零质量。

### 2. CLI / daemon / MCP

消费并透传 Core 的 canonical advisory。CLI 人话输出必须说明“建议覆盖全部候选”或“只覆盖已验证子组”，并列出有多少候选尚未进入比较。

边界：客户端不复制门槛计算，不自动删掉未知 Worker，不自动执行建议。

### 3. Hub

先回答三件事：

1. 这次有几个 Worker 真正具备公平证据；
2. 若有建议，它是否只在已验证子组内成立；
3. 未验证 Worker 下一步可以保持未知、在自然任务中探索，还是由 Main 直接选择。

评分、raw reason code 和算式继续放在技术详情。不得把“未进入比较”写成“失败”“得分最低”或“不可用”。

## 必须通过的场景

1. 四个候选中两个 exact 样本达标、两个为零：比较前两个，返回子组建议；后两个保持 eligible 且明确未进入比较。
2. exact 只有一个达标，但 family 有三个达标：使用三个候选的 family 子组。
3. 只有一个不同 Worker 身份达标：scope none、无 recommendation。
4. 两个 Profile 解析为相同完整 Worker 身份：不能仅凭两个 Profile 形成比较子组。
5. exact 有两个达标、family 有更多：exact 优先，family 不混入同一次评分。
6. 子组中的 enabled factor 缺证据：strict 仍阻止建议；flexible 只忽略该因素。子组外未知候选不触发这条阻止。
7. family 门槛与 exact 门槛配置不同：所有 factor coverage 使用 family 门槛，不误用 exact 门槛。
8. 建议分差不足或所有有效权重为零：即使子组存在，仍保持 unknown。
9. Competition intent 为 none：部分子组、未知候选和小分差均不能擅自启动 Competition。
10. 返回、CLI 和 Hub 不包含 task 内容、日志、endpoint、Keychain 或凭据。

## 非目标

- 不改变默认权重、默认样本门槛或 Competition 设置。
- 不做贝叶斯估计、先验分、探索奖励或给未知 Worker 合成分数。
- 不自动选择、启动、切换、禁用或永久拉黑 Worker。
- 不回填旧 Task，不制造 Competition 或重复任务来凑样本。
- 不改统计数据库、成本口径、失败归因、Task 生命周期、Integration 或 Worker Profile 设置。
- 不触碰其他 App、Elsewhere、Client-Core、Adeptify Shell、SDK 发布目录，不 commit、不 push。

## 验收重点

- 比较子组至少包含两个不同 Worker 身份。
- 未达门槛候选不会阻断达标子组，也不会作为零分参与比较。
- recommendation 的覆盖范围在类型、CLI、Hub 和测试中一致可见。
- family scope 的 factor coverage 使用正确的可配置门槛。
- 所有候选仍可被 Main 覆盖选择，Competition 逻辑保持独立。
- 聚焦测试、全量测试、build、Hub JS 语法和 `git diff --check` 全部通过。
