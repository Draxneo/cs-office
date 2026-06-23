// =============================================================================
// admin.js — Carnes & Sons OFFICE CONSOLE (standalone web app, cs-office repo / GitHub Pages).
// Extracted from the Chrome extension's admin area. Admin/owner only. Signs in with the staff
// text-a-code flow (staff-auth-request -> extension-otp-verify), stores the token in
// localStorage('cs_token'), verifies via admin-hub {action:'me'}, then renders the admin panes.
// Talks ONLY to the shared Supabase backend over fetch — no Chrome/extension APIs.
// =============================================================================
const BASE = "https://bqsjbwwkjhrthqxgybht.supabase.co/functions/v1/";

// --- Universal voice dictation (same tool as the sidebar): record -> voice-dictate -> append text ---
const _MIC_IDLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`;
const _MIC_REC  = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
const _MIC_BUSY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" stroke-opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></path></svg>`;
const _micState = new WeakMap();
function attachMic(textareaId, micId) {
  const ta = document.getElementById(textareaId), btn = document.getElementById(micId);
  if (!ta || !btn) return;
  btn.addEventListener("click", async () => {
    const cur = _micState.get(ta);
    if (cur?.rec && cur.rec.state === "recording") { cur.rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime }); const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        btn.classList.remove("rec"); btn.classList.add("busy"); btn.innerHTML = _MIC_BUSY;
        try {
          const blob = new Blob(chunks, { type: mime });
          if (blob.size === 0) throw new Error("empty audio");
          const res = await fetch(`${BASE}voice-dictate`, { method: "POST", headers: { "Content-Type": mime }, body: await blob.arrayBuffer() });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
          const text = String(data?.text || "").trim();
          if (text) { ta.value = ta.value ? `${ta.value} ${text}` : text; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.focus(); }
        } catch (e) { alert("Voice dictation failed: " + (e?.message || e)); }
        finally { btn.classList.remove("busy"); btn.innerHTML = _MIC_IDLE; _micState.delete(ta); }
      };
      _micState.set(ta, { rec }); rec.start(); btn.classList.add("rec"); btn.innerHTML = _MIC_REC;
    } catch (e) { alert("Microphone blocked. Allow mic access for this extension page, then tap the mic again."); }
  });
  if (!btn.dataset.iconReady) { btn.innerHTML = _MIC_IDLE; btn.dataset.iconReady = "1"; }
}

let TOKEN = "";
const $ = (id) => document.getElementById(id);
// Escapes ALL HTML-dangerous chars incl. quotes — esc() output goes inside double-quoted
// attributes (value=, title=, data-*, href=) built from customer/vendor data, so " and ' MUST
// be escaped or a crafted name breaks out of the attribute (audit C2). Matches sidebar esc.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (c) => (typeof c === "number") ? "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }) : "—";
const fmtPhone = (p) => { const d = String(p || "").replace(/\D/g, "").slice(-10); return d.length === 10 ? `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}` : (p || "—"); };

function api(path, body) {
  return fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
    .then((r) => r.json().catch(() => ({})));
}
function hub(action, extra) { return api("admin-hub", Object.assign({ token: TOKEN, action }, extra || {})); }

// STANDALONE AUTH (cs-office): this console is its own web app, so it can't borrow the extension's
// token. It signs in with the SAME staff text-a-code flow as the PWA (staff-auth-request ->
// extension-otp-verify) and stores the token in localStorage('cs_token'). admin-hub('me') validates
// the token + admin/owner role exactly as before. wireLogin() runs the phone/code UI.
let LOGIN_PHONE = "";
function showLogin(msg) {
  $("app").style.display = "none";
  $("deny").classList.add("hide");
  const lg = $("login"); if (lg) lg.classList.remove("hide");
  if (msg) $("loginErr").textContent = msg;
}
function doSignOut() { try { localStorage.removeItem("cs_token"); localStorage.removeItem("cs_name"); } catch (_e) {} location.reload(); }
function wireLogin() {
  const send = $("sendBtn"), verify = $("verifyBtn"), back = $("backBtn");
  if (send) send.addEventListener("click", async () => {
    let p = ($("phone").value || "").trim(); if (!p) { $("loginErr").textContent = "Enter your phone number."; return; }
    if (p.indexOf("+") !== 0) { const d = p.replace(/[^0-9]/g, ""); p = (d.length === 10 ? "+1" + d : "+" + d); }
    LOGIN_PHONE = p; $("loginErr").textContent = ""; send.disabled = true; send.textContent = "Sending…";
    const r = await api("staff-auth-request", { phone: p });
    send.disabled = false; send.textContent = "Text me a code";
    if (r && r.ok) { $("step1").classList.add("hide"); $("step2").classList.remove("hide"); $("loginMsg").textContent = "Enter the code we texted to " + p; $("code").focus(); }
    else $("loginErr").textContent = (r && r.error) || "Couldn't send a code.";
  });
  if (verify) verify.addEventListener("click", async () => {
    const c = ($("code").value || "").trim(); if (!c) { $("loginErr").textContent = "Enter the code."; return; }
    $("loginErr").textContent = ""; verify.disabled = true; verify.textContent = "Signing in…";
    const r = await api("extension-otp-verify", { phone: LOGIN_PHONE, code: c });
    verify.disabled = false; verify.textContent = "Sign in";
    if (r && r.token) { try { localStorage.setItem("cs_token", r.token); localStorage.setItem("cs_name", r.employee_name || ""); } catch (_e) {} location.reload(); }
    else $("loginErr").textContent = (r && r.error) || "Invalid code.";
  });
  if (back) back.addEventListener("click", () => { $("step2").classList.add("hide"); $("step1").classList.remove("hide"); $("loginMsg").textContent = "Sign in with your staff phone number."; $("loginErr").textContent = ""; });
  const so = $("signout"); if (so) so.addEventListener("click", doSignOut);
  const dlo = $("denyLogout"); if (dlo) dlo.addEventListener("click", (e) => { e.preventDefault(); doSignOut(); });
}

async function boot() {
  wireLogin();
  try { TOKEN = localStorage.getItem("cs_token") || ""; } catch (_e) { TOKEN = ""; }
  if (!TOKEN) { showLogin(); return; }              // no token -> sign in
  const me = await hub("me");
  if (!me || !me.is_admin) {                          // token invalid or not an admin
    if (me && me.error) { showLogin("Your session expired — sign in again."); return; }
    $("login").classList.add("hide"); $("deny").classList.remove("hide"); return;
  }
  $("login").classList.add("hide");
  $("who").textContent = (me.name || "Admin") + " · " + (me.role || "");
  const so = $("signout"); if (so) so.style.display = "";
  $("app").style.display = "flex";
  document.querySelectorAll("nav.side button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("nav.side button").forEach((x) => x.classList.toggle("active", x === b));
    render(b.dataset.pane);
  }));
  render("dashboard");
}

function navTo(pane) { document.querySelectorAll("nav.side button").forEach((b) => b.classList.toggle("active", b.dataset.pane === pane)); render(pane); }

function render(pane) {
  if (pane === "dashboard") return renderDashboard();
  if (pane === "ivr") return renderIvr();
  if (pane === "autosms") return renderAutoSms();
  if (pane === "lineitems") return renderLineItems();
  if (pane === "membership") return renderMembership();
  if (pane === "finance") return renderFinance();
  if (pane === "margins") return renderMargins();
  if (pane === "repairtiers") return renderRepairTiers();
  if (pane === "team") return renderTeam();
  if (pane === "tools") return renderTools();
  if (pane === "sounds") return renderSounds();
  if (pane === "equipment") return renderEquipment();
  if (pane === "proposals") return renderProposals();
  if (pane === "email") return renderEmail();
  if (pane === "cleanup") return renderCleanup();
  if (pane === "health") return renderHealth();
  if (pane === "photos") return renderPhotos();
  if (pane === "leads") return renderLeads();
  if (pane === "aps") return renderAps();
  if (pane === "rebates") return renderRebates();
  if (pane === "pricebook") return renderPricebook();
  if (pane === "apilog") return renderApiLog();
  if (pane === "callsearch") return renderCallSearch();
  if (pane === "installs") return renderInstalls();
  if (pane === "installtodo") return renderInstallTodo();
}

// ---- Installs tracker — per-install checklist (install_steps via the install-tracker fn) ----
// Lists every install (job >= $4,999) and where it stands across the 8 standard steps. Each step is
// editable inline (status / owner / due date / note); saves go straight to the backend so the brain
// + PWA see the same data instantly. Reads/writes the SAME install-tracker fn the AI brain uses.
let instState = { scope: "open", step: "", status: "", openJob: null };
function instApi(action, extra) { return api("install-tracker", Object.assign({ token: TOKEN, action }, extra || {})); }
const INST_STATUS = [["not_started", "Not started"], ["in_progress", "In progress"], ["done", "Done"], ["na", "N/A"]];
const INST_STEP_OPTS = [["equipment_ordered", "Equipment ordered"], ["jurisdiction_check", "Jurisdiction check"], ["permit_pulled", "Permit pulled"], ["quality_control", "Quality control"], ["walkthrough", "Walkthrough"], ["city_inspection", "City inspection"], ["cps_rebate", "CPS rebate paperwork"], ["warranty_registration", "Warranty registration"]];
const instStColor = (s) => s === "done" ? "#34d399" : s === "in_progress" ? "#fbbf24" : s === "na" ? "#64748b" : "#f87171";

async function renderInstalls() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">Installs &#127959;</h2>
    <p class="sub">Every install (job $4,999+) and where it stands &mdash; equipment, permit, QC, walkthrough, city inspection, CPS rebate, warranty. Click an install to update any step.</p>
    <div class="saverow" style="flex-wrap:wrap;gap:8px">
      <label class="muted">Show <select id="in-scope" style="padding:4px"><option value="open">Open (unfinished)</option><option value="all">All</option></select></label>
      <label class="muted">Step <select id="in-step" style="padding:4px"><option value="">Any</option>${INST_STEP_OPTS.map((s) => `<option value="${s[0]}">${s[1]}</option>`).join("")}</select></label>
      <label class="muted">Status <select id="in-status" style="padding:4px"><option value="">Any</option>${INST_STATUS.map((s) => `<option value="${s[0]}">${s[1]}</option>`).join("")}</select></label>
      <button class="btn" id="in-refresh">Refresh</button>
      <span class="muted" id="in-msg"></span>
    </div>
    <div id="in-body" style="margin-top:12px"><div class="muted">Loading&#8230;</div></div>`;
  $("in-scope").value = instState.scope; $("in-step").value = instState.step; $("in-status").value = instState.status;
  const reload = () => { instState.scope = $("in-scope").value; instState.step = $("in-step").value; instState.status = $("in-status").value; loadInstalls(); };
  $("in-refresh").addEventListener("click", reload);
  ["in-scope", "in-step", "in-status"].forEach((id) => $(id).addEventListener("change", reload));
  loadInstalls();
}

async function loadInstalls() {
  const el = $("in-body");
  el.innerHTML = `<div class="muted">Loading&#8230;</div>`;
  const d = await instApi("list", { scope: instState.scope, step: instState.step, status: instState.status });
  if (!d || !d.ok) { el.innerHTML = `<div class="card"><div class="muted">${esc((d && d.error) || "Couldn't load installs")}</div></div>`; return; }
  if (!(d.installs || []).length) { el.innerHTML = `<div class="card"><div class="muted">No installs match these filters. &#10003;</div></div>`; return; }
  const summary = `<div class="muted" style="margin-bottom:8px">${d.count} install(s) &middot; ${d.overdue_installs || 0} with overdue steps</div>`;
  el.innerHTML = summary + d.installs.map(renderInstallCard).join("");
  // expand/collapse a card
  el.querySelectorAll("[data-in-open]").forEach((c) => c.addEventListener("click", () => {
    const jid = c.getAttribute("data-in-open");
    instState.openJob = instState.openJob === jid ? null : jid;
    loadInstalls();
  }));
  // save one step
  el.querySelectorAll("[data-save-step]").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const row = b.closest("[data-step-row]");
    const payload = {
      hcp_job_id: row.getAttribute("data-job"),
      step_key: row.getAttribute("data-step"),
      status: row.querySelector('[data-f="status"]').value,
      owner: row.querySelector('[data-f="owner"]').value,
      due_date: row.querySelector('[data-f="due"]').value,
      note: row.querySelector('[data-f="note"]').value,
    };
    b.disabled = true; b.textContent = "Saving…";
    const r = await instApi("update_step", payload);
    if (r && r.ok) { $("in-msg").textContent = "Saved ✓"; loadInstalls(); }
    else { b.disabled = false; b.textContent = "Save"; alert("Save failed: " + ((r && r.error) || "error")); }
  }));
  el.querySelectorAll("[data-open-rebate]").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); navTo("rebates"); }));
}

function renderInstallCard(i) {
  const open = instState.openJob === i.hcp_job_id;
  const bar = `<div style="background:#1f2937;border-radius:6px;height:8px;overflow:hidden;flex:1"><div style="width:${i.pct}%;height:100%;background:${i.pct === 100 ? "#34d399" : "#3b82f6"}"></div></div>`;
  const overdue = i.overdue_steps > 0 ? `<span style="color:#f87171;font-size:11px;font-weight:700">&#9888; ${i.overdue_steps} overdue</span>` : "";
  const head = `<div data-in-open="${i.hcp_job_id}" style="cursor:pointer;padding:10px;display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
        <div><strong>${esc(i.customer || "(unknown)")}</strong> <span class="muted" style="font-size:12px">&middot; Job ${esc(i.job || "?")} &middot; ${esc(i.total || "")}</span></div>${overdue}
      </div>
      <div class="muted" style="font-size:12px">${esc(i.address || "")}</div>
      <div style="display:flex;align-items:center;gap:8px"><span class="muted" style="font-size:12px;min-width:42px">${esc(i.progress)}</span>${bar}<span class="muted" style="font-size:12px">${i.pct}%</span></div>
      ${!open && i.next_open ? `<div style="font-size:12px;color:#cbd5e1">Next: ${esc(i.next_open)}</div>` : ""}
    </div>`;
  const body = open ? `<div style="padding:0 10px 6px">${(i.steps || []).map((s) => renderStepRow(i.hcp_job_id, s)).join("")}</div>` : "";
  return `<div class="card" style="padding:0;margin-bottom:10px">${head}${body}</div>`;
}

function renderStepRow(jid, s) {
  return `<div data-step-row data-job="${jid}" data-step="${s.step_key}" style="padding:8px 2px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:6px;align-items:center">
      <span style="width:9px;height:9px;border-radius:50%;background:${instStColor(s.status)};flex:none"></span>
      <span style="min-width:148px;font-weight:600">${esc(s.label)}${s.overdue ? ' <span style="color:#f87171">&#9888;</span>' : ""}</span>
      <select data-f="status" style="padding:3px">${INST_STATUS.map((o) => `<option value="${o[0]}"${o[0] === s.status ? " selected" : ""}>${o[1]}</option>`).join("")}</select>
      <input data-f="owner" placeholder="Owner" value="${esc(s.owner || "")}" style="width:90px;padding:3px"/>
      <input data-f="due" type="date" value="${s.due_date || ""}" style="padding:3px"/>
      <input data-f="note" placeholder="Note" value="${esc(s.note || "")}" style="flex:1;min-width:120px;padding:3px"/>
      ${s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener" class="btn" style="padding:3px 8px">Register &#8599;</a>` : ""}
      ${(s.step_key === "cps_rebate" && s.status !== "na") ? `<button class="btn" data-open-rebate style="padding:3px 8px">Rebate</button>` : ""}
      <button class="btn" data-save-step style="padding:3px 10px">Save</button>
    </div>`;
}

// ---- Install To-Do — flat worklist of every outstanding step across installs (install-tracker 'todo') ----
// Same data the PWA To-Do tab + the AI brain use. Grouped by install, overdue first; change a step's
// status inline (auto-saves). The "Installs" view is for full detail; this is the quick "what's left" list.
let instTodoOverdue = false;
async function renderInstallTodo() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">Install To-Do &#9989;</h2>
    <p class="sub">Everything still outstanding across your installs, grouped by job, overdue first. Change any step's status right here &mdash; it saves instantly.</p>
    <div class="saverow" style="gap:12px">
      <label class="muted" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="td-overdue"${instTodoOverdue ? " checked" : ""}/> Overdue only</label>
      <button class="btn" id="td-refresh">Refresh</button>
      <span class="muted" id="td-msg"></span>
    </div>
    <div id="td-body" style="margin-top:12px"><div class="muted">Loading&#8230;</div></div>`;
  $("td-refresh").addEventListener("click", loadInstallTodo);
  $("td-overdue").addEventListener("change", () => { instTodoOverdue = $("td-overdue").checked; loadInstallTodo(); });
  loadInstallTodo();
}

