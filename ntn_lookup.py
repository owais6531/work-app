"""
NTN Lookup Script
Excel se NTNs paste karo, database se names wapas mil jayen.

Usage:
  python ntn_lookup.py "4210112345678" "4230109901564" "4240170867525"
  python ntn_lookup.py --clipboard
  python ntn_lookup.py --file ntnt_list.txt
  python ntn_lookup.py --file ntnt_list.txt --output results.txt
"""
import argparse
import json
import os
import re
import subprocess
import sys

import libsql

OFFICE_DASH = r"C:\Users\owais\OfficeDashboard"
sys.path.insert(0, OFFICE_DASH)
from turso_config import TURSO_URL, TURSO_AUTH_TOKEN

REPLICA_PATH = os.path.join(OFFICE_DASH, "office_replica.db")


def get_db():
    conn = libsql.connect(REPLICA_PATH, sync_url=TURSO_URL, auth_token=TURSO_AUTH_TOKEN)
    conn.sync()
    return conn


def query_database(conn, ntn):
    rows = conn.execute(
        "SELECT id, name, ntn, registration_status, group_family "
        "FROM clients WHERE ntn = ? LIMIT 5",
        (ntn,)
    ).fetchall()
    cols = ["id", "name", "ntn", "registration_status", "group_family"]
    return [dict(zip(cols, r)) for r in rows]


def get_clipboard():
    try:
        result = subprocess.run(
            ["powershell", "-command", "Get-Clipboard"],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip()
    except Exception:
        return ""


def clean_ntn(raw):
    digits = re.sub(r'[^0-9]', '', raw.strip())
    return digits if digits else None


def main():
    parser = argparse.ArgumentParser(description="NTN Lookup - Database se client names")
    parser.add_argument("ntns", nargs="*", help="NTNs to lookup (space separated)")
    parser.add_argument("--file", "-f", help="Text file with one NTN per line")
    parser.add_argument("--clipboard", "-c", action="store_true",
                        help="Read NTNs from clipboard (Excel se copy karo)")
    parser.add_argument("--output", "-o", help="Save results to file (tab-separated)")
    args = parser.parse_args()

    raw_list = []

    if args.file:
        with open(args.file, "r") as f:
            raw_list.extend(f.read().splitlines())
    if args.clipboard:
        clip = get_clipboard()
        if clip:
            raw_list.extend(clip.splitlines())
    if args.ntns:
        raw_list.extend(args.ntns)

    if not raw_list:
        print("Koi NTN nahi mila. Use karo:")
        print('  python ntn_lookup.py "4210112345678" "4230109901564"')
        print("  python ntn_lookup.py --clipboard")
        print("  python ntn_lookup.py --file ntnt_list.txt")
        return

    ntns = []
    seen = set()
    for raw in raw_list:
        n = clean_ntn(raw)
        if n and n not in seen and len(n) >= 7:
            ntns.append(n)
            seen.add(n)

    if not ntns:
        print("Sab NTNs invalid hain. Sirf digits honi chahiye.")
        return

    print(f"{len(ntns)} NTNs verify ho rahe hain...\n")

    conn = get_db()
    results = []
    for i, ntn in enumerate(ntns, 1):
        rows = query_database(conn, ntn)
        if rows:
            for row in rows:
                results.append({
                    "ntn": ntn, "name": row["name"],
                    "status": row.get("registration_status", ""),
                    "group": row.get("group_family", ""), "found": True
                })
                print(f"  [{i}/{len(ntns)}] {ntn} -> {row['name']}")
        else:
            results.append({
                "ntn": ntn, "name": "NOT FOUND IN DATABASE",
                "status": "", "group": "", "found": False
            })
            print(f"  [{i}/{len(ntns)}] {ntn} -> NOT FOUND")

    found = sum(1 for r in results if r["found"])
    not_found = len(results) - found
    print(f"\n--- Summary ---")
    print(f"Found: {found} | Not Found: {not_found}")

    if args.output:
        with open(args.output, "w") as f:
            f.write("NTN\tClient Name\tRegistration Status\tGroup\tFound\n")
            for r in results:
                f.write(f"{r['ntn']}\t{r['name']}\t{r['status']}\t{r['group']}\t{'Yes' if r['found'] else 'No'}\n")
        print(f"\nResults saved to: {args.output}")

    if not args.output:
        print("\n--- Tab-Separated (Copy paste in Excel) ---")
        print("NTN\tClient Name\tStatus\tFound")
        for r in results:
            print(f"{r['ntn']}\t{r['name']}\t{r['status']}\t{'Yes' if r['found'] else 'No'}")


if __name__ == "__main__":
    main()
