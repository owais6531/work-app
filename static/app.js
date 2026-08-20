const API = "";
const STAFF = ["Iqbal", "Mannan", "Maha", "Amna"];

function badgeClass(p) {
  return "badge " + (p || "NORMAL").replace(/\s+/g, "-");
}
function projectClass(p) {
  return "badge project-badge " + (p || "Tax Practice").replace(/\s+/g, "-");
}
function cardClass(p) {
  return "task-card pri-" + (p || "NORMAL").replace(/\s+/g, "-");
}
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function linkify(s) {
  const escaped = esc(s);
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a class="link" href="${url}" target="_blank">${url}</a>`);
}
function parseChecklist(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch (e) { return []; }
}

// ---- Tabs ----
document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll("main > section").forEach(s => s.style.display = "none");
    document.getElementById("tab-" + btn.dataset.tab).style.display = "block";
    if (btn.dataset.tab === "today") loadToday();
    if (btn.dataset.tab === "followups") loadFollowups();
    if (btn.dataset.tab === "tasks") loadTasks();
    if (btn.dataset.tab === "clients") loadClients();
    if (btn.dataset.tab === "notepad") loadNotepad();
    if (btn.dataset.tab === "recurring") loadRecurring();
    if (btn.dataset.tab === "passwords") loadCredentials();
    if (btn.dataset.tab === "taxcalc") loadTaxCalc();
    if (btn.dataset.tab === "backups") loadBackups();
  });
});

// ---- Today ----
async function loadToday() {
  const r = await fetch(API + "/api/today");
  const data = await r.json();
  document.getElementById("today-date").textContent = "Aaj: " + data.date;
  const render = (list) => list.length
    ? list.map(taskCardHtml).join("")
    : '<div class="empty">Kuch nahi — sab clear hai.</div>';
  document.getElementById("today-umair").innerHTML = render(data.umair);
  document.getElementById("today-claude").innerHTML = render(data.claude);
  document.getElementById("today-staff").innerHTML = renderStaffGroups(data.staff);
}
function renderStaffGroups(list) {
  if (!list || !list.length) return '<div class="empty">Kuch nahi — sab clear hai.</div>';
  const groups = {};
  list.forEach(t => {
    const name = t.owner || "Unassigned";
    if (!groups[name]) groups[name] = [];
    groups[name].push(t);
  });
  return Object.keys(groups).sort().map(name =>
    `<div class="staff-group"><div class="staff-name">${esc(name)}</div>${groups[name].map(taskCardHtml).join("")}</div>`
  ).join("");
}
function taskCardHtml(t) {
  const client = t.client_display_name || t.client_name_raw || "-";
  return `<div class="${cardClass(t.priority)}">
    <div class="row1">
      <span class="client">${esc(client)}</span>
      <span>
        <span class="${projectClass(t.project)}">${esc(t.project || "Tax Practice")}</span>
        <span class="${badgeClass(t.priority)}">${esc(t.priority || "")}</span>
      </span>
    </div>
    <div class="meta">${esc(t.task_type || "")} ${t.due_date ? "· due " + esc(t.due_date) : ""} ${t.blocked_on ? "· blocked: " + esc(t.blocked_on) : ""}</div>
    ${t.notes ? `<div class="notes">${linkify(t.notes)}</div>` : ""}
  </div>`;
}

// ---- Follow-ups ----
function buildFollowupMessage(t) {
  const client = t.client_display_name || t.client_name_raw || "";
  const dueLine = t.due_date ? ` (deadline ${t.due_date})` : "";
  if (STAFF.includes(t.owner)) {
    return `${t.owner} sahab, ${client} ki ${t.task_type || "task"}${dueLine} abhi "${t.status}" hai.` +
      (t.blocked_on ? ` ${t.blocked_on}.` : "") +
      ` Please status update kar dein.`;
  }
  return `Assalam-o-Alaikum${client ? ", " + client : ""} — aap ki ${t.task_type || "file"}${dueLine} ke liye ` +
    `${t.blocked_on || "kuch information"} chahiye. Jald bhej dein taky kaam aage barh sake.`;
}
async function loadFollowups() {
  const r = await fetch(API + "/api/followups");
  const rows = await r.json();
  const el = document.getElementById("followups-list");
  if (!rows.length) {
    el.innerHTML = '<div class="empty">Abhi koi follow-up pending nahi.</div>';
    return;
  }
  el.innerHTML = rows.map(t => {
    const client = t.client_display_name || t.client_name_raw || "-";
    return `<div class="${cardClass(t.priority)}">
      <div class="row1">
        <span class="client">${esc(client)} <span class="small">→ ${esc(t.owner || "?")}</span></span>
        <span class="${badgeClass(t.priority)}">${esc(t.priority || "")}</span>
      </div>
      <div class="meta">${esc(t.task_type || "")} ${t.due_date ? "· due " + esc(t.due_date) : ""} ${t.blocked_on ? "· blocked: " + esc(t.blocked_on) : ""}</div>
      <textarea class="followup-msg">${esc(buildFollowupMessage(t))}</textarea>
      <button class="btn secondary btn-copy-followup">📋 Copy Message</button>
    </div>`;
  }).join("");
  el.querySelectorAll(".btn-copy-followup").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ta = btn.previousElementSibling;
      try { await navigator.clipboard.writeText(ta.value); } catch (e) {}
      const original = btn.textContent;
      btn.textContent = "✅ Copied";
      setTimeout(() => { btn.textContent = original; }, 1200);
    });
  });
}

// ---- Tasks ----
async function loadTasks() {
  const params = new URLSearchParams();
  const q = document.getElementById("task-search").value.trim();
  const status = document.getElementById("f-status").value;
  const priority = document.getElementById("f-priority").value;
  const owner = document.getElementById("f-owner").value;
  const project = document.getElementById("f-project").value;
  const day = document.getElementById("f-day").value;
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (priority) params.set("priority", priority);
  if (owner) params.set("owner", owner);
  if (project) params.set("project", project);
  if (day) params.set("plan_day", day);
  const r = await fetch(API + "/api/tasks?" + params.toString());
  const rows = await r.json();
  const tbody = document.getElementById("tasks-body");
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty">Koi task nahi mila.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(t => `
    <tr data-id="${t.id}" data-client-id="${t.client_id || ""}" data-task-type="${esc(t.task_type || "")}">
      <td><span class="${projectClass(t.project)}">${esc(t.project || "Tax Practice")}</span></td>
      <td>${esc(t.client_display_name || t.client_name_raw || "-")}</td>
      <td>${esc(t.task_type || "")}</td>
      <td>${checklistCellHtml(t)}</td>
      <td><span class="${badgeClass(t.priority)}">${esc(t.priority || "")}</span></td>
      <td>
        <select class="pill-select status-select">
          ${["Pending","In Progress","Done","Closed"].map(s => `<option ${s===t.status?"selected":""}>${s}</option>`).join("")}
        </select>
      </td>
      <td>
        <select class="pill-select owner-select">
          ${["Umair","Iqbal","Mannan","Maha","Amna","Claude"].map(o => `<option ${o===t.owner?"selected":""}>${o}</option>`).join("")}
        </select>
      </td>
      <td class="small">${esc(t.due_date || "")}</td>
      <td class="small">${t.plan_day || ""}</td>
      <td class="small">${linkify(t.notes || "")}</td>
      <td>
        ${t.client_id ? '<button class="btn secondary btn-folder" title="Client folder kholein">📁</button>' : ""}
        <button class="btn secondary btn-del">✕</button>
      </td>
    </tr>`).join("");

  tbody.querySelectorAll("tr").forEach(tr => {
    const id = tr.dataset.id;
    const task = rows.find(r => String(r.id) === id);
    tr.querySelector(".status-select").addEventListener("change", e =>
      updateTask(id, { status: e.target.value }));
    tr.querySelector(".owner-select").addEventListener("change", e =>
      updateTask(id, { owner: e.target.value }));
    if (task) wireChecklist(tr, id, task);
    const folderBtn = tr.querySelector(".btn-folder");
    if (folderBtn) folderBtn.addEventListener("click", () =>
      openClientFolder(tr.dataset.clientId, tr.dataset.taskType));
    tr.querySelector(".btn-del").addEventListener("click", async () => {
      if (!confirm("Ye task delete karna hai?")) return;
      await fetch(API + `/api/tasks/${id}`, { method: "DELETE" });
      loadTasks();
    });
  });
}
async function openClientFolder(clientId, taskType) {
  if (!clientId) return;
  const r = await fetch(API + `/api/clients/${clientId}`);
  const data = await r.json();
  const links = (data.links || []).filter(l => l.link_target);
  if (!links.length) {
    alert("Is client ke liye koi folder link nahi mila — Clients tab se check kar lein.");
    return;
  }
  const tt = (taskType || "").toLowerCase();
  const findByKeyword = (kw) => links.find(l => (l.category || "").toLowerCase().includes(kw));
  let match = null;
  if (tt.includes("sales tax")) match = findByKeyword("sales tax");
  else if (tt.includes("income tax")) match = findByKeyword("income tax");
  else if (tt.includes("wht") || tt.includes("withholding")) match = findByKeyword("wht");
  else if (tt.includes("registration") || tt.includes("secp")) match = findByKeyword("registration") || findByKeyword("secp");
  else if (tt.includes("monthly")) match = findByKeyword("monthly");
  window.open((match || links[0]).link_target, "_blank");
}
function checklistCellHtml(t) {
  const items = parseChecklist(t.checklist);
  if (!items.length) return '<span class="small">—</span>';
  const done = items.filter(i => i.done).length;
  return `<div>
    <button type="button" class="checklist-toggle">${done}/${items.length} ☑</button>
    <div class="checklist-box" style="display:none;">
      ${items.map((it, i) => `<label class="${it.done ? "done" : ""}"><input type="checkbox" data-idx="${i}" ${it.done ? "checked" : ""}><span>${esc(it.label)}</span></label>`).join("")}
    </div>
  </div>`;
}
function wireChecklist(tr, id, task) {
  const toggle = tr.querySelector(".checklist-toggle");
  if (!toggle) return;
  const box = tr.querySelector(".checklist-box");
  toggle.addEventListener("click", () => { box.style.display = box.style.display === "none" ? "block" : "none"; });
  box.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", async () => {
      const items = parseChecklist(task.checklist);
      items[Number(cb.dataset.idx)].done = cb.checked;
      task.checklist = JSON.stringify(items);
      await updateTask(id, { checklist: items });
      loadTasks();
    });
  });
}
async function updateTask(id, patch) {
  await fetch(API + `/api/tasks/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
  });
}
["task-search","f-status","f-priority","f-owner","f-project","f-day"].forEach(id => {
  document.getElementById(id).addEventListener("input", loadTasks);
  document.getElementById(id).addEventListener("change", loadTasks);
});
document.getElementById("btn-refresh-tasks").addEventListener("click", loadTasks);

