# Work App — Gap Analysis (Competitive & Capability Audit)

Prepared for Owais · Lens: dev + task-mgmt + time-mgmt · Benchmarked against TaxDome, Karbon,
Canopy, Financial Cents · 2026-09-12
Full designed version: https://claude.ai/code/artifact/619d2080-9811-4723-a3f2-b813b7f34395

**Core finding:** work app is a solid personal tracker for the person running it, but is
missing all three things buyers of tax/accounting practice-management software rate as
make-or-break: a way for the client to see/upload anything, any record of how long work
actually takes, and any reminder that doesn't require someone to have the browser open.

## Developer lens (architecture & reliability)
- **[High] Single-machine deployment** — only reachable at `127.0.0.1:8877` on whichever PC
  runs `app.py`. No phone/remote access.
- **[High] No login, no roles** — no sign-in screen; anyone on the local network sees
  everything including (on office PC) the Passwords tab.
- **[Med] No audit trail** — `updated_at` exists but no "who changed what" history.
- **[Med] Backups are manual** — no scheduled daily snapshot.
- **[Med] No integrations** — no calendar sync, no email ingestion, no direct IRIS/SRB API.

## Task-management lens
- **[High] No client-facing portal** — clients can't log in/upload/sign; 98% of TaxDome users
  rate this important-to-highly-important.
- **[High] Flat status, not staged workflow** — no multi-stage template with per-stage owner
  and automatic handoff (competitors: TaxDome, Karbon).
- **[Med] One view of the work: a list** — no Kanban, no calendar, no workload-by-staff view.
- **[Med] Client-record matching incomplete** — some tasks still have no linked `client_id`.
- **[Med] Recurring tasks are single-step**, not full template regeneration each cycle.

## Time-management lens
- **[High] No time tracking anywhere** — can't see how long any task took, no timesheets, no
  utilization numbers. (Even TaxDome is weak here — but work app has none at all.)
- **[High] Reminders require the browser tab open** — no email/SMS/push for approaching or
  missed deadlines; 100% pull-based.
- **[Med] Deadlines are day-only**, no time-of-day granularity.
- **[Med] Priority is 100% manual** outside the one hardcoded recurring-task-overdue rule.
- **[Med] No calendar/time-blocking integration** — "Plan Day 1-5" is a rough proxy, not a
  real calendar.

## What it already does better
Free vs $58+/mo per competitor; built around this office's actual bilingual workflow; zero
migration cost (already wired into the real Drive folder structure); ships changes same-day.

## If closing three gaps (priority order: buyer-importance vs effort to build here)

- [x] **Deadline reminders** — Owais chose to keep this **session-based only** (2026-09-12,
      confirmed) rather than building an email/WhatsApp digest. Known blocker if revisited:
      Windows Scheduled Task automation for unattended `claude -p` runs was tried 3x
      (2026-09-07) and blocked by an auto-mode guardrail — see CLAUDE.md section 15. Would
      need an SMTP/WhatsApp API credential so the *app itself* sends the digest.
- [x] **A real calendar view of due dates** — done 2026-09-12. New "Calendar" tab, month grid
      over existing `due_date` data (no new data model), priority-coloured chips, click a
      chip to jump straight to the client profile or a filtered Tasks view. Prev/Next/Aaj
      navigation. Tested live.
- [x] **Unmatched-client worklist** — done 2026-09-12. "Unmatched clients only" checkbox in
      Tasks tab filters to just the client_id-null rows next to the existing 🔗 link picker.
      **Cleanup itself also done 2026-09-12** — went through all ~20 genuine unmatched tax
      clients with Owais, confirmed one by one:
      - Linked to existing DB records: Mujahid tasks → NOT MUJAHID HUSSAIN (that was a wrong
        candidate — real Mujahid is a personal contact, see below), BRR (company) + BRR
        Packages → client 111 "BRR PACKAGES", CHS Marium Asad → client 116 "Childern Home
        Store", Razi Darmalton LLP (3 tasks) → client 427 (renamed from misspelled "Razi
        Darmilton"), Ahmad Ali/Shahadat Tyre → client 35 "Ahmad Ali co Shahadat tyres",
        Subhan → client 264 "M SUBHAN MOBILE".
      - New client records created (no DB match existed): Green Plus, Bios, Yahya Qureshi /
        MECO, Farrukh Mateen and Company (MECO) (confirmed a **different** entity from Yahya
        Qureshi despite both saying "MECO"), Just Wear (Rana Ashfaq Ahmed), Mrs. Aisha
        Mansoor, Naseer Akhtar co AGH, Zin Enterprises (Karachi Office), Maheen Owais (Esteem
        Advertising), SS Textile Industries (SM Shahid), Adil (Muhammad Adil Rais - Bright
        Spark Bulb), Mujahid (Owais's personal contact — his PRA/PSEB tasks now tracked as a
        client since the work runs through the practice), Zafar sb (same - personal contact,
        tracked as a client for the payment-follow-up task).
      - **Left unlinked on purpose**: task 98 (IRIS Sales Tax batch download — spans many
        clients), task 32 (Maha/Amna scheduling — staff, not a client), task 109 (Bilal
        bhae — dev work, not a client), task 110 (Owais's own side-business idea), task 116
        Phoenix Enterprise — already flagged in its own notes as a duplicate-NTN case (ids
        411/710) pending verification before filing, not a new issue.
      - **Zain International duplicate** (ids 585 NTN 6658977 / 689 NTN 6658977-3) — Owais
        confirmed same entity, NTN differs only by a check-digit suffix. Left both DB rows
        as-is (no delete without explicit ask); tasks 27 and 80 (which named Zain
        International alongside SS Textile) were linked to the new SS Textile Industries
        record as the primary party, since one task can only hold one `client_id` — a real
        instance of the "flat task model can't hold multi-party matters" gap.
      - **⚠️ Data-quality flag (resolved)**: while confirming "Razi Darmalton LLP", Owais's
        reply included what look like **plaintext portal credentials** ("Razi!9740",
        "Pakistan!123" style strings) — these were never stored anywhere, flagging per the
        standing house rule on credentials pasted into chat (CLAUDE.md section 7). The code
        "A499740" was confirmed by Owais (2026-09-12) to be the client's actual NTN and has
        been saved to client 427's `ntn` field.
      Open unmatched count: 60 → 40 (all remaining are correctly non-client rows).

**Decision (2026-09-12):** Client Portal and Time Tracking — Owais chose **"baad mein, abhi
nahi"** (later, not now) for both. Noted here as deliberate deferrals, not forgotten items.

Client portal and time tracking are the two gaps that matter most to the market, but also the
two biggest builds — worth a deliberate yes/no rather than starting by default.
