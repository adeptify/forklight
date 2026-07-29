# M1 真实任务候选池

更新时间：2026-07-29

这份候选池服务于 M1.4：ForkLight 必须在 Adeptify、Dia 和
NovelRPGPlay 中完成至少十个具有代表性的真实任务。它不是为了制造成功率，
也不是对三个项目的产品优先级排序。任何候选只有在一骏确认范围后才能启动。

## 共同执行规则

- Main 负责确认目标、边界、输入、输出、调用链和验收方式；Worker 不自行扩大范围。
- 默认一个任务只启动一个 Worker，不做轮流使用模型或默认竞争。仅在高不确定性、
  关键任务、新任务类型或一骏明确要求时竞争。
- 文件数、代码行数、Token 和时长默认是可配置的策略信号，不是通用成功定义。
  安全权限、原项目隔离、独立验收、Main Review 和合入确认仍是硬边界。
- Worker 留下部分可用成果时，Main 优先保留候选并只修剩余缺口；不整单重跑，
  不用相同参数重复撞同一种失败。
- 当前三个项目都有真实进行中的工作。提交前必须重新检查目标文件是否变化；
  与当前本地改动重叠时停止，不用 ForkLight 覆盖用户工作。
- 每个任务保留首次机器结果、Main 决定、候选复用方式、纠正成本、最终交付、
  失败分类和下一步。失败可以成为有效样本，但不能被包装成成功。

## 当前准入结论

| 项目 | 当前事实 | 准入处理 |
| --- | --- | --- |
| Adeptify | Nexus AI runtime 正在进行一轮真实编码闭环修复，工作树有未提交改动 | 只选不触碰当前 `rethink`、executor、context prompt 和文件 Tool validation 的任务 |
| Dia | 历史目录 `/Users/yijunwang/code/dia-ng-src` 当前不存在 | 等一骏提供新路径后重新审计；不从历史快照或猜测目录启动 |
| NovelRPGPlay | 生产、模型连接、故事门禁、工坊 UI 和多组测试正在大范围迭代 | 优先选择当前干净的协议、服务和独立流程；重叠任务暂缓 |

### 2026-07-29 晚间 source-drift 复核

本表不能按早先结论直接启动 Worker。Main 在提交前重新检查了真实目录、工作树、目标调用链和
既有验收，得到以下更新：

- **Dia 路径失效：** `/Users/yijunwang/code/dia-ng-src` 当前不存在，在一骏提供新路径前，D1–D3
  都停止，不能从历史快照或同名猜测目录启动。
- **A1 需要重新定义：** 两条原聚焦测试当前已经 **16/16** 通过，`commandReceipts` 的创建、持久化、
  恢复和投递状态也已存在；真正剩余缺口更可能是产品 UI 没有消费这份回执。同时 Task Synthesis、
  Session projection 和 Nexus UI 正在被其他工作修改，因此不能按旧合同派 Worker。若继续 A1，
  必须先对齐为“让用户在 Task Board 看见权威命令结果”，并在当前改动收口后重做 focus paths 和 UI
  行为验收。
- **N3 已成为现有能力：** 当前基线已经证明公共主线发布不会自动移动房间、普通成员无权升级、
  房主必须显式安装新 Release；Rooms UI 也会分别告诉成员等待房主、告诉房主升级会保留角色和进度。
  `desktop-service-cross-layer-e2e` 覆盖两个身份的完整发布与显式升级链。重复提交 N3 只会制造重复代码，
  所以它从“可准备”改为“基线已实现，不计 ForkLight 新交付”。
- **其余候选仍重叠：** A2/A3 与当前 Session/File Tool 改动重叠；N1/N2/N4 与 portable review、
  personal action、连接健康和生产恢复改动重叠。它们保持暂缓或先对齐，不能为了凑 M1.4 数量启动。

因此当前没有一个旧候选同时满足“目标仍未实现、边界不重叠、方案已由一骏确认”三个提交条件。
下一步应由一骏在更新 Dia 路径、等待 Adeptify 当前链路收口后重做 A1，或为 NovelRPGPlay 选择一个
新的干净用户结果之间做产品优先级选择。此准入停止不算 Task 失败，也不会产生 Worker Token。

状态含义：

- `可准备`：边界足够清楚，重新核对目标文件后可生成正式 Task Contract。
- `先对齐`：需要一骏确认体验或范围选择，不能直接启动 Worker。
- `暂缓`：与正在进行的本地改动重叠，当前启动会制造冲突或重复投入。

## 十个候选任务

### A1 · Adeptify：命令执行结果真正进入 Task Board

**状态：暂缓并重新对齐。原核心测试已 16/16 通过，剩余 UI/Projection 链与当前工作重叠。**

- 用户结果：Nexus 运行 `npm test` 等命令后，Task Board 能显示执行了什么、退出状态、
  结果摘要和对应回执，不再出现命令真实执行但 `commandReceipts` 为空。
