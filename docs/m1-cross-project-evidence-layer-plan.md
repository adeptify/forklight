# M1→M3 跨项目证据层计划

## 目标

ForkLight 在一台电脑上服务 Adeptify/Nexus、Flyleaf、Elsewhere、Relay 与其他项目时，
应从每个真实 Task 学到“什么任务、交给谁、用了什么边界、如何验收、最后是否交付”，
并把这些事实用于后续拆分、Worker 推荐和默认参数建议。

它不是把所有项目代码混成一个上下文，也不是拿本地源码训练模型。

## 三层数据边界

### 1. 全局结构化事实（默认可用于本机建议）

- project identity：用户可读项目名 + 稳定本地 id；UI 不默认展示完整绝对路径；
- task class / family、Main 选择依据、Worker Profile、Provider、Model、Runtime、effort；
- Task 合同质量、文件/行数/时间/Token/Attempt 等生效配置与来源；
- Attempt 是否真正进入模型、是否产生 Candidate、改动规模；
- independent verification、Main Review、Correction、Reverification、Integration 与最终交付；
- Worker Token、Main 交换量、官方价格估算、运行时估算与真实账单口径；
- 失败类别、发生阶段、是否属于模型质量、是否保留了可用成果。

这些数据只用于本机 ForkLight 的聚合、解释和建议，不发送到新的外部服务。

### 2. 可复用经验（由规则和 Main 审查生成）

例子：

- “UI 语义任务需要 Main 先提供信息层级与文案合同”；
- “Claude Code 在某个本机启动环境下无法读取 Runtime 路径，这是基础设施失败”；
- “某类测试任务完整验证较慢，但不应因此放宽正确性门禁”；
- “同类 Task 的第一次 Candidate 常可修正，而不必从头重跑”。

经验必须带证据范围、样本数量、最近时间和反例。Main 可以覆盖建议；
在 M3 前它只能建议，不能自动决定 Worker、Competition、预算或重试。

### 3. 项目私有内容（默认不跨项目）

- 源码、Prompt、Worker 原始输出、diff、日志、业务数据、凭据和绝对路径；
- Main/Worker 的自由文本只留在原 Task 的安全详情中；
- 除非用户明确创建跨项目 Plan/Handoff，否则一个项目的内容不得注入另一个项目 Worker；
- 聚合层不得从文件名、错误文本或业务内容推断敏感标签。

## 失败分类必须先于模型评分

每次失败先回答“模型是否真正开始工作”，再回答“交付为什么没有完成”。

### 不计入模型质量失败

- Runtime 启动、sandbox、可执行文件、MCP/Daemon build mismatch；
- Workspace preparation 在 Worker 启动前失败，例如已声明 sibling package 与
  `node_modules` symlink 的隔离物化能力缺口；
- Provider 凭据、连接、限流或服务不可用；
- 用户/主线程中断、共享 Daemon 升级窗口；
- Token、时间、文件或行数边界触发；
- 源码冲突、外部依赖漂移、验证环境失败；
- 验收生成物进入 raw diff、收尾放大或文件在扫描中变化等 ForkLight
  Candidate 捕获基础设施失败；
- Task 合同不可行、验收定义矛盾或 Main 改写验收口径；
- Worker 未产生模型回合或可审查 Candidate。

### 可以进入模型质量证据

- Worker 已完成有意义的模型回合并提交 Candidate；
- 独立检查在稳定、可满足的合同下发现 Candidate 自身错误；
- Main 指出具体产品/逻辑/实现问题，且问题不来自合同变化或源码漂移；
- 纠正次数、最终交付、保留成果和总成本同时记录，不能只记首次失败。

## 数据消费场景

### Main 拆任务

输入当前 Task 合同与同 class/family 的结构化历史；输出推荐的任务边界、检查组合、
常见风险和是否值得拆分。不得复制其他项目原始任务内容。

### Worker 推荐

按 exact class → family → global 的顺序提供证据。显示首次通过率、最终交付率、
平均纠正、成本和外部失败排除数，并解释为什么当前证据足够或不足。

### 参数建议

根据同类任务分布建议 no-progress、Attempt、文件/行数 warn、并发等值；
保持用户/Worker 高级配置为权威，不自动写回，不在开发阶段收紧成 hard gate。

### Hub 跨项目视图

先回答：哪些项目在运行、谁在等待、哪里需要 Main、最近交付了什么、
哪些失败是基础设施而非模型。技术 id、原始计数和完整路径默认收起。

### ForkLight 自身缺口发现

跨项目 Task 可产生一条独立的“平台缺口”证据：发生阶段、放大因子、是否阻塞
共享队列、是否仍保留源码级 Candidate。比如 Nexus 的小型源码 Candidate 因嵌套
Rust `target` 进入 raw diff 而生成巨型临时 patch，应该提升为 workspace/patch
基础设施修复；它既不计入 Grok 质量失败，也不把 Nexus 的源码或原始日志注入
其他项目 Worker。

## 共享 Daemon 与升级门禁

- 全部项目复用一个 Daemon、一个数据库与一条队列；不得因项目不同启动第二套；
- MCP/CLI/Daemon 构建身份不一致时，旧客户端停止 mutation，并提供重连或匹配 CLI 路径；
- ForkLight 自身 Integration/activation 前，必须确认全局 active/queued 为空；
- 已验收 Candidate 可以等待安全窗口，不为了激活中断其他项目；
- Daemon 重启后，Task、队列、Candidate、Plan、Goal、统计和项目身份继续可读；
- 运行中的外部项目优先于 ForkLight 自身非紧急 dogfood Task。

## 里程碑

### E1：证据口径与项目身份

- 统一 project id/display name、失败阶段和 model-quality applicability；
- 对现有历史做只读投影，不回写或猜测旧证据；
- 用当前 Flash Runtime EPERM、Flyleaf declared-local workspace preparation、
  Nexus Grok queue/verification、成功 Integration 四类真实样本验收。

### E2：跨项目 Hub 视图

- 展示运行/排队/需 Main/最近交付；
- 可按项目、family、Worker 过滤；
- 任何统计都能解释纳入/排除原因。

### E3：建议进入 Task Preview

- Main 看到同类历史建议和证据范围；
- 参数与 Worker 只建议、不自动执行；
- 用户可以关闭某项目的全局经验贡献或固定项目级策略。

### E4：M3 路由证据

- 30–50 个真实、可区分失败责任的 Task 后，再评估自动路由；
- Competition 只用于关键、高不确定、新类型或用户明确要求的任务；
- 模型不会因一次外部失败被永久降级，Main 始终可以覆盖。

## 非目标

- 不把本地 Task 数据上传、出售或用于训练外部模型；
- 不跨项目复制源码、日志、Prompt 或业务文本；
- 不用一个模糊总分替代首次通过、最终交付、纠正、成本和失败责任；
- 不根据项目名、路径或用户内容推断团队、客户或商业敏感信息；
- 不在证据不足时宣称“最佳模型”或“节省了 Main Token”。
