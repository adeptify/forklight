# Worker 选择与结果判定证据审计

首次审计：2026-07-29

最新追踪：2026-07-30

## 用户真正需要的结果

Main 应该用足够少的 Worker 完成任务，并能解释为什么选它；Worker 第一次没有完全通过时，Main
要先判断成果能否保留，再决定定点纠正、换 Worker 或停止。用户不应因为系统缺少历史数据就默认
支付多模型竞争成本，也不应把机器首次失败误解为最终没有交付。

初始审计只读取 ForkLight 数据库和 routing advisory，没有启动 Worker、Provider probe、competition、
retry 或 adaptation，也没有修改任何模型设置。后续只有审计暴露出明确产品缺口时，才启动边界清楚的
单 Worker dogfood Task；每次执行与只读结论在下文分开记录。

## 2026-07-30 追踪：任务很多，但严格可学习证据目前只有 20 条

本轮先做只读审计，再为审计暴露的解释缺口启动一个 Grok 实现 Task。启动前的权威数据为：

- 最新权威投影在排除 Review Graph 裁判后，共 **304** 个 terminal ordinary Task。
- **190** 个有 exact `taskClass`，**72** 个有稳定 `taskFamily`。
- 只有 **20** 个同时保存了 `taskClass + taskFamily + routingDecision`；分散在 154 个 exact class、
  19 个 family 中。
- 四个首次通过/最终交付 dogfood Task 与三个自然产生的 Elsewhere M2 产品 Task 完成后，严格新格式记录变为 **20/30 minimum**。不能把 304 个历史 Task 都算作
  M3 样本，也不能为旧 Task 反向猜测 Main 当时为什么选某个 Worker。

第 20 条是 Elsewhere 故事方向 Task `a44b22f3-9df7-4948-9107-ce88b9fc526f`。它只选择 Grok 4.5，
没有 Competition、自动 retry、adaptation 或第二 Provider。首次 Candidate 的聚焦测试 53/53，但三个
TypeScript 编译问题阻断全量检查。Main 没有整单重跑，而是在隔离 workspace 保留语义主体，集中修正
氛围型路径、结尾信件输入边界和编译问题，再以一次零 Worker reverification 通过原始 4/4 验收：聚焦
53/53、全量 183/183、build 和 diff hygiene。revision
`c4daf5a5-bab7-4218-8a42-82472a8027d1` 已接受。由于 Client-Core SDK RC 正在冻结 Elsewhere 源码，
它目前是“已接受、待 Integration”的结果判定样本，不能写成已交付用户结果。

当前没有一个 exact class 或 task family 能让一组有意义的候选 Worker 都达到
`minRelevantSamples=5`。最接近的真实 family 是 `bounded-javascript-change`：Grok 有 13 个 terminal、
12 个 relevant，MiniMax 有 2 个 terminal/relevant。Relay 的 `relay-gmail-incremental-sync` 虽有 6 个
Task，但分散为 Grok 4、MiniMax 1、GLM 1，同样不足以公平比较。

因此正确结论不是“Grok 一定更好”，也不是“应该立刻补跑 MiniMax 三次”，而是：已经存在相关历史，
但候选集合还不能比较。后续真实 Task 应在创建时自然保存三个字段；只有任务本身值得双实现时才竞争，
不能为了平衡样本而制造工作。

## 2026-07-30 追踪：历史 Competition 的实际代价

数据库内 7 次已完成 Competition 共启动 **14** 个 Candidate Task，其中 **5** 个 succeeded、**9** 个
failed；共 15 个 Attempt、728 turns，runtime estimate 合计约 **USD 49.3877**。这不是账单，也不是对
未来 Competition 成本的预测，因为其中包含早期能力验证和不同难度合同。它能证明的一点是：把
“证据不足”自动转换为多 Worker 执行，会真实放大工作量。

只有最近 2 次 Competition 保存了 `required + user-requested` 的明确原因；更早 5 次属于 legacy，
没有可审计的 intent/reason。当前配置保持 duration、cost、budget reliability 权重为 0，Competition
trigger 列表为空；Main 明确给出 critical、multiple-plausible-solutions、new-family 或 user-requested
理由前，不应自动启动竞争。

## 2026-07-30 已关闭的解释缺口

