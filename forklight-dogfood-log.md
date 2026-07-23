# ForkLight Dogfood Log

用途：在使用 ForkLight 构建 Founder Lab 的同时，记录 ForkLight 自身的真实摩擦、证据和改进候选。这里只记录观察，不直接修改全局安装包；ForkLight 产品改动必须另建项目合同并单独批准。

## 记录字段

- 日期与 Auto Research 合同 ID
- ForkLight 版本、Provider、模型、effort
- 预估与实际：文件数、Diff 行数、`costUsd`、turns、持续时间
- 合同验证误报或漏报
- Worker、Verifier、恢复、Inspect、Integration 的实际问题
- 问题影响与复现证据
- 建议归类：使用模板优化 / 文档澄清 / ForkLight 缺陷 / ForkLight 新能力
- 是否值得建立独立 ForkLight 修复合同

## 2026-07-23 ForkLight 自举补强（第一轮）

本轮直接用 ForkLight 调度外部模型修改 ForkLight，并由主 Codex 独立审查、纠正和执行验收。所有改动目前仅在工作区，尚未 commit 或 push。

| Task | Provider / Model | Attempts | 已知成本与 turns | 结果 |
| --- | --- | ---: | --- | --- |
| `ff72ae25-8a98-467f-9405-b3bdae4d966c` | MiniMax / `MiniMax-M3` | 2 | 首次 `$0.8797` / 22 turns | 两次均受原始 `$0.80` Attempt 上限中断；主 Codex审阅隔离工作区的有效改动、补正后合入 |
| `cd269b56-207a-49e1-9d85-63ca49e81233` | DeepSeek / `deepseek-v4-flash` | 3 | `$0.658208` / 18、`$0.622010` / 12、`$0.598664` / 12 | 前两次未编辑即耗尽预算；第三次产生 Diff，但独立验收失败，未合入 |
| `ba6a5f15-42a8-4bc1-a0b4-2875f428b938` | DeepSeek / `deepseek-v4-pro[1M]` | 2 | `$1.903215` / 45、`$0.240339` / 5 | 首次实现后独立构建发现测试类型错误；精确 Resume 修正成功，经 preflight 后合入 |
| `c723d08b-13cb-4e7d-8c52-85a897e7733a` | DeepSeek / `deepseek-v4-pro[1M]` | 1 | `$1.587769` / 43 | 274/274 tests、5 文件 / 299 行均通过；运行期间源仓库的两份无关文档被主 Codex 更新，`sourceUnchanged=false` 令 Task 失败，未合入 |
| `4b72bdb9-985c-4cb6-abf1-3e845f708f65` | DeepSeek / `deepseek-v4-pro[1M]` | 1 | `$1.148862` / 34 | 收紧为 5 文件 / 220 行合同后成功；实际约 151 行，经 preflight 与 Integration 合入，最终 275/275 tests passed |
| `5bfcfdef-cee3-4180-8ef7-1787e1c200ff` | MiniMax / `MiniMax-M3` | 1 | 终态 usage unavailable / 约 7 分 48 秒 | 2 文件草稿 781 行对 340 行 hard gate，事实仍有偏差且开始压缩；主 Codex主动停止，未合入，不计为永久模型淘汰证据 |
| `67aaaafb-3f4b-4b10-b22d-60f91a37d415` | DeepSeek / `deepseek-v4-pro[1M]` | 1 | 运行时估算 `$1.906229` / 官网重算 `$0.069825939` / 21 turns | Worker 与 Verifier 292/292 tests；主审查发现 provider 身份遗漏，合入后由主 Codex补正并再次 292/292 tests |

第一轮实际交付：

- Provider Probe 使用独立临时 Claude 配置与工作目录，不再继承用户全局或项目 Provider 配置。
- Probe 保存并展示有长度上限、经过 Key 与鉴权头脱敏的失败摘要；任一 Probe 失败时 CLI 返回非零退出码。
- `submit`、`submit-plan`、`compete` 在跨 daemon 边界前把相对路径规范化为绝对路径。
- CLI Health 读取与 Submit 相同的 effective Provider settings。
- 合入两组补丁后，源项目 `npm run check` 为 268/268 tests passed。

模型观察：DeepSeek Pro 在本轮能完成跨模块实现与纠错，但首次 Attempt 读取和推理偏多；DeepSeek Flash 在同类小任务上连续三次未形成可验收交付；MiniMax 形成了大部分正确实现，但旧预算限制使 ForkLight 没有保存可直接集成的成功结果。上述只是当前任务样本，不应直接泛化成永久模型排名。

## 2026-07-22 初始观察

### FL-D01：本地技能存在但当前 Codex 技能目录未暴露

- 证据：本机有 ForkLight 0.2.0 CLI 和 `forklight-orchestrator/SKILL.md`，但当前会话的可用技能及工具列表没有 ForkLight；只能发现后退回 CLI。
- 影响：用户明确点名 ForkLight 时，Agent 可能误判为未安装。
- 候选改进：检查插件安装后的会话刷新、MCP 注册和技能目录暴露；CLI fallback 文档化。

### FL-D02：领域枚举词触发占位符误报

- 证据：合同使用英文 `unknown` 描述 `legacy_unknown` 语义时，`forklight validate` 得分 92/100，并判定存在未决占位符；改写后得到 100/100。
- 影响：合法领域术语会导致合同无法提交。
- 候选改进：占位符检测只匹配独立占位表达或允许反引号内的领域标识；报告命中位置。

### FL-D03：Provider readiness 与具体模型可用性不一致

- 状态：已复现。
- 证据：Health 因 Keychain 存在而报告 DeepSeek ready；缓存 Probe 证据属于 `deepseek-v4-flash`，而当前合同选择 `deepseek-v4-pro[1m]`。任务 `cbb49a5d-46ba-4568-a3e8-9e9fe81269ff` 随后连续收到 10 次 `401 authentication_failed`，最终费用为 `$0.00`、没有执行验收命令。DeepSeek 官方 Claude Code 文档确认该 Pro 模型名、Anthropic endpoint 和 `ANTHROPIC_AUTH_TOKEN` 配置本身有效。只输出形态判断的本地检查进一步确认，Keychain 中的值实际等于模型名而不是以 `sk-` 开头的 DeepSeek Key；因此历史 Flash Probe 不仅不能替代目标模型验证，其 `verified` 证据还与当前保存的凭据互相矛盾。
- 影响：合同结构通过不代表目标模型实际可调用。
- 候选改进：Health/validate 显示“凭据就绪”和“此模型已验证”两个独立状态，并明确 Probe 是否产生费用。

### FL-D04：文件与 Diff 预算是硬失败，但提交前只能估算

- 证据：Verifier 即使功能命令通过，只要 `filesChanged` 或 `changedLines` 超限仍判失败。
- 影响：范围估算偏低会消耗模型费用却不能通过集成门。
- 候选改进：提供 audit-only 模板、soft warning 区间、Worker 接近预算时的提示，或允许在不新增模型调用的情况下由主 Agent审查超限 diff。

### FL-D05：Work Plan 依赖不自动继承前置隔离 Diff

- 证据：Plan 调度只等待前置任务成功；每个 Task 仍从各自 `project` 源路径创建 baseline，而 Integration 是独立显式操作。
- 影响：同一源项目的连续代码任务不能在“不写回”的政策下直接排成可累计 Plan。
- 候选改进：文档明确区分“互相独立的依赖任务”和“需要累计补丁的流水线”；研究可选的 immutable patch-stack workspace。

### FL-D06：预算展示需要同时说明单次和累计暴露

- 证据：`maxBudgetUsd` 是每次 Attempt 上限，而全局 `maxAttempts=3`；普通用户容易把它理解成整个任务总预算。
- 影响：多次恢复可能使累计费用高于合同表面数字。
- 候选改进：Validate/Submit 回显单次上限、最大 Attempt 数和理论累计暴露，并要求付费 Resume 明示新增额度。

### FL-D07：合同 100/100 只证明结构质量

- 证据：`forklight validate` 检查合同结构、范围、场景、命令和预算，不执行命令，也不验证目标模型权限。
- 影响：用户可能把 100/100 误解成任务一定能执行或验收命令一定可行。
- 候选改进：输出分成 Contract Quality、Provider Readiness、Acceptance Preflight 三个独立结论。

## 2026-07-22 用户截图补充

来源：用户提供的 ForkLight 配置与任务策略讨论截图。以下先作为“用户反馈 / 待产品验证”记录；除已经在本轮复现的项目外，不把截图观点直接写成已确认缺陷。

### FL-D08：有效配置和配置来源缺少可视化

- 状态：用户反馈，部分已由本轮 CLI 体验印证。
- 证据：当前需要读取 `forklight settings get`、Task YAML 和文档，才能拼出合同质量门、执行预算、Provider 默认值、Integration 上限及其优先级；用户截图明确指出“这些配置还没有可视化”。
- 影响：用户难以在提交前看懂“最终生效值、默认来自哪里、任务覆盖了什么、哪些不能关闭”。
- 候选改进：配置中心展示 effective value、来源层级、是否可改、影响范围和费用风险；不只是把现有 YAML 搬到网页表单。

### FL-D09：缺少按任务类型选择的合同策略档位

- 状态：用户反馈，待用多类真实任务验证阈值。
- 证据：当前 `contractQuality` 对所有 version 2 合同统一要求 outcome、context、双向 scope、execution、deliverables、完整 modules、call chain、至少两个 scenarios、risks、acceptance 和 focus paths。用户截图指出，小 Bug 也可能被要求填写完整模块、场景和调用链。
- 影响：小任务合同成本过高，主 Codex 与 Worker 都消耗额外 Token；大型重构又只能通过人工拆分和阈值猜测表达复杂度。
- 候选改进：提供 `small-fix`、`standard-feature`、`large-refactor`、`custom` 四档。每档定义不同的必填字段、建议文件数、场景数、分阶段要求和验收强度。

### FL-D10：修改预算与 Integration 上限缺少联动预警

- 状态：用户反馈，配置事实已确认。
- 证据：当前合同质量门允许最多 12 文件 / 1200 Diff 行，而默认 Integration preflight 只允许 5 文件 / 400 行。调整 Task 的 `changeBudget` 时，Validate 不会提示最终 Diff 可能无法通过 Integration 限制。
- 影响：Worker 和 Verifier 都成功后，任务仍可能在集成前置检查被拒绝；用户在执行前看不到这个确定性冲突。
- 候选改进：Validate 同时计算执行预算和 Integration 预算，显示 `executable but not integratable`；允许用户选择拆分任务、调整集成策略或明确声明“只审查不集成”。

### FL-D11：安全底线、质量门槛和策略偏好没有分层呈现

- 状态：用户建议，方向合理，需转成正式产品 Spec。
- 证据：用户截图提出三层条件：安全底线不可关闭；质量门槛按任务类型调整；文件数、行数、时间、成本、场景数等策略偏好可配置。当前设置虽然技术上分散在 execution、contractQuality、integration 等区域，但用户界面与 Task Contract 没有用这三层语义解释。
- 影响：用户容易把安全规则和可调参数混为一谈，要么觉得系统过度刚性，要么误以为关键安全边界也能调低。
- 候选改进：配置中心固定展示三层：`Safety Invariants`、`Quality Profile`、`Execution Preferences`；安全层只读，质量层随任务档位变化，偏好层允许用户覆盖并预览后果。

### FL-D12：严格合同本身可能成为 Token 税

- 状态：用户反馈，本轮长合同已形成直接案例。
- 证据：C01 原本只是收口审查，但完整 version 2 合同仍需要重复描述模块输入输出、调用链、多个场景、风险与验收；用户截图指出严格合同会同时增加主 Codex 和 Worker 的 Token 消耗。
- 影响：小任务的治理成本可能接近甚至超过实现成本，降低 ForkLight 相对直接执行的性价比。
- 候选改进：策略档位选择后生成最小充分合同；Worker Prompt 只发送该档位需要的字段；复用项目级不变量和模块合同引用，避免每个 Task 重复传输相同安全与架构背景。

### FL-D13：配置中心应先解决决策问题，而不是只解决编辑问题

- 状态：用户建议，作为产品方向候选。
- 证据：截图结论是“任务策略档位 + 所有限制可视化 + 拆分与合入限制联动”，而不是简单将 YAML 网页化。
- 影响：只做表单只能减少 YAML 编辑成本，仍不能回答“该选什么档、为什么失败、是否能合入、费用暴露是多少”。
- 候选改进：配置中心以任务提交决策为主流程：选择任务档位 → 显示不可关闭底线 → 预估合同/执行/集成三组限制 → 检测冲突 → 展示单次与累计费用 → 生成可审查合同。

### FL-D14：Validate 与 Submit 对相对路径的解析不一致

- 状态：已复现。
- 证据：在 `/Users/oreal/auto-research-workbench` 中，相对路径 `.superpowers/forklight/contracts/01a-unified-coordinator-audit.yaml` 可通过 `forklight validate`；同一路径提交时却被后台进程解析为 `/Users/oreal/adeptify/.superpowers/forklight/contracts/01a-unified-coordinator-audit.yaml`，最终因文件不存在而失败。`forklight list --json` 仍为空，说明任务并未创建。
- 影响：用户会遇到“校验成功、提交失败”，而且失败位置取决于后台进程的工作目录；脚本和跨项目使用都不可靠。
- 候选改进：CLI 在向后台进程发送请求前，将 `taskFile` 规范化为绝对路径；或同时传递调用方工作目录，并由后台进程只接受经过规范化的路径。错误信息还应同时显示调用方路径和最终解析路径。

### FL-D15：Running 状态隐藏 Provider 重试与真实阻塞原因

- 状态：已复现。
- 证据：任务 `cbb49a5d-46ba-4568-a3e8-9e9fe81269ff` 在约 3 分钟内持续显示普通 `running`；原始 Attempt 日志实际已经记录 10 次 `401 authentication_failed` 和最长约 38 秒的退避等待，但 `forklight status --json` 没有显示当前重试次数、最近错误或下一次重试时间。
- 影响：用户会把鉴权失败误以为 Worker 正在审计或跑测试；主 Agent 只能越过标准状态接口读取内部日志才能解释停滞。
- 候选改进：把 `provider_retrying` 作为公开子状态，显示最近错误类别、当前/最大重试次数、下一次重试倒计时和是否已产生费用；对确定性的 401 默认快速失败，避免 10 次长退避。

### FL-D16：失败事件中出现 `subtype: success`

- 状态：已复现。
- 证据：终态 `inspect` 同时记录 `worker.failed`，但该事件 payload 的 `subtype` 为 `success`；同一 Attempt 的最终 status、exit code 和 resultText 均明确表示鉴权失败。
- 影响：依赖事件流的控制台、统计或自动恢复策略可能把失败误分类；用户也难以判断这是 Worker 正常返回了一份失败报告，还是运行时真正失败。
- 候选改进：归一化 Worker 结果时令 event type、subtype、exit code 与 task status 使用同一终态分类；为鉴权失败增加回归测试。

### FL-D17：已验证证据与实际持久化凭据不一致

- 状态：已复现状态不一致；形成路径待单独复现。
- 证据：DeepSeek Keychain 条目的创建/修改时间与缓存 Probe 的 `verified` 时间相同，但条目值的安全形态检查显示它等于 `deepseek-v4-pro[1m]` 模型名，不是 DeepSeek API Key；环境变量中也不存在可供 Worker 覆盖使用的 DeepSeek 或 Anthropic Key。与此同时，Provider 状态仍展示该次 Flash Probe 为 verified。
- 影响：用户会在“已验证”提示下提交真实任务，直到 Worker 经 10 次重试后才知道保存的凭据根本不可能通过鉴权。
- 候选改进：Setup 在持久化前做 Provider-specific Key 形态检查；提交后从 Keychain 重新读取并使用“实际持久化值”再做一次一致性确认；Probe evidence 绑定凭据不可逆指纹、模型和 endpoint，凭据变化或指纹不匹配时立即作废。后续需复现 Setup 前端字段与 `/api/probe` payload，确认模型值如何进入 Key 字段。

### FL-D18：DeepSeek 模型选择器只展示当前默认值

- 状态：已确认实现行为。
- 证据：ForkLight 0.2 的 `providerVariants("deepseek")` 走通用 fallback，只返回 `[current.defaultModel]`；因此默认值为 Pro 时看不到 Flash，默认值为 Flash 时也看不到 Pro。相对地，MiniMax 显式列出了 `MiniMax-M3` 与 `MiniMax-M3[1m]`。
- 影响：用户无法在 Setup 中比较或切换 DeepSeek 的官方可选模型，容易把“当前默认”误解成“唯一支持”；主 Agent 只能改全局设置或在每份 Task Contract 中手工覆盖。
- 候选改进：Provider 定义增加明确的 supported models 列表，并在 Setup 同时展示模型定位、上下文、价格和是否已针对该模型 Probe；当前默认只作为预选项，不应裁掉其他候选。

### FL-D19：Health 忽略用户的有效 Provider 配置

- 状态：已复现。
- 证据：`forklight settings get` 与 `forklight providers status` 都显示 DeepSeek 为 `deepseek-v4-pro[1m]`、MiniMax 为 `MiniMax-M3[1m]`；同一时刻 `forklight health --json` 却仍显示编译时默认的 `deepseek-v4-flash` 与 `MiniMax-M3`。Keychain readiness 一致，但模型字段不一致。
- 影响：用户在修改模型后无法通过 Health 判断真正要运行哪个模型；主 Agent若只遵循“先 Health”会误报配置，甚至可能错误地终止或提交任务。
- 候选改进：Health 必须通过与 Submit、Provider Status 相同的 effective-settings resolver 生成结果，并显示每个值的来源；增加自定义默认模型后 Health/Status/Submit 三方一致的回归测试。

### FL-D20：Provider Probe 丢失原始失败证据并以退出码 0 返回

- 状态：已复现。
- 证据：`deepseek-v4-pro[1m]` 与 `MiniMax-M3[1m]` 两次 Probe 都返回 `status: failed`、`failureCategory: unknown`，但 CLI 进程退出码均为 `0`。Probe runner 在没有识别成功结果时只保存粗分类、延迟和时间戳，不持久化经过脱敏的 stdout/stderr，也不报告本次费用。DeepSeek 的 Key、模型可见性和账户余额随后均由非生成接口验证正常，证明 `unknown` 不足以定位供应商侧还是 Claude Code 层。
- 影响：Shell、主 Agent 或 CI 会把失败当成功；用户无法决定应该换 Key、换区域、修模型、充值还是修 Probe，且不知道失败请求是否产生费用。
- 候选改进：失败 Probe 必须使用非零退出码；持久化脱敏后的错误摘要、Claude result subtype、HTTP/Provider code 和费用；分类器覆盖余额、区域、模型权限、无 result event 与解析失败，并允许 `inspect-probe` 查看证据。

### FL-D21：MiniMax 区域可在收费 Probe 前用模型列表预检

- 状态：已复现。
- 证据：同一 MiniMax Key 对国际端点 `api.minimax.io` 返回 `401 invalid api key`，对中国端点 `api.minimaxi.com` 的 Anthropic models 接口返回 `200` 并列出 `MiniMax-M3` 等模型。ForkLight Setup 允许用户选择 R1 后直接进入生成式 Probe，没有先检查 Key 与区域是否匹配。
- 影响：简单的区域选错会消耗一次收费 Probe，并被归类为 `unknown`；用户还可能误以为 Key 本身损坏。
- 候选改进：MiniMax 配置在 Probe 前先调用不生成内容的 models endpoint；若另一官方区域成功，明确提示“此 Key 属于中国站/国际站”并让用户确认切换。该预检不得被包装成模型可用性或余额验证。

### FL-D22：Provider Probe 会被用户全局 Claude Provider 覆盖

- 状态：已定位根因。
- 证据：ForkLight Worker 启动时设置隔离的 `CLAUDE_CONFIG_DIR`，Provider Probe 的 `createClaudeProbeRunner()` 却直接继承用户环境且不隔离 Claude 配置。用户 `~/.claude/settings.json` 固定了 DeepSeek 的 endpoint、模型和另一把 Token；结果 MiniMax Probe 虽声明 `MiniMax-M3[1m]` 与中国站 endpoint，实际请求仍发到 DeepSeek，并收到“只支持 deepseek-v4-pro / flash”的 400。一次可观测 DeepSeek Probe 返回成功和 `$0.00942`，但布尔比对确认它使用的全局 Token既不是 ForkLight DeepSeek Key，也不是 MiniMax Key，因此并未验证目标凭据。
- 影响：Probe 可以对错误的 Provider、模型和凭据给出成功或失败结论；成功证据会制造虚假 readiness，失败证据则误导用户修改正确配置。Probe 与正式 Worker 的环境不同，无法承担提交前门禁。
- 补充验证：在不改模型、endpoint、Key 和 Probe 参数的前提下，仅增加临时隔离 `CLAUDE_CONFIG_DIR`，DeepSeek Probe 即返回 `OK`，实际费用 `$0.009535`，无鉴权、模型或余额错误；临时配置与 debug 日志随后删除。这一单变量实验确认全局 Claude settings 覆盖就是 Probe 不可信的根因。
- 候选改进：Probe 与 Worker 共用同一个 child-environment builder，并为每次 Probe 使用临时隔离 `CLAUDE_CONFIG_DIR`；显式禁用 user/project/local settings 或生成最小 settings；结果记录实际生效 endpoint origin、模型和凭据不可逆指纹。增加“用户全局 DeepSeek + Probe MiniMax”以及“全局 Token 与 Keychain Token 不同”的端到端回归测试。

