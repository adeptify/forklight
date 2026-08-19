# 把 ForkLight 做成强 Main 主导的通用执行系统
> 状态：confirmed · 模式：long-run · Runtime：codex · 清晰度：98/100 · 预算：长期 Goal 不设总 Token 或墙钟上限；各 Worker Profile 和 Task 的预算、并发、无进展超时及修复安全上限可配置，不能自动无限续期

## 需求复述

归档已完成 M1 的旧 Goal，建立一个新的唯一长期 Goal，从 M2 推进到 M5。Main 负责理解背景、设计 Goal/Plan/Task、拆分正交 Work Item、调度、审查和关键决策；Worker 通过真实 Runtime Goal 或诚实的持续执行策略完成研究、实现、验证和基于新证据的修正。项目优先通过 ForkLight 使用 Grok CLI 4.6 Xhigh，并利用独立 Judge Worker 提高质量；迭代以里程碑结果为中心，不为自证、测试数量或理论边角无限打磨。CLI/API 全部毕业后再统一设计 Hub，Task 工作空间必须有可审计的回收生命周期。

## 目标终态

在保留已毕业M1能力的基础上完成M2至M5：Main能把Coding和非Coding目标拆为有依赖的正交工作波次，ForkLight优先调度Grok CLI 4.6 Xhigh及其他合适Runtime，使Worker通过真实Goal或诚实持续策略完成执行、自检、独立验证、Judge审查、基于证据的修正、部分成果复用和安全Integration；CLI/API能够完成全部核心流程并管理Task空间生命周期；随后统一设计Hub。每个已毕业代表任务族都必须在交付质量不低于同范围直接Main基线时，用可审计成对证据证明Main Token下降，并单独透明报告Worker Token、费用、时间和修正成本。

## 验证面

- `npm install`
- `npm run check`
- `node dist/src/cli.js doctor --json`
- `node dist/src/cli.js health --json`
- `node dist/src/cli.js goal list --json`
- `node dist/src/cli.js board --json`
- `node dist/src/cli.js stats --json`
- 产物：`goals/forklight-main-led-execution/plan.md`
- 产物：`goals/forklight-main-led-execution/progress.md`
- 产物：`goals/forklight-main-led-execution/decisions.md`
- 产物：`goals/forklight-main-led-execution/evidence/m2-delivery-graduation.md`
- 产物：`goals/forklight-main-led-execution/evidence/m2-storage-lifecycle.md`
- 产物：`goals/forklight-main-led-execution/evidence/m3-routing-graduation.md`
- 产物：`goals/forklight-main-led-execution/evidence/main-token-pairs.json`
- 产物：`goals/forklight-main-led-execution/evidence/clean-clone-run.md`
- 产物：`最终Hub桌面/移动端验收截图与Impeccable结论`
- 证据来源：真实Coding与非Coding长程dogfood的Task、Attempt、Candidate、验证、Judge、修正、Main决策和Integration链
- 证据来源：Daemon或Runtime中断后的恢复与继续执行证据
- 证据来源：Task空间保留理由、清理预览、回收结果、孤儿检测与Store完整性证据
- 证据来源：三个代表任务族的真实路由、失败归因和人工覆盖证据
- 证据来源：同范围同验收的直接Main与委派执行成对样本
- 证据来源：陌生开发者clean-clone和最终Hub可用性观察

## 约束

