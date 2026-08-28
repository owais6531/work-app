import calendar
import datetime
import json
import shutil
import os
import glob
import subprocess
import sqlite3
import libsql
from flask import Flask, jsonify, request, g, send_from_directory

from turso_config import TURSO_URL, TURSO_AUTH_TOKEN

HERE = os.path.dirname(os.path.abspath(__file__))
DRIVE_ROOT = os.path.join(os.path.expanduser("~"), "My Drive", "Owais", "Online work", "claude employee office tasks")

REPLICA_PATH = os.path.join(HERE, "office_replica.db")
BACKUP_DIR = os.path.join(DRIVE_ROOT, "DB Backups")
XLSX_PATH = os.path.join(DRIVE_ROOT, "Client-Master-List.xlsx")

# Client-portal credentials - LOCAL ONLY. Never synced to Turso, never copied into the
# Drive "work app" folder. Plain local sqlite3 file, deliberately separate from get_db().
CREDS_PATH = os.path.join(HERE, "credentials.db")

app = Flask(__name__, static_folder="static", static_url_path="")

STAFF = ["Iqbal", "Mannan", "Maha", "Amna"]

CHECKLIST_TEMPLATES = [
    ("sales tax", ["Data collect", "Compute", "IRIS file", "Challan generate", "Client ko confirm"]),
    ("income tax", ["Data collect", "Compute/Financials", "IRIS file", "Client ko confirm"]),
    ("wht", ["Statement compile", "IRIS file", "Client ko confirm"]),
    ("withholding", ["Statement compile", "IRIS file", "Client ko confirm"]),
    ("notice", ["Notice review", "Draft reply", "Client approval", "Submit"]),
    ("registration", ["Documents collect", "Application file", "Follow-up", "Certificate receive"]),
    ("secp", ["Documents collect", "Application file", "Follow-up", "Certificate receive"]),
    ("quarterly", ["Data collect", "Prepare", "File", "Confirm"]),
    ("annual", ["Data collect", "Prepare", "File", "Confirm"]),
]


def default_checklist(task_type):
    tt = (task_type or "").lower()
    for keyword, steps in CHECKLIST_TEMPLATES:
        if keyword in tt:
            return json.dumps([{"label": s, "done": False} for s in steps])
    return None


def get_db():
    if "db" not in g:
        g.db = libsql.connect(REPLICA_PATH, sync_url=TURSO_URL, auth_token=TURSO_AUTH_TOKEN)
        g.db.sync()
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def get_creds_db():
    if "creds_db" not in g:
        g.creds_db = sqlite3.connect(CREDS_PATH)
        g.creds_db.row_factory = sqlite3.Row
        g.creds_db.execute("""
            CREATE TABLE IF NOT EXISTS credentials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_sheet TEXT,
                client_name TEXT,
                login_id TEXT,
                password TEXT,
                pin TEXT,
                remarks TEXT,
                extra1 TEXT,
                extra2 TEXT
            )
        """)
    return g.creds_db


@app.teardown_appcontext
def close_db(exception=None):
    g.pop("db", None)
    creds_db = g.pop("creds_db", None)
    if creds_db is not None:
        creds_db.close()


def rows_as_dicts(cur):
    cols = [d[0] for d in cur.description] if cur.description else []
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def row_as_dict(cur):
    cols = [d[0] for d in cur.description] if cur.description else []
    row = cur.fetchone()
    return dict(zip(cols, row)) if row is not None else None


def today_str():
    return datetime.date.today().isoformat()


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/today")
def api_today():
    db = get_db()
    today = datetime.date.today()
    lookahead = today + datetime.timedelta(days=8)
    rows = rows_as_dicts(db.execute(
        "SELECT t.*, c.name AS client_display_name, c.ntn, c.registration_status FROM tasks t "
        "LEFT JOIN clients c ON c.id = t.client_id "
        "WHERE t.status != 'Done' AND t.status != 'Closed'"
    ))

    def is_due_soon(due):
        if not due:
            return False
        try:
            d = datetime.date.fromisoformat(due[:10])
            return d <= lookahead
        except ValueError:
            return False

    urgent_priorities = {"URGENT", "URGENT-OVERDUE", "URGENT-VERIFY DATE"}
    surfaced = [
        r for r in rows
        if r["priority"] in urgent_priorities or is_due_soon(r["due_date"])
    ]
    mine = [r for r in surfaced if r["owner"] == "Umair"]
    staff = [r for r in surfaced if r["owner"] in STAFF]
    claude = [r for r in surfaced if r["owner"] not in STAFF and r["owner"] != "Umair"]
    return jsonify({"date": today.isoformat(), "umair": mine, "staff": staff, "claude": claude})


