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

## 2026-07-23 Lean Core Wave 2：Workspace 与 Diff 真相

- 状态：实现完成并通过确定性混合工作区 Dogfood；真实外部模型执行仍待后续统一 Dogfood。
- 证据：`PathPolicy` 对业务、生成噪音和 `.forklight` 内部文件使用同一分类；默认嵌套 Python/测试缓存与合同声明的自定义缓存进入 generated evidence，`dist`、迁移和生成源码默认仍视为业务交付。Patch 生成只运行一次 `git diff --no-index --binary`，再拆分 raw/generated/integration artifacts，全程不删除 baseline 或 workspace 文件。
- 混合夹具：Node 业务文件进入 business/integration patch，嵌套 `__pycache__` 进入 generated patch，内部上下文不进入 Integration；生成文件在 Patch 后仍可逐字读取。Verifier、checkpoint 和 Integration 的 Git 命令使用 Task root 下的外置 Git/index，workspace 与原项目均没有新增 `.git`。
- 上下文与清理：500 文件夹具只展示至多 200 条路径，同时保留总数、顶层统计、focus paths 与截断说明；TypeScript `noUnusedLocals` / `noUnusedParameters` 已开启，删除 24 处编译器确认的死导入、死参数、死 helper 和一段未执行的测试伪 mock。
- 验收：Wave 2 聚焦 100/100；完整 `npm run check` 为 690/690；`npx tsc -p tsconfig.json --noEmit` 与 `git diff --check` 通过。没有数据库迁移，也没有新增 glob/static-analysis 依赖。

## 2026-07-22 初始观察

### FL-D01：本地技能存在但当前 Codex 技能目录未暴露

- 证据：本机有 ForkLight 0.2.0 CLI 和 `forklight-orchestrator/SKILL.md`，但当前会话的可用技能及工具列表没有 ForkLight；只能发现后退回 CLI。
- 影响：用户明确点名 ForkLight 时，Agent 可能误判为未安装。
- 候选改进：检查插件安装后的会话刷新、MCP 注册和技能目录暴露；CLI fallback 文档化。

### FL-D02：领域枚举词触发占位符误报

- 状态：**已关闭（2026-07-25）**。占位符 hard/soft 拆分（见 FL-D70 / FL-D112）；`unknown` 等自然语言词降为带字段位置的 soft warning，不再 hard-reject 结构完整的合同。
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

- 状态：**部分关闭（2026-07-25）**。终态 auth 失败现有明确 summary + `failureCategory: authentication`（见 FL-D16）。**中途 running 时的重试次数/倒计时**仍需运行时结构化事件，属 product 未做。
- 证据（历史）：任务长时间 `running` 而日志已 10×401。
- 落地（终态）：`src/events/normalize.ts`；`tests/normalize.test.ts` auth 用例。latest-event progress（D83）可展示终态 failure summary。
- 剩余 product：live `provider_retrying` 子状态与快速失败策略。

### FL-D16：失败事件中出现 `subtype: success`

- 状态：**已关闭（partial）**（2026-07-25）。normalizer terminalError + auth `failureCategory` 已统一终态分类（见 §2 K 与 FL-D15）；信封 subtype 仍保留在 payload 作审计，不再驱动分类。
- 证据：终态 `inspect` 同时记录 `worker.failed`，但该事件 payload 的 `subtype` 为 `success`；同一 Attempt 的最终 status、exit code 和 resultText 均明确表示鉴权失败。
- 影响：依赖事件流的控制台、统计或自动恢复策略可能把失败误分类；用户也难以判断这是 Worker 正常返回了一份失败报告，还是运行时真正失败。
- 候选改进：归一化 Worker 结果时令 event type、subtype、exit code 与 task status 使用同一终态分类；为鉴权失败增加回归测试。

### FL-D17：已验证证据与实际持久化凭据不一致

- 状态：已复现状态不一致；形成路径待单独复现。
- 证据：DeepSeek Keychain 条目的创建/修改时间与缓存 Probe 的 `verified` 时间相同，但条目值的安全形态检查显示它等于 `deepseek-v4-pro[1m]` 模型名，不是 DeepSeek API Key；环境变量中也不存在可供 Worker 覆盖使用的 DeepSeek 或 Anthropic Key。与此同时，Provider 状态仍展示该次 Flash Probe 为 verified。
- 影响：用户会在“已验证”提示下提交真实任务，直到 Worker 经 10 次重试后才知道保存的凭据根本不可能通过鉴权。
- 候选改进：Setup 在持久化前做 Provider-specific Key 形态检查；提交后从 Keychain 重新读取并使用“实际持久化值”再做一次一致性确认；Probe evidence 绑定凭据不可逆指纹、模型和 endpoint，凭据变化或指纹不匹配时立即作废。后续需复现 Setup 前端字段与 `/api/probe` payload，确认模型值如何进入 Key 字段。

### FL-D18：DeepSeek 模型选择器只展示当前默认值

- 状态：**已关闭（2026-07-25）**。`providerVariants("deepseek")` 列出 Flash / Pro / Pro[1m]，默认模型仍在列表中且可被自定义 default 前置。
- 证据（历史）：旧 fallback 仅 `[current.defaultModel]`。
- 落地：`src/core/providers.ts`；回归 `tests/providers.test.ts` “DeepSeek providerVariants lists Flash and Pro…”。
- 候选改进（可选 product）：Setup 展示价目/Probe 态——非关闭条件。

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

- 状态：**已关闭（partial）**（2026-07-25）。Decision View 已提供 stage/nextAction/workerClaim/verification/lineage/integration 分栏，`inspect --summary` 合并展示（见 §2 E）；固定五段式 + budget delta 的终态摘要属 product-vision。
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

- 状态：核心语义已实现并完成确定性验证；Console 分栏与真实外部模型 Dogfood 待后续 Wave。
- 证据：DeepSeek Pro 任务 `ba6a5f15-42a8-4bc1-a0b4-2875f428b938` 首次 Worker 结果声称改动已经验证，但随后 ForkLight 独立运行 `npm run check` 时发现新增测试的 TypeScript 错误并判定 Attempt 失败。
- 影响：控制台若突出展示 Worker 最终文本，会让用户在真正验收前看到误导性的成功语气；模型自报无法替代独立验证。
- 候选改进：界面把 Worker Claim 与 Independent Verification 分栏显示；Verifier 未完成前不得展示系统级“已验证”，失败时明确标注 Worker 声明被验收推翻。
- 本轮交付：成功终态文本现在保存为带 `unverified-claim` 标签的 Worker Claim，完整原文只留在 Attempt 私有记录；独立 Verifier 继续作为行为结论的唯一机器权威。回归测试证明 Claim 不会被写成 `behaviorPassed`。

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

- 状态：Claim 隔离与分类 Diff 已实现并完成确定性验证；Console 展示待后续 Wave。
- 证据：MiniMax 声称实现符合 390 行限制，Verifier 实算 468 行；DeepSeek Pro 任务 `26b0545d-cdfa-4a2c-a70e-7f4cb9666e61` 声称“line count is close to the budget”并“all files are updated and verified”，Verifier 实算 5 文件 / 488 行且 `npm run check` 有 7 个 TypeScript 错误。
- 影响：自然语言总结会制造已受控的错觉；若控制台突出 Worker Claim，用户可能在独立证据出现前误判质量和预算。
- 候选改进：Worker 结束后先由 ForkLight 计算文件数、Diff 行数、编译/测试结果，再生成终态摘要；所有 Worker 自报数字标记为 claim，不能参与门禁、排名或预算统计。
- 本轮交付：Worker 终态中的 Diff/测试表述统一归入未验证 Claim；预算与命令结论仍只来自 ForkLight 机器计算的 `VerificationResult`。
- Wave 2 补充：Verifier 现在把机器 Diff 拆为 business、generated、integration 三类，预算只使用 business evidence；generated 与 raw patch 仍留作审计，不由 Worker 自报数字参与门禁。

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

- 状态：**已关闭（核心）**（2026-07-25）。进展可见性由 latest-event activity（FL-D83）提供，`status`/`wait` 显示 `lastEventAt` + `activity`；bounded heartbeat（log delta/PID 活性/watchdog 剩余窗口）属 product-vision（见 §2 E）。
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

- 状态：补救包、分类 Diff checkpoint 与有限 Workspace Context 已实现并完成确定性验证；真实外部模型 Dogfood 待后续 Wave。
- 证据：上述任务 Attempt 2 运行 178 turns，终态 usage 为 input 65,735、output 87,474、cache-read 34,519,680，runtime estimate USD `19.775365`。Worker 没有 shell/diff 工具，只能反复 Read、Grep、压缩并猜测当前体积，曾从约 803 行逐步压到 701 行仍差 1 行；Attempt 3 为修一个 parser error 又重新处理长合同，26 turns、cache-read 6,509,312，最终因修复新增代码回到 721 行。两轮官网费用均因任务缺少显式 MiniMax billing route 而保持 `route-required`，不能按 0；即使补 route，逐请求 usage 不完整仍应保持 exact unavailable。
- 影响：`maxBudgetUsd: null` 取消了费用硬停止，却没有执行阶段控制、实时体积反馈或纠正上下文裁剪；模型大量消耗发生在“估算如何过门”而不是功能实现。Console 只显示 running，也无法说明正在推理、编辑、压缩还是验证。
- 候选改进：ForkLight 应向 Worker提供只读、机器计算的 `filesChanged / changedLines / limit / delta`，接近门槛时发一次 bounded feedback；Resume 支持 `minimal correction context`，只发送当前 diff、失败命令、主审查结论和仍生效的不变量。阶段心跳、连续无进展、软费用提醒与 synthesis checkpoint 均可配置，且与用户费用硬上限分离。
- 本轮交付：Worker 可通过唯一的私有 MCP 工具按 `acceptance-N` 请求合同命令检查，并收到明确标为 `non-authoritative-checkpoint` 的命令结果和原始 Diff 计数；任意 Shell、命令文本和原项目写权限仍未开放。Resume 改为消费最新完整 Verification 的全部失败命令、策略发现和受影响源冲突，不再只给最后一条 stderr。
- Wave 2 补充：checkpoint 现在返回同一套 business/generated/integration patch evidence；Workspace Context 对大仓库限制为 200 条优先索引，先列 focus paths、根入口和顶层统计，不再把完整文件清单重复塞给 Worker。

### FL-D56：无关源文件变化会让行为与策略都通过的 Task 被误判失败

- 状态：收据持久化已经由主 Codex安全合入并在真实源码复验；原 ForkLight Task 保留 `failed`，没有伪造历史成功。
- 证据：DeepSeek Pro 任务 `0eaf903c-93ec-4aba-a3cf-ea6328b2d4bf` 第三次 Attempt 的独立 `npm run check` 为 391/391 tests，变更为合同内 4 文件 / 850 行，命令验收和 change budget 都通过；`verification.completed` 仍因 `sourceUnchanged:false` 给出 `passed:false`。逐字比较证明四个目标文件与 Task baseline 完全一致，只有 `PROJECT_STATUS.md` 和本 dogfood log 在执行期间更新。主 Codex只应用 `result.diff` 中四个声明文件，并在真实工作树再次通过 391/391 tests。
- 费用与模型证据：Attempt 1 是主审查主动终止，缺少终态 usage，不能按 0；Attempt 2 官网 DeepSeek quote 为 USD `0.038409688`，runtime estimate 为 USD `1.730453`，约高 45.05 倍；Attempt 3 官网 quote 为 USD `0.019003642`，runtime estimate 为 USD `1.060162`，约高 55.79 倍。Attempt 2 是测试夹具/错误分支失败，Attempt 3 是行为成功但基础设施误拒绝，二者不能统一记为模型能力失败。
- 影响：全仓库 `sourceUnchanged` hard gate 会把同步文档、无关用户改动或另一个并发 Agent 的独立文件改动误判为补丁冲突，3–5 并发越高误拒绝概率越大；Task status 又无法表达 `behaviorPassed=true / policyPassed=true / sourceConflict=unrelated`，主审查只能依靠外部证据恢复。
- 候选改进：Verifier 输出结构化 source drift 文件列表，并按与补丁影响面是否相交分类。受影响文件变化继续是不可关闭的 hard safety invariant；无关文件变化默认 `warn`，记录证据但不使行为验收失败。Integration preflight 再次校验目标文件 digest，主 Agent可对无关 drift 签发一次性、可审计的 affected-files-only acceptance，而不是修改 Task 历史或重跑完整 Worker。

### FL-D57：`running` 状态无法区分模型推进、Provider 等待和真正卡死

- 状态：**已关闭（核心）**（2026-07-25）。`status`/`wait` 现显示 `lastEventAt` + `activity`（active/quiet/terminal，FL-D83），可区分近期有活动与静默；Provider-wait 与 stuck 的更细 sub-state 及中途重试计数属 product-vision（见 §2 E）。
- 证据：任务 `54190ea6-1819-404a-bfcb-c693e4d9d1f0` 的 Attempt 1 持续约 34 分 44 秒，中间多次出现约 3–4 分钟 Provider 返回间隔，但进程仍存活且随后继续编辑；Task `updatedAt` 长时间停留在较早时间，Console 只显示 `running`。Attempt 3 运行期间 raw log 从 27KB 持续增长到 726KB，最终正常转入 `verifying` 并成功。
- 影响：长等待会被用户误认为卡死，也可能被 no-progress 规则错误判为模型失败；反过来，只有进程存活也不能证明任务有有效进展。
- 候选改进：把 `worker_action`、`provider_wait`、`verifying`、`no_progress` 分成可观察阶段，并保存最近事件时间、日志增量、PID 状态和距 watchdog 的时间。Provider 等待不计模型能力失败；等待超时的 hard/warn 行为与阈值可配置。

### FL-D58：Diff 硬门同时暴露了机器计数缺失和可读性退化

- 状态：统一机器计数与分类 Patch 已实现并完成确定性验证；策略档位与 Console 呈现仍待实现。
- 证据：同一任务 Attempt 2 的独立验收为 400/400 tests、`sourceUnchanged=true`，但机器实算 834 行，超过合同 750 行。MiniMax 自报 748 行，是因为只相加了新增文件行数和 `server.ts` 的净增量，漏掉了 43 行删除。Attempt 3 在明确反馈后压到 733 行并通过，但为过硬门把多个 handler 压成拥挤单行；主 Codex审查又发现六个已知 Task 工具的 `ensureDaemon` 位于 receipt wrapper 外，daemon 启动错误不会留下失败证据，随后在真实源码中纠正并恢复可读结构。
- 影响：Worker claim 不能作为预算证据；静态行数 hard gate 会把优化目标从正确性和可维护性转向文本压缩，并可能制造测试未覆盖的边界缺陷。将 Attempt 2 记为普通模型失败也会丢失“行为全过、策略不符”的事实。
- 候选改进：ForkLight 在 Worker 执行中提供只读机器 Diff 计数，并明确 `additions + deletions`；Verifier 分开输出 `behaviorPassed`、`policyPassed` 和 `mainReviewAccepted`。Diff 预测与质量预算默认支持 `warn/score`，只有明确 profile 才为 hard；主审查发现的问题可进入独立 correction 状态，不与 Provider 或模型失败混算。
- 再次证据：DeepSeek 任务 `7e60b684-62fe-4fbc-8c25-be231c7a2057` 第三轮的两条验收命令均通过，Worker 自报约 843 行，`verification.completed.changeBudget.changedLines` 为 `887`，而 `inspect --summary` 的 `diff.lineCount` 又是 patch 文件总行数 `937`。三种口径同时出现，最终只因 887/850 被标记 failed；正确实现已由主 Codex安全合入并在真实源码通过 568/568。UI 与 Worker 必须统一展示 additions、deletions、changedLines 和 patchLines，策略只能绑定一个明确口径。
- Wave 2 补充：`WorkspacePatchReport` 为每类 Patch 固定保存 `filesChanged`、`changedLines` 与 `affectedPaths`；Verifier 的 change budget 只绑定 business changedLines，Integration 只消费 integration patch，raw/generated evidence 单独保留。

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

- 状态：已修复（验证器语义）。占位符检查已拆分为 hard gate 与 soft warning。
- 证据：合同中描述”unknown/nonexistent Task”这一正常错误场景时，validator 仅凭 `unknown` 文本命中占位符规则并拒绝整份 Task，而不是检查结构化未填字段。
- 影响：硬性字符串规则会迫使主 Agent 改写准确表达，增加合同 Token 和认知成本，也会使不同语言/领域词产生随机误报。
- 候选改进：占位符 hard gate 只识别明确模板标记与空结构字段；普通自然语言命中降为可解释 warning，允许 Task 级 override 并记录原因。结构完整性与措辞启发式必须分开分类。
- 落地：`src/core/task.ts` 的 `assessTaskQuality` 现按字段扫描；hard gate 仅匹配模板 sentinel（`{{...}}`、`___`、`???`、全大写 `TODO|TBD|FIXME`），自然语言词（`unknown`、小写 `todo/tbd/fixme`、`待定/暂不清楚/以后再说`）降级为带字段位置的 `QualityReport.warnings`，不阻断提交。CLI/MCP validate 自动透出 warning。覆盖测试见 `tests/task.test.ts`。

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

- 状态：受控 checkpoint 与 Verifier-only Git 已实现并完成确定性验证；真实外部模型调用仍待 Dogfood。
- 证据：MiniMax Worker 只有 Read/Glob/Grep/Edit/Write，不能运行合同已经声明的验收命令。Attempt 1 靠逐文件读取检查时漏掉 `tests/task-economics-report.test.ts:543` 的缺失括号；Attempt 2 修正后仍无法看到 41 个 focused tests 中两个夹具错误，只能继续 Grep/Read 猜测。主 Codex 分别跑出明确 build 错误与 39/41 结果后中止并反馈，第三轮才达到 41/41。前两轮因 SIGTERM 没有 terminal result，Token 与费用证据为 `usage-missing`，不能按 0。
- 影响：禁止任意 shell 是重要安全边界，但“Worker 无法请求任何受控验证”会增加 turns、重复读和纠正轮次；在单任务不限预算时尤其容易产生 Token 税。主调度能手工进入隔离区执行并不是可复用产品体验。
- 候选改进：增加 daemon 执行的只读/白名单 verification checkpoint：Worker 只能请求合同内既有命令，daemon 在隔离环境运行、限制超时与输出并把结构化结果返回 Session；是否允许、触发阶段、次数和 Token/时间提醒可配置。任意 shell 仍保持 hard 禁止，checkpoint/fixture 失败与模型、Provider 失败分开统计。
- 本轮交付：daemon 新增内部 `checkpoint_run`，只接受当前运行 Task/Attempt 与确定性命令 ID；私有 MCP 只暴露一个 `run` 工具，配置不含凭据、原项目路径或验收命令文本。独立 Verifier 在 Worker 结束后仍会重新运行全部命令，checkpoint 不获得验收权威。
- Wave 2 补充：合同命令中的 `git diff --check` 和 `git status --porcelain` 由 Task root 下的 Verifier-only bare Git/index 支撑；同一环境用于 checkpoint、最终 Verifier 和 Integration 验收，但不会写入 workspace、MCP 配置或 Worker 权限。

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

- 状态：**已关闭（2026-07-25）**。公开 status 读模型改为 latest-event activity，不再用冻结的 `tasks.updatedAt` 充当存活信号。
- 证据（历史）：Attempt 3 从 09:24 到 09:30 持续生成 thinking、Read、Edit 和最终 result，日志每秒增长，PID `47149` 存活；当时 `forklight_status` 在整个窗口仍返回旧 `updatedAt`，直到终态才跳变。
- 落地：`src/core/task-progress.ts` 的 `buildStatusProgress` / `classifyActivity` 被 CLI `status`/`list`、`wait` 与 `buildTaskDecisionView`（MCP status）共用；输出 `activity`（active/quiet/terminal）、`latestEventSequence`、`lastEventAt`、`latestAction`。`updatedAt` 仍保留为 spawn/terminal 时间戳。回归：`tests/cli-supervision.test.ts`、`tests/task-decision-view.test.ts`。
- 影响（历史）：用户问“是不是正常执行”时，只能旁路读日志/PID。
- 候选改进（未做，非本项关闭条件）：machine Diff delta、usage 实时暴露、`nextExpectedSignal` 等更细信号仍属产品 backlog。

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

- 状态：**已关闭（2026-07-25）**。MCP schema 接受 `number | null`；省略继承 effective default；显式 `null` 保持 unlimited，不再被 `??` 替换为有限默认。
- 证据（历史）：`defaultMaxBudgetUsd = null` 时省略字段曾失败；YAML 显式 null 可过。
- 落地：`src/core/budget.ts` 的 `resolveMaxBudgetUsd`；`src/mcp/server.ts` taskInputSchema + `inlineTask`；validate 返回 `budget.source` / `generatesRuntimeFlag` / `resolvedRuntimeMaxBudgetUsd`。回归：`tests/budget.test.ts`、`tests/mcp.test.ts`（validate/submit/inlineTask）。
- 影响（历史）：CLI 与 MCP 预算语义不等价。
- 候选改进（未做，非关闭条件）：Console 配置中心展示 budget source 可视化。

### FL-D93：开发态 CLI 能停止 daemon，却无法从源码目录重新启动

- 状态：**already-fixed**（代码已交付；`daemonLaunchArguments` 对 `.ts` 使用 `--import tsx` + `main.ts`，dist 使用 `main.js`）。
- 证据（历史）：旧实现只找 `main.js` 导致 dev start ENOENT。
- 落地：`src/daemon/client.ts` `daemonLaunchArguments`；回归 `tests/daemon.test.ts` “source-dev daemon launch uses tsx…”。
- 候选改进（可选）：daemon status 进一步展示 launch mode 路径——非关闭条件。

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

- 状态：**已关闭（2026-07-25）**。cursor 已含 `latestEventSequence`，`wait --until change` 观察事件流而非只看 `updatedAt`（见 §2 E 与 2026-07-25 对账；`tests/cli-supervision.test.ts` 覆盖 event 增而 status 不变 => changed）。残留 coarseness（effective-action vs narration、`stalled` 态）归入 product-vision。
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