- M1已经毕业，不重新实现或反复自证；旧Goal归档为历史证据，新Goal是唯一当前项目管理入口。
- ForkLight当前按单人本地使用设计；不得为假想多人协同、分布式一致性或跨节点版本协调增加checksum、内容寻址、锁、租约、版本握手和重复校验。现有或新增校验必须能直接防止数据损坏、协议无法读取、Candidate基线失配或错误Integration，否则删除或不做。
- Main拥有目标、Work Item依赖、验收、路由、审查、冲突裁决和Integration/commit/push授权；Worker拥有普通执行。
- 每个Milestone先拆正交Work Item和依赖波次；项目开发默认一波最多三个修改面不重叠的实现Worker，额外并发优先用于只读Reviewer/Judge；实际并发由配置和正交证据决定，Main串行Integration。
- 项目开发默认优先Grok CLI 4.6 Xhigh；只有健康检查和最小Smoke证明可运行后才使用。高风险Judge可使用不同Runtime减少共同盲区。
- 不伪装Runtime能力：已用官方1.0.3源码和真实隔离Smoke证明Grok CLI自己的`/goal`具备可观察身份、状态、终态和同Goal恢复；ForkLight适配器在该能力集成并通过真实Task前仍诚实使用persistent-session，毕业后新Grok Task优先native-goal，历史Task不重标。
- Worker先自检，ForkLight独立验收；有意义的普通交付默认一个Judge，高风险核心链默认两个，最多三个且仅用于真实分歧。Judge只读，Main最终裁决。
- 修复次数、Attempt、时间、Token、文件和行数是Worker/Task可配置的安全保险，不是Goal写死的完成条件；文件和行数开发期默认只警告。
- 继续执行取决于有效进展而非固定轮次；验收通过立即停止，重复失败、无新增证据、补丁互相补偿或需要越过Spec边界时返回Main。
- 复用已通过的路径和部分成果，修剩余缺口；不得因为局部失败自动整项重做、换模型重跑或启动Competition。
- 每个Task必须有空间处置：执行/审查中保护完整Workspace，终态后保留必要证据并回收可再生Workspace、Runtime Home和缓存；不得删除未提取的Candidate或部分成果。
- 核心CLI/API、诊断和clean-clone先毕业；M5之前不零碎重做Hub，M5使用Impeccable一次统一设计。
- 只有跨项目可复用、用户可理解、可配置并可验收的重复行为进入ForkLight产品；ForkLight自身模型偏好、文档流程和一次性恢复留在AGENTS、Profile或Evidence。
- 不为增加测试数、制造dogfood数据、形成模型排名、证明系统复杂性或修复非阻断理论边角创建Work Item。
- 里程碑内可自动开始下一就绪波次；跨里程碑展示用户结果并等待一骏确认。
- 不得reset、覆盖其他任务成果、读取或改写Provider凭据，也不得未经授权commit或push。

## 边界

- 包含：M2持续高质量交付：Runtime策略、依赖波次、恢复、自检、独立验证、Review Graph、证据驱动修正、复用、交接、安全Integration和Task空间生命周期、M3证据驱动智能委派：任务族、路由建议、可信度、人工覆盖、例外Competition、失败归因和模型/执行策略历史、M4 Main Token杠杆：公平成对样本、质量门槛、Main Token变化以及Worker Token/费用/时间透明报告、M5产品毕业：CLI/API clean-clone、配置诊断、备份恢复、最后的Impeccable Hub和30分钟首次交付、ForkLight自身通过ForkLight完成有意义的实现与独立审查
- 不包含：多人组织权限、云同步和托管SaaS控制面、为单人本地开发引入分布式协调、多人并发控制、普遍checksum/content hash、跨节点版本握手或重复一致性证明、正式开源治理、社区运营、签名App、自动更新和App Store、在CLI/API毕业前继续零碎Hub视觉修补、为了统计而重放任务、默认Competition、无限Judge对话和自动无限重试、为正交Work Item新建一套与Goal/Plan/Task平行的数据模型、只服务ForkLight自身开发的元协调、元证明或复杂状态系统
- 允许：`/Users/yijunwang/code/forklight`、`/Users/yijunwang/Library/Application Support/ForkLight（只按已批准的Task运行、空间预览、备份和清理边界）`
- 禁止：`其他产品仓库`、`Provider凭据和Keychain内容`、`未形成保留/删除判定的活动Task Workspace`、`远端Git仓库（未经明确授权）`

## 指标

