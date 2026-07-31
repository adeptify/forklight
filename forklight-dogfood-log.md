# ForkLight Dogfood Log

用途：在使用 ForkLight 构建 Founder Lab 的同时，记录 ForkLight 自身的真实摩擦、证据和改进候选。这里只记录观察，不直接修改全局安装包；ForkLight 产品改动必须另建项目合同并单独批准。

## 2026-07-31 M3：DeepSeek + Main 区分“模型仍在处理”和“已经产出”

- **用户问题：** 过去 Worker 进程启动后，Hub 只能大致说“等待模型”或“模型响应中”。真实长任务里，Claude Code
  会持续输出 `thinking_tokens`，Grok 也会输出 thought/thinking；这些说明 runtime 仍有活动，却不等于已经有可用结果，
  更不能证明 Provider 网络请求正在进行。Task `ef79d43e-29cd-45f6-a3e7-94fa4b3c9454` 用 DeepSeek
  `deepseek-v4-pro[1M]` 实现独立的 `model-processing` 状态，并在 Hub 用中英文解释清楚。
- **有界事件链：** Claude 与 Grok 的高频 processing marker 最多每 15 秒持久化一条；公开摘要固定为安全文案，不保存
  原始思考内容。状态顺序由 Core 决定：process started < model processing < visible response < open tool < verification <
  terminal。迟到的 Worker 消息不能把正在验证或已经结束的任务改回“处理中”。这只陈述可观测的 runtime 活动，不猜网络
  请求、完成比例或 ETA。
- **保留 Candidate，而非整单重试：** 单个 88-turn Attempt 交付了可用主体，但 focused 188/189 和 full suite 均因同一个
  verification precedence 断言失败。Main 继续发现 legacy test、Grok 原始 thought 摘要、Grok 未节流以及 Hub 通用文案
  四个边界，在同一隔离 Candidate 一次性修正。随后零 Worker reverification 跑回原 6 条验收命令，6/6 通过；没有第二
  Attempt、correction Worker、Competition 或 adaptation。
- **交付证据：** focused Main review **215/215**，完整仓库 **2,001/2,001**，build、两个 Hub JS syntax 和
  diff hygiene 全绿。Main 接受 revision `cfd061c5-2530-4cec-9dd3-9b52d9bc0ec1`、digest
  `aeebca40f690538ed8db025d9f84d6147c7c61e323505e90fac3c8a7b3f063c0`。Integration
  `d8edb852-859a-4800-a6a8-d0104bdd1c1a` 四阶段通过；CLI/Daemon matched build
  `54015f085c8813ef2aed3bc3e744fb8885ec9e62a1c6b96d45939ee63437532c`，Daemon PID `13290`；Hub 在原端口
  `58675` 换代为 PID `14811`，status current。M0 自升级证据保持 **3/3 ready**。
- **真实 Hub：** 完整 History 已是 126 条，本任务位于首屏 25/126 的第一条，明确显示“已核验交付 / 已合入并确认生效”。
  中文和英文 Task Detail 都按 Main 输入、Worker 自报、独立检查、最终交付组织，页面 console 无错误。任务在新 build
  激活前已经结束，所以没有为了展示 active badge 再制造一个付费 Task；processing → response → tool → verification →
  terminal 的转换由确定性测试覆盖，下一条自然运行任务再补真实 active-state 观察。
- **成本与节约边界：** input 98,111、output 30,344、cache-read 6,692,096，gross **6,820,551 Worker Tokens**；
  DeepSeek official quoted cost **USD 0.093336413**，runtime estimate USD 4.595203，usage reconciliation delta 0。
  5,346,980–6,579,719 只是低置信度 Worker 边界范围；缺少 exact-pair direct Codex 对照，不能说成“节省了这么多主线程
  Token”。零 Worker 复验新增 Worker Token 和模型费用为 0，但 Main 审查与本地测试仍有成本。
- **M3：** 权威投影为 `314 terminal / 200 class / 82 family / 30 complete`，自然达到首个 **30/30** 样本门槛。
  这不是 M3 结束：接下来关注任务类型和模型的可比样本，而不是继续为计数制造任务。

无 commit / push。

## 2026-07-31 M3：ForkLight 开始记录“Main 为什么没有派 Worker”

- **产品结果：** 新增独立的 Main-direct 两阶段记录。Main 必须在动手前显式 start，完成后显式关闭为
  completed 或 abandoned；completed 同时记录本地验证 passed / failed / unavailable。记录不伪装成 Task，
  不启动 Worker，不探测 Provider，也不进入模型成功率、路由样本或 Token 节省统计。
- **执行与有限纠正：** Task `8825e122-038c-4843-a50a-06e94d1adb54` 使用
  `deepseek-v4-pro[1M]`。Attempt 1 为 153 turns，Attempt 2 为 86 turns；只使用一次同 Candidate
  结构化 correction，没有第三轮 Worker、Competition 或 adaptation。Main 在 Worker 到达上限后修正校验顺序、
  relevant exact/family 证据、真实本地认证 readiness、原子一次性 close、Daemon 端到端测试和 Hub 中英文混排。
- **验收：** 零 Worker Candidate reverification 跑原 6 条命令全部通过，明确记录新增 Worker Token 与模型费为
  0，但本地验证耗时约 117 秒且 Main exchange 不为 0。Main 接受 revision
  `ae498015-c175-47b7-8e7f-bdb515a665cb`，digest
  `f23ea0d2a6e43e47d0b4034cbcc49039cb3ea08531c4e3364ceefd4e951bb5e4`。
- **安全自升级：** Integration `20d00974-6991-4356-8b00-378acaa528ad` 四阶段
  17ms / 119,301ms / 4,573ms / 4,443ms 全绿。Daemon 与 CLI 匹配 build
  `d0104d9a7a0679d97d444a7479de53eb8583044406eeeafa432fdffde4437451`；Hub 已在原端口
  `58675` 替换为 PID `61260`，M0 streak 仍为 3/3。
- **首次真实 dogfood：** 在修改本段文档前创建 decision
  `4050d182-a692-49c9-9cf6-3611088d58a8`，记录实际考虑 DeepSeek 与 Volcengine GLM、scope 为 none，原因是
  这次只有边界明确的里程碑证据更新。旧的直做历史没有倒填。
- **经济性：** 两次 Attempt gross Worker Tokens **42,171,072**，reconciliation matched；官方报价合计
  **USD 0.31024171**，runtime estimate 合计 USD 24.05908。35,667,465–41,105,685 Tokens 只是低置信度
  Worker 边界范围；exact-pair Direct Codex baseline 缺失，不声明 Main Token 节约。
- **M3 当前证据：** `317 terminal / 203 class / 85 family / 33 complete`；其中
  `13 single / 0 comparable / 20 unknown multi / 0 unusable`。Main-direct 决策单独计数，不改变这组 Worker
  路由分母。

无 commit / push。

## 2026-07-31 M3：Main 直接修复 CLI 的假待办，没有为小问题浪费 Worker Token

- **真实问题：** `forklight list --json` 把最近的 activated、delivered、Main 已修复交付任务都显示为
  `now / needs-review`。Daemon/MCP/Hub 已读取 Main Review、remediation 和 Integration 证据，本地 CLI 的
  `status/list` 漏传这些事实，导致 Main 重连后可能误以为还要重新审查、修复或再叫 Worker。
- **为什么不派 Worker：** 根因已由 Hub/Daemon 的正确实现和 CLI 两处漏参直接证明；修改范围只有同一个只读
  投影入口和回归测试。Main 选择直接修复，避免为一个约 10 分钟的明确 wiring bug 再花数百万到千万级 Worker
  Tokens。这不是跳过验收，而是把 Token 花在需要探索和实现的不确定工作上。
- **实现：** CLI 新增一个共享 evidence-aware projection；`status` 与 `list` 都读取 ordered events、Attempts、
  Integration results、Main remediation disposition 和 Decision Stage，再交给既有 canonical Task surface。
  没有改变 Task 原始 status、Main 权限、Integration 或 Hub/Daemon 业务语义。
- **自动化验收：** 新增真实 CLI 子进程回归，证明 `delivered → history/delivered`、
  `machine failed + verified repaired delivery → history/repaired-delivered`、
  `verification passed but Main pending → now/awaiting-main`。focused regression、strict TypeScript、完整
  repository test、production build、`git diff --check` 全绿。
- **运行态实证：** Task `67d1e9f5-7a67-4942-a3a9-546d94d6391d` 现为
  `activated / history / activated`；Task `2d95e5ed-1f93-4daf-90ec-87a8f5faca3c` 保留
  `failed / machine-failed`，但正确进入 `history / repaired-delivered`；真实待审 Task 仍是
  `awaiting-main-review / now / awaiting-main`。Hub HTTP 正常。
- **激活：** Daemon/CLI matched build
  `5df9e52240f1996dad5ad646cc0092588f5d09c4208dbdbc12e8c2bf7e1f704b`，source digest
  `1b440cfd38b94463024500ee470912bb7babd7c1197bab51fce37b1d7960dfe4`；Daemon PID `35887`，Hub
  `41633@58675` ready。
- **经济性与下一缺口：** Worker/model Token、official Provider cost、runtime estimate 均为 **0**，因为没有
  启动 Worker。当前这类“Main 决定直接做”的负向路由证据只能写在 dogfood 记录里，还没有进入 M3 的结构化
  selection history；后续应补上 first-class direct-Main decision，而不是继续为同一 bug 重跑。

无 commit / push。

## 2026-07-31 M3：GLM + Main 把完整任务历史做成按需搜索与分页

- **用户结果：** Task `e739f892-2311-4733-b792-ca0b068dd090` 交付了独立于最近 50 条任务列表的完整 History。
  用户主动打开时才加载 25 条，可按名称、状态、Provider、模型或 runtime 搜索，并显式加载下一页；后台轮询不会搬运
  完整历史。Core 只返回 canonical delivered/stopped 结果，游标绑定查询并要求精确锚点，避免新任务插入、伪造/过期
  游标或跨查询重用造成跳页和重复。
- **保留成果与一次纠正：** Volcengine `glm-5.2[1M]` 的 Attempt 1 为 145 turns，主体与新行为测试可用；独立验收只
  剩旧静态断言、unused generic 和两个文件尾空行。唯一 correction 为 22 turns，并通过原始机器验收。Main 语义审查
  继续发现三个套件外边界：失败的新搜索会沿用旧搜索 cursor、daemon 可把错误类型当作缺省值、合法形状的过期锚点
  未被拒绝。Main 在同一隔离 Candidate 集中修正并用零 Worker reverification 跑回原 6 条命令，没有第三个 Attempt、
  Competition、adaptation 或循环重试。
- **交付证据：** Main 接受 revision `dc5884d3-e9be-4011-bf14-b748a4116a85`，digest
  `48ab74a3efa1a547d5acad63f8c37f94779ed9366a8efceb4c22d4e9c3c66f81`；Integration
  `90addb30-8873-4359-a7a5-56c06fb3a3d7` 四阶段全部 passed。完整测试 **1,992/1,992**，focused Hub
  116/116，build、Hub JS syntax、diff hygiene 全绿。
- **真实 UI：** Hub 有 125 条完整历史；首次 25/125，加载下一页 50/125，精确任务名搜索 1/1。390px 无横向溢出，
  搜索、刷新和加载更多纵向可读。浏览器 dogfood 发现入口的“历史记录 41”其实只是最近 50 条里的结束数；Main 未再启动
  Worker，改为首次加载前不显示伪总数，加载后显示完整历史的权威总数。
- **模型效率事实：** 两次 Attempt 合计 input 452,729、output 233,080、cache-read 41,098,688，gross
  **41,784,497 Worker Tokens**；runtime estimate 合计 **USD 28.639989**，subscription plan 不提供逐请求官方价格。
  usage reconciliation 2/2、delta 0。36,744,776–40,956,357 只是低置信度边界范围；没有 exact-pair direct Codex
  baseline，仍不声明 Main Token 节约。145-turn 大实现证明 GLM 能完成谨慎切片，也暴露它在微小修复上偏慢；后续路由
  应把“修复粒度”和首次有效编辑时延作为观察维度，而不是因此永久排除模型。
- **M3：** 权威 Hub 投影为 `313 terminal / 199 class / 81 family / 29 complete`，即 **29/30**。这是完整历史功能
  自然产生的第 29 条，不为最后一条制造任务。

无 commit / push。

## 2026-07-31 M3：Main 识别确定性小修，不启动 Worker

- **选择依据：** 上一轮真实 dogfood 已证明 `workspace.exclude` 只按目录/文件名片段匹配；把
  `src-tauri/target` 当作配置会静默失效并扫描约 2.4GB。修复只有一个解析边界、一个测试组和一段已有配置文档，输入、
  输出及验收都确定。Main 判断此时再派 DeepSeek、GLM 或 Grok 的调查/生成成本高于实现，不执行 Competition，也不把
  “缺少模型历史”误当成额外花费理由。
- **新行为：** Task admission 在任何 workspace scan、Candidate 准备或 Worker 启动前拒绝路径、反斜杠路径、glob、
  `.` 与 `..`；错误直接说明应写 `target` 而不是 `src-tauri/target`。合法单名继续去重，既有 segment-equality、
  generated evidence 和 Integration 分类规则均未改变。
- **验收与运行态：** 聚焦 Task parser **100/100**，完整 `npm run check` **1,976/1,976**，build 与
  `git diff --check` 通过。CLI/Daemon identity matched build
  `b60a90d039a4941483cad5765efa789e351a10ca70741232e289a025fc720d75`；detached Hub 在端口 `58675`
  换代为 PID `89917`，status current。Integration 支持的 M0 连续证据保持 **3/3 ready**，没有把手工 Main-direct
  构建冒充新的自升级样本。
- **经济性与 M3：** Worker、Provider 请求、Competition、Attempt、correction、adaptation 均为 0，因此新增 Worker
  Token 和模型费用均为 0。严格路由记录仍为 **28/30**；没有为了数字制造第 29 条样本。

无 commit / push。

## 2026-07-31 M3：Hub 只刷新用户正在看的页面

- **真实问题：** Hub 过去不管用户在哪一页，每轮都读取同一组 12 个接口；浏览器切到后台后仍继续轮询。大任务库下，
  这会持续搬运并重新计算用户根本看不到的 Tasks、Plans、统计和证据。
- **ForkLight 路由：** Task `ae26a404-f038-4483-af72-a7a6e971d3ec` 使用 DeepSeek
  `deepseek-v4-pro[1M]`，单 Candidate、无 Competition。Attempt 1 为 109 turns；Main 保留 3 个文件并授权一次
  结构化 correction。Attempt 2 为 36 turns。没有第三次 Worker、没有 adaptation、没有为绿灯无限重试。
- **主审查收口：** 第二次机器验收只剩一个测试把未加引号的 JavaScript 对象键误判为失败；Main 同时发现页面沿用旧
  数据时顶部仍会声称“实时”。Main 有界修正测试和 stale 状态，用一次零 Worker reverification 跑回原 5 条命令，
  **5/5 passed**，新增 Worker Token 与模型运行费均为 0。
- **实际行为：** 隐藏页每轮 0 请求；模型、Worker、限制、Main 和交付设置页 2 个；Tasks / Plans / Goals /
  Competitions 各 3 个；Insights 5 个；Overview 8 个。旧实现每页固定 12 个。切页和回到前台立即刷新；并发触发只保留
  1 个正在执行和最多 1 个跟进批次；401 后停止；单个接口失败不会清空其他证据，旧证据明确标为 stale。
- **验收与交付：** 最终 full **1,975/1,975**，build、`app.js` syntax、diff hygiene 全绿。Main 接受 revision
  `3248fc9b-7bb5-42ba-b37c-05238a3ee908`，digest
  `17e1c07aa3300200281855cabec72187040e65b94c7df88bbfb4afa70499e352`。Integration
  `2ff96e97-202f-4ef3-932a-53285630b34c` 的 source apply / verify / artifact build / runtime activation 全部 passed；
  detached Hub 在原端口 `58675` 换代为 PID `70049`，status current。自升级连续证据仍为 **3/3 ready**。
- **经济性与 M3：** 两个 Attempts 合计 **11,997,348 gross Worker Tokens**，其中 cache-read input
  **11,807,616**；官方 quoted DeepSeek cost **USD 0.155575053**，runtime estimate **USD 8.242768**。
  低置信度边界范围为 10,150,931–11,695,775 Tokens，但 exact-pair direct Codex baseline 缺失，不能称为 Main Token
  节约。usage reconciliation 2/2、delta 0。完整 routing decision 增至 **28/30**；这是一条自然产品任务，不为了凑数制造样本。

无 commit / push。

## 2026-07-31 M3：DeepSeek + Main 完成 Elsewhere 世界材料到故事方向的完整 UI

- **真实交付：** Task `c3b636f3-3ada-478a-8b8d-f2fad6916ce6` 使用
  `deepseek-v4-pro[1M]`，按 Main 冻结的交互、视觉、双语文案和状态边界实现 M2 缺失链路。用户现在能逐条理解并
  决定有出处的时代材料、看到保存是否真的成功、在来源不可用时只从个人事实继续，并在进入正文前理解一个可追溯
  但不冒充预测的故事方向。重开只恢复稳定页面，不自动调用 Provider。
- **保留成果而非整单重试：** Attempt 1 为 73 turns，形成主体但 45/51 focused 通过；唯一一次结构化 correction
  复用原 Candidate，Attempt 2 为 69 turns，达到 50/51，仅剩一个 Demo version conflict 和一个测试 mock 类型问题。
  Main 随后集中修掉确定性残差，同时补齐逐来源 trace、持久化成功后再显示 Saved、纯 reopen 和首次确认调用时机；
  没有第三次 Worker、Competition、参数自调或循环重试。
- **体验 Finish：** Impeccable detector 只运行一次；1440×900 与 860×640 对世界审阅、世界支持方向、个人事实方向和
  unavailable recovery 做了实际截图。终审唯一 P1 是深色纸面上的关键青色小字对比度约 2.5:1；Main 为文字增加
  专用 `#86c0bb`（最暗相关背景对比度至少 6.94:1），保留原深青作为标记色，并把 `bounded / plausible contact /
  guardrail` 换成用户能直接理解的英文，补上“稍后再继续”出口。设计规则同步进入 `DESIGN.md` 与 surface brief。
- **复验与合入：** 零 Worker `reverify` 的 4/4 原验收命令全部通过，Main 接受 revision
  `0b1eaf57-b2c1-480c-9c2c-33a7f8a98646`，digest
  `4f8b5cef0968391bb98056f65690b040daedf274b72b178e0287098dc7b091a9`。Integration
  `aa8e53f6-f8df-422a-9598-a39e102b2989` 只叠加 11 个 UI/测试/设计路径，没有覆盖原仓库已有的 15 个 M2 backend
  未提交改动；source apply 与 4/4 verification 通过。原仓库随后再次通过 Core boundary、strict TypeScript、
  **196/196**、production build、diff hygiene、Rust **5/5**，并向 SDK 线程提交稳定 checkpoint。
- **成本事实：** 两次 Attempt 合计 input 160,009、output 108,629、cache-read 22,640,256，gross
  **22,908,894 Worker Tokens**；official quoted cost 为 USD 0.14230706 + 0.103875013 =
  **USD 0.246182073**，runtime estimates 合计 **USD 14.835898**。零 Worker 复验新增 Worker Token 和模型运行费均为
  0。73 条 receipt 给出的 22,344,695–22,815,033 只是低置信度边界估计；缺少同任务 direct Codex 基线，不能称为
  Main Token 节约。
- **FL-D258（核心风险已关闭）：** Candidate 第一次 source scan 因排除项使用 `src-tauri/target` 而非目录段
  `target`，仍扫描约 2.4GB / 7,960 files；同时 Hub 高频读取约 176MB SQLite，使 daemon 在重负载时 CPU/内存受压。
  Task `ae26a404-f038-4483-af72-a7a6e971d3ec` 已关闭 Hub 无差别轮询；随后 Main-direct admission 修复让路径/glob
  写法在扫描或启动 Worker 前失败，并给出 `target` 示例。更丰富的预扫描体积估计可以作为未来增强，但已不是阻止
  这两类确定性浪费的前置缺口。
- **运行态恢复：** 验收结束后使用已交付的 detached restart 在原端口 `58675` 恢复单一 Hub，PID `98492`；
  `hub status=current`、CLI/daemon build identity matched，M0 自升级连续证据仍为 **3/3 ready**。

无 commit / push。

## 2026-07-30 M3 自然样本：Elsewhere 故事方向 Candidate 已接受，SDK RC 期间冻结合入

- **真实任务：** Task `a44b22f3-9df7-4948-9107-ce88b9fc526f` 要把用户逐条确认的世界资料收敛成一个
  有边界、可追溯的 `StoryDirective`，再只作为正文生成与审阅的可选输入。它保存
  `taskClass=elsewhere-m2-reviewed-story-direction`、`taskFamily=product-ai-contract-workflow` 和 Main
  选择理由；只使用 Grok 4.5，无 Competition、自动 retry、adaptation 或第二 Provider。
- **Candidate 保留：** 单次 Worker Attempt 28 turns，runtime estimate USD 1.2651624；terminal usage
  missing，因此 Worker Token 和 official cost unavailable。13-file Candidate 的 focused 53/53 通过，
  `git diff --check` 通过，但三个 TypeScript 编译问题让完整 check/build 失败。机器失败没有清零成果。
- **Main 结果判定：** Main 保留完整 Candidate，只在隔离 workspace 做一次集中修正：氛围型旅程直接走
  personal-only，不强迫逐条世界审阅；刷新世界快照仍会清理旧方向；`StoryDirective` 只进入 compose/review，
  不改变 closing-letter Contract；同时补齐编译和回归测试。没有启动 correction Worker。
- **零 Worker 复验：** `forklight reverify` 原始 4/4 commands 全过：focused 53/53、full 183/183、strict
  TypeScript、production build 和 diff hygiene 全绿。成本事实为 `workerInvoked=false`、新增 Worker Token=0、
  新增模型运行费=0。最终 14 files / 1880 changed lines，仍在 14/2200 预算内。
- **安全 checkpoint：** Main 接受 revision `c4daf5a5-bab7-4218-8a42-82472a8027d1`，digest
  `3dc9ae7106d5def184158447b47aebd2f3f04264013ae2d4ab02f525cec0215e`。Client-Core SDK 的三消费者 RC
  要求暂时冻结 `/Users/yijunwang/code/elsewhere`；因此没有 Integration、源验证写入、commit 或 push。
  Candidate 已耐久保存，待 RC 明确恢复后再做 preflight 和一次性安全合入，不能冒充已交付。
- **不扩张状态机：** 权威 `inspect --summary` 已同时投影 `stage=ready-for-integration`、
  `nextAction=User may authorize Integration` 和包含 SDK RC 冻结原因的完整 Main accept。这个阶段只表达
  “具备资格并等待授权”，不会自动 preflight/apply；因此没有为了当前等待窗口新增另一套 integration-hold
  状态。只读浏览器会话当时未通过 Hub 本地认证，所以本轮不把源码/UI 测试冒充成真实视觉证明；恢复后与
  Integration 的 Task Detail 浏览器验收一起核对。
- **M3 进度：** 权威只读投影为 `304 terminal / 190 class / 72 family / 20 complete`，分布在 154 个 class、
  19 个 family，即 **20/30 minimum**。这是自然产品任务产生的选择与判定样本，不为剩余 10 条制造工作。
- **经济边界：** 没有 exact-pair Direct Codex baseline，不声明节约 Main Token；零 Worker 复验只证明本次
  修正没有新增 Worker Token/模型运行费，Main 审查与本地验证仍有真实成本。

无 commit / push。

## 2026-07-31 M3：GLM + Main 完成 Hub「现在 / 历史」任务编排

- **目标与合同：** Task `fbee9c6c-3d1c-4d08-9126-55ef20a88ea9` 使用 Volcengine
  `glm-5.2[1M]`，不启用 Competition。合同
  `docs/m3-hub-now-history-information-architecture-contract.md` 要求用 Core 的真实交付结论决定任务位置，
  不能让 UI 根据状态文字自行猜测：仍在等待、审查、纠正、合入或处理失败的任务进入「现在」；只有已交付或
  已停止的耐久结论进入「近期历史」。
- **保留 Candidate 的有限纠错：** Attempt 1 共 126 turns，聚焦、全量、build、Hub syntax 均通过，只有
  `git diff --check` 发现文件末尾多一个空行。Main 只删除这一行并用零 Worker Token 复验，6/6 通过；随后
  语义审查发现两处真实缺口：已核验的 Main 修复交付会被更早的 Main reject 压住，以及 Hub 只校验单个字段、
  没校验合法的 scope/reason 组合。Main 保留全部 8 个文件，只授权一次同 Candidate correction。
- **最终结果：** Attempt 2 共 30 turns，修复上述两点并增加回归测试。最终 revision
  `0a8c8ceb-391f-4aa4-bab8-f48a56c29261`，digest
  `18831cd842362cc0864fa66c4ca05bb74e7105ef93d6bc9c2577e238fd8fa9d7`；8 files / 914 lines，超过
  900-line warn 但没有触发形式性 hard gate。聚焦加全量 **1,961/1,961**、build、Hub JavaScript syntax、
  diff hygiene 全绿。
- **自动 Integration 与运行态：** preflight receipt
  `064a83ec-2046-400f-bd2e-9bc2cbd8963a` 后，operation
  `72e66729-fbc6-4ff8-8192-fc994c946bfb` 的 source apply / 6 条 source verification / artifact build /
  runtime activation 全部 passed，result applied。Main 发现旧 Hub 仍是不同 build，随后使用已交付的 detached
  restart 能力安全换代；Daemon、CLI 和 Hub 现在使用 build
  `7e09db3e78c90698f0d24fe1b8ad204e1adad9c8499565820e87cfcacc33293b`，Hub PID `32373`、port
  `58675`、status current。`upgrade status --required 3` 返回 **3/3 ready**。
- **真实 UI dogfood：** 中文默认显示「待处理 10 / 近期记录 40 / 全部 50」。8 个机器已通过但仍等 Main/合入的
  Task 和 2 个失败 Task 留在「待处理」；新任务以「已核验交付」进入「已交付 40」，Main 修复后的历史交付也
  保留人话解释。英文、桌面和 390×844 单列布局均通过；近期历史明确说明不是完整归档；Hub console 无 App 错误。
- **成本与节约边界：** 2 Attempts 合计 **35,627,650 gross Worker Tokens**：input 362,925、output 167,381、
  cache-read input 35,097,344。运行时估算合计 **USD 23.547822**，Provider 没有提供官方逐请求价格；usage
  reconciliation 2/2、delta 0。orchestration exchange 为低置信区间，direct-Codex exact-pair baseline 缺失，
  因此不把 boundary reduction 写成 Main Token 节约。Main 对纯机械空行使用零 Worker 复验，避免了无意义的新
  模型 Attempt；真正语义缺口只进行一次受限纠正，没有无限循环。

无 commit / push。

## 2026-07-31 M3：DeepSeek 实现、Main 纠偏，Plan 依赖与 Task 来路进入真实 Hub

- **合同：** `docs/m3-hub-readable-dependency-lineage-contract.md` 要求 Plan 卡片回答“为什么在这里、等谁、
  完成后解锁什么”，Task Detail 只在真实 Plan / handoff 证据存在时解释来路；不改调度、重试、Integration，
  不让 UUID 和内部状态码进入主文案。
- **路由实证：** Grok Task `393016c3-f852-4724-8420-7bdceeacd9c1` 在模型调用前因 xAI auth 不可读失败，
  无 Candidate / cost；不重试。转用 DeepSeek Task `10bc361c-b199-4ab5-a070-dc92341e413d`。
- **有限纠正：** Attempt 1 有 4 条 focused 与 build 失败；Main 发现首十 Plan 扫描、原始 ID、名字边界和
  空心 source assertions。唯一 correction 改为 Store-backed `task_plan_context`，保留同 Candidate；Attempt 2
  只剩一个 unused test binding，Main 修一行后零 Worker reverification 6/6。
- **验收：** focused 161/161，full 1,952/1,952，build、Hub syntax、diff hygiene 全绿；revision
  `9f0ce168-3662-4e68-9dcc-b8e9953740e4`，digest `2c2d4fb5bdb67b5bec25a8731ff9202760b72f5d186bd70a489057c83ebb5b7b`。
- **自动自升级：** Integration `8ea5b4e2-93cd-403f-b119-9da9bc525563` 四阶段 19ms / 236,925ms /
  30,386ms / 10,507ms，result applied。Main 之后仅收掉缺名时的内部 ID fallback，补行为断言，focused
  161/161 与 build 再绿，没有第三次模型迭代。
- **浏览器实证：** 真实中文 Plan drawer 显示“就绪 - 没有等待或阻塞的前置步骤”“等待中 - 需要…先完成”
  和“完成后解锁”；真实 Task Detail 显示“属于 Plan…第 1 步”“下一项…”。页面 console 无错误，源码、构建、
  daemon 显示 ready；daemon `34190`、Hub `36599@58675`，build
  `ed6039b92c280740780e8e49da3f80fe66cbd4adfcd3ab546a843720fedd8d34`，self-upgrade streak 2/3。
- **经济性：** official cost USD 0.169844561，runtime estimate USD 9.390771，Worker gross 14,434,503
  Tokens。89 条 receipts 得到 7,063,818–13,220,607 的低置信度边界缩减；没有 direct-Codex exact-pair，
  所以 Main Token savings unavailable，不把边界缩减写成“节约”。

无 commit / push。

## 2026-07-31 M3：Elsewhere 故事方向确认已交付，重复 preflight 安全拒绝

- SDK source-stability RC 明确释放 Elsewhere 后，Main 先查 durable history，确认 accepted revision
  `c4daf5a5-bab7-4218-8a42-82472a8027d1` 已由 Integration
  `c09f453a-dc00-4ee0-b101-2f84013139a4` 在 00:27 CST 完成 source apply 与 4/4 source verification。
- 新 preflight 没有把“补丁已存在”误当成可再次合入，而是逐文件拒绝 duplicate apply。Main 没有回滚、
  没有手工再贴一次 patch，也没有启动新 Worker。
- 当前 Elsewhere 源码复验：focused 53/53、full 183/183、Core boundary、strict TypeScript、production
  build、diff hygiene、Rust 5/5 全部通过。`project_status.md` 已把 story-direction Product Function 标为已交付，
  UI world/relevance/intersection/story-direction journey 仍诚实保留为 M2 open scope。
- 这次只新增本地验证与状态文档，属于 SDK RC 之后的下一快照；已向 SDK 线程回报稳定 checkpoint。

无 commit / push。

## 2026-07-30 M3 自然样本：保留失败 Candidate，零 Worker 修正并交付 Elsewhere 有来源世界材料

- **真实用户结果：** Elsewhere 现在能在事实确认后显式准备有来源的时代材料。请求只包含去个人化的
  `WorldQuery`、locale 和取消信号；私人旅程零检索。允许来源、HTTPS、精确查询值、时间重合、重复与冲突
  都在持久化前校验；失败、取消、空结果和未配置 Provider 只保存稳定原因，不阻塞原故事生成。
- **选择与边界：** Task `2e3c43dd-7bf8-43a2-879c-f13a296c8f8e` 使用 Grok 4.5 单 Worker，完整保存
  `taskClass=elsewhere-m2-sourced-world-context`、`taskFamily=product-domain-workflow` 和用户指定的路由理由。
  1 Attempt / 14 turns，无 Competition、自动 retry、adaptation 或第二 Provider。runtime estimate
  USD 0.6134912；usage missing，因此 Worker Token 与官方费用不可用。
- **失败不是成果清零：** 首次独立验收中，focused **40/40**、full **175/175**、strict TypeScript 与 build
  全部通过；唯一失败是一个测试文件末尾多出空行，使 `git diff --check` exit 2。10 files / 1578 lines
  超过 9/1500 的 warn 门槛，但没有把质量优先的软提醒升级成硬失败或触发无休止调参。
- **Main 判定与有限修正：** Main 审查隐私请求、三条官方杭州来源、查询值匹配、来源冲突、缓存、刷新、
  stale 清理、错误脱敏和生成兼容后记录 exact `revise`，只删除该空行。`forklight reverify` 用零 Worker、
  零增量模型运行费重新执行原 4 条命令并全部通过；没有新 Attempt 或整单重跑。
- **交付：** Main 接受 revision `8aead2c3-7e1f-4cf3-b6c7-a33fc18ce4a8`，digest
  `d0cd6b9c9f780c62d2e0f09dbd2ca441a0cb4e7e1f7b4a4e9bb0e01effdc168c`。Integration
  `361d4c6b-3d0c-4d1d-8fdc-35d4c7b953d6` 在原 Elsewhere 脏工作树完成 source apply 与 source 4/4 复验。
- **M3 进度：** 权威投影为 `303 terminal / 189 class / 71 family / 19 complete`，分布在 153 个 class、
  18 个 family，即 **19/30 minimum**。继续只从真实产品任务自然积累，不为剩余 11 条制造工作。
- **经济边界：** 没有 exact-pair Direct Codex baseline，不声明节约 Main Token。能严格证明的是：保留并复验
  此 Candidate 的增量 Worker Token 与模型运行费为 0；Main 审查和本地验证仍有真实成本。

无 commit / push。

## 2026-07-30 M3 自然样本：ForkLight 交付 Elsewhere M2 世界相关性判断底座

- **真实用户结果：** Elsewhere 在确认个人 FactSpine 时原子保存保守的 `ContextAssessment`。强时代样本携带
  只来自结构化回答原文的检索坐标；私人表达明确为 `irrelevant` 且没有 query；旧 schema-v1 旅程仍可继续
  生成。当前切片不联网、不调用产品 Provider、不生成历史事实、不改 UI，也不提前宣称 M2 检索与世界页完成。
- **选择与执行：** Task `d59ca3ca-1ab3-45b1-9484-6c794bf74992` 保存完整
  `taskClass=elsewhere-m2-context-assessment-gate`、`taskFamily=product-domain-workflow` 和 Main 路由决定。
  按一骏当日偏好只使用 Grok 4.5；低不确定性任务没有 Competition、自动 retry 或 adaptation。Worker 只有
  1 Attempt / 16 turns，runtime estimate USD 0.5597336；usage missing，因此 Worker Token 与官方账单不可用。
