// Dispatch v2 Make email (modules/dispatch-make-email.js): a box needs a line
// or a photo to make an email (Tweak 5, Shaun 5 Nov 2026), and the hint says
// which. Supplier and file names are made up.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../modules/dispatch-make-email.js');

const line = (id, extra = {}) => ({ id, description: 'Gate hinges', status: 'to_order', locked: false, ...extra });
const photo = (id) => ({ id, file_name: id + '.jpg' });
const box = (extra = {}) => ({ lines: [], photos: [], sent: [], blocked: null, ...extra });

test('the hints are the words Shaun approved', () => {
  assert.equal(M.PHOTO_ONLY_HINT, 'Photos only: the email will say Please see attached for materials needed.');
  assert.equal(M.NOTHING_HINT, 'Add a line or a photo to make an email.');
  // No long dash in any of them.
  [M.PHOTO_ONLY_HINT, M.NOTHING_HINT, M.ALL_GONE_HINT].forEach((h) => assert.doesNotMatch(h, /[\u2013\u2014]/));
});

test('a box with no line and no photo cannot make an email', () => {
  const s = M.makeState(box());
  assert.deepEqual(s, { lines: 0, photos: 0, photoOnly: false, can: false, hint: 'Add a line or a photo to make an email.' });
});

test('a box with only a photo makes a photo-only email and says so', () => {
  const s = M.makeState(box({ photos: [photo('p1')] }));
  assert.deepEqual(s, { lines: 0, photos: 1, photoOnly: true, can: true, hint: M.PHOTO_ONLY_HINT });
});

test('an empty, untyped line row is not a line, so a photo box with one is still photo only', () => {
  const s = M.makeState(box({ lines: [line('l1', { description: '   ' }), line('l2', { description: null })], photos: [photo('p1')] }));
  assert.equal(s.lines, 0);
  assert.equal(s.photoOnly, true);
  // With no photo either, the button stays off.
  assert.equal(M.makeState(box({ lines: [line('l1', { description: '' })] })).can, false);
});

test('In stock and sent lines do not count; a real line makes a lines email with the usual hint left to the caller', () => {
  const lines = [line('l1', { status: 'in_stock' }), line('l2', { locked: true }), line('l3')];
  assert.deepEqual(M.orderableLines(box({ lines })).map((l) => l.id), ['l3']);
  const s = M.makeState(box({ lines, photos: [photo('p1')] }));
  assert.deepEqual(s, { lines: 1, photos: 1, photoOnly: false, can: true, hint: '' });
});

test('photos that already went on a sent email do not count, so a sent photo order does not light Make email up again', () => {
  const sent = [{ photo_ids: ['p1'] }];
  assert.deepEqual(M.unsentPhotos(box({ photos: [photo('p1'), photo('p2')], sent })).map((p) => p.id), ['p2']);
  const gone = M.makeState(box({ photos: [photo('p1')], sent }));
  assert.equal(gone.can, false);
  assert.equal(gone.hint, 'Everything here has gone. Add a line or a photo to order more.');
  // A new photo is a new order.
  assert.equal(M.makeState(box({ photos: [photo('p1'), photo('p2')], sent })).photoOnly, true);
});

test('a blocked box leaves its hint to the caller (it says why sending is off)', () => {
  const s = M.makeState(box({ photos: [photo('p1')], blocked: { code: 'no_approved_email' } }));
  assert.equal(s.hint, '');
});

test('a held email with no line and no photo ticked is empty; one with either is not', () => {
  assert.equal(M.heldEmailIsEmpty(0, []), true);
  assert.equal(M.heldEmailIsEmpty(0, ['p1']), false);
  assert.equal(M.heldEmailIsEmpty(2, []), false);
});

test('bad input never throws', () => {
  assert.deepEqual(M.makeState(null), { lines: 0, photos: 0, photoOnly: false, can: false, hint: 'Add a line or a photo to make an email.' });
  assert.deepEqual(M.makeState({ lines: null, photos: undefined, sent: [{}] }).can, false);
});
