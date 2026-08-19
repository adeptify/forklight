# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

ForkLight 当前首先服务一位在本机使用 Codex、Grok CLI、Claude Code 等 AI Runtime 推进真实项目的个人开发者。用户愿意让 Main 和 Worker 分工完成较长的工作，但不应为了监督执行而先学会 ForkLight 的内部状态码、ID、数据库结构或 Agent 术语。

M5 还必须服务一位此前不了解 ForkLight、但熟悉基本本地开发操作的开发者。这个人应能在界面和正常命令引导下完成配置、运行真实 Task、理解结果、作出 Main 决定并安全集成，不查看数据库，也不手工编辑配置文件。

## Product Purpose

ForkLight 是本地优先的 AI 工作执行与交付工作台。Main 负责理解目标、拆分工作、设定验收和作出关键决定；Worker 在隔离空间完成普通执行；ForkLight 保存执行真相、独立验证结果、审查意见、部分成果和安全集成记录。

产品成功意味着用户打开 Hub 后能迅速回答：

- 当前要实现什么；
- 现在进行到哪里，事实依据是什么；
- 是否需要自己作决定；
- 已经保留了哪些成果；
- 接下来会发生什么。

## Positioning

ForkLight 不是任务清单、模型排行榜、Agent 聊天记录浏览器或自动放任的多 Agent 系统。它的差异机制是把一项工作的完整交付链放在同一份持久真相中：Goal 与 Plan 的上下文、Task 执行、Runtime continuation、Candidate、独立验证、Judge 意见、Main 决定、安全 Integration、恢复和 Workspace 处置都能被追溯，但首先以人能理解的结果、原因和下一步呈现。

GoalBoard 与 ForkLight 属于同一产品家族，但边界不同：GoalBoard 管理“目标是什么、为什么做、怎样才算完成”的目标真相；ForkLight 管理“现在怎样执行、结果是否可信、怎样决定与交付”的执行真相。两者可以共享产品语言和使用习惯，但当前不共享数据模型，也不互相冒充对方的权威来源。

## Operating Context

V1 是单人、单机、本地优先产品。用户通常在一个真实代码项目中由 Main 建立 Goal、Plan 和有界 Task，选择 Worker Profile，预览执行边界，启动隔离 Worker，等待 ForkLight 独立验证和 Judge 审查，再由 Main 接受、退回或停止，最后通过安全预检与 Integration 交付。

CLI、MCP、Daemon 和 Hub 消费同一份 ForkLight Store 真相。Hub 是面向人的主要理解与决定界面；CLI 和 MCP 仍是自动化、诊断和 Runtime 接入入口。Hub 打开或刷新不应改变执行状态，也不能打断阅读、筛选或尚未提交的输入。

用户进入 ForkLight 时默认看到当前 Goal 的执行现场，而不是模型配置或全局统计。安装、Runtime、Worker、Main 接入、备份恢复和诊断属于辅助设置流程；缺少必要配置时，当前工作页面应给出清楚的原因和可执行下一步。

## Capabilities and Constraints

- Goal、Plan、Task 层级必须清楚；当前工作与历史结果分开。
- Task 提交前必须用人话预览结果、原因、推进方式、执行边界和需要用户确认的事项。
- 进行中、等待决定、阻塞、失败、部分完成和已完成必须分别表达，不能只靠颜色或状态码。
- Worker 声明、ForkLight 独立验证、Judge 意见和 Main 决定必须分清来源，不能把建议写成已执行，也不能把失败包装成成功。
- 可复用部分成果、恢复位置、Workspace 保留或回收、安全预检、Integration 与回滚真相必须可见，但技术细节默认折叠。
- Runtime、Attempt、Token、费用、耗时、修正次数和原始日志是追查执行与成本时使用的详情，不是首页主要成果。
- 需要用户判断的事项集中在一个决定中心，不在 Goal、Plan、Task 和其他页面重复完整操作。
- 默认中文并提供独立可读的英文文案；不得依赖机器码的直译。
- 当前不为多人组织、云同步、跨节点一致性、锁、租约、checksum 或版本握手设计 UI 或产品流程。
- 旧 ForkLight Hub 的视觉、导航、布局和组件体系不再是设计权威；只保留已经验证的产品功能、真实数据和安全边界。
- M5 不修改 GoalBoard 仓库，也不新增 ForkLight 与 GoalBoard 的真实跨应用数据连接。

## Brand Commitments

产品名使用 ForkLight。ForkLight 与 GoalBoard 必须让人感到属于同一套本地 AI 开发产品：共同的产品语言、信息节奏、交互习惯和完成度，而不是两个偶然相似的网站。ForkLight 是这个家族中的“执行与交付工作台”。

界面语言必须直接、简洁、具体。优先说“正在做什么”“为什么停在这里”“需要你决定什么”“已经保留什么”“下一步怎么走”，避免用 `native-goal`、`Attempt`、`Revision`、`awaiting-main-decision` 等内部词代替解释。这些词只在技术详情中按需出现。

当前没有确认的 ForkLight Logo、独立品牌字体、客户案例或商业指标，不得虚构。现有 Hub 外观是明确的反例，不作为后续视觉延续依据。

## Evidence on Hand

- `goals/forklight-main-led-execution/contract.md`：当前长期 Goal、M5 UI 补充要求和退出条件。
- `goals/forklight-main-led-execution/plan.md`、`progress.md`、`decisions.md`：M2–M4 已毕业能力、M5 顺序和真实边界。
- `goals/forklight-main-led-execution/evidence/`：Runtime Goal、依赖、验证、Judge、Main 决定、部分成果、Integration、Workspace 生命周期和 Main Token 价值证据。
- `src/hub/`：现有可复用功能和 API 消费行为；其视觉与信息架构不作为设计权威。
- `/Users/yijunwang/code/goalboard/PRODUCT.md` 与 `DESIGN.md`：产品家族中已经确认的 Goal 真相边界、连续目标文件和决定中心设计语言。
- 当前没有外部客户证言、公开使用数据或可用于营销的商业证明；M5 只能使用真实本地运行和陌生开发者旅程作为验收证据。

## Product Principles

1. 先让人看懂，再让系统展开细节。
2. 先讲结果、事实、原因和下一步，再讲内部过程。
3. 一个执行真相，按不同任务提供清楚视图，不重复制造状态。
4. 用户决定只有一个入口，机器建议不能替代人的授权。
5. 失败也必须交代已完成和已保留的价值。

## Accessibility & Inclusion

Hub 必须支持键盘操作、清晰焦点、语义化结构、可读对比度、桌面与移动端布局以及减少动态效果偏好。颜色不能成为区分状态的唯一方式。实时更新必须保留当前选择、滚动位置、筛选条件和未提交内容；移动端关键状态、决定和下一步不能藏在难以发现的菜单中。