Task `c9d8a2bc-ee01-44b5-8f64-d0b473a9078f` 让 routing response 为每个候选保留一份紧凑的 exact/family
样本覆盖，而不是复制完整证据对象。现在上述真实查询会显示 MiniMax **2/5**、Grok **12/5**，同时仍返回
`knowledge=unknown`、无 recommendation、无 Competition。Hub 用中英文说明“已有相关历史，但还不能公平
比较”，不把样本量说成模型质量。

Grok 只执行 1 Attempt / 11 turns。Main 发现 family evidence 已够但得分接近时，第一版会错误回看 sparse
exact counts 并显示“样本不足”；Main 保留 Candidate、做一次有界修复，再用 `forklight reverify` 跑完原
5 条验收，新增 Worker Tokens 与模型运行成本均为 0。最终 revision
`61aa023b-12ce-473b-b548-df18e6299812`，Integration
`4e4f031e-0767-42ba-ab73-b0cd106f2567` 四阶段通过。Worker usage missing，因此不能声明 Token 节约。

## 2026-07-30 已关闭的首次通过证据缺口

Task `305f3f3b-d2d7-4179-984e-2213ed88f370` 增加独立的首次验收样本、成功率和不可用计数，默认路由
权重为 0.5 且可在 Hub 调整。只有所有候选都有可比证据时该因子才参与；缺失、凭据、Provider 连接、
预算、workspace、interruption 和正式修改验收口径的结果都不会变成模型失败。零历史完整 Worker 身份也
不再显示 `unknown/unknown`。Grok 的 25-turn Candidate 首次机器验收为 1 条夹具失败；Main 保留实现、
补齐夹具和外部失败优先边界，原地零 Worker 复验后 focused **332/332**、full **1,899/1,899**。

这次真实复验随即发现一个更深的事实错误：同一个 Attempt 后来由 Main 修好并复验通过时，通用
`verificationFrom` 会返回最新结果，导致路由把原本首次失败显示成首次成功 **1/1**。Task
`4a5e7421-83e9-41d2-8a16-c3e508a6e2fe` 用 5-turn Grok Attempt 增加首个验收投影；Main 审查又挡住了
一个越界回退——最终验收最新记录损坏时仍必须 fail closed，不能偷偷采用更早记录。保留同一 2-file
Candidate、零 Worker 复验后 focused **49/49**、full **1,902/1,902**。生产查询现在正确返回首次通过
**0/1**，同时保留最终已接受交付。两个 Main 复验的增量 Worker Token 和模型运行成本都为 0。

两次 Grok usage 都缺失，不能给出 Worker Token 或官方费用；runtime estimate 分别约 USD 0.9604032
和 USD 0.163348，合计约 USD 1.1237512。没有 exact-pair Direct Codex baseline，因此不声明节约了多少
Main Token。

## 2026-07-30 已关闭的“机器成功冒充 Main 接受”缺口

只读审计发现，旧 `acceptedDelivery` 直接把所有 `task.status=succeeded` 计为最终接受。149 个机器成功
Task 中，当时只有 88 个 latest Main accept，另有 48 个未审、12 个 revise 和 1 个 reject；因此这个数
不是“Main 最终接受率”。明确 reject 的 Task
`5e5ad6a1-0cfb-4e64-814b-cd3e9faa8ff4` 没有 Integration/remediation，却也被旧逻辑奖励。

Grok Task `009f4dbf-8ad4-488d-b0b8-44007f462a8c` 用一套共享判定同时修正 provider statistics 和 routing：

- **accepted：** 当前精确 Main accept、已核验 Main 修复交付、或 durable applied Integration；多个来源仍只算一个 Task。
- **not accepted：** 当前 reject/revise，或没有后续交付的模型质量失败。
- **unavailable：** 机器成功但仍待 Main、外部/策略/模糊失败，以及过期或损坏的接受绑定。

路由的已接受交付因子只在每个候选都有足够 `accepted + not accepted` 可比样本时参加；未知不再被压成零，
flexible 模式可继续使用其他完整因子，strict 模式保持不决定。Hub 直接显示“Main 接受了多少次可比结果、
另有多少次仍不知道”，不把机器检查通过写成最终交付。