- 输入与调用链：Command Owner 产生回执 → `run-command-receipts` 保存 → Run record / 
  Task Board projection 消费 → UI 后续读取同一权威结果。
- 输出：持久化投影修复、正反例测试；不改变命令授权、Shell 能力或 Provider 行为。
- 边界：不修改当前活跃的 ReAct、executor、context prompt 和文件 Tool validation 文件；
  不把命令输出全文复制到不受控字段。
- 验收：
  `cd adeptify-next/client-core/ts && npx vitest run tests/ai/task-command-run-idempotency.test.ts tests/ai/task-board-run-record-boundary.test.ts && npm run typecheck && npm run typecheck:tests`。

### A2 · Adeptify：重启后回到真正需要处理的 Session

**状态：先对齐。建议 Worker：MiniMax，单 Worker；Main 做真实 UI 验收。**

- 用户结果：应用重启后优先回到最近仍在执行或等待确认的 Session；已经完成的审批卡
  不再可点击，终态 Run 不再显示“响应尚未结束”。
- 输入与调用链：持久化 Session/Run/PendingInput → 启动恢复服务 → Session 选择 →
  Drawer 和审批卡状态。
- 输出：确定性的恢复选择规则、终态 UI 清理、恢复与组件测试。
- 需要对齐：如果同时存在多个活跃 Session，是自动打开最近一个，还是先显示恢复列表。
- 边界：不改变任务执行语义，不自动批准或重放副作用，不删除历史 Session。
- 验收：Shell 的 `session-service`、`execution-restore-integration`、`session-drawer`
  聚焦测试，以及 production/test typecheck；Main 另做一次真实重启观察。

### A3 · Adeptify：文件修改审批跨进程恢复

**状态：暂缓。当前文件 Tool validation 正在被其他工作修改。**

- 用户结果：文件修改预览后即使应用重启，也能安全恢复；若原预览不能继续，界面明确要求
  重新授权，而不是显示仍可审批后才报 `FILE_EDIT_PREVIEW_EXPIRED`。
- 输入与调用链：Rust File Owner 预览 → durable preview identity → PendingInput/审批卡 →
  重启后的 inspect/confirm。
- 输出：可恢复的非敏感预览身份或明确 reauthorization 状态、跨重启测试。
- 边界：不持久化密钥、原始模型 Prompt 或未经授权的文件内容；不得自动执行旧副作用。
- 验收：`createShellFileMutationOwners`、file-mutation HIFI、pending confirmation recovery
  聚焦测试，以及 Rust/TS typecheck。

### D1 · Dia：旧服务请求失败不再伪装成空数据

**状态：路径失效。提供新的 Dia 项目路径后重新审计。**

- 用户结果：数据源接入遇到 401、网关错误或三种历史响应格式时，用户得到正确跳转、
  明确错误或真实数据，不再把服务失败显示成“没有内容”。
- 输入与调用链：数据源页面 → `requestLegacy` → 旧服务响应适配 → 页面状态/toast。
- 输出：统一响应解包、401 登录跳转、错误归一和可独立运行的响应契约测试。
- 边界：不改后端业务，不猜测未知响应为成功，不写真实 SSO 凭据。
- 验收：`cd frontend && npm run lint && npm run build`，加上新适配器契约测试；
  Main 在已登录环境做一次不带凭据泄漏的浏览器验收。

### D2 · Dia：编辑历史问题后安全截断旧回答

**状态：路径失效；原交互选择仍需对齐。提供新路径后重新审计。**

- 用户结果：用户编辑一条历史问题后，旧问题之后的回答不会继续冒充当前上下文；
  页面明确确认影响范围，并从新问题继续对话。
- 输入与调用链：消息编辑 UI → PATCH message → `MessageEditService` →
  `softDeleteAfter` → reload messages → 新一轮发送。
- 输出：后端原子更新、前端确认交互、后端服务测试和主链路回归。
- 需要对齐：编辑保存后是自动重新发送，还是只保存并让用户再次点击发送。
- 边界：不物理删除审计数据，不影响编辑点之前的消息，不顺手重做整个 Chat。
- 验收：`cd backend && mvn test -Dtest=MessageEditServiceTest,P2FullChainE2ETest`；
  `cd frontend && npm run lint && npm run build`。

### D3 · Dia：对话回放成为清楚的只读页面

**状态：路径失效。提供新的 Dia 项目路径后重新审计。**

- 用户结果：打开 `/playback/:convId` 能按顺序阅读对话，没有输入框；不存在、加载失败和
  空对话都有能看懂的提示与返回动作。
- 输入与调用链：URL → playback loader → ConversationPlaybackPlayer → 空/错/成功状态。
- 输出：独立路由、只读展示、错误和返回路径，不改普通聊天页。
- 边界：不开放消息编辑，不绕过现有服务权限，不把内部错误堆栈直接给用户。
- 验收：`cd frontend && npm run lint && npm run build`；Main 验收有效、空、非法三个 URL。

