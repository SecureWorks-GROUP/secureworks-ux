// U2/U3 render verification (trade-app-redesign · M2) — Deckhand B's own proof.
// ---------------------------------------------------------------------------
// Extracts BOTH sentinel blocks from ../../trade.html (the U1 adapter core AND
// the U2 CalRender renderers), adapts the captured live-week fixture into the
// render model, and drives every scale×axis + Run Sheet state — asserting each
// renders, null-start rows land in a "No time set" section (not vanish),
// type:'other' survives the neutral entry, counts reconcile, and the U3
// unassigned-strip predicate matrix holds. No login, no network, no DOM.
//
// This is supporting evidence; Verifier V authors the official smoke/cp2-smoke.mjs.
// Run:  node u2u3-render-verify.mjs   (exit non-zero on any failure)
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRADE_HTML = resolve(__dirname, '../../trade.html');
const FIXTURE = resolve(__dirname, 'fixtures/live-week-2026-07-06.json');

function slice(html, open, close) {
  const a = html.indexOf(open), b = html.indexOf(close);
  if (a < 0 || b < 0 || b <= a) throw new Error(`sentinels not found: ${open} / ${close}`);
  return html.slice(a + open.length, b);
}
const html = readFileSync(TRADE_HTML, 'utf8');
const adapterSrc = slice(html, '// <calendar-adapter-core>', '// </calendar-adapter-core>');
const rendererSrc = slice(html, '// <calendar-renderers>', '// </calendar-renderers>');
// eslint-disable-next-line no-new-func
const { CalAdapterCore: CA, CalRender: CR } = new Function(
  adapterSrc + '\n' + rendererSrc + '\n; return { CalAdapterCore: CalAdapterCore, CalRender: CalRender };'
)();

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const rawEvents = fixture.events;

// ── assert harness ─────────────────────────────────────────────────────────
let passed = 0, failed = 0; const fails = [];
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
function test(name, fn) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; fails.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); } }
function clean(s) { ok(typeof s === 'string' && s.length > 0, 'render returned empty'); ok(s.indexOf('undefined') < 0, 'output contains "undefined"'); ok(s.indexOf('NaN') < 0, 'output contains "NaN"'); return s; }
function count(s, re) { return (s.match(re) || []).length; }

// ── build the model from the fixture (mirrors the wiring) ────────────────────
const adapted = CA.adaptEvents(rawEvents);
const jobBlocks = adapted.blocks.filter((b) => b._jobId); // drop 8 org/meeting rows
const people = CA.buildPeople([], jobBlocks);
const M = { blocks: jobBlocks, people, today: '2026-07-06', now: 11.25 };
const MGR = { type: 'all', scope: 'everyone', me: { id: null, name: null }, boardAllowed: true, lens: 'manager' };
function st(over) { return Object.assign({ calView: 'cal', scale: 'day', axis: 'crew' }, MGR, over); }

console.log('\nU2/U3 render verification — real renderers + captured live week\n');

test('fixture adapts: 50 raw → 42 job blocks (8 org/meeting filtered)', () => {
  eq(adapted.blocks.length, 50, 'all rows adapted');
  eq(jobBlocks.length, 42, 'job blocks after _jobId filter');
  ok(people.length > 0, 'people derived from block crews');
});

// every scale×axis + Run Sheet renders on live data
const STATES = [
  ['Day × Crew (timeline)', { calView: 'cal', scale: 'day', axis: 'crew' }],
  ['Day × Jobs', { calView: 'cal', scale: 'day', axis: 'jobs' }],
  ['Week × Crew (load grid)', { calView: 'cal', scale: 'week', axis: 'crew' }],
  ['Week × Jobs', { calView: 'cal', scale: 'week', axis: 'jobs' }],
  ['Month × Crew (board)', { calView: 'cal', scale: 'month', axis: 'crew' }],
  ['Month × Jobs (inline)', { calView: 'cal', scale: 'month', axis: 'jobs' }],
  ['Run Sheet', { calView: 'run', scale: 'day', axis: 'crew' }]
];
STATES.forEach(([label, over]) => {
  test(`${label} renders non-empty & clean`, () => { clean(CR.render(M, st(Object.assign({ date: '2026-07-06', month: '2026-07-01' }, over)))); });
});

test('CP1 finding — crewed-but-untimed jobs land in a "No time set" section (not vanish)', () => {
  // find a date in the fixture with untimed crewed jobs
  const s = st({ date: '2026-07-06', month: '2026-07-01' });
  const untimed = CR.untimedForDate ? CR.untimedForDate(M, s, '2026-07-06') : jobBlocks.filter((b) => b.date === '2026-07-06' && b.crew && b.start == null);
  ok(untimed.length > 0, 'fixture has crewed-untimed jobs on 2026-07-06');
  const dayCrew = CR.render(M, st({ date: '2026-07-06', scale: 'day', axis: 'crew' }));
  ok(dayCrew.indexOf('No time set') >= 0, 'Day×Crew shows the No-time-set section');
  ok(dayCrew.indexOf('data-job="' + untimed[0].id + '"') >= 0, 'the untimed job actually renders a row');
  const dayJobs = CR.render(M, st({ date: '2026-07-06', scale: 'day', axis: 'jobs' }));
  ok(dayJobs.indexOf('No time set') >= 0, 'Day×Jobs shows the No-time-set section too');
});