| 指标 | 基线 | 目标 | 测量 |
|---|---|---|---|
| 总体里程碑 | M1已毕业，整体1/5 | M2、M3、M4、M5逐项满足独立退出条件，整体5/5 | progress.md只在对应证据文件、真实命令和Main审查全部通过后更新 |
| M2端到端交付 | 已有大量基础能力，但持续执行、互审、复用和空间回收尚未作为统一产品闭环毕业 | 至少一项Coding和一项Non-Coding长程任务在中断恢复后由Worker完成并通过独立验证、Judge和Main审查，Main不接管普通执行 | 同一Task lineage、恢复事件、Candidate、验证、Judge、修正和Integration证据 |
| Task空间生命周期 | 历史Task与完整快照曾产生大规模Workspace和孤儿进程 | 所有终态Task都有明确保留理由或已回收可再生空间；活动/待审成果零误删；空间审计无未知孤儿 | 清理预览与结果、进程/目录归属、Store quick_check和外键检查 |
| M3路由证据 | 已有统计和路由基础，但证据覆盖不完整 | 至少三个代表任务族有可审查建议、可信度和人工覆盖；证据不足时明确cannot determine | 真实交付、失败归因、Judge/Main决策和路由投影 |
| M4 Main Token杠杆 | 现有少量成对样本不足以形成一般结论 | 每个已毕业代表任务族都有同范围同验收有效对照，委派质量不低于直接Main且Main Token更低 | direct Main usage减去Main编排/审查usage；Worker Token、费用、时间和修正次数单列 |
| M5首次交付 | 尚无完整clean-clone用户证据 | 陌生开发者在30分钟内完成安装配置、真实Task、Main审查和安全Integration，不查数据库、不手改配置文件 | clean-clone观察记录、CLI/API证据和最终Hub验收 |

## 迭代策略

每个Milestone先由Main基于现状审计建立依赖图，把现有Plan中的Task作为正交Work Item，按就绪波次并行执行并配置独立Judge；不另建Work Item数据类型。默认一波最多三个实现Writer，实际并发通过配置和正交证据调整。每个Work Item有自包含Spec、允许修改范围、输入输出、验收和空间处置。Worker优先使用健康的Grok 4.6 Xhigh及Grok CLI自己的`/goal`完成端到端执行；该产品能力毕业前或Runtime真实不支持时才诚实使用persistent-session。Main串行审查和Integration。只要新一轮产生有效证据且仍在Spec内即可继续，策略安全上限可由Main有理由地调整；验收通过立即收口。连续两轮只有相同失败或无实质新证据、补丁开始互相补偿、需要扩大边界或候选已不兼容时，停止自动迭代并返回决策包。非阻断发现记录一次进入later，不自动生成新Task。聚焦测试随Work Item运行，完整套件用于高风险Integration和Milestone边界。里程碑内自动开始下一就绪波次，边界等待一骏确认。

## 阻断条件

如果关键需求仍有歧义、环境或Runtime不可用且没有在范围内的备用路径、连续两次有目的的尝试没有新增证据、需要触碰禁止边界，或Main无法判断验收是否满足，则停止当前Work Item并返回：已完成成果、可复用路径、准确失败证据、已尝试方案、空间处置和所需决定。不得用自动换模型、重建整个Task、增加Judge或扩大范围掩盖阻断；可安全推进的其他正交Work Item不受影响。

## 优先级

P0（阻塞性）

## MVP 与后续

本次必须：
- M2持续高质量交付和Task空间生命周期毕业
- M3证据驱动智能委派毕业
- M4公平Main Token杠杆证明毕业
- M5 CLI/API clean-clone、统一Hub和首次交付毕业

后续可做：
- 多人协作、组织权限和云服务
- 正式开源治理与公共发布
- 更广泛非Coding领域模板
- 签名桌面App、自动更新和App Store

## M5 UI 补充要求

