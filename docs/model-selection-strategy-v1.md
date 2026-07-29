# Worker 选择与竞争理由 V1 实现蓝图

状态：等待一骏确认，尚未实现  
依据：`docs/model-selection-evidence-audit-2026-07-29.md`  
Hub 解释验收：`docs/model-selection-ux-acceptance-v1.md`

## 先用白话说清楚

当前 ForkLight 能比较几个模型的历史结果，但它把两件事混在了一起：

1. **系统知不知道哪个 Worker 更合适。**
2. **这次任务值不值得同时花两份或更多成本。**

“不知道”不等于“应该竞争”。V1 把它们拆开：路由只回答知道或不知道；Main 再根据任务是否关键、
是否有多种高风险解法、是否值得为新类型做实验、或用户是否明确要求，决定是否竞争。

同时，现有 `taskClass` 太细，几乎每个功能都是一个新名字。V1 额外保存一个稳定的大类，例如同一家公司
不同项目里的“界面可读性”任务可以积累在一起；精确任务名仍然保留，用于审计和 exact-pair Token
对照，不会被大类替代。

## 用户最终会看到什么

提交前，Main/Hub 用一句话回答：

- 这次属于哪类工作。
- 选择哪个 Worker，依据是什么。
- 历史证据是否足够。
- 为什么只派一个，或者为什么值得竞争。

例如：

> 这是一项后端状态流转任务。历史样本还不足以自动推荐；Main 根据 DeepSeek 在复杂状态合同中的
> 交付经验选择单 Worker。本任务边界清楚、验收确定，因此不竞争。

如果证据不足但没有竞争理由，Hub 显示“目前还不知道哪个更好，Main 已选择一个先做”，不再显示
“建议竞争”。

提交前、执行中、机器比较和 Main 最终判断的逐场景文案与数据边界，统一按
`docs/model-selection-ux-acceptance-v1.md` 验收；实现不能只替换当前“建议竞赛”文案而保留相同的
隐含自动决策。

## 输入、输出与边界

### Main 产生的选择快照

每个新 Task 可选保存一个 `taskFamily` 和一份不可变的 `routingDecision`：

- `taskFamily`：稳定的大类 ID，最长 80 字符；由 Main 明确填写，不从名称或 Prompt 猜测。
- `shortlist`：Main 真正考虑过的 Worker。每项同时冻结 Worker Profile 来源和解析后的 provider、model、
  runtime、effort；不能只保存可被以后设置修改的 Profile ID。
- `selectedWorker`：最终选择的那一项，必须和 Task 实际 provider/runtime/profile 一致。
- `selectedBecause`：结构化原因 code 加一段有长度限制的白话说明，例如相关交付经验、运行时能力、
  用户指定、当前唯一可用或 Main 判断。
- `competition.intent`：`none`、`consider` 或 `required`。
- `competition.triggers`：关键任务、多种高风险解法、新任务家族、用户明确要求中的一个或多个。
- `evidenceSnapshot`：选择时使用的范围、各候选样本数和设置版本；不保存 Prompt、响应或完整统计明细。

Worker 身份不能只用 `provider/model`。V1 的可比身份至少包含冻结后的
`provider + model + runtime + effort`；`workerProfileId` 只作为配置来源展示。同一个 Profile 后来被编辑，
不会反向改变历史 Task 的身份或解释。

字段名称是实现建议，不是已经冻结的公开 API。正式实现时保留现有 `taskClass` 和
`directCodexProfileId` 语义，不能用 family 做 exact-pair Token 声明。

### 路由消费的内容

路由只读取：精确 task class、可选 task family、解析后的合理 Worker shortlist、当前只读设置和历史
终态证据。新入口优先接收 Worker Profile ID 并由 Daemon 解析成完整身份；旧的 provider/model 候选
继续兼容，但明确标为 legacy identity，不能假装已经检查 runtime、effort 或 Profile readiness。

证据选择顺序：

1. 所有候选都有足够 exact-class 样本时，使用精确类型。
2. 否则，所有候选都有足够 family 样本时，使用稳定大类。
3. 两者都不足时，返回“证据不足”，不拼接零分、不猜测相似类。

