// Crew roster + lead installer — pure core.
//
// Extracts the sentinel-delimited TradeCrewCore straight out of the shipped
// trade.html and asserts against the REAL functions, so renaming or moving the
// sentinels breaks CI rather than silently testing a copy.
//
// What this proves that a rendering test cannot: the two absences stay
// distinct (leadInstaller null == "nobody leads this", key missing == "this
// server has no opinion"), `role` is never read as the lead signal, one person
// holding several day-rows is ONE crew member, and the client's set-lead
// authority mirrors the server's assertAssignmentMutationAuthz gate.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const trade = fs.readFileSync(path.join(root, 'trade.html'), 'utf8');

function extractBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('start marker not found: ' + startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error('end marker not found: ' + endMarker);
  return src.slice(start, end);
}

const source = extractBetween(trade, '// <trade-crew-roster-core>', '// </trade-crew-roster-core>');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(source + '\nthis.TradeCrewCore = TradeCrewCore;', ctx);
const Core = ctx.TradeCrewCore;

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('  ok  ' + name);
}

// A production-shaped payload: Alyx holds two day-rows on one job, `role` is
// the useless 'lead_installer' default on every row, and Sam is the designated
// lead on his single row.
function payload(overrides) {
  return Object.assign({
    job: { id: 'job-1', type: 'fencing' },
    crew: [
      { id: 'a1', user_id: 'u-alyx', name: 'Alyx Crew', role: 'lead_installer', is_lead: false, scheduled_date: '2026-08-04' },
      { id: 'a2', user_id: 'u-alyx', name: 'Alyx Crew', role: 'lead_installer', is_lead: false, scheduled_date: '2026-08-05' },
      { id: 'a3', user_id: 'u-sam', name: 'Sam Offsider', role: 'lead_installer', is_lead: true, scheduled_date: '2026-08-04' }
    ],
    leadInstaller: { assignment_id: 'a3', user_id: 'u-sam', name: 'Sam Offsider' }
  }, overrides || {});
}

check('one person with several day-rows is ONE crew member', () => {
  const model = Core.build(payload());
  assert.strictEqual(model.members.length, 2, 'expected 2 people, not 3 assignment rows');
  const alyx = model.members.find((m) => m.userId === 'u-alyx');
  // join(): the module runs in a vm realm, so its arrays are not
  // reference-comparable with this file's Array prototype.
  assert.strictEqual(alyx.days.join(','), '2026-08-04,2026-08-05');
});

check('the designated lead reads first and is the only one flagged', () => {
  const model = Core.build(payload());
  assert.strictEqual(model.members[0].name, 'Sam Offsider');
  assert.strictEqual(model.members[0].isLead, true);
  assert.strictEqual(model.members.filter((m) => m.isLead).length, 1);
  assert.strictEqual(model.lead.userId, 'u-sam');
});

check('set/clear targets the row the database flagged', () => {
  const model = Core.build(payload());
  assert.strictEqual(model.lead.assignmentId, 'a3');
  const alyx = model.members.find((m) => m.userId === 'u-alyx');
  assert.strictEqual(alyx.assignmentId, 'a1', 'an undesignated person offers their first live row');
});

check('leadInstaller null means nobody leads — supported, but no lead', () => {
  const rows = payload().crew.map((row) => Object.assign({}, row, { is_lead: false }));
  const model = Core.build(payload({ crew: rows, leadInstaller: null }));
  assert.strictEqual(model.leadSupported, true);
  assert.strictEqual(model.lead, null);
  assert.strictEqual(model.members.some((m) => m.isLead), false);
});

check('a missing leadInstaller KEY is not "no lead" — the server has no opinion', () => {
  // An ops-api that predates PR #513: no projection, and no is_lead on any row.
  const legacy = { job: { id: 'job-1', type: 'fencing' }, crew: payload().crew.map((row) => {
    const copy = Object.assign({}, row);
    delete copy.is_lead;
    return copy;
  }) };
  const model = Core.build(legacy);
  assert.strictEqual(model.leadSupported, false, 'must not claim the lead feature is available');
  assert.strictEqual(model.lead, null);
  assert.strictEqual(model.members.length, 2, 'the crew still renders');
  assert.strictEqual(model.members.some((m) => m.isLead), false);
});

