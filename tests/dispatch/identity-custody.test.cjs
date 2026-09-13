const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace, clone } = require('./workspace-harness.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const operator = { id: 'operator-a', org_id: 'org-a' };
const mail = { sender: 'private-a@example.test', to: 'supplier-a@example.test', subject: 'Private operator subject', body: 'Private operator text', purchase_commitment: 'false' };

for (const next of [{ id: 'operator-b', org_id: 'org-a' }, { id: 'operator-a', org_id: 'org-b' }]) {
  test(`identity change to ${next.id}/${next.org_id} clears prior DOM and pending reads`, async () => {
    const late = deferred(); let hold = false, denied = false;
    const ui = await workspace({ hostIdentity: operator, get: async action => {
      if (denied) throw Error('New account evidence unavailable');
      if (hold && action === 'dispatch_job') return late.promise;
    } });
    await ui.click('tab', 'email'); await ui.click('new-draft'); ui.input('draft', mail, 'draft');
    ui.records.a.job.pricing_json = { price: 'Private price' };
    hold = true;
    const old = ui.core.load('a');
    const rejected = assert.rejects(old, /disposed/);
    ui.identity(null); ui.emit('sw:auth-locked');
    assert.equal(ui.host.innerHTML, '');
    assert.equal(ui.core.state.editors.size, 0);
    assert.equal(ui.core.state.records.size, 0);
    denied = true; hold = false;
    ui.identity(next); ui.emit('sw:auth-unlocked');
    await ui.context.DispatchOps.load();
    assert.doesNotMatch(ui.host.innerHTML, /Private operator|Private price|supplier-a/);
    late.resolve(clone(ui.records.a)); await rejected;
    assert.equal(ui.core.state.records.size, 0);
    assert.doesNotMatch(ui.host.innerHTML, /Private operator|Private price/);
    await assert.rejects(ui.core.command('a', 'note_upsert', { text: 'old actor' }), /disposed/);
    assert.equal(ui.commands.length, 0);
  });
}

test('late prior-operator save cannot restore editors or start another request', async () => {
  const late = deferred();
  const ui = await workspace({ hostIdentity: operator, post: () => late.promise });
  await ui.click('add-group'); ui.input('group', { name: 'Private old group' });
  const saving = ui.submit('group', { name: 'Private old group' });
  const originalCalls = ui.reads.length;
  ui.identity(null);
  ui.identity({ id: 'operator-b', org_id: 'org-a' });
  late.resolve({ saved: true }); await saving;
  assert.equal(ui.host.innerHTML, '');
  assert.equal(ui.core.state.pending.size, 0);
  assert.equal(ui.core.state.records.size, 0);
  assert.equal(ui.reads.length, originalCalls);
  assert.equal(ui.commands.length, 1);
});

test('identity reset clears incumbent calendar caches and unscheduled sidebar hosts', async () => {
  const node = (html = '') => {
    const item = { innerHTML: html, removed: [] };
    item.classList = { remove(...names) { item.removed.push(...names); } };
    return item;
  };
  const sidebar = node('Private A · Secret suburb · $999');
  const sched = node('Private A · Secret suburb · schedule action');
  const confirm = node('Private A · confirm action');
  const popup = node('Private A · popup action');
  const backdrop = node();
  const confirmBackdrop = node();
  const assignment = node();
  const assignTitle = { textContent: 'Edit Assignment — Private A' };
  const assignTypeGroup = { style: { display: 'block' } };
  const valued = value => ({ value });
  const assignJobSearch = valued('Private A job');
  const assignJobSelect = valued('job-a');
  const assignDate = valued('2026-09-14');
  const assignEndDate = valued('2026-09-16');
  const assignStartTime = valued('07:30');
  const assignEndTime = valued('15:30');
  const assignNotes = valued('Private note');
  const assignType = valued('meeting');
  const assignDuration = valued('4');
  const assignCrew = node('Private crew select');
  const assignMembers = node('Private helper');
  const assignDropdown = node('Private job dropdown');
  const ui = await workspace({ hostIdentity: operator });
  ui.document.getElementById = id => ({
    calUnschedSidebar: sidebar,
    dispatchRoot: ui.host,
    calSchedModal: sched,
    calConfirmModal: confirm,
    calJobPopup: popup,
    calSchedBackdrop: backdrop,
    calConfirmBackdrop: confirmBackdrop,
    assignmentModal: assignment,
    assignModalTitle: assignTitle,
    assignTypeGroup,
    assignJobSearch,
    assignJobSelect,
    assignDate,
    assignEndDate,
    assignStartTime,
    assignEndTime,
    assignNotes,
    assignType,
    assignDuration,
    assignCrewContainer: assignCrew,
    assignMembersContainer: assignMembers,
    assignJobDropdown: assignDropdown
  })[id] || null;
  Object.assign(ui.context, {
    _unschedJobs: [{ client_name: 'Private A', site_suburb: 'Secret suburb', quoted_value: 999 }],
    _calEvents: [{ job_id: 'old', client_name: 'Private A' }],
    _calDeliveries: [{ id: 'old-po' }],
    _calReadiness: { old: true },
    _calOrgEvents: [{ id: 'old-org' }],
    _calLeaveByDate: { '2026-09-14': ['Private A'] },
    _calAvailability: { old: true },
    _crewList: ['Private crew'],
    _poJobList: [{ client_name: 'Private A' }],
    _editAssignmentId: 'assignment-a',
    _calPopupAssignment: { client_name: 'Private A' },
    _calDragData: { jobId: 'old' },
    _calUnschedOpen: true,
    _calTruncated: true
  });
  ui.identity(null);
  assert.equal(JSON.stringify(ui.context._unschedJobs), '[]');
  assert.equal(JSON.stringify(ui.context._calEvents), '[]');
  assert.equal(JSON.stringify(ui.context._calDeliveries), '[]');
  assert.equal(JSON.stringify(ui.context._calReadiness), '{}');
  assert.equal(JSON.stringify(ui.context._calOrgEvents), '[]');
  assert.equal(JSON.stringify(ui.context._calLeaveByDate), '{}');
  assert.equal(JSON.stringify(ui.context._calAvailability), '{}');
  assert.equal(JSON.stringify(ui.context._crewList), '[]');
  assert.equal(JSON.stringify(ui.context._poJobList), '[]');
  assert.equal(ui.context._editAssignmentId, null);
  assert.equal(ui.context._calPopupAssignment, null);
  assert.equal(ui.context._calDragData, null);
  assert.equal(ui.context._calUnschedOpen, false);
  assert.equal(ui.context._calTruncated, false);
  assert.equal(sidebar.innerHTML, '');
  assert.equal(sched.innerHTML, '');
  assert.equal(confirm.innerHTML, '');
  assert.equal(popup.innerHTML, '');
  assert.deepEqual(sched.removed, ['open', 'active']);
  assert.deepEqual(backdrop.removed, ['open', 'active']);
  assert.deepEqual(confirmBackdrop.removed, ['open', 'active']);
  assert.deepEqual(assignment.removed, ['open', 'active']);
  assert.equal(assignTitle.textContent, 'Schedule Assignment');
  assert.equal(assignJobSearch.value, '');
  assert.equal(assignJobSelect.value, '');
  assert.equal(assignDate.value, '');
  assert.equal(assignEndDate.value, '');
  assert.equal(assignStartTime.value, '');
  assert.equal(assignEndTime.value, '');
  assert.equal(assignNotes.value, '');
  assert.equal(assignType.value, 'install');
  assert.equal(assignDuration.value, '2');
  assert.equal(assignCrew.innerHTML, '');
  assert.equal(assignMembers.innerHTML, '');
  assert.equal(assignDropdown.innerHTML, '');
  assert.equal(assignTypeGroup.style.display, 'none');
  assert.doesNotMatch(ui.host.innerHTML, /Private A|Secret suburb/);
});

test('same-identity refresh retains editor but signout fences even a same-identity return', async () => {
  const ui = await workspace({ hostIdentity: operator });
  await ui.click('new-draft'); ui.input('draft', mail, 'draft');
  const guard = ui.context.DispatchOps.identityGuard();
  ui.identity({ ...operator });
  guard(); ui.app.render(); assert.match(ui.host.innerHTML, /Private operator/);
  ui.identity(null); ui.identity({ ...operator });
  assert.throws(guard, /identity changed/);
  assert.equal(ui.host.innerHTML, '');
  assert.equal(ui.core.state.editors.size, 0);
});

test('signout clears event, recurring-series and Quick Allocate editors before the next operator unlocks', async () => {
  const ui = await workspace({ hostIdentity: operator });
  const fields = ['eventTitle', 'eventDate', 'eventEndDate', 'eventStartTime', 'eventEndTime', 'eventNotes', 'eventJobSearch', 'eventJobSelect', 'eventRecEndDate', 'quickAllocateJobId', 'quickAllocateDate', 'quickAllocateTime', 'quickAllocateNotes'];
  const nodes = Object.fromEntries(fields.map(id => [id, { value: 'Private A value' }]));
  for (const id of ['eventCrewContainer', 'eventJobDropdown', 'quickAllocateCrewContainer']) nodes[id] = { innerHTML: 'Private A selection' };
  for (const id of ['addEventModal', 'quickAllocateModal']) {
    const classes = new Set(['active']);
    nodes[id] = { classList: { remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) } };
  }
  for (const id of ['eventRecurrenceEnds', 'eventCustomRecurrence', 'eventRecCountGroup', 'eventRecDateGroup']) nodes[id] = { style: { display: 'block' } };
  nodes.quickAllocateJobLabel = { textContent: 'Private A customer' };
  nodes.quickAllocateSubmitBtn = { textContent: 'Saving...', disabled: true };
  nodes.eventVisibleToTrades = { checked: true };
  nodes.eventRecurrence = { value: 'custom' };
  const days = [{ checked: true }, { checked: false }];
  const series = [1, 2].map(id => ({ innerHTML: `Private A series ${id} action`, dataset: { updates: '{"notes":"Private A"}' }, removed: false, remove() { this.removed = true; } }));
  ui.document.getElementById = id => nodes[id] || null;
  ui.document.querySelectorAll = selector => selector === '#recurrenceScopeModal' ? series : selector === '#eventRecDaysRow input' ? days : [];
  ui.context._quickAllocateExisting = [{ id: 'assignment-a', userId: 'crew-a' }];
  const origin = ui.context.DispatchOps.identityGuard();
  ui.context._quickAllocateAssertIdentity = origin;

  ui.identity(null);
  ui.identity({ id: 'operator-b', org_id: 'org-a' });
  ui.emit('sw:auth-unlocked');

  for (const id of fields) assert.equal(nodes[id].value, '', id);
  for (const id of ['eventCrewContainer', 'eventJobDropdown', 'quickAllocateCrewContainer']) assert.equal(nodes[id].innerHTML, '', id);
  for (const id of ['addEventModal', 'quickAllocateModal']) assert.equal(nodes[id].classList.contains('active'), false, id);
  for (const id of ['eventRecurrenceEnds', 'eventCustomRecurrence', 'eventRecCountGroup', 'eventRecDateGroup']) assert.equal(nodes[id].style.display, 'none', id);
  assert.equal(nodes.quickAllocateJobLabel.textContent, '');
  assert.equal(nodes.quickAllocateSubmitBtn.textContent, 'Allocate');
  assert.equal(nodes.quickAllocateSubmitBtn.disabled, false);
  assert.equal(nodes.eventVisibleToTrades.checked, false);
  assert.equal(nodes.eventRecurrence.value, 'none');
  assert.ok(days.every(day => !day.checked));
  assert.ok(series.every(modal => modal.removed && modal.innerHTML === '' && !modal.dataset.updates));
  assert.deepEqual(clone(ui.context._quickAllocateExisting), []);
  assert.equal(ui.context._quickAllocateAssertIdentity, null);
  assert.throws(origin, error => error.code === 'dispatch_identity_changed');
  assert.equal(ui.commands.length, 0);
});