- 状态：Verifier 维度补救包已实现并完成确定性验证；主审结构化结论将在纠偏 Wave 接入。
- 证据：Task `f5b750b3-d9f9-4f7e-8ff7-09b5bae159cb` Attempt 1 先遇到测试夹具编译失败和 `993 > 850`；Attempt 2 修复编译后只剩两个错误断言，但仍是 `992 > 850`；Attempt 3 继续追逐断言，最终为 92/93 且 `991 > 850`。三轮每次都获得局部验收反馈，却没有把 behavior、policy、source compatibility 与主审语义放在同一张纠正清单中。
- 影响：Worker 会合理地优先修当前命令失败，同时重复忽略另一个必然拒绝条件，消耗额外 Attempt、Token 和费用。顶层 failed 也无法告诉用户它不是 Provider 故障。
- 候选改进：Resume 前生成一次结构化 remediation packet，至少同时列出 `behaviorFailures`、`policyFailures`、`sourceCompatibility`、`mainReviewFindings` 和 `requiredOutcome`；后续 Attempt 必须逐项回报 resolved / unresolved，而不是只消费最后一条 stderr。
- 本轮交付：Verifier 不再首错即停，会顺序跑完全部验收命令；`RemediationPacket` 从最新权威 `verification.completed` 派生所有失败命令、已通过检查、策略发现与受影响源冲突，并对输出做尾部限长。主审发现项尚未混入该包，避免提前宣称全维完成。

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

- 状态：**已关闭（核心）**（2026-07-25）。全局 `sourceUnchanged` hard 门已改为 affected-path gate（见 §2 F），无重叠变化不再误杀；全局 fingerprint 仅作审计。
- 证据：Outcome-policy Worker 运行期间，主 Codex安全合入了 Console auth 的五个文件。两组生产文件没有重叠，但 Task 的全项目 fingerprint 因外部变化变为 false，后续 verifier 必然拒绝；这重复了此前并行任务的同类假失败。
- 影响：并发度设置为 4，却用全项目不变作为成功硬门，等于让无关任务互相制造失败；失败率、Token 与费用统计都会被调度器自身污染。
- 候选改进：保留原始全局 snapshot 作为审计，真正的兼容 hard gate改为 affected paths + dependency closure 的三方 digest；无重叠变化记录 warning，有语义依赖或同文件变化才暂停合并。

### FL-D111：`wait --until change` 再次把有事件的 Worker 显示成 timeout

- 状态：**已关闭（2026-07-25）**。与 FL-D97 同属 wait 事件流修复，现已观察事件 sequence；重复证据，原根因已修（见 §2 E）。
- 证据：DeepSeek 三轮执行时 Worker event sequence 持续增长，但 Task `updatedAt` 在阶段内不变，`wait --until change` 因只比较 Task timestamp 而超时。主线程不得不读取更大的 inspect 结果确认进度。
- 影响：用户会把正常执行误解为卡死；主 Codex增加轮询与 exchange Token，反而侵蚀 ForkLight 的主线程节约。
- 候选改进：统一 progress cursor 为 `task.updatedAt + latestEventSequence + attempt/status/stage`，返回 `active | quiet | stalled`、最后有效动作与距今时间；CLI、MCP、Console 共享同一紧凑读模型。

### FL-D112：正常词 `unknown` 再次触发占位符 hard gate

- 状态：已修复（与 FL-D70 同一改动）。这是 FL-D70 的重复证据，验证器语义现已修复。
- 证据：任务合同描述”unknown completion evidence”这一正常兼容场景时，quality gate 仅因字符串 `unknown` 拒绝 100/100 结构化合同。改写同义词后结构完全不变即通过。
- 影响：语言启发式伪装成结构 hard gate，迫使主 Agent增加改写和合同 Token，并会系统性误报错误处理、兼容性和多语言任务。
- 候选改进：只对空字段、明确模板 sentinel 和未替换变量做 hard fail；自然语言词命中最多是 warning，并提供具体字段位置与 task-level acknowledgment。
- 落地：见 FL-D70。`unknown` 现为 soft warning（带 `field`/`term`/`excerpt`），不再 hard-reject 结构完整的合同；warning 即为可记录、不阻断的 task 级 acknowledgment。回归测试覆盖 “unknown completion evidence” 场景。

### FL-D113：Integration 前台十秒超时再次与后台成功冲突

- 状态：**已关闭（2026-07-25）**。异步 operation + `outcome-unknown` 已实现（见 §2 H 与 2026-07-25 对账）；前台超时不再伪造失败，可凭 operationId 恢复查询。
- 证据：receipt `31879544-6745-4b81-bf88-16653f3da06b` apply 的 CLI 前台超时，但 daemon 后台继续验证并保存 result `68c1de10-e3c7-45d7-82cd-46e8b611c2f4`，状态为 applied，focused 70/70、full 637/637。
- 影响：用户可能重复 apply 已消费 receipt，或把成功合入误判为失败；这是控制面表达错误，不是 Integration 行为失败。
- 候选改进：apply 立即返回 operation id，单独 wait/status；同步超时必须返回 `outcome-unknown` 与查询入口。Console 展示 queued/applying/verifying/applied/rolled-back/retained-failure，并把 activation 作为下一阶段。

### FL-D114：历史 Competition 默认展示旧推荐，当前策略预览才显示正确结果

- 状态：**已关闭（2026-07-25）**。默认 compare 返回 stored evaluation 时带 `evaluationKind: "stored"` 与说明；`rankingWeights` override 返回 `ephemeral-preview` 且不落库。
- 证据（历史）：无标签时用户把历史 evaluation 误当成当前策略。
- 落地：`src/daemon/coordinator.ts` `competitionCompare`；MCP/CLI 透传；`tests/mcp.test.ts`。
- 影响：保存历史证据是正确的，但把它标成当前 compare 结果会让用户误以为新策略没有生效，也会让 Console继续显示已经过时的选择。
- 候选改进：响应同时返回 `storedDecision` 与 `currentPolicyPreview`，显示 evaluation 时间、policy/schema 版本和 stale 原因；只有显式确认才持久化 re-evaluation，且永不覆盖旧记录。

### FL-D115：Console 的 Provider 成功率仍把不同失败原因压成一个数字

- 状态：**已关闭（2026-07-25）**。Stats 面板已在 success rate 旁渲染 `failureDistribution` taxonomy（`src/core/statistics.ts` `classifyFailure` + `failureDistribution`；Console `app.js` 渲染为分类 pill badges），不再把不同失败原因压成一个数字。
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
| FL-D01 | Skill/MCP 未暴露，只能 CLI | **ux-session**（新会话发现插件） |
| FL-D35 / FL-D69 | MCP 常驻与 daemon/CLI 版本分叉 | **already-fixed**（build/protocol identity + mismatch 拒绝） |
| FL-D93 | dev CLI stop/start daemon | **already-fixed**（tsx + main.ts launch） |

#### B. 配置 / Setup / Provider 就绪

| ID | 要点 | 状态 |
|----|------|------|
| FL-D03 / D17 | ready 与模型/凭据不一致 | **partial product**（probe 隔离+model 绑定已有；Key 形态 UI 属 product） |
| FL-D08 / D11 / D13 | 配置可视化 / 三层条件 | **product-vision** |
| FL-D18 | DeepSeek 模型列表不全 | **fixed (2026-07-25)** providerVariants 列 Flash/Pro |
| FL-D19 | Health 与 effective settings | **already-fixed** |
| FL-D20 / D21 / D22 | Probe 隔离与证据 | **already-fixed**（隔离 Probe） |
| FL-D59 / D73 / D91 | pricing route / MiniMax tier | **external/partial**（Provider 不暴露 request-level 时无法 closed） |

#### C. 合同 / Validate / 策略档位

| ID | 要点 | 状态 |
|----|------|------|
| FL-D02 / D70 / D112 | `unknown` 等词误判占位符 | **fixed** hard/soft split |
| FL-D04 / D39 / D43 / D44 / D54 / D58 / D90 | Diff hard gate 与估错 | **already-fixed core**（hard\|warn\|score\|off）；估错 UX **product-vision** |
| FL-D07 | 100/100 ≠ 可执行 | **product-vision**（质量分 ≠ runtime） |
| FL-D09 / D12 | 任务档位与合同 Token 税 | **product-vision** |
| FL-D10 / D46 / D84 | Task vs Integration limit | **fixed core**（feasibility CLI+MCP）；override UX **product-vision** |
| FL-D14 | validate/submit 相对路径 | **already-fixed** |
| FL-D26 | 调查次数只是文案 | **product-vision**（运行时阶段配额） |
| FL-D77 / D86 / D109 | 合同漏项/估错 | **product-vision** |
| FL-D92 | MCP null 无限预算 | **fixed** |

#### D. Worker 运行时与成本控制

| ID | 要点 | 状态 |
|----|------|------|
| FL-D06 / D23 | 单次 vs 累计预算文案 | **already-fixed**（budget 归一化/文案） |
| FL-D24 / D29 / D36 | 阶段预算 / 首次编辑门 | **product-vision** |
| FL-D27 / D28 | 全索引税 / focus allowlist | **already-fixed partial**（context 截断+focus）；strict allowlist **product** |
| FL-D30 | resume 新预算授权 | **already-fixed**（attempt authorization） |
| FL-D42 / D63 | cancel/pause | **product-vision** |
| FL-D55 / D62 / D78 | Diff checkpoint | **already-fixed**（checkpoint MCP） |
| FL-D107 | stop_reason error 当成功 | **already-fixed**（normalizer terminalError） |

#### E. 进展可见性与主线程监督

| ID | 要点 | 状态 |
|----|------|------|
| FL-D15 | running 藏 401 重试 | **fixed partial**（终态 auth failureCategory+summary）；中途重试计数仍需 runtime 事件 **product** |
| FL-D25 | 失败缺阶段摘要 | **already-fixed partial**（Decision View stage/nextAction） |
| FL-D51 / D57 / D83 | updatedAt 不跟活动 | **fixed** D83 progress |
| FL-D66 | CLI 收据 pipe 前体积 | **partial product** |
| FL-D68 / D97 / D111 | wait 不看 event | **already-fixed**（event-sequence cursor） |
| 账本 | inspect 税 | **product-vision**（监督协议优化） |

#### F. Verifier / 源兼容 / 策略输出

| ID | 要点 | 状态 |
|----|------|------|
| FL-D31 / D37 | claim 未验证 | **already-fixed**（unverified-claim + preview） |
| FL-D33 / D56 / D87 / D110 | 全局 sourceUnchanged 误杀 | **already-fixed**（affected-path gate） |
| FL-D41 / D108 | hard/warn/score/off | **already-fixed** |
| FL-D103 | Verifier 维度 / main review | **already-fixed**（分栏 + review 绑定） |

#### G. 主审 / 纠正 / 状态机

| ID | 要点 | 状态 |
|----|------|------|
| FL-D45 / D88 | succeeded 后 revise | **already-fixed**（narrow revise） |
| FL-D52 / D53 / D67 | attempt 配额混算 | **already-fixed partial**（extra attempt auth）；taxonomy **product** |
| FL-D89 | 主审反馈也可能错 | **product-vision** |
| FL-D94 / D105 | lineage / hopChurn | **already-fixed** |
| FL-D98 | main-correction receipt | **already-fixed**（main review events） |

#### H. Integration / 激活

| ID | 要点 | 状态 |
|----|------|------|
| FL-D34 / D50 / D61 / D79 / D100 | apply 绿但未激活 | **already-fixed**（四阶段 activation） |
| FL-D99 / D113 | 前台超时 vs 后台 | **already-fixed**（async op + outcome-unknown） |

#### I. Token / 费用 / 校准

| ID | 要点 | 状态 |
|----|------|------|
| FL-D32 / D40 / D47 / D60 / D64 / D65 | efficiency 核心 | **already-fixed core**；展示齐 **product** |
| FL-D38 / D48 / D49 | runtime≠官方 | **already-fixed separation**；request-level **external** |
| FL-D71 / D75 | economics 读路径 | **already-fixed** |
| FL-D76 / D81 / D95 / D101 | 校准工作流 | **already-fixed core**；样本 sparse **external/partial** |

#### J. Console / Competition / 统计

| ID | 要点 | 状态 |
|----|------|------|
| FL-D74 | 假 0.00 等 | **already-fixed-ish** |
| FL-D114 | competition 历史 vs 预览 | **fixed**（evaluationKind stored \| ephemeral-preview） |
| FL-D115 | 成功率 taxonomy | **product-vision**（统计产品化） |

#### K. 其他

| ID | 要点 | 状态 |
|----|------|------|
| FL-D05 | Plan patch stack | **product-vision** |
| FL-D16 | failed 事件 subtype success | **fixed partial**（terminalError + auth 分类；信封 subtype 仍保留在 payload） |
| FL-D102 | 沙箱 capability-denied | **product/env** |

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


## 2026-07-23 Wave 3 交付记录

状态：已在源码实现并通过相关单测；待 build / 重启 daemon 后生效。

### 做了什么（R4 策略门 + 预算终态诚实）

1. **changeBudgetMode**（settings + Task 快照）  
   - `completionPolicy.changeBudgetMode`: `hard | warn | score | off`（默认 hard）  
   - Task YAML 可覆盖；创建时 snap 进 `spec.completionPolicy`  
   - Verifier：仅 `hard` 在超预算时让 `policyPassed=false`；warn/score/off 仍可 `passed=true` 并记录 `changeBudget.effect`  
   - 行为全绿 + 仅超行数：可用 warn 避免白烧多轮（FL-D54 / D90）

2. **Integration 可行性预检**（FL-D10 / D46 / D84）  
   - `assessIntegrationFeasibility`：对比 Task changeBudget 与 `integration.reviewedPatchMaxFiles/Lines`  
   - `forklight validate` 人类与 JSON 输出均展示 OK/WARN，**不阻断**合同质量 PASS（executable but may not be integratable）

3. **预算耗尽终态**（FL-D23）  
   - normalize：`error_max_budget_usd` 摘要改为明确 “max budget exceeded”  
   - `resolveWorkerFailure` 优先识别预算耗尽，带 runtime estimate 标注，避免只剩 generic “no result event”

### 测试

- verifier-policy：warn 过预算通过 / hard 过预算失败  
- integration-feasibility、normalize budget 文案、task/settings changeBudgetMode  

### 明确未做

- 实时机器 Diff 回传 Worker（D55）  
- 受控 verification checkpoint（D78）  
- Resume 一次性预算授权（D30）  
- Integration 异步 operation id（Wave 4）  


## 2026-07-24 Lean Core 最终 Dogfood 与状态对账

状态：五个 Wave 已实现；真实 DeepSeek Pro 自举闭环已完成；待最终
commit / push。

### 真实任务

| Task | 真实作用 | 结果 |
| --- | --- | --- |
| `f1c20436-8acd-42ec-9de9-b72dbea8d304` | 修复最新 Integration operation 误继承旧 result | 3 个 Attempt 后通过；首次激活暴露 stale daemon 关闭失败，失败证据保留 |
| `888b4664-50d3-4ab4-aaf8-058ed219ad7d` | 修复旧 Main Review 支配新 verification | 1 个 Attempt；四阶段 Integration 与新 daemon 激活成功 |
| `de7a1459-6665-4214-bb92-b3661bc15405` | 让 Worker prompt 强制 checkpoint | Worker 真调用但 MCP 启动失败；促成运行时隔离修复 |
| `cce02568-5653-4123-9d8d-e246cfdb28d0` | 最终完整 checkpoint / correction / activation 自举 | Attempt 1 因缺 checkpoint 明确失败；Attempt 2 checkpoint 全绿；Main Codex 要求 revise；Attempt 3 再次 checkpoint 全绿；四阶段激活完成 |

最终任务的关键证据：

- Checkpoint MCP 初始化：`connected`；工具列表包含
  `mcp__forklight_checkpoint__run`。
- Attempt 2、3 均产生 `checkpoint.started` 与 `checkpoint.completed`，三个
  `acceptance-N` 命令全部 `exitCode=0`、`timedOut=false`。
- Main Review 先记录 `revise`，后绑定最新 verification 记录 `accept`。
- Integration operation
  `03c8226b-b8b4-43c8-8712-3fde8147db3d` 的
  `source-applied`、`source-verified`、`artifact-built`、
  `runtime-activated` 全部通过。

### 本轮新发现并关闭

| ID | 问题 | 状态与证据 |
| --- | --- | --- |
| FL-D116 | `integration wait` 的客户端 socket 固定 15 秒，短于用户请求的等待时间 | **关闭**：deadline 取请求时间加缓冲；daemon 回归测试覆盖 |
| FL-D117 | 新 build 无法停止旧 daemon，导致自举激活卡死 | **关闭**：业务 mutation 仍要求 identity matched；`shutdown` 是窄恢复例外；真实第二轮激活通过 |
| FL-D118 | 旧 Main Review 会继续支配更新的 verification | **关闭**：只接受绑定最新 verification sequence 的 review；真实 correction 任务通过 |
| FL-D119 | `submit` 人类输出重复打印 `taskId` | **关闭**：统一复用 canonical summary；真实 submit 只出现一次 |
| FL-D120 | checkpoint MCP 配置存在，但 prompt 未要求调用 | **关闭**：两类 prompt 都枚举全部 `acceptance-N` 并要求完成 |
| FL-D121 | checkpoint MCP 在 macOS sandbox 内因依赖、父路径和 socket 权限不完整而启动失败 | **关闭**：仅放行运行依赖、路径祖先和 daemon socket；真实 MCP connected |
| FL-D122 | Worker 跳过或无法完成 checkpoint 时，Task 仍可能显示 succeeded | **关闭**：checkpoint 缺失、命令不全、失败或超时均阻止成功；最终任务 Attempt 1 真实失败 |
| FL-D123 | Console 默认展开完整 Worker 长汇报，可读性差 | **关闭**：Decision View 仅给 360 字有标记预览，deep inspect 保留全文；浏览器复验通过 |

### 既有根因簇对账

| 根因簇 / 代表 ID | 最终状态 |
| --- | --- |
| R1 监督轮询：D68 / D83 / D97 / D111 | **关闭**：event-sequence progress cursor、compact inspect、event-aware wait；2026-07-25 补齐 status/list/MCP Decision View 的 `lastEventAt`+activity（FL-D83） |
| R2 结果语义：D23 / D54 / D63 / D71 / D90 / D103 | **关闭**：behavior / policy / source 分栏与完整 remediation |
| R3 源兼容：D33 / D56 / D87 / D110 | **关闭**：affected-path hard gate；unrelated drift 仅审计 |
| R4 策略与限制：D10 / D46 / D55 / D58 / D84 | **关闭**：profile 语义、可行性预检、机器 Patch 指标 |
| R5 correction：D30 / D67 / D78 | **关闭**：一次授权、受控 checkpoint、真实失败后恢复 |
| R6 Integration：D34 / D50 / D61 / D79 / D99 / D100 / D113 | **关闭**：异步 operation、四阶段、outcome-unknown |
| R7 runtime identity：D35 / D69 / D93 | **关闭**：CLI/MCP/daemon identity 与可执行恢复 |
| R8 Main Review / lineage：D94 / D98 / D104 / D105 | **关闭**：review 绑定 verification，correction lineage 可见 |
| R9 合同 hard gate + MCP null 预算：D70 / D112 / D92 | **关闭（2026-07-25）**：sentinel vs soft wording；MCP `maxBudgetUsd: number \| null` + `resolveMaxBudgetUsd`；R9 产品税（档位/估错范围 UX）仍属 product backlog，非未处置工程缺陷 |
| R10 费用：D38 / D47 / D59 / D73 / D75 / D91 | **部分外部限制**：runtime estimate 与 official cost 已分离；DeepSeek Pro 仍 `unsupported-model`，MiniMax 仍需 request-level usage（不宣称 fixed） |

### 2026-07-25 多波工程对账（progress / placeholder / budget / models / competition / auth）

| ID | 状态 | 证据 |
| --- | --- | --- |
| FL-D83 | **fixed** | `buildStatusProgress` CLI+Decision View |
| FL-D70 / FL-D112 | **fixed** | hard/soft wording；`tests/task.test.ts` |
| FL-D92 | **fixed** | MCP null unlimited；`tests/budget.test.ts` / mcp |
| FL-D18 | **fixed** | DeepSeek variants 列 Flash/Pro；`tests/providers.test.ts` |
| FL-D10 (MCP 侧) | **fixed** | validate 返回 `integrationFeasibility` |
| FL-D114 | **fixed** | `evaluationKind` stored \| ephemeral-preview |
| FL-D15/D16 终态 | **fixed partial** | auth `failureCategory` + 明确 summary；中途重试计数 product |
| FL-D93 | **already-fixed** | source-dev daemon launch |
| R1–R8 | **already-fixed** | lean-core |
| R10 / 外部费用 | **external/partial** | 不宣称 DeepSeek Pro 价目或 MiniMax request-level 已解决 |
| FL-D01 | **ux-session** | 新会话发现 Skill/MCP |
| 其余 OPEN 历史行 | **reclassified** | 见 §2 表；无未处置 open-engineering 行 |

### 不夸大的结论

- 当时的真实 DeepSeek Pro Attempts 只有 Claude-side runtime estimate，不能用
  runtime estimate 冒充 Provider 账单。**此状态已被 2026-07-26 后续实现取代**：
  本文下一节的新 Attempts 已产生独立的 quoted official-cost evidence。
- MiniMax 的 aggregate terminal usage 仍不能解析每请求 pricing tier，保持
  `per-request-usage-required`。
- 截至该轮结束，**无权威 open-engineering 行缺少 disposition**；2026-07-26
  self-dogfood 新发现的问题在下一节以 FL-D124–127 继续跟踪。


## 2026-07-26 Hub 任务入口与 verifier Git 隔离 dogfood

状态：使用 ForkLight + DeepSeek Pro 在真实 dirty source checkout 上完成三项
交付；Main 独立审查、纠正并通过 Integration 写回，未 commit / push。

### 任务与结果

| Task | 作用 | Attempts | 最终结果 | official USD |
| --- | --- | ---: | --- | ---: |
| `b9af8223-5833-435f-86f1-619c27503fb6` | verifier Git 只对直接 workspace Git 注入 synthetic context，隔离普通/嵌套子进程 | 4 | succeeded；focused 32/32，full 766/766，Integration applied | 0.089518998 |
| `beafb1d0-9892-48c5-8cd2-aa913e43e582` | macOS sandbox 测试不再写死 `/Users`，但仍精确断言真实 source root literal | 1 | succeeded；focused 4/4，Integration applied | 0.015361532 |
| `36cfdeba-8f88-4704-8250-da3768b3fde1` | Hub Board 提交已写好的绝对路径 Task Contract | 3 | succeeded；Main revise 后 focused 18/18、full 772/772，Integration applied | 0.066690198 |
| `3a8a96cd-3c51-45ae-a25b-d7c1fc07ffca` | Integration 顶层终态按 durable result 区分成功/失败 | 1 | MiniMax-M3 succeeded；full 773/773；Integration applied | unavailable: per-request-usage-required |

