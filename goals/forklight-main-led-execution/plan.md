# ForkLight Main-led Execution — Plan

This is the executable roadmap for `contract.md`. It records only current Milestone structure;
machine events stay in ForkLight Store and evidence summaries stay in `evidence/`.

## Inherited baseline

M1 is already graduated and archived as historical evidence. Context-first Goal/Plan/Task and its
CLI/API entry paths are reused, not rebuilt. Overall product progress starts at 1/5.

## M2 — Persistent high-quality delivery and storage lifecycle

User result: Worker owns ordinary execution from research through reviewed delivery, survives
interruption, and leaves no unexplained disk/process residue.

The focused 2026-08-14 audit resolved the candidate streams into these accepted Work Items:

- **M2-A Grok execution truth** — [`specs/m2-a-grok-execution-truth/spec.md`](../../specs/m2-a-grok-execution-truth/spec.md).
  Add and smoke a Grok 4.6 Xhigh Profile; name existing resumable behavior
  `persistent-session`; keep `nativeGoal: unsupported`.
- **M2-B Quality and decision chain** — [`specs/m2-b-quality-decision-chain/spec.md`](../../specs/m2-b-quality-decision-chain/spec.md).
  Freeze an explicit 0/1/2-Judge requirement, enforce it before Integration, and compose existing
  self-check, verifier, Review Graph, correction/reuse/handoff and delivery truth into one Main
  decision packet.
- **M2-C Task storage lifecycle** — [`specs/m2-c-task-storage-lifecycle/spec.md`](../../specs/m2-c-task-storage-lifecycle/spec.md).
  Add auditable storage audit/preview/confirmed reclaim, terminal disposition, orphan detection and
  Store integrity through CLI/API.

The first wave is serial: **M2-A → M2-B → M2-C**. A and B share Task execution/public types; B and
C share Task types, daemon protocol/coordinator, CLI/MCP and delivery eligibility. These are real
write and interface overlaps, so isolated Workspaces do not make them orthogonal. Main integrates
and checks each Candidate before starting its dependent. The second wave remains one Coding and one
non-Coding long-running dogfood journey, each including interruption/restart and independent
review; it starts only after the required A/B/C product paths are integrated.

M2-A executes through the validated runtime Goal at
[`execution/m2-a/goal.json`](execution/m2-a/goal.json). Its implementation milestone is Integration-
gated; three later read-only milestones audit post-Integration truth, legacy/public compatibility,
and generated-output/scope boundaries. This operational Goal is the M2-A delivery lineage, not a
second project roadmap and not evidence that M2 as a whole graduated.

M2-A and M2-B have completed. M2-B's delivered lineage is
[`execution/m2-b/goal.json`](execution/m2-b/goal.json): Main returned one missed compatibility gap
through a durable Candidate handoff, reused all accepted paths, then safely integrated the corrected
exact Candidate and completed three zero-diff audits. M2-C is now the ready serial Work Item. Its
first high-risk implementation Task must freeze `requiredJudges: 2` through M2-B's delivered
admission contract; its operational Goal uses one Integration-gated implementation followed by
read-only post-Integration lifecycle, surface, and real-preview audits.

M2-C now executes through [`execution/m2-c/goal.json`](execution/m2-c/goal.json). Its implementation
Task freezes `requiredJudges: 2`; each zero-change audit freezes an explicit `requiredJudges: 0`
reason. The operational Goal completes code and integrated-source evidence. Main then uses the
delivered product for a read-only real-home audit/preview and confirms only ordinary eligible Task
reclaim before M2-C graduation evidence is recorded.

The original operational Goal remains `waiting` at its frozen `correction-cap`. Its reusable
successor Candidate passed build, 346 focused tests and diff validation, but fresh Judges disagreed
and Main confirmed five remaining safety/output gaps now frozen in the accepted M2-C spec. 一骏
explicitly authorized one new narrow recovery Work Item on 2026-08-14. It executes through
[`execution/m2-c-recovery/goal.json`](execution/m2-c-recovery/goal.json): one Integration-gated
Grok 4.6 Xhigh Task imports the exact 17-path Revision into a clean current-source Workspace using
the existing handoff patch format and fixes only the five gaps, followed by the three existing
serial read-only audits. The original Goal, Workspaces, Candidate, Review Graph and stop packet stay
immutable evidence; no second-hop handoff, Store rewrite, source patching or pre-review Integration
is used.

Recovery Goal `execution/m2-c-recovery/goal.json` then completed 4/4 and the source full check
passed 2,916 tests. The first required real-home audit/preview found one remaining graduation
blocker: an authentic pre-`origin` Competition handoff makes the shared handoff projection throw.
The serial supplement
[`real-store-legacy-handoff-compat/spec.md`](../../specs/m2-c-task-storage-lifecycle/work-items/real-store-legacy-handoff-compat/spec.md)
normalizes only that old durable read shape, with no Store rewrite or coordination machinery.
That Candidate was independently verified, accepted by two Judges, safely integrated and audited.
The real audit/preview then succeeded and Main's authorized all-eligible reclaim durably completed
248/248 dispositions. The operation took about 32 seconds, so the generic 15-second client window
returned a transport timeout before the completed result. M2-C's final serial supplement is
[`reclaim-transport-observation/spec.md`](../../specs/m2-c-task-storage-lifecycle/work-items/reclaim-transport-observation/spec.md):
one shared daemon-client timeout correction, two Judges, safe Integration, and one zero-diff audit.
It runs through `execution/m2-c-reclaim-transport/goal.json`. No destructive journey is replayed.

That supplement completed 4/4. Candidate `6d28c588-3fa8-4610-a20e-be8df0497d1d` passed
independent verification, two different-view Judges, Main accept and safe Integration
`ca098a68-2f5f-44b7-93a7-a4fe14846816`; the source full check passed 2,924 tests. A naturally
eligible post-fix three-Task batch then ran beyond the old 15-second window and returned 3/3
applied through CLI with integrity `ok/0`. Final audit has zero reclaimable and zero unknown-orphan
entries. M2-C is graduated; compact evidence is `evidence/m2-storage-lifecycle.md`.

The second M2 wave is accepted in
[`specs/m2-delivery-journeys/spec.md`](../../specs/m2-delivery-journeys/spec.md). Focused inspection
selected one Coding source-only Integration restart-recovery slice and one non-Coding Main-led local
delivery runbook. Their writable paths and machine validation surfaces are disjoint, but the runbook
must describe the integrated recovery boundary, so they have a real semantic dependency and run
serially rather than falsely parallel. Coding executes first through
[`execution/m2-coding-journey/goal.json`](execution/m2-coding-journey/goal.json); Main will perform
one intentional daemon restart only after a useful partial edit or narrower failure exists, then
observe the same Task/Session continue. After its accepted activated Integration and audits, the
non-Coding journey becomes ready under its own accepted Work Item.

The Coding Goal reached its frozen `review-cap` after one same-Session correction and one supported
cross-Worker handoff. Final successor Revision `ebd14c70-400f-4f99-aab6-adc938e54938` passes the
accepted machine surface, but no fresh two-Judge Review Graph can start and older/malformed opinions
cannot satisfy its immutable requirement. 一骏 explicitly authorized the stop packet's narrow
recovery on 2026-08-14. It is accepted at
[`coding-review-cap-recovery/spec.md`](../../specs/m2-delivery-journeys/work-items/coding-review-cap-recovery/spec.md)
and executes through
[`execution/m2-coding-review-recovery/goal.json`](execution/m2-coding-review-recovery/goal.json):
one no-behavior-change materialization of the exact full-digest Candidate, independent verification,
and one fresh two-Judge gate, followed only after Main accept by safe Integration and the existing
three serial audits. If either opinion is unusable or blocking, this recovery stops; it does not
correct, replace, add Judges, or loop. The non-Coding dependency remains closed until Coding delivers.

