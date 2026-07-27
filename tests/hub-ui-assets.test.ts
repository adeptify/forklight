/**
 * Hub is the only control-center UI: assets + security invariants + packaging.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hubPublic = path.join(root, "src", "hub", "public");

test("Hub is the only control UI package path in npm build", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const build = pkg.scripts.build ?? "";
  assert.ok(/copy-hub-assets/.test(build), "build must package Hub assets");
  assert.ok(!/copy-console-assets/.test(build), "build must not package Console assets");
  assert.ok(!/copy-setup-assets/.test(build), "build must not package Setup UI assets");
});

test("Hub public assets exist with configure + operate chrome", async () => {
  const html = await readFile(path.join(hubPublic, "index.html"), "utf8");
  const js = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes('data-tab="model"') && html.includes('data-tab="tasks"'));
  assert.ok(html.includes('id="fl-detail"'));
  assert.ok(js.includes("X-ForkLight-Hub-Token"));
  assert.ok(js.includes("function kanbanCard"));
  assert.ok(css.length > 200);
});

test("Hub app.js security and decision-drawer invariants", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(!/\.innerHTML\s*=/.test(src));
  assert.ok(!/onclick\s*=/i.test(src));
  assert.ok(!/\.style\./.test(src));
  assert.ok(!/—/.test(src));
  for (const label of [
    "Worker claim (unverified)",
    "Independent verification",
    "Main agent review",
    "User authorization",
    "Integration and activation",
    "Next action",
  ]) {
    assert.ok(src.includes(label), `decision drawer must include ${label}`);
  }
  assert.ok(!/document\.cookie|[^.]\bcookie\s*=/.test(src));
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const localStorageCalls = codeOnly.match(/localStorage\.(?:getItem|setItem)\([^\n;]*/g) ?? [];
  assert.ok(localStorageCalls.length > 0, "theme preference still uses localStorage");
  assert.ok(
    localStorageCalls.every((call) => /["']fl-theme["']/.test(call)),
    "localStorage is limited to the non-secret theme preference",
  );
  const sessionStorageCalls = codeOnly.match(
    /sessionStorage\.(?:getItem|setItem|removeItem)\([^\n;]*/g,
  ) ?? [];
  assert.ok(sessionStorageCalls.length >= 3, "tab session supports token get/set/remove");
  assert.ok(
    sessionStorageCalls.every((call) => call.includes("HUB_TOKEN_SESSION_KEY")),
    "sessionStorage is limited to the dedicated Hub token key",
  );
  assert.ok(src.includes("isValidHubToken"));
  assert.ok(src.includes("clearHubToken"));
  assert.ok(!src.includes("?token="));
});

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

test("Hub token survives one-tab refresh and is cleared after rejection", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const tokenFunctions = [
    "isValidHubToken", "clearHubToken", "persistHubToken", "readStoredHubToken",
    "stripHubTokenFragment", "readToken",
  ].map((name) => extractFunctionSource(src, name)).join("\n");
  const stored = new Map<string, string>();
  const storage = {
    getItem(key: string) { return stored.get(key) ?? null; },
    setItem(key: string, value: string) { stored.set(key, value); },
    removeItem(key: string) { stored.delete(key); },
  };
  const location = { hash: `#${"a".repeat(43)}`, pathname: "/", search: "?qa=1" };
  let strippedTo = "";
  const history = { replaceState(_a: unknown, _b: string, value: string) { strippedTo = value; } };
  const harness = new Function("sessionStorage", "window", "history", `
    var S = { token: null };
    var HUB_TOKEN_SESSION_KEY = "fl-hub-session-token";
    ${tokenFunctions}
    return { readToken: readToken, clearHubToken: clearHubToken, state: S };
  `)(storage, { location, history }, history) as {
    readToken(): string | null;
    clearHubToken(): void;
    state: { token: string | null };
  };

  const token = harness.readToken();
  assert.equal(token, "a".repeat(43));
  assert.equal(stored.get("fl-hub-session-token"), token);
  assert.equal(strippedTo, "/?qa=1", "fragment is removed without changing the query");
  location.hash = "";
  assert.equal(harness.readToken(), token, "same-tab refresh recovers the session token");
  harness.state.token = token;
  harness.clearHubToken();
  assert.equal(harness.state.token, null);
  assert.equal(stored.has("fl-hub-session-token"), false);

  const throwingStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  location.hash = `#${"b".repeat(43)}`;
  const fallback = new Function("sessionStorage", "window", "history", `
    var S = { token: null };
    var HUB_TOKEN_SESSION_KEY = "fl-hub-session-token";
    ${tokenFunctions}
    return readToken();
  `)(throwingStorage, { location, history }, history) as string | null;
  assert.equal(fallback, "b".repeat(43), "storage failure does not break this page load");
  assert.ok(src.includes("if(r.status === 401) clearHubToken()"));
  assert.ok(!/JSON\.stringify\([^)]*S\.token/.test(src), "token is not sent in a body");
});

test("Hub model-routing unsaved state compares semantic values", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const keysStart = src.indexOf("var MR_WEIGHT_KEYS = ");
  const keysEnd = src.indexOf("];", keysStart);
  assert.ok(keysStart >= 0 && keysEnd > keysStart);
  const helperSource = [
    src.slice(keysStart, keysEnd + 2),
    extractFunctionSource(src, "mrFiniteNumber"),
    extractFunctionSource(src, "projectModelRoutingPolicy"),
    extractFunctionSource(src, "modelRoutingPoliciesEqual"),
    extractFunctionSource(src, "isModelRoutingDraftDirty"),
    "return isModelRoutingDraftDirty;",
  ].join("\n");
  const isDirty = new Function(helperSource)() as (draft: unknown, saved: unknown) => boolean;
  const saved = {
    minRelevantSamples: 5,
    uncertaintyThreshold: 0.15,
    competitionOnUncertainty: true,
    missingEvidenceMode: "flexible",
    weights: {
      acceptedDelivery: 1, verifiedBehavior: 1, modelQualityFailure: 0.5,
      correctionChurn: 0.2, officialCost: 0, duration: 0,
    },
  };
  assert.equal(isDirty({
    ...saved,
    minRelevantSamples: "5",
    uncertaintyThreshold: "0.15",
    weights: Object.fromEntries(Object.entries(saved.weights).map(([key, value]) => [key, String(value)])),
  }, saved), false, "equivalent form strings are not dirty");
  assert.equal(isDirty({ ...saved, missingEvidenceMode: "strict" }, saved), true);
  assert.equal(isDirty({ ...saved, missingEvidenceMode: "flexible" }, saved), false);
  assert.equal(isDirty({ ...saved, minRelevantSamples: "" }, saved), true);
  assert.equal(isDirty({
    ...saved,
    weights: { ...saved.weights, acceptedDelivery: 2 },
  }, saved), true);

  const captureStart = src.indexOf("function captureRoutingDraft");
  const captureEnd = src.indexOf("\n  mruiEls.forEach", captureStart);
  const capture = src.slice(captureStart, captureEnd);
  assert.ok(capture.includes("isModelRoutingDraftDirty"));
  assert.ok(!/S\.mrDirty\s*=\s*true/.test(capture));
  assert.ok(capture.includes("uv.hidden = !S.mrDirty"));
});

test("Hub economics renderer keeps truthful labels", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(src.includes('t("econWorkerVolumeTitle")'));
  assert.ok(src.includes('t("econBoundaryCaveat")'));
  assert.ok(src.includes('t("econDirectUnavailableCaveat")'));
  assert.ok(i18n.includes("Worker activity, not a bill"));
  assert.ok(i18n.includes("不能证明 Main Token 直接节省"));
  assert.ok(!src.includes("Boundary Reduction (measured Worker Tokens"));
  assert.ok(!src.includes("Direct-Codex Savings (counterfactual"));
  assert.ok(!/grand.?total/i.test(src));
  assert.ok(/function evAmount\(/.test(src));
  assert.match(css, /\.economics-grid\s*\{[^}]*grid-template-columns\s*:\s*1fr\s+1fr/i);
  assert.match(
    css,
    /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{\s*\.economics-grid\s*\{\s*grid-template-columns\s*:\s*1fr\s*\}/i,
  );
});

test("Hub Insights economics summary renderer exposes truthful evidence", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  // Polling and bridge surface
  assert.ok(src.includes("pollEconomics"), "isolated economics poll helper");
  assert.ok(src.includes("/api/ops/economics-summary"), "bridge URL on the wire");
  assert.ok(src.includes("S.economics"), "cached summary state");
  assert.ok(src.includes("S.economicsError"), "isolated failure state");
  // Hierarchy renderers
  assert.ok(src.includes("renderPortfolioEconomics"), "portfolio renderer present");
  assert.ok(src.includes("renderScopeStrip"), "scope strip renderer");
  assert.ok(src.includes("renderExchangeSection"), "main exchange renderer");
  assert.ok(src.includes("renderDirectSavingsSection"), "direct-Codex savings renderer");
  assert.ok(src.includes("renderWorkerVolumeSection"), "worker volume renderer");
  assert.ok(src.includes("renderBudgetSection"), "budget renderer");
  assert.ok(src.includes("renderRuntimeSection"), "runtime renderer");
  assert.ok(src.includes("renderOfficialCostRows"), "official cost rows renderer");
  // rStats must not read the legacy avgCostUsd field on provider/model cards.
  const rStatsIdx = src.indexOf("function rStats()");
  assert.ok(rStatsIdx > 0, "rStats present");
  const nextFn = src.indexOf("function ", rStatsIdx + 1);
  const rStatsBlock = src.slice(rStatsIdx, nextFn > 0 ? nextFn : src.length);
  assert.ok(!/avgCostUsd/.test(rStatsBlock), "rStats must not reference avgCostUsd");
  assert.ok(!/costSampleSize/.test(rStatsBlock), "rStats must not reference costSampleSize");
  assert.ok(rStatsBlock.includes("runtimeEstimateTaskSampleSize"),
    "rStats reads runtimeEstimateTaskSampleSize (truthful new field)");
  assert.ok(rStatsBlock.includes("avgRuntimeEstimatePerTaskUsd"),
    "rStats reads avgRuntimeEstimatePerTaskUsd (truthful new field)");
  // Main exchange and direct-Codex savings must be kept as separate sections.
  assert.ok(src.includes("econExchangeTitle"), "main exchange title");
  assert.ok(src.includes("econDirectTitle"), "direct-Codex savings title");
  // Worker Token volume must never be relabeled as savings.
  assert.ok(!/gross\s+Worker\s+Tokens\s+(?:as\s+)?(?:token\s+)?savings/i.test(src));
  // CSS evidence grid is the asymmetric desktop layout with mobile collapse.
  assert.match(
    css,
    /\.econ-evidence-grid\s*\{[^}]*grid-template-columns\s*:\s*1fr\s+1fr/i,
  );
  assert.match(
    css,
    /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{\s*\.econ-evidence-grid\s*\{\s*grid-template-columns\s*:\s*1fr\s*;?\s*\}/i,
  );
  assert.ok(css.includes(".scope-strip"), "scope strip visible");
  assert.ok(css.includes(".insights-title"), "insights-title treatment visible");
});

test("Hub board filter is presentation-only and bilingual", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(src.includes("function taskMatchesBoardFilter"), "board filter helper exists");
  assert.ok(src.includes("boardFilterQuery"), "board query state is session-local");
  assert.ok(src.includes("boardFilterLane"), "board lane filter state is session-local");
  assert.ok(src.includes('type = "search"'), "filter uses a search input");
  assert.ok(!src.includes("postJSON(\"/api/ops/tasks/delete\""), "filter never deletes tasks");
  for (const key of [
    "taskBoardFilterLabel", "taskBoardFilterPlaceholder", "taskBoardFilterClear",
    "taskBoardFilterEmpty", "taskBoardFilterAll",
  ]) {
    assert.ok(i18n.includes(key + ":"), `i18n has ${key}`);
  }
  assert.ok(i18n.includes("查找任务"), "zh board filter label");
  assert.ok(i18n.includes("没有符合筛选条件的任务"), "zh empty filter copy");
  assert.ok(css.includes(".board-filter-row"), "filter layout styles ship");
  assert.ok(css.includes(".board-lane-filter"), "lane chip styles ship");
});

test("Hub board wires task-submit controls", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("/api/ops/tasks/submit"), "submit API route");
  assert.ok(src.includes("taskSubmitConfirm"), "submit confirm i18n key");
  assert.ok(src.includes("confirm: true") || src.includes("confirm:true"), "confirm gate in submit payload");
  assert.ok(src.includes("filePath"), "filePath field in submit");
});

test("Hub i18n carries submit strings in both languages", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  for (const key of [
    "taskSubmitTitle",
    "taskSubmitBody",
    "taskSubmitBtn",
    "taskSubmitConfirm",
    "taskSubmitOk",
    "taskSubmitPathRequired",
  ]) {
    assert.ok(/en:\s*\{[^}]*\b/.test(i18n) || i18n.includes(key), `en ${key} present`);
    assert.ok(i18n.includes(key), `key ${key} present`);
  }
  assert.ok(i18n.includes("提交任务说明"), "zh submit title");
  assert.ok(i18n.includes("确认提交这份任务说明"), "zh submit confirm");
});

test("Hub app.js carries worker-edit and advanced-policy helpers", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("S.workerEditId"), "worker edit state variable");
  assert.ok(src.includes("S.workerPreviewTimer"), "preview debounce timer");
  assert.ok(src.includes("function buildAdvancedFields"), "advanced field builder");
  assert.ok(src.includes("function collectAdvancedPatch"), "patch collector");
  assert.ok(src.includes("function hydrateAdvancedFields"), "field hydration");
  assert.ok(src.includes("function scheduleWorkerPreview"), "preview scheduler");
  assert.ok(src.includes("function fetchWorkerPreview"), "preview fetcher");
  assert.ok(src.includes("function renderWorkerPreview"), "preview renderer");
  assert.ok(src.includes("/api/worker-advanced-preview"), "preview API route");
  assert.ok(src.includes("advancedPolicy"), "advancedPolicy in profile payload");
  assert.ok(src.includes('t("workersBlankUnlimited")'), "localized blank-null unlimited hint");
  assert.ok(src.includes('t("workersBlankInherit")'), "localized blank-inherit hint");
  assert.ok(src.includes("workersEditBadge"), "edit badge i18n key");
  assert.ok(src.includes("workersAdvancedToggle"), "advanced disclosure i18n key");
  assert.ok(src.includes("workersPreviewTitle"), "preview title i18n key");
  assert.ok(src.includes("workersPreviewSetting"), "preview names every setting row");
  assert.ok(src.includes("field === \"changeBudgetMode\""), "development default warns on change-budget size");
  assert.ok(src.includes("function advancedDevelopmentDefaults"), "bounded loose development defaults");
  assert.ok(src.includes('maxMainReverifications: "workersAdvMaxMainReverifications"'),
    "verification-only allowance is editable per Worker");
  assert.ok(src.includes("budgetMode.value === \"unlimited\""), "per-worker unlimited budget mode");
  assert.ok(src.includes("policyForEditor.noProgressTimeoutMs"), "legacy no-progress value migrates into advanced editor");
  assert.ok(!src.includes('field("fl-wp-timeout"'), "legacy duplicate no-progress control is not rendered");
  assert.ok(src.includes('S.tab === "worker" && S.workerFormActive'), "polling preserves an active Worker form");
  assert.ok(src.includes('prof.maxBudgetUsd === null'), "worker card distinguishes unlimited from inherited budget");
  assert.ok(src.includes('budgetMode.id = "fl-wp-budget-mode"'), "budget mode has a stable accessible control id");
});

test("Hub i18n carries advanced worker strings in both languages", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  for (const key of [
    "workersEdit",
    "workersBudgetMode",
    "workersBudgetUnlimited",
    "workersBudgetRequired",
    "workersBlankUnlimited",
    "workersBlankInherit",
    "workersAdvancedToggle",
    "workersAdvancedClosed",
    "workersPreviewTitle",
    "workersPreviewSetting",
    "workersPreviewSourceGlobal",
    "workersPreviewUnlimited",
    "workersAdvMaxDuration",
    "workersAdvObservedTokenCeiling",
    "workersAdvMaxAdaptationRounds",
    "workersAdvMaxMainReverifications",
    "workersPreviewEnforcePreemptive",
    "workersPreviewEnforcePostObs",
  ]) {
    assert.ok(i18n.includes(key), `key ${key} present`);
  }
  assert.ok(i18n.includes("高级设置"), "zh advanced toggle");
  assert.ok(i18n.includes("生效策略预览"), "zh preview title");
  assert.ok(i18n.includes("无限制"), "zh unlimited");
  assert.ok(i18n.includes("事后观测（完成后读取）"), "zh post-observation phase");
  assert.ok(i18n.includes("不自动发起下一轮"), "zh adaptation disabled hint");
});

