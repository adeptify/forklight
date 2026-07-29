# M3 V1：Worker 选择与竞争的 Hub 解释验收矩阵

状态：等待核心原则确认，尚未实现运行行为  
配套方案：`docs/model-selection-strategy-v1.md`  
证据审计：`docs/model-selection-evidence-audit-2026-07-29.md`

## 用户首先需要知道什么

Hub 不是展示内部字段的监控器。用户打开一次 Worker 选择或 Competition，只需要先回答五个问题：

1. 这是什么类型的工作？
2. Main 最终派给了谁，为什么？
3. ForkLight 对这个选择有历史证据，还是还不知道？
4. 为什么只派一个，或者为什么值得多花一次竞争成本？
5. Worker 做完后，机器检查和 Main 最终判断分别是什么？

Provider、模型、runtime、Profile、分数和内部 ID 仍可查看，但放在“执行身份”或“技术详情”中，不能
代替上面五个答案。

## 当前行为的已测证据

| 场景 | 当前证据 | 当前容易形成的误解 | V1 要修正为 |
| --- | --- | --- | --- |
| 四个候选在新任务类下都没有样本 | `routing brand-new-family` 返回 `recommendation=null`、四个候选样本均为 0，同时 `shouldRunCompetition=true` | “ForkLight 不知道”看起来等同于“应该同时多跑几个模型” | 只显示“目前还不知道”；没有 Main 竞争原因时不建议竞争 |
| 历史 Competition 已创建 | 已检查的五个 Competition 都没有结构化竞争原因 | 用户能看到两个模型，却不知道为什么值得付两份执行成本 | 创建前必须保存 Main 原因；旧记录明确显示“历史任务未记录原因” |
| 历史 Competition 候选身份 | 状态接口只给出 provider/model，没有候选自己的 runtime、effort 和 Worker Profile 来源 | 看起来像同一种执行方式换了模型，无法判断是否真的比较了两个 Worker | 冻结并显示每个候选的完整执行身份；非法组合在启动前拒绝 |
| 机器找到唯一通过检查的候选 | Competition `1fe3eb19-...` 推荐 DeepSeek，理由是它是唯一通过检查的候选 | “当前推荐”可能被理解成 Main 已接受并准备合入 | 显示“机器检查：只有 DeepSeek 达到比较门槛；等待 Main 判断” |
| 机器按分数排出第一名 | Competition `413915fc-...` 推荐 MiniMax，置信度 0.2 | 低区分度的机器排名容易被理解成最终 Winner | 默认不使用“胜者”；只有 Main 对具体 Candidate Revision `accept` 后才显示“最终选择” |
| 两个候选都未通过检查 | Competition `c934f768-...` 两个候选均不合格，没有 recommendation | 用户只知道没有推荐，不知道成果是否还能保留 | 显示各自失败在什么检查、是否有可保留部分、由 Main 决定修正/接力/停止 |

上表来自当前 Daemon 的只读 CLI/API 结果与 Hub 源码。真实 Hub 页面当时是未认证会话，本轮没有读取或
转发本地 Hub token，因此这些证据能证明数据与文案路径，不能冒充已完成的视觉布局验收。实现后仍需
在认证页面做中英文、层级、折叠和窄屏浏览器检查。

## Hub 的固定叙事顺序

### 提交前：选择说明

固定顺序是“工作类型 → 证据结论 → Main 选择 → 竞争决定 → 成本影响”。

推荐样式：

> 这是一个界面可读性任务。ForkLight 暂时没有足够的同类记录，无法判断哪个 Worker 更好。Main
> 选择 MiniMax 先完成，因为任务边界清楚且它当前可用。本次不竞争：多跑一个模型不会明显降低风险。

不能只显示：

> 证据不足；建议竞赛；MiniMax-M3 / score 0.62。

### 执行中：发生了什么

固定顺序是“Main 发出的任务 → 每个 Worker 当前动作 → 最近有效进展 → 是否需要用户动作”。安静思考、
Provider 请求中、工具执行和真正无进展必须分开；等待窗口结束不能改写 Worker 状态。

### 执行后：结果判断

固定顺序是“是否达到目标 → 机器检查 → Main 判断 → 保留成果 → 下一步”。机器比较永远放在 Main 判断
之后，并使用“机器比较顺序”，不用“胜者”。

## 场景与用户文案矩阵