// ---- Clients ----
async function loadClients() {
  const q = document.getElementById("client-search").value.trim();
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const r = await fetch(API + "/api/clients?" + params.toString());
  const rows = await r.json();
  const tbody = document.getElementById("clients-body");
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">Koi client nahi mila.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(c => `
    <tr data-id="${c.id}" style="cursor:pointer">
      <td>${esc(c.name)}</td>
      <td class="small">${esc(c.ntn || "")}</td>
      <td class="small">${esc(c.contact_info || "—")}</td>
      <td class="small">${esc(c.registration_status || "—")}</td>
      <td class="small">${esc(c.last_enriched || "—")}</td>
    </tr>`).join("");
  tbody.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("click", () => showClientDetail(tr.dataset.id));
  });
}
document.getElementById("client-search").addEventListener("input", loadClients);

async function showClientDetail(id) {
  const r = await fetch(API + `/api/clients/${id}`);
  const data = await r.json();
  const el = document.getElementById("client-detail");
  el.style.display = "block";
  const links = data.links.filter(l => l.link_text || l.link_target);
  el.innerHTML = `
    <h3>${esc(data.client.name)} <span class="small">${esc(data.client.ntn || "")}</span></h3>
    <p class="small">${esc(data.client.status_notes || "")}</p>
    <b>Folders</b>
    <ul>${links.map(l => `<li>${esc(l.category)}: ${l.link_target ? `<a class="link" href="${esc(l.link_target)}" target="_blank">${esc(l.link_text||l.category)}</a>` : esc(l.link_text)}</li>`).join("") || '<li class="empty">Koi link nahi</li>'}</ul>
    <b>Tasks</b>
    ${data.tasks.length ? data.tasks.map(taskCardHtml).join("") : '<div class="empty">Koi task nahi</div>'}
  `;
}

// ---- Backups ----
async function loadBackups() {
  const r = await fetch(API + "/api/backups");
  const rows = await r.json();
  const tbody = document.getElementById("backups-body");
  tbody.innerHTML = rows.length
    ? rows.map(b => `<tr><td>${esc(b.name)}</td><td>${b.size_kb}</td><td>${esc(b.modified)}</td></tr>`).join("")
    : '<tr><td colspan="3" class="empty">Abhi tak koi backup nahi.</td></tr>';
}
document.getElementById("btn-backup").addEventListener("click", async () => {
  const msg = document.getElementById("backup-msg");
  msg.textContent = "Backup ho raha hai...";
  const r = await fetch(API + "/api/backup", { method: "POST" });
  const data = await r.json();
  msg.textContent = data.ok ? `✅ Naya backup ban gaya: ${data.file}` : "❌ Backup fail ho gaya.";
  loadBackups();
});
document.getElementById("btn-export").addEventListener("click", async () => {
  const msg = document.getElementById("backup-msg");
  msg.textContent = "Excel export ho raha hai...";
  const r = await fetch(API + "/api/export_excel", { method: "POST" });
  const data = await r.json();
  msg.textContent = data.ok ? "✅ Client-Master-List.xlsx update ho gayi." : "❌ Export fail ho gaya: " + data.output;
});

// ---- Passwords (local-only) ----
let credsRevealed = false;

async function loadCredentials() {
  const q = document.getElementById("cred-search").value.trim();
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const r = await fetch(API + "/api/credentials?" + params.toString());
  const rows = await r.json();
  const tbody = document.getElementById("creds-body");
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Koi record nahi mila.</td></tr>';
    return;
  }
  const maskType = credsRevealed ? "text" : "password";
  tbody.innerHTML = rows.map(c => `
    <tr data-id="${c.id}">
      <td><input type="text" class="cred-input" data-field="client_name" value="${esc(c.client_name || "")}"></td>
      <td><input type="text" class="cred-input" data-field="login_id" value="${esc(c.login_id || "")}"></td>
      <td>
        <span class="cred-mask-wrap">
          <input type="${maskType}" class="cred-input mask-input" data-field="password" value="${esc(c.password || "")}">
          <button type="button" class="btn-copy" title="Copy">📋</button>
        </span>
      </td>
      <td>
        <span class="cred-mask-wrap">
          <input type="${maskType}" class="cred-input mask-input" data-field="pin" value="${esc(c.pin || "")}">
          <button type="button" class="btn-copy" title="Copy">📋</button>
        </span>
      </td>
      <td class="small">${esc(c.source_sheet || "")}</td>
      <td><input type="text" class="cred-input" data-field="remarks" value="${esc(c.remarks || "")}"></td>
      <td><button class="btn secondary btn-cred-del">✕</button></td>
    </tr>`).join("");

  tbody.querySelectorAll(".cred-input").forEach(input => {
    input.addEventListener("change", async () => {
      const id = input.closest("tr").dataset.id;
      const field = input.dataset.field;
      await fetch(API + `/api/credentials/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: input.value }),
      });
    });
  });
  tbody.querySelectorAll(".btn-copy").forEach(btn => {
    btn.addEventListener("click", async () => {
      const input = btn.previousElementSibling;
      const val = input.value || "";
      if (!val) return;
      try { await navigator.clipboard.writeText(val); } catch (e) {}
      const original = btn.textContent;
      btn.textContent = "✅";
      setTimeout(() => { btn.textContent = original; }, 900);
    });
  });
  tbody.querySelectorAll(".btn-cred-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.closest("tr").dataset.id;
      if (!confirm("Ye record delete karna hai?")) return;
      await fetch(API + `/api/credentials/${id}`, { method: "DELETE" });
      loadCredentials();
    });
  });
}
document.getElementById("cred-search").addEventListener("input", loadCredentials);
document.getElementById("btn-cred-showall").addEventListener("click", () => {
  credsRevealed = !credsRevealed;
  document.getElementById("btn-cred-showall").textContent = credsRevealed ? "🙈 Hide All" : "👁 Show All";
  document.querySelectorAll("#creds-body .mask-input").forEach(input => {
    input.type = credsRevealed ? "text" : "password";
  });
});

