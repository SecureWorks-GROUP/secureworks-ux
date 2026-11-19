const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../../crew/js/lib/office-entry.js'), 'utf8').replace(/^export /gm, '');
const ctx = vm.createContext({});
vm.runInContext(source + '\nthis.api = { officeEntryOf, canDisputeOfficeEntry, reasonOk };', ctx);
const { officeEntryOf, canDisputeOfficeEntry, reasonOk } = ctx.api;

const marks = {
  office_entered: true,
  office_entry_reason: 'ZZTEST office entered the missing day',
  office_entered_at: '2026-11-12T04:00:00+08:00',
  disputed: false
};

test('office entry stays hidden unless the caller was entered by the office', () => {
  assert.equal(officeEntryOf({}, null).entered, false);
  assert.equal(officeEntryOf({ office_entered: false }, { office_entered: false }).entered, false);
  assert.equal(officeEntryOf({ hourly_rate: 'RATELEAK' }, null).entered, false);
});

test('the marks are read from the share or from the caller row', () => {
  const fromShare = officeEntryOf(marks, { me: true, hours: 8 });
  assert.equal(fromShare.entered, true);
  assert.equal(fromShare.reason, marks.office_entry_reason);
  assert.equal(fromShare.disputed, false);
  const fromRow = officeEntryOf({ group_id: 'g-zz' }, { me: true, ...marks, disputed: true, dispute_reason: 'ZZTEST wrong day' });
  assert.equal(fromRow.entered, true);
  assert.equal(fromRow.disputed, true);
  assert.equal(fromRow.disputeReason, 'ZZTEST wrong day');
  assert.equal(fromRow.hourly_rate, undefined);
});

test('a dispute needs a reason of 3 to 500 characters and an open, unfrozen share', () => {
  const entry = officeEntryOf(marks, null);
  assert.equal(canDisputeOfficeEntry(entry, { groupId: 'g-zz', submitted: false, frozen: false }), true);
  assert.equal(canDisputeOfficeEntry(entry, { groupId: 'g-zz', submitted: true, frozen: true }), false);
  assert.equal(canDisputeOfficeEntry(entry, { groupId: 'g-zz', frozen: true }), false);
  assert.equal(canDisputeOfficeEntry(officeEntryOf({ ...marks, disputed: true }, null), { groupId: 'g-zz' }), false);
  assert.equal(canDisputeOfficeEntry(entry, {}), false);
  assert.equal(reasonOk('ab'), false);
  assert.equal(reasonOk('ZZZ'), true);
  assert.equal(reasonOk('x'.repeat(500)), true);
  assert.equal(reasonOk('x'.repeat(501)), false);
});