@app.route("/api/followups")
def api_followups():
    db = get_db()
    # Anyone whose pending work is worth batching into one ask: Umair (the practice owner,
    # some things are genuinely blocked on his own decision) plus office staff.
    followup_people = ["Umair"] + STAFF
    placeholders = ",".join("?" * len(followup_people))
    rows = rows_as_dicts(db.execute(
        "SELECT t.*, c.name AS client_display_name, c.ntn, c.registration_status FROM tasks t "
        "LEFT JOIN clients c ON c.id = t.client_id "
        "WHERE t.status NOT IN ('Done','Closed') "
        f"AND (t.owner IN ({placeholders}) OR (t.blocked_on IS NOT NULL AND t.blocked_on != '')) "
        "ORDER BY CASE t.priority "
        "WHEN 'URGENT-OVERDUE' THEN 0 WHEN 'URGENT' THEN 1 WHEN 'URGENT-VERIFY DATE' THEN 1 "
        "WHEN 'BLOCKED' THEN 2 WHEN 'NORMAL' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END, t.due_date",
        followup_people,
    ))
    return jsonify(rows)


@app.route("/api/tasks", methods=["GET", "POST"])
def api_tasks():
    db = get_db()
    if request.method == "POST":
        data = request.json or {}
        now = datetime.datetime.now().isoformat(timespec="seconds")
        checklist = data.get("checklist") or default_checklist(data.get("task_type"))
        cur = db.execute(
            "INSERT INTO tasks (client_id, client_name_raw, task_type, period, status, priority, "
            "due_date, blocked_on, plan_day, owner, notes, project, checklist, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                data.get("client_id"), data.get("client_name_raw"), data.get("task_type"),
                data.get("period"), data.get("status", "Pending"), data.get("priority"),
                data.get("due_date"), data.get("blocked_on"), data.get("plan_day"),
                data.get("owner"), data.get("notes"), data.get("project", "Tax Practice"), checklist, now, now,
            ),
        )
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201

    q = request.args.get("q", "").strip().lower()
    status = request.args.get("status")
    priority = request.args.get("priority")
    owner = request.args.get("owner")
    plan_day = request.args.get("plan_day")
    project = request.args.get("project")

    sql = (
        "SELECT t.*, c.name AS client_display_name, c.ntn, c.registration_status FROM tasks t "
        "LEFT JOIN clients c ON c.id = t.client_id WHERE 1=1"
    )
    params = []
    if status:
        sql += " AND t.status = ?"
        params.append(status)
    if priority:
        sql += " AND t.priority = ?"
        params.append(priority)
    if owner:
        sql += " AND t.owner = ?"
        params.append(owner)
    if project:
        sql += " AND t.project = ?"
        params.append(project)
    if plan_day:
        sql += " AND t.plan_day = ?"
        params.append(plan_day)
    if q:
        sql += " AND (lower(t.client_name_raw) LIKE ? OR lower(c.name) LIKE ? OR lower(t.notes) LIKE ? OR lower(t.task_type) LIKE ?)"
        params += [f"%{q}%"] * 4
    sql += " ORDER BY CASE t.priority " \
           "WHEN 'URGENT-OVERDUE' THEN 0 WHEN 'URGENT' THEN 1 WHEN 'URGENT-VERIFY DATE' THEN 1 " \
           "WHEN 'BLOCKED' THEN 2 WHEN 'NORMAL' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END, t.plan_day"
    rows = rows_as_dicts(db.execute(sql, params))
    return jsonify(rows)


