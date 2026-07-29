# M4 Main Token 价值证据与最小采样方案

更新时间：2026-07-29

## 先说结论

ForkLight 已经有两条真实、已接受并正式发布的 Direct Codex 对照样本。它们都能证明：在各自那一个
具体任务中，Main 通过 ForkLight 交换的 Token 明显少于 Codex 直接完成任务使用的 Token。

但这还不能证明“ForkLight 通常更省 Token”或“总体成本一定更低”。两个样本属于不同任务类型、使用
不同 Codex profile，而且每组只有一个样本；其中一个样本还缺少现代 Main Review 和完整候选版本链。
当前正确结论是：**两个具体案例有效，跨任务结论未知。**

本轮只读取已有数据库、Task、校准发布和 Token 报告，没有启动 Worker、Direct Codex 对照、竞争、
retry 或 adaptation，也没有新增模型费用。

## 四个数字必须分开

| 用户想知道什么 | 当前系统实际测量什么 | 可以怎样解释 |
| --- | --- | --- |
| Main 少处理了多少 | ForkLight 中 Main 的请求与响应交换量，对比相同任务的 Direct Codex 用量 | 只有 exact-pair 才叫“节约 Main Token” |
| Worker 做了多少 | Worker runtime 返回的输入、输出和缓存 Token | 是执行规模，不等于 Main Token，也不直接等于费用 |
| 总体是否更省 | Main 交换量、Worker 用量、纠正次数、时间和最终质量 | 不同 Provider 的 tokenizer、缓存和计费不同，不能只把 Token 相加后直接下结论 |
| 实际花了多少钱 | Provider 官方账单或能够对应官方价格表的精确 usage | runtime estimate 只能辅助观察，不能冒充账单 |

“节约 Main Token”回答的是 Main 是否被减负，不等于 Worker 免费，也不等于整个系统必然更便宜。

## 当前两条 exact-pair 证据

下表取自当前 Daemon 的 `forklight tokens` 报告和已发布 calibration。交换量算法升级后区间比早期
项目日志更宽，因此这里以当前报告为准。

| 对照样本 | Direct Codex | ForkLight Main 交换量 | 可报告的 Main Token 节约 | Worker 执行量 | 质量与交付状态 |
| --- | ---: | ---: | ---: | ---: | --- |
| CLI calibration adapter；MiniMax M3；1 Attempt | 4,183,926 | 95,138–580,511 | 3,603,415–4,088,788（86.13%–97.73%） | 1,268,566 | 独立验收通过，旧流程已 applied；但属于 legacy Task，没有现代 Main Review，候选版本链不完整 |
| guided capture clients；DeepSeek 1M；2 Attempts | 3,807,830 | 109,101–666,735 | 3,141,095–3,698,729（82.49%–97.13%） | 3,417,687 | 首轮检查失败后只纠正同一 Candidate；独立验收与 Main 语义审查通过，纠正成本已计入；尚未 Integration |

两条报告都是 `exact-registry-hit`、publication version 1、sample size 1、low confidence。各自的
publication preview 都显示 `no-new-evidence`：现有样本已经进入 version 1，只有同一 exact task class
和同一 Codex profile 的新接受样本，才能形成下一版。

## 这些证据不能证明什么

- 不能把两个百分比平均后宣传为 ForkLight 的平均节约率。
- 不能把 MiniMax、DeepSeek 与 Codex 的 gross Token 当成同一种计量单位直接比较价格。
- 不能从这两个工具链功能推断 small fix、普通产品功能或大规模重构的结果。
- 不能只因测试通过就认为质量相同；两边都要经过独立行为验收和 Main 语义审查。
- 不能忽略纠正。第二个样本的第一次失败和第二次定点纠正都必须进入成本与质量记录。
- 不能得出时间结论；当前没有相同条件、口径完整的直接执行时长对照。

当前实现还存在一个信任缺口：publication 的 `low / medium / high` 由 Main 在发布时明确填写，系统
只校验取值是否合法，不根据样本数和稳定性自动限制。现有两条正确地标为 `low`，但未来 Hub 应在
置信度旁说明“由 Main 声明”，并让用户配置最低样本门槛。

## 最小公平采样方案

目标不是为了凑样本反复做同一份工作，而是用最少的重复成本回答三个真正不同的问题。

### 第一轮：只新增 3 个低成本真实样本

1. `calibration-small-fix-v1`：一个边界清楚、验收确定的真实小修复。
2. `calibration-standard-feature-v1`：一个包含输入、状态变化和用户输出的普通功能。
3. `calibration-refactor-v1`：一个行为不变、结构明显调整的重构。

每类先做 **1 组**，不默认一上来做 3–5 组。第一组的结果只有在会影响产品决策、区间过宽或质量
差异需要复核时，才追加第二组。这样先覆盖 M4 要求的任务类型，而不是为提高样本数无目的消耗。

### 每一组怎样保证公平

- 选择本来就需要完成的真实任务，不造无价值的 demo。
- 冻结同一个 source revision、完整 Task Contract、focus paths、验收命令和 Codex profile。
- Direct Codex 与 ForkLight 从两个隔离工作区读取同一份冻结基线；任何 source drift 都让该组作废。
- 两边都必须独立运行相同验收，并由 Main 按相同产品目标审查；只通过一边时，记录真实质量差异，
  不为了得到漂亮 Token 数强行接受。
- 记录执行先后，避免 Main 看过一个实现后无意中帮助另一个实现。
- ForkLight 路径默认 1 个 Worker、无 competition；最多允许 1 次同 Candidate 定点纠正，且完整计入。
- 记录 Direct Codex 用量、Main 交换量、Worker 用量、官方费用、runtime estimate、执行时长、纠正、
  最终质量与 Integration 状态；缺失项保持 unavailable。
- 每一组都会故意重复实现同一个任务，因此开始前由一骏逐组确认，不把它变成后台自动开销。

### 可配置的置信度默认建议

这不是当前已经生效的硬规则，而是后续实现时的默认建议；用户应能在高级设置里调整。

| 置信度 | 建议默认门槛 |
| --- | --- |
| Low | 同一 exact task class × Codex profile 至少 1 条接受样本 |
| Medium | 至少 3 条接受样本，且每条都有完整质量审查，没有未解释的重大差异 |
| High | 至少 5 条接受样本，节约区间和质量结果达到用户配置的稳定性门槛 |

置信度只描述该 exact class/profile 的证据强弱，不能自动跨任务家族、跨 Codex profile 或跨版本继承。

## 推荐的下一步

先选一个真实 small fix 做第一组新 exact-pair，因为它的重复实现成本最低，也正好补当前证据组合中
最明显的空白。开始前冻结合同并让一骏确认这次重复成本；不并发竞争，不为“刷置信度”连续追加样本。