The exact Candidate passed that gate and safe Integration. Its first Codex native-goal audit then
failed before independent verification because the frozen read-only Worker could not create build/
tsx artifacts and that Runtime does not expose ForkLight checkpoint MCP; source stayed unchanged.
This is an audit admission mismatch, not a product failure. The accepted supplement
[`coding-integrated-audit-recovery/spec.md`](../../specs/m2-delivery-journeys/work-items/coding-integrated-audit-recovery/spec.md)
runs four serial zero-diff gates through current smoke-verified checkpoint-capable Runtimes at
[`execution/m2-coding-integrated-audits/goal.json`](execution/m2-coding-integrated-audits/goal.json).
It reuses the integrated result and does not reopen implementation or weaken commands. Its first
gate passed. The second passed build, 250 focused tests and diff validation but failed only because
the isolated Task Home had no reachable Daemon for a real-home `health` assertion; the activated
real source remains identity-matched. This is the second Runtime/admission failure named by the
accepted stop rule, so the supplement is stopped at 1/4 and no downstream Task may start
automatically. The exact decision packet is
[`m2-coding-integrated-audit-stop-decision-packet.md`](evidence/m2-coding-integrated-audit-stop-decision-packet.md).
Grok authentication is now locally visible, but `grok-4-6-xhigh` remains
`launchable/connection-unverified` until a real Task launch; authentication does not bypass this
stop. 一骏 authorized one acceptance-contract-only resolution. Main recorded an exact revise and
non-model attribution, but amended remediation check `eb46f89b-...` passed only 3/4 because the
remediation verifier inherits the reachable real ForkLight Home and the replacement command
incorrectly required `daemon-unavailable`. The original machine gate remains failed. 一骏 then
explicitly authorized the decision packet's final path. DeepSeek, Volcengine and MiniMax each passed
one current explicit Provider smoke, so the valid four-milestone final audit Goal at
[`execution/m2-coding-final-audits/goal.json`](execution/m2-coding-final-audits/goal.json) completed
4/4. All four Workers and ForkLight's independent verifier passed their accepted commands; every
Candidate is the exact empty digest with zero files and zero lines. Main confirmed the Goal and
real source/Daemon identity, so Coding is graduated without replaying implementation, review, or
Integration. Its dependent non-Coding Work Item now runs through
[`execution/m2-noncoding-journey/goal.json`](execution/m2-noncoding-journey/goal.json): one Grok 4.6
Xhigh `persistent-session` documentation Writer, intentional same-Task daemon restart after useful
partial output, one independent Judge, Main Integration, and three serial zero-change audits. The
real Grok launch is the current smoke; it is not labelled `native-goal`. The Grok Task proved
same-Task restart continuation, used one evidence-based correction, and produced a verified concise
Candidate. One usable Judge accepted it; Main found one remaining storage-class wording gap and used
the supported one-hop DeepSeek Flash handoff. That successor closed the gap and passed independent
verification, but its immutable Task records `claude-code/deepseek-flash` together with the
Grok-only `persistent-session` mode. This concrete cross-Runtime handoff admission mismatch is
outside the docs-only Spec, so the Goal is stopped before successor review or Integration. Exact
evidence and the recommended two-step recovery are in
[`m2-noncoding-handoff-execution-mode-stop-decision-packet.md`](evidence/m2-noncoding-handoff-execution-mode-stop-decision-packet.md).

一骏 explicitly authorized that exact two-step recovery on 2026-08-14. Main's focused audit proved
the shared handoff builder retains source execution fields after replacing destination identity,
while normal admission and canonical Runtime capability resolution are already correct. It also
proved successor Revision `04e736e7-b595-44a4-96b1-b82d2dd6cb5b` has full digest
`65deb60f3f4c6f5fe3730076e07a29cca52a0fb76019c18daf6a7d817554373a`, exactly three documentation
paths and a clean current-source apply check. The accepted strict-serial Work Items are
[`handoff-destination-execution-truth/spec.md`](../../specs/m2-delivery-journeys/work-items/handoff-destination-execution-truth/spec.md)
then
[`noncoding-exact-candidate-recovery/spec.md`](../../specs/m2-delivery-journeys/work-items/noncoding-exact-candidate-recovery/spec.md).
The first executes through
[`execution/m2-handoff-execution-truth/goal.json`](execution/m2-handoff-execution-truth/goal.json):
one Grok 4.6 Xhigh `persistent-session` implementation, two independent Judges, safe serial
Integration, and three zero-change activated-source audits. Only after all four gates pass may Main
admit the exact three-path recovery, one Judge, Integration, and the original three non-Coding
audits. No historical relabel, Store rewrite, second-hop handoff, manual docs apply, Quality-policy
expansion, Hub/UI, or M3 work is authorized.

Both strict-serial recoveries completed 4/4. The destination-execution Candidate passed independent
verification, two different-view Judges, Main accept, safe Integration and the 2,940-test source
check; the exact three-path documentation Candidate retained its frozen full digest, passed one
fresh Judge, and safely integrated before all three original audits passed. Main recorded accept
and explicit terminal resolution on all six zero-change audit Tasks.

The required terminal storage preview then found those six Tasks still classified
`protected/awaiting-main-decision`, retaining exactly 685,377,515 regenerable bytes. Focused tracing
proved a valid latest `task.resolution.completed` is evaluated only after stale review/Main/
Integration packet waits have already returned. M2 therefore remains open for one strict-serial
M2-C supplement:
[`resolved-terminal-storage-disposition/spec.md`](../../specs/m2-delivery-journeys/work-items/resolved-terminal-storage-disposition/spec.md).
It changes only the existing classifier and focused tests, keeps active and durable-evidence safety
guards first, requires two Judges and safe Integration, then runs three zero-change audits before
Main previews and reclaims only the six exact resolved Tasks. No new state machine, Store rewrite,
public schema, coordination mechanism, broad cleanup, Hub/UI, or M3 work is authorized. Its
operational Goal is
[`execution/m2-resolved-terminal-storage-disposition/goal.json`](execution/m2-resolved-terminal-storage-disposition/goal.json).

That operational Goal is now `waiting/review-cap` before Integration. Grok produced one exact
two-path Candidate, and the same Task/Session reused it once after the first Judge schema failure;
both independent verification rounds passed build, 295 focused tests and diff validation with the
same full digest. Each of the two allowed Review Graphs returned one usable Codex accept plus one
independent `schema-violation` (DeepSeek, then MiniMax). The immutable two-Judge gate therefore
remains undersized, no Main accept/Integration/audit/reclaim occurred, and the third review request
was refused before assignment. Automatic execution stops under the repeated-failure and frozen-cap
rules. Exact reusable output, review evidence and the explicit decision are in
[`m2-resolved-terminal-storage-review-cap-decision-packet.md`](evidence/m2-resolved-terminal-storage-review-cap-decision-packet.md).
The recommended exact-Candidate review-cap recovery is not authorized until 一骏 confirms it.

一骏随后明确授权该精确Candidate恢复，并澄清今后优先使用的是Grok CLI自己的`/goal`，
不是ForkLight Goal合同。官方1.0.3源码审计与真实Grok 4.6 Xhigh隔离Smoke已经证明原生
Goal创建、持久Goal id、暂停、同Goal恢复和`complete + achieved`独立终态；也证明进程
exit 0或模型完成文案不能替代这份真相。产品适配器当前仍只有`persistent-session`，所以
先串行执行M2-A补充Work Item
[`grok-native-goal/spec.md`](../../specs/m2-a-grok-execution-truth/work-items/grok-native-goal/spec.md)：
通过ForkLight隔离Workspace和一次性非产品启动桥接器，让首个Writer真实运行Grok `/goal`，
再经ForkLight独立验收、两个不同视角Judge、Main安全Integration和无桥接器真实Task毕业。
该修改面与冻结的storage Candidate正交，但Main Integration保持串行；native Goal产品真相
毕业后才执行已授权的精确storage recovery。M3继续关闭。

Native Goal产品Candidate随后因缺少current-model-only启动真相停在Main review。正交的
精确storage recovery获授权继续，但两次bootstrap准备和一次明确授权的同Task extra
Attempt都在Grok启动前停止：最后一次已通过seed/path/reverse证明，只因wrapper用源码树
绝对路径加载child native bootstrap而被Workspace sandbox拒绝。相同bootstrap已在受保护
Workspace内通过可读、可执行、语法和sha256证明；现有Task的base/extra Attempt均耗尽且
correction/adaptation为零。一骏现已授权一个无fallback的最终replacement Task；实际sandbox
profile证明Workspace-local child可加载而旧源码路径被拒绝。该Task只有一个base Attempt，
extra/validation-repair/correction/reverification/adaptation均为零。失败即永久停止；成功后
仍必须经过原独立验收、双Judge、Main串行Integration、三项审计和精确reclaim，M3继续关闭。

最终Task成功启动真实native Goal并恢复精确两路径Candidate；ForkLight机器验收全部通过。
但task-local native Goal终态是`user_paused/Executing`，classifier为0，没有`complete +
achieved`。Main按合同在Judge前绑定精确Revision执行reject。由于该Task无extra、repair、
correction、reverification、adaptation或replacement，这条recovery永久停止；M2保持打开，
M3继续关闭，等待新的Milestone级决定而不是继续补偿式恢复。

只读根因审计进一步证明：native Goal Planner必须写入自己的plan artifact，但最终Task的
只读工具面没有文件写工具，bootstrap又明确禁止Bash。Planner五次终端写入全部被拒绝，随后
Grok 1.0.3以`missing_plan_file` fail-closed，并用其planner失败的通用状态写成`user_paused`；
之后只是普通turn完成，不是Goal完成。这个结论不改变最终无fallback边界，也不授权移除deny、
增加写权限、resume或再建Task。

一骏现已作出新的M2 Milestone级决定：不调整毕业标准，也不复活/替换已经终止的final Task；
另立自包含Work Item
[`resolved-terminal-storage-native-plan-recovery/spec.md`](../../specs/m2-delivery-journeys/work-items/resolved-terminal-storage-native-plan-recovery/spec.md)。
它只为Grok native Planner暴露现成的`search_replace/write` Task-local artifact能力，同时明确
拒绝`Write/Edit(<Workspace>/**)`并继续禁止terminal/Bash。精确seed仍由Main-owned materializer
在Grok启动前物化，Worker无权改Candidate。该Work Item只有一个base Attempt、无任何fallback，
要求真实`plan + classifier + complete + achieved`、ForkLight独立验收、双Judge和Main串行
Integration；失败返回决策包。M3继续关闭。

