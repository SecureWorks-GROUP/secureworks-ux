// CP2 smoke — the calendar system renders, the old world still works
// (trade-app-redesign · M2, units U2+U3+U4). Authored by Verifier V (independent).
// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH: this script READS ../../trade.html, extracts BOTH
// sentinel blocks (`// <calendar-adapter-core>` and `// <calendar-renderers>`),
// and evaluates THEM. No adapter/renderer logic is re-declared here, so the test
// can never pass while shipped code is wrong.
//
// It drives the pure renderers off the CAPTURED live week (no trade login needed —
// the credentials floor of contract R2/CP2). Raw counts are computed INDEPENDENTLY
// from the fixture JSON (Codex C3: rendered counts asserted to MATCH raw counts,
// genuinely-empty states asserted as the CORRECT empty state, never "non-empty").
//
// Run:  node cp2-smoke.mjs        Exit: non-zero if any non-deferred item fails.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');            // worktree root (trade.html lives here)
// Compare against the BRANCH BASE (merge-base), not the moving origin/main tip — origin/main
// can advance under us mid-mission (other work landing), which would spuriously fail the
// additive-discipline diff. The merge-base is where this branch actually forked.
let BASE = 'origin/main';
try { BASE = execSync(`git -C ${REPO} merge-base HEAD origin/main`, { encoding: 'utf8' }).trim() || 'origin/main'; } catch (e) { /* git optional */ }
const TRADE_HTML = resolve(__dirname, '../../trade.html');
const FIXTURE = resolve(__dirname, 'fixtures/live-week-2026-07-06.json');
const HTML = readFileSync(TRADE_HTML, 'utf8');

function extractBlock(open, close) {
  const a = HTML.indexOf(open), b = HTML.indexOf(close);
  if (a < 0 || b < 0 || b <= a) throw new Error(`sentinels not found: ${open}`);
  return HTML.slice(a + open.length, b);
}
// Evaluate both sentinel blocks together so CalRender + CalAdapterCore are the REAL ones.
const core = extractBlock('// <calendar-adapter-core>', '// </calendar-adapter-core>');
const rend = extractBlock('// <calendar-renderers>', '// </calendar-renderers>');
const { CalAdapterCore: CA, CalRender: CR } =
  new Function(core + '\n' + rend + '\n;return { CalAdapterCore: CalAdapterCore, CalRender: CalRender };')();

// ── assert harness ──────────────────────────────────────────────────────────
let passed = 0, failed = 0, deferred = 0;
const fails = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ PASS  ${name}`); }
  catch (e) { failed++; fails.push(name); console.log(`  ✗ FAIL  ${name}\n         ${e.message}`); }
}
function defer(name, why) { deferred++; console.log(`  — DEFER ${name}\n         (CP4 live tier: ${why})`); }
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n         expected ${JSON.stringify(b)}\n         got      ${JSON.stringify(a)}`); }

// ── load fixture + independent RAW model (NOT via the adapter) ───────────────
const fix = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const EV = fix.events;
const rawJobEvents = EV.filter(e => e.job_id != null);      // real jobs (org rows have null job_id)
const rawOrg = EV.filter(e => e.job_id == null);
const parseT = t => { if (t == null) return null; const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1] + (+m[2]) / 60) : null; };
// independent per-date raw counts over REAL jobs (all real jobs carry assigned_to == crew)
function rawTimedOn(d) { return rawJobEvents.filter(e => e.scheduled_date === d && parseT(e.start_time) != null).length; }
function rawUntimedOn(d) { return rawJobEvents.filter(e => e.scheduled_date === d && parseT(e.start_time) == null).length; }
function rawAssignedOn(d) { return rawJobEvents.filter(e => e.scheduled_date === d).length; } // all real jobs have crew
const rawDates = [...new Set(rawJobEvents.map(e => e.scheduled_date))].sort();
// ── UNIQUE (job_id, date) truth, derived INDEPENDENTLY from raw (not via the adapter) ──
// Jobs-axis views (day/week/month) dedupe by job+date and join crew names (§2a). So the
// rendered jobs-axis block count must reconcile to DISTINCT job_id per date, NOT the raw
// per-assignment count. These helpers compute that expectation from the raw fixture alone.
function uniqJobsOn(d) { return [...new Set(rawJobEvents.filter(e => e.scheduled_date === d).map(e => e.job_id))]; }
function rawUniqueOn(d) { return uniqJobsOn(d).length; }
function rawUniqueUntimedOn(d) {
  return uniqJobsOn(d).filter(jid =>
    rawJobEvents.filter(e => e.scheduled_date === d && e.job_id === jid).every(r => parseT(r.start_time) == null)
  ).length;
}