@app.route("/api/tasks/<int:task_id>", methods=["PUT", "DELETE"])
def api_task_detail(task_id):
    db = get_db()
    if request.method == "DELETE":
        db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        db.commit()
        return "", 204

    data = request.json or {}
    fields = ["client_id", "client_name_raw", "task_type", "period", "status", "priority",
              "due_date", "blocked_on", "plan_day", "owner", "notes", "project"]
    updates, params = [], []
    for f in fields:
        if f in data:
            updates.append(f"{f} = ?")
            params.append(data[f])
    if "checklist" in data:
        updates.append("checklist = ?")
        params.append(json.dumps(data["checklist"]) if not isinstance(data["checklist"], str) else data["checklist"])
    now = datetime.datetime.now().isoformat(timespec="seconds")
    updates.append("updated_at = ?")
    params.append(now)
    if data.get("status") in ("Done", "Closed"):
        updates.append("completed_at = ?")
        params.append(now)
    params.append(task_id)
    db.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/clients")
def api_clients():
    db = get_db()
    q = request.args.get("q", "").strip().lower()
    sql = "SELECT id, name, ntn, group_family, contact_info, registration_status, last_enriched, status_notes FROM clients WHERE 1=1"
    params = []
    if q:
        sql += " AND (lower(name) LIKE ? OR lower(ntn) LIKE ?)"
        params += [f"%{q}%", f"%{q}%"]
    sql += " ORDER BY name LIMIT 500"
    rows = rows_as_dicts(db.execute(sql, params))
    return jsonify(rows)


@app.route("/api/clients/<int:client_id>", methods=["GET", "PUT"])
def api_client_detail(client_id):
    db = get_db()
    if request.method == "PUT":
        data = request.json or {}
        fields = ["name", "ntn", "contact_info", "registration_status", "status_notes", "enrichment_notes"]
        updates, params = [], []
        for f in fields:
            if f in data:
                updates.append(f"{f} = ?")
                params.append(data[f])
        if updates:
            updates.append("last_enriched = ?")
            params.append(today_str())
            params.append(client_id)
            db.execute(f"UPDATE clients SET {', '.join(updates)} WHERE id = ?", params)
            db.commit()
        return jsonify({"ok": True})

    client = row_as_dict(db.execute("SELECT * FROM clients WHERE id = ?", (client_id,)))
    if not client:
        return jsonify({"error": "not found"}), 404
    links = rows_as_dicts(db.execute("SELECT category, link_text, link_target FROM client_links WHERE client_id = ?", (client_id,)))
    tasks = rows_as_dicts(db.execute("SELECT * FROM tasks WHERE client_id = ?", (client_id,)))
    drafts = rows_as_dicts(db.execute("SELECT * FROM drafts WHERE client_id = ? ORDER BY updated_at DESC", (client_id,)))
    return jsonify({
        "client": client,
        "links": links,
        "tasks": tasks,
        "drafts": drafts,
    })


@app.route("/api/recurring", methods=["GET", "POST"])
def api_recurring():
    db = get_db()
    if request.method == "POST":
        data = request.json or {}
        now = datetime.datetime.now().isoformat(timespec="seconds")
        cur = db.execute(
            "INSERT INTO recurring_schedules (client_id, client_name_raw, task_type, months, "
            "due_day, period_offset_months, owner, active, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                data.get("client_id"), data.get("client_name_raw"), data.get("task_type"),
                data.get("months") or "", data.get("due_day"), data.get("period_offset_months", 1),
                data.get("owner", "Umair"), 1, now,
            ),
        )
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201

    rows = rows_as_dicts(db.execute(
        "SELECT r.*, c.name AS client_display_name FROM recurring_schedules r "
        "LEFT JOIN clients c ON c.id = r.client_id ORDER BY r.client_name_raw"
    ))
    return jsonify(rows)