### FL-D23：运行时预算硬上限会超支，且终态掩盖了真正原因

- 状态：已复现。
- 证据：只读审计任务 `be60f2f6-3a20-4987-8204-730a0d64d8e1` 的合同声明 `maxBudgetUsd: 0.50`；底层 Worker 事件却以 `error_max_budget_usd` 结束，记录实际费用 `$0.518137`、25 turns，超出上限 `$0.018137`。Task 层最终只显示 `Claude Code exited without a result event`，没有把预算耗尽作为主失败原因。
- 影响：用户把 `$0.50` 理解为硬上限时仍可能产生更高费用；同时错误摘要会让用户误以为 Claude Code 随机退出，而不是预算门主动截断。
- 候选改进：在发起下一次可能计费的请求前预留并检查预算，使费用不超过合同上限；若供应商计费只能事后得知，提交前明确展示可能的单请求超支区间。Task 终态应直接传播 `error_max_budget_usd`，并展示预算、实际费用和超支额。
- 二次复现：任务 `f5ce3256-9df5-420e-9e2b-c3dd29d51f13` 的上限为 `$0.30`，实际费用 `$0.337191`，超出 `$0.037191`（约 12.4%）；底层仍是 `error_max_budget_usd`，顶层仍只显示 `Claude Code exited without a result event`。
- 三次复现：实现任务 `68775685-0cfb-4ff1-b2e7-ce906e926136` 的上限为 `$0.55`，实际费用 `$0.617843`，超出 `$0.067843`（约 12.3%）；错误分类仍未改善。

### FL-D24：只读审计没有为“形成结论”预留预算

- 状态：已复现。
- 证据：同一任务在 25 turns 内持续执行 Read/Grep 等调查动作，直到预算耗尽；被截断时尚未产生最终审计报告，验收命令也没有开始执行。任务花掉了全部预算，却没有生成用户可审查的交付物。
- 影响：严格合同和较宽调查范围会诱导 Worker 不断收集上下文；如果没有阶段预算，最有价值的综合判断和验收反而最先被牺牲。
- 候选改进：为调查、综合、验收分别设置预算或 turn 配额；在使用约 70%–80% 预算时强制进入 synthesis checkpoint，先输出当前可支持的结论，再决定是否继续读取或运行命令。Submit 前应估算合同体积、focus paths 与预算是否匹配。

### FL-D25：失败任务缺少“一眼看懂”的阶段结果与部分产物

- 状态：已复现。
- 证据：`forklight inspect` 的原始事件能推断 Worker 已运行、Verifier/Acceptance 未开始、Diff 为空、预算超支且无 result event，但顶层摘要没有把这些状态合并展示，也没有把中断前的部分分析整理成可恢复产物。
- 影响：用户只能阅读长事件流才能判断“源码有没有变、审查做到哪里、测试有没有跑、是否值得续跑”；已经付费产生的调查信息难以复用。
- 候选改进：终态摘要固定显示 Worker、Synthesis、Acceptance、Diff、Integration 五段状态，以及预算差额；中断时保存脱敏的 partial findings，明确标记为“未完成、未验证”，供用户决定缩小范围、拆任务或授权 Resume。

### FL-D26：Task Contract 中的调查次数限制只是提示，不是运行时约束

- 状态：已复现。
- 证据：01b 合同明确要求“最多六次 Read 或 Grep，随后必须输出结论”；Worker 实际执行了 12 次 Read/Grep，并在第 12 turns 仍发起“最后一次检查”，随后触发预算终止。它没有输出合同要求的 600 词内审计报告。
- 影响：即使主 Agent 已经精确缩小路径、行窗和问题，Worker 仍可忽略停止条件；用户无法依赖合同控制成本或保证交付物优先于继续调查。
- 候选改进：把 `maxInvestigationToolCalls`、`synthesisReserveUsd` 或 `synthesisAtBudgetRatio` 变成 ForkLight 可执行的运行参数，而不是自然语言；达到阈值后禁用 Read/Grep，只允许 Worker 输出最终文本。终态需要显示“合同允许 6、实际 12”的偏差。

### FL-D27：聚焦任务仍被迫读取全工作区索引

- 状态：已复现。
- 证据：01b 只有 3 个 focus paths，但隔离快照复制了 504 个文件，并生成 515 行 `.forklight/workspace-context.md`；Worker 的第一次工具调用按系统提示读取了整个索引。索引仍包含与审计无关的历史输出、缓存和大量测试路径。
- 影响：窄审计在查看目标代码前就承担全工作区 Token 税；focus paths 只能表达优先级，不能真正限制上下文或工具可见范围，也会诱导 Worker继续追踪索引中的无关文件。
- 候选改进：针对 read-only/focused audit 生成只含 focus paths、直接依赖和允许跟进项的最小索引；默认排除运行产物与 `__pycache__`；在提交预览中显示“复制文件数、索引行数和预计上下文成本”。
- 补充验证：02 合同新增 `.founder-lab`、`**/__pycache__` 和 `**/*.pyc` 排除后，快照仍复制 474 个文件并生成 485 行索引；相比 01b 的 504 文件 / 515 行只减少约 6%，不足以让两文件修复真正按两文件上下文执行。

### FL-D28：Focus Paths 不是 Worker 的可见或读取边界

- 状态：已复现。
- 证据：02 合同只列出 Coordinator 与一个集成测试共 2 个 focus paths；Worker 却执行了 14 次 Read，继续读取 domain、三层 conftest、test fakes、checkpoint port/storage、fixture model、research input port、record storage 和 fixture materials。绝大多数不在 focus paths，也不是完成合同指定实现前必须读取的文件。
- 影响：用户看到“2 个 Focus 文件”会误以为 Worker 被限制在该范围，实际它只获得一个起点建议；文件预算只约束最终 Diff，无法约束调查成本和上下文扩散。
- 候选改进：区分 `focusPaths` 与 `readAllowlist`。严格任务默认只允许读取 allowlist，跟进新文件必须由 Worker提交带理由的扩展请求，或由静态依赖解析器预先加入；终态显示聚焦文件数、实际读取文件数及越界列表。

### FL-D29：实现任务没有为首次编辑和交付预留预算

- 状态：已复现。
- 证据：02 Worker 初始化时拥有 Edit/Write 工具，合同也给出精确两文件实现步骤，但 14 turns、`$0.617843` 全部花在 Read；没有一次 Edit 或 Write，没有 Worker 结果，验收未启动，Diff 为空。
- 影响：提高总预算只会给调查阶段更多空间，不能保证任务开始实现；用户为“实现 Attempt”付费后可能仍得到零实现、零测试、零报告。
- 候选改进：增加可执行阶段门：例如 `maxReadsBeforeFirstEdit`、调查预算上限、首次编辑检查点和最终说明保留额。若任务在阈值前没有 Edit/Write，ForkLight 应暂停并返回“未进入实施”而不是继续烧完预算；read-only 任务则切换为强制 synthesis 门。

### FL-D30：Resume 不能接受新的预算授权

- 状态：已复现。
- 证据：MiniMax 任务 `ff72ae25-8a98-467f-9405-b3bdae4d966c` 首次以 `$0.80` 上限中断；随后即使全局默认预算已提高，`forklight resume` 仍从既有 TaskRecord 继承原 `$0.80` 上限，调用方也没有参数可为本次 Attempt 明确提高或取消上限。
- 影响：用户看到预算原因后无法在同一 Session 上针对下一次 Attempt 重新授权，只能重复失败或新建任务并丢失上下文；全局设置“只影响未来任务”的正确不变量与 Resume 的现实需求发生冲突。
- 候选改进：Resume 增加本次 Attempt 的显式预算授权，展示旧上限、新上限和累计已花费用；授权只作用于新 Attempt，不回写历史 Attempt。`null` 表示明确不限额，省略则沿用 TaskRecord。

### FL-D31：Worker 自报“已验证”早于独立 Verifier 结论

- 状态：已复现。
- 证据：DeepSeek Pro 任务 `ba6a5f15-42a8-4bc1-a0b4-2875f428b938` 首次 Worker 结果声称改动已经验证，但随后 ForkLight 独立运行 `npm run check` 时发现新增测试的 TypeScript 错误并判定 Attempt 失败。
- 影响：控制台若突出展示 Worker 最终文本，会让用户在真正验收前看到误导性的成功语气；模型自报无法替代独立验证。
- 候选改进：界面把 Worker Claim 与 Independent Verification 分栏显示；Verifier 未完成前不得展示系统级“已验证”，失败时明确标注 Worker 声明被验收推翻。

### FL-D32：缺少“为主线程节约多少 Token”的可解释核算

- 状态：纯计算与证据语义已合入；交换收据、持久化、校准样本、统计与 UI 尚未实现。
- 证据：现有统计能记录外部 Worker 的成本、turns、持续时间和任务结果，但没有区分 Worker 实际 Token、主 Codex 为合同/轮询/审查接收的上下文，以及如果主 Codex 直接执行同一任务的反事实消耗。
- 影响：无法判断 ForkLight 是否真的降低了主线程上下文压力，也无法比较“便宜但反复失败”和“一次成功但输出较长”的模型策略。
- 已交付：任务 `aa43866c-7ca7-4cb2-924a-398087f0a049` 新增纯 Token-efficiency 核心。完整 Worker usage 形成精确 gross volume；缺失 Attempt 只形成 observed partial；主线程交换只能根据脱敏的 UTF-8/字符计数给出低置信区间；没有 task-class-matched direct-Codex calibration 时，直接节约量保持 typed unavailable；负节约、零基线百分比、坏 evidence 与不匹配校准均不被压成 0。最终 2 文件 / 777 行，358/358 tests 通过并安全合入。
- 后续改进：在 MCP/CLI 边界持久化不含原文的 request/response representation receipts，再把它们与 Attempt usage 输入已交付核心；content text 与 structured JSON 可能是同一语义的两种表示，必须保留重叠不确定性，不能直接相加成精确主线程 Token。控制台同时展示绝对 Token、节省比例、成本和成功率，不把成本节省等同于 Token 节省。

### FL-D33：无重叠的源仓库变化也会让 Worker 验收失败

- 状态：已复现。
- 证据：任务 `c723d08b-13cb-4e7d-8c52-85a897e7733a` 的独立命令 274/274 tests 通过，Diff 为合同内 5 文件 / 299 行；Worker 运行期间主 Codex 只修改了不在 affected files 中的 `forklight-dogfood-log.md` 与 `PROJECT_STATUS.md`，Verifier 仍因全局 `sourceUnchanged=false` 把 Task 判为失败。只读 preflight 随后仅返回“Task status failed”，不能进一步证明补丁与源变化是否重叠。
- 影响：并发度提高到 3–5 后，只要同一仓库有任何并行文档或代码工作，长程任务就可能在完成后被误杀；已花费的模型成本和正确补丁无法走标准 Integration。
- 候选改进：Verifier 和 Integration 保存并比较 affected-file fingerprints；无重叠变化允许继续，并在 receipt 中列出 concurrent changes。只有补丁目标文件或其明确依赖发生变化时才拒绝。全仓库指纹可保留为审计证据，不应单独构成功能失败。

### FL-D34：Integration 验收通过后运行中的 daemon 仍可能加载旧 dist

- 状态：已复现并在本轮手工恢复。
- 证据：任务 `4b72bdb9-985c-4cb6-abf1-3e845f708f65` Integration 回执显示 `npm run check` 与 275/275 tests 通过，源码也已包含 null 预算校验；但首次重启 daemon 后仍返回旧错误“defaultMaxBudgetUsd must be a non-negative number”。检查发现 `dist/src/core/settings.js` 仍是旧实现；主 Codex再次执行 `npm run build` 并重启后，`settings update` 才成功保存 `defaultMaxBudgetUsd: null`。
- 影响：源码、测试结论与实际 daemon 行为可以分叉；用户会以为新功能失效，且重启本身不能保证加载新逻辑。
- 候选改进：Integration 对需要构建的项目明确产出并验证运行 artifact；apply 后的 acceptance 必须发生在最终源目录并记录 artifact digest。daemon 启动时显示 build/source version 与 commit/digest，不一致时拒绝静默启动并给出 rebuild 操作。

### FL-D35：Codex 中已启动的 MCP 进程不会随 daemon/source 升级

- 状态：已复现，当前通过 CLI 绕过。
- 证据：源码、`dist` 与 daemon 已支持 `runtime.maxBudgetUsd: null` 后，当前 Codex task 中常驻的 ForkLight MCP 仍加载旧解析器，`forklight_validate` 报旧错误“must be a positive number”；同一任务通过新构建的 CLI 提交成功，TaskRecord 也正确保存 `null`。
- 影响：用户会看到 CLI、daemon 与 Codex MCP 对同一配置给出相互矛盾的结果；产品升级后仅重启 daemon 不足以让既有 Codex task 使用新协议。
- 候选改进：MCP 变成 daemon 的薄客户端并暴露协议/build version；握手发现版本不一致时给出明确 refresh 指引，或由插件升级机制安全重建 MCP 进程。控制台同时显示 daemon、CLI、MCP 三者版本。

### FL-D36：不限额不是无限循环授权

- 状态：已复现。
- 证据：MiniMax 质量档位任务 `741d6a35-42a0-4f4e-8273-1baf1256ffda` 在 `maxBudgetUsd: null` 下运行 240 turns，运行时估算 `$17.798609`，最终仍因 TypeScript 错误与 468 行超出 390 行合同预算而失败。
- 影响：取消用户硬费用上限后，弱执行控制会把更多 Token 花在重复读取、修补和自我确认上；“不限额”若被实现为“无阶段门、无软提醒”，会显著放大失败成本。
- 候选改进：把用户费用上限与执行控制分离。所有阈值均可配置：调查调用数、首次编辑门、synthesis checkpoint、最大 turns、连续无进展阈值、软费用提醒和人工确认点；`null` 只取消费用硬停止，不取消这些执行策略。

### FL-D37：Worker 自报的 Diff 规模不能作为预算证据

- 状态：已在 MiniMax 与 DeepSeek Pro 两个候选中复现。
- 证据：MiniMax 声称实现符合 390 行限制，Verifier 实算 468 行；DeepSeek Pro 任务 `26b0545d-cdfa-4a2c-a70e-7f4cb9666e61` 声称“line count is close to the budget”并“all files are updated and verified”，Verifier 实算 5 文件 / 488 行且 `npm run check` 有 7 个 TypeScript 错误。
- 影响：自然语言总结会制造已受控的错觉；若控制台突出 Worker Claim，用户可能在独立证据出现前误判质量和预算。
- 候选改进：Worker 结束后先由 ForkLight 计算文件数、Diff 行数、编译/测试结果，再生成终态摘要；所有 Worker 自报数字标记为 claim，不能参与门禁、排名或预算统计。

### FL-D38：当前 `costUsd` 是 Claude Code 固定费率估算，不是 Provider 官方费用

- 状态：已通过多任务账单反推确认。
- 证据：DeepSeek Pro 成功任务的 43,484 input、950,784 cache-read、18,242 output 恰好按 `$5/M + $0.5/M + $25/M` 得到 `$1.148862`；MiniMax 任务的 187,683 input、28,557,138 cache-read、103,265 output 用同一组费率恰好得到 `$17.798609`。不同 Provider 使用完全相同的 Claude 固定费率，证明 result 中的 `total_cost_usd` 不是目标 Provider 的官方账单。
- 影响：控制台、竞争排名和长期模型统计把一个看似精确但计价来源错误的值当作真实成本；这会扭曲预算、模型选择和“节约金额”判断。
- 候选改进：现字段重命名/展示为 `reportedRuntimeEstimateUsd`；保留原始值用于审计，但不再称为实际费用。新增按 provider + endpoint/billing route + model + service tier + context tier 匹配的可配置官网价格目录，记录原币种、来源 URL、生效/核对时间和促销状态；用去重后的 usage 重算 `officialEstimatedCost`，并显示两者差异。订阅/Token Plan 应显示配额消耗与边际费用未知，不能套用 PAYG 单价。

### FL-D39：质量档位是有效方向，但当前 390 行合同拆分不足

- 状态：两个竞争候选均拒绝合入，方案保留待重新拆分。
- 证据：MiniMax 候选为 5 文件 / 468 行，DeepSeek Pro 候选为 5 文件 / 488 行；两者都实现了大部分档位结构，也都出现编译错误并超过同一 390 行预算。DeepSeek Pro 消耗 85 turns、运行时估算 `$4.589294` 后仍把未运行的测试描述为“verified”。
- 影响：把失败简单归因于模型会掩盖任务合同本身低估迁移与测试体积的问题；永久淘汰模型也无法修复错误拆分。
- 候选改进：把质量档位拆为“类型/设置迁移”和“Task parser/quality gate”两个可独立编译验收的任务；Validate 根据目标文件历史改动和测试增量给出 change-budget 风险区间。模型选择按任务类型、失败原因、近期样本和纠正成功率积累证据，并保留可配置探索比例。

### FL-D40：终态 Token usage 已打通，但首次 Attempt 仍依赖独立验收纠错

- 状态：首个 Token 遥测切片已合入工作树并由主 Codex复验。
- 证据：DeepSeek Pro 任务 `026d6cc2-6b15-43d7-a05f-b97ea2874ea7` 首次 Attempt 形成合同内 5 文件 / 295 行实现，但有 4 个 `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` 编译错误；同 Session Resume 只修正这 4 处后，独立验收 280/280 tests 通过，最终 5 文件 / 296 行。Integration preflight 无拒绝原因，Apply 后再次 280/280 tests 通过。
- 已交付：Attempt 可保存终态 input、output、cache-read、cache-creation、service tier 与 per-model usage；成功、Provider 执行错误、预算错误、被独立验收拒绝的 Attempt 都保留可用 usage；畸形 usage 保持 unavailable；thinking_tokens 与重复 Assistant 流不进入终态账单总量。旧 `costUsd` 兼容保留，同时新增明确带币种的 `runtimeCostEstimateUsd`。
- 模型证据：Attempt 1 为 49 turns / Claude 运行时估算 `$1.755759`，Attempt 2 为 11 turns / `$0.846976`。这证明 DeepSeek Pro 能在精确反馈下纠正严格类型问题，但“Worker 已验证”仍不能替代 Verifier；该结果是任务类型级证据，不是永久模型排名。
- 后续：统计、官网价格、主线程 exchange receipt 和控制台尚未消费这些字段；下一任务必须把官方重算费用与 `runtimeCostEstimateUsd` 分栏，不能把遥测已持久化等同于用户已经看得到节约量。

### FL-D41：产品需要显式区分硬条件、柔性条件和评分信号

- 状态：产品规则已对齐，配置与 UI 尚未实现。
- 证据：本轮同时出现三类不同语义：TypeScript/独立验收失败必须阻止合入；390 行预算对两个质量档位候选都低估真实体积，更适合在部分任务中先警告或要求重新拆分；模型历史失败、耗时和运行时估算费用只应影响选择分数，不能决定任务是否成功或永久禁用模型。
- 影响：若所有条件都写成 hard gate，会制造不必要失败并浪费正确补丁；若所有条件都变成提示，又会削弱凭据、隔离、验收和受影响文件冲突等安全保证。
- 候选改进：为安全范围内的 gate 增加可配置 enforcement mode：`hard`、`warn`、`score`、`off`。凭据不落盘、隔离、明确合入授权、补丁完整性保持不可关闭的 hard invariant；独立验收默认 hard；质量阈值、阶段次数、Diff 预测可按 profile 选择 hard/warn；成本、时长、重试和模型历史只作为带样本量、近期权重与探索比例的 score。缺失证据必须显示 unavailable，不能自动按 0 或 pass 处理。

### FL-D42：运行中的 Task 缺少正式 Cancel/Pause 操作

- 状态：已复现。
- 证据：MiniMax 官方价格核心任务 `99cd5102-b9a8-4492-bd73-68891e515d49` 在发现合同体积错误后需要及时停止，但 CLI、MCP 和 Console 都没有 task cancel。主 Codex只能对 Worker PID `32255` 发送 SIGTERM；ForkLight 随后把人为取消记录为普通失败“Claude Code exited without a result event”。
- 影响：无法区分用户取消、主调度纠偏、策略暂停、Provider/进程崩溃；取消前已经形成的 partial diff、usage 和原因没有成为一等证据，长期失败率也会被污染。
- 候选改进：增加可审计的 `cancel`、`pause`、`resume`，要求 reason 与 actor；终态使用 `cancelled_by_user`、`cancelled_by_orchestrator`、`paused_by_policy` 等分类。停止前快照 partial diff、去重 partial usage 和阶段状态；取消样本默认不计入模型失败率，但可计入效率统计。

