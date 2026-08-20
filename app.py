import datetime
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
        "SELECT t.*, c.name AS client_display_name, c.ntn FROM tasks t "
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
    placeholders = ",".join("?" * len(STAFF))
    rows = rows_as_dicts(db.execute(
        "SELECT t.*, c.name AS client_display_name, c.ntn FROM tasks t "
        "LEFT JOIN clients c ON c.id = t.client_id "
        "WHERE t.status NOT IN ('Done','Closed') "
        f"AND ((t.blocked_on IS NOT NULL AND t.blocked_on != '') OR t.owner IN ({placeholders})) "
        "ORDER BY CASE t.priority "
        "WHEN 'URGENT-OVERDUE' THEN 0 WHEN 'URGENT' THEN 1 WHEN 'URGENT-VERIFY DATE' THEN 1 "
        "WHEN 'BLOCKED' THEN 2 WHEN 'NORMAL' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END, t.due_date",
        STAFF,
    ))
    return jsonify(rows)


@app.route("/api/tasks", methods=["GET", "POST"])
def api_tasks():
    db = get_db()
    if request.method == "POST":
        data = request.json or {}
        now = datetime.datetime.now().isoformat(timespec="seconds")
        cur = db.execute(
            "INSERT INTO tasks (client_id, client_name_raw, task_type, period, status, priority, "
            "due_date, blocked_on, plan_day, owner, notes, project, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                data.get("client_id"), data.get("client_name_raw"), data.get("task_type"),
                data.get("period"), data.get("status", "Pending"), data.get("priority"),
                data.get("due_date"), data.get("blocked_on"), data.get("plan_day"),
                data.get("owner"), data.get("notes"), data.get("project", "Tax Practice"), now, now,
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
        "SELECT t.*, c.name AS client_display_name, c.ntn FROM tasks t "
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


@app.route("/api/clients/<int:client_id>")
def api_client_detail(client_id):
    db = get_db()
    client = row_as_dict(db.execute("SELECT * FROM clients WHERE id = ?", (client_id,)))
    if not client:
        return jsonify({"error": "not found"}), 404
    links = rows_as_dicts(db.execute("SELECT category, link_text, link_target FROM client_links WHERE client_id = ?", (client_id,)))
    tasks = rows_as_dicts(db.execute("SELECT * FROM tasks WHERE client_id = ?", (client_id,)))
    return jsonify({
        "client": client,
        "links": links,
        "tasks": tasks,
    })


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