该新 Work Item 的唯一 Task 已返回决策包。精确两路径 Candidate 和 ForkLight 独立验收全部
通过，但 native Planner 子会话在初始化阶段发现工具依赖不闭合：bootstrap 暴露了
`kill_task/get_task_output/wait_tasks`，这些工具要求 background-capable Bash 或 `task`，而
合同同时正确禁止了这两类执行能力。native Goal 因而没有 plan、classifier 或
`complete + achieved`。Main 已在 Judge 前 reject；没有 Integration。该 Work Item 的
no-fallback 边界现已耗尽，M2 暂停在新的 Milestone 级决定，M3 继续关闭。若未来选择继续，
必须另行明确是否创建一个新 Work Item，只移除这三个无用且依赖不满足的 Task 控制工具，
同时保持 Candidate Workspace deny、Bash deny、精确 seed、单 Attempt和全部后续质量门；当前
计划不自动授权该动作。

一骏已于 2026-08-15 明确授权该新 Work Item。Accepted Spec 位于
`specs/m2-delivery-journeys/work-items/resolved-terminal-storage-foreground-plan-recovery/spec.md`。
它不是前序 Task 的 retry、resume、correction 或 replacement；只成组移除
`get_task_output/kill_task/wait_tasks`，保留前台 `Agent`、Task-local
`search_replace/write`、Workspace `Write/Edit` deny、terminal/Bash deny、精确 seed、一个
base Attempt、零 fallback、ForkLight 独立验收、双 Judge 和 Main 串行 Integration。当前
Grok CLI 身份和 wrapper policy 必须先通过本地 preflight，随后唯一真实 `/goal` 是 Planner
初始化的唯一运行时证明。失败即返回决策包并保护 Workspace；M3 继续关闭。

该 Work Item 已返回决策包。foreground wrapper、真实 native `/goal`、精确两路径 Candidate和
ForkLight独立验收全部通过；因此三个后台控制工具的根因已经闭合。双Judge门仍未通过：
Codex返回一份usable accept，DeepSeek返回schema-invalid结果，不能作为第二份独立意见。
合同冻结零replacement Judge、零新Review Graph和零fallback，Main已reject精确Revision，
没有Integration或reclaim。M2暂停在新的Milestone级决定；M3继续关闭。当前计划不自动授权
review-only successor、额外Judge、新Task、model switch或重新执行Candidate。

聚焦只读审计证明，现有Review Graph不支持对同一Revision追加或替换Judge；重复相同集合只会
幂等返回旧Graph，改变集合会因冻结身份失败。因此下一决定不能只写“补一个Judge”。同一M2
storage链已有三次otherwise-valid Judge JSON仅因summary超过500字符而被拒，属于重复产品
缺口。一骏已于2026-08-15明确授权新的M2-B Work Item
[`judge-result-schema-repair/spec.md`](../../specs/m2-b-quality-decision-chain/work-items/judge-result-schema-repair/spec.md)：
Main显式确认、每个失败assignment最多一次、同Profile/Revision/private packet、原失败证据不可变；
只接纳“其余全部严格有效、唯一缺陷是summary超500”的结果，修复后还必须保持disposition与
findings完全不变。它不执行Candidate、不换Judge、不增加第三位Judge、不自动retry。当前唯一
Writer将通过Grok CLI 4.6 Xhigh真实`/goal`执行；ForkLight独立验收后使用恰好两个Judge，Main
串行Integration。成功后才用集成能力修复原DeepSeek assignment一次；失败即停止。M3继续关闭。

该 Work Item 已在失败边界停止。Grok 4.6 Xhigh 的同一 ForkLight Task 产出精确 Candidate
Revision `3fb7d72d-7d19-4b34-b2ff-42dd108429f3`；ForkLight 独立通过 build、441项聚焦测试和
diff check。Main 的一次显式 correction 修复了公开 parser 边界、private packet fail-closed
和 human CLI lifecycle，额度随后耗尽。恰好两个独立 Judge 均终态：Codex Luna Max 返回
usable `accept`，Volcengine GLM 5.2 的 Task 成功但结果含额外/损坏字段，Review Graph 将其
标记 `extra-fields`、unusable。该失败不是 summary 超限，不能由本 Work Item 修复。按已确认
边界不重跑 Candidate、不换 Judge、不增加第三位 Judge、不自动重试；Main 不 Integration，
原 storage assignment 也尚未执行 repair。可复用 Candidate 和两个 Judge Workspace 保持
protected；M3继续关闭，等待新的 Milestone 级决定。

Native Goal current-model-only recovery has now delivered through exact two-path reuse, ForkLight
verification, two usable Judges, Main accept, safe Integration, activation and the 2,949-test full
check. The activated `grok-4-6-xhigh` Profile resolves new work to `native-goal`; historical
bootstrap execution remains truthfully `persistent-session`.

The accepted no-wrapper live-Task exit evidence is still missing. The plan does not create a
ceremonial proof Task, and it does not silently reopen the stopped storage or Judge-result repair
chains: both need a new explicit Milestone-level authority decision after their frozen two-Judge
failures. M2 remains the current Milestone and M3 remains closed.

一骏随后授权一次精确的1-Judge交付例外，只用于已独立验收的Judge-result repair Candidate。
Main没有改Store或制造通用绕过：正常preflight证明唯一拒绝是该精确review-depth门，随后独立
复现digest、16路径、source-base、apply和验证边界并一次性手动应用；聚焦441项和完整2,964项
测试通过。该交付明确记录为manual exception，不声称存在ForkLight Integration operation。

集成后的产品只执行一次原DeepSeek assignment的same-Judge schema-only repair。派生Task
`bbf11b7f-e3bf-4e88-828c-06845a6027de`成功后，原storage Graph恢复为两份usable `accept`；
Main fresh accept精确Revision，正常ForkLight Integration
`c68d7eab-f24c-46df-af82-7a0f10a82854`通过source apply、六条独立验收、build、activation和
activation check，随后完整2,966项测试通过且Daemon identity matched。

当前ready波次是三个已有的串行zero-diff activated-source audits。第一个有真实M2验收价值，
因此改用已集成的`grok-4-6-xhigh`并同时提供wrapper-free `native-goal` live evidence；不另建
自证Task。三个audit全部通过后，Main只读预览六个精确已resolve Task；实际reclaim仍需要一骏
单独明确确认。M3继续关闭。

首个audit已经返回一个新的精确阻塞，而不是验收成功。ForkLight Task没有duration、Token或
no-progress上限；Grok CLI 1.0.4却在仍有有效进展时，用内部600秒foreground Planner预算取消
了子会话，使native Goal停在`user_paused/Executing`且classifier为0。旧audit保持失败且不
resume/retry/relabel。当前串行Work Item改为
[`grok-native-goal-foreground-budget/spec.md`](../../specs/m2-a-grok-execution-truth/work-items/grok-native-goal-foreground-budget/spec.md)：
只在native Goal child冻结官方`GROK_FOREGROUND_BLOCK_BUDGET_MS=86400000`，非native child
删除继承值；不增加设置、schema、Task timeout或重试。修改面只有Grok adapter与聚焦测试，
独立验收后使用双Judge、Main安全Integration、完整check和activation。随后创建一个新的
wrapper-free audit，而不是复活失败Task；通过后才继续另两个串行audit与六Task精确preview。
实际reclaim仍等待一骏单独确认，M3继续关闭。

该两路径产品Candidate已正常交付：真实Grok native Goal `complete + achieved`、ForkLight独立验收、
两个usable accept、Main fresh accept、无拒绝preflight、安全Integration、activation和2,968项
完整check全部通过。Work Item整体仍需要新的post-fix wrapper-free storage audit；它复用
原验收但不resume/retry/relabel旧失败Task。该audit必须以已激活环境完成Goal classifier和
`complete + achieved`、三条独立命令与zero diff，才继续另外两个串行audit。任何相同cap复发
或范围扩大都停止该Work Item；六Task preview/reclaim与M3边界不变。

该post-fix audit没有重现600秒cap，却触发了范围扩大停止条件。Planner在505,496 ms内完成
73次工具调用并把完整plan写进durable subagent output，但当前
`grokNativeAllowTools(false)`没有`search_replace/write`，无法按Grok原生合同把plan持久化到
Task-local Goal目录。native Goal因此保持`user_paused/Executing`、plan空、classifier为0；
后续ordinary-turn正确审计文案不是Goal成功。Task没有Candidate或独立验收，零repair/retry，
Workspace保持protected。一骏已授权独立的M2-A Work Item
[`grok-native-goal-read-only-plan-persistence/spec.md`](../../specs/m2-a-grok-execution-truth/work-items/grok-native-goal-read-only-plan-persistence/spec.md)。native Goal始终注册plan mutators；只在
read-only Task增加Workspace `Write/Edit` deny，仍允许Task-local Goal plan写入并保留现有
state/credential/Bash deny。产品修改仍仅限Grok adapter和聚焦测试，一个Grok 4.6 Xhigh
Attempt、零repair/correction/retry/replacement，独立验收、双Judge、Main串行Integration和
一个全新zero-diff live audit。若任一门失败即形成决策包，不再自动扩展。另两个audit、
reclaim和M3继续关闭，直到这条串行链成功。