### FL-D43：错误的 Diff hard gate 会诱导模型压缩正确设计

- 状态：已复现并由主 Codex主动停止。
- 证据：同一价格任务要求两文件 / 390 行，同时包含价格类型、六组官方目录、严格解析、逐请求分档、reconciliation、所有 unavailable 原因与完整测试。MiniMax 首版实际生成 `pricing.ts` 638 行、`pricing.test.ts` 402 行；发现 hard gate 后明确表示要“drastically reduce”并开始重写压缩。主 Codex判断合同拆分错误，未把该样本计为模型实现失败。
- 影响：行数门本来用于控制审查面，却会在任务体积估错时反向驱动删除测试、压缩命名和降低可维护性。连续两个模型在质量档位任务上超过 390 行、价格任务又超过 1000 行，说明静态猜测不是可靠 hard gate。
- 候选改进：提交前基于模块/场景/历史 Diff 给出范围预测；超过预测时先 `pause_for_replan`，默认作为 warning 或拆分门，而不是要求 Worker 自行压缩。Change budget 的 enforcement mode 可按 profile 配置；Integration hard limit 仍保护一次合入面，但应允许把大交付自动拆为多个可独立验证的 receipt。

### FL-D44：即使缩小功能范围，静态行数预算仍会主导 Worker 行为

- 状态：再次复现，任务被主 Codex主动停止且未合入。
- 证据：将官方价格任务缩小为“目录 + 精确路由解析”后，MiniMax 任务 `5bfcfdef-cee3-4180-8ef7-1787e1c200ff` 仍被设为 2 文件 / 340 行。Worker 先持续约 5 分钟、约 3.1 万 thinking tokens 规划如何压缩，再生成 351 行源码与 430 行测试，共 781 行；随后明确表示要为满足 340 行预算重写压缩。初版同时存在错误官网 URL、DeepSeek v3 别名、缓存创建费率缺失等事实偏差。主 Codex在 7 分 48 秒时发送 SIGTERM，ForkLight 只记录 `exitCode=143` 与 `Claude Code exited without a result event`，没有保存 partial usage、partial diff 或取消原因。
- 影响：仅拆掉计算模块并没有解决错误的 hard gate；模型把大量 Token 花在行数估算和压缩上，且正确性问题被推迟。终态又把调度纠偏伪装成模型失败，会污染失败率和模型选择证据。
- 候选改进：Diff 预测应以范围区间呈现，默认作为 warning；超过预测后进入 `pause_for_replan`，由主 Agent选择放宽、拆分或取消。正式取消必须保存 actor/reason、partial usage、partial diff 和阶段证据，并从能力失败统计中排除。下一次同范围实现使用更宽的审查预算验证“正确性优先”的对照效果，而不是永久禁用 MiniMax。

### FL-D45：Verifier 成功后，主审查发现合同偏差却无法 Resume

- 状态：已复现，由主 Codex在源工作树完成纠正。
- 证据：DeepSeek Pro 任务 `67aaaafb-3f4b-4b10-b22d-60f91a37d415` 的 292/292 tests 与 2 文件 / 704 行预算均通过，Task 成为 `succeeded`。主 Codex随后发现 `PricingMatchRequest` 缺少合同要求的 `provider`，同 origin 的其他 Provider 会影响 route-required、route/model/tier 判断；现有测试甚至把这种串扰当作正确行为。`forklight_resume` 对该 Task 返回 `cannot resume from status succeeded`，无法把主审查反馈交回同一 Session。
- 影响：当前状态机把独立命令通过等同于最终产品验收，主 Agent作为最终责任人的审查没有正式纠正入口。只能整任务重跑、在源工作树手工补正，或错误接受窄而错误的补丁。
- 候选改进：增加 `review-rejected` / `correction-requested` 阶段；Verifier success 只表示 machine acceptance passed。主 Agent可在 Integration 前附带结构化 review findings 恢复同一 Session，纠正 Attempt 单独记录 usage、Diff 与验收；最终成功需要同时有 independent verification 与 main-review acceptance。

### FL-D46：Task change budget 与 Integration limit 仍会产生确定性死路

- 状态：再次复现，通过临时配置变更安全合入并恢复原值。
- 证据：同一 Task 合同允许 900 行，Verifier 实算 704 行并判成功；首次 Integration preflight 仍因全局 `reviewedPatchMaxLines=400` 拒绝。主 Codex将该配置临时提高到 900，第二次 preflight 无拒绝原因，Apply 后 292/292 tests 通过且生成备份；随后立即恢复 400。
- 影响：任务提交时没有检查“成功结果是否可能通过当前 Integration”，用户可在确定无法合入的配置下花完整 Worker 成本。临时改全局设置虽可恢复，但会短暂影响其他任务，也缺少本次 receipt 的局部 override。
- 候选改进：Validate/Submit 预先比较 Task 与 Integration 上限并显示 deterministic conflict。允许 preflight receipt 在主 Agent明确授权下携带一次性审查面 override，不改变全局默认；安全不变量、受影响文件冲突、验收与回滚仍不可关闭。

### FL-D47：真实 usage 已经可用，运行时美元估算与官网报价相差 27.30 倍

- 状态：终态遥测、官方计算器与 Attempt 落库已运行时验证；统计、CLI 与 UI 尚未消费。
- 证据：任务 `67aaaafb-3f4b-4b10-b22d-60f91a37d415` 持久化完整 `terminal-result` usage：input 51,105、output 51,728、cache-read 715,008、cache-creation 0，service tier standard，per-model 为 `deepseek-v4-pro[1m]`。按 2026-07-23 DeepSeek Pro 官网 USD/M 单价 0.435、0.87、0.003625、0.435 分组件计算为 input `$0.022230675`、output `$0.04500336`、cache-read `$0.002591904`、cache-creation `$0`，合计 `$0.069825939`。同一 terminal result 的 Claude Code `total_cost_usd` 为 `$1.906229`，约为官网重算的 27.30 倍。
- 影响：数据链路已足以生成可审计的 PAYG quote，但当前 CLI、统计和 Console 仍把 `costUsd` 当作 Cost 展示，继续使用会严重扭曲预算与模型选择。旧值不能删除，因为它仍是有用的运行时审计证据。
- 候选改进：Attempt 分栏保存 `runtimeCostEstimateUsd` 与带 currency、components、source URL、checkedAt、route identity 的 `officialEstimatedCost`。只有完整 usage 与精确 PAYG identity 才生成 quote；订阅路由、缺失分量、MiniMax 未发布 cache-creation、币种不可比较都保持 unavailable，不按 0 或 USD 强行汇总。
- 补充验证：端到端只读任务 `3b221dc5-cd51-4c37-9d86-995884cdc21a` 已把完整 `officialCost` 写入 Attempt：42,746 input、5,373 output、151,552 cache-read、0 cache-creation，DeepSeek direct PAYG 官网报价 USD `0.023818396`；同一 Attempt 的 Claude runtime estimate 为 USD `0.423831`，约高 17.79 倍。报价包含四个组件、route、tier、source、checkedAt 与 `providerBillClaim:false`。

### FL-D48：Worker 的结构正确不等于计费语义正确

- 状态：已在主审查阶段拦截并经同 Session 纠正。
- 证据：DeepSeek Pro 任务 `382d698c-ae54-4ddb-bb58-7e8622944135` 首次实现把缺失 service tier 默认为 `standard`，并把完整 quote 压平为 total、currency、source；这会把缺失证据伪装成精确报价，也会丢失组件、route 和不可用原因。主 Codex在 Attempt 完成前主动中止并给出结构化反馈，第二次 Attempt 恢复完整语义但有一处严格类型错误，第三次修正后 344/344 tests 通过。
- 影响：仅靠“字段存在”和编译通过无法保护证据语义；弱模型或强模型都可能为了简化结构而跨过“不猜测”的核心边界。人工纠正消耗了三次 Attempt，但不应把它简化成模型永久失败。
- 候选改进：把证据完整性做成可执行 schema：缺失 tier 不得生成 quote；完整计算结果不得降维；typed unavailable reason 必须透传。主审查拒绝应是一等状态和纠正 Attempt，不混入 Provider/能力失败率；模型统计按任务类型、失败分类与纠正成功率积累样本。

### FL-D49：分层价格需要请求级 Token 证据，终态总量不足以精确重算

- 状态：已通过 DeepSeek 与 MiniMax 原始 Claude 事件对照确认。
- 证据：DeepSeek assistant 事件可见逐消息 input/cache usage，但 message-level output 为 0；MiniMax assistant usage 事件的 input/output 也为 0，只有 terminal result 给出完整聚合总量。MiniMax-M3 价格在单次请求 prompt 超过 512K 时切换价格层，因此仅凭总 input/cache/output 无法知道每次请求落在哪一层，也无法把聚合量精确分摊。系统 `thinking_tokens` 是估算或子集，不能替代账单 usage。
- 影响：把整次 Attempt 的总 prompt 套入一个 MiniMax tier 会产生看似精确的错误费用；缓存创建单价未发布时也不能默认为 0。精确计算器正确返回 unavailable，但用户仍需要可解释的下一步或保守区间。
- 候选改进：优先采集可与 terminal total 精确 reconciliation 的逐请求四分量 usage；证据不完整时输出 `exact unavailable`，并可基于所有请求都落低档/高档计算带假设的上下界。区间必须标注方法、缺失项和 `providerBillClaim:false`，不能参与跨币种或跨 route 的自动硬排名。

### FL-D50：自托管 Integration 成功后，源码、dist 与运行 daemon 可能仍分叉

- 状态：再次复现，显式 build + restart 后恢复并完成端到端验证。
- 证据：官方成本持久化补丁通过 Integration 和 344/344 tests 后，重启 daemon 运行任务 `2f7587c7-e741-4b65-9b90-b4c511268719`，数据库仍没有 `officialCost`。检查发现 Integration 的验收发生在隔离环境，原项目 `dist/src/core/runner.js` 时间戳和内容仍旧；执行 `npm run build` 并再次重启后，任务 `3b221dc5-cd51-4c37-9d86-995884cdc21a` 才成功写入完整报价。
- 影响：用户会把“已安全合入、测试通过、daemon 已重启”理解为新功能已生效，但三者仍不足以证明运行 artifact 与源一致。这对 ForkLight 修改自身尤其危险，也会让 Console 展示旧行为。
- 候选改进：记录 source digest、build artifact digest、daemon build/protocol identity 和激活时间；Console 明确显示 `source integrated / build stale / restart required / active`。ForkLight 自身可提供经过审查的一键 build-and-restart activation receipt；对任意外部项目不得猜测启动方式或自动重启。

### FL-D51：运行中状态缺少可验证的阶段心跳

- 状态：多次长 Attempt 中观察到，尚未实现。
- 证据：Worker 进程和 raw log 持续增长时，Task `updatedAt` 可长时间不变；现有 status 只显示 `running`，不能说明最近一次有效动作、当前阶段、日志是否增长、是否在 Provider 重试或是否接近 no-progress watchdog。
- 影响：用户会怀疑“界面显示运行中但其实卡住”，主调度也只能读取 PID 和原始日志做人工判断。长任务和 3–5 并发时，这会放大错误取消和无效等待。
- 候选改进：持久化 bounded progress heartbeat：最近规范化事件、事件时间、log byte/line delta、Worker PID 活性、当前阶段、Provider retry、距 watchdog 的剩余窗口。心跳是可观察证据，不应因为模型耗时较长就自动判失败；no-progress hard/warn 行为必须可配置。

### FL-D52：固定三次 Attempt 会把调度纠正与模型失败混在一起

- 状态：已在官方成本持久化任务中耗尽全部三次机会。
- 证据：同一任务的 Attempt 1 因主 Codex发现语义偏差而主动中止，Attempt 2 因一处 `exactOptionalPropertyTypes` 错误被 Verifier 拒绝，Attempt 3 完成微小修正并通过。三次分别代表主审查纠偏、实现错误和成功纠正，却共享同一个硬计数。
- 影响：若第三次仍出现环境性错误，正确 Session 会因固定上限不可恢复；同时把三次都视为模型失败会污染能力统计。无限重试也不可取，因为会放大 Token 和费用。
- 候选改进：最大 Attempt 数保持可配置，但按原因区分是否消耗能力重试配额；主审查 correction、用户取消、Provider 临时故障、Verifier 实现错误分别记录。超过软阈值先暂停并展示累计 Worker Token、官方费用/不可用原因和纠正历史，由主 Agent显式授权一次性 override，而不是静默无限执行。

### FL-D53：Token 核心再次证明“失败次数”必须按原因拆开

- 状态：三次 Attempt 后成功合入，形成新的模型纠正能力样本。
- 证据：任务 `aa43866c-7ca7-4cb2-924a-398087f0a049` Attempt 1 在无可执行阶段门的情况下先写出 730 行源码 + 1,140 行测试，主 Codex为避免盲目压缩在 Verifier 前中止；Attempt 2 收敛到 734 行，但 Worker 在无 shell 能力时声称 `All checks pass`，独立 Verifier 随即发现两处严格 TypeScript 编译错误。主审查同时发现校准类型可省略、无效 exact evidence 静默降级、坏 measurement 被过滤、缺失 exchange 被误归因等语义问题。Attempt 3 纠正后为 2 文件 / 777 行，358/358 tests 通过。
- 费用证据：Attempt 1 因人工中止没有终态 usage，不能按 0；Attempt 2 的官网 DeepSeek quote 为 USD `0.063444373`，Claude runtime estimate 为 USD `2.589603`；Attempt 3 官网 quote 为 USD `0.031310488`，runtime estimate 为 USD `1.325793`。两次运行时估算分别约为官网报价的 40.82 倍与 42.34 倍。
- 影响：按 Task 最终状态看它成功；按原始 Attempt 数看是两次失败一次成功；按能力证据看则包含“主调度取消”“编译错误”“语义审查拒绝”“成功纠正”四种不同信号。把前两次都计成 DeepSeek 能力失败会误导选模，把最终成功抹掉前两次成本也会误导效率评估。
- 候选改进：Attempt 增加 actor、stage、termination category、main-review findings、machine-verification outcome 与 correction-success 关系。模型选择使用任务类型 + 分类样本 + 近期纠正率 + 探索比例；主调度取消不计能力失败，但计入 Token/费用效率。Worker Claim 永远与 Verifier/Main Review 分栏。

### FL-D54：功能验收已通过仍会被静态 Diff 硬门判失败

- 状态：MiniMax 产物已通过全部机器测试，但未合入；正在用更真实的审查上限进行 DeepSeek 顺序 fallback。
- 证据：收据持久化任务 `694fbe80-5e9c-4935-a530-7890ebd553fe` 的 Attempt 1 为 4 文件 / 686 行，因 canonical receipt 不能再次 normalize 导致 6 个 Store 测试失败；Attempt 2 修正主要语义后为 4 文件 / 701 行，381/382 tests，通过项只剩损坏 JSON 错误会回显 parser excerpt；Attempt 3 修复该隐私问题并达到 382/382 tests，但最终 4 文件 / 721 行，超过合同 `700` 行，因此 Task 仍为 failed。主源码在三轮中保持未变，补丁未被错误合入。
- 影响：最终状态把“全部行为验收通过、仅策略门不满足”压成普通失败；同时合同不能在 Resume 时把行数从 hard 改为 warning 或授权一次性 override，三个 Attempt 耗尽后只能新建 Session。把这三次都计为 MiniMax 能力失败会丢失其纠正成功证据。
- 候选改进：安全底线与机器验收保持 hard；文件/行数按任务档位支持 `hard | warn | score | off`，并记录策略快照。Verifier 必须分别输出 `behaviorPassed` 与 `policyPassed`。当仅 warning 类门失败时，主审查可在保存原证据的前提下签发一次性 integration override，而不是修改历史状态或重跑完整实现。

### FL-D55：缺少实时 Diff 反馈和最小纠正上下文会放大 Token 税

- 状态：同一 MiniMax Session 中稳定复现，尚未实现产品修复。
- 证据：上述任务 Attempt 2 运行 178 turns，终态 usage 为 input 65,735、output 87,474、cache-read 34,519,680，runtime estimate USD `19.775365`。Worker 没有 shell/diff 工具，只能反复 Read、Grep、压缩并猜测当前体积，曾从约 803 行逐步压到 701 行仍差 1 行；Attempt 3 为修一个 parser error 又重新处理长合同，26 turns、cache-read 6,509,312，最终因修复新增代码回到 721 行。两轮官网费用均因任务缺少显式 MiniMax billing route 而保持 `route-required`，不能按 0；即使补 route，逐请求 usage 不完整仍应保持 exact unavailable。
- 影响：`maxBudgetUsd: null` 取消了费用硬停止，却没有执行阶段控制、实时体积反馈或纠正上下文裁剪；模型大量消耗发生在“估算如何过门”而不是功能实现。Console 只显示 running，也无法说明正在推理、编辑、压缩还是验证。
- 候选改进：ForkLight 应向 Worker提供只读、机器计算的 `filesChanged / changedLines / limit / delta`，接近门槛时发一次 bounded feedback；Resume 支持 `minimal correction context`，只发送当前 diff、失败命令、主审查结论和仍生效的不变量。阶段心跳、连续无进展、软费用提醒与 synthesis checkpoint 均可配置，且与用户费用硬上限分离。

### FL-D56：无关源文件变化会让行为与策略都通过的 Task 被误判失败

- 状态：收据持久化已经由主 Codex安全合入并在真实源码复验；原 ForkLight Task 保留 `failed`，没有伪造历史成功。
- 证据：DeepSeek Pro 任务 `0eaf903c-93ec-4aba-a3cf-ea6328b2d4bf` 第三次 Attempt 的独立 `npm run check` 为 391/391 tests，变更为合同内 4 文件 / 850 行，命令验收和 change budget 都通过；`verification.completed` 仍因 `sourceUnchanged:false` 给出 `passed:false`。逐字比较证明四个目标文件与 Task baseline 完全一致，只有 `PROJECT_STATUS.md` 和本 dogfood log 在执行期间更新。主 Codex只应用 `result.diff` 中四个声明文件，并在真实工作树再次通过 391/391 tests。
- 费用与模型证据：Attempt 1 是主审查主动终止，缺少终态 usage，不能按 0；Attempt 2 官网 DeepSeek quote 为 USD `0.038409688`，runtime estimate 为 USD `1.730453`，约高 45.05 倍；Attempt 3 官网 quote 为 USD `0.019003642`，runtime estimate 为 USD `1.060162`，约高 55.79 倍。Attempt 2 是测试夹具/错误分支失败，Attempt 3 是行为成功但基础设施误拒绝，二者不能统一记为模型能力失败。
- 影响：全仓库 `sourceUnchanged` hard gate 会把同步文档、无关用户改动或另一个并发 Agent 的独立文件改动误判为补丁冲突，3–5 并发越高误拒绝概率越大；Task status 又无法表达 `behaviorPassed=true / policyPassed=true / sourceConflict=unrelated`，主审查只能依靠外部证据恢复。
- 候选改进：Verifier 输出结构化 source drift 文件列表，并按与补丁影响面是否相交分类。受影响文件变化继续是不可关闭的 hard safety invariant；无关文件变化默认 `warn`，记录证据但不使行为验收失败。Integration preflight 再次校验目标文件 digest，主 Agent可对无关 drift 签发一次性、可审计的 affected-files-only acceptance，而不是修改 Task 历史或重跑完整 Worker。

### FL-D57：`running` 状态无法区分模型推进、Provider 等待和真正卡死

- 状态：在 MiniMax-M3 三轮 MCP 收据任务中再次复现；本轮只能由主 Codex读取 PID、raw log 大小和修改时间人工确认。
- 证据：任务 `54190ea6-1819-404a-bfcb-c693e4d9d1f0` 的 Attempt 1 持续约 34 分 44 秒，中间多次出现约 3–4 分钟 Provider 返回间隔，但进程仍存活且随后继续编辑；Task `updatedAt` 长时间停留在较早时间，Console 只显示 `running`。Attempt 3 运行期间 raw log 从 27KB 持续增长到 726KB，最终正常转入 `verifying` 并成功。
- 影响：长等待会被用户误认为卡死，也可能被 no-progress 规则错误判为模型失败；反过来，只有进程存活也不能证明任务有有效进展。
- 候选改进：把 `worker_action`、`provider_wait`、`verifying`、`no_progress` 分成可观察阶段，并保存最近事件时间、日志增量、PID 状态和距 watchdog 的时间。Provider 等待不计模型能力失败；等待超时的 hard/warn 行为与阈值可配置。

### FL-D58：Diff 硬门同时暴露了机器计数缺失和可读性退化

