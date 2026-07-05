# U4 reference audit — old-calendar entry points → disposition

Mission: trade-app-m2-calendar-2026-07-05 · Unit U4 (parallel-run escape hatch, D10).
Method: grepped `trade.html` for every caller of the old-calendar functions, the
schedule sub-tab buttons, the old nav/range controls, and the generated onclick
paths, then dispositioned each against the §2a carry-forward ledger.

**Result: every old entry point is still reachable and functional. Nothing is stranded.**
The old code is byte-for-byte unchanged (U4 only adds a reveal path). The single
thing that changed across M2 is the *default* content of the Schedule tab: the
bottom-nav Schedule tab now boots the NEW calendar (D10 boot default), and the old
cluster is reached via the **"Classic calendar"** row in the calendar filter sheet.

## How the hatch works
- Filter sheet (`ncOpenFilterSheet`) has an "Other → Classic calendar" row → `ncShowClassic()`.
- `ncShowClassic()`: hides `#ncalRoot`, un-hides the old `#viewSchedule > .container`,
  shows the `#ncClassicBar` return bar, and calls the **untouched** `showScheduleSubTab('calendar')`
  — which boots the old calendar exactly as before (Calendar/Team/Availability sub-tabs live).
- Return: the `#ncClassicBar` "← New calendar" button → `ncShowNew()` (hides old container,
  shows `#ncalRoot`, repaints). Round-trip works both ways.
- Persistence: `NC.classic` keeps the user in Classic within a session if they re-enter the
  Schedule tab; a fresh page load resets to the NEW system (boot default = new, per D10).

## Disposition table

| # | Old entry point | Kind | Caller(s) found | Disposition |
|---|---|---|---|---|
| 1 | `showScheduleSubTab('calendar'\|'team'\|'availability')` | fn + 3 sub-tab buttons | `onclick` on `#subTabCalendar/#subTabTeam/#subTabAvail`; called by `ncShowClassic()` | **Reachable** via Classic hatch → the 3 sub-tab buttons are live in the old container |
| 2 | `loadTeamCalendar()` | fn | `showScheduleSubTab` (calendar+team), `calNavWeek`, cache path | **Reachable** via hatch (booted by `showScheduleSubTab('calendar')`) |
| 3 | `renderTeamCalendar()` | fn | `loadTeamCalendar`, `setCalRange` | **Reachable** via hatch (calendar sub-tab + range buttons) |
| 4 | `renderTeamSwimLane()` | fn | `showScheduleSubTab('team')`, `_loadTeamAvailability` | **Reachable** via hatch → Team sub-tab |
| 5 | `renderScheduleView()` | fn (dispatcher) | `showScheduleSubTab('availability')` + availability control handlers | **Reachable** via hatch → Availability sub-tab |
| 6 | `loadAvailabilityData()` | fn | login/boot preload (startup, view-independent) | **Reachable** (runs at login); availability view rendered via `renderScheduleView` |
| 7 | `saveAvailabilityData()` → `api('set_availability')` | fn (WRITE path) | availability UI controls (toggles/leave-range/notes/save) | **Reachable** via hatch → Availability. Code untouched. **No live write fired in this build** (reachability only, per contract) |
| 8 | `calNavWeek(±1)` | fn | `onclick` in old `#calendarHeader` (week/month nav) | **Reachable** via hatch (old container visible) |
| 9 | `setCalRange('week'\|'month')` | fn | `onclick` on `#calRangeWeek/#calRangeMonth` | **Reachable** via hatch |
| 10 | `openCalendarJobPreview(jobId)` | fn (job-preview taps) | generated `onclick` inside `renderTeamCalendar` + swimlane + unassigned cards | **Reachable** via hatch (tap a job card in classic calendar/team) |
| 11 | `openRequestHelpPicker()` | fn | footer button generated in `renderTeamCalendar` | **Reachable** via hatch (lead/admin footer) |
| 12 | `_loadTeamAvailability()` | fn | `renderTeamSwimLane` | **Reachable** via hatch → Team |
| 13 | DOM containers: `#scheduleSubTabs`, `#scheduleCalendarView`, `#scheduleAvailView`, `#scheduleTeamView`, `#calendarBody`, `#teamCalBody`, `#calWeekLabel` | markup | inside old `#viewSchedule > .container` | **Reachable** — the whole container is un-hidden by `ncShowClassic()` |
| 14 | Bottom-nav **Schedule tab** → `showView('schedule')` | app nav | `showView('schedule')` dispatch | **Changed by design (D10):** now boots the NEW calendar; old cluster moved behind the Classic-calendar row. This is the only intentional re-route; the old cluster is not removed, just no longer the tab default |

## §2a carry-forward ledger — item by item
1. Sub-tab cluster — ✓ (row 1)
2. Old calendar render + week/month nav + job-preview taps — ✓ (rows 3, 8, 9, 10)
3. Team view (swimlane + availability overlay) — ✓ (rows 4, 12)
4. Availability view (toggles, leave-range, notes) — ✓ (rows 5, 6)
5. Availability WRITE path (`set_availability`) — ✓ reachable, code untouched, **not fired** (row 7)
6. Every other caller/entry point — ✓ enumerated (rows 8–14)

## Stranded entry points
**None.** Before U4, the old container was hidden with no UI path (U2 set it `display:none`).
U4's Classic-calendar row is the reveal path; after it, every ledger item and every caller
above is reachable and functional.

## Login-gated (deferred to CP2 live tier, like the other DOM handlers)
The hatch reveal + old-calendar boot are DOM/network paths that need a real trade login to
exercise end-to-end (old calendar fetches `api('calendar')`, `api('list_users')`,
`api('get_crew_availability')`). Static/DOM reasoning verified here; the live click-through
(reveal → each sub-tab renders → return) is a CP2 live-tier assertion. **No `set_availability`
write is fired without a test account or the Captain's word.**
