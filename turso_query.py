"""
Reusable CLI to query the office Turso database, so this doesn't need to be
re-written ad hoc every session. Uses an embedded replica (local file synced
with the remote Turso DB) so reads are fast and writes go straight to the
cloud primary.

Usage:
    python turso_query.py "SELECT * FROM tasks WHERE status != 'Done'"
    python turso_query.py "UPDATE tasks SET status = ? WHERE id = ?" --params Done 12
    python turso_query.py "DELETE FROM tasks WHERE id = ?" --params 12 --i-understand-this-is-destructive

Destructive statements (DELETE / DROP / TRUNCATE / ALTER TABLE ... DROP) are
refused unless --i-understand-this-is-destructive is passed. This is a
technical speed bump, not a substitute for actually asking Umair first -- see
CLAUDE.md section 9 and the feedback-db-destructive-ops memory: never pass
that flag without his explicit per-action go-ahead.
"""
import argparse
import json
import os
import re
import sys

import libsql

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from turso_config import TURSO_URL, TURSO_AUTH_TOKEN  # noqa: E402

REPLICA_PATH = os.path.join(HERE, "office_replica.db")

DESTRUCTIVE_RE = re.compile(
    r"^\s*(DELETE\b|DROP\b|TRUNCATE\b|ALTER\s+TABLE\s+\S+\s+DROP\b)", re.IGNORECASE
)


def coerce(value):
    # Long digit strings (NTNs, CNICs, STRNs, registration numbers) must stay strings.
    # int()/float() would drop a leading zero, and the libsql/Hrana remote protocol has
    # been observed round-tripping big Python ints back as floats (e.g. "...897" ->
    # "...897.0") - both silently corrupt the stored value. Row-id style params in this
    # script are always short, so a 7+ digit all-numeric string is never meant as a
    # true integer bind value here.
    if isinstance(value, str) and value.lstrip("-").isdigit() and len(value.lstrip("-")) >= 7:
        return value
    try:
        return int(value)
    except (TypeError, ValueError):
        pass
    try:
        return float(value)
    except (TypeError, ValueError):
        pass
    return value


def main():
    parser = argparse.ArgumentParser(description="Query the office Turso DB")
    parser.add_argument("sql")
    parser.add_argument("--params", nargs="*", default=[])
    parser.add_argument(
        "--i-understand-this-is-destructive",
        action="store_true",
        dest="allow_destructive",
        help="Required to run DELETE/DROP/TRUNCATE. Only pass this after Umair explicitly approves.",
    )
    args = parser.parse_args()

    if DESTRUCTIVE_RE.match(args.sql) and not args.allow_destructive:
        print(json.dumps({
            "error": "BLOCKED: statement looks destructive (DELETE/DROP/TRUNCATE). "
                     "Get Umair's explicit go-ahead first, then re-run with "
                     "--i-understand-this-is-destructive."
        }))
        sys.exit(2)

    conn = libsql.connect(REPLICA_PATH, sync_url=TURSO_URL, auth_token=TURSO_AUTH_TOKEN)
    conn.sync()

    params = [coerce(p) for p in args.params]
    cur = conn.execute(args.sql, params)

    stmt_kind = args.sql.strip().split(None, 1)[0].upper() if args.sql.strip() else ""
    if stmt_kind in ("SELECT", "PRAGMA", "EXPLAIN"):
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]
        print(json.dumps(rows, indent=2, default=str))
    else:
        conn.commit()
        conn.sync()
        print(json.dumps({"ok": True, "lastrowid": getattr(cur, "lastrowid", None)}))


if __name__ == "__main__":
    main()
