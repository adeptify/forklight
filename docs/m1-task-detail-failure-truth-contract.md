# M1 Task Detail 失败事实与下一步契约

## 用户结果

用户打开一个失败、被要求修订或被 Main 拒绝的 Task 后，三十秒内应能确认：

1. 哪一项独立检查失败；
2. 第一条可信、可读且不会泄露隐私的失败证据；
3. Main 做了什么决定；
4. 是否保留了 Candidate；
5. 当前会不会自动继续，以及要继续需要谁做什么决定。

页面不得一边显示“失败”，一边把通过行、对勾或“全部通过”当作失败原因。
“任务已被拒绝”是状态，不是下一步；下一步必须说明不会自动发生什么，以及继续所需的明确动作。

## 真实问题样本

失败 Task `e00d171d-ec9a-45a0-98f1-58cd97b59f33` 当前暴露三处矛盾：

- `npm test` 的失败摘要选中了前面的 `✔ ...` 通过行；
- 失败检查的名称被写成“要求的自动化行为测试全部通过”；
- Main 拒绝后，“你现在应该做什么”只重复“任务已被 Main 拒绝”。

成功并已合入的 Task `38c2dc62-678d-4f0e-a453-cfa7f7da950b` 是回归基准：
成功事实、纠正历史、Main 接受与 Integration 必须继续保持清楚，不能为了修失败页而退化。

## 信息与责任边界

### 服务端安全失败摘要

- 消费一项已经失败的 verification command 的 `stderr/stdout`。
- 先执行现有脱敏、路径裁剪、噪声过滤和 240 字符上限，再从安全候选中选择诊断。
- 优先真实失败信号，例如文件/行号诊断、TypeScript error、`not ok`、失败断言或明确的 fail/error 行。
- 过滤明确的通过行、测试进度、汇总噪声和命令包装；不得把 `✔`、`✓`、`ok` 或“全部通过”选作失败摘要。
- 若没有可信诊断，返回无摘要；UI 使用诚实的降级文案，不猜测原因。
- 不返回原始日志、完整 stdout/stderr、私有绝对路径、Prompt、凭据、URL Secret 或命令环境。

### 检查名称与结果

- 检查名称只回答“检查了什么”，例如“自动化行为测试”“项目编译”“改动结构”。
- 通过/失败只由相邻状态 badge 和结论表达；名称本身不得写“已通过/全部通过”。
- 详情中的计数要说清口径。失败时至少表达“共 N 项，M 项未通过”；成功时不能让“检查 0”被理解成没有检查。

### Main 决定与下一步

- 独立检查和 Main 决定是两层事实：检查失败后 Main 拒绝，应写成“检查发现问题，Main 据此拒绝”，不能说“机器检查可能已通过”。
- Main 在机器通过后仍拒绝或要求修订，继续使用“Main 发现额外问题”的说明。
- 被拒绝且没有继续授权时，明确“不自动重试、不自动合入”；若想继续，需要 Main 明确修订任务或创建后继任务。
- 要求修订时，明确“针对失败检查修正一次并重新运行同一组检查”，不得暗示无限重试。
- Candidate 若被保留，只能说明有证据留存；不得暗示已接受、可安全复用或已交付。

## 模块行为与调用链

1. Daemon 保存 verification command 的终态和有界输出。
2. Hub server 从失败命令生成脱敏、失败导向的 `failureSummary`，并构建现有安全 Journey。
3. Hub UI 用中性检查名称、结构化 verdict、Main decision 和 next action 组织 Hero 与 Overview。
4. 用户先看到一条可信原因和唯一下一步；完整命令、时间线和技术证据继续按需展开。

UI 只能消费安全 Journey，不得在浏览器重新解析原始日志或复制服务端脱敏逻辑。

## 必须通过的场景

1. **测试命令前面有大量通过行、后面才失败**：摘要必须选择失败诊断或诚实降级，不能显示对勾行。
2. **编译失败**：显示具体的安全文件/行号/类型诊断；检查名称是“项目编译”，不是“项目编译通过”。
3. **机器失败 + Main reject**：Hero 同时说明检查失败和 Main 拒绝，下一步明确无自动重试/合入。
4. **机器通过 + Main reject/revise**：保留 Main 独立判断，不伪造机器失败。
5. **机器失败 + Candidate retained**：说明保留了哪些文件，但继续需要新的 Main 决定。
6. **成功 + Main accept + Integration complete**：原有成功闭环、纠正历史和“无需进一步操作”不退化。
7. **没有安全失败摘要**：显示“该检查失败，但没有可安全展示的具体诊断”，不暴露原始输出。
8. **中英文**：两种语言都用中性检查名和行动式下一步；历史 Main/Worker 原文不被伪翻译。

## 视觉与交互边界

- 沿用现有 Task report 的布局、颜色、间距和卡片体系；本切片不重做视觉世界。
- 不增加嵌套卡片、渐变、装饰图标、统一入场动画或第二套状态系统。
- 失败信息靠真实层级和语义表达，不用红色堆叠制造恐慌。
- 更完整的 tab 键盘模式、语义 tone 和 dialog 深链作为后续独立切片，不借本任务无限扩张。

## 共享运行态门禁

Worker 只在隔离 workspace 修改和验证，不得重启 Daemon/Hub。Main 接受 Candidate 后也不能立即激活：

- 先读取全局 `activeTaskIds` 与 `queuedTaskIds`；
- 只要其他项目仍有执行中或排队 Task，就保留 Candidate，暂不执行 ForkLight 自身 Integration/activation；
- 全局空闲后才一次性合入、构建、切换同一持久 Daemon，并验证只有一个 Daemon、一个 Hub；
- 切换前后的任务记录、队列和跨项目历史必须保留。

## 非目标

- 不修改 verification 判定、Task status、Main review、Candidate、Integration 或自动重试语义。
- 不添加日志 AI 总结、翻译原始 Worker/Main 文本或新的 Provider 请求。
- 不修改 model routing、Competition、economics、Settings、数据库 schema、Keychain 或凭据。
- 不触碰 Adeptify/Nexus、Elsewhere、Client-Core SDK 或其他项目；不 commit、不 push。

## 验收

- 真实失败样本不再显示通过行或“全部通过”作为失败原因。
- 检查名称在中英文中均为结果中性；badge/verdict 单独表达结果。
- Main reject/revise 的说明根据真实 verification 结果分支，无逻辑矛盾。
- 下一步是动作与权限说明，不是状态重复；明确不会自动重试/合入。
- 服务端摘要继续满足脱敏、路径裁剪、长度上限和无安全诊断时的 fail-closed 行为。
- focused tests、全量测试、build、JavaScript 语法与 `git diff --check` 一次通过；只修 Candidate 引入的问题。

