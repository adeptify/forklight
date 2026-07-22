/* ForkLight Console --DOM construction only, no innerHTML/inline handlers/inline styles for API data */
var $=function(s){return document.querySelector(s);};
var $$=function(s){return document.querySelectorAll(s);};
function h(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function hd(tag,cls,kids){var e=document.createElement(tag);if(cls)e.className=cls;if(kids)kids.forEach(function(k){if(k)e.appendChild(k);});return e;}
function td(cls,text){return h("td",cls,text);}
function th(cls,text){return h("th",cls,text);}
function badge(s){var m={"succeeded":"badge-ok","completed":"badge-ok","running":"badge-warn","active":"badge-warn","preparing":"badge-warn","verifying":"badge-warn","queued":"badge-dim","waiting":"badge-dim","blocked":"badge-err","failed":"badge-err","interrupted":"badge-err","pending":"badge-dim"};return h("span","badge "+(m[s]||"badge-dim"),s);}
function badgeTd(s){var b=td("");b.appendChild(badge(s));return b;}
function progBar(p){var el=h("progress","progress-bar");el.setAttribute("max","100");el.setAttribute("value",p&&p.total>0?String(Math.round(p.completed/p.total*100)):"0");return el;}
function stateMsg(kind,text){return h("div","state-msg "+kind,text);}
function sec(title){return h("div","section-title",title);}
function fr(){return document.createDocumentFragment();}

var S={settings:null,health:null,boards:null,tasks:null,competitions:null,stats:null,lastOk:0,connected:false,hadOk:false,tab:"overview",detail:null,timer:null};
var viewEl,detailEl,statusEl,footerEl;

/* --- Utils --- */
function fmtTm(iso){if(!iso)return "-";var d=new Date(iso);return d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});}
function fmtSince(iso){if(!iso)return "-";var ms=Date.now()-new Date(iso).getTime();if(ms<60000)return Math.round(ms/1000)+"s ago";if(ms<3600000)return Math.round(ms/60000)+"m ago";if(ms<86400000)return Math.round(ms/3600000)+"h ago";return Math.round(ms/86400000)+"d ago";}
function num(v,dec,tag){if(v===undefined||v===null)return "-";return (tag||"")+v.toFixed(dec||0);}
function cardHead(title,sub,b){var d=h("div","card-header"),l=h("div","");l.appendChild(h("div","card-title",title));if(sub)l.appendChild(h("div","card-subtitle mono",sub));d.appendChild(l);if(b)d.appendChild(b);return d;}
function theadRow(labels){var tr=document.createElement("tr");labels.forEach(function(l){tr.appendChild(h("th",l.indexOf(" numeric")>=0?"numeric":"",l.replace(" numeric","")));});return tr;}

/* --- Card helper with keyboard accessibility --- */
function card(onActivate,children){
  var c=h("div","card");c.append.apply(c,children);
  if(onActivate){c.setAttribute("role","button");c.setAttribute("tabindex","0");c.classList.add("clickable");
    c.addEventListener("click",onActivate);
    c.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();onActivate.call(c);}});
  }return c;
}
function row(tableData,clickFn){
  var tr=h("tr","clickable");if(clickFn){tr.setAttribute("tabindex","0");tr.addEventListener("click",clickFn);
    tr.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();clickFn();}});}
  tableData.forEach(function(cell){tr.appendChild(cell);});return tr;
}

/* --- API --- */
function fetchJSON(path){return fetch(path).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();});}

/* --- Polling: recursive setTimeout, cannot overlap --- */
function scheduleNext(){var ms=S.settings&&S.settings.console&&S.settings.console.refreshIntervalMs?Math.max(200,S.settings.console.refreshIntervalMs):1000;S.timer=setTimeout(refresh,ms);}
function refresh(){S.timer=null;
  Promise.all([fetchJSON("/health"),fetchJSON("/board"),fetchJSON("/tasks"),fetchJSON("/competitions"),fetchJSON("/stats"),fetchJSON("/settings")]).then(function(v){
    S.health=v[0];S.boards=v[1];S.tasks=v[2];S.competitions=v[3];S.stats=v[4];S.settings=v[5];S.lastOk=Date.now();S.connected=true;S.hadOk=true;
  }).catch(function(){S.connected=false;}).then(function(){render();scheduleNext();});
}
function startPoll(){viewEl.appendChild(stateMsg("loading","Connecting to ForkLight daemon"));refresh();}

