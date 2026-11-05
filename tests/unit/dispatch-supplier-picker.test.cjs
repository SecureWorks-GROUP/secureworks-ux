// Dispatch v2 Tweak 4 (modules/dispatch-supplier-picker.js): the Add supplier
// search rows. One row per approved supplier on its main Xero contact, the
// rest under Show more, and a greyed "Add to Xero first" row for an approved
// supplier with no Xero contact. Contacts and ids are made up.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../modules/dispatch-supplier-picker.js');

const BD = {
  approved_id: 'e-bd', approved_name: 'BD Metals', name: 'BD Metals', used_for: 'fencing',
  to: ['orders@bd.test'], cc: [], has_approved_email: true,
  supplier_id: 's-bd1', xero_name: 'Jaiama Investments Pty Ltd T/A B&D Metals Group Pty',
  main_reason: 'most_bills', bills_12m: 36, other_contacts: 2, can_add: true, note: null,
};
const BD_MORE = [
  { approved_id: 'e-bd', approved_name: 'BD Metals', name: 'Jaiama Investments T/a B&D Metals', xero_name: 'Jaiama Investments T/a B&D Metals', used_for: 'fencing', to: ['orders@bd.test'], has_approved_email: true, supplier_id: 's-bd2', can_add: true, note: null },
  { approved_id: 'e-bd', approved_name: 'BD Metals', name: 'Jaiaina Investments Pty Ltd T/A B&D Metals Group Pty', xero_name: 'Jaiaina Investments Pty Ltd T/A B&D Metals Group Pty', used_for: 'fencing', to: ['orders@bd.test'], has_approved_email: true, supplier_id: 's-bd3', can_add: true, note: null },
];
const UNIQUE = {
  approved_id: 'e-ul', approved_name: 'Unique Laser', name: 'Unique Laser', used_for: 'any', to: ['orders@ul.test'],
  has_approved_email: true, supplier_id: null, xero_name: null, main_reason: null, other_contacts: 0, can_add: false,
  note: 'Add to Xero first: this supplier has no Xero contact yet',
};
const ONE_OFF = { supplier_id: 's-x', name: 'B and D Steel Supplies', approved_id: null, approved_name: null, used_for: null, to: [], cc: [], has_approved_email: false, can_add: true, note: 'No approved order email: Dispatch will not send to this supplier' };

test('readAnswer: keeps the three lists and copes with an answer from before Tweak 4', () => {
  const a = P.readAnswer({ approved: [BD, null], more_approved: BD_MORE, others: [ONE_OFF], ranking: 'bills' });
  assert.equal(a.approved.length, 1);
  assert.equal(a.more_approved.length, 2);
  assert.equal(a.ranking, 'bills');
  const old = P.readAnswer({ approved: [BD], others: [] });
  assert.deepEqual(old.more_approved, []);
  assert.equal(P.readAnswer({ approved: [] }), null);
  assert.equal(P.readAnswer(null), null);
});

test('b&d: one BD Metals row on its main contact, the rest behind Show more', () => {
  const v = P.view(P.readAnswer({ approved: [BD], more_approved: BD_MORE, others: [ONE_OFF] }), {});
  assert.equal(v.approved.length, 1);
  const r = v.approved[0];
  assert.equal(r.title, 'BD Metals');
  assert.equal(r.sid, 's-bd1');
  assert.equal(r.disabled, false);
  assert.match(r.sub, /^Xero: Jaiama Investments Pty Ltd T\/A B&D Metals Group Pty/);
  assert.match(r.sub, /2 more Xero contacts under Show more/);
  assert.match(r.sub, /orders@bd\.test/);
  assert.equal(r.note, '');
  assert.equal(v.moreCount, 3);
  assert.equal(v.showMore, false);
  const open = P.view(P.readAnswer({ approved: [BD], more_approved: BD_MORE, others: [ONE_OFF] }), { more: true });
  assert.equal(open.showMore, true);
  assert.deepEqual(open.more.map((m) => [m.title, m.sid]), [
    ['Jaiama Investments T/a B&D Metals', 's-bd2'],
    ['Jaiaina Investments Pty Ltd T/A B&D Metals Group Pty', 's-bd3'],
  ]);
  assert.match(open.more[0].sub, /^Another Xero contact of BD Metals/);
  assert.deepEqual(open.others.map((o) => [o.title, o.noEmail, o.note]), [
    ['B and D Steel Supplies', true, 'No approved order email: Dispatch will not send to this supplier'],
  ]);
});

test('a greyed approved supplier with no Xero contact says Add to Xero first and cannot be picked', () => {
  const v = P.view(P.readAnswer({ approved: [UNIQUE], more_approved: [], others: [] }), {});
  const r = v.approved[0];
  assert.deepEqual([r.title, r.sid, r.greyed, r.disabled], ['Unique Laser', '', true, true]);
  assert.equal(r.note, 'Add to Xero first: this supplier has no Xero contact yet');
  // Even without the server's note.
  const bare = P.row({ ...UNIQUE, note: null }, 'approved', {}, '');
  assert.equal(bare.note, P.NO_XERO_NOTE);
});

test('no approved match: Show more opens by itself so a one-off is found by typing', () => {
  const v = P.view(P.readAnswer({ approved: [], more_approved: [], others: [ONE_OFF] }), {});
  assert.equal(v.showMore, true);
  assert.equal(v.others[0].title, 'B and D Steel Supplies');
  const none = P.view(P.readAnswer({ approved: [], more_approved: [], others: [] }), {});
  assert.equal(none.showMore, false);
  assert.equal(none.moreCount, 0);
});

test('a supplier already on the job, or one being added, cannot be picked again', () => {
  const on = P.view(P.readAnswer({ approved: [BD], others: [] }), { onJob: { 's-bd1': true } });
  assert.equal(on.approved[0].disabled, true);
  assert.equal(on.approved[0].note, 'On this job');
  const adding = P.view(P.readAnswer({ approved: [BD], others: [ONE_OFF] }), { adding: 's-bd1', more: true });
  assert.equal(adding.approved[0].adding, true);
  assert.equal(adding.approved[0].disabled, true);
  // Everything waits while one is being added.
  assert.equal(adding.others[0].disabled, true);
  assert.equal(adding.others[0].adding, false);
});

test('rnr: RnR Fencing, with the Xero name only when it differs', () => {
  const rr = { ...BD, approved_name: 'RnR Fencing', name: 'RnR Fencing', supplier_id: 's-rr', xero_name: 'R&R FENCING', other_contacts: 0, to: ['orders@rr.test'] };
  const v = P.view(P.readAnswer({ approved: [rr], others: [] }), {});
  assert.equal(v.approved[0].title, 'RnR Fencing');
  assert.equal(v.approved[0].sub, 'Xero: R&R FENCING · Fencing · orders@rr.test');
  const same = P.row({ ...rr, xero_name: 'RnR Fencing' }, 'approved', {}, '');
  assert.equal(same.sub, 'Fencing · orders@rr.test');
});