check('role is never the lead signal', () => {
  // Every row claims role 'lead_installer' — production's default — and none is
  // designated. Nobody may be named lead off the back of it.
  const rows = payload().crew.map((row) => Object.assign({}, row, { is_lead: false }));
  const model = Core.build(payload({ crew: rows, leadInstaller: null }));
  assert.strictEqual(model.lead, null);
});

check('is_lead alone still names a lead when the projection is absent', () => {
  const model = Core.build({ job: { id: 'job-1' }, crew: payload().crew });
  assert.strictEqual(model.leadSupported, true);
  assert.strictEqual(model.lead.userId, 'u-sam');
});

check('a lead the roster cannot place is still reported, not dropped', () => {
  const model = Core.build(payload({
    crew: payload().crew.map((row) => Object.assign({}, row, { is_lead: false })),
    leadInstaller: { assignment_id: 'gone', user_id: 'u-ghost', name: 'Off Roster' }
  }));
  assert.strictEqual(model.lead.name, 'Off Roster');
  assert.strictEqual(model.lead.offRoster, true);
  assert.strictEqual(model.members.length, 2, 'and is not smuggled into the roster');
});

check('crew names fall back through name -> users.name -> crew_name', () => {
  assert.strictEqual(Core.crewName({ name: 'A', users: { name: 'B' }, crew_name: 'C' }), 'A');
  assert.strictEqual(Core.crewName({ users: { name: 'B' }, crew_name: 'C' }), 'B');
  assert.strictEqual(Core.crewName({ crew_name: 'C' }), 'C');
  assert.strictEqual(Core.crewName({}), '');
});

check('unnamed rows are separate people, never merged into one blank', () => {
  const model = Core.build({
    crew: [{ id: 'x1' }, { id: 'x2' }],
    leadInstaller: null
  });
  assert.strictEqual(model.members.length, 2);
});

check('an empty crew is empty, not a lead-less claim about people', () => {
  const model = Core.build({ job: { id: 'j' }, crew: [], leadInstaller: null });
  assert.strictEqual(model.hasCrew, false);
  assert.strictEqual(model.members.length, 0);
});

check('build tolerates a missing payload entirely', () => {
  const model = Core.build(null);
  assert.strictEqual(model.hasCrew, false);
  assert.strictEqual(model.leadSupported, false);
  assert.strictEqual(model.lead, null);
});

// ── Authority: mirrors assertAssignmentMutationAuthz on set_job_lead ──
check('a dispatcher may set the lead on any vertical', () => {
  assert.strictEqual(Core.canSetLead({
    leadSupported: true, isDispatcher: true, managedVerticals: [], jobType: 'fencing'
  }), true);
});

check('a managed-vertical lead may set it on THAT vertical only', () => {
  const henry = { leadSupported: true, isDispatcher: false, managedVerticals: ['fencing'] };
  assert.strictEqual(Core.canSetLead(Object.assign({ jobType: 'fencing' }, henry)), true);
  assert.strictEqual(Core.canSetLead(Object.assign({ jobType: 'FENCING' }, henry)), true);
  assert.strictEqual(Core.canSetLead(Object.assign({ jobType: 'patio' }, henry)), false);
  assert.strictEqual(Core.canSetLead(Object.assign({ jobType: '' }, henry)), false);
});

check('an ordinary installer may never set the lead', () => {
  assert.strictEqual(Core.canSetLead({
    leadSupported: true, isDispatcher: false, managedVerticals: [], jobType: 'fencing'
  }), false);
});

check('nobody is offered the control against a server that cannot store it', () => {
  assert.strictEqual(Core.canSetLead({
    leadSupported: false, isDispatcher: true, managedVerticals: ['fencing'], jobType: 'fencing'
  }), false);
});

console.log(`\ntrade crew roster + lead installer core: ${passed} passed, 0 failed.`);
