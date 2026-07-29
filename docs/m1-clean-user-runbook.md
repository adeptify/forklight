# M1 全新用户开箱验收手册

更新时间：2026-07-28

这份手册只用于证明 ForkLight 是否真的能被一个全新本地用户使用。操作者按 Hub
页面完成配置，不编辑 ForkLight 数据库、状态文件、Main JSON、Task YAML 或项目源码。
手册只记录不含秘密的事实；API Key、Hub 私有 URL、Prompt 和 Provider 响应不得抄入记录。

## 验收环境

必须任选一个：

1. 这台 Mac 上新建的独立 macOS 用户；
2. 一台一次性 macOS 虚拟机；
3. 一台没有安装过 ForkLight 的 Mac。

只更换 `FORKLIGHT_HOME` 不算全新环境，因为 Keychain、Main 配置和全局 npm 安装仍可能被继承。

推荐使用新的标准 macOS 用户：准备速度最短，同时能隔离 Keychain、ForkLight Home 和
Codex 配置。创建系统用户需要一骏单独授权，本手册本身不会创建或删除用户。

## 开始前准备

由现有开发用户完成，不能在新用户环境里临时修改产品：

- 冻结本次验收所用的 ForkLight 源码和 build identity；
- 从同一源码生成一个 `forklight-0.2.0.tgz`，记录文件 SHA-256；
- 把 tarball 放在新用户只读可访问的位置；
- 准备一个专用于本次验收的 Provider Key，但不提前写入新用户 Keychain；
- 选择一个 Main。M1 首次退出验收默认使用 Codex；其他 Main 留作后续兼容性样本。

如果打包后源码、build identity 或 tarball 变化，本次记录作废并重新开始，不能混用两次构建。

当前已冻结的验收包：

- 目录：`/Users/Shared/ForkLight-Clean-Run.cDgmCh`
- tarball：`forklight-0.2.0.tgz`
- SHA-256：`5c0609a14b9df7e19c4949907954bf58fd87eb00fac686df370538fbca86e9d5`
- build identity：`e0072e64953a6994f503b4f7e72b7f755ef72e0b3d4f1728ec07f516273279ad`
- source digest：`5d8fcaf120116c145cfe77f578bd2372a57d1dc247eb1eb0b75e5321bebe67de`

这个 tarball 已通过完整 `prepack` 检查、临时 prefix 安装、安装后 CLI 加载、tarball/安装后
identity 逐字对照和敏感文件名扫描。它没有在现有开发用户中启动 Hub 或 Daemon。clean run
必须直接使用这一个文件；若源码继续变化，应明确废弃本包并重新冻结，不能静默替换。

## 操作者规则

- 一位操作者从“开始”连续走到“完成”，不中途请开发者代为编辑内部配置。
- 遇到问题先按页面给出的唯一下一步操作；只有页面无法继续时才记录人工帮助。
- 不运行付费 Probe 来代替真实首个 Task。首个 Task 本身就是连接与执行证据。
- 不因超过 15 或 30 分钟强制失败；时间是体验信号，质量和真实恢复优先。
- 不反复重试同一种失败。记录一次失败、页面解释和下一步，然后由 Main 判断是否调整。

## 连续验收流程

### 1. 记录干净起点

记录开始时间、macOS 版本、机器类型，以及 Node、Claude Code、Codex 是否已安装。
确认：

- 当前用户没有 ForkLight 状态目录；
- 当前用户 Keychain 中没有本次 Provider 的 ForkLight 条目；
- Codex 中没有 ForkLight Plugin、Skill 或 MCP；
- 系统中没有属于当前用户的 ForkLight Daemon 或 Hub。

只记录“存在 / 不存在”，不要输出 Keychain 内容或完整 Hub URL。

### 2. 安装并打开 Hub

操作者只执行：

```bash
npm install -g /path/to/forklight-0.2.0.tgz
forklight hub
```

记录：

- 安装完成时间；
- `forklight` 版本和 build identity；
- 是否只出现一个 Hub；
- 页面是否不用解释就能指出下一步。

不得在失败后改用源码目录、`npm link` 或手工启动多个端口来掩盖安装问题。

### 3. 从 Hub 完成配置

按 Overview 的顺序完成：

1. Models：选择 Provider 和模型，通过页面写入 Keychain；
2. Workers：创建 Worker，展开 Advanced 检查实际生效的质量、Token、时长、文件、代码量、
   Attempt 和自适应策略；
3. Main：从页面安装 Codex Plugin、MCP 或 Skill 所需部分；
4. Services：确认 Task service 可以使用。

记录每一步：页面说了什么、操作者做了什么、是否遇到 macOS 权限提示、用了多久。
模型/Worker 预览和保存后的生效结果必须一致；不一致即为失败证据，不能手改数据库修正。