第一 Candidate 只有一个 UI 注释标点触发现有规范；Main 同时发现现代 accept 只检查 Revision ID、遗漏补丁摘要
的边界。Main 在同一 Candidate 做两处有限修正并零 Worker 复验，原 5 条命令全部通过，full
**1,908/1,908**。最终 revision `d2465096-66d7-4540-967a-c6dba69516ce`，Integration
`f34fd1bb-2784-44dc-97e5-d562504bb0d3` 四阶段通过。

合入后直接用生产数据库复核上述 reject，又发现它是早期记录：Main reject 精确绑定当前 Attempt 2 和
verification 550，但在当时还没有写 revision id/digest。第一版已经停止假成功，却把它归为 unavailable。
Main 没有反复调参数或重跑整个功能，只新建一个两文件兼容 Task
`823bd71b-238e-4549-81d4-8ae8e69d056a`。Grok 用 1 Attempt / 8 turns 完成；旧版 reject/revise 仅在两个
revision 字段都缺失且 Attempt/verification 完全当前时，才能作为负样本，绝不能成为接受权限；半截、错误或
过期绑定仍不可用。focused **55/55**、full **1,911/1,911**。生产结果现在为机器成功 **1**、Main 接受
**0/1**、未接受 **1**、未知 **0**。Integration `cd562157-5a99-43d7-9131-b58916c493ce` 四阶段通过。

两次 Grok terminal usage 都缺失，官方费用和 Worker Token 不可用；runtime estimate 分别约 USD 1.3638228
和 USD 0.2348328，不是账单。第一次 Main reverify 明确记录 Worker invoked=false、增量 Worker Token=0、
模型运行成本=0。没有 exact-pair Direct Codex baseline，因此仍不声明节约了多少 Main Token。

## 接下来的最低浪费积累规则

1. 严格 M3 进度只统计自然产生、terminal、带 type + family + Main selection decision 的真实 Task；当前
   **20/30**，还需至少 10 条，不为达标单独创建 Task。
2. 普通确定性任务仍只派 1 个 Worker。选择理由进入记录，但不要求轮流照顾各模型。
3. 只有显式高风险多解、关键任务、新 family 或用户要求时，才运行最多 2 个候选的 Competition；先说明
   这次比较会改变什么决策。
4. 继续把首次机器结果、Main 修正、最终接受交付、官方成本、runtime estimate 和 Token 口径分开。
5. M4 的 exact-pair 必须另行获得用户对“重复做同一任务”的批准；M3 自然样本不能冒充 Direct Codex 基线。

## 2026-07-29 当时的证据能证明什么

数据库共有 **229** 个 Task：

- **114** 个没有 `taskClass`，不能进入按任务类型的模型比较。
- 其余 **115** 个 Task 被分成 **88** 个 exact task class。
- 其中 **71** 个 class 只有 1 个样本，12 个只有 2 个，只有 5 个达到 3 个以上。
- 只有 **4** 个 class 同时拥有至少 3 个 Task 和 2 个模型；没有一个 class 能让每个候选模型达到
  当前 `minRelevantSamples=5` 的推荐门槛。
- 当前有 2 条 complete direct-Codex pair，并且都已经发布为 `sampleSize=1`、`confidence=low` 的
  exact profile calibration；但二者的 task class 与 Codex profile 各不相同，只能解释各自那个
  具体案例，不能合并或推广成跨任务的节约结论，也还不能满足 M4 的任务类型组合要求。

因此当前 M3 不能声称“已经知道某类任务哪个模型最好”。Exact class 太碎、旧数据缺 class、四个
模型的任务难度和合同并不相同，任何全局胜率排序都只能用于发现问题，不能直接驱动自动选择。

## 机器终态、首次通过与最终交付必须分开

下面是 2026-07-30 21:56 CST 的全局诊断表。`机器终态成功` 只读 Task 顶层结果，并不是新路由中的
Attempt-one 首次通过率；首次通过证据按 exact type/family 单独保存和比较。`Main 接受交付` 的分母只包含
accepted + not accepted，未知不进入分母。