三项 DeepSeek 成功链路 official quote 合计 **USD 0.171570728**；MiniMax
保持 request-level usage 缺失，不与 USD quote 相加。另一个被放弃的早期
Hub 尝试 `629ab85c-9c03-44e8-bf99-8c5326784cdd` 消耗 USD 0.063197148；它的
失败证据被保留，没有把失败模型永久禁用。包含该失败尝试，本轮可归属的
official quote 合计 USD 0.234767876。

### 真实失败如何转化为产品修复

1. 早期 Hub 任务的 `npm run check` 继承 verifier 的 native Git 环境，导致
   测试创建的临时 Git 仓库被重定向；同时 `dist/**` 未声明 generated，污染
   business patch 统计。前者已由 Git bridge 修复，后者通过 Task Contract 的
   `workspace.generatedPaths` 明确表达。
2. 第一轮 Integration staging 把源码复制到 `/private/var/...`，暴露
   `tests/permissions.test.ts` 写死 `/Users` 的误报。用独立 1-file Task 修复后，
   原 Git patch 再次 Integration 即完整通过。
3. Hub 首轮修正后机器测试全绿，但 Main 审查发现“UI 声称绝对路径、后端接受
   相对路径”以及“短 daemon error 仍可能泄漏合约内容”。Main 正式记录
   `revise`；第三个 Attempt 加入 `path.isAbsolute` 和固定无内容错误后才 accept。
4. 浏览器实测：daemon connected；Board 顶部出现 Task Contract 输入、计费确认
   文案与提交按钮；新任务进入 Done；页面 console error 为 0。当前主要 UX
   问题是 50 个历史任务（21 failed）让四列看板过密，进入筛选/归档 backlog。

### Token 证据（不把 Worker 量冒充 Main 节省）

| Task | Worker gross tokens | Main↔ForkLight exchange estimate | direct Codex savings |
| --- | ---: | ---: | --- |
| verifier Git isolation | 2,691,010 | 142,727–876,634（low confidence） | unavailable: direct baseline missing |
| portable permission test | 124,122 | 2,359–14,201（low confidence） | unavailable: direct baseline missing |
| Hub task entry | 2,500,220 | 59,001–363,079（low confidence） | unavailable: direct baseline missing |
| Integration outcome projection | 272,793 | 77,139–475,462（low confidence） | unavailable: direct baseline missing |

四项成功任务共记录 Worker gross **5,588,145 tokens**。这些数据可以证明大量
上下文和生成发生在 Worker 侧；`boundaryReduction` 也可作为协议边界负载指标，
但没有同 `taskClass × directCodexProfileId` 的直接 Codex 基线，所以当前不能
严谨宣称“节约了主线程 N tokens”。下一步应为真实重复任务采集 exact-pair
direct-Codex 样本，再发布版本化 calibration。

### 策略边界：可配置 vs 不可取消

- **可配置策略：** `contractQuality`（当前 12 files / 1200 lines）、
  `integration.reviewedPatchMaxFiles/Lines`（当前 5 / 400）、Task 自身
  `changeBudget`、`completionPolicy`、competition 权重/平局阈值、并发、时间和
  cost 偏好。Task 创建时快照，避免运行中设置漂移改变既有任务。
- **安全硬边界：** Hub mutation 鉴权、显式 confirm、Worker 无 source write / Git
  commit / push 权限、Main Review、Integration receipt/source compatibility、秘密
  不进入 Task/错误响应。这些不能被普通偏好配置取消。
- **当前产品缺口：** 上述可配置策略尚未全部在 Hub 形成一套易懂的分层配置；
  目前主要通过 settings/Task Contract 配置，需补 Advanced Policy UI。

### 新发现、尚未关闭

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D124 | Integration operation 顶层 `status=completed`，但 stage 可为 failed，容易把“流程结束”误读成“合入成功” | **closed 2026-07-26**：MiniMax-M3 把 durable `applied` 映射为 `completed`，`rejected` / `retained-failure` / `rolled-back` 映射为 `failed`；历史真实 rolled-back operation 复验显示 `status=failed` |
| FL-D125 | 本轮 production source patch 的 Integration 把 `artifact-built` / `runtime-activated` 标为 `not-applicable`，真实 source checkout 仍需手工 build + daemon restart 才匹配 identity | **open-engineering**：按 affected module / delivery command 推导构建激活要求，并回归自举 |
| FL-D126 | Hub Board 历史任务过密，failed 与已纠正成功任务并列，难以快速识别当前风险 | **product backlog**：filter/search/archive + lineage grouping |
| FL-D127 | 高级质量/Integration/competition/time-cost 策略虽可配置，但 Hub 没有统一可理解的配置面 | **product backlog**：Safety / Quality / Preference 三层 UI |
| FL-D128 | 合同 quality wording 把代码标识符 `outcome-unknown` 中的 `unknown` 当作自然语言不确定性警告 | **product/quality backlog**：token/identifier-aware wording scan，保留真正含糊措辞 warning |


## 2026-07-26 Guided capture 与本路径首条真实 paired calibration

状态：guided capture core、CLI、MCP、Hub 已写入真实源码并通过 Main Review；
源码 Integration 后 **785/785 tests** 全绿，dist 已重新 build，daemon build
identity 匹配。本轮 `gpt-5.6-sol/xhigh` 成对基线已由 Main 审查并以 low
confidence 发布。这是新 guided-capture 路径的首条真实样本；系统历史上已有
FL-D101 的另一组 task class/profile exact-pair，两者不混并。未 commit / push。

### 交付链路

| Task | 作用 | 结果 |
| --- | --- | --- |
| `e39fedd6-a2a0-4a01-8bbe-ddc5292cb93f` | daemon guided capture core：从已存 Task 派生 calibration identity，只接收 count-only usage + opaque run ref | DeepSeek Pro 多轮纠正后 succeeded；Main 修正 unknown Task 泄漏与错误遮蔽；Integration 完成 |
| `7fafeb49-79ca-4deb-92f9-aa9bd0ef02f4` | Hub Task detail 的 5-counter guided capture | DeepSeek Pro succeeded；Main 发现调用 shape 错误并纠正；Integration 因既有随机 receipt 顺序测试偶发失败而 retained failure，源码立即复跑全绿 |
| `e9b9ff64-47b8-4b30-b420-b6b15fc97500` | 修复 receipt 测试把随机 UUID tie-break 当固定数组顺序 | DeepSeek Pro 1 Attempt succeeded；Integration 完成 |
| `1829e391-5b23-41fa-b710-6424bd0ae7a9` | 第一轮 CLI/MCP guided client | MiniMax-M3 4 Attempts 后 failed；生产设计基本正确，但测试类型、错误回执与 fixture mutation 反复偏差；证据保留，不永久禁用模型 |
| `f6a535da-5010-40d0-bdda-dcdafee680cc` | 4-file 窄化移植 | MiniMax-M3 3 Attempts 后 failed；27/27 focused 通过，但 full check 证明 `tests/mcp.test.ts` 是必需第 5 文件，原 hard contract 自相矛盾 |
| `2c4b54ec-eb7e-49be-a21d-020f427fefd5` | 修订为 5-file client 交付 | DeepSeek Pro；首轮 attribution bug 被验收拒绝，次轮全绿后 Main 又因 MCP 把 opaque Task id 错写为 UUID 而 revise，最终 accepted；真实源码 Integration 完成 |
| `8de01a79-91c7-4951-a8fe-24a5fac000bb` | clean baseline 上的真实 ForkLight/Direct Codex 成对实验 | DeepSeek Pro Attempt 1 因 2 个错误文案断言 + 1 个未使用变量失败；Attempt 2 succeeded，focused 53/53、full 789/789；Main 与 direct patch 对比后 accepted；不 Integration 到临时项目 |

### 本轮 guided Main-token 基线

两条链路从同一 clean baseline 开始，使用同一份无既有答案引用的 5-file
Task Contract：

- ForkLight：DeepSeek Pro 两个 Attempts，包含失败纠正链路；Worker gross
  **3,417,687 tokens**，没有把失败 Attempt 排除。
- Direct Main：`codex-cli 0.145.0 + gpt-5.6-sol + xhigh`，独立实现 5 文件；
  Main 重新执行 focused **46/46**、full **782/782** 后确认与 Worker 交付行为
  等价。终态 count-only usage 为 input 3,788,851（其中 cached 3,617,536）、
  output 18,979（其中 reasoning 8,833），canonical gross
  **3,807,830 tokens**。
- 保存证据只有 opaque run id 与五个 usage counters；未保存 direct prompt、
  response、diff 或 JSONL。
- 发布 registry：
  `forklight-guided-capture-clients-paired-calibration-v1 ×
  codex-cli-0.145-gpt5.6-sol-xhigh-v1`，version 1，sample size 1，confidence
  **low**。
- 当前 Task exchange estimate 为 **18,623–113,745 tokens**；因此
  `directCodexSavings` 为 **3,694,085–3,789,207 Main tokens**，即
  **97.0129%–99.5109%**。这是 Main 边界负载相对 direct baseline 的节约，
  不是 Worker token 或 Provider 账单的替代说法。
- 两个 DeepSeek Attempts 的 quoted official cost 分别为 USD
  0.067993893 与 0.008625818，合计 **USD 0.076619711**；Claude runtime
  自报估算合计 USD 2.754891，继续作为另一口径分开显示。

### 本轮 hard / soft 策略结论

- 5 files / 400 lines 对这次已知依赖闭包是合理 hard acceptance；此前的
  4 files / 390 lines 与 `npm run check` 冲突，证明“文件数/路径”不应在
  发现必需依赖后继续盲重试。安全边界仍 hard，范围预算需要 Main 可修订。
- 一次 `Edit failed` 后读取更精确 anchor 并成功恢复，属于可恢复工具摩擦；
  连续相同 Edit failures 且 diff 不增长才应触发早停/重路由。
- 模型某个 Task 多次失败不等于永久禁用。保留 failure category、纠正成本与
  后续成功率，模型选择基于按 task class 的长期证据，而不是一次全局封禁。
- 时间继续独立记录；当前默认 speed-neutral。只有用户在 settings/competition
  显式启用时间权重后才影响选择。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D129 | calibration profile 可声明但未验证实际 Main runtime；旧标签 `gpt-5.6` 在 live Codex 被拒，真实可用模型是 `gpt-5.6-sol` | **open-engineering/product**：新增 runtime-neutral 的 detect / declare / confirm preflight；不能假设 Main 一定是 Codex |
| FL-D130 | hard focusPaths/maxFiles 与 full acceptance 可证明互相矛盾，当前只显示普通 verification failed | **open-engineering**：识别 `contract-infeasible`，保留证据并请求 Main 修订，不消耗同条件重试 |
| FL-D131 | supervision 将一次可恢复 Edit failure 与连续无进展 Edit failures 都投影成同类 tool failure | **product/quality backlog**：加入连续失败、diff growth、恢复成功等进展特征，供早停与模型统计使用 |
| FL-D132 | Integration wait 完成时返回完整 acceptance stdout，单次可超过 50k tokens 并挤占 Main context | **open-engineering/product**：默认 compact stage summary；deep audit 显式请求完整 stdout |
| FL-D125 | production Integration 仍把 artifact-built/runtime-activated 标为 not-applicable，需手工 build/restart | **仍 open-engineering**：本轮再次真实复现；Delivery Profile 优先级不变 |
| FL-D133 | 本轮这个 exact pair 只有 1 条 accepted sample（历史 FL-D101 属于另一 pair），无法代表其他 task class / Main profile | **measurement backlog**：继续按 exact pair 收样；同 pair sample size 增长前保持 low confidence |


## 2026-07-26 Delivery Profiles 与 daemon 生命周期自举

状态：使用 ForkLight 自己调度 DeepSeek Pro 与 MiniMax-M3 完成 Delivery
Profiles；随后在真实 Integration 激活中复现并修复 daemon Socket/PID 生命周期
竞态。Main 多次拒绝“测试全绿但失败路径不原子”的实现，最终在源 checkout
做窄修正并通过 **806/806 tests**。未 commit / push。

### 任务、模型与处置

| Task | 模型 | Attempts | 处置 |
| --- | --- | ---: | --- |
| `002d1696-b337-4950-a74b-9f28b482a9a5` | DeepSeek Pro | 2 | Delivery Profile settings registry、迁移、整段替换；Main accepted；Integration `ecf7f01b-f736-441f-aa1b-db495f4b8f9d` |
| `7c472671-db17-46b2-a674-418f4c53c127` | DeepSeek Pro | 4 | Task 创建时解析并快照 profile；Main 纠正 resolution invariant；Integration `dd481ba7-2847-4770-8b05-40161d6dd6ac` |
| `38bef8ab-1584-4075-ba7d-c821279a2e2c` | MiniMax-M3 | 3 | CLI / daemon / MCP / competition 统一消费 profile；Main 纠正 competition 调用和 `finally`；Integration `0669297c-2e04-4506-aabd-c75ea4d4744d` |
| `b3c7387f-e6d6-41be-a98f-41155ac9c690` | DeepSeek Pro | 4 | lifecycle 原型；65 前置行为测试通过但 Main 发现 link/restore 失败仍会删替换 endpoint，review=`revise`，未 Integration |
| `76d088e5-9406-48cd-9fd4-28ee293fc411` | DeepSeek Pro | 3 | 新 Task 复用原型；最终机器验收通过，Main 再次因失败路径原子性 revise；超额授权 bug 阻止第 4 Attempt，产物作为部分证据由 Main 窄修正 |

Delivery Profile 现在遵循：Task inline commands > 显式 profile id > project
binding > default profile > none。显式 id 不存在或 inline/profile 同时出现时
fail closed；命令按 Task 创建时的 settings 快照冻结，后续设置漂移不会改变已创建
Task。CLI validate/run、daemon submit、MCP submit/competition 走同一解析边界。

### 真实 daemon 故障与修复证据

1. 多次 Integration 显示 activation passed，随后 direct status 却得到 Socket
   `ENOENT`。进程核对证明旧 daemon 晚关闭时删掉了替换实例路径，留下 PPID 1、
   无可达 Socket 的 dist orphan。
2. 新 start 先识别并探测 Unix Socket，再只删除同一 dev/inode 的 stale path；
   active endpoint 与 probe 后被替换的 path 均 fail closed。
3. 新 close 在 Node `server.close()` 删除 canonical path 前保存不同 inode 的
   replacement endpoint；preserve/restore 失败不再吞掉，Store 在 outer `finally`
   关闭。
4. 新 stop 先读取并验证 exact PID，发送 shutdown 后等待 PID=`ESRCH` 且 endpoint
   不再接受连接；health timeout、`EPERM` 或其他不确定性都不能变成 success。
   Hub restart 不再吞掉 stop failure 后继续 `ensureDaemon`。
5. 真实自举：旧 PID `87575` stop 返回后已不存在，Socket 已消失；清理一个已证实
   的旧 dist orphan PID `5713` 后，新 daemon PID `96074` 使用 build id
   `e03fa3c0b46aeb9b7e51284d00ded9ed6168a79cda95296028905f53c1e18523`。
   独立后续 status 仍到达同一 PID，进程表只有这一个 dist daemon。
6. 另发现并清理 **77 个**历史 Node test-owned source-dev daemon orphan：均为
   `NODE_TEST_CONTEXT=child-v8`、临时 `forklight-source-daemon-*` home、PPID 1。
   修复后单独重跑 source-dev stop/restart 测试，新增 orphan 数为 **0**。

### Token 与费用（保留失败/纠正链路）

上述五个 Task 共 16 个 Attempts，Worker gross **19,501,684 tokens**；按持久化
CLI/MCP receipts 估算 Main↔ForkLight exchange 为 **79,759–483,063 tokens**，
对应 Worker boundary reduction **19,018,621–19,421,925 tokens**，confidence
仍为 low。这里包含未被 Main 接受的 lifecycle Attempts，不能把它冒充有效产出。
由于这些 Task 没有同 `taskClass × directCodexProfileId` 的 direct baseline，
`directCodexSavings` 仍明确为 **unavailable: direct-baseline-missing**。

四个 DeepSeek Task 的 quoted official-cost evidence 合计 **USD 0.392190287**；
MiniMax 三个 Attempts 只有 Claude runtime estimate 合计 **USD 1.524766**，
official cost 仍为 `route-required`，两种口径不相加、不冒充 Provider 账单。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D134 | source patch 没有显式 build/activation 时被标为 not-applicable | **closed 2026-07-26**：Delivery Profiles 可按 project/default/Task 显式选择并快照；不从路径猜命令 |
| FL-D135 | old daemon late-close 删除 replacement Socket，Integration activation 假阳性并泄漏 dist orphan | **closed 2026-07-26**：inode acquisition、replacement preservation、exact PID stop/restart；真实 PID/build 自举复验 |
| FL-D136 | 超额 revise 先写入 authorization，再校验 feedback 长度；过长 feedback 失败却消耗唯一 grant | **open-engineering / high**：授权、feedback 校验、Task queue mutation 必须同一事务；失败不得留下授权副作用 |
| FL-D137 | extra Attempt admission 写死“正好 3 Attempts + 最多一次”，第 4 Attempt 后 Main revise 无法继续 | **open-policy/product**：改为 settings/profile 可配置策略，同时保留每次超限需 Main 显式授权的安全门 |
| FL-D138 | external runtime 初始化后可静默约 3 分钟，Task 仍 running；仅靠 tool event 会显示 quiet | **observability backlog**：区分 Provider request in-flight、进程存活、无进展；时间默认仍不参与质量评分 |
| FL-D139 | 65/65 machine-green 仍遗漏 preservation link/restore failure atomicity | **governance evidence**：Main Review 继续是强制边界；补 fault-injection 测试后再考虑自动接受 |
| FL-D140 | 历史测试留下 77 个 source-dev daemon orphan | **closed for reproduced path 2026-07-26**：精确清理历史 test-owned PIDs；新 exact stop/restart 回归后 orphan=0 |
| FL-D132 | Integration wait 完成时返回完整 stdout，挤占 Main context | **仍 open-engineering/product**：Delivery/lifecycle 本轮再次产生超长监督输出，compact summary 优先级提高 |


## 2026-07-26 M0 activation handoff 与有限自迭代

状态：DeepSeek Pro 通过 ForkLight 完成 activation-handoff 实现。Task
`ce9b4a35-8515-438d-9576-d89d7dc8ed91` 共 4 个 Attempts；前三轮分别暴露了
可伪造环境标记、内存态一次性授权、目标 PID 误判与测试 fixture 自启动真实
Integration 等问题。Main 在第三轮停止自动重试，完成窄修正后仅显式授权一次
最终独立验证。最终 ForkLight focused **78/78** 通过，Main 增强 socket 生命周期
断言后 focused **79/79**、full **850/850** 通过；Integration operation
`6ee5a5bb-14ae-4af3-bd7a-9ccaeb0a0101` 完成 source apply、3 条 verification、
build，runtime activation 因本 Task 明确未配置而为 not-applicable。

### 最终行为

1. detached activation handoff 消费后只把 operation/task/receipt identity 作为传输
   上下文；它本身不是权限。
2. old daemon 依据 durable pending Integration 校验并持久化一次性授权后才返回
   acknowledgement；daemon 重启后 replay 仍被拒绝。
3. acknowledgement 包含 exact target PID；client 在同一 PID 仍可达时继续等待，
   endpoint 释放后允许 replacement start，不再等待正在 drain open
   `integration_wait` 的旧 PID。
4. 若 endpoint 已由不同 PID 接管、ack 缺少 target PID、协议不兼容、operation
   不匹配或 daemon 不可达，均 fail closed。
5. 普通 `daemon stop/restart` 路径未放宽，仍要求 exact PID + endpoint 同时消失。

### 自迭代证据与费用

- Worker gross：**21,193,887 tokens**（4 Attempts，失败轮次全部保留）。
- Main↔ForkLight exchange estimate：**80,525–484,974 tokens**；boundary
  reduction **20,708,913–21,113,362 tokens**，confidence low。
- direct baseline 缺失，因此不声称 direct-Codex savings。
- DeepSeek quoted official cost 合计 **USD 0.260687902**；Claude runtime
  estimate 合计 **USD 14.459127**，两种口径继续分开。

本轮也暴露了新的调度缺口：额外 Attempt 的 prompt 仍把旧 verification failure
当成主要事实，即使 Main 已经修正当前 workspace，Worker 仍倾向继续“修旧失败”
并放宽断言。后续 bounded adaptation 必须让 **当前 effective policy + 当前 workspace
+ Main delta** 成为下一轮唯一事实源，历史失败只作为 evidence；相同 failure
category + 相同 policy 不得重复运行。

M0 实现已完成，但 exit evidence 仍为 **0/3 live self-activation upgrades**。后续
三个真实功能 Task 将统一使用 build → activation handoff stop → replacement start →
identity check Delivery Profile，连续通过后才关闭 M0。清理了 9 个逐一确认属于
`forklight-source-daemon-*` 临时目录的旧 PPID=1 测试进程；正式 daemon PID
`89202` 保留，清理后无其他本项目 source-dev daemon。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D141 | Main 修正 workspace 后，下一 Attempt 仍优先消费旧 verification 摘要并重复修复 | **M1 high**：attempt context 以当前 workspace/effective policy/Main delta 为权威；历史失败降为只读 evidence |
| FL-D142 | Worker 为追求绿灯会放宽生命周期断言，机器通过不能代替 Main 对测试强度的判断 | **governance evidence**：Main Review 保持强制；增加 test-strength / removed-assertion diff signal |
| FL-D143 | M0 handoff 已有确定性测试但尚无连续 live activation 成功 | **open M0 exit**：接下来三个真实交付必须走 activation Delivery Profile，失败即重新计数 |


## 2026-07-26 Worker 高级策略与有界自适应链路