### 4. 新建 Main 会话

完成 Main 安装后关闭旧 Codex 会话并新建一个会话。新 Main 必须从 ForkLight 返回当前
Daemon 的同一 build identity。旧会话无法热加载 MCP 是允许的，但页面必须提前说明需要新会话。

这里只做本地 health，不运行 Provider Probe，不产生模型费用。

### 5. 从 Hub 启动首个真实 Task

在 Overview 使用 **Run your first real Task / 运行你的第一个真实任务**：

- 不创建或编辑 YAML/JSON；
- 选择刚才保存的 Worker；
- 阅读最终生效策略预览；
- 明确确认后提交一次；
- 进入普通 Task Detail 观察过程。

如果提交按钮无法使用，操作者应能从页面直接说出缺少的条件，而不是查看终端日志猜测。

### 6. 检查用户是否看懂

不向操作者提示答案，让其用自己的话回答：

1. Main 交给 Worker 的具体任务是什么？
2. 使用了哪个 Worker、模型和 Runtime？
3. Worker 做了什么，产出了什么？
4. 独立验收通过还是失败？依据是什么？
5. 如果失败，问题属于配置、模型执行、代码验收、Main 审查还是合入？
6. 当前保留了哪些可用成果？
7. 下一步唯一需要做什么？

七个问题中任何一个只能靠开发者解释，都记为 Task Detail 可理解性缺口，不能仅凭页面字段存在判定通过。

### 7. Main Review 与安全交付

Main 独立查看 Diff 和验收证据，记录 `accept / revise / reject` 及白话原因。只有 Main 接受且
Integration Preflight 通过后，操作者才明确授权把示例补丁合入 disposable sample project。

记录四个不同事实：

- 源码是否应用；
- 应用后是否重新验收；
- 是否构建运行产物；
- 是否需要并完成 runtime activation。

不需要 activation 的示例应显示“已交付”，不能显示“已激活”。

### 8. 恢复验证

完成或执行中任选一个安全检查点：

1. 关闭 Hub UI 后再次运行 `forklight hub`；
2. 关闭 Codex 会话并打开一个新会话；
3. 再次打开同一个 Task Detail。

验收：仍只有一个 Hub、Task 历史和当前结果没有丢失、不会重复启动 Worker 或重复应用补丁，
新 Main 仍报告当前 build identity。

### 9. 完成记录

记录结束时间、总耗时、首次独立验收完成耗时，以及所有人工介入。明确填写：

- 是否编辑过内部配置或数据库；
- 是否运行了额外 Probe；
- 是否发生重复 Worker Attempt；
- 是否发生重复 Hub/Daemon；
- 是否出现页面说成功但实际未完成的情况。

## 结果记录模板

| 检查点 | 开始/完成时间 | 操作者看到什么 | 操作者做了什么 | 结果 | 人工帮助 |
| --- | --- | --- | --- | --- | --- |
| 干净起点 |  |  |  |  |  |
| 安装包可用 |  |  |  |  |  |
| Hub 打开 |  |  |  |  |  |
| Provider 可用 |  |  |  |  |  |
| Worker 生效策略 |  |  |  |  |  |
| Main 新会话连接 |  |  |  |  |  |
| 首个 Task 提交 |  |  |  |  |  |
| Task 理解问答 |  |  |  |  |  |
| Main Review |  |  |  |  |  |
| 安全交付 |  |  |  |  |  |
| Hub/Main 恢复 |  |  |  |  |  |
| 完成 |  |  |  |  |  |

构建证据：

- ForkLight 版本：
- build identity：
- tarball SHA-256：
- 使用的 Main：
- 使用的 Worker Profile（不含 Key）：
- 模型 / Runtime：
- Task ID：
- Main Review：
- Integration operation ID：
- 15 分钟配置目标：达到 / 未达到，实际耗时：
- 30 分钟首个验收目标：达到 / 未达到，实际耗时：
- 最终结论：通过 / 带缺口通过 / 失败：
- 下一步：

## 退出判断

只有以下事实同时成立，M1.3 才能关闭：

- 新用户不接触内部状态文件就完成安装、Provider、Worker 和 Main 配置；
- 从 Hub 启动普通 Task，不编写 Task Contract；
- 能用自己的话解释输入、过程、输出、验证、失败和下一步；
- Main Review 和 Integration 没有假成功或越权；
- Hub/Main 重开后任务连续，没有重复副作用；
- 全部人工帮助和耗时如实记录。

若失败，优先把失败归入安装、权限、配置理解、任务理解、执行、验收、Main Review、Integration
或恢复其中一个阶段，只修造成旅程中断的最小产品缺口。不要为了让这一次通过而无限调整参数或重跑。
