const API = "";

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

// ---- Tabs ----
document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll("main > section").forEach(s => s.style.display = "none");
    document.getElementById("tab-" + btn.dataset.tab).style.display = "block";
    if (btn.dataset.tab === "today") loadToday();
    if (btn.dataset.tab === "tasks") loadTasks();
    if (btn.dataset.tab === "clients") loadClients();
    if (btn.dataset.tab === "notepad") loadNotepad();
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
    ${t.notes ? `<div class="notes">${esc(t.notes)}</div>` : ""}
  </div>`;
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
    tbody.innerHTML = '<tr><td colspan="10" class="empty">Koi task nahi mila.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(t => `
    <tr data-id="${t.id}">
      <td><span class="${projectClass(t.project)}">${esc(t.project || "Tax Practice")}</span></td>
      <td>${esc(t.client_display_name || t.client_name_raw || "-")}</td>
      <td>${esc(t.task_type || "")}</td>
      <td><span class="${badgeClass(t.priority)}">${esc(t.priority || "")}</span></td>
      <td>
        <select class="pill-select status-select">
          ${["Pending","In Progress","Done","Closed"].map(s => `<option ${s===t.status?"selected":""}>${s}</option>`).join("")}
        </select>
      </td>
      <td>
        <select class="pill-select owner-select">
          ${["Umair","Claude"].map(o => `<option ${o===t.owner?"selected":""}>${o}</option>`).join("")}
        </select>
      </td>
      <td class="small">${esc(t.due_date || "")}</td>
      <td class="small">${t.plan_day || ""}</td>
      <td class="small">${esc(t.notes || "")}</td>
      <td><button class="btn secondary btn-del">✕</button></td>
    </tr>`).join("");

  tbody.querySelectorAll("tr").forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector(".status-select").addEventListener("change", e =>
      updateTask(id, { status: e.target.value }));
    tr.querySelector(".owner-select").addEventListener("change", e =>
      updateTask(id, { owner: e.target.value }));
    tr.querySelector(".btn-del").addEventListener("click", async () => {
      if (!confirm("Ye task delete karna hai?")) return;
      await fetch(API + `/api/tasks/${id}`, { method: "DELETE" });
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

// initial load
loadToday();