async function loadInstallTodo() {
  const el = $("td-body");
  el.innerHTML = `<div class="muted">Loading&#8230;</div>`;
  const d = await instApi("todo", { overdue_only: instTodoOverdue });
  if (!d || !d.ok) { el.innerHTML = `<div class="card"><div class="muted">${esc((d && d.error) || "Couldn't load the to-do list")}</div></div>`; return; }
  if (!(d.items || []).length) { el.innerHTML = `<div class="card"><div class="muted">Nothing outstanding${instTodoOverdue ? " is overdue" : ""}. &#10003;</div></div>`; return; }
  const groups = {}; const order = [];
  d.items.forEach((i) => { if (!groups[i.hcp_job_id]) { groups[i.hcp_job_id] = { job: i.job, customer: i.customer, address: i.address, steps: [], overdue: 0 }; order.push(i.hcp_job_id); } groups[i.hcp_job_id].steps.push(i); if (i.overdue) groups[i.hcp_job_id].overdue++; });
  const summary = `<div class="muted" style="margin-bottom:8px">${d.count} step(s) across ${order.length} install(s)${d.overdue_count ? ` &middot; ${d.overdue_count} overdue` : ""}</div>`;
  el.innerHTML = summary + order.map((k) => {
    const g = groups[k];
    return `<div class="card" style="padding:10px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div><strong>${esc(g.customer || "(unknown)")}</strong> <span class="muted" style="font-size:12px">&middot; Job ${esc(g.job || "?")}</span></div>${g.overdue ? `<span style="color:#f87171;font-size:11px;font-weight:700">&#9888; ${g.overdue} overdue</span>` : ""}</div>
      ${g.address ? `<div class="muted" style="font-size:12px;margin:2px 0 6px">${esc(g.address)}</div>` : ""}
      ${g.steps.map((s) => todoRow(k, s)).join("")}
    </div>`;
  }).join("");
  el.querySelectorAll("[data-td-status]").forEach((sel) => sel.addEventListener("change", async () => {
    const jid = sel.getAttribute("data-job"), sk = sel.getAttribute("data-step");
    sel.disabled = true;
    const r = await instApi("update_step", { hcp_job_id: jid, step_key: sk, status: sel.value });
    if (r && r.ok) { $("td-msg").textContent = "Saved ✓"; loadInstallTodo(); }
    else { sel.disabled = false; alert("Save failed: " + ((r && r.error) || "error")); }
  }));
  // "Open rebate tool" jumps to the Rebates pane (enter the job # there to build the CPS form).
  el.querySelectorAll("[data-open-rebate]").forEach((b) => b.addEventListener("click", () => navTo("rebates")));
}

function todoRow(jid, s) {
  // Auto-filled helpers from the enrichment engine: warranty link (clickable), CPS rebate shortcut,
  // and the note (jurisdiction result / rebate eligibility) shown under the step.
  const link = s.link ? ` <a href="${esc(s.link)}" target="_blank" rel="noopener" class="btn" style="padding:2px 8px;font-size:12px">Register &#8599;</a>` : "";
  const rebate = (s.step_key === "cps_rebate" && s.status !== "na") ? ` <button class="btn" data-open-rebate style="padding:2px 8px;font-size:12px">Open rebate tool</button>` : "";
  const info = (s.note || link || rebate) ? `<div style="padding:0 0 6px 17px;font-size:12px;color:#cbd5e1;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span>${esc(s.note || "")}</span>${link}${rebate}</div>` : "";
  return `<div style="border-top:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0">
        <span style="width:9px;height:9px;border-radius:50%;background:${instStColor(s.status)};flex:none"></span>
        <span style="flex:1">${esc(s.label)}${s.due_date ? ` <span class="muted" style="font-size:11px">due ${esc(s.due_date)}</span>` : ""}${s.overdue ? ' <span style="color:#f87171">&#9888;</span>' : ""}</span>
        <select data-td-status data-job="${jid}" data-step="${s.step_key}" style="padding:3px">${INST_STATUS.map((o) => `<option value="${o[0]}"${o[0] === s.status ? " selected" : ""}>${o[1]}</option>`).join("")}</select>
      </div>${info}
    </div>`;
}

// ---- Automatic texts — master switch + editable templates/toggles (auto_sms_config) ----
function asApi(action, extra) { return api("auto-sms-config", Object.assign({ token: TOKEN, action }, extra || {})); }
async function renderAutoSms() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">Automatic texts</h2>
    <p class="sub">Texts that go out on their own. Flip the master switch off to silence all of them instantly. Edit any wording below and hit Save — changes take effect right away, no reinstall.</p>
    <div id="as-body" class="sub">Loading…</div>`;
  let rows = [];
  try { const r = await asApi("list"); rows = (r && r.rows) || []; }
  catch (_e) { $("as-body").innerHTML = `<div class="sub">Couldn't load settings. Try again.</div>`; return; }
  const master = rows.find((x) => x.kind === "master") || { kind: "master", enabled: false };
  const rules = rows.filter((x) => x.kind !== "master").sort((a, b) => (a.sort || 0) - (b.sort || 0));

  const sw = (on, id) => `<button class="as-switch${on ? " on" : ""}" data-sw="${id}" role="switch" aria-checked="${on}"
      style="position:relative;width:48px;height:26px;border-radius:13px;border:none;cursor:pointer;flex:none;background:${on ? "var(--accent)" : "#55585f"}">
      <span style="position:absolute;top:3px;left:${on ? "25px" : "3px"};width:20px;height:20px;border-radius:50%;background:#fff;transition:left .12s"></span></button>`;

  $("as-body").innerHTML = `
    <div class="card" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;margin-bottom:16px;background:${master.enabled ? "rgba(52,211,238,.08)" : "rgba(244,63,94,.08)"}">
      ${sw(!!master.enabled, "master")}
      <div><div style="font-weight:700;font-size:15px">Master switch — all automatic texts</div>
      <div class="sub" style="margin:2px 0 0">${master.enabled ? "ON — the rules below are active." : "OFF — nothing sends, no matter the rule settings below."}</div></div>
    </div>
    <div class="sub" style="margin:0 0 6px">Tokens you can use in a message: <b>{name}</b> (customer first name), <b>{window}</b> (appointment day/time, booking text), <b>{time}</b> (reminder time), <b>{eta}</b> (live drive-time, on-the-way texts), <b>{review_link}</b> (your Google review link).</div>
    <div class="sub" style="margin:0 0 12px;font-size:11.5px;opacity:.8">Each card below says exactly when it sends. Most fire instantly off a Housecall Pro action or a phone event; a couple run on a clock (Central time). Safety nets: a customer never gets two auto-texts within 2 minutes of each other, never the same type twice in 24 hours, and we never text a known landline or anyone who replied STOP. (The old 10-minute blanket window was silently eating legit texts — e.g. an on-my-way right after a confirmation — so it's now 2 minutes, same-type duplicates still blocked for 24h.)</div>
    ${rules.map((r) => `
      <div class="card" data-rule="${esc(r.kind)}" style="border:1px solid var(--line);border-radius:12px;padding:13px 15px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:${r.help ? "6px" : "8px"}">
          ${sw(!!r.enabled, r.kind)}
          <div style="font-weight:700;font-size:14px">${esc(r.label || r.kind)}</div>
        </div>
        ${r.help ? `<div class="sub" style="margin:0 0 9px;font-size:12px;line-height:1.45;opacity:.85">${esc(r.help)}</div>` : ""}
        <textarea data-tpl="${esc(r.kind)}" rows="3" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--text);font:inherit;font-size:13px;resize:vertical">${esc(r.template || "")}</textarea>
      </div>`).join("")}
    <div style="display:flex;align-items:center;gap:12px;margin-top:6px">
      <button id="as-save" class="primary" style="padding:10px 20px">Save changes</button>
      <span id="as-status" class="sub"></span>
    </div>`;

  // local working copy of enabled flags so toggles persist until Save (master saves instantly)
  const enabledState = {}; rules.forEach((r) => { enabledState[r.kind] = !!r.enabled; });

  main.querySelectorAll("[data-sw]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.getAttribute("data-sw");
    const now = b.classList.toggle("on");
    b.style.background = now ? "var(--accent)" : "#55585f";
    b.querySelector("span").style.left = now ? "25px" : "3px";
    b.setAttribute("aria-checked", String(now));
    if (id === "master") {
      // kill-switch saves immediately
      try { await asApi("save", { rows: [{ kind: "master", enabled: now }] }); renderAutoSms(); } catch (_e) { alert("Couldn't save the master switch."); }
    } else { enabledState[id] = now; }
  }));

  $("as-save").addEventListener("click", async () => {
    const out = rules.map((r) => ({ kind: r.kind, enabled: enabledState[r.kind], template: (main.querySelector(`[data-tpl="${r.kind}"]`) || {}).value || "" }));
    $("as-status").textContent = "Saving…";
    try { await asApi("save", { rows: out }); $("as-status").textContent = "Saved ✓"; setTimeout(() => { const s = $("as-status"); if (s) s.textContent = ""; }, 2000); }
    catch (_e) { $("as-status").textContent = "Couldn't save."; }
  });
}

// ---- Dashboard (landing) — overview + grouped quick-access to every section ----
function dashTile(pane, ic, t, d) { return `<button class="tile" data-go="${pane}"><div class="ic">${ic}</div><div class="t">${t}</div><div class="d">${d}</div></button>`; }
function statChip(color, label) { return `<span class="chiplive"><span class="dot2" style="background:${color}"></span>${esc(label)}</span>`; }
function renderDashboard() {
  const main = $("main");
  const name = String(($("who").textContent || "").split("·")[0] || "").trim() || "there";
  main.innerHTML = `<h2 class="sec">Welcome${name && name !== "there" ? ", " + esc(name.split(" ")[0]) : ""} 👋</h2>
    <p class="sub">Your admin console. Jump to anything below — what needs your attention is flagged up top.</p>
    <div class="statusrow" id="dash-status"><span class="chiplive muted"><span class="dot2" style="background:var(--faint)"></span>Checking status…</span></div>
    <div class="tilegroup">Workspace</div>
    <div class="tiles">${dashTile("email", "📧", "Email", "Vendor invoices, permits &amp; HCP money — clean branded cards")}${dashTile("equipment", "🔧", "Equipment", "Serial numbers pulled from invoices, ready to approve")}${dashTile("proposals", "📝", "Proposals", "Equipment options your techs presented — push to a real estimate")}</div>
    <div class="tilegroup">Phone</div>
    <div class="tiles">${dashTile("ivr", "📞", "Phone &amp; IVR", "Greeting, hours, routing, voicemail")}${dashTile("sounds", "🔔", "Notification sounds", "Inbox chime + custom upload")}</div>
    <div class="tilegroup">Sales &amp; money</div>
    <div class="tiles">${dashTile("margins", "📊", "Pricing", "Profit per matchup — cost+tax vs your live sell price; edit prices")}${dashTile("repairtiers", "🔧", "Repair tiers", "Repair level pricing the presentation app + brain use")}${dashTile("finance", "💳", "Financing", "Monthly-payment calculator + plans")}${dashTile("lineitems", "🧾", "Booking line items", "Default charges per booking type")}${dashTile("membership", "⭐", "Comfort Club", "Membership stats + tag sync")}</div>
    <div class="tilegroup">People</div>
    <div class="tiles">${dashTile("installtodo", "&#9989;", "Install To-Do", "Quick list of everything still outstanding across your installs")}${dashTile("installs", "&#127959;", "Installs", "Track every install — equipment, permit, QC, walkthrough, inspection, CPS rebate, warranty")}</div>
    <div class="tiles">${dashTile("team", "👷", "Team", "Technicians + phone re-sync")}</div>
    <div class="tilegroup">System</div>
    <div class="tiles">${dashTile("tools", "🧰", "Claude's tools", "Everything the AI can do")}${dashTile("cleanup", "🧹", "Cleanup", "Suggested old data to prune")}${dashTile("health", "&#10084;", "Health", "Heartbeat + recent errors")}${dashTile("photos", "&#128247;", "Photos", "Every texted-in photo, by date")}</div>
    <div class="tilegroup">Work in progress</div>
    <div class="tiles"><a class="tile" href="https://draxneo.github.io/cs-present/" target="_blank" rel="noopener"><div class="ic">🛠️</div><div class="t">Presentation Tool</div><div class="d">Repair + replacement presentation (in-home)</div></a><a class="tile" href="https://draxneo.github.io/cs-present/preview.html" target="_blank" rel="noopener"><div class="ic">📱</div><div class="t">Device Simulator</div><div class="d">Preview the tool at phone &amp; tablet sizes</div></a></div>
    <div class="tilegroup">Install on a tablet</div>
    <div class="card" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
      <div style="background:#fff;padding:8px;border-radius:12px;line-height:0;flex:0 0 auto"><svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 31 31" shape-rendering="crispEdges"><path fill="#ffffff" d="M0 0h31v31H0z"/><path stroke="#000000" d="M1 1.5h7m2 0h3m1 0h8m1 0h7M1 2.5h1m5 0h1m3 0h1m2 0h4m1 0h1m3 0h1m5 0h1M1 3.5h1m1 0h3m1 0h1m2 0h1m4 0h1m2 0h3m2 0h1m1 0h3m1 0h1M1 4.5h1m1 0h3m1 0h1m3 0h2m1 0h1m1 0h2m1 0h2m2 0h1m1 0h3m1 0h1M1 5.5h1m1 0h3m1 0h1m3 0h2m2 0h5m3 0h1m1 0h3m1 0h1M1 6.5h1m5 0h1m1 0h2m2 0h1m2 0h1m3 0h1m2 0h1m5 0h1M1 7.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M10 8.5h1m1 0h3m3 0h2m1 0h1M1 9.5h1m2 0h1m1 0h2m1 0h2m1 0h2m1 0h3m3 0h2m1 0h1M1 10.5h2m2 0h1m2 0h3m1 0h3m2 0h1m3 0h3m2 0h1m2 0h1M1 11.5h1m1 0h1m2 0h4m4 0h2m1 0h2m1 0h4m1 0h4M3 12.5h1m1 0h1m3 0h1m1 0h1m2 0h1m1 0h2m1 0h5m1 0h1m1 0h2M1 13.5h1m1 0h1m3 0h1m4 0h1m2 0h1m1 0h8m1 0h1m1 0h2M5 14.5h1m2 0h1m2 0h1m1 0h3m4 0h3M4 15.5h1m2 0h1m2 0h3m1 0h2m6 0h2m1 0h5M1 16.5h1m7 0h3m1 0h1m4 0h4m2 0h1m1 0h1m1 0h1M2 17.5h4m1 0h2m2 0h4m2 0h2m1 0h1m1 0h1m5 0h1M2 18.5h1m7 0h2m2 0h2m1 0h1m4 0h3m1 0h1m2 0h1M1 19.5h1m1 0h1m1 0h1m1 0h3m2 0h1m2 0h1m2 0h2m2 0h1m5 0h2M4 20.5h2m2 0h2m2 0h1m2 0h2m1 0h2m4 0h1m3 0h2M1 21.5h1m3 0h1m1 0h1m1 0h2m2 0h1m3 0h1m2 0h6m1 0h1M9 22.5h1m5 0h1m1 0h5m3 0h1m1 0h3M1 23.5h7m3 0h1m6 0h2m1 0h1m1 0h1m1 0h1m2 0h1M1 24.5h1m5 0h1m1 0h2m1 0h1m2 0h1m3 0h1m1 0h1m3 0h3M1 25.5h1m1 0h3m1 0h1m2 0h1m7 0h2m1 0h5m2 0h2M1 26.5h1m1 0h3m1 0h1m1 0h3m1 0h2m5 0h4m1 0h4M1 27.5h1m1 0h3m1 0h1m2 0h1m3 0h1m2 0h2m1 0h1m4 0h3m1 0h1M1 28.5h1m5 0h1m3 0h3m1 0h2m1 0h4m1 0h2m3 0h1M1 29.5h7m1 0h7m1 0h2m2 0h1m1 0h4m1 0h1"/></svg></div>
      <div style="flex:1;min-width:210px;font-size:13px;line-height:1.6">
        <div style="font-weight:800;font-size:15px">&#128242; Install the Tech Quoter</div>
        <div style="margin-top:4px">Scan with the tablet camera, then add it to the home screen so it opens full-screen like an app.</div>
        <div style="margin-top:8px"><b>Android (Chrome):</b> open in Chrome &rarr; menu (&#8942;) &rarr; <b>Install app</b> / <b>Add to Home screen</b>.</div>
        <div><b>iPad (Safari):</b> open in Safari &rarr; Share &rarr; <b>Add to Home Screen</b>.</div>
        <div class="faint" style="margin-top:6px">draxneo.github.io/cs-present</div>
      </div>
    </div>`;
  main.querySelectorAll(".tile[data-go]").forEach((t) => t.addEventListener("click", () => navTo(t.getAttribute("data-go"))));
  loadDashStatus();
}
async function loadDashStatus() {
  const row = $("dash-status"); if (!row) return;
  const chips = [];
  try { const eq = await hub("equipment_list"); const n = (eq.pending || []).length; chips.push(statChip(n ? "#fbbf24" : "#34d399", n ? `${n} equipment to review` : "Equipment queue clear")); } catch (_e) {}
  try { const em = await emailApi("list"); chips.push(statChip("#34d3ee", `${(em.emails || []).length} emails cached`)); } catch (_e) {}
  try { const cl = await api("cleanup", { token: TOKEN, mode: "suggest" }); const n = (cl.suggested || []).length; chips.push(statChip(n ? "#fbbf24" : "#34d399", n ? `${n} cleanup suggestion${n > 1 ? "s" : ""}` : "Storage lean")); } catch (_e) {}
  try { const h = await api("health-check", { token: TOKEN, action: "status" }); const last = h && h.last; const dead = (h && h.dead) || 0; const stale = last ? (Date.now() - new Date(last.checked_at).getTime() > 20*60*1000) : true; chips.push(statChip((dead || stale) ? "#fbbf24" : "#34d399", dead ? (dead + " failed action" + (dead>1?"s":"")) : (stale ? "Heartbeat stale" : "All systems green"))); } catch (_e) {}
  if (row) row.innerHTML = chips.join("") || "";
}

// ---- Cleanup suggestions (admin) — proposes prunable data; deletes only on approval ----
async function renderCleanup() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">Cleanup</h2>
    <p class="sub">Suggestions for trimming old, low-value data so the app stays fast. Nothing is deleted until you approve it here. Your records, email cards, and equipment registry are always kept.</p>
    <div class="saverow"><button class="btn" id="cl-refresh">Re-scan</button> <span class="muted" id="cl-status"></span></div>
    <div id="cl-list" style="margin-top:12px"><div class="muted">Scanning…</div></div>`;
  $("cl-refresh").addEventListener("click", renderCleanup);
  const d = await api("cleanup", { token: TOKEN, mode: "suggest" });
  const el = $("cl-list");
  if (d.error) { el.innerHTML = `<div class="card"><div class="muted">${esc(d.error)}</div></div>`; return; }
  const items = d.suggested || [];
  if (!items.length) { el.innerHTML = `<div class="card"><div class="muted">✨ Nothing to clean up — your data is lean.</div></div>`; return; }
  el.innerHTML = `<div class="card">${items.map((it) => `<label style="display:flex;align-items:center;gap:11px;padding:10px 2px;border-top:1px solid var(--line);cursor:pointer"><input type="checkbox" class="cl-chk" value="${esc(it.key)}" checked style="width:16px;height:16px;flex:none"/><div style="flex:1">${esc(it.label)}</div></label>`).join("")}
    <div class="saverow" style="margin-top:14px"><button class="btn primary" id="cl-apply">🧹 Clean up selected</button><span class="saved" id="cl-saved">Cleaned ✓</span></div></div>`;
  $("cl-apply").addEventListener("click", async () => {
    const keys = [...main.querySelectorAll(".cl-chk:checked")].map((c) => c.value);
    if (!keys.length) { alert("Pick at least one thing to clean up."); return; }
    if (!confirm("Permanently remove the selected data? Your records, cards, and registry are kept.")) return;
    const btn = $("cl-apply"); btn.disabled = true; btn.textContent = "Cleaning…";
    const r = await api("cleanup", { token: TOKEN, mode: "apply", categories: keys });
    if (r && r.ok) { renderCleanup(); } else { btn.disabled = false; btn.textContent = "🧹 Clean up selected"; alert("Failed: " + ((r && r.error) || "error")); }
  });
}

// ---- Email reader (admin) — renders OUR OWN beautiful, vendor-branded card built from
// Claude-parsed structured data (admin-email). We never render the sender's HTML; the
// "View original" toggle shows it in a sandboxed iframe only on request. Each vendor = theme.
function emailApi(action, extra) { return api("admin-email", Object.assign({ token: TOKEN, action }, extra || {})); }
function emailSender(f) { const m = String(f || "").match(/^\s*"?([^"<]+?)"?\s*</); return ((m ? m[1] : String(f || "").replace(/[<>]/g, "")).trim()) || f || ""; }
function emailDate(d) { try { const dt = new Date(d); if (isNaN(dt)) return d || ""; return dt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return d || ""; } }

const VENDOR_THEMES = [
  { re: /daikin/i, name: "Daikin", accent: "#e0322e", glyph: "❄️" },          // red
  { re: /carrier/i, name: "Carrier", accent: "#1273d4", glyph: "💠" },         // blue
  { re: /century/i, name: "Century HVAC", accent: "#1273d4", glyph: "🅒" },    // Carrier distributor -> blue
  { re: /madden|rmadden/i, name: "Robert Madden", accent: "#13a594", glyph: "🧰" }, // teal
  { re: /johnstone/i, name: "Johnstone Supply", accent: "#7b8794", glyph: "🔩" },   // gray
  { re: /housecall/i, name: "Housecall Pro", accent: "#2f4fd0", glyph: "🏠" }, // cobalt
];
function emailTheme(e) {
  const hay = ((e.vendor || "") + " " + (e.from || e.from_name || "") + " " + (e.subject || "")).toLowerCase();
  for (const t of VENDOR_THEMES) if (t.re.test(hay)) return t;
  if ((e.category || "") === "permit" || /sanantonio|permit|development services/i.test(hay)) return { name: "City of San Antonio", accent: "#ed7a1c", glyph: "🏛️" };
  if ((e.category || "") === "hcp") return { name: "Housecall Pro", accent: "#2f4fd0", glyph: "🏠" };
  return { name: e.vendor || e.cat_title || "Email", accent: "#7c8aa0", glyph: e.icon || "📧" };
}
function emailFieldsHtml(fields) {
  if (!Array.isArray(fields) || !fields.length) return "";
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin-top:14px">` + fields.slice(0, 6).map((f) => `<div><div class="muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em">${esc(f.label || "")}</div><div style="font-weight:600;margin-top:1px">${esc(f.value || "")}</div></div>`).join("") + `</div>`;
}
function emailItemsHtml(items, accent) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<div style="margin-top:16px"><div class="muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Items</div>` + items.slice(0, 8).map((it) => `<div style="display:flex;gap:9px;padding:8px 0;border-top:1px solid var(--line)"><span style="color:${accent};flex:none">▪</span><div><div style="font-weight:600">${esc(it.name || "")}</div>${it.detail ? `<div class="muted" style="font-size:12px">${esc(it.detail)}</div>` : ""}</div></div>`).join("") + `</div>`;
}
function emailCardHtml(p, th) {
  p = p || {};
  return `<div class="card" style="overflow:hidden;padding:0;border:1px solid var(--line)">
    <div style="background:${th.accent};padding:14px 18px;display:flex;align-items:center;gap:11px;color:#fff">
      <span style="font-size:22px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))">${th.glyph}</span>
      <div style="flex:1;min-width:0"><div style="font-weight:800;font-size:15px">${esc(th.name)}</div>${p.doc_type ? `<div style="opacity:.9;font-size:12px">${esc(p.doc_type)}</div>` : ""}</div>
      ${p.amount ? `<div style="background:rgba(255,255,255,.2);padding:6px 13px;border-radius:10px;font-weight:800;font-size:16px;white-space:nowrap">${esc(p.amount)}</div>` : ""}
    </div>
    <div style="padding:16px 18px">
      ${p.headline ? `<div style="font-size:18px;font-weight:700;line-height:1.25">${esc(p.headline)}</div>` : ""}
      ${(p.date || p.due) ? `<div class="muted" style="font-size:12px;margin-top:4px">${[p.date ? "📅 " + esc(p.date) : "", p.due ? "⏰ Due " + esc(p.due) : ""].filter(Boolean).join("  ·  ")}</div>` : ""}
      ${p.summary ? `<div style="margin-top:13px;background:var(--surface2,#1a2436);border-left:3px solid ${th.accent};padding:11px 13px;border-radius:8px;line-height:1.5">${esc(p.summary)}</div>` : ""}
      ${emailFieldsHtml(p.fields)}
      ${emailItemsHtml(p.items, th.accent)}
      ${p.action ? `<div style="margin-top:15px;font-weight:700;color:${th.accent}">→ ${esc(p.action)}</div>` : ""}
    </div>
  </div>`;
}