### N1 · NovelRPGPlay：无剧透委托边界的反向证明

**状态：暂缓。portable review 与 story protocol 目标文件正在修改。**

- 用户结果：房主把生产委托给制作人后，房主、玩家、制作人和复核者只能看到各自允许的
  材料；越权读取在进入 UI 或传输前被拒绝，并给出可理解原因。
- 输入与调用链：Story Release 的 spoiler envelope → 协议校验 → portable review exchange
  → 本地委托流程和展示。
- 输出：角色资源矩阵的正反例、重复/冲突 envelope 测试和稳定错误分类。
- 边界：不运行真实模型，不修改小说正文，不放宽正式审核或 hash 绑定。
- 验收：`node --import tsx --test tests/story-protocol.test.mjs tests/portable-review-exchange.test.mjs && npm run boundaries:check`。

### N2 · NovelRPGPlay：第二玩家的个人行动互不污染

**状态：先对齐。高层 reader flow 当前干净，但底层 derivation 正在修改。**

- 用户结果：两个隔离玩家对同一故事采取不同个人行动后，只能看到自己的下一章；
  撤回、恢复、重启和断网重试都不会污染主线、另一玩家或多人对比。
- 输入与调用链：ActionIntent → 本地 derivation owner key → 私有 edition → reader flow →
  withdraw/restore/retry。
- 输出：第二身份隔离场景、跨重启与失败恢复测试，以及必要的最小修复。
- 需要对齐：先只完成确定性隔离与恢复，还是同时执行第二个真实模型验收。
- 边界：不改人格差异目标，不把自由输入写入服务端，不触碰当前文学生产修订链。
- 验收：personal-action reader/derivation 聚焦测试、product lifecycle 回归和边界检查。

### N3 · NovelRPGPlay：公共主线更新必须由房间主动切换

**状态：当前基线已实现，不再启动重复 Worker，也不计作新的 ForkLight 交付。**

- 用户结果：公共主线发布新版本后，旧房间收到“有更新”通知但继续留在原版本；只有房主
  明确确认后才切换，其他成员能看懂发生了什么。
- 输入与调用链：本地 mainline candidate → 治理批准/不可变 Release → server-domain
  发布 → room notification → Rooms UI 的显式升级动作。
- 输出：版本可用状态、显式升级命令、幂等与权限测试、通知文案。
- 边界：不自动升级，不修改旧 Release，不运行真实故事模型，不顺手改变房间奖励规则。
- 验收：server-domain、server-http、room-notification-policy、desktop-service-cross-layer
  聚焦测试，`npm run boundaries:check`、`npm run desktop:check` 和 `npm run server:check`。

### N4 · NovelRPGPlay：模型尚未调用时不显示为正在生产

**状态：暂缓。相关连接健康、生产活动和恢复文件正在本地迭代。**

- 用户结果：应用等待 macOS 钥匙串授权时显示“等待本机授权，尚未调用模型”；只有授权
  成功并准备发请求后才创建 running 凭证和增加 attempt。拒绝或超时后给出明确恢复动作。
- 输入与调用链：connection health → Keychain presence/read authorization → production start
  → activity/run credential → UI presentation。
- 输出：阶段状态、拒绝/超时恢复、没有虚假 attempt 的测试。
- 边界：不读取或记录 Key，不把系统授权失败算成模型失败，不自动反复弹授权或重试模型。
- 验收：model connectors、local production runs/request timeout、production presentation 聚焦
  测试，以及 desktop check 和 native Rust 测试。

## 覆盖检查

| M1.4 要求 | 候选覆盖 |
| --- | --- |
| Adeptify 至少 2 个 | A1–A3 |
| Dia 至少 2 个 | D1–D3 |
| NovelRPGPlay 至少 2 个 | N1–N4 |
| UI / 交互 | A2、D3、N3、N4 |
| 后端行为 | A1、D2、N3 |
| Bug 修复 | A1、D1、A3、N4 |
| 测试 / 可靠性 | A2、N1、N2、N4 |
| 跨模块 | D2、N2、N3 |

这十个候选满足类型覆盖，但不代表已经完成 M1.4。三个 API-key Worker 已通过一次
受控 Daemon 重启保持可启动，下一道门是 clean-user journey。每个候选仍要在提交当天
重新做 source drift 检查并由一骏确认方案；没有确认的候选不得为了推进数字而启动。

## Relay 额外实践样本

一骏在 2026-07-29 明确选择 `/Users/yijunwang/code/relay` 作为 M1.4 的额外
dogfood 项目。它用于尽早验证真实项目的任务拆分、部分成果复用、Main 审查和用户可读性，
不会静默改写上面 Adeptify、Dia、NovelRPGPlay 的既有退出要求。

### R1 · Relay：执行详情让用户看懂输入、过程、结果与下一步

