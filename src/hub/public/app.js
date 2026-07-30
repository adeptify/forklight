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
/* Board-only presentation: map progress.activity (+ silence age) to a
 * short badge. Does not invent a machine status or change taskLane.
 * Quiet = no new event within the backend quiet window. Stalled = still
 * quiet after 5 minutes of silence (user-facing long-run signal only). */
function boardActivityKind(task){
  var p = task && task.progress;
  if(!p || !p.activity) return null;
  if(p.activity === "terminal") return null;
  if(p.activity === "active") return "active";
  if(p.activity !== "quiet") return null;
  if(p.lastEventAt){
    var age = Date.now() - Date.parse(p.lastEventAt);
    // 5 minutes: long-run board signal only; not a machine status.
    if(Number.isFinite(age) && age >= 5 * 60 * 1000) return "stalled";
  }
  return "quiet";
}
function boardActivityBadge(task){
  var kind = boardActivityKind(task);
  if(!kind) return null;
  var cls = kind === "active" ? "badge-info" : (kind === "stalled" ? "badge-err" : "badge-warn");
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
  var attr = document.documentElement.getAttribute("data-theme");
  if(attr === "dark" || attr === "light") return attr;
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
  economics: null,
  economicsError: null,
  routingCoverage: null,
  routingCoverageError: null,
  selfUpgradeEvidence: null,
  selfUpgradeEvidenceError: null,
  sample: null,
  hub: null,
  lastOk: 0, connected: false, hadOk: false, tab: "overview",
  detail: null, detailReturnFocus: null, timer: null, token: null,
  workerEditId: null, workerPreviewTimer: null, workerFormActive: false,
  mrResult: null, mrDirty: false, mrEvaluating: false, mrDraft: null,
  mrTaskClass: "", mrTaskFamily: "", mrCompIntent: "", mrCompTriggers: "",
  mrCandidates: [],
  deliveryDraft: null, deliveryDirty: false, deliveryEditId: null, deliverySaving: false,
  deliveryErrors: []
};
var viewEl, detailEl, statusEl, footerEl, titleEl, subEl, topMetaEl, scrimEl;
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
  return deliveryNormalizeSettings(S.settings && S.settings.deliveryProfiles);
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
  var names = { "claude-code": "Claude Code", "grok-build": "Grok Build" };
  return names[runtime] || runtime || "?";
}
function providerDisplayName(provider){
  var names = {
    deepseek: "DeepSeek", minimax: "MiniMax", qwen: "Qwen",
    glm: "GLM", volcengine: "Volcengine", xai: "xAI"
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

/* --- API --- */
function fetchJSON(path){
  return fetch(path, { headers: { "X-ForkLight-Hub-Token": S.token } }).then(function(r){
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
/** Isolated fetch for the new /api/ops/economics-summary route.  Failure
 *  must not mark Tasks, Boards, Stats, or Settings disconnected; it
 *  only degrades the Insights economics panel by storing an error string
 *  and clearing the cached summary so render() can recover next cycle. */
function pollEconomics(){
  return fetchJSON("/api/ops/economics-summary").then(function(s){
    S.economics = s;
    S.economicsError = null;
    return s;
  }).catch(function(e){
    if(e && e.status === 401) clearHubToken();
    S.economics = null;
    S.economicsError = (e && e.message) ? e.message : "unavailable";
  });
}
/** Isolated fetch for Worker-selection evidence coverage. Failure only
 *  degrades this Insights panel; never Tasks, Settings, economics, or
 *  the rest of the main ops poll. Backend owns every count. */
function pollRoutingCoverage(){
  return fetchJSON("/api/ops/routing-evidence-coverage").then(function(s){
    S.routingCoverage = s;
    S.routingCoverageError = null;
    return s;
  }).catch(function(e){
    if(e && e.status === 401) clearHubToken();
    S.routingCoverage = null;
    S.routingCoverageError = (e && e.message) ? e.message : "unavailable";
  });
}
/** Isolated fetch for consecutive self-upgrade streak evidence. Backend owns
 *  every count and break code; the browser only translates closed codes.
 *  Failure degrades only this Overview card. */
function pollSelfUpgradeEvidence(){
  return fetchJSON("/api/ops/self-upgrade-evidence").then(function(s){
    S.selfUpgradeEvidence = s;
    S.selfUpgradeEvidenceError = null;
    return s;
  }).catch(function(e){
    if(e && e.status === 401) clearHubToken();
    S.selfUpgradeEvidence = null;
    S.selfUpgradeEvidenceError = (e && e.message) ? e.message : "unavailable";
  });
}
function scheduleNext(){
  var ms = S.settings && S.settings.console && S.settings.console.refreshIntervalMs
    ? Math.max(200, S.settings.console.refreshIntervalMs) : 2000;
  S.timer = setTimeout(refresh, ms);
}
function refresh(){
  S.timer = null;
  var hubP = fetchJSON("/api/status").then(function(hub){
    S.hub = hub;
    return hub;
  });
  var econP = pollEconomics();
  var recP = pollRoutingCoverage();
  var sueP = pollSelfUpgradeEvidence();
  var opsP = Promise.all([
    fetchJSON("/api/ops/health"), fetchJSON("/api/ops/board"), fetchJSON("/api/ops/tasks"),
    fetchJSON("/api/ops/competitions"), fetchJSON("/api/ops/stats"), fetchJSON("/api/ops/settings"),
    fetchJSON("/api/ops/sample-task"), fetchJSON("/api/ops/goals")
  ]).then(function(v){
    S.health = v[0]; S.boards = v[1]; S.tasks = v[2];
    S.competitions = v[3]; S.stats = v[4]; S.settings = v[5]; S.sample = v[6];
    S.goals = v[7];
    S.lastOk = Date.now(); S.connected = true; S.hadOk = true;
  }).catch(function(e){
    S.connected = false;
    if(e&&e.status===401) clearHubToken();
    // Daemon may be down; keep setup usable from /api/status
    if(!S.tasks) S.tasks = [];
    if(!S.boards) S.boards = [];
    if(!S.competitions) S.competitions = [];
    if(!S.stats) S.stats = [];
    if(!S.goals) S.goals = [];
  });
  Promise.all([hubP.catch(function(e){
    if(e&&e.status===401) clearHubToken();
    throw e;
  }), opsP, econP, recP, sueP]).then(function(){
    if(!S.token){ showUnauthenticated(); return; }
    if(S.tab === "worker" && S.workerFormActive){
      updStatus();
      setPageChrome();
    } else {
      render();
    }
    scheduleNext();
  }).catch(function(){
    if(!S.token){ showUnauthenticated(); return; }
    if(S.tab === "worker" && S.workerFormActive){
      updStatus();
      setPageChrome();
    } else {
      render();
    }
    scheduleNext();
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
  var st = S.connected ? "ok" : (S.hadOk ? "stale" : "disconnected");
  var dot = h("span", "status-dot " + st);
  statusEl.appendChild(dot);
  var txt = S.connected ? t("live") : (S.hadOk ? t("reconnecting") : t("offline"));
  if(!S.connected && S.hadOk) txt += " - " + t("connectionLastOk", { time: fmtSince(new Date(S.lastOk).toISOString()) });
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
  var p = pageMeta(S.tab || "overview");
  if(titleEl) titleEl.textContent = p.title;
  if(subEl) subEl.textContent = p.sub;
  applyChromeI18n();
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
    [t("readyDaemon"), daemon.running === true || daemon.pid != null, t("ovDaemon"), "overview"]
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
  var statusText = i.taskStatus ? statusLabel(i.taskStatus) : t("planItemNotStarted");
  d.appendChild(h("div", "meta", statusText));
  if(i.error) appendBoundedDetail(d, i.error);
  if(i.dependencies && i.dependencies.length){
    var depStr = i.dependencies.map(function(dd){
      return statusLabel(dd.state);
    }).join(", ");
    d.appendChild(h("div", "meta", t("planItemDepsStates", { deps: depStr })));
    appendBoundedDetail(d, i.dependencies.map(function(dd){
      return String(dd.itemId || "-") + " (" + String(dd.state || "-") + ")";
    }).join(", "));
  }
  return d;
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
    return prep ? preparationProgressText(prep) : t("taskProgressPreparing");
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
  // Quiet / stalled activity is a presentation signal on the board only.
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
  if(p && p.lastEventAt){
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

/* --- Overview (dense: metrics + split columns, less vertical scroll) --- */
function rOverview(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  // Page story: purpose, input, process, output, next before metrics
  viewEl.appendChild(renderPageStory("overview"));
  var tasks = S.tasks || [];
  var lanes = countByLane(tasks);
  var comps = S.competitions || [];
  var plans = S.boards || [];
  var activeComp = comps.filter(function(c){ return c.status === "running" || c.status === "pending"; }).length;

  rReadiness();

  // Three-layer version alignment: source, built product, running service.
  // Prominent, before task metrics, so a non-technical user sees it first.
  viewEl.appendChild(renderVersionJourneyCard());
  // Consecutive self-upgrade reliability: server-owned counts only.
  viewEl.appendChild(renderSelfUpgradeEvidenceCard());
  viewEl.appendChild(renderGuidedSampleCard());

  var goals = S.goals || [];
  var metrics = hd("div", "grid-4", [
    metric(t("ovBoard"), String(tasks.length), lanes.active + " " + t("ovWorking")),
    metric(t("ovMotion"), String(lanes.active), lanes.queued + " " + t("ovQueued")),
    metric(t("navGoals"), String(goals.length), t("ovGoalsHint")),
    metric(t("navCompete"), String(comps.length), activeComp + " " + t("ovOpen"))
  ]);
  viewEl.appendChild(metrics);

  var split = hd("div", "overview-split");
  var left = hd("div", "overview-stack");
  left.appendChild(sec(t("needsAttention")));
  var attention = tasks.filter(function(task){
    return (task.status === "failed" || task.status === "interrupted") && !hasVerifiedFinalDelivery(task);
  }).slice(0, 3);
  if(!attention.length){
    left.appendChild(h("div", "summary-line mb-8", t("noFailed")));
  } else {
    attention.forEach(function(task){
      left.appendChild(card(function(){ showTask(task.id); }, [
        cardHead(task.name, "", badge(task.status)),
        h("div", "summary-line", taskProgressSummary(task)),
        task.failureCategory
          ? h("div", "summary-line dim fs11", t("attentionCause", {
              category: failureCategoryLabel(task.failureCategory)
            }))
          : h("div", "summary-line dim fs11", t("ovOpenDetails"))
      ]));
    });
  }
  left.appendChild(sec(t("navCompete")));
  if(!comps.length){
    left.appendChild(h("div", "summary-line", t("noCompetitions")));
  } else {
    comps.slice(0, 2).forEach(function(c){
      var pr = c.progress || {};
      left.appendChild(card(function(){ showCompetition(c.id); }, [
        cardHead(c.name, "", badge(c.status)),
        h("div", "summary-line", t("competitionProgress", {
          candidates: String(c.candidateCount), terminal: String(pr.terminal || 0), total: String(pr.total || 0)
        }))
      ]));
    });
  }

  var right = hd("div", "overview-stack");
  right.appendChild(sec(t("navGoals")));
  if(!goals.length){
    right.appendChild(h("div", "summary-line", t("noGoals")));
  } else {
    goals.slice(0, 3).forEach(function(g){
      right.appendChild(card(function(){ showGoalDetail(g.goalId); }, [
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
/* Board filter is presentation-only session state; it never mutates Tasks. */
var boardFilterQuery = "";
var boardFilterLane = "all";
/* Two-step submit state: the path input value and the last safe preview.
 * Editing the path invalidates the preview so an old revision can never be
 * reused for a different file. Both survive a poll re-render. */
var boardSubmitPath = "";
var boardPreview = null;
var boardPreviewRequestId = 0;
function submitPreviewRequestIsCurrent(requestId, requestedPath, currentPath){
  return requestId === boardPreviewRequestId
    && requestedPath === String(currentPath || "").trim();
}
function taskMatchesBoardFilter(task, query, lane){
  if(lane && lane !== "all" && taskLane(task.status) !== lane) return false;
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
function submitFactRow(label, value){
  var r = h("div", "summary-line submit-fact");
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
function submitWorkerText(preview){
  var id = String(preview.workerProfileId || "");
  var label = preview.workerProfileLabel ? String(preview.workerProfileLabel) : id;
  return label === id ? id : label + " (" + id + ")";
}
function renderSubmitPreviewFacts(preview){
  var wrap = h("div", "submit-preview-facts");
  wrap.appendChild(submitFactRow(t("taskSubmitFactTask"), String(preview.taskName || "")));
  if(preview.workerProfileId){
    wrap.appendChild(submitFactRow(t("taskSubmitFactWorker"), submitWorkerText(preview)));
  }
  wrap.appendChild(submitFactRow(t("taskSubmitFactProvider"), String(preview.provider || "")));
  wrap.appendChild(submitFactRow(t("taskSubmitFactModel"), String(preview.model || "")));
  wrap.appendChild(submitFactRow(t("taskSubmitFactRuntime"), String(preview.runtime || "")));
  wrap.appendChild(submitFactRow(t("taskSubmitFactEffort"), String(preview.effort || "")));
  wrap.appendChild(submitFactRow(t("taskSubmitFactBudget"), submitBudgetText(preview)));
  wrap.appendChild(submitFactRow(t("taskSubmitFactAttempts"), submitAttemptsText(preview)));
  wrap.appendChild(submitFactRow(t("taskSubmitFactAdaptation"), submitAdaptationText(preview)));
  wrap.appendChild(submitFactRow(t("taskSubmitFactQuality"), submitQualityText(preview)));
  wrap.appendChild(submitFactRow(t("taskSubmitFactIntegration"), submitIntegrationText(preview)));
  wrap.appendChild(h("div", "summary-line dim mt-4", t("taskSubmitNoTaskStarted")));
  // Technical disclosure: raw digest and full effective policy values only.
  var tech = h("div", "summary-line mono fs11");
  tech.appendChild(h("span", "", t("taskSubmitDigestLabel") + ": " + String(preview.previewRevisionDigest || "")));
  wrap.appendChild(collapsedSection(t("taskSubmitTechnical"), tech));
  return wrap;
}
function rTasks(){
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
  pathLab.appendChild(pathIn);
  submitCard.appendChild(pathLab);

  var previewArea = h("div", "preview-panel submit-preview-panel");
  var previewBtn = h("button", "btn sm", t("taskSubmitPreviewBtn"));
  previewBtn.type = "button";
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
    previewArea.appendChild(renderSubmitPreviewFacts(boardPreview.preview));
    submitBtn.disabled = false;
  }

  function clearSubmitPreview(){
    boardPreview = null;
    renderSubmitPreview();
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
  var filtered = tasks.filter(function(task){
    return taskMatchesBoardFilter(task, boardFilterQuery, boardFilterLane);
  });
  var lanes = { queued: [], active: [], done: [], failed: [] };
  filtered.forEach(function(taskItem){ lanes[taskLane(taskItem.status)].push(taskItem); });

  var counts = countByLane(tasks);
  var toolbar = h("div", "kanban-toolbar");
  var legend = h("div", "kanban-legend");
  [
    ["all", t("taskBoardFilterAll"), tasks.length],
    ["queued", t("taskLaneQueued"), counts.queued],
    ["active", t("taskLaneWorking"), counts.active],
    ["done", t("taskLaneDone"), counts.done],
    ["failed", t("taskLaneFailed"), counts.failed]
  ].forEach(function(row){
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
      boardFilterQuery = "";
      boardFilterLane = "all";
      rTasks();
    });
    filterRow.appendChild(clearBtn);
  }
  filterRow.appendChild(h("div", "summary-line", t("taskBoardCount", {
    count: String(filtered.length) + (filtered.length === tasks.length ? "" : " / " + tasks.length)
  })));
  toolbar.appendChild(filterRow);
  viewEl.appendChild(toolbar);

  if(!filtered.length){
    viewEl.appendChild(stateMsg("empty", t("taskBoardFilterEmpty")));
    return;
  }

  var board = h("div", "kanban");
  board.appendChild(kanbanColumn("queued", t("taskLaneQueued"), "queued", lanes.queued));
  board.appendChild(kanbanColumn("active", t("taskLaneWorking"), "active", lanes.active));
  board.appendChild(kanbanColumn("done", t("taskLaneDone"), "done", lanes.done));
  board.appendChild(kanbanColumn("failed", t("taskLaneFailed"), "failed", lanes.failed));
  viewEl.appendChild(board);
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
/** One explanation-first section: meaning, four named counts, limitation,
 *  next action. No progress bar, no model-quality label, no nested grid. */
function renderRoutingCoverage(c){
  var panel = h("div", "card");
  panel.setAttribute("data-fl-role", "routing-evidence-coverage");
  panel.appendChild(h("div", "card-title mb-4", t("recTitle")));
  panel.appendChild(h("div", "summary-line", t("recMeaning")));

  var state = routingCoverageState(c);
  var counts = h("div", "mt-4");
  counts.setAttribute("data-fl-role", "routing-coverage-counts");
  [
    ["recTotalLabel", c && c.eligibleTerminalTaskCount],
    ["recClassLabel", c && c.withTaskClassCount],
    ["recFamilyLabel", c && c.withTaskFamilyCount],
    ["recDecisionLabel", c && c.withCompleteRoutingDecisionCount]
  ].forEach(function(row){
    counts.appendChild(evRow(t(row[0]), h("span", "mono", nCount(row[1]))));
  });
  panel.appendChild(counts);

  if(state !== "empty"){
    panel.appendChild(h("div", "summary-line dim fs11 mt-4", t("recDiversity", {
      classes: nCount(c && c.distinctTaskClassCount),
      families: nCount(c && c.distinctTaskFamilyCount)
    })));
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
    ["deepseek","qwen","minimax","glm","volcengine","xai"].forEach(function(n){
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
  card.appendChild(purpose);
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
  noProgressTimeoutMs: "workersAdvNoProgressTimeout",
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
  maxMainReverifications: "workersAdvMaxMainReverifications"
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
  { title: "maxMainReverifications", fields: ["maxMainReverifications"] }
];

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

function buildAdvancedFields(){
  var container = h("div", "advanced-fields");
  var developmentDefaults = advancedDevelopmentDefaults();
  ADV_GROUP_ORDER.forEach(function(group){
    var row = h("div", "advanced-row");
    group.fields.forEach(function(field){
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
    if(prof && prof.advancedPolicy) existingPolicy = prof.advancedPolicy;
  }
  var draft = collectAdvancedPatch();
  var draftQuality = collectQualityPatch();
  var body = { runtime: runtime, draftAdvancedPolicy: draft, draftContractQuality: draftQuality };
  if(Object.keys(existingPolicy).length > 0) body.existingAdvancedPolicy = existingPolicy;
  postJSON("/api/worker-advanced-preview", body)
    .then(function(res){
      renderWorkerPreview(res.preview || []);
      renderQualityPreview(res.previewQualityPolicy || []);
    })
    .catch(function(){ renderWorkerPreview([]); renderQualityPreview([]); });
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
    if(r.unlimited){
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
  panel.appendChild(tbl);
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
      var modeLabels = {
        "hard": t("workersQualityModeHard"),
        "warn": t("workersQualityModeWarn"),
        "score": t("workersQualityModeScore"),
        "off": t("workersQualityModeOff")
      };
      valStr = modeLabels[r.value] || String(r.value);
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
  panel.appendChild(tbl);
}

function rModel(){
  viewEl.textContent = "";
  flashError("");
  viewEl.appendChild(renderPageStory("models"));
  var cat = (S.hub && S.hub.modelCatalog) || { models: [] };
  var list = cat.models || [];
  var split = hd("div", "configure-split");
  var listCol = hd("div", "configure-list");
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

  /* Build candidate list from catalog + profiles */
  var seen = {};
  var candOptions = [];
  /* From profile models */
  profiles.forEach(function(p){
    var configured = models.find(function(x){ return x.id === (p.modelConfigId || ""); });
    var provider = configured ? configured.provider : p.provider;
    var model = configured ? configured.model : p.model;
    if(!provider || !model) return;
    var key = provider + "\0" + model;
    if(seen[key]) return;
    seen[key] = true;
    candOptions.push({
      key: key,
      provider: provider,
      model: model,
      label: (p.label || p.id || "Worker") + ": " + provider + " / " + model,
    });
  });
  /* From catalog models not already covered */
  models.forEach(function(m){
    var key = (m.provider || "") + "\0" + (m.model || "");
    if(!m.provider || !m.model || seen[key]) return;
    seen[key] = true;
    candOptions.push({
      key: key,
      provider: m.provider || "",
      model: m.model || "",
      label: (m.label || m.id || "") + ": " + (m.provider || "?") + " / " + (m.model || "?"),
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
        var parts = (selOpts[i].value || "").split("\0");
        if(parts[0] && parts[1]) picks.push({ provider: parts[0], model: parts[1] });
      }
      /* Deduplicate */
      var deduped = [];
      var ds = {};
      picks.forEach(function(p){
        var k = p.provider + "\0" + p.model;
        if(!ds[k]){ ds[k] = true; deduped.push(p); }
      });
      if(!taskClass){ toast(t("mrTaskClassLabel")); return; }
      if(deduped.length < 2){ toast(t("mrCandidatesMinError")); return; }
      if(deduped.length > 10) deduped = deduped.slice(0, 10);
      S.mrCandidates = deduped.map(function(p){ return p.provider + "\0" + p.model; });

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

      var reqBody = { taskClass: taskClass, candidates: deduped };
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

  if(rec){
    var recTitle = h("div", "mr-conclusion-title");
    recTitle.appendChild(document.createTextNode(
      t("mrRecommendation", { provider: rec.provider, model: rec.model, taskClass: taskClass })
    ));
    conc.appendChild(recTitle);
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
      name.appendChild(document.createTextNode(
        t("mrCandidateEvidence", { provider: c.provider, model: c.model })));
      cc.appendChild(name);

      /* Human evidence facts; scoring arithmetic stays in technical detail. */
      var ev = c.evidence || {};
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
    tBody.appendChild(h("div", "card-subtitle mt-8 mb-4",
      c.provider + " / " + c.model + " (score " + Number(c.totalScore).toFixed(4) + ")"));
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
  if(noActive){
    reasons.push(t("mrNoActiveFactors"));
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
  return runtime === "grok-build"
    ? modelConfig.provider === "xai"
    : modelConfig.provider !== "xai";
}

function workerReadinessFor(workerId){
  var rows = (S.hub && S.hub.workerReadiness) || [];
  return rows.find(function(row){ return row && row.workerId === workerId; }) || null;
}

function workerReadinessPresentation(result){
  var stateMap = {
    ready: ["workersReadinessReady", "badge-ok"],
    launchable: ["workersReadinessLaunchable", "badge-info"],
    "needs-attention": ["workersReadinessAttention", "badge-warn"],
    blocked: ["workersReadinessBlocked", "badge-warn"]
  };
  var reasonMap = {
    ready: "workersReadinessReasonReady",
    "connection-unverified": "workersReadinessReasonConnectionUnverified",
    "connection-stale": "workersReadinessReasonConnectionStale",
    "connection-failed": "workersReadinessReasonConnectionFailed",
    "authentication-missing": "workersReadinessReasonAuthenticationMissing",
    "runtime-unavailable": "workersReadinessReasonRuntimeUnavailable",
    "pairing-invalid": "workersReadinessReasonPairingInvalid",
    "model-invalid": "workersReadinessReasonModelInvalid"
  };
  var nextMap = {
    none: "workersReadinessNextNone",
    "run-smoke-check": "workersReadinessNextSmoke",
    "check-provider": "workersReadinessNextProvider",
    "configure-authentication": "workersReadinessNextAuth",
    "fix-runtime": "workersReadinessNextRuntime",
    "change-pairing": "workersReadinessNextPairing",
    "choose-model": "workersReadinessNextModel"
  };
  var state = stateMap[result && result.state] || stateMap.blocked;
  return {
    label: t(state[0]),
    tone: state[1],
    reason: t(reasonMap[result && result.reason] || "workersReadinessReasonModelInvalid"),
    next: t(nextMap[result && result.nextAction] || "workersReadinessNextModel")
  };
}

function rWorker(){
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
  var split = hd("div", "configure-split");
  var listCol = hd("div", "configure-list");
  if(!list.length){
    listCol.appendChild(stateMsg("empty", t("workersEmpty")));
  }
  list.forEach(function(prof){
    var isDef = prof.id === wp.defaultProfileId;
    var isEditing = S.workerEditId === prof.id;
    var cardEl = h("div", "card profile-card");
    var modelLine = prof.modelConfigId ? modelLabel(prof.modelConfigId) : (prof.model || "?");
    var modelTechnical = modelTechnicalLabel(prof.modelConfigId, prof);
    var badges = [];
    if(isDef) badges.push(h("span", "badge badge-ok", t("workersBadgeDefault")));
    else badges.push(h("span", "badge badge-dim", t("workersBadgeWorker")));
    if(isEditing) badges.push(h("span", "badge badge-info", t("workersEditBadge")));
    var badgeWrap = hd("div", "", badges);
    cardEl.appendChild(cardHead(prof.label, "", badgeWrap));
    var advanced = prof.advancedPolicy || {};
    var purpose = isDef ? t("workersCardDefaultPurpose") : t("workersCardReusablePurpose");
    var story = h("div", "profile-story");
    story.appendChild(h("div", "profile-story-purpose", purpose));
    var readiness = workerReadinessFor(prof.id);
    if(readiness){
      var readinessView = workerReadinessPresentation(readiness);
      story.appendChild(hd("div", "profile-story-line", [
        h("span", "badge " + readinessView.tone, readinessView.label)
      ]));
      story.appendChild(h("div", "profile-story-line", readinessView.reason));
      story.appendChild(h("div", "profile-story-line dim fs11",
        t("workersReadinessNextLabel", { action: readinessView.next })));
    }
    story.appendChild(h("div", "profile-story-line", t("workersCardRunsWith", {
      model: modelLine, runtime: runtimeDisplayName(prof.runtime)
    })));
    var budgetText = prof.maxBudgetUsd === null
      ? t("workersCardBudgetUnlimited")
      : (prof.maxBudgetUsd === undefined
        ? t("workersCardBudgetInherited")
        : t("workersCardBudgetLimited", { amount: String(prof.maxBudgetUsd) }));
    var progressValue = advanced.noProgressTimeoutMs !== undefined
      ? advanced.noProgressTimeoutMs : prof.noProgressTimeoutMs;
    var progressText = progressValue === null
      ? t("workersCardNoProgressUnlimited")
      : (progressValue === undefined
        ? t("workersCardNoProgressInherited")
        : t("workersCardNoProgressLimited", { duration: readableDuration(progressValue) }));
    story.appendChild(h("div", "profile-story-line", budgetText + " "
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
    story.appendChild(h("div", "profile-story-line", attemptText + " " + adaptationText));
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
    story.appendChild(h("div", "profile-story-line dim fs11", qualitySummary));
    cardEl.appendChild(story);

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
    cardEl.appendChild(journeyDisclosure(t("workersCardTechnicalDetails"), technical));
    var actions = h("div", "actions");
    var editBtn = h("button", "btn sm " + (isEditing ? "primary" : ""), t("workersEdit"));
    editBtn.type = "button";
    editBtn.addEventListener("click", function(){
      S.workerEditId = isEditing ? null : prof.id;
      S.workerFormActive = !isEditing;
      render();
    });
    actions.appendChild(editBtn);
    if(!isDef){
      var defBtn = h("button", "btn sm", t("workersSetDefault"));
      defBtn.type = "button";
      defBtn.addEventListener("click", function(){
        postJSON("/api/worker-profiles", { action: "setDefault", id: prof.id })
          .then(function(){ toast(t("workersDefaultSet") + prof.id); return refresh(); })
          .catch(function(e){ flashError(t("operationFailed"), e && e.message); });
      });
      actions.appendChild(defBtn);
    }
    if(list.length > 1){
      var rm = h("button", "btn sm danger", t("workersRemove"));
      rm.type = "button";
      rm.addEventListener("click", function(){
        if(!window.confirm(t("workersRemoveConfirm", { id: prof.id }))) return;
        postJSON("/api/worker-profiles", { action: "remove", id: prof.id })
          .then(function(){ toast(t("workersRemoved") + prof.id); return refresh(); })
          .catch(function(e){ flashError(t("operationFailed"), e && e.message); });
      });
      actions.appendChild(rm);
    }
    cardEl.appendChild(actions);
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
  function field(id, label, type, val, ph){
    var lab = h("label", "", label);
    var inp = h("input", "");
    inp.type = type || "text"; inp.id = id; inp.value = val || "";
    if(ph) inp.placeholder = ph;
    lab.appendChild(inp); form.appendChild(lab);
    return inp;
  }
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
    form.appendChild(idLab);
  } else {
    idIn = field("fl-wp-id", t("workersId"), "text", "", "e.g. cheap-ds");
  }
  var labIn = field("fl-wp-label", t("workersLabel"), "text", isEdit ? (editingProfile.label || "") : "", "");
  var labR = h("label", "", t("workersRuntime"));
  var selR = h("select", "");
  [["claude-code",t("workersRuntimeClaude")],["grok-build",t("workersRuntimeGrok")]].forEach(function(pair){
    var o = document.createElement("option"); o.value = pair[0]; o.textContent = pair[1]; selR.appendChild(o);
  });
  if(isEdit && editingProfile.runtime) selR.value = editingProfile.runtime;
  labR.appendChild(selR); form.appendChild(labR);
  var labM = h("label", "", t("workersModel"));
  var selM = h("select", "");
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
  labM.appendChild(selM); form.appendChild(labM);
  form.appendChild(h("div", "hint-inline dim fs11", t("workersModelCompatibilityHint")));
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
  budgetModeLab.appendChild(budgetMode); form.appendChild(budgetModeLab);
  var budgetIn = field("fl-wp-budget", t("workersBudget"), "number", isEdit && typeof editingProfile.maxBudgetUsd === "number" ? String(editingProfile.maxBudgetUsd) : "", "0.5");
  budgetIn.step = "0.01"; budgetIn.min = "0.01";
  function syncBudgetInput(){
    budgetIn.disabled = budgetMode.value !== "limited";
  }
  budgetMode.addEventListener("change", syncBudgetInput);
  syncBudgetInput();
  var labEf = h("label", "", t("workersEffort"));
  var selEf = h("select", "");
  [["",t("inherit")],["low",t("workersEffortLow")],["medium",t("workersEffortMedium")],
    ["high",t("workersEffortHigh")],["xhigh",t("workersEffortXHigh")],["max",t("workersEffortMax")]].forEach(function(pair){
    var o = document.createElement("option"); o.value = pair[0]; o.textContent = pair[1]; selEf.appendChild(o);
  });
  selEf.value = isEdit ? (editingProfile.effort || "") : "medium";
  labEf.appendChild(selEf); form.appendChild(labEf);
  var advDetails = h("details", "advanced-disclosure");
  var advSummary = h("summary", "", t("workersAdvancedToggle"));
  advDetails.appendChild(advSummary);
  var advBody = h("div", "advanced-body");
  advBody.appendChild(h("div", "summary-line dim mb-8", t("workersAdvancedClosed")));
  advBody.appendChild(policyModeNote());
  var advFields = buildAdvancedFields();
  advBody.appendChild(advFields);
  var routeRow = h("div", "advanced-row");
  routeRow.appendChild(buildPricingRouteField());
  advBody.appendChild(routeRow);
  if(isEdit){
    var policyForEditor = Object.assign({}, editingProfile.advancedPolicy || {});
    if(policyForEditor.noProgressTimeoutMs === undefined && editingProfile.noProgressTimeoutMs !== undefined){
      policyForEditor.noProgressTimeoutMs = editingProfile.noProgressTimeoutMs;
    }
    hydrateAdvancedFields(advBody, policyForEditor);
    hydratePricingRouteField(advBody, editingProfile);
  } else {
    hydratePricingRouteField(advBody, null);
  }
  var previewPanel = h("div", "card preview-panel");
  previewPanel.id = "fl-worker-preview";
  previewPanel.appendChild(h("div", "summary-line dim", t("workersPreviewEmpty")));
  advBody.appendChild(previewPanel);
  advDetails.appendChild(advBody);
  form.appendChild(advDetails);

  /* --- Contract Quality disclosure --- */
  var qualDetails = h("details", "advanced-disclosure quality-disclosure");
  var qualSummary = h("summary", "", t("workersQualityGroup"));
  qualDetails.appendChild(qualSummary);
  var qualBody = h("div", "advanced-body");
  qualBody.appendChild(h("div", "summary-line dim mb-8", t("workersQualityGroupHint")));
  var qualFields = buildQualityFields();
  qualBody.appendChild(qualFields);
  if(isEdit){
    hydrateQualityFields(qualBody, editingProfile.contractQuality);
  }
  var qualPreviewPanel = h("div", "card preview-panel");
  qualPreviewPanel.id = "fl-quality-preview";
  qualPreviewPanel.appendChild(h("div", "summary-line dim", t("workersPreviewEmpty")));
  qualBody.appendChild(qualPreviewPanel);
  qualDetails.appendChild(qualBody);
  form.appendChild(qualDetails);

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
    var profile = {
      id: isEdit ? editingProfile.id : idIn.value.trim(),
      label: labIn.value.trim() || (isEdit ? editingProfile.label : idIn.value.trim()),
      runtime: selR.value,
      modelConfigId: selM.value
    };
    if(selEf.value) profile.effort = selEf.value;
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
        return refresh();
      })
      .catch(function(e){ flashError(t("operationFailed"), e && e.message); });
  });

  advDetails.addEventListener("toggle", function(){
    S.workerFormActive = true;
    if(advDetails.open){
      advSummary.textContent = t("workersAdvancedOpen");
      var firstInput = advBody.querySelector("[data-adv]");
      if(firstInput) firstInput.focus();
      scheduleWorkerPreview(selR.value);
    } else {
      advSummary.textContent = t("workersAdvancedToggle");
    }
  });

  qualDetails.addEventListener("toggle", function(){
    S.workerFormActive = true;
    if(qualDetails.open){
      qualSummary.textContent = t("workersQualityGroupOpen");
      scheduleWorkerPreview(selR.value);
    } else {
      qualSummary.textContent = t("workersQualityGroup");
    }
  });

  var changeHandler = function(){
    if(advDetails.open && selR.value){
      scheduleWorkerPreview(selR.value);
    }
  };
  advBody.addEventListener("input", changeHandler);
  advBody.addEventListener("change", changeHandler);
  var qualChangeHandler = function(e){
    if(e && e.target && e.target.getAttribute("data-quality-max-mode")){
      syncQualityMaximumInput(e.target);
    }
    if(qualDetails.open && selR.value){
      scheduleWorkerPreview(selR.value);
    }
  };
  qualBody.addEventListener("input", qualChangeHandler);
  qualBody.addEventListener("change", qualChangeHandler);
  form.addEventListener("input", function(){ S.workerFormActive = true; });
  form.addEventListener("change", function(){ S.workerFormActive = true; });
  selR.addEventListener("change", function(){
    syncCompatibleModels("");
    if(advDetails.open && selR.value){
      scheduleWorkerPreview(selR.value);
    }
  });

  if(isEdit){
    form.appendChild(h("div", "summary-line dim fs11 mt-8", t("workersEditing", { id: editingProfile.id })));
  }
  split.appendChild(listCol);
  split.appendChild(form);
  viewEl.appendChild(split);

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
  var timeoutIn = numField("fl-timeout", "No-progress timeout (ms)", hs.noProgressTimeoutMs || 600000, "1000", "1000");
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

function switchTab(name){
  $$("#fl-tabs button").forEach(function(b){
    b.classList.toggle("active", b.getAttribute("data-tab") === name);
  });
  S.tab = name;
  hideDetail();
  render();
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
/*  Excludes maxAdaptationRounds, maxMainCorrections, and maxMainReverifications: these are immutable
 *  root caps chosen in Worker Advanced settings before Task creation, and are
 *  never editable on an existing Task. */
/* Derive the Task adaptation inventory from the same field inventory used by
 * Worker Advanced settings. A newly added flexible Worker field therefore
 * cannot silently disappear from this panel. Immutable loop / correction caps
 * are the only deliberate exclusions. */
var ADAPT_FIELDS = Object.keys(ADV_FIELD_LABELS)
  .filter(function(field){ return field !== "maxAdaptationRounds" && field !== "maxMainCorrections" && field !== "maxMainReverifications"; })
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
  S.detail = null;
  var target = S.detailReturnFocus;
  S.detailReturnFocus = null;
  if(target && document.contains(target) && typeof target.focus === "function") target.focus();
  else {
    var activeTab = $("#fl-tabs button.active");
    if(activeTab) activeTab.focus();
  }
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
  var close = detailEl.querySelector(".detail-close");
  if(close) close.focus();
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

function taskAction(path, body, btn, onOk){
  if(btn) btn.disabled = true;
  flashError("");
  postJSON(path, body || {})
    .then(function(res){
      toast(res.message || res.action || t("taskActionOk"));
      if(onOk) onOk(res);
      else refresh();
    })
    .catch(function(e){ flashError(t("taskActionFailed"), e && e.message ? e.message : ""); })
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
    "already-integrated": "taskReverifyRejectAlreadyIntegrated"
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
  card.appendChild(h("div", "summary-line dim mb-8", t("taskReverifyJourneyIntro")));
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

  // Show the live state before history, inputs, evidence, and outcomes.
  var current = h("div", "journey-section");
  current.setAttribute("data-fl-role", "journey-current");
  current.appendChild(h("div", "journey-section-title", t("journeyCurrentState")));
  current.appendChild(h("div", "journey-section-body journey-field", taskProgressSummary(task)));
  var currentProgress = task.progress || (task.decision && task.decision.progress);
  if(currentProgress && currentProgress.lastEventAt){
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

  // 5. Cause (what happened + why, always separate)
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
    "revise-contract": "journeyNextReviseContract" };
  return t(map[label] || label);
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
  var headlineKey = verdict === "reject" ? "taskPreflightHeadlineReject"
    : "taskPreflightHeadlineOk";
  var summaryKey = verdict === "reject" ? "taskPreflightSummaryReject"
    : "taskPreflightSummaryOk";
  var nextKey = verdict === "reject" ? "taskPreflightNextReject"
    : "taskPreflightNextOk";
  card.appendChild(h("div", "preflight-headline " + verdict, t(headlineKey)));
  card.appendChild(h("div", "preflight-summary", t(summaryKey)));
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
  if(rejects.length){
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

/* Primary Task workbench: sticky hero + tabbed sections so one screen is not a wall of cards. */
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
  var nextBox = h("div", "task-report-next");
  nextBox.appendChild(h("div", "task-report-next-label", t("taskReportNextLabel")));
  nextBox.appendChild(h("div", "task-report-next-body",
    nextActionLabel(next.label || "investigate")));
  hero.appendChild(nextBox);
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
    if(whyText){
      hero.appendChild(reportBlock(t("taskReportWhyLabel"), whyText, false));
    }
  }
  shell.appendChild(hero);

  // --- Tab bodies ---
  // Overview: short path only
  var overviewBody = h("div", "task-tab-body");
  overviewBody.appendChild(h("div", "task-report-card-hint", t("taskTabOverviewHint")));
  overviewBody.appendChild(renderTaskStory(task));
  var overviewRetained = renderRetainedCandidate(task);
  if(overviewRetained) overviewBody.appendChild(overviewRetained);

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
      te.appendChild(h("span", "tl-summary", boundedDiagnostic(e.summary || "")));
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

  // 3) Result + artifacts
  var resultNodes = [];
  var claimStep = presentation.steps.find(function(s){ return s.id === "worker-output"; });
  if(we.workerClaim && we.workerClaim.text){
    resultNodes.push(reportBlock(t("storyWorkerClaimLabel"), we.workerClaim.text, true));
    resultNodes.push(h("div", "task-report-empty", t("taskReportClaimNotProof")));
  } else {
    resultNodes.push(h("div", "task-report-empty", t("journeyNoWorkerClaim")));
  }
  if(claimStep && claimStep.bodyKey){
    resultNodes.push(h("div", "summary-line dim", t(claimStep.bodyKey, claimStep.params || {})));
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
  checksBody.appendChild(reportCard(
    t("taskReportFinalTitle"),
    t("taskReportFinalHint"),
    finalNodes,
    "task-story-step-final-result"
  ));

  var attemptCount = we.attempts && we.attempts.length ? String(we.attempts.length) : "0";
  var fileCount = String(files.length);
  var failCount = iv && iv.available ? String(iv.failedCount || 0) : "";

  var tabs = [
    { id: "overview", label: t("taskTabOverview"), body: overviewBody },
    { id: "instruction", label: t("taskTabInstruction"), body: instrBody },
    { id: "process", label: t("taskTabProcess"), hint: attemptCount, body: processBody },
    { id: "result", label: t("taskTabResult"), hint: fileCount, body: resultBody },
    { id: "checks", label: t("taskTabChecks"), hint: failCount, body: checksBody }
  ];
  (extraTabs || []).forEach(function(tab){ tabs.push(tab); });

  var active = taskDetailActiveTab;
  if(!tabs.some(function(tab){ return tab.id === active; })) active = "overview";
  shell.appendChild(renderTaskTabShell(tabs, active));
  return shell;
}

function showTask(id){
  loadingDetail(t("taskDetailLoading"));
  fetchJSON("/api/ops/tasks/" + encodeURIComponent(id)).then(function(task){
    var f = fr();
    var shell = h("div", "detail-shell");
    var top = h("div", "detail-topbar");
    var back = closeBtn();
    back.textContent = t("taskReportBack");
    top.appendChild(back);
    top.appendChild(h("div", "dim fs12", t("taskReportBreadcrumb")));
    shell.appendChild(top);

    // Actions tab body is filled below, then passed into the tabbed workbench.
    var actionsBody = h("div", "task-tab-body task-manual-actions");
    actionsBody.appendChild(h("div", "task-report-card-hint", t("taskTabActionsHint")));
    actionsBody.appendChild(h("div", "summary-line dim mb-8", t("taskManualActionsHint")));
    var manualActionsBody = actionsBody;

    // Supervision panel
    var sup = h("div", "card form-card");
    sup.appendChild(h("div", "card-title mb-4", t("taskSupervise")));
    sup.appendChild(h("div", "summary-line dim mb-8", t("taskSuperviseHint")));
    var fbLab = h("label", "", t("taskFeedback"));
    var fbIn = h("input", "");
    fbIn.type = "text";
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
    resumeBtn.addEventListener("click", function(){
      var body = {};
      if(fbIn.value.trim()) body.feedback = fbIn.value.trim();
      taskAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/resume", body, resumeBtn, function(){
        showTask(task.id);
      });
    });
    supAct.appendChild(resumeBtn);
    var reviseBtn = h("button", "btn sm", t("taskRevise"));
    reviseBtn.type = "button";
    reviseBtn.addEventListener("click", function(){
      if(!fbIn.value.trim()){ flashError(t("taskFeedbackRequired")); return; }
      taskAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/revise", {
        feedback: fbIn.value.trim()
      }, reviseBtn, function(){ showTask(task.id); });
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
      taskAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/correct", body, correctBtn, function(){
        showTask(task.id);
      });
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
    reverifyBtn.title = t("taskReverifyHint");
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
    reverifyBtn.addEventListener("click", function(){
      if(!reverifyReasonIn.value.trim()){ flashError(t("taskReverifyReasonRequired")); return; }
      if(!window.confirm(t("taskReverifyConfirm") + "\n\n" + t("taskReverifyZeroWorker") + "\n" + t("taskReverifyNotFree"))) return;
      taskAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/reverify", {
        reason: reverifyReasonIn.value.trim(),
        confirm: true
      }, reverifyBtn, function(){ showTask(task.id); });
    });
    sup.appendChild(hd("div", "actions", [reverifyBtn]));

    // Read-only judge: create controls or status near Main decision.
    // Judge output is evidence only; Main still records accept/revise/reject.
    var judgeCard = renderJudgeReviewCard(task);
    if(judgeCard) manualActionsBody.appendChild(judgeCard);

    var revLab = h("label", "", t("taskReviewDecision"));
    var revSel = h("select", "");
    [["accept", t("taskAccept")], ["revise", t("taskReviewRevise")], ["reject", t("taskReject")]].forEach(function(pair){
      var o = document.createElement("option"); o.value = pair[0]; o.textContent = pair[1]; revSel.appendChild(o);
    });
    revLab.appendChild(revSel);
    sup.appendChild(revLab);
    var reasonLab = h("label", "", t("taskReviewReason"));
    var reasonIn = h("input", "");
    reasonIn.type = "text";
    reasonIn.placeholder = t("taskReviewReasonPh");
    reasonLab.appendChild(reasonIn);
    sup.appendChild(reasonLab);
    var reviewBtn = h("button", "btn sm", t("taskMainReview"));
    reviewBtn.type = "button";
    reviewBtn.addEventListener("click", function(){
      if(!reasonIn.value.trim()){ flashError(t("taskReviewReasonRequired")); return; }
      if(!window.confirm(t("taskMainReviewConfirm"))) return;
      taskAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/main-review", {
        decision: revSel.value,
        reason: reasonIn.value.trim(),
        confirm: true
      }, reviewBtn, function(){ showTask(task.id); });
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
    preflightBtn.addEventListener("click", function(){
      taskAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/integration/preflight", {}, preflightBtn, function(res){
        toast(t("taskPreflightOk"));
        if(res && res.result){
          var previous = integ.querySelector('[data-fl-role="preflight-result"]');
          if(previous) previous.remove();
          integ.appendChild(renderPreflightResult(res.result));
          if(res.result.id && (!res.result.rejectionReasons || res.result.rejectionReasons.length === 0)){
            receiptIn.value = String(res.result.id);
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
    receiptIn.placeholder = "receipt-...";
    receiptLab.appendChild(receiptIn);
    integ.appendChild(receiptLab);
    var applyBtn = h("button", "btn sm danger", t("taskApply"));
    applyBtn.type = "button";
    applyBtn.addEventListener("click", function(){
      if(!receiptIn.value.trim()){ flashError(t("taskReceiptRequired")); return; }
      if(!window.confirm(t("taskApplyConfirm"))) return;
      taskAction("/api/ops/tasks/" + encodeURIComponent(task.id) + "/integration/apply", {
        receiptId: receiptIn.value.trim(),
        confirm: true
      }, applyBtn, function(){ showIntegration(task.id); });
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
  switch(S.tab){
    case "overview": rOverview(); break;
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
  if(!S.token){ showUnauthenticated(); return; }
  $$("#fl-tabs button").forEach(function(btn){
    btn.addEventListener("click", function(){
      $$("#fl-tabs button").forEach(function(b){ b.classList.remove("active"); });
      btn.classList.add("active");
      S.tab = btn.getAttribute("data-tab");
      if(S.tab !== "worker") S.workerFormActive = false;
      hideDetail();
      render();
    });
  });
  document.addEventListener("keydown", function(e){
    if(e.key==="Escape"&&S.detail) hideDetail();
  });
  if(scrimEl){
    scrimEl.addEventListener("click", function(){ if(S.detail) hideDetail(); });
  }
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
    applyChromeI18n();
    setPageChrome();
    if(S.token) render();
  };
  applyChromeI18n();
  setPageChrome();
  startPoll();
}
document.addEventListener("DOMContentLoaded", init);