- **Main 审查与保留：** 首次 Candidate 5 files / 810 changed lines，机器验收全绿。Main 仍发现坐标类别和
  年份来源过宽：`place_do` 被当地点、教育期待被当领域、任意回答里的年份都可能变成历史窗口。Main 记录
  exact `revise`，在同一 Candidate 收紧语义并补 stale-query 回归，再用一次 `forklight reverify` 跑原 4 条命令。
  该复验没有启动 Worker，增量 Worker Tokens=0、模型运行成本=0；最终 Candidate 5 files / 894 changed lines。
- **最终证据：** focused **24/24**、full **156/156**、Core boundary、strict TypeScript、production build、
  `git diff --check` 全部通过。Main 接受 revision `de01f08c-bd2b-45ff-b8a9-04616de5b2cb`，digest
  `5e937d7b11e7af5230876f48d150c17ba7390c4caa35b1edb10aaffb38fd2498`；Integration
  `bcb02152-1c9b-44aa-aa78-535ef1d0dd6e` 在原 Elsewhere 脏工作树完成安全 source apply 与原项目 4/4 复验。
- **M3 进度：** 权威投影现在为 `302 terminal / 188 class / 70 family / 18 complete`，分布在 152 个 class、
  18 个 family，即 **18/30 minimum**。这是自然产品任务带来的第 18 条，不为剩余 12 条制造工作。
- **经济边界：** 没有 exact-pair Direct Codex baseline，不声明节约 Main Token；零 Worker 复验只证明本次修正
  没有新增 Worker Token/模型运行费，本地命令与 Main exchange 仍有成本。

无 commit / push。

## 2026-07-30 M2 正式退出：主阶段进入 M3

- **为什么关闭：** M2 的目标是用户能把一个长程结果交给 Main 和多个 Worker 持续推进，而不是收集
  每一种失败截图。四 Task restart Goal 和 Relay 五 Task 产品 Goal 都完成；自然 judge disagreement
  仍可补充，但不再作为重复烧 Token 的门槛。
- **长程执行：** `/private/tmp/forklight-goal-live.m4ZT8R/goal-v2.json` 完成 4/4；Relay Gmail
  history Goal 完成 5/5，包含 machine / Main / Integration 三种依赖门。
- **中断恢复：** live handoff successor `9c69323e-af1c-43de-afb5-59129904dadf` 先记录
  `worker.interrupted`，随后只授权一次 `handoff-daemon-restart` 并以同一 Task `worker.resumed` 成功。
- **跨 Worker 保留成果：** Relay MiniMax Task `decbae4e-4ac8-48c3-a5d2-78801662ccb4` 的四个
  可复用路径经 handoff `74baeddc-e4dd-43f1-b06e-d4f32a6a6ed4` 交给 GLM successor
  `dd837113-bb99-4557-b5ae-c08fc9881549`；源 Task 保持 failed，successor 独立成功，没有整单重跑。
- **有限自迭代：** no-progress Goal 在 5 秒闲置后停止；no-new-evidence Goal 在两次空推进后停止；
  两者跨 restart 保留停止原因和计数。Relay Goal 的 correction/review 上限实际走到 3/3、2/2，
  没有变成无限循环。
- **阶段决定：** `docs/m2-long-running-acceptance.md` 逐条记录六项退出证据。当前主阶段改为
  M3；M1 clean-user、M4 exact-pair、M5 external-user 继续并行开放。

本轮只读 ForkLight 权威记录并更新文档，没有启动 Worker、Competition 或模型调用；无 commit / push。

## 2026-07-30 M1：真实任务组合复核为 13/10，不再为旧项目配额造任务

- **口径修正：** 一骏后续明确优先使用 Relay、Elsewhere、Collision、Museum 等活跃项目，
  NovelRPGPlay 不再强制。早期 Adeptify / Dia / NovelRPGPlay 固定配额保留为历史候选记录，
  不再覆盖最新用户方向。
- **严格计数：** 只读 Goal / Task / Main Review / Integration 审计确认三个已完成 Goal 提供
  **13 个不同用户结果**：Relay Gmail production 4/4、Relay Gmail history 5/5、Elsewhere
  redesign 4/4。一次 Goal 里程碑最多计一次；Attempt、correction、handoff、judge 和 reverify
  不额外计数。
- **交付真相：** 11 项为 Main accept 后的 exact Candidate Integration；2 项保留原机器 Task
  `failed`，分别由 Main 按 original acceptance 与 formally amended acceptance 验证交付。
  它们算最终用户结果，但不冒充 Worker 成功或自动 Integration。
- **类型覆盖：** 领域规则、应用壳、渐进交互、事实审查、Provider 适配、状态协议、事务恢复、
  恢复 UI、跨重启 E2E、失败真实性、数据保全、Onboarding 与发布文档均有不同交付。
- **边界：** 所有进度来自 ForkLight durable records，没有为了凑数启动 Worker，也没有用手工
  数据库或内部配置修改 Goal。M1.4 数量与类型门槛关闭；M1 仍需真实独立新 macOS 用户 / VM
  完成约 15 分钟配置、首 Task、理解、审查、合入和重启恢复旅程。

无 commit / push。

## 2026-07-30 M3：最终交付只按 Main/真实交付证据统计，并用生产 reject 校准

- **审计发现：** 旧统计把所有机器成功 Task 直接算作 `acceptedDelivery`。当时 149 个机器成功里只有
  88 个 latest Main accept，另有 48 个未审、12 个 revise 和 1 个 reject。Task
  `5e5ad6a1-0cfb-4e64-814b-cd3e9faa8ff4` 明确被 Main reject、没有 Integration/remediation，仍被误算
  为接受，证明 UI 文案与算术冲突。
- **第一条实现 Task：** `009f4dbf-8ad4-488d-b0b8-44007f462a8c`，Grok 4.5，1 Attempt / 29 turns，
  runtime estimate USD 1.3638228，terminal usage missing。Candidate 8 files / 903 lines，主体语义正确，机器
  失败只来自 Hub app 注释中的一个 em dash；Main 还发现现代 Main accept 只校验 Revision ID、缺少 exact
  patch digest 的边界。
- **保留 Candidate：** Main 记录 exact revise，在同一 workspace 只修摘要绑定和标点，再用一次
  `forklight reverify` 跑原 5 条命令。Worker invoked=false、增量 Worker Tokens=0、增量模型运行成本=0；
  focused 195/195、full **1,908/1,908**。最终 revision
  `d2465096-66d7-4540-967a-c6dba69516ce`，digest
  `0284b2e945dd8d9973904fe4d960b075a00f7ba28cf4c9b7eadfedb09cdb13aa`；Integration
  `f34fd1bb-2784-44dc-97e5-d562504bb0d3` 四阶段通过。
- **新行为：** provider statistics 与 routing 共用一个 Task-unique 三态判定。当前 exact Main accept、
  verified Main remediation 或 applied Integration 才是 accepted；当前 reject/revise 或相关模型质量失败是
  not accepted；待 Main 的机器成功、外部/策略/模糊失败和过期接受证据是 unavailable。未知不压成零，
  acceptedDelivery 因子只在每个候选有足够可比样本时评分；Hub 用白话中英文显示接受/可比/未知计数。
- **真实数据反查没有用合成测试收工：** 合入后生产 reject 已从假接受变成 unavailable，但没有成为合同要求的
  0/1。事件审计确认它是旧版记录：Attempt 2 与 verification 550 完全当前，reject 明确，但 review 创建时
  还没有 revision id/digest 字段。Main 没有重跑第一条大 Task，也没有调参数循环，只冻结一个两文件兼容合同。
- **窄兼容 Task：** `823bd71b-238e-4549-81d4-8ae8e69d056a`，仍只用 Grok 4.5，1 Attempt / 8 turns，
  2 files / 275 lines；260 行只是 warn，不为形式删边界测试。legacy reject/revise 只有在两个 revision 字段
  同时缺失且 Attempt/verification 完全当前时才作为 non-acceptance；accept 仍需 exact id + digest，半截、
  错误或 stale negative binding 仍 unavailable。focused **55/55**、full **1,911/1,911**、diff hygiene
  全绿。Main 接受 revision `51c2cfe5-8233-4c9b-8f27-b79c1d35da69`，digest
  `c4b102506426dbaf07e7a9790dddb0387947b6da5b7cda3ced9c85bcb12cb556`；Integration
  `cd562157-5a99-43d7-9131-b58916c493ce` 四阶段通过。
- **生产终态：** 同一 reject Task 在正式源码中同时返回机器成功 **1**、接受 **0/1**、未接受 **1**、未知
  **0**，provider summary 与 routing 完全一致。严格 coverage 更新为
  `301 terminal / 187 class / 69 family / 17 complete`，151 种 class / 17 种 family，即 **17/30**；
  不为剩余 13 条制造 Task。CLI/Daemon build
  `54e8000750c90888bc8b901112ab3ed3e0ecc802883c6463a1344685cc50b21e` matched；Hub
  `15882@58675` current 且唯一 listener；M0 upgrade 仍为 3/3 ready。
- **经济边界：** 第二条 Grok runtime estimate USD 0.2348328，usage 同样 missing。两个估算都不是账单；
  无完整 Worker usage 和 exact-pair Direct Codex baseline，不声明 Main Token 节约。整个修正没有 Competition、
  adaptation、普通 retry 或第二 Provider；只在真实生产验证证明合同未完全满足时做一次窄后续，随后停止。

无 commit / push。

## 2026-07-30 M3：首次通过率落地，并用真实 Main 复验纠正同 Attempt 回填

- **问题不是“最终有没有交付”：** 现有路由已经区分机器结果、最终接受、纠正次数、失败类别和成本，
  但不能回答 Worker 是否第一次独立验收就通过。Task
  `305f3f3b-d2d7-4179-984e-2213ed88f370` 只路由 Grok 4.5，为 exact class / family 增加首次验收
  sample、success、rate 和 unavailable 证据，并提供默认 0.5、可在 Hub 修改的独立权重。缺失或外部原因
  不变成合成零，证据不足不评分、不竞争，Main 仍能覆盖建议。
- **保留成果而不是重跑：** Grok Attempt 为 25 turns、12 files / 635 changed lines。首次验收只有 Hub
  UI 测试夹具漏载 `mrWeightDefault`，focused 331/332、full 1,898/1,899；主体实现、语法和 diff 均通过。
  Main 在同一 Candidate 补齐夹具，并增加 Provider/connectivity、budget 等外部失败优先于偶然行为通过的
  边界。`forklight reverify` 未启动 Worker，原 5 条命令全绿：focused 332/332、full 1,899/1,899。
  最终 revision `e3844c10-5b01-48b3-b761-1c11779ac58f`，digest
  `19fd76a71b0894259d3d740dc2529d023ec4cdc99139b1a2fab28d0e68549db7`；Integration
  `d8518b31-f17e-4479-b8b0-a645d0832874` 四阶段通过。
- **新能力立即暴露自己的语义漏洞：** 生产 routing 对上述真实 Task 返回首次通过 1/1，因为同一个
  Attempt 后续的 Main 零 Worker 复验覆盖了最初失败。最终交付成功是真，但把它记为 Worker 首次成功是假。
  Main 没有调参或制造样本，而是提交一个精确 2-file Contract：Task
  `4a5e7421-83e9-41d2-8a16-c3e508a6e2fe`，仍只使用 Grok 4.5、无 Competition、无 retry。
- **第二个 Candidate 仍由 Main 守边界：** Grok 5 turns 完成 earliest-verification helper 和两个
  same-Attempt regressions。Main 发现它顺手让通用最终验收跳过最新损坏记录、回退更早有效记录，违反
  out-of-scope 且削弱 fail-closed；Main 保留首次验收实现，恢复通用语义并补一条损坏最新记录回归，再以
  零 Worker 复验原 3 条命令。focused 49/49、full 1,902/1,902、diff hygiene 全绿。最终 revision
  `8c09ba78-a4cc-4c3b-854d-d6d232095b9e`，digest
  `1cf5d37bc0facf091291e1d356c340a6fe77643d7bea66c94424372a54f59da6`；Integration
  `8a6230d1-ec9e-4103-8a74-de3e3345bc7e` 四阶段通过。
- **生产证据：** 当前 routing 对第一 Task 正确返回首次通过 **0/1**，最终接受交付保持不变；零历史完整
  Worker 候选保留真实 provider/model，`firstPassSuccess` 在证据不足时显式 omitted。严格 M3 coverage 为
  terminal ordinary 299、taskClass 185、taskFamily 67、完整选择记录 **15/30**，分散在 149 classes / 17
  families。Hub 在原端口 `58675` 换代为 PID `89706` 且 `current`；CLI/Daemon build
  `7d682be93740c43afbf8fb25d932789ddbf0e07b0f14cb5435b9ab15e1cbfc39` matched，M0 仍为 3/3。
- **经济性边界：** 两次 Main reverify 都是 Worker invoked=false、增量 Worker Tokens=0、增量模型运行成本=0。
  两个 Grok Attempt usage missing；runtime estimate 约 USD 0.9604032 + 0.163348 = USD 1.1237512，不是
  Provider 账单。没有 exact-pair baseline，不声明 Main Token 节约。没有为计数启动 Competition，也没有
  继续调参数或进入无限修复循环。

无 commit / push。

## 2026-07-30 M3：有相关历史不再显示成“双方零样本”

- **只读审计：** 排除 Review Graph 后，296 个 terminal ordinary Task 中有 182 个 exact type、64 个
  stable family，但只有 12 个保存完整 type + family + Main selection decision。新 Task 完成后严格记录为
  **13/30 minimum**；不回填猜测旧任务。
- **真实缺口：** 新 exact type 查询 `bounded-javascript-change` family 时，旧 UI 因 family 集合未整体达到
  门槛，只展示 scoring scope 的两个 0。实际 MiniMax 为 2/5 relevant，Grok 为 12/5；结论仍应是无法公平
  比较，而不是没有历史、推荐 Grok或自动 Competition。
- **Task 与 Main 审查：** Grok Task `c9d8a2bc-ee01-44b5-8f64-d0b473a9078f`，1 Attempt / 11 turns，
  5 files / 527 changed lines。Worker 原验收全过，但 Main 发现 family scope 已够而结果接近时，文案会错误
  回看 sparse exact samples。Main 记录 revise，保留 Candidate 做一次有界修复，并以零 Worker
  reverification 跑原 5/5 命令；没有 correction Attempt、Competition、retry、adaptation 或其他 Provider。
- **最终证据：** revision `61aa023b-12ce-473b-b548-df18e6299812`，digest
  `b7e61d09775fa9893efe0cf0b1892429671d3e104f755977729a891038e8c2a4`；focused **135/135**、full
  **1,886/1,886**、syntax/build/diff 全绿。Integration
  `4e4f031e-0767-42ba-ab73-b0cd106f2567` 四阶段 11ms / 73,313ms / 3,835ms / 5,514ms 全部 passed。
  CLI/Daemon build `461343eaf5e7d24f20a2b9c5b9495a6497e0176666d9d18e269a39b385d75360` matched；Hub
  `4861@58675` current 且为唯一 listener。
- **竞争审计：** 历史 7 次 Competition 启动 14 个 Candidate Task，5 succeeded / 9 failed；15 Attempts、
  728 turns、runtime estimate 约 USD 49.3877。只有 2 次带显式 required/user-requested reason；5 次 legacy
  原因缺失。该数据不用于模型排名或未来价格预测，只证明 missing evidence 不应自动扩大为竞争。
- **经济边界：** Grok runtime estimate USD 0.4714884；usage missing。Main 修复与 reverify 新增 Worker
  Tokens=0、model-runtime cost=0。7 receipts 只支持低置信 Main exchange 31,280–191,956 Tokens；无 exact-pair
  baseline，不声明 Main Token 节约。

无 commit / push。

## 2026-07-30 M1：Elsewhere 三层事实镜完成，暴露修订验收的 Goal 计数缺口

- **Task 与路由：** `ed7cb0c3-74fb-4b98-bb68-d3381b0eb7d6`，Grok 4.5，1 Attempt / 36 turns；
  runtime estimate USD 1.5739636，terminal usage missing。最终 Candidate 为 21 files / 1,683 lines；
  文件数是 warning，不是为了数字而牺牲交付质量的 hard gate。
- **保留成果而非重跑：** Worker 已完成三层事实镜主体。Main 只修正 JSX 测试夹具、`matchMedia` 清理、
  空格路径下的 boundary 脚本和少量断言，没有启动 correction Worker、Competition 或无界循环。
- **真实浏览器发现：** active layer 同时带有 `is-ahead`，被降到 28% opacity；1280×720 下操作区与 footer
  过挤。修复后真实走通 Facts → Interpretations → 移入 Unknowns，活动层保持全不透明，短屏能完整阅读和操作；
  回归测试锁定 active layer 不再属于 ahead/behind。
- **验证：** focused **55/55**、full **142/142**、typecheck、core-boundary lint、build、diff hygiene
  全绿。`forklight reverify` 的 5/6 唯一失败来自 Impeccable detector 输出 192 条 advisory，却以 2 退出，
  与其“advisory 不影响退出码”的说明矛盾。
- **有界修订验收：** Main 将 `revise` 精确绑定 Attempt
  `9e089db0-b793-4bff-9776-0484d9df2e09` 和 verification event 1951；正式 amendment 只替换这一条
  矛盾命令，且对 malformed JSON 或任何 non-advisory finding fail closed。实现还处理了 detector 约 100KB
  输出被 Node pipe 固定截断到 64KB 的问题。Remediation check
  `086d46e3-7fa6-4c0a-a4c4-eb3407d7b639` 最终 **6/6**，disposition
  `verified-repaired-delivered`，`acceptanceBasis=amended-acceptance`。
- **源码交付：** exact patch 先在 Elsewhere 当前脏工作区做只读 hunk check，确认全部 clean 后才应用；
  不覆盖其他用户改动。未 force Integration，未 commit / push。
- **FL-D257（closed 2026-07-30）：** Grok 4.5 Task
  `113ce5fd-80ea-4f59-9a61-eb955c257543` 用 1 Attempt / 26 turns 完成严格的只读证明链。Goal 现在会回查
  current Task/Attempt、latest failed verification、latest bound Main `revise`、canonical failed-slot replacement、
  实际执行命令、passing private check、compact disposition、exact completion event 和后续 stale evidence；任何缺失、
  损坏、错配或后来 review/verification 都 fail closed。Hub 用中英文白话区分三种交付，不把 raw
  `amended-acceptance` token 展示给普通用户，也不会创建 Candidate accept 或 Integration 记录。
- **Main 收口与复验：** Worker Candidate 5 files / 908 lines；Main 保留主体，补逐命令 canonical proof 并移除
  可见内部 token。零 Worker reverification 生成 revision
  `4d6b8e5e-f906-45d1-8ab1-de0eaac2aae8`、digest
  `89d6be571939a9a6a70b117fb236620b45d81d5cdca8bf669d4a05da3f5051e0`，最终 5 files / 961 lines；
  focused **115/115**、full **1,879/1,879**、build、syntax、diff 全绿。
- **真实自升级与回归：** Integration `9a0cc4f0-7f60-4e23-8da7-424bd3992565` 四阶段通过；
  CLI/Daemon build `969a09c15e73afc843382230f08e6a408c17720110ff20433064a62f5b17ef0e` matched，M0
  连续出口保持 3/3。Hub 在原端口 58675 受控替换为 PID 83982、单 listener、state current。原 Elsewhere
  Goal 自动变为 **4/4 completed**；最终 Task 仍如实是 machine failed，交付依据为 Main 修复后按修正验收验证，
  没有伪造自动合入。
- **经济边界：** 所有 reverify/remediation 都是本地检查，`workerInvoked=false`，新增 Worker Tokens=0、
  model-runtime cost=0。FL-D257 Worker runtime estimate USD 0.9932396、usage missing；原 Elsewhere Attempt usage
  也 missing。40 条 orchestration receipts 只支持低置信 Main exchange 范围 **551,191–3,354,933 Tokens**；
  Worker usage 不完整且没有 exact-pair direct baseline，因此 boundary reduction 与 Main Token 节约均 unavailable，
  不把交换量误写成节约量。

无 commit / push。

## 2026-07-30 M1：Elsewhere 渐进式启程保留 Candidate 后由 Main 有界收口

- **Task 与路由：** `40854bb0-6f21-4e73-88bb-ff842e1b7c19`，Grok 4.5，1 Attempt / 27 turns；
  原 Candidate 为 8 files / 1,581 lines，runtime estimate USD 1.3400232，terminal usage missing。
- **为什么不整单重跑：** Worker 已交付可复用的单题渐进式 UI、问题引擎和大部分测试；原机器失败集中在
  测试类型、`matchMedia`、路径编码 lint 和 build。Main 保留 Candidate，只做一次有界修复，不再启动
  correction Worker，也没有 adaptation 或 Competition。
- **Main 发现并修正的真实语义：** Pause/迟到结果隔离、稳定 Journey ID 与 exactly-once 创建、Provider
  失败后复用已创建 Journey、只在清草稿失败时复用已完成 fact review、完成草稿恢复、New Journey 不静默删
  草稿、旅程中锁语言、IME Enter、真实本地草稿文案、无依据分支不强制追问，以及中英文句子组合。
- **体验审查：** Main 阅读完整 10-file diff，并在 1280×720 浏览器真实走到第 5/7 问；首屏、两列选项、
  答案轨道、短屏滚动、焦点、状态和按钮对比度可读。此前独立 1440×900 / 860×640 审查无横向溢出。
- **零 Worker 复验：** `forklight reverify` 没有调用 Worker，新增 Worker Tokens=0、模型运行成本=0；
  原 5 条验收全部通过：typecheck、122/122 tests、core-boundary、build、diff check。最终 revision
  `1c0e0070-259c-43a4-a804-89fff767c65e`，digest
  `afd36c20723c6d34d7df20cb2f804f45c6e02b3f54e2f5be644a1215b14c5d87`。
- **安全合入：** Main fresh accept 后，Integration `11717644-20ac-48c2-aedb-04e7adfe5af5` 完成
  source-applied 与 fresh 5/5 source-verified；Goal 达到 3/4，并自动进入 `fact-mirror-finish`。
- **经济边界：** ForkLight 只能给 Main exchange 低置信度范围 28,865–173,482 Tokens；Worker usage 与
  exact-pair Direct Codex baseline 都缺失，因此不展示 boundary reduction 或 Main Token 节约。

无 commit / push。

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
| FL-D143 | M0 handoff 已有确定性测试，需要连续 live activation 成功 | **open M0 exit — 1/3 on 2026-07-28**：Task `8b3528b5-f9f1-495d-abb5-687f43be66d5` 已通过真实 activation Delivery Profile；还需连续两个真实交付，任一次自动链路失败则重新计数 |


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

## 2026-07-28 单一 Hub 所有权与认证复用 dogfood

Task `e00b738c-c949-45ef-8702-36fb28ec42da` 只调用一次 DeepSeek
`deepseek-v4-pro[1M]`，没有竞争、重试、Worker correction、Main reverify 或 adaptation。
选择 DeepSeek 是基于同类历史交付率、成本和时长证据；当前路由证据不足以证明另一个模型更好，
因此没有为不确定性额外支付多个完整实现。

唯一 Attempt `67b28900-4176-4c11-afa7-33953ee11ceb` 运行 36 turns，terminal usage 为
input 125,492、output 30,777、cache read 3,112,448，即 **3,268,717 gross Worker
Tokens**；runtime estimate 为 **USD 2.953109**。候选为 6 files / 975 changed lines。
独立验收通过 1,387/1,389 tests，strict TypeScript、Hub JavaScript syntax、source
compatibility 和 `git diff --check` 通过。失败测试既有错误前提，也揭示了真实设计缺口：超时
后无条件移除 startup lock 会让慢启动期间出现第二个 Hub；旧实例退出还可能删除新实例的锁。

Main 记录 `revise` 后没有再次调用 Worker。Main 保留实例发现与复用骨架，仅补齐 lifetime
owner claim、原子发布、精确身份清理、私有权限、严格/有界 descriptor 验证、认证 liveness、
启动失败清理和确定性并发测试。最终完整回归、build、strict TypeScript、Hub JavaScript syntax
与 `git diff --check` 全绿；原合同 **5/5** 命令由 remediation check
`5cf9ac36-06e1-492f-8415-d324d5399665` 通过并记录
`verified-repaired-delivered`。原 Task/Attempt 仍保持 failed，不把 Main 修复伪装成 Worker 成功。

真实运行证明：Hub 在 `127.0.0.1:56962` 持有单一 owner；第二次 CLI 即使要求 `53542` 也会
认证并复用 56962，53542 没有 listener；home 权限 700、owner/descriptor 权限 600，认证
liveness 返回 200 且 nonce 与 descriptor 一致。Daemon/client build identity 匹配
`d0b5f4edac90fe0e00fc56a199b4c6e4536795a5f84a816877dbf765105cde43`。这是 Main 修复和
手工 runtime 切换，不是 automatic Integration activation，M0 仍为 **0/3**。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D226 | 仅在启动阶段持有、超时可偷取的 Hub lock 不能证明单实例；旧 owner 清理还可能删除 replacement 的所有权 | **closed 2026-07-28**：改为每个 `FORKLIGHT_HOME` 一个 lifetime identity claim；只认证复用、不杀未知进程、不偷活 owner、只清理精确身份；确定性并发与真实双 CLI 测试通过 |

## 2026-07-28 测试 Daemon 精确清理 dogfood

Task `54e54c6e-a3a9-4718-9e26-36e0fa6b534a` 使用 Volcengine
`glm-5.2[1M]`，只有一个 Attempt，无竞争、重试、Worker correction、Main reverify 或
adaptation。该 task class 没有可比较历史样本，Main 为控制成本只建立一条 GLM 样本。

Attempt `8acb491a-fadc-4016-bad8-157d7f80d451` 运行 46 turns，terminal usage 为
input 165,200、output 100,760、cache read 3,483,968，即 **3,749,928 gross Worker
Tokens**；顶层与 per-model 完全匹配。runtime estimate 为 **USD 5.086984**；订阅路线没有
逐请求官方价格，不能把 runtime estimate 当账单。没有 exact-pair direct-Main baseline，
因此 direct savings unavailable；算术 boundary range 也不叫节省。

Worker 候选 4 files / 486 changed lines，机器完整套件 1,380/1,383：三个失败都是把单个
PID 传给只接受 iterable 的 `waitForPidExit`，strict TypeScript 同样报出这三处。Main 记录
`revise`，没有再调用 Worker，保留 exact home + exact tracked PID 的 teardown 架构，并补两点：

1. `waitForPidExit` 同时接受单 PID 和 PID 集合，消除三处相同误用；
2. cleanup 只有在进程、socket、home 的所有应执行检查成功后才缓存“已完成”，真实 leak 抛错后
   finally 仍可再次清理，不会出现 false success。

聚焦生命周期批次 **122/122**，完整套件 **1,383/1,383**，strict TypeScript、production
build、Hub JavaScript syntax 与 `git diff --check` 全绿。Remediation check
`7e1a8bd5-1e0e-4fe9-aca1-5e164e2c5fae` 以原合同 **4/4** 记录
`verified-repaired-delivered`，Worker Task 保持 failed。测试后没有临时 detached daemon；
正式 Daemon PID `21176`，client/daemon build id 匹配
`e138a43deae2a9fd689c480cdb8e555b49add6f8c5cea18f428a654efff73dcf`。这是 Main 修复与
手工 runtime 切换，不计 automatic Integration，M0 仍为 **0/3**。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D227 | detached test daemon 只发 shutdown/SIGTERM、未验证 PID 与 socket 完整退出，失败断言可把临时 daemon 留给后续 dogfood | **closed 2026-07-28**：测试专用 fixture 立即登记 exact home/PID，bounded teardown 只处理 tracked owner，验证进程/socket 后才移除精确 home；untracked endpoint fail closed |
| FL-D228 | cleanup 在执行前缓存“已完成”，若中途 leak check 抛错，finally 的再次调用会跳过真正清理 | **closed 2026-07-28**：仅在全部 owned cleanup 成功后标记 completed；失败路径可重入，原错误仍可见 |

## 2026-07-28 Hub 恢复说明与 succeeded+revise 裁决缺口

Task `fbd403bd-fb4d-49b9-9a66-bb968a0be374` 使用 DeepSeek
`deepseek-v4-pro[1M]`，只有一个 Attempt；目标只有 README 和 operations 两份恢复说明，
以减少实现风险并尝试第一次 automatic Integration/activation。Worker 运行 21 turns，候选
2 files / 87 changed lines，机器 4/4 命令全绿：Hub lifecycle **11/11**、完整套件
**1,383/1,383**、strict TypeScript 和 `git diff --check`。

Attempt gross 为 **446,023 Worker Tokens**（input 31,608、output 13,647、cache read
400,768），顶层与 per-model 匹配；runtime estimate **USD 0.699599**，DeepSeek PAYG
估算 **USD 0.027075154**，不是账单。没有 exact-pair baseline，direct savings unavailable。

Main 审查仍判 `revise`：候选把 Hub token 写成 `one-time access token`，实际 token 在该 Hub
owner 生命周期内有效；另有文案把 Hub/Daemon 关系说得像 Hub 管理 Daemon。Main 没有再次调用
Worker，保留恢复场景表，只把 token 改为 lifetime-private 语义，并重申 Hub 是控制界面、Daemon
独立运行。当前源码重新通过 focused 11/11、full 1,383/1,383、strict TS 与 diff check。

但 ForkLight 拒绝为这次修复运行 remediation verify：该入口只接受 machine failed/interrupted，
而本 Task 是 succeeded + Main revise。原候选又因 immutable patch digest 不能在修正后冒充已审查
版本。因此不能安全 accept/integrate，也没有 automatic activation；M0 仍为 **0/3**。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D229 | machine succeeded 但 Main 因事实/边界错误判 revise 时，既不能对 Main 修复做 remediation verify，也不能修改后继续使用原 accepted patch digest；结果只能手工交付，无法形成正式 disposition | **closed 2026-07-28**：只允许 latest typed Main review=`revise` 且精确绑定 current Attempt + latest verification 的 succeeded Task 进入 no-Worker remediation；保留原 Task/Attempt/review/revision/digest/Integration authority，并已用原 Task `fbd403bd-fb4d-49b9-9a66-bb968a0be374` 真实跑通 4/4 |

## 2026-07-28 succeeded + Main revise 无 Worker 修复验收 dogfood

Task `315aa75e-257c-496a-a56e-610271ea4c4f` 使用 DeepSeek
`deepseek-v4-pro[1M]`、Claude Code high，严格限制为一个 Attempt；没有 correction、retry、
competition 或 adaptation。目标是补上 FL-D229：机器检查通过但 Main 判 `revise` 时，允许 Main
修正当前源码后复用原 acceptance，不能为了一个事实或边界问题强制整单重跑 Worker。

唯一 Attempt `c3988b86-8570-4b64-8026-8df44f558b56` 运行 49 turns。terminal usage 为
input 55,960、output 48,747、cache read 1,905,408，即 **2,010,115 gross Worker Tokens**；
顶层与 per-model 完全匹配。runtime estimate 为 **USD 2.451179**；DeepSeek PAYG 估算为
**USD 0.073659594**，不是账单。15 个 exchange receipts 得到 **1,858–11,078 Tokens** 的
Main exchange estimate；没有 exact-pair direct-Main baseline，因此不能宣称节省了多少 Main
Token，`1,999,037–2,008,257` 只是不含估算编排交换的 Worker 计算边界。

Worker 候选的核心判断可复用，但机器聚焦验收为 20/32：11 个新增测试先创建 Attempt、后创建
Task，触发 SQLite foreign-key failure；1 个旧测试因为提示文案改写失去兼容。Main 没有启动
第二个 Worker，而是保留 eligibility 实现，改用统一 fixture 按 `Task → Attempt → event` 创建
证据，保留 active-status 的旧固定提示，并补上 Worker 遗漏的关键边界：最新 verification event
的 Attempt envelope 本身也必须等于 current Attempt，不能只比 review payload 和 event sequence。

Main 修复后，聚焦 remediation/Main Review **25/25**，完整套件 **1,388/1,388**，strict
TypeScript、production build 与 `git diff --check` 全绿。原失败 Task 通过 remediation check
`b516397a-0208-4865-9214-6d3fbc0fff1c` 以原合同 **4/4** 记录
`verified-repaired-delivered`，机器状态仍为 failed。

随后用最初暴露缺口的真实历史 Task `fbd403bd-fb4d-49b9-9a66-bb968a0be374` 验证新路径：它的
机器状态继续是 succeeded，Main review 继续是 revise，没有新 Worker、没有改写 Candidate
Revision 或 patch digest；remediation check `03fa0fa2-a3e3-4a83-8918-4a0d569f94f9` 对当前
Main 修复源码执行原 **4/4** acceptance 并记录 `verified-repaired-delivered`。这证明“候选部分
可用 → Main 定向修正 → 原验收重跑 → 独立记录交付”已经形成闭环，同时没有扩张 Integration
或 activation 权限。Daemon 手工更新到 PID `2819`，client/daemon build identity 匹配
`07f66276a235d32ddf5827b2e294775d4091087b688dcd2a71f6c84df2f5c855`；仍未走 automatic
Integration activation，所以 M0 保持 **0/3**。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D230 | Worker 新测试把 Attempt 建在 Task 之前，导致 11 个用例在业务判断前统一触发 foreign-key failure；若直接按失败率重跑，会浪费一整次模型成本 | **closed 2026-07-28**：Main 复用候选，统一 fixture 按真实持久化顺序创建，并以完整原 acceptance 验收；该类 setup failure 应归为可修复测试夹具问题，不自动重启 Worker |
| FL-D231 | Worker 只验证 review payload 的 Attempt 与最新 verification sequence，未验证 verification event envelope 自身属于 current Attempt | **closed 2026-07-28**：eligibility 同时绑定 Task.currentAttemptId、latest review event/payload、latest verification event 和精确 sequence；新增 wrong-Attempt 与 mismatched-envelope fail-closed 回归 |

## 2026-07-28 Worker Quality Hub 配置 dogfood