// ---- Notepad ----
async function loadNotepad() {
  const r = await fetch(API + "/api/notes");
  const rows = await r.json();
  const list = document.getElementById("notes-list");
  if (!rows.length) {
    list.innerHTML = '<div class="empty">Abhi tak koi note nahi.</div>';
    return;
  }
  list.innerHTML = rows.map(n => `
    <div class="task-card ${n.status === "Processed" ? "" : "pri-URGENT"}" data-id="${n.id}">
      <div class="row1">
        <span>${esc(n.content)}</span>
        <span class="${badgeClass(n.status === "Processed" ? "NORMAL" : "URGENT")}">${esc(n.status)}</span>
      </div>
      <div class="meta">${esc(n.created_at)}</div>
      ${n.resolution ? `<div class="notes">${esc(n.resolution)}</div>` : ""}
      <div style="margin-top:6px;">
        ${n.status !== "Processed" ? '<button class="btn secondary btn-note-done">Mark Processed</button>' : ""}
        <button class="btn secondary btn-note-del">Delete</button>
      </div>
    </div>`).join("");
  list.querySelectorAll(".task-card").forEach(card => {
    const id = card.dataset.id;
    const doneBtn = card.querySelector(".btn-note-done");
    if (doneBtn) doneBtn.addEventListener("click", async () => {
      await fetch(API + `/api/notes/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Processed" }),
      });
      loadNotepad();
    });
    card.querySelector(".btn-note-del").addEventListener("click", async () => {
      if (!confirm("Ye note delete karna hai?")) return;
      await fetch(API + `/api/notes/${id}`, { method: "DELETE" });
      loadNotepad();
    });
  });
}
async function addNote() {
  const input = document.getElementById("note-input");
  const content = input.value.trim();
  if (!content) return;
  await fetch(API + "/api/notes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  input.value = "";
  loadNotepad();
}
document.getElementById("btn-note-add").addEventListener("click", addNote);
document.getElementById("note-input").addEventListener("keydown", e => {
  if (e.key === "Enter") addNote();
});

// ---- Tax Calculator ----
let taxSlabData = null;
function fmtMoney(n) {
  if (n === null || n === undefined) return "";
  return Number(n).toLocaleString("en-PK");
}
let tcCategory = null;
let tcMode = "amount_to_tax";

async function loadTaxCalc() {
  if (!taxSlabData) {
    const r = await fetch(API + "/api/tax-slabs");
    taxSlabData = await r.json();
    const years = Object.keys(taxSlabData).sort();
    const yearSel = document.getElementById("tc-year");
    yearSel.innerHTML = years.map(y => `<option value="${esc(y)}">${esc(y)}</option>`).join("");
    yearSel.addEventListener("change", populateTcCategories);
  }
  populateTcCategories();
}
function populateTcCategories() {
  const year = document.getElementById("tc-year").value;
  const cats = Object.keys(taxSlabData[year] || {});
  if (!tcCategory || !cats.includes(tcCategory)) tcCategory = cats[0];
  const group = document.getElementById("tc-category-group");
  group.innerHTML = cats.map(c => `<button type="button" class="toggle-btn${c === tcCategory ? " active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  group.querySelectorAll(".toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      tcCategory = btn.dataset.cat;
      group.querySelectorAll(".toggle-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderSlabTable();
    });
  });
  renderSlabTable();
}
document.getElementById("tc-mode-group").querySelectorAll(".toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    tcMode = btn.dataset.mode;
    document.querySelectorAll("#tc-mode-group .toggle-btn").forEach(b => b.classList.toggle("active", b === btn));
  });
});
function renderSlabTable() {
  const year = document.getElementById("tc-year").value;
  const brackets = (taxSlabData[year] && taxSlabData[year][tcCategory]) || [];
  const tbody = document.getElementById("tc-slab-body");
  tbody.innerHTML = brackets.map(b => `
    <tr><td>${b.sr_no}</td><td>${fmtMoney(b.from)}</td><td>${b.to !== null ? fmtMoney(b.to) : "aur upar"}</td>
    <td>${fmtMoney(b.max_tax_within_slab)}</td><td>${b.rate_percent}%</td></tr>`).join("");
}
document.getElementById("btn-tc-calc").addEventListener("click", async () => {
  const tax_year = document.getElementById("tc-year").value;
  const category = tcCategory;
  const mode = tcMode;
  const value = document.getElementById("tc-value").value;
  const resultEl = document.getElementById("tc-result");
  if (!value) { resultEl.innerHTML = '<div class="empty">Amount daalein.</div>'; return; }
  const r = await fetch(API + "/api/tax-calculate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tax_year, category, mode, value: Number(value) }),
  });
  const data = await r.json();
  if (data.error) {
    resultEl.innerHTML = `<div class="empty">❌ ${esc(data.error)}</div>`;
    return;
  }
  const bracketLine = `<div class="small">Bracket Sr.${data.bracket.sr_no}: ${fmtMoney(data.bracket.from)} - ${data.bracket.to !== null ? fmtMoney(data.bracket.to) : "aur upar"} @ ${data.bracket.rate_percent}%</div>`;
  if (mode === "amount_to_tax") {
    resultEl.innerHTML = `<div class="task-card"><b>Tax:</b> Rs. ${fmtMoney(Math.round(data.result))}${bracketLine}</div>`;
  } else if (data.result === null) {
    resultEl.innerHTML = `<div class="task-card">Is bracket (Sr.${data.bracket.sr_no}, rate 0%) mein tax hamesha zero hai — is liye koi specific amount nahi nikal sakte, koi bhi amount ${fmtMoney(data.bracket.from)} se ${fmtMoney(data.bracket.to)} ke darmiyan ho sakta hai.</div>`;
  } else {
    resultEl.innerHTML = `<div class="task-card"><b>Amount:</b> Rs. ${fmtMoney(Math.round(data.result))}${bracketLine}</div>`;
  }
});