**状态：已完成目标代码与真实浏览器验收；不计作 ForkLight 自动 Integration 成功。**

- 用户结果：Item Detail 先显示 Main 派发给 Worker 的任务输入，再说明当前阶段、已知结果和
  下一步；原始日志退到可折叠的“技术日志”，避免把机器信息罗列当作解释。
- 输入与调用链：Job / Assignment / Runtime → pure presentation mapper →
  `ItemDetail` 执行区和人工验收区。
- 输出：`job-presentation.ts`、Item Detail 最小接线和独立语义测试；没有改 API、Schema、
  状态机、Connector、Team 或合入授权。
- 实际模型路径：MiniMax-M3 首次 Attempt 留下可用结构但语义验收失败；DeepSeek
  `deepseek-v4-pro[1M]` 重做并在同一 Task 内做一次 bounded correction。
- Main 结论：纠正后的目标行为测试 10/10、目标文件 ESLint 9、diff hygiene 和真实浏览器
  running / pending-review 两种状态通过。Main 只把审查过的三个目标文件写回原项目。
- 未通过事实：Task 仍为 machine-failed。全局 TypeScript/build 被同时开发中的
  `src/team/postgres-store.ts` 可选 `pg` 依赖与类型断言阻断；全量测试在现有并发工作树中
  超过两分钟仍未终止。ForkLight Integration 因终态失败正确拒绝，没有绕过。
- 经验：软 change budget 不能在 Worker Prompt 里写成 hard；`maxMainCorrections=0`
  会失去最便宜的部分复用路径；同一 Task 的 retained Candidate correction 可用，
  跨 Task Candidate 读取目前会遇到权限边界；验收合同需要区分目标行为与仓库基线，
  同时保留全局兼容性为独立证据。

### R2 · Relay：真实验收交给 ForkLight，执行策略继承 Worker Profile

**状态：Worker 机器验收、ForkLight Integration、Main 定点修正和真实浏览器验收均完成。**

- 用户结果：选择 ForkLight 后，Relay 只要求用户写任务、工作区和真实验收命令；Provider、
  model、预算、Token、时长和文件/行限制不再由 Relay 写死，而是继承 ForkLight 保存的默认
  Worker Profile。
- 输入与调用链：`AssignPanel` → local API → `RelayServices.assignItem` 预持久化门 →
  `DispatchInput` → ForkLight Task builder → `forklight validate/submit`。
- 安全边界：验收为空或只有 `true`、`:`、`exit 0` 等无效命令时，在创建 Assignment/Job 和
  Worker Token 消耗前拒绝；错误不回显命令内容。非 ForkLight Runtime 保持原行为。
- 实际模型路径：DeepSeek `deepseek-v4-pro[1M]`，一次 Attempt，无竞争、自动 retry、
  correction 或 adaptation。候选为 12 files / 807 changed lines，独立验收通过。
- Main 结论：A8 原有 ForkLight retry 覆盖没有被换成 Demo Runtime。Main 发现
  `workerProfileId` 层级和 builder defense-in-depth 两个缺口；最终由 Main 做定点修正，
  64/64 目标测试、目标 ESLint、diff hygiene 和真实 Relay dry-run UI 全部通过。
- 真实 UI：验收为空时“委托 ForkLight”不可用；填入真实命令后才可提交；dry-run 明确显示
  “只校验、未创建真实 Worker 任务”，没有把 validate 伪装成 Worker 成功。
- 工作流缺口：机器成功后 Main 记录 `revise`，但该 Task 的额外 Attempt 和 adaptation 都为 0；
  当前 ForkLight 同时拒绝 `revise`、`correct` 和 `resume`。这证明“成功 Candidate 的 bounded
  Main 修订”还没有可用承接路径，后续应允许复用同一 Candidate 的一次受限修订，而不是逼迫
  Main 接受后人工修复或重建整单 Task。
- 经济性：Attempt 使用 **3,312,977 gross Worker Tokens**（67,438 input、37,859 output、
  3,207,680 cache read）；Main exchange envelope 为 **1,309–7,800 Tokens**。没有
  exact-pair direct-Codex baseline，因此不把差值称为“节约的 Main Token”。

### R3 · ForkLight：成功 Candidate 可承接一次 Main 纠正

**状态：功能、全量验收、自动 Integration 和运行版本切换均完成。**

- 用户结果：机器检查通过但 Main 发现少量明确问题时，可以保留已有成果继续修一次；不再因为
  普通重试次数为零而整单重跑。
- 输入与调用链：最新机器验收 + 最新 Main `revise` + 当前 Candidate + 剩余纠正额度 →
  结构化剩余问题 → 同 Task/workspace/session 新 Attempt → 新机器验收 → 新 Main 决定。
- 安全边界：只允许独立任务；旧 review、旧 Candidate、竞争任务、已有 Integration、额度为零/
  耗尽、队列冲突都会在写 grant、改状态或启动 Worker 前拒绝；不会自动 retry、accept 或合入。
