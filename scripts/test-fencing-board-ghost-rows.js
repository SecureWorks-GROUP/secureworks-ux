#!/usr/bin/env node
'use strict';

// Regression: the Trade App fencing Board showed a STALE schedule date after a
// job was rescheduled on the Ops Dash calendar (captain-reported 2026-08-04).
//
// Cause. Ops staff are mirrored onto a job as a ghost `role:'observer'`
// assignment row so the job appears in their own list. That row is never moved
// when the crew's real assignment is rescheduled. Both calendar surfaces read
// the `calendar_events` view, defined `WHERE is_ghost = false`, so neither ever
// sees it. The Board is the one surface reading `my_jobs`, which selects
// `job_assignments` raw with only `.neq('status','cancelled')` — so both rows
// arrive, both carry `status:'scheduled'`, and FencingBoardCore's one-card-per-job
// dedupe (`priority()`) TIED between them. A tie keeps the row seen first, and
// the feed orders by `scheduled_date` ascending, so the stale earlier ghost date
// deterministically won.
//
// The fixture below is the live 2026-08-04 assignment data for the three jobs in
// the captain's screenshots (job identity + schedule facts only; no client name,
// phone or street). It keeps the server's ghost-first row order, which is the
// condition that produced the bug — reordering it would hide a regression.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');

function block(open, close) {
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  assert(start >= 0 && end > start, `missing ${open}`);
  return html.slice(start + open.length, end);
}

const context = { console, window: {} };
vm.createContext(context);
vm.runInContext(block('// <fencing-board-core>', '// </fencing-board-core>'), context);
const fencing = context.FencingBoardCore;

const ORG = 'org-secureworks';
const OPS_MANAGER = { id: 'user-shaun', name: 'Shaun' };   // is_ghost row owner
const LEAD = { id: 'user-henry', name: 'Henry' };          // the real crew

function job(id, number, suburb) {
  return { id, job_number: number, type: 'fencing', status: 'scheduled', site_suburb: suburb, org_id: ORG };
}
// The ghost/observer row. `is_ghost` is NOT in the my_jobs payload; `role` is,
// and on every live row the two agree.
function observerRow(id, jobRef, date) {
  return {
    id, role: 'observer', status: 'scheduled', assignment_type: 'install',
    scheduled_date: date, scheduled_end: null, start_time: null,
    crew_name: null, user: OPS_MANAGER, org_id: ORG, jobs: jobRef
  };
}
// The real crew row — the one the Ops Dash calendar draws and the drag moves.
function crewRow(id, jobRef, date, end) {
  return {
    id, role: 'lead_installer', status: 'scheduled', assignment_type: 'install',
    scheduled_date: date, scheduled_end: end || date, start_time: null,
    crew_name: LEAD.name, user: LEAD, org_id: ORG, jobs: jobRef
  };
}

const CORRINE = job('job-26813', 'SWF-26813', 'Hocking');
const HAYLEY = job('job-261042', 'SWF-261042', 'Leeming');
const SUE = job('job-26972', 'SWF-26972', 'Iluka');

// What `calendar_events` (is_ghost = false) publishes for each job — i.e. what
// BOTH calendars draw. This is the agreement target the Board must match.
const CALENDAR_TRUTH = {
  'job-26813': '2026-08-06',   // dragged Wed 5 Aug -> Thu 6 Aug
  'job-261042': '2026-08-11',  // moved out to Tue 11 Aug
  'job-26972': '2026-08-07'    // never moved: the agreeing card in the screenshots
};

// my_jobs buckets as the server groups them relative to 2026-08-04, each bucket
// ordered by scheduled_date ascending — so every stale ghost precedes its crew row.
const feed = {
  today: [],
  thisWeek: [
    observerRow('a-ghost-corrine', CORRINE, '2026-08-05'),
    crewRow('a-crew-corrine', CORRINE, '2026-08-06'),
    observerRow('a-ghost-hayley', HAYLEY, '2026-08-07'),
    observerRow('a-ghost-sue', SUE, '2026-08-07'),
    crewRow('a-crew-sue', SUE, '2026-08-07')
  ],
  upcoming: [crewRow('a-crew-hayley', HAYLEY, '2026-08-11', '2026-08-12')],
  recent: [],
  unscheduled: [],
  makesafePool: []
};

// Guard the fixture itself: if these ever stop being same-status ties in
// ghost-first order, the test no longer reproduces the reported bug.
const corrineRows = feed.thisWeek.filter((r) => r.jobs.id === CORRINE.id);
assert.strictEqual(corrineRows[0].role, 'observer', 'fixture must keep the stale ghost row first');
assert.strictEqual(corrineRows[0].status, corrineRows[1].status,
  'fixture must keep both rows on the same status so the dedupe genuinely ties');
assert(corrineRows[0].scheduled_date < corrineRows[1].scheduled_date,
  'fixture must keep the ghost date earlier than the rescheduled crew date');

// ── The predicate ──
assert.strictEqual(fencing.isObserverRow({ role: 'observer' }), true);
assert.strictEqual(fencing.isObserverRow({ role: 'Observer' }), true, 'role match is case-insensitive');
assert.strictEqual(fencing.isObserverRow({ role: 'lead_installer' }), false);
assert.strictEqual(fencing.isObserverRow({ role: 'helper' }), false);
assert.strictEqual(fencing.isObserverRow({ role: 'crew' }), false);
assert.strictEqual(fencing.isObserverRow({}), false, 'a row with no role is real work');
assert.strictEqual(fencing.isObserverRow(null), false);