返回结果额外说明 `knowledge=recommendation | unknown`、
`evidenceScope=exact-class | task-family | none`，以及每个候选实际使用的样本数。一个范围内只要有候选
达不到门槛，就整组退到下一层；不能让不同候选混用 exact 与 family 后放进同一张排名。

### Competition 消费的内容

是否竞争不再由 `uncertain && competitionOnUncertainty` 单独决定：

- `none`：无论证据是否不足，都不建议竞争。
- `consider`：至少有一个明确触发原因、该原因被当前用户设置允许时才建议。`new-family` 还要求当前
  family 确实没有足够证据；`critical`、`multiple-plausible-solutions` 与 `user-requested` 可以在路由已有
  推荐时仍成立，因为它们表达的是任务风险，不是“系统不知道”。
- `required`：用户/Main 已明确要求竞争；不受建议开关影响，但仍必须满足候选数、Worker readiness、
  runtime/provider 配对、安全权限和预算边界。

真正提交 Competition 时，把原因和解析后的 shortlist 快照存入 Competition record。新入口缺少原因
时在 Provider 调用前拒绝；旧 CLI/MCP 的显式 competition 调用为了兼容仍可执行，但必须保存为
`legacy-explicit-submit / reason-unavailable`，Hub 不能为它编造原因。

### Worker 执行结果怎样判定

当前 Competition 会在机器验收通过的候选之间根据改动聚焦度、retry、成本和时长给出
`recommendation`。这只能叫“机器比较顺序”，不能叫最终 Winner：它没有证明 Main 接受了产品语义，
也不会识别一个失败 Candidate 中仍可复用的部分。

V1 把结果分成两层：

1. **机器比较：** 独立行为验收是进入可交付候选集的前提；成本、时间、改动规模只在达到质量门槛的
   候选之间排序。没有合格候选就返回“没有可交付结果”，不能从失败项里硬选第一名。
2. **Main 决定：** Main 对最终 Candidate Revision 做 `accept / revise / reject`，并可把其他 Candidate
   标记为 `retained-partial`。只有 `accept` 才是最终选择；`revise` 进入一次受控同 Candidate 纠正，
   `retained-partial` 留给 M2 接力，不触发整单重跑。

Hub 先展示“有没有达到目标、Main 最终怎么判”，再展示机器排序。自动比较永远不能自动 Integration；
失败 Task、可保留成果、纠正成本和最终交付分别记录，达到配置的纠正上限后交回 Main。

## 代码模块的生产与消费行为

| 模块 | 生产什么 | 谁消费 | 边界 |
| --- | --- | --- | --- |
| Task parser/types | 冻结的 family、Worker 身份与选择快照 | Daemon、Hub、统计 | 旧 Task 可读；不推断、不回填、不改变 provider/runtime |
| Worker Profile resolver | Profile ID → 冻结 provider/model/runtime/effort/政策 | Task/Competition 创建 | 解析一次后快照；设置变化不改历史身份 |
| Statistics | exact 或 family、同 Worker 身份的分组证据 | Routing | 非模型失败继续排除；family 不进入 exact-pair Token 口径 |
| Routing core | 推荐/不知道、证据范围、竞争建议依据 | CLI、MCP、Hub | 只读；不能启动 Worker、改设置或永久排除模型 |
| Competition coordinator | 实际竞争原因、解析后的候选快照和机器比较 | Hub、审计、长期统计 | mixed-runtime 候选逐个解析；没有明确授权仍不能自动提交 |
| Main result decision | accept/revise/reject/retained-partial | Hub、Integration、M2 接力 | 绑定最终 Candidate Revision；机器分数不能替代 Main |
| Settings | family 样本门槛、允许触发原因、默认/最大候选数 | Routing、Hub | 修改只影响未来建议，不改历史 Task 快照 |
| Hub | 白话选择结论、是否竞争、原因与下一步 | 用户 | 原始分数、reason code、样本明细默认折叠 |

## 调用链

```text
Main 对齐任务
  → 写 taskClass + taskFamily
  → 先收窄合理 Worker Profile shortlist，并解析完整身份/readiness
  → Routing 比较 exact-class，必要时退到 family
  → 返回“推荐”或“证据不足”，同时说明证据范围
  → Competition policy 检查 intent + trigger + 用户设置
  → Main 最终选择单 Worker或显式 Competition
  → Task / Competition 冻结选择原因
  → Worker 执行 + 独立验收
  → 机器比较只形成候选顺序
  → Main 对最终 Candidate Revision 作 accept/revise/reject/retained-partial
  → Hub 用白话展示原因、执行、保留、修正与最终交付
```