该唯一实现Attempt已经终止，未进入后续串行门。native Goal成功保存Task-local plan并写出
精确两路径补丁，但在classifier阶段Grok OAuth refresh返回`invalid_grant`，三个classifier
视角和parent均收到401。Goal保持`infra_paused/Executing + not_achieved`，ForkLight没有生成
Candidate Revision或执行独立验收。合同冻结的零repair/correction/retry/replacement生效；
双Judge、Integration和新live audit均未启动。可复用Workspace保持protected，M2停在新的
明确决定边界；详见
[`m2-grok-native-goal-read-only-plan-persistence-decision-packet.md`](evidence/m2-grok-native-goal-read-only-plan-persistence-decision-packet.md)。

一骏完成重新登录并授权一次same-Task resume后，Grok 4.6 Xhigh只读烟测真实通过；但该授权
无法进入原Task。Store中的冻结策略是`maxExtraAttempts: 0`且`maxAdaptationRounds: 0`，产品的
只读adaptation preview因此明确返回`adaptation-disabled`。Main不绕过Store或Daemon真相，
没有创建第二Attempt。下一决定必须采用ForkLight可表达的恢复边界；在一骏明确修改当前
no-replacement边界前，不创建recovery Task，后续Judge/Integration/audits仍关闭。

一骏已明确授权一个新的单次recovery Task，采用旧Task受保护的精确两路径partial。Main固化
patch并通过current-source正向检查与old-Workspace反向检查，证明没有source drift且无需重新
研究。执行合同是`execution/m2-grok-native-goal-read-only-plan-persistence/03-protected-partial-recovery.yaml`：
Grok 4.6 Xhigh native Goal、一个Attempt、零fallback、双Judge和Main串行Integration。成功后
继续既有新live audit；失败即停止，原Task不变，M3继续关闭。

该recovery现已通过全部正常门：真实native Goal `complete + achieved`并持久化Task-local
plan，精确两路径Candidate通过ForkLight独立验收、两个usable accept、Main fresh accept、
无拒绝preflight、安全Integration、activation和2,971项完整check。新的wrapper-free live
audit也以5,124字节plan、`complete + achieved`、三条独立命令和zero diff毕业；随后两个既有
storage audits串行通过且同样zero diff。

Main已完成六个精确已resolve历史Task的串行只读preview：全部为
`reclaimable/main-resolved-terminal`，合计685,377,515可再生字节、31个已知目标；保留
9,102,847 durable字节，unknown 0、process 0、SQLite `ok/0`。全局无unknown-orphan和进程。
当前唯一下一步是对这六个精确Task执行产品confirmed reclaim，再做最终完整性/孤儿/进程审计；
该删除仍等待一骏单独明确授权。不得改用`--all-eligible`，不得夹带其余64个当前可回收Task，
不得在授权前进入M3。

一骏随后明确授权六个精确Task reclaim，但新的单项串行preflight在任何删除前再次命中
`storage_preview`固定15秒观察窗口；Daemon仍正常完成扫描，warm no-timeout实测12,631 ms且
返回原`main-resolved-terminal`、unknown/process 0、SQLite `ok/0`真相。因为这次没有并发观察，
不再把它视为偶发编排噪声，也不使用旧preview继续破坏性操作。

当前ready Work Item是
[`storage-read-transport-observation/spec.md`](../../specs/m2-c-task-storage-lifecycle/work-items/storage-read-transport-observation/spec.md)：
只在共享daemon client中让`storage_audit/storage_preview`复用现有long observation映射，并用
聚焦测试保证`storage_retain`、health和已有long methods不漂移；不改变server、Store、存储
分类/删除、public schema或增加retry/replay/cancel。它通过Grok 4.6 Xhigh native Goal、独立
验收、双Judge和Main安全Integration串行交付。激活后的真实CLI audit与六项fresh preview通过
后，继续执行已经授权的六次精确reclaim和最终审计；M3保持关闭。

该Work Item现已通过正常交付链：Grok 4.6 Xhigh native Goal、精确两路径Candidate、ForkLight
独立验收、两个不同视角usable accept、Main accept、安全Integration、activation与2,971项完整
check全部通过。激活后的CLI audit和六项fresh preview正常返回；Main随后只对获授权的六个精确
Task串行confirmed reclaim，31个目标与685,377,515可再生字节全部移除，9,102,847 durable字节
保留。回收后六项均为`reclaimed/known-regenerable-removed`且目标/可再生/unknown/process为0；
全局430项中97 protected、67个无关reclaimable、266 reclaimed，无unknown-orphan或进程，SQLite
`ok/0`。M2 Exit已满足。不得自动处理其余67项；M3等待一骏确认后才开始。

Exit satisfied: both journeys reached reviewed delivery without Main doing ordinary execution;
truthful Runtime mode, recovery, review/correction, retained partial output, Integration and
workspace disposition are traceable. Store integrity passes and no unknown orphan remains.

## M3 — Evidence-driven intelligent delegation

User result: Main gets an understandable Runtime/model/effort/execution recommendation with
confidence and manual override.

一骏 confirmed the M2 → M3 transition on 2026-08-16. Focused audit found substantial reusable
foundation: exact/family routing evidence, exact failure attribution, fail-closed unknown results,
explicit Competition intent, frozen Task routing decisions and Review Graph authority all pass the
current 443-test focused baseline. The remaining work is the product decision chain, not more raw
test volume or manufactured comparison data.

Accepted Work Items:

- **M3-A — executable routing advice**
  (`specs/m3-a-executable-routing-advice/spec.md`): attach the full
  Runtime/model/effort/Profile/execution identity and current readiness to the canonical read-only
  routing answer. Preserve historical scoring separately, and return stable `cannot-determine` or
  `historical-best-not-launchable` results without silently switching Workers.
- **M3-B — durable routing choice and manual override**
  (`specs/m3-b-durable-routing-override/spec.md`, `depends_on: M3-A`): extend the existing
  `RoutingDecisionSnapshot` so a Task records whether Main followed a recommendation, overrode it,
  or selected after insufficient evidence, including frozen confidence and privacy-safe preview.
  No second routing entity, advisory hash or Store migration is authorized.
- **M3-C — execution-strategy and exceptional-policy learning**
  (`specs/m3-c-strategy-policy-learning/spec.md`): first fix Competition candidate execution truth,
  then—after M3-A and M3-B—separate history by execution mode and add read-only explanation for
  explicit Competition/Judge policy. It may not infer policy, vote, assign a Judge, or start work.

Wave and path proof:

1. Wave 1 may run M3-A beside M3-C1. M3-C1 owns exactly `src/core/competition.ts` and
   `tests/competition.test.ts`; neither path appears in M3-A's allowed set. Inputs are existing
   frozen Profile/Runtime contracts and their validation surfaces are independent. Both Workers use
   isolated ForkLight Workspaces; Main reviews and integrates Candidates serially.
2. M3-B runs only after M3-A Integration because it freezes the canonical advisory result into
   Task admission and shares coordinator/CLI/MCP surfaces.
3. M3-C2 runs only after M3-C1, M3-A and M3-B. Its statistics/routing/types/entry paths overlap the
   earlier Work Items, so it is serial. No attempt is made to manufacture parallelism with locks,
   hashes, leases or duplicate validation.
4. After every accepted Integration, activate the matched build and use only natural Store history.
   Run `npm run check` at high-risk Integration checkpoints and the M3 boundary, not to report
   activity. No Hub/UI path is writable before M5.

Wave 1 is complete. M3-C1 exact Revision `e2cf75bd-ad83-4721-bf8f-4b4a4cebb793` and M3-A exact
Revision `c1538142-703e-4994-9869-745cde9739da` each passed ForkLight independent verification,
two usable different-view Judge opinions, Main accept, serial safe Integration and activation.
The source full check passes 2,984 tests, and activated natural-history queries satisfy M3-A's four
result cases without creating work. M3-B is now the only ready implementation Work Item; M3-C2
remains dependency-held until M3-B Integration.

M3-B reached a bounded verification stop after one automatic validation repair and one
Main-directed same-Worker correction. Final protected Revision
`23b7f864-6f6f-44ac-9726-6b0c83bbfe50` closes the two Main-confirmed product gaps and passes build,
diff validation and 465/466 focused tests. The only remaining failure is a new MCP test fixture
whose omitted top-level family triggers the existing family guard before the expected new
execution-mode guard. No current-Revision Judge or Integration exists. The next action is the
explicit decision in `evidence/m3-b-verification-stop-decision-packet.md`; M3-C2 stays closed.