Task `fc507e1a-4332-456c-82d6-d91a708b94df` 使用 DeepSeek
`deepseek-v4-pro[1M]`，仅一个 Attempt；没有 competition、correction、retry、adaptation 或
单 Task 上限。这个新 task class 在 DeepSeek、MiniMax、Volcengine 上都没有可比较样本，路由建议
竞争；Main 为避免无证据地把成本放大三倍，选择建立一条 DeepSeek 样本，未启动竞争。

Worker 运行 90 turns，候选实现了共享 resolver 的 preview endpoint、Worker Quality 编辑、来源
说明和聚焦测试。主体可复用，但机器完整验收为 1,400/1,401：新增静态测试要求 HTML 中出现
`id="fl-worker-preview"`，而页面真实通过 JavaScript property 设置该 id。Main 审查另发现更重要的
产品边界：最大值留空同时承担“继承”和“不限”两个含义，旧 override 又会在 preview/save 时被
merge 回来；mode 也无法恢复全局继承。直接重试 Worker 会增加成本，却不会比 Main 定向修正提供
更多信息，因此 Main 记录 `revise`，没有创建第二个 Attempt。

最终实现为三个最大值提供 `inherit / unlimited / limited` 明确状态；最小值留空代表继承，显式
0 保留；编辑器加载完整当前状态并发送完整可见 draft，用户清空所有覆盖值后旧配置不会被静默
恢复。卡片、预览和中英文文案改为说明“对任务说明有什么要求、最终采用了谁的设置”，文件/行数
文案也明确这里约束的是 Task 声明范围，不是 Worker 运行时产出上限。

聚焦 Quality/Hub 批次 **127/127**，完整套件 **1,402/1,402**，strict TypeScript、production
build、Hub JavaScript syntax 与 `git diff --check` 全绿。原合同 remediation check
`f54b5b11-f14c-44c1-a12a-8d3e1296b99f` 以 **5/5** 记录
`verified-repaired-delivered`，Worker Task 仍保持 failed。

Attempt usage 为 input 147,256、output 34,222、cache read 10,515,584，即
**10,697,062 gross Worker Tokens**；顶层与 per-model 完全匹配。runtime estimate 为
**USD 6.849622**，DeepSeek PAYG 估算为 **USD 0.131948492**，都不是账单。没有 exact-pair
direct-Main baseline，因此不能把 `10,544,683–10,672,197` boundary range 表述成真实节省。
Daemon 手工更新为 PID `52511`，client/daemon build identity 匹配
`930e60f612cf818d4d41968c9b4a49916dd6631ff679fb879f6836a8ba0d83db`；未走 automatic
Integration activation，M0 保持 **0/3**。

### 新发现与 disposition

| ID | 问题 | 当前 disposition |
| --- | --- | --- |
| FL-D232 | Worker Quality 最大值留空同时表示“继承”和“不限”，编辑旧配置时又 merge 回旧值，用户无法真正移除覆盖 | **closed 2026-07-28**：最大值显式三态，最小值与 mode 可恢复 inherit；Hub 提交完整 draft，空覆盖会真正删除，不再被旧值补回 |
| FL-D233 | 新增静态测试把运行时 DOM property 当成必须存在的原始 HTML attribute，制造了与真实页面无关的假失败 | **closed 2026-07-28**：断言改为应用实际赋值方式，并补“所有 Quality 字段都能返回全局继承”的行为回归 |
| FL-D234 | production build/Daemon 已更新时，长驻 Hub owner 仍可运行旧 server code；静态 UI 已是新版本但 API 缺少 `previewQualityPolicy`，页面只显示空预览且没有 console error | **closed 2026-07-28**：descriptor 冻结构建身份；仅相同 build 复用，legacy/不同 build 必须显式确认 replacement；真实 A→B 切换证明旧 owner 退出后才启动新 owner，同端口始终只有一个 listener |
| FL-D235 | 精确 Hub owner 收到 SIGTERM 后释放 listener、descriptor 和 claim，却在 7 秒后仍未退出；只有核对 ownership 已释放后对 exact PID 发 SIGKILL 才完成清理 | **closed 2026-07-28**：graceful stop 共享完整关闭 promise；replacement 在 SIGTERM 前后核对 exact owner，并等待旧 PID、listener、claim、descriptor 全部消失；不自动 SIGKILL，ownership 改变即 fail closed；真实子进程测试要求 3 秒内自然退出 |

### 真实浏览器验收

Main 在精确重启 Hub owner 后重新执行同一操作：中文和英文均明确说明 Quality 只检查 Task
说明，不限制 Worker 实际产出；`maxFiles` 从 inherit 切到 unlimited 后预览显示“无限制 / Worker”，
切回 inherit 后显示 `20 / 全局默认`；`minScenarios=0` 显示 `0 / Worker`，清空后恢复
`2 / 全局默认`。全程没有点击保存，最终表单保持原配置，browser console 0 error/warn。

## 2026-07-28 Hub 版本识别与安全接管 dogfood

Task `b14dca06-a543-4329-b6df-8dca459bc57c` 使用 DeepSeek
`deepseek-v4-pro[1M]`，只运行一个 Attempt；没有 competition、retry、correction、adaptation 或
单 Task 上限。唯一 Attempt `4f2fcf83-d35e-48aa-a0f2-ffff37e5c129` 运行 42 turns，候选规模为
5 files / 669 lines。

Worker 机器结果为 focused **57/58**、full **1,411/1,412**，strict TypeScript 3 个错误；其中
行为失败来自测试把 claim 和 descriptor 写成不同 nonce，安全实现因此先报告 ownership changed，
而不是测试期待的 dead PID。Main 判 `revise`，未启动第二个 Worker。进一步审查发现候选仍可能
重启当前相同版本 Hub、在授权后没有冻结并复核 exact owner、等待期间可能把新 owner 的记录误判
为“已消失”，并且缺少真实子进程自然退出的硬测试。

Main 保留候选主体并定向修正：descriptor 记录 build identity；只有相同 build 可直接复用，legacy
或不同 build 必须显式确认 replacement；replacement 冻结 claim/descriptor 原始字节和 PID，在
SIGTERM 前再次核对 owner、认证探针和 PID；等待期间发现记录被替换就 fail closed；只有旧 PID、
listener、claim、descriptor 全部消失才成功；永不自动 SIGKILL。Hub server 的并发 stop 共享一个
完整关闭 promise，先启动 server close 再处理连接；真实 spawn 的 CLI Hub 必须在 SIGTERM 后 3 秒
内退出，SIGKILL 只允许作为失败测试清理，不能伪装为成功。

最终 focused **59/59**、full **1,413/1,413**、strict TypeScript、Hub JavaScript syntax 与
`git diff --check` 全绿。原 Task remediation check
`5198196f-e602-4ac4-9114-5fd25da2b13c` 以原合同 **5/5** 记录
`verified-repaired-delivered`；机器 Task 仍保持 failed。

Attempt usage 为 input 117,497、output 41,651、cache read 3,940,480，即
**4,099,628 gross Worker Tokens**；顶层与 per-model 一致。runtime estimate 为
**USD 3.599000**，DeepSeek PAYG 估算为 **USD 0.101631805**，都不是账单。Main exchange
envelope 为 **144,284–879,326 Tokens**；没有 exact-pair direct-Main baseline，因此
`3,220,302–3,955,344` 只是边界计算，不表述成节省的 Main Token。

真实交接使用同一端口 `127.0.0.1:56962`。版本 A build id 为
`3504c6018e09aa88d29fd61aaace16de9e61fbb6f38af29d1a0081dead9f9a19`，Hub PID
`16845`；随后构建版本 B，build id 为
`6622224ebae96f77db424b35cc16bfc9877dd343ebafcdeb1e5382e58e950170`。普通 B 启动只诊断
A 为不同版本，不发信号且保持单 listener；显式 `hub restart --confirm` 后，A 自然退出，B 以
PID `17258` 接管相同端口，descriptor 更新为 B，全程没有两个 listener 重叠。Daemon 手工刷新为
PID `17712`，最终 client/daemon build identity 匹配 B。

这是 Main remediation 加人工 runtime handoff，不是 Worker machine success → Main accept →
automatic Integration activation，因此 M0 仍为 **0/3**。下一步必须选择更小、可机器成功的真实功能，
让 accepted Candidate 通过 Integration 自动完成构建和 daemon 切换，不能把本轮记成 1/3。没有
commit 或 push。

## 2026-07-28 第一次自动 self-upgrade 成功（M0 1/3）

Task `8b3528b5-f9f1-495d-abb5-687f43be66d5` 用一个 DeepSeek
`deepseek-v4-pro[1M]` Attempt 实现 `forklight daemon restart`。没有 competition、retry、
correction、adaptation、时长上限、Token 上限或金额上限。Worker 运行 27 turns，候选为 2 files /
197 lines；产品代码仅在 `src/cli.ts` 增加 usage 和 5 行 restart 路由，直接调用已有共享
`restartDaemon()`，其余为隔离临时 `FORKLIGHT_HOME` 的真实进程测试。

机器验收 focused **118/118**、full **1,418/1,418**、strict TypeScript、`git diff --check`
全部通过。测试同时证明运行中的旧 PID 消失、新 PID 不同且 build identity 匹配；无 owner 时 restart
会启动一个真实 daemon；非法 operation 仍拒绝；测试不会触碰用户正式 Daemon。Main 审查 exact
Candidate Revision 后直接 `accept`，没有改候选、没有 Main repair，也没有第二个 Worker。

Integration operation `df91aaeb-d138-460c-9d7c-32af3d621b79` 依次通过
`source-applied`、`source-verified`、`artifact-built`、`runtime-activated` 四个 stage。旧正式
Daemon PID `17712` 已退出，自动激活的新 Daemon PID 为 `39407`，build id
`eb249f02f7018440b38094caecb54b83c72360e40da10885811175273db4b9fe`，source digest
`0b4d3011172a79fbd6f4d7a9f520682576c792e55bdc9afed7c05c770ef18166`，active/queued
Task 均为空。这是第一条完整的 machine success → Main accept → automatic Integration → build →
daemon handoff → identity proof 链路，因此 M0 从 **0/3 前进到 1/3**。

新 build 的普通 Hub 启动先识别 PID `17258` 为上一构建，只给出确认动作且没有发信号；显式确认
后旧 Hub 自然退出，PID `40369` 接管同一 `127.0.0.1:56962`，只有一个 listener，descriptor
与 Daemon 都报告同一新 build。Hub 的这一步是保证当前运行环境一致的人工确认，不是 M0 计数来源。

Attempt usage 为 input 86,146、output 11,251、cache read 1,270,144，即
**1,367,541 gross Worker Tokens**；顶层与 per-model 完全匹配。runtime estimate 为
**USD 1.347077**，DeepSeek PAYG 估算为 **USD 0.051866152**，均不是 Provider 账单。18 条
receipt 得到 **157,974–971,114 Tokens** 的 Main exchange envelope。没有 exact-pair
direct-Main baseline，因此不把 `396,427–1,209,567` 边界差额称为节省的 Main Token。
没有 commit 或 push。

## 2026-07-29 Grok TUI 与 Daemon 连通环境差异

历史失败 Task `d576b0dd-4ada-4ae0-ac0e-153692f79b46` 的 Grok 进程无法访问其 CLI
服务；同一时刻，一骏手动打开的 Grok TUI 可以正常使用。只读进程环境审计发现：TUI 继承了
`HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`，当时的 ForkLight Daemon 三项都没有。Operator
auth 与 Task 私有副本的 hash 和大小一致，因此排除了鉴权复制差异。结论是后台进程启动环境不同，
不是 Grok 模型能力或账号失效。

Task `00b0cd43-eeba-40d1-9d6e-c5b5e6c73c1b` 随后用保存的 xAI `grok-4.5` /
`grok-build` Worker 实现持久化分类、统计口径和双语 Task Detail 解释。只有一个基础 Attempt，
30 turns，runtime estimate **USD 1.195446**；Grok runtime 没有返回完整 usage，因此 Worker Tokens
和官方 Provider 账单保持 unavailable。Candidate 为 14 files / 534 changed lines，超过 12-file
软提醒但没有因数字机械失败。

原合同五条独立检查中唯一失败的是 `npm run typecheck`，而仓库根本没有这个 script；真实类型/构建
入口是 `npm run build`。这是 Main 写错不可变验收合同，不是 Worker 或模型失败。Main 没有启动
retry、correction、competition 或 adaptation，也没有把原 Task 改写成成功；它保留完整 Candidate，
只补上一个隐私缺口：连接失败形状的 Grok terminal event 在持久化前也必须替换为固定安全摘要，
原始行只留在私有 Attempt log。未来合同已改用真实 build 命令。

最终聚焦测试 **171/171**、全量 **1,595/1,595**、`npm run build`、Hub JavaScript syntax 和
`git diff --check` 全部通过。新的 `connectivity` 分类不会成为模型质量负证据；Hub 用白话说明
“手动 TUI 与后台 Daemon 可能继承不同网络环境”，建议从同一可用终端安全重启并重新检查，不展示
代理值、凭据或 endpoint 细节，也不自动重启、重试、改路由或修改设置。

当前正式 Daemon PID `15555` 与 CLI 使用 build
`66246015907045d58bb7610ca36602d4ea5be601ae5cebc8249a074263cc6838`，无 active/queued Task，
并确认只存在三项代理变量名；Hub PID `16298` 在 `127.0.0.1:56263` 为 `current`。本轮没有自动
Integration，没有 commit 或 push。

## 2026-07-29 Relay R4：跳到产品层，交付可解释的“今日简报”

一骏选择先跳过更多 ForkLight 内部打磨，直接用它推进 Relay 的后续产品能力。Main 把第一条
Automation / Digest 切片收窄为纯只读的“今日简报”：只消费 Relay 已有 Item、Assignment 和
Job，确定性地产出最多三条行动建议；不引入规则引擎、定时器、LLM 摘要、数据库或后台写操作。

Task `c127bb97-0cbb-45ed-97e8-bc5f001bf97c` 使用 MiniMax `MiniMax-M3`。首次 Attempt
83 turns，产出 4 files / 764 changed lines，12/12 行为测试与 diff hygiene 通过，但 Main
发现三处事实边界：历史 pending-review Assignment、跨 Item Job 状态和 active 数量都可能被误读。
Main 没有整单重跑，而是在同一 Candidate 上只做一次结构化 correction；第二次 Attempt 20
turns，把改动收敛到约 540 行并修正上述语义。两次 Attempt 合计 input 149,732、output
63,313、cache read 7,801,074，即 **8,014,119 gross Worker Tokens**；Main exchange envelope
为 **144,638–875,918 Tokens**。没有 exact-pair direct-Codex baseline，因此不声称节约 Main
Token。对这类四文件确定性 UI 小切片，MiniMax 的 103 turns 和 8.01M gross volume 仍明显偏高，
以后应通过更精确的符号/验收入口降低反复读取，而不是增加重试轮数。

Task 最终仍是 machine-failed，原因不是目标行为失败，而是 Main 冻结验收前漏做基线检查：项目
当前 ESLint 10.8 与 Next React plugin 不兼容，未修改的 `src/app/page.tsx` 也会在加载
`react/display-name` 时抛出 TypeError。一次 Main correction 用尽后没有启动第三个 Worker，也
没有伪造成功或绕过 ForkLight Integration。Main 审查后用 `apply_patch` 把四个候选文件写回
Relay，再做有限定点修正：行动名称改成“验收结果 / 优先处理 / 查看进度 / 打开事项”，文案只
陈述可证明事实，并把简报放到今日页统计之前。

最终目标行为 **12/12**、兼容 ESLint 9、`git diff --check` 通过。全局 TypeScript 仍只被并行
Team/Postgres 开发线缺少可选 `pg` 类型阻断，未在本任务越界修复。桌面和 390px 窄屏真实浏览器
验收完成；窄屏发现固定侧栏挤压主内容后，只做一轮响应式修正并确认可读。该样本证明“一次部分
复用、一次 Main 纠正、随后停止”的链路可用，也暴露 Main 必须在冻结验收前先验证仓库基线。
没有 commit 或 push。

## 2026-07-28 MiniMax 只读 Hub 状态候选（Main revise，M0 仍 1/3）

Task `14ed39d0-2cc0-4644-b199-737532cd29a6` 使用一个 MiniMax `MiniMax-M3`
Attempt，没有 competition、retry、correction、adaptation 或自动参数调整。目标是提供
`forklight hub status [--json]`：只读核对 Hub 是否停止、当前版本、不同版本、legacy 或无法安全
证明；不能创建 claim、启动/接管服务、改 lifecycle 文件、发信号或输出 token/nonce/URL。

Worker 运行 75 turns，候选为 4 files / 765 lines。机器 focused **45/45**、full
**1,435/1,435**、strict TypeScript、Hub JavaScript syntax、`git diff --check` 全绿。候选主体
确实复用了 exact claim/descriptor、PID、authenticated loopback 和 probe 后 raw re-read，并让 CLI
在 discovery/claim 之前返回；测试覆盖空 home 不创建、五种状态、原始字节不变、认证失败、owner
变化、CLI human/JSON 不泄露秘密。

Main 仍判 `revise`：CLI 当前调用确实传入 build identity，但导出的 inspection options 把
`runIdentity` 设为可选，并在未传 comparator 时把任意已证明的 versioned owner 返回为 `current`。
这让未来内部调用者可以跳过版本比较却得到错误事实。修复要求是在类型边界强制有效 run identity、
让 nextAction 成为 total 字段，并补缺 comparator 的边界回归。Main 没有启动第二个 Worker，也没有
accept/integrate 候选，因此不能记为自动 self-upgrade，M0 保持 **1/3**。

Attempt usage 为 input 144,833、output 47,908、cache read 6,578,162，即
**6,770,903 gross Worker Tokens**，顶层与 per-model 匹配。runtime estimate 为
**USD 5.210946**。MiniMax 官方单次成本因为缺少所需 billing rows 而不可用，没有伪造为 0；Main
exchange envelope 为 **26,261–160,651 Tokens**。没有 exact-pair direct-Main baseline，
不把边界算术差额叫作节省。MiniMax 的长阅读/思考路径和 Main semantic miss 保留为后续模型调度
样本。没有 commit 或 push。

## 2026-07-28 复用 MiniMax Candidate，自动 self-upgrade 达到 M0 2/3

Main 没有让 MiniMax 重跑 677 万 Token 的只读 Hub 状态实现，而是把原 Candidate 完整保留到
当前源码，只把审查发现的唯一剩余缺口写成 DeepSeek Task
`6ff650f4-6123-4643-aa4a-82f15e63389c`。新 Task 只允许三件事：`HubInspectionOptions` 强制
有效 `runIdentity`；不安全 JavaScript/类型绕过在读取 lifecycle 前 fail closed；每个状态都必须
有一个完整 next action。原 `HubDiscoveryOptions` 的可选 comparator 和 legacy 兼容逻辑禁止修改。

DeepSeek 唯一 Attempt 运行 21 turns，候选 3 files / 99 lines。focused **46/46**、full
**1,436/1,436**、strict TypeScript、Hub JavaScript syntax、`git diff --check` 全绿。Main 审查
确认它没有碰 discovery 兼容边界，直接 accept，没有 Main repair、第二 Worker、retry、correction 或
adaptation。

Integration operation `55ccac9a-ab49-4308-bdf8-df575dfe60bc` 的
`source-applied`、`source-verified`（5 commands）、`artifact-built`、`runtime-activated` 全部
passed。旧 Daemon PID `39407` 已退出，自动激活的新 PID 为 `52232`，build id
`a655daf034eccd7ec5659f8d4b5f30af59672b5fc68e830462c0dd5279b8fee5`，source digest
`756df610253e814e936ce50e07d5b229f8349d0c6049eefb729134d8905febcf`。

真实 CLI 验收先对仍运行旧 build 的 Hub 调用新 `hub status`：JSON 只返回
`different-build`、已证明的 PID/port 和 `restart-with-confirm`，human copy 也只给一个动作，没有
token、nonce、URL、私有路径或 raw build id；普通 `forklight hub` 同样只诊断不发信号。显式确认
后旧 Hub PID `40369` 自然退出，新 PID `53147` 接管相同 `127.0.0.1:56962`，单 listener，最终
`hub status` 为 `current`，Hub 与 Daemon build 一致，active/queued Task 都为空。

Attempt usage 为 input 69,138、output 16,706、cache read 953,088，即
**1,038,932 gross Worker Tokens**，顶层与 per-model 匹配。runtime estimate 为
**USD 1.239884**，DeepSeek PAYG 估算为 **USD 0.048064194**，均不是 Provider 账单。23 条
receipt 得到 **152,555–937,782 Tokens** Main exchange envelope；没有 exact-pair direct-Main
baseline，不把边界算术称为节省。它是连续第二次 accepted Candidate → automatic Integration →
build → daemon activation → identity proof，因此 M0 从 **1/3 前进到 2/3**。没有 commit 或 push。

## 2026-07-28 第三次自动 self-upgrade 完成（M0 3/3）

Task `da3747c8-ee83-430e-882d-d9509fa9b9eb` 使用一个 DeepSeek
`deepseek-v4-pro[1M]` Attempt，把通用机器成功文案从容易误解的“已验收/已交付”改为
“检查已通过”，并用独立的 Main/交付状态表达最终结论。唯一 Attempt 运行 21 turns，候选为
2 files / 31 lines；没有 competition、retry、correction 或 adaptation。

focused **61/61**、full **1,440/1,440**、strict TypeScript、Hub JavaScript syntax 和
`git diff --check` 全绿。Main 接受 Candidate Revision
`a4641846-36f6-4dbd-9b8b-a333011a6d43`；Integration operation
`75377f32-d1ad-4ba4-9a26-42f98cc70f81` 的 source apply、5 项 source verification、artifact
build、runtime activation 全部通过。旧正式 Daemon PID `52232` 退出，自动激活的新 PID 为
`75123`。当前 build id 为
`f8155ae0ecd58ecae014da7f61c5509caf7387c94ac22f2528366937b670821a`，source digest 为
`ac08078351154204f42c215f6f96ad1e99192598a2c2d80e4aca3c18119ff609`。

旧 Hub PID `53147` 被新 CLI 只读诊断为 `different-build`，显式确认后自然退出；PID `76185`
接管同一 `127.0.0.1:56962`，最终 `hub status` 为 `current` 且只有一个 listener。真实浏览器
确认 Task board 会优先显示“Main 要求修改”和“已核验交付”，不再把机器检查通过冒充最终验收。
Task Detail 的首个 badge 对旧 Main-revise Task 仍可能只显示“检查已通过”；这是真实 M1 可读性缺口，
不伪装成已经解决。

Attempt usage 为 input 53,716、output 5,166、cache read 582,144，即
**641,026 gross Worker Tokens**；runtime estimate 为 **USD 0.688802**，DeepSeek PAYG 估算为
**USD 0.029971152**，都不是账单。Main exchange envelope 为 **23,021–141,352 Tokens**。
没有 exact-pair direct-Main baseline，因此不把边界差额叫作节省。第三条 accepted Candidate →
automatic Integration → build → daemon activation → identity proof 成立，M0 自动升级计数达到
**3/3**。没有 commit 或 push。

## 2026-07-28 GLM 部分候选复用与有界停止

Volcengine GLM Task `602f5202-6d3a-4a55-950a-bde0c97ecd61` 已完成目标代码，但随后持续重复检查
一个无关正则字符，长时间没有新的实现进展。Main 在确认 3 文件候选已稳定后终止精确 Worker PID，
没有启动第二个 Attempt，也没有自动调整参数循环重试。候选被保留到当前源码；Main 只修复一处
strict TypeScript 返回值边界，focused 60/60、当时 full 1,439/1,439、JavaScript syntax 和 diff
检查通过。原 Task remediation check `730b40cc-e37c-440f-ba90-c7b72c25e4da` 以原合同 **5/5**
记录 `verified-repaired-delivered`。尝试额外 resume 时，Task 的 `maxExtraAttempts: 0` 正确拒绝，
证明配置确实生效。由于 Worker 被有界终止且没有完整 canonical usage，不伪造 Token 或单次成本。

## 2026-07-28 测试 Daemon 泄漏审计与零重跑修复

M0 出口进程审计在正式 Daemon/Hub 之外发现 20 条 source-dev Daemon。逐 PID 的 Unix socket 和
open-file 证据证明它们全部属于 `forklight-restart-running-*`、`forklight-hub-instance-*` 等测试
临时 Home，没有一条连接正式数据库或正式 socket。Main 只向这 20 个已证明的测试 PID 发送普通
SIGTERM；正式 Daemon PID `75123` 和 Hub PID `76185` 未被触碰，20 条测试进程全部自然退出。

ForkLight Task `c9bb5cc9-c4ac-41ec-b0b9-0077e78e5505` 随后用一个 DeepSeek Attempt 修补夹具。
Worker 候选为 4 files / 112 lines，机器 focused 52/52、full 1,443/1,443、strict TypeScript 和 diff
检查通过。Main 仍判 `revise`：替代 PID 的接管被放在后续断言之后，且 Hub 与 Daemon 同时清理
失败时第二条证据仍会被遮住。Main 没有重跑 843,440 Worker Tokens，而是保留候选，前移精确 PID
接管，并用 `AggregateError` 同时保留两条清理失败。

Main 修复后的 focused **52/52**、full **1,443/1,443**、strict TypeScript、`git diff --check`
通过；两次独立全系统进程审计均为零 source-dev Daemon。正式 remediation check
`9e3b07c3-99fc-4cf8-84c7-69e5aab11061` 以原合同 **4/4** 记录
`verified-repaired-delivered`，没有第二 Worker、retry、correction 或 adaptation。

该 Attempt 使用 input 42,529、output 23,567、cache read 777,344，即
**843,440 gross Worker Tokens**；runtime estimate 为 **USD 1.190492**。官方单次价格因当前
pricing route 不受支持而明确 unavailable，没有记成 0。Main exchange envelope 为
**226,380–1,384,988 Tokens**，区间甚至跨过 Worker volume；没有 exact-pair direct-Main baseline，
所以无法声称节省了 Main Token。

## M0 出口完成

三条自动 self-upgrade 链已达到 **3/3**，CLI/正式 Daemon/Hub 当前一致，单 Hub listener，正式
Task active/queued 均为空，测试 Daemon 残留为零。本长程 Codex Task 的 MCP 进程仍是启动时加载的
旧 build `2bcdcc37af9a2b99b9faf3deb41701ef1c8a3af5de4922804ccb71092495bebd`，同一会话不能热更新；
因此 Main 调度一个全新的 collaboration Agent 做只读出口审计。

新 Agent 加载的 MCP build 为
`f8155ae0ecd58ecae014da7f61c5509caf7387c94ac22f2528366937b670821a`，与 CLI 和 Daemon 完全
一致，三者 source digest 都是
`ac08078351154204f42c215f6f96ad1e99192598a2c2d80e4aca3c18119ff609`，`identityStatus` 为
`matched`。正式 Daemon PID `75123` 无 active/queued Task；Hub PID `76185` 在同一
`127.0.0.1:56962` 返回 `current`。这证明新 Main 会话会加载当前 MCP，而不是继承旧进程。
M0 的所有退出条件均已有直接证据，**M0 正式完成，进入 M1**。没有 commit 或 push。

## 2026-07-28 M1.1：Task Detail 的首要结论与 Main 决策一致

DeepSeek Task `692d386d-064d-4870-b242-a5783697256e` 处理一个明确的用户事实缺口：
Task 列表已经把 Main 的 `revision-requested` 显示为“Main 要求修改”，但详情接口只提供嵌套
`decision.stage`，详情页首个 badge 因而回退成机器状态“检查已通过”。唯一 Attempt 没有 competition、
retry、correction 或 adaptation；候选改动 2 个文件 / 150 行，focused **90/90**、full
**1,445/1,445**、strict TypeScript、Hub JavaScript syntax 和 diff 检查通过。Main 接受 exact
Candidate，Integration operation `4bec0a66-07a8-427c-bcbb-e49c4289fe2f` 完成 source apply、
source verification、artifact build 和 runtime activation。

该 Attempt 使用 input 204,294、output 9,695、cache read 900,352，即 **1,114,341 gross Worker
Tokens**；runtime estimate 为 **USD 1.714021**，DeepSeek PAYG 估算为 **USD 0.100566316**，均
不是 Provider 账单。20 条 receipt 给出 **193,748–1,189,221 Tokens** 的 Main exchange
envelope；没有 exact-pair direct-Main baseline，因此不把边界算术称为节省的 Main Token。

## 2026-07-28 M1.1：失败 Candidate 的部分复用与正式 Main 修复

DeepSeek Task `5b139291-7e80-49e2-9312-d76e4c4f4b74` 负责解释“Worker 留下了什么候选成果，
以及它与机器检查、Main 接受、Main 修复和最终交付有什么区别”。唯一 Attempt 运行 68 turns，
没有 competition、retry、correction 或 adaptation。Worker 产出 4 个文件的实质候选，但独立验收
失败。Main 判 `revise` 后没有启动第二个 Worker，也没有整单重跑。

候选的安全字段、Overview/Result 卡片和双语结构被保留；Main 只做三项有界修复：删除 Hub 自己
实现的 SHA-256，改为复用 canonical `resolveLatestRevision` 与
`candidateRevisionMatchesCurrentDiff`；根据 Main pending/revise/reject/accept/repair 分别解释，
不再把正常接受的候选统一说成“不是最终结果”；把会误命中相邻函数 `diffs` 注释的字符串测试，
替换为函数级安全字段、禁用字段和中英文语义断言。

Main 修复后的 focused **126/126**、full **1,451/1,451**、strict TypeScript、Hub JavaScript
syntax、production build 和 `git diff --check` 全部通过。正式 remediation check
`8e7a7303-a8ae-4223-9919-1f78c23a3aa1` 重跑原合同 **5/5** 命令并记录
`verified-repaired-delivered`；原 Worker Task 和 Attempt 仍保持 `failed`，Hub 可以同时讲清原失败
和后续已验证交付。

该 Attempt 使用 input 135,443、output 33,823、cache read 6,460,032，即 **6,629,298 gross
Worker Tokens**；runtime estimate 为 **USD 4.752806**，DeepSeek PAYG 估算为
**USD 0.111761331**，均不是账单。33 条 receipt 给出 **182,773–1,114,092 Tokens** Main
exchange envelope。没有 direct-Main exact pair，所以不能声称节约了多少 Main Token。当前 CLI、
Daemon 与 Hub 已切换到 build
`8a148033c9f45b35c40d86ae5ec7f4864b5d972359df089a14586c461209c895`；Daemon PID `24196`，
Hub PID `24314`，单一端口 `127.0.0.1:56962`，无 active/queued Task。没有 commit 或 push。

## 2026-07-28 M1.1：最终用户理解审计与关闭

在真实 Hub 中复查机器成功但 Main 判定 `revise` 的历史 Task
`14ed39d0-2cc0-4644-b199-737532cd29a6` 时，发现最后一个事实矛盾：顶部已经正确显示
“Main 要求修改”，但原因仍写成“结果已就绪”，并把 Worker 改动列为“作为最终结果接受的文件”。
这会让用户同时看到互相冲突的结论。

Main 没有为这个紧密耦合的小修复再启动 Worker。最终结果让 Main 的 `revise` / `reject` 决策优先于
机器成功：原因明确说明结果尚未接受或交付，最终接受文件只在 Main 真正 `accept` 时出现，下一步改为
补充具体问题后发起一次修订。中英文使用相同事实结构。

真实浏览器已验证三类关键结果：已接受并交付、Main 要求修改、Worker 失败后由 Main 修复并核验交付；
Provider/认证失败、活跃执行、普通验收失败和 legacy 状态由同一 journey resolver 的可执行 fixtures
覆盖。Focused Hub 测试 **99/99**，full **1,452/1,452**，strict TypeScript、Hub JavaScript
syntax、production build 与 `git diff --check` 通过。Daemon 已切换为 PID `63458`，Hub PID
`63820` 在 `127.0.0.1:56962` 返回 `current`，CLI/Daemon build id 均为
`df297e93bb337febf5a59953e41185f46ccbb0c7bfe884185713a84616c5dd67`，无 active/queued Task。

本小修复 Worker Token 为 **0**。它减少了错误理解和后续误操作风险，但没有 exact-pair
direct-Main 基线，因此不声称节约了多少 Main Token。M1.1 正式完成，下一步进入 M1.2 的四条
真实 Worker readiness 与最小 smoke Task。没有 commit 或 push。

## 2026-07-28 M1.2：DeepSeek 运行时停滞、候选复用与 Worker readiness 交付

Task `2d0222c8-5d13-4b2c-a8a8-d750b736ac19` 使用显式
`workerProfileId: default`，由一个 DeepSeek `deepseek-v4-pro[1M]` Attempt
实现四条 Worker readiness。没有 competition、retry、correction、adaptation、Token 上限、
金额上限或第二个 Worker。Attempt 运行 36 turns 后 Provider response stalled mid-stream，随后
触发已配置的 30 分钟 no-progress watchdog，以 exit 130 结束；没有进入独立 verification。
这是 runtime failure，不作为 DeepSeek 代码能力的永久结论。

隔离 workspace 留下了 `src/core/providers.ts`、新
`src/core/worker-readiness.ts` 和只完成 import 的 `src/hub/server.ts`。Main 审查确认认证模式与
readiness resolver 的方向可复用，但候选缺少完整 server 接线、UI、双语文案和测试，且类型与
Provider verification 形状尚不安全。Main 没有整单重跑，而是保留概念并直接完成有界修复：
Keychain API Key 与 Grok 本地登录成为两条不泄露秘密的认证证据；每个 Worker 的模型、runtime
doctor、Provider/runtime 组合、认证和可选连接检查由一个 canonical resolver 合成；本地可启动与
Provider 已验证保持两个事实；Hub 卡片用白话给出状态、原因和下一步；Worker 编辑器在保存前过滤
不可能的模型/runtime 组合，backend validation 继续作为最终边界。

Focused readiness/Hub tests **148/148**、full **1,462/1,462**、strict TypeScript、Hub
JavaScript syntax、production build 与 `git diff --check` 全绿。原合同 remediation check
`69ff5b2b-b560-4a9e-9118-698805d40e40` 以 **5/5** 记录
`verified-repaired-delivered`；原 Task 与 Attempt 仍保持 failed。真实中英文 Hub 已证明四个保存的
Worker 都显示“可以开始，建议先检查连接”；Grok 使用本地登录，不再误报缺少 API Key；切换到
Grok Build 后模型选择只剩 xAI Grok。