@app.route("/api/recurring/<int:sched_id>", methods=["PUT", "DELETE"])
def api_recurring_detail(sched_id):
    db = get_db()
    if request.method == "DELETE":
        db.execute("DELETE FROM recurring_schedules WHERE id = ?", (sched_id,))
        db.commit()
        return "", 204

    data = request.json or {}
    fields = ["client_id", "client_name_raw", "task_type", "months", "due_day",
              "period_offset_months", "owner", "active"]
    updates, params = [], []
    for f in fields:
        if f in data:
            updates.append(f"{f} = ?")
            params.append(data[f])
    if not updates:
        return jsonify({"ok": True})
    params.append(sched_id)
    db.execute(f"UPDATE recurring_schedules SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    return jsonify({"ok": True})


def add_months(d, months):
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return datetime.date(year, month, day)


@app.route("/api/recurring/generate", methods=["POST"])
def api_recurring_generate():
    db = get_db()
    today = datetime.date.today()
    schedules = rows_as_dicts(db.execute(
        "SELECT * FROM recurring_schedules WHERE active = 1"
    ))
    created = []
    for s in schedules:
        months = [int(m) for m in s["months"].split(",") if m.strip()] if s["months"] else list(range(1, 13))
        if today.month not in months:
            continue
        due_day = s["due_day"] or 1
        last_day = calendar.monthrange(today.year, today.month)[1]
        due_date = datetime.date(today.year, today.month, min(due_day, last_day))
        period_date = add_months(due_date, -(s["period_offset_months"] or 0))
        period_label = period_date.strftime("%b-%Y")

        exists = db.execute(
            "SELECT id FROM tasks WHERE task_type = ? AND period = ? AND "
            "(client_id = ? OR (client_id IS NULL AND client_name_raw = ?))",
            (s["task_type"], period_label, s["client_id"], s["client_name_raw"]),
        ).fetchone()
        if exists:
            continue

        now = datetime.datetime.now().isoformat(timespec="seconds")
        days_to_due = (due_date - today).days
        priority = "URGENT-OVERDUE" if days_to_due < 0 else ("URGENT" if days_to_due <= 8 else "NORMAL")
        checklist = default_checklist(s["task_type"])
        cur = db.execute(
            "INSERT INTO tasks (client_id, client_name_raw, task_type, period, status, priority, "
            "due_date, owner, notes, project, checklist, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                s["client_id"], s["client_name_raw"], s["task_type"], period_label, "Pending", priority,
                due_date.isoformat(), s["owner"] or "Umair", "Auto-generated from recurring schedule.",
                "Tax Practice", checklist, now, now,
            ),
        )
        created.append(cur.lastrowid)
    db.commit()
    return jsonify({"ok": True, "created": created, "count": len(created)})


@app.route("/api/drafts", methods=["GET", "POST"])
def api_drafts():
    db = get_db()
    if request.method == "POST":
        data = request.json or {}
        now = datetime.datetime.now().isoformat(timespec="seconds")
        cur = db.execute(
            "INSERT INTO drafts (client_id, client_name_raw, task_id, draft_type, title, content, "
            "status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                data.get("client_id"), data.get("client_name_raw"), data.get("task_id"),
                data.get("draft_type", "Letter"), data.get("title"), data.get("content", ""),
                data.get("status", "Draft"), now, now,
            ),
        )
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201

    client_id = request.args.get("client_id")
    draft_type = request.args.get("draft_type")
    sql = (
        "SELECT d.*, c.name AS client_display_name, c.ntn FROM drafts d "
        "LEFT JOIN clients c ON c.id = d.client_id WHERE 1=1"
    )
    params = []
    if client_id:
        sql += " AND d.client_id = ?"
        params.append(client_id)
    if draft_type:
        sql += " AND d.draft_type = ?"
        params.append(draft_type)
    sql += " ORDER BY d.updated_at DESC"
    rows = rows_as_dicts(db.execute(sql, params))
    return jsonify(rows)


@app.route("/api/drafts/<int:draft_id>", methods=["PUT", "DELETE"])
def api_draft_detail(draft_id):
    db = get_db()
    if request.method == "DELETE":
        db.execute("DELETE FROM drafts WHERE id = ?", (draft_id,))
        db.commit()
        return "", 204

    data = request.json or {}
    fields = ["client_id", "client_name_raw", "task_id", "draft_type", "title", "content", "status"]
    updates, params = [], []
    for f in fields:
        if f in data:
            updates.append(f"{f} = ?")
            params.append(data[f])
    now = datetime.datetime.now().isoformat(timespec="seconds")
    updates.append("updated_at = ?")
    params.append(now)
    params.append(draft_id)
    db.execute(f"UPDATE drafts SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/approvals", methods=["GET", "POST"])