// ---- Recurring schedules ----
let recSelectedClient = null;
let recDebounce = null;
document.getElementById("rec-client-search").addEventListener("input", (e) => {
  clearTimeout(recDebounce);
  const q = e.target.value.trim();
  recSelectedClient = null;
  const results = document.getElementById("rec-client-results");
  if (!q) { results.style.display = "none"; return; }
  recDebounce = setTimeout(async () => {
    const r = await fetch(API + "/api/clients?q=" + encodeURIComponent(q));
    const rows = await r.json();
    if (!rows.length) { results.style.display = "none"; return; }
    results.innerHTML = rows.slice(0, 15).map(c =>
      `<div class="picker-row" data-id="${c.id}" data-name="${esc(c.name)}">${esc(c.name)} <span class="small">${esc(c.ntn || "")}</span></div>`
    ).join("");
    results.style.display = "block";
    results.querySelectorAll(".picker-row").forEach(row => {
      row.addEventListener("click", () => {
        recSelectedClient = { id: row.dataset.id, name: row.dataset.name };
        document.getElementById("rec-client-search").value = row.dataset.name;
        results.style.display = "none";
      });
    });
  }, 250);
});

async function loadRecurring() {
  const r = await fetch(API + "/api/recurring");
  const rows = await r.json();
  const tbody = document.getElementById("recurring-body");
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Abhi koi recurring schedule nahi.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(s => `
    <tr data-id="${s.id}">
      <td>${esc(s.client_display_name || s.client_name_raw || "-")}</td>
      <td>${esc(s.task_type || "")}</td>
      <td class="small">${esc(s.months) || "har mahina"}</td>
      <td class="small">${s.due_day || ""}</td>
      <td class="small">${s.period_offset_months}</td>
      <td class="small">${esc(s.owner || "")}</td>
      <td><input type="checkbox" class="rec-active" ${s.active ? "checked" : ""}></td>
      <td><button class="btn secondary btn-rec-del">✕</button></td>
    </tr>`).join("");
  tbody.querySelectorAll("tr").forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector(".rec-active").addEventListener("change", e =>
      fetch(API + `/api/recurring/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: e.target.checked ? 1 : 0 }),
      }));
    tr.querySelector(".btn-rec-del").addEventListener("click", async () => {
      if (!confirm("Ye schedule delete karna hai?")) return;
      await fetch(API + `/api/recurring/${id}`, { method: "DELETE" });
      loadRecurring();
    });
  });
}
document.getElementById("btn-rec-add").addEventListener("click", async () => {
  const taskType = document.getElementById("rec-task-type").value.trim();
  const dueDay = document.getElementById("rec-due-day").value;
  if (!taskType || !dueDay) { alert("Task type aur due day zaroori hain."); return; }
  await fetch(API + "/api/recurring", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: recSelectedClient ? Number(recSelectedClient.id) : null,
      client_name_raw: recSelectedClient ? recSelectedClient.name : document.getElementById("rec-client-search").value.trim(),
      task_type: taskType,
      months: document.getElementById("rec-months").value.trim(),
      due_day: Number(dueDay),
      period_offset_months: Number(document.getElementById("rec-offset").value || 1),
      owner: document.getElementById("rec-owner").value,
    }),
  });
  ["rec-client-search","rec-task-type","rec-months","rec-due-day"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("rec-offset").value = "1";
  recSelectedClient = null;
  loadRecurring();
});
document.getElementById("btn-rec-generate").addEventListener("click", async () => {
  const msg = document.getElementById("rec-generate-msg");
  msg.textContent = "Generate ho raha hai...";
  const r = await fetch(API + "/api/recurring/generate", { method: "POST" });
  const data = await r.json();
  msg.textContent = data.count ? `✅ ${data.count} naye tasks ban gaye.` : "Is period ke liye sab already ban chuke hain.";
});

// ---- Notepad voice-to-text ----
(function setupVoiceNote() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById("btn-note-mic");
  if (!SpeechRecognition) { micBtn.style.display = "none"; return; }
  const recognition = new SpeechRecognition();
  recognition.lang = "ur-PK";
  recognition.interimResults = false;
  let listening = false;
  recognition.addEventListener("result", (e) => {
    const input = document.getElementById("note-input");
    const transcript = Array.from(e.results).map(r => r[0].transcript).join(" ");
    input.value = (input.value ? input.value + " " : "") + transcript;
  });
  recognition.addEventListener("end", () => {
    listening = false;
    micBtn.classList.remove("recording");
  });
  recognition.addEventListener("error", (e) => {
    listening = false;
    micBtn.classList.remove("recording");
    if (e.error !== "no-speech" && e.error !== "aborted") alert("Voice input mein masla hua: " + e.error);
  });
  micBtn.addEventListener("click", () => {
    if (listening) { recognition.stop(); return; }
    listening = true;
    micBtn.classList.add("recording");
    recognition.start();
  });
})();

// initial load
loadToday();