| 证据 / 竞争意图 | Hub 首要结论 | 必须说明 | 禁止暗示 |
| --- | --- | --- | --- |
| `unknown + none` | 目前还不知道谁更适合；Main 选择 X 先做 | Main 的选择理由；任务为何不值得竞争 | 不知道 = 应该竞争 |
| `recommendation + none` | 历史证据更支持 X；Main 选择 X | 使用 exact 还是 family 证据、各有多少有效样本、Main 可覆盖 | 推荐 = 已自动派发或永久默认 |
| `unknown + consider:new-family` 且设置允许 | 这是缺少历史的新类型；Main 建议用两个 Worker 做一次有界验证 | 选择哪两个、额外成本、一次性学习目标和停止条件 | 为了“积累数据”无限竞争 |
| `recommendation + consider:critical` | 历史更支持 X，但 Main 因任务关键建议第二候选复核 | 风险理由，而不是伪装成证据不足 | 有推荐就无需复核，或复核自动合入 |
| `required:user-requested` | 你明确要求比较这些 Worker | 候选、边界、预算和完成后的 Main 判断 | 用户要求可绕过 readiness、安全或权限边界 |
| 机器检查未完成 | Worker 已返回，机器还在检查 | 当前检查、等待什么 | 已完成、已接受、已有胜者 |
| 机器有排序、Main 未审查 | 机器检查更支持 X；等待 Main 判断 | 达标候选、失败候选、机器排序依据 | “最终选择”“准备合入” |
| Main `accept` | Main 已接受 X 的这一版结果 | 接受的 Candidate Revision、通过的关键验收、是否等待 Integration 授权 | 机器分数代替接受理由 |
| Main `revise` | Main 保留当前成果，并要求一次定点修正 | 已保留什么、剩余缺口、纠正上限 | 整单从头重跑、无限修复 |
| Main `reject` | Main 不接受本次交付 | 关键缺口、是否有可复用部分、停止或接力建议 | 失败历史被覆盖、自动重试 |
| `retained-partial` | 这部分可被后续 Worker 接手，但尚未形成交付 | 可复用路径/产物、未解决缺口、来源 Candidate | 部分成果已经合入或已达到目标 |

## 中英文与可读性规则

- 中文和英文必须表达同一个结论，不能一边叫 recommendation、另一边叫 winner。
- 首屏不用 `Candidate Revision`、`runtime`、`evidence scope` 等词解释结果；分别说“这一版结果”、
  “执行方式”和“使用了哪一类历史记录”。技术名词只放折叠详情。
- 任何百分比或分数旁边都要说它回答什么、不回答什么。例如“证据区分度”不等于正确率，也不代表
  Main 接受。
- 失败先说“发生在哪一步、造成什么影响、下一步怎么办”，原始 stderr、命令输出和内部 ID 折叠展示。
- 输入、过程、输出和最终交付不得互相覆盖；Worker 成功、机器验收通过、Main 接受和 Integration 成功
  是四个不同事实。

## 数据与 UI 的验收边界

### 数据层必须证明

- Task 保存 Main 选择快照，Competition 保存竞争原因和每个候选冻结后的完整 Worker 身份。
- “未知”与“值得竞争”是独立字段；缺少样本不能单独产生竞争建议。
- 机器比较结果与 Main 最终决定分开保存，并绑定准确 Candidate Revision。
- 旧记录没有原因或身份时返回 unavailable，不回填、不猜测。
- 设置变化只影响未来决定，不改写历史快照。

### Hub 必须证明

- Models、Competition Detail 和 Task Detail 使用同一套结论，不在三个页面产生三种说法。
- 默认视图能回答本文件开头五个问题；内部明细可以折叠，但不是删除。
- 两个候选都失败时不会把列表第一项当成胜者；机器有 recommendation 时也不会显示 Main 已接受。
- `unknown + none` 的真实页面不出现“建议竞赛”。
- 中英文逐场景快照/DOM 断言覆盖上述矩阵，最终用认证 Hub 做浏览器视觉检查。

## 实现检查顺序

1. parser/types/settings 的兼容与快照测试。
2. statistics/routing 的 exact → family → unknown 测试，以及 unknown 不触发竞争。
3. Competition mixed-runtime 身份、原因快照与机器/Main 分层测试。
4. Daemon、CLI、MCP 对同一决策返回一致数据。
5. Hub 中英文场景测试、JavaScript syntax、真实认证页面浏览器验收。
6. 全量测试、TypeScript build、`git diff --check`。

正式实现仍按策略蓝图拆成两个顺序 Task，不允许两个 Worker 在同一旧基线上竞争修改。每个 Task 只有
一个基础 Attempt 和至多一个同 Candidate 定点修正；达到上限后交回 Main。
