// CP1 — Calendar data adapter fixture tests (trade-app-redesign · M2 U1)
// ---------------------------------------------------------------------------
// Single source of truth: this script READS ../../trade.html, extracts the code
// between `// <calendar-adapter-core>` and `// </calendar-adapter-core>`, and
// evaluates it to obtain the REAL CalAdapterCore functions. The adapter logic is
// never re-declared here — the assertions run against the shipped code, so the
// test can never drift from what ships.
//
// Run:  node cp1-adapter-tests.mjs
// Exit: non-zero if ANY fixture fails.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRADE_HTML = resolve(__dirname, '../../trade.html');

const OPEN = '// <calendar-adapter-core>';
const CLOSE = '// </calendar-adapter-core>';

function extractCore() {
  const html = readFileSync(TRADE_HTML, 'utf8');
  const a = html.indexOf(OPEN);
  const b = html.indexOf(CLOSE);
  if (a < 0 || b < 0 || b <= a) {
    throw new Error(`Could not find adapter-core sentinels in ${TRADE_HTML} (open=${a}, close=${b})`);
  }
  const core = html.slice(a + OPEN.length, b);
  // The block declares `var CalAdapterCore = (function(){...})();` — return it.
  // eslint-disable-next-line no-new-func
  return new Function(core + '\n;return CalAdapterCore;')();
}

const CA = extractCore();

