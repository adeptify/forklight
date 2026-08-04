/**
 * FL-109B responsive topology for the unified hierarchical workbench.
 *
 * Desktop keeps a horizontally scrollable seven-column board inside vertically
 * ordered lanes; narrow screens preserve the Goal -> Plan -> Task DOM/focus
 * order and show readable status groups without squeezing seven columns into
 * the viewport or leaking page-level horizontal scroll. These are deterministic
 * source/CSS assertions that Main's two-viewport browser audit then confirms.
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

test("Narrow screens linearize Goal -> Plan -> Task without a seven-column squeeze", async () => {
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
  // DOM/focus order in the renderer is Goal -> Plan -> Task.
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const rw = extractFunctionSource(js, "rWork");
  const goalsAppend = rw.indexOf("activeGoals.forEach");
  const finishedAppend = rw.indexOf("renderWorkFinishedGoals");
  const indepAppend = rw.indexOf("board.appendChild(indepGroup)");
  const oneOffAppend = rw.indexOf("board.appendChild(oneOffGroup)");
  assert.ok(goalsAppend > 0 && finishedAppend > goalsAppend
    && indepAppend > finishedAppend && oneOffAppend > indepAppend,
    "active goals, finished group, independent plans, then one-off tasks");
  const goal = extractFunctionSource(js, "renderWorkGoalLane");
  const plan = extractFunctionSource(js, "renderWorkPlanLane");
  assert.ok(goal.indexOf("renderWorkPlanLane") > 0, "Goal body contains its Plan lanes");
  assert.ok(plan.indexOf("renderWorkColumns") > 0, "Plan body contains the Task columns");
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

test("Long content wraps and controls meet practical touch targets", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.match(css, /\.work-card-name\s*\{[\s\S]*?overflow-wrap:\s*anywhere/, "long Task names wrap in cards");
  assert.match(css, /\.work-card-meta\s*\{[\s\S]*?overflow-wrap:\s*anywhere/, "long blocker/worker copy wraps");
  assert.match(css, /\.work-lane-toggle\s*\{[\s\S]*?width:\s*100%/, "lane toggles span the lane");
  assert.ok(css.includes("min-height: 32px"), "controls keep a practical touch target");
  // Keyboard operation: lane toggles and cards are real buttons/roles.
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const goal = extractFunctionSource(js, "renderWorkGoalLane");
  assert.ok(goal.includes('h("button"'), "Goal toggle is a native button");
  const oneOff = extractFunctionSource(js, "renderWorkOneOffLane");
  assert.ok(oneOff.includes('h("button"'), "One-off toggle is a native button");
  assert.ok(oneOff.includes("aria-expanded"), "One-off disclosure is keyboard-operable");
  const card = extractFunctionSource(js, "renderWorkCard");
  assert.ok(card.includes('el.setAttribute("tabindex", "0")'), "cards are keyboard focusable");
  assert.ok(card.includes('e.key === "Enter"'), "cards open on Enter");
});

test("Long-lived Work defaults keep the initial page calm without losing hierarchy", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // Smart defaults and tab-local overrides ship as pure helpers used by every lane.
  assert.ok(js.includes("function workGoalDefaultExpanded("), "Goal default helper ships");
  assert.ok(js.includes("function workPlanDefaultExpanded("), "Plan default helper ships");
  assert.ok(js.includes("function workOneOffDefaultExpanded("), "One-off default helper ships");
  assert.ok(js.includes("function workPresentProjectOptions("), "project presentation helper ships");
  const goal = extractFunctionSource(js, "renderWorkGoalLane");
  const plan = extractFunctionSource(js, "renderWorkPlanLane");
  const oneOff = extractFunctionSource(js, "renderWorkOneOffLane");
  assert.ok(goal.includes("workGoalDefaultExpanded(goal)"), "Goal render consults the calm default");
  assert.ok(plan.includes("workPlanDefaultExpanded(plan)"), "Plan render consults the calm default");
  assert.ok(oneOff.includes("workOneOffDefaultExpanded(lane)"), "One-off render consults the calm default");
  assert.ok(oneOff.includes("ensureOneOffBody"), "historical one-off cards are not forced into the first paint");
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

test("FL-108B desktop composition reaches the board; narrow layout keeps disclosures usable", async () => {
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const rw = extractFunctionSource(js, "rWork");
  // 1280x720 contract: primary action, compact help, filters, then board heading.
  const outcomeAt = rw.indexOf("renderOutcomeSection()");
  const storyAt = rw.indexOf('renderPageStory("work")');
  const filtersAt = rw.indexOf("renderWorkFilters()");
  const boardAt = rw.indexOf('data-fl-role", "work-board"');
  const headAt = rw.indexOf('data-fl-role", "work-col-head"');
  assert.ok(outcomeAt > 0 && storyAt > outcomeAt && filtersAt > storyAt && boardAt > filtersAt,
    "desktop composition order: outcome → help → filters → board");
  assert.ok(headAt > boardAt, "canonical board heading is part of the board render");
  // Compact empty intake and closed help shrink the above-board stack without
  // fixed viewport heights, clipping, overlays, or hidden form fields.
  assert.ok(css.includes(".outcome-story-note-empty"), "empty intake has a compact style");
  assert.ok(css.includes(".page-story-disclosure"), "Work help disclosure style ships");
  assert.ok(css.includes("min-height: 32px"), "disclosure toggles keep a practical touch target");
  assert.ok(!/outcome-section[\s\S]{0,120}(height:\s*\d+vh|max-height:\s*\d+vh)/.test(css),
    "outcome section is not viewport-height locked");
  assert.ok(!/page-story-disclosure[\s\S]{0,200}(position:\s*fixed|position:\s*absolute)/.test(css),
    "help stays in document flow");
  assert.ok(!/work-finished-group[\s\S]{0,200}(position:\s*fixed|overflow:\s*hidden)/.test(css),
    "finished work stays in flow and is not clipped");
  // Keyboard/touch: native details/summary disclosures for help and finished work.
  const story = extractFunctionSource(js, "renderPageStory");
  assert.ok(story.includes('createElement("details")'), "Work help uses a native details disclosure");
  assert.ok(story.includes('createElement("summary")'), "Work help summary is keyboard operable");
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
  // Composer fields stay in the form; advanced remains progressively disclosed.
  const composer = extractFunctionSource(js, "renderOutcomeComposer");
  assert.ok(composer.includes('data-fl-role", "outcome-text"'), "primary outcome field remains");
  assert.ok(composer.includes('data-fl-role", "outcome-advanced"'), "advanced input remains reachable");
  assert.ok(composer.includes('data-fl-role", "outcome-project"'), "project field is not deleted");
  assert.ok(composer.includes('data-fl-role", "outcome-context"'), "context field is not deleted");
  assert.ok(composer.includes('data-fl-role", "outcome-shape"'), "shape field is not deleted");
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