一骏 has now authorized the packet's one-shot exact-Candidate recovery. Main will materialize the
frozen 11-path Revision in a fresh isolated Workspace and let Grok 4.6 Xhigh native `/goal` align
only the single `tests/mcp.test.ts` family fixture. The Task freezes one Attempt and zero repair,
correction, reverify, adaptation, fallback or replacement. Success still requires the unchanged
verification commands, two fresh different-view Judges, Main full-diff review and normal serial
safe Integration. M3-C2 remains closed until that chain delivers.

That recovery is delivered. Task `aa524fdd-1558-4d92-8d5a-ae49f738c9b4` used one real Grok 4.6
Xhigh native Goal Attempt; exact Revision `72fe6e93-764c-4872-9a49-e5d825fbc775` retained all ten
non-delta paths byte-for-byte and added only the authorized family field in `tests/mcp.test.ts`.
ForkLight verification passed 466/466, two fresh different-view Judges accepted, Main accepted and
safe Integration `8b45d56a-7b7a-4ff6-9e5e-3223bac0fa87` passed all four stages. The source full
check passes 3,008/3,008 and Daemon/client identity is matched. M3-B is complete; M3-C2 is now the
only ready serial Writer.

M3-C2 is admitted as that single Writer from
`execution/m3-wave-3/01-m3-c2-strategy-policy-advice.yaml`. Focused preflight confirms the concrete
gap is the missing execution-mode component in full-Worker historical grouping; existing explicit
Competition admission is retained rather than rebuilt. The Task extends only the accepted
statistics/routing/Daemon/CLI/MCP call chain and focused tests, runs Grok 4.6 Xhigh through real
native `/goal`, has no absolute duration/Token/no-progress caps and freezes two different-view
Judges before Main serial Integration. Natural Store records are inputs only; no synthetic Task,
Competition, benchmark, Hub/UI work or coordination mechanism is authorized.

The base Attempt is now stopped on external authentication, not elapsed time or a Candidate test
result. Grok native Goal `9b022da8-45a9-46de-be6a-c104272fcf94` is `infra_paused`; the protected
Workspace has a reusable 14-path partial but no Candidate Revision. Diagnostic build/tests and
Main scoped review found a narrow set of fixture and policy-gating gaps recorded in
`evidence/m3-c2-infra-pause-decision-packet.md`. No automatic validation repair, correction,
replacement, model switch or Judge is legal from this state. After authentication is restored,
read-only policy inspection proves a same-Task extra Attempt is unavailable because both
`maxExtraAttempts` and adaptation rounds are frozen at zero, while correction cannot start without
a Candidate Revision. The next proposed action is therefore one explicitly authorized one-shot
recovery Task that materializes the exact 14-path partial, uses a fresh honest Grok native Goal and
retains the unchanged C2 verification/two-Judge/Main Integration chain. It must not claim resume,
create broader paths or allow another replacement.

一骏 restored Grok login and authorized that exact Task. Direct Grok 4.6 Xhigh smoke and
build-matched health passed; `execution/m3-wave-3/02-m3-c2-exact-partial-recovery.yaml` validated
the exact path/source boundary and admitted Task `588fc40f-afad-448e-8306-e05859166842`. Its sole
Attempt stopped before native Goal state because Grok's Workspace sandbox denied the wrapper's
absolute read of the old protected baseline (`EPERM .../bbec21f9.../baseline/src`). No partial was
copied into the new Workspace and no Candidate/verification/review exists. The old partial stays
protected. Because the recovery contract has zero extra Attempt, adaptation or further
replacement, M3-C2 stops again. Continuing now requires a new explicit decision for a replacement
that carries the exact seed as a Workspace-local patch; Main does not infer that authority.

一骏 then authorized continuing Goal work. Workspace-local replacement Task
`68f16585-1fec-447c-8799-4867a4731b0f` reused the exact protected 14-path seed and completed fresh
Grok 4.6 Xhigh native Goal `847f8b7c-afdd-42ed-be1a-5fdb893614f1`. Revision
`5d3ee57c-be94-48ee-bdc2-458dcadc302c` passed ForkLight independent verification, two usable
different-view Judges, Main exact-diff accept and safe Integration
`a0d07d2d-2261-4036-ba65-da124663567c`. The boundary full check passes 3,022/3,022 and the
activated client/Daemon identities match.

The three representative natural-family projections plus one unseen-family projection now cover
one supported executable recommendation and honest `score-gap-too-small`,
`incomplete-family-coverage` and `insufficient-relevant-samples` outcomes. All preserve explicit
Competition intent `none`, create no work, keep Judge history non-voting and keep Main-direct
history outside Worker comparison. M3 is graduated; exact evidence is
`evidence/m3-routing-graduation.md`.

Exit: **passed 2026-08-17**. Three representative task families have reviewable evidence; missing
evidence says `cannot determine`; no manufactured rerun was used to improve a ranking.

## M4 — Proven Main Token leverage

User result: ForkLight truthfully shows whether delegation reduced Main Token without hiding total
delivery cost.

Focused entry audit found reusable Worker Token/economics, Codex terminal usage, direct calibration,
delivery quality and CLI/API foundations, but zero currently valid M4 pairs. Thirteen completed
Main-direct records carry no Main Token; 11,590 exchange receipts measure only CLI/MCP boundary
volume; the two legacy direct-Codex calibrations have no representative family or explicit M4 pair
contract. Exact evidence is `evidence/m4-entry-audit.md`.

Accepted Work Items:

- **M4-A — complete Main usage capture**
  (`specs/m4-a-complete-main-usage/spec.md`): persist privacy-safe complete terminal usage for
  `direct-main` and `delegated-main` roles under one Task/comparison and exact Main profile. Keep
  exchange estimates separate and make no saving claim. **Passed 2026-08-17**: one Grok 4.6 Xhigh
  native Goal Candidate passed independent verification, two usable different-view accepts, Main
  exact-Revision accept, four-stage Integration and the 3,034-test full check. Evidence:
  `evidence/m4-a-complete-main-usage-delivery.md`.
- **M4-B — valid Main Token pair and quality gate**
  (`specs/m4-b-valid-main-token-pair/spec.md`, `depends_on: M4-A`): require same role identity,
  explicit same-scope/same-acceptance/delegated-quality-not-lower assessment, direct verification
  reference and current delegated verification/Main accept/Integration before exact signed Main
  Token change is available. **Passed 2026-08-17**: the accepted 12-path Grok native Goal
  Candidate required one exact three-path correction for publication-only legacy evidence, then
  passed fresh independent verification, two fresh usable accepts, Main exact-Revision accept,
  four-stage Integration and the 3,048-test full check. Evidence:
  `evidence/m4-b-valid-main-token-pair-delivery.md`.
- **M4-C — family value report**
  (`specs/m4-c-family-value-report/spec.md`, `depends_on: M4-B`): expose every pair and family
  result with Worker Token, native-currency cost, time, repair/correction and typed missing evidence
  through canonical Daemon/CLI/MCP output. No percentage averaging or hidden pair selection.
  **Passed 2026-08-18**: exact final Candidate passed independent verification, two usable Judge
  accepts and Main accept; its one authorized Integration-contract recovery passed all four safe
  Integration stages, the 3,061-test full check and activated read-only CLI smoke. Evidence:
  `evidence/m4-c-family-value-report-delivery.md`.
- **M4-D — representative pair evidence**
  (`specs/m4-d-representative-main-token-pairs/spec.md`, `depends_on: M4-C`): run one explicitly
  approved same-source/same-acceptance direct/delegated comparison for each graduated family and
  produce the canonical `evidence/main-token-pairs.json`. Historical Hub data is read-only.
  **D1 stopped 2026-08-18**: both complete Main samples and the verified storage artifact are
  durable, but only one of two Judge opinions was schema-usable. Main rejected before Integration;
  the canonical pair is `cannot-determine / incomplete-evidence` and will not be replayed.
  Evidence:
  `evidence/m4-d-storage-lifecycle-pair-decision-packet.md`.
  **D2 delivered 2026-08-18**: direct/delegated artifacts are byte-identical; the Grok Candidate,
  independent verification, two usable accepts, Main accept and isolated safe Integration passed.
  Its M4-B pair is valid but delegated Main used 2,401,089 versus direct 152,271 gross Tokens, so
  the family is `cannot-determine / not-strictly-positive`, not a saving. Evidence:
  `evidence/m4-d-worker-runtime-pair-delivery.md`.
  **D3 delivered 2026-08-18**: the historical-read-only artifact passed identical direct/delegated
  validation, two usable accepts, Main accept and isolated Integration while preserving the exact
  pre-existing Hub PID/port/state. Its valid pair has delegated Main 2,128,876 versus direct
  119,202 gross Tokens, so it is also `cannot-determine / not-strictly-positive`. M4-D is complete,
  but M4 exit is not met. Evidence: `evidence/m4-d-hub-comprehension-pair-delivery.md`.