- 实际模型路径：DeepSeek `deepseek-v4-pro[1M]`。首轮有两个实现/测试缺口；Main 复用同一
  Candidate 做一次结构化 correction，再显式授权一次最终普通 Attempt。第三轮通过后停止，
  没有继续扩轮。
- Main 结论：聚焦状态机测试、全量 **1,561/1,561**、严格 TypeScript、Hub JavaScript、build
  和 diff hygiene 全部通过。Integration operation
  `8dacfeea-50eb-4016-90bc-fd3423fc00a9` 的 source apply、source verify、artifact build、
  runtime activation 四阶段全部通过；CLI 与 Daemon build identity 一致。
- 拆单教训：Main 漏写 `dist` 为 generated path，导致 22 个编译产物被计入 33 个改动文件。
  预检只因此命中 20 文件阈值；Main 临时提高到 40 完成一次兼容预检后立即恢复为 20，没有重跑
  Worker，也没有永久放宽安全线。
- 经济性：三次 Attempt 共 **15,370,796 gross Worker Tokens**（177,207 input、81,653
  output、15,111,936 cache read）。Main exchange envelope 为 **707,304–4,277,541 Tokens**；
  没有 exact-pair direct-Codex baseline，因此仍不能称为“节约的 Main Token”。

该样本没有 commit 或 push，也不替代三个正式项目和 clean-user journey 的退出要求。

### R11 · ForkLight：合入前解释每个路径为什么被当作源码

**状态：GLM Worker、一次同 Candidate 纠正、自动 Integration、运行版本切换和真实 Hub 验收均完成。**

- 用户结果：Integration Preflight 不再只说补丁太大或不可应用。它会先说明当前 Task 策略怎样看待
  每个受影响路径，分别统计业务源码、生成物/排除项和 ForkLight 内部路径，并强调“当前分类”不等于
  对文件性质的绝对证明。技术路径默认折叠，用户先看到原因和安全选择。
- 输入与调用链：已验证 Candidate 的真实 affected files → 冻结的 workspace path policy → 有序
  `pathEvidence` → 持久化 Preflight receipt/event → Hub 初学者说明。只有默认业务分类参与 size gate
  拒绝时才提供“修正 Task 排除规则后新建 Task”或“保留规则并由 Main 重新收窄交付范围”两个建议；
  系统不会自动改策略、提额度、重试或合入。
- 实际模型路径：Task `525cf643-5cee-49d9-8fbe-8e8623c944c1` 使用 Volcengine
  `glm-5.2[1M]` / Claude Code。基础 Attempt 94 turns，原合同 340 个聚焦测试、build、Hub JavaScript
  syntax 和 diff hygiene 均通过，但 Main 语义审查发现 UI 对 DOM 节点调用 `forEach`，真实有路径证据
  时会抛错。Main 保留全部 10 个文件，只授权一次同 Candidate 结构化纠正；第二次 11 turns，修复
  调用并新增会真正执行 renderer 的 DOM stub 测试。没有普通 retry、adaptation、competition、
  新 Task 或第三轮。
- Main 与交付：最终 10 files / 1,042 changed lines；Main accept 绑定 patch digest
  `00f67a45582d76d92389aa68dce59cf5f6dfe4dea2132e632b11ae500082f623`。Integration operation
  `8cba9c8d-526c-4bb6-905c-81a4e1fa6845` 的 source apply、四条 source verification、artifact build
  和 runtime activation 全部 passed。当前仓库全量回归 **1,624/1,624**，真实 Hub 中路径解释正常
  渲染，浏览器 console 无错误。
- 复核边界：补丁已经应用后再次只读运行 Preflight，会因“补丁不再能干净应用”正确拒绝，同时仍
  持久化 10 条有序 `default-business` 路径证据。当前原始 applicability 错误仍是一堵技术文本墙，
  已列为后续独立 UX 缺口，不进入本轮无限纠正。
- 经济性：两次 Attempt 共 **24,207,598 gross Worker Tokens**（350,608 input、126,430 output、
  23,730,560 cache read），两边用量完全对齐。Main exchange 只有低置信区间
  **159,870–967,304 Tokens**；缺少 exact-pair direct-Codex baseline，因此不声称节约 Main Token。
  Claude runtime estimate 分别约 **USD 14.229183** 与 **USD 2.549887**，不是 Provider 账单。

该样本证明 Main 不能把机器绿灯等同于产品可用，也证明一次精确纠正比整单重跑更合适；它是
ForkLight 自举样本，不替代 Adeptify、Dia、NovelRPGPlay 的十个正式项目任务或 clean-user journey。
没有 commit 或 push。

### R10 · ForkLight：Main 写错验收时只改验收，不重跑 Worker