- UI 面向人，不面向内部实现：标题、状态和操作用短句说明结果、原因和下一步；技术名词、ID、原始日志放到详情。
- GoalBoard 是我们的另一个项目；本项目只借鉴它“持续目标文件”的设计语言，不复用它的数据模型或产品边界。ForkLight 采用 Goal Tree 加连续目标页面，先讲“目标是什么、现在怎样、接下来做什么”，再展开证据和历史。
- Goal、Plan、Task 层级清楚；Now 与 History 分开；需要用户判断的事项集中到单一“决定中心”，不在多个页面重复审批。
- 状态不能只用颜色或代码；明确区分进行中、等待决定、阻塞、失败、部分完成和已完成，并说明已保留的成果与下一步。
- 空状态和错误状态要说明发生了什么、为什么以及下一步怎么办；不显示孤立的 `null`、`unknown` 或 `No data`。
- 提交 Task 前提供人话预览：要得到什么、为什么做、会怎样推进、哪些事情需要用户确认。
- 信息密度克制，日志默认折叠；桌面和移动端都能在首屏看懂当前进展和下一步；刷新不打断阅读或填写。
- 页面第一屏优先回答“这是什么、现在怎样、我需要做什么”；技术名词、Task ID 和原始日志放在可展开的详情中，不作为主标题。
- 决定中心先展示发生了什么和为什么需要决定，再展示操作按钮；按钮使用“批准继续”“退回修改”等人话，不只显示英文或状态码。
- 失败、阻塞和部分完成都必须说明已经保留的成果；界面不能把建议说成已执行，也不能把失败说成成功。
- 颜色只做辅助，必须配合文字或图标；清理等不可逆操作要先说明影响，再由用户确认。
- 每个重要状态都按“事实、原因、下一步”组织文案，避免只给一个“处理中”或“失败”的标签。
- Goal 页面优先呈现结果、完成标准、当前进展和风险；详细证据、原始事件和统计数据按需展开，不与主叙事争夺注意力。
- 实时更新不能打断用户：保留当前选择、滚动位置、筛选条件和未提交的内容；用户正在阅读时不要突然跳回顶部。
- 移动端使用单栏阅读和清晰的返回路径；关键操作、状态和决定不能因为屏幕变窄而隐藏在难以发现的菜单里。
- 首次使用时给出一条完整示例，让用户知道如何从 Goal 到 Task、从执行到决定，再到最终交付；不要求先理解内部术语。
- 主页面不把 Token、Attempt、Runtime 等内部指标当作主要成果；它们只在用户需要追查成本或执行细节时出现。
- 验收：不了解 ForkLight 的开发者能在 10 秒内说出当前任务、状态、是否需要自己决定和下一步，不查数据库、不手改配置。
- 不做技术术语墙、排行榜或只为展示内部状态而增加的复杂仪表盘。

## 执行状态

执行代理必须维护：

- `goals/forklight-main-led-execution/progress.md`
- `goals/forklight-main-led-execution/decisions.md`
- `goals/forklight-main-led-execution/evidence/`

## 术语

- Main：负责理解背景、规划、拆分、调度、审查、冲突裁决和关键授权的强主控；节约Main Token不等于取消这些高价值工作。（confirmed）
- 正交 Work Item：在现有Plan/Task模型中，依赖、输入输出、允许修改范围和验收独立，可在隔离Workspace并行执行的工作单元；它不是新的产品数据类型。（confirmed）
- Grok native Goal：专指Grok CLI自己的`/goal <objective>`、`/goal status`和`/goal resume`状态机，不是ForkLight Goal合同。官方1.0.3源码和真实隔离Smoke已证明其Goal身份、持久状态、独立终态判定与同Goal恢复；ForkLight只有在适配器读取并验证这份Runtime真相后才标记native-goal。（confirmed，产品适配器集成前仍为persistent-session）
- 有效进展：产生新的可审计证据，例如完成验收项、形成可用产物、缩小失败范围、通过新增验证或得到明确的阻断事实；重复日志、测试数量增长和无行为变化的重写不算。（confirmed）
- 可产品化能力：能跨项目复用，有明确用户输入输出、可配置策略、持久真相和验收，并且是当前里程碑明确要求或已在至少两个真实场景重复出现的行为；一次性恢复和ForkLight自身开发偏好不进入核心产品。（assumed）

## 风险

- ForkLight迭代退化为不断证明ForkLight能够迭代 → 每个Work Item必须关闭当前Milestone缺口或产生退出证据；禁止仪式性dogfood和仅为统计重跑。
- 把Grok持续Session或ForkLight Goal合同误称为Grok native Goal → 只有实际调用Grok CLI `/goal`，并能证明Goal id、持久状态、独立终态和同Goal恢复的Task才标记native-goal；普通Session继续标记persistent-session。
- 正交Work Item实际共享文件或隐含依赖 → 并行前写清depends_on、允许路径和输出；有共享面就串行，Main逐个Integration。
- Worker互审变成循环或多数投票代替判断 → Judge只读独立输出证据，重复意见不触发新轮次，分歧由Main按合同裁决。
- 修复策略不是过严就是无限 → 数值只作为可配置保险；以有效进展继续，以重复失败、无证据和越界作为停止条件。
- Workspace、Runtime Home、缓存和备份继续增长 → M2建立终态空间处置、孤儿检测、预览清理和证据保留合同。
- 无效对照产生虚假的Main Token节约 → 同范围同验收、质量硬门槛、无有效pair就显示无法判断。
- 把项目开发偏好全部做进ForkLight核心 → 按可产品化判据分类；模型偏好放Profile，流程偏好放AGENTS，一次性恢复放Evidence。