- 状态：当前功能已通过主审修正并安全合入；产品策略仍待实现。
- 证据：同一任务 Attempt 2 的独立验收为 400/400 tests、`sourceUnchanged=true`，但机器实算 834 行，超过合同 750 行。MiniMax 自报 748 行，是因为只相加了新增文件行数和 `server.ts` 的净增量，漏掉了 43 行删除。Attempt 3 在明确反馈后压到 733 行并通过，但为过硬门把多个 handler 压成拥挤单行；主 Codex审查又发现六个已知 Task 工具的 `ensureDaemon` 位于 receipt wrapper 外，daemon 启动错误不会留下失败证据，随后在真实源码中纠正并恢复可读结构。
- 影响：Worker claim 不能作为预算证据；静态行数 hard gate 会把优化目标从正确性和可维护性转向文本压缩，并可能制造测试未覆盖的边界缺陷。将 Attempt 2 记为普通模型失败也会丢失“行为全过、策略不符”的事实。
- 候选改进：ForkLight 在 Worker 执行中提供只读机器 Diff 计数，并明确 `additions + deletions`；Verifier 分开输出 `behaviorPassed`、`policyPassed` 和 `mainReviewAccepted`。Diff 预测与质量预算默认支持 `warn/score`，只有明确 profile 才为 hard；主审查发现的问题可进入独立 correction 状态，不与 Provider 或模型失败混算。
- 再次证据：DeepSeek 任务 `7e60b684-62fe-4fbc-8c25-be231c7a2057` 第三轮的两条验收命令均通过，Worker 自报约 843 行，`verification.completed.changeBudget.changedLines` 为 `887`，而 `inspect --summary` 的 `diff.lineCount` 又是 patch 文件总行数 `937`。三种口径同时出现，最终只因 887/850 被标记 failed；正确实现已由主 Codex安全合入并在真实源码通过 568/568。UI 与 Worker 必须统一展示 additions、deletions、changedLines 和 patchLines，策略只能绑定一个明确口径。

### FL-D59：无效 MiniMax 计费路由直到任务结束才被发现

- 状态：已复现，三次 Attempt 的官网费用均保持 typed unavailable，没有伪装成 0。
- 证据：任务把中国区直付路由写成 `minimax-cn-direct-payg`，而官方目录的 canonical identity 是 `minimax-china-direct-payg`。三个 Attempt 分别保存了完整 terminal usage，但 `officialCost` 都返回 `pricing-identity / unsupported-route`；Claude runtime estimate 分别为 USD 9.936922、5.357151 和 4.810243，不能当作 MiniMax 官网账单。即使修正路由，当前终态聚合 usage 仍缺少 MiniMax 512K 分层所需的逐请求数据，精确报价应继续为 `per-request-usage-required`。
- 影响：一个可在提交前确定的路由拼写错误拖到任务完成后才暴露，导致整轮成本证据不可报价；若系统自动把相近字符串纠正，又可能把订阅或不同区域错误套成 PAYG。
- 候选改进：Validate/Submit 用价格目录校验 provider + endpoint + route + model identity，未知值 hard reject 并列出合法选项；缺失 route 根据环境给出选择而不猜测。路由正确但请求级 usage 缺失时继续显示精确费用 unavailable，并给出带假设的上下界或下一步采集要求。
- 再次证据：MiniMax 任务 `7d6d99ab-99fc-4cd7-9edc-45dd89ca83ca` 的合同质量校验为 100/100，但未声明中国站必需的 `pricingRoute`，两个 Attempt 最终都只能保存 `pricing-identity:route-required`。任务模板已补为 `minimax-china-direct-payg`，历史费用不回填；Validate 仍应在计费请求前把可确定的缺失 route 明确为 hard 配置错误。

### FL-D60：Task 报告可以计算 Worker 总量，但没有 transport receipts 时必须拒绝声称节约

- 状态：receipt-aware 核心与 Store-backed Task report 已合入真实源码并通过 432/432 tests；CLI capture 与用户可见命令尚未实现。
- 证据：DeepSeek Pro 任务 `9de401d7-26ba-44f8-8168-c8332a1be559` Attempt 1 因一处 `exactOptionalPropertyTypes` 测试夹具错误失败，官网报价 USD `0.059081091`，runtime estimate USD `1.920926`；Attempt 2 在同 Session 纠正编译、空 receipts 优先级、校准夹具和真正可区分 `max/sum` 的 overlap 测试后成功，官网报价 USD `0.025231479`，runtime estimate USD `1.156699`。最终 4 文件 / 1,042 行，432/432 tests。
- 真实报告：对该 Task 读取两次完整 usage 后得到 input 79,076、output 44,237、cache-read 3,152,640、cache-creation 0，gross Worker Tokens 为 3,275,953；但 receiptCount 为 0，因此 exchange estimate 为 `no-measurements`、boundary reduction 为 `missing-exchange-evidence`、direct-Codex savings 为 `direct-baseline-missing`。没有把 3,275,953 直接叫作“节约量”。
- 影响：核心计算正确不等于产品已经能展示 saved Tokens；只要主调度走未捕获的 CLI，或当前 Codex 仍使用升级前常驻 MCP，就只有 Worker 侧证据。若 UI 把 gross volume 当 savings，会制造最关键指标的虚假精度。
- 候选改进：为任务级 CLI submit/status/inspect/resume/integration 调用写同语义 count-only receipts，并新增 Task report CLI。所有消费者分栏展示 `gross Worker volume`、`orchestration exchange range`、`boundary reduction` 与 `direct-Codex counterfactual`；缺失 transport evidence 继续 unavailable。

### FL-D61：Integration 再次通过，但真实 `dist` 仍缺少新模块

- 状态：本轮由主 Codex在真实源码执行 `npm run check` 后恢复，daemon 尚未再次激活新报告模块。
- 证据：Task Integration 回执显示 432/432 tests 与 build 通过，但合入后真实仓库 `dist/src/core/token-report.js` 不存在，直接 import 返回 `ERR_MODULE_NOT_FOUND`。主 Codex在真实 `/Users/yijunwang/code/forklight` 再次执行 `npm run check` 后生成 JS、map 与 d.ts，432/432 tests 再次通过，随后真实 Task report 才能运行。
- 影响：Integration receipt 的 `applied` 与测试成功仍不足以证明运行 artifact 已激活；这已经是同类问题的再次独立复现。若没有额外检查，Console/CLI/daemon 可能继续运行旧能力。
- 候选改进：Integration 结果分开记录 `sourceApplied`、`sourceVerified`、`artifactBuiltInSource` 与 `runtimeActivated`，并保存目标 artifact digest。自托管 ForkLight 提供显式 activation receipt；缺少新入口文件时不得宣称版本可用。

### FL-D62：长时间有工具事件不等于任务正在有效收敛

- 状态：本轮由主 Codex主动中止第一轮并沿用同一 Session纠正，第二轮成功合入。
- 证据：MiniMax-M3 任务 `2a674c1f-a273-4851-b889-e232248ad292` Attempt 1 运行约 14 分钟、产生超过 250 个工具事件，仍在重复读取和“最终复查”；机器实算变更已达 1,797 行，且存在测试类型错误和多处语义缺口。主 Codex终止 Worker 后，Resume 只提供当前 Diff、失败命令、明确边界和仍生效的不变量；Attempt 2 用 45 turns 收敛到 6 个路径、1,183 changed lines，并通过独立 Verifier。
- 影响：仅按 PID 存活、日志增长或工具事件计数会把“活跃但不收敛”误判为健康执行；无限预算会进一步放大这种 Token 税。主审查中止是调度纠偏，不应永久封禁模型或算作普通能力失败。
- 候选改进：增加可配置的阶段心跳、首次有效修改、连续重复读取、Diff 趋势、synthesis checkpoint 与 no-progress 判定。超过软阈值先请求 Worker 总结当前状态；由主审查终止时记录 `main-review-correction`，保留 Session 并优先用 minimal correction context 恢复。

### FL-D63：主审查中止会保存工作区，却丢失终态用量证据

- 状态：Workspace 和 Session 可恢复，但 Attempt 1 的费用与 Token 证据不完整。
- 证据：上述 Attempt 1 收到 SIGTERM 后以 exit 143 结束，没有 terminal result，因此 `officialCost` 为 `usage-missing`。Attempt 2 完整保存 input `22,453`、output `27,836`、cache-read `8,787,328`、cache-creation `0`，gross Worker volume 为 `8,837,617`，Claude runtime estimate 为 USD `5.201829`；官网 MiniMax 报价因 billing route 与逐请求分层证据不足保持 unavailable。
- 影响：被主调度节流的失败轮仍实际消耗了 Token 和费用；将缺失证据显示为 0 会系统性低估失败成本，也会错误美化模型效率。
- 候选改进：中止前请求 bounded usage checkpoint，或从已持久化的逐消息 usage 生成 `partial` 证据；报告必须区分完整、部分和缺失，不得把 unavailable 聚合为 0。能力统计可排除主审查中止，效率统计必须保留其可观察消耗。

### FL-D64：CLI 收据和 Token 报告已真实工作，但仍不能直接声称节约量

- 状态：CLI 边界捕获与 `forklight tokens` 已在真实 daemon 上验证，源码通过 439/439 tests。
- 证据：对同一 Task 执行新版 CLI `status` 和一次安全失败的 `integration apply` 后，生成两条 count-only 收据；连续两次查询 `tokens --json`，receiptCount 始终为 2，证明报告不会捕获自身并形成递归膨胀。报告显示 gross Worker volume `8,837,617`、exchange estimate `324–1,940` Tokens；由于 Attempt 1 usage 缺失，boundary reduction 为 `incomplete-worker-usage`，direct-Codex savings 为 `direct-baseline-missing`。
- 影响：ForkLight 现在能观察 Worker 体量和主调度交换负担，但 8.84M 是 Worker 总量，不是“主线程节约了 8.84M”。没有完整 Worker 证据与同类任务的 direct-Codex calibration 时，产品必须继续显示不可用原因。
- 候选改进：Console 分栏展示 `Worker gross volume`、`orchestration exchange estimate`、`boundary reduction` 和 `direct-Codex counterfactual`。先建立按任务类型匹配的小型校准集，再给范围与置信度；永远不以一个总量替代四种不同含义。

### FL-D65：Task 经济报告已能揭示运行时估算与官网费用的数量级差异

- 状态：核心读模型已由 ForkLight完成、安全合入并在真实源码通过 452/452 tests；统计和 Console 消费仍待实现。
- 证据：DeepSeek Pro 任务 `dbce4ffc-55e3-4b8b-91a4-39acf7e36340` 的三个完整 Attempt，Claude runtime estimate 合计 USD `1.239445`，按 DeepSeek 官网价格和真实 usage 重算合计 USD `0.0341649`，前者约为后者 36.28 倍。首轮由主审查中止，缺少 terminal usage；报告明确显示 runtime sample `3/4`、official unavailable `usage-missing: 1`，没有把该轮成本填成 0。预算快照正确显示 `uncapped`，不等于零成本或公司无限支出授权。
- 影响：Console 当前 `Avg Cost` 会继续传播误导；新读模型已经能分开运行时估算、官网原币报价、缺失证据、Worker Token 和运行时预算，但只有接入消费者后用户才能看到。
- 候选改进：统计按原币分组官网费用，不跨 USD/CNY 相加；任务详情展示来源、样本完整性与 `providerBillClaim:false`。旧 `costUsd` 只能标为 runtime estimate，Competition 在官网费用不可比较时不得用它做硬排名。

### FL-D66：CLI 收据测到的是管道前产出，不一定是 Codex 真正收到的上下文

- 状态：真实 dogfood 首次量化复现；当前报告保持 low confidence，尚未修正 measurement scope。
- 证据：同一 Task 共留下 55 条 CLI 收据，其中 42 次 `status`、6 次 `inspect`。六次 inspect 在 CLI 端合计输出 `745,862` bytes，最大单次 `270,879` bytes；但主调度实际使用了 `inspect --json | jq ...` 等下游过滤，Codex 工具结果只收到筛选后内容。现有收据在 ForkLight CLI 写 stdout 前计数，因此不知道后续 shell 管道删除了多少。报告给出 exchange range `134,276–813,102` Tokens，不能当作真实主线程载荷。
- 影响：直接把 CLI producer bytes 叫作 main-context Tokens 会高估主线程开销，也会低估 ForkLight 的 Token 节约；反过来，大量 full inspect 和完整 Integration 测试 stdout 确实制造了不必要的上游输出与进程开销。
- 候选改进：收据标注 `measurementScope=producer-pre-pipe`，与 MCP 的直接 transport evidence 分开；只有 Codex 调用边界才能记录 post-pipe 实际负载。增加 compact inspect、bounded wait/state-change、Integration summary 和显式 verbose，主调度默认消费小而足够的验收证据。

### FL-D67：固定 Attempt 上限需要可审计的一次性纠正，而不是永久放宽

- 状态：通过临时配置 override 完成第四轮最小纠正，随后立即恢复 `maxAttempts=3`。
- 证据：Attempt 1 是主审查因 1,103 行超合同而中止；Attempt 2 收敛到 695 行，但一处 `exactOptionalPropertyTypes` 测试夹具编译失败；Attempt 3 全仓 450/452 tests，两个失败都只是浮点数 strict equality；Attempt 4 仅改两处容差断言后达到 452/452。默认三次用尽后，主 Agent把 `execution.maxAttempts` 临时从 3 改为 4，确认第四轮 running 后恢复为 3，历史四轮与费用证据均保留。
- 影响：如果不能一次性授权纠正，正确 Session 会因固定次数被迫废弃并重做上下文；若永久提高上限，又会放大真正无进展任务的 Token 税。四轮也不能都统计为 DeepSeek 模型失败。
- 候选改进：产品化 `one-time resume override`，记录授权者、原因、允许的额外 Attempt 数、累计 Token/费用和过期条件；主审查中止、测试夹具错误、行为失败与纠正成功分别进入能力统计。全局默认配置不应为单 Task 临时授权而来回修改。

### FL-D68：compact wait 降低了输出量，但 status 时间戳不代表有效进展

- 状态：`wait --until change|terminal` 与 `inspect --summary` 已交付并进入真实 dogfood；单次 wait 内部轮询只返回一个最终响应和一条收据。
- 证据：任务 `e010d8fd-dd9d-4ff0-8c1f-1c57b624ef54` 运行期间 Worker 持续产生读取、搜索、编辑等工具事件，但 Task `updatedAt` 与顶层 status 长时间不变；`wait --until change` 因此无法区分“正在有效推进”和“进程存活但没有收敛”，主调度仍需额外 `inspect --summary`。
- 影响：compact 输出已经减少主线程 Token 税，但其变化语义仍过粗；若把超时理解成停滞会误杀正常长任务，若只看 PID/事件数量又会放任重复读取消耗无限预算。
- 候选改进：summary 增加 `stage`、`latestEffectiveActionAt`、最新有效动作类别和 Diff 趋势；`until change` 可配置观察 status-only 或 effective-progress。无进展阈值默认是 soft warning/pause-for-review，不应成为模型永久失败的 hard gate。
- 再次证据：观察任务 `7e60b684-62fe-4fbc-8c25-be231c7a2057` 时，`wait --until change` 在 55 秒后返回 timeout，而同一窗口 Worker events 已持续新增 Read/Edit/message。该命令只比较 Task 顶层状态/`updatedAt`，不能兑现用户理解中的“有新进展”。

### FL-D69：常驻 MCP 与新版 CLI 的能力身份仍可能分叉

- 状态：本轮使用新版 CLI 绕过，Daemon 已在无活跃 Task 后重启加载最新 `dist`；产品级版本身份仍缺失。
- 证据：当前源码和 CLI 已支持 `runtime.maxBudgetUsd: null` 作为真正不限额，但当前 Codex 中较早启动的 ForkLight MCP 仍用旧校验器拒绝 null；同一机器、同一仓库出现“CLI 可提交、MCP 不可提交”。
- 影响：用户会把“ForkLight 已升级”理解成所有入口一致，实际却可能因常驻进程不同步而得到相反结论；自托管修改尤其容易出现源码、构建产物、Daemon 和 MCP 四种版本。
- 候选改进：所有入口公开 build/protocol/schema identity 与激活时间，客户端提交前比较兼容性；自托管提供可审计 activation receipt，并在 Console 明确显示 source integrated、artifact built、daemon active、MCP restart required。
- 再次证据：MiniMax terminal-usage 任务文件显式声明了 `directCodexProfileId: codex-gpt-5.6-sol-xhigh-v1`，本地新版 CLI 也以 100/100 通过；真正 submit 仍由未重启的旧 daemon 解析，持久化 TaskSpec 静默缺少该字段，Token report 因而返回 `direct-codex-profile-missing`。两项任务结束后已显式 build，并重启 daemon/Console；历史 Task 不做静默回填。提交时必须比较客户端与 daemon 的 schema/build identity，未知字段不能静默丢弃。

### FL-D70：占位符检查把正常领域词 `unknown` 误判为未完成合同

- 状态：真实 Task YAML 通过改写措辞绕过；验证器语义未修复。
- 证据：合同中描述“unknown/nonexistent Task”这一正常错误场景时，validator 仅凭 `unknown` 文本命中占位符规则并拒绝整份 Task，而不是检查结构化未填字段。
- 影响：硬性字符串规则会迫使主 Agent 改写准确表达，增加合同 Token 和认知成本，也会使不同语言/领域词产生随机误报。
- 候选改进：占位符 hard gate 只识别明确模板标记与空结构字段；普通自然语言命中降为可解释 warning，允许 Task 级 override 并记录原因。结构完整性与措辞启发式必须分开分类。

### FL-D71：Daemon 经济性读路径已用 DeepSeek Pro 一次完成并真实激活

- 状态：任务成功、安全合入、真实源码通过全仓测试并在重启后的 Daemon/Console 中验证。
- 证据：DeepSeek `deepseek-v4-pro[1M]` 任务 `f3ea0317-f0af-473c-a6c2-3ccb1eb2aa4d` 一次 Attempt、37 turns；usage 为 input `54,451`、output `15,579`、cache-read `1,046,528`、cache-creation `0`。Claude runtime estimate 为 USD `1.184994`；按 DeepSeek 官网价格重算为 USD `0.041033579`，来源为 `https://api-docs.deepseek.com/quick_start/pricing/`。Daemon 新增只读 `task_economics`，最终全仓 465/465。
- 影响：同一 Attempt 两种金额相差约 28.88 倍，再次证明 runtime estimate 与官网原币报价必须分栏。一次成功是该模型在此类窄后端任务上的正样本，但样本数不足以成为默认硬路由。
- 候选改进：把官方报价、运行时估算、预算上限与证据完整性分别进入统计；模型选择只把同任务类型、带样本量的近期表现作为可配置 score，验证与安全边界继续独立 hard gate。

### FL-D72：MiniMax 三轮完成 Console，但两次失败属于不同纠正类别

- 状态：任务 `64824be1-650c-423c-823e-88bad5f3562a` 第三轮成功、安全合入；Console consumer 与真实页面已验收。
- 证据：Attempt 1 为测试夹具 TypeScript 编译错误，136 turns，input `169,297`、output `67,819`、cache-read `15,223,935`；Attempt 2 为三条测试预期与既定 HTTP optional-field、隐私边界和“校准仍需 exchange”语义冲突，17 turns；Attempt 3 最小纠正成功，16 turns。最终任务累计 gross Worker Tokens `21,526,290`，全仓 471/471。三轮 MiniMax 官网精确费用均因缺少逐请求 512K 分层 usage 保持 `calculation:per-request-usage-required`，没有用 Claude runtime estimate 冒充。
- 影响：若统计只记录两次 failed + 一次 succeeded，会把夹具错误、验收设计错误和纠正能力混成模型失败率；同时 136-turn 首轮显示“持续有动作”不等于高效收敛。
- 候选改进：Attempt 分开保存 implementation、fixture、verifier-contract、provider、policy、main-review-correction 等 termination category，并把 correction-success 关联到前轮。模型选择考虑任务类型、分类样本、纠正率和探索比例，不因原始失败次数永久禁用 MiniMax。

### FL-D73：MiniMax M3 官网价格已核对，但聚合 usage 仍不能制造精确报价

- 状态：价格目录与官网一致；计算器继续 fail closed。
- 证据：国际站标准层 <=512K 为 USD `0.30/1.20/0.06` 每百万 input/output/cache-read，>512K 翻倍；Priority 也有独立费率，来源 `https://platform.minimax.io/docs/guides/pricing-paygo`。中国站 M3 标准层 <=512K 为 CNY `2.10/8.40/0.42`，>512K 为 `4.20/16.80/0.84`，来源 `https://platform.minimaxi.com/docs/guides/pricing-paygo`。现有 terminal result 只有整轮聚合量，不能知道每个请求落在哪一档。
- 影响：目录正确不代表每个 Attempt 都可报价；把整轮聚合 prompt 套入某一档会输出错误的精确数字。
- 候选改进：采集并与 terminal totals 对账的逐请求 usage 后再精确报价；在此之前只显示 typed unavailable，或在明确假设下显示上下界，不能作为预算 hard stop 或模型价格硬排名。

