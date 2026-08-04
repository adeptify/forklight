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
  assert.ok(html.includes('data-tab="model"') && html.includes('data-tab="work"'));
  assert.ok(html.includes('id="fl-detail"'));
  assert.ok(js.includes("X-ForkLight-Hub-Token"));
  assert.ok(js.includes("function kanbanCard"));
  assert.ok(css.length > 200);
});

test("Hub explains the real Competition and exposes an explicit Main decision flow", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  for (const functionName of [
    "competitionNextActionLabel",
    "renderTaskCompetitionContext",
    "competitionDecisionControls",
  ]) {
    assert.ok(src.includes(`function ${functionName}(`), `${functionName} must exist`);
  }
  assert.ok(src.includes('data-fl-role", "task-competition-context"'));
  assert.ok(src.includes('data-fl-role", "competition-main-controls"'));
  assert.ok(src.includes('/main-decision"'));
  assert.ok(src.includes("candidate.mainReviewDecision"), "Competition decision follows the Task-level Main review");
  assert.ok(src.includes("if(!window.confirm(t(\"compMainConfirm\"))) return"));
  assert.ok(src.includes("showCompetition(ctx.competitionId)"));
  for (const phrase of [
    "This task is one Competition candidate",
    "Machine comparison cannot accept work or start another Worker",
    "这个任务是一次 Competition 的候选",
    "机器比较不能接受成果，也不能自行启动下一位 Worker",
  ]) {
    assert.ok(i18n.includes(phrase), phrase);
  }
});

test("Hub explains Goal Task direct handoff with confirmation and bilingual privacy-safe story", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(src.includes('data-fl-role", "goal-task-handoff-controls"'));
  assert.ok(src.includes("function renderGoalTaskHandoffControls("));
  assert.ok(src.includes('/goal-handoff"'));
  assert.ok(src.includes("goalHandoffConfirm"));
  assert.ok(src.includes("goalHandoffMilestoneLine"));
  assert.ok(i18n.includes("goalHandoffTitle"));
  assert.ok(i18n.includes("goalHandoffHint"));
  assert.ok(i18n.includes("把此 Goal Task 候选直接交给另一个 Worker"));
  assert.ok(i18n.includes("Hand this Goal Task Candidate to a different Worker"));
  assert.ok(!i18n.includes("Token savings from handoff"), "must not claim Token savings");
});

test("Hub explains cross-Worker handoff with confirmation and bilingual privacy-safe story", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(src.includes("function competitionHandoffControls("));
  assert.ok(src.includes("function renderCandidateHandoffCard("));
  assert.ok(src.includes('data-fl-role", "competition-handoff-controls"'));
  assert.ok(src.includes('data-fl-role", "candidate-handoff"'));
  assert.ok(src.includes('/handoff"'));
  assert.ok(src.includes("if(!window.confirm(t(\"compHandoffConfirm\"))) return"));
  assert.ok(src.includes("destinationWorkerProfileId"));
  assert.ok(src.includes("candidateRevisionId"));
  assert.ok(!src.includes("privateArtifactPath"), "Hub must not project private revision artifact paths");
  for (const phrase of [
    "Hand retained work to a different Worker",
    "This is not a retry of the source Task",
    "把保留成果交给另一位 Worker",
    "这不是源任务的重试",
    "跨 Worker 接力",
  ]) {
    assert.ok(i18n.includes(phrase), phrase);
  }
  assert.ok(!i18n.includes("Token savings from handoff"), "must not claim Token savings");
});

test("Hub explains the multi-judge Review Graph with explicit confirmation", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(src.includes("function renderJudgeReviewCard("));
  assert.ok(src.includes('data-fl-role", "judge-review"'));
  assert.ok(src.includes("/review-graph\""));
  assert.ok(src.includes("reviewerWorkerProfileIds"));
  assert.ok(src.includes("if(!window.confirm(t(\"taskJudgeConfirm\"))) return"));
  assert.ok(src.includes("function judgeFailureLabel("));
  assert.ok(src.includes("function judgeNextActionLabel("));
  assert.ok(src.includes("function judgeAggregationLabel("));
  assert.ok(src.includes("function judgeAggregationExplanation("));
  // Chinese UI must localize from state/counts — never render server English explanation.
  assert.ok(src.includes("judgeAggregationExplanation(agg)"));
  assert.ok(!src.includes("agg.explanation"));
  assert.ok(!src.includes("String(agg.explanation"));
  assert.ok(i18n.includes("taskJudgeFailureMalformed"));
  assert.ok(i18n.includes("这个候选已经成功合入，没有待处理的审查动作"));
  assert.ok(i18n.includes("裁判在约定的结构化结果之外添加了说明"));
  assert.ok(i18n.includes("nothing will retry unless Main starts new work"));
  assert.ok(i18n.includes("taskJudgeAggDisagreement"));
  assert.ok(i18n.includes("taskJudgeAggExplainDisagreement"));
  assert.ok(i18n.includes("taskJudgeAggExplainPending"));
  assert.ok(i18n.includes("仍有 {pending}/{total} 位独立裁判未完成"));
  assert.ok(i18n.includes("可用裁判意见不一致（接受×{accept}"));
  for (const phrase of [
    "Assign one through three saved Workers as independent read-only judges",
    "Main decides. Judge output is evidence",
    "Usable judges disagree",
    "为当前精确的候选版本指派 1 到 3 个已保存的 Worker 作为独立只读裁判",
    "由 Main 做最终决定。裁判输出是证据",
    "可用裁判意见不一致",
  ]) {
    assert.ok(i18n.includes(phrase), phrase);
  }
});

test("Hub explains durable Goal supervision with bilingual next actions", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const html = await readFile(path.join(hubPublic, "index.html"), "utf8");
  assert.ok(html.includes('data-tab="work"'), "Work is the single operate surface entry");
  assert.ok(!html.includes('data-tab="overview"') && !html.includes('data-tab="goals"') && !html.includes('data-tab="plans"') && !html.includes('data-tab="tasks"'),
    "Overview and peer Board/Plans/Goals navigation are folded into Work");
  assert.ok(src.includes("function rGoals("));
  assert.ok(src.includes("function showGoalDetail("));
  assert.ok(src.includes('data-fl-role", "goal-detail"'));
  assert.ok(src.includes("/api/ops/goals/"));
  assert.ok(src.includes("if(!window.confirm(t(\"goalAdvanceConfirm\"))) return"));
  assert.ok(src.includes("if(!window.confirm(t(\"goalStopConfirm\"))) return"));
  assert.ok(src.includes("function goalNextActionLabel("));
  assert.ok(src.includes("function goalReasonLabel("), "Goal reason codes localize by reasonCode");
  assert.ok(src.includes("function goalMilestoneDeliveryLabel("), "delivery basis has a bilingual helper");
  assert.ok(src.includes("function goalStoryHappenedText("), "story happened uses localized cause");
  assert.ok(src.includes("function goalStoryWaitingText("), "story waiting uses localized cause");
  assert.ok(src.includes("function goalOverviewSummaryText("), "overview uses terminal/active summary helper");
  assert.ok(src.includes("goalOverviewSummaryText(g)"), "rOverview wires overview summary helper");
  assert.ok(src.includes('stopped: "statusStopped"'), "durable stopped status is a first-class badge label");
  assert.ok(
    src.includes("goalNextActionLabel(g.nextActionCode, g.nextAction)"),
    "Goal list prefers known nextActionCode over stored prose",
  );
  assert.ok(
    src.includes("goalNextActionLabel(goal.nextActionCode, goal.nextAction)"),
    "Goal Detail prefers known nextActionCode over stored prose",
  );
  assert.ok(!src.includes("g.nextAction || goalNextActionLabel"), "overview must not prefer raw nextAction prose");
  assert.ok(src.includes("readableDuration(policy.noProgressTimeoutMs)"), "no-progress policy uses readable duration");
  assert.ok(src.includes('t("goalStoppedLine"'), "stopped Goals show a plain-language stop line");
  assert.ok(
    src.includes("goalReasonLabel(goal.reasonCode"),
    "stopped summary localizes known reason codes instead of raw English reason",
  );
  assert.ok(
    src.includes("goalStoryHappenedText(goal)"),
    "Goal Detail story happened path uses localized helper",
  );
  assert.ok(
    src.includes("goalStoryWaitingText(goal)"),
    "Goal Detail story waiting path uses localized helper",
  );
  assert.ok(
    src.includes("goalMilestoneDeliveryLabel(m.deliveryBasis"),
    "Goal Detail milestones localize delivery basis",
  );
  assert.ok(
    src.includes('data-fl-delivery-basis"'),
    "satisfied milestones expose compact delivery basis for audit",
  );
  for (const phrase of [
    "What just happened",
    "What Main should do next",
    "刚刚发生",
    "Main 下一步应做",
    "Future Task admission will be blocked",
    "将阻止后续 Task 准入",
    "no-progress stop after",
    "无进展停止时限",
    "running Workers were not killed",
    "不会杀掉正在运行的 Worker",
    "权威里程碑证据没有变化",
    "Main 在无新证据时推进次数过多",
    "已达到目标总时长上限",
    "Main 已停止此目标",
    "statusStopped",
    "已停止",
    "Main repaired the current source and rechecked it with a corrected acceptance rule",
    "Main 已修复当前源码，并用修正后的验收规则重新检查通过",
  ]) {
    assert.ok(i18n.includes(phrase), phrase);
  }
  // Privacy: Goal milestone copy must not surface commands, private reasons, or paths.
  assert.ok(!i18n.includes("npm run typecheck"), "Goal i18n must not hardcode commands");
  assert.ok(!i18n.includes("contradictory-acceptance"), "Goal beginner copy omits internal reason code");
  assert.ok(!src.includes("replacementCommand"), "Goal UI must not bind replacementCommand");
  assert.ok(!src.includes("amendedCommands"), "Goal UI must not bind private amendedCommands");
  assert.ok(!i18n.includes("Delivery basis: {basis}"), "Hub must not show raw basis tokens");
  assert.ok(!i18n.includes("交付依据：{basis}"), "中文 Hub 不展示内部依据 token");
});

test("Hub Goal Detail explains amended delivery basis in English and Chinese", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18nSrc = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const wrapped = i18nSrc.replace(
    /\(typeof window !== "undefined" \? window : globalThis\)/,
    "(sandbox)",
  );
  const sandbox: {
    ForklightI18n?: {
      t: (key: string, vars?: Record<string, string>) => string;
      setLang: (lang: string) => void;
      getLang: () => string;
    };
    localStorage?: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
    navigator?: { language: string };
    document?: { documentElement: { lang: string; setAttribute: () => void } };
  } = {
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
    },
    navigator: { language: "en" },
    document: { documentElement: { lang: "en", setAttribute: () => undefined } },
  };
  new Function("sandbox", wrapped)(sandbox);
  const i18n = sandbox.ForklightI18n;
  assert.ok(i18n, "ForklightI18n loads for Goal delivery basis checks");

  const helpers = [
    extractFunctionSource(src, "goalMilestoneDeliveryLabel"),
  ].join("\n");
  const api = new Function(
    "t",
    `${helpers}\nreturn { goalMilestoneDeliveryLabel };`,
  )((key: string, vars?: Record<string, string>) => i18n!.t(key, vars)) as {
    goalMilestoneDeliveryLabel: (basis?: string, fallback?: string) => string;
  };

  i18n!.setLang("en");
  assert.equal(
    api.goalMilestoneDeliveryLabel("amended-acceptance"),
    "Main repaired the current source and rechecked it with a corrected acceptance rule.",
  );
  assert.equal(
    api.goalMilestoneDeliveryLabel("original-acceptance"),
    "Main repaired the current source and rechecked it with the original acceptance rule.",
  );
  assert.equal(
    api.goalMilestoneDeliveryLabel("exact-candidate-integration"),
    "The exact accepted Candidate was integrated into the project.",
  );
  assert.doesNotMatch(
    api.goalMilestoneDeliveryLabel("amended-acceptance"),
    /Candidate Integration|automatic merge|npm |typecheck|contradictory/i,
  );

  i18n!.setLang("zh");
  const zhAmended = api.goalMilestoneDeliveryLabel("amended-acceptance");
  assert.equal(
    zhAmended,
    "Main 已修复当前源码，并用修正后的验收规则重新检查通过。",
  );
  assert.doesNotMatch(zhAmended, /Candidate|Integration|automatic|npm |typecheck/i);
  assert.ok(!/[A-Za-z]{4,}/.test(zhAmended.replace(/Main/g, "")),
    "zh primary amended delivery copy must not leak English technical prose");
  assert.equal(
    api.goalMilestoneDeliveryLabel("original-acceptance"),
    "Main 已修复当前源码，并用原有验收规则重新检查通过。",
  );
  assert.equal(
    api.goalMilestoneDeliveryLabel("exact-candidate-integration"),
    "已将精确接受的候选合入项目。",
  );
});

test("Hub Goal reason labels localize known stop causes without English leakage in zh", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18nSrc = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const wrapped = i18nSrc.replace(
    /\(typeof window !== "undefined" \? window : globalThis\)/,
    "(sandbox)",
  );
  const sandbox: {
    ForklightI18n?: {
      t: (key: string, vars?: Record<string, string>) => string;
      setLang: (lang: string) => void;
      getLang: () => string;
    };
    localStorage?: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
    navigator?: { language: string };
    document?: { documentElement: { lang: string; setAttribute: () => void } };
  } = {
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
    },
    navigator: { language: "en" },
    document: { documentElement: { lang: "en", setAttribute: () => undefined } },
  };
  new Function("sandbox", wrapped)(sandbox);
  const i18n = sandbox.ForklightI18n;
  assert.ok(i18n, "ForklightI18n loads for Goal reason behavior checks");

  const helpers = [
    extractFunctionSource(src, "goalReasonLabel"),
    extractFunctionSource(src, "goalStoryHappenedText"),
    extractFunctionSource(src, "goalStoryWaitingText"),
  ].join("\n");
  const api = new Function(
    "t",
    `${helpers}
    return {
      goalReasonLabel: goalReasonLabel,
      goalStoryHappenedText: goalStoryHappenedText,
      goalStoryWaitingText: goalStoryWaitingText
    };`,
  )((key: string, vars?: Record<string, string>) => i18n!.t(key, vars)) as {
    goalReasonLabel: (code: string | undefined, fallback?: string) => string;
    goalStoryHappenedText: (goal: Record<string, unknown>) => string;
    goalStoryWaitingText: (goal: Record<string, unknown>) => string;
  };

  const englishStored = {
    "no-progress":
      "No authoritative milestone evidence changed within the Goal no-progress window. Future Task admission is blocked; running Workers were not killed.",
    "no-new-evidence-cap":
      "Main advanced without new evidence too many times. Goal stopped; no Worker was launched.",
    "duration-exceeded":
      "Goal total duration limit was reached. Future Task admission is blocked; running Workers were not killed.",
    "main-stop":
      "Main stopped this Goal. History remains readable; active Tasks use Task authority.",
  } as const;

  i18n!.setLang("en");
  for (const [code, stored] of Object.entries(englishStored)) {
    const label = api.goalReasonLabel(code, stored);
    assert.equal(label, stored, `English ${code} stays accurate`);
    const story = api.goalStoryHappenedText({
      reasonCode: code,
      reason: stored,
      whatJustHappened: stored,
      status: "stopped",
    });
    assert.equal(story, stored, `English story for ${code} uses localized English cause`);
    const stoppedWaiting = api.goalStoryWaitingText({
      reasonCode: code,
      reason: stored,
      whatIsWaiting: "Goal is stopped; future Task admission is blocked.",
      status: "stopped",
    });
    assert.match(stoppedWaiting, /stopped|admission is blocked/i, `English stopped waiting for ${code}`);
  }

  i18n!.setLang("zh");
  const zhExpectations: Record<keyof typeof englishStored, RegExp> = {
    "no-progress": /无进展|权威里程碑/,
    "no-new-evidence-cap": /无新证据/,
    "duration-exceeded": /总时长/,
    "main-stop": /Main 已停止|停止此目标/,
  };
  for (const [code, stored] of Object.entries(englishStored)) {
    const label = api.goalReasonLabel(code, stored);
    assert.notEqual(label, stored, `Chinese ${code} must not keep stored English reason`);
    assert.doesNotMatch(
      label,
      /No authoritative milestone evidence|Main advanced without new evidence|Goal total duration limit was reached|Main stopped this Goal/,
      `Chinese ${code} must not expose English stop prose`,
    );
    assert.match(label, zhExpectations[code as keyof typeof englishStored], `Chinese ${code} is plain language`);
    const story = api.goalStoryHappenedText({
      reasonCode: code,
      reason: stored,
      whatJustHappened: stored,
      status: "stopped",
    });
    assert.equal(story, label, `Chinese story for ${code} uses localized cause`);
    assert.doesNotMatch(
      story,
      /No authoritative milestone evidence|Main advanced without new evidence|Goal total duration limit was reached|Main stopped this Goal/,
      `Chinese story for ${code} must not expose English reason`,
    );
    const stoppedLineReason = api.goalReasonLabel(code, stored);
    const stoppedSummary = i18n!.t("goalStoppedLine", {
      reason: stoppedLineReason,
      at: "12:00:00",
    });
    assert.doesNotMatch(
      stoppedSummary,
      /No authoritative milestone evidence|Main advanced without new evidence|Goal total duration limit was reached|Main stopped this Goal/,
      `Chinese stopped summary for ${code} must not interpolate English reason`,
    );
    assert.match(stoppedSummary, /已停止/, `Chinese stopped summary for ${code}`);
  }

  // Remaining closed codes also localize; unknown codes fall back safely.
  i18n!.setLang("zh");
  for (const code of [
    "correction-cap",
    "review-cap",
    "milestone-failed",
    "waiting-machine",
    "waiting-main-accept",
    "waiting-integration",
    "waiting-task",
    "goal-completed",
    "none",
  ]) {
    const label = api.goalReasonLabel(code, "English fallback must not win for known codes");
    assert.notEqual(label, "English fallback must not win for known codes", code);
    assert.notEqual(label, code, `${code} is not shown as a raw code`);
  }
  assert.equal(
    api.goalReasonLabel("legacy-unknown-code", "Stored legacy reason stays readable"),
    "Stored legacy reason stays readable",
    "unknown/legacy codes fall back to bounded stored reason",
  );
});

test("Hub Goal cards localize stopped/completed status and next actions without English leakage", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18nSrc = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const wrapped = i18nSrc.replace(
    /\(typeof window !== "undefined" \? window : globalThis\)/,
    "(sandbox)",
  );
  const sandbox: {
    ForklightI18n?: {
      t: (key: string, vars?: Record<string, string>) => string;
      setLang: (lang: string) => void;
      getLang: () => string;
    };
    localStorage?: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
    navigator?: { language: string };
    document?: { documentElement: { lang: string; setAttribute: () => void } };
  } = {
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
    },
    navigator: { language: "en" },
    document: { documentElement: { lang: "en", setAttribute: () => undefined } },
  };
  new Function("sandbox", wrapped)(sandbox);
  const i18n = sandbox.ForklightI18n;
  assert.ok(i18n, "ForklightI18n loads for Goal card presentation checks");

  const helpers = [
    extractFunctionSource(src, "statusLabel"),
    extractFunctionSource(src, "goalNextActionLabel"),
    extractFunctionSource(src, "goalReasonLabel"),
    extractFunctionSource(src, "goalStoryHappenedText"),
    extractFunctionSource(src, "goalOverviewSummaryText"),
  ].join("\n");
  const api = new Function(
    "t",
    `${helpers}
    return {
      statusLabel: statusLabel,
      goalNextActionLabel: goalNextActionLabel,
      goalReasonLabel: goalReasonLabel,
      goalStoryHappenedText: goalStoryHappenedText,
      goalOverviewSummaryText: goalOverviewSummaryText
    };`,
  )((key: string, vars?: Record<string, string>) => i18n!.t(key, vars)) as {
    statusLabel: (status: string) => string;
    goalNextActionLabel: (code?: string, fallback?: string) => string;
    goalReasonLabel: (code?: string, fallback?: string) => string;
    goalStoryHappenedText: (goal: Record<string, unknown>) => string;
    goalOverviewSummaryText: (goal: Record<string, unknown>) => string;
  };

  // Live-shaped projections: structured codes with English-stored prose.
  const stoppedGoal = {
    status: "stopped",
    reasonCode: "main-stop",
    reason: "Main stopped this Goal. History remains readable; active Tasks use Task authority.",
    whatJustHappened: "Main stopped this Goal. History remains readable; active Tasks use Task authority.",
    nextActionCode: "none",
    nextAction: "Main stopped this Goal. History remains readable; active Tasks use Task authority.",
  };
  const completedGoal = {
    status: "completed",
    reasonCode: "goal-completed",
    reason: "Every milestone gate is satisfied.",
    whatJustHappened: "Every milestone gate is satisfied.",
    nextActionCode: "none",
    nextAction: "Every milestone gate is satisfied.",
  };
  const activeGoal = {
    status: "active",
    reasonCode: "waiting-main-accept",
    reason: "Waiting for a fresh exact Main accept on this milestone.",
    nextActionCode: "main-accept",
    nextAction: "Record a fresh Main accept on the exact Candidate",
  };
  const legacyGoal = {
    status: "active",
    reasonCode: "legacy-unknown-reason",
    reason: "Stored legacy reason stays readable",
    nextActionCode: "legacy-unknown-action",
    nextAction: "Stored legacy next action stays readable",
  };
  const legacyTerminalGoal = {
    status: "stopped",
    reasonCode: "legacy-unknown-reason",
    reason: "Stored legacy terminal reason stays readable",
    whatJustHappened: "Stored legacy terminal reason stays readable",
    nextActionCode: "none",
    nextAction: "Main stopped this Goal. History remains readable; active Tasks use Task authority.",
  };

  i18n!.setLang("zh");
  assert.equal(api.statusLabel("stopped"), "已停止", "Chinese stopped badge is first-class, not unknown");
  assert.notEqual(api.statusLabel("stopped"), "状态未知");
  assert.equal(api.statusLabel("completed"), "已完成");

  const zhStoppedSummary = api.goalOverviewSummaryText(stoppedGoal);
  assert.match(zhStoppedSummary, /Main 已停止|停止此目标/, "Chinese stopped overview explains why it stopped");
  assert.doesNotMatch(zhStoppedSummary, /Main stopped this Goal/, "Chinese stopped overview must not leak English");
  assert.notEqual(zhStoppedSummary, i18n!.t("goalNextNone"), "Chinese stopped overview is not generic no-action");
  assert.equal(zhStoppedSummary, api.goalStoryHappenedText(stoppedGoal));

  const zhCompletedSummary = api.goalOverviewSummaryText(completedGoal);
  assert.match(zhCompletedSummary, /里程碑|闸门|满足/, "Chinese completed overview explains terminal cause");
  assert.doesNotMatch(
    zhCompletedSummary,
    /Every milestone gate is satisfied/,
    "Chinese completed overview must not leak English completion prose",
  );
  assert.notEqual(zhCompletedSummary, i18n!.t("goalNextNone"), "Chinese completed overview is not generic no-action");
  assert.equal(zhCompletedSummary, api.goalStoryHappenedText(completedGoal));

  const zhActiveSummary = api.goalOverviewSummaryText(activeGoal);
  assert.equal(zhActiveSummary, i18n!.t("goalNextMainAccept"), "Chinese active overview shows localized next action");
  assert.doesNotMatch(zhActiveSummary, /Record a fresh Main accept/, "Chinese active overview must not leak English next action");

  assert.equal(
    api.goalOverviewSummaryText(legacyGoal),
    "Stored legacy next action stays readable",
    "unknown nextActionCode preserves bounded stored text on active overview",
  );
  assert.equal(
    api.goalOverviewSummaryText(legacyTerminalGoal),
    "Stored legacy terminal reason stays readable",
    "unknown terminal reasonCode preserves bounded stored text on overview",
  );
  assert.equal(
    api.goalNextActionLabel(legacyGoal.nextActionCode, legacyGoal.nextAction),
    "Stored legacy next action stays readable",
    "unknown nextActionCode preserves bounded stored text in Chinese Hub",
  );
  assert.equal(
    api.goalReasonLabel(legacyGoal.reasonCode, legacyGoal.reason),
    "Stored legacy reason stays readable",
    "unknown reasonCode preserves bounded stored text in Chinese Hub",
  );

  i18n!.setLang("en");
  assert.equal(api.statusLabel("stopped"), "Stopped", "English stopped badge is first-class");
  assert.notEqual(api.statusLabel("stopped"), "unknown");
  assert.equal(api.statusLabel("completed"), "completed");
  assert.equal(
    api.goalOverviewSummaryText(stoppedGoal),
    stoppedGoal.reason,
    "English stopped overview explains main-stop cause",
  );
  assert.equal(
    api.goalOverviewSummaryText(completedGoal),
    completedGoal.reason,
    "English completed overview explains goal-completed cause",
  );
  assert.equal(
    api.goalOverviewSummaryText(activeGoal),
    i18n!.t("goalNextMainAccept"),
    "English active overview shows structured next action",
  );
  assert.equal(
    api.goalOverviewSummaryText(legacyGoal),
    "Stored legacy next action stays readable",
    "unknown nextActionCode preserves bounded stored text in English Hub",
  );
  assert.equal(
    api.goalNextActionLabel("advance", "Some other stored English"),
    i18n!.t("goalNextAdvance"),
    "known nextActionCode wins over stored English prose",
  );
  i18n!.setLang("zh");
  assert.equal(
    api.goalNextActionLabel("advance", "Explicitly advance the Goal if you believe new evidence exists"),
    i18n!.t("goalNextAdvance"),
    "known nextActionCode localizes in Chinese over stored English",
  );
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
    sessionStorageCalls.every((call) =>
      call.includes("HUB_TOKEN_SESSION_KEY") || call.includes("fl-work-collapse")),
    "sessionStorage is limited to the Hub token and the Work collapse preference",
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

test("Hub Worker editor filters impossible Provider/runtime pairings before save", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const compatible = new Function(`
    ${extractFunctionSource(src, "workerModelCompatible")}
    return workerModelCompatible;
  `)() as (runtime: string, model: { provider?: string }) => boolean;
  assert.equal(compatible("grok-build", { provider: "xai" }), true);
  assert.equal(compatible("grok-build", { provider: "deepseek" }), false);
  assert.equal(compatible("claude-code", { provider: "xai" }), false);
  assert.equal(compatible("claude-code", { provider: "minimax" }), true);
  assert.equal(compatible("claude-code", {}), false);

  const workerStart = src.indexOf("function rWorker()");
  const workerEnd = src.indexOf("\nfunction rLimits()", workerStart);
  const block = src.slice(workerStart, workerEnd);
  assert.ok(block.includes("syncCompatibleModels"));
  assert.ok(block.includes("workerModelCompatible(selR.value, mc)"));
  assert.ok(block.includes('selR.addEventListener("change"'));
  assert.ok(block.includes("syncCompatibleModels(\"\")"));
  assert.ok(block.includes("workersModelNoCompatible"));
  assert.ok(block.includes("if(!selM.value)"), "save remains blocked with no compatible model");
});

test("Hub Worker cards explain canonical readiness in both languages", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const story = new Function("t", `
    ${extractFunctionSource(src, "networkPolicySummary")}
    ${extractFunctionSource(src, "workerConnectionStory")}
    return workerConnectionStory;
  `)((key: string) => key) as (
    readiness: { state: string; reason: string; nextAction: string },
    mode?: string,
  ) => {
    label: string; tone: string; conclusion: string; next: string | null; route: string;
  };
  const launchable = story({
    state: "launchable",
    reason: "connection-unverified",
    nextAction: "run-smoke-check",
  }, "inherit");
  assert.deepEqual(launchable, {
    label: "workersReadinessLaunchable",
    tone: "badge-info",
    conclusion: "workersStoryLaunchUnverifiedInherit",
    next: "workersReadinessNextSmoke",
    route: "workersNetworkCardInherit",
  });
  const blocked = story({
    state: "blocked",
    reason: "authentication-missing",
    nextAction: "configure-authentication",
  }, "inherit");
  assert.equal(blocked.conclusion, "workersStoryBlockedAuth");
  assert.equal(blocked.next, "workersReadinessNextAuth");
  assert.ok(src.includes("workerReadinessFor(prof.id)"));
  assert.ok(src.includes("readiness.checks"));
  for (const phrase of [
    "Can start; connection check recommended",
    "可以开始，建议先检查连接",
    "hasn't been checked yet. This Worker follows ForkLight's current network.",
    "还没有检查真实连接。此 Worker 跟随 ForkLight 当前的网络。",
  ]) {
    assert.ok(i18n.includes(phrase), phrase);
  }
});

test("Hub Worker editor exposes network route fields and truthful card copy", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const workerStart = src.indexOf("function rWorker()");
  const workerEnd = src.indexOf("\nfunction rLimits()", workerStart);
  const block = src.slice(workerStart, workerEnd);
  assert.ok(block.includes("fl-wp-network-mode"), "network mode select exists in the editor");
  assert.ok(block.includes("fl-wp-network-http"), "HTTP proxy input exists in the editor");
  assert.ok(block.includes("fl-wp-network-https"), "HTTPS proxy input exists in the editor");
  assert.ok(block.includes("fl-wp-network-noproxy"), "no-proxy input exists in the editor");
  assert.ok(block.includes("profile.networkPolicy = { mode: \"custom-proxy\", httpProxy"), "custom proxy is collected on save");
  assert.ok(block.includes("profile.networkPolicy = { mode: \"direct\" }"), "direct is collected on save");
  assert.ok(block.includes("workersNetworkProxyRequired"), "missing proxy URL is rejected with a fixed message");
  assert.ok(block.includes("workerConnectionStory(readiness"), "card composes one connection story from readiness + mode");
  assert.ok(block.includes("t(\"workersNetworkCardNotProof\")"), "route truth remains under the technical disclosure");
  assert.ok(!block.includes("networkPolicySummary(prof.networkPolicy)"),
    "the default story no longer repeats a standalone route line");

  const summary = new Function("t", `
    ${extractFunctionSource(src, "networkPolicySummary")}
    return networkPolicySummary;
  `)((key: string) => key) as (policy: {
    mode?: string;
    httpProxy?: string;
    httpsProxy?: string;
    noProxy?: string;
  } | undefined) => string;
  assert.equal(summary(undefined), "workersNetworkCardInherit");
  assert.equal(summary({ mode: "inherit" }), "workersNetworkCardInherit");
  assert.equal(summary({ mode: "direct" }), "workersNetworkCardDirect");
  assert.equal(summary({ mode: "custom-proxy", httpProxy: "http://127.0.0.1:7890" }), "workersNetworkCardCustom");
  // The full custom-proxy label+input group hides together outside custom mode,
  // never just the inner input.
  assert.ok(block.includes("netHttpField.wrap.hidden = !custom"), "HTTP proxy label+input group hides with mode");
  assert.ok(block.includes("netHttpsField.wrap.hidden = !custom"), "HTTPS proxy label+input group hides with mode");
  assert.ok(block.includes("netNoProxyField.wrap.hidden = !custom"), "no-proxy label+input group hides with mode");
});

test("Hub i18n carries network route copy in both languages", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  for (const phrase of [
    "Follow ForkLight's current network",
    "Direct connection (no proxy)",
    "Custom proxy",
    "This is the configured route, not proof the connection works. Only a real Worker run proves it.",
    "跟随 ForkLight 当前的网络",
    "直接连接（不使用代理）",
    "自定义代理",
    "这只是配置的路由，并不代表连接一定可用；只有真实的 Worker 运行才能证明。",
  ]) {
    assert.ok(i18n.includes(phrase), phrase);
  }
  // Plain-language copy must avoid internal Daemon/Provider vocabulary and must
  // keep the route separate from proven connectivity. Bound the slice to the
  // network block (next sibling key) so unrelated copy cannot fail the check.
  const parts = splitI18n(i18n);
  const enNetStart = parts.enSection.indexOf("workersNetworkLabel");
  const enNetEnd = parts.enSection.indexOf("mainGuideTitle", enNetStart);
  const enNet = parts.enSection.slice(enNetStart, enNetEnd > 0 ? enNetEnd : parts.enSection.length);
  const zhNetStart = parts.zhSection.indexOf("workersNetworkLabel");
  const zhNetEnd = parts.zhSection.indexOf("mainGuideTitle", zhNetStart);
  const zhNet = parts.zhSection.slice(zhNetStart, zhNetEnd > 0 ? zhNetEnd : parts.zhSection.length);
  assert.ok(!enNet.includes("Daemon"), "English network copy avoids internal Daemon vocabulary");
  assert.ok(!enNet.includes("Provider"), "English network copy avoids Provider vocabulary");
  assert.ok(!zhNet.includes("Daemon"), "Chinese network copy avoids internal Daemon vocabulary");
  assert.ok(!zhNet.includes("Provider"), "Chinese network copy avoids Provider vocabulary");
  assert.ok(enNet.includes("not proof the connection works"), "English separates configured route from proof");
  assert.ok(zhNet.includes("并不代表连接一定可用"), "Chinese separates configured route from proof");
});

test("Hub Worker card connection story is one privacy-safe conclusion per state", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const storySource = extractFunctionSource(src, "workerConnectionStory");
  // Privacy-safe: the pure helper only reads the frozen network mode, never the
  // proxy URL fields or credentials.
  assert.ok(!storySource.includes("httpProxy"), "story helper never reads the proxy URL");
  assert.ok(!storySource.includes("httpsProxy"), "story helper never reads the HTTPS proxy URL");
  assert.ok(!storySource.includes("noProxy"), "story helper never reads the no-proxy list");

  const story = new Function("t", `
    ${extractFunctionSource(src, "networkPolicySummary")}
    ${storySource}
    return workerConnectionStory;
  `)((key: string) => key) as (
    readiness: { state: string; reason: string; nextAction: string },
    mode?: string,
  ) => {
    label: string; tone: string; conclusion: string; next: string | null; route: string;
  };

  // Ready + custom proxy: the recent check passed and the configured local
  // proxy form ONE conclusion; no redundant no-action line, no generic caveat.
  const ready = story({ state: "ready", reason: "ready", nextAction: "none" }, "custom-proxy");
  assert.deepEqual(ready, {
    label: "workersReadinessReady",
    tone: "badge-ok",
    conclusion: "workersStoryReadyCustom",
    next: null,
    route: "workersNetworkCardCustom",
  });

  // Launchable + stale inherited connection: both facts in one conclusion and
  // the bounded smoke-check next action exactly once.
  const stale = story(
    { state: "launchable", reason: "connection-stale", nextAction: "run-smoke-check" },
    "inherit",
  );
  assert.deepEqual(stale, {
    label: "workersReadinessLaunchable",
    tone: "badge-info",
    conclusion: "workersStoryLaunchStaleInherit",
    next: "workersReadinessNextSmoke",
    route: "workersNetworkCardInherit",
  });

  // Blocked: the primary conclusion names what prevents launch and the recovery
  // action; the route mode never changes or overstates the story.
  const blockedAuth = story(
    { state: "blocked", reason: "authentication-missing", nextAction: "configure-authentication" },
    "custom-proxy",
  );
  assert.equal(blockedAuth.conclusion, "workersStoryBlockedAuth");
  assert.equal(blockedAuth.next, "workersReadinessNextAuth");
  assert.equal(blockedAuth.tone, "badge-warn");
  const blockedAuthDirect = story(
    { state: "blocked", reason: "authentication-missing", nextAction: "configure-authentication" },
    "direct",
  );
  assert.equal(blockedAuthDirect.conclusion, "workersStoryBlockedAuth", "route mode does not change the blocked story");
  const blockedRuntime = story(
    { state: "blocked", reason: "runtime-unavailable", nextAction: "fix-runtime" },
    "inherit",
  );
  assert.equal(blockedRuntime.conclusion, "workersStoryBlockedRuntime");
  assert.equal(blockedRuntime.next, "workersReadinessNextRuntime");
});

test("Hub Worker card leads with a connection conclusion and keeps execution facts under disclosure", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const workerStart = src.indexOf("function rWorker()");
  const workerEnd = src.indexOf("\nfunction rLimits()", workerStart);
  const block = src.slice(workerStart, workerEnd);

  // Stable markers for the connection story and the execution-details disclosure.
  assert.ok(block.includes("worker-connection"), "connection story has a stable data-fl-role marker");
  assert.ok(block.includes("worker-execution-details"), "execution details have a stable data-fl-role marker");
  assert.ok(block.includes("workerConnectionStory(readiness"), "card composes one connection story");
  assert.ok(block.indexOf("worker-connection") < block.indexOf("worker-execution-details"),
    "connection conclusion leads before the execution disclosure");

  // The generic route caveat no longer repeats on the default story surface; it
  // stays available exactly once inside the technical disclosure.
  const storyStart = block.indexOf('var story = h("div", "profile-story")');
  const storyEnd = block.indexOf("cardEl.appendChild(story);", storyStart);
  const storySlice = block.slice(storyStart, storyEnd);
  assert.ok(!storySlice.includes("workersNetworkCardNotProof"), "no repeated route caveat on the default story");
  assert.ok(block.includes("t(\"workersNetworkCardNotProof\")"), "route truth remains under the technical disclosure");

  // All prior execution, policy, readiness-check, identity, pricing, and action
  // fact builders remain consumed by the card.
  for (const key of [
    "workersCardDefaultPurpose",
    "workersCardExecutionIdentity",
    "workersCardExecutionBehavior",
    "workersCardBudgetUnlimited",
    "workersCardBudgetInherited",
    "workersCardBudgetLimited",
    "workersCardEffort",
    "workersCardNoEffectiveProgressLimited",
    "workersCardNoEffectiveProgressInherited",
    "workersCardNoEffectiveProgressUnlimited",
    "workersCardAttempts",
    "workersCardAttemptsNoExtra",
    "workersCardAttemptsInherited",
    "workersCardAdaptationOff",
    "workersCardAdaptationOn",
    "workersCardAdaptationInherited",
    "workersQualitySummaryOn",
    "workersQualitySummaryOff",
    "workersCardTechnicalDetails",
    "workersReadinessTechnical",
    "workersReadinessCheckConnection",
    "workersPricingRouteCardLabel",
  ]) {
    assert.ok(block.includes(`"${key}"`), `card consumes ${key}`);
  }

  // The connection conclusion is bilingual and the default-surface copy avoids
  // internal Provider/Daemon vocabulary.
  for (const phrase of ["workersStoryReadyCustom:", "workersStoryLaunchStaleInherit:", "workersStoryBlockedAuth:"]) {
    assert.ok(i18n.indexOf(phrase) !== i18n.lastIndexOf(phrase), `connection story key is bilingual: ${phrase}`);
  }
  assert.ok(i18n.includes("uses the configured local proxy"), "en ready+custom conclusion");
  assert.ok(i18n.includes("使用已配置的本地代理"), "zh ready+custom conclusion");
  assert.ok(i18n.includes("previous connection check is stale"), "en stale conclusion");
  assert.ok(i18n.includes("之前的连接检查已经过期"), "zh stale conclusion");

  const parts = splitI18n(i18n);
  const enStoryStart = parts.enSection.indexOf("workersCardExecutionBehavior");
  const enStoryEnd = parts.enSection.indexOf("workersCardTechnicalDetails", enStoryStart);
  const enStory = parts.enSection.slice(enStoryStart, enStoryEnd > 0 ? enStoryEnd : parts.enSection.length);
  const zhStoryStart = parts.zhSection.indexOf("workersCardExecutionBehavior");
  const zhStoryEnd = parts.zhSection.indexOf("workersCardTechnicalDetails", zhStoryStart);
  const zhStory = parts.zhSection.slice(zhStoryStart, zhStoryEnd > 0 ? zhStoryEnd : parts.zhSection.length);
  assert.ok(!enStory.includes("Provider"), "en default card story avoids Provider vocabulary");
  assert.ok(!enStory.includes("Daemon"), "en default card story avoids Daemon vocabulary");
  assert.ok(!zhStory.includes("Provider"), "zh default card story avoids Provider vocabulary");
  assert.ok(!zhStory.includes("Daemon"), "zh default card story avoids Daemon vocabulary");

  // The next-action copy shown on the default surface also avoids Provider.
  assert.ok(i18n.includes("Configure the API key or supported local sign-in."), "en auth next action avoids Provider");
  assert.ok(i18n.includes("配置 API Key 或支持的本地登录。"), "zh auth next action avoids Provider");
  assert.ok(i18n.includes("Check the connection settings before spending Tokens on another task."),
    "en connection next action avoids Provider");
  assert.ok(i18n.includes("先检查连接设置，再为新任务花费 Token。"), "zh connection next action avoids Provider");

  assert.ok(css.includes(".profile-story-connection"), "connection story has a wrapped layout");
  assert.ok(css.includes(".profile-story-conclusion"), "conclusion has its own reading block");
  assert.ok(css.includes("flex-wrap"), "connection block wraps on narrow viewports");
});

test("Hub model-routing unsaved state compares semantic values", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const keysStart = src.indexOf("var MR_WEIGHT_KEYS = ");
  const keysEnd = src.indexOf("];", keysStart);
  assert.ok(keysStart >= 0 && keysEnd > keysStart);
  const helperSource = [
    src.slice(keysStart, keysEnd + 2),
    extractFunctionSource(src, "mrWeightDefault"),
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
      correctionChurn: 0.2, firstPassSuccess: 0.5, officialCost: 0, duration: 0,
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

test("Hub Insights routing-evidence coverage is isolated, bilingual, and non-ranking", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");

  // Isolated slice; must not sit inside a global all-ops Promise.all
  assert.ok(src.includes("SLICE_MAP"), "page dependency map exists");
  assert.ok(src.includes("fetchSlice"), "generic isolated slice fetcher");
  assert.ok(src.includes("routingCoverage"), "routing coverage slice key in map");
  assert.ok(src.includes("/api/ops/routing-evidence-coverage"), "bridge URL on the wire");
  assert.ok(src.includes("S.routingCoverage"), "cached coverage state");
  assert.ok(src.includes("S.routingCoverageError"), "isolated failure state");
  assert.ok(!src.match(/Promise\.all\(\[[\s\S]*fetchJSON.*ops\/board[\s\S]*fetchJSON.*ops\/tasks[\s\S]*fetchJSON.*ops\/competitions[\s\S]*fetchJSON.*ops\/stats[\s\S]*fetchJSON.*ops\/settings[\s\S]*fetchJSON.*ops\/sample-task[\s\S]*fetchJSON.*ops\/goals/), "no bulk all-endpoint Promise.all with 8 ops");

  // Renderer + states
  assert.ok(src.includes("function renderRoutingCoverage"), "coverage renderer");
  assert.ok(src.includes("function renderRoutingCoverageUnavailable"), "unavailable renderer");
  assert.ok(src.includes("function routingCoverageState"), "empty/partial/complete state helper");
  assert.ok(src.includes('data-fl-role", "routing-evidence-coverage"'), "stable panel marker");
  assert.ok(src.includes('return "empty"'), "empty state branch");
  assert.ok(src.includes('return "complete"'), "complete state branch");
  assert.ok(src.includes('return "partial"'), "partial state branch");

  // rStats places coverage before economics / provider outcome cards
  const rStatsIdx = src.indexOf("function rStats()");
  assert.ok(rStatsIdx > 0, "rStats present");
  const nextFn = src.indexOf("function ", rStatsIdx + 1);
  const rStatsBlock = src.slice(rStatsIdx, nextFn > 0 ? nextFn : src.length);
  const recIdx = rStatsBlock.indexOf("renderRoutingCoverage");
  const econIdx = rStatsBlock.indexOf("renderPortfolioEconomics");
  const statsSectionIdx = rStatsBlock.indexOf("statsProviderSectionTitle");
  assert.ok(recIdx > 0, "rStats renders routing coverage");

  // Main-direct decisions panel
  assert.ok(src.includes('data-fl-role", "main-direct-decisions"'), "main-direct decisions panel marker");
  assert.ok(src.includes('data-fl-role", "main-direct-panel"'), "main-direct panel marker");
  assert.ok(src.includes('data-fl-role", "main-direct-counts"'), "main-direct counts marker");
  assert.ok(src.includes('data-fl-role", "main-direct-recent-entry"'), "main-direct recent entry marker");
  assert.ok(src.includes("function renderMainDirectDecisions"), "main-direct renderer");
  assert.ok(src.includes("function renderMainDirectDecisionsUnavailable"), "main-direct unavailable renderer");
  assert.ok(rStatsBlock.indexOf("renderMainDirectDecisions") > 0, "rStats renders main-direct decisions");
  assert.ok(econIdx > recIdx, "coverage appears before economics");
  assert.ok(statsSectionIdx > recIdx, "coverage appears before provider outcome cards");
  // Backend owns counts — browser must not recompute ratios or eligibility
  assert.ok(!/withTaskClassCount\s*\/\s*/.test(rStatsBlock), "no browser-side class ratio");
  assert.ok(!/eligibleTerminalTaskCount\s*-\s*/.test(rStatsBlock), "no browser-side subtraction");
  const recRenderIdx = src.indexOf("function renderRoutingCoverage(");
  const recRenderNext = src.indexOf("function ", recRenderIdx + 1);
  const recRenderBlock = src.slice(recRenderIdx, recRenderNext > 0 ? recRenderNext : src.length);
  assert.ok(!recRenderBlock.includes("progressbar") && !recRenderBlock.includes("progress-bar"),
    "no progress bar for coverage");
  assert.ok(!/model-rank|auto(?:matic)?\s+competition/i.test(recRenderBlock));
  // Two-section layout: traceability then comparison readiness
  assert.ok(recRenderBlock.includes("recTraceHeading"), "traceability heading present");
  assert.ok(recRenderBlock.includes("recReadinessHeading"), "comparison readiness heading present");
  assert.ok(recRenderBlock.includes("routing-readiness-counts"), "readiness counts section exists");
  assert.ok(recRenderBlock.includes("routing-comparable-subcounts"), "comparable sub-counts section exists");

  // Bilingual keys: meaning, four counts, caveat, next actions, unavailable,
  // plus new readiness keys
  const recKeys = [
    "recTitle", "recMeaning", "recTotalLabel", "recClassLabel", "recFamilyLabel",
    "recDecisionLabel", "recDiversity",
    "recTraceHeading", "recTraceExplain",
    "recReadinessHeading",
    "recSingleWorkerLabel", "recSingleWorkerExplain",
    "recComparableLabel", "recComparableExplain",
    "recUnknownLabel", "recUnknownExplain",
    "recUnusableLabel", "recUnusableExplain",
    "recComparableSubcounts", "recNoDecisionsToCompare",
    "recCaveat", "recEmpty", "recEmptyNext",
    "recPartial", "recPartialNext", "recComplete", "recCompleteNext",
    "recLoading", "recUnavailableBridgeHint", "recUnavailableUnknown",
  ];
  for (const key of recKeys) {
    const occurrences = i18n.split(`${key}:`).length - 1;
    assert.ok(occurrences >= 2, `${key} must exist in both locales`);
  }

  const enSection = i18n.slice(0, i18n.indexOf("zh: {"));
  const zhSection = i18n.slice(i18n.indexOf("zh: {"));
  const enMeaning = enSection.match(/recMeaning:\s*"([^"]+)"/)?.[1] ?? "";
  const zhMeaning = zhSection.match(/recMeaning:\s*"([^"]+)"/)?.[1] ?? "";
  const enCaveat = enSection.match(/recCaveat:\s*"([^"]+)"/)?.[1] ?? "";
  const zhCaveat = zhSection.match(/recCaveat:\s*"([^"]+)"/)?.[1] ?? "";
  const enUnavailable = enSection.match(/recUnavailableBridgeHint:\s*"([^"]+)"/)?.[1] ?? "";
  const zhUnavailable = zhSection.match(/recUnavailableBridgeHint:\s*"([^"]+)"/)?.[1] ?? "";

  assert.ok(/evidence completeness/i.test(enMeaning), "en meaning is about completeness");
  assert.ok(!/poor model|model rank|zero-quality/i.test(enMeaning));
  assert.ok(zhMeaning.includes("证据是否齐全"), "zh meaning is about completeness");
  assert.ok(!zhMeaning.includes("模型排名") && !zhMeaning.includes("表现差"));
  assert.ok(/unavailable evidence/i.test(enCaveat), "en caveat marks missing as unavailable");
  assert.ok(/do not report a model outcome/i.test(enCaveat), "en caveat denies model-outcome claims");
  assert.ok(!/zero-quality|poor model|model rank|model ranking|performed poorly|low model quality/i.test(enCaveat));
  assert.ok(
    zhCaveat.includes("缺少可用证据") || zhCaveat.includes("证据不可用"),
    "zh caveat marks missing as unavailable",
  );
  assert.ok(
    zhCaveat.includes("并不报告任何模型结果") || zhCaveat.includes("不报告任何模型结果"),
    "zh caveat denies model-outcome claims",
  );
  assert.ok(!zhCaveat.includes("模型排名") && !zhCaveat.includes("表现差") && !zhCaveat.includes("模型质量差"));
  assert.ok(enUnavailable.toLowerCase().includes("task service"), "en bridge uses task service");
  assert.ok(!/\bdaemon\b/i.test(enUnavailable), "en bridge avoids daemon jargon");
  assert.ok(zhUnavailable.includes("任务服务"), "zh bridge uses 任务服务");
  assert.ok(!zhUnavailable.includes("Daemon"), "zh bridge avoids Daemon jargon");

  // New readiness copy: bilingual traceability vs fair comparison
  const enTrace = enSection.match(/recTraceExplain:\s*"([^"]+)"/)?.[1] ?? "";
  const zhTrace = zhSection.match(/recTraceExplain:\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(/traceable record/i.test(enTrace), "en trace explains traceability");
  assert.ok(/prerequisite/i.test(enTrace), "en trace distinguishes record from comparison");
  assert.ok(zhTrace.includes("可追溯"), "zh trace says 可追溯");
  assert.ok(zhTrace.includes("前提") || zhTrace.includes("公平比较"), "zh trace distinguishes record from comparison");

  const enSingleExplain = enSection.match(/recSingleWorkerExplain:\s*"([^"]+)"/)?.[1] ?? "";
  const zhSingleExplain = zhSection.match(/recSingleWorkerExplain:\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(/intentional/i.test(enSingleExplain) || /valid cost/i.test(enSingleExplain) || /cost-saving/i.test(enSingleExplain),
    "en single-Worker is intentional, not failure");
  assert.ok(!/missed comparison|failure|incomplete/i.test(enSingleExplain),
    "en single-Worker is not described as failure");
  assert.ok(zhSingleExplain.includes("有意") || zhSingleExplain.includes("节省成本") || zhSingleExplain.includes("不是"),
    "zh single-Worker is described as intentional");
  assert.ok(!zhSingleExplain.includes("遗漏") && !zhSingleExplain.includes("失败"),
    "zh single-Worker is not described as missed comparison");

  const enUnknownExplain = enSection.match(/recUnknownExplain:\s*"([^"]+)"/)?.[1] ?? "";
  const zhUnknownExplain = zhSection.match(/recUnknownExplain:\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(/not.*(?:ranking|tie|automatic)/i.test(enUnknownExplain),
    "en unknown is not a ranking, tie, or automatic result");
  assert.ok(/Main judgment/i.test(enUnknownExplain),
    "en unknown labels it Main judgment");
  assert.ok((zhUnknownExplain.includes("Main") || zhUnknownExplain.includes("判断")),
    "zh unknown states Main 判断");
  // The text explicitly rejects ranking/tie/automatic — verify those denials exist
  assert.ok(zhUnknownExplain.includes("不是模型排名"), "zh unknown rejects model ranking");
  assert.ok(zhUnknownExplain.includes("不是平局"), "zh unknown rejects tie claim");
  assert.ok(zhUnknownExplain.includes("不是自动"), "zh unknown rejects automatic claim");
  // No positive ranking/winner claims anywhere in the readiness copy
  assert.ok(!/winner|best.?model|automatic.?choice|Competition.?ran/i.test(enUnknownExplain),
    "en unknown has no winner/best-model/automatic/Competition claims");

  // Assert no winner / best-model / automatic-choice / Competition-ran copy exists
  for (const section of [enSection, zhSection]) {
    const recBlock = section.slice(section.indexOf("recTitle:"), section.indexOf("econEvidenceSectionTitle:"));
    assert.ok(!/\bwinner\b/i.test(recBlock), "no winner claim in coverage copy");
    assert.ok(!/\bbest.?model\b/i.test(recBlock), "no best-model claim in coverage copy");
    assert.ok(!/\bautomatic.?choice\b/i.test(recBlock), "no automatic-choice claim in coverage copy");
    assert.ok(!/\bCompetition.?ran\b/i.test(recBlock), "no Competition-ran claim in coverage copy");
  }

  // Privacy: user-facing copy must not expose raw internal field codes
  for (const section of [enSection, zhSection]) {
    const recBlock = section.slice(section.indexOf("recTitle:"), section.indexOf("econEvidenceSectionTitle:"));
    assert.ok(!recBlock.includes("taskClass"), "no raw taskClass in coverage copy");
    assert.ok(!recBlock.includes("routingDecision"), "no raw routingDecision in coverage copy");
    assert.ok(!recBlock.includes("taskFamily"), "no raw taskFamily in coverage copy");
  }
});

test("Hub Insights economics summary renderer exposes truthful evidence", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  // Polling and bridge surface
  assert.ok(src.includes("economics"), "economics slice key in dependency map");
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

test("Hub explains handled failures bilingually and never calls them successful", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // Overview attention consumes canonical board placement, not raw status.
  assert.ok(src.includes('taskBoardScope(task) === "now"'),
    "Overview attention must use canonical board placement");
  // History groups handled failures separately from delivered/stopped.
  assert.ok(src.includes('"attention-resolved"') || src.includes("attention-resolved"),
    "History group recognizes attention-resolved");
  assert.ok(src.includes("boardHistoryHandled"), "history handled group label key");
  // Actions tab wires confirmation-gated resolve and reopen routes.
  assert.ok(src.includes('"/resolve"'), "resolve route is wired");
  assert.ok(src.includes('"/reopen"'), "reopen route is wired");
  assert.ok(src.includes("attentionResolveConfirm"), "resolve confirmation i18n key");
  assert.ok(src.includes("attentionReopenConfirm"), "reopen confirmation i18n key");
  // Bilingual copy ships for the closed resolution vocabulary.
  for (const key of [
    "attentionResolveTitle", "attentionResolveBtn", "attentionReopenBtn",
    "attentionResolvedReasonEnvironment", "attentionResolvedReasonSuperseded",
    "attentionResolvedReasonHandledElsewhere", "attentionResolvedReasonNoLongerNeeded",
    "journeyNextReopen", "boardHistoryHandled",
  ]) {
    assert.ok(i18n.includes(key + ":"), `i18n has ${key}`);
  }
  assert.ok(i18n.includes("Mark as handled"), "en resolve title");
  assert.ok(i18n.includes("标记为已处理"), "zh resolve title");
  assert.ok(i18n.includes("Reopen"), "en reopen button");
  assert.ok(i18n.includes("重新打开"), "zh reopen button");
  // Primary copy explains how the problem was handled without jargon-leading
  // internal terms, and never claims delivery or success.
  assert.ok(i18n.includes("How this was handled"), "en leads with how handled");
  assert.ok(i18n.includes("这个问题后来怎么处理"), "zh leads with how handled");
  assert.ok(i18n.includes("Related Task"), "en related-Task label");
  assert.ok(i18n.includes("相关任务（可选）"), "zh related-Task label");
  assert.ok(!src.includes("attentionResolvedDelivered"), "no delivered claim");
  assert.ok(i18n.includes("attentionResolvedWhat") && i18n.includes("该问题已被处理"),
    "zh explains the problem was handled, not succeeded");
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

test("Hub board wires a two-step preview-then-submit flow with revision binding", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // Read-only preview route is wired; submit carries the bound digest.
  assert.ok(src.includes("/api/ops/tasks/preview"), "preview API route");
  assert.ok(src.includes("previewRevisionDigest"), "submit payload carries the preview revision digest");
  assert.ok(!src.includes("expectedPreviewRevisionDigest"),
    "client sends the safe previewRevisionDigest field, not the daemon-internal name");
  // Two-step state: path input value and stored preview survive a re-render.
  assert.ok(src.includes("boardSubmitPath"), "path input state is session-local");
  assert.ok(src.includes("boardPreview"), "preview state is session-local");
  assert.ok(src.includes("taskSubmitPreviewBtn"), "preview button i18n key");
  assert.ok(src.includes("renderSubmitPreviewFacts"), "preview facts renderer");
  assert.ok(src.includes("clearSubmitPreview"), "preview invalidation helper");
  // Editing the path clears the stored preview so the old revision cannot be
  // reused for a new path.
  const inputIdx = src.indexOf('pathIn.addEventListener("input"');
  assert.ok(inputIdx > 0, "path input has an input listener");
  const inputEnd = src.indexOf("});", inputIdx);
  const inputBlock = src.slice(inputIdx, inputEnd > 0 ? inputEnd : src.length);
  assert.ok(inputBlock.includes("clearSubmitPreview"),
    "path edit invalidates the stored preview");
  // Submit is disabled until a fresh preview exists.
  assert.ok(src.includes("submitBtn.disabled = true"));
  assert.ok(src.includes("submitBtn.disabled = false"));
  // Beginner copy states no Task has started; raw digest is behind a disclosure.
  assert.ok(src.includes("taskSubmitNoTaskStarted"), "no-Task-started note");
  assert.ok(src.includes("taskSubmitTechnical"), "technical disclosure for digest");
  assert.ok(src.includes("taskSubmitDigestLabel"), "digest label in technical disclosure");
  assert.ok(src.includes("taskSubmitStale"), "stale-preview instruction");
  assert.ok(src.includes("submitBtn.disabled = !boardPreview"),
    "submit stays disabled after success or rejection clears the preview");
  // No raw path/command/endpoint is rendered inside the preview facts renderer.
  const factsIdx = src.indexOf("function renderSubmitPreviewFacts");
  assert.ok(factsIdx > 0);
  const factsEnd = src.indexOf("function rTasks()", factsIdx);
  const factsBlock = src.slice(factsIdx, factsEnd > 0 ? factsEnd : src.length);
  assert.ok(!factsBlock.includes("spec.project"), "preview facts never read the project path");
  assert.ok(!factsBlock.includes("keychainService"), "preview facts never read keychain");
  assert.ok(!factsBlock.includes("endpoint"), "preview facts never read endpoint");
  assert.ok(!factsBlock.includes("acceptance.commands"), "preview facts never read commands");

  const guardStart = src.indexOf("function submitPreviewRequestIsCurrent");
  const guardEnd = src.indexOf("function taskMatchesBoardFilter", guardStart);
  assert.ok(guardStart > 0 && guardEnd > guardStart, "preview response guard is defined");
  const guardSource = src.slice(guardStart, guardEnd);
  const guard = new Function(
    "requestCounter",
    `${guardSource}\nboardPreviewRequestId = requestCounter; return submitPreviewRequestIsCurrent;`,
  )(4) as (requestId: number, requestedPath: string, currentPath: string) => boolean;
  assert.equal(guard(4, "/tmp/a.yaml", "/tmp/a.yaml"), true,
    "the current response can populate the preview");
  assert.equal(guard(3, "/tmp/a.yaml", "/tmp/a.yaml"), false,
    "an older response cannot overwrite a newer request");
  assert.equal(guard(4, "/tmp/a.yaml", "/tmp/b.yaml"), false,
    "editing the path while preview is in flight invalidates its response");
});

test("Hub i18n carries two-step preview strings in both languages", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const zhSection = i18n.slice(i18n.indexOf("zh: {"));
  const enSection = i18n.slice(0, i18n.indexOf("zh: {"));
  for (const key of [
    "taskSubmitPreviewBtn",
    "taskSubmitPreviewEmpty",
    "taskSubmitPreviewFailed",
    "taskSubmitPreviewRequired",
    "taskSubmitStale",
    "taskSubmitNoTaskStarted",
    "taskSubmitFactWorker",
    "taskSubmitFactModel",
    "taskSubmitFactRuntime",
    "taskSubmitFactBudget",
    "taskSubmitFactAttempts",
    "taskSubmitFactAdaptation",
    "taskSubmitFactQuality",
    "taskSubmitFactIntegration",
    "taskSubmitBudgetUnlimited",
    "taskSubmitAttemptsValue",
    "taskSubmitAdaptationOff",
    "taskSubmitAdaptationOn",
    "taskSubmitQualityPass",
    "taskSubmitQualityFail",
    "taskSubmitIntegrationOk",
    "taskSubmitIntegrationWarn",
    "taskSubmitTechnical",
    "taskSubmitDigestLabel",
  ]) {
    assert.ok(enSection.includes(key), `en ${key} present`);
    assert.ok(zhSection.includes(key), `zh ${key} present`);
  }
  assert.ok(zhSection.includes("预览"), "zh preview button");
  assert.ok(zhSection.includes("尚未启动任何任务"), "zh no-Task-started note");
  assert.ok(zhSection.includes("预览已过期"), "zh stale instruction");
  assert.ok(zhSection.includes("无限制"), "zh unlimited budget");
  assert.ok(enSection.includes("No task has started"), "en no-Task-started note");
  assert.ok(enSection.includes("out of date"), "en stale instruction");
});

test("Hub submit preview renders explanation-first classification reuse advice", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // The advisory block is rendered under the existing preview facts.
  assert.ok(src.includes("renderSubmitClassificationAdvice"), "classification advice renderer");
  assert.ok(src.includes("preview.classificationAdvice"), "renderer consumes the safe projection");
  assert.ok(src.includes("taskSubmitClassTitle"), "explanation-first title key");
  assert.ok(src.includes("taskSubmitClassBody"), "body explains the comparison source");
  assert.ok(src.includes("taskSubmitClassFactClass"), "taskClass fact label key");
  assert.ok(src.includes("taskSubmitClassFactFamily"), "taskFamily fact label key");
  assert.ok(src.includes("taskSubmitFamilyChoices"), "established families label key");
  assert.ok(src.includes("taskSubmitFamilyChoice"), "one bounded family row key");
  assert.ok(src.includes("taskSubmitFamilyChoicesEmpty"), "empty families note key");
  assert.ok(src.includes("taskSubmitNextAction"), "manual next-action label key");
  // Every closed next-action code maps to a bounded explanation; no raw code is
  // rendered as primary copy.
  for (const code of [
    "reuse-classification",
    "extend-family",
    "add-class",
    "add-family",
    "confirm-new-family",
    "fill-classification",
  ]) {
    assert.ok(src.includes(code), `next-action code ${code} mapped`);
    assert.ok(src.includes(`case "${code}"`), `next-action switch handles ${code}`);
  }
  // No semantic ranking or Task identity is exposed by the renderer.
  const adviceIdx = src.indexOf("function renderSubmitClassificationAdvice");
  assert.ok(adviceIdx > 0);
  const adviceEnd = src.indexOf("function renderSubmitPreviewFacts", adviceIdx);
  const adviceBlock = src.slice(adviceIdx, adviceEnd > 0 ? adviceEnd : src.length);
  assert.ok(!adviceBlock.includes("taskId"), "no Task id rendered");
  assert.ok(!adviceBlock.includes("spec.project"), "no project path rendered");
  assert.ok(!adviceBlock.includes("keychainService"), "no keychain rendered");
  assert.ok(!adviceBlock.includes("acceptance.commands"), "no commands rendered");
});

test("Hub i18n carries classification reuse strings in both languages", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const zhSection = i18n.slice(i18n.indexOf("zh: {"));
  const enSection = i18n.slice(0, i18n.indexOf("zh: {"));
  const keys = [
    "taskSubmitClassTitle",
    "taskSubmitClassBody",
    "taskSubmitClassFactClass",
    "taskSubmitClassFactFamily",
    "taskSubmitClassMissing",
    "taskSubmitClassNew",
    "taskSubmitClassExisting",
    "taskSubmitClassExistingComplete",
    "taskSubmitFamilyChoices",
    "taskSubmitFamilyChoice",
    "taskSubmitFamilyChoicesEmpty",
    "taskSubmitClassChoices",
    "taskSubmitClassChoice",
    "taskSubmitClassChoicesHint",
    "taskSubmitNextAction",
    "taskSubmitNextReuse",
    "taskSubmitNextExtend",
    "taskSubmitNextExtendWithChoices",
    "taskSubmitNextAddClass",
    "taskSubmitNextAddClassWithChoices",
    "taskSubmitNextAddFamily",
    "taskSubmitNextConfirmFamily",
    "taskSubmitNextFill",
    "taskSubmitClassUnavailable",
  ];
  for (const key of keys) {
    assert.ok(enSection.includes(key), `en ${key} present`);
    assert.ok(zhSection.includes(key), `zh ${key} present`);
  }
  // Beginner copy explains reuse, a new family, and missing family in Chinese.
  assert.ok(zhSection.includes("沿用已有分类"), "zh reuse explanation");
  assert.ok(zhSection.includes("新大类"), "zh new-family explanation");
  assert.ok(zhSection.includes("稳定大类"), "zh stable-family term");
  assert.ok(enSection.includes("never guesses"), "en never-guess body");
  // Within-family class guidance is bilingual and keeps Main as the judge.
  assert.ok(enSection.includes("Existing classes in this family"), "en class choices title");
  assert.ok(enSection.includes("Judge by meaning"), "en class choices manual-decision hint");
  assert.ok(enSection.includes("never replaces"), "en class choices no-auto-replace hint");
  assert.ok(zhSection.includes("同一大类里已有的工作类型"), "zh class choices title");
  assert.ok(zhSection.includes("请按真实含义判断"), "zh class choices manual-decision hint");
  assert.ok(zhSection.includes("不会自动替换"), "zh class choices no-auto-replace hint");
  assert.ok(zhSection.includes("含义相同就复用"), "zh choices next action prioritizes semantic reuse");
  assert.ok(enSection.includes("Reuse a matching name"), "en choices next action prioritizes semantic reuse");
});

test("Hub reveals within-family class choices only when the class needs a decision", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const render = submitPreviewHarness(src);
  const base = {
    taskName: "Class guidance preview",
    workerProfileId: "local-grok-builder",
    workerProfileLabel: "Local Grok Builder",
    provider: "xai",
    model: "grok-4.5",
    runtime: "grok-build",
    effort: "high",
    budget: { maxBudgetUsd: 1.25, unlimited: false },
    effectivePolicy: { values: { baseMaxAttempts: 6, maxExtraAttempts: 1, maxAdaptationRounds: 2 } },
    quality: { passed: true, score: 80 },
    integration: { applicable: true, integratable: true },
    routingExplanation: {
      present: true,
      selectedWorker: {
        provider: "xai", model: "grok-4.5", runtime: "grok-build", effort: "high",
        workerProfileId: "local-grok-builder", workerProfileLabel: "Local Grok Builder",
      },
      shortlistSize: 1,
      basis: "user-specified",
      evidence: null,
      competition: null,
      nextAction: "submit-directly",
    },
    previewRevisionDigest: "0".repeat(64),
  };

  // New class inside an existing family → the disclosure expands with the
  // same-family candidates and a manual-decision hint.
  const newClass = render({
    ...base,
    classificationAdvice: {
      taskClass: { state: "new", terminalCount: 0, completeSelectionCount: 0 },
      taskFamily: { state: "existing", terminalCount: 2, completeSelectionCount: 1 },
      familyChoices: [],
      classChoices: [
        { taskClass: "migration", terminalCount: 1, completeSelectionCount: 1 },
        { taskClass: "lint-fix", terminalCount: 1, completeSelectionCount: 0 },
      ],
      nextAction: "extend-family",
    },
  });
  const newText = textOf(newClass);
  assert.ok(newText.includes("[taskSubmitClassChoicesHint]"), "manual-decision hint rendered");
  assert.ok(newText.includes("[taskSubmitClassChoices]"), "class choices disclosure rendered");
  assert.ok(newText.includes("[taskSubmitClassChoice]"), "class choice row rendered");
  let classOpen = false;
  walkEl(newClass, (el) => {
    if (el.tagName === "details" && el.children[0] && el.children[0].textContent === "[taskSubmitClassChoices]") {
      classOpen = el.attrs["open"] !== undefined;
    }
  });
  assert.equal(classOpen, true, "class choices disclosure is expanded for a new class");
  // No Task identity or private content is rendered by the guidance block.
  assert.ok(!newText.includes("taskId"));
  assert.ok(!newText.includes("spec.project"));
  assert.ok(!newText.includes("keychainService"));

  // Missing class inside an existing family → the same disclosure appears.
  const missingClass = render({
    ...base,
    classificationAdvice: {
      taskClass: { state: "missing", terminalCount: 0, completeSelectionCount: 0 },
      taskFamily: { state: "existing", terminalCount: 2, completeSelectionCount: 1 },
      familyChoices: [],
      classChoices: [{ taskClass: "migration", terminalCount: 2, completeSelectionCount: 1 }],
      nextAction: "add-class",
    },
  });
  assert.ok(textOf(missingClass).includes("[taskSubmitClassChoices]"), "missing class shows candidates");

  // Exact class already reused → no extra candidate list noise.
  const reused = render({
    ...base,
    classificationAdvice: {
      taskClass: { state: "existing", terminalCount: 2, completeSelectionCount: 1 },
      taskFamily: { state: "existing", terminalCount: 2, completeSelectionCount: 1 },
      familyChoices: [],
      classChoices: [{ taskClass: "migration", terminalCount: 2, completeSelectionCount: 1 }],
      nextAction: "reuse-classification",
    },
  });
  const reusedText = textOf(reused);
  assert.ok(!reusedText.includes("[taskSubmitClassChoices]"), "reused class adds no disclosure");
  assert.ok(!reusedText.includes("[taskSubmitClassChoicesHint]"), "reused class adds no hint");

  // New family → classChoices is empty and no disclosure is added.
  const newFamily = render({
    ...base,
    classificationAdvice: {
      taskClass: { state: "new", terminalCount: 0, completeSelectionCount: 0 },
      taskFamily: { state: "new", terminalCount: 0, completeSelectionCount: 0 },
      familyChoices: [],
      classChoices: [],
      nextAction: "confirm-new-family",
    },
  });
  assert.ok(!textOf(newFamily).includes("[taskSubmitClassChoices]"), "new family adds no disclosure");
});

test("Hub wires preview-bound draft-only class reuse actions and pending state", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // The bounded ops route is wired to the current board preview state.
  assert.ok(src.includes("/api/ops/tasks/reuse-class"), "reuse-class ops route");
  // The reuse request is built from the exact current preview (path + digest)
  // plus the user-chosen class and confirm, and it is the ONLY reuse request.
  assert.ok(src.includes("var reuseFilePath = boardPreview.filePath"), "reuse captures the current board path");
  assert.ok(src.includes("var reuseDigest = boardPreview.digest"), "reuse captures the current preview digest");
  assert.ok(src.includes("taskClass: taskClass"), "reuse sends the chosen class");
  assert.ok(src.includes("previewRevisionDigest: reuseDigest"), "reuse binds the captured safe digest field");
  assert.ok(src.includes("filePath: reuseFilePath"), "reuse sends the captured path");
  assert.ok(src.includes("confirm: true"), "reuse requires confirm");
  // Confirmation, per-choice action label, and bounded outcome copy.
  assert.ok(src.includes("taskSubmitClassReuseConfirm"), "explicit confirmation i18n key");
  assert.ok(src.includes("taskSubmitClassReuseBtn"), "per-choice action label key");
  assert.ok(src.includes("taskSubmitClassReuseOk"), "success i18n key");
  assert.ok(src.includes("taskSubmitClassReuseStale"), "stale i18n key");
  assert.ok(src.includes("taskSubmitClassReuseFailed"), "failure i18n key");
  // Pending state disables every reuse action, Preview and Submit together.
  assert.ok(src.includes("boardReusePending"), "pending flag");
  assert.ok(src.includes("pathIn.disabled = boardReusePending"), "a periodic render keeps path editing disabled");
  assert.ok(src.includes("previewBtn.disabled = boardReusePending"), "a periodic render keeps Preview disabled");
  assert.ok(src.includes('"data-fl-role", "reuse-class"'), "per-choice action role attribute");
  assert.ok(src.includes("data-fl-role"), "action role attribute");
  // Success renders only the daemon-returned fresh preview; Submit stays a
  // separate click.
  assert.ok(src.includes("renderSubmitPreview();"), "fresh preview re-render");
  assert.ok(!/\.innerHTML\s*=/.test(src), "no innerHTML");
});

test("Hub i18n carries draft-only class reuse strings in both languages", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const zhSection = i18n.slice(i18n.indexOf("zh: {"));
  const enSection = i18n.slice(0, i18n.indexOf("zh: {"));
  const keys = [
    "taskSubmitClassReuseBtn",
    "taskSubmitClassReuseConfirm",
    "taskSubmitClassReuseOk",
    "taskSubmitClassReuseStale",
    "taskSubmitClassReuseFailed",
  ];
  for (const key of keys) {
    assert.ok(enSection.includes(key), `en ${key} present`);
    assert.ok(zhSection.includes(key), `zh ${key} present`);
  }
  assert.ok(enSection.includes("Only the taskClass field changes"), "English copy describes a field, not a physical line");
  assert.ok(zhSection.includes("只会修改 taskClass 字段"), "Chinese copy describes a field, not a physical line");
  assert.ok(enSection.includes("could not confirm the result"), "English unknown outcome stays truthful");
  assert.ok(zhSection.includes("无法确认操作结果"), "Chinese unknown outcome stays truthful");
  assert.ok(enSection.includes("Use this type"), "en button label");
  assert.ok(zhSection.includes("使用这个类型"), "zh button label");
  assert.ok(enSection.includes("not submitted"), "en no-submit confirmation");
  assert.ok(zhSection.includes("不会提交任务"), "zh no-submit confirmation");
  assert.ok(enSection.includes("separate click"), "en separate-submit note");
  assert.ok(zhSection.includes("单独点击"), "zh separate-submit note");
});

test("Hub renders per-choice reuse actions only for an eligible current preview", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const render = submitPreviewHarness(src);
  const base = {
    taskName: "Reuse action preview",
    workerProfileId: "local-grok-builder",
    workerProfileLabel: "Local Grok Builder",
    provider: "xai",
    model: "grok-4.5",
    runtime: "grok-build",
    effort: "high",
    budget: { maxBudgetUsd: 1.25, unlimited: false },
    effectivePolicy: { values: { baseMaxAttempts: 6, maxExtraAttempts: 1, maxAdaptationRounds: 2 } },
    quality: { passed: true, score: 80 },
    integration: { applicable: true, integratable: true },
    routingExplanation: {
      present: true,
      selectedWorker: {
        provider: "xai", model: "grok-4.5", runtime: "grok-build", effort: "high",
        workerProfileId: "local-grok-builder", workerProfileLabel: "Local Grok Builder",
      },
      shortlistSize: 1,
      basis: "user-specified",
      evidence: null,
      competition: null,
      nextAction: "submit-directly",
    },
    previewRevisionDigest: "0".repeat(64),
  };
  const advice = {
    taskClass: { state: "new", terminalCount: 0, completeSelectionCount: 0 },
    taskFamily: { state: "existing", terminalCount: 2, completeSelectionCount: 1 },
    familyChoices: [],
    classChoices: [
      { taskClass: "migration", terminalCount: 1, completeSelectionCount: 1 },
      { taskClass: "lint-fix", terminalCount: 1, completeSelectionCount: 0 },
    ],
    nextAction: "extend-family",
  };
  const invoked: Array<{ taskClass: string }> = [];
  // Eligible preview with a handler: one action button per displayed choice.
  const tree = render({ ...base, classificationAdvice: advice }, {
    onReuse: (taskClass: string) => invoked.push({ taskClass }),
    eligible: true,
    pending: false,
  });
  const buttons: FakeEl[] = [];
  walkEl(tree, (el) => {
    if (el.attrs["data-fl-role"] === "reuse-class") buttons.push(el);
  });
  assert.equal(buttons.length, 2, "one action per listed class");
  assert.ok(buttons.every((b) => b.tagName === "button"), "actions are buttons");
  assert.ok(buttons.every((b) => b.disabled !== true), "actions enabled when not pending");
  assert.ok(textOf(tree).includes("[taskSubmitClassReuseBtn]"), "action label rendered");
  // Clicking invokes the exact class through the supplied handler.
  (buttons[0]!.listeners["click"] ?? []).forEach((fn) => fn());
  assert.deepEqual(invoked, [{ taskClass: "migration" }]);
});

test("Hub reuse actions and Submit are disabled while a reuse request is pending", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const render = submitPreviewHarness(src);
  const base = {
    taskName: "Reuse pending preview",
    workerProfileId: "local-grok-builder",
    workerProfileLabel: "Local Grok Builder",
    provider: "xai",
    model: "grok-4.5",
    runtime: "grok-build",
    effort: "high",
    budget: { maxBudgetUsd: 1.25, unlimited: false },
    effectivePolicy: { values: { baseMaxAttempts: 6, maxExtraAttempts: 1, maxAdaptationRounds: 2 } },
    quality: { passed: true, score: 80 },
    integration: { applicable: true, integratable: true },
    routingExplanation: {
      present: false,
      selectedWorker: {
        provider: "xai", model: "grok-4.5", runtime: "grok-build", effort: "high",
        workerProfileId: "local-grok-builder", workerProfileLabel: "Local Grok Builder",
      },
      shortlistSize: null,
      basis: null,
      evidence: null,
      competition: null,
      nextAction: "not-recorded",
    },
    previewRevisionDigest: "0".repeat(64),
  };
  const advice = {
    taskClass: { state: "missing", terminalCount: 0, completeSelectionCount: 0 },
    taskFamily: { state: "existing", terminalCount: 2, completeSelectionCount: 1 },
    familyChoices: [],
    classChoices: [{ taskClass: "migration", terminalCount: 2, completeSelectionCount: 1 }],
    nextAction: "add-class",
  };
  const tree = render({ ...base, classificationAdvice: advice }, {
    onReuse: () => {},
    eligible: true,
    pending: true,
  });
  const buttons: FakeEl[] = [];
  walkEl(tree, (el) => {
    if (el.attrs["data-fl-role"] === "reuse-class") buttons.push(el);
  });
  assert.ok(buttons.length >= 1, "reuse action rendered while pending");
  assert.ok(buttons.every((b) => b.disabled === true), "every reuse action disabled while pending");
});

test("Hub submit preview renders explanation-first routing explanation", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // The routing block is rendered under the existing preview facts.
  assert.ok(src.includes("renderSubmitRoutingExplanation"), "routing explanation renderer");
  assert.ok(src.includes("preview.routingExplanation"), "renderer consumes the safe projection");
  assert.ok(src.includes("taskSubmitRoutingTitle"), "explanation-first title key");
  assert.ok(src.includes("taskSubmitRoutingBody"), "body explains the frozen record");
  // Every closed basis maps to a bounded explanation.
  for (const code of [
    "user-specified",
    "only-available",
    "historical-evidence",
    "runtime-capability",
    "main-judgment",
    "other",
  ]) {
    assert.ok(src.includes(`case "${code}"`), `basis switch handles ${code}`);
  }
  // Every closed next-action code maps to a bounded explanation.
  for (const code of [
    "submit-directly",
    "consider-competition",
    "run-competition",
    "not-recorded",
  ]) {
    assert.ok(src.includes(`case "${code}"`), `next-action switch handles ${code}`);
  }
  // No private route field, identity-key map, or settings digest is read.
  const rIdx = src.indexOf("function renderSubmitRoutingExplanation");
  assert.ok(rIdx > 0);
  const rEnd = src.indexOf("function renderSubmitClassificationAdvice", rIdx);
  assert.ok(rEnd > rIdx, "routing renderer ends before classification renderer");
  const rBlock = src.slice(rIdx, rEnd);
  assert.ok(!rBlock.includes("taskId"), "no Task id rendered");
  assert.ok(!rBlock.includes("spec.project"), "no project path rendered");
  assert.ok(!rBlock.includes("keychainService"), "no keychain rendered");
  assert.ok(!rBlock.includes("acceptance.commands"), "no commands rendered");
  assert.ok(!rBlock.includes("endpoint"), "no endpoint rendered");
  assert.ok(!rBlock.includes("selectedBecause"), "private reason note never read");
  assert.ok(!rBlock.includes("settingsDigest"), "settings digest never read");
  assert.ok(!rBlock.includes("exactSampleCounts"), "raw identity-key map never read");
});

test("Hub i18n carries routing explanation strings in both languages", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const zhSection = i18n.slice(i18n.indexOf("zh: {"));
  const enSection = i18n.slice(0, i18n.indexOf("zh: {"));
  const keys = [
    "taskSubmitRoutingTitle",
    "taskSubmitRoutingBody",
    "taskSubmitRoutingUnavailable",
    "taskSubmitRoutingNotRecorded",
    "taskSubmitRoutingFactSelected",
    "taskSubmitRoutingFactShortlist",
    "taskSubmitRoutingFactBasis",
    "taskSubmitRoutingFactScope",
    "taskSubmitRoutingFactEvidence",
    "taskSubmitRoutingFactCompetition",
    "taskSubmitRoutingFactNext",
    "taskSubmitRoutingBasisUserSpecified",
    "taskSubmitRoutingBasisOnlyAvailable",
    "taskSubmitRoutingBasisHistoricalEvidence",
    "taskSubmitRoutingBasisRuntimeCapability",
    "taskSubmitRoutingBasisMainJudgment",
    "taskSubmitRoutingBasisOther",
    "taskSubmitRoutingScopeExactClass",
    "taskSubmitRoutingScopeTaskFamily",
    "taskSubmitRoutingScopeNone",
    "taskSubmitRoutingEvidenceValue",
    "taskSubmitRoutingCompetitionNone",
    "taskSubmitRoutingCompetitionConsider",
    "taskSubmitRoutingCompetitionRequired",
    "taskSubmitRoutingCompetitionMissing",
    "taskSubmitRoutingTriggerCritical",
    "taskSubmitRoutingTriggerMultiple",
    "taskSubmitRoutingTriggerNewFamily",
    "taskSubmitRoutingTriggerUserRequested",
    "taskSubmitRoutingNextSubmitDirectly",
    "taskSubmitRoutingNextConsiderCompetition",
    "taskSubmitRoutingNextRunCompetition",
    "taskSubmitRoutingNextNotRecorded",
  ];
  for (const key of keys) {
    assert.ok(enSection.includes(key), `en ${key} present`);
    assert.ok(zhSection.includes(key), `zh ${key} present`);
  }
  // Beginner copy answers why, evidence, and Competition in Chinese.
  assert.ok(zhSection.includes("为什么选这个 Worker"), "zh title asks why");
  assert.ok(zhSection.includes("历史证据支持这个 Worker"), "zh evidence basis");
  assert.ok(zhSection.includes("本任务不会启动 Competition"), "zh competition-none copy");
  assert.ok(zhSection.includes("直接提交这个 Worker"), "zh next-action copy");
  assert.ok(enSection.includes("No Competition will be started"), "en competition-none copy");
  assert.ok(enSection.includes("Selection basis"), "en basis label");
  // Scope none means insufficient comparable history — never "unrecorded".
  assert.ok(enSection.includes("insufficient comparable history"), "en scope-none copy");
  assert.ok(zhSection.includes("可比历史不足"), "zh scope-none copy");
});

/* Fake DOM used by the submit-preview renderer tests below. It mirrors what
 * the Hub's h()/collapsedSection() actually touch, so the full four-stage
 * reading path can be asserted without a browser. */
type FakeEl = {
  tagName: string;
  className: string;
  textContent: string | undefined;
  children: FakeEl[];
  attrs: Record<string, string>;
  listeners: Record<string, Array<(ev?: unknown) => void>>;
  disabled?: boolean;
  type?: string;
  setAttribute(k: string, v: string): void;
  appendChild(c: FakeEl): FakeEl;
  addEventListener(type: string, fn: (ev?: unknown) => void): void;
};

function fakeHubEl(tag: string): FakeEl {
  return {
    tagName: tag,
    className: "",
    textContent: undefined,
    children: [],
    attrs: {},
    listeners: {},
    setAttribute(k: string, v: string) { this.attrs[k] = String(v); },
    appendChild(c: FakeEl) { this.children.push(c); return c; },
    addEventListener(type: string, fn: (ev?: unknown) => void) {
      (this.listeners[type] ??= []).push(fn);
    },
  };
}

function submitPreviewHarness(src: string) {
  const names = [
    "submitFactRow",
    "submitWorkerIdentity",
    "submitWorkerText",
    "submitFieldValue",
    "submitBudgetText",
    "submitAttemptsText",
    "submitAdaptationText",
    "submitQualityText",
    "submitIntegrationText",
    "submitBoundaryAdviceText",
    "submitRoutingBasisText",
    "submitRoutingScopeText",
    "submitRoutingTriggerText",
    "submitRoutingCompetitionText",
    "submitRoutingNextActionText",
    "renderSubmitRoutingExplanation",
    "submitClassificationStateText",
    "submitClassificationNextActionKey",
    "renderSubmitClassificationAdvice",
    "renderSubmitPreviewFacts",
  ];
  const body = names.map((name) => extractFunctionSource(src, name)).join("\n");
  function h(tag: string, cls: string, text: unknown) {
    const el = fakeHubEl(tag);
    el.className = cls || "";
    if (text !== undefined) el.textContent = String(text);
    return el;
  }
  function t(key: string) { return `[${key}]`; }
  function collapsedSection(title: string, node: FakeEl) {
    const details = fakeHubEl("details");
    const summary = fakeHubEl("summary");
    summary.textContent = title;
    details.appendChild(summary);
    if (node) details.appendChild(node);
    return details;
  }
  const documentStub = {
    createElement: fakeHubEl,
    createTextNode(text: unknown) { return { text: String(text) }; },
  };
  const factory = new Function(
    "h", "t", "collapsedSection", "document",
    `${body}\nreturn renderSubmitPreviewFacts;`,
  );
  return factory(h, t, collapsedSection, documentStub) as (
    preview: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => FakeEl;
}

function walkEl(el: FakeEl, visit: (el: FakeEl) => void) {
  visit(el);
  el.children.forEach((child) => walkEl(child, visit));
}

function textOf(el: FakeEl): string {
  let out = el.textContent || "";
  el.children.forEach((child) => { out += textOf(child); });
  return out;
}

test("Hub submit preview composes one four-stage reading path in DOM order", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const render = submitPreviewHarness(src);
  const preview = {
    taskName: "Refactor pricing service to route through the official price table",
    workerProfileId: "local-grok-builder",
    workerProfileLabel: "Local Grok Builder",
    provider: "xai",
    model: "grok-4.5",
    runtime: "grok-build",
    effort: "high",
    // Private fields the renderer must never leak into the UI.
    routingDecision: "PRIVATE-ROUTE-REASON-NEVER-RENDER",
    selectedBecause: "PRIVATE-SELECTED-BECAUSE-NEVER-RENDER",
    spec: { project: "/private/project/path", commands: ["PRIVATE-CMD-NEVER-RENDER"] },
    budget: { maxBudgetUsd: 1.25, unlimited: false },
    effectivePolicy: { values: { baseMaxAttempts: 6, maxExtraAttempts: 1, maxAdaptationRounds: 2 } },
    quality: { passed: true, score: 80 },
    integration: { applicable: true, integratable: true },
    classificationAdvice: {
      taskClass: { state: "new", terminalCount: 0, completeSelectionCount: 0 },
      taskFamily: { state: "missing", terminalCount: 0, completeSelectionCount: 0 },
      familyChoices: [
        { family: "refactor", terminalCount: 2, completeSelectionCount: 1, distinctClassCount: 2 },
        { family: "data-migration", terminalCount: 5, completeSelectionCount: 3, distinctClassCount: 4 },
      ],
      nextAction: "add-family",
    },
    routingExplanation: {
      present: true,
      selectedWorker: {
        provider: "xai", model: "grok-4.5", runtime: "grok-build", effort: "high",
        workerProfileId: "local-grok-builder", workerProfileLabel: "Local Grok Builder",
      },
      shortlistSize: 4,
      basis: "main-judgment",
      evidence: { scope: "none", candidateCount: 2, totalSamples: 7 },
      competition: { intent: "consider", triggers: ["critical"] },
      nextAction: "consider-competition",
    },
    previewRevisionDigest: "0".repeat(64),
  };
  let tree: FakeEl | undefined;
  assert.doesNotThrow(() => { tree = render(preview); }, "renderSubmitPreviewFacts must not throw");
  const root = tree!;

  // The four sections appear in exactly what/why/boundaries/next order.
  const roles: string[] = [];
  walkEl(root, (el) => {
    const role = el.attrs["data-fl-role"];
    if (role) roles.push(role);
  });
  assert.deepEqual(roles, ["submit-what", "submit-why", "submit-boundaries", "submit-classify"],
    "one reading path: what will run, why this Worker, execution boundaries, classification and next");

  // The selected Worker identity renders exactly once, in the "what" section.
  let workerRows = 0;
  let repeatedSelectedRows = 0;
  walkEl(root, (el) => {
    if (el.className.split(" ").includes("submit-fact-worker")) workerRows += 1;
    // No fact row may repeat the old routing "Selected Worker" line.
    const label = el.children[0] && el.children[0].textContent;
    if (el.tagName === "div" && label === "[taskSubmitRoutingFactSelected]: ") repeatedSelectedRows += 1;
  });
  assert.equal(workerRows, 1, "Worker identity renders exactly once");
  assert.equal(repeatedSelectedRows, 0, "routing never repeats the selected Worker");

  // Every boundary fact survives inside the execution-boundaries section.
  const boundaryText = textOf(root);
  for (const key of [
    "taskSubmitFactBudget", "taskSubmitFactAttempts", "taskSubmitFactAdaptation",
    "taskSubmitFactQuality", "taskSubmitFactIntegration",
  ]) {
    assert.ok(boundaryText.includes(`[${key}]`), `boundary fact ${key} preserved`);
  }

  // The established-family list is a closed native disclosure; the next action
  // stays directly visible beside it.
  const details: FakeEl[] = [];
  walkEl(root, (el) => { if (el.tagName === "details") details.push(el); });
  const summaries = details.map((d) => (d.children[0] && d.children[0].textContent) || "");
  assert.ok(summaries.includes("[taskSubmitFamilyChoices]"), "family candidates are a native disclosure");
  assert.ok(summaries.includes("[taskSubmitTechnical]"), "technical digest stays a native disclosure");
  let familyOpen = false;
  walkEl(root, (el) => {
    if (el.tagName === "details" && el.children[0] && el.children[0].textContent === "[taskSubmitFamilyChoices]") {
      familyOpen = el.attrs["open"] !== undefined;
    }
  });
  assert.equal(familyOpen, false, "family disclosure defaults closed");
  const nextActions: string[] = [];
  walkEl(root, (el) => {
    if (el.className.split(" ").includes("submit-next-action")) nextActions.push(el.textContent || "");
  });
  assert.equal(nextActions.length, 1, "one classification next action stays visible");
  assert.ok((nextActions[0] ?? "").includes("[taskSubmitNextAddFamily]"),
    "next action is not hidden by the disclosure");

  // Privacy: private fields, raw decisions, paths and commands never leak.
  const renderedText = textOf(root);
  for (const forbidden of [
    "PRIVATE-ROUTE-REASON-NEVER-RENDER",
    "PRIVATE-SELECTED-BECAUSE-NEVER-RENDER",
    "/private/project/path",
    "PRIVATE-CMD-NEVER-RENDER",
    "routingDecision",
    "selectedBecause",
  ]) {
    assert.ok(!renderedText.includes(forbidden), `preview facts never render ${forbidden}`);
  }
});

test("Hub submit preview degrades honestly when routing and classification advice are absent", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const render = submitPreviewHarness(src);
  const preview = {
    taskName: "Legacy task with a frozen Worker but no recorded reasoning",
    workerProfileId: "local-grok-builder",
    workerProfileLabel: "Local Grok Builder",
    provider: "xai",
    model: "grok-4.5",
    runtime: "grok-build",
    effort: "medium",
    budget: { unlimited: true },
    effectivePolicy: { values: { baseMaxAttempts: 3, maxExtraAttempts: 0 } },
    quality: { passed: true, score: 70 },
    integration: { applicable: false },
    routingExplanation: null,
    classificationAdvice: null,
    previewRevisionDigest: "d".repeat(64),
  };
  const tree = render(preview);
  const rendered = textOf(tree);
  assert.ok(rendered.includes("[taskSubmitRoutingUnavailable]"), "missing routing explanation is stated honestly");
  assert.ok(rendered.includes("[taskSubmitClassUnavailable]"), "missing classification advice is stated honestly");
  // The effective Worker and execution limits remain readable.
  assert.ok(rendered.includes("local-grok-builder"), "effective Worker stays visible without routing advice");
  assert.ok(rendered.includes("[taskSubmitFactBudget]"), "budget stays visible");
  assert.ok(rendered.includes("[taskSubmitFactIntegration]"), "Integration stays visible");
  let workerRows = 0;
  walkEl(tree, (el) => {
    if (el.className.split(" ").includes("submit-fact-worker")) workerRows += 1;
  });
  assert.equal(workerRows, 1, "legacy preview still renders the Worker once");
});

test("Hub submit preview renders workspace boundary review/clear/unavailable/legacy states", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const render = submitPreviewHarness(src);
  const base = {
    taskName: "Boundary preview",
    workerProfileId: "local-grok-builder",
    workerProfileLabel: "Local Grok Builder",
    provider: "xai",
    model: "grok-4.5",
    runtime: "grok-build",
    effort: "high",
    budget: { maxBudgetUsd: 1.25, unlimited: false },
    effectivePolicy: { values: { baseMaxAttempts: 6, maxExtraAttempts: 1, maxAdaptationRounds: 2 } },
    quality: { passed: true, score: 80 },
    integration: { applicable: true, integratable: true },
    classificationAdvice: {
      taskClass: { state: "new", terminalCount: 0, completeSelectionCount: 0 },
      taskFamily: { state: "missing", terminalCount: 0, completeSelectionCount: 0 },
      familyChoices: [],
      nextAction: "add-family",
    },
    routingExplanation: {
      present: true,
      selectedWorker: {
        provider: "xai", model: "grok-4.5", runtime: "grok-build", effort: "high",
        workerProfileId: "local-grok-builder", workerProfileLabel: "Local Grok Builder",
      },
      shortlistSize: 1,
      basis: "user-specified",
      evidence: null,
      competition: null,
      nextAction: "submit-directly",
    },
    previewRevisionDigest: "0".repeat(64),
  };

  // Review: count rendered, hint rendered, no directory names, and the tip
  // appears inside the boundaries section before the technical digest.
  const review = render({
    ...base,
    workspaceBoundaryAdvice: {
      status: "review",
      ignoredDirectoryRootCount: 2,
      coveredCount: 1,
      visibleBusinessCount: 1,
      reason: "checked",
      nextAction: "review-workspace-boundaries",
    },
  });
  const reviewText = textOf(review);
  assert.ok(reviewText.includes("[taskSubmitFactBoundary]"), "boundary fact label rendered");
  assert.ok(reviewText.includes("[taskSubmitBoundaryReview]"), "review count copy rendered");
  assert.ok(reviewText.includes("[taskSubmitBoundaryReviewHint]"), "review hint rendered");
  assert.ok(!reviewText.includes("dist"), "no ignored directory name is rendered");
  assert.ok(!reviewText.includes("/private/"), "no absolute path is rendered");
  assert.ok(
    reviewText.indexOf("[taskSubmitBoundaryReview]") < reviewText.indexOf("[taskSubmitDigestLabel]"),
    "review tip sits before the technical digest",
  );
  let reviewSection = 0;
  walkEl(review, (el) => {
    if (el.attrs["data-fl-role"] === "submit-boundaries") reviewSection += 1;
  });
  assert.equal(reviewSection, 1, "boundary tip lives inside the execution-boundaries section");

  // Clear: concise, truthful, and does not claim future coverage.
  const clear = render({
    ...base,
    workspaceBoundaryAdvice: {
      status: "clear",
      ignoredDirectoryRootCount: 0,
      coveredCount: 0,
      visibleBusinessCount: 0,
      reason: "checked",
      nextAction: "continue",
    },
  });
  assert.ok(textOf(clear).includes("[taskSubmitBoundaryClear]"), "clear copy rendered");

  // Unavailable: closed reason, no internal error text.
  const unavailable = render({
    ...base,
    workspaceBoundaryAdvice: {
      status: "unavailable",
      ignoredDirectoryRootCount: 0,
      coveredCount: 0,
      visibleBusinessCount: 0,
      reason: "not-git",
      nextAction: "manual-review",
    },
  });
  const unavailableText = textOf(unavailable);
  assert.ok(unavailableText.includes("[taskSubmitBoundaryUnavailable]"), "unavailable copy rendered");
  assert.ok(!unavailableText.includes("fatal"), "no Git diagnostic is rendered");
  assert.ok(!unavailableText.includes("not-git"), "internal reason code is not rendered");

  // Legacy (older daemon without the field): safe manual-review degrade.
  const legacy = render(base);
  const legacyText = textOf(legacy);
  assert.ok(legacyText.includes("[taskSubmitBoundaryLegacy]"), "legacy degrade note rendered");
});

test("Hub boundary renderer fails closed for unknown or malformed advice", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const render = submitPreviewHarness(src);
  const base = {
    taskName: "Boundary malformed preview",
    workerProfileId: "local-grok-builder",
    workerProfileLabel: "Local Grok Builder",
    provider: "xai",
    model: "grok-4.5",
    runtime: "grok-build",
    effort: "high",
    budget: { maxBudgetUsd: 1.25, unlimited: false },
    effectivePolicy: { values: { baseMaxAttempts: 6, maxExtraAttempts: 1, maxAdaptationRounds: 2 } },
    quality: { passed: true, score: 80 },
    integration: { applicable: true, integratable: true },
    classificationAdvice: {
      taskClass: { state: "new", terminalCount: 0, completeSelectionCount: 0 },
      taskFamily: { state: "missing", terminalCount: 0, completeSelectionCount: 0 },
      familyChoices: [],
      nextAction: "add-family",
    },
    routingExplanation: {
      present: true,
      selectedWorker: {
        provider: "xai", model: "grok-4.5", runtime: "grok-build", effort: "high",
        workerProfileId: "local-grok-builder", workerProfileLabel: "Local Grok Builder",
      },
      shortlistSize: 1,
      basis: "user-specified",
      evidence: null,
      competition: null,
      nextAction: "submit-directly",
    },
    previewRevisionDigest: "0".repeat(64),
  };

  // Unknown status never disappears and never echoes the raw status value.
  const unknown = textOf(render({ ...base, workspaceBoundaryAdvice: { status: "mystery" } }));
  assert.ok(unknown.includes("[taskSubmitBoundaryLegacy]"), "unknown status falls back to manual review");
  assert.ok(!unknown.includes("mystery"), "raw status value is never echoed");

  // Malformed counts fail closed to manual review instead of a false clear.
  const malformed = textOf(render({
    ...base,
    workspaceBoundaryAdvice: {
      status: "clear",
      ignoredDirectoryRootCount: -1,
      coveredCount: 0,
      visibleBusinessCount: 0,
    },
  }));
  assert.ok(malformed.includes("[taskSubmitBoundaryLegacy]"), "malformed counts fall back to manual review");

  const inconsistent = textOf(render({
    ...base,
    workspaceBoundaryAdvice: {
      status: "clear",
      ignoredDirectoryRootCount: 2,
      coveredCount: 1,
      visibleBusinessCount: 0,
      reason: "checked",
      nextAction: "continue",
    },
  }));
  assert.ok(inconsistent.includes("[taskSubmitBoundaryLegacy]"), "inconsistent advice falls back to manual review");

  // Non-object advice (null/corrupt) also fails closed.
  const nullAdvice = textOf(render({ ...base, workspaceBoundaryAdvice: null }));
  assert.ok(nullAdvice.includes("[taskSubmitBoundaryLegacy]"), "null advice falls back to manual review");
});

test("Hub app.js boundary renderer consumes only the safe projection", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("function submitBoundaryAdviceText"), "boundary advice renderer");
  assert.ok(src.includes("preview.workspaceBoundaryAdvice"), "renderer consumes the safe projection");
  assert.ok(src.includes("taskSubmitFactBoundary"), "boundary fact label key");
  assert.ok(src.includes("taskSubmitBoundaryReview"), "review copy key");
  assert.ok(src.includes("taskSubmitBoundaryClear"), "clear copy key");
  assert.ok(src.includes("taskSubmitBoundaryUnavailable"), "unavailable copy key");
  assert.ok(src.includes("taskSubmitBoundaryLegacy"), "legacy degrade copy key");
  // The renderer only reads counts and closed codes; it never touches paths.
  assert.ok(!/workspaceBoundaryAdvice\.[a-zA-Z]*[Pp]ath/.test(src),
    "renderer never reads a path field");
});

test("Hub i18n carries workspace boundary strings in both languages", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const enSection = i18n.slice(0, i18n.indexOf("zh: {"));
  const zhSection = i18n.slice(i18n.indexOf("zh: {"));
  const keys = [
    "taskSubmitFactBoundary",
    "taskSubmitBoundaryReview",
    "taskSubmitBoundaryReviewHint",
    "taskSubmitBoundaryClear",
    "taskSubmitBoundaryUnavailable",
    "taskSubmitBoundaryLegacy",
  ];
  for (const key of keys) {
    assert.ok(enSection.includes(`${key}:`), `en ${key}`);
    assert.ok(zhSection.includes(`${key}:`), `zh ${key}`);
  }
  // The review copy is explicit that Git ignore is only a review signal and
  // never proof of generated output, and it names the fields to check.
  assert.ok(enSection.includes("does not prove generated output"), "en review hint");
  assert.ok(zhSection.includes("不能证明"), "zh review hint is a denial");
  assert.ok(enSection.includes("workspace.exclude"), "en names exclude field");
  assert.ok(zhSection.includes("workspace.exclude"), "zh names exclude field");
  assert.ok(enSection.includes("workspace.generatedPaths"), "en names generatedPaths field");
  assert.ok(zhSection.includes("workspace.generatedPaths"), "zh names generatedPaths field");
  // Unavailable and legacy copy require manual confirmation, not an auto-fix.
  assert.ok(enSection.includes("Manually confirm"), "en manual-review instruction");
  assert.ok(zhSection.includes("手动确认"), "zh manual-review instruction");
  assert.ok(!zhSection.includes("自动添加"), "no auto-edit claim in zh");
  assert.ok(!enSection.includes("automatically add"), "no auto-edit claim in en");
});

test("Hub submit preview responsive and scoped CSS ships in both languages", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const enSection = i18n.slice(0, i18n.indexOf("zh: {"));
  const zhSection = i18n.slice(i18n.indexOf("zh: {"));
  // Group headings are scoped, use existing tokens, and are bilingual.
  assert.ok(css.includes(".submit-preview-facts"), "submit preview container scoped style");
  assert.ok(css.includes(".submit-group-title"), "group heading style ships");
  assert.ok(css.includes(".submit-group-boundaries"), "boundaries grouping style ships");
  assert.ok(css.includes("overflow-wrap: anywhere"), "long values wrap without overflow");
  assert.ok(css.includes("word-break: break-word"), "long values break cleanly");
  // Narrow screens collapse the two-column boundaries grid to the DOM order.
  assert.ok(/@media \(max-width: 768px\)[\s\S]*\.submit-group-boundaries[\s\S]*grid-template-columns: 1fr/
    .test(css), "narrow layout stacks boundaries in DOM order");
  // The new group headings exist in both languages.
  assert.ok(enSection.includes("taskSubmitGroupWhat"), "en group-what key");
  assert.ok(zhSection.includes("taskSubmitGroupWhat"), "zh group-what key");
  assert.ok(enSection.includes("taskSubmitGroupBoundaries"), "en group-boundaries key");
  assert.ok(zhSection.includes("taskSubmitGroupBoundaries"), "zh group-boundaries key");
  assert.ok(zhSection.includes("将执行什么"), "zh what-run heading copy");
  assert.ok(zhSection.includes("执行边界"), "zh boundaries heading copy");
  assert.ok(enSection.includes("What will run"), "en what-run heading copy");
  assert.ok(enSection.includes("Execution boundaries"), "en boundaries heading copy");
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

test("Hub preflight card explains path classification and recovery guidance bilingually", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const enSection = i18n.slice(0, i18n.indexOf("zh: {"));
  const zhSection = i18n.slice(i18n.indexOf("zh: {"));
  // Renderer binds the new evidence and guidance fields from the receipt.
  assert.ok(src.includes("result.pathEvidence"), "renderer reads pathEvidence");
  assert.ok(src.includes("result.recoveryGuidance"), "renderer reads recoveryGuidance");
  assert.ok(src.includes('"preflight-classification"'), "classification section marker");
  assert.ok(src.includes('"preflight-guidance"'), "guidance section marker");
  assert.ok(src.includes("taskPreflightPathDisclosure"), "bounded path disclosure title");
  // Bounded disclosure for ordered paths - not a wall of text.
  assert.ok(src.includes('collapsedSection(t("taskPreflightPathDisclosure")'));
  // Every classification and provenance key exists in both locales.
  for (const key of [
    "taskPreflightClassificationTitle",
    "taskPreflightClassificationHint",
    "taskPreflightClassificationBusiness",
    "taskPreflightClassificationGenerated",
    "taskPreflightClassificationInternal",
    "taskPreflightClassificationLine",
    "taskPreflightProvInternalForklight",
    "taskPreflightProvSnapshotExclusion",
    "taskPreflightProvBuiltinGenerated",
    "taskPreflightProvTaskGenerated",
    "taskPreflightProvDefaultBusiness",
    "taskPreflightGuidanceTitle",
    "taskPreflightGuidanceBody",
    "taskPreflightGuidanceChoicePolicy",
    "taskPreflightGuidanceChoiceScope",
    "taskPreflightGuidanceCaveat",
    "taskPreflightPathDisclosure",
  ]) {
    assert.ok(enSection.includes(key), `en ${key} present`);
    assert.ok(zhSection.includes(key), `zh ${key} present`);
  }
  // Beginner copy says the rule is current policy, not proof of generated/hand-written.
  assert.ok(enSection.includes("not proof that a file is truly generated"));
  assert.ok(zhSection.includes("并不能证明某个文件一定是生成物"));
  // Guidance forbids raising limits blindly and offers two safe choices.
  assert.ok(enSection.includes("Do not raise limits blindly"));
  assert.ok(enSection.includes("correct the generated-path or exclusion policy"));
  assert.ok(enSection.includes("reduce the Task scope"));
  assert.ok(zhSection.includes("不要盲目放宽限制"));
  assert.ok(zhSection.includes("修正生成物路径或排除策略"));
  assert.ok(zhSection.includes("收窄任务范围"));
});

test("Hub preflight card renders ordered path evidence without throwing", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const fnSource = extractFunctionSource(src, "renderPreflightResult");

  // Minimal DOM stubs: renderPreflightResult only needs createElement,
  // createTextNode, appendChild, setAttribute, and className/textContent.
  const renderedTexts: string[] = [];
  function fakeEl(tag: string) {
    return {
      tagName: tag,
      className: "",
      textContent: undefined as string | undefined,
      children: [] as unknown[],
      attrs: {} as Record<string, string>,
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      appendChild(c: unknown) { this.children.push(c); return c; },
      querySelector() { return null; },
      addEventListener() {},
    };
  }
  function h(tag: string, cls: string, text: unknown) {
    const el = fakeEl(tag);
    el.className = cls || "";
    if (text !== undefined) {
      el.textContent = String(text);
      renderedTexts.push(String(text));
    }
    return el;
  }
  function t(key: string) { return `[${key}]`; }
  function collapsedSection(title: string, node: unknown) {
    const el = fakeEl("details");
    renderedTexts.push(String(title));
    if (node) el.appendChild(node);
    return el;
  }
  function boundedDiagnostic(v: unknown) { return String(v); }
  function deliveryPlanExpectation() { return "not-configured"; }
  const DELIVERY_STAGE_KEYS = ["sourceApply", "sourceVerify", "artifactBuild", "runtimeActivation"];
  const DELIVERY_STAGE_LABEL_KEYS: Record<string, string> = {
    sourceApply: "stageSourceApply",
    sourceVerify: "stageSourceVerify",
    artifactBuild: "stageArtifactBuild",
    runtimeActivation: "stageRuntimeActivation",
  };
  const documentStub = {
    createElement: fakeEl,
    createTextNode(text: unknown) { renderedTexts.push(String(text)); return { text: String(text) }; },
  };

  const factory = new Function(
    "h", "t", "collapsedSection", "boundedDiagnostic", "deliveryPlanExpectation",
    "DELIVERY_STAGE_KEYS", "DELIVERY_STAGE_LABEL_KEYS", "document",
    `${fnSource}\nreturn renderPreflightResult;`,
  );
  const renderPreflightResult = factory(
    h, t, collapsedSection, boundedDiagnostic, deliveryPlanExpectation,
    DELIVERY_STAGE_KEYS, DELIVERY_STAGE_LABEL_KEYS, documentStub,
  ) as (result: Record<string, unknown>) => { attrs: Record<string, string> };

  const pathEvidence = [
    { path: "src/a.ts", category: "business", provenance: "default-business" },
    { path: "src/b.ts", category: "business", provenance: "default-business" },
    { path: "src/c.ts", category: "generated", provenance: "snapshot-exclusion" },
  ];
  const result = {
    id: "rec-1",
    expiresAt: "2026-07-29T00:00:00.000Z",
    rejectionReasons: ["Patch changes 6 files (limit: 5)"],
    affectedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
    deliveryPlan: { stages: {} },
    pathEvidence,
    recoveryGuidance: {
      code: "review-generated-or-exclusion-policy-vs-source-scope",
      defaultBusinessPathCount: 2,
      filesChanged: 6,
      changedLines: 12,
      reviewedPatchMaxFiles: 5,
      reviewedPatchMaxLines: 400,
    },
  };

  // The disclosure must iterate pathEvidence (not the DOM container) and must
  // not throw a TypeError when path evidence is present.
  let card: { attrs: Record<string, string> } | undefined;
  assert.doesNotThrow(() => {
    card = renderPreflightResult(result);
  }, "renderPreflightResult must not throw with non-empty path evidence");
  assert.equal(card!.attrs["data-fl-role"], "preflight-result");

  // Every path entry is rendered, in evidence order, as a "path - ..." line.
  // The " - " suffix uniquely identifies the disclosure line (the affectedFiles
  // summary line is comma-separated and never contains "path - ").
  let searchFrom = 0;
  pathEvidence.forEach((entry) => {
    const needle = `${entry.path} - `;
    let idx = -1;
    for (let i = searchFrom; i < renderedTexts.length; i += 1) {
      const line = renderedTexts[i];
      if (line !== undefined && line.includes(needle)) { idx = i; break; }
    }
    assert.ok(idx >= 0, `path ${entry.path} must be rendered in the disclosure`);
    searchFrom = idx + 1;
  });

  // The bounded disclosure title is rendered (paths are in a disclosure, not a
  // wall of text), and the beginner classification hint renders before the
  // first technical path line.
  assert.ok(
    renderedTexts.some((s) => s.includes("taskPreflightPathDisclosure")),
    "path disclosure title rendered",
  );
  const hintIdx = renderedTexts.findIndex((s) => s.includes("taskPreflightClassificationHint"));
  const firstPathIdx = renderedTexts.findIndex((s) => s.includes(`${pathEvidence[0]!.path} - `));
  assert.ok(hintIdx >= 0 && firstPathIdx >= 0 && hintIdx < firstPathIdx,
    "beginner classification copy appears before technical path lines");
});

test("Hub preflight card explains a patch-not-applicable issue before collapsed diagnostics bilingually", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const enSection = i18n.slice(0, i18n.indexOf("zh: {"));
  const zhSection = i18n.slice(i18n.indexOf("zh: {"));
  // Renderer binds the canonical issue and leads with the explanation.
  assert.ok(src.includes("result.applicabilityIssue"), "renderer reads applicabilityIssue");
  assert.ok(src.includes('"preflight-applicability"'), "explanation section marker");
  // Raw diagnostics are suppressed from the primary copy when the issue exists.
  assert.ok(src.includes("rejects.length && !applicabilityIssue"),
    "primary rejection list is suppressed for the applicability case");
  assert.ok(src.includes('event.presentationCode === "integration-patch-not-applicable"'),
    "ordinary Task Detail timeline consumes the closed applicability presentation hint");
  assert.ok(src.includes('return t("tlPreflightPatchNotApplicable")'),
    "ordinary Task Detail localizes the applicability summary instead of showing raw git text");
  // Every applicability copy key exists in both locales.
  for (const key of [
    "taskPreflightApplicabilityTitle",
    "taskPreflightApplicabilityHappened",
    "taskPreflightApplicabilityMeaning",
    "taskPreflightApplicabilityNext",
    "tlPreflightPatchNotApplicable",
  ]) {
    assert.ok(enSection.includes(key), `en ${key} present`);
    assert.ok(zhSection.includes(key), `zh ${key} present`);
  }
  // Bilingual copy is real (not English fallback) and stays cautious.
  assert.ok(enSection.includes("no longer applies cleanly"), "en what-happened copy");
  assert.ok(enSection.includes("did not determine the exact cause"), "en cautious meaning");
  assert.ok(enSection.includes("decide which changes to keep"), "en next action");
  assert.ok(enSection.includes("The exact conflict was not determined"), "en next action does not assert an exact conflict");
  assert.ok(zhSection.includes("无法干净地应用"), "zh what-happened copy");
  assert.ok(zhSection.includes("没有判断具体原因"), "zh cautious meaning");
  assert.ok(zhSection.includes("决定保留哪些改动"), "zh next action");
  assert.ok(zhSection.includes("具体冲突尚未确定"), "zh next action does not assert an exact conflict");
  // The applicability copy itself must not blame the Worker or promise that
  // retrying unchanged fixes the problem (other timeline labels may use those
  // words, so check only the applicability values).
  function extractI18nValue(section: string, key: string): string {
    const m = section.match(new RegExp(key + ':\\s*"([^"]*)"'));
    return m ? m[1]! : "";
  }
  const enApplicability = [
    "taskPreflightApplicabilityHappened",
    "taskPreflightApplicabilityMeaning",
    "taskPreflightApplicabilityNext",
  ].map((k) => extractI18nValue(enSection, k)).join(" ");
  const zhApplicability = [
    "taskPreflightApplicabilityHappened",
    "taskPreflightApplicabilityMeaning",
    "taskPreflightApplicabilityNext",
  ].map((k) => extractI18nValue(zhSection, k)).join(" ");
  assert.ok(!/worker failed/i.test(enApplicability), "en applicability copy does not blame the Worker");
  assert.ok(!/retry.*will fix/i.test(enApplicability), "en applicability copy does not promise retry fixes it");
  assert.ok(!/重试即可|重试就能/.test(zhApplicability), "zh applicability copy does not promise retry fixes it");

  // Render with the issue and verify ordering + no raw diagnostic in primary copy.
  const fnSource = extractFunctionSource(src, "renderPreflightResult");
  const renderedTexts: string[] = [];
  function fakeEl(tag: string) {
    return {
      tagName: tag,
      className: "",
      textContent: undefined as string | undefined,
      children: [] as unknown[],
      attrs: {} as Record<string, string>,
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      appendChild(c: unknown) { this.children.push(c); return c; },
      querySelector() { return null; },
      addEventListener() {},
    };
  }
  function h(tag: string, cls: string, text: unknown) {
    const el = fakeEl(tag);
    el.className = cls || "";
    if (text !== undefined) {
      el.textContent = String(text);
      renderedTexts.push(String(text));
    }
    return el;
  }
  function t(key: string) { return `[${key}]`; }
  function collapsedSection(title: string, node: unknown) {
    const el = fakeEl("details");
    renderedTexts.push(String(title));
    if (node) el.appendChild(node);
    return el;
  }
  function boundedDiagnostic(v: unknown) { return String(v); }
  function deliveryPlanExpectation() { return "not-configured"; }
  const DELIVERY_STAGE_KEYS = ["sourceApply", "sourceVerify", "artifactBuild", "runtimeActivation"];
  const DELIVERY_STAGE_LABEL_KEYS: Record<string, string> = {
    sourceApply: "stageSourceApply",
    sourceVerify: "stageSourceVerify",
    artifactBuild: "stageArtifactBuild",
    runtimeActivation: "stageRuntimeActivation",
  };
  const documentStub = {
    createElement: fakeEl,
    createTextNode(text: unknown) { renderedTexts.push(String(text)); return { text: String(text) }; },
  };
  const factory = new Function(
    "h", "t", "collapsedSection", "boundedDiagnostic", "deliveryPlanExpectation",
    "DELIVERY_STAGE_KEYS", "DELIVERY_STAGE_LABEL_KEYS", "document",
    `${fnSource}\nreturn renderPreflightResult;`,
  );
  const renderPreflightResult = factory(
    h, t, collapsedSection, boundedDiagnostic, deliveryPlanExpectation,
    DELIVERY_STAGE_KEYS, DELIVERY_STAGE_LABEL_KEYS, documentStub,
  ) as (result: Record<string, unknown>) => { attrs: Record<string, string> };

  const rawDiagnostic = "Patch does not apply cleanly: error: patch failed";
  const result = {
    id: "rec-applic",
    expiresAt: "2026-07-29T00:00:00.000Z",
    rejectionReasons: [rawDiagnostic],
    affectedFiles: ["src/a.ts"],
    deliveryPlan: { stages: {} },
    applicabilityIssue: { code: "patch-not-applicable" },
  };
  let card: { attrs: Record<string, string> } | undefined;
  assert.doesNotThrow(() => {
    card = renderPreflightResult(result);
  }, "renderPreflightResult must not throw with the applicability issue");
  assert.equal(card!.attrs["data-fl-role"], "preflight-result");

  // The explanation (what happened + uncertain meaning) and the one coherent
  // applicability next action (in the footer) all render before the collapsed
  // technical disclosure, which is the only place raw diagnostics may appear.
  const titleIdx = renderedTexts.indexOf("[taskPreflightApplicabilityTitle]");
  const happenedIdx = renderedTexts.indexOf("[taskPreflightApplicabilityHappened]");
  const meaningIdx = renderedTexts.indexOf("[taskPreflightApplicabilityMeaning]");
  const nextIdx = renderedTexts.indexOf("[taskPreflightApplicabilityNext]");
  const disclosureIdx = renderedTexts.indexOf("[taskPreflightReceiptDetails]");
  assert.ok(titleIdx >= 0 && happenedIdx >= 0 && meaningIdx >= 0 && nextIdx >= 0,
    "explanation and applicability next action rendered");
  assert.ok(meaningIdx < nextIdx, "explanation appears before the applicability next action");
  assert.ok(disclosureIdx >= 0, "collapsed technical disclosure rendered");
  assert.ok(nextIdx < disclosureIdx,
    "applicability next action appears before the collapsed technical disclosure");
  // No contradictory generic footer for the applicability case.
  assert.ok(
    !renderedTexts.some((s) => s.indexOf("[taskPreflightNextReject]") === 0 || s.includes("[taskPreflightNextReject]")),
    "no generic correct-the-source footer for the applicability case",
  );
  // Raw git diagnostic appears only inside the collapsed disclosure, never in
  // the primary copy before the explanation.
  const rawIdx = renderedTexts.findIndex((s) => s.includes(rawDiagnostic));
  assert.ok(rawIdx >= 0, "raw diagnostic retained as technical evidence");
  assert.ok(nextIdx < rawIdx, "raw diagnostic appears only after the applicability next action");

  // Legacy receipt without the structured issue: no explanation block, and the
  // existing readable rejection list is preserved (no throw).
  const legacyResult = {
    id: "rec-legacy",
    expiresAt: "2026-07-29T00:00:00.000Z",
    rejectionReasons: ["Patch changes 6 files (limit: 5)"],
    affectedFiles: ["src/a.ts"],
    deliveryPlan: { stages: {} },
  };
  renderedTexts.length = 0;
  let legacyCard: { attrs: Record<string, string> } | undefined;
  assert.doesNotThrow(() => {
    legacyCard = renderPreflightResult(legacyResult);
  }, "legacy receipt without the issue must still render");
  assert.equal(legacyCard!.attrs["data-fl-role"], "preflight-result");
  assert.ok(
    !renderedTexts.some((s) => s.includes("taskPreflightApplicability")),
    "legacy receipt renders no applicability explanation",
  );
  assert.ok(
    renderedTexts.some((s) => s.includes("Patch changes 6 files")),
    "legacy rejection list remains readable",
  );
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
  // The adapter delegates to the shared compact projection so recent Tasks
  // and History share one privacy boundary (no inline duplicate mapping).
  assert.ok(adapterBlock.includes("projectCompactTaskSummary"),
    "adapter delegates to the shared compact Task projection");

  // The shared compact projection method carries the verified-repaired-delivered
  // allowlist and the privacy boundary (not the route block).
  const methodIdx = serverSrc.indexOf("projectCompactTaskSummary(t");
  assert.ok(methodIdx > 0, "shared compact projection method exists");
  const braceStart = serverSrc.indexOf("{", methodIdx);
  assert.ok(braceStart > 0, "method opening brace located");
  let depth = 0;
  let methodEnd = braceStart;
  for (let i = braceStart; i < serverSrc.length; i += 1) {
    if (serverSrc[i] === "{") depth += 1;
    if (serverSrc[i] === "}") {
      depth -= 1;
      if (depth === 0) { methodEnd = i; break; }
    }
  }
  const methodBlock = serverSrc.slice(methodIdx, methodEnd + 1);
  // Compact shape: only status / checkId / createdAt are accepted.
  assert.ok(methodBlock.includes('"verified-repaired-delivered"'),
    "shared projection requires verified-repaired-delivered status");
  assert.ok(methodBlock.includes("checkId"),
    "shared projection preserves checkId");
  assert.ok(methodBlock.includes("createdAt"),
    "shared projection preserves createdAt");
  // Privacy boundary: forbidden fields never appear in the safe Task shape.
  assert.ok(!methodBlock.includes("remediationReason"),
    "no remediation reason leaked");
  assert.ok(!methodBlock.includes("remediationCommand"),
    "no remediation command leaked");
  assert.ok(!methodBlock.includes("remediationOutput"),
    "no remediation output leaked");
  assert.ok(!methodBlock.includes("remediationPrompt"),
    "no remediation prompt leaked");
  assert.ok(!methodBlock.includes("sourcePath"),
    "no sourcePath leaked in the projection");
  // The adapter must not let the disposition overwrite machine status.
  assert.ok(methodBlock.includes("t.status"),
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
  assert.ok(rStatsBlock.includes("acceptedDeliverySampleCount"),
    "stats reads acceptedDeliverySampleCount");
  assert.ok(rStatsBlock.includes("acceptedDeliveryUnavailableCount"),
    "stats reads acceptedDeliveryUnavailableCount");
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
    "statsFinalDeliveryUnavailable",
    "statsProviderCaveat",
  ]) {
    assert.ok(i18n.includes(key), `i18n key ${key} present`);
  }
  assert.ok(i18n.includes("已核验交付"), "zh final-delivery badge");
  assert.ok(i18n.includes("机器执行结果"), "zh machine outcome label");
  assert.ok(i18n.includes("最终交付"), "zh final delivery label");
  assert.ok(i18n.includes("绝不把机器通过单独算作接受"),
    "zh says machine success alone is not accepted delivery");
  // English truthfulness: final delivery never equals machine success alone.
  assert.match(i18n,
    /statsProviderCaveat['"]?\s*:\s*"[^"]*never machine success alone/i);
  assert.match(i18n,
    /statsAcceptedDeliveryLine['"]?\s*:\s*"[^"]*\{accepted\}[^"]*\{sample\}/i);
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

test("Hub surfaces connectivity as Daemon network recovery with bilingual plain language", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(src.includes("connectivity: \"journeyFailureConnectivity\"")
    || src.includes('connectivity: "journeyFailureConnectivity"'),
    "failureCategoryLabel maps connectivity");
  assert.ok(src.includes('"connectivity": "journeyNextConnectivity"')
    || src.includes("connectivity: \"journeyNextConnectivity\""),
    "nextActionLabel maps connectivity");
  assert.ok(src.includes('category === "connectivity"'),
    "resolveCauseWhy handles connectivity");
  for (const key of [
    "journeyFailureConnectivity",
    "journeyNextConnectivity",
    "journeyCauseWhyConnectivity",
  ]) {
    assert.ok(i18n.includes(key + ":"), `i18n has ${key}`);
  }
  // English: TUI/Daemon distinction and recovery path without secrets.
  assert.ok(i18n.includes("interactive Grok TUI"), "en explains TUI can work while Daemon fails");
  assert.ok(i18n.includes("Daemon process network environment"), "en recovery mentions Daemon environment");
  assert.ok(i18n.includes("bounded smoke check"), "en recovery recommends one smoke check");
  assert.ok(i18n.includes("not model quality"), "en excludes model-quality blame");
  // Chinese: same semantics for operators.
  assert.ok(i18n.includes("网络连通性"), "zh connectivity label");
  assert.ok(i18n.includes("交互式 Grok TUI"), "zh explains TUI/Daemon environment distinction");
  assert.ok(i18n.includes("Daemon 进程的网络环境"), "zh recovery mentions Daemon environment");
  assert.ok(i18n.includes("有界冒烟验证"), "zh recovery recommends smoke check");
  assert.ok(i18n.includes("不是模型质量问题"), "zh excludes model-quality blame");
  // Privacy: no raw proxy values, credentials, or endpoint hostnames in copy.
  assert.ok(!i18n.includes("HTTP_PROXY="));
  assert.ok(!i18n.includes("cli-chat-proxy.grok.com"));
  assert.ok(!i18n.includes("super-secret"));
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
  // Long quiet must not use error styling — silence is not failure.
  const badgeSource = extractFunctionSource(src, "boardActivityBadge");
  assert.ok(!badgeSource.includes('badge-err'), "long quiet must not render as error badge");
  for (const key of [
    "taskActivityActive", "taskActivityQuiet", "taskActivityStalled",
    "taskProgressRunningQuiet", "taskProgressRunningStalled",
  ]) {
    assert.ok(i18n.includes(key + ":"), `i18n has ${key}`);
  }
  assert.ok(i18n.includes("较长时间没有新证据"), "zh long-quiet copy is plain language");
  assert.ok(i18n.includes("no new evidence for a while"), "en long-quiet copy is plain language");
  // Execute the pure kind classifier against synthetic progress cursors.
  const liveStageSource = extractFunctionSource(src, "taskLiveStage");
  const kindSource = extractFunctionSource(src, "boardActivityKind");
  const boardActivityKind = new Function(
    `${liveStageSource}\n${kindSource}\nreturn boardActivityKind;`,
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
  // Canonical liveStage observation is preferred when present.
  assert.equal(
    boardActivityKind({
      progress: {
        activity: "active",
        liveStage: { stage: "model-responding", observation: "quiet", meaning: "normal", next: "wait-for-new-evidence", evidence: "model-activity" },
      },
    }),
    "quiet",
  );
});

test("Hub dual-clock copy explains Runtime signal vs substantive progress in EN and ZH", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  for (const name of ["dualClockPlainText", "dualClockNextText", "boardActivityKind"]) {
    assert.ok(src.includes(`function ${name}(`), `${name} must exist`);
  }
  assert.ok(src.includes("dualClockPlainText(p)"), "board cards render dual-clock line");
  assert.ok(src.includes("dualClockPlainText(currentProgress)"), "Task Detail renders dual-clock line");
  // Fresh Runtime signal is never diagnosed as a dead connection.
  assert.ok(src.includes('dual.runtimeSignalObservation === "active") return "active"'));
  assert.ok(!/—/.test(src), "app.js must not introduce em dashes");
  for (const key of [
    "taskDualClockBoard", "taskDualClockStalled", "taskDualClockStalledBaseline",
    "taskDualClockBaseline", "taskDualClockUnknown",
    "taskDualClockNextProgress", "workersAdvNoEffectiveProgress",
    "workersAdvNoEffectiveProgressHelp", "workersCardNoEffectiveProgressLimited",
    "workersCardNoEffectiveProgressUnlimited", "workersAdvMaxDurationHelp",
  ]) {
    assert.ok(i18n.includes(key + ":"), `i18n has ${key}`);
  }
  assert.ok(i18n.includes("Heard from Worker"), "en Runtime-signal wording");
  assert.ok(i18n.includes("Last substantive step"), "en effective-progress wording");
  assert.ok(i18n.includes("no substantive step has been observed yet")
    || i18n.includes("no substantive step observed yet"), "en baseline is not progress");
  assert.ok(i18n.includes("Worker 最近回应于"), "zh Runtime-signal wording");
  assert.ok(i18n.includes("上次实质进展于"), "zh effective-progress wording");
  assert.ok(i18n.includes("尚未观察到实质进展"), "zh baseline is not progress");
  assert.ok(i18n.includes("Processing heartbeats alone do not count as progress"), "en policy help");
  assert.ok(i18n.includes("仅有处理中心跳不算实质进展"), "zh policy help");
  assert.ok(i18n.includes("does not set a total execution-time limit"), "null policy does not claim duration cap");
  assert.ok(i18n.includes("不表示存在总执行时长上限"), "zh null policy does not claim duration cap");
  assert.ok(i18n.includes("proves neither network health nor network failure"), "en avoids false network diagnosis");
  assert.ok(i18n.includes("既不能证明网络健康，也不能证明网络故障"), "zh avoids false network diagnosis");
  // Primary copy must not expose raw field names as user-facing labels.
  assert.ok(!src.includes("latestRuntimeSignalAt:"), "raw field names are not primary UI labels");
  assert.ok(src.includes("workersAdvNoEffectiveProgress"), "advanced setting uses no-effective-progress label");
  assert.ok(src.includes("workersAdvNoEffectiveProgressHelp"), "advanced setting explains the stop");
  assert.ok(src.includes("taskDualClockStalledBaseline"), "baseline uses distinct plain-language path");
});

test("Hub live-stage helpers translate closed codes without recomputing lifecycle", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  for (const name of [
    "taskLiveStage", "liveStageNowText", "liveStageMeaningText", "liveStageNextText",
    "liveStageCompactText", "liveStageDetailText",
  ]) {
    assert.ok(src.includes(`function ${name}(`), `${name} must exist`);
  }
  for (const key of [
    "liveStageNowWaitingModel", "liveStageNowModelProcessing", "liveStageNowModelResponding",
    "liveStageNowUsingTool", "liveStageNowVerifying", "liveStageNowFailed",
    "liveStageMeaningProcessing", "liveStageMeaningQuiet", "liveStageCompact", "liveStageDetail", "taskTechnicalLiveStage",
  ]) {
    assert.ok(i18n.includes(key + ":"), `i18n has ${key}`);
  }
  assert.ok(i18n.includes("Waiting for the model"), "en waiting-for-model copy");
  assert.ok(i18n.includes("正在等待模型"), "zh waiting-for-model copy");
  assert.ok(i18n.includes("Model is processing"), "en model-processing copy");
  assert.ok(i18n.includes("模型正在处理"), "zh model-processing copy");
  assert.ok(i18n.includes("useful output is not confirmed yet"), "en processing avoids claiming delivery progress");
  assert.ok(i18n.includes("还不能说明已经产出有效结果"), "zh processing avoids claiming delivery progress");
  assert.ok(i18n.includes("No new update is visible"), "en quiet says no new update is visible");
  assert.ok(i18n.includes("看不到新的更新"), "zh quiet says no new update is visible");
  assert.ok(i18n.includes("不等于失败"), "zh quiet is not a failure");
  assert.ok(i18n.includes("never starts a retry"), "en quiet never retries");
  assert.ok(i18n.includes("不会自动重试"), "zh quiet never retries");
  // Follow-up stage bilingual copy: explicitly says "without another Worker".
  assert.ok(i18n.includes("liveStageNowCandidateReverifying"), "i18n has candidate reverifying key");
  assert.ok(i18n.includes("liveStageNowRemediationChecking"), "i18n has remediation checking key");
  assert.ok(i18n.includes("liveStageNextReverification"), "i18n has reverification next key");
  assert.ok(i18n.includes("liveStageNextRemediation"), "i18n has remediation next key");
  assert.ok(i18n.includes("without another Worker"), "en follow-up copy says without another Worker");
  assert.ok(i18n.includes("不会再次调用 Worker"), "zh follow-up copy says without another Worker");

  const helpers = [
    "taskLiveStage", "liveStageNowText", "liveStageMeaningText", "liveStageNextText",
    "liveStageCompactText", "liveStageDetailText",
  ].map((name) => extractFunctionSource(src, name)).join("\n");
  const liveStageCompactText = new Function(
    "t",
    `${helpers}\nreturn liveStageCompactText;`,
  )((key: string, vars?: Record<string, string>) => {
    if (key === "liveStageCompact") {
      return `${vars?.now}. ${vars?.meaning}. ${vars?.next}.`;
    }
    return key;
  }) as (live: Record<string, unknown>) => string;
  const compact = liveStageCompactText({
    stage: "using-tool",
    observation: "active",
    meaning: "normal",
    next: "wait-for-tool-result",
    evidence: "tool-lifecycle",
  });
  assert.ok(compact.includes("liveStageNowUsingTool"));
  assert.ok(compact.includes("liveStageMeaningActive"));
  assert.ok(compact.includes("liveStageNextTool"));
  // UI must not invent failure from quiet observation.
  const quietCompact = liveStageCompactText({
    stage: "model-responding",
    observation: "quiet",
    meaning: "normal",
    next: "wait-for-new-evidence",
    evidence: "model-activity",
  });
  assert.ok(quietCompact.includes("liveStageMeaningQuiet"));
  assert.ok(!quietCompact.toLowerCase().includes("failed"));
});

test("Hub live-stage meaning is stage-aware across active, waiting, completed, quiet, and attention", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const helpers = [
    "liveStageNowText", "liveStageMeaningText", "liveStageNextText",
    "liveStageCompactText",
  ].map((name) => extractFunctionSource(src, name)).join("\n");
  const translate = (key: string) => key;
  const meaning = new Function("t", `${helpers}\nreturn liveStageMeaningText;`)(
    translate,
  ) as (meaning: string, observation: string, stage: string) => string;
  const nowText = new Function("t", `${helpers}\nreturn liveStageNowText;`)(
    translate,
  ) as (stage: string) => string;
  const nextText = new Function("t", `${helpers}\nreturn liveStageNextText;`)(
    translate,
  ) as (next: string) => string;
  const compactText = new Function("t", `${helpers}\nreturn liveStageCompactText;`)(
    (key: string, vars?: Record<string, string>) =>
      key === "liveStageCompact" ? `${vars?.now}. ${vars?.meaning}. ${vars?.next}.` : key,
  ) as (live: Record<string, unknown>) => string;

  // Processing reports runtime activity without claiming useful output.
  assert.equal(
    meaning("normal", "active", "model-processing"),
    "liveStageMeaningProcessing",
  );
  // Other active progress stages say progress is normal, never that waiting is normal.
  for (const stage of ["model-responding", "using-tool", "verifying", "worker-finished", "legacy-running"]) {
    assert.equal(
      meaning("normal", "active", stage),
      "liveStageMeaningActive",
      `${stage} active says progress is normal`,
    );
  }
  // Ordinary waiting stages say waiting is normal.
  for (const stage of ["queued", "preparing-workspace", "waiting-for-model", "unknown"]) {
    assert.equal(
      meaning("normal", "active", stage),
      "liveStageMeaningWaiting",
      `${stage} active says waiting is normal`,
    );
  }
  // Completion says Worker work is finished (not normal waiting).
  assert.equal(meaning("normal", "terminal", "completed"), "liveStageMeaningCompleted");
  // Quiet observation always says no new update is visible, regardless of stage.
  assert.equal(meaning("normal", "quiet", "model-responding"), "liveStageMeaningQuiet");
  assert.equal(meaning("normal", "quiet", "worker-finished"), "liveStageMeaningQuiet");
  // Failed/interrupted still require explicit failure evidence.
  assert.equal(meaning("attention", "terminal", "failed"), "liveStageMeaningAttention");
  assert.equal(meaning("attention", "terminal", "interrupted"), "liveStageMeaningAttention");

  // The Worker-finished transition exposes its own now/next closed codes.
  assert.equal(nowText("worker-finished"), "liveStageNowWorkerFinished");
  assert.equal(nextText("wait-for-verification-start"), "liveStageNextVerificationStart");
  const workerFinishedCompact = compactText({
    stage: "worker-finished",
    observation: "active",
    meaning: "normal",
    next: "wait-for-verification-start",
    evidence: "terminal",
  });
  assert.ok(workerFinishedCompact.includes("liveStageNowWorkerFinished"));
  assert.ok(workerFinishedCompact.includes("liveStageMeaningActive"));
  assert.ok(workerFinishedCompact.includes("liveStageNextVerificationStart"));
  assert.ok(!workerFinishedCompact.includes("liveStageNowWaitingModel"));

  // Bilingual frozen copy exists for every stage-aware category and the new stage.
  for (const key of [
    "liveStageMeaningActive", "liveStageMeaningWaiting", "liveStageMeaningCompleted",
    "liveStageMeaningQuiet", "liveStageMeaningAttention",
    "liveStageNowWorkerFinished", "liveStageNextVerificationStart",
  ]) {
    assert.ok(i18n.includes(key + ":"), `i18n has ${key}`);
  }
});

test("Hub live-stage copy never says durable event or 持久事件", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(!i18n.includes("durable event"), "en live-stage copy drops durable event");
  assert.ok(!i18n.includes("持久事件"), "zh live-stage copy drops 持久事件");
  // Ordinary waiting now asks for the next visible update in both languages.
  assert.ok(i18n.includes("a new visible update"), "en next-step asks for the next visible update");
  assert.ok(i18n.includes("等待下一次可见更新"), "zh next-step asks for the next visible update");
});

test("Hub task summary follows the end-to-end stage after machine verification", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const progressSource = extractFunctionSource(src, "taskProgressSummary");
  const finalDeliverySource = extractFunctionSource(src, "hasVerifiedFinalDelivery");
  const liveHelpers = [
    "taskLiveStage", "liveStageNowText", "liveStageMeaningText", "liveStageNextText",
    "liveStageCompactText", "liveStageDetailText", "boardActivityKind",
  ].map((name) => extractFunctionSource(src, name)).join("\n");
  const summarize = new Function(
    "t",
    "preparationProgressText",
    `${liveHelpers}\n${finalDeliverySource}\n${progressSource}\nreturn taskProgressSummary;`,
  )(
    (key: string, vars?: Record<string, string>) => {
      if (key === "liveStageCompact") {
        return `LIVE:${vars?.now}`;
      }
      return key;
    },
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
    summarize({
      status: "running",
      progress: {
        activity: "active",
        liveStage: {
          stage: "using-tool",
          observation: "active",
          meaning: "normal",
          next: "wait-for-tool-result",
          evidence: "tool-lifecycle",
        },
      },
    }),
    "LIVE:liveStageNowUsingTool",
  );
  assert.equal(
    summarize({ status: "succeeded", decisionStage: "ready-for-integration" }),
    "taskProgressReadyIntegration",
  );
  assert.equal(
    summarize({ status: "succeeded", decisionStage: "delivered" }),
    "taskProgressDeliveredNoActivation",
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
  assert.equal(
    summarize({
      status: "failed",
      remediationDisposition: {
        status: "verified-repaired-delivered",
        acceptanceBasis: "amended-acceptance",
      },
    }),
    "taskProgressAmendedDelivered",
    "a Main acceptance correction must not be presented as Worker failure",
  );
  assert.equal(
    summarize({
      status: "succeeded",
      remediationDisposition: {
        status: "verified-repaired-delivered",
        acceptanceBasis: "original-acceptance",
      },
    }),
    "taskProgressRepairedAfterMachinePass",
    "a machine-successful Task must not be presented as Worker failure",
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
    "taskProgressDeliveredNoActivation",
    "taskProgressActivated",
    "taskProgressIntegrationFailed",
    "taskProgressRepairedAfterMachinePass",
    "taskProgressAmendedDelivered",
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

test("Hub task summary shows follow-up live stage on terminal Tasks", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const progressSource = extractFunctionSource(src, "taskProgressSummary");
  const finalDeliverySource = extractFunctionSource(src, "hasVerifiedFinalDelivery");
  const liveHelpers = [
    "taskLiveStage", "liveStageNowText", "liveStageMeaningText", "liveStageNextText",
    "liveStageCompactText", "liveStageDetailText", "boardActivityKind",
  ].map((name) => extractFunctionSource(src, name)).join("\n");
  const summarize = new Function(
    "t",
    "preparationProgressText",
    `${liveHelpers}\n${finalDeliverySource}\n${progressSource}\nreturn taskProgressSummary;`,
  )(
    (key: string, vars?: Record<string, string>) => {
      if (key === "liveStageCompact") {
        return `LIVE:${vars?.now}`;
      }
      return key;
    },
    () => "preparing",
  ) as (task: Record<string, unknown>) => string;

  // Failed Task with open Candidate reverification: progress summary shows live stage.
  const reverifyingSummary = summarize({
    status: "failed",
    decisionStage: "revision-requested",
    progress: {
      activity: "active",
      liveStage: {
        stage: "candidate-reverifying",
        observation: "active",
        meaning: "normal",
        next: "wait-for-reverification-result",
        evidence: "candidate-reverification",
      },
    },
  });
  assert.ok(reverifyingSummary.startsWith("LIVE:liveStageNowCandidateReverifying"),
    "open reverification takes precedence over historical revision wording");

  // Failed Task with open remediation check: progress summary shows live stage.
  const remedSummary = summarize({
    status: "failed",
    progress: {
      activity: "active",
      liveStage: {
        stage: "remediation-checking",
        observation: "active",
        meaning: "normal",
        next: "wait-for-remediation-result",
        evidence: "remediation-check",
      },
    },
  });
  assert.ok(remedSummary.startsWith("LIVE:liveStageNowRemediationChecking"),
    "failed Task with open remediation shows follow-up live stage");

  // Ordinary failed Task without follow-up stays on the standard progress message.
  const ordinary = summarize({
    status: "failed",
  });
  assert.equal(ordinary, "taskProgressFailed");

  // Succeeded Task with open remediation check also shows live stage.
  const succeededRemed = summarize({
    status: "succeeded",
    progress: {
      activity: "active",
      liveStage: {
        stage: "remediation-checking",
        observation: "active",
        meaning: "normal",
        next: "wait-for-remediation-result",
        evidence: "remediation-check",
      },
    },
  });
  assert.ok(succeededRemed.startsWith("LIVE:liveStageNowRemediationChecking"),
    "succeeded Task with open remediation shows follow-up live stage");
});

test("Hub final-delivery UI explains amended-acceptance without command text", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(src.includes('acceptanceBasis === "amended-acceptance"'),
    "UI branches on amended-acceptance basis");
  assert.ok(src.includes("taskFinalDeliveryAmended") || src.includes("taskDualOutcomeAmendedHint"),
    "UI references amended delivery copy keys");
  assert.ok(i18n.includes("taskFinalDeliveryAmended"),
    "EN/ZH i18n includes amended delivery label");
  assert.ok(i18n.includes("taskDualOutcomeAmendedHint"),
    "EN/ZH i18n includes amended dual-outcome hint");
  assert.ok(i18n.includes("journeyRemediationAmended"),
    "EN/ZH i18n includes amended remediation journey copy");
  assert.ok(i18n.includes("storyCurrentAmended"),
    "EN/ZH i18n includes amended current-result story");
  assert.ok(i18n.includes("storyFinalAmended"),
    "EN/ZH i18n includes amended final-result story");
  // Privacy: command text and free-form reason text must not appear as UI data bindings.
  assert.ok(!src.includes("replacementCommand"),
    "app.js must not bind replacementCommand");
  assert.ok(!src.includes("originalCommand"),
    "app.js must not bind originalCommand");
  assert.ok(!i18n.includes("npm run typecheck"),
    "i18n must not hardcode command text");
  // Beginner EN/ZH copy must not surface the internal reason code.
  assert.ok(!i18n.includes("contradictory-acceptance"),
    "beginner i18n copy must not show contradictory-acceptance reason code");
  assert.ok(i18n.includes("Main corrected its own acceptance definition"),
    "EN beginner copy explains Main corrected acceptance");
  assert.ok(i18n.includes("Main 修正了自己的验收定义"),
    "ZH beginner copy explains Main corrected acceptance");
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

test("Hub Attempt history uses closed presentationState instead of false running copy", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  // Both Attempt history surfaces share the same primary presentation helpers.
  assert.ok(src.includes("function attemptPrimaryLabel("), "primary Attempt label helper");
  assert.ok(src.includes("function attemptPresentationExplain("), "Attempt explanation helper");
  assert.ok(src.includes("function attemptHasClosedPresentation("), "closed presentation guard");
  assert.ok(src.includes("status: attemptPrimaryLabel(att)"), "collaboration journey uses primary label");
  assert.ok(src.includes("+ attemptPrimaryLabel(att)"), "Process tab uses primary label");
  assert.ok(src.includes("attemptPresentationExplain(att)"), "explanation is rendered");
  assert.ok(src.includes("journeyAttemptRecordedStatus"), "recorded status is secondary only");

  // Primary label never falls through to running when presentationState is closed.
  const labelSource = [
    extractFunctionSource(src, "attemptStateLabel"),
    extractFunctionSource(src, "attemptPrimaryLabel"),
    extractFunctionSource(src, "attemptPresentationExplain"),
    extractFunctionSource(src, "attemptHasClosedPresentation"),
  ].join("\n");
  const dictEn: Record<string, string> = {
    journeyAttemptQueued: "waiting",
    journeyAttemptRunning: "running",
    journeyAttemptSucceeded: "completed",
    journeyAttemptFailed: "failed",
    journeyAttemptInterrupted: "interrupted",
    journeyAttemptUnknown: "unknown",
    journeyAttemptEndedAfterWorkerCompletion: "ended after Worker completion",
    journeyAttemptEndedAfterWorkerCompletionExplain:
      "The Worker reported completion; a later result-finalizing step failed.",
    journeyAttemptEndedUnsuccessfully: "ended unsuccessfully",
    journeyAttemptEndedUnsuccessfullyExplain:
      "This Attempt ended without a successful Worker completion.",
    journeyAttemptRecordedStatus: "Recorded status: {status}",
  };
  const dictZh: Record<string, string> = {
    journeyAttemptQueued: "等待中",
    journeyAttemptRunning: "执行中",
    journeyAttemptSucceeded: "已完成",
    journeyAttemptFailed: "失败",
    journeyAttemptInterrupted: "已中断",
    journeyAttemptUnknown: "未知",
    journeyAttemptEndedAfterWorkerCompletion: "Worker 完成后已结束",
    journeyAttemptEndedAfterWorkerCompletionExplain:
      "Worker 已报告完成；后续结果收尾步骤失败。",
    journeyAttemptEndedUnsuccessfully: "已结束且未成功",
    journeyAttemptEndedUnsuccessfullyExplain:
      "本次尝试已结束，且没有成功的 Worker 完成记录。",
    journeyAttemptRecordedStatus: "记录状态：{status}",
  };
  function makeT(dict: Record<string, string>) {
    return (key: string, params?: Record<string, string>) => {
      let value = dict[key] ?? key;
      if (params) {
        for (const [name, replacement] of Object.entries(params)) {
          value = value.replace(`{${name}}`, replacement);
        }
      }
      return value;
    };
  }
  const apiFor = (dict: Record<string, string>) => new Function("t", `
    ${labelSource}
    return {
      attemptPrimaryLabel: attemptPrimaryLabel,
      attemptPresentationExplain: attemptPresentationExplain,
      attemptHasClosedPresentation: attemptHasClosedPresentation,
      attemptStateLabel: attemptStateLabel
    };
  `)(makeT(dict)) as {
    attemptPrimaryLabel(att: unknown): string;
    attemptPresentationExplain(att: unknown): string;
    attemptHasClosedPresentation(att: unknown): boolean;
    attemptStateLabel(status: string): string;
  };

  const liveAttempt = {
    ordinal: 2,
    status: "running",
    presentationState: "ended-after-worker-completion",
  };
  for (const [locale, dict] of [["en", dictEn], ["zh", dictZh]] as const) {
    const api = apiFor(dict);
    const primary = api.attemptPrimaryLabel(liveAttempt);
    const explain = api.attemptPresentationExplain(liveAttempt);
    assert.equal(primary, dict.journeyAttemptEndedAfterWorkerCompletion, `${locale} primary closed copy`);
    assert.equal(explain, dict.journeyAttemptEndedAfterWorkerCompletionExplain, `${locale} explain`);
    assert.equal(api.attemptHasClosedPresentation(liveAttempt), true);
    assert.ok(!/running|执行中/i.test(primary), `${locale} primary must not say still running`);
    assert.ok(!/running|执行中/i.test(explain), `${locale} explain must not say still running`);
    // Secondary technical evidence may still expose the recorded running status.
    assert.equal(api.attemptStateLabel("running"), dict.journeyAttemptRunning);
  }

  // Genuine active Attempt without presentationState still says running / 执行中.
  const activeAttempt = { ordinal: 1, status: "running" };
  assert.equal(apiFor(dictEn).attemptPrimaryLabel(activeAttempt), "running");
  assert.equal(apiFor(dictZh).attemptPrimaryLabel(activeAttempt), "执行中");
  assert.equal(apiFor(dictEn).attemptPresentationExplain(activeAttempt), "");

  // Failure without Worker completion never claims post-Worker finalization.
  const earlyFail = { ordinal: 1, status: "running", presentationState: "ended-unsuccessfully" };
  const earlyApi = apiFor(dictEn);
  const earlyEn = earlyApi.attemptPrimaryLabel(earlyFail);
  const earlyExplainEn = earlyApi.attemptPresentationExplain(earlyFail);
  assert.equal(earlyEn, "ended unsuccessfully");
  assert.notEqual(earlyEn, dictEn.journeyAttemptEndedAfterWorkerCompletion);
  assert.notEqual(earlyExplainEn, dictEn.journeyAttemptEndedAfterWorkerCompletionExplain);
  assert.ok(!/result-finalizing/i.test(earlyExplainEn));
  assert.ok(!/reported completion/i.test(earlyExplainEn));
  assert.ok(!/running/i.test(earlyEn));

  // Story adapter treats closed presentation as ended, not active Worker work.
  const startMarker = "/* TASK_STORY_ADAPTER_START */";
  const endMarker = "/* TASK_STORY_ADAPTER_END */";
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "story adapter boundaries present");
  const adapter = new Function(`${src.slice(start + startMarker.length, end)}\nreturn taskStoryPresentation;`)() as (
    task: unknown,
  ) => { steps: Array<{ id: string; state: string }> };
  const storyTask = {
    status: "failed",
    journey: {
      assignment: { contractVersion: 1, outcome: "Fix display", deliverables: [] },
      workerExecution: {
        provider: "xai",
        model: "grok-4.5",
        runtime: "grok-build",
        attempts: [liveAttempt],
        changedFilePaths: [],
      },
      independentVerification: { available: false, checks: [], conclusion: "not-run", failedCount: 0, totalCount: 0 },
      finalDelivery: {
        remediationDisposition: { status: "verified-repaired-delivered" },
      },
      cause: { what: "failed", why: "runtime failed after Worker completion", failureCategory: "runtime" },
      nextAction: { label: "done" },
    },
  };
  const story = adapter(storyTask);
  assert.equal(story.steps.find((s) => s.id === "worker-process")?.state, "failed",
    "closed presentation does not leave Worker process as running");
  assert.equal(story.steps.find((s) => s.id === "final-result")?.state, "complete",
    "Main remediation remains a separate final fact");
  assert.equal(story.steps.find((s) => s.id === "cause")?.state, "complete",
    "repaired delivery keeps original cause section independent");

  // Bilingual i18n keys exist with the intended meaning.
  for (const key of [
    "journeyAttemptEndedAfterWorkerCompletion",
    "journeyAttemptEndedAfterWorkerCompletionExplain",
    "journeyAttemptEndedUnsuccessfully",
    "journeyAttemptEndedUnsuccessfullyExplain",
    "journeyAttemptRecordedStatus",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  assert.ok(enSection.includes("ended after Worker completion"));
  assert.ok(enSection.includes("result-finalizing step failed"));
  assert.ok(zhSection.includes("Worker 完成后已结束"));
  assert.ok(zhSection.includes("后续结果收尾步骤失败"));
  assert.ok(zhSection.includes("已结束且未成功"));
  // Primary closed copy must not reuse the active-running strings as the label value.
  assert.ok(!/journeyAttemptEndedAfterWorkerCompletion['"]?\s*:\s*["']running["']/.test(enSection));
  assert.ok(!/journeyAttemptEndedAfterWorkerCompletion['"]?\s*:\s*["']执行中["']/.test(zhSection));
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

  const acceptanceWasWrong = JSON.parse(JSON.stringify(fixture)) as {
    status: string;
    journey: {
      workerExecution: { attempts: Array<{ status: string }> };
      finalDelivery: { remediationDisposition: { status: string; acceptanceBasis?: string } };
    };
  };
  acceptanceWasWrong.status = "failed";
  acceptanceWasWrong.journey.finalDelivery.remediationDisposition.acceptanceBasis = "amended-acceptance";
  const amendedView = adapter(acceptanceWasWrong);
  assert.equal(amendedView.steps.find((step) => step.id === "worker-process")?.state, "complete",
    "an amended acceptance record keeps Worker execution separate from the wrong Main check");

  assert.ok(src.includes("function renderTaskStory"));
  assert.ok(src.includes("function renderTaskWorkbench"), "full-page task workbench is shipped");
  assert.ok(src.includes("function renderTaskTabShell"), "task detail tabs are shipped");
  assert.ok(src.includes('"task-story-flow"'));
  assert.ok(src.includes('"task-story-current-result"'));
  assert.ok(src.includes('"task-story-step-" + step.id'));
  assert.ok(src.includes('"task-workbench"'), "workbench role is present");
  assert.ok(src.includes('"task-tabs"'), "tab shell role is present");
  assert.ok(src.includes("taskReportInstrTitle"), "instruction section uses plain-language key");
  assert.ok(src.includes("task-process-timeline"), "process timeline is surfaced openly");
  assert.ok(src.includes("detail-shell"), "detail uses full workbench shell not only a drawer strip");
  assert.ok(src.includes('id: "overview"'), "overview tab exists");
  assert.ok(src.includes('id: "actions"'), "actions tab exists");
  assert.ok(src.includes('id: "more"'), "more tab exists");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(css.includes(".task-story-steps"));
  assert.ok(css.includes(".task-story-step:not(:last-child)::after"));
  assert.ok(css.includes(".task-report-hero"), "task report hero styles ship");
  assert.ok(css.includes(".task-report-card"), "open report cards ship");
  assert.ok(css.includes(".task-tab-bar"), "tab bar styles ship");
  assert.ok(css.includes(".task-tab.is-active"), "active tab styles ship");
  assert.ok(css.includes("width: min(820px, 94vw)"), "detail is a right-side drawer on wide screens");
  assert.ok(css.includes("right: 0"), "drawer anchors to the right edge");
  assert.match(css, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.task-story-step/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?#fl-detail[\s\S]*?width: 100vw/, "drawer becomes a full-width sheet on narrow screens");
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
    "taskTabOverview", "taskTabInstruction", "taskTabProcess", "taskTabResult",
    "taskTabChecks", "taskTabActions", "taskTabMore",
  ]) {
    assert.ok(i18n.indexOf(key) !== i18n.lastIndexOf(key), `${key} exists in both locales`);
  }
  assert.ok(i18n.includes("Worker 收到的任务说明"), "zh instruction title is plain language");
  assert.ok(i18n.includes("What the Worker was asked to do"), "en instruction title is plain language");
  assert.ok(i18n.includes("活动记录"), "zh timeline label is plain language");
  assert.ok(i18n.includes("任务说明") && i18n.includes("执行过程"), "zh tab labels are plain");
});

test("Hub Task Detail activity labels resume, Candidate capture, and remediation start bilingually", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const labelFn = extractFunctionSource(src, "timelineEventLabel");
  assert.ok(labelFn.includes('"worker.resumed"'), "resume event is labeled");
  assert.ok(labelFn.includes('"candidate.revision.captured"'), "Candidate capture is labeled");
  assert.ok(labelFn.includes('"remediation.check.started"'), "remediation start is labeled");
  assert.ok(labelFn.includes("tlWorkerResumed"));
  assert.ok(labelFn.includes("tlCandidateRevisionCaptured"));
  assert.ok(labelFn.includes("tlRemediationStarted"));
  // Stream fragments are not promoted into the primary label map; server
  // projection excludes them, and an unmapped type still falls to Other.
  assert.ok(!labelFn.includes('"worker.message"'), "worker.message is not a primary activity label");

  const enStart = i18n.indexOf("en: {");
  const zhStart = i18n.indexOf("zh: {");
  assert.ok(enStart >= 0 && zhStart > enStart);
  const enSection = i18n.slice(enStart, zhStart);
  const zhSection = i18n.slice(zhStart);
  for (const key of [
    "tlWorkerResumed",
    "tlCandidateRevisionCaptured",
    "tlRemediationStarted",
    "tlRemediation",
    "tlOther",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  assert.match(enSection, /tlWorkerResumed:\s*"Worker resumed"/);
  assert.match(enSection, /tlCandidateRevisionCaptured:\s*"Candidate version saved"/);
  assert.match(enSection, /tlRemediationStarted:\s*"Main repair verification started"/);
  assert.match(zhSection, /tlWorkerResumed:\s*"Worker 已恢复"/);
  assert.match(zhSection, /tlCandidateRevisionCaptured:\s*"已保存候选版本"/);
  assert.match(zhSection, /tlRemediationStarted:\s*"开始 Main 修复核验"/);
  assert.ok(!enSection.includes("Candidate revision captured"),
    "user-facing EN copy must not use internal revision/captured wording");
  assert.ok(!zhSection.includes("已捕获 Candidate 修订"),
    "user-facing ZH copy must not use internal revision/captured wording");

  // Executable map behavior: known milestones get specific labels; unknown stays Other.
  const dict: Record<string, string> = {
    tlWorkerResumed: "Worker resumed",
    tlCandidateRevisionCaptured: "Candidate version saved",
    tlRemediationStarted: "Main repair verification started",
    tlRemediation: "Main repair verification finished",
    tlOther: "Other activity",
  };
  const label = new Function("t", `${labelFn}\nreturn timelineEventLabel;`)(
    (key: string) => dict[key] ?? key,
  ) as (type: string) => string;
  assert.equal(label("worker.resumed"), "Worker resumed");
  assert.equal(label("candidate.revision.captured"), "Candidate version saved");
  assert.equal(label("remediation.check.started"), "Main repair verification started");
  assert.equal(label("remediation.check.completed"), "Main repair verification finished");
  assert.equal(label("worker.message"), "Other activity",
    "fragments are not given a specific activity name even if they reach the UI");
  assert.equal(label("future.lifecycle.event"), "Other activity");

  // Visible process bound remains at most 40 recent rows of the projected timeline.
  const workbench = extractFunctionSource(src, "renderTaskWorkbench");
  assert.ok(
    workbench.includes("task.timeline.slice().reverse().slice(0, 40)")
      || src.includes("task.timeline.slice().reverse().slice(0, 40)"),
    "process tab keeps a 40-row visible bound on the projected timeline",
  );
  assert.ok(src.includes("taskReportTimelineEmpty"), "empty projected activity keeps empty copy");
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
  mainDecision?: string;
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
  assert.deepEqual(
    storyStep(view, "final-result").items,
    task.journey.workerExecution.changedFilePaths,
    "only Main-accepted files appear as accepted final-result files",
  );
  assert.equal(storyStep(view, "cause").causeWhat, "succeeded", "evidence-backed cause");
  assert.equal(storyStep(view, "next").nextLabel, "done", "next action is done");
  assert.equal(view.repairedDelivery, false, "success is not a Main-repaired delivery");
});

test("Hub Task story never labels Main-revise or Main-reject files as accepted", async () => {
  const adapter = await storyAdapter();
  const base = await storyFixture();
  const task: StoryFixture = JSON.parse(JSON.stringify(base));
  task.status = "succeeded";
  const attempt = task.journey.workerExecution.attempts[0];
  assert.ok(attempt, "fixture has an attempt");
  attempt.status = "succeeded";
  attempt.exitCode = 0;
  task.journey.independentVerification = {
    available: true,
    checks: [{ label: "Project compilation", passed: true, exitCode: 0 }],
    conclusion: "passed",
    failedCount: 0,
    totalCount: 1,
  };
  task.journey.finalDelivery = {
    mainReview: { decision: "revise", reason: "Main found a semantic gap." },
  };
  task.journey.cause = {
    what: "succeeded",
    why: "Machine checks passed.",
    failureCategory: "",
  };
  task.journey.nextAction = { label: "revise" };

  const reviseView = adapter(task);
  assert.deepEqual(storyStep(reviseView, "final-result").items, [],
    "Main-revise files are not accepted final-result files");
  assert.equal(storyStep(reviseView, "cause").mainDecision, "revise",
    "cause keeps the Main-revise fact for plain-language explanation");

  task.journey.finalDelivery.mainReview = {
    decision: "reject",
    reason: "Main rejected the result.",
  };
  task.journey.nextAction = { label: "stopped" };
  const rejectView = adapter(task);
  assert.deepEqual(storyStep(rejectView, "final-result").items, [],
    "Main-reject files are not accepted final-result files");
  assert.equal(storyStep(rejectView, "cause").mainDecision, "reject",
    "cause keeps the Main-reject fact for plain-language explanation");
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
  assert.ok(workerBlock.includes("workersCardExecutionIdentity"), "Worker card explains model, runtime, and mode in one line");
  assert.ok(workerBlock.includes("workersCardExecutionBehavior"), "execution facts stay under one behavior disclosure");
  assert.ok(workerBlock.includes("workersCardNoEffectiveProgressLimited"), "Worker card explains no-effective-progress stop");
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
  assert.ok(src.includes("journeyCauseWhyMainRevise"), "Main-revise why");
  assert.ok(src.includes("journeyCauseWhyMainReject"), "Main-reject why");
  const causeResolverSource = extractFunctionSource(src, "resolveCauseWhy");
  const causeResolver = new Function(
    "t",
    `${causeResolverSource}\nreturn resolveCauseWhy;`,
  )((key: string) => key) as (
    what: string,
    why: string,
    category: string,
    mainDecision?: string,
  ) => string;
  assert.equal(
    causeResolver("succeeded", "machine passed", "", "revise"),
    "journeyCauseWhyMainRevise",
    "Main revise overrides generic machine-success explanation",
  );
  assert.equal(
    causeResolver("succeeded", "machine passed", "", "reject"),
    "journeyCauseWhyMainReject",
    "Main reject overrides generic machine-success explanation",
  );
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
    "journeyCauseWhyMainRevise", "journeyCauseWhyMainReject",
  ]) {
    assert.ok(i18n.includes(key), `separate what/why key ${key} present`);
  }
  // Chinese what/why translations present
  assert.ok(i18n.includes("任务已完成工作"), "zh succeeded what");
  assert.ok(i18n.includes("Worker 完成，独立检查通过，结果已就绪"), "zh succeeded why");
  assert.ok(i18n.includes("机器检查通过，但 Main 发现了具体问题并要求修改"), "zh Main-revise why");
  assert.ok(i18n.includes("机器检查可能已经通过，但 Main 已拒绝这份结果"), "zh Main-reject why");
  assert.ok(i18n.includes("任务未能成功完成"), "zh failed what");
  assert.ok(i18n.includes("Provider 拒绝了 API 凭证"), "zh auth why");
  assert.ok(
    i18n.includes("Token、预算或账户额度上限使运行中止"),
    "zh budget why distinguishes account quota from Task limits",
  );
  assert.ok(
    i18n.includes("等待额度恢复或切换 Worker"),
    "zh budget next action says wait or switch Worker for account quota",
  );
  assert.ok(
    i18n.includes("不会补满 Provider 账户额度"),
    "zh budget next action does not claim Worker settings refill account quota",
  );
  // English budget recovery must cover both branches without claiming certainty.
  assert.ok(
    i18n.includes("wait for recovery or switch Worker"),
    "en budget why says wait or switch for account quota",
  );
  assert.ok(
    i18n.includes("adjust that Task's limits or scope"),
    "en budget why says adjust Task limits only when applicable",
  );
  assert.ok(
    i18n.includes("Changing Worker settings does not refill a Provider account"),
    "en budget next action refuses refill-via-settings claim",
  );
  assert.ok(
    !i18n.includes("Raise the Worker budget or narrow the task scope, then retry."),
    "en must not keep the old raise-Worker-budget-only next action",
  );
  assert.ok(
    !i18n.includes("调高 Worker 预算或缩小任务范围，再重试。"),
    "zh must not keep the old raise-Worker-budget-only next action",
  );
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

test("Hub failure attribution explains two separate facts and hides controls without a trusted binding", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  assert.ok(src.includes('fa.machineOutcome !== "failed"'), "successful Tasks hide the failure card");
  assert.ok(src.includes("!fa.eligible || !fa.binding"), "recording controls require trusted binding");
  assert.ok(src.includes("failureAttributionMachineFailed"));
  assert.ok(src.includes("failureAttributionAssessmentText"));
  for (const key of [
    "failureAttributionTitle",
    "failureAttributionMachineFailed",
    "failureAttributionCounts",
    "failureAttributionExcluded",
    "failureAttributionUncertain",
  ]) {
    assert.ok(enSection.includes(key), `English attribution copy contains ${key}`);
    assert.ok(zhSection.includes(key), `Chinese attribution copy contains ${key}`);
  }
  assert.ok(!enSection.includes("Boundary Reduction (measured Worker Tokens"));
  assert.ok(!zhSection.includes("Boundary Reduction (measured Worker Tokens"));
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

  // Top-level operate/configure pages bind the shared renderer (not keys alone).
  // Overview intentionally drops the page-story block in favor of operations-first layout.
  const pageBindings: Array<{ page: string; renderer: string; denseMarker: string; hasPageStory: boolean }> = [
    { page: "overview", renderer: "rOverview", denseMarker: "renderCompactReadiness", hasPageStory: false },
    { page: "work", renderer: "rWork", denseMarker: "work-board", hasPageStory: true },
    { page: "board", renderer: "rTasks", denseMarker: "taskSubmitTitle", hasPageStory: true },
    { page: "plans", renderer: "rPlans", denseMarker: "noPlans", hasPageStory: true },
    { page: "goals", renderer: "rGoals", denseMarker: "noGoals", hasPageStory: true },
    { page: "compete", renderer: "rCompetitions", denseMarker: "noCompetitions", hasPageStory: true },
    { page: "insights", renderer: "rStats", denseMarker: "econEvidenceSectionTitle", hasPageStory: true },
    { page: "models", renderer: "rModel", denseMarker: "modelCatalog", hasPageStory: true },
    { page: "workers", renderer: "rWorker", denseMarker: "workerProfiles", hasPageStory: true },
    { page: "main", renderer: "rMains", denseMarker: "mains", hasPageStory: true },
  ];
  for (const { page, renderer, denseMarker, hasPageStory } of pageBindings) {
    const fnIdx = src.indexOf(`function ${renderer}()`);
    assert.ok(fnIdx > 0, `${renderer} present`);
    const nextFn = src.indexOf("\nfunction ", fnIdx + 1);
    const block = src.slice(fnIdx, nextFn > 0 ? nextFn : src.length);
    const storyCall = `renderPageStory("${page}")`;
    if (hasPageStory) {
      assert.ok(block.includes(storyCall), `${renderer} calls ${storyCall}`);
      const storyAt = block.indexOf(storyCall);
      const denseAt = block.indexOf(denseMarker);
      assert.ok(denseAt > 0, `${renderer} still renders dense content (${denseMarker})`);
      assert.ok(storyAt < denseAt, `${renderer} places page story before dense content`);
    } else {
      assert.ok(!block.includes(storyCall), `Overview intentionally drops page-story block`);
      assert.ok(block.includes(denseMarker), `Overview renders compact readiness instead`);
      assert.ok(block.includes("ov-live-strip"), "Overview leads with live state strip");
    }
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
  const pages = ["Overview", "Work", "Board", "Plans", "Goals", "Compete", "Insights", "Models", "Workers", "Main"];
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
    "planLaneCompleted", "planItemNotStarted",
    "planItemPositionReady", "planItemPositionWaitingFor",
    "planItemPositionBlockedByFailed", "planItemUnlocks",
  ];
  // Obsolete primary-copy key replaced by human-readable named-dependency
  // presentation. Keep the key in i18n as a migration fallback, but the
  // primary renderer no longer calls it.
  assert.ok(i18n.includes("planItemDepsStates"), "legacy key survives in i18n");
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

test("Hub model routing candidate selection is Profile-only and identity-preserving", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  assert.doesNotThrow(() => new Function(src), "Hub app.js must parse before routing assertions");

  const renderStart = src.indexOf("function renderModelRoutingSection");
  const renderEnd = src.indexOf("function renderMrResult", renderStart);
  const routingBlock = src.slice(renderStart, renderEnd > 0 ? renderEnd : src.length);

  // Candidate options are built from saved Worker Profiles only and keyed by Profile id.
  assert.ok(routingBlock.includes("saved Worker Profiles only"), "profile-only candidate construction");
  assert.match(routingBlock, /candOptions\.push\(\{\s*key:\s*p\.id\b/, "candidate key is the Profile id");
  assert.ok(!routingBlock.includes("From catalog models not already covered"),
    "no catalog-only candidate loop remains");
  assert.equal(
    (routingBlock.match(/candOptions\.push\(/g) || []).length,
    1,
    "exactly one candidate source (saved Worker Profiles)",
  );

  // Result rendering preserves worker identity.
  assert.ok(src.includes('t("mrCandidateWorker"'), "profile candidate name uses worker label");
  assert.ok(src.includes('t("mrRecommendationProfile"'), "profile recommendation uses worker label");
  assert.ok(src.includes('t("mrWorkerProfileId"'), "worker profile id is shown");
  assert.ok(src.includes('t("mrComparedWorkers"'), "explanation names the compared Workers");

  // Evaluate sends saved Profile ids, never provider/model candidates.
  assert.ok(src.includes("workerProfileIds: deduped"), "evaluate sends workerProfileIds");

  // Bilingual keys.
  for (const key of [
    "mrComparedWorkers", "mrRecommendationProfile", "mrWorkerProfileId", "mrCandidateWorker",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }

  // Chinese copy is a real translation, not an English fallback.
  assert.ok(zhSection.includes("比较的 Worker"), "zh compared-workers copy");
  assert.ok(zhSection.includes("ForkLight 推荐 Worker"), "zh profile recommendation copy");
});

test("Hub model routing explains asymmetric sample coverage without claiming history is empty", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18nSrc = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18nSrc);

  // Renderer binds coverage projection and readiness helpers
  assert.ok(src.includes("c.sampleCoverage"), "candidate cards read sampleCoverage");
  assert.ok(src.includes('t("mrCandidateExactCoverage"'), "exact-type coverage line");
  assert.ok(src.includes('t("mrCandidateFamilyCoverage"'), "broader-category coverage line");
  assert.ok(src.includes("function mrCoverageNeedsMoreEvidence"), "coverage-aware next-action helper");
  assert.ok(src.includes("function buildMrReasons"), "reasons builder present");
  assert.ok(src.includes("buildMrReasons(cands, policy, result)"), "reasons receive full result for scope");
  assert.ok(src.includes('t("mrIncompleteFamilyComparison"'), "incomplete family readiness copy");
  assert.ok(src.includes('t("mrNoExactHistory"'), "no exact history copy");
  assert.ok(src.includes("result.taskFamily"), "family line gated on supplied family");

  // Next-action uses coverage, not only c.evidence sparse exact rows
  const nextIdx = src.indexOf("/* --- Next action --- */");
  assert.ok(nextIdx > 0, "next action section");
  const nextBlock = src.slice(nextIdx, nextIdx + 600);
  assert.ok(nextBlock.includes("mrCoverageNeedsMoreEvidence(cands, policy)"),
    "next action consults coverage helper");
  assert.ok(!/cands\.some\(function\(c\)\{\s*return \(c\.evidence && c\.evidence\.relevantSampleCount/.test(nextBlock),
    "next action no longer keys only on c.evidence sample count");

  // Bilingual coverage keys
  for (const key of [
    "mrCandidateExactCoverage", "mrCandidateFamilyCoverage",
    "mrIncompleteFamilyComparison", "mrNoExactHistory", "mrNoFamilyHistory",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }

  // English: current/required wording, not model quality or auto-Competition
  assert.ok(enSection.includes("Exact task type: {current}/{required} usable records"));
  assert.ok(enSection.includes("Broader category: {current}/{required} usable records"));
  assert.ok(enSection.includes("Related history exists in this broader category"));
  assert.ok(enSection.includes("compared fairly"));
  assert.ok(enSection.includes("Sample counts are not model quality"));
  assert.ok(!/mrIncompleteFamilyComparison['"]?\s*:\s*"[^"]*should compete/i.test(enSection));
  assert.ok(!/mrCandidateExactCoverage['"]?\s*:\s*"[^"]*quality/i.test(enSection));

  // Chinese: real translation for asymmetric gap, not English fallback
  assert.ok(zhSection.includes("精确任务类型：{current}/{required} 条可用记录"));
  assert.ok(zhSection.includes("更广泛大类：{current}/{required} 条可用记录"));
  assert.ok(zhSection.includes("这个大类已有相关历史"));
  assert.ok(zhSection.includes("公平比较"));
  assert.ok(zhSection.includes("样本数量不是模型质量"));
  assert.ok(zhSection.includes("此工作类型还没有精确任务类型的历史记录"));
  assert.ok(zhSection.includes("尚不足以做公平比较的历史记录"));

  // Executable bilingual reason helper for incomplete family vs no history
  const wrapped = i18nSrc.replace(
    /\(typeof window !== "undefined" \? window : globalThis\)/,
    "(sandbox)",
  );
  const sandbox: {
    ForklightI18n?: {
      t: (key: string, vars?: Record<string, string>) => string;
      setLang: (lang: string) => void;
    };
    localStorage?: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
    navigator?: { language: string };
    document?: { documentElement: { lang: string; setAttribute: () => void } };
  } = {
    localStorage: { getItem: () => null, setItem: () => undefined },
    navigator: { language: "en" },
    document: { documentElement: { lang: "en", setAttribute: () => undefined } },
  };
  new Function("sandbox", wrapped)(sandbox);
  const i18n = sandbox.ForklightI18n;
  assert.ok(i18n, "ForklightI18n loads for sample-coverage checks");

  const helpers = [
    extractFunctionSource(src, "mrCoverageNeedsMoreEvidence"),
    extractFunctionSource(src, "buildMrReasons"),
  ].join("\n");
  const api = new Function(
    "t",
    `${helpers}\nreturn { buildMrReasons: buildMrReasons, mrCoverageNeedsMoreEvidence: mrCoverageNeedsMoreEvidence };`,
  )((key: string, vars?: Record<string, string>) => i18n!.t(key, vars)) as {
    buildMrReasons: (
      cands: Array<Record<string, unknown>>,
      policy: Record<string, unknown>,
      result?: Record<string, unknown>,
    ) => string[];
    mrCoverageNeedsMoreEvidence: (
      cands: Array<Record<string, unknown>>,
      policy: Record<string, unknown>,
    ) => boolean;
  };

  const asymmetricCands = [
    {
      provider: "xai",
      model: "grok-4.5",
      sampleCoverage: {
        exactTerminalCount: 0, exactRelevantCount: 0, exactMinRelevantSamples: 5,
        familyTerminalCount: 15, familyRelevantCount: 13, familyMinRelevantSamples: 5,
      },
      evidence: { relevantSampleCount: 0 },
      uncertainty: { insufficientSamples: true, insufficientGap: false, reasons: ["insufficient-relevant-samples"] },
    },
    {
      provider: "minimax",
      model: "m2",
      sampleCoverage: {
        exactTerminalCount: 0, exactRelevantCount: 0, exactMinRelevantSamples: 5,
        familyTerminalCount: 3, familyRelevantCount: 2, familyMinRelevantSamples: 5,
      },
      evidence: { relevantSampleCount: 0 },
      uncertainty: { insufficientSamples: true, insufficientGap: false, reasons: ["insufficient-relevant-samples"] },
    },
  ];
  const policy = { minRelevantSamples: 5, familyMinRelevantSamples: 5, uncertaintyThreshold: 0.15 };

  i18n!.setLang("en");
  const enReasons = api.buildMrReasons(asymmetricCands, policy, {
    evidenceScope: "none",
    taskFamily: "bounded-javascript-change",
  });
  assert.ok(enReasons.some((r) => /Related history exists/i.test(r)),
    "English incomplete family explains related history exists");
  assert.ok(enReasons.some((r) => /at least 5 usable records/i.test(r)),
    "English incomplete family shows the required minimum");
  assert.ok(!enReasons.some((r) => /no exact task type history/i.test(r)),
    "English incomplete family must not pretend history is empty");
  assert.ok(!enReasons.some((r) => /should compete|run a competition/i.test(r)),
    "English incomplete family must not push Competition");
  assert.equal(api.mrCoverageNeedsMoreEvidence(asymmetricCands, policy), true);

  i18n!.setLang("zh");
  const zhReasons = api.buildMrReasons(asymmetricCands, policy, {
    evidenceScope: "none",
    taskFamily: "bounded-javascript-change",
  });
  assert.ok(zhReasons.some((r) => r.includes("已有相关历史")),
    "Chinese incomplete family explains related history exists");
  assert.ok(zhReasons.some((r) => r.includes("至少 5 条可用记录")),
    "Chinese incomplete family shows the required minimum");
  assert.ok(!zhReasons.some((r) => r.includes("还没有精确任务类型的历史记录")),
    "Chinese incomplete family must not claim exact/family history is empty");
  assert.ok(!zhReasons.some((r) => /Competition|compete/i.test(r) && !r.includes("不会单独启动")),
    "Chinese incomplete family must not recommend Competition as the fix");

  // No family + zero exact samples → no broader-category line and honest empty history
  const noFamilyCands = [
    {
      provider: "a", model: "1",
      sampleCoverage: { exactTerminalCount: 0, exactRelevantCount: 0, exactMinRelevantSamples: 5 },
      evidence: { relevantSampleCount: 0 },
      uncertainty: { insufficientSamples: true, insufficientGap: false, reasons: ["insufficient-relevant-samples"] },
    },
    {
      provider: "b", model: "2",
      sampleCoverage: { exactTerminalCount: 0, exactRelevantCount: 0, exactMinRelevantSamples: 5 },
      evidence: { relevantSampleCount: 0 },
      uncertainty: { insufficientSamples: true, insufficientGap: false, reasons: ["insufficient-relevant-samples"] },
    },
  ];
  i18n!.setLang("en");
  const enEmpty = api.buildMrReasons(noFamilyCands, policy, { evidenceScope: "none" });
  assert.ok(enEmpty.some((r) => /no exact task type history/i.test(r)));
  assert.ok(!enEmpty.some((r) => /Related history exists|broader category/i.test(r)),
    "no family must not invent broader-category readiness text");

  i18n!.setLang("zh");
  const zhEmpty = api.buildMrReasons(noFamilyCands, policy, { evidenceScope: "none" });
  assert.ok(zhEmpty.some((r) => r.includes("还没有精确任务类型的历史记录")));
  assert.ok(!zhEmpty.some((r) => r.includes("已有相关历史")),
    "Chinese no-family path must not invent related family history");

  // Family evidence can be ready even when exact-type history is sparse. If
  // the family scores are tied, the explanation must describe the close result
  // rather than incorrectly falling back to the sparse exact-type counts.
  const familyReadyButTied = asymmetricCands.map((candidate) => ({
    ...candidate,
    sampleCoverage: {
      ...(candidate.sampleCoverage as Record<string, number>),
      familyRelevantCount: 8,
      familyTerminalCount: 8,
    },
    evidence: { relevantSampleCount: 8 },
    uncertainty: {
      insufficientSamples: false,
      insufficientGap: true,
      reasons: ["score-gap-too-small"],
    },
  }));
  i18n!.setLang("en");
  const familyTieReasons = api.buildMrReasons(familyReadyButTied, policy, {
    evidenceScope: "task-family",
    taskFamily: "bounded-javascript-change",
  });
  assert.ok(familyTieReasons.some((r) => /score gap/i.test(r)),
    "ready family tie explains the close comparison");
  assert.ok(!familyTieReasons.some((r) => /Insufficient evidence/i.test(r)),
    "ready family tie must not report sparse exact-type counts as insufficient");

  // `no-active-factors` means no factor can participate in this evaluation;
  // it does not by itself prove that the user set every weight to zero. When
  // sample coverage is already the blocker, keep the explanation focused on
  // that primary cause instead of adding a false settings diagnosis.
  const insufficientAndNoActive = noFamilyCands.map((candidate) => ({
    ...candidate,
    uncertainty: {
      insufficientSamples: true,
      insufficientGap: false,
      reasons: ["insufficient-relevant-samples", "no-active-factors"],
    },
  }));
  const enabledWeights = {
    acceptedDelivery: 1, verifiedBehavior: 1, modelQualityFailure: 0.5,
    correctionChurn: 0.2, firstPassSuccess: 0.5,
    officialCost: 0, duration: 0, budgetReliability: 0,
  };
  i18n!.setLang("en");
  const sparseReasons = api.buildMrReasons(insufficientAndNoActive, {
    ...policy, weights: enabledWeights,
  }, { evidenceScope: "none" });
  assert.ok(!sparseReasons.some((r) => /preferences are turned off|enabled preferences do not/i.test(r)),
    "sample shortage must not be mislabeled as disabled weights or a second factor failure");

  const readyNoActive = noFamilyCands.map((candidate) => ({
    ...candidate,
    sampleCoverage: {
      exactTerminalCount: 8, exactRelevantCount: 8, exactMinRelevantSamples: 5,
    },
    evidence: { relevantSampleCount: 8 },
    uncertainty: {
      insufficientSamples: false,
      insufficientGap: false,
      reasons: ["no-active-factors"],
    },
  }));
  const allWeightsOff = Object.fromEntries(Object.keys(enabledWeights).map((key) => [key, 0]));
  const disabledReasons = api.buildMrReasons(readyNoActive, {
    ...policy, weights: allWeightsOff,
  }, { evidenceScope: "exact-class" });
  assert.ok(disabledReasons.some((r) => /All comparison preferences are turned off/i.test(r)),
    "actual zero weights receive the settings-specific explanation");

  const unavailableReasons = api.buildMrReasons(readyNoActive, {
    ...policy, weights: enabledWeights,
  }, { evidenceScope: "exact-class" });
  assert.ok(unavailableReasons.some((r) => /enabled preferences do not currently have usable evidence/i.test(r)),
    "enabled-but-unavailable evidence must not be described as zero weights");

  i18n!.setLang("zh");
  const zhSparseReasons = api.buildMrReasons(insufficientAndNoActive, {
    ...policy, weights: enabledWeights,
  }, { evidenceScope: "none" });
  assert.ok(!zhSparseReasons.some((r) => /比较偏好都已关闭|已启用的偏好目前没有/.test(r)),
    "中文样本不足路径也只解释主因");
  const zhDisabledReasons = api.buildMrReasons(readyNoActive, {
    ...policy, weights: allWeightsOff,
  }, { evidenceScope: "exact-class" });
  assert.ok(zhDisabledReasons.some((r) => r.includes("所有比较偏好都已关闭")),
    "中文零权重路径给出准确设置解释");

  // Privacy: coverage keys must not mention Task ids, paths, prompts, or logs
  for (const section of [enSection, zhSection]) {
    const blockStart = section.indexOf("mrCandidateExactCoverage");
    const block = section.slice(blockStart, blockStart + 800);
    assert.ok(!/taskId|sourcePath|rawLog|apiKey|endpoint|prompt/i.test(block),
      "coverage copy stays privacy-safe");
  }
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

test("Hub model routing first-pass success has bilingual evidence separate from delivery", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  assert.ok(src.includes('["firstPassSuccess", "mrPolicyFirstPassSuccess"'),
    "firstPassSuccess is part of the editable weight key list");
  assert.ok(src.includes("mr-first-pass-evidence"),
    "candidate cards render a first-pass evidence block");
  assert.ok(src.includes("firstPassVerifiedSampleCount"),
    "renders first-pass sample count");
  assert.ok(src.includes("mrFirstPassFact"),
    "renders first-pass passed/sample/rate fact");
  assert.ok(src.includes("mrFirstPassExcluded"),
    "renders excluded non-comparable count");
  assert.ok(src.includes("mrFirstPassNotFinalQuality"),
    "keeps first-pass separate from final quality");
  assert.ok(src.includes("function mrWeightDefault"),
    "missing draft weights use canonical defaults including firstPassSuccess");
  for (const key of [
    "mrPolicyFirstPassSuccess", "mrPolicyFirstPassSuccessHint",
    "mrFirstPassSummary", "mrFirstPassFact", "mrFirstPassNoComparable",
    "mrFirstPassExcluded", "mrFirstPassNotFinalQuality",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  assert.ok(enSection.includes("first Attempt"), "en mentions first Attempt");
  assert.ok(enSection.includes("not the same as eventual accepted delivery"),
    "en separates first-pass from eventual delivery");
  assert.ok(zhSection.includes("第一次独立验收通过"), "zh policy label");
  assert.ok(zhSection.includes("最终被接受的交付"), "zh separates eventual delivery");
  assert.ok(zhSection.includes("不会禁用模型"), "zh soft-only eligibility");
  // Privacy: first-pass copy must not leak Task-level private evidence.
  for (const section of [enSection, zhSection]) {
    const blockStart = section.indexOf("mrFirstPassSummary");
    const block = section.slice(blockStart, blockStart + 1200);
    assert.ok(!/taskId|sourcePath|rawLog|apiKey|endpoint|prompt/i.test(block),
      "first-pass copy stays privacy-safe");
  }
});

test("Hub model routing accepted delivery shows Main-backed counts not machine success", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  assert.ok(src.includes("mr-accepted-delivery-evidence"),
    "candidate cards render an accepted-delivery evidence block");
  assert.ok(src.includes("acceptedDeliverySampleCount"),
    "renders comparable final-delivery sample count");
  assert.ok(src.includes("acceptedDeliveryUnavailableCount"),
    "renders unavailable final-delivery count");
  assert.ok(src.includes("mrAcceptedDeliveryFact"),
    "renders accepted-of-comparable fact");
  assert.ok(src.includes("mrAcceptedDeliveryUnavailable"),
    "renders not-yet-knowable count");
  assert.ok(src.includes("mrAcceptedDeliveryNotMachine"),
    "states machine success is not final delivery");
  for (const key of [
    "mrAcceptedDeliverySummary", "mrAcceptedDeliveryFact",
    "mrAcceptedDeliveryNoComparable", "mrAcceptedDeliveryUnavailable",
    "mrAcceptedDeliveryNotMachine",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  assert.ok(enSection.includes("Machine success without Main accept"),
    "en separates machine success from accepted delivery");
  assert.ok(zhSection.includes("仅有机器通过"),
    "zh separates machine success from accepted delivery");
  for (const section of [enSection, zhSection]) {
    const blockStart = section.indexOf("mrAcceptedDeliverySummary");
    const block = section.slice(blockStart, blockStart + 1500);
    assert.ok(!/taskId|sourcePath|rawLog|apiKey|endpoint|prompt/i.test(block),
      "accepted-delivery copy stays privacy-safe");
  }
});

test("Hub model routing evidence-ready subset renders bilingual coverage facts and keeps excluded Workers eligible", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  // Core rendering: cohort participation filtering and badges.
  assert.ok(src.includes(".cohortParticipation === \"compared\""),
    "filters compared Workers by cohort participation");
  assert.ok(src.includes("mrCandidateExcludedFromComparison"),
    "renders excluded-from-comparison badge");
  assert.ok(src.includes("mr-subset-warning"),
    "renders subset warning styling");

  // Canonical coverage facts consumed in the result section.
  assert.ok(src.includes(".allCandidatesCompared"),
    "reads allCandidatesCompared from response");
  assert.ok(src.includes(".totalCandidateCount"),
    "reads totalCandidateCount from response");
  assert.ok(src.includes(".excludedCandidateCount"),
    "reads the canonical not-compared count from response");
  assert.ok(src.includes("rec.coverage"),
    "reads the canonical recommendation boundary from the recommendation");
  assert.ok(src.includes("comparisonEvidence"),
    "reads comparisonEvidence for active-scope counts");

  // Bilingual i18n for cohort coverage and excluded candidates.
  for (const key of [
    "mrAllCandidatesCompared", "mrEvidenceReadySubset",
    "mrCandidateExcludedFromComparison", "mrRecommendationSubsetOnly",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }

  // Missing history is explained as a temporary evidence gap, while the
  // Worker remains selectable. The copy does not assign a quality outcome.
  const enCandidateCopy = enSection.match(
    /mrCandidateExcludedFromComparison:\s*"([^"]+)"/,
  )?.[1] ?? "";
  const zhCandidateCopy = zhSection.match(
    /mrCandidateExcludedFromComparison:\s*"([^"]+)"/,
  )?.[1] ?? "";
  assert.match(enCandidateCopy, /needs more comparable history/i);
  assert.match(enCandidateCopy, /remains available/i);
  assert.doesNotMatch(enCandidateCopy, /permanently|is worse|has failed/i);
  assert.match(zhCandidateCopy, /需要更多可比历史/);
  assert.match(zhCandidateCopy, /仍然可选/);
  assert.doesNotMatch(zhCandidateCopy, /永久|更差|已经失败/);

  // No em dash was introduced by the evidence-ready-subset work.
  for (const key of [
    "mrAllCandidatesCompared", "mrEvidenceReadySubset",
    "mrCandidateExcludedFromComparison", "mrRecommendationSubsetOnly",
  ]) {
    const startIdx = src.indexOf(key);
    if (startIdx < 0) continue;
    // Search the surrounding renderable region for an em dash.
    const region = src.slice(Math.max(0, startIdx - 200), startIdx + 800);
    // Exclude the i18n definitions themselves; only check app.js comments.
    // The app.js comment for the participation tag must not contain an em dash.
    assert.ok(!/cohort.*tag.*—/.test(region),
      `no em dash in app.js near ${key}`);
  }
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

  // Calibration and actions live in the Actions tab; dense evidence in More.
  assert.ok(src.includes("function renderCalibrationCard"), "calibration card renderer");
  assert.ok(src.includes("function renderTaskWorkbench"), "open workbench is the primary report");
  assert.ok(src.includes("manualActionsBody.appendChild(renderCalibrationCard(task))"),
    "showTask mounts the calibration card inside Actions tab content");
  assert.ok(src.includes('id: "actions"'), "actions tab is registered");
  assert.ok(src.includes('id: "more"'), "more tab is registered");
  const workbenchIdx = src.indexOf("shell.appendChild(renderTaskWorkbench(task");
  const calIdx = src.indexOf("manualActionsBody.appendChild(renderCalibrationCard(task))");
  const journeyIdx = src.indexOf("var journeyEvidence = renderTaskJourney(task);");
  const techIdx = src.indexOf('collapsedSection(t("journeyTechnical")');
  assert.ok(
    workbenchIdx > 0
      && calIdx > 0
      && journeyIdx > calIdx
      && techIdx > journeyIdx
      && workbenchIdx > techIdx,
    "actions/more content is assembled before the tabbed workbench is mounted",
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

  // Task detail Actions tab carries delivery plan + Integration controls.
  const showIdx = src.indexOf("function showTask(");
  const showBlock = src.slice(showIdx);
  assert.ok(showBlock.includes("renderTaskDeliveryPlan(task)"),
    "showTask renders the four-stage plan in the Actions tab");
  assert.ok(showBlock.includes("taskPreflight"),
    "Integration preflight remains available in Actions");
  assert.ok(showBlock.includes('id: "actions"'),
    "Actions tab hosts delivery and integration work");
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

  // The card is mounted in rOverview as a compact row, in secondary content.
  const ovStart = src.indexOf("function rOverview()");
  assert.ok(ovStart > 0, "rOverview present");
  const ovEnd = src.indexOf("\nfunction ", ovStart + 1);
  const ovBlock = src.slice(ovStart, ovEnd > 0 ? ovEnd : src.length);
  assert.ok(!ovBlock.includes('renderPageStory("overview")'), "Overview drops page story");
  assert.ok(ovBlock.includes("renderCompactVersionRow"), "version renders as compact row");
  assert.ok(ovBlock.includes("renderCompactReadiness"), "readiness renders as compact row");
  assert.ok(ovBlock.indexOf("ov-live-strip") < ovBlock.indexOf("renderCompactReadiness"),
    "live state strip leads before compact readiness");

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

/* --- Task headline projection: the prominent badge follows the latest
 * Main/delivery outcome instead of the raw machine status, so a
 * machine-successful Candidate that Main asked to revise can never be
 * presented as accepted or delivered. The pure helper is extracted and
 * exercised against representative decision/delivery stages. */
type TaskHeadline = {
  labelKey: string;
  tone: string;
  delivered: boolean;
};

test("Hub Task headline projection follows Main/delivery outcome before machine status", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const finalDeliverySource = extractFunctionSource(src, "hasVerifiedFinalDelivery");
  const headlineSource = extractFunctionSource(src, "taskHeadline");
  const headline = new Function(
    `${finalDeliverySource}\n${headlineSource}\nreturn taskHeadline;`,
  )() as (task: Record<string, unknown>) => TaskHeadline;

  // Machine passed but Main requested revision: never accepted or delivered.
  const revision = headline({ status: "succeeded", decisionStage: "revision-requested" });
  assert.equal(revision.labelKey, "taskHeadlineRevisionRequested");
  assert.equal(revision.delivered, false);
  assert.notEqual(revision.labelKey, "taskHeadlineVerifiedDelivery");

  // Machine passed but Main rejected: never accepted.
  const rejected = headline({ status: "succeeded", decisionStage: "main-rejected" });
  assert.equal(rejected.labelKey, "taskHeadlineRejected");
  assert.equal(rejected.delivered, false);
  assert.notEqual(rejected.labelKey, "taskHeadlineVerifiedDelivery");

  // Awaiting Main review: not delivered.
  const awaiting = headline({ status: "succeeded", decisionStage: "awaiting-main-review" });
  assert.equal(awaiting.labelKey, "taskHeadlineAwaitingReview");
  assert.equal(awaiting.delivered, false);

  // Accepted but not integrated: not delivered.
  const ready = headline({ status: "succeeded", decisionStage: "ready-for-integration" });
  assert.equal(ready.labelKey, "taskHeadlineReadyIntegration");
  assert.equal(ready.delivered, false);

  // Activated decision stage: verified final delivery.
  const activated = headline({ status: "succeeded", decisionStage: "activated" });
  assert.equal(activated.labelKey, "taskHeadlineVerifiedDelivery");
  assert.equal(activated.delivered, true);
  assert.equal(activated.tone, "badge-ok");

  // Source-only delivery is complete, but must not claim runtime activation.
  const delivered = headline({ status: "succeeded", decisionStage: "delivered" });
  assert.equal(delivered.labelKey, "taskHeadlineDeliveredNoActivation");
  assert.equal(delivered.delivered, true);
  assert.equal(delivered.tone, "badge-ok");
  assert.notEqual(delivered.labelKey, "taskHeadlineVerifiedDelivery");

  // Compact verified-repaired-delivery evidence: verified final delivery.
  const repaired = headline({
    status: "failed",
    remediationDisposition: { status: "verified-repaired-delivered" },
  });
  assert.equal(repaired.labelKey, "taskHeadlineVerifiedDelivery");
  assert.equal(repaired.delivered, true);

  // Remaining Main/delivery stages get their bounded headline label.
  assert.equal(
    headline({ status: "succeeded", decisionStage: "integrating" }).labelKey,
    "taskHeadlineIntegrating",
  );
  assert.equal(
    headline({ status: "succeeded", decisionStage: "applied-not-activated" }).labelKey,
    "taskHeadlineAppliedNotActivated",
  );
  assert.equal(
    headline({ status: "succeeded", decisionStage: "integration-failed" }).labelKey,
    "taskHeadlineIntegrationFailed",
  );

  // Legacy machine-only success: a machine-check label, never final acceptance.
  const legacy = headline({ status: "succeeded" });
  assert.equal(legacy.labelKey, "taskHeadlineMachinePassed");
  assert.equal(legacy.delivered, false);
  assert.notEqual(legacy.labelKey, "taskHeadlineVerifiedDelivery");
  assert.notEqual(legacy.labelKey, "statusSucceeded");

  // Machine failure without delivery evidence falls back to machine status.
  assert.equal(headline({ status: "failed" }).labelKey, "statusFailed");
});

test("Hub Task headline labels are bilingual and never confuse machine success with acceptance", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  const headlineKeys = [
    "taskHeadlineAwaitingReview",
    "taskHeadlineRevisionRequested",
    "taskHeadlineRejected",
    "taskHeadlineReadyIntegration",
    "taskHeadlineIntegrating",
    "taskHeadlineAppliedNotActivated",
    "taskHeadlineDeliveredNoActivation",
    "taskHeadlineVerifiedDelivery",
    "taskHeadlineIntegrationFailed",
    "taskHeadlineMachinePassed",
  ];
  for (const key of headlineKeys) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  function labelOf(section: string, key: string): string {
    const m = new RegExp(`${key}['"]?\\s*:\\s*"([^"]+)"`).exec(section);
    return m?.[1] ?? "";
  }
  // Runtime-activated delivery and source-only delivery use distinct claims.
  assert.match(labelOf(enSection, "taskHeadlineVerifiedDelivery"), /deliver/i);
  assert.ok(labelOf(zhSection, "taskHeadlineVerifiedDelivery").includes("交付"));
  assert.equal(labelOf(enSection, "taskHeadlineDeliveredNoActivation"), "Delivered");
  assert.equal(labelOf(zhSection, "taskHeadlineDeliveredNoActivation"), "已交付");
  assert.match(labelOf(enSection, "taskProgressDeliveredNoActivation"), /did not require runtime activation/i);
  assert.ok(labelOf(zhSection, "taskProgressDeliveredNoActivation").includes("不需要运行时生效步骤"));
  // Legacy machine-only success is a machine-check label, never final acceptance.
  assert.equal(labelOf(enSection, "taskHeadlineMachinePassed"), "Checks passed");
  assert.equal(labelOf(zhSection, "taskHeadlineMachinePassed"), "检查已通过");
  // Machine success awaiting Main, revision, rejection, or integration never
  // claims delivery or acceptance in either locale.
  const nonAcceptanceKeys = [
    "taskHeadlineAwaitingReview",
    "taskHeadlineRevisionRequested",
    "taskHeadlineRejected",
    "taskHeadlineReadyIntegration",
    "taskHeadlineIntegrating",
    "taskHeadlineAppliedNotActivated",
    "taskHeadlineIntegrationFailed",
    "taskHeadlineMachinePassed",
  ];
  for (const key of nonAcceptanceKeys) {
    assert.ok(
      !/deliver|accept|verified/i.test(labelOf(enSection, key)),
      `en ${key} is not an acceptance or delivery claim`,
    );
    const zh = labelOf(zhSection, key);
    assert.ok(
      !zh.includes("交付") && !zh.includes("验收"),
      `zh ${key} is not an acceptance or delivery claim`,
    );
  }
});

test("Hub generic machine-success label is checks passed, never acceptance or delivery", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  function labelOf(section: string, key: string): string {
    const m = new RegExp(`${key}['"]?\\s*:\\s*"([^"]+)"`).exec(section);
    return m?.[1] ?? "";
  }
  // Exact checks-passed copy in both locales.
  assert.equal(labelOf(enSection, "statusSucceeded"), "Checks passed");
  assert.equal(labelOf(zhSection, "statusSucceeded"), "检查已通过");
  // Forbidden acceptance/delivery wording in the generic machine-success label.
  const enSucceeded = labelOf(enSection, "statusSucceeded");
  assert.ok(!/accept(?:ed|ance)?|deliver(?:ed|y)?|verif(?:ied|y)/i.test(enSucceeded),
    "en statusSucceeded contains no acceptance or delivery claim");
  const zhSucceeded = labelOf(zhSection, "statusSucceeded");
  assert.ok(!zhSucceeded.includes("验收"), "zh statusSucceeded contains no 验收");
  assert.ok(!zhSucceeded.includes("接受"), "zh statusSucceeded contains no 接受");
  assert.ok(!zhSucceeded.includes("交付"), "zh statusSucceeded contains no 交付");
  // The generic machine-success label is distinct from verified-final-delivery copy.
  const enDelivery = labelOf(enSection, "taskHeadlineVerifiedDelivery");
  assert.notEqual(labelOf(enSection, "statusSucceeded"), enDelivery,
    "generic machine success must remain distinct from verified delivery in en");
  const zhDelivery = labelOf(zhSection, "taskHeadlineVerifiedDelivery");
  assert.notEqual(labelOf(zhSection, "statusSucceeded"), zhDelivery,
    "generic machine success must remain distinct from verified delivery in zh");
});

test("Hub Task card and detail hero lead with the headline badge and avoid duplicate delivery", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("function taskHeadline("), "headline projection helper present");
  assert.ok(src.includes("function taskHeadlineBadge("), "headline badge renderer present");
  assert.ok(
    src.includes('setAttribute("data-fl-role", "task-headline")'),
    "headline badge has a stable marker",
  );

  // kanbanCard prominent badge uses the headline projection, not raw status.
  const cardIdx = src.indexOf("function kanbanCard(");
  assert.ok(cardIdx > 0);
  const cardEnd = src.indexOf("function ", cardIdx + 1);
  const cardBlock = src.slice(cardIdx, cardEnd > 0 ? cardEnd : src.length);
  assert.ok(cardBlock.includes("taskHeadlineBadge(task)"),
    "kanban card prominent badge uses the headline projection");
  assert.ok(!cardBlock.includes("badge(task.status)"),
    "kanban card no longer leads with raw machine status");
  assert.ok(cardBlock.includes(".delivered"),
    "kanban card suppresses the duplicate delivery badge when the headline is delivered");
  assert.ok(cardBlock.includes("finalDeliveryBadge"),
    "kanban card still appends the compact delivery badge when the headline is not delivered");

  // Task Detail hero prominent badge uses the headline projection, not raw status.
  const wbIdx = src.indexOf("function renderTaskWorkbench(");
  assert.ok(wbIdx > 0);
  const wbEnd = src.indexOf("function ", wbIdx + 1);
  const wbBlock = src.slice(wbIdx, wbEnd > 0 ? wbEnd : src.length);
  assert.ok(wbBlock.includes("taskHeadlineBadge(task)"),
    "detail hero prominent badge uses the headline projection");
  assert.ok(!wbBlock.includes("badge(task.status)"),
    "detail hero no longer leads with raw machine status");
  assert.ok(wbBlock.includes(".delivered"),
    "detail hero suppresses the duplicate delivery badge when the headline is delivered");
});

test("Hub retained Candidate card consumes only the safe journey projection", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const renderer = extractFunctionSource(src, "renderRetainedCandidate");

  assert.ok(
    renderer.includes('setAttribute("data-fl-role", "retained-candidate")'),
    "retained Candidate card has a stable semantic marker",
  );
  for (const field of [
    "attemptOrdinal",
    "verificationPassed",
    "filesChanged",
    "changedLines",
    "affectedPathCount",
    "affectedPaths",
  ]) {
    assert.ok(renderer.includes(`rc.${field}`), `renderer consumes safe field ${field}`);
  }
  for (const noteKey of [
    "retainedCandidatePendingNote",
    "retainedCandidateReviseNote",
    "retainedCandidateRejectedNote",
    "retainedCandidateAcceptedNote",
    "retainedCandidateRepairedNote",
  ]) {
    assert.ok(renderer.includes(noteKey), `renderer separates ${noteKey}`);
  }
  for (const forbidden of [
    "patchDigest",
    "privateArtifactPath",
    "candidateRevisionId",
    "rawLogPath",
    ".payload",
  ]) {
    assert.ok(!renderer.includes(forbidden), `renderer does not consume private ${forbidden}`);
  }

  const fourSectionFn = extractFunctionSource(src, "renderFourSectionOverview");
  assert.ok(
    !fourSectionFn.includes("renderRetainedCandidate(task)"),
    "Overview story keeps retained Candidate out of the default reading path",
  );
  assert.ok(
    !fourSectionFn.includes("workerClaim") && !fourSectionFn.includes("worker-claim-preview"),
    "Overview story does not surface raw Worker claim text",
  );
  assert.ok(
    !fourSectionFn.includes("task-report-list files") && !fourSectionFn.includes("files.slice"),
    "Overview story uses file counts only, not exact path lists",
  );
  const workbench = extractFunctionSource(src, "renderTaskWorkbench");
  assert.ok(
    workbench.includes("var resultRetained = renderRetainedCandidate(task)"),
    "Result tab still explains the retained Candidate",
  );
  assert.ok(
    workbench.includes("worker-claim-disclosure") || workbench.includes("taskReportClaimDisclosure"),
    "Result tab keeps the original Worker report under an explicit disclosure",
  );
});

test("Hub retained Candidate explanation is bilingual and separates evidence from delivery", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  const keys = [
    "retainedCandidateTitle",
    "retainedCandidateAvailableBody",
    "retainedCandidateMachinePassed",
    "retainedCandidateMachineFailed",
    "retainedCandidatePathsLabel",
    "retainedCandidateUnavailableBody",
    "retainedCandidatePendingNote",
    "retainedCandidateReviseNote",
    "retainedCandidateRejectedNote",
    "retainedCandidateAcceptedNote",
    "retainedCandidateRepairedNote",
  ];
  for (const key of keys) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }

  function labelOf(section: string, key: string): string {
    const match = new RegExp(`${key}['"]?\\s*:\\s*"([^"]+)"`).exec(section);
    return match?.[1] ?? "";
  }

  const enAvailable = labelOf(enSection, "retainedCandidateAvailableBody");
  assert.match(enAvailable, /still matches the current retained change/i);
  assert.match(enAvailable, /does not prove Main acceptance or final delivery/i);
  const zhAvailable = labelOf(zhSection, "retainedCandidateAvailableBody");
  assert.ok(zhAvailable.includes("仍与当前保留的改动一致"));
  assert.ok(zhAvailable.includes("不能单独证明 Main 已接受或已经交付"));

  const enRevise = labelOf(enSection, "retainedCandidateReviseNote");
  assert.match(enRevise, /not an accepted or delivered result/i);
  const zhRevise = labelOf(zhSection, "retainedCandidateReviseNote");
  assert.ok(zhRevise.includes("不是已接受或已交付的结果"));

  const enAccepted = labelOf(enSection, "retainedCandidateAcceptedNote");
  assert.match(enAccepted, /Delivery and activation are separate facts/i);
  const zhAccepted = labelOf(zhSection, "retainedCandidateAcceptedNote");
  assert.ok(zhAccepted.includes("是否已经交付和生效是下方单独展示的事实"));

  const enRepaired = labelOf(enSection, "retainedCandidateRepairedNote");
  assert.match(enRepaired, /original Worker Candidate/i);
  assert.match(enRepaired, /not the final repaired file list/i);
  const zhRepaired = labelOf(zhSection, "retainedCandidateRepairedNote");
  assert.ok(zhRepaired.includes("原 Worker 候选"));
  assert.ok(zhRepaired.includes("不是 Main 修复后的最终文件清单"));

  const enUnavailable = labelOf(enSection, "retainedCandidateUnavailableBody");
  assert.match(enUnavailable, /does not mean the Worker made no changes/i);
  assert.match(enUnavailable, /no Candidate ever existed/i);
  const zhUnavailable = labelOf(zhSection, "retainedCandidateUnavailableBody");
  assert.ok(zhUnavailable.includes("不代表 Worker 没做过改动"));
  assert.ok(zhUnavailable.includes("不代表候选从未存在"));
});

test("guided first Task UI uses opaque sample APIs and hands off to ordinary Task Detail", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  assert.doesNotThrow(() => new Function(src));
  const renderer = extractFunctionSource(src, "renderGuidedSampleCard");
  assert.ok(renderer.includes('setAttribute("data-fl-role", "guided-first-task")'));
  assert.ok(renderer.includes('postJSON("/api/ops/sample-task/prepare"'));
  assert.ok(renderer.includes('postJSON("/api/ops/sample-task/submit"'));
  assert.ok(renderer.includes("workerProfileId: guidedWorkerId"));
  assert.ok(renderer.includes("previewRevisionDigest: sample.preview.previewRevisionDigest"));
  assert.ok(renderer.includes("confirm: true"));
  assert.ok(renderer.includes("showTask(sample.taskId)"), "submitted sample opens ordinary Task Detail");
  assert.ok(!renderer.includes("filePath"), "browser never supplies a private generated path");
  assert.ok(!renderer.includes("provider:"), "browser never hard-codes a Provider");
  assert.ok(!renderer.includes("auto"), "onboarding renderer adds no automatic execution loop");
  for (const key of [
    "guidedSampleTitle", "guidedSampleBody", "guidedSampleNoWorker",
    "guidedSampleNotPrepared", "guidedSamplePrepare", "guidedSamplePrepared",
    "guidedSampleStart", "guidedSampleSubmitted", "guidedSampleSubmittedNext",
    "guidedSampleUnknown",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  assert.doesNotMatch(enSection.match(/guidedSampleBody:\s*"([^"]+)/)?.[1] ?? "", /Daemon|MCP|Candidate|YAML/);
  assert.doesNotMatch(zhSection.match(/guidedSampleBody:\s*"([^"]+)/)?.[1] ?? "", /Daemon|MCP|Candidate|YAML/);
});

test("Hub Overview self-upgrade evidence card is bilingual, server-owned, and privacy-safe", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  assert.ok(src.includes("selfUpgradeEvidence"), "self-upgrade evidence slice key in map");
  assert.ok(src.includes("/api/ops/self-upgrade-evidence"), "bridge URL on the wire");
  assert.ok(src.includes("S.selfUpgradeEvidence"), "cached projection state");
  assert.ok(src.includes("S.selfUpgradeEvidenceError"), "isolated failure state");
  assert.ok(!src.match(/Promise\.all\(\[[\s\S]*fetchJSON.*ops\/board[\s\S]*fetchJSON.*ops\/tasks[\s\S]*fetchJSON.*ops\/competitions[\s\S]*fetchJSON.*ops\/stats[\s\S]*fetchJSON.*ops\/settings[\s\S]*fetchJSON.*ops\/sample-task[\s\S]*fetchJSON.*ops\/goals/), "no bulk all-endpoint Promise.all with 8 ops");

  assert.ok(src.includes("function renderSelfUpgradeEvidenceCard"), "card renderer");
  assert.ok(src.includes("function selfUpgradeEvidenceView"), "closed-code adapter");
  assert.ok(src.includes('data-fl-role", "self-upgrade-evidence"'), "stable card marker");
  assert.ok(src.includes('data-fl-role", "self-upgrade-progress"'), "progress marker");
  assert.ok(src.includes('data-fl-role", "self-upgrade-next"'), "next-action marker");

  const overviewIdx = src.indexOf("function rOverview()");
  assert.ok(overviewIdx > 0, "rOverview present");
  const nextFn = src.indexOf("function ", overviewIdx + 1);
  const overviewBlock = src.slice(overviewIdx, nextFn > 0 ? nextFn : src.length);
  assert.ok(overviewBlock.includes("renderCompactUpgradeRow"), "Overview uses compact upgrade row");
  // Browser must not recompute consecutive streak semantics.
  assert.ok(!/achieved\s*\+\s*1/.test(overviewBlock), "no browser-side streak increment");
  assert.ok(!/for\s*\(.*results/.test(overviewBlock), "no browser-side result scan");

  const adapter = extractFunctionSource(src, "selfUpgradeEvidenceView");
  assert.ok(adapter.includes("STATE_KEYS"), "maps closed state codes");
  assert.ok(adapter.includes("BREAK_KEYS"), "maps closed break codes");
  assert.ok(adapter.includes("NEXT_KEYS"), "maps closed next-action codes");
  assert.ok(adapter.includes("available: false"), "fail-closed unavailable branch");
  assert.ok(adapter.includes("available: true"), "available branch for valid projections");
  assert.ok(!adapter.includes("source-applied"), "adapter does not re-qualify stages");
  assert.ok(!adapter.includes("listIntegration"), "adapter does not read store");

  // Behavioral: malformed projections must not invent 0/3 progress.
  const adapterFn = new Function(
    "evidence",
    `${adapter}\nreturn selfUpgradeEvidenceView(evidence);`,
  ) as (evidence: unknown) => { available: boolean; achieved?: number };
  assert.deepEqual(adapterFn(null), { available: false });
  assert.deepEqual(adapterFn({}), { available: false });
  assert.deepEqual(adapterFn({ achieved: 0, required: 3 }), { available: false });
  assert.deepEqual(
    adapterFn({
      state: "empty",
      breakCategory: "none",
      nextAction: "run-first-upgrade",
      achieved: 1,
      required: 3,
      remaining: 2,
    }),
    { available: false },
    "inconsistent empty/progress must not invent evidence",
  );
  assert.deepEqual(
    adapterFn({
      state: "ready",
      breakCategory: "none",
      nextAction: "milestone-ready",
      achieved: 2,
      required: 3,
      remaining: 1,
    }),
    { available: false },
  );
  const valid = adapterFn({
    state: "in-progress",
    breakCategory: "retained-failure",
    nextAction: "continue-consecutive-proofs",
    achieved: 1,
    required: 3,
    remaining: 2,
    latestQualifyingAt: "2026-07-30T12:00:00.000Z",
    latestQualifyingOperationId: "efa7d9ae-61c9-421a-a1b5-d427d9353a81",
    breakOperationId: "/Users/private/path",
  }) as {
    available: boolean;
    achieved: number;
    required: number;
    remaining: number;
    latestQualifyingAt: string | null;
    latestQualifyingOperationId: string | null;
    breakOperationId: string | null;
  };
  assert.equal(valid.available, true);
  assert.equal(valid.achieved, 1);
  assert.equal(valid.required, 3);
  assert.equal(valid.remaining, 2);
  assert.equal(valid.latestQualifyingAt, "2026-07-30T12:00:00.000Z");
  assert.equal(valid.latestQualifyingOperationId, "efa7d9ae-61c9-421a-a1b5-d427d9353a81");
  assert.equal(valid.breakOperationId, null, "hostile break id is omitted");

  const renderer = extractFunctionSource(src, "renderSelfUpgradeEvidenceCard");
  assert.ok(renderer.includes("!view.available"), "renderer branches on unavailable");
  assert.ok(renderer.includes("sueUnavailableMalformed"), "malformed uses unavailable copy");
  assert.ok(!renderer.includes("stdout"), "no command stdout in card");
  assert.ok(!renderer.includes("stderr"), "no command stderr in card");
  assert.ok(!/\.error\b/.test(renderer.replace(/selfUpgradeEvidenceError/g, "")),
    "no raw result.error field reads");
  assert.ok(!renderer.includes("commands"), "no command stream access");
  assert.ok(!renderer.includes("source-applied"), "no stage re-qualification in card");
  assert.ok(!/—/.test(renderer), "no em dash in self-upgrade card");

  for (const key of [
    "sueCardTitle", "sueCardIntro", "sueProgress",
    "sueStateEmpty", "sueStateInProgress", "sueStateReady",
    "sueBreakNone", "sueBreakRetainedFailure", "sueBreakRejected",
    "sueBreakRolledBack", "sueBreakInsufficientEvidence",
    "sueRemaining", "sueNextLabel",
    "sueNextRunFirst", "sueNextContinue", "sueNextReady",
    "sueLoading", "sueUnavailableBridgeHint", "sueUnavailableMalformed",
    "sueTechnicalTitle",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  // Plain-language capability copy, not internal Integration jargon as primary title.
  assert.match(enSection, /sueCardTitle:\s*"Reliable self-upgrade streak"/);
  assert.match(zhSection, /sueCardTitle:\s*"可靠自升级连续次数"/);
  assert.match(enSection, /sueBreakRetainedFailure:\s*"[^"]*activation[^"]*"/i);
  assert.ok(zhSection.includes("激活阶段失败"), "zh explains activation break");
});

test("Hub Plan board items explain position and unlocks with readable names, not raw IDs in primary text", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // Helper functions exist.
  assert.ok(src.includes("function boardItemPositionText("));
  assert.ok(src.includes("function boardItemUnlocksText("));
  // They consume namedDependencies/namedRequiredBy, not raw IDs.
  assert.ok(src.includes(".namedDependencies") || src.includes("namedDependencies"), "uses namedDependencies");
  assert.ok(src.includes(".namedRequiredBy") || src.includes("namedRequiredBy"), "uses namedRequiredBy");
  // Primary position text is read using the new helpers, not the old raw-dep-states label.
  assert.ok(src.includes("boardItemPositionText(i)"), "calls boardItemPositionText on board item");
  // Old raw-dep string key is no longer primary visible text (but may stay as a fallback).
  // Primary position text and unlocks text use readable named keys.
  for (const key of [
    "planItemPositionReady", "planItemPositionQueued",
    "planItemPositionActive", "planItemPositionCompleted",
    "planItemPositionFailed", "planItemPositionBlocked",
    "planItemPositionBlockedByFailed", "planItemPositionBlockedByFailedMany",
    "planItemPositionWaitingFor", "planItemPositionWaitingForMany",
    "planItemUnlocks", "planItemUnlocksMany",
  ]) {
    assert.ok(i18n.includes(key), `i18n key ${key} exists`);
  }
  // Primary readable copy must use names, not raw UUIDs or event codes.
  for (const phrase of [
    "Ready - no prerequisites are waiting or blocked",
    "就绪 - 没有等待或阻塞的前置步骤",
    "Blocked - the required work",
    "被阻塞 - 前置工作",
    "Waiting - needs",
    "等待中 - 需要",
    "Unlocks:",
    "完成后解锁：",
    "planItemGenericSource",
    "planItemGenericNext",
    "planItemStepLabel",
  ]) {
    assert.ok(i18n.includes(phrase), phrase);
  }
  // Generic fallback labels exist so raw IDs are never primary copy.
  assert.ok(src.includes("safeTaskName("), "name sanitisation helper exists");
  assert.ok(src.includes("safeItemLabel("), "item label helper exists");
  // Old keys remain for backward compatibility but primary rendering uses named helpers.
  assert.ok(src.includes("boardItemPositionText") && src.includes("boardItemUnlocksText"),
    "primary rendering uses named position and unlocks helpers");
});

test("Hub Task Detail conditionally explains Plan origin and handoff lineage without empty section for standalone Tasks", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // Lineage section renderer exists.
  assert.ok(src.includes("function renderTaskLineage("));
  assert.ok(src.includes('data-fl-role", "task-lineage"'));
  // Standalone tasks produce no section.
  assert.ok(src.includes('kind === "standalone"'), "standalone check exists");
  // Conditionally renders only when context exists.
  assert.ok(src.includes("if(lineageCard)"), "guarded by lineage presence");
  // Bilingual copy.
  for (const key of [
    "taskLineageTitle", "taskLineageStartedAs",
    "taskLineageContinuedFromHandoff", "taskLineageContinuedFromDeps",
    "taskLineageWorkerChange",
    "taskLineageThisRunHandoffSuccessor", "taskLineageThisRunHandoffSource",
    "taskLineageUnlocksHandoff", "taskLineageUnlocks", "taskLineageUnlocksMany",
    "taskLineageNotARetry",
  ]) {
    assert.ok(i18n.includes(key), `i18n key ${key} exists`);
  }
  for (const phrase of [
    "Where this Task sits",
    "此任务所处的位置",
    "Part of Plan",
    "属于 Plan",
    "step ",
    "步。",
    "Continues from another Task",
    "承接自另一个 Task",
    "continuation, not a retry",
    "接力延续，不是重试",
    "picking up retained work",
    "从源任务中断处继续保留的成果",
  ]) {
    assert.ok(i18n.includes(phrase), phrase);
  }
  // Lineage copy never exposes raw task IDs as primary text.
  assert.ok(!/taskLineageStartedAs.*\{taskId\}/.test(i18n), "StartedAs uses step number, not taskId");
  assert.ok(!/taskLineageContinuedFromHandoff.*\{sourceTaskId\}/.test(i18n), "ContinuedFromHandoff is a standalone sentence");
});

test("Hub handoff lineage uses continuation wording, never relabels retained work as accepted or calls successor a retry", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // Must never call the successor a retry.
  assert.ok(!i18n.includes("successor is a retry"));
  assert.ok(!i18n.includes("is a retry of the source"));
  assert.ok(!i18n.includes("retry of the source Task") || i18n.includes("This is not a retry"));
  // Explicit continuation marker in the journey handoff already exists.
  assert.ok(i18n.includes("This is a continuation, not a retry"));
  assert.ok(i18n.includes("这是一次接力延续，不是重试"));
  assert.ok(i18n.includes("not accepted output"));
  assert.ok(i18n.includes("并非被接受的交付物"));
  // Retained work must never be called accepted output.
  for (const badPhrase of [
    "accepted output from the source",
    "delivered by the source",
    "approved delivery from the source",
  ]) {
    assert.ok(!i18n.includes(badPhrase), `must not claim: ${badPhrase}`);
  }
});

test("Hub preserves existing task lanes, filters, actions, and four-part journey truth", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // Five lanes exist in board rendering.
  assert.ok(src.includes('"queued"') && src.includes('"active"') && src.includes('"blocked"')
    && src.includes('"failed"') && src.includes('"completed"'));
  // Existing supervision actions preserved.
  assert.ok(src.includes("function showTask("));
  assert.ok(src.includes("/resume\"") || src.includes('"resume"'));
  assert.ok(src.includes("/revise\"") || src.includes('"revise"'));
  assert.ok(src.includes("/correct\"") || src.includes('"correct"'));
  assert.ok(src.includes("/main-review\"") || src.includes('"main-review"'));
  assert.ok(src.includes("/reverify\"") || src.includes('"reverify"'));
  assert.ok(src.includes("taskAction("));
  // Four-part journey section attributes.
  assert.ok(src.includes("journeyAssignment"));
  assert.ok(src.includes("journeyWorkerExecution"));
  assert.ok(src.includes("journeyVerification"));
  assert.ok(src.includes("journeyDelivery"));
  // Theme and language i18n keys survive.
  assert.ok(i18n.includes("themeLight") && i18n.includes("themeDark"));
  assert.ok(i18n.includes("langZh") && i18n.includes("langEn"));
  // Kanban rendering preserved.
  assert.ok(src.includes("function kanbanCard("));
  assert.ok(src.includes("function kanbanColumn("));
});

test("Hub Plan cards and Task lineage expose no raw UUID or event-code text as primary copy", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // Individual dependency and lineage strings must use {name} placeholders, never raw UUID patterns.
  const depKeys = [
    "planItemPositionBlockedByFailed",
    "planItemPositionBlockedByFailedMany",
    "planItemPositionWaitingFor",
    "planItemPositionWaitingForMany",
    "planItemPositionActive",
    "planItemPositionCompleted",
    "planItemPositionFailed",
    "planItemPositionBlocked",
    "taskLineageStartedAs",
    "taskLineageContinuedFromDeps",
    "taskLineageWorkerChange",
    "taskLineageUnlocks",
    "taskLineageUnlocksMany",
  ];
  for (const key of depKeys) {
    // Extract the en value for each key from i18n.
    const re = new RegExp(`${key}:\\s*"([^"]*)"`, "g");
    const matches = [...i18n.matchAll(re)];
    for (const m of matches) {
      const value = m[1] ?? "";
      // UUID pattern must not appear in primary copy.
      assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(value) || value.includes("{") && value.includes("}"),
        `${key} primary copy must not contain raw UUID: "${value}"`);
      // Event codes like "candidate.handoff" must not be primary.
      assert.ok(!/(?:candidate|task|worker|goal|plan)\.\w+\.\w+/.test(value) || value.includes("{"),
        `${key} primary copy must not contain raw event code: "${value}"`);
    }
  }
  // Primary lineage sentences are standalone - they have no ID placeholders.
  for (const key of ["taskLineageContinuedFromHandoff", "taskLineageUnlocksHandoff",
      "taskLineageThisRunHandoffSuccessor", "taskLineageThisRunHandoffSource"]) {
    const re = new RegExp(`${key}:\\s*"([^"]*)"`, "g");
    const matches = [...i18n.matchAll(re)];
    for (const m of matches) {
      const value = m[1] ?? "";
      assert.ok(!value.includes("{"), `${key} is a standalone sentence with no raw ID placeholders: "${value}"`);
    }
  }
});

test("Hub bilingual Plan position and lineage copy is independently readable in en and zh-CN", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // English section has readable position labels.
  assert.match(i18n, /planItemPositionReady:\s*"Ready/);
  assert.match(i18n, /planItemPositionWaitingFor:\s*"Waiting\s/);
  assert.match(i18n, /planItemPositionBlockedByFailed:\s*"Blocked/);
  assert.match(i18n, /planItemUnlocks:\s*"Unlocks:/);
  assert.match(i18n, /taskLineageStartedAs:\s*"Part of Plan/);
  assert.match(i18n, /taskLineageNotARetry:\s*"This is a continuation/);
  // Chinese section has independently written labels.
  assert.match(i18n, /planItemPositionReady:\s*"就绪/);
  assert.match(i18n, /planItemPositionWaitingFor:\s*"等待中/);
  assert.match(i18n, /planItemPositionBlockedByFailed:\s*"被阻塞/);
  assert.match(i18n, /planItemUnlocks:\s*"完成后解锁：/);
  assert.match(i18n, /taskLineageStartedAs:\s*"属于 Plan/);
  assert.match(i18n, /taskLineageNotARetry:\s*"这是一次接力/);
});

test("Hub board scope control is primary, bilingual, and defaults to Now", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  // Session-local scope state defaults to Now.
  assert.ok(/var boardScope\s*=\s*"now"/.test(src), "scope defaults to now");
  assert.ok(src.includes("function taskBoardScope("), "scope helper reads the canonical code");
  assert.ok(src.includes("function taskHistoryGroup("), "history group helper translates closed codes");
  assert.ok(src.includes('"board-scope-row"'), "scope control row marker");
  assert.ok(src.includes('"board-scope-chip"'), "scope chip class");
  assert.ok(src.includes("historyState.loaded ? historyState.totalCount : null"),
    "History scope never presents the bounded recent count as the full archive total");
  assert.ok(src.includes('if(row[2] !== null)'),
    "History omits its count until the authoritative total has loaded");
  // Scope is rendered before the lane legend and search (primary hierarchy).
  const rTasksIdx = src.indexOf("function rTasks()");
  const scopeIdx = src.indexOf("board-scope-row", rTasksIdx);
  const legendIdx = src.indexOf("kanban-legend", rTasksIdx);
  assert.ok(scopeIdx > 0 && legendIdx > scopeIdx, "scope control precedes the lane legend");
  // Clearing search + lane never switches the chosen scope.
  const clearIdx = src.indexOf('boardFilterQuery = ""', rTasksIdx);
  assert.ok(clearIdx > 0, "clear handler present");
  const clearEnd = src.indexOf("rTasks();", clearIdx);
  const clearBlock = src.slice(clearIdx, clearEnd > 0 ? clearEnd + "rTasks();".length : src.length);
  assert.ok(!/boardScope\s*=/.test(clearBlock), "clear does not switch scope");
  // Bilingual keys in both locales.
  for (const key of [
    "boardScopeLabel", "boardScopeNow", "boardScopeHistory", "boardScopeAll",
    "boardNowHelper", "boardAllHelper", "boardHistoryHelper",
    "boardHistoryDelivered", "boardHistoryStopped",
    "boardHistoryDeliveredHint", "boardHistoryStoppedHint", "boardHistoryEmpty",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  // Plain Chinese verbs; honest full-search History.
  assert.ok(zhSection.includes("待处理"), "zh Now");
  assert.ok(zhSection.includes("历史记录"), "zh History");
  assert.ok(zhSection.includes("已交付"), "zh Delivered");
  assert.ok(zhSection.includes("已停止"), "zh Stopped");
  assert.ok(zhSection.includes("搜索所有已结束的记录"), "zh History is honestly searchable, not a bounded recent slice");
  // English honesty: History searches every closed outcome and loads on demand.
  assert.match(enSection, /boardHistoryHelper:\s*"[^"]*Search every closed outcome/i);
  assert.match(enSection, /boardHistoryHelper:\s*"[^"]*never auto-refreshes/i);
  // CSS ships scope styles and keeps focus visible.
  assert.ok(css.includes(".board-scope-row"));
  assert.ok(css.includes(".board-scope-chip"));
  assert.ok(css.includes(".board-scope-chip:focus-visible"), "scope chip focus stays visible");
});

test("Hub board composes scope, search, and secondary filters without mutating Tasks", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // Scope filters first, then lane + search compose on the scoped set.
  assert.ok(src.includes("function taskMatchesBoardFilter("), "board filter helper retained");
  assert.ok(src.includes("boardFilterQuery"), "search state retained");
  assert.ok(src.includes("boardFilterLane"), "lane state retained");
  assert.ok(src.includes("var scoped = tasks.filter"), "scope filter composes before lane/search");
  // taskLane still selects only on machine status; scope/reason never reroute it.
  const laneIdx = src.indexOf("function taskLane(");
  const laneEnd = src.indexOf("function ", laneIdx + 1);
  const laneBlock = src.slice(laneIdx, laneEnd > 0 ? laneEnd : src.length);
  assert.ok(!laneBlock.includes("boardScope"), "taskLane ignores scope");
  assert.ok(!laneBlock.includes("boardReason"), "taskLane ignores reason codes");
  // History renders Delivered and Stopped outcome groups; machine lanes stay for Now/All.
  assert.ok(src.includes("function renderHistoryBoard("), "history board renderer");
  assert.ok(src.includes('"history-board"'), "history board container");
  assert.ok(src.includes('"history-group tone-"'), "history group tone marker");
  assert.ok(src.includes('"delivered"') && src.includes('"stopped"'), "Delivered and Stopped groups");
  // No archive/delete/move mutation is wired.
  assert.ok(!src.includes("/api/ops/tasks/delete"), "no delete mutation");
  assert.ok(!src.includes("/api/ops/tasks/archive"), "no archive mutation");
});

test("Hub board fails open to Now when placement codes are absent or contradictory", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // The UI never recomputes placement; it only reads the canonical boardScope.
  // Absent or non-"history" codes (including contradictory pairs the Hub
  // adapter stripped) fall back to Now so unfinished work is never hidden.
  const fnSrc = extractFunctionSource(src, "taskBoardScope");
  const taskBoardScope = new Function(
    "task",
    `${fnSrc}\nreturn taskBoardScope(task);`,
  ) as (task: unknown) => string;
  assert.equal(taskBoardScope({ boardScope: "history" }), "history");
  assert.equal(taskBoardScope({ boardScope: "now" }), "now");
  assert.equal(taskBoardScope({}), "now", "absent boardScope fails open to Now");
  assert.equal(taskBoardScope(undefined), "now");
  // A contradictory pair the Hub stripped leaves no boardScope -> Now.
  assert.equal(taskBoardScope({ boardReason: "active-work" }), "now",
    "reason without a history scope stays Now");
  assert.equal(taskBoardScope({ boardScope: "archive" }), "now",
    "unknown scope strings fall back to Now");
});

test("Hub board scope control and History stay readable at 390px", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  // Scope row wraps as one compact row.
  assert.match(css, /\.board-scope-row\s*\{[^}]*flex-wrap\s*:\s*wrap/i, "scope row wraps");
  // History board is a single stacked column, not a 4-col grid.
  assert.match(css, /\.history-board\s*\{[^}]*flex-direction\s*:\s*column/i, "history stacks one column");
  // Focus remains visible on the scope chip.
  assert.ok(css.includes(".board-scope-chip:focus-visible"), "scope chip focus visible");
  // A narrow-viewport rule tunes the scope chips so they stay compact at 390px.
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*480px\s*\)/i, "narrow scope rule ships");
});

test("Hub board History copy is plain and honestly searchable in both languages", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  // Chinese: History searches every closed outcome and loads only on demand.
  const zhHelper = zhSection.match(/boardHistoryHelper:\s*"([^"]*)"/);
  assert.ok(zhHelper, "zh boardHistoryHelper present");
  const zhHelperText = zhHelper![1] ?? "";
  assert.ok(zhHelperText.includes("搜索所有已结束的记录"), "zh says search every closed outcome");
  assert.ok(zhHelperText.includes("不会自动刷新"), "zh says it never auto-refreshes");
  // English: same honest on-demand full-search copy.
  assert.match(enSection, /boardHistoryHelper:\s*"[^"]*Search every closed outcome/i);
  assert.match(enSection, /boardHistoryHelper:\s*"[^"]*never auto-refreshes/i);
  // Primary scope/History labels avoid lifecycle jargon in both locales.
  for (const key of ["boardScopeNow", "boardScopeHistory", "boardScopeAll",
    "boardHistoryDelivered", "boardHistoryStopped"]) {
    const enVal = enSection.match(new RegExp(`${key}:\\s*"([^"]*)"`));
    const zhVal = zhSection.match(new RegExp(`${key}:\\s*"([^"]*)"`));
    assert.ok(enVal, `en ${key} value present`);
    assert.ok(zhVal, `zh ${key} value present`);
    for (const val of [enVal![1] ?? "", zhVal![1] ?? ""]) {
      assert.ok(!/terminal|projection|decision stage|remediation/i.test(val),
        `${key} avoids lifecycle jargon: "${val}"`);
    }
  }
  // Repaired delivery is grouped under Delivered, not a runtime-failure label.
  assert.ok(enSection.includes("Delivered"));
  assert.ok(zhSection.includes("已交付"));
  assert.ok(enSection.includes("Stopped"));
  assert.ok(zhSection.includes("已停止"));
});

test("Hub History panel is explicit, never polled, and single-flight", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  // History state holds every field the contract requires.
  assert.ok(src.includes("var historyState = {"), "historyState exists");
  const hsBlock = src.slice(src.indexOf("var historyState = {"), src.indexOf("};", src.indexOf("var historyState = {")) + 2);
  for (const field of ["items", "submittedQuery", "draftQuery", "nextCursor",
    "totalCount", "hasMore", "loading", "error", "stale", "loaded", "failedMode", "generation"]) {
    assert.ok(hsBlock.includes(field), `historyState includes ${field}`);
  }
  // Separate draft vs submitted query: search submits, never requests per keystroke.
  assert.ok(src.includes("historyState.submittedQuery = historyState.draftQuery.trim()"),
    "submit copies the trimmed draft into the submitted query");
  // The History endpoint is called only by loadHistory, never by fetchSlice.
  assert.ok(src.includes("/api/ops/tasks/history"), "History endpoint URL present");
  // History must NOT appear in PAGE_DEPS or SLICE_MAP (no automatic polling).
  const pdStart = src.indexOf("var PAGE_DEPS = {");
  const pdEnd = src.indexOf("};", pdStart) + 2;
  const pdBlock = src.slice(pdStart, pdEnd);
  assert.ok(!/history\s*:/i.test(pdBlock), "PAGE_DEPS has no history slice");
  const smStart = src.indexOf("var SLICE_MAP = {");
  const smEnd = src.indexOf("};", smStart) + 2;
  const smBlock = src.slice(smStart, smEnd);
  assert.ok(!/history\s*:/i.test(smBlock), "SLICE_MAP has no history slice (no polling)");
  // Single-flight: a generation counter and AbortController supersede older requests.
  const lhBlock = extractFunctionSource(src, "loadHistory");
  assert.ok(lhBlock.includes("historyState.generation"), "uses a generation counter");
  assert.ok(lhBlock.includes("AbortController"), "uses AbortController for single-flight");
  assert.ok(lhBlock.includes("gen !== historyState.generation"), "drops stale responses");
  assert.ok(lhBlock.includes("AbortError"), "treats superseded aborts as non-errors");
  // Load more de-duplicates by Task id; replace clears only on success.
  assert.ok(lhBlock.includes("new Set(historyState.items.map"), "Load more de-duplicates by id");
  // First-page failure is not shown as empty; later-page failure keeps records + stale.
  assert.ok(lhBlock.includes('historyUnavailable') || lhBlock.includes("t(\"historyUnavailable\")"),
    "first-page failure uses the unavailable message");
  assert.ok(lhBlock.includes("historyState.stale = true"), "later-page failure marks stale");
  assert.ok(lhBlock.includes("historyState.failedMode = mode"),
    "failure remembers whether search or Load more failed");
  const retryBlock = extractFunctionSource(src, "historyRetryMode");
  assert.ok(retryBlock.includes('historyState.failedMode === "more"'),
    "retry reuses a cursor only when Load more itself failed");
  assert.ok(!retryBlock.includes("historyState.items.length"),
    "retained results from an older search cannot misclassify a failed new search as Load more");
  // The panel renderer exists with explicit search, Refresh, Load more, retry.
  assert.ok(src.includes("function renderHistoryPanel("), "panel renderer exists");
  const panelBlock = extractFunctionSource(src, "renderHistoryPanel");
  assert.ok(panelBlock.includes("<form") || panelBlock.includes('h("form"'), "search form present");
  assert.ok(panelBlock.includes('type = "submit"'), "search submits via the form");
  assert.ok(panelBlock.includes("historyRefreshBtn"), "Refresh control present");
  assert.ok(panelBlock.includes("historyLoadMoreBtn"), "Load more control present");
  assert.ok(panelBlock.includes("historyRetryBtn"), "retry control present");
  assert.ok(panelBlock.includes("historyLoadedCount"), "honest loaded/total count present");
  // Opening History starts the first request only when not already loaded.
  const chipBlock = src.slice(src.indexOf("chip.addEventListener(\"click\""));
  const chipEnd = chipBlock.indexOf("});");
  assert.ok(chipBlock.slice(0, chipEnd).includes("loadHistory(\"search\")"),
    "selecting History triggers the first load");
  // Bilingual copy keys for every History control and state.
  for (const key of [
    "historySearchLabel", "historySearchPlaceholder", "historySearchBtn",
    "historyRefreshBtn", "historyLoadMoreBtn", "historyLoading",
    "historyLoadedCount", "historyUnavailable", "historyStale",
    "historyRetryBtn", "historyEmpty",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  // Primary History copy avoids implementation jargon in both locales.
  for (const key of ["historySearchLabel", "historyRefreshBtn", "historyLoadMoreBtn",
    "historyUnavailable", "historyStale", "historyEmpty"]) {
    const enVal = enSection.match(new RegExp(`${key}:\\s*"([^"]*)"`));
    const zhVal = zhSection.match(new RegExp(`${key}:\\s*"([^"]*)"`));
    assert.ok(enVal, `en ${key} value present`);
    assert.ok(zhVal, `zh ${key} value present`);
    for (const val of [enVal![1] ?? "", zhVal![1] ?? ""]) {
      assert.ok(!/cursor|daemon|projection|lifecycle|endpoint/i.test(val),
        `${key} avoids implementation jargon: "${val}"`);
    }
  }
  // CSS ships the panel styles and keeps focus visible at 390px.
  assert.ok(css.includes(".history-panel"));
  assert.ok(css.includes(".history-search-input:focus"), "search input focus visible");
  assert.ok(css.includes("@media (max-width: 480px)"), "narrow-viewport rule ships");
  assert.ok(css.includes(".history-search-form"), "search form wraps");
  assert.ok(css.includes(".history-load-more"), "load more row styled");
});


test("Hub Plan board dependency rendering bounds more-than-three dependents with a count", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // boardItemUnlocksText has the bounding logic.
  const fn = extractFunctionSource(src, "boardItemUnlocksText");
  assert.ok(fn.includes("named.slice(0, 3)"), "bounds to first three names");
  assert.ok(fn.includes("named.length <= 3"), "branches on count");
  assert.ok(fn.includes("planItemUnlocksMany"), "uses the many-label with count");
  // Must not leak more than 3 names in primary copy for list-bounding.
  assert.ok(fn.includes("more: String(named.length - 3)"), "passes remaining count");
});

/* --- Visibility-aware, page-scoped Hub polling regression tests --- */

test("Hub page-to-data dependency map covers every top-level tab", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("var PAGE_DEPS ="), "PAGE_DEPS constant exists");
  assert.ok(src.includes("function requestPlan("), "requestPlan helper exists");
  // Every top-level tab in the render dispatcher must appear in PAGE_DEPS.
  var tabs = ["overview", "work", "tasks", "plans", "goals", "competitions", "stats",
              "model", "worker", "limits", "mains", "delivery"];
  tabs.forEach(function(tab){
    assert.ok(src.includes('"' + tab + '"'), "PAGE_DEPS includes " + tab);
  });
  // Work is the single operate surface: it depends on the hierarchy board plus
  // the bounded outcome-intake list (FL-109D2), nothing else.
  var workDepStart = src.indexOf("var PAGE_DEPS = {");
  var workDepEnd = src.indexOf("};", workDepStart) + 2;
  var workDepBlock = src.slice(workDepStart, workDepEnd);
  assert.ok(/work\s*:\s*\{\s*workHierarchy\s*:\s*true,\s*intakes\s*:\s*true\s*\}/.test(workDepBlock),
    "work page depends on the workHierarchy slice plus the bounded intakes slice");
  // requestPlan is pure; no DOM, fetch, or S mutation.
  var rpSrc = extractFunctionSource(src, "requestPlan");
  assert.ok(rpSrc.includes("PAGE_DEPS"), "requestPlan reads PAGE_DEPS");
  assert.ok(!rpSrc.includes("document."), "requestPlan does not touch DOM");
  assert.ok(!rpSrc.includes("fetch"), "requestPlan does not fetch");
});

test("Hub PAGE_DEPS assigns exact slices per page", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // Extract the PAGE_DEPS object literal for precise assertion.
  var start = src.indexOf("var PAGE_DEPS = {");
  var end = src.indexOf("};", start) + 2;
  var block = src.slice(start, end);
  function entry(tab: string): string {
    const match = block.match(new RegExp('(?:"' + tab + '"|' + tab + ')\\s*:\\s*\\{([^}]*)\\}'));
    assert.ok(match, `${tab} dependency entry exists`);
    return match![1] ?? "";
  }
  // Tasks page fetches only tasks (not boards, competitions, goals, etc.)
  const taskDeps = entry("tasks");
  assert.match(taskDeps, /(?:"tasks"|tasks)\s*:\s*true/, "tasks page depends on tasks slice");
  assert.doesNotMatch(taskDeps, /(?:"boards"|boards)\s*:\s*true/, "tasks page does not depend on boards");
  assert.doesNotMatch(taskDeps, /(?:"stats"|stats)\s*:\s*true/, "tasks page does not depend on stats");
  assert.doesNotMatch(taskDeps, /(?:"economics"|economics)\s*:\s*true/, "tasks page does not depend on economics");
  // Insights page fetches stats + economics + routingCoverage but not tasks
  const insightDeps = entry("stats");
  assert.match(insightDeps, /(?:"stats"|stats)\s*:\s*true/, "insights page depends on stats slice");
  assert.match(insightDeps, /(?:"economics"|economics)\s*:\s*true/, "insights page depends on economics");
  assert.match(insightDeps, /(?:"routingCoverage"|routingCoverage)\s*:\s*true/, "insights page depends on routingCoverage");
  assert.doesNotMatch(insightDeps, /(?:"tasks"|tasks)\s*:\s*true/, "insights page does not depend on tasks");
  // Model, worker, limits, mains, delivery pages have empty deps (shared only)
  ["model","worker","limits","mains","delivery"].forEach(function(tab){
    assert.equal(entry(tab).trim(), "", tab + " page has empty deps");
  });
});

test("Hub SLICE_MAP maps every declared slice to endpoint, field, and error field", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("var SLICE_MAP ="), "SLICE_MAP constant exists");
  assert.ok(src.includes("function fetchSlice("), "fetchSlice helper exists");
  // Shared slice
  assert.ok(src.includes('"health"'), "SLICE_MAP includes health");
  assert.ok(src.includes("/api/ops/health"), "health endpoint mapped");
  // Page-specific slices
  ["tasks","boards","competitions","goals","stats","settings","sample"].forEach(function(k){
    assert.ok(src.includes('"' + k + '"'), "SLICE_MAP includes " + k);
  });
  assert.ok(src.includes("/api/ops/economics-summary"), "economics endpoint mapped");
  assert.ok(src.includes("/api/ops/routing-evidence-coverage"), "coverage endpoint mapped");
  assert.ok(src.includes("/api/ops/self-upgrade-evidence"), "self-upgrade endpoint mapped");
  // fetchSlice never throws; errors are stored
  var fs = extractFunctionSource(src, "fetchSlice");
  assert.ok(fs.includes("S[slice.errorField]"), "fetchSlice writes errorField on failure");
  assert.ok(!fs.includes("throw"), "fetchSlice does not throw");
  // fetchSlice does NOT clear the data field on error (retains stale evidence)
  assert.ok(!fs.match(/S\[slice\.field\]\s*=\s*null/), "fetchSlice does not clear data on error");
});

test("Hub pageEvidenceState classifies loading, unavailable, stale, and ready", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("function pageEvidenceState("), "pageEvidenceState function exists");
  var pes = extractFunctionSource(src, "pageEvidenceState");
  assert.ok(pes.includes('"ready"'), "returns ready state");
  assert.ok(pes.includes('"loading"'), "returns loading state");
  assert.ok(pes.includes('"unavailable"'), "returns unavailable state");
  assert.ok(pes.includes('"stale"'), "returns stale state");
  // Uses errorField to distinguish between never-loaded and first-failure
  assert.ok(pes.includes("errorField"), "checks per-slice errorField");
  assert.ok(pes.includes("anyNullWithoutError"), "distinguishes missing from failed");
  assert.ok(pes.includes("anyNullWithError"), "detects first-fetch failure");
  assert.ok(pes.includes("anyErrorWithData"), "detects stale retained evidence");
  // No empty-array fallback (ensureArrays is removed)
  assert.ok(!src.includes("function ensureArrays"), "ensureArrays must not exist");
  assert.ok(pes.indexOf("if(anyNullWithError)") < pes.indexOf("if(anyNullWithoutError)"),
    "a confirmed first-fetch failure wins over another loading slice");
});

test("Hub status visibly marks retained active-page evidence as stale", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const status = extractFunctionSource(src, "updStatus");
  assert.ok(status.includes("pageEvidenceState(S.tab"), "status checks the active page evidence state");
  assert.ok(status.includes('=== "stale"'), "status recognizes retained stale evidence");
  assert.ok(status.includes("pageStale"), "status uses an explicit page-level stale flag");
  assert.match(status, /S\.connected\s*&&\s*!pageStale/, "live state requires current page evidence");
});

test("Hub render treats missing data as loading, not empty success", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  var rSrc = extractFunctionSource(src, "render");
  assert.ok(rSrc.includes("pageEvidenceState"), "render calls pageEvidenceState");
  assert.ok(rSrc.includes('"loading"'), "render checks loading state");
  assert.ok(rSrc.includes('"unavailable"'), "render checks unavailable state");
  assert.ok(rSrc.includes("stateMsg(\"loading\""), "render shows loading for missing data");
  assert.ok(rSrc.includes("stateMsg(\"empty\""), "render shows reconnecting for unavailable data");
  assert.ok(!rSrc.includes("pageHasRequiredData"), "old pageHasRequiredData is removed");
  // Must never call ensureArrays (converts null to [] which looks like empty success)
  assert.ok(!rSrc.includes("ensureArrays"), "render does not call ensureArrays");
});

test("Hub visibility handler cancels timer when hidden and refreshes on return", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("visibilitychange"), "visibility change listener registered");
  assert.ok(src.includes('"visible"'), "checks for visible state");
  assert.ok(src.includes("clearTimeout"), "clears timer when hidden");
  assert.ok(src.includes("document.visibilityState"), "checks visibilityState in scheduleNext");
  assert.ok(src.includes("=== \"hidden\""), "visibilityState hidden guard exists");
  // Hidden tabs stop: refresh checks visibility before starting
  var rf = extractFunctionSource(src, "refresh");
  assert.ok(rf.includes('"hidden"'), "refresh has hidden guard");
});

test("Hub scheduleNext honors visibility, token, and configured interval", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  var sn = extractFunctionSource(src, "scheduleNext");
  assert.ok(sn.includes("visibilityState"), "visibilityState checked in scheduleNext");
  assert.ok(sn.includes("!S.token"), "scheduleNext stops after 401 auth rejection");
  assert.ok(sn.includes("refreshIntervalMs"), "reads configured interval");
  assert.ok(sn.includes("Math.max(200"), "interval has minimum 200ms floor");
  assert.ok(sn.includes("setTimeout(refresh"), "schedules next refresh via setTimeout");
});

test("Hub refresh coalesces overlapping triggers and stops after 401", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  var rf = extractFunctionSource(src, "refresh");
  assert.ok(rf.includes("!S.token"), "refresh stops after token is cleared");
  assert.ok(rf.includes("batchInFlight"), "checks batchInFlight guard");
  assert.ok(rf.includes("pendingRefresh = true"), "sets pending when in-flight");
  assert.ok(rf.includes("pendingRefresh = false"), "resets pending before batch");
  assert.ok(rf.includes("batchInFlight = true"), "sets batchInFlight when starting");
  assert.ok(rf.includes("batchInFlight = false"), "clears batchInFlight in finally");
  assert.ok(rf.includes("if(S.pendingRefresh)"), "checks pending after batch");
  assert.ok(rf.includes("refresh()"), "follow-up refresh call exists");
  // Finally block stops scheduling after 401
  var fin = rf.slice(rf.lastIndexOf("finally"));
  assert.ok(fin.includes("!S.token"), "finally block stops after 401");
  // Connected state uses healthError, not health data field
  assert.ok(rf.includes("S.healthError"), "refresh checks healthError for connected state");
  assert.ok(!rf.includes("ensureArrays"), "refresh does not call ensureArrays");
});

test("Hub switchTab triggers immediate render and refresh for new page", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  var st = extractFunctionSource(src, "switchTab");
  assert.ok(st.includes("render()"), "switchTab calls render immediately");
  assert.ok(st.includes("refresh()"), "switchTab calls refresh for fresh data");
  assert.ok(st.includes("workerFormActive"), "switchTab clears workerFormActive for non-worker tabs");
  assert.ok(st.includes("hideDetail()"), "switchTab closes detail drawer");
});

test("Hub no longer uses global Promise.all poll with all eight ops endpoints", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // The old pattern bundled health, board, tasks, competitions, stats,
  // settings, sample-task, and goals in one Promise.all.  That must be gone.
  var hasBulkAll = src.match(
    /Promise\.all\(\[[\s\S]*fetchJSON.*ops\/board[\s\S]*fetchJSON.*ops\/tasks[\s\S]*fetchJSON.*ops\/competitions[\s\S]*fetchJSON.*ops\/stats[\s\S]*fetchJSON.*ops\/settings[\s\S]*fetchJSON.*ops\/sample-task[\s\S]*fetchJSON.*ops\/goals/
  );
  assert.ok(!hasBulkAll, "global 8-endpoint Promise.all must not exist");
  // The new pattern fetches slices independently via fetchSlice
  assert.ok(src.includes("fetchSlice"), "generic slice fetcher is the new mechanism");
  // Shared truth comes from /api/status + /api/ops/health
  assert.ok(src.includes("/api/status"), "/api/status is always fetched");
  assert.ok(src.includes("fetchSlice(\"health\")"), "health is fetched as a named slice");
});

test("Hub retains prior evidence when one slice fails", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // fetchSlice does not clear the data field on failure
  var fs = extractFunctionSource(src, "fetchSlice");
  assert.ok(!fs.match(/S\[slice\.field\]\s*=\s*null/), "fetchSlice retains old data on failure");
  // Refresh does not have a bulk catch that clears all arrays
  var rf = extractFunctionSource(src, "refresh");
  assert.ok(!rf.includes("S.tasks = []"), "refresh does not clear tasks on failure");
  assert.ok(!rf.includes("S.boards = []"), "refresh does not clear boards on failure");
  assert.ok(!rf.includes("S.goals = []"), "refresh does not clear goals on failure");
});

// --- Execution preference UI (FL-104) ---

test("Hub explains execution preference bilingually without forcing protocol vocabulary", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  assert.ok(src.includes("function executionPreferenceLabel("), "Worker cards label the preference");
  assert.ok(src.includes("function resolvedExecutionModeText("), "resolved mode is projected in plain words");
  assert.ok(src.includes("executionPreferenceUnsupported"), "forced unsupported native Goal has a clear signal");
  assert.ok(src.includes("workersStoryBlockedExecution"), "blocked native-Goal readiness reason is projected in plain words");
  assert.ok(src.includes("workersReadinessNextExecutionMode"), "readiness next action key is consumed");
  assert.ok(src.includes("fl-wp-execution"), "the Worker editor has an execution preference control");
  for (const phrase of [
    "Auto — prefer a real Goal",
    "One normal run",
    "Native Goal (requires support)",
    "自动 —— 优先使用真实 Goal",
    "单次执行",
    "原生 Goal（需要 Runtime 支持）",
  ]) {
    assert.ok(i18n.includes(phrase), phrase);
  }
  // Plain language first: technical ids live under disclosure, never the
  // primary explanation.
  assert.ok(!i18n.includes("app-server"), "beginner copy avoids the app-server transport name");
});

// --- FL-109B unified hierarchical workbench ---

test("Hub Work surface renders one hierarchy with seven exact columns and never peer cards", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes('case "work": rWork(); break;'), "render dispatcher routes Work");
  assert.ok(src.includes("function rWork("), "Work renderer exists");
  assert.ok(src.includes("function renderWorkGoalLane("), "Goal lane renderer exists");
  assert.ok(src.includes("function renderWorkPlanLane("), "Plan lane renderer exists");
  assert.ok(src.includes("function renderWorkColumns("), "column grid renderer exists");
  assert.ok(src.includes('data-lane-kind", "goal"'), "Goal is a lane, not a card");
  assert.ok(src.includes('data-lane-kind", "plan"'), "Plan is a lane, not a card");
  assert.ok(src.includes('data-lane-kind", "one-off"'), "one-off lane kind exists");
  assert.ok(src.includes('data-fl-role", "work-card"'), "Task cards carry the card role");
  // The seven columns in the frozen order, exactly once, no extra column.
  const wcc = extractFunctionSource(src, "workColumnLabel");
  const orderIdx = src.indexOf("var WORK_COLUMN_CODES = [");
  const orderBlock = src.slice(orderIdx, src.indexOf("];", orderIdx) + 2);
  const codes = ["not-started", "ready", "running", "waiting-verification",
    "waiting-user-decision", "completed", "stopped-failed"];
  codes.forEach((c) => assert.ok(orderBlock.includes(`"${c}"`), `column ${c} in frozen order`));
  const matches = orderBlock.match(/"(not-started|ready|running|waiting-verification|waiting-user-decision|completed|stopped-failed)"/g) ?? [];
  assert.equal(matches.length, 7, "exactly seven column codes");
  assert.ok(wcc.includes("workColumnStopped"), "stopped/failed column is a plain label");
});

test("Hub Plan lanes lead with completed, blocker, and next action like Goals", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const plan = extractFunctionSource(src, "renderWorkPlanLane");
  assert.ok(plan.includes("appendWorkLaneNarrative(facts, summary"), "Plan header uses shared lane narration");
  assert.ok(plan.includes("workProgressCompact"), "percentage is secondary supporting evidence");
  const narrative = extractFunctionSource(src, "appendWorkLaneNarrative");
  assert.ok(narrative.includes("summary.whatCompleted") || narrative.includes("summary && summary.whatCompleted"),
    "narration reads whatCompleted without mutating it");
  assert.ok(narrative.includes("workGoalOutcome"), "what-happened uses a plain-language label");
  assert.ok(narrative.includes("workGoalBlocker"), "blocker uses a plain-language label");
  assert.ok(narrative.includes("workGoalNext"), "next action uses a plain-language label");
  assert.ok(narrative.includes("workLaneHasRealBlocker"), "empty/fallback blockers are not forced into the header");
  // Goal and Plan headers are flat bands; the Task card is the only card object.
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const laneToggle = css.slice(css.indexOf(".work-lane-toggle {"), css.indexOf(".work-lane-toggle:hover"));
  assert.ok(!laneToggle.includes("var(--shadow-soft)"), "lane headers are flat bands, not shadowed cards");
  assert.match(laneToggle, /border-bottom:\s*1px solid var\(--line\)/, "lane headers use quiet rules");
});

test("Hub Work adapter consumes only schemaVersion 1 and fails visibly otherwise", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const adapter = extractFunctionSource(src, "normalizeWorkHierarchy");
  assert.ok(adapter.includes("schemaVersion !== 1"), "rejects unsupported schema");
  assert.ok(adapter.includes("WORK_COLUMN_CODES"), "validates against the frozen column list");
  assert.ok(adapter.includes("columns invalid"), "rejects a missing/extra column set");
  assert.ok(adapter.includes("column order invalid"), "rejects a reordered column set");
  // rWork renders an honest error box when the adapter rejects the projection.
  const rw = extractFunctionSource(src, "rWork");
  assert.ok(rw.includes("normalizeWorkHierarchy"), "rWork validates through the adapter");
  assert.ok(rw.includes('data-fl-role", "work-hierarchy-error"'), "unsupported projection fails visibly");
});

test("Hub Work filters request the Core-filtered endpoint and never flatten ancestry", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const query = extractFunctionSource(src, "workHierarchyQuery");
  assert.ok(query.includes("S.workFilter"), "query reads the applied filter only");
  assert.ok(query.includes("encodeURIComponent(S.workFilter.project)"), "project filter is sent");
  assert.ok(query.includes("workerProfileId="), "Worker filter is sent");
  assert.ok(query.includes("column="), "status column filter is sent");
  const apply = extractFunctionSource(src, "workApplyFilter");
  assert.ok(apply.includes("S.workFilterDraft"), "form draft is kept for re-render");
  assert.ok(apply.includes("S.workFilter = f"), "applied filter is stored");
  assert.ok(apply.includes("refresh()"), "Apply triggers one server request, not per keystroke");
  const reset = extractFunctionSource(src, "workResetFilter");
  assert.ok(reset.includes("S.workFilter = {}"), "Reset restores the complete hierarchy");
  assert.ok(reset.includes("refresh()"), "Reset re-requests the unfiltered hierarchy");
  // SLICE_MAP binds the hierarchy slice to the endpoint with the query builder.
  assert.ok(/workHierarchy\s*:\s*\{\s*endpoint:\s*"\/api\/ops\/work-hierarchy"/.test(src), "hierarchy slice bound");
  assert.ok(src.includes("buildQuery: workHierarchyQuery"), "slice uses the query builder");
  // The renderer keeps Goal and Plan lanes even when only one Task matches.
  assert.ok(src.includes('workRefreshFilterOptions'), "filter options are refreshed from unfiltered projections");
});

test("Hub authenticates onto Work as the only default work surface", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const html = await readFile(path.join(hubPublic, "index.html"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  // Initial state: Work is active in both HTML chrome and JS state.
  assert.match(src, /tab:\s*"work"/, "S.tab defaults to work");
  assert.ok(!src.includes('tab: "overview"'), "S.tab no longer defaults to overview");
  assert.match(
    html,
    /data-tab="work"\s+class="nav-item active"/,
    "HTML marks Work as the active primary-nav item",
  );
  assert.ok(!html.includes('data-tab="overview"'), "Overview is not a primary-nav peer");
  // Only one Work entry in primary navigation; Configure + secondary Operate remain.
  const workNavMatches = html.match(/data-tab="work"/g) || [];
  assert.equal(workNavMatches.length, 1, "exactly one Work primary-nav entry");
  for (const keep of ["model", "worker", "mains", "delivery", "competitions", "stats"]) {
    assert.ok(html.includes(`data-tab="${keep}"`), `${keep} stays reachable in primary nav`);
  }
  // Initial localized chrome matches Work page metadata (zh-CN default shell).
  assert.ok(html.includes('id="fl-page-title"') && html.includes(">工作<"), "initial page title is Work");
  assert.ok(html.includes("统一的目标 → 计划 → 任务看板，含阻塞与下一步"), "initial page sub is Work");
  assert.ok(i18n.includes('work: { title: "Work"'), "English Work title remains truthful");
  assert.ok(i18n.includes('work: { title: "工作"'), "Chinese Work title remains truthful");
  // First refresh requests Work hierarchy/intake slices via the default tab fallback.
  assert.ok(src.includes('requestPlan(S.tab || "work")'), "refresh falls back to Work deps");
  assert.ok(src.includes('pageMeta(S.tab || "work")'), "chrome falls back to Work metadata");
  assert.ok(src.includes('var tab = S.tab || "work"'), "render falls back to Work");
  // Keyboard/focus order follows visible primary nav: Work is the first Operate item.
  const operateLabel = html.indexOf('data-i18n="navOperate"');
  const workBtn = html.indexOf('data-tab="work"');
  const competeBtn = html.indexOf('data-tab="competitions"');
  assert.ok(operateLabel > 0 && workBtn > operateLabel, "Work follows the Operate group label");
  assert.ok(competeBtn > workBtn, "Compete follows Work in focus order");
});

test("Hub legacy peer pages redirect to the single Work surface", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const html = await readFile(path.join(hubPublic, "index.html"), "utf8");
  assert.ok(src.includes("LEGACY_TAB_REDIRECT"), "legacy redirect map exists");
  for (const legacy of ["overview", "board", "tasks", "plans", "goals"]) {
    assert.ok(src.includes(`${legacy}: "work"`), `${legacy} redirects to work`);
  }
  const st = extractFunctionSource(src, "switchTab");
  assert.ok(st.includes("LEGACY_TAB_REDIRECT[name]"), "switchTab consults the redirect map");
  assert.ok(st.includes("render()"), "switchTab renders immediately");
  assert.ok(st.includes("refresh()"), "switchTab fetches the new page");
  assert.ok(html.includes('data-tab="work"'), "one Work nav entry");
  assert.ok(
    !html.includes('data-tab="overview"')
      && !html.includes('data-tab="tasks"')
      && !html.includes('data-tab="plans"')
      && !html.includes('data-tab="goals"'),
    "Overview and peer Board/Plans/Goals nav are gone",
  );
  // Compatibility Overview implementation remains, but is not a peer primary view.
  assert.ok(src.includes("function rOverview("), "Overview renderer kept as bounded compatibility");
  assert.ok(src.includes('case "overview":'), "Overview case remains for non-switchTab safety");
  // Legacy detail APIs and the legacy submission page remain functional.
  assert.ok(src.includes("function showPlanBoard("), "Plan detail deep link remains");
  assert.ok(src.includes("function showGoalDetail("), "Goal detail deep link remains");
  assert.ok(src.includes("function showTask("), "Task detail deep link remains");
  assert.ok(src.includes('switchTab("tasks", { legacy: true })'), "legacy submission opens behind the Advanced action");
  assert.ok(src.includes('data-fl-role", "work-advanced-submit"') || src.includes('data-fl-role", "work-advanced"'),
    "Work Advanced entry remains for task-file submission");
  // The explicit Advanced path must not be swallowed by the legacy redirect.
  assert.ok(
    st.includes("opts && opts.legacy && LEGACY_TAB_REDIRECT[name]")
      || st.includes("opts && opts.legacy"),
    "switchTab preserves explicit legacy:true bypass for Advanced submission",
  );
});

test("Hub Task drawer breadcrumb is truthful about ancestry", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("function renderTaskBreadcrumb("), "breadcrumb renderer exists");
  const crumb = extractFunctionSource(src, "renderTaskBreadcrumb");
  assert.ok(crumb.includes("crumb.goalName"), "Goal segment requires a real Goal name");
  assert.ok(crumb.includes("crumb.planName"), "Plan segment requires a real Plan name");
  assert.ok(crumb.includes('taskReportBreadcrumb'), "no parent renders the plain Task report label");
  assert.ok(crumb.includes("task-breadcrumb"), "breadcrumb container class");
  assert.ok(crumb.includes("showGoalDetail"), "Goal segment opens the existing Goal detail");
  assert.ok(crumb.includes("showPlanBoard"), "Plan segment opens the existing Plan detail");
  // showTask accepts the clicked card's breadcrumb and retains it for reloads.
  const st = extractFunctionSource(src, "showTask");
  assert.ok(st.includes("function showTask(id, crumb)"), "showTask accepts a breadcrumb");
  assert.ok(st.includes("resolveTaskBreadcrumb"), "showTask resolves the retained breadcrumb");
  assert.ok(st.includes("renderTaskBreadcrumb(S.taskCrumb)"), "showTask renders the resolved breadcrumb");
});

test("Hub same-task reload keeps its bounded breadcrumb and other Tasks never inherit stale ancestry", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("function resolveTaskBreadcrumb("), "breadcrumb resolver exists");
  const fn = extractFunctionSource(src, "resolveTaskBreadcrumb");
  const resolve = new Function(`return (${fn});`)() as (
    prev: Record<string, unknown> | null,
    id: string,
    crumb?: Record<string, unknown>,
  ) => Record<string, unknown> | null;
  const crumb = { goalId: "g1", goalName: "Goal one", planId: "p1", planName: "Plan one", taskName: "Task A" };
  const first = resolve(null, "task-a", crumb);
  assert.equal(first?.goalName, "Goal one", "a clicked card stores its ancestry");
  assert.equal(first?.taskId, "task-a", "stored breadcrumb is keyed by task id");
  const sameReload = resolve(first, "task-a", undefined);
  assert.equal(sameReload?.goalName, "Goal one", "same-task reload keeps the original breadcrumb");
  assert.equal(resolve(first, "task-b", undefined), null, "a different Task never inherits stale parents");
  assert.equal(resolve(null, "task-a", undefined), null, "a direct link without ancestry shows Task only");
  const parentless = resolve(null, "task-a", { taskName: "Task A" });
  assert.equal(parentless?.goalName, undefined, "a parentless card stores no Goal segment");
  assert.equal(parentless?.planName, undefined, "a parentless card stores no Plan segment");
});

test("Hub Work cards show only decision evidence and never technical ids", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const card = extractFunctionSource(src, "renderWorkCard");
  assert.ok(card.includes("work-card-name"), "card leads with the Task name");
  assert.ok(card.includes("workPlacementLabel"), "card explains why it is in this column");
  assert.ok(card.includes("workCardBlocker"), "card names prerequisites in plain language");
  assert.ok(card.includes("workCardUnlocks"), "card names what it unlocks");
  assert.ok(card.includes("workCardNext"), "card states the next action");
  assert.ok(card.includes("workWorkerLabel"), "Worker label is resolved before display");
  // No raw id, token, command, endpoint, or result text becomes card copy.
  assert.ok(!card.includes("card.resultText") && !card.includes("card.error")
    && !card.includes("card.logs") && !card.includes("card.commands")
    && !card.includes("card.endpoint") && !card.includes("card.proxy"),
    "card never reads raw private fields");
  assert.ok(!card.includes("mono"), "card avoids technical mono ids");
  const wl = extractFunctionSource(src, "workWorkerLabel");
  assert.ok(wl.includes('return ""'), "missing profile label renders no Worker text");
  assert.ok(wl.includes("profiles[i].label"), "Worker label uses the profile label");
});

test("Hub Work lanes are keyboard-operable disclosures with bounded local collapse", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const goal = extractFunctionSource(src, "renderWorkGoalLane");
  assert.ok(goal.includes('aria-expanded'), "Goal lane exposes expanded state");
  assert.ok(goal.includes('aria-controls'), "Goal lane binds its body");
  assert.ok(goal.includes("workToggleLane"), "Goal lane wires the disclosure toggle");
  assert.ok(goal.includes("workGoalDefaultExpanded"), "Goal uses smart default expansion");
  const plan = extractFunctionSource(src, "renderWorkPlanLane");
  assert.ok(plan.includes('aria-expanded'), "Plan lane exposes expanded state");
  assert.ok(plan.includes('aria-controls'), "Plan lane binds its body");
  assert.ok(plan.includes("workPlanDefaultExpanded"), "Plan uses smart default expansion");
  const toggle = extractFunctionSource(src, "workToggleLane");
  assert.ok(toggle.includes("workCollapseSave"), "toggle saves bounded state");
  assert.ok(toggle.includes("aria-expanded"), "toggle updates aria-expanded");
  assert.ok(toggle.includes("collapse[key] = next"), "toggle stores an explicit boolean preference");
  const load = extractFunctionSource(src, "workCollapseLoad");
  assert.ok(load.includes("fl-work-collapse"), "collapse state uses one storage key");
  assert.ok(load.includes("sessionStorage"), "collapse state persists in the tab session, not localStorage");
  const expanded = extractFunctionSource(src, "workLaneExpanded");
  assert.ok(expanded.includes("hasOwnProperty"), "missing preference is distinct from false");
  assert.ok(expanded.includes("defaultExpanded"), "explicit preference wins over the smart default");
});

test("Hub Work default disclosure separates terminal history from current work", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const liveCodesStart = src.indexOf("var WORK_LIVE_COLUMN_CODES = [");
  assert.ok(liveCodesStart >= 0, "live column list ships");
  const liveCodes = src.slice(liveCodesStart, src.indexOf("];", liveCodesStart) + 2);
  const helpers = [
    "workLaneIsTerminalHistory",
    "workGoalDefaultExpanded",
    "workPlanDefaultExpanded",
    "workOneOffDefaultExpanded",
    "workLaneExpanded",
  ].map((name) => extractFunctionSource(src, name)).join("\n");
  const factory = new Function(`${liveCodes}\n${helpers}; return {
    workLaneIsTerminalHistory,
    workGoalDefaultExpanded,
    workPlanDefaultExpanded,
    workOneOffDefaultExpanded,
    workLaneExpanded,
  };`);
  const api = factory() as {
    workLaneIsTerminalHistory: (columns: Record<string, unknown[]> | null) => boolean;
    workGoalDefaultExpanded: (goal: Record<string, unknown>) => boolean;
    workPlanDefaultExpanded: (plan: Record<string, unknown>) => boolean;
    workOneOffDefaultExpanded: (lane: Record<string, unknown>) => boolean;
    workLaneExpanded: (
      collapse: Record<string, boolean>,
      kind: string,
      id: string,
      defaultExpanded: boolean,
    ) => boolean;
  };
  const emptyCols = {
    "not-started": [], ready: [], running: [],
    "waiting-verification": [], "waiting-user-decision": [],
    completed: [], "stopped-failed": [],
  };
  const terminalCols = {
    ...emptyCols,
    completed: [{ taskId: "t1" }],
    "stopped-failed": [{ taskId: "t2" }],
  };
  const liveCols = {
    ...emptyCols,
    running: [{ taskId: "t3" }],
  };
  assert.equal(api.workLaneIsTerminalHistory(terminalCols), true, "completed/stopped is terminal history");
  assert.equal(api.workLaneIsTerminalHistory(liveCols), false, "running is not terminal history");
  assert.equal(api.workGoalDefaultExpanded({
    status: "completed",
    plans: [{ columns: terminalCols }],
  }), false, "completed historical Goals start collapsed");
  assert.equal(api.workGoalDefaultExpanded({
    status: "stopped",
    plans: [{ columns: terminalCols }],
  }), false, "stopped historical Goals start collapsed");
  assert.equal(api.workGoalDefaultExpanded({
    status: "completed",
    plans: [{ columns: liveCols }],
  }), false, "terminal Goal authority keeps stale child work collapsed by default");
  assert.equal(api.workGoalDefaultExpanded({
    status: "running",
    plans: [{ columns: emptyCols }],
  }), true, "non-terminal Goals stay discoverable");
  assert.equal(api.workPlanDefaultExpanded({ columns: terminalCols }), false,
    "terminal Plan history starts collapsed");
  assert.equal(api.workPlanDefaultExpanded({ columns: liveCols }), true,
    "Plans with running work start open");
  assert.equal(api.workOneOffDefaultExpanded({ columns: terminalCols }), false,
    "historical one-off bulk starts collapsed");
  assert.equal(api.workOneOffDefaultExpanded({ columns: liveCols }), true,
    "one-off with live work starts open");
  assert.equal(api.workOneOffDefaultExpanded({
    columns: { ...emptyCols, "waiting-user-decision": [{ taskId: "t4" }] },
  }), false, "decision backlog stays summarized instead of flooding the initial page");
  assert.equal(api.workOneOffDefaultExpanded({
    columns: { ...emptyCols, "not-started": [{ taskId: "t5" }] },
  }), false, "queued backlog stays summarized instead of flooding the initial page");

  // Explicit tab-local preference always wins over the smart default.
  assert.equal(api.workLaneExpanded({}, "goal", "g1", false), false, "missing pref uses default collapsed");
  assert.equal(api.workLaneExpanded({}, "goal", "g1", true), true, "missing pref uses default open");
  assert.equal(api.workLaneExpanded({ "goal:g1": true }, "goal", "g1", false), true,
    "user expand overrides default collapsed");
  assert.equal(api.workLaneExpanded({ "goal:g1": false }, "goal", "g1", true), false,
    "user collapse overrides default open");

  const saved: string[] = [];
  const sessionStorage = {
    setItem(_k: string, v: string) { saved.push(v); },
  };
  // Bind workCollapseSave through a thin eval that uses this sessionStorage.
  const toggleSrc = extractFunctionSource(src, "workToggleLane");
  const expandedSrc = extractFunctionSource(src, "workLaneExpanded");
  const idSrc = extractFunctionSource(src, "workLaneId");
  const toggleFactory = new Function("sessionStorage", "document", `
    function workCollapseSave(collapse){
      try { sessionStorage.setItem("fl-work-collapse", JSON.stringify(collapse)); } catch(_){}
    }
    ${expandedSrc}
    ${idSrc}
    ${toggleSrc}
    return { workToggleLane, workLaneExpanded };
  `);
  const doc = { getElementById() { return { hidden: true }; } };
  const tog = toggleFactory(sessionStorage, doc) as {
    workToggleLane: (
      collapse: Record<string, boolean>,
      kind: string,
      id: string,
      btn: { setAttribute: (k: string, v: string) => void },
      defaultExpanded: boolean,
    ) => boolean;
    workLaneExpanded: (
      collapse: Record<string, boolean>,
      kind: string,
      id: string,
      defaultExpanded: boolean,
    ) => boolean;
  };
  const collapse: Record<string, boolean> = {};
  const attrs: Record<string, string> = {};
  const btn = { setAttribute(k: string, v: string) { attrs[k] = v; } };
  // Expand a default-collapsed historical lane; preference must persist as true.
  const next = tog.workToggleLane(collapse, "goal", "hist", btn, false);
  assert.equal(next, true, "toggle expands a default-collapsed lane");
  assert.equal(collapse["goal:hist"], true, "explicit expand is stored as true");
  assert.equal(attrs["aria-expanded"], "true");
  assert.equal(tog.workLaneExpanded(collapse, "goal", "hist", false), true,
    "refresh in the same tab keeps the expanded preference");
});

test("Hub One-off Tasks lane is an accessible disclosure with a calm historical default", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const oneOff = extractFunctionSource(src, "renderWorkOneOffLane");
  assert.ok(oneOff.includes('h("button"'), "one-off toggle is a native button");
  assert.ok(oneOff.includes("aria-expanded"), "one-off exposes expanded state");
  assert.ok(oneOff.includes("aria-controls"), "one-off binds its body");
  assert.ok(oneOff.includes("workOneOffDefaultExpanded"), "one-off uses the calm historical default");
  assert.ok(oneOff.includes("workOneOffCount"), "one-off summary shows the task count");
  assert.ok(oneOff.includes("ensureOneOffBody"), "complete card grid is deferred until expand");
  assert.ok(oneOff.includes("if(expanded) ensureOneOffBody()"), "open default still reveals the full set");
  assert.ok(oneOff.includes('workToggleLane(workCollapse, "one-off", "tasks"'),
    "one-off collapse preference is tab-local under one stable key");
  const rw = extractFunctionSource(src, "rWork");
  assert.ok(!rw.includes('h("div", "work-group-title", t("workOneOffTasks"))'),
    "one-off title lives on the disclosure, not a separate non-interactive heading");
});

test("Hub Project filter offers human labels and hides internal workspaces", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const helpers = [
    "workIsInternalProjectPath",
    "workProjectBaseName",
    "workProjectHumanLabel",
    "workPresentProjectOptions",
  ].map((name) => extractFunctionSource(src, name)).join("\n");
  const api = new Function(`${helpers}; return {
    workIsInternalProjectPath,
    workProjectBaseName,
    workProjectHumanLabel,
    workPresentProjectOptions,
  };`)() as {
    workIsInternalProjectPath: (p: string) => boolean;
    workProjectBaseName: (p: string) => string;
    workProjectHumanLabel: (p: string, siblings?: string[]) => string;
    workPresentProjectOptions: (paths: string[]) => {
      options: Array<{ value: string; label: string }>;
      omittedInternalCount: number;
    };
  };

  assert.equal(api.workIsInternalProjectPath("/Users/me/code/my-app"), false);
  assert.equal(api.workIsInternalProjectPath("/tmp/proj"), true, "/tmp is internal");
  assert.equal(api.workIsInternalProjectPath("/private/tmp/run"), true);
  assert.equal(api.workIsInternalProjectPath(
    "/Users/me/Library/Application Support/ForkLight/runs/abc/workspace"), true,
    "ForkLight run workspaces are internal");
  assert.equal(api.workIsInternalProjectPath(
    "/Users/me/.forklight/review-projects/graph-1/a1"), true,
    "review-projects are internal");
  assert.equal(api.workIsInternalProjectPath(
    "/Users/me/.forklight/samples/sample-1"), true,
    "onboarding samples are internal");
  assert.equal(api.workIsInternalProjectPath(
    "/repo/fixtures/checkout"), true,
    "test fixtures are internal");

  assert.equal(api.workProjectHumanLabel("/Users/me/code/my-app"), "my-app");
  assert.equal(api.workProjectHumanLabel("/Users/me/code/my-app", [
    "/Users/me/code/my-app",
    "/Users/other/work/my-app",
  ]), "code/my-app", "colliding basenames keep a short parent/base label");

  const presented = api.workPresentProjectOptions([
    "/Users/me/code/my-app",
    "/tmp/fixture-run",
    "/Users/me/Library/Application Support/ForkLight/runs/r1/workspace",
    "/Users/me/.forklight/review-projects/g1/a1",
    "/Users/me/code/other-app",
    "/Users/me/code/my-app",
  ]);
  assert.equal(presented.omittedInternalCount, 3, "internal paths are counted, not listed");
  assert.deepEqual(presented.options.map((o) => o.value).sort(), [
    "/Users/me/code/my-app",
    "/Users/me/code/other-app",
  ].sort(), "exact path remains the option value for the server request");
  assert.deepEqual(presented.options.map((o) => o.label).sort(), ["my-app", "other-app"].sort(),
    "visible labels are human project names");
  assert.ok(presented.options.every((o) => !o.label.startsWith("/") && !o.label.includes("/Users/") && !o.label.includes("/tmp")),
    "visible option text never shows raw absolute internal or user home paths");

  const filters = extractFunctionSource(src, "renderWorkFilters");
  assert.ok(filters.includes("workProjectHumanLabel"), "filter renders human labels");
  assert.ok(filters.includes("workFilterInternalProjectsOmitted"), "filter explains omitted internals");
  assert.ok(filters.includes('data-fl-role", "work-filter-internal-note"'),
    "omitted-internal explanation has a stable role");
  assert.ok(!filters.includes("workOption(p, p)"), "filter no longer uses the raw path as visible text");
  // Tasks stay on the unfiltered board: presentation only touches option lists.
  assert.ok(src.includes("workPresentProjectOptions"), "presentation helper exists");
  assert.ok(extractFunctionSource(src, "workRefreshFilterOptions").includes("workPresentProjectOptions"),
    "filter options refresh uses the presentation helper");
  assert.ok(!extractFunctionSource(src, "workCollectCards").includes("workIsInternalProjectPath"),
    "internal filter never removes Tasks from the board walk");
});

test("Hub Work copy is bilingual, explanation-first, and internal-vocabulary-free", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  assert.ok(src.includes('renderPageStory("work")'), "Work page still renders its purpose story");
  const enKeys = [
    "workFilterApply", "workFilterReset", "workColumnWaitingDecision",
    "workCardBlocker", "workCardNext", "workGoalDecision",
    "workIndependentPlans", "workOneOffTasks", "workUnsupportedHierarchy",
    "workFilterInternalProjectsOmitted", "workOneOffCount",
    "pageStoryWorkHow", "workFinishedWorkCount", "workNoFurtherAction",
  ];
  for (const key of enKeys) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  assert.ok(i18n.includes("Waiting for your decision"), "en column label is plain");
  assert.ok(i18n.includes("等待你的决定"), "zh column label is plain");
  assert.ok(i18n.includes("One-off tasks"), "en one-off lane is plain");
  assert.ok(i18n.includes("一次性任务"), "zh one-off lane is plain");
  assert.ok(i18n.includes("Hiding {count} internal ForkLight workspaces"),
    "en explains omitted internal project choices");
  assert.ok(i18n.includes("已从列表中隐藏 {count} 个 ForkLight 内部工作区"),
    "zh explains omitted internal project choices");
  assert.ok(i18n.includes("{count} tasks"), "en one-off count is plain");
  assert.ok(i18n.includes("{count} 个任务"), "zh one-off count is plain");
  assert.ok(i18n.includes("How this page works"), "en Work help disclosure title");
  assert.ok(i18n.includes("如何使用这个页面"), "zh Work help disclosure title");
  assert.ok(i18n.includes("Finished work ({count})"), "en finished-work group is plain");
  assert.ok(i18n.includes("已结束的工作（{count}）"), "zh finished-work group is plain");
  assert.ok(i18n.includes("What happened: {text}"), "en lane outcome is neutral");
  assert.ok(i18n.includes("发生了什么：{text}"), "zh lane outcome is neutral");
  assert.ok(i18n.includes("No further action needed"), "en completed no-action conclusion");
  assert.ok(i18n.includes("无需后续操作"), "zh completed no-action conclusion");
  // No raw status or dependency codes as primary Work copy.
  assert.ok(!i18n.includes("plan_dependencies"), "Work copy avoids the dependency code");
  assert.ok(!i18n.includes("work_hierarchy"), "Work copy avoids the internal method name");
  assert.ok(!src.includes('data-fl-role", "work-card"') || src.includes("card.breadcrumb"),
    "cards carry the hierarchy breadcrumb for the drawer");
});

// --- FL-108B: Work page explains itself without overwhelming ---

test("FL-108B Work-only help is a closed disclosure that retains every page-story slot", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  const story = extractFunctionSource(src, "renderPageStory");
  assert.ok(story.includes('page === "work"'), "Work branches into a disclosure");
  assert.ok(story.includes('data-fl-role", "page-story-disclosure"'), "disclosure role is stable");
  assert.ok(story.includes('data-fl-role", "page-story-disclosure-toggle"'), "toggle role is stable");
  assert.ok(story.includes('t("pageStoryWorkHow")'), "disclosure uses the How-this-page title");
  assert.ok(story.includes("details.appendChild(body)"), "purpose and flow live inside the disclosure");
  assert.ok(story.includes('data-fl-role", "page-story-purpose"'), "purpose slot retained");
  assert.ok(story.includes('page-story-" + item.slot'), "input/process/output/next slots retained");
  // Closed by default: no open attribute is set on the Work details element.
  assert.ok(!/details\.open\s*=\s*true/.test(story), "Work help is not forced open");
  assert.ok(!story.includes('setAttribute("open"'), "Work help has no open attribute");
  // Other pages still append purpose+flow directly (no Work-only disclosure).
  assert.ok(story.includes("card.appendChild(purpose)"), "non-Work pages keep always-open purpose");
  assert.ok(story.includes("card.appendChild(flow)"), "non-Work pages keep always-open flow");
  const rw = extractFunctionSource(src, "rWork");
  const outcomeAt = rw.indexOf("renderOutcomeSection()");
  const storyAt = rw.indexOf('renderPageStory("work")');
  const filtersAt = rw.indexOf("renderWorkFilters()");
  const boardAt = rw.indexOf('data-fl-role", "work-board"');
  assert.ok(outcomeAt > 0 && storyAt > outcomeAt && filtersAt > storyAt && boardAt > filtersAt,
    "Work order is outcome → compact help → filters → board");
  assert.ok(i18n.includes("How this page works") && i18n.includes("如何使用这个页面"),
    "bilingual help titles ship");
  assert.ok(css.includes(".page-story-disclosure"), "disclosure styles ship");
  assert.ok(css.includes(".page-story-disclosure-summary"), "summary line styles ship");
  assert.ok(!/page-story-disclosure[\s\S]{0,200}height:\s*\d+vh/.test(css),
    "help disclosure does not use fixed viewport heights");
});

test("FL-108B terminal Goals group into one counted, lazy Finished work disclosure", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(src.includes("function workGoalIsTerminalStatus("), "terminal status helper ships");
  assert.ok(src.includes("function renderWorkFinishedGoals("), "finished-work renderer ships");
  const isTerminal = extractFunctionSource(src, "workGoalIsTerminalStatus");
  assert.ok(isTerminal.includes('status === "completed"'), "completed is terminal");
  assert.ok(isTerminal.includes('status === "stopped"'), "stopped is terminal");
  assert.ok(isTerminal.includes('status === "failed"'), "failed is terminal");
  assert.ok(!isTerminal.includes("whatCompleted") && !isTerminal.includes("percent")
    && !isTerminal.includes("updatedAt") && !isTerminal.includes("columns"),
    "terminal partition never infers from copy, progress, dates, or Task columns");
  // Pure helper behavior for the closed status set only.
  const factory = new Function(`${isTerminal}; return workGoalIsTerminalStatus;`);
  const check = factory() as (status: string) => boolean;
  assert.equal(check("completed"), true);
  assert.equal(check("stopped"), true);
  assert.equal(check("failed"), true);
  assert.equal(check("running"), false);
  assert.equal(check("active"), false);
  assert.equal(check("pending"), false);
  const finished = extractFunctionSource(src, "renderWorkFinishedGoals");
  assert.ok(finished.includes('data-fl-role", "work-finished-group"'), "finished group role");
  assert.ok(finished.includes('data-fl-role", "work-finished-toggle"'), "finished toggle role");
  assert.ok(finished.includes("workFinishedWorkCount"), "count is shown in the summary");
  assert.ok(finished.includes("ensureFinishedBody"), "terminal lanes are lazy");
  assert.ok(finished.includes("renderWorkGoalLane(goal)"), "same Goal lane renderer when expanded");
  assert.ok(finished.includes("if(details.open) ensureFinishedBody()"),
    "lanes render only after the disclosure opens");
  const rw = extractFunctionSource(src, "rWork");
  assert.ok(rw.includes("workGoalIsTerminalStatus"), "rWork partitions by canonical status");
  assert.ok(rw.includes("activeGoals"), "active Goals are collected");
  assert.ok(rw.includes("terminalGoals"), "terminal Goals are collected");
  assert.ok(rw.includes("renderWorkFinishedGoals(terminalGoals)"), "terminal group is rendered");
  const activeAppend = rw.indexOf("activeGoals.forEach");
  const finishedAppend = rw.indexOf("renderWorkFinishedGoals");
  const indepAppend = rw.indexOf("work-independent-plans");
  const oneOffAppend = rw.indexOf("work-oneoff-tasks");
  assert.ok(activeAppend > 0 && finishedAppend > activeAppend,
    "active Goals render before the Finished work disclosure");
  assert.ok(indepAppend > finishedAppend && oneOffAppend > indepAppend,
    "independent plans and one-off stay after Goal groups");
  assert.ok(css.includes(".work-finished-group"), "finished group styles ship");
  assert.ok(!/work-finished-group[\s\S]{0,240}(max-height:\s*\d+vh|overflow:\s*hidden)/.test(css),
    "finished group does not clip or fix viewport height");
});

test("FL-108B lane narration is neutral, hides empty blockers, and calms completed next actions", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  assert.ok(src.includes("function workLaneHasRealBlocker("), "real-blocker helper ships");
  assert.ok(src.includes("function workLaneNextActionText("), "next-action presentation helper ships");
  assert.ok(src.includes("function appendWorkLaneNarrative("), "shared narrative helper ships");
  const hasBlocker = extractFunctionSource(src, "workLaneHasRealBlocker");
  assert.ok(hasBlocker.includes("No current blocker."),
    "only Core's explicit no-blocker fallback is suppressed by exact match");
  // Legacy path remains pure; coded path needs the closed maps in scope.
  const blockerPrelude = [
    "var WORK_NARRATIVE_EMPTY_BLOCKER_CODES = {\"lane-blocker-none\":true,\"goal-wait-all-gates-satisfied\":true,\"goal-wait-nothing\":true};",
    "var WORK_NARRATIVE_I18N_KEYS = {\"lane-blocker-blocked\":\"k\",\"goal-wait-machine\":\"k\"};",
  ].join("\n");
  const blockerFactory = new Function(`${blockerPrelude}; ${hasBlocker}; return workLaneHasRealBlocker;`);
  const realBlocker = blockerFactory() as (
    blocker: unknown,
    blockerMessage?: { code?: string },
  ) => boolean;
  assert.equal(realBlocker(""), false, "empty blocker is hidden");
  assert.equal(realBlocker(null), false, "null blocker is hidden");
  assert.equal(realBlocker("No current blocker."), false, "Core fallback is hidden");
  assert.equal(realBlocker("Waiting: Task A."), true, "real blockers stay visible");
  assert.equal(realBlocker("x", { code: "lane-blocker-none" }), false, "coded empty blocker is hidden");
  assert.equal(realBlocker("x", { code: "lane-blocker-blocked" }), true, "coded real blocker is shown");
  assert.equal(realBlocker("x", { code: "future-unknown-code" }), true,
    "unrecognized blocker codes stay displayable for fail-closed unavailable copy");
  const nextSrc = extractFunctionSource(src, "workLaneNextActionText");
  const narrSrc = extractFunctionSource(src, "workNarrativeText");
  const safeSrc = extractFunctionSource(src, "workSafeNarrativeParams");
  // Bind t() and the coded renderer for pure evaluation of the presentation helper.
  const nextFactory = new Function(
    "t",
    `var WORK_NARRATIVE_I18N_KEYS = ${JSON.stringify({
      "goal-next-none": "workNarrGoalNextNone",
      "card-next-waiting-main-decision": "workNarrCardNextWaitingMainDecision",
    })};
     ${safeSrc};
     ${narrSrc};
     ${nextSrc};
     return workLaneNextActionText;`,
  );
  const nextText = nextFactory((key: string, vars?: Record<string, string>) => {
    if (!vars) return key;
    return Object.keys(vars).reduce((s, k) => s.split(`{${k}}`).join(vars[k]!), key);
  }) as (
    summary: {
      nextAction?: string;
      whatCompleted?: string;
      nextActionMessage?: { code: string; params?: Record<string, string | number> };
    },
    opts?: { completedNoDecision?: boolean },
  ) => string;
  assert.equal(
    nextText({ nextAction: "", whatCompleted: "Goal finished." }, { completedNoDecision: true }),
    "workNoFurtherAction",
    "empty completed next action becomes no-action conclusion",
  );
  assert.equal(
    nextText({ nextAction: "Goal finished.", whatCompleted: "Goal finished." }, { completedNoDecision: true }),
    "workNoFurtherAction",
    "duplicate completed outcome is not repeated as next action",
  );
  assert.equal(
    nextText({ nextAction: "Inspect the failed Task.", whatCompleted: "Worker failed." }, { completedNoDecision: true }),
    "Inspect the failed Task.",
    "real next actions stay visible even on completed Goals",
  );
  assert.equal(
    nextText({ nextAction: "", whatCompleted: "Still running." }, {}),
    "workNoNext",
    "active empty next action keeps the ordinary no-next label",
  );
  assert.equal(
    nextText({
      nextAction: "Every milestone gate is satisfied.",
      nextActionMessage: { code: "goal-next-none" },
    }, { completedNoDecision: true }),
    "workNoFurtherAction",
    "coded none next action calms completed Goals without reading English prose",
  );
  const narrative = extractFunctionSource(src, "appendWorkLaneNarrative");
  assert.ok(narrative.includes("workGoalOutcome"), "what-happened label is used");
  assert.ok(narrative.includes("workNarrativeText"), "lane narration uses the coded renderer");
  assert.ok(narrative.includes("completedNoDecision"), "completed-no-decision path is presentation-only");
  assert.ok(!narrative.includes("summary.whatCompleted =") && !narrative.includes("summary.blocker =")
    && !narrative.includes("summary.nextAction ="),
    "narration never mutates canonical summary fields");
  const goal = extractFunctionSource(src, "renderWorkGoalLane");
  assert.ok(goal.includes("appendWorkLaneNarrative"), "Goal lane uses shared narration");
  assert.ok(goal.includes('goal.status === "completed"') && goal.includes("decisionCount === 0"),
    "completed-no-decision is derived from status + decision count only");
  assert.match(enSection, /workGoalOutcome['"]?\s*:\s*["']What happened:/);
  assert.match(zhSection, /workGoalOutcome['"]?\s*:\s*["']发生了什么：/);
  assert.ok(enSection.includes("workNoFurtherAction") && zhSection.includes("workNoFurtherAction"));
  assert.ok(!enSection.includes("Done: {text}"), "en no longer labels every summary as Done");
  assert.ok(!zhSection.includes("已完成：{text}"), "zh no longer labels every summary as completed work");
});

test("FL-108C1 Work narrative is code-driven, bilingual, and fails closed", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  assert.ok(src.includes("function workNarrativeText("), "coded narrative renderer ships");
  assert.ok(src.includes("var WORK_NARRATIVE_I18N_KEYS"), "closed code→key map ships");
  assert.ok(src.includes("workNarrUnavailable"), "fail-closed copy key is referenced");
  // Hub must not choose lifecycle copy by matching English prose.
  const narrSrc = extractFunctionSource(src, "workNarrativeText");
  const appendSrc = extractFunctionSource(src, "appendWorkLaneNarrative");
  const cardSrc = extractFunctionSource(src, "renderWorkCard");
  const oneOffSrc = extractFunctionSource(src, "renderWorkOneOffLane");
  for (const banned of [
    "Every milestone gate is satisfied",
    "Main stopped this Goal",
    "Goal is stopped; future Task admission is blocked",
    "Waiting for a Main decision",
    ".match(",
    "RegExp",
    "includes(\"Every",
    "includes('Every",
  ]) {
    assert.ok(!narrSrc.includes(banned), `workNarrativeText must not contain prose parse: ${banned}`);
    assert.ok(!appendSrc.includes(banned), `appendWorkLaneNarrative must not contain prose parse: ${banned}`);
  }
  assert.ok(cardSrc.includes("workNarrativeText"), "cards render next action via codes");
  assert.ok(oneOffSrc.includes("workNarrativeText"), "one-off lane renders next action via codes");

  // Evaluate the pure renderer with a tiny i18n stand-in.
  const safeSrc = extractFunctionSource(src, "workSafeNarrativeParams");
  const keys = {
    "goal-what-completed": "workNarrGoalWhatCompleted",
    "goal-what-main-stop": "workNarrGoalWhatMainStop",
    "goal-wait-admission-blocked": "workNarrGoalWaitAdmissionBlocked",
    "card-next-waiting-main-decision": "workNarrCardNextWaitingMainDecision",
    "lane-what-completed-names": "workNarrLaneWhatCompletedNames",
    "card-what-delivered": "workNarrCardWhatDelivered",
    "card-next-goal-gate-satisfied": "workNarrCardNextGoalGateSatisfied",
  };
  const strings: Record<string, string> = {
    workNarrUnavailable: "STATUS_UNAVAILABLE",
    workNarrGoalWhatCompleted: "所有计划步骤均已完成。",
    workNarrGoalWhatMainStop: "Main 已停止此目标。",
    workNarrGoalWaitAdmissionBlocked: "不会启动新任务；正在运行的任务保留其现有控制。",
    workNarrCardNextWaitingMainDecision: "正在等待 Main 做决定。",
    workNarrLaneWhatCompletedNames: "已完成：{names}。",
    workNarrLaneWhatCompletedNamesExtra: "已完成：{names}（另有 {extraCount} 项）。",
    workNarrCardWhatDelivered: "{name} 已交付。",
    workNarrCardNextGateMachine: "自动检查已通过。",
    workNarrCardNextGateMainAccept: "Main 已确认结果。",
    workNarrCardNextGateIntegration: "已接受的结果已安全应用。",
    workNarrCardNextGateIntegrationOriginal: "Main 修复源码并按原有验收规则重新检查后，已安全应用。",
    workNarrCardNextGateIntegrationAmended: "Main 修复源码并按修正后的验收规则重新检查后，已安全应用。",
    workNarrCardNextGoalGateSatisfied: "此里程碑已完成。",
    workNarrGateUnknown: "未知",
  };
  const factory = new Function(
    "t",
    `var WORK_NARRATIVE_I18N_KEYS = ${JSON.stringify(keys)};
     ${safeSrc};
     ${narrSrc};
     return workNarrativeText;`,
  );
  const render = factory((key: string, vars?: Record<string, string>) => {
    let out = strings[key] ?? key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        out = out.split(`{${k}}`).join(String(vars[k]));
      });
    }
    return out;
  }) as (
    msg: { code: string; params?: Record<string, string | number> } | null | undefined,
    legacy?: string,
  ) => string;

  // Chinese completed / stopped / one-off decision — no English lifecycle leak.
  assert.equal(render({ code: "goal-what-completed" }, "Every milestone gate is satisfied."),
    "所有计划步骤均已完成。");
  assert.equal(render({ code: "goal-what-main-stop" }, "Main stopped this Goal."),
    "Main 已停止此目标。");
  assert.equal(render({ code: "goal-wait-admission-blocked" },
    "Goal is stopped; future Task admission is blocked."),
  "不会启动新任务；正在运行的任务保留其现有控制。");
  assert.equal(render({ code: "card-next-waiting-main-decision" }, "Waiting for a Main decision."),
    "正在等待 Main 做决定。");
  // User-authored name preserved inside localized shell.
  assert.equal(render({ code: "card-what-delivered", params: { name: "结算修复" } }, "x"),
    "结算修复 已交付。");
  assert.equal(
    render({ code: "lane-what-completed-names", params: { names: "A, B", extraCount: 2 } }, "x"),
    "已完成：A, B（另有 2 项）。",
  );
  assert.equal(render({ code: "card-next-goal-gate-satisfied", params: { gate: "machine" } }, "x"),
    "自动检查已通过。");
  // Unrecognized code fails closed: no raw code, no success claim, no legacy English.
  const unknown = render({ code: "future-core-code-v99" }, "Every milestone gate is satisfied.");
  assert.equal(unknown, "STATUS_UNAVAILABLE");
  assert.ok(!unknown.includes("future-core-code-v99"), "raw code never shown");
  assert.ok(!unknown.includes("Every milestone"), "legacy English not used for unknown codes");
  assert.ok(!/satisfied|completed|success/i.test(unknown), "unknown codes invent no success");
  // Unrecognized blocker narrative is displayable and fails closed to unavailable.
  const unknownBlocker = render(
    { code: "future-blocker-code-v99" },
    "Waiting: Task A.",
  );
  assert.equal(unknownBlocker, "STATUS_UNAVAILABLE",
    "unrecognized blocker message renders localized unavailable copy");
  assert.ok(!unknownBlocker.includes("future-blocker-code-v99"), "raw blocker code never shown");
  assert.ok(!unknownBlocker.includes("Waiting:"), "legacy English blocker not used for unknown codes");
  assert.ok(!/satisfied|completed|success/i.test(unknownBlocker), "unknown blocker invents no success");
  // Absent coded message preserves legacy compatibility.
  assert.equal(render(null, "Legacy technical evidence."), "Legacy technical evidence.");
  assert.equal(render(undefined, "  "), "");

  // workSafeNarrativeParams: Core-equivalent bounds (8 keys, 200 chars, safe int 0..1e6).
  const safeFactory = new Function(`${safeSrc}; return workSafeNarrativeParams;`);
  const safeParams = safeFactory() as (
    params: Record<string, unknown> | null | undefined,
  ) => Record<string, string | number>;
  const nineKeys: Record<string, string> = {};
  for (let i = 0; i < 9; i += 1) nineKeys[`k${i}`] = `v${i}`;
  const capped = safeParams(nineKeys);
  assert.equal(Object.keys(capped).length, 8, "at most 8 own keys accepted");
  assert.equal(capped.k8, undefined, "ninth key is omitted");
  assert.equal(capped.k0, "v0", "first valid keys are retained");
  const long = "x".repeat(250);
  const sliced = safeParams({ name: long });
  assert.equal(String(sliced.name).length, 200, "strings are sliced to 200 chars");
  assert.equal(sliced.name, long.slice(0, 200), "string prefix is preserved");
  const nums = safeParams({
    ok: 0,
    mid: 42,
    max: 1_000_000,
    over: 1_000_001,
    neg: -1,
    float: 1.5,
    nan: Number.NaN,
    inf: Number.POSITIVE_INFINITY,
    bool: true as unknown as number,
  });
  assert.equal(nums.ok, 0, "zero is accepted");
  assert.equal(nums.mid, 42, "safe positive int is accepted");
  assert.equal(nums.max, 1_000_000, "upper bound 1_000_000 is accepted");
  assert.equal(nums.over, undefined, "oversize int is omitted");
  assert.equal(nums.neg, undefined, "negative is omitted");
  assert.equal(nums.float, undefined, "float is omitted");
  assert.equal(nums.nan, undefined, "NaN is omitted");
  assert.equal(nums.inf, undefined, "Infinity is omitted");
  assert.equal((nums as Record<string, unknown>).bool, undefined, "boolean is omitted");
  assert.deepEqual(safeParams(null), {}, "null params yield empty object");
  assert.deepEqual(safeParams(undefined), {}, "undefined params yield empty object");
  assert.deepEqual(safeParams({ empty: "" }), {}, "empty strings are omitted");
  // Valid params still reach interpolation after bounding.
  assert.equal(
    render({
      code: "card-what-delivered",
      params: {
        name: "结算修复",
        noise: -3,
        extra1: 1,
        extra2: 2,
        extra3: 3,
        extra4: 4,
        extra5: 5,
        extra6: 6,
        extra7: 7,
        dropMe: "ninth",
      },
    }, "x"),
    "结算修复 已交付。",
    "valid name still renders; invalid/excess params never break interpolation",
  );

  // Bilingual keys exist for the measured defect sentences and fail-closed copy.
  for (const key of [
    "workNarrUnavailable",
    "workNarrGoalWhatCompleted",
    "workNarrGoalWhatMainStop",
    "workNarrGoalWaitAdmissionBlocked",
    "workNarrCardNextWaitingMainDecision",
    "workNarrLaneWhatCompletedNamesExtra",
    "workNarrCardNextNeedsRecovery",
    "workNarrLaneNextNoStep",
  ]) {
    assert.ok(enSection.includes(`${key}:`), `en has ${key}`);
    assert.ok(zhSection.includes(`${key}:`), `zh has ${key}`);
  }
  assert.ok(zhSection.includes("所有计划步骤均已完成。"), "zh completed Goal copy");
  assert.ok(zhSection.includes("Main 已停止此目标"), "zh main-stop copy");
  assert.ok(zhSection.includes("不会启动新任务；正在运行的任务保留其现有控制。"), "zh admission-blocked copy");
  assert.ok(zhSection.includes("正在等待 Main 做决定。"), "zh Main-decision copy");
  assert.ok(zhSection.includes("此视图暂时无法提供状态说明。"), "zh fail-closed copy");
  // English keys keep the plain meaning for en locale.
  assert.ok(enSection.includes("All planned steps are complete."), "en completed Goal copy");
  assert.ok(enSection.includes("Waiting for Main to decide."), "en Main-decision copy");
});

test("FL-108C2 Work narrative is plain language and bilingual for every closed code", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  const extract = (section: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const re = /\b(workNarr[A-Za-z0-9]+):\s*"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(section)) !== null) {
      out[m[1]!] = m[2]!;
    }
    return out;
  };
  const en = extract(enSection);
  const zh = extract(zhSection);

  // Completeness: every FL-108C1 narrative key ships in both locales.
  const keys = Object.keys(en);
  assert.ok(keys.length > 55, "workNarr block retains its full key set");
  for (const key of keys) {
    assert.ok(zh[key] !== undefined, `zh has ${key}`);
    assert.ok(en[key]!.trim().length > 0, `en ${key} is non-empty`);
    assert.ok(zh[key]!.trim().length > 0, `zh ${key} is non-empty`);
  }
  for (const key of Object.keys(zh)) {
    assert.ok(en[key] !== undefined, `en has ${key}`);
  }

  // Guard: default Work narration never ships the measured internal phrases.
  const bannedEn = [
    "milestone gate",
    "Task admission",
    "Task authority",
    "Worker slot",
    "exact Candidate",
    "Main action",
    "Machine gate",
    "Main-accept gate",
    "Integration gate",
    "machine verification",
  ];
  const bannedZh = [
    "里程碑闸门",
    "Task 准入",
    "Task 权限",
    "Worker 槽位",
    "精确候选",
    "Main 动作",
    "机器闸门",
    "Main 接受闸门",
    "合入闸门",
    "Main 接受",
    "机器验收",
  ];
  for (const key of keys) {
    for (const phrase of bannedEn) {
      assert.ok(!en[key]!.includes(phrase), `en ${key} must not say "${phrase}": ${en[key]}`);
    }
    for (const phrase of bannedZh) {
      assert.ok(!zh[key]!.includes(phrase), `zh ${key} must not say "${phrase}": ${zh[key]}`);
    }
  }

  // Measured live strings and representative active states read plainly in both locales.
  const fixtures: Array<{ key: string; en: string; zh: string }> = [
    { key: "workNarrGoalWhatCompleted", en: "All planned steps are complete.", zh: "所有计划步骤均已完成。" },
    { key: "workNarrGoalWhatMainStop", en: "Main stopped this Goal.", zh: "Main 已停止此目标。" },
    { key: "workNarrGoalWhatCorrectionCap", en: "The correction limit for this Goal was reached.", zh: "此目标的修正次数已达上限。" },
    { key: "workNarrGoalWhatReviewCap", en: "The review limit for this Goal was reached.", zh: "此目标的审查轮次已达上限。" },
    { key: "workNarrGoalWhatNoNewEvidenceCap", en: "This Goal advanced too many times without new evidence, so it was stopped.", zh: "此目标在没有新证据的情况下推进次数过多，因此已停止。" },
    { key: "workNarrGoalWhatDurationExceeded", en: "This Goal reached its total time limit.", zh: "此目标已达到总时长上限。" },
    { key: "workNarrGoalWhatNoProgress", en: "This Goal made no progress within the allowed time.", zh: "此目标在允许的时间内没有进展。" },
    { key: "workNarrGoalWhatMilestoneFailed", en: "A milestone task in this Goal failed.", zh: "此目标中的某个里程碑任务失败。" },
    { key: "workNarrGoalWaitAdmissionBlocked", en: "No new tasks will start; running tasks keep their existing controls.", zh: "不会启动新任务；正在运行的任务保留其现有控制。" },
    { key: "workNarrGoalWaitMachine", en: "Waiting for automatic checks to pass on this milestone.", zh: "正在等待此里程碑的自动检查通过。" },
    { key: "workNarrGoalWaitMainAccept", en: "Waiting for Main to confirm the result of this milestone.", zh: "正在等待 Main 确认此里程碑的结果。" },
    { key: "workNarrGoalWaitIntegration", en: "Waiting for the accepted result to be safely applied to the project.", zh: "正在等待已接受的结果安全应用到项目。" },
    { key: "workNarrGoalWaitTask", en: "Waiting for the linked task to finish or become ready.", zh: "正在等待关联任务完成或变为就绪。" },
    { key: "workNarrGoalNextWaitForWorker", en: "Wait for execution capacity and automatic checks to finish", zh: "等待执行容量可用且自动检查完成" },
    { key: "workNarrGoalNextMainAccept", en: "Confirm and accept this result", zh: "确认并接受此结果" },
    { key: "workNarrGoalNextMainReview", en: "Confirm, revise, or reject this result", zh: "确认、返工或拒绝此结果" },
    { key: "workNarrGoalNextIntegrate", en: "Run a safety check, then approve applying the result", zh: "运行安全检查，然后批准应用结果" },
    { key: "workNarrGoalNextCorrectOrDecide", en: "Inspect the failed task, then correct, revise, or stop", zh: "检查失败的任务，然后选择修正、返工或停止" },
    { key: "workNarrGoalNextStopOrDecide", en: "Inspect the outcome, then decide whether to correct it, adjust a limit, or leave it as is", zh: "查看结果，然后决定是修正它、调整限额，还是保持现状" },
    { key: "workNarrGoalNextResumeTask", en: "Resume the interrupted task", zh: "恢复被中断的任务" },
    { key: "workNarrGoalNextNone", en: "No decision needed right now", zh: "当前无需做决定" },
    { key: "workNarrCardWhatDelivered", en: "{name} delivered.", zh: "{name} 已交付。" },
    { key: "workNarrCardNextReady", en: "Ready to run when execution capacity is available.", zh: "执行容量可用时即可运行。" },
    { key: "workNarrCardNextRunning", en: "A worker is executing this task.", zh: "Worker 正在执行此任务。" },
    { key: "workNarrCardNextWaitingVerification", en: "Waiting for automatic checks to pass.", zh: "正在等待自动检查通过。" },
    { key: "workNarrCardNextWaitingMainDecision", en: "Waiting for Main to decide.", zh: "正在等待 Main 做决定。" },
    { key: "workNarrCardNextNeedsRecovery", en: "Needs Main attention or recovery.", zh: "需要 Main 关注或恢复。" },
    { key: "workNarrCardNextGateMachine", en: "Automatic checks passed.", zh: "自动检查已通过。" },
    { key: "workNarrCardNextGateMainAccept", en: "Main confirmed the result.", zh: "Main 已确认结果。" },
    { key: "workNarrCardNextGateIntegration", en: "The accepted result was safely applied.", zh: "已接受的结果已安全应用。" },
  ];
  for (const fx of fixtures) {
    assert.equal(en[fx.key], fx.en, `en ${fx.key} matches plain-language fixture`);
    assert.equal(zh[fx.key], fx.zh, `zh ${fx.key} matches plain-language fixture`);
  }

  // Stopped reasons stay distinct: each what-line names its own cause, never a repeat-stop.
  const stoppedWhat = [
    en.workNarrGoalWhatMainStop!,
    en.workNarrGoalWhatCorrectionCap!,
    en.workNarrGoalWhatReviewCap!,
    en.workNarrGoalWhatNoNewEvidenceCap!,
    en.workNarrGoalWhatDurationExceeded!,
    en.workNarrGoalWhatNoProgress!,
    en.workNarrGoalWhatMilestoneFailed!,
  ];
  assert.equal(new Set(stoppedWhat).size, stoppedWhat.length, "stopped causes are not flattened");
  for (const line of stoppedWhat) {
    assert.ok(!/stop this goal/i.test(line), `stopped what-line must not ask to stop again: ${line}`);
  }
  // The shared stop-or-decide next step fits both terminal stopped and waiting cap Goals.
  assert.ok(!/stop|retry/i.test(en.workNarrGoalNextStopOrDecide!),
    "shared next step never re-asks to stop and implies no automatic retry");
  assert.ok(!zh.workNarrGoalNextStopOrDecide!.includes("停止"),
    "zh shared next step never re-asks to stop");
  // Gate-satisfied next actions name the concrete condition, never a raw gate code.
  for (const key of ["workNarrCardNextGateMachine", "workNarrCardNextGateMainAccept", "workNarrCardNextGateIntegration"]) {
    assert.ok(!en[key]!.includes("{gate}"), `en ${key} must not interpolate a raw gate param`);
    assert.ok(!zh[key]!.includes("{gate}"), `zh ${key} must not interpolate a raw gate param`);
  }
  // Three generic gate-param templates stay concrete (no raw {gate} placeholder).
  for (const key of ["workNarrGoalWhatMilestoneSatisfied", "workNarrCardWhatGoalGateComplete", "workNarrCardNextGoalGateSatisfied"]) {
    assert.ok(!en[key]!.includes("{gate}"), `en ${key} must not interpolate a raw gate param`);
    assert.ok(!zh[key]!.includes("{gate}"), `zh ${key} must not interpolate a raw gate param`);
  }
  // Waiting states name what is waited for and who/what moves it forward.
  assert.ok(en.workNarrGoalWaitMachine!.includes("automatic checks") && en.workNarrGoalWaitMainAccept!.includes("Main"),
    "en waiting states name the concrete handoff");
  assert.ok(zh.workNarrGoalWaitMachine!.includes("自动检查") && zh.workNarrGoalWaitMainAccept!.includes("Main"),
    "zh waiting states name the concrete handoff");
});

test("FL-108B Work composition stays presentation-only with no Core lifecycle mutation", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const helpers = [
    "workGoalIsTerminalStatus",
    "workLaneHasRealBlocker",
    "workLaneNextActionText",
    "appendWorkLaneNarrative",
    "renderWorkFinishedGoals",
  ].map((name) => extractFunctionSource(src, name)).join("\n");
  for (const banned of [
    "fetch(",
    "S.workHierarchy",
    "goal.status =",
    "summary.blocker =",
    "summary.nextAction =",
    "summary.whatCompleted =",
    "/api/ops/",
    "localStorage",
  ]) {
    assert.ok(!helpers.includes(banned), `presentation helpers must not contain ${banned}`);
  }
  const rw = extractFunctionSource(src, "rWork");
  assert.ok(rw.includes("normalizeWorkHierarchy(S.workHierarchy)"),
    "rWork still consumes the canonical hierarchy adapter");
  assert.ok(rw.includes("activeGoals.push(goal)") && rw.includes("terminalGoals.push(goal)"),
    "partition keeps the same Goal object references");
  assert.ok(!rw.includes("JSON.parse(JSON.stringify") && !rw.includes("structuredClone"),
    "Goals are not deep-copied for presentation");
  // Empty intake remains reachable with a compact role marker.
  const intake = extractFunctionSource(src, "renderIntakeStory");
  assert.ok(intake.includes("outcome-story-note-empty"), "empty intake uses the compact note class");
  assert.ok(intake.includes("outcomeEmpty"), "empty intake copy is retained");
});

// --- FL-109C2A truthful drag + keyboard action handoff ---

test("FL-109C2A cards are pointer-draggable only on Core actionability and never reparent", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const card = extractFunctionSource(src, "renderWorkCard");
  assert.ok(card.includes("workCardIsActionable(card)"), "dragability is gated by the policy helper");
  assert.ok(card.includes("workCardHasPolicy(card)"), "the chooser is gated by policy presence");
  assert.ok(card.includes('el.setAttribute("draggable", "true")'), "actionable cards are draggable");
  assert.ok(card.includes("workDragSuppressClick"), "dragend suppresses the follow-up click");
  assert.ok(card.includes("renderWorkMoveActControl(card)"), "policy-bearing cards get the Move/Act control");
  // The card keeps its canonical click-to-open Task Detail behavior.
  assert.ok(card.includes("showTask(card.taskId, card.breadcrumb)"), "click still opens Task Detail");
  assert.ok(card.includes('e.target !== el'), "the Move/Act control never steals card Enter/Space");

  const start = extractFunctionSource(src, "workCardDragStart");
  assert.ok(start.includes('e.dataTransfer.effectAllowed = "copy"'), "drag copies intent, never moves");
  assert.ok(!/effectAllowed\s*=\s*"move"/.test(start), "drag never declares a move effect");
  assert.ok(!start.includes("insertBefore") && !start.includes("parentNode"),
    "drag start never reparents the canonical card");
  assert.ok(start.includes("workCardIsActionable(card)"), "drag start fails closed on non-actionable cards");

  const isActionable = extractFunctionSource(src, "workCardIsActionable");
  assert.ok(isActionable.includes('disposition === "requestable"'), "requestable destinations count");
  assert.ok(isActionable.includes('disposition === "needs-input"'), "needs-input destinations count");
  assert.ok(isActionable.includes("actionPolicy"), "eligibility comes only from the Core policy");
  assert.ok(isActionable.includes("if(!dests) return false"), "missing policy fails closed");
  assert.ok(!isActionable.includes("card.status"), "eligibility never reads browser status");
  assert.ok(!isActionable.includes("card.column"), "eligibility never infers from the current column");
});

test("FL-109C2A seven-column drop feedback reads only card.actionPolicy and never mutates", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const over = extractFunctionSource(src, "workBoardDragOver");
  assert.ok(over.includes('e.target.closest(".work-cell")'), "drop targets are the column cells");
  assert.ok(over.includes("workDrag.policy"), "feedback reads the dragged card's policy");
  assert.ok(over.includes("workDestinationMode(entry)"), "mode is derived from the policy entry");
  assert.ok(over.includes("work-cell-drop-valid"), "valid targets get affirmative feedback");
  assert.ok(over.includes("work-cell-drop-invalid"), "invalid targets get explained feedback");
  assert.ok(over.includes("work-cell-drop-auto"), "automatic-only targets get their own feedback");
  assert.ok(!over.includes("card.status") && !over.includes("card.column"),
    "drop feedback never infers from status or column");

  const drop = extractFunctionSource(src, "workBoardDrop");
  assert.ok(drop.includes('disposition === "requestable"'), "actionable drops create a handoff");
  assert.ok(drop.includes("workOpenActionsHandoff"), "actionable drop hands off to the drawer");
  assert.ok(drop.includes("workAnnounce"), "invalid drops announce the explanation");
  assert.ok(!drop.includes("postJSON") && !drop.includes("taskAction") && !drop.includes("fetch("),
    "drop never calls a mutation endpoint");
  assert.ok(!drop.includes("parentNode") && !drop.includes("insertBefore"),
    "drop never reparents the card");

  const renderer = extractFunctionSource(src, "renderWorkColumns");
  assert.ok(renderer.includes('cell.setAttribute("data-column", code)'), "each cell carries its column code");
  const rw = extractFunctionSource(src, "rWork");
  assert.ok(rw.includes("board.addEventListener(\"dragover\", workBoardDragOver)"),
    "the board delegates drag over every lane");
});

test("FL-109C2A Move/Act chooser is keyboard-operable and keeps every destination focusable", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const toggle = extractFunctionSource(src, "workActionChooserToggle");
  assert.ok(toggle.includes("workOpenChooserForCard"), "toggle opens the chooser for a card");
  assert.ok(toggle.includes("workChooserTaskId"), "toggle tracks the origin task id");
  assert.ok(toggle.includes("workActionChooserClose"), "toggle closes an existing chooser");

  const open = extractFunctionSource(src, "workOpenChooserForCard");
  assert.ok(open.includes("WORK_COLUMN_CODES.forEach"), "all seven destinations are listed");
  assert.ok(open.includes('role", "listbox"'), "chooser is a listbox");
  assert.ok(open.includes('e.key === "Escape"'), "Escape closes");
  assert.ok(open.includes('e.key === "Tab"'), "Tab navigates");
  assert.ok(open.includes('e.key === "ArrowDown"'), "arrow keys navigate");
  assert.ok(open.includes("nextFocus"), "focus movement helper exists");
  assert.ok(open.includes('workChooserTaskId = String(card.taskId)'), "origin is stored by task id");
  assert.ok(open.includes('btn.setAttribute("aria-expanded", "true")'), "origin reports expanded state");

  const item = extractFunctionSource(src, "workActionChooserItem");
  assert.ok(item.includes('role", "option"'), "each destination is a focusable option");
  assert.ok(item.includes("workDestinationSummary"), "each destination shows an explanation");
  assert.ok(item.includes("workActionPickValid"), "actionable targets say they can be chosen");
  assert.ok(item.includes("workActionChooserClose(btn)"), "an actionable choice closes the chooser");
  assert.ok(item.includes("workDestinationExplanation"), "an invalid choice explains instead of mutating");
  assert.ok(!item.includes("taskAction") && !item.includes("postJSON"),
    "chooser selection never calls a mutation endpoint");

  const close = extractFunctionSource(src, "workActionChooserClose");
  assert.ok(close.includes("workActionFindOriginBtn"), "a detached origin falls back to the replacement control");
  assert.ok(close.includes("origin.focus"), "focus returns to the originating Move/Act control");
  assert.ok(close.includes('workChooserTaskId = null'), "close clears the origin tracking");
});

test("FL-109C2A pending-action handoff is bilingual, truthful, and submits nothing", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const banner = extractFunctionSource(src, "renderPendingActionHandoff");
  assert.ok(banner.includes("workActionHandoffTitle"), "banner has a pending-action title");
  assert.ok(banner.includes("workActionHandoffOperation"), "banner names the exact operation");
  assert.ok(banner.includes("workActionHandoffIntent"), "banner names the fixed intent");
  assert.ok(banner.includes("workActionHandoffRequires"), "banner lists required input");
  assert.ok(banner.includes("workActionHandoffPath"), "banner shows the ordered path");
  assert.ok(banner.includes("workActionHandoffTruth"), "banner states nothing has changed yet");
  assert.ok(!banner.includes("postJSON") && !banner.includes("taskAction") && !banner.includes("fetch("),
    "banner never calls a mutation endpoint");

  const open = extractFunctionSource(src, "workOpenActionsHandoff");
  assert.ok(open.includes('taskDetailActiveTab = "actions"'), "handoff opens the existing Actions tab");
  assert.ok(open.includes("showTask"), "handoff reuses the existing Task detail drawer");
  assert.ok(!open.includes("postJSON") && !open.includes("taskAction") && !open.includes("/resume")
    && !open.includes("/correct") && !open.includes("/revise"),
    "handoff never calls a mutation endpoint");

  const showTask = extractFunctionSource(src, "showTask");
  assert.ok(showTask.includes("renderPendingActionHandoff(pending)"), "the drawer renders the banner");
  assert.ok(showTask.includes('pending.taskId === task.id'), "the banner is scoped to the chosen Task");

  const { enSection, zhSection } = splitI18n(i18n);
  for (const key of [
    "workActionOpen", "workActionChooserTitle", "workActionHandoffTitle",
    "workActionHandoffTruth", "workReasonDependencyHeld", "workReasonRequiresPreflightThenApply",
    "workOpResume", "workOpIntegrationPreflight", "workIntentAccept",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  assert.ok(i18n.includes("Pending action — not yet executed"), "en handoff title is plain");
  assert.ok(i18n.includes("待执行操作——尚未执行"), "zh handoff title is plain");
  assert.ok(i18n.includes("This card has not moved and no status changed"), "en truth line is explicit");
  assert.ok(i18n.includes("此卡片没有移动，状态也没有改变"), "zh truth line is explicit");
  assert.ok(!i18n.includes("Token savings from handoff"), "no unearned savings claim");
});

test("FL-109C2A every policy-bearing card exposes the chooser while only actionable cards drag", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const hasPolicy = extractFunctionSource(src, "workCardHasPolicy");
  assert.ok(hasPolicy.includes("schemaVersion === 1"), "chooser requires a versioned Core policy");
  assert.ok(hasPolicy.includes("policy.destinations"), "chooser requires a destinations record");
  assert.ok(hasPolicy.includes('typeof policy.destinations === "object"'), "destinations must be a record");

  const card = extractFunctionSource(src, "renderWorkCard");
  const draggableAt = card.indexOf('el.setAttribute("draggable", "true")');
  const moveAt = card.indexOf("renderWorkMoveActControl(card)");
  assert.ok(draggableAt > 0 && moveAt > 0, "both gating points exist");
  assert.ok(card.indexOf("if(actionable)") < draggableAt, "drag stays inside the actionable branch");
  assert.ok(card.indexOf("if(hasPolicy)") < moveAt, "chooser is gated by policy presence, not actionability");
  assert.ok(!card.includes("if(actionable) el.appendChild(renderWorkMoveActControl(card))"),
    "the chooser is no longer limited to actionable cards");
});

test("FL-109C2A translated reasons render only localized copy, never the English Core fallback", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const explanation = extractFunctionSource(src, "workDestinationExplanation");
  assert.ok(explanation.includes("if(r) return r;"), "a translated reason is returned on its own");
  assert.ok(!explanation.includes('r + " · "'), "no English Core explanation is appended to a translation");

  const summary = extractFunctionSource(src, "workDestinationSummary");
  assert.ok(!summary.includes('rr + " · "'), "summary never appends the Core fallback to a translation");

  const reason = extractFunctionSource(src, "workReasonLabel");
  assert.ok(reason.includes('"dependency-held": "workReasonDependencyHeld"'),
    "known reason codes map to bounded i18n keys");

  const { enSection, zhSection } = splitI18n(i18n);
  assert.ok(enSection.includes("Held by unsatisfied prerequisites."), "en dependency-held copy is localized");
  assert.ok(zhSection.includes("前置条件未满足。"), "zh dependency-held copy is localized");
  assert.ok(enSection.includes("Run preflight, then apply with confirmation."), "en preflight copy is localized");
  assert.ok(zhSection.includes("先运行预检，再带确认应用。"), "zh preflight copy is localized");
});

test("FL-109C2A chooser origin survives re-render and closes on page or language change", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  assert.ok(src.includes("var workChooserTaskId = null"), "origin task-id state ships");
  assert.ok(src.includes("var workChooserBtn = null"), "best-effort origin button state ships");

  const find = extractFunctionSource(src, "workActionFindOriginBtn");
  assert.ok(find.includes('querySelectorAll(".work-action-btn")'), "finds controls in the current DOM");
  assert.ok(find.includes('getAttribute("data-task-id")'), "matches by task id");
  assert.ok(find.includes('closest(".work-card")'), "scopes to the owning card");

  const rebind = extractFunctionSource(src, "workActionRebindChooser");
  assert.ok(rebind.includes("workActionFindOriginBtn"), "rebind locates the replacement control");
  assert.ok(rebind.includes('origin.setAttribute("aria-expanded", "true")'), "rebind marks the replacement open");
  assert.ok(rebind.includes("panel.remove()"), "rebind closes safely when the origin card is gone");

  const rw = extractFunctionSource(src, "rWork");
  assert.ok(rw.includes("workActionRebindChooser()"), "Work re-render rebinds the open chooser");

  const st = extractFunctionSource(src, "switchTab");
  assert.ok(st.includes("workActionChooserReset()"), "tab switch closes the chooser");
  assert.ok(st.includes("workPendingHandoffReset()"), "tab switch closes the pending-action handoff");

  const langIdx = src.indexOf("window.onForklightLangChange = function()");
  assert.ok(langIdx > 0, "language change handler exists");
  const langBlock = src.slice(langIdx, langIdx + 400);
  assert.ok(langBlock.includes("workActionChooserReset()"), "language change closes the chooser");
  assert.ok(langBlock.includes("workPendingHandoffReset()"), "language change closes the pending-action handoff");
});

// --- FL-109C2B connect board intent to exact durable Task controls ---

test("FL-109C2B every Core operation maps to one exact durable submit control", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const showTask = extractFunctionSource(src, "showTask");
  for (const op of [
    "resume", "revise", "correct", "main_review",
    "integration_preflight", "integration_apply",
  ]) {
    assert.ok(showTask.includes(`data-fl-op-submit", "${op}"`), `showTask tags ${op}`);
  }
  assert.ok(showTask.includes('data-fl-op-input", "feedback"'), "feedback input is a stable target");
  assert.ok(showTask.includes('data-fl-op-input", "reason"'), "review reason is a stable target");
  assert.ok(showTask.includes('data-fl-op-input", "receiptId"'), "integration receipt is a stable target");

  const attention = extractFunctionSource(src, "renderAttentionResolutionControls");
  assert.ok(attention.includes('data-fl-op-submit", "task_resolve"'), "resolve submit is a stable target");
  assert.ok(attention.includes('data-fl-op-submit", "task_reopen"'), "reopen submit is a stable target");
  assert.ok(attention.includes('data-fl-op-target", "task_resolve"'), "resolve section owns its target");
  assert.ok(attention.includes('data-fl-op-target", "task_reopen"'), "reopen section owns its target");
  assert.ok(attention.includes('data-fl-op-input", "evidence"'), "resolve evidence is a stable target");

  const submit = extractFunctionSource(src, "workPendingSubmit");
  assert.ok(submit.includes(`querySelector('[data-fl-op-submit="' + op + '"]')`),
    "router finds the submit by its stable attribute, never by label text");
  assert.ok(!submit.includes("textContent"), "no text matching in the submit lookup");

  const opRead = extractFunctionSource(src, "workPendingOperation");
  assert.ok(opRead.includes("pending.entry.operation"), "the operation comes from the Core-owned entry");
  assert.ok(opRead.includes("pending.operation"), "a guided step override is honored after preflight");

  // No generic status mutation endpoint is invented anywhere in the Hub UI.
  assert.ok(!src.includes("/set-status") && !src.includes("set_status"),
    "no generic status setter appears in the Hub UI");
  assert.ok(!src.includes('encodeURIComponent(task.id) + "/status"'),
    "no generic per-task status endpoint");
});

test("FL-109C2B pending Continue guides to the first missing input or the exact submit", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const cont = extractFunctionSource(src, "workPendingContinue");
  assert.ok(cont.includes("workPendingSubmit(op)"), "Continue resolves the exact submit control");
  assert.ok(cont.includes(`section.querySelector('[data-fl-op-input="' + field + '"]')`),
    "Continue finds the required input scoped to the operation section");
  assert.ok(cont.includes("!input.value.trim()"), "a missing input is detected by emptiness");
  assert.ok(cont.includes("workPendingFocusControl(input)"), "the missing input receives focus");
  assert.ok(cont.includes("workPendingFocusControl(submit)"), "the confirm gate receives focus when no input is missing");
  assert.ok(cont.includes("workPendingHandoffReset()"), "a control that is gone closes the pending handoff safely");

  const focus = extractFunctionSource(src, "workPendingFocusControl");
  assert.ok(focus.includes("scrollIntoView"), "Continue scrolls to the control");
  assert.ok(focus.includes(".focus("), "Continue focuses the control");
  assert.ok(focus.includes("workAnnounce"), "focus move announces a readable confirmation");

  const guide = extractFunctionSource(src, "workPendingGuideText");
  assert.ok(guide.includes("workActionHandoffStepPreflight"), "integration names the preflight step");
  assert.ok(guide.includes("workActionHandoffStepApply"), "integration names the apply step");
  assert.ok(guide.includes("workActionHandoffStepNext"), "a required input is named next");
  assert.ok(guide.includes("workActionHandoffStepConfirm"), "the confirm gate is named when no input is missing");
});

test("FL-109C2B Main review fixed intent is preselected and locked only for the pending path", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const showTask = extractFunctionSource(src, "showTask");
  assert.ok(showTask.includes('workPendingOperation(pendingReview) === "main_review"'), "lock is scoped to main_review");
  assert.ok(showTask.includes("pendingReview.entry.intent"), "the fixed intent comes from the Core entry");
  assert.ok(showTask.includes("revSel.value = fixedIntent"), "fixed intent is preselected");
  assert.ok(showTask.includes('"accept" || fixedIntent === "revise" || fixedIntent === "reject"'),
    "only Core's known review intents can be locked");
  assert.ok(showTask.includes("revSel.disabled = true"), "fixed intent is locked for the active handoff");
  assert.ok(showTask.includes('data-fl-role", "main-review-lock-hint"'), "a lock hint names the fixed intent");
  assert.ok(showTask.includes('data-fl-op-submit", "main_review"'), "the review submit is a stable target");
  assert.ok(showTask.includes(`taskDurableAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/main-review"`),
    "main review goes through the canonical durable bridge");

  const { enSection, zhSection } = splitI18n(i18n);
  assert.ok(enSection.includes("workActionHandoffLockedIntent"), "en locked-intent copy");
  assert.ok(zhSection.includes("workActionHandoffLockedIntent"), "zh locked-intent copy");
  assert.ok(enSection.includes("Fixed intent for this step:"), "en locked-intent copy is plain");
  assert.ok(zhSection.includes("此步骤的固定意图："), "zh locked-intent copy is plain");
});

test("FL-109C2B Integration stays two-step preflight then receipt-bound apply", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const showTask = extractFunctionSource(src, "showTask");
  assert.ok(showTask.includes('data-fl-op-submit", "integration_preflight"'), "preflight submit is a stable target");
  assert.ok(showTask.includes('data-fl-op-submit", "integration_apply"'), "apply submit is a stable target");
  assert.ok(showTask.includes('data-fl-op-input", "receiptId"'), "receipt input is a stable target");
  assert.ok(showTask.includes("workPendingAdvanceToApply(task.id)"), "preflight success advances to apply");
  assert.ok(showTask.includes(`taskOperationSuccess(task.id, null, function(){ showIntegration(task.id); })`),
    "apply success clears pending and refreshes the detail view");

  const advance = extractFunctionSource(src, "workPendingAdvanceToApply");
  assert.ok(advance.includes('p.operation = "integration_apply"'), "advance switches the step to apply");
  assert.ok(advance.includes("workReplacePendingBanner()"), "advance re-renders the guided banner");
  assert.ok(advance.includes('workPendingOperation(p) !== "integration_preflight"'), "advance only follows a real preflight");

  const success = extractFunctionSource(src, "taskOperationSuccess");
  assert.ok(success.includes("workRefreshHierarchyAfterOperation()"), "apply success refetches the hierarchy");

  const { enSection, zhSection } = splitI18n(i18n);
  for (const key of ["workActionHandoffStepPreflight", "workActionHandoffStepApply"]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  assert.ok(enSection.includes("Step 1 of 2: run integration preflight"), "en preflight step is plain");
  assert.ok(zhSection.includes("第 1/2 步：先运行合入预检"), "zh preflight step is plain");
});

test("FL-109C2B success clears pending intent and refreshes detail plus canonical hierarchy", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const success = extractFunctionSource(src, "taskOperationSuccess");
  assert.ok(success.includes("S.pendingActionHandoff = null"), "success clears the matching pending intent");
  assert.ok(success.includes("p.taskId === taskId"), "only the matching task's pending intent clears");
  assert.ok(success.includes("showTask(taskId)"), "success reloads the Task detail");
  assert.ok(success.includes("workRefreshHierarchyAfterOperation()"), "success immediately refetches the hierarchy");
  assert.ok(!success.includes("insertBefore") && !success.includes("parentNode"),
    "the completion bridge never moves or reparents a card");

  const refresh = extractFunctionSource(src, "workRefreshHierarchyAfterOperation");
  assert.ok(refresh.includes('fetchSlice("workHierarchy")'), "hierarchy comes from the canonical Core slice");
  assert.ok(refresh.includes("render()"), "the Work board re-renders from retained evidence");
  assert.ok(!refresh.includes("postJSON") && !refresh.includes("taskAction"),
    "the refresh path performs no mutation");
});

test("FL-109C2B failure keeps pending context with entered data intact and never retries", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const durable = extractFunctionSource(src, "taskDurableAction");
  assert.ok(durable.includes("workPendingFailure(taskId, msg)"), "failure is retained in the pending context");

  const failure = extractFunctionSource(src, "workPendingFailure");
  assert.ok(failure.includes("p.failure = msg"), "the failure message is recorded on the pending handoff");
  assert.ok(failure.includes("note.hidden = false"), "the banner reveals the failure note in place");
  assert.ok(failure.includes("boundedDiagnostic(p.failure)"), "the failure message stays bounded");
  assert.ok(!failure.includes("taskAction(") && !failure.includes("postJSON"),
    "failure handling never resubmits automatically");

  const banner = extractFunctionSource(src, "renderPendingActionHandoff");
  assert.ok(banner.includes("workActionHandoffFailureBody"), "the banner explains nothing changed");

  const action = extractFunctionSource(src, "taskAction");
  assert.ok(!action.includes("setTimeout"), "no automatic retry timer is scheduled");
  assert.ok(action.includes(".finally"), "the submit control is re-enabled for a finite manual retry");

  const { enSection, zhSection } = splitI18n(i18n);
  assert.ok(enSection.includes("workActionHandoffFailureTitle"), "en failure title");
  assert.ok(zhSection.includes("workActionHandoffFailureTitle"), "zh failure title");
  assert.ok(enSection.includes("Nothing was changed and no card moved"), "en failure truth is explicit");
  assert.ok(zhSection.includes("没有任何改变，也没有移动卡片"), "zh failure truth is explicit");
});

test("FL-109C2B stale pending intent closes safely on task, page, or language change", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const stale = extractFunctionSource(src, "workClearStaleHandoff");
  assert.ok(stale.includes("p.taskId !== task.id"), "a different task clears the pending intent");
  assert.ok(stale.includes("S.pendingActionHandoff = null"), "stale intent is cleared");
  assert.ok(stale.includes('workCollectCards(S.workHierarchy'), "staleness reads the current Core hierarchy");
  assert.ok(stale.includes("schemaVersion === 1"), "staleness requires a versioned Core policy");
  assert.ok(stale.includes('disposition === "requestable"') && stale.includes('disposition === "needs-input"'),
    "staleness requires an actionable destination");
  assert.ok(stale.includes("entry.operation === op"), "staleness requires the matching operation");
  assert.ok(stale.includes("entry.intent === p.entry.intent"), "staleness requires the matching fixed intent");
  assert.ok(!stale.includes("known[op]"), "no local operation-name allowlist decides staleness");
  assert.ok(!stale.includes("task.status") && !stale.includes("card.column"),
    "staleness never infers from Task status or column");

  const st = extractFunctionSource(src, "switchTab");
  assert.ok(st.includes("workPendingHandoffReset()"), "page change closes the pending intent");

  const langIdx = src.indexOf("window.onForklightLangChange = function()");
  const langBlock = src.slice(langIdx, langIdx + 400);
  assert.ok(langBlock.includes("workPendingHandoffReset()"), "language change closes the pending intent");

  const reset = extractFunctionSource(src, "workPendingHandoffReset");
  assert.ok(reset.includes("S.pendingActionHandoff = null"), "reset clears the pending intent");
});

test("FL-109C2B pending resolve starts with no chosen reason and blocks empty submit", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const attention = extractFunctionSource(src, "renderAttentionResolutionControls");
  assert.ok(attention.includes('placeholder.value = ""'), "the reason select begins with an unselected placeholder");
  assert.ok(attention.includes("attentionResolveReasonPh"), "the placeholder copy is localized");
  assert.ok(attention.includes("!reasonSel.value.trim()"), "submit blocks while the reason is empty");
  const emptyCheck = attention.indexOf("!reasonSel.value.trim()");
  const confirmGate = attention.indexOf("window.confirm(t(\"attentionResolveConfirm\")");
  assert.ok(emptyCheck > 0 && confirmGate > 0 && emptyCheck < confirmGate,
    "the empty-reason check runs before the confirmation gate");

  const cont = extractFunctionSource(src, "workPendingContinue");
  assert.ok(cont.includes("!input.value.trim()"), "an unselected reason is treated as missing and focused");

  const { enSection, zhSection } = splitI18n(i18n);
  assert.ok(enSection.includes("attentionResolveReasonPh"), "en resolve reason placeholder");
  assert.ok(zhSection.includes("attentionResolveReasonPh"), "zh resolve reason placeholder");
  assert.ok(enSection.includes("attentionResolveReasonRequired"), "en empty-reason copy");
  assert.ok(zhSection.includes("attentionResolveReasonRequired"), "zh empty-reason copy");
  assert.ok(enSection.includes("Choose a reason"), "en placeholder is plain");
  assert.ok(zhSection.includes("请选择原因"), "zh placeholder is plain");
});

test("FL-109C2B stale handoff is cleared when current Core policy no longer matches", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const stale = extractFunctionSource(src, "workClearStaleHandoff");
  // The card must exist in the current hierarchy projection and carry a
  // versioned destination entry with an actionable disposition.
  assert.ok(stale.includes("workCollectCards(S.workHierarchy"), "lookup walks the current Core projection");
  assert.ok(stale.includes("card.taskId === p.taskId"), "the exact task card is located by id");
  assert.ok(stale.includes("!found || !entry || !actionable || !opMatches || !intentMatches"),
    "missing or mismatched Core evidence clears the pending handoff");

  const pathOp = extractFunctionSource(src, "workPathHasOperation");
  assert.ok(pathOp.includes("path[i].operation === op"), "path-step operations are honored");
  assert.ok(pathOp.includes("Array.isArray(path)"), "the path check fails closed on non-arrays");
});

test("FL-109C2B guided handoff copy is bilingual and calm in English and Chinese", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  for (const key of [
    "workActionHandoffContinue", "workActionHandoffStepNext", "workActionHandoffStepConfirm",
    "workActionHandoffStepPreflight", "workActionHandoffStepApply", "workActionHandoffFocused",
    "workActionHandoffFailureTitle", "workActionHandoffFailureBody", "workActionHandoffTargetMissing",
    "workReqEvidence", "workReqNote",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  assert.ok(enSection.includes("Continue to the exact control"), "en Continue is plain");
  assert.ok(zhSection.includes("前往对应控件继续"), "zh Continue is plain");
  assert.ok(enSection.includes("No input is missing"), "en confirm gate is plain");
  assert.ok(zhSection.includes("没有缺失的输入"), "zh confirm gate is plain");
  assert.ok(!enSection.includes("Token savings from handoff"), "no unearned savings claim");
});

// --- FL-109D2 outcome composer + intake story interaction contract ---

test("FL-109D2 outcome composer records once, preserves failed input, and never proposes in the browser", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);

  // Composer wires one authenticated create bridge, not a proposal mutation.
  assert.ok(src.includes("function outcomeSubmit("), "submit handler ships");
  const submit = extractFunctionSource(src, "outcomeSubmit");
  assert.ok(submit.includes('postJSON("/api/ops/intakes", body)'), "submit calls the authenticated create bridge");
  assert.ok(submit.includes("if(S.outcomeSubmitting) return"), "submit is single-flight");
  assert.ok(!submit.includes("outcome_intake_propose"), "browser submit never proposes");
  assert.ok(!submit.includes("plan_submit_file") && !submit.includes("goal_submit_file") && !submit.includes("submit_file"),
    "browser submit never creates work");
  assert.ok(!submit.includes("setTimeout"), "no automatic retry timer is scheduled");

  // Failed input is preserved: the renderer repopulates every field from the draft.
  const composer = extractFunctionSource(src, "renderOutcomeComposer");
  assert.ok(composer.includes('S.outcomeDraft.outcome'), "outcome text preserves the draft");
  assert.ok(composer.includes('S.outcomeDraft.project'), "project preserves the draft");
  assert.ok(composer.includes('S.outcomeDraft.context'), "context preserves the draft");
  assert.ok(composer.includes('S.outcomeDraft.requestedShape'), "shape preserves the draft");
  assert.ok(composer.includes("outcome-form-active") || composer.includes("outcomeFormActive"),
    "active-form guard prevents poll re-render from wiping input");

  // Pending story repeats the nothing-started truth near status and next action.
  const pending = extractFunctionSource(src, "renderPendingStory");
  assert.ok(pending.includes("outcomePendingStatus"), "pending header names the recorded state");
  assert.ok(pending.includes("outcomePendingIntro"), "nothing-started truth is explicit");
  assert.ok(pending.includes("outcomePendingNoAuto"), "nothing-started truth repeats near next action");
  assert.ok(pending.includes("renderIntakeHandoff(intake)"), "pending card offers the Main handoff");

  // Proposed preview keeps user preference and Main selection distinct.
  const proposed = extractFunctionSource(src, "renderProposedPreview");
  assert.ok(proposed.includes("outcomePreferenceDiff"), "preference difference is explained");
  assert.ok(proposed.includes("outcomeNotConfirmed"), "nothing-created truth is explicit");
  assert.ok(!proposed.includes("outcomeHandoffCopy"), "proposed preview has no create/handoff control");
  assert.ok(!proposed.includes("window.confirm"), "proposed preview has no confirmation control");

  // Main handoff copies only the opaque id plus a fixed instruction.
  const handoff = extractFunctionSource(src, "renderIntakeHandoff");
  assert.ok(handoff.includes("outcomeHandoffText"), "handoff text is a fixed localized string");
  const handoffText = extractFunctionSource(src, "outcomeHandoffText");
  assert.ok(handoffText.includes("{ id: String(intakeId) }"), "handoff text embeds only the id");
  const enHandoff = enSection.match(/outcomeHandoffText:\s*"([^"]*)"/);
  assert.ok(enHandoff, "en handoff copy present");
  assert.ok(!(enHandoff![1] ?? "").includes("{outcome}") && !(enHandoff![1] ?? "").includes("{context}"),
    "handoff never contains the outcome or context");

  // Bilingual plain-language copy ships for every story state.
  for (const key of [
    "outcomeTitle", "outcomeLabel", "outcomeAdvanced", "outcomeSubmit",
    "outcomePendingStatus", "outcomePendingNext", "outcomePendingContinue",
    "outcomeProposedStatus", "outcomeNotConfirmed", "outcomeHandoffTitle",
    "outcomeEmpty", "outcomeLoading", "outcomeUnavailable",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  assert.ok(enSection.includes("nothing has started"), "en pending truth is explicit");
  assert.ok(zhSection.includes("尚未开始任何工作"), "zh pending truth is explicit");
  assert.ok(enSection.includes("not confirmed"), "en nothing-created truth is explicit");
  assert.ok(zhSection.includes("尚未确认"), "zh nothing-created truth is explicit");
});

test("FL-109D2 intake story renders canonical pending/proposed states without browser inference", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  // The story consumes only the canonical list from the normal Work refresh.
  const story = extractFunctionSource(src, "renderIntakeStory");
  assert.ok(story.includes("S.intakes"), "story reads the canonical intake list");
  assert.ok(story.includes("outcome-story-unavailable"), "first-fetch failure has its own state");
  assert.ok(story.includes("outcomeEmpty"), "naturally-empty has its own state");
  assert.ok(story.includes("outcomeLoading"), "loading has its own state");
  // A missing or stale selected intake falls back to the plain canonical list.
  assert.ok(story.includes("S.selectedIntakeId"), "selected intake is a browser-only focus aid");
  assert.ok(!story.includes("intake.status = "), "story never rewrites canonical status");
  assert.ok(!story.includes("status = \"proposed\""), "story never infers proposed state");
  // The intake list slice is part of the normal Work refresh path.
  const smStart = src.indexOf("var SLICE_MAP = {");
  const smEnd = src.indexOf("};", smStart) + 2;
  const smBlock = src.slice(smStart, smEnd);
  assert.ok(smBlock.includes('intakes:'), "intakes slice key ships in SLICE_MAP");
  assert.ok(smBlock.includes('"/api/ops/intakes"'), "intakes slice maps to the read-only Hub bridge");
  const pdStart = src.indexOf("var PAGE_DEPS = {");
  const pdEnd = src.indexOf("};", pdStart) + 2;
  const pdBlock = src.slice(pdStart, pdEnd);
  assert.ok(pdBlock.includes('intakes: true'), "Work refresh path fetches the bounded intake list");
});

// --- FL-109D3B explicit Hub confirmation + created story ---

test("FL-109D3B proposed confirmation is explicit, single-flight, and never optimistic", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");

  // The proposed preview offers exactly one clear primary confirm action that
  // opens a contained step; it never uses a native confirm dialog.
  const proposed = extractFunctionSource(src, "renderProposedPreview");
  assert.ok(proposed.includes('data-fl-role", "outcome-confirm-open"'), "proposed preview exposes one confirm control");
  assert.ok(proposed.includes("outcomeConfirmAction"), "confirm control label ships");
  assert.ok(proposed.includes("renderOutcomeConfirmStep(intake)"), "choosing confirm opens the contained step");
  assert.ok(!proposed.includes("window.confirm"), "no native confirm dialog");
  assert.ok(!proposed.includes("outcomeConfirmSubmit("), "the preview itself never submits");

  // The contained step repeats exactly what Main proposed.
  const step = extractFunctionSource(src, "renderOutcomeConfirmStep");
  assert.ok(step.includes("outcomeConfirmTitle"), "step has an explicit title");
  assert.ok(step.includes("outcomeConfirmShape"), "step repeats the selected shape");
  assert.ok(step.includes("outcomeConfirmDisplay"), "step repeats the display name");
  assert.ok(step.includes("outcomeConfirmScope"), "step repeats the scope count");
  assert.ok(step.includes("outcomeConfirmTruth"), "step states that confirming creates and queues work");
  assert.ok(step.includes('data-fl-role", "outcome-confirm-cancel"'), "step offers a cancel/back control");
  assert.ok(step.includes('data-fl-role", "outcome-confirm-submit"'), "step offers the one submit control");
  assert.ok(step.includes("outcomeConfirmPendingId"), "submit state is single-flight");

  // The submit handler forwards only intakeId + expectedRevision + confirm:true.
  const submit = extractFunctionSource(src, "outcomeConfirmSubmit");
  assert.ok(submit.includes('postJSON("/api/ops/intakes/" + encodeURIComponent(intake.id) + "/confirm",'),
    "submit posts to the one authenticated confirm bridge");
  assert.ok(submit.includes("expectedRevision: intake.revision"), "submit sends the current proposal revision");
  assert.ok(submit.includes("confirm: true"), "submit sends the literal confirm");
  assert.ok(submit.includes("if(S.outcomeConfirmPendingId) return"), "submit is single-flight");
  assert.ok(!submit.includes("artifactPath") && !submit.includes("intake.outcome"),
    "submit never sends an artifact path or outcome text");
  assert.ok(!submit.includes("setTimeout"), "no automatic retry timer is scheduled");
  assert.ok(!submit.includes("workHierarchy"), "submit never mutates the hierarchy slice optimistically");
  assert.ok(!submit.includes("renderWorkCard"), "submit never invents a Task card");
  assert.ok(submit.includes("refresh()"), "success performs one ordinary Work refresh");
  assert.ok(!submit.includes("window.confirm"), "submit never uses a native confirm dialog");

  // Failure preserves the proposal and maps bounded codes to plain copy.
  const errKey = extractFunctionSource(src, "outcomeConfirmErrorKey");
  assert.ok(errKey.includes("outcomeConfirmErrorStaleRevision"), "stale revision has its own message");
  assert.ok(errKey.includes("outcomeConfirmErrorStaleArtifact"), "changed artifact has its own message");
  assert.ok(errKey.includes("outcomeConfirmErrorInProgress"), "already-running has its own message");
  assert.ok(errKey.includes("outcomeConfirmErrorNoProposal"), "no-proposal has its own message");
  assert.ok(errKey.includes("outcomeConfirmErrorNetwork"), "uncertain network has its own message");
  // On failure the proposal is preserved: the confirming state and canonical
  // intake list are touched only by the canonical-success branch, and the
  // failure handler maps the bounded code to plain-language copy.
  assert.ok(submit.includes("S.outcomeConfirmError = outcomeConfirmErrorKey(msg)"),
    "failure maps the bounded code to plain-language copy");
  const confirmClearCount = (submit.match(/S\.outcomeConfirmingId = null/g) || []).length;
  assert.equal(confirmClearCount, 1, "the confirming state is cleared only on canonical success");
  const listReplaceCount = (submit.match(/S\.intakes = /g) || []).length;
  assert.equal(listReplaceCount, 1, "the canonical intake list is replaced only on success");
  assert.ok(submit.includes("outcomeConfirmErrorNetwork"), "uncertain network has its own copy");

  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  for (const key of [
    "outcomeStatusCreated", "outcomeCreatedStatus", "outcomeCreatedWhat",
    "outcomeCreatedExecution", "outcomeCreatedNext", "outcomeConfirmAction",
    "outcomeConfirmTitle", "outcomeConfirmTruth", "outcomeConfirmSubmit",
    "outcomeConfirmErrorStaleRevision", "outcomeConfirmErrorNetwork",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
});

test("FL-109D3B created story is plain-language and progressively disclosed", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");

  // The intake detail renders the canonical created state distinctly.
  const detail = extractFunctionSource(src, "renderIntakeDetail");
  assert.ok(detail.includes('intake.status === "created"'), "created is a first-class canonical state");
  assert.ok(detail.includes("renderCreatedStory(intake)"), "created detail renders the durable result story");

  const created = extractFunctionSource(src, "renderCreatedStory");
  assert.ok(created.includes("outcomeCreatedWhat"), "story answers what was created");
  assert.ok(created.includes("outcomeCreatedExecution"), "story answers what happened to execution");
  assert.ok(created.includes("outcomeCreatedNext"), "story answers what to do next");
  assert.ok(created.includes("outcomeCreatedOpenTask"), "story offers opening the created Task");
  assert.ok(created.includes("showTask(taskIds[0])"), "opening the created Task uses the ordinary detail path");
  assert.ok(created.includes("renderIntakeTechDetails(intake)"), "ids and receipt evidence stay under Technical details");
  assert.ok(!created.includes("outcomeHandoffCopy"), "created story has no handoff control");

  // The list badge renders pending/proposed/created from the canonical status.
  const row = extractFunctionSource(src, "renderIntakeRow");
  assert.ok(row.includes("outcomeStatusCreated"), "created list badge ships");

  // Technical details disclose the durable receipt evidence under disclosure.
  const tech = extractFunctionSource(src, "renderIntakeTechDetails");
  assert.ok(tech.includes("outcomeTechReceipt"), "receipt id is progressive evidence");
  assert.ok(tech.includes("outcomeTechTaskIds"), "created Task ids are progressive evidence");
  assert.ok(tech.includes('journeyDisclosure(t("outcomeTechnical"), rows)'), "evidence stays under disclosure");
});

test("FL-109D3B created story keys are bilingual plain language", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  for (const key of [
    "outcomeStatusCreated", "outcomeCreatedStatus", "outcomeCreatedWhat",
    "outcomeCreatedWhatBody", "outcomeCreatedExecution", "outcomeCreatedExecutionBody",
    "outcomeCreatedNext", "outcomeCreatedNextBody", "outcomeCreatedOpenTask",
    "outcomeConfirmAction", "outcomeConfirmTitle", "outcomeConfirmIntro",
    "outcomeConfirmShape", "outcomeConfirmDisplay", "outcomeConfirmScope",
    "outcomeConfirmTruth", "outcomeConfirmCancel", "outcomeConfirmSubmit",
    "outcomeConfirmPending", "outcomeConfirmAnnounce", "outcomeConfirmCreatedAnnounce",
    "outcomeConfirmErrorStaleRevision", "outcomeConfirmErrorStaleArtifact",
    "outcomeConfirmErrorInProgress", "outcomeConfirmErrorNoProposal",
    "outcomeConfirmErrorNetwork", "outcomeTechReceipt", "outcomeTechTaskIds",
    "outcomeTechPlanId", "outcomeTechGoalId", "outcomeTechConfirmedAt",
  ]) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }
  // Plain-language truth: creation really happens, and uncertainty never
  // claims nothing happened.
  assert.ok(enSection.includes("work created"), "en created story states the durable result");
  assert.ok(zhSection.includes("工作已创建"), "zh created story states the durable result");
  assert.ok(enSection.includes("could not confirm whether"), "en network failure stays uncertain");
  assert.ok(zhSection.includes("无法确认工作是否已创建"), "zh network failure stays uncertain");
});

// --- FL-108D1: Task Detail tells one clear input-to-delivery story ---

test("FL-108D1 Checks tab hint is total on all-pass, failed/total on failure, empty when unknown", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const hintSrc = extractFunctionSource(src, "taskChecksTabHint");
  const hint = new Function(`${hintSrc}\nreturn taskChecksTabHint;`)() as (
    iv: unknown,
  ) => string;

  assert.equal(
    hint({ available: true, conclusion: "passed", totalCount: 4, failedCount: 0 }),
    "4",
    "all-pass shows the total check count, never 0",
  );
  assert.equal(
    hint({ available: true, conclusion: "failed", totalCount: 4, failedCount: 1 }),
    "1/4",
    "failure shows compact failed/total",
  );
  assert.equal(
    hint({ available: true, conclusion: "failed", totalCount: 4, failedCount: 4 }),
    "4/4",
    "all-failed still uses failed/total form",
  );
  assert.equal(hint({ available: false }), "", "unavailable checks show no numeric pass claim");
  assert.equal(hint(null), "", "missing verification shows no numeric pass claim");
  assert.equal(
    hint({ available: true, conclusion: "passed", totalCount: 0, failedCount: 0, checks: [] }),
    "",
    "zero-total available evidence does not invent a success count",
  );
  assert.equal(
    hint({
      available: true,
      conclusion: "passed",
      checks: [{ passed: true }, { passed: true }, { passed: true }],
    }),
    "3",
    "falls back to checks.length when totalCount is absent",
  );

  const workbench = extractFunctionSource(src, "renderTaskWorkbench");
  assert.ok(workbench.includes("taskChecksTabHint(iv)"), "workbench uses the honest Checks badge helper");
  assert.ok(
    !/hint:\s*failCount/.test(workbench) && !workbench.includes('hint: failCount'),
    "workbench no longer uses failed-count alone as the Checks badge",
  );
});

test("FL-108D1 Overview is a four-step story without raw claim, paths, or retained Candidate", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const overview = extractFunctionSource(src, "renderFourSectionOverview");

  assert.ok(overview.includes('data-fl-role", "task-overview-story"'), "overview has a stable story marker");
  assert.ok(overview.includes('data-fl-role", "task-ov-main-asked"'), "step 1 Main input");
  assert.ok(overview.includes('data-fl-role", "task-ov-worker-returned"'), "step 2 execution");
  assert.ok(overview.includes('data-fl-role", "task-ov-independent-result"'), "step 3 checks");
  assert.ok(overview.includes('data-fl-role", "task-ov-final-output"'), "step 4 delivery");

  // Ordered append: Main → execution → checks → delivery.
  const s1 = overview.indexOf('task-ov-main-asked');
  const s2 = overview.indexOf('task-ov-worker-returned');
  const s3 = overview.indexOf('task-ov-independent-result');
  const s4 = overview.indexOf('task-ov-final-output');
  assert.ok(s1 > 0 && s2 > s1 && s3 > s2 && s4 > s3, "four steps append in input-to-delivery order");

  // Default path excludes raw progressive evidence.
  assert.ok(!overview.includes("worker-claim-preview"), "no raw Worker claim preview on Overview");
  assert.ok(!overview.includes("we.workerClaim"), "does not read Worker claim text for default story");
  assert.ok(!overview.includes("task-report-list files"), "no exact path list on Overview");
  assert.ok(!overview.includes("files.slice"), "does not render path slices on Overview");
  assert.ok(!overview.includes("renderRetainedCandidate"), "retained Candidate stays off Overview");
  assert.ok(overview.includes("taskOvExecutionSummary"), "execution uses attempt/file counts");
  assert.ok(overview.includes("taskOvExecutionInProgress"), "active work has an in-progress conclusion");
  assert.ok(overview.includes("taskOvEvidenceInResult"), "points users to Result & files for raw evidence");
  assert.ok(overview.includes("check-failure-summary"), "failed checks can surface the first safe failure");
  assert.ok(overview.includes("firstFailed"), "only the first actionable failure is lifted");
  // Delivery precedence is preserved.
  assert.ok(overview.includes("verified-repaired-delivered"), "repaired delivery still leads");
  assert.ok(overview.includes("taskOvIntegrated"), "integrated delivery conclusion remains");
  assert.ok(overview.includes("taskOvReadyIntegrate"), "ready-to-integrate remains");
  assert.ok(overview.includes("nextActionLabel"), "one next action remains on the final step");
  assert.ok(overview.includes("a.presentation.summary"), "exact Main-authored summary is preferred");
});

test("FL-108D1 Result & files leads with meaning and keeps original Worker report progressive", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const workbench = extractFunctionSource(src, "renderTaskWorkbench");

  // Meaning-first outcome from the story adapter body key.
  assert.ok(workbench.includes("claimStep.bodyKey"), "Result leads with localized factual outcome");
  assert.ok(workbench.includes("taskReportClaimDisclosure"), "Worker report has an explicit disclosure label");
  assert.ok(workbench.includes("worker-claim-disclosure"), "Worker claim disclosure has a stable marker");
  assert.ok(workbench.includes("worker-claim-text"), "exact Worker text remains reachable");
  assert.ok(workbench.includes("journeyDisclosure"), "uses the shared closed disclosure control");
  assert.ok(workbench.includes("taskReportClaimDisclosureHint"), "disclosure is labeled unverified");
  // Evidence remains in this tab.
  assert.ok(workbench.includes("taskReportArtifactsTitle"), "changed paths stay in Result & files");
  assert.ok(workbench.includes("renderRetainedCandidate(task)"), "retained Candidate stays in Result & files");
  // Process / Result badges stay count-based.
  assert.ok(workbench.includes("hint: attemptCount"), "Process badge shows attempt count");
  assert.ok(workbench.includes("hint: fileCount"), "Result badge shows file count");
  assert.ok(workbench.includes("hint: checksHint"), "Checks badge uses the honest helper");
});

test("FL-108D1 Overview and Result copy are bilingual and keep Chinese free of English Worker report defaults", async () => {
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  const keys = [
    "taskOvMainAsked", "taskOvMainAskedHint",
    "taskOvWorkerReturned", "taskOvWorkerReturnedHint",
    "taskOvExecutionSummary", "taskOvExecutionInProgress", "taskOvExecutionNoAttempts",
    "taskOvEvidenceInResult",
    "taskOvIndependentResult", "taskOvIndependentResultHint",
    "taskOvChecksPassed", "taskOvChecksFailed", "taskOvChecksNotRun",
    "taskOvFinalOutput", "taskOvFinalOutputHint",
    "taskOvIntegrated", "taskOvPendingWorker", "taskOvNoOutput",
    "taskTabOverviewHint",
    "taskReportResultTitle", "taskReportResultHint",
    "taskReportClaimNotProof", "taskReportClaimDisclosure", "taskReportClaimDisclosureHint",
  ];
  for (const key of keys) {
    assert.ok(enSection.includes(key), `en ${key}`);
    assert.ok(zhSection.includes(key), `zh ${key}`);
  }

  function labelOf(section: string, key: string): string {
    const match = new RegExp(`${key}['"]?\\s*:\\s*"([^"]+)"`).exec(section);
    return match?.[1] ?? "";
  }

  assert.match(labelOf(enSection, "taskOvExecutionSummary"), /attempt.*file/i);
  assert.match(labelOf(zhSection, "taskOvExecutionSummary"), /尝试.*变更文件/);
  assert.match(labelOf(enSection, "taskReportClaimDisclosure"), /unverified|not proof/i);
  assert.match(labelOf(zhSection, "taskReportClaimDisclosure"), /未经验证|不是证明/);
  assert.match(labelOf(zhSection, "taskOvEvidenceInResult"), /结果与文件/);
  assert.match(labelOf(zhSection, "taskTabOverviewHint"), /Main 要求|实际执行|独立检查|最终交付/);
  // Default Chinese story copy must not embed English Worker-report scaffolding.
  assert.doesNotMatch(labelOf(zhSection, "taskOvWorkerReturnedHint"), /I updated|Implemented|Worker self-report:/);
  assert.doesNotMatch(labelOf(zhSection, "taskReportClaimDisclosure"), /View the Worker's original report/);
  // Integrated success stays truthful in Chinese (hero/delivery precedence copy).
  assert.match(labelOf(zhSection, "taskOvIntegrated"), /合入/);
  assert.match(labelOf(enSection, "taskOvIntegrated"), /Integrated|source project/i);
});

test("FL-108D1 success, failure, active, no-change, and legacy fixtures preserve truth boundaries", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const overview = extractFunctionSource(src, "renderFourSectionOverview");
  const hintSrc = extractFunctionSource(src, "taskChecksTabHint");
  const hint = new Function(`${hintSrc}\nreturn taskChecksTabHint;`)() as (
    iv: unknown,
  ) => string;

  // Integrated success: 2 files, 4 checks passed → badge "4".
  const successIv = {
    available: true,
    conclusion: "passed",
    totalCount: 4,
    failedCount: 0,
    checks: [
      { label: "a", passed: true },
      { label: "b", passed: true },
      { label: "c", passed: true },
      { label: "d", passed: true },
    ],
  };
  assert.equal(hint(successIv), "4", "integrated success Checks badge is 4, not 0");

  // Failed verification: 1 of 4 failed.
  assert.equal(
    hint({ available: true, conclusion: "failed", totalCount: 4, failedCount: 1 }),
    "1/4",
    "failed verification Checks badge is failed/total",
  );
  assert.ok(overview.includes("taskOvChecksFailed"), "Overview can state failed/total");
  assert.ok(overview.includes("failureSummary"), "Overview can show the first safe failure summary");

  // Active work: verification not started → no numeric pass claim.
  assert.equal(hint({ available: false }), "", "active Task Checks badge stays empty");
  assert.ok(overview.includes("taskOvExecutionInProgress"), "active execution conclusion exists");
  assert.ok(overview.includes("taskOvPendingWorker"), "active delivery stays pending");
  assert.ok(overview.includes('statusText === "running"'), "running status keeps delivery pending");

  // No-change Task: zero files still honest.
  assert.ok(overview.includes("taskOvExecutionSummary"), "no-change still reports attempt/file counts");
  assert.ok(overview.includes("String(files.length)"), "file count may be zero without inventing output");

  // Legacy Task without rich journey: missing presentation and verification.
  assert.ok(overview.includes("storyInputMissing"), "legacy missing brief is stated");
  assert.ok(overview.includes("taskOvChecksNotRun"), "legacy missing checks are unavailable, not zero-pass");
  assert.ok(overview.includes("taskOvNoOutput"), "legacy missing delivery is unavailable, not invented");
  assert.equal(hint(undefined), "", "legacy missing verification has no numeric success");

  // Machine/Main/delivery remain separate: main review is not used as check conclusion.
  assert.ok(overview.includes("taskReportMainDecision"), "Main decision stays on the delivery step");
  assert.ok(
    overview.indexOf("task-ov-final-output") < overview.indexOf("taskReportMainDecision")
      || overview.includes("fd.mainReview"),
    "Main decision is associated with final delivery, not independent checks",
  );
});

test("FL-108D1 Task Detail story layout stays scannable without a new visual system", async () => {
  const css = await readFile(path.join(hubPublic, "app.css"), "utf8");
  assert.ok(css.includes(".task-four-section"), "overview story container ships");
  assert.ok(css.includes(".four-section-step"), "numbered step markers ship");
  assert.ok(css.includes(".four-section-card:not(:last-child)::after"), "subtle step connectors ship");
  assert.ok(css.includes(".task-result-claim-disclosure"), "Worker claim disclosure styles ship");
  assert.match(css, /\.four-section-card\s*\{[\s\S]*?overflow-wrap:\s*anywhere/,
    "story cards wrap long text");
  assert.match(css, /\.four-section-next\s*\{[\s\S]*?min-height:\s*32px/,
    "next-action block keeps a practical target height");
  assert.match(css, /\.task-result-claim-disclosure\s*>\s*summary\s*\{[\s\S]*?min-height:\s*32px/,
    "claim disclosure summary meets a practical touch target");
  assert.match(
    css,
    /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.four-section-card/,
    "mobile breakpoint restyles the four-step story",
  );
  // Still uses existing token language rather than a new palette.
  assert.match(css, /\.four-section-conclusion\.ok\s*\{[\s\S]*?var\(--green/,
    "pass conclusion uses existing green token");
  assert.match(css, /\.four-section-conclusion\.err\s*\{[\s\S]*?var\(--red/,
    "fail conclusion uses existing red token");
});

// --- FL-108D2: remove three misleading Task Detail cues ---

test("FL-108D2 English and Chinese step titles have one visible number via the marker only", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  const overview = extractFunctionSource(src, "renderFourSectionOverview");

  // Marker remains the sole ordinal; DOM order is unchanged.
  assert.ok(overview.includes('h("div", "four-section-step", "1")'), "marker 1 ships");
  assert.ok(overview.includes('h("div", "four-section-step", "2")'), "marker 2 ships");
  assert.ok(overview.includes('h("div", "four-section-step", "3")'), "marker 3 ships");
  assert.ok(overview.includes('h("div", "four-section-step", "4")'), "marker 4 ships");
  assert.ok(overview.includes('t("taskOvMainAsked")'), "step 1 title key remains");
  assert.ok(overview.includes('t("taskOvWorkerReturned")'), "step 2 title key remains");
  assert.ok(overview.includes('t("taskOvIndependentResult")'), "step 3 title key remains");
  assert.ok(overview.includes('t("taskOvFinalOutput")'), "step 4 title key remains");

  function labelOf(section: string, key: string): string {
    const match = new RegExp(`${key}['"]?\\s*:\\s*"([^"]+)"`).exec(section);
    return match?.[1] ?? "";
  }

  const stepKeys = [
    "taskOvMainAsked",
    "taskOvWorkerReturned",
    "taskOvIndependentResult",
    "taskOvFinalOutput",
  ] as const;
  for (const key of stepKeys) {
    const en = labelOf(enSection, key);
    const zh = labelOf(zhSection, key);
    assert.ok(en.length > 0, `en ${key} present`);
    assert.ok(zh.length > 0, `zh ${key} present`);
    assert.doesNotMatch(en, /^\s*\d+[\.\u3001\uff0e\)]\s*/,
      `en ${key} has no numeric prefix (marker owns the ordinal)`);
    assert.doesNotMatch(zh, /^\s*\d+[\.\u3001\uff0e\)]\s*/,
      `zh ${key} has no numeric prefix (marker owns the ordinal)`);
  }
});

test("FL-108D2 execution-count conclusion stays outcome-neutral in every lifecycle state", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const overview = extractFunctionSource(src, "renderFourSectionOverview");

  // Counts are facts: never append ok/err based on attempts, files, or status.
  assert.ok(
    overview.includes('h("div", "four-section-conclusion", execConclusion)'),
    "execution conclusion uses the base neutral class only",
  );
  assert.ok(
    !/execTone/.test(overview),
    "no outcome-tone variable remains on the execution-count step",
  );
  assert.ok(
    !/attempts\.length\s*\?\s*["'] ok["']/.test(overview),
    "attempt presence never paints the execution step green",
  );
  // Check and delivery steps still own pass/fail / delivery meaning.
  assert.ok(
    overview.includes('four-section-conclusion" + (passedAll ? " ok" : " err")'),
    "independent-check conclusion still carries pass/fail tone",
  );
  assert.ok(overview.includes('"four-section-conclusion ok", t("taskOvIntegrated")')
    || overview.includes('four-section-conclusion ok", t("taskOvIntegrated")'),
    "delivery success tone remains on the delivery step");
  assert.ok(overview.includes("taskOvExecutionSummary"), "success path still shows counts");
  assert.ok(overview.includes("taskOvExecutionInProgress"), "active path still shows in-progress copy");
  assert.ok(overview.includes("taskOvExecutionNoAttempts"), "legacy/no-attempt path still shows empty counts");
});

test("FL-108D2 build and fallback check labels are readable and outcome-neutral in both languages", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const i18n = await readFile(path.join(hubPublic, "i18n.js"), "utf8");
  const { enSection, zhSection } = splitI18n(i18n);
  const labelSrc = extractFunctionSource(src, "readableVerificationCheckLabel");

  function labelOf(section: string, key: string): string {
    const match = new RegExp(`${key}['"]?\\s*:\\s*"([^"]+)"`).exec(section);
    return match?.[1] ?? "";
  }

  const enBuild = labelOf(enSection, "journeyCheckProjectBuild");
  const zhBuild = labelOf(zhSection, "journeyCheckProjectBuild");
  const enFallback = labelOf(enSection, "journeyCheckAcceptanceFallback");
  const zhFallback = labelOf(zhSection, "journeyCheckAcceptanceFallback");
  const enFailedPrefix = labelOf(enSection, "taskOvCheckFailedLabel");
  const zhFailedPrefix = labelOf(zhSection, "taskOvCheckFailedLabel");

  assert.ok(enBuild.length > 0 && /build/i.test(enBuild), "en project-build label is readable");
  assert.ok(zhBuild.length > 0 && /构建|编译/.test(zhBuild), "zh project-build label is readable");
  assert.doesNotMatch(enBuild, /\bpass(?:es|ed)?\b/i, "en build label never claims passed");
  assert.doesNotMatch(zhBuild, /通过|失败|未通过/, "zh build label never claims pass/fail");
  assert.doesNotMatch(enFallback, /\bpass(?:es|ed)?\b|\bfail(?:ed|s)?\b/i,
    "en fallback is a neutral noun phrase");
  assert.doesNotMatch(zhFallback, /通过|失败|未通过/,
    "zh fallback is a neutral noun phrase");
  assert.match(enFallback, /acceptance check/i, "en fallback names a required acceptance check");
  assert.match(zhFallback, /验收检查/, "zh fallback names a required acceptance check");

  // Bounded command map ships for npm run build before the generic fallback.
  assert.ok(labelSrc.includes('npm run build'), "maps the known build command");
  assert.ok(labelSrc.includes("journeyCheckProjectBuild"), "build uses the dedicated readable key");
  assert.ok(labelSrc.includes("journeyCheckAcceptanceFallback"), "unmapped commands use the neutral fallback");

  const dictEn: Record<string, string> = {
    journeyCheckUiContract: "ui-contract",
    journeyCheckScriptLoads: "script-loads",
    journeyCheckProjectCompiles: "compiles",
    journeyCheckProjectBuild: enBuild,
    journeyCheckPatchFormat: "patch-format",
    journeyCheckFullProject: "full-project",
    journeyCheckAutomatedBehavior: "automated-behavior",
    journeyCheckAcceptanceFallback: enFallback,
  };
  const dictZh: Record<string, string> = {
    journeyCheckUiContract: "界面约定",
    journeyCheckScriptLoads: "脚本可加载",
    journeyCheckProjectCompiles: "编译检查",
    journeyCheckProjectBuild: zhBuild,
    journeyCheckPatchFormat: "补丁格式",
    journeyCheckFullProject: "完整测试",
    journeyCheckAutomatedBehavior: "自动化行为",
    journeyCheckAcceptanceFallback: zhFallback,
  };
  function makeT(dict: Record<string, string>) {
    return (key: string) => dict[key] ?? key;
  }
  const labelFor = (dict: Record<string, string>) => new Function("t", `
    ${labelSrc}
    return readableVerificationCheckLabel;
  `)(makeT(dict)) as (label: string) => string;

  for (const [locale, dict, buildLabel, fallbackLabel, failedPrefix] of [
    ["en", dictEn, enBuild, enFallback, enFailedPrefix],
    ["zh", dictZh, zhBuild, zhFallback, zhFailedPrefix],
  ] as const) {
    const label = labelFor(dict);
    // Integrated success path: known build command is still a neutral noun.
    assert.equal(label("npm run build"), buildLabel, `${locale} maps npm run build`);
    // Measured failed-build contradiction must never appear.
    // Note: the failed-check *prefix* may say "未通过"/"Failed"; only the
    // readable *name* must stay free of pass claims.
    const failedBuildSummary = `${failedPrefix}: ${label("npm run build")}`;
    assert.equal(failedBuildSummary, `${failedPrefix}: ${buildLabel}`,
      `${locale} failed-build summary uses the readable build name`);
    assert.doesNotMatch(buildLabel, /通过|passes|passed/i,
      `${locale} build name never claims the check passed`);
    assert.doesNotMatch(failedBuildSummary,
      /验收检查通过|acceptance check passes/i,
      `${locale} failed-build summary never embeds the old contradiction`);
    if (locale === "zh") {
      assert.notEqual(
        failedBuildSummary,
        "未通过的检查: 一项必要的验收检查通过",
        "exact measured Chinese contradiction cannot render",
      );
      assert.equal(
        failedBuildSummary,
        "未通过的检查: 项目构建检查",
        "Chinese failed build reads as failed build check, not passed acceptance",
      );
    } else {
      assert.notEqual(
        failedBuildSummary,
        "Failed check: A required acceptance check passes",
        "exact measured English contradiction cannot render",
      );
      assert.equal(
        failedBuildSummary,
        "Failed check: Project build check",
        "English failed build reads as failed build check, not passed acceptance",
      );
    }
    // Unmapped / future acceptance command stays a neutral noun phrase.
    assert.equal(label("some-future-acceptance-tool --strict"), fallbackLabel,
      `${locale} unmapped command uses neutral fallback`);
    assert.doesNotMatch(label("some-future-acceptance-tool --strict"),
      /\bpass(?:es|ed)?\b|\bfail(?:ed|s)?\b|通过|失败/,
      `${locale} fallback wording stays outcome-neutral`);
    // Known non-build mappings remain bounded and distinct.
    assert.equal(label("npx tsc --noEmit"), dict.journeyCheckProjectCompiles,
      `${locale} tsc still maps to compile label`);
    assert.equal(label("npm test"), dict.journeyCheckAutomatedBehavior,
      `${locale} test still maps to automated-behavior label`);
  }
});

test("FL-108D2 failed verification, integrated success, and active work preserve progressive evidence", async () => {
  const src = await readFile(path.join(hubPublic, "app.js"), "utf8");
  const overview = extractFunctionSource(src, "renderFourSectionOverview");
  const workbench = extractFunctionSource(src, "renderTaskWorkbench");
  const labelSrc = extractFunctionSource(src, "readableVerificationCheckLabel");

  // Failed verification: first actionable failure still surfaces with readable label.
  assert.ok(overview.includes("check-failure-summary"), "failed-check summary remains");
  assert.ok(overview.includes("readableVerificationCheckLabel(firstFailed.label)"),
    "failed summary uses the readable label helper");
  assert.ok(overview.includes("firstFailed.failureSummary"),
    "raw failure diagnostic remains reachable on Overview when present");
  assert.ok(overview.includes("taskOvChecksFailed"), "failed/total check conclusion remains");

  // Integrated success: check/delivery still communicate success; execution stays neutral.
  assert.ok(overview.includes("taskOvChecksPassed"), "all-pass check conclusion remains");
  assert.ok(overview.includes("taskOvIntegrated") || overview.includes("taskOvDelivered"),
    "delivery hero conclusions remain");
  assert.ok(
    overview.includes('h("div", "four-section-conclusion", execConclusion)'),
    "success path execution counts stay neutral",
  );

  // Active work: pending checks, neutral counts, no invented green execution verdict.
  assert.ok(overview.includes("taskOvExecutionInProgress"), "active execution copy remains");
  assert.ok(overview.includes("taskOvChecksNotRun"), "active checks stay pending");
  assert.ok(overview.includes("taskOvPendingWorker"), "active delivery stays pending");

  // Progressive raw evidence locations are preserved.
  assert.ok(workbench.includes("worker-claim-disclosure"), "original Worker report disclosure remains");
  assert.ok(workbench.includes("worker-claim-text"), "exact Worker text remains reachable");
  assert.ok(workbench.includes("taskReportArtifactsTitle"), "exact paths remain in Result & files");
  assert.ok(workbench.includes("renderRetainedCandidate(task)"), "retained Candidate remains reachable");
  // Label helper never hides the raw command by inventing pass/fail from it.
  assert.ok(!/passed\s*===|conclusion\s*===/.test(labelSrc),
    "readable label helper does not inspect check outcome");
});