test("Hub exposes pricing route control with bounded safe options and stable id", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // Bounded safe identifiers - no inference, no free-form text, no credentials.
  assert.ok(src.includes("PRICING_ROUTE_OPTIONS"), "pricing route options constant");
  assert.match(src, /deepseek-direct-payg/);
  assert.match(src, /minimax-international-direct-payg/);
  assert.match(src, /minimax-china-direct-payg/);
  assert.match(src, /volcengine-coding-plan-subscription/);
  // Stable accessible id used by both the editor and the hydration helper.
  assert.ok(src.includes('fl-wp-pricing-route'), "stable accessible id for the pricing route field");
  assert.ok(src.includes("buildPricingRouteField"), "pricing route field builder");
  assert.ok(src.includes("hydratePricingRouteField"), "pricing route hydration helper");
  assert.ok(src.includes("collectPricingRouteField"), "pricing route collector");
  assert.ok(src.includes('t("workersPricingRoute")'), "pricing route select has a visible label");
  assert.ok(src.includes("workersPricingRouteExisting"), "existing externally configured route is preserved");
  // Save flow includes the route only when one is selected.
  assert.match(src, /profile\.pricingRoute\s*=\s*pricingRoute/);
  // Card identity line is rendered for both configured and not-configured states.
  assert.ok(src.includes("pricingRouteLabel"), "human-readable route label helper");
  assert.ok(src.includes("workersPricingRouteCardLabel"), "card label i18n key");
  assert.ok(src.includes("workersPricingRouteNotConfigured"), "not-configured i18n key");
  assert.ok(src.includes("workersPricingRouteBillingOnly"), "card caveat copy i18n key");
  // The pricing route control itself: no credentials, no endpoint mutation,
  // no Provider probing, no free-form text. Inspect the field builder only.
  const builderIdx = src.indexOf("function buildPricingRouteField");
  const builderEnd = src.indexOf("function hydratePricingRouteField");
  const builderBlock = src.slice(builderIdx, builderEnd > 0 ? builderEnd : src.length);
  assert.ok(!builderBlock.includes("apiKey"), "field builder does not touch apiKey");
  assert.ok(!builderBlock.includes("endpoint"), "field builder does not mutate endpoint");
  assert.ok(!builderBlock.includes("probe"), "field builder does not trigger probe");
  assert.ok(!/createElement\(\s*["']input["']/i.test(builderBlock),
    "field builder does not add a free-form text input");
  assert.ok(builderBlock.includes("PRICING_ROUTE_OPTIONS"),
    "field builder only uses the bounded safe options");
});

test("Hub pricing route control copy is truthful and bilingual", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // English truthfulness: select the price table, not the endpoint, not an invoice.
  const enRoute = /workersPricingRoute\s*:\s*"([^"]+)"/.exec(i18n);
  assert.ok(enRoute?.[1] && enRoute[1].length > 0, "en workersPricingRoute label");
  assert.ok(i18n.includes("workersPricingRouteHint"), "en route hint key");
  assert.ok(i18n.includes("workersPricingRouteUnset"), "en route unset key");
  assert.ok(i18n.includes("workersPricingRouteDeepseek"), "en deepseek route label");
  assert.ok(i18n.includes("workersPricingRouteMiniMaxIntl"), "en intl route label");
  assert.ok(i18n.includes("workersPricingRouteMiniMaxCN"), "en CN route label");
  assert.ok(i18n.includes("workersPricingRouteVolcengine"), "en Volcengine route label");
  assert.ok(i18n.includes("workersPricingRouteExisting"), "existing route preservation label");
  // Chinese truthfulness: real values, not the English fallback.
  assert.ok(i18n.includes("官方定价路由"), "zh route label");
  assert.ok(i18n.includes("DeepSeek 直连 PAYG"), "zh deepseek route label");
  assert.ok(i18n.includes("MiniMax 海外直连 PAYG"), "zh intl route label");
  assert.ok(i18n.includes("MiniMax 中国直连 PAYG"), "zh CN route label");
  assert.ok(i18n.includes("火山引擎 Coding Plan（订阅）"), "zh Volcengine route label");
  assert.ok(i18n.includes("未配置"), "zh not-configured copy");
  // The hint must clarify evidence-only - not an invoice, not an endpoint change.
  assert.match(i18n, /workersPricingRouteHint['"]?\s*:\s*"[^"]*官方价表[^"]*"/);
  assert.match(i18n, /workersPricingRouteHint['"]?\s*:\s*"[^"]*账单[^"]*"/);
});

test("Hub CSS includes advanced disclosure and preview styles", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(css.includes(".advanced-disclosure"), "advanced disclosure style");
  assert.ok(css.includes(".advanced-fields"), "advanced fields container style");
  assert.ok(css.includes(".advanced-body"), "advanced body style");
  assert.ok(css.includes(".advanced-row"), "advanced row grid style");
  assert.ok(css.includes(".preview-panel"), "preview panel style");
  assert.ok(css.includes(".preview-table"), "preview table style");
  assert.ok(css.includes(".preview-val"), "preview value cell style");
  assert.ok(css.includes(".preview-unlimited"), "preview unlimited style");
  assert.ok(css.includes(".preview-unsupported"), "preview unsupported style");
  assert.ok(css.includes(".wp-pricing-route-field"), "pricing route field style");
});

test("Hub Insights renders official ranges as a separate, truthful family", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  // Renderer exists and is bound to ranges only - never currencyTotals.
  assert.ok(src.includes("renderOfficialRangeCards"), "official range renderer");
  assert.ok(src.includes("renderOfficialRangeCards(s && s.officialCost)"),
    "renderer reads officialCost.ranges");
  // Compatibility default: ranges default to an empty list when absent.
  assert.match(src, /\(section\s*&&\s*section\.ranges\)\s*\|\|\s*\[\]/);
  // Range renderer never reads currencyTotals - separation from exact totals.
  const rendererIdx = src.indexOf("function renderOfficialRangeCards");
  assert.ok(rendererIdx > 0);
  const nextFn = src.indexOf("function ", rendererIdx + 1);
  const rendererBlock = src.slice(rendererIdx, nextFn > 0 ? nextFn : src.length);
  assert.ok(!rendererBlock.includes("currencyTotals"),
    "range renderer must not reference exact currencyTotals");
  assert.ok(!rendererBlock.includes(".total"),
    "range renderer must not reuse exact total domain");
  assert.ok(rendererBlock.includes("rangedAttemptCount"),
    "range renderer reads rangedAttemptCount");
  assert.ok(rendererBlock.includes("evSources"),
    "range renderer wires official source links");
  // Truthfulness: a lower-upper range is never labelled as a Provider bill.
  assert.ok(i18n.includes("econOfficialRangeCaveat"), "en range caveat key");
  assert.ok(i18n.includes("econOfficialRangeSubsectionTitle"), "en range subsection title");
  assert.ok(i18n.includes("econOfficialRangeSubsectionCaveat"), "en range subsection caveat");
  assert.match(i18n, /econOfficialRangeCaveat['"]?\s*:\s*"[^"]*Conservative[^"]*[Nn]ot exact[^"]*not a Provider bill/);
  assert.match(i18n, /econOfficialRangeSubsectionCaveat['"]?\s*:\s*"[^"]*Lower-upper[^"]*not a Provider bill/);
  assert.ok(i18n.includes("保守的官方区间估算"), "zh range subsection title");
  assert.ok(i18n.includes("非精确值，非 Provider 账单"), "zh range subsection caveat");
  assert.ok(i18n.includes("保守的累加下界-上界"), "zh range caveat");
  // CSS: range cards reuse the same evidence card visual language.
  assert.ok(css.includes(".ev-card"), "evidence card style present");
  assert.ok(css.includes(".ev-range"), "range value style present");
  assert.ok(css.includes(".ev-source"), "source link style present");
  // Three evidence families remain separate: no shared totals arithmetic.
  // The range renderer must not push into the same map that backs exact totals.
  const portalIdx = src.indexOf("function renderOfficialRangeCards");
  const portalEnd = src.indexOf("function renderOfficialUnavailableSection");
  const portalBlock = src.slice(portalIdx, portalEnd > 0 ? portalEnd : src.length);
  assert.ok(!/currencyAggregates/i.test(portalBlock),
    "range renderer must not mutate currencyAggregates (exact totals)");
  assert.ok(!/quoteTotal/i.test(portalBlock),
    "range renderer must not reuse exact quote totals");
});

test("shipped tree has no Console product server or Setup UI server", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(path.join(root, "src", "console")), false);
  assert.equal(existsSync(path.join(root, "src", "setup", "server.ts")), false);
  assert.equal(existsSync(path.join(root, "src", "setup", "public")), false);
  assert.equal(existsSync(path.join(root, "scripts", "copy-console-assets.mjs")), false);
  assert.equal(existsSync(path.join(root, "scripts", "copy-setup-assets.mjs")), false);
  // SetupService remains for doctor/hub
  assert.equal(existsSync(path.join(root, "src", "setup", "service.ts")), true);
});

test("Hub Task detail carries the bounded adaptation panel and bridges to the daemon", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // Renderer exists and is bound to the safe Task-detail effectivePolicy snapshot.
  assert.ok(src.includes("function renderAdaptationPanel"), "adaptation panel renderer");
  assert.ok(src.includes("ADAPT_FIELDS"), "bounded adaptation field inventory");
  assert.ok(
    src.includes('fetchJSON("/api/ops/tasks/" + encodeURIComponent(id)).then(function(task){'),
    "Task detail data must not shadow the global t(...) translator",
  );
  // maxAdaptationRounds is intentionally excluded from the editable inventory.
  const adaptFieldsIdx = src.indexOf("var ADAPT_FIELDS = ");
  assert.ok(adaptFieldsIdx > 0);
  const adaptFieldsEnd = src.indexOf("var ADAPT_REASONS", adaptFieldsIdx);
  const adaptFieldsBlock = src.slice(adaptFieldsIdx, adaptFieldsEnd);
  assert.ok(adaptFieldsBlock.includes('field !== "maxAdaptationRounds"'),
    "adaptation editor deliberately excludes the immutable root cap");
  assert.ok(adaptFieldsBlock.includes('field !== "maxMainCorrections"'),
    "adaptation editor deliberately excludes the Main correction cap");
  assert.ok(adaptFieldsBlock.includes('field !== "maxMainReverifications"'),
    "adaptation editor deliberately excludes the verification-only cap");
  assert.ok(adaptFieldsBlock.includes("Object.keys(ADV_FIELD_LABELS)"),
    "adaptation fields derive from the Worker Advanced inventory");
  // API bridges and confirm gate.
  assert.ok(src.includes("/adaptation/preview"), "preview bridge URL");
  assert.ok(src.includes("/adaptation/apply"), "apply bridge URL");
  assert.ok(src.includes("confirm: true"), "confirm gate in payload");
  // Opt-in semantics: unchecking must not push a value to the patch.
  assert.ok(src.includes("data-adapt-enable"), "opt-in checkbox marker");
  assert.ok(src.includes("data-adapt-value"), "value input marker");
  const buildIdx = src.indexOf("function adaptBuildPatch");
  const buildEnd = src.indexOf("function adaptRenderRows", buildIdx);
  const buildBlock = src.slice(buildIdx, buildEnd > 0 ? buildEnd : src.length);
  assert.ok(buildBlock.includes("state.enabled[def.field]"),
    "build function must guard on per-field opt-in");
  // Preview invalidation: any form change must clear the apply authority.
  assert.ok(src.includes("adaptPatchFingerprint"), "fingerprint helper for preview invalidation");
  assert.ok(src.includes("taskAdaptPreviewStale"), "stale preview i18n key");
  assert.ok(src.includes("clearPreview"), "clear-preview helper");
  // Stopped reasons must be surfaced without retrying or running the gate again.
  assert.ok(src.includes("ADAPT_STOP_REASON_LABELS"), "stopped reason labels");
  assert.ok(src.includes("adaptation-disabled"), "adaptation-disabled reason covered");
  assert.ok(src.includes("round-limit-reached"), "round-limit-reached reason covered");
  assert.ok(src.includes("successor-already-created"), "successor-already-created reason covered");
  // Children Task id link / echo is part of the panel success row.
  assert.ok(src.includes("taskAdaptChildLabel"), "child Task id label");
  // CSS: stacked field cards; checkboxes must not inherit form-card width:100%.
  assert.ok(css.includes(".adaptation-panel"), "adaptation panel CSS");
  assert.ok(css.includes(".adapt-fields"), "adapt-fields CSS");
  assert.ok(css.includes(".adapt-row"), "adapt-row CSS");
  assert.ok(css.includes(".adapt-field-name"), "field title is a full-width block");
  assert.ok(css.includes(".adapt-field-controls"), "controls row for enable + value");
  assert.ok(css.includes("input.adapt-checkbox"), "checkbox class is specially sized");
  assert.ok(css.includes("width: 16px !important"), "checkbox width is forced auto-size");
  assert.ok(css.includes("writing-mode: horizontal-tb"), "labels stay horizontal");
  assert.ok(css.includes(".adapt-preview-panel"), "adapt-preview CSS");
  assert.ok(src.includes("adapt-field-name"), "field name is rendered separately from checkbox");
  assert.ok(src.includes("adapt-checkbox"), "checkbox uses dedicated class");
  assert.ok(src.includes("adapt-field-controls"), "controls wrapper is rendered");
  assert.ok(!src.includes("adapt-row-main"), "old crushing two-column row is gone");
  // i18n copy: both languages carry the bounded reason labels and stopped hints.
  for (const key of [
    "taskAdapt",
    "taskAdaptFields",
    "taskAdaptNone",
    "taskAdaptEnable",
    "taskAdaptValue",
    "taskAdaptReason",
    "taskAdaptPreview",
    "taskAdaptApply",
    "taskAdaptApplyConfirm",
    "taskAdaptCapLabel",
    "taskAdaptNextRound",
    "taskAdaptChildLabel",
    "taskAdaptStopReason",
    "taskAdaptPreviewStale",
    "taskAdaptCaveat",
  ]) {
    assert.ok(i18n.includes(key), `i18n key ${key} present`);
  }
  // English truthfulness: the transition is described as creating a next
  // Task that still needs verification - never as a self-healing success.
  assert.match(i18n, /taskAdaptApplyConfirm['"]?\s*:\s*"[^"]*[Ss]uccessor/);
  assert.match(i18n, /taskAdaptApplyConfirm['"]?\s*:\s*"[^"]*independent verification/i);
  // Chinese truthfulness: same shape, no English fallback copy.
  assert.ok(i18n.includes("适配"), "zh adaptation title");
  assert.ok(i18n.includes("后继 Task"), "zh child label");
  assert.ok(i18n.includes("常规独立验证"), "zh independent verification copy");
});

test("Hub Task detail explains candidate reuse as input, process, and incremental outcome", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(src.includes('data-fl-role", "candidate-reuse"'));
  assert.ok(src.includes("taskCorrectJourneyInput"));
  assert.ok(src.includes("taskCorrectJourneyOutcome"));
  assert.ok(src.includes("taskCorrectJourneyTokens"));
  assert.ok(src.includes("taskCorrectJourneyNoSavingsClaim"));
  assert.ok(i18n.includes("本次增量修正实际使用"));
  assert.ok(i18n.includes("不会声称“从头重做本来会花多少”"));
});

test("Hub adaptation bridge exposes safe task effectivePolicy snapshot", async () => {
  const serverSrc = await readFile(path.join(root, "src", "hub", "server.ts"), "utf8");
  // The safe /api/ops/tasks/:id response must carry the immutable
  // effectivePolicy snapshot (used by the adaptation panel) and must NOT
  // echo prompt, source, diff, logs, secrets, or arbitrary daemon payloads.
  const tdIdx = serverSrc.indexOf("const td = opsRoute.match(/^\\/tasks\\/(.+)$/);");
  assert.ok(tdIdx > 0);
  const tdEnd = serverSrc.indexOf("\n      }\n", tdIdx);
  const tdBlock = serverSrc.slice(tdIdx, tdEnd);
  assert.ok(tdBlock.includes("effectivePolicy"),
    "task detail response must include effectivePolicy snapshot");
  // No leak of disallowed content into the task detail response.
  assert.ok(!tdBlock.includes("spec.prompt"), "no prompt echo");
  assert.ok(!tdBlock.includes("\n          diff,"), "no raw diff field in response");
  assert.ok(!tdBlock.includes("logs"), "no logs echo");
  assert.ok(!tdBlock.includes("secrets"), "no secrets echo");
  // The adaptation bridges must validate inputs before delegating.
  assert.ok(serverSrc.includes("adaptation\\/preview"),
    "preview route registered");
  assert.ok(serverSrc.includes("adaptation\\/apply"),
    "apply route registered");
  assert.ok(serverSrc.includes("adaptation_apply requires confirm: true"),
    "apply confirm gate");
  assert.ok(serverSrc.includes("adaptation patch must be an object"),
    "object-only patch validation");
  assert.ok(serverSrc.includes("adaptation reason must be a bounded reason category"),
    "reason validation");
});

test("Hub Task-list adapter preserves the compact remediation disposition only", async () => {
  const serverSrc = await readFile(path.join(root, "src", "hub", "server.ts"), "utf8");
  // Locate the /api/ops/tasks adapter block.
  const adapterIdx = serverSrc.indexOf('if (opsRoute === "/tasks")');
  assert.ok(adapterIdx > 0, "/api/ops/tasks adapter located");
  const adapterEnd = serverSrc.indexOf("\n      }\n", adapterIdx);
  const adapterBlock = serverSrc.slice(adapterIdx, adapterEnd > 0 ? adapterEnd : serverSrc.length);
  assert.ok(adapterBlock.includes("list_summaries"),
    "adapter reads daemon list_summaries projection");
  // Compact shape: only status / checkId / createdAt are accepted.
  assert.ok(adapterBlock.includes('"verified-repaired-delivered"'),
    "adapter requires verified-repaired-delivered status");
  assert.ok(adapterBlock.includes("checkId"),
    "adapter preserves checkId");
  assert.ok(adapterBlock.includes("createdAt"),
    "adapter preserves createdAt");
  // Privacy boundary: forbidden fields never appear in the safe Task-list shape.
  assert.ok(!adapterBlock.includes("remediationReason"),
    "no remediation reason leaked");
  assert.ok(!adapterBlock.includes("remediationCommand"),
    "no remediation command leaked");
  assert.ok(!adapterBlock.includes("remediationOutput"),
    "no remediation output leaked");
  assert.ok(!adapterBlock.includes("remediationPrompt"),
    "no remediation prompt leaked");
  assert.ok(!adapterBlock.includes("sourcePath"),
    "no sourcePath leaked in the list");
  // The adapter must not let the disposition overwrite machine status.
  assert.ok(adapterBlock.includes("t.status"),
    "machine status still emitted alongside disposition");
});

test("Hub renders machine outcome and verified final delivery as two named facts", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // Compact final-delivery badge helper is wired to the safe disposition shape.
  assert.ok(src.includes("function finalDeliveryBadge"),
    "compact final-delivery badge helper present");
  assert.ok(src.includes('setAttribute("data-fl-role", "final-delivery")'),
    "delivery badge has a stable marker");
  assert.ok(src.includes("verified-repaired-delivered"),
    "delivery badge trigger is verified-repaired-delivered only");
  // Dual outcome row in Task detail is bound to decision.remediationDisposition.
  assert.ok(src.includes("function dualOutcomeRow"),
    "dual outcome row helper present");
  assert.ok(src.includes("function renderDecision(task"),
    "renderDecision accepts the full Task to read status");
  assert.match(src,
    /dualOutcomeRow\(task,\s*d\)/,
    "renderDecision threads the Task into the dual outcome row");
  assert.ok(src.includes('setAttribute("data-fl-role", "dual-outcome")'),
    "dual outcome row has a stable marker");
  assert.ok(src.includes('setAttribute("data-fl-role", "machine-outcome")'),
    "machine outcome span has a stable marker");
  assert.ok(src.includes('setAttribute("data-fl-role", "delivery-outcome")'),
    "delivery outcome span has a stable marker");
  // Provider/model stats renders both machine and accepted delivery fields.
  const rStatsIdx = src.indexOf("function rStats()");
  assert.ok(rStatsIdx > 0);
  const rStatsEnd = src.indexOf("function ", rStatsIdx + 1);
  const rStatsBlock = src.slice(rStatsIdx, rStatsEnd > 0 ? rStatsEnd : src.length);
  assert.ok(rStatsBlock.includes("acceptedDeliveryRate"),
    "stats reads acceptedDeliveryRate");
  assert.ok(rStatsBlock.includes("acceptedDeliveryCount"),
    "stats reads acceptedDeliveryCount");
  assert.ok(rStatsBlock.includes("mainRepairedDeliveryCount"),
    "stats reads mainRepairedDeliveryCount");
  assert.ok(rStatsBlock.includes("remediationCheckCount"),
    "stats reads remediationCheckCount");
  assert.ok(rStatsBlock.includes("successRate"),
    "stats still surfaces machine successRate");
  assert.ok(rStatsBlock.includes("outcome-pair"),
    "stats card uses an outcome-pair grid");
  assert.equal((rStatsBlock.match(/hd\("div", "outcome-cell"/g) || []).length, 2,
    "stats outcome cells append child nodes instead of stringifying them");
  assert.ok(rStatsBlock.includes('setAttribute("data-fl-role", "dual-outcome")'),
    "stats card carries the dual-outcome marker");
  // CSS: outcome-pair collapses to one column at narrow widths.
  assert.match(
    css,
    /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{[^}]*\.outcome-pair\s*\{\s*grid-template-columns\s*:\s*1fr/i,
    "outcome-pair collapses to one column on narrow viewports",
  );
  assert.ok(css.includes(".badge-final-delivery"),
    "final-delivery badge style present");
  // Bilingual copy: each new key is present in both en and zh.
  for (const key of [
    "taskFinalDeliveryBadge",
    "taskFinalDeliveryBadgeHint",
    "taskDualOutcome",
    "taskDualOutcomeMachine",
    "taskDualOutcomeDelivery",
    "taskFinalDeliveryVerified",
    "taskFinalDeliveryNone",
    "taskDualOutcomeHint",
    "statsMachineLabel",
    "statsFinalDeliveryLabel",
    "statsFinalDeliveryHint",
    "statsAcceptedDeliveryLine",
    "statsProviderCaveat",
  ]) {
    assert.ok(i18n.includes(key), `i18n key ${key} present`);
  }
  assert.ok(i18n.includes("已核验交付"), "zh final-delivery badge");
  assert.ok(i18n.includes("机器执行结果"), "zh machine outcome label");
  assert.ok(i18n.includes("最终交付"), "zh final delivery label");
  assert.ok(i18n.includes("Main 修复后的交付不会改写 Worker"),
    "zh semantic caveat");
  // English truthfulness: a Main-repaired delivery does not claim Worker success.
  assert.match(i18n,
    /statsProviderCaveat['"]?\s*:\s*"[^"]*does not rewrite/i);
});

test("Hub Token usage reconciliation card renders in task detail with bilingual copy", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  // Reconciliation renderer exists and reads the tokenReport
  assert.ok(src.includes("usageReconciliation"), "reconciliation state referenced");
  assert.ok(
    src.includes('t("tokRecDeltaPositive", { delta: num(delta, 0) })'),
    "positive reconciliation deltas rely on i18n for exactly one plus sign"
  );
  // I18n keys are consumed in the renderer
  for (const key of [
    "tokRecTitle", "tokRecIntro", "tokRecStateMatched", "tokRecStateMismatch",
    "tokRecStatePartial", "tokRecStateUnavailable", "tokRecCompared",
    "tokRecMatched", "tokRecMismatched", "tokRecMissingBreakdown",
    "tokRecMissingUsage", "tokRecInvalidCounters", "tokRecWorkerVolumeCurrent",
    "tokRecComparedScope", "tokRecAggregateUnavailable",
    "tokRecTopLevelGross", "tokRecPerModelGross",
    "tokRecDelta", "tokRecWorkerVolumeSource", "tokRecNotSavings",
    "tokRecNotBill", "tokRecPerAttemptTitle", "tokRecAttemptOrdinal",
    "tokRecAttemptModels", "tokRecAttemptTopGross", "tokRecAttemptPmGross",
    "tokRecAttemptDelta",
  ]) {
    assert.ok(new RegExp(`t\\("${key}"[,)]`).test(src), `renderer consumes ${key}`);
  }
  // Bilingual coverage
  for (const key of [
    "tokRecTitle", "tokRecIntro", "tokRecStateMatched", "tokRecStateMismatch",
    "tokRecStatePartial", "tokRecStateUnavailable", "tokRecCompared",
    "tokRecMatched", "tokRecMismatched", "tokRecMissingBreakdown",
    "tokRecMissingUsage", "tokRecInvalidCounters", "tokRecWorkerVolumeCurrent",
    "tokRecComparedScope", "tokRecAggregateUnavailable",
    "tokRecTopLevelGross", "tokRecPerModelGross",
    "tokRecDelta", "tokRecWorkerVolumeSource", "tokRecNotSavings",
    "tokRecNotBill", "tokRecPerAttemptTitle",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  // Chinese copy is real, not English fallback
  assert.ok(zhSection.includes("Token 用量对账"), "zh reconciliation title");
  assert.ok(zhSection.includes("绝不会加入规范总量"), "zh worker volume source");
  assert.ok(zhSection.includes("既不是节省，也不是浪费"), "zh not-savings caveat");
  assert.ok(zhSection.includes("都不是 Provider 账单"), "zh not-bill caveat");

  // English truthfulness: difference is never called savings, waste, or bill
  const enBlock = enSection;
  assert.match(enBlock, /tokRecNotSavings['"]?\s*:\s*"[^"]*(?:never|not|is a diagnostic)[^"]*"/);
  assert.match(enBlock, /tokRecNotBill['"]?\s*:\s*"[^"]*(?:Provider bill|invoice)[^"]*"/);

  // Reconciliation evidence uses collapsed disclosure
  assert.ok(src.includes('collapsedSection(t("tokRecPerAttemptTitle")'),
    "per-Attempt evidence is in a closed disclosure");
  assert.ok(src.includes("tokRecAttemptOrdinal"), "ordinal label rendered");
  assert.ok(src.includes("tokRecAttemptModels"), "model count label rendered");
  assert.ok(src.includes("tokRecAttemptTopGross"), "top-level gross label rendered");
  assert.ok(src.includes("tokRecAttemptPmGross"), "per-model gross label rendered");
  assert.ok(src.includes("tokRecAttemptDelta"), "delta label rendered");
  assert.ok(src.includes("wv.grossWorkerTokens"), "actual Worker volume comes from terminal top-level counters");
  assert.ok(src.includes("gd.available"), "aggregate comparison handles unavailable evidence explicitly");

  // Model count is exposed but model strings are never rendered
  assert.ok(src.includes("ev.modelCount"), "model count read from evidence");
  assert.ok(!/ev\.model\b/.test(src), "model name never read from evidence");

  // CSS
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(css.includes(".tok-rec-evidence"), "reconciliation evidence CSS");
  assert.ok(css.includes(".tok-rec-attempt"), "per-attempt CSS");
});

test("Hub final-delivery renderer never changes the machine lane", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // taskLane selects only on Task.status. The compact final-delivery
  // badge must not influence lane selection; a Main-repaired failed Task
  // must still land in the failed lane.
  const laneIdx = src.indexOf("function taskLane(");
  assert.ok(laneIdx > 0);
  const laneEnd = src.indexOf("function ", laneIdx + 1);
  const laneBlock = src.slice(laneIdx, laneEnd > 0 ? laneEnd : src.length);
  assert.ok(!laneBlock.includes("remediationDisposition"),
    "taskLane must not consult remediationDisposition");
  assert.ok(!laneBlock.includes("finalDelivery"),
    "taskLane must not consult final-delivery helpers");
  // kanbanCard appends the badge but never mutates the lane.
  const cardIdx = src.indexOf("function kanbanCard(");
  assert.ok(cardIdx > 0);
  const cardEnd = src.indexOf("function ", cardIdx + 1);
  const cardBlock = src.slice(cardIdx, cardEnd > 0 ? cardEnd : src.length);
  assert.ok(cardBlock.includes("finalDeliveryBadge"),
    "kanbanCard appends the compact final-delivery badge");
  assert.ok(cardBlock.includes("boardActivityBadge"),
    "kanbanCard appends quiet/stalled activity badges for long-running work");
  assert.ok(!cardBlock.includes("taskLane("),
    "kanbanCard must not re-route cards based on the badge");
});

test("Hub surfaces contract-infeasible as revise-contract with bilingual plain language", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(src.includes('"contract-infeasible": "journeyFailureContractInfeasible"'),
    "failureCategoryLabel maps contract-infeasible");
  assert.ok(src.includes('"revise-contract": "journeyNextReviseContract"'),
    "nextActionLabel maps revise-contract");
  assert.ok(src.includes('category === "contract-infeasible"'),
    "resolveCauseWhy handles contract-infeasible");
  for (const key of [
    "journeyFailureContractInfeasible",
    "journeyNextReviseContract",
    "journeyCauseWhyContractInfeasible",
  ]) {
    assert.ok(i18n.includes(key + ":"), `i18n has ${key}`);
  }
  assert.ok(i18n.includes("合同在当前边界下无法完成"), "zh contract-infeasible label");
  assert.ok(i18n.includes("请修订任务合同"), "zh revise-contract next action");
  assert.ok(i18n.includes("Do not retry with the same boundary"), "en next action forbids same-boundary retry");
});

test("Hub economics and routing bridges use task service plain language, not raw Daemon jargon", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // Extract the two bridge strings in both locales by key.
  for (const key of ["econUnavailableBridgeHint", "mrBridgeUnavailable"]) {
    assert.ok(i18n.includes(key + ":"), `${key} present`);
  }
  // Chinese user-facing bridge copy must not say "Daemon".
  const zhSection = i18n.slice(i18n.indexOf("zh: {"));
  const econZh = zhSection.match(/econUnavailableBridgeHint:\s*"([^"]+)"/)?.[1] ?? "";
  const mrZh = zhSection.match(/mrBridgeUnavailable:\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(econZh.includes("任务服务"), "zh economics bridge says 任务服务");
  assert.ok(!econZh.includes("Daemon"), "zh economics bridge avoids Daemon jargon");
  assert.ok(mrZh.includes("任务服务"), "zh routing bridge says 任务服务");
  assert.ok(!mrZh.includes("Daemon"), "zh routing bridge avoids Daemon jargon");
  const enSection = i18n.slice(0, i18n.indexOf("zh: {"));
  const econEn = enSection.match(/econUnavailableBridgeHint:\s*"([^"]+)"/)?.[1] ?? "";
  const mrEn = enSection.match(/mrBridgeUnavailable:\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(econEn.toLowerCase().includes("task service"), "en economics bridge says task service");
  assert.ok(!/\bdaemon\b/i.test(econEn), "en economics bridge avoids daemon jargon");
  assert.ok(mrEn.toLowerCase().includes("task service"), "en routing bridge says task service");
  assert.ok(!/\bdaemon\b/i.test(mrEn), "en routing bridge avoids daemon jargon");
});

test("Hub board activity maps quiet silence age without inventing machine status", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(src.includes("function boardActivityKind"), "board activity helper is shipped");
  assert.ok(src.includes("function boardActivityBadge"), "board activity badge is shipped");
  assert.ok(src.includes("5 * 60 * 1000"), "stall threshold is five minutes of silence");
  assert.ok(src.includes('stalled: "taskActivityStalled"'), "stalled uses i18n key");
  for (const key of [
    "taskActivityActive", "taskActivityQuiet", "taskActivityStalled",
    "taskProgressRunningQuiet", "taskProgressRunningStalled",
  ]) {
    assert.ok(i18n.includes(key + ":"), `i18n has ${key}`);
  }
  assert.ok(i18n.includes("较长时间无进展"), "zh stalled copy is plain language");
  assert.ok(i18n.includes("no progress for a while"), "en stalled copy is plain language");
  // Execute the pure kind classifier against synthetic progress cursors.
  const kindSource = extractFunctionSource(src, "boardActivityKind");
  const boardActivityKind = new Function(
    `${kindSource}\nreturn boardActivityKind;`,
  )() as (task: Record<string, unknown>) => string | null;
  assert.equal(boardActivityKind({ progress: { activity: "active" } }), "active");
  assert.equal(boardActivityKind({ progress: { activity: "quiet" } }), "quiet");
  assert.equal(boardActivityKind({ progress: { activity: "terminal" } }), null);
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.equal(
    boardActivityKind({ progress: { activity: "quiet", lastEventAt: old } }),
    "stalled",
    "long quiet becomes stalled for board presentation only",
  );
  const recent = new Date(Date.now() - 30_000).toISOString();
  assert.equal(
    boardActivityKind({ progress: { activity: "quiet", lastEventAt: recent } }),
    "quiet",
  );
});

test("Hub task summary follows the end-to-end stage after machine verification", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const progressSource = extractFunctionSource(src, "taskProgressSummary");
  const finalDeliverySource = extractFunctionSource(src, "hasVerifiedFinalDelivery");
  const boardKindSource = extractFunctionSource(src, "boardActivityKind");
  const summarize = new Function(
    "t",
    "preparationProgressText",
    `${boardKindSource}\n${finalDeliverySource}\n${progressSource}\nreturn taskProgressSummary;`,
  )(
    (key: string) => key,
    () => "preparing",
  ) as (task: Record<string, unknown>) => string;

  assert.equal(
    summarize({ status: "succeeded", decisionStage: "awaiting-main-review" }),
    "taskProgressSucceeded",
  );
  assert.equal(
    summarize({ status: "running", progress: { activity: "quiet" } }),
    "taskProgressRunningQuiet",
  );
  assert.equal(
    summarize({
      status: "running",
      progress: {
        activity: "quiet",
        lastEventAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
    }),
    "taskProgressRunningStalled",
  );
  assert.equal(
    summarize({ status: "running", progress: { activity: "active" } }),
    "taskProgressRunning",
  );
  assert.equal(
    summarize({ status: "succeeded", decisionStage: "ready-for-integration" }),
    "taskProgressReadyIntegration",
  );
  assert.equal(
    summarize({ status: "succeeded", decisionStage: "activated" }),
    "taskProgressActivated",
  );
  assert.equal(
    summarize({ status: "failed", decisionStage: "revision-requested" }),
    "taskProgressFailedRevisionRequested",
  );
  assert.equal(
    summarize({ status: "failed", decisionStage: "main-rejected" }),
    "taskProgressFailedMainRejected",
  );
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  for (const key of [
    "taskProgressReadyIntegration",
    "taskProgressRevisionRequested",
    "taskProgressMainRejected",
    "taskProgressFailedRevisionRequested",
    "taskProgressFailedMainRejected",
    "taskProgressIntegrating",
    "taskProgressAppliedNotActivated",
    "taskProgressActivated",
    "taskProgressIntegrationFailed",
  ]) {
    assert.ok(i18n.indexOf(key) !== i18n.lastIndexOf(key), `${key} exists in both locales`);
  }
  assert.ok(i18n.includes(
    'journeyNextReadyIntegrate: "Main 已接受结果，正在等待你授权合入原项目。"',
  ));
  assert.ok(i18n.includes(
    'journeyNextReadyIntegrate: "Main accepted the result. It is waiting for your authorization to integrate."',
  ));
});

test("Hub final-delivery UI never exposes remediation reason, command, or output", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // No UI code reads private remediation fields; only the compact shape is used.
  assert.ok(!src.includes("remediationReason"), "app.js must not reference remediationReason");
  assert.ok(!src.includes("remediation.command"), "app.js must not reference remediation.command");
  assert.ok(!src.includes("remediation.output"), "app.js must not reference remediation.output");
  assert.ok(!src.includes("remediation.prompt"), "app.js must not reference remediation.prompt");
  // The compact badge helper only reads the safe subset.
  const badgeIdx = src.indexOf("function finalDeliveryBadge(");
  assert.ok(badgeIdx > 0);
  const badgeEnd = src.indexOf("function ", badgeIdx + 1);
  const badgeBlock = src.slice(badgeIdx, badgeEnd > 0 ? badgeEnd : src.length);
  assert.ok(!badgeBlock.includes("reason"),
    "finalDeliveryBadge must not read a reason field");
  assert.ok(!badgeBlock.includes("command"),
    "finalDeliveryBadge must not read a command field");
  assert.ok(!badgeBlock.includes("output"),
    "finalDeliveryBadge must not read an output field");
  assert.ok(!badgeBlock.includes("source"),
    "finalDeliveryBadge must not read a source field");
  // Detail-panel dual outcome reads only the compact fields.
  const dualIdx = src.indexOf("function dualOutcomeRow(");
  assert.ok(dualIdx > 0);
  const dualEnd = src.indexOf("function ", dualIdx + 1);
  const dualBlock = src.slice(dualIdx, dualEnd > 0 ? dualEnd : src.length);
  assert.ok(!dualBlock.includes("reason"),
    "dualOutcomeRow must not read a reason field");
  assert.ok(!dualBlock.includes("command"),
    "dualOutcomeRow must not read a command field");
  assert.ok(!dualBlock.includes("output"),
    "dualOutcomeRow must not read an output field");
  assert.ok(!dualBlock.includes("source"),
    "dualOutcomeRow must not read a source field");
  // CSS and i18n copy must not echo private remediation strings.
  assert.ok(!css.includes("remediationReason"), "CSS must not leak remediation reason");
  assert.ok(!css.includes("remediationCommand"), "CSS must not leak remediation command");
  assert.ok(!i18n.includes("remediationReason"), "i18n must not leak remediation reason");
  assert.ok(!i18n.includes("remediationCommand"), "i18n must not leak remediation command");
});

test("Hub final-delivery labels are bilingual and never claim Worker success", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // The English machine-outcome label must explicitly use the word "machine",
  // not "success", and the delivery label must use the word "delivery".
  assert.match(i18n, /statsMachineLabel['"]?\s*:\s*"[^"]*Machine[^"]*"/);
  assert.match(i18n, /statsFinalDeliveryLabel['"]?\s*:\s*"[^"]*[Ff]inal[^"]*[Dd]elivery[^"]*"/);
  // The semantic caveat must explicitly distinguish machine from delivery.
  assert.match(i18n,
    /statsProviderCaveat['"]?\s*:\s*"[^"]*[Mm]achine[^"]*[Dd]elivery[^"]*separate/i);
  // Chinese labels must not fall back to English and must keep the distinction.
  assert.match(i18n, /statsMachineLabel['"]?\s*:\s*"机器执行结果"/);
  assert.match(i18n, /statsFinalDeliveryLabel['"]?\s*:\s*"最终交付"/);
  // The badge must be visually distinguishable from the machine status badge.
  assert.ok(i18n.includes("taskFinalDeliveryBadge"),
    "compact delivery badge label exists");
  assert.match(i18n, /taskFinalDeliveryBadge['"]?\s*:\s*"verified delivery"/);
  assert.match(i18n, /taskFinalDeliveryBadge['"]?\s*:\s*"已核验交付"/);
});

test("Hub app.js renders collaboration journey with separate what and why", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // Journey renderer exists and has all six sections.
  assert.ok(src.includes("function renderTaskJourney"), "journey renderer present");
  assert.ok(src.includes('"journey-current"'), "live state section marker");
  assert.ok(src.includes('"journey-assignment"'), "assignment section marker");
  assert.ok(src.includes('"journey-worker"'), "worker execution section marker");
  assert.ok(src.includes('"journey-verification"'), "verification section marker");
  assert.ok(src.includes('"journey-delivery"'), "delivery section marker");
  assert.ok(src.includes('"journey-cause"'), "cause section marker");
  assert.ok(src.includes('"journey-next"'), "next action section marker");
  // What and why are always rendered separately (cause-what vs cause-why roles).
  assert.ok(src.includes('"cause-what"'), "what role marker");
  assert.ok(src.includes('"cause-why"'), "why role marker");
  // Worker claim is marked unverified.
  assert.ok(src.includes('"worker-claim"'), "worker claim role marker");
  assert.ok(src.includes("journeyWorkerClaimLabel"), "unverified claim i18n key");
  assert.ok(src.includes("journeyWorkerClaimDetails"), "raw Worker report is available on demand");
  assert.ok(src.includes("journeyAssignmentDetails"), "dense Main assignment details are available on demand");
  assert.ok(src.includes("journeyVerificationDetails"), "technical checks are available on demand");
  assert.ok(src.includes("hasVerifiedFinalDelivery(task)"), "verified delivery changes the user-facing current story");
  assert.ok(src.includes("taskManualActions"), "task controls are secondary to the readable journey");
  // Old story renderer is gone.
  assert.ok(!src.includes("function renderTaskStoryPanel"), "old story panel removed");
  assert.ok(!src.includes("function taskStoryResolve"), "old story resolver removed");
  // showTask uses the new journey renderer.
  assert.ok(src.includes("renderTaskJourney(task)"), "showTask calls journey renderer");
  // A translated next action is text. Returning a DOM element here and then
  // passing it through h(..., text) renders as "[object HTMLDivElement]".
  const nextActionStart = src.indexOf("function nextActionLabel");
  const nextActionEnd = src.indexOf("function ", nextActionStart + 1);
  const nextActionBlock = src.slice(nextActionStart, nextActionEnd > 0 ? nextActionEnd : src.length);
  assert.ok(nextActionBlock.includes("return t("), "next action resolver returns readable text");
  assert.ok(!nextActionBlock.includes("return h("), "next action resolver never returns a DOM element as text");
  // Technical details now include IDs and source moved from the top.
  const showTaskIdx = src.indexOf("function showTask(");
  assert.ok(showTaskIdx > 0);
  const showTaskEnd = src.indexOf("function ", showTaskIdx + 1);
  const showTaskBlock = src.slice(showTaskIdx, showTaskEnd > 0 ? showTaskEnd : src.length);
  assert.ok(showTaskBlock.includes("journeyTechnical"), "technical details use journey key");
  // ID and source are moved into technical details.
  assert.ok(showTaskBlock.includes("journeyTechId"), "ID in technical details");
  assert.ok(showTaskBlock.includes("journeyTechSource"), "source in technical details");
  assert.ok(showTaskBlock.includes("journeyTechSession"), "session in technical details");
});

test("Hub Task story executes the shared fixture as an ordered input-process-output journey", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const fixture = JSON.parse(await readFile(
    path.join(root, "tests", "fixtures", "hub-task-story-v1.json"),
    "utf8",
  )) as unknown;
  const startMarker = "/* TASK_STORY_ADAPTER_START */";
  const endMarker = "/* TASK_STORY_ADAPTER_END */";
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "pure story adapter has executable boundaries");
  const block = src.slice(start + startMarker.length, end);
  const adapter = new Function(`${block}\nreturn taskStoryPresentation;`)() as (
    task: unknown,
  ) => {
    repairedDelivery: boolean;
    summary: { state: string };
    steps: Array<{ id: string; state: string; value?: string; items?: string[]; noteKey?: string }>;
  };
  const view = adapter(fixture);
  assert.deepEqual(view.steps.map((step) => step.id), [
    "main-input", "worker-process", "worker-output",
    "main-check", "final-result", "cause", "next",
  ]);
  assert.equal(view.repairedDelivery, true);
  assert.equal(view.summary.state, "complete", "current result is a leading summary, not a numbered step");
  assert.match(view.steps.find((step) => step.id === "main-input")?.value ?? "", /understand what Main asked/i,
    "the concrete requested outcome is visible");
  assert.deepEqual(view.steps.find((step) => step.id === "main-input")?.items, [
    "Readable Task Detail", "Bilingual regression checks",
  ], "expected deliverables are visible");
  assert.equal(view.steps.find((step) => step.id === "worker-process")?.state, "failed",
    "machine failure remains visible");
  assert.equal(view.steps.find((step) => step.id === "worker-output")?.state, "failed",
    "rejected Worker output remains visible");
  assert.deepEqual(view.steps.find((step) => step.id === "worker-output")?.items, [
    "src/hub/public/app.js", "src/hub/public/i18n.js",
  ], "the Worker's concrete file output is visible");
  assert.deepEqual(view.steps.find((step) => step.id === "main-check")?.items, [
    "Project compilation",
  ], "failed checks are visible without opening technical evidence");
  assert.equal(view.steps.find((step) => step.id === "final-result")?.state, "complete",
    "Main-repaired verified delivery is a separate final fact");
  assert.match(view.steps.find((step) => step.id === "final-result")?.value ?? "", /corrected the compile issue/i,
    "Main's final handling is visible");
  assert.equal(view.steps.find((step) => step.id === "final-result")?.noteKey,
    "storyFinalFilesRepairedMissing", "missing repaired-file evidence is stated instead of guessed");

  const staleRunningAttempt = JSON.parse(JSON.stringify(fixture)) as {
    status: string;
    journey: { workerExecution: { attempts: Array<{ status: string }> }; independentVerification: { available: boolean } };
  };
  staleRunningAttempt.status = "failed";
  const staleAttempt = staleRunningAttempt.journey.workerExecution.attempts[0];
  assert.ok(staleAttempt, "fixture contains one Attempt");
  staleAttempt.status = "running";
  staleRunningAttempt.journey.independentVerification.available = false;
  const terminalView = adapter(staleRunningAttempt);
  assert.equal(terminalView.steps.find((step) => step.id === "worker-process")?.state, "failed",
    "terminal Task truth overrides a stale running Attempt state");
  assert.equal(terminalView.steps.find((step) => step.id === "worker-output")?.state, "failed",
    "recorded file differences are not shown as waiting after the Task has failed");

  assert.ok(src.includes("function renderTaskStory"));
  assert.ok(src.includes("function renderTaskWorkbench"), "full-page task workbench is shipped");
  assert.ok(src.includes('"task-story-flow"'));
  assert.ok(src.includes('"task-story-current-result"'));
  assert.ok(src.includes('"task-story-step-" + step.id'));
  assert.ok(src.includes('"task-workbench"'), "workbench role is present");
  assert.ok(src.includes("taskReportInstrTitle"), "instruction section uses plain-language key");
  assert.ok(src.includes("task-process-timeline"), "process timeline is surfaced openly");
  assert.ok(src.includes("detail-shell"), "detail uses full workbench shell not only a drawer strip");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(css.includes(".task-story-steps"));
  assert.ok(css.includes(".task-story-step:not(:last-child)::after"));
  assert.ok(css.includes(".task-report-hero"), "task report hero styles ship");
  assert.ok(css.includes(".task-report-card"), "open report cards ship");
  assert.ok(css.includes("left: var(--sidebar)"), "detail spans the workspace beside the nav");
  assert.match(css, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.task-story-step/);
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  for (const key of [
    "storyTitle", "storyInputTitle", "storyWorkerProcessTitle", "storyWorkerOutputTitle",
    "storyMainCheckTitle", "storyFinalTitle", "storyCauseTitle", "storyNextTitle",
    "storyInputDeliverablesLabel", "storyWorkerClaimLabel", "storyWorkerFilesLabel",
    "storyWorkerOutputTaskFailed", "storyFailedChecksLabel", "storyMainDecisionReasonLabel",
    "storyFinalFilesRepairedMissing",
    "taskReportInstrTitle", "taskReportProcessTitle", "taskReportResultTitle",
    "taskReportArtifactsTitle", "taskReportChecksTitle", "taskReportFinalTitle",
    "taskReportBack", "tlWorkerCompleted", "tlVerifCompleted",
  ]) {
    assert.ok(i18n.indexOf(key) !== i18n.lastIndexOf(key), `${key} exists in both locales`);
  }
  assert.ok(i18n.includes("Worker 收到的任务说明"), "zh instruction title is plain language");
  assert.ok(i18n.includes("What the Worker was asked to do"), "en instruction title is plain language");
  assert.ok(i18n.includes("活动记录"), "zh timeline label is plain language");
});

/* --- Task story adapter: fixture-driven journey coverage ---
 * The pure taskStoryPresentation adapter is extracted between executable
 * markers and exercised against controlled mutations of the canonical
 * fixture. Each scenario proves the ordered seven-step journey, the truthful
 * Worker output and independent-check states, the evidence-backed cause, and
 * a concrete next action - while the Main-authored presentation summary
 * leads when its exact safe shape is present. */
type StoryStep = {
  id: string;
  state: string;
  value?: string;
  valueLabelKey?: string;
  bodyKey?: string;
  authored?: boolean;
  language?: string;
  items?: string[];
  noteKey?: string;
  causeWhat?: string;
  failureCategory?: string;
  nextLabel?: string;
};
type StoryView = {
  repairedDelivery: boolean;
  summary: { state: string };
  steps: StoryStep[];
};
type StoryFixture = {
  status: string;
  journey: {
    assignment: {
      contractVersion: number;
      presentation?: { summary: string; language: string };
      outcome: string;
      deliverables: string[];
    };
    workerExecution: {
      attempts: Array<{
        status: string;
        startedAt?: string;
        finishedAt?: string;
        exitCode?: number;
        turns?: number;
      }>;
      workerClaim: { label: string; text: string };
      changedFilePaths: string[];
    };
    independentVerification: {
      available: boolean;
      checks: Array<{ label: string; passed: boolean; exitCode?: number }>;
      conclusion: string;
      failedCount: number;
      totalCount: number;
    };
    finalDelivery: {
      mainReview?: { decision: string; reason: string };
      remediationDisposition?: { status: string };
      integration?: { status: string; applied: boolean };
    };
    cause: { what: string; why: string; failureCategory: string };
    nextAction: { label: string };
  };
};
const STORY_STEP_IDS = [
  "main-input", "worker-process", "worker-output",
  "main-check", "final-result", "cause", "next",
];
let _storyAdapter: ((task: unknown) => StoryView) | null = null;
async function storyAdapter(): Promise<(task: unknown) => StoryView> {
  if (_storyAdapter) return _storyAdapter;
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const startMarker = "/* TASK_STORY_ADAPTER_START */";
  const endMarker = "/* TASK_STORY_ADAPTER_END */";
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "pure story adapter has executable boundaries");
  const block = src.slice(start + startMarker.length, end);
  _storyAdapter = new Function(`${block}\nreturn taskStoryPresentation;`)() as (task: unknown) => StoryView;
  return _storyAdapter;
}
async function storyFixture(): Promise<StoryFixture> {
  return JSON.parse(await readFile(
    path.join(root, "tests", "fixtures", "hub-task-story-v1.json"),
    "utf8",
  )) as StoryFixture;
}
function storyStep(view: StoryView, id: string): StoryStep {
  const s = view.steps.find((st) => st.id === id);
  if (!s) throw new Error(`story step ${id} missing`);
  return s;
}

test("Hub Task story adapter leads with the exact Main-authored summary and rejects guessed shapes", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const adapter = await storyAdapter();
  const base = await storyFixture();
  const summaryText = base.journey.assignment.presentation?.summary ?? "";
  assert.ok(summaryText, "fixture carries a Main-authored presentation summary");

  const view = adapter(base);
  assert.deepEqual(view.steps.map((s) => s.id), STORY_STEP_IDS, "ordered seven-step journey");
  const input = storyStep(view, "main-input");
  assert.equal(input.value, summaryText, "the exact Main-authored summary leads, unchanged");
  assert.equal(input.authored, true, "primary input is marked as Main-authored");
  assert.equal(input.language, "en", "summary language metadata is preserved for rendering");
  assert.equal(input.valueLabelKey, "storyInputMainAuthoredLabel", "authored label explains the source");
  assert.equal(input.bodyKey, "storyInputBodyAuthored", "authored body explains the source");

  // Reject alternate guessed presentation property names: a presentation
  // missing the canonical `summary` string must fall back to the outcome.
  const guessed = JSON.parse(JSON.stringify(base)) as StoryFixture;
  const loose = guessed as unknown as {
    journey: { assignment: { presentation?: Record<string, unknown>; outcome: string } };
  };
  loose.journey.assignment.presentation = { text: "guessed", language: "en" };
  const guessedView = adapter(guessed);
  const guessedInput = storyStep(guessedView, "main-input");
  assert.equal(guessedInput.authored, false, "a guessed presentation shape is not treated as authored");
  assert.equal(guessedInput.value, base.journey.assignment.outcome, "falls back to the honest technical outcome");
  assert.equal(guessedInput.valueLabelKey, "storyInputGoalLabel", "fallback uses the honest goal label");

  // Paired English and Chinese copy explains the Main-authored primary text,
  // and the language stays in the closed assignment evidence (not prominent).
  for (const key of [
    "storyInputBodyAuthored", "storyInputMainAuthoredLabel",
    "journeyPresentationLanguage", "journeyPresentationLanguageEn", "journeyPresentationLanguageZh",
  ]) {
    assert.ok(i18n.indexOf(key) !== i18n.lastIndexOf(key), `${key} exists in both locales`);
  }
  assert.ok(src.includes("storyInputBodyAuthored"), "renderer consumes the authored body key");
  assert.ok(src.includes("storyInputMainAuthoredLabel"), "renderer consumes the authored label key");
  assert.ok(src.includes("presentationLanguageLabel(a.presentation.language)"),
    "summary language is rendered inside the closed assignment evidence");
});

test("Hub Task story success journey keeps Worker output and checks complete", async () => {
  const adapter = await storyAdapter();
  const base = await storyFixture();
  const summaryText = base.journey.assignment.presentation?.summary ?? "";
  const task: StoryFixture = JSON.parse(JSON.stringify(base));
  task.status = "succeeded";
  const att = task.journey.workerExecution.attempts[0];
  assert.ok(att, "fixture has an attempt");
  att.status = "succeeded";
  att.exitCode = 0;
  task.journey.independentVerification = {
    available: true,
    checks: [
      { label: "Hub UI behavior checks", passed: true, exitCode: 0 },
      { label: "Project compilation", passed: true, exitCode: 0 },
    ],
    conclusion: "passed",
    failedCount: 0,
    totalCount: 2,
  };
  task.journey.finalDelivery = {
    mainReview: { decision: "accept", reason: "All checks passed and Main accepted the result." },
    integration: { status: "completed", applied: true },
  };
  task.journey.cause = {
    what: "succeeded",
    why: "The Worker completed and independent checks passed.",
    failureCategory: "",
  };
  task.journey.nextAction = { label: "done" };

  const view = adapter(task);
  assert.deepEqual(view.steps.map((s) => s.id), STORY_STEP_IDS, "success keeps the ordered seven-step journey");
  const input = storyStep(view, "main-input");
  assert.equal(input.value, summaryText, "success leads with the exact Main-authored summary");
  assert.equal(input.authored, true, "primary input is Main-authored");
  assert.equal(storyStep(view, "worker-process").state, "complete", "Worker process completed");
  assert.equal(storyStep(view, "worker-output").state, "complete", "Worker output was accepted");
  assert.equal(storyStep(view, "main-check").state, "complete", "all independent checks passed");
  assert.deepEqual(storyStep(view, "main-check").items, [], "no failed checks remain");
  assert.equal(storyStep(view, "final-result").state, "complete", "accepted and integrated final result");
  assert.equal(storyStep(view, "cause").causeWhat, "succeeded", "evidence-backed cause");
  assert.equal(storyStep(view, "next").nextLabel, "done", "next action is done");
  assert.equal(view.repairedDelivery, false, "success is not a Main-repaired delivery");
});

test("Hub Task story failed verification keeps rejected output and the failed check visible", async () => {
  const adapter = await storyAdapter();
  const base = await storyFixture();
  const summaryText = base.journey.assignment.presentation?.summary ?? "";
  const task: StoryFixture = JSON.parse(JSON.stringify(base));
  task.status = "failed";
  const att = task.journey.workerExecution.attempts[0];
  assert.ok(att, "fixture has an attempt");
  att.status = "succeeded";
  att.exitCode = 0;
  task.journey.independentVerification = {
    available: true,
    checks: [
      { label: "Hub UI behavior checks", passed: true, exitCode: 0 },
      { label: "Project compilation", passed: false, exitCode: 2 },
    ],
    conclusion: "failed",
    failedCount: 1,
    totalCount: 2,
  };
  task.journey.finalDelivery = {};
  task.journey.cause = {
    what: "failed",
    why: "Independent verification found a compile error in the Worker output.",
    failureCategory: "verification",
  };
  task.journey.nextAction = { label: "review" };

  const view = adapter(task);
  assert.deepEqual(view.steps.map((s) => s.id), STORY_STEP_IDS, "verification failure keeps the ordered journey");
  const input = storyStep(view, "main-input");
  assert.equal(input.value, summaryText, "the Main-authored summary still leads");
  assert.equal(input.authored, true, "primary input remains Main-authored");
  assert.equal(storyStep(view, "worker-output").state, "failed", "rejected Worker output remains failed");
  assert.equal(storyStep(view, "main-check").state, "failed", "verification failed");
  assert.deepEqual(storyStep(view, "main-check").items, ["Project compilation"], "the failed check is visible");
  assert.equal(storyStep(view, "cause").causeWhat, "failed", "evidence-backed cause");
  assert.equal(storyStep(view, "cause").failureCategory, "verification", "cause category is verification");
  assert.equal(storyStep(view, "next").nextLabel, "review", "next action asks Main to inspect or revise");
});

test("Hub Task story authentication failure points to credentials before useful work", async () => {
  const adapter = await storyAdapter();
  const base = await storyFixture();
  const task: StoryFixture = JSON.parse(JSON.stringify(base));
  task.status = "failed";
  const att = task.journey.workerExecution.attempts[0];
  assert.ok(att, "fixture has an attempt");
  att.status = "failed";
  att.exitCode = 1;
  att.turns = 0;
  task.journey.workerExecution.changedFilePaths = [];
  task.journey.workerExecution.workerClaim = { label: "unverified-claim", text: "" };
  task.journey.independentVerification = {
    available: false,
    checks: [],
    conclusion: "not-run",
    failedCount: 0,
    totalCount: 0,
  };
  task.journey.finalDelivery = {};
  task.journey.cause = {
    what: "failed",
    why: "The Provider rejected the API credentials before useful work.",
    failureCategory: "authentication",
  };
  task.journey.nextAction = { label: "credentials" };

  const view = adapter(task);
  assert.deepEqual(view.steps.map((s) => s.id), STORY_STEP_IDS, "auth failure keeps the ordered journey");
  assert.equal(storyStep(view, "main-input").authored, true, "the summary still leads to explain intent");
  assert.equal(storyStep(view, "worker-process").state, "failed", "process failed before useful work");
  assert.equal(storyStep(view, "worker-output").state, "empty", "no useful Worker output was produced");
  assert.equal(storyStep(view, "main-check").state, "waiting", "no independent checks ran");
  assert.equal(storyStep(view, "cause").failureCategory, "authentication", "cause is configuration, not coding quality");
  assert.equal(storyStep(view, "next").nextLabel, "credentials", "next action is to fix credentials");
});

test("Hub Task story active execution stays pending and tells the user to wait", async () => {
  const adapter = await storyAdapter();
  const base = await storyFixture();
  const task: StoryFixture = JSON.parse(JSON.stringify(base));
  task.status = "running";
  const att = task.journey.workerExecution.attempts[0];
  assert.ok(att, "fixture has an attempt");
  att.status = "running";
  delete att.exitCode;
  delete att.finishedAt;
  att.turns = 3;
  task.journey.independentVerification = {
    available: false,
    checks: [],
    conclusion: "not-run",
    failedCount: 0,
    totalCount: 0,
  };
  task.journey.finalDelivery = {};
  task.journey.cause = {
    what: "running",
    why: "The Worker is still executing the assignment.",
    failureCategory: "",
  };
  task.journey.nextAction = { label: "wait" };

  const view = adapter(task);
  assert.deepEqual(view.steps.map((s) => s.id), STORY_STEP_IDS, "active execution keeps the ordered journey");
  assert.equal(storyStep(view, "main-input").authored, true, "the summary still leads while running");
  assert.equal(storyStep(view, "worker-process").state, "running", "process is running");
  assert.equal(storyStep(view, "worker-output").state, "waiting", "output remains pending");
  assert.equal(storyStep(view, "main-check").state, "waiting", "checks remain pending");
  assert.equal(storyStep(view, "final-result").state, "waiting", "no final result yet");
  assert.equal(storyStep(view, "cause").causeWhat, "running", "cause reflects active execution");
  assert.equal(storyStep(view, "next").nextLabel, "wait", "next action is to wait, not retry");
});

test("Hub Task story legacy task without presentation falls back to the outcome", async () => {
  const adapter = await storyAdapter();
  const base = await storyFixture();
  const task: StoryFixture = JSON.parse(JSON.stringify(base));
  delete task.journey.assignment.presentation;

  const view = adapter(task);
  assert.deepEqual(view.steps.map((s) => s.id), STORY_STEP_IDS, "legacy task keeps the ordered journey");
  const input = storyStep(view, "main-input");
  assert.equal(input.authored, false, "legacy task is not marked Main-authored");
  assert.equal(input.value, base.journey.assignment.outcome, "legacy task falls back to the technical outcome");
  assert.equal(input.valueLabelKey, "storyInputGoalLabel", "legacy task uses the honest goal label");
  assert.equal(input.bodyKey, "storyInputBody", "legacy task uses the honest goal body");
  assert.equal(input.language, "", "legacy task carries no summary language");
  assert.equal(view.repairedDelivery, true, "legacy technical evidence is preserved");
  assert.equal(storyStep(view, "cause").failureCategory, "verification", "legacy cause evidence is preserved");
  assert.equal(storyStep(view, "next").nextLabel, "done", "legacy next action is preserved");
});

test("Hub primary Worker, Main, and verification summaries explain meaning before technical data", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");

  const workerStart = src.indexOf("function rWorker()");
  const workerEnd = src.indexOf("function rLimits()", workerStart);
  const workerBlock = src.slice(workerStart, workerEnd);
  assert.ok(workerBlock.includes("workersCardDefaultPurpose"), "Worker card explains when it is used");
  assert.ok(workerBlock.includes("workersCardRunsWith"), "Worker card explains model and runtime as a sentence");
  assert.ok(workerBlock.includes("workersCardNoProgressLimited"), "Worker card explains stop behavior");
  assert.ok(workerBlock.includes("workersCardAttempts"), "Worker card explains correction attempts");
  assert.ok(workerBlock.includes("workersCardAttemptsNoExtra"), "zero correction attempts are phrased as behavior, not 0 jargon");
  assert.ok(workerBlock.includes("workersCardAdaptationOff"), "Worker card explains automatic follow-up behavior");
  assert.ok(workerBlock.includes("workersCardTechnicalDetails"), "raw identifiers remain in a secondary disclosure");
  assert.ok(!workerBlock.includes('"budget " +'), "raw compact budget string is not primary copy");
  assert.ok(!workerBlock.includes('" · no-progress "'), "raw no-progress token is not primary copy");

  const mainStart = src.indexOf("function rMains()");
  const mainEnd = src.indexOf("function switchTab", mainStart);
  const mainBlock = src.slice(mainStart, mainEnd);
  assert.ok(mainBlock.includes("mainCardUsable"), "Main card says whether the client can be used");
  assert.ok(mainBlock.includes("mainCardDisconnected"), "Main card says what to do when disconnected");
  assert.ok(mainBlock.includes("mainTechnicalLocation"), "Main file paths are secondary technical details");
  assert.ok(!mainBlock.includes("m.message ||"), "raw Plugin/MCP/Skill yes-no summary is not primary copy");

  const journeyStart = src.indexOf("function renderTaskJourney");
  const journeyEnd = src.indexOf("function resolveCauseWhat", journeyStart);
  const journeyBlock = src.slice(journeyStart, journeyEnd);
  const failedSummaryAt = journeyBlock.indexOf("journeyFailedChecksTitle");
  const allChecksAt = journeyBlock.indexOf("journeyVerificationDetails");
  assert.ok(failedSummaryAt > 0 && allChecksAt > failedSummaryAt,
    "failed checks are explained before the full technical check list");
  assert.ok(journeyBlock.includes('"verification-failure-summary"'), "failed-check summary has a stable role");
  assert.ok(journeyBlock.includes("journeyNextVerification"), "verification failure has a concrete next action");
  assert.ok(journeyBlock.includes("journeyWorkerIdentitySentence"), "Worker identity is rendered as a readable sentence");
  assert.ok(journeyBlock.includes("journeyDeliveryMainReviewDetails"),
    "Main's original review note is available without becoming primary copy");

  for (const key of [
    "workersCardDefaultPurpose", "workersCardBudgetUnlimited", "workersCardAttemptsNoExtra",
    "mainCardUsable", "mainCardDisconnected", "journeyFailedChecksTitle",
    "journeyCheckUiContract", "journeyNextVerification", "journeyWorkerIdentitySentence",
    "journeyDeliveryMainReviewDetails",
  ]) {
    assert.ok(i18n.indexOf(key) !== i18n.lastIndexOf(key), `${key} exists in both locales`);
  }
  assert.ok(css.includes(".profile-story"), "readable Worker summary has visual hierarchy");
  assert.ok(css.includes(".journey-failed-checks"), "failed checks are visually grouped");
});

test("Hub board and overview use localized explanatory labels instead of raw internal strings", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  for (const key of [
    "taskLaneQueued", "taskLaneWorking", "taskLaneDone", "taskLaneFailed",
    "taskBoardCount", "competitionProgress", "planProgressCompact",
    "topWorkers", "topQueue", "topCap", "updatedAt",
  ]) {
    assert.ok(src.includes(`t("${key}"`), `UI consumes ${key}`);
    assert.ok(i18n.includes(key), `i18n contains ${key}`);
  }
  assert.ok(!src.includes('tasks.length + " tasks on board"'), "board count is not hard-coded English");
  assert.ok(!src.includes('cardHead(task.name, task.id'), "overview cards do not foreground internal Task ids");
  assert.ok(!src.includes('(task.error || t("ovOpenDetails"))'), "overview does not expose raw machine errors");
});

test("Hub app.js renders what and why as distinct sentences in every cause path", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // resolveCauseWhat and resolveCauseWhy are separate functions
  assert.ok(src.includes("function resolveCauseWhat"), "what resolver is separate");
  assert.ok(src.includes("function resolveCauseWhy"), "why resolver is separate");
  // Every cause path has distinct what and why key
  assert.ok(src.includes("journeyCauseWhatSucceeded"), "succeeded what");
  assert.ok(src.includes("journeyCauseWhySucceeded"), "succeeded why");
  assert.ok(src.includes("journeyCauseWhatRunning"), "running what");
  assert.ok(src.includes("journeyCauseWhyRunning"), "running why");
  assert.ok(src.includes("journeyCauseWhatQueued"), "queued what");
  assert.ok(src.includes("journeyCauseWhyQueued"), "queued why");
  assert.ok(src.includes("journeyCauseWhyAuth"), "auth why");
  assert.ok(src.includes("journeyCauseWhyBudget"), "budget why");
  assert.ok(src.includes("journeyCauseWhyRuntime"), "runtime why");
  assert.ok(src.includes("journeyCauseWhyVerification"), "verification why");
  assert.ok(src.includes("journeyCauseWhyUnknown"), "unknown why");
  // failureCategoryLabel maps raw categories to readable i18n keys
  assert.ok(src.includes("function failureCategoryLabel"), "category label function");
  assert.ok(src.includes("journeyFailureAuth"), "auth label i18n key");
  assert.ok(src.includes("journeyFailureBudget"), "budget label i18n key");
  assert.ok(src.includes("journeyFailureRuntime"), "runtime label i18n key");
  assert.ok(src.includes("journeyFailureVerification"), "verification label i18n key");
  assert.ok(src.includes("journeyFailureUnknown"), "unknown label i18n key");
});

test("Hub i18n carries journey keys in both languages and what/why never duplicate", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // All journey section titles present in both languages
  for (const key of [
    "journeyTitle", "journeyCurrentState", "journeyAssignment", "journeyWorkerExecution", "journeyVerification",
    "journeyDelivery", "journeyCause", "journeyNext", "journeyTechnical",
  ]) {
    assert.ok(i18n.includes(key), `en ${key} present`);
  }
  // Chinese translations present
  assert.ok(i18n.includes("更多细节（可选）"), "zh journey evidence title stays plain language");
  assert.ok(i18n.includes("Main 输入"), "zh assignment");
  assert.ok(i18n.includes("Worker 执行"), "zh worker execution");
  assert.ok(i18n.includes("独立验证"), "zh verification");
  assert.ok(i18n.includes("最终输出与交付"), "zh delivery");
  assert.ok(i18n.includes("发生了什么及原因"), "zh cause");
  assert.ok(i18n.includes("下一步该怎么做"), "zh next");
  // What/why keys exist separately
  for (const key of [
    "journeyCauseWhatSucceeded", "journeyCauseWhySucceeded",
    "journeyCauseWhatRunning", "journeyCauseWhyRunning",
    "journeyCauseWhatQueued", "journeyCauseWhyQueued",
    "journeyCauseWhatFailed",
    "journeyCauseWhyAuth", "journeyCauseWhyBudget", "journeyCauseWhyRuntime",
    "journeyCauseWhyVerification", "journeyCauseWhyUnknown",
  ]) {
    assert.ok(i18n.includes(key), `separate what/why key ${key} present`);
  }
  // Chinese what/why translations present
  assert.ok(i18n.includes("任务已完成工作"), "zh succeeded what");
  assert.ok(i18n.includes("Worker 完成，独立检查通过，结果已就绪"), "zh succeeded why");
  assert.ok(i18n.includes("任务未能成功完成"), "zh failed what");
  assert.ok(i18n.includes("Provider 拒绝了 API 凭证"), "zh auth why");
  assert.ok(i18n.includes("Token 或预算达到上限"), "zh budget why");
  for (const key of [
    "journeyFinalOutputLabel", "journeyFinalOutputVerified",
    "journeyFinalOutputRejected", "journeyFinalOutputPending",
    "journeyFinalOutputNone", "journeyFinalOutputRepairedDelivered",
  ]) {
    assert.ok(i18n.includes(key), `final output key ${key} present`);
  }
  // En what and why keys produce different values (not the same string).
  // The en succeeded what/why must read as distinct sentences.
  const enBlock = i18n.slice(i18n.indexOf("en:"));
  const enBlockEnd = i18n.indexOf("zh:", enBlock.indexOf("en:") + 3);
  const enSection = i18n.slice(i18n.indexOf("en:"), enBlockEnd > 0 ? enBlockEnd : i18n.length);
  const whatMatch = /journeyCauseWhatSucceeded['"]?\s*:\s*"([^"]+)"/.exec(enSection);
  const whyMatch = /journeyCauseWhySucceeded['"]?\s*:\s*"([^"]+)"/.exec(enSection);
  if (whatMatch && whyMatch) {
    assert.notEqual(whatMatch[1], whyMatch[1], "succeeded what and why must be different sentences");
  }
  // Legacy pageGuide keys remain for limits and compatibility.
  for (const key of [
    "pageGuideOverview", "pageGuideTasks", "pageGuidePlans", "pageGuideCompetitions",
    "pageGuideInsights", "pageGuideModels", "pageGuideWorkers", "pageGuideMains", "pageGuideLimits",
  ]) {
    assert.ok(i18n.includes(key), `page guide key ${key} present`);
  }
  assert.ok(i18n.includes("显示服务栈健康"), "zh page guide");
  // Journey failure labels remain readable in technical details.
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("journeyFailureAuth") || src.includes("failureCategoryLabel"),
    "failure categories use readable i18n labels");
});

test("Hub server journey projection is wired into task detail endpoint", async () => {
  const serverSrc = await readFile(path.join(root, "src", "hub", "server.ts"), "utf8");
  // The journey function is imported or defined.
  assert.ok(serverSrc.includes("buildSafeTaskJourney"), "journey builder function present");
  // The task detail endpoint includes journey in its response.
  const tdIdx = serverSrc.indexOf("const td = opsRoute.match(/^\\/tasks\\/(.+)$/);");
  assert.ok(tdIdx > 0);
  const tdEnd = serverSrc.indexOf("return;\n      }", tdIdx);
  const tdBlock = serverSrc.slice(tdIdx, tdEnd > 0 ? tdEnd : serverSrc.length);
  assert.ok(tdBlock.includes("journey"), "task detail response includes journey field");
  assert.ok(tdBlock.includes("buildSafeTaskJourney(task, decision, inspect)"),
    "journey is built from task, decision, and inspected execution evidence");
  // The safe journey does not expose sourcePath, sessionId, raw logs, diffs, credentials.
  const journeyFnIdx = serverSrc.indexOf("export function buildSafeTaskJourney");
  assert.ok(journeyFnIdx > 0);
  const nextExport = serverSrc.indexOf("export ", journeyFnIdx + 1);
  const journeyFnBlock = serverSrc.slice(journeyFnIdx, nextExport > 0 ? nextExport : serverSrc.length);
  assert.ok(!/sourcePath/.test(journeyFnBlock), "journey projection does not expose sourcePath");
  assert.ok(!/sessionId/.test(journeyFnBlock), "journey projection does not expose sessionId");
  assert.ok(!/rawLogPath/.test(journeyFnBlock), "journey projection does not expose rawLogPath");
  assert.ok(!/keychainService/.test(journeyFnBlock), "journey projection does not expose keychainService");
  assert.ok(!/\.secret/.test(journeyFnBlock), "journey projection does not expose secrets");
});

/* Secondary-workflow localization: split the i18n bundle into en and zh
 * sections so a key can be asserted in both languages without mistaking
 * string presence in one section for bilingual coverage. */
function splitI18n(i18n: string): { enSection: string; zhSection: string } {
  const enStart = i18n.indexOf("en:");
  const zhStart = i18n.indexOf("zh:", enStart + 3);
  const enSection = i18n.slice(enStart, zhStart > 0 ? zhStart : i18n.length);
  const zhSection = i18n.slice(zhStart > 0 ? zhStart : 0);
  return { enSection, zhSection };
}

test("Hub top-level pages lead with purpose and share an input-process-output-next narrative", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  assert.ok(src.includes("function renderPageStory"), "shared page-story renderer");
  assert.ok(src.includes('data-fl-role", "page-story"') || src.includes("data-fl-role\", \"page-story\""),
    "page-story role marker");

  // Eight top-level pages bind the shared renderer (not keys alone).
  const pageBindings: Array<{ page: string; renderer: string; denseMarker: string }> = [
    { page: "overview", renderer: "rOverview", denseMarker: "rReadiness" },
    { page: "board", renderer: "rTasks", denseMarker: "taskSubmitTitle" },
    { page: "plans", renderer: "rPlans", denseMarker: "noPlans" },
    { page: "compete", renderer: "rCompetitions", denseMarker: "noCompetitions" },
    { page: "insights", renderer: "rStats", denseMarker: "econEvidenceSectionTitle" },
    { page: "models", renderer: "rModel", denseMarker: "modelCatalog" },
    { page: "workers", renderer: "rWorker", denseMarker: "workerProfiles" },
    { page: "main", renderer: "rMains", denseMarker: "mains" },
  ];
  for (const { page, renderer, denseMarker } of pageBindings) {
    const fnIdx = src.indexOf(`function ${renderer}()`);
    assert.ok(fnIdx > 0, `${renderer} present`);
    const nextFn = src.indexOf("\nfunction ", fnIdx + 1);
    const block = src.slice(fnIdx, nextFn > 0 ? nextFn : src.length);
    const storyCall = `renderPageStory("${page}")`;
    assert.ok(block.includes(storyCall), `${renderer} calls ${storyCall}`);
    const storyAt = block.indexOf(storyCall);
    const denseAt = block.indexOf(denseMarker);
    assert.ok(denseAt > 0, `${renderer} still renders dense content (${denseMarker})`);
    assert.ok(storyAt < denseAt, `${renderer} places page story before dense content`);
  }

  // Slot labels + every page x slot key in both locales.
  const labels = [
    "pageStoryLabelPurpose",
    "pageStoryLabelInput",
    "pageStoryLabelProcess",
    "pageStoryLabelOutput",
    "pageStoryLabelNext",
  ];
  for (const key of labels) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  const pages = ["Overview", "Board", "Plans", "Compete", "Insights", "Models", "Workers", "Main"];
  const slots = ["Purpose", "Input", "Process", "Output", "Next"];
  for (const page of pages) {
    for (const slot of slots) {
      const key = `pageStory${page}${slot}`;
      assert.ok(enSection.includes(key), `en ${key}`);
      assert.ok(zhSection.includes(key), `zh ${key}`);
    }
  }

  // Plain-language concept explanations where they first matter.
  assert.match(
    enSection,
    /pageStoryCompeteInput['"]?\s*:\s*"[^"]*same[^"]*Task[^"]*Workers[^"]*not a live debate/i,
  );
  assert.ok(zhSection.includes("不是模型之间的实时辩论"), "zh competition is not a live debate");
  assert.match(
    enSection,
    /pageStoryWorkersPurpose['"]?\s*:\s*"[^"]*reusable execution presets/i,
  );
  assert.ok(zhSection.includes("可复用的执行预设"), "zh worker preset purpose");
  assert.match(
    enSection,
    /pageStoryMainPurpose['"]?\s*:\s*"[^"]*Main coding client/i,
  );
  assert.match(
    enSection,
    /pageStoryInsightsNext['"]?\s*:\s*"[^"]*unavailable evidence as unknown, not zero/i,
  );
  assert.ok(zhSection.includes("不可用证据当作未知，而不是零"), "zh missing-proof limit");
  assert.match(
    enSection,
    /pageStoryInsightsPurpose['"]?\s*:\s*"[^"]*Token evidence[^"]*(?:without|not) treating estimates as bills/i,
  );

  // Responsive presentation: purpose leads; four connected parts follow and collapse on narrow screens.
  assert.ok(css.includes(".page-story-purpose"), "purpose is a visually leading summary");
  assert.ok(css.includes(".page-story-purpose-body"), "purpose copy has its own hierarchy");
  assert.match(
    css,
    /\.page-story-flow\s*\{[^}]*grid-template-columns\s*:\s*repeat\(\s*4\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/i,
  );
  assert.ok(css.includes(".page-story-slot"), "page-story slot style");
  assert.ok(css.includes(".page-story-marker"), "ordered flow marker style");
  assert.ok(css.includes(".page-story-label"), "page-story label style");
  assert.ok(css.includes(".page-story-body"), "page-story body style");
  assert.match(
    css,
    /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{[\s\S]*?\.page-story-flow\s*\{[^}]*grid-template-columns\s*:\s*1fr/i,
  );
});

test("Hub flexible policy modes render localized labels and preserve canonical values", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  // Canonical backend values are the only option values; they are never renamed.
  const pmIdx = src.indexOf("POLICY_MODE_VALUES");
  assert.ok(pmIdx > 0, "POLICY_MODE_VALUES constant present");
  const pmEnd = src.indexOf(";", pmIdx);
  const pmDecl = src.slice(pmIdx, pmEnd > 0 ? pmEnd : src.length);
  for (const m of ["hard", "warn", "score", "off"]) {
    assert.ok(pmDecl.includes(`"${m}"`), `canonical mode ${m} preserved`);
  }
  assert.ok(src.includes("function buildPolicyModeSelect"), "shared mode select builder");
  assert.ok(src.includes("o.value = m"), "option value stays the canonical mode");
  assert.ok(src.includes("function policyModeOptionText"), "localized option text helper");
  assert.ok(src.includes("function policyModeLabel"), "localized display helper for previews");
  // The adaptation patch path still validates the canonical values unchanged.
  assert.ok(src.includes('["hard","warn","score","off"].indexOf(raw)'),
    "adaptation patch validation keeps canonical mode set");
  // Explanations: intro before controls and the safety boundary note.
  assert.ok(src.includes('t("policyModeIntro")'), "intro explanation rendered");
  assert.ok(src.includes('t("policyModeSafetyNote")'), "safety boundary note rendered");
  assert.ok(src.includes("function policyModeNote"), "note helper co-locates explanation with controls");
  // Bilingual coverage of every mode label and effect hint.
  for (const key of [
    "policyModeIntro", "policyModeHard", "policyModeHardHint",
    "policyModeWarn", "policyModeWarnHint", "policyModeScore", "policyModeScoreHint",
    "policyModeOff", "policyModeOffHint", "policyModeSafetyNote",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  // The safety note explicitly states these modes do not disable the gates.
  assert.match(enSection, /policyModeSafetyNote['"]?\s*:\s*"[^"]*Safety[^"]*verification[^"]*review[^"]*[Ii]ntegration/i);
  assert.ok(zhSection.includes("不会关闭安全检查"), "zh safety boundary");
});

test("Hub advanced and adaptation mode selects use the localized builder", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // Worker Advanced settings and the Task adaptation panel both use the
  // shared builder so the two cannot drift apart.
  assert.ok(src.includes("buildPolicyModeSelect(null)"),
    "advanced fields use the localized mode builder");
  // The adaptation panel preserves the opt-in markers and the data-adv-value
  // hook used by the patch collector; only display text changed.
  assert.ok(src.includes("data-adapt-value"), "adaptation value marker retained");
  assert.ok(src.includes("data-adapt-enable"), "adaptation opt-in marker retained");
  // Previews localize the canonical mode value instead of showing raw ids.
  assert.ok(src.includes("policyModeLabel(r.value)"),
    "worker preview localizes mode value display");
  assert.ok(src.includes("policyModeLabel(after)"),
    "adaptation preview localizes mode value display");
});

test("Hub plan, competition, integration detail drawers consume localization keys", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  const planKeys = [
    "planDetailLoading", "planDetailExplain", "planDetailUpdated",
    "planLaneQueued", "planLaneActive", "planLaneBlocked", "planLaneFailed",
    "planLaneCompleted", "planItemNotStarted", "planItemDepsStates",
  ];
  const compKeys = [
    "compDetailLoading", "compDetailExplain", "compDetailProgress",
    "compColCandidate", "compColProvider", "compColModel", "compColStatus",
    "compColStarted", "compColFinished", "compEvalTitle",
    "compEvalExplain", "compEvalColEligible", "compEvalColScore",
    "compRecommendationTitle", "compRecommendationBody", "compRecommendationReason",
    "compNoRecommendation", "compNoRecommendationHint", "compNoCandidates",
    "compEligible", "compNotEligible", "compTechnicalId",
    "compTechnicalCandidate", "compTechnicalDisqualification", "compBack",
  ];
  const integKeys = [
    "integHistoryLoading", "integHistoryTitle", "integHistoryExplain",
    "integReceiptsTitle", "integResultsTitle", "integColFiles",
    "integColCreated", "integColStatus", "integColApplied",
    "integNoReceipts", "integNoResults", "integTechnicalReceipt",
    "integTechnicalResult",
  ];
  for (const key of [...planKeys, ...compKeys, ...integKeys]) {
    assert.ok(new RegExp(`t\\("${key}"[,)]`).test(src), `renderer consumes ${key}`);
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  // Prominent raw English and raw failure text are gone from the drawers.
  assert.ok(!src.includes('loadingDetail("Loading '),
    "drawer loading messages are localized, not hard-coded English");
  assert.ok(!src.includes('stateMsg("error", "Failed: " + e.message)'),
    "drawer failures no longer show raw 'Failed: ' + message prominently");
});

test("Hub competition without a confident winner does not imply the first candidate won", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  // The renderer shows the no-recommendation branch whenever the evaluation
  // lacks a recommendation, and never silently treats the first candidate
  // as the winner.
  assert.ok(src.includes('t("compNoRecommendation")'),
    "no-recommendation summary is rendered");
  assert.ok(src.includes('t("compNoRecommendationHint")'),
    "no-recommendation hint is rendered");
  assert.ok(src.includes("ev.recommendation"),
    "recommendation presence gates the no-recommendation branch");
  // English and Chinese both state the first listed candidate is not the winner.
  assert.match(enSection,
    /compNoRecommendationHint['"]?\s*:\s*"[^"]*first listed candidate is not the winner/i);
  assert.ok(zhSection.includes("列表中第一个候选并非胜出者"),
    "zh no-recommendation hint disclaims the first candidate");
});

test("Hub decision panel consumes localization keys while keeping concept literals", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  assert.ok(src.includes("function decLabel"),
    "decision label helper renders the localized title with an English fallback");
  // The six canonical decision concepts remain in the source (as fallbacks),
  // satisfying the decision-drawer concept invariant.
  for (const label of [
    "Worker claim (unverified)",
    "Independent verification",
    "Main agent review",
    "User authorization",
    "Integration and activation",
    "Next action",
  ]) {
    assert.ok(src.includes(label), `decision concept literal retained: ${label}`);
  }
  // The renderer threads the concepts through decLabel with paired i18n keys.
  const decLabels = [
    "decNextActionSection", "decCurrentStage", "decNextActionLabel", "decWhoWrote",
    "decWorker", "decWorkerClaim", "decIndepVerif", "decOverall", "decBehavior",
    "decPolicy", "decSourceCompat", "decEvidence", "decMainReview", "decDecision",
    "decReason", "decUserAuth", "decIntegGate",
    "decIntegActivation", "decOperation", "decOperationStatus",
    "decIntegration", "decLineage", "decAttempts",
    "decCorrectionAttempts", "decCombinedDiff",
  ];
  for (const key of decLabels) {
    assert.ok(new RegExp(`decLabel\\("${key}",`).test(src), `decision label consumes ${key}`);
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  // Localized status values replace raw Passed/Failed/Unavailable defaults.
  assert.ok(src.includes('v.passed ? t("decPassed") : t("decFailed")'),
    "verification outcomes use localized Pass/Fail");
  assert.ok(src.includes('t("decUnavailable")'), "decision row default is localized");
  assert.ok(src.includes('t("decNotRecorded")') && src.includes('t("decNotStarted")'),
    "decision empty states use localized values");
  assert.ok(src.includes('t("decGateExercised")') && src.includes('t("decGateNotExercised")'),
    "integration gate states use localized values");
});

test("Hub drawer failures show a localized summary with bounded diagnostic in closed details", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  assert.ok(src.includes("function detailErrorFragment"),
    "drawer failure helper builds a summary plus closed technical detail");
  for (const key of [
    "planDetailLoadFailed", "compDetailLoadFailed",
    "integHistoryLoadFailed", "taskDetailLoadFailed",
  ]) {
    assert.ok(src.includes(`detailErrorFragment("${key}"`),
      `${key} drives the prominent localized summary`);
    assert.ok(enSection.includes(key) && zhSection.includes(key), `${key} bilingual`);
  }
  // Diagnostics remain useful but are capped and kept inside a closed
  // disclosure so a service cannot flood the prominent UI.
  assert.ok(src.includes('t("detailTechError")'),
    "closed technical disclosure has a localized summary");
  assert.ok(src.includes("function appendBoundedDetail"),
    "adaptation retains bounded diagnostic in a closed disclosure");
  assert.ok(src.includes("function boundedDiagnostic"),
    "one shared boundary caps all UI diagnostics");
  assert.ok(src.includes("text.length > 800") && src.includes("text.slice(0, 797)"),
    "diagnostics have a stable maximum display length");
  // Action failures (supervise, review, integration, adaptation) show a
  // localized summary in the flash and keep the bounded detail secondary.
  assert.ok(src.includes('flashError(t("taskActionFailed")'),
    "action failure shows localized summary");
  assert.ok(src.includes('t("taskAdaptPreviewFailed")') && src.includes('t("taskAdaptApplyFailed")'),
    "adaptation preview/apply failures use localized summaries");
  assert.ok(enSection.includes("taskActionFailed") && zhSection.includes("taskActionFailed"),
    "taskActionFailed bilingual");
});

test("Hub model routing renders bilingual explanation-first UI with safe controls", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  assert.doesNotThrow(() => new Function(src), "Hub app.js must parse before static UI assertions");

  // Renderer and state
  assert.ok(src.includes("function renderModelRoutingSection"), "routing section renderer");
  assert.ok(src.includes("function renderMrResult"), "routing result renderer");
  assert.ok(src.includes("function buildMrReasons"), "reasons builder");
  assert.ok(src.includes("S.mrResult"), "routing result state");
  assert.ok(src.includes("S.mrDirty"), "dirty state variable");
  assert.ok(src.includes("S.mrEvaluating"), "evaluating state variable");

  // Explanation-first: what is being decided
  assert.ok(src.includes('t("mrWhatIsDecided")'), "what is decided explanation");
  assert.ok(src.includes('t("mrWhatIsDecidedBody")'), "what is decided body");

  // Policy editor controls exist
  for (const key of [
    "mrPolicyMinSamples", "mrPolicyUncertainty", "mrPolicyCompetition",
    "mrPolicyAcceptedDelivery", "mrPolicyVerifiedBehavior", "mrPolicyModelQualityFailure",
    "mrPolicyCorrectionChurn", "mrPolicyOfficialCost", "mrPolicyDuration",
    "mrPolicyBudgetReliability",
  ]) {
    assert.ok(src.includes(key), `policy key ${key} in source`);
  }

  // Save and evaluate are separate
  assert.ok(src.includes('t("mrSavePrefs")'), "save preferences button");
  assert.ok(src.includes('t("mrEvaluate")'), "evaluate button");
  assert.ok(src.includes('t("mrPrefsUnsaved")'), "unsaved badge");
  assert.ok(src.includes("/api/ops/model-routing"), "evaluate calls bridge");
  assert.ok(src.includes("/api/settings"), "save calls settings API");

  // Candidate selection from catalog
  assert.ok(src.includes('t("mrCandidatesTitle")'), "candidates section");
  assert.ok(src.includes('t("mrTaskClassLabel")'), "task class input label");
  assert.ok(src.includes("mr-candidates-select"), "candidate multi-select");
  assert.ok(src.includes('t("mrCandidatesMinError")'), "min candidates error");

  // Result rendering: conclusion-first
  assert.ok(src.includes('t("mrConclusionTitle")'), "conclusion section");
  assert.ok(src.includes('t("mrRecommendation",'), "recommendation display");
  assert.ok(src.includes('t("mrNoRecommendation")'), "no recommendation display");
  assert.ok(src.includes('t("mrMissingComparableEvidence")'), "missing comparable evidence is explained");
  assert.ok(src.includes('t("mrRecommendationOverride")'), "override note");

  // Per-candidate evidence
  assert.ok(src.includes('t("mrPerCandidateTitle")'), "per-candidate section");
  assert.ok(src.includes('t("mrCandidateEvidence",'), "candidate evidence format");

  // Ignored non-model failures
  assert.ok(src.includes('t("mrIgnoredNonModelTitle")'), "ignored non-model section");
  assert.ok(src.includes('t("mrIgnoredNonModelSummary",'), "ignored non-model explanation");

  // Next action
  assert.ok(src.includes('t("mrNextActionTitle")'), "next action section");
  assert.ok(src.includes('t("mrNextActionMainChooses")'), "main chooses action");

  // Technical disclosure
  assert.ok(src.includes('t("mrTechnicalDetail")'), "technical disclosure");
  assert.ok(src.includes('data-fl-role", "mr-technical'), "technical disclosure marker");

  // Invariant note
  assert.ok(src.includes('t("mrInvariantNote")'), "invariant note");

  // Routing section must not contain mutating-operation references
  var mrStart = src.indexOf("function renderModelRoutingSection");
  var mrEnd = src.indexOf("function rWorker", mrStart);
  var mrBlock = src.slice(mrStart, mrEnd > 0 ? mrEnd : src.length);
  assert.ok(!mrBlock.includes("provider_probe"), "routing section must not invoke provider_probe");
  assert.ok(!mrBlock.includes("submit_file"), "routing section must not reference submit_file");
  assert.ok(!mrBlock.includes("settings_update"), "routing section must not reference settings_update");
  assert.ok(!mrBlock.includes("competition_compare"), "routing section must not reference competition");

  // Bilingual coverage
  for (const key of [
    "mrSectionTitle", "mrSectionBody", "mrWhatIsDecided", "mrWhatIsDecidedBody",
    "mrPolicyTitle", "mrPolicyAdvancedTitle", "mrPolicyWeightsTitle", "mrCandidatesTitle", "mrTaskClassLabel",
    "mrEvaluate", "mrSavePrefs", "mrConclusionTitle", "mrNoRecommendation",
    "mrCompetitionSuggested", "mrPerCandidateTitle", "mrIgnoredNonModelTitle",
    "mrIgnoredNonModelSummary", "mrFactorUsed", "mrFactorNotUsed",
    "mrFactorMissingEvidence", "mrNextActionTitle", "mrTechnicalDetail",
    "mrResolvedPolicyTitle", "mrInvariantNote", "mrMissingComparableEvidence", "mrPageGuide",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }

  // Chinese translations are real, not English fallback
  assert.ok(zhSection.includes("模型路由建议"), "zh section title");
  assert.ok(zhSection.includes("ForkLight 比较各 Provider"), "zh section body");
  assert.ok(zhSection.includes("证据偏好"), "zh policy title");
  assert.ok(zhSection.includes("评估建议"), "zh evaluate button");
  assert.ok(zhSection.includes("保存偏好"), "zh save button");
  assert.ok(zhSection.includes("ForkLight 推荐"), "zh recommendation");
  assert.ok(zhSection.includes("Main 可以推翻"), "zh override note");
  assert.ok(zhSection.includes("始终不变"), "zh invariant note");
  assert.ok(zhSection.includes("证据不足"), "zh insufficient samples");

  // Missing evidence is never zero
  assert.ok(i18n.includes("missing-not-zero") || i18n.includes("缺失"), "missing-not-zero concept");

  // CSS
  assert.ok(css.includes(".mr-section"), "routing section CSS");
  assert.ok(css.includes(".mr-policy-grid"), "policy grid CSS");
  assert.ok(css.includes(".mr-conclusion"), "conclusion card CSS");
  assert.ok(css.includes(".mr-candidate-card"), "candidate card CSS");
  assert.ok(css.includes(".mr-ignored"), "ignored failures CSS");
  assert.ok(css.includes(".mr-next-action"), "next action CSS");
  // Narrow viewport collapse
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{[^}]*\.mr-policy-grid[^}]*\}/);
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{[^}]*\.mr-candidate-factors[^}]*\}/);
  assert.ok(src.includes("fl-mr-missingEvidenceMode"), "missing-evidence policy select");
  assert.ok(src.includes("result.omittedFactors"), "omitted evidence is rendered from the advisory");
  assert.ok(src.includes("mrFlexibleRecommendationCaveat"), "flexible recommendation carries a visible caveat");
  assert.ok(src.includes("patch.modelRouting.missingEvidenceMode"), "policy saves through Hub settings");
  assert.ok(i18n.includes("mrMissingEvidenceFlexible"));
  assert.ok(i18n.includes("继续比较，并明确提示缺口"));
  assert.ok(i18n.includes("Some evidence did not participate"));
});

test("Hub model routing budget reliability factor has bilingual plain-language copy and is not a bill", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  // The factor appears in the editable weight key list and renders as a plain
  // language plain-language field, not a Provider bill or model-quality claim.
  assert.ok(src.includes('["budgetReliability", "mrPolicyBudgetReliability"'),
    "budgetReliability is part of the editable weight key list");
  assert.ok(src.includes("function budgetReliabilityReasonKey"),
    "plain-language reason helper exists");
  assert.ok(src.includes("mrBudgetReliabilitySummary"),
    "explanation-first summary is rendered");
  assert.ok(src.includes("mrBudgetReliabilityFact"),
    "actual comparable run counts are rendered");
  assert.ok(src.includes("budgetEnvelopeText(br.envelope)"),
    "the effective comparison limit is rendered");
  assert.ok(src.includes('reasonKey || "mrBudgetReliabilityUnavailable"'),
    "unknown reasons fall back to plain-language copy");
  for (const key of [
    "mrPolicyBudgetReliability", "mrPolicyBudgetReliabilityHint",
    "mrBudgetReliabilitySummary", "mrBudgetReliabilityUnavailable",
    "mrBudgetReliabilityEnvelopeMissing", "mrBudgetReliabilityEnvelopeMixedCandidate",
    "mrBudgetReliabilityEnvelopeMismatch", "mrBudgetReliabilityCoverageIncomplete",
    "mrBudgetReliabilityFact", "mrBudgetReliabilityEnvelope",
    "mrBudgetReliabilityExcluded", "mrBudgetReliabilitySoftOnly",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  // The English copy explicitly states what it is NOT.
  assert.match(enSection,
    /mrPolicyBudgetReliabilityHint['"]?\s*:\s*"[^"]*not[^"]*model quality[^"]*not[^"]*[Pp]rovider bill/i);
  // The Chinese copy carries the same "不是..." disclaimers in real translation.
  assert.ok(zhSection.includes("在触顶前跑到可验收结果"), "zh policy label");
  assert.ok(zhSection.includes("不是模型质量"), "zh 'not model quality'");
  assert.ok(zhSection.includes("不是 Provider 账单"), "zh 'not a Provider bill'");
  assert.ok(zhSection.includes("没设上限的成功不计入这项"), "zh missing envelope reason");
  assert.ok(zhSection.includes("不能混在一起计算比例"), "zh mixed-envelope reason");
  assert.ok(zhSection.includes("直接比较并不公平"), "zh mismatch reason");
  assert.ok(zhSection.includes("不会禁用或拉黑模型"), "zh soft-only model eligibility");
});

test("Hub preparation progress explains the live operation in both languages", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  assert.ok(src.includes("function preparationProgressText"));
  assert.ok(src.includes("function preparationElapsedText"));
  assert.ok(src.includes("preparationStage"));
  for (const key of [
    "prepInitStart", "prepSourceScanStart", "prepSourceScanComplete",
    "prepBaselineCopyStart", "prepBaselineCopyComplete", "prepWorkerCopyStart",
    "prepWorkerCopyComplete", "prepDependencyLinkStart", "prepDependencyLinkComplete",
    "prepContextWriteStart", "prepContextWriteComplete", "prepReady",
    "prepElapsedSeconds", "prepElapsedMinutes",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  assert.ok(zhSection.includes("正在读取项目"));
  assert.ok(zhSection.includes("安全快照"));
  assert.ok(zhSection.includes("Worker 即将开始执行"));
});

test("Hub Task detail carries the direct Main Token savings setup card", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  // Renderer exists and is placed after the open workbench, before manual actions.
  assert.ok(src.includes("function renderCalibrationCard"), "calibration card renderer");
  assert.ok(src.includes("function renderTaskWorkbench"), "open workbench is the primary report");
  assert.ok(src.includes("shell.appendChild(renderCalibrationCard(task));"),
    "showTask mounts the calibration card");
  const workbenchIdx = src.indexOf("shell.appendChild(renderTaskWorkbench(task));");
  const storyIdx = src.indexOf("shell.appendChild(renderTaskStory(task));");
  const deliveryIdx = src.indexOf("shell.appendChild(renderTaskDeliveryPlan(task));");
  const calIdx = src.indexOf("shell.appendChild(renderCalibrationCard(task));");
  const manualIdx = src.indexOf('journeyDisclosure(t("taskManualActions")');
  const journeyIdx = src.indexOf("var journeyEvidence = renderTaskJourney(task);");
  const techIdx = src.indexOf('collapsedSection(t("journeyTechnical")');
  assert.ok(
    workbenchIdx > 0
      && storyIdx > workbenchIdx
      && deliveryIdx > storyIdx
      && calIdx > deliveryIdx
      && manualIdx > calIdx
      && journeyIdx > manualIdx
      && techIdx > journeyIdx,
    "workbench, story, delivery plan, calibration, manual actions, evidence and technical details stay in readable order",
  );

  // State adapter covers every state.
  assert.ok(src.includes("function calibrationViewState"), "state adapter");
  assert.ok(src.includes('"identity-missing"'));
  assert.ok(src.includes('return "no-samples"'));
  assert.ok(src.includes('return "pending-review"'));
  assert.ok(src.includes('return "ready-to-publish"'));
  assert.ok(src.includes('return "published"'));
  assert.ok(src.includes('return "api-error"'));

  // Exact endpoint paths, task-scoped under calibration.
  assert.ok(src.includes('"/api/ops/tasks/" + encodeURIComponent(taskId) + "/calibration"'),
    "GET calibration endpoint");
  assert.ok(src.includes('"/api/ops/tasks/" + encodeURIComponent(task.id) + "/calibration/capture"'),
    "POST capture endpoint");
  assert.ok(src.includes('"/api/ops/tasks/" + encodeURIComponent(task.id) + "/calibration/review"'),
    "POST review endpoint");
  assert.ok(src.includes('"/api/ops/tasks/" + encodeURIComponent(task.id) + "/calibration/publish"'),
    "POST publish endpoint");

  // Capture body shape: runRef + exact turn.completed usage object.
  assert.ok(src.includes("runRef: runRef, usage: usage"), "capture body has runRef + usage");
  assert.ok(src.includes('type: "turn.completed"'), "capture usage is a turn.completed event");
  for (const k of [
    "input_tokens", "cached_input_tokens", "cache_write_input_tokens",
    "output_tokens", "reasoning_output_tokens",
  ]) {
    assert.ok(src.includes(k + ": Number(values." + k + ")"),
      `capture body carries counter ${k}`);
  }
  // Opaque run reference generated in the browser, not invented by the user.
  assert.ok(src.includes("function calibrationRunRef"), "runRef generator");
  assert.ok(src.includes("crypto.randomUUID"), "runRef uses crypto.randomUUID");
  assert.ok(src.includes('return "codex-run:" + crypto.randomUUID()'),
    "runRef follows the canonical direct-run reference format");

  // Validation before any request, with specific count relationships.
  assert.ok(src.includes("function calibrationValidateCounts"), "validation helper");
  assert.ok(src.includes("Number.isSafeInteger(n)"), "safe integer check");
  assert.ok(src.includes("n < 0"), "non-negative check");
  assert.ok(src.includes("cached + cacheWrite > input"), "cached subset must not exceed input");
  assert.ok(src.includes("reasoning > output"), "reasoning must not exceed output");
  // Validation itself sends no request; submit is only called on success.
  const valIdx = src.indexOf("function calibrationValidateCounts");
  const valEnd = src.indexOf("function calibrationNextActionKey", valIdx);
  const valBlock = src.slice(valIdx, valEnd > 0 ? valEnd : src.length);
  assert.ok(!valBlock.includes("postJSON"), "validation never posts");

  // Confirmations and confirm:true gates.
  assert.ok(src.includes('t("calCaptureConfirm")'), "capture confirm");
  assert.ok(src.includes('decision === "accepted" ? "calAcceptConfirm" : "calRejectConfirm"'),
    "review action selects the matching confirmation copy");
  assert.ok(src.includes("window.confirm(t(confirmKey))"), "review confirmation is shown before posting");
  assert.ok(src.includes('t("calPublishConfirm")'), "publish confirm");
  assert.ok(src.includes("confirm: true"), "confirm:true in review payload");
  assert.ok(src.includes("{ confirm: true }"), "publish body is confirm:true only");

  // Four bounded rejection reasons, canonical values preserved.
  for (const r of [
    "not-equivalent-task", "insufficient-quality",
    "incomplete-evidence", "duplicate-evidence",
  ]) {
    assert.ok(src.includes('"' + r + '"'), `rejection reason ${r} preserved`);
  }
  assert.ok(src.includes("CALIBRATION_REJECTION_REASONS"), "rejection reason inventory");

  // No automatic execution: no timers, no probe/submit/compete in the calibration block.
  const calStart = src.indexOf("var CALIBRATION_COUNTER_FIELDS");
  const calEnd = src.indexOf("function taskActualStageFor");
  const calBlock = src.slice(calStart, calEnd > 0 ? calEnd : src.length);
  assert.ok(!/setTimeout|setInterval/.test(calBlock), "no timers / no auto-loop");
  assert.ok(!calBlock.includes("provider_probe"), "no provider probe");
  assert.ok(!calBlock.includes("submit_file"), "no task submission");
  assert.ok(!calBlock.includes("competition_compare"), "no competition");

  // No raw JSON / prompt / response / credential is requested from the user.
  assert.ok(!calBlock.includes("JSON.stringify"), "no raw JSON requirement");
  assert.ok(!/\bprompt\b/.test(calBlock), "no prompt field requested");
  assert.ok(!/\bresponse\b/.test(calBlock), "no response field requested");
  for (const forbidden of ["apiKey", "secret", "credential"]) {
    assert.ok(!calBlock.includes(forbidden), `no ${forbidden} requested`);
  }

  // Samples render as plain states with captured time and gross tokens.
  assert.ok(src.includes("calSamplePending"), "pending state label");
  assert.ok(src.includes("calSampleAccepted"), "accepted state label");
  assert.ok(src.includes("calSampleRejected"), "rejected state label");
  assert.ok(src.includes("calSampleCaptured"), "captured time label");
  assert.ok(src.includes("calSampleGross"), "gross token label");
  assert.ok(src.includes("calSampleTechnical"), "stable id kept in a closed disclosure");

  // Equivalence checklist gates Accept for pending samples.
  assert.ok(src.includes("calEquivalenceTitle"), "equivalence checklist title");
  assert.ok(src.includes("acceptBtn.disabled = true"), "Accept starts disabled");
  assert.ok(src.includes("refreshAcceptEnabled"), "Accept enabled only after checklist complete");

  // Published / savings-available state links to the existing economics evidence.
  assert.ok(src.includes('setAttribute("data-fl-role", "task-economics-evidence")'),
    "economics evidence section carries a stable marker");
  assert.ok(src.includes("calibrationViewEconomicsBtn"), "view-economics button helper");
  assert.ok(src.includes('querySelector(\'[data-fl-role="task-economics-evidence"]\')'),
    "view-economics opens the existing economics disclosure");

  // Worker activity is never called savings; identity-missing refuses retrofit.
  assert.ok(src.includes("calWorkerNotSavingsNote"), "worker-not-savings caveat");
  assert.ok(src.includes("calNoRetrofitHint"), "identity-missing refuses retrofit");

  // Bilingual coverage of the core journey keys.
  for (const key of [
    "calCardTitle", "calIntro", "calStatusLabel", "calWorkerNotSavingsNote",
    "calStep1Title", "calStep2Title", "calStep3Title", "calStep4Title",
    "calCaptureConfirm", "calValidationCachedExceedsInput", "calValidationReasoningExceedsOutput",
    "calSamplePending", "calSampleAccepted", "calSampleRejected",
    "calAcceptConfirm", "calRejectConfirm", "calRejectReasonNotEquivalent",
    "calRejectReasonInsufficientQuality", "calRejectReasonIncompleteEvidence", "calRejectReasonDuplicate",
    "calPublishConfirm", "calPublishLowConfidenceNote", "calPublishReversibleNote",
    "calPublishReasonNoAccepted", "calPublishReasonNoNewEvidence", "calPublishReasonUnsafeVersion",
    "calStateIdentityMissing", "calNoRetrofitHint", "calFutureContractsHint",
    "calStatePublished", "calViewEconomics", "calNextReadyToPublish",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  // Chinese copy is real, not English fallback.
  assert.ok(zhSection.includes("直接 Main Token 节省设置"), "zh card title");
  assert.ok(zhSection.includes("绝不是节省"), "zh worker-not-savings caveat");
  assert.ok(zhSection.includes("不会为本任务臆造身份字段"), "zh no-retrofit hint");
  assert.ok(zhSection.includes("首次 Hub 发布为低置信度"), "zh low-confidence note");
  assert.ok(zhSection.includes("只能通过添加更新"), "zh reversible note");

  // CSS: calibration card and narrow-viewport collapse.
  assert.ok(css.includes(".calibration-card"), "calibration card CSS");
  assert.ok(css.includes(".cal-steps"), "steps CSS");
  assert.ok(css.includes(".cal-capture-form"), "capture form CSS");
  assert.ok(css.includes(".cal-sample"), "sample CSS");
  assert.ok(css.includes(".cal-publish"), "publish CSS");
  assert.match(
    css,
    /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{[^}]*\.cal-step\s*\{\s*grid-template-columns\s*:\s*1fr/i,
    "cal-step collapses to one column on narrow viewports",
  );
});

test("Hub Delivery Profiles page wires reusable build/activation registry with semantic dirty state", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const html = await readFile(path.join(hubPublic, "index.html"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  // Navigation tab is registered and dispatched.
  assert.ok(html.includes('data-tab="delivery"'), "Delivery nav button exists");
  assert.ok(src.includes('case "delivery": rDelivery();'), "Delivery tab case is dispatched");
  assert.ok(src.includes("function rDelivery"), "rDelivery renderer exists");
  // Page chrome metadata (title + sub) is registered for both locales.
  assert.match(i18n, /delivery:\s*\{\s*title:\s*"Delivery"/);
  assert.match(i18n, /delivery:\s*\{\s*title:\s*"交付"/);
  // Page story is rendered like the rest of the top-level pages.
  const rStart = src.indexOf("function rDelivery()");
  const rNext = src.indexOf("\nfunction ", rStart + 1);
  const rBlock = src.slice(rStart, rNext > 0 ? rNext : src.length);
  assert.ok(rBlock.includes('renderPageStory("delivery")'),
    "rDelivery renders the shared page story");
  assert.ok(rBlock.includes("deliveryRenderProfileList"),
    "rDelivery renders saved profiles");
  assert.ok(rBlock.includes("deliveryRenderDefaultCard"),
    "rDelivery renders the default-profile selector");
  assert.ok(rBlock.includes("deliveryRenderBindingsCard"),
    "rDelivery renders project bindings");
  assert.ok(rBlock.includes("deliveryRenderSaveBar"),
    "rDelivery renders the save bar with restore");

  // Pure normalization/equality helpers are exported via top-level functions.
  for (const name of [
    "deliveryParseCommands",
    "deliveryNormalizeProfile",
    "deliveryNormalizeSettings",
    "deliverySettingsEqual",
    "isDeliveryDraftDirty",
    "taskActualStageFor",
    "taskActualStatusLabel",
    "renderTaskDeliveryPlan",
    "renderPreflightResult",
  ]) {
    assert.ok(src.includes(`function ${name}`), `${name} is defined`);
  }
  // Commands parse preserves every real command in order, including lines
  // beginning with # because the backend executes those as commands too.
  const parseIdx = src.indexOf("function deliveryParseCommands");
  const parseEnd = src.indexOf("\nfunction ", parseIdx + 1);
  const parseBlock = src.slice(parseIdx, parseEnd > 0 ? parseEnd : src.length);
  assert.ok(parseBlock.includes("replace"),
    "deliveryParseCommands normalises whitespace");
  assert.ok(parseBlock.includes("filter"),
    "deliveryParseCommands drops empty lines");

  // Sandbox the dirty/equal helpers and exercise the contract from the
  // acceptance scenarios: restoring the saved values must clear dirty;
  // reordering commands must remain a semantic change.
  const startIdx = src.indexOf("var DELIVERY_ID_RE");
  const endIdx = src.indexOf("function fmtTm");
  const helpers = src.slice(startIdx, endIdx);
  const lib = new Function(helpers + "return { deliveryParseCommands, deliveryIsCanonicalPath, isDeliveryDraftDirty, deliverySettingsEqual };")
    () as {
      deliveryParseCommands(text: string): string[];
      deliveryIsCanonicalPath(path: string): boolean;
      isDeliveryDraftDirty(draft: unknown, saved: unknown): boolean;
      deliverySettingsEqual(a: unknown, b: unknown): boolean;
    };

  const savedRegistry = {
    defaultProfileId: "build-app",
    profiles: [
      {
        id: "build-app",
        label: "Default web app",
        buildCommands: ["npm ci", "npm run build"],
        activationCommands: ["systemctl restart forklight.target"],
        activationCheckCommands: ["curl -fsS http://127.0.0.1:8080/health"],
      },
    ],
    projectBindings: { "/srv/projects/web": "build-app" },
  };
  // Restoring the exact same ordered commands and bindings must clear dirty.
  const equalDraft = JSON.parse(JSON.stringify(savedRegistry));
  assert.equal(lib.isDeliveryDraftDirty(equalDraft, savedRegistry), false,
    "restoring the exact saved registry clears the dirty marker");
  // Reordering build commands is a semantic change.
  const reordered = JSON.parse(JSON.stringify(savedRegistry));
  reordered.profiles[0].buildCommands = ["npm run build", "npm ci"];
  assert.equal(lib.isDeliveryDraftDirty(reordered, savedRegistry), true,
    "reordering build commands makes the draft dirty");
  assert.deepEqual(lib.deliveryParseCommands("  npm ci  \n\n# keep this line\nnpm run build"),
    ["npm ci", "# keep this line", "npm run build"],
    "blank lines are removed but comment-looking command lines are preserved");
  assert.equal(lib.deliveryIsCanonicalPath("/"), true, "filesystem root is canonical");
  assert.equal(lib.deliveryIsCanonicalPath("/srv/../tmp"), false, "dot segments are rejected");
  assert.equal(lib.deliveryIsCanonicalPath("/srv//tmp"), false, "double separators are rejected");
  // Deleting the sole profile must mark the draft dirty.
  const empty = {
    defaultProfileId: null,
    profiles: [],
    projectBindings: {},
  };
  assert.equal(lib.isDeliveryDraftDirty(empty, savedRegistry), true,
    "removing the only profile marks the draft dirty");
  // Saved registry with no profiles + draft with no profiles must be clean.
  const emptySaved = JSON.parse(JSON.stringify(empty));
  assert.equal(lib.isDeliveryDraftDirty(empty, emptySaved), false,
    "two empty registries are clean");

  // Save posts the entire registry to /api/settings and only ever when a
  // payload is constructed - the editor never auto-runs anything.
  assert.ok(src.includes("/api/settings"), "Delivery save uses the settings bridge");
  const saveIdx = src.indexOf("function deliveryRenderSaveBar");
  const saveEnd = src.indexOf("\nfunction ", saveIdx + 1);
  const saveBlock = src.slice(saveIdx, saveEnd > 0 ? saveEnd : src.length);
  assert.ok(saveBlock.includes("deliveryProfiles"),
    "save builds a deliveryProfiles payload");
  assert.ok(saveBlock.includes('postJSON("/api/settings", patch)'),
    "save only writes the settings endpoint");
  assert.ok(!saveBlock.includes("/integration/apply"),
    "saving a profile cannot apply or execute a delivery");
  assert.ok(saveBlock.includes("restoreBtn"),
    "save bar has a restore-saved-values action");

  // Task detail now renders the four-stage plan before the integration
  // controls, never collapses planned and actual into one status, and the
  // preflight result has replaced the raw JSON dump.
  const showIdx = src.indexOf("function showTask(");
  const showBlock = src.slice(showIdx);
  assert.ok(showBlock.includes("renderTaskDeliveryPlan(task)"),
    "showTask renders the four-stage plan before manual actions");
  const planIdx = showBlock.indexOf("renderTaskDeliveryPlan(task)");
  const integBtn = showBlock.indexOf("taskPreflight");
  assert.ok(planIdx > 0 && integBtn > 0 && planIdx < integBtn,
    "delivery plan is placed before the Integration preflight button");
  assert.ok(showBlock.includes("renderPreflightResult(res.result)"),
    "preflight result renders the readable card instead of raw JSON");
  assert.ok(!showBlock.includes("JSON.stringify(res.result).slice(0, 400)"),
    "raw JSON preflight dump is gone");
  assert.ok(src.includes("taskActualStageFor(task, key)"),
    "actual stage evidence is read per-stage, never inferred from overall");

  // Plan renderer must never fabricate a "passed" label when no record exists.
  const renderPlanIdx = src.indexOf("function renderTaskDeliveryPlan");
  const renderPlanEnd = src.indexOf("function ", renderPlanIdx + 1);
  const renderPlanBlock = src.slice(renderPlanIdx, renderPlanEnd > 0 ? renderPlanEnd : src.length);
  assert.ok(src.includes('var DELIVERY_STAGE_KEYS = ["source-applied", "source-verified", "artifact-built", "runtime-activated"]'),
    "plan uses the backend's exact four delivery stages");
  assert.ok(renderPlanBlock.includes("taskDeliveryPlanUnavailable")
      && renderPlanBlock.includes("DELIVERY_STAGE_KEYS.forEach"),
    "older tasks still show all four steps while the plan is marked unavailable");
  assert.ok(src.includes('return value === "required" || value === "not-configured" ? value : "unknown";'),
    "plan reflects not-configured truth and does not invent a pass");
  assert.ok(renderPlanBlock.includes('"task-delivery-plan"'),
    "plan carries a stable role marker");
  assert.ok(renderPlanBlock.includes('data-fl-role", "delivery-stage-'),
    "each stage row has a stable role marker");

  // Preflight renderer stays readable: no JSON dump, but the receipt id is
  // preserved inside a closed technical disclosure.
  const preIdx = src.indexOf("function renderPreflightResult");
  const preEnd = src.indexOf("function ", preIdx + 1);
  const preBlock = src.slice(preIdx, preEnd > 0 ? preEnd : src.length);
  assert.ok(preBlock.includes("preflight-headline"),
    "preflight shows a localized headline verdict");
  assert.ok(preBlock.includes("collapsedSection(t(\"taskPreflightReceiptDetails\""),
    "receipt id and bounds stay in a closed technical disclosure");
  assert.ok(!preBlock.includes("JSON.stringify(res.result"),
    "preflight renderer never produces a raw JSON dump");
  assert.ok(preBlock.includes("Array.isArray(result.affectedFiles)"),
    "preflight counts the actual affected-files array");
  assert.ok(preBlock.includes("result.id"),
    "preflight reads the backend receipt id field");
  assert.ok(showBlock.includes("receiptIn.value = String(res.result.id)"),
    "a passing preflight fills the apply approval field automatically");

  // Bilingual coverage of every copy key consumed by the new UI.
  for (const key of [
    "deliveryGuideBody", "deliverySavedNothing", "deliverySavedNothingHint",
    "deliveryCmdBuild", "deliveryCmdActivation", "deliveryCmdActivationCheck",
    "deliveryCmdExplainBuild", "deliveryCmdExplainActivation", "deliveryCmdExplainActivationCheck",
    "deliveryCmdExplainNotConfigured", "deliveryCmdSaveNote", "deliveryCommandCount", "deliveryCommandDetails",
    "deliveryProfilesTitle", "deliveryProfilesEmpty",
    "deliveryProfileLabel", "deliveryProfileId", "deliveryProfileIdHint",
    "deliveryProfileCreateBtn", "deliveryProfileEditBtn", "deliveryProfileRemoveBtn",
    "deliveryDefaultProfileLabel", "deliveryDefaultNone",
    "deliveryBindingsTitle", "deliveryBindingsEmpty",
    "deliveryBindingAddBtn", "deliveryBindingRemoveBtn", "deliveryBindingPathPh",
    "deliverySave", "deliverySaved", "deliveryDirtyBadge",
    "deliveryInvalidDraft", "deliveryInvalidDuplicateId",
    "deliveryInvalidInvalidId", "deliveryInvalidLabel", "deliveryInvalidTooManyCommands",
    "deliveryInvalidTooManyProfiles", "deliveryInvalidBadPath",
    "deliveryInvalidMissingDefault", "deliveryInvalidBindingProfile",
    "deliveryRestoreBtn",
    "taskDeliveryPlanTitle", "taskDeliveryPlanIntro",
    "taskDeliveryPlanNone", "taskDeliveryPlanNoneHint",
    "taskDeliveryPlanUnavailable", "taskDeliveryPlanUnavailableHint",
    "taskDeliveryStageSourceApply", "taskDeliveryStageSourceVerify",
    "taskDeliveryStageBuild", "taskDeliveryStageActivate",
    "taskDeliveryStageConfigured", "taskDeliveryStageNotConfigured", "taskDeliveryStageUnknown",
    "taskDeliveryActualTitle", "taskDeliveryActualPassed",
    "taskDeliveryActualFailed", "taskDeliveryActualSkipped",
    "taskDeliveryActualPending", "taskDeliveryActualNotConfigured", "taskDeliveryActualUnknown",
    "taskDeliveryActualNotRun", "taskDeliveryActualConfigured",
    "taskPreflightTitle", "taskPreflightHeadlineOk",
    "taskPreflightHeadlineReject", "taskPreflightSummaryOk",
    "taskPreflightAffected", "taskPreflightFileCount", "taskPreflightRejectTitle",
    "taskPreflightNextOk", "taskPreflightNextReject",
    "taskPreflightNextStageOk", "taskPreflightNextStageNotConfigured", "taskPreflightNextStageUnknown",
    "taskPreflightReceiptDetails", "taskPreflightReceiptId",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  // Chinese copy is real, not English fallback.
  assert.ok(zhSection.includes("交付设置"), "zh delivery guide");
  assert.ok(zhSection.includes("构建命令"), "zh build commands label");
  assert.ok(zhSection.includes("启动命令"), "zh activation commands label");
  assert.ok(zhSection.includes("更新源码"), "zh source apply stage");
  assert.ok(zhSection.includes("检查更新后的源码"), "zh source verification stage");
  assert.ok(zhSection.includes("产物构建"), "zh build stage");
  assert.ok(zhSection.includes("更新运行中的产品"), "zh activate stage");
  assert.ok(zhSection.includes("目前还没有改动原项目"), "zh preflight truth");
  assert.ok(zhSection.includes("Receipt id"), "zh receipt id copy is real");

  // CSS styles for the Delivery page, the four-stage cards and the
  // readable preflight result, with the required narrow-viewport collapse.
  assert.ok(css.includes(".delivery-profile-card"), "delivery profile card CSS");
  assert.ok(css.includes(".delivery-binding-row"), "delivery binding row CSS");
  assert.ok(css.includes(".delivery-dirty-pill"), "unsaved dirty pill CSS");
  assert.ok(css.includes(".delivery-stages"), "four-stage container CSS");
  assert.ok(css.includes(".delivery-stage"), "stage row CSS");
  assert.ok(css.includes(".delivery-stage-pair"), "planned/actual pair CSS");
  assert.ok(css.includes(".preflight-card"), "preflight card CSS");
  assert.ok(css.includes(".preflight-headline"), "preflight headline CSS");
  assert.ok(css.includes(".preflight-stages"), "preflight stages CSS");
  assert.match(css,
    /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{[\s\S]*?\.delivery-stage-pair\s*\{\s*grid-template-columns\s*:\s*1fr/i,
    "planned/actual pair collapses to one column on narrow viewports");
});

test("Hub Overview version journey adapter maps stable state codes without recomputing identity", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.doesNotThrow(() => new Function(src), "Hub app.js must parse before version-journey assertions");

  // The pure adapter has executable boundaries, like the task-story adapter.
  const startMarker = "/* VERSION_JOURNEY_ADAPTER_START */";
  const endMarker = "/* VERSION_JOURNEY_ADAPTER_END */";
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "pure version-journey adapter has executable boundaries");
  const block = src.slice(start + startMarker.length, end);
  const adapter = new Function(`${block}\nreturn versionJourneyView;`)() as (
    journey: unknown,
  ) => {
    state: string;
    nextAction: string;
    outcomeKey: string;
    nextActionKey: string;
    restartEligible: boolean;
    layers: {
      source: { available: boolean; state: string };
      artifact: { available: boolean; state: string };
      daemon: { available: boolean; running: boolean; state: string };
    };
  };

  const digest = (ch: string) => ch.repeat(64);
  const identity = (buildId: string, protocolVersion = 2, sourceDigest = digest("a")) => ({
    protocolVersion,
    packageVersion: "1.0.0",
    buildId,
    builtAt: "2026-07-27T00:00:00Z",
    sourceRevision: "rev-1",
    sourceDigest,
  });

  // ready: all three layers align.
  const ready = adapter({
    state: "ready", nextAction: "none",
    layers: {
      source: { available: true, digest: digest("a"), latestModifiedAt: "2026-07-27T00:00:00Z" },
      artifact: { available: true, buildIdentity: identity("build-1") },
      daemon: { available: true, running: true, buildIdentity: identity("build-1") },
    },
  });
  assert.equal(ready.state, "ready");
  assert.equal(ready.outcomeKey, "vjOutcomeReady");
  assert.equal(ready.nextActionKey, "vjNextNone");
  assert.equal(ready.restartEligible, false, "ready offers no restart");
  assert.equal(ready.layers.source.state, "present");
  assert.equal(ready.layers.artifact.state, "present");
  assert.equal(ready.layers.daemon.state, "running");

  // source-needs-build: edits exist but are not yet in the built product.
  const needsBuild = adapter({
    state: "source-needs-build", nextAction: "build",
    layers: {
      source: { available: true, digest: digest("b"), latestModifiedAt: "2026-07-28T00:00:00Z" },
      artifact: { available: true, buildIdentity: identity("build-1", 2, digest("a")) },
      daemon: { available: true, running: true, buildIdentity: identity("build-1") },
    },
  });
  assert.equal(needsBuild.outcomeKey, "vjOutcomeSourceNeedsBuild");
  assert.equal(needsBuild.nextActionKey, "vjNextBuild");
  assert.equal(needsBuild.restartEligible, false, "source-needs-build offers no restart");

  // artifact-needs-restart with a running older daemon: restart is offered.
  const needsRestartRunning = adapter({
    state: "artifact-needs-restart", nextAction: "restart",
    layers: {
      source: { available: true, digest: digest("a"), latestModifiedAt: "2026-07-27T00:00:00Z" },
      artifact: { available: true, buildIdentity: identity("build-2") },
      daemon: { available: true, running: true, buildIdentity: identity("build-1") },
    },
  });
  assert.equal(needsRestartRunning.outcomeKey, "vjOutcomeArtifactNeedsRestart");
  assert.equal(needsRestartRunning.nextActionKey, "vjNextRestart");
  assert.equal(needsRestartRunning.restartEligible, true, "restart is offered only here");
  assert.equal(needsRestartRunning.layers.daemon.state, "running");

  // artifact-needs-restart with a stopped daemon: restart still offered, daemon honest.
  const needsRestartStopped = adapter({
    state: "artifact-needs-restart", nextAction: "restart",
    layers: {
      source: { available: true, digest: digest("a"), latestModifiedAt: "2026-07-27T00:00:00Z" },
      artifact: { available: true, buildIdentity: identity("build-2") },
      daemon: { available: false, running: false },
    },
  });
  assert.equal(needsRestartStopped.restartEligible, true);
  assert.equal(needsRestartStopped.layers.daemon.state, "stopped",
    "stopped daemon is reported honestly, not as a proven mismatch");

  // protocol-mismatch: rebuild-and-restart, no single restart.
  const mismatch = adapter({
    state: "protocol-mismatch", nextAction: "rebuild-and-restart",
    layers: {
      source: { available: true, digest: digest("a"), latestModifiedAt: "2026-07-27T00:00:00Z" },
      artifact: { available: true, buildIdentity: identity("build-2", 2) },
      daemon: { available: true, running: true, buildIdentity: identity("build-1", 1) },
    },
  });
  assert.equal(mismatch.outcomeKey, "vjOutcomeProtocolMismatch");
  assert.equal(mismatch.nextActionKey, "vjNextRebuildAndRestart");
  assert.equal(mismatch.restartEligible, false, "protocol-mismatch needs rebuild too");

  // unavailable: no false green state.
  const unavailable = adapter({
    state: "unavailable", nextAction: "inspect",
    layers: {
      source: { available: false },
      artifact: { available: false },
      daemon: { available: false, running: false },
    },
  });
  assert.equal(unavailable.outcomeKey, "vjOutcomeUnavailable");
  assert.equal(unavailable.nextActionKey, "vjNextInspect");
  assert.equal(unavailable.restartEligible, false);
  assert.equal(unavailable.layers.source.state, "unavailable");
  assert.equal(unavailable.layers.daemon.state, "stopped");

  // Running daemon with no build identity is honest, not aligned.
  const runningNoId = adapter({
    state: "unavailable", nextAction: "inspect",
    layers: {
      source: { available: true, digest: digest("a"), latestModifiedAt: "2026-07-27T00:00:00Z" },
      artifact: { available: true, buildIdentity: identity("build-1") },
      daemon: { available: false, running: true },
    },
  });
  assert.equal(runningNoId.layers.daemon.state, "running-no-identity");
  assert.equal(runningNoId.restartEligible, false);

  // Unknown / missing codes fall back to unavailable + inspect, never ready.
  const unknown = adapter({ state: "future-code", nextAction: "weird", layers: {} });
  assert.equal(unknown.state, "unavailable");
  assert.equal(unknown.nextAction, "inspect");
  assert.equal(unknown.outcomeKey, "vjOutcomeUnavailable");
  assert.equal(unknown.restartEligible, false);
  const nullView = adapter(null);
  assert.equal(nullView.state, "unavailable");
  assert.equal(nullView.restartEligible, false);

  // Purity boundary: the adapter never reads or compares identity fields,
  // and never infers equality from timestamps.
  for (const forbidden of [
    /\.digest\b/, /\.buildId\b/, /\.sourceDigest\b/,
    /\.protocolVersion\b/, /\.latestModifiedAt\b/, /\.buildIdentity\b/,
    /Date\.parse|new Date|getTime/,
  ]) {
    assert.ok(!forbidden.test(block), `adapter must not recompute identity via ${forbidden}`);
  }
});

test("Hub Overview version journey card renders three ordered layers, outcome, and safe restart", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  // Renderer and adapter are present.
  assert.ok(src.includes("function renderVersionJourneyCard"), "version card renderer");
  assert.ok(src.includes("function versionJourneyView"), "pure adapter");
  assert.ok(src.includes("function versionJourneyTechnical"), "closed technical disclosure builder");

  // The card is mounted in rOverview after readiness and before task metrics.
  const ovStart = src.indexOf("function rOverview()");
  assert.ok(ovStart > 0, "rOverview present");
  const ovEnd = src.indexOf("\nfunction ", ovStart + 1);
  const ovBlock = src.slice(ovStart, ovEnd > 0 ? ovEnd : src.length);
  const storyAt = ovBlock.indexOf('renderPageStory("overview")');
  const readinessAt = ovBlock.indexOf("rReadiness()");
  const cardAt = ovBlock.indexOf("renderVersionJourneyCard()");
  const metricsAt = ovBlock.indexOf("metric(");
  assert.ok(storyAt > 0 && readinessAt > storyAt, "page story before readiness");
  assert.ok(cardAt > readinessAt, "version card after readiness");
  assert.ok(metricsAt > cardAt, "version card before task metrics");

  // Renderer block: three ordered layer rows, outcome, next action, disclosure.
  const cardFn = extractFunctionSource(src, "renderVersionJourneyCard");
  assert.ok(cardFn.includes('setAttribute("data-fl-role", "version-journey")'),
    "card carries a stable role marker");
  for (const key of ["source", "artifact", "daemon"]) {
    assert.ok(cardFn.includes(`"version-journey-layer-${key}"`),
      `layer row ${key} has a stable ordered marker`);
  }
  // Layers are rendered in source -> artifact -> daemon order.
  const srcLayerAt = cardFn.indexOf('"version-journey-layer-source"');
  const artLayerAt = cardFn.indexOf('"version-journey-layer-artifact"');
  const daeLayerAt = cardFn.indexOf('"version-journey-layer-daemon"');
  assert.ok(srcLayerAt > 0 && artLayerAt > srcLayerAt && daeLayerAt > artLayerAt,
    "layers are ordered source, built product, running service");
  assert.ok(cardFn.includes('setAttribute("data-fl-role", "version-journey-outcome")'),
    "overall outcome has a stable marker");
  assert.ok(cardFn.includes('setAttribute("data-fl-role", "version-journey-next")'),
    "next action has a stable marker");
  // Primary copy carries no raw identity language; evidence stays collapsed.
  for (const forbidden of [
    /\.digest\b/, /\.buildId\b/, /\.sourceDigest\b/, /\.protocolVersion\b/, /\.latestModifiedAt\b/,
  ]) {
    assert.ok(!forbidden.test(cardFn), `primary card must not surface ${forbidden}`);
  }
  assert.ok(cardFn.includes('collapsedSection(t("vjTechnicalTitle")'),
    "exact evidence lives in a closed technical disclosure");

  // Restart is gated on the backend restart code and reuses the existing path.
  assert.ok(cardFn.includes("if(view.restartEligible)"),
    "restart button only when backend says restart");
  assert.ok(cardFn.includes('window.confirm(t("daemonRestartConfirm"))'),
    "restart reuses the existing confirmed restart prompt");
  assert.ok(cardFn.includes('daemonAction("restart", restartBtn)'),
    "restart reuses the existing authenticated daemon restart route");
  assert.ok(cardFn.includes('setAttribute("data-fl-role", "version-journey-restart")'),
    "restart button has a stable marker");
  // No build mutation endpoint and no automatic build/restart.
  assert.ok(!/\/api\/.*build/.test(cardFn), "no build mutation endpoint");
  assert.ok(!/setTimeout|setInterval/.test(cardFn), "no automatic timers in the card");

  // Bilingual coverage of every copy key.
  const vjKeys = [
    "vjCardTitle", "vjCardIntro",
    "vjLayerSourceTitle", "vjLayerSourceMeaning",
    "vjLayerArtifactTitle", "vjLayerArtifactMeaning",
    "vjLayerDaemonTitle", "vjLayerDaemonMeaning",
    "vjLayerSourceAvailable", "vjLayerArtifactAvailable",
    "vjLayerDaemonRunning", "vjLayerDaemonStopped",
    "vjLayerDaemonIdentityMissing", "vjLayerCannotConfirm",
    "vjOutcomeLabel", "vjNextLabel",
    "vjOutcomeReady", "vjOutcomeSourceNeedsBuild",
    "vjOutcomeArtifactNeedsRestart", "vjOutcomeProtocolMismatch",
    "vjOutcomeUnavailable",
    "vjNextNone", "vjNextBuild", "vjNextRestart",
    "vjNextRebuildAndRestart", "vjNextInspect",
    "vjRestartButton", "vjTechnicalTitle",
    "vjTechState", "vjTechNextAction",
    "vjTechSourceDigest", "vjTechSourceModified",
    "vjTechArtifactBuildId", "vjTechArtifactVersion",
    "vjTechArtifactProtocol", "vjTechArtifactBuiltAt", "vjTechArtifactSourceDigest",
    "vjTechDaemonBuildId", "vjTechDaemonVersion",
    "vjTechDaemonProtocol", "vjTechDaemonBuiltAt", "vjTechDaemonSourceDigest",
    "vjTechUnavailable",
  ];
  for (const key of vjKeys) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
    assert.ok(src.includes(key), `renderer consumes ${key}`);
  }
  // Chinese copy is real, not English fallback.
  assert.ok(zhSection.includes("当前运行的是你的最新改动吗"), "zh card title asks the user's question");
  assert.ok(zhSection.includes("你刚改过的代码"), "zh source layer");
  assert.ok(zhSection.includes("从代码构建出的产品"), "zh built product layer");
  assert.ok(zhSection.includes("现在正在处理任务的 ForkLight"), "zh running service layer");
  assert.ok(zhSection.includes("最新代码已经完成构建"), "zh ready outcome");
  assert.ok(zhSection.includes("最新修改的代码还没有完成构建"), "zh source-needs-build outcome");
  assert.ok(zhSection.includes("仍在使用旧版本"), "zh artifact-needs-restart outcome");
  assert.ok(zhSection.includes("不能保证运行中的产品已经是最新版本"), "zh unavailable outcome");
  assert.ok(zhSection.includes("重启任务服务"), "zh restart action");
  // English truthfulness is expressed in user language, without version-system jargon.
  assert.match(enSection, /vjOutcomeReady['"]?\s*:\s*"[^"]*latest code[^\"]*running service is using it/i);
  assert.match(enSection,
    /vjOutcomeSourceNeedsBuild['"]?\s*:\s*"[^"]*latest code changes[^"]*not been built yet/i);
  assert.match(enSection,
    /vjOutcomeArtifactNeedsRestart['"]?\s*:\s*"[^"]*latest product has been built[^"]*older build/i);
  assert.match(enSection,
    /vjOutcomeUnavailable['"]?\s*:\s*"[^"]*cannot confirm every step[^"]*running product is current/i);

  // CSS: card, three-layer grid, and narrow-viewport collapse.
  assert.ok(css.includes(".version-journey-card"), "card CSS");
  assert.ok(css.includes(".vj-layers"), "layers container CSS");
  assert.ok(css.includes(".vj-layer"), "layer row CSS");
  assert.ok(css.includes(".vj-layer-num"), "layer number CSS");
  assert.ok(css.includes(".vj-layer-body"), "layer body CSS");
  assert.ok(css.includes(".vj-layer-title"), "layer title CSS");
  assert.ok(css.includes(".vj-layer-meaning"), "layer meaning CSS");
  assert.ok(css.includes(".vj-layer-status"), "layer status CSS");
  assert.ok(css.includes(".vj-outcome"), "outcome CSS");
  assert.ok(css.includes(".vj-next"), "next action CSS");
  assert.ok(css.includes(".vj-section-label"), "section label CSS");
  assert.match(css,
    /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{[^}]*\.vj-layer\s*\{\s*grid-template-columns\s*:\s*22px/i,
    "vj-layer collapses on narrow viewports");
});