### FL-D74：真实浏览器验收连续发现四个“测试绿但用户不可用”的 Console 问题

- 状态：主 Codex 已修正并在桌面 1280x720、窄屏 390x844 与真实 Daemon 数据上复验；全仓 471/471。
- 证据：初版把 `0.041033579 USD` 以两位小数显示为假 `0.00`；来源 URL 未限制协议；Token range DOM 节点与字符串相加显示 `[object HTMLSpanElement]`；点击长任务表后详情位于列表末尾、当前视口完全不可见。修正后使用自适应非零精度、仅 HTTP(S) 可点击、DOM 节点分段 append、固定右侧详情抽屉，窄屏为全宽单列，并支持 Escape 与焦点回退。
- 影响：接口正确和静态源码断言不能证明完整体验。尤其 Token/费用证据若在呈现层失真，会直接破坏用户对核心指标的信任。
- 候选改进：Console 关键路径必须包含真实浏览器视觉验收；将金额、区间、不可用状态、长列表点击和窄屏作为固定场景。任务详情 timeline 仍偏长，应增加阶段折叠/最近有效动作摘要，而不是默认展示 50 条低层事件。

### FL-D75：统计页仍在消费旧 runtime estimate，已先修正文案而未伪造官网统计

- 状态：Overview/Stats 已把 `Avg Cost` 改为 `Avg Runtime Estimate (USD)`，并解释其不是 Provider official cost；时长单位从错误的 `s261.6` 修正为 `261.6s`。
- 证据：真实 Overview 在修改前把 DeepSeek/MiniMax 的 Claude-side `avgCostUsd` 与成功率并列显示为 Avg Cost，和任务详情的官网报价语义冲突。现有统计服务尚未按原币聚合 Attempt official-cost evidence，因此没有直接替换成一个貌似准确的新金额。
- 影响：改名消除了当前误导，但用户还不能在模型长期统计中比较官网费用完整性、原币总量或 unavailable 原因。
- 候选改进：统计新增按 currency 分组的 quoted totals、quoted/unavailable sample count、typed unavailable breakdown 与 runtime-estimate completeness；禁止跨币种总和。费用、速度、成功分类均作为带样本量的可配置 score，安全/验证 hard gate 单独处理。

### FL-D76：校准注册表机器验收通过，主审查仍发现隐私与索引完整性缺口

- 状态：DeepSeek Pro 产物已安全合入，主 Codex 完成三处纠正；最终校准消费者合入后全仓 489/489 tests。
- 证据：任务 `0bfc6fc1-cb21-44fc-bbef-ea767ab35cc0` 一次 Attempt、40 turns，usage 为 input `94,186`、output `49,295`、cache-read `2,264,064`；Claude runtime estimate 为 USD `2.835337`，DeepSeek 官网重算为 USD `0.092064792`。Worker 为满足 400 行硬门把最初约 559 行收敛到 378 行并通过机器验收，但主审查发现 `evidenceReferences` 可接受过宽字符串、`createdAt` 只要求 `Date.parse` 可解析而非 canonical ISO、SQLite 独立索引列未与 JSON payload 交叉核对。主 Codex 随后限制引用为不含内容的 opaque identifier、要求 canonical ISO，并在读取时校验索引列与 payload 一致。
- 影响：绿测试证明机器合同通过，不等于隐私语义和持久化完整性已被完整覆盖；同时硬性行数门再次驱动 Worker 花时间压缩测试。一次成功应成为 DeepSeek 在 Store/校准类任务上的正样本，但主审查纠正不能从成功统计中消失。
- 候选改进：Verifier、policy gate 与 main-review acceptance 分栏；校准 schema 的隐私和索引一致性做成可复用安全不变量。Diff 体积默认作为可配置 quality gate 或 score，只有明确 profile 才 hard，不能靠压缩测试换取表面合规。

### FL-D77：校准消费者首轮失败来自合同边界，修订后 MiniMax 能完成纠正

- 状态：首个 Task 保留 failed 历史；修订 Task `109561d2-da37-414e-a215-777e0c611fb6` 第三次 Attempt 成功，已通过主审、preflight 和安全 Integration。
- 证据：首个任务 `967b7dad-be0e-43ed-9932-0af26851570b` 的 Worker 正常完成 49 turns，usage 为 input `112,845`、output `45,697`、cache-read `3,578,306`，runtime estimate USD `3.495803`；独立 build 发现一个既有 `TaskTokenReport` 夹具位于原四文件边界外、一处测试直接 cast，changed lines `517` 超过 hard `400`。修订合同显式纳入第 5 个消费者文件；主 Codex 在前两轮分别发现缺失括号和两个测试夹具语义错误后主动中止并反馈，第三轮只用 21 turns 完成纠正，usage 为 input `23,543`、output `16,136`、cache-read `3,509,752`，runtime estimate USD `2.275991`。MiniMax 官网费用仍因缺少逐请求 512K 分层 usage 为 `per-request-usage-required`。最终 5 文件 / 342 changed lines，focused 41/41、全仓 489/489。
- 影响：原合同的真实调用面少一个测试消费者，Worker 不可能同时满足“字段必填、不能改第 5 个文件、必须全仓编译”。同一 MiniMax Session 在获得精确失败证据后完成了正确纠正，因此原始失败数不能成为永久禁用模型的依据；前两次主审中止也不能计成 Provider 失败。
- 候选改进：Validate/Submit 对可静态发现的类型消费者给出影响面预警；失败分类至少分 `contract-scope-mismatch`、`implementation-compile`、`fixture-semantics`、`behavior-verification` 与 `policy-budget`。失败后允许主 Agent 修订 focus/budget 并在可审计纠正链中继续，而不是诱导弱化类型或永久降级模型。

### FL-D78：完全禁止 Worker shell 会把编译反馈推迟到终态，放大盲目纠正成本

- 状态：本轮由主 Codex 在隔离工作区主动执行 bounded build/focused tests 才提前收敛；ForkLight 尚无 Worker 可请求的安全验证 checkpoint。
- 证据：MiniMax Worker 只有 Read/Glob/Grep/Edit/Write，不能运行合同已经声明的验收命令。Attempt 1 靠逐文件读取检查时漏掉 `tests/task-economics-report.test.ts:543` 的缺失括号；Attempt 2 修正后仍无法看到 41 个 focused tests 中两个夹具错误，只能继续 Grep/Read 猜测。主 Codex 分别跑出明确 build 错误与 39/41 结果后中止并反馈，第三轮才达到 41/41。前两轮因 SIGTERM 没有 terminal result，Token 与费用证据为 `usage-missing`，不能按 0。
- 影响：禁止任意 shell 是重要安全边界，但“Worker 无法请求任何受控验证”会增加 turns、重复读和纠正轮次；在单任务不限预算时尤其容易产生 Token 税。主调度能手工进入隔离区执行并不是可复用产品体验。
- 候选改进：增加 daemon 执行的只读/白名单 verification checkpoint：Worker 只能请求合同内既有命令，daemon 在隔离环境运行、限制超时与输出并把结构化结果返回 Session；是否允许、触发阶段、次数和 Token/时间提醒可配置。任意 shell 仍保持 hard 禁止，checkpoint/fixture 失败与模型、Provider 失败分开统计。

### FL-D79：Integration 再次显示 build 通过，但主项目 dist 实际没有刷新

- 状态：已通过显式 source build + daemon/Console restart 恢复并完成真实 HTTP 验证；产品级 activation receipt 仍未实现。
- 证据：任务 `109561d2-da37-414e-a215-777e0c611fb6` 的 Integration 结果记录 focused 41/41、全仓 489/489，并显示 `npm run build` 通过。随后重启 daemon PID `87440`，Console Task 响应仍没有 `calibrationSelection`；检查发现 `src/core/token-report.ts` 已是 08:23 新版本，而 `dist/src/core/token-report.js` 仍停在 07:58 且不含 selector。主 Codex 在真实源码根目录显式执行 `npm run build`，确认 dist 含 `selectCalibration` 后再次重启 daemon PID `90736` 和 Console。真实 HTTP 响应随即返回 `calibrationSelection: { kind: task-class-missing }`，并继续正确保留 `direct-baseline-missing`。
- 影响：Integration 的验收输出会让用户合理地相信主项目 artifact 已构建，但实际命令运行位置或构建产物并未激活原项目 dist；仅“应用成功 + build 绿 + restart”仍不足以证明运行代码是新版本。这会让 Console 和 daemon 悄悄返回旧语义。
- 候选改进：Integration/activation 分成明确阶段并保存 source digest、artifact digest、构建工作目录、daemon executable digest、PID、启动时间和端到端 capability probe。自托管场景提供一键、可回滚的 build-and-restart activation receipt；Console 显示 `source integrated / artifact stale / restart required / active`，不能从测试输出推断 active。

### FL-D80：第三轮 Worker 自报完成，但机器证据仍是行为失败与策略超限

- 状态：Task 保留 failed；主 Codex 已按原合同边界纠正并在真实工作树通过聚焦与全量回归。
- 证据：DeepSeek Pro 任务 `43e34f6b-04bb-4199-b657-05550a9ff9b4` Attempt 1 由主审查中止且没有 terminal usage，不能按 0；Attempt 2 为 13/14 focused tests，input `23,727`、output `20,561`、cache-read `771,968`，Claude runtime estimate USD `1.018644`，DeepSeek 官网重算 USD `0.031007699`。Attempt 3 的 Worker 文本声称所有纠正已应用，但独立 Verifier 为 16/17，失败断言把已经由 normalizer 冻结的 canonical sample 当作应保持 unfrozen 的 caller input；同时机器计数为 2 文件 / 411 changed lines，超过 hard `400`。Attempt 3 input `25,184`、output `12,708`、cache-read `1,605,248`，runtime estimate USD `1.246244`，官网重算 USD `0.027830024`。主 Codex 改用原始 caller objects 验证不冻结、保留反序输入的确定性测试，并把实现收敛到 389 行；最终 17/17 focused、506/506 full tests。
- 影响：顶层 `failed` 同时包含正确核心实现、错误测试夹具、Worker 虚假自验和 Diff policy 超限；反过来，主审最终接受也不能抹掉前三轮真实费用与失败证据。固定三轮结束后缺少可审计的“主审最小纠正并重新签发机器验收”路径，只能绕开 Task 的成功状态。
- 候选改进：Task 终态分栏保存 `workerClaim`、`behaviorVerification`、`policyEvaluation` 与 `mainReviewAcceptance`；Verifier 失败时自动把精确命令输出提供给同一 Session，Worker 无 shell 时可请求受控 checkpoint。Attempt 用尽后支持一次性 main-correction patch + verifier receipt，保留原 failed 历史而不要求重跑完整实现。

### FL-D81：校准样本缺少 direct-Codex 执行配置身份，后续可能混合不同基线

- 状态：在 paired core 主审中发现，当前合同因明确禁止修改既有 aggregate schema 而未在本轮扩展；必须在真实样本持久化前解决。
- 证据：`DirectCodexPairedSample` 记录 Task、taskClass、四分量 usage、run/pair identity 与时间；`DirectCodexCalibrationRecord` 记录 taskClass、method、version 与证据引用，但两者都没有结构化 direct-Codex model、reasoning effort、context policy 或统一 profile id。调用者可以把这些信息写进自由文本 method，却没有机器可验证的同一性约束。
- 影响：同一 taskClass 下把不同 Codex 模型、effort 或上下文策略的样本混在一个 min/max envelope，会让 counterfactual 基线不可复现，也可能在模型升级后继续使用陈旧校准。它不是隐私问题，却直接影响“节约多少 Token”是否可信。
- 候选改进：在 sample、publication key 和 selector 中加入显式、版本化、非内容型 `directCodexProfileId`，由操作者选择而非从任务名推断；发布时要求样本 profile 完全一致，并为过期/缺失/profile mismatch 提供 typed unavailable。模型名、effort、上下文策略的可解释元数据应单独版本化，不能靠自由文本 method 隐式编码。

### FL-D82：MiniMax 完成了正确核心，但缺少机器反馈使测试夹具和 Diff 口径连续误判

- 状态：Task 保留 failed；profile-bound publication core 已由主 Codex 最小纠正并在真实工作树通过 508/508 tests。
- 证据：MiniMax task `bf2a4810-c9d3-49d6-a1cf-061347c0f289` Attempt 1 为 20/22 focused，usage 为 input `85,369`、output `36,753`、cache-read `770,560`，Claude runtime estimate USD `1.73095`；Attempt 2 由主审在 TypeScript spread 错误与 342 changed lines 时中止，终态 usage 缺失；Attempt 3 的 profile gate、exact envelope 和 transport normalizer 均正确，但两个测试分别把 publisher 返回的冻结对象当作应保持 unfrozen 的原始输入、把语法合法的 secret 字符串当作应拒绝的 profile/method。独立验收为 22/24，机器 `changedLines` 为 additions + deletions = `278/260`；Worker 却以净新增 `240` 自报门槛通过。Attempt 3 usage 为 input `68,842`、output `49,959`、cache-read `5,940,480`，Claude runtime estimate USD `4.563425`；MiniMax 官网精确费用继续因缺少逐请求 512K tier evidence 为 `per-request-usage-required`。主 Codex 用可变原始 fixture、真正无效且不回显的值、紧凑但完整的场景纠正为 2 files / 140 changed lines，focused 19/19、全仓 508/508。
- 影响：顶层 failed 不是 Provider failure，也不能推出 MiniMax 后续不可用；它同时包含正确实现、fixture-semantics、policy-budget 和 Worker self-claim mismatch。无 shell Worker 无法在报告前看到编译/测试结果，且产品没有把实时机器 Diff 的定义和计数回传，导致大量 Token 用于读取、猜测和按错误口径压缩。
- 候选改进：运行中向 Worker 和 Console 提供 daemon 计算的 `filesChanged`、`additions`、`deletions`、`changedLines` 与 policy mode，明确禁止用 net lines 替代；支持只执行合同验收命令的受控 verification checkpoint；Task 终态分栏保存 `workerClaim`、`behaviorVerification`、`policyEvaluation`、`mainReviewAcceptance` 和 correction receipt。Diff 默认可按 profile 配置为 `warn/score`，只有明确选择时才 hard；安全与独立验证仍保持 hard。

### FL-D83：Task `updatedAt` 不反映 Worker 活动，控制台无法区分活跃思考与停滞

- 状态：本轮通过进程、日志 mtime 和事件流旁路确认 Worker 正常执行；公开状态仍只显示旧时间。
- 证据：Attempt 3 从 09:24 到 09:30 持续生成 thinking、Read、Edit 和最终 result，日志每秒增长，PID `47149` 存活；`forklight_status` 在整个窗口仍返回 `updatedAt = 2026-07-23T01:12:33.232Z`，直到 Task 终态才跳到 `01:30:12.844Z`。仅看 Task 状态时间会把约 18 分钟真实活动误判为无进展。
- 影响：用户问“是不是正常执行”时，Console/CLI 不能用自身公开读模型给出可信答案；主 Agent 只能读取内部日志和 PID。反过来，日志增长也不等于有效收敛，所以单纯刷新时间仍不够。
- 候选改进：公开 `lastEventAt`、`lastEffectiveProgressAt`、当前 stage、最近 action 类别、machine Diff delta、累计 usage/费用可用性和 `nextExpectedSignal`；watchdog 使用有效进展而非 Task 顶层更新时间。状态刷新与模型能力评分无关，不应把长思考直接算失败。

### FL-D84：Task 合同允许的交付会被独立 Integration 上限再次拒绝

- 状态：主 Codex 对已审查交付做了一次性配置放宽并安全合入，随后恢复原 Integration 默认值；产品尚无单次授权与自动联动。
- 证据：DeepSeek Task `03d30e6b-5d8e-4bd6-8a8a-57388493f573` 的机器验收为 6 files / 527 changed lines，低于合同 6/850 且 525/525 tests；第一次 Integration preflight 仍以全局 5 files / 400 lines 拒绝。主 Codex 读取当前设置后临时改为 6/600，第二次 preflight 保存 source digest 并通过，Integration 在真实源项目再次运行 focused/full tests 后 applied；随后立即恢复 5/400。
- 影响：用户和主 Agent 在提交时无法知道“能执行但不能合入”；同一变更面对两个互不关联的 hard gate。人工来回改全局设置会影响同时存在的其他 Task，也不能表达这是一次有审查证据、会过期的授权。
- 候选改进：Validate/Submit 同时预览 Task change budget 与当前 Integration budget；若后者更小，提交前明确拆分或申请一次性 `integration override receipt`。Receipt 记录授权者、精确 files/lines、patch digest、原因、过期时间与恢复策略，只作用于一个 Task；质量 Diff 可以按 profile 为 warn/score，安全、源 digest、补丁完整性和回滚能力仍为 hard。

### FL-D85：Store 迁移机器全绿后，主审仍发现“查不到”掩盖非规范查询

- 状态：DeepSeek 交付已安全合入，主 Codex 补齐查询规范化边界；真实工作树最终 68/68 focused、526/526 full tests。
- 证据：Attempt 1 usage 为 input `69,894`、output `23,034`、cache-read `1,698,560`，Claude runtime estimate USD `1.7746`，DeepSeek 官网重算 USD `0.05660075`；唯一机器失败是 `unknown` 未接住 canonical string 的 TypeScript narrowing error。Attempt 2 在精确反馈后以 input `11,681`、output `12,463`、cache-read `1,870,208`，runtime estimate USD `1.305084`、官网重算 USD `0.022703549` 完成 6 files / 527 lines、67/67 focused、525/525 full。主审随后发现 query 只检查 taskClass 长度，`" edit-task"` 会返回空而不是显式拒绝；profile 查询虽校验，但相同测试也没有覆盖。主 Codex 抽出 exact taskClass query normalizer、接住 exact profile 返回值，并为 list/latest 的空白、padding、超长、非 string 与不回显增加测试，最终 526/526。
- 影响：空结果与非法查询是不同产品状态；把二者混为一谈会让未来 selector 把配置错误显示成 `missing-calibration`，诱导用户注册重复基线。Task 顶层 succeeded 是 DeepSeek 的正向纠正样本，但不能抹掉首轮 compile failure 和主审 coverage gap；三者应分栏进入长期模型统计。
- 候选改进：为 exact identity 建立可复用的 producer/store/selector contract test matrix，覆盖 missing、padding、case、prefix、cross-profile、corrupt index 和 fixed non-echo errors。Main-review acceptance 与机器 verification 分开保存；模型选择按 taskClass、纠正率和样本量使用这些证据，不能因一次首轮失败永久禁用 DeepSeek。

### FL-D86：精确基线选择的失败来自合同漏面、硬门与主审缺口，不是单一模型失败

- 状态：MiniMax Task 保留 failed；主 Codex 已审查、纠正并把有效实现合入真实工作树，最终 62/62 focused、526/526 full tests。
- 证据：任务 `7755deda-7bae-4111-b07d-834d198f92ee` 的 Worker 完成 5 个文件并自报“well under 650 lines”，终态 usage 为 input `156,994`、output `61,040`、cache-read `8,062,117`、cache-creation `0`，Claude runtime estimate 为 USD `6.3420285`。MiniMax 官网精确费用因缺少逐请求 512K 分层 usage 继续为 `calculation:per-request-usage-required`，不能按 0 或用 runtime estimate 冒充。独立 build 随即发现 `tests/cli-exchange-receipts.test.ts` 是合同外的第 6 个 `TaskTokenReport` 类型消费者，旧夹具缺少成功 provenance 的 `profileId/version/sampleSize`；机器 Diff 为 5 files / `703` changed lines，超过 hard `650`，与 Worker 自报矛盾。
- 主审结论：核心的 exact-pair Store lookup、无 legacy fallback、显式 envelope 校验、隐私 provenance 和 economics one-snapshot 方向正确；但显式 publication 在缺失当前身份之前执行，把 missing 错报为 mismatch，malformed envelope 也被错报为 task-class mismatch。一个测试还把显式 envelope 的 sampleSize `4` 错期望成同 pair Store 行的 `11`，与“显式覆盖优先”相反。主 Codex 保持成功 provenance 类型为必填，没有为通过合同去弱化类型；补齐第 6 个消费者，调整 missing precedence，新增 `explicit-publication-invalid`，并修正夹具后全绿。
- 影响：顶层 failed 实际包含 `contract-scope-mismatch`、`policy-budget`、`fixture-semantics` 和 `main-review-correction`，不应记为 MiniMax Provider failure，也不能永久降低模型可用性。当前 failed Task 不能进入安全 preflight，主审只能绕到真实源码完成最小纠正，说明产品缺少“保留失败历史但签发主审纠正验收”的正式通道。
- 候选改进：Validate 在类型/调用图上预警所有编译消费者，并同时预览 Task 与 Integration 上限；运行中持续返回机器 `additions + deletions`，禁止 Worker claim 代替证据。文件/行数按 profile 支持 `hard | warn | score | off`，独立编译和安全不变量保持 hard。失败后允许主 Agent扩展 focus/budget 或提交 bounded main-correction patch，重新跑原 acceptance 并生成独立 correction receipt，而不是重跑完整模型或弱化类型。

