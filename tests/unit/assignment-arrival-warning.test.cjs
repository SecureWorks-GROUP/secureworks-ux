const { test } = require('node:test');
const assert = require('node:assert/strict');
const createWarning = require('../../modules/ops-assignment-arrival.js');

function element(value = '') {
  return { value, hidden: false, children: [], textContent: '',
    appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; } };
}
function fixture() {
  const fields = Object.fromEntries(['assignJobSelect', 'assignDate', 'assignType', 'assignArrivalWarning', 'assignmentModal'].map(id => [id, element()]));
  fields.assignJobSelect.value = 'job-a';
  fields.assignDate.value = '2026-11-06';
  fields.assignType.value = 'install';
  let open = true;
  fields.assignmentModal.classList = { contains: () => open };
  const calls = [], events = {};
  const host = { document: { getElementById: id => fields[id], createElement: () => element(), addEventListener: (event, fn) => { events[event] = fn; } },
    opsFetch: async (action, params) => { calls.push({ action, params }); return { schedule_warnings: [] }; } };
  const api = createWarning(host);
  return { fields, host, calls, api, events, close() { open = false; }, text: () => fields.assignArrivalWarning.children.map(x => x.textContent).join('\n') };
}

test('install compares the exact chosen job and day and displays supplier warning', async () => {
  const f = fixture();
  f.host.opsFetch = async (action, params) => {
    f.calls.push({ action, params });
    return { schedule_warnings: [{ message: 'Fabricator confirmed readiness after this install date.' }] };
  };
  await f.api.refresh();
  assert.deepEqual(f.calls, [{ action: 'dispatch_arrival', params: { job_id: 'job-a', proposed_install_date: '2026-11-06' } }]);
  assert.match(f.text(), /Fabricator confirmed/);
  assert.equal(f.fields.assignDate.value, '2026-11-06');
  assert.equal(f.fields.assignArrivalWarning.hidden, false);
});

test('no warnings hides the panel without changing the install date', async () => {
  const f = fixture();
  await f.api.refresh();
  assert.equal(f.fields.assignArrivalWarning.hidden, true);
  assert.equal(f.fields.assignDate.value, '2026-11-06');
});

test('missing date stays unknown and makes no request', async () => {
  const f = fixture(); f.fields.assignDate.value = '';
  await f.api.refresh();
  assert.match(f.text(), /Choose an install date/);
  assert.equal(f.calls.length, 0);
});

for (const fail of [() => Promise.reject(new Error('offline')), async () => ({})]) {
  test('unreadable supplier facts ask the office to check Dispatch', async () => {
    const f = fixture(); f.host.opsFetch = fail;
    await f.api.refresh();
    assert.match(f.text(), /could not be checked/);
    assert.equal(f.fields.assignDate.value, '2026-11-06');
  });
}

test('a previous job response cannot paint over the new job', async () => {
  const f = fixture(); let release;
  f.host.opsFetch = () => new Promise(resolve => { release = resolve; });
  const old = f.api.refresh();
  f.fields.assignJobSelect.value = 'job-b';
  f.host.opsFetch = async () => ({ schedule_warnings: [{ message: 'New job date unconfirmed.' }] });
  await f.api.refresh();
  release({ schedule_warnings: [{ message: 'OLD JOB' }] }); await old;
  assert.match(f.text(), /New job/); assert.doesNotMatch(f.text(), /OLD/);
});

test('a previous date response cannot paint over the new date', async () => {
  const f = fixture(); let release;
  f.host.opsFetch = () => new Promise(resolve => { release = resolve; });
  const old = f.api.refresh();
  f.fields.assignDate.value = '2026-11-10';
  f.host.opsFetch = async () => ({ schedule_warnings: [] }); await f.api.refresh();
  release({ schedule_warnings: [{ message: 'OLD DATE' }] }); await old;
  assert.equal(f.fields.assignArrivalWarning.hidden, true);
});

test('closing the modal prevents a late response painting', async () => {
  const f = fixture(); let release;
  f.host.opsFetch = () => new Promise(resolve => { release = resolve; });
  const read = f.api.refresh(); f.close();
  release({ schedule_warnings: [{ message: 'CLOSED RESULT' }] }); await read;
  assert.doesNotMatch(f.text(), /CLOSED RESULT/);
});

test('scope visits, other job types, no job and closed form make no readiness reads', async () => {
  for (const change of [f => { f.fields.assignType.value = 'scope'; }, f => { f.host._poJobList = [{ id: 'job-a', type: 'makesafe' }]; }, f => { f.fields.assignJobSelect.value = ''; }, f => { f.close(); }]) {
    const f = fixture(); change(f); await f.api.refresh();
    assert.equal(f.calls.length, 0); assert.equal(f.fields.assignArrivalWarning.hidden, true);
  }
});

test('supplier text is rendered as text and never as markup', async () => {
  const f = fixture(); f.host.opsFetch = async () => ({ schedule_warnings: [{ message: '<img src=x onerror=alert(1)>' }] });
  await f.api.refresh();
  assert.equal(f.fields.assignArrivalWarning.children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(f.fields.assignArrivalWarning.children[1].innerHTML, undefined);
});

test('the real create and edit modal functions clear a previous scope type before checking installs', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const source = fs.readFileSync(path.resolve(__dirname, '../../ops.html'), 'utf8');
  const create = source.slice(source.indexOf('async function openAssignmentModal('), source.indexOf('// ── Edit existing assignment'));
  const edit = source.slice(source.indexOf('async function openEditAssignmentModal('), source.indexOf('var _poJobList = []'));
  const f = fixture();
  f.fields.assignType.value = 'scope';
  f.host.document.getElementById = id => f.fields[id] || (f.fields[id] = element());
  f.fields.assignmentModal.classList.add = () => {};
  let readKinds = [];
  const box = { document: f.host.document, window: { AssignmentArrivalWarning: f.api }, AssignmentArrivalWarning: f.api,
    _editAssignmentId: null, _crewList: [], _calEvents: [{ assignment_id: 'assignment', job_id: 'job-a', assignment_type: 'install', scheduled_date: '2026-11-06' }],
    loadPOJobList: async () => {}, loadCrewList: async () => {}, renderCrewDropdown: () => '', renderMemberCheckboxes: () => '', cleanCrewName: v => v,
    syncAssignEndDate: () => {}, selectJobPicker: (_prefix, job) => { f.fields.assignJobSelect.value = job; readKinds.push(f.fields.assignType.value); }, Date };
  vm.runInNewContext(create + '\n' + edit, box);
  await box.openAssignmentModal('job-a', '2026-11-06');
  assert.equal(f.fields.assignType.value, 'install');
  f.fields.assignType.value = 'scope';
  await box.openEditAssignmentModal('assignment');
  assert.equal(f.fields.assignType.value, 'install');
  box._calEvents[0].assignment_type = 'delivery';
  await box.openEditAssignmentModal('assignment');
  assert.equal(f.fields.assignType.value, 'delivery');
  assert.deepEqual(readKinds, ['install', 'install', 'delivery']);
});
