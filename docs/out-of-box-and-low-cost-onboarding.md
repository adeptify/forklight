# ForkLight：开箱即用与低成本上手方案

| 字段 | 值 |
| --- | --- |
| 状态 | Phase 1–3：`forklight hub` 一键前后端 + Main 三通道 + Hub 监督/探测/集成 |
| 日期 | 2026-07-25 |
| 基线 | WorkerAdapter + Hub v1（settings / Keychain / Main MCP install） |
| 参考 | [farion1231/cc-switch](https://github.com/farion1231/cc-switch)（CC Switch） |
| 相关 | `docs/main-clients/*`、`docs/superpowers/specs/2026-07-25-worker-runtime-adapter-design.md` |

---

## 1. 一句话目标

让**非程序员**在 15 分钟内完成：

1. 装好本机 ForkLight（daemon + 状态库）  
2. 配好「干活的模型 / Worker runtime」  
3. **一键把 ForkLight 接到** Grok Build / Claude Code / Codex / OpenCode 等 Main  
4. 打开任意 Main，直接说需求 → Main 写合同 → ForkLight 调度 Worker → 可验收交付  

全程**尽量不手改 JSON/YAML**，不要求理解 MCP 协议细节。

---

## 2. 为何参考 CC Switch（学什么 / 不学什么）

### 2.1 CC Switch 解决的痛

- 多工具（Claude Code、Codex、Grok Build、OpenCode…）各自一份配置  
- 换 Provider / 模型 = 手改 `~/.claude`、`~/.codex`、`~/.grok` 等  
- MCP / Skills 分散、易配坏  

CC Switch 的做法（可借鉴）：

| 模式 | 说明 |
| --- | --- |
| **桌面应用 + 可视化** | 不写配置文件也能完成导入 Provider、切换、MCP 管理 |
| **预设（50+）** | 一键导入常见厂商，只贴 Key |
| **原子写 + 备份** | 写 live 配置前备份，避免弄坏用户环境 |
| **统一 MCP 面板** | 一次配置，同步到多个 App |
| **System tray / 一键启用** | 降低「生效成本」 |
| **SSOT 本地库** | 配置真相在自家 DB，再同步到各工具 live 文件 |

### 2.2 ForkLight 与 CC Switch 的角色差（必须分清）

| | CC Switch | ForkLight |
| --- | --- | --- |
| 核心问题 | **换模型 / 管各 CLI 的 Provider 配置** | **任务编排 + 隔离 Worker + 独立验证 + 审计** |
| 配置对象 | 各 App 自己的 API endpoint / key / MCP | ForkLight 的 settings、Keychain、Worker runtime、**向 Main 注入 forklight MCP** |
| 成功标准 | App 能连上某个模型 | Main 能 submit 任务、Worker 跑完、verify 通过 |

**结论：**

- **学 CC Switch 的「配置 UX 与跨 App 写入」**  
- **不要做成又一个 Provider 切换器**；ForkLight Hub 的中心是「ForkLight 可用 + Main 已接入」  
- Provider 切换若用户已用 CC Switch，可**共存**：CC Switch 管「Grok/CC 自己的模型」；ForkLight Hub 管「ForkLight 的 Worker Provider + MCP 接入」

```text
┌──────────────────────────────────────────────────────────┐
│  用户大脑 / 日常工作                                        │
│   Grok · Claude Code · Codex · OpenCode  (= Main 客户端)   │
└───────────────┬──────────────────────────────────────────┘
                │  forklight_* MCP（由 Hub 一键写入）
                ▼
┌──────────────────────────────────────────────────────────┐
│  ForkLight Hub（本方案 UI）                                 │
│   环境检查 · Provider/密钥 · Worker runtime · 预算           │
│   「安装到 Main」· daemon 启停 · 状态灯                      │
└───────────────┬──────────────────────────────────────────┘
                │  spawn WorkerAdapter
                ▼
┌──────────────────────────────────────────────────────────┐
│  Worker：claude-code / grok-build / …                     │
│  隔离 workspace · 独立 verify · checkpoint 策略             │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 目标用户与「低成本」定义

### 3.1 用户画像

| 画像 | 期望 |
| --- | --- |
| **A. 非程序员 / 轻度用户** | 会点按钮、会付 API 或 OAuth；不会改 JSON |
| **B. 会用 Grok/CC 的产品人** | 会聊天；不想维护 MCP |
| **C. 工程师** | 仍可用 CLI/settings；Hub 不挡高级路径 |

### 3.2 「低成本上手」验收（产品 KPI）

| 指标 | 目标 |
| --- | --- |
| 冷启动到「Main 里能看到 forklight 工具」 | ≤ **15 分钟**（网络正常、已有一种 Main App） |
| 首次成功任务（含 verify） | ≤ **30 分钟**（含第一次选模型/预算） |
| 必手改配置文件次数 | **0**（高级可选手改） |
| 必懂概念 | 仅 3 个：**Main（谁编排）**、**Worker（谁改代码）**、**taskId（任务编号）** |
| 费用可控 | 默认预算明确；probe 二次确认；Grok OAuth 可无 Keychain |

### 3.3 开箱默认（推荐「最省钱可跑通」）

| 项 | 默认 | 原因 |
| --- | --- | --- |
| Main | 用户本机**已安装**的优先：Grok Build → Claude Code → Codex | 不强迫新装 |
| Worker runtime | `claude-code`（或检测 Grok 已登录则可选 `grok-build`） | 生态成熟 / 本机已 dogfood OAuth |
| Worker Provider | DeepSeek（API Key）或 xAI（OAuth 种子） | 成本与可用性平衡 |
| `defaultMaxBudgetUsd` | **0.5** | 单任务有顶 |
| 并发 | 1～2 | 避免账单失控 |
| 首次任务模板 | 「Hello 合同」：改一个小文件 + `true` 验收 | 必过验证链 |

---

## 4. 产品形态：ForkLight Hub

名称可叫 **ForkLight Hub** / **控制中心**（实现上可演进现有 `setup` + `console`，不必立刻 Tauri）。

### 4.1 信息架构（对标 CC Switch 简化版）

```text
ForkLight Hub
├── 首页（状态灯）
│     daemon · 默认 Worker · 已接入的 Main · 最近任务
├── 安装向导（首次 / 修复）
│     环境 → 密钥与模型 → Worker → 接入 Main → 完成
├── 设置
│     Provider 与密钥 · Runtime · 预算与并发 · 高级
├── 接入 Main（核心差异化）
│     Grok / Claude Code / Codex / OpenCode
│     [检测] [一键安装 MCP] [打开 App 说明] [测试 forklight_health]
├── 任务（可链到现有 Console 看板）
└── 关于 / 诊断导出
```

### 4.2 与现有组件关系

| 现有 | Hub 中角色 |
| --- | --- |
| `forklight setup` | **v1 可并入** Hub 的「安装向导」；setup 结束后**不要关死入口**，改为「设置中心」常驻 |
| `forklight console` | 任务看板；Hub 首页链过去或同 SPA 多 tab |
| settings / Keychain | Hub 唯一写入后端（SSOT） |
| `docs/main-clients/*` | 向导文案与失败时的「高级说明」 |

### 4.3 技术选型建议（分阶段）

| 阶段 | 形态 | 理由 |
| --- | --- | --- |
| **Hub v1（低成本交付）** | 现有 **loopback Web UI**（setup/console 技术栈）+ CLI 打开浏览器 | 零新运行时；复用 token/127.0.0.1 安全模型；几周可出 |
| **Hub v1.5** | 菜单栏 / 托盘（可选）「打开 Hub」「daemon 状态」 | 学 CC Switch tray，但不做全量 Provider 宇宙 |
| **Hub v2（可选）** | Tauri 桌面壳（若需拖放安装、更强文件权限 UX） | 对齐 CC Switch 安装感；**非第一刀** |

**原则：先 Web Hub 跑通「开箱 + 一键 MCP」，再考虑桌面壳。**

---

## 5. 用户旅程（开箱即用脚本）

### 5.1 第一次打开（15 分钟剧本）

```text
1. 安装 ForkLight（npm -g 或 dmg 日后）
2. 运行：forklight hub   # 或 forklight setup 升级版
3. 浏览器打开 127.0.0.1（token 在 fragment，与今日 setup 同级安全）

向导 Step A — 环境
  [✓] macOS  [✓] Node≥24  [?] Claude CLI  [?] Grok CLI  [?] Codex
  缺失项：按钮「安装说明 / 打开官网」

向导 Step B — 你怎么编排？（选 Main，可多选）
  ○ Grok Build（推荐若已 OAuth）
  ○ Claude Code
  ○ Codex
  ○ 我只用网页/CLI 看任务

向导 Step C — 谁来写代码？（Worker）
  ○ Claude Code Worker + DeepSeek/Qwen/…（填 Key + 探测）
  ○ Grok Worker（检测 grok login / 或 xAI Key）
  显示：预计单任务预算上限 $0.50（可改）

向导 Step D — 一键接入 Main
  对每个勾选的 Main：
    [安装 ForkLight MCP] → 写配置 + 备份原文件
    [测试连接] → daemon health + MCP list tools
  成功：绿勾「在 Grok 新开对话即可使用」

向导 Step E — 试跑
  [运行示例任务] → 提交最小合同 → wait → 展示 taskId 与结果
  文案：记住 taskId；换电脑对话用 list 找回

完成 → 进入 Hub 首页（daemon 保持运行）
```

### 5.2 日常使用（低成本）

用户打开 **已接入的 Main**，自然语言：

> 「用 ForkLight 在项目 X 里做一个小改动：……」

Main 内部（skill/说明已装好）：`validate → submit → wait → inspect`。  
用户**不必**再打开 Hub，除非要换模型/预算/换 Worker。

### 5.3 换模型 / 换 Worker（学 CC Switch 的「一键切换」）

Hub → 设置 → Provider / Runtime → 保存 → **不需要**用户改 Main 侧 MCP（MCP 只指向 forklight-mcp）。  
这是相对 CC Switch 的简化优势：**Main 侧 MCP 配置几乎静态；变的是 ForkLight 后端 settings。**

---

## 6. 功能规格（Hub 必须具备）

### 6.1 环境与 daemon

- 检测：Node、claude、grok、codex、`FORKLIGHT_HOME`  
- 启停 daemon、显示 build identity 是否匹配  
- 「修复」：重建 token、打开 Console、导出诊断 zip（无密钥）

### 6.2 Provider 与密钥（ForkLight Worker 用）

- 列表：deepseek / qwen / minimax / glm / xai  
- 动作：保存 Keychain、probe（xai = keychain-only 或 OAuth 状态）、删除  
- **不**把密钥写进各 Main 的配置文件  

### 6.3 Worker Runtime

- 选择 `defaultRuntime`：`claude-code` | `grok-build`  
- 显示 doctor：ok / issues / capabilities（预算旗标、checkpoint 等）  
- 配对校验：`grok-build` 必须 xai；UI 禁止非法组合  

### 6.4 预算与安全默认

- `defaultMaxBudgetUsd` / `maximumBudgetUsd` / `maxConcurrency` / `noProgressTimeoutMs`  
- 文案强调：Worker 不能 commit/push；验收独立跑  

### 6.5 接入 Main（一键安装）— 核心

对每个 Main 实现 **Adapter 式安装器**（概念类似 CC Switch 的 per-app MCP sync）：

| Main | 安装动作（v1） | 生效方式 |
| --- | --- | --- |
| **Codex** | 写/更新 plugin + MCP 项（已有路径） | 新开 Codex task |
| **Claude Code** | 写入用户 MCP 配置（路径按官方约定）+ 可选 skill 片段 | 重启 CC / 新会话 |
| **Grok Build** | 写入 Grok MCP 配置（见 Grok 文档） | 新开 Grok 会话 |
| **OpenCode** | 写入 OpenCode MCP 或提供「复制命令」回退 | 重启 OpenCode |

**每个安装器必须：**

1. **检测**是否已安装该 App  
2. **备份**原配置（时间戳目录，保留 N 份，学 CC Switch backups）  
3. **原子写入** MCP：`forklight-mcp` 或 `npx`/`绝对路径`  
4. **注入 skill/说明**（工具顺序 + taskId + Main≠Worker）  
5. **连通性测试**：spawn daemon → `health` →（可选）假 MCP list  
6. **卸载 / 回滚**按钮  

### 6.6 明确不做（控制范围）

- 不做 CC Switch 级 50+ 厂商中继宇宙  
- 不做跨 App **模型切换**的单一真相（那是 CC Switch 的活）  
- 不做云账号同步（可后期）  
- 不在 UI 里伪装「官方账单」  

---

## 7. 低成本路径的「推荐组合」

### 组合 L1 — 最省钱、最快通（推荐默认）

| 角色 | 选择 |
| --- | --- |
| Main | Grok Build（用户已 OAuth）或 Claude Code |
| Worker | `claude-code` + DeepSeek Key |
| 预算 | $0.5 / 任务 |
| 理由 | Worker 生态稳；DeepSeek 单价友好；Main 用已有订阅 |

### 组合 L2 — 全 Grok

| 角色 | 选择 |
| --- | --- |
| Main | Grok Build |
| Worker | `grok-build` + OAuth 种子 / xAI Key |
| 注意 | checkpoint 为 skip；预算与 turns 要盯 |

### 组合 L3 — Codex 编排

| 角色 | 选择 |
| --- | --- |
| Main | Codex + 现有 plugin 一键 |
| Worker | Claude + 任意兼容 Provider |

Hub 首页用三张「推荐卡片」直接 **应用组合**，减少选择题。

---

## 8. 分阶段交付（可排期）

### Phase 0 — 文档与假按钮（1 周内）

- 本方案文档（本文）  
- Hub 线框 + 各 Main「复制配置」页（零自动写文件）  
- 验收：非程序员照抄 3 步能在一个 Main 看到工具  

### Phase 1 — Settings Hub v1（已落地）

- 可重复打开：`forklight hub`（常驻，Ctrl+C 退出）  
- UI：Provider 密钥、defaultRuntime、预算/并发、L1/L2/L3 预设  
- 后端：`src/hub/settings-api.ts` + Keychain + runtime doctor  
- 验收：不改 JSON 完成 L1 组合保存  

### Phase 2 — 一键接入 Main（已落地）

- Codex / Claude Code / Grok 安装器（备份+原子写+卸载）  
- Hub「接入 Main」页：检测 / 安装 / 卸载  
- 验收：点安装 → 新开 Main 会话使用 forklight MCP 工具  
- 备份目录：`~/.forklight/hub-backups/`  

### Phase 3 — 试跑与托盘（2 周）

- 示例任务一键跑通  
- 可选 menu bar：daemon 灯 + 打开 Hub  
- 验收：冷机 15 分钟剧本通过  

### Phase 4 — 体验抛光（持续）

- 失败可理解文案、诊断导出  
- OpenCode 安装器  
- 与 CC Switch 共存说明  

---

## 9. 与 CC Switch 的协作 / 竞争边界

| 场景 | 建议 |
| --- | --- |
| 用户已用 CC Switch 管各 CLI 的 API | **继续用**；ForkLight Hub **只**装 forklight MCP + 管 Worker 侧密钥 |
| 用户不用 CC Switch | Hub 提供最小 Provider 预设（DeepSeek/Qwen/MiniMax/GLM/xAI），不扩 50+ |
| 用户想在 CC Switch 里管 forklight MCP | 长期可提供 **Deep Link / 导入模板**（`forklight://` 或文档 JSON），非 MVP |

文案建议：

> ForkLight 不管你用哪个聊天模型当「大脑」；它管「任务如何安全外包给 Worker」。CC Switch 帮你换大脑的线路；ForkLight Hub 帮你接上外包流水线。

---

## 10. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 写坏用户 MCP 配置 | 备份 + 原子写 + 一键回滚；默认「复制」模式可开关 |
| 各 App 配置路径变更 | 每 Main 一个 adapter 版本探测；失败则降级复制 |
| 密钥进错文件 | 密钥只进 Keychain；MCP 配置只含命令路径 |
| OAuth 与 task GROK_HOME | 已有 seed auth 路径；Hub 显示「已登录 Grok」状态 |
| 范围膨胀成 CC Switch | 坚持 SSOT = ForkLight settings；不写各 App 的模型目录 |

---

## 11. 成功标准（方案级）

1. **零手改配置文件**完成：环境 + 一种 Provider + 一种 Worker + 至少一种 Main 接入。  
2. 新用户用自然语言在 Main 里完成**一次**带 verify 的任务。  
3. 换 Worker/Provider 只改 Hub，**不重装** Main 侧 MCP。  
4. 工程师仍可用 CLI；Hub 不成为唯一入口。  
5. 文档与 UI 只讲 3 个词：Main / Worker / taskId。  

---

## 12. 立即行动建议（给你拍板用）

| 优先级 | 行动 |
| --- | --- |
| **P0** | 实现 **Hub v1**：设置中心（Provider + runtime + 预算）+ 常驻入口 |
| **P1** | **一键接入** Grok + Claude Code + Codex（备份/回滚） |
| **P2** | 示例任务试跑 + 状态灯首页 |
| **P3** | 托盘 / Tauri 壳 / OpenCode / 与 CC Switch 互导 |

**不建议**第一期做：全量厂商预设、本地代理 failover、Session 管理器（CC Switch 已强）。

---

## 13. 附录：概念对照表（给实现的人）

| 用户话 | ForkLight 概念 | Hub 控件 |
| --- | --- | --- |
| 用哪个聊天软件下任务 | Main 客户端 | 「接入 Main」页 |
| 谁写代码 | Worker runtime | Runtime 下拉 |
| 代码模型从哪来 | Provider + Key / OAuth | Provider 卡片 |
| 花多少钱 | defaultMaxBudgetUsd 等 | 预算滑条 |
| 任务编号 | taskId | 任务列表 / 复制按钮 |
| 装好了吗 | health + MCP 探测 | 绿勾 / 修复 |

---

## 14. 现在就能用的操作手册（Hub v1）

### 14.1 安装与打开

```bash
# 开发树
cd /path/to/forklight && npm install && npm run check && npm link

# 或全局
npm install -g github:adeptify/forklight

# 一站式控制中心（Home / Board / Connect / Settings）
forklight hub
# 仅打印 URL：forklight hub --no-open

# 深度 Console（看板详情、plans、compete、insights）仍可用：
forklight console start
# 或从 Hub → Board →「Open deep Console」
```

Hub 与 Console 共用 Multica 风格暗色壳层；**可写设置 + Main 安装 + 任务看板**在 Hub，**深度审计看板**在 Console。

### 14.2 15 分钟剧本（对照 UI）

按 **Configure 四步** 走完，再进 **Operate**：

| 步骤 | 在 Hub 里做什么 | 成功标志 |
| --- | --- | --- |
| 1 Model | Provider + model id + endpoint + API key（Keychain） | toast 保存成功；key ok |
| 2 Worker | 选 `claude-code` 或 `grok-build` + effort；看 doctor | 配对合法；保存成功 |
| 3 Limits | 预算 / 并发 / no-progress timeout | 保存成功 |
| 4 Connect Main | 对 Grok / Claude Code / Codex 点 Install forklight MCP | badge = installed；有备份 |
| 使用 | 新开 Main 会话下任务；在 Overview / Board 监督 | 看板有任务；可点开详情/economics |

### 14.3 配对规则（fail-closed）

| Worker runtime | 允许的 Provider |
| --- | --- |
| `claude-code` | deepseek / qwen / minimax / glm（**禁止 xai**） |
| `grok-build` | **仅 xai** |

非法组合在 Hub 保存时返回 422，不会写入半残 settings。

### 14.4 与 CC Switch 共存

- **CC Switch**：继续管各 CLI 自己的聊天模型 / 中继  
- **ForkLight Hub**：只管 Worker 侧密钥 + forklight MCP 注入 + 预算  
- Main 配置里**不会**出现 Provider API Key，只有 `forklight-mcp` 命令路径  

### 14.5 实现映射

| 能力 | 代码 |
| --- | --- |
| CLI | `forklight hub` → `src/cli.ts` |
| HTTP API | `src/hub/server.ts`（`/api/status|settings|provider-key|mains/*`） |
| Settings 纯逻辑 | `src/hub/settings-api.ts` |
| Main 安装器 | `src/hub/main-install.ts` |
| UI | `src/hub/public/*` |
| 测试 | `tests/hub-settings.test.ts`、`tests/hub-main-install.test.ts` |

---

## 15. 参考链接

- CC Switch：https://github.com/farion1231/cc-switch  
- ForkLight Main 客户端包：`docs/main-clients/`  
- Worker 双平面设计：`docs/superpowers/specs/2026-07-25-worker-runtime-adapter-design.md`  
- 配置参考：`docs/configuration.md`  