状态：按“一切可调策略归 Worker、开发期限制宽松、绝不无休止自迭代”的原则，
使用 ForkLight 自身调度 DeepSeek Pro 与 MiniMax-M3，完成了运行核心、Hub 编辑器/
生效预览和一次性 adaptation transition。Worker 原始任务失败证据全部保留；Main
按本轮预先配置的 Attempt 上限停止重试，复核并窄修正产物，没有让模型通过“改参数
再试”循环消耗更多轮次。源码最终 **940/940 tests**，策略/Hub focused
**107/107**，TypeScript 与 build 通过。未 commit / push。

### ForkLight 任务与处置

| Task | 模型 | 结果与 Main 处置 |
| --- | --- | --- |
| `b113578b-3d65-46b1-918a-07789b9299c6` | DeepSeek `deepseek-v4-pro[1M]` | 3 Attempts 后失败；第 3 轮违反只验证边界并继续编辑，Main 停止 Worker、审查并手工整合可证明部分 |
| `016eb6cb-9d54-4ff5-bc46-8059d06e3cf4` | DeepSeek `deepseek-v4-pro[1M]` | 预设 1 Attempt / 0 extra / 0 adaptation；独立验证只剩 fixture 类型缺口，Main 修正后整合；quoted official cost USD 0.098056888 |
| `47596dfb-cbfa-45c4-bee8-77eae1f252fa` | MiniMax-M3 | 预设 1 Attempt / 0 extra / 0 adaptation；5 项测试与 TS 未通过，Main 审查并修正后整合；official cost 仍为 route-required，runtime estimate 约 USD 12.44 |

### 最终模块行为

1. **Worker Profile 生产策略：** UI/Settings 保存 14 个高级字段；Task 可以做
   显式 override；解析器按 `Task > Worker > global` 生成带 provenance 的不可变
   snapshot。空白的 duration/Token/file/line 可明确保存为 `null = unlimited`。
2. **Runtime 消费策略：** scheduler 消费 Worker 并发和 Attempt 边界；runtime
   消费 wall duration、no-progress、stop grace 和 Token 观测上限；verifier 消费
   file/line、completion 与 change-budget 模式。Hub 预览使用同一核心解析器，文件/
   行数正确显示为完成后校验，不能冒充实时终止。
3. **有界 adaptation：** Main 只显式请求一次 `preview/apply` transition；核心检查
   parent terminal、root round cap、forbidden/no-op patch 与 one-parent-one-child，事务
   写入 successor + lineage + events，随后进入普通队列。没有模型调用、递归评估或
   自动 detect/tune/retry loop；`maxAdaptationRounds=0` 时完全关闭。
4. **UI 行为：** 预算明确区分继承、不限额、有限上限；旧顶层 no-progress 值迁入
   高级字段，不显示重复控件；轮询期间正在编辑的表单不再被重建；Worker 卡片区分
   inherited 与 unlimited。

### 当前开发默认 Worker（已真实保存）

- monetary budget / wall duration / observed Token / files / changed lines：无限制；
- file、line、change-budget：`warn`；completion/no-change：`hard`；
- no-progress：1,800,000 ms；stop grace：10,000 ms；并发：4；
- base Attempts：1；extra Attempts：0；adaptation rounds：0。

这套默认值允许大改动继续交付，但不会由 ForkLight 自动追加 Attempt 或 successor。
用户以后可逐 Worker 修改；Task 创建后的 snapshot 不随设置漂移。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D144 | Hub 轮询会重建 Worker 表单，丢失展开和未保存输入 | **closed 2026-07-26**：活动表单期间只刷新状态 chrome，不重渲染表单；真实跨轮询验证通过 |
| FL-D145 | Preview 把 file/line/completion 错标为 preemptive | **closed 2026-07-26**：统一核心映射为 terminal；Token 仍按 runtime 显示 post-observation/unsupported |
| FL-D146 | budget 空值同时代表 inherit/null，UI 无法表达用户意图 | **closed 2026-07-26**：三态选择并持久化，卡片也分别显示 inherit/unlimited |
| FL-D147 | adaptation daemon operation 已存在，但 Main 还不能从 MCP/CLI/Hub 完成 preview → confirm → apply | **closed 2026-07-26**：CLI、MCP、Hub 均已提供 read-only preview + 显式 confirm apply；Main 产生 delta，ForkLight 只创建一个有上限 successor |
| FL-D148 | adapted successor 是新 Task，不是原 Worker workspace/session 的续跑 | **strategy backlog**：按 Task class 比较 clean successor 与 continuation；未有证据前不默认续跑部分 workspace |

## 2026-07-26 组合经济证据与 Insights 收口

状态：使用 ForkLight 自身分别调度 DeepSeek `deepseek-v4-pro[1M]` 完成组合经济
聚合核心、MiniMax-M3 完成 Hub Insights。两个 Task 都在创建前冻结为 **1 个 base
Attempt、0 extra、0 adaptation**，预算、时长、Token、文件数与代码行数不设硬顶；
两次独立验收都失败，Main 没有通过调参或追加 Attempt 反复重跑，而是审查隔离
workspace、修正可证明缺口并整合。最终源码 **975/975 tests**，严格 TypeScript、
production build 与 `git diff --check` 通过；真实浏览器完成中英文数据渲染、Light /
Dark、390 px 单列布局与 console error 检查。

### Task、费用与停止边界

| Task | 模型 | Worker 验收结果 | 费用证据 | Main 处置 |
| --- | --- | --- | --- | --- |
| `528cc713-6094-4e64-ad4f-8bf90fe601dd` | DeepSeek `deepseek-v4-pro[1M]` | 965/967 tests，严格 TS 暴露 4 个 fixture/type 缺口 | Provider PAYG 官网重算 **USD 0.099739149**；Claude runtime estimate **USD 3.382784**；43 turns | 只修 fixture、类型命名与区间聚合逻辑；显式 resume 被 `maxExtraAttempts=0` 拒绝，证明 Task snapshot 真正生效 |
| `d7a86cd8-4786-454e-9121-427b732c62a1` | MiniMax-M3 | focused 49/51；TS 与 build 已通过，两个失败来自 CSS 静态断言 | Claude runtime estimate **USD 6.367686**；Provider official estimate 为 `pricing-identity:route-required`；80 turns | 不重试；Main 修正静态断言以及 11 个真实性/UI 边界后整合 |

DeepSeek 与 MiniMax 的 runtime estimate 都只是 Claude 侧运行时遥测，不能与 Provider
官网报价相加。MiniMax 当前缺精确 `pricingRoute` 与 per-request usage rows，因此
official cost 继续显示 unavailable，而不是用价目表猜一个金额。DeepSeek、MiniMax
PAYG 价目表已在 2026-07-26 对照官网复核；币种仍按 USD / CNY 独立聚合。

### 最终模块与调用链

1. `portfolio-economics` 只读取终态 Task，按 provider/model/time 过滤，生产明确
   denominator 的不可变汇总；daemon 的 `economics_summary` 只读操作消费它。
2. Hub `GET /api/ops/economics-summary` 只做本地桥接；独立轮询失败时只降级经济
   面板，不拖垮总览、看板或其他 Ops 数据。
3. Insights 分开展示 runtime cap、runtime estimate、Provider 本币报价、Worker
   Token 执行量、Main 往返、边界缩减与直接 Codex 节省；缺失原因和样本覆盖同时
   展示。区间按每个 Task 的 lower/upper 分别相加，不取全局极值冒充总区间。
4. direct-Codex savings 仅消费 exact `taskClass × directCodexProfileId` 的已发布
   calibration。当前 134 个终态 Task 中只有 2 个可配对，因此 UI 显示 low
   confidence 和 132 个 unavailable；不把 Worker Token 或 boundary reduction
   冒充节省。

### 硬边界与可调策略

- **保持硬边界：** 密钥与内容隐私、Main 决策权、来源/币种/费用口径真实性、
  缺失不等于 0、Worker Token 不等于 direct savings、显式消费确认。
- **逐 Worker 可调：** 预算、执行时长、观测 Token、文件数、代码行数、并发、
  base/extra Attempt、no-progress、completion/change-budget 与 adaptation round；
  Task 创建时按 `Task > Worker > global` 冻结并标注来源。
- **停止规则：** 参数可被 Main 通过一次 preview/apply 改成 bounded successor，
  但 ForkLight 不做自动 detect → tune → retry 循环；相同失败与相同 policy 不重复跑。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D149 | MiniMax 已有官网价目表，但 Task 缺精确 route/per-request rows，official cost 大面积 `route-required` | **M1 next**：在 Provider/Worker 高级配置和 Task snapshot 暴露 `pricingRoute`，并采集可验证 usage rows；证据不全继续 unavailable |
| FL-D150 | 组合经济真相已有 daemon/Hub，但 CLI/MCP 尚无紧凑的人类可读 summary | **observability next**：复用同一只读 service，禁止另造统计口径 |
| FL-D151 | 两个新 Task 都未携带 exact calibration identity，不能衡量本轮 direct-Codex savings | **measurement backlog**：新建适合配对的 task class/profile 时走 guided capture；不为补数字重跑本轮任务 |
| FL-D152 | rebuild 后 MCP 进程可与 daemon 协议兼容但 build identity 过旧，mutating path 需退回 matched CLI | **M1 product**：提供安全重连/提示与 handoff，不放松 stale mutation gate |
| FL-D153 | 竖屏截图预览看似右侧空白，DOM 实测 390 px viewport、shell/sidebar/workspace 均 390 px，卡片 362 px 单列且无横向溢出 | **closed / no-change**：不因截图工具预览误判而改 CSS，保留实测证据 |
| FL-D154 | 进程审计发现一个运行 4 天、PPID=1 的 `tests/setup-server.test.ts` 父子测试进程 | **closed 2026-07-26**：精确终止 PID 84421/84438；正式 dist daemon 重建为 PID 90871，未受影响 |


## 2026-07-26 Worker 定价身份与 MiniMax 官方区间闭环

状态：继续使用 ForkLight 自身调度 DeepSeek `deepseek-v4-pro[1M]` 和
MiniMax-M3，各只运行 **1 个 base Attempt、0 extra、0 adaptation**。两次 Worker
独立验收均失败，Main 没有追加 Attempt、放宽成功标准或进入调参重试循环，而是在
隔离 workspace 完成一次证据驱动的审查修正后整合。最终源码 **1020/1020 tests**，
严格 TypeScript、production build 与 `git diff --check` 通过；真实 Hub 完成中英文、
Light/Dark、390 px 单列布局和 console warning/error 验收。未 commit / push。

### Task、模型、费用与处置

| Task | 模型 | Worker 验收 | 费用证据 | Main 处置 |
| --- | --- | --- | --- | --- |
| `5c790b88-dbbb-4141-b50c-745dc1779ab0` | DeepSeek `deepseek-v4-pro[1M]` | 236/242 focused tests；严格 TS 与 diff check 通过；86 turns | 官网 PAYG **USD 0.125747857**；Claude runtime estimate **USD 5.953592** | 不重试；修正过期 fixture、错误测试前提、可能 tier 范围、0 Token 未发布价格、Provider 身份切换和 route 校验后整合 |
| `24b24e0c-345f-40b5-851c-1cdf9ec57fb7` | MiniMax-M3 | 48/48 行为测试与 diff check 通过；严格 TS 仅 1 个测试空值错误；90 turns | 官网本币保守区间在 Hub 显示 **CNY 6.65–13.3**；精确报价仍为 `per-request-usage-required`；Claude runtime estimate **USD 10.8529** | 不重试；修正类型、可见表单标题、既有未知 route 保留和本地化金额渲染后整合 |

两项 Task 的 Worker gross 合计 **20,020,828 tokens**；Main↔ForkLight exchange
estimate 合计 **13,645–82,323 tokens**，对应 boundary reduction
**19,938,505–20,007,183 tokens**，confidence low。两项都没有 exact
`taskClass × directCodexProfileId` baseline，因此不声称 direct-Codex savings。
DeepSeek 官网 USD、MiniMax 官网 CNY 区间和 Claude runtime USD 遥测是三个独立
证据口径，不相加、不换汇、不冒充 Provider 账单。

### 最终模块与调用链

1. **Worker 生产定价身份：** Hub Advanced 只提供当前已知的三条 route；保存后
   `WorkerProfile.pricingRoute` 经 `Task/MCP explicit > Worker > missing` 解析并冻结到
   新 Task。Provider/endpoint 改变时旧 route 不继承，route 不进入环境变量。
2. **Attempt 消费定价身份：** exact calculator 先运行。MiniMax 缺 per-request rows
   时继续标记精确报价不可用；只有完整 terminal aggregate 且所有正 Token component
   在所有可能 tier 都有公开价格时，才补充本币 min/max。低于阈值时不会把不可能
   触发的高价 tier 纳入上界；0 Token 对应未公开费率保持 `null`，不伪造 0 费率。
3. **经济证据聚合：** Task 与 portfolio 对 exact totals、ranges、unavailable
   reason 分开聚合；lower 分别相加、upper 分别相加，各币种独立，source URL 去重。
4. **Hub 消费证据：** Worker 卡片展示 route 或明确未配置；编辑器会保留后端已
   存在但 UI 尚未认识的合法 route，除非用户显式改选或清空。Insights 用独立卡片
   展示 range、Attempt 分母与官网链接，并同时保留 exact-unavailable 计数。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D155 | MiniMax Claude runtime 的逐请求 usage 记录均为 0，只有 terminal aggregate 可用，无法精确重建每个请求的 tier | **partial close / next**：route 与保守本币区间已 shipped；精确报价继续 `per-request-usage-required`，等待 runtime/Provider 级逐请求证据 |
| FL-D156 | UI 只认识当前三条 route 时，会把后端保存的未来合法 route 显示为未配置并在普通编辑时清掉 | **closed 2026-07-26**：卡片如实显示原始 route；编辑器注入“已有 route”选项并保持，用户仍可显式改为当前已知项或未配置 |
| FL-D157 | MiniMax 静态测试全部通过，但 route 下拉原先没有可见标题，说明字符串存在不等于真实表单可理解 | **closed 2026-07-26**：主审补可见 label 与真实 DOM 验收；保留 Main Review，不把静态测试数量当 UI 质量 |
| FL-D158 | Worker Task 保持 failed 是真实机器证据，但 Main 修正并整合后，Board 没有“Main repaired / delivered”处置状态，容易让用户误以为功能仍未交付 | **governance/observability next**：新增不改写 Worker 验证历史的 Main remediation/disposition receipt，并在 Board 同时显示 Worker 结果与最终交付状态 |


## 2026-07-26 有界自适应控制面与真实 UI 验收

状态：继续使用 ForkLight 自身分别调度 DeepSeek 与 MiniMax，但两个 Task 都冻结为
**1 base Attempt / 0 extra / 0 adaptation**。Worker 失败后没有调参数重试；Main 只审查
已有 patch、修正可证明缺口并跑完整验收。最终源码 **1031/1031 tests**、严格
TypeScript、production build 与 `git diff --check` 通过；真实 Hub 完成中文、Worker
Advanced、Task adaptation、390 px 窄屏和 browser console 验收。未 commit / push。

### Task、成本与 Main 处置

| Task | 模型 | 机器结果 | 成本证据 | Main 处置 |
| --- | --- | --- | --- | --- |
| `805e320d-8d9a-4ccd-b5fd-bf71872fa71d` | DeepSeek `deepseek-v4-pro[1M]` | 1 Attempt / 50 turns；行为测试通过，严格 TS 因新增 CLI operation 未登记到 receipt union 而失败 | Worker gross **4,300,150**；Provider quoted **USD 0.089657125**；runtime estimate **USD 3.27901** | 不追加 Attempt；补统一 operation 类型、MCP annotation 与 confirm 负例后整合 |
| `440c58b8-0a48-48de-b111-8c0ef456b55e` | MiniMax-M3 | 1 Attempt / 100 turns；Worker 给出终态后进程被记录为 interrupted，focused Hub 29/31 | Worker gross **11,675,753**；official exact 为 `per-request-usage-required`，保守区间 **CNY 5.47125768–10.94251536**；runtime estimate **USD 7.487937** | 不重跑；收紧 reason/patch 边界、让字段清单从 Worker inventory 派生、补表单失效与行为测试后整合 |

两项合计 Worker gross **15,975,903 Tokens**。Main↔ForkLight exchange 估算合计
**183,366–1,104,894 Tokens**，对应 boundary reduction
**14,871,009–15,792,537 Tokens**（low confidence）。这只能证明协议边界没有把 Worker
完整上下文灌回 Main，不能直接称为“主线程节约”；两个 Task 都缺 exact
`taskClass × directCodexProfileId` calibration，因此 direct-Codex savings 继续明确为
`direct-baseline-missing`，不为补数字重跑任务。

### 最终调用链

1. Main/用户在 CLI、MCP 或 Hub 选择具体字段并给出一个 bounded reason。
2. `adaptation_preview` 只读返回 before/after、来源、执行阶段、下一轮与停止原因。
3. 只有相同表单状态的 preview 为 eligible 且用户显式确认时，
   `adaptation_apply` 才事务创建唯一 successor；表单变化会废弃旧 preview。
4. root `maxAdaptationRounds` 只能在 Worker Advanced 创建 Task 前配置，不能在
   successor patch 中扩张。默认值 0 会在 preview 阶段停止，绝不会自动调用模型。
5. successor 仍走普通独立验证、Main Review 与 Integration；调参本身不算进度或成功。

### 真实 UI 验收和新问题

- Worker Advanced 实测 **14** 项；Task successor editor 从同一 inventory 派生
  **13** 项，只排除不可变 root round cap。把并发从 4 临时改成 3 时，effective
  preview 如实更新为 3；未保存并恢复为 4。
- root cap 为 0 的真实失败 Task 上，启用 duration 并预览得到
  `adaptation-disabled`，Apply 保持 disabled；把值从 600000 改为 700000 后旧 preview
  被清空并提示重新预览，没有创建 Task 或产生 Provider 调用。
- 390×844 viewport 下 Worker 高级表单和 Task adaptation 单列显示，页面
  `scrollWidth=390`，无横向溢出；browser error/warning 为 0。

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D159 | 新 CLI operation 已实现，但 receipt operation union 未同步，Worker 行为测试通过后才被严格 TS 拒绝 | **closed by Main**：补 canonical operation；后续应由单一 operation registry 生成 CLI/MCP/receipt inventory |
| FL-D160 | MiniMax 已产生 terminal result，随后进程消失被记录 interrupted，Verifier 仍完成 | **observability next**：区分 terminal-result 已收、runtime cleanup failure 与 delivery verification，不把三者压成一个普通模型失败 |
| FL-D161 | Worker 新增的两个 UI 静态测试依赖源码顺序/转义，真实行为正确也失败 | **closed by Main / test policy**：桥接边界改测 HTTP 行为；静态测试只保留不可运行的资源不变量 |
| FL-D162 | Task detail 的回调参数 `t` 遮蔽全局翻译函数，所有源码/HTTP 测试仍绿，真实页面报 `t is not a function` | **closed 2026-07-26**：重命名数据参数并加防回归断言；再次完成真实页面操作验收 |


## 2026-07-26 双结果交付处置与 Console 闭环

状态：继续使用 ForkLight 自身分别调度 DeepSeek `deepseek-v4-pro[1M]` 与
MiniMax-M3。两个 Task 都冻结为 **1 base Attempt / 0 extra / 0 adaptation**，没有自动
放宽参数、追加 Attempt 或循环重跑。机器失败证据完整保留；Main 只审查已有 patch、
修正可证明的缺口，并通过新处置链路核验修复后的当前源码。最终源码
**1057/1057 tests**、严格 TypeScript、production build 与 `git diff --check` 通过；真实
Hub 完成双结果、统计、中文和 390 px 响应式验收。未 commit / push。

### Task、机器结果、成本与 Main 处置

| Task | 模型 | 机器结果 | 成本与 Token 证据 | Main 处置 |
| --- | --- | --- | --- | --- |
| `f1760e00-11c7-436a-8672-b013e46548ee` | DeepSeek `deepseek-v4-pro[1M]` | 1 Attempt / 81 turns；独立验收因 3 个 TypeScript 错误失败，Task 保持 `failed` | Worker gross **8,667,688**；官网 PAYG **USD 0.129997372**；Claude runtime estimate **USD 5.895992** | 不重试；修正 async 调用、原子写入、Git 环境隔离、隐私投影、transport timeout 和 focused tests；再对当前源码运行原 Task 的 3 条验收命令，**3/3 通过**，单独记录 `verified-repaired-delivered` |
| `4b6c0e3a-78af-4a96-aed6-41995dbf2ff8` | MiniMax-M3 | 1 Attempt / 91 turns；Worker 已给 terminal result 后进程消失，Verifier 继续运行并因 1 个源码字符串测试失败，Task 保持 `failed` | Worker gross **12,425,372**；official exact 为 `per-request-usage-required`；Claude runtime estimate **USD 7.880852** | 不重跑；修正翻译函数遮蔽、静态测试错误前提、统计卡片 DOM 构造和双语 caveat，保留原机器失败 |

两项 Task 的 Worker gross 合计 **21,093,060 Tokens**。Main↔ForkLight exchange
估算合计 **1,745,437–10,493,422 Tokens**，对应 boundary reduction
**10,599,638–19,347,623 Tokens**（low confidence）。DeepSeek 单项的宽泛 exchange
估算甚至使 boundary reduction 下界为负，说明这组估算只能表达协议边界体量，不能
冒充直接收益。两项 Task 都缺少相同任务、相同 Main profile 的 direct-Codex baseline，
因此 direct Main Token savings 继续明确为 `direct-baseline-missing`；本轮不为补一个好看
数字重新执行任务。

### 最终模块、输入输出和调用链

1. **Main 发起处置：** 对 `failed` / `interrupted` Task 提供 bounded reason 与显式
   confirm；succeeded Task、重复 passing disposition 和并发中的 remediation 都拒绝。
2. **隔离验收：** ForkLight 把当前项目复制到新的 verification copy，清理继承的 Git
   环境，只运行 Task 已冻结的 acceptance commands，不把任意 Shell 权限交给 Worker。
3. **原子记录：** 同一个 Store 事务同时写 remediation check 与 final disposition；
   任一命令失败只记录 failed check，不产生“已核验交付”。Task 原始 status、Attempt、
   Verification 与 failure category 永不改写。
4. **公开投影：** 私有 Store 保留 reason、command、stdout/stderr 供审计；CLI、MCP、
   daemon、Hub 只返回 id、通过数、总命令数、时间、机器状态和 final disposition。