Attempt top-level usage 为 input 139,393、output 11,896、cache read 1,692,928，即
**1,844,217 gross Worker Tokens**。runtime estimate 为 **USD 1.916503**，DeepSeek PAYG
估算为 **USD 0.077122339**，均不是账单。8 条 receipt 给出 **3,980–23,847 Tokens** 的
Main exchange envelope。per-model gross 比 top-level 多 145,426 Tokens，已作为 reconciliation
mismatch 保留，未擅自挑选较大的数字。没有 exact-pair direct-Main baseline，因此不把
`1,820,370–1,840,237` 的边界算术称为节省的 Main Token。

正式 Daemon PID `80104` 与 CLI 使用 build
`ef9e92b0eee4424d99f676a0e0dd9b281b9b92e2be38f0d1b24a509b674f1a8a`；Hub PID
`71345` 在单一 `127.0.0.1:56962` listener 返回 `current`，无 active/queued Task。M1.2
readiness slice 已交付，但四条真实 Worker smoke 仍未完成，不能把本轮 DeepSeek runtime failure
算成成功路径。下一步先补真实 Worker Profile 的提交前预览与校验，再用 Grok、GLM、MiniMax 和一个
更小的新 DeepSeek Task 各做一次单 Attempt 证明。没有 commit 或 push。

## 2026-07-28 M1.2：Grok 真实执行、候选复用与提交前 admission preview

Task `45fa7412-c099-4b14-87cc-4f97b8f30f04` 使用显式
`workerProfileId: local-grok-builder`，实际解析为 xAI `grok-4.5` + Grok Build。唯一 Attempt
运行 37 turns；没有 competition、retry、correction、adaptation、第二 Worker、Token 上限或金额
上限。Grok 候选新增 canonical Task admission preview、read-only daemon `validate_file`，并让 CLI
validate 使用真实保存的 Worker Profiles 和 model catalog，而不是 built-in fallback。

机器 focused **137/137**、full **1,475/1,475**、Hub JavaScript syntax 全绿，但 strict
TypeScript 因一个测试 helper 把 `undefined` 显式传给 exact optional property 而失败，
`git diff --check` 因 `tests/daemon.test.ts` 文件末尾多一个空行而失败。候选为 8 files / 1,118
changed lines；超过合同 1,000 行提示但 `changeBudgetMode=warn`，没有把功能正确性伪装成 hard
failure。Main 没有让 Grok 重跑，只保留完整候选并做四项有界修复：条件展开 optional test 字段、
移除 trailing blank、Daemon `validate_file` 明确拒绝相对路径、让解析后的 Task facts 与
preview revision digest 来自同一次文件读取，避免 TOCTOU 事实错配。

Main 修复后 focused、full **1,475/1,475**、strict TypeScript、Hub JavaScript syntax、production
build 和 diff hygiene 通过。原合同 remediation check
`8747b759-fcd6-4a68-958f-423a4fd55be7` 以 **5/5** 记录
`verified-repaired-delivered`；原 Grok Task 与 Attempt 仍保持 failed。真实 CLI validate 与 daemon
validate_file 对同一文件均返回 `local-grok-builder`、`xai`、`grok-4.5`、`grok-build`、high、
unlimited、base Attempt 1、extra Attempt 0、adaptation 0 和完全相同的 content-free revision；
预览没有创建 Task。

Grok terminal usage 缺失，因此 Worker Token 是 **unavailable**，绝不显示为 0。17 条 receipt 给出
**28,420–180,031 Tokens** 的 Main exchange envelope；runtime estimate 为 **USD 1.2406984**，
官方单次成本因 usage missing 而 unavailable，二者都不是账单。Worker volume 不完整且没有
exact-pair direct-Main baseline，所以 boundary reduction 和 Main Token savings 都不可用。

CLI 与 Daemon 当前 build id 为
`43196f6bcf31abf18c5e51cffe7d763647e69049ed5f25caa458899d4a98a1db`；Daemon PID
`89307` 无 active/queued Task，Hub PID `90538` 在单一 `127.0.0.1:56962` listener 返回
`current`。这算一条真实 Grok 路径“最终交付、Main repair”，不冒充 machine-success。下一步由
Volcengine GLM 把 safe preview 接入 Hub 确认，并显式绑定 preview revision 后才允许 submit。
没有 commit 或 push。

## 2026-07-28 M1.2：GLM 提交前确认绑定、候选复用与有界 Main 修复

Task `f42c5b2e-4458-4d89-b4ca-5a66b6669dea` 使用显式
`workerProfileId: volcengine-glm52-1m`，实际解析为 Volcengine
`glm-5.2[1M]` + Claude Code high。唯一 Attempt 运行 132 turns；没有
competition、retry、correction、adaptation、第二 Worker、Token 上限或金额上限。
GLM 候选把 Task 文件字节和最终生效的 Worker/模型/策略/质量/合入摘要共同绑定到一个
content-free preview revision，并实现只读 Hub preview、显式确认和 bound submit。

Worker focused 测试通过、full **1,491/1,491**、Hub JavaScript syntax 与
`git diff --check` 通过；strict TypeScript 只因测试 helper 的一个未使用参数失败。候选还把
两个 Worker 私有 memory 文件计入 raw Diff，所以机器提示 12 files / 1,063 lines，而业务候选
实际是合同内的 10 files。原 Task 与 Attempt 仍保持 failed。

Main 没有重跑 GLM。审查时保留候选并修复四个真实缺口：Daemon transport 的非字符串摘要不再
降级成无绑定提交；路径编辑或更新的 preview 请求会使旧响应失效；preview 清空后 Submit 不会被
`finally` 再次误启用；用户文案改成“任务说明检查 / Main 能否安全合入结果”。同时修复原始
unused parameter。Main focused **228/228**、full **1,491/1,491**、strict TypeScript、
Hub JavaScript syntax、production build 与 diff hygiene 全绿；原合同 remediation check
以 **5/5** 记录通过，没有新 Worker Attempt。

真实当前 Hub API 对原 Task 文件返回 `volcengine-glm52-1m`、
`glm-5.2[1M]`、`claude-code`、high、unlimited、base Attempt 1、extra Attempt 0、
adaptation 0、quality pass 与 integratable；Task count 在 preview 前后均为 20，证明 preview
没有创建 Task。

Attempt usage 为 input 330,635、output 130,132、cache read 25,944,128，即
**26,404,895 gross Worker Tokens**，top-level 与 per-model 完全匹配。runtime estimate 为
**USD 17.878539**；Coding Plan 没有单请求价格，official cost 明确 unavailable。54 条 receipt
得到 **191,039–1,187,491 Tokens** 的 Main exchange envelope。没有 exact-pair direct-Main
baseline，因此不把 `25,217,404–26,213,856` 的边界算术称为节省的 Main Token。

## 2026-07-28 M1.2：GLM 双语交互关闭与本机账户回退

真实英文和中文 Hub Board 都从禁用的提交按钮开始。对 GLM 合同执行预览后，页面准确显示保存的
Worker、Provider、`glm-5.2[1M]`、Claude Code、high、无限预算、1 次基础 Attempt、0 次额外
Attempt、0 次 adaptation、任务说明检查 100/100，以及 Main 可以审查并合入；没有启动 Task，
也没有消耗模型 Token。任意编辑文件路径都会立即清除旧预览并重新禁用提交，旧异步响应不能恢复
已经失效的授权。没有点击最终提交。

浏览器验收同时暴露一个真实运行问题：detached Hub 中 `os.userInfo()` 曾抛出
`uv_os_get_passwd ENOENT`，导致 Overview 把正常运行的 Task service 和已经存在的 API Key
错误显示为不可用。Main 没有为这个紧密的小缺口重跑 Worker，而是增加一个共享的本机账户解析边界：
优先使用系统用户名，并以 `USER`、`LOGNAME`、`id -un` 作有界回退；只接受安全账户名。Setup、
Provider readiness、Provider probe 和 Task Keychain 读取全部复用同一解析器，UI 不接触凭据或
私有路径。

修复后 focused 账户/Provider 测试 **50/50**，full **1,492/1,492**、strict TypeScript、
Hub JavaScript syntax、production build 与 `git diff --check` 全部通过。真实重启后 DeepSeek、
MiniMax、Volcengine 和 Grok 本地登录均为 ready；CLI 与 Daemon build id 都是
`55006043d66b7dfb4b3cf62de32841629c4b054e7df6e8c0ca70c3bd33516cb3`，source digest 为
`4732062afdf3ac9c06b7dfea48713a9d49b4aa21d46b91013683b253c57b50d0`。Daemon PID
`63567` 无 active/queued Task，Hub PID `64421` 在单一 `127.0.0.1:51475` listener 为
`current`。

本收尾没有新增 Worker Attempt，新增 Worker Token 为 **0**；GLM 原 Attempt 的 Token 与费用事实
保持不变。M1.2 的 GLM 路径现已包含 API、英文 UI、中文 UI、失效保护、全量回归和运行身份证据。
下一步分别使用 MiniMax 和一个更小的 DeepSeek Task，不并行修改相邻 Hub/Daemon 模块。没有
commit 或 push。

## 2026-07-28 M1.2：真实启动推翻“Key 存在即 ready”

MiniMax Task `7b8c6d1b-d396-4ec5-b62d-fefc05c954c0` 使用显式
`minimax-m3-cn` Profile、1 次 Attempt、0 次 extra、0 次 adaptation。提交前预览显示
MiniMax-M3 / Claude Code high / unlimited，合同 100/100；Task 完成隔离 workspace 准备后，
在 turn 1 之前因无法读取 `forklight.minimax.api-key` 结束。Attempt 没有 usage、费用、Diff 或
Candidate，Main 没有 retry、resume、competition 或换模型重跑同一任务。

该事实证明 daemon health 的 `ready` 只证明 Keychain 记录可定位，不能证明 Worker 启动时的
`security ... -w` 可读。Main 因此冻结一个更小的根因合同：可读性检查只消费丢弃输出后的退出
状态，不能把 Secret 读进 readiness；所有 Task 类型在 workspace、Attempt、Worker、Provider 和
Token 之前执行同一 preflight，失败后留下可读终态但不自动重试。

为避免拿 Claude Code Provider 重复验证同一种 Keychain 问题，根因合同先提交给已经交付过真实
路径的本地 Grok。Task `811863fb-7633-4516-a3c4-f283af67e24f` 同样只有 1 次 Attempt，但本地
Grok 登录已经失效，runtime 在首个模型响应前要求 `grok login --device-code`；它也没有 usage、
Diff 或 Candidate。Main 到此停止，没有继续尝试 DeepSeek/GLM。

随后使用不接收 stdout/stderr 的本地 Keychain 命令核对，DeepSeek、MiniMax、Volcengine 三个
服务均为 unreadable；这与 Daemon 仍显示 ready 直接矛盾。新增
`scripts/setup-provider-key.sh` 作为最小恢复工具：用户显式输入 DeepSeek、MiniMax 或 Volcengine
Key 后，只写 macOS Keychain，并立即用丢弃输出的读取检查证明当前进程可用；不写项目、不显示
Key、不调用 Provider。认证恢复后，优先由 MiniMax 单次执行根因合同，再由小型 DeepSeek Task
修复 Doctor 的 Daemon/local 证据来源。这个认证失败属于环境证据，不计模型质量，也不伪造为
0 Token 成本或成功路径。M1.2 继续保持 open；没有 commit 或 push。

## 2026-07-28 M1.3：首次使用证据审计与发布包示例闭环

Main 在外部 Worker 认证等待期间只读审查现有 15 分钟上手链。Hub 已能完成 Model、Worker、
有效策略预览、Main 安装和 Task service 管理，但当前没有“运行示例任务”入口；README 的首次
Task 仍要求用户先有 Main/CLI 并知道一个 Task YAML 路径。因此现在只能叫配置 Quick start，
不能证明非技术用户已在 15 分钟内完成首个 Task。

审查还发现 `examples/deepseek-checkout.yaml` 的项目路径指向 `fixtures/checkout`，但发布清单只包含
`examples/`，没有 `fixtures/`。Main 直接把确定性的 checkout fixture 加入 package files，并在
package test 中冻结“示例合同与项目必须一起发货”。Focused package/plan tests **4/4**、
`git diff --check` 通过；`npm pack --dry-run --ignore-scripts` 真实列出合同、checkout.py、README
和测试文件。此修复不调用 Worker、Provider 或 Keychain，Worker Token 不适用。

新的 `docs/m1-daily-assistant-acceptance.md` 把 M1 拆成三条用户结果证据：四个真实 Worker 路径、
干净环境首次 Task、三个真实项目的十个 Task。真正的 clean run 必须使用新 macOS 用户、VM 或
新 Mac；只换 `FORKLIGHT_HOME` 会继承全局 Keychain 和 Main 配置，不算干净证据。剩余产品缺口
是让 Hub 用用户已选择的 Worker/有效策略生成并预览一次普通示例 Task，而不是硬编码 DeepSeek
Flash、0.25 USD 或额外重试逻辑。没有 commit 或 push。

Main 随后把该产品缺口冻结为
`examples/dogfood/hub-guided-first-task-deepseek.yaml`。合同规定：Hub 只从已发布的 checkout
fixture 复制 allowlist 文件到 owner-only 样例目录；生成的普通 Task 只引用用户选择的
`workerProfileId`，不硬编码 Provider、模型、runtime、金额/Token/时间、Attempt、adaptation、并发
或 pricing route；浏览器只持有 opaque sample id 和安全 preview，不显示本地路径；开始动作继续使用
canonical `validate_file → preview revision → submit_file`，之后完全回到普通 Task Detail、Main Review
和显式 Integration。

合同同时冻结了 Hub 重启恢复、重复提交、settings drift、fixture symlink/traversal、Worker 失败和
中英文可读性场景；禁止 sample-only retry/review/Integration 状态机和自动清理证据。当前 CLI admission
为 **100/100、0 warnings、integratable**，实际解析为保存的 DeepSeek
`deepseek-v4-pro[1M]` / Claude Code high / unlimited / 1 Attempt / 0 extra / 0 adaptation。
由于 DeepSeek Keychain 仍不可读，Main 没有提交，避免制造第三个同类认证失败。没有 commit 或 push。

## 2026-07-28 M1.2：启动凭据真值根修复（零 Worker 重试）

Main 再次用丢弃输出的 `security ... -w` 核对，DeepSeek、MiniMax、Volcengine 仍全部 unreadable；
ForkLight 的只读 Provider 缓存则保留了旧 verified/stale 证据。因为同一个认证阻塞已经在 MiniMax、
Grok 和本地检查中重复出现，Main 没有启动第四个 Worker，也没有把环境失败算成模型执行力。

根修复把两个此前不同的事实拆开并接通：Provider/Hub 的本地 readiness 改为执行真实启动使用的
Keychain 读取，但 stdout/stderr 全部丢弃，应用代码不接触 Secret；每个 Task 在创建 workspace 前
使用自己冻结的 service/account 做一次相同 preflight。xAI + Grok Build 仍允许本地登录文件作为
启动路径，但这只代表本地凭据入口存在，不冒充远端会话验证。

认证拒绝现在直接留下 `task.launch-preflight.failed`，并明确记录没有 workspace、Attempt、Worker、
Provider 请求或 Worker Token。Task Detail 的时间线显示“Worker 未能启动”，失败分类是
authentication/non-model；没有 retry、competition、correction 或 adaptation。

新增测试覆盖精确 account、Grok 本地回退、失败分类和真实 Daemon 阻断。focused **148/148**，
full **1,495/1,495**，strict TypeScript、production build、Hub JavaScript syntax、
`git diff --check` 全部通过。真实 Daemon 已切换到 build
`b8e563db9c6f26ea4a853bbd11077734767afa0d4a867b74ece3094e92cb4e12`，PID `55645`，无
active/queued Task；Hub PID `57028` 在单一 `127.0.0.1:62816` listener 为 `current`。Health 现在
把 DeepSeek、MiniMax、Volcengine 显示为不可用，不再出现“页面 ready、启动读不到”的矛盾。

M1.2 在当时仍保持 open：用户重新保存 MiniMax 和 DeepSeek Key 后，各运行一次单 Attempt 证明即可；
本轮没有 commit 或 push。

## 2026-07-28 M1.2：MiniMax 真实执行、CLI Worker readiness 与有界 Main 修复

后续 Task `1c710ce9-04f5-4d7a-aadb-f8f82e229fff` 通过 exact launch preflight，证明本机
MiniMax 凭据已恢复可读。它使用显式 `minimax-m3-cn` Profile、MiniMax-M3、Claude Code high、
unlimited、1 次基础 Attempt、0 次 extra、0 次 adaptation；没有 competition、retry、correction
或第二 Worker。

MiniMax 运行 177 turns，候选新增 CLI health readiness 组合、human/JSON 输出和测试，共 3 files /
623 lines。focused **21/21**、full **1,508/1,508** 与 diff check 通过；机器 Task 只因测试从
`core/settings` 错误导入未导出的 `WorkerProfilesSettings` 而在 strict TypeScript 失败。原 Task
和 Attempt 保持 failed。

Main 没有重跑 MiniMax。它保留候选，修复 type-only import，并把候选复制的 Provider connection
evidence 判定抽成 ProviderProbeService 与 CLI health 共用的 pure classifier，避免缓存过期和
Provider identity drift 在两个页面获得不同含义。最终 focused Provider/readiness **37/37**、
full **1,511/1,511**、strict TypeScript 与 `git diff --check` 通过；remediation check
`2bcf5b28-ffb4-44ae-a3be-33fae2053726` 重跑原合同 **4/4** 并记录
`verified-repaired-delivered`。

真实 built CLI 按保存顺序列出 DeepSeek、Volcengine GLM、MiniMax、Grok 的 Worker id/label、
Provider、model、runtime、能否启动、原因和下一步。当前四条本地路径均 launchable；MiniMax/GLM
的连接证据过期，DeepSeek/Grok 尚未重新验证，CLI 没有把这些状态伪装成远端连接成功。

Attempt usage 为 input 153,353、output 56,155、cache read 18,931,200，即
**19,140,708 gross Worker Tokens**；top-level 与 per-model 完全匹配。runtime estimate
**USD 11.63624**；MiniMax 官网口径只有 **CNY 8.7448473–17.4896946** 的聚合档位估算，
不是 exact 单请求费用或账单。29 条 receipt 给出 **281,191–1,698,782 Tokens** 的 Main
exchange envelope。没有 exact-pair direct-Main baseline，因此不把 boundary arithmetic 称为
节约的 Main Token。177 turns 对小 CLI 任务明显过长，作为负面执行经济性证据保留，但不会因一次
低效永久禁用 MiniMax。

CLI/Daemon build id 为
`7efb333bb9b5b54663df6034b77c4fcfc63358b1fad82d9cf7e4372b4ee09ae1`，source digest
`233c8921912ab8cbdeb4ba06e9526be4a7b265865f86a7ea1ac4fabcd334aff1`。Daemon PID
`60112` 无 active/queued Task；Hub PID `61108` 在单一 `127.0.0.1:61538` listener 为
`current`。M1.2 现在只剩一个更小的 DeepSeek 单 Attempt 证明；没有 commit 或 push。

## 2026-07-28 M1.2 完成：DeepSeek 引导式首次任务真实闭环

Main 没有再提交已经过时的 Doctor 任务。当前 Doctor 与 Health 已对四条 Worker 的本地启动事实
保持一致，因此重复修复只会浪费 Token。相反，Main 复用了已经进入工作树、但尚未经过真实模型
运行的 Hub 引导式 checkout 示例。现有实现先通过 focused **113/113**、full **1,520/1,520**、
strict TypeScript、Hub JavaScript syntax、production build 和 `git diff --check`；唯一发现的测试
类型收窄问题由 Main 直接一次修复，没有启动 Worker。

实际 Hub 使用保存的 `default` Worker 准备私有示例。准备结果明确解析为 DeepSeek
`deepseek-v4-pro[1M]`、Claude Code high、unlimited、1 次基础 Attempt、0 次 extra、0 次
adaptation、Quality 100/100 和 integratable；prepare 没有创建 Task 或消耗模型 Token。随后通过
同一个 opaque sample id 与 bound preview revision 显式提交 Task
`bfe223ac-feb2-422e-8f5b-418eef919308`，没有竞争、重试、纠正或第二 Worker。

DeepSeek 只运行 6 turns、约 31 秒，把 loyalty credit 从“税后扣减”改成“先减少 taxable amount、
再计算税”。候选只有 `checkout.py` 1 个文件 / 5 changed lines。ForkLight 独立运行 packaged
Python suite，4/4 通过；Main 审查 exact Diff 并再次运行 4/4 后记录 `accept`。普通 Integration
preflight 证明 source 未漂移且 patch digest 一致，显式 apply 后 source-applied 与
source-verified 通过，artifact-built/runtime-activated 正确标为 not-applicable。补丁只进入私有、
可丢弃的示例项目，没有修改 ForkLight 或三个真实项目。

Attempt usage 为 input 7,119、output 2,533、cache read 16,640，即 **26,292 gross Worker
Tokens**；top-level 与 per-model 完全匹配。官方 DeepSeek PAYG 估算 **USD 0.005360795**，
runtime estimate **USD 0.10724**，均不是账单。3 条 receipt 给出 **6,631–39,922 Tokens** 的
低置信 Main exchange envelope。没有 exact-pair direct-Main baseline，因此不把可能为负的
boundary arithmetic 称为 Main Token 节省。

CLI、Daemon 与 Hub 当前 build id 为
`f5fa4f89492ec7a09b00b75e3b6c1d05e70cff467352531a900fcfb44455ff48`，source digest 为
`9a58c46ef0dd81769ba20ab6df2147c3f77e548768d366e4e80b190a4b71b3e4`。Hub PID `59873` 在
单一 `127.0.0.1:61174` listener 为 `current`，Daemon 无 active/queued Task。M1.2 至此完成，
M1.3 转为 active；下一条证据必须来自新 macOS 用户、VM 或新 Mac，而不能只换
`FORKLIGHT_HOME`。没有 commit 或 push。

## 2026-07-28 M1.3 候选冻结：区分“已交付”与“已运行生效”

真实中文 Hub 打开引导式 checkout Task 后，顶部曾把 source apply/source verification
通过、但 `runtime-activated: not-applicable` 的普通源码交付显示成“已核验交付，并已确认
生效”。下一步同时写着“无需操作”，造成第一结论和交付证据矛盾。这个问题来自统一 Decision
View：所有已经 apply、但没有 activation passed 的结果原先都落入同一个阶段；把
`not-applicable` 临时归为 `activated` 又会夸大运行事实。

Main 没有启动新 Worker、竞争、retry 或 adaptation，而是直接做一次局部真值修复：Decision
Stage 新增 `delivered`，只代表源码已经安全合入且这个 Task 不要求运行时激活；真正的
`activated` 仍只由 `runtime-activated: passed` 产生。Hub 标题和过程说明分别显示中文“已交付；
这个任务不需要运行时生效步骤”和英文“Delivered; this task did not require runtime
activation”，两者都给出“无需进一步操作”。

Focused delivery/Hub 测试 **126/126**，full **1,538/1,538**、strict TypeScript、Hub
JavaScript syntax、production build 与 `git diff --check` 全部通过。真实浏览器先在中文 Task
Detail 核对标题、解释和下一步，再切到英文重新打开同一 Task 核对等价语义；没有提交 Task、
修改设置或调用 Provider。

CLI、Daemon 与 Hub 最终匹配 build
`f7056e8685df79830c93482c4046c274b7aee3bdf6b546b6425043f3a680f1a0`，source digest
`55d561ae11dd649f75a716eca1980be238f45236dcbbb36329b6b09a6f088125`。Daemon PID
`66689` 无 active/queued Task；Hub PID `67522` 在单一 `127.0.0.1:59970` listener 为
`current`。这关闭当前机器的语义真值缺口，但不冒充 M1.3 clean-run；下一条退出证据仍必须
来自新 macOS 用户、VM 或新 Mac。没有 commit 或 push。

## 2026-07-28 M1.3 包安装预检：关闭缺失构建身份的启动阻断

在等待真正的新用户环境前，Main 先对当前 release candidate 做真实 tarball 预检，而不是把仓库内
通过测试等同于“安装后可用”。`npm pack --dry-run` 显示 `package.json.files` 包含
`dist/src/`，却没有运行时必读的 `dist/build-identity.json`。一次性目录中的实际
pack → install → `forklight --help` 随即以 ENOENT 失败，证明任何 tarball 新用户都会在配置
Provider、Worker 或 Main 之前被阻断。

Main 没有调用 Worker 或调整执行策略，只做最小发布边界修复：把生成的 build identity 加入 npm
allowlist，并在 package test 中冻结“安装后的 CLI/MCP 必须携带身份文件”。修复后的第二次真实
tarball 安装确认：包内存在 `package/dist/build-identity.json`；安装后的 identity 与构建目录逐字
一致；`forklight` 与 `forklight-mcp` 两个入口均可执行；安装后的 CLI 能独立加载并显示帮助。

最终验证为 full **1,542/1,542**、strict TypeScript、Hub JavaScript syntax、production
build、`git diff --check` 与真实 package smoke 全部通过。最终 tarball SHA-256 为
`13cf2d4c14840a5b0be29163d7bbf35802e9266550cf33fcecd44fb1cee3ed14`；它和 CLI、Daemon、
Hub 都携带 build
`29d3ee718f3ce80b97832666f5da3cdb74f68b193e9e0e39451c7b6973fa0aa2`、source digest
`5d8fcaf120116c145cfe77f578bd2372a57d1dc247eb1eb0b75e5321bebe67de`。Daemon PID
`73219` 无 active/queued Task；Hub PID `73543` 在单一 `127.0.0.1:55410` listener 为
`current`。

这证明 release package 能安装和启动，但仍不冒充 clean-run：临时目录运行在一骏现有 macOS
账户下，不能证明新 Keychain、Main 配置、首次理解和 15–30 分钟完整旅程。下一条 M1.3 退出证据
仍必须来自新 macOS 用户、VM 或新 Mac。没有 commit 或 push。

## 2026-07-28 M1.3 运行身份收口：真实重启暴露历史 Keychain ACL

Main 在不启动 Worker、不调用收费 Probe 的前提下重新执行完整验收：full **1,542/1,542**、
strict TypeScript、Hub JavaScript syntax、两个 Key 设置脚本语法、production build 与
`git diff --check` 全部通过。旧 Hub owner 随后干净退出，新的单一 Hub 接管；CLI、Daemon、Hub
最终匹配 build `3aa4ab800f5dabbd28ec2b7a08a77b0679a99f3ee628b67285420c401608d483`
和 source digest `5d8fcaf120116c145cfe77f578bd2372a57d1dc247eb1eb0b75e5321bebe67de`。

切换前的继承 Daemon 能读取 DeepSeek、MiniMax 和 Volcengine 三个 API Key。Main 随后执行一次
真实 Daemon restart；最终新 PID `9154` 无 active/queued Task，但三个历史 Keychain 项均变为
`authentication-missing`，Grok local sign-in 仍为 launchable。CLI Health 明确使用
`build-matched daemon` 作为执行真值，没有再用本地进程或“Key 存在”制造假 ready；Hub PID
`9341` 在单一 `127.0.0.1:58037` listener 为 current。期间另一次 fresh launch 曾让相同三项
重新可读，证明这个旧 ACL 的行为依赖启动上下文，并不具备可依赖的重启持久性。

问题边界是历史 Keychain 项的读取 ACL/启动上下文，而不是 Provider、模型或 Worker 质量。新的保存路径已把
Key 从命令行参数移到 stdin，并显式授权 `/usr/bin/security`，同时禁止不安全的全应用 ACL；但
已有 Key 不会自动获得新 ACL。交互脚本也已使用和运行时相同的安全账号选择顺序，避免特殊环境的
`id -un` 数字值把 Key 写到错误 account。下一步只需一骏通过现有脚本分别重新输入三把 Key，再重启 Daemon
确认持久性。此记录不生成 Attempt、Candidate、Provider 请求或 Worker Token，也不触发竞争、
retry、correction 或 adaptation。没有 commit 或 push。

同一最终运行态随后做了真实 Hub 中英文只读体验检查。DeepSeek、MiniMax、Volcengine 三张
Worker 卡都显示“无法开始 / Cannot start”，用白话说明本地鉴权缺失，并给出配置 API Key 或受支持
登录方式这一条下一步；Grok 单独显示“可以开始，建议先检查连接 / Can start; connection check
recommended”，没有把本地文件存在夸大成远端连接已验证。检查只切换页面和语言，结束前恢复中文；
没有保存设置、Probe、Task、Provider 请求或 Worker Token。

## 2026-07-28 M1.3 更正：现有 Key 已通过受控 Daemon 重启持久性

上一节把一次 `authentication-missing` 直接归因于历史 Keychain ACL，并要求一骏重新录入三把
Key；后续证据推翻了这个过强结论。Main 先用完全不输出凭据内容的检查确认
`forklight.deepseek.api-key`、`forklight.minimax.api-key` 和
`forklight.volcengine.api-key` 都存在于账号 `yijunwang`，且当前进程可以通过运行时使用的
`security find-generic-password -a ... -s ... -w` 路径读取。随后在没有 active/queued Task 的
条件下执行一次受控 `daemon restart --confirm`，Daemon PID 从 `9154` 切换为 `22542`。

新 Daemon 将 DeepSeek `deepseek-v4-pro[1M]`、MiniMax `MiniMax-M3` 和 Volcengine
`glm-5.2[1M]` 三条准确路径全部报告为 `api-key`、launchable；Grok local sign-in 同样保持
launchable。CLI 明确从 build-matched Daemon 读取结果，CLI、Daemon 和现有 Hub 仍匹配 build
`3aa4ab800f5dabbd28ec2b7a08a77b0679a99f3ee628b67285420c401608d483`。整个检查没有重新
录入 Key、没有连接 Provider、没有启动 Worker，也没有消耗模型 Token。

因此当前机器上的 Key 重启持久性已通过；早先状态应记录为陈旧或切换期 Daemon readiness，
不能再作为“必须重新录入”或“历史 ACL 已证明有问题”的依据。clean-user journey 仍需在新 macOS
用户、VM 或新 Mac 中独立验证首次录入、系统授权提示和用户理解，不能由本机重启替代。

## 2026-07-28 M1.3 全新用户验收包已冻结，实际用户旅程待授权

只读系统用户盘点确认当前 Mac 只有现有开发用户 `yijunwang`，没有可冒充 clean-user 的第二
账号。Main 因此没有通过更换 `FORKLIGHT_HOME` 制造假证据，而是先补齐操作者 runbook、理解
问答和逐检查点证据表，再从当前工作树复制一个隔离构建目录。完整 `npm pack` prepack 检查在
隔离副本中通过；打包没有改动或重启当前用户的 CLI、Daemon 或 Hub。

冻结目录为 `/Users/Shared/ForkLight-Clean-Run.cDgmCh`。精确 tarball
`forklight-0.2.0.tgz` 的 SHA-256 是
`5c0609a14b9df7e19c4949907954bf58fd87eb00fac686df370538fbca86e9d5`，包内 build
`e0072e64953a6994f503b4f7e72b7f755ef72e0b3d4f1728ec07f516273279ad`，source digest
`5d8fcaf120116c145cfe77f578bd2372a57d1dc247eb1eb0b75e5321bebe67de`。Main 把该
tarball 安装到独立临时 prefix，安装后的 `forklight` CLI 可以加载，安装后的 identity 与 tarball
内 identity 逐字一致；包内敏感文件名扫描没有发现 `.env`、私钥、SQLite、auth 或 settings
文件。目录与三个交付文件均可由新的本地用户只读访问。

打包命令最初错误地拿 `npm pack` 完成后又一次 `prepare` 生成的临时目录 identity 与 tarball
比较，因此得到一次预期外 mismatch；这不是安装包损坏。Main 没有重跑全量测试，而是改用
tarball 内 identity 与真实安装后 identity 直接比较并通过，同时把交付的 `build-identity.json`
更正为包内权威值。当前开发用户的 Daemon 仍是 PID `22542`、build
`3aa4ab800f5dabbd28ec2b7a08a77b0679a99f3ee628b67285420c401608d483`，无
active/queued Task；冻结包没有在该用户下激活。没有 Provider 请求、Worker、Attempt、竞争、
重试或模型 Token。M1.3 仍不能关闭，下一证据必须来自一骏授权的新 macOS 用户、VM 或另一台 Mac。

## 2026-07-29 M1.4 Relay 额外实践：部分成果可复用，但不能包装成自动合入成功

一骏选择 `/Users/yijunwang/code/relay` 作为 M1.4 的额外真实项目样本。Main 先把任务限制为
Item Detail 的执行可读性：用户需要看到 Main 派发的具体输入、当前阶段、结果或失败原因、
下一步；原始日志降为可折叠的技术细节。边界明确排除 API、Schema、状态机、Connector、Team、
commit 和 push，生产调用链只允许 `Job / Assignment / Runtime → pure presentation mapper →
ItemDetail`。

MiniMax-M3 Task `0e47281b-bc26-4e97-a080-21ca63b309a9` 完成了大部分结构，但独立验收只有
12/13；其 pending-review 文案与合同不一致。该 Task 使用 input 106,224、output 36,637、
cache read 2,156,786，即 **2,299,647 gross Worker Tokens**，runtime estimate
**USD 2.525438**。提交时错误地把 `maxMainCorrections` 设成 0，导致同一 Candidate 的最便宜
纠正路径不可用；Worker Prompt 还把 warn-mode change budget 写成 “Hard change budget”，
实际诱导 Worker 优先压行数而不是完成语义。这两点作为拆分/策略缺陷保留，不归咎为模型永久能力
结论。