/* --- Status bar & footer (textContent) --- */
function updStatus(){statusEl.textContent="";footerEl.textContent="";
  var st=S.connected?"ok":S.hadOk?"stale":"disconnected";
  var dot=h("span","status-dot "+st);statusEl.appendChild(dot);
  var txt=S.connected?"Connected":S.hadOk?"Stale":"Disconnected";
  if(!S.connected&&S.hadOk){txt+=" - last ok "+fmtSince(new Date(S.lastOk).toISOString());}
  statusEl.appendChild(document.createTextNode(txt));
  if(S.health){statusEl.appendChild(document.createTextNode(" | active:"+(S.health.activeTaskIds||[]).length+" queued:"+(S.health.queuedTaskIds||[]).length+" max:"+S.health.maxConcurrency));}
  if(S.settings&&S.settings.console){statusEl.appendChild(document.createTextNode(" | refresh:"+S.settings.console.refreshIntervalMs+"ms"));}
  footerEl.textContent="Last update: "+new Date(S.lastOk||Date.now()).toLocaleTimeString("en-GB",{hour12:false})+" - ForkLight Console";
}
function showDisconnected(){viewEl.replaceChildren(stateMsg("disconnected","Daemon unreachable - retrying"));}

/* --- Provider Readiness --- */
function rProviders(){
  if(!S.health||(!S.health.providers&&!S.health.providerVerification))return;
  var configured=S.health.providers||{},verified=S.health.providerVerification||{},names={};
  Object.keys(configured).forEach(function(name){names[name]=true;});
  Object.keys(verified).forEach(function(name){names[name]=true;});
  var hdr=sec("Provider Readiness"),grid=hd("div","grid-3");
  Object.keys(names).sort().forEach(function(name){
    var p=configured[name]||{},v=verified[name]||{};
    var txt;
    if(S.health.providerVerification){
      txt="config:"+(p.ready?"ready":"missing key")+" / verify:"+(v.status||"unverified");
    }else{
      txt=p.status||(p.ready?"ready":"unavailable");
    }
    var model=v.model||p.model||p.defaultModel;if(model)txt+=" / "+model;
    grid.appendChild(h("div","dim fs11",name+": "+txt));
  });viewEl.appendChild(hdr);viewEl.appendChild(grid);
}

/* --- Settings: recursive path/value dump --- */
function flattenSettings(obj,prefix){
  var rows=[];
  for(var key in obj){if(!Object.prototype.hasOwnProperty.call(obj,key))continue;
    var v=obj[key],path=prefix?prefix+"."+key:key;
    if(v!==null&&typeof v==="object"&&!Array.isArray(v)){rows=rows.concat(flattenSettings(v,path));}
    else if(v!==undefined){rows.push([path,String(v)]);}
  }return rows;
}

/* --- Board item --- */
function boardItem(i){
  var d=h("div","column-item");if(i.taskId){d.setAttribute("tabindex","0");d.setAttribute("role","button");
    d.addEventListener("click",function(){showTask(i.taskId);});
    d.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();showTask(i.taskId);}});
  }
  d.appendChild(h("div","name",i.taskName||i.itemId));
  d.appendChild(h("div","meta",(i.taskStatus||"not started")+(i.error?" - "+i.error.slice(0,60):"")));
  if(i.dependencies&&i.dependencies.length){d.appendChild(h("div","meta","deps: "+i.dependencies.map(function(dd){return dd.itemId+"("+dd.state+")";}).join(", ")));}
  return d;
}