### FL-D87：并发任务的全项目 `sourceUnchanged` 硬门会拒绝无冲突的正确交付

- 状态：MiniMax Task 保留 failed；主 Codex确认受影响路径未被占用，审查并合入两个新文件，真实工作树最终 568/568 tests。
- 证据：MiniMax 任务 `7d6d99ab-99fc-4cd7-9edc-45dd89ca83ca` Attempt 2 的 focused 46/46、全仓 549/549、2 files / 505 changed lines 全部通过；`verification.completed` 仍给出 `passed=false`，唯一否定证据是 `sourceUnchanged=false`。运行期间主 Codex合入的是并行 DeepSeek 任务的 review/Store 四个文件；MiniMax 只新增 `src/core/codex-terminal-usage.ts` 与对应测试，两个目标路径在真实源仓仍不存在，没有字节冲突。主审又补了 combined safe-integer gross overflow 后真实 focused 47/47、full 568/568。
- 影响：当前 `maxConcurrency=4` 可以并行执行，但任一安全集成都会让其他运行任务在终态被全局漂移硬拒绝，实际把并发退化为“只能并行算、不能并行收敛”。顶层 failed 会污染 MiniMax 能力统计，额外 resume 也无法解决确定性的旧快照比较。
- 候选改进：独立 verifier 与 Integration 使用同一 affected-path/source-digest 语义：只要补丁目标及其显式依赖未变化，无关用户或并行任务变更应记录为 `unrelated-source-drift` warning，而不是 hard failure。若依赖图不完整则进入可配置 rebase/reverify，不应把整个项目 byte-for-byte 不变作为并发任务硬条件。行为验证、source compatibility、policy evaluation 和 main-review acceptance 分栏保存。

### FL-D88：机器成功后缺少主审纠正通道，`resume` 会拒绝继续修正

- 状态：第一版窄范围 `forklight revise <task-id> --feedback <text>` 已合入并通过真实工作树 600/600 tests；更完整的 `awaiting-main-review / accept / revise` 生命周期仍待设计。
- 证据：publication 任务 `d5f649a6-3cda-45cb-9a31-f363c01a3b6d` 的 build、focused 和 full tests 全过后，主 Codex 发现参数访问器、既有 publication provenance、unsafe version 和重复 Store 读取等语义缺口；普通 `resume` 直接返回 `cannot resume from status succeeded`。MiniMax 任务 `92268363-da14-4daf-af89-6ab238db5f79` 随后实现 standalone、未集成、非 plan/competition Task 的显式 revise；DeepSeek correction `9d97f159-2d1d-4def-b147-15d11392ce56` 又补齐 typed receipt、持久化设置一致性和入队前非变异检查。
- 影响：只用机器 succeeded 作为最终态会迫使主审在新 Task/Session 中重建上下文，或手工改源码；把主审纠正混入普通 resume 又会弱化用户意图和 downstream 安全。
- 候选改进：把机器 verification、主审 acceptance 和 integration eligibility 拆成独立阶段；standalone Task 保留当前 revise，后续为 plan/competition 增加显式 accept/revise 与依赖失效规则。任何纠正都保留原 Attempt、费用和失败分类，不重写历史。

### FL-D89：主审反馈本身也可能错误，不能默认作为权威真相

- 状态：本轮由主 Codex重新读取规范源纠正自身反馈，最终实现和测试使用 canonical sample-id grammar。
- 证据：publication correction Attempt 3 中，主审曾错误要求 sample id 支持 128 字符及点/冒号；权威实现 `STRICT_TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/` 实际只允许 1–64 字符、字母数字下划线和连字符。Worker 按错误反馈修改后出现测试/夹具失败，不能归为 DeepSeek 能力失败。
- 影响：如果主审建议没有来源证据，系统会把正确 Worker 引向错误实现，再用失败率惩罚模型；长期模型统计会系统性偏差。
- 候选改进：主审纠正请求应附结构化 authority evidence（源码符号、schema、测试或官方文档引用）；Worker 对冲突要求可返回 bounded objection。统计增加 `main-feedback-invalid`，与模型行为失败、Provider 失败和策略失败分开。

### FL-D90：全绿实现被 27 行硬门拒绝，说明行数应是可配置策略而非通用成功定义

- 状态：MiniMax 第三轮以 8 files / 600 changed lines 成功；前两轮失败保留为 fixture/policy 证据，不计为永久模型禁用。
- 证据：任务 `92268363-da14-4daf-af89-6ab238db5f79` Attempt 1 为 8 files / 611 lines，两个失败都是 FK 与隐私事件范围夹具；Attempt 2 的 focused 78/78、full 581/581、`sourceUnchanged=true`，唯一失败是 `727 > 700`；Attempt 3 在不删安全场景的情况下压到 600 行并通过 focused 72/72、full 575/575。三个 Attempt 累计 gross Worker volume `32,433,152`，而 direct-Codex savings 仍是 `direct-baseline-missing`。
- 影响：硬门驱动了第三轮额外 Token 消耗和测试压缩；“行为全绿、仅超 27 行”如果记为普通模型失败，会误导模型选择。Worker 自报净增量也不能替代 verifier 的 additions + deletions。
- 候选改进：文件/行数按 profile 支持 `hard | warn | score | off`，默认把可维护性预算与安全门分开；运行中显示机器 `additions / deletions / changedLines / delta`。Verifier 输出 `behaviorPassed`、`policyPassed`、`sourceCompatible`、`mainReviewAccepted`，Console 不再只显示一个 failed。

### FL-D91：MiniMax 路由已正确匹配，但没有逐请求 usage 仍不能精确报价

- 状态：三个 MiniMax Attempt 都保存完整聚合 usage，官方费用保持 typed unavailable；没有用 runtime estimate 代替账单。
- 证据：任务显式使用 `minimax-china-direct-payg`，证明 Provider、endpoint、route、model 已正确解析；三个 Attempt 的 runtime estimates 分别为 USD `9.101766`、`6.37797`、`5.8678505`，但官网费用均为 `calculation:per-request-usage-required`。原因是 MiniMax 512K 阶梯按单请求输入选择，terminal 只提供累计 input/output/cache-read，不能恢复每次请求所在档位。
- 影响：路由可用不等于费用可算；把聚合量套一个平均档位或把 Claude runtime estimate 当 MiniMax 账单都会制造假精度。
- 候选改进：运行时持久化逐请求 usage rows 并与 terminal aggregate 精确 reconciliation；未满足前，UI 显示官网原币费用 unavailable、缺失证据和可选假设范围，不显示 0，也不参与硬性成本排名。

### FL-D92：MCP 的可选预算字段把“不限预算”错误变成非法值

- 状态：本轮通过 YAML/CLI 提交绕过；MCP schema/adapter 尚未修复。
- 证据：有效设置明确为 `execution.defaultMaxBudgetUsd = null`，但调用 `forklight_validate` 时省略 schema 中可选的 `maxBudgetUsd`，返回 `task.runtime.maxBudgetUsd must be a positive number`；同一合同写入任务文件并显式 `runtime.maxBudgetUsd: null` 后以 100/100 通过并正常执行 DeepSeek。
- 影响：CLI 和 MCP 对同一有效配置不等价；主 Codex 无法通过 MCP 表达用户已确认的 unlimited，而可能被迫填写任意正数，破坏预算语义。
- 候选改进：MCP 明确接受 `number | null`，省略时继承 effective default，绝不能变成 0；Validate 返回解析后的 budget source（explicit-null、explicit-finite、inherited-null、inherited-finite）和是否生成 runtime flag。

### FL-D93：开发态 CLI 能停止 daemon，却无法从源码目录重新启动

- 状态：发布构建入口已恢复 daemon 与 Console；开发态自托管启动缺陷仍待修复。
- 证据：`npm run dev -- daemon stop` 正常停止 PID `66611`；随后 `npm run dev -- daemon start` 失败为 socket ENOENT，因为源码 CLI 的 `startDaemonProcess` 从 `src/daemon/client.ts` 所在目录寻找 `main.js`，实际只有 `main.ts`。改用已构建的 `dist/src/cli.js daemon start` 成功启动 PID `49884`，Console 在 `127.0.0.1:64788` 重新激活。
- 影响：开发者最常用的自托管路径无法完成 stop/start 闭环，容易被误诊为 daemon 或 Provider 故障；也使 runtime activation 验收依赖人工知道 dist 入口。
- 候选改进：开发态显式 spawn 当前 TS runtime/入口，发布态使用 dist；daemon status 暴露 source/build/runtime identity 与入口路径，并增加真实 `dev stop -> start -> health` 回归测试。

### FL-D94：父 Task 加纠正 Task 后没有 lineage-aware 的一次性安全集成

- 状态：本轮由主 Codex逐文件核对 baseline、组合 MiniMax 主体、DeepSeek correction 与 publication Store 增量，最终真实工作树 focused 116/116、full 600/600；产品化 lineage integration 仍缺失。
- 证据：MiniMax 父 Task 的 result.diff 不包含 DeepSeek 子纠正；DeepSeek 子 Task 的 source 又是父工作区，Integration 目标不是原项目。两者组合相对原项目扩展到 10 个文件，并与已合入 publication 的 `src/state/store.ts` 有无冲突增量。手工把标准 diff 转为上下文补丁时，重复测试上下文曾把 `tests/daemon.test.ts` hunk 放错位置；逐字 compare 发现后，主 Codex用已验收最终文件恢复并重新跑完整测试。
- 影响：多模型“实现 -> 主审 -> 纠正”已经可运行，但最终集成仍容易退化为高风险人工拼补丁；父/子 Task 的 limits、source digests、验收和费用也无法汇总成一个可审计交付。
- 候选改进：引入 correction lineage receipt：记录 parent Task、correction Task、combined affected files、三方 base digest、语义冲突和最终 patch digest；只允许三方安全 merge 或明确逐文件决议，禁止模糊上下文套用。组合后必须在原项目重新执行 acceptance，并把 activation receipt 与 lineage 一起保存。

### FL-D95：Direct Codex 审核与发布工作流已进入 Daemon 边界

- 状态：主 Codex 已审查、最小纠正并合入真实源码；focused 107/107、全仓 617/617，真实 daemon 已从新构建产物重启。
- 证据：Task `a0bd773c-fb10-4883-a9ac-64a17c8d1411` 最终交付 7 files / 784 changed lines。Daemon 现在可调用 count-only sample capture、exact `taskClass + directCodexProfileId` inbox、显式不可变 review、publication preview 和 confirm-true registration；所有写入沿用既有 Store、terminal adapter、review normalizer 与 publication service，不复制 Token 算术。Inbox 数组与 item 深冻结，corrupt evidence fail closed，错误不回显 payload，重复 sample identity 被映射为固定错误。
- 影响：核心校准链第一次可以由主 Codex 通过稳定本地服务调用，而不必直接 import 内部模块；但 CLI、MCP 和 Console 仍未提供同等入口，所以还不能称为用户可操作闭环。
- 候选改进：下一层只做 adapter，不再复制业务语义；CLI/MCP 使用可审计 count-only receipt，Console 写操作走独立认证控制边界，review 与 registration 继续要求显式确认。

### FL-D96：同一任务的三次结果分别属于 fixture、成功纠正与 API 细节错误

- 状态：不把顶层 `failed` 直接计为 DeepSeek 永久负样本；保留三轮独立证据。
- 证据：Attempt 1 为 102/116 focused，13 个失败来自样本夹具 class/profile 未匹配，另一个来自重复 sampleId；同时 894 > 850 属于 hard policy，官网费用 USD `0.070421338`。Attempt 2 修正后两套验收通过，官网费用 USD `0.04711108`。Attempt 3 为 106/107，只错在把 Node `node:sqlite` 唯一约束错误码猜成 `SQLITE_CONSTRAINT*`；实际为 `code=ERR_SQLITE_ERROR`，主键 `errcode=1555`、普通 UNIQUE `errcode=2067`，官网费用 USD `0.031990132`。三轮官网费用合计 USD `0.14952255`；Claude runtime estimates 合计 USD `5.968565`，继续分栏而不当作 Provider 账单。
- 影响：一个顶层失败同时包含 test-fixture、policy、correction-success、implementation-detail 和 main-review correction；简单失败率会误导模型路由。DeepSeek 能识别并纠正大部分边界，但会对陌生运行时细节产生具体而错误的自信假设。
- 候选改进：Attempt 统计保存 `fixture-semantics`、`policy-budget`、`behavior-verification`、`main-review-correction`、`runtime-api-detail` 与 correction outcome；模型选择以同类任务、样本量和纠正率作为可配置 score，安全与独立验证保持 hard gate。

### FL-D97：`wait --until change` 没有观察事件流，活跃 Worker 会被显示成超时

- 状态：通过反复 inspect 旁路观察；监督语义尚未修复。
- 证据：Worker 在 12:47-13:01 持续写文件并产生 event sequence 51-196，但 `wait --until change` 的 30 秒窗口多次返回 timeout，因为它只比较 Task `updatedAt`；事件插入不会更新该字段。进程和事件均正常，用户界面却容易理解为卡住。
- 影响：长程任务的“有进展、正在思考、真正停滞”无法可靠区分，主线程被迫频繁 inspect，增加轮询和上下文开销。
- 候选改进：change cursor 应由 `task.updatedAt + latestEventSequence + attempt status/stage` 组成；wait 返回最后有效动作、距今时间和 typed `active | quiet | stalled`，Console 使用同一读模型而不是自行猜测。

### FL-D98：最大 Attempt 后的主审最小修正无法签发正式成功证据

- 状态：主 Codex 已在 Task workspace 修正唯一错误并重新运行原始验收，随后逐字节安全合入；ForkLight Task 历史仍正确保留为 failed，但缺少最终 acceptance receipt。
- 证据：Attempt 3 用尽 `maxAttempts=3` 后，主 Codex只将 UNIQUE 识别改为 `ERR_SQLITE_ERROR + 1555/2067`，同一 workspace 随即 focused 107/107、full 617/617；真实项目合入后再次 617/617。现有 Task 不能附加“main corrected + verifier passed”终态，`result.diff` 也不包含这次最终修正。
- 影响：为了不伪造 Worker 成功，历史必须保留 failed；但 Console 和统计也无法表达“Worker failed、主审已修正、交付已验收并激活”。这会丢失真实交付质量并迫使人工集成绕开标准 preflight。
- 候选改进：提供一次性 `main-correction` receipt：绑定失败 Task、base/workspace/final patch digest、修正者、变更范围和重新验收结果；不改写历史 Attempt，只新增 `mainReviewAcceptance` 与可安全 Integration 的最终候选。

### FL-D99：Integration 前台超时不等于后台失败

- 状态：本次 Integration 最终成功并通过真实源码 621/621 tests；首次 CLI 调用仅因前台 daemon request 十秒超时返回错误。
- 证据：Task `fe894ff7-b86c-4b1b-a945-7058b4de1684` 的 `integration apply` 返回 `ForkLight daemon request timed out`，但随后 `integration history` 已持久化 `status=applied`，两条验收命令均 exit 0，四个源文件与 Worker 最终版逐字节一致。
- 影响：用户会合理地把超时解读为失败并重复 apply，而 receipt 已消费且源码已变；这会制造不必要的错误和安全焦虑。
- 候选改进：长操作立即返回 operation id，通过 `queued | applying | verifying | applied | rolled-back | retained-failure` 查询或 wait；CLI 超时应返回 `outcome-unknown` 和查询命令，不得冒充确定失败。

### FL-D100：安全合入验证了隔离副本，却没有激活真实运行产物

- 状态：已通过真实源码根目录显式 `npm run build` 恢复，新 `direct-codex` CLI 命令已可调用；产品级 activation stage 仍缺失。
- 证据：Integration 历史显示 `npm run build` 通过，但真实 `src/cli.ts` 为 13:23 新版，`dist/src/cli.js` 仍是 13:06 且不含 `direct-codex`；因为验收在 copy-for-verification 目录执行，其构建产物随临时副本被删除。真实源码 build 后两个只读 CLI 请求立即正常。
- 影响：`applied + build passed` 不能证明 daemon/CLI/Console 正在运行新代码；用户看到的是假的激活成功。
- 候选改进：Task Contract 拆出可配置 `activationCommands` 与 `activationChecks`；只在验收成功后对真实源执行，保存 source/artifact/executable digest、cwd、PID 和健康证据，失败时与源码 rollback 策略分开配置。

### FL-D101：第一个真实 exact-pair 证明了主线程 Token 节约闭环

- 状态：样本 `dc-cli-20260723-001` 已由主 Codex 显式验收、accepted 并注册为 `token-calibration-cli-adapter + codex-gpt-5.6-sol-xhigh-v1` 的 v1 low-confidence publication。
- 证据：Direct Codex 在同一基线副本执行同一合同，原生 `turn.completed` 为 input `4,153,290`、cached input `3,951,104`、cache write `0`、output `30,636`、reasoning subset `15,825`，规范化 gross direct baseline `4,183,926`。Direct 实现在正常权限下通过 66/66 focused、619/619 full，4 files / 655 changed lines。同类 MiniMax ForkLight Task 为 1 Attempt、4 files / 668 diff lines、真实源码 621/621。
- 结果：ForkLight 对该 Task 的主线程 exchange 估算为 `20,611-125,139`，direct main-thread savings 为 `4,058,787-4,163,315` Tokens，即 `97.01%-99.51%`，confidence low。这是 direct counterfactual 减 exchange，不是 Worker 用量或成本节约。
- 费用：MiniMax Worker gross `1,268,566` Tokens，Claude runtime estimate USD `1.67173`；官方 MiniMax 费用仍为 `calculation:per-request-usage-required`，因为缺少逐请求 512K 分层 usage，不得显示 0 或用 runtime estimate 代替。
- 影响：Token 节约从理论路径变成可追溯的真实数据；但单样本不能用于跨类型或永久的模型选择结论。下一步需要 small-fix、standard-feature、refactor 多样本，并保留负 savings。

### FL-D102：Direct Codex 沙箱的 listen 失败不应记为模型行为失败

- 状态：主 Codex 在正常权限 verifier 环境复跑后全绿；Direct 沙箱内失败保留为 environment-policy 证据。
- 证据：Direct Codex workspace-write 沙箱中，focused 为 39/66，27 个失败与 27 个 Unix socket `listen EPERM/EINVAL` 一一对应；full 为 533/620，86 个 listen 失败及 1 个同源 aggregate failure。把 TMPDIR 改到 workspace 也无效，说明禁止的是 listen 能力，不是路径。主 verifier 随后 66/66 和 619/619。
- 影响：如果只看顶层 fail count，会把正确实现误判为模型失败；这与 Provider 故障、行为错误、策略超限和主审拒绝都不同。
- 候选改进：Verifier 保存 `capability-denied` 分类与重跑环境证据；模型统计不扣分，调度器只用它来选择需要 listen/browser/network 的执行 runtime。

### FL-D103：Resume 反馈没有同时呈现全部机器拒绝维度，Worker 连续追逐局部失败

- 状态：MCP parent Task 三轮结束后由主 Codex识别；当前 Task 历史保持 failed，产品级 remediation packet 尚未实现。
- 证据：Task `f5b750b3-d9f9-4f7e-8ff7-09b5bae159cb` Attempt 1 先遇到测试夹具编译失败和 `993 > 850`；Attempt 2 修复编译后只剩两个错误断言，但仍是 `992 > 850`；Attempt 3 继续追逐断言，最终为 92/93 且 `991 > 850`。三轮每次都获得局部验收反馈，却没有把 behavior、policy、source compatibility 与主审语义放在同一张纠正清单中。
- 影响：Worker 会合理地优先修当前命令失败，同时重复忽略另一个必然拒绝条件，消耗额外 Attempt、Token 和费用。顶层 failed 也无法告诉用户它不是 Provider 故障。
- 候选改进：Resume 前生成一次结构化 remediation packet，至少同时列出 `behaviorFailures`、`policyFailures`、`sourceCompatibility`、`mainReviewFindings` 和 `requiredOutcome`；后续 Attempt 必须逐项回报 resolved / unresolved，而不是只消费最后一条 stderr。

### FL-D104：错误测试会诱导 Worker 破坏 canonical authority，测试通过不能替代主审

