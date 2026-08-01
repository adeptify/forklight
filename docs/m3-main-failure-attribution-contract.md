# M3 Main 失败责任归因契约

## 用户结果

ForkLight 的机器验证仍然只回答“这次交付是否通过”，Main 可以另外回答“这次失败能不能评价
Worker 能力”。机器失败不会被改写：Task 继续是 failed，Main 不能 accept，Integration 继续被阻止。
但本机进程启动、验收基础设施或验收定义本身造成的失败，不再被统计错误解释成模型能力差。

Task Detail 必须先用人话显示两条独立事实：

1. **交付结果：任务仍失败，没有通过验收。**
2. **能力评价：这次计入 Worker 能力 / 不计入 Worker 能力 / 暂时无法判断。**

用户不需要理解 event sequence、CandidateRevision 或统计内部分类。精确绑定只在协议和审计层保护
事实；Hub 默认只展示原因类别、是否计入能力和一段有界 Main 说明。

## 闭合分类

每次精确的失败 verification 只能记录以下一种原因；原因到统计影响的映射固定，不受 Settings 或
自由文本影响：

| 原因 | 统计影响 | 白话含义 |
| --- | --- | --- |
| `candidate` | `model-quality` | Candidate 本身没有满足独立验收，计入 Worker 能力 |
| `verification-infrastructure` | `non-model` | 本机、进程启动或验收基础设施失败，不计入 Worker 能力 |
| `acceptance-contract` | `non-model` | Main 写的验收合同或定义有问题，不计入 Worker 能力 |
| `insufficient-evidence` | `ambiguous` | 证据不足，保留但暂不评价 Worker 能力 |

不允许传入任意 impact，也不从 Main 说明、stderr、命令文字或 Task error 猜 impact。已有自动失败分类
仍保留作 diagnostic fallback；只有结构有效且绑定正确的 Main 归因可以覆盖该次 verification 在
routing/statistics 中的 impact。

## 持久证据与精确绑定

使用新的 durable Task event 记录一次归因，不新增可手改数据库的业务路径。payload 至少包含：

- 固定 `version: 1`；
- `attemptId`；
- `verificationEventSequence`；
- 闭合 `cause` 与由它确定的 `impact`；
- 1–500 字符、去首尾空白、无控制字符的本地 Main 说明；
- 如果该 Attempt + verification 已有 Candidate Revision，则必须同时绑定
  `candidateRevisionId` 和完整 SHA-256 `candidatePatchDigest`；
- 记录时间由 event 自身提供，不接受调用方伪造。

记录前必须重新读取当前 Store 并验证：

1. Task 存在且机器状态仍为 `failed`；
2. 指定 Attempt 属于该 Task；
3. 指定 sequence 正好是该 Attempt 的 `verification.completed`，且 payload 是结构有效的
   `passed=false`；
4. 如果该 verification 有 Candidate Revision，输入 id 与 digest 必须和精确 revision 一致；如果没有，
   不得伪造 revision binding；
5. Attribution 本身不要求 verification 是 Task 的最新一次，因而可以保留第一次 Attempt 的真实失败；
   但终态统计只能把绑定最新 verification 的归因用于当前失败，first-pass 统计只能读取第一个 Attempt
   自己的 verification 归因，绝不能跨 verification 借用。

### 一次性与幂等

- 同一 Task + Attempt + verification sequence 只允许一个有效 attribution event。
- 完全相同的 cause、说明和 revision binding 再次请求时，返回已存在记录且不新增 event。
- 任一字段不同都返回固定 conflict；不得追加第二条、覆盖旧 event 或“改口刷统计”。
- 新的 `verification.completed` sequence 是新的机器事实，可以单独归因。
- 读取端即使遇到导入的坏 event、错误 Attempt、错误 sequence、错误 revision id/digest、非法 cause/impact、
  重复冲突记录，也必须忽略这些归因并回退现有保守分类，不能污染统计。

## 不改变的机器与交付事实

记录 attribution 只能新增一条审计 event。它不得：

- 修改 Task 或 Attempt status、error、finishedAt；
- 修改 verification payload、命令结果、Candidate Revision 或 Diff；
- 创建 Worker Attempt、resume、correction、reverify、adaptation 或 Competition；
- 写 Main Review，允许 failed verification 被 accept，或改变 Integration preflight；
- 修改 remediation disposition、最终交付结果、first-pass 原始 verification 或任何历史 event；
- 启动 Provider 请求、执行验收命令、修改源码、commit 或 push。

## 模块行为

### Core attribution authority

负责输入验证、cause→impact 闭合映射、精确 verification/revision 绑定、一次性幂等和 durable event。
同时提供纯读取 helper：给定 Task events、Attempt 与 verification sequence，只有唯一且完整有效的 binding
才返回 attribution；否则返回 undefined。

### Statistics 与 routing

现有 diagnostic `FailureCategory`、机器 success/failure 和 failure distribution 不被抹掉。有效 attribution
只替换对应 verification 的 `FailureImpact`：

- `model-quality` 继续进入 relevant/model-quality failure 与 first-pass failure；
- `non-model` 进入 ignored non-model 聚合，不降低模型质量评价；
- `ambiguous` 进入 ambiguous 聚合，不奖励也不惩罚模型；
- latest verification 的 attribution 只影响当前终态/最终交付可比性；早期 verification 的 attribution
  只在其自己的 first-pass/Attempt 证据中生效；
- 无 attribution、坏 binding 或历史 legacy 数据继续使用现有保守自动分类。

