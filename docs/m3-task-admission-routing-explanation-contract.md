# M3 提交前路由说明契约

## 用户结果

Main 或普通用户在提交 Task Contract 前，不只看到“将使用哪个 Worker”，还
能用白话看懂：这次选择主要依据什么、比较过几个候选、历史证据够不够、
以及为什么这次不竞争或为什么记录为需要竞争。

这是只读说明，不是自动路由器。它复述 Task 文件里已经冻结的
`routingDecision`；不修改 Worker、不启动 Competition、不使用私有理由文字，
也不把历史变化加入提交确认摘要。

## 输入、输出与边界

### 输入

- canonical Task admission 已解析出的可选 `routingDecision`；
- 已解析并最终生效的 Worker Profile、Provider、Model、Runtime 与 effort；
- 当前 Settings 中 Worker Profile 的公开 label，仅用于更易读的名称。

### 输出

CLI validate、daemon/MCP `validate_file` 与 Hub 提交预览共享一个安全的
`routingExplanation`：

- 是否存在提交前冻结的路由记录；
- 本次选中的 Worker 身份与可选 Profile label；
- Main 实际考虑的候选数量；
- 选择依据的闭合类型：用户指定、唯一可用、历史证据、运行能力、Main 判断或其他已记录理由；
- 历史证据范围、候选中有样本的数量、总样本数；
- Competition intent 与闭合 triggers；
- 一个面向用户的闭合下一步 code。

输出不得包含 `selectedBecause.note`、自定义 reason code、候选 identity key、
settings digest、Task 正文、路径、命令、日志、endpoint、Keychain 或凭据。

### 不变量

- 说明完全来自当前 Task 文件与已解析 Settings，不扫描可变历史；不单独改变 `previewRevisionDigest`。
- 预览不会创建 Task、写文件、改 Settings、调用 Provider、启动 Worker 或 Competition。
- Hub 只消费安全结构，不重新解释原始 `routingDecision`。
- 没有 `routingDecision` 时诚实显示“未记录选择说明”，仍可展示最终解析出的 Worker；不得伪造选择依据。
- `competition.intent` 只是 Main 在 Task 文件里的记录，不声称预览或普通 submit 已经创建 Competition。

## 模块行为与调用链

1. Task admission 只解析一次 Task 与 Settings，得到最终 Worker 和不可变路由快照。
2. Core 纯投影函数把快照变成闭合、脱敏、可序列化的说明。
3. CLI 以短文本展示；daemon/MCP 直接返回相同结构。
4. Hub 在 Worker 基本信息之后、分类复用之前解释“为什么这样派、是否竞争”。
5. 用户若修改 Task 文件，沿用既有 digest 保护，必须重新 preview；只有显式确认才提交。

## 必须通过的场景

1. exact-class 或 task-family 有样本时，只给出聚合数量，不暴露候选 identity key。
2. scope=none 时明确说明主要是 Main 判断或显式用户选择，不能包装成模型优胜结论。
3. shortlist 只有一个候选时，说明没有形成多 Worker 比较；不暗示已运行竞争。
4. intent=none/consider/required 与四种 trigger 都有中英文人话文案。
5. 自定义 reason code 与私有 note 不出现在 JSON、CLI 或 Hub。
6. 缺少 routingDecision 时安全降级，不报错、不伪造证据。
7. 返回对象深度脱离原始 Task 数据，调用方修改输出不能污染 TaskSpec。
8. Hub 中文预览能回答“选谁、为什么、比较范围、是否竞争、接下来是什么”，且无 console error。

## 非目标

- 不实现自动路由、自动填写 routingDecision、自动竞争或一键改 Worker。
- 不改变路由评分、样本门槛、Task admission、Settings、数据库或 economics。
- 不展示 Main 的自由文本 note；Task 完成后的详情页原有审计展示不在本切片迁移。
- 不触碰其他仓库、Elsewhere、SDK、commit 或 push。

## 验收

- Core 只有一个安全投影，CLI、daemon/MCP、Hub 不复制判断规则。
- focused tests、全量测试、build、Hub JavaScript 语法与 `git diff --check` 全通过。
- 真实 Hub 用本任务 YAML 预览验收，不提交任务。
