# Work App — UX Plan

Prepared for Owais · Subject: work app (localhost:8877) · Scope: view/usability only · 2026-09-12
Full designed version: https://claude.ai/code/artifact/90d03b44-19dc-4328-99a6-257d66f006fb

This looks at the dashboard purely as a screen looked at many times a day — not the data model or
Turso backend, which already work. Grounded in the actual `static/style.css`, `static/app.js` and
`index.html` that run the app, tested live in the browser.

**Core problem:** the app tells you everything at once, in the same voice. The fix isn't a
redesign — it's giving urgent things a louder voice than routine ones.

## Keep as-is

- **Today tab's three-way split** (Aapko Karna Hai / Staff Ko Karna Hai / Mai Kar Deta Hun) — mirrors
  how work is handed off in the office. Don't flatten it.
- **Priority colour-coding on task cards** — left border + badge for URGENT-OVERDUE/URGENT/BLOCKED/
  NORMAL/LOW. Extend, don't replace.
- **Shadows only on floating elements** — modal + client-search dropdown. Panels/cards stay flat.
  Protect that discipline as more components get added.
- **Typed "delete" gate** before anything destructive (Sales Tax rows, clients). Right amount of
  friction already.
- **Bilingual voice** — English/Roman Urdu mixed naturally. A feature, not something to standardise
  away.

## Friction points

1. **Daily view** — every Today-tab card is the same visual weight regardless of due date. The
   overdue one doesn't jump out.
2. **Navigation** — 12 flat nav buttons, no `flex-wrap` set, no grouping between daily (Today) and
   rare (Backups) tabs.
3. **Tasks table** — 12-column spreadsheet-style table; narrow columns (Blocked On) wrap into 3-4
   lines; `.cell-input` borders are invisible until hover.
4. **Quick-add flows** — "+ New Client"/"+ Portal" chain native `prompt()` calls; unstyled, blocks
   the page, Cancel on step 2 loses step 1's answer.
5. **Type & colour** — one system font at varying sizes carries all hierarchy; single navy accent +
   5 badge colours.
6. **Save feedback** — each tab hand-rolls its own "✅ Saved" message element.
7. **Theme** — no `prefers-color-scheme: dark` block anywhere in `style.css`.
8. **Search** — 5 independent debounced search boxes (Clients/Tasks/Sales Tax/Credentials/NTN
   Lookup), each its own ~250ms timer — no combined search, occasional visible lag.

## Phase plan

### Phase 1 — this week (quick relief) — ✅ done 2026-09-12
- [x] Overdue due-dates render red with plain-English age ("7 days overdue") instead of relying on
      badge text alone.
- [x] Replace `prompt()` chain in "+ New Client"/"+ Portal" with one small inline form.
- [x] One shared debounce helper for all search boxes.
- [x] `flex-wrap: wrap` on the nav bar.

### Phase 2 — next couple of sessions (foundations) — ✅ done 2026-09-12
- [x] Real type scale in `style.css` (consistent h2/h3 size+weight everywhere, replacing ad hoc
      inline size bumps — kept the system font, no external webfont dependency for a tool that
      needs to work reliably offline).
- [x] Tasks/Clients/Passwords/Sales-Tax tables collapse to stacked label/value cards under 900px
      (`.responsive-table` + `data-label` on every cell).
- [x] Grouped the 12 nav buttons into 3 visual clusters — Daily work (Today/Follow-ups/Approvals/
      Tasks/Notepad) · Clients & money (Clients/Sales Tax/NTN Lookup/Recurring/Drafts/Tax
      Calculator) · Admin (Backups) — with a thin divider, no change to what each tab does.

### Phase 3 — once the above settles (depth) — ✅ done 2026-09-12
- [x] `prefers-color-scheme: dark` block in the existing token set — plus fixed ~10 hardcoded
      `white`/light-hex backgrounds (task cards, nav active tab, dropdowns, inputs) that would
      have stayed white and broken the effect. Tested live — renders correctly.
- [x] One shared toast pattern (`toast()` + `#toast`) for Saved/Deleted/error, replacing the
      duplicated message-span code in Clients/Profile/Drafts; also added to task/client delete.
- [x] Single header search (`#global-search`) querying clients + tasks + notes together,
      grouped results, jumps straight to the client profile or filtered Tasks/Notepad tab.

### Phase 4 — when there's time (compounding polish)
- [ ] Keyboard shortcuts for frequent moves (jump to Today, jump to Clients, focus search).
- [ ] Print stylesheet for the Full Profile page.