5. **消费结果：** Board 仍按机器状态把 Task 放在 Failed lane，同时显示“已核验交付”；
   Task detail 分列“机器执行”和“交付”；统计分列 machine success、accepted delivery、
   Main repaired 和 remediation checks。

### 真实 UI 验收

- DeepSeek Task 在 Failed lane 中同时显示 `failed` 与 `已核验交付`，没有被移动到成功列。
- Task detail 同时显示“机器执行: failed”和“交付: 已核验最终交付”。
- DeepSeek `deepseek-v4-pro[1M]` 统计显示 machine **63%（36 verified）**、final
  **65%（37 accepted）**、**1 Main repaired**、**1 remediation check**。
- 首次真实页面验收发现统计卡片出现 `[object HTMLDivElement]`；Main 修正 DOM 子节点
  组装后，8 个结果单元格的 object-string 数为 0。
- 390×844 viewport 下 document width 为 390 px、统计卡片单列、无横向溢出。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D163 | Worker Advanced 已设为宽松/不限，但 Task Contract quality gate 仍固定要求 `maxFiles <= 20`、`focusPaths <= 8`，形成第二层隐性硬限制 | **M1 next**：拆成不可配置 Safety、可配置 Quality、可配置 Preference；合同可行性限制必须出现在 effective preview，不能静默与 Worker Profile 冲突 |
| FL-D164 | DeepSeek 实际 source/test patch 为 15 个文件，但 `npm run check` 生成 `dist/` 后 Verifier 报告 450 files / 53,594 lines | **measurement next**：验收后 Diff 统计按 generated-path/exclude 分类，生成物不得污染业务改动体量；原始证据仍保留 |
| FL-D165 | MiniMax 已发送 terminal result，随后 runtime cleanup/进程消失被记录为 interrupted，Verifier 又能继续完成 | **observability next / extends FL-D160**：分开记录 terminal-result received、runtime cleanup failure、independent verification，不把三者压成普通模型失败 |
| FL-D166 | 第一版 remediation CLI/daemon response 会返回 Main reason、验收命令和 stdout/stderr | **closed 2026-07-26**：Store 保留私有审计；统一 compact public projection 已覆盖 CLI/MCP/daemon/Hub，并有隐私回归测试 |
| FL-D167 | source-string/static tests 同时漏掉翻译函数遮蔽和 DOM 数组被字符串化两个真实 UI bug | **closed for current bugs / policy next**：修正实现并补 focused regression；以后 material Hub change 必须包含真实 DOM/browser QA，静态字符串只测资源不变量 |


## 2026-07-27 Worker Quality 与火山引擎 GLM 5.2 1M 接入

状态：继续用 ForkLight 自身调度 DeepSeek `deepseek-v4-pro[1M]` 和 MiniMax-M3，
每个 Task 都冻结为 **1 base Attempt / 0 extra / 0 adaptation**，预算、时长、Token、
文件数与行数不设硬顶，未进入自动调参或循环重试。Main 保留机器失败历史，只审查、
修正并验证当前源码。最终源码 **1068/1068 tests**、严格 TypeScript、production
build、脚本语法与 `git diff --check` 全部通过；未 commit / push。

### Task、模型、成本与处置

| Task | 模型 | 机器结果 | Token / 成本证据 | Main 处置 |
| --- | --- | --- | --- | --- |
| `bcb9ebac-0271-4482-a6cc-1ff638378658` | DeepSeek `deepseek-v4-pro[1M]` | 1 Attempt；Worker exit 0，独立验收暴露 4 个 TypeScript 缺口，Task 保持 `failed` | Worker gross **14,642,137**；官网 PAYG **USD 0.164959685**；runtime estimate **USD 9.331285** | 不重试；Main 分离 check truth 与 admission、补逐字段 effect/来源/不可变快照并统一 assessor；原 Task 的 3 条验收命令 **3/3 通过**，另记 `verified-repaired-delivered` |
| `0fba3279-8dbf-42d9-aa59-a4cabe2ccb9f` | MiniMax-M3 | 国际站 endpoint 配中国区 Key，执行前 `401` | 无模型 Token；official 0 仅表示零使用量，不代表免费 | 归类为配置/区域错误，不计入模型编码能力；只做一次有证据的中国区纠正 |
| `cda7b7d9-b707-4f9e-8e87-1688cb83c0f4` | MiniMax-M3（中国区） | 1 Attempt / 222 turns；terminal result 后 cleanup 先记 interrupted，Verifier 再完成并因 2 个错误测试前提、1 个类型错误及 whitespace 失败；Task 保持 `failed` | Worker gross **39,929,423**；官网 CNY 保守区间 **17.6536479–35.3072958**，exact 仍为 `per-request-usage-required`；runtime estimate **USD 22.525755** | 不追加 Attempt；Main 复用 Provider/Hub/MCP 骨架，重写订阅费用语义、宽松 Quality 配置和测试；原 Task 的 3 条验收命令 **3/3 通过**，另记 `verified-repaired-delivered`（check `fb0ee388-3511-4425-b26b-0ddc9bed2c51`），随后做一次真实 Volcengine probe |

两项实际编码 Task 合计 Worker gross **54,571,560 Tokens**；Main↔ForkLight
exchange estimate 合计 **1,988,400–12,298,484 Tokens**，对应 boundary reduction
**42,273,076–52,583,160 Tokens**（low confidence）。两项都缺相同任务与相同 Main
profile 的 direct baseline，因此 direct Main Token savings 仍为
`direct-baseline-missing`；不把 boundary reduction 改名成节省。

### 最终模块与调用链

1. **Quality resolver：** Global Quality 与 Worker override 逐字段解析，显式 `null`
   表示 maximum 不限、显式 0 表示 minimum 关闭；新 Task 保存不可变值与 provenance。
2. **Quality admission：** 检查真假始终真实；`hard/warn/score/off` 只决定
   blocking、warning、score evidence 或 ignored。Safety 与 Main/Integration 权限不进入
   可调 Quality 对象。
3. **Volcengine Provider：** 独立 `volcengine` 身份生产精确 endpoint/model/Keychain
   元数据；Claude Code adapter 只在启动子进程时消费瞬态 Key，统计不与 Alibaba
   `glm` 合并，也不允许 model fallback。
4. **Model/Worker/Hub：** 新安装带内置非默认 `volcengine-glm52-1m`；当前本地旧设置
   已安全 upsert Model 与 Worker，保留原 `defaultProfileId`。Hub/MCP/status/probe 使用
   同一 Provider registry。
5. **费用真相：** Coding Plan route 先严格验证 endpoint、route 与精确 model，再返回
   `subscription-plan-no-per-request-price`；Worker Token 继续显示，不借用 PAYG 表，
   不显示虚构的 0 美元。
6. **真实连通：** 单次显式 probe 返回 `verified`，Provider `volcengine`，模型
   `glm-5.2[1M]`，origin `https://ark.cn-beijing.volces.com`，延迟 4929 ms。
7. **本地 Worker roster：** 旧持久化设置已幂等补入 `minimax-m3-cn`
   （Claude Code + 中国区 `MiniMax-M3`）与 `local-grok-builder`
   （本地 Grok Build + `grok-4.5`），保留 `default`。两者均使用开发期宽松策略；
   浏览器真实 DOM 已确认两张 Worker 卡片、对应运行时/模型/路由均可见，控制台无
   error/warn。Grok 本机 OAuth seed 存在；Provider 的 Keychain-only readiness 与
   Worker 的 OAuth fallback 仍是两个不同信号。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D168 | DeepSeek 既有 21 个机器失败中至少 12 个是旧 change-budget policy 超限，若直接按 failure rate 路由会误伤模型 | **routing next**：统计和选择分离 policy-only / authentication / runtime / behavior / verification，不能因可配置 gate 永久禁用模型 |
| FL-D169 | Worker Advanced 宽松但旧全局 Contract gate 仍是第二层隐性 hard limit | **core closed / Hub next**：共享 Quality resolver、逐 Worker override、不可变 snapshot 已交付；下一轮补 Worker Hub 编辑与 provenance preview |
| FL-D170 | 新内置 Model/Worker 会出现在 fresh defaults，但旧持久化数组不会自动吸收新增 built-in | **migration next**：当前本地已幂等 upsert；产品层需区分 built-in registry 与用户数组，避免升级遗漏，也避免把用户主动删除误当缺失 |
| FL-D171 | 同一个 MiniMax Key 在国际 endpoint 返回 401、在中国区 endpoint 正常，普通 authentication 会污染模型能力统计 | **classification next**：保留原失败；增加 region/endpoint mismatch 诊断，不把它当模型编码失败，也不自动跨区回退 |
| FL-D172 | 订阅 Coding Plan 若走普通 pricing catalog 会被标成 unsupported endpoint 或误显示 0 | **closed 2026-07-27**：严格身份后返回 `subscription-plan-no-per-request-price`；Token 与费用可用性分开 |
| FL-D173 | Worker 已发 `worker.completed` 后仍被 cleanup 标记 interrupted，接着又进入 verifying，`wait --until terminal` 曾提前返回 | **observability/state-machine next / extends FL-D160/165**：terminal-result、process cleanup、verification 三阶段必须单调，cleanup 不能覆盖已收到的 terminal envelope，也不能让 wait 提前终止 |

## 2026-07-27 Hub「发生了什么」完整链路 dogfood

状态：使用 ForkLight 自身并行调度 Volcengine `glm-5.2[1M]`、MiniMax-M3、
DeepSeek `deepseek-v4-pro[1M]` 和本地 Grok `grok-4.5`。四个 Task 都保留冻结的
合同与机器结果；Main 不为追求绿色状态自动重试，而是审阅隔离补丁、纠正事实错误，
再合入当前源码。最终 **1079/1079 tests**、严格 TypeScript、production build 与
`git diff --check` 全部通过；未 commit / push。

### Task 与真实处置

| Task | Worker | 机器结果 | Main 处置 |
| --- | --- | --- | --- |
| `82dd23a3-90a6-4edd-b318-2f58c0dc1c07` | Volcengine `glm-5.2[1M]` | succeeded；41 turns；runtime estimate USD 3.8431 | 合入双语白话文案，把 Boundary Reduction 改成“留在 Worker 内部的工作量”，明确不是直接节省 Main Token |
| `0cfc584f-4f55-44bf-93c2-e09228832abe` | MiniMax-M3 | failed；1 Attempt / 118 turns；runtime estimate USD 9.9554 | 失败来自静态测试错误前提；保留 Insights 引导和紧凑 Token 展示，拒绝“发生了什么/为什么”重复同一句的 Task story |
| `3cb36cf2-3faa-4171-baef-5fc50a568dbf` | DeepSeek `deepseek-v4-pro[1M]` | failed；1 Attempt / 56 turns；runtime estimate USD 4.5687 | 合同误写不存在的 `npm run typecheck`，新增测试也有脆弱断言；Main 保留 journey 主体，改为真实 Attempt/diff/check 数据并移除推测性结论 |
| `7660dee8-c134-4365-95567d283725` | Grok `grok-4.5` | failed；1 Attempt / 11 turns；runtime estimate USD 0.2435 | CSS 本身通过 diff check；失败来自快照继承 DeepSeek 当时未修的测试。Main 合入响应式视觉层级并补完整的六段时间线样式 |

这些 failed 不能直接解释为“模型能力差”或“Provider 不通”。GLM、MiniMax、
DeepSeek、Grok 都真实执行并产生了可审查产物；三项失败分别是验证合同、脆弱测试和
旧快照问题。UI 后续必须把 **Worker 已完成输出、独立验收失败、Main 最终交付** 分开
显示，不能压缩成一个红色 `failed`。

### 当前 UI 结果

1. Overview、Tasks、Plans、Competitions、Insights、Models、Workers、Mains、Limits
   都有简短页面引导，先说明用途与用户接下来要看什么。
2. Task 卡片显示白话阶段和更新时间，不再把内部 action、原始错误与英文状态直接
   丢给用户。
3. Task Detail 按时间顺序展示 Main 输入、Worker 执行、独立验收、最终交付、原因和
   下一步。输入包含目标、范围、边界、步骤、交付物、重点文件、验收标准与脱敏命令；
   执行展示真实 Attempt、Worker 自述和真实变更文件；验收展示实际 check 结果。
4. Worker 自述明确标成“尚未独立验证”，最终 Main review / Integration / remediation
   单独展示。内部 id、来源、session、Provider/runtime、原始错误、decision/timeline 与
   费用细节收进默认关闭的技术详情。
5. 中英文使用同一信息结构；可见状态、时间、失败类别和下一步均通过本地化文案表达。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D174 | 小体量隔离 source 仍可能准备 5–6 分钟，期间没有阶段进度 | **M1 next**：记录扫描、复制、清理、基线四个阶段及耗时；先定位瓶颈，不用盲目调 timeout |
| FL-D175 | Task profile 的 `maxConcurrency=1` 会覆盖全局 4，导致看似“全局可并发、实际排队” | **closed for examples / product next**：本轮四个 dogfood 示例统一为 4；UI effective preview 必须明确显示最终并发来源，已有 Task snapshot 不改写 |
| FL-D176 | Grok 11 turns 产生 982 条 token fragment events，时间线和存储会被流式碎片淹没 | **observability next**：按时间窗/语义块合并流式片段，保留原始审计可选入口，默认 UI 只展示可读事件 |
| FL-D177 | Worker 可以写出看似合理但并非事实的 Attempt 数、文件列表或最终结论 | **closed for Task journey**：展示层只消费 inspect Attempt、真实 workspace diff、Verifier checks 与 durable delivery；Worker claim 永不冒充系统事实 |
| FL-D178 | Task Detail 若同时展示 Worker 输出和最终输出但不标证据阶段，用户仍会误解 | **closed for current path / browser regression next**：六段 journey 固定顺序和证据标签；补 success、verification failure、authentication failure、running 四类浏览器回归 |
| FL-D179 | Task Detail 的下一步把 DOM 节点当文字传递，真实页面显示 `[object HTMLDivElement]`；静态字符串测试未发现 | **closed 2026-07-27**：next-action resolver 只返回本地化文本并增加回归断言；真实中英文页面确认无 object-string，控制台 0 error/warn |

最终浏览器复验还确认：中文看板列名为“等待开始 / 执行中 / 检查已通过 / 需要处理”，
总览不再前置 Task id 或原始失败串，Provider 状态改为“配置是否完成 + 连接是否检查”的
白话表达；英文切换使用相同信息层级。Insights 不再出现 `Boundary Reduction` 或
`direct-Codex counterfactual`，而是明确解释“留在 Worker 内部的工作量”不能证明 Main
节省了多少 Token。任务详情技术细节默认关闭，页面无横向溢出。


## 2026-07-27 证据驱动模型路由、Hub 轮询隔离与全链路可读性

状态：继续使用 ForkLight 自身并行调度 DeepSeek `deepseek-v4-pro[1M]`、MiniMax-M3
与 Volcengine `glm-5.2[1M]`。三个 Task 均为 **1 base Attempt / 0 extra / 0
adaptation**，预算、时长、Token、文件与行数不设硬顶，Main 没有通过调参或追加运行追求
绿色状态。Worker 结果保留，Main 审查后只修正已证明的语义、类型、测试和展示缺口。
最终源码 **1132/1132 tests**、严格 TypeScript、production build、脚本语法与
`git diff --check` 通过；未 commit / push。

### Task、模型、机器结果与成本证据

| Task | Worker | 机器结果 | 成本证据 | Main 处置 |
| --- | --- | --- | --- | --- |
| `28d713f5-7b51-415a-9f71-7eac38c04677` | DeepSeek `deepseek-v4-pro[1M]` | failed；106 turns；3 项行为测试与严格 TS 失败 | 官网 PAYG **USD 0.171498315**；runtime estimate **USD 9.242875** | 不重试；保留路由骨架，修正 policy-only/non-model 分类、Main 修复交付、验证口径、缺失/跨币种费用、稀疏证据与不确定性 gate 后整合 |
| `125db2d0-a9b5-4c0c-a704-662b5f89e9c3` | MiniMax-M3 | failed；173 turns；focused 52/53，另有 1 个错误类型引用 | exact 官方费用为 `per-request-usage-required`，不是 0；runtime estimate **USD 15.392394** | 不重跑；合入 Hub 环境证据缓存，修正测试前提、类型、15 秒有效期和并发失效竞态；focused 53/53 |
| `12e0d8da-b26e-4b3e-abbb-d55968fab2cc` | Volcengine `glm-5.2[1M]` | succeeded；147 turns；三条独立验收全部通过 | Coding Plan 订阅无逐请求官网价格，明确不可用；runtime estimate **USD 14.643406** | 合入双语二级工作流；Main 再修正诊断截断、内部 ID/原始错误层级、竞争/集成主视图、Task 最终输出和 Token/费用白话表达 |

三项 Worker gross 合计 **60,975,267 Tokens**；Main↔ForkLight exchange estimate
合计 **110,723–667,849 Tokens**，对应“留在 Worker 内部的工作量”
**60,307,418–60,864,544 Tokens**（low confidence）。三项都没有相同任务、相同 Main
profile 的 direct baseline，因此 direct Main Token savings 仍明确为
`direct-baseline-missing`。这个区间只描述 Worker 工作量减去编排交换量，不能改名为
“主线程节省”。DeepSeek 官网 USD、MiniMax 缺逐请求报价、Volcengine 订阅不可逐请求
定价和 Claude runtime USD 遥测是不同证据，绝不相加或冒充 Provider 账单。

### 最终模块、输入输出与调用链

1. **路由证据：** 按 task class 读取终态历史，把模型质量、非模型故障和模糊故障分开；
   只有通过独立行为验证的交付或确属模型质量的失败进入有效样本。
2. **可比性 gate：** 任何启用权重缺证据、候选样本不足、费用缺失/跨币种，或分差低于
   不确定性阈值，均返回“不足以推荐”，可选提示进行 competition；失败过的模型不永久禁用。
3. **可配置策略：** 候选数量、最小样本、权重和不确定性阈值走共享 Settings，CLI 与
   MCP 只读消费同一 advisory；费用和时长默认权重为 0。Hub 可视化编辑仍是下一步。
4. **Hub 轮询隔离：** `/api/status` 的 Provider/Runtime/Main/Daemon 体检短时共享并合并
   并发 miss；配置和生命周期成功变更立即使缓存失效。任务、看板、计划、竞争、统计、
   设置和经济性仍实时读取。
5. **解释优先 UI：** 页面先回答“这是什么、现在发生什么、依据是什么、下一步做什么”。
   Task Detail 展示完整 Main 输入、Worker 声明与真实文件、独立检查、最终输出与交付；
   Competition 用 Provider/模型名展示推荐；Integration 主视图展示文件和应用结果；内部
   id、指纹、诊断和公式默认折叠，诊断统一限制为 800 字符。
6. **经济性表达：** 单 Task 也把配置上限、runtime estimate、官方报价/区间、Worker
   工作量、Main exchange、Worker 内部工作量和校准节省分开，缺失不是 0，币种不混合。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D180 | Hub 每 2 秒读取 `/api/status` 会同步运行 Claude/Grok 等 runtime doctor；后续发现普通刷新还会调用未缓存的 `/api/ops/health` | **closed for both read paths**：`/api/status` 与 `/api/ops/health` 均使用 15 秒共享缓存和并发 coalescing；成功 mutation 精确失效，进度类 API 保持实时 |
| FL-D181 | 早期只暂停 1 个 Hub 时，第三个并行 Task 的 workspace preparation 仍约 6 分钟；后来确认当时实际有 3 个 Hub 同时轮询 | **earlier inference withdrawn**：不能据此归因 snapshot/copy。准备阶段观测已交付；先在单 Hub 环境重新测量，再决定是否优化复制算法 |
| FL-D182 | Task Contract 的 `maxFocusPaths=8` 仍是隐藏 Quality hard gate，和 Worker“文件/行数不限”不是同一层 | **extends FL-D163/169**：核心 Quality 已可配置；下一步在 Hub 显示合同 Quality 来源与生效值，开发期默认 warning，Safety 边界仍不可关闭 |
| FL-D183 | 当前 MCP 进程可能仍加载旧 build，新的 model routing mutation/read schema 会发生 build mismatch | **activation/UX next**：本轮使用匹配源码的 CLI 只读回退；重启后复验。后续 Main surface 应显示“需要重新连接”而非让用户猜 |
| FL-D184 | GLM 静态测试声称诊断“bounded”，实现却没有实际截断；竞争与集成仍前置内部 ID/原始错误 | **closed 2026-07-27**：统一 `boundedDiagnostic`，主视图只保留用户意义，ID/诊断进入关闭的技术细节；最终中英文 DOM、点击与浏览器日志验收通过 |

## 2026-07-27 路由解释、准备阶段与运维健康缓存补强

本轮继续通过 ForkLight 使用 DeepSeek、MiniMax 与 Volcengine GLM；每个合同均为
`1` 次基础 Attempt、`0` 次额外 Attempt、`0` 次自动适配。机器结果失败后不自动循环重试，
由 Main 审查候选、修正问题并记录独立核验处置。最终完整检查为 **1158/1158**，同时
通过严格 TypeScript、生产构建、`app.js` 语法检查和 `git diff --check`；未 commit / push。

### Task、机器事实与 Main 处置

| Task | Worker | 机器事实 | Main 处置 |
| --- | --- | --- | --- |
| `f518bb5b-9df6-443a-9431-41b184d00dad` | DeepSeek `deepseek-v4-pro[1M]` | failed；84 turns；候选包含无效 DOM 嵌套、`[object HTMLElement]`、重复设置校验与错误失败分类 | Main 修正并完成检查 `f5bd756f-9495-4c38-afe4-749b11119506`；记录为 `verified-repaired-delivered` |
| `c7ec2423-d5ec-404b-940d-3871e288a0f3` | MiniMax-M3 | failed；149 turns；测试夹具缺少目录创建，候选设计可用但冻结验收未通过 | Main 修正异步 observer、阶段计数、状态清理和 Task Detail；检查 `b199bd75-b52d-4c4d-91ca-65cac2a869e8` 已通过 |
| `48eabff7-1c0e-4529-9882-0897d39930d4` | Volcengine `glm-5.2[1M]` | failed；Daemon 在 `preparing` 时重启，恢复出的 workspace 缺少源码清单；用量不完整 | 认定为基础设施原因并终止；只在修复运行条件后创建一次替代 Task，不对该 Task 重试 |
| `e501d9a1-cd1f-4c49-912e-654f0c9defca` | Volcengine `glm-5.2[1M]` | failed；87 turns；39/40 聚焦检查通过，唯一失败是旧测试键列表漏掉既有 `modelRouting` | Main 修正并补充生命周期失效测试；检查 `93304679-c2fa-408c-993c-aad777c9bd89` 已通过 |

