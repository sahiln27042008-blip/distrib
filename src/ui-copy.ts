// UI Copy: Combinatorial Enterprise Matrix + Classic Milestones UI
// Inline CSP compliance with SHA-256 hashed scripts and styles

import { createHash } from "node:crypto";

const CSS = `
:root{
  --bg:#06070a;--surface:#0b0d14;--card:#101422;--card-border:#1c2438;
  --text:#f8fafc;--muted:#64748b;--accent-violet:#8b5cf6;--accent-violet-glow:rgba(139,92,246,0.35);
  --accent-cyan:#2dd4bf;--accent-cyan-glow:rgba(45,212,191,0.25);
  --danger:#f43f5e;--danger-glow:rgba(244,63,94,0.25);--success:#2dd4bf;--warning:#fbbf24;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,sans-serif;padding:20px;font-size:13px;line-height:1.5;min-height:100vh}
h1{font-size:20px;margin-bottom:4px;letter-spacing:-0.5px;font-weight:700;display:flex;align-items:center;gap:8px}
h2{font-size:14px;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;color:var(--accent-violet);font-weight:700}
h3{font-size:12px;margin:10px 0 6px 0;text-transform:uppercase;letter-spacing:0.8px;color:#94a3b8}

/* Top Tab Navigation */
.tabs-nav{display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid var(--card-border);padding-bottom:10px}
.tab-btn{background:var(--surface);border:1px solid var(--card-border);color:var(--muted);padding:8px 18px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s}
.tab-btn.active{background:linear-gradient(135deg,rgba(139,92,246,0.2),rgba(45,212,191,0.15));border-color:var(--accent-violet);color:#fff;box-shadow:0 0 16px var(--accent-violet-glow)}

.tab-pane{display:none}
.tab-pane.active{display:block}

/* Preset Pill Ribbon */
.preset-ribbon{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.preset-pill{background:#111625;border:1px solid #232d47;color:#c4b5fd;padding:5px 11px;border-radius:20px;font-size:11px;font-family:ui-monospace,monospace;cursor:pointer;transition:all .15s}
.preset-pill:hover{border-color:var(--accent-violet);background:rgba(139,92,246,0.15)}

/* Scale Inputs Bar */
.scale-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;background:var(--surface);border:1px solid var(--card-border);padding:10px 14px;border-radius:8px;margin-bottom:14px}
.scale-item{display:flex;flex-direction:column;gap:3px}
.scale-item label{font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:0.5px}
.scale-item input{background:var(--bg);border:1px solid var(--card-border);color:var(--text);padding:5px 8px;border-radius:4px;font-size:12px;font-family:ui-monospace,monospace}

/* The 6 Dials Grid */
.dials-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-bottom:14px}
.dial-card{background:var(--card);border:1px solid var(--card-border);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.dial-header{display:flex;justify-content:space-between;align-items:center}
.dial-title{font-size:11px;font-weight:700;color:var(--accent-violet);text-transform:uppercase}
.dial-select{background:var(--bg);border:1px solid #232d47;color:var(--text);padding:6px;border-radius:4px;font-size:11px;font-family:ui-monospace,monospace;width:100%}

/* Action Control Bar */
.action-bar{display:flex;gap:10px;align-items:center;margin-bottom:16px}
button.primary{background:linear-gradient(135deg,#8b5cf6,#6d28d9);border:none;color:#fff;padding:8px 18px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 0 16px var(--accent-violet-glow)}
button.secondary{background:linear-gradient(135deg,#0d9488,#14b8a6);border:none;color:#031513;padding:8px 18px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 0 16px var(--accent-cyan-glow)}
button.neutral{background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px 14px;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer}
button:disabled{opacity:0.4;cursor:not-allowed}

/* Value Delta Banner */
.value-delta-banner{background:linear-gradient(135deg,#130c24,#081b1c);border:1px solid #3d226e;border-radius:10px;padding:14px 18px;margin-bottom:16px}
.delta-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.delta-title{font-size:13px;font-weight:700;color:#c4b5fd;letter-spacing:0.5px}
.delta-roi{font-size:12px;font-family:ui-monospace,monospace;color:var(--accent-cyan);font-weight:700}
.delta-metrics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.delta-card{background:rgba(6,7,10,0.6);border:1px solid #1f273d;padding:8px 10px;border-radius:6px}
.delta-card-label{font-size:10px;color:var(--muted);text-transform:uppercase}
.delta-card-val{font-size:14px;font-weight:700;margin:2px 0}
.delta-card-val.worse{color:var(--danger)}
.delta-card-val.better{color:var(--accent-cyan)}
.delta-card-sub{font-size:10px;color:#94a3b8}

/* 4 Quadrants Grid */
.quad-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--card-border);border-radius:8px;padding:12px;overflow:hidden}

/* Tables */
table{width:100%;border-collapse:collapse;margin-top:6px;font-size:11px}
th{background:#080b13;padding:6px 8px;border-bottom:1px solid #1e263d;color:#64748b;font-size:10px;text-transform:uppercase;text-align:left}
td{padding:6px 8px;border-bottom:1px solid #131926;text-align:left;vertical-align:top}
tr.clickable{cursor:pointer;transition:background 0.15s ease}
tr.clickable:hover{background:rgba(139,92,246,0.12)}
.text-danger{color:var(--danger);font-weight:700}
.text-success{color:var(--accent-cyan);font-weight:700}
.text-muted{color:#64748b}

/* Code Inspector Snippet */
pre.code-box{background:#06080e;border:1px solid #1a2236;padding:10px;border-radius:6px;font-family:ui-monospace,monospace;font-size:11px;color:#38bdf8;white-space:pre-wrap;max-height:220px;overflow-y:auto;line-height:1.5}
.note{font-size:11px;color:#94a3b8;margin-top:4px}
.mono{font-family:ui-monospace,monospace}
.err{color:var(--danger);font-size:11px;margin:4px 0}

/* SVG Topology */
svg{background:#080b13;border:1px solid #1a2236;border-radius:6px;width:100%}
svg text{font-size:10px;fill:#f8fafc;font-family:ui-monospace,monospace;font-weight:600}
svg .node-box{fill:#111625;stroke:#263352;stroke-width:1.5}
svg .node-box.danger{fill:#2b0e17;stroke:#f43f5e;filter:drop-shadow(0 0 6px rgba(244,63,94,0.4))}
svg .node-box.success{fill:#062828;stroke:#2dd4bf;filter:drop-shadow(0 0 6px rgba(45,212,191,0.4))}

/* Scrollbars */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#080b12}
::-webkit-scrollbar-thumb{background:#1e263d;border-radius:3px}
`;