路由和竞争之间没有自动 mutation；Main 的最终确认仍是边界。

## 全部可配置，但不靠反复试参开发

计划新增的设置：

- `familyMinRelevantSamples`：family 推荐所需样本数。
- `competitionTriggersEnabled`：哪些显式原因允许 `consider` 建议竞争。
- `defaultCompetitionCandidates`：建议竞争时默认候选数，建议默认 2。
- `maxCompetitionCandidates`：保留现有上限能力。
- `competitionOnUncertainty`：保留为兼容总开关，但“开启”本身不再构成竞争理由；没有 intent + trigger
  时仍返回不竞争。
- `resultSelection`：保留现有可配置质量/成本/时长权重；质量门槛和 Main Review/Integration 权限不能
  被权重降为 0。是否展示/保留失败 Candidate 的部分成果可配置，但不自动触发新 Attempt。

现有权重、时间、成本、Token、文件数和行数设置保持独立。V1 只保证配置能生效、快照可追溯、循环有
上限；不会在开发期通过反复调整参数寻找“万能默认值”。

## 兼容与失败保护

- 旧 Task 没有 family/selection 时继续读取，只能使用 exact class；不能偷偷标为某个 family。
- 新字段缺失不阻断普通 Task；只有用户主动请求 family 路由或 Competition 时才校验相关内容。
- family 不得覆盖 exact-class 的 Direct Codex calibration、Token saving 或 Provider cost 口径。
- shortlist 中的 Worker 仍需通过真实 runtime/provider/Profile readiness；历史失败不会永久拉黑。
- 无候选、重复候选、未知 Worker profile、无竞争原因却要求自动竞争，都在 Provider 调用前拒绝。
- 设置变化不改变已创建 Task/Competition；Task Detail 展示创建时快照和当前建议的区别。
- Routing 失败只意味着没有建议，不得让实现 Task 失败，也不得自动切换模型。
- 当前 Competition 只替换 provider/model、保留原 Profile 且共用一个 runtime。V1 必须改为每个候选按
  自己的 Worker Profile 完整解析并冻结；否则不得声称支持 mixed-runtime competition。
- Task 与 Competition 都存为 JSON record，新增可选快照不要求修改 SQLite 表；仍需对旧 record 做
  缺字段兼容测试，不能用批量回填伪造历史决策。

## 实现拆分与 Worker 选择

代码审计后，V1 不应塞给一个过大的 Worker。推荐拆成两个**顺序执行、不重复实现**的 Task：

1. **选择证据 Task：** Task family/decision 快照、冻结 Worker identity、exact→family 统计、
   unknown 与 competition trigger 分离、设置和 Hub 解释。推荐 DeepSeek
   `deepseek-v4-pro[1M]`。
2. **竞争与结果 Task：** mixed-runtime Worker Profile 候选创建、Competition 原因快照、机器比较与 Main
   最终决定分层、Task Detail 结果说明。待第一个 Task 合入后再以其源码为基线，推荐 Volcengine
   `glm-5.2[1M]` 做独立边界实现，不让两个 Worker 修改同一旧基线。

这两个选择都是 Main 的人工判断，不冒充当前统计自动推荐，也不做 model competition。每个 Task 只
允许一个基础 Attempt 和至多一个同 Candidate Main correction；普通 retry、adaptation、第二模型和
自动参数调整均为 0。Main 逐项审查后才决定 Integration，commit/push 仍需一骏单独批准。

两个未提交的正式 Contract 已准备并通过当前 ForkLight `validate --json`：

- `examples/dogfood/m3-routing-decision-evidence-deepseek.yaml`：DeepSeek Pro 1M，质量校验 100 分，
  无限预算，一个基础 Attempt，零自动 extra Attempt，至多一次 Main correction。
- `examples/dogfood/m3-competition-main-decision-glm.yaml`：Volcengine GLM 5.2 1M，质量校验 100 分，
  无限预算，一个基础 Attempt，零自动 extra Attempt，至多一次 Main correction；Contract 明确要求
  第一项先完成 Integration、构建激活和 identity check。