DeepSeek `deepseek-v4-pro[1M]` Task
`0815e85d-02a8-4735-9089-6bfa24b86b68` 使用更宽的 warn budget，并保留一次 Main
correction。Main 首审发现三个真实缺口：没有显示 `Job.prompt`、`dispatchState=uncertain`
在 running Job 上会被误报为“执行中”、成功摘要可能重复。随后在**同一 Task、同一 retained
Candidate** 上只纠正这些剩余缺口，没有整单重跑。两次 Attempt 合计 input 64,784、output
35,927、cache read 1,630,720，即 **1,731,431 gross Worker Tokens**；top-level 与 per-model
统计完全匹配。31 条 receipt 给出 **10,430–62,821 Tokens** 的低置信 Main exchange envelope，
Worker volume minus exchange 为 **1,668,610–1,721,001 Tokens**，但没有 direct-Codex
exact-pair baseline，因此这只是“留在 Main 边界外的 Worker 处理量”，**不能称为节约的 Main
Token**。

纠正后的目标语义测试 33/33；写回 Relay 后的精简回归 10/10，目标文件 ESLint 9 和
`git diff --check` 通过。真实 Relay 浏览器先观察 running，再观察 pending-review：页面能直接
读到“本次任务”、Worker 当前/最终结果、下一步、折叠技术日志和 Accept / Revise / Reject。
Main 最终只写回 `src/components/ItemDetail.tsx`、
`src/components/job-presentation.ts` 和 `tests/job-presentation.test.ts`。

本次不能记作 ForkLight 自动 Integration 成功。纠正 Task 仍为 machine-failed：仓库同时存在
另一条 Team/Postgres 开发线，全局 TypeScript/build 被其未完成的可选 `pg` 依赖与类型断言阻断；
全量 `npm test` 在现有并发工作树中超过两分钟仍未终止。ForkLight Integration preflight 因
Task 失败和 source drift 正确拒绝，Main 没有绕过这个事实，只做了目标文件级人工审查写回。
此外，新 Task 读取旧 Task Candidate 遇到权限边界，说明跨 Task 复用还不可靠；同一 Task
correction 则真实可用。两条 Task 的 Main Review 最终都记录为 `revise`：保留有用成果，
但不把 machine-failed Candidate 记成已接受的 ForkLight Delivery。

这条样本不替代 Adeptify、Dia、NovelRPGPlay 的既有十任务退出要求。它把 M1.4 后续策略收敛为：
默认保留一次 bounded correction；软预算只作风险提示；优先同 Task 复用 Candidate；验收同时
记录目标行为、当前仓库基线与 source drift，不用无关失败制造成功，也不因无关基线噪音整单重跑。
没有 commit 或 push。

## 2026-07-29 Worker 软预算语义修复：GLM 一次交付，但小任务 Token 仍偏高

Relay M1.4 样本证明 `changeBudgetMode=warn` 已在 verifier 中作为 warning 生效，但 Worker
Prompt 仍无条件写成 “Hard change budget”，并要求超出时停止。Main 将修复限定为
`src/core/task.ts` 和 `tests/task.test.ts`：只让 Worker 看到与冻结策略一致的 hard / warn /
score / off 文案，不改变 verifier、设置默认值、重试、路由、权限或 Integration。

路由器对新 Task class `forklight-worker-prompt-policy` 的四个候选都没有样本，因此返回
`shouldRunCompetition: true` 且没有 recommendation。Main 没有机械启动四模型竞争：这是一个
边界清楚、验收确定、最多两文件的小修复，竞争只会把同一份上下文和验收成本复制四次。为补充真实
模型路径，Main 选择保存的 Volcengine GLM 5.2 1M Worker，并冻结 1 次基础 Attempt、0 次额外
Attempt、1 次同 Candidate correction、无 Token/时长硬上限和 warn change budget。

Task `c989e9a7-4a52-48e1-bf4e-9d186b37dac5` 一次 succeeded，无 competition、retry、correction
或 adaptation。候选只改 2 files / 174 lines：hard 与 legacy-hard 保留原 stop-and-report；warn
明确“超出是 warning，不是 Task failure，并优先完成约定行为”；score 明确只是评价证据；off
明确关闭 enforcement 但不允许借此扩大范围。独立 focused 86/86、full 1,542/1,542、strict
TypeScript 与 diff hygiene 通过。Main 审查 CandidateRevision 后记录 `accept`；Integration
preflight 无拒绝原因，source apply 和原 4 条 acceptance 再验证全部通过。随后当前源码重新 build
并受控重启 Daemon；CLI 与 Daemon 最终匹配 build
`fe2deab8b8a71d26ba2aa48d2f9f3aaff584c57bbe172664b61fd68c6b79da1a`、source digest
`98e71f74432f2619beda8fd5ec18bb3d1336a71fd9f1cf7e5f873b9b362ab98c`，无 active/queued Task。

执行经济性不能随成功一起美化。GLM 用 27 turns；input 69,861、output 23,912、cache read
916,672，即 **1,010,445 gross Worker Tokens**。9 条 receipt 的 Main exchange envelope 为
**2,418–14,585 Tokens**；没有 exact-pair direct-Codex baseline，因此不声称节约 Main Token。
对两文件小任务，这个 Worker volume 明显偏高，主要风险是读取大 `task.ts`/`task.test.ts` 后在多轮
中反复携带上下文。当前 routing 已得到该 Task class 的 1 个 GLM accepted/verified 样本，但仍低于
5 个最小样本，不足以推荐 GLM 或永久否定其他模型。下一次同类小任务应先判断 Main 直做是否更省，
若仍委派则把相关符号和测试落点写得更精确，并观察 turns/context 是否实际下降。没有 commit 或 push。

## 2026-07-29 Relay R2：Profile 继承与真实验收接通，成功后 revise 承接仍缺失

Main 在 Relay 发现默认 ForkLight Task 仍写死 DeepSeek Flash、Claude Code、USD 0.5，并用
`acceptance.commands=[true]` 制造假验收。Task
`84c2474c-5b46-4bf7-9f00-55964e4052ec` 因此被限定为一条真实调用链：Relay 只生产任务、工作区
和用户输入的独立验收；ForkLight 保存的默认 Worker Profile 消费这些输入并决定实际 Worker、
模型、预算、Token、时长和文件/行策略。验收为空或为明显 no-op 时，Application 必须在持久化
Assignment/Job 和 Worker 花费之前停止。

DeepSeek `deepseek-v4-pro[1M]` 用一次 Attempt 完成 12 files / 807 changed lines。独立验证通过
目标行为测试、目标 ESLint 和 diff hygiene；原 A8 ForkLight retry 测试只补真实验收，没有被换成
Demo Runtime。Main 审查仍发现两个合同缺口：未来 caller 的 `workerProfileId` 被写入
`worker.profileId` 而非 ForkLight v2 顶层；Task builder 只检查验收非空，没有复用 no-op
normalizer。Main 先记录 `revise`，但当前产品拒绝继续：`maxExtraAttempts=0` 让 `revise` 无剩余
Attempt，`maxAdaptationRounds=0` 禁止临时放宽，`correct`/`resume` 又拒绝 succeeded Task。

为了不让 Worker 重做 778 行有效成果，Main 明确记录“接受候选作为受控 Integration 基础，最终
产品接受仍待两处定点修正”。Integration operation
`40391e6b-450c-41cc-bfa8-94e6edef00a2` 通过 source apply 和原三条 source verification。Main
随后只把 `workerProfileId` 移到 Task 顶层，并让 builder 复用同一 normalizer，补 builder 直接
调用的 no-op、去重和层级测试。最终 64/64 目标测试、目标 ESLint、`git diff --check` 全部通过。

真实 Relay 页面也验证了产品语义：选择 ForkLight 后显示“设置继承自默认 Worker Profile”；验收
为空时提交按钮不可用；填入 `node --version` 与 `git diff --check` 后才可提交；隔离数据库上的
dry-run 清楚显示“校验完成、未创建真实 Worker 任务”，没有消耗 Worker Token，也没有把 validate
写成执行成功。

这条样本的首要 ForkLight 后续项不是继续调参数，而是增加**一次性、受限、复用 succeeded
Candidate 的 Main revise**：只承接 Main 指出的明确剩余缺口，重新跑原验收，不自动循环。Attempt
使用 input 67,438、output 37,859、cache read 3,207,680，即 **3,312,977 gross Worker
Tokens**；10 条 receipt 的 Main exchange envelope 为 **1,309–7,800 Tokens**。没有
exact-pair direct-Codex baseline，因此不声称节约 Main Token。没有 commit 或 push。

## 2026-07-29 成功 Candidate 的一次性 Main 纠正已交付

Relay R2 暴露的承接缺口已用 ForkLight 自身关闭。DeepSeek Task
`908c5cd9-dfbd-42b0-8849-035addbcdb8b` 把现有 structured `correct` 扩展到
machine-succeeded Task，但只有最新 Main `revise` 精确绑定当前 Attempt 和最新机器验收、
CandidateRevision 仍匹配现场、没有竞争/Integration 历史且 `maxMainCorrections` 有剩余时才可用。
它与普通 `maxExtraAttempts` 分离；纠正复用同一 Task、workspace 和 session，之后必须重新机器
验收并获得新的 Main accept，旧 success/revise 不能直接授权 Integration。

首轮 62 turns，机器验收发现两处共享 review parser/测试夹具问题；Main 保留可用文件，以三个
明确 gap 做同 Candidate correction。第二轮只剩一个拒绝态泄露 Candidate 路径摘要的测试失败。
由于一次 correction 已耗尽，Main 显式授权唯一一次普通额外 Attempt，并声明无论结果都不再启动
Worker。第三轮 16 turns 通过，最终聚焦 189/189、全仓 **1,561/1,561**、strict TypeScript、
Hub JavaScript、build 和 diff hygiene 全绿。Main 审查后记录 accept。

三轮累计 input 177,207、output 81,653、cache read 15,111,936，即 **15,370,796 gross
Worker Tokens**。33 条 receipt 的 Main exchange envelope 为 **707,304–4,277,541 Tokens**，
两种计数完全匹配；没有 direct-Codex exact-pair baseline，所以不能把
**11,093,255–14,663,492** 的边界差额称为节约的 Main Token。该任务说明同 Candidate 纠正能
避免整单重跑，但首轮 7.54M 和三轮总量仍很高，后续应优先靠更好的拆单与验收减少纠正，不把
“可纠正”当作鼓励多轮执行。

Main 的任务文件漏把 `dist` 声明为 generated path，导致 22 个编译产物被误算进 33 个改动文件，
第一次 Integration preflight 仅因超过全局 20 文件阈值拒绝。Main 临时把预检阈值调到 40，拿到
逐文件 source-compatibility 收据后立即恢复 20；没有重跑 Worker，也没有永久放宽设置。
Integration operation `8dacfeea-50eb-4016-90bc-fd3423fc00a9` 随后通过 source apply、全部
source verification、artifact build 和 runtime activation。CLI 与 Daemon 最终 identity matched。
没有 commit 或 push。

## 2026-07-29 Relay R5：设置页把运行检查翻译成用户能采取行动的结论

Main 把 Relay 设置页的真实问题限定为一条只读 presentation 链：保留现有 `DoctorReport`，新增
纯 mapper，页面只消费“整体结论、解释、一个下一步”和 Relay 核心、ForkLight 执行、工作区安全
三项状态；完整原始对象继续存在，但默认折叠。Task
`459407ab-fa6a-44e2-b242-4902e4f0ca4b` 由 Volcengine `glm-5.2[1M]` / Claude Code 执行，
无 Token/时长上限、无竞争、无普通 retry 或 adaptation，只允许一次 Main correction。

首次 Attempt 58 turns，原 4 条机器验收全部通过。Main 保留可用设计，但要求删除 Worker 自建的
两个 `memory` 文件、让核心 required checks 具有优先级、限制 Runtime 文案，并移除依赖颜色边线的
表达。第二次复用同一 Candidate，23 turns，原验收仍为 4/4；Worker 工具只能把两个越界文件清空，
无法删除它们，且初学者视图仍暴露一处原始失败信息。Main 因此保持 `revise`，没有绕过 review
运行自动 Integration，也没有启动第三轮。

Main 最终只把四个产品文件写回 Relay，并把原始 check message 换成固定、可理解的中文标签，
把超长恢复说明改成完整的通用动作，移除剩余 Doctor 术语和 2px 彩色状态边线。最终 mapper 行为
测试 **8/8**、目标 ESLint 9、模块导入和 diff hygiene 通过；桌面与 390px 窄屏真实页面都能先看到
“Relay 与 ForkLight 均可使用”、三项状态和默认关闭的技术信息。仓库级 TypeScript 仍只被并行
Team/Postgres 的既有可选 `pg` 依赖阻断。ForkLight remediation check
`54f1b8ca-7b66-4155-884d-998e2f20bf8f` 为 4/4 passed，最终处置是
`verified-repaired-delivered`，没有改写原 review 或伪造 Integration 成功。

两次 Attempt 共 input 192,528、output 134,986、cache read 4,564,928，即
**4,892,442 gross Worker Tokens**。52 条 receipt 的 Main exchange envelope 为
**92,574–564,867 Tokens**；两套 reconciliation 完全一致。所谓
**4,327,575–4,799,868** 只是 Worker 处理量减去编排交换量，不是直接 Codex 反事实，也不能叫
“节约的 Main Token”。没有 exact-pair direct-Codex baseline，因此节约量仍不可得。没有 commit
或 push。

## 2026-07-29 Relay R6：项目目录在启动 Worker 前完成真实路径安全检查

Main 先用临时目录复现当前缺口：`allowed/jump/future-project` 的最终目录不存在，而 `jump` 是指向
allowlist 外部的 symlink；旧 `assertWorkspaceAllowed` 因只对完整存在路径做 `realpath`，会把它按
字符串路径错误接受。Main 将真实用户结果限定为：非空 workspace 必须已经存在、必须是目录，候选
和 allowlist root 两侧都用 canonical real path 做 separator-safe containment；拒绝发生在
Assignment/Worker 之前，错误只给重新选择目录的动作，不回显提交路径或 allowlist。

精确 task class `relay-workspace-containment` 没有历史样本，routing 按配置建议 competition。
Main 没有机械执行：这是两个文件、四条确定性验收的安全修复，三个模型竞争会重复同一实现成本；
因此选择已有后端逻辑交付经验的 DeepSeek `deepseek-v4-pro[1M]` 单 Worker。Task
`41cb5bdf-abe3-416b-b176-3eef82baf88b` 无 Token/时长/文件硬上限、无普通 retry、无 adaptation，
只保留一次 Main correction。

首次 Attempt 16 turns、原 4 条机器验收 4/4。Main 保留现有两个文件，但没有直接 accept：Worker
对缺失、非目录或不可解析的 allowlist root 仍回退 lexical path，home/null-byte 分支也缺恢复动作。
一次同 Candidate correction 用 12 turns 关闭这两个明确 gap，第二轮原验收仍 4/4；最终 2 files /
300 changed lines、24/24 新行为测试通过。Main accept 后，Integration operation
`658a6e77-3dc5-45f3-be3b-bbafb2cd934e` 完成 source apply 与 4/4 source verify。Relay 原工作树
再跑目标测试和既有 Alpha 主链 17/17、目标 ESLint 9、模块导入、diff hygiene 均通过；全局
TypeScript 仍只被并行 Team/Postgres 的既有可选 `pg` 依赖阻断。

两次 Attempt 共 input 33,525、output 22,322、cache read 589,952，即
**645,799 gross Worker Tokens**；22 条 receipt 的 Main exchange envelope 为
**5,842–35,172 Tokens**。Provider-native official cost 为 **USD 0.036142091**，Claude Code
runtime estimate 合计约 **USD 1.020651**，两种口径没有混用。缺少 exact-pair direct-Codex
baseline，因此不声称节约 Main Token；`610,627–639,957` 仍只是 Worker volume 减编排交换量。

本轮还暴露运行身份风险：当前源码 CLI 与 Daemon build matched，但长 Codex 会话内加载的 MCP
build 较旧。健康检查后，所有 validate、submit、review、correct 和 Integration mutation 都改走
匹配 CLI；旧 MCP 只用于一次只读 correction eligibility。下一 Main 会话必须重新核对 MCP identity，
不能把 CLI 安全绕行包装成 stale MCP 已消失。没有 commit 或 push。

## 2026-07-29 M0 重新打开：长 Main 会话的 MCP 不会在进程退出后自动刷新

Relay R6 前的健康检查发现，当前 ForkLight MCP build 为
`43196f6bcf31abf18c5e51cffe7d763647e69049ed5f25caa458899d4a98a1db`，而源码 CLI 与 Daemon
已经匹配 build `da669a7baf2f02d8ec8de392b0b747247f96a762805d1ecb157bf159aa13c143`。
旧 MCP 因 build mismatch 正确拒绝 mutation，R6 的 validate、submit、review、correct 和
Integration 因此全部改走匹配 CLI。Hub read-only status 为 `current`，只有 PID `27266` 和一个
`127.0.0.1:56069` listener；Daemon 只有 PID `4851`，且没有 active/queued Task。

Main 没有把所有 `forklight-mcp` 进程都当成泄漏。通过 PPID 和 cwd 逐个归属后，确认 PID `58838`
属于当前 Assistant workspace；Adeptify、NovelRPGPlay、其他已加载任务和独立 Grok Main 有自己的
MCP 进程，不能跨任务终止。Codex 官方 App Server 文档提供 `config/mcpServer/reload`，但当前任务
没有暴露该 RPC，Computer Use 也明确禁止自动化操作 Codex 自身 UI。

Main 只对 PID `58838` 做一次可恢复的 `SIGTERM` 实验。旧进程正常退出，但下一次
`forklight_health` 返回 `Transport closed`，同一 turn 内没有自动 respawn。Main 没有重复 kill、
改全局插件开关或触碰其他任务进程；CLI、Daemon、Hub 继续保持 matched/current。这个结果证明
“精确终止旧 MCP”不等于“当前 Main 已恢复可用 MCP”，也说明之前 fresh-Agent 的 M0 证明没有覆盖
长会话升级后的 reload 生命周期。

因此 M0 当前重新打开，下一道唯一门是：新 Main turn/session 或受支持的
`config/mcpServer/reload` 后，MCP health 与 CLI/Daemon 的 build/source digest 完全一致，并确认
该 thread/workspace 只有一个 MCP、全局只有一个 Hub owner/listener 和一个 Daemon。门关闭前暂停
新的 M1 扩展，状态 mutation 只允许走 matched CLI。没有 commit 或 push。

### 同一 loaded task 的新 turn 仍不会重建 MCP

下一次自动 continuation 已进入新 turn，但第一次 `forklight_health` 仍立即返回
`Transport closed`；进程审计也没有出现新的 Assistant-workspace MCP。这把恢复边界从模糊的
“下一轮再看”收紧为明确事实：只有 turn 变化不够，必须由 Codex App Server 执行真正的
`config/mcpServer/reload`，或通过 Codex 插件重载/应用重启/真正的新任务重新初始化 MCP。

Main 没有用重复 kill、全局插件文件抖动或触碰其他项目 MCP 来制造一次看似成功的重连。下一次
fresh Main 在任何 mutation 前必须先拿到三份同刻证据：ForkLight MCP health matched、源码 CLI 与
Daemon matched、Hub `current` 且 thread/workspace MCP/Daemon/Hub owner 数量符合单实例边界。
当前门仍未关闭。没有 commit 或 push。

## 2026-07-29 Codex App 真重启后关闭 M0 reload gate

一骏完成 Codex App 重启后，Main 先做只读检查，没有提交 Worker 或修改项目源码。ForkLight MCP、
built CLI 与正式 Daemon 同时报告 build
`da669a7baf2f02d8ec8de392b0b747247f96a762805d1ecb157bf159aa13c143`、source digest
`4020d27f518e64de75e7c0f202d65be6baca97bcceb969c1746ad83138d1503a`，identity 为
`matched`。正式 Daemon 只有 PID `4851`，没有 active/queued Task。App 重启带走了旧 Hub；Main
恢复一个 Hub owner PID `56042`，唯一监听为 `127.0.0.1:51543`，旧 `56069` 端口已经释放。

进程审计还发现 Grok Main PID `23702` 下有三个早于当前 build 的 MCP 子进程。Main 只终止精确
PID `5795`、`6562`、`25826`，没有停止 Grok Main；它随即自动拉起新 MCP PID `56325`、
`56326`、`56331`。Codex 下现存 MCP 也全部在 App 重启后创建。审计同时修正了旧门槛的表达：
多个已加载 Main task 各自持有 MCP 是正常结构，即使两个 task 使用同一个 cwd；应检查“每个 loaded
Main task 一条 MCP 连接”，不能按 workspace 目录强行压成一个。全局仍必须只有一个正式 Daemon
和一个 Hub owner/listener。

至此，先前 3/3 automatic self-upgrade 证明继续有效，长会话 reload 的新增缺口也已有真实 App
重启证据，**M0 再次关闭，恢复 M1 clean-user journey 与 Relay M1.4 实践**。Provider connection
evidence 的 stale/unverified 状态属于运行 Worker 前的连接预检，不是 MCP/Daemon 身份失败；本轮没有
为了刷新状态额外消耗模型调用。没有 commit 或 push。

## 2026-07-29 Relay M1.4 R7：Activity 白话时间线与 reverify revision 缺口

M0 reload gate 关闭后，Main 在 Relay 选择一条不与当前并行改动重叠的真实 UI 任务：Activity 页面
原样展示 `assignment.created`、`succeeded` 等机器字段，用户看不出发生了什么。MiniMax Provider
先通过真实 probe，Task `a274b50c-cf0b-4838-bd0d-c98369c04008` 使用 `MiniMax-M3`、一个既有
workspace/session、三个 focus paths 和一次 correction 上限；合同质量 100、无 warning。提交前
Relay 基线全量 **151/151**，ESLint 10 / react plugin 兼容错误作为既有基线明确排除。

第一次 Attempt 52 turns，新增纯 Activity presentation、真实页面接入和行为测试，机器验收
3/3 通过，全量达到 169/169。Main 没把 machine success 直接当成交付：候选仍显示
`未知 Runtime`，解释重复事项/执行工具，而且失败文案要求“打开事项”却没有可点击入口。Main 记录
`revise`，保留三个文件和同一 Candidate，授权唯一一次结构化 correction，没有整单重跑或竞争。

第二次 Attempt 13 turns 完成白话状态、去重和事项入口；产品改动可复用，但它新增的四个页面合同
测试把 `fileURLToPath(import.meta.url)` 产生的普通路径继续传给 `new URL()`，因此聚焦验收和全量
验收分别保持真实 failed；其余 172 个测试通过。Main 没有追加 Worker，而是在 retained Candidate
只把读取方式改为 `new URL(relative, import.meta.url)`。ForkLight 的无 Worker reverify 随后 3/3
通过：聚焦 25/25、全量 176/176、diff hygiene；明确记录 `workerInvoked=false`、新增 Worker
Tokens **0**、新增模型费用 **0**，本机验收时间仍真实存在。

这条链路随后暴露 ForkLight 自身 gap：reverify 针对 Main 修复后的当前 Diff 通过，却没有捕获新的
CandidateRevision；fresh Main `accept` 因当前 Diff 与最新 revision 不一致而安全拒绝，Integration
preflight `77c51ce1-f79f-4f27-8806-03eda2c97670` 也明确拒绝“缺少 Main accept”，没有显示假成功。
Main 因此把与最终 Candidate 逐字一致的三个文件精确写入 Relay 原工作树，再次通过聚焦 25/25、
全量 176/176 和 diff hygiene，并记录 remediation check
`653da815-03b0-4a2c-89fd-cf05e3179ebf` 为 `verified-repaired-delivered`；两个原 Attempt 的
succeeded/failed 事实均未改写。

两次 MiniMax Attempt 合计 input 94,443、output 64,225、cache read 2,739,328，即
**2,897,996 gross Worker Tokens**；Claude Code runtime estimate 合计约 **USD 3.447504**，
Provider official cost 因缺 per-request usage 仍不可 quoted。Main exchange 只有低置信区间，且没有
exact-pair direct-Codex baseline，所以本轮不声称“节约 Main Token”。产品结论是：候选复用与
零模型 reverify 确实避免了第三次 Worker，但 reverify 必须形成可被 fresh Main accept 绑定的新
CandidateRevision，才能恢复安全 automatic Integration。没有 commit 或 push。

## 2026-07-29 R8：用 ForkLight 修复自身 reverify 证据断链

Main 没有绕过 R7 暴露的问题直接手工宣称闭环，而是把 ForkLight 自身作为 dogfood 对象。第一条
DeepSeek Task `ac43b931-840a-49fb-938b-d551935f07b2` 加入了 reverify 后的 revision capture，
但独立测试发现更深问题：当新 capture 失败且 Diff 字节未变时，Main Review 可能把旧 verification
的同 digest revision 绑定给新 verification。该 Task 保持 failed，Main 记录 `revise`，未 Integration。

第二条 Task `1bf84201-e657-4c4c-9c80-43dd3c6dba26` 同时收紧 capture 与 Main Review exact-sequence
binding，生产方向正确，但独立验收抓到两个测试夹具错误：已有 revisions 目录被直接 `writeFile`
导致 EISDIR，以及预期抛错的调用放在断言外。它同样保持 failed，没有因为 Worker 自述完成而改写。

最终 Task `2820723c-dbf6-4382-8459-511d0339dd62` 明确把普通 extra Attempt 和 adaptation 设为 0，
只保留一次 `maxMainCorrections=1`。Attempt 1 的独立验收又发现事件名误写和 fixture 先制造成功
verification 后手工改 Task 状态的问题。Main 用 CandidateRevision
`4a370988-2666-49c0-8dc0-7c9f52dcd1e8` 授权唯一一次 structured correction，只复用五个已审文件，
剩余 gaps 固定为事件名与一次 reverify fixture。Attempt 2 聚焦 **135/135**、全量 **1,565/1,565**、
strict TypeScript、diff hygiene 全部通过。

最终行为是：`verification.completed` 先落盘；当前 Diff 随后封存为同一 Attempt、同一 verification
sequence 的 CandidateRevision；只有封存成功 Task 才能 succeeded。封存失败时 Task/Attempt 历史
不被伪造、事件不含 raw error 或本地路径、不会启动 Worker 或自动 retry。Main accept 也从
“取 Attempt 最新 revision + 比 digest”改为“取当前 Attempt 与当前 verification sequence 的唯一
revision + 比 digest”，所以旧同字节版本不能顶替新证据；完全没有 revision history 的 legacy Task
仍走原兼容路径。

Main 接受 revision `99a8f260-4e77-465d-a3f5-b84c82ca2cf4`。Integration operation
`fa79ade9-50c8-40c3-8f5c-c05d7e0d5661` 的 source apply、source verify、artifact build、runtime
activation 四阶段全部 passed。新 CLI / Daemon build 均为
`5ed667126017b9e124fa2d42d2b6e7c209657dac4f8ceb14934e23e341cdce4d`，source digest 为
`d7951afadd450270bf1d78243a03d8498a028738dfb3f13249d91af852d6b3ff`。旧 Hub owner 自然退出，
新 Hub PID `81114`、port `53005`、status `current`，只有一个 listener。

三条 Task 加最终 correction 合计 input **275,477**、output **116,380**、cache read
**10,269,440**，即 **10,661,297 gross Worker Tokens**。Claude Code runtime estimate 合计约
**USD 9.421605**；DeepSeek PAYG estimate 合计约 **USD 0.258309815**，不是 Provider bill。
缺少 exact-pair direct-Codex baseline，因此这里只记录 Worker volume，不声称节约 Main Token。
当前 Codex task 内已加载 MCP 仍是升级前进程，必须在真实 App/plugin reload 后再核对新 build；在此之前
继续只用 matched CLI 做 mutation。没有 commit 或 push。

## 2026-07-29 Grok TUI 正常但 ForkLight 超时：代理环境继承

- 现象：同一台机器上手动 Grok TUI 能正常对话，ForkLight 里的 Grok Worker 却一直等不到模型回复并超时。
- 测得原因：不是模型质量，也不是鉴权复制出错。操作员本机鉴权文件与任务本地副本的大小和 SHA-256 一致，已排除“复制鉴权不一致”。手动 TUI 进程继承了 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 三个代理环境变量名；旧 daemon（PID 79537）没有继承它们，其子 Grok 进程因此连不上 `https://cli-chat-proxy.grok.com`，无模型响应。
- 失败任务：`d576b0dd-4ada-4ae0-ac0e-153692f79b46`。
- 安全恢复：Main 只停止了卡住的那一个 Worker；待无活跃任务后，在已配置代理环境的 shell 中重启空闲 daemon。新 daemon（PID 50571）已确认带有上述三个变量名；本记录不写任何变量值或凭据。
- 本条结果：本 Task 是重启后的真实 Grok 4.5 冒烟验证——能完成此有界日志写入，说明重启后的 Grok 执行路径可用。这只证明本次路径可跑，不保证以后所有网络条件都正常。没有改源码、配置、凭据，也没有 commit 或 push。

## 2026-07-29 Grok readiness 真实证据：复杂任务失败、一次接力、零 Worker 收口

代理修复后的真实 Grok 小任务已经成功，但 Hub 仍显示 `connection-failed`。原因是旧 xAI probe
只检查 Keychain；Grok Builder 实际使用 `~/.grok/auth.json` 本地登录。旧检查既没访问 Grok
网络，也不能代表远端连接失败。

Main 首先按计划让 Grok 4.5 修自己的状态误判，Task
`f297f232-05d8-47a1-85ed-d49fe760ddf6` 只允许一次 Attempt。Grok 进程能启动、流中持续有思考，
但数分钟内没有一次工具调用、没有工作区修改，并重复同一“下一步要读文件”的内容。Main 只终止
该精确 Worker PID 并停止，不做普通 retry 或 adaptation。结论是：Grok 当前连接路径可用，但这次
复杂 coding 执行力不合格；两件事分别记录。

Main 随后让 DeepSeek `deepseek-v4-pro[1M]` 接力同一明确边界，Task
`fee9d2c6-3c7e-4eb2-8af4-b268173aee6d` 最多一次 Main correction。第一次 Candidate 的聚焦、
Daemon 和全量行为测试通过，但 strict TypeScript/build 抓到一个 optional property 错误；Main
还发现本地登录被错误当成 verified、连接成功没有强制同 Attempt 的标准完成事件、CLI/Service
重复判断。唯一 correction 修复主要问题并使全量 **1,585/1,585** 通过，但漏掉
`ProbeResultStatus` 的 `unverified` 类型。Main 不再调用模型，在 retained Candidate 中定点补齐类型
并加同 Attempt 完成事件测试；零 Worker reverify 六条命令全部通过，新增 Worker Tokens 和模型
费用均为 0。

最终 8-file Candidate 只在“adapter 成功 + 同 Attempt 存在 `worker.completed`”时记录精确
Provider/model/origin 的 `worker-run` 证据；本地登录单独表示 launchable/unverified；旧显式检查
不能覆盖真实成功。Main accept 后，Integration operation
`9a98f399-38a0-4f3d-83f8-533839677801` 四阶段通过，新 Daemon PID `3126` 保留代理环境变量名，
Hub 切换到新 build。

最后的只读 Grok Task `cf54d876-eabf-4f3f-aa7f-cfb3718eb792` 只读取 package metadata，不允许
修改文件；单 Attempt 在约 24 秒内 `worker.completed`、独立验收 passed、空 Candidate 由 Main
accept。`local-grok-builder` 随即变为 `ready`，再次执行 xAI probe 仍返回同一 `worker-run`
verified 证据。DeepSeek 两次 Attempt 共 **7,657,029 gross Worker Tokens**；低置信 Main exchange
区间为 **537,821–3,284,726 Tokens**。没有 exact-pair direct-Codex baseline，不能把差额叫“节约
Main Token”；Grok runtime 没返回完整 usage，不能把未知量写成 0。没有 commit 或 push。

同一 smoke 还暴露 `run` / `submit` 入口不一致：`forklight run` 对保存的
`local-grok-builder` 报 unknown profile，Daemon `submit` 却能正确解析并完成。该问题与网络、
鉴权和模型能力无关；现已由下一个 dogfood Task 关闭。

## 2026-07-29 M1.3：直接 run 与 submit 统一保存的 Worker Profile

根因是 `src/cli.ts` 的 `run` 和 `validate-plan` 各自手工拼 TaskPolicy，漏掉 `workerProfiles` 与
`modelCatalog`；`validate`、Daemon 和 MCP 已使用完整设置。Main 将任务限定为复用现有
`taskPolicyFromSettings` 与真实 CLI 回归。零历史样本使 routing 建议 competition，但这只是两文件
确定性修复，Main 选择单 DeepSeek `deepseek-v4-pro[1M]`，没有重复实现。

Task `4be4bee7-ef54-4314-a50f-75c835d36e6d` 的一个 Attempt 正确修改生产入口，但测试先因只有一个
scenario 被质量门拒绝；它还使用 Grok Profile，当前机器已有 Grok 登录，不能证明测试绝不访问
Provider。Main 没有授权第二次 Worker，而是在 retained Candidate 中把测试改为隔离 home、空 PATH
和未鉴权自定义 Qwen Worker。测试现在证明 Task 已保存 exact Worker/provider/model/runtime，鉴权
前置检查后 Attempt 数仍为 0；同一设置下 `validate-plan` 也通过。零 Worker reverify 的五条命令
全部通过：聚焦 9/9、全量 1,587/1,587、strict TypeScript、build、diff hygiene；新增模型 Token 和
费用均为 0。

Main accept revision `c7d8525a-b8ab-4b7a-9361-5cbc0c9f3875` 后，Integration
`ab55bd60-b8c0-411d-ae3e-9051cac09c06` 四阶段 passed。新 build 中直接运行原 Grok smoke 文件，
Task `58626b45-9544-4b52-baf4-cf8e2c018b29` 约 11 秒成功、独立验收通过、空 Candidate 由 Main
接受。Hub/Daemon build matched，Hub 为 current，无 active/queued Task。

本次 DeepSeek Attempt 共 **4,104,671 gross Worker Tokens**，官方 PAYG 估算
**USD 0.068341603**，runtime estimate **USD 2.987843**；低置信 Main exchange 区间为
**411,213–2,506,154 Tokens**。无 exact-pair direct-Codex baseline，不声称节约 Main Token。
69 turns 对两文件入口修复过重，作为 M3 routing 负效率证据保留：相似确定性小修优先 Main 直做，
除非需要长程持久执行。Grok usage 缺失，保持 unavailable。没有 commit 或 push。