// ── build the SHIPPED model exactly as renderNewCalendar does ────────────────
const adapted = CA.adaptEvents(EV);
const jobBlocks = adapted.blocks.filter(b => b._jobId);      // renderNewCalendar's org/meeting filter
const people = CA.buildPeople([], jobBlocks);
const TODAY = rawDates[0];                                   // anchor "today" from raw data
const M = { blocks: jobBlocks, people, today: TODAY, now: 12.0, _unmapped: adapted.unmappedStatuses };
// pick the busiest real crew for the Mine-lens assertions
const crewCount = {}; jobBlocks.forEach(b => { if (b.crew) crewCount[b.crew] = (crewCount[b.crew] || 0) + 1; });
const meName = Object.keys(crewCount).sort((a, b) => crewCount[b] - crewCount[a])[0];
const meId = (jobBlocks.find(b => b.crew === meName) || {})._userId || null;
const ME = { id: meId, name: meName };
function st(over) { return Object.assign({ calView: 'cal', scale: 'day', axis: 'crew', type: 'all', scope: 'everyone', me: ME, boardAllowed: true }, over); }
const countJobBtns = html => (html.match(/data-job="/g) || []).length;
const ucount = html => { const m = html.match(/class="ucount">(\d+)/); return m ? +m[1] : 0; };
const clean = html => !/undefined|NaN|\[object Object\]/.test(html);

console.log('\nCP2 smoke — renderers + adapter extracted from trade.html; driven off the captured live week\n');
console.log(`  fixture: ${EV.length} events | real jobs: ${rawJobEvents.length} | org/meeting rows: ${rawOrg.length} | anchor today: ${TODAY} | me: ${meName}/${meId}\n`);

// ═══════════════════════════════════════════════════════════════════════════
// ITEM 1 — RAW-TRUTH ANCHOR (Codex C3): rendered counts MATCH raw counts.
// ═══════════════════════════════════════════════════════════════════════════
console.log('ITEM 1 — raw-truth anchor');
test('1a independent raw invariants hold (50 total, 42 real jobs, 8 org)', () => {
  eq(EV.length, 50, 'fixture total');
  eq(rawJobEvents.length, 42, 'real jobs (job_id present)');
  eq(rawOrg.length, 8, 'org/meeting rows (job_id null)');
  eq(rawJobEvents.filter(e => parseT(e.start_time) == null).length, 18, 'null-start real jobs');
});
test('1b adapter model reconciles to raw (org filtered = exactly the 8 null-job_id rows)', () => {
  eq(adapted.blocks.length, 50, 'adaptEvents 1:1 with input');
  eq(jobBlocks.length, 42, 'job blocks after b._jobId filter == real jobs');
  const filtered = adapted.blocks.filter(b => !b._jobId);
  eq(filtered.length, 8, '8 blocks filtered out');
  ok(filtered.every(b => rawOrg.some(o => o.assignment_id === b.id)), 'the 8 filtered are exactly the org rows');
  eq(jobBlocks.filter(b => b.start == null).length, 18, 'null-start survives into job blocks (not dropped)');
});
test('1c per-type on job blocks matches raw classifier (fencing30/patio8/makesafe4, no other)', () => {
  const by = {}; jobBlocks.forEach(b => { by[b.type] = (by[b.type] || 0) + 1; });
  eq(by, { fencing: 30, patio: 8, makesafe: 4 }, 'job blocks carry only the three real chip types');
});
test('1d-pre no (job_id,date) pair has mixed timed/untimed rows (dedupe expectation is unambiguous)', () => {
  const mixed = rawDates.flatMap(d => uniqJobsOn(d).filter(jid => {
    const starts = rawJobEvents.filter(e => e.scheduled_date === d && e.job_id === jid).map(r => parseT(r.start_time) == null);
    return new Set(starts).size > 1;
  }).map(jid => `${jid}@${d}`));
  eq(mixed, [], 'every job+date is uniformly timed or uniformly untimed');
});
test('1d DAY×jobs rendered count == UNIQUE job+date (dedupe truth, FIX 2) for every real date', () => {
  rawDates.forEach(d => {
    const html = CR.renderDayJobs(M, st({ scale: 'day', axis: 'jobs', date: d, month: d.slice(0, 8) + '01' }));
    const expect = rawUniqueOn(d);   // distinct job_id on the date — jobs-axis dedupes multi-crew to one block
    eq(countJobBtns(html), expect, `day×jobs ${d}: rendered buttons == unique job+date ${expect} (raw per-assignment was ${rawAssignedOn(d)})`);
    eq(ucount(html), rawUniqueUntimedOn(d), `day×jobs ${d}: untimed section count == unique untimed`);
    ok(clean(html), `day×jobs ${d}: no undefined/NaN`);
  });
});
test('1e genuinely-empty day asserts the CORRECT empty state (not "non-empty")', () => {
  const empty = '2026-07-05'; // a Sunday before the fixture range → 0 jobs
  eq(rawAssignedOn(empty), 0, 'precondition: raw has 0 jobs that day');
  const dc = CR.renderTimeline(M, st({ scale: 'day', axis: 'crew', date: empty }));
  const dj = CR.renderDayJobs(M, st({ scale: 'day', axis: 'jobs', date: empty }));
  ok(/No one booked|Nothing/.test(dc) && countJobBtns(dc) === 0, 'day×crew empty-state shown, 0 blocks');
  ok(/Nothing on/.test(dj) && countJobBtns(dj) === 0, 'day×jobs empty-state shown, 0 blocks');
});
test('1f unassigned strip is the CORRECT EMPTY STATE on this fixture (0 unassigned everywhere)', () => {
  eq(jobBlocks.filter(b => !b.crew).length, 0, 'precondition: 0 unassigned real jobs in the week');
  rawDates.forEach(d => {
    const ch = CR.chrome(M, st({ scale: 'day', date: d }));
    ok(ch.unstrip.visible === false, `strip hidden (empty) on ${d} even for manager+everyone`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ITEM 2 — every scale×axis + Run Sheet render; 0 undefined/NaN; controls; nulls.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nITEM 2 — six states + Run Sheet + chrome + null-start affordance');
const states = [
  ['day×crew', { scale: 'day', axis: 'crew' }], ['day×jobs', { scale: 'day', axis: 'jobs' }],
  ['week×crew', { scale: 'week', axis: 'crew' }], ['week×jobs', { scale: 'week', axis: 'jobs' }],
  ['month×crew', { scale: 'month', axis: 'crew' }], ['month×jobs', { scale: 'month', axis: 'jobs' }],
  ['runsheet', { calView: 'run' }]
];
states.forEach(([label, over]) => {
  test(`2 ${label} renders clean (no undefined/NaN/[object Object])`, () => {
    const s = st(Object.assign({ date: TODAY, month: TODAY.slice(0, 8) + '01' }, over));
    const html = CR.render(M, s);
    ok(html && html.length > 0, 'non-null render');
    ok(clean(html), 'no undefined/NaN in output');
    const ch = CR.chrome(M, s);
    ok(typeof ch.badgeCount === 'number' && !Number.isNaN(ch.badgeCount), 'badge is a number');
    ok(clean(ch.railHTML || ''), 'rail html clean');
    ok(clean(ch.unstrip.html || ''), 'strip html clean');
  });
});
test('2 controls-active: rail on day only; period bar on week/month cal; badge tracks filters', () => {
  ok(CR.chrome(M, st({ scale: 'day', date: TODAY })).railVisible === true, 'rail visible on day');
  ok(CR.chrome(M, st({ scale: 'week', date: TODAY })).railVisible === false, 'rail hidden on week');
  ok(CR.chrome(M, st({ calView: 'cal', scale: 'week', date: TODAY })).periodbarHidden === false, 'period bar on week');
  ok(CR.chrome(M, st({ calView: 'cal', scale: 'day', date: TODAY })).periodbarHidden === true, 'no period bar on day');
  eq(CR.chrome(M, st({ scale: 'day', date: TODAY, type: 'all', scope: 'everyone' })).badgeCount, 0, 'default filters → badge 0');
  eq(CR.chrome(M, st({ scale: 'day', date: TODAY, type: 'fencing', scope: 'mine' })).badgeCount, 2, 'type+scope changed → badge 2');
});
test('2 WEEK×jobs rendered count reconciles to UNIQUE job+date across the anchor week (FIX 2)', () => {
  const mon = CR.mondayOf(TODAY);
  const days = []; for (let i = 0; i < 6; i++) days.push(CR.addDays(mon, i));
  const rawWeekUnique = days.reduce((n, d) => n + rawUniqueOn(d), 0);        // e.g. 21 (was 30 per-assignment)
  const rawWeekPerAsg = days.reduce((n, d) => n + rawAssignedOn(d), 0);
  const rawWeekUn = days.reduce((n, d) => n + rawUniqueUntimedOn(d), 0);
  const html = CR.renderWeekJobs(M, st({ scale: 'week', axis: 'jobs', date: TODAY }));
  eq(countJobBtns(html), rawWeekUnique, `week×jobs buttons == unique job+date ${rawWeekUnique} (raw per-assignment was ${rawWeekPerAsg})`);
  eq(ucount(html), rawWeekUn, 'week×jobs untimed section == unique untimed');
});
test('2 crew-axis is NOT deduped: a multi-crew job appears once PER crew column (dedupe did not leak)', () => {
  // find a date with a job assigned to >1 crew in the raw fixture
  const d = rawDates.find(dd => uniqJobsOn(dd).some(jid =>
    rawJobEvents.filter(e => e.scheduled_date === dd && e.job_id === jid).length > 1));
  ok(d, 'precondition: some date has a multi-crew job');
  const crewHtml = CR.renderTimeline(M, st({ scale: 'day', axis: 'crew', date: d }));
  const jobsHtml = CR.renderDayJobs(M, st({ scale: 'day', axis: 'jobs', date: d }));
  // crew-axis renders per-assignment; jobs-axis dedupes → crew-axis count strictly greater on a multi-crew day
  ok(countJobBtns(crewHtml) > countJobBtns(jobsHtml),
    `crew-axis per-assignment (${countJobBtns(crewHtml)}) > jobs-axis unique (${countJobBtns(jobsHtml)}) on ${d}`);
  eq(countJobBtns(jobsHtml), rawUniqueOn(d), `jobs-axis == unique ${rawUniqueOn(d)} on ${d}`);
});
test('2 null-start real jobs land in the "No time set" affordance (not on the grid, not dropped)', () => {
  // choose a real date that has at least one untimed real job
  const d = rawDates.find(dd => rawUntimedOn(dd) > 0);
  ok(d, 'precondition: some date has an untimed real job');
  [['crew', CR.renderTimeline], ['jobs', CR.renderDayJobs]].forEach(([axis, fn]) => {
    const html = fn(M, st({ scale: 'day', axis, date: d }));
    ok(/No time set/.test(html), `${axis}: untimed section present on ${d}`);
    eq(ucount(html), rawUntimedOn(d), `${axis}: untimed count == raw untimed on ${d}`);
    // every untimed job button appears; none placed on a time grid (grid blocks use top:/height: px)
    const untimedIds = jobBlocks.filter(b => b.date === d && b.start == null).map(b => b.id);
    untimedIds.forEach(id => ok(html.indexOf('data-job="' + id + '"') >= 0, `untimed ${id} rendered`));
  });
});
test('2 type=other never appears as its own chip bucket on live job data (org rows filtered)', () => {
  ok(jobBlocks.every(b => b.type !== 'other'), 'no job block is neutral "other" (all real jobs classify)');
  // and a type filter to a real chip only narrows, never errors
  const html = CR.render(M, st({ scale: 'day', axis: 'jobs', date: TODAY, type: 'makesafe' }));
  ok(clean(html), 'type-filtered render clean');
});

// ═══════════════════════════════════════════════════════════════════════════
// ITEM 3 — carry-forward ledger: independent re-audit + byte-identity + machine.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nITEM 3 — carry-forward ledger (independent re-audit)');
const OLD_FNS = ['loadTeamCalendar', 'renderTeamCalendar', 'renderScheduleView', 'loadAvailabilityData', 'saveAvailabilityData', 'showScheduleSubTab'];
const OTHER_ENTRIES = ['calNavWeek', 'setCalRange', 'openCalendarJobPreview', 'renderTeamSwimLane', '_loadTeamAvailability', 'openRequestHelpPicker'];
test('3a every old-calendar entry point still exists in trade.html (re-grepped, not trusted from audit)', () => {
  OLD_FNS.concat(OTHER_ENTRIES).forEach(fn => ok(HTML.indexOf(fn) >= 0, `${fn} present`));
});
test('3b the U4 audit file enumerates all six required old functions', () => {
  const audit = readFileSync(resolve(__dirname, '../AUDIT-old-calendar-refs.md'), 'utf8');
  OLD_FNS.forEach(fn => ok(audit.indexOf(fn) >= 0, `audit lists ${fn}`));
});
test('3c reveal state machine round-trips both ways (structural)', () => {
  ok(/function ncShowClassic\s*\(/.test(HTML), 'ncShowClassic defined');
  ok(/function ncShowNew\s*\(/.test(HTML), 'ncShowNew defined');
  ok(/onclick="ncShowNew\(\)"/.test(HTML), 'classic bar button returns to new (→ ncShowNew)');
  ok(/data-classic="1"/.test(HTML), 'filter sheet Classic-calendar row present (→ ncShowClassic)');
  ok(/showScheduleSubTab\('calendar'\)/.test(HTML), 'ncShowClassic boots the untouched old sub-tab');
});
// byte-identity vs origin/main (git-guarded; core blocking check of item 3)
let gitOK = true; let numstat = '';
try { numstat = execSync(`git -C ${REPO} diff --numstat ${BASE} -- trade.html`, { encoding: 'utf8' }).trim(); }
catch (e) { gitOK = false; }
test('3d additive discipline: exactly 1 deletion vs origin/main (the schedule dispatch line only)', () => {
  ok(gitOK, 'git available');
  const parts = numstat.split(/\s+/); // "<add>\t<del>\ttrade.html"
  eq(parts[1], '1', `deletions == 1 (got numstat: ${numstat})`);
  const del = execSync(`git -C ${REPO} diff ${BASE} -- trade.html`, { encoding: 'utf8' })
    .split('\n').filter(l => /^-[^-]/.test(l));
  eq(del.length, 1, 'exactly one deleted line in the diff');
  ok(/view === 'schedule'.*loadTeamCalendar\(\); renderScheduleView\(\);/.test(del[0]), 'the deleted line is the old schedule dispatch');
});
test('3e the six old functions are byte-identical to origin/main (0 old-calendar bytes changed)', () => {
  ok(gitOK, 'git available');
  const main = execSync(`git -C ${REPO} show ${BASE}:trade.html`, { encoding: 'utf8' });
  OLD_FNS.forEach(fn => {
    // extract each function's source slice from an anchor to the next 'function ' at col 2, from both files
    const grab = (src) => {
      const patterns = [`function ${fn}(`, `${fn} = function`, `window.${fn} = function`];
      let i = -1; for (const p of patterns) { i = src.indexOf(p); if (i >= 0) break; }
      ok(i >= 0, `${fn} found`);
      return src.slice(i, i + 1400); // fixed window; identical windows ⇒ identical bodies
    };
    eq(grab(HTML), grab(main), `${fn} byte-identical to origin/main`);
  });
});
defer('3f live reveal click-through (reveal → each sub-tab renders → return)', 'needs a trade login; old calendar fetches calendar/list_users/get_crew_availability');
defer('3g availability WRITE path (set_availability) end-to-end', 'no live write without a test account or the Captain’s word (contract §2a item 5)');

// ═══════════════════════════════════════════════════════════════════════════
// ITEM 4 — unassigned-strip predicate matrix (with a synthetic unassigned block).
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nITEM 4 — unassigned-strip predicate matrix');
// inject ONE synthetic unassigned block (crew null) on TODAY so un.length > 0 and the
// matrix is exercised for real (the live fixture legitimately has 0 unassigned).
const synthUn = Object.assign({}, jobBlocks[0], { id: 'SYNTH-UN', crew: null, _crewKey: null, _userId: null, start: null, end: null, date: TODAY });
const Msyn = { blocks: jobBlocks.concat([synthUn]), people, today: TODAY, now: 12.0, _unmapped: [] };
function stripVisible(over) { return CR.chrome(Msyn, st(Object.assign({ date: TODAY, month: TODAY.slice(0, 8) + '01' }, over))).unstrip.visible; }
test('4a VISIBLE for manager + Everyone + day and week', () => {
  ok(stripVisible({ boardAllowed: true, scope: 'everyone', scale: 'day' }) === true, 'manager+everyone+day');
  ok(stripVisible({ boardAllowed: true, scope: 'everyone', scale: 'week' }) === true, 'manager+everyone+week');
});
test('4b HIDDEN for non-manager, for Mine lens, and for Month scale', () => {
  ok(stripVisible({ boardAllowed: false, scope: 'everyone', scale: 'day' }) === false, 'non-manager hidden');
  ok(stripVisible({ boardAllowed: true, scope: 'mine', scale: 'day' }) === false, 'mine lens hidden');
  ok(stripVisible({ boardAllowed: true, scope: 'everyone', scale: 'month' }) === false, 'month scale hidden');
});
test('4c the strip predicate is the SAME M1 Board predicate at display AND at the Board CTA dispatch', () => {
  // ncBoardAllowed drives st.boardAllowed (display) and gates the "Open the Board" CTA (dispatch).
  const nc = HTML.match(/function ncBoardAllowed\(\)\s*\{[^}]*\}/)[0];
  ok(/_isAdmin\s*\|\|\s*\(Array\.isArray\(mv\)\s*&&\s*mv\.length\s*>\s*0\)/.test(nc), 'ncBoardAllowed = _isAdmin || managed_verticals non-empty');
  // M1 Board nav button predicate (onLogin) must be structurally identical
  ok(/_isAdmin\s*\|\|\s*\(Array\.isArray\(_mv\)\s*&&\s*_mv\.length\s*>\s*0\)/.test(HTML), 'M1 nav Board predicate matches (same shape)');
  ok(/if \(ncBoardAllowed\(\)\) showView\('board'\)/.test(HTML), 'Board CTA dispatch gated by the SAME ncBoardAllowed()');
});

// ═══════════════════════════════════════════════════════════════════════════
// ITEM 5 — clock-recovery pre-merge guard (static boot trace; Codex C2).
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nITEM 5 — clock-recovery pre-merge guard (static boot trace)');
test('5a the ONLY boot/dispatch change is showView(schedule) → renderNewCalendar()', () => {
  ok(/if \(view === 'schedule'\) \{ renderNewCalendar\(\); \}/.test(HTML), 'schedule dispatch now renders the new calendar');
});
test('5b clock-recovery warm-load RESTORED (FIX 1): fires at Calendar-first boot; recovery fn bodies unchanged', () => {
  ok(gitOK, 'git available');
  const main = execSync(`git -C ${REPO} show ${BASE}:trade.html`, { encoding: 'utf8' });
  // (i) the recovery fn + its trigger fn BODIES are still byte-identical — FIX 1 added a call site, not a body change
  const grab = (src, anchor, n) => { const i = src.indexOf(anchor); ok(i >= 0, anchor + ' present'); return src.slice(i, i + n); };
  eq(grab(HTML, 'function checkServerClockRecovery(data)', 1600), grab(main, 'function checkServerClockRecovery(data)', 1600), 'checkServerClockRecovery body identical');
  eq(grab(HTML, 'window.loadMyJobs = function loadMyJobs()', 1800), grab(main, 'window.loadMyJobs = function loadMyJobs()', 1800), 'loadMyJobs body identical');
  // (ii) the warm-load is PRESENT in onLogin's non-deep-link boot path (positive proof)
  const onLogin = grab(HTML, 'function onLogin(profile)', 6000);
  ok(/if \(_currentView !== 'myJobs'\) loadMyJobs\(\);/.test(onLogin), 'warm-load call present in onLogin');
  ok(/Restored M1 F1 fix/.test(onLogin), 'documented as the restored M1 F1 fix');
  // (iii) it sits AFTER the default showView('schedule') dispatch (so it warms my_jobs on a Calendar-first boot)…
  const iSched = onLogin.indexOf("showView('schedule')");
  const iWarm = onLogin.indexOf("if (_currentView !== 'myJobs') loadMyJobs();");
  ok(iSched >= 0 && iWarm > iSched, 'warm-load runs after the default schedule dispatch');
  // …and NOT on the deep-link path (which returns via openJob before the restore/default block)
  const deepIdx = onLogin.indexOf('openJob(deepJobId)');
  ok(deepIdx >= 0 && deepIdx < iWarm, 'deep-link openJob path precedes (and bypasses) the warm-load');
  // (iv) the ONLY clock-recovery-related diff line is exactly this one added call (+ its comment); nothing removed
  const diff = execSync(`git -C ${REPO} diff ${BASE} -- trade.html`, { encoding: 'utf8' });
  const changed = diff.split('\n').filter(l => /^[+-][^+-]/.test(l));
  const removedRecovery = changed.filter(l => l[0] === '-' && /(checkServerClockRecovery|loadMyJobs|loadTimerState|clocked_on_at)/.test(l));
  eq(removedRecovery, [], 'no clock-recovery code line REMOVED by M2');
  const addedRecoveryCode = changed.filter(l => l[0] === '+' && /(checkServerClockRecovery|loadMyJobs|loadTimerState|clocked_on_at)/.test(l) && !/^\+\s*\/\//.test(l));
  eq(addedRecoveryCode, ["+      if (_currentView !== 'myJobs') loadMyJobs();"], 'the only added recovery code line is the restored warm-load');
});
test('5c renderNewCalendar cannot throw-and-block boot before recovery (guarded + async + not on the recovery path)', () => {
  const rn = HTML.slice(HTML.indexOf('async function renderNewCalendar()'), HTML.indexOf('async function renderNewCalendar()') + 1600);
  ok(/if \(!root\) return;/.test(rn), 'null-guarded on missing root');
  ok(/try \{[\s\S]*await caFetchCalendarModel/.test(rn), 'the only async fetch is wrapped in try/catch');
  ok(!/loadMyJobs|checkServerClockRecovery|loadTimerState/.test(rn), 'render path does not touch clock recovery at all');
});

// ── FINDING (resolved): M1's boot warm-load was lost in the squash; M2 restores it ──
try {
  const mainWarm = execSync(`git -C ${REPO} show ${BASE}:trade.html`, { encoding: 'utf8' }).includes('Restored M1 F1 fix') || execSync(`git -C ${REPO} show ${BASE}:trade.html`, { encoding: 'utf8' }).includes('Warm my_jobs');
  const wtWarm = HTML.includes("if (_currentView !== 'myJobs') loadMyJobs();");
  console.log(`\n  [FINDING — RESOLVED] origin/main carries a boot warm-load: ${mainWarm}; this M2 branch restores it: ${wtWarm}`);
  console.log('           The M1 F1 clock-recovery boot fix did NOT survive M1\'s squash-merge (absent from origin/main =');
  console.log('           a live pay-path gap: recovery deferred to first My-Jobs visit). M2 makes Calendar-first permanent,');
  console.log('           so per the contract amendment (§6, 2026-07-05) FIX 1 restores the one-line warm-load — proven above (5b).');
} catch (e) { /* git optional */ }

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed, ${deferred} deferred to CP4 live tier` + (failed ? `\nFailed: ${fails.join(', ')}` : '') + '\n');
process.exit(failed ? 1 : 0);
