import { createHash } from "node:crypto";

const CSS = `
*{box-sizing:border-box}:root{color-scheme:dark;--page:#111815;--ink:#eaf0e9;--muted:#a0aaa2;--line:#3b4740;--panel:#1b241e;--accent:#91d4ae;--blue:#8bcbd0}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.55 ui-monospace,"Cascadia Code",Consolas,monospace;min-height:100vh;display:flex;flex-direction:column}
header{width:min(920px,100%);margin:0 auto;padding:24px 24px 16px;border-bottom:1px solid var(--line)}
.eyebrow{font-size:10px;color:var(--blue);text-transform:uppercase}h1{font:700 24px/1.2 Georgia,"Times New Roman",serif;margin:5px 0;letter-spacing:0}.subtitle{color:var(--muted);font-size:12px}
#messages{width:min(920px,100%);margin:0 auto;padding:20px 24px;flex:1;overflow:auto;display:flex;flex-direction:column;gap:12px}
.msg{max-width:min(78%,720px);padding:11px 14px;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--line);animation:reveal .2s ease-out both}
.user{align-self:flex-end;background:#26352b;border-color:#4c6755}.assistant{align-self:flex-start;background:var(--panel)}.tool{align-self:flex-start;color:var(--blue);font-size:11px;max-width:100%;overflow-wrap:anywhere}
.error{align-self:flex-start;color:#ff9a8d;border-color:#80483f;background:#2a1b19}
form{width:min(920px,100%);margin:0 auto;padding:14px 24px 24px;border-top:1px solid var(--line);display:flex;gap:10px}
input{flex:1;min-width:0;padding:12px 13px;background:#18211c;color:var(--ink);border:1px solid var(--line);font:inherit;border-radius:3px}input:focus{outline:2px solid var(--blue);outline-offset:1px}
button{padding:10px 18px;background:var(--accent);color:#102016;border:0;border-radius:3px;font:700 13px ui-monospace,"Cascadia Code",Consolas,monospace;cursor:pointer}button:disabled{opacity:.5;cursor:wait}
@keyframes reveal{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}@media(max-width:600px){header{padding:18px 16px 12px}#messages{padding:16px}.msg{max-width:92%}form{padding:12px 16px 18px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important}}
`;

const SCRIPT = `
"use strict";
const messages=document.getElementById("messages");
const input=document.getElementById("input");
const send=document.getElementById("send");
let sessionId=null;
function addMessage(kind,text){const el=document.createElement("div");el.className="msg "+kind;el.textContent=text;messages.appendChild(el);messages.scrollTop=messages.scrollHeight;return el}
async function initialize(){const response=await fetch("/mcp",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:"initialize",id:1})});if(!response.ok)throw new Error("MCP initialization failed ("+response.status+")");const data=await response.json();sessionId=response.headers.get("Mcp-Session-Id")||(data.result&&data.result.sessionId);if(!sessionId)throw new Error("MCP server did not provide a session");send.disabled=false}
async function streamReply(text){const response=await fetch("/mcp?stream=true",{method:"POST",headers:{"Content-Type":"application/json","Accept":"text/event-stream","Mcp-Session-Id":sessionId},body:JSON.stringify({jsonrpc:"2.0",method:"agent_message",id:Date.now(),params:{text}})});if(!response.ok)throw new Error("Chat request failed ("+response.status+")");if(!response.body)throw new Error("Streaming response is unavailable");const reader=response.body.getReader();const decoder=new TextDecoder();let buffer="";let reply="";let assistant=null;while(true){const part=await reader.read();buffer+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});const rows=buffer.split("\\n");buffer=rows.pop()||"";for(const row of rows){if(!row.startsWith("data: "))continue;const payload=row.slice(6);if(payload==="[DONE]")continue;let event;try{event=JSON.parse(payload)}catch{continue}if(event.type==="tool_calls"){for(const call of event.toolCalls||[])addMessage("tool","Tool: "+call.function.name+" "+JSON.stringify(call.function.arguments||{}))}if(event.type==="reply"){reply=event.reply||"";assistant=addMessage("assistant",reply)}}if(part.done)break}if(!assistant)addMessage("assistant",reply||"No response received.")}
document.getElementById("chat-form").addEventListener("submit",async event=>{event.preventDefault();const text=input.value.trim();if(!text||!sessionId)return;input.value="";addMessage("user",text);send.disabled=true;try{await streamReply(text)}catch(error){addMessage("error",error instanceof Error?error.message:"Chat request failed")}finally{send.disabled=false;input.focus()}});
initialize().catch(error=>{addMessage("error",error instanceof Error?error.message:"Unable to connect to MCP");send.disabled=true});
`;

function hash(content: string): string {
  return createHash("sha256").update(content).digest("base64");
}

export function renderChatPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${hash(CSS)}'; script-src 'sha256-${hash(SCRIPT)}'; connect-src 'self'">
<title>Agent Autopsy | Reliability Gate</title><style>${CSS}</style></head><body>
<header><div class="eyebrow">Agent Autopsy / Reliability engineering</div><h1>System review</h1><div class="subtitle">Describe an agent system to begin an evidence-backed reliability review.</div></header>
<main id="messages" aria-live="polite" aria-label="Conversation"></main>
<form id="chat-form"><input id="input" type="text" autocomplete="off" aria-label="Describe your agent system" placeholder="Describe your AI agent system…"><button id="send" type="submit" disabled>Send</button></form>
<script>${SCRIPT.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}