## 2026-07-29 M1.3：重新冻结可安装包并移除 SHA 自引用

旧 clean-run bundle 的 build 已落后于当前源码，不能继续作为新用户输入。Main 直接重做打包与
独立安装，没有调用 Worker。审计同时发现包内 runbook 硬编码自身 tarball SHA 会形成自引用：
更新 SHA 后重打包会再次改变 SHA。现改为 tarball 外的 `bundle-evidence.json` 保存 artifact
文件名、SHA、build/source identity 和验证结论；包内文档只描述读取与校验规则。

最终 pack 前，全量测试第一次为 1,586/1,587。唯一失败是独立 Hub fixture 的 50ms 本地 HTTP
probe 在高并发下超时，不是正式 Hub、Provider 或业务失败。Main 没有盲目重跑，只把该已监听成功
场景放宽为 500ms probe / 1,000ms wait，产品默认不变。目标测试连续 5/5 后，最终 prepack
1,587/1,587 通过。

冻结目录 `/Users/Shared/ForkLight-Clean-Run.TrcwKU` 权限为 755，四个文件均为 644。Tarball
SHA-256 `cb0359ef30e3e088c2cbc339e60a8e1912f3a901e34ef372da56671ef9652d98`，build
`7426d0f154901f14b61cc7073afe853040734b561161cdf617b0bdc086b6c684`，source digest
`3f569c895c290d93e4428e9bed2ce2042c9951343dc257930dc12f2a907ef5da`。独立 prefix 安装成功；
包内与安装后 identity 一致，CLI/MCP entry 可加载，敏感文件名扫描无命中。旧正式 bundle 和一次
中间包均有 `SUPERSEDED.md`，不会静默混用。

随后用安装后 CLI 配合隔离 `FORKLIGHT_HOME` 启动临时 Hub/Daemon。Hub 状态为 `current`，Daemon
使用最终冻结 build 且零 Task；正常停止后 PID 与监听端口均消失，也没有触碰正式数据目录。这证明
冻结包能启动完整本地栈，但不能替代真正陌生用户的首次安装与理解测试。

打包重新生成 identity 后，Main 在无 active/queued Task 时受控重启正式 Daemon/Hub，保持 M0
运行身份真值。没有 Provider 请求、Worker、Attempt 或模型 Token。当前证据仍只证明现有 Mac 的
package/input ready；真正 M1.3 退出仍需要新 macOS 用户、VM 或新 Mac 完成首次 Keychain、Main、
首个 Task、理解问答、恢复与计时。没有 commit 或 push。

## 2026-07-29 Relay R8：Grok 4.5 把 Agent 页面改成用户决策页

Main 选择 Relay 中未与并行改动重叠的 Agent 页面作为 Grok 真实样本。合同把调用链限定为现有
Runtime / Job / Item → pure presentation mapper → 页面卡片，只允许三个文件，不改 API、Store、
Domain、数据库、设置或执行逻辑。Task `55c09d94-15df-49bc-8afc-a28f77754b54` 用 xAI
`grok-4.5` / `grok-build`，100 分校验后由 matched CLI 提交。

首次 Attempt 9 turns，三条独立验收通过，但 3 files / 779 lines 超过 520 行软提醒。Main 没有按
行数机械拒绝，也没有直接接受：保留纯 mapper、折叠技术信息和语义测试，指出顶部无条件指派入口会
与不可用状态冲突、恢复动作不可点击、零 Runtime 时页面空白。一次同 Candidate correction 用 4
turns 关闭三项缺口；没有 competition、普通 retry、adaptation、新 Task 或第三轮。最终 Candidate
3 files / 836 lines，16/16、目标 ESLint 9、diff hygiene 通过。测试占 364 行，软阈值保持 warning，
没有为了压数字牺牲状态覆盖。

Main accept 后，Integration `b36aace6-bff6-4c1d-bac7-3b2a58cec1bb` 的 source apply 和 source
verify 全部通过。真实浏览器又发现卡片名称重复与免责声明逐卡重复；Main 对已合入源做两处确定性
微调，不再调用 Worker，并重新通过 16/16、ESLint 和 diff hygiene。桌面两列、390px 单列均可读，
窄屏无横向溢出；七个“技术细节”默认全部关闭，展开后才显示原始运行信息。

两次 runtime estimate 合计 **USD 0.348266**。Grok usage 缺失，Worker Tokens 与官方费用保持
unavailable；28 条 receipt 的 Main exchange 低置信区间为 **247,417–1,493,852 Tokens**。没有
exact-pair direct-Codex baseline，不声明 Main Token 节约。当前 CLI/Daemon/Hub 为 build
`7426d0f154901f14b61cc7073afe853040734b561161cdf617b0bdc086b6c684`，本 loaded task MCP 仍为
`da669a7baf2f02d8ec8de392b0b747247f96a762805d1ecb157bf159aa13c143`；所有 mutation 都走 matched
CLI，旧 MCP 只做只读 health/eligibility。下次 MCP mutation 前需要 App-level reload。没有 commit
或 push。

## 2026-07-29 Main 修正自己的验收：Grok 实现、零 Worker 反向验证

Task `de405e61-296b-458a-849d-be157d71d3fe` 由本地 Grok 4.5 Worker 实现“验收 amendment”。
Attempt 1 为 31 turns，Main 保留实现并指出选择器唯一性、持久化数量一致性、真实 CLI 前置拒绝和
公共投影测试缺口；唯一一次同 Candidate correction 为 18 turns。两个 Attempt 的 runtime estimate
分别约 **USD 1.2453652** 与 **USD 1.059024**，合计 **USD 2.3043892**。Grok 没返回完整 usage，
Worker Token 和官方费用保持 unavailable。

Candidate 的生产源码和测试实际为 17 个文件，但 `npm run build` 在工作区重建 `dist`，机器 Diff
因此显示 53 files / 3,377 lines，并被自动 Integration 的 20-file 安全门拒绝。这个拒绝是正确的；
Main 没有放宽门槛，而是排除生成物，只选择 17 个源码/测试文件，再补两个确定性缺口。候选聚焦测试
327/327；Main 收口后聚焦 329/329，full check 1,612/1,612，build、Hub syntax、diff hygiene 通过。
功能 Task 当前源码 remediation 为 4/4，处置记录为 `verified-repaired-delivered`。

Main 随后对旧 Grok Task `00b0cd43-eeba-40d1-9d6e-c5b5e6c73c1b` 运行 amendment。该 Task 只有
一个 Grok Attempt，30 turns、exit 0；四条真实检查通过，唯一失败是 Main 写入仓库不存在的
`npm run typecheck`。新链路只替换这个确切失败槽，当前源码 5/5 通过并记录 check
`afc43246-f5f0-4eb0-987e-96759ed01b32`。原 Task/Attempt/verification 失败保持不变，新 Worker、
Attempt、retry、correction、adaptation 均为 0。

真实 Hub 浏览器验收又发现通用文案把所有 repaired delivery 都写成“Worker 执行失败”。Main 直接
修正展示层和测试，不再启动模型。现在看板与 Task Detail 能分别说明：Worker 已完成执行、Main 原验收
定义有误、原验证失败仍可见、Main 未重跑 Worker、修正后独立核验通过；机器检查先通过再被 Main
定点补正的 Task 也使用独立文案。最终 UI 回归 71/71 通过。

当前 build `2a1af014d710de1418e69e6c07dfe6fdafd2e7d8a9779280aa5df6f2c67b9175`；Daemon
PID `52335`、Hub PID `52169` / port `57778`，identity matched、无 active/queued Task。旧 Grok
超时日志可以确认 transport timeout / connection refused，但旧 Daemon 已退出，无法重新证明其环境；
当前 Daemon 与 TUI 的代理摘要一致，且新 ForkLight→Grok Task 已成功。没有 direct-Codex exact-pair
baseline，不声称 Main Token 节约。没有 commit 或 push。

## 2026-07-29 GLM：合入前解释路径判定，Main 审查抓住机器绿灯遗漏

Main 把 M1 的下一个窄缺口限定为 Integration Preflight 的路径判定证据：对真实 affected files 按
冻结的 workspace policy 生成有序 category/provenance，持久化到 receipt/event，并在 Hub 用白话
解释。拒绝时只允许给建议，不得自动改路径分类、改 Task、提额度、重试或合入。Task 文件为
`examples/dogfood/preflight-path-provenance-glm.yaml`，Task id
`525cf643-5cee-49d9-8fbe-8e8623c944c1`，使用 Volcengine `glm-5.2[1M]` / Claude Code；没有
competition、普通 retry、adaptation 或第二模型。

基础 Attempt `f2910d64-45e7-450d-9e8b-b4bf84497616` 用 94 turns 交付 10 files / 924 changed
lines，原合同 340 个聚焦测试、build、Hub JavaScript syntax 和 diff hygiene 全绿，runtime estimate
约 **USD 14.229183**。Main 没有把机器绿灯当成交付：语义审查发现 `renderPreflightResult` 对 DOM
`pathBody` 调用 `forEach`，一旦真实 `pathEvidence` 非空就会抛错。Main 记录 `revise`，保留全部
10 个已知可用路径，只授权一个精确 Gap Contract 的同 Candidate correction。

第二 Attempt `3c30d35b-686b-483e-afab-de3b071e5bfa` 用 11 turns 修正循环对象，并新增会提取、执行
renderer 的最小 DOM stub 测试，覆盖非空有序 path evidence；runtime estimate 约
**USD 2.549887**。Main 接受 revision `3c3b746d-71b1-4fe1-9e9d-58a081c936ac`，绑定 patch digest
`00f67a45582d76d92389aa68dce59cf5f6dfe4dea2132e632b11ae500082f623`。Integration receipt
`562a9a70-bc15-47cf-ad99-1538f37bd170`、operation
`8cba9c8d-526c-4bb6-905c-81a4e1fa6845` 的 source apply、四条 source verification、artifact build
和 runtime activation 全部 passed。

最终 Candidate 为 10 files / 1,042 changed lines。新 build
`b7561b77575b9fe23050639170df7e842b6fd4275413a981b9336c983cb1d08e`，Daemon PID `37797`，
Hub PID `39681` / port `62302`，identity current、无 active/queued Task。真实 Hub 浏览器确认：页面先
显示“应用会失败—不会改动源码”、当前策略的路径分类与 10/0/0 分类数量，技术路径默认折叠，console
错误为空；当前仓库全量回归 **1,624/1,624**。补丁已经合入后再运行只读 Preflight，receipt
`ea7c8a85-dcea-4151-ae6c-51d434a73cbe` 因补丁不再能干净应用而正确拒绝，同时保留 10 条有序
`default-business` 证据；当前 raw applicability diagnostic 仍过于技术化，作为下一轮独立 UX 缺口，
不继续循环纠正本 Task。

两次 Attempt 合计 input **350,608**、output **126,430**、cache read **23,730,560**，即
**24,207,598 gross Worker Tokens**；top-level 与 per-model 完全一致。Main exchange 只有低置信
区间 **159,870–967,304 Tokens**。缺少 exact-pair direct-Codex baseline，因此不把 boundary
reduction 写成“节约的 Main Token”。没有 commit 或 push。

## 2026-07-29 M3：路由证据已落地；Competition 测试全绿但 Main 拒绝合入

M3 routing Task `b3fa6489-70a7-43fd-9574-5e04117275c8` 使用 DeepSeek
`deepseek-v4-pro[1M]`。两个 Candidate Attempt 分别为 113 / 90 turns，均未独立收口；Main 没有
继续调用模型，在 retained Candidate 中定点修复并做一次零 Worker reverify。最终 revision
`06827c9c-fea2-43ec-8092-19110cd8d689` 为 19 files / 1,873 changed lines，独立验收 5/5，随后
Integration `8f4a0c3b-2cf3-45c3-9c4f-6d7af8078e27` 四阶段通过。现在 unknown evidence 不再被
包装成模型推荐；Competition 只来自 Main 的 explicit intent + enabled trigger；完整 Worker identity
和 resolved Profile 被冻结到选择证据与 Task snapshot。

该 DeepSeek Task 两轮合计 **32,772,029 gross Worker Tokens**（182,097 input、88,812 output、
32,501,120 cache read），runtime estimate 合计约 **USD 19.381345**。零 Worker reverify 新增模型
Token 和费用均为 0。没有 exact-pair Direct Codex baseline，不声明 Main Token 节约。

下一 Task `5e5ad6a1-0cfb-4e64-814b-cd3e9faa8ff4` 使用 Volcengine `glm-5.2[1M]` 做 mixed-runtime
Competition + Main decision。Attempt 1 为 133 turns，行为测试全绿、build 因重复 import 失败；Main
只授权一个结构化 correction。Attempt 2 为 66 turns，Candidate revision
`6476ba08-a04a-43f7-9b88-759c55997832` 覆盖 14 files / 1,814 changed lines，聚焦、全量
**1,663/1,663**、build、Hub syntax 和 diff hygiene 全部通过。

机器绿灯之后，Main 逐条走真实入口并发现三项未被测试捕获的结构性缺口：

1. `parseCompetitionCandidates()` 给 Profile Candidate 同时补 `providerName: ""` / `modelName: ""`，
   使真实 CLI/MCP 调用被核心的 ambiguous-entry gate 拒绝；核心单测绕过了解析层。
2. 新 Competition 文案和 MCP 声称 `revise` 可触发一次有界 same-Candidate correction，但
   `resolveCorrectionEligibility()` / `authorizeMainCorrection()` 仍 fail-closed 拒绝所有 Competition
   Candidate，承诺与执行不一致。
3. Hub 有 Competition story 和 mutation HTTP route，却没有让用户提交 accept/revise/reject 的可用
   交互；Task Detail 仍只显示 routing intent，没有投影实际 Competition 的 reason、machine comparison、
   Main decision、retained-partial 和 next action。

Main 因此对最新 Attempt 记录 `reject`，没有 Integration、第三轮 Worker、普通 retry、adaptation、
commit 或 push。该 GLM Task 两轮合计 **51,357,273 gross Worker Tokens**（396,744 input、177,937
output、50,782,592 cache read），runtime estimate 约 **USD 31.823441**；official cost 仍为
`pricing-identity: route-required`，不是 0。这个样本说明 full suite 通过不能替代产品调用链验收；
下一次必须先写 daemon protocol + CLI/MCP + Hub/Task Detail 的端到端失败测试，再做新的窄修复合同。

## 2026-07-30 M3 Competition 真实入口闭环；发现成功 Candidate 的复验状态缺口

Main 没有启动第三个 Worker，也没有再调用 GLM。它在 Task
`5e5ad6a1-0cfb-4e64-814b-cd3e9faa8ff4` 的 retained Candidate 中按真实调用链定点关闭上一轮三项
缺口：Daemon Profile-only Candidate parser 不再注入空 provider/model；Competition 的
accept/revise/reject 都绑定当前 Attempt、verification sequence、CandidateRevision 和 patch digest；
只有精确 Main revise 可以授权一次同 Candidate correction，重复授权被拒绝；重新 verification 后会
生成新机器比较并让旧 Main 决定变成历史，而不是沿用旧结论。

Daemon inspect 和 Hub Task Detail 现在投影实际 Competition，而不是只显示路由建议。用户先看到为什么
多跑 Worker、当前和其他 Worker 的真实身份、机器是否已有可交付建议、Main 是否已决定、保留了哪些
部分成果和下一步。Competition Detail 与 Task Detail 都有可执行的 Main decision 控件，但必须先完成
候选 Task 的同一 accept/revise/reject 审查；机器比较不能自动接受、重试或 Integration。CLI 同样区分
“仍在等待”“没有可交付候选”“有机器建议但等 Main”，不再把列表第一项写成 Winner。

Candidate 最终为 **20 files / 2,573 changed lines**，仍在合同的 20/2,600 边界内；该数字只用于风险
核对，不替代质量判断。Candidate workspace 的完整 `npm run check` 为 **1,673/1,673**，正式源码应用
后再次 **1,673/1,673**，TypeScript build、Hub JavaScript syntax 和 `git diff --check` 全部通过。
正式源与 Candidate baseline 的 20 个 affected files 在应用前逐一一致，既有两份进度文档修改未被覆盖。

这次零 Worker formal reverify 没有成功启动，原因是当前产品只允许 `status=failed` 的 Candidate 走
reverify。该 Task 的机器 verification 原本 passed、后来被 Main reject；Main 修复后没有合法入口捕获
新 CandidateRevision。ForkLight 正确拒绝了操作，错误为 `candidate reverification requires a failed
Task`。Main 没有伪造 failed 状态，也没有为刷新证据再花一次 Worker Token，而是在完整独立验收与
affected-source 零漂移证明后显式应用同一 20-file 补丁。这个交付是 **Main 手工、可审计的 source
integration**，不是 ForkLight automatic Integration；原 Task 的历史 Main reject 仍保留。M2 必须
补上“机器成功、Main revise/reject、Main 修复、零 Worker 复验、新 revision、fresh accept”的正式
状态路径。

新正式 build 为
`6da97f930f56bae9035a887b771397c4e4ec5d6a227f5d339e0d00e8c36c1863`，source digest 为
`d0a43a71d6e39746be5c141678e805bd8f68a7ed04b85b94b79dd3024059ec78`。Daemon PID `83144`，
Hub PID `84488` / port `62748`，identity matched/current，无 active/queued Task。Main repair 与本地
验证没有新增 Worker、Attempt、Provider 请求、Worker Token 或模型费用；不能据此声称节约了多少
Main Token。没有 commit 或 push。

本轮同时对齐 M2 的下一条产品能力：实现 Worker Candidate 与 reviewer/judge Worker 分离的 Review
Graph。裁判只读精确 revision、合同和验证证据，输出结构化 findings；默认一个，关键/高不确定任务
才用两个或三个独立裁判，Main 最终裁决。重复裁判必须有新 revision 或新证据，否则停止。Goal run
允许 `maxDurationMs: null`，并持久化里程碑、依赖、checkpoint 和当前审查绑定；但 no-progress、
no-new-evidence、最大 correction/review rounds、contract-infeasible 和 Main stop 仍是独立停止条件。
所以它支持“不设总执行时间”，不等于允许无休止自我迭代。

## 2026-07-30 Grok：成功 Candidate 的 Main 修复与零 Worker 复验已成为正式链路

Task `42dfe823-9348-4217-945a-55c8eff45926` 使用 `local-grok-builder` / Grok 4.5，严格按
7 月 30–31 日默认 Grok 策略执行，没有 Competition、其他 Provider、普通 retry 或 adaptation。
基础 Attempt 27 turns 交付 9 files / 1,271 changed lines。独立验收中 build、Hub syntax 和 diff
hygiene 通过，但 1,685 个测试有 3 个失败：两个旧断言忽略复验额度已耗尽，一个新边界夹具违反
Integration result 的 receipt 外键要求。

Main 记录 revise 后，把六个生产文件标为可复用，只留下两条结构化 gap；唯一一次 correction 仍由
Grok 执行，5 turns，只修改相应测试夹具。最终聚焦测试通过、全量 **1,685/1,685**、build、Hub
JavaScript syntax 和 diff hygiene 全部通过。Main 接受 Revision
`4d28b92b-fd4f-4a2c-8ade-e0d0c54ee85a`，Integration
`82f0be36-239e-4282-b6d5-96d03bff7612` 四阶段完成；没有手工复制补丁或伪造 Task 状态。

新链路只允许机器成功 Candidate 在最新 Main `revise` 精确绑定当前 Attempt、机器 verification 和
CandidateRevision 后复验。Main 本地修好后，原始验收套件不调用 Worker 即可生成新 verification 和
Revision B；新 Main accept 绑定 B 后才能 Integration。Reject 不会复活 Candidate；Competition、
已有 Integration、stale review/revision、空 Diff、运行中 Attempt 和额度不足都 fail closed。失败的
修复仍保留原机器成功事实，同时不会变成已接受或可合入结果。

两个 Grok Attempt runtime estimate 合计约 **USD 1.2090632**。Grok usage 缺失，所以 Worker Token
和官方费用保持 unavailable；Main exchange 仅有低置信区间 **655,928–3,983,182 Tokens**，没有
exact-pair baseline，不声明 Main Token 节约。当前 CLI/Daemon build
`59f462c324b74fc5f53438f766077b7aca4688517eea069da4406676a9f7aed9`，source digest
`c7c5efb9dd7f9dde8e8f55e974968154f2b1e3337400a286bb5d27a2c0d61ef7`；Daemon PID `91883`，Hub
PID `93059` / port `55072`，identity matched/current，无 active/queued Task。没有 commit 或 push。

## 2026-07-30 M2：Grok 实现单裁判 Review Graph，MiniMax 真实只读审查

实现 Task `42d5cf01-1af1-4b47-9ee7-e712acecd063` 使用 `local-grok-builder` / Grok 4.5。
基础 Attempt 79 turns，交付完整 Review Graph，但聚焦/全量测试各有同一条断言错误，build 还有两个
类型接线错误。Main 没有整轮重做：保留 14 个已验证路径，只把三条明确 Gap 交给同一 Grok 会话；
第二 Attempt 6 turns 后，聚焦、全量、build、Hub syntax 和 diff hygiene 全部通过。两个 Attempt 的
runtime estimate 分别约 **USD 3.4472376** 与 **USD 0.3676632**，合计约 **USD 3.8149008**；Grok
没有返回完整 usage，官方 Token/费用和 Main Token 节约均保持 unavailable。

Main 语义审查确认：Reviewer Task 只读、没有命令和 Delivery 权限，只能看到隔离的私有 packet；
packet 与 exact CandidateRevision/Attempt/verification/digest 绑定；注册、assignment 和 Task 在同一事务
持久化；completion/restart reconciliation 幂等；Reviewer 永远不能 Integration；显式审查会让旧 Main
accept 失效，最终仍需 Main 新决定。Revision
`5b4aae09-1c70-4d1b-a45e-e6ef5ed03515` 经 Integration operation
`520f57ba-2cb1-4969-a485-bafef1fbe7ef` 完成 source apply、5 条 source verification、artifact build 和
runtime activation。Main 随后只加固严格 JSON 边界并补回归，没有再启动 Worker。

真实链路使用隔离项目 `/tmp/forklight-review-dogfood.dRHm2I`。Grok Candidate Task
`4fb73ce0-f2ee-44f7-a4e6-d11ce8752e53` 用 4 turns 完成 2 files / 17 changed lines，独立验证通过；
runtime estimate 约 **USD 0.028698**。第一次 CLI 指派没有启动裁判，因为入口错误地把 `create` 当成
Task id；Main 修复 `review-graph create/status` 的真实参数顺序并重建/重启后，同一命令成功创建 graph
`0c410125-f7ae-42a8-98e2-9da7eb76b4a0` 和 MiniMax reviewer Task
`4ead4652-cbaf-41e3-a8c5-d579bfea69c6`。

MiniMax reviewer 4 turns、零文件修改、独立 read-only verification 通过，runtime estimate 约
**USD 0.0694125**。它返回的正文包含 schema 正确的 JSON，但 JSON 前后又附加解释，因此严格 parser
记录 `malformed-json`。ForkLight 没有采用其 disposition、没有修改 Candidate、没有自动决定，也没有
retry/correction/adaptation。Main 在这条终态审查证据之后亲自检查精确 Diff 和两条验收命令，记录 fresh
accept；Integration `8d4e28ed-c237-458e-ad7c-fd97fd908b13` 的 source apply 与 source verification
全部通过。这个样本证明裁判失败不会吞掉 Candidate 或触发循环，同时说明 Provider 的“任务执行成功”
与“结构化结果可被系统采用”必须分开统计。

Hub 原本直接显示 `malformed-json`，真实 dogfood 证明这仍然不可读。现在 Task Detail 先解释“这次
裁判结果没有被采用”，再用中英文说明具体原因、Candidate 未改变、没有自动决定、不会自动重试，最后
才把技术代码作为辅助信息。Impeccable detector 对改动后的 app/i18n 返回零问题；相关 Review Graph、
Hub、Integration 聚焦测试、严格 TypeScript、build、JavaScript syntax 和 diff hygiene 全部通过。
没有 commit 或 push。

## 2026-07-30 M2：Grok 实现 Durable Goal v1，并完成四 Task 跨重启证明

实现 Task `b04d3581-63c0-4369-af22-5fc9f235706c` 使用 `local-grok-builder` / Grok 4.5。
基础 Attempt 74 turns，生成 17 files / 3,081 changed lines；全量 1,713 个测试只有一项夹具失败，
build 暴露 `exactOptionalPropertyTypes` 接线错误。Main 保留全部 17 个路径，只授权一次结构化
same-Candidate correction。第二 Attempt 6 turns 后 1,713/1,713 测试通过，但 Grok 没有实际关掉
剩余类型错误；冻结的 correction / extra Attempt 上限随后正确拒绝继续循环。两个 Attempt 的 runtime
estimate 约 **USD 3.7974532** 与 **USD 0.7623856**，合计 **USD 4.5598388**；Grok usage 缺失，
Worker Token、官方费用和 Main Token 节约保持 unavailable。

Main 没有放宽冻结策略或伪造机器成功，而是保留主体并修正四类边界：可选证据不再显式写入
`undefined`；失败里程碑回到 Main 决策态，使冻结的纠正额度可用；Main accept 与 Integration 必须
绑定当前精确 Candidate id + digest；Goal stop 会移除尚未运行的排队工作，但不杀正在运行的 Worker。
同时补上中断态的白话下一步，不再让用户对一个已经停止的 Worker“继续等待”。聚焦 349/349、全量
**1,714/1,714**、strict TypeScript、build、Hub syntax 和 diff hygiene 通过。Main remediation check
`13a50504-c7f0-498a-9b02-a5726377556c` 对当前源码重跑原合同 5/5，记录
`verified-repaired-delivered`；原 Worker Task/Attempt 的 machine failure 保持可见。

真实四 Task 证明位于 `/tmp/forklight-goal-live.m4ZT8R`。第一次 Goal 故意只配置一个 base Attempt，
daemon 重启后 foundation 被持久化为 `interrupted`，其余三项仍等待，没有重复 Task 或越过门禁；但
也没有剩余额度可恢复。Main 显式停止该 Goal，并用两个 base Attempts 的冻结配置提交
`/private/tmp/forklight-goal-live.m4ZT8R/goal-v2.json`，没有修改全局策略。

第二次证明注册恰好四个 Grok Task。Main 在 foundation 运行中再次重启 daemon；Goal 投影
`resume-task`，Main 用现有 Task 权限恢复同一 Task，第二 Attempt 2 turns 成功。机器门随后释放两条
分支：Task `116924fb-67c7-4d49-8f7e-0ab35c978002` 4 turns、2 files / 14 lines，必须由 Main 对精确
revision fresh accept；Task `ef9e2e73-461f-41df-a638-dcc393f2a481` 4 turns、2 files / 17 lines，
必须再经过 Integration `47ffd4f1-e514-499e-9735-625f5307badf`。最终 Task
`aa19a59b-935c-42f5-aab5-838394b133ed` 5 turns，从真实源码导入已合入的 `integrated.js` 并返回 43。
Goal 最终 4/4、100%，correction/review/no-new-evidence counters 均为 0；没有 Competition、自动
review、自动 correction、自动 Integration、commit 或 push。四个成功 Attempt 的可见 runtime
estimate 合计约 **USD 0.0817716**，Grok usage 仍 unavailable。

## 2026-07-30 M2 multi-judge + result transport dogfood

### 结果

- 多裁判实现：Task `40ba6060-b921-48d2-badc-a6a3fed1a33e`，Grok 29 + 8 turns；Main 保留
  Candidate、只修一个类型夹具，remediation `7fd82a13-a2d5-48c4-8dc5-a1fb384ff446` 5/5。
- 第一次真实 graph `adb2e3cf-8d7a-4d79-83a7-46f71397b027` 保留为失败证据：Grok 与 MiniMax
  reviewer Task 都 machine-succeeded，但两个结构化意见都没有进入 graph；没有 retry/replacement。
- 传输修复 Task `f7cef2c5-e5b7-490d-95aa-a63b5b9c6f41`，Grok 23 turns；Main 检查并应用后，
  普通 Task prompt 不变，reviewer Task 使用耐久身份和严格 JSON 终态要求。
- 新 Candidate `19a5f96b-9283-4cf3-9a10-61865352efe6`、revision
  `32e0f0b3-70a4-49fd-8ce2-a53294a63cde`、graph
  `23c5bee0-13a4-4fe8-99e5-44c2996c38ac`：Grok opinion 可用并建议 accept；MiniMax JSON 唯一且
  语义完整，但 summary 509 > 500，严格失败。aggregate=`single-opinion`，Main fresh accept 后
  preflight eligible；没有实际应用临时项目。
- 输出边界 Task `cd6d78e2-9b1b-4646-85a2-cf5eb4d4e7a5`，Grok 22 turns；所有数字上限现在在
  reviewer prompt 与 immutable packet 中一致可见，parser 不截断、不 coercion、不历史回写。
- 最终 focused、build、diff hygiene 和 full **1,729/1,729** 通过。无 commit/push。

### 费用与 Token 证据

- 四个新 Grok Attempt（传输修复、边界说明、临时 Candidate、Grok judge）runtime estimate 合计约
  **USD 1.6316572**；Grok runtime 没有完整 usage，Worker Token 和官方费用保持 unavailable。
- MiniMax judge 为 5,803 input + 1,959 output + 4,215 cache-read = **11,977 gross Worker Tokens**；
  runtime estimate **USD 0.0800975**。现有 pricing evidence 给出 CNY **0.0304122** bounded estimate，
  因缺 per-request tier evidence 不写成精确账单。
- 没有同条件 Direct Codex 对照，不把 Worker volume 或 boundary exchange 解释成“节约了多少 Main
  Token”。

### 新发现与处置

| ID | 发现 | 处置 |
| --- | --- | --- |
| FL-D236 | Grok streaming text 已包含完整 judge JSON，但 terminal `EndTurn` 覆盖了此前文本，导致 machine success 与 usable review 分裂 | **closed 2026-07-30**：有界按序积累 text delta；明确 terminal 正文优先；普通 EndTurn 才回退完整积累；overflow/error/interruption/watchdog fail closed |
| FL-D237 | Claude-compatible judge prompt 末尾追加通用 coding summary，与“只返回 JSON”冲突；严格 parser 又把一个唯一安全对象连同包装文本一起丢弃 | **closed 2026-07-30**：durable reviewer identity 替换通用终态说明；全原文先做大小/凭据扫描，再只接受唯一完整对象；多个/不明确对象仍拒绝，不自动重试 |
| FL-D238 | MiniMax 返回字段正确的唯一 JSON，但 summary 509 字符超过 parser 500 上限；prompt 只说 short，Worker 不知道数字 | **closed for future prompts 2026-07-30**：复用 parser constants，把准确字段上限同时写入 reviewer prompt、required schema 和 immutable packet；历史失败不重写，也不为制造漂亮结果重跑 |

### 下一步

M2 不再围绕同一 JSON 格式继续重试。下一条独立证明是 Goal 的 bounded no-progress / no-new-evidence
停止链路；之后再用自然出现或专门设计但一次性的两位可用裁判分歧样本，证明 disagreement 交回 Main，
不投票、不循环、不自动 Integration。

## 2026-07-30 M2 Goal：不限总时长，但闲置与无新证据推进都有边界

### 实现与 Main 处置

- 实现 Task `2dee6c74-ad0a-4d4b-86a0-30129c70b93f` 使用
  `local-grok-builder` / Grok 4.5。基础 Attempt 19 turns，核心停止、证据游标、准入阻止、CLI/Hub
  解释和重启测试均完成；Main 语义审查只发现中文 Goal Detail 仍会混入存储的英文停止原因，因此记录
  `revise`，保留核心路径，只授权一次结构化 correction。
- Correction 8 turns，产品代码、build、Hub syntax 与 diff hygiene 通过；全量 1,735 个测试只有新加的
  UI 行为测试失败。失败不是产品语法，而是测试把 `(sandbox)` 整段替换成 `sandbox`，生成
  `})sandbox`。Task 仍如实保持 machine-failed；`maxMainReverifications:0` 也正确拒绝了 Main 试图重新
  验收，没有偷偷放宽策略或再启动 Worker。
- Main 只修复这个测试夹具的括号，保留 Grok 的七文件成果并重新执行同一聚焦套件：**257/257**；正式
  源码随后通过 build、Hub JavaScript syntax、diff hygiene 和全量 **1,735/1,735**。这次是可审计的
  retained-Candidate + Main source repair，不改写原 Task 的失败历史，也没有 commit/push。

核心行为现在只把 Task 生命周期、当前 Attempt、verification、CandidateRevision、fresh Main Review、
Review Graph 与 Integration 当作 Goal 权威证据；Worker 的 `thinking` 消息与状态轮询不会制造进展。
有限 `noProgressTimeoutMs` 只在没有 Goal-owned Task/reviewer 运行时生效，并进入 terminal `stopped`，
移除尚未运行的排队工作、阻止后续准入，但不杀正在运行的 Worker。`maxDurationMs:null` 仍保持不限总
时长。Hub 对闭合的 Goal reason code 使用中英文白话映射，未知旧数据才回退到存储原因。

### 两条真实跨重启证明

1. Goal `examples/dogfood/m2-goal-live-no-progress.json` 注册四个 Task，只启动 foundation
   `1b88441d-a37e-48ed-848a-dbea298ab1cf`。该 Grok 只读 Task 4 turns、机器验收通过、0 files / 0
   lines；Main-accept gate 阻止三个下游 Task。5 秒无权威新证据后 Goal 进入
   `stopped / no-progress`。Daemon 重启后 `maxDurationMs:null`、停止时间、reason code、foundation
   succeeded 与三个 dependent waiting 全部保留，active/queued 均为 0。
2. Goal `examples/dogfood/m2-goal-live-evidence-cap.json` 同样只启动 foundation
   `6afa5148-bb47-4dbc-a578-fe1c03a773da`。Grok 4 turns、机器验收通过、0 files / 0 lines；
   `noProgressTimeoutMs:null` 不按时间停止。Main 连续两次显式 advance 都得到 `newEvidence:false`：第一次
   counter=1 保持 waiting，第二次 counter=2 进入 `stopped / no-new-evidence-cap`。Daemon 重启后
   counter=2 与三个 dependent waiting 保留，active/queued 仍为 0。

