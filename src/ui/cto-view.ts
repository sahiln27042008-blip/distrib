import { createHash } from "node:crypto";

const CSS = `
*{box-sizing:border-box}
:root{color-scheme:dark;--ink:#eef2ec;--muted:#9da9a1;--line:#394640;--panel:#17201c;--page:#101713;--green:#83d6a0;--red:#ff8277;--amber:#f0c66e;--cyan:#83c9ce}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.55 ui-monospace,"Cascadia Code",Consolas,monospace}
main{max-width:1050px;margin:0 auto;padding:38px 24px 64px}
header{border-bottom:1px solid var(--line);padding-bottom:22px;animation:reveal .35s ease-out both}
.eyebrow{color:var(--cyan);font-size:11px;text-transform:uppercase}
h1{font:700 30px/1.1 Georgia,"Times New Roman",serif;margin:10px 0 12px;letter-spacing:0}
.status{display:flex;gap:14px;align-items:center;font-size:18px;font-weight:700}
.status-mark{font-size:22px}.approved{color:var(--green)}.blocked{color:var(--red)}.insufficient{color:var(--amber)}
.reason{color:var(--muted);max-width:780px;margin:10px 0 0}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-bottom:1px solid var(--line);margin-bottom:28px}
.stat{padding:18px 14px 18px 0;border-right:1px solid var(--line)}.stat+.stat{padding-left:18px}.stat:last-child{border:0}
.stat-value{font-size:24px;color:var(--cyan);font-weight:700}.stat-label{font-size:10px;color:var(--muted);text-transform:uppercase}
section{margin-top:28px}h2{font:700 18px Georgia,"Times New Roman",serif;margin:0 0 12px}
.entry{border-top:1px solid var(--line);padding:16px 0;animation:reveal .35s ease-out both}.entry h3{font-size:14px;margin:0 0 8px;color:var(--red)}
.entry p{margin:5px 0}.label{color:var(--muted)}.counterexample{margin:14px 0;padding:12px 16px;border-left:2px solid var(--amber);background:#1a211c}
ol{margin:8px 0 0;padding-left:22px}li{padding:3px 0}.timestamp{color:var(--muted);font-size:11px}
.replay{font-size:11px;color:var(--muted);overflow-wrap:anywhere}.patch-title{color:var(--cyan)!important}.verified{color:var(--green)}.unverified{color:var(--red)}
pre{margin:12px 0 0;padding:14px;background:#0a0e0c;border:1px solid var(--line);overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,"Cascadia Code",Consolas,monospace;color:#c6d3ca}
.empty{color:var(--muted);padding:12px 0;border-top:1px solid var(--line)}
@keyframes reveal{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:620px){main{padding:24px 16px 44px}h1{font-size:26px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat:nth-child(2){border-right:0}.stat:nth-child(n+3){border-top:1px solid var(--line)}.stat:nth-child(3){padding-left:0}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important}}
`;

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("base64");
}

export function renderCtoView(evidence: any): string {
  const status = ["APPROVED", "BLOCKED", "INSUFFICIENT_EVIDENCE"].includes(evidence?.status)
    ? evidence.status
    : "INSUFFICIENT_EVIDENCE";
  const statusClass = status === "APPROVED" ? "approved" : status === "BLOCKED" ? "blocked" : "insufficient";
  const statusMark = status === "APPROVED" ? "🟢" : status === "BLOCKED" ? "🔴" : "🟡";
  const failures = Array.isArray(evidence?.discoveredFailures) ? evidence.discoveredFailures : [];
  const patches = Array.isArray(evidence?.patches) ? evidence.patches : [];
  const failureHtml = failures.length
    ? failures.map((failure: any) => {
      const events = Array.isArray(failure.counterexample) ? failure.counterexample : [];
      const replay = failure.replayHandle && typeof failure.replayHandle === "object"
        ? `seed=${failure.replayHandle.seed}, config=${JSON.stringify(failure.replayHandle.config)}`
        : "Unavailable";
      return `<article class="entry">
        <h3>${escapeHtml(failure.invariant || "Invariant failure")}</h3>
        <p><span class="label">Hypothesis:</span> ${escapeHtml(failure.hypothesis)}</p>
        <p><span class="label">Business impact:</span> ${escapeHtml(failure.businessImpact)}</p>
        <div class="counterexample"><strong>Minimal counterexample (${events.length} events)</strong>
          <ol>${events.map((event: any) => `<li>${escapeHtml(event.description)} <span class="timestamp">+${escapeHtml(event.timestamp)} ms</span></li>`).join("")}</ol>
        </div>
        <p class="replay"><span class="label">Replay handle:</span> ${escapeHtml(replay)}</p>
      </article>`;
    }).join("")
    : '<p class="empty">No failures discovered.</p>';
  const patchHtml = patches.length
    ? patches.map((patch: any) => `<article class="entry">
        <h3 class="patch-title">${escapeHtml(patch.description || patch.ruleId || "Repair patch")}</h3>
        <p><span class="label">Verification:</span> <span class="${patch.isVerified ? "verified" : "unverified"}">${patch.isVerified ? "✅ VERIFIED" : "❌ NOT VERIFIED"}</span></p>
        <p><span class="label">Impact before:</span> ${escapeHtml(patch.beforeImpact || "Unavailable")}</p>
        <p><span class="label">Impact after:</span> ${escapeHtml(patch.afterImpact || "Unavailable")}</p>
        <p><span class="label">Proof:</span> ${escapeHtml(patch.proof || "Unavailable")}</p>
        <pre>${escapeHtml(patch.diff || "No diff supplied")}</pre>
      </article>`).join("")
    : '<p class="empty">No patches generated.</p>';
  const cssHash = hash(CSS);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${cssHash}'">
<title>Reliability Gate | ${escapeHtml(status)}</title><style>${CSS}</style></head>
<body><main><header><div class="eyebrow">Agent Autopsy / Deployment assessment</div>
<h1>Reliability gate</h1><div class="status ${statusClass}"><span class="status-mark" aria-hidden="true">${statusMark}</span><span>${escapeHtml(status)}</span></div>
<p class="reason">${escapeHtml(evidence?.reason || "No decision reason supplied.")}</p></header>
<div class="stats" aria-label="Gate evidence summary">
<div class="stat"><div class="stat-value">${escapeHtml(evidence?.experimentsRun ?? 0)}</div><div class="stat-label">Experiments</div></div>
<div class="stat"><div class="stat-value">${failures.length}</div><div class="stat-label">Discovered failures</div></div>
<div class="stat"><div class="stat-value">${patches.length}</div><div class="stat-label">Patches</div></div>
<div class="stat"><div class="stat-value">${escapeHtml(evidence?.provenFindingsTotal ?? 0)}</div><div class="stat-label">Proven findings</div></div>
</div>
<section><h2>Failure evidence</h2>${failureHtml}</section><section><h2>Repairs and verification</h2>${patchHtml}</section>
<footer class="replay">Generated ${escapeHtml(evidence?.generatedAt || "timestamp unavailable")} · ${escapeHtml(evidence?.scenariosTested ?? 0)} scenarios tested</footer>
</main></body></html>`;
}