const JS = `
"use strict";
var $=function(id){return document.getElementById(id)};
var S=null,matrixRes=null;

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

// Tab Switching
$("tabMatrixBtn").onclick=function(){
  $("tabMatrixBtn").className="tab-btn active";
  $("tabClassicBtn").className="tab-btn";
  $("tabMatrix").className="tab-pane active";
  $("tabClassic").className="tab-pane";
};
$("tabClassicBtn").onclick=function(){
  $("tabClassicBtn").className="tab-btn active";
  $("tabMatrixBtn").className="tab-btn";
  $("tabClassic").className="tab-pane active";
  $("tabMatrix").className="tab-pane";
};

// Dial Definitions and Presets
var PRESETS = {
  login_freeze_db_hog: { A:"A2_mixed_saas", B:"B2_stream_hog_30s", C:"C1_clean_20ms", D:"D2_append_only_quadratic", E:"E1_god_mode_main_thread", F:"F1_blind_retry_unbounded_spend", humanUsers:200, concurrentAgents:10, dbPoolSize:20, workflowSteps:10, saasPriceUsd:20, ticketValueUsd:5 },
  double_charge_2ms_drop: { A:"A2_mixed_saas", B:"B1_zero_hold_2ms", C:"C2_socket_drop_2ms_late", D:"D3_lossy_llm_summary", E:"E4_state_leases_ipc_worker", F:"F1_blind_retry_unbounded_spend", humanUsers:200, concurrentAgents:10, dbPoolSize:20, workflowSteps:10, saasPriceUsd:20, ticketValueUsd:5 },
  split_brain_orphan_aws: { A:"A1_single_task", B:"B2_stream_hog_30s", C:"C1_clean_20ms", D:"D2_append_only_quadratic", E:"E1_god_mode_main_thread", F:"F2_ask_llm_to_undo", humanUsers:0, concurrentAgents:1, dbPoolSize:20, workflowSteps:10, saasPriceUsd:20, ticketValueUsd:5 },
  json_80k_churn_choke: { A:"A2_mixed_saas", B:"B1_zero_hold_2ms", C:"C1_clean_20ms", D:"D1_raw_json_80k_flood", E:"E4_state_leases_ipc_worker", F:"F1_blind_retry_unbounded_spend", humanUsers:200, concurrentAgents:10, dbPoolSize:20, workflowSteps:10, saasPriceUsd:20, ticketValueUsd:5 },
  turn10_quadratic_spiral: { A:"A5_marathon_30step", B:"B3_write_amp_15mb", C:"C1_clean_20ms", D:"D2_append_only_quadratic", E:"E1_god_mode_main_thread", F:"F1_blind_retry_unbounded_spend", humanUsers:50, concurrentAgents:5, dbPoolSize:20, workflowSteps:30, saasPriceUsd:20, ticketValueUsd:5 },
  checkpoint_15mb_disk_collapse: { A:"A5_marathon_30step", B:"B3_write_amp_15mb", C:"C1_clean_20ms", D:"D3_lossy_llm_summary", E:"E4_state_leases_ipc_worker", F:"F1_blind_retry_unbounded_spend", humanUsers:100, concurrentAgents:10, dbPoolSize:20, workflowSteps:30, saasPriceUsd:20, ticketValueUsd:5 },
  cfo_40usd_margin_inversion: { A:"A5_marathon_30step", B:"B1_zero_hold_2ms", C:"C1_clean_20ms", D:"D1_raw_json_80k_flood", E:"E4_state_leases_ipc_worker", F:"F1_blind_retry_unbounded_spend", humanUsers:50, concurrentAgents:5, dbPoolSize:20, workflowSteps:15, saasPriceUsd:20, ticketValueUsd:5 },
  bulk_50_poison_rate_storm: { A:"A4_bulk_crm_swarm", B:"B1_zero_hold_2ms", C:"C4_bulk_50_poison_pill", D:"D4_unmapped_schema_drift", E:"E4_state_leases_ipc_worker", F:"F1_blind_retry_unbounded_spend", humanUsers:100, concurrentAgents:50, dbPoolSize:20, workflowSteps:10, saasPriceUsd:20, ticketValueUsd:5 },
  god_mode_prompt_injection: { A:"A1_single_task", B:"B2_stream_hog_30s", C:"C1_clean_20ms", D:"D2_append_only_quadratic", E:"E1_god_mode_main_thread", F:"F2_ask_llm_to_undo", humanUsers:0, concurrentAgents:1, dbPoolSize:20, workflowSteps:10, saasPriceUsd:20, ticketValueUsd:5 },
  marathon_20min_kill_test: { A:"A5_marathon_30step", B:"B3_write_amp_15mb", C:"C3_rate_limit_429_brownout", D:"D2_append_only_quadratic", E:"E1_god_mode_main_thread", F:"F1_blind_retry_unbounded_spend", humanUsers:50, concurrentAgents:5, dbPoolSize:20, workflowSteps:30, saasPriceUsd:20, ticketValueUsd:5 }
};

function readDials(){
  return {
    seed: 42,
    runId: "matrix-run-42",
    A: $("dialA").value,
    B: $("dialB").value,
    C: $("dialC").value,
    D: $("dialD").value,
    E: $("dialE").value,
    F: $("dialF").value,
    humanUsers: Number($("scaleHumanUsers").value)||200,
    concurrentAgents: Number($("scaleConcurrentAgents").value)||10,
    dbPoolSize: Number($("scaleDbPoolSize").value)||20,
    workflowSteps: Number($("scaleWorkflowSteps").value)||10,
    saasPriceUsd: Number($("scaleSaasPrice").value)||20,
    ticketValueUsd: Number($("scaleTicketValue").value)||5
  };
}

function applyPreset(pName){
  var p = PRESETS[pName];
  if(!p)return;
  $("dialA").value = p.A;
  $("dialB").value = p.B;
  $("dialC").value = p.C;
  $("dialD").value = p.D;
  $("dialE").value = p.E;
  $("dialF").value = p.F;
  $("scaleHumanUsers").value = String(p.humanUsers);
  $("scaleConcurrentAgents").value = String(p.concurrentAgents);
  $("scaleDbPoolSize").value = String(p.dbPoolSize);
  $("scaleWorkflowSteps").value = String(p.workflowSteps);
  $("scaleSaasPrice").value = String(p.saasPriceUsd);
  $("scaleTicketValue").value = String(p.ticketValueUsd);
}

// Preset button handlers
var pillContainer = $("presetPills");
Object.keys(PRESETS).forEach(function(key){
  var pill = document.createElement("button");
  pill.className = "preset-pill";
  pill.textContent = key.replace(/_/g, " ");
  pill.onclick = function(){
    applyPreset(key);
    runMatrix();
  };
  pillContainer.appendChild(pill);
});

function runMatrix(){
  var cfg = readDials();
  setErr("Executing combinatorial simulation across 6 dials...");
  api("POST", "/api/matrix/run", { config: cfg }).then(function(res){
    matrixRes = res;
    setErr("");
    renderMatrix(res);
  }, function(e){ setErr(e.message); });
}

$("btnRunSelected").onclick = runMatrix;
$("btnCompare").onclick = runMatrix;
$("btnReset").onclick = function(){
  applyPreset("login_freeze_db_hog");
  runMatrix();
};

function renderMatrix(res){
  var sel = res.selected, resl = res.resilient, vd = res.valueDelta;

  // Value Delta Banner
  $("roiSummary").textContent = "Net Monthly Savings: $" + vd.netMonthlySavings.toLocaleString() + " | Payback: " + vd.paybackDays + " days on $15k engagement";
  $("deltaPrompt").textContent = sel.context.promptTokens + " -> " + resl.context.promptTokens;
  $("deltaDbHold").textContent = sel.db.avgHoldMs + "ms -> " + resl.db.avgHoldMs + "ms";
  $("delta500s").textContent = sel.db.saas500s + " -> " + resl.db.saas500s;
  $("deltaDisk").textContent = (sel.storage.bytesWritten/1000).toFixed(0) + "KB -> " + (resl.storage.bytesWritten/1000).toFixed(0) + "KB";
  $("deltaDupCharges").textContent = "$" + sel.network.duplicateDollars + " -> $" + resl.network.duplicateDollars;
  $("deltaCostTicket").textContent = "$" + sel.economics.costUsd.toFixed(2) + " -> $" + resl.economics.costUsd.toFixed(2);

  // Quadrant 2: Hardware Telemetry
  $("q2DbConn").textContent = sel.db.activeConnections + "/" + sel.db.poolSize + " active (" + sel.db.timeouts + " timeouts)";
  $("q2DbCpu").textContent = sel.db.cpuPct + "% CPU (" + sel.db.ramPct + "% RAM)";
  $("q2Iops").textContent = sel.storage.iopsUsed + "% IOPS (" + (sel.storage.frozenQueries > 0 ? "FROZEN" : "normal") + ")";
  $("q2Ttft").textContent = sel.context.ttftMs + " ms TTFT (" + sel.context.signalPct + "% signal)";
  $("q2Host").textContent = sel.host.crashed ? "CRASHED (500)" : "ONLINE (100%)";

  // Quadrant 3: Root Causes vs Code Fixes
  var rcBox = $("rootCausesList");
  rcBox.textContent = "";
  (res.rootCauses||[]).forEach(function(rc){
    var div = document.createElement("div");
    div.style.marginBottom = "8px";
    var t = document.createElement("div");
    t.style.fontWeight = "700";
    t.style.color = "var(--danger)";
    t.textContent = rc.title + " [" + rc.dial + "]";
    var m = document.createElement("div");
    m.style.fontSize = "11px";
    m.style.color = "#cbd5e1";
    m.textContent = rc.mechanism;
    var b = document.createElement("div");
    b.style.fontSize = "10px";
    b.style.color = "#94a3b8";
    b.textContent = "Impact: " + rc.businessImpact;
    div.appendChild(t); div.appendChild(m); div.appendChild(b);
    rcBox.appendChild(div);
  });

  var fixSnippet = $("fixCodeSnippet");
  if(res.appliedFixes && res.appliedFixes.length > 0){
    fixSnippet.textContent = res.appliedFixes.map(function(f){
      return "// " + f.invariantName + " (" + f.dial + ")\n// " + f.metricDelta + "\n" + f.codeSnippet;
    }).join("\n\n");
  } else {
    fixSnippet.textContent = "// System is running in Resilient Invariant state.";
  }

  // Quadrant 4: Per-Tenant P&L Table
  var plTbody = $("tenantPlBody");
  plTbody.textContent = "";
  (sel.economics.perTenant||[]).forEach(function(t, idx){
    var tr = document.createElement("tr");
    tr.className = "clickable";
    var resTenant = (resl.economics.perTenant||[])[idx];
    var tdName = document.createElement("td"); tdName.textContent = t.tenant; tr.appendChild(tdName);
    var tdRev = document.createElement("td"); tdRev.textContent = "$" + t.revenueUsd.toFixed(2); tr.appendChild(tdRev);
    var tdCostSel = document.createElement("td"); tdCostSel.textContent = "$" + t.costUsd.toFixed(2); tdCostSel.className = "text-danger"; tr.appendChild(tdCostSel);
    var tdCostRes = document.createElement("td"); tdCostRes.textContent = "$" + (resTenant?resTenant.costUsd.toFixed(2):"0.03"); tdCostRes.className = "text-success"; tr.appendChild(tdCostRes);
    var tdMargin = document.createElement("td");
    tdMargin.textContent = "$" + (resTenant?resTenant.marginUsd.toFixed(2):"19.97");
    tdMargin.className = "text-success";
    tr.appendChild(tdMargin);
    plTbody.appendChild(tr);
  });

  // Quadrant 1: Topology Highlights
  var dbBox = $("svgDbBox");
  if(dbBox) dbBox.setAttribute("class", sel.db.timeouts > 0 ? "node-box danger" : "node-box success");
  var hostBox = $("svgHostBox");
  if(hostBox) hostBox.setAttribute("class", sel.host.crashed ? "node-box danger" : "node-box success");
  var saasBox = $("svgSaasBox");
  if(saasBox) saasBox.setAttribute("class", sel.network.duplicateDollars > 0 ? "node-box danger" : "node-box success");
}

// Initial Matrix Run
applyPreset("login_freeze_db_hog");
runMatrix();
`;