Compact statistics 只增加或复用聚合计数，不能包含 Task id、Attempt id、sequence、revision id/digest、Main
说明、命令、路径、stderr 或 diagnostic。Routing evidence 可用已有
`modelQualityFailureCount / ignoredNonModelTaskCount / ambiguousFailureCount` 解释纳入、排除和不确定数量；
不得因为归因是 non-model 就删除机器失败或提升成成功。

### CLI / Daemon / MCP

三层共用同一个 Core authority，mutation 必须显式 `confirm: true`，并要求：

- `taskId`、`attemptId`、`verificationEventSequence`、`cause`、`note`；
- Candidate Revision 存在时要求完整 id + digest；两者必须同时出现或同时缺失；
- 返回同一个有界 canonical attribution receipt；幂等重放标记为 existing；
- MCP 标注 readOnly=false、destructive=false、openWorld=false，不触发 Provider；
- CLI 与 MCP exchange receipt 只记录长度、闭合 cause 和是否有 revision binding，不复制 note 内容。

### Hub / Task Detail

Hub Task Detail 对 failed verification 提供 Main 归因表单；表单提交同一 daemon mutation。默认展示：

- “任务仍失败，没有通过验收”；
- “这次计入 Worker 能力 / 不计入 Worker 能力 / 暂时无法判断”；
- 闭合原因的中英文白话；
- 最多 500 字符的 Main 本地说明；
- 已记录后不再提供可改口控件；只有出现新的 failed verification 才能记录新归因。

Hub 不把 `model-quality`、`non-model`、`ambiguous`、event sequence 或 CandidateRevision 当作主文案。
技术折叠区可以继续显示既有机器 verification，但不需要新增内部绑定字段。Hub server 必须从受信 Task
Detail projection 取得精确 revision binding，不从浏览器自由文本重建；mutation 仍携带并在 Core 复核。

## 真实 dogfood：e629

Task `e6294b47-b652-4538-ae37-a3bef793f2ff` 必须证明历史没有被抹平：

- Attempt 1 `910934c3-3de4-4135-aeff-d0bbb0eef0c1` 的 verification sequence `901`
  因 Candidate 新增测试断言错误而失败，记录为 `candidate / model-quality`；绑定 sequence `902` 捕获的
  exact Candidate Revision `92a18a66-29fc-47fa-a4c6-90292688ef9d` 与 digest
  `9e5589f3847839c5d86b4612413eeea27e9dc38e289f271400b9d2a9830228aa`。
- Attempt 2 `f818aa21-8790-4857-b35f-9f86afb4b5f7` 的零 Worker reverify verification
  sequence `1386` 最终只剩未修改的本机 source-dev Daemon 启动时序失败，记录为
  `verification-infrastructure / non-model`；绑定 revision
  `4abd0003-c259-40d2-aec4-4d1e98141fcb` 与 digest
  `1f5106d406abf137ede578dfc12e2582496257b2a888c39554afd09aad372c01`。
- 归因后 Task 仍是 failed，Main Review 仍不能 accept，Integration history 仍为空；routing/statistics 的
  current failure 不再惩罚 Grok，但 first-pass model-quality failure 仍保留。
- 对 sequence `1386` 的完全相同请求幂等；不同 cause 或说明必须 conflict。用 sequence `901` 的 attribution
  不能影响 `1386`，反之亦然。

## 必须通过的场景

1. Candidate failure：精确绑定成功，Task/status/verification 不变，model-quality 聚合增加。
2. Infrastructure failure：机器失败仍展示，non-model 聚合增加，模型质量 denominator 不增加。
3. Acceptance-contract failure：不改变 remediation/final delivery，只作为 non-model routing evidence。
4. Insufficient evidence：进入 ambiguous，不被算作成功、model-quality 或明确 non-model。
5. 完全相同重放：返回 existing，event 数不变；不同重放：固定 conflict，event 数不变。
6. 错 Task、Attempt、sequence、passed verification、revision id/digest、半个 revision binding：mutation 前拒绝。
7. 旧 verification 与新 verification：各自独立；terminal 与 first-pass 读取精确自己的 binding。
8. 导入坏/重复 attribution event：统计 fail closed，compact output 无私有字段。
9. CLI、MCP、Hub 都能记录同一 canonical evidence，且缺 `confirm:true` 不产生 mutation。
10. Hub 中英文用白话解释双重事实；已归因后不能反复修改，新的 verification 才重新开放。

## 非目标

- 不自动判断或自动改口；Main 必须根据证据明确记录。
- 不放宽、跳过、重跑或替换验收命令；不增加 retry 或 verifier concurrency。
- 不改变 Competition 触发、Settings 权重、Provider/Runtime、Worker Profile 或模型推荐门槛。
- 不回填所有旧 Task，不改写现有 failureCategory，不创建通用人工标签系统。
- 不触碰 Elsewhere、client-core、client-app-adeptify、SDK/release 或消费者/Nexus 文档。

## 验收

- focused Core/Store/statistics/daemon/MCP/CLI/Hub 测试覆盖绑定、幂等、隐私和双语行为；
- `node --check` 覆盖 Hub app 与 i18n；
- full `npm run check` 与 `git diff --check` 通过；
- Main 逐文件审查并只允许 1 个 base Attempt + 最多 1 次有证据 same-Candidate correction；
- Main accept 后才允许 Integration；激活后核对源码/build/Daemon/Hub 同一 identity、单实例与 M0 streak；
- 对 e629 做真实两次 attribution dogfood，并复核机器失败、统计、Task Detail 与 Integration authority 均诚实。