def api_approvals():
    db = get_db()
    if request.method == "POST":
        data = request.json or {}
        now = datetime.datetime.now().isoformat(timespec="seconds")
        cur = db.execute(
            "INSERT INTO approvals (title, description, status, instructions, related_task_id, project, "
            "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (
                data.get("title"), data.get("description"), data.get("status", "Pending"),
                data.get("instructions"), data.get("related_task_id"),
                data.get("project", "Tax Practice"), now, now,
            ),
        )
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201

    status = request.args.get("status")
    project = request.args.get("project")
    sql = "SELECT * FROM approvals WHERE 1=1"
    params = []
    if status:
        sql += " AND status = ?"
        params.append(status)
    if project:
        sql += " AND project = ?"
        params.append(project)
    sql += " ORDER BY CASE status WHEN 'Pending' THEN 0 WHEN 'Needs Changes' THEN 1 ELSE 2 END, updated_at DESC"
    rows = rows_as_dicts(db.execute(sql, params))
    return jsonify(rows)


@app.route("/api/approvals/<int:approval_id>", methods=["PUT", "DELETE"])
def api_approval_detail(approval_id):
    db = get_db()
    if request.method == "DELETE":
        db.execute("DELETE FROM approvals WHERE id = ?", (approval_id,))
        db.commit()
        return "", 204

    data = request.json or {}
    fields = ["title", "description", "status", "instructions", "related_task_id", "project"]
    updates, params = [], []
    for f in fields:
        if f in data:
            updates.append(f"{f} = ?")
            params.append(data[f])
    if not updates:
        return jsonify({"ok": True})
    now = datetime.datetime.now().isoformat(timespec="seconds")
    updates.append("updated_at = ?")
    params.append(now)
    params.append(approval_id)
    db.execute(f"UPDATE approvals SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/backup", methods=["POST"])
def api_backup():
    db = get_db()
    db.sync()
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    dest = os.path.join(BACKUP_DIR, f"office_{ts}.db")
    shutil.copy2(REPLICA_PATH, dest)
    return jsonify({"ok": True, "file": os.path.basename(dest)})


@app.route("/api/backups")
def api_backups():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    files = sorted(glob.glob(os.path.join(BACKUP_DIR, "office_*.db")), reverse=True)
    out = [
        {"name": os.path.basename(f), "size_kb": round(os.path.getsize(f) / 1024, 1),
         "modified": datetime.datetime.fromtimestamp(os.path.getmtime(f)).isoformat(timespec="seconds")}
        for f in files
    ]
    return jsonify(out)


@app.route("/api/export_excel", methods=["POST"])
def api_export_excel():
    result = subprocess.run(
        ["python", os.path.join(os.path.dirname(__file__), "export_excel.py")],
        capture_output=True, text=True,
    )
    ok = result.returncode == 0
    return jsonify({"ok": ok, "output": result.stdout + result.stderr})


@app.route("/api/open-folder", methods=["POST"])
def api_open_folder():
    data = request.json or {}
    path = data.get("path") or ""
    if not path or not os.path.exists(path):
        return jsonify({"ok": False, "error": "Path nahi mila: " + path}), 404
    os.startfile(path)
    return jsonify({"ok": True})


@app.route("/api/credentials", methods=["GET", "POST"])
def api_credentials():
    db = get_creds_db()
    if request.method == "POST":
        data = request.json or {}
        cur = db.execute(
            "INSERT INTO credentials (source_sheet, client_name, login_id, password, pin, remarks) "
            "VALUES (?,?,?,?,?,?)",
            (data.get("source_sheet") or "Manual", data.get("client_name"), data.get("login_id"),
             data.get("password"), data.get("pin"), data.get("remarks")),
        )
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201

    q = request.args.get("q", "").strip().lower()
    sql = "SELECT * FROM credentials WHERE 1=1"
    params = []
    if q:
        sql += " AND (lower(client_name) LIKE ? OR lower(login_id) LIKE ? OR lower(source_sheet) LIKE ?)"
        params += [f"%{q}%"] * 3
    sql += " ORDER BY client_name LIMIT 1000"
    rows = db.execute(sql, params).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/credentials/<int:cred_id>", methods=["PUT", "DELETE"])
def api_credential_detail(cred_id):
    db = get_creds_db()
    if request.method == "DELETE":
        db.execute("DELETE FROM credentials WHERE id = ?", (cred_id,))
        db.commit()
        return "", 204

    data = request.json or {}
    fields = ["client_name", "login_id", "password", "pin", "remarks", "source_sheet"]
    updates, params = [], []
    for f in fields:
        if f in data:
            updates.append(f"{f} = ?")
            params.append(data[f])
    if not updates:
        return jsonify({"ok": True})
    params.append(cred_id)
    db.execute(f"UPDATE credentials SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/notes", methods=["GET", "POST"])