let emailIndex = {};
async function renderEmail() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">Email</h2>
    <p class="sub">Your important email — rebuilt into clean, branded cards. We read the facts and present our own version (never the sender's raw page).</p>
    <div class="saverow"><button class="btn" id="email-refresh">Refresh</button> <span class="muted" id="email-count"></span></div>
    <div id="email-list" style="margin-top:12px"><div class="muted">Loading…</div></div>`;
  $("email-refresh").addEventListener("click", renderEmail);
  const d = await emailApi("list");
  if (d.error) { $("email-list").innerHTML = `<div class="card"><div class="muted">${esc(d.error)}</div></div>`; return; }
  const emails = d.emails || [];
  emailIndex = {}; emails.forEach((e) => { emailIndex[e.id] = e; });
  $("email-count").textContent = emails.length + " message" + (emails.length === 1 ? "" : "s");
  if (!emails.length) { $("email-list").innerHTML = `<div class="card"><div class="muted">No important email right now.</div></div>`; return; }
  const groups = {};
  emails.forEach((e) => { const k = (e.icon || "📧") + " " + (e.cat_title || "Email"); (groups[k] = groups[k] || []).push(e); });
  $("email-list").innerHTML = Object.keys(groups).map((g) => `<div class="card"><h3 style="margin:0 0 4px">${esc(g)}</h3>${groups[g].map((e) => { const th = emailTheme(e); return `<div class="email-row" data-id="${esc(e.id)}" style="display:flex;align-items:center;gap:11px;border-top:1px solid var(--line);border-left:3px solid ${th.accent};padding:9px 2px 9px 10px;cursor:pointer">
      <span style="font-size:15px;flex:none">${th.glyph}</span>
      <div style="flex:1;min-width:0"><div style="font-weight:${e.unread ? 700 : 500};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.subject || "(no subject)")}${e.amount ? ` <span style="color:${th.accent};font-weight:700">${esc(e.amount)}</span>` : ""}</div>
      <div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(emailSender(e.from))} · ${esc(e.snippet || "")}</div></div>
      ${e.unread ? `<span style="width:8px;height:8px;border-radius:50%;flex:none;background:${th.accent}"></span>` : ""}
      <span class="muted" style="font-size:11px;flex:none">${esc(emailDate(e.date))}</span></div>`; }).join("")}</div>`).join("");
  main.querySelectorAll(".email-row").forEach((r) => r.addEventListener("click", () => openEmail(r.getAttribute("data-id"))));
}

async function openEmail(id) {
  const main = $("main");
  const li = emailIndex[id] || { id };
  main.innerHTML = `<div style="display:flex;gap:10px;align-items:center"><button class="btn" id="email-back">← Back</button><span class="muted" id="email-status">Building card…</span></div>
    <div id="email-card" style="margin-top:12px"><div class="muted">Loading…</div></div>`;
  $("email-back").addEventListener("click", renderEmail);
  const d = await emailApi("get", { id });
  $("email-status").textContent = "";
  const wrap = $("email-card");
  if (d.error) { wrap.innerHTML = `<div class="card"><div class="muted">${esc(d.error)}</div></div>`; return; }
  const th = emailTheme({ vendor: d.parsed && d.parsed.vendor, from: d.from, subject: d.subject, category: d.category, icon: li.icon, cat_title: li.cat_title });
  wrap.innerHTML = emailCardHtml(d.parsed, th)
    + `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><a class="btn" href="${esc(d.link)}" target="_blank" rel="noopener">Open in Gmail</a><button class="btn" id="email-orig">View original</button></div>
       <div id="email-original" style="display:none;margin-top:12px"></div>`;
  $("email-orig").addEventListener("click", () => {
    const o = $("email-original"), btn = $("email-orig");
    if (o.style.display === "none") {
      o.style.display = "block"; btn.textContent = "Hide original";
      if (!o.dataset.loaded) { const f = document.createElement("iframe"); f.setAttribute("sandbox", ""); f.style.cssText = "width:100%;min-height:60vh;border:0;background:#fff;border-radius:8px"; if (d.html) f.srcdoc = d.html; else f.srcdoc = `<pre style="white-space:pre-wrap;font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;padding:14px;color:#111">${esc(d.text || "(no content)")}</pre>`; o.appendChild(f); o.dataset.loaded = "1"; } }
    else { o.style.display = "none"; btn.textContent = "View original"; }
  });
}

// Equipment registry — model/serial pulled from vendor invoice PDFs (vendor-invoice-intake),
// matched to the HCP job by PO# (= invoice_number). Review queue: approve (attach a note to
// the job + add to registry) or reject. Manual job-# entry if the auto-match missed.



// ---------- Website API communication log (built 2026-06-10) ----------
// Shows every call the website (and tech quoter) makes to our backend so the
// office can SEE the two systems talking and catch failures live.
async function renderApiLog() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">Website API</h2>
    <p class="sub">Live log of every quote/lead call from the website &amp; tech quoter to the backend. Green = success, red = error. If the website goes quiet or errors spike, you'll see it here.</p>
    <div id="api-stat" class="statusrow"><span class="chiplive muted"><span class="dot2" style="background:var(--faint)"></span>Loading…</span></div>
    <div id="api-log" style="margin-top:12px"><div class="muted">Loading…</div></div>`;
  const d = await hub("quoter_log");
  const rows = (d && d.log) || [];
  const errColor = (d && d.errors_24h) ? "#f43f5e" : "#22c55e";
  const last = d && d.last_call ? new Date(d.last_call).toLocaleString() : "never";
  $("api-stat").innerHTML = statChip(errColor, `${(d&&d.calls_24h)||0} calls (24h)`) + statChip((d&&d.errors_24h)?"#f43f5e":"#22c55e", `${(d&&d.errors_24h)||0} errors (24h)`) + statChip("#64748b", `last: ${esc(last)}`);
  if (!rows.length) { $("api-log").innerHTML = `<div class="card"><div class="muted">No calls logged yet. Once the website hits the backend, every call shows here.</div></div>`; return; }
  $("api-log").innerHTML = `<table><thead><tr><th>When</th><th>Action</th><th>Status</th><th>Details</th><th>ms</th></tr></thead><tbody>${rows.map((r) => {
    const ok = r.ok !== false;
    const det = [r.brand_key, r.heat, r.tonnage ? r.tonnage + "T" : null].filter(Boolean).join(" · ") || (r.error || "");
    return `<tr${ok ? "" : ' style="color:#fda4af"'}><td>${esc(new Date(r.created_at).toLocaleTimeString())}</td><td><b>${esc(r.action || "?")}</b></td><td>${ok ? '<span class="pill ok">ok</span>' : `<span class="pill" style="background:rgba(244,63,94,.16);color:#fda4af">${esc(String(r.status||"err"))}</span>`}</td><td>${esc(det)}${r.error && ok ? "" : (r.error ? " — " + esc(r.error) : "")}</td><td class="muted">${esc(r.ms==null?"":r.ms)}</td></tr>`;
  }).join("")}</tbody></table>`;
}

// ---------- Pricebook (read view + AHRI research flags; built 2026-06-10) ----------
// Shows the imported matchup book (Goodman 2025 + Carrier CESTX 2026, AHRI-verified)
// and flags rows whose AHRI ref NO LONGER EXISTS in the directory — likely
// rerated/retired since the books printed. Clint researches those with the
// distributor before using them on a CPS rebate (dead refs get rejected).
async function wirePromoCard() {
  const pr = (await hub("promo_get")).promo || {};
  const box = document.getElementById("pb-promo"); if (!box) return;
  box.innerHTML = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;align-items:end">
    <label class="muted" style="font-size:11px">Active<br><select id="pm-active"><option value="1"${pr.active!==false?" selected":""}>On</option><option value="0"${pr.active===false?" selected":""}>Off</option></select></label>
    <label class="muted" style="font-size:11px">Amount ($)<br><input id="pm-amt" type="number" value="${pr.amount_cents?Math.round(pr.amount_cents/100):0}" style="width:100%"></label>
    <label class="muted" style="font-size:11px">Label<br><input id="pm-label" type="text" value="${esc(pr.label||"")}" style="width:100%"></label>
    <label class="muted" style="font-size:11px">Sublabel<br><input id="pm-sub" type="text" value="${esc(pr.sublabel||"")}" style="width:100%"></label>
    <label class="muted" style="font-size:11px">Ends<br><input id="pm-ends" type="date" value="${esc(pr.ends||"")}" style="width:100%"></label>
  </div><button class="btn primary" id="pm-save" style="margin-top:10px">Save sale</button> <span id="pm-msg" class="muted"></span>`;
  document.getElementById("pm-save").addEventListener("click", async function(){
    const promo = { active: document.getElementById("pm-active").value==="1", amount_cents: Math.round((+document.getElementById("pm-amt").value||0)*100), label: document.getElementById("pm-label").value, sublabel: document.getElementById("pm-sub").value, ends: document.getElementById("pm-ends").value||null };
    document.getElementById("pm-msg").textContent="Saving...";
    const r = await hub("promo_save",{promo}); document.getElementById("pm-msg").textContent = r&&r.ok ? "Saved (live now)" : "Failed";
  });
}
async function renderCallSearch() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">Call Search</h2>
    <p class="sub">Search every recorded call by customer name, phone number, or words in the transcript / summary. Open the transcript and recording to settle "what the customer actually said".</p>
    <div class="card">
      <div class="row2">
        <div style="flex:2"><label>Search</label><input type="text" id="cs-q" placeholder="name, phone, or keyword (e.g. heat pump)"/></div>
        <div><label>From (optional)</label><input type="text" id="cs-from" placeholder="YYYY-MM-DD"/></div>
        <div><label>To (optional)</label><input type="text" id="cs-to" placeholder="YYYY-MM-DD"/></div>
      </div>
      <div class="saverow"><button class="btn primary" id="cs-go">Search</button><span class="muted" id="cs-count"></span></div>
    </div>
    <div id="cs-results"></div>`;
  const run = async () => {
    const q = $("cs-q").value.trim(), from = $("cs-from").value.trim() || null, to = $("cs-to").value.trim() || null;
    $("cs-count").textContent = "Searching…";
    let d;
    try { d = await api("admin-calls-search", { token: TOKEN, q, from, to, limit: 300 }); }
    catch (e) { $("cs-count").textContent = "Error: " + (e && e.message || e); return; }
    if (d && d.error) { $("cs-count").textContent = d.error; return; }
    const calls = (d && d.calls) || [];
    $("cs-count").textContent = calls.length + " call" + (calls.length === 1 ? "" : "s");
    $("cs-results").innerHTML = calls.length ? calls.map(callSearchCard).join("") : `<div class="card"><div class="muted">No calls found.</div></div>`;
  };
  $("cs-go").addEventListener("click", run);
  $("cs-q").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  run();
}
function callSearchCard(c) {
  const when = c.created_at ? new Date(c.created_at).toLocaleString() : "";
  const who = c.customer_name || c.from_number || "Unknown caller";
  const urg = c.ai_urgency ? `<span class="pill">${esc(c.ai_urgency)}</span>` : "";
  const phone = c.from_number ? `<span class="muted" style="font-size:12px">${esc(fmtPhone(c.from_number))}</span>` : "";
  const rec = c.recording_url ? `<audio controls preload="none" src="${esc(c.recording_url)}" style="width:100%;height:34px;margin-top:8px"></audio>` : "";
  const tx = c.transcript_text
    ? `<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--accent);font-size:13px">View transcript</summary><div style="white-space:pre-wrap;font-size:13px;margin-top:6px;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:9px 11px">${esc(c.transcript_text)}</div></details>`
    : `<div class="faint" style="font-size:12px;margin-top:6px">No transcript for this call</div>`;
  return `<div class="card">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>${esc(who)}</b> ${phone} ${urg}<span class="muted" style="margin-left:auto;font-size:12px">${esc(when)}</span></div>
    ${c.ai_summary ? `<div style="margin-top:6px;font-size:13px">${esc(c.ai_summary)}</div>` : ""}
    ${tx}
    ${rec}
  </div>`;
}
async function renderPricebook() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">Pricebook</h2>
    <p class="sub">Matchups imported from your price books and verified against the AHRI directory. Ratings (SEER2/EER2/HSPF2/BTU) come straight from AHRI.</p>
    <p class="faint" style="font-size:12px;margin:2px 0 14px">Equipment cost &amp; catalog. Sell prices, the cash discount, and the sale/promo now live in <b>Pricing</b>.</p>
    <div id="pb-promo-reminder"></div>
    <div class="card" style="margin-top:14px"><h3>Master Price Book File</h3>
      <p class="muted" style="font-size:12px">One file for Housecall Pro &mdash; equipment + repairs + misc + services, generated live from this backend. In Housecall go to <b>Price Book &rarr; Import</b> and upload it. Tip: Refresh AHRI first so certificate data is current.</p>
      <div class="saverow" style="margin-top:8px">
        <a class="btn primary" href="${BASE}pricebook-export" target="_blank" rel="noopener">&#11015; Download Master CSV</a>
        <button class="btn" id="pb-ahri-refresh" type="button">&#8635; Refresh AHRI Certs</button>
        <span class="muted" id="pb-ahri-status" style="font-size:12px"></span>
      </div></div>
    <div id="pb-flagged" style="margin-top:14px"></div>
    <div class="card" style="margin-top:14px"><h3>Website tier mapper</h3>
      <p class="muted" style="font-size:12px">Which equipment platform sits behind each comfort level on the website. Change a dropdown and Save — quotes and the price API follow instantly. "Not sold" keeps a platform in the book but out of every quote.</p>
      <div id="pb-mapper"><div class="muted">Loading...</div></div></div>
    <div class="card" style="margin-top:14px"><h3>All systems <input type="text" id="pb-search" placeholder="search model / AHRI / tier" style="float:right;width:240px"/></h3><div id="pb-all"></div></div>`;
  (function(){ var ar=$("pb-ahri-refresh"); if(!ar) return; ar.onclick=async function(){ var st=$("pb-ahri-status"); ar.disabled=true; var pass=0, ok=true; try{ for(var i=0;i<12;i++){ pass++; if(st) st.textContent="Refreshing AHRI certs... pass "+pass; var r=await fetch(BASE+"pricebook-export?ahri=refresh&nonce="+Date.now()); var j=await r.json().catch(function(){return {};}); var bRem=(j&&j.backfill)?j.backfill.remaining:0; var cRem=(j&&j.certs)?j.certs.remaining:0; if((bRem||0)===0&&(cRem||0)===0) break; } }catch(e){ ok=false; if(st) st.textContent="Error: "+e; } ar.disabled=false; if(ok&&st) st.textContent="✓ AHRI certs up to date."; }; })();
  // Flashing reminder: once a sale/promo's end date has passed, the price book still has that
  // discount baked into every system's price (export = sticker - active promo). So it must be
  // re-downloaded + re-imported into Housecall, or prices stay stale (e.g. $500 too low). Fires
  // automatically on the day AFTER promo.ends — for THIS promo (ends 6/30 -> shows 7/1) and any future one.
  (async function(){
    try {
      const pr = ((await hub("promo_get")) || {}).promo || {};
      const box = $("pb-promo-reminder"); if (!box || !pr.ends) return;
      const endD = new Date(pr.ends + "T23:59:59");
      if (isNaN(endD.getTime()) || new Date() <= endD) return; // promo not over yet
      const endTxt = new Date(pr.ends + "T12:00:00").toLocaleDateString();
      box.innerHTML =
        '<style>@keyframes pbflash{0%,100%{background:#fdecea;box-shadow:0 0 0 rgba(220,38,38,0)}50%{background:#fbd5d1;box-shadow:0 0 16px rgba(220,38,38,.55)}}'
        + '.pb-reimport-flash{animation:pbflash 1.1s ease-in-out infinite;border:2px solid #dc2626;color:#7f1d1d;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.45;margin:0 0 14px;font-weight:600}</style>'
        + '<div class="pb-reimport-flash">&#9888; The &ldquo;' + esc(pr.label || "sale") + '&rdquo; sale ended ' + esc(endTxt)
        + '. That discount is still baked into your Housecall price book &mdash; <b>re-download the Master CSV below and re-import it into Housecall Pro &rarr; Price Book &rarr; Import</b> so your prices are current, then turn the sale off in <b>Pricing</b>.</div>';
    } catch (_e) {}
  })();
  const d = await hub("pricebook_list");
  const flagged = (d && d.flagged) || [];
  const all = (d && d.all) || [];
  const orient = (o) => o === "multi" ? "Multi" : o === "vertical" ? "Vert (closet)" : o === "horizontal" ? "Horiz (attic)" : esc(o || "");
  $("pb-flagged").innerHTML = flagged.length
    ? `<div class="card" style="border:1px solid rgba(244,63,94,.4)"><h3 style="color:#fda4af">&#9888; Needs research — AHRI ref no longer in directory (${flagged.length})</h3>
       <p class="muted" style="font-size:12px">These came from the price books but AHRI doesn't list them anymore (likely re-rated or retired). Check with your distributor for the replacement ref before using on a rebate.</p>
       <table><thead><tr><th>Brand</th><th>AHRI #</th><th>Ton</th><th>Type</th><th>Orientation</th><th>Condenser</th><th>Indoor</th></tr></thead><tbody>
       ${flagged.map((f) => `<tr><td>${esc(f.brand)}</td><td><b>${esc(f.ahri_number)}</b></td><td>${esc(f.tonnage)}</td><td>${esc(String(f.system_type || "").replace("_", " "))}</td><td>${orient(f.orientation)}</td><td>${esc(f.condenser_model)}</td><td>${esc(f.coil_model || f.air_handler_model || f.furnace_model || "")}</td></tr>`).join("")}
       </tbody></table></div>`
    : `<div class="card"><div class="muted">No flagged systems — every AHRI ref verified. &#10003;</div></div>`;
  function renderAll(q) {
    const ql = String(q || "").toLowerCase();
    const rows = all.filter((r) => !ql || [r.ahri_number, r.brand, r.tier, r.system_type].some((x) => String(x || "").toLowerCase().includes(ql)));
    $("pb-all").innerHTML = `<table><thead><tr><th>Brand</th><th>Tier</th><th>Type</th><th>Ton</th><th>Orient</th><th>AHRI #</th><th>SEER2</th><th>EER2</th><th>HSPF2</th><th>BTU</th><th>Cost</th></tr></thead><tbody>
      ${rows.map((r) => `<tr${r.ahri_model_status === "NOT FOUND" ? ' style="color:#fda4af"' : ""}><td>${esc(r.brand)}</td><td>${esc(r.tier)}</td><td>${esc(String(r.system_type || "").replace("_", " "))}</td><td>${esc(r.tonnage)}</td><td>${orient(r.orientation)}</td><td>${esc(r.ahri_number)}${r.ahri_model_status === "NOT FOUND" ? " &#9888;" : ""}</td><td>${esc(r.seer2 ?? "")}</td><td>${esc(r.eer2 ?? "")}</td><td>${esc(r.hspf2 ?? "")}</td><td>${esc(r.btu ?? "")}</td><td>${money(r.system_cost_cents)}</td></tr>`).join("")}
      </tbody></table>`;
  }
  renderAll("");
  // ---- tier mapper (groups = brand + book tier + crossover split) ----
  const TIERS = [["","(unmapped)"],["essential","Essential Comfort"],["reliable","Reliable Comfort"],["enhanced","Enhanced Comfort"],["signature","Signature Comfort"],["ultimate","Ultimate Comfort"]];
  const g = await hub("pricebook_groups");
  const groups = (g && g.groups) || [];
  groups.sort((a, b) => (a.brand + a.tier).localeCompare(b.brand + b.tier));
  $("pb-mapper").innerHTML = `<table><thead><tr><th>Platform</th><th>Systems</th><th>Website tier</th><th>Sold?</th><th></th></tr></thead><tbody>
    ${groups.map((gr, i) => `<tr>
      <td><b>${esc(gr.brand)}</b> ${esc(gr.tier)}${gr.crossover ? ' <span class="pill tech">Crossover side-discharge</span>' : ""}</td>
      <td>${gr.count}</td>
      <td><select data-map-tier="${i}">${TIERS.map(([v, t]) => `<option value="${v}"${(gr.website_tier || "") === v ? " selected" : ""}>${t}</option>`).join("")}${gr.website_tier === "mixed" ? '<option value="mixed" selected>(mixed)</option>' : ""}</select></td>
      <td><label><input type="checkbox" data-map-sell="${i}"${gr.sellable !== false ? " checked" : ""}/> sellable</label></td>
      <td><button class="btn" data-map-save="${i}">Save</button></td>
    </tr>`).join("")}</tbody></table>`;
  $("pb-mapper").querySelectorAll("[data-map-save]").forEach((b) => b.addEventListener("click", async () => {
    const i = +b.getAttribute("data-map-save"); const gr = groups[i];
    const tierSel = $("pb-mapper").querySelector(`[data-map-tier="${i}"]`).value;
    if (tierSel === "mixed") { alert("Pick a real tier first."); return; }
    const sell = $("pb-mapper").querySelector(`[data-map-sell="${i}"]`).checked;
    b.textContent = "...";
    const r = await hub("pricebook_map_save", { brand: gr.brand, tier: gr.tier, crossover: gr.crossover, website_tier: tierSel || null, sellable: sell });
    if (r && r.ok) renderPricebook(); else { b.textContent = "Save"; alert("Failed: " + ((r && r.error) || "error")); }
  }));
  $("pb-search")?.addEventListener("input", (e) => renderAll(e.target.value));
}