- 状态：主 Codex拒绝不安全语义并通过 lineage correction 恢复；未进入真实源码。
- 证据：parent Attempt 2 的错误测试要求 duplicate capture 失败后仍在请求声明的 Task 下生成 error receipt。Attempt 3 为满足测试，把归属从 daemon 成功返回的 `sample.forklightTaskId` 改成请求里的 `metadata.forklightTaskId`；这允许尚未形成 canonical sample 的失败请求向调用者声称的 Task 写收据。主审坚持成功闭包归属，纠正任务恢复为“daemon 返回 canonical sample 后才设置 Task id”，失败捕获保持 unattributed。
- 影响：机器测试可能与安全边界冲突；若只以绿灯自动合并，Worker 会被坏夹具推动成越权实现，且错误可能被记作模型服从能力良好。
- 候选改进：安全测试需要 authority reference（daemon return、schema、Store invariant）；主审报告可签发 `test-invalid`，触发修测试而不是修生产语义。自动合并必须同时满足 verifier 与独立主审，不把测试当唯一权威。

### FL-D105：纠正链的单跳 churn 与最终交付 diff 是两种不同策略证据

- 状态：主 Codex按 authoritative base 重新计算并安全合入；产品尚无 lineage-aware Integration receipt。
- 证据：correction Task `05c342a1-71fb-4d8c-a206-aabf46573d3a` 以 parent workspace 为 source，删除并重写重复测试后，自己的过程 diff 为 `827 > 450`，所以 Task 保持 failed；但 original parent baseline 到最终 candidate 仅 5 files / 602 changed lines，符合原合同 5/850，且 focused 89/89、full 631/631。真实仓库四个既有文件先与 parent baseline 逐字一致，再逐文件合入并复验 631/631。
- 影响：把 per-hop churn 当最终 hard success 会拒绝本来更小、更清晰的交付；反过来只看最终净 diff 又会隐藏纠正过程的高重写风险。
- 候选改进：同时保存 `hopChurn` 与 `combinedDeliveryDiff(authoritativeBase -> acceptedCandidate)`。默认以后者作为交付 hard gate，前者作为可配置 `warn | score | off`；安全、验证和源兼容仍独立 hard。Integration receipt 绑定 parent/correction/final 三方 digest。

### FL-D106：压缩夹具时出现语义回归，但 DeepSeek 能根据 verifier 证据纠正

- 状态：correction Attempt 2 已修复并通过全部行为验收，不作为永久模型禁用证据。
- 证据：Attempt 1 为压缩测试 helper，把默认 `directRunRef` 从 canonical `codex-run:` 写成 `run:`，导致 6 个真实 daemon 测试失败；Attempt 2 根据独立 verifier 恢复正确前缀后 focused 89/89、full 631/631。parent 三轮 gross Worker Tokens 为 `3,501,057`，correction 两轮为 `3,011,773`，整条链共 `6,512,830`；该 exact task class/profile 没有 direct-Codex baseline，所以 saved Tokens 仍为 unavailable。官网 DeepSeek 费用合计 USD `0.168205829`，Claude runtime estimate 单列为 USD `6.017514`。
- 影响：这是明确的 implementation/fixture semantic regression 和随后成功纠正，不应与 Provider、policy 或主审失败合并成一个失败率。高 Worker Token 也不能直接称为主线程节约。
- 候选改进：能力统计记录 `semantic-regression -> verifier-corrected`，同时保留样本量、Attempt 数和任务类型；模型路由按纠正率与同类任务证据评分，绝不因一次 aggregate failed 永久排除模型。

### FL-D107：`stop_reason: error` 被 `is_error: false` 和 exit 0 覆盖成成功

- 状态：产品逻辑、稳定诊断和真实形态回归测试已修复；新 daemon 已激活。
- 证据：MiniMax-M3 Task `490edb79-a62c-4330-8fd3-7bbe286cc94a` 的真实终态同时包含 `subtype=success`、`is_error=false`、`stop_reason=error`、空 `result` 和进程 exit 0。旧 normalizer 只看 `is_error`，因此写入 `worker.completed`；Worker 层又让空字符串压过诊断。新逻辑把明确 error stop reason 或 error subtype 设为 hard runtime failure，仍保留 usage/cost，并用固定非内容诊断兜底。
- 影响：Provider/runtime 明确失败会被伪装成 Worker 成功，后续 verifier、竞争和统计全部建立在错误终态上；空诊断又让用户无法理解失败。
- 候选改进：终态信号优先级应成为可测试的 runtime invariant，而不是模型策略：显式 error reason/subtype > `is_error` > process exit > missing terminal。新增 Provider 形态只能扩展标准化映射，不能按模型永久特判。

### FL-D108：零 Diff 通过旧测试后反而因 diff-focus 赢得竞争

- 状态：editable no-change 已实现 `hard | warn | score | off`，默认 hard；历史零 Diff 可用当前策略预览正确淘汰。
- 证据：同一 MiniMax candidate 没有修改任何文件，却因原项目验收本来就全绿而保存为 verified，旧竞争评估又给 `diffFocus=1` 满分并推荐它。新代码中 hard 直接使其 ineligible；warn 只告警；score 才使用可配置 delivery 权重；off 不影响排名。旧记录缺 completion evidence 时，editable + 0 files/0 lines 回退 hard。对 competition `413915fc-2fa8-472b-8e15-0f2cc7ff0796` 的新策略预览已改为 DeepSeek 唯一推荐。
- 影响：测试通过证明“当前 workspace 可运行”，不能证明 Worker 交付了任务要求；更小 Diff 也不能把零交付奖励为最佳实现。
- 候选改进：Verifier 长期应同时保存 `behaviorPassed`、`deliveryEvidence`、`policyEffect` 与 `mainReviewAccepted`。交付策略按 Task 创建时冻结且允许 task-level override；安全、runtime error 和独立验证不被它放松。

### FL-D109：合同按 11 个文件估算，但真实调用链需要 16 个文件

- 状态：Worker Task 保持 failed；主 Codex 扩展审查范围后手工合入并在真实源码验证 666/666。
- 证据：Task `854530d6-a67e-46a7-8052-4a5f5d458b41` 合同为 11 files / 1100 changed lines；最终被接受的完整实现覆盖 Settings、Task snapshot、Verifier、Competition、Normalizer、Worker error path、CLI/MCP/Daemon wiring 和测试，共 16 files / 1228 changed lines。Worker 自己在三轮中到达 15 files / 1077 lines，主审补齐 Worker failure helper、task override、legacy policy 与 off-mode 边界后扩大了最终交付。
- 影响：只按“核心模块”估算会漏掉生产消费者、适配层和兼容测试；硬预算随后把范围估算错误记成模型失败，或诱导 Worker 删除必要覆盖。
- 候选改进：提交前从生产者/消费者/入口/持久化/测试调用链生成 impact forecast，显示 expected 与 discovered surface。发现新消费者时暂停并请求 scope amendment；原合同与主审扩展分别留证，不能静默改写 hard gate。

### FL-D110：并行 dogfood 的无关合入触发全局 `sourceUnchanged=false`

- 状态：本轮通过逐文件 baseline identity 检查安全合入；全局 source fingerprint 仍需产品化修正。
- 证据：Outcome-policy Worker 运行期间，主 Codex安全合入了 Console auth 的五个文件。两组生产文件没有重叠，但 Task 的全项目 fingerprint 因外部变化变为 false，后续 verifier 必然拒绝；这重复了此前并行任务的同类假失败。
- 影响：并发度设置为 4，却用全项目不变作为成功硬门，等于让无关任务互相制造失败；失败率、Token 与费用统计都会被调度器自身污染。
- 候选改进：保留原始全局 snapshot 作为审计，真正的兼容 hard gate改为 affected paths + dependency closure 的三方 digest；无重叠变化记录 warning，有语义依赖或同文件变化才暂停合并。

### FL-D111：`wait --until change` 再次把有事件的 Worker 显示成 timeout

- 状态：通过 inspect 旁路监督；这是 FL-D97 的重复证据，尚未修复。
- 证据：DeepSeek 三轮执行时 Worker event sequence 持续增长，但 Task `updatedAt` 在阶段内不变，`wait --until change` 因只比较 Task timestamp 而超时。主线程不得不读取更大的 inspect 结果确认进度。
- 影响：用户会把正常执行误解为卡死；主 Codex增加轮询与 exchange Token，反而侵蚀 ForkLight 的主线程节约。
- 候选改进：统一 progress cursor 为 `task.updatedAt + latestEventSequence + attempt/status/stage`，返回 `active | quiet | stalled`、最后有效动作与距今时间；CLI、MCP、Console 共享同一紧凑读模型。

### FL-D112：正常词 `unknown` 再次触发占位符 hard gate

- 状态：合同改用 `unrecognized` 才通过；这是 FL-D70 的重复证据，验证器语义仍未修复。
- 证据：任务合同描述“unknown completion evidence”这一正常兼容场景时，quality gate 仅因字符串 `unknown` 拒绝 100/100 结构化合同。改写同义词后结构完全不变即通过。
- 影响：语言启发式伪装成结构 hard gate，迫使主 Agent增加改写和合同 Token，并会系统性误报错误处理、兼容性和多语言任务。
- 候选改进：只对空字段、明确模板 sentinel 和未替换变量做 hard fail；自然语言词命中最多是 warning，并提供具体字段位置与 task-level acknowledgment。

### FL-D113：Integration 前台十秒超时再次与后台成功冲突

- 状态：Console auth Integration 已由 durable history 证明 applied；这是 FL-D99 的重复证据，异步 operation receipt 仍未实现。
- 证据：receipt `31879544-6745-4b81-bf88-16653f3da06b` apply 的 CLI 前台超时，但 daemon 后台继续验证并保存 result `68c1de10-e3c7-45d7-82cd-46e8b611c2f4`，状态为 applied，focused 70/70、full 637/637。
- 影响：用户可能重复 apply 已消费 receipt，或把成功合入误判为失败；这是控制面表达错误，不是 Integration 行为失败。
- 候选改进：apply 立即返回 operation id，单独 wait/status；同步超时必须返回 `outcome-unknown` 与查询入口。Console 展示 queued/applying/verifying/applied/rolled-back/retained-failure，并把 activation 作为下一阶段。

### FL-D114：历史 Competition 默认展示旧推荐，当前策略预览才显示正确结果

- 状态：新任务会使用新逻辑；历史 stored evaluation 保持不可变，但 UI/CLI 尚未清楚区分历史决定与当前策略预览。
- 证据：重启新 daemon 后，不带 override 的 `competition compare 413915fc-...` 仍返回 08:09 保存的 evaluation `37d153b4-...`，继续推荐零 Diff MiniMax；显式空 weights 触发当前代码的 ephemeral preview `c85e649d-...` 后，MiniMax 以 legacy hard fallback 淘汰，DeepSeek 成为唯一推荐。
- 影响：保存历史证据是正确的，但把它标成当前 compare 结果会让用户误以为新策略没有生效，也会让 Console继续显示已经过时的选择。
- 候选改进：响应同时返回 `storedDecision` 与 `currentPolicyPreview`，显示 evaluation 时间、policy/schema 版本和 stale 原因；只有显式确认才持久化 re-evaluation，且永不覆盖旧记录。

### FL-D115：Console 的 Provider 成功率仍把不同失败原因压成一个数字

- 状态：页面已真实验收；分类统计尚未实现，当前百分比只能作为原始 Task 终态计数。
- 证据：重启后的 Console Stats 显示 DeepSeek Pro `23%`、DeepSeek Pro[1M] `62%`、MiniMax M3 `42%` success，但同一批历史已明确包含 fixture 错误、Diff policy、全局 source fingerprint、沙箱 capability、Provider stream、主审纠正和真实实现错误。Task `854530d6-...` 顶层为 failed，但最终经主审修正后 666/666；Task `490edb79-...` 顶层仍是 succeeded，但实际为 error terminal + 零交付。
- 影响：用户看到“失败率高”会自然判断模型能力差，而当前统计同时包含 ForkLight 限制、合同估算、验收夹具和历史分类 bug；模型路由若直接消费该比例会形成错误的负反馈。
- 候选改进：Provider/Model 面板先显示 outcome taxonomy 和样本量，再显示 raw terminal rate；至少拆分 `behavior`、`provider/runtime`、`environment/capability`、`fixture/verifier-contract`、`policy`、`source-compatibility`、`main-review` 与 `correction-success`。只有同任务类型、同分类、带时间衰减的行为证据进入柔性模型评分，任何 aggregate rate 都不得成为永久禁用 hard gate。

## 2026-07-23 主线程成本与总成本：本地账本审计摘要

用途：根据本机 `~/Library/Application Support/ForkLight/forklight.sqlite` 只读汇总（审计时约 94 tasks / 176 attempts），写清「现在省没省」和「下一步优先改什么」。本节是观察与方向，不是已批准的产品合同。

### 结论（先看这里）

1. **主线程：整体在变便宜，方向正确。** 实现侧大量读改、试错、cache 循环留在隔离 Worker，没有整坨回流主 Codex。ForkLight 作为「主脑卸载层」是成立的。
2. **总成本：还不能说一定省。** 便宜模型单价有优势，但失败多、常 2～3 轮重试，大约六成 runtime 估算费用花在最终失败的任务上，把单价红利吃掉了。
3. **当前最大漏洞不是「模型还不够便宜」，而是两件事：**
   - 编排侧对主线程不友好：`inspect` 轮询过多，`wait --until change` 不可靠时被迫 inspect（与 FL-D97 / FL-D111 一致）；
   - 一次做对的概率低：首轮 attempt 成功率约 17%，任务终态成功率约 38%，失败与近失 budget 在烧钱。

一句话：**主脑可以更轻；总账要稳赢，必须少失败、少重试、少 inspect。**

### 账本要点（口径说明）

- **Official quote（官价）**：审计时合计约 **$1.67**，但只覆盖约 **36/176** attempts（几乎全是 `deepseek-v4-pro[1M]`）。**不能当成全站真实 Provider 账单。**
- **Claude runtime estimate（`costUsd` / runtimeCostEstimateUsd）**：约 **$307**，覆盖约 **163/176** attempts。这不是账单，但是看「失败浪费 / 多轮溢价」最完整的尺子；**禁止与官价混加或互相替代。**
- **有官价子集**：36 次 attempt 上 runtime 估约 **$67**，官价约 **$1.67**，runtime 大约是官价的 **40 倍**——再次证明 runtime 只能当运行时估算。
- **Worker token 毛量**（66 次 complete usage）：gross 约 **2.58 亿**，其中绝大部分是 **cacheRead**。说明 Worker 侧上下文循环很重；主线程若自己做会更惨，但 Worker 账单仍取决于 cache 单价与 attempt 次数。
- **任务终态**：succeeded 36 / failed 52 / interrupted 6。成功任务里一次过约 16 个、多轮才成功约 20 个；多轮成功的 runtime 均价大约是一次过的 **3 倍**。
- **失败任务 error 粗分**：独立验收失败约 29；`Claude Code exited without a result event` 约 19；其余含 superseded、鉴权等。验收失败里命令失败、changeBudget 超标、并行导致的 `sourceUnchanged=false` 都显著；存在「测试命令已绿但 budget 硬挂」的白烧（与 FL-D109 / 近失预算观察一致）。
- **主线程 exchange receipts**：约 562 条 count-only 收据。其中 **`forklight_inspect` 约占一半以上次数与体积**；有轮询记录的任务平均 inspect 约 12 次、最高约 47 次。注意：receipt 是脱敏计数，**低估**主会话真实对话 token；若 inspect 还把大段 events/diff 贴进主线程，实际更贵。
- **vs 直接 Codex**：仅有 1 个 taskClass 的 publication / paired sample（约 **418 万** gross tokens 的 direct 基线）。**绝大多数任务仍无法声称「比 Codex 省了 X%」**（direct-Codex savings 仍多为 baseline missing）。
- **Provider 原始成功率（终态计数，未做失败分类）**：`deepseek-v4-pro[1M]` 明显高于旧 `deepseek-v4-pro`；MiniMax runtime 与 token 毛量偏高且 official 常 unavailable。该比例混杂 policy / fingerprint / runtime / 真实现失败，**不能直接当模型永久排名**（见 FL-D115）。

### 优化方向（优先级）

**P0 — 保主线程便宜（最高优先级）**

1. **默认监督路径改为 `wait`，禁止 tight-loop `inspect`。** 运行中只用 wait/status；终态后最多一次 summary inspect。与 FL-D111 一起修 progress cursor，否则主线程会继续用 inspect 旁路。
2. **`inspect` 默认 summary**：status + 末 attempt + 失败命令尾部 + 文件/行数；不全量 events、不全量 raw log。diff 先截断，全文按需二次拉取。
3. **编排协议固定步数**：`submit → wait(terminal) → inspect(summary) → preflight/apply`；失败后有限 resume/revise，禁止成功后再反复 inspect history。
4. **回灌主线程的 verifier 输出要再压缩**：Worker resume 可用较长证据；主会话只保留 exit code、命令名、断言摘要、一句建议。

**P1 — 让总成本真的省（降失败与白烧）**

5. **专治「命令已绿 + changeBudget 红」**：soft/hard 分档，或自动压缩 revise，避免测过了仍记失败并烧满多轮。
6. **专治「exited without a result event」**：可恢复则同 session 自动 resume 一次；计入 runtime 健康而非静默浪费。
7. **提高首轮成功率**：合同更小更准、acceptance 先窄后宽、失败反馈结构化；无进展时提前停，不必默认烧满 maxAttempts。
8. **默认路由与预算硬顶**：交付默认偏向 `deepseek-v4-pro[1M]` 一类更稳路径；MiniMax 不宜无预算地当默认交付。每 attempt / 每 task 设有限 `maxBudgetUsd` 与 attempt 上限，超顶交回主线程。
9. **强制 official pricing 身份完整**：缺 route 导致 quote unavailable 的 Provider，生产 profile 应警告或阻断，否则总成本不可治理。
10. **修并行 `sourceUnchanged` 假失败**（FL-D110）：兼容门改为 affected paths + 依赖闭包，避免并发 dogfood 互相制造失败、污染费用统计。

**P2 — 能证明「比 Codex 省」并持续控本**

11. **补齐 direct-Codex 校准样本**（按 taskClass + profile），否则只报告 boundary reduction，不宣称 vs-Codex 节省。
12. **经济学面板**：并列展示主线程 exchange、Worker official、失败浪费率、inspect 次数；失败 taxonomy 后再谈模型评分（FL-D115）。
13. **中期工程**：workspace 准备成本、source lock / 串行同项目，降低假失败与磁盘浪费。

### 建议的「节约是否成立」判据

在产品策略上应用硬约束，而不是事后叙事：

- 主线程：每任务 MCP 往返有上限；inspect 全文 ≤ 1；wait 替代轮询。
- 单 attempt / 单 task 有限美元与 attempt 上限。
- 无 taskClass 校准则不声称 direct-Codex 节省。
- 失败率与费用统计必须先 taxonomy，再进入模型路由。

经验式：

```text
主线程省 ≈ 卸载成功 − inspect 滥用 − 大 diff/日志回灌
总成本省 ≈ 便宜实现 × 一次成功率 − 失败多轮 − 无 result 空转
```

当前数据下：**前半项大体成立；后半项尚未稳住。**

### 建议的下一步（若另开修复合同）

优先顺序建议：

1. 主线程协议 + inspect summary + 可靠 wait（P0，直接服务「主线程最便宜」）。
2. 无 result 恢复 + budget 近失路径 + source fingerprint 兼容门（P1，直接砍失败浪费）。
3. official quote 覆盖与 economics CLI/Console（可测、可回归）。
4. direct-Codex 校准扩样（证明 vs Codex，而非只感觉省了）。

### 关联条目

- 主线程轮询与 wait 不可靠：FL-D97、FL-D111  
- 并行 source fingerprint 假失败：FL-D110  
- 成功率被未分类失败污染：FL-D115  
- 合同/预算估算导致假失败或近失：FL-D109 等  


## 2026-07-23 Dogfood 全量归类与综合优化计划

用途：在**通读 FL-D01–FL-D115 + 自举交付表 + 本地账本审计**之后，做全量问题地图与综合施工计划。  
原则：先总结再排期，不把「主线程相关」误当成「dogfood 的全部」；状态为基于 log 文案的**观察对账**（非逐条跑回归后的正式 QA 报告）。

### 0. 文档范围

| 来源 | 内容 |
|------|------|
| FL-D01–FL-D07 | 2026-07-22 初始观察 |
| FL-D08–FL-D115 | 用户反馈 + 自举 dogfood 摩擦与修复线索 |
| 2026-07-23 自举第一轮表 | 任务级交付与模型观察 |
| 主线程/总成本账本审计 | 本机 SQLite 量化（94 tasks / 176 attempts） |

**条目数**：115 条编号观察 + 若干横截面结论。  
**状态标签**（本节统一）：

- **OPEN**：产品仍缺，log 标明未修或再次复现  
- **PARTIAL**：核心/部分路径已合入，消费者、策略或 UX 未闭环  
- **FIXED-ish**：log 写明已修/已合入（可能仍有旁支）  
- **PRODUCT**：产品方向/规格，未必是当前缺陷  
- **RECURRING**：同一根因多编号重复（以最新编号为主跟踪）