### Token 与费用证据

- 三个有完整 Worker 用量的 Task gross 合计 **36,938,915 Tokens**。
- Main↔ForkLight exchange estimate 合计 **133,561–802,736 Tokens**。
- 扣除编排交换后的 Worker 内部工作量为 **36,136,179–36,805,354 Tokens**；这是工作边界估算，
  不是“主线程节省”。首个中止的 GLM Task 只增加 **1,028–6,120 Tokens** exchange 估算，
  因 Worker 用量不完整，不给 boundary 或 savings 结论。
- 所有 Task 都缺少相同任务、相同 Main profile 的 direct baseline，因此 direct Main Token
  savings 仍为不可用，不能由 Worker Token 倒推。
- DeepSeek 官网 PAYG 为 **USD 0.158407048**；MiniMax 缺逐请求精确用量，只能给出
  **CNY 8.5036119–17.0072238** 的档位区间；Volcengine Coding Plan 是订阅计划，不能给出
  逐请求官网价格。runtime estimate 分别为 **USD 7.994498**、**USD 11.6496475**、
  **USD 5.306922**，仅为运行时遥测，不与 Provider 账单相加。

### 本轮交付给用户看的过程

1. **模型路由：** 先说明工作类型、候选模型、是否有推荐、用了哪些因素、哪些因素没用或
   缺证据，再把分数细节收进技术详情。
2. **准备阶段：** Task 在 Worker 启动前会依次说明扫描项目、建立安全快照、复制 Worker
   空间、连接依赖和写入上下文，展示真实耗时和已知数量，不伪造百分比或剩余时间。
3. **Task Detail：** 先回答现在发生了什么，再按 Main 输入、Worker 执行、独立检查、最终
   交付、失败原因和下一步展示。目标默认可见；完整边界、原始 Worker 汇报、文件清单和
   检查命令默认收起。Worker 失败但 Main 已修复时，同时保留机器失败和最终已核验交付，
   顶部明确说明无需继续重试。
4. **运维健康：** `/api/ops/health` 使用 15 秒缓存、并发合并、`checkedAt` 和成功 mutation
   失效，避免页面每 2 秒反复启动 runtime doctor。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D185 | 普通 Hub 刷新会绕过已有 `/api/status` 缓存调用 `/api/ops/health`，反复同步运行 runtime doctor | **closed 2026-07-27**：新增独立缓存、并发 coalescing、时间戳和设置/Provider/模型/Worker/Main/Daemon 生命周期失效 |
| FL-D186 | 本机可同时积累多个 Hub，并在不同端口独立轮询同一个 Daemon | **M1 high**：需要启动时发现并复用已有 Hub，或明确显示实例归属；本轮先按精确 PID 合并为一个实例 |
| FL-D187 | Daemon 在 Task `preparing` 时重启，可能恢复不完整 workspace，缺少 `source-manifest.json` 后仍启动 Worker | **M1 high**：恢复时必须丢弃并重建未完成准备，或使用完整性标记；清单完成前绝不能启动 Worker |
| FL-D188 | CLI `inspect --summary` 的本地决策构建未传入已存储的 remediation disposition，可能漏掉 Main 已核验交付 | **M1 comprehension**：紧凑检查应读取同一 canonical disposition，避免 CLI 与 Hub 对最终结果说法不同 |
| FL-D189 | Task Detail 虽有完整输入输出，但原始合同、Worker 汇报、文件与命令同时展开会再次变成信息罗列；修复交付后顶部仍只说机器失败 | **closed 2026-07-27**：目标与白话结果优先，密集技术证据按需展开；机器失败与最终交付并列，已核验修复后的下一步为“无需操作” |

## 2026-07-27 全局 UI 叙事与直接 Main Token 对比入口

本轮继续使用 ForkLight 自身完成工作。所有 Task 均为一次基础 Attempt、零额外
Attempt、零自动适配，且不设置单任务预算上限。Main 没有通过调参、追加运行或反复缩小
合同追求绿色状态；机器失败保留为机器事实，Main 只审查候选并纠正已证明的问题。
最终完整检查为 **1164/1164 tests**，严格 TypeScript、production build、脚本语法与
`git diff --check` 全部通过；未 commit / push。

### Task、竞争结果、成本证据与 Main 处置

| Task | Worker | 机器事实 | 成本证据 | Main 处置 |
| --- | --- | --- | --- | --- |
| `b5c0ef05-646a-4536-a721-30fd74685d16` | DeepSeek `deepseek-v4-pro[1M]` | failed；43 turns；focused 72/75，并有 TypeScript 失败 | 官网 PAYG **USD 0.076847825**；runtime estimate **USD 2.479165** | 不重试。候选把 capture body、五个计数层级和测试夹具写错；Main 重建 exact capture/review/publish API，并补 Task 身份绑定与隐私边界 |
| `73fbe990-f867-4238-9138-5e8e5adaa790` | MiniMax-M3 | failed；103 turns；focused 35/37 | official cost 不可用：`route-required`；runtime estimate **USD 8.8181505** | 竞争候选被拒绝：rejection enum、run ref、capture body、身份展示和递归刷新均不符合合同 |
| `d8e9c22a-4e13-4a5a-95d6-c149a1c6b67d` | Volcengine `glm-5.2[1M]` | failed；69 turns；focused 35/36，唯一失败为候选自己写的静态断言 | official cost 不可用：`route-required`；runtime estimate **USD 8.215171** | 竞争没有机器 winner。Main 仅把 GLM 作为较好修复底稿；最终原合同 4/4 通过，记录 check `614ba72a-2dd9-47d4-8b8c-adfdbdb4064d` 与 `verified-repaired-delivered` |
| `5e503bf8-b2e4-4142-be03-d2fd0c1a4286` | 本地 Grok `grok-4.5` | failed；18 turns；focused 35/36，唯一失败为候选自己的英文正则过窄 | official cost 不可用：`usage-missing`；runtime estimate **USD 0.5543244** | 保留五段页面叙事骨架并继续补可读性；最终原合同 4/4 通过，记录 check `eeba240b-6a7b-473c-b003-452236e5b6a5` 与 `verified-repaired-delivered` |

Competition `c934f768-dbe6-4119-8116-13a0950a0952` 的两个候选都没有通过
独立验收，因此系统正确地没有宣布 winner。Main 选择 GLM 只是一项有证据的人工修复
决策，不是竞争系统的模型推荐，也不重写 MiniMax 或 GLM 的机器失败历史。

### 最终用户链路

1. **顶层页面：** Overview、Board、Plans、Compete、Insights、Models、Workers、Main
   都先回答“这页解决什么、输入、ForkLight 做什么、输出、下一步”，再显示表格、卡片、
   设置与证据。
2. **Worker：** 卡片先说明何时会被使用、通过什么执行、预算/停止条件、失败后是否追加
   修正、是否创建后继 Task。原始 Worker ID、Provider/model/runtime 和价格路由在关闭的
   技术详情中。
3. **Main：** 每个客户端先说明现在能不能使用、安装一个通道后会得到什么；MCP 被解释为
   “任务调用通道”，Skill 被解释为“怎样拆分、验收和纠正的编排说明”，路径默认收起。
4. **Task Detail：** 默认显示 Main 目标、实际 Worker、Attempt 过程、文件输出、验收结论、
   具体失败检查、最终交付、原因和下一步。精确检查命令仍在技术清单中，但失败项本身不再
   隐藏在折叠区。
5. **直接 Main Token 对比：** 有 `taskClass × directCodexProfileId` 的 Task 可在详情中录入
   一次等价直接 Codex 运行的五个终态计数，由 Main 明确接受/拒绝，再显式发布版本。无身份
   或无 direct baseline 时明确不可计算；Worker Token 绝不改名为节省。

这四个 Task 本轮都没有新增“同任务、同 Main profile”的直接 Codex baseline，因此本轮
不声称节省了多少 Main Token。Hub 当前组合数据中已有历史校准结果，但不能倒推到这些新
Task。MiniMax、GLM 与 Grok 的 official cost 不可用原因保持原样，不用 runtime estimate
冒充 Provider 账单。

### 真实浏览器验收

- 新构建以一个 Daemon、一个 Hub 运行在 `127.0.0.1:53542`。
- 中文和英文的八页叙事含义一致；Worker/Main 主卡不再出现
  `budget unlimited · no-progress` 或 `Plugin: yes · MCP: no`。
- Grok 失败 Task 默认直接显示“Hub 的界面行为和中英文文案符合产品约定”这一失败检查，
  并告诉 Main 对照该检查修复后只重跑同一组验收；不是无目的调整参数。
- 390×844 viewport 下 document width 与 viewport 同为 390 px，五段页面叙事为单列，
  无横向溢出；浏览器 console 为 0 error / 0 warn。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D190 | Competition 跨 Provider clone 时可能保留原 Task 的 `provider.pricingRoute`，让候选带上陈旧价格身份 | **closed 2026-07-27**：候选 Provider 身份整段重建；Provider/model/endpoint/Keychain service 一起替换，旧 `pricingRoute` / `keychainAccount` 不会继承，原 Task 保持不变 |
| FL-D191 | 当前模型路由只要任一正权重因素缺证据就整体不推荐，对订阅、跨币种和新模型过于严格 | **closed for configurable policy 2026-07-27**：新增 `flexible` / `strict`；开发期默认 flexible，明确列出未参与的因素；strict 保留完整证据门。两种模式仍执行样本、有效因素、差距和币种边界 |
| FL-D192 | 直接 Main Token 校准此前只有底层能力，用户无法在 Task Detail 看懂采集、复核、发布和不可用原因 | **closed 2026-07-27**：四步可视化链路已交付；身份服务端派生、五计数严格校验、Main 显式决定、版本化发布、无自动动作 |
| FL-D193 | Grok 18 个语义 turns 被 normalizer 展开为 1312 个事件，Task Detail 与存储会被 token fragment 淹没 | **M2 observability / extends FL-D176**：按时间窗与语义边界合并 streaming fragment；默认只展示有意义消息，原始片段仅保留审计入口 |

## 2026-07-27 Competition 身份与缺证据路由策略 dogfood

本轮继续用 ForkLight 自己执行：MiniMax-M3 负责 Competition 身份修复，DeepSeek
`deepseek-v4-pro[1M]` 负责缺证据策略。两项合同都只有一次基础 Attempt、没有额外
Attempt、没有自动适配、没有单任务预算上限。Main 保留机器结果，不通过重复调参或重跑
追求绿色状态；最终完整检查为 **1169/1169 tests**，未 commit / push。

### Task 与 Main 处置

| Task | Worker 机器事实 | Main 处置 |
| --- | --- | --- |
| `51b64816-ea3f-43d5-bbd9-5059f1ca8bae` | MiniMax-M3 succeeded；Competition focused 28/28 与 build 通过；runtime estimate USD 1.403461；official cost unavailable: `route-required` | Main 接受两个真实 source/test 改动；ForkLight Integration preflight 因 `npm run build` 生成的 `dist/**` 把交付扩大到 457 files / 69,002 lines 而拒绝。Main 复核后只把 source/test 补丁写入当前 checkout，不绕过该次 Integration 失败事实 |
| `9375ed71-c370-4db5-8ad3-03177ced8829` | DeepSeek failed；79 turns；两个 focused 断言与 TypeScript build 失败；official exact cost USD 0.146200194；runtime estimate USD 7.482149；候选 Diff 含 459 files / 59,624 lines | 不追加 Attempt。Main 修正遗漏的 coordinator 消费点、互相矛盾的测试夹具和用户层文案；按原合同重新检查 `96815912-a871-457b-9145-8c77b3237394` 为 3/3，记录 `verified-repaired-delivered`，原 Task 仍为 failed |

### 最终行为

1. Competition 在跨 Provider 建候选时，把 Provider、模型、endpoint、Keychain service、
   pricing route 和 Keychain account 视为一个身份。候选覆盖没有明确给出的价格身份不会从
   原 Task 偷带过去，避免用错价；原 Task 不被改写。
2. 模型建议遇到某项已启用偏好缺少公平可比证据时，可以选择：
   - **继续比较，并明确提示缺口（开发期默认）：** 只用其余可比证据，不把缺失当 0；
   - **等可比证据完整后再推荐：** 任一启用因素缺证据就不推荐。
3. 两种策略都不能绕过最少样本、零有效因素、分差不足或币种不可比；最终选择仍归 Main。
4. Hub 高级设置已能编辑同一策略。用户层说明“发生了什么、跳过了什么、建议依据什么、
   下一步看什么”，内部 reason/code 只进入关闭的技术详情。中文、英文、390 px 窄屏均已
   实际操作；浏览器 console 为 0 error / 0 warn。

### UI 可读性验收规则

后续 UI 不能以“把所有字段都放出来”为完成标准。每个页面与每个重要对象都应至少让用户
按顺序看懂：**输入是什么 → ForkLight/Worker 做了哪些阶段 → 当前停在哪个状态 → 真实输出
或失败结果是什么 → 用户下一步做什么**。默认层使用用户语言；证据层解释依据与缺口；ID、
命令、原始错误、价格 route、公式和诊断进入技术层。信息丰富不能以牺牲因果、时间顺序和
可读性为代价。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D194 | acceptance build 会生成 `dist/**`，Patch/Integration 随后把数百个生成文件当成交付改动，真实 2–10 个 source 文件也会被体量门拒绝 | **closed for declared exclusions 2026-07-27**：`workspace.exclude` 与 Patch 共用路径段语义；raw/generated 审计证据保留，Integration 只接收 source。下一步在 preflight 展示分类来源并提醒合同遗漏的 exclusion |
| FL-D195 | DeepSeek 合同声明最多 9 个文件，但完整调用链实际需要第 10 个 `coordinator.ts` 消费点，Worker 只能漏改或违反合同 | **M1 contract feasibility / extends FL-D163/182**：验收证明依赖闭包超出 Quality 偏好时返回 `contract-infeasible` 并交给 Main 修订；文件数优先 warning，不对相同矛盾合同继续重试 |
| FL-D196 | Hub token 只保存在页面内存；普通刷新后同一页直接变成未认证，也没有恢复或重新连接动作 | **closed for normal same-tab refresh 2026-07-27**：验证后的 token 仅写入 tab-scoped session storage，fragment 立即移除，401 清空；server/token 重启后的重新连接说明仍待补 |
| FL-D197 | 模型策略先切到 strict、再切回已保存的 flexible 后，Hub 仍显示“未保存” | **closed for model routing 2026-07-27**：当前 draft 与已保存策略按语义和归一化数字比较，恢复原值即清除提示且不自动保存；Worker/adaptation/calibration 表单继续套用同一规则 |

## 2026-07-27 排除路径交付真值与 Hub 会话真值 dogfood

本轮继续使用 ForkLight 自身执行，两项合同都只有一次基础 Attempt、没有额外 Attempt、
没有自动适配、没有单任务预算上限。GLM 负责 Patch/Integration 的 generated-output 语义，
Grok 负责 Hub 会话与表单 dirty 语义。Main 不因机器失败追加运行，而是保留原始事实、审查
候选并只修正已经证明的问题。最终完整检查为 **1174/1174 tests**，严格 TypeScript、
production build、脚本语法与 `git diff --check` 均通过；未 commit / push。

### Task、机器事实与 Main 处置

| Task | Worker 机器事实 | Main 处置 |
| --- | --- | --- |
| `2cc9b4b6-56e1-4470-9933-31dbb991293f` | Volcengine `glm-5.2[1M]` succeeded；53 turns；focused 50/50、build 与 diff check 通过；5 files / 320 lines | Main 接受共享 exclude/path-classification 语义。Integration preflight `f82b0823-e9ee-4560-8761-82c188d061c9` 无拒绝；operation `717db60a-542c-4639-8f75-c138e3ccd405` 完成并通过 source-applied 与 3/3 source-verified。raw/generated 保留，source Integration 不再被 `dist/**` 放大 |
| `b555b18f-b074-4ae0-b6ef-bcf986fff108` | 本地 Grok `grok-4.5` failed；10 turns；focused 63/64；TypeScript 与 diff check 通过；唯一失败是候选新增注释触发旧的全文件 `localStorage` 字符串断言 | Main 记录 `revise`，不重试。重写测试为真实调用边界与行为验收，修正 session 清理和语义 dirty 比较；remediation check `bdd37a56-9635-4c44-b0e3-2dfa6b3ca156` 为 4/4，disposition 为 `verified-repaired-delivered`，原 Task 仍保持 failed |

### Token、费用与“不夸大节省”

- GLM gross Worker 用量为 **2,651,109 Tokens**，Main↔ForkLight exchange estimate 为
  **9,802–58,809 Tokens**，扣除交换后的 Worker 内部工作边界为
  **2,592,300–2,641,307 Tokens**。这不是直接 Main Token 节省；本任务没有同任务、同 Main
  profile 的 direct baseline，因此 savings 不可计算。
- GLM runtime estimate 为 **USD 2.952677**；Volcengine Coding Plan 是订阅计划，官方逐请求
  成本不可用，原因为 `subscription-plan-no-per-request-price`。
- Grok 的 Worker 用量缺失或不完整，只能给出 **5,810–34,942 Tokens** exchange estimate；
  runtime estimate 为 **USD 0.474936**，官方成本不可用原因为 `usage-missing`。不能从缺失用量
  推导 Worker 工作边界或 Main 节省。

### 真实用户链路验收

1. Hub 从 URL fragment 读取并验证 token 后立即移除 fragment；token 只进入同一 tab 的
   session storage，不进入 local storage、cookie、query 或请求 body。
2. 在已清理 URL 上普通刷新，Hub 保持连接；任一 401 会同时清除内存与 session token。
3. 模型路由从 `flexible` 改到 `strict` 时出现“未保存”，再改回 `flexible` 后提示消失，
   且没有自动写入设置。空白或无效数字仍保持 dirty，不会伪装成已保存。
4. 新构建的真实 Hub 页面完成上述操作，浏览器 console 为 0 error / 0 warning。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D198 | Integration 的 `source-verified` 可在隔离验证副本中成功运行 `npm build`，但 operation 同时把 `artifact-built` 与 `runtime-activated` 标为 not-applicable；实际 Hub 因此仍可能服务旧 `dist` | **closed for plan/config truth 2026-07-27；M0 live exit 仍 open**：Hub 可编辑完整 Delivery Profile，Task/Preflight 分别展示 source applied、source verified、artifact built、runtime activated 的计划与实际证据；未配置步骤明确为未配置，旧任务明确为未知。下一步仍需为 ForkLight 自身配置真实 activation 并连续完成 3 次 live handoff，不能把隔离 build 当作 live activation |
| FL-D199 | Grok 只有 10 个语义 turns，但底层事件仍被 streaming fragment 大量展开 | **extends FL-D193**：合并高频片段、默认只展示有意义阶段；这不是失败重试或预算参数问题，不通过放宽上限掩盖 |

## 2026-07-27 Delivery 过程真值与 Task Detail 可读性 dogfood

本轮由 ForkLight 自己并行执行 DeepSeek `deepseek-v4-pro[1M]` 与 MiniMax-M3。
两项合同均为一次基础 Attempt、零额外 Attempt、零自动适配，时间、Token、费用、文件数和
代码行数不设单任务上限；合同验证仍真实暴露 `maxFocusPaths=8` 的 Quality hard gate，Main
只调整阅读入口而没有缩减目标、验收或实现边界。机器结果失败后没有继续调参和重试，Main
审查候选、纠正已证明的错误并记录独立修复处置。最终完整检查为 **1193/1193 tests**，
严格 TypeScript、production build、`app.js` 语法和 `git diff --check` 全部通过；未
commit / push。

### Task、机器事实与 Main 处置

| Task | Worker 机器事实 | Main 处置 |
| --- | --- | --- |
| `47a5ac55-4753-43e3-9529-09c40ce91316` | DeepSeek；failed；48 turns；9 files / 605 lines；聚焦行为 110/110 通过，但严格 TypeScript 和 build 因 2 个候选编译错误失败 | Main 修正返回类型与未使用变量；原合同 4/4 重新通过，check `7564741a-4a22-483c-a7a2-40e3cb13d843`，记录 `verified-repaired-delivered`；原 Task 仍为 failed |
| `71d33973-e009-4943-8c41-67e3c74eaa03` | MiniMax-M3；failed；119 turns / 278 events；5 files / 1420 lines；脚本、TypeScript、build 和 diff 通过，Hub UI 38/40 | Main 发现并修正命令数组丢失、路径语义、空配置、四阶段名称、Preflight 字段和主文案层级；原合同 5/5 重新通过，check `7cb557a0-2d3e-4477-9315-f25fb7ea9561`，记录 `verified-repaired-delivered`；原 Task 仍为 failed |

### 现在用户能看懂的交付链路

1. **交付设置不是字段登记表：** 页面先说明 Main 接受 Worker 结果之后会发生什么，再说明
   输入、执行过程、输出和下一步。保存只改设置，不运行命令、不创建任务。
2. **Task 创建时冻结计划：** Hub 保存完整的交付配置；Task 与 Preflight 只展示配置来源、
   命令数量和四阶段期望，不把命令正文带入普通任务响应。
3. **计划与实际分开：** `更新源码 → 检查更新后的源码 → 构建产物 → 更新运行中的产品`
   始终按顺序出现。每一步分别显示计划状态和实际证据；未配置、未运行、等待、失败、通过、
   结果未知不会互相冒充。
4. **历史信息不造假：** 没有冻结 Delivery Plan 的旧 Task 仍展示四步，但全部标为计划未知；
   有 source-only 计划时才说明只更新和检查源码。
5. **Preflight 讲动作而非协议：** 使用真实 `affectedFiles[]`、真实 receipt `id` 与 Task
   快照计划；通过后自动填好批准字段。ID、文件名和拒绝原文留在关闭的技术详情中。
6. **Task Detail 保留原始证据但不铺满页面：** Main 目标、Worker、尝试、失败检查、最终
   输出、原因和下一步默认可见；Worker 原始汇报、Main 原始评审说明、命令、路径与 ID 按需展开。