**状态：Grok 实现、一次同 Candidate 纠正、Main 定点收口、旧失败 Task 反向 dogfood 与真实 Hub 验收完成。**

- 用户结果：Worker 已完成、但 Main 的某条验收命令有误时，Main 可以只替换那一个确切失败槽，在
  当前源码上重新核验；原失败历史不被改写，也不会为了纠正 Main 的错误再向模型付一次成本。
- 输入与调用链：当前 Task + 最新 Attempt + 最新 verification sequence + 最新 Main `revise` review
  + 有界 amendment → 隔离当前源码 → 只执行修正后的验收套件 → 原子记录独立交付结果。自由文本原因、
  命令与输出不进入 Hub 公共投影。
- 实际模型路径：Grok `grok-4.5` / `grok-build`，基础 Attempt 31 turns，一次同 Candidate 结构化
  correction 18 turns；没有 competition、普通 retry、adaptation 或第三轮。runtime estimate 合计
  **USD 2.3043892**；usage missing，所以 Worker Token 和官方费用保持 unavailable。
- Main 取舍：构建生成的 `dist` 把 Candidate 扩到 53 files / 3,377 lines，自动 Integration 正确拒绝。
  Main 只选择 17 个源码/测试文件，不把生成物混进 source delivery，并补“替换目标必须全套唯一”与
  “记录数量必须和实际结果相等”两个边界。
- 真实反向验证：旧 Grok Task `00b0cd43-eeba-40d1-9d6e-c5b5e6c73c1b` 的 Worker exit 0，失败来自
  Main 写入不存在的 typecheck script。新链路 5/5 通过，原 Task 保持 failed、Attempt 数保持 1、
  新增 Worker/模型调用为 0；Hub 明确写出 Main 修正自己的验收，没有再把它显示为 Worker 失败。
- 最终证据：功能 Task remediation 4/4；full check **1,612/1,612**；最终 Hub 定点回归 **71/71**、
  build、JavaScript syntax 和 diff hygiene 通过。真实浏览器同时确认“执行过程已完成”“原检查未通过”
  和“修正验收后已核验交付”三项事实并列可见。

该样本补上 Main 自我纠错与零 Worker 收口的真实任务类型，也暴露 `dist` 生成物应在合同/交付规划阶段
更早分类的后续缺口。它不替代三个正式项目和 clean-user journey 的退出要求。没有 commit 或 push。

### R9 · ForkLight：Grok 连不上时先解释运行环境，不责怪模型

**状态：保留 Grok Candidate，Main 定点补正，完整验收通过；原 Task 诚实保留机器失败。**

- 用户结果：当 Grok TUI 能用、ForkLight Worker 却超时时，Task Detail 直接说明手动 TUI 与后台
  Daemon 可能继承了不同网络环境，给出一个安全恢复动作，不再把它笼统归为模型失败。
- 输入与调用链：Grok terminal/runtime event → connectivity 分类 → Task/statistics → Hub 的原因和
  下一步；原始网络错误只留在私有 Attempt log，公开页面不展示代理值、凭据或 endpoint 细节。
- 实际模型路径：一个 xAI `grok-4.5` / `grok-build` Attempt，30 turns；14 files / 534 lines 的
  Candidate 被保留，没有普通 retry、correction、competition 或 adaptation。
- 失败事实：Main 在不可变合同里误写了不存在的 `npm run typecheck`，所以原 Task 保持 failed；
  Main 没有让 Worker 为合同错误重做，而是补上终态事件脱敏并把未来合同改为 `npm run build`。
- 最终验收：聚焦 **171/171**、全量 **1,595/1,595**、build、Hub JavaScript syntax 和 diff hygiene
  全部通过。明确 connectivity 只算 Provider/运行环境证据，不作为模型能力负样本。
- 经济性：runtime estimate **USD 1.195446**；Grok 没返回完整 usage，Worker Tokens 和官方账单
  保持 unavailable。没有 exact-pair direct-Codex baseline，不声称节约 Main Token。

该样本证明部分 Candidate 可以在不整单重跑的情况下交付，也证明 Main 的合同错误必须与模型执行
失败分开统计。它不替代 Adeptify、Dia、NovelRPGPlay 和 clean-user journey 的 M1.4 退出要求。

### R8 · Relay：Agent 页面先回答“谁能做、是否可用、下一步是什么”

**状态：Grok Worker、一次保留成果纠正、ForkLight 自动 Integration、Main 视觉微调和真实浏览器验收均完成。**

- 用户结果：Agent 页面不再先讲 Runtime、Multica、执行织物、Host 和 Capabilities；每张卡先展示
  助手是否可用、适合做什么、当前是否有任务和唯一下一步。主机、类型、能力标识和工作区路径只在
  默认关闭的“技术细节”里出现。
- 输入与调用链：现有 Runtime / Job / Item → pure `buildAgentPresentation` mapper → Agent 页面
  卡片；没有改 API、Store、Domain、数据库、执行、设置或指派状态机。