/* --- Render: overview --- */
function rOverview(){viewEl.textContent="";
  if(!S.hadOk){showDisconnected();return;}
  // Plans
  viewEl.appendChild(sec("Plans"));
  if(!S.boards||!S.boards.length){viewEl.appendChild(stateMsg("empty","No plans submitted yet"));}
  else {S.boards.forEach(function(b){var pct=b.progress&&b.progress.percent===100?"completed":"active";
    viewEl.appendChild(card(function(){showPlanBoard(b.planId);},[
      cardHead(b.name,b.planId,badge(b.progress&&b.progress.total?pct:"pending")),
      h("div","card-subtitle mb-4",b.objective||""),progBar(b.progress),
      h("div","summary-line",(b.progress?b.progress.completed:0)+"/"+(b.progress?b.progress.total:0)+" done | active:"+(b.progress?b.progress.active:0)+" blocked:"+(b.progress?b.progress.blocked:0)+" failed:"+(b.progress?b.progress.failed:0)),
    ]));
  });}
  // Competitions
  viewEl.appendChild(sec("Competitions"));
  if(!S.competitions||!S.competitions.length){viewEl.appendChild(stateMsg("empty","No competitions yet"));}
  else {S.competitions.forEach(function(c){var pr=c.progress||{};
    viewEl.appendChild(card(function(){showCompetition(c.id);},[
      cardHead(c.name,c.id,badge(c.status)),
      h("div","summary-line","Candidates: "+c.candidateCount+" | Terminal: "+(pr.terminal||0)+"/"+(pr.total||0)),
    ]));
  });}
  // Provider Readiness
  rProviders();
  // Provider Statistics
  viewEl.appendChild(sec("Provider Statistics"));
  if(!S.stats||!S.stats.length){viewEl.appendChild(stateMsg("empty","No completed tasks for statistics"));}
  else {var tbl=h("table",""),thd=h("thead","");
    thd.appendChild(theadRow(["Provider","Model","N numeric","Success numeric","Verified numeric","Avg Retries numeric","Avg Cost numeric","Avg Duration numeric"]));tbl.appendChild(thd);
    var tbd=document.createElement("tbody");S.stats.forEach(function(s){
      tbd.appendChild(row([h("td","",s.provider),h("td","",s.model),td("numeric",""+s.sampleSize),td("numeric",(s.successRate*100).toFixed(0)+"%"),td("numeric",""+s.verifiedSuccessCount),td("numeric",num(s.avgRetries,1)),td("numeric",num(s.avgCostUsd,3,"$")),td("numeric",num(s.avgDurationMs!==undefined?s.avgDurationMs/1000:undefined,1,"s"))]));
    });tbl.appendChild(tbd);viewEl.appendChild(tbl);}
}

/* --- Render: plans --- */
function rPlans(){viewEl.textContent="";if(!S.hadOk){showDisconnected();return;}
  if(!S.boards||!S.boards.length){viewEl.appendChild(stateMsg("empty","No plans submitted yet"));return;}
  S.boards.forEach(function(b){var pct=b.progress&&b.progress.percent===100?"completed":"active";
    viewEl.appendChild(card(function(){showPlanBoard(b.planId);},[
      cardHead(b.name,b.planId,badge(b.progress&&b.progress.total?pct:"pending")),
      h("div","card-subtitle mb-4",b.objective||""),progBar(b.progress),
      h("div","fs10 dim","queued:"+(b.progress?b.progress.queued:0)+" waiting:"+(b.progress?b.progress.waiting:0)+" active:"+(b.progress?b.progress.active:0)+" blocked:"+(b.progress?b.progress.blocked:0)+" failed:"+(b.progress?b.progress.failed:0)+" completed:"+(b.progress?b.progress.completed:0)+" ("+(b.progress?b.progress.percent:0)+"%)"),
    ]));
  });
}

/* --- Render: tasks --- */
function rTasks(){viewEl.textContent="";if(!S.hadOk){showDisconnected();return;}
  if(!S.tasks||!S.tasks.length){viewEl.appendChild(stateMsg("empty","No tasks yet"));return;}
  var tbl=h("table",""),thd=h("thead","");thd.appendChild(theadRow(["ID","Name","Status","Provider","Model","Created","Error"]));tbl.appendChild(thd);
  var tbd=document.createElement("tbody");S.tasks.forEach(function(t){
    tbd.appendChild(row([h("td","mono truncate",t.id),h("td","",t.name),badgeTd(t.status),h("td","",t.provider),h("td","",t.model),h("td","",fmtSince(t.createdAt)),h("td","mono truncate",t.error||"")],function(){showTask(t.id);}));
  });tbl.appendChild(tbd);viewEl.appendChild(tbl);
}

