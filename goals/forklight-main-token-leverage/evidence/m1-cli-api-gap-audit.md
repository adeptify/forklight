# M1 退出审计 — 2026-08-09

> 状态：**已毕业（GRADUATED）**。Worker 审计判定无阻断缺口；Main 随后完成完整边界套件、
> CLI/API 检查、Store 完整性核对和 CLI/Daemon 身份匹配。
> Worker 只读审计：仅改写本报告一个文件；没有修改代码、测试、设置、SSOT 合同/计划/进度/决策、
> 其他证据文件、Hub、Store 或备份。Shell 不可用，未运行任何命令；三条验收命令由 ForkLight 独立执行。
> 实时 Store 数字来自 Main 提供的、已在运行时验证的操作证据，本隔离工作区无法重读，按 Main-supplied 标注。

## 结论（Verdict）

按 `contract.md` 的 M1 定义（通用背景合同、Goal/Plan/Task 与完整 CLI/API、先 CLI/API 后 Hub）和
`plan.md` 的 M1 Exit 规则逐项核对，**M1 可以毕业**：

- CLI/API 已具备 Goal→Plan→Task 的 create / preview / validate / submit / inspect / continue 全流程；
- v3 context-first 背景合同在 **standalone Task、Plan、Goal、outcome-intake** 四条路径均可进入，
  并精确到达 Worker prompt（只渲染 Main 批准的 background，不整段倾倒会话）；
- 真实 Coding 与非 Coding 两条委派链均已端到端完成，**不依赖 Hub、不做数据库手改**；
- 当前没有发现任何**用户可见或合同破坏性**的缺口，因此 **阻断性缺口：无**。

M1 毕业**不**声明 Main Token 节约（属 M4）、不启动 Hub（属 M5）、不要求 M2–M5 能力。
Main 已在里程碑边界完成完整套件运行和保留证据核对，现停下等一骏验收。

## M1 退出要求 → 现状矩阵

| M1 要求（plan.md） | 现状 | 证据 |
|---|---|---|
| Context first：why / user / 现状 / 上级 Goal/Plan / 历史决策 / 输入 / 产出用途 / 授权 / 边界 / 质量标准 / 验收 | **满足** | v3 结构化背景：`src/core/task.ts:396-433`（`parseBackground` 全字段）、v3 spec 解析 `src/core/task.ts:943`；Worker prompt 先渲染背景块：`src/core/task.ts:1318-1337`；测试：`tests/task-quality.test.ts:380`（背景先于 scope 且每项恰好一次）、`tests/task-preview.test.ts:1459`（预览精确回显 Main 批准背景） |
| 领域无关核心 + 可选 Coding 扩展 | **满足** | `src/core/task.ts:436-449`（`parseCodingExtension` 可选）；领域无关 fixture：`fixtures/v3-domain-neutral-task.yaml`；非 Coding 真实任务无 Coding 扩展 |
| CLI/API create/preview/validate/submit/inspect/continue Goal/Plan/Task | **满足** | Task：`forklight submit/validate/status/inspect/resume/revise/correct`（`src/cli.ts:1827, 2336, 3587, 3668, 4095, 4208, 4293`）；Plan：`validate-plan/submit-plan/inspect-plan/board`（`src/cli.ts:1848, 1888, 1901, 1925`）；Goal：`validate-goal/submit-goal/goal status/list/advance/stop/handoff`（`src/cli.ts:1870, 1985, 2000+`）；daemon 方法表 `src/daemon/protocol.ts:66-89` |
| 相关上下文选择（不整段倾倒） | **满足** | v3 prompt 只渲染 Main 批准的 background（`src/core/task.ts:1318-1337`）；`tests/task-preview.test.ts:1459, 1479` |
| 一个真实 Coding + 一个真实非 Coding 合同流 | **满足** | `evidence/coding-delegation-run.md`（Task `c52600a5-…`，v3+Coding，一次 Main 修正后集成）、`evidence/noncoding-delegation-run.md`（Task `399baf0e-…`，v3 领域无关，无修正直接接受） |
| Exit：两条流程不依赖 Hub 或数据库手改 | **满足** | Coding 走 CLI/daemon 委派链；非 Coding 为源码只读审计产物；均无 Hub/数据库手改 |
| Exit：合同测试通过 | **满足** | 集成后 101 Core/policy + 76 CLI/MCP 聚焦测试通过；Main 边界 `npm run check` 通过 2,847/2,847 |
| Exit：Worker 可见上下文与 Main 批准一致 | **满足** | 预览精确回显（`tests/task-preview.test.ts:1459`）+ prompt 渲染（`tests/task-quality.test.ts:380`）+ 两条真实 dogfood 均按 Main 批准背景执行 |

