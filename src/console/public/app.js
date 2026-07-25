/* ForkLight Console - DOM construction only (textContent + addEventListener) */
var $ = function(s){ return document.querySelector(s); };
var $$ = function(s){ return document.querySelectorAll(s); };
function h(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; }
function hd(tag, cls, kids){ var e = document.createElement(tag); if(cls) e.className = cls; if(kids) kids.forEach(function(k){ if(k) e.appendChild(k); }); return e; }
function td(cls, text){ return h("td", cls, text); }
function badge(s){
  var m = {
    "succeeded":"badge-ok","completed":"badge-ok",
    "running":"badge-info","active":"badge-info","preparing":"badge-warn","verifying":"badge-warn",
    "queued":"badge-dim","waiting":"badge-dim","pending":"badge-dim",
    "blocked":"badge-err","failed":"badge-err","interrupted":"badge-err"
  };
  return h("span", "badge " + (m[s] || "badge-dim"), s);
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

var PAGE = {
  overview: { title: "Home", sub: "A calm snapshot of what is running and what needs you" },
  tasks: { title: "Board", sub: "Tasks arranged as a Kanban board - click a card for the full story" },
  plans: { title: "Plans", sub: "Multi-step work plans and their live progress" },
  competitions: { title: "Compete", sub: "Model competitions and advisory outcomes" },
  stats: { title: "Insights", sub: "Provider and model evidence from completed work" },
  settings: { title: "Settings", sub: "Effective configuration - read only in Console" }
};

var S = {
  settings: null, health: null, boards: null, tasks: null, competitions: null, stats: null,
  lastOk: 0, connected: false, hadOk: false, tab: "overview",
  detail: null, detailReturnFocus: null, timer: null, token: null
};
var viewEl, detailEl, statusEl, footerEl, titleEl, subEl, topMetaEl, scrimEl;

/* --- Utils --- */
function fmtTm(iso){
  if(!iso) return "-";
  var d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function fmtSince(iso){
  if(!iso) return "-";
  var ms = Date.now() - new Date(iso).getTime();
  if(ms < 60000) return Math.round(ms / 1000) + "s ago";
  if(ms < 3600000) return Math.round(ms / 60000) + "m ago";
  if(ms < 86400000) return Math.round(ms / 3600000) + "h ago";
  return Math.round(ms / 86400000) + "d ago";
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
function readToken(){
  var raw = window.location.hash;
  if(!raw || raw.charAt(0) !== "#") return null;
  var token = raw.slice(1);
  if(!window.history || !history.replaceState) return null;
  try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch(_){ return null; }
  if(token.length!==43 || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return token;
}
function fetchJSON(path){
  return fetch(path, { headers: { "X-ForkLight-Console-Token": S.token } }).then(function(r){
    if(!r.ok){ var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return r.json();
  });
}
function showUnauthenticated(){
  viewEl.replaceChildren(stateMsg("disconnected", "No authenticated Console session. Reopen the Console link from ForkLight."));
  statusEl.textContent = "Unauthenticated - reopen Console link";
  if(topMetaEl) topMetaEl.textContent = "";
}

/* --- Polling --- */
function scheduleNext(){
  var ms = S.settings && S.settings.console && S.settings.console.refreshIntervalMs
    ? Math.max(200, S.settings.console.refreshIntervalMs) : 1000;
  S.timer = setTimeout(refresh, ms);
}
function refresh(){
  S.timer = null;
  Promise.all([
    fetchJSON("/health"), fetchJSON("/board"), fetchJSON("/tasks"),
    fetchJSON("/competitions"), fetchJSON("/stats"), fetchJSON("/settings")
  ]).then(function(v){
    S.health = v[0]; S.boards = v[1]; S.tasks = v[2];
    S.competitions = v[3]; S.stats = v[4]; S.settings = v[5];
    S.lastOk = Date.now(); S.connected = true; S.hadOk = true;
  }).catch(function(e){
    S.connected = false;
    if(e&&e.status===401) S.token=null;
  }).then(function(){
    if(!S.token){ showUnauthenticated(); return; }
    render();
    scheduleNext();
  });
}
function startPoll(){
  viewEl.appendChild(stateMsg("loading", "Connecting to ForkLight"));
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
  var txt = S.connected ? "Live" : (S.hadOk ? "Reconnecting" : "Offline");
  if(!S.connected && S.hadOk) txt += " - last ok " + fmtSince(new Date(S.lastOk).toISOString());
  statusEl.appendChild(document.createTextNode(txt));
  if(S.health){
    statusEl.appendChild(document.createTextNode(
      " | active " + (S.health.activeTaskIds || []).length +
      " / queue " + (S.health.queuedTaskIds || []).length
    ));
  }
  if(topMetaEl && S.health){
    topMetaEl.appendChild(h("span", "meta-chip",
      "Workers " + (S.health.activeTaskIds || []).length + " active"
    ));
    topMetaEl.appendChild(h("span", "meta-chip",
      "Queue " + (S.health.queuedTaskIds || []).length
    ));
    topMetaEl.appendChild(h("span", "meta-chip",
      "Cap " + (S.health.maxConcurrency != null ? S.health.maxConcurrency : "-")
    ));
  }
  footerEl.textContent = "Updated " +
    new Date(S.lastOk || Date.now()).toLocaleTimeString("en-GB", { hour12: false }) +
    " - ForkLight Console";
}
function setPageChrome(){
  var p = PAGE[S.tab] || PAGE.overview;
  if(titleEl) titleEl.textContent = p.title;
  if(subEl) subEl.textContent = p.sub;
}
function showDisconnected(){
  viewEl.replaceChildren(stateMsg("disconnected", "Daemon unreachable - retrying"));
}

/* --- Provider Readiness --- */
function rProviders(){
  if(!S.health || (!S.health.providers && !S.health.providerVerification)) return;
  var configured = S.health.providers || {};
  var verified = S.health.providerVerification || {};
  var names = {};
  Object.keys(configured).forEach(function(name){ names[name] = true; });
  Object.keys(verified).forEach(function(name){ names[name] = true; });
  viewEl.appendChild(sec("Providers"));
  var grid = hd("div", "provider-grid");
  Object.keys(names).sort().forEach(function(name){
    var p = configured[name] || {};
    var v = verified[name] || {};
    var chip = h("div", "provider-chip");
    chip.appendChild(h("div", "provider-chip-name", name));
    var line = "";
    if(S.health.providerVerification){
      line = "config " + (p.ready ? "ready" : "missing key") + " / verify " + (v.status || "unverified");
    } else {
      line = p.status || (p.ready ? "ready" : "unavailable");
    }
    var model = v.model || p.model || p.defaultModel;
    if(model) line += "\n" + model;
    chip.appendChild(h("div", "provider-chip-meta", line));
    grid.appendChild(chip);
  });
  viewEl.appendChild(grid);
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
  d.appendChild(h("div", "name", i.taskName || i.itemId));
  d.appendChild(h("div", "meta", (i.taskStatus || "not started") + (i.error ? " - " + i.error.slice(0, 60) : "")));
  if(i.dependencies && i.dependencies.length){
    d.appendChild(h("div", "meta", "deps: " + i.dependencies.map(function(dd){
      return dd.itemId + "(" + dd.state + ")";
    }).join(", ")));
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
function kanbanCard(t){
  var cardEl = h("div", "kanban-card");
  cardEl.setAttribute("role", "button");
  cardEl.setAttribute("tabindex", "0");
  cardEl.appendChild(h("div", "kanban-card-title", t.name || "Untitled task"));
  var meta = h("div", "kanban-card-meta");
  meta.appendChild(badge(t.status));
  var p = t.progress;
  // Activity as plain text only - do not double-badge with a fake running/completed status.
  if(p && p.activity){
    meta.appendChild(document.createTextNode(p.activity));
  }
  if(t.failureCategory){
    meta.appendChild(h("span", "badge badge-err", t.failureCategory));
  }
  meta.appendChild(document.createTextNode(
    (t.runtime ? t.runtime + " · " : "") + (t.provider || "?") + " / " + (t.model || "?")
  ));
  meta.appendChild(document.createTextNode(fmtSince(t.createdAt)));
  cardEl.appendChild(meta);
  if(p && p.latestAction){
    cardEl.appendChild(h("div", "meta mt-4 dim fs11 truncate", p.latestAction));
  }
  if(p && p.lastEventAt){
    cardEl.appendChild(h("div", "meta dim fs11", "last event " + fmtSince(p.lastEventAt)));
  }
  if(t.error){
    cardEl.appendChild(h("div", "meta mt-4 red fs11 truncate", t.error));
  }
  var open = function(){ showTask(t.id); };
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
    body.appendChild(h("div", "kanban-empty", "Nothing here"));
  } else {
    items.forEach(function(t){ body.appendChild(kanbanCard(t)); });
  }
  col.appendChild(body);
  return col;
}

/* --- Overview --- */
function rOverview(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  var tasks = S.tasks || [];
  var lanes = countByLane(tasks);
  var comps = S.competitions || [];
  var plans = S.boards || [];
  var activeComp = comps.filter(function(c){ return c.status === "running" || c.status === "pending"; }).length;

  var metrics = hd("div", "grid-4", [
    metric("On the board", String(tasks.length), lanes.active + " working now"),
    metric("In motion", String(lanes.active), lanes.queued + " waiting in queue"),
    metric("Plans", String(plans.length), "Multi-step workflows"),
    metric("Competitions", String(comps.length), activeComp + " open")
  ]);
  viewEl.appendChild(metrics);

  viewEl.appendChild(sec("Needs attention"));
  var attention = tasks.filter(function(t){ return t.status === "failed" || t.status === "interrupted"; }).slice(0, 4);
  if(!attention.length){
    viewEl.appendChild(h("div", "summary-line mb-8", "No failed or interrupted tasks right now."));
  } else {
    attention.forEach(function(t){
      viewEl.appendChild(card(function(){ showTask(t.id); }, [
        cardHead(t.name, t.id, badge(t.status)),
        h("div", "summary-line", (t.provider || "") + "/" + (t.model || "") + " - " + (t.error || "Open for details"))
      ]));
    });
  }

  viewEl.appendChild(sec("Plans"));
  if(!plans.length){
    viewEl.appendChild(stateMsg("empty", "No plans submitted yet"));
  } else {
    plans.slice(0, 4).forEach(function(b){
      var pct = b.progress && b.progress.percent === 100 ? "completed" : "active";
      viewEl.appendChild(card(function(){ showPlanBoard(b.planId); }, [
        cardHead(b.name, b.planId, badge(b.progress && b.progress.total ? pct : "pending")),
        h("div", "card-subtitle mb-4", b.objective || ""),
        progBar(b.progress),
        h("div", "summary-line",
          (b.progress ? b.progress.completed : 0) + "/" + (b.progress ? b.progress.total : 0) +
          " done | active " + (b.progress ? b.progress.active : 0) +
          " blocked " + (b.progress ? b.progress.blocked : 0)
        )
      ]));
    });
  }

  viewEl.appendChild(sec("Competitions"));
  if(!comps.length){
    viewEl.appendChild(stateMsg("empty", "No competitions yet"));
  } else {
    comps.slice(0, 3).forEach(function(c){
      var pr = c.progress || {};
      viewEl.appendChild(card(function(){ showCompetition(c.id); }, [
        cardHead(c.name, c.id, badge(c.status)),
        h("div", "summary-line",
          "Candidates " + c.candidateCount + " | Terminal " + (pr.terminal || 0) + "/" + (pr.total || 0)
        )
      ]));
    });
  }

  rProviders();
}

/* --- Tasks Kanban --- */
function rTasks(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  var tasks = S.tasks || [];
  if(!tasks.length){
    viewEl.appendChild(stateMsg("empty", "No tasks yet - submit work from CLI or MCP and it will land here"));
    return;
  }
  var lanes = { queued: [], active: [], done: [], failed: [] };
  tasks.forEach(function(t){ lanes[taskLane(t.status)].push(t); });

  var counts = countByLane(tasks);
  var toolbar = h("div", "kanban-toolbar");
  var legend = h("div", "kanban-legend");
  [
    ["Queued", counts.queued],
    ["Working", counts.active],
    ["Done", counts.done],
    ["Failed", counts.failed]
  ].forEach(function(pair){
    var item = h("div", "legend-item");
    item.appendChild(document.createTextNode(pair[0] + " "));
    item.appendChild(h("span", "legend-count", String(pair[1])));
    legend.appendChild(item);
  });
  toolbar.appendChild(legend);
  toolbar.appendChild(h("div", "summary-line", tasks.length + " tasks on board"));
  viewEl.appendChild(toolbar);

  var board = h("div", "kanban");
  board.appendChild(kanbanColumn("queued", "Queued", "queued", lanes.queued));
  board.appendChild(kanbanColumn("active", "Working", "active", lanes.active));
  board.appendChild(kanbanColumn("done", "Done", "done", lanes.done));
  board.appendChild(kanbanColumn("failed", "Failed", "failed", lanes.failed));
  viewEl.appendChild(board);
}

/* --- Plans --- */
function rPlans(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  if(!S.boards || !S.boards.length){
    viewEl.appendChild(stateMsg("empty", "No plans submitted yet"));
    return;
  }
  var grid = hd("div", "grid-2");
  S.boards.forEach(function(b){
    var pct = b.progress && b.progress.percent === 100 ? "completed" : "active";
    grid.appendChild(card(function(){ showPlanBoard(b.planId); }, [
      cardHead(b.name, b.planId, badge(b.progress && b.progress.total ? pct : "pending")),
      h("div", "card-subtitle mb-4", b.objective || ""),
      progBar(b.progress),
      h("div", "fs11 dim",
        "queued " + (b.progress ? b.progress.queued : 0) +
        " · waiting " + (b.progress ? b.progress.waiting : 0) +
        " · active " + (b.progress ? b.progress.active : 0) +
        " · blocked " + (b.progress ? b.progress.blocked : 0) +
        " · failed " + (b.progress ? b.progress.failed : 0) +
        " · completed " + (b.progress ? b.progress.completed : 0) +
        " (" + (b.progress ? b.progress.percent : 0) + "%)"
      )
    ]));
  });
  viewEl.appendChild(grid);
}

/* --- Competitions --- */
function rCompetitions(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  if(!S.competitions || !S.competitions.length){
    viewEl.appendChild(stateMsg("empty", "No competitions yet"));
    return;
  }
  S.competitions.forEach(function(c){
    var pr = c.progress || {};
    viewEl.appendChild(card(function(){ showCompetition(c.id); }, [
      cardHead(c.name, c.id, badge(c.status)),
      h("div", "summary-line",
        "Candidates " + c.candidateCount +
        " | Terminal " + (pr.terminal || 0) + "/" + (pr.total || 0) +
        " | Created " + fmtSince(c.createdAt)
      )
    ]));
  });
}

/* --- Stats --- */
function rStats(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  if(!S.stats || !S.stats.length){
    viewEl.appendChild(stateMsg("empty", "No completed tasks for statistics"));
    return;
  }
  viewEl.appendChild(evCaveat(
    "Runtime estimate is Claude-side telemetry, not Provider official cost. Official native-currency statistics are not available yet."
  ));
  var grid = hd("div", "grid-2");
  S.stats.forEach(function(s){
    var c = card(null, [
      cardHead(s.provider + " / " + s.model, "", h("span", "badge badge-dim", s.sampleSize + " tasks"))
    ]);
    c.appendChild(hd("div", "grid-2", [
      h("div", "dim", "Success " + (s.successRate * 100).toFixed(0) + "% (verified " + s.verifiedSuccessCount + ")"),
      h("div", "dim", "Avg Retries: " + num(s.avgRetries, 1)),
      h("div", "dim", "Avg Runtime Estimate (USD): " + num(s.avgCostUsd, 3, "$")),
      h("div", "dim", "Avg Duration: " + unit(s.avgDurationMs !== undefined ? s.avgDurationMs / 1000 : undefined, 1, "s")),
      h("div", "dim", "Avg First Action: " + unit(s.avgTimeToFirstEffectiveActionMs !== undefined ? s.avgTimeToFirstEffectiveActionMs / 1000 : undefined, 1, "s")),
      h("div", "dim", "Avg Turns: " + num(s.avgTurns, 1))
    ]));
    if(s.failureDistribution && Object.keys(s.failureDistribution).length){
      var rowEl = hd("div", "pill-row", [h("span", "dim fs11", "Failures ")]);
      Object.entries(s.failureDistribution).forEach(function(e){
        rowEl.appendChild(h("span", "pill-badge", e[0] + ":" + e[1]));
      });
      c.appendChild(rowEl);
    }
    grid.appendChild(c);
  });
  viewEl.appendChild(grid);
}

/* --- Settings --- */
function rSettings(){
  viewEl.textContent = "";
  if(!S.hadOk){ showDisconnected(); return; }
  if(!S.settings){
    viewEl.appendChild(stateMsg("error", "Settings unavailable"));
    return;
  }
  viewEl.appendChild(h("div", "summary-line mb-8",
    "Changes via forklight settings or MCP. No credentials displayed."
  ));
  var rows = flattenSettings(S.settings, "");
  var groups = {};
  rows.forEach(function(r){
    var root = r[0].split(".")[0] || "general";
    if(!groups[root]) groups[root] = [];
    groups[root].push(r);
  });
  Object.keys(groups).sort().forEach(function(g){
    var box = h("div", "settings-group");
    box.appendChild(h("h3", "", g));
    groups[g].forEach(function(pair){
      var rowEl = h("div", "settings-row");
      rowEl.appendChild(h("div", "settings-key", pair[0]));
      rowEl.appendChild(h("div", "settings-val", pair[1]));
      box.appendChild(rowEl);
    });
    viewEl.appendChild(box);
  });
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
  var b = h("button", "detail-close", "Close");
  b.addEventListener("click", hideDetail);
  return b;
}

function decisionRow(label, value, kind){
  var rowEl = h("div", "decision-row" + (kind ? " decision-" + kind : ""));
  rowEl.appendChild(h("div", "decision-label", label));
  rowEl.appendChild(h("div", "decision-value",
    value === undefined || value === null ? "Unavailable" : String(value)
  ));
  return rowEl;
}
function renderDecision(d){
  var box = h("section", "decision-panel");
  box.appendChild(h("div", "section-title", "Next action"));
  box.appendChild(decisionRow("Current stage", d && d.stage, "stage"));
  box.appendChild(decisionRow("Next action", d && d.nextAction, "next"));

  box.appendChild(h("div", "section-title", "Who wrote it"));
  if(d && d.workerClaim){
    box.appendChild(decisionRow("Worker", d.workerClaim.provider + "/" + d.workerClaim.model));
    box.appendChild(decisionRow("Worker claim (unverified)", d.workerClaim.text, "claim"));
  } else {
    box.appendChild(decisionRow("Worker claim (unverified)", "Unavailable"));
  }

  box.appendChild(h("div", "section-title", "Independent verification"));
  var v = d && d.verification;
  if(v){
    box.appendChild(decisionRow("Overall", v.passed ? "Passed" : "Failed", v.passed ? "passed" : "failed"));
    box.appendChild(decisionRow("Behavior", v.behaviorPassed ? "Passed" : "Failed"));
    box.appendChild(decisionRow("Policy", v.policyPassed ? "Passed" : "Failed"));
    box.appendChild(decisionRow("Source compatibility", v.sourceCompatible ? "Passed" : "Failed"));
  } else {
    box.appendChild(decisionRow("Evidence", "Unavailable"));
  }

  box.appendChild(h("div", "section-title", "Main agent review"));
  var review = d && d.mainReview;
  if(review){
    box.appendChild(decisionRow("Decision", review.decision, review.decision === "accept" ? "passed" : "failed"));
    box.appendChild(decisionRow("Reason", review.reason));
  } else {
    box.appendChild(decisionRow("Decision", "Not recorded"));
  }

  box.appendChild(h("div", "section-title", "User authorization"));
  box.appendChild(decisionRow(
    "Integration gate",
    d && d.integration ? "Explicit confirm gate was exercised" : "Not exercised"
  ));

  box.appendChild(h("div", "section-title", "Integration and activation"));
  if(d && d.integration){
    box.appendChild(decisionRow("Operation", d.integration.operationId));
    box.appendChild(decisionRow("Operation status", d.integration.status));
    (d.integration.stages || []).forEach(function(s){
      box.appendChild(decisionRow(
        s.stage, s.status,
        s.status === "passed" ? "passed" : (s.status === "failed" ? "failed" : "")
      ));
    });
  } else {
    box.appendChild(decisionRow("Integration", "Not started"));
  }

  box.appendChild(h("div", "section-title", "Delivery lineage"));
  var l = d && d.lineage;
  if(l){
    box.appendChild(decisionRow("Attempts", l.attemptCount));
    box.appendChild(decisionRow("Correction attempts", (l.correctionAttemptIds || []).length));
    box.appendChild(decisionRow(
      "Combined delivery diff",
      (l.combinedDeliveryDiff && l.combinedDeliveryDiff.filesChanged || 0) + " files / " +
      (l.combinedDeliveryDiff && l.combinedDeliveryDiff.changedLines || 0) + " lines"
    ));
  } else {
    box.appendChild(decisionRow("Lineage", "Unavailable"));
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
  loadingDetail("Loading plan board");
  fetchJSON("/board/" + encodeURIComponent(id)).then(function(board){
    var f = fr();
    f.appendChild(closeBtn());
    var pct = board.plan.progress && board.plan.progress.percent === 100 ? "completed" : "active";
    f.appendChild(cardHead(board.plan.name, "", badge(pct)));
    f.appendChild(h("div", "card-subtitle mb-8",
      (board.plan.objective || "") + " - Updated " + fmtSince(board.plan.updatedAt)
    ));
    f.appendChild(progBar(board.plan.progress));
    var cols = hd("div", "columns mt-8");
    [
      { k: "queued", l: "Queued" },
      { k: "active", l: "Active" },
      { k: "blocked", l: "Blocked" },
      { k: "failed", l: "Failed" },
      { k: "completed", l: "Completed" }
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
    detailEl.replaceChildren(closeBtn(), stateMsg("error", "Failed: " + e.message));
  });
}

function showTask(id){
  loadingDetail("Loading task detail");
  fetchJSON("/tasks/" + encodeURIComponent(id)).then(function(t){
    var f = fr();
    f.appendChild(closeBtn());
    f.appendChild(cardHead(t.name, "", badge(t.status)));
    f.appendChild(hd("div", "grid-2 fs12 mb-8", [
      hd("div", "", [h("span", "dim", "ID "), h("span", "mono", t.id)]),
      hd("div", "", [h("span", "dim", "Provider "), document.createTextNode(t.provider + "/" + t.model)]),
      hd("div", "", [h("span", "dim", "Runtime "), document.createTextNode(t.runtime)]),
      hd("div", "", [h("span", "dim", "Source "), h("span", "mono", t.source || "")]),
      hd("div", "", [h("span", "dim", "Created "), document.createTextNode(fmtTm(t.createdAt))]),
      hd("div", "", [h("span", "dim", "Started "), document.createTextNode(fmtTm(t.startedAt))]),
      hd("div", "", [h("span", "dim", "Finished "), document.createTextNode(fmtTm(t.finishedAt))]),
      hd("div", "", [h("span", "dim", "Session "), h("span", "mono truncate", t.sessionId || "")])
    ]));
    if(t.decision && t.decision.failureCategory){
      f.appendChild(h("div", "summary-line mb-8", "failureCategory: " + t.decision.failureCategory));
    }
    if(t.decision && t.decision.progress){
      var dp = t.decision.progress;
      f.appendChild(h("div", "summary-line mb-8",
        "activity " + (dp.activity || "-") +
        " | lastEvent " + (dp.lastEventAt ? fmtSince(dp.lastEventAt) : "-") +
        (dp.latestAction ? " | " + dp.latestAction : "")
      ));
    }
    if(t.error){
      var eb = h("div", "error-box");
      eb.appendChild(h("strong", "", "Error: "));
      eb.appendChild(document.createTextNode(t.error));
      f.appendChild(eb);
    }
    f.appendChild(renderDecision(t.decision));
    if(t.economics){
      var ee = renderEconomicsEvidence(t.economics);
      if(ee) f.appendChild(collapsedSection("Economics evidence", ee));
    }
    if(t.timeline && t.timeline.length){
      var tl = h("div", "timeline");
      t.timeline.forEach(function(e){
        var te = h("div", "timeline-entry");
        te.appendChild(h("span", "ts", fmtTm(e.timestamp)));
        te.appendChild(h("span", "", e.type));
        te.appendChild(h("span", "dim", e.summary));
        tl.appendChild(te);
      });
      f.appendChild(collapsedSection("Event Timeline (" + t.timeline.length + ")", tl));
    }
    var il = h("button", "back-link mt-12", "Integration History");
    il.addEventListener("click", function(){ showIntegration(t.id); });
    f.appendChild(hd("div", "mt-12", [il]));
    showDetail(f);
  }).catch(function(e){
    detailEl.replaceChildren(closeBtn(), stateMsg("error", "Failed: " + e.message));
  });
}

function renderEconomicsEvidence(e){
  if(!e || typeof e !== "object"){
    var e1 = document.createDocumentFragment();
    e1.appendChild(sec("Economics Evidence"));
    e1.appendChild(stateMsg("empty", "Economics evidence unavailable"));
    return e1;
  }
  var f = fr();
  f.appendChild(sec("Economics Evidence"));
  var grid = hd("div", "economics-grid");

  var b = e.runtimeBudget || {};
  var budgetCard = evCard("Runtime Budget (Task spec cap)");
  if(b.capped){
    budgetCard.appendChild(evRowMixed("Max Claude runtime", [evCost(b.maxBudgetUsd,"USD"), " ", evPill("capped")]));
    budgetCard.appendChild(evCaveat("Caps Claude runtime spend only - not a Provider bill, not official cost evidence"));
  } else {
    budgetCard.appendChild(evRow("Max Claude runtime", "uncapped"));
    budgetCard.appendChild(evCaveat("Task spec did not set runtime.maxBudgetUsd; uncapped Claude runtime, not a Provider spending authority"));
  }
  grid.appendChild(budgetCard);

  var re = e.runtimeEstimate || {};
  var total = re.sampleCount + re.missingCount;
  var reCard = evCard("Runtime Estimate (runtimeCostEstimateUsd, Claude-side)");
  reCard.appendChild(evRowMixed("Estimated total", [
    evCost(re.observedTotalUsd,"USD"),
    " across " + re.sampleCount + " of " + total + " attempt" + (total === 1 ? "" : "s")
  ]));
  reCard.appendChild(evRow("Evidence state", re.complete ? "complete" : "incomplete"));
  if(!re.complete && re.missingCount > 0){
    reCard.appendChild(evCaveat(
      "Missing samples: " + re.missingCount + " attempt" + (re.missingCount === 1 ? "" : "s") +
      " - interrupted or legacy Attempts have no runtimeCostEstimateUsd; legacy costUsd is never aggregated"
    ));
  }
  reCard.appendChild(evCaveat("This is an internal Claude runtime estimate - distinct from the official Provider source quote below; never a Provider bill"));
  grid.appendChild(reCard);

  var oc = e.officialCost || {};
  var totals = oc.totals || [];
  if(totals.length === 0){
    var noQuote = evCard("Official Cost (Provider source quote)");
    noQuote.appendChild(evRow("Quoted totals", "none"));
    noQuote.appendChild(evCaveat("No Attempt carried a quoted official cost"));
    grid.appendChild(noQuote);
  } else {
    totals.forEach(function(t){
      var cardEl = evCard("Official Cost (" + t.currency + ") - Provider source quote");
      cardEl.appendChild(evRowMixed("Quoted total", [
        evCost(t.total,t.currency),
        " from " + t.quotedCount + " attempt" + (t.quotedCount === 1 ? "" : "s")
      ]));
      if(t.providerBillClaim) cardEl.appendChild(evCaveat("Quoted source asserts this matches the Provider bill"));
      else cardEl.appendChild(evCaveat("Quoted source matches Provider list price - not a Provider bill"));
      var srcs = t.sources || [];
      if(srcs.length) cardEl.appendChild(evRow("Source" + (srcs.length > 1 ? "s" : ""), evSources(srcs)));
      grid.appendChild(cardEl);
    });
  }
  var ua = oc.unavailable || {};
  if(ua.unavailableCount > 0){
    var uCard = evCard("Official Cost unavailable (" + ua.unavailableCount + " attempt" + (ua.unavailableCount === 1 ? "" : "s") + ")");
    uCard.appendChild(evCaveat("Unavailable Attempts are kept explicit and never coerced to zero - shown below by typed stage:reason"));
    if(ua.breakdown) uCard.appendChild(evBreakdownPills(ua.breakdown));
    var entries = (ua.entries || []).slice(0, 5);
    entries.forEach(function(en){
      uCard.appendChild(evCaveat("Attempt #" + en.ordinal + " - " + en.stage + ": " + en.reason));
    });
    if(ua.entries && ua.entries.length > 5){
      uCard.appendChild(evCaveat("and " + (ua.entries.length - 5) + " more unavailable Attempt(s) - not shown"));
    }
    grid.appendChild(uCard);
  }

  var tr = (e.tokenReport && e.tokenReport.report) || {};
  var wv = tr.workerVolume || { kind: "incomplete" };
  var wvCard = evCard("Worker Token Volume (gross external Worker Tokens - this is offloaded coding-assistant work)");
  if(wv.kind === "complete"){
    wvCard.appendChild(evRow("Gross Worker Tokens", num(wv.grossWorkerTokens, 0) + " tokens"));
    wvCard.appendChild(evRow("Samples", "" + wv.sampleCount + " (complete)"));
  } else {
    wvCard.appendChild(evRow("Gross Worker Tokens", num(wv.grossWorkerTokens, 0) + " tokens"));
    var sc = wv.sampleCount || 0, cm = wv.completeSampleCount || 0;
    wvCard.appendChild(evRow("Samples", cm + " complete of " + sc));
    wvCard.appendChild(evCaveat(
      "Worker evidence incomplete - " + wv.missingSampleCount + " attempt" +
      (wv.missingSampleCount === 1 ? "" : "s") + " without terminal-result usage"
    ));
  }
  wvCard.appendChild(evCaveat("Gross external Worker Tokens consumed by coding-assistant work - distinct from any savings or reduction figure"));
  grid.appendChild(wvCard);

  var ee = tr.exchangeEstimate || { kind: "unavailable" };
  var eeCard = evCard("Orchestration Exchange (ForkLight <-> Codex, redacted count-only evidence)");
  if(ee.kind === "exact"){
    eeCard.appendChild(evRowMixed("Token estimate", [num(ee.tokens, 0) + " tokens (exact)  ", evPill("high", "high")]));
    eeCard.appendChild(evCaveat("Source: " + ee.source));
  } else if(ee.kind === "range"){
    eeCard.appendChild(evRowMixed("Token estimate (range)", [
      evRange(ee.range.min, ee.range.max), " tokens  ", evPill(ee.range.confidence, ee.range.confidence)
    ]));
    eeCard.appendChild(evCaveat("Method: " + ee.range.method + " - confidence reflects estimate breadth, not certainty"));
  } else {
    eeCard.appendChild(evUnavailableRow("Token estimate", "unavailable", evReason(ee.reason)));
  }
  eeCard.appendChild(evCaveat("CLI receipts describe producer output before a shell pipeline exits - captured exchange is not exact Codex-visible context"));
  grid.appendChild(eeCard);

  var br = tr.boundaryReduction || { available: false };
  var brCard = evCard("Boundary Reduction (measured Worker Tokens minus orchestration exchange, NOT a direct-Codex counterfactual)");
  if(br.available){
    brCard.appendChild(evRowMixed("Reduction range", [
      evRange(br.tokens.min, br.tokens.max), " Tokens  ", evPill(br.tokens.confidence, br.tokens.confidence)
    ]));
    brCard.appendChild(evCaveat("Method: " + br.tokens.method));
    brCard.appendChild(evCaveat("This is a measured reduction on the ForkLight side - never to be presented as direct-Codex savings"));
  } else {
    brCard.appendChild(evUnavailableRow("Reduction range", "unavailable", evReason(br.reason)));
    brCard.appendChild(evCaveat("Boundary reduction stays unavailable while Worker usage or exchange evidence is missing"));
  }
  grid.appendChild(brCard);

  var ds = tr.directCodexSavings || { available: false };
  var dsCard = evCard("Direct-Codex Savings (counterfactual - not yet measurable without compatible calibration)");
  if(ds.available){
    var bas = ds.baseline || {};
    dsCard.appendChild(evRowMixed("Baseline (calibration)", [
      num(bas.minTokens, 0) + "-" + num(bas.maxTokens, 0) + " tokens, task class: " + bas.taskClass + ", " + bas.method + "  ",
      evPill(bas.confidence, bas.confidence)
    ]));
    dsCard.appendChild(evRowMixed("Absolute savings", [
      evRange(ds.absoluteSavings.min, ds.absoluteSavings.max), " Tokens  ",
      evPill(ds.absoluteSavings.confidence, ds.absoluteSavings.confidence)
    ]));
    if(ds.percentageSavings && ds.percentageSavings.available){
      dsCard.appendChild(evRowMixed("Percentage savings", [
        num(ds.percentageSavings.range.min, 1) + "% - " + num(ds.percentageSavings.range.max, 1) + "%  ",
        evPill(ds.percentageSavings.range.confidence, ds.percentageSavings.range.confidence)
      ]));
      dsCard.appendChild(evCaveat("Method: " + ds.percentageSavings.range.method));
    } else {
      dsCard.appendChild(evUnavailableRow("Percentage savings", "unavailable", evReason("zero-baseline")));
    }
  } else {
    dsCard.appendChild(evRow("Status", "not yet measurable"));
    dsCard.appendChild(evUnavailableRow("Direct-Codex savings", "not yet measurable", evReason(ds.reason)));
    dsCard.appendChild(evCaveat("Direct-Codex savings is a counterfactual; the UI does not invent or estimate savings without a compatible task-class calibration"));
  }
  grid.appendChild(dsCard);

  f.appendChild(grid);
  return f;
}

function showCompetition(cid){
  loadingDetail("Loading competition");
  fetchJSON("/competitions/" + encodeURIComponent(cid)).then(function(c){
    var f = fr();
    f.appendChild(closeBtn());
    var comp = c.competition || {}, cands = c.candidates || [], prog = c.progress || {};
    f.appendChild(cardHead(comp.name, comp.id, badge(comp.status)));
    f.appendChild(h("div", "summary-line mb-8",
      "Progress " + (prog.terminal || 0) + "/" + (prog.total || 0) + " terminal | Candidates " + cands.length
    ));
    if(cands.length){
      var tbl = h("table", ""), thd = h("thead", "");
      thd.appendChild(theadRow(["Candidate", "Provider", "Model", "Status", "Started", "Finished", "Error"]));
      tbl.appendChild(thd);
      var tbd = document.createElement("tbody");
      cands.forEach(function(cd){
        tbd.appendChild(row([
          h("td", "mono truncate", cd.candidateId || ""),
          h("td", "", cd.providerName),
          h("td", "", cd.modelName),
          badgeTd(cd.taskStatus),
          h("td", "", fmtTm(cd.taskStartedAt)),
          h("td", "", fmtTm(cd.taskFinishedAt)),
          h("td", "truncate", cd.error || "")
        ]));
      });
      tbl.appendChild(tbd);
      f.appendChild(tbl);
    }
    if(c.evaluation){
      var ev = c.evaluation;
      f.appendChild(sec("Evaluation"));
      if(ev.candidates && ev.candidates.length){
        var et = h("table", ""), ethd = h("thead", "");
        ethd.appendChild(theadRow(["Candidate", "Eligible numeric", "Score numeric", "Disqualification"]));
        et.appendChild(ethd);
        var etbd = document.createElement("tbody");
        ev.candidates.forEach(function(sc){
          etbd.appendChild(row([
            h("td", "", sc.providerName + "/" + sc.modelName),
            td("numeric", sc.eligible ? "Yes" : "No"),
            td("numeric", sc.totalScore !== undefined ? sc.totalScore.toFixed(3) : "-"),
            h("td", "truncate", sc.disqualificationReason || "")
          ]));
        });
        et.appendChild(etbd);
        f.appendChild(et);
      }
      if(ev.recommendation){
        f.appendChild(h("div", "fs12 mt-8",
          "Recommendation: " + ev.recommendation.candidateId +
          " (confidence: " + (ev.recommendation.confidence * 100).toFixed(0) + "%): " +
          ev.recommendation.reasoning
        ));
      }
    }
    var back = h("button", "back-link mt-12", "Back");
    back.addEventListener("click", hideDetail);
    f.appendChild(hd("div", "mt-12", [back]));
    showDetail(f);
  }).catch(function(e){
    detailEl.replaceChildren(closeBtn(), stateMsg("error", "Failed: " + e.message));
  });
}

function showIntegration(taskId){
  loadingDetail("Loading integration history");
  fetchJSON("/integration/" + encodeURIComponent(taskId) + "/history").then(function(hist){
    var f = fr();
    f.appendChild(closeBtn());
    f.appendChild(h("div", "card-title mb-8", "Integration History"));
    f.appendChild(sec("Receipts (" + ((hist.receipts || []).length) + ")"));
    if(hist.receipts && hist.receipts.length){
      var rtb = h("table", ""), rthd = h("thead", "");
      rthd.appendChild(theadRow(["Receipt ID", "Digest", "Files", "Created"]));
      rtb.appendChild(rthd);
      var rtbd = document.createElement("tbody");
      hist.receipts.forEach(function(r){
        rtbd.appendChild(row([
          h("td", "mono truncate", r.id),
          h("td", "mono truncate", r.patchDigest || ""),
          h("td", "truncate", (r.affectedFiles || []).join(", ")),
          h("td", "", fmtSince(r.createdAt))
        ]));
      });
      rtb.appendChild(rtbd);
      f.appendChild(rtb);
    } else {
      f.appendChild(stateMsg("empty", "No receipts"));
    }
    f.appendChild(sec("Results (" + ((hist.results || []).length) + ")"));
    if(hist.results && hist.results.length){
      var stb = h("table", ""), sthd = h("thead", "");
      sthd.appendChild(theadRow(["Status", "Receipt", "Applied", "Error"]));
      stb.appendChild(sthd);
      var stbd = document.createElement("tbody");
      hist.results.forEach(function(r){
        stbd.appendChild(row([
          badgeTd(r.status),
          h("td", "mono truncate", r.receiptId || ""),
          h("td", "", fmtTm(r.appliedAt)),
          h("td", "truncate", r.error || "")
        ]));
      });
      stb.appendChild(stbd);
      f.appendChild(stb);
    } else {
      f.appendChild(stateMsg("empty", "No results"));
    }
    showDetail(f);
  }).catch(function(e){
    detailEl.replaceChildren(closeBtn(), stateMsg("error", "Failed: " + e.message));
  });
}

/* --- Render dispatcher --- */
function render(){
  updStatus();
  setPageChrome();
  switch(S.tab){
    case "overview": rOverview(); break;
    case "plans": rPlans(); break;
    case "tasks": rTasks(); break;
    case "competitions": rCompetitions(); break;
    case "stats": rStats(); break;
    case "settings": rSettings(); break;
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
  startPoll();
}
document.addEventListener("DOMContentLoaded", init);