| Worker | terminal Task | 机器终态成功 | Main 接受 / 可比 | 未知 | 其中 Main 修复交付 |
| --- | ---: | ---: | ---: | ---: | ---: |
| DeepSeek `deepseek-v4-pro[1M]` | 95 | 52（55%） | 59/86（68.6%） | 9 | 17 |
| MiniMax `MiniMax-M3` | 64 | 23（36%） | 18/41（43.9%） | 23 | 7 |
| Volcengine `glm-5.2[1M]` | 18 | 11（61%） | 13/14（92.9%） | 4 | 8 |
| xAI `grok-4.5` | 88 | 66（75%） | 62/68（91.2%） | 20 | 12 |

这张表不能证明 GLM 全面强于其他模型：样本量、任务类型和合同难度不同。但它能证明结果判定不能
停在 Task 的机器终态。四个当前 Worker 共 **44** 个被接受的交付来自 Main 保留成果后的受控修正；
如果 UI 或路由把它们统称为失败，就会错误丢弃可用工作，也会诱导整单重跑。

平均 turns 与 runtime estimate 也不能直接作为模型排名：Grok 的 usage 不完整；MiniMax 和 GLM
承担了不同的长合同；runtime estimate 不是 Provider 账单。当前 cost、duration、budget reliability
的 routing 权重保持 0 是正确的，直到同任务类型、同边界的可比数据足够。

## 2026-07-29 当时的竞争建议为什么容易浪费

只读调用 `routing standard-feature` 并传入四个已配置 Worker 时：DeepSeek 1M 有 4 个相关 Task，
MiniMax 有 3 个，GLM 与 Grok 都是 0；所有有效质量因子因样本不足被关闭，最终仍返回
`shouldRunCompetition=true`。这不是“应该启动四个模型”的证据，只表示 exact-class 数据不足。

如果 Main 每次都把所有已配置 Worker 放进候选集，任何新任务类型都会因为零样本模型存在而进入
competition 建议，和“只在关键、高不确定、新类型或用户明确要求时竞争”的产品目标冲突。

## 立即生效的 Main 决策规则

在代码升级前，Main 按以下规则使用现有只读 advisory：

1. 普通、边界清楚、验收确定的任务只选择 **1 个** Worker，不因缺历史数据竞争。
2. 只有任务关键、语义方案确实有多个高风险解法、首次遇到的新任务家族、或用户明确要求时，才把
   候选扩到 **2 个**；除非用户明确要求，不默认启动 3–4 个相同任务实现。
3. 候选集先由 Main 根据 runtime readiness、任务边界和相关交付经验收窄；routing 只比较这份合理
   shortlist，不能把“已配置”当成“适合本任务”。
4. 结果判定顺序是：机器行为验收 → Main 语义审查 → 可复用路径与剩余缺口 → 最终交付。机器首次
   失败不等于没有成果，Main 修正后交付也不反向改写首次结果。
5. 优先同 Candidate 的一次定点纠正或零 Worker reverify；只有合同已经变化、成果不可复用或换模型
   能解决明确能力缺口时才新开 Task。达到配置上限后停止并交回 Main。
6. 鉴权、网络、基线、错误验收合同、生成物或 Integration 门禁不计入模型质量；模糊失败保持未知，
   不用猜测给模型扣分。

这些是 Main 的可覆盖执行规则，不修改用户设置，也不启用自动路由。

## 2026-07-29 当时的下一项产品能力（现已实现）

推荐把一次任务选择拆成两个用户可理解的输入，而不是继续调分数：

- **稳定任务家族：** Main 在 exact `taskClass` 外再写一个较稳定、可配置的 family，例如“界面可读性”、
  “后端状态流转”、“运行环境诊断”。Exact class 继续用于审计，family 用于积累跨项目可比样本。
- **竞争触发原因：** Main 明确写入 `critical`、`multiple-plausible-solutions`、`new-family` 或
  `user-requested`；单纯 `missing-evidence` 只显示“不知道”，不自动等价为“值得花双倍成本”。

Hub 应先告诉用户“为什么选这个 Worker、为什么没有竞争”，再把样本数和评分放进折叠证据。
所有 family、触发条件、最小样本数、候选数和偏好权重都应可配置；系统只保证配置生效、证据可见、
循环有上限，不通过开发期反复试参数寻找一个写死答案。

这条产品路径后来已经确认并实现。当前真实状态、严格 20/30 进度、选择规则和仍未完成的比较证据，
以本文顶部的 2026-07-30 追踪为准。
