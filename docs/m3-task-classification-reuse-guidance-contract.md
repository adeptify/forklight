# M3 Task 分类复用建议契约

## 用户结果

Main 在提交 Task Contract 之前，可以直接看懂这次 `taskClass` 和
`taskFamily` 是沿用已有分类、首次出现，还是根本没有填写。ForkLight
同时展示少量已有稳定 family 及其真实记录数量，帮助 Main 复用语义相符
的分类，避免每次新造名字导致 M3 证据永远无法形成可比较样本。

这只是分类建议，不是自动分类。ForkLight 不根据名称猜语义，不修改 Task
文件，不阻止新分类，不改变 Worker 选择，也不启动 Competition。

## 白话定义

- **精确工作类型（taskClass）**：描述这次具体工作的稳定短名称，用于精确历史比较。
- **稳定大类（taskFamily）**：把语义相近的 taskClass 放进较稳定的大类，在精确样本不足时提供更宽的证据范围。
- **复用建议**：只陈述“这个名字以前是否出现、出现多少次、已有 family 有哪些”，不声称两个名字语义相同。
- **完整选择记录**：同一终态普通 Task 同时保存 taskClass、taskFamily 与 routingDecision；数量只表示可追溯性，不表示模型质量。

## 输入、输出与边界

### 输入

既有 Task admission preview 已经解析出的可选 `taskClass`、可选
`taskFamily`，以及本地 StateStore 中已经结束的普通 Task。Review Graph
裁判 Task 和未结束 Task 不进入分类历史。

### 输出

`validate_file`、CLI `validate`、MCP 预览和 Hub 预览共享一个安全的
`classificationAdvice`：

- 当前 taskClass / taskFamily 是 `missing`、`new` 或 `existing`；
- 相同 class / family 的终态 Task 数；
- 其中带完整选择记录的数量；
- 最多 8 个已有 family，每项只含 family 名称、终态 Task 数、完整选择记录数和不同 class 数；
- 一个闭合的下一动作 code，例如沿用当前分类、补充 family、确认确实需要新 family。

列表按完整记录数、终态数量和名称稳定排序。它是候选清单，不是语义推荐或排行榜。

### 不变量

- 分类历史变化不使已经生成的 admission preview digest 失效；digest 继续只绑定 Task 文件与准入设置。
- 修改 Task 文件中的 class/family 会改变文件 digest，因此必须重新 preview 后才能提交。
- 预览不会注册 Task、写数据库、准备 workspace、探测 Provider、启动 Worker、修改 Settings 或触发 Competition。
- 输出不含 Task ID、Task 名称、项目路径、命令、prompt、日志、Main 私有理由、endpoint、Keychain 或凭据。
- 新 family 永远可以保留；Main 是语义判断者，ForkLight 不能按字符串相似度自动替换。

## 模块行为

### 1. 分类证据投影

消费：当前 class/family 与终态普通 Task 的公开分类元数据。

生产：有界、稳定排序、可序列化的分类复用建议。

边界：不读取模型评分、Worker Token、失败日志或私有路由理由；不推断语义。

### 2. Task admission preview

消费：同一次已解析 TaskSpec、当前 Settings 和只读历史快照。

生产：现有 Worker / Quality / Integration 预览，加上独立的
`classificationAdvice`。

边界：分类建议不得进入 preview revision digest，不能让另一个任务结束导致用户必须重新预览。

### 3. CLI、MCP 与 Hub

CLI `validate` 用简短文字说明当前分类状态和下一动作；MCP `validate_file`
返回结构化建议供 Main 使用；Hub 在“预览后再提交”卡片里先解释当前分类，
必要时列出已有 family 供用户回到 Task 文件中选择。

边界：Hub 不在本切片内直接编辑文件，不提供“一键替换”，也不把 family
列表包装成自动推荐。

## 调用链

1. Main 写好 Task Contract，并显式选择或省略 class/family。
2. CLI、MCP 或 Hub 请求只读 admission preview。
3. canonical preview 解析一次 TaskSpec 并计算原有准入事实与 digest。
4. 分类投影读取当前终态普通 Task，判断名称是否已存在并生成最多 8 个 family 候选。
5. 调用方先说明“这次是否复用分类、为什么”，再展示已有 family 与真实计数。
6. Main 决定保持新分类或修改 Task 文件；任何文件修改都必须重新 preview。
7. 只有 Main 后续显式确认，原有 submit 路径才创建 Task；分类建议本身不参与提交授权。

## 必须通过的场景

1. **已有 class 与 family：** 两者都显示 existing，并返回各自真实终态数与完整记录数。
2. **新 class、已有 family：** 明确说明精确类型首次出现，但正在复用已有大类；不建议 Competition。
3. **新 family：** 明确要求 Main 确认这是有意的新大类，同时展示已有 family 候选但不自动选择。
4. **缺少 family：** 提醒补充或确认，同时保持 Task preview 只读；Quality 的既有准入结果不被偷偷改写。
5. **历史变化：** 同一 Task 文件和 Settings 在另一个历史 Task 结束前后产生相同 preview revision digest，分类计数可以更新。
6. **裁判与运行中 Task：** Review Graph reviewer 和非终态 Task 不增加任何分类数量。
7. **有界与稳定：** 超过 8 个 family 时稳定截断；相同数据重复调用得到相同顺序和非共享可变对象。
8. **隐私：** JSON、CLI 和 Hub 不出现 Task ID、任务名、路径、命令、prompt、日志、路由私有理由或凭据。
9. **真实 Hub：** 中文预览能让用户看懂分类是否复用、下一步是什么，页面无 console error。

## 非目标

- 不自动生成、重命名、合并或迁移历史 taskClass/taskFamily。
- 不用向量、字符串相似度或模型调用猜测分类语义。
- 不改变 M3 评分、样本门槛、Worker Profile、路由结果、Competition、失败归因或成本算法。
- 不修改 Task submission digest、确认流程、Settings schema 或数据库 schema。
- 不触碰其他仓库、Elsewhere、SDK、commit 或 push。

## 验收重点

- 一个纯投影函数覆盖 existing/new/missing、排除规则、排序、截断、不可变与隐私。
- CLI 与 daemon/MCP 使用同一投影含义；Hub 不复制统计规则。
- preview digest 不受历史变化影响，文件或 Settings 变化仍按原规则 fail closed。
- Hub 只消费安全结构化字段，以中英文解释现状、含义和下一步。
- 聚焦测试、全量测试、build、Hub JavaScript 语法和 `git diff --check` 全部通过。
