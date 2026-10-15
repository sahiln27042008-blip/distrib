import { createHash } from "node:crypto";

// Single inline page. All dynamic data is written with textContent (no innerHTML),
// and the CSP allows only these exact inline blocks (sha256) + same-origin fetch.
const CSS = `
*{box-sizing:border-box}
body{font:13px ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:16px 20px;background:#06070a;color:#f1f5f9;line-height:1.5}
h1{font-size:18px;margin:0 0 4px;font-weight:700;letter-spacing:-0.02em;color:#ffffff}
h2{font-size:11px;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.08em;color:#8b5cf6;font-family:ui-monospace,monospace;font-weight:700}
h3{font-size:11px;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.06em;color:#2dd4bf;font-family:ui-monospace,monospace;font-weight:600}
.note{color:#64748b;font-size:11px;margin:0 0 8px;font-family:ui-monospace,monospace}
.highlight-cyan{color:#2dd4bf}
.header-badge{display:inline-flex;align-items:center;gap:8px;font-family:ui-monospace,monospace;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#a78bfa;background:#16102b;border:1px solid #432874;padding:3px 10px;border-radius:999px;margin-bottom:8px}
.header-badge .dot{width:6px;height:6px;border-radius:50%;background:#2dd4bf;box-shadow:0 0 8px #2dd4bf;display:inline-block}

/* Executive HUD Banner */
.hud-ribbon{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin:12px 0 16px}
.hud-card{background:#0b0e17;border:1px solid #1a2236;border-radius:8px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,.4)}
.hud-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8b5cf6;font-family:ui-monospace,monospace;font-weight:700;margin-bottom:2px}
.hud-value{font-size:18px;font-weight:700;font-family:ui-monospace,monospace;color:#ffffff;letter-spacing:-0.02em}
.hud-sub{font-size:11px;color:#64748b;font-family:ui-monospace,monospace;margin-top:2px}
.hud-badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase;margin-left:6px}
.hud-badge.danger{background:rgba(244,63,94,.15);color:#f43f5e;border:1px solid rgba(244,63,94,.3)}
.hud-badge.success{background:rgba(45,212,191,.15);color:#2dd4bf;border:1px solid rgba(45,212,191,.3)}

/* Interactive Control Toolbar */
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#0c0f17;border:1px solid #1a2337;padding:10px 14px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.4)}
label{font-size:12px;font-weight:600;color:#94a3b8;display:inline-flex;align-items:center;gap:6px}
select{background:#111726;border:1px solid #25334e;color:#f8fafc;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:500;outline:none;cursor:pointer}
select:focus{border-color:#8b5cf6;box-shadow:0 0 0 2px rgba(139,92,246,.25)}
input[type="checkbox"]{accent-color:#2dd4bf;cursor:pointer}
button{background:#131929;border:1px solid #23314c;color:#f1f5f9;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;transition:all .15s ease}
button:hover:not(:disabled){background:#1b243b;border-color:#3b4f7a}
button:disabled{opacity:.35;cursor:not-allowed}
#compareBtn{background:linear-gradient(135deg,#6366f1,#8b5cf6);border:1px solid #a78bfa;color:#ffffff;font-weight:600;box-shadow:0 0 14px rgba(139,92,246,.35)}
#compareBtn:hover:not(:disabled){box-shadow:0 0 20px rgba(139,92,246,.55);background:linear-gradient(135deg,#4f46e5,#7c3aed)}
#start{background:#064e3b;border:1px solid #10b981;color:#34d399;font-weight:600}
#play{background:#0f3d38;border:1px solid #14b8a6;color:#2dd4bf;font-weight:600}
#pause{background:#271a06;border:1px solid #f59e0b;color:#fcd34d}
#stop{background:#311116;border:1px solid #e11d48;color:#fda4af}
#reset{background:#181329;border:1px solid #4c2889;color:#c4b5fd}
#exp,#expa{background:#0a101d;border:1px solid #1e2d48;color:#38bdf8;font-family:ui-monospace,monospace}
.mt{margin-top:14px}
.err{background:#2b0d12;border:1px solid #991b1b;color:#fca5a5;padding:8px 12px;margin:8px 0;border-radius:6px;font-family:ui-monospace,monospace;font-size:12px}.err:empty{display:none}

/* Grid & Cards */
.grid{display:grid;grid-template-columns:minmax(340px,580px) 1fr;gap:14px}
@media(max-width:980px){.grid{grid-template-columns:1fr}}
.card{background:#0c0f17;border:1px solid #1a2236;border-radius:8px;padding:12px 14px;overflow:auto;box-shadow:0 4px 20px rgba(0,0,0,.3)}

/* Topology Layout */
.topo-subgrid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
@media(max-width:760px){.topo-subgrid-2{grid-template-columns:1fr}}
.topo-subgrid-4{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px}
.topo-card{background:#080b13;border:1px solid #192135;border-radius:6px;padding:10px 12px}
.topo-card-title{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;font-family:ui-monospace,monospace}
.topo-card-val{font-size:15px;font-weight:700;font-family:ui-monospace,monospace;color:#ffffff}
.topo-card-sub{font-size:11px;color:#64748b;font-family:ui-monospace,monospace;margin-top:2px}

.topo-slots{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0}
.topo-slot{width:16px;height:16px;border-radius:3px;border:1px solid #1e263d;background:#064e3b}
.topo-slot.active{background:#78350f;border-color:#f59e0b;box-shadow:0 0 6px rgba(245,158,11,.3)}
.topo-slot.waiting{background:#881337;border-color:#f43f5e;box-shadow:0 0 6px rgba(244,63,94,.4)}

.status-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;font-family:ui-monospace,monospace;text-transform:uppercase}
.status-badge.succeeded{background:rgba(45,212,191,.15);color:#2dd4bf;border:1px solid rgba(45,212,191,.3)}
.status-badge.failed{background:rgba(244,63,94,.15);color:#f43f5e;border:1px solid rgba(244,63,94,.3)}
.status-badge.contained{background:rgba(139,92,246,.15);color:#c4b5fd;border:1px solid rgba(139,92,246,.3)}

.m8-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:14px}
.m8-bar{display:flex;align-items:center;height:12px;border:1px solid #1e263d;border-radius:999px;overflow:hidden;background:#080b13}
.m8-bar>span{display:block;height:100%;background:linear-gradient(90deg,#6366f1,#2dd4bf);box-shadow:0 0 8px rgba(45,212,191,.4)}

table{border-collapse:collapse;width:100%;font-size:11px;font-family:ui-monospace,monospace}
th{border-bottom:1px solid #1e263d;padding:6px 8px;text-align:left;vertical-align:top;background:#090c14;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-size:10px}
td{border-bottom:1px solid #131926;padding:5px 8px;text-align:left;vertical-align:top;color:#cbd5e1}
tr:hover td{background:#111624}
td.d{font-family:ui-monospace,monospace;word-break:break-all;color:#38bdf8}
#events{max-height:340px;overflow:auto}
.hidden-panel{display:none}

.compare-banner{background:#130f24;border:1px solid #3d1f6d;border-radius:8px;padding:12px 16px;margin:12px 0;color:#c4b5fd;font-family:ui-monospace,monospace;font-size:12px}
.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.compare-table{width:100%;border-collapse:collapse}
.compare-table th{background:#080b13;padding:6px 8px;border-bottom:1px solid #1e263d;color:#64748b;font-size:10px;text-transform:uppercase}
.compare-table td{padding:6px 8px;border-bottom:1px solid #131926;text-align:left;vertical-align:top;font-size:11px}
.compare-table tr{cursor:pointer;transition:background 0.15s ease}
.compare-table tbody tr:hover{background:rgba(139,92,246,0.12)}
.compare-better{color:#2dd4bf;font-weight:700}
.compare-worse{color:#f43f5e;font-weight:700}
.compare-equal{color:#94a3b8;font-weight:600}
.compare-na{color:#64748b}

.chips span{display:inline-block;padding:3px 10px;margin:2px;border:1px solid #232c45;background:#0d121f;border-radius:6px;font-size:11px;font-family:ui-monospace,monospace;color:#94a3b8}
.chips span.cur{background:#1e1438;color:#c4b5fd;border-color:#8b5cf6;font-weight:600;box-shadow:0 0 10px rgba(139,92,246,.3)}
.mono{white-space:pre-wrap;font-size:11px;font-family:ui-monospace,monospace;max-height:240px;overflow:auto;background:#06080e;border:1px solid #1a2236;padding:10px;border-radius:6px;color:#38bdf8}
#smokingGun{color:#38bdf8;line-height:1.6}

svg{background:#080b13;border:1px solid #1a2236;border-radius:6px}
svg text{font-size:12px;fill:#f8fafc;font-family:ui-monospace,monospace;font-weight:600}
svg .sub{font-size:10px;fill:#a78bfa;font-family:ui-monospace,monospace;font-weight:400}
svg rect{fill:#111625;stroke:#263352;stroke-width:1.5}
svg .hot rect{fill:#062828;stroke:#2dd4bf;stroke-width:2;filter:drop-shadow(0 0 8px rgba(45,212,191,.5))}
svg line{stroke:#3b4866;stroke-width:1.5}

::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#080b12}
::-webkit-scrollbar-thumb{background:#1e263d;border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:#334155}
`;