/* --- Render: competitions --- */
function rCompetitions(){viewEl.textContent="";if(!S.hadOk){showDisconnected();return;}
  if(!S.competitions||!S.competitions.length){viewEl.appendChild(stateMsg("empty","No competitions yet"));return;}
  S.competitions.forEach(function(c){var pr=c.progress||{};
    viewEl.appendChild(card(function(){showCompetition(c.id);},[
      cardHead(c.name,c.id,badge(c.status)),
      h("div","summary-line","Candidates: "+c.candidateCount+" | Terminal: "+(pr.terminal||0)+"/"+(pr.total||0)+" | Created: "+fmtSince(c.createdAt)),
    ]));
  });
}

/* --- Render: stats --- */
function rStats(){viewEl.textContent="";if(!S.hadOk){showDisconnected();return;}
  if(!S.stats||!S.stats.length){viewEl.appendChild(stateMsg("empty","No completed tasks for statistics"));return;}
  S.stats.forEach(function(s){
    var c=card(null,[cardHead(s.provider+"/"+s.model,"",h("span","",""+s.sampleSize+" tasks"))]);
    c.appendChild(hd("div","grid-2",[
      h("div","dim","Success: "+(s.successRate*100).toFixed(0)+"% (verified: "+s.verifiedSuccessCount+")"),
      h("div","dim","Avg Retries: "+num(s.avgRetries,1)),
      h("div","dim","Avg Cost: "+num(s.avgCostUsd,3,"$")),
      h("div","dim","Avg Duration: "+num(s.avgDurationMs!==undefined?s.avgDurationMs/1000:undefined,1,"s")),
      h("div","dim","Avg First Action: "+num(s.avgTimeToFirstEffectiveActionMs!==undefined?s.avgTimeToFirstEffectiveActionMs/1000:undefined,1,"s")),
      h("div","dim","Avg Turns: "+num(s.avgTurns,1)),
    ]));
    if(s.failureDistribution&&Object.keys(s.failureDistribution).length){
      c.appendChild(hd("div","fs11 mt-4",[h("span","dim","Failures: ")].concat(Object.entries(s.failureDistribution).map(function(e){return h("span","pill-badge",e[0]+":"+e[1]);}))));
    }viewEl.appendChild(c);
  });
}

/* --- Render: settings --- */
function rSettings(){viewEl.textContent="";if(!S.hadOk){showDisconnected();return;}
  if(!S.settings){viewEl.appendChild(stateMsg("error","Settings unavailable"));return;}
  var c=card(null,[h("div","card-title","Effective Settings (read-only)")]);
  var rows=flattenSettings(S.settings,"");var g=hd("div","grid-3");
  rows.forEach(function(r){g.appendChild(h("div","dim fs11",r[0]+": "+r[1]));});
  c.appendChild(g);viewEl.appendChild(c);
  viewEl.appendChild(stateMsg("","Changes via forklight settings or MCP. No credentials displayed."));
}

/* --- Detail views --- */
function hideDetail(){detailEl.hidden=true;detailEl.textContent="";S.detail=null;}
function loadingDetail(msg){S.detail=true;detailEl.hidden=false;detailEl.textContent="";detailEl.appendChild(stateMsg("loading",msg));}
function showDetail(frag){detailEl.hidden=false;detailEl.textContent="";detailEl.appendChild(frag);S.detail=true;}
function closeBtn(){var b=h("button","detail-close","Close");b.addEventListener("click",hideDetail);return b;}