def api_notes():
    db = get_db()
    if request.method == "POST":
        data = request.json or {}
        content = (data.get("content") or "").strip()
        if not content:
            return jsonify({"error": "content required"}), 400
        now = datetime.datetime.now().isoformat(timespec="seconds")
        cur = db.execute(
            "INSERT INTO notes (content, created_at, status) VALUES (?,?,'New')",
            (content, now),
        )
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201

    rows = rows_as_dicts(db.execute("SELECT * FROM notes ORDER BY id DESC"))
    return jsonify(rows)


@app.route("/api/notes/<int:note_id>", methods=["PUT", "DELETE"])
def api_note_detail(note_id):
    db = get_db()
    if request.method == "DELETE":
        db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        db.commit()
        return "", 204

    data = request.json or {}
    fields = ["status", "resolution", "content"]
    updates, params = [], []
    for f in fields:
        if f in data:
            updates.append(f"{f} = ?")
            params.append(data[f])
    if not updates:
        return jsonify({"ok": True})
    params.append(note_id)
    db.execute(f"UPDATE notes SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/ntn-lookup", methods=["POST"])
def api_ntn_lookup():
    db = get_db()
    data = request.json or {}
    raw_text = data.get("ntns", "")
    import re
    raw_list = re.split(r'[\n,;]+', raw_text)
    ntns = []
    seen = set()
    for raw in raw_list:
        digits = re.sub(r'[^0-9]', '', raw.strip())
        if digits and digits not in seen and len(digits) >= 7:
            ntns.append(digits)
            seen.add(digits)
    if not ntns:
        return jsonify({"results": [], "error": "Koi valid NTN nahi mila"})
    results = []
    for ntn in ntns:
        rows = rows_as_dicts(db.execute(
            "SELECT id, name, ntn, contact_info, registration_status, "
            "group_family, status_notes, last_enriched "
            "FROM clients WHERE ntn = ? LIMIT 5", (ntn,)
        ))
        if rows:
            for row in rows:
                row["found"] = True
                row["input_ntn"] = ntn
                results.append(row)
        else:
            results.append({
                "input_ntn": ntn, "found": False, "name": "NOT FOUND",
                "ntn": ntn, "contact_info": "", "registration_status": "",
                "group_family": "", "status_notes": "", "last_enriched": ""
            })
    return jsonify({"results": results, "total": len(ntns), "found": sum(1 for r in results if r["found"])})


@app.route("/api/sales-tax-returns", methods=["GET", "POST"])
def api_sales_tax_returns():
    db = get_db()
    if request.method == "POST":
        data = request.json or {}
        now = datetime.datetime.now().isoformat(timespec="seconds")
        cur = db.execute(
            "INSERT INTO sales_tax_returns (client_id, client_name, registration_number, "
            "authority, status, submitted_upto, comments, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (
                data.get("client_id"), data.get("client_name"), data.get("registration_number"),
                data.get("authority"), data.get("status", "Pending"), data.get("submitted_upto"),
                data.get("comments"), now,
            ),
        )
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201

    q = request.args.get("q", "").strip().lower()
    status = request.args.get("status")
    authority = request.args.get("authority")
    sql = "SELECT * FROM sales_tax_returns WHERE 1=1"
    params = []
    if status:
        sql += " AND status = ?"
        params.append(status)
    if authority:
        sql += " AND authority LIKE ?"
        params.append(f"%{authority}%")
    if q:
        sql += " AND (lower(client_name) LIKE ? OR lower(registration_number) LIKE ? OR lower(comments) LIKE ?)"
        params += [f"%{q}%"] * 3
    sql += " ORDER BY CASE status WHEN 'Overdue' THEN 0 WHEN 'Due' THEN 1 WHEN 'Pending' THEN 2 WHEN 'Unclear' THEN 3 WHEN 'Submitted' THEN 4 ELSE 5 END, client_name"
    rows = rows_as_dicts(db.execute(sql, params))
    return jsonify(rows)