// ---------- CPS Rebates (STEP HVAC) — built 2026-06-10 ----------
// One card per install job. Prefills from HCP + equipment registry (rebates fn),
// shows the missing-items checklist, and generates the REAL filled CPS PDF
// (AcroForm field fill, verified against the 2025 form). Decisions: bill-credit
// default, generate-only (Clint prints/emails), account#/signature manual.
function rebApi(action, extra) { return api("rebates", Object.assign({ token: TOKEN, action }, extra || {})); }
let rebOpen = null; // id of the expanded card
const REB_SEL = {
  rebate_type: [["burnout","Replace on Burnout"],["early_replacement","Early Replacement"]],
  unit_type: [["central_ac","Central A/C"],["heat_pump","Heat Pump"],["mini_split","Ductless Mini-Split"]],
  payment_type: [["bill_credit","Bill credit (2-3 wks)"],["check","Incentive check (8-12 wks)"]],
  heat_type: [["","(heat pumps only)"],["electric_resistance","Electric resistance"],["air_source_hp","Air source heat pump"]],
};
function rebInput(r, key, label, type) {
  const v = r[key] == null ? "" : r[key];
  if (REB_SEL[key]) return `<label class="muted" style="font-size:11px">${label}<br><select data-f="${key}">${REB_SEL[key].map(([val,txt]) => `<option value="${val}"${String(v)===val?" selected":""}>${txt}</option>`).join("")}</select></label>`;
  if (type === "check") return `<label class="muted" style="font-size:11px"><input type="checkbox" data-f="${key}"${v?" checked":""}/> ${label}</label>`;
  return `<label class="muted" style="font-size:11px">${label}<br><input type="${type||"text"}" data-f="${key}" value="${esc(v)}" style="width:100%"/></label>`;
}
async function renderRebates() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">CPS Rebates</h2>
    <p class="sub">Every install gets a rebate card — auto-filled from the job + equipment registry. Fix what's flagged, hit Generate, print for the customer's signature, email to CPSEnergyResidential@clearesult.com within 30 days of install.</p>
    <div class="card"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="text" id="reb-job" placeholder="HCP job # (e.g. 8606)" style="width:170px"/>
      <button class="btn primary" id="reb-create">+ New rebate from job</button>
      <button class="btn" id="reb-contractor">Contractor info</button>
      <span id="reb-msg" class="muted"></span></div>
      <div id="reb-contractor-box" style="display:none;margin-top:10px"></div></div>
    <div id="reb-list" style="margin-top:14px"><div class="muted">Loading...</div></div>`;
  const d = await rebApi("list");
  const rows = (d && d.rebates) || [];
  const lEl = $("reb-list");
  if (!rows.length) { lEl.innerHTML = `<div class="card"><div class="muted">No rebates yet. Type a job # above to start one.</div></div>`; }
  else {
    lEl.innerHTML = rows.map((r) => {
      const open = rebOpen === r.id;
      const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
      const st = r.status === "paid" ? `<span class="pill ok">paid</span>` : r.status === "submitted" ? `<span class="pill tech">submitted</span>` : r.status === "generated" ? `<span class="pill tech">PDF ready</span>` : `<span class="pill" style="background:rgba(251,191,36,.16);color:#fbbf24">draft</span>`;
      const miss = (r.missing || []);
      const head = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer" data-reb-open="${r.id}">
        <div><b>Job #${esc(r.job_number)}</b> &middot; ${esc(name || "?")} &middot; ${esc(r.install_address || "")} ${st} ${r.jurisdiction ? `<span class="pill tech">${esc(r.jurisdiction)}${r.permit_required ? " &middot; permit req" : ""}</span>` : ""} ${r.warranty_registered ? '<span class="pill ok">warranty &#10003;</span>' : '<span class="pill" style="background:rgba(244,63,94,.16);color:#fda4af">warranty pending</span>'}</div>
        <span class="muted">${open ? "&#9650;" : "&#9660;"}</span></div>`;
      if (!open) return `<div class="card">${head}${miss.length ? `<div class="muted" style="font-size:12px;margin-top:4px">Missing: ${esc(miss.slice(0,3).join("; "))}${miss.length>3?` (+${miss.length-3} more)`:""}</div>` : ""}</div>`;
      const early = r.rebate_type === "early_replacement";
      return `<div class="card">${head}
        <div style="margin:8px 0">${miss.map((m) => `<span class="pill" style="background:rgba(244,63,94,.12);color:#fda4af;margin:2px">${esc(m)}</span>`).join("")}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px">
          ${rebInput(r,"rebate_type","Rebate type")}${rebInput(r,"payment_type","Payment")}${rebInput(r,"cps_account_number","CPS account #")}
          ${rebInput(r,"first_name","First name")}${rebInput(r,"last_name","Last name")}${rebInput(r,"phone","Phone")}
          ${rebInput(r,"email","Email")}${rebInput(r,"install_address","Install address")}${rebInput(r,"install_zip","ZIP")}
          ${rebInput(r,"permit_number","Permit # (CoSA)")}${rebInput(r,"install_date","Install date","date")}${rebInput(r,"unit_type","Unit type")}
          ${rebInput(r,"manufacturer","Manufacturer")}${rebInput(r,"ahri_number","AHRI cert #")}${rebInput(r,"btu","BTU","number")}
          ${rebInput(r,"seer2","SEER2","number")}${rebInput(r,"eer2","EER2","number")}${rebInput(r,"hspf2","HSPF2","number")}
          ${rebInput(r,"new_condenser_model","New condenser model")}${rebInput(r,"new_condenser_serial","Condenser serial")}${rebInput(r,"new_coil_model","New coil model")}
          ${rebInput(r,"new_coil_serial","Coil serial")}${rebInput(r,"new_furnace_model","New furnace/AH model")}${rebInput(r,"new_furnace_serial","Furnace serial")}
        </div>
        ${early ? `<div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px"><b style="font-size:12px">Existing system (Early Replacement — all required)</b>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:6px">
          ${rebInput(r,"existing_age","Existing system age")}${rebInput(r,"heat_type","Heat type")}<span></span>
          ${rebInput(r,"existing_outdoor_model","Existing outdoor model")}${rebInput(r,"existing_outdoor_serial","Outdoor serial")}<span></span>
          ${rebInput(r,"existing_indoor_model","Existing indoor model")}${rebInput(r,"existing_indoor_serial","Indoor serial")}<span></span>
          ${rebInput(r,"existing_furnace_model","Existing furnace model")}${rebInput(r,"existing_furnace_serial","Furnace serial")}<span></span>
          ${rebInput(r,"existing_operational","Existing system operational","check")}${rebInput(r,"photos_provided","Photos of old system collected","check")}<span></span>
        </div></div>` : `<div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px"><b style="font-size:12px">Burnout details</b>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:6px">
          ${rebInput(r,"burnout_existing_age","Existing system age")}${rebInput(r,"burnout_operational","Old system still operational","check")}<span></span>
        </div></div>`}
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:10px">
          ${rebInput(r,"warranty_registered","10-yr warranty registered","check")}
          <span style="flex:1"></span>
          <button class="btn primary" data-reb-save="${r.id}">Save</button>
          <button class="btn primary" data-reb-gen="${r.id}">&#128196; Generate CPS PDF</button>
          ${r.pdf_path ? `<button class="btn" data-reb-pdf="${r.id}">View last PDF</button>` : ""}
          <select data-reb-status="${r.id}"><option value="">status...</option><option value="submitted">mark submitted</option><option value="paid">mark paid</option><option value="void">void</option></select>
        </div></div>`;
    }).join("");
  }
  $("reb-create")?.addEventListener("click", async () => {
    const n = ($("reb-job").value || "").trim(); if (!n) return;
    $("reb-msg").textContent = "Creating...";
    const r = await rebApi("create", { job_number: n });
    if (r && r.ok) { rebOpen = r.rebate.id; $("reb-msg").textContent = `Created (found ${r.equipment_found} registry items)`; renderRebates(); }
    else $("reb-msg").textContent = (r && r.error) || "failed";
  });
  $("reb-contractor")?.addEventListener("click", async () => {
    const box = $("reb-contractor-box");
    if (box.style.display !== "none") { box.style.display = "none"; return; }
    const c = (await rebApi("contractor_get")).contractor || {};
    box.style.display = "";
    box.innerHTML = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">` +
      ["company","contact","mailing","city","zip","license","email","phone"].map((k) => `<label class="muted" style="font-size:11px">${k}<br><input type="text" data-c="${k}" value="${esc(c[k] || "")}" style="width:100%"/></label>`).join("") +
      `</div><button class="btn primary" id="reb-c-save" style="margin-top:8px">Save contractor info</button><span class="muted" style="margin-left:8px">License # goes on every form — fill it once.</span>`;
    $("reb-c-save").addEventListener("click", async () => {
      const cc = {}; box.querySelectorAll("[data-c]").forEach((i) => cc[i.getAttribute("data-c")] = i.value);
      await rebApi("contractor_save", { contractor: cc });
      box.style.display = "none";
    });
  });
  main.querySelectorAll("[data-reb-open]").forEach((el) => el.addEventListener("click", () => { const id = el.getAttribute("data-reb-open"); rebOpen = rebOpen === id ? null : id; renderRebates(); }));
  main.querySelectorAll("[data-reb-save]").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const id = b.getAttribute("data-reb-save");
    const card = b.closest(".card"); const fields = {};
    card.querySelectorAll("[data-f]").forEach((i) => { fields[i.getAttribute("data-f")] = i.type === "checkbox" ? i.checked : i.value; });
    b.textContent = "Saving..."; const r = await rebApi("save", { id, fields });
    if (r && r.ok) renderRebates(); else { b.textContent = "Save"; alert("Failed: " + ((r && r.error) || "error")); }
  }));
  main.querySelectorAll("[data-reb-gen]").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    b.disabled = true; b.textContent = "Generating...";
    const r = await rebApi("generate", { id: b.getAttribute("data-reb-gen") });
    if (r && r.url) { window.open(r.url, "_blank"); renderRebates(); }
    else { b.disabled = false; b.textContent = "Generate CPS PDF"; alert("Failed: " + ((r && r.error) || "error")); }
  }));
  main.querySelectorAll("[data-reb-pdf]").forEach((b) => b.addEventListener("click", async (ev) => { ev.stopPropagation(); const r = await rebApi("pdf", { id: b.getAttribute("data-reb-pdf") }); if (r && r.url) window.open(r.url, "_blank"); }));
  main.querySelectorAll("[data-reb-status]").forEach((sel) => sel.addEventListener("change", async () => {
    const v = sel.value; if (!v) return;
    await rebApi("save", { id: sel.getAttribute("data-reb-status"), fields: { status: v } });
    renderRebates();
  }));
}

// ---------- APS subcontractor invoice photos (review-first; built 2026-06-10) ----------
// Rows are written by aps-invoice-intake (fed by the daily gmail-scan v3 APS branch):
// Air Performance's "Invoice NNNN due" emails carry the job photos as attachments +
// the service address; intake matches address -> our customer -> nearest job.
// Approve = admin-hub aps_approve uploads the photos onto the HCP job + drops a
// breadcrumb note. NOTHING attaches without the click (locked decision 2026-06-10).
async function renderAps() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">APS photos</h2>
    <p class="sub">Job photos from Air Performance Specialists' invoice emails, matched to your job by service address. Approve to attach them onto the Housecall Pro job.</p>
    <div id="aps-pending"><div class="muted">Loading...</div></div>
    <div class="card" style="margin-top:18px"><h3>Done</h3><div id="aps-done"></div></div>`;
  const d = await hub("aps_list");
  const pending = (d && d.pending) || [];
  const done = (d && d.done) || [];
  const pEl = $("aps-pending");
  if (!pending.length) {
    pEl.innerHTML = `<div class="card"><div class="muted">Nothing waiting for review. New APS invoices land here after the daily scan.</div></div>`;
  } else {
    pEl.innerHTML = pending.map((f) => {
      const photos = Array.isArray(f.photos) ? f.photos : [];
      const jobLine = f.candidate_job_id
        ? `<span class="pill ok">${esc(f.candidate_job_label || "matched job")}</span>`
        : `<span class="muted">No job auto-matched - search your job # below</span>`;
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">Invoice #${esc(f.invoice_number)} &middot; ${esc(f.service_address || "")}</h3>${f.pdf_path ? `<button class="btn" data-aps-pdf="${esc(f.id)}">&#128196; Invoice PDF</button>` : ""}</div>
        <div style="margin:4px 0 8px">${jobLine} <span class="muted">${esc(f.service_date || "")}${f.line_summary ? " &middot; " + esc(f.line_summary) : ""}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">${photos.map((p) => `<a href="${esc(p.url)}" target="_blank" title="${esc(p.filename || "")}"><img src="${esc(p.url)}" style="width:110px;height:84px;object-fit:cover;border-radius:6px;border:1px solid var(--line)"/></a>`).join("")}</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <button class="btn primary" data-aps-approve="${esc(f.id)}" data-aps-job="${esc(f.candidate_job_id || "")}">&#10003; Attach ${photos.length} photo${photos.length === 1 ? "" : "s"} to job</button>
          <button class="btn" data-aps-reject="${esc(f.id)}" title="Reject">&#10007;</button>
          <input type="text" class="aps-jobnum" data-for="${esc(f.id)}" placeholder="Override: HCP job #" style="width:170px"/>
          <button class="btn" data-aps-find="${esc(f.id)}">Find job</button><span class="aps-found muted"></span>
        </div>
      </div>`;
    }).join("");
  }
  $("aps-done").innerHTML = done.length
    ? `<table><thead><tr><th>Invoice</th><th>Address</th><th>Job</th><th>Photos</th><th>By</th><th>Status</th></tr></thead><tbody>${done.map((r) => `<tr><td>#${esc(r.invoice_number)}</td><td>${esc(r.service_address || "")}</td><td>${esc(r.candidate_job_label || "")}</td><td>${esc(r.attached_count == null ? "" : r.attached_count)}</td><td>${esc(r.approved_by || "")}</td><td>${esc(r.status)}</td></tr>`).join("")}</tbody></table>`
    : `<div class="muted">Nothing approved or rejected yet.</div>`;
  main.querySelectorAll("[data-aps-pdf]").forEach((b) => b.addEventListener("click", async () => { const r = await hub("aps_pdf", { id: b.getAttribute("data-aps-pdf") }); if (r && r.url) window.open(r.url, "_blank"); else alert("Couldn't open the PDF."); }));
  main.querySelectorAll("[data-aps-reject]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Reject these photos? (Nothing attaches; they stay in storage.)")) return; await hub("aps_reject", { id: b.getAttribute("data-aps-reject") }); renderAps(); }));
  main.querySelectorAll("[data-aps-approve]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.getAttribute("data-aps-approve"); const job = b.getAttribute("data-aps-job") || "";
    if (!job) { alert("No job matched yet - type your HCP job # and hit Find job first."); return; }
    b.disabled = true; b.textContent = "Attaching...";
    const r = await hub("aps_approve", { id, job_id: job });
    if (r && r.ok) renderAps();
    else { b.disabled = false; b.textContent = "Attach photos"; alert("Failed: " + ((r && (r.error || (r.errors || []).join("; "))) || "no photos attached")); }
  }));
  main.querySelectorAll("[data-aps-find]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.getAttribute("data-aps-find");
    const inp = main.querySelector(`.aps-jobnum[data-for="${id}"]`);
    const span = b.parentElement.querySelector(".aps-found");
    const num = inp && inp.value.trim(); if (!num) return;
    span.textContent = "...";
    const r = await hub("aps_find_job", { q: num });
    if (r && r.job) { span.textContent = "Found: " + (r.job.label || num); const ab = main.querySelector(`[data-aps-approve="${id}"]`); if (ab) ab.setAttribute("data-aps-job", r.job.id); }
    else span.textContent = "No job " + num + " found";
  }));
}
async function renderEquipment() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">Equipment</h2>
    <p class="sub">Model &amp; serial numbers read from vendor invoices/BOLs (Daikin, Robert Madden, …), matched to the job by PO #. Approve to attach the serial onto the Housecall Pro job and add it to your registry.</p>
    <div id="eq-pending"><div class="muted">Loading…</div></div>
    <div class="card" style="margin-top:18px"><h3>Registry <input type="text" id="eq-search" placeholder="search model / serial / customer" style="float:right;width:240px"/></h3><div id="eq-registry"></div></div>`;
  const d = await hub("equipment_list");
  const pending = (d && d.pending) || [];
  const registry = (d && d.registry) || [];
  const groups = {};
  pending.forEach((f) => { const k = (f.vendor || "Vendor") + " · " + (f.order_number || "?"); (groups[k] = groups[k] || []).push(f); });
  const pEl = $("eq-pending");
  if (!pending.length) {
    pEl.innerHTML = `<div class="card"><div class="muted">Nothing waiting for review. New vendor invoices will appear here after the daily scan.</div></div>`;
  } else {
    pEl.innerHTML = Object.keys(groups).map((k) => {
      const items = groups[k];
      const f0 = items[0];
      const ids = items.map((i) => i.id).join(",");
      const jobLine = f0.candidate_job_id
        ? `<span class="pill ok">Job ${esc(f0.po_number || "")} · ${esc(f0.candidate_job_label || "")}${f0.candidate_tech ? " · " + esc(f0.candidate_tech) : ""}</span>`
        : `<span class="muted">No job auto-matched (PO ${esc(f0.po_number || "?")})</span>`;
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">${esc(k)}</h3><button class="btn" data-eq-pdf="${esc(f0.id)}">📄 View PDF</button></div>
        <div style="margin:4px 0 8px">${jobLine} <span class="muted">${esc(f0.document_date || "")}</span></div>
        ${items.map((f) => `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)">
          <div style="flex:1;min-width:0"><b>${esc(f.model)}</b> <span class="muted">${esc(f.description || "")}</span><br><span class="pill tech">Serial ${esc(f.serial)}</span></div>
          <button class="btn primary" data-eq-approve="${esc(f.id)}" data-eq-job="${esc(f.candidate_job_id || "")}">✓ Approve</button>
          <button class="btn" data-eq-reject="${esc(f.id)}" title="Reject">✗</button>
        </div>`).join("")}
        ${!f0.candidate_job_id ? `<div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input type="text" class="eq-jobnum" data-for="${esc(ids)}" placeholder="Enter HCP job # (e.g. ${esc(f0.po_number || "8619")})" style="width:210px"/><button class="btn" data-eq-find="${esc(ids)}">Find job</button><span class="eq-found muted"></span></div>` : ""}
      </div>`;
    }).join("");
  }
  function renderReg(q) {
    const ql = String(q || "").toLowerCase();
    const rows = registry.filter((r) => !ql || [r.model, r.serial, r.candidate_job_label, r.vendor].some((x) => String(x || "").toLowerCase().includes(ql)));
    $("eq-registry").innerHTML = rows.length
      ? `<table><thead><tr><th>Model</th><th>Serial</th><th>Vendor</th><th>Job</th><th>Date</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.model)}</td><td>${esc(r.serial)}</td><td>${esc(r.vendor || "")}</td><td>${esc(r.candidate_job_label || r.po_number || "")}</td><td>${esc(r.document_date || "")}</td></tr>`).join("")}</tbody></table>`
      : `<div class="muted">No approved equipment yet.</div>`;
  }
  renderReg("");
  $("eq-search")?.addEventListener("input", (e) => renderReg(e.target.value));
  main.querySelectorAll("[data-eq-pdf]").forEach((b) => b.addEventListener("click", async () => { const r = await hub("equipment_pdf", { id: b.getAttribute("data-eq-pdf") }); if (r && r.url) window.open(r.url, "_blank"); else alert("Couldn't open the PDF."); }));
  main.querySelectorAll("[data-eq-reject]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Reject / dismiss this item?")) return; await hub("equipment_reject", { id: b.getAttribute("data-eq-reject") }); renderEquipment(); }));
  main.querySelectorAll("[data-eq-approve]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.getAttribute("data-eq-approve"); const job = b.getAttribute("data-eq-job") || "";
    if (!job && !confirm("No job is matched yet. Approve to the registry without attaching it to a job?")) return;
    b.disabled = true; b.textContent = "…";
    const r = await hub("equipment_approve", Object.assign({ id }, job ? { job_id: job } : {}));
    if (r && r.ok) renderEquipment();
    else { b.disabled = false; b.textContent = "✓ Approve"; alert("Failed: " + ((r && r.error) || "error")); }
  }));
  main.querySelectorAll("[data-eq-find]").forEach((b) => b.addEventListener("click", async () => {
    const ids = b.getAttribute("data-eq-find");
    const inp = main.querySelector(`.eq-jobnum[data-for="${ids}"]`);
    const span = b.parentElement.querySelector(".eq-found");
    const num = inp && inp.value.trim(); if (!num) return;
    span.textContent = "…";
    const r = await hub("equipment_find_job", { q: num });
    if (r && r.job) { span.textContent = "✓ " + (r.job.label || num); ids.split(",").forEach((id) => { const ab = main.querySelector(`[data-eq-approve="${id}"]`); if (ab) ab.setAttribute("data-eq-job", r.job.id); }); }
    else span.textContent = "No job " + num + " found";
  }));
}

