# M3 同一大类内的任务类型复用契约

## 用户结果

当 Main 在一份 Task Contract 里选择了一个已有 `taskFamily`，但填写的
`taskClass` 是首次出现或尚未填写时，提交预览会直接展示这个大类里已经存在的
少量稳定工作类型及真实历史数量。Main 因而能先判断“这次是否真的需要新名字”，
避免语义相同的工作不断产生一次性 class，导致后续模型比较始终没有可复用样本。

这不是自动分类，也不是排行榜。ForkLight 不猜两个名字是否同义，不替换 Task
文件，不阻止新 class，不改变 Worker 选择，也不启动 Competition。

## 白话定义

- **当前工作类型**：这份 Task Contract 明确填写的 `taskClass`。
- **同一大类已有类型**：只统计与当前 `taskFamily` 完全相同的终态普通 Task，并按它们实际保存的 `taskClass` 聚合。
- **完整选择记录**：同一终态普通 Task 同时保存 class、family 与 routingDecision；数量表示可追溯性，不表示质量或推荐强度。
- **复用候选**：供 Main 按真实语义判断的历史名称，不是 ForkLight 的语义推荐。

## 输入、输出与边界

### 输入

沿用现有 classification advice 的同一份输入：已经解析的可选 `taskClass`、可选
`taskFamily`，以及本地终态普通 Task 历史。运行中 Task 和 Review Graph 裁判 Task
继续排除。

### 输出

在现有 `classificationAdvice` 中增加 `classChoices`：

- 只有当前 family 已存在时才可能返回；缺失或首次出现的 family 返回空数组；
- 每项只含 `taskClass`、同 family 下的终态 Task 数、完整选择记录数；
- 最多 8 项；
- 按完整记录数、终态数量、稳定名称顺序排列；
- 返回全新、深度冻结的数据，不引用历史 Task 对象。

Hub 只在“当前 class 缺失或首次出现，且 family 已存在”时展开这组候选。当前
class 已经复用时不增加视觉噪声。CLI 的人类可读预览同样列出候选，结构化
daemon/MCP 预览自然携带这一安全投影。

### 不变量

- classChoices 不进入 `previewRevisionDigest`；兄弟 Task 完成只会更新建议，不会让已确认的提交预览过期。
- 不修改 Task 文件、历史 Task、Settings、数据库、Worker、路由、Competition、重试或 Integration。
- 不使用字符串相似度、embedding、模型调用或历史质量分数判断语义。
- 不返回 Task ID、任务名、路径、命令、prompt、日志、Provider/Model 身份、Main 私有理由、endpoint、Keychain 或凭据。
- Main 始终可以保留一个有意的新 class；ForkLight 只提供真实历史上下文。

## 模块行为

### 分类证据投影

消费：当前 family 和终态普通 Task 的公开 class/family/route-presence 元数据。

生产：最多 8 个同 family 的 class 名称及透明计数。

边界：不读取执行结果、模型评分、成本、Token、失败日志或私有路由理由。

### Admission preview

消费：现有安全 classification advice。

生产：CLI、daemon/MCP 与 Hub 共享的 `classChoices`。

边界：不创建第二套统计、不进入 digest、不影响 submit authority。

### Hub 表达

消费：安全的 classChoices 和 current class/family state。

生产：在确实需要 Main 判断时展开的“同一大类里已有的工作类型”，并明确说明
“请按含义判断，系统不会自动替换”。

边界：不提供一键改写、不称为推荐或最佳、不暴露任务身份。

## 调用链

1. Main 写好 Task Contract，并选择一个已有 family。
2. CLI、MCP 或 Hub 请求只读 admission preview。
3. canonical classification projection 从同一 eligible cohort 聚合同 family 的 class。
4. 结构化预览返回有界 classChoices，digest 保持原定义。
5. Hub 在 class 缺失或首次出现时展开候选；CLI 以简短列表显示。
6. Main 根据任务真实含义保持新 class 或编辑文件复用已有 class；任何文件编辑仍需重新 preview。
7. 只有 Main 明确确认，原 submit 路径才创建 Task。

## 必须通过的场景

1. **新 class、已有 family：** 展示同 family 的已有 class 与真实计数，不把其他 family 的 class 混入。
2. **缺失 class、已有 family：** 同样提供候选并说明由 Main 判断。
3. **已有 class：** 数据可安全携带，但 Hub 不额外展开候选制造噪声。
4. **新或缺失 family：** classChoices 为空，因为系统没有明确范围，不能跨 family 猜测。
5. **排序与上限：** 超过 8 个 class 时稳定截断；完整记录多者优先，其次终态数量和名称。
6. **排除与隐私：** 运行中 Task、Review Graph 裁判以及所有私有字段不进入结果。
7. **历史变化：** classChoices 可变化，但同一文件与 Settings 的 preview digest 不变。
8. **真实 Hub：** 中英文都能让非技术用户看懂“已有名字、真实数量、由谁决定”，窄屏不溢出且无 console error。

## 非目标

- 不自动生成、重命名、合并、迁移或改写 class/family。
- 不做语义搜索、相似度排序、模型推荐或 Competition 建议。
- 不改变 M3 评分、样本门槛、路由算法、Settings schema、数据库 schema 或经济性统计。
- 不新增页面或设计系统，不触碰其他仓库、SDK、Elsewhere，不 commit 或 push。