// ── tiny assert harness ───────────────────────────────────────────────────
let passed = 0, failed = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n      expected ${e}\n      got      ${a}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ PASS  ${name}`); }
  catch (e) { failed++; fails.push(name); console.log(`  ✗ FAIL  ${name}\n      ${e.message}`); }
}

console.log('\nCP1 adapter fixtures — real functions extracted from trade.html\n');

// ── DA-1 · block duration ──────────────────────────────────────────────────
test('DA-1 make-safe with no real end → start + 1h (est)', () => {
  eq(CA.deriveBlock(8, null, 'makesafe'), { end: 9, est: true }, 'makesafe 8:00 → 9:00 est');
  eq(CA.deriveBlock(7.5, null, 'makesafe'), { end: 8.5, est: true }, 'makesafe 7:30 → 8:30 est');
});
test('DA-1 non-make-safe with no real end → start + 8h (est)', () => {
  eq(CA.deriveBlock(8, null, 'fencing'), { end: 16, est: true }, 'fencing 8:00 → 16:00 est');
  eq(CA.deriveBlock(7, null, 'patio'), { end: 15, est: true }, 'patio 7:00 → 15:00 est');
  eq(CA.deriveBlock(8, null, 'combo'), { end: 16, est: true }, 'legacy combo → 8h est');
});
test('DA-1 real end_time wins over the derived span (est=false)', () => {
  eq(CA.deriveBlock(8, '11:30', 'fencing'), { end: 11.5, est: false }, 'real end 11:30 wins');
  eq(CA.deriveBlock(8, '09:00', 'makesafe'), { end: 9, est: false }, 'real end wins for make-safe too');
  eq(CA.deriveBlock(8, '09:00:00', 'patio'), { end: 9, est: false }, 'HH:MM:SS parsed');
});
test('DA-1 invalid / non-advancing end falls back to derived span', () => {
  eq(CA.deriveBlock(8, '07:00', 'fencing'), { end: 16, est: true }, 'end <= start ignored → 8h');
  eq(CA.deriveBlock(8, 'garbage', 'makesafe'), { end: 9, est: true }, 'unparseable end ignored → 1h');
});
test('DA-1 no start_time → no block (end null, not est)', () => {
  eq(CA.deriveBlock(null, null, 'fencing'), { end: null, est: false }, 'unscheduled → null block');
});

// ── time parsing ───────────────────────────────────────────────────────────
test('parseTime "HH:MM[:SS]" → decimal hours; null when absent', () => {
  eq(CA.parseTime('07:30'), 7.5, '07:30 → 7.5');
  eq(CA.parseTime('13:00:00'), 13, '13:00:00 → 13');
  eq(CA.parseTime(null), null, 'null → null');
  eq(CA.parseTime(''), null, 'empty → null');
});

// ── DA-3 · type chip mapping (jobs.type) ───────────────────────────────────
test('DA-3 classifier types pass through; legacy/other → neutral', () => {
  eq(CA.mapType('makesafe'), 'makesafe', 'makesafe');
  eq(CA.mapType('fencing'), 'fencing', 'fencing');
  eq(CA.mapType('patio'), 'patio', 'patio');
  ['combo', 'decking', 'renovation', 'insurance', 'roofing', 'miscellaneous', 'general', '', null, 'weird'].forEach((t) => {
    eq(CA.mapType(t), 'other', `${JSON.stringify(t)} → other (neutral, All-lens only)`);
  });
  eq(CA.mapType('MAKESAFE'), 'makesafe', 'case-insensitive');
});
test('DA-3 isMakesafe strictly matches the classifier value', () => {
  ok(CA.isMakesafe('makesafe') === true, 'makesafe true');
  ok(CA.isMakesafe('fencing') === false, 'fencing false');
  ok(CA.isMakesafe('roofing') === false, 'roofing (a make-safe-ish word) still false — no fuzzy match');
});

// ── DA-6 · status token mapping ────────────────────────────────────────────
test('DA-6 every live assignment_status token maps explicitly', () => {
  const expected = {
    scheduled: 'booked', confirmed: 'booked', draft: 'booked',
    in_progress: 'onsite',
    complete: 'done', submitted: 'done', verified: 'done', disputed: 'done',
    cancelled: null
  };
  Object.keys(expected).forEach((tok) => {
    eq(CA.mapStatus(tok), expected[tok], `${tok} → ${JSON.stringify(expected[tok])}`);
  });
  eq(CA.mapStatus('IN_PROGRESS'), 'onsite', 'case-insensitive');
});
test('DA-6 unmapped/future token → null guard (never silent "booked")', () => {
  eq(CA.mapStatus('foobar'), null, 'unknown token → null, NOT booked');
  eq(CA.mapStatus('on_hold'), null, 'unknown token → null');
});
test('DA-6 adaptEvents records unmapped status tokens', () => {
  const res = CA.adaptEvents([
    { assignment_id: 'a1', job_id: 'j1', scheduled_date: '2026-07-06', start_time: '08:00', job_type: 'fencing', assignment_status: 'scheduled' },
    { assignment_id: 'a2', job_id: 'j2', scheduled_date: '2026-07-06', start_time: '08:00', job_type: 'patio', assignment_status: 'on_hold' }
  ]);
  eq(res.unmappedStatuses, ['on_hold'], 'on_hold surfaced for amendment');
  eq(res.blocks[1].status, null, 'the on_hold block carries null status (guarded)');
});

// ── DA-2 · deterministic crew colour ───────────────────────────────────────
test('DA-2 crew colour is deterministic and identity-stable', () => {
  eq(CA.crewColour('user-123'), CA.crewColour('user-123'), 'same key → same colour');
  ok(/^oklch\(0\.5 0\.065 \d+\)$/.test(CA.crewColour('user-123')), 'Briefing-compatible oklch band');
  ok(CA.crewHue('user-123') >= 0 && CA.crewHue('user-123') < 360, 'hue in [0,360)');
  ok(CA.crewColour('user-123') !== CA.crewColour('user-999'), 'different users generally differ');
});
test('DA-2 same user_id → same colour regardless of display name', () => {
  // colour keys off user_id, so "Deng" vs "Deng T" under one id stays one colour
  eq(CA.crewColour('uid-deng'), CA.crewColour('uid-deng'), 'stable across name change');
});

// ── desc sourcing ──────────────────────────────────────────────────────────
test('desc sourcing: label → scope_json summary → type fallback', () => {
  eq(CA.desc({ label: 'Fence + gate make-safe', job_type: 'makesafe' }, 'makesafe'),
    'Fence + gate make-safe', 'label wins');
  eq(CA.desc({ assignment_notes: 'Roof tarp', job_type: 'makesafe' }, 'makesafe'),
    'Roof tarp', 'assignment_notes serves as label source');
  eq(CA.desc({ scope_json: { config: { fence_type: 'Colorbond', length_m: 22 } }, job_type: 'fencing' }, 'fencing'),
    'Colorbond 22 m', 'scope_json summary when no label');
  eq(CA.desc({ job_type: 'patio' }, 'patio'), 'Patio', 'type-label fallback (never blank)');
  eq(CA.desc({ job_type: 'combo' }, 'other'), 'Job', 'neutral type → "Job" fallback');
});

// ── DA-4 · Mine/Everyone client filter ─────────────────────────────────────
test('DA-4 Everyone keeps all; Mine keeps the logged-in user (id then name)', () => {
  const blocks = [
    { id: 'b1', crew: 'Hugo', _userId: 'u-hugo' },
    { id: 'b2', crew: 'Deng', _userId: 'u-deng' },
    { id: 'b3', crew: 'Hugo', _userId: null }
  ];
  eq(CA.filterLens(blocks, 'everyone', { id: 'u-hugo', name: 'Hugo' }).map((b) => b.id),
    ['b1', 'b2', 'b3'], 'Everyone → all');
  eq(CA.filterLens(blocks, 'mine', { id: 'u-hugo', name: 'Hugo' }).map((b) => b.id),
    ['b1', 'b3'], 'Mine → id match (b1) + name fallback (b3)');
  eq(CA.filterLens(blocks, 'mine', { id: 'u-deng', name: 'Deng' }).map((b) => b.id),
    ['b2'], 'Mine → only Deng');
});

// ── eventToBlock end-to-end ────────────────────────────────────────────────
test('eventToBlock maps a full calendar_events row to the render model', () => {
  const ev = {
    assignment_id: 'as-1', job_id: 'job-1', user_id: 'u-deng', job_number: 'SWF-26808',
    client_name: 'G. Hart', site_suburb: 'Duncraig', site_address: '11 Selkirk Way',
    scheduled_date: '2026-07-06', start_time: '07:00', end_time: '09:00',
    crew_name: 'Deng', assigned_to: 'Deng', assignment_type: 'install',
    assignment_status: 'complete', job_type: 'fencing'
  };
  const b = CA.eventToBlock(ev);
  eq(b.id, 'as-1', 'id = assignment_id');
  eq(b.sub, 'Duncraig', 'sub = site_suburb');
  eq(b.ref, 'SWF-26808', 'ref = job_number');
  eq(b.type, 'fencing', 'type mapped');
  eq(b.crew, 'Deng', 'crew = assigned_to');
  eq(b.date, '2026-07-06', 'date = scheduled_date');
  eq(b.start, 7, 'start parsed');
  eq(b.end, 9, 'end = real end_time (est false)');
  eq(b._est, false, 'not estimated — real end present');
  eq(b.status, 'done', 'complete → done');
  eq(b.addr, '11 Selkirk Way, Duncraig', 'addr composed street + suburb');
  eq(b.desc, 'Fencing', 'desc = type label (no label/scope on feed)');
  eq(b._userId, 'u-deng', 'identity preserved for lens/colour');
});
test('eventToBlock derives the block when no real end (est=true)', () => {
  const b = CA.eventToBlock({
    assignment_id: 'as-2', job_id: 'job-2', job_number: 'MLB-26549', site_suburb: 'Dianella',
    scheduled_date: '2026-07-06', start_time: '07:30', crew_name: 'Jayden', assigned_to: 'Jayden',
    assignment_status: 'in_progress', job_type: 'makesafe'
  });
  eq(b.end, 8.5, 'make-safe 7:30 → 8:30 derived');
  eq(b._est, true, 'estimated flag set');
  eq(b.status, 'onsite', 'in_progress → onsite');
  eq(b.type, 'makesafe', 'make-safe type');
});
test('unassigned row (no crew, no time) → crew null, no block', () => {
  const b = CA.eventToBlock({
    assignment_id: 'as-3', job_id: 'job-3', job_number: 'SWF-26860', site_suburb: 'Yanchep',
    scheduled_date: '2026-07-06', assignment_status: 'scheduled', job_type: 'fencing'
  });
  eq(b.crew, null, 'crew null (unassigned)');
  eq(b.start, null, 'no start');
  eq(b.end, null, 'no end');
  eq(b.status, 'booked', 'scheduled → booked');
});

// ── multi-crew: per-assignment (crew axis) + dedupe (jobs axis) ─────────────
test('multi-crew: per-assignment rows are native (one block per assignment)', () => {
  const events = [
    { assignment_id: 'x1', job_id: 'J9', job_number: 'SWF-26840', site_suburb: 'Baldivis', scheduled_date: '2026-07-06', start_time: '08:00', end_time: '15:30', crew_name: 'Callum', assigned_to: 'Callum', user_id: 'u-cal', assignment_status: 'scheduled', job_type: 'fencing' },
    { assignment_id: 'x2', job_id: 'J9', job_number: 'SWF-26840', site_suburb: 'Baldivis', scheduled_date: '2026-07-06', start_time: '09:00', end_time: '14:00', crew_name: 'Deng', assigned_to: 'Deng', user_id: 'u-deng', assignment_status: 'in_progress', job_type: 'fencing' }
  ];
  const res = CA.adaptEvents(events);
  eq(res.blocks.length, 2, 'crew-axis: two per-assignment blocks');
  eq(res.blocks.map((b) => b.crew), ['Callum', 'Deng'], 'each block keeps its own crew');
});
test('multi-crew: jobs-axis dedupe by job+date joins crew, spans time, keeps status precedence', () => {
  const events = [
    { assignment_id: 'x1', job_id: 'J9', job_number: 'SWF-26840', site_suburb: 'Baldivis', scheduled_date: '2026-07-06', start_time: '08:00', end_time: '15:30', crew_name: 'Callum', assigned_to: 'Callum', user_id: 'u-cal', assignment_status: 'scheduled', job_type: 'fencing' },
    { assignment_id: 'x2', job_id: 'J9', job_number: 'SWF-26840', site_suburb: 'Baldivis', scheduled_date: '2026-07-06', start_time: '09:00', end_time: '14:00', crew_name: 'Deng', assigned_to: 'Deng', user_id: 'u-deng', assignment_status: 'in_progress', job_type: 'fencing' }
  ];
  const rows = CA.dedupeByJobDate(CA.adaptEvents(events).blocks);
  eq(rows.length, 1, 'jobs-axis: one row for the job+date');
  eq(rows[0].crew, 'Callum + Deng', 'crew names joined');
  eq(rows[0].crewList, ['Callum', 'Deng'], 'crewList preserved');
  eq(rows[0].start, 8, 'earliest start across crew');
  eq(rows[0].end, 15.5, 'latest end across crew');
  eq(rows[0].status, 'onsite', 'any on-site → onsite');
  eq(rows[0]._assignmentIds.length, 2, 'both assignment ids reconciled into the row');
});
test('jobs-axis status precedence: all done → done, mixed → booked', () => {
  const mk = (id, st) => ({ assignment_id: id, job_id: 'JD', job_number: 'R1', scheduled_date: '2026-07-06', start_time: '08:00', crew_name: 'A', assigned_to: 'A', assignment_status: st, job_type: 'patio' });
  eq(CA.dedupeByJobDate(CA.adaptEvents([mk('a', 'complete'), mk('b', 'verified')]).blocks)[0].status, 'done', 'all done → done');
  eq(CA.dedupeByJobDate(CA.adaptEvents([mk('a', 'complete'), mk('b', 'scheduled')]).blocks)[0].status, 'booked', 'mixed (no onsite, not all done) → booked');
});

// ── reconciliation: no dropped assignments ─────────────────────────────────
test('no dropped assignments — input row count reconciles to output', () => {
  const events = Array.from({ length: 17 }, (_, i) => ({
    assignment_id: 'a' + i, job_id: 'j' + (i % 5), job_number: 'REF-' + (i % 5),
    scheduled_date: '2026-07-0' + ((i % 6) + 1), start_time: '08:00',
    crew_name: 'C' + (i % 3), assigned_to: 'C' + (i % 3), assignment_status: 'scheduled', job_type: 'fencing'
  }));
  const res = CA.adaptEvents(events);
  eq(res.inputCount, 17, 'input counted');
  eq(res.outputCount, 17, 'output 1:1 with input (no drops)');
  eq(res.blocks.length, 17, 'block per assignment');
  const rows = CA.dedupeByJobDate(res.blocks);
  const reconciled = rows.reduce((n, r) => n + r._assignmentIds.length, 0);
  eq(reconciled, 17, 'every assignment id reconciled through the jobs-axis dedupe');
});

// ── buildPeople ────────────────────────────────────────────────────────────
test('buildPeople merges roster + block crews with stable colours', () => {
  const roster = [{ id: 'u-hugo', name: 'Hugo', role: 'lead_installer' }, { id: 'u-deng', name: 'Deng', role: 'crew' }];
  const blocks = [{ crew: 'Marco', _crewKey: 'u-marco' }, { crew: 'Hugo', _crewKey: 'u-hugo' }, { crew: null }];
  const people = CA.buildPeople(roster, blocks);
  const names = people.map((p) => p.name).sort();
  eq(names, ['Deng', 'Hugo', 'Marco'], 'roster ∪ block crews, no dupes, no null crew');
  const hugo = people.find((p) => p.name === 'Hugo');
  eq(hugo.av, CA.crewColour('u-hugo'), 'colour derives from stable key');
  eq(hugo.initials, 'HU', 'initials');
});

// ── summary ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed` + (failed ? `\nFailed: ${fails.join(', ')}` : '') + '\n');
process.exit(failed ? 1 : 0);