// ---------- Proposals (technician equipment proposals → push to a real HCP estimate) ----------
// Calls the admin-estimates fn. Review queue: submissions land here from the presentation app
// (via estimate-intake). Nothing touches Housecall Pro until you hit Push.
function estApi(action, extra) { return api("admin-estimates", Object.assign({ token: TOKEN, action }, extra || {})); }
function confPill(c) {
  if (c === "high") return `<span class="pill ok">match: high</span>`;
  if (!c || c === "none") return `<span class="pill" style="background:rgba(244,63,94,.16);color:#fda4af">no match</span>`;
  return `<span class="pill" style="background:rgba(251,191,36,.16);color:#fbbf24">match: ${esc(c)}</span>`;
}
function statusPill(st) {
  if (st === "pushed") return `<span class="pill ok">✓ pushed</span>`;
  if (st === "rejected") return `<span class="pill">rejected</span>`;
  if (st === "reviewed") return `<span class="pill tech">reviewed</span>`;
  return `<span class="pill" style="background:rgba(251,191,36,.16);color:#fbbf24">new</span>`;
}
async function renderProposals() {
  const m = $("main");
  m.innerHTML = `<h2 class="sec">Proposals</h2>
    <p class="sub">Equipment options your techs presented in the field, sent here <b>before</b> Housecall Pro. Review the line items, confirm the customer's estimate, and push them onto a real HCP estimate. Nothing reaches Housecall Pro until you push it.</p>
    <div class="statusrow" id="prop-counts"></div>
    <div id="prop-list"><div class="muted">Loading…</div></div>`;
  const d = await estApi("list");
  const rows = (d && d.rows) || [];
  const counts = (d && d.counts) || {};
  $("prop-counts").innerHTML = [
    statChip(counts.unseen ? "#fbbf24" : "#34d399", (counts.unseen || 0) + " new"),
    statChip("#9fb0c7", (counts.reviewed || 0) + " reviewed"),
    statChip("#34d399", (counts.pushed || 0) + " pushed"),
  ].join("");
  const list = $("prop-list");
  if (!rows.length) { list.innerHTML = `<div class="card"><div class="muted">No proposals yet. When a tech sends an equipment proposal from the presentation app, it shows up here for review.</div></div>`; return; }
  const active = rows.filter((r) => r.status === "unseen" || r.status === "reviewed");
  const done = rows.filter((r) => r.status === "pushed" || r.status === "rejected");
  const card = (r) => `<div class="card" data-prop="${esc(r.id)}" style="cursor:pointer">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div style="min-width:0"><b>${esc(r.customer_name || "Unknown customer")}</b> ${r.technician ? `<span class="pill tech">Tech: ${esc(r.technician)}</span>` : `<span class="pill" style="background:rgba(34,197,94,.16);color:#22c55e">Website</span>`}${r.customer_status ? (r.customer_status==="approved" ? ` <span class="pill ok">✓ Approved${r.approved_option_name?": "+esc(r.approved_option_name):""}</span>` : r.customer_status==="declined" ? ` <span class="pill" style="background:rgba(244,63,94,.16);color:#fda4af">Declined</span>` : r.customer_status==="financing" ? ` <span class="pill" style="background:rgba(168,85,247,.18);color:#c4b5fd">💳 Financing</span>` : ` <span class="pill" style="background:rgba(251,191,36,.16);color:#fbbf24">Awaiting customer</span>`) : ""}${(r.job_number||r.estimate_number)?` <span class="muted" style="font-size:11px">${r.estimate_number?"est #"+esc(r.estimate_number):""}${r.job_number?" · job #"+esc(r.job_number):""}</span>`:""}<br><span class="muted" style="font-size:12px">${esc(r.customer_address || "no address")}</span></div>
      <div style="text-align:right;white-space:nowrap"><b>${esc(r.total)}</b><br><span class="muted" style="font-size:12px">${r.item_count} items</span></div>
    </div>
    <div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">${confPill(r.confidence)} ${statusPill(r.status)} <span class="muted" style="font-size:12px">${esc(r.estimate_label || "no estimate picked yet")}</span></div>
  </div>`;
  list.innerHTML = `${active.map(card).join("")}${done.length ? `<div class="tilegroup">Done</div>${done.map(card).join("")}` : ""}`;
  list.querySelectorAll("[data-prop]").forEach((c) => c.addEventListener("click", () => openProposal(c.getAttribute("data-prop"))));
}
async function openProposal(id) {
  const m = $("main");
  m.innerHTML = `<p class="sub">Loading…</p>`;
  const d = await estApi("get", { id });
  if (!d || !d.submission) { m.innerHTML = `<button class="btn" id="prop-back">← All proposals</button><p class="muted" style="margin-top:14px">Couldn't load that proposal.</p>`; $("prop-back").onclick = renderProposals; return; }
  const s = d.submission;
  let estimates = d.estimates || [];
  let items = Array.isArray(s.items) ? JSON.parse(JSON.stringify(s.items)) : [];
  let custId = s.candidate_customer_id || "", custLabel = s.candidate_customer_label || "";
  let estId = s.candidate_estimate_id || "", optId = s.candidate_option_id || "";
  const isPushed = s.status === "pushed";
  const totalCents = () => items.reduce((a, it) => a + (Number(it.unit_price_cents) || 0) * (Number(it.quantity) || 1), 0);
  const priceDollars = (c) => ((Number(c) || 0) / 100).toFixed(2);

  m.innerHTML = `
    <button class="btn" id="prop-back">← All proposals</button>
    <h2 class="sec" style="margin-top:12px">${esc(s.customer_name || "Proposal")}</h2>
    <p class="sub">${esc(s.customer_address || "")}${s.customer_phone ? " · " + esc(s.customer_phone) : ""}${s.option_name ? " · " + esc(s.option_name) : ""}</p>
    ${isPushed ? `<div class="card" style="border-color:#34d399"><b style="color:#34d399">✓ Pushed to Housecall Pro.</b> <a href="https://pro.housecallpro.com/app/estimates/${esc(s.pushed_option_id || "")}" target="_blank">Open the estimate →</a></div>` : ""}
    ${s.error ? `<div class="card" style="border-color:var(--danger)"><span style="color:#fda4af">Last push error: ${esc(s.error)}</span></div>` : ""}
    <div class="card"><h3>Customer match</h3>
      <p class="muted" id="prop-custlabel">${custId ? `Matched: <b style="color:var(--text)">${esc(custLabel)}</b>` : `<span style="color:#fda4af">No customer matched — search and pick the right one.</span>`}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><input type="text" id="prop-custq" placeholder="search name / phone / address" style="width:260px" value="${esc(s.customer_name || "")}"/><button class="btn" id="prop-custsearch">Search</button></div>
      <div id="prop-custresults" style="margin-top:8px"></div>
    </div>
    <div class="card"><h3>Line items <span class="muted" style="font-weight:400">— edit before pushing</span></h3><div id="prop-items"></div></div>
    <div class="card"><h3>Push target — existing estimate</h3><div id="prop-estwrap"></div></div>
    <div class="saverow">
      <button class="btn primary" id="prop-push" ${isPushed ? "disabled" : ""}>⬆ Push line items to this estimate</button>
      <button class="btn" id="prop-save">Save edits</button>
      <button class="btn" id="prop-reject" style="margin-left:auto">${isPushed ? "Archive" : "Reject"}</button>
    </div>
    <div class="out" id="prop-out"></div>
    <div class="card" style="margin-top:12px"><h3>Raw submission <button class="btn" id="prop-rawtoggle" style="float:right">show</button></h3><pre id="prop-raw" class="hide" style="white-space:pre-wrap;font-size:11px;color:var(--muted);max-height:300px;overflow:auto;margin:0"></pre></div>`;

  function drawItems() {
    const host = $("prop-items");
    host.innerHTML = items.map((it, i) => `<div data-li-row="${i}" style="display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px solid var(--line)">
        <input type="text" data-k="name" data-i="${i}" value="${esc(it.name || "")}" style="flex:1;min-width:120px" placeholder="Item name"/>
        <input type="text" data-k="qty" data-i="${i}" value="${esc(it.quantity == null ? 1 : it.quantity)}" style="width:50px;text-align:center" title="Qty"/>
        <span class="muted">$</span><input type="text" data-k="price" data-i="${i}" value="${priceDollars(it.unit_price_cents)}" style="width:92px;text-align:right" title="Unit price"/>
        <button class="btn" data-li-del="${i}" title="Remove">✕</button>
      </div>`).join("") +
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px"><button class="btn" id="prop-additem">＋ Add line</button><div>Total: <b id="prop-total">${money(totalCents())}</b></div></div>`;
    host.querySelectorAll("input[data-k]").forEach((inp) => inp.addEventListener("input", () => {
      const i = +inp.getAttribute("data-i"), k = inp.getAttribute("data-k");
      if (k === "name") items[i].name = inp.value;
      else if (k === "qty") items[i].quantity = Number(inp.value) || 1;
      else if (k === "price") items[i].unit_price_cents = Math.round((Number(inp.value) || 0) * 100);
      $("prop-total").textContent = money(totalCents());
    }));
    $("prop-additem").addEventListener("click", () => { items.push({ name: "", description: "", quantity: 1, unit_price_cents: 0, kind: "materials", taxable: false }); drawItems(); });
    host.querySelectorAll("[data-li-del]").forEach((b) => b.addEventListener("click", () => { items.splice(+b.getAttribute("data-li-del"), 1); drawItems(); }));
  }
  function estOptionsHtml() {
    return estimates.flatMap((e) => (e.options && e.options.length ? e.options : [{ option_id: "", name: "(no option)", total: "" }]).map((o) => {
      const val = `${e.estimate_id}::${o.option_id}`;
      const sel = (e.estimate_id === estId && o.option_id === optId) ? "selected" : "";
      return `<option value="${esc(val)}" ${sel}>${esc(e.label)} · ${esc(o.name)} ${esc(o.total || "")}${e.status ? " [" + esc(e.status) + "]" : ""}</option>`;
    })).join("");
  }
  function readEst() { const sel = $("prop-est"); if (sel && sel.value) { const p = sel.value.split("::"); estId = p[0]; optId = p[1] || ""; } }
  function rebuildEst() {
    const w = $("prop-estwrap");
    w.innerHTML = estimates.length
      ? `<select id="prop-est">${estOptionsHtml()}</select><p class="faint" style="font-size:11px;margin:8px 0 0">Line items are appended to the option you pick. Existing items on the estimate are kept.</p>`
      : `<div class="muted">No estimates found for this customer. Create one in Housecall Pro first, then <button class="btn" id="prop-reloadest" style="padding:4px 9px">reload</button>.</div>`;
    const sel = $("prop-est"); if (sel) { readEst(); sel.addEventListener("change", readEst); }
    const rl = $("prop-reloadest"); if (rl) rl.addEventListener("click", async () => { if (!custId) return; const ed = await estApi("customer_estimates", { customer_id: custId }); estimates = (ed && ed.estimates) || []; rebuildEst(); });
  }
  drawItems();
  rebuildEst();

  $("prop-back").onclick = renderProposals;
  $("prop-rawtoggle").onclick = () => { const pre = $("prop-raw"); const showing = !pre.classList.contains("hide"); if (showing) { pre.classList.add("hide"); $("prop-rawtoggle").textContent = "show"; } else { pre.textContent = JSON.stringify(s.raw || {}, null, 2); pre.classList.remove("hide"); $("prop-rawtoggle").textContent = "hide"; } };
  $("prop-custsearch").onclick = async () => {
    const q = $("prop-custq").value.trim(); if (!q) return;
    $("prop-custresults").innerHTML = `<span class="muted">Searching…</span>`;
    const r = await estApi("search_customer", { query: q });
    const cs = (r && r.customers) || [];
    $("prop-custresults").innerHTML = cs.length
      ? cs.map((c) => `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line)"><div style="flex:1;min-width:0"><b>${esc(c.name)}</b> <span class="muted">${esc(fmtPhone(c.mobile))}</span><br><span class="faint" style="font-size:11px">${esc((c.addresses || [])[0] || "")}</span></div><button class="btn" data-pick="${esc(c.id)}" data-picklabel="${esc(c.name)}">Use</button></div>`).join("")
      : `<span class="muted">No customers found for "${esc(q)}".</span>`;
    $("prop-custresults").querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", async () => {
      custId = b.getAttribute("data-pick"); custLabel = b.getAttribute("data-picklabel");
      $("prop-custlabel").innerHTML = `Matched: <b style="color:var(--text)">${esc(custLabel)}</b>`;
      $("prop-custresults").innerHTML = `<span class="muted">Loading estimates…</span>`;
      const ed = await estApi("customer_estimates", { customer_id: custId });
      estimates = (ed && ed.estimates) || []; estId = ""; optId = "";
      $("prop-custresults").innerHTML = "";
      rebuildEst();
    }));
  };
  $("prop-save").onclick = async () => {
    showOut("prop-out", "Saving…");
    const r = await estApi("save", { id, items, candidate_customer_id: custId, candidate_customer_label: custLabel, candidate_estimate_id: estId, candidate_option_id: optId });
    showOut("prop-out", r && r.ok ? "Saved." : "Save failed: " + ((r && r.error) || "error"));
  };
  $("prop-reject").onclick = async () => { if (!confirm("Reject / archive this proposal?")) return; await estApi("reject", { id }); renderProposals(); };
  $("prop-push").onclick = async () => {
    readEst();
    if (!custId) { showOut("prop-out", "Pick the customer first."); return; }
    if (!estId || !optId) { showOut("prop-out", "Pick an estimate + option to push to."); return; }
    if (!items.length) { showOut("prop-out", "There are no line items to push."); return; }
    if (!confirm(`Push ${items.length} line item(s) totaling ${money(totalCents())} onto this Housecall Pro estimate?`)) return;
    const btn = $("prop-push"); btn.disabled = true; btn.textContent = "Pushing…";
    const r = await estApi("push", { id, estimate_id: estId, option_id: optId, items });
    if (r && r.ok) { alert("✓ Pushed to Housecall Pro."); renderProposals(); }
    else { btn.disabled = false; btn.textContent = "⬆ Push line items to this estimate"; showOut("prop-out", "Push failed: " + ((r && r.error) || "error")); }
  };
}

// ---------- Notification sound (desktop chime) ----------
function beepDefault() { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = "sine"; o.frequency.value = 660; g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5); o.start(); o.stop(ctx.currentTime + 0.52); } catch (_e) {} }
async function renderSounds() {
  const m = $("main");
  m.innerHTML = `<h2 class="sec">Notification sound</h2><p class="sub">Loading…</p>`;
  const d = await hub("notify_sound");
  const cur = d && d.url;
  m.innerHTML = `
    <h2 class="sec">Notification sound</h2>
    <p class="sub">The chime the <b>desktop extension</b> plays when a new item lands in the Inbox. Upload your own MP3/WAV. (The phone app alerts you by text instead, so this is the desktop sound.)</p>
    <div class="card">
      <h3>Current sound</h3>
      <p class="muted" id="snd-cur">${cur ? "Custom sound is set." : "Using the built-in chime."}</p>
      <audio id="snd-audio" ${cur ? `src="${esc(cur)}"` : ""} preload="none"></audio>
      <div class="saverow">
        <button class="btn" id="snd-test" style="width:auto">▶ Test</button>
        <input type="file" id="snd-file" accept="audio/*" style="display:none"/>
        <button class="btn primary" id="snd-upload" style="width:auto">Upload a sound</button>
        ${cur ? `<button class="btn ghost" id="snd-clear" style="width:auto">Use default</button>` : ""}
      </div>
      <div class="out" id="snd-out"></div>
    </div>`;
  $("snd-test").onclick = () => { const a = $("snd-audio"); if (a && a.getAttribute("src")) { a.currentTime = 0; a.play().catch(() => {}); } else beepDefault(); };
  $("snd-upload").onclick = () => $("snd-file").click();
  $("snd-file").onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    showOut("snd-out", "Uploading…");
    try {
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
      const up = await api("mms-upload", { token: TOKEN, content_type: f.type || "audio/mpeg", data: String(dataUrl), filename: f.name || "chime" });
      if (!up || !up.url) { showOut("snd-out", (up && up.error) || "Upload failed"); return; }
      const sv = await hub("notify_sound_save", { url: up.url });
      if (sv && sv.ok) renderSounds(); else showOut("snd-out", (sv && sv.error) || "Save failed");
    } catch (err) { showOut("snd-out", String((err && err.message) || err)); }
  };
  const clr = $("snd-clear"); if (clr) clr.onclick = async () => { await hub("notify_sound_save", { url: null }); renderSounds(); };
}

// ---------- Claude's tools (read-only catalog from app_config 'claude_tools') ----------
async function renderTools() {
  const m = $("main");
  m.innerHTML = `<h2 class="sec">Claude's tools</h2><p class="sub">Loading…</p>`;
  const d = await hub("claude_tools");
  const tools = Array.isArray(d.tools) ? d.tools : [];
  const reads = tools.filter((t) => t.kind === "read");
  const writes = tools.filter((t) => t.kind === "write");
  const row = (t) => `<tr>
    <td><span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:var(--text)">${esc(t.name)}</span>${t.tested ? ` <span class="pill ok">tested</span>` : ""}</td>
    <td>${esc(t.summary)}</td>
    <td class="faint">${esc(t.group || "")}</td></tr>`;
  const tbl = (rows) => `<table><thead><tr><th>Tool</th><th>What Claude uses it for</th><th>Area</th></tr></thead><tbody>${rows.map(row).join("")}</tbody></table>`;
  m.innerHTML = `
    <h2 class="sec">Claude's tools</h2>
    <p class="sub">Every action Claude's dispatch brain can take in Housecall Pro. <b>Read</b> tools just look things up or calculate. <b>Write</b> tools change live data or text a customer — and Claude always tells you exactly what it will do and waits for your yes first. ${tools.length} tools total.</p>
    <div class="card"><h3>👀 Read — look up &amp; calculate (no changes)</h3>${tbl(reads)}</div>
    <div class="card"><h3>✍️ Write — changes Housecall Pro · confirm-first</h3>${tbl(writes)}</div>
    <p class="faint" style="font-size:11px">Read live from the database (app_config → <span style="font-family:ui-monospace,monospace">claude_tools</span>). The tools themselves run inside the <span style="font-family:ui-monospace,monospace">claude-chat</span> function. "tested" = verified end-to-end against live Housecall Pro on 2026-06-08.</p>`;
}

