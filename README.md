# ForkLight

[中文](#中文) · [English](#english)

---

## 中文

### 这是什么

ForkLight 是 **local-first、运行时与模型无关的执行中枢**：由一位有能力的 **Main**（人机协作主控）理解目标，拆解并分配有界任务，监督持久 **Worker**，审阅与修正结果，并在授权后安全集成变更。用户应能看清「问了什么、发生了什么、产出了什么、为何失败、保留了什么、花了多少、下一步是什么」，而不必先学内部术语。

产品边界：

| 角色 | 拥有 |
|------|------|
| **Main** | 意图对齐、Task Contract、验收、集成/commit/push 授权 |
| **ForkLight** | 持久 Task/Attempt/Candidate、隔离工作区、预算与有限恢复、独立验证、Hub/CLI/MCP |
| **Worker** | 仅在隔离工作区内完成被分配的实现；无原仓写权限，无 commit/push 权 |

项目目标、里程碑与当前进度以
[`goals/forklight-main-led-execution/`](./goals/forklight-main-led-execution/)
为唯一管理入口；`PROJECT.md` 只提供短入口。

### 主要功能点

1. **任务与合同**  
   - 结构化 Task Contract：目标、范围、模块、调用链、场景、风险、独立验收  
   - Attempt / Candidate / 评审图与有限纠错

2. **多运行时 Worker**  
   - 内置 `claude-code`、`codex-cli`、`grok-build` 等适配  
   - Worker Profile、就绪探测、权限与预算  
   - Codex 单次运行与（演进中的）native-goal 执行模式

3. **隔离工作区与补丁**  
   - 依赖物化、workspace patch、源集成 fail-closed  
   - 禁止 Worker 默认写原项目或推送

4. **Hub 控制台**  
   - 双语 UI：现在/历史、输入输出、失败归因、保留工作、下一步  
   - 设置、经济学摘要、可观测性（非遥测倾倒）

5. **CLI / Daemon / MCP**  
   - 同一真相的多入口：本地 daemon、交换收据、MCP 工具面  
   - 健康与 readiness 检查
   - `delivery prepare` / `delivery decide`：一次准备到已审查 Candidate，一次明确决定并安全集成

6. **路由、竞争与失败归因**  
   - 模型路由建议（证据不充分时不永久拉黑）  
   - Competition 仅用于高不确定/多方案例外  
   - 基础设施/合同/运行时失败与模型质量失败分离

7. **Dogfood 与契约文档**  
   - `examples/dogfood/` 真实任务样例  
   - M1–M3 验收与实现合同（`docs/`）

### 技术栈

- TypeScript（Node）、Vitest  
- 本地 Hub（静态 + server）、Daemon socket  
- package：`npm` 脚本见下  

### 开发与启动

```bash
npm install
npm run build
npm run test
npm run check
npm run dev          # 开发模式（依 package 定义）
npm run smoke
```

常见入口（以本机 `package.json` / `docs/operations.md` 为准）：

```bash
# CLI（构建后）
node dist/src/cli.js --help

# 首次设置（不必打开旧 Hub）
forklight setup status
forklight setup provider select --provider xai
printf '%s' "$KEY" | forklight setup provider select --provider deepseek --variant default --confirm
forklight setup worker list
forklight setup worker select --profile grok-4-6-xhigh
forklight setup main install --client grok-build --component mcp --confirm

# 本地 Home 备份（不含 Keychain / 外部 Main 登录；备份须保持私有）
forklight backup preview --destination /safe/outside/forklight-backup
forklight backup create --destination /safe/outside/forklight-backup --confirm
forklight backup inspect /safe/outside/forklight-backup
forklight backup restore /safe/outside/forklight-backup --confirm

# MCP server
node dist/src/mcp/main.js
```

配置、Main 客户端接入：

- `docs/configuration.md`  
- `docs/operations.md`  
- `docs/main-led-delivery.md` — Main 主导的本地交付主路径
- `docs/main-clients/`  
- `docs/m1-clean-user-runbook.md`  

### 目录（摘要）

| 路径 | 说明 |
|------|------|
| `src/core/` | 任务、路由、统计、失败归因、执行模式 |
| `src/workers/` | 运行时适配（claude/codex/grok…） |
| `src/daemon/` | 协调与协议 |
| `src/hub/` | Web Hub |
| `src/mcp/` | MCP |
| `src/workspace/` | 隔离与 patch |
| `examples/dogfood/` | 验收任务 YAML |
| `goals/forklight-main-led-execution/` | Goal、里程碑、进度、决策与证据 SSOT |
| `PROJECT.md` | SSOT 短入口 |

### 原则（摘要）

- 质量优先于随意 size 限制；隔离与独立验证不可配置掉  
- 有限自改进：触顶回 Main，不无限修  
- 先复用再重跑；Competition 非默认重试  
- 默认不发布/不 commit；需用户明确授权  

---

## English

### What it is

ForkLight is a **local-first execution hub**: a capable **Main** decomposes work, supervises isolated **Workers**, reviews candidates, and only integrates with explicit authorization. One human-readable Hub plus CLI/MCP share the same durable truth.

### Features

1. Task contracts, attempts, candidates, review graph, finite correction.  
2. Multi-runtime workers (Claude Code, Codex CLI, Grok Build, …) with profiles and readiness.  
3. Isolated workspaces, patches, fail-closed integration.  
4. Bilingual Hub: outcome → state → I/O → reason → retained work → next action.  
5. Daemon + MCP + exchange receipts. Two-call `delivery prepare` / `delivery decide` for reviewed delivery.
6. Routing advice, exceptional competition, failure attribution before model blame.  
7. Dogfood YAML examples and milestone contracts under `docs/`.

### Develop & run

```bash
npm install
npm run build && npm run test && npm run check
npm run dev
```

First setup (no Hub required):

```bash
forklight setup status
forklight setup provider select --provider xai
printf '%s' "$KEY" | forklight setup provider select --provider deepseek --variant default --confirm
forklight setup worker select --profile grok-4-6-xhigh
forklight setup main install --client grok-build --component mcp --confirm

# Local Home backup (no Keychain / external Main auth; keep the directory private)
forklight backup preview --destination /safe/outside/forklight-backup
forklight backup create --destination /safe/outside/forklight-backup --confirm
forklight backup inspect /safe/outside/forklight-backup
forklight backup restore /safe/outside/forklight-backup --confirm
```

API keys are accepted only on stdin after `--confirm`. Project status and milestones: [`PROJECT.md`](./PROJECT.md). Ops: `docs/operations.md`, `docs/configuration.md`.
