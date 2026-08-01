# M3 Task 草稿分类安全复用契约

## 用户结果

当 Hub 的任务提交预览发现当前 `taskClass` 缺失或首次出现，并列出同一
`taskFamily` 里已有的工作类型时，用户可以明确点击“使用这个类型”。
ForkLight 只修改尚未提交的 Task Contract 草稿中的 `taskClass`，随后立即
重新预览。用户不需要手工打开 YAML，也不会因为一次点击直接启动 Worker。

这个动作不是自动分类。ForkLight 不判断两个类型是否同义，不默认选择第一项，
也不改变 family、Worker、路由决定、执行策略或验收合同。只有用户选择当前预览
真实列出的已有类型并再次确认时，才允许写入。

## 输入、输出与安全边界

### 输入

- Task Contract 的绝对路径；
- 当前预览的 `previewRevisionDigest`；
- 用户明确选择的 `taskClass`；
- `confirm: true`。

### 成功输出

- Task 草稿仅把根级 `taskClass` 改成所选已有名称；
- 原文件的其他字段、注释和文件权限保持；
- 返回写入后的全新安全 admission preview；
- 新 preview 显示该 class 已存在，并产生新的 digest；
- Task 仍未提交，没有 Task、Attempt、Worker、Provider 请求或 Competition。

### 写入前必须同时成立

1. 路径是绝对路径，目标是普通文件而不是 symlink；
2. 当前文件与 Settings 计算出的 digest 精确等于调用者确认的 digest；
3. 当前 family 是历史中已有 family；
4. 当前 class 状态是 missing 或 new；
5. 所选名称与当前 canonical `classChoices` 中某一项逐字相同；
6. 文件仍能按现有 Task parser 解析，并且只改变根级 `taskClass` 后仍能完整通过 admission；
7. 同一路径没有另一条分类写入正在进行。

任一条件不成立都必须在写入前拒绝。失败不得留下半写文件、临时文件、Task、
Attempt 或提交副作用。原文件在构造并验证完整新内容成功之前保持不变；最终替换
使用同目录原子 rename，并保留原权限。进程崩溃最多留下不含凭据的私有临时文件，
正常错误路径必须清理。

## 模块行为

### Core 草稿分类动作

消费：绝对 Task 文件、期望 digest、明确选择和当前 Settings/历史。

生产：更新后的文件和全新 `SafeTaskAdmissionPreview`。

边界：复用现有 parser、preview 和 `classChoices`；不复制分类统计，不按相似度选择，
不修改数据库或 Task 生命周期。JSON 与 YAML 都必须保持各自格式；YAML 注释应保留。

### Daemon 权威入口

消费：`reuse_task_class` 的四个显式参数。

生产：安全预览或闭合拒绝原因。

边界：Daemon 再次验证 digest 和候选，不信任 Hub 提交的显示状态；同一路径并发动作
fail closed。普通 validate/submit 语义保持不变。

### Hub 操作

消费：当前 preview 的 class choices、输入框中的同一绝对路径和当前 digest。

生产：每个候选旁的“使用这个类型”按钮、一次明确确认、成功后的新预览和人话反馈。

边界：按钮不能直接改 DOM 假装成功；必须等待 Daemon 写入并返回新 preview。请求期间
禁用提交和分类按钮。失败保持旧预览但禁用提交，提示重新预览；不展示原始文件内容、
Daemon 堆栈、内部临时路径或凭据。

## 调用链

1. 用户用现有绝对路径预览 Task Contract。
2. canonical preview 返回 missing/new class、existing family、`classChoices` 和 digest。
3. Hub 展示候选，但不预选。
4. 用户点击某一项并确认。
5. Hub 把路径、旧 digest、精确 class 和 confirm 交给 Daemon。
6. Daemon 在同一路径锁内重新读取、重新 preview、验证候选，构造并验证只改 class 的新内容。
7. Daemon 原子替换草稿，再从实际文件生成新 preview。
8. Hub 用新 preview 重绘；用户仍需单独点击“提交任务”。

## 必须通过的场景

1. **正常复用：** missing/new class + existing family + 当前候选，文件只改 class，新预览为 existing。
2. **无自动动作：** 只预览、展开列表或键盘聚焦不会写文件、提交 Task 或发起 Provider 请求。
3. **过期预览：** 文件或 Settings 在确认后变化，旧 digest 被拒绝，文件保持变化后的真实内容。
4. **伪造候选：** 名称不在当前 classChoices，写入前拒绝。
5. **状态已变化：** 当前 class 已经 existing，重复调用拒绝，不能借此任意改 class。
6. **并发动作：** 同一路径第二个进行中的写入拒绝，不出现后写覆盖前写。
7. **文件安全：** relative path、symlink、目录、坏 YAML/JSON、不可写文件和解析后 admission 失败均不破坏原文件。
8. **格式保留：** YAML 注释和 JSON 格式边界有行为测试；除根级 taskClass 外语义不变，权限不变。
9. **Hub 失败：** 返回闭合人话错误，清除可提交状态，要求重新预览，不泄露路径内容或内部诊断。
10. **真实 Hub：** 中英文按钮与确认能被普通用户理解；476px 无横向溢出、无 console warning/error，成功后仍需独立提交。

## 非目标

- 不自动选择、推荐、生成、合并或迁移 class/family；
- 不修改已创建 Task 或历史记录；
- 不改变 routing、Competition、Worker Profile、Settings、重试、纠正、Integration 或经济性统计；
- 不构建通用文件编辑器，不开放任意字段写入；
- 不触碰其他仓库、Elsewhere、Client-Core，不 commit 或 push。