@app.route("/api/sales-tax-returns/<int:row_id>", methods=["PUT", "DELETE"])
def api_sales_tax_return_detail(row_id):
    db = get_db()
    if request.method == "DELETE":
        db.execute("DELETE FROM sales_tax_returns WHERE id = ?", (row_id,))
        db.commit()
        return "", 204

    data = request.json or {}
    fields = ["client_id", "client_name", "registration_number", "authority", "status",
              "submitted_upto", "comments"]
    updates, params = [], []
    for f in fields:
        if f in data:
            updates.append(f"{f} = ?")
            params.append(data[f])
    if not updates:
        return jsonify({"ok": True})
    now = datetime.datetime.now().isoformat(timespec="seconds")
    updates.append("updated_at = ?")
    params.append(now)
    params.append(row_id)
    db.execute(f"UPDATE sales_tax_returns SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/tax-slabs")
def api_tax_slabs():
    db = get_db()
    rows = rows_as_dicts(db.execute(
        "SELECT tax_year, category, sr_no, amount_from, amount_to, max_tax_within_slab, rate_percent "
        "FROM tax_slabs ORDER BY tax_year, category, sr_no"
    ))
    grouped = {}
    for r in rows:
        grouped.setdefault(r["tax_year"], {}).setdefault(r["category"], []).append({
            "sr_no": r["sr_no"], "from": r["amount_from"], "to": r["amount_to"],
            "max_tax_within_slab": r["max_tax_within_slab"], "rate_percent": r["rate_percent"],
        })
    return jsonify(grouped)


def cumulative_base(brackets, upto_index):
    # Running sum of (width * rate) for brackets before upto_index. Zero-rate brackets
    # (including "flat fee" brackets - rate 0 but a nonzero max_tax_within_slab, e.g.
    # tax year 2019's Rs.1,000/2,000 fixed amounts just above the exemption threshold)
    # contribute nothing to later brackets' base - confirmed against every worked
    # example in the source data, tax years 2018-2026.
    total = 0
    for j in range(upto_index):
        b = brackets[j]
        if b["rate_percent"] and b["rate_percent"] > 0 and b["to"] is not None:
            total += (b["to"] - b["from"]) * (b["rate_percent"] / 100)
    return total


def compute_amount_to_tax(brackets, amount):
    for i, b in enumerate(brackets):
        if amount >= b["from"] and (b["to"] is None or amount <= b["to"]):
            if b["rate_percent"] == 0:
                return (b["max_tax_within_slab"] or 0), b  # exempt, or a flat fixed fee
            base = cumulative_base(brackets, i)
            tax = base + (amount - b["from"]) * (b["rate_percent"] / 100)
            return tax, b
    return None, None


def compute_tax_to_amount(brackets, tax):
    for i, b in enumerate(brackets):
        if b["rate_percent"] == 0:
            flat = b["max_tax_within_slab"] or 0
            if tax == flat:
                return None, b  # exempt/flat-fee bracket - any amount in range matches
            continue
        base = cumulative_base(brackets, i)
        top = base + (b["to"] - b["from"]) * (b["rate_percent"] / 100) if b["to"] is not None else None
        if tax >= base and (top is None or tax <= top):
            amount = b["from"] + (tax - base) / (b["rate_percent"] / 100)
            return amount, b
    return None, None


@app.route("/api/tax-calculate", methods=["POST"])
def api_tax_calculate():
    data = request.json or {}
    tax_year = data.get("tax_year")
    category = data.get("category")
    mode = data.get("mode")
    try:
        value = float(data.get("value"))
    except (TypeError, ValueError):
        return jsonify({"error": "value must be a number"}), 400

    db = get_db()
    rows = rows_as_dicts(db.execute(
        "SELECT sr_no, amount_from AS 'from', amount_to AS 'to', max_tax_within_slab, rate_percent "
        "FROM tax_slabs WHERE tax_year = ? AND category = ? ORDER BY sr_no",
        (tax_year, category),
    ))
    if not rows:
        return jsonify({"error": "no slab data for that year/category"}), 404

    if mode == "amount_to_tax":
        result, bracket = compute_amount_to_tax(rows, value)
    elif mode == "tax_to_amount":
        result, bracket = compute_tax_to_amount(rows, value)
    else:
        return jsonify({"error": "mode must be amount_to_tax or tax_to_amount"}), 400

    if bracket is None:
        return jsonify({"error": "value out of range for this slab table"}), 400

    return jsonify({"result": result, "bracket": bracket})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8877, debug=False)