两次实测均使用 Grok，没有调用 DeepSeek、MiniMax、GLM 或其他 Provider，没有 retry、correction、
adaptation、自动 Main 决定或 Integration。

### 费用、Token 与新发现

- 实现两个 Grok Attempt 的 runtime estimate 为 **USD 0.691108 + 0.4140256 = 1.1051336**；两条
  live proof 为 **USD 0.0855848 + 0.06605 = 0.1516348**。本轮可见 runtime estimate 合计
  **USD 1.2567684**。
- Grok terminal usage 仍缺失，因此 Worker Token 与官方费用保持 unavailable。每条 live proof 只有
  1 个 receipt，Main exchange 是低置信 **140–839 Tokens**；没有 exact-pair Direct Codex baseline，
  不声称节约了多少 Main Token。

| ID | 发现 | 处置 |
| --- | --- | --- |
| FL-D239 | Goal evidence digest 把任意最新 Worker event sequence 当成进展，`thinking` 或轮询可能无限推迟停止 | **closed 2026-07-30**：改为闭合的 Task/Attempt/verification/revision/Main Review/Review Graph/Integration facts；真实 Worker 消息不再重置证据时间 |
| FL-D240 | 有限 no-progress 原先只把 Goal 标为 waiting，未来 Task 仍可能被调度，不能真正终止闲置循环 | **closed 2026-07-30**：无 Goal-owned work in flight 且权威证据超时不变时进入 durable stopped；prune queued、block future admission、preserve active Task authority；两条真实重启链路通过 |
| FL-D241 | 中文 Goal Detail 直接插入存储的英文 `goal.reason`，用户能看到双语混杂的内部解释 | **closed 2026-07-30**：已知 reason code 全部走中英文白话映射，story 与 stopped summary 共用；未知 legacy code 才安全回退，行为测试覆盖不泄漏英文 |

### 下一步

Goal bounded-stop slice 已关闭，不再围绕同一参数重复实验。下一条独立 M2 证明是一次性的两位可用
裁判分歧：Graph 只保留各自意见并把决定交回 Main，不投票、不自动重跑、不自动 Integration。随后进入
跨 Worker 的 durable handoff，验证长程任务在 Worker 切换与 Main 接管时不丢输入、部分成果和验收边界。

## 2026-07-30 M2：一次性双裁判样本得到一致意见，Main 仍独立裁决

Main 为“一次性分歧证明”创建隔离项目 `/tmp/forklight-review-disagreement`。实现 Task
`b33bcb57-a7d9-4a2e-b5b5-5464a113d8d7` 使用 Grok 4.5，4 turns，交付 2 files / 20 added
lines；两条机器验收通过。Review Graph `eca77b03-af40-437d-ad41-a332727a7959` 同时指派：

- Grok reviewer Task `29f3bdeb-1b05-4503-82fd-a5ea5913dfd1`：2 turns、只读、usable accept、无
  finding；runtime estimate **USD 0.0162184**。
- MiniMax reviewer Task `150bf5a6-8711-458f-881c-dabf03474e7f`：5 turns、只读、usable accept；把
  review packet 中的非强制预算提示记录为 info finding，但明确不应为了压缩行数牺牲测试覆盖；runtime
  estimate **USD 0.101536**。

Graph 最终为 `agreement`，不是预期的 `disagreement`。系统没有因两票同意自动接受：
`blocksIntegration:true`、`requiresFreshMainReview:true` 保持，Main 重新阅读精确两文件 Diff 并重跑两条
验收后，才对 revision `3a100fa6-b5af-4283-8aae-9fa291dc6329` / digest
`14f519d4557ea9ecaf0c3f154acc144169ddd0c3d00040c48694bb990039cea0` 记录 fresh accept。临时
Candidate 没有 Integration、commit 或 push。

本样本按合同只运行一次。Main 不会改 prompt、换模型或重跑来制造一条好看的分歧记录；自然出现的
live disagreement 证据仍开放，单元与端到端夹具已经证明 `disagreement` 状态只交回 Main、不投票。
M2 下一条 active slice 转为 durable cross-Worker handoff。

MiniMax 本次使用 10,637 input + 1,719 output + 10,752 cache-read = **23,108 gross Worker
Tokens**，top-level 与 per-model 完全一致。实现 Grok runtime estimate **USD 0.0196964**；本样本三次
Attempt 的可见 runtime estimate 合计 **USD 0.1374508**。Grok usage 缺失；没有 exact-pair Direct
Codex baseline，因此不声明 Main Token 节约。MiniMax 的 18,351–22,336 boundary reduction 只是
Worker volume 减去低置信 exchange envelope，不是“Codex 本来会花多少”的反事实。

## 2026-07-30 M2 cross-Worker handoff dogfood

- Grok 实现 Task `17de9c6a-2bff-4999-84da-c0f091e19c88`：51 + 16 turns；Main 使用一次结构化
  correction 后只修一个 TypeScript 测试夹具。原 Task 保留 machine-failed；当前源码全量
  **1,744/1,744** 与 build/syntax/diff hygiene 通过。
- 第一次 live Competition `4c299093-8fa1-4138-b616-41a85f06cdc4` 保留为 Main 合同失败证据：YAML
  中 `#` 截断第二条验收命令；Grok/MiniMax 实现和 `npm test` 均正确，没有重写历史。
- 修正合同后的 Competition `42f2b847-a8b3-4942-abdd-5d5a04bc5507` 两个 Candidate 均成功。Main
  从 MiniMax Candidate `fe349be5-c5bb-4ea7-b9b1-92b37c68c744` 只保留 `lib/parser.js`，把 formatter
  Gap 交给 Grok Profile。
- Handoff `94d0343b-af0e-4680-b5e7-ff2259af6f41` 只创建 successor
  `9c69323e-af1c-43de-afb5-59129904dadf`。运行中重启先暴露两处恢复状态缺口；Main 本地修复，不创建
  新 handoff/Task。一次性 durable restart continuation 随后成功：Grok 5 turns、独立验收通过，parser
  与 MiniMax source 字节一致，final Diff 完整包含 parser + formatter。
- Main fresh accept revision `b0966cb3-0416-4fba-aaba-2bfe1a44412a`；preflight
  `8d1a2059-75df-465b-9c86-d85fcf480fc0` rejection 为空。临时项目未实际 apply；无 commit/push。
- 实现 Grok runtime estimate **USD 4.6207804**；live 样本可见 estimate **USD 0.269179**。MiniMax
  两个 live Attempt 合计 **62,945 gross Worker Tokens**；Grok usage unavailable。没有 exact-pair
  Direct Codex baseline，不声明 Main Token 节约。

## 2026-07-30 Relay Gmail production Goal dogfood

### 结果

- 最终 Goal `examples/dogfood/relay-gmail-production-final-goal.json` 完成 **4/4、100%**；四项均由
  `local-grok-builder` / Grok 4.5 实现，Main 审查后才进入安全 Integration。
- truthful adapter Task `27e6fff0-8cd9-4dec-b6b3-01f5e180e821` → Integration
  `e03f251e-57d3-4823-a671-9ad43388b3f7`；credentialed failure 不再静默回退 fixture，provider detail
  404/410 只跳过该条，其余认证、网络、provider、malformed 失败如实上抛。
- failure preservation Task `67cf8789-2a2c-47de-bbed-0ff5bd8f9acb` → Integration
  `89043e3a-e0a6-478a-bf1d-850c290fb4ec`；失败事务只更新 connector error 和一条 secret-free event，
  保留旧 items、cursor、itemCount、lastSyncAt 与 accountLabel。
- onboarding Task `faf8c167-0cba-4df2-a5e1-a03122be1b68` 首次 Attempt 失败后保留全部 6 个路径，
  一次结构化 correction 关闭 callback 原始错误泄漏与 React lint；Main 实测桌面和 390×844，无横向
  溢出、Advanced 可展开、console 干净、Impeccable detector `[]`；Integration
  `8d22c7fe-657f-41bb-b3a2-fdb89537ed5a` 完成。
- setup docs Task `27d1d32f-3506-4df6-a81a-feaffd601837` 首次 Attempt 失败后保留 5 个路径，一次
  correction 修复 Markdown 否定句误判，并按 Main 对 Google 官方 Desktop OAuth 文档的核对结果，
  把“手工登记 Authorized redirect URI”改成“核对 Relay 显示的 loopback callback”；Integration
  `cb3583bb-a11d-4a20-8529-60c951ff6fdf` source apply 与 3/3 source verify 通过。

### 有界失败与成本

- 原 production Goal 在两项基础能力完成后因冻结 correction cap 停在 50%；第一版 continuation 又因
  通用 mock 断言把真实 live adapter 误判为演示数据而停在 0%。两段历史保持 stopped，没有改写。
- 最终 continuation 只为两个失败 Candidate 各授权一次 same-Candidate correction；没有普通 retry、
  Competition、adaptation、自动 Main 决定或无休止自迭代。
- 最终 Goal 六个 Grok Attempt runtime estimate 合计约 **USD 2.4520268**：truthful adapter
  `0.5978044`，preservation `0.557106`，onboarding `0.4386208 + 0.2578572`，docs
  `0.3887088 + 0.2119296`。所有 Attempt 的 Provider official usage 均为 `usage-missing`，所以 Worker
  Token 与官方费用 unavailable，不写成 0。
- 没有 exact-pair Direct Codex baseline，不把 Worker volume 或 boundary exchange 写成 Main Token
  节约。本轮没有 commit 或 push。

### Milestone 处置

这条真实产品 Goal 证明 4 Task 依赖、有限 correction、Main 精确验收与四次安全 Integration 可以闭环，
加强 M1.4 与 M2 证据；它没有在同一 Goal 内调用 Review Graph 或 cross-Worker handoff，因此 M2 的下一
独立出口仍是一个 4–8 Task Goal，在关键里程碑真实使用裁判和交接且无需手工修数据库/工作区。M1 的新
机器首次配置与 Adeptify、Dia、NovelRPGPlay 多项目十 Task 证据也仍保持 open。

## 2026-07-30 Relay Gmail history Goal：5/5 长程产品证据

### 结果

Goal `examples/dogfood/relay-gmail-history-goal.json` 于 **2026-07-30T02:28:04.812Z** 完成
**5/5、100%**，evidence digest 前缀 `1ef72ccbdde7`。终态：correction rounds **3 of 3**，review
rounds **2 of 2**，no-new-evidence cycles **0**。这是一条真实五里程碑产品 Goal，不是夹具重放。

| 里程碑 | Task id | Integration / gate |
| --- | --- | --- |
| cursor | `13badf99-b28d-4670-a49f-4cd76ae2ddcf` | Goal 已记录 cursor Integration |
| live-history adapter | 原 `decbae4e-4ac8-48c3-a5d2-78801662ccb4`；effective handoff successor `dd837113-bb99-4557-b5ae-c08fc9881549` | gate 由 verified Main-repaired source 对照**原 acceptance** 满足，未整单重跑 |
| explicit recovery | `c3101828-d38b-4903-b580-28b6deac6074` | `d7f6035a-9ed9-4c50-890e-1c2215097c28` |
| recovery UI | `f46aa672-0046-4a8d-8567-0a90adfdc111` | `782e9d3e-9869-4ed2-8462-18991abc8a49` |
| restart proof / docs | `c8c85e73-bcca-4935-b83e-d0828879bb3e` | `79293bb1-377d-47d9-87f0-9f566ebee5b5` |

### 执行故事：handoff、Main 修复、自升级、重启

1. **Adapter 跨 Provider handoff。** Adapter 以 MiniMax 起步，经 Goal 直接 handoff 到 Volcengine
   GLM；Main 修复重复的 `historyTypes` 查询编码后，按原 acceptance 验证通过，没有重跑整个 Task。
   这次跨 Provider 使用是为了验证 handoff 能力；普通实现仍保持 Grok-first。
2. **ForkLight 自升级 Integration gate。** Goal 进行中，ForkLight 升级为：仅当原验收合同仍成立时，
   才接受 verified Main-repaired delivery；被改写的 acceptance 不得借此过门。该自升级完成 source
   apply、verification、build、daemon activation 与 identity proof；Goal 随后从 20% 推进到 40%，
   没有手工改数据库或工作区来“推进进度”。
3. **真实 daemon restart。** UI 里程碑处于 verification 时发生真实 daemon restart；Goal 从 durable
   state 继续，未丢里程碑或重复突变。
4. **Main 浏览器审计。** UI 在真实浏览器桌面与 390×844 通过：无横向溢出；一页 Gmail 卡片结果；
   手工同步显示两条新 Item 与 preservation 文案；浏览器 console 无 warning/error。
5. **最终源码。** Relay 源码验证 **308/308** tests 与 production build 通过。无 commit 或 push。

### 费用与 Token 证据边界

- Grok usage 不完整；可见 runtime estimate 若存在也只是 runtime 估算，**不是** Provider 官方账单。
- 本条**不**记录编造的精确 Worker Token，**不**把 runtime estimate 写成 official bill。
- 没有 exact-pair Direct Codex baseline，因此**不**声明 Main-Token 节约。

### 已证明 / Main 干预 / 仍 open

**已证明（强化 M2）：** 五依赖 Task、restart 持久化、cross-Worker handoff、Review Graph 证据面、
有界 correction、部分复用、Main review 与 Main repair（仅原 acceptance）、safe Integration。

**需要 Main 干预的环节：** adapter 的 `historyTypes` 编码修复与原合同复验；Integration gate 对
Main-repaired delivery 的产品化；UI 浏览器体验审计。这些是可见 Main 职责，不是静默绕过。

**仍 open：**

- **M1：** 真实项目组合现已达 13/10；仍需 clean new-Mac / VM 外部用户旅程。
- **M3：** 30–50 条真实分类样本。
- **M4：** exact-pair Direct Codex 基线与可发表 Main-Token 证据。
- **M5：** 外部用户独立安装与反馈。
- 自然出现的 live judge disagreement 仍可作为补充证据，但不得为制造分歧而重跑同一样本。

## 2026-07-30 M3：Task-unique 已接受交付统计纠正 18→19 虚高

### 缺陷与原因

真实 Volcengine Provider/model 队列有 **18** 个终态 Task，但旧统计把机器成功数与 Main 修复数
**直接相加**，得到 **19** 次已接受交付（`acceptedDeliveryCount` 可超过 `sampleSize`）。根因是
`summaryFor` 的可重叠路径：同一 Task 既可机器成功，也可随后获得通过的 Main remediation，却被
计两次。历史 Task、失败分布与 remediation 记录本身是对的；错的是聚合语义。

### Task、Main 决定与 Integration

| 项 | 值 |
| --- | --- |
| Task | `decc6048-42e4-48f2-ad24-142d4a49a91c` |
| Worker | Grok 4.5 / `local-grok-builder`；**1 Attempt / 4 turns** |
| 验证 | build、**67** focused tests、全量测试、diff hygiene |
| Candidate Revision | `5cd3be4f-96af-40b0-8027-a52733873e5a` |
| patch digest | `351e3dc08edbc6156443467c055bedc1d1e73ca4f81979fd3f80be585fdce5bc` |
| Main 决定 | 接受该 Candidate |
| Integration | `c99a9e33-10ee-4b89-8cc5-69e68e235538`（source apply、四条 source-verification、artifact build、runtime activation 均通过） |
| 代码修复激活时 build | `cf2079b8bf6baa4d98c8c9734ace498ef2935e44a6fddb3d8e75dfbf81fbfd26`（后续文档自构建会产生新 build id；实时值以 `forklight health` 为准） |
| source digest | `d2b7ead96ff44416f4cdd720bd3beb0498cc6d65b439d380fb426cff3f0fe8d9` |
| 代码修复后的 Hub 快照 | PID `87204`，当时为 `current`，端口 `61182` |

修复语义：已接受交付 = 机器成功 **或** 通过 Main remediation 的 **Task-unique 并集**；
`mainRepairedDeliveryCount` 仍独立计数修复路径，不隐藏“先成功后修复”的 Task。

### 激活后真实队列数字

| 字段 | 值 |
| --- | ---: |
| `sampleSize` | 18 |
| `successCount` | 11 |
| `mainRepairedDeliveryCount` | 8 |
| 旧加法结果（缺陷） | 11 + 8 = **19** |
| 交叠 Task 数 | 2 |
| `acceptedDeliveryCount`（修复后） | **17** |
| `acceptedDeliveryRate` | **0.9444444444444444**（约 **94.4%**，**17/18**） |

失败历史与原始 Task 证据均保留；本条不改写、不删除任何历史失败。约 94.4% 只描述**该已记录
Volcengine 队列**的纠正结果，不是模型级裁决。

### 费用与 Token 证据边界

- Grok runtime estimate 约 **USD 0.144428**；usage missing / unavailable，故 officialCost
  unavailable。
- **不**记录编造的 Worker Token；runtime estimate **不是** Provider 账单。
- 没有 exact-pair Direct Codex baseline，因此**不**声明 Main-Token 节约。
- 无 commit 或 push。

### 已证明 / 仍 open

**已证明：** M3 交付统计的证据正确性——同一 Task 不再双计；`acceptedDeliveryRate` 不能超过
100%；重叠的机器成功 + Main 修复路径用 unique 并集表达。

**仍 open：**

- **M1：** 真实项目组合现已达 13/10；仍需 clean new-Mac / VM 外部用户旅程。
- **M3：** 本修复不提供仍缺的 30–50 条代表性分类样本。
- **M4：** exact-pair Direct Codex 基线与可发表 Main-Token 证据。
- **M5：** 外部用户独立安装与反馈。

2026-07-30 与 2026-07-31 继续 Grok-first；clean-user / external-user / exact-pair 等 caveat 不变。

## 2026-07-30 M3：MCP Task admission 保存 Main 路由决定

- 审计：300 个 Task 中 125 个无 class、242 个无 family、300 个无 routing decision；不是算法没做，
  而是 MCP 提交入口丢了 Main 的选择上下文。
- 选择：Task `c340116f-827b-4ff5-952a-50fd3319f5c9` 首次冻结完整决定。Grok/DeepSeek 都是实际考虑
  候选；只读证据为 unknown / none / 双方实测 0，Main 按一骏 7 月 30–31 日偏好选 Grok，明确不竞争。
- 实现：MCP validate/submit 暴露并透传 `taskClass`、`taskFamily`、完整 `routingDecision`；canonical
  parser 仍负责 Worker 身份、shortlist、Competition 和 family 一致性，旧调用者省略字段仍兼容。
- Skill：新非 demo Task 应复用语义匹配的稳定 family；只在至少两个 Worker 真正可选时调用只读路由；
  未查询证据用空 map 表示 unavailable，不能伪造 0；unknown 不授权 Competition。
- Main 审查：首轮 15 turns 虽然全绿，但两处 Skill 判断会加剧 family 碎片和未知→0。保留四文件
  Candidate，只做一次 4-turn structured correction；没有新 Task、第二 Provider、普通 retry 或 adaptation。
- 交付：Candidate Revision `3c6dea75-3f95-4a37-9e1c-04631f28ed59`；Integration
  `2e4b4dfa-c739-4625-bf94-eb7c9be5d0a4` 四阶段通过；最终 4 files / 384 lines。CLI / Daemon build
  `052afda7412fa3df541b5f346bdb9a0a5b312b37341fddeebbcc3ee37d8f92f3` 匹配，Hub PID `25298`、
  port `51561` current。长驻 Main 需重载才能发现新增 MCP 字段。
- 经济边界：两次 Grok runtime estimate 合计约 **USD 0.5842384**；usage missing，Worker Token 与
  official cost unavailable。没有 exact-pair，不声明 Main Token 节约。机械文档更新由 Main 直接完成，
  避免再花一轮 Worker Token；无 commit/push。

该样本改善未来证据入口，不回填旧 Task，也不关闭 M3 的 30–50 条真实分类样本出口。

## 2026-07-30 M3：中文 Goal 总览真实审计与 Grok 同 Candidate 修正

- 现场：中文 Hub 把 durable `stopped` 显示为“状态未知”，总览又用 raw `nextAction` 压过 code，完成和
  停止 Goal 均泄漏存储的英文说明；详情页已有正确本地化，所以没有扩成状态机/API 重构。
- 路由：Task `27e041e6-4ab1-4f75-8d1a-83619cbde4ac` 使用 `taskClass=hub-goal-overview-plain-language`、
  `taskFamily=bounded-javascript-change`。Grok/DeepSeek exact evidence 均为 unknown/none；按用户两日偏好
  选择 Grok 4.5，Competition intent none。
- Main 判定：首轮 9 turns、3 files / 179 lines 全绿，但终态卡只显示“当前无需 Main 动作”，没有解释
  停止/完成原因。Main 记录 revise，保留 revision `84778358-c2b4-49ea-addb-2927a4c82a62` 的三文件，
  仅授权一次 4-turn correction；不整单重跑。
- 验收：第二轮 Goal/Hub 聚焦 80/80、syntax、build、diff hygiene 通过。全量 1,767/1,768 唯一失败为
  未改动 `hub-instance` 的一次 legacy/unverified 时序波动；同文件随后在权威源码 40/40 通过。
- 复用：Task 明确冻结 `maxMainReverifications=0`，系统拒绝零 Worker reverify。Main 没有临时放松冻结
  值、没有第三次 Worker、没有改验收；把最终 Candidate 三文件逐字应用后，原合同 remediation check
  `7c2e798d-dbad-41c8-8682-44a4c8a9744b` **6/6**，记录 original-acceptance 的
  `verified-repaired-delivered`。failed Attempt 与 Integration preflight rejection 均保留。
- 激活：CLI/Daemon build `6096d8e05b3f54d4569454749dcd1a1d3566f55c7656b0f70d0bc4916f01e699`、
  source digest `9d25400b79dd8c56adb6cd88fe437dcd8f715f487c69cbd3c4beaf30225dca17` 匹配；Hub PID `19303`、
  port `65175` current。真实中文页面显示“已停止”、本地化停止原因和“所有里程碑闸门均已满足”，
  console 无 warning/error。
- 经济边界：两次 Grok estimate 合计 **USD 0.4240116**；usage/official cost/Worker Token unavailable，
  无 exact-pair，不声明 Main Token 节约。302 个 Task 中现有 2 条完整 routing decision；M3 样本出口未关。

| ID | 发现 | 处置 |
| --- | --- | --- |
| FL-D249 | Goal Overview 未识别 `stopped`，并让 raw 英文 nextAction 压过结构化 code | **closed 2026-07-30**：三表面共用 code-first action；终态 Overview 用本地化 reason；浏览器实证 |
| FL-D250 | Main 在含全量套件的合同中显式设 `maxMainReverifications=0`，无关 flake 后无法走零 Worker 复验 | **operational lesson**：冻结值不改、不自动循环；本轮走原合同 Main remediation。未来优先继承 Profile 或显式保留一次复验 |

无 commit / push。

## 2026-07-30 M0：自升级证据按真实交付身份隔离，3/3 恢复为可信结果

- **问题不是历史丢失，而是统计边界错误：** 普通 Elsewhere / Relay Integration 的 artifact 与 runtime
  阶段本来就不适用，却会进入连续自升级窗口并把 3/3 清零。Task
  `46e92e85-6c6a-427b-b588-51b20f8d476a` 只路由 Grok 4.5，1 Attempt / 17 turns，6 files /
  584 combined changed lines，无 Competition、retry、correction 或 adaptation。
- **修复语义：** Store 先把 Integration result 关联到不可变 receipt，再按 receipt JSON 中精确的
  `forklight-self-upgrade` Delivery Profile identity 筛选，最后才应用 limit；排序以 `created_at` 与 id
  确定。同身份失败仍打断，普通项目、缺失或 malformed receipt、近似名称和其他 profile 全部中立，既不
  加分也不清零。
- **Main 验收：** focused、build、Hub syntax、diff hygiene 和 full **1,874/1,874** 全绿；Main 逐文件
  审查完整 797-line diff，接受 revision `508e082f-4a15-40c7-8184-4d2dcf8454c4`，digest
  `0468c4e9cf34a38762a359782ca0f9912b83bb14f468e916ce0f9fb3593c18b2`，没有为形式增加裁判。
- **真实自举：** Integration `38be4197-f38c-4b45-8d24-3e3adb099710` 的 source apply / verify /
  artifact build / runtime activation 为 11ms / 96,499ms / 3,445ms / 3,111ms，全部 passed。第一次 30 秒
  observer wait 只返回 outcome-unknown，但权威 operation 仍在运行，因此 Main 没有重复提交；随后观察到同一
  operation applied。CLI 与 daemon PID `66569` 匹配 build
  `42baf6f08ce8a0edd52c0e0e82992c37f6b86e4764cca03851e4db2026825747`、source digest
  `af0c0401e1cad9439005543c0132a3cf5db40ca817758c65f6adb8c33c0206d0`；Hub `67553@58675`
  current。权威命令真实返回 **3/3 ready**。
- **经济边界：** runtime estimate USD 0.7086456；terminal usage missing，official cost、Worker Token、
  boundary reduction 与 direct Main Token savings 均 unavailable，不把 exchange 估算范围冒充节约。

无 commit / push。

## 2026-07-30 M1：Elsewhere Shell 保留原成果，零 Worker 复验后完成合入

- **原任务：** `0dc9d614-bfd9-46a9-8306-2e042dd12bed`，Grok 4.5，1 Attempt / 22 turns，4 files /
  848 lines，runtime estimate USD 1.0087312。实现主体可用，机器失败来自测试对页面范围、隐藏抽屉和异步
  dialog 的错误假设，不是产品实现需要整单重写。
- **有界处理：** `forklight correct` 因 Goal 共用 correction cap 已耗尽而正确拒绝，没有启动第二个 Worker。
  Main 在隔离 Candidate 中只修三处测试：把标题断言限定在 Now 页、按可访问语义查找隐藏 drawer、等待 dialog
  出现后再检查祖先。随后调用一次 `reverify` 跑原 5 条 acceptance commands，9.2 秒全部通过；
  `workerInvoked=false`，新增 Worker Tokens 与模型成本均为 **0**。最终 revision
  `530ef2fe-ccf0-4b32-a0d4-6954ccedd62a`，digest
  `2fab7054bb979e3cad4f3468052192595b27bbb4c25f231f6159c9266df2fe20`。
- **Main 与体验审查：** Main 逐文件审阅全部差异，并在 1280×720 真实浏览器检查 Now 页、Journey drawer、
  Escape 关闭、焦点返回和 console；无 warning/error。两个只读独立审查再覆盖 1745×952、860×640 和静态反模式
  检测。保留 Contract 已明确的 icon-only Journey 入口及“未完成 + 完整列表”结构；不让裁判把个人偏好变成
  自动否决。
- **后续硬验收，而非整单重跑：** 真实发现主按钮对比度约 3.8:1、860×640 信件页 archive 与“上一幕”控制
  碰撞、page-wide `aria-live` 可能重复朗读、故事下一步在短屏缺少发现提示。这四项进入下一相关 Candidate 的
  Main 浏览器验收；达到有界修复上限后交回 Main，不触发无限参数调整。
- **安全合入：** Main 接受 exact revision；Integration
  `84ed4e65-beb7-4427-a5a4-2ff90553a738` 的 source apply / source verify 为 10ms / 11,620ms，5/5
  通过，artifact/runtime 如实 not-applicable，result applied。Elsewhere Goal 进入 **2/4**，并自动启动下一项
  progressive-intake Task `40854bb0-6f21-4e73-88bb-ff842e1b7c19`；当前不修改其已冻结 Contract，也不
  中断重启。
- **经济边界：** 原 Attempt usage missing；official cost、Worker Token、boundary reduction 与 direct
  Main Token savings unavailable。零 Worker reverify 的增量值可明确为 0，但不能据此反推整项 Main Token 节约。

无 commit / push。

## 2026-07-30 M1 Task Detail：FL-D256 活动碎片被独立关闭

- **问题与边界：** 真实 Relay Task 的底层审计记录包含 1,546 条 `worker.message` 传输事件，Hub
  “执行过程”把其中大量 token 片段显示成 `a`、`visual`、`check`、`390` 等“其他活动”。本轮只改
  Hub 的公开投影与可读文案，不删除 Store 证据，也不改变 daemon、CLI inspect 或 Worker 协议。
- **ForkLight 自举：** Task `05b5cfe2-e2c8-4477-b131-73dd740441d0` 只使用 xAI Grok 4.5 / Grok
  Builder。第一次 Attempt 17 turns，Main 审查后保留同一 Candidate，只针对“Candidate revision”文案
  过于技术化，以及非字符串 summary 可能触发不可信 `toString` 两个缺口，授权一次结构化 correction；
  第二次 Attempt 4 turns。没有 Competition、普通 retry、adaptation 或其他 Provider。
- **实现结果：** 新的公开时间线投影先滤掉 `worker.message`，再执行 80 条传输记录边界；页面最多保留
  40 条有意义事件。原始证据仍可由 Store/daemon/CLI 检查，Hub 只显示“Worker 已恢复”“已保存候选版本”
  “开始 Main 修复核验”等用户能理解的里程碑，不再拼接 token delta，也不把 payload 暴露到页面。
- **验收：** 最终 revision `1ee07903-f475-4bd9-8209-181bc1eedf6f`，patch digest
  `8e3f3ca40cfdeefcad7acf8973d922358a39767224d20a1ec5376436584000f8`；5 files / 390 combined
  changed lines。focused **131/131**、full **1,864/1,864**、build、两项 Hub JavaScript syntax 和
  diff hygiene 全绿。
- **Main 决策与 Integration：** Main 接受精确 revision；preflight
  `01ce8c15-d3c9-4fc7-8e2a-25092918f393` 零拒绝。Integration
  `3362bee9-d67c-47e8-90e1-e44fac89dce3` 四阶段为 12ms / 75,096ms / 4,388ms / 3,832ms，
  全部 passed 并 applied。Daemon PID `97553`、Hub PID `99446@58675`、CLI build
  `4dbe74de5dbed23be68db82b7a2b271c395abf6e0c0a12ad5ac70302328c018a` identity matched/current；
  自升级连续记录仍为 3/3 ready。
- **真实页面：** 同一 Relay Task 的 CLI 仍能看到 1,546 条 `worker.message` 和 29 条其他底层事件；
  Hub Process 实际显示 38 条可读里程碑，`其他活动` 为 0。桌面和 390×844 均无横向溢出，浏览器
  console warning/error 为空，Impeccable detector 返回 `[]`。
- **经济性：** 两次 Grok runtime estimate 合计 **USD 0.6258128**；两次 usage 都 missing，所以
  Worker Token、Provider 官方成本和 boundary reduction 不可用。Main exchange 只有低置信区间
  **854,485–5,188,736 Tokens**；没有 exact-pair direct-Codex baseline，不声明 Main Token 节约。

无 commit / push。

## 2026-07-30 M1 Task Detail：终态 Task 不再被旧 `running` Attempt 冒充为仍在执行

- **真实缺口：** Relay Task `5a34afb4-21f7-4b6d-92d6-99de36ec81b7` 已终态失败，随后由 Main
  保留成果、修复并独立核验交付；但其第 2 个 Attempt 数据行仍记录为 `running`。旧 Task Detail 因此可能
  让用户误以为 Worker 还在执行，与顶层终态和后续 Main remediation 证据冲突。
- **Grok-only 实现：** ForkLight Task `c0c352a1-198c-4469-9bf7-c69183c845be` 按 7 月 30–31 日策略
  只使用 `local-grok-builder` / Grok 4.5，无 Competition、其他 Provider、普通 retry、correction 或
  adaptation。一次 Attempt、24 turns，交付 5 files / 579 changed lines；时间和 Token 不设上限，
  文件/行数 5/650 只是 warn 质量边界。
- **产品行为：** Hub server 保留 raw Attempt `status`，另用父 Task 终态、精确 Attempt id、
  `worker.completed` / `worker.failed` 和安全整数 sequence 推导 locale-neutral presentation state。
  活跃父 Task、无 sequence、无终态事件或不匹配 Attempt 都 fail closed。Hub 的概览过程和“执行过程”标签
  复用同一展示逻辑，不把 raw `running` 当成主状态。
- **Main 审查与验收：** focused **127/127**、full **1,860/1,860**、build、两个 Hub JavaScript syntax
  check 和 diff hygiene 全部通过。Main 接受 revision
  `b111da4c-5efc-4aad-a012-315d6518681d`，patch digest
  `deb7e27fd1da5161a58b92cccb0cdd7e033d4aa0c0527c5fd364c060032736c5`。
  Integration `81c93c63-12ea-49dc-82dd-a3e32b678fe4` 四阶段为 13ms / 76,337ms / 12,399ms /
  9,741ms，全部 passed。当前 daemon `61996`、Hub `63081@58675`、CLI 使用 build
  `f29274dbc6ceac14ae407702d55e08a668ddde246047168fbe125fe7b772836a`，identity matched/current，
  M0 streak 仍为 3/3 ready。
- **真实浏览器：** Relay 记录在“执行过程”明确显示“第 2 次尝试 · Worker 完成后已结束”、
  “Worker 已报告完成；后续结果收尾步骤失败。”，并把“记录状态：执行中”降为辅助证据。桌面和
  390×844 均无页面级横向 overflow，console warning/error 为空；Impeccable detector 为 `[]`。
- **经济边界：** runtime estimate 约 **USD 0.6871252**。Grok usage 缺失，所以 Worker Token、官方费用
  和 boundary reduction 都 unavailable；27 条 receipt 的 Main exchange 仅为低置信
  **446,166–2,704,262 Tokens**。没有 exact-pair Direct Codex baseline，不声明 Main Token 节约。
- **FL-D256（后续已关闭）：** 同一真实页面曾把 Worker/工具文本拆成大量单词级“其他活动”。后续 Task
  `05b5cfe2-e2c8-4477-b131-73dd740441d0` 已在不删除原始审计记录的前提下，将 Hub 收口为可读里程碑；
  详见上方独立闭环记录。

无 commit / push。

## 2026-07-30 M1：Relay 看板用 Grok 交付，patch 捕获失败后不做第三轮

- **Task 与边界：** `5a34afb4-21f7-4b6d-92d6-99de36ec81b7`，Grok 4.5；只允许
  `src/app/board/page.tsx`、`src/components/board-presentation.ts`、
  `tests/board-presentation.test.ts`。展示模块只把现有状态、优先级和可选 Runtime 名称翻译成白话；页面继续
  使用既有打开事项与 `moveItem` 调用链，不触碰状态机、Store、API 或持久化。
