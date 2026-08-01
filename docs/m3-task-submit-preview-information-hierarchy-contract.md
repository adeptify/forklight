# M3 Hub 任务提交预览信息层级契约

## 用户结果

用户预览一份 Task Contract 后，应在几秒内回答四件事：将执行什么、为什么派给
这个 Worker、执行边界是什么、下一步该做什么。信息不删减，但不再像一张等权重
参数清单；历史分类候选和技术摘要仍可查看，只在需要时展开。

## 空间与阅读顺序

沿用当前 Hub 的浅色纸面、边框、圆角、字体、颜色与间距变量，不做视觉重构。
预览内部形成一个明确的纵向阅读路径：

1. **将执行什么**：Task 名称是主标题；同一处显示 Worker Profile、Provider、Model、Runtime 与 effort；明确“预览不会启动任务或消耗模型 Token”。
2. **为什么这样派**：显示候选数、选择依据、证据范围、聚合样本、Competition 安排与路由下一步；不重复展示已经在上方出现的选中 Worker。
3. **执行边界**：并排或紧凑展示预算、尝试次数、后继任务、任务说明检查与安全合入判断。
4. **分类与下一步**：直接显示当前 class/family 与分类建议；完整的已有 family 列表按需展开。
5. **技术证据**：继续默认收起。

宽屏可使用两列辅助分区，窄屏必须按相同 DOM 顺序退化为单列。长 Task、Profile、
Provider/Model 名称能够自然换行，不产生水平滚动或单字挤压。

## 模块行为与调用链

### 提交预览编排器

- 消费已有 `SafeTaskAdmissionPreview`，只负责信息分组与展示顺序。
- 产出一棵语义化、可键盘阅读的 DOM；不得重新计算 admission、routing 或 classification。
- 不启动 Task、不修改 Task 文件、不改变 submit 确认和 stale digest 保护。

### Worker 与路由说明

- Worker 身份只在“将执行什么”出现一次。
- 路由分区只解释选择依据、比较范围、证据与 Competition，不再重复选中 Worker。
- 老 daemon 没有 `routingExplanation` 时，仍诚实降级，不隐藏最终生效 Worker。

### 边界与分类说明

- 预算、尝试、后继任务、质量检查、Integration 全部保留并集中在“执行边界”。
- class、family 和分类下一步直接可见。
- 已有 family 候选列表继续完整保留在原生 `<details>` 中；当分类需要用户补充或确认时，提示必须仍直接可见。
- 技术 digest 维持默认收起。

### 样式

- 只新增提交预览专用 class，复用现有 token；不影响其他 `.preview-panel`。
- 使用间距、字体层级、分隔和布局建立分组，不给每条事实套独立卡片，也不加入渐变、装饰图标或无意义动效。
- 可点击 `<summary>` 与现有按钮保持清楚的键盘 focus。

## 必须通过的场景

1. 四候选、Main judgment、scope none、无 Competition：用户不需要读重复 Worker 行即可看懂为何直接提交。
2. 有历史证据和需要/考虑 Competition：聚合证据、触发原因和下一步均保持可见。
3. 老 Task 缺少 routing/classification advice：仍显示执行对象、边界和明确的“暂无说明”，不报错。
4. class/family 已复用：默认优先显示结论，完整 family 候选可展开查看。
5. class/family 缺失或首次出现：需要用户处理的下一步不可被技术详情一起藏起来。
6. 超长中英文 Task、Worker、Model：桌面和窄屏均无横向溢出，阅读顺序一致。
7. 预览、编辑路径、过期预览、确认提交等原行为不变；自动化测试不得触发真实 Task 或 Provider。

## 非目标

- 不修改 Core preview schema、路由算法、分类逻辑、Settings、Task admission、数据库或 economics。
- 不删掉安全投影里的事实，不新增自动路由、自动竞争、自动重试、自动合入或第二套提交按钮。
- 不触碰其他仓库、Elsewhere、Client-Core SDK，不 commit 或 push。

## 验收

- `app.js` 只消费现有安全 preview；Worker 身份在主预览中只渲染一次。
- 新增中英文分区文案，用户文案不用内部实现术语冒充解释。
- focused Hub tests、全量测试、build、JavaScript 语法和 `git diff --check` 通过。
- Main 在真实 Hub 批量检查一次桌面和窄屏关键状态，最多做一轮视觉修正，再确认一次。