- **M4-E — Main-efficient reviewed delivery checkpoints**
  (`specs/m4-e-main-efficient-delivery/spec.md`, `depends_on: M4-D boundary truth`): compose the
  existing Task, verification, Review Graph, Main review and safe Integration records into two
  resumable public decision-boundary calls. Prepare may execute and review but never decide;
  decide exact-binds Main authority and only an explicit accept may integrate. Observation timeout
  never becomes a Worker deadline. **Authorized 2026-08-18** after the M4-D stop packet: one serial
  Grok 4.6 Xhigh native Goal Writer, independent verification, two different-view Judges and Main
  safe Integration. **Stopped at Main review 2026-08-18**: the final recovery passed ForkLight
  verification and two Judges proposed accept, but Main found that decide reuses any latest Task
  preflight receipt instead of distinguishing the fresh post-accept receipt from older granular
  receipts. Main rejected; no Integration ran. 一骏 then explicitly revoked the final no-replacement
  boundary and authorized the focused two-path
  [`fresh-preflight-binding`](../../specs/m4-e-main-efficient-delivery/work-items/fresh-preflight-binding/spec.md)
  correction. **Delivered and activated 2026-08-18**: Task
  `3e2740eb-4c4e-4a55-9a80-86c51c35a5b5` completed one Grok 4.6 Xhigh native Goal Attempt;
  ForkLight proved the other 17 retained paths exact, passed 461 focused tests, obtained two usable
  Judge accepts and safely integrated the Main-accepted Revision through one fresh bound receipt.
  The post-Integration full check passes 3,084/3,084 and client/Daemon identity is matched. Exact
  delivery: `evidence/m4-e-main-efficient-delivery.md`; audit and stop lineage remain
  `evidence/m4-e-main-observation-audit.md` and
  `evidence/m4-e-fresh-preflight-stop-decision-packet.md`.
- **M4-E post-activation — fresh worker-runtime checkpoint pair**
  (`specs/m4-e-main-efficient-delivery/work-items/fresh-worker-runtime-pair/spec.md`,
  `depends_on: activated M4-E`): one new same-source/same-task/same-acceptance comparison projects
  the current M4-E delivery, not the old M3-C2 lineage. Direct and delegated Main both use
  `gpt-5.6-sol / xhigh`; delegated Main must use only `delivery prepare` and `delivery decide` for
  the delivery chain. **Delivered positive 2026-08-18**: byte-identical artifacts, independent
  verification, two usable Judges and isolated Integration passed; direct Main used 171,984 versus
  delegated 155,804 gross Tokens. The accepted pair saves 16,180 / 9.407851893199368%. This admits
  the next serial fresh storage-lifecycle checkpoint pair; it does not yet graduate M4.
- **M4-E post-activation — fresh storage-lifecycle checkpoint pair**
  (`specs/m4-e-main-efficient-delivery/work-items/fresh-storage-lifecycle-pair/spec.md`,
  `depends_on: positive fresh worker-runtime pair`): project current read-only previews for one
  protected rejected/reusable M4-E Task and two reclaimable integration-delivered Tasks into one
  new artifact. Direct/delegated roots are byte-identical; both Main sides use
  `gpt-5.6-sol / xhigh`, while delegated Main may use only `delivery prepare` and
  `delivery decide`. The Work Item performs no reclaim, Store mutation, product change or Hub/UI
  work. **Completed non-positive 2026-08-18**: equal scope/acceptance/non-lower quality, exact
  byte-identical artifacts and the full ForkLight chain passed, but direct Main used 154,171 versus
  delegated Main 553,038 gross Tokens. The accepted pair is `higher` by 398,867, so M4 stops without
  rerun. Hub remains dependency-held and M5 closed.

Wave/path proof:

1. M4-A, M4-B and M4-C all require StateStore plus Daemon/CLI/MCP entry files, so their writable
   intersections are non-empty. They run serially in that dependency order; no lock, hash, lease or
   duplicate consistency layer is added to force parallelism.
2. M4-D begins only after the capture, gate and report are activated. Its three family artifacts
   have disjoint paths, but the same measured Main profile and Main serial Integration are hidden
   ordering dependencies, so comparisons run serially.
3. Product implementation uses ForkLight isolated Grok 4.6 Xhigh native Goal Workers, independent
   verification and two different-view Judges. Direct calibration uses the same explicit Codex Main
   profile for both sides and never integrates the direct copy into the real project.
4. M4-E is one serial public-surface Writer. Core, Daemon, CLI and MCP paths overlap by design, so
   no second Writer is orthogonal. Fresh pair proof depends on activated M4-E and cannot run in the
   same wave.
5. Each fresh pair's direct and delegated isolated roots are byte-identical but have hidden
   ordering through one fixed Main profile, one delegated Task and Main serial assessment. The
   worker-runtime and storage-lifecycle families also have a strict gate between them. They run
   serially; no product Writer or second calibration overlaps them.

Current serial edge: M4-A and M4-B are activated. The first M4-C Task stopped with a reusable
10-path Candidate and one brittle-test gap after its bounded repair/reverify/correction chain.
The authorized exact-Candidate test-only recovery replaced only that test and passed build, all
343 focused behavior tests and diff validation, but its acceptance contract incorrectly reran a
pre-application bootstrap assertion after the seed was already applied. ForkLight records the
failure as `acceptance-contract / non-model`; no unchanged reverify, review or Integration ran.
一骏 explicitly revoked that no-replacement rule and authorized one acceptance-contract-only
replacement. Its read-only Grok Goal reproduced the exact final Candidate; build, all 343 tests and
diff validation passed again. The Main-owned post-state proof nevertheless failed before reverse
checks because it invoked ordinary `git diff` inside a non-Git Candidate Workspace. ForkLight
records a second `acceptance-contract / non-model` failure. The one-shot replacement authority is
consumed. On 2026-08-18 一骏 explicitly revoked that exact one-shot boundary and authorized one
final non-Git post-state-proof replacement. Its self-contained accepted spec is
`specs/m4-c-family-value-report/work-items/non-git-post-state-proof-replacement/spec.md`; it reuses
the same exact Candidate, removes every repository-metadata query from the post-state proof, and
runs one read-only Grok 4.6 Xhigh native Goal with one Attempt and zero retry, reverify, correction,
fallback or further replacement. It was the sole ready M4-C Work Item. M4-D remained dependency-held.
Evidence:
`evidence/m4-c-initial-task-stop-decision-packet.md`,
`evidence/m4-c-final-recovery-stop-decision-packet.md` and
`evidence/m4-c-acceptance-contract-replacement-stop-decision-packet.md`.
The final Task `e476516f-d653-4ec4-b919-8cb425a6f18d` reproduced the same exact Candidate, passed
the real non-Git proof, build, 343 tests, diff validation, two usable Judge accepts and Main accept.
Safe Integration applied it, but source verification could not find the Task-local marker in its
fresh verification project; the other three commands passed and ForkLight rolled the patch back.
The final Task grants no retry, reverify, correction, fallback or further replacement, so M4-C is
stopped and M4-D remains held. Evidence:
`evidence/m4-c-final-non-git-replacement-stop-decision-packet.md`.
一骏 subsequently revoked that final stop only for one Integration-contract-only recovery. Main
will not create a Task or rerun Grok/Judges: it amends the Main-owned post-state proof to derive the
two seed digests and exact ten paths without Task-local marker state, proves it in the protected
Candidate Workspace and a fresh Integration-like plain project, then uses one fresh ForkLight
preflight receipt and exactly one safe Integration for the already accepted Revision. M4-D remains
held until activated delivery; any second Integration failure is final.
The one recovery succeeded: preflight bound the unchanged Candidate, Integration passed source
apply/verification, artifact build and runtime activation, the full check passes 3,061/3,061 and
client/Daemon identity is matched. M4-C is graduated and M4-D is now the sole dependency-ready Work
Item inside M4. Evidence: `evidence/m4-c-family-value-report-delivery.md`.
The first M4-D unit then ran once from byte-identical comparison sources. Direct Main validation
passed at 103,834 gross Tokens. The delegated Grok Candidate and ForkLight verification passed, but
one of two Judge outputs used an unsupported finding severity; the existing same-Judge repair does
not rewrite findings. Root Main rejected the exact Candidate, no Integration or M4-B assessment
exists, and the two complete samples produce only `cannot-determine / incomplete-evidence`.
M4-D1 is closed without replay; M4-D2 is ready under its accepted serial dependency.
M4-D2 then completed the full quality chain and one valid pair. Its delegated artifact is retained
under `evidence/m4-calibration/worker-runtime.json`; the canonical report reports delegated Main
higher by 2,248,818 gross Tokens, so this valid pair does not meet the M4 exit. The unit will not be
replayed; M4-D3 is the final ready calibration.
M4-D3 completed with the same full quality chain and no Hub mutation. Its valid pair is also
negative. All three authorized units are now exhausted: D1 lacks complete review/Integration, D2
and D3 are valid but delegated Main is substantially higher. Main will generate the canonical
three-family report, run the M4 boundary checks and stop before M5 with a decision packet rather
than create more calibration work. Those checks now pass: build and 3,061/3,061 tests, matched
client/Daemon identity, byte-identical live/canonical report and unchanged pre-existing Hub truth.
The exact stop and next-decision boundary is
`evidence/m4-boundary-stop-decision-packet.md`.
4. No Hub/UI, ranking rerun or exchange-as-Main substitution is authorized. Missing exact terminal
   counters or failed equivalence/quality evidence returns `cannot-determine`.