// ---------- Financing calculator ----------
let FIN_PLANS = [];
let FIN_CARD = {};
// Customer-eligibility presets (brands low->high). Gating is always "tier and above"; arrays map to brand_keys.
const ELIG_PRESETS = [
  { label: "All brands", brands: [] },
  { label: "Comfort & above", brands: ["carrier-comfort", "carrier-performance", "carrier-infinity", "carrier-greenspeed"] },
  { label: "Performance & above", brands: ["carrier-performance", "carrier-infinity", "carrier-greenspeed"] },
  { label: "Infinity & above", brands: ["carrier-infinity", "carrier-greenspeed"] },
  { label: "Greenspeed only", brands: ["carrier-greenspeed"] },
];
function eligKey(arr) { return (Array.isArray(arr) ? arr : []).slice().sort().join(","); }
function eligPresetIndex(arr) { const k = eligKey(arr); for (let i = 0; i < ELIG_PRESETS.length; i++) { if (eligKey(ELIG_PRESETS[i].brands) === k) return i; } return -1; }
// Term in months: explicit months wins; else for 0% APR derive from factor (100/factor); else open-ended.
function termMonths(p) { if (p.months) return Math.round(Number(p.months)); if (Number(p.apr) === 0 && Number(p.factor) > 0) return Math.round(100 / Number(p.factor)); return null; }
function termLabel(p) { const m = termMonths(p); return m ? (m + " mo") : "until paid in full"; }
async function renderFinance() {
  const m = $("main");
  m.innerHTML = `<h2 class="sec">Financing calculator</h2><p class="sub">Loading…</p>`;
  const d = await hub("finance_plans");
  FIN_PLANS = Array.isArray(d.plans) ? d.plans : [];
  FIN_CARD = (d && d.card) ? d.card : {};
  m.innerHTML = `
    <h2 class="sec">Financing calculator</h2>
    <p class="sub">Monthly payment = amount × payment factor. The dealer fee (your cost) and net are internal — never share them with a customer.</p>
    <div class="card">
      <h3>Quote a monthly payment</h3>
      <div class="row2" style="align-items:flex-end">
        <div><label>Financed amount ($)</label><input type="text" id="fin-amt" placeholder="12999"/></div>
        <div style="flex:0 0 auto"><button class="btn primary" id="fin-calc">Calculate</button></div>
      </div>
      <div id="fin-results" style="margin-top:14px"></div>
    </div>
    <div class="card">
      <h3>Financing plans</h3>
      <p class="muted" style="margin:0 0 10px;font-size:12px">Keep these current with your lender's plan sheet. Factor and dealer fee are percentages (e.g. 1.25, 8.7).</p>
      <table><thead><tr><th>Plan code</th><th>APR %</th><th>Payment factor %</th><th>Months</th><th>Dealer fee %</th><th>Show on card</th><th>Customer eligibility</th><th></th></tr></thead><tbody id="fin-rows"></tbody></table>
      <div style="margin-top:10px;display:flex;gap:10px;align-items:center"><button class="btn" id="fin-add">+ Add plan</button><button class="btn primary" id="fin-save">Save plans</button><span class="saved" id="fin-saved">Saved ✓</span></div>
      <div class="out" id="fin-out"></div>
    </div>
    <div class="card">
      <h3>Customer card settings</h3>
      <p class="muted" style="margin:0 0 10px;font-size:12px">Controls the financing chip the customer sees on the quote / presentation app. The minimum hides the chip on small repairs.</p>
      <div class="row2">
        <div><label>Apply link URL</label><input type="text" id="fc-url" placeholder="/financing"/></div>
        <div><label>Minimum financed amount ($)</label><input type="text" id="fc-min" placeholder="1000" style="width:150px"/></div>
        <div><label>Default lender</label><input type="text" id="fc-lender" placeholder="Synchrony" style="width:160px"/></div>
      </div>
      <label>Disclosure (fine print under the payment)</label>
      <textarea id="fc-disc" placeholder="Subject to credit approval..."></textarea>
      <div class="saverow"><button class="btn primary" id="fc-save">Save card settings</button><span class="saved" id="fc-saved">Saved &#10003;</span></div>
      <div class="out" id="fc-out"></div>
    </div>`;
  paintFinRows();
  $("fin-calc").addEventListener("click", finCalc);
  $("fin-amt").addEventListener("keydown", (e) => { if (e.key === "Enter") finCalc(); });
  $("fin-add").addEventListener("click", () => { FIN_PLANS.push({ code: "", apr: 0, factor: 0, dealer_fee: 0, name: "Financing" }); paintFinRows(); });
  $("fin-save").addEventListener("click", finSave);
  $("fc-url").value = FIN_CARD.apply_url || "/financing";
  $("fc-min").value = (FIN_CARD.min_amount != null) ? FIN_CARD.min_amount : "";
  $("fc-lender").value = FIN_CARD.lender_default || "Synchrony";
  $("fc-disc").value = FIN_CARD.disclosure || "";
  $("fc-save").addEventListener("click", finCardSave);
}
function paintFinRows() {
  const tb = $("fin-rows");
  tb.innerHTML = FIN_PLANS.map((p, i) => { const dm = (Number(p.apr) === 0 && Number(p.factor) > 0) ? Math.round(100 / Number(p.factor)) : ""; const ei = eligPresetIndex(p.eligible_brands); return `<tr>
    <td><input type="text" data-i="${i}" data-k="code" value="${esc(p.code)}" style="width:90px"/></td>
    <td><input type="text" data-i="${i}" data-k="apr" value="${esc(p.apr)}" style="width:70px"/></td>
    <td><input type="text" data-i="${i}" data-k="factor" value="${esc(p.factor)}" style="width:90px"/></td>
    <td><input type="text" data-i="${i}" data-k="months" value="${esc(p.months || "")}" placeholder="${dm || "open"}" style="width:80px"/></td>
    <td><input type="text" data-i="${i}" data-k="dealer_fee" value="${esc(p.dealer_fee)}" style="width:80px"/></td>
    <td style="text-align:center"><input type="checkbox" class="fin-show" data-i="${i}" ${p.show_on_card ? "checked" : ""}/></td>
    <td><select class="fin-elig" data-i="${i}" style="width:165px">${ELIG_PRESETS.map((pr, pi) => `<option value="${pi}" ${ei === pi ? "selected" : ""}>${pr.label}</option>`).join("")}${ei < 0 ? `<option value="custom" selected>Custom (kept)</option>` : ""}</select></td>
    <td><button class="btn" data-del="${i}" style="padding:5px 10px">✕</button></td>
  </tr>`; }).join("");
  tb.querySelectorAll("input[type=text]").forEach((inp) => inp.addEventListener("input", () => { const i = +inp.dataset.i, k = inp.dataset.k; FIN_PLANS[i][k] = (k === "code") ? inp.value : (parseFloat(inp.value) || 0); }));
  tb.querySelectorAll("input.fin-show").forEach((cb) => cb.addEventListener("change", () => { FIN_PLANS[+cb.dataset.i].show_on_card = cb.checked; }));
  tb.querySelectorAll("select.fin-elig").forEach((sel) => sel.addEventListener("change", () => { const v = sel.value; if (v !== "custom") FIN_PLANS[+sel.dataset.i].eligible_brands = ELIG_PRESETS[+v].brands.slice(); }));
  tb.querySelectorAll("button[data-del]").forEach((b) => b.addEventListener("click", () => { FIN_PLANS.splice(+b.dataset.del, 1); paintFinRows(); }));
}
function finCalc() {
  const amt = parseFloat(String($("fin-amt").value).replace(/[^0-9.]/g, "")) || 0;
  if (!amt) { $("fin-results").innerHTML = `<div class="muted">Enter an amount.</div>`; return; }
  const rows = FIN_PLANS.map((p) => {
    const monthly = amt * (p.factor / 100), cost = amt * (p.dealer_fee / 100), t = termMonths(p);
    return `<tr><td>${esc(p.code || (p.apr + "%"))}<div class="faint" style="font-size:11px">${esc(p.apr)}% APR · ${termLabel(p)}</div></td>
      <td><span style="font-size:16px;font-weight:800;color:var(--accent)">$${monthly.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo</span><div class="faint" style="font-size:11px">${t ? ("for " + t + " months at " + esc(p.apr) + "% APR") : (esc(p.apr) + "% APR · until paid in full")}</div></td>
      <td class="muted">$${cost.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
      <td class="muted">$${(amt - cost).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td></tr>`;
  }).join("");
  $("fin-results").innerHTML = `<table><thead><tr><th>Plan</th><th>Customer pays</th><th>Your cost</th><th>Net to you</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="faint" style="font-size:11px;margin-top:8px">⚠ Only "Customer pays" is for the customer. "Your cost" (dealer fee) and "Net" are internal. Estimate only — the lender confirms final terms.</div>`;
}
async function finSave() {
  const b = $("fin-save"); b.disabled = true; b.textContent = "Saving…";
  const r = await hub("finance_save", { plans: FIN_PLANS });
  b.disabled = false; b.textContent = "Save plans";
  if (r && r.ok) { FIN_PLANS = r.plans; paintFinRows(); $("fin-saved").classList.add("show"); setTimeout(() => $("fin-saved").classList.remove("show"), 1800); }
  else showOut("fin-out", (r && r.error) || "Save failed");
}
async function finCardSave() {
  const b = $("fc-save"); b.disabled = true; b.textContent = "Saving...";
  const card = { apply_url: $("fc-url").value.trim(), min_amount: parseFloat(String($("fc-min").value).replace(/[^0-9.]/g, "")) || 0, lender_default: $("fc-lender").value.trim(), disclosure: $("fc-disc").value.trim() };
  const r = await hub("finance_card_save", { card });
  b.disabled = false; b.textContent = "Save card settings";
  if (r && r.ok) { FIN_CARD = r.card; $("fc-saved").classList.add("show"); setTimeout(() => $("fc-saved").classList.remove("show"), 1800); }
  else showOut("fc-out", (r && r.error) || "Save failed");
}

// ---------- Repair tiers (source of truth for the presentation app + brain) ----------
// Edits app_config.repair_tiers (cents). slug/level/service_item_id are immutable (tie to HCP);
// you edit name + min/typical/max ($). typical = slider default; min/max = slider bounds.
let REPAIR_TIERS = [], REPAIR_OVERRIDE_PCT = 100;
async function renderRepairTiers() {
  const m = $("main");
  m.innerHTML = `<h2 class="sec">Repair tiers</h2><p class="sub">Loading…</p>`;
  const d = await hub("repair_tiers_list");
  REPAIR_TIERS = (d && d.tiers) ? d.tiers : [];
  REPAIR_OVERRIDE_PCT = (d && d.override_max_pct != null) ? d.override_max_pct : 100;
  m.innerHTML = `
    <h2 class="sec">Repair tiers</h2>
    <p class="sub">These prices are the <b>single source of truth</b> for repair pricing — the presentation app's repair slider and the brain both pull them live from here. <b>Typical</b> is the slider's default; <b>Min/Max</b> are the slider bounds. Edits go live immediately.</p>
    <div class="card">
      <table>
        <thead><tr><th>Level</th><th>Name (customer-facing)</th><th>Min $</th><th>Typical $</th><th>Max $</th></tr></thead>
        <tbody id="rt-rows"></tbody>
      </table>
      <div style="margin-top:14px;display:flex;align-items:flex-end;gap:12px">
        <div><label>Tech override cap above Max (%)</label><input type="text" id="rt-override" value="${esc(REPAIR_OVERRIDE_PCT)}" style="width:90px"/></div>
        <div class="faint" style="font-size:11px;max-width:380px">How far above a tier's Max the tech's slider may go for unusually expensive (OEM-only) parts. 100% = up to double the Max.</div>
      </div>
      <div style="margin-top:10px;display:flex;gap:10px;align-items:center"><button class="btn primary" id="rt-save">Save repair tiers</button><span class="saved" id="rt-saved">Saved ✓</span></div>
      <div class="faint" style="font-size:11px;margin-top:8px">Each tier maps to a real Housecall Pro service item (used when booking the repair). Need min ≤ typical ≤ max. Set Min = Max for a flat-price tier (slider won't move).</div>
      <div class="out" id="rt-out"></div>
    </div>`;
  paintRepairTierRows();
  $("rt-save").addEventListener("click", saveRepairTiers);
}
function paintRepairTierRows() {
  const tb = $("rt-rows"); if (!tb) return;
  const dol = (c) => (Number(c) || 0) / 100;
  tb.innerHTML = REPAIR_TIERS.map((t, i) => `<tr>
    <td><b>${esc(t.level)}</b></td>
    <td><input type="text" data-i="${i}" data-k="name" value="${esc(t.name)}" style="width:230px"/></td>
    <td><input type="text" data-i="${i}" data-k="min" value="${dol(t.min_cents)}" style="width:80px" inputmode="numeric"/></td>
    <td><input type="text" data-i="${i}" data-k="typical" value="${dol(t.typical_cents)}" style="width:80px" inputmode="numeric"/></td>
    <td><input type="text" data-i="${i}" data-k="max" value="${dol(t.max_cents)}" style="width:80px" inputmode="numeric"/></td>
  </tr>`).join("");
  tb.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
    const i = +inp.dataset.i, k = inp.dataset.k;
    if (k === "name") REPAIR_TIERS[i].name = inp.value;
    else REPAIR_TIERS[i][k + "_cents"] = Math.round((parseFloat(String(inp.value).replace(/[^0-9.]/g, "")) || 0) * 100);
  }));
}
async function saveRepairTiers() {
  const b = $("rt-save"); b.disabled = true; b.textContent = "Saving…";
  const pct = parseFloat(String($("rt-override").value).replace(/[^0-9.]/g, ""));
  const r = await hub("repair_tiers_save", { tiers: REPAIR_TIERS, override_max_pct: isNaN(pct) ? undefined : pct });
  b.disabled = false; b.textContent = "Save repair tiers";
  if (r && r.ok) { REPAIR_TIERS = r.tiers; paintRepairTierRows(); $("rt-saved").classList.add("show"); setTimeout(() => $("rt-saved").classList.remove("show"), 1800); }
  else showOut("rt-out", (r && r.error) || "Save failed");
}

// ---------- Price builder (cost -> sell across every matchup) ----------
let BUILDER = { tax_rate: 0.0825, materials_cents: 50000, labor_cents: 100000, overhead_cents: 0, tiers: [] };
let BUILDER_ROWS = [];
const bToD = (c) => c == null ? "" : Math.round(Number(c) / 100);
const bCell = (c) => c == null ? '<span class="muted">--</span>' : "$" + Math.round(Number(c) / 100).toLocaleString("en-US");
function paintBuilderTiers() {
  const tb = $("b-tiers");
  tb.innerHTML = BUILDER.tiers.map((t, i) => `<tr>
    <td><b>${esc(t.label)}</b></td>
    <td>$ <input type="text" data-i="${i}" data-k="profit" value="${bToD(t.profit_cents)}" style="width:100px" inputmode="numeric"/></td>
    <td><input type="text" data-i="${i}" data-k="finance" value="${esc(t.discount_pct)}" style="width:80px" inputmode="numeric"/> %</td>
  </tr>`).join("");
  tb.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
    const i = +inp.dataset.i, k = inp.dataset.k, v = parseFloat(String(inp.value).replace(/[^0-9.]/g, "")) || 0;
    if (k === "profit") BUILDER.tiers[i].profit_cents = Math.round(v * 100); else BUILDER.tiers[i].discount_pct = v;
  }));
}
function collectBuilderConfig() {
  const tiers = {};
  BUILDER.tiers.forEach((t) => { tiers[t.brand_key] = { profit_cents: Number(t.profit_cents) || 0, discount_pct: Number(t.discount_pct) || 0 }; });
  return {
    tax_rate: parseFloat($("b-tax").value) || 0,
    materials_cents: Math.round((parseFloat(String($("b-mat").value).replace(/[^0-9.]/g, "")) || 0) * 100),
    labor_cents: Math.round((parseFloat(String($("b-lab").value).replace(/[^0-9.]/g, "")) || 0) * 100),
    overhead_cents: Math.round((parseFloat(String($("b-oh").value).replace(/[^0-9.]/g, "")) || 0) * 100),
    tiers,
  };
}
async function builderPreview() {
  const b = $("b-preview"); b.disabled = true; b.textContent = "Computing...";
  const r = await hub("builder_compute", { config: collectBuilderConfig() });
  b.disabled = false; b.textContent = "Preview all prices";
  if (!r || !r.ok) { showOut("b-out", (r && r.error) || "Preview failed"); return; }
  BUILDER_ROWS = r.rows || []; paintBuilderPreview();
}
function paintBuilderPreview() {
  const card = $("b-preview-card"); card.style.display = "block";
  const noCost = BUILDER_ROWS.filter((r) => r.no_cost).length;
  const cnt = $("b-preview-count"); if (cnt) cnt.textContent = `- ${BUILDER_ROWS.length} matchups${noCost ? ` - ${noCost} skipped (no Pricebook cost)` : ""}`;
  const head = `<thead><tr><th>Matchup</th><th>Heat</th><th>Ton</th><th>Equip+tax</th><th>Total cost</th><th>Profit</th><th>New cash</th><th>New financed</th><th>Margin</th><th>Cash change</th></tr></thead>`;
  const body = BUILDER_ROWS.map((r) => {
    const chg = (r.old_cash_cents != null && r.new_cash_cents != null) ? `${bCell(r.old_cash_cents)} -> <b>${bCell(r.new_cash_cents)}</b>` : (r.no_cost ? '<span style="color:#f43f5e">no cost</span>' : bCell(r.new_cash_cents));
    return `<tr style="${r.no_cost ? "opacity:.5" : ""}"><td style="font-size:12px">${esc(r.label)}</td><td class="muted" style="font-size:12px">${esc(r.heat)}</td><td>${esc(r.tonnage)}</td><td class="muted">${bCell(r.cost_with_tax_cents)}</td><td class="muted">${bCell(r.total_cost_cents)}</td><td class="muted">${bCell(r.profit_cents)}</td><td style="font-weight:700">${bCell(r.new_cash_cents)}</td><td style="font-weight:700">${bCell(r.new_sticker_cents)}</td><td>${r.margin_pct == null ? "--" : r.margin_pct + "%"}</td><td style="font-size:12px">${chg}</td></tr>`;
  }).join("");
  $("b-preview-table").innerHTML = head + `<tbody>${body}</tbody>`;
}
async function builderApply() {
  if (!confirm("This overwrites the CASH and FINANCED price for every matchup that has a Pricebook cost -- these are your LIVE website prices. Continue?")) return;
  const b = $("b-apply"); b.disabled = true; b.textContent = "Applying...";
  const r = await hub("builder_apply", { config: collectBuilderConfig() });
  b.disabled = false; b.textContent = "Apply to all matchups";
  if (r && r.ok) { showOut("b-out", `Applied to ${r.applied} of ${r.total} matchups. Live website prices updated.`); $("b-saved").classList.add("show"); setTimeout(() => $("b-saved").classList.remove("show"), 2000); setTimeout(renderMargins, 1200); }
  else showOut("b-out", (r && r.error) || "Apply failed");
}

