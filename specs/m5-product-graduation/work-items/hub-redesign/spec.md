# M5-B — Human-first ForkLight Hub redesign

## User result

Opening ForkLight immediately tells a developer what the current Goal is trying to achieve, what is
true now, whether a decision is needed and what happens next. The interface feels like the
execution-and-delivery member of the GoalBoard product family, while keeping ForkLight's own truth
and workflows.

## `depends_on`

- M5-A3 accepted clean-clone functional freeze and read-model inventory.
- `PRODUCT.md`, the M5 UI contract and GoalBoard's `PRODUCT.md`/`DESIGN.md` as read-only family
  references.
- No dependency on the incumbent Hub's visual system; it is a functional/API reference and visual
  anti-reference.

## Focused entry audit and implementation boundary

The accepted pre-implementation audit is intentionally limited to the Hub call chain. The current
static shell is a 101-line configuration-first sidebar over approximately 7,100 lines of layered
CSS, 19,100 lines of browser logic and 6,000 lines of bilingual strings. It already proves the
underlying operations but its dark rail, teal palette, many peer tabs and accumulated override
layers are the exact experience being replaced, not a design system to preserve.

The existing API truth is sufficient for this Work Item:

- `/api/ops/work-hierarchy` supplies Goal, ordered Plan/phase and Task placement, including the
  canonical `waiting-user-decision` column and Now/History placement;
- `/api/ops/goals/:id`, `/api/ops/tasks/:id` and `/api/ops/tasks/history` supply the current Goal,
  human-safe Task journey, retained Candidate, verification, Judge/Main, delivery and History;
- existing confirmed Task, Goal, Integration, setup and configuration mutations remain the only
  action paths;
- the browser already has bounded continuity state for selection, scroll, disclosures, filters and
  drafts. Preserve those behaviors while changing their presentation.

Therefore the first implementation may edit only the static Hub assets, `DESIGN.md` and focused
Hub tests. It must not change `src/hub/server.ts`, Core, Store or daemon projections. If a concrete
screen cannot be implemented from these routes, stop with the missing fact, calling screen and a
focused failing test; update this accepted Spec before any backend expansion.

Baseline before implementation: `npm run build` and the six focused Hub files in the Verification
section pass 413/413. This is the functional floor, not a visual endorsement.

## Information architecture

### Global structure

- A light, compact product bar identifies ForkLight, the current project/Goal context, one Decision
  Center entry and auxiliary setup/diagnostics.
- A searchable, resizable Goal Tree separates Now from History and preserves selection. Goal is the
  primary object; its Plans/phases and Tasks are visible as context rather than competing apps.
- The main surface is one continuous Goal execution file, not a dashboard of unrelated cards.
- Technical Task details open in context on desktop and as a clear single page on mobile. Returning
  never loses the selected Goal or reading position.
- Work is the default product route. Model, Worker, Main, Delivery, setup, backup and diagnostics
  remain reachable from a quiet auxiliary System area; they do not compete with Goal execution in
  primary navigation.

### Continuous Goal execution file

The reading order is fixed by human judgment, not API order:

1. desired result and completion standard;
2. one plain sentence describing what is true now;
3. whether the user must decide, with a link to the one Decision Center;
4. current Plan/phase and the next meaningful checkpoint;
5. current Task result, verification truth and retained work;
6. risks/blockers and their next action;
7. delivery state and History;
8. folded evidence, Runtime, Attempt, Token, cost and raw logs.

### Decision Center

- All user decisions appear in one route grouped by Goal. Other pages may explain that a decision
  is needed but do not duplicate the full mutation controls.
- Every item says what happened, why a decision is needed, what is already retained and the impact
  of each action before buttons such as “批准继续” and “退回修改”.
- Machine verification, Judge opinion and Main decision are visibly different sources. A suggestion
  is never rendered as an executed action.
- Build the Center from canonical hierarchy cards and existing Task detail reads. It groups pending
  decisions by Goal, with a bounded section for parentless Tasks. Reuse the existing confirmed
  mutation components instead of creating a second action implementation or stored decision list.

### Setup and first use

- Setup is auxiliary after readiness, but a missing prerequisite appears exactly where it blocks
  current work with reason and next command/action.
- First use shows one complete example from Goal to Task, decision and delivery without requiring
  internal vocabulary.

## Content and visual system

- Write concise native Chinese and independently readable English. Important state uses
  fact → reason → next action. No isolated `unknown`, `null`, state code or unexplained ID.
- Inherit GoalBoard's cool near-white field, graphite type, action blue, semantic
  green/amber/violet/red, hairline borders, compact 3–8px radii, flat surfaces, Inter/SF/PingFang
  stack and Lucide-style line icons. Color always has text/icon support.
- Do not retain the old dark sidebar, teal palette, configuration-first tabs, large card grid,
  gradients, decorative hero, model ranking or dense status dashboard.
- Create/update ForkLight's own `DESIGN.md`; do not modify GoalBoard or copy its data model.
- The authored default is light. Do not preserve the incumbent dark sidebar, teal brand mark or
  append another CSS override layer to the old shell. Replace the shell and consolidate the style
  rules needed by the delivered composition.
- Use ordinary sentence case and concise labels. Page-visible copy contains no em dash or en dash.
  A raw identifier, Provider/Runtime name, Token count, cost or log may appear only in an explicitly
  opened technical disclosure.

## Interaction and responsive requirements

- Live refresh preserves Goal/Task selection, scroll position, filters, expanded evidence and
  unsubmitted form content. It does not jump or steal focus.
