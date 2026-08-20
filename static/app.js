const API = "";
const STAFF = ["Iqbal", "Mannan", "Maha", "Amna"];
// "Umair" stays the stored owner value everywhere (matching, grouping, filters) - only the
// display label changes, since Owais (who runs this dashboard) calls his brother Bhaijan.
function ownerLabel(o) {
  return o === "Umair" ? "Bhaijan" : o;
}

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
// Folder links from client_links are local Windows paths (not URLs) - browsers can't
// navigate to them directly, so we copy the path and Umair pastes it into Explorer.
async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}
function flashCopied(btn, copiedLabel) {
  const original = btn.textContent;
  btn.textContent = copiedLabel || "✅ Copied";
  setTimeout(() => { btn.textContent = original; }, 1200);
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
    if (btn.dataset.tab === "drafts") loadDrafts();
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
  const umairEl = document.getElementById("today-umair");
  const claudeEl = document.getElementById("today-claude");
  const staffEl = document.getElementById("today-staff");
  umairEl.innerHTML = render(data.umair);
  claudeEl.innerHTML = render(data.claude);
  staffEl.innerHTML = renderStaffGroups(data.staff);
  [umairEl, claudeEl, staffEl].forEach(el => wireCardStatusSelects(el, loadToday));
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
  return `<div class="${cardClass(t.priority)}" data-id="${t.id}">
    <div class="row1">
      <span class="client">${esc(client)}</span>
      <span>
        <span class="${projectClass(t.project)}">${esc(t.project || "Tax Practice")}</span>
        <span class="${badgeClass(t.priority)}">${esc(t.priority || "")}</span>
      </span>
    </div>
    <div class="meta">${esc(t.task_type || "")} ${t.due_date ? "· due " + esc(t.due_date) : ""} ${t.blocked_on ? "· blocked: " + esc(t.blocked_on) : ""}</div>
    ${t.notes ? `<div class="notes">${linkify(t.notes)}</div>` : ""}
    <div style="margin-top:6px;">
      <select class="pill-select card-status-select">
        ${["Pending","In Progress","Done","Closed"].map(s => `<option ${s===t.status?"selected":""}>${s}</option>`).join("")}
      </select>
    </div>
  </div>`;
}
function wireCardStatusSelects(container, onSaved) {
  container.querySelectorAll(".card-status-select").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      const id = sel.closest("[data-id]").dataset.id;
      await updateTask(id, { status: e.target.value });
      if (onSaved) onSaved();
    });
  });
}