function showPlanBoard(id){
  loadingDetail("Loading plan board");
  fetchJSON("/board/"+encodeURIComponent(id)).then(function(board){
    var f=fr();f.appendChild(closeBtn());
    var pct=board.plan.progress&&board.plan.progress.percent===100?"completed":"active";
    f.appendChild(cardHead(board.plan.name,"",badge(pct)));
    f.appendChild(h("div","card-subtitle mb-8",(board.plan.objective||"")+" - Updated: "+fmtSince(board.plan.updatedAt)));
    f.appendChild(progBar(board.plan.progress));
    var cols=hd("div","columns mt-8");
    [{k:"queued",l:"Queued"},{k:"active",l:"Active"},{k:"blocked",l:"Blocked"},{k:"failed",l:"Failed"},{k:"completed",l:"Completed"}].forEach(function(col){
      var items=board.columns[col.k]||[],c=h("div","column");c.appendChild(h("h3","",col.l+" ("+items.length+")"));
      items.forEach(function(i){c.appendChild(boardItem(i));});cols.appendChild(c);
    });f.appendChild(cols);showDetail(f);
  }).catch(function(e){detailEl.replaceChildren(closeBtn(),stateMsg("error","Failed: "+e.message));});
}

function showTask(id){
  loadingDetail("Loading task detail");
  fetchJSON("/tasks/"+encodeURIComponent(id)).then(function(t){
    var f=fr();f.appendChild(closeBtn());f.appendChild(cardHead(t.name,"",badge(t.status)));
    f.appendChild(hd("div","grid-2 fs12 mb-8",[
      hd("div","",[h("span","dim","ID: "),h("span","mono",t.id)]),
      hd("div","",[h("span","dim","Provider: "),document.createTextNode(t.provider+"/"+t.model)]),
      hd("div","",[h("span","dim","Runtime: "),document.createTextNode(t.runtime)]),
      hd("div","",[h("span","dim","Source: "),h("span","mono",t.source||"")]),
      hd("div","",[h("span","dim","Created: "),document.createTextNode(fmtTm(t.createdAt))]),
      hd("div","",[h("span","dim","Started: "),document.createTextNode(fmtTm(t.startedAt))]),
      hd("div","",[h("span","dim","Finished: "),document.createTextNode(fmtTm(t.finishedAt))]),
      hd("div","",[h("span","dim","Session: "),h("span","mono truncate",t.sessionId||"")]),
    ]));
    if(t.error){var eb=h("div","error-box");eb.appendChild(h("strong","","Error: "));eb.appendChild(document.createTextNode(t.error));f.appendChild(eb);}
    if(t.timeline&&t.timeline.length){
      f.appendChild(h("div","section-title mb-4","Event Timeline ("+t.timeline.length+")"));
      var tl=h("div","timeline");t.timeline.forEach(function(e){
        var te=h("div","timeline-entry");te.appendChild(h("span","ts",fmtTm(e.timestamp)));te.appendChild(h("span","",e.type));te.appendChild(h("span","dim",e.summary));tl.appendChild(te);
      });f.appendChild(tl);
    }
    var il=h("button","back-link mt-12","Integration History");il.addEventListener("click",function(){showIntegration(t.id);});
    f.appendChild(hd("div","mt-12",[il]));showDetail(f);
  }).catch(function(e){detailEl.replaceChildren(closeBtn(),stateMsg("error","Failed: "+e.message));});
}