- Keyboard structure, visible focus, contrast and reduced-motion behavior are required.
- At `<=760px`, use a single-pane tree/document/detail flow with an obvious back path; status,
  decisions and primary action remain discoverable.
- Destructive cleanup/restore explains the impact and requires confirmation.
- Desktop Goal Tree supports search, Now/History and a persisted bounded resize handle. At
  `<=760px`, tree, Goal file and Task/Decision detail are separate panes rather than a squeezed
  desktop grid; every deeper pane has a visible Back action.
- Existing polling may update facts but never replaces the live reading surface when its semantic
  truth is unchanged. A real update restores the selected Goal/Task, Goal Tree width, tree query,
  scroll, open evidence and unsaved form values without stealing focus.

## Implementation shape

1. Rewrite the static shell into a compact GoalBoard-family product bar, Goal Tree, continuous
   document host, one Decision Center route and auxiliary System access. Keep one `#fl-view` and one
   contextual detail host so current fetch and safety boundaries remain usable.
2. Recompose the Work renderer around the fixed reading order. A Goal is one document with phase
   and Task sections, not seven equal dashboard columns. Canonical column codes still drive state;
   presentation may group them into Current, Needs decision, Blocked and History without mutating
   lifecycle truth.
3. Add the Decision Center as a browser composition over existing hierarchy/detail data. Other
   locations link to that same decision experience and may reuse the same Task detail component;
   they do not implement a second set of decision controls.
4. Move configuration, diagnostics, Competition and value evidence behind System or contextual
   disclosures. Do not delete their safe actions or fabricate replacement data.
5. After the built world is coherent, write ForkLight's `DESIGN.md` from the actual result. Run the
   Impeccable detector exactly once, fix only concrete findings, then perform one bounded desktop
   and mobile implementation QA. M5-C still owns final graduation screenshots, ten-second
   comprehension and the unfamiliar-developer journey.

## Allowed paths

- `PRODUCT.md`, new/update `DESIGN.md`
- `src/hub/public/index.html`, `src/hub/public/app.css`, `src/hub/public/app.js`,
  `src/hub/public/i18n.js`
- `src/hub/server.ts` and focused Hub projection modules only for missing human read models or one
  Decision Center projection; no new persistence model
- Hub-focused tests and M5 screenshot/QA assets under the sole Goal evidence directory

Initial Writer ownership is narrower than the repository-level allowance above:

- `DESIGN.md`
- `src/hub/public/index.html`
- `src/hub/public/app.css`
- `src/hub/public/app.js`
- `src/hub/public/i18n.js`
- `tests/hub-ui-assets.test.ts`
- `tests/hub-responsive-layout.test.ts`

`PRODUCT.md`, `src/hub/server.ts`, all other tests and the Goal SSOT are read-only for the Writer.
Main alone updates `plan.md`, `progress.md`, `decisions.md` and the evidence index after acceptance.

## Forbidden paths and non-goals

- GoalBoard writes or real cross-app connection; new Goal/Plan/Task/Decision persistence model;
  changing execution, verification, Judge, Main or Integration semantics to simplify rendering.
- Marketing claims, invented customer data, team/org features, telemetry dashboard, model
  leaderboard, decorative animation, old-Hub reskin, commit or push.

## Acceptance

- An unfamiliar developer can answer within 10 seconds: current Goal/Task, state, whether a decision
  is required and next action.
- Goal/Plan/Task, Now/History and one Decision Center remain coherent across desktop/mobile.
- Running, waiting decision, blocked, failed, partial and completed states each show fact, reason,
  retained work and next action.
- Empty/error/loading/live-update behavior is understandable and does not destroy context.
- Existing safe actions use current API truth and remain independently tested.
- Impeccable preflight, shape review, implementation detector (once), finish review and visual QA
  complete. Relevant Hub/build tests pass.
- The actual diff is a replacement composition rather than an appended reskin: primary navigation
  is Goal-first, the dark/teal configuration rail is gone, the Goal Tree and continuous file are
  visible, and only one Decision Center exists.
- All 413 pre-implementation focused assertions either still pass or are deliberately updated when
  they assert the rejected old layout. Every changed assertion names the new human behavior; no
  safety, privacy, lifecycle or mutation assertion is weakened to make the redesign pass.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/hub-ui-assets.test.ts tests/hub-responsive-layout.test.ts tests/hub-contract-quality.test.ts tests/hub-settings.test.ts tests/hub-operations.test.ts tests/hub-ops-mutations.test.ts