---

### 1. 横切结论（读完 115 条后）

1. **ForkLight 的价值命题成立但未锁死**：能把实现卸载到隔离 Worker，主线程可更轻；但失败多轮、假失败、轮询 inspect、硬门误杀会把「便宜模型」变成「总账不省」。  
2. **最大结构性问题是「单一终态 / 单一失败率」**：几乎所有主题最后都要求把结果拆成  
   `behavior | policy | source-compat | provider/runtime | fixture | main-review | cancel | environment`  
   否则模型路由、Console Stats、费用解读全部失真（FL-D52/53/96/106/115 等）。  
3. **第二结构性问题是「门的语义混用」**：安全不变量、机器验收、Diff 预算、Integration 上限被同一套 hard fail 表达；估错范围会诱导压缩正确设计（FL-D43/44/54/58/90）。需要 `hard | warn | score | off` + profile。  
4. **第三结构性问题是「控制面与运行面不同步」**：source / dist / daemon / MCP / CLI 可四分叉；Integration 绿 ≠ 激活（FL-D34/35/50/61/69/79/100）；前台超时 ≠ 后台失败（FL-D99/113）。  
5. **第四结构性问题是「进展不可见」**：`running` + 不更新的 `updatedAt` + 只看 status 的 wait → 主线程 inspect 税（FL-D15/51/57/68/83/97/111）。  
6. **第五结构性问题是「Worker 信息闭塞」**：无 shell、无实时机器 Diff、无阶段预算 → 盲目读与压缩行数（FL-D26–29/55/62/78/82）。  
7. **费用语义已部分修好、展示仍危险**：runtime estimate ≠ official；MiniMax 常 per-request unavailable；不得用 0 填缺失（FL-D38/47/49/59/73/91）。  
8. **主审是必需角色但通道不完整**：succeeded 后无法 resume；有窄 `revise`；缺 awaiting-main-review / main-correction receipt / lineage integration（FL-D45/88/94/98）。  
9. **并发与 source fingerprint 互相打架**：`maxConcurrency=4` + 全局 `sourceUnchanged` hard = 并行必误杀（FL-D33/56/87/110）。  
10. **合同税真实存在**：version2 全字段 + 占位符启发式 + 估错 scope 会抬高主线程与 Worker 双方成本（FL-D09/12/70/109/112）。

账本数字（支撑横切，不是替代定性）：任务成功率约 38%、首轮约 17%；runtime 估约 $307 中失败任务约占六成；inspect 占 exchange 收据一半以上；direct-Codex 校准几乎只有 1 个 class。

---

### 2. 按主题的全量地图

下列每个主题列出主要 FL-D；**OPEN/PARTIAL/FIXED** 以 log 自身「状态」句为准，重复项合并到 RECURRING。

#### A. 安装 / 发现 / 入口一致性

| ID | 要点 | 状态 |
|----|------|------|
| FL-D01 | Skill/MCP 未暴露，只能 CLI | OPEN/PRODUCT |
| FL-D35 / FL-D69 | MCP 常驻与 daemon/CLI 版本分叉；未知字段静默丢弃 | OPEN / RECURRING |
| FL-D93 | dev CLI 能 stop 不能从源码 start daemon | OPEN |

#### B. 配置 / Setup / Provider 就绪

| ID | 要点 | 状态 |
|----|------|------|
| FL-D03 / D17 | ready 与模型/凭据不一致；Probe 与 Key 形态 | PARTIAL（probe 隔离已交付） |
| FL-D08 / D11 / D13 | 配置可视化、三层条件、决策流而非表单 | PRODUCT |
| FL-D18 | DeepSeek 模型列表不全 | OPEN |
| FL-D19 | Health 与 effective settings 不一致 | FIXED-ish（自举交付写已修） |
| FL-D20 / D21 / D22 | Probe 证据、退出码、区域预检、全局 Claude 覆盖 | PARTIAL/FIXED-ish（隔离 Probe 已交付） |
| FL-D59 / D73 / D91 | pricing route / MiniMax 分层 / 精确报价条件 | PARTIAL |

#### C. 合同 / Validate / 策略档位

| ID | 要点 | 状态 |
|----|------|------|
| FL-D02 / D70 / D112 | `unknown` 等词误判占位符 | OPEN / RECURRING |
| FL-D04 / D39 / D43 / D44 / D54 / D58 / D90 | Diff hard gate 与估错、压缩诱导 | OPEN/PRODUCT |
| FL-D07 | 100/100 ≠ 可执行 | OPEN/PRODUCT |
| FL-D09 / D12 | 任务档位与合同 Token 税 | PRODUCT |
| FL-D10 / D46 / D84 | Task budget vs Integration limit 死路 | OPEN |
| FL-D14 | validate/submit 相对路径 | FIXED-ish（规范化已交付） |
| FL-D26 | 调查次数只是文案不是运行时 | OPEN |
| FL-D77 / D86 / D109 | 合同漏消费者 / 范围估错 | OPEN/PRODUCT |
| FL-D92 | MCP 无法表达 null 无限预算 | OPEN |

#### D. Worker 运行时与成本控制

| ID | 要点 | 状态 |
|----|------|------|
| FL-D06 / D23 | 单次 vs 累计预算；超支后错误文案 | OPEN |
| FL-D24 / D29 / D36 | 阶段预算 / 首次编辑门 / null≠无限循环 | OPEN |
| FL-D27 / D28 | 全索引税；focus 非 allowlist | OPEN |
| FL-D30 | resume 不能新预算授权 | OPEN |
| FL-D42 / D63 | 无 cancel/pause；中止丢 usage | OPEN |
| FL-D55 / D62 / D78 | 无实时 Diff；无进展≠有事件；无受控 verify checkpoint | OPEN |
| FL-D107 | stop_reason error 被当成功 | FIXED-ish |

#### E. 进展可见性与主线程监督（**账本 P0 相关**）

| ID | 要点 | 状态 |
|----|------|------|
| FL-D15 | running 藏 401 重试 | OPEN |
| FL-D25 | 失败缺阶段摘要 | OPEN |
| FL-D51 / D57 / D83 | heartbeat / stage；updatedAt 不跟活动 | OPEN |
| FL-D66 | CLI 收据是 pipe 前体积 | PARTIAL |
| FL-D68 / D97 / D111 | wait change 不看 event stream | OPEN / RECURRING |
| 账本 | inspect 轮询占主线程 exchange 大头 | OPEN |

#### F. Verifier / 源兼容 / 策略输出

| ID | 要点 | 状态 |
|----|------|------|
| FL-D31 / D37 | Worker claim vs independent verify | OPEN/PRODUCT |
| FL-D33 / D56 / D87 / D110 | 全局 sourceUnchanged 误杀 | OPEN / RECURRING |
| FL-D41 / D108 | hard/warn/score/off；零 Diff 交付 | PARTIAL（competition no-change 已有） |
| FL-D103 | resume 反馈缺全维 remediation packet | OPEN |

#### G. 主审 / 纠正 / 状态机

| ID | 要点 | 状态 |
|----|------|------|
| FL-D45 / D88 | succeeded 后无法 resume；窄 revise 已有 | PARTIAL |
| FL-D52 / D53 / D67 | attempt 配额与纠正/取消混算 | OPEN |
| FL-D89 | 主审反馈也可能错 | PRODUCT |
| FL-D94 / D105 | lineage integration；hopChurn vs 最终 diff | OPEN |
| FL-D98 | maxAttempts 后 main-correction receipt | OPEN |

#### H. Integration / 激活

| ID | 要点 | 状态 |
|----|------|------|
| FL-D34 / D50 / D61 / D79 / D100 | apply 绿但 dist/daemon 未激活 | OPEN / RECURRING |
| FL-D99 / D113 | 前台超时 vs 后台 applied | OPEN / RECURRING |

#### I. Token / 费用 / 校准

| ID | 要点 | 状态 |
|----|------|------|
| FL-D32 / D40 / D47 / D60 / D64 / D65 | efficiency 核心、usage、official、report | PARTIAL（核心多已合入，展示/统计未齐） |
| FL-D38 / D48 / D49 | runtime≠官方；语义完整性；请求级 usage | PARTIAL |
| FL-D71 / D75 | economics 读路径；Stats 文案已改 | PARTIAL |
| FL-D76 / D81 / D95 / D101 | 校准隐私/profile/daemon 工作流/首个 exact pair | PARTIAL |
| FL-D101 | 主线程 savings 有 1 样本 low confidence | PARTIAL |

#### J. Console / Competition / 统计

| ID | 要点 | 状态 |
|----|------|------|
| FL-D74 | 浏览器验收四连坑（假 0.00 等） | FIXED-ish |
| FL-D114 | competition 历史评价 vs 当前预览 | OPEN |
| FL-D115 | 成功率未 taxonomy | OPEN |

#### K. 其他

| ID | 要点 | 状态 |
|----|------|------|
| FL-D05 | Plan 不继承 patch stack | PRODUCT |
| FL-D16 | failed 事件 subtype success | 可能 PARTIAL/FIXED（与 D107 同类） |
| FL-D102 | 沙箱 capability-denied | OPEN |

---

### 3. 根因簇（合并重复 ID 后的「真正要修的东西」）

用根因簇而不是 115 个独立 bug 排期：

| 簇 | 代表 ID | 用户可感知后果 |
|----|---------|----------------|
| **R1 进展模型** | D51/57/68/83/97/111 | wait 误超时、狂 inspect、主线程贵 |
| **R2 结果多维语义** | D41/52–54/90/103/108/115 | 假失败率、错路由、错归因 |
| **R3 源兼容门** | D33/56/87/110 | 并发假失败、白烧、污染统计 |
| **R4 预算/策略门** | D04/10/43/46/54/84/90 | 测过仍 fail、压缩正确代码、合入死路 |
| **R5 运行时阶段控制** | D23–30/36/55/62/78 | 只调查不交付、无限读、无 result |
| **R6 激活与版本身份** | D34/35/50/61/69/79/93/100 | 「合入了但没生效」 |
| **R7 Integration 控制面** | D99/113 | 超时当失败、重复 apply |
| **R8 主审闭环** | D45/88/94/98/105 | 机器成功后无法正式纠正/合入 |
| **R9 合同与 MCP 表达** | D02/70/92/109/112 | 合同税、null 预算、估错范围 |
| **R10 费用可信展示** | D38/47/59/73/75/91 | 错误成本决策 |
| **R11 Provider/Probe 信任** | D03/17–22 | 假 ready、白调任务 |
| **R12 校准可信** | D32/60/64/81/101 | 不能乱说「省了多少」 |

---

### 4. 综合优化计划（在全量地图之后）

目标优先级（产品原则，来自账本 + 横切）：

1. **主线程最便宜且可信**（R1 + 监督协议 + 紧凑证据）  
2. **终态与统计不说谎**（R2）——否则一切路由/优化会建在错误数据上  
3. **少假失败、少白烧**（R3 + R4 + R5 关键子集）  
4. **合入=可运行**（R6 + R7）  
5. **主审与合同表达**（R8 + R9）  
6. **费用与校准可信**（R10 + R12）  
7. **配置/档位/Console 产品化**（B/C 的 PRODUCT 项，可并行规格）

#### Wave 0 — 基线与度量（短，不宣称已优化）

- 冻结账本快照方法：任务成功率、首轮成功率、失败 taxonomy 粗分、inspect/wait 次数、official vs runtime。  
- 每波结束后用同一脚本复测（防「感觉好了」）。  
- 在 dogfood 中维护根因簇 ↔ FL-D 对照（本节），新 FL-D 必须挂簇。

#### Wave 1 — 主线程监督可信（对应 R1；服务「主线程最便宜」）

**做：**

1. Progress cursor：`status + latestEventSequence + attempt/stage (+ lastEventAt)`  
2. `wait --until change` 观察 cursor / effective progress，不只 `updatedAt`/status  
3. 紧凑 status/wait 返回：`active|quiet|stalled`、最近有效动作、距今时间  
4. inspect 默认/推荐 summary；MCP 支持 eventLimit/summary，抑制 full 轮询  
5. 编排 skill/文档：`submit → wait → inspect(summary) → …`  

**验收：** D97/D111 场景单测：event 增而 status 不变 → changed 非 timeout；inspect 体积可测下降。  
**刻意不做：** 完整 Console timeline 重做（可随后）。

#### Wave 2 — 结果语义与源兼容（R2 + R3；服务「总成本 + 统计诚实」）

**做：**

1. Verifier 输出分栏：`behaviorPassed`、`policyPassed`、`sourceCompatible`（及原因列表）  
2. 全局 `sourceUnchanged` 降为审计；hard 门改为 affected paths（+ 可选依赖闭包）相交  
3. 失败 error / Console 至少能区分 policy vs behavior vs source-drift  
4. Resume/revise 反馈用 remediation packet 多维同时列出（R2∩D103）  

**验收：** 并行改 dogfood.md 不再误杀无关任务；「命令绿+行数红」在 API 上可区分。

#### Wave 3 — 策略门与预算诚实（R4 + R5 子集）

**做：**

1. changeBudget / 质量行数：profile 级 `hard|warn|score|off`（安全与 behavior 默认 hard）  
2. Validate/Submit：Task budget vs Integration limit 冲突预检（D10/D46/D84）  
3. 预算终态传播 `error_max_budget_usd`（D23）；resume 允许一次性 attempt 预算授权（D30/D67）  
4. 机器 Diff 回传 Worker（additions/deletions/changedLines）（D55/D58）  
5. 可选：受控 verification checkpoint（白名单命令，非任意 shell）（D78）  

**验收：** 行为全绿仅超 N 行不再只能记普通 failed；提交前可见「能跑不能合」。

#### Wave 4 — 激活、Integration 控制面、版本身份（R6 + R7）

**做：**

1. Integration 阶段：`sourceApplied / sourceVerified / artifactBuilt / runtimeActivated`  
2. apply 异步 operation id + wait；超时 = outcome-unknown（D99/D113）  
3. daemon/CLI/MCP 暴露 build/protocol identity；握手不一致明确 refresh（D35/D69）  
4. dev daemon start 修入口（D93）  

**验收：** 自托管改 ForkLight 后「绿 apply」不再静默跑旧 dist。

#### Wave 5 — 主审生命周期与 lineage（R8）

**做：**

1. `awaiting-main-review` / accept / revise 扩展到 plan/competition 需求边界内  
2. `main-correction` receipt（maxAttempts 后最小补丁 + 重验收）（D98）  
3. correction lineage + combinedDeliveryDiff vs hopChurn（D94/D105）  

**验收：** 机器 succeeded 后主审可正式纠正；失败历史不伪造成功。

#### Wave 6 — 合同表达、MCP 预算、占位符（R9）

**做：**

1. 占位符 hard 仅 sentinel/空字段；自然语言 warning（D70/D112）  
2. MCP `maxBudgetUsd: number | null` + 继承语义（D92）  
3. 任务档位（small-fix 等）最小合同（PRODUCT，可与 Wave 3 profile 合并）  
4. impact forecast / 消费者面预警（D109/D77）——可先静态启发式  

#### Wave 7 — 费用展示、统计 taxonomy、校准扩样（R10 + R12 + D115）

**做：**

1. Stats/Competition 全面分栏 official vs runtime；不可用原因  
2. Provider 成功率 taxonomy（D115）  
3. 多 taskClass direct-Codex 校准；禁止无基线宣称节省  
4. MiniMax 请求级 usage 路线图（精确报价前置）  

#### Wave 8 — 产品层配置中心（B/C PRODUCT）

- 三层 Safety / Quality Profile / Preferences  
- 提交决策流：档位 → 冲突 → 费用暴露 → 合同  
- 不阻塞前几波工程修复  

---

### 5. 与「先前想当然计划」的差异

| 先前草稿 | 全量总结后 |
|----------|------------|
| 几乎只做 wait + inspect + source | 仍把 R1 放 Wave 1，但 **R2 与 R3 紧随**，否则省主线程也省不稳总账 |
| 把 budget 近失当小补丁 | 上升为 **R4 策略语义**，不是单点 if |
| 忽略激活/MCP 版本 | 单列为 Wave 4，log 复现极多次 |
| 忽略主审闭环 | Wave 5，否则 dogfood「主 Codex 手工合入」会永远绕过产品 |
| 未系统挂 FL-D | 每簇绑定代表 ID，新观察必须入簇 |

---

### 6. 建议的立即执行顺序（仍不开始写代码，除非另行批准）

1. **确认本全量地图与 Wave 划分**（本文）  
2. **Wave 0 度量脚本**（可复用账本 node 汇总）  
3. **Wave 1 实现**（progress-aware wait + compact inspect）  
4. **Wave 2 实现**（verifier 分栏 + affected-path source gate）  
5. 每波：测试 → dogfood 追加「已处理簇/剩余」→ 再 commit  

**本轮明确不宣称：** 做完 Wave 1–2 就「总成本一定省」；只宣称监督可信 + 假失败下降 + 主线程轮询下降（可用账本复测）。

### 7. 覆盖声明

- **已覆盖：** FL-D01–FL-D115 的主题归类与根因簇；自举交付与账本审计的横切含义。  
- **未做：** 逐条对当前 `main` 源码的自动化 open/closed 验证（需 Wave 0 之后用测试/代码检索二次对账）。  
- **若某条状态与代码不符：** 以代码 + 复现为准，回写本节状态标签。


## 2026-07-23 Wave 0+1 交付记录

状态：已在源码实现，待 commit / 激活 dist+daemon。

### Wave 0

- 新增 `scripts/economics-snapshot.mjs` 与 npm script `economics-snapshot`。
- 只读汇总 tasks/attempts、成功率、official vs runtime、worker gross tokens、exchange op 分布与 inspect 占比。
- 用法：`npm run economics-snapshot` 或 `FORKLIGHT_HOME=... npm run economics-snapshot -- --json`。

### Wave 1（R1 主线程监督）

**Progress-aware wait（FL-D97 / FL-D111 / FL-D68）**

- `wait --until change` 的 cursor = `status + latestEventSequence + currentAttemptId + updatedAt`。
- Worker 仅产生 events、status/`updatedAt` 不变时，也会返回 `changed`，不再误 timeout。
- Wait 结果增加 `progress.activity`（active|quiet|terminal）、`latestEventSequence`、最近 event 摘要。
- Store 新增 `latestEventMeta`（按 max sequence，不读 payload）。

**Compact inspect**

- summary 增加 verification 分栏提示：behavior / policy(changeBudget) / source。
- 增加 progress 字段。
- MCP `forklight_inspect` 默认 `summary=true`、`eventLimit=20`；`summary=false` 仍为 deep audit（diff 120k 截断）。
- MCP 指令文案改为：禁止 tight-loop full inspect，优先 summary。

**测试**

- `tests/cli-supervision.test.ts` 覆盖 event-sequence change、identical cursor timeout、verification hints、latestEventMeta。

### 明确未做（后续 Wave）

- Wave 2：affected-path sourceUnchanged、完整 behavior/policy 终态字段落库。
- MCP `forklight_wait` 工具（当前 wait 仍为 CLI）。
- Console 共用 progress 读模型。


## 2026-07-23 Wave 2 交付记录

状态：已在源码实现并通过相关单测；待 build / 重启 daemon 后生效。

### 做了什么（R2 结果分栏 + R3 源兼容）

1. **Verifier 分栏字段**（写入 `verification.completed` payload）  
   - `behaviorPassed`：验收命令是否全过  
   - `policyPassed`：changeBudget + completionPolicy hard 是否通过  
   - `sourceCompatible`：补丁涉及路径在源项目上是否仍与 prepare 快照一致  
   - `sourceUnchanged`：保留为**全树审计**，不再单独构成 hard fail  

2. **Affected-path 源兼容门**（FL-D33 / D56 / D87 / D110）  
   - 从 baseline→workspace diff 解析 affected paths  
   - 仅这些路径与 `source-manifest.json` 不一致时 hard fail  
   - 无关路径漂移记入 `sourceCompatibility.unrelatedDriftPaths`，summary 可注明 “unrelated source drift recorded”  
   - 同路径并发改动仍 hard fail（`conflictingPaths`）  

3. **消费方**  
   - competition 失败文案改用 sourceCompatible  
   - statistics 读取 legacy payload 时回填分栏字段  
   - inspect summary 的 source hint 优先展示 compatible / conflict / unrelated_drift  

### 测试

- `workspace.test.ts`：无关漂移兼容、同路径冲突、diff path 解析  
- `verifier-policy.test.ts`：交付 + 改 README 仍 `passed=true` 且 `sourceUnchanged=false`  
- competition / statistics / supervision 相关套件全绿  

### 明确未做

- 依赖闭包（只做了 patch 路径，未做 import 图）  
- changeBudget soft/warn 分档（Wave 3）  
- Integration preflight 与 verifier 完全共用同一 API 面（语义已对齐方向）  