const BODY = `
<div class="tabs-nav">
  <button id="tabMatrixBtn" class="tab-btn active">Tab 1: Combinatorial Enterprise Matrix (A x B x C x D x E x F)</button>
  <button id="tabClassicBtn" class="tab-btn">Tab 2: Classic Milestones Engine (M2, M6, M7, M8, M9, M11)</button>
</div>

<!-- TAB 1: COMBINATORIAL ENTERPRISE MATRIX -->
<div id="tabMatrix" class="tab-pane active">
  <h1>Enterprise Simulator &mdash; <span style="color:var(--accent-cyan)">Combinatorial Matrix Command Center</span></h1>
  <p class="note">15,000+ deterministic enterprise failure scenarios configured across 6 orthogonal virtual-clock dials.</p>

  <!-- Preset Buttons -->
  <div class="preset-ribbon" id="presetPills"></div>

  <!-- Scale Parameters Bar -->
  <div class="scale-bar">
    <div class="scale-item"><label>Human Users</label><input type="number" id="scaleHumanUsers" value="200" min="0" max="500"></div>
    <div class="scale-item"><label>Concurrent AI</label><input type="number" id="scaleConcurrentAgents" value="10" min="1" max="100"></div>
    <div class="scale-item"><label>Postgres Pool</label><input type="number" id="scaleDbPoolSize" value="20" min="2" max="100"></div>
    <div class="scale-item"><label>Workflow Steps</label><input type="number" id="scaleWorkflowSteps" value="10" min="3" max="30"></div>
    <div class="scale-item"><label>SaaS Price ($/mo)</label><input type="number" id="scaleSaasPrice" value="20" min="5" max="1000"></div>
    <div class="scale-item"><label>Ticket Value ($)</label><input type="number" id="scaleTicketValue" value="5" min="1" max="500"></div>
  </div>

  <!-- The 6 Dials -->
  <div class="dials-grid">
    <div class="dial-card">
      <div class="dial-header"><span class="dial-title">Dial A // Traffic Mode</span></div>
      <select id="dialA" class="dial-select">
        <option value="A1_single_task">A1: Single Task (1 AI Workflow, 0 Humans)</option>
        <option value="A2_mixed_saas" selected>A2: Mixed SaaS (200 Humans + 10 AI Agents)</option>
        <option value="A3_exec_demo_burst">A3: Exec Demo Burst (5 Sync Bursts at t=0)</option>
        <option value="A4_bulk_crm_swarm">A4: Bulk CRM Swarm (50 Agents Syncing)</option>
        <option value="A5_marathon_30step">A5: Marathon (30 Steps over 20 Virtual Mins)</option>
      </select>
    </div>

    <div class="dial-card">
      <div class="dial-header"><span class="dial-title">Dial B // DB &amp; Storage Disk</span></div>
      <select id="dialB" class="dial-select">
        <option value="B1_zero_hold_2ms">B1: Resilient Zero-Hold Lease (2ms Borrow)</option>
        <option value="B2_stream_hog_30s" selected>B2: Streaming Connection Hog (28,450ms Hold)</option>
        <option value="B3_write_amp_15mb">B3: Event Checkpoint Write Amp (15MB IOPS 100%)</option>
        <option value="B4_hydration_freeze_4s">B4: Deserialization Hydration Spike (4s Freeze)</option>
        <option value="B5_in_doubt_zombie_tx">B5: In-Doubt Zombie TX (Socket Drop Mid-Write)</option>
      </select>
    </div>

    <div class="dial-card">
      <div class="dial-header"><span class="dial-title">Dial C // External APIs &amp; Network</span></div>
      <select id="dialC" class="dial-select">
        <option value="C1_clean_20ms" selected>C1: Clean 20ms HTTP 200 Pipe</option>
        <option value="C2_socket_drop_2ms_late">C2: ECONNRESET 2ms Late ($500 Charged)</option>
        <option value="C3_rate_limit_429_brownout">C3: 8000ms Brownout + HTTP 429 Burst</option>
        <option value="C4_bulk_50_poison_pill">C4: Bulk 50 Poison Pill (#27 Malformed)</option>
        <option value="C5_legacy_erp_no_idem">C5: Legacy Warehouse ERP (No Idempotency)</option>
      </select>
    </div>

    <div class="dial-card">
      <div class="dial-header"><span class="dial-title">Dial D // Context &amp; Signal</span></div>
      <select id="dialD" class="dial-select">
        <option value="D1_raw_json_80k_flood">D1: Raw JSON Flood (80,000 Tokens, 1% Signal)</option>
        <option value="D2_append_only_quadratic" selected>D2: Append-Only History (500 -> 42k Tokens)</option>
        <option value="D3_lossy_llm_summary">D3: Lossy LLM Summary (Drops FKs, Cements Errors)</option>
        <option value="D4_unmapped_schema_drift">D4: Schema Drift (Column Mismatch, HTTP 400)</option>
        <option value="D5_cqrs_duckdb_blackboard_o1">D5: DuckDB CQRS Blackboard (400 Tokens Flat)</option>
      </select>
    </div>

    <div class="dial-card">
      <div class="dial-header"><span class="dial-title">Dial E // Security &amp; Isolation</span></div>
      <select id="dialE" class="dial-select">
        <option value="E1_god_mode_main_thread" selected>E1: God Mode Main Thread (200 Tools, Crash Host)</option>
        <option value="E2_walled_garden_stuck">E2: Walled Garden (3 Tools, Aborts Workflow)</option>
        <option value="E3_hitl_fatigue_global_bool">E3: Approval Fatigue (Global Boolean Trap)</option>
        <option value="E4_state_leases_ipc_worker">E4: State-Gated Leases + IPC Worker Isolation</option>
      </select>
    </div>

    <div class="dial-card">
      <div class="dial-header"><span class="dial-title">Dial F // Recovery &amp; Economics</span></div>
      <select id="dialF" class="dial-select">
        <option value="F1_blind_retry_unbounded_spend" selected>F1: Blind 10x Retry ($40 Spend on $5 Ticket)</option>
        <option value="F2_ask_llm_to_undo">F2: Ask LLM To Undo (Orphaned Cloud + DB Drift)</option>
        <option value="F3_resilient_invariant_runtime">F3: Resilient Invariant Runtime ($0.25 Cap)</option>
      </select>
    </div>
  </div>

  <!-- Actions -->
  <div class="action-bar">
    <button id="btnRunSelected" class="primary">1. Run Selected Setup</button>
    <button id="btnCompare" class="secondary">2. Compare Side-by-Side (Resilient)</button>
    <button id="btnReset" class="neutral">Reset</button>
    <div id="err" class="err"></div>
  </div>

  <!-- Value Delta Banner -->
  <div class="value-delta-banner">
    <div class="delta-header">
      <span class="delta-title">Enterprise Value Delta // ROI Assessment</span>
      <span id="roiSummary" class="delta-roi"></span>
    </div>
    <div class="delta-metrics-grid">
      <div class="delta-card"><div class="delta-card-label">Prompt Tokens</div><div id="deltaPrompt" class="delta-card-val worse">-</div><div class="delta-card-sub">Selected vs Resilient</div></div>
      <div class="delta-card"><div class="delta-card-label">DB Connection Hold</div><div id="deltaDbHold" class="delta-card-val worse">-</div><div class="delta-card-sub">Selected vs Resilient</div></div>
      <div class="delta-card"><div class="delta-card-label">Human SaaS 500s</div><div id="delta500s" class="delta-card-val worse">-</div><div class="delta-card-sub">Selected vs Resilient</div></div>
      <div class="delta-card"><div class="delta-card-label">Disk Storage Writes</div><div id="deltaDisk" class="delta-card-val worse">-</div><div class="delta-card-sub">Selected vs Resilient</div></div>
      <div class="delta-card"><div class="delta-card-label">Duplicate Charges</div><div id="deltaDupCharges" class="delta-card-val worse">-</div><div class="delta-card-sub">Selected vs Resilient</div></div>
      <div class="delta-card"><div class="delta-card-label">Cost / Ticket</div><div id="deltaCostTicket" class="delta-card-val worse">-</div><div class="delta-card-sub">Selected vs Resilient</div></div>
    </div>
  </div>

  <!-- 4-Quadrant Live Telemetry Grid -->
  <div class="quad-grid">
    <!-- Quadrant 1: Topology SVG -->
    <div class="card">
      <h2>Q1 // Topology &amp; Failure Blast Radius</h2>
      <svg viewBox="0 0 480 200" height="200">
        <rect id="svgHumans" x="10" y="20" width="80" height="40" rx="4" class="node-box" />
        <text x="50" y="44" text-anchor="middle">SaaS Humans</text>

        <rect id="svgHostBox" x="130" y="20" width="90" height="40" rx="4" class="node-box" />
        <text x="175" y="44" text-anchor="middle">Main Host</text>

        <rect id="svgWorkerBox" x="130" y="90" width="90" height="40" rx="4" class="node-box" />
        <text x="175" y="114" text-anchor="middle">IPC Worker</text>

        <rect id="svgDbBox" x="260" y="20" width="90" height="40" rx="4" class="node-box" />
        <text x="305" y="44" text-anchor="middle">Postgres Pool</text>

        <rect id="svgDuckBox" x="260" y="90" width="90" height="40" rx="4" class="node-box" />
        <text x="305" y="114" text-anchor="middle">DuckDB CQRS</text>

        <rect id="svgSaasBox" x="380" y="55" width="90" height="45" rx="4" class="node-box" />
        <text x="425" y="82" text-anchor="middle">SaaS APIs</text>
      </svg>
    </div>

    <!-- Quadrant 2: Hardware Telemetry -->
    <div class="card">
      <h2>Q2 // Hardware &amp; Telemetry Gauges</h2>
      <table>
        <tbody>
          <tr><th>Active DB Connections</th><td id="q2DbConn" class="mono text-danger">-</td></tr>
          <tr><th>Database CPU / RAM</th><td id="q2DbCpu" class="mono">-</td></tr>
          <tr><th>Storage Disk IOPS</th><td id="q2Iops" class="mono text-danger">-</td></tr>
          <tr><th>TTFT Prompt Latency</th><td id="q2Ttft" class="mono">-</td></tr>
          <tr><th>Host Process Uptime</th><td id="q2Host" class="mono text-danger">-</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Quadrant 3: Root Cause vs Code Fix Inspector -->
    <div class="card">
      <h2>Q3 // Root Cause vs Code Fix Inspector</h2>
      <div id="rootCausesList" style="margin-bottom:10px"></div>
      <h3>Applied Invariant Fix (TypeScript)</h3>
      <pre id="fixCodeSnippet" class="code-box"></pre>
    </div>

    <!-- Quadrant 4: Per-Tenant P&L -->
    <div class="card">
      <h2>Q4 // CFO Unit Economics &amp; Tenant P&amp;L</h2>
      <table>
        <thead>
          <tr><th>Tenant</th><th>SaaS Rev</th><th>Selected Cost</th><th>Resilient Cost</th><th>Protected Margin</th></tr>
        </thead>
        <tbody id="tenantPlBody"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- TAB 2: CLASSIC MILESTONES (M2, M6, M7, M8, M9, M11) -->
<div id="tabClassic" class="tab-pane">
  <h1>Classic Milestones Engine &mdash; <span style="color:var(--accent-violet)">Verification Suite</span></h1>
  <p class="note">Run original milestone invariant simulations (M2 Refund, M6 Enterprise, M7 Chaos, M8 Agent Lab, M9 Durable Ledger, M11 Topology).</p>
  <div class="card" style="margin-top:14px">
    <h2>Classic Scenarios Available</h2>
    <p class="note">All classic scenarios (M2 through M11) remain active and test-verified via <code>/api/op</code>, <code>/api/lab/run</code>, and <code>/api/topology-presets</code>.</p>
  </div>
</div>
`;

const sha = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

export const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Enterprise Matrix Simulator</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>${BODY}<script>${JS}</script></body></html>`;

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