Exit: every graduated representative task family has a valid pair; delegated Main Token is lower
without worse quality; every claim resolves to durable evidence.

Boundary 2026-08-18: **not passed**. D1 is incomplete. The first fresh meaningful
`worker-runtime` checkpoint pair proves strictly lower Main Token at equal scope, acceptance and
non-lower quality: 171,984 direct versus 155,804 delegated. The first fresh storage-lifecycle pair
also completed at equal quality but is valid negative evidence: 154,171 direct versus 553,038
delegated. It remains immutable and does not admit Hub.

The focused root-cause continuation is now activated: one verified Grok 4.6 Xhigh native-Goal
Candidate, two usable Judges, exact Main accept, fresh preflight, four-stage Integration and the
3,094-test full check deliver count-only multi-session Main usage episodes plus staged Main-offline
checkpoint re-entry. The restarted client/Daemon identities match. This admits exactly one new
current storage-lifecycle subject using the new strategy; it is not a replacement or replay of the
valid negative pair. M4 remains not graduated, Hub dependency-held and M5 closed until that new
pair is valid and strictly positive.

### M4-E continuation after valid storage negative

- **Main-offline delivery usage episode**
  (`specs/m4-e-main-efficient-delivery/work-items/main-offline-usage-episode/spec.md`,
  `depends_on: valid negative fresh storage pair and amplification audit`): keep the same quality
  and delivery authority, but let Main end its model session while Worker/Judges run and resume only
  when durable evidence changes. Add one count-only multi-session episode capture so every resumed
  Main terminal event is summed rather than omitted. Existing prepare timeout/re-entry supplies the
  delivery state; no new delivery entity/table, retry, Hub/UI or distributed mechanism is added.
  After activation, exactly one new storage subject may test this product strategy. The old valid
  negative pair remains immutable contrary evidence.

  Status: delivered by Task `6676be3a-24b4-4bbc-a8c0-7f2a3079e848`, Revision
  `f7c5f5ec-2dce-418e-af21-66c1d8da8587`, Review Graph
  `878ff74e-5642-4078-94bd-4d187cb94c3d` and Integration
  `376f0980-97c4-446f-abd5-0d886ac033e1`. Full check is 3,094/3,094 and Daemon identity is
  matched. Next ready Work Item is the one new storage subject; Hub remains held.

- **Main-offline storage-lifecycle checkpoint pair**
  (`specs/m4-e-main-efficient-delivery/work-items/main-offline-storage-lifecycle-pair/spec.md`,
  `depends_on: activated Main-offline episode delivery and three fresh storage previews`): compare
  one direct Main session with every actual staged delegated Main session, summed through one
  episode. The subject protects `2d774...` and reports only integration-delivered `4709...` and
  `6676...` as reclaimable; it performs no reclaim. Direct/delegated sources and acceptance are
  byte-identical. The old valid negative pair remains visible. A valid strictly positive result
  admits Hub; all other terminal outcomes stop before Hub with no replay.

  Status: stopped before Task admission. The byte-identical pair roots and rendered ForkLight Task
  pass preflight;
  direct Main run `codex-run:01a0121e-f4b1-7a63-93f9-8dc1f19a8b9c` produced the accepted 65-line
  artifact and complete 128,302-gross terminal evidence. After OAuth recovery, two exact delegated
  dispatch sessions failed before Task creation because their sandboxed Daemon bootstrap received
  `EPERM`; both complete events remain counted at 46,366 and 46,796 gross. Total retained delegated
  pre-admission cost is 93,162, but no Task identity exists, so this is incomplete evidence rather
  than a pair result. The accepted repeated-failure clause allows no further dispatch or replacement.
  Preserve the roots and stop before Hub. Exact packet:
  `evidence/m4-e-main-offline-storage-admission-stop-decision-packet.md`.

- **Daemon socket probe permission safety**
  (`specs/m4-e-main-efficient-delivery/work-items/daemon-socket-probe-permission-safety/spec.md`,
  `depends_on: repeated Main-offline pre-admission EPERM evidence`): distinguish explicit stale
  `ECONNREFUSED` from permission denial/timeout/unknown, preserve the live socket for indeterminate
  probes and retain the existing same-inode stale cleanup. No lock, lease or distributed mechanism.

  Status: delivered by Task `b664e69e-ee30-4268-8de3-1f7c07fb808d`, Revision
  `d2066be2-ae14-420d-b09d-103eb0019561`, Review Graph
  `2b394964-36f8-4b12-a025-6087375818b7` and Integration
  `b3bcaf00-f15f-4fbc-93fe-3648fbc254d8`. Independent build/198 tests/diff, two Judge accepts,
  3,096/3,096 full check and a real EPERM inode-preservation audit pass. Runtime identity is matched.
  This product fix does not reopen the stopped pair; M4 and Hub remain held. A subsequent read-only
  feasibility audit identifies a different current subject (`2d774...`, `6676...`, `b664...`) and
  proves existing deterministic delivery staging can leave semantic review/acceptance to one
  measured Codex Main session. No new root, run, Task or sample exists. Execution still depends on
  一骏 explicitly revoking the stopped Work Item's no-replacement boundary.

- **Host-staged distinct storage-lifecycle checkpoint pair**
  (`specs/m4-e-main-efficient-delivery/work-items/host-staged-storage-lifecycle-pair/spec.md`,
  `depends_on: explicit revocation, activated Main-offline delivery and current previews`): use the
  new subject `2d774...` / `6676...` / `b664...`, with deterministic Host submission/observation and
  one measured Codex Main semantic review/decision session. Old artifacts, failures and samples are
  immutable. Direct/delegated roots and acceptance are byte-identical; no reclaim or Hub/UI occurs.

  Status: stopped as `cannot-determine / incomplete-evidence`. Direct Main completed at 174,536
  gross. Deterministic Host staging produced one verified Grok 4.6 Xhigh native-Goal Candidate and
  two usable different-view accepts. The sole measured delegated Main reached semantic accept at
  63,097 gross, but its one decision command used the wrong CLI argument form and was rejected
  before Main review or Integration. Both samples are retained; saving is unavailable and the
  visible 111,439 count difference is not accepted evidence. No retry, Host fallback, replacement
  pair, assessment or Hub work ran. Both roots and the exact Candidate remain protected. Evidence:
  `evidence/m4-e-host-staged-storage-pair-stop-decision-packet.md`.

  Recovery status: 一骏 explicitly authorizes one decision-recording-only continuation. Reuse the
  failed measured session's frozen semantic accept and issue the published positional
  `delivery decide <task-id>` command exactly once. No new model session, Candidate, verification,
  Judge, repair, retry or replacement is admitted. Success permits only deterministic post-state
  checks, the one normal M4-B assessment and read-only pair/value reports; failure is terminal.
  Hub remains held until valid strictly positive evidence exists.

  Recovery result: the one command completed fresh preflight and Integration
  `91dfa097-3ef3-41f1-918c-77166e128430`. All three artifact copies are byte-identical and pass
  the accepted commands. Assessment `mpa-0eb1cbb7-9c5c-42c7-a5cd-664041d3f7e2` accepts the pair:
  174,536 direct versus 63,097 delegated gross Tokens, a 111,439 / 63.848718888939814% saving.
  Storage-lifecycle is now proven lower. Exactly one distinct current Hub comprehension pair is
  the next ready serial M4 Work Item; this does not authorize Hub/UI or open M5.

- **Current Hub product-comprehension pair**
  (`specs/m4-e-main-efficient-delivery/work-items/current-hub-comprehension-pair/spec.md`,
  `depends_on: current worker-runtime and storage proven-lower`): project six current M2–M4
  graduation truths into bounded future-M5 acceptance requirements. Use new task/comparison/output
  identities, byte-identical isolated roots, one Grok 4.6 Xhigh native Goal, independent
  verification, two different-view Judges and the same host-staged measured-Main boundary. The
  historical Hub negative stays immutable. Existing Hub PID 52551 / port 62182 /
  `different-build` must remain unchanged; no Hub/UI action or M5 work is allowed.

  Status: preparation passes byte equality, focused test, quality 100, clear Workspace boundary,
  safe Integration feasibility, native Goal and unlimited Worker duration/Token/no-progress
  policy. Pair root is
  `/var/folders/m2/tx2tqs290l913y61zqz413dr0000gn/T/forklight-m4e-current-hub-pair-tJPcfH`.
  This is the sole active M4 unit. A valid positive result proceeds to M4 boundary verification;
  every other terminal result stops without replay. Crossing into M5 still waits for 一骏.

  Result: delivered by Task `074084d4-4f13-4333-9f9d-52d7971a96ff`, Revision
  `60c9fbc8-a29a-4602-adbf-a26dc1f65299`, Review Graph
  `00f1258c-60d3-459e-b50c-a82526fce9bb` and Integration
  `556105c5-95da-4b8a-b117-51f981c9d019`. Direct Main is 120,989 gross Tokens; delegated Main is
  75,277. Assessment `mpa-cd6c4af0-3fac-4f61-9122-6ec66c60cf26` accepts the 45,712-Token /
  37.78194711915959% saving. No repair, correction, replay or Hub/UI action occurred.