// ---- Follow-ups (one combined message per person, not per task) ----
function followupLineForTask(t) {
  const client = t.client_display_name || t.client_name_raw || "-";
  const dueLine = t.due_date ? ` (due ${t.due_date})` : "";
  const statusLine = t.status && t.status !== "Pending" ? ` [${t.status}]` : "";
  const blockedLine = t.blocked_on ? ` — ${t.blocked_on}` : "";
  return `${client}: ${t.task_type || "task"}${dueLine}${statusLine}${blockedLine}`;
}
function buildPersonFollowupMessage(owner, tasks) {
  const lines = tasks.map((t, i) => `${i + 1}. ${followupLineForTask(t)}`).join("\n");
  return `${ownerLabel(owner)}, ye kaam abhi pending hain:\n\n${lines}\n\nPlease update kar dein / bata dein kya status hai.`;
}
async function loadFollowups() {
  const r = await fetch(API + "/api/followups");
  const rows = await r.json();
  const el = document.getElementById("followups-list");
  if (!rows.length) {
    el.innerHTML = '<div class="empty">Abhi koi follow-up pending nahi.</div>';
    return;
  }
  const groups = {};
  rows.forEach(t => {
    const name = t.owner || "Unassigned";
    if (!groups[name]) groups[name] = [];
    groups[name].push(t);
  });
  const order = ["Umair", ...STAFF];
  const names = Object.keys(groups).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  el.innerHTML = names.map(name => {
    const tasks = groups[name];
    const worstPriority = tasks.map(t => t.priority).sort((a, b) =>
      ["URGENT-OVERDUE","URGENT","URGENT-VERIFY DATE","BLOCKED","NORMAL","LOW"].indexOf(a || "NORMAL") -
      ["URGENT-OVERDUE","URGENT","URGENT-VERIFY DATE","BLOCKED","NORMAL","LOW"].indexOf(b || "NORMAL"))[0];
    return `<div class="${cardClass(worstPriority)}">
      <div class="row1">
        <span class="client">${esc(ownerLabel(name))} <span class="small">— ${tasks.length} pending kaam</span></span>
        <span class="${badgeClass(worstPriority)}">${esc(worstPriority || "")}</span>
      </div>
      <textarea class="followup-msg" rows="${Math.min(tasks.length + 3, 14)}">${esc(buildPersonFollowupMessage(name, tasks))}</textarea>
      <button class="btn secondary btn-copy-followup">📋 Copy Message</button>
    </div>`;
  }).join("");
  el.querySelectorAll(".btn-copy-followup").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ta = btn.previousElementSibling;
      await copyToClipboard(ta.value);
      flashCopied(btn, "✅ Copied");
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
    tbody.innerHTML = '<tr><td colspan="12" class="empty">Koi task nahi mila.</td></tr>';
    return;
  }
  const priorities = ["URGENT-OVERDUE","URGENT","URGENT-VERIFY DATE","BLOCKED","NORMAL","LOW"];
  tbody.innerHTML = rows.map(t => `
    <tr data-id="${t.id}" data-client-id="${t.client_id || ""}" data-task-type="${esc(t.task_type || "")}">
      <td><span class="${projectClass(t.project)}">${esc(t.project || "Tax Practice")}</span></td>
      <td class="small">${esc(t.client_display_name || t.client_name_raw || "-")}</td>
      <td><input type="text" class="task-field cell-input" data-field="task_type" value="${esc(t.task_type || "")}"></td>
      <td>${checklistCellHtml(t)}</td>
      <td>
        <select class="pill-select task-field" data-field="priority">
          ${priorities.map(p => `<option ${p===t.priority?"selected":""}>${p}</option>`).join("")}
        </select>
      </td>
      <td>
        <select class="pill-select task-field" data-field="status">
          ${["Pending","In Progress","Done","Closed"].map(s => `<option ${s===t.status?"selected":""}>${s}</option>`).join("")}
        </select>
      </td>
      <td>
        <select class="pill-select task-field" data-field="owner">
          ${["Umair","Iqbal","Mannan","Maha","Amna","Claude"].map(o => `<option value="${o}" ${o===t.owner?"selected":""}>${ownerLabel(o)}</option>`).join("")}
        </select>
      </td>
      <td><input type="date" class="task-field cell-input" data-field="due_date" value="${esc(t.due_date || "")}" style="width:130px;"></td>
      <td><input type="number" class="task-field cell-input" data-field="plan_day" min="1" max="5" value="${t.plan_day || ""}" style="width:50px;"></td>
      <td><input type="text" class="task-field cell-input" data-field="blocked_on" value="${esc(t.blocked_on || "")}" placeholder="blocked on..." style="width:130px;"></td>
      <td><textarea class="task-field cell-input" data-field="notes" style="width:200px; min-height:32px;">${esc(t.notes || "")}</textarea></td>
      <td>
        ${t.client_id ? '<button class="btn secondary btn-folder" title="Folder path copy karein">📁</button>' : ""}
        ${t.client_id ? '<button class="btn secondary btn-draft" title="Letter/script draft banayein">📝</button>' : ""}
        <button class="btn secondary btn-del">✕</button>
      </td>
    </tr>`).join("");

  tbody.querySelectorAll("tr").forEach(tr => {
    const id = tr.dataset.id;
    const task = rows.find(r => String(r.id) === id);
    tr.querySelectorAll(".task-field").forEach(field => {
      field.addEventListener("change", () => updateTask(id, { [field.dataset.field]: field.value }));
    });
    if (task) wireChecklist(tr, id, task);
    const folderBtn = tr.querySelector(".btn-folder");
    if (folderBtn) folderBtn.addEventListener("click", () =>
      openClientFolder(tr.dataset.clientId, tr.dataset.taskType, folderBtn));
    const draftBtn = tr.querySelector(".btn-draft");
    if (draftBtn) draftBtn.addEventListener("click", () =>
      startDraftFromTask(tr.dataset.clientId, task ? (task.client_display_name || task.client_name_raw) : "", tr.dataset.taskType));
    tr.querySelector(".btn-del").addEventListener("click", async () => {
      if (!confirm("Ye task delete karna hai?")) return;
      await fetch(API + `/api/tasks/${id}`, { method: "DELETE" });
      loadTasks();
    });
  });
}
async function openClientFolder(clientId, taskType, btn) {
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
  const target = (match || links[0]).link_target;
  await copyToClipboard(target);
  if (btn) flashCopied(btn, "✅ Path copied");
  else alert("Folder path copy ho gaya:\n" + target);
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
  const c = data.client;
  el.innerHTML = `
    <h3>${esc(c.name)} <span class="small">${esc(c.ntn || "")}</span></h3>
    <div class="toolbar">
      <label class="small">Contact:
        <input type="text" class="client-field" data-field="contact_info" value="${esc(c.contact_info || "")}" placeholder="email / phone" style="width:220px;">
      </label>
      <label class="small">Registration status:
        <input type="text" class="client-field" data-field="registration_status" value="${esc(c.registration_status || "")}" placeholder="e.g. Sales Tax: Yes w.e.f ..." style="width:260px;">
      </label>
    </div>
    <label class="small">Notes:</label>
    <textarea class="client-field followup-msg" data-field="status_notes" style="min-height:60px;">${esc(c.status_notes || "")}</textarea>
    <span class="small" id="client-save-msg"></span>
    <b>Folders</b>
    <ul>${links.map(l => `<li>${esc(l.category)}: ${l.link_target ? `<button type="button" class="btn secondary btn-copy-folder" data-path="${esc(l.link_target)}">📋 ${esc(l.link_text||l.category)}</button>` : esc(l.link_text)}</li>`).join("") || '<li class="empty">Koi link nahi</li>'}</ul>
    ${data.drafts && data.drafts.length ? `<b>Drafts</b><ul>${data.drafts.map(d => `<li class="small">${esc(d.draft_type)}: ${esc(d.title||"")} — ${esc(d.status)}</li>`).join("")}</ul>` : ""}
    <b>Tasks</b>
    ${data.tasks.length ? data.tasks.map(taskCardHtml).join("") : '<div class="empty">Koi task nahi</div>'}
  `;
  el.querySelectorAll(".btn-copy-folder").forEach(btn => {
    btn.addEventListener("click", async () => {
      await copyToClipboard(btn.dataset.path);
      flashCopied(btn, "✅ Path copied");
    });
  });
  el.querySelectorAll(".client-field").forEach(field => {
    field.addEventListener("change", async () => {
      const msg = document.getElementById("client-save-msg");
      await fetch(API + `/api/clients/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field.dataset.field]: field.value }),
      });
      msg.textContent = "✅ Saved";
      setTimeout(() => { msg.textContent = ""; }, 1200);
    });
  });
  wireCardStatusSelects(el, () => showClientDetail(id));
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
        <textarea class="note-field cell-input" style="flex:1; min-height:24px;">${esc(n.content)}</textarea>
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
    card.querySelector(".note-field").addEventListener("change", async (e) => {
      await fetch(API + `/api/notes/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: e.target.value }),
      });
    });
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
      <td class="small">${esc(s.client_display_name || s.client_name_raw || "-")}</td>
      <td><input type="text" class="rec-field cell-input" data-field="task_type" value="${esc(s.task_type || "")}"></td>
      <td><input type="text" class="rec-field cell-input" data-field="months" value="${esc(s.months || "")}" placeholder="har mahina" style="width:110px;"></td>
      <td><input type="number" class="rec-field cell-input" data-field="due_day" value="${s.due_day || ""}" style="width:55px;"></td>
      <td><input type="number" class="rec-field cell-input" data-field="period_offset_months" value="${s.period_offset_months}" style="width:55px;"></td>
      <td>
        <select class="pill-select rec-field" data-field="owner">
          ${["Umair","Iqbal","Mannan","Maha","Amna","Claude"].map(o => `<option value="${o}" ${o===s.owner?"selected":""}>${ownerLabel(o)}</option>`).join("")}
        </select>
      </td>
      <td><input type="checkbox" class="rec-active" ${s.active ? "checked" : ""}></td>
      <td><button class="btn secondary btn-rec-del">✕</button></td>
    </tr>`).join("");
  tbody.querySelectorAll("tr").forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelectorAll(".rec-field").forEach(field => {
      field.addEventListener("change", () =>
        fetch(API + `/api/recurring/${id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field.dataset.field]: field.value }),
        }));
    });
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