- **有限执行策略：** 无时间、Token、文件或行数 hard gate；基础 Attempt 1、额外 Attempt 0、Main correction 1、
  adaptation 0。第一 Attempt 9 turns、3 files / 736 lines、机器验收 5/5；Main 只授权一次同 Candidate
  correction，没有 Competition、普通 retry、第三轮或参数自调。
- **Main 审查带来的修正：** 实际桌面与 390px 页面暴露常驻移动按钮低对比、目标小且卡片拥挤。纠正后移动操作
  默认折叠，展开目标为 32px 高整行按钮；阶段、解释、下一步、优先级、空列与迁移标签均为白话中文。
- **最终产品证据：** focused、目标 ESLint、完整 **327/327**、production build、diff hygiene 全绿；
  Impeccable detector `[]`。桌面/窄屏无页面级横向 overflow，console 无 warning/error。
- **Task 为什么仍是 failed：** Main 在 Candidate 中保留 dev preview，同时 build 清理 `.next`；daemon 捕获
  patch 时读取到刚消失的 `.next/dev/lock`，机器终态因此真实失败。冻结策略拒绝第三次 Attempt。Main 停止
  preview，将审过的三个文件写回 Relay，并以原 acceptance 做 remediation **5/5 passed**，记录
  `verified-repaired-delivered`；不反写 Task success，也不声称自动 Integration。
- **经济性：** 两次 Grok usage 都 missing；第一次 runtime estimate USD 0.2373016，第二次无完整估算。
  41 receipts 的 Main exchange 仅能给低置信度 **52,754–324,322 Tokens**；Worker 总量和 exact-pair
  direct-Codex baseline 均缺失，所以 Main Token savings 不可计算。

该样本证明“保留可用成果 + 一次定点纠正 + 失败后 Main 受控交付”能避免整单重跑，也暴露了后续应让
Candidate patch 捕获与生成目录清理相互隔离。没有 commit / push。

## 2026-07-30 M3：Grok 把统计明细改成显式深度审计

- **现场问题：** 旧 `forklight stats --json` 为 6 组汇总返回 70,659 bytes，其中包含 148 条逐 Task
  失败行，最长 diagnostic 2,000 字符。Hub 高频读取只用汇总，因此这是可量化的主线程边界浪费。
- **路由：** Task `3e32c9c0-997e-43ef-92ef-9f3e6ec077ed` 保存完整 class/family/routing decision，
  仅选择 `local-grok-builder / grok-4.5`；遵守 7 月 30–31 日 Grok-first，未启动其他 Provider 或竞争。
- **Main 纠正：** 第一 Attempt 19 turns、机器全绿，但非 JSON `--deep-audit` 会取回明细后丢弃。
  Main 记录 revise，复用同一 Candidate 和 11 个路径，只授权一次 7-turn correction；新行为在 daemon
  接触前拒绝该无效组合，并新增真实 CLI 进程测试。没有普通 retry、adaptation 或第二模型。
- **最终交付：** revision `b6c95eb1-67ef-41a6-80fd-b388bd486cba`，digest
  `abd017930ef9b35f990ad49497782e5b2faa0b7fbbee1925200bc2b0268ab3e4`，12 files / 599 lines；
  全量 1,783/1,783 tests、build、diff hygiene 通过。
- **真实效果：** compact 6,180 bytes，full 70,659 bytes，减少 64,479 bytes（**91.25%**）；所有
  aggregate 完全一致。默认 CLI/MCP/Hub 不携带失败行，`--json --deep-audit` 仍可取回完整 148 条证据；
  未搭配 JSON 的 deep audit exit 1 并在 daemon fetch 前停止。
- **self-upgrade 故障：** operation `e6ff5926-7369-4baa-b9b4-29f625ea9a2c` 留下 source-applied 后，
  旧 daemon 因等待管道断开触发 EPIPE，operation 恢复为 outcome-unknown。Main 没有补写虚假回执；在
  权威源码重新执行 `npm run check` 后重建、重启 daemon/Hub。当前 build
  `3b74df847131f367e8f93753ab43bad4dc26270fb602206d147556defe5a9f24`，Hub `55116@54505`
  current。该恢复缺口登记为 FL-D253，后续单独处理。
- **经济边界：** Grok estimates `0.622556 + 0.2703304 = USD 0.8928864`；两个 Attempt 都 usage
  missing，official cost 与 Worker Token unavailable。91.25% 是响应字节减少，不等于 Token savings；
  无 exact-pair baseline，不声明 Main Token 节约。
- **M3 状态：** routing coverage 真实更新为 `280 total / 166 class / 49 family / 4 complete`；统计链路
  更轻、更可解释，但 30–50 条真实代表样本出口仍 open，不靠循环重试追数。

无 commit / push。

## 2026-07-30 M3：Grok dogfood 补上 Worker 选择证据覆盖

- Task：`1f0888d5-2c65-44ea-a90e-aecff8f3d2ab`，只用 `local-grok-builder / grok-4.5`；遵守
  7 月 30–31 日 Grok-first，未启动其他 Provider 或 Competition。
- 第一 Attempt：30 turns，Candidate 已可复用；独立验收 284/287，失败为一个 TypeScript 未用泛型、一个
  em dash 约束和一处文案/测试矛盾。Main 另发现 decision-only 会高估完整证据，记录 `revise`。
- 纠正：复用同一 Candidate Revision 和 12 个路径，只给两个结构化 gap；第二 Attempt 7 turns。完整证据
  改为同 Task 的 `taskClass + taskFamily + routingDecision` 交集，并补 missing-class / missing-family 测试；
  保留裁判排除、只读边界、独立 polling 和双语解释。
- 最终验收：focused、syntax、`npm run check` 1,778/1,778、diff hygiene 全绿；12 files / 872 lines，
  files 12/10 仅 warning。Impeccable detector `[]`。
- Main 接受 revision `1a808b37-5ee9-40aa-9a09-c20af219449e`，digest
  `d20b977827b651825c5efcbdde665b2e91ea0dd41461ca934632029e29916789`。Integration
  `f6aa7ac4-7817-4dc9-99c9-b48b378d0810` 四阶段通过；build
  `94559414f2b7b25186a690f60475cc2a4d085c9c5d156ba4b8aff929b4704410`，Hub `49225@58263` current。
- 浏览器实证：中文/英文均明确说明“缺失记录不是模型结果，也不触发自动路由/竞赛”；真实计数
  `279 total / 165 class / 48 family / 3 complete`，129 种 type、14 种 family。桌面与 390px 无横向
  overflow，console 无 warning/error。
- 经济性：Grok estimates `1.2444696 + 0.43054 = USD 1.6750096`；usage missing，Worker Token 与
  official cost unavailable；无 exact-pair baseline，不声明 Main Token 节约。
- 结论：M3 可观察性缺口关闭，但 30–50 条代表性样本仍 open；不通过无休止重试追覆盖数字。

无 commit / push。

## 2026-07-30 M0：Grok 修复等待客户端断线导致的 Daemon EPIPE

- **根因：** daemon 对每个 socket 建立 readline 后直接异步 `socket.write`，socket 与 Interface 都没有
  连接级错误边界。客户端在长等待完成前消失时，EPIPE 冒到进程级并杀死 daemon，连带终止后台 Integration。
- **路由与执行：** Task `f2dff9cd-d1f8-4767-b69c-d21a76859f7c`，Grok 4.5 单 Worker；exact/family
  路由都无可比样本，按一骏 7 月 30–31 日偏好选择 Grok，未竞争。1 Attempt / 14 turns，3 files / 182
  lines，无 correction/retry/adaptation。
- **实现与验收：** transport 只把 peer reset、EPIPE 和不可写流当作该连接的 delivery loss；dispatch
  继续一次且不被重试或取消。真实 socket 测试主动断开异步 wait，并覆盖后续同 PID health、operation
  query、正常响应、应用错误响应和 bounded close。focused 133/133、full 1,784/1,784、build/diff 全绿。
- **Main 决定：** 接受 revision `aa578c59-2122-4c8a-a570-ffab0ac81ed4`，digest
  `fb1d9765ca56668984f4cd776abd77752e5271e099a92b4d3d57b932afdccc35`；没有为形式启动纠正 Attempt。
- **旧版自举失败保持真实：** Integration `65252e11-90e3-49f4-a70a-756704eb3986` 在旧 daemon 再次只到
  source-applied 后 EPIPE，记录仍是 outcome-unknown。Main 依据原合同在权威源码跑 1,784/1,784 后构建、
  重启；不补写四阶段成功。
- **生产断线证明：** 新 daemon PID `85536`、build
  `3835ea1f669a5bc3b61bdd865f783bd9f19cb0683305abd5832814c06c3dea91`；真实 1.2 秒 wait 在 40ms
  断开后 PID 不变、health 与 operation 查询成功、daemon log `12,624 → 12,624 bytes`。Hub
  `85748@50516` current。
- **边界：** 连接级根因关闭；真正进程被 kill 后从 source-applied 续跑仍 open。另发现
  `integration status/wait` 在切换窗口隐式 ensure/start 的 FL-D254，下一次移除观察命令的启动副作用，
  并完成一次新 daemon 的自动 self-upgrade，
  再重新封闭 M0。
- **经济性：** Grok estimate USD 0.5023152；usage/official cost/Worker Token unavailable；无 exact-pair，
  不声明 Main Token 节约。routing coverage 为 `281 / 167 / 50 / 5`。

无 commit / push。

## 2026-07-30 M0：Grok 完成只读观察、慢启动确认与四阶段自举（原始连续计数 1/3）

- **FL-D254：** Task `ff786c10-d31b-4335-8346-d68234e674dc` 把 Integration `status/wait/history`
  改为只连接已有 daemon；socket 在 activation 中暂时缺失时只返回有界重查提示，不再 ensure/start。
  第一 Attempt 唯一失败是测试夹具先写 result、后写被引用 receipt，SQLite FK 正确拒绝；Main 只授权一次
  5-turn 同 Candidate 纠正，没有改生产语义或放松存储约束。最终 revision
  `f329ac7f-31ae-43d9-addd-6abb7f0d8788`，digest
  `3762a49ea220346582ea58051f9a1cfae5a902854a399f01a6b0ba95373d04ed`，4 files / 372 lines；
  focused 43/43、full 1,789/1,789、build/diff/source compatibility 全绿。
- **无自启实证：** 新代码在隔离 home 依次执行三条观察命令后没有创建 socket 或 daemon log；真实 handoff
  期间观察命令也没有争抢 daemon。Integration `66ba9a77-f518-4a37-836f-043e2b70c316` 前三阶段通过，
  replacement daemon 实际启动，但固定 5 秒 readiness probe 先返回 ENOENT，runtime activation 如实保留
  failed，新增 FL-D255，而不是伪造成功。
- **FL-D255：** Main 先把配置化 activation 临时收口为一次 launch 后最多只读等待 30 秒；随后 Task
  `4337b194-117e-463a-b216-78c689159e7e` 仍只路由 Grok 4.5。1 Attempt / 14 turns、6 files /
  390 lines，无 correction/retry/adaptation/Competition/其他 Provider。实现将固定 5 秒改为默认 30 秒、
  CLI 可配置 1–600 秒的单次启动 readiness；观察 exact child 与 health，区分 early exit / timeout，
  不重复启动、不自动循环、不泄漏 private transport。self-upgrade Profile 使用 60 秒。
- **验收与 Main：** focused 154/154、full 1,795/1,795、build/diff/source compatibility 全绿；Main 接受
  revision `2a1a49b6-ab28-48f2-be58-1dae8bf52668`，digest
  `76abb89c82f5c3f2432f037bd62e53725675ec6c5c1260de060ca4e10f9cff7c`。
- **真实自举出口：** Integration `efa7d9ae-61c9-421a-a1b5-d427d9353a81` 四阶段全部通过：source apply
  7ms、source verify 159,664ms、artifact build 5,566ms、runtime activation 4,797ms；result applied。
  daemon `4447` 使用 build `d5bc42ca3262f4ddf8996d0789529b36578ff1f1e6c2efce126855ce00524e25`，
  Hub `8459@61089` current。FL-D253/254/255 的受控 handoff 子链路已闭环；但 `efa7...` 前一条仍是
  `66ba...` retained-failure，所以按原始连续出口规则当时只能计 **1/3**，不能称整个 M0 已重新封闭。
  真正 kill 后中间阶段恢复仍作为独立能力缺口保留。
- **经济与覆盖：** FL-D254 两次 Grok estimates 合计 USD 0.5868184；FL-D255 USD 0.3963564。三次 Attempt
  都 usage missing，因此 official cost、Worker Token、exact-pair Main savings unavailable，不做估算式宣传。
  routing coverage=`283 total / 169 class / 52 family / 7 complete`，distinct class 133、family 14。

无 commit / push。

## 2026-07-30 M0：Grok 把连续自升级证据做成产品能力，真实达到 2/3

- **任务与路由：** Task `44f2f5c4-bf1e-451c-828c-9ff3195430bb`，只使用 Grok 4.5，无 Competition 或其他
  Provider。目标不是再写一段文档，而是让 Store、Core、daemon、CLI 和 Hub 共用同一份权威 streak 计算。
- **产品行为：** 从最新 Integration 向后计数，只接受 source applied / verified / artifact built /
  runtime activated 四个阶段各一次且全部 passed；遇到首个失败立即停止。CLI 提供只读
  `forklight upgrade status`，Hub Overview 用中英文白话说明“完成几次、为什么中断、下一步是什么”；非法输入
  显示暂不可用，不暴露 raw error、路径或任意字符串。
- **部分成果复用：** Attempt 1 的实现主体可用，机器失败只是 em dash 违反现有 UI 规范。Main 合并机器原因与
  四个语义缺口，只做一次结构化 correction，沿用同 workspace/session。Attempt 2 已让 focused 287/287 通过，
  最后仅有两处 hostile-stage 测试夹具的 TypeScript cast 编译失败；Main 修复两行并调用 Candidate reverify，
  没有新 Worker、新 Attempt 或整单重试。
- **最终验收：** 原 4 条 acceptance commands 全过，focused 287/287、full 1,812/1,812、build、diff hygiene
  全绿。15 files / 1,755 lines 超过 12/1,100 的 warn 阈值，但质量优先，没有把软阈值升级为 hard gate，也没有
  自调参数反复循环。Main 接受 revision `343a1666-0bc3-461c-bf82-13dda3fe3743`，digest
  `9cb3b91d1e147811604e49d5123bafbdc0a4b891a2231d31340877283aac5120`。
- **真实自举：** Integration `ae49145f-544b-437c-a6c2-ac45cc97ba52` 四阶段耗时分别为 20ms、202,539ms、
  4,695ms、2,497ms，result applied。daemon/client identity matched，build
  `e8f46a1f0f8ca3fc9a37b74066abc014121bd54d9ae735f36d567b5793f2c94d`，Hub `82617@58675` current。
  新命令真实返回 **2/3**，还差一次连续成功；break operation 是 `66ba9a77-f518-4a37-836f-043e2b70c316`。
- **经济性：** 两次 Grok estimates 为 USD 1.7574904 + 0.6794208 = **USD 2.4369112**；usage missing，
  official cost、Worker Token、exact-pair Main Token savings unavailable，不做估算式宣传。

无 commit / push。

## 2026-07-30 M0：后台 Hub 换代实战通过，连续自升级达到 3/3

- **真实问题：** 上一次把 Hub 切到新 build 时，`hub restart --confirm --json` 虽然成功，但调用进程直接成为
  长期 Hub owner，终端不返回，`--json` 也不是有限机器结果。Task
  `cccf0978-1209-4adb-afdf-264be189cc93` 只路由 Grok 4.5，为现有前台模式增加显式 `--detach`，没有改 daemon、
  Provider、设置或默认生命周期。
- **执行边界：** 精确认证并替换旧 owner，等待资源释放，只 spawn 一个 argv-array child；默认保留旧端口，
  只在认证状态证明 current build 后返回。已经 current 时二次确认且零 signal/launch；early exit、timeout、
  ownership race 都 fail closed。timeout 不自动重试，也不建议用户在 child 仍可能启动时直接重试；公开 JSON
  使用固定原因，不转发内部 replacement 文本或 token/nonce/path/env/raw output。
- **纠正而非重做：** Attempt 1 为 20 turns，build 通过；失败仅是两个虚拟时钟测试用了低于产品 1,000ms 下限
  的 5ms。Main 同时补充 current 竞态、timeout 下一步和 replacement 隐私要求，授权一次同 Candidate correction。
  Attempt 2 只用 7 turns 复用全部 4 文件；没有 Competition、adaptation 或额外 Provider。
- **验收：** focused 120/120、full 1,837/1,837、build/source/diff 全绿。4 files / 1,456 lines 超过
  1,000-line warn，但大头是 lifecycle race 和真实 CLI 清理测试，不删测试换取形式通过。Main 接受 revision
  `2d53482b-1a74-44f9-a3b0-793c37e5344b`，digest
  `c7f6f93d05b83dee74b8d7d219eb9e8eb11f37c78684b1f91eca71c6ee9e4ce3`。
- **第三次真实自举：** Integration `17f77b1b-1098-4b36-930d-f030eb2cb40c` 四阶段 10ms / 83,865ms /
  4,027ms / 2,955ms 全部 passed，result applied。`forklight upgrade status --json` 返回
  `achieved=3, required=3, state=ready`，原始 M0 连续出口完成。
- **新能力生产 dogfood：** `hub restart --confirm --detach --no-open --startup-timeout-ms 30000 --json`
  在约 0.6 秒返回 ready；旧 PID `82617` 退出，新 PID `31252` 保持端口 `58675`，status current，`lsof`
  只有一个 listener，browserOpened=false。Daemon PID `28814`、CLI 与 Hub build 为
  `3403d90d38743589ac088ad5d9dcb71546062bb1ebd5955441584a98b6808d11`。
- **进程与边界：** 14 个 MCP 均有存活父进程（Codex 9、Grok TUI 5），不是可证明孤儿，未做破坏性清理；
  它们早于当前 build，宿主刷新前依赖自身 build-mismatch guard 或 matched CLI。真正物理 kill 后从中间阶段续跑
  仍是独立 backlog，不伪装为已解决。
- **经济性：** Grok estimates 合计 **USD 1.1146336**；usage missing，official cost、Worker Token、
  exact-pair Main Token savings unavailable。

无 commit / push。

## 2026-07-30 M1：Grok 实现、Main 纠偏并真实生成 clean-user bundle

- **Task 与路由：** `aabdc502-6660-45b7-b13d-542c0123fc04`，只使用 Grok 4.5；2 Attempts，唯一一次
  结构化 correction，无 Competition、adaptation 或其他 Provider。
- **实现：** `npm run bundle:clean -- --output <new-directory>` 在 sibling staging 中 pack、全量测试、SHA、
  tar 路径/敏感文件名扫描、隔离 global-prefix 安装、CLI、MCP initialize/list-tools、Hub/daemon exact identity
  与 PID 清理，最后原子发布四个文件。旧 schemaVersion 1 的 status、tarball、verification、limits 精确兼容。
- **Main 审查：** Attempt 1 的 focused 69/70、build 失败；纠正后机器验收通过，但 Main 仍发现 evidence 只是
  “近似兼容”且会删除预先存在的同名 source tarball，因此记录 revise，主线程有限修正后用零 Worker Token 的
  Candidate reverification 跑原命令 4/4。最终 revision `7cc68cf1-a511-4fc5-9626-ef38dae83745`，digest
  `4f231ffcd276b790123ed174bdb160502562c351f6ec887bba56d1585e742dd4`。
- **自动 Integration：** operation `ae9178c9-5979-4d60-88c3-4165ab7d0828` 的 source apply / verify /
  artifact build / runtime activation 为 9ms / 67,607ms / 3,350ms / 2,496ms，全部 passed。
- **真实 dogfood 的三次安全失败：** 第一次证明空 `HOME` 会让 Keychain readiness 相关全量测试失败；第二次
  证明 prepack 内合法 JSON 会干扰首个 JSON 解析；第三次证明 local install 与 global-prefix 查找不一致。
  三次都在 publication 前退出，目标始终不存在，staging 和 owned process 均清理。Main 分别修正 pack/installed
  两类 home 边界、final outer JSON 选择和 `npm install --global --prefix`，没有再次调用模型或无限重试。
- **最终实证：** `/Users/Shared/ForkLight-Clean-Run.E395854A-7973-4393-9247-BE59A177505E` 只有 tarball、
  build identity、runbook、external evidence；1,857/1,857，SHA
  `2831ef6b34acda6b44e784492ae553d03e491c4c1d498878f2bd43635b227462`，build
  `5a6fe6c12f74fdf8453eeef08302997c73247c1c626adb0e034dc6199be366bb`。独立 SHA/identity/privacy/process
  审计通过。daemon `28398`、Hub `28592@58675` matched/current。
- **未完成边界：** 仍需真实新用户/VM/Mac 跑首次 Keychain、Main 安装、理解问答和计时；当前只是 ready for
  clean-user run。Worker usage 两个样本都 missing，exact-pair baseline 不存在，不声明 Main Token 节约。

无 commit / push。

## 2026-07-30 M1：相邻本地 SDK 隔离修复，并复用原 Elsewhere Candidate 完成真实合入

- **真实阻塞：** Elsewhere 根 `package.json` 明确声明
  `file:../adeptify/adeptify-next/client-core/ts/sdk`。Task
  `e2726546-07de-4e78-9ff0-8dcaf8bcd25a` 的 Candidate 已通过 5/5 独立验收并被 Main 接受，第一次
  Integration 仍在临时目录中因缺少这个兄弟 SDK 失败并自动回滚。Candidate 本身无须重做。
- **ForkLight 自举修复：** Task `ef5d9f00-5d2d-4cec-ac89-97d97d2a7436` 只使用 Grok 4.5，1 Attempt /
  21 turns、8 files / 1,036 changed lines，无 Competition、retry、correction 或 adaptation。实现只读取根
  manifest 明确声明的相对 `file:` / `link:` 包根，在单次 Task 或 verification 容器中按相同相对关系本地
  clone/copy；绝对路径、逃逸、缺失、非目录、缺 package manifest、冲突和 malformed manifest 全部
  fail closed。baseline、Candidate Diff、源码依赖和 Integration authority 均不包含镜像。
- **验收：** focused 150/150、full **1,869/1,869**、build、Hub syntax 和 diff hygiene 全绿。Main 还用
  Candidate 代码直接复制当前 Elsewhere：SDK 存在、`pnpm typecheck` 通过、原 SDK 字节未变、完整临时容器
  已删除。没有再启动形式性裁判 Worker。
- **自动升级：** Main 接受 revision `6d380214-37fe-4d1e-b566-8808197e3b9c`，digest
  `8ee0619ae9c47032b44d55acf39be2023bb0a9f5705c19f827e43ba214a806ae`。Integration
  `9264d118-ecbd-458b-9d2d-f982b18dfe07` 四阶段 12ms / 78,971ms / 4,558ms / 2,709ms 全部 passed。
  CLI 与 daemon 切到 build `c80dca895185adaea3efc2ff32257aea5b541af9e67b2fc6cd9db6f8bddd1d81`；随后
  detached Hub restart 复用端口 `58675`，PID `27564`，status current，没有新增第二个 Hub。
- **原 Candidate 复用实证：** 同一个 Elsewhere accepted digest `17821b0fc2ce` 重新 preflight 后，Integration
  `7fdbec6b-d122-4bb4-b4b4-b9263146fd65` 的 source apply 与 5 条 source verification 全部通过，result
  applied。没有新 Worker、Attempt、Candidate 或手工补丁。Goal 自动把 `structured-intake` 标记为 1/4
  satisfied，并启动 `shell-drawer`。
- **FL-D256：** 上述普通 Elsewhere Integration 随后把 `upgrade status` 错误重置为 0/3。历史三次自升级
  事实仍在，但现有计算读取所有项目 Integration；普通 App 的 artifact/runtime 阶段本应 not-applicable，却被当成
  自升级中断。权威投影必须按 receipt 中明确的 `forklight-self-upgrade` 交付身份筛选：其他项目既不加分也不清零，
  同身份的失败仍必须中断。修复前不再宣称当前 3/3 展示可信。
- **经济性：** Grok runtime estimate 约 **USD 0.79965**；usage missing，因此 Worker Token 与 official
  cost unavailable。复用 Elsewhere Candidate 的第二次 Integration 新增 Worker/model Token 为零；仍无
  exact-pair Direct Codex baseline，不声明 Main Token 节约。

无 commit / push。

## 2026-07-31 M3：DeepSeek + Main 完成 Hub 人话信息架构第一刀

- **目标与合同：** Task `4afdcd84-1068-4f0a-87ec-6252a0386d4c` 使用
  `deepseek-v4-pro[1M]`，按 `docs/m3-hub-human-information-architecture-contract.md`
  重组 Overview 与 Task Detail。信息没有被简单删除，而是按“现在发生什么、哪里需要关注、Main 要了什么、
  Worker 回了什么、独立检查发现什么、最终交付或下一步是什么”重新排序。
- **保留成果、有限纠正：** DeepSeek 第一 Attempt 82 turns，第二 Attempt 72 turns；Main 保留同一 Candidate，
  只做一次结构化 correction。最后针对一个过宽失败噪声过滤器做 Main 有界修正，并用零 Worker Token 的
  Candidate reverification 跑原六条命令，6/6 通过。接受 revision
  `4d9de8e4-d4f4-4202-8701-4ea0286f3607`，digest 前缀 `370200f`。
- **Integration 的真实结果：** 第一次 operation
  `76ced6f1-8fa7-4501-bcc5-6a421a55f182` 在 source verification 遇到一个满载下的 daemon 等待计时失败，
  自动回滚六个文件。相关文件单独 14/14 通过；Main 没有重跑 Worker，只授权一次同 Candidate Integration。
  第二次 operation `601f3f86-f62c-46cb-9794-7b8741315193` 四阶段全部通过。
- **真实 UI 验收：** Overview 首屏现在先显示实时状态、需要关注和正在做的工作。Task Detail 用四段式解释输入、
  Worker 输出、独立验收和最终产出。失败 Gmail Task 已从 `^`、npm 命令头和内部运行目录，收敛为
  `src/adapters/connectors/gmail.ts:96:21: ERROR: Expected ">" but found ";"`。
- **测试边界：** Hub focused **195/195**；最终 full build 成功、**1,942/1,944**，仅两个未改动的
  `tests/daemon-cli.test.ts` 满载计时断言失败。该文件单独 **14/14**，相关场景 934ms。没有循环重跑全量来
  制造绿灯。
- **运行态：** Daemon build
  `c0f93354d802aafc356a4fce22d3187185cba0d3ad00f55cfe3bd90a0ffda93f`；Hub PID `62481`、port
  `58675`、status `current`。升级连续证据诚实记录为 **1/3**：前一次自动回滚打断旧连续记录，成功 retry
  开启新记录。
- **下一刀：** archive/lineage、任务依赖看板、失败/成本/模型能力长期统计继续进入 M3；不为了追数字循环重试。

无 commit / push。

## 2026-07-31 M3：DeepSeek + Main 让“有记录”与“能公平比较”分开

- **为什么做：** M3 已达到 30 条新格式选择记录，但“记录完整”只能证明以后能学习，不能证明历史里已经有
  同类 Worker 的公平对照。Task `2d95e5ed-1f93-4daf-90ec-87a8f5faca3c` 按
  `docs/m3-routing-decision-readiness-contract.md` 补上这层解释，不改路由算法、不发 Provider 探测，也不制造
  Competition。
- **路由：** exact/family 查询对 DeepSeek 与 Volcengine GLM 都返回 scope `none`、0 样本、unknown，
  Competition=false。Main 依据最近相邻交付的纠正成本选择 `deepseek-v4-pro[1M]` 做一个 Worker；这不是永久
  模型判决。1 Attempt / 75 turns，6 files / 704 changed lines，无 correction、retry、adaptation 或 Competition。
- **实现：** 每条完整决策只读其创建时冻结的 shortlist 与 evidence scope，进入且只进入一种结果：单 Worker、
  可比较多 Worker、未知多 Worker、不可用。可比较必须是至少两个不同的 Worker 身份并具备 exact-class 或
  task-family 证据；混合坏条目、空字段、重复身份或坏 scope 全部 fail closed。Hub 用中英文先讲“记录是否完整”，
  再讲“当时是否具备公平比较条件”，不展示胜者或自动路由权威。
- **部分成果复用：** Worker 主体可用，初始机器失败是新增 UI 区域的 em dash 检查。Main 保留 Candidate，补齐
  malformed/duplicate/scope 语义并调整人话文案。唯一一次零 Worker reverification 又捕获一个“单 Worker 是否
  有意”的文案断言，4/6；额度按冻结策略如实消耗。Main 修正最后一句后没有再启动模型或扩张重试额度，而是在
  Candidate 上通过 2,018/2,018、build、syntax 与 diff hygiene。
- **安全合入与最终证据：** 6 个目标源码文件逐一证明仍与 Task baseline 字节一致后，Main 应用完整 Candidate；
  权威源码再次通过 **2,018/2,018**、build、syntax 与 diff。随后 ForkLight Main remediation check
  `625a5d05-16e1-4829-92a5-6c59cc94c749` 跑原 6 条命令，6/6 passed，交付标记为
  `verified-repaired-delivered`，同时保留 Task/Attempt 的原始 machine-failed 事实。
- **真实结果：** 当前投影 `315 terminal / 201 class / 83 family / 31 complete`；31 条中
  `13 single / 0 comparable / 18 unknown multi / 0 unusable`。因此 M3 已越过 30 条记录门槛，但还没有任何
  可诚实称为公平 Worker 对照的 cohort。下一步积累自然同类任务，不回填、不猜测、不为数字重跑。
- **Hub 验收：** detached Hub 复用 `58675`，PID `93421`，中文和英文 Insights 都展示相同四类结果与限制；
  浏览器 console error 为 0。Daemon PID `77255`，build
  `68e9971f05e00fc538d1dcb4364cf4556135db81a394c3d0f8005ee18efe7c82`；M0 streak 仍为 3/3。
- **经济性：** gross Worker Tokens **5,622,247**，其中 cache-read **5,484,544**；DeepSeek official quote
  **USD 0.095490127**，runtime estimate USD 4.152987，usage reconciliation matched。边界范围
  4,016,547–5,359,978 Tokens 只是 Worker 工作量减去编排交换估计；exact-pair Direct Codex baseline 缺失，
  不声明主线程实际节省。
- **dogfood 新发现：** Candidate reverify 在 CLI 普通 Task status 中途仍显示原 terminal 状态，只有事件序列能说明
  复验尚未结束，容易让 Main 误判已收口。该观察进入后续监督体验 backlog；本刀不在同一轮继续改参数或扩范围。

无 commit / push。

## 2026-07-31 M3：后续本地复验不再被 terminal 状态遮住

- **问题来源：** 上一轮真实 Candidate reverification 期间，Task status 按设计保持 terminal；普通 `status` 与
  `wait` 因而立即显示结束。Main 可能误以为没有工作在跑，再启动重复复验、修复或 Worker，既增加成本，也破坏
  “保留部分成果”的主线。
- **路由与执行：** exact/family evidence 对 DeepSeek 与 Volcengine GLM 都是 0、scope none；策略没有触发
  Competition。Main 只选择 `deepseek-v4-pro[1M]`。Task
  `67d1e9f5-7a67-4942-a3a9-546d94d6391d` 为 1 Attempt / 80 turns，没有 retry、Competition、adaptation 或第二
  Worker。
- **实现结果：** ordered-event reducer 只把最新 unmatched
  `candidate.reverification.started` 或 `remediation.check.started` 投影为打开的后续检查；对应 completion 才闭合。
  Candidate 的 verification command / completion / revision evidence 会更新活动时间。原 Task status、Board lane、
  headline、failure 与 Main/delivery truth 不变。latest-only 无法证明完整 start/completion 配对时保持 terminal，
  quiet 只说尚无完成记录，不推断进程生死。
- **wait 与 Hub：** CLI wait 从 Store 完整事件构造 live stage，MCP wait 复用 Decision View；terminal wait 会等后续
  检查 completion 或 caller timeout。Hub Board 和 Task Detail 用中英文说明这是本地 Candidate 复验或 Main 修复
  验收、不会再调 Worker，原结果未改变。
- **真实失败与有限修正：** Worker 写的两个 timeout 测试没有推进 fake clock，focused 和 full 都进入 CPU 空转；
  Main 只终止两个隔离验收进程，不等待无上限任务永远自愈。Candidate 被完整保留，原 machine-failed 事实仍在。
  Main 修正测试时间、exact optional build、活动 evidence freshness 和 Hub wording precedence，不再调用模型。
- **最终验收：** Candidate reverification 新增 Worker/model Token 为 0，6/6 通过；focused **199/199**、full
  **2,039/2,039**、build、Hub syntax、diff hygiene 全绿。revision
  `115516c2-c25d-461e-b957-5f7a8946507d`，digest
  `5f5b7b7436020a8db92601d112a516f46004d0f167f4e3040190a5fecaf1196c`。
- **自动 Integration：** `bcd1b382-18f7-439b-aed5-3115d1d7cb34` 四阶段 13ms / 79,826ms /
  4,991ms / 4,706ms 全过。daemon/client identity matched，build
  `42a8643b8f031b31c430098221ff714ef2b5acdfcf5d38f37d636d06c9808bb4`，source digest
  `4cd9f05896d336346f365fed5b7fa5df87ddaa5084d1153dc820d3a2b6036602`。Hub 安全替换为
  `3602@58675` current，线上 app/i18n 资源包含新阶段与独立中英文解释，页面 console 无 warning/error；M0 streak
  **3/3 ready**。
- **经济性：** Worker gross **10,363,825 Tokens**，cache read **10,154,240**；DeepSeek official
  **USD 0.146995055**，runtime estimate USD 6.999365，reconciliation matched。29 receipts 的边界范围
  9,107,605–10,158,283 Tokens 只是 Worker volume 减编排交换估计；没有 exact-pair Direct Codex baseline，
  不声明真实 Main Token 节约。

无 commit / push。
