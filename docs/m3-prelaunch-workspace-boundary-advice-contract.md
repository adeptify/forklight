# M3 Worker 启动前的 Workspace 边界提示契约

## 用户结果

用户预览 Task Contract 时，就能知道当前项目里是否存在“Git 已经忽略，
但 ForkLight 仍会复制给 Worker，并在未来改动时按普通源码处理”的目录根。
这让用户在消耗模型 Token 前检查 `workspace.exclude` 与
`workspace.generatedPaths`，减少无关文件进入上下文、补丁膨胀和做完后才发现
无法安全合入的概率。

这是一条谨慎的提示，不是自动判断。Git ignore 只能证明 Git 忽略该目录，
不能证明它一定是生成物；ForkLight 不自动修改 Task、不阻断提交，也不根据
`dist`、`build`、`target` 等名字猜用途。

## 输入、输出和边界

### 输入

- canonical admission 已解析出的 `TaskSpec.project`；
- Task 当前不可变的 `workspace.exclude` 与 `workspace.generatedPaths`；
- 本地 Git 对当前项目返回的 ignored directory roots。

### 安全输出

CLI、daemon/MCP 与 Hub 共享一个 `workspaceBoundaryAdvice`：

- 检查状态：`clear`、`review` 或 `unavailable`；
- Git 返回的 ignored directory root 数量；
- 已被现有 PathPolicy 覆盖的数量；
- 仍会作为普通源码进入 Worker 的数量；
- 一个闭合的下一步：继续、检查 workspace 边界，或手动检查；
- 不可用时只返回闭合原因，不返回 Git stderr。

输出不得包含项目绝对路径、相对目录名、文件名、Git 输出、命令、Task 正文、
prompt、endpoint、Keychain、凭据或任意文件内容。计数必须有确定上限并使用安全整数。

### 检查语义

- 只运行固定的只读 Git ignored-roots 查询，不读取文件内容，不调用 Provider，
  不创建 Task，不准备 workspace，不写源码或设置。
- 只统计 Git 明确返回为目录根的条目；单个 ignored 文件不伪装成目录风险。
- 每个 ignored root 继续交给现有 `PathPolicy` 判定。已经由 snapshot exclusion、
  built-in generated pattern 或 Task `generatedPaths` 覆盖的 root 不计入待检查数量。
- 仍为 `default-business` 的 ignored root 才进入 `review` 计数。
- 非 Git 项目、Git 不可用、超时、输出被截断或异常都 fail closed 为
  `unavailable`；不能显示“没有风险”。
- 结果是时间点提示，不进入 `previewRevisionDigest`，也不改变 admission 权限。

## 模块行为与调用链

### Workspace boundary assessor

- 消费项目目录、PathPolicy 和固定只读 Git 查询结果。
- 产出深冻结、脱敏、只有计数和闭合状态的 advice。
- 不解析 `.gitignore` 文本，不依据目录名猜测，不返回路径，不修改策略。

### Admission preview composition

- `prepareTaskAdmission` 在 Task 与 Settings 已解析后执行一次只读检查。
- `projectSafeTaskAdmissionPreview` 只挂载 assessor 的安全结果。
- CLI validate、daemon/MCP `validate_file` 与 Hub 直接消费同一结构。
- advice 不进入 digest；Task 文件、Settings、质量与 Integration 权限仍由现有
  digest 和 submit revalidation 保护。

### Human presentation

- `review` 时直接说明：有多少 Git-ignored 目录仍会进入 Worker、这不证明它们
  是生成物、用户应检查 exclude/generatedPaths 后再决定是否继续。
- `clear` 时简短说明当前没有发现该类事实，不声称未来 Worker 不会生成新目录。
- `unavailable` 时说明本次无法检查，需要手动确认；不展示内部错误。
- Hub 把提示放在“执行边界”中，不增加新的设置写入按钮或第二套提交路径。

## 必须通过的场景

1. 临时 Git 项目有两个 ignored directory roots，其中一个被 `exclude` 覆盖、
   一个仍为 business：结果为 `review`，计数分别准确，输出不含目录名。
2. ignored root 只被 `generatedPaths` 覆盖：计为已覆盖，不产生 review。
3. ignored 单文件：不计为 directory root。
4. 非 Git 目录或 Git 查询失败：结果为 `unavailable`，不返回 stderr 或路径。
5. Git 输出超限或超时：结果为 `unavailable`，不把部分扫描说成完整。
6. advice 变化不改变 `previewRevisionDigest`，也不创建 Task、Attempt、Workspace、
   Provider 请求、Competition 或设置变更。
7. CLI、daemon/MCP 与 Hub 的中英文含义一致；旧 daemon 缺字段时安全降级。
8. 本 ForkLight Task YAML 的真实 preview 能发现当前项目确有至少一个 ignored
   directory root 仍作为 business 进入 Worker，但预览本身不提交 Task。

## 风险与约束

- Git ignore 不等于生成物；文案必须要求用户判断，不能自动加 exclude。
- 返回目录名会扩大 Task preview 的隐私面；本切片只返回计数。
- 在预览里递归扫描和读取文件内容会增加延迟与泄露面；只用固定 Git 元数据查询。
- 部分输出不能当完整结果；任何超时/截断都返回 unavailable。
- 该提示不能阻断用户有意让 Worker 读取 ignored 本地目录的场景。

## 非目标

- 不解析项目构建脚本，不维护 `dist/build/target` 名称黑名单，不推断目录用途。
- 不自动编辑 Task YAML、Settings、PathPolicy、focusPaths、exclude 或 generatedPaths。
- 不改变 snapshot copy、Patch 分类、Integration、Worker prompt、路由、Competition、
  retry、adaptation、数据库或经济性统计。
- 不展示目录路径或添加 privileged detail endpoint。
- 不触碰 Elsewhere、Client-Core、client-app-adeptify、SDK 发布目录或其他项目；
  不 commit、不 push。

## 验收

- 一个 canonical assessor；CLI、daemon/MCP、Hub 不复制判断逻辑。
- Core 夹具覆盖真实 Git ignored directory、exclude、generatedPaths、ignored file、
  非 Git、失败/截断/超时、隐私、深冻结和 digest 不变。
- Hub 用可执行 renderer 测试中英文 `clear/review/unavailable/legacy`，review 提示
  位于技术 digest 之前且不出现目录名。
- focused tests、`npm run check`、两份 Hub JavaScript syntax 与
  `git diff --check` 通过。