test('CP1 finding — reconcile: every crewed job for a day renders (timed grid + untimed section)', () => {
  const s = st({ date: '2026-07-06', scale: 'day', axis: 'jobs' });
  const assigned = jobBlocks.filter((b) => b.date === '2026-07-06' && b.crew);
  const outIds = new Set((CR.render(M, s).match(/data-job="([^"]+)"/g) || []).map((m) => m.slice(10, -1)));
  const missing = assigned.filter((b) => !outIds.has(b.id));
  eq(missing.length, 0, 'no crewed job dropped from Day×Jobs (all ' + assigned.length + ' render)');
});

test('type:"other" survives — neutral block, never crashes', () => {
  const evt = { assignment_id: 'ot1', job_id: 'jX', job_number: 'GEN-1', site_suburb: 'Midland', scheduled_date: '2026-07-06', start_time: '08:00', crew_name: 'Deng', assigned_to: 'Deng', assignment_status: 'scheduled', job_type: 'combo' };
  const blk = CA.eventToBlock(evt);
  eq(blk.type, 'other', 'combo → other');
  const m2 = { blocks: [blk], people: CA.buildPeople([], [blk]), today: '2026-07-06', now: 11.25 };
  const out = clean(CR.render(m2, st({ date: '2026-07-06', scale: 'day', axis: 'crew' })));
  ok(out.indexOf('blk nt') >= 0, 'neutral block uses the nt class');
  // and it only appears under the All lens (not under a specific chip)
  const underFencing = CR.render(m2, st({ date: '2026-07-06', scale: 'day', axis: 'crew', type: 'fencing' }));
  ok(underFencing.indexOf('data-job="ot1"') < 0, 'type:other hidden under a specific trade chip (All-only)');
});

test('chrome — day scale shows rail; week/month cal show period bar; badge counts filters', () => {
  const day = CR.chrome(M, st({ date: '2026-07-06', scale: 'day' }));
  ok(day.railVisible === true, 'rail visible on day');
  ok(day.periodbarHidden === true, 'no period bar on day');
  const week = CR.chrome(M, st({ date: '2026-07-06', scale: 'week' }));
  ok(week.periodbarHidden === false, 'period bar on week');
  ok(week.periodLabel && week.periodLabel.length > 0, 'week has a label');
  const run = CR.chrome(M, st({ calView: 'run', date: '2026-07-06' }));
  ok(run.railVisible === true, 'rail visible in Run Sheet');
  const filtered = CR.chrome(M, st({ date: '2026-07-06', scale: 'day', type: 'fencing', scope: 'mine' }));
  eq(filtered.badgeCount, 2, 'badge counts a trade chip + non-default scope');
});

// ── U3 unassigned-strip predicate matrix (synthetic, deterministic) ──────────
const unBlock = { id: 'u1', sub: 'Yanchep', ref: 'SWF-1', type: 'fencing', crew: null, date: '2026-07-06', start: null, end: null, status: 'booked', addr: '3 Salt Ct, Yanchep', desc: 'Fencing', _est: false, _crewKey: null, _userId: null, _jobId: 'jU' };
const crewBlock = { id: 'c1', sub: 'Baldivis', ref: 'SWF-2', type: 'fencing', crew: 'Callum', date: '2026-07-06', start: 8, end: 16, status: 'booked', addr: 'x', desc: 'Fencing', _est: true, _crewKey: 'Callum', _userId: 'u-cal', _jobId: 'jC' };
const MU = { blocks: [unBlock, crewBlock], people: CA.buildPeople([], [crewBlock]), today: '2026-07-06', now: 11.25 };
function strip(over) { return CR.chrome(MU, st(Object.assign({ date: '2026-07-06', month: '2026-07-01' }, over))).unstrip.visible; }

test('U3 strip — VISIBLE for manager + Everyone + Day', () => { ok(strip({ scale: 'day' }) === true, 'should show'); });
test('U3 strip — VISIBLE for manager + Everyone + Week', () => { ok(strip({ scale: 'week' }) === true, 'should show'); });
test('U3 strip — HIDDEN on Month scale', () => { ok(strip({ scale: 'month' }) === false, 'month hides strip'); });
test('U3 strip — HIDDEN under Mine lens', () => { ok(strip({ scale: 'day', scope: 'mine' }) === false, 'mine hides strip'); });
test('U3 strip — HIDDEN for non-manager (board predicate false)', () => {
  const vis = CR.chrome(MU, st({ date: '2026-07-06', scale: 'day', boardAllowed: false, scope: 'everyone' })).unstrip.visible;
  ok(vis === false, 'non-manager never sees the strip');
});
test('U3 strip — Run Sheet (day-based) shows it for manager+Everyone', () => { ok(CR.chrome(MU, st({ calView: 'run', date: '2026-07-06' })).unstrip.visible === true, 'run shows strip'); });

// ── summary ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed` + (failed ? `\nFailed: ${fails.join(', ')}` : '') + '\n');
process.exit(failed ? 1 : 0);