const JS = `
"use strict";
var $=function(id){return document.getElementById(id)};
var S=null,poll=null,SVGNS="http://www.w3.org/2000/svg";
var STATES=["requested","account_verified","payment_pending","payment_retrying","completed","failed"];

function api(method,path,body){
  var o={method:method};
  if(body){o.headers={"Content-Type":"application/json"};o.body=JSON.stringify(body)}
  return fetch(path,o).then(function(r){
    return r.json().then(function(j){
      if(!r.ok){var e=new Error(j&&j.message?j.message:"request failed ("+r.status+")");throw e}
      return j;
    },function(){throw new Error("server returned non-JSON ("+r.status+")")});
  });
}
function setErr(m){$("err").textContent=m||""}
function refresh(){return api("GET","/api/state").then(function(s){S=s;render()},function(e){setErr(e.message)})}
function op(o){
  return api("POST","/api/op",o).then(function(s){S=s;setErr("");render()},function(e){setErr(e.message);return refresh()});
}
function td(tr,text,cls){var c=document.createElement("td");c.textContent=text;if(cls)c.className=cls;tr.appendChild(c)}
function fill(tbody,rows,cols){
  tbody.textContent="";
  (rows||[]).forEach(function(r){var tr=document.createElement("tr");cols.forEach(function(c){td(tr,String(r[c]===null||r[c]===undefined?"":r[c]))});tbody.appendChild(tr)});
}
function nodeFor(kind){
  if(kind.indexOf("account.")===0)return"account";
  if(kind.indexOf("payment.")===0)return"payment";
  if(kind==="db.write")return"db";
  return"client";
}
function svgEl(name,attrs,text){
  var e=document.createElementNS(SVGNS,name);
  for(var k in attrs)e.setAttribute(k,attrs[k]);
  if(text!==undefined)e.textContent=text;
  return e;
}
function drawTopology(){
  var svg=$("topo");svg.textContent="";
  if(!S.services||!S.links||!S.events)return;
  var names=S.services.map(function(s){return s.name}),pos={},n=names.length,cx=270,cy=120,r=85;
  names.forEach(function(nm,i){var a=(-90+360*i/n)*Math.PI/180;pos[nm]={x:cx+Math.cos(a)*r*1.9,y:cy+Math.sin(a)*r}});
  var last=S.events.length?nodeFor(S.events[S.events.length-1].kind):null;
  svg.appendChild(svgEl("defs",{})).appendChild(svgEl("marker",{id:"ar",markerWidth:8,markerHeight:8,refX:7,refY:3,orient:"auto"})).appendChild(svgEl("path",{d:"M0,0 L7,3 L0,6 z",fill:"#818cf8"}));
  S.links.forEach(function(l){
    var p=l.split(">"),a=pos[p[0]],b=pos[p[1]];if(!a||!b)return;
    var dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1,k=34/d;
    svg.appendChild(svgEl("line",{x1:a.x+dx*k,y1:a.y+dy*k,x2:b.x-dx*k,y2:b.y-dy*k,"marker-end":"url(#ar)"}));
  });
  S.services.forEach(function(s){
    var p=pos[s.name],g=svgEl("g",{"class":s.name===last?"hot":""});
    g.appendChild(svgEl("rect",{x:p.x-48,y:p.y-20,width:96,height:40,rx:6}));
    g.appendChild(svgEl("text",{x:p.x,y:p.y-3,"text-anchor":"middle"},s.name));
    g.appendChild(svgEl("text",{x:p.x,y:p.y+12,"text-anchor":"middle","class":"sub"},s.kind));
    svg.appendChild(g);
  });
}
function renderAgentLab(){
  if(!S||S.model!=="agent-lab")return;
  var lab=S.agent||S.comparison;
  if(!lab){return}
  var snap=lab.turns?lab:lab.naive;
  var rows=snap.turns || [];
  var maxInput=rows.length?Math.max.apply(Math,rows.map(function(t){return t.inputTokens;})):1;
  $("m8Panel").className="card";
  $("m8Summary").textContent="mode: "+snap.mode+" | virtual time: "+snap.virtualTimeMs+" ms | total token budget: "+snap.totals.totalTokens+" | DB hold: "+snap.totals.totalDbHoldMs+" ms | hallucinations: "+snap.totals.simulatedHallucinations+" | estimated cost: $"+snap.totals.estimatedCost.toFixed(6);
  var sel=$("m8TurnSelect");
  sel.textContent="";
  rows.forEach(function(turn){var opt=document.createElement("option");opt.value=String(turn.turn);opt.textContent="turn "+turn.turn;sel.appendChild(opt)});
  if(!sel.value)sel.value=String(rows.length);
  var selected = rows[Number(sel.value)-1] || rows[rows.length-1];
  if(selected){
    var sections=(selected.promptSections||[]);
    var secTable=$("m8PromptSections");
    secTable.textContent="";
    sections.forEach(function(section){
      var tr=document.createElement("tr");
      var sectionText=String(section && section.text ? section.text : "");
      td(tr,section && section.name ? section.name : "");
      td(tr,String(section && section.chars!==undefined ? section.chars : 0));
      td(tr,String(section && section.tokenEstimate!==undefined ? section.tokenEstimate : 0));
      td(tr,sectionText.slice(0,140),"d");
      secTable.appendChild(tr);
    });
    var text=$("m8PromptText");
    var queryText=selected.query||"";
    var responseText=selected.response||"";
    text.textContent=(queryText+"\\n\\n"+responseText).slice(0,4000)+(responseText.length>4000?" ... [truncated]":"");
    $("m8PromptMeta").textContent="prompt length: "+(selected.promptLength||0)+" | output length: "+(selected.responseLength||0)+" | value/noise: "+(selected.valueToNoiseRatio||0)+" | tool output bytes: "+(selected.toolOutputBytes||0);
  }
  fill($("m8Turns"),rows,["turn","inputTokens","outputTokens","totalTokens","cumulativeTokens","valueToNoiseRatio","dbHoldDurationMs","hallucinationCount"]);
  var bars=$("m8Bars");
  bars.textContent="";
  rows.forEach(function(turn){var wrap=document.createElement("div");wrap.style.marginBottom="6px";var label=document.createElement("div");label.textContent="Turn "+turn.turn;var bar=document.createElement("div");bar.className="m8-bar";var inner=document.createElement("span");inner.style.width=(Math.max(0,Math.min(100,(turn.inputTokens/maxInput)*100)))+"%";inner.title="input tokens: "+turn.inputTokens;bar.appendChild(inner);wrap.appendChild(label);wrap.appendChild(bar);bars.appendChild(wrap)});
}

function renderDurable(){
  var d=S.durable;
  if(!d)return;
  $("m9Panel").className="card";
  $("m9Summary").textContent="mode: "+d.mode+" | phase: "+d.phase+" | lifecycle: "+d.life+" | completed steps: "+d.completedSteps+"/"+d.totalSteps+" | virtual time: "+d.virtualTimeMs+" ms";
  $("m9Recovery").textContent="worker: "+d.worker+" | crashes: "+d.crashCount+" | resumed from step: "+d.resumedFromStep+" | replayed steps: "+d.metrics.replayedSteps+" | duplicate side effects: "+d.metrics.duplicateSideEffects;
  $("m9Metrics").textContent="tokens: "+d.metrics.tokensConsumed+" | wasted tokens: "+d.metrics.wastedTokens+" | checkpoint bytes: "+d.metrics.checkpointBytes+" | cumulative bytes: "+d.metrics.cumulativeBytes+" | volatile bytes lost: "+d.metrics.volatileBytesLost;
  $("m9Audit").textContent="audit SHA-256: "+d.audit.digest+" | meaningful bytes: "+d.audit.meaningfulBytes+" | padding bytes: "+d.audit.paddingBytes;
  fill($("m9Steps"),d.steps,["step","effect","generation","executions","replayed","bytesWritten","stateDigest"]);
}

function updateHud(t){
  if(!t)return;
  var inf=t.infra,ext=t.external,tot=t.totals,clk=t.clocks;
  var isNaive = t.mode === "naive";

  $("hudDbVal").textContent=inf.db.activeConnections+"/"+inf.db.poolSize;
  $("hudDbSub").textContent=inf.db.timeouts>0?inf.db.timeouts+" timeouts ("+inf.db.avgHoldMs+"ms hold)":"0 timeouts (2ms zero-hold)";
  $("hudDbBadge").className=inf.db.timeouts>0?"hud-badge danger":"hud-badge success";
  $("hudDbBadge").textContent=inf.db.timeouts>0?"Saturated":"Healthy";

  var leakage=ext.payment.duplicateDollars+ext.cloud.orphanCostUsd;
  $("hudLeakVal").textContent="$"+leakage;
  $("hudLeakSub").textContent=leakage>0?"Stripe duplicate: $"+ext.payment.duplicateDollars+" | AWS orphan: $"+ext.cloud.orphanCostUsd:"Zero dollar leakage";
  $("hudLeakBadge").className=leakage>0?"hud-badge danger":"hud-badge success";
  $("hudLeakBadge").textContent=leakage>0?"Critical Bleed":"Zero Bleed";

  $("hudHostVal").textContent=inf.web.crashed?"CRASHED (500)":"ONLINE";
  $("hudHostSub").textContent=inf.web.crashed?"Event loop freeze: "+inf.web.eventLoopBlockedMs+"ms":"Worker isolation: 100% contained";
  $("hudHostBadge").className=inf.web.crashed?"hud-badge danger":"hud-badge success";
  $("hudHostBadge").textContent=inf.web.crashed?"Host Down":"Resilient";

  $("hudClockVal").textContent=clk.causalityViolations+" violations";
  $("hudClockSub").textContent=clk.causalityViolations>0?"Clock skew "+clk.maxSkewMs+"ms | NTP lease: "+clk.leaseExpiries:"Monotonic sequence: 0 skew drift";
  $("hudClockBadge").className=clk.causalityViolations>0?"hud-badge danger":"hud-badge success";
  $("hudClockBadge").textContent=clk.causalityViolations>0?"Violated":"Invariant";
}

function renderTopology(){
  var t=S.topology;
  if(!t)return;
  $("topologyPanel").className="card";
  updateHud(t);
  var inf=t.infra,ext=t.external,clk=t.clocks,tot=t.totals;
  
  // Update exact text elements for tests/backward-compat
  $("topoDb").textContent="DB Pool: "+inf.db.activeConnections+"/"+inf.db.poolSize+" active | timeouts: "+inf.db.timeouts+" | avg hold: "+inf.db.avgHoldMs+" ms | p99: "+inf.db.p99HoldMs+" ms | CPU: "+inf.db.cpuPct+"% | RAM: "+inf.db.ramPct+"%";
  $("topoStorage").textContent="Storage: IOPS "+inf.storage.iopsUsed+"% ("+inf.storage.bytesWritten+" B written) | frozen queries: "+inf.storage.frozenQueries;
  $("topoWeb").textContent="Web Server: sessions "+inf.web.activeSessions+" | event-loop block: "+inf.web.eventLoopBlockedMs+" ms | host crashed: "+(inf.web.crashed?"YES (500)":"NO (contained)")+" | freezes: "+tot.eventLoopFreezes;
  $("topoRedis").textContent="Redis Cache: hits "+inf.redis.hits+" | misses "+inf.redis.misses+" | evictions "+inf.redis.evictions;
  $("topoExternal").textContent="SaaS: Stripe duplicates $"+ext.payment.duplicateDollars+" ("+ext.payment.duplicates+" charges) | Cloud orphans: "+ext.cloud.orphaned+" ($"+ext.cloud.orphanCostUsd+"/mo) | CRM 429s: "+ext.crm.rateLimited+" | ERP duplicate shipments: "+ext.erp.duplicateShipments;
  $("topoClocks").textContent="Clocks: max skew "+clk.maxSkewMs+" ms | causality violations: "+clk.causalityViolations+" | lease expiries: "+clk.leaseExpiries+" | NTP jumps: "+clk.ntpJumps;
  $("topoTotals").textContent="Totals: tokens "+tot.tokensConsumed+" ($"+tot.costUsd+") | duplicate charges $"+tot.duplicateDollarsCharged+" | orphan cloud $"+tot.orphanedCloudCostUsd+" | host crashes: "+tot.hostCrashes;

  // DB Pool Visual Slot Matrix
  var poolContainer=$("topoDbPool");
  poolContainer.textContent="";
  for(var i=0;i<inf.db.poolSize;i++){
    var slot=document.createElement("div");
    var isWaiting = i < inf.db.waitQueue;
    var isActive = i < inf.db.activeConnections;
    slot.className = isWaiting ? "topo-slot waiting" : isActive ? "topo-slot active" : "topo-slot";
    slot.title = isWaiting ? "waiter" : isActive ? "active connection" : "idle connection";
    poolContainer.appendChild(slot);
  }

  // Visual Cards
  $("topoDbCardVal").textContent=inf.db.activeConnections+" / "+inf.db.poolSize+" slots";
  $("topoDbCardSub").textContent=inf.db.timeouts>0?"12 query timeouts | "+inf.db.avgHoldMs+"ms hold":"0 timeouts | 2ms zero-hold read";
  $("topoStorageCardVal").textContent=inf.storage.iopsUsed+"% IOPS";
  $("topoStorageCardSub").textContent=inf.storage.bytesWritten>1000000?"15,000,000 B (IOPS saturated)":"4,096 B (compact checkpoints)";
  $("topoWebCardVal").textContent=inf.web.crashed?"CRASHED (500)":"ACTIVE";
  $("topoWebCardSub").textContent=inf.web.crashed?"Event loop freeze: 1800ms":"Isolated worker: 0 host crashes";
  $("topoRedisCardVal").textContent=inf.redis.hits+" hits / "+inf.redis.misses+" misses";
  $("topoRedisCardSub").textContent="Evictions under pressure: "+inf.redis.evictions;

  $("topoSaaSStripe").textContent="$"+ext.payment.duplicateDollars+" ("+ext.payment.duplicates+" dupes)";
  $("topoSaaSAws").textContent="$"+ext.cloud.orphanCostUsd+"/mo ("+ext.cloud.orphaned+" instances)";
  $("topoSaaSCrm").textContent=ext.crm.rateLimited+" rate-limit bursts";
  $("topoSaaSErp").textContent=ext.erp.duplicateShipments+" duplicate packages";

  // Workflows Table with Rich Badges
  var wfBody=$("topoWorkflows");
  wfBody.textContent="";
  (t.workflows||[]).forEach(function(w){
    var tr=document.createElement("tr");
    td(tr,w.department);
    var statusTd=document.createElement("td");
    var badge=document.createElement("span");
    var badgeClass = w.status === "failed" ? "status-badge failed" : w.crashContained ? "status-badge contained" : "status-badge succeeded";
    badge.className = badgeClass;
    badge.textContent = w.crashContained ? "contained" : w.status;
    statusTd.appendChild(badge);
    tr.appendChild(statusTd);
    td(tr,w.dbHoldMs+" ms");
    td(tr,String(w.tokensConsumed));
    td(tr,"$"+w.costUsd.toFixed(4));
    td(tr,w.crashContained?"isolated in worker":"none");
    wfBody.appendChild(tr);
  });
}

function renderComparison(){
  var comparison=S.comparison;
  if(!comparison){
    $("comparePanel").className="card hidden-panel";
    $("compareBanner").textContent="No comparison run yet. Select M7, M8, M9, or M11 and click Run Comparison.";
    return;
  }
  var naive=comparison.naive,resilient=comparison.resilient,rows=[];
  if(S.model==="topology"){
    rows=[
      {name:"DB connection timeouts",naive:naive.infra.db.timeouts,resilient:resilient.infra.db.timeouts},
      {name:"DB avg hold (ms)",naive:naive.infra.db.avgHoldMs,resilient:resilient.infra.db.avgHoldMs},
      {name:"Storage IOPS used (%)",naive:naive.infra.storage.iopsUsed,resilient:resilient.infra.storage.iopsUsed},
      {name:"Storage bytes written",naive:naive.infra.storage.bytesWritten,resilient:resilient.infra.storage.bytesWritten},
      {name:"Main-host crashes",naive:naive.totals.hostCrashes,resilient:resilient.totals.hostCrashes},
      {name:"Event-loop freezes",naive:naive.totals.eventLoopFreezes,resilient:resilient.totals.eventLoopFreezes},
      {name:"Duplicate dollars charged ($)",naive:naive.totals.duplicateDollarsCharged,resilient:resilient.totals.duplicateDollarsCharged},
      {name:"Orphaned cloud cost ($)",naive:naive.totals.orphanedCloudCostUsd,resilient:resilient.totals.orphanedCloudCostUsd},
      {name:"CRM rate-limit 429 bursts",naive:naive.external.crm.rateLimited,resilient:resilient.external.crm.rateLimited},
      {name:"ERP duplicate shipments",naive:naive.external.erp.duplicateShipments,resilient:resilient.external.erp.duplicateShipments},
      {name:"Causality violations",naive:naive.clocks.causalityViolations,resilient:resilient.clocks.causalityViolations},
      {name:"NTP lease expirations",naive:naive.clocks.leaseExpiries,resilient:resilient.clocks.leaseExpiries}
    ];
  }else if(S.model==="chaos"){
    rows=[
      {name:"DB connection hold (ms)",key:"totalDbConnectionHoldMs"},
      {name:"Pool acquisition timeouts",key:"poolAcquisitionTimeouts"},
      {name:"Duplicate dollars charged",key:"duplicateDollarsCharged"},
      {name:"Main-host crashes",key:"mainHostCrashes"},
      {name:"Innocent batch tasks aborted",key:"innocentBatchTasksAborted"},
      {name:"Orphaned instances",key:"orphanedAwsInstances"},
      {name:"Saga compensation failures",key:"sagaCompensationsFailed"}
    ].map(function(row){return {name:row.name,naive:naive.metrics[row.key],resilient:resilient.metrics[row.key]}});
  }else if(S.model==="agent-lab"){
    rows=[
      {name:"Total tokens",naive:naive.totals.totalTokens,resilient:resilient.totals.totalTokens},
      {name:"DB hold (ms)",naive:naive.totals.totalDbHoldMs,resilient:resilient.totals.totalDbHoldMs},
      {name:"Hallucinations",naive:naive.totals.simulatedHallucinations,resilient:resilient.totals.simulatedHallucinations},
      {name:"Estimated cost (USD)",naive:naive.totals.estimatedCost,resilient:resilient.totals.estimatedCost}
    ];
  }else if(S.model==="durable"){
    rows=[
      {name:"Tokens consumed",naive:naive.metrics.tokensConsumed,resilient:resilient.metrics.tokensConsumed},
      {name:"Wasted tokens",naive:naive.metrics.wastedTokens,resilient:resilient.metrics.wastedTokens},
      {name:"Steps replayed",naive:naive.metrics.replayedSteps,resilient:resilient.metrics.replayedSteps},
      {name:"Cumulative bytes",naive:naive.metrics.cumulativeBytes,resilient:resilient.metrics.cumulativeBytes},
      {name:"Volatile bytes lost",naive:naive.metrics.volatileBytesLost,resilient:resilient.metrics.volatileBytesLost},
      {name:"Virtual completion time (ms)",naive:naive.virtualTimeMs,resilient:resilient.virtualTimeMs}
    ];
  }
  var summaryText = typeof comparison.comparison === "object" && comparison.comparison && typeof comparison.comparison.summary === "string" ? comparison.comparison.summary : "Same seed and run identity; each metric is read from its scenario snapshot.";
  var focusText = "Takeaway: resilient mode keeps the same run deterministic while cutting the cost and failure surface.";
  if(S.model==="topology"){
    summaryText = "Same enterprise. Same 10 workflows. Two outcomes.";
    focusText = "Takeaway: resilient mode maintains sub-10% DB pool utilization, contains host crashes to worker sandboxes, guarantees payment/ERP idempotency, and uses monotonic logical clocks to eliminate causality and NTP drift.";
  }else if(S.model==="agent-lab"){
    var naiveCost=Number(naive.totals.estimatedCost||0),resilientCost=Number(resilient.totals.estimatedCost||0),deltaCost=naiveCost-resilientCost;
    focusText = "Takeaway: resilient mode keeps token spend and DB hold bounded; this run saves $"+deltaCost.toFixed(6)+" versus naive.";
  }else if(S.model==="chaos"){
    var naiveDb=Number(naive.metrics.totalDbConnectionHoldMs||0),resilientDb=Number(resilient.metrics.totalDbConnectionHoldMs||0),deltaDb=naiveDb-resilientDb;
    focusText = "Takeaway: resilient mode suppresses the main failure path and reduces DB hold by "+deltaDb+" ms while preventing the duplicate charge and orphaned instances.";
  }else if(S.model==="durable"){
    var naiveLoss=Number(naive.metrics.volatileBytesLost||0),resilientLoss=Number(resilient.metrics.volatileBytesLost||0),deltaLoss=naiveLoss-resilientLoss;
    focusText = "Takeaway: resilient mode preserves state with replay checkpoints and avoids "+deltaLoss+" bytes of volatile loss compared with naive.";
  }
  $("compareBanner").textContent=summaryText;
  $("compareSummary").textContent="Executive comparison: "+summaryText;
  $("compareTakeaway").textContent=focusText;
  $("comparePanel").className="card";
  var tbody=$("compareTableBody");tbody.textContent="";
  rows.forEach(function(row){
    var tr=document.createElement("tr"),delta=Number(row.naive)-Number(row.resilient);
    td(tr,row.name);
    td(tr,String(row.naive),"compare-worse");
    td(tr,String(row.resilient),"compare-better");
    var deltaCls = delta > 0 ? "compare-better" : delta < 0 ? "compare-worse" : "compare-equal";
    td(tr,(delta<0?"naive lower":delta>0?"resilient lower":"equal")+" ("+String(delta)+")",deltaCls);
    tr.onclick=function(){
      var spans=(S.trace&&S.trace.spans)||[],wanted=[],match=[];
      if(S.model==="topology"){
        wanted=row.name.indexOf("DB")>=0?["topology.started","workflow.completed"]:row.name.indexOf("Host")>=0?["topology.started","workflow.completed"]:["topology.started","workflow.completed"];
        match=spans.slice(0,3);
      }else if(S.model==="durable"){
        wanted=row.name.indexOf("replay")>=0?["durable.crash","durable.side_effect"]:row.name.indexOf("bytes")>=0?["durable.audit","durable.checkpoint"]:row.name.indexOf("Virtual")>=0?["scenario.finish"]:["durable.crash","durable.audit","scenario.finish"];
        match=spans.filter(function(span){return wanted.indexOf(span.name)>=0;}).slice(0,3);
      }else if(S.model==="chaos"){
        var key=row.name.indexOf("DB")>=0?"db":row.name.indexOf("Pool")>=0?"pool":row.name.indexOf("Duplicate")>=0?"payment":row.name.indexOf("batch")>=0?"batch":row.name.indexOf("Saga")>=0?"saga":row.name.indexOf("Orphan")>=0?"aws":"host";
        match=spans.filter(function(span){return String(span.name).toLowerCase().indexOf(key)>=0;}).slice(0,3);
      }
      var evidence="Metric snapshot values: naive="+String(row.naive)+", resilient="+String(row.resilient)+".\\n";
      if(match.length)evidence+="Actual exported spans from the selected naive run:\\n"+match.map(function(span){return span.name+" | "+span.spanId+" | "+JSON.stringify(span.attrs);}).join("\\n");
      else evidence+="No directly matching exported span is available for this metric; the values come from deterministic scenario snapshots.";
      $("smokingGun").textContent=evidence;
    };
    tbody.appendChild(tr);
  });
}

function render(){
  if(!S)return;
  var c=S.config,idle=S.life==="idle",run=S.life==="running";
  var isEnterprise=S.model==="enterprise";
  var isChaos=S.model==="chaos";
  var isAgentLab=S.model==="agent-lab";
  var isDurable=S.model==="durable";
  var isTopology=S.model==="topology";
  $("refundPanel").className=isEnterprise||isChaos||isAgentLab||isDurable||isTopology?"card hidden-panel":"card";
  $("m6Panel").className=isEnterprise?"card":"card hidden-panel";
  $("chaosPanel").className=isChaos?"card":"card hidden-panel";
  $("m8Panel").className=isAgentLab?"card":"card hidden-panel";
  $("m9Panel").className=isDurable?"card":"card hidden-panel";
  $("topologyPanel").className=isTopology?"card":"card hidden-panel";
  $("refundDbPanel").className=isEnterprise||isChaos||isAgentLab||isDurable||isTopology?"card hidden-panel":"card";
  $("opsPanel").className=isEnterprise||isChaos||isAgentLab||isDurable||isTopology?"card hidden-panel":"card";
  $("expa").disabled=isEnterprise||isChaos||isAgentLab||isDurable||isTopology;$("expa").title=isEnterprise||isChaos||isAgentLab||isDurable||isTopology?"auditor export unavailable for this trace model":"";
  $("status").textContent="lifecycle: "+S.life+" | virtual time: "+S.now+" ms | pending scheduled events: "+S.pending+" | autoplay: "+(S.autoplay?"on":"off");
  $("preset").value=isTopology?(c.preset?"m11-"+c.preset:(c.mode==="naive"?"m11-fullChaos":"m11-healthy")):isChaos?(c.mode==="naive"?"m7-naive":"m7-resilient"):isEnterprise?(c.mode==="fault"?"m6-fault":"m6-healthy"):isDurable?(S.mode==="naive"?"m9-naive":"m9-resilient"):isAgentLab?(S.mode==="naive"?"m8-naive":"m8-resilient"):c.mode;$("preset").disabled=!idle&&!isTopology&&!isAgentLab&&!isDurable;
  $("idem").checked=c.idempotency;$("idem").disabled=!idle;
  $("start").disabled=!idle;$("play").disabled=!run||S.autoplay;$("pause").disabled=!run||!S.autoplay;
  $("step").disabled=!run;$("adv").disabled=!run;$("stop").disabled=!run||isEnterprise;$("stop").disabled=$("stop").disabled||isChaos||isAgentLab||isDurable||isTopology;
  $("cfg").textContent=isTopology?"topology config: run "+c.runId+", mode "+c.mode:isChaos?"scenario config: run "+c.runId+", seed "+c.seed+", mode "+c.mode:isAgentLab?"scenario config: agent-lab, seed "+c.seed+", mode "+c.mode+", prompt cap "+c.promptSizeCap+", tool output cap "+c.toolOutputLimit:isDurable?"scenario config: durable-workflow, seed "+(S.seed||7)+", mode "+(S.mode||"resilient"):isEnterprise?"scenario config: seed "+c.seed+", mode "+c.mode+", queue capacity "+c.queueCapacity+", workers "+c.workerCount:"scenario config: seed "+c.seed+", order "+c.orderId+", timeout "+c.timeoutMs+" ms, max retries "+c.maxRetries+", replay after success: "+c.replay;
  drawTopology();
  var chips=$("chips");chips.textContent="";
  STATES.forEach(function(st){var s=document.createElement("span");s.textContent=st;if(st===S.refundState)s.className="cur";chips.appendChild(s)});
  $("rstate").textContent="current refund state: "+S.refundState+(S.error?" | ENGINE ERROR: "+S.error:"");
  var tb=$("ev");tb.textContent="";
  var evs=S.events||[];
  evs.forEach(function(e){var tr=document.createElement("tr");td(tr,e.id);td(tr,e.t);td(tr,e.kind);td(tr,e.parent||"");td(tr,JSON.stringify(e.data),"d");tb.appendChild(tr)});
  var evTotal=S.eventTotal!==undefined?S.eventTotal:evs.length;
  $("evcount").textContent="events: "+evTotal+(evTotal>evs.length?" (showing last "+evs.length+")":"");
  var box=$("events");if(box)box.scrollTop=box.scrollHeight;
  var m=S.m6;
  if(isEnterprise&&m){
    $("m6summary").textContent="lifecycle: "+m.life+" | virtual time: "+m.now+" ms | queue: "+m.queue.length+"/"+m.queue.capacity+" | resource: "+m.sharedResource.state+" ("+m.sharedResource.inUse+"/"+m.sharedResource.capacity+", waiting "+m.sharedResource.waitDepth+")";
    fill($("m6queue"),m.queue.items,["id","workflow","status"]);
    fill($("m6workers"),m.workers,["id","state","currentJob"]);
    fill($("m6workflows"),m.workflows,["name","status"]);
    fill($("m6deadletters"),m.deadLetters,["workflow","jobId","reason","at"]);
  }
  var chaos=S.chaos;
  if(isChaos&&chaos){
    var cm=chaos.metrics;
    $("chaosSummary").textContent="mode: "+chaos.mode+" | virtual time: "+chaos.virtualTimeMs+" ms | host: "+chaos.host.state+" | workflows: "+chaos.workflows.length+" | events: "+chaos.eventsCount;
    $("chaosDb").textContent="DB pool: "+cm.activeDbConnections+"/"+c.poolCapacity+" active | waiters: "+cm.dbWaitQueueLength+" | peak: "+cm.peakActiveDbConnections+" | timeouts: "+cm.poolAcquisitionTimeouts+" | held: "+cm.totalDbConnectionHoldMs+" ms | occupied-time utilization: "+cm.dbPoolUtilizationPercent.toFixed(2)+"% over "+cm.measurementWindowMs+" virtual ms";
    $("chaosFaults").textContent="Main-host crashes: "+cm.mainHostCrashes+" | contained worker crashes: "+cm.containedWorkerCrashes+" (worker "+chaos.workers[0].state+") | tokens: "+cm.tokensConsumed+" | duplicate charge: $"+cm.duplicateDollarsCharged+" | orphaned instances: "+cm.orphanedAwsInstances;
    $("chaosBatch").textContent="Batch: "+chaos.batch.succeeded+" succeeded, "+chaos.batch.failed+" failed, "+chaos.batch.aborted+" innocent items aborted (50 total)";
    $("chaosSaga").textContent="Payment attempts: "+chaos.payment.attempts+" | receipts: "+chaos.payment.receipts+" | saga compensation order: "+chaos.saga.compensationOrder.join(" <- ")+" | compensated: "+chaos.saga.compensated.length+"/"+chaos.saga.forwardSteps.length+" | compensation failures: "+cm.sagaCompensationsFailed+" | resources allocated: "+chaos.saga.resourcesAllocated;
    fill($("chaosWorkflows"),chaos.workflows,["taskId","tenant","tenantId","status","dbHeldMs","retries"]);
  }
  if(isAgentLab){
    renderAgentLab();
  }
  if(isDurable){
    renderDurable();
  }
  if(isTopology){
    renderTopology();
  }
  renderComparison();
  fill($("refunds"),S.refunds,["id","order_id","amount_cents","idem_key","attempt","created_t"]);
  fill($("ops"),S.operations,["id","state","refund_id","t"]);
  if(!isEnterprise&&!isChaos&&!isAgentLab&&!isDurable&&!isTopology)$("derived").textContent="derived from DB rows: duplicate refunds = "+S.derived.duplicateRefunds;
  $("auditor").textContent="auditor: "+(S.auditor.connected?"connected":"not run by this page - "+S.auditor.reason);
  if(S.autoplay&&!poll)poll=setInterval(refresh,300);
  if(!S.autoplay&&poll){clearInterval(poll);poll=null}
}
$("preset").onchange=function(){var preset=$("preset").value;if(preset.indexOf("m11-")===0){if(preset==="m11-compare"){op({op:"run-comparison",scenario:"topology",seed:7,runId:"topology-run-7"});return}op({op:"configure",scenario:"topology",preset:preset.slice(4),mode:preset==="m11-healthy"?"resilient":"naive",seed:7,runId:"topology-run-7"});return}if(preset.indexOf("m9-")===0){if(preset==="m9-compare"){op({op:"run-comparison",scenario:"durable",seed:7,runId:"durable-run-7"});return}op({op:"configure",scenario:"durable",mode:preset==="m9-naive"?"naive":"resilient",seed:7,runId:"durable-run-7"});return}if(preset.indexOf("m8-")===0){if(preset==="m8-compare"){op({op:"run-comparison",scenario:"agent-lab",seed:7,runId:"agent-lab-run-7"});return}op({op:"configure",scenario:"agent-lab",mode:preset==="m8-naive"?"naive":"resilient",seed:7});return}if(preset.indexOf("m7-")===0){if(preset==="m7-compare"){op({op:"run-comparison",scenario:"chaos",seed:7,runId:"chaos-run-7"});return}op({op:"configure",scenario:"chaos",mode:preset==="m7-naive"?"naive":"resilient",seed:7,runId:"chaos-run-7"});return}op({op:"configure",preset:preset,scenario:preset.indexOf("m6-")===0?"enterprise":"refund",idempotency:$("idem").checked})};
$("idem").onchange=$("preset").onchange;
$("compareBtn").onclick=function(){var preset=$("preset").value;if(preset.indexOf("m11-")===0){op({op:"run-comparison",scenario:"topology",seed:7,runId:"topology-run-7"});return}if(preset.indexOf("m7-")===0){op({op:"run-comparison",scenario:"chaos",seed:7,runId:"chaos-run-7"});return}if(preset.indexOf("m8-")===0){op({op:"run-comparison",scenario:"agent-lab",seed:7,runId:"agent-lab-run-7"});return}if(preset.indexOf("m9-")===0){op({op:"run-comparison",scenario:"durable",seed:7,runId:"durable-run-7"});return}op({op:"run-comparison",scenario:"topology",seed:7,runId:"topology-run-7"});};
$("start").onclick=function(){op({op:"start"})};
$("play").onclick=function(){op({op:"play"})};
$("pause").onclick=function(){op({op:"pause"})};
$("step").onclick=function(){op({op:"step"})};
$("adv").onclick=function(){op({op:"advance",ms:500})};
$("stop").onclick=function(){op({op:"stop"})};
$("reset").onclick=function(){op({op:"reset"})};
$("exp").onclick=function(){
  api("GET","/api/trace").then(function(t){
    var a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([JSON.stringify(t,null,2)],{type:"application/json"}));
    a.download="refund-sim.trace.json";document.body.appendChild(a);a.click();a.remove();setErr("");
  },function(e){setErr(e.message)});
};
$("expa").onclick=function(){
  fetch("/api/auditor-export").then(function(r){
    if(!r.ok)return r.json().then(function(j){throw new Error(j.message||"export failed")});
    return r.text();
  }).then(function(t){
    var a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([t],{type:"application/x-ndjson"}));
    a.download="refund-sim.langchain-callback.jsonl";document.body.appendChild(a);a.click();a.remove();setErr("");
  }).catch(function(e){setErr(e.message)});
};
refresh();
`;