// ---- Drafts (letters + video scripts) ----
let draftSelectedClient = null;
let draftEditingId = null;
let draftListClientId = null;
let draftDebounce = null;

document.getElementById("draft-client-search").addEventListener("input", (e) => {
  clearTimeout(draftDebounce);
  const q = e.target.value.trim();
  draftSelectedClient = null;
  document.getElementById("draft-client-info").innerHTML = "";
  const results = document.getElementById("draft-client-results");
  if (!q) { results.style.display = "none"; return; }
  draftDebounce = setTimeout(async () => {
    const r = await fetch(API + "/api/clients?q=" + encodeURIComponent(q));
    const rows = await r.json();
    if (!rows.length) { results.style.display = "none"; return; }
    results.innerHTML = rows.slice(0, 15).map(c =>
      `<div class="picker-row" data-id="${c.id}" data-name="${esc(c.name)}">${esc(c.name)} <span class="small">${esc(c.ntn || "")}</span></div>`
    ).join("");
    results.style.display = "block";
    results.querySelectorAll(".picker-row").forEach(row => {
      row.addEventListener("click", () => {
        draftSelectedClient = { id: row.dataset.id, name: row.dataset.name };
        document.getElementById("draft-client-search").value = row.dataset.name;
        results.style.display = "none";
        showDraftClientInfo(row.dataset.id);
        loadDrafts(row.dataset.id);
      });
    });
  }, 250);
});