git diff --check
```

Before handoff, also parse `app.js` with `new Function`, inspect the scoped diff for page-visible
em/en dashes and run the one Impeccable detector command recorded by Main. The detector is not a
loop and is not rerun after every edit.

## Focused recovery after retained Attempt 3

Task `24f8000a-5810-43e3-9f15-098ccf94203c` remains failed and protected. Its second Attempt passed
the full independent suite, then bounded browser QA found a stale Work body on Decision Center,
an 80-pixel mobile Goal-entry offset, overly tall mobile chrome, character-wrapped status text,
overwide prose and four inherited thick side borders. Main requested one correction. Attempt 3
produced retained Candidate Revision `df5bd185-ef5d-4982-843c-ddf7c73a9e17`, addressed that focused
set, and then failed independent acceptance at exactly two narrower points:

- `tests/hub-ui-assets.test.ts` assigns `null` to a fixture field whose contract requires an
  object containing `id`, so TypeScript build fails;
- the deliberate narrow Goal-file test observes shared `content.scrollTop === 80` after
  `workApplyGoalFileStart`, while the accepted behavior is the Goal header at exact top (`0`).

The original Task cannot run another Worker: its remaining automatic-repair projection applies
only to an initial Worker delivery, not to a Main-correction Attempt. 一骏's standing authorization
therefore admits one new bounded recovery Task without changing this Work Item or creating another
Spec. It materializes the exact seven-path retained Candidate from a Workspace-local patch, using
only an exact path-set check and `git apply --check` to prevent a wrong Candidate/source base. It
may change production behavior only in `src/hub/public/app.js`. Test-only correction is limited to
the invalid fixture in `tests/hub-ui-assets.test.ts` and passing the already-created `content`
scroll object into the existing `new Function` harness in `tests/hub-responsive-layout.test.ts`;
the assertions and exact expected zero remain unchanged. `DESIGN.md`, `index.html`, `app.css` and
`i18n.js` must stay unchanged from the retained Candidate. One base Attempt and at most one
same-Worker validation repair are allowed, with no absolute duration, Token or no-progress ceiling,
no Main correction, extra Attempt, adaptation, fallback or model switch.

The responsive harness wiring was not a third product behavior gap: the fixture already created
the `content` object but the extracted function could not close over it. Passing that object as an
explicit parameter makes the unchanged assertion observe the same production reset proved by the
browser. The accepted verification commands remain unchanged, with one added syntax check for the
operational bootstrap. The Impeccable detector already ran exactly once and must not run again.
After passing independent verification, Main repeats only the bounded desktop/mobile browser
checks, then the same two-Judge and serial Integration gates apply.

## Final responsive-shell recovery after browser rejection

Focused recovery Task `0be03566-54d9-4e01-8224-a3b1088c1128` independently passed build and all
421 focused tests with verified Candidate Revision `a80ae711-e345-4c14-95b6-2c011cbb03db`.
Desktop QA proves the Goal document is readable, status text stays on one line, Goal prose is
bounded to about 68 characters and Decision Center replaces the Work body correctly. Main still
rejected this Revision before Judges because real 390x844 rendering exposed four related shell
failures that static acceptance missed:

- product bar plus page topbar consume about 196 pixels before the Goal content;
- theme/language controls crowd permanent chrome instead of quiet System access;
- `返回` and page title `工作` wrap one Chinese character per line;
- after a narrow Goal file is resized back above 760px, the Back button remains visible until a
  later render.

This is one unresolved responsive-shell acceptance item, not a new redesign. One final exact-
Candidate recovery may substantively edit only `src/hub/public/index.html`,
`src/hub/public/app.css`, the resize/Back chrome path in `src/hub/public/app.js` and corresponding
shell assertions in the two existing focused UI tests. `DESIGN.md`, Goal composition, Decision
Center, copy/data adapters, i18n strings, API reads, actions and all backend paths remain unchanged.
The Worker may move existing theme/language controls into the existing System disclosure so they
remain reachable without occupying permanent mobile chrome; it must not create a second utility or
state implementation.

At 390x844 and 360px width, the product and page bars together are at most 112px, every primary
label and Back remain horizontal on one line, the page has no horizontal overflow, Work, Decision
Center and System stay reachable, and the first Goal viewport starts with the Goal header/result.
Back appears only for a narrow file/detail pane, restores the tree context, and becomes hidden
immediately when the viewport grows above 760px without depending on a data refresh. Desktop keeps
the accepted single-row product bar, Goal Tree and readable Goal file. The exact same five machine
commands run, followed by one final Main browser pass; the Impeccable detector is not rerun.

The recovery has one base Grok 4.6 Xhigh native-Goal Attempt and at most one same-Worker validation
repair, with no absolute duration, Token or no-progress limit, no Main correction, extra Attempt,
adaptation, fallback, model switch or further replacement. If the same mobile-shell failure remains
after this focused round, stop M5-B with the retained desktop result and exact visual evidence.

## Final responsive-shell outcome

Task `64b4ac59-c3a7-4eb2-bd18-02294045be8b` captured Revision
`8454e3cf-ea26-4b8f-892f-234b7835e13c`. Bootstrap syntax, 422 focused tests, JavaScript/visible-copy
checks and diff validation pass; build rejects one test-helper `string | undefined` return. Final
real QA still finds the same responsive-shell failure: desktop `1440x900` passes, while 390px and
360px render about 405.3px-wide product/page rows; Back leaves the viewport and the System menu
extends to about 446.6px, clipping utilities. Reduced 96px chrome and horizontal labels are useful
partial output, but hidden overflow is not a fitted mobile shell.

The accepted stop condition therefore fires. The Candidate and screenshots stay protected; no
Judge, Main accept, Integration, correction, reverify or further replacement runs. M5-C remains
held. Evidence is `goals/forklight-main-led-execution/evidence/m5-b-final-responsive-stop.md`.

## Structural mobile-hierarchy continuation under standing authorization

一骏 has now granted continuing authority for ordinary follow-on Tasks inside this long-lived Goal
and explicitly requires UI interaction and motion to meet user expectations. This supersedes the
prior no-further-replacement stop boundary without weakening its evidence: Task
`64b4ac59-c3a7-4eb2-bd18-02294045be8b` remains failed, its Workspace and screenshots stay
protected, and no favorable relabel or unchanged retry is allowed.

The accepted next design changes the hierarchy instead of shrinking or clipping it. At 760px and
below, the product row contains only ForkLight identity plus Work, Decision Center and System. The
existing Back control moves into the page row beside the current title; redundant mobile top-meta
chips leave permanent chrome while desktop meta remains unchanged. Below 360px, the visual brand
may reduce to its mark if ForkLight remains the accessible name. All three routes stay visible and
horizontal. The System menu anchors to the fitting viewport edge, has a bounded width/height and
vertical scroll, and keeps every existing route, theme/language control and connection fact
reachable through the same DOM controls and handlers.

Interaction acceptance is explicit. System closes on route selection, outside pointer/touch and
Escape; Escape restores focus to its summary. Back remains a 44px touch target, appears only for
narrow file/detail state, restores the Goal Tree, and disappears on wide resize without a fetch or
refresh. Goal entry remains at exact scrollTop zero. The menu may enter with one restrained
120-160ms opacity plus small vertical translation, and navigation state may use the same short
color transition. No scale, bounce, looping or content movement is admitted; reduced-motion
removes all new animation/transition without changing behavior.

Main's real browser acceptance now covers 320, 360, 390, 667x375 landscape and 1440x900 in one
batched pass. Every visible product/page/menu bounding box must be inside the viewport; hidden
overflow is not evidence of fit. Desktop composition and Decision Center route must remain
unchanged. The Impeccable detector is not rerun because its one permitted M5-B run already
completed.

Operational Task `execution/m5-wave-4/04-m5-b-structural-mobile-hierarchy-recovery.yaml` reuses
exact Revision `8454e3cf-ea26-4b8f-892f-234b7835e13c` through a Workspace-local seven-path seed.
Only index shell markup, final CSS, bounded System/Back presentation and the two focused tests may
change substantively; `DESIGN.md` and `i18n.js` must remain byte-identical to the seed. One base
Grok 4.6 Xhigh native-Goal Attempt, one automatic validation repair and at most one evidence-based
Main correction/reverification are available, with no duration, Token or no-progress ceiling and
no generic extra Attempt, adaptation, fallback or Competition. The Task is submitted through the
Daemon so the declared automatic repair path is real. Two different-view Judges and Main serial
Integration remain mandatory.

ForkLight submitted this contract as Task `2fea24e4-b053-4b18-b1b0-fa1f1a3e2d75`; prior Candidate
Tasks remain immutable and this new Workspace is protected through final disposition.

## Legacy-driver terminal recovery after exact Candidate completion

Task `2fea24e4-b053-4b18-b1b0-fa1f1a3e2d75` completed the structural implementation in its isolated
Workspace. The exact Workspace passes Main's read-only `npm run build` and all 424 focused tests,
including the new hierarchy, System route/outside/Escape dismissal, focus return, Back/tree/resize,
short motion and reduced-motion assertions. `DESIGN.md`, `i18n.js` and
`tests/hub-ui-assets.test.ts` remain byte-identical to Revision `8454e3cf...`; substantive delta
from that Revision is exactly `index.html`, `app.css`, `app.js` and
`tests/hub-responsive-layout.test.ts`.

ForkLight nevertheless captured no Candidate Revision because Grok's native Goal status was
unknown. Durable Runtime evidence is specific: the host-owned completion classifier started two
current-model Grok reviewers, both remained productively inspecting the full Candidate, and at
599,996ms both were canceled while entering their final verdict turn. The process then exited zero
without `complete + achieved`; ForkLight correctly failed closed and skipped validation repair.
This is not machine acceptance or visual evidence, but it proves the remaining gap is terminal
handoff rather than another product implementation round.

Under 一骏's standing authority, one final exact-Candidate delivery Task is admitted without a
second Spec. It uses Grok CLI's documented alternate `/goal` driver: ForkLight still launches a
real current-model-only native Goal, while the wrapper changes only the child
`GROK_WORKFLOWS` value to `0`, selecting the legacy model-facing `update_goal` path that still
triggers completion verification. The wrapper freezes the already integrated
`GROK_FOREGROUND_BLOCK_BUDGET_MS=86400000` process breaker for any foreground verifier. No Task
duration, Token or no-progress ceiling is introduced.

The Task materializes the original seven-path seed followed by exact four-path structural delta
`62a29012dc7bfa1c7cdf8745d100089deb96bc28f2536a54060e6d51f4a5a397`. A focused policy test proves
the two driver values, current-model-only requirement, 24-hour process breaker, strip levels and
four-path delta. A clean temporary materialization is byte-equal to the protected Workspace on all
seven paths. The Worker is read-only and may not change any Candidate byte. It has one Attempt,
zero validation repair, Main correction, reverify, extra Attempt, adaptation, fallback or
Competition. The same five independent acceptance commands, real 320/360/390/667x375/1440 browser
gate, two different-view Judges and Main serial Integration remain mandatory.

If this documented driver again ends without `complete + achieved` or repeats the ten-minute
terminal loss, the recovery stops with both Workspaces and the exact materialization protected.
Standing authority does not permit another automatic replacement after the same blocker repeats.
Operational contract:
`goals/forklight-main-led-execution/execution/m5-wave-4/05-m5-b-exact-structural-candidate-delivery.yaml`.
ForkLight accepted it as Task `78c6fec4-b030-4b30-988b-41d01973cbdd`; its Workspace is protected
through terminal delivery, verification, browser/Judge review and final disposition.

## Main-direct implementation override

Task `78c6fec4-b030-4b30-988b-41d01973cbdd` ended `failed` before Candidate capture. Its sole
Attempt exited code zero, but the alternate driver never created native Goal state under the
Task-local Runtime Home; ForkLight therefore reported `Grok native Goal state is missing`, ran no
verification and started no Judge or Integration. The protected structural Workspace from Task
`2fea24e4...` remains the only reusable seven-path UI output.

一骏 now explicitly requires Main to implement M5-B UI directly and not use another UI Worker.
This supersedes the legacy-driver replacement path and the earlier Worker-only Integration clause,
without relabeling either failed Task. Main first proves the current source versions of the seven
allowed paths still match the structural Task baseline, then applies that exact protected output
to the source worktree, runs the accepted machine checks, inspects the scoped diff and performs the
full real-browser gate. Any correction stays inside the same seven product/test paths and must fix
a reproduced acceptance failure; no unrelated UI or API work is admitted.

This direct path is recorded through ForkLight's `main-direct` decision surface, creates no Worker
Attempt and makes no Token-saving claim. The two required final opinions remain read-only review
work rather than UI implementation; Main owns all edits, browser decisions and final disposition.
If review cannot be attached to a direct-source revision without fabricating Candidate truth, Main
must record that evidence limitation and use the independent browser and scoped machine evidence;
it must not create a fake Candidate or another UI delivery Task.

For any later Grok use, no Task duration, Token, no-progress or model-work waiting ceiling may be
set. A client or tool observation call may still require a finite transport parameter, but that
parameter is observation-only: reaching it never cancels, fails, recreates or reroutes the Grok
Task. Main resumes observation from durable Task/Attempt events until the Runtime reaches a real
terminal state.

## User-view hierarchy redesign after live review

The structurally valid Candidate still presents Work from the system's point of view. It puts a
large creation form and a written “Task, Plan, or Goal” lesson before the user's real work, then
shows Goals as a flat list. This makes the user learn ForkLight's vocabulary before they can see
what they are trying to achieve. 一骏 rejects that result as mechanical.

Work must instead make the relationship visible. The rail's first meaningful content is a real
nested tree: a Goal contains sibling Plans, and each Plan contains sibling Tasks. Indentation,
connectors, disclosure and placement communicate the hierarchy and parallel siblings; no teaching
paragraph explains which object to choose. Existing independent Plans and one-off Tasks remain
reachable in a quieter independent-work group rather than being misrepresented as Goal children.

Creation is contextual and user-initiated. The tree root offers “New Goal”; a Goal offers “Add
Plan”; a Plan offers “Add Task”. Only after the user chooses one does the existing outcome intake
composer open with that shape fixed and the exact visible parent context included in its existing
`context` input. The UI must not claim that an object is created before the current proposal and
confirmation flow has actually completed. No backend endpoint, schema, stored hierarchy or action
contract changes.

Copy states the concrete result or next action in short human language. The rendered
`workShapeGuideTitle`/`workShapeGuideHint` teaching block is retired. The contextual composer may
say “New Goal”, “Add a Plan to …” or “Add a Task to …”, followed by one sentence explaining that
ForkLight will propose the next step for confirmation. Raw ids and implementation vocabulary stay
out of primary copy.

On phone, the real tree appears before any composer; a composer may occupy the rail only after an
explicit add action. Selecting a Goal, Plan or Task opens the existing corresponding file/detail
behavior, and Back restores the tree. Search retains ancestors when a descendant matches. Work,
Decision Center, System, Now/History, the Goal file, Task detail, existing actions, accessibility,
reduced motion and responsive shell behavior remain unchanged.

Implementation remains inside the accepted seven product/test paths plus this Goal's SSOT. It
adds no dependency or new product entity. Main verifies nested rendering, contextual creation and
placement context in focused tests, then repeats the complete 320, 360, 390, 667x375 and 1440x900
browser pass including disclosure, selection, add/cancel/submit boundaries, keyboard focus,
reduced motion and copy audit.

## User-friendly Work revision after M5-C entry review

一骏 rejects the graduated Work surface as still too mechanical. The nested hierarchy is correct,
but the screen still asks the user to assemble meaning from repeated object labels, section names,
status chips and a long stack of equally weighted Goal-file blocks. This reopens M5-B's human
acceptance without discarding its functional result. The already-running M5-C two-path runbook
repair remains useful and may finish, but unfamiliar-human observation cannot start until this
revision passes.

The accepted direction is a **Goal document with an outline**, not a dashboard and not an admin
console. The Goal is the page title and desired result. Its current truth and next meaningful action
form one opening story. Decision-needed appears only when real and receives the primary action;
the no-decision case is quiet inline context rather than a dedicated panel. Current Plan and Task
read as the active chapter of the Goal. Empty blocker, delivery and technical sections do not take
equal first-screen weight; real blockers, retained work and completed delivery remain truthful and
visible when present, while technical evidence stays folded.

The tree remains the structural explanation of Goal, Plan and Task, but becomes an outline:

- level is conveyed by indentation, connectors, type scale and disclosure before repeated labels;
- Goal, Plan and Task labels remain available to assistive technology and in quiet secondary text,
  not as a badge on every row;
- contextual add actions stay beside the parent they affect and open the same proposal/confirmation
  flow in place;
- opening a composer visually holds the selected branch and shows the proposed outcome at that
  location, without claiming durable creation before confirmation;
- sibling Plans and Tasks continue to communicate parallel work, and independent work stays in its
  own quieter group.

Permanent chrome becomes quieter. On Work, the redundant page heading, instructional subtitle and
daemon/count pills may not compete with the selected Goal. Work, Decision Center and System remain
reachable, connection/setup truth remains available, and no real route or action is removed. The
first desktop viewport must answer from the Goal content itself: what is being achieved, what is
true now, whether 一骏 must decide and what happens next. The first mobile viewport starts with the
tree; entering a Goal starts with the same opening story, not a compressed desktop dashboard.

Visual language stays in the GoalBoard family but is warmer in behavior: light field, graphite
type, action blue, flat paper, hairlines and compact radii. Hierarchy comes from spacing and type,
not from a box around every fact. Motion is limited to branch disclosure, composer insertion,
selection and pane transitions that explain state change; it uses opacity/translation only,
finishes within 120-180ms and disappears under reduced motion. No decorative animation, glow,
gradient, oversized hero, new icon dependency or fabricated metric is admitted.

Main implements this UI directly. Allowed product paths remain `index.html`, `app.css`, `app.js`
and `i18n.js`, with the two existing focused UI tests and `DESIGN.md` at finish. Backend, Store,
Core, daemon, API projections and the running M5-C runbook Candidate are read-only. Before edits,
Main records this amendment; after edits it runs the accepted build/focused commands, one
Impeccable detector pass for this new revision, one batched desktop/mobile inspection, one material
fix batch and one confirmation pass. Acceptance additionally requires:

- no visible “Goal / Plan / Task 怎么选” or equivalent instruction;
- no separate no-decision or no-blocker card consuming the first viewport;
- the selected Goal's desired result, current truth and next action are visually dominant;
- contextual creation and Task detail keep their already-accepted confirmation, stale-response,
  Back/focus and live-refresh continuity contracts;
- 320, 360, 390, 667x375 and 1440x900 remain fitted with no horizontal clipping;
- visible Chinese and English copy passes the plain-language and zero em/en-dash audit.

## Handoff and workspace disposition

Handoff includes the final IA, `DESIGN.md`, proof that no read model/action contract changed, copy
decisions, desktop and mobile implementation screenshots, detector/finish findings, scoped diff and
focused results. For this explicitly authorized Main-direct UI path, Main applies only the
source-drift-proven exact seven-path output, then retains screenshots and review evidence. The two
failed Worker Workspaces remain protected until the direct result is accepted and their reusable
evidence is durably linked; ordinary storage lifecycle, not manual deletion, owns later
reclamation.

## Selected-branch disclosure refinement after live operating audit

一骏 has asked Main to continue product development while deferring the unfamiliar-operator gate.
That gate remains missing evidence and is not treated as passed. A fresh live audit of the accepted
Work surface found one narrower M5-B presentation failure: `Now` correctly retains every
non-terminal Goal, but every one of those Goals and every short child Plan opens at once. The first
screen therefore expands parallel Goal, Plan and Task branches into one long operational list. The
hierarchy is structurally true but its default presentation again makes the user parse the whole
Store before choosing the work they want to read.

The accepted correction makes disclosure follow the current reading path:

- the selected Goal opens by default; other parallel Goals remain visible as sibling rows but start
  folded;
- inside that Goal, the selected/current Plan opens by default; sibling Plans start folded;
- selecting a folded Goal or Plan opens that exact path, while explicit user disclosure remains a
  tab-local reading preference across a real Work rebuild;
- a search or an open contextual composer may temporarily open the necessary ancestor path so a
  matching result or draft is never hidden;
- `History`, canonical Goal/Plan/Task placement, selection, independent work, creation,
  confirmation, Task detail and Decision Center truth remain unchanged.

This is a Main-direct UI correction. The writable product boundary is
`src/hub/public/app.js` plus focused assertions in `tests/hub-ui-assets.test.ts` and
`tests/hub-responsive-layout.test.ts`; CSS, copy, backend, API, Core, Store and daemon paths are
read-only unless live verification proves a concrete additional failure and this Spec is updated
first. The existing Impeccable detector is not rerun: it already completed the accepted revision,
and this change adds no new visual primitive or copy. Verification is the accepted build and Hub
commands, JavaScript parsing, diff check, then one batched live check that proves the first tree
contains sibling Goals with only the selected path expanded, disclosure persists through a forced
Work rebuild, search reveals matching ancestry, and phone Back/file behavior is unchanged.

## Decision Center independent-backlog containment

The same live pass found a second first-screen failure after the selected tree was accepted. The
current Decision Center has 131 canonical pending items: four belong to visible Goals, while 127
parentless review/recovery Tasks are rendered as full peer cards. ForkLight is truthfully exposing
the Store, but the repeated parentless backlog turns the decision route into hundreds of screens and
pushes the Goal decisions out of a usable decision hierarchy. System itself fits, remains compact
and needs no correction.

The accepted presentation keeps all canonical decisions and every existing action:

- Goal-bound decision groups remain open and lead the route;
- parentless decisions move into one native disclosure labeled with their real count; it starts
  open only when it contains at most three items and otherwise starts folded;
- an explicit open/fold choice is remembered as existing tab-local reading state across a route or
  Work rebuild; no Task is archived, grouped as one record, reprioritized or removed;
- the three generic Runtime count chips disappear from Decision Center chrome because they do not
  explain a decision and remain available in System connection truth;
- opening the disclosure renders the same complete decision cards and confirmed action paths.

Main implements this directly in `app.js`, `app.css`, `i18n.js` and the two focused UI tests. No
backend/API/schema/Core/Store/daemon or mutation change is admitted. Acceptance proves the 4 + 127
live shape, default fold, count, keyboard-native disclosure, persisted open state, unchanged open
action, mobile fit and zero horizontal overflow. The already-run Impeccable detector is not rerun;
the new CSS reuses the accepted Decision Center tokens and the new bilingual label receives direct
copy/width review. The current clean packet becomes historical as soon as this source change lands;
do not regenerate another packet until this focused Decision Center audit is accepted.

## Cross-route reading start after the complete-Hub audit

After the primary Work/Decision/System audit passed, Main continued the contract-required review of
the auxiliary pages that remain reachable through System. The first reproduced failure is shared by
all of them: changing routes preserves the previous `.content` scroll offset. A Decision Center
reading position therefore opens Model partway through its catalog, and Model can open Worker after
its first profile. The destination truth is present, but the page begins without its title story or
first choice, which breaks the required “what this is, current truth, next action” reading order.

The accepted correction separates two kinds of continuity:

- a deliberate change to any non-Work route starts that destination at its top-left reading origin;
- a same-route poll or retained-evidence render keeps the current scroll position;
- leaving Work captures its existing Goal/tree/file/detail reading context before the route is
  replaced, and returning to Work restores that exact surviving context instead of capturing the
  unrelated System page scroll;
- no route, form, action, Store truth or refresh policy changes, and no forced smooth scrolling or
  decorative transition is introduced.

This is a Main-direct browser-presentation correction. Writable paths are `src/hub/public/app.js`
and the two focused UI tests only. Acceptance first reproduces a non-zero System-page scroll, proves
Model and Worker each start at zero after route selection, then proves Work → System → Work restores
the prior Work scroll/selection context. Build, focused and six-file Hub tests, script parsing and
diff checks must pass. The change adds no visual primitive or copy, so the already-consumed
Impeccable detector is not rerun.

## Model catalog human-first hierarchy

With route entry corrected, the Model page now starts at its intended story and exposes the next
complete-Hub gap. Eight saved models render as large primary cards whose titles append ForkLight
configuration IDs; every card then shows raw Provider model IDs, Endpoint URLs and a destructive
Remove button. The page is an auxiliary configuration surface, but this still contradicts the M5
contract: a person needs the recognizable model name and provider first, while identifiers,
connection coordinates and destructive management belong in requested technical detail.

The accepted presentation keeps the complete catalog and every current action:

- the catalog states its real saved-model count and keeps the Codex import action adjacent;
- each primary row shows the human label and recognizable provider only;
- one native per-model disclosure contains the existing configuration ID, Provider model ID,
  optional Endpoint, supported effort values and Remove action;
- disclosures start closed, use keyboard-native semantics and remain contained on desktop and
  narrow screens; no model is selected, edited, removed or inferred by the renderer;
- the existing add/update form, Keychain behavior, routing-advice section, confirmation and API
  calls remain unchanged.

Main writes only `app.js`, `app.css`, `i18n.js` and the two focused UI tests. Acceptance against the
current catalog proves eight recognizable rows, zero initially visible raw IDs/URLs or Remove
buttons, eight technical disclosures, and the unchanged exact Remove confirmation/action after one
disclosure opens. Build, focused and six-file Hub tests, parse/diff checks, bilingual copy and
narrow no-overflow checks must pass. This reuses native disclosure and accepted tokens; the one M5
Impeccable detector remains consumed and is not rerun.

## System limits human-first settings

The complete-Hub audit then reaches the `Limits` utility and finds a legacy configuration panel,
not the accepted product language. Its route title says `System`, the form mixes English field
names into the Chinese interface, and the no-effective-progress safety control exposes raw
milliseconds. A local developer therefore has to understand internal setting names before knowing
what will happen. The current values and API are valid; this is a presentation and input-adapter
gap, not permission to change execution policy or silently loosen a saved safety value.

The accepted correction makes the page one plain-language global safety form:

- the route is named `Limits` / `限额` and explains that these are the last shared safety lines for
  every Worker, while ordinary per-Worker choices remain on the Worker page;
- the optional default task budget, absolute budget ceiling and parallel Worker ceiling each say
  the consequence first, with USD shown as a unit rather than embedded in an internal field name;
- no-effective-progress is edited as a value plus hours/minutes/seconds unit and round-trips to the
  existing millisecond API exactly; its help explicitly says it is not a total runtime deadline and
  that continuing effective progress may run longer;
- a blank default budget remains `null`; existing hard-ceiling, concurrency and progress-stop
  values render without substitution, and saving sends the same four canonical settings;
- the existing Back-to-Workers and save actions remain, with no automatic save, Store mutation,
  Runtime change, timeout-policy change or additional integrity mechanism.

Main writes only `app.js`, `app.css`, `i18n.js` and the two focused UI tests. Acceptance proves
bilingual plain-language labels, exact duration conversion, preserved null/default semantics,
44px narrow controls, no horizontal overflow and unchanged POST keys. Build, focused and six-file
Hub tests, standalone parsing, diff checks and live desktop/narrow rendering must pass. This reuses
the existing duration adapter and accepted form tokens, so it does not rerun the already-consumed
Impeccable detector or introduce a UI Worker/Judge.

## Delivery overview before configuration

The next auxiliary-page audit reproduces the same hierarchy failure on `Delivery`. Opening the page
to understand the current delivery path immediately shows an internal setup ID, three command
blocks, Edit and Remove, a full empty five-field creation form, default/binding editors and an
inactive save panel in one 1,649px stack. All behavior is valid, but the page treats reading the
current answer and changing technical configuration as the same task.

The accepted correction establishes an overview-first interaction:

- saved delivery setups lead with the human display name, a short build/update/check stage summary
  and a compact Default marker when applicable;
- internal setup ID, exact commands, explanations, Edit and Remove move into one native requested
  detail per setup; every draft/remove/save behavior remains unchanged;
- the catalog header states the true setup count and offers one explicit Create action; no empty
  editor is mounted until Create or Edit is chosen;
- the editor has an explicit Cancel action in both create and edit modes, and its unsaved fields
  survive a same-tab render such as language change or data refresh without becoming saved truth;
- selectors lead with display labels and add an ID only when duplicate labels would otherwise be
  ambiguous; project paths remain visible because they are the user's binding input;
- the global Save/Restore panel appears only after the draft actually differs from saved settings.
  Opening, closing or typing in the profile editor alone does not call the API or mark durable save
  success.

Main writes only `app.js`, `app.css`, `i18n.js` and the two focused UI tests. No delivery schema,
settings API, Task delivery plan, command execution, confirmation or safe-apply path changes.
Acceptance against the current one-profile Store proves the first view has one human row, zero raw
setup IDs, zero destructive actions, zero textareas and no inactive save panel; requested detail
reveals the unchanged technical facts/actions; Create and Edit restore their draft across a real
render and Cancel returns focus to the originating action. Desktop and actual narrow layout must
fit without horizontal overflow and retain 44px disclosure/actions. Build, focused and six-file Hub
tests, parsing, diff and bilingual copy checks must pass. Existing primitives are reused, so no new
Impeccable detector, UI Worker or Judge is introduced.

## 2026-08-22 user-discovered local-access bootstrap correction

### Evidence and corrected boundary

一骏 opened the current Hub at its printed bare loopback address and received “未认证会话。请运行：
forklight hub”. The Hub and Daemon were healthy and the same page worked only when its tab had first
received the process token through the URL fragment. This is a real local-App acceptance failure:
the user should not have to understand, preserve or recover a transport credential in order to
open, refresh, bookmark or create another tab for `127.0.0.1`.

The retained requirement is a local request gate. Without one, another browser origin can attempt
requests against a loopback service that can start paid Workers, change settings, make Main
decisions and authorize delivery. The replaced behavior is the user-visible URL-fragment and
tab-session ceremony. GoalBoard is the accepted family reference: the page receives its local
control credential invisibly and attaches it to requests while the user opens an ordinary bare
loopback URL. GoalBoard's repository and data model remain out of scope.

### Accepted behavior and call chain

1. Each running Hub still owns one high-entropy process token. The descriptor keeps it for the
   authenticated CLI liveness proof; API requests still require the constant-time-checked private
   header before any daemon or Store operation.
2. The Hub validates that the HTTP `Host` is loopback before serving any page or API response.
   This closes the DNS-rebinding route that would otherwise let a hostile origin ask the Hub to
   render its credential under a non-loopback host.
3. `GET /` and `GET /index.html` inject the current token into the in-memory HTML response as a
   non-visible meta value. The token is never written into the checked-in static asset, URL,
   browser history, CLI output, JSON, logs or evidence.
4. Browser bootstrap reads the injected meta value into memory and uses the existing
   `X-ForkLight-Hub-Token` request header. It no longer reads a URL fragment or depends on
   `sessionStorage`. Direct navigation, refresh, bookmark and a second tab therefore work from the
   ordinary `http://127.0.0.1:<port>/` address.