- 实际模型路径：Task `55c09d94-15df-49bc-8afc-a28f77754b54` 使用 xAI `grok-4.5` / `grok-build`。
  首次 Attempt 为 9 turns；Main 保留三文件 Candidate，指出无条件指派入口、恢复动作不可点击和零
  Runtime 空白页三个缺口，再用同一 Candidate 做一次 4-turn correction。没有 competition、普通
  retry、adaptation、新 Task 或第三轮。
- 质量判定：两轮独立验收均通过。最终 Candidate 为 3 files / 836 changed lines，超过 520 行软提醒；
  Main 没把软限制当 hard gate，因为 364 行是覆盖所有 RuntimeStatus、工作量去重、空状态和主/技术
  信息边界的语义测试。最终 16/16、目标 ESLint 9 和 diff hygiene 通过。
- 安全合入：Main accept 后，Integration `b36aace6-bff6-4c1d-bac7-3b2a58cec1bb` 完成 source apply
  与三条 source verify；只写入约定的三个路径，没有 commit 或 push。浏览器随后发现卡片名称重复和
  连通性免责声明逐卡重复，Main 直接做两处确定性微调并再次通过 16/16、目标 ESLint 和 diff hygiene。
- 真实体验：桌面为两列卡片；390px 窄屏为单列且 `scrollWidth=390`、无横向溢出。七个技术细节默认
  全部关闭；展开后才显示主机、类型、能力标识、工作区路径和原始说明。
- 经济性：两次 Attempt 的 runtime estimate 分别为 **USD 0.1974916** 和 **USD 0.1507744**，合计
  **USD 0.348266**。Grok 未返回 usage，Worker Token 和官方费用保持 unavailable，不写成 0；28 条
  receipt 的 Main exchange 仅为低置信 **247,417–1,493,852 Tokens**。没有 exact-pair direct-Codex
  baseline，因此不声称节约 Main Token。

该样本证明 Grok 4.5 不只是“配置存在”，而是完成了真实读写、独立验收、同 Candidate 纠正和安全合入；
也说明视觉验收仍能发现机器测试遗漏。它不替代三个正式项目和 clean-user journey 的退出要求。

### R6 · Relay：在启动 Worker 前拒绝不安全或无效的项目目录

**状态：Worker 机器验收、Main 一次定点纠正、ForkLight Integration 和原项目回归均完成。**

- 用户结果：用户选择的项目目录必须真实存在、确实是目录，并且规范化后的真实路径仍位于一个
  有效 allowlist 目录内；不存在、普通文件、符号链接外跳或无效 allowlist 会在 Assignment 和
  Worker 启动前停止，并给出重新选择项目目录的恢复动作。
- 输入与调用链：可选 workspace + allowlist → 现有 `assertWorkspaceAllowed` → 规范化真实目录
  或稳定 `workspace_not_allowed` → 现有 Assignment / ForkLight dispatch。没有改变 Service、
  HTTP、UI、设置持久化、Team 或 Connector。
- 实际模型选择：routing 因精确任务类型零样本而建议 competition；Main 判断这是两文件、确定性
  验收的安全修复，竞争只会重复成本，因此覆盖建议并选择已有后端逻辑交付经验的 DeepSeek
  `deepseek-v4-pro[1M]` 单 Worker。
- 执行路径：首次 Attempt 16 turns、机器验收 4/4；Main 保留两个文件，只指出 allowlist root
  解析仍有 lexical fallback、部分错误缺恢复动作两个缺口。一次同 Candidate correction 用 12 turns
  关闭缺口，第二轮仍为 4/4；没有普通 retry、adaptation、第三轮或新 Task。
- Main 与交付：最终 2 files / 300 changed lines，24/24 新行为测试、目标 ESLint 9、模块导入和
  diff hygiene 通过。Main `accept` 后 Integration operation
  `658a6e77-3dc5-45f3-be3b-bbafb2cd934e` 的 source apply 与原 4 条 source verification 全部通过；
  原 Relay 工作树再跑既有 Alpha 主链 17/17。全局 TypeScript 仍只剩既有可选 `pg` 依赖问题。
- 经济性：两次 Attempt 共 **645,799 gross Worker Tokens**（33,525 input、22,322 output、
  589,952 cache read）；22 条 receipt 的 Main exchange envelope 为 **5,842–35,172 Tokens**。
  Provider-native official cost 共 **USD 0.036142091**，Claude Code runtime estimate 共约
  **USD 1.020651**，两者口径不同。缺少 exact-pair direct-Codex baseline，仍不声称节约量。
- 运行身份事实：当前源码 CLI 与 Daemon build identity matched，所以验证、提交、审查和 Integration
  全部走这条匹配链；当前长会话里的 ForkLight MCP 仍是旧构建并报告 mismatch，没有用于任何状态
  mutation。新 Main 会话需要重新核对 MCP identity，不能把本次 CLI 安全绕行当作 M0 已解决。