## 旧 G1–G5 缺口核查

| 旧缺口 | 旧证据 | 当前证据 | 状态 |
|---|---|---|---|
| G1：v3 合同无法进入 Plan/Goal（`loadWorkPlan` 锁 v2） | `src/core/plan.ts:19, 109-111` | `src/core/plan.ts:109-111` 现只拒绝 `version === 1`，经 `loadTaskSpec` 接受 v2/v3；测试：`tests/plan.test.ts:53`（v3 Plan item 保留精确背景）、`tests/goal.test.ts:476`（v3 Goal 原子注册） | **已关闭** |
| G2：outcome-intake Task proposal 只收 v2 | `src/daemon/coordinator.ts:4696-4698` | `src/daemon/coordinator.ts:4722-4725` 只拒绝 v1，接受 v2/v3；测试：`tests/outcome-intake.test.ts:1937`（v3 Task propose+confirm）、`:1998`（v2/v3 混合 Plan）、`:2042`（v2/v3 混合 Goal） | **已关闭** |
| G3：Goal 无预提交校验面 | 无 `validate-goal` / `goal_validate` | CLI `validate-goal`（`src/cli.ts:1870`）、daemon `goal_validate`（`src/daemon/protocol.ts:67` 只读，`:138`；`src/daemon/server.ts:983`；`src/daemon/coordinator.ts:1565`）、MCP `forklight_goal_validate`（`src/mcp/server.ts:467`），共享投影 `src/core/goal-preview.ts`；测试：`tests/goal.test.ts:3381, 3440, 3466`、`tests/cli-task-preview.test.ts:361`、`tests/mcp.test.ts:166` | **已关闭** |
| G4：CLI 缺 outcome-intake 命令 | 仅 daemon/MCP/Hub 有 | `forklight outcome create/list/get/propose/confirm`（`src/cli.ts:2184-2288`，usage `:226-230`）、daemon 方法 `src/daemon/protocol.ts:85-89`；测试：`tests/outcome-cli.test.ts:136`（真实 daemon 全两阶段流）、`:294`（只读投影不启 daemon）、`:315`（非法参数先拒） | **已关闭** |
| G5：CLI 缺 work-hierarchy 与 task-plan-context | 仅 daemon/Hub 有 | `forklight work-hierarchy` / `forklight task-plan-context`（`src/cli.ts:1941, 1969`，usage `:216-219`）、daemon `src/daemon/protocol.ts:83-84`（均只读）；测试：`tests/hierarchy-cli.test.ts:355`（嵌套 Goal→Plan→Task 精确 JSON）、`:515`（task-plan-context）、`:579`（不启 daemon） | **已关闭** |

## 旧 E1–E2 证据缺口核查

| 旧缺口 | 当前证据 | 状态 |
|---|---|---|
| E1：Goal 的 CLI/daemon/MCP 缺端到端合同测试 | 已有直接证据：`tests/goal.test.ts:416`（原子注册）、`:476`（v3）、`:1345/3019`（投影）、`:3381-3466`（validate-goal 预览）、`tests/cli-task-preview.test.ts:361`（真实 CLI 进程）、`tests/mcp.test.ts:166`（真实 MCP 调用）、`tests/mcp.test.ts:1756`（MCP plan 工具真实调用） | **已关闭**（余一项非阻断覆盖润色，见下） |
| E2：非 Coding 真实流程无交付证据 | `evidence/noncoding-delegation-run.md`（真实 v3 非 Coding 审计任务 `399baf0e-…`，Main 无修正接受）；Coding 侧 `evidence/coding-delegation-run.md` | **已关闭** |