Boundary 2026-08-18 after M4-E continuation: **passed**. The canonical seven-comparison report is
`proven`; current worker-runtime, storage-lifecycle and Hub product-comprehension representatives
are all `proven-lower` at equal scope, acceptance and non-lower quality. Build and 3,096/3,096 tests
pass, client/Daemon identity is matched, live/canonical reports are byte-identical, and Hub remains
PID 52551 / port 62182 / `different-build`. M4 is graduated. Stop before M5 until 一骏 confirms the
Milestone transition.

## M5 — Product graduation and final Hub

Order is mandatory:

1. Clean-clone CLI/API installation, configuration, diagnostics, backup/recovery and real delivery.
2. Freeze functional truth, then use Impeccable once for complete Hub information architecture,
   onboarding, Goal/Plan/Task hierarchy, decision views and value reports.
3. Run bounded desktop/mobile visual checks and an unfamiliar-developer journey.

Exit: another developer completes setup, a real Task, Main review and safe Integration within
30 minutes without database inspection or manual configuration-file editing.

Focused entry audit and accepted Work Items are now frozen at
[`evidence/m5-entry-audit.md`](evidence/m5-entry-audit.md):

1. **M5-A1 — CLI/API setup**:
   [`spec.md`](../../specs/m5-product-graduation/work-items/cli-api-setup/spec.md). A packaged user
   gets readiness, Provider/Keychain, built-in Worker and Main-install actions without the old Hub.
2. **M5-A2 — local backup/recovery**:
   [`spec.md`](../../specs/m5-product-graduation/work-items/local-backup-recovery/spec.md), depends
   on A1. It adds preview/create/inspect/restore for Store plus ForkLight-owned durable state, with
   no Keychain claim or distributed integrity machinery.
3. **M5-A3 — clean-clone real delivery**:
   [`spec.md`](../../specs/m5-product-graduation/work-items/clean-clone-delivery/spec.md), depends on
   A1/A2. It freezes installed-package setup, backup, real Task, review, Integration and restart
   truth before any Hub UI implementation.
4. **M5-B — complete Hub redesign**:
   [`spec.md`](../../specs/m5-product-graduation/work-items/hub-redesign/spec.md), depends on A3.
   The incumbent dark configuration console is an anti-reference. The accepted composition is a
   GoalBoard-family light product shell with searchable Goal Tree, continuous Goal execution file,
   Now/History separation, one Decision Center, contextual technical detail and plain-language
   fact/reason/next copy. Status: stopped before Judges/Integration because the final Candidate still
   exceeds the 390/360px viewport; the frozen contract permits no further replacement.
5. **M5-C — human/visual graduation**:
   [`spec.md`](../../specs/m5-product-graduation/work-items/human-acceptance/spec.md), depends on B.
   It owns desktop/mobile, 10-second comprehension and unfamiliar-developer 30-minute evidence.
   Status: dependency-held.

The chain is serial. A1 and A2 overlap `src/cli.ts` and public-surface tests; A3 consumes both final
contracts; B waits for the functional freeze; C observes the integrated final product. Main owns
shared SSOT and serial Integration. M5-A1 is graduated: its setup Candidate, authorized quality-chain
bootstrap, same-Judge repair, serial Integrations and 3123-test full check are recorded in
`evidence/m5-a1-graduation.md`. M5-A2 is also graduated: its native-Goal delivery, independent
verification, corrected read-only/late-owner safety, two usable Judges, safe Integration, 3140-test
full check and temp-Home round trip are recorded in `evidence/m5-a2-graduation.md`. M5-A3 later
graduated through `evidence/clean-clone-run.md`. M5-B is now stopped at its final accepted
mobile-shell gate; M5-C remains held, and no new wave is ready without an explicit Main contract
decision.

M5-A3 has since stopped after its sole post-fix clean-bundle run repeated the same non-publishing
`cleanup-failed` terminal. The integrated two-path stale-PID guard, independent verification, two
Judges, safe Integration and 3,143/3,143 full check remain reusable, but the existing error does not
retain the prior verification category or identify whether Hub or Daemon cleanup stayed false.
Before another behavior recovery, Main must admit a bounded diagnostic-only amendment for those
facts. No fourth bundle or M5-B Hub implementation is ready from the current evidence.

That diagnostic amendment is now the sole ready serial A3 wave. It changes only the clean-run catch
projection and focused test, then runs through Grok 4.6 Xhigh native Goal, independent acceptance,
two Judges and Main Integration. Its one post-Integration external run may collect closed failure
classification only; it does not authorize cleanup behavior changes or release M5-B.

The diagnostic wave proved the local IPC root cause: the staging-derived `forklight.sock` was 113
bytes against Darwin `sun_path[104]`, while the same installed build passed from a short socket
path. The two-path short-runtime-Home recovery then passed its quality chain, safe Integration and
3,151/3,151 full check. Its sole admitted bundle published successfully and cleaned its runtime
root. The installed-package journey completed one real Grok native-Goal Task, independent
verification, one ordinary Judge, Main accept, one safe Integration and restart-stable no-duplicate
truth. M5-A3 is graduated; `evidence/clean-clone-run.md` freezes the functional/API inventory.
M5-B complete Hub redesign is now the sole active serial wave. Its accepted focused audit proves
the existing Hub read/action APIs are sufficient and narrows the delivery to `DESIGN.md`, four
public assets and two focused UI tests. Original Task `24f8000a-5810-43e3-9f15-098ccf94203c`
retains the complete seven-path redesign but stopped after its correction narrowed verification to
one invalid test fixture and one 80-pixel mobile Goal-entry offset. Focused recovery Task
`0be03566-54d9-4e01-8224-a3b1088c1128` closed those gaps and passed build plus 421 focused tests.
Main's real browser QA still rejected the 390px permanent shell because two bars consumed 196px,
Chinese Back/title labels wrapped vertically and Back remained after a wide resize. Final Task
`64b4ac59-c3a7-4eb2-bd18-02294045be8b` reused the exact verified Candidate and narrowed the shell
through one Grok 4.6 Xhigh native Goal. It reached 96px permanent chrome, horizontal labels and a
resize-aware Back helper, but independent build failed on one test-only TypeScript narrowing and
real 390/360 QA proved the shell itself is still about 405.3px wide: Back and the System utility
menu extend outside the viewport. That Task remains stopped and protected. 一骏 has now granted
standing authority for ordinary in-Goal follow-on Tasks and made correct UI interaction/motion a
hard requirement, superseding only the no-replacement boundary. The accepted serial continuation
uses a different hierarchy: product identity plus Work/Decision/System in row one, contextual Back
plus title in row two, viewport-fit System utilities, outside/Escape dismissal with focus return and
restrained reduced-motion-safe feedback. It reuses exact Revision `8454e3cf...` through Daemon
submission, then requires independent acceptance, batched 320/360/390/landscape/desktop QA, two
Judges and Main serial Integration. M5-C remains dependency-held.

## Operating rule

Within a confirmed Milestone, Main keeps the dependency graph current and starts the next ready
wave automatically. A Work Item stops on acceptance or on the evidence-based stop conditions in
the Goal; non-blocking findings go to Later. At the Milestone boundary, update evidence and wait
for 一骏 before crossing.

Current M5-B serial unit: the structural-mobile Writer Task stopped only at the native Goal
terminal join. Its exact Workspace passes Main build and 424 focused tests, but Grok's host-owned
completion classifier canceled both productive reviewers at 599,996ms and returned unknown Goal
status, so ForkLight correctly produced no Revision or verification. The next unit is not another
UI implementation: it materializes the exact seven-path output and uses Grok's documented legacy
model-facing `/goal` driver, read-only, with the existing 24-hour foreground process breaker. It
has one Attempt and no repair/correction/replacement path. Success resumes independent acceptance,
the full browser interaction/motion gate, two Judges and serial Integration; the same terminal
failure stops M5-B. M5-C remains held.

Superseding current unit: Task `78c6fec4-b030-4b30-988b-41d01973cbdd` also failed before Candidate
capture because its alternate driver created no Task-local native Goal state. 一骏 has now directed
Main to complete the UI itself. No further M5-B UI Worker or Grok replacement is admitted. Main
will use the existing `main-direct` decision record, prove no seven-path source drift, apply the
protected structural output, run the five machine checks, complete real responsive/interaction/
motion browser acceptance and resolve any reproduced defect inside the same path boundary. Final
review is read-only; Main owns all edits and final disposition. M5-C remains held until M5-B passes.

Global Grok execution rule from this point forward: do not set Task duration, Token, no-progress or
model-work waiting ceilings. Any forced client/tool timeout is only a bounded observation request
and cannot alter a still-running Task; continue from durable events rather than treating that
window as Runtime failure.