function showCompetition(cid){
  loadingDetail("Loading competition");
  fetchJSON("/competitions/"+encodeURIComponent(cid)).then(function(c){
    var f=fr();f.appendChild(closeBtn());var comp=c.competition||{},cands=c.candidates||[],prog=c.progress||{};
    f.appendChild(cardHead(comp.name,comp.id,badge(comp.status)));
    f.appendChild(h("div","summary-line mb-8","Progress: "+(prog.terminal||0)+"/"+(prog.total||0)+" terminal | Candidates: "+cands.length));
    if(cands.length){var tbl=h("table",""),thd=h("thead","");thd.appendChild(theadRow(["Candidate","Provider","Model","Status","Started","Finished","Error"]));tbl.appendChild(thd);
      var tbd=document.createElement("tbody");cands.forEach(function(cd){
        tbd.appendChild(row([h("td","mono truncate",cd.candidateId||""),h("td","",cd.providerName),h("td","",cd.modelName),badgeTd(cd.taskStatus),h("td","",fmtTm(cd.taskStartedAt)),h("td","",fmtTm(cd.taskFinishedAt)),h("td","truncate",cd.error||"")]));
      });tbl.appendChild(tbd);f.appendChild(tbl);}
    if(c.evaluation){var ev=c.evaluation;f.appendChild(sec("Evaluation"));
      if(ev.candidates&&ev.candidates.length){var et=h("table",""),ethd=h("thead","");ethd.appendChild(theadRow(["Candidate","Eligible numeric","Score numeric","Disqualification"]));et.appendChild(ethd);
        var etbd=document.createElement("tbody");ev.candidates.forEach(function(sc){
          etbd.appendChild(row([h("td","",sc.providerName+"/"+sc.modelName),td("numeric",sc.eligible?"Yes":"No"),td("numeric",sc.totalScore!==undefined?sc.totalScore.toFixed(3):"-"),h("td","truncate",sc.disqualificationReason||"")]));
        });et.appendChild(etbd);f.appendChild(et);}
      if(ev.recommendation)f.appendChild(h("div","fs12 mt-8","Recommendation: "+ev.recommendation.candidateId+" (confidence: "+(ev.recommendation.confidence*100).toFixed(0)+"%)"+": "+ev.recommendation.reasoning));
    }
    var back=h("button","back-link mt-12","Back");back.addEventListener("click",hideDetail);f.appendChild(hd("div","mt-12",[back]));showDetail(f);
  }).catch(function(e){detailEl.replaceChildren(closeBtn(),stateMsg("error","Failed: "+e.message));});
}

function showIntegration(taskId){
  loadingDetail("Loading integration history");
  fetchJSON("/integration/"+encodeURIComponent(taskId)+"/history").then(function(h){
    var f=fr();f.appendChild(closeBtn());f.appendChild(h("div","card-title mb-8","Integration History"));
    f.appendChild(sec("Receipts ("+((h.receipts||[]).length)+")"));
    if(h.receipts&&h.receipts.length){var rtb=h("table",""),rthd=h("thead","");rthd.appendChild(theadRow(["Receipt ID","Digest","Files","Created"]));rtb.appendChild(rthd);
      var rtbd=document.createElement("tbody");h.receipts.forEach(function(r){rtbd.appendChild(row([h("td","mono truncate",r.id),h("td","mono truncate",r.patchDigest||""),h("td","truncate",(r.affectedFiles||[]).join(", ")),h("td","",fmtSince(r.createdAt))]));});rtb.appendChild(rtbd);f.appendChild(rtb);
    }else{f.appendChild(stateMsg("empty","No receipts"));}
    f.appendChild(sec("Results ("+((h.results||[]).length)+")"));
    if(h.results&&h.results.length){var stb=h("table",""),sthd=h("thead","");sthd.appendChild(theadRow(["Status","Receipt","Applied","Error"]));stb.appendChild(sthd);
      var stbd=document.createElement("tbody");h.results.forEach(function(r){stbd.appendChild(row([badgeTd(r.status),h("td","mono truncate",r.receiptId||""),h("td","",fmtTm(r.appliedAt)),h("td","truncate",r.error||"")]));});stb.appendChild(stbd);f.appendChild(stb);
    }else{f.appendChild(stateMsg("empty","No results"));}
    showDetail(f);
  }).catch(function(e){detailEl.replaceChildren(closeBtn(),stateMsg("error","Failed: "+e.message));});
}

/* --- Render dispatcher --- */
function render(){updStatus();
  switch(S.tab){
    case"overview":rOverview();break;case"plans":rPlans();break;case"tasks":rTasks();break;
    case"competitions":rCompetitions();break;case"stats":rStats();break;case"settings":rSettings();break;
  }
  if(!S.detail){detailEl.hidden=true;detailEl.textContent="";}
}

/* --- Init --- */
function init(){
  viewEl=document.getElementById("fl-view");detailEl=document.getElementById("fl-detail");statusEl=document.getElementById("fl-status-bar");footerEl=document.getElementById("fl-footer");
  $$("#fl-tabs button").forEach(function(btn){btn.addEventListener("click",function(){
    $$("#fl-tabs button").forEach(function(b){b.classList.remove("active");});btn.classList.add("active");
    S.tab=btn.getAttribute("data-tab");hideDetail();render();
  });});
  startPoll();
}
document.addEventListener("DOMContentLoaded",init);