校验只解析当前设置与契约，没有创建 Task 或启动 Worker。第一个 Contract 因产品枚举词 `unknown`
触发旧 placeholder 检查器的非阻断 warning，但 hard admission 仍为 passed；不能为了追求零 warning
把“未知”语义换成假推荐。两个 Contract 都必须等本文件末尾的核心原则确认后才允许 submit。

## 真实代码调用链与预计改动面

### Task 1：选择证据

- 生产：`src/core/task.ts` / `types.ts` 校验并冻结 family、Worker identity 和 routing decision。
- 统计：`src/core/statistics.ts` 从终态 Task 分别产出 exact 与 family 证据，不混用范围。
- 判断：`src/core/model-routing.ts` 产出 knowledge、evidence scope 和结构化 competition advisory。
- 传递：`src/daemon/coordinator.ts` / `server.ts`，`src/cli.ts`，`src/mcp/server.ts`，Hub read-only bridge。
- 配置：`src/core/settings.ts` 与 `src/hub/settings-api.ts` 保存 family 门槛、trigger 开关和默认候选数。
- 展示：Hub Models 与 Task Detail 先说“为什么选、为什么不竞争”，详细分数折叠。

### Task 2：竞争与结果

- 生产：Worker Profile resolver 为每个候选生成完整冻结身份和有效政策。
- 创建：`src/core/competition.ts` 从同一 canonical snapshot 创建可 mixed-runtime 的候选 Task，不保留
  与候选不一致的父 Task Profile/runtime。
- 比较：现有 verification/diff/retry/cost/duration 只形成 machine comparison，不再冒充最终 Winner。
- 决定：Main Review 绑定最终 Candidate Revision，产生 accept/revise/reject/retained-partial 快照。
- 消费：Coordinator、CLI、MCP、Hub Competition/Task Detail 和 Integration preflight 使用同一决定。

两项都需要同步更新 parser/settings/statistics/routing/competition、Daemon/MCP/CLI、Hub 中英文和对应
单测；第二项不得通过放宽 provider/runtime 配对来伪造 mixed-runtime 支持。

## 验收场景

1. Exact class 足够时使用 exact evidence，不混入 family。
2. Exact 不足、family 足够时使用 family，并在结果中说明范围。
3. 两者都不足且 intent=none 时只返回不知道，不建议竞争。
4. `consider + new-family` 只有 family 证据不足且设置允许时建议两个候选；关闭设置立即生效。
5. `consider + critical` 可在路由已有推荐时仍建议竞争，并清楚说明这是风险原因，不是证据不足。
6. `required + user-requested` 保留显式竞争，但仍受候选数、每个 Profile readiness 和安全边界限制。
7. DeepSeek/GLM Claude runtime 与 xAI/Grok runtime 候选从同一快照创建时，各自保存正确 Profile、
   provider、runtime、effort 和政策；非法配对在任何 Worker 启动前拒绝。
8. 机器排序第一但 Main 未接受时，Hub 不显示最终 Winner；Main reject 后不能自动 Integration。
9. 一个失败 Candidate 有可复用部分时可标记 retained-partial，不修改失败历史、不自动重跑。
10. Main 明确选择单 Worker 时，Hub 解释为什么没有竞争。
11. 机器失败但 Main 修正后交付时，首次结果、修正成本和最终结果分别可见。
12. 网络、鉴权和错误验收合同不计入 family 模型质量。
13. 旧 Task、旧 Competition 和旧 API 请求继续工作；旧显式 Competition 显示 reason unavailable。
14. family 统计绝不进入 exact-pair Main Token 节约声明。

独立检查至少覆盖 routing、statistics、task parser、settings、daemon/MCP/CLI、competition、Hub 双语
可执行 UI；随后运行全量测试、TypeScript build、Hub JavaScript syntax 和 `git diff --check`。

## 需要一骏确认的唯一产品决定

是否同意 V1 的核心原则：**“不知道哪个模型更好”只显示未知；只有 Main 明确写出值得竞争的原因，
系统才建议或执行竞争。**

确认后再生成正式 Task Contract 并启动 Worker。
