/* ForkLight Hub - configure + operate. textContent only; no HTML injection. */
var $ = function(s){ return document.querySelector(s); };
var $$ = function(s){ return document.querySelectorAll(s); };
function h(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; }
function hd(tag, cls, kids){ var e = document.createElement(tag); if(cls) e.className = cls; if(kids) kids.forEach(function(k){ if(k) e.appendChild(k); }); return e; }
function td(cls, text){ return h("td", cls, text); }
function badge(s){
  var m = {
    "succeeded":"badge-ok","completed":"badge-ok",
    "running":"badge-info","active":"badge-info","preparing":"badge-warn","verifying":"badge-warn",
    "queued":"badge-dim","waiting":"badge-dim","pending":"badge-dim","stopped":"badge-dim",
    "blocked":"badge-err","failed":"badge-err","interrupted":"badge-err"
  };
  return h("span", "badge " + (m[s] || "badge-dim"), statusLabel(s));
}
function statusLabel(status){
  var map = { succeeded: "statusSucceeded", completed: "statusCompleted", running: "statusRunning",
    active: "statusActive", preparing: "statusPreparing", verifying: "statusVerifying",
    queued: "statusQueued", waiting: "statusWaiting", pending: "statusPending",
    blocked: "statusBlocked", failed: "statusFailed", interrupted: "statusInterrupted",
    stopped: "statusStopped" };
  return t(map[status] || "statusUnknown");
}
function activityLabel(activity){
  var map = {
    active: "taskActivityActive",
    quiet: "taskActivityQuiet",
    stalled: "taskActivityStalled",
    terminal: "taskActivityTerminal"
  };
  return t(map[activity] || "taskActivityUnknown");
}
/* Read the canonical live-stage projection from list or detail payloads.
 * UI translates closed codes only; it never recomputes lifecycle semantics. */
function taskLiveStage(task){
  var p = task && (task.progress || (task.decision && task.decision.progress));
  return p && p.liveStage ? p.liveStage : null;
}
function liveStageNowText(stage){
  var map = {
    "preparing-workspace": "liveStageNowPreparing",
    "waiting-for-model": "liveStageNowWaitingModel",
    "model-processing": "liveStageNowModelProcessing",
    "model-responding": "liveStageNowModelResponding",
    "using-tool": "liveStageNowUsingTool",
    "worker-finished": "liveStageNowWorkerFinished",
    "verifying": "liveStageNowVerifying",
    "completed": "liveStageNowCompleted",
    "failed": "liveStageNowFailed",
    "interrupted": "liveStageNowInterrupted",
    "legacy-running": "liveStageNowLegacy",
    "queued": "liveStageNowQueued",
    "unknown": "liveStageNowUnknown",
    "candidate-reverifying": "liveStageNowCandidateReverifying",
    "remediation-checking": "liveStageNowRemediationChecking"
  };
  return t(map[stage] || "liveStageNowUnknown");
}
/* Stage-aware meaning: choose the frozen category from closed stage +
 * observation codes only - never recompute lifecycle or parse prose here.
 * Attention > quiet > completed > active progress > ordinary waiting. */
function liveStageMeaningText(meaning, observation, stage){
  if(stage === "failed" || stage === "interrupted" || meaning === "attention"){
    return t("liveStageMeaningAttention");
  }
  if(stage === "candidate-reverifying" || stage === "remediation-checking"){
    return observation === "quiet"
      ? t("liveStageMeaningFollowUpQuiet")
      : t("liveStageMeaningFollowUp");
  }
  if(observation === "quiet") return t("liveStageMeaningQuiet");
  if(stage === "completed") return t("liveStageMeaningCompleted");
  if(stage === "model-processing") return t("liveStageMeaningProcessing");
  if(stage === "model-responding" || stage === "using-tool"
      || stage === "verifying" || stage === "worker-finished"
      || stage === "legacy-running"){
    return t("liveStageMeaningActive");
  }
  return t("liveStageMeaningWaiting");
}
function liveStageNextText(next){
  var map = {
    "wait-for-preparation": "liveStageNextPreparation",
    "wait-for-model": "liveStageNextModel",
    "wait-for-tool-result": "liveStageNextTool",
    "wait-for-next-model-step": "liveStageNextModelStep",
    "wait-for-verification-start": "liveStageNextVerificationStart",
    "wait-for-verification-result": "liveStageNextVerification",
    "wait-for-new-evidence": "liveStageNextEvidence",
    "inspect-failure": "liveStageNextInspectFailure",
    "none": "liveStageNextNone",
    "wait-for-reverification-result": "liveStageNextReverification",
    "wait-for-remediation-result": "liveStageNextRemediation"
  };
  return t(map[next] || "liveStageNextNone");
}
/* Compact board line: now · meaning · next from closed liveStage codes. */
function liveStageCompactText(live){
  if(!live || !live.stage) return "";
  return t("liveStageCompact", {
    now: liveStageNowText(live.stage),
    meaning: liveStageMeaningText(live.meaning, live.observation, live.stage),
    next: liveStageNextText(live.next)
  });
}
/* Expanded Task Detail explanation from the same bounded projection. */
function liveStageDetailText(live){
  if(!live || !live.stage) return "";
  return t("liveStageDetail", {
    now: liveStageNowText(live.stage),
    meaning: liveStageMeaningText(live.meaning, live.observation, live.stage),
    next: liveStageNextText(live.next)
  });
}
/* Board-only presentation: map progress dual clocks (+ silence age) to a
 * short badge. Does not invent a machine status or change taskLane.
 * Fresh Runtime signal means the Worker recently spoke. That is not proof of
 * network health or failure, even when effective progress is old. Long quiet
 * without a Runtime signal is still only "no new evidence" (never failure,
 * retry, cancellation, or a network diagnosis). */
function boardActivityKind(task){
  var p = task && task.progress;
  var dual = p && p.dualClock;
  if(dual){
    if(dual.runtimeSignalObservation === "terminal") return null;
    // Fresh Runtime communication: Worker is responding. Stalled work without
    // a substantive step is explained by dual-clock copy, not as disconnect.
    if(dual.runtimeSignalObservation === "active") return "active";
    if(dual.runtimeSignalObservation === "quiet"){
      var progressTs = dual.latestEffectiveProgressAt || dual.latestRuntimeSignalAt;
      if(progressTs){
        var dualAge = Date.now() - Date.parse(progressTs);
        if(Number.isFinite(dualAge) && dualAge >= 5 * 60 * 1000) return "stalled";
      }
      return "quiet";
    }
  }
  var live = taskLiveStage(task);
  if(live && live.observation === "terminal") return null;
  if(live && live.observation === "active") return "active";
  if(live && live.observation === "quiet"){
    // Silence age follows Runtime signal, then lastEventAt, never invents disconnect.
    var quietTs = (p && p.latestRuntimeSignalAt)
      || (p && p.lastEventAt)
      || live.observedAt;
    if(quietTs){
      var age = Date.now() - Date.parse(quietTs);
      // 5 minutes: long-run board signal only; not a machine failure.
      if(Number.isFinite(age) && age >= 5 * 60 * 1000) return "stalled";
    }
    return "quiet";
  }
  if(!p || !p.activity) return null;
  if(p.activity === "terminal") return null;
  if(p.activity === "active") return "active";
  if(p.activity !== "quiet") return null;
  if(p.lastEventAt){
    var age2 = Date.now() - Date.parse(p.lastEventAt);
    // 5 minutes: long-run board signal only; not a machine status.
    if(Number.isFinite(age2) && age2 >= 5 * 60 * 1000) return "stalled";
  }
  return "quiet";
}
/* Plain-language dual-clock line for board cards and Task Detail.
 * Describes recent Runtime communication vs last substantive step without
 * field names, raw telemetry, or Provider/network health claims. */
function dualClockPlainText(progress){
  if(!progress) return null;
  var runtimeAt = progress.latestRuntimeSignalAt
    || (progress.dualClock && progress.dualClock.latestRuntimeSignalAt);
  var progressAt = progress.latestEffectiveProgressAt
    || (progress.dualClock && progress.dualClock.latestEffectiveProgressAt);
  if(!runtimeAt && !progressAt) return null;
  var dual = progress.dualClock;
  var runtimeText = runtimeAt ? fmtSince(runtimeAt) : t("taskDualClockUnknown");
  // Baseline / unknown are not substantive progress timestamps.
  var progressText;
  if(dual && dual.effectiveProgressObservation === "baseline"){
    progressText = t("taskDualClockBaseline");
  } else if(dual && dual.effectiveProgressKnown && progressAt){
    progressText = fmtSince(progressAt);
  } else if(dual && dual.effectiveProgressObservation === "unknown"){
    progressText = t("taskDualClockUnknown");
  } else if(progressAt && dual && dual.effectiveProgressObservation === "terminal" && dual.effectiveProgressKnown){
    progressText = fmtSince(progressAt);
  } else if(!dual && progressAt){
    progressText = fmtSince(progressAt);
  } else {
    progressText = t("taskDualClockUnknown");
  }
  if(dual
    && dual.runtimeSignalObservation === "active"
    && (dual.effectiveProgressObservation === "quiet"
      || dual.effectiveProgressObservation === "baseline"
      || dual.effectiveProgressObservation === "unknown")){
    if(dual.effectiveProgressObservation === "baseline"){
      return t("taskDualClockStalledBaseline", { runtime: runtimeText });
    }
    return t("taskDualClockStalled", {
      runtime: runtimeText,
      progress: progressText
    });
  }
  return t("taskDualClockBoard", {
    runtime: runtimeText,
    progress: progressText
  });
}
function dualClockNextText(progress){
  var dual = progress && progress.dualClock;
  if(!dual || !dual.next) return null;
  var map = {
    "wait-for-runtime": "taskDualClockNextRuntime",
    "wait-for-effective-progress": "taskDualClockNextProgress",
    "wait-for-new-evidence": "taskDualClockNextEvidence",
    "inspect-failure": "taskDualClockNextInspect",
    "none": "taskDualClockNextNone"
  };
  return t(map[dual.next] || "taskDualClockNextNone");
}
function boardActivityBadge(task){
  var kind = boardActivityKind(task);
  if(!kind) return null;
  // Long quiet uses warn, never err: silence is not failure evidence.
  var cls = kind === "active" ? "badge-info" : "badge-warn";
  return h("span", "badge " + cls + " board-activity board-activity-" + kind, activityLabel(kind));
}
/* Decision-drawer labels: the English literal is retained as the canonical
 * concept name and a defensive fallback; the active locale's translation is
 * rendered when the i18n key is present. Keeps the decision drawer bilingual
 * without renaming the underlying concepts. */
function decLabel(key, en){
  var v = t(key);
  return v === key ? en : v;
}
/* Flexible Quality policy modes: the canonical backend values hard, warn,
 * score, and off are preserved as option values and in patch payloads. Only
 * the displayed text is localized, with a short effect explanation. */
var POLICY_MODE_VALUES = ["hard", "warn", "score", "off"];
var POLICY_MODE_LABELS = {
  hard: "policyModeHard",
  warn: "policyModeWarn",
  score: "policyModeScore",
  off: "policyModeOff"
};
var POLICY_MODE_HINTS = {
  hard: "policyModeHardHint",
  warn: "policyModeWarnHint",
  score: "policyModeScoreHint",
  off: "policyModeOffHint"
};
function policyModeLabel(value){
  var key = POLICY_MODE_LABELS[value];
  return key ? t(key) : String(value);
}
function policyModeOptionText(value){
  var key = POLICY_MODE_LABELS[value];
  if(!key) return String(value);
  return t(key) + " - " + t(POLICY_MODE_HINTS[value]);
}
/* Builds the flexible-mode <select> with canonical option values and
 * localized display labels. Used by Worker Advanced settings and the Task
 * adaptation panel so the two stay in sync. */
function buildPolicyModeSelect(selected){
  var sel = h("select", "");
  POLICY_MODE_VALUES.forEach(function(m){
    var o = document.createElement("option");
    o.value = m;
    o.textContent = policyModeOptionText(m);
    sel.appendChild(o);
  });
  if(selected) sel.value = String(selected);
  return sel;
}
/* Concise explanation placed before flexible-mode controls: what the modes
 * mean and the safety boundary they do not change. */
function policyModeNote(){
  var wrap = h("div", "policy-mode-note mb-8");
  wrap.appendChild(h("div", "summary-line dim", t("policyModeIntro")));
  wrap.appendChild(h("div", "summary-line dim fs11 mt-4", t("policyModeSafetyNote")));
  return wrap;
}
/* Drawer failure: a localized summary is prominent; any bounded diagnostic
 * from the service is retained as secondary technical evidence inside a
 * closed disclosure. The raw message is never rewritten or dropped. */
function detailErrorFragment(summaryKey, err){
  var f = fr();
  f.appendChild(closeBtn());
  f.appendChild(stateMsg("error", t(summaryKey)));
  var msg = boundedDiagnostic(err && err.message);
  if(msg){
    var details = document.createElement("details");
    details.className = "audit-details detail-error-tech";
    var summary = document.createElement("summary");
    summary.textContent = t("detailTechError");
    details.appendChild(summary);
    details.appendChild(h("div", "summary-line mono fs11", msg));
    f.appendChild(details);
  }
  return f;
}
/* Compact Main-verified final-delivery badge. Machine outcome stays as the
 * primary badge (status); this is a separate named fact, never a relabel.
 * Presence of remediationDisposition.status === "verified-repaired-delivered"
 * is the only trigger; absence leaves the card untouched. */
function finalDeliveryBadge(task){
  var d = task && task.remediationDisposition;
  if(!d || d.status !== "verified-repaired-delivered") return null;
  var b = h("span", "badge badge-ok badge-final-delivery", t("taskFinalDeliveryBadge"));
  b.setAttribute("data-fl-role", "final-delivery");
  b.title = t("taskFinalDeliveryBadgeHint");
  return b;
}
function hasVerifiedFinalDelivery(task){
  if(!task) return false;
  var direct = task.remediationDisposition;
  var decision = task.decision && task.decision.remediationDisposition;
  var journey = task.journey && task.journey.finalDelivery && task.journey.finalDelivery.remediationDisposition;
  return [direct, decision, journey].some(function(item){
    return item && item.status === "verified-repaired-delivered";
  });
}
/* Task headline projection: the single most user-relevant outcome for the
 * prominent Task badge on the board card and the Task Detail hero. Verified
 * final delivery and the Main/delivery decisionStage take precedence over
 * the machine status, so a machine-successful Candidate that Main asked to
 * revise can never be presented as accepted or delivered. Pure presentation
 * only: it never mutates machine truth, lane, filter, or lifecycle state,
 * and the full journey keeps the Worker result, independent checks, Main
 * decision, and delivery as separate evidence. */
function taskHeadline(task){
  var stageMap = {
    "awaiting-main-review": { labelKey: "taskHeadlineAwaitingReview", tone: "badge-warn", delivered: false },
    "revision-requested": { labelKey: "taskHeadlineRevisionRequested", tone: "badge-warn", delivered: false },
    "main-rejected": { labelKey: "taskHeadlineRejected", tone: "badge-err", delivered: false },
    "ready-for-integration": { labelKey: "taskHeadlineReadyIntegration", tone: "badge-info", delivered: false },
    "integrating": { labelKey: "taskHeadlineIntegrating", tone: "badge-info", delivered: false },
    "applied-not-activated": { labelKey: "taskHeadlineAppliedNotActivated", tone: "badge-warn", delivered: false },
    "delivered": { labelKey: "taskHeadlineDeliveredNoActivation", tone: "badge-ok", delivered: true },
    "activated": { labelKey: "taskHeadlineVerifiedDelivery", tone: "badge-ok", delivered: true },
    "integration-failed": { labelKey: "taskHeadlineIntegrationFailed", tone: "badge-err", delivered: false }
  };
  var machineMap = {
    "succeeded": { labelKey: "taskHeadlineMachinePassed", tone: "badge-ok", delivered: false },
    "completed": { labelKey: "taskHeadlineMachinePassed", tone: "badge-ok", delivered: false },
    "running": { labelKey: "statusRunning", tone: "badge-info", delivered: false },
    "active": { labelKey: "statusActive", tone: "badge-info", delivered: false },
    "preparing": { labelKey: "statusPreparing", tone: "badge-warn", delivered: false },
    "verifying": { labelKey: "statusVerifying", tone: "badge-warn", delivered: false },
    "queued": { labelKey: "statusQueued", tone: "badge-dim", delivered: false },
    "waiting": { labelKey: "statusWaiting", tone: "badge-dim", delivered: false },
    "pending": { labelKey: "statusPending", tone: "badge-dim", delivered: false },
    "blocked": { labelKey: "statusBlocked", tone: "badge-err", delivered: false },
    "failed": { labelKey: "statusFailed", tone: "badge-err", delivered: false },
    "interrupted": { labelKey: "statusInterrupted", tone: "badge-err", delivered: false }
  };
  if(hasVerifiedFinalDelivery(task)){
    return { labelKey: "taskHeadlineVerifiedDelivery", tone: "badge-ok", delivered: true };
  }
  var stage = task && task.decisionStage;
  var stageEntry = stage ? stageMap[stage] : null;
  if(stageEntry) return stageEntry;
  var status = task && task.status;
  var machineEntry = status ? machineMap[status] : null;
  if(machineEntry) return machineEntry;
  return { labelKey: "statusUnknown", tone: "badge-dim", delivered: false };
}
/* Prominent Task badge built from the headline projection. Used by the
 * kanban card and the Task Detail hero so the first status a user sees
 * follows the latest Main/delivery outcome instead of the raw machine
 * status. The full journey still shows the machine result, independent
 * checks, Main decision, and delivery as separate evidence. */
function taskHeadlineBadge(task){
  var hl = taskHeadline(task);
  var b = h("span", "badge " + hl.tone + " task-headline", t(hl.labelKey));
  b.setAttribute("data-fl-role", "task-headline");
  return b;
}
function badgeTd(s){ var b = td(""); b.appendChild(badge(s)); return b; }
function progBar(p){
  var el = h("progress", "progress-bar");
  el.setAttribute("max", "100");
  el.setAttribute("value", p && p.total > 0 ? String(Math.round(p.completed / p.total * 100)) : "0");
  return el;
}
function stateMsg(kind, text){ return h("div", "state-msg " + kind, text); }
function sec(title){ return h("div", "section-title", title); }
function fr(){ return document.createDocumentFragment(); }

function t(key, vars){
  if(window.ForklightI18n && typeof window.ForklightI18n.t === "function"){
    return window.ForklightI18n.t(key, vars);
  }
  return key;
}
function pageMeta(tab){
  if(window.ForklightI18n && typeof window.ForklightI18n.pageMeta === "function"){
    return window.ForklightI18n.pageMeta(tab);
  }
  return { title: tab, sub: "" };
}
function getTheme(){
  try {
    var stored = localStorage.getItem("fl-theme");
    if(stored === "dark" || stored === "light") return stored;
  } catch(_){}
  var attr = document.documentElement.getAttribute("data-theme");
  if(attr === "dark" || attr === "light") return attr;
  if(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}
function applyTheme(theme){
  var next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("fl-theme", next); } catch(_){}
  var lightBtn = $("#fl-theme-light");
  var darkBtn = $("#fl-theme-dark");
  if(lightBtn) lightBtn.classList.toggle("active", next === "light");
  if(darkBtn) darkBtn.classList.toggle("active", next === "dark");
}
function applyChromeI18n(){
  $$("[data-i18n]").forEach(function(el){
    var key = el.getAttribute("data-i18n");
    if(key) el.textContent = t(key);
  });
  var lang = window.ForklightI18n ? window.ForklightI18n.getLang() : "zh";
  var zhBtn = $("#fl-lang-zh");
  var enBtn = $("#fl-lang-en");
  if(zhBtn) zhBtn.classList.toggle("active", lang === "zh");
  if(enBtn) enBtn.classList.toggle("active", lang === "en");
  applyTheme(getTheme());
  document.title = "ForkLight · " + t("brandSub");
}

var S = {
  settings: null, health: null, boards: null, tasks: null, competitions: null, stats: null,
  goals: null,
  workHierarchy: null,
  workHierarchyError: null,
  /* Work bench filter state. workFilterDraft holds form values; workFilter is
   * the applied filter sent to /api/ops/work-hierarchy. workFilterOptions is
   * derived from the last unfiltered projection so the selects keep their full
   * choice set while a Core-filtered view is showing. */
  workFilterDraft: { project: "", columns: "", workerProfileId: "" },
  workFilter: {},
  /* FL-112B: one semantic portfolio selection. This is presentation state
   * only; Core remains the sole owner of lifecycle and ancestry truth. */
  workSelection: null,
  workTreeQuery: "",
  workTreeWidth: 280,
  workTreeScope: "now",
  workMobilePane: "tree",
  /* FL-112E3: the viewed phase is browser-only navigation. It is kept beside
   * the selected Goal so a poll can rebuild the board without changing which
   * phase the user is reading. No phase click calls a mutation or refresh. */
  workViewedGoalId: null,
  workViewedPlanId: null,
  /* projects holds exact project path values for the filter request; presentation
   * labels and omitted-internal count are derived at render time. */
  workFilterOptions: { projects: [], workers: [], omittedInternalProjects: 0 },
  /* One-off history stays lazy; these two values keep an in-progress search
   * field stable across evidence rebuilds without changing the server query. */
  workOneOffSearch: "",
  workOneOffSearchDraft: "",
  economics: null,
  economicsError: null,
  routingCoverage: null,
  routingCoverageError: null,
  mainDirectAggregate: null,
  mainDirectAggregateError: null,
  mainDirectRecent: null,
  mainDirectRecentError: null,
  selfUpgradeEvidence: null,
  selfUpgradeEvidenceError: null,
  sample: null,
  healthError: null, tasksError: null, boardsError: null, competitionsError: null,
  goalsError: null, statsError: null, settingsError: null, sampleError: null,
  hub: null,
  lastOk: 0, connected: false, hadOk: false, tab: "work",
  detail: null, detailTaskId: null, detailReturnFocus: null, timer: null, token: null,
  taskCrumb: null,
  /* FL-109C2A: bounded presentation-only handoff chosen by drag or the
   * Move/Act chooser. Never submitted here; existing controls execute it. */
  pendingActionHandoff: null,
  batchInFlight: false, pendingRefresh: false,
  workerEditId: null, workerPreviewTimer: null, workerFormActive: false,
  /* FL-116A: which settings groups are open plus the selected Worker survive a
   * Worker page re-render (polling, language switch). workerDraft preserves the
   * full unsaved form on any deliberate rWorker rebuild (language switch, tab
   * return); workerPreviewRows holds the latest backend effective preview. */
  workerOpenGroups: {},
  workerDraft: null,
  workerFormRendered: false,
  /* Identifies the Worker whose form is currently in the DOM. This prevents
   * an explicit row switch from capturing the previous Worker's draft and
   * restoring it into the newly selected Worker. null is the create form. */
  workerFormContextId: null,
  workerRenderedTruthKey: null,
  workerPreviewRows: null,
  workerQualityPreviewRows: null,
  workerSummariesRefresher: null,
  mrResult: null, mrDirty: false, mrEvaluating: false, mrDraft: null,
  mrTaskClass: "", mrTaskFamily: "", mrCompIntent: "", mrCompTriggers: "",
  mrCandidates: [],
  deliveryDraft: null, deliveryDirty: false, deliveryEditId: null, deliverySaving: false,
  deliveryErrors: [],
  /* FL-109D2: outcome-first intake. outcomeDraft preserves every entered field
   * across renders; on validation/network/Daemon failure nothing is cleared.
   * outcomeSubmitting is single-flight; the page never auto-retries. */
  outcomeDraft: { outcome: "", project: "", context: "", requestedShape: "auto" },
  /* The add action's visual location supplies the intended Goal / Plan / Task
   * shape and exact canonical parent. It is presentation state only; durable
   * creation still goes through the existing intake proposal + confirmation. */
  workCreateTarget: null,
  outcomeSubmitting: false,
  outcomeCreateError: null,
  outcomeFormActive: false,
  intakes: null,
  intakesError: null,
  selectedIntakeId: null,
  /* FL-109D3B: explicit Hub confirmation. outcomeConfirmingId marks the intake
   * whose contained confirmation step is open; outcomeConfirmPendingId is
   * single-flight for the active create request; outcomeConfirmError preserves
   * the last bounded failure key so the proposed preview stays readable. */
  outcomeConfirmingId: null,
  outcomeConfirmPendingId: null,
  outcomeConfirmError: null,
  /* FL-112E9: bounded created-work navigation intent. Consumes only the
   * durable confirmation ids and the refreshed canonical WorkHierarchyView;
   * never optimistic and never invents a card, parent, or success. */
  outcomeCreatedNavigate: null,
  /* Transient Task-drawer intent produced only after the created workspace
   * (Independent Tasks) is selected and the canonical card is present. */
  outcomeCreatedTaskDrawer: null,
  /* FL-112A: last render-relevant Work truth snapshot (stable string). Used to
   * skip Work DOM replacement when a poll changes only chrome/clock noise. */
  workRenderSnapshot: null
};
var viewEl, detailEl, statusEl, footerEl, titleEl, subEl, topMetaEl, scrimEl;
/* FL-112F: bounded, presentation-only Work context for a full browser reload.
 * The raw record is read before the first fetch only as an intent. It is not
 * applied until the canonical Work hierarchy has loaded and every id/option
 * can be checked against that truth. */
var WORK_READING_CONTEXT_KEY = "fl-work-reading-context";
var WORK_READING_CONTEXT_VERSION = 1;
var WORK_READING_CONTEXT_MAX_CHARS = 12000;
var WORK_READING_CONTEXT_MAX_ID_CHARS = 180;
var WORK_READING_CONTEXT_MAX_COLLAPSE = 48;
var WORK_READING_CONTEXT_DISCLOSURES = [
  "finishedOpen", "advancedOpen", "expertDetailsOpen", "goalSummaryOpen",
  "filtersOpen", "oneOffCurrentOpen", "oneOffAttentionOpen", "oneOffHistoryOpen",
  "shapeGuideOpen", "pageStoryOpen", "outcomeAdvancedOpen", "goalFileEvidenceOpen"
];
var SYSTEM_TABS = ["model", "worker", "mains", "delivery", "competitions", "stats", "limits"];
var GOAL_TREE_WIDTH_MIN = 200;
var GOAL_TREE_WIDTH_MAX = 420;
var GOAL_TREE_WIDTH_DEFAULT = 280;
var GOAL_FILE_CURRENT_CODES = [
  "waiting-user-decision", "running", "waiting-verification", "ready", "not-started"
];
var GOAL_FILE_BLOCKED_CODES = ["stopped-failed"];
var GOAL_FILE_HISTORY_CODES = ["completed"];
var WORK_READING_CONTEXT_TABS = [
  "overview", "instruction", "process", "result", "checks", "actions", "more"
];
var workReadingContextPending = null;
var workReadingContextApplied = false;
var workReadingContextReady = false;
var workReloadRestoreContext = null;
var workReloadBoardScrollRestored = false;
var workReloadDetailScrollTop = null;
var workInitialSelectionNeedsFocus = false;
var workBoardFocusRequest = null;
/* Model-routing weight field identifiers shared by editor and result renderer. */
var MR_WEIGHT_KEYS = [
  ["acceptedDelivery", "mrPolicyAcceptedDelivery", "mrPolicyAcceptedDeliveryHint"],
  ["verifiedBehavior", "mrPolicyVerifiedBehavior", "mrPolicyVerifiedBehaviorHint"],
  ["modelQualityFailure", "mrPolicyModelQualityFailure", "mrPolicyModelQualityFailureHint"],
  ["correctionChurn", "mrPolicyCorrectionChurn", "mrPolicyCorrectionChurnHint"],
  ["firstPassSuccess", "mrPolicyFirstPassSuccess", "mrPolicyFirstPassSuccessHint"],
  ["officialCost", "mrPolicyOfficialCost", "mrPolicyOfficialCostHint"],
  ["duration", "mrPolicyDuration", "mrPolicyDurationHint"],
  ["budgetReliability", "mrPolicyBudgetReliability", "mrPolicyBudgetReliabilityHint"]
];
/* Default weight when a draft omits a known factor key. */
function mrWeightDefault(keyStr){
  if(keyStr === "officialCost" || keyStr === "duration" || keyStr === "budgetReliability") return 0;
  if(keyStr === "firstPassSuccess" || keyStr === "modelQualityFailure") return 0.5;
  if(keyStr === "correctionChurn") return 0.2;
  return 1;
}
/* Tab-scoped only: survives same-tab refresh, never localStorage/cookies. */
var HUB_TOKEN_SESSION_KEY = "fl-hub-session-token";

/* Translate a budgetReliability unavailable reason into a plain-language key.
 *  Reasons not covered here fall back to the generic mrFactorUnavailable copy. */
function budgetReliabilityReasonKey(reason){
  if(reason === "budget-reliability-missing-bounded-evidence") return "mrBudgetReliabilityEnvelopeMissing";
  if(reason === "budget-reliability-mixed-envelope-candidate") return "mrBudgetReliabilityEnvelopeMixedCandidate";
  if(reason === "budget-reliability-mixed-envelope-cross-candidate") return "mrBudgetReliabilityEnvelopeMismatch";
  if(reason === "budget-reliability-coverage-incomplete") return "mrBudgetReliabilityCoverageIncomplete";
  return null;
}

function budgetEnvelopeText(envelope){
  if(!envelope || typeof envelope !== "object") return t("decUnavailable");
  var parts = [];
  if(typeof envelope.runtimeBudgetUsd === "number" && Number.isFinite(envelope.runtimeBudgetUsd)){
    parts.push(t("mrBudgetEnvelopeUsd", { value: String(envelope.runtimeBudgetUsd) }));
  }
  if(typeof envelope.observedTokenCeiling === "number" && Number.isFinite(envelope.observedTokenCeiling)){
    parts.push(t("mrBudgetEnvelopeTokens", { value: String(envelope.observedTokenCeiling) }));
  }
  return parts.length ? parts.join(" + ") : t("decUnavailable");
}

/* --- Hub session token lifecycle (fragment -> memory -> tab sessionStorage) --- */
function isValidHubToken(token){
  return typeof token === "string" && token.length === 43 && /^[A-Za-z0-9_-]+$/.test(token);
}
function clearHubToken(){
  S.token = null;
  try {
    if(typeof sessionStorage !== "undefined") sessionStorage.removeItem(HUB_TOKEN_SESSION_KEY);
  } catch(_){}
}
function persistHubToken(token){
  if(!isValidHubToken(token)) return;
  try {
    if(typeof sessionStorage !== "undefined") sessionStorage.setItem(HUB_TOKEN_SESSION_KEY, token);
  } catch(_){}
}
function readStoredHubToken(){
  try {
    if(typeof sessionStorage === "undefined") return null;
    var stored = sessionStorage.getItem(HUB_TOKEN_SESSION_KEY);
    if(isValidHubToken(stored)) return stored;
    if(stored != null) sessionStorage.removeItem(HUB_TOKEN_SESSION_KEY);
  } catch(_){}
  return null;
}
function stripHubTokenFragment(){
  try {
    if(window.history && history.replaceState){
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  } catch(_){}
}
function readToken(){
  var raw = window.location.hash;
  if(raw && raw.charAt(0) === "#"){
    var fragment = raw.slice(1);
    stripHubTokenFragment();
    if(isValidHubToken(fragment)){
      persistHubToken(fragment);
      return fragment;
    }
  }
  return readStoredHubToken();
}

/* --- Model-routing policy projection / semantic equality --- */
function mrFiniteNumber(value){
  if(value === "" || value === undefined || value === null) return NaN;
  var n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
}
function projectModelRoutingPolicy(source){
  var src = (source && typeof source === "object") ? source : {};
  var win = (src.weights && typeof src.weights === "object") ? src.weights : {};
  var weights = {};
  MR_WEIGHT_KEYS.forEach(function(w){
    var key = w[0];
    if(Object.prototype.hasOwnProperty.call(win, key)){
      weights[key] = mrFiniteNumber(win[key]);
    } else {
      weights[key] = mrWeightDefault(String(key));
    }
  });
  return {
    minRelevantSamples: Object.prototype.hasOwnProperty.call(src, "minRelevantSamples")
      ? mrFiniteNumber(src.minRelevantSamples) : 5,
    uncertaintyThreshold: Object.prototype.hasOwnProperty.call(src, "uncertaintyThreshold")
      ? mrFiniteNumber(src.uncertaintyThreshold) : 0.15,
    competitionOnUncertainty: src.competitionOnUncertainty !== false,
    missingEvidenceMode: src.missingEvidenceMode === "strict" ? "strict" : "flexible",
    weights: weights
  };
}
function modelRoutingPoliciesEqual(left, right){
  if(!left || !right) return false;
  if(left.minRelevantSamples !== right.minRelevantSamples) return false;
  if(left.uncertaintyThreshold !== right.uncertaintyThreshold) return false;
  if(left.competitionOnUncertainty !== right.competitionOnUncertainty) return false;
  if(left.missingEvidenceMode !== right.missingEvidenceMode) return false;
  for(var i = 0; i < MR_WEIGHT_KEYS.length; i++){
    var key = MR_WEIGHT_KEYS[i][0];
    if(left.weights[key] !== right.weights[key]) return false;
  }
  return true;
}
function isModelRoutingDraftDirty(draft, saved){
  return !modelRoutingPoliciesEqual(
    projectModelRoutingPolicy(draft),
    projectModelRoutingPolicy(saved)
  );
}

/* --- Delivery Profiles normalization / semantic equality --- */
/* Pure functions; same inputs => same outputs. Used by both the editor
 * (semantic dirty marker) and the Task renderer (truthful expected vs
 * actual evidence). None of these execute, validate, or persist anything. */
var DELIVERY_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
var DELIVERY_MAX_CMDS = 16;
var DELIVERY_MAX_PROFILES = 32;
var DELIVERY_STAGE_KEYS = ["source-applied", "source-verified", "artifact-built", "runtime-activated"];
var DELIVERY_STAGE_LABEL_KEYS = {
  "source-applied": "taskDeliveryStageSourceApply",
  "source-verified": "taskDeliveryStageSourceVerify",
  "artifact-built": "taskDeliveryStageBuild",
  "runtime-activated": "taskDeliveryStageActivate"
};
var DELIVERY_STAGE_PLAN_KEYS = {
  "source-applied": "sourceApply",
  "source-verified": "sourceVerify",
  "artifact-built": "artifactBuild",
  "runtime-activated": "runtimeActivation"
};
function deliveryIsCanonicalPath(value){
  if(typeof value !== "string" || value !== value.trim() || value === "" || value.charAt(0) !== "/") return false;
  if(value === "/") return true;
  if(value.charAt(value.length - 1) === "/" || value.indexOf("//") >= 0) return false;
  return !/(?:^|\/)\.\.?(?:\/|$)/.test(value);
}
function deliveryParseCommands(text){
  if(typeof text !== "string") return [];
  return text.split(/\r?\n/).map(function(line){
    return line.replace(/^\s+|\s+$/g, "");
  }).filter(function(line){
    return line.length > 0;
  });
}
function deliveryNormalizeCommands(value, textValue){
  var source = Array.isArray(value) ? value : deliveryParseCommands(textValue || "");
  return source.filter(function(item){ return typeof item === "string" && item.trim().length > 0; })
    .map(function(item){ return item.trim(); });
}
function deliveryNormalizeProfile(raw){
  if(raw === null || raw === undefined || typeof raw !== "object") return null;
  var src = raw;
  if(!DELIVERY_ID_RE.test(String(src.id || ""))) return null;
  var label = typeof src.label === "string" ? src.label.trim() : "";
  if(label.length < 1 || label.length > 80) return null;
  return {
    id: String(src.id),
    label: label,
    buildCommands: deliveryNormalizeCommands(src.buildCommands, src.buildCommandsText),
    activationCommands: deliveryNormalizeCommands(src.activationCommands, src.activationCommandsText),
    activationCheckCommands: deliveryNormalizeCommands(src.activationCheckCommands, src.activationCheckCommandsText)
  };
}
function deliveryNormalizeSettings(raw){
  var out = { defaultProfileId: null, profiles: [], projectBindings: {} };
  if(!raw || typeof raw !== "object") return out;
  var src = raw;
  if(typeof src.defaultProfileId === "string" && DELIVERY_ID_RE.test(src.defaultProfileId)){
    out.defaultProfileId = src.defaultProfileId;
  }
  if(Array.isArray(src.profiles)){
    src.profiles.forEach(function(p){
      var np = deliveryNormalizeProfile(p);
      if(np) out.profiles.push(np);
    });
  }
  if(src.projectBindings && typeof src.projectBindings === "object"){
    Object.keys(src.projectBindings).forEach(function(path){
      var pid = src.projectBindings[path];
      if(typeof pid !== "string" || !DELIVERY_ID_RE.test(pid)) return;
      out.projectBindings[path] = pid;
    });
  }
  return out;
}
function deliverySettingsEqual(left, right){
  if(!left || !right) return false;
  if((left.defaultProfileId || null) !== (right.defaultProfileId || null)) return false;
  if(left.profiles.length !== right.profiles.length) return false;
  for(var i = 0; i < left.profiles.length; i++){
    var a = left.profiles[i], b = right.profiles[i];
    if(!b) return false;
    if(a.id !== b.id || a.label !== b.label) return false;
    if(a.buildCommands.length !== b.buildCommands.length) return false;
    for(var j = 0; j < a.buildCommands.length; j++){
      if(a.buildCommands[j] !== b.buildCommands[j]) return false;
    }
    if(a.activationCommands.length !== b.activationCommands.length) return false;
    for(var k = 0; k < a.activationCommands.length; k++){
      if(a.activationCommands[k] !== b.activationCommands[k]) return false;
    }
    if(a.activationCheckCommands.length !== b.activationCheckCommands.length) return false;
    for(var m = 0; m < a.activationCheckCommands.length; m++){
      if(a.activationCheckCommands[m] !== b.activationCheckCommands[m]) return false;
    }
  }
  var lkeys = Object.keys(left.projectBindings).sort();
  var rkeys = Object.keys(right.projectBindings).sort();
  if(lkeys.length !== rkeys.length) return false;
  for(var n = 0; n < lkeys.length; n++){
    var kp = lkeys[n];
    if(kp !== rkeys[n]) return false;
    if(left.projectBindings[kp] !== right.projectBindings[kp]) return false;
  }
  return true;
}
function isDeliveryDraftDirty(draft, saved){
  return !deliverySettingsEqual(
    deliveryNormalizeSettings(draft),
    deliveryNormalizeSettings(saved)
  );
}
function deliveryReadSettings(){
  return deliveryNormalizeSettings(S.hub && S.hub.settings && S.hub.settings.deliveryProfiles);
}

/* --- Utils --- */
function fmtTm(iso){
  if(!iso) return "-";
  var d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function fmtSince(iso){
  if(!iso) return "-";
  var ms = Date.now() - new Date(iso).getTime();
  if(ms < 60000) return t("timeSecondsAgo", { count: String(Math.round(ms / 1000)) });
  if(ms < 3600000) return t("timeMinutesAgo", { count: String(Math.round(ms / 60000)) });
  if(ms < 86400000) return t("timeHoursAgo", { count: String(Math.round(ms / 3600000)) });
  return t("timeDaysAgo", { count: String(Math.round(ms / 86400000)) });
}
function readableDuration(ms){
  if(typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return t("workersValueInherited");
  if(ms >= 3600000 && ms % 3600000 === 0){
    return t("workersDurationHours", { count: String(ms / 3600000) });
  }
  if(ms >= 60000){
    return t("workersDurationMinutes", { count: String(Math.ceil(ms / 60000)) });
  }
  return t("workersDurationSeconds", { count: String(Math.ceil(ms / 1000)) });
}
function runtimeDisplayName(runtime){
  var names = { "claude-code": "Claude Code", "grok-build": "Grok Build", "codex-cli": "Codex CLI" };
  return names[runtime] || runtime || "?";
}
function providerDisplayName(provider){
  var names = {
    deepseek: "DeepSeek", minimax: "MiniMax", qwen: "Qwen",
    glm: "GLM", volcengine: "Volcengine", xai: "xAI", openai: "OpenAI"
  };
  return names[provider] || provider || "?";
}
function num(v, dec, tag){ if(v === undefined || v === null) return "-"; return (tag || "") + v.toFixed(dec || 0); }
function unit(v, dec, suffix){ if(v === undefined || v === null) return "-"; return v.toFixed(dec || 0) + (suffix || ""); }
function cardHead(title, sub, b){
  var d = h("div", "card-header"), l = h("div", "");
  l.appendChild(h("div", "card-title", title));
  if(sub) l.appendChild(h("div", "card-subtitle mono", sub));
  d.appendChild(l);
  if(b) d.appendChild(b);
  return d;
}
function theadRow(labels){
  var tr = document.createElement("tr");
  labels.forEach(function(l){
    tr.appendChild(h("th", l.indexOf(" numeric") >= 0 ? "numeric" : "", l.replace(" numeric", "")));
  });
  return tr;
}
function card(onActivate, children){
  var c = h("div", "card");
  c.append.apply(c, children);
  if(onActivate){
    c.setAttribute("role", "button");
    c.setAttribute("tabindex", "0");
    c.classList.add("clickable");
    c.addEventListener("click", onActivate);
    c.addEventListener("keydown", function(e){
      if(e.key === "Enter" || e.key === " "){ e.preventDefault(); onActivate.call(c); }
    });
  }
  return c;
}
function row(tableData, clickFn){
  var tr = h("tr", "clickable");
  if(clickFn){
    tr.setAttribute("tabindex", "0");
    tr.addEventListener("click", clickFn);
    tr.addEventListener("keydown", function(e){
      if(e.key === "Enter" || e.key === " "){ e.preventDefault(); clickFn(); }
    });
  }
  tableData.forEach(function(cell){ tr.appendChild(cell); });
  return tr;
}
function metric(label, value, hint){
  var m = h("div", "metric");
  m.appendChild(h("div", "metric-label", label));
  m.appendChild(h("div", "metric-value", value));
  if(hint) m.appendChild(h("div", "metric-hint", hint));
  return m;
}

/* --- Page-to-data dependency map (pure, testable without DOM) --- */
/* Each value maps a stable slice key to the endpoint that produces it.
 * render() uses requestPlan() to decide which slices a visible page needs.
 * Shared shell truth (/api/status + /api/ops/health) is always fetched;
 * everything else is per-page. */
var PAGE_DEPS = {
  overview:      { tasks: true, boards: true, competitions: true, goals: true, sample: true, selfUpgradeEvidence: true },
  work:          { workHierarchy: true, intakes: true },
  decisions:     { workHierarchy: true },
  tasks:         { tasks: true },
  plans:         { boards: true },
  goals:         { goals: true },
  competitions:  { competitions: true },
  stats:         { stats: true, economics: true, routingCoverage: true, mainDirectAggregate: true, mainDirectRecent: true },
  model:         {},
  worker:        {},
  limits:        {},
  mains:         {},
  delivery:      {}
};
/* Map every slice key to the exact endpoint and S bucket it writes.
 * Each fetcher settles independently so one failure never clears
 * evidence another slice already validated. */
var SLICE_MAP = {
  health:              { endpoint: "/api/ops/health",                      field: "health",              errorField: "healthError" },
  tasks:               { endpoint: "/api/ops/tasks",                       field: "tasks",               errorField: "tasksError" },
  boards:              { endpoint: "/api/ops/board",                       field: "boards",              errorField: "boardsError" },
  competitions:        { endpoint: "/api/ops/competitions",                field: "competitions",        errorField: "competitionsError" },
  goals:               { endpoint: "/api/ops/goals",                       field: "goals",               errorField: "goalsError" },
  stats:               { endpoint: "/api/ops/stats",                       field: "stats",               errorField: "statsError" },
  settings:            { endpoint: "/api/ops/settings",                    field: "settings",            errorField: "settingsError" },
  sample:              { endpoint: "/api/ops/sample-task",                 field: "sample",              errorField: "sampleError" },
  economics:           { endpoint: "/api/ops/economics-summary",           field: "economics",           errorField: "economicsError" },
  routingCoverage:     { endpoint: "/api/ops/routing-evidence-coverage",   field: "routingCoverage",     errorField: "routingCoverageError" },
  mainDirectAggregate: { endpoint: "/api/ops/main-direct-aggregate",       field: "mainDirectAggregate", errorField: "mainDirectAggregateError" },
  mainDirectRecent:    { endpoint: "/api/ops/main-direct-recent",          field: "mainDirectRecent",    errorField: "mainDirectRecentError" },
  selfUpgradeEvidence: { endpoint: "/api/ops/self-upgrade-evidence",       field: "selfUpgradeEvidence", errorField: "selfUpgradeEvidenceError" },
  workHierarchy:       { endpoint: "/api/ops/work-hierarchy",              field: "workHierarchy",       errorField: "workHierarchyError", buildQuery: workHierarchyQuery },
  intakes:             { endpoint: "/api/ops/intakes",                     field: "intakes",             errorField: "intakesError" }
};
/** Pure: given a closed Hub tab code, return the slice keys its renderer
 *  consumes (shared hub + health are always added by the caller).  Tests
 *  can execute this without a DOM. */
function requestPlan(tab){
  return PAGE_DEPS[tab] || {};
}
/** Fetch one named slice, writing success or error into the matching S
 *  bucket.  Never throws; errors are stored for the renderer to handle. */
function fetchSlice(key){
  var slice = SLICE_MAP[key];
  if(!slice) return Promise.resolve();
  var endpoint = slice.endpoint;
  if(typeof slice.buildQuery === "function"){
    var q = slice.buildQuery();
    if(q) endpoint += "?" + q;
  }
  return fetchJSON(endpoint).then(function(data){
    S[slice.field] = data;
    S[slice.errorField] = null;
  }, function(e){
    if(e && e.status === 401) clearHubToken();
    S[slice.errorField] = (e && e.message) ? e.message : "unavailable";
  });
}
/** Classify the active page's evidence for its declared data dependencies.
 *  "ready"       = every required slice has data and no current error.
 *  "loading"     = at least one slice is null with no error (never fetched).
 *  "unavailable" = at least one slice is null with an error (first fetch failed).
 *  "stale"       = all slices have data, but at least one has a current error
 *                   (retained evidence is visibly stale). */
function pageEvidenceState(tab){
  var deps = requestPlan(tab);
  var keys = Object.keys(deps);
  if(keys.length === 0) return "ready";
  var allHaveData = true;
  var anyNullWithError = false;
  var anyNullWithoutError = false;
  var anyErrorWithData = false;
  for(var i = 0; i < keys.length; i++){
    var slice = SLICE_MAP[keys[i]];
    if(!slice) continue;
    if(S[slice.field] === null){
      allHaveData = false;
      if(S[slice.errorField]) anyNullWithError = true;
      else anyNullWithoutError = true;
    } else if(S[slice.errorField]){
      anyErrorWithData = true;
    }
  }
  if(allHaveData && !anyErrorWithData) return "ready";
  // A confirmed first-fetch failure is more informative than another slice
  // that is still loading: never present a failed page as merely pending.
  if(anyNullWithError) return "unavailable";
  if(anyNullWithoutError) return "loading";
  return "stale"; // allHaveData && anyErrorWithData
}

/* --- API --- */
function fetchJSON(path, opts){
  var init = { headers: { "X-ForkLight-Hub-Token": S.token } };
  if(opts && opts.signal){ init.signal = opts.signal; }
  return fetch(path, init).then(function(r){
    if(r.status === 401) clearHubToken();
    if(!r.ok){ var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return r.json();
  });
}
function postJSON(path, body){
  return fetch(path, {
    method: "POST",
    headers: {
      "X-ForkLight-Hub-Token": S.token,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(body || {})
  }).then(function(r){
    return r.text().then(function(text){
      var data = null;
      if(text){ try { data = JSON.parse(text); } catch(_){ data = null; } }
      if(r.status === 401) clearHubToken();
      if(!r.ok){
        var msg = (data && (data.error || data.message)) || ("HTTP " + r.status);
        var e = new Error(String(msg));
        e.status = r.status;
        throw e;
      }
      return data;
    });
  });
}
function showUnauthenticated(){
  viewEl.replaceChildren(stateMsg("disconnected", t("unauth")));
  statusEl.textContent = t("unauthBar");
  if(topMetaEl) topMetaEl.textContent = "";
}
function toast(msg){
  var el = document.getElementById("fl-toast");
  if(!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
  if(msg) setTimeout(function(){ if(el.textContent === msg) el.hidden = true; }, 3500);
}
function flashError(msg, detail){
  var el = document.getElementById("fl-flash-error");
  if(!el) return;
  el.textContent = "";
  if(msg){
    el.appendChild(document.createTextNode(String(msg)));
    var safeDetail = boundedDiagnostic(detail);
    if(safeDetail){
      var details = document.createElement("details");
      details.className = "audit-details flash-detail";
      var summary = document.createElement("summary");
      summary.textContent = t("detailTechError");
      details.appendChild(summary);
      details.appendChild(h("div", "summary-line mono fs11", safeDetail));
      el.appendChild(details);
    }
    el.hidden = false;
  }
  else el.hidden = true;
}
function boundedDiagnostic(value){
  if(value === undefined || value === null) return "";
  var text = String(value).replace(/\0/g, "").trim();
  return text.length > 800 ? text.slice(0, 797) + "..." : text;
}
/* Secondary bounded diagnostic, kept inside a closed technical disclosure so
 * the prominent UI shows only a safe localized summary. The raw message is
 * preserved verbatim, never rewritten or dropped. */
function appendBoundedDetail(panel, msg){
  var safeMessage = boundedDiagnostic(msg);
  if(!panel || !safeMessage) return;
  var details = document.createElement("details");
  details.className = "audit-details detail-bounded mt-4";
  var summary = document.createElement("summary");
  summary.textContent = t("detailTechError");
  details.appendChild(summary);
  details.appendChild(h("div", "summary-line mono fs11", safeMessage));
  panel.appendChild(details);
}

/* --- Polling --- */
/** Schedule the next bounded refresh.  Respects visibility (hidden tabs
 *  schedule nothing), authentication (stops after 401), and the configured
 *  interval (from /api/status). */
function scheduleNext(){
  if(!S.token) return; // Stop scheduling after auth rejection.
  if(S.timer){ clearTimeout(S.timer); S.timer = null; }
  if(document.visibilityState === "hidden") return;
  var hubConsole = S.hub && S.hub.settings && S.hub.settings.console;
  var settingsConsole = S.settings && S.settings.console;
  var consoleCfg = hubConsole || settingsConsole;
  var ms = consoleCfg && consoleCfg.refreshIntervalMs
    ? Math.max(200, consoleCfg.refreshIntervalMs) : 2000;
  S.timer = setTimeout(refresh, ms);
}
/** Run one complete refresh batch for the visible page.
 *
 *  - Shared shell truth (/api/status + /api/ops/health) is always fetched.
 *  - Page-specific slices are derived from the dependency map and each
 *    settles independently; one failure never erases unrelated evidence.
 *  - Overlapping triggers (timer, tab change, visibility return, manual
 *    action) coalesce: at most one batch is in-flight and one follow-up
 *    batch is queued for the latest visible page.
 *  - Hidden tabs cancel the next timer and never start new polls.
 *  - After a 401 authentication rejection, no further polls are scheduled. */
function refresh(){
  // Hard stop after token clearance (401 rejection).
  if(!S.token) return;
  // Coalesce: if a batch is already in-flight, mark pending and return.
  if(S.batchInFlight){
    S.pendingRefresh = true;
    return;
  }
  // Cancel any scheduled timer before starting fresh work.
  if(S.timer){ clearTimeout(S.timer); S.timer = null; }
  // Hidden tabs issue no polls.
  if(document.visibilityState === "hidden") return;

  S.batchInFlight = true;
  S.pendingRefresh = false;

  // --- Shared shell truth (always, every tab) ---
  var hubP = fetchJSON("/api/status").then(function(hub){
    S.hub = hub;
    return hub;
  });
  var healthP = fetchSlice("health");

  // --- Page-specific slices ---
  var deps = requestPlan(S.tab || "work");
  var sliceKeys = Object.keys(deps);
  var slicePromises = [];
  for(var i = 0; i < sliceKeys.length; i++){
    if(SLICE_MAP[sliceKeys[i]]) slicePromises.push(fetchSlice(sliceKeys[i]));
  }

  // Wait for everything (shared + page slices) to settle.
  Promise.all([hubP.catch(function(e){
    if(e&&e.status===401) clearHubToken();
    throw e;
  }), healthP].concat(slicePromises)).then(function(){
    if(!S.token){ showUnauthenticated(); return; }
    // Connected state follows the current health read, not retained data.
    if(!S.healthError) { S.lastOk = Date.now(); S.connected = true; S.hadOk = true; }
    else { S.connected = false; }
    /* Full-reload context is only applied after the canonical Work projection
     * is available. A valid saved filter needs one follow-up read so the board
     * and its ancestry come from the same Core-filtered truth. */
    if(S.tab === "work" && workApplySavedReadingContext()){
      S.pendingRefresh = true;
      return;
    }
    if(S.tab === "worker" && S.workerFormActive){
      /* Keep typing stable on ordinary polls, but rebuild from refreshed
       * canonical Worker/readiness truth when that visible truth changes.
       * rWorker captures and restores the unsaved draft plus open groups. */
      if(workerVisibleTruthKey() !== S.workerRenderedTruthKey) render();
      else { updStatus(); setPageChrome(); }
    } else {
      render();
    }
  }).catch(function(){
    if(!S.token){ showUnauthenticated(); return; }
    S.connected = false;
    if(S.tab === "worker" && S.workerFormActive){
      updStatus();
      setPageChrome();
    } else {
      render();
    }
  }).finally(function(){
    S.batchInFlight = false;
    if(!S.token) return; // Stop scheduling after auth rejection.
    if(S.pendingRefresh){
      // A newer trigger arrived while this batch was in-flight;
      // run one follow-up for the latest page immediately.
      refresh();
    } else {
      scheduleNext();
    }
  });
}
function startPoll(){
  viewEl.appendChild(stateMsg("loading", t("connecting")));
  refresh();
}

/* --- Chrome --- */
function updStatus(){
  statusEl.textContent = "";
  footerEl.textContent = "";
  if(topMetaEl) topMetaEl.textContent = "";
  // Health can be current while the active page is showing retained evidence
  // after one of its own endpoints failed.  Keep the shell connection truth,
  // but make that page-level staleness visible instead of claiming "live".
  var pageStale = S.connected && pageEvidenceState(S.tab || "work") === "stale";
  var st = (S.connected && !pageStale) ? "ok" : (S.hadOk ? "stale" : "disconnected");
  var dot = h("span", "status-dot " + st);
  statusEl.appendChild(dot);
  var txt = (S.connected && !pageStale) ? t("live") : (S.hadOk ? t("reconnecting") : t("offline"));
  if((!S.connected || pageStale) && S.hadOk) txt += " - " + t("connectionLastOk", { time: fmtSince(new Date(S.lastOk).toISOString()) });
  statusEl.appendChild(document.createTextNode(txt));
  if(S.health){
    statusEl.appendChild(document.createTextNode(" | " + t("connectionCounts", {
      active: String((S.health.activeTaskIds || []).length),
      queued: String((S.health.queuedTaskIds || []).length)
    })));
  }
  if(topMetaEl && S.health){
    topMetaEl.appendChild(h("span", "meta-chip",
      t("topWorkers", { count: String((S.health.activeTaskIds || []).length) })
    ));
    topMetaEl.appendChild(h("span", "meta-chip",
      t("topQueue", { count: String((S.health.queuedTaskIds || []).length) })
    ));
    topMetaEl.appendChild(h("span", "meta-chip",
      t("topCap", { count: String(S.health.maxConcurrency != null ? S.health.maxConcurrency : "-") })
    ));
  }
  var loc = (window.ForklightI18n && window.ForklightI18n.getLang() === "zh") ? "zh-CN" : "en-GB";
  footerEl.textContent = t("updatedAt", {
    time: new Date(S.lastOk || Date.now()).toLocaleTimeString(loc, { hour12: false })
  }) + " - ForkLight";
}
function setPageChrome(){
  var p = pageMeta(S.tab || "work");
  if(titleEl) titleEl.textContent = p.title;
  if(subEl) subEl.textContent = p.sub;
  applyChromeI18n();
  updateProductNav();
}
function showDisconnected(){
  viewEl.replaceChildren(stateMsg("disconnected", t("reconnecting")));
}

/* --- Provider Readiness + explicit billable probe --- */
function rProviders(){
  if(!S.health || (!S.health.providers && !S.health.providerVerification)) return;
  var configured = S.health.providers || {};
  var verified = S.health.providerVerification || {};
  var names = {};
  Object.keys(configured).forEach(function(name){ names[name] = true; });
  Object.keys(verified).forEach(function(name){ names[name] = true; });
  viewEl.appendChild(sec(t("providers")));
  var toolbar = h("div", "actions mb-8");
  var probeAll = h("button", "btn sm", t("providerProbeAll"));
  probeAll.type = "button";
  probeAll.addEventListener("click", function(){
    if(!window.confirm(t("providerProbeConfirm"))) return;
    probeAll.disabled = true;
    postJSON("/api/ops/providers/probe", { confirm: true })
      .then(function(res){
        toast(res.message || t("providerProbeOk"));
        return refresh();
      })
      .catch(function(e){ flashError(t("operationFailed"), e && e.message); })
      .finally(function(){ probeAll.disabled = false; });
  });
  toolbar.appendChild(probeAll);
  var refreshProv = h("button", "btn sm", t("providerRefresh"));
  refreshProv.type = "button";
  refreshProv.addEventListener("click", function(){
    refreshProv.disabled = true;
    fetchJSON("/api/ops/providers")
      .then(function(){ toast(t("providerRefreshOk")); return refresh(); })
      .catch(function(e){ flashError(t("operationFailed"), e && e.message); })
      .finally(function(){ refreshProv.disabled = false; });
  });
  toolbar.appendChild(refreshProv);
  viewEl.appendChild(toolbar);
  var grid = hd("div", "provider-grid");
  Object.keys(names).sort().forEach(function(name){
    var p = configured[name] || {};
    var v = verified[name] || {};
    var chip = h("div", "provider-chip");
    chip.appendChild(h("div", "provider-chip-name", name));
    var line = "";
    if(S.health.providerVerification){
      var verifyMap = { verified: "providerVerifyVerified", stale: "providerVerifyStale",
        unverified: "providerVerifyUnverified", failed: "providerVerifyFailed" };
      line = t("providerStatusLine", {
        config: t(p.ready ? "providerConfigReady" : "providerConfigMissing"),
        verification: t(verifyMap[v.status] || "providerVerifyUnverified")
      });
    } else {
      line = t(p.ready ? "providerConfigReady" : "providerConfigUnavailable");
    }
    var model = v.model || p.model || p.defaultModel;
    if(model) line += "\n" + model;
    chip.appendChild(h("div", "provider-chip-meta", line));
    var probeOne = h("button", "btn sm", t("providerProbeOne"));
    probeOne.type = "button";
    probeOne.addEventListener("click", function(){
      if(!window.confirm(t("providerProbeOneConfirm", { name: name }))) return;
      probeOne.disabled = true;
      postJSON("/api/ops/providers/probe", { provider: name, confirm: true })
        .then(function(res){
          toast(res.message || t("providerProbeOk"));
          return refresh();
        })
        .catch(function(e){ flashError(t("operationFailed"), e && e.message); })
        .finally(function(){ probeOne.disabled = false; });
    });
    chip.appendChild(hd("div", "actions mt-4", [probeOne]));
    grid.appendChild(chip);
  });
  viewEl.appendChild(grid);
}

/** Overview readiness strip: daemon + prereqs + main channels + next step */
function rReadiness(){
  var hub = S.hub || {};
  var prereq = hub.prerequisites || {};
  var daemon = hub.daemon || {};
  var mains = hub.mains || [];
  var models = (hub.modelCatalog && hub.modelCatalog.models) || [];
  var workers = (hub.workerProfiles && hub.workerProfiles.profiles) || [];
  var cardEl = h("div", "guide-card");
  cardEl.appendChild(h("div", "guide-step", t("readyTitle")));
  cardEl.appendChild(h("div", "card-title mb-4", t("readyBody")));
  var steps = [
    [t("readyModels"), models.length > 0, t("navModels"), "model"],
    [t("readyWorkers"), workers.length > 0, t("navWorkers"), "worker"],
    [t("readyMain"), mains.some(function(m){
      return (m.plugin && m.plugin.installed) || (m.mcp && m.mcp.installed) || (m.skill && m.skill.installed);
    }), t("navMain"), "mains"],
    [t("readyDaemon"), daemon.running === true || daemon.pid != null, t("ovDaemon"), "work"]
  ];
  var list = h("div", "pill-row mb-8");
  steps.forEach(function(s){
    list.appendChild(h("span", "badge " + (s[1] ? "badge-ok" : "badge-warn"),
      (s[1] ? "OK " : "! ") + s[0]));
  });
  cardEl.appendChild(list);
  if(prereq.ok === false && prereq.issues && prereq.issues.length){
    cardEl.appendChild(h("div", "summary-line dim",
      t("readyPrereq") + ": " + prereq.issues.slice(0, 3).join("; ")));
  }
  var next = steps.find(function(s){ return !s[1]; });
  if(next){
    var go = h("button", "btn primary sm", t("readyNext") + ": " + next[2]);
    go.type = "button";
    go.addEventListener("click", function(){ switchTab(next[3]); });
    cardEl.appendChild(hd("div", "actions", [go]));
  } else {
    cardEl.appendChild(h("div", "summary-line", t("readyDone")));
  }
  viewEl.appendChild(cardEl);
}

/* --- Settings flatten --- */
function flattenSettings(obj, prefix){
  var rows = [];
  for(var key in obj){
    if(!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    var v = obj[key], path = prefix ? prefix + "." + key : key;
    if(v !== null && typeof v === "object" && !Array.isArray(v)){
      rows = rows.concat(flattenSettings(v, path));
    } else if(v !== undefined){
      rows.push([path, String(v)]);
    }
  }
  return rows;
}

/* --- Plan board item --- */
function boardItem(i){
  var d = h("div", "column-item");
  if(i.taskId){
    d.setAttribute("tabindex", "0");
    d.setAttribute("role", "button");
    d.addEventListener("click", function(){ showTask(i.taskId); });
    d.addEventListener("keydown", function(e){
      if(e.key === "Enter" || e.key === " "){ e.preventDefault(); showTask(i.taskId); }
    });
  }
  d.appendChild(h("div", "name", i.taskName || t("taskUntitled")));
  // Readable position sentence: explain why work is ready, waiting, or blocked
  // using names from namedDependencies rather than raw IDs.
  d.appendChild(h("div", "meta", boardItemPositionText(i)));
  // Readable unlocks-next sentence: what this item will enable.
  var unlocks = boardItemUnlocksText(i);
  if(unlocks) d.appendChild(h("div", "meta", unlocks));
  if(i.error) appendBoundedDetail(d, i.error);
  // Technical disclosure retains IDs but is secondary (primary copy is above).
  if(i.dependencies && i.dependencies.length){
    appendBoundedDetail(d, i.dependencies.map(function(dd){
      return String(dd.itemId || "-") + " (" + String(dd.state || "-") + ")";
    }).join(", "));
  }
  return d;
}
/* Sanitise a task name for primary display: max 200 visible chars, control
 * characters stripped, empty or whitespace-only falls back to undefined. */
function safeTaskName(raw){
  if(typeof raw !== "string" || raw.length === 0) return undefined;
  var cleaned = raw.slice(0, 200).replace(/[\x00-\x1f\x7f]/g, "").trim();
  return cleaned.length === 0 ? undefined : cleaned;
}
/* Produce a readable label for a Plan item when its task has no usable name.
 * Uses the itemIndex to give context (step #3) instead of a raw UUID. */
function safeItemLabel(item){
  var name = safeTaskName(item.taskName);
  if(name) return name;
  var index = typeof item.itemIndex === "number" ? item.itemIndex : undefined;
  if(index !== undefined) return t("planItemStepLabel", { index: String(index + 1) });
  return t("taskUntitled");
}
/* Produce one readable current-position sentence from named dependency evidence.
 * Never exposes raw UUIDs or event codes in primary copy. */
function boardItemPositionText(item){
  var named = Array.isArray(item.namedDependencies) ? item.namedDependencies : [];
  var status = item.taskStatus;
  var label = safeItemLabel(item);
  // Terminal states: completed, failed, active (running)
  if(status === "succeeded"){
    return t("planItemPositionCompleted", { name: label });
  }
  if(status === "failed" || status === "interrupted"){
    return t("planItemPositionFailed", { name: label });
  }
  if(status === "running" || status === "preparing" || status === "verifying" || status === "active"){
    return t("planItemPositionActive", { name: label });
  }
  if(status === "blocked"){
    return t("planItemPositionBlocked", { name: label });
  }
  // Queued/waiting/undefined: explain position from dependencies
  if(named.length === 0){
    // Not started, no prerequisites: can start now
    if(!status || status === "queued" || status === "waiting"){
      return t("planItemPositionReady");
    }
    return t("planItemPositionQueued");
  }
  // Has dependencies: check if blocked or waiting
  var failedDeps = named.filter(function(d){ return d.state === "failed"; });
  var waitingDeps = named.filter(function(d){ return d.state === "waiting"; });
  if(failedDeps.length > 0){
    var firstName = safeTaskName(failedDeps[0].taskName) || t("planItemGenericSource");
    if(failedDeps.length === 1){
      return t("planItemPositionBlockedByFailed", { name: firstName });
    }
    return t("planItemPositionBlockedByFailedMany", {
      first: firstName,
      count: String(failedDeps.length)
    });
  }
  if(waitingDeps.length > 0){
    // Name the first waiting dependency and its readable stage
    var w = waitingDeps[0];
    var wName = safeTaskName(w.taskName) || t("planItemGenericSource");
    var wStage = w.taskStatus ? statusLabel(w.taskStatus) : t("planItemNotStarted");
    if(waitingDeps.length === 1){
      return t("planItemPositionWaitingFor", { name: wName, stage: wStage });
    }
    return t("planItemPositionWaitingForMany", {
      name: wName,
      stage: wStage,
      count: String(waitingDeps.length)
    });
  }
  // All dependencies satisfied: can start
  return t("planItemPositionReady");
}
/* Produce one readable unlocks-next sentence from named dependent evidence.
 * Never exposes raw UUIDs as primary copy. */
function boardItemUnlocksText(item){
  var named = Array.isArray(item.namedRequiredBy) ? item.namedRequiredBy : [];
  if(named.length === 0) return "";
  var names = named.slice(0, 3).map(function(d){ return safeTaskName(d.taskName) || t("planItemGenericNext"); });
  if(named.length <= 3){
    return t("planItemUnlocks", { names: names.join(", ") });
  }
  return t("planItemUnlocksMany", {
    names: names.join(", "),
    more: String(named.length - 3)
  });
}

/* --- Task kanban helpers --- */
function taskLane(status){
  if(status === "succeeded") return "done";
  if(status === "failed" || status === "interrupted") return "failed";
  if(status === "preparing" || status === "running" || status === "verifying") return "active";
  return "queued";
}
function countByLane(tasks){
  var c = { queued: 0, active: 0, done: 0, failed: 0 };
  (tasks || []).forEach(function(t){ c[taskLane(t.status)] += 1; });
  return c;
}
function taskProgressSummary(task){
  // A follow-up check is current activity, not a replacement machine result.
  // Show it before historical Main/delivery wording; lane and headline remain
  // driven by the unchanged Task result elsewhere.
  var live = taskLiveStage(task);
  if(live && (live.stage === "candidate-reverifying" || live.stage === "remediation-checking")){
    return liveStageCompactText(live);
  }
  if(hasVerifiedFinalDelivery(task)){
    var disposition = task && (task.remediationDisposition
      || (task.decision && task.decision.remediationDisposition)
      || (task.journey && task.journey.finalDelivery
        && task.journey.finalDelivery.remediationDisposition));
    if(disposition && disposition.acceptanceBasis === "amended-acceptance"){
      return t("taskProgressAmendedDelivered");
    }
    if(task && (task.status === "succeeded" || task.status === "completed")){
      return t("taskProgressRepairedAfterMachinePass");
    }
    return t("taskProgressRepairedDelivered");
  }
  // A handled failure is closed attention: say handled, never successful.
  // The machine status stays failed/interrupted and remains visible.
  if(task && task.attentionResolution && task.attentionResolution.status === "resolved"){
    return t("taskProgressHandled");
  }
  var status = task && task.status;
  var stage = task && task.decisionStage;
  var machineFailed = status === "failed" || status === "interrupted" || status === "blocked";
  if(machineFailed && stage === "revision-requested"){
    return t("taskProgressFailedRevisionRequested");
  }
  if(machineFailed && stage === "main-rejected"){
    return t("taskProgressFailedMainRejected");
  }
  var stageKey = {
    "awaiting-main-review": "taskProgressSucceeded",
    "revision-requested": "taskProgressRevisionRequested",
    "main-rejected": "taskProgressMainRejected",
    "ready-for-integration": "taskProgressReadyIntegration",
    "integrating": "taskProgressIntegrating",
    "applied-not-activated": "taskProgressAppliedNotActivated",
    "delivered": "taskProgressDeliveredNoActivation",
    "activated": "taskProgressActivated",
    "integration-failed": "taskProgressIntegrationFailed"
  }[stage];
  if(stageKey) return t(stageKey);
  if(status === "preparing"){
    var progress = task && (task.progress || (task.decision && task.decision.progress));
    var prep = progress && progress.preparationStage;
    if(prep) return preparationProgressText(prep);
    var prepLive = taskLiveStage(task);
    if(prepLive && prepLive.stage === "preparing-workspace") return liveStageCompactText(prepLive);
    return t("taskProgressPreparing");
  }
  // Prefer the canonical live-stage projection for live Worker states AND for
  // open post-terminal follow-up operations (Candidate reverification or Main
  // repair verification) on terminal Tasks. The machine result stays unchanged.
  live = taskLiveStage(task);
  if(live && (status === "running" || status === "active" || status === "verifying"
      || status === "queued" || status === "waiting")){
    return liveStageCompactText(live);
  }
  if(status === "running" || status === "active"){
    var runKind = boardActivityKind(task);
    if(runKind === "stalled") return t("taskProgressRunningStalled");
    if(runKind === "quiet") return t("taskProgressRunningQuiet");
    return t("taskProgressRunning");
  }
  if(status === "verifying") return t("taskProgressVerifying");
  if(status === "succeeded" || status === "completed") return t("taskProgressSucceeded");
  if(status === "failed" || status === "interrupted" || status === "blocked") return t("taskProgressFailed");
  return t("taskProgressWaiting");
}
function preparationElapsedText(elapsedMs){
  var seconds = Math.max(0, Math.floor((Number(elapsedMs) || 0) / 1000));
  if(seconds < 60) return t("prepElapsedSeconds", { seconds: String(seconds) });
  return t("prepElapsedMinutes", {
    minutes: String(Math.floor(seconds / 60)),
    seconds: String(seconds % 60)
  });
}
function preparationProgressText(prep){
  var stage = String(prep.stage || "init");
  var phase = prep.phase === "complete" ? "complete" : "start";
  var keyMap = {
    "init:start": "prepInitStart",
    "source-scan:start": "prepSourceScanStart",
    "source-scan:complete": "prepSourceScanComplete",
    "baseline-copy:start": "prepBaselineCopyStart",
    "baseline-copy:complete": "prepBaselineCopyComplete",
    "worker-copy:start": "prepWorkerCopyStart",
    "worker-copy:complete": "prepWorkerCopyComplete",
    "dependency-link:start": "prepDependencyLinkStart",
    "dependency-link:complete": "prepDependencyLinkComplete",
    "context-write:start": "prepContextWriteStart",
    "context-write:complete": "prepContextWriteComplete",
    "complete:complete": "prepReady"
  };
  var key = keyMap[stage + ":" + phase] || "taskProgressPreparing";
  var textValue = t(key, { count: prep.count === undefined ? "" : String(prep.count) });
  return textValue + " · " + preparationElapsedText(prep.elapsedMs);
}
function kanbanCard(task){
  var cardEl = h("div", "kanban-card");
  cardEl.setAttribute("role", "button");
  cardEl.setAttribute("tabindex", "0");
  cardEl.appendChild(h("div", "kanban-card-title", task.name || t("taskUntitled")));
  var meta = h("div", "kanban-card-meta");
  // The prominent badge follows the latest Main/delivery outcome, not the
  // raw machine status, so a machine-successful Candidate Main asked to
  // revise is never shown as accepted or delivered. The machine lane
  // (taskLane selects only on status) and the journey evidence are unchanged.
  meta.appendChild(taskHeadlineBadge(task));
  // Avoid a duplicate delivery badge when the headline already states the
  // verified final outcome. A failed Task with verified final delivery still
  // renders in the failed lane; only the duplicate badge is suppressed.
  var finalBadge = taskHeadline(task).delivered ? null : finalDeliveryBadge(task);
  if(finalBadge) meta.appendChild(finalBadge);
  // Quiet / long-quiet activity is a presentation signal on the board only.
  // It never mutates Task state or starts a retry.
  var activityBadge = boardActivityBadge(task);
  if(activityBadge) meta.appendChild(activityBadge);
  var p = task.progress;
  if(task.failureCategory){
    meta.appendChild(h("span", "badge badge-err", failureCategoryLabel(task.failureCategory)));
  }
  meta.appendChild(document.createTextNode(
    (task.runtime ? task.runtime + " · " : "") + (task.provider || "?") + " / " + (task.model || "?")
  ));
  meta.appendChild(document.createTextNode(fmtSince(task.createdAt)));
  cardEl.appendChild(meta);
  cardEl.appendChild(h("div", "meta mt-4 dim fs11", taskProgressSummary(task)));
  var dualLine = dualClockPlainText(p);
  if(dualLine){
    cardEl.appendChild(h("div", "meta dim fs11", dualLine));
    var dualNext = dualClockNextText(p);
    if(dualNext) cardEl.appendChild(h("div", "meta dim fs11", dualNext));
  } else if(p && p.lastEventAt){
    cardEl.appendChild(h("div", "meta dim fs11", t("taskLastUpdate", { time: fmtSince(p.lastEventAt) })));
  }
  var open = function(){ showTask(task.id); };
  cardEl.addEventListener("click", open);
  cardEl.addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); open(); }
  });
  return cardEl;
}
function kanbanColumn(lane, label, tone, items){
  var col = h("div", "kanban-col tone-" + tone);
  var head = h("div", "kanban-col-head");
  head.appendChild(h("div", "kanban-col-title", label));
  head.appendChild(h("div", "kanban-col-count", String(items.length)));
  col.appendChild(head);
  var body = h("div", "kanban-col-body");
  if(!items.length){
    body.appendChild(h("div", "kanban-empty", t("taskNothingHere")));
  } else {
    items.forEach(function(t){ body.appendChild(kanbanCard(t)); });
  }
  col.appendChild(body);
  return col;
}

/* --- Board scope (Now / History / All) ---
 * Scope is the primary board control. The canonical Core projection
 * (boardScope / boardReason) decides Now vs History; the browser only
 * translates the closed codes and never recomputes lifecycle semantics.
 * Absent codes (older daemon) fail open to Now so unfinished work is never
 * hidden. Machine lane selection (taskLane) and Task Detail are unchanged. */
function taskBoardScope(task){
  return task && task.boardScope === "history" ? "history" : "now";
}
/* Translate closed boardReason codes into a History outcome group.
 * Delivered covers Integration delivery, activation, and Main-repaired
 * delivery; Stopped covers an explicit Main rejection. Anything unrecognized
 * has no proven closed outcome and is grouped with Delivered only when the
 * Core already classified it as History (never invented client-side). */
function taskHistoryGroup(task){
  var reason = task && task.boardReason;
  if(reason === "delivered" || reason === "activated" || reason === "repaired-delivered") return "delivered";
  if(reason === "main-rejected") return "stopped";
  if(reason === "attention-resolved") return "handled";
  return null;
}
function historyGroup(tone, label, hint, items){
  var section = h("div", "history-group tone-" + tone);
  var head = h("div", "history-group-head");
  head.appendChild(h("div", "history-group-title", label));
  head.appendChild(h("div", "history-group-count", String(items.length)));
  section.appendChild(head);
  if(hint) section.appendChild(h("div", "summary-line dim fs11 history-group-hint", hint));
  var body = h("div", "history-group-body");
  if(!items.length){
    body.appendChild(h("div", "kanban-empty", t("taskNothingHere")));
  } else {
    items.forEach(function(task){ body.appendChild(kanbanCard(task)); });
  }
  section.appendChild(body);
  return section;
}
/* History renders end-to-end outcome groups instead of machine lanes. A
 * repaired failed Task belongs under Delivered; a Main-rejected Task belongs
 * under Stopped. Cards and Task Detail keep the original machine evidence. */
function renderHistoryBoard(tasks){
  var wrap = h("div", "history-board");
  wrap.appendChild(h("div", "summary-line dim board-scope-helper", t("boardHistoryHelper")));
  var delivered = [];
  var stopped = [];
  var handled = [];
  tasks.forEach(function(task){
    var group = taskHistoryGroup(task);
    if(group === "stopped") stopped.push(task);
    else if(group === "handled") handled.push(task);
    else delivered.push(task);
  });
  wrap.appendChild(historyGroup("delivered", t("boardHistoryDelivered"), t("boardHistoryDeliveredHint"), delivered));
  wrap.appendChild(historyGroup("handled", t("boardHistoryHandled"), t("boardHistoryHandledHint"), handled));
  wrap.appendChild(historyGroup("stopped", t("boardHistoryStopped"), t("boardHistoryStoppedHint"), stopped));
  return wrap;
}

/* The deliberate History panel: an explicit search form (submit, not per
 * keystroke), Refresh, honest loaded/total progress, retained-data error
 * handling, and Load more. Loads only when the user asks; never polled. */
function renderHistoryPanel(){
  var panel = h("div", "history-panel");
  panel.setAttribute("data-fl-role", "history-panel");

  var form = h("form", "history-search-form");
  form.setAttribute("role", "search");
  var lab = h("label", "history-search-label");
  lab.appendChild(h("span", "history-search-label-text", t("historySearchLabel")));
  var input = h("input", "history-search-input");
  input.type = "search";
  input.name = "query";
  input.value = historyState.draftQuery;
  input.maxLength = 100;
  input.placeholder = t("historySearchPlaceholder");
  input.setAttribute("aria-label", t("historySearchLabel"));
  input.disabled = historyState.loading;
  input.addEventListener("input", function(){
    // Draft only: never request per keystroke. Submit fires the search.
    historyState.draftQuery = input.value;
  });
  lab.appendChild(input);
  form.appendChild(lab);
  var submitBtn = h("button", "btn primary sm", t("historySearchBtn"));
  submitBtn.type = "submit";
  submitBtn.disabled = historyState.loading;
  form.appendChild(submitBtn);
  form.addEventListener("submit", function(e){
    e.preventDefault();
    historyState.submittedQuery = historyState.draftQuery.trim();
    historyState.draftQuery = historyState.submittedQuery;
    loadHistory("search");
  });
  panel.appendChild(form);

  var refreshBtn = h("button", "btn sm history-refresh-btn", t("historyRefreshBtn"));
  refreshBtn.type = "button";
  refreshBtn.disabled = historyState.loading;
  refreshBtn.addEventListener("click", function(){ loadHistory("refresh"); });
  panel.appendChild(refreshBtn);

  var loaded = historyState.items.length;
  var total = historyState.totalCount;
  var status = h("div", "history-status summary-line dim");
  if(historyState.loading){
    status.textContent = t("historyLoading");
  } else if(historyState.error && loaded === 0){
    status.textContent = "";
  } else {
    status.textContent = t("historyLoadedCount", {
      loaded: String(loaded), total: String(total)
    });
  }
  panel.appendChild(status);

  if(historyState.error){
    var err = h("div", "history-error");
    var msg = h("div", "summary-line");
    msg.textContent = (loaded === 0) ? t("historyUnavailable") : t("historyStale");
    err.appendChild(msg);
    var retryBtn = h("button", "btn sm", t("historyRetryBtn"));
    retryBtn.type = "button";
    retryBtn.disabled = historyState.loading;
    retryBtn.addEventListener("click", function(){
      loadHistory(historyRetryMode());
    });
    err.appendChild(retryBtn);
    panel.appendChild(err);
  }

  if(loaded > 0){
    panel.appendChild(renderHistoryBoard(historyState.items));
  } else if(!historyState.loading && !historyState.error){
    panel.appendChild(stateMsg("empty", t("historyEmpty")));
  }

  if(historyState.hasMore && !historyState.loading && !historyState.error){
    var moreRow = h("div", "history-load-more");
    var moreBtn = h("button", "btn sm", t("historyLoadMoreBtn"));
    moreBtn.type = "button";
    moreBtn.addEventListener("click", function(){ loadHistory("more"); });
    moreRow.appendChild(moreBtn);
    panel.appendChild(moreRow);
  }
  return panel;
}

/* --- Guided first Task ---
 * This prepares only a disposable packaged project and an ordinary Task
 * preview. After explicit Start, the normal Task Detail/Main Review/
 * Integration path owns the outcome; onboarding adds no second state machine. */
var guidedWorkerId = "";
function guidedLaunchableWorkers(){
  var profiles = (S.hub && S.hub.workerProfiles && S.hub.workerProfiles.profiles) || [];
  var readiness = (S.hub && S.hub.workerReadiness) || [];
  return profiles.filter(function(profile){
    var row = readiness.find(function(item){ return item && item.workerId === profile.id; });
    return row && row.canLaunch === true;
  });
}
function renderGuidedSampleCard(){
  var cardEl = h("div", "card form-card guided-sample-card");
  cardEl.setAttribute("data-fl-role", "guided-first-task");
  cardEl.appendChild(h("div", "card-title mb-4", t("guidedSampleTitle")));
  cardEl.appendChild(h("div", "summary-line dim mb-8", t("guidedSampleBody")));
  var sample = S.sample || { available: false, state: "unavailable" };
  if(sample.available === false){
    cardEl.appendChild(stateMsg("empty", t("guidedSampleUnavailable")));
    return cardEl;
  }

  if(sample.state === "submitted" && sample.taskId){
    cardEl.appendChild(stateMsg("success", t("guidedSampleSubmitted")));
    cardEl.appendChild(h("div", "summary-line", t("guidedSampleSubmittedNext")));
    var openBtn = h("button", "btn primary sm mt-8", t("guidedSampleOpenTask"));
    openBtn.type = "button";
    openBtn.addEventListener("click", function(){ showTask(sample.taskId); });
    cardEl.appendChild(openBtn);
    return cardEl;
  }
  if(sample.state === "submitting"){
    cardEl.appendChild(stateMsg("warning", t("guidedSampleUnknown")));
    var boardBtn = h("button", "btn sm mt-8", t("guidedSampleOpenBoard"));
    boardBtn.type = "button";
    boardBtn.addEventListener("click", function(){ switchTab("board"); });
    cardEl.appendChild(boardBtn);
    return cardEl;
  }

  var workers = guidedLaunchableWorkers();
  if(!workers.length){
    cardEl.appendChild(stateMsg("empty", t("guidedSampleNoWorker")));
    var workersBtn = h("button", "btn sm mt-8", t("guidedSampleOpenWorkers"));
    workersBtn.type = "button";
    workersBtn.addEventListener("click", function(){ switchTab("worker"); });
    cardEl.appendChild(workersBtn);
    return cardEl;
  }
  if(!workers.some(function(worker){ return worker.id === guidedWorkerId; })){
    var defaultId = S.hub && S.hub.workerProfiles && S.hub.workerProfiles.defaultProfileId;
    guidedWorkerId = workers.some(function(worker){ return worker.id === defaultId; })
      ? defaultId : workers[0].id;
  }

  var label = h("label", "", t("guidedSampleWorkerLabel"));
  var select = h("select", "");
  workers.forEach(function(worker){
    var option = document.createElement("option");
    option.value = worker.id;
    option.textContent = worker.label;
    select.appendChild(option);
  });
  select.value = guidedWorkerId;
  select.addEventListener("change", function(){
    guidedWorkerId = select.value;
    render();
  });
  label.appendChild(select);
  cardEl.appendChild(label);

  var matchingPrepared = sample.state === "prepared"
    && sample.workerProfileId === guidedWorkerId
    && sample.preview;
  if(matchingPrepared){
    cardEl.appendChild(h("div", "summary-line mt-8", t("guidedSamplePrepared")));
    cardEl.appendChild(renderSubmitPreviewFacts(sample.preview));
    var startBtn = h("button", "btn primary sm mt-8", t("guidedSampleStart"));
    startBtn.type = "button";
    startBtn.addEventListener("click", function(){
      if(!window.confirm(t("guidedSampleStartConfirm"))) return;
      startBtn.disabled = true;
      postJSON("/api/ops/sample-task/submit", {
        sampleId: sample.sampleId,
        previewRevisionDigest: sample.preview.previewRevisionDigest,
        confirm: true
      }).then(function(result){
        S.sample = result;
        toast(t("guidedSampleStarted"));
        return refresh();
      }).catch(function(error){
        flashError(t("guidedSampleStartFailed"), error && error.message);
      }).finally(function(){ startBtn.disabled = false; });
    });
    cardEl.appendChild(startBtn);
    return cardEl;
  }

  if(sample.state === "needs-attention"){
    cardEl.appendChild(stateMsg("warning", t("guidedSampleNeedsAttention")));
  } else if(sample.state === "prepared" && sample.workerProfileId !== guidedWorkerId){
    cardEl.appendChild(h("div", "summary-line dim mt-8", t("guidedSampleSelectionChanged")));
  } else {
    cardEl.appendChild(h("div", "summary-line dim mt-8", t("guidedSampleNotPrepared")));
  }
  var prepareBtn = h("button", "btn primary sm mt-8", t("guidedSamplePrepare"));
  prepareBtn.type = "button";
  prepareBtn.addEventListener("click", function(){
    if(!window.confirm(t("guidedSamplePrepareConfirm"))) return;
    prepareBtn.disabled = true;
    postJSON("/api/ops/sample-task/prepare", {
      workerProfileId: guidedWorkerId,
      confirm: true
    }).then(function(result){
      S.sample = result;
      toast(t("guidedSamplePreparedToast"));
      render();
    }).catch(function(error){
      flashError(t("guidedSamplePrepareFailed"), error && error.message);
    }).finally(function(){ prepareBtn.disabled = false; });
  });
  cardEl.appendChild(prepareBtn);
  return cardEl;
}

/* --- Overview (dense: live state + needs attention + active work first) --- */
function rOverview(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }

  var tasks = S.tasks || [];
  var lanes = countByLane(tasks);
  var comps = S.competitions || [];
  var plans = S.boards || [];
  var goals = S.goals || [];
  var activeComp = comps.filter(function(c){ return c.status === "running" || c.status === "pending"; }).length;

  // First viewport: live state strip
  var liveStrip = h("div", "ov-live-strip");
  liveStrip.setAttribute("data-fl-role", "ov-live-strip");
  var snap = daemonSnapshot();
  liveStrip.appendChild(h("div", "ov-live-title", t("ovLiveState")));
  var liveInfo = h("div", "ov-live-info");
  liveInfo.appendChild(h("span", "badge " + (snap.running ? (snap.ok ? "badge-ok" : "badge-warn") : "badge-dim"),
    snap.running ? (snap.ok ? t("ovUp") : t("daemonDegraded")) : t("ovDown")));
  liveInfo.appendChild(document.createTextNode("  " + t("daemonWorkSummary", {
    active: String(snap.active), queued: String(snap.queued),
    cap: String(snap.maxConcurrency != null ? snap.maxConcurrency : "-")
  })));
  if(snap.error && !snap.running){
    liveInfo.appendChild(h("div", "summary-line dim mt-4", t("daemonUnavailableHint")));
  }
  liveStrip.appendChild(liveInfo);
  viewEl.appendChild(liveStrip);

  // Needs attention: genuinely open failed/interrupted work only. The
  // canonical Core board placement decides Now vs History; a handled failure
  // (attention-resolved) is History and must not surface here as work the
  // user still needs to do. Older daemons without boardScope fail open to Now.
  var attention = tasks.filter(function(task){
    return (task.status === "failed" || task.status === "interrupted")
      && !hasVerifiedFinalDelivery(task)
      && taskBoardScope(task) === "now";
  }).slice(0, 3);
  if(attention.length > 0){
    viewEl.appendChild(sec(t("needsAttention")));
    attention.forEach(function(task){
      var attentionRows = [
        cardHead(task.name, "", badge(task.status)),
        h("div", "summary-line", taskProgressSummary(task))
      ];
      if(task.failureCategory){
        attentionRows.push(h("div", "summary-line dim fs11", t("attentionCause", {
          category: failureCategoryLabel(task.failureCategory)
        })));
      }
      viewEl.appendChild(card(function(){ showTask(task.id); }, attentionRows));
    });
  }

  // Active work
  viewEl.appendChild(sec(t("ovActiveWork")));
  var activeItems = tasks.filter(function(t){
    return taskLane(t.status) === "active";
  });
  var activeComps = comps.filter(function(c){ return c.status === "running" || c.status === "pending"; });
  if(!activeItems.length && !activeComps.length && !goals.filter(function(g){ return g.status === "running"; }).length){
    viewEl.appendChild(h("div", "summary-line mb-8", t("ovNoActiveWork")));
  } else {
    activeItems.slice(0, 3).forEach(function(task){
      viewEl.appendChild(card(function(){ showTask(task.id); }, [
        cardHead(task.name, "", badge(task.status)),
        h("div", "summary-line", taskProgressSummary(task))
      ]));
    });
    activeComps.slice(0, 2).forEach(function(c){
      viewEl.appendChild(card(function(){ showCompetition(c.id); }, [
        cardHead(c.name, "", badge(c.status)),
        h("div", "summary-line", t("competitionProgress", {
          candidates: String(c.candidateCount), terminal: String((c.progress || {}).terminal || 0), total: String((c.progress || {}).total || 0)
        }))
      ]));
    });
    goals.filter(function(g){ return g.status === "running"; }).slice(0, 2).forEach(function(g){
      viewEl.appendChild(card(function(){ showGoalDetail(g.goalId); }, [
        cardHead(g.name || t("navGoals"), "", badge("running")),
        h("div", "summary-line", t("goalProgressCompact", {
          satisfied: String(g.progress ? g.progress.satisfied : 0),
          total: String(g.progress ? g.progress.total : 0),
          percent: String(g.progress ? g.progress.percent : 0)
        }))
      ]));
    });
  }

  // Metrics (compact)
  var metrics = hd("div", "grid-4", [
    metric(t("ovBoard"), String(tasks.length), lanes.active + " " + t("ovWorking")),
    metric(t("ovMotion"), String(lanes.active), lanes.queued + " " + t("ovQueued")),
    metric(t("navGoals"), String(goals.length), t("ovGoalsHint")),
    metric(t("navCompete"), String(comps.length), activeComp + " " + t("ovOpen"))
  ]);
  viewEl.appendChild(metrics);

  // Secondary: compact readiness
  renderCompactReadiness();

  // Secondary: compact version, upgrade, sample
  renderCompactVersionRow();
  renderCompactUpgradeRow();
  renderCompactSampleRow();

  // Goals + Plans (secondary)
  var split = hd("div", "overview-split");
  var left = hd("div", "overview-stack");
  if(goals.length){
    left.appendChild(sec(t("navGoals")));
    goals.slice(0, 3).forEach(function(g){
      left.appendChild(card(function(){ showGoalDetail(g.goalId); }, [
        cardHead(g.name || t("navGoals"), "", badge(g.status || "pending")),
        h("div", "summary-line", t("goalProgressCompact", {
          satisfied: String(g.progress ? g.progress.satisfied : 0),
          total: String(g.progress ? g.progress.total : 0),
          percent: String(g.progress ? g.progress.percent : 0)
        })),
        h("div", "summary-line dim", goalOverviewSummaryText(g))
      ]));
    });
  }

  var right = hd("div", "overview-stack");
  if(plans.length){
    right.appendChild(sec(t("navPlans")));
    plans.slice(0, 2).forEach(function(b){
      var pct = b.progress && b.progress.percent === 100 ? "completed" : "active";
      right.appendChild(card(function(){ showPlanBoard(b.planId); }, [
        cardHead(b.name, "", badge(b.progress && b.progress.total ? pct : "pending")),
        progBar(b.progress),
        h("div", "summary-line", t("planProgressCompact", {
          completed: String(b.progress ? b.progress.completed : 0),
          total: String(b.progress ? b.progress.total : 0),
          active: String(b.progress ? b.progress.active : 0)
        }))
      ]));
    });
  }

  // System status (provider probes + daemon controls)
  right.appendChild(sec(t("ovSystemStatus")));
  right.appendChild(daemonControlCard());

  split.appendChild(left);
  split.appendChild(right);
  viewEl.appendChild(split);
  rProviders();
}

/* --- Daemon lifecycle controls (Hub stack) --- */
function formatBuildIdentity(id){
  if(!id || typeof id !== "object") return "";
  var parts = [];
  if(id.protocolVersion != null) parts.push("protocol " + id.protocolVersion);
  if(id.buildId) parts.push(String(id.buildId).slice(0, 12));
  else if(id.gitCommit) parts.push(String(id.gitCommit).slice(0, 10));
  else if(id.packageVersion) parts.push("v" + id.packageVersion);
  if(id.sourceMode) parts.push(String(id.sourceMode));
  return parts.join(" · ");
}
function daemonSnapshot(){
  var d = (S.hub && S.hub.daemon) || {};
  var running = d.running === true || (d.running !== false && d.pid != null);
  // Prefer explicit running flag; fall back to pid / health shape.
  if(d.running === false) running = false;
  else if(d.running === true) running = true;
  else if(d.pid != null || d.ok === true) running = true;
  else if(d.error) running = false;
  var identity = d.buildIdentity || d.serverIdentity || null;
  return {
    running: running,
    ok: d.ok !== false && running,
    pid: d.pid,
    active: (d.activeTaskIds || []).length,
    queued: (d.queuedTaskIds || []).length,
    maxConcurrency: d.maxConcurrency,
    error: d.error,
    claudeCode: d.claudeCode,
    databasePath: d.databasePath,
    identity: identity,
    identityLine: formatBuildIdentity(identity)
  };
}
function daemonAction(action, btn){
  if(btn) btn.disabled = true;
  flashError("");
  postJSON("/api/daemon", { action: action })
    .then(function(res){
      toast(res.message || t("daemonActionDone", { action: action }));
      return refresh();
    })
    .catch(function(e){ flashError(t("operationFailed"), e && e.message); })
    .finally(function(){ if(btn) btn.disabled = false; });
}
function daemonControlCard(){
  var snap = daemonSnapshot();
  var cardEl = h("div", "card");
  cardEl.appendChild(cardHead(
    t("ovStack"),
    t("ovHub") + ": " + t("ovUp"),
    h("span", "badge " + (snap.running ? (snap.ok ? "badge-ok" : "badge-warn") : "badge-dim"),
      snap.running ? (snap.ok ? t("ovUp") : t("daemonDegraded")) : t("ovDown"))
  ));
  var lines = [];
  lines.push(t("ovDaemon") + ": " + (snap.running ? t("ovUp") : t("ovDown")));
  if(snap.running){
    lines.push(t("daemonWorkSummary", {
      active: String(snap.active), queued: String(snap.queued),
      cap: String(snap.maxConcurrency != null ? snap.maxConcurrency : "-")
    }));
  }
  if(snap.error && !snap.running) lines.push(t("daemonUnavailableHint"));
  lines.forEach(function(line){
    cardEl.appendChild(h("div", "summary-line dim", line));
  });

  var daemonTech = h("div", "task-technical-body");
  if(snap.pid != null) daemonTech.appendChild(h("div", "summary-line mono dim fs11", "PID " + snap.pid));
  if(snap.identityLine) daemonTech.appendChild(h("div", "summary-line mono dim fs11",
    t("daemonIdentity") + ": " + snap.identityLine));
  if(snap.claudeCode && snap.claudeCode !== "unavailable") daemonTech.appendChild(
    h("div", "summary-line mono dim fs11", "Claude Code " + String(snap.claudeCode).slice(0, 48)));
  if(snap.error && !snap.running) daemonTech.appendChild(h("div", "error-box", String(snap.error).slice(0, 240)));
  if(snap.databasePath) daemonTech.appendChild(h("div", "summary-line mono dim fs11", String(snap.databasePath)));
  if(daemonTech.childNodes.length) cardEl.appendChild(collapsedSection(t("daemonTechnical"), daemonTech));

  var actions = h("div", "actions mt-8");
  if(!snap.running){
    var startBtn = h("button", "btn primary sm", t("daemonStart"));
    startBtn.type = "button";
    startBtn.addEventListener("click", function(){ daemonAction("start", startBtn); });
    actions.appendChild(startBtn);
  } else {
    var refreshBtn = h("button", "btn sm", t("daemonRefresh"));
    refreshBtn.type = "button";
    refreshBtn.addEventListener("click", function(){ daemonAction("status", refreshBtn); });
    actions.appendChild(refreshBtn);

    var restartBtn = h("button", "btn sm", t("daemonRestart"));
    restartBtn.type = "button";
    restartBtn.addEventListener("click", function(){
      if(!window.confirm(t("daemonRestartConfirm"))) return;
      daemonAction("restart", restartBtn);
    });
    actions.appendChild(restartBtn);

    var stopBtn = h("button", "btn sm danger", t("daemonStop"));
    stopBtn.type = "button";
    stopBtn.addEventListener("click", function(){
      if(!window.confirm(t("daemonStopConfirm"))) return;
      daemonAction("stop", stopBtn);
    });
    actions.appendChild(stopBtn);
  }
  cardEl.appendChild(actions);
  cardEl.appendChild(h("div", "summary-line dim fs11 mt-8", t("daemonHint")));
  return cardEl;
}

/* --- Overview version journey (three-layer source/artifact/daemon truth) ---
 * The backend /api/status.versionJourney is the single source of truth for
 * whether the edited source, the built product, and the running task service
 * align. The adapter below maps its stable state and nextAction codes into
 * bounded presentation codes only - it never compares digests or build ids,
 * never infers equality from timestamps, and never invents a ready state. */
/* VERSION_JOURNEY_ADAPTER_START */
function versionJourneyView(journey){
  var j = (journey && typeof journey === "object") ? journey : null;
  var state = j && typeof j.state === "string" ? j.state : "unavailable";
  var nextAction = j && typeof j.nextAction === "string" ? j.nextAction : "inspect";
  var rawLayers = (j && j.layers && typeof j.layers === "object") ? j.layers : {};
  var source = (rawLayers.source && typeof rawLayers.source === "object") ? rawLayers.source : {};
  var artifact = (rawLayers.artifact && typeof rawLayers.artifact === "object") ? rawLayers.artifact : {};
  var daemon = (rawLayers.daemon && typeof rawLayers.daemon === "object") ? rawLayers.daemon : {};

  var OUTCOME_KEYS = {
    "ready": "vjOutcomeReady",
    "source-needs-build": "vjOutcomeSourceNeedsBuild",
    "artifact-needs-restart": "vjOutcomeArtifactNeedsRestart",
    "protocol-mismatch": "vjOutcomeProtocolMismatch",
    "unavailable": "vjOutcomeUnavailable"
  };
  var NEXT_ACTION_KEYS = {
    "none": "vjNextNone",
    "build": "vjNextBuild",
    "restart": "vjNextRestart",
    "rebuild-and-restart": "vjNextRebuildAndRestart",
    "inspect": "vjNextInspect"
  };
  /* Unknown codes fall back to the unavailable / inspect branch so a future or
   * malformed code can never be displayed as a green aligned state. */
  var safeState = Object.prototype.hasOwnProperty.call(OUTCOME_KEYS, state) ? state : "unavailable";
  var safeNext = Object.prototype.hasOwnProperty.call(NEXT_ACTION_KEYS, nextAction) ? nextAction : "inspect";

  function sourceLayerState(){
    return source.available === true ? "present" : "unavailable";
  }
  function artifactLayerState(){
    return artifact.available === true ? "present" : "unavailable";
  }
  /* Daemon layer state is read from the availability and running flags only -
   * never from comparing its build identity against the artifact. */
  function daemonLayerState(){
    if(daemon.running === true){
      return daemon.available === true ? "running" : "running-no-identity";
    }
    return "stopped";
  }

  return {
    state: safeState,
    nextAction: safeNext,
    outcomeKey: OUTCOME_KEYS[safeState],
    nextActionKey: NEXT_ACTION_KEYS[safeNext],
    /* Restart is offered only when the backend explicitly says restart is the
     * next action - never for build, rebuild, inspect, or ready. */
    restartEligible: safeNext === "restart",
    layers: {
      source: { available: source.available === true, state: sourceLayerState() },
      artifact: { available: artifact.available === true, state: artifactLayerState() },
      daemon: {
        available: daemon.available === true,
        running: daemon.running === true,
        state: daemonLayerState()
      }
    },
    /* Raw layer evidence for the closed technical disclosure only. Passed
     * through unchanged; the adapter never compares these fields. */
    evidence: { source: source, artifact: artifact, daemon: daemon }
  };
}
/* VERSION_JOURNEY_ADAPTER_END */

/* Plain-language status key for one layer row. Derived from the adapter's
 * layer state (availability + running) only - never from identity comparison. */
function versionJourneyLayerStatusKey(view, layerKey){
  var layer = view.layers[layerKey];
  if(layerKey === "daemon"){
    if(layer.state === "running") return "vjLayerDaemonRunning";
    if(layer.state === "running-no-identity") return "vjLayerDaemonIdentityMissing";
    return "vjLayerDaemonStopped";
  }
  if(!layer.available) return "vjLayerCannotConfirm";
  return layerKey === "source" ? "vjLayerSourceAvailable" : "vjLayerArtifactAvailable";
}

/* Closed technical disclosure: exact digests, build ids, protocol versions,
 * and timestamps live here and never in the primary card copy. */
function versionJourneyTechRow(labelKey, value){
  var r = h("div", "summary-line mono dim fs11");
  r.appendChild(document.createTextNode(t(labelKey) + ": "));
  r.appendChild(document.createTextNode(String(value)));
  return r;
}
/* Each technical row is declared with its full literal label key so the
 * disclosure is auditable; values fall back to a localized "Unavailable". */
function versionJourneyTechnical(view){
  var src = view.evidence.source || {};
  var art = (view.evidence.artifact && view.evidence.artifact.buildIdentity) || null;
  var dae = (view.evidence.daemon && view.evidence.daemon.buildIdentity) || null;
  function trunc(v){ return v ? String(v).slice(0, 16) + "..." : null; }
  function num(v){ return v != null ? String(v) : null; }
  var rows = [
    ["vjTechState", view.state],
    ["vjTechNextAction", view.nextAction],
    ["vjTechSourceDigest", trunc(src.digest)],
    ["vjTechSourceModified", src.latestModifiedAt || null],
    ["vjTechArtifactBuildId", art && art.buildId],
    ["vjTechArtifactVersion", art && art.packageVersion],
    ["vjTechArtifactProtocol", art && num(art.protocolVersion)],
    ["vjTechArtifactBuiltAt", art && art.builtAt],
    ["vjTechArtifactSourceDigest", art && trunc(art.sourceDigest)],
    ["vjTechDaemonBuildId", dae && dae.buildId],
    ["vjTechDaemonVersion", dae && dae.packageVersion],
    ["vjTechDaemonProtocol", dae && num(dae.protocolVersion)],
    ["vjTechDaemonBuiltAt", dae && dae.builtAt],
    ["vjTechDaemonSourceDigest", dae && trunc(dae.sourceDigest)]
  ];
  var box = h("div", "task-technical-body");
  rows.forEach(function(r){
    var value = (r[1] === null || r[1] === undefined || r[1] === "")
      ? t("vjTechUnavailable") : String(r[1]);
    box.appendChild(versionJourneyTechRow(r[0], value));
  });
  return box;
}

/* --- Overview consecutive self-upgrade reliability card ---
 * Backend owns every count, break category, and next-action code. This
 * adapter only maps closed codes to bilingual copy. It never recomputes
 * streaks, never parses command text, and never invents progress for
 * malformed projections (fail closed to unavailable). */
function selfUpgradeEvidenceView(evidence){
  var STATE_KEYS = {
    "empty": "sueStateEmpty",
    "in-progress": "sueStateInProgress",
    "ready": "sueStateReady"
  };
  var BREAK_KEYS = {
    "none": "sueBreakNone",
    "retained-failure": "sueBreakRetainedFailure",
    "rejected": "sueBreakRejected",
    "rolled-back": "sueBreakRolledBack",
    "insufficient-evidence": "sueBreakInsufficientEvidence"
  };
  var NEXT_KEYS = {
    "run-first-upgrade": "sueNextRunFirst",
    "continue-consecutive-proofs": "sueNextContinue",
    "milestone-ready": "sueNextReady"
  };
  if(!evidence || typeof evidence !== "object"){
    return { available: false };
  }
  var e = evidence;
  var state = e.state;
  var breakCategory = e.breakCategory;
  var nextAction = e.nextAction;
  var achieved = e.achieved;
  var required = e.required;
  var remaining = e.remaining;
  if(!Object.prototype.hasOwnProperty.call(STATE_KEYS, state)){
    return { available: false };
  }
  if(!Object.prototype.hasOwnProperty.call(BREAK_KEYS, breakCategory)){
    return { available: false };
  }
  if(!Object.prototype.hasOwnProperty.call(NEXT_KEYS, nextAction)){
    return { available: false };
  }
  if(typeof achieved !== "number" || !Number.isSafeInteger(achieved) || achieved < 0){
    return { available: false };
  }
  if(typeof required !== "number" || !Number.isSafeInteger(required)
    || required < 1 || required > 20){
    return { available: false };
  }
  if(typeof remaining !== "number" || !Number.isSafeInteger(remaining) || remaining < 0){
    return { available: false };
  }
  if(achieved > required) return { available: false };
  if(remaining !== required - achieved) return { available: false };
  if(state === "empty" && (achieved !== 0 || remaining !== required
    || breakCategory !== "none" || nextAction !== "run-first-upgrade")){
    return { available: false };
  }
  if(state === "ready" && (achieved !== required || remaining !== 0
    || breakCategory !== "none" || nextAction !== "milestone-ready")){
    return { available: false };
  }
  if(state === "in-progress" && (achieved >= required
    || nextAction !== "continue-consecutive-proofs")){
    return { available: false };
  }

  function safeOpaqueId(value){
    return typeof value === "string"
      && value.length >= 1 && value.length <= 80
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value)
      && value.indexOf("..") < 0
      && value.indexOf("/") < 0
      && value.indexOf("\\") < 0
      ? value : null;
  }
  function safeIso(value){
    if(typeof value !== "string" || value.length < 20 || value.length > 40) return null;
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return null;
    var ms = Date.parse(value);
    return Number.isFinite(ms) ? value : null;
  }

  return {
    available: true,
    state: state,
    breakCategory: breakCategory,
    nextAction: nextAction,
    achieved: achieved,
    required: required,
    remaining: remaining,
    stateKey: STATE_KEYS[state],
    breakKey: BREAK_KEYS[breakCategory],
    nextKey: NEXT_KEYS[nextAction],
    latestQualifyingAt: safeIso(e.latestQualifyingAt),
    latestQualifyingOperationId: safeOpaqueId(e.latestQualifyingOperationId),
    breakOperationId: safeOpaqueId(e.breakOperationId)
  };
}
function renderSelfUpgradeEvidenceCard(){
  var cardEl = h("div", "card self-upgrade-evidence-card");
  cardEl.setAttribute("data-fl-role", "self-upgrade-evidence");
  cardEl.appendChild(h("div", "card-title mb-4", t("sueCardTitle")));
  cardEl.appendChild(h("div", "summary-line dim mb-8", t("sueCardIntro")));

  if(S.selfUpgradeEvidenceError && !S.selfUpgradeEvidence){
    cardEl.appendChild(evCaveat(
      t("sueUnavailableBridgeHint", {
        reason: S.selfUpgradeEvidenceError || t("sueUnavailableUnknown")
      })
    ));
    return cardEl;
  }
  if(!S.selfUpgradeEvidence){
    cardEl.appendChild(stateMsg("loading", t("sueLoading")));
    return cardEl;
  }

  var view = selfUpgradeEvidenceView(S.selfUpgradeEvidence);
  if(!view.available){
    cardEl.appendChild(evCaveat(
      t("sueUnavailableBridgeHint", { reason: t("sueUnavailableMalformed") })
    ));
    return cardEl;
  }

  var progress = h("div", "summary-line");
  progress.setAttribute("data-fl-role", "self-upgrade-progress");
  progress.appendChild(document.createTextNode(
    t("sueProgress", { achieved: String(view.achieved), required: String(view.required) })
  ));
  cardEl.appendChild(progress);

  cardEl.appendChild(h("div", "summary-line mt-4", t(view.stateKey)));
  if(view.breakCategory !== "none"){
    var br = h("div", "summary-line dim");
    br.setAttribute("data-fl-role", "self-upgrade-break");
    br.appendChild(document.createTextNode(t(view.breakKey)));
    cardEl.appendChild(br);
  }
  if(view.remaining > 0 && view.state !== "ready"){
    cardEl.appendChild(h("div", "summary-line dim fs11", t("sueRemaining", {
      remaining: String(view.remaining)
    })));
  }

  var next = h("div", "vj-next mt-8");
  next.setAttribute("data-fl-role", "self-upgrade-next");
  next.appendChild(h("div", "vj-section-label", t("sueNextLabel")));
  next.appendChild(h("div", "vj-next-text", t(view.nextKey)));
  cardEl.appendChild(next);

  /* Optional technical identities stay collapsed; never primary copy. */
  var tech = h("div", "task-technical-body");
  tech.appendChild(versionJourneyTechRow("sueTechState", view.state));
  tech.appendChild(versionJourneyTechRow("sueTechBreak", view.breakCategory));
  tech.appendChild(versionJourneyTechRow("sueTechNext", view.nextAction));
  if(view.latestQualifyingAt){
    tech.appendChild(versionJourneyTechRow("sueTechLatestAt", view.latestQualifyingAt));
  }
  if(view.latestQualifyingOperationId){
    tech.appendChild(versionJourneyTechRow(
      "sueTechLatestId",
      String(view.latestQualifyingOperationId).slice(0, 12) + "..."
    ));
  }
  if(view.breakOperationId){
    tech.appendChild(versionJourneyTechRow(
      "sueTechBreakId",
      String(view.breakOperationId).slice(0, 12) + "..."
    ));
  }
  cardEl.appendChild(collapsedSection(t("sueTechnicalTitle"), tech));
  return cardEl;
}

/* Compact readiness: one row when setup is complete, prominent only while incomplete. */
function renderCompactReadiness(){
  var hub = S.hub || {};
  var prereq = hub.prerequisites || {};
  var daemon = hub.daemon || {};
  var mains = hub.mains || [];
  var models = (hub.modelCatalog && hub.modelCatalog.models) || [];
  var workers = (hub.workerProfiles && hub.workerProfiles.profiles) || [];
  var allReady = models.length > 0 && workers.length > 0
    && mains.some(function(m){ return (m.plugin && m.plugin.installed) || (m.mcp && m.mcp.installed) || (m.skill && m.skill.installed); })
    && (daemon.running === true || daemon.pid != null);

  if(allReady){
    var row = h("div", "compact-status-row ok");
    row.setAttribute("data-fl-role", "ov-setup-ready");
    row.appendChild(h("span", "compact-status-badge", String.fromCharCode(0x2713)));
    row.appendChild(document.createTextNode(" " + t("ovSetupReady")));
    viewEl.appendChild(row);
    return;
  }
  // Setup incomplete: show the full readiness guide
  rReadiness();
}

/* Compact version row: one line when current, expandable card when mismatched. */
function renderCompactVersionRow(){
  var hub = S.hub || {};
  var view = versionJourneyView(hub.versionJourney);
  var isCurrent = view.state === "ready";
  var row = h("div", "compact-status-row" + (isCurrent ? " ok" : ""));
  row.setAttribute("data-fl-role", "ov-version-row");
  row.appendChild(h("span", "compact-status-badge", isCurrent ? String.fromCharCode(0x2713) : String.fromCharCode(0x26A0)));
  row.appendChild(document.createTextNode(" " + (isCurrent ? t("ovVersionCurrent") : t("ovVersionMismatch"))));
  if(!isCurrent){
    row.classList.add("compact-expandable");
    row.addEventListener("click", function(){
      if(row.nextSibling && row.nextSibling.getAttribute && row.nextSibling.getAttribute("data-fl-role") === "version-journey-expanded"){
        row.nextSibling.remove();
      } else {
        var card = renderVersionJourneyCard();
        card.setAttribute("data-fl-role", "version-journey-expanded");
        row.insertAdjacentElement("afterend", card);
      }
    });
  }
  viewEl.appendChild(row);
}

/* Compact upgrade row: one line when satisfied, summary otherwise. */
function renderCompactUpgradeRow(){
  if(S.selfUpgradeEvidenceError && !S.selfUpgradeEvidence) return;
  if(!S.selfUpgradeEvidence){
    var loading = h("div", "compact-status-row dim");
    loading.textContent = t("sueLoading");
    viewEl.appendChild(loading);
    return;
  }
  var view = selfUpgradeEvidenceView(S.selfUpgradeEvidence);
  if(!view.available) return;
  var satisfied = view.state === "ready" && view.breakCategory === "none";
  var row = h("div", "compact-status-row" + (satisfied ? " ok" : ""));
  row.setAttribute("data-fl-role", "ov-upgrade-row");
  row.appendChild(h("span", "compact-status-badge", satisfied ? String.fromCharCode(0x2713) : String.fromCharCode(0x26A0)));
  row.appendChild(document.createTextNode(" " + (satisfied
    ? t("ovUpgradeSatisfied")
    : t("ovUpgradePending", { achieved: String(view.achieved), required: String(view.required) })
  )));
  if(!satisfied && view.breakCategory !== "none"){
    row.appendChild(h("div", "summary-line dim fs11 mt-4", t(view.breakKey)));
  }
  // Click to expand full card
  if(!satisfied){
    row.classList.add("compact-expandable");
    row.addEventListener("click", function(){
      if(row.nextSibling && row.nextSibling.getAttribute && row.nextSibling.getAttribute("data-fl-role") === "self-upgrade-expanded"){
        row.nextSibling.remove();
      } else {
        row.insertAdjacentElement("afterend", renderSelfUpgradeEvidenceCard());
        if(row.nextSibling) row.nextSibling.setAttribute("data-fl-role", "self-upgrade-expanded");
      }
    });
  }
  viewEl.appendChild(row);
}

/* Compact sample row: one line when done, short hint otherwise. */
function renderCompactSampleRow(){
  if(!S.sample) return;
  var sample = S.sample;
  if(!sample.available) return;
  if(sample.state === "completed" || sample.state === "submitted" || sample.alreadySubmitted){
    var row = h("div", "compact-status-row ok");
    row.setAttribute("data-fl-role", "ov-sample-row");
    row.appendChild(h("span", "compact-status-badge", String.fromCharCode(0x2713)));
    row.appendChild(document.createTextNode(" " + t("ovSampleDone")));
    viewEl.appendChild(row);
    return;
  }
  if(sample.state === "prepared" || sample.state === "empty"){
    var row = h("div", "compact-status-row");
    row.setAttribute("data-fl-role", "ov-sample-row");
    row.appendChild(h("span", "compact-status-badge", String.fromCharCode(0x25CB)));
    row.appendChild(document.createTextNode(" " + t("ovSampleAvailable")));
    row.classList.add("compact-expandable");
    row.addEventListener("click", function(){
      if(row.nextSibling && row.nextSibling.getAttribute && row.nextSibling.getAttribute("data-fl-role") === "guided-sample-expanded"){
        row.nextSibling.remove();
      } else {
        row.insertAdjacentElement("afterend", renderGuidedSampleCard());
        if(row.nextSibling) row.nextSibling.setAttribute("data-fl-role", "guided-sample-expanded");
      }
    });
    viewEl.appendChild(row);
  }
}

/* Overview version card: explains current source, built product, and running
 * task service as three ordered facts, then one outcome and one next action.
 * Exact identity evidence stays inside a closed disclosure. */
function renderVersionJourneyCard(){
  var hub = S.hub || {};
  var view = versionJourneyView(hub.versionJourney);
  var cardEl = h("div", "card version-journey-card");
  cardEl.setAttribute("data-fl-role", "version-journey");
  cardEl.appendChild(h("div", "card-title mb-4", t("vjCardTitle")));
  cardEl.appendChild(h("div", "summary-line dim mb-8", t("vjCardIntro")));

  var layers = h("div", "vj-layers");
  var layerDefs = [
    { key: "source", marker: "version-journey-layer-source", title: "vjLayerSourceTitle", meaning: "vjLayerSourceMeaning" },
    { key: "artifact", marker: "version-journey-layer-artifact", title: "vjLayerArtifactTitle", meaning: "vjLayerArtifactMeaning" },
    { key: "daemon", marker: "version-journey-layer-daemon", title: "vjLayerDaemonTitle", meaning: "vjLayerDaemonMeaning" }
  ];
  layerDefs.forEach(function(def, idx){
    var row = h("div", "vj-layer");
    row.setAttribute("data-fl-role", def.marker);
    row.appendChild(h("div", "vj-layer-num", String(idx + 1)));
    var body = h("div", "vj-layer-body");
    body.appendChild(h("div", "vj-layer-title", t(def.title)));
    body.appendChild(h("div", "vj-layer-meaning", t(def.meaning)));
    body.appendChild(h("div", "vj-layer-status", t(versionJourneyLayerStatusKey(view, def.key))));
    row.appendChild(body);
    layers.appendChild(row);
  });
  cardEl.appendChild(layers);

  var outcome = h("div", "vj-outcome");
  outcome.setAttribute("data-fl-role", "version-journey-outcome");
  outcome.appendChild(h("div", "vj-section-label", t("vjOutcomeLabel")));
  outcome.appendChild(h("div", "vj-outcome-text", t(view.outcomeKey)));
  cardEl.appendChild(outcome);

  var next = h("div", "vj-next");
  next.setAttribute("data-fl-role", "version-journey-next");
  next.appendChild(h("div", "vj-section-label", t("vjNextLabel")));
  next.appendChild(h("div", "vj-next-text", t(view.nextActionKey)));
  cardEl.appendChild(next);

  /* Restart reuses the existing authenticated daemon restart route and its
   * confirmation, and only when the backend says restart is the next action. */
  if(view.restartEligible){
    var actions = h("div", "actions mt-8");
    var restartBtn = h("button", "btn primary sm", t("vjRestartButton"));
    restartBtn.type = "button";
    restartBtn.setAttribute("data-fl-role", "version-journey-restart");
    restartBtn.addEventListener("click", function(){
      if(!window.confirm(t("daemonRestartConfirm"))) return;
      daemonAction("restart", restartBtn);
    });
    actions.appendChild(restartBtn);
    cardEl.appendChild(actions);
  }

  cardEl.appendChild(collapsedSection(t("vjTechnicalTitle"), versionJourneyTechnical(view)));
  return cardEl;
}

/* --- Tasks Kanban --- */
/* Board filter is presentation-only session state; it never mutates Tasks.
 * Scope (Now / History / All) is the primary control; lane and search are
 * secondary and compose with the selected scope. Clearing search + lane never
 * switches the chosen scope. */
var boardFilterQuery = "";
var boardFilterLane = "all";
var boardScope = "now";
/* Two-step submit state: the path input value and the last safe preview.
 * Editing the path invalidates the preview so an old revision can never be
 * reused for a different file. Both survive a poll re-render. */
var boardSubmitPath = "";
var boardPreview = null;
var boardPreviewRequestId = 0;
/* Pending state for the preview-bound class reuse action. While a confirmed
 * reuse request is in flight the reuse buttons, Preview, and Submit are all
 * disabled so a stale confirmation can never race a fresh preview. */
var boardReusePending = false;
function submitPreviewRequestIsCurrent(requestId, requestedPath, currentPath){
  return requestId === boardPreviewRequestId
    && requestedPath === String(currentPath || "").trim();
}

/* --- Durable History (explicit, never polled) ---
 * History is a separate, deliberately loaded read model. It is NOT in
 * PAGE_DEPS or any automatic refresh path: the browser only asks the server
 * for a History page when the user opens History, submits a search, chooses
 * Refresh, or chooses Load more. One request is in flight at a time; a newer
 * search supersedes an in-flight Load more (the older response is dropped via
 * the generation counter and its fetch is aborted). Late responses from an
 * older search can never overwrite the current search. */
var historyState = {
  items: [],
  submittedQuery: "",
  draftQuery: "",
  nextCursor: null,
  totalCount: 0,
  hasMore: false,
  loading: false,
  error: null,
  stale: false,
  loaded: false,
  failedMode: null,
  generation: 0,
};
var historyAbort = null;
function historyUrl(mode){
  var params = new URLSearchParams();
  params.set("limit", "25");
  if(mode === "more" && historyState.nextCursor){
    params.set("cursor", historyState.nextCursor);
  }
  if(historyState.submittedQuery){
    params.set("query", historyState.submittedQuery);
  }
  return "/api/ops/tasks/history?" + params.toString();
}
/** Load one History page. mode: "search" | "refresh" (replace) or "more"
 *  (append + de-duplicate). Replaces the page only after a successful
 *  current-generation response; a later-page failure keeps loaded records,
 *  marks them possibly stale, and leaves a retry action for the renderer. */
function loadHistory(mode){
  if(historyState.loading){
    // Single-flight: a replace may supersede an in-flight Load more by
    // aborting it; a concurrent Load more is ignored.
    if(mode === "more") return;
    if(historyAbort){ try { historyAbort.abort(); } catch(_e){} historyAbort = null; }
  }
  historyState.generation += 1;
  var gen = historyState.generation;
  historyState.loading = true;
  historyState.error = null;
  if(mode !== "more"){
    // Fresh replace clears the stale flag. Items and cursor are replaced only
    // on success, so a failed replace never shows an empty archive.
    historyState.stale = false;
  }
  var controller = new AbortController();
  historyAbort = controller;
  render();
  fetchJSON(historyUrl(mode), { signal: controller.signal })
    .then(function(res){
      if(gen !== historyState.generation) return; // superseded
      var incoming = (res && Array.isArray(res.items)) ? res.items : [];
      if(mode === "more"){
        // De-duplicate by Task id; append only new records.
        var seen = new Set(historyState.items.map(function(it){ return it.id; }));
        incoming.forEach(function(it){
          if(it && !seen.has(it.id)){ historyState.items.push(it); seen.add(it.id); }
        });
      } else {
        historyState.items = incoming;
      }
      historyState.totalCount = typeof res.totalCount === "number"
        ? res.totalCount : historyState.items.length;
      historyState.hasMore = res.hasMore === true;
      historyState.nextCursor = (typeof res.nextCursor === "string" && res.nextCursor)
        ? res.nextCursor : null;
      historyState.loaded = true;
      historyState.stale = false;
      historyState.failedMode = null;
    })
    .catch(function(e){
      if(gen !== historyState.generation) return; // superseded
      // AbortError happens only when a newer search superseded this request.
      if(e && e.name === "AbortError") return;
      historyState.error = (e && e.message) ? e.message : t("historyUnavailable");
      historyState.failedMode = mode;
      if(mode === "more"){
        // Keep loaded records, mark them possibly stale, offer retry.
        historyState.stale = true;
      } else {
        // Replace failure: keep prior records if any (do not clear), and mark
        // them stale. A first-page failure leaves loaded=false so the renderer
        // shows "unavailable" instead of an empty archive.
        historyState.stale = historyState.items.length > 0;
      }
    })
    .finally(function(){
      if(gen === historyState.generation){
        historyState.loading = false;
        historyAbort = null;
      }
      render();
    });
}
function historyRetryMode(){
  // Retry the operation that actually failed. In particular, a failed new
  // search may still be showing retained results and a cursor from the prior
  // query; reusing that old cursor with the new query would fail forever.
  if(historyState.failedMode === "more") return "more";
  return "search";
}
/* Preserve the History search input focus and selection across the periodic
 * board re-render so a user mid-search is not interrupted. The draft value is
 * already held in historyState; this only restores cursor position. */
function historyPreserveInput(){
  var active = document.activeElement;
  if(active && active.classList && active.classList.contains("history-search-input")){
    return { start: active.selectionStart, end: active.selectionEnd };
  }
  return null;
}
function historyRestoreInput(saved){
  if(!saved) return;
  var input = viewEl.querySelector(".history-search-input");
  if(input){
    input.focus();
    try { input.setSelectionRange(saved.start, saved.end); } catch(_e){}
  }
}
function taskMatchesBoardFilter(task, query, lane){
  if(lane && lane !== "all"){
    // The secondary filter is scope-specific: machine lanes for Now/All,
    // outcome groups for History. taskLane is unchanged and selects only on
    // machine status; History groups translate closed boardReason codes.
    if(boardScope === "history"){
      if(taskHistoryGroup(task) !== lane) return false;
    } else if(taskLane(task.status) !== lane){
      return false;
    }
  }
  var q = String(query || "").trim().toLowerCase();
  if(!q) return true;
  var hay = [
    task.name, task.status, task.provider, task.model, task.runtime,
    task.failureCategory, taskProgressSummary(task)
  ].map(function(v){ return String(v || "").toLowerCase(); }).join(" ");
  return hay.indexOf(q) >= 0;
}

/* Render the safe admission preview as beginner-readable facts. Raw digest
 * and full effective policy values stay behind a closed technical disclosure;
 * beginner copy shows only Worker/model/runtime/budget/Attempts/adaptation/
 * quality/Integration facts. No path, command, endpoint, credential, or Task
 * text is rendered. */
function submitFactRow(cls, label, value){
  var r = h("div", "summary-line submit-fact" + (cls ? " " + cls : ""));
  r.appendChild(h("span", "fact-label", label + ": "));
  r.appendChild(h("span", "fact-val", value));
  return r;
}
function submitBudgetText(preview){
  if(preview.budget && preview.budget.unlimited) return t("taskSubmitBudgetUnlimited");
  var amt = preview.budget && typeof preview.budget.maxBudgetUsd === "number"
    ? preview.budget.maxBudgetUsd : null;
  return amt === null ? t("taskSubmitBudgetUnlimited") : ("$" + String(amt));
}
function submitAttemptsText(preview){
  var v = preview.effectivePolicy && preview.effectivePolicy.values;
  if(!v) return "";
  var base = typeof v.baseMaxAttempts === "number" ? v.baseMaxAttempts : 0;
  var extra = typeof v.maxExtraAttempts === "number" ? v.maxExtraAttempts : 0;
  return extra > 0
    ? t("taskSubmitAttemptsValue", { base: base, extra: extra })
    : t("taskSubmitAttemptsNoExtra", { base: base });
}
function submitAdaptationText(preview){
  var v = preview.effectivePolicy && preview.effectivePolicy.values;
  var count = v && typeof v.maxAdaptationRounds === "number" ? v.maxAdaptationRounds : 0;
  return count > 0
    ? t("taskSubmitAdaptationOn", { count: count })
    : t("taskSubmitAdaptationOff");
}
function submitQualityText(preview){
  var q = preview.quality || {};
  var score = typeof q.score === "number" ? q.score : 0;
  return q.passed
    ? t("taskSubmitQualityPass", { score: score })
    : t("taskSubmitQualityFail", { score: score });
}
function submitIntegrationText(preview){
  var integ = preview.integration || {};
  if(!integ.applicable) return t("taskSubmitIntegrationNa");
  return integ.integratable ? t("taskSubmitIntegrationOk") : t("taskSubmitIntegrationWarn");
}
/* Privacy-safe workspace boundary advice inside the execution-boundaries
 * group. Consumes only the safe workspaceBoundaryAdvice: bounded counts and
 * closed codes, never paths, names, Git output, commands, or diagnostics.
 * Git ignore is explicitly labelled a review signal, never proof of generated
 * output. Missing, unknown, or malformed advice (older daemon or corrupt
 * payload) fails closed to a bounded manual-review note so an unknown boundary
 * is never presented as clear and raw advice content is never echoed. */
function submitBoundaryAdviceText(advice){
  if(!advice || typeof advice !== "object"){
    return t("taskSubmitBoundaryLegacy");
  }
  function boundedCount(value){
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  }
  var countsOk = boundedCount(advice.ignoredDirectoryRootCount)
    && boundedCount(advice.coveredCount)
    && boundedCount(advice.visibleBusinessCount);
  var countsAgree = countsOk
    && Number.isSafeInteger(advice.coveredCount + advice.visibleBusinessCount)
    && advice.ignoredDirectoryRootCount === advice.coveredCount + advice.visibleBusinessCount;
  switch(advice.status){
    case "review":
      if(!countsAgree || advice.visibleBusinessCount < 1 || advice.reason !== "checked"
        || advice.nextAction !== "review-workspace-boundaries") return t("taskSubmitBoundaryLegacy");
      return t("taskSubmitBoundaryReview", {
        count: advice.visibleBusinessCount,
        observed: advice.ignoredDirectoryRootCount,
        covered: advice.coveredCount
      }) + " " + t("taskSubmitBoundaryReviewHint");
    case "clear":
      if(!countsAgree || advice.visibleBusinessCount !== 0 || advice.reason !== "checked"
        || advice.nextAction !== "continue") return t("taskSubmitBoundaryLegacy");
      return t("taskSubmitBoundaryClear");
    case "unavailable":
      if(!countsAgree || advice.ignoredDirectoryRootCount !== 0 || advice.reason === "checked"
        || !["not-git", "command-failed", "timed-out", "output-truncated", "malformed-output", "unsafe-count"].includes(advice.reason)
        || advice.nextAction !== "manual-review") return t("taskSubmitBoundaryLegacy");
      return t("taskSubmitBoundaryUnavailable");
    default:
      return t("taskSubmitBoundaryLegacy");
  }
}
/* Worker identity is resolved once and rendered only in the "what will run"
 * section; the routing explanation never repeats it. Falls back to the frozen
 * routing record when an older daemon omits the top-level profile fields. */
function submitWorkerIdentity(preview){
  if(preview.workerProfileId){
    return { id: String(preview.workerProfileId), label: preview.workerProfileLabel ? String(preview.workerProfileLabel) : null };
  }
  var ex = preview.routingExplanation && preview.routingExplanation.selectedWorker;
  if(ex && ex.workerProfileId){
    return { id: String(ex.workerProfileId), label: ex.workerProfileLabel ? String(ex.workerProfileLabel) : null };
  }
  return null;
}
function submitWorkerText(preview){
  var identity = submitWorkerIdentity(preview);
  if(!identity) return "";
  return identity.label && identity.label !== identity.id
    ? identity.label + " (" + identity.id + ")"
    : identity.id;
}
function submitFieldValue(preview, key){
  if(preview[key]) return String(preview[key]);
  var ex = preview.routingExplanation && preview.routingExplanation.selectedWorker;
  if(ex && ex[key]) return String(ex[key]);
  return "";
}
/* Explanation-first routing block: why this Worker was selected, how many
 * candidates Main compared, aggregate historical evidence, and whether a
 * Competition is planned. Consumes only the safe routingExplanation; never
 * the raw routingDecision, private notes, or identity-key maps. Missing
 * explanation (older daemon) degrades to a bounded note. The selected Worker
 * identity itself is rendered once in the "what will run" section above and
 * is deliberately not repeated here. */
function submitRoutingBasisText(code){
  switch(code){
    case "user-specified": return t("taskSubmitRoutingBasisUserSpecified");
    case "only-available": return t("taskSubmitRoutingBasisOnlyAvailable");
    case "historical-evidence": return t("taskSubmitRoutingBasisHistoricalEvidence");
    case "runtime-capability": return t("taskSubmitRoutingBasisRuntimeCapability");
    case "main-judgment": return t("taskSubmitRoutingBasisMainJudgment");
    case "other": return t("taskSubmitRoutingBasisOther");
    default: return null;
  }
}
function submitRoutingScopeText(scope){
  switch(scope){
    case "exact-class": return t("taskSubmitRoutingScopeExactClass");
    case "task-family": return t("taskSubmitRoutingScopeTaskFamily");
    case "none": return t("taskSubmitRoutingScopeNone");
    default: return null;
  }
}
function submitRoutingTriggerText(tr){
  switch(tr){
    case "critical": return t("taskSubmitRoutingTriggerCritical");
    case "multiple-plausible-solutions": return t("taskSubmitRoutingTriggerMultiple");
    case "new-family": return t("taskSubmitRoutingTriggerNewFamily");
    case "user-requested": return t("taskSubmitRoutingTriggerUserRequested");
    default: return null;
  }
}
function submitRoutingCompetitionText(comp){
  if(!comp) return t("taskSubmitRoutingCompetitionMissing");
  var text;
  switch(comp.intent){
    case "required": text = t("taskSubmitRoutingCompetitionRequired"); break;
    case "consider": text = t("taskSubmitRoutingCompetitionConsider"); break;
    default: text = t("taskSubmitRoutingCompetitionNone");
  }
  var triggers = Array.isArray(comp.triggers) ? comp.triggers : [];
  if(triggers.length > 0){
    var labels = [];
    triggers.forEach(function(tr){
      var label = submitRoutingTriggerText(tr);
      if(label) labels.push(label);
    });
    if(labels.length > 0) text += " - " + labels.join(", ");
  }
  return text;
}
function submitRoutingNextActionText(code){
  switch(code){
    case "submit-directly": return t("taskSubmitRoutingNextSubmitDirectly");
    case "consider-competition": return t("taskSubmitRoutingNextConsiderCompetition");
    case "run-competition": return t("taskSubmitRoutingNextRunCompetition");
    case "not-recorded": return t("taskSubmitRoutingNextNotRecorded");
    default: return null;
  }
}
function renderSubmitRoutingExplanation(ex){
  var wrap = h("section", "submit-group submit-group-why");
  wrap.setAttribute("data-fl-role", "submit-why");
  wrap.appendChild(h("h3", "submit-group-title", t("taskSubmitRoutingTitle")));
  wrap.appendChild(h("div", "summary-line dim", t("taskSubmitRoutingBody")));
  if(!ex){
    wrap.appendChild(h("div", "summary-line dim", t("taskSubmitRoutingUnavailable")));
    return wrap;
  }
  if(!ex.present){
    wrap.appendChild(h("div", "summary-line dim", t("taskSubmitRoutingNotRecorded")));
    var notRecordedNext = submitRoutingNextActionText(ex.nextAction);
    if(notRecordedNext) wrap.appendChild(submitFactRow("", t("taskSubmitRoutingFactNext"), notRecordedNext));
    return wrap;
  }
  wrap.appendChild(submitFactRow("", t("taskSubmitRoutingFactShortlist"), t("taskSubmitRoutingShortlistValue", { count: typeof ex.shortlistSize === "number" ? ex.shortlistSize : 0 })));
  var basisText = submitRoutingBasisText(ex.basis);
  if(basisText) wrap.appendChild(submitFactRow("", t("taskSubmitRoutingFactBasis"), basisText));
  if(ex.evidence){
    var scopeText = submitRoutingScopeText(ex.evidence.scope) || String(ex.evidence.scope);
    wrap.appendChild(submitFactRow("", t("taskSubmitRoutingFactScope"), scopeText));
    wrap.appendChild(submitFactRow("", t("taskSubmitRoutingFactEvidence"), t("taskSubmitRoutingEvidenceValue", {
      candidate: typeof ex.evidence.candidateCount === "number" ? ex.evidence.candidateCount : 0,
      total: typeof ex.evidence.totalSamples === "number" ? ex.evidence.totalSamples : 0
    })));
  }
  wrap.appendChild(submitFactRow("", t("taskSubmitRoutingFactCompetition"), submitRoutingCompetitionText(ex.competition)));
  var nextKey = submitRoutingNextActionText(ex.nextAction);
  if(nextKey) wrap.appendChild(submitFactRow("", t("taskSubmitRoutingFactNext"), nextKey));
  return wrap;
}
/* Explanation-first classification reuse block. Shows whether the exact class
 * and family are reused and lists established families with truthful counts.
 * Never a semantic guess, never a ranking, and never Task identity or private
 * content. Missing advice (older daemon) degrades to a bounded note. */
function submitClassificationStateText(evidence){
  if(evidence && evidence.state === "existing"){
    var text = t("taskSubmitClassExisting", { count: evidence.terminalCount });
    if(evidence.completeSelectionCount > 0){
      text += " - " + t("taskSubmitClassExistingComplete", { complete: evidence.completeSelectionCount });
    }
    return text;
  }
  if(evidence && evidence.state === "new") return t("taskSubmitClassNew");
  return t("taskSubmitClassMissing");
}
function submitClassificationNextActionKey(code, hasClassChoices){
  switch(code){
    case "reuse-classification": return "taskSubmitNextReuse";
    case "extend-family": return hasClassChoices ? "taskSubmitNextExtendWithChoices" : "taskSubmitNextExtend";
    case "add-class": return hasClassChoices ? "taskSubmitNextAddClassWithChoices" : "taskSubmitNextAddClass";
    case "add-family": return "taskSubmitNextAddFamily";
    case "confirm-new-family": return "taskSubmitNextConfirmFamily";
    case "fill-classification": return "taskSubmitNextFill";
    default: return null;
  }
}
function renderSubmitClassificationAdvice(advice, options){
  var wrap = h("section", "submit-group submit-group-classify");
  wrap.setAttribute("data-fl-role", "submit-classify");
  wrap.appendChild(h("h3", "submit-group-title", t("taskSubmitClassTitle")));
  wrap.appendChild(h("div", "summary-line dim", t("taskSubmitClassBody")));
  if(!advice){
    wrap.appendChild(h("div", "summary-line dim", t("taskSubmitClassUnavailable")));
    return wrap;
  }
  var c = advice.taskClass || null;
  var f = advice.taskFamily || null;
  wrap.appendChild(submitFactRow("", t("taskSubmitClassFactClass"), submitClassificationStateText(c)));
  wrap.appendChild(submitFactRow("", t("taskSubmitClassFactFamily"), submitClassificationStateText(f)));
  // Full established-family list stays in a native disclosure; the current
  // class/family and the next action above/below remain directly visible.
  var choices = Array.isArray(advice.familyChoices) ? advice.familyChoices : [];
  var familyList = h("div", "submit-family-list");
  if(choices.length > 0){
    choices.forEach(function(choice){
      familyList.appendChild(h("div", "summary-line dim", t("taskSubmitFamilyChoice", {
        family: String(choice.family || ""),
        terminal: typeof choice.terminalCount === "number" ? choice.terminalCount : 0,
        complete: typeof choice.completeSelectionCount === "number" ? choice.completeSelectionCount : 0,
        classes: typeof choice.distinctClassCount === "number" ? choice.distinctClassCount : 0
      })));
    });
  } else {
    familyList.appendChild(h("div", "summary-line dim", t("taskSubmitFamilyChoicesEmpty")));
  }
  wrap.appendChild(collapsedSection(t("taskSubmitFamilyChoices"), familyList));
  // Within-family class candidates are revealed only when the current class is
  // missing or new inside an already-established family, so Main can reuse a
  // stable name instead of inventing a one-off class. They are existing names
  // with truthful counts - never a semantic recommendation, never selected by
  // ForkLight, and no Task identity.
  var classState = c ? c.state : null;
  var familyState = f ? f.state : null;
  var classChoices = Array.isArray(advice.classChoices) ? advice.classChoices : [];
  if((classState === "missing" || classState === "new") && familyState === "existing" && classChoices.length > 0){
    wrap.appendChild(h("div", "summary-line dim", t("taskSubmitClassChoicesHint")));
    var classList = h("div", "submit-family-list");
    // Per-choice draft-only actions appear only when the caller supplies a
    // handler for the exact current preview (file path + digest). ForkLight
    // never preselects a choice; every button requires its own confirmation.
    var showActions = !!(options && options.onReuse && options.eligible);
    var actionsDisabled = showActions && !!(options && options.pending);
    classChoices.forEach(function(choice){
      var name = String(choice.taskClass || "");
      var rowText = t("taskSubmitClassChoice", {
        taskClass: name,
        terminal: typeof choice.terminalCount === "number" ? choice.terminalCount : 0,
        complete: typeof choice.completeSelectionCount === "number" ? choice.completeSelectionCount : 0
      });
      if(showActions){
        var row = h("div", "reuse-class-row");
        row.appendChild(h("span", "summary-line dim reuse-class-name", rowText));
        var reuseBtn = h("button", "btn sm reuse-class-btn", t("taskSubmitClassReuseBtn"));
        reuseBtn.type = "button";
        reuseBtn.setAttribute("data-fl-role", "reuse-class");
        reuseBtn.setAttribute("aria-label", t("taskSubmitClassReuseBtn") + ": " + name);
        if(actionsDisabled) reuseBtn.disabled = true;
        reuseBtn.addEventListener("click", function(){
          if(actionsDisabled || !options || !options.onReuse) return;
          options.onReuse(name, reuseBtn);
        });
        row.appendChild(reuseBtn);
        classList.appendChild(row);
      } else {
        classList.appendChild(h("div", "summary-line dim", rowText));
      }
    });
    // The disclosure is expanded by default because this list is the point of
    // the guidance; it stays a native keyboard-focusable details element.
    var classDetails = document.createElement("details");
    classDetails.className = "audit-details";
    classDetails.setAttribute("open", "");
    var classSummary = document.createElement("summary");
    classSummary.textContent = t("taskSubmitClassChoices");
    classDetails.appendChild(classSummary);
    classDetails.appendChild(classList);
    wrap.appendChild(classDetails);
  }
  var nextKey = submitClassificationNextActionKey(advice.nextAction, classChoices.length > 0);
  if(nextKey){
    wrap.appendChild(h("strong", "summary-line submit-next-label", t("taskSubmitNextAction")));
    wrap.appendChild(h("div", "summary-line submit-next-action", t(nextKey)));
  }
  return wrap;
}
function renderSubmitPreviewFacts(preview, options){
  var wrap = h("div", "submit-preview-facts");
  // 1. What will run: the Task and the single Worker identity that executes it.
  var what = h("section", "submit-group submit-group-what");
  what.setAttribute("data-fl-role", "submit-what");
  what.appendChild(h("h3", "submit-group-title", t("taskSubmitGroupWhat")));
  what.appendChild(submitFactRow("submit-fact-task", t("taskSubmitFactTask"), String(preview.taskName || "")));
  if(submitWorkerIdentity(preview)){
    what.appendChild(submitFactRow("submit-fact-worker", t("taskSubmitFactWorker"), submitWorkerText(preview)));
  }
  what.appendChild(submitFactRow("", t("taskSubmitFactProvider"), submitFieldValue(preview, "provider")));
  what.appendChild(submitFactRow("", t("taskSubmitFactModel"), submitFieldValue(preview, "model")));
  what.appendChild(submitFactRow("", t("taskSubmitFactRuntime"), submitFieldValue(preview, "runtime")));
  what.appendChild(submitFactRow("", t("taskSubmitFactEffort"), submitFieldValue(preview, "effort")));
  what.appendChild(h("div", "summary-line dim mt-4", t("taskSubmitNoTaskStarted")));
  wrap.appendChild(what);
  // 2. Why this Worker: selection basis, evidence, Competition intent and the
  // routing next action; the selected Worker is not repeated here.
  wrap.appendChild(renderSubmitRoutingExplanation(preview.routingExplanation));
  // 3. Execution boundaries: budget, attempts, follow-up Tasks, brief check
  // and Integration safety.
  var bounds = h("section", "submit-group submit-group-boundaries");
  bounds.setAttribute("data-fl-role", "submit-boundaries");
  bounds.appendChild(h("h3", "submit-group-title", t("taskSubmitGroupBoundaries")));
  bounds.appendChild(submitFactRow("", t("taskSubmitFactBudget"), submitBudgetText(preview)));
  bounds.appendChild(submitFactRow("", t("taskSubmitFactAttempts"), submitAttemptsText(preview)));
  bounds.appendChild(submitFactRow("", t("taskSubmitFactAdaptation"), submitAdaptationText(preview)));
  bounds.appendChild(submitFactRow("", t("taskSubmitFactQuality"), submitQualityText(preview)));
  bounds.appendChild(submitFactRow("", t("taskSubmitFactIntegration"), submitIntegrationText(preview)));
  var boundaryText = submitBoundaryAdviceText(preview.workspaceBoundaryAdvice);
  if(boundaryText){
    bounds.appendChild(submitFactRow("", t("taskSubmitFactBoundary"), boundaryText));
  }
  wrap.appendChild(bounds);
  // 4. Classification and next step: current class/family plus the visible
  // user action; the full established-family list stays in a disclosure.
  wrap.appendChild(renderSubmitClassificationAdvice(preview.classificationAdvice, options));
  // Technical disclosure: raw digest and full effective policy values only.
  var tech = h("div", "summary-line mono fs11");
  tech.appendChild(h("span", "", t("taskSubmitDigestLabel") + ": " + String(preview.previewRevisionDigest || "")));
  wrap.appendChild(collapsedSection(t("taskSubmitTechnical"), tech));
  return wrap;
}
function rTasks(){
  // Capture History search focus before clearing the view so a periodic
  // board re-render does not interrupt a user mid-search.
  var savedHistoryInput = historyPreserveInput();
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  viewEl.appendChild(renderPageStory("board"));
  var tasks = S.tasks || [];
  // Submit entry: preview exactly what will run, then confirm a bound submit.
  var submitCard = h("div", "card form-card");
  submitCard.appendChild(h("div", "card-title mb-4", t("taskSubmitTitle")));
  submitCard.appendChild(h("div", "summary-line dim mb-8", t("taskSubmitBody")));
  var pathLab = h("label", "", t("taskSubmitPathLabel"));
  var pathIn = h("input", "");
  pathIn.type = "text";
  pathIn.value = boardSubmitPath;
  pathIn.placeholder = t("taskSubmitPathPlaceholder");
  pathIn.disabled = boardReusePending;
  pathLab.appendChild(pathIn);
  submitCard.appendChild(pathLab);

  var previewArea = h("div", "preview-panel submit-preview-panel");
  var previewBtn = h("button", "btn sm", t("taskSubmitPreviewBtn"));
  previewBtn.type = "button";
  previewBtn.disabled = boardReusePending;
  var submitBtn = h("button", "btn primary sm", t("taskSubmitBtn"));
  submitBtn.type = "button";
  submitBtn.disabled = true;

  function renderSubmitPreview(){
    previewArea.textContent = "";
    if(!boardPreview){
      previewArea.appendChild(h("div", "summary-line dim", t("taskSubmitPreviewEmpty")));
      submitBtn.disabled = true;
      return;
    }
    // Per-choice reuse actions are wired only to the exact current preview;
    // while a reuse request is pending every action and Submit stay disabled.
    previewArea.appendChild(renderSubmitPreviewFacts(boardPreview.preview, {
      onReuse: applyReuseClass,
      eligible: true,
      pending: boardReusePending
    }));
    if(boardReusePending){ submitBtn.disabled = true; } else { submitBtn.disabled = false; }
  }

  function clearSubmitPreview(){
    boardPreview = null;
    renderSubmitPreview();
  }

  function applyReuseClass(taskClass, button){
    if(boardReusePending || !boardPreview) return;
    if(!window.confirm(t("taskSubmitClassReuseConfirm", { taskClass: taskClass }))) return;
    // Capture the exact preview authority before the async request. A periodic
    // board render must not make a successful write dereference newer global
    // preview state or turn success into a client-side failure.
    var reuseFilePath = boardPreview.filePath;
    var reuseDigest = boardPreview.digest;
    boardReusePending = true;
    submitBtn.disabled = true;
    previewBtn.disabled = true;
    pathIn.disabled = true;
    if(button) button.disabled = true;
    var reuseButtons = previewArea.querySelectorAll("[data-fl-role=reuse-class]");
    reuseButtons.forEach(function(b){ b.disabled = true; });
    flashError("");
    postJSON("/api/ops/tasks/reuse-class", {
      filePath: reuseFilePath,
      previewRevisionDigest: reuseDigest,
      taskClass: taskClass,
      confirm: true
    }).then(function(res){
      var pv = res && res.preview;
      if(!pv || typeof pv.previewRevisionDigest !== "string" || !pv.previewRevisionDigest){
        throw new Error("no fresh preview");
      }
      // Success renders ONLY the daemon-returned fresh preview; the old
      // preview is replaced. Ordinary explicit Submit still requires its own
      // separate click and digest-bound confirmation.
      boardPreview = { filePath: reuseFilePath, digest: pv.previewRevisionDigest, preview: pv };
      toast(t("taskSubmitClassReuseOk", { taskClass: taskClass }));
    }).catch(function(e){
      // Stale, forged, repeated or unsafe actions all invalidate submission:
      // clear the preview and ask the user to preview again. Never echoes raw
      // daemon/file diagnostics.
      clearSubmitPreview();
      var msg = e && e.message ? String(e.message) : "";
      if(msg.indexOf("out of date") >= 0 || msg.indexOf("preview again") >= 0){
        flashError(t("taskSubmitClassReuseStale"));
      } else {
        flashError(t("taskSubmitClassReuseFailed"));
      }
    }).finally(function(){
      // Reset pending BEFORE re-rendering so the final DOM state is canonical
      // even when a periodic poll re-rendered the board mid-request.
      boardReusePending = false;
      pathIn.disabled = false;
      previewBtn.disabled = false;
      submitBtn.disabled = !boardPreview;
      renderSubmitPreview();
      refresh();
    });
  }

  pathIn.addEventListener("input", function(){
    boardSubmitPath = pathIn.value;
    // Any path edit invalidates the stored preview so the old revision can
    // never be reused for a different file.
    boardPreviewRequestId += 1;
    clearSubmitPreview();
  });

  previewBtn.addEventListener("click", function(){
    var fp = pathIn.value.trim();
    if(!fp){ flashError(t("taskSubmitPathRequired")); return; }
    var requestId = boardPreviewRequestId + 1;
    boardPreviewRequestId = requestId;
    clearSubmitPreview();
    previewBtn.disabled = true;
    flashError("");
    postJSON("/api/ops/tasks/preview", { filePath: fp })
      .then(function(res){
        if(!submitPreviewRequestIsCurrent(requestId, fp, pathIn.value)) return;
        var pv = res && res.preview;
        if(!pv || typeof pv.previewRevisionDigest !== "string" || !pv.previewRevisionDigest){
          flashError(t("taskSubmitPreviewFailed"));
          boardPreview = null;
          renderSubmitPreview();
          return;
        }
        boardSubmitPath = fp;
        boardPreview = { filePath: fp, digest: pv.previewRevisionDigest, preview: pv };
        renderSubmitPreview();
      })
      .catch(function(e){
        if(!submitPreviewRequestIsCurrent(requestId, fp, pathIn.value)) return;
        boardPreview = null;
        renderSubmitPreview();
        flashError(t("taskSubmitPreviewFailed"), e && e.message);
      })
      .finally(function(){
        if(requestId === boardPreviewRequestId) previewBtn.disabled = false;
      });
  });

  submitBtn.addEventListener("click", function(){
    if(!boardPreview){ flashError(t("taskSubmitPreviewRequired")); return; }
    if(!window.confirm(t("taskSubmitConfirm"))) return;
    submitBtn.disabled = true;
    previewBtn.disabled = true;
    pathIn.disabled = true;
    flashError("");
    postJSON("/api/ops/tasks/submit", {
      filePath: boardPreview.filePath,
      previewRevisionDigest: boardPreview.digest,
      confirm: true
    })
      .then(function(res){
        toast(t("taskSubmitOk", { taskId: res.taskId }));
        boardSubmitPath = "";
        boardPreview = null;
        pathIn.value = "";
        renderSubmitPreview();
        return refresh();
      })
      .catch(function(e){
        // Stale or rejected: the preview is no longer authoritative, so clear
        // it and ask the user to preview again. A stale revision (file or
        // settings drift) gets the explicit "preview again" instruction; any
        // other bounded rejection still clears the preview before retry.
        clearSubmitPreview();
        var msg = e && e.message ? String(e.message) : "";
        if(msg.indexOf("out of date") >= 0 || msg.indexOf("fresh preview") >= 0){
          flashError(t("taskSubmitStale"));
        } else {
          flashError(t("operationFailed"), msg);
        }
      })
      .finally(function(){
        pathIn.disabled = false;
        previewBtn.disabled = false;
        submitBtn.disabled = !boardPreview;
      });
  });

  submitCard.appendChild(hd("div", "actions mt-8", [previewBtn, submitBtn]));
  submitCard.appendChild(previewArea);
  viewEl.appendChild(submitCard);
  renderSubmitPreview();
  if(!tasks.length){
    viewEl.appendChild(stateMsg("empty", t("noTasks")));
    return;
  }

  // Scope is the primary board control: Now (work needing attention),
  // History (durably closed outcomes), and All (every loaded recent task).
  // History has no badge until its separate read model has loaded, then shows
  // the authoritative full-history total. Selecting a scope never mutates
  // Tasks and clearing search/lane never switches scope.
  var nowCount = 0;
  tasks.forEach(function(task){
    if(taskBoardScope(task) !== "history") nowCount += 1;
  });
  var scopeRow = h("div", "board-scope-row");
  scopeRow.appendChild(h("span", "board-scope-label", t("boardScopeLabel")));
  [
    ["now", t("boardScopeNow"), nowCount],
    ["history", t("boardScopeHistory"), historyState.loaded ? historyState.totalCount : null],
    ["all", t("boardScopeAll"), tasks.length]
  ].forEach(function(row){
    var scopeKey = row[0];
    var chip = h("button", "board-scope-chip" + (boardScope === scopeKey ? " is-active" : ""), "");
    chip.type = "button";
    chip.setAttribute("aria-pressed", boardScope === scopeKey ? "true" : "false");
    chip.appendChild(document.createTextNode(row[1] + (row[2] === null ? "" : " ")));
    if(row[2] !== null){
      chip.appendChild(h("span", "legend-count", String(row[2])));
    }
    chip.addEventListener("click", function(){
      boardScope = scopeKey;
      // Secondary lane/outcome filters are scope-specific; reset them on
      // scope switch. Search composes with scope and is preserved.
      boardFilterLane = "all";
      // History loads only when the user opens it and the current submitted
      // query has not been loaded yet. Re-entering History reuses loaded
      // results until Refresh or another search is submitted. Never polled.
      if(scopeKey === "history" && !historyState.loaded && !historyState.loading){
        loadHistory("search");
      }
      rTasks();
    });
    scopeRow.appendChild(chip);
  });
  viewEl.appendChild(scopeRow);

  // History is a deliberate, server-backed read model: it does not share the
  // recent Tasks live filter or machine lanes. Render its explicit search,
  // Refresh, Load more, and honest loaded/total state; the recent Now/All
  // board continues below for the other scopes.
  if(boardScope === "history"){
    viewEl.appendChild(renderHistoryPanel());
    historyRestoreInput(savedHistoryInput);
    return;
  }

  var scoped = tasks.filter(function(task){
    if(boardScope === "all") return true;
    return taskBoardScope(task) === boardScope;
  });
  var filtered = scoped.filter(function(task){
    return taskMatchesBoardFilter(task, boardFilterQuery, boardFilterLane);
  });

  var toolbar = h("div", "kanban-toolbar");
  var legend = h("div", "kanban-legend");
  var legendRows;
  if(boardScope === "history"){
    var groups = { delivered: 0, handled: 0, stopped: 0 };
    scoped.forEach(function(task){
      var g = taskHistoryGroup(task);
      if(g) groups[g] += 1;
    });
    legendRows = [
      ["all", t("taskBoardFilterAll"), scoped.length],
      ["delivered", t("boardHistoryDelivered"), groups.delivered],
      ["handled", t("boardHistoryHandled"), groups.handled],
      ["stopped", t("boardHistoryStopped"), groups.stopped]
    ];
  } else {
    var counts = countByLane(scoped);
    legendRows = [
      ["all", t("taskBoardFilterAll"), scoped.length],
      ["queued", t("taskLaneQueued"), counts.queued],
      ["active", t("taskLaneWorking"), counts.active],
      ["done", t("taskLaneDone"), counts.done],
      ["failed", t("taskLaneFailed"), counts.failed]
    ];
  }
  legendRows.forEach(function(row){
    var laneKey = row[0];
    var item = h("button", "legend-item board-lane-filter" + (boardFilterLane === laneKey ? " is-active" : ""), "");
    item.type = "button";
    item.appendChild(document.createTextNode(row[1] + " "));
    item.appendChild(h("span", "legend-count", String(row[2])));
    item.addEventListener("click", function(){
      boardFilterLane = laneKey;
      rTasks();
    });
    legend.appendChild(item);
  });
  toolbar.appendChild(legend);

  var filterRow = h("div", "board-filter-row");
  var filterLab = h("label", "board-filter-label", t("taskBoardFilterLabel"));
  var filterIn = h("input", "board-filter-input");
  filterIn.type = "search";
  filterIn.placeholder = t("taskBoardFilterPlaceholder");
  filterIn.value = boardFilterQuery;
  filterIn.setAttribute("aria-label", t("taskBoardFilterLabel"));
  filterIn.addEventListener("input", function(){
    boardFilterQuery = filterIn.value;
    rTasks();
    var again = viewEl.querySelector(".board-filter-input");
    if(again){
      again.focus();
      var end = again.value.length;
      try { again.setSelectionRange(end, end); } catch (_e) {}
    }
  });
  filterLab.appendChild(filterIn);
  filterRow.appendChild(filterLab);
  if(boardFilterQuery || boardFilterLane !== "all"){
    var clearBtn = h("button", "btn sm", t("taskBoardFilterClear"));
    clearBtn.type = "button";
    clearBtn.addEventListener("click", function(){
      // Clearing search + lane never switches the chosen scope.
      boardFilterQuery = "";
      boardFilterLane = "all";
      rTasks();
    });
    filterRow.appendChild(clearBtn);
  }
  filterRow.appendChild(h("div", "summary-line", t("taskBoardCount", {
    count: String(filtered.length) + (filtered.length === scoped.length ? "" : " / " + scoped.length)
  })));
  toolbar.appendChild(filterRow);
  viewEl.appendChild(toolbar);

  if(!filtered.length){
    viewEl.appendChild(stateMsg("empty",
      boardScope === "history" ? t("boardHistoryEmpty") : t("taskBoardFilterEmpty")));
    return;
  }

  if(boardScope === "history"){
    viewEl.appendChild(renderHistoryBoard(filtered));
  } else {
    viewEl.appendChild(h("div", "summary-line dim board-scope-helper",
      boardScope === "now" ? t("boardNowHelper") : t("boardAllHelper")));
    var lanes = { queued: [], active: [], done: [], failed: [] };
    filtered.forEach(function(taskItem){ lanes[taskLane(taskItem.status)].push(taskItem); });
    var board = h("div", "kanban");
    board.appendChild(kanbanColumn("queued", t("taskLaneQueued"), "queued", lanes.queued));
    board.appendChild(kanbanColumn("active", t("taskLaneWorking"), "active", lanes.active));
    board.appendChild(kanbanColumn("done", t("taskLaneDone"), "done", lanes.done));
    board.appendChild(kanbanColumn("failed", t("taskLaneFailed"), "failed", lanes.failed));
    viewEl.appendChild(board);
  }
}

/* --- Plans --- */
function rPlans(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  viewEl.appendChild(renderPageStory("plans"));
  if(!S.boards || !S.boards.length){
    viewEl.appendChild(stateMsg("empty", t("noPlans")));
    return;
  }
  var grid = hd("div", "grid-2");
  S.boards.forEach(function(b){
    var pct = b.progress && b.progress.percent === 100 ? "completed" : "active";
    grid.appendChild(card(function(){ showPlanBoard(b.planId); }, [
      cardHead(b.name, "", badge(b.progress && b.progress.total ? pct : "pending")),
      h("div", "card-subtitle mb-4", b.objective || ""),
      progBar(b.progress),
      h("div", "fs11 dim", t("planProgressFull", {
        queued: String(b.progress ? b.progress.queued : 0), waiting: String(b.progress ? b.progress.waiting : 0),
        active: String(b.progress ? b.progress.active : 0), blocked: String(b.progress ? b.progress.blocked : 0),
        failed: String(b.progress ? b.progress.failed : 0), completed: String(b.progress ? b.progress.completed : 0),
        percent: String(b.progress ? b.progress.percent : 0)
      }))
    ]));
  });
  viewEl.appendChild(grid);
}

/* --- Goals (explanation-first durable supervision) --- */
/** Prefer known nextActionCode localization over stored English prose.
 *  Unknown/legacy codes keep bounded stored text; never invent "none". */
function goalNextActionLabel(code, fallback){
  var keys = {
    "wait-for-worker": "goalNextWaitWorker",
    "main-accept": "goalNextMainAccept",
    "main-review": "goalNextMainReview",
    "integrate": "goalNextIntegrate",
    "correct-or-decide": "goalNextCorrectOrDecide",
    "advance": "goalNextAdvance",
    "stop-or-decide": "goalNextStopOrDecide",
    "resume-task": "goalNextResumeTask",
    "none": "goalNextNone"
  };
  if(code && keys[code]) return t(keys[code]);
  if(fallback != null && String(fallback).trim() !== "") return String(fallback);
  return "";
}
/**
 * Localize satisfied integration-milestone delivery provenance.
 * Distinguishes exact Candidate Integration from Main-repaired source under
 * original or amended acceptance without technical command text.
 */
function goalMilestoneDeliveryLabel(basis, fallback){
  if(basis === "amended-acceptance") return t("goalMilestoneDeliveryAmended");
  if(basis === "original-acceptance") return t("goalMilestoneDeliveryOriginal");
  if(basis === "exact-candidate-integration") return t("goalMilestoneDeliveryExact");
  return fallback || "";
}
/** Localize known Goal reasonCode values. Unknown/legacy codes fall back to
 *  the bounded stored reason so history stays readable without English-only
 *  copy leaking into Chinese Goal Detail. */
function goalReasonLabel(code, fallback){
  var keys = {
    "main-stop": "goalReasonMainStop",
    "correction-cap": "goalReasonCorrectionCap",
    "review-cap": "goalReasonReviewCap",
    "no-new-evidence-cap": "goalReasonNoNewEvidenceCap",
    "duration-exceeded": "goalReasonDurationExceeded",
    "no-progress": "goalReasonNoProgress",
    "milestone-failed": "goalReasonMilestoneFailed",
    "waiting-machine": "goalReasonWaitingMachine",
    "waiting-main-accept": "goalReasonWaitingMainAccept",
    "waiting-integration": "goalReasonWaitingIntegration",
    "waiting-task": "goalReasonWaitingTask",
    "goal-completed": "goalReasonGoalCompleted",
    "none": "goalReasonNone"
  };
  if(code && keys[code]) return t(keys[code]);
  if(fallback != null && String(fallback).trim() !== "") return String(fallback);
  return t("goalStoppedDefault");
}
function goalStoryHappenedText(goal){
  goal = goal || {};
  return goalReasonLabel(goal.reasonCode, goal.whatJustHappened || goal.reason || "");
}
function goalStoryWaitingText(goal){
  goal = goal || {};
  if(goal.status === "stopped") return t("goalStoppedWaiting");
  return goalReasonLabel(goal.reasonCode, goal.whatIsWaiting || goal.reason || "");
}
/** Overview card one-liner: terminal Goals explain why they ended (localized
 *  reason); active Goals show the localized next Main action. Unknown legacy
 *  codes keep bounded stored text via the underlying helpers. */
function goalOverviewSummaryText(goal){
  goal = goal || {};
  if(goal.status === "stopped" || goal.status === "completed"){
    return goalStoryHappenedText(goal);
  }
  return goalNextActionLabel(goal.nextActionCode, goal.nextAction);
}
function rGoals(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  viewEl.appendChild(renderPageStory("goals"));
  if(!S.goals || !S.goals.length){
    viewEl.appendChild(stateMsg("empty", t("noGoals")));
    return;
  }
  var grid = hd("div", "grid-2");
  S.goals.forEach(function(g){
    var pr = g.progress || {};
    grid.appendChild(card(function(){ showGoalDetail(g.goalId); }, [
      cardHead(g.name || t("navGoals"), "", badge(g.status || "pending")),
      h("div", "card-subtitle mb-4", g.objective || ""),
      h("div", "summary-line", t("goalProgressCompact", {
        satisfied: String(pr.satisfied || 0),
        total: String(pr.total || 0),
        percent: String(pr.percent || 0)
      })),
      h("div", "summary-line", t("goalWaitingLine", { text: goalStoryWaitingText(g) })),
      h("div", "summary-line dim", t("goalNextLine", {
        text: goalNextActionLabel(g.nextActionCode, g.nextAction)
      }))
    ]));
  });
  viewEl.appendChild(grid);
}

/* --- Outcome composer + intake story (FL-109D2) --- */
/* One calm place to describe the desired result first. The composer collects
 * user text and optional More options fields, submits once through the
 * authenticated Hub create bridge, and never decides a shape or creates work.
 * The intake story renders canonical pending/proposed/created D1/D3A truth
 * from the normal Work refresh path; the browser never invents lifecycle
 * state, never confirms implicitly, and never auto-retries a submission. */

var OUTCOME_SHAPE_KEYS = {
  auto: "outcomeShapeAuto",
  task: "outcomeShapeTask",
  plan: "outcomeShapePlan",
  goal: "outcomeShapeGoal"
};
function outcomeShapeLabel(shape){
  var key = OUTCOME_SHAPE_KEYS[shape] || "outcomeShapeAuto";
  return t(key);
}
function outcomeShapeOptions(){
  return ["auto", "task", "plan", "goal"];
}
function outcomeHasControlCharacters(value){
  for(var i = 0; i < value.length; i += 1){
    var code = value.charCodeAt(i);
    if(code === 127 || code < 32) return true;
  }
  return false;
}
function workCreateTargetContext(target){
  if(!target || target.shape === "goal") return "";
  var parts = ["ForkLight placement context (requested, not yet created):"];
  if(target.goalId){
    parts.push("Goal " + String(target.goalId) + (target.goalName ? " (" + String(target.goalName) + ")" : ""));
  }
  if(target.planId){
    parts.push("Plan " + String(target.planId) + (target.planName ? " (" + String(target.planName) + ")" : ""));
  }
  return parts.join("\n");
}
function workOutcomeContextValue(){
  var entered = String((S.outcomeDraft && S.outcomeDraft.context) || "").trim();
  var placement = workCreateTargetContext(S.workCreateTarget);
  return [entered, placement].filter(Boolean).join("\n\n");
}
function outcomeValidateDraft(){
  var outcome = String(S.outcomeDraft.outcome || "").trim();
  if(!outcome) return "outcomeErrorRequired";
  if(outcome.length > 2000) return "outcomeErrorTooLong";
  if(outcomeHasControlCharacters(outcome)) return "outcomeErrorControl";
  if(workOutcomeContextValue().length > 2000) return "outcomeErrorContextTooLong";
  return null;
}
/* Polite live announcement: screen readers hear state changes without focus
 * being stolen. The region is re-created on every Work render. */
function outcomeAnnounce(message){
  var el = document.getElementById("fl-outcome-live");
  if(!el) return;
  el.textContent = "";
  if(message) el.textContent = String(message);
}
function outcomeSubmit(){
  if(S.outcomeSubmitting) return; // single-flight; never auto-retry
  var validation = outcomeValidateDraft();
  if(validation){
    S.outcomeCreateError = validation;
    render();
    return;
  }
  var draft = S.outcomeDraft;
  var body = {
    outcome: String(draft.outcome || "").trim(),
    requestedShape: (S.workCreateTarget && S.workCreateTarget.shape) || draft.requestedShape || "auto"
  };
  if(typeof draft.project === "string" && draft.project.trim()) body.project = draft.project.trim();
  var outcomeContext = workOutcomeContextValue();
  if(outcomeContext) body.context = outcomeContext;
  S.outcomeSubmitting = true;
  S.outcomeCreateError = null;
  render();
  postJSON("/api/ops/intakes", body).then(function(data){
    S.outcomeSubmitting = false;
    S.outcomeFormActive = false;
    var intake = data && data.intake;
    if(intake && intake.id){
      var list = Array.isArray(S.intakes) ? S.intakes.slice() : [];
      list = [intake].concat(list.filter(function(item){
        return item && item.id !== intake.id;
      }));
      S.intakes = list.slice(0, 20);
      S.selectedIntakeId = intake.id;
      S.outcomeDraft = { outcome: "", project: "", context: "", requestedShape: "auto" };
      S.workCreateTarget = null;
    }
    render();
    outcomeAnnounce(t("outcomeAnnounceRecorded"));
    if(intake && intake.id) outcomeFocusIntake(intake.id);
  }, function(){
    S.outcomeSubmitting = false;
    S.outcomeCreateError = "outcomeCreateError";
    render();
    outcomeAnnounce(t("outcomeCreateError"));
  });
}
function renderOutcomeSection(options){
  options = options || {};
  var wrap = h("div", "outcome-section");
  wrap.setAttribute("data-fl-role", "outcome-section");
  wrap.appendChild(renderOutcomeComposer(options));
  /* FL-112E9: the recorded result's journey stays adjacent to the composer.
   * It never falls below the whole board; the selected intake is the primary
   * journey and older intakes stay a bounded collapsed list. */
  if(options.includeStory !== false) wrap.appendChild(renderIntakeStory());
  return wrap;
}
function workCreateTitle(target){
  if(!target || target.shape === "goal") return t("workCreateGoalTitle");
  if(target.shape === "plan") return t("workCreatePlanTitle", {
    name: target.goalName || t("workUntitledGoal")
  });
  return t("workCreateTaskTitle", {
    name: target.planName || t("workUntitledPlan")
  });
}
function renderOutcomeComposer(options){
  options = options || {};
  var target = options.target || S.workCreateTarget;
  var contextual = !!(target && ["goal", "plan", "task"].indexOf(target.shape) >= 0);
  var title = contextual ? workCreateTitle(target) : t("outcomeTitle");
  var card = h("div", "outcome-composer");
  card.setAttribute("data-fl-role", "outcome-composer");
  if(contextual){
    card.classList.add("is-contextual");
    card.setAttribute("data-create-shape", target.shape);
    if(target.goalId) card.setAttribute("data-goal-id", String(target.goalId));
    if(target.planId) card.setAttribute("data-plan-id", String(target.planId));
  }
  card.appendChild(h("div", "outcome-composer-title", title));
  card.appendChild(h("div", "outcome-composer-hint", contextual ? t("workCreateHint") : t("outcomeHint")));

  var form = document.createElement("form");
  form.className = "outcome-form";
  form.setAttribute("data-fl-role", "outcome-form");
  form.setAttribute("aria-label", title);

  var field = h("label", "outcome-field", "");
  field.appendChild(h("span", "outcome-label", t("outcomeLabel")));
  var textarea = document.createElement("textarea");
  textarea.className = "outcome-textarea";
  textarea.setAttribute("data-fl-role", "outcome-text");
  textarea.rows = 2;
  textarea.placeholder = t("outcomePlaceholder");
  textarea.value = String(S.outcomeDraft.outcome || "");
  textarea.addEventListener("input", function(){
    S.outcomeDraft.outcome = textarea.value;
    S.outcomeFormActive = true;
    workScheduleReadingContextSave();
  });
  field.appendChild(textarea);
  form.appendChild(field);

  var details = document.createElement("details");
  details.className = "outcome-advanced";
  details.setAttribute("data-fl-role", "outcome-advanced");
  var summary = document.createElement("summary");
  summary.textContent = t("outcomeAdvanced");
  details.appendChild(summary);
  var advBody = h("div", "outcome-advanced-body");
  advBody.appendChild(h("div", "outcome-more-options-hint",
    contextual ? t("workCreateOptionsHint") : t("outcomeAdvancedHint")));

  var projWrap = h("label", "outcome-field", "");
  projWrap.appendChild(h("span", "outcome-label", t("outcomeProjectLabel")));
  var projInput = document.createElement("input");
  projInput.type = "text";
  projInput.className = "outcome-input";
  projInput.setAttribute("data-fl-role", "outcome-project");
  projInput.placeholder = t("outcomeProjectPlaceholder");
  projInput.value = String(S.outcomeDraft.project || "");
  projInput.addEventListener("input", function(){
    S.outcomeDraft.project = projInput.value;
    S.outcomeFormActive = true;
    workScheduleReadingContextSave();
  });
  projWrap.appendChild(projInput);
  advBody.appendChild(projWrap);

  var ctxWrap = h("label", "outcome-field", "");
  ctxWrap.appendChild(h("span", "outcome-label", t("outcomeContextLabel")));
  var ctxText = document.createElement("textarea");
  ctxText.className = "outcome-textarea";
  ctxText.setAttribute("data-fl-role", "outcome-context");
  ctxText.rows = 2;
  ctxText.placeholder = t("outcomeContextPlaceholder");
  ctxText.value = String(S.outcomeDraft.context || "");
  ctxText.addEventListener("input", function(){
    S.outcomeDraft.context = ctxText.value;
    S.outcomeFormActive = true;
    workScheduleReadingContextSave();
  });
  ctxWrap.appendChild(ctxText);
  advBody.appendChild(ctxWrap);

  if(!contextual){
    var shapeWrap = h("label", "outcome-field", "");
    shapeWrap.appendChild(h("span", "outcome-label", t("outcomeShapeLabel")));
    var shapeSel = document.createElement("select");
    shapeSel.className = "outcome-select";
    shapeSel.setAttribute("data-fl-role", "outcome-shape");
    outcomeShapeOptions().forEach(function(shape){
      var opt = document.createElement("option");
      opt.value = shape;
      opt.textContent = outcomeShapeLabel(shape);
      shapeSel.appendChild(opt);
    });
    shapeSel.value = S.outcomeDraft.requestedShape || "auto";
    shapeSel.addEventListener("change", function(){
      S.outcomeDraft.requestedShape = shapeSel.value;
      S.outcomeFormActive = true;
      workScheduleReadingContextSave();
    });
    shapeWrap.appendChild(shapeSel);
    advBody.appendChild(shapeWrap);
    advBody.appendChild(h("div", "outcome-field-hint", t("outcomeShapeHint")));
  }
  details.appendChild(advBody);
  form.appendChild(details);

  var actions = h("div", "outcome-actions");
  if(contextual){
    var cancelBtn = h("button", "btn outcome-cancel", t("workCreateCancel"));
    cancelBtn.type = "button";
    cancelBtn.setAttribute("data-fl-role", "work-create-cancel");
    if(S.outcomeSubmitting) cancelBtn.disabled = true;
    cancelBtn.addEventListener("click", function(){ workCloseCreateTarget(target); });
    actions.appendChild(cancelBtn);
  }
  var submitBtn = h("button", "btn primary outcome-submit", S.outcomeSubmitting
    ? t("outcomeSubmitPending")
    : (contextual ? t("workCreateContinue") : t("outcomeSubmit")));
  submitBtn.type = "submit";
  submitBtn.setAttribute("data-fl-role", "outcome-submit");
  if(S.outcomeSubmitting) submitBtn.disabled = true;
  actions.appendChild(submitBtn);
  form.appendChild(actions);

  form.addEventListener("submit", function(e){
    e.preventDefault();
    outcomeSubmit();
  });

  card.appendChild(form);

  if(S.outcomeCreateError){
    var errBox = h("div", "outcome-error");
    errBox.setAttribute("role", "alert");
    errBox.setAttribute("data-fl-role", "outcome-create-error");
    errBox.appendChild(h("div", "outcome-error-title", t(S.outcomeCreateError)));
    errBox.appendChild(h("div", "outcome-error-retry", t("outcomeCreateErrorRetry")));
    card.appendChild(errBox);
  }

  return card;
}
/* FL-112E9: one plain four-step first-use journey. The browser never invents
 * a shape, never starts work, and never confirms implicitly; each step explains
 * what happened, who acts next, and that nothing starts before confirmation. */
var OUTCOME_JOURNEY_KEYS = [
  "outcomeJourneyStep1",
  "outcomeJourneyStep2",
  "outcomeJourneyStep3",
  "outcomeJourneyStep4"
];
function outcomeJourneyCurrentIndex(intake){
  if(!intake) return 0;
  if(intake.status === "created") return 3;
  if(intake.status === "proposed") return 2;
  return 1; // pending
}
function renderOutcomeJourney(intake){
  var current = outcomeJourneyCurrentIndex(intake);
  var wrap = h("ol", "outcome-journey");
  wrap.setAttribute("data-fl-role", "outcome-journey");
  OUTCOME_JOURNEY_KEYS.forEach(function(key, idx){
    var step = h("li", "outcome-journey-step"
      + (idx === current ? " is-current" : "")
      + (idx < current ? " is-done" : ""), t(key));
    if(idx <= current){
      step.setAttribute("aria-current", idx === current ? "step" : "false");
    }
    wrap.appendChild(step);
  });
  return wrap;
}
function renderIntakeStory(){
  var wrap = h("div", "outcome-story");
  wrap.setAttribute("data-fl-role", "outcome-story");
  var live = h("div", "sr-only");
  live.id = "fl-outcome-live";
  live.setAttribute("aria-live", "polite");
  wrap.appendChild(live);

  var intakes = S.intakes;
  if(intakes === null){
    if(S.intakesError){
      var fail = h("div", "outcome-story-note");
      fail.setAttribute("data-fl-role", "outcome-story-unavailable");
      fail.appendChild(h("div", "outcome-story-note-title", t("outcomeUnavailable")));
      fail.appendChild(h("div", "outcome-story-note-body dim", t("outcomeUnavailableBody")));
      wrap.appendChild(fail);
    } else {
      wrap.appendChild(h("div", "outcome-story-note", t("outcomeLoading")));
    }
    return wrap;
  }
  if(!intakes.length){
    var emptyNote = h("div", "outcome-story-note outcome-story-note-empty dim", t("outcomeEmpty"));
    emptyNote.setAttribute("data-fl-role", "outcome-story-empty");
    wrap.appendChild(emptyNote);
    return wrap;
  }

  /* One active intake is primary. A missing or stale selected intake falls
   * back to the first canonical intake without inventing completion, and that
   * primary is excluded from the older-history list so it renders once. */
  var split = outcomeSelectPrimaryIntake(intakes, S.selectedIntakeId);
  if(split.selected) wrap.appendChild(renderIntakeDetail(split.selected));

  /* Older intakes stay a bounded, collapsed history list; never a second
   * long feed beside the active journey. */
  if(split.rest.length){
    wrap.appendChild(renderOutcomeIntakeHistory(split.rest));
  }
  return wrap;
}
/* Presentation-only primary vs history split. Never changes canonical intake
 * order or state; a stale selected id falls back to the first list item and
 * that same item never appears again in the older-history remainder. */
function outcomeSelectPrimaryIntake(intakes, selectedIntakeId){
  var list = Array.isArray(intakes) ? intakes : [];
  var selected = null;
  var primaryId = selectedIntakeId || null;
  if(primaryId){
    for(var i = 0; i < list.length; i++){
      if(list[i] && list[i].id === primaryId){
        selected = list[i];
        break;
      }
    }
  }
  if(!selected) selected = list[0] || null;
  var rest = [];
  for(var j = 0; j < list.length; j++){
    if(!list[j]) continue;
    if(selected && list[j].id === selected.id) continue;
    rest.push(list[j]);
  }
  return { selected: selected, rest: rest };
}
function renderOutcomeIntakeHistory(intakes){
  var details = document.createElement("details");
  details.className = "outcome-history";
  details.setAttribute("data-fl-role", "outcome-intake-history");
  var summary = document.createElement("summary");
  summary.className = "outcome-history-summary";
  summary.setAttribute("data-fl-role", "outcome-history-toggle");
  summary.textContent = t("outcomeHistoryCount", { count: String(intakes.length) });
  details.appendChild(summary);
  var body = h("div", "outcome-history-body");
  intakes.forEach(function(item){
    body.appendChild(renderIntakeRow(item));
  });
  details.appendChild(body);
  return details;
}
function outcomeOutcomePreview(value){
  var text = String(value || "");
  return text.length > 120 ? text.slice(0, 117) + "..." : text;
}
function renderIntakeRow(intake){
  var row = h("button", "outcome-intake-row");
  row.type = "button";
  row.setAttribute("data-fl-role", "outcome-intake-row");
  row.setAttribute("data-intake-id", intake.id);
  row.addEventListener("click", function(){
    S.selectedIntakeId = intake.id;
    render();
    outcomeFocusIntake(intake.id);
  });
  var badgeState = intake.status === "proposed" ? "proposed"
    : (intake.status === "created" ? "created" : "pending");
  var badgeKey = intake.status === "proposed" ? "outcomeStatusProposed"
    : (intake.status === "created" ? "outcomeStatusCreated" : "outcomeStatusPending");
  var badge = h("span", "outcome-status-badge " + badgeState, t(badgeKey));
  row.appendChild(badge);
  row.appendChild(h("span", "outcome-intake-row-text", outcomeOutcomePreview(intake.outcome)));
  return row;
}
function outcomeFocusIntake(id){
  var el = document.querySelector('[data-fl-role="outcome-intake-detail"][data-intake-id="' + id + '"]');
  if(el && typeof el.focus === "function"){
    el.focus();
  }
}
function renderIntakeDetail(intake){
  var card = h("div", "outcome-intake-detail");
  card.setAttribute("data-fl-role", "outcome-intake-detail");
  card.setAttribute("data-intake-id", intake.id);
  card.setAttribute("tabindex", "-1");
  if(intake.status === "proposed"){
    card.appendChild(renderProposedPreview(intake));
  } else if(intake.status === "created"){
    card.appendChild(renderCreatedStory(intake));
  } else {
    card.appendChild(renderPendingStory(intake));
  }
  return card;
}
function outcomeFact(labelKey, value){
  var wrap = h("div", "outcome-fact");
  wrap.appendChild(h("div", "outcome-fact-label", t(labelKey)));
  wrap.appendChild(h("div", "outcome-fact-value", String(value)));
  return wrap;
}
function renderPendingStory(intake){
  var card = h("div", "outcome-pending");
  card.setAttribute("data-fl-role", "outcome-pending");

  card.appendChild(renderOutcomeJourney(intake));

  var head = h("div", "outcome-state-head");
  head.appendChild(h("span", "outcome-state-badge pending", t("outcomeStatusPending")));
  head.appendChild(h("span", "outcome-state-title", t("outcomePendingStatus")));
  card.appendChild(head);

  card.appendChild(h("div", "outcome-fact-label", t("outcomePendingRecorded")));
  card.appendChild(h("div", "outcome-outcome-text", String(intake.outcome || "")));

  var truth = h("div", "outcome-truth");
  truth.setAttribute("data-fl-role", "outcome-pending-truth");
  truth.appendChild(h("div", "outcome-truth-line", t("outcomePendingIntro")));
  card.appendChild(truth);

  /* Who acts next: Main reviews the recorded result in the user's Main
   * client. The exact handoff mechanics stay a secondary disclosure. */
  card.appendChild(h("div", "outcome-next-label", t("outcomeJourneyNext")));
  card.appendChild(h("div", "outcome-next-body", t("outcomePendingWhoNext")));

  card.appendChild(h("div", "outcome-next-label", t("outcomePendingContinue")));
  card.appendChild(h("div", "outcome-next-body", t("outcomePendingContinueBody")));

  /* Repeat the nothing-started truth near the status and the next action so a
   * pending intake is never mistaken for executing work. */
  card.appendChild(h("div", "outcome-truth-line dim", t("outcomePendingNoAuto")));

  /* ID/copy mechanics behind a clear secondary disclosure, not the product
   * flow. The user knows Main must review in their Main client first. */
  var handoffDetails = document.createElement("details");
  handoffDetails.className = "outcome-handoff-disclosure";
  handoffDetails.setAttribute("data-fl-role", "outcome-handoff-disclosure");
  var handoffSummary = document.createElement("summary");
  handoffSummary.className = "outcome-handoff-disclosure-summary";
  handoffSummary.textContent = t("outcomeHandoffTitle");
  handoffDetails.appendChild(handoffSummary);
  var handoffBody = h("div", "outcome-handoff-disclosure-body");
  handoffBody.appendChild(renderIntakeHandoff(intake));
  handoffDetails.appendChild(handoffBody);
  card.appendChild(handoffDetails);

  card.appendChild(renderIntakeTechDetails(intake));
  return card;
}
function renderProposedPreview(intake){
  var card = h("div", "outcome-proposed");
  card.setAttribute("data-fl-role", "outcome-proposed");
  var proposal = intake.proposal || {};

  card.appendChild(renderOutcomeJourney(intake));

  var head = h("div", "outcome-state-head");
  head.appendChild(h("span", "outcome-state-badge proposed", t("outcomeStatusProposed")));
  head.appendChild(h("span", "outcome-state-title", t("outcomeProposedStatus")));
  card.appendChild(head);

  card.appendChild(h("div", "outcome-fact-label", t("outcomePendingRecorded")));
  card.appendChild(h("div", "outcome-outcome-text", String(intake.outcome || "")));

  card.appendChild(outcomeFact("outcomeProposedShape", outcomeShapeLabel(proposal.shape)));
  if(proposal.reason) card.appendChild(outcomeFact("outcomeProposedReason", String(proposal.reason)));
  if(proposal.displayName) card.appendChild(outcomeFact("outcomeProposedDisplay", String(proposal.displayName)));
  if(proposal.objective) card.appendChild(outcomeFact("outcomeProposedObjective", String(proposal.objective)));
  card.appendChild(outcomeFact("outcomeProposedTaskCount", String(proposal.taskCount)));

  if(Array.isArray(proposal.dependencyWaves) && proposal.dependencyWaves.length){
    card.appendChild(outcomeFact("outcomeProposedWaves", String(proposal.dependencyWaves.length)));
    proposal.dependencyWaves.forEach(function(wave, idx){
      card.appendChild(h("div", "outcome-wave", t("outcomeProposedWave", {
        n: String(idx + 1),
        tasks: Array.isArray(wave) ? wave.join(", ") : String(wave)
      })));
    });
  }

  /* When the user's requested shape differs from Main's selection, explain the
   * difference neutrally and change neither fact. */
  if(intake.requestedShape && intake.requestedShape !== "auto" && intake.requestedShape !== proposal.shape){
    var diff = h("div", "outcome-preference-diff");
    diff.setAttribute("data-fl-role", "outcome-preference-diff");
    diff.textContent = t("outcomePreferenceDiff", {
      requested: outcomeShapeLabel(intake.requestedShape),
      selected: outcomeShapeLabel(proposal.shape)
    });
    card.appendChild(diff);
  }

  var truth = h("div", "outcome-truth");
  truth.setAttribute("data-fl-role", "outcome-not-confirmed");
  truth.appendChild(h("div", "outcome-truth-line", t("outcomeNotConfirmed")));
  card.appendChild(truth);

  /* Who acts next is the user: one explicit review and confirmation action. */
  card.appendChild(h("div", "outcome-next-label", t("outcomeJourneyNext")));
  card.appendChild(h("div", "outcome-next-body", t("outcomeProposedWhoNext")));

  /* One clear primary confirmation action, only for a canonical proposed
   * intake. Choosing it opens a contained explicit step that repeats exactly
   * what Main proposed; it never submits, decides a shape, or invents work. */
  if(S.outcomeConfirmingId === intake.id){
    card.appendChild(renderOutcomeConfirmStep(intake));
  } else {
    var confirmBtn = h("button", "btn primary outcome-confirm-open", t("outcomeConfirmAction"));
    confirmBtn.type = "button";
    confirmBtn.setAttribute("data-fl-role", "outcome-confirm-open");
    confirmBtn.addEventListener("click", function(){
      S.outcomeConfirmingId = intake.id;
      S.outcomeConfirmError = null;
      render();
      outcomeFocusConfirmStep(intake.id);
    });
    card.appendChild(confirmBtn);
  }

  card.appendChild(renderIntakeTechDetails(intake));
  return card;
}
function outcomeFocusConfirmStep(id){
  var el = document.querySelector('[data-fl-role="outcome-confirm-step"][data-intake-id="' + id + '"]');
  if(el && typeof el.focus === "function") el.focus();
}
/* Contained explicit confirmation step. Repeats Main's selected shape, display
 * name, and scope count, then states plainly that confirming creates and queues
 * work under the normal rules. Nothing is sent until Confirm creation is chosen
 * and the single-flight request is issued; failure preserves this step. */
function renderOutcomeConfirmStep(intake){
  var proposal = intake.proposal || {};
  var card = h("div", "outcome-confirm");
  card.setAttribute("data-fl-role", "outcome-confirm-step");
  card.setAttribute("data-intake-id", intake.id);
  card.setAttribute("tabindex", "-1");
  card.appendChild(h("div", "outcome-confirm-title", t("outcomeConfirmTitle")));
  card.appendChild(h("div", "outcome-confirm-intro", t("outcomeConfirmIntro")));

  card.appendChild(outcomeFact("outcomeConfirmShape", outcomeShapeLabel(proposal.shape)));
  if(proposal.displayName) card.appendChild(outcomeFact("outcomeConfirmDisplay", String(proposal.displayName)));
  card.appendChild(outcomeFact("outcomeConfirmScope", String(proposal.taskCount)));

  var truth = h("div", "outcome-truth");
  truth.setAttribute("data-fl-role", "outcome-confirm-truth");
  truth.appendChild(h("div", "outcome-truth-line",
    t("outcomeConfirmTruth", { shape: outcomeShapeLabel(proposal.shape) })));
  card.appendChild(truth);

  if(S.outcomeConfirmError){
    var err = h("div", "outcome-error");
    err.setAttribute("role", "alert");
    err.setAttribute("data-fl-role", "outcome-confirm-error");
    err.appendChild(h("div", "outcome-error-title", t(S.outcomeConfirmError)));
    card.appendChild(err);
  }

  var actions = h("div", "outcome-actions outcome-confirm-actions");
  var cancelBtn = h("button", "btn outcome-confirm-cancel", t("outcomeConfirmCancel"));
  cancelBtn.type = "button";
  cancelBtn.setAttribute("data-fl-role", "outcome-confirm-cancel");
  cancelBtn.addEventListener("click", function(){
    S.outcomeConfirmingId = null;
    S.outcomeConfirmError = null;
    render();
  });
  actions.appendChild(cancelBtn);

  var pending = S.outcomeConfirmPendingId === intake.id;
  var submitBtn = h("button", "btn primary outcome-confirm-submit",
    pending ? t("outcomeConfirmPending") : t("outcomeConfirmSubmit"));
  submitBtn.type = "button";
  submitBtn.setAttribute("data-fl-role", "outcome-confirm-submit");
  if(pending) submitBtn.disabled = true;
  submitBtn.addEventListener("click", function(){ outcomeConfirmSubmit(intake); });
  actions.appendChild(submitBtn);
  card.appendChild(actions);
  return card;
}
function outcomeConfirmErrorKey(msg){
  if(msg === "stale-revision") return "outcomeConfirmErrorStaleRevision";
  if(msg === "stale-artifact") return "outcomeConfirmErrorStaleArtifact";
  if(msg === "in-progress") return "outcomeConfirmErrorInProgress";
  if(msg === "no-proposal") return "outcomeConfirmErrorNoProposal";
  return "outcomeConfirmErrorNetwork";
}
/* One single-flight confirmation request. Sends only the intake id (in the
 * path), the current proposal revision, and the literal confirm:true to the
 * D3A authority. Never sends an artifact path, shape, outcome text, context,
 * or full digest. Never optimistically inserts, moves, or marks a Task card.
 * On canonical success the created receipt is rendered first, then one ordinary
 * Work refresh reads the actual hierarchy and intake truth. */
function outcomeConfirmSubmit(intake){
  if(S.outcomeConfirmPendingId) return; // single-flight; never auto-retry
  if(!intake || typeof intake.revision !== "number" || !intake.proposal) return;
  S.outcomeConfirmPendingId = intake.id;
  S.outcomeConfirmError = null;
  render();
  outcomeAnnounce(t("outcomeConfirmAnnounce"));
  postJSON("/api/ops/intakes/" + encodeURIComponent(intake.id) + "/confirm", {
    expectedRevision: intake.revision,
    confirm: true
  }).then(function(data){
    var created = data && (data.intake || data);
    if(!created || !created.id){
      S.outcomeConfirmPendingId = null;
      S.outcomeConfirmError = "outcomeConfirmErrorNetwork";
      render();
      outcomeAnnounce(t("outcomeConfirmErrorNetwork"));
      return;
    }
    /* Replace the canonical intake with the daemon's durable created truth and
     * render the created story first, then refresh the existing Work slices. */
    var list = Array.isArray(S.intakes) ? S.intakes.slice() : [];
    list = [created].concat(list.filter(function(item){ return item && item.id !== created.id; }));
    S.intakes = list.slice(0, 20);
    S.selectedIntakeId = created.id;
    S.outcomeConfirmingId = null;
    S.outcomeConfirmPendingId = null;
    S.outcomeConfirmError = null;
    /* Keep the canonical created-navigation intent so the refreshed hierarchy
     * (not this receipt alone) decides the exact workspace. Idempotent retries
     * reuse the same receipt and cannot create a second graph or navigation. */
    S.outcomeCreatedNavigate = outcomeCreatedNavigateFromConfirmation(created, data && data.receipt);
    S.outcomeCreatedTaskDrawer = null;
    render();
    outcomeAnnounce(t("outcomeConfirmCreatedAnnounce"));
    outcomeFocusIntake(created.id);
    refresh();
  }, function(e){
    S.outcomeConfirmPendingId = null;
    var msg = e && e.message ? String(e.message) : "";
    S.outcomeConfirmError = outcomeConfirmErrorKey(msg);
    render();
    outcomeAnnounce(t(S.outcomeConfirmError));
  });
}
/* FL-112E9: created-work navigation intent.
 * Consumes only the durable confirmation ids (goalId, planId, taskIds) and
 * returns a bounded browser-side intent. It never invents a shape or parent;
 * the exact workspace is decided later against the refreshed hierarchy. */
function outcomeCreatedNavigateFromConfirmation(intake, receipt){
  var confirmation = (intake && intake.confirmation) || receipt || {};
  if(!intake || !intake.id) return null;
  var shape = confirmation.shape || "";
  var goalId = typeof confirmation.goalId === "string" && confirmation.goalId ? confirmation.goalId : "";
  var planId = typeof confirmation.planId === "string" && confirmation.planId ? confirmation.planId : "";
  var taskIds = Array.isArray(confirmation.taskIds)
    ? confirmation.taskIds.filter(function(id){ return typeof id === "string" && id; })
    : [];
  if(shape === "goal" && goalId){
    return { intakeId: String(intake.id), shape: "goal", goalId: goalId, planId: "", taskId: "" };
  }
  if(shape === "plan" && planId){
    return { intakeId: String(intake.id), shape: "plan", goalId: "", planId: planId, taskId: "" };
  }
  if(shape === "task" && taskIds.length){
    return { intakeId: String(intake.id), shape: "task", goalId: "", planId: "", taskId: taskIds[0] };
  }
  return null;
}
/* Whether the created intake's exact hierarchy identity is currently
 * resolvable from WorkHierarchyView. Presentation only; never invents objects. */
function outcomeCreatedIdentityResolvable(view, intake){
  if(!intake || intake.status !== "created" || !view) return false;
  var intent = outcomeCreatedNavigateFromConfirmation(intake, null);
  if(!intent) return false;
  if(intent.shape === "goal" && intent.goalId){
    return workReadingGoalExists(view, intent.goalId);
  }
  if(intent.shape === "plan" && intent.planId){
    return !!(view.independentPlans || []).find(function(item){
      return item && String(item.planId || "") === String(intent.planId);
    });
  }
  if(intent.shape === "task" && intent.taskId){
    var card = workFindTaskCard(view, intent.taskId);
    return !!(card && card.breadcrumb && !card.breadcrumb.goalId && !card.breadcrumb.planId);
  }
  return false;
}
/* Rebuild a bounded created-navigation intent from a canonical created intake
 * when the previous transient intent was already consumed. Requires created
 * status so expired non-created evidence never navigates. When the clicked
 * intake does not match a pending intent, clear that prior intent first so a
 * malformed confirmation cannot open another intake's workspace. */
function outcomeEnsureCreatedNavigation(intake){
  if(!intake || intake.status !== "created") return null;
  var existing = S.outcomeCreatedNavigate;
  if(existing && String(existing.intakeId || "") === String(intake.id || "")){
    return existing;
  }
  /* Clicked created intake does not match the pending intent: drop the old
   * one before deriving. Incomplete confirmation then leaves no intent. */
  S.outcomeCreatedNavigate = null;
  var rebuilt = outcomeCreatedNavigateFromConfirmation(intake, null);
  if(rebuilt) S.outcomeCreatedNavigate = rebuilt;
  return rebuilt;
}
/* Re-apply a created-navigation intent against canonical truth. When the
 * previous intent was already consumed, rebuild it from the clicked created
 * intake. If the identity is not visible yet, one ordinary refresh reads
 * canonical truth; never optimistic and never invents a workspace. */
function outcomeRetryCreatedNavigation(intake){
  if(intake) outcomeEnsureCreatedNavigation(intake);
  if(S.outcomeCreatedNavigate){
    try {
      var view = normalizeWorkHierarchy(S.workHierarchy);
      if(workApplyCreatedNavigation(view)){
        render();
        return;
      }
    } catch(_){}
  }
  /* Identity not visible yet: one ordinary coalesced refresh. Polling is
   * unchanged and this path never loops on its own. */
  refresh();
}
/* Durable created result story. Answers what was created, what happened to
 * execution, and what to do next. Ids and receipt evidence stay under
 * Technical details; no optimistic card and no guessed execution status. */
function renderCreatedStory(intake){
  var card = h("div", "outcome-created");
  card.setAttribute("data-fl-role", "outcome-created");
  card.setAttribute("tabindex", "-1");
  var proposal = intake.proposal || {};
  var confirmation = intake.confirmation || {};

  card.appendChild(renderOutcomeJourney(intake));

  var head = h("div", "outcome-state-head");
  head.appendChild(h("span", "outcome-state-badge created", t("outcomeStatusCreated")));
  head.appendChild(h("span", "outcome-state-title", t("outcomeCreatedStatus")));
  card.appendChild(head);

  var shape = proposal.shape || confirmation.shape || "task";
  var taskCount = Array.isArray(confirmation.taskIds) ? confirmation.taskIds.length
    : (typeof proposal.taskCount === "number" ? proposal.taskCount : 1);

  card.appendChild(h("div", "outcome-fact-label", t("outcomeCreatedWhat")));
  card.appendChild(h("div", "outcome-next-body", t("outcomeCreatedWhatBody", {
    shape: outcomeShapeLabel(shape),
    count: String(taskCount)
  })));

  card.appendChild(h("div", "outcome-next-label", t("outcomeCreatedExecution")));
  card.appendChild(h("div", "outcome-next-body", t("outcomeCreatedExecutionBody")));

  /* Truthful pending-versus-ready copy is based on whether the exact
   * hierarchy identity is currently resolvable, not on transient intent
   * presence, so the story never claims the workspace is open when it is not. */
  var hierarchyView = null;
  try { hierarchyView = normalizeWorkHierarchy(S.workHierarchy); } catch(_){ hierarchyView = null; }
  var identityVisible = outcomeCreatedIdentityResolvable(hierarchyView, intake);

  card.appendChild(h("div", "outcome-next-label", t("outcomeJourneyNext")));
  card.appendChild(h("div", "outcome-next-body",
    t(identityVisible ? "outcomeCreatedWhoNext" : "outcomeCreatedWhoNextPending")));

  card.appendChild(h("div", "outcome-next-label", t("outcomeCreatedNext")));
  card.appendChild(h("div", "outcome-next-body",
    t(identityVisible ? "outcomeCreatedNextBody" : "outcomeCreatedNextBodyPending")));

  /* Open the exact created workspace. This is never optimistic: it only
   * navigates when the refreshed canonical hierarchy contains the created
   * identity. Until then the truthful receipt stays with one primary action. */
  if(!identityVisible){
    card.appendChild(h("div", "outcome-created-not-visible dim",
      t("outcomeCreatedNotVisible")));
  }
  var openBtn = h("button", "btn outcome-created-open", t("outcomeCreatedOpenWorkspace"));
  openBtn.type = "button";
  openBtn.setAttribute("data-fl-role", "outcome-created-open-workspace");
  openBtn.addEventListener("click", function(){ outcomeRetryCreatedNavigation(intake); });
  card.appendChild(openBtn);

  card.appendChild(renderIntakeTechDetails(intake));
  return card;
}
function outcomeHandoffText(intakeId){
  return t("outcomeHandoffText", { id: String(intakeId) });
}
function legacyCopyText(text){
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.className = "outcome-copy-seam";
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch(_) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}
function copyTextToClipboard(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    return navigator.clipboard.writeText(text).then(function(){
      return true;
    }, function(){
      return legacyCopyText(text);
    });
  }
  return Promise.resolve(legacyCopyText(text));
}
function renderIntakeHandoff(intake){
  var wrap = h("div", "outcome-handoff");
  wrap.setAttribute("data-fl-role", "outcome-handoff");
  wrap.appendChild(h("div", "outcome-handoff-title", t("outcomeHandoffTitle")));
  wrap.appendChild(h("div", "outcome-handoff-hint", t("outcomeHandoffHint")));

  var idRow = h("label", "outcome-handoff-id-row", "");
  idRow.appendChild(h("span", "outcome-label", t("outcomeHandoffIdLabel")));
  var idInput = document.createElement("input");
  idInput.type = "text";
  idInput.className = "outcome-handoff-id";
  idInput.setAttribute("data-fl-role", "outcome-handoff-id");
  idInput.setAttribute("readonly", "");
  idInput.value = String(intake.id);
  idRow.appendChild(idInput);
  wrap.appendChild(idRow);

  var feedback = h("div", "outcome-handoff-feedback dim");
  feedback.setAttribute("data-fl-role", "outcome-handoff-feedback");
  wrap.appendChild(feedback);

  var copyBtn = h("button", "btn sm outcome-handoff-copy", t("outcomeHandoffCopy"));
  copyBtn.type = "button";
  copyBtn.setAttribute("data-fl-role", "outcome-handoff-copy");
  copyBtn.addEventListener("click", function(){
    copyTextToClipboard(outcomeHandoffText(intake.id)).then(function(ok){
      if(ok){
        feedback.textContent = t("outcomeHandoffCopied");
        outcomeAnnounce(t("outcomeHandoffCopied"));
        copyBtn.textContent = t("outcomeHandoffCopiedShort");
        setTimeout(function(){
          if(copyBtn.textContent === t("outcomeHandoffCopiedShort")){
            copyBtn.textContent = t("outcomeHandoffCopy");
          }
        }, 2500);
      } else {
        feedback.textContent = t("outcomeHandoffFailed");
        outcomeAnnounce(t("outcomeHandoffFailed"));
      }
    });
  });
  wrap.appendChild(copyBtn);
  return wrap;
}
function outcomeTechRow(labelKey, value){
  var row = h("div", "outcome-tech-row");
  row.appendChild(h("span", "outcome-tech-row-label", t(labelKey)));
  row.appendChild(h("span", "outcome-tech-row-value mono fs11", value));
  return row;
}
function renderIntakeTechDetails(intake){
  var rows = h("div", "outcome-tech-rows");
  var proposal = intake.proposal || {};
  var confirmation = intake.confirmation || {};
  var isCreated = intake.status === "created";
  rows.appendChild(outcomeTechRow("outcomeTechId", String(intake.id)));
  rows.appendChild(outcomeTechRow("outcomeTechRevision", String(intake.revision)));
  if(!isCreated && proposal.artifactDigestPrefix){
    rows.appendChild(outcomeTechRow("outcomeTechDigest", String(proposal.artifactDigestPrefix)));
  }
  if(proposal.artifactKind){
    rows.appendChild(outcomeTechRow("outcomeTechKind", String(proposal.artifactKind)));
  }
  if(Array.isArray(proposal.contractsInvolved) && proposal.contractsInvolved.length){
    rows.appendChild(outcomeTechRow("outcomeTechContracts", proposal.contractsInvolved.join(", ")));
  }
  if(confirmation.receiptId){
    rows.appendChild(outcomeTechRow("outcomeTechReceipt", String(confirmation.receiptId)));
  }
  if(confirmation.shape){
    rows.appendChild(outcomeTechRow("outcomeTechShape", outcomeShapeLabel(confirmation.shape)));
  }
  if(Array.isArray(confirmation.taskIds) && confirmation.taskIds.length){
    rows.appendChild(outcomeTechRow("outcomeTechTaskIds", confirmation.taskIds.join(", ")));
  }
  if(typeof confirmation.planId === "string" && confirmation.planId){
    rows.appendChild(outcomeTechRow("outcomeTechPlanId", confirmation.planId));
  }
  if(typeof confirmation.goalId === "string" && confirmation.goalId){
    rows.appendChild(outcomeTechRow("outcomeTechGoalId", confirmation.goalId));
  }
  if(confirmation.artifactDigestPrefix){
    rows.appendChild(outcomeTechRow("outcomeTechDigest", String(confirmation.artifactDigestPrefix)));
  }
  if(confirmation.confirmedAt){
    rows.appendChild(outcomeTechRow("outcomeTechConfirmedAt", String(confirmation.confirmedAt)));
  }
  return journeyDisclosure(t("outcomeTechnical"), rows);
}

/* --- Unified hierarchical workbench (FL-109B) --- */
/* Frozen seven-column order. Mirrors src/core/work-hierarchy.ts and is used
 * only for layout; the adapter rejects any projection whose column codes or
 * order differ, so this list can never silently diverge from the server. */
var WORK_COLUMN_CODES = [
  "not-started",
  "ready",
  "running",
  "waiting-verification",
  "waiting-user-decision",
  "completed",
  "stopped-failed"
];
function workColumnLabel(code){
  var keys = {
    "not-started": "workColumnNotStarted",
    "ready": "workColumnReady",
    "running": "workColumnRunning",
    "waiting-verification": "workColumnWaitingVerification",
    "waiting-user-decision": "workColumnWaitingDecision",
    "completed": "workColumnCompleted",
    "stopped-failed": "workColumnStopped"
  };
  return keys[code] ? t(keys[code]) : t("workColumnUnknown");
}
function workPlacementLabel(reason){
  var keys = {
    "dependency-unsatisfied": "workPlacementDependency",
    "queued-ready": "workPlacementReady",
    "lifecycle-running": "workPlacementRunning",
    "lifecycle-verifying": "workPlacementVerifying",
    "awaiting-main-decision": "workPlacementDecision",
    "delivered-outcome": "workPlacementDelivered",
    "stopped-or-failed": "workPlacementStopped",
    "unrecognized-evidence": "workPlacementUnknown"
  };
  return keys[reason] ? t(keys[reason]) : t("workPlacementUnknown");
}
/* Build the query string for the Core-filtered hierarchy endpoint from the
 * applied filter only. Never sends a mutation; the endpoint is read-only. */
function workHierarchyQuery(){
  var parts = [];
  if(S.workFilter && S.workFilter.project) parts.push("project=" + encodeURIComponent(S.workFilter.project));
  if(S.workFilter && S.workFilter.columns && S.workFilter.columns.length){
    parts.push("column=" + encodeURIComponent(S.workFilter.columns.join(",")));
  }
  if(S.workFilter && S.workFilter.workerProfileId) parts.push("workerProfileId=" + encodeURIComponent(S.workFilter.workerProfileId));
  return parts.join("&");
}
/* Walk every Task card in the projection. The renderer consumes only these
 * cards; Goal and Plan are context lanes, never cards. */
function workCollectCards(view, fn){
  (view.goals || []).forEach(function(goal){
    (goal.plans || []).forEach(function(plan){
      WORK_COLUMN_CODES.forEach(function(code){
        ((plan.columns && plan.columns[code]) || []).forEach(function(card){ fn(card); });
      });
    });
  });
  (view.independentPlans || []).forEach(function(plan){
    WORK_COLUMN_CODES.forEach(function(code){
      ((plan.columns && plan.columns[code]) || []).forEach(function(card){ fn(card); });
    });
  });
  if(view.oneOffTasks){
    WORK_COLUMN_CODES.forEach(function(code){
      ((view.oneOffTasks.columns && view.oneOffTasks.columns[code]) || []).forEach(function(card){ fn(card); });
    });
  }
}
/* Derive project/Worker filter choices only from an unfiltered projection so a
 * filtered view never shrinks the available options. Project presentation
 * omits internal workspaces from the select while Tasks remain on the board. */
function workRefreshFilterOptions(view){
  var applied = view.filter && view.filter.applied;
  if(applied && (applied.project || applied.columns || applied.workerProfileId)) return;
  var projects = [], workers = [];
  var seenP = {}, seenW = {};
  workCollectCards(view, function(card){
    if(card.project && !seenP[card.project]){ seenP[card.project] = 1; projects.push(card.project); }
    if(card.workerProfileId && !seenW[card.workerProfileId]){ seenW[card.workerProfileId] = 1; workers.push(card.workerProfileId); }
  });
  projects.sort();
  workers.sort();
  var presented = workPresentProjectOptions(projects);
  S.workFilterOptions = {
    projects: presented.options.map(function(o){ return o.value; }),
    workers: workers,
    omittedInternalProjects: presented.omittedInternalCount
  };
}
function workProjectOptionsFromView(){
  var out = [], seen = {};
  workCollectCards(S.workHierarchy, function(card){
    if(card.project && !seen[card.project]){ seen[card.project] = 1; out.push(card.project); }
  });
  out.sort();
  return workPresentProjectOptions(out);
}
function workWorkerOptionsFromView(){
  var out = [], seen = {};
  workCollectCards(S.workHierarchy, function(card){
    if(card.workerProfileId && !seen[card.workerProfileId]){ seen[card.workerProfileId] = 1; out.push(card.workerProfileId); }
  });
  out.sort();
  return out;
}
function workWorkerLabel(id){
  if(!id) return "";
  var profiles = (S.hub && S.hub.workerProfiles && S.hub.workerProfiles.profiles) || [];
  for(var i = 0; i < profiles.length; i++){
    if(profiles[i].id === id && profiles[i].label) return String(profiles[i].label);
  }
  return "";
}
function workWorkerOptionLabel(id){
  return workWorkerLabel(id) || id;
}
function workOption(value, label){
  var o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}
/* Pure presentation: detect ForkLight-internal temporary/review/run/sample/
 * test-fixture project paths so the Project filter can hide them without
 * removing their Tasks from the board. */
function workIsInternalProjectPath(project){
  if(typeof project !== "string" || !project) return true;
  var n = project.replace(/\\/g, "/");
  var lower = n.toLowerCase();
  if(lower === "/tmp" || lower.indexOf("/tmp/") === 0) return true;
  if(lower.indexOf("/private/tmp/") === 0) return true;
  if(lower.indexOf("/var/folders/") === 0) return true;
  if(/\/review-projects(\/|$)/i.test(n)) return true;
  if(/\/forklight\/runs(\/|$)/i.test(n)) return true;
  if(/\/forklight\/samples(\/|$)/i.test(n)) return true;
  if(/\/samples\/[a-z0-9_-]+$/i.test(n) && /forklight/i.test(n)) return true;
  if(/\/fixtures(\/|$)/i.test(n)) return true;
  if(/\/fixture(\/|$)/i.test(n)) return true;
  if(/\/\.forklight(\/|$)/i.test(n)) return true;
  return false;
}
/* Pure presentation: last stable path segment as the human project name. */
function workProjectBaseName(project){
  var n = String(project || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if(!n) return "";
  var parts = n.split("/");
  return parts[parts.length - 1] || n;
}
/* Pure presentation: parent/base when basenames collide, else base alone.
 * Exact path is never the visible label. */
function workProjectHumanLabel(project, siblingPaths){
  var base = workProjectBaseName(project);
  if(!base) return String(project || "");
  var siblings = siblingPaths || [];
  var collisions = 0;
  for(var i = 0; i < siblings.length; i++){
    if(siblings[i] !== project && workProjectBaseName(siblings[i]) === base) collisions++;
  }
  if(collisions === 0) return base;
  var n = String(project || "").replace(/\\/g, "/").replace(/\/+$/, "");
  var parts = n.split("/").filter(Boolean);
  if(parts.length >= 2) return parts[parts.length - 2] + "/" + parts[parts.length - 1];
  return base;
}
/* Pure presentation: stable user-project filter choices with human labels,
 * exact values for the server request, and an omitted-internal count. */
function workPresentProjectOptions(projectPaths){
  var user = [];
  var omitted = 0;
  var seen = {};
  (projectPaths || []).forEach(function(p){
    if(typeof p !== "string" || !p || seen[p]) return;
    seen[p] = 1;
    if(workIsInternalProjectPath(p)){ omitted++; return; }
    user.push(p);
  });
  user.sort();
  return {
    options: user.map(function(value){
      return { value: value, label: workProjectHumanLabel(value, user) };
    }),
    omittedInternalCount: omitted
  };
}
/* Strict versioned adapter. Consumes only WorkHierarchyView schemaVersion 1;
 * unsupported schema or column codes fail visibly instead of rendering a
 * guessed board. This is the only place the browser trusts the server shape. */
function normalizeWorkHierarchy(data){
  if(!data || typeof data !== "object") throw new Error("work-hierarchy missing");
  if(data.schemaVersion !== 1) throw new Error("work-hierarchy schema unsupported");
  var columns = Array.isArray(data.columns) ? data.columns : null;
  if(!columns || columns.length !== WORK_COLUMN_CODES.length){
    throw new Error("work-hierarchy columns invalid");
  }
  for(var i = 0; i < WORK_COLUMN_CODES.length; i++){
    var def = columns[i];
    if(!def || def.code !== WORK_COLUMN_CODES[i] || def.order !== i){
      throw new Error("work-hierarchy column order invalid");
    }
  }
  if(!Array.isArray(data.goals) || !Array.isArray(data.independentPlans)){
    throw new Error("work-hierarchy lanes invalid");
  }
  return data;
}

/* ---------------------------------------------------------------------------
 * FL-112B workspace selection
 *
 * A Work page has one focused workspace at a time. These helpers operate only
 * on canonical ids already present in WorkHierarchyView: no browser-created
 * Goal, Plan, or parent is ever synthesized. The default order is meaningful
 * for a person opening Work for the first time: active Goal, independent Plan,
 * one-off inbox, then finished Goal history.
 * ------------------------------------------------------------------------ */
var WORKSPACE_SELECTION_KINDS = ["goal", "plan", "one-off"];
function workMakeSelection(kind, id){
  if(WORKSPACE_SELECTION_KINDS.indexOf(kind) < 0 || !id) return null;
  return { kind: kind, id: String(id) };
}
function workSelectionKey(selection){
  if(!selection || !selection.kind || !selection.id) return "";
  return String(selection.kind) + ":" + String(selection.id);
}
function workSelectionEqual(left, right){
  return workSelectionKey(left) !== "" && workSelectionKey(left) === workSelectionKey(right);
}
function workGoalIsTerminalStatusForSelection(goal){
  return !!goal && (goal.status === "completed" || goal.status === "stopped" || goal.status === "failed");
}
function workSelectionExists(view, selection){
  if(!view || !selection) return false;
  if(selection.kind === "goal"){
    return (view.goals || []).some(function(goal){ return String(goal.goalId || "") === String(selection.id); });
  }
  if(selection.kind === "plan"){
    return (view.independentPlans || []).some(function(plan){ return String(plan.planId || "") === String(selection.id); });
  }
  return selection.kind === "one-off" && String(selection.id) === "inbox" && !!view.oneOffTasks;
}
function workDefaultSelection(view){
  if(!view) return null;
  var goals = view.goals || [];
  var activeGoal = goals.find(function(goal){ return !workGoalIsTerminalStatusForSelection(goal); });
  if(activeGoal && activeGoal.goalId) return workMakeSelection("goal", activeGoal.goalId);
  var plan = (view.independentPlans || [])[0];
  if(plan && plan.planId) return workMakeSelection("plan", plan.planId);
  if(view.oneOffTasks) return workMakeSelection("one-off", "inbox");
  var finishedGoal = goals.find(function(goal){ return workGoalIsTerminalStatusForSelection(goal); });
  if(finishedGoal && finishedGoal.goalId) return workMakeSelection("goal", finishedGoal.goalId);
  return null;
}
function workResolveSelection(view, current){
  var requested = current && workMakeSelection(current.kind, current.id);
  return workSelectionExists(view, requested) ? requested : workDefaultSelection(view);
}
function workNormalizeTreeWidth(px){
  var n = typeof px === "number" ? px : parseInt(px, 10);
  if(!isFinite(n)) return 280;
  if(n < 200) return 200;
  if(n > 420) return 420;
  return Math.round(n);
}
function workIsNarrowViewport(){
  try {
    return !!(window.matchMedia && window.matchMedia("(max-width: 760px)").matches);
  } catch(_){
    return false;
  }
}
function workNextMobilePane(current, action){
  if(action === "open-file") return "file";
  if(action === "open-detail") return "detail";
  if(action === "open-tree") return "tree";
  if(action === "back"){
    if(current === "detail") return "file";
    if(current === "file") return "tree";
    return "tree";
  }
  return current === "file" || current === "detail" ? current : "tree";
}
function workTreeItemMatches(item, query){
  if(!query) return true;
  var q = String(query).toLocaleLowerCase();
  var parts = [item && item.name, item && item.objective, item && item.cue, item && item.status];
  if(parts.filter(Boolean).join(" ").toLocaleLowerCase().indexOf(q) >= 0) return true;
  var plans = (item && item.plans) || [];
  var tasks = (item && item.tasks) || [];
  return plans.some(function(plan){ return workTreeItemMatches(plan, query); })
    || tasks.some(function(task){ return workTreeItemMatches(task, query); });
}
function composeGoalTreeModel(view, query, scope){
  query = String(query || "").trim();
  scope = scope === "history" ? "history" : "now";
  var now = [];
  var history = [];
  function planItem(plan, goal){
    var tasks = [];
    WORK_COLUMN_CODES.forEach(function(code){
      ((plan && plan.columns && plan.columns[code]) || []).forEach(function(card){
        tasks.push({
          kind: "task",
          id: String(card.taskId || card.id || ""),
          name: card.name || "",
          objective: "",
          status: code,
          cue: card.nextAction || card.nextActionMessage || "",
          breadcrumb: card.breadcrumb || null
        });
      });
    });
    return {
      kind: goal ? "goal-plan" : "plan",
      id: String((plan && plan.planId) || ""),
      name: (plan && plan.name) || "",
      objective: (plan && plan.objective) || "",
      status: "",
      terminal: workLaneIsTerminalHistory(plan && plan.columns),
      decisionCount: (((plan && plan.columns) || {})["waiting-user-decision"] || []).length,
      taskCount: tasks.length,
      cue: workPortfolioCue((plan && plan.summary) || {}),
      goalId: goal ? String(goal.goalId || "") : "",
      goalName: goal ? String(goal.name || "") : "",
      current: !!(goal && String(goal.currentPlanId || "") === String((plan && plan.planId) || "")),
      tasks: tasks
    };
  }
  (view && view.goals || []).forEach(function(goal){
    var item = {
      kind: "goal",
      id: String(goal.goalId || ""),
      name: goal.name || "",
      objective: goal.objective || "",
      status: goal.status || "",
      terminal: workGoalIsTerminalStatusForSelection(goal),
      decisionCount: workGoalDecisionCount(goal),
      taskCount: workGoalTaskCount(goal),
      cue: workPortfolioCue(goal.summary || {}, {
        completedNoDecision: goal.status === "completed" && workGoalDecisionCount(goal) === 0
      }),
      plans: (goal.plans || []).map(function(plan){ return planItem(plan, goal); })
    };
    if(!item.id) return;
    if(item.terminal) history.push(item);
    else now.push(item);
  });
  (view && view.independentPlans || []).forEach(function(plan){
    var live = !workLaneIsTerminalHistory(plan.columns);
    var item = planItem(plan, null);
    if(!item.id) return;
    if(live) now.push(item);
    else history.push(item);
  });
  if(view && view.oneOffTasks){
    var oneOffLive = !workLaneIsTerminalHistory(view.oneOffTasks.columns);
    var item = {
      kind: "one-off",
      id: "inbox",
      name: "",
      objective: "",
      status: "",
      terminal: !oneOffLive,
      decisionCount: ((view.oneOffTasks.columns && view.oneOffTasks.columns["waiting-user-decision"]) || []).length,
      taskCount: workOneOffCardCount(view),
      cue: workPortfolioCue(view.oneOffTasks.summary || {})
    };
    if(oneOffLive) now.push(item);
    else history.push(item);
  }
  var source = scope === "history" ? history : now;
  return {
    now: now,
    history: history,
    scope: scope,
    query: query,
    visible: source.filter(function(entry){ return workTreeItemMatches(entry, query); })
  };
}
function composeGoalFileModel(goal, viewedPlan){
  var decisionCount = workGoalDecisionCount(goal);
  var viewed = viewedPlan || workGoalCurrentPlan(goal);
  var currentIndex = viewed && goal ? (goal.plans || []).indexOf(viewed) : -1;
  if(currentIndex < 0 && viewed && goal){
    currentIndex = (goal.plans || []).findIndex(function(plan){
      return String(plan.planId || "") === String(viewed.planId || "");
    });
  }
  var phaseState = currentIndex >= 0 ? workGoalPhaseState(goal, currentIndex) : "unknown";
  var currentCards = [];
  var blockedCards = [];
  var historyCards = [];
  if(viewed && viewed.columns){
    GOAL_FILE_CURRENT_CODES.forEach(function(code){
      ((viewed.columns[code]) || []).forEach(function(card){ currentCards.push(card); });
    });
    GOAL_FILE_BLOCKED_CODES.forEach(function(code){
      ((viewed.columns[code]) || []).forEach(function(card){ blockedCards.push(card); });
    });
    GOAL_FILE_HISTORY_CODES.forEach(function(code){
      ((viewed.columns[code]) || []).forEach(function(card){ historyCards.push(card); });
    });
  }
  var currentTask = currentCards[0] || blockedCards[0] || null;
  var blockers = [];
  if(workLaneHasRealBlocker(goal && goal.summary && goal.summary.blocker, goal && goal.summary && goal.summary.blockerMessage)){
    blockers.push({
      source: "goal",
      text: workNarrativeText(goal.summary.blockerMessage, goal.summary.blocker)
    });
  }
  function pushCardBlocker(card){
    var fact = workNarrativeText(card.whatCompletedMessage, card.whatCompleted || "");
    var next = workLaneNextActionText(card, {});
    var label = "";
    (card.blockers || []).forEach(function(blocker){
      if(!label) label = workSafeCardBlockerLabel(card, blocker);
    });
    if(!fact && !next && !label) return;
    blockers.push({
      source: "task",
      taskId: card.taskId,
      text: label || next || fact,
      fact: fact,
      reason: label || next,
      retained: fact,
      next: next
    });
  }
  blockedCards.forEach(pushCardBlocker);
  currentCards.concat(historyCards).forEach(function(card){
    (card.blockers || []).forEach(function(blocker){
      var label = workSafeCardBlockerLabel(card, blocker);
      if(label) blockers.push({ source: "task", taskId: card.taskId, text: label });
    });
  });
  return {
    desiredResult: (goal && goal.objective) || "",
    currentTruth: workSummaryWhat(goal && goal.summary),
    decisionNeeded: decisionCount > 0,
    decisionCount: decisionCount,
    phase: viewed || null,
    phaseState: phaseState,
    currentTask: currentTask,
    currentCards: currentCards,
    blockedCards: blockedCards,
    historyCards: historyCards,
    blockers: blockers,
    terminal: workGoalIsTerminalStatusForSelection(goal),
    status: (goal && goal.status) || "",
    nextAction: workSummaryNext(goal && goal.summary, {
      completedNoDecision: !!(goal && goal.status === "completed" && decisionCount === 0)
    }),
    sectionOrder: [
      "desired-result", "current-truth", "decision", "phase",
      "current-task", "blockers", "delivery", "evidence"
    ]
  };
}
function collectDecisionGroups(view){
  var byGoal = {};
  var order = [];
  var parentless = [];
  function add(card, goalId, goalName){
    if(!card || card.column !== "waiting-user-decision") return;
    var item = {
      taskId: card.taskId,
      name: card.name || "",
      fact: workNarrativeText(card.whatCompletedMessage, card.whatCompleted || ""),
      reason: workNarrativeText(card.nextActionMessage, card.nextAction || ""),
      retained: workNarrativeText(card.whatCompletedMessage, card.whatCompleted || ""),
      impact: workPlacementLabel(card.placementReason),
      card: card,
      goalId: goalId || "",
      goalName: goalName || ""
    };
    if(!goalId){
      parentless.push(item);
      return;
    }
    if(!byGoal[goalId]){
      byGoal[goalId] = { goalId: goalId, goalName: goalName || "", items: [] };
      order.push(goalId);
    }
    byGoal[goalId].items.push(item);
  }
  (view && view.goals || []).forEach(function(goal){
    (goal.plans || []).forEach(function(plan){
      ((plan.columns && plan.columns["waiting-user-decision"]) || []).forEach(function(card){
        add(card, String(goal.goalId || ""), goal.name || "");
      });
    });
  });
  (view && view.independentPlans || []).forEach(function(plan){
    ((plan.columns && plan.columns["waiting-user-decision"]) || []).forEach(function(card){
      var crumb = card.breadcrumb || {};
      add(card, crumb.goalId ? String(crumb.goalId) : "", crumb.goalName || "");
    });
  });
  if(view && view.oneOffTasks){
    ((view.oneOffTasks.columns && view.oneOffTasks.columns["waiting-user-decision"]) || []).forEach(function(card){
      var crumb = card.breadcrumb || {};
      add(card, crumb.goalId ? String(crumb.goalId) : "", crumb.goalName || "");
    });
  }
  var groups = order.map(function(id){ return byGoal[id]; });
  var total = parentless.length;
  groups.forEach(function(group){ total += group.items.length; });
  return { groups: groups, parentless: parentless, total: total };
}
function collectSetupBlockers(){
  var hub = S.hub || {};
  var daemon = hub.daemon || {};
  var mains = hub.mains || [];
  var models = (hub.modelCatalog && hub.modelCatalog.models) || [];
  var workers = (hub.workerProfiles && hub.workerProfiles.profiles) || [];
  var items = [];
  if(!models.length){
    items.push({ reason: t("readyModels"), next: "model", action: t("navModels") });
  }
  if(!workers.length){
    items.push({ reason: t("readyWorkers"), next: "worker", action: t("navWorkers") });
  }
  var mainReady = mains.some(function(m){
    return (m.plugin && m.plugin.installed) || (m.mcp && m.mcp.installed) || (m.skill && m.skill.installed);
  });
  if(!mainReady){
    items.push({ reason: t("readyMain"), next: "mains", action: t("navMain") });
  }
  if(!(daemon.running === true || daemon.pid != null)){
    items.push({ reason: t("readyDaemon"), next: "work", action: t("ovDaemon") });
  }
  return items;
}
function workApplyTreeWidth(px){
  var width = workNormalizeTreeWidth(px);
  S.workTreeWidth = width;
  var tree = viewEl && viewEl.querySelector('[data-fl-role="goal-tree"]');
  if(tree) tree.setAttribute("style", "--goal-tree-width:" + width + "px");
  var layout = viewEl && viewEl.querySelector('[data-fl-role="workbench-layout"]');
  if(layout) layout.setAttribute("style", "--goal-tree-width:" + width + "px");
  return width;
}
function workApplyMobilePane(pane){
  S.workMobilePane = pane === "file" || pane === "detail" ? pane : "tree";
  var layout = viewEl && viewEl.querySelector('[data-fl-role="workbench-layout"]');
  if(layout) layout.setAttribute("data-mobile-pane", S.workMobilePane);
  if(document && document.body){
    document.body.setAttribute("data-mobile-pane", S.workMobilePane);
    document.body.setAttribute("data-hub-tab", S.tab || "work");
  }
  workUpdateMobileBack();
}
/* Narrow Goal-file entry must start at the Goal header and result, not at the
 * leftover tree/page scroll. Background polls keep restore; only a deliberate
 * open-file action calls this. */
function workApplyGoalFileStart(){
  if(!workIsNarrowViewport()) return;
  if(!S || S.workMobilePane !== "file") return;
  /* Force header-top after any earlier focus/scrollIntoView. Do not
   * call scrollIntoView here: it reintroduces the 80px page offset. */
  try {
    var fileHost = viewEl && viewEl.querySelector('[data-fl-role="goal-file-host"]');
    if(fileHost) fileHost.scrollTop = 0;
  } catch(_){}
  try {
    var content = workContentScrollEl();
    if(content){
      content.scrollTop = 0;
      content.scrollLeft = 0;
    }
  } catch(_){}
}
function workUpdateMobileBack(){
  var btn = document.getElementById("fl-mobile-back");
  if(!btn) return;
  var narrow = workIsNarrowViewport();
  var show = false;
  if(narrow && S.detail) show = true;
  else if(narrow && (S.tab || "work") === "work" && S.workMobilePane !== "tree") show = true;
  else if(narrow && S.tab === "decisions" && S.detail) show = true;
  btn.hidden = !show;
}
function workBindViewportPresentation(){
  try {
    if(!window.matchMedia) return;
    var mq = window.matchMedia("(max-width: 760px)");
    if(mq.addEventListener) mq.addEventListener("change", workUpdateMobileBack);
    else if(mq.addListener) mq.addListener(workUpdateMobileBack);
  } catch(_){}
}
function systemMenuElement(){
  return document.getElementById("fl-system-menu");
}
function systemMenuSummary(system){
  return system ? system.querySelector("summary") : null;
}
function closeSystemMenu(opts){
  var system = systemMenuElement();
  if(!system || !system.open) return false;
  system.open = false;
  if(opts && opts.focusSummary){
    var summary = systemMenuSummary(system);
    if(summary && typeof summary.focus === "function") summary.focus();
  }
  return true;
}
function closeSystemMenuOnRouteSelection(){
  closeSystemMenu();
}
function systemMenuEventIsInside(event){
  var system = systemMenuElement();
  if(!system || !event) return false;
  var target = event.target;
  return !!(target && system.contains(target));
}
function onSystemMenuPointerDown(event){
  if(systemMenuEventIsInside(event)) return;
  closeSystemMenu();
}
function onSystemMenuTouchStart(event){
  if(systemMenuEventIsInside(event)) return;
  closeSystemMenu();
}
function onSystemMenuEscape(event){
  if(!event || event.key !== "Escape") return false;
  var system = systemMenuElement();
  if(!system || !system.open) return false;
  closeSystemMenu({ focusSummary: true });
  return true;
}
function workMobileBack(){
  if(S.detail){
    hideDetail();
    workApplyMobilePane(workNextMobilePane("detail", "back"));
    return;
  }
  workApplyMobilePane(workNextMobilePane(S.workMobilePane, "back"));
  /* Returning to the tree must not leave the page scrolled to the Goal file.
   * The tree keeps its own reading position on [data-fl-role="goal-tree"]. */
  if(S.workMobilePane === "tree" && workIsNarrowViewport()){
    try {
      var content = workContentScrollEl();
      if(content){
        content.scrollTop = 0;
        content.scrollLeft = 0;
      }
    } catch(_){}
  }
}
function updateProductNav(){
  var effective = S.tab || "work";
  $$("#fl-tabs [data-tab]").forEach(function(b){
    var tab = b.getAttribute("data-tab");
    var active = tab === effective
      || (tab === "work" && effective !== "work" && LEGACY_TAB_REDIRECT[effective] === "work");
    b.classList.toggle("active", active);
  });
  var system = document.getElementById("fl-system-menu");
  if(system){
    system.classList.toggle("is-active", SYSTEM_TABS.indexOf(effective) >= 0);
  }
  workUpdateMobileBack();
}
/* FL-112E9: apply a pending created-work navigation intent against the
 * refreshed canonical hierarchy only. Goal opens its Goal workspace; a
 * standalone Plan opens its Plan workspace; a parentless Task selects
 * Independent Tasks and opens its Task drawer with the canonical card. Missing
 * or stale identities fail safely and the truthful created receipt stays. */
function workApplyCreatedNavigation(view){
  var intent = S.outcomeCreatedNavigate;
  if(!intent || !view || !intent.intakeId) return false;
  var intake = Array.isArray(S.intakes) ? S.intakes.find(function(item){
    return item && String(item.id || "") === String(intent.intakeId);
  }) : null;
  if(!intake || intake.status !== "created"){
    /* Stale identity: never navigate from a receipt without canonical truth. */
    S.outcomeCreatedNavigate = null;
    S.outcomeCreatedTaskDrawer = null;
    return false;
  }
  if(intent.shape === "goal" && intent.goalId && workReadingGoalExists(view, intent.goalId)){
    var goalSelection = workMakeSelection("goal", intent.goalId);
    if(workSelectionEqual(S.workSelection, goalSelection)){
      /* Idempotent retry: the exact workspace is already open. No duplicate
       * navigation or focus jump; just consume the intent. */
      S.outcomeCreatedNavigate = null;
      return true;
    }
    S.workSelection = goalSelection;
    S.workViewedGoalId = String(intent.goalId);
    S.workViewedPlanId = null;
    S.outcomeCreatedNavigate = null;
    workBoardFocusRequest = { key: workSelectionKey(S.workSelection) };
    return true;
  }
  if(intent.shape === "plan" && intent.planId){
    var plan = (view.independentPlans || []).find(function(item){
      return item && String(item.planId || "") === String(intent.planId);
    });
    if(plan){
      var planSelection = workMakeSelection("plan", intent.planId);
      S.outcomeCreatedNavigate = null;
      if(workSelectionEqual(S.workSelection, planSelection)) return true;
      S.workSelection = planSelection;
      workBoardFocusRequest = { key: workSelectionKey(S.workSelection) };
      return true;
    }
  }
  if(intent.shape === "task" && intent.taskId){
    var card = workFindTaskCard(view, intent.taskId);
    /* Only a parentless one-off Task opens the Independent Tasks drawer; the
     * canonical card's breadcrumb (never a guessed ancestor) feeds the drawer. */
    if(card && !card.breadcrumb.goalId && !card.breadcrumb.planId){
      var oneOffSelection = workMakeSelection("one-off", "inbox");
      S.outcomeCreatedNavigate = null;
      if(!workSelectionEqual(S.workSelection, oneOffSelection)){
        S.workSelection = oneOffSelection;
        workBoardFocusRequest = { key: workSelectionKey(S.workSelection) };
      }
      S.outcomeCreatedTaskDrawer = { taskId: String(intent.taskId), crumb: card.breadcrumb || null };
      return true;
    }
  }
  return false;
}
/* After the created workspace mounts, open the exact parentless Task drawer
 * with the canonical card. Missing cards fail safely without invented ancestry. */
function workOpenCreatedTaskDrawer(view){
  var intent = S.outcomeCreatedTaskDrawer;
  if(!intent) return;
  S.outcomeCreatedTaskDrawer = null;
  if(!view || !intent.taskId || !workReadingTaskExists(view, intent.taskId)) return;
  var card = workFindTaskCard(view, intent.taskId);
  showTask(intent.taskId, (card && card.breadcrumb) || null);
}
function workSelectWorkspace(kind, id){
  var next = workMakeSelection(kind, id);
  if(!next) return;
  if(workSelectionEqual(S.workSelection, next)){
    if(workIsNarrowViewport() && S.workMobilePane !== "file" && S.workMobilePane !== "detail"){
      workApplyMobilePane(workNextMobilePane(S.workMobilePane || "tree", "open-file"));
      workApplyGoalFileStart();
      workScheduleReadingContextSave();
    }
    return;
  }
  S.workSelection = next;
  workBoardFocusRequest = { key: workSelectionKey(next) };
  if(next.kind === "goal"){
    S.workViewedGoalId = next.id;
    S.workViewedPlanId = null;
  }
  workActionChooserReset();
  workPendingHandoffReset();
  hideDetail();
  if(workIsNarrowViewport()) workApplyMobilePane(workNextMobilePane(S.workMobilePane, "open-file"));
  render();
  /* On a stacked narrow layout, a deliberate selection opens the Goal file
   * pane at its header and result. Background refreshes keep the position. */
  try {
    if(workIsNarrowViewport()){
      var focused = viewEl && viewEl.querySelector('[data-fl-role="work-focus"]');
      if(focused){
        focused.setAttribute("tabindex", "-1");
        try { focused.focus({ preventScroll: true }); } catch(_){ focused.focus(); }
      }
      workApplyGoalFileStart();
    }
  } catch(_){}
  workScheduleReadingContextSave();
}
/* Collapse state is tab-local and bounded: boolean entries keyed by technical
 * id live only in sessionStorage (localStorage stays reserved for the theme).
 * Missing key = smart default; explicit true/false always wins over the default.
 * No server mutation and no technical id is shown as visible copy. */
var workCollapse = null;
function workCollapseLoad(){
  try {
    var raw = sessionStorage.getItem("fl-work-collapse");
    if(!raw) return {};
    var parsed = JSON.parse(raw);
    if(parsed && typeof parsed === "object" && !Array.isArray(parsed)){
      var bounded = {};
      Object.keys(parsed).sort().slice(0, WORK_READING_CONTEXT_MAX_COLLAPSE).forEach(function(key){
        if(/^[A-Za-z0-9:_-]+$/.test(key) && typeof parsed[key] === "boolean"){
          bounded[key] = parsed[key];
        }
      });
      return bounded;
    }
  } catch(_){}
  return {};
}
function workCollapseSave(collapse){
  try {
    var bounded = {};
    if(collapse && typeof collapse === "object"){
      Object.keys(collapse).sort().slice(0, WORK_READING_CONTEXT_MAX_COLLAPSE).forEach(function(key){
        if(/^[A-Za-z0-9:_-]+$/.test(key) && typeof collapse[key] === "boolean"){
          bounded[key] = collapse[key];
        }
      });
    }
    var serialized = JSON.stringify(bounded);
    if(serialized.length <= WORK_READING_CONTEXT_MAX_CHARS){
      sessionStorage.setItem("fl-work-collapse", serialized);
    }
  } catch(_){}
}
/* Columns that mean live or upcoming work rather than pure terminal history. */
var WORK_LIVE_COLUMN_CODES = [
  "not-started",
  "ready",
  "running",
  "waiting-verification",
  "waiting-user-decision"
];
/* Pure: a lane body is terminal history when it has no live/upcoming cards. */
function workLaneIsTerminalHistory(columns){
  if(!columns) return true;
  for(var i = 0; i < WORK_LIVE_COLUMN_CODES.length; i++){
    if((columns[WORK_LIVE_COLUMN_CODES[i]] || []).length > 0) return false;
  }
  return true;
}
/* Pure: terminal Goal authority wins over stale child placement. Its summary
 * remains visible, while the historical body starts collapsed. */
function workGoalDefaultExpanded(goal){
  var st = goal && goal.status;
  if(st === "completed" || st === "stopped" || st === "failed") return false;
  var plans = (goal && goal.plans) || [];
  for(var i = 0; i < plans.length; i++){
    if(!workLaneIsTerminalHistory(plans[i] && plans[i].columns)) return true;
  }
  return true;
}
/* Pure: Plan opens only when it still has live or upcoming work. */
function workPlanDefaultExpanded(plan){
  return !workLaneIsTerminalHistory(plan && plan.columns);
}
/* Pure: one-off bulk opens only for work Main can act on immediately without a
 * prior decision: ready, running, or waiting for verification. Queued backlog,
 * decision backlog, and terminal history remain summarized behind disclosure. */
function workOneOffDefaultExpanded(lane){
  var columns = lane && lane.columns;
  if(!columns) return false;
  return (columns.ready || []).length > 0
    || (columns.running || []).length > 0
    || (columns["waiting-verification"] || []).length > 0;
}
/* Explicit tab-local preference wins; missing preference uses the smart default.
 * Distinguishes missing from false so a user collapse is never lost. */
function workLaneExpanded(collapse, kind, id, defaultExpanded){
  var key = kind + ":" + id;
  if(collapse && Object.prototype.hasOwnProperty.call(collapse, key)){
    return collapse[key] !== false;
  }
  return !!defaultExpanded;
}
function workLaneId(kind, id){
  return "fl-work-lane-" + kind + "-" + String(id || "x").replace(/[^A-Za-z0-9_-]/g, "_");
}
function workToggleLane(collapse, kind, id, btn, defaultExpanded){
  var key = kind + ":" + id;
  var next = !workLaneExpanded(collapse, kind, id, defaultExpanded);
  collapse[key] = next;
  workCollapseSave(collapse);
  btn.setAttribute("aria-expanded", next ? "true" : "false");
  var body = document.getElementById(workLaneId(kind, id));
  if(body){ body.hidden = !next; }
  return next;
}
function workGoalDecisionCount(goal){
  var count = 0;
  (goal.plans || []).forEach(function(plan){
    var col = plan.columns && plan.columns["waiting-user-decision"];
    count += col ? col.length : 0;
  });
  return count;
}
/* Presentation-only: partition by canonical Goal status. Never infer from
 * Task columns, progress, copy, or dates. */
function workGoalIsTerminalStatus(status){
  return status === "completed" || status === "stopped" || status === "failed";
}
/* FL-108C1: closed Core narrative codes → Hub i18n keys. Unknown codes are
 * intentionally absent so workNarrativeText fails closed. Never keyed by
 * English prose, regex, or sentence fragments. */
var WORK_NARRATIVE_I18N_KEYS = {
  "goal-what-completed": "workNarrGoalWhatCompleted",
  "goal-what-main-stop": "workNarrGoalWhatMainStop",
  "goal-what-correction-cap": "workNarrGoalWhatCorrectionCap",
  "goal-what-review-cap": "workNarrGoalWhatReviewCap",
  "goal-what-no-new-evidence-cap": "workNarrGoalWhatNoNewEvidenceCap",
  "goal-what-duration-exceeded": "workNarrGoalWhatDurationExceeded",
  "goal-what-no-progress": "workNarrGoalWhatNoProgress",
  "goal-what-milestone-failed": "workNarrGoalWhatMilestoneFailed",
  "goal-what-started": "workNarrGoalWhatStarted",
  "goal-what-milestone-satisfied": "workNarrGoalWhatMilestoneSatisfied",
  "goal-what-current": "workNarrGoalWhatCurrent",
  "goal-wait-admission-blocked": "workNarrGoalWaitAdmissionBlocked",
  "goal-wait-all-gates-satisfied": "workNarrGoalWaitAllGatesSatisfied",
  "goal-wait-nothing": "workNarrGoalWaitNothing",
  "goal-wait-machine": "workNarrGoalWaitMachine",
  "goal-wait-main-accept": "workNarrGoalWaitMainAccept",
  "goal-wait-integration": "workNarrGoalWaitIntegration",
  "goal-wait-task": "workNarrGoalWaitTask",
  "goal-wait-milestone-failed": "workNarrGoalWaitMilestoneFailed",
  "goal-wait-main-stop": "workNarrGoalWaitMainStop",
  "goal-wait-correction-cap": "workNarrGoalWaitCorrectionCap",
  "goal-wait-review-cap": "workNarrGoalWaitReviewCap",
  "goal-wait-no-new-evidence-cap": "workNarrGoalWaitNoNewEvidenceCap",
  "goal-wait-duration-exceeded": "workNarrGoalWaitDurationExceeded",
  "goal-wait-no-progress": "workNarrGoalWaitNoProgress",
  "goal-wait-progressing": "workNarrGoalWaitProgressing",
  "goal-next-wait-for-worker": "workNarrGoalNextWaitForWorker",
  "goal-next-main-accept": "workNarrGoalNextMainAccept",
  "goal-next-main-review": "workNarrGoalNextMainReview",
  "goal-next-integrate": "workNarrGoalNextIntegrate",
  "goal-next-correct-or-decide": "workNarrGoalNextCorrectOrDecide",
  "goal-next-advance": "workNarrGoalNextAdvance",
  "goal-next-stop-or-decide": "workNarrGoalNextStopOrDecide",
  "goal-next-resume-task": "workNarrGoalNextResumeTask",
  "goal-next-none": "workNarrGoalNextNone",
  "card-what-delivered": "workNarrCardWhatDelivered",
  "card-what-nothing": "workNarrCardWhatNothing",
  "card-what-goal-gate-complete": "workNarrCardWhatGoalGateComplete",
  "card-next-waiting-prerequisite": "workNarrCardNextWaitingPrerequisite",
  "card-next-not-started": "workNarrCardNextNotStarted",
  "card-next-ready": "workNarrCardNextReady",
  "card-next-running": "workNarrCardNextRunning",
  "card-next-waiting-verification": "workNarrCardNextWaitingVerification",
  "card-next-waiting-main-decision": "workNarrCardNextWaitingMainDecision",
  "card-next-no-further-action": "workNarrCardNextNoFurtherAction",
  "card-next-needs-recovery": "workNarrCardNextNeedsRecovery",
  "card-next-goal-gate-satisfied": "workNarrCardNextGoalGateSatisfied",
  "lane-what-none-completed": "workNarrLaneWhatNoneCompleted",
  "lane-what-completed-names": "workNarrLaneWhatCompletedNames",
  "lane-what-completed-count": "workNarrLaneWhatCompletedCount",
  "lane-blocker-blocked": "workNarrLaneBlockerBlocked",
  "lane-blocker-waiting": "workNarrLaneBlockerWaiting",
  "lane-blocker-none": "workNarrLaneBlockerNone",
  "lane-next-no-step": "workNarrLaneNextNoStep"
};
/* Empty/non-fact blocker codes: never surface as a "Blocked" fact. */
var WORK_NARRATIVE_EMPTY_BLOCKER_CODES = {
  "lane-blocker-none": true,
  "goal-wait-all-gates-satisfied": true,
  "goal-wait-nothing": true
};
/* Bound and type-check narrative params before interpolation.
 * Mirrors Core narrativeMessage limits: at most 8 own keys, strings sliced
 * to 200 chars, safe nonnegative integers <= 1_000_000. Invalid or excess
 * values are omitted without throwing. */
function workSafeNarrativeParams(params){
  var out = {};
  if(!params || typeof params !== "object") return out;
  var keys = Object.keys(params);
  var count = 0;
  for(var i = 0; i < keys.length; i++){
    if(count >= 8) break;
    var k = keys[i];
    var v = params[k];
    if(typeof v === "string"){
      var sliced = v.slice(0, 200);
      if(sliced.length === 0) continue;
      out[k] = sliced;
      count += 1;
    } else if(
      typeof v === "number"
      && typeof Number.isSafeInteger === "function"
      && Number.isSafeInteger(v)
      && v >= 0
      && v <= 1000000
    ){
      out[k] = v;
      count += 1;
    }
    // Omit floats, negatives, oversize ints, NaN, objects, arrays, booleans.
  }
  return out;
}
/* One code-driven bilingual renderer. Known code → locale copy; absent
 * message → legacy compatibility string; unrecognized code → neutral
 * unavailable copy (never raw code, never guessed success). */
function workNarrativeText(msg, legacyFallback){
  if(!msg || typeof msg !== "object" || typeof msg.code !== "string" || !msg.code){
    if(legacyFallback === undefined || legacyFallback === null) return "";
    var legacy = String(legacyFallback).trim();
    return legacy;
  }
  var key = WORK_NARRATIVE_I18N_KEYS[msg.code];
  if(!key) return t("workNarrUnavailable");
  var params = workSafeNarrativeParams(msg.params);
  // Completed-name aggregation needs an optional extra-count template.
  if(msg.code === "lane-what-completed-names"){
    if(params.extraCount !== undefined && Number(params.extraCount) > 0){
      return t("workNarrLaneWhatCompletedNamesExtra", {
        names: params.names || "",
        extraCount: String(params.extraCount)
      });
    }
    return t("workNarrLaneWhatCompletedNames", { names: params.names || "" });
  }
  // Goal-gate satisfied next action: choose by gate / delivery basis.
  if(msg.code === "card-next-goal-gate-satisfied"){
    var gate = String(params.gate || "");
    var basis = String(params.deliveryBasis || "");
    if(gate === "machine") return t("workNarrCardNextGateMachine");
    if(gate === "main-accept") return t("workNarrCardNextGateMainAccept");
    if(gate === "integration"){
      if(basis === "amended-acceptance") return t("workNarrCardNextGateIntegrationAmended");
      if(basis === "original-acceptance") return t("workNarrCardNextGateIntegrationOriginal");
      return t("workNarrCardNextGateIntegration");
    }
    return t("workNarrCardNextGoalGateSatisfied", { gate: gate || t("workNarrGateUnknown") });
  }
  // Coerce number params to strings for i18n placeholders.
  var vars = {};
  Object.keys(params).forEach(function(k){ vars[k] = String(params[k]); });
  return t(key, vars);
}
/* Presentation-only: Core's explicit empty-blocker fallback is not a fact.
 * Prefer coded blockerMessage when present; never parse arbitrary prose.
 * Unrecognized future codes stay displayable so workNarrativeText can fail
 * closed to localized unavailable copy (never hide, never show raw code). */
function workLaneHasRealBlocker(blocker, blockerMessage){
  if(blockerMessage && typeof blockerMessage === "object"
    && typeof blockerMessage.code === "string" && blockerMessage.code){
    if(WORK_NARRATIVE_EMPTY_BLOCKER_CODES[blockerMessage.code]) return false;
    // Known real blockers and unrecognized non-empty codes are both displayable.
    return true;
  }
  if(blocker === undefined || blocker === null) return false;
  var text = String(blocker).trim();
  if(!text) return false;
  // Exact Core deriveLaneSummary empty fallback only - not arbitrary English.
  if(text === "No current blocker.") return false;
  return true;
}
/* Presentation-only next-action label. Prefers coded messages; completed
 * Goals with no decision get a calm conclusion. Never matches English prose. */
function workLaneNextActionText(summary, opts){
  opts = opts || {};
  var msg = summary && summary.nextActionMessage;
  if(msg && typeof msg === "object" && typeof msg.code === "string" && msg.code){
    if(opts.completedNoDecision){
      if(msg.code === "goal-next-none" || msg.code === "lane-next-no-step"
        || msg.code === "card-next-no-further-action" || msg.code === "goal-what-completed"){
        return t("workNoFurtherAction");
      }
    }
    return workNarrativeText(msg, summary && summary.nextAction);
  }
  var next = summary && summary.nextAction ? String(summary.nextAction).trim() : "";
  var happened = summary && summary.whatCompleted ? String(summary.whatCompleted).trim() : "";
  if(opts.completedNoDecision){
    if(!next || (happened && next === happened)) return t("workNoFurtherAction");
  }
  return next || t("workNoNext");
}
/* Shared Goal/Plan lane narration: code-driven when present, legacy fallback
 * otherwise. Real blockers only; never mutates summary fields. */
function appendWorkLaneNarrative(facts, summary, opts){
  opts = opts || {};
  var what = workNarrativeText(
    summary && summary.whatCompletedMessage,
    (summary && summary.whatCompleted) || t("workNoneYet")
  );
  if(!what) what = t("workNoneYet");
  facts.appendChild(h("span", "work-lane-fact", t("workGoalOutcome", { text: what })));
  var blocker = summary && summary.blocker;
  var showBlocker = workLaneHasRealBlocker(blocker, summary && summary.blockerMessage);
  // Completed Goals with no required decision: do not surface waiting-as-blocker.
  if(opts.completedNoDecision) showBlocker = false;
  if(showBlocker){
    var blockerText = workNarrativeText(summary && summary.blockerMessage, blocker);
    facts.appendChild(h("span", "work-lane-fact", t("workGoalBlocker", { text: blockerText })));
  }
  facts.appendChild(h("span", "work-lane-fact", t("workGoalNext", {
    text: workLaneNextActionText(summary, opts)
  })));
}
/* Terminal Goals share one counted, collapsed, lazy disclosure so history
 * stays reachable without dominating the first paint. History is a portfolio
 * list only; selecting an entry opens its one focused workspace. */
function renderWorkFinishedGoals(goals){
  var details = document.createElement("details");
  details.className = "work-finished-group";
  details.setAttribute("data-fl-role", "work-finished-group");
  var summary = document.createElement("summary");
  summary.className = "work-finished-summary";
  summary.setAttribute("data-fl-role", "work-finished-toggle");
  summary.textContent = t("workFinishedWorkCount", { count: String(goals.length) });
  details.appendChild(summary);
  var body = h("div", "work-finished-body");
  body.setAttribute("data-fl-role", "work-finished-body");
  var filled = false;
  /* Single production materializer: user toggle and FL-112A restore both use
   * this path so nested Goal/Plan/Task nodes exist before focus returns. */
  function ensureFinishedBody(){
    if(filled) return;
    filled = true;
    goals.forEach(function(goal){
      body.appendChild(renderWorkHistoryOption(goal));
    });
  }
  details.addEventListener("toggle", function(){
    if(details.open) ensureFinishedBody();
  });
  /* Continuity restore calls the same ensure the toggle path uses. */
  details._workEnsureFinishedBody = ensureFinishedBody;
  details.appendChild(body);
  return details;
}
function workGoalTaskCount(goal){
  var count = 0;
  (goal && goal.plans || []).forEach(function(plan){ count += workColumnsCardCount(plan && plan.columns); });
  return count;
}
function workPlanTaskCount(plan){
  return workColumnsCardCount(plan && plan.columns);
}
function workGoalNeedsAttention(goal){
  var summary = goal && goal.summary;
  return workGoalDecisionCount(goal) > 0
    || workLaneHasRealBlocker(summary && summary.blocker, summary && summary.blockerMessage);
}
function workPortfolioCue(summary, opts){
  opts = opts || {};
  if(!summary) return t("workNoNext");
  if(opts.completedNoDecision) return t("workNoFurtherAction");
  var next = workLaneNextActionText(summary, opts);
  return next || t("workNoNext");
}
function renderWorkHistoryOption(goal){
  var button = h("button", "work-history-option");
  button.type = "button";
  button.setAttribute("data-fl-role", "work-workspace-option");
  button.setAttribute("data-workspace-kind", "goal");
  button.setAttribute("data-workspace-id", String(goal.goalId || ""));
  var selected = workSelectionEqual(S.workSelection, workMakeSelection("goal", goal.goalId));
  button.setAttribute("aria-pressed", selected ? "true" : "false");
  if(selected) button.setAttribute("aria-current", "true");
  button.addEventListener("click", function(){ workSelectWorkspace("goal", goal.goalId); });
  var head = h("span", "work-history-option-head");
  head.appendChild(h("span", "work-history-option-name", goal.name || t("workUntitledGoal")));
  if(goal.status) head.appendChild(badge(goal.status));
  button.appendChild(head);
  var summary = goal.summary || {};
  button.appendChild(h("span", "work-history-option-cue", workPortfolioCue(summary, {
    completedNoDecision: goal.status === "completed" && workGoalDecisionCount(goal) === 0
  })));
  button.appendChild(h("span", "work-history-option-meta", t("workPortfolioTaskCount", {
    count: String(workGoalTaskCount(goal))
  })));
  return button;
}
function workOneOffCardCount(view){
  var count = 0;
  if(!view.oneOffTasks) return count;
  WORK_COLUMN_CODES.forEach(function(code){
    count += ((view.oneOffTasks.columns && view.oneOffTasks.columns[code]) || []).length;
  });
  return count;
}
function workColumnsCardCount(columns){
  var count = 0;
  WORK_COLUMN_CODES.forEach(function(code){
    count += ((columns && columns[code]) || []).length;
  });
  return count;
}
/* ---------------------------------------------------------------------------
 * FL-109C2A: truthful drag + keyboard action handoff.
 *
 * One small interaction controller consumes only the immutable per-card
 * actionPolicy (Core-owned, schemaVersion 1) and coordinates four things:
 *   - pointer drag affordance and seven-column drop feedback;
 *   - a keyboard-first Move/Act chooser that keeps every destination
 *     focusable and explanatory;
 *   - focus return and a bounded pending-action handoff;
 *   - opening the existing Task Detail drawer on the Actions tab with the
 *     exact intent visible.
 *
 * Boundaries: it never changes local status, never reparents a card, and
 * never calls a mutation endpoint. Existing Task Action controls remain the
 * only way a durable operation is later submitted (FL-109C2B).
 * ------------------------------------------------------------------------ */
var workDrag = null;
var workDragSuppressClick = false;
/* The open chooser's origin is tracked by taskId so a poll re-render can find
 * the replacement Move/Act control and keep aria state + focus return intact. */
var workChooserTaskId = null;
var workChooserBtn = null;

/* Pure: a card is pointer-draggable only when its Core policy names at least
 * one requestable or needs-input destination. Never infers eligibility from
 * the browser-visible status or column. */
function workCardIsActionable(card){
  var policy = card && card.actionPolicy;
  var dests = policy && policy.destinations;
  if(!dests) return false;
  for(var i = 0; i < WORK_COLUMN_CODES.length; i++){
    var entry = dests[WORK_COLUMN_CODES[i]];
    if(entry && (entry.disposition === "requestable" || entry.disposition === "needs-input")) return true;
  }
  return false;
}
/* Pure: a card exposes the keyboard/touch chooser whenever it carries a
 * versioned Core actionPolicy, even when every destination is a no-op or
 * automatic-only. Pointer drag stays limited to actionable cards. */
function workCardHasPolicy(card){
  var policy = card && card.actionPolicy;
  return !!(policy && policy.schemaVersion === 1
    && policy.destinations && typeof policy.destinations === "object");
}
/* Pure: drop/chooser mode for one destination policy entry. */
function workDestinationMode(entry){
  if(!entry || typeof entry !== "object") return "invalid";
  if(entry.disposition === "requestable" || entry.disposition === "needs-input") return "valid";
  if(entry.disposition === "automatic-only") return "auto";
  return "invalid";
}
/* Bounded reason-code translation. Empty means "use the Core explanation". */
function workReasonLabel(reason){
  var keys = {
    "already-there": "workReasonAlreadyThere",
    "already-delivered": "workReasonAlreadyDelivered",
    "delivered-backward-blocked": "workReasonDeliveredBackwardBlocked",
    "dependency-held": "workReasonDependencyHeld",
    "automatic-progression": "workReasonAutomaticProgression",
    "no-operation": "workReasonNoOperation",
    "requires-reopen-first": "workReasonRequiresReopenFirst",
    "requires-main-accept": "workReasonRequiresMainAccept",
    "requires-verification": "workReasonRequiresVerification",
    "requires-reason-confirm": "workReasonRequiresReasonConfirm",
    "requires-feedback": "workReasonRequiresFeedback",
    "requires-preflight-then-apply": "workReasonRequiresPreflightThenApply",
    "requires-receipt-confirm": "workReasonRequiresReceiptConfirm",
    "resume-returns-to-ready": "workReasonResumeReturnsToReady",
    "correct-reuses-candidate": "workReasonCorrectReusesCandidate",
    "reopen-returns-now": "workReasonReopenReturnsNow",
    "resolve-closes-failure": "workReasonResolveClosesFailure",
    "allowance-exhausted": "workReasonAllowanceExhausted",
    "already-past": "workReasonAlreadyPast",
    "not-eligible": "workReasonNotEligible",
    "unknown-evidence": "workReasonUnknownEvidence"
  };
  var key = keys[reason];
  return key ? t(key) : "";
}
function workOperationLabel(op){
  var keys = {
    resume: "workOpResume",
    correct: "workOpCorrect",
    revise: "workOpRevise",
    main_review: "workOpMainReview",
    integration_preflight: "workOpIntegrationPreflight",
    integration_apply: "workOpIntegrationApply",
    task_resolve: "workOpTaskResolve",
    task_reopen: "workOpTaskReopen"
  };
  var key = keys[op];
  return key ? t(key) : (op || "");
}
function workIntentLabel(intent){
  var keys = { accept: "workIntentAccept", revise: "workIntentRevise", reject: "workIntentReject" };
  var key = keys[intent];
  return key ? t(key) : (intent || "");
}
function workDispositionLabel(entry){
  if(!entry || !entry.disposition) return "";
  var keys = {
    requestable: "workDispositionRequestable",
    "needs-input": "workDispositionNeedsInput",
    "automatic-only": "workDispositionAutomatic",
    "no-op": "workDispositionNoop"
  };
  var key = keys[entry.disposition];
  return key ? t(key) : entry.disposition;
}
function workRequiresLabel(fields){
  var labels = {
    feedback: "workReqFeedback",
    confirm: "workReqConfirm",
    reason: "workReqReason",
    receiptId: "workReqReceiptId",
    evidence: "workReqEvidence",
    note: "workReqNote"
  };
  return (fields || []).map(function(f){
    var key = labels[f];
    return key ? t(key) : String(f);
  }).join(", ") || "-";
}
function workPathLabel(path){
  return (path || []).map(function(step){
    return workOperationLabel(step && step.operation)
      + (step && step.requires && step.requires.length
        ? " (" + workRequiresLabel(step.requires) + ")" : "");
  }).join(" → ");
}
/* Full bilingual explanation for one destination. Reason-code translations are
 * primary; the Core explanation string is the authoritative fallback. */
function workDestinationExplanation(code, entry){
  if(!entry || typeof entry !== "object"){
    return t("workReasonUnknownEvidence");
  }
  if(entry.disposition === "requestable" || entry.disposition === "needs-input"){
    var parts = [];
    parts.push(t("workDestActionable", {
      operation: workOperationLabel(entry.operation),
      column: workColumnLabel(code)
    }));
    if(entry.intent) parts.push(t("workDestIntent", { intent: workIntentLabel(entry.intent) }));
    if(entry.requires && entry.requires.length){
      parts.push(t("workDestRequires", { fields: workRequiresLabel(entry.requires) }));
    }
    if(entry.path && entry.path.length){
      parts.push(t("workDestPath", { path: workPathLabel(entry.path) }));
    }
    var reason = workReasonLabel(entry.reason);
    parts.push(reason ? reason : entry.explanation);
    return parts.join(" ");
  }
  var r = workReasonLabel(entry.reason);
  if(r) return r;
  return entry.explanation;
}
/* Compact one-line summary for a chooser row. */
function workDestinationSummary(code, entry){
  if(!entry || typeof entry !== "object") return t("workReasonUnknownEvidence");
  if(entry.disposition === "requestable" || entry.disposition === "needs-input"){
    var parts = [t("workDestActionableShort", {
      operation: workOperationLabel(entry.operation),
      column: workColumnLabel(code)
    })];
    if(entry.requires && entry.requires.length){
      parts.push(t("workDestRequiresShort", { fields: workRequiresLabel(entry.requires) }));
    }
    var r = workReasonLabel(entry.reason);
    if(r) parts.push(r);
    return parts.join(" · ");
  }
  var rr = workReasonLabel(entry.reason);
  return rr ? rr : entry.explanation;
}
function workAnnounce(text){
  toast(text);
  var live = document.getElementById("fl-work-announce");
  if(live) live.textContent = text || "";
}
/* Open the existing Task Detail drawer on Actions with a bounded handoff.
 * Presentation only: no status patch, no reparent, no mutation endpoint. */
function workOpenActionsHandoff(payload){
  workActionChooserClose(null);
  S.pendingActionHandoff = {
    taskId: payload.taskId,
    taskName: payload.taskName,
    column: payload.column,
    entry: payload.entry
  };
  taskDetailActiveTab = "actions";
  showTask(payload.taskId, payload.breadcrumb);
}
function workClearDropHighlights(board){
  if(!board) return;
  var cells = board.querySelectorAll(".work-cell");
  for(var i = 0; i < cells.length; i++){
    cells[i].classList.remove("work-cell-drop-valid", "work-cell-drop-auto", "work-cell-drop-invalid");
    cells[i].removeAttribute("aria-dropeffect");
  }
}
function workCardDragStart(card, el, e){
  if(!workCardIsActionable(card)){ e.preventDefault(); return; }
  workDrag = {
    taskId: card.taskId,
    taskName: card.name,
    breadcrumb: card.breadcrumb,
    policy: (card.actionPolicy && card.actionPolicy.destinations) || {},
    sourceColumn: card.column
  };
  el.classList.add("work-card-dragging");
  el.setAttribute("aria-grabbed", "true");
  if(e.dataTransfer){
    /* copy intent, never move the canonical card in the DOM */
    e.dataTransfer.effectAllowed = "copy";
    try { e.dataTransfer.setData("text/plain", String(card.taskId || "")); } catch(_){}
  }
}
function workCardDragEnd(el){
  if(el){
    el.classList.remove("work-card-dragging");
    el.setAttribute("aria-grabbed", "false");
  }
  workDrag = null;
  workDragSuppressClick = true;
  var boardEl = document.querySelector(".work-board");
  if(boardEl) workClearDropHighlights(boardEl);
  setTimeout(function(){ workDragSuppressClick = false; }, 0);
}
function workBoardDragOver(e){
  if(!workDrag) return;
  var cell = e.target && e.target.closest ? e.target.closest(".work-cell") : null;
  if(!cell){ workClearDropHighlights(e.currentTarget); return; }
  e.preventDefault();
  var code = cell.getAttribute("data-column");
  var entry = workDrag.policy && workDrag.policy[code];
  var mode = workDestinationMode(entry);
  workClearDropHighlights(e.currentTarget);
  if(e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  cell.classList.add(mode === "valid"
    ? "work-cell-drop-valid"
    : (mode === "auto" ? "work-cell-drop-auto" : "work-cell-drop-invalid"));
  cell.setAttribute("aria-dropeffect", mode === "valid" ? "copy" : "none");
}
function workBoardDrop(e){
  if(!workDrag) return;
  var cell = e.target && e.target.closest ? e.target.closest(".work-cell") : null;
  e.preventDefault();
  workClearDropHighlights(e.currentTarget);
  var drag = workDrag;
  workDrag = null;
  workDragSuppressClick = true;
  setTimeout(function(){ workDragSuppressClick = false; }, 0);
  if(!cell || !drag) return;
  var code = cell.getAttribute("data-column");
  var entry = drag.policy && drag.policy[code];
  if(!entry) return;
  if(entry.disposition === "requestable" || entry.disposition === "needs-input"){
    workOpenActionsHandoff({
      taskId: drag.taskId,
      taskName: drag.taskName,
      breadcrumb: drag.breadcrumb,
      column: code,
      entry: entry
    });
  } else {
    /* invalid or automatic-only: explain, never hand off, card stays put */
    workAnnounce(workDestinationSummary(code, entry));
  }
}
/* Distinct keyboard/touch Move/Act control on an actionable card. */
function renderWorkMoveActControl(card){
  var row = h("div", "work-action-row");
  row.setAttribute("data-fl-role", "work-action-move");
  var btn = h("button", "work-action-btn");
  btn.type = "button";
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-label", t("workActionOpenAria"));
  btn.textContent = t("workActionOpen");
  btn.addEventListener("click", function(e){
    e.stopPropagation();
    workActionChooserToggle(card, btn);
  });
  btn.addEventListener("keydown", function(e){ e.stopPropagation(); });
  row.appendChild(btn);
  return row;
}
function workActionChooserToggle(card, btn){
  var existing = document.getElementById("fl-work-action-chooser");
  if(existing){
    /* Same Task toggles closed; a different Task replaces the chooser. */
    if(workChooserTaskId === String(card.taskId)){
      workActionChooserClose(btn);
    } else {
      workActionChooserClose(null);
      workOpenChooserForCard(card, btn);
    }
    return;
  }
  workOpenChooserForCard(card, btn);
}
function workOpenChooserForCard(card, btn){
  var panel = h("div", "work-action-chooser");
  panel.id = "fl-work-action-chooser";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", t("workActionChooserTitle"));
  panel.setAttribute("data-fl-role", "work-action-chooser");

  panel.appendChild(h("div", "work-action-chooser-head", t("workActionChooserTitle")));
  panel.appendChild(h("div", "work-action-chooser-task", card.name || t("taskUntitled")));

  var list = h("div", "work-action-chooser-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("workActionChooserDestinations"));
  list.id = "fl-work-action-chooser-list";

  var items = [];
  WORK_COLUMN_CODES.forEach(function(code){
    var entry = (card.actionPolicy && card.actionPolicy.destinations && card.actionPolicy.destinations[code]) || null;
    var item = workActionChooserItem(card, btn, code, entry);
    list.appendChild(item);
    items.push(item);
  });
  panel.appendChild(list);

  var hint = h("div", "work-action-chooser-hint", t("workActionChooserHint"));
  hint.id = "fl-work-action-chooser-hint";
  hint.setAttribute("aria-live", "polite");
  panel.appendChild(hint);

  var closeBtn = h("button", "btn sm work-action-chooser-close", t("workActionChooserClose"));
  closeBtn.type = "button";
  closeBtn.setAttribute("data-fl-role", "work-action-chooser-close");
  closeBtn.addEventListener("click", function(){ workActionChooserClose(btn); });
  panel.appendChild(closeBtn);

  document.body.appendChild(panel);
  workChooserTaskId = String(card.taskId);
  workChooserBtn = btn;
  btn.setAttribute("aria-expanded", "true");
  btn.classList.add("is-open");

  var focusables = items.concat([closeBtn]);
  function nextFocus(dir){
    var idx = focusables.indexOf(document.activeElement);
    var next = focusables[(idx + dir + focusables.length) % focusables.length];
    next.focus();
  }
  panel.addEventListener("keydown", function(e){
    if(e.key === "Escape"){ e.preventDefault(); workActionChooserClose(btn); return; }
    if(e.key === "Tab"){ e.preventDefault(); nextFocus(e.shiftKey ? -1 : 1); return; }
    if(e.key === "ArrowDown" || e.key === "ArrowRight"){ e.preventDefault(); nextFocus(1); return; }
    if(e.key === "ArrowUp" || e.key === "ArrowLeft"){ e.preventDefault(); nextFocus(-1); return; }
  });

  var first = null;
  for(var i = 0; i < items.length; i++){
    if(items[i]._actionable){ first = items[i]; break; }
  }
  (first || items[0] || closeBtn).focus();
}
/* Find the current Move/Act control for a task id after a re-render. */
function workActionFindOriginBtn(taskId){
  if(!taskId) return null;
  var btns = document.querySelectorAll(".work-action-btn");
  for(var i = 0; i < btns.length; i++){
    var cardEl = btns[i].closest ? btns[i].closest(".work-card") : null;
    if(cardEl && cardEl.getAttribute("data-task-id") === String(taskId)) return btns[i];
  }
  return null;
}
/* Close the chooser and restore focus to the origin control, falling back to
 * the replacement control when polling re-rendered the board. */
function workActionChooserClose(btn){
  var panel = document.getElementById("fl-work-action-chooser");
  if(panel) panel.remove();
  var taskId = workChooserTaskId;
  workChooserTaskId = null;
  var origin = btn || workChooserBtn;
  workChooserBtn = null;
  if(!origin || !document.contains(origin)){
    origin = workActionFindOriginBtn(taskId);
  }
  if(origin){
    origin.setAttribute("aria-expanded", "false");
    origin.classList.remove("is-open");
    if(document.contains(origin) && typeof origin.focus === "function") origin.focus();
  }
}
/* Close the chooser with no focus side effects (page/language changes). */
function workActionChooserReset(){
  workActionChooserClose(null);
}
/* After a Work re-render, keep the open chooser truthful: mark the replacement
 * control as open, or close safely when the origin card is gone. */
function workActionRebindChooser(){
  if(!workChooserTaskId) return;
  var panel = document.getElementById("fl-work-action-chooser");
  var origin = workActionFindOriginBtn(workChooserTaskId);
  if(origin){
    workChooserBtn = origin;
    if(panel){
      origin.setAttribute("aria-expanded", "true");
      origin.classList.add("is-open");
    } else {
      workChooserTaskId = null;
      workChooserBtn = null;
    }
  } else if(panel){
    panel.remove();
    workChooserTaskId = null;
    workChooserBtn = null;
  }
}
function workActionChooserItem(card, btn, code, entry){
  var actionable = !!(entry && (entry.disposition === "requestable" || entry.disposition === "needs-input"));
  var mode = workDestinationMode(entry);
  var row = h("button", "work-action-dest is-explain-" + (mode === "valid" ? "actionable" : (mode === "auto" ? "auto" : "invalid")));
  if(actionable) row.classList.add("is-actionable");
  row.type = "button";
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", "false");
  row.setAttribute("data-fl-role", "work-action-dest");
  row.setAttribute("data-column", code);
  row._actionable = actionable;

  var headEl = h("div", "work-action-dest-head");
  headEl.appendChild(h("span", "work-action-dest-name", workColumnLabel(code)));
  var badgeClass = actionable ? "badge-ok" : (mode === "auto" ? "badge-info" : "badge-dim");
  headEl.appendChild(h("span", "badge " + badgeClass, workDispositionLabel(entry)));
  row.appendChild(headEl);
  row.appendChild(h("div", "work-action-dest-text", workDestinationSummary(code, entry)));
  if(actionable){
    row.appendChild(h("div", "work-action-dest-act", t("workActionPickValid")));
  }

  row.addEventListener("click", function(){
    if(actionable){
      workActionChooserClose(btn);
      workOpenActionsHandoff({
        taskId: card.taskId,
        taskName: card.name,
        breadcrumb: card.breadcrumb,
        column: code,
        entry: entry
      });
    } else {
      var hint = document.getElementById("fl-work-action-chooser-hint");
      var text = workDestinationExplanation(code, entry);
      if(hint) hint.textContent = text;
      workAnnounce(text);
    }
  });
  return row;
}
function workColumnTone(code){
  if(code === "running" || code === "waiting-verification") return "active";
  if(code === "waiting-user-decision") return "attention";
  if(code === "completed") return "done";
  if(code === "stopped-failed") return "failed";
  return "queued";
}
/* A new board should lead with work that can inform the next decision. The
 * array changes neither Core order nor card placement; it only chooses the
 * first contained horizontal viewport for a genuinely new selection. */
var WORK_RELEVANT_COLUMN_PRIORITY = [
  "waiting-user-decision",
  "stopped-failed",
  "waiting-verification",
  "running",
  "completed",
  "ready",
  "not-started"
];
function workRelevantColumnCode(columns){
  for(var i = 0; i < WORK_RELEVANT_COLUMN_PRIORITY.length; i++){
    var code = WORK_RELEVANT_COLUMN_PRIORITY[i];
    if(columns && ((Array.isArray(columns[code]) && columns[code].length)
      || (typeof columns[code] === "number" && columns[code] > 0))) return code;
  }
  return null;
}
function workFocusRelevantColumn(){
  if(!viewEl) return false;
  try {
    var board = viewEl.querySelector('[data-fl-role="work-board"]');
    if(!board) return false;
    var head = board.querySelector('[data-fl-role="work-col-head"]');
    if(!head) return false;
    var counts = {};
    var cells = head.querySelectorAll('[data-column]');
    for(var i = 0; i < cells.length; i++){
      var code = cells[i].getAttribute("data-column");
      var count = Number(cells[i].getAttribute("data-card-count"));
      if(code && Number.isFinite(count) && count > 0) counts[code] = count;
    }
    var targetCode = workRelevantColumnCode(counts);
    if(!targetCode) return false;
    var target = head.querySelector('[data-column="' + targetCode + '"]');
    if(!target) return false;
    var left = typeof target.offsetLeft === "number" ? target.offsetLeft : 0;
    board.scrollLeft = Math.max(0, left - 8);
    return true;
  } catch(_){
    return false;
  }
}
function workMaybeFocusRelevantColumn(){
  if(!workBoardFocusRequest) return;
  var request = workBoardFocusRequest;
  workBoardFocusRequest = null;
  if(workReloadBoardScrollRestored){
    workReloadBoardScrollRestored = false;
    return;
  }
  if(request.key && request.key !== workSelectionKey(S.workSelection)) return;
  if(workFocusRelevantColumn()) workScheduleReadingContextSave();
}
function workCardStateClass(code){
  if(code === "waiting-user-decision") return "is-attention";
  if(code === "stopped-failed") return "is-failed";
  return "";
}
function workMarkSelectedCard(taskId){
  if(!viewEl || !viewEl.querySelectorAll) return;
  try {
    var cards = viewEl.querySelectorAll('[data-fl-role="work-card"]');
    for(var i = 0; i < cards.length; i++){
      var selected = !!taskId && cards[i].getAttribute("data-task-id") === String(taskId);
      cards[i].classList.toggle("is-selected", selected);
      if(selected) cards[i].setAttribute("aria-current", "true");
      else cards[i].removeAttribute("aria-current");
    }
  } catch(_){ }
}
/* Cards are the scan surface. Keep one truthful line below the state badge;
 * dependencies, Worker identity, and unlock edges remain in Task Detail. */
function workCardPrimaryLine(card){
  var blockers = (card && card.blockers) || [];
  for(var i = 0; i < blockers.length; i++){
    var blockerLabel = workSafeCardBlockerLabel(card, blockers[i]);
    if(blockerLabel) return t("workCardBlocker", { text: blockerLabel });
  }
  var next = workNarrativeText(card && card.nextActionMessage,
    card && card.nextAction || t("workNoNext"));
  return next || t("workNoNext");
}
function renderWorkCard(card){
  var el = h("div", "work-card");
  el.setAttribute("data-fl-role", "work-card");
  el.setAttribute("data-task-id", card.taskId || "");
  el.setAttribute("data-column", card.column || "");
  el.setAttribute("tabindex", "0");
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", card.name || t("taskUntitled"));
  var stateClass = workCardStateClass(card.column);
  if(stateClass) el.classList.add(stateClass);
  if(S.detailTaskId && String(S.detailTaskId) === String(card.taskId || "")){
    el.classList.add("is-selected");
    el.setAttribute("aria-current", "true");
  }

  /* Pointer drag is offered only when the Core policy names a requestable or
   * needs-input destination. The card stays in its canonical column; drag only
   * copies intent (effectAllowed "copy"), never moves the node. */
  var hasPolicy = workCardHasPolicy(card);
  var actionable = workCardIsActionable(card);
  if(actionable){
    el.classList.add("is-actionable");
    el.setAttribute("draggable", "true");
    el.setAttribute("aria-grabbed", "false");
    el.addEventListener("dragstart", function(e){ workCardDragStart(card, el, e); });
    el.addEventListener("dragend", function(){ workCardDragEnd(el); });
  }

  /* Normal card activation still opens Task Detail. The distinct Move/Act
   * control stops propagation so the two behaviors never conflict; a drag
   * also suppresses the click that would otherwise follow dragend. */
  el.addEventListener("click", function(){
    if(workDragSuppressClick) return;
    showTask(card.taskId, card.breadcrumb);
  });
  el.addEventListener("keydown", function(e){
    if(e.target !== el) return;
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); showTask(card.taskId, card.breadcrumb); }
  });

  var cardHead = h("div", "work-card-head");
  cardHead.appendChild(h("div", "work-card-name", card.name || t("taskUntitled")));
  cardHead.appendChild(h("span", "work-card-status tone-" + workColumnTone(card.column),
    workColumnLabel(card.column)));
  el.appendChild(cardHead);
  el.appendChild(h("div", "work-card-next", workCardPrimaryLine(card)));
  if(hasPolicy) el.appendChild(renderWorkMoveActControl(card));
  return el;
}
function workSafeCardBlockerLabel(card, blocker){
  if(!blocker || !blocker.label) return "";
  var label = String(blocker.label);
  var edges = card && card.namedDependencies || [];
  for(var i = 0; i < edges.length; i++){
    var edge = edges[i];
    if(!edge) continue;
    if(edge.itemId === label || edge.taskId === label){
      return edge.taskName || "";
    }
  }
  return label;
}
function workColumnCodesWithCards(columns, requestedCodes){
  var codes = Array.isArray(requestedCodes) && requestedCodes.length
    ? requestedCodes : WORK_COLUMN_CODES;
  return codes.filter(function(code){
    return ((columns && columns[code]) || []).length > 0;
  });
}
function workRenderColumnCell(columns, code, emptyRail){
  var cards = (columns && columns[code]) || [];
  var cell = h("div", "work-cell tone-" + workColumnTone(code)
    + (cards.length === 0 ? " is-empty" : "")
    + (emptyRail ? " work-empty-state" : ""));
  cell.setAttribute("data-column", code);
  cell.setAttribute("data-card-count", String(cards.length));
  cell.setAttribute("role", "group");
  cell.setAttribute("aria-label", workColumnLabel(code));
  var cellHead = h("div", "work-cell-head");
  cellHead.appendChild(h("span", "work-cell-title", workColumnLabel(code)));
  cellHead.appendChild(h("span", "work-cell-count", String(cards.length)));
  cell.appendChild(cellHead);
  var list = h("div", "work-cell-cards");
  list.setAttribute("data-fl-role", "work-cell-cards");
  list.setAttribute("data-column", code);
  if(cards.length === 0){
    var empty = h("div", "work-cell-empty", t("workColumnEmpty"));
    empty.setAttribute("data-empty-for", code);
    list.appendChild(empty);
  } else {
    cards.forEach(function(card){ list.appendChild(renderWorkCard(card)); });
  }
  cell.appendChild(list);
  return cell;
}
/* Active states get the available width. Empty states remain real drop targets
 * in a compact labeled rail, so a sparse phase never looks like seven blank
 * cards and no canonical state disappears. */
function renderWorkColumns(columns, requestedCodes){
  var codes = Array.isArray(requestedCodes) && requestedCodes.length
    ? requestedCodes : WORK_COLUMN_CODES;
  var activeCodes = workColumnCodesWithCards(columns, codes);
  var emptyCodes = codes.filter(function(code){ return activeCodes.indexOf(code) < 0; });
  var wrap = h("div", "work-column-set");
  wrap.setAttribute("data-fl-role", "work-column-set");
  wrap.setAttribute("data-column-total", String(codes.length));
  wrap.setAttribute("data-column-active", String(activeCodes.length));
  if(activeCodes.length){
    var grid = h("div", "work-col-grid work-lane-row");
    grid.setAttribute("data-fl-role", "work-lane-row");
    grid.setAttribute("data-column-count", String(activeCodes.length));
    activeCodes.forEach(function(code){
      grid.appendChild(workRenderColumnCell(columns, code, false));
    });
    wrap.appendChild(grid);
  }
  if(emptyCodes.length){
    var rail = h("div", "work-empty-state-rail");
    rail.setAttribute("data-fl-role", "work-empty-state-rail");
    rail.setAttribute("aria-label", t("workEmptyStateRail", { count: String(emptyCodes.length) }));
    emptyCodes.forEach(function(code){
      rail.appendChild(workRenderColumnCell(columns, code, true));
    });
    wrap.appendChild(rail);
  }
  return wrap;
}

/* ---------------------------------------------------------------------------
 * FL-112B focused workspaces
 *
 * The portfolio rail is navigation and summary. Only the selected canonical
 * Goal, independent Plan, or one-off inbox receives a Task board. Goal and
 * Plan ancestry is therefore visible without repeating the same sparse board
 * several times down the page.
 * ------------------------------------------------------------------------ */
function workSummaryWhat(summary){
  var value = workNarrativeText(summary && summary.whatCompletedMessage,
    summary && summary.whatCompleted || t("workNoneYet"));
  return value || t("workNoneYet");
}
function workSummaryBlocker(summary){
  if(!summary || !workLaneHasRealBlocker(summary.blocker, summary.blockerMessage)){
    return t("workNoBlocker");
  }
  return workNarrativeText(summary.blockerMessage, summary.blocker) || t("workNoBlocker");
}
function workSummaryNext(summary, opts){
  var value = workLaneNextActionText(summary || {}, opts || {});
  return value || t("workNoNext");
}
function renderWorkStoryFact(label, value, tone){
  var fact = h("div", "work-story-fact" + (tone ? " is-" + tone : ""));
  fact.appendChild(h("div", "work-story-label", label));
  fact.appendChild(h("div", "work-story-value", value));
  return fact;
}
function renderWorkStory(summary, decisionText, opts){
  opts = opts || {};
  var story = h("div", "work-story");
  story.setAttribute("data-fl-role", "work-story");
  story.appendChild(renderWorkStoryFact(t("workStoryFinished"), workSummaryWhat(summary)));
  story.appendChild(renderWorkStoryFact(t("workStoryBlocker"), workSummaryBlocker(summary),
    workLaneHasRealBlocker(summary && summary.blocker, summary && summary.blockerMessage) ? "attention" : "quiet"));
  story.appendChild(renderWorkStoryFact(t("workStoryNext"), workSummaryNext(summary, opts)));
  story.appendChild(renderWorkStoryFact(t("workStoryDecision"), decisionText || t("workNoDecision"),
    decisionText && decisionText !== t("workNoDecision") ? "attention" : "quiet"));
  return story;
}
function workPlanDependencyFacts(plan){
  var waiting = [];
  var named = [];
  WORK_COLUMN_CODES.forEach(function(code){
    ((plan && plan.columns && plan.columns[code]) || []).forEach(function(card){
      (card.namedDependencies || []).forEach(function(edge){
        /* Named edges are the safe source for this phase explanation. A
         * missing task name stays omitted instead of exposing an item id. */
        if(!edge || !edge.taskName) return;
        if(edge.state === "waiting" && waiting.indexOf(edge.taskName) < 0){
          waiting.push(edge.taskName);
        }
        if(named.indexOf(edge.taskName) < 0) named.push(edge.taskName);
      });
    });
  });
  return { waiting: waiting.slice(0, 3), named: named.slice(0, 3) };
}
function workGoalCurrentIndex(goal){
  var plans = (goal && goal.plans) || [];
  if(!goal || !goal.currentPlanId) return -1;
  for(var i = 0; i < plans.length; i++){
    if(String(plans[i].planId || "") === String(goal.currentPlanId)) return i;
  }
  return -1;
}
/* Phase labels come from Core's ordered plans and currentPlanId. They never
 * inspect Task columns to decide readiness, so browsing a future phase cannot
 * make any Task look executable. */
function workGoalPhaseState(goal, index){
  /* A terminal Goal has no live phase to schedule. Even if an older payload
   * still carries a currentPlanId, every phase is historical for browsing. */
  if(workGoalIsTerminalStatusForSelection(goal)) return "history";
  var currentIndex = workGoalCurrentIndex(goal);
  if(currentIndex >= 0){
    if(index < currentIndex) return "completed";
    if(index === currentIndex) return "current";
    return "upcoming";
  }
  return index === 0 ? "unknown" : "upcoming";
}
function workPhaseStateLabel(state){
  var keys = {
    completed: "workPhaseStatusCompleted",
    current: "workPhaseStatusCurrent",
    upcoming: "workPhaseStatusUpcoming",
    history: "workPhaseStatusHistory",
    unknown: "workPhaseStatusUnknown"
  };
  return t(keys[state] || keys.unknown);
}
function workGoalViewedPlan(goal){
  var plans = (goal && goal.plans) || [];
  var viewedId = S.workViewedGoalId === String(goal && goal.goalId || "")
    ? S.workViewedPlanId : null;
  if(viewedId){
    for(var i = 0; i < plans.length; i++){
      if(String(plans[i].planId || "") === String(viewedId)) return plans[i];
    }
    /* The phase disappeared from the latest canonical projection. Forget the
     * stale presentation key so the next render uses Core's current/history
     * fallback instead of pointing at an absent board. */
    S.workViewedPlanId = null;
  }
  return workGoalCurrentPlan(goal);
}
/* Stable phase projection boundary retained for Work tests and callers. The
 * ordered array is Core's order; currentPlan is only a display fallback and
 * never reorders phases or derives readiness from Task columns. */
function workGoalPhasePlans(goal){
  var plans = (goal && goal.plans) || [];
  var currentPlan = workGoalCurrentPlan(goal);
  var viewedPlan = workGoalViewedPlan(goal);
  return {
    plans: plans,
    currentPlan: currentPlan,
    viewedPlan: viewedPlan
  };
}
/* Resolve the Plan actually visible for a selected Goal: an explicitly viewed
 * phase when present, otherwise the canonical current/last phase. Save and
 * board-key logic share this single source so a default (non-clicked) terminal
 * phase is stored and matched identically across a hard reload. */
function workEffectiveGoalPlan(goal){
  return workGoalViewedPlan(goal) || workGoalCurrentPlan(goal);
}
function workSelectGoalPhase(goalId, planId){
  var view;
  try { view = normalizeWorkHierarchy(S.workHierarchy); } catch(_){ return; }
  var goal = (view.goals || []).find(function(item){
    return String(item.goalId || "") === String(goalId || "");
  });
  if(!goal) return;
  var plan = (goal.plans || []).find(function(item){
    return String(item.planId || "") === String(planId || "");
  });
  if(!plan) return;
  S.workViewedGoalId = String(goal.goalId || "");
  S.workViewedPlanId = String(plan.planId || "");
  workBoardFocusRequest = { key: workSelectionKey(S.workSelection) };
  /* Presentation-only phase navigation. It starts no request, advance, or
   * Task action; Core remains the only lifecycle authority. */
  render();
  workScheduleReadingContextSave();
}
function renderWorkPhaseOption(goal, plan, index, selected){
  var plans = (goal && goal.plans) || [];
  var state = workGoalPhaseState(goal, index);
  var item = h("li", "work-phase-item");
  var button = h("button", "work-phase-option" + (selected ? " is-selected" : ""));
  button.type = "button";
  button.setAttribute("data-fl-role", "work-phase-option");
  button.setAttribute("data-goal-id", String(goal.goalId || ""));
  button.setAttribute("data-plan-id", String(plan.planId || ""));
  button.setAttribute("aria-pressed", selected ? "true" : "false");
  if(selected) button.setAttribute("aria-current", "step");
  button.setAttribute("aria-label", t("workPhaseOptionAria", {
    number: String(index + 1),
    total: String(plans.length),
    name: plan.name || t("workUntitledPlan"),
    status: workPhaseStateLabel(state)
  }));
  button.addEventListener("click", function(){
    workSelectGoalPhase(goal.goalId, plan.planId);
  });

  var top = h("span", "work-phase-option-top");
  top.appendChild(h("span", "work-phase-number", t("workPhaseNumber", {
    number: String(index + 1), total: String(plans.length)
  })));
  top.appendChild(h("span", "work-phase-status is-" + state, workPhaseStateLabel(state)));
  button.appendChild(top);
  button.appendChild(h("span", "work-phase-option-name", plan.name || t("workUntitledPlan")));
  if(plan.objective){
    button.appendChild(h("span", "work-phase-option-objective", plan.objective));
  }
  var progress = plan.summary && plan.summary.progress || {};
  button.appendChild(h("span", "work-phase-option-progress", t("workPhaseProgress", {
    completed: String(progress.completed || 0),
    total: String(progress.total || 0)
  })));
  item.appendChild(button);
  return item;
}
function renderWorkCurrentPhase(goal, viewedPlan){
  var section = h("section", "work-phase-context");
  section.setAttribute("data-fl-role", "work-current-phase");
  section.setAttribute("aria-labelledby", "work-phase-navigator-title");
  var phaseProjection = workGoalPhasePlans(goal);
  var plans = phaseProjection.plans || [];
  var navigatorTitle = h("h3", "work-section-heading", t("workPhaseNavigatorTitle"));
  navigatorTitle.id = "work-phase-navigator-title";
  section.appendChild(navigatorTitle);
  section.appendChild(h("p", "work-phase-navigator-hint", t("workPhaseNavigatorHint")));
  if(!plans.length){
    section.appendChild(h("div", "work-phase-empty", t("workCurrentPhaseEmpty")));
    return section;
  }

  var selectedPlan = viewedPlan || phaseProjection.viewedPlan;
  var selectedIndex = plans.indexOf(selectedPlan);
  if(selectedIndex < 0) selectedIndex = 0;
  var list = h("ol", "work-phase-list");
  list.setAttribute("data-fl-role", "work-phase-list");
  plans.forEach(function(plan, index){
    list.appendChild(renderWorkPhaseOption(goal, plan, index, index === selectedIndex));
  });
  section.appendChild(list);

  /* Keep the first ordered Plan as a safe empty/malformed fallback. The
   * selected Plan replaces it only when it exists in Core's ordered array. */
  var plan = (plans || [])[0];
  if(selectedPlan && plans.indexOf(selectedPlan) >= 0) plan = selectedPlan;
  if(!plan) plan = phaseProjection.currentPlan;
  var state = workGoalPhaseState(goal, selectedIndex);
  var selected = h("div", "work-viewed-phase");
  selected.setAttribute("data-fl-role", "work-viewed-phase");
  var title = h("div", "work-phase-title-row");
  title.appendChild(h("h3", "work-phase-name", plan.name || t("workUntitledPlan")));
  title.appendChild(h("span", "work-phase-badge is-" + state, workPhaseStateLabel(state)));
  selected.appendChild(title);
  if(plan.objective) selected.appendChild(h("div", "work-phase-objective", plan.objective));
  var progress = plan.summary && plan.summary.progress || {};
  var facts = h("div", "work-phase-facts");
  facts.appendChild(h("span", "work-phase-fact", t("workPhaseTaskCount", {
    completed: String(progress.completed || 0), total: String(progress.total || 0)
  })));
  var dep = workPlanDependencyFacts(plan);
  if(state === "current"){
    facts.appendChild(h("span", "work-phase-fact", dep.waiting.length
      ? t("workPhaseDependenciesWaiting", { count: String(dep.waiting.length) })
      : t("workPhaseDependencyRule")));
  }
  selected.appendChild(facts);
  if(dep.waiting.length && state !== "upcoming"){
    selected.appendChild(h("div", "work-phase-dependency-note", t("workPhaseDependencyNames", {
      names: dep.waiting.join(", ")
    })));
  } else if(dep.named.length && state === "current"){
    selected.appendChild(h("div", "work-phase-dependency-note", t("workPhaseDependencyPrerequisites", {
      names: dep.named.join(", ")
    })));
  }
  var stateHint = state === "upcoming"
    ? t("workPhaseFutureReadOnly")
    : (state === "history" || state === "completed"
      ? t("workPhaseHistoryReadOnly")
      : (state === "unknown" ? t("workPhaseUnknownHint") : t("workPhaseCurrentHint")));
  selected.appendChild(h("div", "work-phase-view-hint", stateHint));
  section.appendChild(selected);
  return section;
}
function renderWorkTaskBoard(columns, titleKey, hintKey, opts){
  opts = opts || {};
  var section = h("section", "work-task-board");
  section.setAttribute("data-fl-role", "work-task-board");
  if(opts.planId) section.setAttribute("data-plan-id", String(opts.planId));
  var heading = h("div", "work-task-board-heading");
  var headingTitle = h("h2", "work-task-board-title", t(titleKey || "workTasksTitle"));
  headingTitle.id = "work-task-board-title";
  section.setAttribute("aria-labelledby", headingTitle.id);
  if(opts.phaseName){
    headingTitle.appendChild(h("span", "work-task-board-phase", opts.phaseName));
  }
  heading.appendChild(headingTitle);
  var hint = opts.phaseState === "upcoming"
    ? t("workGoalTasksFutureHint")
    : (opts.phaseState === "unknown"
      ? t("workPhaseUnknownHint") : t(hintKey || "workTasksHint"));
  heading.appendChild(h("div", "work-task-board-hint", hint));
  section.appendChild(heading);
  var board = h("div", "work-board");
  board.setAttribute("data-fl-role", "work-board");
  board.setAttribute("data-board-overflow", "contained");
  board.setAttribute("aria-label", opts.phaseName
    ? t("workTaskBoardAria", { phase: opts.phaseName }) : t("workTasksTitle"));
  board.addEventListener("dragover", workBoardDragOver);
  board.addEventListener("drop", workBoardDrop);
  board.addEventListener("dragleave", function(){ workClearDropHighlights(board); });
  var activeCodes = workColumnCodesWithCards(columns || {}, WORK_COLUMN_CODES);
  if(activeCodes.length){
    var headRow = h("div", "work-col-grid work-col-head");
    headRow.setAttribute("data-fl-role", "work-col-head");
    headRow.setAttribute("data-column-count", String(activeCodes.length));
    activeCodes.forEach(function(code){
      var cell = h("div", "work-cell work-cell-headcell tone-" + workColumnTone(code));
      cell.setAttribute("data-column", code);
      cell.setAttribute("data-card-count", String(((columns && columns[code]) || []).length));
      cell.appendChild(h("span", "work-cell-title", workColumnLabel(code)));
      cell.appendChild(h("span", "work-cell-count", String(((columns && columns[code]) || []).length)));
      headRow.appendChild(cell);
    });
    board.appendChild(headRow);
  }
  board.appendChild(renderWorkColumns(columns || {}));
  section.appendChild(board);
  return section;
}
/* FL-112E2: browser consumes the Core-projected currentPlanId to choose the
 * focused phase board. It never computes phase readiness. When no current Plan
 * remains (terminal Goal), the last phase serves completed-history inspection. */
function workGoalCurrentPlan(goal){
  /* FL-112E3: keep empty-Goal safety while exposing the stable source boundary
   * goal.plans || [] that the browser-side selector always consumes. */
  var plans = goal ? (goal.plans || []) : [];
  var current = null;
  var terminal = workGoalIsTerminalStatusForSelection(goal);
  if(!terminal && goal && goal.currentPlanId){
    for(var i = 0; i < plans.length; i++){
      if(String(plans[i].planId || "") === String(goal.currentPlanId)){
        current = plans[i];
        break;
      }
    }
  }
  /* Core omits currentPlanId for terminal Goals. The last ordered Plan is a
   * safe history view in that case; an active Goal with malformed/missing
   * current truth falls back to the first phase without changing readiness. */
  if(!current && plans.length > 0){
    current = terminal ? plans[plans.length - 1] : plans[0];
  }
  return current;
}
function renderWorkGoalSummary(goal, decisionCount){
  var details = document.createElement("details");
  details.className = "work-goal-summary";
  details.setAttribute("data-fl-role", "work-goal-summary");
  details.setAttribute("data-goal-id", String(goal.goalId || ""));
  var collapse = workCollapse || {};
  var key = "focused-goal:" + String(goal.goalId || "");
  details.open = workLaneExpanded(collapse, "focused-goal", goal.goalId, true);
  var summary = h("summary", "work-goal-summary-summary");
  summary.appendChild(h("span", "work-goal-summary-title", t("workGoalSummaryTitle")));
  summary.appendChild(h("span", "work-goal-summary-hint", t("workGoalSummaryHint")));
  details.appendChild(summary);
  var body = h("div", "work-goal-summary-body");
  body.appendChild(renderWorkStory(goal.summary || {}, decisionCount > 0
    ? t("workDecisionCount", { count: String(decisionCount) })
    : t("workNoDecision"), {
      completedNoDecision: goal.status === "completed" && decisionCount === 0
    }));
  details.appendChild(body);
  details.addEventListener("toggle", function(){
    if(!workCollapse) workCollapse = {};
    workCollapse[key] = details.open;
    workCollapseSave(workCollapse);
  });
  return details;
}
function renderGoalFileSection(role, title, body, extraClass){
  var section = h("section", "goal-file-section" + (extraClass ? " " + extraClass : ""));
  section.setAttribute("data-fl-role", role);
  if(title) section.appendChild(h("h3", "goal-file-heading", title));
  if(body) section.appendChild(body);
  return section;
}
function renderGoalFileTaskLine(card){
  var wrap = h("div", "goal-file-task");
  wrap.appendChild(renderWorkCard(card));
  var facts = h("div", "goal-file-task-facts");
  var fact = workNarrativeText(card.whatCompletedMessage, card.whatCompleted || "");
  if(fact) facts.appendChild(h("p", "goal-file-fact", t("goalFileFact", { text: fact })));
  var reason = workCardPrimaryLine(card);
  if(reason) facts.appendChild(h("p", "goal-file-reason", t("goalFileReason", { text: reason })));
  var retained = workNarrativeText(card.whatCompletedMessage, card.whatCompleted || "");
  if(retained) facts.appendChild(h("p", "goal-file-retained", t("goalFileRetained", { text: retained })));
  if(facts.childNodes.length) wrap.appendChild(facts);
  return wrap;
}
function renderWorkFocusedGoal(goal){
  var focus = h("section", "work-focus goal-file");
  focus.setAttribute("data-fl-role", "work-focus");
  focus.setAttribute("data-workspace-kind", "goal");
  focus.setAttribute("data-workspace-id", String(goal.goalId || ""));
  var viewedPlan = workGoalViewedPlan(goal) || workGoalCurrentPlan(goal);
  var model = composeGoalFileModel(goal, viewedPlan);
  var header = h("header", "work-focus-header");
  var titleRow = h("div", "work-focus-title-row");
  titleRow.appendChild(h("span", "work-focus-type", t("workGoalType")));
  titleRow.appendChild(h("h2", "work-focus-title", goal.name || t("workUntitledGoal")));
  if(goal.status) titleRow.appendChild(badge(goal.status));
  header.appendChild(titleRow);
  focus.appendChild(header);

  var resultBody = h("div", "goal-file-body");
  resultBody.appendChild(h("p", "goal-file-lead", model.desiredResult || t("goalFileResultMissing")));
  focus.appendChild(renderGoalFileSection("goal-file-result", t("goalFileResult"), resultBody));

  var truthBody = h("div", "goal-file-body");
  truthBody.appendChild(h("p", "goal-file-lead", model.currentTruth || t("workNoneYet")));
  focus.appendChild(renderGoalFileSection("goal-file-truth", t("goalFileTruth"), truthBody));

  var decisionBody = h("div", "goal-file-body");
  if(model.decisionNeeded){
    decisionBody.appendChild(h("p", "goal-file-lead is-attention", t("goalFileDecisionYes", {
      count: String(model.decisionCount)
    })));
    var openDecisions = h("button", "btn primary sm", t("goalFileOpenDecisions"));
    openDecisions.type = "button";
    openDecisions.setAttribute("data-fl-role", "goal-file-open-decisions");
    openDecisions.addEventListener("click", function(){ switchTab("decisions"); });
    decisionBody.appendChild(openDecisions);
  } else {
    decisionBody.appendChild(h("p", "goal-file-lead", t("goalFileDecisionNo")));
  }
  focus.appendChild(renderGoalFileSection("goal-file-decision", t("goalFileDecision"), decisionBody));

  var phaseWrap = h("div", "goal-file-body");
  phaseWrap.appendChild(renderWorkCurrentPhase(goal, viewedPlan));
  focus.appendChild(renderGoalFileSection("goal-file-phase", t("goalFilePhase"), phaseWrap));

  var taskBody = h("div", "goal-file-body");
  if(model.currentTask){
    taskBody.appendChild(h("p", "goal-file-next", t("goalFileNext", { text: model.nextAction })));
    taskBody.appendChild(renderGoalFileTaskLine(model.currentTask));
    var moreCards = [];
    model.currentCards.forEach(function(card){
      if(card !== model.currentTask) moreCards.push(card);
    });
    (model.blockedCards || []).forEach(function(card){
      if(card !== model.currentTask) moreCards.push(card);
    });
    if(moreCards.length){
      var more = h("div", "goal-file-more-tasks");
      moreCards.forEach(function(card){ more.appendChild(renderWorkCard(card)); });
      taskBody.appendChild(more);
    }
  } else {
    taskBody.appendChild(stateMsg("empty", t("workCurrentPhaseEmpty")));
  }
  focus.appendChild(renderGoalFileSection("goal-file-task", t("goalFileTask"), taskBody));

  var blockerBody = h("div", "goal-file-body");
  var setupBlockers = collectSetupBlockers();
  if(!model.blockers.length && !setupBlockers.length){
    blockerBody.appendChild(h("p", "goal-file-lead", t("goalFileNoBlockers")));
  } else {
    model.blockers.forEach(function(blocker){
      var item = h("div", "goal-file-blocker-item");
      if(blocker.fact){
        item.appendChild(h("p", "goal-file-fact", t("goalFileFact", { text: blocker.fact })));
      }
      item.appendChild(h("p", "goal-file-blocker", t("goalFileReason", {
        text: blocker.reason || blocker.text
      })));
      if(blocker.retained){
        item.appendChild(h("p", "goal-file-retained", t("goalFileRetained", { text: blocker.retained })));
      }
      if(blocker.next){
        item.appendChild(h("p", "goal-file-next", t("goalFileNext", { text: blocker.next })));
      }
      blockerBody.appendChild(item);
    });
    setupBlockers.forEach(function(item){
      var row = h("div", "goal-file-setup-blocker");
      row.appendChild(h("p", "goal-file-blocker", t("setupBlockerReason", { text: item.reason })));
      var go = h("button", "btn sm", t("setupBlockerNext", { action: item.action }));
      go.type = "button";
      go.addEventListener("click", function(){ switchTab(item.next); });
      row.appendChild(go);
      blockerBody.appendChild(row);
    });
  }
  focus.appendChild(renderGoalFileSection("goal-file-blockers", t("goalFileBlockers"), blockerBody));

  var deliveryBody = h("div", "goal-file-body");
  if(model.terminal){
    deliveryBody.appendChild(h("p", "goal-file-lead", t("goalFileDeliveryDone", {
      status: statusLabel(model.status)
    })));
  } else {
    deliveryBody.appendChild(h("p", "goal-file-lead", t("goalFileDeliveryLive")));
  }
  if(model.historyCards.length){
    model.historyCards.forEach(function(card){ deliveryBody.appendChild(renderWorkCard(card)); });
  }
  focus.appendChild(renderGoalFileSection("goal-file-delivery", t("goalFileDelivery"), deliveryBody));

  var evidence = document.createElement("details");
  evidence.className = "goal-file-evidence work-goal-summary";
  evidence.setAttribute("data-fl-role", "goal-file-evidence");
  var evSummary = document.createElement("summary");
  evSummary.textContent = t("goalFileEvidence");
  evidence.appendChild(evSummary);
  var evBody = h("div", "goal-file-evidence-body");
  evBody.appendChild(renderWorkGoalSummary(goal, model.decisionCount));
  if(viewedPlan){
    evBody.appendChild(renderWorkTaskBoard(viewedPlan.columns || {},
      "workPhaseTasksTitle", "workGoalTasksHint", {
        planId: viewedPlan.planId,
        phaseName: viewedPlan.name || t("workUntitledPlan"),
        phaseState: model.phaseState
      }));
  }
  evidence.appendChild(evBody);
  focus.appendChild(evidence);
  return focus;
}
function renderWorkFocusedPlan(plan){
  var focus = h("section", "work-focus");
  focus.setAttribute("data-fl-role", "work-focus");
  focus.setAttribute("data-workspace-kind", "plan");
  focus.setAttribute("data-workspace-id", String(plan.planId || ""));
  var header = h("header", "work-focus-header");
  var titleRow = h("div", "work-focus-title-row");
  titleRow.appendChild(h("h2", "work-focus-title", plan.name || t("workUntitledPlan")));
  titleRow.appendChild(h("span", "work-focus-type", t("workIndependentPlanBadge")));
  header.appendChild(titleRow);
  if(plan.objective) header.appendChild(h("p", "work-focus-objective", plan.objective));
  header.appendChild(h("p", "work-focus-ancestry", t("workIndependentPlanHint")));
  focus.appendChild(header);
  var summary = plan.summary || {};
  var decisionCount = ((plan.columns && plan.columns["waiting-user-decision"]) || []).length;
  focus.appendChild(renderWorkStory(summary, decisionCount > 0
    ? t("workDecisionCount", { count: String(decisionCount) })
    : t("workNoDecision")));
  focus.appendChild(renderWorkTaskBoard(plan.columns || {}, "workPlanTasksTitle", "workPlanTasksHint"));
  return focus;
}
var WORK_ONE_OFF_GROUPS = [
  { key: "current", codes: ["not-started", "ready", "running", "waiting-verification"], title: "workOneOffCurrentTitle", hint: "workOneOffCurrentHint", limit: 24 },
  { key: "attention", codes: ["waiting-user-decision", "stopped-failed"], title: "workOneOffAttentionTitle", hint: "workOneOffAttentionHint", limit: 24 },
  { key: "history", codes: ["completed"], title: "workOneOffHistoryTitle", hint: "workOneOffHistoryHint", limit: 20 }
];
function workOneOffGroupCount(lane, codes){
  var count = 0;
  (codes || []).forEach(function(code){ count += ((lane && lane.columns && lane.columns[code]) || []).length; });
  return count;
}
function renderWorkOneOffGroup(lane, definition){
  var query = definition.key === "history"
    ? String(S.workOneOffSearch || "").trim().toLocaleLowerCase()
    : "";
  var sourceColumns = {};
  definition.codes.forEach(function(code){
    var cards = ((lane && lane.columns && lane.columns[code]) || []);
    sourceColumns[code] = query ? cards.filter(function(card){
      return workOneOffCardMatches(card, query);
    }) : cards;
  });
  var filteredLane = { columns: sourceColumns };
  var total = workOneOffGroupCount(filteredLane, definition.codes);
  var details = document.createElement("details");
  details.className = "work-oneoff-status-group work-oneoff-status-" + definition.key;
  details.setAttribute("data-fl-role", "work-oneoff-" + definition.key);
  var defaultOpen = definition.key !== "history" && total > 0;
  details.open = defaultOpen;
  var summary = document.createElement("summary");
  summary.className = "work-oneoff-status-summary";
  summary.setAttribute("data-fl-role", "work-oneoff-" + definition.key + "-toggle");
  summary.appendChild(h("span", "work-oneoff-status-title", t(definition.title)));
  summary.appendChild(h("span", "work-oneoff-status-count", String(total)));
  details.appendChild(summary);
  var body = h("div", "work-oneoff-status-body");
  var filled = false;
  function fill(limit){
    if(filled && limit !== "all") return;
    filled = true;
    body.textContent = "";
    var columns = {};
    var omitted = 0;
    var remaining = limit === "all" ? Infinity : definition.limit;
    definition.codes.forEach(function(code){
      var all = sourceColumns[code] || [];
      columns[code] = limit === "all" ? all : all.slice(0, Math.max(0, remaining));
      if(limit !== "all"){
        omitted += Math.max(0, all.length - columns[code].length);
        remaining = Math.max(0, remaining - columns[code].length);
      }
    });
    body.appendChild(h("div", "work-oneoff-status-hint", t(definition.hint, {
      count: String(total)
    })));
    if(total > 0) body.appendChild(renderWorkColumns(columns, definition.codes));
    else body.appendChild(h("div", "work-oneoff-status-empty",
      query ? t("workOneOffHistoryNoMatches") : t("workColumnEmpty")));
    if(omitted > 0 && limit !== "all"){
      var more = h("button", "btn sm work-oneoff-show-more", t("workOneOffShowMore", {
        count: String(omitted)
      }));
      more.type = "button";
      more.addEventListener("click", function(){
        fill("all");
        /* The old button is replaced by the full list; keep keyboard focus in
         * the bounded work area rather than on a detached node. */
        body.setAttribute("tabindex", "-1");
        body.focus();
      });
      body.appendChild(more);
    }
  }
  function ensure(){ if(!filled) fill("bounded"); }
  details.addEventListener("toggle", function(){ if(details.open) ensure(); });
  if(defaultOpen) ensure();
  details.appendChild(body);
  return details;
}
function workOneOffCardMatches(card, query){
  if(!query) return true;
  var parts = [card && card.name, card && card.nextAction, card && card.nextActionMessage];
  (card && card.blockers || []).forEach(function(blocker){
    parts.push(workSafeCardBlockerLabel(card, blocker));
  });
  return parts.filter(Boolean).join(" ").toLocaleLowerCase().indexOf(query) >= 0;
}
function renderWorkOneOffSearch(){
  var form = document.createElement("form");
  form.className = "work-oneoff-search";
  form.setAttribute("data-fl-role", "work-oneoff-search");
  form.setAttribute("aria-label", t("workOneOffSearchLabel"));
  var label = h("label", "work-oneoff-search-field", "");
  label.appendChild(h("span", "work-oneoff-search-label", t("workOneOffSearchLabel")));
  var input = document.createElement("input");
  input.type = "search";
  input.maxLength = 120;
  input.className = "work-oneoff-search-input";
  input.setAttribute("data-fl-role", "work-oneoff-search-input");
  input.setAttribute("aria-label", t("workOneOffSearchLabel"));
  input.placeholder = t("workOneOffSearchPlaceholder");
  input.value = String(S.workOneOffSearchDraft || "");
  input.addEventListener("input", function(){
    S.workOneOffSearchDraft = input.value.slice(0, 120);
    workScheduleReadingContextSave();
  });
  label.appendChild(input);
  form.appendChild(label);
  var actions = h("div", "work-oneoff-search-actions");
  var submit = h("button", "btn sm", t("workOneOffSearchApply"));
  submit.type = "submit";
  actions.appendChild(submit);
  var clear = h("button", "btn sm", t("workOneOffSearchClear"));
  clear.type = "button";
  clear.addEventListener("click", function(){
    S.workOneOffSearch = "";
    S.workOneOffSearchDraft = "";
    workScheduleReadingContextSave();
    render();
  });
  actions.appendChild(clear);
  form.appendChild(actions);
  form.addEventListener("submit", function(e){
    e.preventDefault();
    S.workOneOffSearch = String(S.workOneOffSearchDraft || "").trim().slice(0, 120);
    S.workOneOffSearchDraft = S.workOneOffSearch;
    workScheduleReadingContextSave();
    render();
  });
  return form;
}
function renderWorkOneOffSummary(current, attention, history){
  var summary = h("div", "work-story work-oneoff-summary");
  summary.setAttribute("data-fl-role", "work-oneoff-summary");
  summary.appendChild(renderWorkStoryFact(t("workOneOffCurrentTitle"), String(current)));
  summary.appendChild(renderWorkStoryFact(t("workOneOffAttentionTitle"), String(attention),
    attention > 0 ? "attention" : "quiet"));
  summary.appendChild(renderWorkStoryFact(t("workOneOffHistoryTitle"), String(history), "quiet"));
  summary.appendChild(renderWorkStoryFact(t("workOneOffStandaloneBadge"), t("workOneOffNoParent"), "quiet"));
  return summary;
}
function renderWorkFocusedOneOff(lane){
  var focus = h("section", "work-focus");
  focus.setAttribute("data-fl-role", "work-focus");
  focus.setAttribute("data-workspace-kind", "one-off");
  focus.setAttribute("data-workspace-id", "inbox");
  var header = h("header", "work-focus-header");
  var titleRow = h("div", "work-focus-title-row");
  titleRow.appendChild(h("h2", "work-focus-title", t("workIndependentTasks")));
  titleRow.appendChild(h("span", "work-focus-type", t("workOneOffStandaloneBadge")));
  header.appendChild(titleRow);
  header.appendChild(h("p", "work-focus-objective", t("workOneOffWorkspaceHint")));
  focus.appendChild(header);
  var current = workOneOffGroupCount(lane, WORK_ONE_OFF_GROUPS[0].codes);
  var attention = workOneOffGroupCount(lane, WORK_ONE_OFF_GROUPS[1].codes);
  var history = workOneOffGroupCount(lane, WORK_ONE_OFF_GROUPS[2].codes);
  focus.appendChild(renderWorkOneOffSearch());
  focus.appendChild(renderWorkOneOffSummary(current, attention, history));
  var groups = h("div", "work-oneoff-status-groups");
  groups.setAttribute("data-fl-role", "work-oneoff-groups");
  WORK_ONE_OFF_GROUPS.forEach(function(definition){
    groups.appendChild(renderWorkOneOffGroup(lane, definition));
  });
  if(current === 0 && attention === 0){
    groups.insertBefore(h("div", "work-oneoff-empty-note", t("workOneOffNoCurrent")), groups.firstChild);
  }
  focus.appendChild(groups);
  return focus;
}
function renderWorkWorkspaceOption(kind, id, name, cue, count, selected, status){
  var button = h("button", "work-portfolio-option" + (selected ? " is-selected" : ""));
  button.type = "button";
  button.setAttribute("data-fl-role", "work-workspace-option");
  button.setAttribute("data-workspace-kind", kind);
  button.setAttribute("data-workspace-id", String(id || ""));
  button.setAttribute("aria-pressed", selected ? "true" : "false");
  if(selected) button.setAttribute("aria-current", "true");
  button.addEventListener("click", function(){ workSelectWorkspace(kind, id); });
  var head = h("span", "work-portfolio-option-head");
  head.appendChild(h("span", "work-portfolio-option-name", name));
  if(status) head.appendChild(badge(status));
  button.appendChild(head);
  button.appendChild(h("span", "work-portfolio-option-cue", cue));
  button.appendChild(h("span", "work-portfolio-option-meta", t("workPortfolioTaskCount", {
    count: String(count)
  })));
  return button;
}
function renderWorkPortfolioGroup(title, items, emptyText){
  var group = h("section", "work-portfolio-group");
  group.appendChild(h("h3", "work-portfolio-group-title", title));
  if(items && items.length) items.forEach(function(item){ group.appendChild(item); });
  else if(emptyText) group.appendChild(h("p", "work-portfolio-empty", emptyText));
  return group;
}
function workCreateTargetEqual(left, right){
  if(!left || !right) return false;
  return String(left.shape || "") === String(right.shape || "")
    && String(left.goalId || "") === String(right.goalId || "")
    && String(left.planId || "") === String(right.planId || "");
}
function workFocusCreateTrigger(target){
  if(!viewEl || !target) return;
  var buttons = viewEl.querySelectorAll('[data-fl-role="work-tree-add-' + target.shape + '"]');
  for(var i = 0; i < buttons.length; i += 1){
    if(String(buttons[i].getAttribute("data-goal-id") || "") !== String(target.goalId || "")) continue;
    if(String(buttons[i].getAttribute("data-plan-id") || "") !== String(target.planId || "")) continue;
    if(typeof buttons[i].focus === "function") buttons[i].focus();
    return;
  }
}
function workCloseCreateTarget(target){
  if(S.outcomeSubmitting) return;
  S.workCreateTarget = null;
  S.outcomeCreateError = null;
  render();
  setTimeout(function(){ workFocusCreateTrigger(target); }, 0);
}
function workOpenCreateTarget(target){
  if(!target || ["goal", "plan", "task"].indexOf(target.shape) < 0) return;
  S.workCreateTarget = {
    shape: target.shape,
    goalId: String(target.goalId || ""),
    goalName: String(target.goalName || ""),
    planId: String(target.planId || ""),
    planName: String(target.planName || "")
  };
  S.outcomeDraft.requestedShape = target.shape;
  S.outcomeCreateError = null;
  render();
  setTimeout(function(){
    var textarea = viewEl && viewEl.querySelector('[data-fl-role="outcome-text"]');
    if(textarea && typeof textarea.focus === "function") textarea.focus();
  }, 0);
}
function renderWorkCreateButton(label, target, className){
  var button = h("button", "work-tree-add " + (className || ""), label);
  button.type = "button";
  button.setAttribute("data-fl-role", "work-tree-add-" + target.shape);
  button.setAttribute("data-create-shape", target.shape);
  button.setAttribute("aria-expanded", workCreateTargetEqual(S.workCreateTarget, target) ? "true" : "false");
  if(target.goalId) button.setAttribute("data-goal-id", String(target.goalId));
  if(target.planId) button.setAttribute("data-plan-id", String(target.planId));
  button.addEventListener("click", function(e){
    e.preventDefault();
    e.stopPropagation();
    workOpenCreateTarget(target);
  });
  return button;
}
function renderWorkContextualComposer(target){
  if(!workCreateTargetEqual(S.workCreateTarget, target)) return null;
  var entry = h("section", "work-new-entry work-contextual-create");
  entry.setAttribute("data-fl-role", "work-new-entry");
  entry.setAttribute("aria-label", workCreateTitle(target));
  entry.appendChild(renderOutcomeSection({ target: target, includeStory: false }));
  return entry;
}
function renderWorkNewEntry(){
  var target = { shape: "goal", goalId: "", goalName: "", planId: "", planName: "" };
  var entry = h("div", "work-tree-root-action");
  entry.setAttribute("data-fl-role", "work-new-entry");
  entry.appendChild(renderWorkCreateButton(t("workTreeNewGoal"), target, "is-root"));
  var composer = renderWorkContextualComposer(target);
  if(composer) entry.appendChild(composer);
  return entry;
}
function workSelectGoalPlan(goalId, planId){
  var view;
  try { view = normalizeWorkHierarchy(S.workHierarchy); } catch(_){ return; }
  var goal = (view.goals || []).find(function(item){
    return String(item.goalId || "") === String(goalId || "");
  });
  var plan = goal && (goal.plans || []).find(function(item){
    return String(item.planId || "") === String(planId || "");
  });
  if(!goal || !plan) return;
  S.workSelection = workMakeSelection("goal", goalId);
  S.workViewedGoalId = String(goalId);
  S.workViewedPlanId = String(planId);
  workBoardFocusRequest = { key: workSelectionKey(S.workSelection) };
  workActionChooserReset();
  workPendingHandoffReset();
  hideDetail();
  if(workIsNarrowViewport()) workApplyMobilePane(workNextMobilePane(S.workMobilePane, "open-file"));
  render();
  if(workIsNarrowViewport()) workApplyGoalFileStart();
  workScheduleReadingContextSave();
}
function renderWorkTreeDisclosure(kind, id, body, expanded){
  var toggle = h("button", "work-tree-disclosure", expanded ? "▾" : "▸");
  toggle.type = "button";
  toggle.setAttribute("data-fl-role", "work-tree-disclosure");
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", body.id);
  toggle.setAttribute("aria-label", expanded ? t("workTreeCollapse") : t("workTreeExpand"));
  toggle.addEventListener("click", function(){
    expanded = !expanded;
    body.hidden = !expanded;
    toggle.textContent = expanded ? "▾" : "▸";
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.setAttribute("aria-label", expanded ? t("workTreeCollapse") : t("workTreeExpand"));
  });
  return toggle;
}
function renderWorkTreeTask(item){
  var button = h("button", "work-tree-task");
  button.type = "button";
  button.setAttribute("data-fl-role", "work-tree-task");
  button.setAttribute("data-task-id", String(item.id || ""));
  button.addEventListener("click", function(){ showTask(item.id, item.breadcrumb); });
  var copy = h("span", "work-tree-task-copy");
  copy.appendChild(h("span", "work-tree-task-name", item.name || t("taskUntitled")));
  copy.appendChild(h("span", "work-tree-task-state", workColumnLabel(item.status)));
  button.appendChild(h("span", "work-tree-branch-dot", ""));
  button.appendChild(copy);
  return button;
}
function renderWorkTreePlan(item, selection){
  var nested = item.kind === "goal-plan";
  var selected = nested
    ? !!(selection && selection.kind === "goal" && String(selection.id) === String(item.goalId)
      && (String(S.workViewedPlanId || "") === String(item.id)
        || (!S.workViewedPlanId && item.current)))
    : workSelectionEqual(selection, workMakeSelection("plan", item.id));
  var node = h("section", "work-tree-node work-tree-plan" + (selected ? " is-selected" : ""));
  node.setAttribute("data-fl-role", nested ? "work-tree-goal-plan" : "work-tree-independent-plan");
  node.setAttribute("data-plan-id", String(item.id || ""));
  var body = h("div", "work-tree-children work-tree-task-list");
  body.id = workLaneId("tree-plan", (item.goalId || "independent") + "-" + item.id);
  var expanded = selected || !!S.workTreeQuery || item.tasks.length <= 6;
  body.hidden = !expanded;
  var row = h("div", "work-tree-row work-tree-plan-row");
  row.appendChild(renderWorkTreeDisclosure("plan", item.id, body, expanded));
  var select = h("button", "work-tree-select work-tree-plan-select");
  select.type = "button";
  select.setAttribute("data-fl-role", "work-tree-plan-select");
  select.setAttribute("aria-pressed", selected ? "true" : "false");
  select.appendChild(h("span", "work-tree-level", t("workTreePlanLevel")));
  select.appendChild(h("span", "work-tree-name", item.name || t("workUntitledPlan")));
  select.appendChild(h("span", "work-tree-count", String(item.taskCount || 0)));
  select.addEventListener("click", function(){
    if(nested) workSelectGoalPlan(item.goalId, item.id);
    else workSelectWorkspace("plan", item.id);
  });
  row.appendChild(select);
  var target = {
    shape: "task",
    goalId: item.goalId || "",
    goalName: item.goalName || "",
    planId: item.id,
    planName: item.name || t("workUntitledPlan")
  };
  row.appendChild(renderWorkCreateButton(t("workTreeAddTask"), target));
  node.appendChild(row);
  var composer = renderWorkContextualComposer(target);
  if(composer) body.appendChild(composer);
  (item.tasks || []).forEach(function(task){ body.appendChild(renderWorkTreeTask(task)); });
  if(!item.tasks.length) body.appendChild(h("p", "work-tree-empty-children", t("workTreeNoTasks")));
  node.appendChild(body);
  return node;
}
function renderWorkTreeGoal(item, selection){
  var selected = workSelectionEqual(selection, workMakeSelection("goal", item.id));
  var node = h("section", "work-tree-node work-tree-goal" + (selected ? " is-selected" : ""));
  node.setAttribute("data-fl-role", "work-tree-goal");
  node.setAttribute("data-goal-id", String(item.id || ""));
  var body = h("div", "work-tree-children work-tree-plan-list");
  body.id = workLaneId("tree-goal", item.id);
  var expanded = selected || !!S.workTreeQuery || !item.terminal;
  body.hidden = !expanded;
  var row = h("div", "work-tree-row work-tree-goal-row");
  row.appendChild(renderWorkTreeDisclosure("goal", item.id, body, expanded));
  var select = h("button", "work-tree-select work-tree-goal-select");
  select.type = "button";
  select.setAttribute("data-fl-role", "work-tree-goal-select");
  select.setAttribute("aria-pressed", selected ? "true" : "false");
  select.appendChild(h("span", "work-tree-level", t("workTreeGoalLevel")));
  select.appendChild(h("span", "work-tree-name", item.name || t("workUntitledGoal")));
  if(item.decisionCount){
    select.appendChild(h("span", "work-tree-attention", String(item.decisionCount)));
  }
  select.addEventListener("click", function(){ workSelectWorkspace("goal", item.id); });
  row.appendChild(select);
  var target = {
    shape: "plan",
    goalId: item.id,
    goalName: item.name || t("workUntitledGoal"),
    planId: "",
    planName: ""
  };
  row.appendChild(renderWorkCreateButton(t("workTreeAddPlan"), target));
  node.appendChild(row);
  var composer = renderWorkContextualComposer(target);
  if(composer) body.appendChild(composer);
  (item.plans || []).forEach(function(plan){ body.appendChild(renderWorkTreePlan(plan, selection)); });
  if(!item.plans.length) body.appendChild(h("p", "work-tree-empty-children", t("workTreeNoPlans")));
  node.appendChild(body);
  return node;
}
function renderWorkGoalTreeItem(item, selection){
  if(item.kind === "goal") return renderWorkTreeGoal(item, selection);
  if(item.kind === "plan") return renderWorkTreePlan(item, selection);
  var selected = workSelectionEqual(selection, workMakeSelection("one-off", item.id));
  var button = h("button", "work-tree-independent-tasks" + (selected ? " is-selected" : ""));
  button.type = "button";
  button.setAttribute("data-fl-role", "work-workspace-option");
  button.setAttribute("data-workspace-kind", "one-off");
  button.setAttribute("data-workspace-id", String(item.id || ""));
  button.setAttribute("aria-pressed", selected ? "true" : "false");
  button.addEventListener("click", function(){ workSelectWorkspace("one-off", item.id); });
  button.appendChild(h("span", "work-tree-level", t("workTreeTaskLevel")));
  button.appendChild(h("span", "work-tree-name", t("workIndependentTasks")));
  button.appendChild(h("span", "work-tree-count", String(item.taskCount || 0)));
  return button;
}
function renderWorkTreeList(items, selection){
  var list = h("div", "goal-tree-list");
  list.setAttribute("data-fl-role", "goal-tree-list");
  var goals = (items || []).filter(function(item){ return item.kind === "goal"; });
  var independent = (items || []).filter(function(item){ return item.kind !== "goal"; });
  goals.forEach(function(item){ list.appendChild(renderWorkGoalTreeItem(item, selection)); });
  if(independent.length){
    var group = h("section", "work-tree-independent");
    group.setAttribute("data-fl-role", "work-tree-independent");
    group.appendChild(h("h3", "work-tree-independent-title", t("workTreeIndependent")));
    independent.forEach(function(item){ group.appendChild(renderWorkGoalTreeItem(item, selection)); });
    list.appendChild(group);
  }
  return list;
}
function renderWorkIntakeTray(){
  if(S.intakes === null && !S.intakesError) return null;
  if(Array.isArray(S.intakes) && !S.intakes.length && !S.intakesError) return null;
  var tray = document.createElement("details");
  tray.className = "work-intake-tray";
  tray.setAttribute("data-fl-role", "work-intake-tray");
  tray.open = !!S.selectedIntakeId;
  var summary = document.createElement("summary");
  summary.textContent = t("workIntakesTitle", {
    count: String(Array.isArray(S.intakes) ? S.intakes.length : 0)
  });
  tray.appendChild(summary);
  var body = h("div", "work-intake-tray-body");
  body.appendChild(renderIntakeStory());
  tray.appendChild(body);
  return tray;
}
function workGoalTreeEmptyText(view, scope, query){
  if(!query && scope !== "history"){
    var applied = view && view.filter && view.filter.applied;
    if(applied && (applied.project || applied.columns || applied.workerProfileId)){
      return t("workFilterNoMatches");
    }
  }
  return scope === "history" ? t("goalTreeEmptyHistory") : t("goalTreeEmptyNow");
}
function renderWorkGoalTree(view, selection){
  var model = composeGoalTreeModel(view, S.workTreeQuery, S.workTreeScope);
  var rail = h("aside", "work-portfolio goal-tree");
  rail.setAttribute("data-fl-role", "goal-tree");
  rail.setAttribute("aria-label", t("goalTreeLabel"));
  rail.setAttribute("style", "--goal-tree-width:" + workNormalizeTreeWidth(S.workTreeWidth) + "px");
  var header = h("div", "work-tree-header");
  header.appendChild(h("h2", "work-portfolio-title", t("goalTreeLabel")));
  header.appendChild(renderWorkCreateButton(t("workTreeNewGoal"), {
    shape: "goal", goalId: "", goalName: "", planId: "", planName: ""
  }, "is-root"));
  rail.appendChild(header);
  var search = document.createElement("form");
  search.className = "goal-tree-search";
  search.setAttribute("data-fl-role", "goal-tree-search");
  search.setAttribute("role", "search");
  var searchLabel = h("label", "goal-tree-search-field", "");
  searchLabel.appendChild(h("span", "sr-only", t("goalTreeSearch")));
  var searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.maxLength = 120;
  searchInput.className = "goal-tree-search-input";
  searchInput.setAttribute("data-fl-role", "goal-tree-search-input");
  searchInput.setAttribute("aria-label", t("goalTreeSearch"));
  searchInput.placeholder = t("goalTreeSearch");
  searchInput.value = String(S.workTreeQuery || "");
  searchInput.addEventListener("input", function(){
    S.workTreeQuery = String(searchInput.value || "").slice(0, 120);
    workScheduleReadingContextSave();
    var list = rail.querySelector('[data-fl-role="goal-tree-list"]');
    if(!list || !list.parentNode) return;
    var next = composeGoalTreeModel(view, S.workTreeQuery, S.workTreeScope);
    var replacement;
    if(!next.visible.length){
      replacement = h("div", "goal-tree-list");
      replacement.setAttribute("data-fl-role", "goal-tree-list");
      replacement.appendChild(h("p", "work-portfolio-empty",
        workGoalTreeEmptyText(view, next.scope, next.query)));
    } else {
      replacement = renderWorkTreeList(next.visible, selection);
    }
    list.parentNode.replaceChild(replacement, list);
  });
  searchLabel.appendChild(searchInput);
  search.appendChild(searchLabel);
  search.addEventListener("submit", function(e){ e.preventDefault(); });
  rail.appendChild(search);

  var scopes = h("div", "goal-tree-scopes");
  scopes.setAttribute("role", "tablist");
  ["now", "history"].forEach(function(scope){
    var btn = h("button", "goal-tree-scope" + (model.scope === scope ? " is-selected" : ""));
    btn.type = "button";
    btn.setAttribute("data-fl-role", "goal-tree-" + scope);
    btn.setAttribute("aria-pressed", model.scope === scope ? "true" : "false");
    btn.textContent = scope === "history" ? t("goalTreeHistory") : t("goalTreeNow");
    btn.addEventListener("click", function(){
      S.workTreeScope = scope;
      workScheduleReadingContextSave();
      render();
    });
    scopes.appendChild(btn);
  });
  rail.appendChild(scopes);
  var rootComposer = renderWorkContextualComposer({
    shape: "goal", goalId: "", goalName: "", planId: "", planName: ""
  });
  if(rootComposer) rail.appendChild(rootComposer);

  var list;
  if(!model.visible.length){
    list = h("div", "goal-tree-list");
    list.setAttribute("data-fl-role", "goal-tree-list");
    list.appendChild(h("p", "work-portfolio-empty",
      workGoalTreeEmptyText(view, model.scope, model.query)));
  } else {
    list = renderWorkTreeList(model.visible, selection);
  }
  rail.appendChild(list);
  var intakeTray = renderWorkIntakeTray();
  if(intakeTray) rail.appendChild(intakeTray);
  return rail;
}
function renderWorkPortfolio(view, selection){
  return renderWorkGoalTree(view, selection);
}
function renderWorkFocusedWorkspace(view, selection){
  if(!selection) return stateMsg("empty", t("workEmpty"));
  if(selection.kind === "goal"){
    var goal = (view.goals || []).find(function(item){ return String(item.goalId || "") === String(selection.id); });
    if(goal) return renderWorkFocusedGoal(goal);
  } else if(selection.kind === "plan"){
    var plan = (view.independentPlans || []).find(function(item){ return String(item.planId || "") === String(selection.id); });
    if(plan) return renderWorkFocusedPlan(plan);
  } else if(selection.kind === "one-off" && view.oneOffTasks){
    return renderWorkFocusedOneOff(view.oneOffTasks);
  }
  return stateMsg("empty", t("workSelectionUnavailable"));
}
function renderWorkTreeResizeHandle(){
  var handle = h("div", "goal-tree-resize");
  handle.setAttribute("data-fl-role", "goal-tree-resize");
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", t("goalTreeResize"));
  handle.setAttribute("tabindex", "0");
  var dragging = false;
  var startX = 0;
  var startWidth = workNormalizeTreeWidth(S.workTreeWidth);
  function applyFromClientX(clientX){
    workApplyTreeWidth(startWidth + (clientX - startX));
  }
  handle.addEventListener("pointerdown", function(e){
    dragging = true;
    startX = e.clientX;
    startWidth = workNormalizeTreeWidth(S.workTreeWidth);
    handle.classList.add("is-dragging");
    if(handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", function(e){
    if(!dragging) return;
    applyFromClientX(e.clientX);
  });
  handle.addEventListener("pointerup", function(){
    if(!dragging) return;
    dragging = false;
    handle.classList.remove("is-dragging");
    workScheduleReadingContextSave();
  });
  handle.addEventListener("keydown", function(e){
    var step = e.shiftKey ? 24 : 16;
    if(e.key === "ArrowLeft"){
      e.preventDefault();
      workApplyTreeWidth(workNormalizeTreeWidth(S.workTreeWidth) - step);
      workScheduleReadingContextSave();
    } else if(e.key === "ArrowRight"){
      e.preventDefault();
      workApplyTreeWidth(workNormalizeTreeWidth(S.workTreeWidth) + step);
      workScheduleReadingContextSave();
    }
  });
  return handle;
}
function renderWorkWorkbench(view, selection){
  var layout = h("div", "workbench-layout");
  layout.setAttribute("data-fl-role", "workbench-layout");
  layout.setAttribute("data-mobile-pane", S.workMobilePane || "tree");
  layout.setAttribute("style", "--goal-tree-width:" + workNormalizeTreeWidth(S.workTreeWidth) + "px");
  layout.appendChild(renderWorkPortfolio(view, selection));
  layout.appendChild(renderWorkTreeResizeHandle());
  var focused = h("div", "work-focused-column");
  focused.setAttribute("data-fl-role", "goal-file-host");
  focused.appendChild(renderWorkFocusedWorkspace(view, selection));
  focused.appendChild(renderWorkAdvanced(view, selection));
  layout.appendChild(focused);
  return layout;
}
function renderWorkPlanLane(plan, isIndependent){
  var planId = plan.planId || "";
  var defaultExpanded = workPlanDefaultExpanded(plan);
  var expanded = workLaneExpanded(workCollapse, "plan", planId, defaultExpanded);
  var lane = h("div", "work-lane work-plan-lane");
  lane.setAttribute("data-lane-kind", "plan");
  lane.setAttribute("data-fl-role", "work-plan-lane");
  lane.setAttribute("data-plan-id", planId);
  if(isIndependent) lane.setAttribute("data-independent", "true");

  var bodyId = workLaneId("plan", planId);
  var toggle = h("button", "work-lane-toggle work-plan-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", bodyId);
  toggle.setAttribute("data-fl-role", "work-plan-toggle");
  toggle.addEventListener("click", function(){
    workToggleLane(workCollapse, "plan", planId, toggle, defaultExpanded);
    workScheduleReadingContextSave();
  });

  var nameWrap = h("div", "work-lane-head");
  if(isIndependent) nameWrap.appendChild(h("span", "work-lane-kind-badge", t("workIndependentPlanBadge")));
  nameWrap.appendChild(h("span", "work-lane-name", plan.name || t("workUntitledPlan")));
  toggle.appendChild(nameWrap);

  var summary = plan.summary || {};
  var pr = summary.progress || {};
  var facts = h("div", "work-lane-facts");
  appendWorkLaneNarrative(facts, summary, {});
  if(plan.objective) facts.appendChild(h("span", "work-lane-fact work-lane-objective", plan.objective));
  facts.appendChild(h("span", "work-lane-fact work-lane-progress", t("workProgressCompact", {
    completed: String(pr.completed || 0),
    total: String(pr.total || 0),
    percent: String(pr.percent || 0)
  })));
  toggle.appendChild(facts);

  lane.appendChild(toggle);
  var body = h("div", "work-lane-body");
  body.id = bodyId;
  body.hidden = !expanded;
  body.appendChild(renderWorkColumns(plan.columns || {}));
  lane.appendChild(body);
  return lane;
}
function renderWorkGoalLane(goal){
  var goalId = goal.goalId || "";
  var defaultExpanded = workGoalDefaultExpanded(goal);
  var expanded = workLaneExpanded(workCollapse, "goal", goalId, defaultExpanded);
  var lane = h("div", "work-lane work-goal-lane");
  lane.setAttribute("data-lane-kind", "goal");
  lane.setAttribute("data-fl-role", "work-goal-lane");
  lane.setAttribute("data-goal-id", goalId);

  var bodyId = workLaneId("goal", goalId);
  var toggle = h("button", "work-lane-toggle work-goal-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", bodyId);
  toggle.setAttribute("data-fl-role", "work-goal-toggle");
  toggle.addEventListener("click", function(){
    workToggleLane(workCollapse, "goal", goalId, toggle, defaultExpanded);
    workScheduleReadingContextSave();
  });

  var nameWrap = h("div", "work-lane-head");
  nameWrap.appendChild(h("span", "work-lane-name", goal.name || t("workUntitledGoal")));
  if(goal.status) nameWrap.appendChild(badge(goal.status));
  toggle.appendChild(nameWrap);

  var summary = goal.summary || {};
  var pr = summary.progress || {};
  var facts = h("div", "work-lane-facts");
  var decisionCount = workGoalDecisionCount(goal);
  var completedNoDecision = goal.status === "completed" && decisionCount === 0;
  appendWorkLaneNarrative(facts, summary, { completedNoDecision: completedNoDecision });
  facts.appendChild(h("span", "work-lane-fact work-lane-progress", t("workProgressCompact", {
    completed: String(pr.completed || 0),
    total: String(pr.total || 0),
    percent: String(pr.percent || 0)
  })));
  if(decisionCount > 0){
    facts.appendChild(h("span", "work-lane-fact work-lane-decision", t("workGoalDecision", { count: String(decisionCount) })));
  }
  toggle.appendChild(facts);

  lane.appendChild(toggle);
  var body = h("div", "work-lane-body");
  body.id = bodyId;
  body.hidden = !expanded;
  (goal.plans || []).forEach(function(plan){
    body.appendChild(renderWorkPlanLane(plan, false));
  });
  lane.appendChild(body);
  return lane;
}
function renderWorkOneOffLane(lane){
  var defaultExpanded = workOneOffDefaultExpanded(lane);
  var expanded = workLaneExpanded(workCollapse, "one-off", "tasks", defaultExpanded);
  var wrap = h("div", "work-lane work-oneoff-lane");
  wrap.setAttribute("data-lane-kind", "one-off");
  wrap.setAttribute("data-fl-role", "work-oneoff-lane");
  var summary = lane.summary || {};
  var pr = summary.progress || {};
  var cardCount = workColumnsCardCount(lane.columns || {});
  var bodyId = workLaneId("one-off", "tasks");
  var toggle = h("button", "work-lane-toggle work-oneoff-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-controls", bodyId);
  toggle.setAttribute("data-fl-role", "work-oneoff-toggle");

  var nameWrap = h("div", "work-lane-head");
  nameWrap.appendChild(h("span", "work-lane-name", t("workOneOffTasks")));
  nameWrap.appendChild(h("span", "work-lane-count", t("workOneOffCount", { count: String(cardCount) })));
  toggle.appendChild(nameWrap);

  var facts = h("div", "work-lane-facts");
  var oneOffNext = workNarrativeText(summary.nextActionMessage, summary.nextAction || t("workNoNext"));
  if(!oneOffNext) oneOffNext = t("workNoNext");
  facts.appendChild(h("span", "work-lane-fact", t("workGoalNext", { text: oneOffNext })));
  facts.appendChild(h("span", "work-lane-fact work-lane-progress", t("workProgressCompact", {
    completed: String(pr.completed || 0),
    total: String(pr.total || 0),
    percent: String(pr.percent || 0)
  })));
  toggle.appendChild(facts);

  var body = h("div", "work-lane-body");
  body.id = bodyId;
  body.hidden = !expanded;
  /* Defer the complete canonical card grid until the lane is expanded so a
   * long-lived historical one-off set does not flood the initial page. */
  var bodyFilled = false;
  function ensureOneOffBody(){
    if(bodyFilled) return;
    bodyFilled = true;
    body.appendChild(renderWorkColumns(lane.columns || {}));
  }
  if(expanded) ensureOneOffBody();
  toggle.addEventListener("click", function(){
    var next = workToggleLane(workCollapse, "one-off", "tasks", toggle, defaultExpanded);
    if(next) ensureOneOffBody();
    workScheduleReadingContextSave();
  });

  wrap.appendChild(toggle);
  wrap.appendChild(body);
  return wrap;
}
function renderWorkFilters(){
  var bar = document.createElement("details");
  bar.className = "work-filters";
  bar.setAttribute("data-fl-role", "work-filters");
  var summary = document.createElement("summary");
  summary.className = "work-filters-summary";
  summary.setAttribute("data-fl-role", "work-filters-toggle");
  var appliedCount = 0;
  var applied = S.workFilter || {};
  if(applied.project) appliedCount += 1;
  if(applied.columns && applied.columns.length) appliedCount += 1;
  if(applied.workerProfileId) appliedCount += 1;
  summary.appendChild(h("span", "work-filters-summary-title", t("workFilterSummary")));
  summary.appendChild(h("span", "work-filters-summary-hint", appliedCount
    ? t("workFilterAppliedCount", { count: String(appliedCount) })
    : t("workFilterSummaryHint")));
  bar.appendChild(summary);
  var form = document.createElement("form");
  form.className = "work-filters-form";
  form.setAttribute("data-fl-role", "work-filter-form");
  form.setAttribute("aria-label", t("workFilterLabel"));

  var draft = S.workFilterDraft || { project: "", columns: "", workerProfileId: "" };
  var presented;
  if(S.workFilterOptions.projects.length){
    presented = {
      options: S.workFilterOptions.projects.map(function(value){
        return { value: value, label: workProjectHumanLabel(value, S.workFilterOptions.projects) };
      }),
      omittedInternalCount: S.workFilterOptions.omittedInternalProjects || 0
    };
  } else {
    presented = workProjectOptionsFromView();
  }

  var projWrap = h("label", "work-filter-field", "");
  projWrap.appendChild(h("span", "work-filter-label", t("workFilterProject")));
  var projSel = document.createElement("select");
  projSel.setAttribute("data-fl-role", "work-filter-project");
  projSel.appendChild(workOption("", t("workFilterAllProjects")));
  presented.options.forEach(function(opt){
    projSel.appendChild(workOption(opt.value, opt.label));
  });
  projSel.value = draft.project;
  // Draft-only updates on change: no request fires until Apply.
  projSel.addEventListener("change", function(){
    S.workFilterDraft.project = projSel.value;
    workScheduleReadingContextSave();
  });
  projWrap.appendChild(projSel);
  if(presented.omittedInternalCount > 0){
    var omitNote = h("div", "work-filter-note dim fs11", t("workFilterInternalProjectsOmitted", {
      count: String(presented.omittedInternalCount)
    }));
    omitNote.setAttribute("data-fl-role", "work-filter-internal-note");
    projWrap.appendChild(omitNote);
  }

  var colWrap = h("label", "work-filter-field", "");
  colWrap.appendChild(h("span", "work-filter-label", t("workFilterColumn")));
  var colSel = document.createElement("select");
  colSel.setAttribute("data-fl-role", "work-filter-column");
  colSel.appendChild(workOption("", t("workFilterAllColumns")));
  WORK_COLUMN_CODES.forEach(function(code){ colSel.appendChild(workOption(code, workColumnLabel(code))); });
  colSel.value = draft.columns;
  colSel.addEventListener("change", function(){
    S.workFilterDraft.columns = colSel.value;
    workScheduleReadingContextSave();
  });
  colWrap.appendChild(colSel);

  var workerWrap = h("label", "work-filter-field", "");
  workerWrap.appendChild(h("span", "work-filter-label", t("workFilterWorker")));
  var workerSel = document.createElement("select");
  workerSel.setAttribute("data-fl-role", "work-filter-worker");
  workerSel.appendChild(workOption("", t("workFilterAllWorkers")));
  var workerIds = S.workFilterOptions.workers.length ? S.workFilterOptions.workers : workWorkerOptionsFromView();
  workerIds.forEach(function(wid){ workerSel.appendChild(workOption(wid, workWorkerOptionLabel(wid))); });
  workerSel.value = draft.workerProfileId;
  workerSel.addEventListener("change", function(){
    S.workFilterDraft.workerProfileId = workerSel.value;
    workScheduleReadingContextSave();
  });
  workerWrap.appendChild(workerSel);

  var actions = h("div", "work-filter-actions");
  var applyBtn = h("button", "btn primary sm", t("workFilterApply"));
  applyBtn.type = "submit";
  applyBtn.setAttribute("data-fl-role", "work-filter-apply");
  var resetBtn = h("button", "btn sm", t("workFilterReset"));
  resetBtn.type = "button";
  resetBtn.setAttribute("data-fl-role", "work-filter-reset");
  resetBtn.addEventListener("click", function(){ workResetFilter(); });
  actions.appendChild(applyBtn);
  actions.appendChild(resetBtn);

  form.addEventListener("submit", function(e){
    e.preventDefault();
    workApplyFilter(projSel.value, colSel.value, workerSel.value);
  });

  form.appendChild(projWrap);
  form.appendChild(colWrap);
  form.appendChild(workerWrap);
  form.appendChild(actions);
  bar.appendChild(form);
  return bar;
}
function workApplyFilter(project, columns, workerProfileId){
  S.workFilterDraft = { project: project, columns: columns, workerProfileId: workerProfileId };
  var f = {};
  if(project) f.project = project;
  if(columns) f.columns = [columns];
  if(workerProfileId) f.workerProfileId = workerProfileId;
  S.workFilter = f;
  workScheduleReadingContextSave();
  refresh();
}
function workResetFilter(){
  S.workFilterDraft = { project: "", columns: "", workerProfileId: "" };
  S.workFilter = {};
  workScheduleReadingContextSave();
  refresh();
}
function workCardsFromColumns(columns){
  var cards = [];
  WORK_COLUMN_CODES.forEach(function(code){
    ((columns && columns[code]) || []).forEach(function(card){ cards.push(card); });
  });
  return cards;
}
function workSelectedWorkspaceData(view, selection){
  if(!view || !selection) return { kind: null, cards: [] };
  if(selection.kind === "goal"){
    var goal = (view.goals || []).find(function(item){
      return String(item.goalId || "") === String(selection.id || "");
    });
    var phase = goal ? workGoalViewedPlan(goal) : null;
    return {
      kind: "goal",
      goal: goal || null,
      phase: phase || null,
      cards: phase ? workCardsFromColumns(phase.columns) : []
    };
  }
  if(selection.kind === "plan"){
    var plan = (view.independentPlans || []).find(function(item){
      return String(item.planId || "") === String(selection.id || "");
    });
    return { kind: "plan", plan: plan || null, cards: plan ? workCardsFromColumns(plan.columns) : [] };
  }
  var oneOff = view.oneOffTasks || null;
  return { kind: "one-off", oneOff: oneOff, cards: oneOff ? workCardsFromColumns(oneOff.columns) : [] };
}
function workExpertWorkerProfile(card){
  var id = card && card.workerProfileId;
  var profiles = S.hub && S.hub.workerProfiles && S.hub.workerProfiles.profiles;
  if(!id || !Array.isArray(profiles)) return null;
  return profiles.find(function(profile){ return String(profile.id || "") === String(id); }) || null;
}
function workExpertEffortText(value){
  var keys = {
    low: "workersEffortLow",
    medium: "workersEffortMedium",
    high: "workersEffortHigh",
    xhigh: "workersEffortXHigh",
    max: "workersEffortMax"
  };
  return keys[value] ? t(keys[value]) : t("workExpertInherited");
}
function workExpertWorkerTuning(profile){
  if(!profile) return t("workExpertTuningUnavailable");
  var advanced = profile.advancedPolicy && typeof profile.advancedPolicy === "object"
    ? profile.advancedPolicy : {};
  var parts = [];
  var effort = workExpertEffortText(profile.effort);
  parts.push(t("workExpertTuningEffort", { value: String(effort) }));
  var budget = profile.maxBudgetUsd === null
    ? t("workExpertUnlimited")
    : (profile.maxBudgetUsd === undefined ? t("workExpertInherited") : String(profile.maxBudgetUsd));
  parts.push(t("workExpertTuningBudget", { value: budget }));
  var noProgress = advanced.noProgressTimeoutMs !== undefined
    ? advanced.noProgressTimeoutMs : profile.noProgressTimeoutMs;
  if(noProgress !== undefined){
    parts.push(t("workExpertTuningNoProgress", {
      value: noProgress === null
        ? t("workExpertUnlimited") : readableDuration(noProgress)
    }));
  }
  if(advanced.baseMaxAttempts !== undefined || advanced.maxExtraAttempts !== undefined){
    parts.push(t("workExpertTuningAttempts", {
      base: advanced.baseMaxAttempts === undefined ? t("workExpertInherited") : String(advanced.baseMaxAttempts),
      extra: advanced.maxExtraAttempts === undefined ? t("workExpertInherited") : String(advanced.maxExtraAttempts)
    }));
  }
  if(advanced.maxAdaptationRounds !== undefined){
    parts.push(t("workExpertTuningAdaptation", { value: String(advanced.maxAdaptationRounds) }));
  }
  if(profile.contractQuality && typeof profile.contractQuality === "object"
    && profile.contractQuality.mode){
    parts.push(t("workExpertTuningQuality", { value: String(profile.contractQuality.mode) }));
  }
  return parts.join(" · ");
}
function renderWorkExpertTaskRecord(card){
  var record = h("section", "work-expert-task");
  var head = h("div", "work-expert-task-head");
  head.appendChild(h("strong", "work-expert-task-name", card.name || t("taskUntitled")));
  head.appendChild(h("span", "work-expert-task-status", workColumnLabel(card.column)));
  record.appendChild(head);
  var facts = h("div", "work-expert-task-facts");
  facts.appendChild(hd("div", "work-expert-row", [
    h("span", "work-expert-label", t("workExpertTaskId")),
    h("code", "work-expert-value", String(card.taskId || "-"))
  ]));
  facts.appendChild(hd("div", "work-expert-row", [
    h("span", "work-expert-label", t("workExpertProvider")),
    h("span", "work-expert-value", String(card.provider || "-") + " / " + String(card.model || "-"))
  ]));
  facts.appendChild(hd("div", "work-expert-row", [
    h("span", "work-expert-label", t("workExpertRuntime")),
    h("span", "work-expert-value", String(card.runtime || "-"))
  ]));
  var profile = workExpertWorkerProfile(card);
  facts.appendChild(hd("div", "work-expert-row", [
    h("span", "work-expert-label", t("workExpertWorker")),
    h("span", "work-expert-value", String(card.workerProfileId || t("workExpertNotRecorded")))
  ]));
  facts.appendChild(hd("div", "work-expert-row work-expert-tuning-row", [
    h("span", "work-expert-label", t("workExpertTuning")),
    h("span", "work-expert-value", workExpertWorkerTuning(profile))
  ]));
  var policy = card.actionPolicy && card.actionPolicy.destinations;
  var policyCount = policy && typeof policy === "object" ? Object.keys(policy).length : 0;
  facts.appendChild(hd("div", "work-expert-row", [
    h("span", "work-expert-label", t("workExpertPolicy")),
    h("span", "work-expert-value", policyCount
      ? t("workExpertPolicyRecorded", { count: String(policyCount) })
      : t("workExpertPolicyUnavailable"))
  ]));
  record.appendChild(facts);
  var actions = h("div", "work-expert-actions");
  var openTask = h("button", "btn sm", t("workExpertOpenTask"));
  openTask.type = "button";
  openTask.setAttribute("data-fl-role", "work-expert-open-task");
  openTask.addEventListener("click", function(){
    taskDetailActiveTab = "more";
    showTask(card.taskId, card.breadcrumb);
  });
  actions.appendChild(openTask);
  if(profile && profile.id){
    var openWorker = h("button", "btn sm", t("workExpertOpenWorker"));
    openWorker.type = "button";
    openWorker.setAttribute("data-fl-role", "work-expert-open-worker");
    openWorker.addEventListener("click", function(){ switchTab("worker"); });
    actions.appendChild(openWorker);
  }
  record.appendChild(actions);
  return record;
}
/* Technical evidence is deliberately local and closed. It reads only the
 * existing Work projection and opens existing Task/Worker surfaces; it has no
 * mutation path and never changes authority or a Core-owned policy. */
function renderWorkAdvanced(view, selection){
  var details = document.createElement("details");
  details.className = "work-expert-details work-advanced";
  details.setAttribute("data-fl-role", "work-advanced");
  details.setAttribute("data-work-role", "expert-details");
  var summary = document.createElement("summary");
  var summaryText = h("span", "work-expert-summary-text");
  summaryText.appendChild(h("span", "work-expert-summary-title", t("workExpertDetailsTitle")));
  summaryText.appendChild(h("span", "work-expert-summary-hint", t("workExpertDetailsShort")));
  summary.appendChild(summaryText);
  details.appendChild(summary);
  var body = h("div", "work-advanced-body");
  body.appendChild(h("div", "work-expert-purpose", t("workExpertDetailsHint")));
  var data = workSelectedWorkspaceData(view, selection);
  var facts = h("div", "work-expert-facts");
  if(data.goal){
    facts.appendChild(hd("div", "work-expert-row", [
      h("span", "work-expert-label", t("workExpertGoalId")),
      h("code", "work-expert-value", String(data.goal.goalId || "-"))
    ]));
    if(data.phase){
      facts.appendChild(hd("div", "work-expert-row", [
        h("span", "work-expert-label", t("workExpertPhaseId")),
        h("code", "work-expert-value", String(data.phase.planId || "-"))
      ]));
    }
  }
  if(data.plan && data.plan.planId){
    facts.appendChild(hd("div", "work-expert-row", [
      h("span", "work-expert-label", t("workExpertPhaseId")),
      h("code", "work-expert-value", String(data.plan.planId))
    ]));
  }
  if(data.oneOff){
    facts.appendChild(hd("div", "work-expert-row", [
      h("span", "work-expert-label", t("workExpertScope")),
      h("span", "work-expert-value", t("workExpertOneOffScope"))
    ]));
  }
  if(data.cards && data.cards.length){
    facts.appendChild(hd("div", "work-expert-row", [
      h("span", "work-expert-label", t("workExpertRawEvidence")),
      h("span", "work-expert-value", t("workExpertRawEvidenceHint"))
    ]));
  }
  if(facts.childNodes.length) body.appendChild(facts);
  var taskRecords = h("div", "work-expert-task-list");
  taskRecords.setAttribute("data-fl-role", "work-expert-task-list");
  var selectedCard = null;
  if(S.detailTaskId){
    selectedCard = (data.cards || []).find(function(card){
      return String(card.taskId || card.id || "") === String(S.detailTaskId);
    }) || null;
  }
  if(selectedCard){
    taskRecords.appendChild(renderWorkExpertTaskRecord(selectedCard));
    body.appendChild(taskRecords);
  }
  if(!selectedCard){
    body.appendChild(h("div", "work-expert-empty", data.kind === "one-off"
      ? t("workExpertOneOffHint") : t("workExpertSelectTaskHint")));
  }
  var legacyHint = h("div", "work-expert-legacy-hint", t("workExpertLegacyHint"));
  body.appendChild(legacyHint);
  var openLegacy = h("button", "btn sm", t("workAdvancedOpenSubmit"));
  openLegacy.type = "button";
  openLegacy.setAttribute("data-fl-role", "work-advanced-submit");
  openLegacy.addEventListener("click", function(){ switchTab("tasks", { legacy: true }); });
  body.appendChild(hd("div", "actions", [openLegacy]));
  details.appendChild(body);
  return details;
}

/* -------------------------------------------------------------------------
 * FL-112F session-only Work reading context
 *
 * This adapter deliberately stores a small allow-list rather than cloning
 * Work or Task data. Project filters are represented by their visible option
 * label, never by the underlying path. Every value is bounded here and then
 * checked against the newly loaded canonical hierarchy before use.
 * ------------------------------------------------------------------------- */
function workReadingSafeString(value, max){
  if(typeof value !== "string") return "";
  if(value.length > (max || WORK_READING_CONTEXT_MAX_ID_CHARS)) return "";
  if(/[^\S\r\n]/.test(value.charAt(0)) || /[\u0000-\u001f\u007f]/.test(value)) return "";
  return value;
}
function workReadingSafeNumber(value){
  if(typeof value !== "number" || !Number.isFinite(value)) return 0;
  if(value < 0 || value > 50000000) return 0;
  return Math.floor(value);
}
function workReadingOptionalNumber(value){
  if(typeof value !== "number" || !Number.isFinite(value)) return null;
  if(value < 0 || value > 50000000) return null;
  return Math.floor(value);
}
function workReadingSafeFilterPart(value, max){
  if(typeof value !== "string") return "";
  if(value === "") return "";
  if(/^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/])/.test(value)) return "";
  return workReadingSafeString(value, max);
}
function workReadingNormalizeFilter(raw){
  var out = { projectLabel: "", column: "", workerProfileId: "" };
  if(!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  out.projectLabel = workReadingSafeFilterPart(raw.projectLabel, 160);
  if(typeof raw.column === "string" && WORK_COLUMN_CODES.indexOf(raw.column) >= 0){
    out.column = raw.column;
  }
  out.workerProfileId = workReadingSafeFilterPart(raw.workerProfileId, WORK_READING_CONTEXT_MAX_ID_CHARS);
  return out;
}
function workReadingNormalizeRecord(raw){
  if(!raw || typeof raw !== "object" || Array.isArray(raw)
    || raw.version !== WORK_READING_CONTEXT_VERSION) return null;
  var record = {
    version: WORK_READING_CONTEXT_VERSION,
    workspace: null,
    phase: null,
    disclosures: {},
    collapse: {},
    detail: { open: false, taskId: "", tab: "overview" },
    filters: { applied: workReadingNormalizeFilter(null), draft: workReadingNormalizeFilter(null) },
    search: { oneOff: "", draft: "" },
    scroll: { contentTop: 0, contentLeft: 0, detailTop: 0, board: null },
    focusKey: "",
    outcome: null,
    selectedIntakeId: "",
    confirmingIntakeId: "",
    createdNavigate: null,
    tree: { query: "", width: 280, scope: "now" },
    pane: "tree"
  };
  if(raw.workspace && typeof raw.workspace === "object" && !Array.isArray(raw.workspace)){
    var workspaceId = workReadingSafeString(raw.workspace.id);
    if((raw.workspace.kind === "goal" || raw.workspace.kind === "plan"
      || raw.workspace.kind === "one-off") && workspaceId){
      record.workspace = { kind: raw.workspace.kind, id: workspaceId };
    }
  }
  if(raw.phase && typeof raw.phase === "object" && !Array.isArray(raw.phase)){
    var phaseGoalId = workReadingSafeString(raw.phase.goalId);
    var phasePlanId = workReadingSafeString(raw.phase.planId);
    if(phaseGoalId && phasePlanId) record.phase = { goalId: phaseGoalId, planId: phasePlanId };
  }
  if(raw.disclosures && typeof raw.disclosures === "object" && !Array.isArray(raw.disclosures)){
    WORK_READING_CONTEXT_DISCLOSURES.forEach(function(key){
      if(typeof raw.disclosures[key] === "boolean") record.disclosures[key] = raw.disclosures[key];
    });
  }
  if(raw.collapse && typeof raw.collapse === "object" && !Array.isArray(raw.collapse)){
    Object.keys(raw.collapse).filter(function(key){
      return /^[A-Za-z0-9:_-]+$/.test(key)
        && workReadingSafeString(key, WORK_READING_CONTEXT_MAX_ID_CHARS);
    }).slice(0, WORK_READING_CONTEXT_MAX_COLLAPSE).forEach(function(key){
      var safeKey = workReadingSafeString(key, WORK_READING_CONTEXT_MAX_ID_CHARS);
      if(safeKey && /^[A-Za-z0-9:_-]+$/.test(safeKey) && typeof raw.collapse[key] === "boolean"){
        record.collapse[safeKey] = raw.collapse[key];
      }
    });
  }
  if(raw.detail && typeof raw.detail === "object" && !Array.isArray(raw.detail)){
    if(typeof raw.detail.open === "boolean") record.detail.open = raw.detail.open;
    var detailId = workReadingSafeString(raw.detail.taskId);
    if(detailId) record.detail.taskId = detailId;
    if(typeof raw.detail.tab === "string" && WORK_READING_CONTEXT_TABS.indexOf(raw.detail.tab) >= 0){
      record.detail.tab = raw.detail.tab;
    }
  }
  if(raw.filters && typeof raw.filters === "object" && !Array.isArray(raw.filters)){
    record.filters.applied = workReadingNormalizeFilter(raw.filters.applied);
    record.filters.draft = workReadingNormalizeFilter(raw.filters.draft);
  }
  if(raw.search && typeof raw.search === "object" && !Array.isArray(raw.search)){
    record.search.oneOff = workReadingSafeString(raw.search.oneOff, 120);
    record.search.draft = workReadingSafeString(raw.search.draft, 120);
  }
  if(raw.scroll && typeof raw.scroll === "object" && !Array.isArray(raw.scroll)){
    record.scroll.contentTop = workReadingSafeNumber(raw.scroll.contentTop);
    record.scroll.contentLeft = workReadingSafeNumber(raw.scroll.contentLeft);
    record.scroll.detailTop = workReadingSafeNumber(raw.scroll.detailTop);
    if(raw.scroll.board && typeof raw.scroll.board === "object" && !Array.isArray(raw.scroll.board)){
      var boardKey = workReadingSafeString(raw.scroll.board.key, 320);
      var boardLeft = workReadingOptionalNumber(raw.scroll.board.left);
      if(boardKey && boardLeft !== null){
        record.scroll.board = {
          key: boardKey,
          left: boardLeft
        };
      }
    }
  }
  record.focusKey = workReadingSafeString(raw.focusKey, 240);
  /* FL-112E9: bounded outcome draft fields, the selected intake, the open
   * confirmation step, and the created-navigation intent all survive a hard
   * reload. Only bounded user draft text is stored; display copy is rehydrated
   * from canonical truth. */
  if(raw.outcome && typeof raw.outcome === "object" && !Array.isArray(raw.outcome)){
    var draftOutcome = workReadingSafeString(raw.outcome.outcome, 2000);
    var draftProject = workReadingSafeString(raw.outcome.project, 200);
    var draftContext = workReadingSafeString(raw.outcome.context, 2000);
    var draftShape = raw.outcome.requestedShape;
    if(draftOutcome && ["auto", "task", "plan", "goal"].indexOf(draftShape) >= 0){
      record.outcome = {
        outcome: draftOutcome,
        project: draftProject,
        context: draftContext,
        requestedShape: draftShape
      };
    }
  }
  var selectedIntakeId = workReadingSafeString(raw.selectedIntakeId, WORK_READING_CONTEXT_MAX_ID_CHARS);
  if(selectedIntakeId) record.selectedIntakeId = selectedIntakeId;
  var confirmingIntakeId = workReadingSafeString(raw.confirmingIntakeId, WORK_READING_CONTEXT_MAX_ID_CHARS);
  if(confirmingIntakeId) record.confirmingIntakeId = confirmingIntakeId;
  if(raw.createdNavigate && typeof raw.createdNavigate === "object" && !Array.isArray(raw.createdNavigate)){
    var navIntakeId = workReadingSafeString(raw.createdNavigate.intakeId, WORK_READING_CONTEXT_MAX_ID_CHARS);
    var navShape = raw.createdNavigate.shape;
    if(navIntakeId && (navShape === "goal" || navShape === "plan" || navShape === "task")){
      record.createdNavigate = {
        intakeId: navIntakeId,
        shape: navShape,
        goalId: workReadingSafeString(raw.createdNavigate.goalId, WORK_READING_CONTEXT_MAX_ID_CHARS),
        planId: workReadingSafeString(raw.createdNavigate.planId, WORK_READING_CONTEXT_MAX_ID_CHARS),
        taskId: workReadingSafeString(raw.createdNavigate.taskId, WORK_READING_CONTEXT_MAX_ID_CHARS)
      };
    }
  }
  if(raw.tree && typeof raw.tree === "object" && !Array.isArray(raw.tree)){
    record.tree.query = workReadingSafeString(raw.tree.query, 120);
    var treeWidth = typeof raw.tree.width === "number" ? raw.tree.width : parseInt(raw.tree.width, 10);
    if(!isFinite(treeWidth)) treeWidth = 280;
    if(treeWidth < 200) treeWidth = 200;
    if(treeWidth > 420) treeWidth = 420;
    record.tree.width = Math.round(treeWidth);
    record.tree.scope = raw.tree.scope === "history" ? "history" : "now";
  }
  if(raw.pane === "file" || raw.pane === "detail" || raw.pane === "tree") record.pane = raw.pane;
  return record;
}
function workReadSessionContext(){
  try {
    if(typeof sessionStorage === "undefined") return null;
    var raw = sessionStorage.getItem(WORK_READING_CONTEXT_KEY);
    if(!raw) return null;
    if(typeof raw !== "string" || raw.length > WORK_READING_CONTEXT_MAX_CHARS){
      try { sessionStorage.removeItem(WORK_READING_CONTEXT_KEY); } catch(__){ }
      return null;
    }
    var parsed;
    try { parsed = JSON.parse(raw); } catch(_){
      try { sessionStorage.removeItem(WORK_READING_CONTEXT_KEY); } catch(__){ }
      return null;
    }
    var record = workReadingNormalizeRecord(parsed);
    if(record) return record;
    try { sessionStorage.removeItem(WORK_READING_CONTEXT_KEY); } catch(_){ }
  } catch(_){ }
  return null;
}
function workWriteSessionContext(record){
  if(!record) return;
  try {
    if(typeof sessionStorage === "undefined") return;
    var serialized = JSON.stringify(record);
    if(serialized.length > WORK_READING_CONTEXT_MAX_CHARS) return;
    sessionStorage.setItem(WORK_READING_CONTEXT_KEY, serialized);
  } catch(_){ }
}
function workReadingProjectLabel(project){
  if(typeof project !== "string" || !project) return "";
  var projects = (S.workFilterOptions && S.workFilterOptions.projects) || [];
  if(projects.indexOf(project) < 0) return "";
  return workReadingSafeString(workProjectHumanLabel(project, projects), 160);
}
function workReadingFilterRecord(filter){
  filter = filter || {};
  var column = Array.isArray(filter.columns) ? filter.columns[0] : filter.columns;
  return {
    projectLabel: workReadingProjectLabel(filter.project),
    column: WORK_COLUMN_CODES.indexOf(column) >= 0 ? column : "",
    workerProfileId: workReadingSafeString(filter.workerProfileId, WORK_READING_CONTEXT_MAX_ID_CHARS)
  };
}
function workReadingFilterSignature(filter){
  filter = filter || {};
  var cols = Array.isArray(filter.columns) ? filter.columns : [];
  return String(filter.project || "") + "|" + String(cols[0] || "")
    + "|" + String(filter.workerProfileId || "");
}
function workReadingProjectFromLabel(label){
  if(!label) return "";
  var projects = (S.workFilterOptions && S.workFilterOptions.projects) || [];
  var matches = projects.filter(function(project){
    return workProjectHumanLabel(project, projects) === label;
  });
  return matches.length === 1 ? matches[0] : "";
}
function workReadingFilterFromRecord(record){
  record = workReadingNormalizeFilter(record);
  var out = {};
  var project = workReadingProjectFromLabel(record.projectLabel);
  if(project) out.project = project;
  if(record.column) out.columns = [record.column];
  if(record.workerProfileId
    && (S.workFilterOptions.workers || []).indexOf(record.workerProfileId) >= 0){
    out.workerProfileId = record.workerProfileId;
  }
  return out;
}
function workReadingDraftFromRecord(record){
  record = workReadingNormalizeFilter(record);
  return {
    project: workReadingProjectFromLabel(record.projectLabel),
    columns: record.column || "",
    workerProfileId: record.workerProfileId
      && (S.workFilterOptions.workers || []).indexOf(record.workerProfileId) >= 0
      ? record.workerProfileId : ""
  };
}
/* Phase identity bound to the board scroll key: the explicit viewed Plan when
 * the user clicked one, otherwise the effective canonical phase for the
 * selected Goal. A terminal Goal showing its default last phase is therefore
 * stored as a real phase, so a matching manual board scroll survives reload
 * instead of being classified as a new phase. */
function workEffectiveGoalPhaseId(){
  if(!S.workSelection || S.workSelection.kind !== "goal") return "";
  var phaseId = String(S.workViewedPlanId || "");
  if(phaseId) return phaseId;
  try {
    var view = normalizeWorkHierarchy(S.workHierarchy);
    var goal = (view.goals || []).find(function(item){
      return String(item.goalId || "") === String(S.workSelection.id || "");
    });
    var plan = goal && workEffectiveGoalPlan(goal);
    return String(plan && plan.planId || "");
  } catch(_){ return ""; }
}
function workReadingBoardKey(){
  return workSelectionKey(S.workSelection) + "|phase:" + workEffectiveGoalPhaseId();
}
function workReadingCollapseRecord(){
  var out = {};
  if(!workCollapse || typeof workCollapse !== "object") return out;
  Object.keys(workCollapse).sort().slice(0, WORK_READING_CONTEXT_MAX_COLLAPSE).forEach(function(key){
    if(/^[A-Za-z0-9:_-]+$/.test(key) && typeof workCollapse[key] === "boolean"){
      out[key] = workCollapse[key];
    }
  });
  return out;
}
function workBuildSessionContext(){
  var captured = workCaptureWorkbenchContext();
  var selection = S.workSelection && workReadingSafeString(S.workSelection.id)
    ? { kind: S.workSelection.kind, id: workReadingSafeString(S.workSelection.id) } : null;
  /* Persist the phase actually visible for a selected Goal, not just an
   * explicitly clicked one. The effective phase matches the board-scroll key,
   * so a reload restores the same phase before rWork compares selection state
   * and the saved manual board position is not invalidated as a "change". */
  var phase = null;
  if(S.workSelection && S.workSelection.kind === "goal"){
    var effectivePhaseId = workEffectiveGoalPhaseId();
    if(effectivePhaseId){
      phase = {
        goalId: workReadingSafeString(S.workSelection.id),
        planId: workReadingSafeString(effectivePhaseId)
      };
    }
  }
  var detailId = workReadingSafeString(captured.detailTaskId);
  var detailTab = WORK_READING_CONTEXT_TABS.indexOf(captured.detailTab) >= 0
    ? captured.detailTab : "overview";
  var record = {
    version: WORK_READING_CONTEXT_VERSION,
    workspace: selection,
    phase: phase,
    disclosures: {},
    collapse: workReadingCollapseRecord(),
    detail: { open: !!captured.detailOpen && !!detailId, taskId: detailId, tab: detailTab },
    filters: {
      applied: workReadingFilterRecord(S.workFilter),
      draft: workReadingFilterRecord(S.workFilterDraft)
    },
    search: {
      oneOff: workReadingSafeString(S.workOneOffSearch, 120),
      draft: workReadingSafeString(S.workOneOffSearchDraft, 120)
    },
    scroll: {
      contentTop: workReadingSafeNumber(captured.contentScrollTop),
      contentLeft: workReadingSafeNumber(captured.contentScrollLeft),
      detailTop: workReadingSafeNumber(workReloadDetailScrollTop === null
        ? captured.detailScrollTop : workReloadDetailScrollTop),
      board: captured.boardScrollCaptured ? {
        key: workReadingBoardKey(),
        left: workReadingSafeNumber(captured.boardScrollLeft)
      } : null
    },
    focusKey: workReadingSafeString(captured.focusKey, 240),
    outcome: workReadingOutcomeRecord(),
    selectedIntakeId: workReadingSafeString(S.selectedIntakeId || "", WORK_READING_CONTEXT_MAX_ID_CHARS),
    confirmingIntakeId: workReadingSafeString(S.outcomeConfirmingId || "", WORK_READING_CONTEXT_MAX_ID_CHARS),
    createdNavigate: workReadingCreatedNavigateRecord(),
    tree: {
      query: workReadingSafeString(String(S.workTreeQuery || ""), 120),
      width: (function(px){
        var n = typeof px === "number" ? px : parseInt(px, 10);
        if(!isFinite(n)) return 280;
        if(n < 200) return 200;
        if(n > 420) return 420;
        return Math.round(n);
      })(S.workTreeWidth),
      scope: S.workTreeScope === "history" ? "history" : "now"
    },
    pane: S.workMobilePane === "file" || S.workMobilePane === "detail" ? S.workMobilePane : "tree"
  };
  WORK_READING_CONTEXT_DISCLOSURES.forEach(function(key){
    record.disclosures[key] = !!captured[key];
  });
  return record;
}
/* Bounded outcome draft record: only the user's bounded draft fields survive a
 * reload; display copy and proposal facts are rehydrated from canonical truth. */
function workReadingOutcomeRecord(){
  var draft = S.outcomeDraft || {};
  var outcome = workReadingSafeString(String(draft.outcome || ""), 2000);
  if(!outcome) return null;
  var requestedShape = draft.requestedShape;
  if(["auto", "task", "plan", "goal"].indexOf(requestedShape) < 0) requestedShape = "auto";
  return {
    outcome: outcome,
    project: workReadingSafeString(String(draft.project || ""), 200),
    context: workReadingSafeString(String(draft.context || ""), 2000),
    requestedShape: requestedShape
  };
}
/* Bounded created-navigation intent. Only ids and one shape enum survive; the
 * exact workspace is decided later against the refreshed hierarchy. */
function workReadingCreatedNavigateRecord(){
  var intent = S.outcomeCreatedNavigate;
  if(!intent || !intent.intakeId) return null;
  var shape = intent.shape;
  if(["goal", "plan", "task"].indexOf(shape) < 0) return null;
  return {
    intakeId: workReadingSafeString(intent.intakeId, WORK_READING_CONTEXT_MAX_ID_CHARS),
    shape: shape,
    goalId: workReadingSafeString(intent.goalId || "", WORK_READING_CONTEXT_MAX_ID_CHARS),
    planId: workReadingSafeString(intent.planId || "", WORK_READING_CONTEXT_MAX_ID_CHARS),
    taskId: workReadingSafeString(intent.taskId || "", WORK_READING_CONTEXT_MAX_ID_CHARS)
  };
}
function workPersistReadingContext(){
  if(!workReadingContextReady || S.tab !== "work" || !S.workHierarchy) return;
  try { workWriteSessionContext(workBuildSessionContext()); } catch(_){ }
}
function workScheduleReadingContextSave(){
  /* Writes are intentionally synchronous and tiny: a browser reload can happen
   * immediately after a disclosure/scroll interaction, and storage failures are
   * already contained by the adapter. */
  workPersistReadingContext();
}
function workReadingTaskExists(view, taskId){
  if(!view || !taskId) return false;
  var found = false;
  workCollectCards(view, function(card){
    if(String(card.taskId || card.id || "") === String(taskId)) found = true;
  });
  return found;
}
/* Return the exact canonical card for a validated Task id, or null. Used only
 * to restore presentation input (the card's existing breadcrumb) for a reloaded
 * Task drawer; no name or ancestry is ever persisted or invented. */
function workFindTaskCard(view, taskId){
  var found = null;
  if(!view || !taskId) return found;
  workCollectCards(view, function(card){
    if(!found && String(card.taskId || card.id || "") === String(taskId)) found = card;
  });
  return found;
}
function workReadingGoalExists(view, goalId){
  return !!view && (view.goals || []).some(function(goal){
    return String(goal.goalId || "") === String(goalId || "");
  });
}
function workReadingPlanExists(view, planId){
  if(!view) return false;
  if((view.independentPlans || []).some(function(plan){
    return String(plan.planId || "") === String(planId || "");
  })) return true;
  return (view.goals || []).some(function(goal){
    return (goal.plans || []).some(function(plan){
      return String(plan.planId || "") === String(planId || "");
    });
  });
}
function workReadingPhaseExists(view, goalId, planId){
  var goal = view && (view.goals || []).find(function(item){
    return String(item.goalId || "") === String(goalId || "");
  });
  return !!(goal && (goal.plans || []).some(function(plan){
    return String(plan.planId || "") === String(planId || "");
  }));
}
function workReadingCollapseKeyExists(view, key){
  var parts = String(key || "").split(":");
  var kind = parts.shift();
  var id = parts.join(":");
  if(kind === "focused-goal") return workReadingGoalExists(view, id);
  if(kind === "goal") return workReadingGoalExists(view, id);
  if(kind === "plan") return workReadingPlanExists(view, id);
  return kind === "one-off" && id === "tasks" && !!(view && view.oneOffTasks);
}
function workApplyReadingCollapse(view, record){
  if(workCollapse === null) workCollapse = workCollapseLoad();
  if(!record || !Object.prototype.hasOwnProperty.call(record, "collapse")) return;
  var next = {};
  Object.keys(record.collapse || {}).slice(0, WORK_READING_CONTEXT_MAX_COLLAPSE).forEach(function(key){
    if(typeof record.collapse[key] === "boolean" && workReadingCollapseKeyExists(view, key)){
      next[key] = record.collapse[key];
    }
  });
  workCollapse = next;
  workCollapseSave(workCollapse);
}
function workReadingFocusExists(view, key){
  if(!key) return false;
  if(key.indexOf("task:") === 0 || key.indexOf("action:") === 0){
    return workReadingTaskExists(view, key.slice(key.indexOf(":") + 1));
  }
  if(key.indexOf("goal-toggle:") === 0){
    return workReadingGoalExists(view, key.slice("goal-toggle:".length));
  }
  if(key.indexOf("plan-toggle:") === 0){
    return workReadingPlanExists(view, key.slice("plan-toggle:".length));
  }
  if(key.indexOf("phase:") === 0){
    var phase = key.slice("phase:".length).split(":");
    return phase.length >= 2 && workReadingPhaseExists(view, phase.shift(), phase.join(":"));
  }
  if(key.indexOf("workspace:") === 0){
    var workspace = key.slice("workspace:".length).split(":");
    return workspace.length >= 2 && workSelectionExists(view, workMakeSelection(workspace.shift(), workspace.join(":")));
  }
  if(key.indexOf("intake-row:") === 0){
    var intakeId = key.slice("intake-row:".length);
    return Array.isArray(S.intakes) && S.intakes.some(function(item){ return String(item.id || "") === intakeId; });
  }
  return [
    "goal-toggle", "oneoff-toggle", "finished-toggle", "filter-project", "filter-column",
    "filter-worker", "filter-apply", "filter-reset", "outcome-text", "outcome-project",
    "outcome-context", "outcome-shape", "outcome-submit", "outcome-advanced", "work-advanced",
    "work-shape-guide-toggle", "work-filters-toggle", "oneoff-current-toggle",
    "oneoff-attention-toggle", "oneoff-history-toggle", "oneoff-search", "page-story-toggle"
  ].indexOf(key) >= 0;
}
function workReadingContextToContinuity(view, record){
  var out = {
    finishedOpen: false, advancedOpen: false, expertDetailsOpen: false, goalSummaryOpen: false,
    filtersOpen: false, oneOffCurrentOpen: false, oneOffAttentionOpen: false,
    oneOffHistoryOpen: false, shapeGuideOpen: false, pageStoryOpen: false,
    outcomeAdvancedOpen: false, focusKey: null, contentScrollTop: 0, contentScrollLeft: 0,
    boardScrollLeft: 0, boardScrollCaptured: false, detailOpen: false,
    detailTaskId: null, detailTab: null, detailScrollTop: 0,
    treeWidth: 280, treeQuery: "", treeScope: "now",
    mobilePane: "tree", goalFileEvidenceOpen: false, treeScrollTop: 0, fileScrollTop: 0
  };
  if(!record) return out;
  var disclosures = record.disclosures || {};
  WORK_READING_CONTEXT_DISCLOSURES.forEach(function(key){
    if(typeof disclosures[key] === "boolean") out[key] = disclosures[key];
  });
  out.contentScrollTop = workReadingSafeNumber(record.scroll && record.scroll.contentTop);
  out.contentScrollLeft = workReadingSafeNumber(record.scroll && record.scroll.contentLeft);
  out.detailScrollTop = workReadingSafeNumber(record.scroll && record.scroll.detailTop);
  if(record.scroll && record.scroll.board && record.scroll.board.key === workReadingBoardKey()){
    out.boardScrollLeft = workReadingSafeNumber(record.scroll.board.left);
    out.boardScrollCaptured = true;
    workReloadBoardScrollRestored = true;
  }
  if(record.focusKey && workReadingFocusExists(view, record.focusKey)) out.focusKey = record.focusKey;
  if(record.detail && record.detail.open && workReadingTaskExists(view, record.detail.taskId)){
    out.detailOpen = true;
    out.detailTaskId = record.detail.taskId;
    out.detailTab = WORK_READING_CONTEXT_TABS.indexOf(record.detail.tab) >= 0
      ? record.detail.tab : "overview";
  }
  if(record.tree){
    out.treeQuery = workReadingSafeString(record.tree.query, 120);
    var continuityWidth = typeof record.tree.width === "number" ? record.tree.width : parseInt(record.tree.width, 10);
    if(!isFinite(continuityWidth)) continuityWidth = 280;
    if(continuityWidth < 200) continuityWidth = 200;
    if(continuityWidth > 420) continuityWidth = 420;
    out.treeWidth = Math.round(continuityWidth);
    out.treeScope = record.tree.scope === "history" ? "history" : "now";
  }
  if(record.pane === "file" || record.pane === "detail" || record.pane === "tree"){
    out.mobilePane = record.pane;
  }
  return out;
}
function workApplySavedReadingContext(){
  if(workReadingContextApplied) return false;
  var view;
  try { view = normalizeWorkHierarchy(S.workHierarchy); } catch(_){ return false; }
  workReadingContextApplied = true;
  var record = workReadingContextPending;
  workReadingContextPending = null;
  workReadingContextReady = true;
  workReloadBoardScrollRestored = false;
  S.workViewedGoalId = null;
  S.workViewedPlanId = null;
  workRefreshFilterOptions(view);
  if(!record){
    S.workSelection = null;
    S.workOneOffSearch = "";
    S.workOneOffSearchDraft = "";
    workInitialSelectionNeedsFocus = true;
    return false;
  }
  var validWorkspace = !!(record.workspace
    && workSelectionExists(view, workMakeSelection(record.workspace.kind, record.workspace.id)));
  if(validWorkspace){
    S.workSelection = workMakeSelection(record.workspace.kind, record.workspace.id);
  } else {
    S.workSelection = null;
  }
  workInitialSelectionNeedsFocus = !validWorkspace;
  if(validWorkspace && S.workSelection.kind === "goal" && record.phase
    && String(record.phase.goalId) === String(S.workSelection.id)
    && workReadingPhaseExists(view, record.phase.goalId, record.phase.planId)){
    S.workViewedGoalId = String(record.phase.goalId);
    S.workViewedPlanId = String(record.phase.planId);
  }
  workApplyReadingCollapse(view, record);
  var savedApplied = workReadingFilterFromRecord(record.filters && record.filters.applied);
  var savedDraft = workReadingDraftFromRecord(record.filters && record.filters.draft);
  S.workFilter = savedApplied;
  S.workFilterDraft = savedDraft;
  S.workOneOffSearch = workReadingSafeString(record.search && record.search.oneOff, 120);
  S.workOneOffSearchDraft = workReadingSafeString(record.search && record.search.draft, 120);
  if(record.tree){
    S.workTreeQuery = workReadingSafeString(record.tree.query, 120);
    var savedWidth = typeof record.tree.width === "number" ? record.tree.width : parseInt(record.tree.width, 10);
    if(!isFinite(savedWidth)) savedWidth = 280;
    if(savedWidth < 200) savedWidth = 200;
    if(savedWidth > 420) savedWidth = 420;
    S.workTreeWidth = Math.round(savedWidth);
    S.workTreeScope = record.tree.scope === "history" ? "history" : "now";
  }
  if(record.pane === "file" || record.pane === "detail" || record.pane === "tree"){
    S.workMobilePane = record.pane;
  }
  /* FL-112E9: restore the bounded outcome draft, the selected intake, the open
   * confirmation step, and any valid created-navigation intent. Every value is
   * checked against the canonical intake list before it becomes visible. */
  if(record.outcome){
    var restoredDraft = {
      outcome: record.outcome.outcome,
      project: record.outcome.project || "",
      context: record.outcome.context || "",
      requestedShape: record.outcome.requestedShape || "auto"
    };
    if(!S.outcomeDraft || !String(S.outcomeDraft.outcome || "").trim()){
      S.outcomeDraft = restoredDraft;
    }
  }
  var restoredSelectedIntake = "";
  if(record.selectedIntakeId && Array.isArray(S.intakes) && S.intakes.some(function(item){
    return item && String(item.id || "") === String(record.selectedIntakeId);
  })){
    restoredSelectedIntake = record.selectedIntakeId;
  }
  S.selectedIntakeId = restoredSelectedIntake || null;
  var restoredConfirming = "";
  if(record.confirmingIntakeId && Array.isArray(S.intakes) && S.intakes.some(function(item){
    return item && String(item.id || "") === String(record.confirmingIntakeId)
      && item.status === "proposed";
  })){
    restoredConfirming = record.confirmingIntakeId;
  }
  S.outcomeConfirmingId = restoredConfirming || null;
  S.outcomeConfirmError = null;
  S.outcomeCreatedNavigate = null;
  if(record.createdNavigate){
    /* The created-intake must still be canonical created truth; otherwise the
     * stale intent is discarded and the created story's retry action stays. */
    var navIntake = Array.isArray(S.intakes) ? S.intakes.find(function(item){
      return item && String(item.id || "") === String(record.createdNavigate.intakeId);
    }) : null;
    if(navIntake && navIntake.status === "created"){
      S.outcomeCreatedNavigate = {
        intakeId: record.createdNavigate.intakeId,
        shape: record.createdNavigate.shape,
        goalId: record.createdNavigate.goalId || "",
        planId: record.createdNavigate.planId || "",
        taskId: record.createdNavigate.taskId || ""
      };
    }
  }
  S.outcomeCreatedTaskDrawer = null;
  workReloadRestoreContext = workReadingContextToContinuity(view, record);
  return workReadingFilterSignature(savedApplied) !== workReadingFilterSignature({});
}
function workRestoreSavedTaskDetail(view){
  var ctx = workReloadRestoreContext;
  if(!ctx) return;
  workReloadRestoreContext = null;
  if(!ctx.detailOpen || !ctx.detailTaskId || !workReadingTaskExists(view, ctx.detailTaskId)) return;
  workReloadDetailScrollTop = workReadingSafeNumber(ctx.detailScrollTop);
  taskDetailActiveTab = WORK_READING_CONTEXT_TABS.indexOf(ctx.detailTab) >= 0
    ? ctx.detailTab : "overview";
  /* Rebuild the canonical Goal > Plan > Task breadcrumb from the exact matching
   * hierarchy card already present in WorkHierarchyView. A stale Task falls
   * back through showTask without any invented ancestry. */
  var card = workFindTaskCard(view, ctx.detailTaskId);
  showTask(ctx.detailTaskId, card && card.breadcrumb);
}
function workRestoreReadingAfterRender(view, continuity){
  /* Poll continuity remains the first path. A validated reload record is then
   * allowed to restore its own board/page position, and only after that can a
   * one-shot new-board focus run. */
  workRestoreWorkbenchContext(continuity);
  if(workReloadRestoreContext){
    workRestoreWorkbenchContext(workReloadRestoreContext);
    workRestoreSavedTaskDetail(view);
  }
  /* A freshly confirmed parentless Task opens its drawer only after the
   * Independent Tasks workspace has mounted with the canonical card. */
  workOpenCreatedTaskDrawer(view);
  workMaybeFocusRelevantColumn();
  workReloadBoardScrollRestored = false;
  workPersistReadingContext();
}

/* =========================================================================
 * FL-112A Work refresh continuity (boundary)
 * Consumes: Work hierarchy + intakes, visible tab/render state, live fetch
 *   results, open disclosures, Goal/Plan expansion (sessionStorage), focus,
 *   scroll, and S-backed filters/drafts.
 * Produces: keep-or-refresh decision; equivalent surviving Work context after
 *   a real evidence rerender.
 * Boundaries:
 *   - Never suppress a real evidence change (status, next action, structure).
 *   - Do not invent server state, credentials, or browser history.
 *   - No optimistic Task movement; missing restore targets fail safely.
 *   - Language changes and explicit operations still re-render Work.
 *   - Polling/fetch/lifecycle contracts stay unchanged for other pages.
 * ========================================================================= */

/* Pure clock / projection noise that must not force a Work DOM rebuild.
 * *At / *AtMs suffixes cover ordinary timestamps without listing raw dual-clock
 * field names as object-literal labels. Extra non-suffix names stay private. */
var WORK_TRUTH_VOLATILE_EXTRA = ["asOf", "serverTime", "now"];
function workIsVolatileTruthKey(key){
  if(!key) return false;
  if(WORK_TRUTH_VOLATILE_EXTRA.indexOf(key) >= 0) return true;
  if(/AtMs$/.test(key)) return true;
  // Timestamp fields end in At; keep non-time keys like "format".
  if(/At$/.test(key)) return true;
  return false;
}
/* Deep clone with sorted keys and volatile timestamps stripped so identical
 * polls that only churn clocks compare equal. Depth-bounded; never throws. */
function workStableTruthClone(value, depth){
  if(depth > 40) return null;
  if(value === null || value === undefined) return value;
  var typ = typeof value;
  if(typ === "number" || typ === "boolean" || typ === "string") return value;
  if(typ !== "object") return String(value);
  if(Array.isArray(value)){
    var arr = [];
    for(var i = 0; i < value.length; i++){
      arr.push(workStableTruthClone(value[i], depth + 1));
    }
    return arr;
  }
  var keys = Object.keys(value).sort();
  var out = {};
  for(var k = 0; k < keys.length; k++){
    var key = keys[k];
    if(workIsVolatileTruthKey(key)) continue;
    out[key] = workStableTruthClone(value[key], depth + 1);
  }
  return out;
}
/* Bounded visible-truth snapshot for the Work surface. Excludes wall-clock
 * chrome (footer "updated at") and relative-time churn. Includes language so
 * a locale switch is never suppressed. */
function workVisibleTruthSnapshot(){
  var lang = "zh";
  try {
    if(window.ForklightI18n && typeof window.ForklightI18n.getLang === "function"){
      lang = window.ForklightI18n.getLang() || "zh";
    }
  } catch(_){}
  var payload = {
    lang: lang,
    selection: workSelectionKey(S.workSelection),
    viewedGoal: S.workViewedGoalId || null,
    viewedPlan: S.workViewedPlanId || null,
    filter: workStableTruthClone(S.workFilter || {}, 0),
    oneOffSearch: String(S.workOneOffSearch || ""),
    hierarchy: workStableTruthClone(S.workHierarchy, 0),
    hierarchyError: S.workHierarchyError || null,
    intakes: workStableTruthClone(S.intakes, 0),
    intakesError: S.intakesError || null,
    /* FL-112E9: browser-only outcome journey state must force a rebuild when it
     * changes (opening the confirm step, selecting an intake, or queuing the
     * created-workspace navigation) without persisting display content. */
    selectedIntakeId: S.selectedIntakeId || null,
    confirmingIntakeId: S.outcomeConfirmingId || null,
    createdNavigate: workStableTruthClone(S.outcomeCreatedNavigate, 0),
    createdTaskDrawer: workStableTruthClone(S.outcomeCreatedTaskDrawer, 0),
    treeScope: S.workTreeScope === "history" ? "history" : "now",
    treeQuery: String(S.workTreeQuery || ""),
    mobilePane: S.workMobilePane || "tree",
    /* Route is part of visible truth so Work and Decision Center cannot share
     * one live mount when hierarchy cards are otherwise unchanged. */
    tab: S.tab || "work"
  };
  try {
    return JSON.stringify(payload);
  } catch(_){
    return "unserializable";
  }
}
/* True when #fl-view still holds the live mount for the current route, not
 * another page and not a loading/unavailable placeholder that wiped it. */
function workDomIsLive(){
  if(!viewEl) return false;
  try {
    var tab = S.tab || "work";
    if(tab === "decisions"){
      return !!(viewEl.querySelector('[data-fl-role="decision-center"]')
        || viewEl.querySelector('[data-fl-role="work-hierarchy-error"]'));
    }
    if(tab !== "work") return false;
    return !!(viewEl.querySelector('[data-fl-role="work-board"]')
      || viewEl.querySelector('[data-fl-role="workbench-layout"]')
      || viewEl.querySelector('[data-fl-role="goal-tree"]')
      || viewEl.querySelector('[data-fl-role="work-filters"]')
      || viewEl.querySelector('[data-fl-role="outcome-section"]')
      || viewEl.querySelector('[data-fl-role="work-hierarchy-error"]'));
  } catch(_){
    return false;
  }
}
/* Keep the live mount when route and presentation truth are unchanged. */
function workShouldRetainDom(){
  var tab = S.tab || "work";
  if(tab !== "work" && tab !== "decisions") return false;
  if(!workDomIsLive()) return false;
  if(S.workRenderSnapshot == null) return false;
  try {
    return workVisibleTruthSnapshot() === S.workRenderSnapshot;
  } catch(_){
    return false;
  }
}
/* Semantic focus key: Task/Goal/Plan/control identity, never DOM position. */
function workSemanticFocusKey(el){
  if(!el || !el.getAttribute) return null;
  var role = el.getAttribute("data-fl-role");
  if(role === "work-card"){
    var taskId = el.getAttribute("data-task-id");
    return taskId ? ("task:" + taskId) : null;
  }
  if(role === "work-goal-toggle"){
    var goalLane = el.closest ? el.closest("[data-goal-id]") : null;
    var goalId = goalLane && goalLane.getAttribute("data-goal-id");
    return goalId ? ("goal-toggle:" + goalId) : "goal-toggle";
  }
  if(role === "work-plan-toggle"){
    var planLane = el.closest ? el.closest("[data-plan-id]") : null;
    var planId = planLane && planLane.getAttribute("data-plan-id");
    return planId ? ("plan-toggle:" + planId) : "plan-toggle";
  }
  if(role === "work-oneoff-toggle") return "oneoff-toggle";
  if(role === "work-oneoff-search") return "oneoff-search";
  if(role === "work-filters-toggle") return "work-filters-toggle";
  if(role === "work-oneoff-current-toggle") return "oneoff-current-toggle";
  if(role === "work-oneoff-attention-toggle") return "oneoff-attention-toggle";
  if(role === "work-oneoff-history-toggle") return "oneoff-history-toggle";
  if(role === "work-finished-toggle") return "finished-toggle";
  if(role === "work-phase-option"){
    return "phase:" + String(el.getAttribute("data-goal-id") || "")
      + ":" + String(el.getAttribute("data-plan-id") || "");
  }
  if(role === "work-workspace-option"){
    return "workspace:" + String(el.getAttribute("data-workspace-kind") || "")
      + ":" + String(el.getAttribute("data-workspace-id") || "");
  }
  if(role === "goal-tree-search-input") return "goal-tree-search";
  if(role === "goal-tree-now") return "goal-tree-now";
  if(role === "goal-tree-history") return "goal-tree-history";
  if(role === "goal-tree-resize") return "goal-tree-resize";
  if(role === "mobile-back") return "mobile-back";
  if(role === "goal-file-open-decisions") return "goal-file-open-decisions";
  if(role === "work-filter-project") return "filter-project";
  if(role === "work-filter-column") return "filter-column";
  if(role === "work-filter-worker") return "filter-worker";
  if(role === "work-filter-apply") return "filter-apply";
  if(role === "work-filter-reset") return "filter-reset";
  if(role === "outcome-text") return "outcome-text";
  if(role === "outcome-project") return "outcome-project";
  if(role === "outcome-context") return "outcome-context";
  if(role === "outcome-shape") return "outcome-shape";
  if(role === "outcome-submit") return "outcome-submit";
  if(role === "outcome-advanced") return "outcome-advanced";
  if(role === "work-advanced") return "work-advanced";
  if(role === "work-shape-guide-toggle") return "work-shape-guide-toggle";
  if(role === "page-story-disclosure-toggle") return "page-story-toggle";
  if(role === "work-action-move" || role === "work-action-btn"){
    var actCard = el.closest ? el.closest("[data-task-id]") : null;
    var actId = actCard && actCard.getAttribute("data-task-id");
    return actId ? ("action:" + actId) : null;
  }
  if(role === "outcome-intake-row"){
    var intakeId = el.getAttribute("data-intake-id");
    return intakeId ? ("intake-row:" + intakeId) : null;
  }
  if(el.parentElement && viewEl && viewEl.contains(el.parentElement)){
    return workSemanticFocusKey(el.parentElement);
  }
  return null;
}
function workFindFocusTarget(key){
  if(!key || !viewEl) return null;
  try {
    if(key.indexOf("task:") === 0){
      var tid = key.slice(5);
      var cards = viewEl.querySelectorAll('[data-fl-role="work-card"]');
      for(var i = 0; i < cards.length; i++){
        if(cards[i].getAttribute("data-task-id") === tid) return cards[i];
      }
      return null;
    }
    if(key.indexOf("goal-toggle:") === 0){
      var gid = key.slice("goal-toggle:".length);
      var goals = viewEl.querySelectorAll('[data-fl-role="work-goal-lane"]');
      for(var g = 0; g < goals.length; g++){
        if(goals[g].getAttribute("data-goal-id") === gid){
          return goals[g].querySelector('[data-fl-role="work-goal-toggle"]');
        }
      }
      return null;
    }
    if(key.indexOf("plan-toggle:") === 0){
      var pid = key.slice("plan-toggle:".length);
      var plans = viewEl.querySelectorAll('[data-fl-role="work-plan-lane"]');
      for(var p = 0; p < plans.length; p++){
        if(plans[p].getAttribute("data-plan-id") === pid){
          return plans[p].querySelector('[data-fl-role="work-plan-toggle"]');
        }
      }
      return null;
    }
    if(key.indexOf("action:") === 0){
      var aid = key.slice(7);
      var actCards = viewEl.querySelectorAll('[data-fl-role="work-card"]');
      for(var a = 0; a < actCards.length; a++){
        if(actCards[a].getAttribute("data-task-id") === aid){
          return actCards[a].querySelector('[data-fl-role="work-action-move"]')
            || actCards[a].querySelector('[data-fl-role="work-action-btn"]');
        }
      }
      return null;
    }
    if(key.indexOf("phase:") === 0){
      var phaseParts = key.slice("phase:".length).split(":");
      var phaseOptions = viewEl.querySelectorAll('[data-fl-role="work-phase-option"]');
      for(var ph = 0; ph < phaseOptions.length; ph++){
        if(phaseOptions[ph].getAttribute("data-goal-id") === phaseParts[0]
          && phaseOptions[ph].getAttribute("data-plan-id") === phaseParts.slice(1).join(":")){
          return phaseOptions[ph];
        }
      }
      return null;
    }
    if(key.indexOf("workspace:") === 0){
      var workspaceParts = key.slice("workspace:".length).split(":");
      var workspaceOptions = viewEl.querySelectorAll('[data-fl-role="work-workspace-option"]');
      for(var w = 0; w < workspaceOptions.length; w++){
        if(workspaceOptions[w].getAttribute("data-workspace-kind") === workspaceParts[0]
          && workspaceOptions[w].getAttribute("data-workspace-id") === workspaceParts.slice(1).join(":")){
          return workspaceOptions[w];
        }
      }
      return null;
    }
    if(key.indexOf("intake-row:") === 0){
      var iid = key.slice("intake-row:".length);
      var rows = viewEl.querySelectorAll('[data-fl-role="outcome-intake-row"]');
      for(var r = 0; r < rows.length; r++){
        if(rows[r].getAttribute("data-intake-id") === iid) return rows[r];
      }
      return null;
    }
    var roleMap = {
      "oneoff-toggle": "work-oneoff-toggle",
      "oneoff-search": "work-oneoff-search-input",
      "finished-toggle": "work-finished-toggle",
      "filter-project": "work-filter-project",
      "filter-column": "work-filter-column",
      "filter-worker": "work-filter-worker",
      "filter-apply": "work-filter-apply",
      "filter-reset": "work-filter-reset",
      "outcome-text": "outcome-text",
      "outcome-project": "outcome-project",
      "outcome-context": "outcome-context",
      "outcome-shape": "outcome-shape",
      "outcome-submit": "outcome-submit",
      "outcome-advanced": "outcome-advanced",
      "work-advanced": "work-advanced",
      "work-shape-guide-toggle": "work-shape-guide-toggle",
      "work-filters-toggle": "work-filters-toggle",
      "oneoff-current-toggle": "work-oneoff-current-toggle",
      "oneoff-attention-toggle": "work-oneoff-attention-toggle",
      "oneoff-history-toggle": "work-oneoff-history-toggle",
      "page-story-toggle": "page-story-disclosure-toggle",
      "goal-tree-search": "goal-tree-search-input",
      "goal-tree-now": "goal-tree-now",
      "goal-tree-history": "goal-tree-history",
      "goal-tree-resize": "goal-tree-resize",
      "mobile-back": "mobile-back",
      "goal-file-open-decisions": "goal-file-open-decisions"
    };
    var role = roleMap[key];
    if(role) return viewEl.querySelector('[data-fl-role="' + role + '"]');
  } catch(_){}
  return null;
}
/* The page scroll host is main.content (not window). */
function workContentScrollEl(){
  try {
    return document.querySelector("main.content") || document.querySelector(".content");
  } catch(_){
    return null;
  }
}
/* Materialize the lazy Finished-work body through the same ensure the toggle
 * path installs. Safe no-op when the disclosure is closed or already filled. */
function workMaterializeOpenFinishedBody(finished){
  if(!finished || !finished.open) return;
  try {
    var ensure = finished._workEnsureFinishedBody;
    if(typeof ensure === "function") ensure();
  } catch(_){}
}
/* Capture meaningful Work context before a required rerender. */
function workCaptureWorkbenchContext(){
  var ctx = {
    finishedOpen: false,
    advancedOpen: false,
    expertDetailsOpen: false,
    goalSummaryOpen: false,
    filtersOpen: false,
    oneOffCurrentOpen: false,
    oneOffAttentionOpen: false,
    oneOffHistoryOpen: false,
    shapeGuideOpen: false,
    pageStoryOpen: false,
    outcomeAdvancedOpen: false,
    focusKey: null,
    contentScrollTop: 0,
    contentScrollLeft: 0,
    boardScrollLeft: 0,
    boardScrollCaptured: false,
    detailOpen: false,
    detailTaskId: null,
    detailTab: null,
    detailScrollTop: 0,
    treeWidth: (function(px){
      var n = typeof px === "number" ? px : parseInt(px, 10);
      if(!isFinite(n)) return 280;
      if(n < 200) return 200;
      if(n > 420) return 420;
      return Math.round(n);
    })(S && S.workTreeWidth),
    treeQuery: String((S && S.workTreeQuery) || ""),
    treeScope: (S && S.workTreeScope) === "history" ? "history" : "now",
    mobilePane: (S && S.workMobilePane) || "tree",
    goalFileEvidenceOpen: false,
    treeScrollTop: 0,
    fileScrollTop: 0
  };
  if(!viewEl) return ctx;
  try {
    var finished = viewEl.querySelector('[data-fl-role="work-finished-group"]');
    if(finished) ctx.finishedOpen = !!finished.open;
    var expert = viewEl.querySelector('[data-work-role="expert-details"]')
      || viewEl.querySelector('[data-fl-role="work-advanced"]');
    if(expert){
      ctx.advancedOpen = !!expert.open;
      ctx.expertDetailsOpen = !!expert.open;
    }
    var goalSummary = viewEl.querySelector('[data-fl-role="work-goal-summary"]');
    if(goalSummary) ctx.goalSummaryOpen = !!goalSummary.open;
    var filters = viewEl.querySelector('[data-fl-role="work-filters"]');
    if(filters) ctx.filtersOpen = !!filters.open;
    var oneOffCurrent = viewEl.querySelector('[data-fl-role="work-oneoff-current"]');
    if(oneOffCurrent) ctx.oneOffCurrentOpen = !!oneOffCurrent.open;
    var oneOffAttention = viewEl.querySelector('[data-fl-role="work-oneoff-attention"]');
    if(oneOffAttention) ctx.oneOffAttentionOpen = !!oneOffAttention.open;
    var oneOffHistory = viewEl.querySelector('[data-fl-role="work-oneoff-history"]');
    if(oneOffHistory) ctx.oneOffHistoryOpen = !!oneOffHistory.open;
    var story = viewEl.querySelector('[data-fl-role="page-story-disclosure"]');
    if(story) ctx.pageStoryOpen = !!story.open;
    var oadv = viewEl.querySelector('[data-fl-role="outcome-advanced"]');
    if(oadv) ctx.outcomeAdvancedOpen = !!oadv.open;
    var shapeGuide = viewEl.querySelector('[data-fl-role="work-shape-guide"]');
    if(shapeGuide) ctx.shapeGuideOpen = !!shapeGuide.open;
    var evidence = viewEl.querySelector('[data-fl-role="goal-file-evidence"]');
    if(evidence) ctx.goalFileEvidenceOpen = !!evidence.open;
    var tree = viewEl.querySelector('[data-fl-role="goal-tree"]');
    if(tree) ctx.treeScrollTop = tree.scrollTop || 0;
    var fileHost = viewEl.querySelector('[data-fl-role="goal-file-host"]');
    if(fileHost) ctx.fileScrollTop = fileHost.scrollTop || 0;
    var board = viewEl.querySelector('[data-fl-role="work-board"]');
    if(board){
      ctx.boardScrollCaptured = true;
      ctx.boardScrollLeft = board.scrollLeft || 0;
    }
    var content = workContentScrollEl();
    if(content){
      ctx.contentScrollTop = content.scrollTop || 0;
      ctx.contentScrollLeft = content.scrollLeft || 0;
    }
    ctx.detailOpen = !!S.detail;
    ctx.detailTaskId = S.detailTaskId || null;
    if(typeof taskDetailActiveTab !== "undefined") ctx.detailTab = taskDetailActiveTab || null;
    if(typeof detailEl !== "undefined" && detailEl){
      ctx.detailScrollTop = detailEl.scrollTop || 0;
    }
    var ae = document.activeElement;
    if(ae && viewEl.contains(ae)) ctx.focusKey = workSemanticFocusKey(ae);
  } catch(_){}
  return ctx;
}
/* Restore surviving context by stable semantic keys. Production order:
 * open Finished → materialize lazy body → other disclosures → scroll → focus.
 * Missing targets are ignored; never throws into the render path. */
function workRestoreWorkbenchContext(ctx){
  if(!ctx || !viewEl) return;
  try {
    var hasCaptured = function(key){
      return Object.prototype.hasOwnProperty.call(ctx, key);
    };
    /* 1. Finished disclosure first so nested Goal/Plan/Task can mount. */
    var finished = viewEl.querySelector('[data-fl-role="work-finished-group"]');
    if(finished && hasCaptured("finishedOpen")){
      finished.open = false;
      if(ctx.finishedOpen){
        finished.open = true;
        /* Same ensure the user-toggle path uses (filled guard makes it idempotent). */
        workMaterializeOpenFinishedBody(finished);
      }
    }
    /* 2. Other native disclosures. */
    var expert = viewEl.querySelector('[data-work-role="expert-details"]')
      || viewEl.querySelector('[data-fl-role="work-advanced"]');
    if(expert){
      var expertOpen = Object.prototype.hasOwnProperty.call(ctx, "expertDetailsOpen")
        ? ctx.expertDetailsOpen : ctx.advancedOpen;
      if(expertOpen !== undefined) expert.open = !!expertOpen;
    }
    var goalSummary = viewEl.querySelector('[data-fl-role="work-goal-summary"]');
    if(goalSummary && Object.prototype.hasOwnProperty.call(ctx, "goalSummaryOpen")){
      goalSummary.open = !!ctx.goalSummaryOpen;
    }
    var filters = viewEl.querySelector('[data-fl-role="work-filters"]');
    if(filters && hasCaptured("filtersOpen")){
      filters.open = !!ctx.filtersOpen;
    }
    [
      ["work-oneoff-current", "oneOffCurrentOpen"],
      ["work-oneoff-attention", "oneOffAttentionOpen"],
      ["work-oneoff-history", "oneOffHistoryOpen"]
    ].forEach(function(entry){
      var disclosure = viewEl.querySelector('[data-fl-role="' + entry[0] + '"]');
      if(disclosure && hasCaptured(entry[1])){
        disclosure.open = !!ctx[entry[1]];
        if(disclosure.open){
          var body = disclosure.querySelector(".work-oneoff-status-body");
          if(body && !body.childNodes.length){
            var event = document.createEvent("Event");
            event.initEvent("toggle", false, false);
            disclosure.dispatchEvent(event);
          }
        }
      }
    });
    var story = viewEl.querySelector('[data-fl-role="page-story-disclosure"]');
    if(story && hasCaptured("pageStoryOpen")){
      story.open = !!ctx.pageStoryOpen;
    }
    var oadv = viewEl.querySelector('[data-fl-role="outcome-advanced"]');
    if(oadv && hasCaptured("outcomeAdvancedOpen")){
      oadv.open = !!ctx.outcomeAdvancedOpen;
    }
    var shapeGuide = viewEl.querySelector('[data-fl-role="work-shape-guide"]');
    if(shapeGuide && hasCaptured("shapeGuideOpen")){
      shapeGuide.open = !!ctx.shapeGuideOpen;
    }
    var evidence = viewEl.querySelector('[data-fl-role="goal-file-evidence"]');
    if(evidence && hasCaptured("goalFileEvidenceOpen")){
      evidence.open = !!ctx.goalFileEvidenceOpen;
    }
    if(hasCaptured("treeWidth")){
      var restoredWidth = typeof ctx.treeWidth === "number" ? ctx.treeWidth : parseInt(ctx.treeWidth, 10);
      if(!isFinite(restoredWidth)) restoredWidth = 280;
      if(restoredWidth < 200) restoredWidth = 200;
      if(restoredWidth > 420) restoredWidth = 420;
      restoredWidth = Math.round(restoredWidth);
      if(S) S.workTreeWidth = restoredWidth;
      var treeWidthNode = viewEl.querySelector('[data-fl-role="goal-tree"]');
      if(treeWidthNode && treeWidthNode.setAttribute){
        treeWidthNode.setAttribute("style", "--goal-tree-width:" + restoredWidth + "px");
      }
      var layoutWidthNode = viewEl.querySelector('[data-fl-role="workbench-layout"]');
      if(layoutWidthNode && layoutWidthNode.setAttribute){
        layoutWidthNode.setAttribute("style", "--goal-tree-width:" + restoredWidth + "px");
      }
    }
    if(hasCaptured("treeQuery") && S) S.workTreeQuery = String(ctx.treeQuery || "");
    if(hasCaptured("treeScope") && S && (ctx.treeScope === "now" || ctx.treeScope === "history")){
      S.workTreeScope = ctx.treeScope;
    }
    if(hasCaptured("mobilePane") && S){
      S.workMobilePane = (ctx.mobilePane === "file" || ctx.mobilePane === "detail")
        ? ctx.mobilePane : "tree";
    }
    var tree = viewEl.querySelector('[data-fl-role="goal-tree"]');
    if(tree && typeof ctx.treeScrollTop === "number") tree.scrollTop = ctx.treeScrollTop || 0;
    var fileHost = viewEl.querySelector('[data-fl-role="goal-file-host"]');
    if(fileHost && typeof ctx.fileScrollTop === "number") fileHost.scrollTop = ctx.fileScrollTop || 0;
    var searchInput = viewEl.querySelector('[data-fl-role="goal-tree-search-input"]');
    if(searchInput && hasCaptured("treeQuery") && document.activeElement !== searchInput){
      searchInput.value = String(ctx.treeQuery || "");
    }
    /* 3. Scroll hosts: main.content page scroll, then board horizontal. */
    var content = workContentScrollEl();
    if(content){
      content.scrollTop = ctx.contentScrollTop || 0;
      content.scrollLeft = ctx.contentScrollLeft || 0;
    }
    var board = viewEl.querySelector('[data-fl-role="work-board"]');
    var focusPending = typeof workBoardFocusRequest !== "undefined" && !!workBoardFocusRequest;
    var canRestoreBoard = !focusPending
      && ctx.boardScrollCaptured !== false;
    if(board && canRestoreBoard && typeof ctx.boardScrollLeft === "number"){
      board.scrollLeft = ctx.boardScrollLeft || 0;
    }
    if(ctx.detailOpen && S.detail && typeof detailEl !== "undefined" && detailEl){
      detailEl.hidden = false;
      if(typeof scrimEl !== "undefined" && scrimEl) scrimEl.hidden = false;
      if(ctx.detailTaskId) S.detailTaskId = ctx.detailTaskId;
      if(ctx.detailTab && typeof taskDetailActiveTab !== "undefined"){
        taskDetailActiveTab = ctx.detailTab;
      }
      if(typeof ctx.detailScrollTop === "number") detailEl.scrollTop = ctx.detailScrollTop;
    }
    /* 4. Focus only after lazy Finished body materialization. */
    if(ctx.focusKey){
      var target = workFindFocusTarget(ctx.focusKey);
      if(target && typeof target.focus === "function"){
        try {
          target.focus({ preventScroll: true });
        } catch(_){
          try { target.focus(); } catch(__){}
        }
      }
    }
  } catch(_){}
}
function workRememberRenderSnapshot(){
  try {
    S.workRenderSnapshot = workVisibleTruthSnapshot();
  } catch(_){
    S.workRenderSnapshot = null;
  }
}

/* The single Work surface: the rail is navigation, and only the selected
 * canonical workspace receives a Task board. Loading/failure/stale states are decided by
 * pageEvidenceState; an unsupported projection fails visibly here.
 * FL-112A: capture → rebuild → restore so real evidence updates do not wipe
 * history/More-options disclosures, focus, or scroll. */
function rWork(){
  var continuity = workCaptureWorkbenchContext();
  viewEl.textContent = "";
  if(!S.hadOk){
    showDisconnected();
    workRememberRenderSnapshot();
    return;
  }
  var view;
  try {
    view = normalizeWorkHierarchy(S.workHierarchy);
  } catch(err){
    var errBox = h("div", "error-box");
    errBox.setAttribute("data-fl-role", "work-hierarchy-error");
    errBox.appendChild(document.createTextNode(t("workUnsupportedHierarchy")));
    viewEl.appendChild(errBox);
    workRestoreWorkbenchContext(continuity);
    workRememberRenderSnapshot();
    return;
  }

  if(workCollapse === null) workCollapse = workCollapseLoad();
  workRefreshFilterOptions(view);
  var previousSelection = S.workSelection;
  S.workSelection = workResolveSelection(view, S.workSelection);
  var selectionChanged = !workSelectionEqual(previousSelection, S.workSelection);
  var phaseChanged = false;
  if(S.workSelection && S.workSelection.kind === "goal"
    && String(S.workViewedGoalId || "") !== String(S.workSelection.id || "")){
    S.workViewedGoalId = String(S.workSelection.id || "");
    S.workViewedPlanId = null;
    phaseChanged = true;
  } else if(S.workSelection && S.workSelection.kind === "goal"
    && S.workViewedPlanId
    && !workReadingPhaseExists(view, S.workSelection.id, S.workViewedPlanId)){
    /* A saved or polled phase can disappear independently of its Goal. Clear
     * only that browser navigation key and let the Goal's canonical fallback
     * choose the next readable phase. */
    S.workViewedPlanId = null;
    phaseChanged = true;
  } else if(!S.workSelection || S.workSelection.kind !== "goal"){
    /* A Goal that disappeared must not leave a stale phase selection waiting
     * for a later poll. Selection fallback is the only safe recovery. */
    S.workViewedGoalId = null;
    S.workViewedPlanId = null;
  }
  if((selectionChanged || phaseChanged || workInitialSelectionNeedsFocus)
    && S.workSelection && !workBoardFocusRequest){
    /* A fallback is a genuinely new reading surface. Any old board position
     * belongs to the disappeared workspace/phase and must not suppress the
     * one-shot relevant-column reveal. */
    if(selectionChanged || phaseChanged){
      workReloadBoardScrollRestored = false;
      if(workReloadRestoreContext) workReloadRestoreContext.boardScrollCaptured = false;
    }
    workBoardFocusRequest = { key: workSelectionKey(S.workSelection) };
    workInitialSelectionNeedsFocus = false;
  }

  /* FL-112E9: apply pending created-work navigation only against the refreshed
   * canonical hierarchy. Never optimistic; missing identity stays retryable. */
  if(S.outcomeCreatedNavigate){
    workApplyCreatedNavigation(view);
  }

  var oneOffCount = workOneOffCardCount(view);
  var hasAny = (view.goals && view.goals.length)
    || (view.independentPlans && view.independentPlans.length)
    || oneOffCount > 0;

  if(!hasAny){
    /* The empty state uses the same tree as real Work. The hierarchy and the
     * contextual New Goal action teach the product without a separate lesson
     * or a form occupying the first viewport before the user asks for it. */
    viewEl.appendChild(renderWorkWorkbench(view, S.workSelection));
    viewEl.appendChild(renderWorkFilters());
    workRestoreReadingAfterRender(view, continuity);
    workRememberRenderSnapshot();
    return;
  }
  /* Real Work first: the tree carries contextual add actions and keeps the
   * active intake journey after the canonical hierarchy. The selected
   * workspace owns the canvas; filters remain optional. */
  viewEl.appendChild(renderWorkWorkbench(view, S.workSelection));
  viewEl.appendChild(renderWorkFilters());
  /* Restore open history/More-options/filter disclosures, focus, and scroll
   * before rebinding the Move/Act chooser to replacement controls. The
   * semantic restore helper delegates workRestoreWorkbenchContext(continuity)
   * after the replacement board has mounted. */
  workRestoreReadingAfterRender(view, continuity);
  /* A poll re-render replaced every Move/Act control; keep the open chooser's
   * origin truthful and its focus return working against the new controls. */
  workActionRebindChooser();
  workRememberRenderSnapshot();
}

function renderDecisionItem(item){
  var card = h("article", "decision-item");
  card.setAttribute("data-fl-role", "decision-item");
  card.setAttribute("data-task-id", String(item.taskId || ""));
  card.appendChild(h("h4", "decision-item-title", item.name || t("taskUntitled")));
  card.appendChild(h("p", "decision-item-fact", t("decisionFact", { text: item.fact || t("workNoneYet") })));
  card.appendChild(h("p", "decision-item-reason", t("decisionReason", { text: item.reason || t("workNoNext") })));
  if(item.retained){
    card.appendChild(h("p", "decision-item-retained", t("decisionRetained", { text: item.retained })));
  }
  card.appendChild(h("p", "decision-item-impact", t("decisionImpact", { text: item.impact || t("workPlacementUnknown") })));
  var actions = h("div", "decision-item-actions");
  var open = h("button", "btn primary sm", t("decisionOpen"));
  open.type = "button";
  open.setAttribute("data-fl-role", "decision-open");
  open.addEventListener("click", function(){
    if(workIsNarrowViewport()) workApplyMobilePane(workNextMobilePane(S.workMobilePane, "open-detail"));
    showTask(item.taskId, item.card && item.card.breadcrumb);
  });
  actions.appendChild(open);
  if(item.card) actions.appendChild(renderWorkMoveActControl(item.card));
  card.appendChild(actions);
  return card;
}
function renderDecisionCenter(view){
  var model = collectDecisionGroups(view);
  var root = h("section", "decision-center");
  root.setAttribute("data-fl-role", "decision-center");
  root.appendChild(h("h2", "decision-center-title", t("navDecisions")));
  root.appendChild(h("p", "decision-center-hint", t("decisionCenterHint")));
  if(!model.total){
    root.appendChild(stateMsg("empty", t("decisionCenterEmpty")));
    return root;
  }
  model.groups.forEach(function(group){
    var section = h("section", "decision-group");
    section.setAttribute("data-fl-role", "decision-group");
    section.setAttribute("data-goal-id", String(group.goalId || ""));
    section.appendChild(h("h3", "decision-group-title", group.goalName || t("workUntitledGoal")));
    group.items.forEach(function(item){ section.appendChild(renderDecisionItem(item)); });
    root.appendChild(section);
  });
  if(model.parentless.length){
    var parentless = h("section", "decision-group decision-parentless");
    parentless.setAttribute("data-fl-role", "decision-parentless");
    parentless.appendChild(h("h3", "decision-group-title", t("decisionParentless")));
    model.parentless.forEach(function(item){ parentless.appendChild(renderDecisionItem(item)); });
    root.appendChild(parentless);
  }
  return root;
}
function rDecisions(){
  var continuity = workCaptureWorkbenchContext();
  viewEl.textContent = "";
  if(!S.hadOk){
    showDisconnected();
    workRememberRenderSnapshot();
    return;
  }
  var view;
  try {
    view = normalizeWorkHierarchy(S.workHierarchy);
  } catch(err){
    var errBox = h("div", "error-box");
    errBox.setAttribute("data-fl-role", "work-hierarchy-error");
    errBox.appendChild(document.createTextNode(t("workUnsupportedHierarchy")));
    viewEl.appendChild(errBox);
    workRestoreWorkbenchContext(continuity);
    workRememberRenderSnapshot();
    return;
  }
  viewEl.appendChild(renderDecisionCenter(view));
  workRestoreWorkbenchContext(continuity);
  workUpdateMobileBack();
  workRememberRenderSnapshot();
}

/* Task Detail breadcrumb. Renders only parents that actually exist in the
 * clicked hierarchy card; a direct link without ancestry shows the plain
 * "Task report" label and never invents a Goal or Plan. */
/* Resolve the breadcrumb for an opened Task. A clicked hierarchy card stores
 * its bounded ancestry keyed by task id; reloading the SAME task (an in-drawer
 * action re-opens it) keeps that ancestry. A different task or a direct link
 * without a crumb never inherits stale parents. */
function resolveTaskBreadcrumb(prev, id, crumb){
  if(crumb && typeof crumb === "object"){
    return {
      taskId: id,
      goalId: crumb.goalId,
      goalName: crumb.goalName,
      planId: crumb.planId,
      planName: crumb.planName,
      taskName: crumb.taskName || crumb.name
    };
  }
  if(prev && prev.taskId === id) return prev;
  return null;
}
function renderTaskBreadcrumb(crumb){
  if(!crumb || typeof crumb !== "object"){
    return h("div", "dim fs12", t("taskReportBreadcrumb"));
  }
  var goalName = crumb.goalName || (crumb.goal && crumb.goal.name);
  var planName = crumb.planName || (crumb.plan && crumb.plan.name);
  var taskName = crumb.taskName || crumb.name || "";
  if(!goalName && !planName){
    return h("div", "dim fs12", t("taskReportBreadcrumb"));
  }
  var wrap = h("div", "task-breadcrumb");
  wrap.setAttribute("data-fl-role", "task-breadcrumb");
  var segs = [];
  if(goalName){
    var gb;
    if(crumb.goalId){
      gb = h("button", "task-breadcrumb-seg task-breadcrumb-link", String(goalName));
      gb.type = "button";
      gb.setAttribute("data-fl-role", "task-breadcrumb-goal");
      gb.addEventListener("click", function(){ showGoalDetail(crumb.goalId); });
    } else {
      gb = h("span", "task-breadcrumb-seg", String(goalName));
    }
    segs.push(gb);
  }
  if(planName){
    var pb;
    if(crumb.planId){
      pb = h("button", "task-breadcrumb-seg task-breadcrumb-link", String(planName));
      pb.type = "button";
      pb.setAttribute("data-fl-role", "task-breadcrumb-plan");
      pb.addEventListener("click", function(){ showPlanBoard(crumb.planId); });
    } else {
      pb = h("span", "task-breadcrumb-seg", String(planName));
    }
    segs.push(pb);
  }
  segs.push(h("span", "task-breadcrumb-seg task-breadcrumb-current", taskName || t("taskUntitled")));
  segs.forEach(function(s, i){
    if(i > 0) wrap.appendChild(h("span", "task-breadcrumb-sep", "›"));
    wrap.appendChild(s);
  });
  return wrap;
}

/* --- Competitions --- */
function rCompetitions(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  viewEl.appendChild(renderPageStory("compete"));
  if(!S.competitions || !S.competitions.length){
    viewEl.appendChild(stateMsg("empty", t("noCompetitions")));
    return;
  }
  S.competitions.forEach(function(c){
    var pr = c.progress || {};
    viewEl.appendChild(card(function(){ showCompetition(c.id); }, [
      cardHead(c.name, "", badge(c.status)),
      h("div", "summary-line", t("competitionProgressCreated", {
        candidates: String(c.candidateCount), terminal: String(pr.terminal || 0),
        total: String(pr.total || 0), created: fmtSince(c.createdAt)
      }))
    ]));
  });
}

/* --- Stats (Insights: portfolio economics + per-provider/model outcomes) --- */
function econRange(min, max){
  return h("span", "ev-range mono", num(min, 0) + " - " + num(max, 0));
}
/* Locale-aware compact Token formatter. The visible value is short and
 * native ("about 20.7M" / "about 2071万"); the exact integer is always
 * retained in the title attribute so assistive technology and hover
 * metadata can reach it. No rounding is written back or used in
 * calculations - this is a display-only concern. */
function econTokenCompact(value){
  if(typeof value !== "number" || !Number.isFinite(value)){
    return { visible: "-", exact: "-" };
  }
  var lang = (window.ForklightI18n && typeof window.ForklightI18n.getLang === "function")
    ? window.ForklightI18n.getLang() : "zh";
  var abs = Math.abs(value);
  var trim0 = function(s){ return s.replace(/0+$/,"").replace(/\.$/,""); };
  var visible;
  if(lang === "zh"){
    if(abs >= 1e8){
      visible = trim0((value / 1e8).toFixed(1)) + "亿";
    } else if(abs >= 1e4){
      visible = trim0((value / 1e4).toFixed(1)) + "万";
    } else {
      visible = String(value);
    }
  } else {
    if(abs >= 1e9){
      visible = trim0((value / 1e9).toFixed(1)) + "B";
    } else if(abs >= 1e6){
      visible = trim0((value / 1e6).toFixed(1)) + "M";
    } else if(abs >= 1e3){
      visible = trim0((value / 1e3).toFixed(1)) + "K";
    } else {
      visible = String(value);
    }
  }
  return { visible: visible, exact: String(value) };
}
function econTokenRangeCompact(min, max){
  var lo = econTokenCompact(min);
  var hi = econTokenCompact(max);
  var span = h("span", "ev-range mono", lo.visible + " - " + hi.visible);
  span.title = t("econExactTokens") + ": " + lo.exact + " - " + hi.exact;
  return span;
}
function econTokenCountSpan(value){
  var pair = econTokenCompact(value);
  var span = h("span", "mono ev-token-compact", pair.visible);
  span.title = t("econExactTokens") + ": " + pair.exact;
  return span;
}
function econListPair(label, valueNode){
  var r = h("div", "ev-row");
  r.appendChild(h("span", "ev-key", label));
  var v = h("span", "ev-value");
  if(Array.isArray(valueNode)){
    valueNode.forEach(function(part){
      if(part === null || part === undefined) return;
      if(typeof part === "string" || typeof part === "number"){
        v.appendChild(document.createTextNode(String(part)));
      } else {
        v.appendChild(part);
      }
    });
  } else if(typeof valueNode === "string" || typeof valueNode === "number"){
    v.textContent = String(valueNode);
  } else if(valueNode){
    v.appendChild(valueNode);
  }
  r.appendChild(v);
  return r;
}
function econReasonMap(){
  return {
    "no-measurements": t("econReasonNoMeasurements"),
    "invalid-exact-evidence": t("econReasonInvalidExactEvidence"),
    "invalid-measurement": t("econReasonInvalidMeasurement"),
    "invalid-receipt-evidence": t("econReasonInvalidReceiptEvidence"),
    "incomplete-worker-usage": t("econReasonIncompleteWorkerUsage"),
    "missing-exchange-evidence": t("econReasonMissingExchangeEvidence"),
    "direct-baseline-missing": t("econReasonDirectBaselineMissing"),
    "incompatible-baseline": t("econReasonIncompatibleBaseline"),
    "task-class-mismatch": t("econReasonTaskClassMismatch"),
    "task-class-required": t("econReasonTaskClassRequired"),
    "zero-baseline": t("econReasonZeroBaseline"),
    "exchange-stage-missing": t("econReasonExchangeStageMissing"),
    "official-cost-stage-missing": t("econReasonOfficialStageMissing"),
    "currency-unsupported": t("econReasonCurrencyUnsupported"),
    "no-quote-attached": t("econReasonNoQuoteAttached"),
    "no-quoted-total": t("econReasonNoQuotedTotal"),
    // Composite official-cost unavailable codes (typed as "stage:reason" by
    // the canonical summary) - never shown to users as raw codes. Each is
    // translated through the matching plain-language i18n key from the
    // parallel glossary task. Count semantics are unchanged.
    "calculation:per-request-usage-required": t("econReasonPerRequestUsageRequired"),
    "pricing-identity:route-required": t("econReasonRouteRequired"),
    "pricing-identity:unsupported-route": t("econReasonUnsupportedRoute"),
    "pricing-identity:unsupported-model": t("econReasonUnsupportedModel"),
    "pricing-identity:unsupported-endpoint": t("econReasonUnsupportedEndpoint"),
    "pricing-identity:service-tier-missing": t("econReasonServiceTierMissing"),
    "pricing-identity:subscription-plan-no-per-request-price": t("econReasonSubscriptionPlanNoPerRequestPrice"),
    "missing:missing-officialCost-record": t("econReasonMissingOfficialCostRecord"),
    "usage:usage-missing": t("econReasonUsageMissing")
  };
}
function econTranslateReason(map, raw){
  if(!raw) return t("econReasonUnknown");
  if(map[raw]) return map[raw];
  return raw;
}
function econReasonPills(breakdown, map){
  if(!breakdown) return null;
  var keys = Object.keys(breakdown).sort();
  if(!keys.length) return null;
  var d = h("div", "ev-unavailable-breakdown");
  keys.slice(0, 6).forEach(function(k){
    var label = econTranslateReason(map, k);
    d.appendChild(h("span", "ev-breakdown-pill", label + " (" + breakdown[k] + ")"));
  });
  return d;
}
function econConfidencePills(counts){
  if(!counts) return null;
  var keys = Object.keys(counts).sort();
  if(!keys.length) return null;
  var d = h("div", "ev-unavailable-breakdown");
  keys.forEach(function(k){
    var labels = {
      low: t("econConfidenceLow"),
      medium: t("econConfidenceMedium"),
      high: t("econConfidenceHigh")
    };
    d.appendChild(h("span", "ev-breakdown-pill", (labels[k] || k) + " (" + counts[k] + ")"));
  });
  return d;
}
function econUnavailableCard(title, totalCount, reasons){
  var c = evCard(title);
  if(!totalCount || totalCount <= 0){
    c.appendChild(evRow(t("econUnavailableNone"), t("econUnavailableNoneHint")));
    return c;
  }
  c.appendChild(evRow(
    t("econUnavailableTasks", { count: String(totalCount) }),
    t("econUnavailableTasksHint")
  ));
  if(reasons) c.appendChild(reasons);
  return c;
}
function renderScopeStrip(scope){
  var taskCount = scope && typeof scope.terminalTaskCount === "number" ? scope.terminalTaskCount : 0;
  var attemptCount = scope && typeof scope.totalAttemptCount === "number" ? scope.totalAttemptCount : 0;
  var isEmpty = !scope || scope.nonEmpty === false;
  var strip = h("div", "scope-strip");
  strip.appendChild(h("span", "scope-strip-label", t("econScopeLabel")));
  strip.appendChild(h("span", "scope-strip-pill",
    t("econScopeTasks", { count: String(taskCount) })));
  strip.appendChild(h("span", "scope-strip-pill",
    t("econScopeAttempts", { count: String(attemptCount) })));
  if(isEmpty){
    strip.appendChild(h("span", "scope-strip-hint", t("econScopeEmpty")));
  } else {
    strip.appendChild(h("span", "scope-strip-hint", t("econScopeHint")));
  }
  return strip;
}
function renderExchangeSection(ex){
  var cardEl = evCard(t("econExchangeTitle"));
  var available = (ex && ex.availableTaskCount) || 0;
  var unavailable = (ex && ex.unavailableTaskCount) || 0;
  if(available > 0){
    cardEl.appendChild(econListPair(
      t("econExchangeRangeLabel"),
      econTokenRangeCompact(ex.min, ex.max)
    ));
    cardEl.appendChild(econListPair(
      t("econAvailableTasks", { count: String(available) }),
      t("econRangeCoverage")
    ));
    cardEl.appendChild(evCaveat(t("econExchangeCaveat")));
  } else {
    cardEl.appendChild(evRow(t("econExchangeRangeLabel"), t("econExchangeUnavailable")));
  }
  var map = econReasonMap();
  var pills = econReasonPills(ex && ex.unavailableReasons, map);
  cardEl.appendChild(evRow(
    t("econUnavailableTasks", { count: String(unavailable) }),
    t("econExchangeUnavailableHint")));
  if(pills) cardEl.appendChild(pills);
  return cardEl;
}
function renderDirectSavingsSection(dcs){
  var cardEl = evCard(t("econDirectTitle"));
  var available = (dcs && dcs.availableTaskCount) || 0;
  if(available > 0){
    cardEl.appendChild(econListPair(
      t("econDirectRangeLabel"),
      econTokenRangeCompact(dcs.min, dcs.max)
    ));
    var negative = (dcs.negativeBoundCount) || 0;
    if(negative > 0){
      cardEl.appendChild(evRow(
        t("econDirectNegative"),
        t("econDirectNegativeHint", { count: String(negative) })
      ));
    }
    var conf = econConfidencePills(dcs.confidenceCounts);
    if(conf){
      cardEl.appendChild(evRow(t("econDirectConfidence"), conf));
    }
    cardEl.appendChild(evCaveat(t("econDirectCaveat")));
  } else {
    cardEl.appendChild(evRow(t("econDirectRangeLabel"), t("econDirectUnavailable")));
    cardEl.appendChild(evCaveat(t("econDirectUnavailableCaveat")));
  }
  var map = econReasonMap();
  var pills = econReasonPills(dcs && dcs.unavailableReasons, map);
  var unavailable = (dcs && dcs.unavailableTaskCount) || 0;
  cardEl.appendChild(evRow(
    t("econUnavailableTasks", { count: String(unavailable) }),
    t("econDirectUnavailableHint")));
  if(pills) cardEl.appendChild(pills);
  return cardEl;
}
function renderWorkerVolumeSection(wv){
  var cardEl = evCard(t("econWorkerVolumeTitle"));
  var gross = typeof wv.grossWorkerTokens === "number" ? wv.grossWorkerTokens : 0;
  // Compact Token count for the visible value; the exact integer stays in the
  // title attribute so screen readers and hover metadata reach it.
  var grossRow = h("div", "ev-row");
  grossRow.appendChild(h("span", "ev-key", t("econWorkerVolumeGross")));
  var grossValue = h("span", "ev-value");
  grossValue.appendChild(econTokenCountSpan(gross));
  grossValue.appendChild(document.createTextNode(" Tokens"));
  grossRow.appendChild(grossValue);
  cardEl.appendChild(grossRow);
  var complete = wv.completeTaskCount || 0;
  var incomplete = wv.incompleteTaskCount || 0;
  cardEl.appendChild(evRow(
    t("econWorkerVolumeDenominator"),
    t("econWorkerVolumeCounts", {
      complete: String(complete),
      incomplete: String(incomplete),
      total: String(wv.totalTaskCount || 0)
    })
  ));
  if(incomplete > 0){
    cardEl.appendChild(evRow(
      t("econWorkerVolumeCoverage"),
      t("econWorkerVolumeCoverageHint", {
        present: String(wv.totalCompleteSampleCount || 0),
        missing: String(wv.totalMissingSampleCount || 0)
      })
    ));
    cardEl.appendChild(evCaveat(t("econWorkerVolumeIncomplete")));
  }
  cardEl.appendChild(evCaveat(t("econWorkerVolumeCaveat")));
  return cardEl;
}
function renderTokenReconciliationSection(rec){
  var cardEl = evCard(t("econReconciliationTitle"));
  rec = rec || {};
  var states = rec.stateCounts || {};
  var mismatched = rec.mismatchedAttemptCount || 0;
  var compared = rec.comparedAttemptCount || 0;
  var gaps = (rec.missingBreakdownCount || 0) + (rec.missingUsageCount || 0)
    + (rec.invalidCounterEvidenceCount || 0);
  cardEl.appendChild(evRow(
    t("econReconciliationOutcome"),
    mismatched > 0
      ? t("econReconciliationMismatch", { count: String(mismatched) })
      : compared > 0
        ? t("econReconciliationNoMismatch", { count: String(compared) })
        : t("econReconciliationNoComparison")
  ));
  cardEl.appendChild(evRow(
    t("econReconciliationTaskStates"),
    t("econReconciliationTaskStateCounts", {
      matched: String(states.matched || 0),
      mismatch: String(states.mismatch || 0),
      partial: String(states.partial || 0),
      unavailable: String(states.unavailable || 0),
      total: String(rec.totalTaskCount || 0)
    })
  ));
  cardEl.appendChild(evRow(
    t("econReconciliationCoverage"),
    t("econReconciliationCoverageCounts", {
      compared: String(compared),
      gaps: String(gaps)
    })
  ));
  var comparison = rec.comparison || {};
  if(comparison.available){
    cardEl.appendChild(econListPair(
      t("econReconciliationComparedTop"),
      econTokenCountSpan(comparison.topLevelGross)
    ));
    cardEl.appendChild(econListPair(
      t("econReconciliationComparedPerModel"),
      econTokenCountSpan(comparison.perModelGross)
    ));
    cardEl.appendChild(econListPair(
      t("econReconciliationDelta"),
      econTokenCountSpan(comparison.delta)
    ));
    cardEl.appendChild(evCaveat(t("econReconciliationComparedScope", {
      available: String(comparison.availableTaskCount || 0),
      unavailable: String(comparison.unavailableTaskCount || 0)
    })));
  } else {
    cardEl.appendChild(evRow(
      t("econReconciliationComparedTotals"),
      t(comparison.reason === "safe-integer-overflow"
        ? "econReconciliationOverflow"
        : "econReconciliationUnavailable")
    ));
  }
  cardEl.appendChild(evCaveat(t("econReconciliationCaveat")));
  return cardEl;
}
function renderBudgetSection(b){
  var cardEl = evCard(t("econBudgetTitle"));
  var capped = b.cappedAttemptCount || 0;
  var uncapped = b.uncappedAttemptCount || 0;
  var unknown = b.unknownAttemptCount || 0;
  var totalAttempts = b.totalAttemptCount || 0;
  cardEl.appendChild(evRow(
    t("econBudgetCappedSum"),
    capped > 0
      ? evCost(b.configuredFiniteCapSumUsd || 0, "USD")
      : t("econBudgetNoFiniteCaps")
  ));
  cardEl.appendChild(evRow(
    t("econBudgetDenominator"),
    t("econBudgetCounts", {
      capped: String(capped),
      uncapped: String(uncapped),
      unknown: String(unknown),
      total: String(totalAttempts)
    })
  ));
  var pills = h("div", "ev-unavailable-breakdown");
  pills.appendChild(h("span", "ev-breakdown-pill ev-pill-high", t("econBudgetCappedLabel", { count: String(capped) })));
  pills.appendChild(h("span", "ev-breakdown-pill ev-pill-medium", t("econBudgetUncappedLabel", { count: String(uncapped) })));
  if(unknown > 0){
    pills.appendChild(h("span", "ev-breakdown-pill ev-pill-low", t("econBudgetUnknownLabel", { count: String(unknown) })));
  }
  cardEl.appendChild(pills);
  if(totalAttempts > 0 && uncapped > 0){
    cardEl.appendChild(evCaveat(t("econBudgetUncappedCaveat")));
  }
  if(totalAttempts > 0 && unknown > 0){
    cardEl.appendChild(evCaveat(t("econBudgetUnknownCaveat")));
  }
  cardEl.appendChild(evCaveat(t("econBudgetCaveat")));
  return cardEl;
}
function renderRuntimeSection(rt){
  var cardEl = evCard(t("econRuntimeTitle"));
  var sampleCount = rt.sampleCount || 0;
  var missingCount = rt.missingCount || 0;
  var total = sampleCount + missingCount;
  cardEl.appendChild(evRow(
    t("econRuntimeSum"),
    sampleCount > 0
      ? evCost(rt.observedTotalUsd || 0, "USD")
      : t("econRuntimeNoSamples")
  ));
  cardEl.appendChild(evRow(
    t("econRuntimeDenominator"),
    t("econRuntimeCoverage", {
      sample: String(sampleCount),
      missing: String(missingCount),
      total: String(total)
    })
  ));
  if(missingCount > 0){
    cardEl.appendChild(evCaveat(t("econRuntimeMissingHint")));
  }
  cardEl.appendChild(evCaveat(t("econRuntimeCaveat")));
  return cardEl;
}
function renderOfficialCostRows(section){
  var totals = (section && section.currencyTotals) || [];
  if(!totals.length){
    var noneCard = evCard(t("econOfficialTitle"));
    noneCard.appendChild(evRow(t("econOfficialTotals"), t("econOfficialNone")));
    noneCard.appendChild(evCaveat(t("econOfficialNoneHint")));
    return [noneCard];
  }
  var cards = [];
  totals.forEach(function(row){
    var currency = row.currency || t("econUnknownCurrency");
    var cardEl = evCard(t("econOfficialTitle", { currency: currency }));
    cardEl.appendChild(evRow(
      t("econOfficialTotals"),
      t("econOfficialAmount", {
        amount: evAmount(row.total || 0),
        currency: currency
      })
    ));
    cardEl.appendChild(evRow(
      t("econOfficialQuotes"),
      t("econOfficialQuotesHint", {
        quoted: String(row.quotedAttemptCount || 0),
        sources: String((row.sources || []).length)
      })
    ));
    var srcList = row.sources || [];
    if(srcList.length){
      cardEl.appendChild(evRow(
        t("econOfficialSources", { count: String(srcList.length) }),
        evSources(srcList)
      ));
    } else {
      cardEl.appendChild(evRow(
        t("econOfficialSources", { count: "0" }),
        t("econOfficialSourcesNone")
      ));
    }
    cardEl.appendChild(evCaveat(t("econOfficialCaveat", { currency: currency })));
    cards.push(cardEl);
  });
  return cards;
}
function renderOfficialRangeCards(section){
  // Legacy payloads without a ranges field must render safely as an empty list;
  // exact and unavailable evidence continue to render separately above and below.
  var ranges = (section && section.ranges) || [];
  if(!ranges.length) return [];
  var cards = [];
  ranges.forEach(function(row){
    var currency = row.currency || t("econUnknownCurrency");
    var cardEl = evCard(t("econOfficialRangeTitle", { currency: currency }));
    cardEl.appendChild(evRow(
      t("econOfficialRangeLabel"),
      h("span", "ev-range mono", t("econOfficialRangeAmount", {
        min: evAmount(row.min || 0),
        max: evAmount(row.max || 0),
        currency: currency
      }))
    ));
    cardEl.appendChild(evRow(
      t("econOfficialRangeAttempts"),
      t("econOfficialRangeAttemptsHint", {
        count: String(row.rangedAttemptCount || 0),
        sources: String((row.sources || []).length)
      })
    ));
    var srcList = row.sources || [];
    if(srcList.length){
      cardEl.appendChild(evRow(
        t("econOfficialSources", { count: String(srcList.length) }),
        evSources(srcList)
      ));
    } else {
      cardEl.appendChild(evRow(
        t("econOfficialSources", { count: "0" }),
        t("econOfficialSourcesNone")
      ));
    }
    cardEl.appendChild(evCaveat(t("econOfficialRangeCaveat")));
    cards.push(cardEl);
  });
  return cards;
}
function renderOfficialUnavailableSection(ua){
  var map = econReasonMap();
  var pills = econReasonPills(ua && ua.breakdown, map);
  return econUnavailableCard(
    t("econOfficialUnavailableTitle"),
    (ua && ua.unavailableAttemptCount) || 0,
    pills
  );
}
/* Beginner-friendly three-question guide. Appears at the top of the
 * Insights hierarchy so a user sees the user question, then the answer,
 * then technical details. The keys are conclusion-first; each item names
 * a quantity, then says what it can and cannot prove. */
function renderEconGuide(){
  var card = h("div", "guide-card econ-guide");
  card.setAttribute("data-fl-role", "econ-guide");
  card.appendChild(h("div", "guide-step", t("econGuideTitle")));
  [
    { key: "econGuideWorker", role: "econ-guide-worker" },
    { key: "econGuideExchange", role: "econ-guide-exchange" },
    { key: "econGuideSavings", role: "econ-guide-savings" }
  ].forEach(function(item){
    var line = h("div", "summary-line econ-guide-item");
    line.setAttribute("data-fl-role", item.role);
    line.appendChild(document.createTextNode(t(item.key)));
    card.appendChild(line);
  });
  return card;
}
/* Body of the closed "Technical details" disclosure. Today this holds the
 * renamed "Work kept inside the Worker" boundary card plus its typed
 * unavailable-reason breakdown. Boundary evidence is never relabeled as
 * direct Main Token savings; the closed-by-default home makes clear that
 * the formula is one click away, not hidden. */
function renderEconTechnicalDetailsBody(s){
  var map = econReasonMap();
  var body = hd("div", "econ-technical-body");
  body.appendChild(sec(t("econGapsTitle")));
  var boundaryReasons = econReasonPills(s && s.boundaryReduction && s.boundaryReduction.unavailableReasons, map);
  var boundaryCard = evCard(t("econBoundaryTitle"));
  var boundaryAvailable = (s && s.boundaryReduction && s.boundaryReduction.availableTaskCount) || 0;
  var boundaryUnavailable = (s && s.boundaryReduction && s.boundaryReduction.unavailableTaskCount) || 0;
  if(boundaryAvailable > 0){
    boundaryCard.appendChild(econListPair(
      t("econBoundaryRange"),
      econTokenRangeCompact(s.boundaryReduction.min, s.boundaryReduction.max)
    ));
    boundaryCard.appendChild(evRow(t("econBoundaryAvailable"),
      t("econBoundaryAvailableHint", { count: String(boundaryAvailable) })));
  } else {
    boundaryCard.appendChild(evRow(t("econBoundaryAvailable"), t("econBoundaryNoneHint")));
  }
  boundaryCard.appendChild(evRow(
    t("econUnavailableTasks", { count: String(boundaryUnavailable) }),
    t("econBoundaryUnavailableHint")));
  if(boundaryReasons) boundaryCard.appendChild(boundaryReasons);
  boundaryCard.appendChild(evCaveat(t("econBoundaryCaveat")));
  body.appendChild(boundaryCard);
  return body;
}
function renderPortfolioEconomics(s, isEmpty){
  var f = fr();
  f.appendChild(renderScopeStrip(s && s.scope));
  if(isEmpty){
    f.appendChild(stateMsg("empty", t("econEmpty")));
    f.appendChild(evCaveat(t("econEmptyCaveat")));
    return f;
  }
  // Three plain-language questions first; the rest of the panel
  // answers them. Closing the disclosure reveals the boundary formula
  // and typed unavailable-reason breakdown.
  f.appendChild(renderEconGuide());

  f.appendChild(evCaveat(t("econHeroCaveat")));

  // First decision group: direct-Codex savings, Main-Worker exchange, and
  // Worker Token volume. These are the three numbers the guide describes.
  f.appendChild(sec(t("econPrimaryTitle")));
  var primary = hd("div", "econ-evidence-grid");
  primary.appendChild(renderExchangeSection(s && s.exchange));
  primary.appendChild(renderWorkerVolumeSection(s && s.workerVolume));
  primary.appendChild(renderTokenReconciliationSection(s && s.tokenReconciliation));
  f.appendChild(primary);
  f.appendChild(renderDirectSavingsSection(s && s.directCodexSavings));

  f.appendChild(sec(t("econBudgetRuntimeTitle")));
  var budgetRuntime = hd("div", "econ-evidence-grid");
  budgetRuntime.appendChild(renderBudgetSection(s && s.runtimeBudget));
  budgetRuntime.appendChild(renderRuntimeSection(s && s.runtimeEstimate));
  f.appendChild(budgetRuntime);

  f.appendChild(sec(t("econOfficialSectionTitle")));
  f.appendChild(evCaveat(t("econOfficialSectionCaveat")));
  var officialCards = renderOfficialCostRows(s && s.officialCost);
  officialCards.forEach(function(c){ f.appendChild(c); });
  var rangeCards = renderOfficialRangeCards(s && s.officialCost);
  if(rangeCards.length){
    f.appendChild(sec(t("econOfficialRangeSubsectionTitle")));
    f.appendChild(evCaveat(t("econOfficialRangeSubsectionCaveat")));
    rangeCards.forEach(function(c){ f.appendChild(c); });
  }
  f.appendChild(renderOfficialUnavailableSection(s && s.officialCost && s.officialCost.unavailable));

  // Boundary reduction and other low-level gap evidence live behind a
  // closed-by-default disclosure titled with the glossary key. The label
  // and the renamed title inside both avoid the words "direct savings".
  f.appendChild(collapsedSection(t("econTechnicalDetails"), renderEconTechnicalDetailsBody(s)));

  return f;
}
function renderEconomicsUnavailable(reason){
  var cardEl = h("div", "card");
  cardEl.appendChild(h("div", "card-title mb-4", t("econEvidenceSectionTitle")));
  cardEl.appendChild(evCaveat(
    t("econUnavailableBridgeHint", { reason: reason || t("econUnavailableUnknown") })
  ));
  return cardEl;
}
/** Honest empty / partial / complete state for routing-evidence coverage.
 *  Backend owns every count; this only chooses explanatory copy. */
function routingCoverageState(c){
  var total = c && typeof c.eligibleTerminalTaskCount === "number" ? c.eligibleTerminalTaskCount : 0;
  if(total <= 0) return "empty";
  var withClass = c && typeof c.withTaskClassCount === "number" ? c.withTaskClassCount : 0;
  var withFamily = c && typeof c.withTaskFamilyCount === "number" ? c.withTaskFamilyCount : 0;
  var withDecision = c && typeof c.withCompleteRoutingDecisionCount === "number"
    ? c.withCompleteRoutingDecisionCount : 0;
  if(withClass === total && withFamily === total && withDecision === total) return "complete";
  return "partial";
}
function nCount(value){
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "0";
}
/** One Main-direct decision reason label from closed code. */
function mddReasonLabel(reason){
  var map = {
    "small-clear-change": t("mddReasonSmallClear"),
    "urgent-fix": t("mddReasonUrgentFix"),
    "workers-unavailable": t("mddReasonWorkersUnavailable"),
    "user-requested": t("mddReasonUserRequested"),
    "main-judgment": t("mddReasonMainJudgment")
  };
  return map[reason] || reason;
}
function mddVerificationLabel(v){
  var map = {
    "passed": t("mddVerificationPassed"),
    "failed": t("mddVerificationFailed"),
    "unavailable": t("mddVerificationUnavailable")
  };
  return map[v] || v;
}
function mddBadge(status, outcome){
  if(status === "open") return h("span", "badge badge-warn", t("mddOpenLabel"));
  if(outcome === "abandoned") return h("span", "badge badge-dim", t("mddAbandonedLabel"));
  if(outcome === "completed") return h("span", "badge badge-ok", t("mddCompletedLabel"));
  return badge(status);
}
/** Privacy-safe Main-direct decisions panel for Insights.
 *  Shows only aggregate counts + recent entries; never carries Task content,
 *  Worker evidence, paths, private notes, or Main Token/cost claims. */
function renderMainDirectDecisions(aggregate, recent){
  var panel = h("div", "card");
  panel.setAttribute("data-fl-role", "main-direct-decisions");
  panel.appendChild(h("div", "card-title mb-4", t("mddTitle")));
  panel.appendChild(h("div", "summary-line dim fs11 mb-4", t("mddSub")));

  // Aggregate counts
  var ag = aggregate || {};
  var counts = hd("div", "mt-3");
  counts.setAttribute("data-fl-role", "main-direct-counts");
  counts.appendChild(h("div", "summary-line", t("mddCounts", {
    open: nCount(ag.openCount),
    completed: nCount(ag.completedCount),
    abandoned: nCount(ag.abandonedCount),
    total: nCount(ag.totalCount)
  })));
  if((ag.completedCount || 0) > 0){
    counts.appendChild(h("div", "summary-line dim fs11 mt-2", t("mddCompletedBreakdown", {
      passed: nCount(ag.completedPassedCount),
      failed: nCount(ag.completedFailedCount),
      unavailable: nCount(ag.completedUnavailableCount)
    })));
  }
  panel.appendChild(counts);

  panel.appendChild(evCaveat(t("mddExplanation")));

  // Recent entries
  panel.appendChild(h("div", "summary-line mt-4 mb-2", t("mddRecentTitle")));
  var recentArr = recent || [];
  if(!recentArr.length){
    panel.appendChild(stateMsg("empty", t("mddRecentEmpty")));
  } else {
    var list = hd("div", "mb-4");
    recentArr.forEach(function(r){
      var row = h("div", "summary-line dim fs11");
      row.setAttribute("data-fl-role", "main-direct-recent-entry");
      var reasonText = typeof r.reason === "string" ? mddReasonLabel(r.reason) : r.reason;
      var verificationText = typeof r.verification === "string"
        ? " · " + mddVerificationLabel(r.verification) : "";
      row.appendChild(mddBadge(r.status, r.outcome));
      row.appendChild(document.createTextNode(" " + t("mddRecentEntry", {
        type: r.taskClass || "",
        reason: reasonText || "",
        verification: verificationText,
        count: typeof r.consideredWorkerCount === "number" ? r.consideredWorkerCount : 0
      })));
      list.appendChild(row);
    });
    panel.appendChild(list);
  }

  return panel;
}
function renderMainDirectDecisionsUnavailable(reason){
  var cardEl = h("div", "card");
  cardEl.setAttribute("data-fl-role", "main-direct-decisions");
  cardEl.appendChild(h("div", "card-title mb-4", t("mddTitle")));
  cardEl.appendChild(evCaveat(
    t("mddUnavailableBridgeHint", { reason: reason || t("recUnavailableUnknown") })
  ));
  return cardEl;
}
/** One explanation-first section: traceability counts, comparison-readiness
 *  breakdown, limitation, and next action. No progress bar, no model ranking,
 *  no nested grid. The first block explains what the record count proves
 *  (traceability) and what it cannot prove (fair multi-Worker comparison). */
function renderRoutingCoverage(c){
  var panel = h("div", "card");
  panel.setAttribute("data-fl-role", "routing-evidence-coverage");
  panel.appendChild(h("div", "card-title mb-4", t("recTitle")));

  var state = routingCoverageState(c);
  // Section 1: Traceability: what was recorded
  panel.appendChild(h("div", "summary-line", t("recTraceHeading")));
  var traceCounts = h("div", "mt-3");
  traceCounts.setAttribute("data-fl-role", "routing-coverage-counts");
  [
    ["recTotalLabel", c && c.eligibleTerminalTaskCount],
    ["recClassLabel", c && c.withTaskClassCount],
    ["recFamilyLabel", c && c.withTaskFamilyCount],
    ["recDecisionLabel", c && c.withCompleteRoutingDecisionCount]
  ].forEach(function(row){
    traceCounts.appendChild(evRow(t(row[0]), h("span", "mono", nCount(row[1]))));
  });
  panel.appendChild(traceCounts);
  panel.appendChild(h("div", "summary-line dim fs11 mt-2 mb-4", t("recTraceExplain")));

  if(state !== "empty"){
    panel.appendChild(h("div", "summary-line dim fs11 mb-4", t("recDiversity", {
      classes: nCount(c && c.distinctTaskClassCount),
      families: nCount(c && c.distinctTaskFamilyCount)
    })));
  }

  // Section 2: Comparison readiness: what the complete decisions actually prove
  if(state !== "empty"){
    panel.appendChild(h("div", "summary-line mt-4 mb-2", t("recReadinessHeading")));
    var decTotal = c && typeof c.withCompleteRoutingDecisionCount === "number"
      ? c.withCompleteRoutingDecisionCount : 0;
    if(decTotal > 0){
      var readinessCounts = h("div", "mt-3");
      readinessCounts.setAttribute("data-fl-role", "routing-readiness-counts");
      [
        ["recSingleWorkerLabel", c && c.singleWorkerDecisionCount, t("recSingleWorkerExplain")],
        ["recComparableLabel", c && c.comparableMultiWorkerDecisionCount, t("recComparableExplain")],
        ["recUnknownLabel", c && c.unknownMultiWorkerDecisionCount, t("recUnknownExplain")],
        ["recUnusableLabel", c && c.unusableDecisionCount, t("recUnusableExplain")]
      ].forEach(function(row){
        var line = evRow(t(row[0]), h("span", "mono", nCount(row[1])));
        if(row[2]) line.appendChild(h("div", "dim fs10", row[2]));
        readinessCounts.appendChild(line);
      });
      panel.appendChild(readinessCounts);

      // Comparable sub-counts: exact vs family
      var comparable = c && typeof c.comparableMultiWorkerDecisionCount === "number"
        ? c.comparableMultiWorkerDecisionCount : 0;
      if(comparable > 0){
        var subCounts = h("div", "mt-2 dim fs10");
        subCounts.setAttribute("data-fl-role", "routing-comparable-subcounts");
        subCounts.textContent = t("recComparableSubcounts", {
          exact: nCount(c && c.comparableExactClassDecisionCount),
          family: nCount(c && c.comparableTaskFamilyDecisionCount)
        });
        panel.appendChild(subCounts);
      }
    } else {
      panel.appendChild(h("div", "summary-line dim mt-3 mb-4", t("recNoDecisionsToCompare")));
    }
  }

  panel.appendChild(evCaveat(t("recCaveat")));
  if(state === "empty"){
    panel.appendChild(stateMsg("empty", t("recEmpty")));
    panel.appendChild(h("div", "summary-line mt-4", t("recEmptyNext")));
  } else if(state === "complete"){
    panel.appendChild(h("div", "summary-line mt-4", t("recComplete")));
    panel.appendChild(h("div", "summary-line", t("recCompleteNext")));
  } else {
    panel.appendChild(h("div", "summary-line mt-4", t("recPartial")));
    panel.appendChild(h("div", "summary-line", t("recPartialNext")));
  }
  return panel;
}
function renderRoutingCoverageUnavailable(reason){
  var cardEl = h("div", "card");
  cardEl.setAttribute("data-fl-role", "routing-evidence-coverage");
  cardEl.appendChild(h("div", "card-title mb-4", t("recTitle")));
  cardEl.appendChild(evCaveat(
    t("recUnavailableBridgeHint", { reason: reason || t("recUnavailableUnknown") })
  ));
  return cardEl;
}
function rStats(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  viewEl.appendChild(renderPageStory("insights"));

  // Worker-selection evidence coverage sits above economics / outcome cards
  // so a non-expert can judge evidence readiness before reading costs.
  var recPanel = h("div", "econ-panel");
  recPanel.setAttribute("data-fl-role", "routing-coverage-panel");
  if(S.routingCoverage){
    recPanel.appendChild(renderRoutingCoverage(S.routingCoverage));
  } else if(S.routingCoverageError){
    recPanel.appendChild(renderRoutingCoverageUnavailable(S.routingCoverageError));
  } else {
    recPanel.appendChild(stateMsg("loading", t("recLoading")));
  }
  viewEl.appendChild(recPanel);

  // Main-direct decisions: separate aggregate from Worker routing evidence.
  // Panel appears in the Insights hierarchy before economics, with its own
  // independent bilingual copy that never mentions Worker Attempts beyond zero.
  var mddPanel = h("div", "econ-panel");
  mddPanel.setAttribute("data-fl-role", "main-direct-panel");
  if(S.mainDirectAggregate){
    mddPanel.appendChild(renderMainDirectDecisions(S.mainDirectAggregate, S.mainDirectRecent));
  } else if(S.mainDirectAggregateError){
    mddPanel.appendChild(renderMainDirectDecisionsUnavailable(S.mainDirectAggregateError));
  } else {
    mddPanel.appendChild(stateMsg("loading", t("mddLoading")));
  }
  viewEl.appendChild(mddPanel);

  viewEl.appendChild(h("div", "insights-title", t("econEvidenceSectionTitle")));
  viewEl.appendChild(evCaveat(t("econEvidenceSectionCaveat")));
  var econPanel = h("div", "econ-panel");
  if(S.economics){
    var isEmpty = !S.economics.scope || S.economics.scope.nonEmpty === false;
    econPanel.appendChild(renderPortfolioEconomics(S.economics, isEmpty));
  } else if(S.economicsError){
    econPanel.appendChild(renderEconomicsUnavailable(S.economicsError));
  } else {
    econPanel.appendChild(stateMsg("loading", t("econLoading")));
  }
  viewEl.appendChild(econPanel);

  var stats = S.stats || [];
  viewEl.appendChild(sec(t("statsProviderSectionTitle")));
  viewEl.appendChild(evCaveat(t("statsProviderSectionCaveat")));
  if(!stats.length){
    viewEl.appendChild(stateMsg("empty", t("noStats")));
    return;
  }
  var grid = hd("div", "grid-2");
  stats.forEach(function(s){
    var c = card(null, [
      cardHead(s.provider + " / " + s.model, "",
        h("span", "badge badge-dim", s.sampleSize + " " + t("statsTasksLabel")))
    ]);
    var runtimeSample = s.runtimeEstimateTaskSampleSize || 0;
    var runtimeNote;
    if(runtimeSample > 0 && typeof s.avgRuntimeEstimatePerTaskUsd === "number"){
      runtimeNote = t("statsRuntimeEstimateNote", {
        avg: evAmount(s.avgRuntimeEstimatePerTaskUsd),
        sample: String(runtimeSample),
        total: String(s.sampleSize)
      });
    } else {
      runtimeNote = t("statsRuntimeEstimateMissing", {
        sample: String(s.sampleSize)
      });
    }
    // Dual-outcome block: machine reliability + Main/delivery-backed final
    // delivery. Fields are formatted from the daemon projection only - no
    // JavaScript recomputation that could drift from canonical numbers.
    var machineRate = typeof s.successRate === "number" ? (s.successRate * 100).toFixed(0) : "-";
    var deliveryAccepted = typeof s.acceptedDeliveryCount === "number" ? s.acceptedDeliveryCount : 0;
    var deliverySample = typeof s.acceptedDeliverySampleCount === "number"
      ? s.acceptedDeliverySampleCount : 0;
    var deliveryUnavailable = typeof s.acceptedDeliveryUnavailableCount === "number"
      ? s.acceptedDeliveryUnavailableCount : 0;
    var deliveryRate = typeof s.acceptedDeliveryRate === "number" && deliverySample > 0
      ? (s.acceptedDeliveryRate * 100).toFixed(0) : "-";
    var repairedCount = typeof s.mainRepairedDeliveryCount === "number" ? s.mainRepairedDeliveryCount : 0;
    var checksCount = typeof s.remediationCheckCount === "number" ? s.remediationCheckCount : 0;
    var dual = hd("div", "outcome-pair", [
      hd("div", "outcome-cell", [
        h("div", "outcome-label", t("statsMachineLabel")),
        h("div", "outcome-value", t("statsSuccessLine", {
          rate: machineRate,
          verified: String(s.verifiedSuccessCount || 0)
        }))
      ]),
      hd("div", "outcome-cell", [
        h("div", "outcome-label", t("statsFinalDeliveryLabel")),
        h("div", "outcome-value", t("statsAcceptedDeliveryLine", {
          accepted: String(deliveryAccepted),
          sample: String(deliverySample),
          rate: deliveryRate
        })),
        h("div", "outcome-hint", t("statsFinalDeliveryUnavailable", {
          count: String(deliveryUnavailable)
        })),
        h("div", "outcome-hint", t("statsFinalDeliveryHint", {
          repaired: String(repairedCount),
          checks: String(checksCount)
        }))
      ])
    ]);
    dual.setAttribute("data-fl-role", "dual-outcome");
    c.appendChild(dual);
    c.appendChild(h("div", "summary-line dim fs11 mt-4", t("statsProviderCaveat")));
    c.appendChild(hd("div", "grid-2", [
      h("div", "dim", t("statsRetriesLine", { avg: num(s.avgRetries, 1) })),
      h("div", "dim", t("statsRuntimeLine", { note: runtimeNote })),
      h("div", "dim", t("statsDurationLine", {
        avg: unit(s.avgDurationMs !== undefined ? s.avgDurationMs / 1000 : undefined, 1, "s")
      })),
      h("div", "dim", t("statsFirstActionLine", {
        avg: unit(s.avgTimeToFirstEffectiveActionMs !== undefined ? s.avgTimeToFirstEffectiveActionMs / 1000 : undefined, 1, "s")
      })),
      h("div", "dim", t("statsTurnsLine", { avg: num(s.avgTurns, 1) }))
    ]));
    if(s.failureDistribution && Object.keys(s.failureDistribution).length){
      var rowEl = hd("div", "pill-row", [h("span", "dim fs11", t("statsFailuresLabel"))]);
      Object.entries(s.failureDistribution).forEach(function(e){
        rowEl.appendChild(h("span", "pill-badge", e[0] + ":" + e[1]));
      });
      c.appendChild(rowEl);
    }
    grid.appendChild(c);
  });
  viewEl.appendChild(grid);
}

/* --- Guided setup: Model / Worker / Limits / Connect Main --- */
function hubSettings(){
  return (S.hub && S.hub.settings) || {};
}
function hubProviders(){
  return (S.hub && S.hub.providers) || [];
}
function fillProviderSelect(sel, selected){
  sel.textContent = "";
  var list = hubProviders();
  if(!list.length){
    ["deepseek","qwen","minimax","glm","volcengine","xai","openai"].forEach(function(n){
      var o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o);
    });
  } else {
    list.forEach(function(p){
      var o = document.createElement("option");
      o.value = p.name;
      o.textContent = (p.label || p.name) + " · " + t(p.configured ? "providerKeyReady" : "providerKeyMissing");
      sel.appendChild(o);
    });
  }
  if(selected) sel.value = selected;
}
function guideCard(step, title, body){
  var c = h("div", "guide-card");
  var stepText = /^\d+$/.test(String(step))
    ? t("guideStep", { step: String(step) })
    : String(step);
  c.appendChild(h("div", "guide-step", stepText));
  c.appendChild(h("div", "card-title", title));
  c.appendChild(h("div", "summary-line mb-8", body));
  return c;
}
/* Shared top-level page story: one clear reason to be here, followed by the
 * input -> ForkLight work -> result -> next-action flow. Pure presentation
 * from localized page copy: no mutation and no invented runtime state. */
function renderPageStory(page){
  var card = h("div", "guide-card page-story");
  card.setAttribute("data-fl-role", "page-story");
  card.setAttribute("data-page-story", page);
  var pageKey = page.charAt(0).toUpperCase() + page.slice(1);
  var purpose = h("div", "page-story-purpose");
  purpose.setAttribute("data-fl-role", "page-story-purpose");
  purpose.appendChild(h("div", "page-story-purpose-label", t("pageStoryLabelPurpose")));
  purpose.appendChild(h("div", "page-story-purpose-body", t("pageStory" + pageKey + "Purpose")));
  var flow = h("div", "page-story-flow");
  [
    { slot: "input", label: "pageStoryLabelInput" },
    { slot: "process", label: "pageStoryLabelProcess" },
    { slot: "output", label: "pageStoryLabelOutput" },
    { slot: "next", label: "pageStoryLabelNext" }
  ].forEach(function(item, index){
    var row = h("div", "page-story-slot");
    row.setAttribute("data-fl-role", "page-story-" + item.slot);
    row.appendChild(h("div", "page-story-marker", String(index + 1)));
    var content = h("div", "page-story-slot-content");
    content.appendChild(h("div", "page-story-label", t(item.label)));
    var bodyKey = "pageStory" + pageKey
      + item.slot.charAt(0).toUpperCase() + item.slot.slice(1);
    content.appendChild(h("div", "page-story-body", t(bodyKey)));
    row.appendChild(content);
    flow.appendChild(row);
  });
  /* Work and Workers: the generic four-step story is collapsed so the actual
   * surface leads the first screen. Work hides the whole story behind one
   * disclosure; Workers keeps the one-line purpose (the single user outcome)
   * visible and collapses only the four-step flow. Other pages keep the
   * always-open page story. */
  if(page === "work"){
    card.className = "guide-card page-story page-story-work";
    var details = document.createElement("details");
    details.className = "page-story-disclosure";
    details.setAttribute("data-fl-role", "page-story-disclosure");
    var summary = document.createElement("summary");
    summary.className = "page-story-disclosure-summary";
    summary.setAttribute("data-fl-role", "page-story-disclosure-toggle");
    summary.textContent = t("pageStoryWorkHow");
    details.appendChild(summary);
    var body = h("div", "page-story-disclosure-body");
    body.appendChild(purpose);
    body.appendChild(flow);
    details.appendChild(body);
    card.appendChild(details);
    return card;
  }
  if(page === "workers"){
    card.className = "guide-card page-story page-story-workers";
    card.appendChild(purpose);
    var workersDetails = document.createElement("details");
    workersDetails.className = "page-story-disclosure";
    workersDetails.setAttribute("data-fl-role", "page-story-disclosure");
    var workersSummary = document.createElement("summary");
    workersSummary.className = "page-story-disclosure-summary";
    workersSummary.setAttribute("data-fl-role", "page-story-disclosure-toggle");
    workersSummary.textContent = t("pageStoryWorkersHow");
    workersDetails.appendChild(workersSummary);
    var workersBody = h("div", "page-story-disclosure-body");
    workersBody.appendChild(flow);
    workersDetails.appendChild(workersBody);
    card.appendChild(workersDetails);
    return card;
  }
  card.appendChild(purpose);
  card.appendChild(flow);
  return card;
}
function formActions(primaryLabel, onSubmit, secondary){
  var row = h("div", "actions");
  var btn = h("button", "btn primary", primaryLabel);
  btn.type = "submit";
  row.appendChild(btn);
  if(secondary){
    var b2 = h("button", "btn", secondary.label);
    b2.type = "button";
    b2.addEventListener("click", secondary.onClick);
    row.appendChild(b2);
  }
  return row;
}

/* --- Worker advanced-policy helpers --- */
var ADV_FIELD_LABELS = {
  maxDurationMs: "workersAdvMaxDuration",
  observedTokenCeiling: "workersAdvObservedTokenCeiling",
  noProgressTimeoutMs: "workersAdvNoEffectiveProgress",
  workerStopGraceMs: "workersAdvStopGrace",
  fileLimit: "workersAdvFileLimit",
  fileLimitMode: "workersAdvFileLimitMode",
  changedLineLimit: "workersAdvChangedLineLimit",
  changedLineLimitMode: "workersAdvChangedLineLimitMode",
  baseMaxAttempts: "workersAdvBaseAttempts",
  maxExtraAttempts: "workersAdvExtraAttempts",
  maxConcurrency: "workersAdvMaxConcurrency",
  completionMode: "workersAdvCompletionMode",
  changeBudgetMode: "workersAdvChangeBudgetMode",
  maxAdaptationRounds: "workersAdvMaxAdaptationRounds",
  maxMainCorrections: "workersAdvMaxMainCorrections",
  maxMainReverifications: "workersAdvMaxMainReverifications",
  maxWorkerValidationRepairs: "workersAdvMaxValidationRepairs"
};
var ADV_MODE_FIELDS = ["fileLimitMode", "changedLineLimitMode", "completionMode", "changeBudgetMode"];
var ADV_BLANK_NULL_FIELDS = ["maxDurationMs", "observedTokenCeiling", "noProgressTimeoutMs", "fileLimit", "changedLineLimit"];
/* Loose development defaults: size ceilings do not fail work, while retry/adaptation
 * counts stay explicitly bounded. These are starting values only; every field remains
 * editable per Worker and the server-side effective-policy preview is authoritative. */
function advancedDevelopmentDefaults(){
  var hubSettings = S.hub && S.hub.settings || {};
  return {
    noProgressTimeoutMs: hubSettings.noProgressTimeoutMs || 1800000,
    workerStopGraceMs: 10000,
    baseMaxAttempts: 1,
    maxExtraAttempts: 0,
    maxConcurrency: hubSettings.maxConcurrency || 1,
    maxAdaptationRounds: 0,
    maxMainCorrections: 1,
    maxMainReverifications: 1
  };
}
var ADV_GROUP_ORDER = [
  { title: "maxDurationMs", fields: ["maxDurationMs"] },
  { title: "observedTokenCeiling", fields: ["observedTokenCeiling"] },
  { title: "noProgressTimeoutMs", fields: ["noProgressTimeoutMs"] },
  { title: "workerStopGraceMs", fields: ["workerStopGraceMs"] },
  { title: "fileLimit", fields: ["fileLimit", "fileLimitMode"] },
  { title: "changedLineLimit", fields: ["changedLineLimit", "changedLineLimitMode"] },
  { title: "baseMaxAttempts", fields: ["baseMaxAttempts", "maxExtraAttempts"] },
  { title: "maxConcurrency", fields: ["maxConcurrency"] },
  { title: "completionMode", fields: ["completionMode", "changeBudgetMode"] },
  { title: "maxAdaptationRounds", fields: ["maxAdaptationRounds"] },
  { title: "maxMainCorrections", fields: ["maxMainCorrections"] },
  { title: "maxMainReverifications", fields: ["maxMainReverifications"] },
  { title: "maxWorkerValidationRepairs", fields: ["maxWorkerValidationRepairs"] }
];
/* FL-116A: which editor group owns each advanced-policy group. "stops" is stop
 * conditions and scale; "recovery" is the finite repair/verification
 * mechanisms. The buckets are presentation only; every field keeps its
 * canonical value and the shared server-side resolver stays authoritative. */
var ADV_GROUP_BUCKETS = {
  maxDurationMs: "stops",
  observedTokenCeiling: "stops",
  noProgressTimeoutMs: "stops",
  workerStopGraceMs: "stops",
  fileLimit: "stops",
  changedLineLimit: "stops",
  baseMaxAttempts: "stops",
  maxExtraAttempts: "stops",
  maxConcurrency: "stops",
  completionMode: "recovery",
  changeBudgetMode: "recovery",
  maxAdaptationRounds: "recovery",
  maxMainCorrections: "recovery",
  maxMainReverifications: "recovery",
  maxWorkerValidationRepairs: "recovery"
};
/* Fail-loud mapping guard: every AdvancedPolicy group must belong to an editor
 * bucket ("stops" or "recovery"). If a future group is added without a bucket,
 * the page throws at load instead of silently dropping the control. */
(function workerValidateGroupBucketCoverage(){
  ADV_GROUP_ORDER.forEach(function(group){
    if(!ADV_GROUP_BUCKETS[group.title]){
      throw new Error("FL-116A: AdvancedPolicy group " + group.title + " has no editor bucket");
    }
  });
})();
/* Duration fields are edited as readable value + unit pairs on the normal path
 * while the backend millisecond contract is preserved exactly on save and
 * readback. Inherit/unlimited semantics stay unchanged. */
var ADV_DURATION_FIELDS = ["maxDurationMs", "noProgressTimeoutMs", "workerStopGraceMs"];
var ADV_DURATION_UNITS = [
  ["hours", "workersDurationHoursUnit"],
  ["minutes", "workersDurationMinutesUnit"],
  ["seconds", "workersDurationSecondsUnit"],
  ["ms", "workersDurationMsUnit"]
];
function msDurationParts(ms){
  if(typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return { value: "", unit: "minutes" };
  if(ms % 3600000 === 0) return { value: String(ms / 3600000), unit: "hours" };
  if(ms % 60000 === 0) return { value: String(ms / 60000), unit: "minutes" };
  if(ms % 1000 === 0) return { value: String(ms / 1000), unit: "seconds" };
  return { value: String(ms), unit: "ms" };
}
function durationPartsToMs(value, unit){
  var raw = String(value == null ? "" : value).trim();
  if(raw === "") return undefined;
  var n = Number(raw);
  if(!Number.isFinite(n) || n < 0) return undefined;
  var factor = unit === "hours" ? 3600000 : unit === "minutes" ? 60000 : unit === "seconds" ? 1000 : 1;
  return Math.round(n * factor);
}

/* Contract Quality field labels, bound to the shared 8-field validator. */
var QUALITY_FIELD_LABELS = {
  mode: "workersQualityMode",
  maxFiles: "workersQualityMaxFiles",
  maxDiffLines: "workersQualityMaxDiffLines",
  maxFocusPaths: "workersQualityMaxFocusPaths",
  minScenarios: "workersQualityMinScenarios",
  minCallChainSteps: "workersQualityMinCallChainSteps",
  minOutcomeCharacters: "workersQualityMinOutcomeCharacters",
  minModuleResponsibilityCharacters: "workersQualityMinModuleResponsibilityCharacters"
};
var QUALITY_MODE_OPTIONS = [
  ["", "workersQualityInherit"],
  ["hard", "workersQualityModeHard"],
  ["warn", "workersQualityModeWarn"],
  ["score", "workersQualityModeScore"],
  ["off", "workersQualityModeOff"]
];
var QUALITY_MAX_FIELDS = ["maxFiles", "maxDiffLines", "maxFocusPaths"];
var QUALITY_MIN_FIELDS = [
  "minScenarios", "minCallChainSteps", "minOutcomeCharacters", "minModuleResponsibilityCharacters"
];
var QUALITY_FIELD_ORDER = [
  { top: "mode", row: ["mode"] },
  { top: "maxFiles", row: ["maxFiles", "maxDiffLines"] },
  { top: "maxFocusPaths", row: ["maxFocusPaths"] },
  { top: "minScenarios", row: ["minScenarios", "minCallChainSteps"] },
  { top: "minOutcomeCharacters", row: ["minOutcomeCharacters", "minModuleResponsibilityCharacters"] }
];
function qualityModeLabel(value){
  var key = {
    hard: "workersQualityModeHard",
    warn: "workersQualityModeWarn",
    score: "workersQualityModeScore",
    off: "workersQualityModeOff"
  }[value];
  return key ? t(key) : t("workersQualityInherit");
}
/* Pricing route options are the only known safe identifiers the UI exposes.
 * The route selects the official price table and currency for evidence; it is
 * not the Provider endpoint and it is not an invoice. The Hub never infers
 * a route from Provider, model, endpoint, API key, geography, or prior Tasks. */
var PRICING_ROUTE_OPTIONS = [
  "deepseek-direct-payg",
  "minimax-international-direct-payg",
  "minimax-china-direct-payg",
  "volcengine-coding-plan-subscription"
];
function pricingRouteLabel(route){
  if(route === "deepseek-direct-payg") return t("workersPricingRouteDeepseek");
  if(route === "minimax-international-direct-payg") return t("workersPricingRouteMiniMaxIntl");
  if(route === "minimax-china-direct-payg") return t("workersPricingRouteMiniMaxCN");
  if(route === "volcengine-coding-plan-subscription") return t("workersPricingRouteVolcengine");
  return route;
}

function buildAdvancedFields(bucket){
  var container = h("div", "advanced-fields");
  var developmentDefaults = advancedDevelopmentDefaults();
  ADV_GROUP_ORDER.forEach(function(group){
    if(bucket && ADV_GROUP_BUCKETS[group.title] !== bucket) return;
    var row = h("div", "advanced-row");
    group.fields.forEach(function(field){
      /* The finite validation-repair allowance is a select (inherit / off /
       * one / custom) plus a custom count input. Plain copy explains that the
       * value is a limited allowance, never an endless loop. */
      if(field === "maxWorkerValidationRepairs"){
        var repLab = h("label", "", t(ADV_FIELD_LABELS[field]));
        var repSel = h("select", "");
        repSel.setAttribute("data-repair-mode", "true");
        [
          ["inherit", "workersAdvRepairInherit"],
          ["off", "workersAdvRepairOff"],
          ["one", "workersAdvRepairOne"],
          ["custom", "workersAdvRepairCustom"]
        ].forEach(function(pair){
          var o = document.createElement("option");
          o.value = pair[0]; o.textContent = t(pair[1]); repSel.appendChild(o);
        });
        repSel.value = "inherit";
        repLab.appendChild(repSel);
        var repInput = h("input", "");
        repInput.type = "number";
        repInput.setAttribute("data-repair-value", "true");
        repInput.min = "2"; repInput.step = "1";
        repInput.placeholder = t("workersAdvRepairCustomPh");
        repInput.disabled = true;
        repLab.appendChild(repInput);
        var repHint = h("div", "summary-line dim fs11 mt-4", t("workersAdvMaxValidationRepairsHint"));
        repLab.appendChild(repHint);
        repSel.addEventListener("change", function(){
          repInput.disabled = repSel.value !== "custom";
        });
        row.appendChild(repLab);
        return;
      }
      var lab = h("label", "", t(ADV_FIELD_LABELS[field]));
      if(ADV_MODE_FIELDS.indexOf(field) >= 0){
        var sel = buildPolicyModeSelect(null);
        sel.setAttribute("data-adv", field);
        sel.value = field === "fileLimitMode"
          || field === "changedLineLimitMode"
          || field === "changeBudgetMode"
          ? "warn"
          : "hard";
        lab.appendChild(sel);
      } else if(ADV_DURATION_FIELDS.indexOf(field) >= 0){
        /* Readable duration adapter: value + unit pair on the normal path, exact
         * backend milliseconds preserved by durationPartsToMs on collect. */
        var wrap = h("div", "duration-field");
        wrap.setAttribute("data-adv-duration", field);
        var vInp = h("input", "");
        vInp.type = "number";
        vInp.setAttribute("data-adv-duration-value", field);
        vInp.min = "0"; vInp.step = "1";
        vInp.placeholder = ADV_BLANK_NULL_FIELDS.indexOf(field) >= 0
          ? t("workersBlankUnlimited") : t("workersBlankInherit");
        var uSel = h("select", "");
        uSel.setAttribute("data-adv-duration-unit", field);
        ADV_DURATION_UNITS.forEach(function(pair){
          var o = document.createElement("option");
          o.value = pair[0]; o.textContent = t(pair[1]); uSel.appendChild(o);
        });
        uSel.value = "minutes";
        if(developmentDefaults[field] !== undefined){
          var parts = msDurationParts(developmentDefaults[field]);
          vInp.value = parts.value;
          uSel.value = parts.unit;
        }
        wrap.appendChild(vInp);
        wrap.appendChild(uSel);
        lab.appendChild(wrap);
      } else {
        var inp = h("input", "");
        inp.type = "number";
        inp.setAttribute("data-adv", field);
        if(ADV_BLANK_NULL_FIELDS.indexOf(field) >= 0){
          inp.placeholder = t("workersBlankUnlimited");
        } else {
          inp.placeholder = t("workersBlankInherit");
        }
        if(field === "workerStopGraceMs" || field === "baseMaxAttempts" || field === "maxConcurrency"){
          inp.min = "1";
          inp.step = "1";
        } else if(field === "maxExtraAttempts" || field === "maxAdaptationRounds" || field === "maxMainCorrections" || field === "maxMainReverifications"){
          inp.min = "0";
          inp.step = "1";
        } else {
          inp.min = "0";
          inp.step = "1";
        }
        if(developmentDefaults[field] !== undefined){
          inp.value = String(developmentDefaults[field]);
        }
        lab.appendChild(inp);
      }
      row.appendChild(lab);
    });
    container.appendChild(row);
    // Help text for the no-effective-progress stop: blank/null disables only
    // this stop and does not imply a total duration cap.
    if(group.fields.indexOf("noProgressTimeoutMs") >= 0){
      container.appendChild(h("div", "summary-line dim fs11 mb-8", t("workersAdvNoEffectiveProgressHelp")));
    }
    if(group.fields.indexOf("maxDurationMs") >= 0){
      container.appendChild(h("div", "summary-line dim fs11 mb-8", t("workersAdvMaxDurationHelp")));
    }
  });
  return container;
}

function collectAdvancedPatch(){
  var patch = {};
  $$("[data-adv]").forEach(function(el){
    var field = el.getAttribute("data-adv");
    if(!field) return;
    if(el.tagName === "SELECT"){
      patch[field] = el.value;
    } else {
      var raw = el.value.trim();
      if(raw === ""){
        if(ADV_BLANK_NULL_FIELDS.indexOf(field) >= 0){
          patch[field] = null;
        }
      } else {
        var num = Number(raw);
        if(!Number.isNaN(num) && Number.isFinite(num)){
          patch[field] = num;
        }
      }
    }
  });
  /* Readable duration pairs map back to the exact backend millisecond contract.
   * A blank value keeps the field's inherit (omitted) or unlimited (null)
   * semantics unchanged. */
  $$("[data-adv-duration]").forEach(function(wrap){
    var field = wrap.getAttribute("data-adv-duration");
    if(!field) return;
    var vInp = wrap.querySelector("[data-adv-duration-value]");
    var uSel = wrap.querySelector("[data-adv-duration-unit]");
    var ms = durationPartsToMs(vInp ? vInp.value : "", uSel ? uSel.value : "minutes");
    if(ms === undefined){
      if(ADV_BLANK_NULL_FIELDS.indexOf(field) >= 0){
        patch[field] = null;
      }
    } else {
      patch[field] = ms;
    }
  });
  /* The finite validation-repair allowance control: inherit omits the field so
   * the Worker inherits the global default; off writes 0; one writes 1; custom
   * writes the typed finite count. */
  var repairMode = document.querySelector("[data-repair-mode]");
  if(repairMode){
    var mode = repairMode.value;
    if(mode === "off"){
      patch.maxWorkerValidationRepairs = 0;
    } else if(mode === "one"){
      patch.maxWorkerValidationRepairs = 1;
    } else if(mode === "custom"){
      var repairInput = document.querySelector("[data-repair-value]");
      var rawRepair = repairInput ? repairInput.value.trim() : "";
      if(rawRepair !== ""){
        var numRepair = Number(rawRepair);
        if(!Number.isNaN(numRepair) && Number.isFinite(numRepair)
            && Number.isInteger(numRepair) && numRepair >= 0){
          patch.maxWorkerValidationRepairs = numRepair;
        }
      }
    }
  }
  return patch;
}

function hydrateAdvancedFields(container, advancedPolicy){
  if(!advancedPolicy) return;
  container.querySelectorAll("[data-adv]").forEach(function(el){
    var field = el.getAttribute("data-adv");
    if(!field) return;
    var val = advancedPolicy[field];
    if(val === undefined) return;
    if(el.tagName === "SELECT"){
      el.value = String(val);
    } else if(val === null){
      el.value = "";
    } else {
      el.value = String(val);
    }
  });
  container.querySelectorAll("[data-adv-duration]").forEach(function(wrap){
    var field = wrap.getAttribute("data-adv-duration");
    if(!field) return;
    var val = advancedPolicy[field];
    var parts = msDurationParts(typeof val === "number" ? val : null);
    var vInp = wrap.querySelector("[data-adv-duration-value]");
    var uSel = wrap.querySelector("[data-adv-duration-unit]");
    if(vInp) vInp.value = parts.value;
    if(uSel) uSel.value = parts.unit;
  });
  var repairMode = container.querySelector("[data-repair-mode]");
  if(!repairMode) return;
  var repairInput = container.querySelector("[data-repair-value]");
  var repairVal = advancedPolicy.maxWorkerValidationRepairs;
  if(repairVal === undefined){
    repairMode.value = "inherit";
    if(repairInput){ repairInput.value = ""; repairInput.disabled = true; }
  } else if(repairVal === 0){
    repairMode.value = "off";
    if(repairInput){ repairInput.value = ""; repairInput.disabled = true; }
  } else if(repairVal === 1){
    repairMode.value = "one";
    if(repairInput){ repairInput.value = ""; repairInput.disabled = true; }
  } else {
    repairMode.value = "custom";
    if(repairInput){ repairInput.value = String(repairVal); repairInput.disabled = false; }
  }
}

/* Readable value for a finite validation-repair allowance. */
function validationRepairCountText(value){
  if(value === 0) return t("workersAdvRepairValueOff");
  if(value === 1) return t("workersAdvRepairValueOne");
  if(typeof value === "number" && Number.isSafeInteger(value) && value > 1){
    return t("workersAdvRepairValueCount", { count: String(value) });
  }
  return "-";
}

/* Plain-language consequence for the preview row: names inherit vs override and
 * the finite nature without forcing policy provenance vocabulary. */
function validationRepairConsequenceText(row){
  var value = row && row.value;
  if(value === 0){
    return t("workersAdvRepairConsequenceZero");
  }
  var count = typeof value === "number" ? String(value) : "1";
  var sourceKey = row.source === "task"
    ? "workersAdvRepairConsequenceTask"
    : row.source === "worker"
      ? "workersAdvRepairConsequenceWorker"
      : "workersAdvRepairConsequenceGlobal";
  return t(sourceKey, { count: count });
}

function buildQualityFields(){
  var container = h("div", "advanced-fields quality-fields");
  QUALITY_FIELD_ORDER.forEach(function(group){
    var row = h("div", "advanced-row");
    group.row.forEach(function(field){
      var lab = h("label", "", t(QUALITY_FIELD_LABELS[field]));
      if(field === "mode"){
        var sel = h("select", "");
        sel.setAttribute("data-quality", field);
        QUALITY_MODE_OPTIONS.forEach(function(pair){
          var o = document.createElement("option");
          o.value = pair[0]; o.textContent = t(pair[1]); sel.appendChild(o);
        });
        sel.value = "";
        lab.appendChild(sel);
      } else if(QUALITY_MAX_FIELDS.indexOf(field) >= 0){
        var state = h("select", "");
        state.setAttribute("data-quality-max-mode", field);
        [
          ["inherit", "workersQualityInherit"],
          ["unlimited", "workersQualityUnlimited"],
          ["limited", "workersQualityLimited"]
        ].forEach(function(pair){
          var option = document.createElement("option");
          option.value = pair[0]; option.textContent = t(pair[1]); state.appendChild(option);
        });
        state.value = "inherit";
        var inp = h("input", "");
        inp.type = "number";
        inp.setAttribute("data-quality-max-value", field);
        inp.placeholder = t("workersQualityLimitValue");
        inp.min = "1"; inp.step = "1";
        inp.disabled = true;
        lab.appendChild(state);
        lab.appendChild(inp);
      } else {
        var inp2 = h("input", "");
        inp2.type = "number";
        inp2.setAttribute("data-quality", field);
        inp2.placeholder = t("workersBlankInherit");
        inp2.min = "0"; inp2.step = "1";
        lab.appendChild(inp2);
      }
      row.appendChild(lab);
    });
    container.appendChild(row);
  });
  return container;
}

function collectQualityPatch(){
  var patch = {};
  $$("[data-quality]").forEach(function(el){
    var field = el.getAttribute("data-quality");
    if(!field) return;
    if(field === "mode" && el.tagName === "SELECT"){
      if(el.value) patch[field] = el.value;
    } else {
      var raw2 = el.value.trim();
      if(raw2 !== "") patch[field] = Number(raw2);
    }
  });
  $$("[data-quality-max-mode]").forEach(function(state){
    var field = state.getAttribute("data-quality-max-mode");
    if(!field || state.value === "inherit") return;
    if(state.value === "unlimited"){
      patch[field] = null;
      return;
    }
    var input = document.querySelector('[data-quality-max-value="' + field + '"]');
    patch[field] = Number(input && input.value !== "" ? input.value : 0);
  });
  return patch;
}

function syncQualityMaximumInput(state){
  var field = state.getAttribute("data-quality-max-mode");
  if(!field) return;
  var input = document.querySelector('[data-quality-max-value="' + field + '"]');
  if(input) input.disabled = state.value !== "limited";
}

function hydrateQualityFields(container, contractQuality){
  var quality = contractQuality || {};
  container.querySelectorAll("[data-quality]").forEach(function(el){
    var field = el.getAttribute("data-quality");
    if(!field) return;
    var val = quality[field];
    el.value = val === undefined ? "" : String(val);
  });
  container.querySelectorAll("[data-quality-max-mode]").forEach(function(state){
    var field = state.getAttribute("data-quality-max-mode");
    var value = quality[field];
    state.value = value === undefined ? "inherit" : (value === null ? "unlimited" : "limited");
    var input = container.querySelector('[data-quality-max-value="' + field + '"]');
    if(input) input.value = typeof value === "number" ? String(value) : "";
    syncQualityMaximumInput(state);
  });
}

function buildPricingRouteField(){
  var lab = h("label", "wp-pricing-route-field");
  lab.setAttribute("for", "fl-wp-pricing-route");
  lab.appendChild(document.createTextNode(t("workersPricingRoute")));
  var sel = h("select", "");
  sel.id = "fl-wp-pricing-route";
  sel.setAttribute("data-wp-pricing-route", "true");
  var blank = document.createElement("option");
  blank.value = "";
  blank.textContent = t("workersPricingRouteUnset");
  sel.appendChild(blank);
  PRICING_ROUTE_OPTIONS.forEach(function(route){
    var o = document.createElement("option");
    o.value = route;
    o.textContent = pricingRouteLabel(route);
    sel.appendChild(o);
  });
  lab.appendChild(sel);
  lab.appendChild(h("div", "summary-line dim fs11 mt-4", t("workersPricingRouteHint")));
  return lab;
}

function hydratePricingRouteField(container, profile){
  var sel = container.querySelector("#fl-wp-pricing-route");
  if(!sel) return;
  if(profile && typeof profile.pricingRoute === "string" && profile.pricingRoute){
    if(PRICING_ROUTE_OPTIONS.indexOf(profile.pricingRoute) < 0){
      var existing = document.createElement("option");
      existing.value = profile.pricingRoute;
      existing.textContent = t("workersPricingRouteExisting", { route: profile.pricingRoute });
      sel.appendChild(existing);
    }
    sel.value = profile.pricingRoute;
  } else {
    sel.value = "";
  }
}

function collectPricingRouteField(form){
  var sel = form.querySelector("#fl-wp-pricing-route");
  if(!sel) return undefined;
  var v = sel.value;
  return v ? v : undefined;
}

function scheduleWorkerPreview(runtime){
  if(S.workerPreviewTimer){ clearTimeout(S.workerPreviewTimer); }
  S.workerPreviewTimer = setTimeout(function(){
    fetchWorkerPreview(runtime);
  }, 300);
}

function fetchWorkerPreview(runtime){
  var existingPolicy = {};
  if(S.workerEditId){
    var prof = (S.hub && S.hub.workerProfiles && S.hub.workerProfiles.profiles || []).find(function(p){
      return p.id === S.workerEditId;
    });
    if(prof && prof.advancedPolicy){
      existingPolicy = Object.assign({}, prof.advancedPolicy);
      // The finite validation-repair control is fully described by the draft:
      // an explicit "inherit" choice must not be shadowed by the saved value.
      delete existingPolicy.maxWorkerValidationRepairs;
    }
  }
  var draft = collectAdvancedPatch();
  var draftQuality = collectQualityPatch();
  var body = { runtime: runtime, draftAdvancedPolicy: draft, draftContractQuality: draftQuality };
  if(Object.keys(existingPolicy).length > 0) body.existingAdvancedPolicy = existingPolicy;
  postJSON("/api/worker-advanced-preview", body)
    .then(function(res){
      S.workerPreviewRows = res.preview || [];
      S.workerQualityPreviewRows = res.previewQualityPolicy || [];
      renderWorkerPreview(S.workerPreviewRows);
      renderQualityPreview(S.workerQualityPreviewRows);
      if(typeof S.workerSummariesRefresher === "function") S.workerSummariesRefresher();
    })
    .catch(function(){
      S.workerPreviewRows = [];
      S.workerQualityPreviewRows = [];
      renderWorkerPreview([]); renderQualityPreview([]);
    });
}

/* FL-116A draft continuity: capture the full unsaved form before a deliberate
 * rWorker rebuild (language switch, tab return) so no value is lost. The
 * collectors and stable control ids read the live form; nothing is saved. */
function workerCaptureDraftFromDom(){
  var form = viewEl.querySelector("form.configure-form");
  if(!form) return null;
  var v = function(id){ var el = form.querySelector("#" + id); return el ? el.value : ""; };
  /* Semantic patches below are what save consumes. The ordered control image
   * additionally preserves intentionally blank values and exact select modes
   * across a presentation-only rebuild; it never leaves the browser. */
  var controlValues = Array.prototype.map.call(
    form.querySelectorAll("input, select, textarea"),
    function(el){
      return {
        tag: el.tagName,
        type: el.type || "",
        value: el.value,
        checked: !!el.checked
      };
    }
  );
  var draft = {
    label: v("fl-wp-label"),
    workerId: v("fl-wp-id"),
    runtime: v("fl-wp-runtime"),
    model: v("fl-wp-model"),
    effort: v("fl-wp-effort"),
    executionPreference: v("fl-wp-execution"),
    budgetMode: v("fl-wp-budget-mode"),
    budget: v("fl-wp-budget"),
    networkMode: v("fl-wp-network-mode"),
    networkHttp: v("fl-wp-network-http"),
    networkHttps: v("fl-wp-network-https"),
    networkNoProxy: v("fl-wp-network-noproxy"),
    pricingRoute: collectPricingRouteField(form),
    advancedPolicy: collectAdvancedPatch(),
    contractQuality: collectQualityPatch(),
    openGroups: Object.assign({}, S.workerOpenGroups),
    controlValues: controlValues
  };
  return draft;
}

/* Replay only when the rebuilt form has the exact same control shape. This is
 * deliberately fail-closed: a future editor structure change falls back to
 * the semantic restore instead of assigning a value to the wrong control. */
function workerReplayCapturedControls(form, draft){
  if(!form || !draft || !Array.isArray(draft.controlValues)) return false;
  var controls = Array.prototype.slice.call(form.querySelectorAll("input, select, textarea"));
  if(controls.length !== draft.controlValues.length) return false;
  for(var i = 0; i < controls.length; i++){
    var saved = draft.controlValues[i];
    var current = controls[i];
    if(!saved || current.tagName !== saved.tag || (current.type || "") !== saved.type) return false;
  }
  for(var j = 0; j < controls.length; j++){
    var value = draft.controlValues[j];
    var control = controls[j];
    if(control.tagName === "SELECT"){
      if(Array.prototype.some.call(control.options || [], function(option){ return option.value === value.value; })){
        control.value = value.value;
      }
    } else {
      control.value = value.value;
    }
    if(control.type === "checkbox" || control.type === "radio") control.checked = value.checked;
  }
  return true;
}

/* Beginner consequence labels avoid the technical field-name parentheticals
 * (ms, blank = unlimited) so the plain-language summary stays readable. */
var WORKER_CONSEQUENCE_LABELS = {
  maxDurationMs: "workersConsequenceMaxDuration",
  observedTokenCeiling: "workersConsequenceTokenCeiling",
  noProgressTimeoutMs: "workersConsequenceNoProgress",
  fileLimit: "workersConsequenceFileLimit",
  changedLineLimit: "workersConsequenceLineLimit"
};
function workerConsequenceFieldLabel(field){
  var key = WORKER_CONSEQUENCE_LABELS[field];
  return key ? t(key) : (t(ADV_FIELD_LABELS[field]) || field);
}
function workerPreviewConsequences(rows){
  var out = [];
  rows.forEach(function(r){
    if(r.field === "maxWorkerValidationRepairs"){
      out.push(validationRepairConsequenceText(r));
      return;
    }
    if(r.unlimited){
      out.push(t("workersPreviewUnlimitedLine", { setting: workerConsequenceFieldLabel(r.field) }));
      return;
    }
    if(r.value === null || r.value === undefined) return;
    if(r.field === "maxDurationMs"){
      out.push(t("workersPreviewDurationLine", { value: readableDuration(r.value) }));
    } else if(r.field === "noProgressTimeoutMs"){
      out.push(t("workersPreviewNoProgressLine", { value: readableDuration(r.value) }));
    } else if(r.field === "observedTokenCeiling"){
      out.push(t("workersPreviewTokenLine", { count: String(r.value) }));
    } else if(r.field === "fileLimit"){
      out.push(t("workersPreviewFileLine", { count: String(r.value) }));
    } else if(r.field === "changedLineLimit"){
      out.push(t("workersPreviewLineLine", { count: String(r.value) }));
    } else if(r.field === "maxConcurrency"){
      out.push(t("workersPreviewConcurrencyLine", { count: String(r.value) }));
    } else if(r.field === "baseMaxAttempts"){
      var extraRow = rows.find(function(x){ return x.field === "maxExtraAttempts"; });
      var extra = extraRow && typeof extraRow.value === "number" ? extraRow.value : 0;
      out.push(t(extra > 0 ? "workersPreviewAttemptsLine" : "workersPreviewAttemptsNoExtraLine", {
        base: String(r.value),
        extra: String(extra)
      }));
    } else if(r.field === "maxMainCorrections"){
      out.push(t("workersPreviewMainCorrectionsLine", { count: String(r.value) }));
    } else if(r.field === "maxMainReverifications"){
      out.push(t("workersPreviewReverifyLine", { count: String(r.value) }));
    } else if(r.field === "maxAdaptationRounds"){
      out.push(t(r.value === 0 ? "workersPreviewAdaptationOffLine" : "workersPreviewAdaptationLine", {
        count: String(r.value)
      }));
    }
  });
  return out;
}

function renderWorkerPreview(rows){
  var panel = document.getElementById("fl-worker-preview");
  if(!panel) return;
  panel.textContent = "";
  var title = h("div", "card-title mb-4", t("workersPreviewTitle"));
  panel.appendChild(title);
  if(!rows.length){
    panel.appendChild(h("div", "summary-line dim", t("workersPreviewEmpty")));
    return;
  }
  /* Beginner view: a plain-language consequence summary consuming the
   * backend-owned effective values. Raw field names, source provenance, and
   * enforcement phases stay under the technical disclosure below. */
  var consequences = workerPreviewConsequences(rows);
  if(consequences.length){
    var summaryBox = h("div", "preview-consequences");
    consequences.forEach(function(s){
      summaryBox.appendChild(h("div", "summary-line fs11 preview-consequence", s));
    });
    panel.appendChild(summaryBox);
  }
  /* Complete source/enforcement table remains under a technical disclosure. */
  var tech = h("details", "advanced-disclosure preview-tech");
  var techSummary = h("summary", "", t("workersAdvancedToggle"));
  tech.appendChild(techSummary);
  tech.appendChild(h("div", "summary-line dim fs11 mt-4 mb-4", t("workersPreviewTechnical")));
  var tbl = h("table", "preview-table");
  var thd = h("thead", "");
  var tr = h("tr", "");
  tr.appendChild(h("th", "", t("workersPreviewSetting")));
  tr.appendChild(h("th", "", t("workersPreviewValue")));
  tr.appendChild(h("th", "", t("workersPreviewSource")));
  tr.appendChild(h("th", "", t("workersPreviewEnforce")));
  thd.appendChild(tr);
  tbl.appendChild(thd);
  var tbody = document.createElement("tbody");
  rows.forEach(function(r){
    var rtr = h("tr", "");
    rtr.appendChild(h("td", "preview-field", t(ADV_FIELD_LABELS[r.field]) || r.field));
    var valStr;
    if(r.field === "maxWorkerValidationRepairs"){
      valStr = validationRepairCountText(r.value);
    } else if(r.unlimited){
      valStr = t("workersPreviewUnlimited");
      rtr.classList.add("preview-unlimited");
    } else if(r.enforcementPhase === "unsupported" && r.field === "observedTokenCeiling"){
      valStr = t("workersPreviewUnsupported");
      rtr.classList.add("preview-unsupported");
    } else if(r.value === null || r.value === undefined){
      valStr = "-";
    } else if(ADV_MODE_FIELDS.indexOf(r.field) >= 0){
      valStr = policyModeLabel(r.value);
    } else {
      /* Technical disclosure keeps the exact backend value (durations in ms);
       * the readable time-unit summary lives on the closed settings groups. */
      valStr = String(r.value);
    }
    rtr.appendChild(h("td", "preview-val", valStr));
    var srcLabel = {
      "task": t("workersPreviewSourceTask"),
      "worker": t("workersPreviewSourceWorker"),
      "global": t("workersPreviewSourceGlobal")
    };
    var srcBadge = h("span", "badge " + (r.source === "task" ? "badge-info" : r.source === "worker" ? "badge-ok" : "badge-dim"), srcLabel[r.source] || r.source);
    var srcTd = h("td", "preview-src");
    srcTd.appendChild(srcBadge);
    rtr.appendChild(srcTd);
    var phaseLabels = {
      "preemptive": t("workersPreviewEnforcePreemptive"),
      "terminal": t("workersPreviewEnforceTerminal"),
      "post-observation": t("workersPreviewEnforcePostObs"),
      "unsupported": t("workersPreviewEnforceUnsupported")
    };
    var phaseBadge = h("span", "badge " + (r.enforcementPhase === "preemptive" ? "badge-ok" : r.enforcementPhase === "unsupported" ? "badge-dim" : "badge-warn"), phaseLabels[r.enforcementPhase] || r.enforcementPhase);
    var phaseTd = h("td", "preview-phase");
    phaseTd.appendChild(phaseBadge);
    rtr.appendChild(phaseTd);
    tbody.appendChild(rtr);
  });
  tbl.appendChild(tbody);
  tech.appendChild(tbl);
  panel.appendChild(tech);
}

function renderQualityPreview(rows){
  var panel = document.getElementById("fl-quality-preview");
  if(!panel) return;
  panel.textContent = "";
  var title = h("div", "card-title mb-4", t("workersQualityPreviewTitle"));
  panel.appendChild(title);
  if(!rows.length){
    panel.appendChild(h("div", "summary-line dim", t("workersPreviewEmpty")));
    return;
  }
  /* Beginner view: one plain consequence from the backend-owned quality
   * preview. The full source table stays under a technical disclosure. */
  var modeRow = rows.filter(function(r){ return r.field === "mode"; })[0];
  if(modeRow){
    var modeLabel = qualityModeLabel(modeRow.value);
    var overrideCount = rows.filter(function(r){
      return r.field !== "mode" && r.value !== null && r.value !== undefined;
    }).length;
    panel.appendChild(h("div", "summary-line fs11 preview-consequence",
      t("workersQualityPreviewConsequence", {
        mode: modeLabel,
        overrides: String(overrideCount)
      })));
  }
  var tech = h("details", "advanced-disclosure preview-tech");
  var techSummary = h("summary", "", t("workersAdvancedToggle"));
  tech.appendChild(techSummary);
  tech.appendChild(h("div", "summary-line dim fs11 mt-4 mb-4", t("workersPreviewTechnical")));
  var tbl = h("table", "preview-table");
  var thd = h("thead", "");
  var tr = h("tr", "");
  tr.appendChild(h("th", "", t("workersPreviewSetting")));
  tr.appendChild(h("th", "", t("workersPreviewValue")));
  tr.appendChild(h("th", "", t("workersPreviewSource")));
  thd.appendChild(tr);
  tbl.appendChild(thd);
  var tbody = document.createElement("tbody");
  rows.forEach(function(r){
    var rtr = h("tr", "");
    var fieldLabel = t(QUALITY_FIELD_LABELS[r.field]) || r.field;
    rtr.appendChild(h("td", "preview-field", fieldLabel));
    var valStr;
    if(r.field === "mode"){
      valStr = qualityModeLabel(r.value);
    } else if(r.value === null){
      valStr = t("workersPreviewUnlimited");
      rtr.classList.add("preview-unlimited");
    } else {
      valStr = String(r.value);
    }
    rtr.appendChild(h("td", "preview-val", valStr));
    var srcLabel = {
      "task": t("workersPreviewSourceTask"),
      "worker": t("workersPreviewSourceWorker"),
      "global": t("workersPreviewSourceGlobal")
    };
    var srcBadge = h("span", "badge " + (r.source === "task" ? "badge-info" : r.source === "worker" ? "badge-ok" : "badge-dim"), srcLabel[r.source] || r.source);
    var srcTd = h("td", "preview-src");
    srcTd.appendChild(srcBadge);
    rtr.appendChild(srcTd);
    tbody.appendChild(rtr);
  });
  tbl.appendChild(tbody);
  tech.appendChild(tbl);
  panel.appendChild(tech);
}

function rModel(){
  viewEl.textContent = "";
  flashError("");
  viewEl.appendChild(renderPageStory("models"));
  var cat = (S.hub && S.hub.modelCatalog) || { models: [] };
  var list = cat.models || [];
  var split = hd("div", "configure-split");
  var listCol = hd("div", "configure-list");
  var codexImport = h("button", "btn", t("modelsImportCodex"));
  codexImport.type = "button";
  codexImport.addEventListener("click", function(){
    postJSON("/api/codex-model-catalog", { action: "import" })
      .then(function(result){
        toast(t("modelsImportedCodex", { count: String(result.imported || 0) }));
        return refresh();
      })
      .catch(function(e){ flashError(t("operationFailed"), e && e.message); });
  });
  listCol.appendChild(codexImport);
  if(!list.length){
    listCol.appendChild(stateMsg("empty", t("modelsEmpty")));
  }
  list.forEach(function(mc){
    var cardEl = h("div", "card profile-card");
    cardEl.appendChild(cardHead(
      mc.label + " (" + mc.id + ")",
      mc.provider + " · " + mc.model,
      h("span", "badge badge-dim", t("modelBadge"))
    ));
    if(mc.endpoint) cardEl.appendChild(h("div", "summary-line mono dim", mc.endpoint));
    if(Array.isArray(mc.supportedEfforts)){
      cardEl.appendChild(h("div", "summary-line dim", t("workersEffort") + ": " + mc.supportedEfforts.join(" · ")));
    }
    var actions = h("div", "actions");
    if(list.length > 1){
      var rm = h("button", "btn sm danger", t("modelsRemove"));
      rm.type = "button";
      rm.addEventListener("click", function(){
        if(!window.confirm(t("modelsRemoveConfirm", { id: mc.id }))) return;
        postJSON("/api/model-catalog", { action: "remove", id: mc.id })
          .then(function(){ toast(t("modelsRemoved") + mc.id); return refresh(); })
          .catch(function(e){ flashError(t("operationFailed"), e && e.message); });
      });
      actions.appendChild(rm);
    }
    cardEl.appendChild(actions);
    listCol.appendChild(cardEl);
  });

  var form = h("form", "card form-card configure-form");
  form.setAttribute("novalidate", "true");
  form.appendChild(h("div", "card-title", t("modelsFormTitle")));
  function field(id, label, type, val, ph){
    var lab = h("label", "", label);
    var inp = h("input", "");
    inp.type = type || "text"; inp.id = id; inp.value = val || "";
    if(ph) inp.placeholder = ph;
    lab.appendChild(inp); form.appendChild(lab);
    return inp;
  }
  var idIn = field("fl-mc-id", t("modelsId"), "text", "", "e.g. deepseek-flash");
  var labIn = field("fl-mc-label", t("modelsLabel"), "text", "", "DeepSeek Flash");
  var labP = h("label", "", t("modelsProvider"));
  var selP = h("select", "");
  fillProviderSelect(selP, "deepseek");
  labP.appendChild(selP); form.appendChild(labP);
  var modelIn = field("fl-mc-model", t("modelsModelId"), "text", "", "deepseek-v4-flash");
  var epIn = field("fl-mc-endpoint", t("modelsEndpoint"), "url", "", "");
  var labK = h("label", "", t("modelsKey"));
  var inpK = h("input", "");
  inpK.type = "password"; inpK.autocomplete = "off"; inpK.minLength = 8; inpK.maxLength = 4096;
  labK.appendChild(inpK); form.appendChild(labK);
  form.appendChild(formActions(t("modelsSave"), null, {
    label: t("modelsNext"),
    onClick: function(){ switchTab("worker"); }
  }));
  form.addEventListener("submit", function(ev){
    ev.preventDefault();
    flashError("");
    var config = {
      id: idIn.value.trim(),
      label: labIn.value.trim() || idIn.value.trim(),
      provider: selP.value,
      model: modelIn.value.trim()
    };
    if(epIn.value.trim()) config.endpoint = epIn.value.trim();
    var chain = postJSON("/api/model-catalog", { action: "upsert", model: config });
    if(inpK.value && inpK.value.length >= 8){
      chain = chain.then(function(){
        return postJSON("/api/provider-key", { provider: selP.value, apiKey: inpK.value })
          .then(function(){ inpK.value = ""; });
      });
    }
    chain.then(function(){
      toast(t("modelsSaved") + config.id);
      return refresh();
    }).catch(function(e){ flashError(t("operationFailed"), e && e.message); });
  });
  split.appendChild(listCol);
  split.appendChild(form);
  viewEl.appendChild(split);

  /* --- Model routing advice section --- */
  renderModelRoutingSection();
}

function renderModelRoutingSection(){
  var cat = (S.hub && S.hub.modelCatalog) || { models: [] };
  var models = cat.models || [];
  var wp = (S.hub && S.hub.workerProfiles) || { profiles: [] };
  var profiles = wp.profiles || [];
  var mr = S.mrDraft || (S.hub && S.hub.modelRouting) || {};

  var section = h("div", "mr-section");
  section.appendChild(h("div", "guide-card mr-guide",
    t("mrPageGuide")));

  /* --- Explanation: what is being decided --- */
  var whatCard = h("div", "card");
  whatCard.appendChild(h("div", "card-title mb-4", t("mrWhatIsDecided")));
  whatCard.appendChild(h("div", "summary-line", t("mrWhatIsDecidedBody")));
  section.appendChild(whatCard);

  /* --- Policy editor --- */
  var policyDetails = document.createElement("details");
  policyDetails.className = "advanced-section mr-policy-details";
  var policySummary = document.createElement("summary");
  policySummary.textContent = t("mrPolicyAdvancedTitle");
  policyDetails.appendChild(policySummary);
  var policyCard = h("div", "card");
  policyCard.appendChild(h("div", "card-title mb-4", t("mrPolicyTitle")));

  var policyGrid = hd("div", "mr-policy-grid");

  /* minRelevantSamples */
  var mrsF = h("div", "mr-policy-field");
  var mrsL = h("label", "", t("mrPolicyMinSamples"));
  var mrsI = h("input", "");
  mrsI.type = "number"; mrsI.min = "1"; mrsI.max = "10000"; mrsI.step = "1";
  mrsI.id = "fl-mr-minSamples";
  mrsI.value = String(mr.minRelevantSamples || 5);
  mrsL.appendChild(mrsI);
  mrsF.appendChild(mrsL);
  mrsF.appendChild(h("div", "hint-inline dim fs11", t("mrPolicyMinSamplesHint")));
  policyGrid.appendChild(mrsF);

  /* familyMinRelevantSamples */
  var famF = h("div", "mr-policy-field");
  var famL = h("label", "", t("mrPolicyFamilyMinSamples"));
  var famI = h("input", "");
  famI.type = "number"; famI.min = "1"; famI.max = "10000"; famI.step = "1";
  famI.id = "fl-mr-familyMinSamples";
  famI.value = String(mr.familyMinRelevantSamples || 5);
  famL.appendChild(famI);
  famF.appendChild(famL);
  famF.appendChild(h("div", "hint-inline dim fs11", t("mrPolicyFamilyMinSamplesHint")));
  policyGrid.appendChild(famF);

  /* defaultCompetitionCandidates */
  var dccF = h("div", "mr-policy-field");
  var dccL = h("label", "", t("mrPolicyDefaultCompCandidates"));
  var dccI = h("input", "");
  dccI.type = "number"; dccI.min = "1"; dccI.max = "10"; dccI.step = "1";
  dccI.id = "fl-mr-defaultCompCandidates";
  dccI.value = String(typeof mr.defaultCompetitionCandidates === "number" ? mr.defaultCompetitionCandidates : 2);
  dccL.appendChild(dccI);
  dccF.appendChild(dccL);
  dccF.appendChild(h("div", "hint-inline dim fs11", t("mrPolicyDefaultCompCandidatesHint")));
  policyGrid.appendChild(dccF);

  /* uncertaintyThreshold */
  var utF = h("div", "mr-policy-field");
  var utL = h("label", "", t("mrPolicyUncertainty"));
  var utI = h("input", "");
  utI.type = "number"; utI.min = "0"; utI.max = "1"; utI.step = "0.01";
  utI.id = "fl-mr-uncertainty";
  utI.value = String(mr.uncertaintyThreshold != null ? mr.uncertaintyThreshold : 0.15);
  utL.appendChild(utI);
  utF.appendChild(utL);
  utF.appendChild(h("div", "hint-inline dim fs11", t("mrPolicyUncertaintyHint")));
  policyGrid.appendChild(utF);

  policyCard.appendChild(policyGrid);

  /* competitionOnUncertainty */
  var cbF = h("div", "mr-policy-checkbox");
  var cbI = h("input", "");
  cbI.type = "checkbox"; cbI.id = "fl-mr-competition";
  if(mr.competitionOnUncertainty !== false) cbI.checked = true;
  cbF.appendChild(cbI);
  cbF.appendChild(document.createTextNode(t("mrPolicyCompetition")));
  policyCard.appendChild(cbF);
  policyCard.appendChild(h("div", "hint-inline dim fs11 mb-8", t("mrPolicyCompetitionHint")));

  /* Competition triggers enabled */
  policyCard.appendChild(h("div", "card-subtitle mt-8 mb-4", t("mrPolicyTriggersTitle")));
  policyCard.appendChild(h("div", "dim fs11 mb-8", t("mrPolicyTriggersHint")));
  var enabledTriggers = Array.isArray(mr.competitionTriggersEnabled) ? mr.competitionTriggersEnabled : [];
  var triggerDefs = [
    ["critical", "mrTriggerCritical"],
    ["multiple-plausible-solutions", "mrTriggerMultipleSolutions"],
    ["new-family", "mrTriggerNewFamily"],
    ["user-requested", "mrTriggerUserRequested"]
  ];
  triggerDefs.forEach(function(tdef){
    var trF = h("div", "mr-policy-checkbox");
    var trI = h("input", "fl-mr-trigger-check");
    trI.type = "checkbox"; trI.value = tdef[0];
    if(enabledTriggers.indexOf(tdef[0]) >= 0) trI.checked = true;
    trI.addEventListener("change", captureRoutingDraft);
    trF.appendChild(trI);
    trF.appendChild(document.createTextNode(t(tdef[1])));
    policyCard.appendChild(trF);
  });

  /* What to do when an enabled preference has no fair comparison data. */
  var memF = h("div", "mr-policy-field");
  var memL = h("label", "", t("mrMissingEvidenceMode"));
  var memS = h("select", "");
  memS.id = "fl-mr-missingEvidenceMode";
  ["flexible", "strict"].forEach(function(mode){
    var option = document.createElement("option");
    option.value = mode;
    option.textContent = mode === "flexible"
      ? t("mrMissingEvidenceFlexible")
      : t("mrMissingEvidenceStrict");
    memS.appendChild(option);
  });
  memS.value = mr.missingEvidenceMode || "flexible";
  memL.appendChild(memS);
  memF.appendChild(memL);
  memF.appendChild(h("div", "hint-inline dim fs11", t("mrMissingEvidenceModeHint")));
  policyCard.appendChild(memF);

  /* --- Weight fields --- */
  policyCard.appendChild(h("div", "card-subtitle mt-8 mb-4", t("mrPolicyWeightsTitle")));
  var weightsGrid = hd("div", "mr-weights-grid");
  var mrWeightInputs = [];
  MR_WEIGHT_KEYS.forEach(function(w){
    var wf = h("div", "mr-policy-field");
    var wl = h("label", "", t(w[1]));
    var wi = h("input", "");
    wi.type = "number"; wi.min = "0"; wi.max = "1000"; wi.step = "0.1";
    wi.id = "fl-mr-w-" + w[0];
    var weights = mr.weights || {};
    var val = weights[w[0]];
    wi.value = String(val != null ? val : mrWeightDefault(String(w[0])));
    wl.appendChild(wi);
    wf.appendChild(wl);
    wf.appendChild(h("div", "hint-inline dim fs11", t(w[2])));
    weightsGrid.appendChild(wf);
    mrWeightInputs.push(wi);
  });
  policyCard.appendChild(weightsGrid);

  /* Unsaved badge */
  var uv = h("div", "mt-8");
  uv.hidden = !S.mrDirty;
  uv.appendChild(h("span", "mr-unsaved-badge", t("mrPrefsUnsaved")));
  uv.appendChild(h("div", "dim fs11 mt-4", t("mrPrefsUnsavedHint")));
  policyCard.appendChild(uv);

  /* Dirty only when the normalized draft differs from saved policy. */
  var mruiEls = [mrsI, utI, cbI, memS];
  mrWeightInputs.forEach(function(wi){ mruiEls.push(wi); });
  function captureRoutingDraft(){
    var draftWeights = {};
    mrWeightInputs.forEach(function(wi, i){
      draftWeights[MR_WEIGHT_KEYS[i][0]] = wi.value;
    });
    S.mrDraft = {
      minRelevantSamples: mrsI.value,
      familyMinRelevantSamples: document.getElementById("fl-mr-familyMinSamples")
        ? document.getElementById("fl-mr-familyMinSamples").value : "5",
      uncertaintyThreshold: utI.value,
      competitionOnUncertainty: cbI.checked,
      missingEvidenceMode: memS.value,
      weights: draftWeights
    };
    var saved = (S.hub && S.hub.modelRouting) || {};
    S.mrDirty = isModelRoutingDraftDirty(S.mrDraft, saved);
    uv.hidden = !S.mrDirty;
  }
  mruiEls.forEach(function(el){
    if(!el) return;
    el.addEventListener("input", captureRoutingDraft);
    el.addEventListener("change", captureRoutingDraft);
  });

  policyDetails.appendChild(policyCard);

  /* --- Candidate selection --- */
  var candCard = h("div", "card");
  candCard.appendChild(h("div", "card-title mb-4", t("mrCandidatesTitle")));
  candCard.appendChild(h("div", "summary-line dim mb-8", t("mrCandidatesHint")));

  /* Build candidate list from saved Worker Profiles only. The Profile id is the
     selection key: same model on two different Workers stays two choices, and
     catalog-only models (no saved Worker) never appear. */
  var candOptions = [];
  profiles.forEach(function(p){
    var configured = models.find(function(x){ return x.id === (p.modelConfigId || ""); });
    var provider = configured ? configured.provider : p.provider;
    var model = configured ? configured.model : p.model;
    if(!provider || !model) return;
    var runtime = p.runtime || "?";
    var effort = p.effort || "";
    candOptions.push({
      key: p.id,
      profileId: p.id,
      provider: provider,
      model: model,
      runtime: runtime,
      effort: effort,
      label: (p.label || p.id || "Worker") + ": " + provider + " / " + model
        + " (" + runtime + (effort ? ", " + effort : "") + ")",
    });
  });

  if(!candOptions.length){
    candCard.appendChild(h("div", "summary-line dim", t("mrNoCatalogModels")));
  } else {
    var candSel = h("select", "mr-candidates-select");
    candSel.multiple = true;
    candSel.id = "fl-mr-candidates";
    candOptions.sort(function(a, b){ return a.label.localeCompare(b.label); });
    var availableKeys = candOptions.map(function(co){ return co.key; });
    S.mrCandidates = (S.mrCandidates || []).filter(function(key){
      return availableKeys.indexOf(key) >= 0;
    });
    if(!S.mrCandidates.length){ S.mrCandidates = availableKeys.slice(0, 2); }
    candOptions.forEach(function(co){
      var o = document.createElement("option");
      o.value = co.key;
      o.textContent = co.label;
      o.selected = S.mrCandidates.indexOf(co.key) >= 0;
      candSel.appendChild(o);
    });
    candSel.addEventListener("change", function(){
      S.mrCandidates = Array.prototype.map.call(candSel.selectedOptions, function(o){ return o.value; });
    });
    candCard.appendChild(candSel);

    /* Task class input */
    var tcF = h("div", "mr-policy-field mt-8");
    var tcL = h("label", "", t("mrTaskClassLabel"));
    var tcI = h("input", "");
    tcI.type = "text"; tcI.id = "fl-mr-taskClass"; tcI.maxLength = 200;
    tcI.value = S.mrTaskClass || "";
    tcI.placeholder = t("mrTaskClassPlaceholder");
    tcI.addEventListener("input", function(){ S.mrTaskClass = tcI.value; });
    tcL.appendChild(tcI);
    tcF.appendChild(tcL);
    tcF.appendChild(h("div", "hint-inline dim fs11", t("mrTaskClassHint")));
    candCard.appendChild(tcF);

    /* Task family input */
    var tfF = h("div", "mr-policy-field mt-8");
    var tfL = h("label", "", t("mrTaskFamilyLabel"));
    var tfI = h("input", "");
    tfI.type = "text"; tfI.id = "fl-mr-taskFamily"; tfI.maxLength = 80;
    tfI.value = S.mrTaskFamily || "";
    tfI.placeholder = t("mrTaskFamilyPlaceholder");
    tfI.addEventListener("input", function(){ S.mrTaskFamily = tfI.value; });
    tfL.appendChild(tfI);
    tfF.appendChild(tfL);
    tfF.appendChild(h("div", "hint-inline dim fs11", t("mrTaskFamilyHint")));
    candCard.appendChild(tfF);

    /* Competition intent selector */
    var ciF = h("div", "mr-policy-field mt-8");
    var ciL = h("label", "", t("mrCompIntentLabel"));
    var ciS = h("select", "");
    ciS.id = "fl-mr-compIntent";
    ["", "none", "consider", "required"].forEach(function(mode){
      var o = document.createElement("option");
      o.value = mode;
      o.textContent = mode === "" ? "-" : t(mode === "none" ? "mrIntentNone" : (mode === "consider" ? "mrIntentConsider" : "mrIntentRequired"));
      ciS.appendChild(o);
    });
    ciS.value = S.mrCompIntent || "";
    ciS.addEventListener("change", function(){ S.mrCompIntent = ciS.value; });
    ciL.appendChild(ciS);
    ciF.appendChild(ciL);
    ciF.appendChild(h("div", "hint-inline dim fs11", t("mrCompIntentHint")));
    candCard.appendChild(ciF);

    /* Competition triggers input */
    var ctF = h("div", "mr-policy-field mt-8");
    var ctL = h("label", "", t("mrCompTriggersLabel"));
    var ctI = h("input", "");
    ctI.type = "text"; ctI.id = "fl-mr-compTriggers";
    ctI.value = S.mrCompTriggers || "";
    ctI.placeholder = "critical, new-family";
    ctI.addEventListener("input", function(){ S.mrCompTriggers = ctI.value; });
    ctL.appendChild(ctI);
    ctF.appendChild(ctL);
    ctF.appendChild(h("div", "hint-inline dim fs11", t("mrCompTriggersHint")));
    candCard.appendChild(ctF);

    /* Evaluate & Save buttons */
    var mrActions = h("div", "actions mt-8");
    var evalBtn = h("button", "btn primary sm", t("mrEvaluate"));
    evalBtn.type = "button";
    evalBtn.addEventListener("click", function(){
      var tc = document.getElementById("fl-mr-taskClass");
      var cs = document.getElementById("fl-mr-candidates");
      if(!tc || !cs) return;
      var taskClass = (tc.value || "").trim();
      S.mrTaskClass = taskClass;
      var selOpts = cs.selectedOptions;
      var picks = [];
      for(var i = 0; i < selOpts.length; i++){
        var id = (selOpts[i].value || "").trim();
        if(id) picks.push(id);
      }
      /* Deduplicate profile ids */
      var deduped = [];
      var ds = {};
      picks.forEach(function(id){
        if(!ds[id]){ ds[id] = true; deduped.push(id); }
      });
      if(!taskClass){ toast(t("mrTaskClassLabel")); return; }
      if(deduped.length < 2){ toast(t("mrCandidatesMinError")); return; }
      if(deduped.length > 10) deduped = deduped.slice(0, 10);
      S.mrCandidates = deduped;

      /* Collect optional params */
      var tfEl = document.getElementById("fl-mr-taskFamily");
      var ciEl = document.getElementById("fl-mr-compIntent");
      var ctEl = document.getElementById("fl-mr-compTriggers");
      var taskFamily = tfEl ? (tfEl.value || "").trim() : "";
      var compIntent = ciEl ? ciEl.value : "";
      var compTrigStr = ctEl ? (ctEl.value || "").trim() : "";
      var VALID_TRIGGERS = ["critical", "multiple-plausible-solutions", "new-family", "user-requested"];
      var compTriggers = compTrigStr
        ? compTrigStr.split(",").map(function(t){ return t.trim(); }).filter(function(t){ return t.length > 0; })
        : [];
      var badTriggers = compTriggers.filter(function(t){ return VALID_TRIGGERS.indexOf(t) < 0; });
      if(badTriggers.length > 0){
        flashError(t("operationFailed"), t("mrInvalidTrigger", { trigger: badTriggers[0] }));
        return;
      }

      var reqBody = { taskClass: taskClass, workerProfileIds: deduped };
      if(taskFamily) reqBody.taskFamily = taskFamily;
      if(compIntent && compIntent !== "") reqBody.competitionIntent = compIntent;
      if(compTriggers.length > 0) reqBody.competitionTriggers = compTriggers;

      S.mrResult = null;
      S.mrEvaluating = true;
      evalBtn.disabled = true;
      evalBtn.textContent = t("mrEvaluating");
      render();
      postJSON("/api/ops/model-routing", reqBody)
        .then(function(res){
          S.mrResult = res.advisory;
          S.mrEvaluating = false;
          render();
        })
        .catch(function(e){
          S.mrResult = { error: e && e.message ? e.message : "unavailable" };
          S.mrEvaluating = false;
          render();
        });
    });
    mrActions.appendChild(evalBtn);

    var saveBtn = h("button", "btn sm", t("mrSavePrefs"));
    saveBtn.type = "button";
    saveBtn.addEventListener("click", function(){
      var patch = {
        modelRouting: {}
      };
      var minS = document.getElementById("fl-mr-minSamples");
      var famS = document.getElementById("fl-mr-familyMinSamples");
      var unc = document.getElementById("fl-mr-uncertainty");
      var comp = document.getElementById("fl-mr-competition");
      var defComp = document.getElementById("fl-mr-defaultCompCandidates");
      if(minS) patch.modelRouting.minRelevantSamples = parseInt(minS.value, 10);
      if(famS) patch.modelRouting.familyMinRelevantSamples = parseInt(famS.value, 10);
      if(unc) patch.modelRouting.uncertaintyThreshold = parseFloat(unc.value);
      if(comp) patch.modelRouting.competitionOnUncertainty = comp.checked;
      if(defComp) patch.modelRouting.defaultCompetitionCandidates = parseInt(defComp.value, 10);
      var mem = document.getElementById("fl-mr-missingEvidenceMode");
      if(mem) patch.modelRouting.missingEvidenceMode = mem.value;
      /* Collect enabled triggers */
      var triggerChecks = document.querySelectorAll(".fl-mr-trigger-check");
      var enabledTriggers = [];
      triggerChecks.forEach(function(cb){
        if(cb.checked) enabledTriggers.push(cb.value);
      });
      if(enabledTriggers.length > 0 || triggerChecks.length > 0) {
        patch.modelRouting.competitionTriggersEnabled = enabledTriggers;
      }
      var wPatch = {};
      MR_WEIGHT_KEYS.forEach(function(w){
        var el = document.getElementById("fl-mr-w-" + w[0]);
        if(el) wPatch[w[0]] = parseFloat(el.value);
      });
      patch.modelRouting.weights = wPatch;
      saveBtn.disabled = true;
      postJSON("/api/settings", patch)
        .then(function(){
          S.mrDirty = false;
          S.mrDraft = null;
          toast(t("mrSavePrefsDone"));
          return refresh();
        })
        .catch(function(e){ flashError(t("operationFailed"), e && e.message); })
        .finally(function(){ saveBtn.disabled = false; });
    });
    mrActions.appendChild(saveBtn);
    candCard.appendChild(mrActions);
  }
  section.appendChild(candCard);

  /* --- Result rendering --- */
  if(S.mrEvaluating){
    section.appendChild(stateMsg("loading", t("mrEvaluating")));
  } else if(S.mrResult){
    renderMrResult(section, S.mrResult);
  }

  /* Flexible preferences are intentionally secondary to input and output. */
  section.appendChild(policyDetails);

  /* Invariant note at the bottom */
  section.appendChild(h("div", "mr-invariant-note mt-8", t("mrInvariantNote")));

  viewEl.appendChild(section);
}

function renderMrResult(section, result){
  if(result.error){
    section.appendChild(stateMsg("disconnected", t("mrBridgeUnavailable")));
    var dt = h("details", "audit-details");
    var ds = document.createElement("summary");
    ds.textContent = t("detailTechError");
    dt.appendChild(ds);
    dt.appendChild(h("div", "summary-line mono fs11", boundedDiagnostic(result.error)));
    section.appendChild(dt);
    return;
  }
  var rec = result.recommendation;
  var cands = result.candidates || [];
  var policy = result.resolvedPolicy || {};
  var taskClass = result.taskClass || "";
  var knowledge = result.knowledge || "unknown";
  var evidenceScope = result.evidenceScope || "none";
  var comp = result.competition || {};

  /* --- Conclusion --- */
  var conc = h("div", "card mr-conclusion " + (rec ? "" : "mr-no-result"));
  conc.appendChild(h("div", "card-subtitle", t("mrConclusionTitle")));

  /* Evidence scope and knowledge at the top */
  var scopeText;
  if(evidenceScope === "exact-class") scopeText = t("mrEvidenceScopeExact");
  else if(evidenceScope === "task-family") scopeText = t("mrEvidenceScopeFamily");
  else scopeText = t("mrEvidenceScopeNone");
  conc.appendChild(h("div", "summary-line dim mb-4",
    t("mrEvidenceScope") + ": " + scopeText));

  /* Which saved Workers were actually compared: explanation first. */
  var comparedNames = cands.filter(function(c){ return c.cohortParticipation === "compared"; }).map(function(c){
    return c.workerLabel
      ? c.workerLabel + " (" + c.provider + " / " + c.model + ")"
      : c.provider + " / " + c.model;
  });
  if(comparedNames.length){
    conc.appendChild(h("div", "summary-line dim mb-4",
      t("mrComparedWorkers", { workers: comparedNames.join(", ") })));
  }

  /* Cohort coverage: how many candidates were actually compared. */
  var allCompared = result.allCandidatesCompared === true;
  var cohortCount = typeof result.cohortCandidateCount === "number" ? result.cohortCandidateCount : 0;
  var totalCount = typeof result.totalCandidateCount === "number" ? result.totalCandidateCount : 0;
  var excludedCount = typeof result.excludedCandidateCount === "number"
    ? result.excludedCandidateCount
    : Math.max(0, totalCount - cohortCount);
  var recommendationCoverage = rec && rec.coverage
    ? rec.coverage
    : result.recommendationCoverage;
  if(evidenceScope !== "none" && totalCount > 0){
    if(allCompared){
      conc.appendChild(h("div", "summary-line dim mb-4",
        t("mrAllCandidatesCompared", { count: String(totalCount) })));
    } else {
      conc.appendChild(h("div", "summary-line dim mr-subset-warning mb-4",
        t("mrEvidenceReadySubset", {
          compared: String(cohortCount),
          total: String(totalCount),
          excluded: String(excludedCount)
        })));
    }
  }

  if(rec){
    var recTitle = h("div", "mr-conclusion-title");
    if(rec.workerLabel || rec.workerProfileId){
      recTitle.appendChild(document.createTextNode(
        t("mrRecommendationProfile", {
          worker: rec.workerLabel || rec.workerProfileId,
          taskClass: taskClass
        })
      ));
    } else {
      recTitle.appendChild(document.createTextNode(
        t("mrRecommendation", { provider: rec.provider, model: rec.model, taskClass: taskClass })
      ));
    }
    conc.appendChild(recTitle);
    /* Use the canonical recommendation boundary; do not infer it in the UI. */
    if(recommendationCoverage === "evidence-ready-subset"){
      conc.appendChild(h("div", "summary-line dim mr-subset-warning mt-4",
        t("mrRecommendationSubsetOnly", {
          compared: String(cohortCount),
          total: String(totalCount),
          excluded: String(excludedCount)
        })));
    }
    if(rec.workerProfileId){
      conc.appendChild(h("div", "summary-line dim fs11 mt-2",
        t("mrWorkerProfileId", { profileId: rec.workerProfileId })));
    }
    var cf = rec.confidence != null ? (rec.confidence * 100).toFixed(0) : "-";
    conc.appendChild(h("div", "summary-line mr-conf mt-4",
      t("mrRecommendationConfidence", { confidence: cf })));
    conc.appendChild(h("div", "mr-override mt-4", t("mrRecommendationOverride")));
    /* Family evidence note */
    if(evidenceScope === "task-family" && result.taskFamily){
      conc.appendChild(h("div", "summary-line dim mt-4",
        t("mrFamilyEvidenceNote", { family: result.taskFamily })));
    }
  } else {
    conc.appendChild(h("div", "mr-conclusion-title", t("mrNoRecommendation")));
    /* Knowledge explanation */
    var knowledgeText = knowledge === "recommendation"
      ? t("mrKnowledgeRecommendation")
      : t("mrKnowledgeUnknown");
    conc.appendChild(h("div", "mr-reason", t("mrKnowledge") + ": " + knowledgeText));
    /* What is known first, then why comparison is not ready. */
    var reasons = buildMrReasons(cands, policy, result);
    if(reasons.length){
      reasons.slice(0, 4).forEach(function(r){
        conc.appendChild(h("div", "mr-reason", r));
      });
    }
  }

  /* --- Competition decision (separate from evidence) --- */
  var compBlock = h("div", "mr-competition mt-8");
  compBlock.appendChild(h("div", "card-subtitle mt-4", t("mrCompetitionDecisionTitle")));
  if(result.shouldRunCompetition){
    var matchTrig = (comp.matchingTriggers || []).join(", ");
    if(comp.intent === "required"){
      compBlock.appendChild(h("div", "summary-line",
        t("mrCompetitionRequired", { count: String(comp.suggestedCandidates || 2) })));
    } else {
      compBlock.appendChild(hd("div", "summary-line", [
        h("span", "badge badge-info", t("mrCompetitionAdvised", {
          intent: comp.intent || "consider",
          triggers: matchTrig || "none"
        }))
      ]));
      compBlock.appendChild(h("div", "summary-line dim mt-4", t("mrCompetitionAdvisedHint")));
    }
  } else {
    compBlock.appendChild(h("div", "summary-line", t("mrCompetitionNotAdvised")));
    compBlock.appendChild(h("div", "summary-line dim mt-4",
      t("mrCompetitionNotAdvisedReason", { intent: comp.intent || "none" })));
  }
  conc.appendChild(compBlock);
  var omitted = result.omittedFactors || [];
  if(omitted.length){
    var omittedBlock = h("div", "mr-omitted mt-8");
    omittedBlock.appendChild(h("div", "badge badge-warn", t("mrOmittedFactorsTitle")));
    if(rec){
      omittedBlock.appendChild(h("div", "summary-line mt-4", t("mrFlexibleRecommendationCaveat")));
    }
    omitted.forEach(function(item){
      var definition = MR_WEIGHT_KEYS.find(function(weight){ return weight[0] === item.factor; });
      var factorLabel = definition ? t(definition[1]) : String(item.factor);
      omittedBlock.appendChild(h("div", "summary-line dim fs11 mt-2",
        t("mrOmittedFactor", { factor: factorLabel })));
    });
    conc.appendChild(omittedBlock);
  }
  if(S.mrDirty){
    conc.appendChild(h("div", "summary-line dim mt-8", t("mrResultUsedSavedPrefs")));
  }
  section.appendChild(conc);

  /* --- Per-candidate evidence --- */
  if(cands.length){
    section.appendChild(h("div", "section-title mt-12", t("mrPerCandidateTitle")));
    cands.forEach(function(c){
      var cc = h("div", "mr-candidate-card");
      var name = hd("div", "mr-candidate-name");
      if(c.workerLabel || c.workerProfileId){
        name.appendChild(document.createTextNode(
          t("mrCandidateWorker", {
            worker: c.workerLabel || c.workerProfileId,
            provider: c.provider,
            model: c.model
          })));
      } else {
        name.appendChild(document.createTextNode(
          t("mrCandidateEvidence", { provider: c.provider, model: c.model })));
      }
      cc.appendChild(name);
      /* Cohort participation tag: first-class before any score or factor detail. */
      if(c.cohortParticipation === "insufficient-evidence"){
        cc.appendChild(h("div", "badge badge-dim mr-excluded-badge mt-2",
          t("mrCandidateExcludedFromComparison")));
      }
      if(c.workerProfileId){
        cc.appendChild(h("div", "summary-line dim fs11 mb-2",
          t("mrWorkerProfileId", { profileId: c.workerProfileId })));
      }

      /* Human evidence facts; scoring arithmetic stays in technical detail.
       *  comparisonEvidence carries active-scope counts (family evidence when
       *  scope is task-family); fall back to legacy evidence when absent. */
      var ev = c.comparisonEvidence || c.evidence || {};
      var cov = c.sampleCoverage;
      if(cov && typeof cov.exactRelevantCount === "number"){
        cc.appendChild(h("div", "summary-line dim mb-2",
          t("mrCandidateExactCoverage", {
            current: String(cov.exactRelevantCount),
            required: String(cov.exactMinRelevantSamples != null
              ? cov.exactMinRelevantSamples
              : (policy.minRelevantSamples || 5))
          })));
        if(result.taskFamily && typeof cov.familyRelevantCount === "number"){
          cc.appendChild(h("div", "summary-line dim mb-4",
            t("mrCandidateFamilyCoverage", {
              current: String(cov.familyRelevantCount),
              required: String(cov.familyMinRelevantSamples != null
                ? cov.familyMinRelevantSamples
                : (policy.familyMinRelevantSamples || 5))
            })));
        }
      } else {
        var sampleCount = typeof ev.relevantSampleCount === "number"
          ? String(ev.relevantSampleCount) : t("decUnavailable");
        cc.appendChild(h("div", "summary-line dim mb-4",
          t("mrCandidateSamples", { count: sampleCount })));
      }

      var fGrid = hd("div", "mr-candidate-factors");
      var budgetFactor = null;
      (c.factors || []).forEach(function(f){
        var def = MR_WEIGHT_KEYS.find(function(w){ return w[0] === f.factor; });
        var fn = h("span", "mr-factor-name", def ? t(def[1]) : String(f.factor));
        var stateKey = Number(f.weight) === 0
          ? "mrFactorNotUsed"
          : (f.available ? "mrFactorUsed" : "mrFactorMissingEvidence");
        var fv = h("span", "mr-factor-value " + (f.available ? "" : "dim"), t(stateKey));
        fGrid.appendChild(fn);
        fGrid.appendChild(fv);
        if(f.factor === "budgetReliability") budgetFactor = f;
      });
      cc.appendChild(fGrid);

      /* Main/delivery-backed final delivery; not machine success alone. */
      var adAccepted = Number(ev.acceptedDeliveryCount || 0);
      var adSample = Number(ev.acceptedDeliverySampleCount || 0);
      var adUnavailable = Number(ev.acceptedDeliveryUnavailableCount || 0);
      var adRate = typeof ev.acceptedDeliveryRate === "number" && adSample > 0
        ? Math.round(ev.acceptedDeliveryRate * 100) : 0;
      var adBlock = h("div", "mr-accepted-delivery-evidence mt-8");
      adBlock.appendChild(h("div", "summary-line fs11", t("mrAcceptedDeliverySummary")));
      if(adSample > 0){
        adBlock.appendChild(h("div", "summary-line fs11 mt-2",
          t("mrAcceptedDeliveryFact", {
            accepted: String(adAccepted), sample: String(adSample), rate: String(adRate)
          })));
      } else {
        adBlock.appendChild(h("div", "summary-line dim fs11 mt-2", t("mrAcceptedDeliveryNoComparable")));
      }
      adBlock.appendChild(h("div", "summary-line dim fs11 mt-2",
        t("mrAcceptedDeliveryUnavailable", { count: String(adUnavailable) })));
      adBlock.appendChild(h("div", "summary-line dim fs11 mt-2", t("mrAcceptedDeliveryNotMachine")));
      cc.appendChild(adBlock);

      /* First-pass verified success is separate from eventual delivery and churn. */
      var fpSample = Number(ev.firstPassVerifiedSampleCount || 0);
      var fpPassed = Number(ev.firstPassVerifiedSuccessCount || 0);
      var fpUnavailable = Number(ev.firstPassUnavailableCount || 0);
      var fpRate = typeof ev.firstPassVerifiedSuccessRate === "number"
        ? Math.round(ev.firstPassVerifiedSuccessRate * 100) : 0;
      var fpBlock = h("div", "mr-first-pass-evidence mt-8");
      fpBlock.appendChild(h("div", "summary-line fs11", t("mrFirstPassSummary")));
      if(fpSample > 0){
        fpBlock.appendChild(h("div", "summary-line fs11 mt-2",
          t("mrFirstPassFact", {
            passed: String(fpPassed), sample: String(fpSample), rate: String(fpRate)
          })));
      } else {
        fpBlock.appendChild(h("div", "summary-line dim fs11 mt-2", t("mrFirstPassNoComparable")));
      }
      fpBlock.appendChild(h("div", "summary-line dim fs11 mt-2",
        t("mrFirstPassExcluded", { count: String(fpUnavailable) })));
      fpBlock.appendChild(h("div", "summary-line dim fs11 mt-2", t("mrFirstPassNotFinalQuality")));
      cc.appendChild(fpBlock);

      /* Keep the meaning, actual evidence and next implication together. */
      if(budgetFactor && Number(budgetFactor.weight) > 0){
        var br = ev.budgetReliability || {};
        var brBlock = h("div", "mr-budget-evidence mt-8");
        brBlock.appendChild(h("div", "summary-line fs11", t("mrBudgetReliabilitySummary")));
        if(budgetFactor.available){
          var brTotal = Number(br.boundedSampleCount || 0);
          var brCompleted = Number(br.completedWithoutExhaustionCount || 0);
          var brRate = typeof br.completedWithoutExhaustionRate === "number"
            ? Math.round(br.completedWithoutExhaustionRate * 100) : 0;
          brBlock.appendChild(h("div", "summary-line fs11 mt-2",
            t("mrBudgetReliabilityFact", {
              completed: String(brCompleted), total: String(brTotal), rate: String(brRate)
            })));
          brBlock.appendChild(h("div", "summary-line dim fs11 mt-2",
            t("mrBudgetReliabilityEnvelope", { envelope: budgetEnvelopeText(br.envelope) })));
        } else {
          var reasonKey = budgetReliabilityReasonKey(budgetFactor.unavailableReason);
          brBlock.appendChild(h("div", "summary-line dim fs11 mt-2",
            t(reasonKey || "mrBudgetReliabilityUnavailable")));
        }
        brBlock.appendChild(h("div", "summary-line dim fs11 mt-2",
          t("mrBudgetReliabilityExcluded", {
            uncapped: String(br.excludedUncappedCount || 0),
            unenforced: String(br.excludedUnknownEnforcementCount || 0),
            external: String(br.excludedExternalFailureCount || 0)
          })));
        brBlock.appendChild(h("div", "summary-line dim fs11 mt-2",
          t("mrBudgetReliabilitySoftOnly")));
        cc.appendChild(brBlock);
      }

      /* Ignored non-model failures */
      var ig = ev.ignoredNonModelFailures || {};
      var igKeys = Object.keys(ig);
      if(igKeys.length || (ev.ignoredNonModelTaskCount || 0) > 0){
        var igBlock = h("div", "mr-ignored mt-8");
        igBlock.appendChild(h("div", "summary-line dim fs11", t("mrIgnoredNonModelTitle")));
        igBlock.appendChild(h("div", "summary-line dim fs11 mt-2",
          t("mrIgnoredNonModelSummary", { count: String(ev.ignoredNonModelTaskCount || 0) })));
        cc.appendChild(igBlock);
      }
      section.appendChild(cc);
    });
  }

  /* --- Next action --- */
  section.appendChild(h("div", "section-title mt-8", t("mrNextActionTitle")));
  if(rec){
    section.appendChild(h("div", "mr-next-action", t("mrNextActionMainChooses")));
  } else if(result.shouldRunCompetition && (policy.competitionOnUncertainty)){
    section.appendChild(h("div", "mr-next-action", t("mrNextActionCompete")));
  } else if(mrCoverageNeedsMoreEvidence(cands, policy)){
    section.appendChild(h("div", "mr-next-action", t("mrNextActionMoreEvidence")));
  } else {
    section.appendChild(h("div", "mr-next-action", t("mrNextActionSavePrefs")));
  }

  /* --- Technical disclosure --- */
  var tech = document.createElement("details");
  tech.className = "audit-details";
  tech.setAttribute("data-fl-role", "mr-technical");
  var tSummary = document.createElement("summary");
  tSummary.textContent = t("mrTechnicalDetail");
  tech.appendChild(tSummary);
  var tBody = h("div", "task-technical-body");

  /* Resolved policy */
  tBody.appendChild(h("div", "card-subtitle mb-4", t("mrResolvedPolicyTitle")));
  var polGrid = hd("div", "settings-group", [
    hd("div", "settings-row", [h("span", "settings-key", "minRelevantSamples"), h("span", "settings-val", String(policy.minRelevantSamples || "-"))]),
    hd("div", "settings-row", [h("span", "settings-key", "uncertaintyThreshold"), h("span", "settings-val", String(policy.uncertaintyThreshold != null ? policy.uncertaintyThreshold : "-"))]),
    hd("div", "settings-row", [h("span", "settings-key", "competitionOnUncertainty"), h("span", "settings-val", String(policy.competitionOnUncertainty))]),
    hd("div", "settings-row", [h("span", "settings-key", "missingEvidenceMode"), h("span", "settings-val", String(policy.missingEvidenceMode || "flexible"))])
  ]);
  var wts = policy.weights || {};
  MR_WEIGHT_KEYS.forEach(function(w){
    polGrid.appendChild(hd("div", "settings-row", [
      h("span", "settings-key", "weights." + w[0]),
      h("span", "settings-val", String(wts[w[0]] != null ? wts[w[0]] : "-"))
    ]));
  });
  tBody.appendChild(polGrid);

  /* Per-candidate factor detail */
  cands.forEach(function(c){
    var techName = c.workerLabel
      ? c.workerLabel + " (" + c.provider + " / " + c.model + ")"
      : c.provider + " / " + c.model;
    tBody.appendChild(h("div", "card-subtitle mt-8 mb-4",
      techName + " (score " + Number(c.totalScore).toFixed(4) + ")"));
    if(rec && rec.provider === c.provider && rec.model === c.model && rec.reasoning){
      tBody.appendChild(h("div", "summary-line mono fs11", rec.reasoning));
    }
    (c.factors || []).forEach(function(f){
      var fRow = h("div", "settings-row");
      fRow.appendChild(h("span", "settings-key", f.factor));
      var fvArr = [];
      fvArr.push(t("mrFactorWeight", { weight: String(f.weight) }));
      if(f.available){
        fvArr.push(t("mrFactorAvailable"));
        if(f.rawValue != null) fvArr.push(t("mrFactorRawValue", { value: Number(f.rawValue).toFixed(4) }));
        fvArr.push(t("mrFactorNormalized", { score: Number(f.normalizedScore).toFixed(4) }));
        fvArr.push(t("mrFactorWeighted", { score: Number(f.weightedScore).toFixed(4) }));
      } else {
        fvArr.push(t("mrFactorUnavailable", { reason: f.unavailableReason || "weight-zero" }));
      }
      fvArr.push("total=" + Number(c.totalScore).toFixed(4));
      fRow.appendChild(h("span", "settings-val", fvArr.join(" · ")));
      tBody.appendChild(fRow);
    });
    var unReasons = (c.uncertainty && c.uncertainty.reasons) || [];
    if(unReasons.length){
      tBody.appendChild(hd("div", "settings-row", [
        h("span", "settings-key", t("mrUncertaintyReasons")),
        h("span", "settings-val mono fs11", unReasons.join(", "))
      ]));
    }
    var ignored = (c.evidence && c.evidence.ignoredNonModelFailures) || {};
    if(Object.keys(ignored).length){
      tBody.appendChild(hd("div", "settings-row", [
        h("span", "settings-key", t("mrIgnoredNonModelTitle")),
        h("span", "settings-val mono fs11", JSON.stringify(ignored))
      ]));
    }
  });

  tech.appendChild(tBody);
  section.appendChild(tech);
}

/* True when neither exact-type nor broader-category coverage is ready as a set.
 * Incomplete family rows alone must not demand more work when exact is already ready. */
function mrCoverageNeedsMoreEvidence(cands, policy){
  if(!cands.length) return false;
  var minExact = policy.minRelevantSamples || 5;
  var minFamily = policy.familyMinRelevantSamples || 5;
  var exactReady = cands.every(function(c){
    var cov = c.sampleCoverage;
    if(cov && typeof cov.exactRelevantCount === "number"){
      var exactMin = cov.exactMinRelevantSamples != null ? cov.exactMinRelevantSamples : minExact;
      return cov.exactRelevantCount >= exactMin;
    }
    return (c.evidence && c.evidence.relevantSampleCount) >= minExact;
  });
  if(exactReady) return false;
  var hasFamilyCoverage = cands.every(function(c){
    return c.sampleCoverage && typeof c.sampleCoverage.familyRelevantCount === "number";
  });
  if(hasFamilyCoverage){
    var familyReady = cands.every(function(c){
      var cov = c.sampleCoverage;
      var familyMin = cov.familyMinRelevantSamples != null
        ? cov.familyMinRelevantSamples : minFamily;
      return cov.familyRelevantCount >= familyMin;
    });
    if(familyReady) return false;
  }
  return true;
}

/* Shared helper: produce human-readable reasons for no-recommendation */
function buildMrReasons(cands, policy, result){
  var reasons = [];
  var minS = policy.minRelevantSamples || 5;
  var minFamily = policy.familyMinRelevantSamples || 5;
  var threshold = policy.uncertaintyThreshold != null ? policy.uncertaintyThreshold : 0.15;
  var evidenceScope = result && result.evidenceScope ? result.evidenceScope : "none";
  var hasFamily = !!(result && result.taskFamily);
  var coverages = cands.map(function(c){ return c.sampleCoverage || null; });
  var hasAnyCoverage = coverages.some(function(cov){ return !!cov; });

  if(evidenceScope === "none" && hasAnyCoverage){
    var anyExact = coverages.some(function(cov){
      return cov && (cov.exactRelevantCount > 0 || cov.exactTerminalCount > 0);
    });
    var anyFamily = coverages.some(function(cov){
      return cov && typeof cov.familyRelevantCount === "number"
        && (cov.familyRelevantCount > 0 || (cov.familyTerminalCount || 0) > 0);
    });
    var familyIncomplete = hasFamily && coverages.some(function(cov){
      return cov && typeof cov.familyRelevantCount === "number"
        && cov.familyRelevantCount < (cov.familyMinRelevantSamples != null
          ? cov.familyMinRelevantSamples : minFamily);
    });
    if(anyFamily && familyIncomplete){
      /* Related history exists, but the set is not yet fair to compare. */
      reasons.push(t("mrIncompleteFamilyComparison", {
        min: String(minFamily)
      }));
    } else if(!anyExact && !hasFamily){
      reasons.push(t("mrNoExactHistory"));
    } else if(!anyExact && hasFamily && !anyFamily){
      reasons.push(t("mrNoExactHistory"));
      reasons.push(t("mrNoFamilyHistory"));
    } else {
      reasons.push(t("mrInsufficientSamples", { min: String(minS) }));
    }
  } else {
    var hasLowSamples = cands.some(function(c){
      var cov = c.sampleCoverage;
      if(evidenceScope === "task-family" && cov
        && typeof cov.familyRelevantCount === "number"){
        return cov.familyRelevantCount < (cov.familyMinRelevantSamples != null
          ? cov.familyMinRelevantSamples : minFamily);
      }
      if(evidenceScope === "exact-class" && cov
        && typeof cov.exactRelevantCount === "number"){
        return cov.exactRelevantCount < (cov.exactMinRelevantSamples != null
          ? cov.exactMinRelevantSamples : minS);
      }
      var activeMinimum = evidenceScope === "task-family" ? minFamily : minS;
      return (c.evidence && c.evidence.relevantSampleCount) < activeMinimum;
    });
    if(hasLowSamples){
      reasons.push(t("mrInsufficientSamples", {
        min: String(evidenceScope === "task-family" ? minFamily : minS)
      }));
    }
  }

  var allGap = cands.every(function(c){
    return c.uncertainty && c.uncertainty.insufficientGap;
  });
  if(allGap){
    reasons.push(t("mrScoreGapTooSmall", { threshold: String(threshold) }));
  }
  var noActive = cands.every(function(c){
    return (c.uncertainty && c.uncertainty.reasons && c.uncertainty.reasons.indexOf("no-active-factors") >= 0);
  });
  var insufficientForComparison = cands.some(function(c){
    return c.uncertainty && Array.isArray(c.uncertainty.reasons)
      && c.uncertainty.reasons.indexOf("insufficient-relevant-samples") >= 0;
  });
  if(noActive && !insufficientForComparison){
    var configuredWeights = (policy && policy.weights) || {};
    var configuredWeightKeys = Object.keys(configuredWeights);
    var allWeightsZero = configuredWeightKeys.length > 0
      && configuredWeightKeys.every(function(key){
        return Number(configuredWeights[key]) <= 0;
      });
    reasons.push(t(allWeightsZero ? "mrAllWeightsZero" : "mrNoActiveFactors"));
  }
  var missingComparableEvidence = cands.some(function(c){
    return c.uncertainty && Array.isArray(c.uncertainty.reasons)
      && c.uncertainty.reasons.indexOf("positive-factor-unavailable") >= 0;
  });
  if(missingComparableEvidence){
    reasons.push(t("mrMissingComparableEvidence"));
  }
  return reasons;
}

function workerModelCompatible(runtime, modelConfig){
  if(!modelConfig || !modelConfig.provider) return false;
  if(runtime === "grok-build") return modelConfig.provider === "xai";
  if(runtime === "codex-cli") return modelConfig.provider === "openai";
  return modelConfig.provider !== "xai" && modelConfig.provider !== "openai";
}

function workerReadinessFor(workerId){
  var rows = (S.hub && S.hub.workerReadiness) || [];
  return rows.find(function(row){ return row && row.workerId === workerId; }) || null;
}

/* A bounded presentation signature for everything the saved Worker rail and
 * selected editor consume. Ordinary health polls do not rebuild the form;
 * real profile, catalog, default, or readiness changes do. */
function workerVisibleTruthKey(){
  var hub = S.hub || {};
  var wp = hub.workerProfiles || { defaultProfileId: "", profiles: [] };
  var profiles = (wp.profiles || []).map(function(profile){
    return {
      id: profile.id,
      label: profile.label,
      runtime: profile.runtime,
      modelConfigId: profile.modelConfigId,
      model: profile.model,
      effort: profile.effort,
      executionPreference: profile.executionPreference,
      maxBudgetUsd: profile.maxBudgetUsd,
      noProgressTimeoutMs: profile.noProgressTimeoutMs,
      pricingRoute: profile.pricingRoute,
      networkPolicy: profile.networkPolicy,
      advancedPolicy: profile.advancedPolicy,
      contractQuality: profile.contractQuality
    };
  });
  var models = ((hub.modelCatalog && hub.modelCatalog.models) || []).map(function(model){
    return {
      id: model.id,
      label: model.label,
      provider: model.provider,
      model: model.model,
      supportedEfforts: model.supportedEfforts
    };
  });
  return JSON.stringify({
    defaultProfileId: wp.defaultProfileId || "",
    profiles: profiles,
    models: models,
    readiness: hub.workerReadiness || []
  });
}

function workerConnectionStory(readiness, networkMode){
  var mode = networkMode === "direct" || networkMode === "custom-proxy" ? networkMode : "inherit";
  var reason = readiness && readiness.reason ? readiness.reason : "model-invalid";
  var state = readiness && readiness.state ? readiness.state : "blocked";
  var labelMap = {
    ready: "workersReadinessReady",
    launchable: "workersReadinessLaunchable",
    "needs-attention": "workersReadinessAttention",
    blocked: "workersReadinessBlocked"
  };
  var toneMap = {
    ready: "badge-ok",
    launchable: "badge-info",
    "needs-attention": "badge-warn",
    blocked: "badge-warn"
  };
  var storyMap = {
    ready: {
      inherit: "workersStoryReadyInherit",
      direct: "workersStoryReadyDirect",
      "custom-proxy": "workersStoryReadyCustom"
    },
    "connection-unverified": {
      inherit: "workersStoryLaunchUnverifiedInherit",
      direct: "workersStoryLaunchUnverifiedDirect",
      "custom-proxy": "workersStoryLaunchUnverifiedCustom"
    },
    "connection-stale": {
      inherit: "workersStoryLaunchStaleInherit",
      direct: "workersStoryLaunchStaleDirect",
      "custom-proxy": "workersStoryLaunchStaleCustom"
    },
    "connection-failed": {
      inherit: "workersStoryLaunchFailedInherit",
      direct: "workersStoryLaunchFailedDirect",
      "custom-proxy": "workersStoryLaunchFailedCustom"
    },
    "authentication-missing": "workersStoryBlockedAuth",
    "runtime-unavailable": "workersStoryBlockedRuntime",
    "pairing-invalid": "workersStoryBlockedPairing",
    "model-invalid": "workersStoryBlockedModel",
    "native-goal-unsupported": "workersStoryBlockedExecution"
  };
  var nextMap = {
    none: null,
    "run-smoke-check": "workersReadinessNextSmoke",
    "check-provider": "workersReadinessNextProvider",
    "configure-authentication": "workersReadinessNextAuth",
    "fix-runtime": "workersReadinessNextRuntime",
    "change-pairing": "workersReadinessNextPairing",
    "choose-model": "workersReadinessNextModel",
    "choose-execution-mode": "workersReadinessNextExecutionMode"
  };
  var entry = storyMap[reason];
  var conclusion = entry && typeof entry === "object"
    ? (entry[mode] || entry.inherit)
    : (entry || storyMap["model-invalid"]);
  return {
    label: labelMap[state] || "workersReadinessBlocked",
    tone: toneMap[state] || "badge-warn",
    conclusion: conclusion,
    next: nextMap[readiness && readiness.nextAction] || null,
    route: networkPolicySummary({ mode: mode })
  };
}

function executionPreferenceLabel(pref){
  var map = {
    auto: "workersExecutionAuto",
    "single-run": "workersExecutionSingleRun",
    "native-goal": "workersExecutionNativeGoal"
  };
  return t(map[pref] || "workersExecutionInherited");
}

function resolvedExecutionModeText(result){
  if(result && result.resolvedExecutionMode === "native-goal"){
    return t("workersExecutionResolvedNativeGoal");
  }
  if(result && result.resolvedExecutionMode === "single-run"){
    return t("workersExecutionResolvedSingleRun");
  }
  return "";
}

function executionPreferenceUnsupported(result){
  return Boolean(result && result.reason === "native-goal-unsupported");
}

function networkPolicySummary(policy){
  if(!policy) return t("workersNetworkCardInherit");
  if(policy.mode === "direct") return t("workersNetworkCardDirect");
  if(policy.mode === "custom-proxy") return t("workersNetworkCardCustom");
  return t("workersNetworkCardInherit");
}

function rWorker(){
  /* FL-116A draft continuity: capture the full unsaved form before any
   * deliberate rebuild (language switch, tab return, or direct render) so no
   * value is lost. Server-owned readiness/list data still refreshes on the
   * next poll; nothing is autosaved. */
  if(S.workerFormRendered && S.workerFormActive && S.workerFormContextId === S.workerEditId){
    var capturedDraft = workerCaptureDraftFromDom();
    if(capturedDraft) S.workerDraft = capturedDraft;
  }
  S.workerFormRendered = false;
  viewEl.textContent = "";
  flashError("");
  viewEl.appendChild(renderPageStory("workers"));
  var wp = (S.hub && S.hub.workerProfiles) || { defaultProfileId: "default", profiles: [] };
  var cat = (S.hub && S.hub.modelCatalog) || { models: [] };
  var models = cat.models || [];
  var modelLabel = function(id){
    var m = models.find(function(x){ return x.id === id; });
    return m ? m.label : (id || t("workersLegacyModel"));
  };
  var modelTechnicalLabel = function(id, prof){
    var m = models.find(function(x){ return x.id === id; });
    return m ? (m.provider + " / " + m.model) : ((prof.provider || "?") + " / " + (prof.model || "?"));
  };
  var effortLabel = function(effort){
    var names = {
      low: "workersEffortLow", medium: "workersEffortMedium", high: "workersEffortHigh",
      xhigh: "workersEffortXHigh", max: "workersEffortMax"
    };
    return t(names[effort] || "workersValueInherited");
  };
  var list = wp.profiles || [];
  if(S.workerEditId && !list.some(function(profile){ return profile.id === S.workerEditId; })){
    S.workerEditId = null;
    S.workerFormActive = false;
    S.workerDraft = null;
  }
  var split = hd("div", "configure-split");
  var listCol = hd("div", "configure-list");
  if(!list.length){
    listCol.appendChild(stateMsg("empty", t("workersEmpty")));
  }
  list.forEach(function(prof){
    var isDef = prof.id === wp.defaultProfileId;
    var isEditing = S.workerEditId === prof.id;
    var cardEl = h("div", "card profile-card worker-row" + (isEditing ? " is-editing is-selected" : ""));
    cardEl.setAttribute("data-fl-role", "worker-row");
    cardEl.setAttribute("data-worker-row-id", prof.id);
    cardEl.setAttribute("role", isEditing ? "group" : "button");
    if(isEditing){
      cardEl.setAttribute("aria-current", "true");
    } else {
      cardEl.setAttribute("tabindex", "0");
      cardEl.setAttribute("aria-pressed", "false");
    }
    var modelLine = prof.modelConfigId ? modelLabel(prof.modelConfigId) : (prof.model || "?");
    var modelTechnical = modelTechnicalLabel(prof.modelConfigId, prof);
    var badges = [];
    if(isDef) badges.push(h("span", "badge badge-ok", t("workersBadgeDefault")));
    else badges.push(h("span", "badge badge-dim", t("workersBadgeWorker")));
    if(isEditing) badges.push(h("span", "badge badge-info", t("workersEditBadge")));
    var badgeWrap = hd("div", "worker-row-badges", badges);
    cardEl.appendChild(cardHead(prof.label, "", badgeWrap));
    var advanced = prof.advancedPolicy || {};
    var story = h("div", "profile-story");

    /* One connection conclusion: status badge plus one plain-language sentence.
     * The pure helper combines canonical readiness with only the frozen network
     * mode, so the default row never repeats a generic route caveat and never
     * exposes proxy URLs. */
    var readiness = workerReadinessFor(prof.id);
    if(readiness){
      var storyData = workerConnectionStory(readiness, (prof.networkPolicy || {}).mode);
      var connection = hd("div", "profile-story-connection", [
        h("span", "badge " + storyData.tone, t(storyData.label)),
        h("div", "profile-story-conclusion", t(storyData.conclusion))
      ]);
      connection.setAttribute("data-fl-role", "worker-connection");
      story.appendChild(connection);
      if(storyData.next){
        story.appendChild(h("div", "profile-story-line dim fs11",
          t("workersReadinessNextLabel", { action: t(storyData.next) })));
      }
    }

    /* One compact execution identity line: model, runtime, resolved mode. */
    var execPrefText = prof.executionPreference === undefined
      ? t("workersExecutionSingleRun")
      : executionPreferenceLabel(prof.executionPreference);
    var execModeText = (readiness && readiness.state !== "blocked")
      ? resolvedExecutionModeText(readiness)
      : "";
    story.appendChild(h("div", "profile-story-line", t("workersCardExecutionIdentity", {
      model: modelLine,
      runtime: runtimeDisplayName(prof.runtime),
      mode: execModeText || execPrefText
    })));
    cardEl.appendChild(story);

    /* Only the selected Worker exposes management details. Unselected rows are
     * genuinely compact selectors: no repeated policy, technical inventory,
     * or action strip competes with the primary editor. */
    if(isEditing){
    var behavior = h("div", "journey-list");
    var budgetText = prof.maxBudgetUsd === null
      ? t("workersCardBudgetUnlimited")
      : (prof.maxBudgetUsd === undefined
        ? t("workersCardBudgetInherited")
        : t("workersCardBudgetLimited", { amount: String(prof.maxBudgetUsd) }));
    var progressValue = advanced.noProgressTimeoutMs !== undefined
      ? advanced.noProgressTimeoutMs : prof.noProgressTimeoutMs;
    var progressText = progressValue === null
      ? t("workersCardNoEffectiveProgressUnlimited")
      : (progressValue === undefined
        ? t("workersCardNoEffectiveProgressInherited")
        : t("workersCardNoEffectiveProgressLimited", { duration: readableDuration(progressValue) }));
    behavior.appendChild(h("div", "journey-list-item", budgetText + " "
      + t("workersCardEffort", { effort: effortLabel(prof.effort) }) + " " + progressText));
    var baseAttempts = advanced.baseMaxAttempts;
    var extraAttempts = advanced.maxExtraAttempts;
    var attemptText = baseAttempts === undefined || extraAttempts === undefined
      ? t("workersCardAttemptsInherited")
      : (extraAttempts === 0
        ? t("workersCardAttemptsNoExtra", { base: String(baseAttempts) })
        : t("workersCardAttempts", { base: String(baseAttempts), extra: String(extraAttempts) }));
    var adaptationText = advanced.maxAdaptationRounds === undefined
      ? t("workersCardAdaptationInherited")
      : (advanced.maxAdaptationRounds === 0
        ? t("workersCardAdaptationOff")
        : t("workersCardAdaptationOn", { count: String(advanced.maxAdaptationRounds) }));
    behavior.appendChild(h("div", "journey-list-item", attemptText + " " + adaptationText));
    /* Contract Quality summary: short human-readable label only. */
    var cq = prof.contractQuality;
    var qualitySummary = "";
    if(cq && typeof cq === "object"){
      var cqKeys = Object.keys(cq);
      qualitySummary = t("workersQualitySummaryOn", {
        mode: qualityModeLabel(cq.mode),
        overrides: String(cqKeys.length)
      });
    } else {
      qualitySummary = t("workersQualitySummaryOff");
    }
    behavior.appendChild(h("div", "journey-list-item dim fs11", qualitySummary));
    var behaviorDisclosure = journeyDisclosure(t("workersCardExecutionBehavior"), behavior);
    behaviorDisclosure.setAttribute("data-fl-role", "worker-execution-details");
    cardEl.appendChild(behaviorDisclosure);

    var technical = h("div", "journey-list");
    technical.appendChild(h("div", "journey-list-item mono dim", "Worker ID: " + prof.id));
    technical.appendChild(h("div", "journey-list-item mono dim", "Runtime: " + (prof.runtime || "?")));
    technical.appendChild(h("div", "journey-list-item mono dim", "Model: " + modelTechnical));
    if(readiness && readiness.checks){
      var checkLabels = {
        model: "workersReadinessCheckModel",
        pairing: "workersReadinessCheckPairing",
        authentication: "workersReadinessCheckAuth",
        runtime: "workersReadinessCheckRuntime",
        connection: "workersReadinessCheckConnection"
      };
      technical.appendChild(h("div", "journey-list-item", t("workersReadinessTechnical")));
      Object.keys(checkLabels).forEach(function(key){
        technical.appendChild(h("div", "journey-list-item mono dim",
          t(checkLabels[key]) + ": " + String(readiness.checks[key] || "unknown")));
      });
    }
    var routeLine = h("div", "journey-list-item dim");
    routeLine.appendChild(document.createTextNode(t("workersPricingRouteCardLabel") + ": "));
    if(typeof prof.pricingRoute === "string" && prof.pricingRoute){
      routeLine.appendChild(h("span", "mono", pricingRouteLabel(prof.pricingRoute)));
    } else {
      routeLine.appendChild(h("span", "dim", t("workersPricingRouteNotConfigured")));
    }
    routeLine.appendChild(document.createTextNode(" · " + t("workersPricingRouteBillingOnly")));
    technical.appendChild(routeLine);
    technical.appendChild(h("div", "journey-list-item dim fs11", t("workersNetworkCardNotProof")));
    var actions = h("div", "actions worker-row-actions");
    if(!isDef){
      var defBtn = h("button", "btn sm", t("workersSetDefault"));
      defBtn.type = "button";
      defBtn.addEventListener("click", function(ev){
        ev.stopPropagation();
        postJSON("/api/worker-profiles", { action: "setDefault", id: prof.id })
          .then(function(){ toast(t("workersDefaultSet") + prof.id); return refresh(); })
          .catch(function(e){ flashError(t("operationFailed"), e && e.message); });
      });
      actions.appendChild(defBtn);
    }
    if(list.length > 1){
      var rm = h("button", "btn sm danger", t("workersRemove"));
      rm.type = "button";
      rm.addEventListener("click", function(ev){
        ev.stopPropagation();
        if(!window.confirm(t("workersRemoveConfirm", { id: prof.id }))) return;
        postJSON("/api/worker-profiles", { action: "remove", id: prof.id })
          .then(function(){ toast(t("workersRemoved") + prof.id); return refresh(); })
          .catch(function(e){ flashError(t("operationFailed"), e && e.message); });
      });
      actions.appendChild(rm);
    }
    if(actions.childNodes.length){ technical.appendChild(actions); }
    cardEl.appendChild(journeyDisclosure(t("workersCardTechnicalDetails"), technical));
    }
    /* Selecting a row makes it the single primary editing context. Explicit
     * selection always discards any earlier unsaved draft for another Worker. */
    cardEl.addEventListener("click", function(){
      if(isEditing) return;
      S.workerDraft = null;
      S.workerEditId = prof.id;
      S.workerFormActive = true;
      render();
    });
    cardEl.addEventListener("keydown", function(e){
      if(e.key === "Enter" || e.key === " "){
        e.preventDefault();
        if(isEditing) return;
        S.workerDraft = null;
        S.workerEditId = prof.id;
        S.workerFormActive = true;
        render();
      }
    });
    listCol.appendChild(cardEl);
  });

  var form = h("form", "card form-card configure-form");
  form.setAttribute("novalidate", "true");
  var editingProfile = null;
  if(S.workerEditId){
    editingProfile = list.find(function(p){ return p.id === S.workerEditId; });
  }
  var isEdit = editingProfile !== undefined && editingProfile !== null;
  form.appendChild(h("div", "card-title", isEdit ? t("workersFormTitle") + " - " + editingProfile.id : t("workersFormTitle")));

  /* Group container helper: one decision flow per native disclosure. The closed
   * summary carries a short effective-value line; open state survives a Worker
   * page re-render through S.workerOpenGroups. */
  function workerGroup(groupKey, title){
    var d = document.createElement("details");
    d.className = "settings-group worker-group";
    d.setAttribute("data-fl-role", "worker-group");
    d.setAttribute("data-worker-group", groupKey);
    var s = document.createElement("summary");
    s.className = "settings-group-summary";
    s.setAttribute("data-fl-role", "worker-group-toggle");
    s.appendChild(h("span", "settings-group-title", title));
    var detailSpan = h("span", "settings-group-detail", "");
    detailSpan.setAttribute("data-worker-group-detail", groupKey);
    s.appendChild(detailSpan);
    d.appendChild(s);
    var saved = S.workerOpenGroups && S.workerOpenGroups[groupKey];
    if(saved !== undefined && saved !== null){
      d.open = !!saved;
    } else if(groupKey === "identity"){
      d.open = true;
    }
    d.addEventListener("toggle", function(){
      S.workerFormActive = true;
      if(!S.workerOpenGroups) S.workerOpenGroups = {};
      S.workerOpenGroups[groupKey] = d.open;
      workerRefreshSummaries();
      if(d.open && selR.value && (groupKey === "stops" || groupKey === "recovery" || groupKey === "contract")){
        scheduleWorkerPreview(selR.value);
      }
    });
    return d;
  }
  function workerGroupBody(group){
    var body = h("div", "settings-group-body");
    group.appendChild(body);
    return body;
  }
  function workerRefreshGroupDetail(group, text){
    var span = group.querySelector("[data-worker-group-detail]");
    if(span) span.textContent = text;
  }
  function workerAdvText(field){
    var el = document.querySelector('[data-adv="' + field + '"]');
    return el ? el.value.trim() : "";
  }
  function workerDurationText(field){
    var wrap = document.querySelector('[data-adv-duration="' + field + '"]');
    if(!wrap) return "";
    var v = wrap.querySelector("[data-adv-duration-value]");
    var u = wrap.querySelector("[data-adv-duration-unit]");
    if(!v || !v.value || v.value.trim() === "") return "";
    var ms = durationPartsToMs(v.value, u ? u.value : "minutes");
    return ms !== undefined ? readableDuration(ms) : "";
  }
  function workerRepairText(){
    var mode = document.querySelector("[data-repair-mode]");
    if(!mode) return "";
    var val = mode.value;
    if(val === "off") return t("workersAdvRepairValueOff");
    if(val === "one") return t("workersAdvRepairValueOne");
    if(val === "custom"){
      var inp = document.querySelector("[data-repair-value]");
      var raw = inp ? inp.value.trim() : "";
      if(raw !== "") return t("workersAdvRepairValueCount", { count: raw });
      return t("workersAdvRepairCustom");
    }
    return "";
  }
  function workerIdentitySummary(){
    var modelName = selM.value ? modelLabel(selM.value) : t("workersModelFirst");
    var mode;
    if(selEx.value === "native-goal" && selR.value !== "codex-cli"){
      mode = t("workersExecutionUnsupportedNativeGoal");
    } else if(selEx.value){
      mode = executionPreferenceLabel(selEx.value);
    } else {
      mode = t("workersExecutionInherited");
    }
    return modelName + " · " + runtimeDisplayName(selR.value) + " · " + mode;
  }
  function workerPreviewRow(field){
    var rows = S.workerPreviewRows || [];
    return rows.find(function(r){ return r && r.field === field; }) || null;
  }
  /* Closed-group summaries are driven by the latest backend effective preview
   * (S.workerPreviewRows) so they can never drift from policy truth. Draft
   * values are only a fallback before the first preview arrives. */
  function workerStopsSummary(){
    var parts = [];
    var maxDurRow = workerPreviewRow("maxDurationMs");
    if(maxDurRow){
      if(maxDurRow.unlimited) parts.push(t("workersGroupMaxDurationSummary", { value: t("workersPreviewUnlimited") }));
      else if(typeof maxDurRow.value === "number") parts.push(t("workersGroupMaxDurationSummary", { value: readableDuration(maxDurRow.value) }));
    } else {
      var maxDur = workerDurationText("maxDurationMs");
      if(maxDur) parts.push(t("workersGroupMaxDurationSummary", { value: maxDur }));
    }
    var progRow = workerPreviewRow("noProgressTimeoutMs");
    if(progRow){
      if(progRow.unlimited) parts.push(t("workersGroupNoProgressSummary", { value: t("workersPreviewUnlimited") }));
      else if(typeof progRow.value === "number") parts.push(t("workersGroupNoProgressSummary", { value: readableDuration(progRow.value) }));
    } else {
      var progress = workerDurationText("noProgressTimeoutMs");
      if(progress) parts.push(t("workersGroupNoProgressSummary", { value: progress }));
    }
    var tokenRow = workerPreviewRow("observedTokenCeiling");
    if(tokenRow && typeof tokenRow.value === "number"){
      parts.push(t("workersGroupTokenSummary", { value: String(tokenRow.value) }));
    } else if(tokenRow && tokenRow.unlimited){
      parts.push(t("workersGroupTokenSummary", { value: t("workersPreviewUnlimited") }));
    }
    var fileRow = workerPreviewRow("fileLimit");
    if(fileRow && typeof fileRow.value === "number"){
      parts.push(t("workersGroupFileSummary", { value: String(fileRow.value) }));
    } else if(fileRow && fileRow.unlimited){
      parts.push(t("workersGroupFileSummary", { value: t("workersPreviewUnlimited") }));
    }
    var lineRow = workerPreviewRow("changedLineLimit");
    if(lineRow && typeof lineRow.value === "number"){
      parts.push(t("workersGroupLineSummary", { value: String(lineRow.value) }));
    } else if(lineRow && lineRow.unlimited){
      parts.push(t("workersGroupLineSummary", { value: t("workersPreviewUnlimited") }));
    }
    var concRow = workerPreviewRow("maxConcurrency");
    if(concRow && typeof concRow.value === "number"){
      parts.push(t("workersGroupConcurrencySummary", { count: String(concRow.value) }));
    } else {
      var conc = workerAdvText("maxConcurrency");
      if(conc) parts.push(t("workersGroupConcurrencySummary", { count: conc }));
    }
    return parts.join(" · ") || t("workersGroupInheritedSummary");
  }
  function workerRecoverySummary(){
    var parts = [];
    var repairRow = workerPreviewRow("maxWorkerValidationRepairs");
    if(repairRow){
      parts.push(validationRepairConsequenceText(repairRow));
    } else {
      var repair = workerRepairText();
      if(repair) parts.push(repair);
    }
    var corrRow = workerPreviewRow("maxMainCorrections");
    if(corrRow && typeof corrRow.value === "number"){
      parts.push(t("workersGroupMainCorrectionsSummary", { count: String(corrRow.value) }));
    } else {
      var corrections = workerAdvText("maxMainCorrections");
      if(corrections !== "") parts.push(t("workersGroupMainCorrectionsSummary", { count: corrections }));
    }
    var revRow = workerPreviewRow("maxMainReverifications");
    if(revRow && typeof revRow.value === "number"){
      parts.push(t("workersGroupReverifySummary", { count: String(revRow.value) }));
    } else {
      var reverify = workerAdvText("maxMainReverifications");
      if(reverify !== "") parts.push(t("workersGroupReverifySummary", { count: reverify }));
    }
    var adaptRow = workerPreviewRow("maxAdaptationRounds");
    if(adaptRow && typeof adaptRow.value === "number"){
      parts.push(t(adaptRow.value === 0 ? "workersGroupAdaptationOffSummary" : "workersGroupAdaptationSummary", {
        count: String(adaptRow.value)
      }));
    }
    return parts.join(" · ") || t("workersGroupInheritedSummary");
  }
  function workerConnectionSummary(){
    var route = networkPolicySummary(selNet.value === "inherit"
      ? null
      : (selNet.value === "direct" ? { mode: "direct" } : { mode: "custom-proxy" }));
    var pricingSel = form.querySelector("#fl-wp-pricing-route");
    if(pricingSel && pricingSel.value){
      return route + " · " + t("workersPricingRouteCardLabel") + ": " + pricingRouteLabel(pricingSel.value);
    }
    return route;
  }
  function workerContractSummary(){
    var qrows = S.workerQualityPreviewRows;
    if(Array.isArray(qrows) && qrows.length){
      var modeRow = qrows.find(function(r){ return r.field === "mode"; });
      var overrides = qrows.filter(function(r){
        return r.field !== "mode" && r.value !== null && r.value !== undefined;
      }).length;
      return t("workersQualitySummaryOn", {
        mode: qualityModeLabel(modeRow ? modeRow.value : ""),
        overrides: String(overrides)
      });
    }
    var patch = collectQualityPatch();
    if(Object.keys(patch).length === 0) return t("workersQualitySummaryOff");
    var mode = qualityModeLabel(patch.mode || "");
    var count = Object.keys(patch).length - (patch.mode ? 1 : 0);
    return t("workersQualitySummaryOn", { mode: mode, overrides: String(count) });
  }
  function workerRefreshSummaries(){
    if(!identityGroup || !stopsGroup || !recoveryGroup || !connectionGroup || !contractGroup) return;
    workerRefreshGroupDetail(identityGroup, workerIdentitySummary());
    workerRefreshGroupDetail(stopsGroup, workerStopsSummary());
    workerRefreshGroupDetail(recoveryGroup, workerRecoverySummary());
    workerRefreshGroupDetail(connectionGroup, workerConnectionSummary());
    workerRefreshGroupDetail(contractGroup, workerContractSummary());
    if(typeof syncResolvedHint === "function") syncResolvedHint();
  }
  function workerPreviewWanted(){
    return (stopsGroup && stopsGroup.open)
      || (recoveryGroup && recoveryGroup.open)
      || (contractGroup && contractGroup.open);
  }
  function workerSchedulePreviewIfNeeded(){
    S.workerFormActive = true;
    if(workerPreviewWanted() && selR.value) scheduleWorkerPreview(selR.value);
  }
  /* Restore a captured unsaved draft into the freshly rebuilt form. This is a
   * pure presentation restore: values map back through the same collectors and
   * adapters that save uses, so nothing is invented and nothing is saved. */
  function workerRestoreDraft(){
    var draft = S.workerDraft;
    if(!draft) return;
    var setVal = function(id, val){
      var el = form.querySelector("#" + id);
      if(el) el.value = val;
    };
    var selectOption = function(sel, val){
      if(sel && val != null && sel.querySelector('option[value="' + val + '"]')){
        sel.value = val;
        return true;
      }
      return false;
    };
    setVal("fl-wp-label", draft.label != null ? draft.label : "");
    if(!isEdit) setVal("fl-wp-id", draft.workerId != null ? draft.workerId : "");
    if(draft.runtime) selectOption(selR, draft.runtime);
    syncCompatibleModels(draft.model || "");
    selectOption(selM, draft.model);
    syncModelEfforts(draft.effort != null ? draft.effort : "");
    selectOption(selEf, draft.effort);
    if(draft.budgetMode) selectOption(budgetMode, draft.budgetMode);
    setVal("fl-wp-budget", draft.budget != null ? draft.budget : "");
    syncBudgetInput();
    selectOption(selEx, draft.executionPreference);
    syncExecutionHint();
    if(draft.networkMode) selectOption(selNet, draft.networkMode);
    setVal("fl-wp-network-http", draft.networkHttp != null ? draft.networkHttp : "");
    setVal("fl-wp-network-https", draft.networkHttps != null ? draft.networkHttps : "");
    setVal("fl-wp-network-noproxy", draft.networkNoProxy != null ? draft.networkNoProxy : "");
    syncNetworkFields();
    if(draft.advancedPolicy && Object.keys(draft.advancedPolicy).length){
      hydrateAdvancedFields(stopsBody, draft.advancedPolicy);
      hydrateAdvancedFields(recoveryBody, draft.advancedPolicy);
    }
    if(draft.contractQuality && Object.keys(draft.contractQuality).length){
      hydrateQualityFields(contractBody, draft.contractQuality);
    }
    if(draft.pricingRoute){
      var pricingSel = form.querySelector("#fl-wp-pricing-route");
      if(pricingSel && pricingSel.querySelector('option[value="' + draft.pricingRoute + '"]')){
        pricingSel.value = draft.pricingRoute;
      }
    }
    if(draft.openGroups){
      S.workerOpenGroups = draft.openGroups;
    }
    workerReplayCapturedControls(form, draft);
    S.workerFormActive = true;
  }

  function field(id, label, type, val, ph, container){
    var lab = h("label", "", label);
    var inp = h("input", "");
    inp.type = type || "text"; inp.id = id; inp.value = val || "";
    if(ph) inp.placeholder = ph;
    lab.appendChild(inp); (container || form).appendChild(lab);
    return inp;
  }

  /* --- Identity and execution --- */
  var identityGroup = workerGroup("identity", t("workersGroupIdentity"));
  var identityBody = workerGroupBody(identityGroup);
  var idIn;
  if(isEdit){
    idIn = h("input", "");
    idIn.type = "hidden";
    idIn.id = "fl-wp-id";
    idIn.value = editingProfile.id;
    form.appendChild(idIn);
    var idLab = h("label", "", t("workersId") + " " + t("workersReadOnly"));
    var idReadonly = h("input", "");
    idReadonly.type = "text";
    idReadonly.value = editingProfile.id;
    idReadonly.readOnly = true;
    idLab.appendChild(idReadonly);
    identityBody.appendChild(idLab);
  } else {
    idIn = field("fl-wp-id", t("workersId"), "text", "", "e.g. cheap-ds", identityBody);
  }
  var labIn = field("fl-wp-label", t("workersLabel"), "text", isEdit ? (editingProfile.label || "") : "", "", identityBody);
  var labR = h("label", "", t("workersRuntime"));
  var selR = h("select", "");
  selR.id = "fl-wp-runtime";
  [["claude-code",t("workersRuntimeClaude")],["grok-build",t("workersRuntimeGrok")],["codex-cli",t("workersRuntimeCodex")]].forEach(function(pair){
    var o = document.createElement("option"); o.value = pair[0]; o.textContent = pair[1]; selR.appendChild(o);
  });
  if(isEdit && editingProfile.runtime) selR.value = editingProfile.runtime;
  labR.appendChild(selR); identityBody.appendChild(labR);
  var labM = h("label", "", t("workersModel"));
  var selM = h("select", "");
  selM.id = "fl-wp-model";
  function syncCompatibleModels(preferredId){
    var previous = preferredId || selM.value;
    var compatible = models.filter(function(mc){
      return workerModelCompatible(selR.value, mc);
    });
    selM.textContent = "";
    if(!compatible.length){
      var emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = models.length
        ? t("workersModelNoCompatible") : t("workersModelFirst");
      selM.appendChild(emptyOption);
      selM.disabled = true;
      return;
    }
    selM.disabled = false;
    compatible.forEach(function(mc){
      var o = document.createElement("option");
      o.value = mc.id;
      o.textContent = mc.label + " (" + mc.provider + " / " + mc.model + ")";
      selM.appendChild(o);
    });
    if(compatible.some(function(mc){ return mc.id === previous; })) selM.value = previous;
  }
  syncCompatibleModels(isEdit ? editingProfile.modelConfigId : "");
  labM.appendChild(selM); identityBody.appendChild(labM);
  identityBody.appendChild(h("div", "hint-inline dim fs11", t("workersModelCompatibilityHint")));
  var budgetModeLab = h("label", "", t("workersBudgetMode"));
  var budgetMode = h("select", "");
  budgetMode.id = "fl-wp-budget-mode";
  budgetModeLab.htmlFor = budgetMode.id;
  [
    ["inherit", t("workersBudgetInherit")],
    ["unlimited", t("workersBudgetUnlimited")],
    ["limited", t("workersBudgetLimited")]
  ].forEach(function(pair){
    var o = document.createElement("option");
    o.value = pair[0]; o.textContent = pair[1]; budgetMode.appendChild(o);
  });
  budgetMode.value = isEdit
    ? (editingProfile.maxBudgetUsd === null
      ? "unlimited"
      : (typeof editingProfile.maxBudgetUsd === "number" ? "limited" : "inherit"))
    : "inherit";
  budgetModeLab.appendChild(budgetMode); identityBody.appendChild(budgetModeLab);
  var budgetIn = field("fl-wp-budget", t("workersBudget"), "number", isEdit && typeof editingProfile.maxBudgetUsd === "number" ? String(editingProfile.maxBudgetUsd) : "", "0.5", identityBody);
  budgetIn.step = "0.01"; budgetIn.min = "0.01";
  function syncBudgetInput(){
    budgetIn.disabled = budgetMode.value !== "limited";
  }
  budgetMode.addEventListener("change", syncBudgetInput);
  syncBudgetInput();
  var labEf = h("label", "", t("workersEffort"));
  var selEf = h("select", "");
  selEf.id = "fl-wp-effort";
  var effortPairs = [["",t("inherit")],["low",t("workersEffortLow")],["medium",t("workersEffortMedium")],
    ["high",t("workersEffortHigh")],["xhigh",t("workersEffortXHigh")],["max",t("workersEffortMax")]];
  function syncModelEfforts(preferred){
    var selected = models.find(function(mc){ return mc.id === selM.value; });
    var allowed = selected && Array.isArray(selected.supportedEfforts)
      ? selected.supportedEfforts : null;
    var previous = preferred !== undefined ? preferred : selEf.value;
    selEf.textContent = "";
    effortPairs.forEach(function(pair){
      if(pair[0] && allowed && allowed.indexOf(pair[0]) < 0) return;
      if(!pair[0] && allowed) return;
      var o = document.createElement("option"); o.value = pair[0]; o.textContent = pair[1]; selEf.appendChild(o);
    });
    var options = Array.from(selEf.options).map(function(option){ return option.value; });
    if(options.indexOf(previous) >= 0) selEf.value = previous;
    else if(options.indexOf("max") >= 0 && selR.value === "codex-cli") selEf.value = "max";
    else selEf.value = options[0] || "";
  }
  syncModelEfforts(isEdit ? (editingProfile.effort || "") : "medium");
  labEf.appendChild(selEf); identityBody.appendChild(labEf);
  var labEx = h("label", "", t("workersExecutionLabel"));
  var selEx = h("select", "");
  selEx.id = "fl-wp-execution";
  labEx.htmlFor = selEx.id;
  [
    ["auto", t("workersExecutionAuto")],
    ["single-run", t("workersExecutionSingleRun")],
    ["native-goal", t("workersExecutionNativeGoal")]
  ].forEach(function(pair){
    var o = document.createElement("option"); o.value = pair[0]; o.textContent = pair[1]; selEx.appendChild(o);
  });
  if(isEdit && editingProfile.executionPreference){
    selEx.value = editingProfile.executionPreference;
  } else if(isEdit){
    // Editing a legacy profile: keep it unchanged (single-run) unless the user
    // chooses explicitly. The empty option means "preserve the saved value".
    var inheritOption = document.createElement("option");
    inheritOption.value = ""; inheritOption.textContent = t("workersExecutionInherited");
    selEx.insertBefore(inheritOption, selEx.firstChild);
    selEx.value = "";
  } else {
    // New Workers default to auto.
    selEx.value = "auto";
  }
  labEx.appendChild(selEx); identityBody.appendChild(labEx);
  var execHint = h("div", "hint-inline dim fs11", t("workersExecutionAutoHint"));
  identityBody.appendChild(execHint);
  var resolvedHint = h("div", "hint-inline dim fs11 resolved-hint", "");
  identityBody.appendChild(resolvedHint);
  /* Each execution choice explains its own real behavior: auto resolves by
   * Runtime proof, forced native Goal requires proof, single-run never reuses
   * auto copy. The resolved line below only reads backend readiness for the
   * unchanged saved Runtime so no capability is invented in the browser. */
  function syncExecutionHint(){
    if(selEx.value === "native-goal" && selR.value !== "codex-cli"){
      execHint.textContent = t("workersExecutionUnsupportedNativeGoal");
      execHint.classList.add("is-blocked");
    } else if(selEx.value === "native-goal"){
      execHint.textContent = t("workersExecutionNativeGoalHint");
      execHint.classList.remove("is-blocked");
    } else if(selEx.value === "single-run"){
      execHint.textContent = t("workersExecutionSingleRunHint");
      execHint.classList.remove("is-blocked");
    } else {
      execHint.textContent = t("workersExecutionAutoHint");
      execHint.classList.remove("is-blocked");
    }
  }
  function syncResolvedHint(){
    var text = workerResolvedModeForSelection();
    resolvedHint.textContent = text;
    resolvedHint.hidden = !text;
  }
  function workerResolvedModeForSelection(){
    if(!S.workerEditId) return "";
    var savedProf = list.find(function(p){ return p.id === S.workerEditId; });
    if(!savedProf || savedProf.runtime !== selR.value) return "";
    var readiness = workerReadinessFor(S.workerEditId);
    return readiness ? resolvedExecutionModeText(readiness) : "";
  }
  selEx.addEventListener("change", function(){ syncExecutionHint(); workerRefreshSummaries(); });
  selR.addEventListener("change", function(){ syncExecutionHint(); syncResolvedHint(); });
  syncExecutionHint();
  syncResolvedHint();

  /* --- Stop conditions and scale --- */
  var stopsGroup = workerGroup("stops", t("workersGroupStops"));
  var stopsBody = workerGroupBody(stopsGroup);
  stopsBody.appendChild(buildAdvancedFields("stops"));

  /* --- Recovery and verification --- */
  var recoveryGroup = workerGroup("recovery", t("workersGroupRecovery"));
  var recoveryBody = workerGroupBody(recoveryGroup);
  var narrative = h("div", "recovery-narrative");
  narrative.appendChild(h("div", "summary-line dim fs11", t("workersRecoveryNarrative")));
  narrative.appendChild(h("div", "summary-line dim fs11 mt-4", t("workersRecoverySeparateNote")));
  recoveryBody.appendChild(narrative);
  recoveryBody.appendChild(policyModeNote());
  recoveryBody.appendChild(buildAdvancedFields("recovery"));

  /* --- Connection and evidence --- */
  var connectionGroup = workerGroup("connection", t("workersGroupConnection"));
  var connectionBody = workerGroupBody(connectionGroup);
  var netRow = h("div", "advanced-row");
  var netLab = h("label", "", t("workersNetworkLabel"));
  var selNet = h("select", "");
  selNet.id = "fl-wp-network-mode";
  netLab.htmlFor = selNet.id;
  [
    ["inherit", t("workersNetworkInherit")],
    ["direct", t("workersNetworkDirect")],
    ["custom-proxy", t("workersNetworkCustomProxy")]
  ].forEach(function(pair){
    var o = document.createElement("option");
    o.value = pair[0]; o.textContent = pair[1]; selNet.appendChild(o);
  });
  netLab.appendChild(selNet);
  netRow.appendChild(netLab);
  function netField(id, label, placeholder){
    var inp = h("input", "");
    inp.type = "text"; inp.id = id; inp.placeholder = placeholder;
    var lab = h("label", "", label);
    lab.htmlFor = id;
    lab.appendChild(inp);
    var wrap = h("div", "network-field");
    wrap.appendChild(lab);
    netRow.appendChild(wrap);
    return { wrap: wrap, input: inp };
  }
  var netHttpField = netField("fl-wp-network-http", t("workersNetworkHttpProxy"), "http://127.0.0.1:7890");
  var netHttpsField = netField("fl-wp-network-https", t("workersNetworkHttpsProxy"), "http://127.0.0.1:7891");
  var netNoProxyField = netField("fl-wp-network-noproxy", t("workersNetworkNoProxy"), "localhost,127.0.0.1");
  var netHttp = netHttpField.input;
  var netHttps = netHttpsField.input;
  var netNoProxy = netNoProxyField.input;
  var netHint = h("div", "hint-inline dim fs11", t("workersNetworkInheritHint"));
  connectionBody.appendChild(netRow);
  connectionBody.appendChild(netHint);
  if(isEdit && editingProfile.networkPolicy){
    var netPolicy = editingProfile.networkPolicy;
    if(netPolicy.mode === "direct"){
      selNet.value = "direct";
    } else if(netPolicy.mode === "custom-proxy"){
      selNet.value = "custom-proxy";
      netHttp.value = netPolicy.httpProxy || "";
      if(netPolicy.httpsProxy) netHttps.value = netPolicy.httpsProxy;
      if(netPolicy.noProxy) netNoProxy.value = netPolicy.noProxy;
    } else {
      selNet.value = "inherit";
    }
  } else {
    selNet.value = "inherit";
  }
  function syncNetworkFields(){
    var custom = selNet.value === "custom-proxy";
    netHttpField.wrap.hidden = !custom;
    netHttpsField.wrap.hidden = !custom;
    netNoProxyField.wrap.hidden = !custom;
    if(selNet.value === "direct"){
      netHint.textContent = t("workersNetworkDirectHint");
    } else if(selNet.value === "custom-proxy"){
      netHint.textContent = t("workersNetworkCustomProxyHint");
    } else {
      netHint.textContent = t("workersNetworkInheritHint");
    }
  }
  selNet.addEventListener("change", syncNetworkFields);
  syncNetworkFields();
  var routeRow = h("div", "advanced-row");
  routeRow.appendChild(buildPricingRouteField());
  connectionBody.appendChild(routeRow);

  /* --- Task-contract clarity --- */
  var contractGroup = workerGroup("contract", t("workersGroupContract"));
  contractGroup.classList.add("quality-disclosure");
  contractGroup.setAttribute("aria-label", t("workersQualityGroup"));
  var contractBody = workerGroupBody(contractGroup);
  contractBody.appendChild(h("div", "summary-line dim mb-8", t("workersQualityGroupHint")));
  contractBody.appendChild(buildQualityFields());

  /* Hydrate saved values into the grouped editor. */
  if(isEdit){
    var policyForEditor = Object.assign({}, editingProfile.advancedPolicy || {});
    if(policyForEditor.noProgressTimeoutMs === undefined && editingProfile.noProgressTimeoutMs !== undefined){
      policyForEditor.noProgressTimeoutMs = editingProfile.noProgressTimeoutMs;
    }
    hydrateAdvancedFields(stopsBody, policyForEditor);
    hydrateAdvancedFields(recoveryBody, policyForEditor);
    hydratePricingRouteField(connectionBody, editingProfile);
    hydrateQualityFields(contractBody, editingProfile.contractQuality);
  } else {
    hydratePricingRouteField(connectionBody, null);
  }
  /* A captured unsaved draft overrides saved values after hydration so any
   * deliberate rWorker rebuild (language switch, tab return) keeps the draft. */
  if(S.workerDraft){
    workerRestoreDraft();
  }

  form.appendChild(identityGroup);
  form.appendChild(stopsGroup);
  form.appendChild(recoveryGroup);
  form.appendChild(connectionGroup);
  form.appendChild(contractGroup);

  /* Effective values before save: backend-owned previews with a plain-language
   * consequence summary first; the full source/enforcement table stays under a
   * technical disclosure. The preview regions are flat sections, not nested
   * cards, so they follow the existing hierarchy. */
  var previewRegion = h("div", "worker-preview-region");
  var previewPanel = h("div", "preview-panel");
  previewPanel.id = "fl-worker-preview";
  previewPanel.appendChild(h("div", "summary-line dim", t("workersPreviewEmpty")));
  previewRegion.appendChild(previewPanel);
  var qualPreviewPanel = h("div", "preview-panel");
  qualPreviewPanel.id = "fl-quality-preview";
  qualPreviewPanel.appendChild(h("div", "summary-line dim", t("workersPreviewEmpty")));
  previewRegion.appendChild(qualPreviewPanel);
  form.appendChild(previewRegion);

  /* Fixed safety rules: explanatory and never editable. The flexible limits
   * above cannot weaken these. */
  var safety = h("div", "safety-rules worker-safety");
  safety.setAttribute("data-fl-role", "worker-safety");
  safety.appendChild(h("div", "card-title mb-4", t("workersSafetyTitle")));
  safety.appendChild(h("div", "summary-line dim fs11", t("workersSafetyIntro")));
  [
    t("workersSafetyWorkspace"),
    t("workersSafetyCommit"),
    t("workersSafetyVerification"),
    t("workersSafetyIntegration")
  ].forEach(function(rule){
    safety.appendChild(h("div", "summary-line fs11 safety-rule", rule));
  });
  form.appendChild(safety);

  var saveLabel = isEdit ? t("workersSave") : t("workersSave");
  form.appendChild(formActions(saveLabel, null, {
    label: t("workersNext"),
    onClick: function(){ switchTab("mains"); }
  }));
  form.addEventListener("submit", function(ev){
    ev.preventDefault();
    flashError("");
    if(!selM.value){
      flashError(t("workersModelFirst"));
      return;
    }
    if(selEx.value === "native-goal" && selR.value !== "codex-cli"){
      flashError(t("workersExecutionUnsupportedNativeGoal"));
      return;
    }
    var profile = {
      id: isEdit ? editingProfile.id : idIn.value.trim(),
      label: labIn.value.trim() || (isEdit ? editingProfile.label : idIn.value.trim()),
      runtime: selR.value,
      modelConfigId: selM.value
    };
    if(selEf.value) profile.effort = selEf.value;
    if(selEx.value) profile.executionPreference = selEx.value;
    if(selNet.value === "custom-proxy"){
      var netHttpValue = netHttp.value.trim();
      if(!netHttpValue){
        flashError(t("workersNetworkProxyRequired"));
        return;
      }
      profile.networkPolicy = { mode: "custom-proxy", httpProxy: netHttpValue };
      if(netHttps.value.trim()) profile.networkPolicy.httpsProxy = netHttps.value.trim();
      if(netNoProxy.value.trim()) profile.networkPolicy.noProxy = netNoProxy.value.trim();
    } else if(selNet.value === "direct"){
      profile.networkPolicy = { mode: "direct" };
    } else {
      profile.networkPolicy = { mode: "inherit" };
    }
    if(budgetMode.value === "unlimited"){
      profile.maxBudgetUsd = null;
    } else if(budgetMode.value === "limited"){
      if(budgetIn.value === "" || Number(budgetIn.value) <= 0){
        flashError(t("workersBudgetRequired"));
        return;
      }
      profile.maxBudgetUsd = Number(budgetIn.value);
    }
    var advPatch = collectAdvancedPatch();
    if(Object.keys(advPatch).length > 0) profile.advancedPolicy = advPatch;
    else if(isEdit && editingProfile.advancedPolicy) profile.advancedPolicy = editingProfile.advancedPolicy;
    var pricingRoute = collectPricingRouteField(form);
    if(pricingRoute !== undefined){
      profile.pricingRoute = pricingRoute;
    }
    var qualityPatch = collectQualityPatch();
    if(Object.keys(qualityPatch).length > 0) profile.contractQuality = qualityPatch;
    postJSON("/api/worker-profiles", { action: "upsert", profile: profile })
      .then(function(){
        toast(t("workersSaved") + profile.id);
        S.workerEditId = null;
        S.workerFormActive = false;
        S.workerOpenGroups = {};
        S.workerDraft = null;
        S.workerFormRendered = false;
        return refresh();
      })
      .catch(function(e){ flashError(t("operationFailed"), e && e.message); });
  });

  /* Live preview and summary updates: policy bodies schedule the backend-owned
   * effective preview; any form interaction preserves the active draft. */
  stopsBody.addEventListener("input", workerSchedulePreviewIfNeeded);
  stopsBody.addEventListener("change", workerSchedulePreviewIfNeeded);
  recoveryBody.addEventListener("input", workerSchedulePreviewIfNeeded);
  recoveryBody.addEventListener("change", workerSchedulePreviewIfNeeded);
  connectionBody.addEventListener("input", workerSchedulePreviewIfNeeded);
  connectionBody.addEventListener("change", workerSchedulePreviewIfNeeded);
  contractBody.addEventListener("input", function(e){
    if(e && e.target && e.target.getAttribute("data-quality-max-mode")){
      syncQualityMaximumInput(e.target);
    }
    workerSchedulePreviewIfNeeded();
  });
  contractBody.addEventListener("change", function(e){
    if(e && e.target && e.target.getAttribute("data-quality-max-mode")){
      syncQualityMaximumInput(e.target);
    }
    workerSchedulePreviewIfNeeded();
  });
  form.addEventListener("input", function(){ S.workerFormActive = true; workerRefreshSummaries(); });
  form.addEventListener("change", function(){ S.workerFormActive = true; workerRefreshSummaries(); });
  selR.addEventListener("change", function(){
    syncCompatibleModels("");
    syncModelEfforts(undefined);
    syncExecutionHint();
    if(workerPreviewWanted() && selR.value){
      scheduleWorkerPreview(selR.value);
    }
    workerRefreshSummaries();
  });
  selM.addEventListener("change", function(){
    syncModelEfforts(undefined);
    workerRefreshSummaries();
  });
  budgetMode.addEventListener("change", workerRefreshSummaries);
  selEx.addEventListener("change", workerRefreshSummaries);
  selNet.addEventListener("change", function(){
    syncNetworkFields();
    workerRefreshSummaries();
  });

  if(isEdit){
    form.appendChild(h("div", "summary-line dim fs11 mt-8", t("workersEditing", { id: editingProfile.id })));
  }
  split.appendChild(listCol);
  split.appendChild(form);
  viewEl.appendChild(split);
  workerRefreshSummaries();
  if(isEdit && selR.value){
    scheduleWorkerPreview(selR.value);
  }
  /* The page renderer is now a live Worker form: the next rebuild may capture
   * the unsaved draft, and the backend preview can refresh the summaries. */
  S.workerSummariesRefresher = workerRefreshSummaries;
  S.workerFormRendered = true;
  S.workerFormContextId = S.workerEditId;
  S.workerRenderedTruthKey = workerVisibleTruthKey();

  var foot = hd("div", "grid-2 mt-8");
  var hs = hubSettings();
  var sys = h("div", "card");
  sys.appendChild(h("div", "card-title mb-4", t("workersSystemCeiling")));
  sys.appendChild(h("div", "summary-line",
    t("workersSystemLine", { max: String(hs.maximumBudgetUsd ?? "?"), conc: String(hs.maxConcurrency ?? "?") })
  ));
  foot.appendChild(sys);
  var doctor = h("div", "card");
  doctor.appendChild(h("div", "card-title mb-4", t("workersDoctor")));
  var runtimes = (S.hub && S.hub.runtimes) || {};
  Object.keys(runtimes).forEach(function(name){
    var r = runtimes[name] || {};
    var line = h("div", "summary-line");
    line.appendChild(document.createTextNode((r.displayName || name) + " · "));
    line.appendChild(h("span", "badge " + (r.ok ? "badge-ok" : "badge-warn"),
      t(r.ok ? "workersDoctorOk" : "workersNotReady")));
    if(!r.ok){
      appendBoundedDetail(line, (r.issues || []).join("; "));
    }
    doctor.appendChild(line);
  });
  foot.appendChild(doctor);
  viewEl.appendChild(foot);
}

function rLimits(){
  viewEl.textContent = "";
  flashError("");
  viewEl.appendChild(guideCard(t("guideSystem"), t("systemGuideTitle"), t("systemGuideBody")));
  var hs = hubSettings();
  var form = h("form", "card form-card");
  form.setAttribute("novalidate", "true");
  function numField(id, label, val, step, min){
    var lab = h("label", "", label);
    var inp = h("input", "");
    inp.type = "number"; inp.id = id; inp.step = step; inp.min = min;
    inp.value = val == null ? "" : String(val);
    lab.appendChild(inp); form.appendChild(lab);
    return inp;
  }
  var b = numField("fl-budget", "Default max budget (USD)", hs.defaultMaxBudgetUsd, "0.01", "0.01");
  var mb = numField("fl-max-budget", "Hard maximum budget (USD)", hs.maximumBudgetUsd, "0.01", "0.01");
  var c = numField("fl-concurrency", "Max concurrency", hs.maxConcurrency || 1, "1", "1");
  var timeoutIn = numField("fl-timeout", t("workersAdvNoEffectiveProgress"), hs.noProgressTimeoutMs || 600000, "1000", "1000");
  form.appendChild(formActions(t("systemSave"), null, {
    label: t("systemBack"),
    onClick: function(){ switchTab("worker"); }
  }));
  form.addEventListener("submit", function(ev){
    ev.preventDefault();
    flashError("");
    postJSON("/api/settings", {
      defaultProvider: hs.defaultProvider,
      defaultRuntime: hs.defaultRuntime,
      defaultMaxBudgetUsd: Number(b.value),
      maximumBudgetUsd: Number(mb.value),
      maxConcurrency: Number(c.value),
      noProgressTimeoutMs: Number(timeoutIn.value)
    }).then(function(){
      toast(t("systemSaved"));
      return refresh();
    }).catch(function(e){ flashError(t("operationFailed"), e && e.message); });
  });
  viewEl.appendChild(form);
}

function rMains(){
  viewEl.textContent = "";
  flashError("");
  viewEl.appendChild(renderPageStory("main"));
  var mains = (S.hub && S.hub.mains) || [];
  if(!mains.length){
    viewEl.appendChild(stateMsg("empty", t("mainEmpty")));
    return;
  }
  var labels = { "codex": "Codex", "claude-code": "Claude Code", "grok-build": "Grok Build" };
  function channelRow(client, component, label, status, hint){
    var row = h("div", "channel-row");
    var left = h("div", "channel-meta");
    var titleLine = h("div", "channel-title", label + " ");
    titleLine.appendChild(h("span", "badge " + (status.supported === false
      ? "badge-dim"
      : (status.installed ? "badge-ok" : "badge-warn")),
      status.supported === false
        ? t("mainChannelNa")
        : (status.installed ? t("mainChannelOn") : t("mainChannelOff"))));
    left.appendChild(titleLine);
    if(hint) left.appendChild(h("div", "summary-line dim fs11", hint));
    if(status.path){
      left.appendChild(journeyDisclosure(
        t("mainTechnicalLocation"),
        h("div", "summary-line mono dim fs11", status.path)
      ));
    }
    row.appendChild(left);
    var actions = h("div", "actions");
    if(status.supported !== false){
      var inst = h("button", "btn sm " + (status.installed ? "" : "primary"),
        status.installed ? t("mainChannelReinstall") : t("mainChannelInstall"));
      inst.type = "button";
      inst.addEventListener("click", function(){
        inst.disabled = true;
        postJSON("/api/mains/install", { client: client, component: component })
          .then(function(res){ toast(res.message || t("installed")); return refresh(); })
          .catch(function(e){ flashError(t("operationFailed"), e && e.message); })
          .finally(function(){ inst.disabled = false; });
      });
      actions.appendChild(inst);
      if(status.installed){
        var un = h("button", "btn sm danger", t("mainChannelUninstall"));
        un.type = "button";
        un.addEventListener("click", function(){
          if(!window.confirm(t("mainChannelUninstallConfirm", {
            name: labels[client] || client,
            component: label
          }))) return;
          un.disabled = true;
          postJSON("/api/mains/uninstall", { client: client, component: component })
            .then(function(res){ toast(res.message || t("mainChannelRemoved")); return refresh(); })
            .catch(function(e){ flashError(t("operationFailed"), e && e.message); })
            .finally(function(){ un.disabled = false; });
        });
        actions.appendChild(un);
      }
    }
    row.appendChild(actions);
    return row;
  }

  var grid = hd("div", "mains-grid");
  mains.forEach(function(m){
    var client = m.client;
    var plugin = m.plugin || { supported: client === "codex", installed: false, message: "" };
    var mcpOk = m.mcp ? !!m.mcp.installed : !!m.installed;
    var skillOk = m.skill ? !!m.skill.installed : false;
    var anyOk = !!(plugin.installed || mcpOk || skillOk);
    var allOk = (plugin.supported === false || plugin.installed) && mcpOk && skillOk;
    var cardEl = h("div", "card");
    cardEl.appendChild(cardHead(
      labels[client] || client,
      "",
      h("span", "badge " + (anyOk ? "badge-ok" : "badge-dim"),
        anyOk ? t("mainReady") : t("mainChannelOff"))
    ));
    cardEl.appendChild(h("div", "profile-story-purpose",
      allOk ? t("mainCardComplete") : (anyOk ? t("mainCardUsable") : t("mainCardDisconnected"))));
    cardEl.appendChild(channelRow(
      client, "plugin", t("mainChannelPlugin"), plugin,
      client === "codex" ? t("mainPluginHint") : t("mainPluginNaHint")
    ));
    cardEl.appendChild(channelRow(
      client, "mcp", t("mainChannelMcp"),
      { supported: true, installed: mcpOk, path: m.mcp && m.mcp.targetPath, message: m.mcp && m.mcp.message },
      t("mainMcpHint")
    ));
    cardEl.appendChild(channelRow(
      client, "skill", t("mainChannelSkill"),
      m.skill || { supported: true, installed: skillOk, message: "" },
      t("mainSkillHint")
    ));
    var bulk = h("div", "actions");
    var allInst = h("button", "btn sm", t("mainInstallAll"));
    allInst.type = "button";
    allInst.addEventListener("click", function(){
      allInst.disabled = true;
      postJSON("/api/mains/install", { client: client, component: "all" })
        .then(function(res){ toast(res.message || t("installed")); return refresh(); })
        .catch(function(e){ flashError(t("operationFailed"), e && e.message); })
        .finally(function(){ allInst.disabled = false; });
    });
    bulk.appendChild(allInst);
    if(anyOk){
      var allUn = h("button", "btn sm danger", t("mainUninstallAll"));
      allUn.type = "button";
      allUn.addEventListener("click", function(){
        if(!window.confirm(t("mainUninstallConfirm", { name: labels[client] || client }))) return;
        allUn.disabled = true;
        postJSON("/api/mains/uninstall", { client: client, component: "all" })
          .then(function(res){ toast(res.message || t("mainChannelRemoved")); return refresh(); })
          .catch(function(e){ flashError(t("operationFailed"), e && e.message); })
          .finally(function(){ allUn.disabled = false; });
      });
      bulk.appendChild(allUn);
    }
    cardEl.appendChild(bulk);
    grid.appendChild(cardEl);
  });
  viewEl.appendChild(grid);
  viewEl.appendChild(h("div", "summary-line mt-8", t("mainFooter")));
}

/* Legacy peer/default pages (Overview/Board/Plans/Goals) were folded into the
 * single Work surface. Old saved state and internal links still name them; they
 * redirect to Work so work is never fragmented across peer lists. Overview
 * stays as bounded compatibility render code only - never a peer primary view. */
var LEGACY_TAB_REDIRECT = {
  overview: "work",
  board: "work",
  tasks: "work",
  plans: "work",
  goals: "work"
};
/* The legacy task-file submission page stays reachable behind the Work page's
 * explicit Advanced action (not peer navigation). */
function switchTab(name, opts){
  if(S.tab === "work") workPersistReadingContext();
  var effective = (opts && opts.legacy && LEGACY_TAB_REDIRECT[name]) ? name
    : (LEGACY_TAB_REDIRECT[name] || name);
  /* FL-116A draft continuity: capture the unsaved Worker form before the page
   * is replaced so returning to the Worker tab restores it. */
  if(S.tab === "worker" && S.workerFormRendered && S.workerFormActive){
    var leavingDraft = workerCaptureDraftFromDom();
    if(leavingDraft) S.workerDraft = leavingDraft;
  }
  S.tab = effective;
  updateProductNav();
  if(S.tab !== "worker"){ S.workerFormActive = false; S.workerFormRendered = false; }
  if(S.tab !== "work") S.outcomeFormActive = false;
  hideDetail();
  /* The Work board is being replaced; the open Move/Act chooser must not dangle
   * and any pending-action handoff for the previous task must not survive. */
  workActionChooserReset();
  workPendingHandoffReset();
  // Render immediately with retained evidence (or loading if never fetched).
  render();
  // Immediately fetch this page's required data.
  refresh();
}

/* --- Delivery page (Configure → Delivery) --- */
function deliveryValidateDraft(draft){
  var errors = {};
  if((draft.profiles || []).length > DELIVERY_MAX_PROFILES){
    errors._profiles = "deliveryInvalidTooManyProfiles";
  }
  (draft.profiles || []).forEach(function(p, idx){
    if(!DELIVERY_ID_RE.test(p.id)){
      errors["profile-" + idx] = "deliveryInvalidInvalidId";
    }
    if(typeof p.label !== "string" || p.label.trim().length < 1 || p.label.length > 80){
      errors["label-" + idx] = "deliveryInvalidLabel";
    }
    [p.buildCommands, p.activationCommands, p.activationCheckCommands].forEach(function(commands, cmdIdx){
      if(!Array.isArray(commands) || commands.length > DELIVERY_MAX_CMDS){
        errors["commands-" + idx + "-" + cmdIdx] = "deliveryInvalidTooManyCommands";
      }
    });
  });
  var ids = {};
  (draft.profiles || []).forEach(function(p){
    if(ids[p.id]) errors["dup-" + p.id] = "deliveryInvalidDuplicateId";
    ids[p.id] = true;
  });
  if(draft.defaultProfileId && !ids[draft.defaultProfileId]){
    errors._default = "deliveryInvalidMissingDefault";
  }
  Object.keys(draft.projectBindings || {}).forEach(function(path){
    if(!deliveryIsCanonicalPath(path)){
      errors["path-" + path] = "deliveryInvalidBadPath";
      return;
    }
    if(!ids[draft.projectBindings[path]]){
      errors["path-" + path] = "deliveryInvalidBindingProfile";
    }
  });
  return errors;
}
function deliveryCmdText(commands){
  if(!Array.isArray(commands) || commands.length === 0) return "";
  return commands.join("\n");
}
function deliveryRenderProfileList(saved){
  var draft = S.deliveryDraft || saved;
  var list = h("div", "delivery-list");
  if(!draft.profiles.length){
    list.appendChild(h("div", "summary-line dim", t("deliveryProfilesEmpty")));
    return list;
  }
  draft.profiles.forEach(function(p){
    var cardEl = h("div", "delivery-profile-card");
    var head = h("div", "dp-head");
    head.appendChild(h("span", "dp-id", p.id));
    head.appendChild(h("div", "summary-line", p.label));
    if(draft.defaultProfileId === p.id){
      head.appendChild(h("span", "badge badge-ok", t("deliveryDefaultProfileLabel")));
    }
    cardEl.appendChild(head);
    function addCmdBlock(labelKey, explainKey, commands){
      var block = h("div", "dp-cmd-block");
      block.appendChild(h("div", "dp-cmd-label", t(labelKey)));
      if(commands.length === 0){
        var empty = h("div", "dp-cmd-text empty", "( " + t("deliveryCmdExplainNotConfigured") + " )");
        block.appendChild(empty);
      } else {
        block.appendChild(h("div", "summary-line", t("deliveryCommandCount", { count: String(commands.length) })));
        block.appendChild(journeyDisclosure(
          t("deliveryCommandDetails"),
          h("div", "dp-cmd-text", commands.join("\n"))
        ));
      }
      block.appendChild(h("div", "de-field-explain", t(explainKey)));
      cardEl.appendChild(block);
    }
    addCmdBlock("deliveryCmdBuild", "deliveryCmdExplainBuild", p.buildCommands);
    addCmdBlock("deliveryCmdActivation", "deliveryCmdExplainActivation", p.activationCommands);
    addCmdBlock("deliveryCmdActivationCheck", "deliveryCmdExplainActivationCheck", p.activationCheckCommands);
    var actions = h("div", "dp-actions");
    var editBtn = h("button", "btn sm", t("deliveryProfileEditBtn"));
    editBtn.type = "button";
    editBtn.addEventListener("click", function(){ S.deliveryEditId = p.id; render(); });
    actions.appendChild(editBtn);
    var rm = h("button", "btn sm danger", t("deliveryProfileRemoveBtn"));
    rm.type = "button";
    rm.addEventListener("click", function(){
      var cur = (S.deliveryDraft && S.deliveryDraft.profiles) ? S.deliveryDraft.profiles.slice() : [];
      cur = cur.filter(function(x){ return x.id !== p.id; });
      var bindings = Object.assign({}, (S.deliveryDraft && S.deliveryDraft.projectBindings) || {});
      Object.keys(bindings).forEach(function(k){ if(bindings[k] === p.id) delete bindings[k]; });
      var newDraft = {
        defaultProfileId: (S.deliveryDraft && S.deliveryDraft.defaultProfileId === p.id) ? null : (S.deliveryDraft && S.deliveryDraft.defaultProfileId),
        profiles: cur,
        projectBindings: bindings
      };
      S.deliveryDraft = deliveryNormalizeSettings(newDraft);
      S.deliveryDirty = isDeliveryDraftDirty(S.deliveryDraft, saved);
      render();
    });
    actions.appendChild(rm);
    cardEl.appendChild(actions);
    list.appendChild(cardEl);
  });
  return list;
}
function deliveryRenderDefaultCard(saved){
  var draft = S.deliveryDraft || saved;
  var card = h("div", "delivery-default-card");
  card.appendChild(h("div", "card-title mb-4", t("deliveryDefaultProfileLabel")));
  var sel = h("select", "");
  sel.id = "fl-delivery-default";
  var none = document.createElement("option");
  none.value = ""; none.textContent = t("deliveryDefaultNone");
  sel.appendChild(none);
  draft.profiles.forEach(function(p){
    var opt = document.createElement("option");
    opt.value = p.id; opt.textContent = p.id + " - " + p.label;
    sel.appendChild(opt);
  });
  sel.value = draft.defaultProfileId || "";
  sel.addEventListener("change", function(){
    var next = sel.value || null;
    S.deliveryDraft = Object.assign({}, draft, { defaultProfileId: next });
    S.deliveryDirty = isDeliveryDraftDirty(S.deliveryDraft, saved);
    render();
  });
  card.appendChild(sel);
  return card;
}
function deliveryRenderBindingsCard(saved){
  var draft = S.deliveryDraft || saved;
  var card = h("div", "delivery-bindings-card");
  card.appendChild(h("div", "card-title mb-4", t("deliveryBindingsTitle")));
  var bindings = draft.projectBindings || {};
  var list = h("div", "delivery-list");
  var paths = Object.keys(bindings).sort();
  if(!paths.length){
    list.appendChild(h("div", "summary-line dim", t("deliveryBindingsEmpty")));
  }
  paths.forEach(function(path){
    var row = h("div", "delivery-binding-row");
    var pathIn = h("input", "");
    pathIn.type = "text";
    pathIn.value = path;
    pathIn.placeholder = t("deliveryBindingPathPh");
    row.appendChild(pathIn);
    var pid = document.createElement("select");
    draft.profiles.forEach(function(p){
      var opt = document.createElement("option");
      opt.value = p.id; opt.textContent = p.id + " - " + p.label;
      pid.appendChild(opt);
    });
    pid.value = bindings[path];
    row.appendChild(pid);
    var rm = h("button", "btn sm danger", t("deliveryBindingRemoveBtn"));
    rm.type = "button";
    function commit(){
      var nextPath = pathIn.value.trim();
      var nextPid = pid.value;
      var cur = Object.assign({}, (S.deliveryDraft && S.deliveryDraft.projectBindings) || {});
      delete cur[path];
      if(nextPath && nextPid){
        cur[nextPath] = nextPid;
      }
      S.deliveryDraft = Object.assign({}, S.deliveryDraft || draft, { projectBindings: cur });
      S.deliveryDirty = isDeliveryDraftDirty(S.deliveryDraft, saved);
      render();
    }
    pathIn.addEventListener("change", commit);
    pid.addEventListener("change", commit);
    rm.addEventListener("click", function(){
      var cur = Object.assign({}, (S.deliveryDraft && S.deliveryDraft.projectBindings) || {});
      delete cur[path];
      S.deliveryDraft = Object.assign({}, S.deliveryDraft || draft, { projectBindings: cur });
      S.deliveryDirty = isDeliveryDraftDirty(S.deliveryDraft, saved);
      render();
    });
    row.appendChild(rm);
    list.appendChild(row);
  });
  card.appendChild(list);
  var addRow = h("div", "delivery-binding-row mt-8");
  var newPath = h("input", "");
  newPath.type = "text";
  newPath.placeholder = t("deliveryBindingPathPh");
  addRow.appendChild(newPath);
  var newPid = document.createElement("select");
  newPid.appendChild(h("option", "", "", ""));
  draft.profiles.forEach(function(p){
    var opt = document.createElement("option");
    opt.value = p.id; opt.textContent = p.id + " - " + p.label;
    newPid.appendChild(opt);
  });
  addRow.appendChild(newPid);
  var addBtn = h("button", "btn sm primary", t("deliveryBindingAddBtn"));
  addBtn.type = "button";
  addBtn.addEventListener("click", function(){
    var path = newPath.value.trim();
    var pid = newPid.value;
    if(!path || !pid) return;
    var cur = Object.assign({}, (S.deliveryDraft && S.deliveryDraft.projectBindings) || {});
    cur[path] = pid;
    S.deliveryDraft = Object.assign({}, S.deliveryDraft || draft, { projectBindings: cur });
    S.deliveryDirty = isDeliveryDraftDirty(S.deliveryDraft, saved);
    render();
  });
  addRow.appendChild(addBtn);
  card.appendChild(addRow);
  return card;
}
function deliveryRenderEditor(draft, saved){
  var card = h("div", "card form-card delivery-edit-card");
  var editing = S.deliveryEditId ? draft.profiles.find(function(p){ return p.id === S.deliveryEditId; }) : null;
  card.appendChild(h("div", "card-title mb-4", editing ? t("deliveryProfileEditBtn") + " - " + editing.id : t("deliveryProfileCreateBtn")));
  var fId = h("input", ""); fId.type = "text"; fId.placeholder = "cheap-build";
  var fLabel = h("input", ""); fLabel.type = "text";
  var fBuild = h("textarea", "");
  var fActivate = h("textarea", "");
  var fCheck = h("textarea", "");
  if(editing){
    fId.value = editing.id; fId.readOnly = true;
    fLabel.value = editing.label;
    fBuild.value = deliveryCmdText(editing.buildCommands);
    fActivate.value = deliveryCmdText(editing.activationCommands);
    fCheck.value = deliveryCmdText(editing.activationCheckCommands);
  }
  function field(labelKey, hintKey, inputEl){
    var lab = h("div", "de-field");
    lab.appendChild(h("label", "", t(labelKey)));
    lab.appendChild(inputEl);
    if(hintKey) lab.appendChild(h("div", "de-field-explain", t(hintKey)));
    return lab;
  }
  card.appendChild(field("deliveryProfileId", "deliveryProfileIdHint", fId));
  card.appendChild(field("deliveryProfileLabel", null, fLabel));
  function cmdField(labelKey, explainKey, inputEl){
    var lab = h("div", "de-field");
    lab.appendChild(h("label", "", t(labelKey)));
    lab.appendChild(inputEl);
    lab.appendChild(h("div", "de-field-explain", t(explainKey)));
    return lab;
  }
  card.appendChild(cmdField("deliveryCmdBuild", "deliveryCmdExplainBuild", fBuild));
  card.appendChild(cmdField("deliveryCmdActivation", "deliveryCmdExplainActivation", fActivate));
  card.appendChild(cmdField("deliveryCmdActivationCheck", "deliveryCmdExplainActivationCheck", fCheck));
  card.appendChild(h("div", "summary-line dim fs11 mt-4", t("deliveryCmdSaveNote")));
  var actions = h("div", "delivery-actions-row");
  var saveBtn = h("button", "btn primary", editing ? t("deliveryProfileEditBtn") : t("deliveryProfileCreateBtn"));
  saveBtn.type = "button";
  saveBtn.addEventListener("click", function(){
    var label = fLabel.value.trim();
    var profile = {
      id: (editing ? editing.id : fId.value.trim()),
      label: label,
      buildCommands: deliveryParseCommands(fBuild.value),
      activationCommands: deliveryParseCommands(fActivate.value),
      activationCheckCommands: deliveryParseCommands(fCheck.value)
    };
    if(!DELIVERY_ID_RE.test(profile.id)){ flashError(t("deliveryInvalidInvalidId")); return; }
    if(!label || label.length > 80){ flashError(t("deliveryInvalidLabel")); return; }
    if([profile.buildCommands, profile.activationCommands, profile.activationCheckCommands].some(function(commands){
      return commands.length > DELIVERY_MAX_CMDS;
    })){
      flashError(t("deliveryInvalidTooManyCommands"));
      return;
    }
    var list = (S.deliveryDraft && S.deliveryDraft.profiles ? S.deliveryDraft.profiles : saved.profiles).slice();
    if(editing){
      list = list.map(function(p){ return p.id === profile.id ? profile : p; });
    } else {
      if(list.length >= DELIVERY_MAX_PROFILES){
        flashError(t("deliveryInvalidTooManyProfiles"));
        return;
      }
      if(list.some(function(p){ return p.id === profile.id; })){
        flashError(t("deliveryInvalidDuplicateId"));
        return;
      }
      list.push(profile);
    }
    S.deliveryDraft = Object.assign({}, S.deliveryDraft || saved, { profiles: list });
    S.deliveryDirty = isDeliveryDraftDirty(S.deliveryDraft, saved);
    S.deliveryEditId = null;
    render();
  });
  actions.appendChild(saveBtn);
  if(editing){
    var cancelBtn = h("button", "btn sm", t("close"));
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", function(){ S.deliveryEditId = null; render(); });
    actions.appendChild(cancelBtn);
  }
  card.appendChild(actions);
  return card;
}
function deliveryRenderSaveBar(saved){
  var draft = S.deliveryDraft || saved;
  var bar = h("div", "card form-card");
  var title = h("div", "card-title mb-4");
  title.appendChild(document.createTextNode(t("deliverySave")));
  if(S.deliveryDirty){
    title.appendChild(h("span", "delivery-dirty-pill ml-8", t("deliveryDirtyBadge")));
  }
  bar.appendChild(title);
  var errs = deliveryValidateDraft(draft);
  if(Object.keys(errs).length){
    var errLine = h("div", "delivery-error-line", t("deliveryInvalidDraft"));
    bar.appendChild(errLine);
    Object.keys(errs).forEach(function(k){
      bar.appendChild(h("div", "delivery-error-line fs11", t(errs[k])));
    });
  }
  var actions = h("div", "delivery-actions-row");
  var saveBtn = h("button", "btn primary", t("deliverySave"));
  saveBtn.type = "button";
  saveBtn.disabled = S.deliverySaving || Object.keys(errs).length > 0;
  saveBtn.addEventListener("click", function(){
    saveBtn.disabled = true;
    S.deliverySaving = true;
    var patch = {
      deliveryProfiles: deliveryNormalizeSettings(draft)
    };
    postJSON("/api/settings", patch)
      .then(function(){
        toast(t("deliverySaved"));
        S.deliveryDraft = null;
        S.deliveryDirty = false;
        S.deliverySaving = false;
        return refresh();
      })
      .catch(function(e){
        flashError(t("operationFailed"), e && e.message);
        S.deliverySaving = false;
        saveBtn.disabled = false;
      });
  });
  actions.appendChild(saveBtn);
  if(S.deliveryDirty){
    var restoreBtn = h("button", "btn sm", t("deliveryRestoreBtn"));
    restoreBtn.type = "button";
    restoreBtn.addEventListener("click", function(){
      S.deliveryDraft = null;
      S.deliveryDirty = false;
      render();
    });
    actions.appendChild(restoreBtn);
  }
  bar.appendChild(actions);
  bar.appendChild(h("div", "summary-line dim fs11 mt-4", t("deliveryCmdSaveNote")));
  return bar;
}
function rDelivery(){
  viewEl.textContent = "";
  flashError("");
  viewEl.appendChild(renderPageStory("delivery"));
  var saved = deliveryReadSettings();
  if(!S.deliveryDraft || S.deliveryDraft === saved && !S.deliveryDirty){
    S.deliveryDraft = saved;
  }
  var draft = S.deliveryDraft || saved;
  S.deliveryDirty = isDeliveryDraftDirty(draft, saved);
  var intro = h("div", "summary-line dim mb-8", t("deliveryGuideBody"));
  viewEl.appendChild(intro);
  if(!saved.profiles.length){
    viewEl.appendChild(stateMsg("empty", t("deliverySavedNothing")));
    viewEl.appendChild(h("div", "summary-line dim mt-4", t("deliverySavedNothingHint")));
  }
  var profilesCard = h("div", "card form-card delivery-profiles-card");
  profilesCard.appendChild(h("div", "card-title mb-4", t("deliveryProfilesTitle")));
  profilesCard.appendChild(deliveryRenderProfileList(saved));
  profilesCard.appendChild(deliveryRenderEditor(draft, saved));
  viewEl.appendChild(profilesCard);
  viewEl.appendChild(deliveryRenderDefaultCard(saved));
  viewEl.appendChild(deliveryRenderBindingsCard(saved));
  viewEl.appendChild(deliveryRenderSaveBar(saved));
}


/* --- Adaptation panel (Task-scoped, terminal-only, bounded) --- */
/*  Excludes maxAdaptationRounds, maxMainCorrections, maxMainReverifications,
 *  and maxWorkerValidationRepairs: these are immutable root caps chosen in
 *  Worker Advanced settings before Task creation, and are never editable on an
 *  existing Task. */
/* Derive the Task adaptation inventory from the same field inventory used by
 * Worker Advanced settings. A newly added flexible Worker field therefore
 * cannot silently disappear from this panel. Immutable loop / correction /
 * validation-repair caps are the only deliberate exclusions. */
var ADAPT_FIELDS = Object.keys(ADV_FIELD_LABELS)
  .filter(function(field){ return field !== "maxAdaptationRounds" && field !== "maxMainCorrections" && field !== "maxMainReverifications" && field !== "maxWorkerValidationRepairs"; })
  .map(function(field){
    var mode = ADV_MODE_FIELDS.indexOf(field) >= 0
      ? "mode"
      : (ADV_BLANK_NULL_FIELDS.indexOf(field) >= 0 ? "nullable-int" : "int");
    var min = field === "noProgressTimeoutMs" ? 1000
      : (field === "workerStopGraceMs" ? 100
        : (field === "baseMaxAttempts" || field === "maxConcurrency" ? 1 : 0));
    return { field: field, mode: mode, min: min };
  });
var ADAPT_REASONS = [
  "duration-budget",
  "size-policy",
  "attempt-budget",
  "completion-policy",
  "concurrency-cap",
  "no-progress-timeout",
  "other-flexible-policy"
];
var ADAPT_REASON_LABELS = {
  "duration-budget": "taskAdaptReasonDuration",
  "size-policy": "taskAdaptReasonSize",
  "attempt-budget": "taskAdaptReasonAttempts",
  "completion-policy": "taskAdaptReasonCompletion",
  "concurrency-cap": "taskAdaptReasonConcurrency",
  "no-progress-timeout": "taskAdaptReasonNoProgress",
  "other-flexible-policy": "taskAdaptReasonOther"
};
var ADAPT_STOP_REASON_LABELS = {
  "adaptation-disabled": "taskAdaptStoppedDisabled",
  "round-limit-reached": "taskAdaptStoppedRoundLimit",
  "successor-already-created": "taskAdaptStoppedDuplicate",
  "parent-not-terminal": "taskAdaptStoppedNotTerminal",
  "no-effective-change": "taskAdaptStoppedNoChange",
  "forbidden-field": "taskAdaptStoppedForbidden",
  "invalid-patch": "taskAdaptStoppedInvalid",
  "missing-effective-policy": "taskAdaptStoppedMissing",
  "parent-not-found": "taskAdaptStoppedNotTerminal"
};
var ADAPT_SOURCE_LABELS = {
  "task": "taskAdaptSourceTask",
  "worker": "taskAdaptSourceWorker",
  "global": "taskAdaptSourceGlobal"
};
var ADAPT_PHASE_LABELS = {
  "preemptive": "workersPreviewEnforcePreemptive",
  "terminal": "workersPreviewEnforceTerminal",
  "post-observation": "workersPreviewEnforcePostObs",
  "unsupported": "workersPreviewEnforceUnsupported"
};
function adaptFieldLabel(field){
  return t(ADV_FIELD_LABELS[field] || ("workersAdv" + field));
}
function adaptSnapshotValue(snapshot, field){
  var values = (snapshot && snapshot.values) || {};
  return values[field];
}
/* Fingerprint the opt-in patch + reason so we can invalidate any earlier
 * preview whenever the user touches the form. The preview is only valid
 * for the exact patch + reason that produced it. */
function adaptPatchFingerprint(state){
  var parts = [state.reason || ""];
  ADAPT_FIELDS.forEach(function(def){
    if(!state.enabled[def.field]) return;
    var raw = state.values[def.field];
    parts.push(def.field + ":" + (raw === undefined || raw === null ? "" : String(raw)));
  });
  return parts.join("|");
}
function adaptBuildPatch(state){
  var patch = {};
  var invalidField = null;
  ADAPT_FIELDS.forEach(function(def){
    if(invalidField) return;
    if(!state.enabled[def.field]) return;
    var raw = state.values[def.field];
    if(def.mode === "nullable-int"){
      var s = typeof raw === "string" ? raw.trim() : "";
      if(s === ""){ patch[def.field] = null; return; }
      var n = Number(s);
      if(!Number.isFinite(n) || !Number.isInteger(n) || n < def.min){ invalidField = def.field; return; }
      patch[def.field] = n;
    } else if(def.mode === "int"){
      var s2 = typeof raw === "string" ? raw.trim() : "";
      if(s2 === ""){ invalidField = def.field; return; }
      var n2 = Number(s2);
      if(!Number.isFinite(n2) || !Number.isInteger(n2) || n2 < def.min){ invalidField = def.field; return; }
      patch[def.field] = n2;
    } else {
      if(typeof raw === "string" && ADV_MODE_FIELDS.indexOf(def.field) >= 0
        && ["hard","warn","score","off"].indexOf(raw) >= 0){
        patch[def.field] = raw;
      } else {
        invalidField = def.field;
      }
    }
  });
  return { patch: patch, invalidField: invalidField };
}
function adaptRenderRows(panel, fields){
  panel.textContent = "";
  if(!fields.length){
    panel.appendChild(h("div", "summary-line dim", t("taskAdaptPreviewEmpty")));
    return;
  }
  var tbl = h("table", "preview-table adapt-preview");
  var thd = h("thead", "");
  var tr = h("tr", "");
  tr.appendChild(h("th", "", t("taskAdaptFieldsChanged")));
  tr.appendChild(h("th", "", t("taskAdaptValue")));
  tr.appendChild(h("th", "", t("taskAdaptSource")));
  tr.appendChild(h("th", "", t("workersPreviewEnforce")));
  thd.appendChild(tr);
  tbl.appendChild(thd);
  var tbody = document.createElement("tbody");
  fields.forEach(function(row){
    var rtr = h("tr", "");
    var lbl = adaptFieldLabel(row.field);
    rtr.appendChild(h("td", "preview-field", lbl));
    var before = row.before;
    var after = row.after;
    var isMode = ADV_MODE_FIELDS.indexOf(row.field) >= 0;
    var display;
    if(after === null){ display = t("workersPreviewUnlimited"); rtr.classList.add("preview-unlimited"); }
    else if(after === undefined){ display = "-"; }
    else if(isMode){ display = policyModeLabel(after); }
    else { display = String(after); }
    var cell = h("td", "preview-val", display);
    if(before !== undefined && !sameAdaptValue(before, after)){
      var beforeTxt = before === null ? t("workersPreviewUnlimited")
        : (isMode ? policyModeLabel(before) : String(before));
      cell.appendChild(h("div", "dim fs11", t("workersPreviewSetting") + " " + beforeTxt));
    }
    rtr.appendChild(cell);
    var srcKey = ADAPT_SOURCE_LABELS[row.source] || "taskAdaptSourceGlobal";
    var srcBadge = h("span", "badge " + (row.source === "task" ? "badge-info" : row.source === "worker" ? "badge-ok" : "badge-dim"),
      t(srcKey));
    var srcTd = h("td", "preview-src");
    srcTd.appendChild(srcBadge);
    rtr.appendChild(srcTd);
    var phaseKey = ADAPT_PHASE_LABELS[row.enforcementPhase] || "workersPreviewEnforceUnsupported";
    var phaseBadge = h("span", "badge " + (row.enforcementPhase === "preemptive" ? "badge-ok" : row.enforcementPhase === "unsupported" ? "badge-dim" : "badge-warn"),
      t(phaseKey));
    var phaseTd = h("td", "preview-phase");
    phaseTd.appendChild(phaseBadge);
    rtr.appendChild(phaseTd);
    tbody.appendChild(rtr);
  });
  tbl.appendChild(tbody);
  panel.appendChild(tbl);
}
function sameAdaptValue(a, b){
  if(a === b) return true;
  if(a === null && b === undefined) return true;
  if(a === undefined && b === null) return true;
  return false;
}
function renderAdaptationPanel(task){
  var card = h("div", "card form-card adaptation-panel");
  card.appendChild(h("div", "card-title mb-4", t("taskAdapt")));
  card.appendChild(h("div", "summary-line dim mb-8", t("taskAdaptHint")));
  var snapshot = task.effectivePolicy;
  if(!snapshot || typeof snapshot !== "object" || !snapshot.values){
    card.appendChild(h("div", "summary-line", t("taskAdaptNoSnapshot")));
    return card;
  }
  if(["succeeded", "failed", "interrupted"].indexOf(task.status) < 0){
    card.appendChild(h("div", "summary-line", t("taskAdaptTerminalOnly")));
    return card;
  }
  var state = {
    enabled: {},
    values: {},
    reason: ADAPT_REASONS[0],
    preview: null,
    fingerprint: "",
    applyBtn: null,
    applyHint: null
  };
  var fieldsBox = h("div", "adapt-fields");
  ADAPT_FIELDS.forEach(function(def){
    // Vertical card per field. Avoid side-by-side grids: .form-card input{width:100%}
    // was stretching checkboxes and crushing label text into one glyph per line.
    var row = h("div", "adapt-row");
    row.setAttribute("data-adapt-field", def.field);
    row.appendChild(h("div", "adapt-field-name", adaptFieldLabel(def.field)));

    var controls = h("div", "adapt-field-controls");
    var enable = document.createElement("input");
    enable.type = "checkbox";
    enable.className = "adapt-checkbox";
    enable.setAttribute("data-adapt-enable", def.field);
    enable.setAttribute("aria-label", t("taskAdaptEnable") + " " + adaptFieldLabel(def.field));
    var enableLab = h("label", "adapt-enable", "");
    enableLab.appendChild(enable);
    enableLab.appendChild(h("span", "adapt-enable-text", t("taskAdaptEnable")));
    controls.appendChild(enableLab);

    var valWrap = h("div", "adapt-value");
    valWrap.appendChild(h("div", "adapt-value-label", t("taskAdaptValue")));
    var inputEl;
    if(def.mode === "mode"){
      inputEl = buildPolicyModeSelect(null);
    } else {
      inputEl = document.createElement("input");
      inputEl.type = "number";
      inputEl.step = "1";
      inputEl.min = String(def.min || 0);
      inputEl.placeholder = def.mode === "nullable-int" ? t("workersBlankUnlimited") : t("workersBlankInherit");
    }
    inputEl.className = (inputEl.className ? inputEl.className + " " : "") + "adapt-input";
    inputEl.setAttribute("data-adapt-value", def.field);
    inputEl.disabled = true;
    var current = adaptSnapshotValue(snapshot, def.field);
    if(current !== undefined && current !== null){
      inputEl.value = String(current);
    } else {
      inputEl.value = "";
    }
    valWrap.appendChild(inputEl);
    controls.appendChild(valWrap);
    row.appendChild(controls);
    fieldsBox.appendChild(row);
    state.values[def.field] = inputEl.value;
    enable.addEventListener("change", function(){
      state.enabled[def.field] = enable.checked;
      inputEl.disabled = !enable.checked;
      onAdaptFormChange();
    });
    inputEl.addEventListener("input", function(){
      state.values[def.field] = inputEl.value;
      onAdaptFormChange();
    });
    inputEl.addEventListener("change", function(){
      state.values[def.field] = inputEl.value;
      onAdaptFormChange();
    });
  });
  card.appendChild(policyModeNote());
  card.appendChild(fieldsBox);

  var reasonWrap = h("div", "adapt-reason");
  reasonWrap.appendChild(h("div", "adapt-value-label", t("taskAdaptReason")));
  var reasonSel = document.createElement("select");
  reasonSel.className = "adapt-input";
  ADAPT_REASONS.forEach(function(r){
    var o = document.createElement("option");
    o.value = r;
    o.textContent = t(ADAPT_REASON_LABELS[r] || r);
    reasonSel.appendChild(o);
  });
  reasonSel.value = state.reason;
  reasonWrap.appendChild(reasonSel);
  card.appendChild(reasonWrap);
  reasonSel.addEventListener("change", function(){
    state.reason = reasonSel.value;
    onAdaptFormChange();
  });

  var cap = snapshot.values && typeof snapshot.values.maxAdaptationRounds === "number"
    ? snapshot.values.maxAdaptationRounds : 0;
  var capLine = h("div", "summary-line dim fs11 adapt-cap");
  capLine.appendChild(document.createTextNode(
    t("taskAdaptCapLabel") + ": " + String(cap) + " ("
      + (snapshot.profileId || "global") + ")"
  ));
  card.appendChild(capLine);

  var previewBtn = h("button", "btn sm primary", t("taskAdaptPreview"));
  previewBtn.type = "button";
  previewBtn.disabled = true;
  var previewPanel = h("div", "preview-panel adapt-preview-panel");
  previewPanel.appendChild(h("div", "summary-line dim", t("taskAdaptPreviewEmpty")));
  var statusLine = h("div", "summary-line dim fs11 mt-4 adapt-status");
  var actions = h("div", "actions mt-8");
  var applyBtn = h("button", "btn sm", t("taskAdaptApply"));
  applyBtn.type = "button";
  applyBtn.disabled = true;
  state.applyBtn = applyBtn;
  actions.appendChild(previewBtn);
  actions.appendChild(applyBtn);
  card.appendChild(actions);

  card.appendChild(previewPanel);
  card.appendChild(statusLine);
  card.appendChild(h("div", "summary-line dim fs11 mt-4", t("taskAdaptCaveat")));

  function setApplyHint(kind, msg){
    statusLine.textContent = "";
    if(msg){ statusLine.appendChild(document.createTextNode(msg)); }
    statusLine.className = "summary-line fs11 mt-4 adapt-status adapt-status-" + (kind || "dim");
  }

  function clearPreview(){
    state.preview = null;
    state.fingerprint = "";
    applyBtn.disabled = true;
    previewPanel.textContent = "";
    previewPanel.appendChild(h("div", "summary-line dim", t("taskAdaptPreviewEmpty")));
    setApplyHint("dim", "");
  }

  function onAdaptFormChange(){
    previewBtn.disabled = !ADAPT_FIELDS.some(function(def){ return !!state.enabled[def.field]; });
    if(state.preview){
      var currentFp = adaptPatchFingerprint(state);
      if(currentFp !== state.fingerprint){
        clearPreview();
        setApplyHint("warn", t("taskAdaptPreviewStale"));
      } else {
        setApplyHint("ok", t("taskAdaptPreviewOk"));
      }
    } else {
      setApplyHint("dim", "");
    }
  }

  function runPreview(){
    var built = adaptBuildPatch(state);
    if(built.invalidField){
      setApplyHint("err", t("taskAdaptValueInvalid", { field: adaptFieldLabel(built.invalidField) }));
      return;
    }
    if(!Object.keys(built.patch).length){
      setApplyHint("warn", t("taskAdaptNone"));
      return;
    }
    var patch = built.patch;
    previewBtn.disabled = true;
    applyBtn.disabled = true;
    setApplyHint("dim", "");
    postJSON("/api/ops/tasks/" + encodeURIComponent(task.id) + "/adaptation/preview",
      { patch: patch, reason: state.reason })
      .then(function(res){
        var preview = (res && res.preview) || null;
        state.preview = preview;
        state.fingerprint = adaptPatchFingerprint(state);
        var fields = (preview && Array.isArray(preview.fields))
          ? preview.fields.filter(function(f){ return f && f.changed; }) : [];
        adaptRenderRows(previewPanel, fields);
        if(preview && preview.status === "eligible"){
          var round = preview.nextRound || 0;
          var capN = preview.maxAdaptationRounds || 0;
          setApplyHint("ok", t("taskAdaptNextRound") + " " + round + "/" + capN);
          applyBtn.disabled = false;
        } else {
          applyBtn.disabled = true;
          var reasonKey = ADAPT_STOP_REASON_LABELS[preview && preview.stoppedReason] || "taskAdaptStopReason";
          setApplyHint("warn", t("taskAdaptStopReason") + ": " + t(reasonKey));
          if(preview && preview.summary){
            previewPanel.appendChild(h("div", "summary-line dim fs11 mt-4", String(preview.summary)));
          }
        }
      })
      .catch(function(e){
        clearPreview();
        setApplyHint("err", t("taskAdaptPreviewFailed"));
        appendBoundedDetail(previewPanel, e && e.message ? e.message : "");
      })
      .finally(function(){
        previewBtn.disabled = false;
      });
  }

  previewBtn.addEventListener("click", runPreview);
  applyBtn.addEventListener("click", function(){
    if(!state.preview || state.preview.status !== "eligible") return;
    var currentFp = adaptPatchFingerprint(state);
    if(currentFp !== state.fingerprint) return;
    if(!window.confirm(t("taskAdaptApplyConfirm"))) return;
    var built = adaptBuildPatch(state);
    if(built.invalidField || !Object.keys(built.patch).length){
      clearPreview();
      setApplyHint("err", t("taskAdaptValueInvalid", {
        field: built.invalidField ? adaptFieldLabel(built.invalidField) : ""
      }));
      return;
    }
    var patch = built.patch;
    applyBtn.disabled = true;
    setApplyHint("dim", "");
    postJSON("/api/ops/tasks/" + encodeURIComponent(task.id) + "/adaptation/apply",
      { patch: patch, reason: state.reason, confirm: true })
      .then(function(res){
        var preview = (res && res.preview) || null;
        var fields = (preview && Array.isArray(preview.fields))
          ? preview.fields.filter(function(f){ return f && f.changed; }) : [];
        adaptRenderRows(previewPanel, fields);
        if(res && res.childTaskId){
          state.preview = preview;
          state.fingerprint = adaptPatchFingerprint(state);
          setApplyHint("ok", t("taskAdaptApplyOk", { childId: res.childTaskId }));
          var childLine = h("div", "summary-line dim fs11 mt-4");
          childLine.appendChild(document.createTextNode(t("taskAdaptChildLabel") + ": "));
          var childBtn = h("button", "btn sm mono", res.childTaskId);
          childBtn.type = "button";
          childBtn.addEventListener("click", function(){ showTask(res.childTaskId); });
          childLine.appendChild(childBtn);
          previewPanel.appendChild(childLine);
          applyBtn.disabled = true;
          previewBtn.disabled = true;
          toast(t("taskAdaptApplyOk", { childId: res.childTaskId }));
          refresh();
        } else {
          // Apply returned stopped - do not re-enable. The user must re-preview.
          state.preview = preview;
          state.fingerprint = adaptPatchFingerprint(state);
          applyBtn.disabled = true;
          var reasonKey2 = ADAPT_STOP_REASON_LABELS[preview && preview.stoppedReason] || "taskAdaptStopReason";
          setApplyHint("warn", t("taskAdaptStopReason") + ": " + t(reasonKey2));
        }
      })
      .catch(function(e){
        clearPreview();
        setApplyHint("err", t("taskAdaptApplyFailed"));
        appendBoundedDetail(previewPanel, e && e.message ? e.message : "");
      });
  });
  return card;
}

/* --- Detail --- */
function hideDetail(){
  detailEl.hidden = true;
  detailEl.textContent = "";
  if(scrimEl){ scrimEl.hidden = true; }
  workReloadDetailScrollTop = null;
  S.detail = null;
  S.detailTaskId = null;
  workMarkSelectedCard(null);
  /* Closing the drawer is an explicit close for any pending-action handoff. */
  workPendingHandoffReset();
  if(workIsNarrowViewport()){
    workApplyMobilePane(workNextMobilePane("detail", "back"));
  } else {
    workUpdateMobileBack();
  }
  var target = S.detailReturnFocus;
  S.detailReturnFocus = null;
  if(target && document.contains(target) && typeof target.focus === "function") target.focus();
  else {
    var activeTab = $("#fl-tabs button.active");
    if(activeTab) activeTab.focus();
  }
  workScheduleReadingContextSave();
}
function loadingDetail(msg){
  if(!S.detail) S.detailReturnFocus = document.activeElement;
  S.detail = true;
  detailEl.hidden = false;
  if(scrimEl) scrimEl.hidden = false;
  detailEl.textContent = "";
  detailEl.appendChild(stateMsg("loading", msg));
}
function showDetail(frag){
  detailEl.hidden = false;
  if(scrimEl) scrimEl.hidden = false;
  detailEl.textContent = "";
  detailEl.appendChild(frag);
  S.detail = true;
  var restoredScrollTop = workReloadDetailScrollTop;
  workReloadDetailScrollTop = null;
  if(restoredScrollTop !== null) detailEl.scrollTop = restoredScrollTop;
  var close = detailEl.querySelector(".detail-close");
  if(close) close.focus();
  if(restoredScrollTop !== null) workPersistReadingContext();
}
function closeBtn(){
  var b = h("button", "detail-close", t("close"));
  b.addEventListener("click", hideDetail);
  return b;
}

function decisionRow(label, value, kind){
  var rowEl = h("div", "decision-row" + (kind ? " decision-" + kind : ""));
  rowEl.appendChild(h("div", "decision-label", label));
  rowEl.appendChild(h("div", "decision-value",
    value === undefined || value === null ? t("decUnavailable") : String(value)
  ));
  return rowEl;
}
/* Dual outcome row: machine execution and verified final delivery are
 * rendered as two explicitly named facts. The machine status and failure
 * category are kept as the primary outcome; a verified-repaired-delivered
 * disposition is shown as a separate, named fact that never rewrites the
 * machine status. Amended-acceptance basis uses distinct plain-language copy. */
function dualOutcomeRow(task, decision){
  var disposition = decision && decision.remediationDisposition;
  var machineOutcome = task && task.status ? statusLabel(task.status) : t("decUnavailable");
  var deliveryOutcome;
  var amended = disposition && disposition.acceptanceBasis === "amended-acceptance";
  if(disposition && disposition.status === "verified-repaired-delivered"){
    deliveryOutcome = amended
      ? t("taskFinalDeliveryAmended")
      : t("taskFinalDeliveryVerified");
  } else if(disposition && disposition.status){
    deliveryOutcome = t("taskFinalDeliveryRecorded");
  } else {
    deliveryOutcome = t("taskFinalDeliveryNone");
  }
  var rowEl = h("div", "decision-row dual-outcome");
  rowEl.setAttribute("data-fl-role", "dual-outcome");
  if(amended) rowEl.setAttribute("data-fl-acceptance-basis", "amended-acceptance");
  var labelEl = h("div", "decision-label", t("taskDualOutcome"));
  rowEl.appendChild(labelEl);
  var valueEl = h("div", "decision-value dual-outcome-value");
  var machineSpan = h("span", "decision-outcome-machine",
    t("taskDualOutcomeMachine") + ": " + String(machineOutcome));
  machineSpan.setAttribute("data-fl-role", "machine-outcome");
  var deliverySpan = h("span", "decision-outcome-delivery",
    t("taskDualOutcomeDelivery") + ": " + String(deliveryOutcome));
  deliverySpan.setAttribute("data-fl-role", "delivery-outcome");
  valueEl.appendChild(machineSpan);
  valueEl.appendChild(document.createTextNode(" · "));
  valueEl.appendChild(deliverySpan);
  rowEl.appendChild(valueEl);
  // Concise caveat: a Main-repaired delivery does not rewrite Worker success.
  var caveat = h("div", "decision-hint dual-outcome-hint",
    amended ? t("taskDualOutcomeAmendedHint") : t("taskDualOutcomeHint"));
  caveat.setAttribute("data-fl-role", "dual-outcome-hint");
  rowEl.appendChild(caveat);
  return rowEl;
}
function renderDecision(task, d){
  var box = h("section", "decision-panel");
  box.appendChild(h("div", "section-title", decLabel("decNextActionSection", "Next action")));
  box.appendChild(decisionRow(decLabel("decCurrentStage", "Current stage"), d && d.stage, "stage"));
  box.appendChild(decisionRow(decLabel("decNextActionLabel", "Next action"), d && d.nextAction, "next"));

  // Dual outcome: machine execution + verified final delivery, rendered as
  // two separately named facts. The machine status remains authoritative;
  // a verified final delivery never rewrites it.
  var dualHost = h("div", "");
  dualHost.appendChild(dualOutcomeRow(task, d));
  box.appendChild(dualHost);

  box.appendChild(h("div", "section-title", decLabel("decWhoWrote", "Who wrote it")));
  if(d && d.workerClaim){
    box.appendChild(decisionRow(decLabel("decWorker", "Worker"), d.workerClaim.provider + "/" + d.workerClaim.model));
    box.appendChild(decisionRow(decLabel("decWorkerClaim", "Worker claim (unverified)"), d.workerClaim.text, "claim"));
  } else {
    box.appendChild(decisionRow(decLabel("decWorkerClaim", "Worker claim (unverified)"), t("decUnavailable")));
  }

  box.appendChild(h("div", "section-title", decLabel("decIndepVerif", "Independent verification")));
  var v = d && d.verification;
  if(v){
    box.appendChild(decisionRow(decLabel("decOverall", "Overall"), v.passed ? t("decPassed") : t("decFailed"), v.passed ? "passed" : "failed"));
    box.appendChild(decisionRow(decLabel("decBehavior", "Behavior"), v.behaviorPassed ? t("decPassed") : t("decFailed")));
    box.appendChild(decisionRow(decLabel("decPolicy", "Policy"), v.policyPassed ? t("decPassed") : t("decFailed")));
    box.appendChild(decisionRow(decLabel("decSourceCompat", "Source compatibility"), v.sourceCompatible ? t("decPassed") : t("decFailed")));
  } else {
    box.appendChild(decisionRow(decLabel("decEvidence", "Evidence"), t("decUnavailable")));
  }

  box.appendChild(h("div", "section-title", decLabel("decMainReview", "Main agent review")));
  var review = d && d.mainReview;
  if(review){
    box.appendChild(decisionRow(decLabel("decDecision", "Decision"), reviewDecisionLabel(review.decision), review.decision === "accept" ? "passed" : "failed"));
    box.appendChild(decisionRow(decLabel("decReason", "Reason"), review.reason));
  } else {
    box.appendChild(decisionRow(decLabel("decDecision", "Decision"), t("decNotRecorded")));
  }

  box.appendChild(h("div", "section-title", decLabel("decUserAuth", "User authorization")));
  box.appendChild(decisionRow(
    decLabel("decIntegGate", "Integration gate"),
    d && d.integration ? t("decGateExercised") : t("decGateNotExercised")
  ));

  box.appendChild(h("div", "section-title", decLabel("decIntegActivation", "Integration and activation")));
  if(d && d.integration){
    box.appendChild(decisionRow(decLabel("decOperation", "Operation"), d.integration.operationId));
    box.appendChild(decisionRow(decLabel("decOperationStatus", "Operation status"), d.integration.status));
    (d.integration.stages || []).forEach(function(s){
      box.appendChild(decisionRow(
        s.stage, s.status,
        s.status === "passed" ? "passed" : (s.status === "failed" ? "failed" : "")
      ));
    });
  } else {
    box.appendChild(decisionRow(decLabel("decIntegration", "Integration"), t("decNotStarted")));
  }

  box.appendChild(h("div", "section-title", decLabel("decLineage", "Delivery lineage")));
  var l = d && d.lineage;
  if(l){
    box.appendChild(decisionRow(decLabel("decAttempts", "Attempts"), l.attemptCount));
    box.appendChild(decisionRow(decLabel("decCorrectionAttempts", "Correction attempts"), (l.correctionAttemptIds || []).length));
    box.appendChild(decisionRow(
      decLabel("decCombinedDiff", "Combined delivery diff"),
      t("decCombinedDiffValue", {
        files: String(l.combinedDeliveryDiff && l.combinedDeliveryDiff.filesChanged || 0),
        lines: String(l.combinedDeliveryDiff && l.combinedDeliveryDiff.changedLines || 0)
      })
    ));
  } else {
    box.appendChild(decisionRow(decLabel("decLineage", "Delivery lineage"), t("decUnavailable")));
  }
  return box;
}

function collapsedSection(title, node){
  var details = document.createElement("details");
  details.className = "audit-details";
  var summary = document.createElement("summary");
  summary.textContent = title;
  details.appendChild(summary);
  details.appendChild(node);
  return details;
}

/* --- Economics (textContent-only) --- */
function evRow(key, val){
  var r = h("div", "ev-row");
  r.appendChild(h("span", "ev-key", key));
  var v = h("span", "ev-value");
  if(typeof val === "string") v.textContent = val;
  else if(val) v.appendChild(val);
  r.appendChild(v);
  return r;
}
function evRowMixed(key, parts){
  var r = h("div", "ev-row");
  r.appendChild(h("span", "ev-key", key));
  var v = h("span", "ev-value");
  parts.forEach(function(p){
    if(p === null || p === undefined) return;
    if(typeof p === "string" || typeof p === "number") v.appendChild(document.createTextNode(String(p)));
    else v.appendChild(p);
  });
  r.appendChild(v);
  return r;
}
function evCard(title){
  var c = h("div", "ev-card");
  if(title) c.appendChild(h("div", "ev-card-title", title));
  return c;
}
function evCaveat(text){ return h("div", "ev-caveat", text); }
function evPill(text, level){ return h("span", "ev-pill" + (level ? " ev-pill-" + level : ""), text); }
function evUnavailableRow(key, kind, reason){
  var r = h("div", "ev-row ev-row-unavailable");
  r.appendChild(h("span", "ev-key", key));
  var v = h("span", "ev-value");
  v.appendChild(evPill(kind || "unavailable", kind === "high" ? "high" : (kind === "medium" ? "medium" : (kind === "low" ? "low" : ""))));
  if(reason){
    v.appendChild(document.createTextNode(" "));
    v.appendChild(h("span", "ev-unavailable-reason", reason));
  }
  r.appendChild(v);
  return r;
}
function evRange(min, max){ return h("span", "ev-range mono", num(min, 0) + " - " + num(max, 0)); }
function evLink(url){
  var raw = String(url || ""), parsed;
  try { parsed = new URL(raw); } catch(_e){ return h("span", "ev-source ev-source-invalid", raw); }
  if(parsed.protocol!=="http:"&&parsed.protocol!=="https:") return h("span", "ev-source ev-source-invalid", raw);
  var a = document.createElement("a");
  a.href = parsed.href;
  a.className = "ev-source";
  a.rel = "noopener noreferrer";
  a.target = "_blank";
  a.textContent = raw;
  return a;
}
function evSources(urls){
  var d = h("div", "ev-sources");
  urls.forEach(function(u, i){
    if(i > 0) d.appendChild(document.createTextNode(" "));
    d.appendChild(evLink(u));
  });
  return d;
}
function evBreakdownPills(bd){
  var d = h("div", "ev-unavailable-breakdown");
  Object.keys(bd).sort().forEach(function(k){
    d.appendChild(h("span", "ev-breakdown-pill", k + " (" + bd[k] + ")"));
  });
  return d;
}
function evAmount(amount){
  if(typeof amount !== "number" || !Number.isFinite(amount)) return "-";
  var abs = Math.abs(amount);
  if(abs === 0) return "0.00";
  if(abs < 0.000001) return amount.toExponential(3);
  var decimals = abs >= 1 ? 2 : Math.min(8, Math.max(4, Math.ceil(-Math.log10(abs)) + 2));
  return amount.toFixed(decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}
function evCost(amount, currency){
  var formatted = evAmount(amount);
  return formatted === "-" ? formatted : formatted + " " + currency;
}
function evReason(reason){
  var map = {
    "no-measurements": "no exchange measurements or receipts captured",
    "invalid-exact-evidence": "exact exchange evidence invalid",
    "invalid-measurement": "invalid exchange measurement",
    "invalid-receipt-evidence": "invalid exchange receipt",
    "incomplete-worker-usage": "Worker Token usage incomplete",
    "missing-exchange-evidence": "no exchange evidence captured",
    "direct-baseline-missing": "no compatible calibration registered for this task class",
    "incompatible-baseline": "calibration not compatible",
    "task-class-mismatch": "task class does not match calibration",
    "task-class-required": "current task class must be supplied",
    "zero-baseline": "baseline cannot be zero"
  };
  return map[reason] || reason;
}

function showPlanBoard(id){
  loadingDetail(t("planDetailLoading"));
  fetchJSON("/api/ops/board/" + encodeURIComponent(id)).then(function(board){
    var f = fr();
    f.appendChild(closeBtn());
    var pct = board.plan.progress && board.plan.progress.percent === 100 ? "completed" : "active";
    f.appendChild(cardHead(board.plan.name, "", badge(pct)));
    f.appendChild(h("div", "card-subtitle mb-8", board.plan.objective || ""));
    f.appendChild(h("div", "summary-line dim mb-8",
      t("planDetailUpdated", { time: fmtSince(board.plan.updatedAt) })));
    f.appendChild(h("div", "summary-line dim mb-8", t("planDetailExplain")));
    f.appendChild(progBar(board.plan.progress));
    var pg = board.plan.progress || {};
    f.appendChild(h("div", "fs11 dim mb-8", t("planProgressFull", {
      queued: String(pg.queued || 0), waiting: String(pg.waiting || 0),
      active: String(pg.active || 0), blocked: String(pg.blocked || 0),
      failed: String(pg.failed || 0), completed: String(pg.completed || 0),
      percent: String(pg.percent || 0)
    })));
    var cols = hd("div", "columns mt-8");
    [
      { k: "queued", l: t("planLaneQueued") },
      { k: "active", l: t("planLaneActive") },
      { k: "blocked", l: t("planLaneBlocked") },
      { k: "failed", l: t("planLaneFailed") },
      { k: "completed", l: t("planLaneCompleted") }
    ].forEach(function(col){
      var items = board.columns[col.k] || [];
      var c = h("div", "column");
      c.appendChild(h("h3", "", col.l + " (" + items.length + ")"));
      items.forEach(function(i){ c.appendChild(boardItem(i)); });
      cols.appendChild(c);
    });
    f.appendChild(cols);
    showDetail(f);
  }).catch(function(e){
    detailEl.replaceChildren(detailErrorFragment("planDetailLoadFailed", e));
  });
}

function showGoalDetail(id){
  loadingDetail(t("goalDetailLoading"));
  fetchJSON("/api/ops/goals/" + encodeURIComponent(id)).then(function(goal){
    var f = fr();
    f.setAttribute("data-fl-role", "goal-detail");
    f.appendChild(closeBtn());
    f.appendChild(cardHead(goal.name || t("navGoals"), "", badge(goal.status || "pending")));
    f.appendChild(h("div", "card-subtitle mb-8", goal.objective || ""));
    var localizedCause = goalReasonLabel(goal.reasonCode, goal.reason || "");
    f.appendChild(h("div", "summary-line mb-4", t("goalStoryHappened", {
      text: goalStoryHappenedText(goal)
    })));
    f.appendChild(h("div", "summary-line mb-4", t("goalStoryWaiting", {
      text: goalStoryWaitingText(goal)
    })));
    f.appendChild(h("div", "summary-line mb-8", t("goalStoryNext", {
      text: goalNextActionLabel(goal.nextActionCode, goal.nextAction)
    })));
    if(goal.currentMilestone){
      f.appendChild(h("div", "summary-line mb-8", t("goalCurrentMilestone", {
        item: String(goal.currentMilestone.itemId || ""),
        gate: String(goal.currentMilestone.gate || ""),
        task: String(goal.currentMilestone.taskName || goal.currentMilestone.taskId || "")
      })));
    }
    var policy = goal.policy || {};
    f.appendChild(h("div", "fs11 dim mb-8", t("goalPolicyLine", {
      duration: policy.maxDurationMs === null || policy.maxDurationMs === undefined
        ? t("goalUnlimited")
        : readableDuration(policy.maxDurationMs),
      noProgress: policy.noProgressTimeoutMs === null || policy.noProgressTimeoutMs === undefined
        ? t("goalUnlimited")
        : readableDuration(policy.noProgressTimeoutMs),
      corrections: String(policy.maxCorrectionRounds ?? 0),
      reviews: String(policy.maxReviewRounds ?? 0),
      evidence: String(policy.maxNoNewEvidenceCycles ?? 0)
    })));
    var counters = goal.counters || {};
    f.appendChild(h("div", "fs11 dim mb-8", t("goalCountersLine", {
      corrections: String(counters.correctionRounds || 0),
      reviews: String(counters.reviewRounds || 0),
      evidence: String(counters.noNewEvidenceCycles || 0)
    })));
    if(goal.status === "stopped"){
      f.appendChild(h("div", "summary-line mb-8", t("goalStoppedLine", {
        reason: localizedCause || t("goalStoppedDefault"),
        at: goal.stoppedAt ? fmtTm(goal.stoppedAt) : "-"
      })));
    }
    var pr = goal.progress || {};
    f.appendChild(h("div", "summary-line mb-8", t("goalProgressCompact", {
      satisfied: String(pr.satisfied || 0),
      total: String(pr.total || 0),
      percent: String(pr.percent || 0)
    })));
    var actions = h("div", "actions mb-8");
    if(goal.status !== "stopped" && goal.status !== "completed"){
      var advanceBtn = h("button", "btn sm", t("goalAdvance"));
      advanceBtn.type = "button";
      advanceBtn.setAttribute("data-fl-role", "goal-advance");
      advanceBtn.addEventListener("click", function(){
        if(!window.confirm(t("goalAdvanceConfirm"))) return;
        taskAction("/api/ops/goals/" + encodeURIComponent(id) + "/advance", { confirm: true }, advanceBtn, function(){
          showGoalDetail(id);
          refresh();
        });
      });
      actions.appendChild(advanceBtn);
      var stopBtn = h("button", "btn sm danger", t("goalStop"));
      stopBtn.type = "button";
      stopBtn.setAttribute("data-fl-role", "goal-stop");
      stopBtn.addEventListener("click", function(){
        if(!window.confirm(t("goalStopConfirm"))) return;
        taskAction("/api/ops/goals/" + encodeURIComponent(id) + "/stop", { confirm: true }, stopBtn, function(){
          showGoalDetail(id);
          refresh();
        });
      });
      actions.appendChild(stopBtn);
    }
    f.appendChild(actions);
    var list = h("div", "goal-milestones");
    list.appendChild(h("div", "section-title", t("goalMilestonesTitle")));
    (goal.milestones || []).forEach(function(m){
      var row = h("div", "summary-card mb-8");
      row.setAttribute("data-fl-role", "goal-milestone");
      var displayTask = m.effectiveTaskName || m.effectiveTaskId || m.taskName || m.taskId || "";
      row.appendChild(cardHead(
        m.itemId + " · " + m.gate,
        displayTask,
        badge(m.satisfied ? "completed" : (m.effectiveTaskStatus || m.taskStatus || "waiting"))
      ));
      // Plain-language delivery explanation in the selected locale. Keep the
      // canonical basis only as a non-visible audit attribute; users should not
      // need to understand internal state tokens.
      var milestoneReason = m.satisfied
        ? (goalMilestoneDeliveryLabel(m.deliveryBasis, m.reason || "") || m.reason || "")
        : (m.reason || "");
      row.appendChild(h("div", "summary-line", milestoneReason));
      if(m.satisfied && m.deliveryBasis){
        row.setAttribute("data-fl-delivery-basis", String(m.deliveryBasis));
      }
      if(m.handoff){
        row.appendChild(h("div", "summary-line", t("goalHandoffMilestoneLine", {
          status: handoffStatusLabel(m.handoff.status),
          successor: String(m.handoff.successorTaskId || ""),
          profile: String(m.handoff.destinationWorkerProfileId || ""),
          paths: String(m.handoff.reusablePathCount || 0),
          gaps: String(m.handoff.remainingGapCount || 0)
        })));
        row.appendChild(h("div", "summary-line dim", t("compHandoffNext", {
          action: handoffNextActionLabel(m.handoff.nextAction)
        })));
      }
      if(m.candidateDigestPrefix){
        row.appendChild(h("div", "fs11 dim mono", t("goalCandidateDigest", {
          digest: m.candidateDigestPrefix
        })));
      }
      if(m.worker && (m.worker.provider || m.worker.model)){
        row.appendChild(h("div", "fs11 dim", t("goalWorkerIdentity", {
          provider: String(m.worker.provider || ""),
          model: String(m.worker.model || ""),
          runtime: String(m.worker.runtime || "")
        })));
      }
      row.appendChild(h("div", "summary-line dim", t("goalNextLine", {
        text: goalNextActionLabel(m.nextActionCode, m.nextAction)
      })));
      var openId = m.effectiveTaskId || m.taskId;
      if(openId){
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.addEventListener("click", function(){ showTask(openId); });
        row.addEventListener("keydown", function(ev){
          if(ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); showTask(openId); }
        });
      }
      list.appendChild(row);
    });
    f.appendChild(list);
    showDetail(f);
  }).catch(function(e){
    detailEl.replaceChildren(detailErrorFragment("goalDetailLoadFailed", e));
  });
}

function taskAction(path, body, btn, onOk, onFail){
  if(btn) btn.disabled = true;
  flashError("");
  postJSON(path, body || {})
    .then(function(res){
      toast(res.message || res.action || t("taskActionOk"));
      if(onOk) onOk(res);
      else refresh();
    })
    .catch(function(e){
      var failMsg = (e && e.message) ? String(e.message) : "";
      flashError(t("taskActionFailed"), failMsg);
      if(onFail) onFail(failMsg);
    })
    .finally(function(){ if(btn) btn.disabled = false; });
}

function appendJourneyList(parent, labelKey, items, mono){
  if(!Array.isArray(items) || !items.length) return;
  parent.appendChild(h("div", "journey-list-label", t(labelKey)));
  var list = h("div", "journey-list");
  items.forEach(function(item){
    list.appendChild(h("div", "journey-list-item" + (mono ? " mono dim" : ""), item));
  });
  parent.appendChild(list);
}
function journeyDisclosure(summaryText, content){
  var details = h("details", "audit-details journey-disclosure");
  var summary = document.createElement("summary");
  summary.textContent = summaryText;
  details.appendChild(summary);
  details.appendChild(content);
  return details;
}
function readableVerificationCheckLabel(label){
  var value = typeof label === "string" ? label.toLowerCase() : "";
  if(value.indexOf("hub-ui-assets.test") >= 0) return t("journeyCheckUiContract");
  if(value.indexOf("node --check") >= 0) return t("journeyCheckScriptLoads");
  if(value.indexOf("tsc") >= 0) return t("journeyCheckProjectCompiles");
  /* Bounded presentation map: known build command → neutral noun phrase.
   * Never infers pass/fail from the command string itself. */
  if(value.indexOf("npm run build") >= 0) return t("journeyCheckProjectBuild");
  if(value.indexOf("git diff --check") >= 0) return t("journeyCheckPatchFormat");
  if(value.indexOf("npm run check") >= 0) return t("journeyCheckFullProject");
  if(value.indexOf("test") >= 0) return t("journeyCheckAutomatedBehavior");
  return t("journeyCheckAcceptanceFallback");
}
/* Readable name for the Main-authored summary language. Known codes use
 * their own-language autonym so the label is stable in either Hub locale;
 * an unknown code is shown verbatim but capped, never as a prominent raw
 * value. Only consumed inside the closed assignment evidence disclosure. */
function presentationLanguageLabel(lang){
  var value = typeof lang === "string" ? lang : "";
  if(value === "en") return t("journeyPresentationLanguageEn");
  if(value === "zh") return t("journeyPresentationLanguageZh");
  return value.slice(0, 16);
}
function attemptStateLabel(status){
  var map = { queued: "journeyAttemptQueued", running: "journeyAttemptRunning",
    succeeded: "journeyAttemptSucceeded", failed: "journeyAttemptFailed",
    interrupted: "journeyAttemptInterrupted" };
  return t(map[status] || "journeyAttemptUnknown");
}
/* Primary Attempt label prefers a closed presentationState derived from durable
 * same-Attempt events when the parent Task is already terminal. Raw status stays
 * secondary technical evidence and is never the primary "still running" claim. */
function attemptPrimaryLabel(att){
  var item = att && typeof att === "object" ? att : {};
  if(item.presentationState === "ended-after-worker-completion"){
    return t("journeyAttemptEndedAfterWorkerCompletion");
  }
  if(item.presentationState === "ended-unsuccessfully"){
    return t("journeyAttemptEndedUnsuccessfully");
  }
  return attemptStateLabel(item.status);
}
function attemptPresentationExplain(att){
  var item = att && typeof att === "object" ? att : {};
  if(item.presentationState === "ended-after-worker-completion"){
    return t("journeyAttemptEndedAfterWorkerCompletionExplain");
  }
  if(item.presentationState === "ended-unsuccessfully"){
    return t("journeyAttemptEndedUnsuccessfullyExplain");
  }
  return "";
}
function attemptHasClosedPresentation(att){
  var item = att && typeof att === "object" ? att : {};
  return item.presentationState === "ended-after-worker-completion"
    || item.presentationState === "ended-unsuccessfully";
}
function reviewDecisionLabel(decision){
  var map = { accept: "journeyReviewAccept", revise: "journeyReviewRevise", reject: "journeyReviewReject" };
  return t(map[decision] || decision || "journeyFailureUnknown");
}
function integrationStateLabel(status){
  var map = { running: "journeyIntegrationRunning", completed: "journeyIntegrationCompleted",
    failed: "journeyIntegrationFailed", "outcome-unknown": "journeyIntegrationUnknown" };
  return t(map[status] || "journeyIntegrationUnknown");
}

/* TASK_STORY_ADAPTER_START */
/* Pure, bounded adapter for the shared Task Detail fixture. It keeps the
 * Worker run, independent checks, Main review, and final delivery as separate
 * facts so one later success can never erase an earlier failure. The primary
 * Main-input text prefers the canonical Main-authored presentation summary
 * when its exact safe shape is present, and otherwise preserves the honest
 * outcome or legacy goal fallback without translating or rewriting it. */
function taskStoryPresentation(task){
  var source = task && typeof task === "object" ? task : {};
  var journey = source.journey && typeof source.journey === "object" ? source.journey : {};
  var assignment = journey.assignment && typeof journey.assignment === "object" ? journey.assignment : null;
  var worker = journey.workerExecution && typeof journey.workerExecution === "object" ? journey.workerExecution : {};
  var verification = journey.independentVerification && typeof journey.independentVerification === "object"
    ? journey.independentVerification : null;
  var delivery = journey.finalDelivery && typeof journey.finalDelivery === "object"
    ? journey.finalDelivery : {};
  var cause = journey.cause && typeof journey.cause === "object" ? journey.cause : null;
  var next = journey.nextAction && typeof journey.nextAction === "object" ? journey.nextAction : null;
  var attempts = Array.isArray(worker.attempts) ? worker.attempts.slice(0, 5) : [];
  var changedFiles = Array.isArray(worker.changedFilePaths) ? worker.changedFilePaths.slice(0, 40) : [];
  var checks = verification && Array.isArray(verification.checks) ? verification.checks.slice(0, 12) : [];
  var failedChecks = checks.filter(function(item){ return item && item.passed === false; });
  var deliverables = assignment && Array.isArray(assignment.deliverables)
    ? assignment.deliverables.slice(0, 6).map(String) : [];
  var workerClaim = worker.workerClaim && typeof worker.workerClaim.text === "string"
    ? worker.workerClaim.text.slice(0, 600) : "";
  var repaired = !!(delivery.remediationDisposition
    && delivery.remediationDisposition.status === "verified-repaired-delivered");
  var amendedAcceptance = !!(repaired
    && delivery.remediationDisposition
    && delivery.remediationDisposition.acceptanceBasis === "amended-acceptance");
  var integrated = !!(delivery.integration && delivery.integration.status === "completed");
  var taskStatus = String(source.status || "waiting");
  var taskFailed = taskStatus === "failed" || taskStatus === "interrupted" || taskStatus === "blocked";
  var taskSucceeded = taskStatus === "succeeded" || taskStatus === "completed";
  var anyAttemptFailed = attempts.some(function(item){
    return item && (item.status === "failed"
      || item.presentationState === "ended-after-worker-completion"
      || item.presentationState === "ended-unsuccessfully");
  });
  /* A closed presentationState means durable events already proved this Attempt
   * ended, so a leftover recorded "running" status must not look active. */
  var anyAttemptRunning = attempts.some(function(item){
    return item && item.status === "running"
      && item.presentationState !== "ended-after-worker-completion"
      && item.presentationState !== "ended-unsuccessfully";
  });
  var workerState = amendedAcceptance ? "complete"
    : anyAttemptRunning ? (taskFailed ? "failed" : "running")
    : anyAttemptFailed ? "failed"
    : attempts.length ? "complete"
    : taskFailed ? "failed"
    : taskSucceeded ? "complete" : "waiting";
  var verificationState = !verification || verification.available !== true ? "waiting"
    : verification.conclusion === "passed" ? "complete" : "failed";
  var outputState = changedFiles.length === 0 ? "empty"
    : taskFailed ? "failed"
    : verificationState === "complete" ? "complete"
    : verificationState === "failed" ? "failed" : "waiting";
  var review = delivery.mainReview && typeof delivery.mainReview === "object"
    ? delivery.mainReview : null;
  var mainDecision = review && typeof review.decision === "string" ? review.decision : "";
  var finalState = repaired || integrated ? "complete"
    : mainDecision === "accept" ? "ready" : "waiting";
  /* Prefer the canonical Main-authored presentation summary when its exact
   * safe shape (an object with a non-empty string summary) is present. The
   * authored text is kept exact and bounded - never translated, rewritten,
   * or combined with the technical outcome. Legacy tasks without a
   * presentation block keep falling back to outcome or goal. */
  var presentation = assignment && assignment.presentation && typeof assignment.presentation === "object"
    ? assignment.presentation : null;
  var presentationSummary = presentation && typeof presentation.summary === "string" && presentation.summary.length
    ? presentation.summary.slice(0, 600) : "";
  var presentationLanguage = presentation && typeof presentation.language === "string" && presentation.language.length
    ? presentation.language.slice(0, 16) : "";
  var authored = !!presentationSummary;
  var goal = assignment && typeof (assignment.outcome || assignment.goal) === "string"
    ? String(assignment.outcome || assignment.goal).slice(0, 600) : "";
  var primaryText = authored ? presentationSummary : goal;
  var why = cause && typeof cause.why === "string" ? cause.why.slice(0, 600) : "";
  var nextLabel = next && typeof next.label === "string" ? next.label.slice(0, 40) : "investigate";
  var reviewReason = review && typeof review.reason === "string" ? review.reason.slice(0, 600) : "";
  return {
    repairedDelivery: repaired,
    amendedAcceptance: amendedAcceptance,
    summary: {
      state: repaired ? "complete" : String(source.status || "waiting"),
      titleKey: "storyCurrentTitle",
      bodyKey: repaired
        ? (amendedAcceptance
          ? "storyCurrentAmended"
          : (taskSucceeded ? "storyCurrentRepairedAfterMachinePass" : "storyCurrentRepaired"))
        : "storyCurrentBody"
    },
    steps: [
      {
        id: "main-input",
        state: primaryText ? "complete" : "unknown",
        titleKey: "storyInputTitle",
        bodyKey: authored ? "storyInputBodyAuthored" : (primaryText ? "storyInputBody" : "storyInputMissing"),
        value: primaryText,
        valueLabelKey: authored ? "storyInputMainAuthoredLabel" : "storyInputGoalLabel",
        authored: authored,
        language: presentationLanguage,
        items: deliverables,
        itemsLabelKey: "storyInputDeliverablesLabel"
      },
      {
        id: "worker-process",
        state: workerState,
        titleKey: "storyWorkerProcessTitle",
        bodyKey: "storyWorkerProcessBody",
        params: { count: String(attempts.length) },
        value: [worker.provider, worker.model, worker.runtime].filter(Boolean).join(" / "),
        valueLabelKey: "storyWorkerUsedLabel"
      },
      {
        id: "worker-output",
        state: outputState,
        titleKey: "storyWorkerOutputTitle",
        bodyKey: changedFiles.length === 0 ? "storyWorkerOutputNone"
          : outputState === "complete" ? "storyWorkerOutputChecked"
          : verificationState === "failed" ? "storyWorkerOutputRejected"
          : taskFailed ? "storyWorkerOutputTaskFailed"
          : "storyWorkerOutputWaiting",
        params: { count: String(changedFiles.length) },
        value: workerClaim,
        valueLabelKey: "storyWorkerClaimLabel",
        items: changedFiles,
        itemsLabelKey: "storyWorkerFilesLabel"
      },
      {
        id: "main-check",
        state: verificationState,
        titleKey: "storyMainCheckTitle",
        bodyKey: verificationState === "complete" ? "storyMainCheckPassed"
          : verificationState === "failed" ? "storyMainCheckFailed"
          : "storyMainCheckWaiting",
        params: {
          failed: String(verification && verification.failedCount || 0),
          total: String(verification && verification.totalCount || checks.length)
        },
        items: failedChecks.map(function(item){ return String(item.label || "check"); }),
        itemsLabelKey: "storyFailedChecksLabel"
      },
      {
        id: "final-result",
        state: finalState,
        titleKey: "storyFinalTitle",
        bodyKey: repaired
          ? (amendedAcceptance ? "storyFinalAmended" : "storyFinalRepaired")
          : integrated ? "storyFinalApplied"
          : finalState === "ready" ? "storyFinalReady" : "storyFinalWaiting",
        value: reviewReason,
        valueLabelKey: "storyMainDecisionReasonLabel",
        items: !repaired && verificationState === "complete" && mainDecision === "accept"
          ? changedFiles : [],
        itemsLabelKey: "storyFinalFilesLabel",
        noteKey: repaired ? "storyFinalFilesRepairedMissing" : ""
      },
      {
        id: "cause",
        state: repaired ? "complete" : (cause && cause.what === "failed" ? "failed" : "info"),
        titleKey: "storyCauseTitle",
        bodyKey: why ? "storyCauseBody" : "storyCauseMissing",
        value: why,
        causeWhat: cause && cause.what ? String(cause.what) : "failed",
        failureCategory: cause && cause.failureCategory ? String(cause.failureCategory) : "unknown",
        mainDecision: repaired ? "" : mainDecision
      },
      {
        id: "next",
        state: nextLabel === "done" ? "complete" : "next",
        titleKey: "storyNextTitle",
        bodyKey: nextLabel === "done" ? "storyNextDone" : "storyNextBody",
        nextLabel: nextLabel
      }
    ]
  };
}
/* TASK_STORY_ADAPTER_END */

function storyStateLabel(state){
  var map = {
    complete: "storyStateComplete", succeeded: "storyStateComplete", ready: "storyStateReady",
    running: "storyStateRunning", queued: "storyStateWaiting", waiting: "storyStateWaiting",
    failed: "storyStateFailed", empty: "storyStateEmpty", unknown: "storyStateUnknown",
    next: "storyStateNext", info: "storyStateInfo"
  };
  return t(map[state] || "storyStateInfo");
}
function storyStateClass(state){
  if(state === "complete" || state === "succeeded" || state === "ready") return "ok";
  if(state === "failed") return "err";
  if(state === "running" || state === "next") return "warn";
  return "dim";
}
function renderTaskStory(task){
  var presentation = taskStoryPresentation(task);
  var cardEl = h("div", "card form-card task-story-flow");
  cardEl.setAttribute("data-fl-role", "task-story-flow");
  cardEl.appendChild(h("div", "card-title mb-4", t("storyTitle")));
  cardEl.appendChild(h("div", "summary-line dim mb-8", t("storyIntro")));
  var summary = h("div", "task-story-summary");
  summary.setAttribute("data-fl-role", "task-story-current-result");
  var summaryHead = h("div", "task-story-head");
  summaryHead.appendChild(h("div", "task-story-step-title", t(presentation.summary.titleKey)));
  summaryHead.appendChild(h("span", "badge badge-" + storyStateClass(presentation.summary.state),
    storyStateLabel(presentation.summary.state)));
  summary.appendChild(summaryHead);
  summary.appendChild(h("div", "task-story-step-body", t(presentation.summary.bodyKey)));
  cardEl.appendChild(summary);
  var list = h("div", "task-story-steps");
  presentation.steps.forEach(function(step, index){
    var row = h("div", "task-story-step");
    row.setAttribute("data-fl-role", "task-story-step-" + step.id);
    var marker = h("div", "task-story-marker", String(index + 1));
    row.appendChild(marker);
    var content = h("div", "task-story-content");
    var head = h("div", "task-story-head");
    head.appendChild(h("div", "task-story-step-title", t(step.titleKey)));
    head.appendChild(h("span", "badge badge-" + storyStateClass(step.state), storyStateLabel(step.state)));
    content.appendChild(head);
    content.appendChild(h("div", "task-story-step-body", t(step.bodyKey, step.params || {})));
    if(step.value){
      var valueBox = h("div", "task-story-primary-value");
      if(step.valueLabelKey){
        valueBox.appendChild(h("div", "task-story-value-label", t(step.valueLabelKey)));
      }
      var primaryValue = step.id === "cause"
        ? resolveCauseWhy(step.causeWhat, step.value, step.failureCategory, step.mainDecision)
        : step.value;
      valueBox.appendChild(h("div", "task-story-value-text", primaryValue));
      content.appendChild(valueBox);
    }
    if(step.items && step.items.length){
      var itemBox = h("div", "task-story-output");
      if(step.itemsLabelKey){
        itemBox.appendChild(h("div", "task-story-value-label", t(step.itemsLabelKey)));
      }
      var itemList = h("ul", "task-story-output-list");
      step.items.slice(0, 6).forEach(function(item){
        itemList.appendChild(h("li", "task-story-output-item", String(item)));
      });
      itemBox.appendChild(itemList);
      if(step.items.length > 6){
        itemBox.appendChild(h("div", "task-story-more dim",
          t("storyMoreItems", { count: String(step.items.length - 6) })));
      }
      content.appendChild(itemBox);
    }
    if(step.noteKey){
      content.appendChild(h("div", "task-story-note", t(step.noteKey)));
    }
    if(step.id === "next" && step.nextLabel && step.nextLabel !== "done"){
      content.appendChild(h("div", "task-story-primary-value", nextActionLabel(step.nextLabel)));
    }
    row.appendChild(content);
    list.appendChild(row);
  });
  cardEl.appendChild(list);
  return cardEl;
}

/* Render the Main-authored routing decision as a compact card in task detail.
 * Plain-language selection reason, evidence scope, and competition decision.
 * Internal identity and scores are in a folded details block. */
function renderRoutingDecisionCard(rd){
  if(!rd || !rd.selectedWorker || !rd.selectedBecause) return null;

  var cardEl = h("div", "card form-card");
  cardEl.setAttribute("data-fl-role", "routing-decision-card");
  cardEl.appendChild(h("div", "card-title mb-4", t("mrSectionTitle")));

  /* Selected Worker */
  var sw = rd.selectedWorker;
  var swRow = h("div", "summary-line mb-4");
  swRow.appendChild(document.createTextNode(
    t("mrRecommendation", {
      provider: sw.provider || "?",
      model: sw.model || "?",
      taskClass: (rd.taskFamily || rd.selectedBecause.code || "-")
    })
  ));
  cardEl.appendChild(swRow);

  /* Selection reason */
  var because = rd.selectedBecause;
  var reasonBlock = h("div", "mr-reason");
  reasonBlock.appendChild(h("div", "summary-line dim", t("mrSelectionReason") + ":"));
  reasonBlock.appendChild(h("div", "summary-line", because.note || "-"));
  cardEl.appendChild(reasonBlock);

  /* Evidence scope */
  var ev = rd.evidenceSnapshot;
  if(ev){
    var scopeKey = ev.scope === "exact-class" ? "mrEvidenceScopeExact"
      : (ev.scope === "task-family" ? "mrEvidenceScopeFamily" : "mrEvidenceScopeNone");
    var scopeLine = h("div", "summary-line dim mt-4", t("mrEvidenceScope") + ": " + t(scopeKey));
    cardEl.appendChild(scopeLine);
    if(ev.settingsDigest){
      cardEl.appendChild(h("div", "summary-line dim fs11", t("mrFactorWeighted", { score: ev.settingsDigest })));
    }
  }

  /* Competition decision */
  var comp = rd.competition;
  if(comp){
    var compLine = h("div", "summary-line mt-4");
    var intentKey = comp.intent === "none" ? "mrIntentNone"
      : (comp.intent === "consider" ? "mrIntentConsider" : "mrIntentRequired");
    compLine.appendChild(h("span", "badge " + (comp.intent === "none" ? "badge-dim" : "badge-info"),
      t("mrCompetitionDecisionTitle") + " - " + t(intentKey)));
    cardEl.appendChild(compLine);
    var triggers = comp.triggers || [];
    if(triggers.length){
      var triggerKeyMap = {
        critical: "mrTriggerCritical",
        "multiple-plausible-solutions": "mrTriggerMultipleSolutions",
        "new-family": "mrTriggerNewFamily",
        "user-requested": "mrTriggerUserRequested"
      };
      var triggerLabels = triggers.map(function(trigger){
        return triggerKeyMap[trigger] ? t(triggerKeyMap[trigger]) : trigger;
      });
      cardEl.appendChild(h("div", "summary-line dim mt-2",
        t("mrCompTriggersLabel") + ": " + triggerLabels.join(", ")));
    }
  }

  /* Shortlist and identity folded */
  var detailsEl = document.createElement("details");
  detailsEl.className = "audit-details";
  var summaryEl = document.createElement("summary");
  summaryEl.textContent = t("mrTechnicalDetail");
  detailsEl.appendChild(summaryEl);

  /* Frozen Worker identity + runtime */
  var techBody = h("div", "summary-line dim mt-4");
  techBody.appendChild(document.createTextNode(
    "Worker: " + (sw.provider || "?") + " / " + (sw.model || "?")
    + " · " + (sw.runtime || "?") + " · " + (sw.effort || "?")));
  if(sw.workerProfileId) {
    techBody.appendChild(document.createTextNode(" · Profile: " + sw.workerProfileId));
  }
  detailsEl.appendChild(techBody);

  /* Shortlist */
  var sl = rd.shortlist || [];
  if(sl.length){
    var slList = h("div", "summary-line dim mt-4");
    slList.appendChild(document.createTextNode("Shortlist:"));
    sl.forEach(function(w, i){
      slList.appendChild(document.createTextNode(
        " " + w.provider + "/" + w.model + ":" + (w.runtime || "?") + ":" + (w.effort || "?")
        + (w.workerProfileId ? "(" + w.workerProfileId + ")" : "")
        + ((i < sl.length - 1) ? "," : "")));
    });
    detailsEl.appendChild(slList);
  }

  /* Sample counts */
  if(ev && ev.exactSampleCounts){
    var scLine = h("div", "summary-line dim mt-4");
    scLine.appendChild(document.createTextNode("Exact samples:"));
    Object.keys(ev.exactSampleCounts).forEach(function(k){
      scLine.appendChild(document.createTextNode(" " + k + "=" + ev.exactSampleCounts[k]));
    });
    detailsEl.appendChild(scLine);
    if(ev.familySampleCounts){
      var fcLine = h("div", "summary-line dim mt-2");
      fcLine.appendChild(document.createTextNode("Family samples:"));
      Object.keys(ev.familySampleCounts).forEach(function(k){
        fcLine.appendChild(document.createTextNode(" " + k + "=" + ev.familySampleCounts[k]));
      });
      detailsEl.appendChild(fcLine);
    }
  }

  /* Reason code */
  detailsEl.appendChild(h("div", "summary-line dim mt-4",
    t("mrSelectionReason") + ": " + (rd.selectedBecause.code || "-")));

  cardEl.appendChild(detailsEl);
  return cardEl;
}

function competitionNextActionLabel(code){
  var keys = {
    "wait-for-candidates": "compTaskNextWaitCandidates",
    compare: "compTaskNextCompare",
    "main-review": "compTaskNextMainReview",
    integration: "compTaskNextIntegration",
    "correct-candidate": "compTaskNextCorrect",
    stopped: "compTaskNextStopped"
  };
  return t(keys[code] || "compTaskNextMainReview");
}

/* Task Detail projection of the actual Competition this Candidate belongs to.
 * This is separate from routing advice: it explains what really ran, what the
 * machine comparison found, what Main decided, and what is allowed next. */
function renderTaskCompetitionContext(ctx){
  if(!ctx || !ctx.competitionId) return null;
  var cardEl = h("div", "card form-card competition-task-context");
  cardEl.setAttribute("data-fl-role", "task-competition-context");
  cardEl.appendChild(h("div", "card-title mb-4", t("compTaskTitle")));
  cardEl.appendChild(h("div", "summary-line dim mb-8", t("compTaskExplain")));
  if(ctx.legacy === true){
    cardEl.appendChild(h("div", "summary-line dim", t("compStoryReasonUnavailable")));
  } else if(ctx.reason && ctx.reason.note){
    cardEl.appendChild(h("div", "summary-line", t("compStoryReason", {
      reason: String(ctx.reason.note)
    })));
  }
  var own = ctx.candidate || {};
  var identity = own.identity;
  cardEl.appendChild(h("div", "summary-line", t("compTaskThisWorker", {
    worker: String(own.providerName || "?") + "/" + String(own.modelName || "?"),
    status: statusLabel(own.taskStatus || "unknown")
  })));
  if(identity){
    cardEl.appendChild(h("div", "summary-line dim fs11", t("compTaskIdentity", {
      runtime: String(identity.runtime || "?"), effort: String(identity.effort || "?")
    })));
  }
  var all = Array.isArray(ctx.candidates) ? ctx.candidates : [];
  if(all.length > 1){
    cardEl.appendChild(h("div", "summary-line dim fs11", t("compTaskOtherWorkers", {
      count: String(all.length - 1)
    })));
  }
  var machine = ctx.machineComparison || {};
  if(machine.state === "recommendation" && machine.recommendation){
    var recommended = all.find(function(entry){
      return entry.candidateId === machine.recommendation.candidateId;
    });
    cardEl.appendChild(h("div", "summary-line", t("compTaskMachineRecommendation", {
      worker: recommended
        ? String(recommended.providerName || "?") + "/" + String(recommended.modelName || "?")
        : t("compCandidateUnknown")
    })));
  } else if(machine.state === "no-deliverable"){
    cardEl.appendChild(h("div", "summary-line", t("compStoryMachineNoDeliverable")));
  } else {
    cardEl.appendChild(h("div", "summary-line dim", t("compStoryMachineWaiting")));
  }
  var decision = ctx.mainDecision;
  if(decision){
    var decisionKey = decision.decision === "accept" ? "compStoryMainAccepted"
      : decision.decision === "revise" ? "compStoryMainRevised"
      : "compStoryMainRejected";
    cardEl.appendChild(h("div", "summary-line", t(decisionKey, {
      candidate: String(decision.candidateId === own.candidateId
        ? (own.providerName || "?") + "/" + (own.modelName || "?")
        : t("compCandidateUnknown"))
    })));
    if(ctx.mainDecisionCurrent !== true){
      cardEl.appendChild(h("div", "summary-line dim fs11", t("compTaskDecisionStale")));
    }
  } else {
    cardEl.appendChild(h("div", "summary-line dim", t("compStoryMainNone")));
  }
  var retained = Array.isArray(ctx.retainedPartial) ? ctx.retainedPartial : [];
  var ownRetained = retained.find(function(entry){ return entry.candidateId === own.candidateId; });
  if(ownRetained){
    cardEl.appendChild(h("div", "summary-line dim", t("compStoryRetained", {
      candidate: String(own.providerName || "?") + "/" + String(own.modelName || "?"),
      paths: String((ownRetained.reusablePaths || []).length),
      gaps: String((ownRetained.remainingGaps || []).length)
    })));
  }
  var handoffs = Array.isArray(ctx.handoffs) ? ctx.handoffs : [];
  var ownHandoff = handoffs.find(function(entry){
    return entry.sourceCandidateId === own.candidateId
      || entry.successorTaskId === (task && task.id)
      || entry.sourceTaskId === (task && task.id);
  });
  if(ownHandoff){
    cardEl.appendChild(h("div", "summary-line", t("compStoryHandoff", {
      from: String(own.providerName || "?") + "/" + String(own.modelName || "?"),
      to: String(ownHandoff.destinationWorkerProfileId || "?"),
      paths: String(ownHandoff.reusablePathCount || 0),
      gaps: String(ownHandoff.remainingGapCount || 0),
      status: handoffStatusLabel(ownHandoff.status)
    })));
    if(ownHandoff.failureCode){
      cardEl.appendChild(h("div", "summary-line dim fs11", t("compHandoffFailure", {
        code: handoffFailureLabel(ownHandoff.failureCode)
      })));
    }
    cardEl.appendChild(h("div", "summary-line dim fs11", t("compHandoffNext", {
      action: handoffNextActionLabel(ownHandoff.nextAction)
    })));
  }
  cardEl.appendChild(h("div", "summary-line mt-4", t("compTaskNext", {
    action: competitionNextActionLabel(ctx.nextAction)
  })));
  var open = h("button", "btn sm", t("compTaskOpenCompetition"));
  open.type = "button";
  open.addEventListener("click", function(){ showCompetition(ctx.competitionId); });
  cardEl.appendChild(hd("div", "actions mt-8", [open]));
  return cardEl;
}

function handoffStatusLabel(status){
  var map = {
    authorized: "compHandoffStatusAuthorized",
    preparing: "compHandoffStatusPreparing",
    prepared: "compHandoffStatusPrepared",
    failed: "compHandoffStatusFailed"
  };
  return t(map[status] || "compHandoffStatusAuthorized");
}

function handoffFailureLabel(code){
  var goalCodes = {
    "not-goal-task": "goalHandoffFailNotGoal",
    "goal-terminal": "goalHandoffFailTerminal",
    "source-not-eligible": "goalHandoffFailSource"
  };
  if(goalCodes[code]) return t(goalCodes[code]);
  var map = {
    "stale-revision": "compHandoffFailStale",
    "missing-retained": "compHandoffFailMissingRetained",
    "missing-revision": "compHandoffFailMissingRevision",
    "same-profile": "compHandoffFailSameProfile",
    "profile-not-launchable": "compHandoffFailNotLaunchable",
    "final-choice": "compHandoffFailFinalChoice",
    "duplicate-handoff": "compHandoffFailDuplicate",
    "source-is-successor": "compHandoffFailHop",
    "materialization-failed": "compHandoffFailMaterialize",
    "apply-mismatch": "compHandoffFailApply",
    "profile-unknown": "compHandoffFailProfileUnknown"
  };
  return t(map[code] || "compHandoffFailGeneric");
}

function handoffNextActionLabel(action){
  var map = {
    "wait-for-successor": "compHandoffNextWait",
    "review-successor": "compHandoffNextReview",
    "inspect-failure": "compHandoffNextInspect",
    "choose-different-profile": "compHandoffNextProfile",
    "retain-fresh-candidate": "compHandoffNextRetain",
    "none": "compHandoffNextNone"
  };
  return t(map[action] || "compHandoffNextInspect");
}

function competitionHandoffControls(competitionId, status, onDone){
  var retained = Array.isArray(status && status.retainedPartial) ? status.retainedPartial : [];
  var handoffs = Array.isArray(status && status.handoffs) ? status.handoffs : [];
  var cands = Array.isArray(status && status.candidates) ? status.candidates : [];
  if(!retained.length) return null;
  var box = h("div", "card form-card competition-handoff-controls");
  box.setAttribute("data-fl-role", "competition-handoff-controls");
  box.appendChild(h("div", "card-title mb-4", t("compHandoffTitle")));
  box.appendChild(h("div", "summary-line dim mb-8", t("compHandoffHint")));
  retained.forEach(function(entry){
    var existing = handoffs.find(function(hEntry){ return hEntry.sourceCandidateId === entry.candidateId; });
    var cand = cands.find(function(c){ return c.candidateId === entry.candidateId; });
    var label = cand
      ? String(cand.providerName || "?") + "/" + String(cand.modelName || "?")
      : String(entry.candidateId || "");
    var row = h("div", "handoff-entry mb-8");
    row.appendChild(h("div", "summary-line", t("compHandoffRetained", {
      candidate: label,
      paths: String((entry.reusablePaths || []).length),
      gaps: String((entry.remainingGaps || []).length)
    })));
    if(existing){
      row.appendChild(h("div", "summary-line", t("compStoryHandoff", {
        from: label,
        to: String(existing.destinationWorkerProfileId || "?"),
        paths: String(existing.reusablePathCount || 0),
        gaps: String(existing.remainingGapCount || 0),
        status: handoffStatusLabel(existing.status)
      })));
      if(existing.successorTaskId){
        var openSucc = h("button", "btn sm", t("compHandoffOpenSuccessor"));
        openSucc.type = "button";
        openSucc.addEventListener("click", function(){ showTask(existing.successorTaskId); });
        row.appendChild(hd("div", "actions mt-4", [openSucc]));
      }
      if(existing.failureCode){
        row.appendChild(h("div", "summary-line dim fs11", t("compHandoffFailure", {
          code: handoffFailureLabel(existing.failureCode)
        })));
      }
      box.appendChild(row);
      return;
    }
    var revLabel = h("label", "", t("compHandoffRevisionLabel"));
    var revInput = h("input", "");
    revInput.type = "text";
    revInput.placeholder = t("compHandoffRevisionPh");
    if(entry.candidateRevisionId) revInput.value = String(entry.candidateRevisionId);
    revLabel.appendChild(revInput);
    row.appendChild(revLabel);
    var profileLabel = h("label", "", t("compHandoffProfileLabel"));
    var profileInput = h("input", "");
    profileInput.type = "text";
    profileInput.placeholder = t("compHandoffProfilePh");
    profileLabel.appendChild(profileInput);
    row.appendChild(profileLabel);
    var reasonLabel = h("label", "", t("taskReviewReason"));
    var reasonInput = h("input", "");
    reasonInput.type = "text";
    reasonInput.placeholder = t("compHandoffReasonPh");
    reasonLabel.appendChild(reasonInput);
    row.appendChild(reasonLabel);
    var submit = h("button", "btn sm primary", t("compHandoffSubmit"));
    submit.type = "button";
    submit.addEventListener("click", function(){
      if(!revInput.value.trim()){ flashError(t("compHandoffRevisionRequired")); return; }
      if(!profileInput.value.trim()){ flashError(t("compHandoffProfileRequired")); return; }
      if(!reasonInput.value.trim()){ flashError(t("taskReviewReasonRequired")); return; }
      if(!window.confirm(t("compHandoffConfirm"))) return;
      taskAction("/api/ops/competitions/" + encodeURIComponent(competitionId) + "/handoff", {
        candidateId: entry.candidateId,
        candidateRevisionId: revInput.value.trim(),
        destinationWorkerProfileId: profileInput.value.trim(),
        reason: reasonInput.value.trim(),
        confirm: true
      }, submit, onDone);
    });
    row.appendChild(hd("div", "actions mt-4", [submit]));
    box.appendChild(row);
  });
  return box;
}

function renderCandidateHandoffCard(task){
  var hand = task.journey && task.journey.candidateHandoff;
  if(!hand) return null;
  var card = h("div", "card form-card candidate-handoff-card");
  card.setAttribute("data-fl-role", "candidate-handoff");
  card.appendChild(h("div", "card-title mb-4", t("taskHandoffJourneyTitle")));
  card.appendChild(h("div", "summary-line dim mb-8", t("taskHandoffJourneyIntro")));
  if(hand.originKind === "goal-task"){
    card.appendChild(h("div", "summary-line", t("goalHandoffOriginLabel")));
  } else if(hand.originKind === "competition"){
    card.appendChild(h("div", "summary-line", t("compHandoffOriginLabel")));
  }
  card.appendChild(h("div", "summary-line", t("taskHandoffRole", {
    role: hand.role === "successor" ? t("taskHandoffRoleSuccessor") : t("taskHandoffRoleSource")
  })));
  card.appendChild(h("div", "summary-line", t("taskHandoffStatus", {
    status: handoffStatusLabel(hand.status)
  })));
  if(hand.destinationWorkerProfileId){
    card.appendChild(h("div", "summary-line", t("taskHandoffDestination", {
      profile: String(hand.destinationWorkerProfileId),
      worker: String(hand.destinationProvider || "?") + "/" + String(hand.destinationModel || "?")
    })));
  }
  card.appendChild(h("div", "summary-line", t("taskHandoffCounts", {
    paths: String(hand.reusablePathCount || 0),
    gaps: String(hand.remainingGapCount || 0)
  })));
  if(Array.isArray(hand.reusablePaths) && hand.reusablePaths.length){
    card.appendChild(h("div", "summary-line dim fs11", t("taskHandoffPaths", {
      paths: hand.reusablePaths.slice(0, 8).join(", ")
    })));
  }
  if(hand.sourceDigestPrefix){
    card.appendChild(h("div", "summary-line dim fs11", t("taskHandoffDigest", {
      digest: String(hand.sourceDigestPrefix)
    })));
  }
  if(hand.failureCode){
    card.appendChild(h("div", "summary-line", t("compHandoffFailure", {
      code: handoffFailureLabel(hand.failureCode)
    })));
  }
  card.appendChild(h("div", "summary-line", t("compHandoffNext", {
    action: handoffNextActionLabel(hand.nextAction)
  })));
  card.appendChild(h("div", "summary-line dim", t("taskHandoffNotRetry")));
  if(hand.role === "source" && hand.successorTaskId){
    var open = h("button", "btn sm", t("compHandoffOpenSuccessor"));
    open.type = "button";
    open.addEventListener("click", function(){ showTask(hand.successorTaskId); });
    card.appendChild(hd("div", "actions mt-8", [open]));
  } else if(hand.role === "successor" && hand.sourceTaskId){
    var openSrc = h("button", "btn sm", t("compHandoffOpenSource"));
    openSrc.type = "button";
    openSrc.addEventListener("click", function(){ showTask(hand.sourceTaskId); });
    card.appendChild(hd("div", "actions mt-8", [openSrc]));
  }
  return card;
}

/**
 * Direct Goal-Task handoff controls on Task Detail. Confirmation-gated;
 * policy stays in the daemon. Surfaces only when retained Candidate paths
 * exist and no handoff journey is already recorded on this Task.
 */
function renderGoalTaskHandoffControls(task){
  if(!task || !task.id) return null;
  if(task.journey && task.journey.candidateHandoff) return null;
  var retained = task.journey && task.journey.retainedCandidate;
  if(!retained || retained.status !== "available") return null;
  if(!Array.isArray(retained.affectedPaths) || !retained.affectedPaths.length) return null;
  if(!retained.revisionId) return null;
  // Only terminal reviewable Task statuses are candidates for direct handoff.
  var status = String(task.status || "");
  if(status !== "failed" && status !== "interrupted" && status !== "succeeded") return null;
  // Competition Candidates use the Competition handoff path.
  if(task.competitionContext) return null;

  var box = h("div", "card form-card goal-task-handoff-controls");
  box.setAttribute("data-fl-role", "goal-task-handoff-controls");
  box.appendChild(h("div", "card-title mb-4", t("goalHandoffTitle")));
  box.appendChild(h("div", "summary-line dim mb-8", t("goalHandoffHint")));
  box.appendChild(h("div", "summary-line mb-4", t("goalHandoffRetainedPaths", {
    paths: retained.affectedPaths.slice(0, 8).join(", ")
  })));

  var revLab = h("label", "", t("compHandoffRevisionLabel"));
  var revInput = h("input", "");
  revInput.type = "text";
  revInput.placeholder = t("compHandoffRevisionPh");
  revInput.value = String(retained.revisionId || "");
  revLab.appendChild(revInput);
  box.appendChild(revLab);

  var pathsLab = h("label", "", t("goalHandoffReusableLabel"));
  var pathsInput = h("input", "");
  pathsInput.type = "text";
  pathsInput.placeholder = t("goalHandoffReusablePh");
  pathsInput.value = retained.affectedPaths.length === 1
    ? String(retained.affectedPaths[0])
    : "";
  pathsLab.appendChild(pathsInput);
  box.appendChild(pathsLab);

  var gapsLab = h("label", "", t("goalHandoffGapsLabel"));
  var gapsInput = h("textarea", "");
  gapsInput.rows = 3;
  gapsInput.placeholder = t("goalHandoffGapsPh");
  gapsLab.appendChild(gapsInput);
  box.appendChild(gapsLab);

  var profileLab = h("label", "", t("compHandoffProfileLabel"));
  var profileInput = h("input", "");
  profileInput.type = "text";
  profileInput.placeholder = t("compHandoffProfilePh");
  profileLab.appendChild(profileInput);
  box.appendChild(profileLab);

  var reasonLab = h("label", "", t("compHandoffReasonPh"));
  var reasonInput = h("input", "");
  reasonInput.type = "text";
  reasonInput.placeholder = t("compHandoffReasonPh");
  reasonLab.appendChild(reasonInput);
  box.appendChild(reasonLab);

  var submit = h("button", "btn sm", t("goalHandoffSubmit"));
  submit.type = "button";
  submit.addEventListener("click", function(){
    if(!revInput.value.trim()){
      flashError(t("compHandoffRevisionRequired"));
      return;
    }
    if(!profileInput.value.trim()){
      flashError(t("compHandoffProfileRequired"));
      return;
    }
    if(!reasonInput.value.trim()){
      flashError(t("goalHandoffReasonRequired"));
      return;
    }
    var reusablePaths = pathsInput.value.split(",").map(function(p){ return p.trim(); }).filter(Boolean);
    if(!reusablePaths.length){
      flashError(t("goalHandoffReusableRequired"));
      return;
    }
    var remainingGaps;
    try {
      remainingGaps = JSON.parse(gapsInput.value.trim() || "[]");
    } catch (e) {
      flashError(t("goalHandoffGapsInvalid"));
      return;
    }
    if(!Array.isArray(remainingGaps) || !remainingGaps.length){
      flashError(t("goalHandoffGapsRequired"));
      return;
    }
    if(!window.confirm(t("goalHandoffConfirm"))) return;
    taskAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/goal-handoff", {
      candidateRevisionId: revInput.value.trim(),
      reusablePaths: reusablePaths,
      remainingGaps: remainingGaps,
      destinationWorkerProfileId: profileInput.value.trim(),
      reason: reasonInput.value.trim(),
      confirm: true
    }, submit, function(){ showTask(task.id); });
  });
  box.appendChild(hd("div", "actions mt-8", [submit]));
  return box;
}

function competitionDecisionControls(competitionId, candidates, selectedCandidateId, onDone){
  var list = Array.isArray(candidates) ? candidates : [];
  var box = h("div", "card form-card competition-main-controls");
  box.setAttribute("data-fl-role", "competition-main-controls");
  box.appendChild(h("div", "card-title mb-4", t("compMainActionTitle")));
  box.appendChild(h("div", "summary-line dim mb-8", t("compMainActionHint")));
  var candidateLabel = h("label", "", t("compMainCandidateLabel"));
  var candidateSelect = h("select", "");
  list.forEach(function(candidate){
    var optionEl = document.createElement("option");
    optionEl.value = String(candidate.candidateId || "");
    optionEl.textContent = String(candidate.providerName || "?") + "/" + String(candidate.modelName || "?")
      + " - " + statusLabel(candidate.taskStatus || "unknown");
    if(candidate.candidateId === selectedCandidateId) optionEl.selected = true;
    candidateSelect.appendChild(optionEl);
  });
  candidateLabel.appendChild(candidateSelect);
  box.appendChild(candidateLabel);
  var decisionLabel = h("label", "", t("taskReviewDecision"));
  var decisionSelect = h("select", "");
  [["accept", t("taskAccept")], ["revise", t("taskReviewRevise")], ["reject", t("taskReject")]].forEach(function(pair){
    var optionEl = document.createElement("option");
    optionEl.value = pair[0]; optionEl.textContent = pair[1]; decisionSelect.appendChild(optionEl);
  });
  decisionLabel.appendChild(decisionSelect);
  box.appendChild(decisionLabel);
  var reasonLabel = h("label", "", t("taskReviewReason"));
  var reasonInput = h("input", "");
  reasonInput.type = "text";
  reasonInput.placeholder = t("compMainReasonPh");
  reasonLabel.appendChild(reasonInput);
  box.appendChild(reasonLabel);
  var stateLine = h("div", "summary-line dim fs11");
  box.appendChild(stateLine);
  var submit = h("button", "btn sm primary", t("compMainSubmit"));
  submit.type = "button";
  function selectedCandidate(){
    return list.find(function(candidate){ return candidate.candidateId === candidateSelect.value; });
  }
  function sync(){
    var candidate = selectedCandidate();
    var reviewed = candidate && candidate.mainReviewDecision;
    if(reviewed === "accept" || reviewed === "revise" || reviewed === "reject"){
      decisionSelect.value = reviewed;
      stateLine.textContent = t("compMainReviewedReady", { decision: reviewDecisionLabel(reviewed) });
      submit.disabled = false;
    } else {
      stateLine.textContent = t("compMainReviewFirst");
      submit.disabled = true;
    }
  }
  candidateSelect.addEventListener("change", sync);
  sync();
  submit.addEventListener("click", function(){
    var candidate = selectedCandidate();
    if(!candidate){ flashError(t("compMainCandidateRequired")); return; }
    if(!reasonInput.value.trim()){ flashError(t("taskReviewReasonRequired")); return; }
    if(!window.confirm(t("compMainConfirm"))) return;
    taskAction("/api/ops/competitions/" + encodeURIComponent(competitionId) + "/main-decision", {
      candidateId: candidate.candidateId,
      decision: decisionSelect.value,
      reason: reasonInput.value.trim(),
      confirm: true
    }, submit, onDone);
  });
  box.appendChild(hd("div", "actions", [submit]));
  return box;
}

function correctionStatusLabel(status){
  var key = {
    pending: "taskCorrectStatusPending",
    running: "taskCorrectStatusRunning",
    succeeded: "taskCorrectStatusSucceeded",
    failed: "taskCorrectStatusFailed",
    interrupted: "taskCorrectStatusInterrupted"
  }[status] || "taskCorrectStatusPending";
  return t(key);
}

function renderCandidateReuse(task){
  var c = task.journey && task.journey.candidateReuse;
  if(!c) return null;
  var card = h("div", "card form-card candidate-reuse-card");
  card.setAttribute("data-fl-role", "candidate-reuse");
  card.appendChild(h("div", "card-title mb-4", t("taskCorrectJourneyTitle")));
  card.appendChild(h("div", "summary-line dim mb-8", t("taskCorrectJourneyIntro")));
  card.appendChild(h("div", "task-story-value-label", t("taskCorrectJourneyInput")));
  card.appendChild(h("div", "task-story-primary-value", c.feedback || t("taskCorrectJourneyInputMissing")));
  card.appendChild(h("div", "summary-line", t("taskCorrectJourneyReuse", {
    prior: c.priorAttemptOrdinal === undefined ? "-" : String(c.priorAttemptOrdinal),
    target: String(c.targetAttemptOrdinal)
  })));
  card.appendChild(h("div", "summary-line", t("taskCorrectJourneyOutcome", {
    status: correctionStatusLabel(c.status)
  })));
  card.appendChild(h("div", "summary-line", t("taskCorrectLimitValue", {
    remaining: String(c.remainingAllowance), total: String(c.totalAllowance)
  })));
  if(c.grossTokens !== undefined){
    card.appendChild(h("div", "summary-line", t("taskCorrectJourneyTokens", {
      tokens: Number(c.grossTokens).toLocaleString()
    })));
  }
  if(c.runtimeEstimateUsd !== undefined){
    card.appendChild(h("div", "summary-line", t("taskCorrectJourneyCost", {
      cost: Number(c.runtimeEstimateUsd).toFixed(6)
    })));
  }
  card.appendChild(h("div", "summary-line dim", t("taskCorrectJourneyNoSavingsClaim")));
  return card;
}

function reverificationStatusLabel(status){
  if(status === "no-candidate") return t("taskReverifyStatusNoCandidate");
  return status === "passed" ? t("taskReverifyStatusPassed") : t("taskReverifyStatusFailed");
}

function reverifyRejectionLabel(category){
  var map = {
    "task-not-failed": "taskReverifyRejectTaskNotFailed",
    "competition-candidate": "taskReverifyRejectCompetition",
    "running-attempt": "taskReverifyRejectRunning",
    "no-completed-attempt": "taskReverifyRejectNoAttempt",
    "no-failed-verification": "taskReverifyRejectNoVerification",
    "wrong-failure-category": "taskReverifyRejectWrongCategory",
    "missing-candidate-diff": "taskReverifyRejectNoDiff",
    "allowance-zero": "taskReverifyRejectAllowanceZero",
    "allowance-exhausted": "taskReverifyRejectAllowanceExhausted",
    "no-main-revise": "taskReverifyRejectNoMainRevise",
    "reviewed-revision-mismatch": "taskReverifyRejectReviewedRevisionMismatch",
    "already-integrated": "taskReverifyRejectAlreadyIntegrated",
    "runtime-not-started": "taskReverifyRejectRuntimeNotStarted",
    "runtime-auth-failed": "taskReverifyRejectRuntimeAuthFailed",
    "runtime-policy-limit": "taskReverifyRejectRuntimePolicyLimit"
  };
  return t(map[category] || "taskReverifyRejectTaskNotFailed");
}

function correctionRejectionLabel(category){
  var map = {
    "not-failed-or-interrupted": "taskCorrectRejectNotFailed",
    "competition-candidate": "taskCorrectRejectCompetition",
    "competition-main-revise-required": "taskCorrectRejectCompetitionMainRevise",
    "running-attempt": "taskCorrectRejectRunning",
    "no-revision": "taskCorrectRejectNoRevision",
    "no-latest-attempt-revision": "taskCorrectRejectNoLatestRevision",
    "empty-revision": "taskCorrectRejectEmptyRevision",
    "allowance-zero": "taskCorrectRejectAllowanceZero",
    "allowance-exhausted": "taskCorrectRejectAllowanceExhausted",
    "pending-incompatible-grant": "taskCorrectRejectPendingGrant",
    "stale-revision": "taskCorrectRejectStale",
    "no-main-revise": "taskCorrectRejectNoMainRevise"
  };
  return t(map[category] || "taskCorrectRejectNoRevision");
}

function judgeFailureLabel(code){
  var map = {
    "missing-result": "taskJudgeFailureMissing",
    "oversized": "taskJudgeFailureOversized",
    "malformed-json": "taskJudgeFailureMalformed",
    "stale-revision": "taskJudgeFailureStale",
    "wrong-identity": "taskJudgeFailureIdentity",
    "unsafe-content": "taskJudgeFailureUnsafe",
    "schema-violation": "taskJudgeFailureSchema",
    "extra-fields": "taskJudgeFailureExtraFields",
    "reviewer-task-failed": "taskJudgeFailureWorker"
  };
  return t(map[code] || "taskJudgeFailureUnknown");
}

function judgeNextActionLabel(graph){
  var map = {
    "wait-for-judge": "taskJudgeNextWait",
    "fresh-main-review-usable": "taskJudgeNextFreshUsable",
    "fresh-main-review-unusable": "taskJudgeNextFreshUnusable",
    "fresh-main-review-disagreement": "taskJudgeNextFreshDisagreement",
    "integrated": "taskJudgeNextIntegrated",
    "ready-for-integration": "taskJudgeNextIntegrate",
    "main-decision": "taskJudgeNextMainDecision"
  };
  var key = map[String(graph.nextActionCode || "")];
  return key ? t(key) : String(graph.nextAction || "");
}

function judgeAggregationLabel(state){
  var map = {
    "pending": "taskJudgeAggPending",
    "single-opinion": "taskJudgeAggSingle",
    "agreement": "taskJudgeAggAgreement",
    "disagreement": "taskJudgeAggDisagreement",
    "insufficient-evidence": "taskJudgeAggInsufficient"
  };
  var key = map[String(state || "")];
  return key ? t(key) : String(state || "");
}

/** Localized aggregation explanation from state + counts.
 * Never renders server English aggregation.explanation (CLI/MCP keep that field). */
function judgeAggregationExplanation(agg){
  if(!agg || typeof agg !== "object") return "";
  var state = String(agg.state || "");
  var total = Number(agg.total || 0);
  var pending = Number(agg.pending || 0);
  var usable = Number(agg.usable || 0);
  var unusable = Number(agg.unusable || 0);
  var dc = agg.dispositionCounts || {};
  var disposition = "unknown";
  if(Number(dc.accept || 0) > 0) disposition = "accept";
  else if(Number(dc.revise || 0) > 0) disposition = "revise";
  else if(Number(dc.reject || 0) > 0) disposition = "reject";
  if(state === "pending"){
    return total <= 1
      ? t("taskJudgeAggExplainPendingOne")
      : t("taskJudgeAggExplainPending", { pending: String(pending), total: String(total) });
  }
  if(state === "insufficient-evidence"){
    return total <= 1
      ? t("taskJudgeAggExplainInsufficientOne")
      : t("taskJudgeAggExplainInsufficient", { total: String(total) });
  }
  if(state === "single-opinion"){
    return unusable > 0
      ? t("taskJudgeAggExplainSinglePartial", {
          disposition: disposition,
          unusable: String(unusable)
        })
      : t("taskJudgeAggExplainSingle", { disposition: disposition });
  }
  if(state === "agreement"){
    return t("taskJudgeAggExplainAgreement", {
      usable: String(usable),
      disposition: disposition
    });
  }
  if(state === "disagreement"){
    return t("taskJudgeAggExplainDisagreement", {
      accept: String(dc.accept || 0),
      revise: String(dc.revise || 0),
      reject: String(dc.reject || 0)
    });
  }
  return "";
}

/** Explanation-first read-only multi-judge card. Never shows private packet paths,
 * raw patch, raw resultText, credentials, or absolute paths. */
function renderJudgeReviewCard(task){
  var card = h("div", "card form-card judge-review-card");
  card.setAttribute("data-fl-role", "judge-review");
  card.appendChild(h("div", "card-title mb-4", t("taskJudgeTitle")));
  card.appendChild(h("div", "summary-line dim mb-8", t("taskJudgeHint")));
  card.appendChild(h("div", "summary-line dim mb-8", t("taskJudgeMainDecides")));

  var graph = task.reviewGraph;
  if(graph && typeof graph === "object"){
    card.appendChild(h("div", "section-title", t("taskJudgeInput")));
    card.appendChild(h("div", "summary-line", t("taskJudgeRevision", {
      id: String(graph.candidateRevisionId || "").slice(0, 8),
      digest: String(graph.digestPrefix || "")
    })));
    card.appendChild(h("div", "summary-line dim", t("taskJudgeAttempt", {
      ordinal: String(graph.attemptOrdinal || ""),
      seq: String(graph.verificationEventSequence || "")
    })));
    card.appendChild(h("div", "summary-line", t("taskJudgeProgress", {
      status: String(graph.status || "unknown")
    })));
    var agg = graph.aggregation && typeof graph.aggregation === "object" ? graph.aggregation : null;
    if(agg){
      card.appendChild(h("div", "section-title mt-8", t("taskJudgeAggregateTitle")));
      card.appendChild(h("div", "summary-line", t("taskJudgeAggregateState", {
        state: judgeAggregationLabel(agg.state)
      })));
      card.appendChild(h("div", "summary-line dim", t("taskJudgeAggregateCounts", {
        total: String(agg.total || 0),
        usable: String(agg.usable || 0),
        unusable: String(agg.unusable || 0),
        pending: String(agg.pending || 0)
      })));
      var aggExplain = judgeAggregationExplanation(agg);
      if(aggExplain){
        card.appendChild(h("div", "summary-line", aggExplain));
      }
      var dc = agg.dispositionCounts || {};
      if((agg.usable || 0) > 0){
        card.appendChild(h("div", "summary-line dim", t("taskJudgeDispositionCounts", {
          accept: String(dc.accept || 0),
          revise: String(dc.revise || 0),
          reject: String(dc.reject || 0)
        })));
      }
    }
    if(graph.blocksIntegration){
      card.appendChild(h("div", "summary-line dim", t("taskJudgeBlocks")));
    }
    if(graph.requiresFreshMainReview){
      card.appendChild(h("div", "summary-line dim", t("taskJudgeFreshRequired")));
    }
    card.appendChild(h("div", "summary-line", t("taskJudgeNext", {
      action: judgeNextActionLabel(graph)
    })));

    var assignments = Array.isArray(graph.assignments) ? graph.assignments : [];
    assignments.forEach(function(a){
      if(!a || typeof a !== "object") return;
      card.appendChild(h("div", "section-title mt-8", t("taskJudgeWhoOrdinal", {
        ordinal: String(a.ordinal || ""),
        total: String((agg && agg.total) || assignments.length || 1)
      })));
      card.appendChild(h("div", "summary-line", t("taskJudgeProfile", {
        id: String(a.reviewerWorkerProfileId || "")
      })));
      var id = a.frozenIdentity || {};
      card.appendChild(h("div", "summary-line dim", t("taskJudgeIdentity", {
        provider: String(id.provider || ""),
        model: String(id.model || ""),
        runtime: String(id.runtime || ""),
        effort: String(id.effort || "")
      })));
      if(task.provider && id.provider && String(task.provider) === String(id.provider)
        && task.model && id.model && String(task.model) === String(id.model)){
        card.appendChild(h("div", "summary-line dim", t("taskJudgeSameProfileNote")));
      }
      card.appendChild(h("div", "summary-line dim",
        t("taskJudgeReviewerStatus", {
          taskId: String(a.reviewerTaskId || ""),
          status: String(a.status || "")
        })
      ));
      if(a.resultUsable && a.result){
        card.appendChild(h("div", "summary-line", t("taskJudgeUsable")));
        card.appendChild(h("div", "summary-line", t("taskJudgeSuggestion", {
          disposition: String(a.result.proposedDisposition || "")
        })));
        if(a.result.summary){
          card.appendChild(h("div", "summary-line", t("taskJudgeSummary") + ": " + String(a.result.summary)));
        }
        var findings = Array.isArray(a.result.findings) ? a.result.findings : [];
        card.appendChild(h("div", "summary-line", t("taskJudgeFindings", {
          count: String(findings.length)
        })));
        if(findings.length === 0){
          card.appendChild(h("div", "summary-line dim", t("taskJudgeNoFindings")));
        } else {
          findings.forEach(function(f){
            card.appendChild(h("div", "summary-line dim", t("taskJudgeFindingLine", {
              severity: String(f.severity || ""),
              path: String(f.evidencePath || ""),
              behavior: String(f.affectedBehavior || ""),
              recommendation: String(f.recommendation || "")
            })));
          });
        }
      } else if(a.failureCode){
        card.appendChild(h("div", "summary-line", t("taskJudgeUnusable")));
        card.appendChild(h("div", "summary-line", judgeFailureLabel(String(a.failureCode))));
        card.appendChild(h("div", "summary-line dim", t("taskJudgeFailureSafe")));
        card.appendChild(h("div", "summary-line dim", t("taskJudgeFailureCode", {
          code: String(a.failureCode)
        })));
      }
    });
    return card;
  }

  // No graph yet: offer explicit multi-select create controls when Worker Profiles exist.
  card.appendChild(h("div", "summary-line dim mb-8", t("taskJudgeNone")));
  var profiles = (S.hub && S.hub.workerProfiles && S.hub.workerProfiles.profiles) || [];
  if(profiles.length === 0){
    return card;
  }
  card.appendChild(h("div", "summary-line dim mb-8", t("taskJudgeSelectHint")));
  var profileBox = h("div", "judge-profile-list");
  profileBox.setAttribute("data-fl-role", "judge-profile-list");
  var profileChecks = [];
  profiles.forEach(function(p){
    if(!p || !p.id) return;
    var row = h("label", "summary-line");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = String(p.id);
    cb.setAttribute("data-fl-role", "judge-profile");
    cb.setAttribute("data-profile-id", String(p.id));
    row.appendChild(cb);
    row.appendChild(document.createTextNode(
      " " + String(p.label || p.id) + " (" + String(p.id) + ")"
    ));
    profileBox.appendChild(row);
    profileChecks.push(cb);
  });
  card.appendChild(profileBox);
  var reasonLab = h("label", "", t("taskJudgeReason"));
  var reasonIn = h("input", "");
  reasonIn.type = "text";
  reasonIn.setAttribute("data-fl-role", "judge-reason");
  reasonIn.placeholder = t("taskJudgeReasonPh");
  reasonLab.appendChild(reasonIn);
  card.appendChild(reasonLab);
  var assignBtn = h("button", "btn sm", t("taskJudgeAssign"));
  assignBtn.type = "button";
  assignBtn.setAttribute("data-fl-role", "judge-assign");
  assignBtn.addEventListener("click", function(){
    if(!reasonIn.value.trim()){ flashError(t("taskJudgeReasonRequired")); return; }
    var selected = profileChecks
      .filter(function(cb){ return cb.checked; })
      .map(function(cb){ return cb.value; });
    if(selected.length < 1 || selected.length > 3){
      flashError(t("taskJudgeSelectCount"));
      return;
    }
    if(!window.confirm(t("taskJudgeConfirm"))) return;
    var body = {
      reviewerWorkerProfileIds: selected,
      reason: reasonIn.value.trim(),
      confirm: true
    };
    if(selected.length === 1){
      body.reviewerWorkerProfileId = selected[0];
    }
    taskAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/review-graph", body, assignBtn, function(){ showTask(task.id); });
  });
  card.appendChild(hd("div", "actions", [assignBtn]));
  return card;
}

/* Candidate reverification journey: a verification-only rerun of the retained
 * candidate. Kept separate from candidateReuse (which launches a Worker) so
 * the retained Attempt is never confused with a Worker correction. */
function renderCandidateReverification(task){
  var rv = task.journey && task.journey.candidateReverification;
  if(!rv) return null;
  var card = h("div", "card form-card candidate-reverification-card");
  card.setAttribute("data-fl-role", "candidate-reverification");
  card.appendChild(h("div", "card-title mb-4", t("taskReverifyJourneyTitle")));
  card.appendChild(h("div", "summary-line dim mb-8", rv.path === "runtime-workspace"
    ? t("taskReverifyRuntimeJourneyIntro")
    : t("taskReverifyJourneyIntro")));
  card.appendChild(h("div", "summary-line", t("taskReverifyJourneyOutcome", {
    status: reverificationStatusLabel(rv.status)
  })));
  card.appendChild(h("div", "summary-line", t("taskReverifyJourneyCommands", {
    passed: String(rv.passedCommandCount),
    count: String(rv.commandCount),
    duration: String(rv.commandDurationMs)
  })));
  card.appendChild(h("div", "summary-line", t("taskReverifyJourneyZeroWorker")));
  card.appendChild(h("div", "summary-line dim", t("taskReverifyJourneyNotFree")));
  if(rv.status === "passed"){
    card.appendChild(h("div", "summary-line dim", t("taskReverifyJourneyFreshAccept")));
  }
  card.appendChild(h("div", "summary-line", t("taskReverifyLimitValue", {
    remaining: String(rv.allowance.remaining),
    total: String(rv.allowance.max),
    source: rv.allowance.source
  })));
  return card;
}

/* Explain retained Candidate evidence without turning it into a Main decision.
 * The backend has already proved whether the immutable revision still matches
 * the Task Diff; this renderer only separates retention, machine checks, Main
 * handling, and final delivery in plain language. */
function renderRetainedCandidate(task){
  var rc = task.journey && task.journey.retainedCandidate;
  if(!rc) return null;
  var card = h("div", "card form-card retained-candidate-card");
  card.setAttribute("data-fl-role", "retained-candidate");
  card.appendChild(h("div", "card-title mb-4", t("retainedCandidateTitle")));
  if(rc.status !== "available"){
    card.appendChild(h("div", "summary-line dim", t("retainedCandidateUnavailableBody")));
    return card;
  }
  card.appendChild(h("div", "summary-line mb-8", t("retainedCandidateAvailableBody", {
    ordinal: String(rc.attemptOrdinal),
    files: String(rc.filesChanged),
    lines: String(rc.changedLines),
    count: String(rc.affectedPathCount),
    passed: rc.verificationPassed
      ? t("retainedCandidateMachinePassed")
      : t("retainedCandidateMachineFailed")
  })));
  var finalDelivery = task.journey && task.journey.finalDelivery || {};
  var mainDecision = finalDelivery.mainReview && finalDelivery.mainReview.decision;
  var noteKey = "retainedCandidatePendingNote";
  if(hasVerifiedFinalDelivery(task)) noteKey = "retainedCandidateRepairedNote";
  else if(mainDecision === "revise") noteKey = "retainedCandidateReviseNote";
  else if(mainDecision === "reject") noteKey = "retainedCandidateRejectedNote";
  else if(mainDecision === "accept") noteKey = "retainedCandidateAcceptedNote";
  card.appendChild(h("div", "summary-line dim mb-8", t(noteKey)));
  if(rc.affectedPaths && rc.affectedPaths.length){
    card.appendChild(h("div", "task-story-value-label", t("retainedCandidatePathsLabel")));
    var list = h("div", "task-report-process");
    rc.affectedPaths.forEach(function(candidatePath){
      list.appendChild(h("div", "mono fs11", String(candidatePath)));
    });
    card.appendChild(list);
    if(rc.affectedPathCount > rc.affectedPaths.length){
      card.appendChild(h("div", "summary-line dim fs11", t("storyMoreItems", {
        count: String(rc.affectedPathCount - rc.affectedPaths.length)
      })));
    }
  }
  return card;
}

/* Attention-resolution story: how a handled failure was closed, why Main
 * considered it handled, and the optional successor/evidence Task. The
 * original failure explanation is preserved in the Cause section below. */
function renderAttentionResolutionSection(task, j){
  if(!j || !j.resolution) return null;
  var resolution = j.resolution;
  var section = h("div", "journey-section attention-resolution-section");
  section.setAttribute("data-fl-role", "journey-resolution");
  section.appendChild(h("div", "journey-section-title", t("journeyResolution")));
  var body = h("div", "journey-section-body");
  var whatRow = h("div", "task-story-row");
  whatRow.setAttribute("data-fl-role", "resolution-what");
  whatRow.appendChild(h("div", "task-story-label", t("journeyWhatLabel")));
  whatRow.appendChild(h("div", "task-story-value",
    resolution.status === "resolved"
      ? t("attentionResolvedWhat", {
          reason: attentionResolutionReasonLabel(resolution.reason || "handled-elsewhere")
        })
      : t("attentionReopenedWhat")));
  body.appendChild(whatRow);
  if(resolution.note){
    var whyRow = h("div", "task-story-row");
    whyRow.setAttribute("data-fl-role", "resolution-note");
    whyRow.appendChild(h("div", "task-story-label", t("journeyWhyLabel")));
    whyRow.appendChild(h("div", "task-story-value", resolution.note));
    body.appendChild(whyRow);
  }
  if(resolution.evidenceTaskId){
    var evRow = h("div", "task-story-row");
    evRow.setAttribute("data-fl-role", "resolution-evidence");
    evRow.appendChild(h("div", "task-story-label", t("attentionResolvedEvidenceLabel")));
    var evBtn = h("button", "btn sm", t("attentionResolvedEvidenceOpen"));
    evBtn.type = "button";
    evBtn.addEventListener("click", function(){ showTask(resolution.evidenceTaskId); });
    evRow.appendChild(evBtn);
    body.appendChild(evRow);
  }
  if(resolution.status === "resolved" && resolution.resolvedAt){
    body.appendChild(h("div", "dim fs11", t("attentionResolvedAt", {
      time: fmtTm(resolution.resolvedAt)
    })));
  }
  if(resolution.status === "reopened" && resolution.reopenedAt){
    body.appendChild(h("div", "dim fs11", t("attentionReopenedAt", {
      time: fmtTm(resolution.reopenedAt)
    })));
  }
  section.appendChild(body);
  return section;
}

/* Plain-language current verified-delivery stage from the server's canonical
 * deliveryJourney codes. The browser translates closed codes only. */
function deliveryJourneyStageText(dj){
  if(!dj || !dj.stage) return t("journeyStageUnknown");
  if(dj.stage === "repairing" && dj.repair){
    return t("journeyStageRepairing", {
      round: String(dj.repair.round),
      total: String(dj.repair.total)
    });
  }
  var key = {
    implementing: "journeyStageImplementing",
    "worker-finished": "journeyStageWorkerFinished",
    verifying: "journeyStageVerifying",
    repairing: "journeyStageRepairing",
    "awaiting-main-review": "journeyStageAwaitingMainReview",
    "main-accepted": "journeyStageMainAccepted",
    stopped: "journeyStageStopped",
    queued: "journeyStageQueued",
    unknown: "journeyStageUnknown"
  }[dj.stage];
  return t(key || "journeyStageUnknown");
}
function deliveryJourneyActorText(dj){
  if(!dj || !dj.nextActor) return "";
  var key = {
    worker: "journeyActorWorker",
    verifier: "journeyActorVerifier",
    main: "journeyActorMain",
    user: "journeyActorUser",
    none: "journeyActorNone"
  }[dj.nextActor];
  return key ? t(key) : "";
}
/* Plain-language label for a closed repair stop reason (no internal
 * vocabulary by default). */
function repairStopReasonLabel(reason){
  if(!reason) return "";
  var key = {
    "eligible": "journeyRepairReasonEligible",
    "allowance-disabled": "journeyRepairReasonAllowanceDisabled",
    "allowance-exhausted": "journeyRepairReasonAllowanceExhausted",
    "round-in-progress": "journeyRepairReasonRoundInProgress",
    "conflicting-history": "journeyRepairReasonConflictingHistory",
    "worker-did-not-return-normally": "journeyRepairReasonWorkerNotNormal",
    "non-behavior-failure": "journeyRepairReasonNonBehavior",
    "contract-infeasible": "journeyRepairReasonContractInfeasible",
    "verification-infrastructure": "journeyRepairReasonVerificationInfrastructure",
    "candidate-missing": "journeyRepairReasonCandidateMissing",
    "candidate-not-bound": "journeyRepairReasonCandidateNotBound",
    "source-failed": "journeyRepairReasonSourceFailed",
    "policy-failed": "journeyRepairReasonPolicyFailed",
    "no-changed-evidence": "journeyRepairReasonNoChangedEvidence",
    "runtime-not-resumable": "journeyRepairReasonRuntimeNotResumable",
    "repeated-evidence": "journeyRepairReasonRepeatedEvidence",
    "verification-passed": "journeyRepairReasonVerificationPassed"
  }[reason];
  return key ? t(key) : t("journeyRepairReasonUnknown");
}
function repairRoundStateLabel(state, terminalOutcome){
  if(state === "terminal"){
    return t(terminalOutcome === "passed"
      ? "journeyRepairOutcomePassed"
      : terminalOutcome === "stopped"
        ? "journeyRepairOutcomeStopped"
        : "journeyRepairOutcomeFailed");
  }
  return t(state === "started" ? "journeyRepairRoundStateStarted" : "journeyRepairRoundStateAuthorized");
}
function repairSourceLabel(source){
  return t(source === "task"
    ? "journeyRepairSourceTask"
    : source === "worker"
      ? "journeyRepairSourceWorker"
      : "journeyRepairSourceGlobal");
}
function repairAllowanceValueText(vr){
  if(!vr || !vr.enabled) return t("journeyRepairValueOff");
  return t("journeyRepairValueCount", { count: String(vr.allowance.max) });
}
/* Finite validation-repair journey section. Primary copy is plain language;
 * exact round/event facts stay inside progressive technical disclosure. */
function renderValidationRepairSection(task, j){
  var vr = j && j.validationRepair;
  if(!vr) return null;
  var section = h("div", "journey-section");
  section.setAttribute("data-fl-role", "journey-repair");
  section.appendChild(h("div", "journey-section-title", t("journeyRepairTitle")));
  var body = h("div", "journey-section-body");
  body.appendChild(h("div", "summary-line",
    t("journeyRepairAllowance", {
      value: repairAllowanceValueText(vr),
      source: repairSourceLabel(vr.allowance.source)
    })));
  var stopped = task.status === "failed" || task.status === "interrupted";
  if(vr.inProgress){
    var activeRound = (vr.rounds || []).filter(function(r){ return r.state !== "terminal"; })[0];
    body.appendChild(h("div", "journey-field journey-repair-active",
      t("journeyRepairInProgress", {
        round: String(activeRound ? activeRound.round : vr.allowance.consumed + 1),
        total: String(vr.allowance.max)
      })));
  } else if(vr.allowance.consumed > 0 && vr.allowance.remaining === 0){
    body.appendChild(h("div", "summary-line dim", t("journeyRepairExhausted", {
      total: String(vr.allowance.max)
    })));
  } else if(vr.allowance.consumed > 0){
    body.appendChild(h("div", "summary-line dim", t("journeyRepairConsumed", {
      consumed: String(vr.allowance.consumed),
      total: String(vr.allowance.max)
    })));
  } else if(!vr.enabled && stopped){
    body.appendChild(h("div", "summary-line dim", t("journeyRepairDisabled")));
  }
  if(vr.skipped && vr.skipped.length){
    vr.skipped.forEach(function(s){
      body.appendChild(h("div", "summary-line dim journey-repair-skipped",
        t("journeyRepairSkipped", { reason: repairStopReasonLabel(s.reason) })));
    });
  }
  if(vr.rounds && vr.rounds.length){
    var roundsBody = h("div", "journey-check-list");
    vr.rounds.forEach(function(r){
      var rrow = h("div", "journey-check-row");
      rrow.appendChild(h("span", "badge " + (
        r.state === "terminal"
          ? (r.terminalOutcome === "passed" ? "badge-ok" : "badge-err")
          : "badge-info"
      ), repairRoundStateLabel(r.state, r.terminalOutcome)));
      rrow.appendChild(document.createTextNode("  " + t("journeyRepairRoundLabel", {
        round: String(r.round),
        ordinal: String(r.targetAttemptOrdinal !== undefined ? r.targetAttemptOrdinal : "?")
      })));
      if(r.terminalReason){
        rrow.appendChild(document.createTextNode("  " + repairStopReasonLabel(r.terminalReason)));
      }
      if(r.authorizationEventSequence !== undefined){
        rrow.appendChild(document.createTextNode("  " + t("journeyRepairEventSequence", {
          sequence: String(r.authorizationEventSequence)
        })));
      }
      roundsBody.appendChild(rrow);
    });
    body.appendChild(journeyDisclosure(t("journeyRepairDetails"), roundsBody));
  }
  section.appendChild(body);
  return section;
}

/* Collaboration journey renderer: presents the Task as a readable
 * Main-to-Worker process in evidence order. Each section is backed by
 * the safe journey projection from the server - never raw prompts,
 * diffs, logs, or credentials. Worker claims carry an explicit
 * unverified marker. What and why are always separate sentences. */
function renderTaskJourney(task){
  var j = task.journey;
  var panel = h("div", "card form-card task-journey");
  panel.setAttribute("data-fl-role", "task-journey");
  panel.appendChild(h("div", "card-title mb-4", t("journeyTitle")));

  // Show the current verified-delivery stage (plain language) before history,
  // inputs, evidence, and outcomes. The live stage stays as a secondary
  // technical disclosure so internal runtime vocabulary is not the default.
  var current = h("div", "journey-section");
  current.setAttribute("data-fl-role", "journey-current");
  current.appendChild(h("div", "journey-section-title", t("journeyCurrentState")));
  var dj = j && j.deliveryJourney;
  var detailLive = taskLiveStage(task);
  if(dj && dj.stage){
    current.appendChild(h("div", "journey-section-body journey-field journey-delivery-stage",
      deliveryJourneyStageText(dj)));
    var actorText = deliveryJourneyActorText(dj);
    if(actorText){
      current.appendChild(h("div", "dim fs11 journey-delivery-actor", actorText));
    }
    if(dj.stage === "repairing" && dj.repair){
      current.appendChild(h("div", "dim fs11", t("journeyStageRepairHint")));
    }
    if(detailLive){
      current.appendChild(journeyDisclosure(t("journeyStageLiveDetail"),
        h("div", "journey-field dim", liveStageDetailText(detailLive))));
    }
  } else {
    current.appendChild(h("div", "journey-section-body journey-field",
      detailLive ? liveStageDetailText(detailLive) : taskProgressSummary(task)));
  }
  var currentProgress = task.progress || (task.decision && task.decision.progress);
  var detailDual = dualClockPlainText(currentProgress);
  if(detailDual){
    current.appendChild(h("div", "dim fs11", detailDual));
    var detailDualNext = dualClockNextText(currentProgress);
    if(detailDualNext) current.appendChild(h("div", "dim fs11", detailDualNext));
  } else if(currentProgress && currentProgress.lastEventAt){
    current.appendChild(h("div", "dim fs11", t("taskLastUpdate", {
      time: fmtSince(currentProgress.lastEventAt)
    })));
  }
  panel.appendChild(current);

  // 1. Main input
  var assignment = h("div", "journey-section");
  assignment.setAttribute("data-fl-role", "journey-assignment");
  assignment.appendChild(h("div", "journey-section-title", t("journeyAssignment")));
  if(j && j.assignment){
    var a = j.assignment;
    var aBody = h("div", "journey-section-body");
    var assignmentDetailsBody = h("div", "journey-disclosure-body");
    if(a.contractVersion === 2){
      if(a.outcome){
        aBody.appendChild(h("div", "journey-list-label", t("journeyOutcome")));
        aBody.appendChild(h("div", "journey-field journey-outcome", a.outcome));
      }
      appendJourneyList(assignmentDetailsBody, "journeyInScope", a.inScope, false);
      appendJourneyList(assignmentDetailsBody, "journeyOutOfScope", a.outOfScope, false);
      appendJourneyList(assignmentDetailsBody, "journeyExecutionSteps", a.executionSteps, false);
      appendJourneyList(assignmentDetailsBody, "journeyDeliverables", a.deliverables, false);
      appendJourneyList(assignmentDetailsBody, "journeyFocusPaths", a.focusPaths, true);
      appendJourneyList(assignmentDetailsBody, "journeyAcceptanceCriteria", a.acceptanceCriteria, false);
      appendJourneyList(assignmentDetailsBody, "journeyAcceptanceCommands", a.acceptanceCommands, true);
    } else {
      if(a.goal || a.outcome){
        aBody.appendChild(h("div", "journey-list-label", t("journeyOutcome")));
        aBody.appendChild(h("div", "journey-field journey-outcome", a.goal || a.outcome || ""));
      }
      appendJourneyList(assignmentDetailsBody, "journeyConstraints", a.constraints, false);
      appendJourneyList(assignmentDetailsBody, "journeyAcceptanceCommands", a.acceptanceCommands, true);
    }
    // The Main-authored summary language is secondary metadata: keep it in
    // the closed assignment disclosure, not as a prominent code in the story.
    if(a.presentation && typeof a.presentation.language === "string" && a.presentation.language){
      assignmentDetailsBody.appendChild(h("div", "journey-list-label", t("journeyPresentationLanguage")));
      assignmentDetailsBody.appendChild(h("div", "journey-field dim", presentationLanguageLabel(a.presentation.language)));
    }
    if(assignmentDetailsBody.childNodes.length){
      aBody.appendChild(h("div", "summary-line dim fs11", t("journeyAssignmentSummary")));
      aBody.appendChild(journeyDisclosure(t("journeyAssignmentDetails"), assignmentDetailsBody));
    }
    assignment.appendChild(aBody);
  } else {
    assignment.appendChild(h("div", "summary-line dim", t("journeyNoAssignment")));
  }
  panel.appendChild(assignment);

  // 2. Worker execution
  var workerExec = h("div", "journey-section");
  workerExec.setAttribute("data-fl-role", "journey-worker");
  workerExec.appendChild(h("div", "journey-section-title", t("journeyWorkerExecution")));
  var weBody = h("div", "journey-section-body");
  if(j && j.workerExecution){
    var we = j.workerExecution;
    weBody.appendChild(h("div", "journey-list-label", t("journeyWorkerIdentity")));
    weBody.appendChild(h("div", "journey-field", t("journeyWorkerIdentitySentence", {
      provider: providerDisplayName(we.provider), model: we.model || "?",
      runtime: runtimeDisplayName(we.runtime)
    })));
    if(we.workerClaim){
      var claimRow = h("div", "journey-claim");
      claimRow.setAttribute("data-fl-role", "worker-claim");
      claimRow.appendChild(h("div", "badge badge-warn journey-claim-badge", t("journeyWorkerClaimLabel")));
      var claimSummaryKey = hasVerifiedFinalDelivery(task)
        ? "journeyWorkerClaimRepairedSummary"
        : (j.independentVerification && j.independentVerification.conclusion === "failed")
          ? "journeyWorkerClaimFailedSummary" : "journeyWorkerClaimSummary";
      claimRow.appendChild(h("div", "journey-claim-summary", t(claimSummaryKey)));
      var claimDetailsBody = h("div", "journey-claim-text", we.workerClaim.text);
      claimRow.appendChild(journeyDisclosure(t("journeyWorkerClaimDetails"), claimDetailsBody));
      weBody.appendChild(claimRow);
    } else {
      weBody.appendChild(h("div", "summary-line dim", t("journeyNoWorkerClaim")));
    }
    if(we.attempts && we.attempts.length){
      we.attempts.forEach(function(att){
        var attempt = h("div", "journey-attempt");
        attempt.appendChild(h("div", "journey-list-label",
          t("journeyAttemptLabel", { ordinal: String(att.ordinal) })));
        var turns = att.turns === undefined ? "" : t("journeyTurns", { count: String(att.turns) });
        var exit = att.exitCode === undefined || att.exitCode === 0
          ? "" : t("journeyExitCode", { code: String(att.exitCode) });
        attempt.appendChild(h("div", "summary-line",
          t("journeyAttemptFacts", { status: attemptPrimaryLabel(att), turns: turns, exit: exit })));
        var attemptExplain = attemptPresentationExplain(att);
        if(attemptExplain){
          attempt.appendChild(h("div", "summary-line dim", attemptExplain));
        }
        if(attemptHasClosedPresentation(att)){
          attempt.appendChild(h("div", "dim fs11", t("journeyAttemptRecordedStatus", {
            status: attemptStateLabel(att.status)
          })));
        }
        if(att.startedAt) attempt.appendChild(h("div", "dim fs11", t("journeyStartedAt", { time: fmtTm(att.startedAt) })));
        if(att.finishedAt) attempt.appendChild(h("div", "dim fs11", t("journeyFinishedAt", { time: fmtTm(att.finishedAt) })));
        weBody.appendChild(attempt);
      });
    } else {
      weBody.appendChild(h("div", "summary-line dim", t("journeyNoAttempts")));
    }
    if(we.changedFilePaths && we.changedFilePaths.length){
      var changedList = h("div", "journey-list");
      we.changedFilePaths.forEach(function(file){
        changedList.appendChild(h("div", "journey-list-item mono dim", file));
      });
      weBody.appendChild(journeyDisclosure(
        t("journeyChangedFilesDetails", { count: String(we.changedFilePaths.length) }),
        changedList
      ));
    } else {
      weBody.appendChild(h("div", "summary-line dim fs11 mt-4", t("journeyNoChangedFiles")));
    }
  } else {
    weBody.appendChild(h("div", "summary-line dim", t("journeyNoAttempts")));
  }
  workerExec.appendChild(weBody);
  panel.appendChild(workerExec);

  // 3. Independent verification
  var verif = h("div", "journey-section");
  verif.setAttribute("data-fl-role", "journey-verification");
  verif.appendChild(h("div", "journey-section-title", t("journeyVerification")));
  var vBody = h("div", "journey-section-body");
  if(j && j.independentVerification && j.independentVerification.available){
    var iv = j.independentVerification;
    var conclusion = iv.conclusion === "passed"
      ? t("journeyVerifPassed")
      : t("journeyVerifFailedCount", {
          failed: String(iv.failedCount || 0), total: String(iv.totalCount || 0)
        });
    vBody.appendChild(h("div", "journey-field", conclusion));
    if(iv.checks && iv.checks.length){
      var failedChecks = iv.checks.filter(function(chk){ return !chk.passed; });
      if(failedChecks.length){
        vBody.appendChild(h("div", "journey-list-label", t("journeyFailedChecksTitle")));
        vBody.appendChild(h("div", "summary-line dim", t("journeyFailedChecksHint")));
        var failedBody = h("div", "journey-check-list journey-failed-checks");
        failedChecks.forEach(function(chk){
          var failedRow = h("div", "journey-check-row journey-check-row-primary");
          failedRow.setAttribute("data-fl-role", "verification-failure-summary");
          failedRow.appendChild(h("span", "badge badge-err", t("journeyCheckFailed")));
          failedRow.appendChild(document.createTextNode("  " + readableVerificationCheckLabel(chk.label)));
          failedBody.appendChild(failedRow);
        });
        vBody.appendChild(failedBody);
      }
      var checksBody = h("div", "journey-check-list");
      iv.checks.forEach(function(chk){
        var chkRow = h("div", "journey-check-row");
        chkRow.setAttribute("data-fl-role", "verification-check");
        chkRow.appendChild(h("span", "badge " + (chk.passed ? "badge-ok" : "badge-err"),
          chk.passed ? t("journeyCheckPassed") : t("journeyCheckFailed")));
        var readableLabel = readableVerificationCheckLabel(chk.label);
        chkRow.appendChild(document.createTextNode("  " + readableLabel));
        if(!chk.passed && chk.exitCode !== undefined && chk.exitCode !== 0){
          chkRow.appendChild(document.createTextNode("  " + t("journeyCheckExitCode", {
            code: String(chk.exitCode)
          })));
        }
        if(chk.label){
          chkRow.appendChild(h("div", "verification-command mono dim fs11", chk.label));
        }
        checksBody.appendChild(chkRow);
      });
      vBody.appendChild(journeyDisclosure(t("journeyVerificationDetails"), checksBody));
    }
  } else {
    vBody.appendChild(h("div", "summary-line dim", t("journeyVerifUnavailable")));
  }
  verif.appendChild(vBody);
  panel.appendChild(verif);

  // 3b. Finite validation-repair (allowance, in-progress round, exhausted or
  // ineligible stop). Only rendered when canonical repair evidence exists.
  var repairSection = renderValidationRepairSection(task, j);
  if(repairSection) panel.appendChild(repairSection);

  // 4. Final delivery
  var delivery = h("div", "journey-section");
  delivery.setAttribute("data-fl-role", "journey-delivery");
  delivery.appendChild(h("div", "journey-section-title", t("journeyDelivery")));
  var dBody = h("div", "journey-section-body");
  var outputCount = j && j.workerExecution && Array.isArray(j.workerExecution.changedFilePaths)
    ? j.workerExecution.changedFilePaths.length : 0;
  var verificationConclusion = j && j.independentVerification
    ? j.independentVerification.conclusion : "not-run";
  dBody.appendChild(h("div", "journey-list-label", t("journeyFinalOutputLabel")));
  if(hasVerifiedFinalDelivery(task)){
    dBody.appendChild(h("div", "journey-field journey-delivery-success",
      t("journeyFinalOutputRepairedDelivered", { count: String(outputCount) })));
  } else if(outputCount > 0 && verificationConclusion === "passed"){
    dBody.appendChild(h("div", "journey-field", t("journeyFinalOutputVerified", {
      count: String(outputCount)
    })));
  } else if(outputCount > 0 && verificationConclusion === "failed"){
    dBody.appendChild(h("div", "journey-field", t("journeyFinalOutputRejected", {
      count: String(outputCount)
    })));
  } else if(outputCount > 0){
    dBody.appendChild(h("div", "journey-field", t("journeyFinalOutputPending", {
      count: String(outputCount)
    })));
  } else {
    dBody.appendChild(h("div", "summary-line dim", t("journeyFinalOutputNone")));
  }
  if(j && j.finalDelivery){
    var fd = j.finalDelivery;
    var hasDelivery = false;
    if(fd.mainReview){
      hasDelivery = true;
      dBody.appendChild(h("div", "journey-field",
        t("journeyDeliveryMainReview") + ": " + reviewDecisionLabel(fd.mainReview.decision)));
      if(fd.mainReview.reason){
        dBody.appendChild(journeyDisclosure(
          t("journeyDeliveryMainReviewDetails"),
          h("div", "summary-line dim", fd.mainReview.reason)
        ));
      }
    }
    if(fd.remediationDisposition){
      hasDelivery = true;
      var amendedBasis = fd.remediationDisposition.acceptanceBasis === "amended-acceptance";
      dBody.appendChild(h("div", "journey-field",
        t("journeyDeliveryDisposition") + ": "
          + (amendedBasis ? t("journeyRemediationAmended") : t("journeyRemediationDelivered"))));
    }
    if(fd.integration){
      hasDelivery = true;
      dBody.appendChild(h("div", "journey-field",
        t("journeyDeliveryIntegration") + ": " + integrationStateLabel(fd.integration.status)));
    }
    if(!hasDelivery) dBody.appendChild(h("div", "summary-line dim", t("journeyDeliveryNone")));
  } else {
    dBody.appendChild(h("div", "summary-line dim", t("journeyDeliveryNone")));
  }
  delivery.appendChild(dBody);
  panel.appendChild(delivery);

  // 5. Attention resolution (how the handled failure was closed). The
  // original failure explanation stays in the Cause section below it.
  var resolutionSection = renderAttentionResolutionSection(task, j);
  if(resolutionSection) panel.appendChild(resolutionSection);

  // 6. Cause (what happened + why, always separate)
  var cause = h("div", "journey-section");
  cause.setAttribute("data-fl-role", "journey-cause");
  cause.appendChild(h("div", "journey-section-title", t("journeyCause")));
  var cBody = h("div", "journey-section-body");
  if(j && j.cause){
    var c = j.cause;
    var repairedDelivery = hasVerifiedFinalDelivery(task);
    var amendedDelivery = !!(repairedDelivery
      && j.finalDelivery
      && j.finalDelivery.remediationDisposition
      && j.finalDelivery.remediationDisposition.acceptanceBasis === "amended-acceptance");
    var machinePassedBeforeRepair = task.status === "succeeded" || task.status === "completed";
    var whatText = repairedDelivery
      ? (amendedDelivery
        ? t("journeyCauseWhatAmended")
        : (machinePassedBeforeRepair
          ? t("journeyCauseWhatRepairedAfterMachinePass")
          : t("journeyCauseWhatRepaired")))
      : resolveCauseWhat(c.what);
    var whyText = repairedDelivery
      ? (amendedDelivery
        ? t("journeyCauseWhyAmended")
        : (machinePassedBeforeRepair
          ? t("journeyCauseWhyRepairedAfterMachinePass")
          : t("journeyCauseWhyRepaired")))
      : resolveCauseWhy(
      c.what,
      c.why,
      c.failureCategory,
      j.finalDelivery && j.finalDelivery.mainReview && j.finalDelivery.mainReview.decision
    );
    var whatRow = h("div", "task-story-row");
    whatRow.setAttribute("data-fl-role", "cause-what");
    whatRow.appendChild(h("div", "task-story-label", t("journeyWhatLabel")));
    whatRow.appendChild(h("div", "task-story-value", whatText));
    cBody.appendChild(whatRow);
    var whyRow = h("div", "task-story-row");
    whyRow.setAttribute("data-fl-role", "cause-why");
    whyRow.appendChild(h("div", "task-story-label", t("journeyWhyLabel")));
    whyRow.appendChild(h("div", "task-story-value", whyText));
    cBody.appendChild(whyRow);
    if(c.failureCategory && !repairedDelivery){
      var catRow = h("div", "task-story-row");
      catRow.setAttribute("data-fl-role", "cause-category");
      catRow.appendChild(h("div", "task-story-label", t("journeyCategoryLabel")));
      catRow.appendChild(h("div", "task-story-value", failureCategoryLabel(c.failureCategory)));
      cBody.appendChild(catRow);
    }
  }
  cause.appendChild(cBody);
  panel.appendChild(cause);

  // 6. Next action
  var next = h("div", "journey-section");
  next.setAttribute("data-fl-role", "journey-next");
  next.appendChild(h("div", "journey-section-title", t("journeyNext")));
  if(hasVerifiedFinalDelivery(task)){
    next.appendChild(h("div", "journey-section-body", t("journeyNextDone")));
  } else if(j && j.resolution && j.resolution.status === "resolved"){
    // A handled failure is closed attention: the one next action is Reopen.
    next.appendChild(h("div", "journey-section-body", t("journeyNextReopen")));
  } else if(j && j.cause && j.cause.failureCategory === "verification"){
    next.appendChild(h("div", "journey-section-body", t("journeyNextVerification")));
  } else if(j && j.nextAction){
    next.appendChild(h("div", "journey-section-body", nextActionLabel(j.nextAction.label)));
  } else {
    next.appendChild(h("div", "journey-section-body dim", t("journeyNextInvestigate")));
  }
  panel.appendChild(next);

  return panel;
}

/* Conditional "Where this Task sits": Plan origin and handoff lineage.
 * Only renders when durable context exists; standalone Tasks get no card.
 * Produces at most four primary facts, never duplicates Task outcome.
 * Never exposes raw UUIDs or item IDs in primary copy. */
function renderTaskLineage(task){
  var lineage = task.taskLineage;
  var plan = task.planContext;
  if(!lineage) return null;
  // Standalone: no lineage section
  if(lineage.kind === "standalone" && !plan) return null;

  var card = h("div", "card form-card task-lineage-card");
  card.setAttribute("data-fl-role", "task-lineage");
  card.appendChild(h("div", "card-title mb-4", t("taskLineageTitle")));

  // Fact 1: Plan origin (Started as) using plan name and step index (never itemId).
  if(plan && plan.planId){
    var stepIndex = typeof plan.itemIndex === "number" ? String(plan.itemIndex + 1) : "?";
    card.appendChild(h("div", "summary-line dim", t("taskLineageStartedAs", {
      planName: safeTaskName(plan.planName) || t("planItemGenericPlan"),
      step: stepIndex
    })));
  }

  // Fact 2: Continued from; prerequisite or handoff source
  if(lineage.kind === "handoff" && lineage.role === "successor" && lineage.sourceTaskId){
    card.appendChild(h("div", "summary-line", t("taskLineageContinuedFromHandoff")));
    if(lineage.destinationProvider || lineage.destinationModel){
      card.appendChild(h("div", "summary-line dim", t("taskLineageWorkerChange", {
        provider: lineage.destinationProvider || "",
        model: lineage.destinationModel || ""
      })));
    }
  } else if(plan && Array.isArray(plan.namedDependencies) && plan.namedDependencies.length > 0){
    var depNames = plan.namedDependencies.map(function(d){
      return safeTaskName(d.taskName) || t("planItemGenericSource");
    }).filter(Boolean);
    if(depNames.length){
      card.appendChild(h("div", "summary-line dim", t("taskLineageContinuedFromDeps", {
        names: depNames.slice(0, 3).join(", ")
      })));
    }
  }

  // Fact 3: This run; handoff continuation, bounded correction, or original
  if(lineage.kind === "handoff"){
    if(lineage.role === "successor"){
      card.appendChild(h("div", "summary-line", t("taskLineageThisRunHandoffSuccessor")));
      card.appendChild(h("div", "dim fs11 mt-4", t("taskLineageNotARetry")));
    } else if(lineage.role === "source"){
      card.appendChild(h("div", "summary-line", t("taskLineageThisRunHandoffSource")));
    }
  }

  // Fact 4: Unlocks next; dependent items or handoff successor
  if(lineage.kind === "handoff" && lineage.role === "source" && lineage.successorTaskId){
    card.appendChild(h("div", "summary-line dim", t("taskLineageUnlocksHandoff")));
  } else if(plan && Array.isArray(plan.namedRequiredBy) && plan.namedRequiredBy.length > 0){
    var reqNames = plan.namedRequiredBy.map(function(d){
      return safeTaskName(d.taskName) || t("planItemGenericNext");
    }).filter(Boolean);
    if(reqNames.length){
      if(reqNames.length <= 3){
        card.appendChild(h("div", "summary-line dim", t("taskLineageUnlocks", {
          names: reqNames.join(", ")
        })));
      } else {
        card.appendChild(h("div", "summary-line dim", t("taskLineageUnlocksMany", {
          names: reqNames.slice(0, 3).join(", "),
          more: String(reqNames.length - 3)
        })));
      }
    }
  }

  // Only render when we actually produced at least one fact.
  if(card.children.length <= 1) return null;
  return card;
}

function resolveCauseWhat(what){
  var map = { succeeded: "journeyCauseWhatSucceeded", running: "journeyCauseWhatRunning",
    queued: "journeyCauseWhatQueued", failed: "journeyCauseWhatFailed" };
  return t(map[what] || "journeyCauseWhatFailed");
}
function resolveCauseWhy(what, why, category, mainDecision){
  if(mainDecision === "revise") return t("journeyCauseWhyMainRevise");
  if(mainDecision === "reject") return t("journeyCauseWhyMainReject");
  if(what === "succeeded") return t("journeyCauseWhySucceeded");
  if(what === "running") return t("journeyCauseWhyRunning");
  if(what === "queued") return t("journeyCauseWhyQueued");
  if(category === "authentication") return t("journeyCauseWhyAuth");
  if(category === "budget") return t("journeyCauseWhyBudget");
  if(category === "runtime") return t("journeyCauseWhyRuntime");
  if(category === "connectivity") return t("journeyCauseWhyConnectivity");
  if(category === "contract-infeasible") return t("journeyCauseWhyContractInfeasible");
  if(category === "verification") return t("journeyCauseWhyVerification");
  if(what === "failed") return t("journeyCauseWhyUnknown");
  return why || "";
}
function failureCategoryLabel(cat){
  var map = { authentication: "journeyFailureAuth", budget: "journeyFailureBudget",
    runtime: "journeyFailureRuntime", connectivity: "journeyFailureConnectivity",
    verification: "journeyFailureVerification",
    "contract-infeasible": "journeyFailureContractInfeasible",
    unknown: "journeyFailureUnknown" };
  return t(map[cat] || "journeyFailureUnknown");
}
function nextActionLabel(label){
  var map = { "review": "journeyNextReview", "ready-to-integrate": "journeyNextReadyIntegrate",
    "revise": "journeyNextRevise", "stopped": "journeyNextStopped", "wait": "journeyNextWait",
    "done": "journeyNextDone", "credentials": "journeyNextCredentials", "budget": "journeyNextBudget",
    "runtime": "journeyNextRuntime", "connectivity": "journeyNextConnectivity",
    "investigate": "journeyNextInvestigate",
    "revise-contract": "journeyNextReviseContract",
    "reopen": "journeyNextReopen" };
  return t(map[label] || label);
}
/* Translate closed attention-resolution reason codes into readable copy.
 * The browser only translates the codes; the Core owns the vocabulary. */
function attentionResolutionReasonLabel(reason){
  var map = {
    "environment-recovered": "attentionResolvedReasonEnvironment",
    "superseded": "attentionResolvedReasonSuperseded",
    "handled-elsewhere": "attentionResolvedReasonHandledElsewhere",
    "no-longer-needed": "attentionResolvedReasonNoLongerNeeded"
  };
  return t(map[reason] || "attentionResolvedReasonHandledElsewhere");
}

/* --- Direct Main Token savings setup (calibration journey) ---
 * Presents the direct-run comparison as a four-step user journey rather
 * than a calibration protocol workflow. Consumes the safe
 * GET /api/ops/tasks/:id/calibration state plus the existing Task
 * economics renderer. Produces current status, required input, process
 * explanation, result, and next action in plain language.
 * Boundaries: no identity inference, no savings arithmetic, no Provider
 * execution, no raw canonical objects, and no automatic mutation.
 * Savings come only from an equivalent direct-run comparison; Worker
 * activity and boundary work are never called savings. */
var CALIBRATION_COUNTER_FIELDS = [
  { key: "input_tokens", label: "calFieldInputTokens", hint: "calFieldInputTokensHint", example: "calFieldInputTokensExample" },
  { key: "cached_input_tokens", label: "calFieldCachedInputTokens", hint: "calFieldCachedInputTokensHint", example: "calFieldCachedInputTokensExample" },
  { key: "cache_write_input_tokens", label: "calFieldCacheWriteInputTokens", hint: "calFieldCacheWriteInputTokensHint", example: "calFieldCacheWriteInputTokensExample" },
  { key: "output_tokens", label: "calFieldOutputTokens", hint: "calFieldOutputTokensHint", example: "calFieldOutputTokensExample" },
  { key: "reasoning_output_tokens", label: "calFieldReasoningOutputTokens", hint: "calFieldReasoningOutputTokensHint", example: "calFieldReasoningOutputTokensExample" }
];
/* The four bounded rejection reasons are the canonical enum from
 * direct-codex-review; only their displayed text is translated. */
var CALIBRATION_REJECTION_REASONS = [
  "not-equivalent-task",
  "insufficient-quality",
  "incomplete-evidence",
  "duplicate-evidence"
];
var CALIBRATION_REJECTION_LABELS = {
  "not-equivalent-task": "calRejectReasonNotEquivalent",
  "insufficient-quality": "calRejectReasonInsufficientQuality",
  "incomplete-evidence": "calRejectReasonIncompleteEvidence",
  "duplicate-evidence": "calRejectReasonDuplicate"
};
/* One UI state adapter for the whole card. The publication preview is the
 * source of truth: ready means accepted evidence still needs publishing;
 * no-new-evidence with a later next version means the accepted evidence is
 * already published. Pending review always remains visible. */
function calibrationViewState(cal){
  if(!cal || typeof cal !== "object") return "api-error";
  if(cal.state === "identity-missing") return "identity-missing";
  if(cal.state !== "ready") return "api-error";
  var preview = cal.publicationPreview || {};
  var nextVersion = typeof preview.nextVersion === "number" ? preview.nextVersion : 0;
  var pendingCount = typeof preview.pendingCount === "number" ? preview.pendingCount : 0;
  var acceptedCount = typeof preview.acceptedCount === "number" ? preview.acceptedCount : 0;
  if(preview.ready === true && acceptedCount > 0) return "ready-to-publish";
  if(pendingCount > 0) return "pending-review";
  if(preview.reason === "no-new-evidence" && nextVersion >= 2) return "published";
  if(acceptedCount > 0) return "pending-review";
  return "no-samples";
}
function calibrationFieldLabel(key){
  for(var i = 0; i < CALIBRATION_COUNTER_FIELDS.length; i++){
    if(CALIBRATION_COUNTER_FIELDS[i].key === key) return t(CALIBRATION_COUNTER_FIELDS[i].label);
  }
  return key;
}
/* Generate a bounded opaque run reference in the browser so the user is
 * never asked to invent an internal id. Content-free; no storage. */
function calibrationRunRef(){
  try {
    if(typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"){
      return "codex-run:" + crypto.randomUUID();
    }
  } catch(_e){ /* fall through to random fallback */ }
  var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  var s = "codex-run:";
  for(var i = 0; i < 32; i++){
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}
/* Local validation before any request: five non-negative safe integers,
 * cached + cache_write not exceeding input, reasoning not exceeding
 * output, and input + output still a safe integer. Mirrors the canonical
 * turn.completed validator so a bad payload never leaves the browser. */
function calibrationValidateCounts(values){
  var keys = ["input_tokens","cached_input_tokens","cache_write_input_tokens","output_tokens","reasoning_output_tokens"];
  for(var i = 0; i < keys.length; i++){
    var raw = values[keys[i]];
    if(raw === "" || raw === null || raw === undefined){
      return { key: "calValidationRequired", field: keys[i] };
    }
    var n = Number(raw);
    if(!Number.isFinite(n) || !Number.isInteger(n)){
      return { key: "calValidationInteger", field: keys[i] };
    }
    if(n < 0) return { key: "calValidationNegative", field: keys[i] };
    if(!Number.isSafeInteger(n)) return { key: "calValidationUnsafe", field: keys[i] };
  }
  var input = Number(values.input_tokens);
  var cached = Number(values.cached_input_tokens);
  var cacheWrite = Number(values.cache_write_input_tokens);
  var output = Number(values.output_tokens);
  var reasoning = Number(values.reasoning_output_tokens);
  if(cached + cacheWrite > input) return { key: "calValidationCachedExceedsInput" };
  if(reasoning > output) return { key: "calValidationReasoningExceedsOutput" };
  if(!Number.isSafeInteger(input + output)) return { key: "calValidationUnsafeSum" };
  return null;
}
function calibrationNextActionKey(view){
  var map = {
    "no-samples": "calNextNoSamples",
    "pending-review": "calNextPendingReview",
    "ready-to-publish": "calNextReadyToPublish",
    "published": "calNextPublished"
  };
  return map[view] || "calNextNoSamples";
}
function calibrationStateDescKey(view){
  var map = {
    "no-samples": "calStateNoSamples",
    "pending-review": "calStatePendingReview",
    "ready-to-publish": "calStateReadyToPublish",
    "published": "calStatePublished"
  };
  return map[view] || "";
}
function calBuildSteps(){
  var box = h("div", "cal-steps");
  var steps = [
    { title: "calStep1Title", body: "calStep1Body" },
    { title: "calStep2Title", body: "calStep2Body" },
    { title: "calStep3Title", body: "calStep3Body" },
    { title: "calStep4Title", body: "calStep4Body" }
  ];
  steps.forEach(function(s, i){
    var item = h("div", "cal-step");
    item.appendChild(h("div", "cal-step-num", String(i + 1)));
    var txt = h("div", "cal-step-text");
    txt.appendChild(h("div", "cal-step-title", t(s.title)));
    txt.appendChild(h("div", "summary-line dim fs11", t(s.body)));
    item.appendChild(txt);
    box.appendChild(item);
  });
  return box;
}
function calBuildCaptureForm(task, onDone){
  var form = h("div", "cal-capture-form");
  form.setAttribute("data-fl-role", "calibration-capture-form");
  form.appendChild(h("div", "summary-line dim mb-8", t("calCaptureHint")));
  var inputs = {};
  CALIBRATION_COUNTER_FIELDS.forEach(function(def){
    var lab = h("label", "cal-field");
    lab.appendChild(h("span", "cal-field-label", t(def.label)));
    lab.appendChild(h("span", "cal-field-hint", t(def.hint)));
    var inp = h("input", "");
    inp.type = "number";
    inp.min = "0";
    inp.step = "1";
    inp.setAttribute("inputmode", "numeric");
    inp.setAttribute("data-cal-counter", def.key);
    inp.placeholder = t(def.example);
    lab.appendChild(inp);
    form.appendChild(lab);
    inputs[def.key] = inp;
  });
  var errLine = h("div", "summary-line cal-validation fs11");
  var btn = h("button", "btn sm primary", t("calCaptureBtn"));
  btn.type = "button";
  btn.addEventListener("click", function(){
    var values = {};
    CALIBRATION_COUNTER_FIELDS.forEach(function(def){
      values[def.key] = inputs[def.key].value.trim();
    });
    var err = calibrationValidateCounts(values);
    errLine.textContent = "";
    errLine.classList.remove("cal-validation-err");
    if(err){
      errLine.appendChild(document.createTextNode(t(err.key, {
        field: err.field ? calibrationFieldLabel(err.field) : ""
      })));
      errLine.classList.add("cal-validation-err");
      return;
    }
    calibrationSubmitCapture(task, values, onDone);
  });
  form.appendChild(errLine);
  form.appendChild(hd("div", "actions mt-8", [btn]));
  form.appendChild(h("div", "summary-line dim fs11 mt-4", t("calCaptureBoundary")));
  return form;
}
function calibrationSubmitCapture(task, values, onDone){
  if(!window.confirm(t("calCaptureConfirm"))) return;
  var runRef = calibrationRunRef();
  var usage = {
    type: "turn.completed",
    usage: {
      input_tokens: Number(values.input_tokens),
      cached_input_tokens: Number(values.cached_input_tokens),
      cache_write_input_tokens: Number(values.cache_write_input_tokens),
      output_tokens: Number(values.output_tokens),
      reasoning_output_tokens: Number(values.reasoning_output_tokens)
    }
  };
  postJSON("/api/ops/tasks/" + encodeURIComponent(task.id) + "/calibration/capture", {
    runRef: runRef, usage: usage
  }).then(function(){
    toast(t("calCaptureOk"));
    if(onDone) onDone();
  }).catch(function(e){
    flashError(t("calCaptureFailed"), e && e.message ? e.message : "");
  });
}
function calBuildSampleRow(task, sample, onDone){
  var row = h("div", "cal-sample");
  row.setAttribute("data-fl-role", "calibration-sample");
  var head = h("div", "cal-sample-head");
  var stateKey = sample.reviewState === "accepted" ? "calSampleAccepted"
    : sample.reviewState === "rejected" ? "calSampleRejected"
    : "calSamplePending";
  var stateClass = sample.reviewState === "accepted" ? "badge-ok"
    : sample.reviewState === "rejected" ? "badge-err"
    : "badge-warn";
  head.appendChild(h("span", "badge " + stateClass, t(stateKey)));
  head.appendChild(h("span", "cal-sample-meta dim fs11",
    t("calSampleCaptured", { time: sample.capturedAt ? fmtTm(sample.capturedAt) : "-" })));
  head.appendChild(h("span", "cal-sample-gross mono",
    t("calSampleGross", { count: String(sample.grossTokens || 0) })));
  row.appendChild(head);
  /* Stable id kept inside a closed technical disclosure; the row itself
   * shows only captured time and gross Token count, never a raw object. */
  var techBody = h("div", "cal-sample-tech");
  techBody.appendChild(h("div", "summary-line mono fs11",
    t("calSampleIdLabel") + ": " + String(sample.sampleId || "-")));
  row.appendChild(collapsedSection(t("calSampleTechnical"), techBody));
  if(sample.reviewState === "pending"){
    var act = h("div", "cal-sample-actions mt-4");
    /* Equivalence checklist: Accept is only enabled after every item is
     * checked, then an explicit confirmation is required. */
    var checklist = h("div", "cal-checklist mb-4");
    checklist.appendChild(h("div", "summary-line", t("calEquivalenceTitle")));
    var items = ["calEquivalenceItem1","calEquivalenceItem2","calEquivalenceItem3","calEquivalenceItem4"];
    items.forEach(function(k){
      var item = h("div", "cal-checklist-item");
      var cb = h("input", "");
      cb.type = "checkbox";
      item.appendChild(cb);
      item.appendChild(document.createTextNode(t(k)));
      checklist.appendChild(item);
    });
    checklist.appendChild(h("div", "summary-line dim fs11 mt-4", t("calEquivalenceHint")));
    act.appendChild(checklist);
    var acceptBtn = h("button", "btn sm primary", t("calAcceptBtn"));
    acceptBtn.type = "button";
    acceptBtn.disabled = true;
    function refreshAcceptEnabled(){
      var checked = checklist.querySelectorAll('input[type="checkbox"]');
      var allChecked = checked.length > 0;
      checked.forEach(function(c){ if(!c.checked) allChecked = false; });
      acceptBtn.disabled = !allChecked;
    }
    checklist.querySelectorAll('input[type="checkbox"]').forEach(function(cb){
      cb.addEventListener("change", refreshAcceptEnabled);
    });
    acceptBtn.addEventListener("click", function(){
      if(acceptBtn.disabled) return;
      calibrationSubmitReview(task, sample.sampleId, "accepted", null, onDone);
    });
    act.appendChild(acceptBtn);
    var reasonLab = h("label", "cal-reason", t("calRejectReasonLabel"));
    var reasonSel = h("select", "");
    reasonSel.setAttribute("data-cal-reason", "true");
    CALIBRATION_REJECTION_REASONS.forEach(function(r){
      var o = document.createElement("option");
      o.value = r;
      o.textContent = t(CALIBRATION_REJECTION_LABELS[r]);
      reasonSel.appendChild(o);
    });
    reasonLab.appendChild(reasonSel);
    act.appendChild(reasonLab);
    var rejectBtn = h("button", "btn sm danger", t("calRejectBtn"));
    rejectBtn.type = "button";
    rejectBtn.addEventListener("click", function(){
      calibrationSubmitReview(task, sample.sampleId, "rejected", reasonSel, onDone);
    });
    act.appendChild(rejectBtn);
    row.appendChild(act);
  }
  return row;
}
function calBuildSamples(task, samples, onDone){
  var box = h("div", "cal-samples mt-8");
  box.setAttribute("data-fl-role", "calibration-samples");
  box.appendChild(h("div", "summary-line",
    t("calSamplesTitle") + " (" + String(samples.length) + ")"));
  if(!samples.length){
    box.appendChild(h("div", "summary-line dim fs11", t("calNoSamples")));
    return box;
  }
  samples.forEach(function(s){ box.appendChild(calBuildSampleRow(task, s, onDone)); });
  return box;
}
function calibrationSubmitReview(task, sampleId, decision, reasonSel, onDone){
  var body = { sampleId: sampleId, decision: decision, confirm: true };
  if(decision === "rejected"){
    if(!reasonSel || !reasonSel.value){
      flashError(t("calRejectReasonRequired"));
      return;
    }
    body.rejectionReason = reasonSel.value;
  }
  var confirmKey = decision === "accepted" ? "calAcceptConfirm" : "calRejectConfirm";
  if(!window.confirm(t(confirmKey))) return;
  postJSON("/api/ops/tasks/" + encodeURIComponent(task.id) + "/calibration/review", body)
    .then(function(){
      toast(decision === "accepted" ? t("calAcceptOk") : t("calRejectOk"));
      if(onDone) onDone();
    })
    .catch(function(e){ flashError(t("calReviewFailed"), e && e.message ? e.message : ""); });
}
function calBuildPublish(task, preview, onDone){
  var box = h("div", "cal-publish mt-8");
  box.setAttribute("data-fl-role", "calibration-publish");
  var ready = preview && preview.ready === true;
  var acceptedCount = typeof (preview && preview.acceptedCount) === "number" ? preview.acceptedCount : 0;
  if(ready){
    box.appendChild(h("div", "summary-line",
      t("calPublishReady", { count: String(acceptedCount) })));
  } else {
    box.appendChild(h("div", "summary-line", t("calPublishNotReady")));
    if(preview && preview.reason){
      box.appendChild(h("div", "summary-line dim fs11",
        t("calPublishNotReadyReason", { reason: calibrationPublishReason(preview.reason) })));
    }
  }
  box.appendChild(h("div", "summary-line dim fs11", t("calPublishLowConfidenceNote")));
  box.appendChild(h("div", "summary-line dim fs11", t("calPublishReversibleNote")));
  var btn = h("button", "btn sm primary", t("calPublishBtn"));
  btn.type = "button";
  btn.disabled = !ready;
  btn.addEventListener("click", function(){
    if(btn.disabled) return;
    calibrationSubmitPublish(task, onDone);
  });
  box.appendChild(hd("div", "actions mt-8", [btn]));
  return box;
}
function calibrationPublishReason(reason){
  var keys = {
    "ready": "calPublishReasonReady",
    "no-accepted-samples": "calPublishReasonNoAccepted",
    "no-new-evidence": "calPublishReasonNoNewEvidence",
    "unsafe-version": "calPublishReasonUnsafeVersion"
  };
  return t(keys[reason] || "calPublishReasonUnknown");
}
function calibrationSubmitPublish(task, onDone){
  if(!window.confirm(t("calPublishConfirm"))) return;
  postJSON("/api/ops/tasks/" + encodeURIComponent(task.id) + "/calibration/publish", { confirm: true })
    .then(function(){ toast(t("calPublishOk")); if(onDone) onDone(); })
    .catch(function(e){ flashError(t("calPublishFailed"), e && e.message ? e.message : ""); });
}
/* Opens the closed Technical details disclosure chain and scrolls to the
 * existing economics evidence section, linking the user to the only
 * savings calculation view without duplicating its arithmetic. */
function calibrationViewEconomicsBtn(){
  var btn = h("button", "btn sm", t("calViewEconomics"));
  btn.type = "button";
  btn.setAttribute("data-fl-role", "calibration-view-economics");
  btn.addEventListener("click", function(){
    var econ = detailEl.querySelector('[data-fl-role="task-economics-evidence"]');
    if(!econ) return;
    var node = econ;
    while(node && node !== detailEl){
      if(node.tagName === "DETAILS") node.open = true;
      node = node.parentElement;
    }
    econ.scrollIntoView();
  });
  return btn;
}
function calBuildTechnicalDisclosure(identity){
  var body = h("div", "cal-tech-body");
  if(identity && identity.taskClass){
    body.appendChild(h("div", "summary-line mono fs11",
      t("calIdentityTaskClass") + ": " + String(identity.taskClass)));
  }
  if(identity && identity.directCodexProfileId){
    body.appendChild(h("div", "summary-line mono fs11",
      t("calIdentityProfile") + ": " + String(identity.directCodexProfileId)));
  }
  CALIBRATION_COUNTER_FIELDS.forEach(function(def){
    body.appendChild(h("div", "summary-line mono fs11",
      t(def.label) + ": " + def.key));
  });
  body.appendChild(h("div", "summary-line mono fs11", t("calTechEndpoints")));
  return collapsedSection(t("calTechnicalNames"), body);
}
function renderCalibrationError(bodyEl, err, load){
  bodyEl.textContent = "";
  bodyEl.appendChild(stateMsg("error", t("calStateApiError")));
  bodyEl.appendChild(h("div", "summary-line dim fs11 mt-4", t("calErrorHint")));
  appendBoundedDetail(bodyEl, err && err.message ? err.message : "");
  var retryBtn = h("button", "btn sm", t("calRetry"));
  retryBtn.type = "button";
  retryBtn.addEventListener("click", function(){
    bodyEl.textContent = "";
    bodyEl.appendChild(stateMsg("loading", t("calLoading")));
    load();
  });
  bodyEl.appendChild(hd("div", "actions mt-8", [retryBtn]));
}
function renderCalibrationBody(bodyEl, task, cal, load){
  bodyEl.textContent = "";
  var view = calibrationViewState(cal);
  var onDone = function(){ showTask(task.id); };
  var statusBox = h("div", "cal-status mb-8");
  statusBox.appendChild(h("div", "summary-line", t("calStatusLabel")));
  var descKey = calibrationStateDescKey(view);
  if(descKey) statusBox.appendChild(h("div", "summary-line", t(descKey)));
  statusBox.appendChild(h("div", "summary-line dim fs11", t("calWorkerNotSavingsNote")));
  bodyEl.appendChild(statusBox);

  if(view === "api-error"){
    renderCalibrationError(bodyEl, null, load);
    return;
  }
  if(view === "identity-missing"){
    bodyEl.appendChild(h("div", "summary-line", t("calStateIdentityMissing")));
    bodyEl.appendChild(h("div", "summary-line dim fs11 mt-4", t("calIdentityMissingHint")));
    bodyEl.appendChild(h("div", "summary-line dim fs11 mt-4", t("calFutureContractsHint")));
    bodyEl.appendChild(h("div", "summary-line dim fs11 mt-4", t("calNoRetrofitHint")));
    return;
  }

  var identity = cal.identity || {};

  if(view === "published"){
    bodyEl.appendChild(h("div", "summary-line cal-published", t("calStatePublished")));
    bodyEl.appendChild(h("div", "summary-line dim fs11 mt-4", t("calPublishedHint")));
    bodyEl.appendChild(hd("div", "actions mt-8", [calibrationViewEconomicsBtn()]));
    /* A publication is reversible only by adding a later evidence
     * version, so the capture journey and publish controls stay
     * available, collapsed. */
    var laterBody = h("div", "");
    laterBody.appendChild(calBuildSteps());
    laterBody.appendChild(calBuildCaptureForm(task, onDone));
    laterBody.appendChild(calBuildPublish(task, cal.publicationPreview || {}, onDone));
    bodyEl.appendChild(journeyDisclosure(t("calAddLaterVersion"), laterBody));
  } else {
    bodyEl.appendChild(calBuildSteps());
    bodyEl.appendChild(calBuildCaptureForm(task, onDone));
  }

  bodyEl.appendChild(calBuildSamples(task, (cal.samples || []).slice(0, 50), onDone));
  if(view !== "published"){
    bodyEl.appendChild(calBuildPublish(task, cal.publicationPreview || {}, onDone));
  }
  bodyEl.appendChild(h("div", "summary-line dim fs11 mt-8 cal-next",
    t(calibrationNextActionKey(view))));
  bodyEl.appendChild(calBuildTechnicalDisclosure(identity));
}
/* Card root: renders a loading placeholder, then fetches the safe
 * calibration state once and fills the body. No automatic polling,
 * retry, or loop; only an explicit user retry on API failure. */
function renderCalibrationCard(task){
  var cardEl = h("div", "card form-card calibration-card");
  cardEl.setAttribute("data-fl-role", "calibration-card");
  cardEl.appendChild(h("div", "card-title mb-4", t("calCardTitle")));
  cardEl.appendChild(h("div", "summary-line dim mb-8", t("calIntro")));
  var bodyEl = h("div", "calibration-body");
  bodyEl.appendChild(stateMsg("loading", t("calLoading")));
  cardEl.appendChild(bodyEl);
  var taskId = task.id;
  function load(){
    fetchJSON("/api/ops/tasks/" + encodeURIComponent(taskId) + "/calibration")
      .then(function(cal){ renderCalibrationBody(bodyEl, task, cal, load); })
      .catch(function(e){ renderCalibrationError(bodyEl, e, load); });
  }
  load();
  return cardEl;
}

/* Two-step safe read: prefer the explicit key the backend recorded for this
 * stage; fall back to a stage-agnostic container if no key matches. The
 * renderer must NEVER invent a pass from an overall Integration status. */
function taskActualStageFor(task, key){
  var stages = (task && task.decision && task.decision.integration && Array.isArray(task.decision.integration.stages)) ? task.decision.integration.stages : [];
  for(var i = 0; i < stages.length; i++){
    if(stages[i] && stages[i].stage === key) return stages[i];
  }
  return null;
}
function taskActualStatusLabel(stage){
  if(!stage) return { key: "taskDeliveryActualNotRun", cls: "not-run" };
  if(stage.status === "passed") return { key: "taskDeliveryActualPassed", cls: "passed" };
  if(stage.status === "failed") return { key: "taskDeliveryActualFailed", cls: "failed" };
  if(stage.status === "pending") return { key: "taskDeliveryActualPending", cls: "pending" };
  if(stage.status === "not-applicable") return { key: "taskDeliveryActualNotConfigured", cls: "not-configured" };
  if(stage.status === "outcome-unknown") return { key: "taskDeliveryActualUnknown", cls: "unknown" };
  return { key: "taskDeliveryActualNotRun", cls: "not-run" };
}
function deliveryPlanExpectation(plan, stageKey){
  var planKey = DELIVERY_STAGE_PLAN_KEYS[stageKey];
  if(!plan || !plan.stages || !planKey) return "unknown";
  var value = plan.stages[planKey];
  return value === "required" || value === "not-configured" ? value : "unknown";
}
function renderTaskDeliveryPlan(task){
  var plan = (task && task.deliveryPlan) || null;
  var hasPlan = plan && plan.stages && typeof plan.stages === "object";
  var card = h("div", "card form-card task-delivery-card");
  card.setAttribute("data-fl-role", "task-delivery-plan");
  card.appendChild(h("div", "card-title mb-4", t("taskDeliveryPlanTitle")));
  card.appendChild(h("div", "summary-line dim mb-8", t("taskDeliveryPlanIntro")));
  if(!hasPlan){
    card.appendChild(stateMsg("empty", t("taskDeliveryPlanUnavailable")));
    card.appendChild(h("div", "summary-line dim mt-4", t("taskDeliveryPlanUnavailableHint")));
  } else if(plan.outcome === "none" || plan.outcome === "source-only"){
    card.appendChild(stateMsg("empty", t("taskDeliveryPlanNone")));
    card.appendChild(h("div", "summary-line dim mt-4", t("taskDeliveryPlanNoneHint")));
  }
  var stages = h("div", "delivery-stages");
  DELIVERY_STAGE_KEYS.forEach(function(key, idx){
    var actual = taskActualStageFor(task, key);
    var cardEl = h("div", "delivery-stage");
    cardEl.setAttribute("data-fl-role", "delivery-stage-" + key);
    cardEl.appendChild(h("div", "delivery-stage-num", String(idx + 1)));
    var body = h("div", "delivery-stage-body");
    body.appendChild(h("div", "delivery-stage-title", t(DELIVERY_STAGE_LABEL_KEYS[key])));
    var descKey = DELIVERY_STAGE_LABEL_KEYS[key] + "Body";
    body.appendChild(h("div", "delivery-stage-desc", t(descKey)));
    var pair = h("div", "delivery-stage-pair");
    var expCol = h("div", "");
    expCol.appendChild(h("div", "delivery-stage-pair-label", t("deliveryStageExpectedStatus")));
    var expectation = deliveryPlanExpectation(plan, key);
    var expKey = expectation === "required" ? "taskDeliveryStageConfigured"
      : expectation === "not-configured" ? "taskDeliveryStageNotConfigured"
      : "taskDeliveryStageUnknown";
    var expectedState = h("div", "delivery-stage-pair-status " + expectation, t(expKey));
    expCol.appendChild(expectedState);
    pair.appendChild(expCol);
    var actCol = h("div", "");
    actCol.appendChild(h("div", "delivery-stage-pair-label", t("deliveryStageActualStatus")));
    var actualLabel = taskActualStatusLabel(actual);
    var actState = h("div", "delivery-stage-pair-status " + actualLabel.cls, t(actualLabel.key));
    actCol.appendChild(actState);
    pair.appendChild(actCol);
    body.appendChild(pair);
    cardEl.appendChild(body);
    cardEl.appendChild(h("div", "delivery-stage-state", ""));
    stages.appendChild(cardEl);
  });
  card.appendChild(stages);
  return card;
}
function renderPreflightResult(result){
  var card = h("div", "card form-card preflight-card");
  card.setAttribute("data-fl-role", "preflight-result");
  card.appendChild(h("div", "card-title mb-4", t("taskPreflightTitle")));
  var verdict = result && Array.isArray(result.rejectionReasons) && result.rejectionReasons.length ? "reject" : "ok";
  var applicabilityIssue = result && result.applicabilityIssue
    && typeof result.applicabilityIssue === "object"
    && result.applicabilityIssue.code === "patch-not-applicable"
    ? result.applicabilityIssue : null;
  var headlineKey = verdict === "reject" ? "taskPreflightHeadlineReject"
    : "taskPreflightHeadlineOk";
  var summaryKey = verdict === "reject" ? "taskPreflightSummaryReject"
    : "taskPreflightSummaryOk";
  // One coherent next action: applicability-specific guidance for the
  // patch-not-applicable case. The generic correct-the-source footer would
  // contradict the explanation, so it is replaced (not duplicated) here. Raw
  // git diagnostics stay only in the collapsed technical disclosure below.
  var nextKey = applicabilityIssue
    ? "taskPreflightApplicabilityNext"
    : verdict === "reject" ? "taskPreflightNextReject" : "taskPreflightNextOk";
  card.appendChild(h("div", "preflight-headline " + verdict, t(headlineKey)));
  card.appendChild(h("div", "preflight-summary", t(summaryKey)));
  if(applicabilityIssue){
    var expl = h("div", "preflight-applicability");
    expl.setAttribute("data-fl-role", "preflight-applicability");
    expl.appendChild(h("div", "summary-line", t("taskPreflightApplicabilityTitle")));
    expl.appendChild(h("div", "summary-line fs11", t("taskPreflightApplicabilityHappened")));
    expl.appendChild(h("div", "summary-line fs11", t("taskPreflightApplicabilityMeaning")));
    card.appendChild(expl);
  }
  var affectedFiles = result && Array.isArray(result.affectedFiles) ? result.affectedFiles : null;
  var files = affectedFiles === null ? null : affectedFiles.length;
  var affLine = h("div", "preflight-affected", t("taskPreflightAffected") + " ");
  if(files === null){
    affLine.appendChild(h("span", "summary-line dim", t("taskPreflightAffectedNone")));
  } else {
    affLine.appendChild(h("span", "preflight-affected-num", String(files)));
    affLine.appendChild(document.createTextNode(" " + t("taskPreflightFileCount")));
  }
  card.appendChild(affLine);
  var rejects = (result && Array.isArray(result.rejectionReasons)) ? result.rejectionReasons : [];
  // For the applicability case, raw git diagnostics are kept only inside the
  // collapsed technical disclosure. Other rejection types preserve their
  // existing readable rejection list.
  if(rejects.length && !applicabilityIssue){
    var rej = h("div", "preflight-rejects");
    rej.appendChild(h("div", "summary-line", t("taskPreflightRejectTitle")));
    if(rejects.length === 0){
      rej.appendChild(h("div", "summary-line dim fs11", t("taskPreflightRejectNone")));
    } else {
      rejects.forEach(function(r){
        rej.appendChild(h("div", "summary-line fs11", boundedDiagnostic(r)));
      });
    }
    card.appendChild(rej);
  }
  var pathEvidence = result && Array.isArray(result.pathEvidence) ? result.pathEvidence : null;
  var provLabelKeys = {
    "internal-forklight": "taskPreflightProvInternalForklight",
    "snapshot-exclusion": "taskPreflightProvSnapshotExclusion",
    "builtin-generated-pattern": "taskPreflightProvBuiltinGenerated",
    "task-generated-pattern": "taskPreflightProvTaskGenerated",
    "default-business": "taskPreflightProvDefaultBusiness"
  };
  var catLabelKeys = {
    business: "taskPreflightClassificationBusiness",
    generated: "taskPreflightClassificationGenerated",
    internal: "taskPreflightClassificationInternal"
  };
  if(pathEvidence && pathEvidence.length){
    var counts = { business: 0, generated: 0, internal: 0 };
    pathEvidence.forEach(function(e){
      if(counts[e.category] !== undefined) counts[e.category] += 1;
    });
    var clsBox = h("div", "preflight-classification");
    clsBox.setAttribute("data-fl-role", "preflight-classification");
    clsBox.appendChild(h("div", "summary-line", t("taskPreflightClassificationTitle")));
    clsBox.appendChild(h("div", "summary-line dim fs11", t("taskPreflightClassificationHint")));
    clsBox.appendChild(h("div", "summary-line fs11", t("taskPreflightClassificationLine", {
      business: counts.business,
      generated: counts.generated,
      internal: counts.internal
    })));
    card.appendChild(clsBox);
  }
  var guidance = result && result.recoveryGuidance && typeof result.recoveryGuidance === "object"
    ? result.recoveryGuidance : null;
  if(guidance){
    var gBox = h("div", "preflight-guidance");
    gBox.setAttribute("data-fl-role", "preflight-guidance");
    gBox.appendChild(h("div", "summary-line", t("taskPreflightGuidanceTitle")));
    gBox.appendChild(h("div", "summary-line fs11", t("taskPreflightGuidanceBody")));
    gBox.appendChild(h("div", "summary-line fs11", t("taskPreflightGuidanceChoicePolicy")));
    gBox.appendChild(h("div", "summary-line fs11", t("taskPreflightGuidanceChoiceScope")));
    gBox.appendChild(h("div", "summary-line dim fs11", t("taskPreflightGuidanceCaveat")));
    card.appendChild(gBox);
  }
  var plan = result && result.deliveryPlan;
  var stageBox = h("div", "preflight-stages");
  DELIVERY_STAGE_KEYS.forEach(function(stageKey){
    var expectation = deliveryPlanExpectation(plan, stageKey);
    var row = h("div", "summary-line", t(DELIVERY_STAGE_LABEL_KEYS[stageKey]));
    if(expectation === "not-configured"){
      row.appendChild(h("span", "summary-line dim fs11", " - " + t("taskPreflightNextStageNotConfigured")));
    } else if(expectation === "required") {
      row.appendChild(h("span", "summary-line dim fs11", " - " + t("taskPreflightNextStageOk")));
    } else {
      row.appendChild(h("span", "summary-line dim fs11", " - " + t("taskPreflightNextStageUnknown")));
    }
    stageBox.appendChild(row);
  });
  card.appendChild(stageBox);
  card.appendChild(h("div", "preflight-next", t(nextKey)));
  var techRows = [];
  if(result && result.id){
    techRows.push(t("taskPreflightReceiptId") + ": " + String(result.id));
  }
  if(result && result.expiresAt){
    techRows.push(t("taskPreflightExpiry") + ": " + String(result.expiresAt));
  }
  if(rejects.length){
    techRows.push(JSON.stringify(rejects));
  }
  if(affectedFiles && affectedFiles.length){
    techRows.push(t("taskPreflightAffected") + ": " + affectedFiles.join(", "));
  }
  if(techRows.length){
    var body = h("div", "task-technical-body");
    techRows.forEach(function(line){
      body.appendChild(h("div", "summary-line mono fs11", line));
    });
    card.appendChild(collapsedSection(t("taskPreflightReceiptDetails"), body));
  }
  if(pathEvidence && pathEvidence.length){
    var pathBody = h("div", "task-technical-body");
    pathEvidence.forEach(function(e){
      var provKey = provLabelKeys[e.provenance] || "taskPreflightProvDefaultBusiness";
      var catKey = catLabelKeys[e.category] || "taskPreflightClassificationBusiness";
      pathBody.appendChild(h("div", "summary-line mono fs11",
        e.path + " - " + t(catKey) + " (" + t(provKey) + ")"));
    });
    card.appendChild(collapsedSection(t("taskPreflightPathDisclosure"), pathBody));
  }
  return card;
}

/* Human-readable labels for durable timeline event types. Raw type codes stay
 * available only inside technical disclosures. */
function timelineEventLabel(type){
  var map = {
    "task.created": "tlTaskCreated",
    "task.launch-preflight.failed": "tlLaunchPreflightFailed",
    "task.queued": "tlTaskQueued",
    "workspace.preparation.stage": "tlPrepStage",
    "workspace.prepared": "tlPrepDone",
    "attempt.started": "tlAttemptStarted",
    "attempt.completed": "tlAttemptCompleted",
    "worker.started": "tlWorkerStarted",
    "worker.resumed": "tlWorkerResumed",
    "worker.completed": "tlWorkerCompleted",
    "worker.failed": "tlWorkerFailed",
    "worker.tool.completed": "tlWorkerTool",
    "verification.started": "tlVerifStarted",
    "verification.completed": "tlVerifCompleted",
    "verification.command.completed": "tlVerifCommand",
    "main-review.completed": "tlMainReview",
    "competition.main-decision.completed": "tlCompetitionMainDecision",
    "competition.retained-partial.completed": "tlCompetitionRetainedPartial",
    "candidate.handoff.authorized": "tlCandidateHandoffAuthorized",
    "candidate.handoff.prepared": "tlCandidateHandoffPrepared",
    "candidate.handoff.failed": "tlCandidateHandoffFailed",
    "candidate.revision.captured": "tlCandidateRevisionCaptured",
    "checkpoint.completed": "tlCheckpoint",
    "checkpoint.skipped": "tlCheckpointSkip",
    "integration.preflight.completed": "tlPreflight",
    "integration.apply.completed": "tlIntegrate",
    "attempt.authorization.granted": "tlAuthGrant",
    "candidate.reverification.completed": "tlReverify",
    "review.assignment.created": "tlJudgeAssigned",
    "review.assignment.completed": "tlJudgeCompleted",
    "review.assignment.failed": "tlJudgeFailed",
    "remediation.check.started": "tlRemediationStarted",
    "remediation.check.completed": "tlRemediation"
  };
  var key = map[String(type || "")];
  return key ? t(key) : t("tlOther");
}
function timelineEventSummary(event){
  if(event && event.presentationCode === "integration-patch-not-applicable"){
    return t("tlPreflightPatchNotApplicable");
  }
  return boundedDiagnostic(event && event.summary || "");
}
function reportCard(title, hint, bodyNodes, role){
  var card = h("div", "task-report-card");
  if(role) card.setAttribute("data-fl-role", role);
  var head = h("div", "task-report-card-head");
  head.appendChild(h("div", "task-report-card-title", title));
  card.appendChild(head);
  if(hint) card.appendChild(h("div", "task-report-card-hint", hint));
  (bodyNodes || []).forEach(function(node){ if(node) card.appendChild(node); });
  return card;
}
function reportBlock(label, value, prominent){
  if(value === undefined || value === null || value === "") return null;
  var block = h("div", "task-report-block");
  if(label) block.appendChild(h("div", "task-report-label", label));
  block.appendChild(h("div", "task-report-value" + (prominent ? " prominent" : ""), String(value)));
  return block;
}
function reportList(label, items, asFiles){
  var listItems = Array.isArray(items) ? items.filter(function(item){ return item !== undefined && item !== null && String(item).length; }) : [];
  var block = h("div", "task-report-block");
  if(label) block.appendChild(h("div", "task-report-label", label));
  if(!listItems.length){
    block.appendChild(h("div", "task-report-empty", t("taskReportEmpty")));
    return block;
  }
  var list = h("ul", "task-report-list" + (asFiles ? " files" : ""));
  listItems.slice(0, 40).forEach(function(item){
    list.appendChild(h("li", "", String(item)));
  });
  if(listItems.length > 40){
    block.appendChild(list);
    block.appendChild(h("div", "task-report-empty", t("storyMoreItems", { count: String(listItems.length - 40) })));
    return block;
  }
  block.appendChild(list);
  return block;
}
/* Session-local Task Detail tab (presentation only; never mutates Task). */
var taskDetailActiveTab = "overview";

function renderTaskTabShell(tabs, activeId){
  var root = h("div", "task-tabs");
  root.setAttribute("data-fl-role", "task-tabs");
  var bar = h("div", "task-tab-bar");
  bar.setAttribute("role", "tablist");
  var panels = h("div", "task-tab-panels");
  var buttons = [];
  var panelEls = [];
  tabs.forEach(function(tab, index){
    var btn = h("button", "task-tab" + (tab.id === activeId ? " is-active" : ""), tab.label);
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("data-task-tab", tab.id);
    btn.setAttribute("aria-selected", tab.id === activeId ? "true" : "false");
    if(tab.hint){
      var badgeEl = h("span", "task-tab-badge", tab.hint);
      btn.appendChild(document.createTextNode(" "));
      btn.appendChild(badgeEl);
    }
    bar.appendChild(btn);
    buttons.push(btn);

    var panel = h("div", "task-tab-panel" + (tab.id === activeId ? " is-active" : ""));
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("data-task-tab-panel", tab.id);
    panel.hidden = tab.id !== activeId;
    if(tab.body) panel.appendChild(tab.body);
    panels.appendChild(panel);
    panelEls.push(panel);

    btn.addEventListener("click", function(){
      taskDetailActiveTab = tab.id;
      workScheduleReadingContextSave();
      buttons.forEach(function(b, i){
        var on = tabs[i].id === tab.id;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        panelEls[i].classList.toggle("is-active", on);
        panelEls[i].hidden = !on;
      });
    });
  });
  root.appendChild(bar);
  root.appendChild(panels);
  return root;
}

/* FL-109C2B pending-action handoff banner for the Task Actions tab. It only
 * explains the bounded intent that the user chose by drag or keyboard; the
 * existing operation controls below remain the only path to a durable run.
 * One Continue button scrolls to and focuses the exact existing control the
 * Core policy named, so the user confirms through the existing gate. */
function renderPendingActionHandoff(pending){
  var entry = pending.entry || {};
  var op = workPendingOperation(pending);
  var box = h("div", "task-action-pending");
  box.id = "fl-task-action-pending";
  box.setAttribute("data-fl-role", "task-action-pending");
  box.appendChild(h("div", "task-action-pending-title", t("workActionHandoffTitle")));
  box.appendChild(h("div", "summary-line dim mb-8", t("workActionHandoffIntro", {
    task: pending.taskName || t("taskUntitled")
  })));

  var rows = h("div", "task-action-pending-rows");
  rows.appendChild(workHandoffRow(t("workActionHandoffColumn"), workColumnLabel(pending.column)));
  if(op) rows.appendChild(workHandoffRow(t("workActionHandoffOperation"), workOperationLabel(op)));
  if(entry.intent) rows.appendChild(workHandoffRow(t("workActionHandoffIntent"), workIntentLabel(entry.intent)));
  var requires = workPendingRequires(pending);
  if(requires && requires.length) rows.appendChild(workHandoffRow(t("workActionHandoffRequires"), workRequiresLabel(requires)));
  if(entry.path && entry.path.length) rows.appendChild(workHandoffRow(t("workActionHandoffPath"), workPathLabel(entry.path)));
  rows.appendChild(workHandoffRow(t("workActionHandoffWhy"), workDestinationExplanation(pending.column, entry)));
  box.appendChild(rows);

  var guide = h("div", "task-action-pending-guide", workPendingGuideText(pending));
  guide.setAttribute("data-fl-role", "task-action-pending-guide");
  box.appendChild(guide);

  var truth = h("div", "task-action-pending-truth", t("workActionHandoffTruth"));
  truth.setAttribute("data-fl-role", "task-action-pending-truth");
  box.appendChild(truth);

  if(pending.failure){
    var failure = h("div", "task-action-pending-failure",
      t("workActionHandoffFailureTitle") + " " + t("workActionHandoffFailureBody", {
        message: boundedDiagnostic(pending.failure)
      }));
    failure.setAttribute("data-fl-role", "task-action-pending-failure");
    box.appendChild(failure);
  }

  var actions = h("div", "task-action-pending-actions");
  var cont = h("button", "btn sm primary task-action-pending-continue", t("workActionHandoffContinue"));
  cont.type = "button";
  cont.setAttribute("data-fl-role", "task-action-pending-continue");
  cont.setAttribute("data-fl-op-continue", op || "");
  cont.addEventListener("click", function(){ workPendingContinue(pending); });
  actions.appendChild(cont);
  var dismiss = h("button", "btn sm", t("workActionHandoffDismiss"));
  dismiss.type = "button";
  dismiss.setAttribute("data-fl-role", "task-action-pending-dismiss");
  dismiss.addEventListener("click", function(){
    workPendingHandoffReset();
    var banner = document.getElementById("fl-task-action-pending");
    if(banner) banner.remove();
  });
  actions.appendChild(dismiss);
  box.appendChild(actions);
  return box;
}
function workHandoffRow(label, value){
  var row = h("div", "task-action-pending-row");
  row.setAttribute("data-fl-role", "task-action-pending-row");
  row.appendChild(h("div", "task-action-pending-row-label", label));
  row.appendChild(h("div", "task-action-pending-row-value",
    value === undefined || value === null ? "-" : String(value)));
  return row;
}
function workFieldLabel(field){
  var keys = { feedback: "workReqFeedback", confirm: "workReqConfirm", reason: "workReqReason",
    receiptId: "workReqReceiptId", evidence: "workReqEvidence", note: "workReqNote" };
  var key = keys[field];
  return key ? t(key) : String(field);
}
/* One plain-language next step: the exact next required input, or the confirm
 * gate when no input is missing. Integration names its current step. */
function workPendingGuideText(pending){
  var op = workPendingOperation(pending);
  if(op === "integration_preflight") return t("workActionHandoffStepPreflight");
  if(op === "integration_apply") return t("workActionHandoffStepApply");
  var requires = workPendingRequires(pending);
  for(var i = 0; i < requires.length; i++){
    var field = requires[i];
    if(field === "confirm") continue;
    return t("workActionHandoffStepNext", { field: workFieldLabel(field) });
  }
  return t("workActionHandoffStepConfirm");
}

/* ---------------------------------------------------------------------------
 * FL-109C2B: connect a chosen board destination to the exact durable Task
 * control. The router never recomputes eligibility, builds a mutation payload,
 * or submits automatically; it locates the one existing control the Core
 * policy named and moves focus there so the user confirms through the
 * existing gate. The canonical completion bridge clears matching pending
 * intent only after success, reloads Task detail, and immediately refetches
 * the Work hierarchy from Core. Failure keeps the pending context and entered
 * data intact and never moves or reparents a card locally.
 * ------------------------------------------------------------------------ */
function workPendingHandoffReset(){
  S.pendingActionHandoff = null;
  /* The ordinary manual Main review form outside a pending path is flexible
   * again; the fixed-intent lock and its hint belong only to the handoff. */
  var reviewSel = document.querySelector('[data-fl-op-input="review-intent"]');
  if(reviewSel) reviewSel.disabled = false;
  var lockHint = document.querySelector('[data-fl-role="main-review-lock-hint"]');
  if(lockHint) lockHint.remove();
}
function workPendingOperation(pending){
  if(!pending) return null;
  if(pending.operation) return pending.operation;
  if(pending.entry && pending.entry.operation) return pending.entry.operation;
  return null;
}
function workPendingRequires(pending){
  var op = workPendingOperation(pending);
  var path = (pending && pending.entry && pending.entry.path) || [];
  for(var i = 0; i < path.length; i++){
    if(path[i].operation === op && Array.isArray(path[i].requires)) return path[i].requires;
  }
  return (pending && pending.entry && pending.entry.requires) || [];
}
/* The one existing durable submit control for an operation; never matched by
 * label text and never duplicated. */
function workPendingSubmit(op){
  return document.querySelector('[data-fl-op-submit="' + op + '"]');
}
function workPendingSection(op){
  var submit = workPendingSubmit(op);
  if(submit && submit.closest) return submit.closest(".card");
  return null;
}
function workPendingFocusControl(el){
  if(!el) return;
  if(el.scrollIntoView){
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch(_) { el.scrollIntoView(true); }
  }
  if(typeof el.focus === "function"){
    try { el.focus({ preventScroll: true }); } catch(_) { el.focus(); }
  }
  workAnnounce(t("workActionHandoffFocused"));
}
function workPendingContinue(pending){
  var op = workPendingOperation(pending);
  if(!op){ workPendingHandoffReset(); return; }
  var submit = workPendingSubmit(op);
  if(!submit){ workPendingHandoffReset(); flashError(t("workActionHandoffTargetMissing")); return; }
  var requires = workPendingRequires(pending);
  var section = workPendingSection(op);
  for(var i = 0; i < requires.length; i++){
    var field = requires[i];
    if(field === "confirm") continue;
    var input = section ? section.querySelector('[data-fl-op-input="' + field + '"]') : null;
    if(input && !input.value.trim()){
      workPendingFocusControl(input);
      return;
    }
  }
  workPendingFocusControl(submit);
}
function workPendingFailure(taskId, msg){
  var p = S.pendingActionHandoff;
  if(!p || p.taskId !== taskId) return;
  p.failure = msg || t("taskActionFailed");
  var banner = document.getElementById("fl-task-action-pending");
  if(banner){
    var note = banner.querySelector('[data-fl-role="task-action-pending-failure"]');
    if(!note){
      note = h("div", "task-action-pending-failure", "");
      note.setAttribute("data-fl-role", "task-action-pending-failure");
      banner.insertBefore(note, banner.querySelector(".task-action-pending-actions"));
    }
    note.hidden = false;
    note.textContent = t("workActionHandoffFailureTitle") + " " + t("workActionHandoffFailureBody", {
      message: boundedDiagnostic(p.failure)
    });
  }
}
/* Integration stays two-step: after preflight succeeds, the pending handoff
 * advances to the receipt-bound apply step and the banner re-renders. */
function workPendingAdvanceToApply(taskId){
  var p = S.pendingActionHandoff;
  if(!p || p.taskId !== taskId) return;
  if(workPendingOperation(p) !== "integration_preflight") return;
  p.operation = "integration_apply";
  p.failure = null;
  workReplacePendingBanner();
}
function workReplacePendingBanner(){
  var pending = S.pendingActionHandoff;
  var old = document.getElementById("fl-task-action-pending");
  if(!pending || !old || !old.parentNode) return;
  var next = renderPendingActionHandoff(pending);
  old.parentNode.replaceChild(next, old);
}
/* Close stale pending intent safely. The pending entry is retained only when
 * the current Core hierarchy card and its destination actionPolicy still name
 * the same actionable operation and fixed intent. Missing or mismatched Core
 * evidence clears it; Task status or column is never used to decide staleness.
 * When the hierarchy is not loaded yet the pending is kept (a transient
 * unloaded state must not discard user intent). */
function workClearStaleHandoff(task){
  var p = S.pendingActionHandoff;
  if(!p) return;
  if(p.taskId !== task.id){ S.pendingActionHandoff = null; return; }
  var op = workPendingOperation(p);
  if(!op || !S.workHierarchy || typeof S.workHierarchy !== "object") return;
  var found = null;
  workCollectCards(S.workHierarchy, function(card){
    if(!found && card && card.taskId === p.taskId) found = card;
  });
  var policy = found && found.actionPolicy;
  var entry = (policy && policy.schemaVersion === 1
    && policy.destinations && policy.destinations[p.column]) || null;
  var actionable = !!(entry && (entry.disposition === "requestable" || entry.disposition === "needs-input"));
  var opMatches = !!(entry && (entry.operation === op || workPathHasOperation(entry, op)));
  var intentMatches = !p.entry || !p.entry.intent || !!(entry && entry.intent === p.entry.intent);
  if(!found || !entry || !actionable || !opMatches || !intentMatches){
    S.pendingActionHandoff = null;
  }
}
/* True when the destination's ordered path includes the operation. This keeps
 * the Integration apply step valid after preflight advances the handoff. */
function workPathHasOperation(entry, op){
  var path = entry && entry.path;
  if(!Array.isArray(path)) return false;
  for(var i = 0; i < path.length; i++){
    if(path[i] && path[i].operation === op) return true;
  }
  return false;
}
/* Immediate canonical hierarchy refetch after a durable Task operation. The
 * board keeps showing retained evidence until Core returns the new truth. */
function workRefreshHierarchyAfterOperation(){
  fetchSlice("workHierarchy").then(function(){
    if(S.token && S.tab === "work") render();
  });
}
/* Canonical completion bridge: clear the matching pending intent only after
 * success, reload the Task detail (or the caller's chosen detail view), and
 * immediately refetch the Work hierarchy. Never moves a card locally. */
function taskOperationSuccess(taskId, res, refreshView){
  var p = S.pendingActionHandoff;
  if(p && p.taskId === taskId) S.pendingActionHandoff = null;
  if(refreshView) refreshView();
  else if(taskId) showTask(taskId);
  workRefreshHierarchyAfterOperation();
}
/* One confirmed durable Task operation request through the existing endpoint.
 * Success routes to the canonical bridge; failure is retained in the pending
 * context with entered data intact and no automatic retry. */
function taskDurableAction(path, body, btn, taskId, onOk){
  taskAction(path, body, btn, function(res){
    if(onOk) onOk(res);
    else taskOperationSuccess(taskId, res);
  }, function(msg){
    workPendingFailure(taskId, msg);
  });
}

/* Four-section Task Overview: Main asked, Worker returned, Independent result, Final output. */
/* Compact Checks tab badge: total when all pass, failed/total when any
 * failed, and empty when verification is unavailable or has no known total.
 * Never turns "all passed" into a misleading zero. */
function taskChecksTabHint(iv){
  if(!iv || iv.available !== true) return "";
  var total = Number(iv.totalCount);
  if(!Number.isFinite(total) || total < 0) total = 0;
  if(total <= 0 && Array.isArray(iv.checks)) total = iv.checks.length;
  if(total <= 0) return "";
  var failed = Number(iv.failedCount);
  if(!Number.isFinite(failed) || failed < 0) failed = 0;
  if(failed > 0) return String(failed) + "/" + String(total);
  return String(total);
}

/* Overview story: four calm conclusions from safe journey facts only.
 * Raw Worker prose, exact paths, and retained Candidate evidence stay out of
 * the default reading path; they remain in Result & files / More. */
function renderFourSectionOverview(task){
  var j = task.journey || {};
  var a = j.assignment || {};
  var we = j.workerExecution || {};
  var iv = j.independentVerification || {};
  var fd = j.finalDelivery || {};
  var next = j.nextAction || {};
  var files = Array.isArray(we.changedFilePaths) ? we.changedFilePaths : [];
  var attempts = Array.isArray(we.attempts) ? we.attempts : [];
  var statusText = task && task.status ? String(task.status) : "waiting";
  var running = statusText === "running" || statusText === "preparing"
    || statusText === "verifying" || statusText === "active";
  var container = h("div", "task-four-section");
  container.setAttribute("data-fl-role", "task-overview-story");

  // 1. Main's requested result
  var s1 = h("div", "four-section-card");
  s1.setAttribute("data-fl-role", "task-ov-main-asked");
  s1.appendChild(h("div", "four-section-step", "1"));
  s1.appendChild(h("div", "four-section-title", t("taskOvMainAsked")));
  s1.appendChild(h("div", "summary-line dim mb-8", t("taskOvMainAskedHint")));
  var goalText = a.presentation && a.presentation.summary
    ? a.presentation.summary
    : (a.outcome || a.goal || "");
  if(goalText){
    s1.appendChild(reportBlock(
      a.presentation && a.presentation.summary ? t("taskOvMainAskedInputLabel") : t("taskOvMainAskedGoalLabel"),
      goalText, true
    ));
    if(a.presentation && a.presentation.language){
      s1.appendChild(h("div", "dim fs11 mt-4", t("journeyInputLanguage", { lang: a.presentation.language })));
    }
  } else {
    s1.appendChild(h("div", "task-report-empty", t("storyInputMissing")));
  }
  container.appendChild(s1);

  // 2. Execution outcome: counts only; no raw claim, paths, or Candidate
  var s2 = h("div", "four-section-card");
  s2.setAttribute("data-fl-role", "task-ov-worker-returned");
  s2.appendChild(h("div", "four-section-step", "2"));
  s2.appendChild(h("div", "four-section-title", t("taskOvWorkerReturned")));
  s2.appendChild(h("div", "summary-line dim mb-8", t("taskOvWorkerReturnedHint")));
  /* Attempt/file counts are factual evidence only. Never paint this step as
   * a success/failure verdict; check and delivery steps own that meaning. */
  var execConclusion = running
    ? t("taskOvExecutionInProgress")
    : attempts.length
      ? t("taskOvExecutionSummary", {
          attempts: String(attempts.length),
          files: String(files.length)
        })
      : t("taskOvExecutionNoAttempts");
  s2.appendChild(h("div", "four-section-conclusion", execConclusion));
  if(we.provider || we.model || we.runtime){
    s2.appendChild(h("div", "four-section-sub mt-8", t("taskOvWorkerIdentity") + ": " + [
      providerDisplayName(we.provider), we.model, runtimeDisplayName(we.runtime)
    ].filter(Boolean).join(" / ")));
  }
  s2.appendChild(h("div", "summary-line dim fs11 mt-8", t("taskOvEvidenceInResult")));
  container.appendChild(s2);

  // 3. Independent checks: conclusion + first actionable failure only
  var s3 = h("div", "four-section-card");
  s3.setAttribute("data-fl-role", "task-ov-independent-result");
  s3.appendChild(h("div", "four-section-step", "3"));
  s3.appendChild(h("div", "four-section-title", t("taskOvIndependentResult")));
  s3.appendChild(h("div", "summary-line dim mb-8", t("taskOvIndependentResultHint")));
  if(iv && iv.available){
    var totalCount = Number(iv.totalCount);
    if(!Number.isFinite(totalCount) || totalCount < 0) totalCount = 0;
    if(totalCount <= 0 && Array.isArray(iv.checks)) totalCount = iv.checks.length;
    var failedCount = Number(iv.failedCount);
    if(!Number.isFinite(failedCount) || failedCount < 0) failedCount = 0;
    var passedAll = iv.conclusion === "passed";
    var conclusionText = passedAll
      ? t("taskOvChecksPassed", { count: String(totalCount) })
      : t("taskOvChecksFailed", {
          failed: String(failedCount),
          total: String(totalCount)
        });
    s3.appendChild(h("div", "four-section-conclusion" + (passedAll ? " ok" : " err"), conclusionText));
    if(!passedAll && Array.isArray(iv.checks) && iv.checks.length){
      var firstFailed = null;
      for(var ci = 0; ci < iv.checks.length; ci++){
        if(iv.checks[ci] && iv.checks[ci].passed === false){
          firstFailed = iv.checks[ci];
          break;
        }
      }
      if(firstFailed){
        var failRow = h("div", "four-section-failure-summary");
        failRow.setAttribute("data-fl-role", "check-failure-summary");
        failRow.appendChild(h("div", "four-section-failure-label", t("taskOvCheckFailedLabel")
          + ": " + readableVerificationCheckLabel(firstFailed.label)));
        if(firstFailed.failureSummary){
          failRow.appendChild(h("div", "four-section-failure-text", firstFailed.failureSummary));
        } else {
          failRow.appendChild(h("div", "four-section-failure-unavail dim fs11",
            t("taskOvFailureSummaryUnavailable")));
        }
        s3.appendChild(failRow);
      } else {
        s3.appendChild(h("div", "summary-line dim fs11 mt-8", t("taskOvNoFailedSummary")));
      }
    }
  } else {
    s3.appendChild(h("div", "task-report-empty", t("taskOvChecksNotRun")));
  }
  container.appendChild(s3);

  // 4. Final delivery + one next action
  var s4 = h("div", "four-section-card");
  s4.setAttribute("data-fl-role", "task-ov-final-output");
  s4.appendChild(h("div", "four-section-step", "4"));
  s4.appendChild(h("div", "four-section-title", t("taskOvFinalOutput")));
  s4.appendChild(h("div", "summary-line dim mb-8", t("taskOvFinalOutputHint")));
  var repaired = !!(fd.remediationDisposition && fd.remediationDisposition.status === "verified-repaired-delivered");
  var integrated = !!(fd.integration && fd.integration.status === "completed");
  var mainAccepted = !!(fd.mainReview && fd.mainReview.decision === "accept");
  var resolutionStory = j.resolution && j.resolution.status === "resolved" ? j.resolution : null;
  // Delivery and activation always outrank a handled resolution: a real
  // delivered outcome is presented as delivered, with resolution only as
  // secondary history.
  if(repaired){
    s4.appendChild(h("div", "four-section-conclusion ok", t("taskOvDelivered")));
  } else if(integrated){
    s4.appendChild(h("div", "four-section-conclusion ok", t("taskOvIntegrated")));
  } else if(mainAccepted){
    s4.appendChild(h("div", "four-section-conclusion ok", t("taskOvReadyIntegrate")));
  } else if(resolutionStory){
    s4.appendChild(h("div", "four-section-conclusion handled", t("taskOvHandled", {
      reason: attentionResolutionReasonLabel(resolutionStory.reason || "handled-elsewhere")
    })));
  } else {
    if(statusText === "succeeded" || statusText === "completed"){
      s4.appendChild(h("div", "task-report-empty", t("taskOvPendingReview")));
    } else if(running){
      s4.appendChild(h("div", "task-report-empty", t("taskOvPendingWorker")));
    } else {
      s4.appendChild(h("div", "task-report-empty", t("taskOvNoOutput")));
    }
  }
  if(fd.mainReview && fd.mainReview.decision){
    s4.appendChild(h("div", "four-section-sub mt-8", t("taskReportMainDecision") + ": "
      + reviewDecisionLabel(fd.mainReview.decision)));
  }
  var nextText = nextActionLabel(next.label || "investigate");
  s4.appendChild(h("div", "four-section-next mt-8", nextText));
  container.appendChild(s4);

  return container;
}

/* Primary Task workbench: sticky hero + tabbed sections so one screen is not a wall of cards. */
function failureAttributionAssessmentText(value){
  if(value === "counts") return t("failureAttributionCounts");
  if(value === "excluded") return t("failureAttributionExcluded");
  return t("failureAttributionUncertain");
}

function renderFailureAttributionCard(task){
  var fa = task && task.failureAttribution;
  if(!fa || typeof fa !== "object" || fa.machineOutcome !== "failed") return null;
  var card = h("div", "task-report-card failure-attribution-card");
  card.setAttribute("data-fl-role", "failure-attribution");
  card.appendChild(h("div", "task-report-card-title", t("failureAttributionTitle")));
  card.appendChild(h("div", "summary-line", t("failureAttributionMachineFailed")));
  card.appendChild(h("div", "summary-line", failureAttributionAssessmentText(fa.abilityAssessment)));
  if(fa.reason === "ready"){
    card.appendChild(h("div", "summary-line dim", t("failureAttributionReady")));
  } else if(fa.reason === "invalid-history"){
    card.appendChild(h("div", "summary-line dim", t("failureAttributionInvalid")));
  }
  if(fa.attribution && fa.attribution.note){
    card.appendChild(h("div", "task-report-label", t("failureAttributionNoteLabel")));
    card.appendChild(h("div", "task-report-block", String(fa.attribution.note)));
  }
  return card;
}

function renderFailureAttributionControls(task){
  var fa = task && task.failureAttribution;
  if(!fa || !fa.eligible || !fa.binding) return null;
  var card = h("div", "card form-card failure-attribution-controls");
  card.setAttribute("data-fl-role", "failure-attribution-controls");
  card.appendChild(h("div", "card-title mb-4", t("failureAttributionActionTitle")));
  card.appendChild(h("div", "summary-line dim mb-8", t("failureAttributionActionHint")));
  var causeLabel = h("label", "", t("failureAttributionCauseLabel"));
  var cause = h("select", "");
  [
    ["candidate", "failureAttributionCauseCandidate"],
    ["verification-infrastructure", "failureAttributionCauseInfrastructure"],
    ["acceptance-contract", "failureAttributionCauseContract"],
    ["insufficient-evidence", "failureAttributionCauseInsufficient"]
  ].forEach(function(pair){
    var option = document.createElement("option");
    option.value = pair[0];
    option.textContent = t(pair[1]);
    cause.appendChild(option);
  });
  causeLabel.appendChild(cause);
  card.appendChild(causeLabel);
  var note = document.createElement("textarea");
  note.maxLength = 500;
  note.rows = 3;
  note.placeholder = t("failureAttributionNotePlaceholder");
  card.appendChild(note);
  var button = h("button", "btn sm primary", t("failureAttributionRecord"));
  button.type = "button";
  button.addEventListener("click", function(){
    var explanation = note.value.trim();
    if(!explanation){ flashError(t("failureAttributionNoteRequired")); return; }
    if(!window.confirm(t("failureAttributionConfirm"))) return;
    var binding = fa.binding;
    var body = {
      attemptId: binding.attemptId,
      verificationEventSequence: binding.verificationEventSequence,
      cause: cause.value,
      note: explanation,
      confirm: true
    };
    if(binding.candidateRevisionId !== undefined){
      body.candidateRevisionId = binding.candidateRevisionId;
      body.candidatePatchDigest = binding.candidatePatchDigest;
    }
    taskAction(
      "/api/ops/tasks/" + encodeURIComponent(task.id) + "/failure-attribution",
      body,
      button,
      function(){ showTask(task.id); }
    );
  });
  card.appendChild(hd("div", "actions", [button]));
  return card;
}

function renderTaskWorkbench(task, extraTabs){
  var j = task.journey || {};
  var a = j.assignment || {};
  var we = j.workerExecution || {};
  var iv = j.independentVerification || {};
  var fd = j.finalDelivery || {};
  var cause = j.cause || {};
  var next = j.nextAction || {};
  var presentation = taskStoryPresentation(task);
  var shell = h("div", "task-report-grid");
  shell.setAttribute("data-fl-role", "task-workbench");

  var hero = h("div", "task-report-hero");
  hero.setAttribute("data-fl-role", "task-story-current-result");
  hero.appendChild(h("div", "task-report-hero-title", task.name || t("taskUntitled")));
  var meta = h("div", "task-report-hero-meta");
  meta.appendChild(taskHeadlineBadge(task));
  // Avoid a duplicate delivery badge when the headline already states the
  // verified final outcome; the journey below keeps the full delivery evidence.
  var finalBadge = taskHeadline(task).delivered ? null : finalDeliveryBadge(task);
  if(finalBadge) meta.appendChild(finalBadge);
  if(cause.failureCategory){
    meta.appendChild(h("span", "badge badge-err", failureCategoryLabel(cause.failureCategory)));
  }
  meta.appendChild(h("span", "dim fs12", taskProgressSummary(task)));
  hero.appendChild(meta);
  if(cause.why || cause.what){
    var heroRepaired = hasVerifiedFinalDelivery(task);
    var heroAmended = !!(heroRepaired
      && fd.remediationDisposition
      && fd.remediationDisposition.acceptanceBasis === "amended-acceptance");
    var heroMachinePassed = task.status === "succeeded" || task.status === "completed";
    var whyText = heroRepaired
      ? (heroAmended
        ? t("journeyCauseWhyAmended")
        : (heroMachinePassed
          ? t("journeyCauseWhyRepairedAfterMachinePass")
          : t("journeyCauseWhyRepaired")))
      : resolveCauseWhy(
          cause.what,
          cause.why,
          cause.failureCategory,
          fd.mainReview && fd.mainReview.decision
        );
    // A handled failure leads with the resolution banner unless a real
    // delivered outcome exists, which outranks handled copy. The original
    // failure explanation is preserved in the what-box below it.
    var heroResolution = !hasVerifiedFinalDelivery(task)
      && j.resolution && j.resolution.status === "resolved"
      ? j.resolution
      : null;
    if(heroResolution){
      var handledBox = h("div", "task-report-hero-box attention-handled-box");
      handledBox.appendChild(h("div", "task-report-hero-box-label", t("attentionResolvedHeroLabel")));
      handledBox.appendChild(h("div", "task-report-hero-box-body", t("attentionResolvedHeroBody", {
        reason: attentionResolutionReasonLabel(heroResolution.reason || "handled-elsewhere")
      })));
      if(heroResolution.evidenceTaskId){
        var heroEvBtn = h("button", "btn sm mt-8", t("attentionResolvedEvidenceOpen"));
        heroEvBtn.type = "button";
        heroEvBtn.addEventListener("click", function(){ showTask(heroResolution.evidenceTaskId); });
        handledBox.appendChild(heroEvBtn);
      }
      hero.appendChild(handledBox);
    }
    if(whyText){
      var whatBox = h("div", "task-report-hero-box");
      whatBox.appendChild(h("div", "task-report-hero-box-label", t("taskHeroWhatHappened")));
      whatBox.appendChild(h("div", "task-report-hero-box-body", whyText));

      // Show first safe failure summary from failed checks
      if(iv.checks && iv.checks.length){
        var firstFailed = null;
        for(var fi = 0; fi < iv.checks.length; fi++){
          if(!iv.checks[fi].passed){ firstFailed = iv.checks[fi]; break; }
        }
        if(firstFailed && firstFailed.failureSummary){
          whatBox.appendChild(h("div", "task-hero-failure-summary", t("taskHeroFailureCheck", {
            label: readableVerificationCheckLabel(firstFailed.label),
            summary: firstFailed.failureSummary
          })));
        } else if(firstFailed){
          whatBox.appendChild(h("div", "task-hero-failure-summary dim", t("taskHeroFailureCheckNoSummary", {
            label: readableVerificationCheckLabel(firstFailed.label)
          })));
        }
      }
      hero.appendChild(whatBox);
    }
  }
  var nextBox = h("div", "task-report-hero-box");
  nextBox.appendChild(h("div", "task-report-hero-box-label", t("taskHeroWhatToDo")));
  nextBox.appendChild(h("div", "task-report-hero-box-body",
    nextActionLabel(next.label || "investigate")));
  hero.appendChild(nextBox);
  shell.appendChild(hero);

  // --- Tab bodies ---
  // Overview: four-section collaboration summary
  var overviewBody = h("div", "task-tab-body");
  overviewBody.appendChild(h("div", "task-report-card-hint", t("taskTabOverviewHint")));
  overviewBody.appendChild(renderFourSectionOverview(task));

  // Render routingDecision if present in the task spec
  var rd = task && task.routingDecision;
  if(rd){
    overviewBody.appendChild(renderRoutingDecisionCard(rd));
  }
  var competitionContextCard = renderTaskCompetitionContext(task && task.competitionContext);
  if(competitionContextCard) overviewBody.appendChild(competitionContextCard);

  // 1) Instruction
  var instrNodes = [];
  var goalText = a.presentation && a.presentation.summary
    ? a.presentation.summary
    : (a.outcome || a.goal || "");
  if(goalText){
    instrNodes.push(reportBlock(
      a.presentation && a.presentation.summary ? t("storyInputMainAuthoredLabel") : t("taskReportGoalLabel"),
      goalText,
      true
    ));
  } else {
    instrNodes.push(h("div", "task-report-empty", t("storyInputMissing")));
  }
  if(a.inScope && a.inScope.length) instrNodes.push(reportList(t("taskReportInScope"), a.inScope, false));
  if(a.outOfScope && a.outOfScope.length) instrNodes.push(reportList(t("taskReportOutOfScope"), a.outOfScope, false));
  if(a.executionSteps && a.executionSteps.length) instrNodes.push(reportList(t("taskReportSteps"), a.executionSteps, false));
  if(a.deliverables && a.deliverables.length) instrNodes.push(reportList(t("storyInputDeliverablesLabel"), a.deliverables, false));
  if(a.focusPaths && a.focusPaths.length) instrNodes.push(reportList(t("taskReportFocus"), a.focusPaths, true));
  if(a.acceptanceCriteria && a.acceptanceCriteria.length){
    instrNodes.push(reportList(t("taskReportAcceptCriteria"), a.acceptanceCriteria, false));
  }
  if(a.acceptanceCommands && a.acceptanceCommands.length){
    instrNodes.push(reportList(t("taskReportAcceptChecks"), a.acceptanceCommands, false));
  }
  if(a.constraints && a.constraints.length){
    instrNodes.push(reportList(t("taskReportConstraints"), a.constraints, false));
  }
  var instrBody = h("div", "task-tab-body");
  instrBody.appendChild(reportCard(
    t("taskReportInstrTitle"),
    t("taskReportInstrHint"),
    instrNodes,
    "task-story-step-main-input"
  ));

  // 2) Process
  var processNodes = [];
  processNodes.push(reportBlock(
    t("storyWorkerUsedLabel"),
    t("journeyWorkerIdentitySentence", {
      provider: providerDisplayName(we.provider),
      model: we.model || "?",
      runtime: runtimeDisplayName(we.runtime)
    }),
    false
  ));
  var attemptBox = h("div", "task-report-process");
  attemptBox.setAttribute("data-fl-role", "task-story-step-worker-process");
  if(we.attempts && we.attempts.length){
    we.attempts.forEach(function(att){
      var line = h("div", "task-report-attempt");
      var turns = att.turns === undefined ? "" : t("journeyTurns", { count: String(att.turns) });
      var exit = att.exitCode === undefined || att.exitCode === 0
        ? "" : t("journeyExitCode", { code: String(att.exitCode) });
      line.appendChild(h("div", "", t("journeyAttemptLabel", { ordinal: String(att.ordinal) })
        + " · " + attemptPrimaryLabel(att)
        + (turns ? " · " + turns : "")
        + (exit ? " · " + exit : "")));
      var processExplain = attemptPresentationExplain(att);
      if(processExplain){
        line.appendChild(h("div", "summary-line dim", processExplain));
      }
      if(attemptHasClosedPresentation(att)){
        line.appendChild(h("div", "dim fs11", t("journeyAttemptRecordedStatus", {
          status: attemptStateLabel(att.status)
        })));
      }
      if(att.startedAt || att.finishedAt){
        line.appendChild(h("div", "dim fs11",
          (att.startedAt ? t("journeyStartedAt", { time: fmtTm(att.startedAt) }) : "")
          + (att.finishedAt ? " · " + t("journeyFinishedAt", { time: fmtTm(att.finishedAt) }) : "")
        ));
      }
      attemptBox.appendChild(line);
    });
  } else {
    attemptBox.appendChild(h("div", "task-report-empty", t("journeyNoAttempts")));
  }
  processNodes.push(attemptBox);
  if(task.timeline && task.timeline.length){
    var tl = h("div", "timeline");
    tl.setAttribute("data-fl-role", "task-process-timeline");
    task.timeline.slice().reverse().slice(0, 40).forEach(function(e){
      var te = h("div", "timeline-entry");
      te.appendChild(h("span", "ts", fmtTm(e.timestamp)));
      te.appendChild(h("span", "tl-kind", timelineEventLabel(e.type)));
      te.appendChild(h("span", "tl-summary", timelineEventSummary(e)));
      tl.appendChild(te);
    });
    var tlWrap = h("div", "task-report-block");
    tlWrap.appendChild(h("div", "task-report-label", t("taskReportTimelineLabel")));
    tlWrap.appendChild(tl);
    processNodes.push(tlWrap);
  } else {
    processNodes.push(h("div", "task-report-empty", t("taskReportTimelineEmpty")));
  }
  var processBody = h("div", "task-tab-body");
  processBody.appendChild(reportCard(
    t("taskReportProcessTitle"),
    t("taskReportProcessHint"),
    processNodes,
    "task-report-process"
  ));

  // 3) Result + artifacts: meaning first; raw Worker report is progressive evidence
  var resultNodes = [];
  var claimStep = presentation.steps.find(function(s){ return s.id === "worker-output"; });
  if(claimStep && claimStep.bodyKey){
    var outcomeTone = claimStep.state === "complete" ? " ok"
      : claimStep.state === "failed" ? " err" : "";
    resultNodes.push(h("div", "four-section-conclusion" + outcomeTone,
      t(claimStep.bodyKey, claimStep.params || {})));
  } else {
    resultNodes.push(h("div", "task-report-empty", t("storyWorkerOutputNone")));
  }
  resultNodes.push(h("div", "summary-line dim fs11", t("taskReportClaimNotProof")));
  if(we.workerClaim && we.workerClaim.text){
    var claimBody = h("div", "worker-claim-preview");
    claimBody.setAttribute("data-fl-role", "worker-claim-text");
    claimBody.textContent = we.workerClaim.text;
    var claimDetails = journeyDisclosure(t("taskReportClaimDisclosure"), claimBody);
    claimDetails.setAttribute("data-fl-role", "worker-claim-disclosure");
    claimDetails.classList.add("task-result-claim-disclosure");
    resultNodes.push(claimDetails);
    resultNodes.push(h("div", "summary-line dim fs11", t("taskReportClaimDisclosureHint")));
  } else {
    resultNodes.push(h("div", "task-report-empty", t("journeyNoWorkerClaim")));
  }
  var files = Array.isArray(we.changedFilePaths) ? we.changedFilePaths : [];
  var resultBody = h("div", "task-tab-body");
  resultBody.appendChild(reportCard(
    t("taskReportResultTitle"),
    t("taskReportResultHint"),
    resultNodes,
    "task-story-step-worker-output"
  ));
  resultBody.appendChild(reportCard(
    t("taskReportArtifactsTitle"),
    t("taskReportArtifactsHint", { count: String(files.length) }),
    [reportList(null, files, true)],
    "task-report-artifacts"
  ));
  var resultRetained = renderRetainedCandidate(task);
  if(resultRetained) resultBody.appendChild(resultRetained);
  // Explain an independent judge review when one exists (evidence only).
  if(task.reviewGraph && typeof task.reviewGraph === "object"){
    var judgeStatusCard = renderJudgeReviewCard(task);
    if(judgeStatusCard) resultBody.appendChild(judgeStatusCard);
  }

  // 4) Checks + final handling
  var checkNodes = [];
  if(iv && iv.available){
    var conclusion = iv.conclusion === "passed"
      ? t("journeyVerifPassed")
      : t("journeyVerifFailedCount", {
          failed: String(iv.failedCount || 0), total: String(iv.totalCount || 0)
        });
    checkNodes.push(reportBlock(t("taskReportCheckConclusion"), conclusion, true));
    if(iv.checks && iv.checks.length){
      var rows = h("div", "task-report-process");
      iv.checks.forEach(function(chk){
        var row = h("div", "task-report-attempt");
        row.setAttribute("data-fl-role", "verification-check");
        row.appendChild(h("span", "badge " + (chk.passed ? "badge-ok" : "badge-err"),
          chk.passed ? t("journeyCheckPassed") : t("journeyCheckFailed")));
        row.appendChild(document.createTextNode("  " + readableVerificationCheckLabel(chk.label)));
        rows.appendChild(row);
      });
      checkNodes.push(rows);
    }
  } else {
    checkNodes.push(h("div", "task-report-empty", t("journeyVerifUnavailable")));
  }
  var finalNodes = [];
  if(fd.mainReview){
    finalNodes.push(reportBlock(
      t("taskReportMainDecision"),
      reviewDecisionLabel(fd.mainReview.decision)
        + (fd.mainReview.reason ? " - " + fd.mainReview.reason : ""),
      true
    ));
  }
  if(fd.remediationDisposition){
    finalNodes.push(reportBlock(
      t("taskReportFinalDelivery"),
      fd.remediationDisposition.acceptanceBasis === "amended-acceptance"
        ? t("journeyRemediationAmended")
        : t("journeyRemediationDelivered"),
      false
    ));
  }
  if(fd.integration){
    finalNodes.push(reportBlock(
      t("taskReportIntegration"),
      integrationStateLabel(fd.integration.status),
      false
    ));
  }
  if(!finalNodes.length){
    finalNodes.push(h("div", "task-report-empty", t("journeyDeliveryNone")));
  }
  var checksBody = h("div", "task-tab-body");
  checksBody.appendChild(reportCard(
    t("taskReportChecksTitle"),
    t("taskReportChecksHint"),
    checkNodes,
    "task-story-step-main-check"
  ));
  var failureAttributionCard = renderFailureAttributionCard(task);
  if(failureAttributionCard) checksBody.appendChild(failureAttributionCard);
  checksBody.appendChild(reportCard(
    t("taskReportFinalTitle"),
    t("taskReportFinalHint"),
    finalNodes,
    "task-story-step-final-result"
  ));

  var attemptCount = we.attempts && we.attempts.length ? String(we.attempts.length) : "0";
  var fileCount = String(files.length);
  // Checks badge: total on all-pass, failed/total on failure, absent when unknown.
  var checksHint = taskChecksTabHint(iv);

  var tabs = [
    { id: "overview", label: t("taskTabOverview"), body: overviewBody },
    { id: "instruction", label: t("taskTabInstruction"), body: instrBody },
    { id: "process", label: t("taskTabProcess"), hint: attemptCount, body: processBody },
    { id: "result", label: t("taskTabResult"), hint: fileCount, body: resultBody },
    { id: "checks", label: t("taskTabChecks"), hint: checksHint, body: checksBody }
  ];
  (extraTabs || []).forEach(function(tab){ tabs.push(tab); });

  var active = taskDetailActiveTab;
  if(!tabs.some(function(tab){ return tab.id === active; })) active = "overview";
  shell.appendChild(renderTaskTabShell(tabs, active));
  return shell;
}

/* Attention-resolution controls for the Actions tab. A resolved failure
 * shows the handled explanation plus the one Reopen action; an unresolved
 * failed/interrupted Task gets a confirmation-gated Resolve flow with one
 * closed reason, a bounded note, and an optional evidence Task id. The
 * machine status and original failure evidence are never changed here. */
function renderAttentionResolutionControls(task){
  var failed = task.status === "failed" || task.status === "interrupted";
  if(!failed) return null;
  var resolution = task.attentionResolution;
  var resolved = resolution && resolution.status === "resolved";
  var card = h("div", "card form-card attention-resolution-controls");
  if(resolved){
    card.setAttribute("data-fl-role", "attention-resolved-controls");
    card.setAttribute("data-fl-op-target", "task_reopen");
    card.appendChild(h("div", "card-title mb-4", t("attentionResolvedTitle")));
    card.appendChild(h("div", "summary-line dim mb-8", t("attentionResolvedHint")));
    card.appendChild(h("div", "summary-line", t("attentionResolvedReasonLabel", {
      reason: attentionResolutionReasonLabel(resolution.reason || "handled-elsewhere")
    })));
    if(resolution.note){
      card.appendChild(h("div", "summary-line dim mt-4", resolution.note));
    }
    if(resolution.evidenceTaskId){
      var evidenceBtn = h("button", "btn sm mt-8", t("attentionResolvedEvidenceOpen"));
      evidenceBtn.type = "button";
      evidenceBtn.addEventListener("click", function(){ showTask(resolution.evidenceTaskId); });
      card.appendChild(evidenceBtn);
    }
    card.appendChild(h("div", "summary-line dim mt-8", t("attentionResolvedOriginalKept")));
    var reopenLab = h("label", "", t("attentionReopenNote"));
    var reopenIn = h("input", "");
    reopenIn.type = "text";
    reopenIn.setAttribute("data-fl-op-input", "note");
    reopenIn.placeholder = t("attentionReopenNotePh");
    reopenLab.appendChild(reopenIn);
    card.appendChild(reopenLab);
    var reopenBtn = h("button", "btn sm", t("attentionReopenBtn"));
    reopenBtn.type = "button";
    reopenBtn.setAttribute("data-fl-op-submit", "task_reopen");
    reopenBtn.addEventListener("click", function(){
      if(!window.confirm(t("attentionReopenConfirm"))) return;
      var reopenNote = reopenIn.value.trim();
      var body = { confirm: true };
      if(reopenNote) body.note = reopenNote;
      taskDurableAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/reopen", body, reopenBtn, task.id);
    });
    card.appendChild(hd("div", "actions", [reopenBtn]));
    return card;
  }
  card.setAttribute("data-fl-role", "attention-resolve-controls");
  card.setAttribute("data-fl-op-target", "task_resolve");
  card.appendChild(h("div", "card-title mb-4", t("attentionResolveTitle")));
  card.appendChild(h("div", "summary-line dim mb-8", t("attentionResolveHint")));
  var reasonLab = h("label", "", t("attentionResolveReasonLabel"));
  var reasonSel = h("select", "");
  /* No handled-failure reason is preselected: the pending handoff must not
   * silently accept a default. An explicit choice is required to resolve. */
  var placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("attentionResolveReasonPh");
  reasonSel.appendChild(placeholder);
  [
    ["environment-recovered", t("attentionResolvedReasonEnvironment")],
    ["superseded", t("attentionResolvedReasonSuperseded")],
    ["handled-elsewhere", t("attentionResolvedReasonHandledElsewhere")],
    ["no-longer-needed", t("attentionResolvedReasonNoLongerNeeded")]
  ].forEach(function(pair){
    var o = document.createElement("option");
    o.value = pair[0];
    o.textContent = pair[1];
    reasonSel.appendChild(o);
  });
  reasonSel.setAttribute("data-fl-op-input", "reason");
  reasonLab.appendChild(reasonSel);
  card.appendChild(reasonLab);
  var noteLab = h("label", "", t("attentionResolveNote"));
  var noteIn = h("input", "");
  noteIn.type = "text";
  noteIn.setAttribute("data-fl-op-input", "note");
  noteIn.placeholder = t("attentionResolveNotePh");
  noteLab.appendChild(noteIn);
  card.appendChild(noteLab);
  var evidenceLab = h("label", "", t("attentionResolveEvidence"));
  var evidenceIn = h("input", "");
  evidenceIn.type = "text";
  evidenceIn.setAttribute("data-fl-op-input", "evidence");
  evidenceIn.placeholder = t("attentionResolveEvidencePh");
  evidenceLab.appendChild(evidenceIn);
  card.appendChild(evidenceLab);
  var resolveBtn = h("button", "btn sm", t("attentionResolveBtn"));
  resolveBtn.type = "button";
  resolveBtn.setAttribute("data-fl-op-submit", "task_resolve");
  resolveBtn.addEventListener("click", function(){
    if(!reasonSel.value.trim()){ flashError(t("attentionResolveReasonRequired")); return; }
    if(!window.confirm(t("attentionResolveConfirm"))) return;
    var resolveNote = noteIn.value.trim();
    var body = { reason: reasonSel.value, confirm: true };
    if(resolveNote) body.note = resolveNote;
    var evidence = evidenceIn.value.trim();
    if(evidence) body.evidenceTaskId = evidence;
    taskDurableAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/resolve", body, resolveBtn, task.id);
  });
  card.appendChild(hd("div", "actions", [resolveBtn]));
  return card;
}

function showTask(id, crumb){
  S.detailTaskId = String(id || "");
  workMarkSelectedCard(S.detailTaskId);
  S.taskCrumb = resolveTaskBreadcrumb(S.taskCrumb, id, crumb);
  if(workIsNarrowViewport()) workApplyMobilePane(workNextMobilePane(S.workMobilePane, "open-detail"));
  workScheduleReadingContextSave();
  loadingDetail(t("taskDetailLoading"));
  fetchJSON("/api/ops/tasks/" + encodeURIComponent(id)).then(function(task){
    var f = fr();
    var shell = h("div", "detail-shell");
    var top = h("div", "detail-topbar");
    var back = closeBtn();
    back.textContent = t("taskReportBack");
    top.appendChild(back);
    top.appendChild(renderTaskBreadcrumb(S.taskCrumb));
    shell.appendChild(top);

    // Actions tab body is filled below, then passed into the tabbed workbench.
    var actionsBody = h("div", "task-tab-body task-manual-actions");
    /* FL-109C2A/FL-109C2B: a bounded pending-action handoff lands at the top
     * of the Actions tab. It explains the chosen destination, exact operation,
     * fixed intent, required input, and ordered path in plain language, states
     * plainly that nothing has changed yet, and never submits anything. Stale
     * pending intent is closed first; a matching one drives the guided step. */
    workClearStaleHandoff(task);
    var pending = S.pendingActionHandoff;
    if(pending && pending.taskId === task.id){
      taskDetailActiveTab = "actions";
      actionsBody.appendChild(renderPendingActionHandoff(pending));
    }
    actionsBody.appendChild(h("div", "task-report-card-hint", t("taskTabActionsHint")));
    actionsBody.appendChild(h("div", "summary-line dim mb-8", t("taskManualActionsHint")));
    var manualActionsBody = actionsBody;

    var failureAttributionControls = renderFailureAttributionControls(task);
    if(failureAttributionControls) manualActionsBody.appendChild(failureAttributionControls);

    // Attention resolution: close a handled failure or reopen it. The machine
    // status and original failure evidence stay unchanged.
    var attentionResolutionControls = renderAttentionResolutionControls(task);
    if(attentionResolutionControls) manualActionsBody.appendChild(attentionResolutionControls);

    // Supervision panel
    var sup = h("div", "card form-card");
    sup.appendChild(h("div", "card-title mb-4", t("taskSupervise")));
    sup.appendChild(h("div", "summary-line dim mb-8", t("taskSuperviseHint")));
    var fbLab = h("label", "", t("taskFeedback"));
    var fbIn = h("input", "");
    fbIn.type = "text";
    fbIn.setAttribute("data-fl-op-input", "feedback");
    fbIn.placeholder = t("taskFeedbackPh");
    fbLab.appendChild(fbIn);
    sup.appendChild(fbLab);
    var cbLab = h("label", "mb-4", t("taskCorrectBudget"));
    var cbIn = h("input", "");
    cbIn.type = "number";
    cbIn.min = "0.01";
    cbIn.step = "any";
    cbIn.id = "fl-correct-budget";
    cbIn.placeholder = t("taskCorrectBudgetPh");
    cbLab.appendChild(cbIn);
    sup.appendChild(cbLab);
    var supAct = h("div", "actions");
    var resumeBtn = h("button", "btn sm primary", t("taskResume"));
    resumeBtn.type = "button";
    resumeBtn.setAttribute("data-fl-op-submit", "resume");
    resumeBtn.addEventListener("click", function(){
      var body = {};
      if(fbIn.value.trim()) body.feedback = fbIn.value.trim();
      taskDurableAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/resume", body, resumeBtn, task.id);
    });
    supAct.appendChild(resumeBtn);
    var reviseBtn = h("button", "btn sm", t("taskRevise"));
    reviseBtn.type = "button";
    reviseBtn.setAttribute("data-fl-op-submit", "revise");
    reviseBtn.addEventListener("click", function(){
      if(!fbIn.value.trim()){ flashError(t("taskFeedbackRequired")); return; }
      taskDurableAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/revise", {
        feedback: fbIn.value.trim()
      }, reviseBtn, task.id);
    });
    supAct.appendChild(reviseBtn);
    // Correction eligibility comes from the canonical core and is never duplicated in UI.
    var corrElig = task.correctionEligibility;
    var corrEligible = !!(corrElig && corrElig.eligible);

    if(corrElig){
      if(corrElig.eligible){
        sup.appendChild(h("div", "summary-line dim", t("taskCorrectLimitValue", {
          remaining: String(corrElig.allowance.remaining),
          total: String(corrElig.allowance.max)
        })));
        if(corrElig.latestRevision){
          sup.appendChild(h("div", "summary-line dim fs11", t("taskCorrectRevisionValue", {
            ordinal: String(corrElig.latestRevision.attemptOrdinal),
            files: String(corrElig.latestRevision.filesChanged),
            lines: String(corrElig.latestRevision.changedLines),
            digest: corrElig.latestRevision.digestPrefix || ""
          })));
        }
      } else {
        sup.appendChild(h("div", "summary-line dim mb-4", t("taskCorrectUnavailable", {
          reason: correctionRejectionLabel(corrElig.category)
        })));
      }
    }

    if(corrEligible && corrElig.latestRevision){
      var gapCard = h("div", "task-correction-gap");
      gapCard.appendChild(h("div", "section-title", t("taskCorrectGapTitle")));
      gapCard.appendChild(h("div", "summary-line dim mb-8", t("taskCorrectGapHint")));
      gapCard.appendChild(h("div", "summary-line", t("taskCorrectGapReusableLabel")));
      var affected = Array.isArray(corrElig.latestRevision.affectedPaths)
        ? corrElig.latestRevision.affectedPaths : [];
      affected.forEach(function(candidatePath){
        var pathLabel = h("label", "check-row");
        var pathInput = document.createElement("input");
        pathInput.type = "checkbox";
        pathInput.checked = false;
        pathInput.value = String(candidatePath);
        pathInput.setAttribute("data-fl-role", "correct-reusable-path");
        pathLabel.appendChild(pathInput);
        pathLabel.appendChild(document.createTextNode(" " + String(candidatePath)));
        gapCard.appendChild(pathLabel);
      });
      gapCard.appendChild(h("div", "summary-line mt-8", t("taskCorrectGapRemainingLabel")));
      var gapList = h("div", "task-correction-gap-list");
      var addCorrectionGap = function(){
        if(gapList.children.length >= 8){ flashError(t("taskCorrectGapTooMany")); return; }
        var gapEntry = h("div", "task-correction-gap-entry");
        gapEntry.setAttribute("data-fl-role", "correct-gap-entry");
        var gapDesc = document.createElement("input");
        gapDesc.type = "text";
        gapDesc.placeholder = t("taskCorrectGapDescPh");
        gapDesc.setAttribute("data-fl-role", "correct-gap-desc");
        var gapExpect = document.createElement("input");
        gapExpect.type = "text";
        gapExpect.placeholder = t("taskCorrectGapExpectPh");
        gapExpect.setAttribute("data-fl-role", "correct-gap-expect");
        var removeGap = h("button", "btn sm", t("taskCorrectGapRemove"));
        removeGap.type = "button";
        removeGap.addEventListener("click", function(){
          if(gapList.children.length <= 1){ flashError(t("taskCorrectGapTooFew")); return; }
          gapEntry.remove();
        });
        gapEntry.appendChild(gapDesc);
        gapEntry.appendChild(gapExpect);
        gapEntry.appendChild(removeGap);
        gapList.appendChild(gapEntry);
      };
      addCorrectionGap();
      gapCard.appendChild(gapList);
      var addGap = h("button", "btn sm", t("taskCorrectGapAdd"));
      addGap.type = "button";
      addGap.addEventListener("click", addCorrectionGap);
      gapCard.appendChild(addGap);
      sup.appendChild(gapCard);
    }

    var correctBtn = h("button", "btn sm", t("taskCorrect"));
    correctBtn.type = "button";
    correctBtn.title = t("taskCorrectHint");
    correctBtn.setAttribute("data-fl-op-submit", "correct");
    if(!corrEligible) correctBtn.disabled = true;
    correctBtn.addEventListener("click", function(){
      if(!fbIn.value.trim()){ flashError(t("taskFeedbackRequired")); return; }
      if(!window.confirm(t("taskCorrectConfirm") + "\n\n" + t("taskCorrectReuse") + "\n" + t("taskCorrectRerun"))) return;
      var body = { feedback: fbIn.value.trim(), confirm: true };
      var budgetEl = document.getElementById("fl-correct-budget");
      if(budgetEl && budgetEl.value.trim()){
        var b = Number(budgetEl.value.trim());
        if(!Number.isFinite(b) || b <= 0){ flashError(t("taskCorrectBudgetInvalid")); return; }
        body.maxBudgetUsd = b;
      }
      // Structured gap contract is required for revisioned candidates.
      if(corrElig && corrElig.latestRevision){
        body.candidateRevisionId = corrElig.latestRevision.id;
      }
      var pathInputs = document.querySelectorAll('[data-fl-role="correct-reusable-path"]');
      var paths = [];
      pathInputs.forEach(function(el){
        if(el.checked && el.value.trim()) paths.push(el.value.trim());
      });
      body.reusablePaths = paths;
      var gapContainers = document.querySelectorAll('[data-fl-role="correct-gap-entry"]');
      var gaps = [];
      gapContainers.forEach(function(container){
        var descEl = container.querySelector('[data-fl-role="correct-gap-desc"]');
        var expectEl = container.querySelector('[data-fl-role="correct-gap-expect"]');
        var desc = descEl ? descEl.value.trim() : "";
        var expect = expectEl ? expectEl.value.trim() : "";
        if(desc.length < 10){ flashError(t("taskCorrectGapDescTooShort")); return; }
        if(expect.length < 10){ flashError(t("taskCorrectGapExpectTooShort")); return; }
        gaps.push({ description: desc, acceptanceExpectation: expect });
      });
      if(gaps.length !== gapContainers.length || gaps.length < 1) return;
      body.remainingGaps = gaps;
      taskDurableAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/correct", body, correctBtn, task.id);
    });
    supAct.appendChild(correctBtn);
    sup.appendChild(supAct);

    // Reverify-only control: verification-only rerun, no Worker, no Attempt.
    // Distinct from correct (which launches a Worker). Eligibility comes from
    // the canonical core via the daemon; the UI never duplicates that logic.
    sup.appendChild(h("div", "summary-line dim mb-8", t("taskReverifyThreeWay")));
    var elig = task.candidateReverificationEligibility;
    var reverifyReasonLab = h("label", "", t("taskReverifyReason"));
    var reverifyReasonIn = h("input", "");
    reverifyReasonIn.type = "text";
    reverifyReasonIn.id = "fl-reverify-reason";
    reverifyReasonIn.placeholder = t("taskReverifyReasonPh");
    reverifyReasonLab.appendChild(reverifyReasonIn);
    sup.appendChild(reverifyReasonLab);
    var reverifyBtn = h("button", "btn sm", t("taskReverify"));
    reverifyBtn.type = "button";
    reverifyBtn.title = (elig && elig.eligiblePath === "runtime-workspace")
      ? t("taskReverifyRuntimeHint")
      : t("taskReverifyHint");
    var reverifyEligible = !!(elig && elig.eligible);
    if(elig){
      if(elig.eligible){
        sup.appendChild(h("div", "summary-line dim", t("taskReverifyLimitValue", {
          remaining: String(elig.allowance.remaining),
          total: String(elig.allowance.max),
          source: elig.allowance.source
        })));
      } else {
        sup.appendChild(h("div", "summary-line dim", t("taskReverifyUnavailable", {
          reason: reverifyRejectionLabel(elig.category)
        })));
      }
    }
    if(!reverifyEligible) reverifyBtn.disabled = true;
    reverifyBtn.setAttribute("data-fl-op-submit", "reverify");
    reverifyBtn.addEventListener("click", function(){
      if(!reverifyReasonIn.value.trim()){ flashError(t("taskReverifyReasonRequired")); return; }
      if(!window.confirm(t("taskReverifyConfirm") + "\n\n" + t("taskReverifyZeroWorker") + "\n" + t("taskReverifyNotFree"))) return;
      taskDurableAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/reverify", {
        reason: reverifyReasonIn.value.trim(),
        confirm: true
      }, reverifyBtn, task.id);
    });
    sup.appendChild(hd("div", "actions", [reverifyBtn]));

    // Read-only judge: create controls or status near Main decision.
    // Judge output is evidence only; Main still records accept/revise/reject.
    var judgeCard = renderJudgeReviewCard(task);
    if(judgeCard) manualActionsBody.appendChild(judgeCard);

    var revLab = h("label", "", t("taskReviewDecision"));
    var revSel = h("select", "");
    revSel.setAttribute("data-fl-op-input", "review-intent");
    [["accept", t("taskAccept")], ["revise", t("taskReviewRevise")], ["reject", t("taskReject")]].forEach(function(pair){
      var o = document.createElement("option"); o.value = pair[0]; o.textContent = pair[1]; revSel.appendChild(o);
    });
    revLab.appendChild(revSel);
    sup.appendChild(revLab);
    /* FL-109C2B: for a pending Main review handoff, the Core-fixed intent is
     * preselected and locked for this path so the guided step cannot silently
     * change it before submission. The ordinary manual form stays flexible. */
    var pendingReview = S.pendingActionHandoff;
    var fixedIntent = pendingReview && pendingReview.entry ? pendingReview.entry.intent : null;
    if(pendingReview && pendingReview.taskId === task.id
       && workPendingOperation(pendingReview) === "main_review"
       && (fixedIntent === "accept" || fixedIntent === "revise" || fixedIntent === "reject")){
      revSel.value = fixedIntent;
      revSel.disabled = true;
      var lockHint = h("div", "summary-line dim task-action-pending-locked",
        t("workActionHandoffLockedIntent", { intent: workIntentLabel(fixedIntent) }));
      lockHint.setAttribute("data-fl-role", "main-review-lock-hint");
      sup.appendChild(lockHint);
    }
    var reasonLab = h("label", "", t("taskReviewReason"));
    var reasonIn = h("input", "");
    reasonIn.type = "text";
    reasonIn.setAttribute("data-fl-op-input", "reason");
    reasonIn.placeholder = t("taskReviewReasonPh");
    reasonLab.appendChild(reasonIn);
    sup.appendChild(reasonLab);
    var reviewBtn = h("button", "btn sm", t("taskMainReview"));
    reviewBtn.type = "button";
    reviewBtn.setAttribute("data-fl-op-submit", "main_review");
    reviewBtn.addEventListener("click", function(){
      if(!reasonIn.value.trim()){ flashError(t("taskReviewReasonRequired")); return; }
      if(!window.confirm(t("taskMainReviewConfirm"))) return;
      taskDurableAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/main-review", {
        decision: revSel.value,
        reason: reasonIn.value.trim(),
        confirm: true
      }, reviewBtn, task.id);
    });
    sup.appendChild(hd("div", "actions", [reviewBtn]));
    manualActionsBody.appendChild(sup);

    if(task.competitionContext && task.competitionContext.competitionId){
      var taskCompetitionCandidates = task.competitionContext.candidates || [];
      var taskCompetitionCandidate = task.competitionContext.candidate || {};
      manualActionsBody.appendChild(competitionDecisionControls(
        task.competitionContext.competitionId,
        taskCompetitionCandidates,
        taskCompetitionCandidate.candidateId,
        function(){ showTask(task.id); }
      ));
    }

    // Integration panel
    var integ = h("div", "card form-card");
    integ.appendChild(h("div", "card-title mb-4", t("taskIntegration")));
    integ.appendChild(h("div", "summary-line dim mb-8", t("taskIntegrationHint")));
    var integAct = h("div", "actions");
    var preflightBtn = h("button", "btn sm", t("taskPreflight"));
    preflightBtn.type = "button";
    preflightBtn.setAttribute("data-fl-op-submit", "integration_preflight");
    preflightBtn.addEventListener("click", function(){
      taskDurableAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/integration/preflight", {}, preflightBtn, task.id, function(res){
        toast(t("taskPreflightOk"));
        if(res && res.result){
          var previous = integ.querySelector('[data-fl-role="preflight-result"]');
          if(previous) previous.remove();
          integ.appendChild(renderPreflightResult(res.result));
          if(res.result.id && (!res.result.rejectionReasons || res.result.rejectionReasons.length === 0)){
            receiptIn.value = String(res.result.id);
            /* Integration stays two-step: an accepted receipt advances the
             * pending handoff to the apply step; apply still needs explicit
             * confirm. A rejected preflight stays on the preflight step. */
            workPendingAdvanceToApply(task.id);
          }
        }
      });
    });
    integAct.appendChild(preflightBtn);
    var histBtn = h("button", "btn sm", t("taskIntegrationHistory"));
    histBtn.type = "button";
    histBtn.addEventListener("click", function(){ showIntegration(task.id); });
    integAct.appendChild(histBtn);
    integ.appendChild(integAct);
    var receiptLab = h("label", "", t("taskReceiptId"));
    var receiptIn = h("input", "");
    receiptIn.type = "text";
    receiptIn.setAttribute("data-fl-op-input", "receiptId");
    receiptIn.placeholder = "receipt-...";
    receiptLab.appendChild(receiptIn);
    integ.appendChild(receiptLab);
    var applyBtn = h("button", "btn sm danger", t("taskApply"));
    applyBtn.type = "button";
    applyBtn.setAttribute("data-fl-op-submit", "integration_apply");
    applyBtn.addEventListener("click", function(){
      if(!receiptIn.value.trim()){ flashError(t("taskReceiptRequired")); return; }
      if(!window.confirm(t("taskApplyConfirm"))) return;
      taskDurableAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/integration/apply", {
        receiptId: receiptIn.value.trim(),
        confirm: true
      }, applyBtn, task.id, function(){
        taskOperationSuccess(task.id, null, function(){ showIntegration(task.id); });
      });
    });
    integ.appendChild(hd("div", "actions", [applyBtn]));
    manualActionsBody.appendChild(integ);

    // Bounded adaptation panel
    manualActionsBody.appendChild(renderAdaptationPanel(task));
    var reuseJourney = renderCandidateReuse(task);
    if(reuseJourney) manualActionsBody.appendChild(reuseJourney);
    var handoffJourney = renderCandidateHandoffCard(task);
    if(handoffJourney) manualActionsBody.appendChild(handoffJourney);
    var goalHandoffControls = renderGoalTaskHandoffControls(task);
    if(goalHandoffControls) manualActionsBody.appendChild(goalHandoffControls);
    var reverifyJourney = renderCandidateReverification(task);
    if(reverifyJourney) manualActionsBody.appendChild(reverifyJourney);
    manualActionsBody.appendChild(renderTaskDeliveryPlan(task));
    manualActionsBody.appendChild(renderCalibrationCard(task));

    // More tab: dense evidence + technical IDs (optional for power users).
    var moreBody = h("div", "task-tab-body");
    moreBody.appendChild(h("div", "task-report-card-hint", t("taskTabMoreHint")));
    var journeyEvidence = renderTaskJourney(task);
    moreBody.appendChild(journeyDisclosure(t("storyEvidenceDetails"), journeyEvidence));
    var techBody = hd("div", "task-technical-body");
    techBody.appendChild(hd("div", "grid-2 fs12 mb-8", [
      hd("div", "", [h("span", "dim", t("journeyTechId") + " "), h("span", "mono", task.id)]),
      hd("div", "", [h("span", "dim", t("journeyTechSource") + " "), h("span", "mono truncate", task.source || "")]),
      hd("div", "", [h("span", "dim", t("journeyTechSession") + " "), h("span", "mono truncate", task.sessionId || "")]),
      hd("div", "", [h("span", "dim", t("journeyTechProvider") + " "), h("span", "mono", task.provider + "/" + task.model)]),
      hd("div", "", [h("span", "dim", t("journeyTechRuntime") + " "), h("span", "mono", task.runtime)]),
      hd("div", "", [h("span", "dim", t("journeyTechCreated") + " "), document.createTextNode(fmtTm(task.createdAt))]),
      hd("div", "", [h("span", "dim", t("journeyTechStarted") + " "), document.createTextNode(fmtTm(task.startedAt))]),
      hd("div", "", [h("span", "dim", t("journeyTechFinished") + " "), document.createTextNode(fmtTm(task.finishedAt))])
    ]));
    if(task.decision && task.decision.stage){
      techBody.appendChild(h("div", "summary-line",
        t("taskTechnicalStage") + ": " + boundedDiagnostic(task.decision.stage)));
    }
    if(task.decision && task.decision.failureCategory){
      techBody.appendChild(h("div", "summary-line",
        t("taskTechnicalFailureCategory") + ": " + failureCategoryLabel(task.decision.failureCategory)));
    }
    if(task.decision && task.decision.progress){
      var dp = task.decision.progress;
      techBody.appendChild(h("div", "summary-line",
        t("taskTechnicalProgress", {
          activity: activityLabel(dp.activity),
          time: dp.lastEventAt ? fmtSince(dp.lastEventAt) : "-"
        })
      ));
      if(dp.liveStage && dp.liveStage.stage){
        techBody.appendChild(h("div", "summary-line dim fs11",
          t("taskTechnicalLiveStage", {
            stage: String(dp.liveStage.stage),
            observation: String(dp.liveStage.observation || ""),
            evidence: String(dp.liveStage.evidence || "")
          })
        ));
      }
      if(dp.latestAction) appendBoundedDetail(techBody, dp.latestAction);
    }
    if(task.error){
      var eb = h("div", "error-box");
      eb.appendChild(h("strong", "", t("taskTechnicalError") + ": "));
      eb.appendChild(document.createTextNode(boundedDiagnostic(task.error)));
      techBody.appendChild(eb);
    }
    techBody.appendChild(renderDecision(task, task.decision));
    if(task.economics){
      var ee = renderEconomicsEvidence(task.economics);
      if(ee){
        var econDetails = collapsedSection(t("taskEconEvidenceTitle"), ee);
        econDetails.setAttribute("data-fl-role", "task-economics-evidence");
        techBody.appendChild(econDetails);
      }
    }
    if(task.timeline && task.timeline.length){
      var tlTech = h("div", "timeline");
      task.timeline.forEach(function(e){
        var te = h("div", "timeline-entry");
        te.appendChild(h("span", "ts", fmtTm(e.timestamp)));
        te.appendChild(h("span", "tl-kind", boundedDiagnostic(e.type)));
        te.appendChild(h("span", "tl-summary", boundedDiagnostic(e.summary)));
        tlTech.appendChild(te);
      });
      techBody.appendChild(collapsedSection(
        t("taskTechnicalTimeline") + " (" + task.timeline.length + ")", tlTech));
    }
    moreBody.appendChild(collapsedSection(t("journeyTechnical"), techBody));

    // Conditional "Where this Task sits" section: only when durable context exists.
    var lineageCard = renderTaskLineage(task);
    if(lineageCard) shell.appendChild(lineageCard);

    shell.appendChild(renderTaskWorkbench(task, [
      { id: "actions", label: t("taskTabActions"), body: actionsBody },
      { id: "more", label: t("taskTabMore"), body: moreBody }
    ]));
    f.appendChild(shell);
    showDetail(f);
  }).catch(function(e){
    detailEl.replaceChildren(detailErrorFragment("taskDetailLoadFailed", e));
  });
}

function taskEconConfidence(value){
  var labels = {
    low: t("econConfidenceLow"),
    medium: t("econConfidenceMedium"),
    high: t("econConfidenceHigh")
  };
  return labels[value] || t("econConfidenceLow");
}

function renderEconomicsEvidence(e){
  if(!e || typeof e !== "object"){
    var e1 = document.createDocumentFragment();
    e1.appendChild(sec(t("taskEconEvidenceTitle")));
    e1.appendChild(stateMsg("empty", t("taskEconEvidenceUnavailable")));
    return e1;
  }
  var f = fr();
  f.appendChild(sec(t("taskEconEvidenceTitle")));
  f.appendChild(evCaveat(t("taskEconIntro")));
  var grid = hd("div", "economics-grid");

  var b = e.runtimeBudget || {};
  var budgetCard = evCard(t("econBudgetTitle"));
  if(b.capped){
    budgetCard.appendChild(evRow(t("econBudgetCappedSum"), evCost(b.maxBudgetUsd, "USD")));
  } else {
    budgetCard.appendChild(evRow(t("econBudgetCappedSum"), t("econBudgetNoFiniteCaps")));
  }
  budgetCard.appendChild(evCaveat(t("econBudgetCaveat")));
  grid.appendChild(budgetCard);

  var re = e.runtimeEstimate || {};
  var total = (re.sampleCount || 0) + (re.missingCount || 0);
  var reCard = evCard(t("econRuntimeTitle"));
  reCard.appendChild(evRow(t("econRuntimeSum"), evCost(re.observedTotalUsd || 0, "USD")));
  reCard.appendChild(evRow(t("taskEconEvidenceState"),
    t(re.complete ? "taskEconEvidenceComplete" : "taskEconEvidenceIncomplete")));
  reCard.appendChild(evRow(t("econRuntimeDenominator"), t("econRuntimeCoverage", {
    sample: String(re.sampleCount || 0), total: String(total), missing: String(re.missingCount || 0)
  })));
  if(!re.complete && re.missingCount > 0) reCard.appendChild(evCaveat(t("econRuntimeMissingHint")));
  reCard.appendChild(evCaveat(t("econRuntimeCaveat")));
  grid.appendChild(reCard);

  var oc = e.officialCost || {};
  var totals = oc.totals || [];
  if(totals.length === 0){
    var noQuote = evCard(t("econOfficialSectionTitle"));
    noQuote.appendChild(evRow(t("econOfficialTotals"), t("econOfficialNone")));
    noQuote.appendChild(evCaveat(t("econOfficialNoneHint")));
    grid.appendChild(noQuote);
  } else {
    totals.forEach(function(quote){
      var currency = quote.currency || t("econUnknownCurrency");
      var cardEl = evCard(t("econOfficialTitle", { currency: currency }));
      cardEl.appendChild(evRow(t("econOfficialTotals"),
        t("econOfficialAmount", { amount: evAmount(quote.total || 0), currency: currency })));
      cardEl.appendChild(evRow(t("econOfficialQuotes"), t("econOfficialQuotesHint", {
        quoted: String(quote.quotedCount || 0), sources: String((quote.sources || []).length)
      })));
      var sources = quote.sources || [];
      if(sources.length){
        cardEl.appendChild(evRow(t("econOfficialSources", { count: String(sources.length) }), evSources(sources)));
      }
      cardEl.appendChild(evCaveat(t("econOfficialCaveat", { currency: currency })));
      grid.appendChild(cardEl);
    });
  }

  (oc.ranges || []).forEach(function(range){
    var currency = range.currency || t("econUnknownCurrency");
    var rangeCard = evCard(t("econOfficialRangeTitle", { currency: currency }));
    rangeCard.appendChild(evRow(t("econOfficialRangeLabel"), t("econOfficialRangeAmount", {
      min: evAmount(range.min || 0), max: evAmount(range.max || 0), currency: currency
    })));
    rangeCard.appendChild(evRow(t("econOfficialRangeAttempts"), t("econOfficialRangeAttemptsHint", {
      count: String(range.rangedAttemptCount || 0), sources: String((range.sources || []).length)
    })));
    if(range.sources && range.sources.length){
      rangeCard.appendChild(evRow(t("econOfficialSources", { count: String(range.sources.length) }),
        evSources(range.sources)));
    }
    rangeCard.appendChild(evCaveat(t("econOfficialRangeCaveat")));
    grid.appendChild(rangeCard);
  });

  var ua = oc.unavailable || {};
  if((ua.unavailableCount || 0) > 0){
    var reasonMap = econReasonMap();
    var unavailableCard = evCard(t("econOfficialUnavailableTitle"));
    unavailableCard.appendChild(evRow(
      t("taskEconUnavailableRuns", { count: String(ua.unavailableCount) }),
      t("taskEconUnavailableHint")));
    var reasonPills = econReasonPills(ua.breakdown, reasonMap);
    if(reasonPills) unavailableCard.appendChild(reasonPills);
    var gapDetails = hd("div", "task-econ-gap-details");
    (ua.entries || []).slice(0, 8).forEach(function(entry){
      var code = String(entry.stage || "") + ":" + String(entry.reason || "");
      gapDetails.appendChild(evRow(
        t("taskEconRun", { ordinal: String(entry.ordinal || "-") }),
        econTranslateReason(reasonMap, code)));
    });
    if(ua.entries && ua.entries.length > 8){
      gapDetails.appendChild(evCaveat(t("taskEconMoreGaps", { count: String(ua.entries.length - 8) })));
    }
    unavailableCard.appendChild(collapsedSection(t("econTechnicalDetails"), gapDetails));
    grid.appendChild(unavailableCard);
  }

  var tr = (e.tokenReport && e.tokenReport.report) || {};
  var wv = tr.workerVolume || { kind: "incomplete" };
  var wvCard = evCard(t("econWorkerVolumeTitle"));
  wvCard.appendChild(evRow(t("econWorkerVolumeGross"),
    t("econTokenUnit", { count: num(wv.grossWorkerTokens || 0, 0) })));
  var sampleCount = wv.sampleCount || 0;
  var completeCount = wv.kind === "complete" ? sampleCount : (wv.completeSampleCount || 0);
  var missingCount = wv.kind === "complete" ? 0 : (wv.missingSampleCount || 0);
  wvCard.appendChild(evRow(t("taskEconWorkerRuns"), t("taskEconWorkerRunCounts", {
    complete: String(completeCount), total: String(sampleCount), missing: String(missingCount)
  })));
  if(missingCount > 0) wvCard.appendChild(evCaveat(t("econWorkerVolumeIncomplete")));
  wvCard.appendChild(evCaveat(t("econWorkerVolumeCaveat")));
  grid.appendChild(wvCard);

  // --- Token usage reconciliation card (diagnostic, after Worker volume) ---
  var rec = (e.tokenReport && e.tokenReport.usageReconciliation) || {};
  if(rec.state){
    var recCard = evCard(t("tokRecTitle"));
    recCard.appendChild(evCaveat(t("tokRecIntro")));
    if(rec.state === "matched"){
      recCard.appendChild(stateMsg("ok", t("tokRecStateMatched")));
    } else if(rec.state === "mismatch"){
      recCard.appendChild(stateMsg("warn", t("tokRecStateMismatch")));
    } else if(rec.state === "partial"){
      recCard.appendChild(stateMsg("info", t("tokRecStatePartial")));
    } else {
      recCard.appendChild(stateMsg("empty", t("tokRecStateUnavailable")));
    }
    recCard.appendChild(evRow(t("tokRecCompared"), String(rec.comparedAttemptCount || 0)));
    recCard.appendChild(evRow(t("tokRecMatched"), String(rec.matchedAttemptCount || 0)));
    recCard.appendChild(evRow(t("tokRecMismatched"), String(rec.mismatchedAttemptCount || 0)));
    recCard.appendChild(evRow(t("tokRecMissingBreakdown"), String(rec.missingBreakdownCount || 0)));
    recCard.appendChild(evRow(t("tokRecMissingUsage"), String(rec.missingUsageCount || 0)));
    recCard.appendChild(evRow(t("tokRecInvalidCounters"), String(rec.invalidCounterEvidenceCount || 0)));
    recCard.appendChild(evRow(t("tokRecWorkerVolumeCurrent"),
      t("econTokenUnit", { count: num(wv.grossWorkerTokens || 0, 0) })));
    var gd = rec.grossDeltas || {};
    if(gd.available){
      recCard.appendChild(evRow(t("tokRecTopLevelGross"),
        t("econTokenUnit", { count: num(gd.topLevelGross, 0) })));
      recCard.appendChild(evRow(t("tokRecPerModelGross"),
        t("econTokenUnit", { count: num(gd.perModelGross, 0) })));
      var delta = gd.delta || 0;
      var deltaText = delta >= 0
        ? t("tokRecDeltaPositive", { delta: num(delta, 0) })
        : t("tokRecDeltaNegative", { delta: num(delta, 0) });
      recCard.appendChild(evRow(t("tokRecDelta"), deltaText));
      recCard.appendChild(evCaveat(t("tokRecComparedScope")));
    } else {
      recCard.appendChild(evRow(t("tokRecDelta"), t("tokRecAggregateUnavailable")));
    }
    if(rec.state === "mismatch"){
      recCard.appendChild(evCaveat(t("tokRecWorkerVolumeSource")));
      recCard.appendChild(evCaveat(t("tokRecNotSavings")));
    }
    recCard.appendChild(evCaveat(t("tokRecNotBill")));
    // Per-Attempt evidence in a collapsed disclosure
    var evidence = rec.evidence || [];
    if(evidence.length > 0){
      var evidenceBody = hd("div", "tok-rec-evidence");
      evidence.forEach(function(ev){
        var row = hd("div", "tok-rec-attempt");
        row.appendChild(h("div", "tok-rec-attempt-ordinal",
          t("tokRecAttemptOrdinal", { ordinal: String(ev.ordinal) })));
        var cols = hd("div", "tok-rec-attempt-cols");
        cols.appendChild(evRow(t("tokRecAttemptModels"), String(ev.modelCount || 0)));
        cols.appendChild(evRow(t("tokRecAttemptTopGross"), num(ev.topLevel && ev.topLevel.gross, 0)));
        cols.appendChild(evRow(t("tokRecAttemptPmGross"), num(ev.perModel && ev.perModel.gross, 0)));
        var d = (ev.deltas && ev.deltas.gross) || 0;
        cols.appendChild(evRow(t("tokRecAttemptDelta"),
          d >= 0 ? "+" + num(d, 0) : num(d, 0)));
        row.appendChild(cols);
        evidenceBody.appendChild(row);
      });
      recCard.appendChild(collapsedSection(t("tokRecPerAttemptTitle"), evidenceBody));
    }
    grid.appendChild(recCard);
  }

  var exchange = tr.exchangeEstimate || { kind: "unavailable" };
  var exchangeCard = evCard(t("econExchangeTitle"));
  if(exchange.kind === "exact"){
    exchangeCard.appendChild(evRowMixed(t("econExchangeRangeLabel"), [
      t("econTokenUnit", { count: num(exchange.tokens || 0, 0) }), " ",
      evPill(t("econExactTokens"), "high")
    ]));
  } else if(exchange.kind === "range"){
    exchangeCard.appendChild(evRowMixed(t("econExchangeRangeLabel"), [
      evRange(exchange.range.min, exchange.range.max), " Tokens ",
      evPill(taskEconConfidence(exchange.range.confidence), exchange.range.confidence)
    ]));
  } else {
    exchangeCard.appendChild(evUnavailableRow(t("econExchangeRangeLabel"),
      t("econExchangeUnavailable"), econTranslateReason(econReasonMap(), exchange.reason)));
  }
  exchangeCard.appendChild(evCaveat(t("econExchangeCaveat")));
  grid.appendChild(exchangeCard);

  var boundary = tr.boundaryReduction || { available: false };
  var boundaryCard = evCard(t("econBoundaryTitle"));
  if(boundary.available){
    boundaryCard.appendChild(evRowMixed(t("econBoundaryRange"), [
      evRange(boundary.tokens.min, boundary.tokens.max), " Tokens ",
      evPill(taskEconConfidence(boundary.tokens.confidence), boundary.tokens.confidence)
    ]));
  } else {
    boundaryCard.appendChild(evUnavailableRow(t("econBoundaryRange"),
      t("econExchangeUnavailable"), econTranslateReason(econReasonMap(), boundary.reason)));
  }
  boundaryCard.appendChild(evCaveat(t("econBoundaryCaveat")));
  grid.appendChild(boundaryCard);

  var savings = tr.directCodexSavings || { available: false };
  var savingsCard = evCard(t("econDirectTitle"));
  if(savings.available){
    var baseline = savings.baseline || {};
    savingsCard.appendChild(evRowMixed(t("taskEconBaseline"), [
      evRange(baseline.minTokens || 0, baseline.maxTokens || 0), " Tokens ",
      evPill(taskEconConfidence(baseline.confidence), baseline.confidence)
    ]));
    savingsCard.appendChild(evRow(t("taskEconTaskClass"), baseline.taskClass || "-"));
    savingsCard.appendChild(evRowMixed(t("econDirectRangeLabel"), [
      evRange(savings.absoluteSavings.min, savings.absoluteSavings.max), " Tokens ",
      evPill(taskEconConfidence(savings.absoluteSavings.confidence), savings.absoluteSavings.confidence)
    ]));
    if(savings.percentageSavings && savings.percentageSavings.available){
      savingsCard.appendChild(evRow(t("taskEconPercentageRange"),
        num(savings.percentageSavings.range.min, 1) + "% - " +
        num(savings.percentageSavings.range.max, 1) + "%"));
    }
    savingsCard.appendChild(evCaveat(t("econDirectCaveat")));
  } else {
    savingsCard.appendChild(evRow(t("taskEconEvidenceState"), t("taskEconNotMeasurable")));
    savingsCard.appendChild(evRow(t("econDirectRangeLabel"),
      econTranslateReason(econReasonMap(), savings.reason)));
    savingsCard.appendChild(evCaveat(t("econDirectUnavailableCaveat")));
  }
  grid.appendChild(savingsCard);

  f.appendChild(grid);
  return f;
}

function showCompetition(cid){
  loadingDetail(t("compDetailLoading"));
  fetchJSON("/api/ops/competitions/" + encodeURIComponent(cid)).then(function(c){
    var f = fr();
    f.appendChild(closeBtn());
    var comp = c.competition || {}, cands = c.candidates || [], prog = c.progress || {};
    var ev = c.evaluation;
    f.appendChild(cardHead(comp.name, "", badge(comp.status)));
    f.appendChild(h("div", "summary-line mb-8", t("compDetailProgress", {
      terminal: String(prog.terminal || 0), total: String(prog.total || 0), candidates: String(cands.length)
    })));
    f.appendChild(h("div", "summary-line dim mb-8", t("compDetailExplain")));
    // Explanation-first story: reason -> machine comparison -> Main decision ->
    // retained work -> next action. Leads before any candidate table.
    function candidateName(cid){
      var found = cands.find(function(x){ return x.candidateId === cid; });
      return found ? (String(found.providerName || "") + "/" + String(found.modelName || "")) : t("compCandidateUnknown");
    }
    var story = hd("div", "competition-story mb-8");
    story.appendChild(h("div", "card-subtitle", t("compStoryTitle")));
    if (comp.legacy === true) {
      story.appendChild(h("div", "summary-line dim", t("compStoryReasonUnavailable")));
      story.appendChild(h("div", "summary-line dim", t("compStoryIdentityUnavailable")));
    } else if (comp.reason && comp.reason.note) {
      story.appendChild(h("div", "summary-line", t("compStoryReason", { reason: String(comp.reason.note) })));
    }
    var mc = c.machineComparison || {};
    if (mc.recommendation) {
      story.appendChild(h("div", "summary-line", t("compStoryMachineRecommendation", {
        candidate: candidateName(mc.recommendation.candidateId),
        pct: (Number(mc.recommendation.confidence || 0) * 100).toFixed(0)
      })));
    } else if (ev) {
      story.appendChild(h("div", "summary-line", t("compStoryMachineNoDeliverable")));
    } else {
      story.appendChild(h("div", "summary-line", t("compStoryMachineWaiting")));
    }
    var md = c.mainDecision;
    if (md) {
      var mdKey = md.decision === "accept" ? "compStoryMainAccepted"
        : md.decision === "revise" ? "compStoryMainRevised"
        : "compStoryMainRejected";
      story.appendChild(h("div", "summary-line", t(mdKey, { candidate: candidateName(md.candidateId) })));
    } else {
      story.appendChild(h("div", "summary-line dim", t("compStoryMainNone")));
    }
    var retained = c.retainedPartial || [];
    retained.forEach(function(entry){
      story.appendChild(h("div", "summary-line dim", t("compStoryRetained", {
        candidate: candidateName(entry.candidateId),
        paths: String((entry.reusablePaths || []).length),
        gaps: String((entry.remainingGaps || []).length)
      })));
    });
    story.appendChild(h("div", "summary-line", t("compTaskNext", {
      action: competitionNextActionLabel(c.nextAction)
    })));
    f.appendChild(story);
    var compareBtn = h("button", "btn sm primary", t("compCompare"));
    compareBtn.type = "button";
    compareBtn.addEventListener("click", function(){
      compareBtn.disabled = true;
      postJSON("/api/ops/competitions/" + encodeURIComponent(cid) + "/compare", {})
        .then(function(res){
          toast(t("compCompareOk"));
          // Re-open with refreshed status (compare may attach evaluation)
          showCompetition(cid);
          if(res && res.result){
            // also keep current if status unchanged
          }
        })
        .catch(function(e){ flashError(t("taskActionFailed"), e && e.message ? e.message : ""); })
        .finally(function(){ compareBtn.disabled = false; });
    });
    f.appendChild(hd("div", "actions mb-8", [compareBtn]));
    if(cands.length){
      f.appendChild(competitionDecisionControls(cid, cands, cands[0].candidateId, function(){
        showCompetition(cid);
      }));
    }
    var handoffControls = competitionHandoffControls(cid, c, function(){
      showCompetition(cid);
    });
    if(handoffControls) f.appendChild(handoffControls);
    var handoffList = Array.isArray(c.handoffs) ? c.handoffs : [];
    handoffList.forEach(function(entry){
      f.appendChild(h("div", "summary-line", t("compStoryHandoff", {
        from: candidateName(entry.sourceCandidateId),
        to: String(entry.destinationWorkerProfileId || "?"),
        paths: String(entry.reusablePathCount || 0),
        gaps: String(entry.remainingGapCount || 0),
        status: handoffStatusLabel(entry.status)
      })));
    });
    if(cands.length){
      var tbl = h("table", ""), thd = h("thead", "");
      thd.appendChild(theadRow([
        t("compColProvider"), t("compColModel"), t("compColStatus"),
        t("compColStarted"), t("compColFinished"), t("compColOpen")
      ]));
      tbl.appendChild(thd);
      var tbd = document.createElement("tbody");
      cands.forEach(function(cd){
        var modelCell = cd.identity
          ? (String(cd.modelName || "") + " (" + t("compIdentityRuntime") + ": " + String(cd.identity.runtime) + "/" + String(cd.identity.effort) + ")")
          : String(cd.modelName || "");
        var openCandidate = h("button", "btn sm", t("compOpenCandidate"));
        openCandidate.type = "button";
        openCandidate.addEventListener("click", function(){ showTask(cd.taskId); });
        tbd.appendChild(row([
          h("td", "", cd.providerName),
          h("td", "", modelCell),
          badgeTd(cd.taskStatus),
          h("td", "", fmtTm(cd.taskStartedAt)),
          h("td", "", fmtTm(cd.taskFinishedAt)),
          hd("td", "", [openCandidate])
        ]));
      });
      tbl.appendChild(tbd);
      f.appendChild(tbl);
    } else {
      f.appendChild(stateMsg("empty", t("compNoCandidates")));
    }
    f.appendChild(h("div", "fs12 mt-8", t("compRecommendationTitle")));
    if(ev && ev.recommendation){
      var recommended = cands.find(function(candidate){
        return candidate.candidateId === ev.recommendation.candidateId;
      });
      var recommendedName = recommended
        ? String(recommended.providerName || "") + "/" + String(recommended.modelName || "")
        : t("compCandidateUnknown");
      f.appendChild(h("div", "summary-line mt-4", t("compRecommendationBody", {
        candidate: recommendedName,
        pct: (ev.recommendation.confidence * 100).toFixed(0)
      })));
      if(ev.recommendation.reasoning){
        f.appendChild(h("div", "summary-line dim fs11 mt-4",
          t("compRecommendationReason", { reason: boundedDiagnostic(ev.recommendation.reasoning) })));
      }
    } else {
      f.appendChild(h("div", "summary-line mt-4", t("compNoRecommendation")));
      f.appendChild(h("div", "summary-line dim fs11 mt-4", t("compNoRecommendationHint")));
    }
    if(ev){
      f.appendChild(sec(t("compEvalTitle")));
      f.appendChild(h("div", "summary-line dim mb-8", t("compEvalExplain")));
      if(ev.candidates && ev.candidates.length){
        var et = h("table", ""), ethd = h("thead", "");
        ethd.appendChild(theadRow([
          t("compColCandidate"), t("compEvalColEligible"), t("compEvalColScore")
        ]));
        et.appendChild(ethd);
        var etbd = document.createElement("tbody");
        ev.candidates.forEach(function(sc){
          etbd.appendChild(row([
            h("td", "", sc.providerName + "/" + sc.modelName),
            h("td", "", sc.eligible ? t("compEligible") : t("compNotEligible")),
            td("numeric", sc.totalScore !== undefined ? sc.totalScore.toFixed(3) : "-")
          ]));
        });
        et.appendChild(etbd);
        f.appendChild(et);
      }
    }
    var compTech = hd("div", "competition-technical");
    compTech.appendChild(evRow(t("compTechnicalId"), comp.id || cid));
    cands.forEach(function(candidate){
      var candidateName = String(candidate.providerName || "") + "/" + String(candidate.modelName || "");
      var detail = t("compTechnicalCandidate", {
        name: candidateName,
        id: String(candidate.candidateId || "-"),
        error: boundedDiagnostic(candidate.error) || "-"
      });
      compTech.appendChild(h("div", "summary-line mono fs11", detail));
    });
    if(ev && ev.candidates){
      ev.candidates.forEach(function(candidate){
        if(candidate.disqualificationReason){
          compTech.appendChild(h("div", "summary-line mono fs11",
            t("compTechnicalDisqualification", {
              name: String(candidate.providerName || "") + "/" + String(candidate.modelName || ""),
              reason: boundedDiagnostic(candidate.disqualificationReason)
            })));
        }
      });
    }
    f.appendChild(collapsedSection(t("econTechnicalDetails"), compTech));
    var back = h("button", "back-link mt-12", t("compBack"));
    back.addEventListener("click", hideDetail);
    f.appendChild(hd("div", "mt-12", [back]));
    showDetail(f);
  }).catch(function(e){
    detailEl.replaceChildren(detailErrorFragment("compDetailLoadFailed", e));
  });
}

function showIntegration(taskId){
  loadingDetail(t("integHistoryLoading"));
  fetchJSON("/api/ops/integration/" + encodeURIComponent(taskId) + "/history").then(function(hist){
    var f = fr();
    f.appendChild(closeBtn());
    f.appendChild(h("div", "card-title mb-8", t("integHistoryTitle")));
    f.appendChild(h("div", "summary-line dim mb-8", t("integHistoryExplain")));
    f.appendChild(sec(t("integReceiptsTitle", { count: String((hist.receipts || []).length) })));
    if(hist.receipts && hist.receipts.length){
      var rtb = h("table", ""), rthd = h("thead", "");
      rthd.appendChild(theadRow([
        t("integColFiles"), t("integColCreated")
      ]));
      rtb.appendChild(rthd);
      var rtbd = document.createElement("tbody");
      hist.receipts.forEach(function(r){
        rtbd.appendChild(row([
          h("td", "truncate", (r.affectedFiles || []).join(", ")),
          h("td", "", fmtSince(r.createdAt))
        ]));
      });
      rtb.appendChild(rtbd);
      f.appendChild(rtb);
    } else {
      f.appendChild(stateMsg("empty", t("integNoReceipts")));
    }
    f.appendChild(sec(t("integResultsTitle", { count: String((hist.results || []).length) })));
    if(hist.results && hist.results.length){
      var stb = h("table", ""), sthd = h("thead", "");
      sthd.appendChild(theadRow([
        t("integColStatus"), t("integColApplied")
      ]));
      stb.appendChild(sthd);
      var stbd = document.createElement("tbody");
      hist.results.forEach(function(r){
        stbd.appendChild(row([
          badgeTd(r.status),
          h("td", "", fmtTm(r.appliedAt))
        ]));
      });
      stb.appendChild(stbd);
      f.appendChild(stb);
    } else {
      f.appendChild(stateMsg("empty", t("integNoResults")));
    }
    var integTech = hd("div", "integration-technical");
    (hist.receipts || []).forEach(function(receipt){
      integTech.appendChild(h("div", "summary-line mono fs11", t("integTechnicalReceipt", {
        id: String(receipt.id || "-"), digest: String(receipt.patchDigest || "-")
      })));
    });
    (hist.results || []).forEach(function(result){
      integTech.appendChild(h("div", "summary-line mono fs11", t("integTechnicalResult", {
        id: String(result.receiptId || "-"), error: boundedDiagnostic(result.error) || "-"
      })));
    });
    if((hist.receipts || []).length || (hist.results || []).length){
      f.appendChild(collapsedSection(t("econTechnicalDetails"), integTech));
    }
    showDetail(f);
  }).catch(function(e){
    detailEl.replaceChildren(detailErrorFragment("integHistoryLoadFailed", e));
  });
}

/* --- Render dispatcher --- */
function render(){
  updStatus();
  setPageChrome();
  // Guard: never render null arrays as successful empty evidence.  Classify
  // the current page's data state and show loading/disconnected when the
  // renderer would otherwise treat missing data as empty success.
  var tab = S.tab || "work";
  var state = pageEvidenceState(tab);
  if(state === "loading"){
    viewEl.textContent = "";
    if(!S.hadOk){ showDisconnected(); return; }
    viewEl.appendChild(stateMsg("loading", t("loading")));
    return;
  }
  if(state === "unavailable"){
    if(!S.hadOk){ showDisconnected(); return; }
    viewEl.textContent = "";
    viewEl.appendChild(stateMsg("empty", t("reconnecting")));
    return;
  }
  // FL-112A: identical Work presentation truth keeps the live Work DOM so
  // polling updates connection chrome without a hard page-like rebuild.
  // Real hierarchy/intake/filter/language changes still fall through to rWork.
  if((tab === "work" || tab === "decisions") && workShouldRetainDom()){
    if(!S.detail){
      detailEl.hidden = true;
      detailEl.textContent = "";
      if(scrimEl) scrimEl.hidden = true;
    }
    return;
  }
  // "ready" and "stale" both render normally; retained evidence is shown
  // while updStatus already indicates the stale dot in the status bar.
  // overview remains a bounded compatibility branch only (redirected by switchTab).
  switch(tab){
    case "overview": rOverview(); break;
    case "work": rWork(); break;
    case "decisions": rDecisions(); break;
    case "plans": rPlans(); break;
    case "goals": rGoals(); break;
    case "tasks": rTasks(); break;
    case "competitions": rCompetitions(); break;
    case "stats": rStats(); break;
    case "model": rModel(); break;
    case "worker": rWorker(); break;
    case "limits": rLimits(); break;
    case "mains": rMains(); break;
    case "delivery": rDelivery(); break;
  }
  if(!S.detail){
    detailEl.hidden = true;
    detailEl.textContent = "";
    if(scrimEl) scrimEl.hidden = true;
  }
}

/* --- Init --- */
function init(){
  S.token = readToken();
  viewEl = document.getElementById("fl-view");
  detailEl = document.getElementById("fl-detail");
  statusEl = document.getElementById("fl-status-bar");
  footerEl = document.getElementById("fl-footer");
  titleEl = document.getElementById("fl-page-title");
  subEl = document.getElementById("fl-page-sub");
  topMetaEl = document.getElementById("fl-top-meta");
  scrimEl = document.getElementById("fl-scrim");
  workReadingContextPending = workReadSessionContext();
  if(!S.token){ showUnauthenticated(); return; }
  $$("#fl-tabs [data-tab]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var tab = btn.getAttribute("data-tab");
      closeSystemMenuOnRouteSelection();
      switchTab(tab);
    });
  });
  var mobileBack = document.getElementById("fl-mobile-back");
  if(mobileBack){
    mobileBack.addEventListener("click", function(){ workMobileBack(); });
  }
  workBindViewportPresentation();
  document.addEventListener("pointerdown", onSystemMenuPointerDown);
  document.addEventListener("touchstart", onSystemMenuTouchStart);
  document.addEventListener("keydown", function(e){
    if(onSystemMenuEscape(e)) return;
    if(e.key==="Escape"&&S.detail) hideDetail();
  });
  /* Native disclosures, the contained board, the real page scroll host, and
   * semantic focus are all presentation state. Capture them after interaction
   * so a reload has the latest reading place without storing content. */
  document.addEventListener("toggle", function(e){
    if(viewEl && e.target && viewEl.contains(e.target)) workScheduleReadingContextSave();
  }, true);
  document.addEventListener("scroll", function(e){
    var content = workContentScrollEl();
    if(e.target === content || e.target === detailEl
      || (viewEl && e.target && viewEl.contains(e.target))){
      workScheduleReadingContextSave();
    }
  }, true);
  document.addEventListener("focusin", function(e){
    if(viewEl && e.target && viewEl.contains(e.target)) workScheduleReadingContextSave();
  });
  if(scrimEl){
    scrimEl.addEventListener("click", function(){ if(S.detail) hideDetail(); });
  }
  /* Visibility-aware polling: background tabs stop issuing requests;
   * one immediate catch-up refresh fires when the tab becomes visible. */
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "visible"){
      refresh();
    } else {
      if(S.timer){ clearTimeout(S.timer); S.timer = null; }
    }
  });
  $$(".lang-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      var next = btn.getAttribute("data-lang");
      if(window.ForklightI18n) window.ForklightI18n.setLang(next);
    });
  });
  $$(".theme-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      applyTheme(btn.getAttribute("data-theme-set"));
    });
  });
  window.onForklightLangChange = function(){
    /* The open chooser carries stale-language copy; close it cleanly first and
     * clear any pending-action handoff so a re-render cannot mislabel it. */
    workActionChooserReset();
    workPendingHandoffReset();
    /* Language is an explicit full-page rebuild. Capture the live Worker draft
     * here, before any translated chrome or form nodes are replaced, then mark
     * the old DOM consumed so rWorker restores this exact draft only once. */
    var languageDraft = null;
    if(S.tab === "worker" && S.workerFormRendered && S.workerFormActive){
      languageDraft = workerCaptureDraftFromDom();
      if(languageDraft) S.workerDraft = languageDraft;
      S.workerFormRendered = false;
    }
    applyChromeI18n();
    setPageChrome();
    if(S.token) render();
    /* A language change is synchronous and presentation-only. Replay the exact
     * live controls after translated DOM exists so intentionally blank inputs
     * and unsaved labels cannot fall back to saved profile values. */
    if(languageDraft && S.tab === "worker"){
      var translatedForm = viewEl.querySelector("form.configure-form");
      if(workerReplayCapturedControls(translatedForm, languageDraft)){
        S.workerDraft = languageDraft;
        S.workerFormActive = true;
        if(typeof S.workerSummariesRefresher === "function") S.workerSummariesRefresher();
      }
    }
  };
  applyChromeI18n();
  setPageChrome();
  startPoll();
}
document.addEventListener("DOMContentLoaded", init);