该样本补充了 M1.4 的安全/可靠性类型，并证明“窄合同 + 单 Worker + 保留 Candidate 的一次纠正”
可以降低处理量；它仍不替代三个正式项目和 clean-user journey 的退出要求。没有 commit 或 push。

### R4 · Relay：今日简报先告诉用户现在该做什么

**状态：目标代码、聚焦验收和桌面/窄屏浏览器验收完成；Task 因基线 ESLint 合同错误未记作成功。**

- 用户结果：今日页先显示最多三项需要行动的工作，明确下一步是“验收结果、优先处理、查看进度
  或打开事项”，而不是继续堆状态和技术字段。
- 输入与调用链：现有 Item / Assignment / Job → pure `buildDailyBrief` mapper → 今日页只读
  行动列表 → 复用现有 `selectItem` 和收件箱详情。
- 安全边界：不新增写操作、API、数据库、规则引擎、调度器、LLM 摘要或后台自动化；Assignment
  必须精确匹配 `activeAssignmentId`，Job 必须同时匹配 `activeJobId` 和 `itemId`。
- 实际模型路径：MiniMax `MiniMax-M3`；一次基础 Attempt 和一次同 Candidate Main correction，
  没有第三轮、普通 retry、adaptation 或竞争。
- Main 结论：12/12 行为测试、兼容 ESLint 9、diff hygiene 通过；桌面和 390px 窄屏验收完成，
  窄屏固定侧栏问题只做了一轮响应式修正。全局 TypeScript 仍被并行 Team/Postgres 的可选 `pg`
  依赖基线阻断。
- 失败事实：Main 在冻结验收前没有发现仓库 ESLint 10.8 与 Next React plugin 的既有不兼容，
  因此两次 Attempt 都只在同一个未修改基线错误上 machine-failed。Integration 未运行，Main
  只写回审查过的目标文件；这是验收合同错误，不是 Worker 目标行为失败。
- 经济性：两次 Attempt 共 **8,014,119 gross Worker Tokens**（149,732 input、63,313 output、
  7,801,074 cache read），Main exchange envelope 为 **144,638–875,918 Tokens**。没有
  exact-pair direct-Codex baseline，不把边界差额称为节约的 Main Token。

### R5 · Relay：设置页先解释“能不能用”和“下一步做什么”

**状态：目标代码、Main 定点补正、聚焦验收和桌面/窄屏浏览器验收完成；不计作 ForkLight 自动 Integration。**

- 用户结果：设置页不再先展示 Doctor、check id、版本 JSON 等机器字段，而是先回答 Relay
  本地核心、ForkLight 执行和工作区安全是否可用；有问题时只给一个当前最重要的恢复动作，
  完整原始数据保留在默认折叠的“技术信息”中。
- 输入与调用链：现有 `DoctorReport` → pure presentation mapper → Settings 三项状态与
  单一下一步；没有修改 Doctor API、执行状态机、Provider 配置或工作区授权语义。
- 实际模型路径：Volcengine `glm-5.2[1M]` / Claude Code。首次 Attempt 机器验收 4/4 通过；
  Main 保留 Candidate 并使用一次成功 Candidate correction，第二次仍为 4/4。没有普通 retry、
  adaptation 或竞争；窄任务没有为了凑模型覆盖启动无必要的竞争。
- Main 结论：Worker 候选的产品结构可用，但两个空 `memory` 文件仍使候选超出约定文件范围，
  初学者视图也仍暴露一处原始失败信息，因此最终 review 保持 `revise`，没有伪装成可自动合入。
  Main 只写回四个产品文件并定点修正上述可读性问题。
- 最终验收：presentation 行为测试 **8/8**、目标 ESLint 9、模块导入和 diff hygiene 通过；
  桌面与 390px 窄屏均确认主结论、三项状态和单一恢复动作可读，原始数据默认关闭。
  仓库级 TypeScript 仍仅被并行 Team/Postgres 的既有可选 `pg` 依赖阻断。
- 修复交付：ForkLight remediation check
  `54f1b8ca-7b66-4155-884d-998e2f20bf8f` 为 4/4 passed，处置记为
  `verified-repaired-delivered`；它说明 Main 已验证并交付受控补正，不会反向把 Worker review
  改写为 `accept` 或补造一次 Integration。
- 经济性：两次 Attempt 共 **4,892,442 gross Worker Tokens**（192,528 input、134,986 output、
  4,564,928 cache read）；52 条 receipt 的 Main exchange envelope 为
  **92,574–564,867 Tokens**。`4,327,575–4,799,868` 只是 Worker 处理量减去编排交换量，
  不是“节约的 Main Token”；缺少 exact-pair direct-Codex baseline，直接节约量仍不可得。

该样本没有 commit 或 push，也不替代三个正式项目和 clean-user journey 的退出要求。
