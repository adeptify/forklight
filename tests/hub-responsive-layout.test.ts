/**
 * FL-112B responsive topology for the focused hierarchical workbench.
 *
 * Desktop keeps one canonical seven-column Task board beside a concise
 * portfolio rail; narrow screens stack the rail and focused workspace and show
 * readable status groups without leaking page-level horizontal scroll. These
 * are deterministic source/CSS assertions that Main's two-viewport browser
 * audit then confirms.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hubPublic = path.join(root, "src", "hub", "public");

function extractFunctionSource(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} must exist`);
  let cursor = src.indexOf("{", start);
  assert.ok(cursor > start, `function ${name} opening brace`);
  let depth = 0;
  for (; cursor < src.length; cursor += 1) {
    if (src[cursor] === "{") depth += 1;
    if (src[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, cursor + 1);
    }
  }
  throw new Error(`function ${name} is not balanced`);
}

test("Work board keeps seven columns with contained horizontal scroll on wide screens", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const gridBlock = css.slice(css.indexOf(".work-col-grid"), css.indexOf(".work-col-head .work-cell"));
  assert.match(gridBlock, /grid-template-columns:\s*repeat\(7,\s*minmax\(150px,\s*1fr\)\)/,
    "seven-column grid with a readable minimum width");
  assert.match(gridBlock, /min-width:\s*1050px/, "grid never squeezes below the seven-column minimum");
  assert.ok(css.includes(".work-board {\n  display: flex;"), "board stacks lanes vertically");
  const boardBlock = css.slice(css.indexOf(".work-board"), css.indexOf(".work-col-grid"));
  assert.match(boardBlock, /overflow-x:\s*auto/, "board scrolls horizontally inside its container");
  assert.ok(css.includes(".work-lane"), "lane styles ship");
});

test("FL-112E5 Work hierarchy, expert details, and continuity stay explicit", async () => {
  const [js, css, i18n] = await Promise.all([
    readFile(path.join(hubPublic, "app.js"), "utf8"),
    readFile(path.join(hubPublic, "app.css"), "utf8"),
    readFile(path.join(hubPublic, "i18n.js"), "utf8"),
  ]);

  const workbench = extractFunctionSource(js, "renderWorkWorkbench");
  assert.ok(workbench.indexOf("renderWorkPortfolio") < workbench.indexOf("renderWorkContextHeader"),
    "workspace navigation precedes the selected context");
  assert.ok(workbench.indexOf("renderWorkContextHeader") < workbench.indexOf("renderWorkFocusedWorkspace"),
    "the hierarchy explanation precedes the selected workspace");
  assert.ok(workbench.indexOf("renderWorkFocusedWorkspace") < workbench.indexOf("renderWorkAdvanced"),
    "expert details follow the ordinary execution surface");

  const goal = extractFunctionSource(js, "renderWorkFocusedGoal");
  assert.ok(goal.includes("renderWorkGoalSummary"), "Goal summary is explicit");
  assert.ok(goal.includes("renderWorkCurrentPhase"), "Goal still names its ordered current phase");
  assert.ok(goal.includes("renderWorkTaskBoard"), "the selected phase owns the Task board");
  const oneOff = extractFunctionSource(js, "renderWorkFocusedOneOff");
  assert.ok(oneOff.includes("work-oneoff-status-groups"), "one-off work keeps a separate bounded lane");

  const card = extractFunctionSource(js, "renderWorkCard");
  assert.ok(card.includes('data-column", card.column'), "cards retain canonical status identity");
  assert.ok(card.includes("work-card-status"), "status is written on each card, not color-only");
  assert.ok(card.includes("aria-grabbed"), "drag state is exposed to assistive technology");
  assert.ok(card.includes("renderWorkMoveActControl") && card.includes("showTask"),
    "existing Task action and drawer paths remain reachable");
  const columns = extractFunctionSource(js, "renderWorkColumns");
  const columnCell = extractFunctionSource(js, "workRenderColumnCell");
  assert.ok(columns.includes("workRenderColumnCell")
    && columnCell.includes("workColumnTone")
    && columnCell.includes("data-card-count")
    && columnCell.includes("work-cell-title")
    && columnCell.includes("work-cell-empty"),
    "columns expose deliberate status and sparse-state hooks");

  const expert = extractFunctionSource(js, "renderWorkAdvanced");
  assert.ok(expert.includes("workExpertDetailsHint"), "expert details state their concrete purpose");
  assert.ok(expert.includes("renderWorkExpertTaskRecord") && expert.includes("workAdvancedOpenSubmit"),
    "technical evidence and the existing legacy entry remain available");
  assert.doesNotMatch(expert, /postJSON\s*\(|refresh\s*\(/,
    "opening expert details has no execution mutation path");
  const expertRecord = extractFunctionSource(js, "renderWorkExpertTaskRecord");
  assert.ok(expertRecord.includes('taskDetailActiveTab = "more"') && expertRecord.includes("switchTab(\"worker\")"),
    "expert links use existing Task evidence and Worker settings surfaces");

  const capture = extractFunctionSource(js, "workCaptureWorkbenchContext");
  const restore = extractFunctionSource(js, "workRestoreWorkbenchContext");
  for (const key of ["goalSummaryOpen", "expertDetailsOpen", "detailOpen", "detailTaskId", "detailTab", "detailScrollTop"]) {
    assert.ok(capture.includes(key) && restore.includes(key), `${key} survives a Work rebuild`);
  }
  assert.ok(restore.includes("taskDetailActiveTab") && restore.includes("content.scrollTop"),
    "the open drawer tab and reading position are restored");

  const e5Css = css.slice(css.indexOf("/* --- FL-112E5:"));
  assert.ok(e5Css.length > 0, "FL-112E5 visual boundary exists");
  for (const hook of [
    ".work-context-header",
    ".work-goal-summary",
    ".work-card.is-selected",
    ".work-card.is-attention",
    ".work-card[aria-grabbed=\"true\"]",
    ".work-expert-details",
    "contain: inline-size",
    "overflow-x: hidden",
  ]) {
    assert.ok(e5Css.includes(hook), `${hook} is part of the intentional workbench system`);
  }
  assert.match(e5Css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.work-focused-column\s*\{[\s\S]*?order:\s*1/,
    "narrow screens keep the selected workspace first");
  assert.match(e5Css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.work-board\s*\{[\s\S]*?overflow-x:\s*visible/,
    "narrow boards stay contained in the document");

  for (const key of [
    "workContextGoalHint",
    "workGoalSummaryHint",
    "workExpertDetailsShort",
    "workExpertDetailsHint",
    "workExpertRawEvidenceHint",
    "workExpertOpenTask",
    "workColumnEmpty",
  ]) {
    assert.equal((i18n.match(new RegExp(`${key}:`, "g")) ?? []).length, 2,
      `${key} has equivalent English and Chinese copy`);
  }
  assert.ok(i18n.includes("inspect IDs/raw evidence") && i18n.includes("查看 ID / 原始证据"),
    "expert details explain IDs, evidence, and tuning in both languages");
});

test("FL-112E5 restores captured closed disclosures without lazy materialization", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const restore = extractFunctionSource(src, "workRestoreWorkbenchContext");
  type FakeDisclosure = {
    open: boolean;
    materialized: boolean;
    body: { childNodes: unknown[] };
    querySelector: (selector: string) => { childNodes: unknown[] } | null;
    dispatchEvent: () => void;
  };
  const disclosure = (open: boolean): FakeDisclosure => {
    const node = {
      open,
      materialized: false,
      body: { childNodes: [] as unknown[] },
      querySelector(selector: string) {
        return selector === ".work-oneoff-status-body" ? node.body : null;
      },
      dispatchEvent() {
        node.materialized = true;
        node.body.childNodes.push({});
      },
    };
    return node;
  };
  const nodes = {
    finished: disclosure(true),
    expert: disclosure(true),
    goal: disclosure(true),
    filters: disclosure(true),
    current: disclosure(true),
    attention: disclosure(false),
    history: disclosure(true),
    story: disclosure(true),
    outcomeAdvanced: disclosure(true),
    shapeGuide: disclosure(true),
    board: { scrollLeft: 0 },
  };
  const viewEl = {
    querySelector(selector: string) {
      if (selector.includes("work-finished-group")) return nodes.finished;
      if (selector.includes("work-oneoff-current")) return nodes.current;
      if (selector.includes("work-oneoff-attention")) return nodes.attention;
      if (selector.includes("work-oneoff-history")) return nodes.history;
      if (selector.includes("data-work-role=\"expert-details\"")) return nodes.expert;
      if (selector.includes("work-goal-summary")) return nodes.goal;
      if (selector.includes("work-filters")) return nodes.filters;
      if (selector.includes("page-story-disclosure")) return nodes.story;
      if (selector.includes("outcome-advanced")) return nodes.outcomeAdvanced;
      if (selector.includes("work-shape-guide")) return nodes.shapeGuide;
      if (selector.includes("work-board")) return nodes.board;
      return null;
    },
  };
  const content = { scrollTop: 0, scrollLeft: 0 };
  const documentObj = {
    createEvent() {
      return { initEvent() {} };
    },
    querySelector() {
      return content;
    },
  };
  const factory = new Function(
    "viewEl",
    "document",
    "content",
    `${restore}
     var S = { detail: false };
     function workMaterializeOpenFinishedBody(node){ node.materialized = true; }
     function workContentScrollEl(){ return content; }
     function workFindFocusTarget(){ return null; }
     return function(ctx){ workRestoreWorkbenchContext(ctx); };`,
  );
  const restoreContext = factory(viewEl, documentObj, content) as (ctx: Record<string, unknown>) => void;

  restoreContext({
    finishedOpen: false,
    advancedOpen: true,
    expertDetailsOpen: false,
    goalSummaryOpen: false,
    filtersOpen: false,
    oneOffCurrentOpen: false,
    oneOffAttentionOpen: true,
    oneOffHistoryOpen: false,
    pageStoryOpen: false,
    outcomeAdvancedOpen: false,
    shapeGuideOpen: false,
    contentScrollTop: 120,
    contentScrollLeft: 8,
    boardScrollLeft: 64,
    detailOpen: false,
    detailTaskId: "same-tab-task",
    detailTab: "more",
    detailScrollTop: 32,
    focusKey: null,
  });

  assert.equal(nodes.finished.open, false, "closed Finished stays closed");
  assert.equal(nodes.finished.materialized, false, "closed Finished stays lazy");
  assert.equal(nodes.expert.open, false, "captured expert disclosure closes");
  assert.equal(nodes.goal.open, false, "captured Goal summary disclosure closes");
  assert.equal(nodes.filters.open, false, "captured filters disclosure closes");
  assert.equal(nodes.current.open, false, "captured one-off current disclosure closes");
  assert.equal(nodes.current.materialized, false, "closed one-off current body stays lazy");
  assert.equal(nodes.attention.open, true, "captured attention disclosure reopens");
  assert.equal(nodes.attention.materialized, true, "only the reopened one-off body materializes");
  assert.equal(nodes.history.open, false, "captured one-off history disclosure closes");
  assert.equal(nodes.story.open, false, "captured story disclosure closes");
  assert.equal(nodes.outcomeAdvanced.open, false, "captured outcome disclosure closes");
  assert.equal(nodes.shapeGuide.open, false, "captured shape guide disclosure closes");
  assert.equal(content.scrollTop, 120, "reading position remains in the same Work tab");
  assert.equal(nodes.board.scrollLeft, 64, "board reading position is restored");
});

test("Narrow screens keep the portfolio rail and one focused Goal workspace readable", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  // The workbench narrow block is the 900px media query whose first rule is
  // .work-col-grid (the other 900px blocks restyle grids or the shell).
  const workMedia = css.match(/@media\s*\(max-width:\s*900px\)\s*\{\s*\.work-col-grid/);
  assert.ok(workMedia, "workbench narrow media query exists");
  const narrowStart = workMedia!.index ?? 0;
  const nextMedia = css.indexOf("@media", narrowStart + 10);
  const narrowBlock = css.slice(narrowStart, nextMedia > 0 ? nextMedia : css.length);
  assert.match(narrowBlock, /\.work-col-grid\s*\{[\s\S]*?flex-direction:\s*column/, "columns stack vertically");
  assert.match(narrowBlock, /\.work-col-head\s*\{\s*display:\s*none/, "desktop column header row hides");
  assert.match(narrowBlock, /\.work-cell-head\s*\{\s*display:\s*block/, "each status group shows its own title");
  assert.match(narrowBlock, /\.work-board\s*\{\s*overflow-x:\s*visible/, "no board-level scroll leak on narrow");
  // The DOM has one navigation rail followed by one focused canonical
  // workspace. Other Goals are summaries, never nested boards.
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const rw = extractFunctionSource(js, "rWork");
  assert.ok(rw.includes("renderWorkShapeGuide()"), "shape explanation leads the Work surface");
  assert.ok(rw.includes("workResolveSelection"), "selection resolves against canonical Work data");
  assert.ok(rw.includes("renderWorkWorkbench(view, S.workSelection)"),
    "rWork mounts one selected workbench");
  assert.ok(!rw.includes('renderPageStory("work")'), "generic page tutorial is not on the primary Work surface");
  assert.ok(!rw.includes("renderWorkGoalLane(") && !rw.includes("renderWorkPlanLane(")
    && !rw.includes("renderWorkOneOffLane("), "rWork does not mount the old global lane canvas");
  const workbench = extractFunctionSource(js, "renderWorkWorkbench");
  assert.ok(workbench.indexOf("renderWorkPortfolio") < workbench.indexOf("renderWorkFocusedWorkspace"),
    "portfolio navigation precedes the focused canvas");
  const goal = extractFunctionSource(js, "renderWorkFocusedGoal");
  assert.ok(goal.includes("renderWorkCurrentPhase"), "Goal names its current phase");
  assert.ok(goal.includes("renderWorkTaskBoard"), "Goal owns one Task board");
  assert.ok(!goal.includes("renderWorkPlanLane"), "Goal does not nest the redundant Plan lane");
  const plan = extractFunctionSource(js, "renderWorkFocusedPlan");
  assert.ok(plan.includes("workIndependentPlanHint"), "independent Plan keeps truthful ancestry");
});

test("Task Detail drawer is a right-side panel on wide and a full-width sheet on narrow", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const detail = css.slice(css.indexOf("#fl-detail {"), css.indexOf("#fl-detail[hidden]"));
  assert.match(detail, /width:\s*min\(820px,\s*94vw\)/, "wide drawer is width-bounded");
  assert.match(detail, /right:\s*0/, "drawer anchors right");
  assert.match(detail, /overflow-y:\s*auto/, "drawer scrolls its own content");
  assert.ok(css.includes(".detail-close"), "drawer keeps its close control");
  const drawerNarrow = css.match(/@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?#fl-detail\s*\{[\s\S]*?width:\s*100vw/);
  assert.ok(drawerNarrow, "narrow breakpoint turns the drawer into a full-width sheet");
  const drawerMobile = css.match(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?#fl-detail\s*\{[\s\S]*?width:\s*100vw/);
  assert.ok(drawerMobile, "mobile breakpoint keeps the full-width sheet");
});

test("FL-105B Task Detail controls grow to phone targets without changing compact Hub controls", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const polishStart = css.indexOf("/* FL-105B: Task Detail");
  assert.ok(polishStart >= 0, "FL-105B detail polish block exists");
  const polishEnd = css.indexOf("\n}\n\n.state-msg", polishStart);
  const polish = css.slice(polishStart, polishEnd > polishStart ? polishEnd + 2 : css.length);

  assert.match(polish, /@media\s*\(max-width:\s*768px\)/, "targets are mobile-only");
  assert.match(polish, /#fl-detail button,[\s\S]*?#fl-detail textarea\s*\{[\s\S]*?min-height:\s*44px/,
    "detail buttons and form controls get a 44px mobile target");
  assert.match(polish, /#fl-detail details\s*>\s*summary[\s\S]*?min-height:\s*44px/,
    "detail disclosures get a 44px mobile target");
  assert.match(polish, /#fl-detail a\s*\{[\s\S]*?min-height:\s*44px/,
    "detail evidence links get a 44px mobile target");
  assert.match(polish, /#fl-detail input\[type="checkbox"\][\s\S]*?min-width:\s*44px/,
    "standalone detail checkboxes get a 44px mobile target");
  assert.match(polish, /#fl-detail \.adaptation-panel \.adapt-enable,[\s\S]*?#fl-detail \.cal-checklist-item\s*\{[\s\S]*?min-height:\s*44px/,
    "label-owned detail checkbox rows keep the full hit area");
  assert.match(polish, /#fl-detail \.task-tab\s*\{[\s\S]*?min-width:\s*0[\s\S]*?overflow-wrap:\s*anywhere/,
    "tabs can wrap inside the sheet instead of leaking horizontally");
  assert.match(polish, /#fl-detail input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),[\s\S]*?#fl-detail textarea\s*\{[\s\S]*?max-width:\s*100%/,
    "detail form controls stay contained");

  const compactStart = css.indexOf(".btn.sm {");
  const compactEnd = css.indexOf("}", compactStart);
  const compact = css.slice(compactStart, compactEnd > compactStart ? compactEnd + 1 : css.length);
  assert.match(compact, /min-height:\s*28px/, "global compact buttons stay 28px");
  assert.doesNotMatch(compact, /44px/, "global compact buttons are not inflated");
  assert.match(css, /\.task-tab-bar\s*\{[\s\S]*?position:\s*sticky[\s\S]*?top:\s*56px/,
    "existing sticky tab behavior remains");
});

test("Long content wraps and controls meet practical touch targets", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.match(css, /\.work-card-name\s*\{[\s\S]*?overflow-wrap:\s*anywhere/, "long Task names wrap in cards");
  assert.match(css, /\.work-card-meta\s*\{[\s\S]*?overflow-wrap:\s*anywhere/, "long blocker/worker copy wraps");
  assert.match(css, /\.work-lane-toggle\s*\{[\s\S]*?width:\s*100%/, "lane toggles span the lane");
  assert.ok(css.includes("min-height: 32px"), "controls keep a practical touch target");
  // Keyboard operation: lane toggles and cards are real buttons/roles.
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const option = extractFunctionSource(js, "renderWorkWorkspaceOption");
  assert.ok(option.includes('h("button"'), "workspace selection is a native button");
  assert.ok(option.includes("aria-pressed"), "workspace selection exposes its state");
  const oneOff = extractFunctionSource(js, "renderWorkOneOffGroup");
  assert.ok(oneOff.includes('createElement("details")'), "one-off groups are native disclosures");
  assert.ok(oneOff.includes("aria-expanded") || oneOff.includes("summary"),
    "one-off disclosure remains keyboard-operable");
  const card = extractFunctionSource(js, "renderWorkCard");
  assert.ok(card.includes('el.setAttribute("tabindex", "0")'), "cards are keyboard focusable");
  assert.ok(card.includes('e.key === "Enter"'), "cards open on Enter");
});

test("Long-lived Work summaries stay bounded without losing hierarchy", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(js.includes("function workResolveSelection("), "selection resolver ships");
  assert.ok(js.includes("function workPresentProjectOptions("), "project presentation helper ships");
  const portfolio = extractFunctionSource(js, "renderWorkPortfolio");
  const finished = extractFunctionSource(js, "renderWorkFinishedGoals");
  const oneOff = extractFunctionSource(js, "renderWorkOneOffGroup");
  assert.ok(portfolio.includes("activeGoals"), "active Goals remain in the portfolio rail");
  assert.ok(portfolio.includes("independentPlans"), "independent Plans remain in the portfolio rail");
  assert.ok(finished.includes("ensureFinishedBody"), "finished Goal history is lazy");
  assert.ok(oneOff.includes("definition.limit"), "one-off groups have bounded first-paint limits");
  assert.ok(oneOff.includes('limit !== "all"'), "one-off history can be reached without flooding the DOM");
  // Filters stay human and privacy-safe at every width; seven columns unchanged.
  const filters = extractFunctionSource(js, "renderWorkFilters");
  assert.ok(filters.includes("workProjectHumanLabel"), "project labels stay human on narrow layouts");
  assert.ok(filters.includes("workFilterInternalProjectsOmitted"), "omitted-internal note remains available");
  const orderIdx = js.indexOf("var WORK_COLUMN_CODES = [");
  const orderBlock = js.slice(orderIdx, js.indexOf("];", orderIdx) + 2);
  const matches = orderBlock.match(/"(not-started|ready|running|waiting-verification|waiting-user-decision|completed|stopped-failed)"/g) ?? [];
  assert.equal(matches.length, 7, "seven columns remain the only status columns");
});

test("Empty, filtered-empty, stale, and error states stay honest in the Work surface", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const rw = extractFunctionSource(js, "rWork");
  assert.ok(rw.includes("workFilterNoMatches"), "filtered-empty has its own message");
  assert.ok(rw.includes("workEmpty"), "naturally-empty has its own message");
  assert.ok(rw.includes('data-fl-role", "work-hierarchy-error"'), "unsupported hierarchy shows an error");
  assert.ok(rw.includes("activeFilter"), "empty state distinguishes filtered from natural");
  // The page evidence state machine still owns loading/unavailable/stale.
  assert.ok(/work\s*:\s*\{\s*workHierarchy\s*:\s*true,\s*intakes\s*:\s*true\s*\}/.test(js),
    "work page depends on the hierarchy board plus the bounded outcome-intake list");
  const pes = extractFunctionSource(js, "pageEvidenceState");
  assert.ok(pes.includes('"stale"'), "retained hierarchy can be marked stale");
  assert.ok(pes.includes('"unavailable"'), "first-fetch failure is never an empty board");
});

test("FL-112A Work continuity preserves composition order and does not invent layout", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // Continuity is infrastructure only: the desktop composition contract stays.
  const rw = extractFunctionSource(js, "rWork");
  const outcomeAt = rw.indexOf("renderOutcomeSection()");
  const storyAt = rw.indexOf("renderWorkShapeGuide()");
  const filtersAt = rw.lastIndexOf("renderWorkFilters()");
  const boardAt = rw.lastIndexOf("renderWorkWorkbench(view, S.workSelection)");
  assert.ok(outcomeAt > 0 && storyAt > outcomeAt && boardAt > storyAt && filtersAt > boardAt,
    "continuity renders the focused workbench before optional filters");
  assert.ok(rw.includes("workCaptureWorkbenchContext()"), "capture wraps the Work rebuild");
  assert.ok(rw.includes("workRestoreWorkbenchContext(continuity)"), "restore runs after board mount");
  // No layout/visual redesign: continuity helpers never restyle Work nodes.
  const capture = extractFunctionSource(js, "workCaptureWorkbenchContext");
  const restore = extractFunctionSource(js, "workRestoreWorkbenchContext");
  assert.ok(!capture.includes("className =") && !restore.includes("className ="),
    "continuity does not restyle Work nodes");
  assert.ok(restore.includes("finishedOpen") && restore.includes("boardScrollLeft"),
    "Finished open state and board scroll are restored at every width");
  assert.ok(capture.includes("shapeGuideOpen") && restore.includes("shapeGuideOpen"),
    "shape explanation disclosure survives a Work rebuild");
  const truth = extractFunctionSource(js, "workVisibleTruthSnapshot");
  assert.ok(truth.includes("viewedGoal") && truth.includes("viewedPlan"),
    "selected Goal and viewed phase participate in refresh continuity truth");
  // Page scroll host is main.content (index.html), not window.
  assert.ok(capture.includes("workContentScrollEl") && restore.includes("content.scrollTop"),
    "content container scroll is captured and restored at every width");
  assert.ok(restore.includes("workMaterializeOpenFinishedBody"),
    "Finished lazy body materializes before nested focus on narrow and wide");
  const render = extractFunctionSource(js, "render");
  assert.ok(render.includes("workShouldRetainDom"), "identical polls skip Work DOM replacement");
  // Retain path still updates chrome first so connection truth stays live.
  assert.ok(render.indexOf("updStatus()") < render.indexOf("workShouldRetainDom"),
    "status chrome updates before the retain short-circuit");
});

test("FL-112B desktop composition reaches one focused board; narrow layout stays usable", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const rw = extractFunctionSource(js, "rWork");
  // 1280x720 contract: empty Work leads with the primary action; existing Work
  // leads with one focused board and keeps optional filters after it.
  const outcomeAt = rw.indexOf("renderOutcomeSection()");
  const storyAt = rw.indexOf("renderWorkShapeGuide()");
  const filtersAt = rw.lastIndexOf("renderWorkFilters()");
  const boardAt = rw.lastIndexOf("renderWorkWorkbench(view, S.workSelection)");
  const headAt = js.indexOf('data-fl-role", "work-col-head"');
  assert.ok(outcomeAt > 0 && storyAt > outcomeAt && boardAt > storyAt && filtersAt > boardAt,
    "desktop composition order: empty creation; focused board → optional filters");
  assert.ok(rw.includes('h("div", "work-intro")'), "outcome and rules share the compact intro band");
  assert.ok(headAt > 0, "canonical board heading is part of the board render");
  // Compact empty intake and shape rules shrink the above-board stack without
  // fixed viewport heights, clipping, overlays, or hidden form fields.
  assert.ok(css.includes(".outcome-story-note-empty"), "empty intake has a compact style");
  assert.ok(css.includes(".work-shape-guide"), "shape explanation style ships");
  assert.match(css, /\.work-focus \.work-story-fact\s*\{[\s\S]*?min-height:\s*64px/, "focused work summary stays compact above the board");
  assert.ok(css.includes("min-height: 32px"), "disclosure toggles keep a practical touch target");
  assert.ok(!/outcome-section[\s\S]{0,120}(height:\s*\d+vh|max-height:\s*\d+vh)/.test(css),
    "outcome section is not viewport-height locked");
  assert.ok(!/work-shape-guide[\s\S]{0,200}(position:\s*fixed|position:\s*absolute)/.test(css),
    "shape explanation stays in document flow");
  assert.ok(!/work-finished-group[\s\S]{0,200}(position:\s*fixed|overflow:\s*hidden)/.test(css),
    "finished work stays in flow and is not clipped");
  // Keyboard/touch: portfolio selection and history are native controls.
  const option = extractFunctionSource(js, "renderWorkWorkspaceOption");
  assert.ok(option.includes('h("button"'), "workspace selection is keyboard operable");
  const finished = extractFunctionSource(js, "renderWorkFinishedGoals");
  assert.ok(finished.includes('createElement("details")'), "Finished work uses a native details disclosure");
  assert.ok(finished.includes('createElement("summary")'), "Finished work summary is keyboard operable");
  // Narrow 390px: stacked status groups and no page-level horizontal leak remain.
  const workMedia = css.match(/@media\s*\(max-width:\s*900px\)\s*\{\s*\.work-col-grid/);
  assert.ok(workMedia, "narrow workbench breakpoint remains");
  const narrowStart = workMedia!.index ?? 0;
  const nextMedia = css.indexOf("@media", narrowStart + 10);
  const narrowBlock = css.slice(narrowStart, nextMedia > 0 ? nextMedia : css.length);
  assert.match(narrowBlock, /\.work-board\s*\{\s*overflow-x:\s*visible/,
    "390px-class narrow layout still avoids board horizontal overflow");
  assert.match(narrowBlock, /\.work-col-grid\s*\{[\s\S]*?flex-direction:\s*column/,
    "status groups still stack on narrow screens");
  assert.match(narrowBlock, /\.work-focus\s*\{\s*order:\s*1/,
    "selected workspace leads the narrow workbench");
  assert.match(narrowBlock, /\.work-portfolio\s*\{\s*order:\s*2/,
    "portfolio history follows the selected narrow workspace");
  assert.match(css, /\.work-intro\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.05fr\)\s*minmax\(0,\s*1fr\)/,
    "desktop intro uses a balanced two-column band");
  assert.match(narrowBlock, /\.work-intro\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    "intro stacks without horizontal overflow on narrow screens");
  assert.ok(css.includes(".workbench-layout"), "focused layout ships");
  assert.match(css, /\.work-portfolio\s*\{[\s\S]*?max-height:\s*min\(720px,\s*calc\(100dvh\s*-\s*180px\)\)/,
    "desktop portfolio rail is bounded");
  assert.ok(css.includes("scrollbar-width: thin"), "scroll affordances remain visible");
  assert.ok(css.includes("prefers-reduced-motion"), "reduced motion remains supported");
  // Composer fields stay in the form; advanced remains progressively disclosed.
  const composer = extractFunctionSource(js, "renderOutcomeComposer");
  assert.ok(composer.includes('data-fl-role", "outcome-text"'), "primary outcome field remains");
  assert.ok(composer.includes("textarea.rows = 2"), "primary outcome remains compact before typing");
  assert.ok(composer.includes('data-fl-role", "outcome-advanced"'), "advanced input remains reachable");
  assert.ok(composer.includes('data-fl-role", "outcome-project"'), "project field is not deleted");
  assert.ok(composer.includes('data-fl-role", "outcome-context"'), "context field is not deleted");
  assert.ok(composer.includes('data-fl-role", "outcome-shape"'), "shape field is not deleted");
  const selectWorkspace = extractFunctionSource(js, "workSelectWorkspace");
  assert.ok(selectWorkspace.includes('matchMedia("(max-width: 900px)")'),
    "only a deliberate narrow-screen selection moves the reader to the focused workspace");
  assert.ok(selectWorkspace.includes('scrollIntoView({ block: "start" })'),
    "selected narrow workspace is revealed past long portfolio history");
  assert.match(css, /\.nav\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overflow-x:\s*hidden;/,
    "desktop navigation cannot drift sideways");
});

test("FL-109C2A drag and Move/Act surfaces stay contained and touch-friendly", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.match(css, /\.work-card\.is-actionable\[draggable="true"\]\s*\{[\s\S]*?cursor:\s*grab/,
    "actionable cards show a grab affordance");
  assert.ok(css.includes("work-cell-drop-valid"), "valid drop feedback class ships");
  assert.ok(css.includes("work-cell-drop-invalid"), "invalid drop feedback class ships");
  assert.ok(css.includes("work-cell-drop-auto"), "automatic-only drop feedback class ships");
  // The chooser is a centered, width-bounded dialog that never overflows the viewport.
  assert.match(css, /\.work-action-chooser\s*\{[\s\S]*?width:\s*min\(440px,\s*calc\(100vw - 24px\)\)/,
    "chooser is width-bounded against the viewport");
  assert.match(css, /\.work-action-chooser\s*\{[\s\S]*?max-height:\s*min\(560px,\s*calc\(100vh - 32px\)\)/,
    "chooser is height-bounded");
  assert.match(css, /\.work-action-chooser\s*\{[\s\S]*?overflow-y:\s*auto/,
    "chooser scrolls internally instead of leaking overflow");
  assert.ok(css.includes(".work-action-btn"), "Move/Act control ships");
  assert.match(css, /\.work-action-btn\s*\{[\s\S]*?min-height:\s*26px/,
    "Move/Act control meets a practical touch target");
  // The pending-action banner rows wrap and never cause horizontal overflow.
  assert.match(css, /\.task-action-pending-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(88px,\s*auto\)\s+minmax\(0,\s*1fr\)/,
    "banner rows use a wrapping two-column grid");
  assert.match(css, /\.task-action-pending-row-value\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    "banner values wrap anywhere");
  assert.match(css, /\.task-action-pending-truth\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    "banner truth line wraps anywhere");
});

test("FL-109C2A keyboard and drag surfaces are theme-safe with restrained states", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  // Valid and invalid states derive from theme tokens, not fixed colors.
  assert.match(css, /\.work-cell-drop-valid\s*\{[\s\S]*?color-mix\(in srgb, var\(--green\)/, "valid drop uses a theme token");
  assert.match(css, /\.work-cell-drop-invalid\s*\{[\s\S]*?color-mix\(in srgb, var\(--red\)/, "invalid drop uses a theme token");
  assert.match(css, /\.work-cell-drop-auto\s*\{[\s\S]*?color-mix\(in srgb, var\(--sky\)/, "automatic drop uses a theme token");
  assert.match(css, /\.work-action-chooser\s*\{[\s\S]*?background:\s*var\(--paper\)/, "chooser adapts to the theme");
  assert.match(css, /\.work-action-dest\.is-actionable\s*\{[\s\S]*?background:\s*var\(--hi-soft\)/, "actionable choices are restrained highlights");
});

test("FL-109C2B guided Continue flow is contained and touch-safe at every width", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  // The guide line wraps and never causes page-level horizontal overflow.
  assert.match(css, /\.task-action-pending-guide\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    "guide line wraps anywhere");
  // Actions are a wrapping row on desktop with a practical touch target.
  assert.match(css, /\.task-action-pending-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/,
    "pending actions wrap on narrow widths");
  assert.match(css, /\.task-action-pending-actions\s*\{[\s\S]*?gap:\s*8px/,
    "pending actions keep a readable gap");
  assert.match(css, /\.task-action-pending-continue\s*\{[\s\S]*?min-height:\s*32px/,
    "the Continue control meets a practical touch target");
  // The failure note is readable, wraps, and uses a restrained theme token.
  assert.match(css, /\.task-action-pending-failure\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    "failure note wraps anywhere");
  assert.match(css, /\.task-action-pending-failure\s*\{[\s\S]*?color-mix\(in srgb, var\(--red\)/,
    "failure note uses a theme token, never a fixed color");
  // The locked-intent hint wraps and stays muted.
  assert.match(css, /\.task-action-pending-locked\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    "locked-intent hint wraps anywhere");
  // Narrow screens stack the pending actions full-width so both buttons remain
  // reachable without horizontal scrolling.
  const mediaStart = css.indexOf("@media (max-width: 768px) {");
  assert.ok(mediaStart >= 0, "a narrow breakpoint exists");
  const narrowBlock = css.slice(mediaStart, mediaStart + 300);
  assert.ok(narrowBlock.includes(".task-action-pending-actions"), "narrow breakpoint restyles pending actions");
  assert.match(narrowBlock, /\.task-action-pending-actions\s*\{\s*flex-direction:\s*column/,
    "narrow screens stack pending actions");
  assert.match(narrowBlock, /\.task-action-pending-continue,\s*\.task-action-pending-actions\s*\.btn\s*\{\s*width:\s*100%/,
    "narrow screens make pending buttons full-width");
});

test("FL-108D1 Task Detail four-step story stays readable near 390px", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");

  const overview = extractFunctionSource(js, "renderFourSectionOverview");
  assert.ok(overview.includes("task-overview-story"), "ordered story marker ships");
  assert.ok(overview.includes("four-section-step"), "step markers keep the 1–4 order visible");
  assert.ok(overview.includes("task-ov-main-asked"), "step 1 remains Main input");
  assert.ok(overview.includes("task-ov-final-output"), "step 4 remains final delivery");
  assert.ok(!overview.includes("worker-claim-preview"), "raw Worker report stays off the default Overview");

  const workbench = extractFunctionSource(js, "renderTaskWorkbench");
  assert.ok(workbench.includes("worker-claim-disclosure"), "Result disclosure remains reachable");
  assert.ok(workbench.includes("journeyDisclosure"), "disclosure uses a native details control");
  assert.ok(workbench.includes("taskChecksTabHint"), "Checks badge helper remains wired");

  // Narrow drawer and story: order intact, text wraps, targets stay usable.
  assert.match(css, /@media\s*\(max-width:\s*768px\)[\s\S]*?#fl-detail[\s\S]*?width:\s*100vw/,
    "mobile drawer stays full-width near 390px");
  assert.match(css, /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.four-section-card/,
    "four-step story has a mobile restyle");
  assert.match(css, /\.four-section-card\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    "story text does not clip horizontally");
  assert.match(css, /\.four-section-title\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    "step titles wrap instead of overflowing");
  assert.match(css, /\.task-result-claim-disclosure\s*>\s*summary\s*\{[\s\S]*?min-height:\s*32px/,
    "Worker-report disclosure keeps a practical touch target");
  assert.match(css, /\.four-section-next\s*\{[\s\S]*?min-height:\s*32px/,
    "next-action block stays interactive-height on narrow layouts");
  // Tab row remains the existing wrapping bar; no regress to fixed non-wrapping.
  assert.ok(css.includes(".task-tab-bar"), "tab bar styles remain");
  assert.match(css, /\.task-tab-bar\s*\{[\s\S]*?flex-wrap:\s*wrap/,
    "tab controls remain wrap-friendly on narrow widths");

  // FL-108D2: after unnumbered titles, markers 1-4 remain the only ordinals
  // and stay visible; no CSS rule may hide them (global or breakpoint).
  assert.ok(overview.includes('h("div", "four-section-step", "1")'), "marker 1 in DOM");
  assert.ok(overview.includes('h("div", "four-section-step", "2")'), "marker 2 in DOM");
  assert.ok(overview.includes('h("div", "four-section-step", "3")'), "marker 3 in DOM");
  assert.ok(overview.includes('h("div", "four-section-step", "4")'), "marker 4 in DOM");
  const m1 = overview.indexOf('h("div", "four-section-step", "1")');
  const m2 = overview.indexOf('h("div", "four-section-step", "2")');
  const m3 = overview.indexOf('h("div", "four-section-step", "3")');
  const m4 = overview.indexOf('h("div", "four-section-step", "4")');
  assert.ok(m1 >= 0 && m2 > m1 && m3 > m2 && m4 > m3,
    "step markers remain in DOM order 1 through 4");
  assert.match(css, /\.four-section-step\s*\{[\s\S]*?display:\s*flex/,
    "global step marker uses a visible flex layout");
  assert.doesNotMatch(css, /\.four-section-step[^{]*\{[^}]*display\s*:\s*none/,
    "no CSS rule hides step markers with display:none");
  assert.doesNotMatch(css, /\.four-section-step[^{]*\{[^}]*visibility\s*:\s*hidden/,
    "no CSS rule hides step markers with visibility:hidden");
});

test("FL-109D3B confirmation step and created story stay contained at 390px and keyboard-safe", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");

  // Confirmation and created controls are native buttons with a practical
  // touch target; the confirmation step itself is focusable for keyboard flow.
  const step = extractFunctionSource(js, "renderOutcomeConfirmStep");
  assert.ok(step.includes('h("button"'), "confirm submit/cancel are native buttons");
  assert.ok(step.includes('setAttribute("tabindex", "-1")'), "confirmation step is focusable");
  assert.ok(step.includes('"btn", "outcome-confirm-cancel"') || step.includes('"outcome-confirm-cancel"'),
    "cancel control ships");
  const proposed = extractFunctionSource(js, "renderProposedPreview");
  assert.ok(proposed.includes('h("button", "btn primary outcome-confirm-open"'), "confirm-open is a native button");
  const created = extractFunctionSource(js, "renderCreatedStory");
  assert.ok(created.includes('h("button", "btn outcome-created-open"'), "open-created is a native button");

  // Long copy wraps and never leaks horizontal scroll at 390px.
  assert.match(css, /\.outcome-confirm\s*\{[\s\S]*?min-width:\s*0/, "confirm panel keeps contained width");
  assert.match(css, /\.outcome-confirm-intro\s*\{[\s\S]*?overflow-wrap:\s*anywhere/, "confirm intro wraps anywhere");
  assert.match(css, /\.outcome-confirm-cancel,\s*\.outcome-confirm-submit\s*\{[\s\S]*?min-height:\s*32px/,
    "confirm controls meet a practical touch target");
  assert.match(css, /\.outcome-confirm-open\s*\{[\s\S]*?min-height:\s*32px/, "confirm-open meets a practical touch target");
  assert.match(css, /\.outcome-created-open\s*\{[\s\S]*?min-height:\s*32px/, "created-open meets a practical touch target");

  // The first 768px media block (the outcome path) stacks the new controls
  // full-width so both remain reachable without horizontal scrolling.
  const mediaStart = css.indexOf("@media (max-width: 768px) {");
  const narrowBlock = css.slice(mediaStart, css.indexOf("/* Task breadcrumb", mediaStart));
  assert.match(narrowBlock,
    /\.outcome-confirm-actions\s*\.btn,\s*\.outcome-confirm-open,\s*\.outcome-created-open\s*\{\s*width:\s*100%/,
    "narrow screens stack confirm controls full-width");
});

test("FL-112E9 first-use journey stays contained, accessible, and compact in the rail", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");

  // The journey is a visible ordered list with markers 1-4; no rule hides them.
  const journey = extractFunctionSource(js, "renderOutcomeJourney");
  assert.ok(journey.includes('h("ol", "outcome-journey")'), "journey is an ordered list");
  assert.ok(journey.includes("is-current") && journey.includes("is-done"),
    "current and completed steps are marked without hiding markers");
  assert.doesNotMatch(css, /\.outcome-journey-step[^{]*\{[^}]*display\s*:\s*none/,
    "no CSS rule hides journey step markers with display:none");

  // Long journey text wraps and never leaks horizontal scroll.
  assert.match(css, /\.outcome-journey-step\s*\{[\s\S]*?overflow-wrap:\s*anywhere/, "journey steps wrap anywhere");
  assert.match(css, /\.outcome-handoff-disclosure\s*\{[\s\S]*?min-width:\s*0/, "handoff disclosure stays contained");
  assert.match(css, /\.outcome-history\s*\{[\s\S]*?min-width:\s*0/, "bounded history stays contained");

  // The rail keeps the journey compact so the E8 workbench density is preserved.
  assert.ok(css.includes(".work-new-entry .outcome-intake-detail"), "rail journey is compact");
  assert.ok(css.includes(".work-new-entry .outcome-history"), "rail history is a compact bounded list");

  // Bilingual journey copy is direct and client-neutral.
  for (const key of [
    "outcomeJourneyStep1", "outcomeJourneyStep4", "outcomeJourneyNext",
    "outcomePendingWhoNext", "outcomeProposedWhoNext", "outcomeCreatedWhoNext",
    "outcomeCreatedWhoNextPending", "outcomeCreatedNextBodyPending",
    "outcomeCreatedOpenWorkspace", "outcomeCreatedNotVisible", "outcomeHistoryCount",
  ]) {
    assert.equal((i18n.match(new RegExp(`${key}:`, "g")) ?? []).length, 2,
      `${key} has equivalent English and Chinese copy`);
  }
  assert.ok(i18n.includes("ForkLight creates and opens the workspace")
    && i18n.includes("ForkLight 创建并打开对应工作区"),
    "the fourth step names the created workspace in both languages");
  // Pending-versus-ready created copy stays truthful in both languages.
  assert.ok(i18n.includes("You can open its workspace from here.")
    && i18n.includes("你可以从这里打开对应工作区"),
    "ready created copy says the workspace can be opened");
  assert.ok(i18n.includes("The workspace will open when it appears on the board.")
    && i18n.includes("工作区出现在看板后即可打开"),
    "pending created copy waits for the board");
  assert.ok(!i18n.includes("and opened its workspace")
    && !i18n.includes("并打开了对应的工作区"),
    "created state copy never claims the workspace is already open");

  // One primary created-workspace action; no legacy Task-detail bypass control.
  const created = extractFunctionSource(js, "renderCreatedStory");
  assert.ok(created.includes('data-fl-role", "outcome-created-open-workspace"'),
    "created story exposes one primary open-workspace action");
  assert.ok(!created.includes("outcome-created-open-task"),
    "created story has no legacy open-task control");
  assert.ok(!created.includes("showTask("),
    "created story does not raw-open Task detail");
});

test("FL-112E10 narrow New work bridge stays narrow-only with practical touch and focus", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");

  // Selected workspace stays first on narrow screens; portfolio (composer) follows.
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.work-focused-column\s*\{[\s\S]*?order:\s*1/,
    "narrow screens keep the selected workspace first");
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.work-portfolio\s*\{[\s\S]*?order:\s*2/,
    "narrow screens keep the portfolio rail after the focused workspace");

  // Desktop hides the bridge; narrow reveals it with a practical touch target.
  const desktopRule = css.match(/\.work-context-new-entry\s*\{[^}]*\}/);
  assert.ok(desktopRule && /display:\s*none/.test(desktopRule[0]),
    "desktop keeps the New work bridge hidden so the rail composer stays sole");
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.work-context-new-entry\s*\{[\s\S]*?display:\s*inline-flex/,
    "narrow screens show the New work bridge");
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.work-context-new-entry\s*\{[\s\S]*?min-height:\s*44px/,
    "narrow bridge meets a practical touch target");
  assert.match(css, /\.work-context-new-entry:focus-visible\s*\{[\s\S]*?outline:/,
    "keyboard focus visibility ships for the bridge");
  assert.ok(css.includes("overflow-wrap: anywhere") || css.includes("min-width: 0"),
    "work context and composer stay contained without horizontal overflow hooks");

  const header = extractFunctionSource(js, "renderWorkContextHeader");
  assert.ok(header.includes('data-fl-role", "work-context-new-entry"'),
    "context header hosts the narrow bridge role");
  assert.ok(header.includes("workRevealNewEntry"),
    "header wires deliberate activation to the reveal helper");
  const reveal = extractFunctionSource(js, "workRevealNewEntry");
  assert.ok(reveal.includes("outcome-section") && reveal.includes("outcome-text"),
    "reveal uses existing semantic roles only");
  assert.equal((i18n.match(/workNewEntryLabel:/g) ?? []).length, 2,
    "New work label remains bilingual");

  // Natural Main handoff and created-existence truth remain in both locales.
  assert.ok(i18n.includes("already coordinating this project")
    && i18n.includes("已经在协调本项目的 Main"),
    "pending handoff is natural and client-neutral in both languages");
  assert.ok(i18n.includes("only after it really exists on the board")
    && i18n.includes("真正出现在看板上"),
    "created-not-visible copy states real board existence in both languages");
  assert.ok(!i18n.includes("nothing is invented while it is missing")
    && !i18n.includes("不会编造任何对象"),
    "invented-object defense language is gone from product copy");
});

test("FL-109D2 outcome composer is outcome-first, contained, and wraps on narrow screens", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");

  // The composer is placed at the beginning of the Work page, before the board
  // filters, so describing the desired result is the primary action.
  const rw = extractFunctionSource(js, "rWork");
  const outcomeAppend = rw.indexOf("renderOutcomeSection()");
  const filterAppend = rw.indexOf("renderWorkFilters()");
  assert.ok(outcomeAppend > 0 && filterAppend > outcomeAppend,
    "outcome composer renders before the board filters");
  assert.ok(js.includes("function renderOutcomeComposer("), "composer renderer ships");
  assert.ok(js.includes("function renderIntakeStory("), "intake story renderer ships");
  assert.ok(js.includes("outcome-intake-detail"), "selected intake detail role ships");
  assert.ok(js.includes("outcome-handoff-copy"), "handoff copy action ships");

  // Outcome section styles ship with theme tokens and wrapping long text.
  assert.ok(css.includes(".outcome-section"), "outcome section styles ship");
  assert.ok(css.includes(".outcome-composer"), "composer card styles ship");
  assert.match(css, /\.outcome-outcome-text\s*\{[\s\S]*?overflow-wrap:\s*anywhere/, "outcome text wraps anywhere");
  assert.match(css, /\.outcome-fact-value\s*\{[\s\S]*?overflow-wrap:\s*anywhere/, "fact values wrap anywhere");
  assert.match(css, /\.outcome-tech-row-value\s*\{[\s\S]*?overflow-wrap:\s*anywhere/, "tech details wrap anywhere");
  assert.match(css, /\.outcome-truth-line\s*\{[\s\S]*?color:\s*var\(--ink\)/, "truth line uses a theme token");
  assert.ok(css.includes(".sr-only"), "polite live region is visually hidden but present");

  // Narrow screens stack the outcome path full-width and never leak scroll.
  const mediaStart = css.indexOf("@media (max-width: 768px) {");
  const outcomeNarrow = css.indexOf(".outcome-section", mediaStart);
  assert.ok(outcomeNarrow > mediaStart, "narrow breakpoint restyles the outcome section");
  const narrowBlock = css.slice(mediaStart, css.indexOf("/* Task breadcrumb", mediaStart));
  assert.match(narrowBlock, /\.outcome-actions\s*\.btn\s*\{\s*width:\s*100%/, "narrow screens make the submit button full-width");
});

test("FL-112E3 Goal phases stay ordered, read-only, and scoped to one board", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");

  const currentPlan = extractFunctionSource(js, "workGoalCurrentPlan");
  assert.ok(currentPlan.includes("goal.currentPlanId"), "default phase reads Core currentPlanId");
  assert.ok(currentPlan.includes("plans[plans.length - 1]"), "terminal Goals have a safe last-phase history fallback");

  const phaseNav = extractFunctionSource(js, "renderWorkCurrentPhase");
  assert.ok(phaseNav.includes("plans.forEach"), "every ordered phase is rendered");
  assert.ok(phaseNav.includes("renderWorkPhaseOption"), "phase navigation exposes each Plan as a phase");
  assert.ok(phaseNav.includes("workPhaseFutureReadOnly"), "future phases explain their read-only boundary");
  assert.ok(phaseNav.includes("workPhaseTaskCount"), "phase progress is visible");
  assert.ok(phaseNav.includes('h("h3", "work-section-heading"'), "phase navigator has a semantic heading");
  assert.ok(phaseNav.includes('aria-labelledby'), "phase navigator has an accessible landmark name");

  const phaseChoice = extractFunctionSource(js, "workSelectGoalPhase");
  assert.ok(phaseChoice.includes("S.workViewedPlanId"), "phase choice is stored as presentation state");
  assert.doesNotMatch(phaseChoice, /refresh\s*\(|postJSON\s*\(|advance\s*\(/, "phase choice does not call scheduling or mutation paths");

  const goal = extractFunctionSource(js, "renderWorkFocusedGoal");
  assert.ok(goal.includes("workGoalViewedPlan"), "Goal board uses the viewed phase");
  assert.ok(goal.includes("renderWorkTaskBoard"), "Goal renders one Task board");
  assert.ok(!goal.includes("renderWorkPlanLane"), "Goal does not render peer Plan boards");
  const board = extractFunctionSource(js, "renderWorkTaskBoard");
  assert.ok(board.includes('aria-labelledby'), "Task board has a semantic region name");

  const rw = extractFunctionSource(js, "rWork");
  const outcomeSection = extractFunctionSource(js, "renderOutcomeSection");
  assert.ok(outcomeSection.indexOf("renderOutcomeComposer()") < outcomeSection.indexOf("renderIntakeStory()"),
    "the intake journey stays adjacent to the composer so a recorded result never falls below the board");
  assert.ok(rw.indexOf("renderOutcomeSection()") < rw.indexOf("renderWorkWorkbench(view, S.workSelection)"),
    "the outcome section (composer plus journey) precedes the focused workspace in rWork");
  assert.ok(js.includes('data-fl-role", "work-phase-option"'), "phase options have a stable semantic role");
  assert.ok(css.includes(".work-phase-list"), "phase navigation has a dedicated layout");
  assert.match(css, /\.work-board\s*>\s*\.work-col-grid\s*\{[\s\S]*?min-width:\s*1160px/, "desktop board gives seven columns readable room");
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.work-board\s*\{[\s\S]*?overflow-x:\s*visible/, "mobile board stacks without page overflow");
  for (const phrase of [
    "workPhaseNavigatorTitle",
    "workPhaseFutureReadOnly",
    "workPhaseUnknownHint",
    "workGoalTasksFutureHint",
    "workPhaseStatusCurrent",
  ]) {
    assert.ok(i18n.includes(phrase), `${phrase} is bilingual copy-backed`);
  }
});

test("FL-112E3 phase helpers follow Core currentPlanId without inferring readiness", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const viewState = {
    workViewedGoalId: "g1",
    workViewedPlanId: "removed-plan",
  };
  const helpers = [
    extractFunctionSource(js, "workGoalIsTerminalStatusForSelection"),
    extractFunctionSource(js, "workGoalCurrentIndex"),
    extractFunctionSource(js, "workGoalPhaseState"),
    extractFunctionSource(js, "workGoalCurrentPlan"),
    extractFunctionSource(js, "workGoalViewedPlan"),
  ].join("\n");
  const api = new Function("S", `${helpers}; return {
    phaseState: workGoalPhaseState,
    currentPlan: workGoalCurrentPlan,
    viewedPlan: workGoalViewedPlan,
  };`)(viewState) as {
    phaseState: (goal: Record<string, unknown>, index: number) => string;
    currentPlan: (goal: Record<string, unknown>) => Record<string, unknown> | null;
    viewedPlan: (goal: Record<string, unknown>) => Record<string, unknown> | null;
  };
  const plans = [
    { planId: "p1", columns: { ready: [{ taskId: "unrelated-ready" }] } },
    { planId: "p2", columns: { "not-started": [{ taskId: "future-task" }] } },
    { planId: "p3", columns: { completed: [{ taskId: "history-task" }] } },
  ];
  const active = { goalId: "g1", status: "running", currentPlanId: "p2", plans };
  assert.equal(api.currentPlan(active)?.planId, "p2", "active Goal follows Core currentPlanId");
  assert.deepEqual(
    plans.map((_, index) => api.phaseState(active, index)),
    ["completed", "current", "upcoming"],
    "phase labels come from ordered position and currentPlanId",
  );
  assert.equal(api.viewedPlan(active)?.planId, "p2",
    "a removed viewed phase falls back to Core currentPlanId");
  assert.equal(viewState.workViewedPlanId, null,
    "a removed viewed phase clears the stale browser-only selection");

  const terminal = { goalId: "g1", status: "completed", currentPlanId: "p2", plans };
  assert.equal(api.currentPlan(terminal)?.planId, "p3", "terminal Goal falls back to the last phase");
  assert.deepEqual(
    plans.map((_, index) => api.phaseState(terminal, index)),
    ["history", "history", "history"],
    "terminal browsing never invents a live current phase",
  );
});

test("FL-112E3 real Work leads the first screen; empty keeps creation primary", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const rw = extractFunctionSource(js, "rWork");
  // Empty hierarchy: the creation band (outcome composer + shape guide) is
  // appended before filters, so a brand-new user still sees a clear create entry.
  const firstIntroAppend = rw.indexOf("viewEl.appendChild(intro)");
  const firstFiltersAppend = rw.indexOf("viewEl.appendChild(renderWorkFilters())");
  assert.ok(firstIntroAppend > 0 && firstIntroAppend < firstFiltersAppend,
    "empty hierarchy still leads with the creation entry");
  // With real Work: the selected workspace owns the canvas and the compact
  // creation entry lives in the portfolio rail; filters follow the workbench.
  const boardAppend = rw.lastIndexOf("viewEl.appendChild(renderWorkWorkbench(view, S.workSelection))");
  const realFiltersAppend = rw.lastIndexOf("viewEl.appendChild(renderWorkFilters())");
  assert.ok(boardAppend > firstFiltersAppend && boardAppend < realFiltersAppend,
    "real Work leads the first screen; filters stay optional");
  const portfolio = extractFunctionSource(js, "renderWorkPortfolio");
  const entry = extractFunctionSource(js, "renderWorkNewEntry");
  assert.ok(portfolio.includes("renderWorkNewEntry")
    && entry.includes("renderOutcomeSection()")
    && entry.includes("renderWorkShapeGuide()"),
    "existing Work keeps creation and the shape strip beside workspace navigation");
});

test("FL-112E3 desktop Kanban cells keep their own height, mobile stack unchanged", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  // Desktop lane rows top-align every status cell and let it size to its own
  // content, so an empty column never stretches into a blank wall beside a
  // long completed lane.
  assert.match(css, /\.work-board\s*>\s*\.work-lane-row\s*\{[\s\S]*?align-items:\s*start/,
    "desktop lane rows top-align their cells");
  assert.match(css, /\.work-board\s*>\s*\.work-lane-row\s*\.work-cell\s*\{[\s\S]*?align-self:\s*start/,
    "desktop status cells render at their own content height");
  // Seven columns and local horizontal scroll stay intact.
  assert.match(css, /\.work-board\s*>\s*\.work-col-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(7,\s*minmax\(160px,\s*1fr\)\)/,
    "seven columns remain on desktop");
  assert.match(css, /\.work-board\s*>\s*\.work-col-grid\s*\{[\s\S]*?min-width:\s*1160px/,
    "desktop board keeps local horizontal scroll");
  // Mobile keeps the stacked status groups with per-status titles and no
  // board-level horizontal leak.
  const workMedia = css.match(/@media\s*\(max-width:\s*900px\)\s*\{\s*\.work-col-grid/);
  assert.ok(workMedia, "narrow workbench breakpoint remains");
  const narrowStart = workMedia!.index ?? 0;
  const nextMedia = css.indexOf("@media", narrowStart + 10);
  const narrowBlock = css.slice(narrowStart, nextMedia > 0 ? nextMedia : css.length);
  assert.match(narrowBlock, /\.work-col-grid\s*\{[\s\S]*?flex-direction:\s*column/,
    "status groups stack on narrow screens");
  assert.match(narrowBlock, /\.work-cell-head\s*\{\s*display:\s*block/,
    "mobile keeps per-status titles");
  assert.match(narrowBlock, /\.work-board\s*\{\s*overflow-x:\s*visible/,
    "mobile still avoids board horizontal overflow");
});
test("FL-113 hierarchy-first entry, sparse states, and one-off search stay bounded", async () => {
  const [js, css, i18n] = await Promise.all([
    readFile(path.join(hubPublic, "app.js"), "utf8"),
    readFile(path.join(hubPublic, "app.css"), "utf8"),
    readFile(path.join(hubPublic, "i18n.js"), "utf8"),
  ]);

  const portfolio = extractFunctionSource(js, "renderWorkPortfolio");
  const entry = extractFunctionSource(js, "renderWorkNewEntry");
  assert.ok(portfolio.includes("renderWorkNewEntry"), "existing Work keeps one compact creation entry near navigation");
  assert.ok(entry.includes("renderOutcomeSection()") && entry.includes("renderWorkShapeGuide()"),
    "the entry preserves the result composer and three-shape explanation");

  const board = extractFunctionSource(js, "renderWorkTaskBoard");
  const columns = extractFunctionSource(js, "renderWorkColumns");
  assert.ok(board.includes("workColumnCodesWithCards"), "the board header follows active canonical states");
  assert.ok(columns.includes("work-empty-state-rail"), "empty canonical states use a labeled rail");
  assert.ok(columns.includes("WORK_COLUMN_CODES"), "all seven canonical states remain reachable");

  const oneOff = extractFunctionSource(js, "renderWorkFocusedOneOff");
  const oneOffGroup = extractFunctionSource(js, "renderWorkOneOffGroup");
  assert.ok(oneOff.includes("renderWorkOneOffSearch"), "one-off inbox exposes history search");
  assert.ok(oneOff.includes("renderWorkOneOffSummary") && !oneOff.includes("renderWorkStory("),
    "one-off summary stays count-based instead of repeating completed prose");
  assert.ok(oneOffGroup.includes("workOneOffCardMatches") && oneOffGroup.includes("definition.limit"),
    "history search filters without removing bounded rendering");
  assert.ok(!oneOffGroup.includes('query: query ? " for'),
    "history search does not inject English query copy into localized hints");

  const advanced = extractFunctionSource(js, "renderWorkAdvanced");
  assert.ok(advanced.includes("selectedCard") && advanced.includes("renderWorkExpertTaskRecord"),
    "technical evidence is contextual to the selected Task");
  assert.doesNotMatch(advanced, /slice\(0,\s*8\)/,
    "technical details never render a batch of one-off Task rows");

  const normalize = extractFunctionSource(js, "workReadingNormalizeRecord");
  const build = extractFunctionSource(js, "workBuildSessionContext");
  const apply = extractFunctionSource(js, "workApplySavedReadingContext");
  const truth = extractFunctionSource(js, "workVisibleTruthSnapshot");
  const focus = extractFunctionSource(js, "workReadingFocusExists");
  const findFocus = extractFunctionSource(js, "workFindFocusTarget");
  for (const source of [normalize, build, apply, truth]) {
    assert.ok(source.includes("workOneOffSearch") || source.includes("search"),
      "one-off search state is included in reading continuity");
  }
  assert.ok(focus.includes("oneoff-search") && findFocus.includes("work-oneoff-search-input"),
    "search input focus survives a Work rebuild");

  assert.ok(css.includes(".work-new-entry") && css.includes(".work-column-set")
    && css.includes(".work-empty-state-rail"), "hierarchy-first visual hooks ship");
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.work-column-set\s*>\s*\.work-col-grid[\s\S]*?flex-direction:\s*column/,
    "narrow status groups stack inside the board");
  assert.ok(i18n.includes("Main proposes one shape with a reason; you confirm before anything is created.")
    && i18n.includes("确认后才会创建 Task、Plan 或 Goal"),
    "both languages state the proposal and confirmation boundary");
  assert.ok(i18n.includes("History is lazy and searchable. Showing {count} matching Tasks.")
    && i18n.includes("历史按需加载，可搜索。当前显示 {count} 个匹配 Task。"),
    "history search hint is locale-owned in English and Chinese");
  assert.equal((i18n.match(/workIndependentTasks:/g) ?? []).length, 2,
    "independent Task labels exist in both languages");
  assert.equal((i18n.match(/workExpertDetailsTitle:/g) ?? []).length, 2,
    "Technical details is named in both languages");
});

test("FL-116A Worker settings stack cleanly near 390px with no horizontal overflow", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");

  // The compact page introduction stays in flow and never pushes the selector
  // below a giant explanatory band.
  assert.ok(css.includes(".page-story-workers"), "worker page intro has a compact class");
  assert.match(css, /\.page-story-workers \.page-story-purpose\s*\{[\s\S]*?padding:\s*8px 12px/,
    "worker intro purpose stays compact");
  assert.doesNotMatch(css, /\.page-story-workers[^{]*\{[^}]*display\s*:\s*none/,
    "the worker intro is never hidden entirely");

  // The grouped editor uses native disclosures whose closed summaries wrap.
  assert.match(css, /\.settings-group-detail\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    "closed-group summaries wrap anywhere");
  assert.match(css, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.settings-group-detail\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    "narrow closed-group summaries still wrap anywhere");

  // The two effective previews stack full-width on narrow screens.
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.worker-preview-region\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    "preview panels stack on narrow screens");

  // Readable duration adapters wrap instead of leaking a fixed row width.
  assert.match(css, /\.duration-field\s*\{[\s\S]*?min-width:\s*0/,
    "duration adapter stays contained");
  assert.match(css, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.duration-field\s*\{[\s\S]*?flex-wrap:\s*wrap/,
    "duration adapter wraps near 390px");

  // The worker page reuses the existing stacked configure split at narrow
  // widths so the selector and one primary editor never sit side by side.
  assert.match(css, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.configure-split\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    "configure split stacks before the worker page gets crowded");

  // Safety rules and recovery copy wrap anywhere so long sentences cannot leak
  // page-level horizontal scroll.
  assert.match(css, /\.worker-safety \.safety-rule\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    "safety rules wrap anywhere");
  assert.match(css, /\.recovery-narrative\s*\{[\s\S]*?min-width:\s*0/,
    "recovery narrative stays contained");
});

test("FL-116A compact Worker rows and flat previews stay usable near 390px", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");

  // Each saved Worker row is a contained, focusable compact row.
  assert.match(css, /\.configure-list \.worker-row\s*\{[\s\S]*?min-width:\s*0/,
    "worker rows stay contained");
  assert.match(css, /\.configure-list \.worker-row\[role="button"\]:focus-visible\s*\{[\s\S]*?outline:\s*none/,
    "keyboard focus is visible on worker rows");
  assert.match(css, /\.configure-list \.worker-row \.actions\s*\{[\s\S]*?flex-wrap:\s*wrap/,
    "row actions wrap on narrow screens");
  assert.match(css, /\.configure-list \.worker-row \.worker-row-badges\s*\{[\s\S]*?flex-wrap:\s*wrap/,
    "row badges wrap instead of overflowing");

  // Preview panels are flat sections, not nested cards, and still stack.
  assert.match(css, /\.worker-preview-region \.preview-panel\s*\{[\s\S]*?background:\s*transparent/,
    "preview panels are flat, not nested cards");
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.worker-preview-region\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    "flat preview panels still stack on narrow screens");

  // The recovery narrative and safety box keep the quiet hierarchy (no thick
  // side accent bars).
  assert.doesNotMatch(css, /\.recovery-narrative\s*\{[^}]*border-left:\s*3px/,
    "recovery narrative has no thick side bar");
  assert.doesNotMatch(css, /\.worker-safety\s*\{[^}]*border-left:\s*3px/,
    "safety box has no thick side bar");
});