5. CLI discovery and browser-open helpers return only the bare loopback URL after proving the
   descriptor and live owner. The private descriptor token remains an internal liveness input, not
   a browser-navigation value.
6. If a long-lived page receives `401` after a Hub replacement, it performs at most one full reload
   to receive the new injected credential. A repeated bootstrap failure stops with a plain local-
   connection recovery message; it never loops and never asks the user to understand an
   “unauthenticated session”.

### Scope

Allowed product and focused evidence paths:

- `src/cli.ts`, `src/hub/instance.ts`, `src/hub/server.ts`
- `src/hub/public/index.html`, `src/hub/public/app.js`, `src/hub/public/i18n.js`
- focused Hub instance, operations, settings, CLI and UI-asset tests
- `docs/operations.md`, `docs/configuration.md`
- this existing M5-B Spec and the existing Goal SSOT, updated serially by Main

`dist/**` may be regenerated only by the build acceptance command and must be declared as generated
output in ForkLight. It is not a Candidate deliverable and must not be integrated or counted as a
source change.

No API mutation semantics, confirmation gate, Daemon protocol, Store schema, credential storage,
GoalBoard code, remote access, cookie/login system, Provider call, commit or push is admitted. The
large uncommitted M5 source result is the immutable input baseline; this correction must preserve
unrelated edits and may not rewrite or normalize them.

### Acceptance and verification

- A fresh bare-URL tab and a same-tab refresh reach the real Work page without a URL fragment,
  session storage, login prompt or manual command recovery.
- The checked-in `index.html`, CLI output, browser-visible URL, JSON and logs contain no Hub token.
- Missing/wrong API tokens and non-loopback Host values fail before daemon calls; correct injected
  credentials retain the existing read and confirmed-mutation paths.
- One stale-page `401` reloads once and either reconnects or shows one bounded local-connection
  recovery state without a reload loop.
- Current Chinese and English UI contain no user-facing “未认证会话” / “Unauthenticated session”
  requirement.
- `npm run build`; focused Hub instance/CLI/operations/settings/UI tests; `npm run check`;
  `git diff --check`; an actual
  restarted Hub; and fresh direct-address browser checks pass. Per 一骏's 2026-08-22 correction,
  Main implements and verifies this slice directly; no further ForkLight Worker, Judge or
  ForkLight Integration is part of this correction. The Impeccable detector runs once on the final
  changed Hub assets; M5-C's unfamiliar-human observation remains deferred and is not claimed by
  this fix.
