# ForkLight 渐进式瘦身重构 Spec

状态：已确认并实现（验收结果见对应 verification report）
日期：2026-07-23
基线：`main` at `0b1d04a`

## 目录

- [一句话说明](#一句话说明)
- [为什么要重构](#为什么要重构)
- [目标与非目标](#目标与非目标)
- [设计原则](#设计原则)
- [保留的核心对象](#保留的核心对象)
- [目标执行链](#目标执行链)
- [一、验证闭环](#一验证闭环)
- [二、工作区与 Diff 真实性](#二工作区与-diff-真实性)
- [三、可控纠正与主审](#三可控纠正与主审)
- [四、Integration 与运行时激活](#四integration-与运行时激活)
- [五、统一的任务决策视图](#五统一的任务决策视图)
- [六、冗余清理](#六冗余清理)
- [兼容与迁移](#兼容与迁移)
- [安全边界](#安全边界)
- [实施波次](#实施波次)
- [验收标准](#验收标准)
- [明确不做](#明确不做)

## 一句话说明

ForkLight 要把一次外部 Worker 编码任务，变成一条可信、可纠正、可审计的交付链：

> Worker 可以提出修改，但不能给自己签发“已验证”；ForkLight 负责独立验证，主 Codex 负责审查，用户负责最终授权，系统必须说清每一步是谁做的、依据是什么、现在是否真的生效。

本次不是推倒重写，而是在保持现有 Provider、隔离、Store、Daemon、CLI、MCP、Plan、Competition 和 Economics 能力的基础上，重构任务从执行到激活的核心骨架。

## 为什么要重构

真实 Dogfood 已证明当前主要问题不是缺少功能，而是多条事实链没有完全接起来：

1. Worker 会在无法运行验收命令时自报“测试通过”或“Diff 未超限”。
2. 独立 Verifier 遇到第一条失败命令就停止，无法给出完整诊断。
3. Resume 只拿到最后一条命令反馈，Worker 会连续追逐局部失败。
4. 缓存、生成物和业务修改可能混入同一个 Diff。
5. 隔离工作区没有 Git 元数据，部分合理验收命令无法运行。
6. 达到全局 Attempt 上限后，缺少单任务、一次性、可审计的修正授权。
7. 机器验证、主 Codex 审查、用户授权和 Integration 结果没有清楚分层。
8. Apply 成功不等于 Build 完成，更不等于运行时已加载新版本。
9. Console 更像事件日志，不能直接回答“谁做的、谁验证的、为什么被拒绝”。
10. 部分旧函数、重复包装和测试辅助代码已经失去作用，继续增加理解成本。

对应的主要 Dogfood 记录包括 FL-D30、31、37、55、58、67、78、93、98、99、103、105、113。

## 目标与非目标

### 目标

- 建立从 Worker 交付到运行时激活的单一事实链。
- 让全部机器拒绝原因一次性可见，并能进入下一次纠正。
- 在不给 Worker 任意 Shell 的前提下提供真实、受控的自检反馈。
- 让业务修改、生成物和最终可集成补丁使用清楚且一致的口径。
- 支持有限、显式、可审计的例外授权，不靠永久放宽全局限制。
- 让 Console、CLI 和 MCP 对同一任务给出一致的解释。
- 删除有证据的冗余代码，降低后续维护成本。

### 非目标

- 不重写 Provider、价格、Token、Economics、Plan 或 Competition。
- 不把 Console 变成另一个取代 Codex 的编排大脑。
- 不开放 Worker 任意 Shell、网络、原项目写入、Git 控制或 commit/push。
- 不为每个阶段建立新的数据库表或领域实体。
- 不伪造 Provider 官方账单、缺失的请求级价格或其他外部证据。

## 设计原则

1. **先删、再改、最后才新增。**
2. **如无必要勿增实体。** 能作为现有 Event 的结构化 payload、派生结果或只读 View，就不新增表。
3. **事实与结论分开。** Worker 声明是事实来源之一，但不是验证结论。
4. **机器验证与人工决策分开。** Verifier 判断机器条件，主 Codex 和用户承担审查与授权。
5. **例外必须显式。** 额外 Attempt、预算覆盖和 Integration 都必须留下可审计授权。
6. **旧数据可读，新行为渐进迁移。** 不要求一次性重写历史记录。
7. **每波都能独立 Dogfood。** 不制造长期并行的两套核心流程。

## 保留的核心对象

持久化对象继续使用：

- `TaskRecord`
- `AttemptRecord`
- `EventRecord`
- `IntegrationReceiptRecord`
- `IntegrationResultRecord`

本次允许增加的是小型 value object、事件 payload 和只读 Projection：

- `WorkerClaim`：Worker 对交付内容和自检情况的声明。
- `CheckpointReport`：受控自检返回的非权威反馈。
- `VerificationReport`：独立 Verifier 的完整机器结论，沿用现有类型扩展。
- `RemediationPacket`：由最近一次验证和审查证据临时生成，不持久化为独立实体。
- `MainReviewDecision`：记录为结构化 Event。
- `TaskDecisionView`：由 Task、Attempt、Event、Verification 和 Integration 记录即时计算。

这些概念默认不新增数据库表。若实施中发现必须持久化，必须先证明现有 Event 或记录无法保证一致性、恢复性或审计性，再单独确认。

## 目标执行链

```text
Task Contract Snapshot
        │
        ▼
Attempt / Worker
        │
        ├── 受控 checkpoint：给 Worker 反馈，不签发成功
        ▼
WorkerClaim + Workspace Patch
        │
        ▼
Independent Verification
  behavior / policy / source / diff
        │
        ▼
Main Codex Review
  accept / revise / reject
        │
        ▼
User-authorized Integration
  applied / verified / built / activated
```

粗粒度 `TaskStatus` 继续表达运行状态。更细的“机器已验证、等待主审、已应用未激活”等阶段，由现有记录计算，不优先扩张持久化状态枚举。

## 一、验证闭环

### 全命令验收

- Verifier 按合同顺序运行全部 acceptance commands。
- 某条命令失败或超时，不阻止后续命令执行。
- 每条命令独立记录退出码、超时、耗时和有界输出。
- 最终 `behaviorPassed` 只有在全部命令均通过时才为真。
- 命令保持顺序执行，避免并行测试争用构建目录或缓存。

### 完整 VerificationReport

报告必须分别给出：

- `behaviorPassed`：验收命令是否全部通过。
- `policyPassed`：change budget、no-change 等政策是否满足。
- `sourceCompatible`：补丁涉及路径是否仍与源基线兼容。
- `businessDiff`：应进入产品交付的代码和文档修改。
- `generatedDiff`：缓存、覆盖率、临时构建物等非业务变化。
- `integrationDiff`：实际允许应用到原项目的补丁。

总结果不得掩盖分项结果。例如“行为全绿但 change budget 警告”必须保留行为成功和政策警告两个事实。

### RemediationPacket

Resume 或 revise 时，系统从最新证据生成一次完整反馈，至少包含：

- 所有失败或超时的命令及有界输出。
- change budget 的实际值、阈值、mode 和 effect。
- completion policy 拒绝原因。
- conflicting source paths。
- 最近一次主 Codex 审查意见。
- 哪些检查已经通过，避免 Worker 重做无关部分。

不再通过读取“最后一条 verification.command.completed”拼接反馈。

### 受控 checkpoint

Worker 获得一个 ForkLight 管理的 checkpoint 能力：

- 接口只接受 `{ commandIds?: string[] }`；ID 由 ForkLight 按合同顺序生成，省略时运行全部合同命令。
- 只能选择运行 Task Contract 中已经批准的验收命令 ID，不能提交任意命令文本。
- 可以读取当前真实 Diff 指标和分类结果。
- 返回内容必须有界、脱敏并记录 Attempt 归属。
- checkpoint 结果明确标记为非权威反馈。
- Worker 结束后，独立 Verifier 必须重新运行完整验收。
- checkpoint 不得暴露原项目、任意 Shell、网络或 Git 写能力。

具体传输可使用 Worker 运行时支持的本地受控工具，但对外行为和安全边界必须一致。

## 二、工作区与 Diff 真实性

### 统一 PathPolicy

所有快照、Manifest、Workspace Context、Diff、Verification 和 Integration 使用同一套路径策略。

路径分三类：

1. **永不暴露或集成**：原项目 `.git`、ForkLight 私有运行目录和凭据。
2. **共享依赖**：例如 `node_modules`，可只读链接，但不进入补丁。
3. **生成噪音**：例如嵌套的 `__pycache__`、`.pytest_cache`、`.ruff_cache`、`.mypy_cache` 和覆盖率缓存。

生成噪音规则支持嵌套路径匹配。`dist`、迁移文件、代码生成结果等可能是真实交付物，不默认排除，必须由合同明确分类。

Task Contract 可选的 `workspace.generatedPaths` 在创建时快照，用于补充默认生成噪音规则；它只影响 Diff 分类和 Integration，不扩大 Worker 权限。原有 `workspace.exclude` 继续表达不进入隔离快照的路径，两者不能混用。

### 非破坏性 Diff

- 计算 Diff 时不得删除 baseline 或 Worker workspace 中的目录。
- `generatedDiff` 保留审计摘要，但不进入 `integrationDiff`。
- `businessDiff` 和 `integrationDiff` 必须使用同一分类结果，避免验证与应用口径分叉。
- change budget 默认基于 `businessDiff`；若政策需要统计生成物，必须单独展示，不能混算。

### Verifier-only Git

- ForkLight 在 Worker 不可见的位置建立临时 Git 基线。
- 验收进程通过受控环境变量使用该基线和 Worker workspace。
- `git diff --check`、`git status` 等只读命令可以工作。
- Git 环境不得进入 workspace Diff，也不得允许 Worker 操纵原项目版本库。
- 原项目仍通过 Manifest 和 affected-path compatibility 保护并发修改。

### 有限 Workspace Context

上下文只包含：

- 顶层目录和文件数量摘要。
- Task focus paths。
- 关键入口和配置文件。
- 被链接的依赖目录。
- 如何使用 Read、Grep 和 Glob 继续发现内容。

不再默认列出整个项目的每个文件。内容超过限制时必须截断并明确标记。

## 三、可控纠正与主审

### Attempt 授权

- 默认 `maxAttempts` 继续作为安全边界。
- 未达到上限时，普通 Resume 沿用现有行为。
- 达到上限后，只能通过显式授权增加一次额外 Attempt。
- 每个 Task 最多获得一次这种紧急授权；不得形成无限续跑。
- 授权必须包含原因、确认标记和本次运行预算。
- 本次预算可以是正数或 `null`；只影响本次 Attempt，不修改原 Task Contract 或全局设置。
- 授权记录为结构化 Event，不能包含密钥或无界反馈正文。

Resume 的授权输入固定为：

```text
authorization:
  additionalAttempts: 1
  maxBudgetUsd: number | null
  reason: non-empty bounded string
  confirm: true
```

### 主 Codex 审查

独立验证完成后，主 Codex 可以记录：

- `accept`：接受候选交付。
- `revise`：给出有界修正意见并进入下一次 Attempt。
- `reject`：保留证据但不继续。

Worker 成功和 Verifier 通过不等于主审接受。Integration 前必须存在主审接受证据和用户的显式应用确认。

主审写入 `main-review.completed` Event，payload 只保存 `decision`、有界理由、对应 Attempt 和 Verification 标识。额外 Attempt 授权写入 `attempt.authorization.granted`；checkpoint 写入 Attempt 归属的 `checkpoint.completed`。不为这些事件再建表。

### 纠正 lineage

系统需要同时展示：

- 每一跳 Attempt 产生的修改量，即 `hop churn`。
- 从最初 baseline 到最终被接受交付的 `combined delivery diff`。

历史失败和修正不得被覆盖或改写成成功。

## 四、Integration 与运行时激活

### 异步 Operation

- Integration apply 先生成未来的 Integration Result ID，并写入 `integration.operation.started` Event；该 ID 同时作为 `operationId` 返回。
- 最终 `IntegrationResultRecord` 使用同一个 ID，不新增 Operation 表。
- 前台等待超时返回 `outcome-unknown`，不得写成失败。
- 调用方可以通过 `operationId` 继续查询或等待。
- 阶段进度写入结构化 Event，不新增一套重复 Operation 表。

### 阶段

Integration 至少区分：

1. `source-applied`
2. `source-verified`
3. `artifact-built`
4. `runtime-activated`

不适用的阶段显示 `not-applicable`，不能假装已完成。构建和激活检查命令必须来自用户已批准的合同配置，由 ForkLight 执行，不能由 Worker 任意提供。

Task Contract 可选的 `delivery` 配置在创建时快照：

```text
delivery:
  buildCommands: string[]
  activationCommands: string[]
  activationCheckCommands: string[]
```

未声明的阶段为 `not-applicable`。这些命令由 ForkLight 在用户确认 Integration 后运行，不会作为 Worker 工具暴露。

### Build 与 Protocol Identity

Daemon、CLI 和 MCP 都暴露：

- `protocolVersion`
- `buildId`
- package version

协议不兼容时，变更操作必须失败关闭。Build 不一致时，读操作仍可用，但必须明确提示 rebuild/restart；Integration 和 activation 不得静默声称运行时已经更新。

开发态启动必须能从源码入口可靠 build、启动并确认身份，修复“可以停止但无法从源码重新启动”的路径。

## 五、统一的任务决策视图

`TaskDecisionView` 是只读 Projection，不是持久化实体。Console、CLI compact inspect 和 MCP summary 共同使用它。

它优先回答：

- 当前执行阶段和最新有效进展是什么。
- 哪个 Provider/Model Worker 写了什么。
- 哪些内容只是 Worker 的 `unverified claim`。
- checkpoint 实际反馈了什么。
- 独立 Verifier 哪些通过、哪些失败。
- 主 Codex 接受、要求修正或拒绝的理由。
- 用户是否授权继续或应用。
- Integration 是否已应用、验证、构建和激活。
- 下一步需要谁做什么。

原始 Timeline、完整 Diff、命令输出和 Economics 继续作为可下钻审计证据，不占据默认主视图。

状态与 compact inspect 必须包含最新 event sequence、lastEventAt 和有效动作摘要，不能只依赖 `Task.updatedAt` 判断进展。

## 六、冗余清理

### 删除条件

代码只有在满足至少一项时才删除：

- 没有生产引用且不是稳定公共接口。
- 新实现已经完全替代。
- 只是无独立语义的重复包装。
- 兼容分支没有仍需支持的真实数据。
- 对应测试能证明删除不改变有效行为。

### 已确认的首批候选

- 未使用的生产 import、参数和函数。
- 测试中的未使用 import、fixture 变量和 helper。
- 仅由测试调用、且已被 source compatibility 全局审计结果替代的 `sourceIsUnchanged`。
- 重构后被统一 Projection、PathPolicy 或 Verification 聚合器替代的重复拼装逻辑。

### 防止复发

- 使用 TypeScript 自带 `noUnusedLocals` 和 `noUnusedParameters`。
- 不为静态审计新增第三方依赖。
- “仅测试引用的生产 export”必须人工复核，不能机械删除。

## 兼容与迁移

- 现有数据库采用增量兼容读取，不做破坏性重建。
- 历史 Event 缺少新 payload 时显示 `unavailable`，不猜测。
- 现有 Task Contract 继续可读取；新配置字段保持可选并在创建时快照。
- CLI/MCP 现有只读接口尽量兼容；新增摘要字段，不删除深度审计入口。
- 每一波完成后删除被替代的旧路径，不长期双写两套核心事实。
- Plan 和 Competition 在底层 Task 语义稳定后复用新 Verification 和 Decision View，不各自复制判断。

## 安全边界

- Worker 只能写自己的隔离 workspace。
- Worker 没有任意 Shell、Web、原项目 Git 或原项目写权限。
- checkpoint 只能执行合同内命令 ID。
- 独立 Verifier 的命令输出有界并脱敏。
- 额外 Attempt、预算覆盖、主审和 Integration 都有明确授权证据。
- ForkLight 不自动 commit 或 push。
- 外部价格或账单证据缺失时保持 `unavailable` 或明确标记 estimate。

## 实施波次

1. **验证真实性**：全命令验收、完整 RemediationPacket、Worker claim 归因、受控 checkpoint。
2. **工作区真实性**：PathPolicy、非破坏性三类 Diff、Verifier-only Git、有限 Workspace Context。
3. **纠正与主审**：一次性 Attempt 授权、预算覆盖、主审事件和 lineage。
4. **Integration 与身份**：异步 operation、Build/Activation 阶段、build/protocol identity、开发态启动。
5. **统一消费与清理**：TaskDecisionView、Console/MCP/CLI 消费、移除被替代代码、Dogfood 总验收。

每波必须先建立失败复现或失败测试，再实现，再运行定向测试和完整 `npm run check`。

## 验收标准

### 自动化

1. `npm run check` 全绿，不能删除或跳过有效测试换取通过。
2. TypeScript unused 检查通过。
3. 多命令验收中，第一条失败后其余命令仍运行，报告和 Resume 包含全部结果。
4. Worker 错误自报被标为 `unverified claim`，不能覆盖独立验证。
5. checkpoint 拒绝任意命令文本，只接受合同内命令 ID。
6. Python/Node 嵌套缓存不进入 Business/Integration Diff，且计算 Diff 不删除 workspace 文件。
7. 无 `.git` 的 Worker workspace 能通过合同内 Git 只读验收，Worker 仍无法接触原项目 Git。
8. maxAttempts 已满时无授权拒绝；一次性授权后只增加约定 Attempt，并审计原因和预算。
9. Integration 前台超时后可以使用 operationId 恢复查询，最终阶段真实可见。
10. protocol mismatch 关闭变更操作；build mismatch 给出明确 rebuild/restart 指引。

### 人工与 Dogfood

1. Console 无需阅读原始 JSON，即可回答：
   - 谁写的；
   - 谁验证的；
   - 谁接受或拒绝的；
   - 为什么；
   - 下一步是什么。
2. 使用 ForkLight 自身完成一轮代表性真实任务：
   - Task Contract；
   - Worker 与 checkpoint；
   - 独立验证；
   - 主审；
   - 必要时纠正；
   - Integration；
   - Build/Activation。
3. 审查真实 Diff、事件归因、命令证据和运行时身份。
4. `forklight-dogfood-log.md` 逐项更新相关 FL-D 的 resolved/remaining 状态。
5. 最终报告列出删除项与理由、已修问题、外部限制和全部验收结果。

## 明确不做

- 未经用户单独授权，不 commit、不 push。
- 不在本轮重写 Provider、Economics、Plan、Competition 或 Store。
- 不新增泛化工作流引擎。
- 不用更多实体掩盖职责不清。
- 不把 warn、estimate 或 Worker claim 展示成 verified success。
- 不把一次真实 Dogfood 扩大解释为所有模型和所有项目类型均已验证。