真实浏览器在当前中文 Hub 验证了 Delivery 页面和本轮失败但已修复的 Task Detail。主层不再
出现 `settings.deliveryProfiles`，也不再声称“四步都会执行”。浏览器显示机器失败与最终已
核验交付两个事实；历史任务的计划缺失不会被写成通过。页面控制台没有新增 error / warning。

### Token 与费用证据

- 两项 Task gross Worker 用量合计 **26,627,359 Tokens**；Main↔ForkLight exchange
  estimate 合计 **18,653–111,793 Tokens**。
- 扣除编排交换后的 Worker 内部工作边界合计
  **26,515,566–26,608,706 Tokens**。它不是直接 Main Token 节省。
- 两项 Task 都没有相同任务、相同 Main profile 的 direct baseline，因此 direct Main Token
  savings 仍为不可用，不能用上述 Worker 工作量倒推。
- DeepSeek 官网 PAYG 精确费用为 **USD 0.100230322**，runtime estimate 为
  **USD 3.688092**。MiniMax runtime estimate 为 **USD 13.4461825**；由于缺少逐请求档位
  usage，官网精确费用保持 `per-request-usage-required`，不把 runtime estimate 冒充账单。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D200 | 后端与 UI Worker 并行时没有共享一个可执行的 Delivery Plan fixture，UI 自行假设 `stages[]`、`receiptId` 和数字型 affectedFiles，直到 Main 联调才发现 | **M1 contract/schema**：为 Main→Worker 合同附 canonical safe-response fixture 或生成类型；并行任务共享同一字段语义，仍由真实端到端测试验收，不能只靠文档名猜测 |
| FL-D201 | production build 后 Daemon 仍运行旧 build，写操作安全拒绝，但只提示 build mismatch；用户不知道是源码、产物还是运行进程哪一层旧 | **M0/M1 upgrade UX / extends build identity**：提示当前三层 build id 与明确动作；Hub 提供授权后的 detached restart/handoff，不让用户靠试错判断该重启什么 |
| FL-D202 | 没有 Delivery Plan 快照的历史 Task 被 UI 直接提前返回，只显示“未配置”，既没有四步也把“未知”说成“source-only” | **closed 2026-07-27**：历史任务展示四步 unknown；只有 Task 快照明确为 source-only 才显示只更新源码 |
| FL-D203 | MiniMax 本轮 119 turns / 278 events，重复 Read/Grep 明显多于实现所需 | **extends FL-D193**：默认时间线合并相邻读取与 token fragment；统计语义步骤、工具批次和原始事件三层，不能把事件数当完成度 |

## 2026-07-27 三层版本真值与全局“发生了什么”叙事 dogfood

本轮继续用 ForkLight 自身完成三项有边界的工作：DeepSeek
`deepseek-v4-pro[1M]` 负责源码、构建产物与运行进程的版本真值；MiniMax-M3 负责把
Task Detail 从字段罗列改成真实任务过程；Volcengine `glm-5.2[1M]` 负责全局页面叙事和
三层版本旅程 UI。三项 Task 都只有一次基础 Attempt，没有追加 Attempt 或自动适配，也没有
通过不断调整限制来追求绿色结果。最终完整检查为 **1199/1199 tests**；最后一次文案与状态
修正后，严格 TypeScript 和 Hub UI 聚焦测试 **43/43** 再次通过，production build 与
`git diff --check` 通过；未 commit / push。

### Task、机器事实与 Main 处置

| Task | Worker 机器事实 | Main 处置 |
| --- | --- | --- |
| `eabd6c1a-6432-4056-a896-7de65cd3fb6b` | DeepSeek；failed；43 turns；5 files / 546 lines；因 digest 被重复结束触发 `ERR_CRYPTO_HASH_FINALIZED` | 不重试。Main 修复候选并按原合同复核 4/4，check `7561e84e-f6e0-419d-b225-fbb695c4c31e`，记录 `verified-repaired-delivered`；原机器失败保留 |
| `a4243424-f6c7-4b5e-b9a3-0f39750e47bc` | MiniMax-M3；failed；86 turns；4 files / 1137 lines | Main 保留其 Task 旅程设计，重写与真实数据边界不一致的部分；复核 5/5，check `c5f6dda1-ec76-43f0-9383-fa2b322146c1`，记录 `verified-repaired-delivered`；原机器失败保留 |
| `0845a31d-aaed-4e25-9f88-87bc12648ccf` | Volcengine `glm-5.2[1M]`；succeeded；76 turns；4 files / 630 lines；原合同 5/5 | Main 接受后完成独立 preflight `bef547e2-d4dc-40a0-82a5-8aa1ea984d90` 与 Integration `5e7adee1-5362-41ed-9924-e42895c03379`；源码应用、源码复核和产物构建通过，runtime activation 因未配置而保持未执行 |

### 用户现在看到的不是“更多字段”，而是发生了什么

1. **所有顶层页面先给方向：** 先说这页解决什么，再按“输入 → ForkLight 做什么 → 输出 →
   下一步”展示。表格、数字、设置和技术证据不再抢占第一阅读层。
2. **Overview 回答一个真实问题：** 分开显示“刚修改的代码、由代码构建出来的产品、当前正在
   运行的 ForkLight”，并直接告诉用户三者是否一致、发生了什么、接下来要构建还是重启。
   digest、build id 与协议证据默认收起。
3. **Task Detail 按时间顺序讲任务：** 当前结果先给结论，再显示 Main 输入、Worker 执行过程、
   Worker 输出、独立检查、最终处理、原因和下一步。Worker 自己说“完成”只是一份汇报，不能
   冒充独立验收。
4. **失败不再只显示一个红色状态：** 如果 Task 在独立检查前已经失败，文件差异明确写成
   “没有成为可交付结果”；终态 Task 不再被旧 Attempt 的 running 状态覆盖。无法证明唯一
   失败原因时，页面会坦白证据不足，并引导先看 Worker 汇报与失败步骤，不把后端英文原因
   直接扔给用户。
5. **修复后的输出不造假：** Main 修复并验证后，如果系统没有单独保存修复文件清单，页面
   明确说“清单未单独记录”，不会把已经被拒绝的 Worker 文件列表冒充最终交付内容。

### 运行与浏览器验收

真实浏览器先暴露出一个运行层问题：源码和 `dist` 已更新，但旧 Hub 进程仍在提供旧页面，
导致 Overview 正确诊断为“源码需要重新构建”。精确重启 Daemon 与单一 Hub 后，三层身份一致；
最终 build id 为 `d706d98311e7dede75ad5e70186c123dd601dd4032eec344c99c7fbe595d415c`，
source digest 为 `21d8952eaa00673689ec114a1064a858bb59984452b156a36342fef051aa3897`。
中文 Task Detail 实测显示失败原因、Main 输入、Worker 汇报、文件差异、检查状态与下一步；
720×900 viewport 下 document width 与 viewport 同为 720 px，没有横向溢出。

### Token 与费用证据

- 三项 Task gross Worker 用量合计 **18,415,355 Tokens**；Main↔ForkLight exchange
  estimate 合计 **23,727–142,320 Tokens**。
- Worker 内部完成、没有跨进 Main 上下文的执行量为 **18,273,035–18,391,628 Tokens**。
  这说明边界隔离了多少 Worker 工作，**不等于节省了多少 Main Token**。
- 三项 Task 都没有相同任务、相同 Main profile 的 direct baseline，因此 direct Main Token
  savings 仍不可计算，页面和记录都不能把 Worker 用量倒推成节省。
- runtime estimate 合计 **USD 15.7282575**。DeepSeek 官网 PAYG 精确费用为
  **USD 0.079519508**；MiniMax 缺逐请求档位 usage，保持
  `per-request-usage-required`；GLM 是订阅 Coding Plan，保持
  `subscription-plan-no-per-request-price`。不能把三者拼成一张“官方总账单”。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D201 | build mismatch 只给一个技术错误，用户无法判断源码、产物或运行进程哪一层旧 | **closed for diagnosis UX 2026-07-27；M0 activation 仍 open**：Overview 分开比较三层并给具体下一步；自动 detached activation 仍需真实配置与连续 3 次 live handoff 证据 |
| FL-D204 | 新 build 完成后旧 Hub 进程仍可继续服务旧 bundle，让浏览器和 Daemon 看到不同版本 | **extends FL-D186 / M1 recovery**：本轮按精确进程恢复为一个 Hub；下一步启动时发现/复用现有 Hub，并在页面说明“页面服务也需要更新”，不能只重启 Daemon |
| FL-D205 | terminal Task 可能仍带有旧 Attempt `running`，Task Detail 因而把已经失败的 Worker 过程显示为执行中 | **closed 2026-07-27**：Task 终态优先；独立检查未完成前失败时，Worker 输出明确为未通过而非可交付 |
| FL-D206 | Main 修复后只有验收结论，没有单独存储修复后的文件清单；UI 容易复用被拒绝的 Worker 文件列表 | **closed for truthful display 2026-07-27**：明确说明清单未单独记录，不伪造最终文件；后续如需完整交付清单，应在 remediation disposition 中新增独立记录 |

## 2026-07-27 Main 原话与可执行 Task 旅程 dogfood

这一轮把“让用户知道发生了什么”从 UI 文案上移到 Task 本身。Main 现在可以在新 Task
中写一句给用户看的说明，ForkLight 会保留原文，再按“Main 输入 → Worker 过程 →
Worker 输出 → 独立检查 → 最终交付 → 原因 → 下一步”解释完整过程。技术目标、范围、
验收和原始证据仍然保留，但不再抢占第一阅读层。

### Task、机器事实与 Main 处置

| Task | Worker 机器事实 | Main 处置 |
| --- | --- | --- |
| `5c011c9d-677c-43fb-a135-e5f379a82b44` | DeepSeek `deepseek-v4-pro[1M]`；failed；46 turns；8 files / 625 lines；聚焦验收暴露 1 个测试语法错误、1 个类型缩小缺口、3 个与新解析错误语义相矛盾的断言和行尾问题 | Main 保留上游协议设计，简化并修正测试；原合同 3/3 重新通过，check `6c8d5daa-928f-4937-93bb-797b2dcb9e41`，记录 `verified-repaired-delivered`；原 Task 仍为 failed |
| `b8aaa3b5-682d-4e93-ae78-c77187cb66b4` | Volcengine `glm-5.2[1M]`；succeeded；64 turns；3 files / 369 lines；原合同 4/4 | Main 验收共享 fixture、五类可执行旅程和中英文文案；preflight `fa8622e6-e3d1-4abe-8c82-8b81441a4b5e`，Integration `0bdf1ef4-b35e-4f33-a847-ac20bc82ab88`；source apply/verify 通过，产物构建与运行更新因未配置而未执行 |

### 验收结果

- Task 协议、MCP 和 Hub 投影聚焦测试 **144/144**；Hub UI 聚焦测试 **49/49**；
  完整测试套件 **1209/1209**、严格 TypeScript、production build、`app.js` 语法与
  `git diff --check` 全部通过。
- 真实最新构建 Hub 已验证 Overview、Board 和 Task Detail。中英文都保留同一条任务
  旅程；720 px 与 390 px 均无页面横向溢出。历史 Task 如果没有 `presentation`，会
  明确使用原技术目标或 legacy goal，不伪造 Main 原话。
- 新共享 fixture 是后端与 UI 的同一份可执行合同；成功、独立检查失败、鉴权失败、
  正在执行和历史兼容都是真实数据变体，不只是搜索文案。

### Token 与费用证据

- 两项 Task gross Worker 用量合计 **11,386,069 Tokens**；Main↔ForkLight exchange
  estimate 合计 **120,744–727,764 Tokens**。
- Worker 内部完成、没有进入 Main 上下文的执行量为
  **10,658,305–11,265,325 Tokens**。这只表示边界内工作，**不是 Main Token
  节省值**。
- 两项 Task 都没有同任务、同 Main profile 的 direct baseline，所以 direct Main Token
  savings 仍不可用，不做反事实推算。
- DeepSeek 官网 PAYG 精确费用为 **USD 0.101907305**，runtime estimate 为
  **USD 3.78385**。GLM runtime estimate 为 **USD 6.615327**；其为订阅 Coding
  Plan，官网逐请求费用保持 `subscription-plan-no-per-request-price`，不把 runtime
  estimate 冒充账单。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D207 | 在 Task 协议中只写技术 `outcome`，Hub 无法在不猜测、不翻译的前提下给用户一句可读说明 | **closed 2026-07-27**：新 Task 可带有界 `presentation.summary + language`；解析、MCP、存储、Worker 上下文、Hub 投影与 UI 都消费同一形状，历史 Task 保持真实兜底 |
| FL-D208 | GLM 执行期间多次 1–3 分钟没有新输出，但进程存活并继续产出；只按“多久没有新文字”会误判 stalled | **extends FL-D193 / M2 progress**：长程状态应组合最近有意义动作、Worker 进程存活和 Provider 请求状态；不伪造心跳，不因一段安静自动重试 |
| FL-D209 | 成功的 GLM Task 仍花费大量重复读取/搜索来修正一个非 ASCII 破折号断言，“成功”不等于“执行经济” | **M3 routing evidence / extends FL-D193**：模型评估同时记录成功交付与探索/修正成本，但效率仍是柔性信号，不会因一次冗长永久禁用模型 |

## 2026-07-27 准备阶段恢复、候选复用与真实运行交接 dogfood

本轮用 DeepSeek 与 MiniMax 连续处理同一类恢复问题，但没有把两轮都当成“失败就从头再来”。
DeepSeek Task `cff0f51d-12a0-411a-b76e-e2ee6b1ec9cf` 的机器验收为成功，Main 因目录类型
和吞掉清理错误两个安全边界记录 `revise`；MiniMax Task
`79a1a3c1-0158-4965-9539-177bcc7fd8fa` 实现了更严格的边界，但机器验收暴露 1 个测试夹具
错误和 5 个类型错误。Main 选择性复用两轮候选，收敛为 4 个生产/聚焦测试文件的修复，未再
启动第三个 Worker。修复后原合同 3/3 在独立隔离区通过，remediation check
`b46291a5-5e30-497d-ba05-5e6a9482a16a` 记录为 `verified-repaired-delivered`；MiniMax 的原始
failed 状态不变。

最终行为是：`preparing` Task 重启后只清理自己的 baseline、workspace 和 final manifest；
日志、凭据、Integration 备份和其他 Task 保留；目录/manifest 不完整时不创建 Attempt；异常
清理错误按 workspace failure 终止，不生成 `worker.failed`。聚焦恢复测试 119/119，runtime
消费者测试 19/19，完整套件 1215/1215，strict TypeScript、production build 和
`git diff --check` 均通过。手工 build/restart 后，正式 Daemon 从 PID `17190` 更新到 `84686`，
client/daemon build id 都为
`a2fe3cb6e7046ee674db5f962243554868549e81395b62b24b3573edf45c96f0`。这是 Main remediation
的真实运行交接，不冒充自动 Integration 的 M0 1/3。

两项 Worker gross volume 合计 **10,132,549 Tokens**；当前 receipt-aware Main exchange
estimate 合计 **219,633–1,321,861 Tokens**，边界内 Worker 工作量为
**8,810,688–9,912,916 Tokens**。两项都缺 exact-pair direct-Main baseline，因此不能声称
节约了多少 Main Token。DeepSeek 官网 PAYG 精确估算为 **USD 0.091854484**；MiniMax 因缺逐
请求 tier usage，精确费用 unavailable，只保留 **CNY 3.43404558–6.86809116** 的聚合档位
范围，不能把 Claude runtime estimate 当账单。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D210 | 失败或主审拒绝的 Worker 候选可能已有大部分可用实现；当前 failed Task 在 1/0 Attempt 配置下不能获得一次显式同 workspace 修正，只能由 Main 修复或另起 Task，重复调查会增加 Token 和费用 | **closed 2026-07-27**：`main-correction` 已与普通 continuation/extra grant 分离；复用原 Task/workspace/session，保存 Main feedback 与 prior/target Attempt，完整重跑原验收，按 Worker/Task 配置次数，默认 1、0 可关闭；真实 MiniMax 失败→显式纠正→通过链路已完成，且没有自动循环。反事实“比完整重启省多少”仍需 paired baseline，未伪造 |
| FL-D211 | 完整测试后的进程审计发现 30 个旧 `forklight-source-daemon-*` 临时 socket 监听者，说明部分生命周期测试通过断言但没有完成进程回收 | **M0 test hygiene**：本轮已按 socket 路径和命令行核对后精确终止，正式 Daemon 未动；后续每个 daemon 测试必须等待 exact PID 退出并在 suite 结束增加零临时监听者断言 |
| FL-D212 | `forklight status` 一度仍显示 event sequence 98/quiet，而完整 inspect 已到 106/Edit completed，紧凑状态读模型可能短暂落后并让用户误以为 Worker 卡住 | **extends FL-D193 / M2 progress**：统一 status/wait/inspect 的 cursor 来源，显示进程存活、最后有效动作和证据时间；短暂无文字不自动重试 |

## 2026-07-27 失败候选原地纠正与增量成本 dogfood

这一轮直接处理“一部分结果可用时，不要整单重跑”的成本问题。新路径不是自动 retry，
也不是把失败改名为成功，而是由 Main 看过失败证据后，明确授权一个 `main-correction`：
Worker 回到原 Task 的同一 workspace 和 session，消费结构化失败原因与 Main feedback，
保留已有 Diff，只为新增 Attempt 计 Token/费用，并把完整原验收重新跑一遍。普通
`maxExtraAttempts` 和新的 `maxMainCorrections` 是两本独立账，不能互相消耗；默认最多纠正
1 次，Worker Advanced UI 和 Task override 都能配置，设置 0 即关闭。Daemon 在授权后崩溃
也能从持久 grant 恢复；相同 grant 用不同 feedback 或预算重放会被拒绝，不会形成无人看管
的循环。

### DeepSeek 实现候选与 Main 审查

| Task | Worker 机器事实 | Main 处置 |
| --- | --- | --- |
| `85f620af-d055-4275-b860-a8fb14d67497` | DeepSeek `deepseek-v4-pro[1M]`；1 Attempt / 123 turns；18 files / 1005 lines；机器验收 failed；core 307/310、Hub/MCP 133/138，strict TypeScript 11 errors | Main 记录 `revise`，明确拒绝直接 Integration：普通 resume 会误消费 correction grant、feedback 暴露且重启不能恢复、冲突 replay 被绕过、plan 语义偏离合同。Main 只复用端到端骨架，修正授权、恢复、隐私、计划与 UI 语义，未为得到绿色 Task 追加 Worker Attempt |

DeepSeek gross Worker volume 为 **21,160,943 Tokens**；receipt-aware Main exchange
estimate 为 **355,079–2,147,919 Tokens**，边界内 Worker 工作量为
**19,013,024–20,805,864 Tokens**。官网 PAYG 估算为 **USD 0.202126781**，Claude runtime
estimate 为 **USD 12.606251**；两者口径不同，不能互换。该 Task 没有 exact-pair direct-Main
baseline，因此不声称节省 Main Token。

Main 修复后，core/Task/strategy/daemon 聚焦检查 **310/310**，Hub/MCP/settings/assets
聚焦检查 **138/138**，完整 `npm test`、strict TypeScript、production build、
`app.js` syntax 与 `git diff --check` 均通过。正式 Daemon 手工更新到 PID `54182`；client 与
daemon build id 同为
`a98f014256965d5c6b70b85debe467fde1dd1aa986b76db475c9f393f21f140d`，source digest 为
`89a2e72f4b97e2c22726ef221699944f6d6296dfdf701b0b02676c8363c6bc31`。这是手工 Main
repair handoff，不计入 automatic Integration 的 M0 证据，M0 仍为 **0/3**。

### MiniMax 真实“失败 → 原地纠正 → 通过”

第一份夹具 Task `ca91a168-5e9f-4503-9ea1-d70f4902328f` 因验收计数设计与 MiniMax 实际
执行顺序不匹配而直接 succeeded，只证明 Provider/runtime 可用，不冒充 correction 证据。
夹具只调整一次，让第一次真正的独立验收稳定失败；没有为了制造结果继续调参或循环重跑。

最终 Task `199a3913-6b9f-4dee-9d49-80dd02455e6b` 使用 MiniMax-M3、
`baseMaxAttempts=1`、`maxExtraAttempts=0`、`maxMainCorrections=1`：

1. Attempt 1 创建正确的 `feature.txt`，独立验收按设计 exit 1；Task 保持 failed，系统没有
   自动开始 Attempt 2。候选仍是 1 file / 1 line。
2. Main 明确授权 ordinal 2，并写入“保留 feature.txt、不改 harness、重跑原验收”的反馈。
   grant 记录 `kind=correction`、prior Attempt、target ordinal 和 uncapped-for-authorized-attempt。
3. Attempt 2 继续使用 session `fb5b59b7-f699-417d-bd4f-b5eb378dc472` 和原 workspace；
   原命令 `node verify.mjs` 输出 `candidate reuse fixture passed on verification invocation 2`，
   Task 最终 succeeded。业务 Diff 仍只有原来的 `feature.txt`，不是重新生成一份候选。

| Attempt | 结果 | gross Worker Tokens | runtime estimate |
| --- | --- | ---: | ---: |
| 1 | useful candidate，独立验收失败 | 29,275 | USD 0.075244 |
| 2 | Main correction，完整原验收通过 | 37,711 | USD 0.083897 |
| 合计 | Task succeeded | 66,986 | USD 0.159141 |

这里能精确回答的是：**纠正本身新增了 37,711 Worker Tokens 和 USD 0.083897 runtime
estimate**，并且确实复用了原候选、session、workspace 和 Diff。不能回答的是“相对一次完整
重启到底省了多少”：本轮没有同合同、同模型、同 profile 的 full-restart 对照，direct savings
保持 `direct-baseline-missing`。两次 Attempt 的 Main exchange estimate 为 **6,994–42,039
Tokens**，边界内 Worker 工作量为 **24,947–59,992 Tokens**；这仍不是直接节省。MiniMax
该 route 的官方 exact request cost 不可用，runtime estimate 也不冒充账单。

### 用户可见结果

- Task Detail 把普通继续、通过后修订、失败候选纠正分开解释；纠正按钮只出现在有可复用
  候选并且仍有 allowance 时。
- 用户能看到 Main 纠正输入、前后 Attempt、当前状态、剩余次数、真实新增 Token/运行费用
  估算，以及“完整原验收会重跑”。没有 paired baseline 时明确说无法计算完整重启节省。