## 阻断性缺口

**无。** 未发现任何当前 M1 退出要求同时缺少实现与可执行证据的情况；也未发现任何与 Main-supplied
已集成事实相矛盾的实现/测试。唯一保留的 E1 细项是测试覆盖偏好而非用户可见缺失，不构成阻断。

## 非阻断的后续工作

- **M2（持续高质量交付）**：依赖/重启恢复/检查点/自检/独立验证/裁判/有限修复/交接/安全 Integration 闭环。
- **M3（智能委派）**：证据驱动路由、Competition、模型能力统计与执行策略学习。
- **M4（Main Token 杠杆）**：同范围同验收成对样本与 `evidence/main-token-pairs.json`；M1 不声称节约。
- **M5（产品毕业）**：CLI/API clean-clone、Impeccable 一次性 Hub 设计与 30 分钟首次交付。
- **可选表面润色（不阻塞 M1）**：`work_hierarchy` / `task_plan_context` 目前有 CLI + daemon 只读面，
  MCP 工具表未加这两个只读投影（属可选项，非 M1 合同要求）；`goal_submit_file`/`goal_status`/`goal_advance`
  等暂以 coordinator 层测试 + 薄 daemon 分发覆盖，未做全 socket 往返（测试覆盖偏好，非用户可见缺口）。

## Main 里程碑边界结果

全部检查均不依赖 Hub 或数据库手改：

1. `npm install` 通过；同时报告 3 个依赖审计项（1 moderate、2 high），未自动改写依赖。
2. `npm run check` 通过：2,847 tests，2,847 pass，0 fail。
3. `doctor --json`、`health --json`、`goal list --json`、`board --json`、`stats --json`
   全部 exit 0；Daemon 重启后与 CLI build identity 一致，Doctor 显示 Ready to execute。
4. Live Store 为 293 Tasks / 431 Attempts / 213,300 Events / 41 review graphs /
   1 Competition / 2 paired samples / 160 Integration results；SQLite `quick_check=ok`，
   foreign-key violations=0。
5. 89 项 stale-attention 清单 hash
   `0af780091e4add89e6195562647b1e0c19178be3c2e1309e178867fd5d948b11` 已处理，全部仍为
   `succeeded`，`waiting-user-decision` 为空；两份已验证备份仍保留。

M1 已向一骏展示结果并停在里程碑边界；进入 M2 需要新的确认。

## 证据

- 合同/计划：`goals/forklight-main-token-leverage/contract.md`、`plan.md`
- 真实 dogfood：`evidence/coding-delegation-run.md`、`evidence/noncoding-delegation-run.md`
- CLI：`src/cli.ts:204-279`（usage）、`:1827-2288`（validate/validate-plan/validate-goal/submit-plan/inspect-plan/board/work-hierarchy/task-plan-context/submit-goal/goal/outcome）、`:2336-4373`（submit/resume/revise/correct/status/inspect/list）
- Daemon：`src/daemon/protocol.ts:66-89, 108-154`、`src/daemon/server.ts:686-690, 983, 1111-1119`、`src/daemon/coordinator.ts:1565, 4688-4756`
- Core：`src/core/task.ts:396-449, 943, 1318-1337`、`src/core/plan.ts:109-111`、`src/core/goal-preview.ts`
- MCP：`src/mcp/server.ts:467, 2474-2621`
- 测试：`tests/plan.test.ts:53`、`tests/goal.test.ts:416, 476, 1345, 3019, 3381-3466`、`tests/outcome-intake.test.ts:1937, 1998, 2042`、`tests/outcome-cli.test.ts:136, 294, 315`、`tests/hierarchy-cli.test.ts:355, 515, 579`、`tests/cli-task-preview.test.ts:339, 361`、`tests/task-preview.test.ts:1459, 1479`、`tests/task-quality.test.ts:380`、`tests/mcp.test.ts:166, 255, 1756`

Worker self-validation：未运行任何命令（Shell 不可用），三条验收命令（`test -f` / `rg -q` / `git diff --check`）
由 ForkLight 独立执行；checkpoint 按可用性调用，结果以 ForkLight 独立复跑为准，不声明未经验证的机器绿。