// ── The board ──
const crewSeenByJob = {};
function makeCard(jobRow, row, crewAssignments) {
  // Array.from: crewAssignments is built inside the vm realm, so its prototype
  // is not this realm's Array and deepStrictEqual would reject an equal list.
  crewSeenByJob[jobRow.id] = Array.from(crewAssignments || []).map((a) => (a.user || {}).name || a.crew_name);
  return { job: jobRow, row, _boardRow: row };
}
const board = fencing.buildBoard(feed, makeCard, ORG);
const vertical = board.verticals[0];

// The week anchor the captain was looking at. Asserted so the dates below stay honest.
const thisWeek = fencing.weekStart('2026-08-04');
assert.strictEqual(thisWeek, '2026-08-03', 'the reported week starts Mon 3 Aug 2026');
const nextWeek = fencing.addDays(thisWeek, 7);
assert.strictEqual(nextWeek, '2026-08-10');

function cardsOf(selection) {
  return selection.columns.reduce((all, column) => all.concat(column.cards), []);
}
function dateFor(selection, jobId) {
  const card = cardsOf(selection).filter((c) => c.job.id === jobId)[0];
  return card ? card._boardRow.scheduled_date : null;
}

const week1 = fencing.forSelection(vertical, thisWeek, false);
const week2 = fencing.forSelection(vertical, nextWeek, false);

// Evidence table, printed before the assertions so a failing run still shows what
// each surface read. Reverting the intake filter reproduces the captain's
// screenshots exactly: SWF-26813 reads 2026-08-05, SWF-261042 reads 2026-08-07.
[CORRINE, HAYLEY, SUE].forEach((j) => {
  console.log(`  ${j.job_number.padEnd(11)} calendar=${CALENDAR_TRUTH[j.id]}` +
    `  board[wk ${thisWeek}]=${dateFor(week1, j.id) || '-'}` +
    `  board[wk ${nextWeek}]=${dateFor(week2, j.id) || '-'}`);
});

// THE DEFECT: Corrine was dragged Wed -> Thu. The Board must read the calendar's
// Thursday, not the observer row's stale Wednesday.
assert.strictEqual(dateFor(week1, CORRINE.id), CALENDAR_TRUTH['job-26813'],
  'a drag-rescheduled job reads the crew row date, not the stale observer date');
assert.notStrictEqual(dateFor(week1, CORRINE.id), '2026-08-05', 'the stale ghost date never wins the tie');

// THE DEFECT, second shape: Hayley moved into the FOLLOWING week. The observer
// row left behind must not hold her card in this week reading "Fri 7 Aug".
assert.strictEqual(dateFor(week1, HAYLEY.id), null,
  'a job rescheduled out of the week leaves no observer-row ghost card behind');
assert.strictEqual(dateFor(week2, HAYLEY.id), CALENDAR_TRUTH['job-261042'],
  'the job appears in the week the calendar actually put it in');

// THE PROVEN PATH: Sue Croft agreed on both surfaces before the fix and must be
// untouched by it.
assert.strictEqual(dateFor(week1, SUE.id), CALENDAR_TRUTH['job-26972'],
  'the already-agreeing card keeps its date');

// Whole-board agreement with what the calendars draw.
cardsOf(week1).concat(cardsOf(week2)).forEach((card) => {
  assert.strictEqual(card._boardRow.scheduled_date, CALENDAR_TRUTH[card.job.id],
    `${card.job.job_number}: board card date must equal the calendar_events date`);
  assert.notStrictEqual(card._boardRow.role, 'observer',
    `${card.job.job_number}: an observer row must never become the card's row`);
});

assert.strictEqual(board.observerRowsDropped, 3, 'every observer row is reported, never silently dropped');
assert.strictEqual(board.assignedCount, 3, 'one representative crew row survives per job');

// An observer is a watcher, so they are not crew and cannot be the target of a
// Board write.
Object.keys(crewSeenByJob).forEach((jobId) => {
  assert.deepStrictEqual(crewSeenByJob[jobId], [LEAD.name],
    'the ops-manager observer is never listed as crew on the card');
});
assert.strictEqual(fencing.canAllocate(observerRow('x', CORRINE, '2026-08-05')), true,
  'canAllocate is unchanged for a scheduled row — intake filtering, not authority, is what fixes this');

// Unscheduled and pool behaviour is untouched.
const poolFeed = {
  today: [], thisWeek: [], upcoming: [], recent: [], makesafePool: [],
  unscheduled: [{
    id: 'a-pool', status: 'available', assignment_type: 'fencing_open',
    scheduled_date: '2026-08-04', org_id: ORG, jobs: job('job-pool', 'SWF-POOL', 'Balga')
  }]
};
const poolBoard = fencing.buildBoard(poolFeed, makeCard, ORG);
assert.strictEqual(poolBoard.poolCount, 1, 'open-pool rows still reach the board');
assert.strictEqual(poolBoard.observerRowsDropped, 0);
const poolSel = fencing.forSelection(poolBoard.verticals[0], thisWeek, true);
assert.strictEqual(cardsOf(poolSel).length, 1, 'Unscheduled still carries open-pool work');

console.log('fencing board ghost-row (stale schedule date) tests passed');