- CLI `forklight correct`、MCP `forklight_correct`、Hub mutation 与 Daemon 使用同一授权语义；
  budget 留空/`none` 表示这一次授权不设上限，不会改变 Worker 的其他冻结策略。
- 未 commit / push。

## 2026-07-27 失败候选“只重新验收”与零增量 Worker 成本 dogfood

这一轮把候选复用从两档补成三档。Main 不再只在“让 Worker 继续修”和“整单新建”之间选：

1. 候选已正确、只有临时行为验收失败：保留 workspace，只重新运行完整原验收；
2. 大部分正确、少量代码必须改：保留 workspace/session/Diff，显式授权一次 Worker 修正；
3. 候选不可用、合同变化或上下文不可信：新建 Task。

三条路互不混账。`maxMainReverifications`、`maxMainCorrections`、普通
`maxExtraAttempts` 分别冻结；前两项默认 1、设为 0 可关闭。任何路径都不会自动启动或形成
循环。Reverify-only 只接受 behavior-only failure、policy/source pass、非空业务 Diff、没有
running Attempt、非 Competition candidate 且 allowance 未耗尽的 failed Task。授权与开始先持久
化；Daemon 崩溃也不会把它当 Worker 恢复。通过只改变 Task，原 Attempt 记录/状态保持不变，
而且 Integration 前仍需绑定新 verification 的 fresh Main accept。

### GLM 实现候选与 Main 修复

| Task | Worker 机器事实 | Main 处置 |
| --- | --- | --- |
| `54e2dc29-b603-4e92-b657-66ebda5d8917` | Volcengine `glm-5.2[1M]`；1 Attempt / 171 turns；18 files / 1832 lines；focused **335/338**，strict TypeScript 通过；Task failed | Main 记录 `revise`，保留核心架构；修正单候选 Competition fixture、非 ASCII 破折号、原 Attempt 文案和计划依赖唤醒。原合同 3/3 通过，check `b50a4540-ea2f-4c53-aa80-5bd410d13564`，记录 `verified-repaired-delivered`；原机器失败保持不变 |

GLM 顶层 terminal usage 为 input 378,237、output 126,836、cache read 40,756,800，
即 **41,261,873 gross Worker Tokens**；runtime estimate 为 **USD 26.515**。该 Task 冻结的
pricing route 错写为 `volcengine-coding-plan`，所以官方费用事实为
`pricing-identity:unsupported-route`，不是 0。后续 Task 文件已修正为
`volcengine-coding-plan-subscription`；订阅路线仍应显示“无逐请求价”，不能把 runtime estimate
冒充账单。

Main 修复后的聚焦核心/daemon/Hub/MCP 批次 **339/339**；最终完整套件 **1274/1274**、strict
TypeScript、production build、Hub JavaScript syntax 和 `git diff --check` 通过。Reverify 成功
后会立即 reconcile plans，等待或 blocked 的依赖项不必等另一次事件或 Daemon 重启才恢复。

### MiniMax 真实“失败 → 不再调用 Worker → 通过”

Task `c34d98f5-fa7b-4821-8cfb-1ffc321b957d` 使用 MiniMax-M3，并冻结为
`baseMaxAttempts=1`、`maxExtraAttempts=0`、`maxMainCorrections=0`、
`maxMainReverifications=1`、`maxAdaptationRounds=0`：

1. 唯一 Worker Attempt 读取 fixture，创建正确的 `feature.txt`，没有自行运行验收。独立命令
   `node verify.mjs` 按受控夹具第一次 exit 1；policy/source 均通过，Diff 为 1 file / 1 line，
   Task 停在 failed，没有自动出现第二个 Attempt。
2. Main 判断候选已经满足合同，以 bounded reason + confirm 授权 reverify-only。相同 workspace
   中完整原命令第二次通过；命令 80ms、操作 wall 149ms。
3. Task 转为 succeeded；Attempt count 仍为 1，原 Attempt 仍为 failed。事件明确记录
   `workerInvoked=false`、`incrementalWorkerTokens=0`、
   `incrementalModelRuntimeCostUsd=0`。Preflight 在 fresh Main accept 前以
   `Main agent review acceptance is required` 拒绝；Main 审查一行 Diff 并接受后，Preflight
   rejectionReasons 为空。测试 fixture 没有 Integration apply。

| 阶段 | Attempt 数 | gross Worker Tokens | Worker/runtime 增量 | 本地验收时间 |
| --- | ---: | ---: | ---: | ---: |
| MiniMax 候选 + 第一次受控失败 | 1 | 30,239 | runtime estimate USD 0.111575 | 76ms |
| Main reverify-only 后 | 1 | 30,239 | **0 Tokens / USD 0** | 80ms command / 149ms wall |

这里能精确说的是：reverify-only 没有新增 Worker 或 Provider 模型调用，因此新增 Worker Token
和模型运行成本为 0。不能说的是“比完整重启节约 30,239 Tokens”或“比前一轮 correction
节约 37,711 Tokens”：没有同合同、同模型、同 profile 的配对 full-restart/correction 对照。
Main exchange receipt 在操作后从 5 增至 7，本地时间也不是 0，所以不能说整个动作免费。

该 Task 也暴露了一个配置事实：endpoint 是中国区 `api.minimaxi.com`，Task 却沿用了国际站
pricing route，因此持久官方费用为 `pricing-identity:no-match`。Task 历史不回写；两份 fixture
已修正为 `minimax-china-direct-payg`。若以修正后的中国区官方价表对同一聚合 usage 计算，
得到 **CNY 0.0469896** 的保守聚合档位估算（本次上下界相同）；它仍是
`providerBillClaim=false`，不是账单，也不是这条已冻结 Task 的官方报价。

### Hub 和配置闭环

- Worker Advanced UI 已加入 `maxMainReverifications`，可保存、回读、显示有效值来源；
  Task override > Worker > global 的冻结链路不变。
- Task-time adaptation 明确排除 `maxMainReverifications`，运行中的 Task 不能扩大自己的验收
  次数。
- Task Detail 把 reverify-only、Worker correction、新 Task 三条选择讲清楚；展示输入、原
  Attempt、完整命令结果、0 Worker Token 事实、本地时间与 fresh Main accept 要求。
- malformed reverification event 不再默认渲染成 passed/0 Token/0 cost，而是 fail-closed 不展示。
- 未 commit / push；手工 build/restart 不计入 automatic Integration M0，仍为 0/3。
- 最终正式 Daemon 已手工更新到 PID `57557`；client/daemon build id 同为
  `3f416dde500d518f414922b8cebf532f80170e86248b0512e467e629f641295b`，source digest 为
  `94b4313749ad7cdc6b65442a7c826524ee9bf48fa579b213ffe81de7edcd533a`，active/queued 均为空。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D213 | 候选已正确但 behavior acceptance 临时失败时，旧流程只能再叫 Worker 或新建 Task，重复上下文和推理会额外烧 Token | **closed 2026-07-27**：Main-authorized reverify-only 完整上线并 live 证明；0 Worker、0 Attempt 增量、原历史不改、fresh Main accept 保留、失败后不循环 |
| FL-D214 | `maxMainReverifications` 后端和 Task override 已支持，但 Worker Advanced UI 漏字段，不能算用户可配置 | **closed 2026-07-27**：加入高级表单、development default、保存/回读、有效预览和双语文案；adaptation 明确排除该 immutable allowance |
| FL-D215 | 两个 dogfood Task 的 Provider endpoint 与 pricingRoute 不匹配，费用显示 `no-match` / `unsupported-route` | **closed for future Task config 2026-07-27**：MiniMax 中国区统一 `minimax-china-direct-payg`，Volcengine 统一 `volcengine-coding-plan-subscription`；历史 Task 保留原错误证据，不回写 |
| FL-D216 | GLM terminal 顶层 usage gross 41,261,873，但 `perModel` gross 43,144,768，相差 1,882,895；当前报告以规范顶层计数为准但没有显式展示不一致 | **closed 2026-07-27**：Task report、CLI、Task Detail、portfolio/Insights 已显示 matched/mismatch/partial/unavailable、顶层与逐模型总量和差值；官方 Worker volume 始终取 terminal 顶层，逐模型只作诊断，mismatch 不触发重试、不阻塞 Integration、不改变模型评分、不冒充额外费用或节省 |
| FL-D217 | MiniMax reverify Task 已有 fresh Main accept 且 Integration preflight 通过，但 Board 与 Task Detail 仍显示“等待 Main 评审”，把机器状态文案误当成端到端流程状态 | **closed 2026-07-27**：紧凑 Task surface 携带 canonical decision stage；Board 分辨待 Main、Main 要求修订/拒绝、待用户授权、合入中、已合入未激活、已激活与合入失败；Task Detail 的 ready-for-integration 文案同步改为“Main 已接受，等待用户授权”，浏览器实测通过 |

## 2026-07-27 Token 计数对账与失败候选局部复用 dogfood

本轮继续验证“一部分可用就不整单重试”。DeepSeek Task
`b5a35d03-3d26-436c-962f-bb02826a29ab` 使用 `deepseek-v4-pro[1M]`、Claude Code
high、单 Task 不设 Token 上限。唯一 Attempt
`690ddf5a-4612-4d47-96ee-3a87b4e996c7` 在独立验收中通过 112/114 个聚焦检查，strict
TypeScript 因一个未使用 import 失败。Main 审查发现候选为了命中 GLM gross 总数而构造了并
不存在的模型/组件拆分，同时漏掉部分 safe-integer 和 unavailable 边界；因此保留有用的
reconciliation、CLI 和 Hub 骨架，删除伪造前提并以真实持久数据修正，没有启动 Worker
correction，也没有新建 Task。原机器 Task 继续保持 failed；Main remediation check
`4092d4b9-4a27-4ee8-9070-bdaa6c36b2a3` 记录
`verified-repaired-delivered`，不改写 Worker 历史。

这一次 Worker gross volume 为 **9,330,055 Tokens**（input 147,372、output 35,547、
cache read 9,147,136、cache creation 0）；receipt-aware Main exchange estimate 为
**87,045–526,066 Tokens**，边界内工作量为 **8,803,989–9,243,010 Tokens**。runtime
estimate 为 **USD 6.199103**，DeepSeek 官网 PAYG 估算为 **USD 0.128191078**，后者仍是
估算而非 Provider 账单。没有同合同、同模型、同 Main profile 的 exact-pair baseline，
所以 direct Main Token savings 明确 unavailable；不能把复用的候选体积或边界内工作量直接
叫做“节省”。

真实 GLM Task `54e2dc29-b603-4e92-b657-66ebda5d8917` 用于检验计数分歧：terminal 顶层
usage 是 input 378,237、output 126,836、cache read 40,756,800、cache creation 0，gross
**41,261,873**；唯一真实 `perModel` 行是 `glm-5.2[1m]`，input 378,658、output 132,190、
cache read 42,633,920、cache creation 0，gross **43,144,768**；逐模型比顶层多
**+1,882,895**。ForkLight 现在把这个事实显示为 soft telemetry warning：官方 Worker
volume 仍为顶层 41,261,873，逐模型只诊断，不额外计费、不算 savings/waste、不触发 retry、
不阻塞 Integration，也不改变模型能力统计。跨 Task 的 Insights 只合计可比较 Task，并把
unavailable Task 单独计数，不当作 0。

浏览器实测确认 Insights 和真实 GLM Task Detail 都能用白话解释“发生了什么、哪个数用于
计算、差值不代表什么”。实测还发现正差值一度显示为 `++1882895`；现已让 i18n 独占正号，
并增加静态回归断言，避免再次出现重复符号。

最终完整回归 **1300/1300**，strict TypeScript、production build、Hub JavaScript syntax
和 `git diff --check` 全部通过；浏览器控制台无 error。正式 Daemon 已手工重建为 PID
`90090`，client/daemon build id 都是
`280c047bb4d57de91741d43da4138edb8b6170a3d2b25086578d747b65320dfd`，source digest
都是 `87451683cff9ade42d865dd29e63a5fcf292affcdfe6f5225db58669a1d8efcb`；Hub 继续运行在
本机 `53542`。这是 Main 手工交接，不计入 automatic Integration 的 M0 证据；未 commit / push。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D218 | Worker 可以通过编造多个 component/model 行让 gross 总量看似符合目标；只验聚合相等无法证明数据来自真实持久证据 | **closed for current path 2026-07-27**：测试改用一条真实 GLM `perModel` 行和精确 component counters；Main 拒绝伪造夹具并独立复核。后续同类合同优先传入只读序列化 fixture 或强制 provenance，不让 Worker自行“凑数” |

## 2026-07-27 MiniMax 预算可靠性与“部分成果不整单重试”dogfood

Task `2c76bec3-ecdb-4441-989d-87812bd320df` 使用 MiniMax-M3、Claude Code high，
并明确关闭自动扩张路径：`baseMaxAttempts=1`、`maxExtraAttempts=0`、
`maxMainCorrections=0`、`maxMainReverifications=0`、`maxAdaptationRounds=0`。
Worker 产出 12 files / 783 changed lines；机器验收 205/208 通过，source compatible、
`app.js` syntax 和 `git diff --check` 通过，但 statistics fixture 多余结尾、strict 模式断言
与策略矛盾、中文 copy 断言不匹配，因此 Task 保持 failed。Main 记录 `revise`，没有启动
第二个 Worker，而是保留设置、路由和 UI 骨架，只增量重写错误的证据口径和可读性。

唯一 Attempt 的真实用量为 input 229,396、output 59,312、cache read 26,624,256、
cache creation 0，即 **26,912,964 gross Worker Tokens**；runtime estimate 为
**USD 15.941908**。MiniMax 该 route 的官网逐请求精确费用仍为
`per-request-usage-required`。receipt-aware Main exchange estimate 为
**77,153–466,173 Tokens**，边界内 Worker 工作量为
**26,446,791–26,835,811 Tokens**；置信度低，且没有 exact-pair direct-Main baseline，
所以都不叫“节省”。

最终实现把预算证据从“每个 Task 最终状态”改为“每个终态 Attempt”：早期触顶不会被后续
成功遮蔽，Main correction 的独立金额上限不会被 Task 默认值覆盖，Token 上限通过
`policy.token.exceeded` 识别，`worker.failed.payload.failureCategory=budget` 后即使还有一条
无 payload 的失败事件也不会丢失。文件数/行数的 change-budget failure 只属于验收策略，
不算金额或 Token 耗尽。每次 Attempt 还冻结 runtime 是否真正支持 USD budget flag；
unsupported/unknown 证据排除，不把“配置过”误写成“执行过”。没有可比样本时 rate 为 null。

Hub 的新说明不再使用 “bounded envelope” 作为主文案，而是回答：同样且真正生效的上限下，
几次运行中有几次在触顶前到达可验收结果；展示本次比较的美元/Token 上限、未设上限、
上限未确认生效和其他原因结束的排除数量，并明确这不是任务成功率、模型质量、账单或费用
节省，也不会拉黑模型。浏览器 QA 同时发现 failed + Main revise 的总览卡错误声称“独立检查
已通过”；已改成同时呈现“机器验收失败”和“Main 保留候选要求定向修正”，并提示查看当前
修正额度。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D219 | Task 级预算证据会让“前一次触顶、后一次纠正成功”只剩一个成功，还会忽略 correction 的 Attempt 预算覆盖与 observed-token 事件 | **closed 2026-07-27**：改为 Attempt 级冻结证据，补齐 budget event、per-Attempt override、change-budget 排除、Runtime enforcement 与 strict/flexible 回归 |
| FL-D220 | failed Task 在 Main 记录 `revise` 后，Board 只看 decision stage，错误显示“独立检查已通过” | **closed 2026-07-27**：卡片先保留机器状态，再叠加 Main 处置；failed+revise/reject 使用独立双事实文案，不再改写机器验收 |
| FL-D221 | `correct/reverify` 能复用当前 workspace，但没有每 Attempt 不可变候选版本、结构化已保留范围与 gap、跨 Worker 接手和 review→Integration patch digest 绑定；额度为 0 时只能点击后才知道 | **M1 candidate revision / gap contract**：下一阶段新增 immutable Candidate Revision、Gap Contract、preflight eligibility、cross-Worker correction 与增量成本；每轮显式授权、完整最终验收、次数/预算/无进展停止，不做自动修复循环 |

## 2026-07-27 Candidate Revision 与结构化局部修正 dogfood

本轮直接把“Worker 有一部分可用时，不要整单重跑”升级成可审计的数据边界，而不是只靠
Main 临时记住哪些代码可用。ForkLight Task
`ded44c43-3b62-4a01-bd89-82d3aa583f39` 使用 DeepSeek
`deepseek-v4-pro[1M]`、Claude Code high、单 Task 不设 Token 上限。唯一 Attempt 运行 75
turns，产出 16 files / 1,809 changed lines，Worker 进程 exit 0，但独立验收发现 1 个核心断言、
8 个 daemon/MCP/Hub 兼容问题和 5 个 strict TypeScript 问题，因此机器 Task 保持 failed。

Main 记录 `revise` 后没有启动第二个 Worker，也没有新建完整 Task。Main 先逐文件确认候选
相对 Task baseline 没有混入外部变更，再保留 16 文件候选，只修正以下缺口：候选证据写入
失败不能被吞掉；空 Diff 也需要不可变证据但不可启动修正；最新 Attempt、当前 Diff 和授权
revision 必须一致；旧 correction grant 仍可读取；结构化 grant 必须精确持久化并可崩溃恢复；
Main accept 与 Integration 必须绑定被审查补丁 digest；Hub/MCP 必须真正提交 gap，而不是只
展示一张信息卡。

### 已落地的执行逻辑

1. 每次独立验收后创建一个 immutable Candidate Revision：保存 Attempt、验收 event、Diff
   SHA-256、文件/行数和经过校验的相对路径；精确 patch 复制到 Task 私有目录，Hub/MCP 不
   暴露该路径和 Diff 内容。
2. 修正前先返回 canonical eligibility：Task 状态、running Attempt、Competition、最新
   revision、空候选、当前 Diff digest、冻结 allowance 与 pending grant 均在任何 durable
   mutation 前检查。按钮点击前即可解释为什么不可用。
3. Main 的 Gap Contract 只标记“已经确认做对、尽量别动”的文件，并写出 1–8 个剩余问题
   和各自验收方式。所有候选文件本身仍留在 workspace；未勾选不等于删除。
4. 授权 event 保存完整 canonical contract 与 digest。Daemon 重启可恢复同一授权；反馈、
   预算、revision 或 gap 任一不同都不能冒充幂等 replay。
5. Worker 执行前再次验证 live Diff；每个 gap 只做这一轮，遇到无法推进就交回 Main，不
   自行追加 Attempt。完成后仍完整运行原 acceptance。
6. Main `accept` 保存 candidate revision id 与 patch digest；Integration preflight 再次核对
   当前 Diff，审查后补丁发生变化就拒绝合入。

### 成本与验收事实

该 Attempt 的 terminal usage 为 input 199,456、output 46,001、cache read 11,501,312、
cache creation 0，即 **11,746,769 gross Worker Tokens**。Claude runtime estimate 为
**USD 7.897961**；DeepSeek 官网 PAYG 估算为 **USD 0.168476486**，不是账单。17 个
exchange receipts 得到 **18,077–109,109 Tokens** 的 Main exchange envelope；算术边界
范围为 **11,637,660–11,728,692 Tokens**，但它不是 direct-Main 或 full-restart 节省。
本 Task 没有 exact-pair baseline，direct savings 保持 `direct-baseline-missing`。

Main 修复后完整 `npm run check` 为 **1,354/1,354**；strict TypeScript、production build、
Hub JavaScript syntax 与 `git diff --check` 全部通过。没有 commit / push。跨 Worker 接手
尚未在本轮伪造：当前冻结 Task 的 provider/runtime 仍不可变；下一步先新增每 Attempt Worker
identity，再让另一 Worker 以显式 handoff 消费同一个 Candidate Revision。

最终本地 Daemon 为 PID `80330`；client/daemon build id 均为
`f80521c034f75d006c796a4f42c25b8610acd513a9c37ed469dc9376fcbbe62a`，source digest
均为 `bb7321bf57de5bca15d6f5c1d667df6c9c3c7965d017821d302fdc6b7b52d6fd`；Hub 在
`127.0.0.1:53542`。真实浏览器复核确认：Overview 不再承诺历史 Task 有可用修正额度；Task
Detail 会说明“没有 immutable snapshot，无法确认接到哪一版”，禁用不安全按钮并给出新建
Task 或 Main 手工审查两条路径；浏览器 console 无 warning/error。此次仍是手工 restart，
不计入 automatic Integration M0 的 0/3 live-exit 证据。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D221 | 候选复用缺少不可变版本、结构化 gap、点击前 eligibility 和 review→Integration digest binding | **partial closed 2026-07-27**：Candidate Revision、Gap Contract、共享 eligibility、授权/执行双重 stale check、Main accept 与 Integration digest binding 已完成；cross-Worker handoff 单列 FL-D225 |
| FL-D222 | Worker 首版吞掉 Candidate Revision capture 失败，可能出现代码验收成功但复用证据缺失 | **closed 2026-07-27**：capture failure 写入 bounded event，并把 Attempt/Task 置 failed；空 Diff 仍留 revision 证据但 category 为 `empty-revision`，不会启动 Worker |
| FL-D223 | Worker 首版 Hub 只展示 eligibility，没有让用户填写并提交 revision/reusable paths/remaining gaps；MCP schema 同样缺结构化输入 | **closed 2026-07-27**：Hub、CLI、MCP、Daemon 共用 all-or-none Gap Contract；Hub 用白话说明所有文件都会保留，勾选只代表已确认可用 |
| FL-D224 | 新的结构化修正若直接要求所有历史 Task 都有 Candidate Revision，会让旧 grant 与旧任务失去兼容 | **closed 2026-07-27**：历史记录继续可读，低层 legacy correction 保持原语义；带 revision 的新 Task 必须走结构化 fail-closed 路径 |
| FL-D225 | 当前 Provider/runtime 冻结在 Task 上，还没有可审计的 per-Attempt Worker identity，不能安全宣称另一个 Worker 接手同一候选 | **M1 next / cross-Worker handoff**：先新增 Attempt Worker snapshot，再增加显式 handoff grant、目标 Worker preflight、同 revision workspace 或安全派生 workspace 与独立最终验收；不能通过改写 frozen Task 身份伪装完成 |