async function showDraftClientInfo(clientId) {
  const r = await fetch(API + `/api/clients/${clientId}`);
  const data = await r.json();
  const el = document.getElementById("draft-client-info");
  const links = (data.links || []).filter(l => l.link_target);
  el.innerHTML = `
    <div class="panel" style="background:#f9fafb; margin-top:10px;">
      <b>${esc(data.client.name)}</b> <span class="small">NTN: ${esc(data.client.ntn || "-")}</span><br>
      <span class="small">${esc(data.client.registration_status || "")} ${data.client.contact_info ? "· " + esc(data.client.contact_info) : ""}</span>
      <div style="margin-top:8px;">
        ${links.map(l => `<button type="button" class="btn secondary btn-copy-folder" data-path="${esc(l.link_target)}">📋 ${esc(l.link_text || l.category)}</button>`).join(" ") || '<span class="small">Koi folder link nahi</span>'}
      </div>
    </div>`;
  el.querySelectorAll(".btn-copy-folder").forEach(btn => {
    btn.addEventListener("click", async () => {
      await copyToClipboard(btn.dataset.path);
      flashCopied(btn, "✅ Path copied");
    });
  });
}

document.getElementById("btn-draft-new").addEventListener("click", () => {
  if (!draftSelectedClient) { alert("Pehle client select karein (search results se click karein)."); return; }
  const title = document.getElementById("draft-title").value.trim();
  if (!title) { alert("Title/subject likhein (e.g. Notice Reply)."); return; }
  draftEditingId = null;
  document.getElementById("draft-content").value = "";
  document.getElementById("draft-editor").style.display = "block";
  document.getElementById("draft-content").focus();
});

