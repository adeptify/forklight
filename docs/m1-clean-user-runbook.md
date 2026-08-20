# M1 全新用户开箱验收手册

更新时间：2026-07-30

这份手册只用于证明 ForkLight 是否真的能被一个全新本地用户使用。首次 Provider、
内置 Worker 和 Main 连接通过公开 CLI 完成，不必打开旧 Hub，也不编辑 ForkLight
数据库、状态文件、Main JSON、Task YAML 或项目源码。
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
- 用一条已检入命令生成冻结 clean-user bundle（见下一节），不要手工复制 tarball 或手写证据；
- 把冻结目录放在新用户只读可访问的位置；
- 准备一个专用于本次验收的 Provider Key，但不提前写入新用户 Keychain；
- 选择一个 Main。M1 首次退出验收默认使用 Codex；其他 Main 留作后续兼容性样本。

如果打包后源码、build identity 或 tarball 变化，本次记录作废并重新开始，不能混用两次构建。

### 生成冻结 clean-user bundle（开发用户 / release 操作者）

在当前产品源码根目录执行一条命令，并给出**尚不存在**的新输出目录：

```bash
npm run bundle:clean -- --output /Users/Shared/ForkLight-Clean-Run.<unique-suffix>
```

该命令会：

1. 在目标旁创建私有 staging，拒绝覆盖已存在目录；
2. 运行真实 `npm pack`（其 `prepack` 执行权威全量 check），解析通过的 tests passed/total；
3. 对 tarball 做 SHA-256，扫描条目中的绝对路径、路径穿越和敏感文件名（不扫描凭据内容）；
4. 在隔离 npm prefix 与隔离 `FORKLIGHT_HOME` 中安装并验证 CLI/MCP/build identity；
5. 以 detached `--no-open` 启动安装后的 Hub/daemon，核对身份后只停止本 run 拥有的进程；
6. 仅在全部通过后，把 tarball、`build-identity.json`、本手册副本和外部 `bundle-evidence.json`
   原子 rename 到输出目录。

`prepack` 全量测试会保留 release 操作者的系统 `HOME`，因为现有权威测试会通过 macOS
Keychain 判断本地 Worker 是否可用；它不会把 Provider/API 环境变量传给子进程。npm 的 cache、
user config 和 prefix 仍全部指向 staging。打包后的 CLI、MCP、Hub 与 daemon 验证则使用另一套
空白私有 `HOME`，不会继承操作者的 ForkLight 状态。

**边界：** 这条命令只证明“当前开发机上的安装包可被独立验证”。它**不是** clean-user journey，
不能代替新 macOS 用户 / 一次性 VM / 新 Mac 上的首次 Keychain、Main 安装、理解问答和 15 分钟计时。

每个冻结验收目录必须只把同目录的 `bundle-evidence.json` 当作本次构建的权威索引。该文件在
tarball 生成后写入，至少包含 tarball 文件名、SHA-256、包内 build identity、source digest、
生成时间，以及 prepack、独立安装、CLI/MCP 加载、身份对照、Hub/daemon 生命周期和敏感文件名扫描
结果。操作者先核对 JSON 中的 SHA，再使用它指向的 tarball。

不要在这份会被打进 tarball 的文档里硬编码“当前 tarball SHA”。否则更新 SHA 后重新打包会再次
改变 tarball，形成自引用。`bundle-evidence.json` 必须放在 tarball 外、与 tarball 和本手册副本
同目录，且不能包含 API Key、Hub 私有 URL或本地凭据路径。

clean run 必须使用证据文件指向的精确 tarball；若源码、包内 build identity 或 tarball 变化，
应创建新的冻结目录并把旧目录标记为 superseded，不能静默替换。

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

### 2. 安装并用 CLI 完成首次设置

操作者只执行：

```bash
npm install -g /path/to/forklight-0.2.0.tgz
forklight setup status
```

记录：

- 安装完成时间；
- `forklight` 版本和 build identity；
- `setup status` 是否用一句话说明现状、原因和唯一下一步；
- 是否没有要求打开旧 Hub。

然后按打印出的下一步完成设置，例如：

```bash
# 本机已登录 Grok 时，不要输入 API key
forklight setup provider select --provider xai

# 或在确认后从 stdin 写入一个 API-key Provider
printf '%s' "$KEY" | forklight setup provider select --provider deepseek --variant default --confirm

forklight setup worker list
forklight setup worker select --profile grok-4-6-xhigh
forklight setup main install --client grok-build --component mcp --confirm
forklight doctor
```

不得把 API key 写在命令行参数、设置文件或验收记录里。Main 安装必须显式
`--confirm`；记录是否提示需要新开 Main 会话。不得在失败后改用源码目录、
`npm link` 或手工改设置文件来掩盖安装问题。

### 3. 可选：打开 Hub 做后续监督

首次设置完成后，如需 Hub 监督界面：

```bash
forklight hub
```

记录是否只出现一个 Hub。首次 Provider / Worker / Main 设置不得再依赖 Hub 页面。

### 4. 新建 Main 会话

完成 Main 安装后关闭旧 Codex 会话并新建一个会话。新 Main 必须从 ForkLight 返回当前
Daemon 的同一 build identity。旧会话无法热加载 MCP 是允许的，但页面必须提前说明需要新会话。

这里只做本地 health，不运行 Provider Probe，不产生模型费用。

### 5. 从 Work 进入首个真实 Task

打开 Hub 后进入默认的 **Work** 页。按 Goal → Plan → Task 的层级，用白话描述想要的结果：

1. 在 Work 选择 **New Goal**（新目标），写下这个目标要达到的结果。
2. 在该 Goal 选择 **Add Plan**（+ 计划），写下这一轮计划要完成的结果。
3. 在该 Plan 选择 **Add Task**（+ 任务），写下这个任务要交付的结果。

每一步都会打开结果录入，而不会立刻创建或开始工作。ForkLight 先给出下一条记录的提案；
操作者审阅提案并明确确认后，该记录才成立。确认 Task 的提案之后工作才开始，然后进入
普通 Task Detail 观察过程。不要编写 YAML/JSON，不要编辑设置，也不要查看内部状态。

如果确认无法继续，操作者应能从页面直接说出缺少的条件，而不是查看终端日志猜测。

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

Home 备份与恢复（可选，在 Daemon/Hub 都已停止后）：

```bash
forklight backup preview --destination /safe/outside/forklight-backup
forklight backup create --destination /safe/outside/forklight-backup --confirm
forklight backup inspect /safe/outside/forklight-backup
forklight daemon stop
# 退出 Hub 进程后再恢复。恢复不会代为停止 Daemon 或 Hub。
forklight backup restore /safe/outside/forklight-backup --confirm
```

备份不包含 Keychain、本机 Grok/Codex 登录或外部 Main 配置，请单独重连。
备份目录可能含项目代码与日志，须保持私有。

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