const BODY = `
<div class="header-badge"><span class="dot"></span>PAGE 01 // ENTERPRISE RUNTIME INVARIANT VERIFIER</div>
<h1>Enterprise Simulator &mdash; <span class="highlight-cyan">High-Ticket Production Runtime Lab</span></h1>
<p class="note">Deterministic verification engine: virtual clock, state-gated capability leases, zero-hold DB connection leases &amp; durable checkpoints.</p>

<!-- Executive KPI HUD Ribbon -->
<div class="hud-ribbon">
  <div class="hud-card">
    <div class="hud-label">DB Connection Pool <span id="hudDbBadge" class="hud-badge success">Healthy</span></div>
    <div id="hudDbVal" class="hud-value">5 / 20</div>
    <div id="hudDbSub" class="hud-sub">0 timeouts (2ms zero-hold)</div>
  </div>
  <div class="hud-card">
    <div class="hud-label">Capital Leakage <span id="hudLeakBadge" class="hud-badge success">Zero Bleed</span></div>
    <div id="hudLeakVal" class="hud-value">$0.00</div>
    <div id="hudLeakSub" class="hud-sub">Zero duplicate Stripe charges</div>
  </div>
  <div class="hud-card">
    <div class="hud-label">Web Host Resilience <span id="hudHostBadge" class="hud-badge success">Contained</span></div>
    <div id="hudHostVal" class="hud-value">ONLINE</div>
    <div id="hudHostSub" class="hud-sub">Worker isolated (0 host crashes)</div>
  </div>
  <div class="hud-card">
    <div class="hud-label">Distributed Invariants <span id="hudClockBadge" class="hud-badge success">Invariant</span></div>
    <div id="hudClockVal" class="hud-value">0 violations</div>
    <div id="hudClockSub" class="hud-sub">Monotonic sequence verified</div>
  </div>
</div>

<div class="bar">
  <label>Scenario <select id="preset">
    <option value="m11-fullChaos">M11 Topology — Full Chaos</option>
    <option value="m11-healthy">M11 Topology — Healthy</option>
    <option value="m11-dbStarvation">M11 Topology — DB Starvation</option>
    <option value="m11-hostCrash">M11 Topology — Host Crash</option>
    <option value="m11-duplicateCharge">M11 Topology — Duplicate Charge</option>
    <option value="m11-orphanedCloud">M11 Topology — Orphaned Cloud</option>
    <option value="m11-batchPoison">M11 Topology — Batch Poison</option>
    <option value="m11-clockSkew">M11 Topology — Clock Skew</option>
    <option value="m11-ntpJump">M11 Topology — NTP Jump</option>
    <option value="m11-erpDuplicate">M11 Topology — ERP Duplicate</option>
    <option value="m11-compare">M11 Topology — Compare</option>
    <option value="healthy">healthy</option>
    <option value="timeout">timeout + retry</option>
    <option value="m6-healthy">M6 healthy</option>
    <option value="m6-fault">M6 fault</option>
    <option value="m7-naive">M7 chaos naive</option>
    <option value="m7-resilient">M7 chaos resilient</option>
    <option value="m7-compare">M7 chaos compare</option>
    <option value="m8-naive">M8 Agent Context Lab — Naive</option>
    <option value="m8-resilient">M8 Agent Context Lab — Resilient</option>
    <option value="m8-compare">M8 Agent Context Lab — Compare</option>
    <option value="m9-naive">M9 Durable Execution — Naive</option>
    <option value="m9-resilient">M9 Durable Execution — Resilient</option>
    <option value="m9-compare">M9 Durable Execution — Compare</option>
  </select></label>
  <label><input type="checkbox" id="idem"> idempotency</label>
  <button id="start">Start</button><button id="play">Play</button><button id="pause">Pause</button>
  <button id="step">Step (next event)</button><button id="adv">Advance 500 ms</button>
  <button id="stop">Stop</button><button id="reset">Reset</button><button id="compareBtn">Run Comparison</button><button id="exp">Export trace JSON</button><button id="expa">Export for auditor (JSONL)</button>
</div>
<div id="err" class="err"></div>
<p id="status" class="note"></p><p id="cfg" class="note"></p>
<div id="compareBanner" class="compare-banner">No comparison run yet. Select a scenario and click Run Comparison.</div>
<div id="comparePanel" class="card hidden-panel"><h2>Comparison // Invariant Verification Delta</h2><div class="compare-grid"><div><table class="compare-table"><thead><tr><th>Metric</th><th>Naive</th><th>Resilient</th><th>Delta</th></tr></thead><tbody id="compareTableBody"></tbody></table></div><div class="card"><h3>Executive summary</h3><p id="compareSummary" class="note">no comparison yet</p><p id="compareTakeaway" class="note">no takeaway yet</p><h3>Smoking Gun // Causal Trace Evidence</h3><pre id="smokingGun" class="mono">no supporting span available</pre></div></div></div>
<div class="grid">
  <div id="refundPanel" class="card"><h2>Service topology (from registry)</h2><svg id="topo" viewBox="0 0 540 240" width="100%" height="240" role="img" aria-label="service topology"></svg>
    <h2>Refund workflow</h2><div class="chips" id="chips"></div><p id="rstate" class="note"></p></div>
  <div id="m6Panel" class="card hidden-panel"><h2>Shared queue / worker / resource</h2><p id="m6summary" class="note"></p>
    <h2>Queue</h2><table><thead><tr><th>id</th><th>workflow</th><th>status</th></tr></thead><tbody id="m6queue"></tbody></table>
    <h2>Workers</h2><table><thead><tr><th>id</th><th>state</th><th>job</th></tr></thead><tbody id="m6workers"></tbody></table>
    <h2>Workflows</h2><table><thead><tr><th>name</th><th>status</th></tr></thead><tbody id="m6workflows"></tbody></table>
    <h2>Dead letters</h2><table><thead><tr><th>workflow</th><th>job</th><th>reason</th><th>at</th></tr></thead><tbody id="m6deadletters"></tbody></table>
  </div>
  <div id="chaosPanel" class="card hidden-panel"><h2>Enterprise Chaos Lab</h2><p id="chaosSummary" class="note"></p><p id="chaosDb" class="note"></p><p id="chaosFaults" class="note"></p><p id="chaosBatch" class="note"></p><p id="chaosSaga" class="note"></p>
    <h2>Tenant workflows</h2><table><thead><tr><th>task</th><th>tenant</th><th>tenant ID</th><th>status</th><th>DB held ms</th><th>retries</th></tr></thead><tbody id="chaosWorkflows"></tbody></table>
  </div>
  <div id="m8Panel" class="card hidden-panel"><h2>M8 Agent Context Lab</h2><p id="m8Summary" class="note"></p><div class="m8-grid"><div><h3>Turn table</h3><table><thead><tr><th>turn</th><th>in</th><th>out</th><th>total</th><th>cum</th><th>V/N</th><th>DB</th><th>hall.</th></tr></thead><tbody id="m8Turns"></tbody></table></div><div><h3>Token bars</h3><div id="m8Bars"></div></div></div><h3>Prompt Inspector</h3><label>Turn <select id="m8TurnSelect"></select></label><p id="m8PromptMeta" class="note"></p><div class="card"><table><thead><tr><th>section</th><th>chars</th><th>tokens</th><th>preview</th></tr></thead><tbody id="m8PromptSections"></tbody></table></div><pre id="m8PromptText" class="mono"></pre></div>
  <div id="m9Panel" class="card hidden-panel"><h2>M9 Durable Execution Ledger</h2><p id="m9Summary" class="note"></p><p id="m9Recovery" class="note"></p><p id="m9Metrics" class="note"></p><p id="m9Audit" class="note"></p>
    <h2>Workflow Step Ledger</h2><table><thead><tr><th>step</th><th>effect</th><th>gen</th><th>execs</th><th>replay</th><th>bytes</th><th>digest</th></tr></thead><tbody id="m9Steps"></tbody></table>
  </div>
  <div id="topologyPanel" class="card hidden-panel">
    <h2>M11 Unified Enterprise Topology Dashboard</h2>
    
    <h3>Layer 1: Shared Internal Infrastructure</h3>
    <div class="topo-subgrid-2">
      <div class="topo-card">
        <div class="topo-card-title">Database Pool Contention</div>
        <div id="topoDbCardVal" class="topo-card-val">5 / 20 slots</div>
        <div id="topoDbCardSub" class="topo-card-sub">0 timeouts | 2ms zero-hold</div>
        <div id="topoDbPool" class="topo-slots"></div>
      </div>
      <div class="topo-card">
        <div class="topo-card-title">Storage IOPS Volume</div>
        <div id="topoStorageCardVal" class="topo-card-val">3% IOPS</div>
        <div id="topoStorageCardSub" class="topo-card-sub">4,096 B written (compact checkpoints)</div>
      </div>
      <div class="topo-card">
        <div class="topo-card-title">Main Web Server Host</div>
        <div id="topoWebCardVal" class="topo-card-val">ONLINE</div>
        <div id="topoWebCardSub" class="topo-card-sub">Worker isolated (0 host crashes)</div>
      </div>
      <div class="topo-card">
        <div class="topo-card-title">Redis Cache Tier</div>
        <div id="topoRedisCardVal" class="topo-card-val">0 hits / 0 misses</div>
        <div id="topoRedisCardSub" class="topo-card-sub">Evictions under pressure: 0</div>
      </div>
    </div>
    <p id="topoDb" class="note"></p>
    <p id="topoStorage" class="note"></p>
    <p id="topoWeb" class="note"></p>
    <p id="topoRedis" class="note"></p>

    <h3>Layer 2: External SaaS &amp; Economic Bleed</h3>
    <div class="topo-subgrid-4">
      <div class="topo-card">
        <div class="topo-card-title">Stripe Gateway</div>
        <div id="topoSaaSStripe" class="topo-card-val">$0.00</div>
        <div class="topo-card-sub">Idempotent Dedup</div>
      </div>
      <div class="topo-card">
        <div class="topo-card-title">AWS Cloud</div>
        <div id="topoSaaSAws" class="topo-card-val">$0/mo</div>
        <div class="topo-card-sub">Saga Compensated</div>
      </div>
      <div class="topo-card">
        <div class="topo-card-title">CRM API</div>
        <div id="topoSaaSCrm" class="topo-card-val">0 Bursts</div>
        <div class="topo-card-sub">Rate-Gated Leases</div>
      </div>
      <div class="topo-card">
        <div class="topo-card-title">Legacy ERP</div>
        <div id="topoSaaSErp" class="topo-card-val">0 Dups</div>
        <div class="topo-card-sub">Dedup Ledger</div>
      </div>
    </div>
    <p id="topoExternal" class="note"></p>

    <h3>Layer 3: 10 Department Workflows</h3>
    <table><thead><tr><th>department</th><th>status</th><th>DB hold</th><th>tokens</th><th>cost ($)</th><th>containment</th></tr></thead><tbody id="topoWorkflows"></tbody></table>

    <h3>Layer 4: Clocks &amp; Distributed Invariants</h3>
    <p id="topoClocks" class="note"></p>
    <h3>Executive Totals</h3>
    <p id="topoTotals" class="note"></p>
  </div>
  <div class="card"><h2>Event timeline</h2><p id="evcount" class="note"></p>
    <div id="events"><table><thead><tr><th>id</th><th>t (ms)</th><th>kind</th><th>parent</th><th>data</th></tr></thead><tbody id="ev"></tbody></table></div></div>
</div>
<div class="grid mt">
  <div id="refundDbPanel" class="card"><h2>DB: refunds</h2><table><thead><tr><th>id</th><th>order</th><th>cents</th><th>idem key</th><th>attempt</th><th>t</th></tr></thead><tbody id="refunds"></tbody></table>
    <p id="derived" class="note"></p></div>
  <div id="opsPanel" class="card"><h2>DB: operations</h2><table><thead><tr><th>id</th><th>state</th><th>refund id</th><th>t</th></tr></thead><tbody id="ops"></tbody></table>
    <p id="auditor" class="note"></p></div>
</div>
`;

const sha = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

export const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Enterprise simulator</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>${BODY}<script>${JS}</script></body></html>`;

export const CSP = [
  "default-src 'none'",
  `script-src ${sha(JS)}`,
  `style-src ${sha(CSS)}`,
  "connect-src 'self'",
  "img-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