document.getElementById("btn-draft-save").addEventListener("click", async () => {
  const content = document.getElementById("draft-content").value;
  const title = document.getElementById("draft-title").value.trim();
  const draftType = document.getElementById("draft-type").value;
  const msg = document.getElementById("draft-save-msg");
  if (draftEditingId) {
    await fetch(API + `/api/drafts/${draftEditingId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, title, draft_type: draftType }),
    });
  } else {
    if (!draftSelectedClient) { alert("Pehle client select karein."); return; }
    const r = await fetch(API + "/api/drafts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: Number(draftSelectedClient.id), client_name_raw: draftSelectedClient.name,
        draft_type: draftType, title, content,
      }),
    });
    const data = await r.json();
    draftEditingId = data.id;
  }
  msg.textContent = "✅ Saved";
  setTimeout(() => { msg.textContent = ""; }, 1500);
  loadDrafts(draftListClientId);
});

function draftCardHtml(d) {
  const client = d.client_display_name || d.client_name_raw || "-";
  return `<div class="task-card" data-id="${d.id}">
    <div class="row1">
      <span class="client">${esc(client)} <span class="small">— ${esc(d.draft_type)}: ${esc(d.title || "")}</span></span>
      <span class="${badgeClass(d.status === "Approved" ? "NORMAL" : "BLOCKED")}">${esc(d.status)}</span>
    </div>
    <div class="meta">${esc(d.updated_at || "")}</div>
    <div class="notes" style="white-space:pre-wrap;">${esc((d.content || "").slice(0, 220))}${(d.content || "").length > 220 ? "…" : ""}</div>
    <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
      <button class="btn secondary btn-draft-edit">✏️ Edit</button>
      <button class="btn secondary btn-draft-copy">📋 Copy Content</button>
      <button class="btn secondary btn-draft-approve">${d.status === "Approved" ? "↩ Mark Draft" : "✅ Mark Approved"}</button>
      <button class="btn secondary btn-draft-del">✕ Delete</button>
    </div>
  </div>`;
}

async function loadDrafts(clientId) {
  draftListClientId = clientId || null;
  document.getElementById("draft-list-label").textContent = clientId
    ? "Filter: is client ke drafts" : "Sab drafts (koi client filter nahi)";
  const params = new URLSearchParams();
  if (clientId) params.set("client_id", clientId);
  const r = await fetch(API + "/api/drafts?" + params.toString());
  const rows = await r.json();
  const el = document.getElementById("drafts-list");
  if (!rows.length) {
    el.innerHTML = '<div class="empty">Abhi koi draft nahi.</div>';
    return;
  }
  el.innerHTML = rows.map(draftCardHtml).join("");
  el.querySelectorAll(".task-card").forEach(card => {
    const id = card.dataset.id;
    const row = rows.find(d => String(d.id) === id);
    card.querySelector(".btn-draft-edit").addEventListener("click", () => {
      draftEditingId = Number(id);
      draftSelectedClient = { id: row.client_id, name: row.client_display_name || row.client_name_raw };
      document.getElementById("draft-client-search").value = draftSelectedClient.name || "";
      document.getElementById("draft-title").value = row.title || "";
      document.getElementById("draft-type").value = row.draft_type || "Letter";
      document.getElementById("draft-content").value = row.content || "";
      document.getElementById("draft-editor").style.display = "block";
      if (row.client_id) showDraftClientInfo(row.client_id);
      document.getElementById("draft-content").scrollIntoView({ behavior: "smooth" });
    });
    card.querySelector(".btn-draft-copy").addEventListener("click", async (e) => {
      await copyToClipboard(row.content || "");
      flashCopied(e.target, "✅ Copied");
    });
    card.querySelector(".btn-draft-approve").addEventListener("click", async () => {
      await fetch(API + `/api/drafts/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: row.status === "Approved" ? "Draft" : "Approved" }),
      });
      loadDrafts(draftListClientId);
    });
    card.querySelector(".btn-draft-del").addEventListener("click", async () => {
      if (!confirm("Ye draft delete karna hai?")) return;
      await fetch(API + `/api/drafts/${id}`, { method: "DELETE" });
      loadDrafts(draftListClientId);
    });
  });
}
document.getElementById("btn-draft-refresh").addEventListener("click", () => loadDrafts(draftListClientId));
document.getElementById("btn-draft-clear-filter").addEventListener("click", () => loadDrafts(null));

function startDraftFromTask(clientId, clientName, taskType) {
  document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
  document.querySelectorAll('nav button[data-tab="drafts"]').forEach(b => b.classList.add("active"));
  document.querySelectorAll("main > section").forEach(s => s.style.display = "none");
  document.getElementById("tab-drafts").style.display = "block";
  draftSelectedClient = { id: clientId, name: clientName };
  document.getElementById("draft-client-search").value = clientName || "";
  document.getElementById("draft-title").value = taskType || "";
  document.getElementById("draft-type").value = "Letter";
  if (clientId) { showDraftClientInfo(clientId); loadDrafts(clientId); }
}

// initial load
loadToday();