// ---------- Margins & pricing (equipment cost+tax vs live sell; profit per matchup) ----------
// Joins live sell prices (pricing_matrix.cash = what the website quoter shows) to equipment
// cost (pricebook_systems) the SAME way the quoter matches them. Profit = sell − cost×(1+tax).
// Editing a sell price here writes straight to pricing_matrix → changes the LIVE website price.
let MARGIN_ROWS = [], MARGIN_TAX = 0.0825, MARGIN_MATERIALS = 50000, MARGIN_LABOR = 100000, MARGIN_CASH = { enabled: false, cash_discount_pct: 10 };
const dollars = (c) => c == null ? "—" : "$" + Math.round(c / 100).toLocaleString("en-US");
// Net-margin thresholds (after full COGS incl. labor): green ≥30% · amber 18–30% · red <18%.
function marginColor(p) { if (p == null) return "var(--muted)"; if (p < 18) return "#f43f5e"; if (p < 30) return "#fbbf24"; return "#22c55e"; }
async function renderMargins() {
  const m = $("main");
  m.innerHTML = `<h2 class="sec">Pricing</h2><p class="sub">Loading…</p>`;
  const d = await hub("margins_list");
  MARGIN_ROWS = (d && d.rows) || [];
  MARGIN_TAX = (d && d.tax_rate != null) ? d.tax_rate : 0.0825;
  MARGIN_MATERIALS = (d && d.materials_cents != null) ? d.materials_cents : 50000;
  MARGIN_LABOR = (d && d.labor_cents != null) ? d.labor_cents : 100000;
  MARGIN_CASH = (d && d.cash_pricing) ? d.cash_pricing : { enabled: false, cash_discount_pct: 10 };
  const bd = await hub("builder_get");
  if (bd && bd.ok) BUILDER = { tax_rate: bd.tax_rate, materials_cents: bd.materials_cents, labor_cents: bd.labor_cents, overhead_cents: bd.overhead_cents, tiers: bd.tiers || [] };
  // brand roll-up (avg margin) so the overpriced/underpriced brand jumps out
  const byBrand = {};
  MARGIN_ROWS.forEach((r) => { if (r.margin_pct == null) return; (byBrand[r.brand] = byBrand[r.brand] || []).push(r.margin_pct); });
  const brandSummary = Object.keys(byBrand).sort().map((b) => { const a = byBrand[b]; const avg = Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10; return `<span style="margin-right:16px"><b>${esc(b)}</b>: avg margin <b style="color:${marginColor(avg)}">${avg}%</b> <span class="faint">(${a.length})</span></span>`; }).join("");
  m.innerHTML = `
    <h2 class="sec">Pricing</h2>
    <p class="sub">Net profit per matchup = your live sell price (what the website quotes) minus full COGS: equipment + tax + materials + labor. <b>Editing a sell price here changes your live website price.</b></p>
    <div class="card">
      <h3>Build prices from cost</h3>
      <p class="muted" style="margin:0 0 10px;font-size:12px">Equipment cost (Pricebook) + tax + materials + labor + overhead = total cost; + profit $ = cash; financed = cash / (1 - discount %). Preview, then Apply to all matchups (overwrites live prices).</p>
      <div class="row2" style="align-items:flex-end;flex-wrap:wrap;gap:14px">
        <div><label>Equipment tax (0.0825 = 8.25%)</label><input type="text" id="b-tax" value="${esc(BUILDER.tax_rate)}" style="width:120px"/></div>
        <div><label>Materials/job ($)</label><input type="text" id="b-mat" value="${bToD(BUILDER.materials_cents)}" style="width:100px"/></div>
        <div><label>Labor/job ($)</label><input type="text" id="b-lab" value="${bToD(BUILDER.labor_cents)}" style="width:100px"/></div>
        <div><label>Overhead/job ($)</label><input type="text" id="b-oh" value="${bToD(BUILDER.overhead_cents)}" style="width:100px"/></div>
      </div>
      <table style="margin-top:12px"><thead><tr><th>Brand line</th><th>Profit $ (per install)</th><th>Cash discount %</th></tr></thead><tbody id="b-tiers"></tbody></table>
      <div class="saverow"><button class="btn" id="b-preview">Preview all prices</button><button class="btn primary" id="b-apply">Apply to all matchups</button><span class="saved" id="b-saved">Applied &#10003;</span></div>
      <div class="out" id="b-out"></div>
      <div id="b-preview-card" style="display:none;margin-top:12px"><div class="faint" id="b-preview-count" style="font-size:12px;margin-bottom:6px"></div><div style="overflow:auto"><table id="b-preview-table"></table></div></div>
    </div>
    <div class="card"><h3>Sale / promo (shows on website + quotes)</h3>
      <p class="muted" style="font-size:12px">One place to control the limited-time discount. Turn it off when the sale ends - the website, tech quoter, and widget all follow instantly.</p>
      <div id="pb-promo"><div class="muted">Loading...</div></div></div>    <div class="card" style="border:1px solid ${MARGIN_CASH.enabled ? '#22c55e' : 'var(--border-strong)'}">
      <h3 style="margin:0 0 6px">Cash vs financing pricing ${MARGIN_CASH.enabled ? '<span class="pill ok">LIVE</span>' : '<span class="pill" style="background:rgba(148,163,184,.2);color:var(--muted)">DISABLED — preview only</span>'}</h3>
      <p class="muted" style="margin:0 0 10px;font-size:12px">Plan: financed customers pay a markup; cash/check/card save the discount % below (lands back on your current price). <b>While disabled, the website still shows your current single price — turn this on only after the site shows the "save X% with cash" message.</b></p>
      <div class="row2" style="align-items:flex-end;flex-wrap:wrap;gap:14px">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" id="mg-cash-on" ${MARGIN_CASH.enabled ? "checked" : ""}/> Enable cash/financing pricing (go live)</label>
        <div><label>Cash discount %</label><input type="text" id="mg-cash-disc" value="${esc(MARGIN_CASH.cash_discount_pct)}" style="width:80px"/></div>
        <div style="flex:0 0 auto"><button class="btn" id="mg-cash-save">Save plan</button></div>
      </div>
      <div class="faint" style="font-size:11px;margin-top:6px">Financed price = current ÷ (1 − discount). At ${esc(MARGIN_CASH.cash_discount_pct)}%: financed ≈ current × ${(1/(1-(Number(MARGIN_CASH.cash_discount_pct)||10)/100)).toFixed(3)}. Credit-card fee is already covered in your margins.</div>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Matchup</th><th>Heat</th><th>Ton</th><th>Equip+tax</th><th>Total COGS</th><th>Cash/Sell (live)</th><th>Financed${MARGIN_CASH.enabled ? "" : " (preview)"}</th><th>Net profit $</th><th>Net margin %</th><th></th></tr></thead>
        <tbody id="mg-rows"></tbody>
      </table>
      <div class="faint" style="font-size:11px;margin-top:8px">Total COGS = equipment+tax + materials + labor. Net margin = net profit ÷ sell. Markup = net profit ÷ COGS. Green ≥30% · amber 18–30% · red &lt;18% net margin.</div>
      <div class="out" id="mg-out"></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">Recent price changes</h3>
      <p class="muted" style="margin:0 0 10px;font-size:12px">Every sell-price or COGS-setting change is logged here (who, when, old → new) so you can track what you tried and whether it moved sales.</p>
      <div id="mg-log">Loading…</div>
    </div>`;
  paintMarginRows();
  loadMarginLog();
  paintBuilderTiers();
  $("b-preview").addEventListener("click", builderPreview);
  $("b-apply").addEventListener("click", builderApply);
  wirePromoCard();
  $("mg-cash-save").addEventListener("click", async () => {
    const enabled = $("mg-cash-on").checked;
    const disc = parseFloat(String($("mg-cash-disc").value).replace(/[^0-9.]/g, ""));
    if (isNaN(disc)) { showOut("mg-out", "Enter a cash discount % (e.g. 10)."); return; }
    if (enabled && !confirm("Enabling this changes how the website prices work (financed vs cash). Make sure the website already shows the 'save " + disc + "% with cash' message. Go live now?")) return;
    const r = await hub("margins_set_cashpricing", { enabled, cash_discount_pct: disc });
    if (r && r.ok) renderMargins(); else showOut("mg-out", (r && r.error) || "Failed");
  });
}
function paintMarginRows() {
  const tb = $("mg-rows");
  tb.innerHTML = MARGIN_ROWS.map((r, i) => `<tr>
    <td style="font-size:12px">${esc(r.label)}</td>
    <td class="muted" style="font-size:12px">${esc(r.heat)}</td>
    <td>${esc(r.tonnage)}</td>
    <td class="muted">${dollars(r.cost_with_tax_cents)}${r.no_cost ? ' <span style="color:#f43f5e" title="No matching pricebook cost">⚠</span>' : ''}</td>
    <td class="muted">${dollars(r.total_cogs_cents)}</td>
    <td><input type="text" data-i="${i}" class="mg-sell" value="${r.sell_cents != null ? Math.round(r.sell_cents / 100) : ''}" style="width:80px" inputmode="numeric"/></td>
    <td style="font-weight:700">${dollars(r.sticker_cents)}</td>
    <td style="font-weight:700">${dollars(r.profit_cents)}</td>
    <td style="font-weight:800;color:${marginColor(r.margin_pct)}">${r.margin_pct == null ? "—" : r.margin_pct + "%"}</td>
    <td><button class="btn" data-save="${i}" style="padding:5px 10px">Save</button></td>
  </tr>`).join("");
  tb.querySelectorAll("button[data-save]").forEach((b) => b.addEventListener("click", () => saveMarginPrice(+b.dataset.save, b)));
}
async function loadMarginLog() {
  const el = $("mg-log"); if (!el) return;
  const d = await hub("margins_log");
  const log = (d && d.log) || [];
  if (!log.length) { el.innerHTML = `<div class="muted">No changes logged yet.</div>`; return; }
  const when = (iso) => { const t = Date.parse(iso); if (isNaN(t)) return ""; return new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  el.innerHTML = `<table><thead><tr><th>When</th><th>By</th><th>What</th><th>Old → New</th></tr></thead><tbody>${log.map((r) => {
    const what = r.scope === "config" ? esc(r.field) : `${esc(r.brand_key || "")} ${esc(r.heat_key || "")} ${esc(r.tonnage || "")}T`;
    const oldN = r.old_cents != null ? "$" + Math.round(r.old_cents / 100).toLocaleString("en-US") : (r.note ? esc(r.note) : "—");
    const newN = r.new_cents != null ? "$" + Math.round(r.new_cents / 100).toLocaleString("en-US") : "";
    const arrow = (r.old_cents != null && r.new_cents != null) ? `${oldN} → <b>${newN}</b>` : (r.note ? esc(r.note) : `${oldN}${newN ? " → " + newN : ""}`);
    return `<tr><td class="muted" style="font-size:12px">${when(r.changed_at)}</td><td style="font-size:12px">${esc(r.changed_by || "—")}</td><td style="font-size:12px">${what}</td><td style="font-size:12px">${arrow}</td></tr>`;
  }).join("")}</tbody></table>`;
}
async function saveMarginPrice(i, btn) {
  const row = MARGIN_ROWS[i];
  const inp = $("mg-rows").querySelector(`input.mg-sell[data-i="${i}"]`);
  const dollarsVal = parseFloat(String(inp.value).replace(/[^0-9.]/g, ""));
  if (!dollarsVal || dollarsVal <= 0) { showOut("mg-out", "Enter a valid sell price."); return; }
  const cash_cents = Math.round(dollarsVal * 100);
  btn.disabled = true; btn.textContent = "…";
  const r = await hub("margins_save_price", { id: row.id, cash_cents });
  btn.disabled = false; btn.textContent = "Save";
  if (r && r.ok) {
    // recompute this row's profit/margin/markup locally so the table updates instantly
    row.sell_cents = cash_cents;
    row.profit_cents = (row.total_cogs_cents != null) ? cash_cents - row.total_cogs_cents : null;
    row.margin_pct = (row.profit_cents != null && cash_cents) ? Math.round((row.profit_cents / cash_cents) * 1000) / 10 : null;
    row.markup_pct = (row.profit_cents != null && row.total_cogs_cents) ? Math.round((row.profit_cents / row.total_cogs_cents) * 1000) / 10 : null;
    { const disc = (Number(MARGIN_CASH.cash_discount_pct) || 0) / 100; row.financed_cents = (disc < 1) ? Math.round(cash_cents / (1 - disc)) : null; }
    paintMarginRows();
    loadMarginLog();
    showOut("mg-out", "Saved — live website price updated.");
    setTimeout(() => { const o = $("mg-out"); if (o) o.textContent = ""; }, 2500);
  } else showOut("mg-out", (r && r.error) || "Save failed");
}

// ---------- IVR / phone ----------
// Per-day business-hours editor (Service press-1 + Sales press-2). Stored in
// ivr_config.service_hours / sales_hours as {mon..sun: ["HH:MM","HH:MM"] | null}; twilio-voice-ivr
// reads them each call to decide forward-vs-voicemail. Fully editable here — nothing hard-coded.
function hoursRows(prefix, hours) {
  const days = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
  return days.map(([k, label]) => {
    const r = hours && hours[k]; const open = Array.isArray(r) && r.length >= 2;
    const o = open ? r[0] : "08:00", cl = open ? r[1] : "17:00";
    return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line)">
      <label style="width:86px;margin:0;color:var(--text);font-weight:600">${label}</label>
      <label style="display:flex;align-items:center;gap:6px;margin:0;width:78px;cursor:pointer"><input type="checkbox" data-h="${prefix}" data-day="${k}" data-f="open" ${open ? "checked" : ""} style="width:auto"/><span data-lbl="${prefix}-${k}" class="muted">${open ? "Open" : "Closed"}</span></label>
      <input type="time" data-h="${prefix}" data-day="${k}" data-f="from" value="${esc(o)}" ${open ? "" : "disabled"} style="width:128px"/>
      <span class="muted">to</span>
      <input type="time" data-h="${prefix}" data-day="${k}" data-f="to" value="${esc(cl)}" ${open ? "" : "disabled"} style="width:128px"/>
    </div>`;
  }).join("");
}
function readHours(prefix) {
  const m = $("main"); const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]; const out = {};
  days.forEach((k) => {
    const cb = m.querySelector(`input[type=checkbox][data-h="${prefix}"][data-day="${k}"][data-f="open"]`);
    if (cb && cb.checked) {
      const f = m.querySelector(`input[data-h="${prefix}"][data-day="${k}"][data-f="from"]`).value || "08:00";
      const t = m.querySelector(`input[data-h="${prefix}"][data-day="${k}"][data-f="to"]`).value || "17:00";
      out[k] = [f, t];
    } else out[k] = null;
  });
  return out;
}
function wireHoursToggles() {
  const m = $("main");
  m.querySelectorAll('input[type=checkbox][data-f="open"]').forEach((cb) => cb.addEventListener("change", () => {
    const p = cb.getAttribute("data-h"), k = cb.getAttribute("data-day");
    const from = m.querySelector(`input[data-h="${p}"][data-day="${k}"][data-f="from"]`);
    const to = m.querySelector(`input[data-h="${p}"][data-day="${k}"][data-f="to"]`);
    if (from) from.disabled = !cb.checked; if (to) to.disabled = !cb.checked;
    const lbl = m.querySelector(`[data-lbl="${p}-${k}"]`); if (lbl) lbl.textContent = cb.checked ? "Open" : "Closed";
  }));
}
async function renderIvr() {
  const m = $("main");
  m.innerHTML = `<h2 class="sec">Phone &amp; IVR</h2><p class="sub">Loading…</p>`;
  const d = await api("ivr-config", { token: TOKEN });
  const c = d.config || {};
  m.innerHTML = `
    <h2 class="sec">Phone &amp; IVR</h2>
    <p class="sub">The greeting, business hours, routing and voicemail your callers hear. Saved changes apply to the next call.</p>
    <div class="card">
      <h3>Menu greeting (spoken)</h3>
      <div style="position:relative"><textarea id="f-greeting">${esc(c.greeting_text || "")}</textarea><button class="mic" id="f-greeting-mic" title="Tap to dictate" style="position:absolute;right:8px;bottom:8px"></button></div>
      <div class="row2">
        <div><label>Service line forwards to (press 1)</label><input type="text" id="f-service" value="${esc(c.service_number || "")}"/></div>
        <div><label>Sales line forwards to (press 2)</label><input type="text" id="f-sales" value="${esc(c.sales_number || "")}"/></div>
      </div>
      <p class="sub" style="margin:6px 0 0">Calls forward to whatever number you put here, and both legs are recorded + transcribed (when "Record calls" is on). Use your own cell to take calls yourself.</p>
      <label>Sales calls go to</label>
      <div class="toggle" id="f-salesmode">
        <button data-v="cell" class="${(c.sales_mode||'cell')==='cell'?'on':''}">Cell (forward)</button>
        <button data-v="desk" class="${c.sales_mode==='desk'?'on':''}">Desk (softphone)</button>
      </div>
      <div class="row2" style="margin-top:12px">
        <div><label>IVR enabled</label><div class="toggle" id="f-enabled"><button data-v="1" class="${c.enabled!==false?'on':''}">On</button><button data-v="0" class="${c.enabled===false?'on':''}">Off</button></div></div>
        <div><label>Record calls</label><div class="toggle" id="f-record"><button data-v="1" class="${c.record_calls!==false?'on':''}">On</button><button data-v="0" class="${c.record_calls===false?'on':''}">Off</button></div></div>
      </div>
      <label>Greeting voice ID (ElevenLabs)</label><input type="text" id="f-voice" value="${esc(c.ivr_voice_id || "")}"/>
    </div>

    <div class="card">
      <h3>☎️ Answering service</h3>
      <p class="sub" style="margin:0 0 8px">Temporarily hand a department's calls to an outside answering service. The menu still plays — callers still press 1 or 2 — but any department you switch ON goes to the number below instead of your line, <b>around the clock</b>, until you switch it back off. Flip both off for normal routing.</p>
      <label>Answering service number</label><input type="text" id="f-ans-num" value="${esc(c.answering_service_number || "")}" placeholder="+1 210 555 0123"/>
      <div class="row2" style="margin-top:12px">
        <div><label>Service calls (press 1) &rarr; answering service</label><div class="toggle" id="f-ans-svc"><button data-v="1" class="${c.svc_to_answering_service===true?'on':''}">On</button><button data-v="0" class="${c.svc_to_answering_service!==true?'on':''}">Off</button></div></div>
        <div><label>Sales calls (press 2) &rarr; answering service</label><div class="toggle" id="f-ans-sales"><button data-v="1" class="${c.sales_to_answering_service===true?'on':''}">On</button><button data-v="0" class="${c.sales_to_answering_service!==true?'on':''}">Off</button></div></div>
      </div>
      <p class="sub" style="margin:8px 0 0">If you switch one ON but leave the number blank, nothing changes — we won't send calls to an empty number. If the service doesn't pick up within 30 seconds, the call falls to that department's voicemail.</p>
    </div>

    <div class="card">
      <h3>🛠️ Service hours — press 1</h3>
      <p class="sub" style="margin:0 0 6px">When Service is open, a press-1 call forwards to the number above. Outside these hours the caller goes straight to the recorded voicemail, and the greeting tells them when you'll be open again. Uncheck a day to mark it closed.</p>
      ${hoursRows("svc", c.service_hours)}
      <label style="margin-top:12px">After-hours message (spoken)</label>
      <div style="position:relative"><textarea id="f-svc-closed" placeholder="Leave blank to use the default closed message">${esc(c.service_closed_msg || "")}</textarea><button class="mic" id="f-svc-closed-mic" title="Tap to dictate" style="position:absolute;right:8px;bottom:8px"></button></div>
    </div>

    <div class="card">
      <h3>💼 Sales hours — press 2</h3>
      <p class="sub" style="margin:0 0 6px">When Sales is open, a press-2 call connects. Outside these hours the caller goes to voicemail with the message below.</p>
      ${hoursRows("sls", c.sales_hours)}
      <label style="margin-top:12px">After-hours message (spoken)</label>
      <div style="position:relative"><textarea id="f-sls-closed" placeholder="Leave blank to use the default closed message">${esc(c.sales_closed_msg || "")}</textarea><button class="mic" id="f-sls-closed-mic" title="Tap to dictate" style="position:absolute;right:8px;bottom:8px"></button></div>
    </div>

    <div class="saverow"><button class="btn primary" id="ivr-save">Save phone settings</button><span class="saved" id="ivr-saved">Saved ✓</span><span class="faint" style="margin-left:auto">Times are ${esc(c.tz || "America/Chicago")}</span></div>
    <div class="out" id="ivr-out"></div>`;
  attachMic("f-greeting","f-greeting-mic"); attachMic("f-svc-closed","f-svc-closed-mic"); attachMic("f-sls-closed","f-sls-closed-mic");
  let salesMode = c.sales_mode || "cell", enabled = c.enabled !== false, record = c.record_calls !== false;
  // Answering-service switches (2026-06-19) — independent per department, default off.
  let ansSvc = c.svc_to_answering_service === true, ansSales = c.sales_to_answering_service === true;
  wireToggle("f-salesmode", (v) => salesMode = v);
  wireToggle("f-enabled", (v) => enabled = v === "1");
  wireToggle("f-record", (v) => record = v === "1");
  wireToggle("f-ans-svc", (v) => ansSvc = v === "1");
  wireToggle("f-ans-sales", (v) => ansSales = v === "1");
  wireHoursToggles();
  $("ivr-save").addEventListener("click", async () => {
    const btn = $("ivr-save"); btn.disabled = true; btn.textContent = "Saving…";
    const set = { greeting_text: $("f-greeting").value, service_number: $("f-service").value, sales_number: $("f-sales").value, sales_mode: salesMode, enabled, record_calls: record, ivr_voice_id: $("f-voice").value, service_hours: readHours("svc"), sales_hours: readHours("sls"), service_closed_msg: $("f-svc-closed").value, sales_closed_msg: $("f-sls-closed").value, answering_service_number: $("f-ans-num").value, svc_to_answering_service: ansSvc, sales_to_answering_service: ansSales };
    const r = await api("ivr-config", { token: TOKEN, set });
    btn.disabled = false; btn.textContent = "Save phone settings";
    if (r && r.is_admin) { $("ivr-saved").classList.add("show"); setTimeout(() => $("ivr-saved").classList.remove("show"), 1800); }
    else showOut("ivr-out", (r && r.error) || "Save failed");
  });
}
function wireToggle(id, cb) {
  const el = $(id); if (!el) return;
  el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    el.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    cb(b.dataset.v);
  }));
}
function showOut(id, txt) { const o = $(id); o.textContent = txt; o.classList.add("show"); }

// ---------- Booking line items ----------
async function renderLineItems() {
  const m = $("main");
  m.innerHTML = `<h2 class="sec">Booking line items</h2><p class="sub">Loading…</p>`;
  const d = await hub("booking_map");
  const map = d.booking_line_items || {};
  const labels = { service: "Service call (default)", estimate: "Estimate / consultation", tuneup_member: "Tune-up — Comfort Club member", tuneup_standard: "Tune-up — non-member" };
  const rows = Object.keys(labels).map((k) => {
    const li = map[k] || (k === "service" ? d.service_line_item : null) || {};
    return `<tr><td>${esc(labels[k])}<div class="faint" style="font-size:11px">${esc(k)}</div></td><td>${esc(li.name || "—")}</td><td>${li.unit_price != null ? money(li.unit_price) : "—"}</td></tr>`;
  }).join("");
  m.innerHTML = `
    <h2 class="sec">Booking line items</h2>
    <p class="sub">Which Housecall Pro line item Claude attaches for each booking type. (View only here — tell me to change one and I'll update it.)</p>
    <div class="card"><table><thead><tr><th>Booking type</th><th>Line item</th><th>Price</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------- Comfort Club / membership ----------
async function renderMembership() {
  const m = $("main");
  m.innerHTML = `<h2 class="sec">Comfort Club</h2><p class="sub">Loading…</p>`;
  const s = await hub("membership_stats");
  const by = s.by_status || {};
  const stat = (k, label) => `<div class="stat"><b>${by[k] || 0}</b><span>${label}</span></div>`;
  m.innerHTML = `
    <h2 class="sec">Comfort Club</h2>
    <p class="sub">Membership is derived from install history + paid plans, synced to Housecall Pro customer tags.</p>
    <div class="card">
      <div class="statgrid">${stat("active","Active")}${stat("candidate","Candidates")}${stat("expired","Expired")}${stat("rejected","Rejected")}<div class="stat"><b>${s.total||0}</b><span>Total</span></div></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="mem-scan">🔍 Scan installs for new members</button>
        <button class="btn primary" id="mem-sync">🏷️ Sync tags in Housecall Pro</button>
      </div>
      <div class="out" id="mem-out"></div>
    </div>`;
  $("mem-scan").addEventListener("click", () => runMem("membership_scan", "mem-scan", "Scanning…"));
  $("mem-sync").addEventListener("click", () => runMem("membership_sync", "mem-sync", "Syncing…"));
}
async function runMem(action, btnId, busy) {
  const b = $(btnId); const label = b.textContent; b.disabled = true; b.textContent = busy;
  const r = await hub(action);
  b.disabled = false; b.textContent = label;
  showOut("mem-out", JSON.stringify((r && r.result) || r, null, 2));
  const s = await hub("membership_stats");
}

// ---------- Team ----------
async function renderTeam() {
  const m = $("main");
  m.innerHTML = `<h2 class="sec">Team</h2><p class="sub">Loading…</p>`;
  const d = await hub("employees");
  paintTeam(d.employees || []);
}
function paintTeam(list) {
  const m = $("main");
  const rows = list.map((e) => `<tr>
    <td>${esc(e.name)}${e.is_installer ? ` <span class="pill tech">installer</span>` : ""}</td>
    <td>${esc(e.role || "")}</td>
    <td>${fmtPhone(e.phone)}</td>
    <td>${e.service_priority != null ? e.service_priority : "—"}</td>
    <td>${e.active ? `<span class="pill ok">active</span>` : `<span class="pill">inactive</span>`}</td>
  </tr>`).join("");
  m.innerHTML = `
    <h2 class="sec">Team</h2>
    <p class="sub">Used to identify technicians when they text, route service, and check drive-time fit. Numbers come from Housecall Pro.</p>
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h3 style="margin:0">${list.length} people</h3>
        <button class="btn" id="team-sync">🔄 Re-sync cell numbers from HCP</button>
      </div>
      <table><thead><tr><th>Name</th><th>Role</th><th>Cell</th><th>Priority</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="out" id="team-out"></div>
    </div>`;
  $("team-sync").addEventListener("click", async () => {
    const b = $("team-sync"); b.disabled = true; b.textContent = "Syncing…";
    const r = await hub("employee_sync");
    b.disabled = false; b.textContent = "🔄 Re-sync cell numbers from HCP";
    if (r && r.employees) { paintTeam(r.employees); showOut("team-out", `Updated ${r.updated} number(s) from Housecall Pro.`); }
    else showOut("team-out", (r && r.error) || "Sync failed");
  });
}

boot();
// admin console: dashboard + Workspace(email/proposals/equipment)/Phone/Sales/People/System


// ---- System Health (admin) — the backend heartbeat log + recent errors/dead-letters.
// Data from health-check {action:'status'}. "Send test alert" proves SMS alerting reaches the phone.
async function renderHealth() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">System health &#10084;</h2>
    <p class="sub">A heartbeat runs every ~10 minutes and texts your cell on real failures. This is the live log.</p>
    <div class="saverow"><button class="btn" id="hc-refresh">Refresh</button> <button class="btn" id="hc-test">Send test alert to my phone</button> <span class="muted" id="hc-status"></span></div>
    <div id="hc-body" style="margin-top:12px"><div class="muted">Loading&#8230;</div></div>`;
  $("hc-refresh").addEventListener("click", renderHealth);
  $("hc-test").addEventListener("click", async () => {
    const b = $("hc-test"); b.disabled = true; b.textContent = "Sending&#8230;";
    const r = await api("health-check", { token: TOKEN, action: "test" });
    b.disabled = false; b.textContent = "Send test alert to my phone";
    $("hc-status").textContent = (r && r.ok) ? ("Sent to " + (r.to || "your cell") + " ✓") : ("Failed: " + ((r && ((r.detail && r.detail.error) || r.error)) || "error"));
  });
  const d = await api("health-check", { token: TOKEN, action: "status" });
  const el = $("hc-body");
  if (!d || d.error) { el.innerHTML = `<div class="card"><div class="muted">${esc((d && d.error) || "Couldn't load health")}</div></div>`; return; }
  const fmtTime = (t) => { try { return new Date(t).toLocaleString(); } catch (_e) { return String(t || ""); } };
  const last = d.last;
  const ageMin = last ? Math.round((Date.now() - new Date(last.checked_at).getTime()) / 60000) : null;
  const stale = ageMin == null || ageMin > 20;
  const green = last && last.status === "green" && !stale && (d.dead || 0) === 0;
  const color = green ? "#34d399" : "#fbbf24";
  const banner = !last ? "No heartbeat yet &#8212; waiting for the first run."
    : stale ? ("&#9888; Heartbeat is stale (last beat " + ageMin + "m ago) &#8212; the monitor may be down.")
    : (d.dead || 0) ? ("&#9888; " + d.dead + " action(s) failed and need attention.")
    : ("&#10003; All systems green &#8212; last beat " + ageMin + "m ago.");
  const lvlColor = (lv) => lv === "error" ? "#f87171" : "#fbbf24";
  el.innerHTML = `
    <div class="card" style="border-left:4px solid ${color}"><div style="font-weight:700">${banner}</div>
      <div class="muted" style="margin-top:4px">Alerts text ${esc(d.alert_cell || "your cell")} &#183; ${d.pending || 0} queued &#183; ${d.dead || 0} dead-lettered</div></div>
    <div class="card" style="margin-top:12px"><h3 style="margin:0 0 8px">Failures needing manual entry</h3>
      ${(d.dead_letters || []).length ? (d.dead_letters || []).map((x) => `<div style="padding:8px 2px;border-top:1px solid var(--line)"><div><strong>${esc(x.customer_name || "")}</strong> ${esc(x.summary || x.kind || "")}</div><div class="muted" style="font-size:12px">${esc(x.last_error || "")} &#183; ${fmtTime(x.dead_at)}</div></div>`).join("") : `<div class="muted">None &#8212; nothing has failed. &#10003;</div>`}</div>
    <div class="card" style="margin-top:12px"><h3 style="margin:0 0 8px">Errors &amp; warnings (24h)</h3>
      ${(d.errors || []).length ? (d.errors || []).map((e) => `<div style="padding:6px 2px;border-top:1px solid var(--line)"><span style="font-size:10px;font-weight:700;color:${lvlColor(e.level)}">${esc(String(e.level || "").toUpperCase())}</span> ${esc(String(e.message || "").slice(0, 160))}<div class="muted" style="font-size:11px">${esc(e.context || "")} &#183; ${fmtTime(e.created_at)}</div></div>`).join("") : `<div class="muted">No errors or warnings in the last 24 hours. &#10003;</div>`}</div>
    <div class="card" style="margin-top:12px"><h3 style="margin:0 0 8px">Heartbeat log</h3>
      ${(d.beats || []).map((b) => `<div style="display:flex;gap:8px;align-items:center;padding:5px 2px;border-top:1px solid var(--line)"><span style="background:${b.status === "green" ? "#34d399" : "#fbbf24"};width:9px;height:9px;border-radius:50%;flex:none"></span><span class="muted" style="font-size:12px;min-width:150px">${fmtTime(b.checked_at)}</span><span style="flex:1">${b.status === "green" ? "green" : ("alert" + (b.alerted ? " &#183; texted" : ""))}${(b.problems && b.problems.length) ? " &#8212; " + esc(b.problems.map((p) => p.detail || p.type).join("; ")).slice(0, 120) : ""}</span></div>`).join("") || `<div class="muted">No beats recorded yet.</div>`}</div>`;
}

// ---- Photos library (admin) — every inbound MMS image (techs + customers) with sender + date.
// Reads the photos function (which reads sms_messages, no duplication). File a loose photo to a job
// (uploads to HCP + marks filed) so late/unlabeled tech photos can be reconciled by date/sender.
async function renderPhotos() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">Files &#128247;</h2>
    <p class="sub">Every file texted in (techs + customers) &mdash; photos, video, PDFs, voice memos, contact cards, docs &mdash; newest first. Unfiled items show the <b>likely job</b> we matched from who sent it &amp; when; one click files it. Or attach by typing a customer name.</p>
    <div class="saverow" style="flex-wrap:wrap;gap:8px">
      <label class="muted" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="ph-unfiled"/> Unfiled only</label>
      <label class="muted">Type
        <select id="ph-kind" style="padding:4px">
          <option value="">All</option><option value="image">Photos</option><option value="video">Video</option>
          <option value="pdf">PDF</option><option value="audio">Audio</option><option value="vcard">Contact cards</option>
          <option value="doc">Docs</option><option value="other">Other</option>
        </select></label>
      <label class="muted">From <input type="date" id="ph-since" style="width:150px;padding:4px"/></label>
      <label class="muted">To <input type="date" id="ph-until" style="width:150px;padding:4px"/></label>
      <button class="btn" id="ph-refresh">Refresh</button>
      <span class="muted" id="ph-status"></span>
    </div>
    <div id="ph-grid" style="display:flex;flex-wrap:wrap;gap:12px;margin-top:12px"><div class="muted">Loading&#8230;</div></div>`;

  const kindIcon = (k) => ({ image: "&#128444;", video: "&#127916;", audio: "&#127897;", pdf: "&#128196;", vcard: "&#128100;", doc: "&#128195;" }[k] || "&#128206;");
  const preview = (p) => {
    if (p.kind === "image") return `<a href="${esc(p.media_url)}" target="_blank" rel="noopener"><img src="${esc(p.media_url)}" loading="lazy" style="width:100%;height:130px;object-fit:cover;border-radius:6px;background:var(--line)"/></a>`;
    return `<a href="${esc(p.media_url)}" target="_blank" rel="noopener" style="display:block"><div style="width:100%;height:130px;border-radius:6px;background:var(--line);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px"><div style="font-size:34px">${kindIcon(p.kind)}</div><div class="muted" style="font-size:10px;max-width:92%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.filename || p.kind || "file")}</div></div></a>`;
  };

  // do the actual attach + mark filed, then reload the grid
  const doAttach = async (p, jobId, jobLabel, btn, reload) => {
    if (btn) { btn.disabled = true; btn.textContent = "Attaching…"; }
    const r = await api("photos", { token: TOKEN, action: "attach", media_url: p.media_url, job_id: jobId, job_label: jobLabel || null });
    if (r && r.ok) reload(); else { if (btn) { btn.disabled = false; btn.textContent = "Attach"; } alert("Failed: " + ((r && r.error) || "error")); }
  };

  // attach-by-NAME fallback: type a customer (or paste a job_ id) -> pick job -> attach
  const attachFlow = async (p, b, reload) => {
    let q = prompt("Attach this file.\nType the CUSTOMER name (or paste a job_ id):");
    if (!q) return; q = q.trim();
    if (/^job_/i.test(q)) { return doAttach(p, q, null, b, reload); }
    const cr = await api("photos", { token: TOKEN, action: "customers", q });
    const cs = (cr && cr.customers) || [];
    if (!cs.length) { alert('No customer found matching "' + q + '". Try again, or paste a job_ id.'); return; }
    let cust = cs[0];
    if (cs.length > 1) {
      const pick = prompt("More than one match — type the number:\n\n" + cs.map((c, i) => (i + 1) + ". " + c.name + (c.address ? (" — " + c.address) : "")).join("\n"));
      const n = parseInt(pick, 10); if (!n || n < 1 || n > cs.length) return; cust = cs[n - 1];
    }
    const jr = await api("photos", { token: TOKEN, action: "jobs", hcp_customer_id: cust.hcp_customer_id });
    const js = (jr && jr.jobs) || [];
    if (!js.length) { alert("No jobs found for " + cust.name + ". Paste a job_ id instead."); return; }
    let job = js[0];
    if (js.length > 1) {
      const pick = prompt("Which job for " + cust.name + "?  type the number:\n\n" + js.map((j, i) => (i + 1) + ". " + j.label).join("\n"));
      const n = parseInt(pick, 10); if (!n || n < 1 || n > js.length) return; job = js[n - 1];
    }
    doAttach(p, job.id, job.label, b, reload);
  };

  const load = async () => {
    const grid = $("ph-grid"); grid.innerHTML = `<div class="muted">Loading&#8230;</div>`;
    const since = $("ph-since").value ? new Date($("ph-since").value + "T00:00:00").toISOString() : null;
    const until = $("ph-until").value ? new Date($("ph-until").value + "T23:59:59").toISOString() : null;
    const kind = $("ph-kind").value || null;
    const d = await api("photos", { token: TOKEN, action: "list", filed: $("ph-unfiled").checked ? false : null, since, until, kind });
    if (!d || d.error) { grid.innerHTML = `<div class="card"><div class="muted">${esc((d && d.error) || "Couldn't load files")}</div></div>`; return; }
    const bk = d.by_kind || {};
    $("ph-status").textContent = `${d.count} files | ${d.unfiled} unfiled | ${d.tech_photos} tech / ${d.customer_photos || 0} customer` + (bk.image != null ? ` | ${bk.image || 0} img, ${bk.video || 0} vid, ${bk.pdf || 0} pdf, ${bk.audio || 0} audio` : "");
    if (!d.photos.length) { grid.innerHTML = `<div class="muted">No files in range.</div>`; return; }
    grid.innerHTML = d.photos.map((p, i) => `<div class="card" style="width:182px;padding:8px">
      ${preview(p)}
      <div style="font-size:12px;margin-top:6px"><strong>${esc(p.sender_name || p.phone_fmt || "Unknown")}</strong></div>
      <div class="muted" style="font-size:11px">${esc(p.sender_type)} &#183; ${new Date(p.created_at).toLocaleDateString()} ${new Date(p.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
      ${p.filed
        ? `<div style="font-size:11px;color:#34d399;margin-top:6px">&#10003; Filed${p.filed_job ? " · " + esc(String(p.filed_job)) : ""}</div>`
        : `<div class="ph-act" data-i="${i}"><button class="btn" data-file="${i}" style="margin-top:6px;width:100%;font-size:12px">Attach to job</button></div>`}
    </div>`).join("");

    // wire the manual attach-by-name buttons
    const wireManual = () => grid.querySelectorAll("button[data-file]").forEach((b) => { b.onclick = () => attachFlow(d.photos[+b.dataset.file], b, load); });
    wireManual();

    // AUTO-SUGGEST: for unfiled cards (cap 30 to limit HCP calls), fetch the likely job and surface a 1-click confirm
    const unfiled = d.photos.map((p, i) => ({ p, i })).filter((x) => !x.p.filed).slice(0, 30);
    for (const { p, i } of unfiled) {
      const slot = grid.querySelector(`.ph-act[data-i="${i}"]`);
      if (!slot) continue;
      const sg = await api("photos", { token: TOKEN, action: "suggest", phone: p.phone, when: p.created_at });
      const top = sg && sg.candidates && sg.candidates[0];
      if (!top) continue;
      slot.innerHTML = `<div style="font-size:11px;margin-top:6px;line-height:1.3"><span class="muted">Likely:</span> ${esc(top.label)}</div>
        <div class="muted" style="font-size:10px">${esc(top.reason || "")}</div>
        <button class="btn" data-ok="${i}" style="margin-top:4px;width:100%;font-size:12px">&#10003; File here</button>
        <button class="btn" data-other="${i}" style="margin-top:4px;width:100%;font-size:11px;background:transparent">Other job&#8230;</button>`;
      slot.querySelector(`button[data-ok="${i}"]`).onclick = (ev) => doAttach(p, top.job_id, top.label, ev.currentTarget, load);
      slot.querySelector(`button[data-other="${i}"]`).onclick = (ev) => attachFlow(p, ev.currentTarget, load);
    }
  };
  $("ph-refresh").addEventListener("click", load);
  $("ph-unfiled").addEventListener("change", load);
  $("ph-kind").addEventListener("change", load);
  load();
}

async function renderLeads() {
  const main = $("main");
  main.innerHTML = `<h2 class="sec">Leads &#127919;</h2>
    <p class="sub">Give your marketing partner the webhook below. Every lead they POST lands in your Inbox and texts your cell. Keep the secret private &mdash; anyone with it can submit leads.</p>
    <div id="lead-cfg" class="card"><div class="muted">Loading&#8230;</div></div>
    <h3 class="sec" style="margin-top:18px">Recent leads</h3>
    <div id="lead-recent"><div class="muted">&#8230;</div></div>`;
  const copy = async (t, btn) => { try { await navigator.clipboard.writeText(t); if (btn) { const o = btn.textContent; btn.textContent = "Copied!"; setTimeout(() => (btn.textContent = o), 1200); } } catch (e) { alert("Copy failed"); } };
  const d = await api("leads-webhook", { token: TOKEN, action: "config" });
  const cfg = $("lead-cfg");
  if (!d || d.error) { cfg.innerHTML = `<div class="muted">${esc((d && d.error) || "Couldn't load lead config")}</div>`; return; }
  const fields = (d.spec && d.spec.accepted_fields) || {};
  const example = JSON.stringify((d.spec && d.spec.example) || {}, null, 2);
  const blurb = `Carnes & Sons — send leads to this webhook:\nPOST ${d.webhook_url}\nHeader: ${d.header_name}: ${d.secret}\n(or include "secret":"${d.secret}" in the JSON body instead of the header)\nContent-Type: application/json\n\nExample body:\n${example}`;
  cfg.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div><div class="muted" style="font-size:12px">Webhook URL (HTTP POST)</div>
        <div style="display:flex;gap:6px;align-items:center"><code style="flex:1;word-break:break-all;background:var(--line);padding:6px 8px;border-radius:6px">${esc(d.webhook_url)}</code><button class="btn" id="lc-url">Copy</button></div></div>
      <div><div class="muted" style="font-size:12px">Secret &mdash; send as header <b>${esc(d.header_name)}</b> (or a "secret" field in the body)</div>
        <div style="display:flex;gap:6px;align-items:center"><code id="lc-secret" style="flex:1;word-break:break-all;background:var(--line);padding:6px 8px;border-radius:6px">&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull; (hidden)</code><button class="btn" id="lc-reveal">Reveal</button><button class="btn" id="lc-copysec">Copy</button></div></div>
      <div><div class="muted" style="font-size:12px">Fields accepted (all optional &mdash; send whatever you have)</div>
        <ul style="margin:4px 0 0 16px;font-size:13px">${Object.entries(fields).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(String(v))}</li>`).join("")}</ul></div>
      <div><div class="muted" style="font-size:12px">Example JSON body</div>
        <pre style="background:var(--line);padding:8px;border-radius:6px;overflow:auto;font-size:12px;white-space:pre-wrap">${esc(example)}</pre></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="lc-blurb">&#128203; Copy setup for marketing</button>
        <button class="btn" id="lc-regen" style="background:transparent">&#128260; Regenerate secret</button>
      </div>
      <div class="muted" style="font-size:11px">Regenerating immediately invalidates the old secret &mdash; you'll need to hand your partner the new one.</div>
    </div>`;
  let revealed = false; const realSecret = d.secret;
  $("lc-url").onclick = (e) => copy(d.webhook_url, e.currentTarget);
  $("lc-reveal").onclick = () => { revealed = !revealed; $("lc-secret").textContent = revealed ? realSecret : "•••••••• (hidden)"; $("lc-reveal").textContent = revealed ? "Hide" : "Reveal"; };
  $("lc-copysec").onclick = (e) => copy(realSecret, e.currentTarget);
  $("lc-blurb").onclick = (e) => copy(blurb, e.currentTarget);
  $("lc-regen").onclick = async () => { if (!confirm("Regenerate the secret? The current one stops working immediately.")) return; const r = await api("leads-webhook", { token: TOKEN, action: "regenerate" }); if (r && r.ok) { alert("New secret generated. Reveal + copy it, then send it to your marketing partner."); renderLeads(); } else alert("Failed: " + ((r && r.error) || "error")); };
  const rec = $("lead-recent"); const leads = d.recent_leads || [];
  rec.innerHTML = leads.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;opacity:.7"><th style="padding:4px">When</th><th>Name</th><th>Phone</th><th>Source</th><th>Message</th></tr></thead><tbody>${leads.map((l) => `<tr style="border-top:1px solid var(--line)"><td style="padding:4px;white-space:nowrap">${new Date(l.created_at).toLocaleString()}</td><td>${esc(l.name || "")}</td><td>${esc(l.phone || "")}</td><td>${esc(l.source || "")}</td><td>${esc(String(l.message || "").slice(0, 60))}</td></tr>`).join("")}</tbody></table>`
    : `<div class="muted">No leads yet. Once your partner posts one, it shows here and in the Inbox.</div>`;
}