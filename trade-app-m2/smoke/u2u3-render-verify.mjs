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

const idToJob = new Map(jobBlocks.map((b) => [b.id, b._jobId]));
function renderedIds(out) { return (out.match(/data-job="([^"]+)"/g) || []).map((m) => m.slice(10, -1)); }
// a date with a genuine multi-crew job+date (drives the dedupe assertions)
function multiCrewDate() {
  const byKey = {};
  jobBlocks.forEach((b) => { if (b.crew) { const k = b._jobId + '|' + b.date; (byKey[k] ||= new Set()).add(b.crew); } });
  const k = Object.keys(byKey).find((k) => byKey[k].size > 1);
  return k ? k.split('|')[1] : '2026-07-06';
}

test('FIX2 — jobs-axis dedupes by job+date (no job dropped, no duplicate blocks)', () => {
  const d = '2026-07-06';
  const s = st({ date: d, scale: 'day', axis: 'jobs' });
  const assigned = jobBlocks.filter((b) => b.date === d && b.crew);
  const uniqueJobs = new Set(assigned.map((b) => b._jobId));
  const ids = renderedIds(CR.render(M, s));
  const renderedJobs = new Set(ids.map((id) => idToJob.get(id)));
  eq([...uniqueJobs].filter((j) => !renderedJobs.has(j)).length, 0, 'every job renders (none dropped)');
  eq(ids.length, uniqueJobs.size, 'one block/row per job+date (deduped): ' + ids.length + ' rendered == ' + uniqueJobs.size + ' unique jobs (from ' + assigned.length + ' assignments)');
});

test('FIX2 — a genuine multi-crew job renders ONCE with a crew-count disc (Day×Jobs)', () => {
  const d = multiCrewDate();
  const byKey = {};
  jobBlocks.forEach((b) => { if (b.crew && b.date === d) { (byKey[b._jobId] ||= new Set()).add(b.crew); } });
  const jobId = Object.keys(byKey).find((j) => byKey[j].size > 1);
  ok(jobId, 'found a multi-crew job on ' + d);
  const assignmentsForJob = jobBlocks.filter((b) => b._jobId === jobId && b.date === d && b.crew);
  ok(assignmentsForJob.length > 1, jobId + ' has ' + assignmentsForJob.length + ' crew');
  const out = CR.render(M, st({ date: d, scale: 'day', axis: 'jobs' }));
  const ids = renderedIds(out).filter((id) => idToJob.get(id) === jobId);
  eq(ids.length, 1, 'the multi-crew job renders exactly once (was ' + assignmentsForJob.length + ' assignments)');
  // count disc: crewDisc renders the crew count for a deduped multi-crew block
  ok(out.indexOf('class="av" title=') >= 0, 'multi-crew card shows a count disc (av with title)');
});

test('FIX2 — dedupeByJobDate is live (not dead code): join produces "A + B" crew', () => {
  const d = multiCrewDate();
  const rows = CA.dedupeByJobDate(jobBlocks.filter((b) => b.date === d && b.crew));
  const joined = rows.find((r) => r.crewList && r.crewList.length > 1);
  ok(joined, 'a deduped row has >1 crew');
  ok(joined.crew.indexOf(' + ') >= 0, 'crew names joined with " + " (' + joined.crew + ')');
});

test('FIX2 consistency — Month×Jobs day-list also dedupes by job+date', () => {
  const d = multiCrewDate();
  const byKey = {};
  jobBlocks.forEach((b) => { if (b.crew && b.date === d) { (byKey[b._jobId] ||= new Set()).add(b.crew); } });
  const jobId = Object.keys(byKey).find((j) => byKey[j].size > 1);
  ok(jobId, 'multi-crew job on ' + d);
  const out = CR.render(M, st({ date: d, month: d.slice(0, 8) + '01', scale: 'month', axis: 'jobs' }));
  const ids = renderedIds(out).filter((id) => idToJob.get(id) === jobId);
  eq(ids.length, 1, 'Month×Jobs day-list shows the multi-crew job once (day-list agenda rows)');
});

test('crew-axis UNCHANGED — Timeline still renders per-assignment (job on each crew column)', () => {
  const d = multiCrewDate();
  const byKey = {};
  jobBlocks.forEach((b) => { if (b.crew && b.date === d) { (byKey[b._jobId] ||= []).push(b); } });
  const jobId = Object.keys(byKey).find((j) => byKey[j].length > 1);
  const out = CR.render(M, st({ date: d, scale: 'day', axis: 'crew' })); // Timeline
  const ids = renderedIds(out).filter((id) => idToJob.get(id) === jobId);
  ok(ids.length >= 2, 'crew-axis Timeline keeps one block per assignment (' + ids.length + ' for the multi-crew job) — not deduped');
});

test('CP3 partyLabel — make-safe→Builder(pending, never homeowner); fence/patio→Client', () => {
  eq(CA.eventToBlock({ job_id: 'j', client_name: 'G. Hart', job_type: 'fencing', scheduled_date: '2026-07-06' }).client, 'G. Hart', 'client mapped from client_name');
  eq(CR.partyLabel({ type: 'makesafe', client: 'MLB Group' }), { k: 'Builder', v: '—' }, 'make-safe never shows the homeowner as builder');
  eq(CR.partyLabel({ type: 'makesafe', builder: 'Builderwest' }), { k: 'Builder', v: 'Builderwest' }, 'future builder field picked up with no renderer change');
  eq(CR.partyLabel({ type: 'fencing', client: 'G. Hart' }), { k: 'Client', v: 'G. Hart' }, 'fence shows the client');
  eq(CR.partyLabel({ type: 'patio', client: '' }), { k: 'Client', v: '—' }, 'missing client → dash');
});

test('CP3 enriched card — shows suburb, type, ref, party, time, trade (readable at a glance)', () => {
  const fc = jobBlocks.find((b) => b.type === 'fencing' && b.client && b.crew && b.start != null)
    || jobBlocks.find((b) => b.type === 'fencing' && b.crew);
  ok(fc, 'a fencing job exists');
  const card = CR.jcard(M, fc);
  ok(card.indexOf('nc-c-sub') >= 0 && card.indexOf(fc.sub) >= 0, 'suburb');
  ok(card.indexOf('nc-c-type') >= 0 && card.indexOf('Fencing') >= 0, 'type label');
  ok(card.indexOf('nc-c-ref') >= 0 && card.indexOf(fc.ref) >= 0, 'job number');
  ok(card.indexOf('nc-c-party') >= 0 && card.indexOf('Client') >= 0, 'client party line');
  ok(card.indexOf('nc-c-time') >= 0, 'time');
  ok(card.indexOf('nc-c-trade') >= 0, 'assigned trade');
  ok(card.indexOf('data-job="' + fc.id + '"') >= 0, 'tappable (data-job preserved)');
  const ms = jobBlocks.find((b) => b.type === 'makesafe' && b.crew);
  if (ms) ok(CR.jcard(M, ms).indexOf('Builder') >= 0, 'make-safe card shows Builder label (placeholder until backend field)');
});

test('CP3 grid density — day×crew renders every job as a card (no hidden overlaps)', () => {
  // pick a crew with multiple timed jobs on a day; all must appear as cards
  const d = '2026-07-06';
  const s = st({ date: d, scale: 'day', axis: 'crew' });
  const byCrew = {};
  jobBlocks.forEach((b) => { if (b.crew && b.date === d && b.start != null) (byCrew[b.crew] ||= []).push(b); });
  const busy = Object.keys(byCrew).sort((a, b) => byCrew[b].length - byCrew[a].length)[0];
  const out = CR.render(M, s);
  const shown = byCrew[busy].filter((b) => out.indexOf('data-job="' + b.id + '"') >= 0).length;
  eq(shown, byCrew[busy].length, busy + "'s " + byCrew[busy].length + ' timed jobs all render as cards (none swallowed by an overlapping bar)');
});

test('type:"other" survives — neutral block, never crashes', () => {
  const evt = { assignment_id: 'ot1', job_id: 'jX', job_number: 'GEN-1', site_suburb: 'Midland', scheduled_date: '2026-07-06', start_time: '08:00', crew_name: 'Deng', assigned_to: 'Deng', assignment_status: 'scheduled', job_type: 'combo' };
  const blk = CA.eventToBlock(evt);
  eq(blk.type, 'other', 'combo → other');
  const m2 = { blocks: [blk], people: CA.buildPeople([], [blk]), today: '2026-07-06', now: 11.25 };
  const out = clean(CR.render(m2, st({ date: '2026-07-06', scale: 'day', axis: 'crew' })));
  ok(out.indexOf('ncard nt') >= 0, 'neutral card uses the nt class');
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
