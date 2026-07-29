# Worker 选择与结果判定证据审计

更新时间：2026-07-29

## 用户真正需要的结果

Main 应该用足够少的 Worker 完成任务，并能解释为什么选它；Worker 第一次没有完全通过时，Main
要先判断成果能否保留，再决定定点纠正、换 Worker 或停止。用户不应因为系统缺少历史数据就默认
支付多模型竞争成本，也不应把机器首次失败误解为最终没有交付。

本审计只读取当前 ForkLight 数据库和只读 routing advisory，没有启动 Worker、Provider probe、
competition、retry 或 adaptation，也没有修改任何模型设置。

## 当前证据能证明什么

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

## 机器首次结果与最终交付必须分开

| Worker | Task | 机器首次成功 | Main 接受交付 | 其中 Main 修正后交付 |
| --- | ---: | ---: | ---: | ---: |
| DeepSeek `deepseek-v4-pro[1M]` | 94 | 51（54%） | 68（72%） | 17 |
| MiniMax `MiniMax-M3` | 57 | 18（32%） | 25（44%） | 7 |
| Volcengine `glm-5.2[1M]` | 16 | 9（56%） | 16（100%） | 7 |
| xAI `grok-4.5` | 14 | 5（36%） | 10（71%） | 5 |

这张表不能证明 GLM 全面强于其他模型：样本量、任务类型和合同难度不同。但它能证明结果判定不能
停在 Task 的机器终态。四个当前 Worker 共 **36** 个被接受的交付来自 Main 保留成果后的受控修正；
如果 UI 或路由把它们统称为失败，就会错误丢弃可用工作，也会诱导整单重跑。

平均 turns 与 runtime estimate 也不能直接作为模型排名：Grok 的 usage 不完整；MiniMax 和 GLM
承担了不同的长合同；runtime estimate 不是 Provider 账单。当前 cost、duration、budget reliability
的 routing 权重保持 0 是正确的，直到同任务类型、同边界的可比数据足够。

## 当前竞争建议为什么容易浪费

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

## 下一项产品能力：先对齐再实现

推荐把一次任务选择拆成两个用户可理解的输入，而不是继续调分数：

- **稳定任务家族：** Main 在 exact `taskClass` 外再写一个较稳定、可配置的 family，例如“界面可读性”、
  “后端状态流转”、“运行环境诊断”。Exact class 继续用于审计，family 用于积累跨项目可比样本。
- **竞争触发原因：** Main 明确写入 `critical`、`multiple-plausible-solutions`、`new-family` 或
  `user-requested`；单纯 `missing-evidence` 只显示“不知道”，不自动等价为“值得花双倍成本”。

Hub 应先告诉用户“为什么选这个 Worker、为什么没有竞争”，再把样本数和评分放进折叠证据。
所有 family、触发条件、最小样本数、候选数和偏好权重都应可配置；系统只保证配置生效、证据可见、
循环有上限，不通过开发期反复试参数寻找一个写死答案。

在一骏确认这条产品路径前，不修改 Task schema、routing API 或 Hub，也不启动实现 Worker。
