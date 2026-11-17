// Dispatch v2 photos AND files on a supplier box (modules/dispatch-order-files.js,
// Shaun 16 Nov 2026). File names and sizes are made up.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../modules/dispatch-order-files.js');

const MB = 1000000;

test('the limits are the ones Shaun approved and match the server', () => {
  assert.equal(F.MAX_BYTES, 3000000);
  assert.equal(F.PER_EMAIL, 10);
  assert.equal(F.EMAIL_BYTES, 20000000);
  assert.equal(F.PER_JOB, 40);
  assert.equal(F.ACCEPT, 'image/*,.pdf,.xlsx,.xls,.csv,.docx,.doc');
});

test('a picked file is a photo, a file or another kind, by its name first, then its type', () => {
  assert.equal(F.pickedKind('Plans.pdf', 'application/pdf'), 'file');
  assert.equal(F.pickedKind('Order.XLSX', ''), 'file');
  assert.equal(F.pickedKind('old.xls', 'application/vnd.ms-excel'), 'file');
  assert.equal(F.pickedKind('cut-list.csv', 'text/csv'), 'file');
  assert.equal(F.pickedKind('spec.docx', ''), 'file');
  assert.equal(F.pickedKind('spec.doc', 'application/msword'), 'file');
  assert.equal(F.pickedKind('list.jpg', 'image/jpeg'), 'photo');
  assert.equal(F.pickedKind('list.png', 'image/png'), 'photo');
  // An iPhone photo is tried as a photo; when the browser cannot open it, the server refuses it.
  assert.equal(F.pickedKind('IMG_0001.HEIC', 'image/heic'), 'photo');
  // A PDF with no extension still counts by its type.
  assert.equal(F.pickedKind('scan', 'application/pdf'), 'file');
  assert.equal(F.pickedKind('all.zip', 'application/zip'), 'other');
  assert.equal(F.pickedKind('mail.msg', ''), 'other');
  assert.equal(F.pickedKind('notes.txt', 'text/plain'), 'other');
});

test('before it uploads: another kind is refused by name; a file over 3 MB is refused by name and size; a photo is never refused for size', () => {
  assert.deepEqual(F.precheck({ name: 'all.zip', type: 'application/zip', size: 1000 }), {
    code: 'file_type_not_allowed',
    text: 'all.zip cannot be attached. Only photos (JPEG, PNG, WebP), PDF, Excel (.xlsx, .xls), CSV and Word (.docx, .doc) files can go on an order.'
  });
  assert.deepEqual(F.precheck({ name: 'Plans.pdf', type: 'application/pdf', size: 4.2 * MB }), {
    code: 'file_too_large',
    text: 'Plans.pdf is 4.2 MB. Each photo or file must be under 3 MB to go with an Outlook email. Shrink it, or send that one from Outlook.'
  });
  // 3,000,000 bytes exactly is taken, as on the server.
  assert.equal(F.precheck({ name: 'Plans.pdf', type: 'application/pdf', size: 3000000 }), null);
  assert.equal(F.precheck({ name: 'Plans.pdf', type: 'application/pdf', size: 3000001 }).code, 'file_too_large');
  // A big photo is shrunk first, so it is not refused here.
  assert.equal(F.precheck({ name: 'site.jpg', type: 'image/jpeg', size: 9 * MB }), null);
  // No long dash anywhere.
  assert.doesNotMatch(F.precheck({ name: 'a.zip', size: 1 }).text + F.precheck({ name: 'b.pdf', size: 5 * MB }).text, /[–—]/);
});

test('a row is a file by the server\'s kind, or by its content type from an older server', () => {
  assert.equal(F.isFile({ kind: 'file', content_type: 'application/pdf' }), true);
  assert.equal(F.isFile({ kind: 'photo', content_type: 'image/jpeg' }), false);
  assert.equal(F.isFile({ content_type: 'application/pdf' }), true);
  assert.equal(F.isFile({ content_type: 'image/webp' }), false);
  assert.equal(F.isFile({ file_name: 'Order.xlsx' }), true);
  // An id the screen does not know is counted as a photo.
  assert.equal(F.isFile({ id: 'x' }), false);
  assert.equal(F.isFile(null), false);
});

test('the kind tag: PDF, Excel, CSV or Word', () => {
  assert.equal(F.label({ kind: 'file', file_label: 'PDF', content_type: 'application/pdf' }), 'PDF');
  assert.equal(F.label({ content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Excel');
  assert.equal(F.label({ content_type: 'application/vnd.ms-excel' }), 'Excel');
  assert.equal(F.label({ content_type: 'text/csv' }), 'CSV');
  assert.equal(F.label({ content_type: 'application/msword' }), 'Word');
  assert.equal(F.label({ file_name: 'spec.docx' }), 'Word');
  assert.equal(F.label({ kind: 'photo', content_type: 'image/jpeg' }), 'Photo');
});

test('a file dragged from the computer is told from a line being moved: dataTransfer.types holds "Files"', () => {
  assert.equal(F.isFileDrag({ types: ['Files'] }), true);
  assert.equal(F.isFileDrag({ types: ['text/plain', 'Files'] }), true);
  // A line being moved between boxes carries text/plain only.
  assert.equal(F.isFileDrag({ types: ['text/plain'] }), false);
  // An old browser's DOMStringList.
  assert.equal(F.isFileDrag({ types: { contains: (t) => t === 'Files' } }), true);
  assert.equal(F.isFileDrag({}), false);
  assert.equal(F.isFileDrag(null), false);
});

test('a new email takes ten at most, in order, and one that would go over 20 MB waits for the next email', () => {
  const rows = (n, size) => Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), size_bytes: size }));
  assert.deepEqual(F.pickForEmail(rows(12, 100)).map((r) => r.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']);
  // Seven files of 2.9 MB: six come to 17.4 MB, a seventh would be 20.3 MB.
  assert.deepEqual(F.pickForEmail(rows(7, 2.9 * MB)).map((r) => r.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  assert.deepEqual(F.pickForEmail([]), []);
});

test('on a held email a photo or file can be ticked on while the email stays at ten and 20 MB', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ id: 'p' + (i + 1), size_bytes: 100 }));
  const ten = rows.slice(0, 10).map((r) => r.id);
  assert.equal(F.canTick(ten, rows, 'p11'), false);
  // One already ticked can always be ticked off.
  assert.equal(F.canTick(ten, rows, 'p3'), true);
  assert.equal(F.canTick(['p1'], rows, 'p2'), true);
  const big = [{ id: 'a', size_bytes: 2.9 * MB }, { id: 'b', size_bytes: 2.9 * MB }, { id: 'c', size_bytes: 2.9 * MB },
    { id: 'd', size_bytes: 2.9 * MB }, { id: 'e', size_bytes: 2.9 * MB }, { id: 'f', size_bytes: 2.9 * MB }, { id: 'g', size_bytes: 2.9 * MB }];
  assert.equal(F.canTick(['a', 'b', 'c', 'd', 'e', 'f'], big, 'g'), false);
  assert.equal(F.canTick(['a', 'b', 'c', 'd', 'e'], big, 'g'), true);
});

test('what an email carries, in words', () => {
  assert.equal(F.attachWords([{ kind: 'photo' }]), '1 photo');
  assert.equal(F.attachWords([{ kind: 'photo' }, { content_type: 'image/png' }]), '2 photos');
  assert.equal(F.attachWords([{ kind: 'file' }]), '1 file');
  assert.equal(F.attachWords([{ kind: 'photo' }, { kind: 'file' }, { content_type: 'application/pdf' }]), '1 photo and 2 files');
});

test('after a batch: one file says its own line; several say which went and each one that did not, by name', () => {
  assert.deepEqual(F.batchMessage([{ name: 'Plans.pdf', ok: true, text: 'File added: Plans.pdf (PDF), 0.2 MB.' }]),
    { bad: false, text: 'File added: Plans.pdf (PDF), 0.2 MB.' });
  assert.deepEqual(F.batchMessage([{ name: 'all.zip', ok: false, text: 'all.zip cannot be attached.' }]),
    { bad: true, text: 'all.zip cannot be attached.' });
  assert.deepEqual(F.batchMessage([
    { name: 'a.jpg', ok: true, text: 'Photo added: a.jpg, 0.1 MB.' },
    { name: 'Plans.pdf', ok: true, text: 'File added: Plans.pdf (PDF), 0.2 MB.' }
  ]), { bad: false, text: 'Added 2: a.jpg, Plans.pdf.' });
  assert.deepEqual(F.batchMessage([
    { name: 'a.jpg', ok: true, text: 'Photo added: a.jpg, 0.1 MB.' },
    { name: 'big.pdf', ok: false, text: 'big.pdf is 4.2 MB. Each photo or file must be under 3 MB to go with an Outlook email. Shrink it, or send that one from Outlook.' },
    { name: 'all.zip', ok: false, text: 'all.zip cannot be attached.' }
  ]), {
    bad: true,
    text: 'Added 1 of 3. Not added:',
    notes: ['big.pdf is 4.2 MB. Each photo or file must be under 3 MB to go with an Outlook email. Shrink it, or send that one from Outlook.', 'all.zip cannot be attached.']
  });
  assert.deepEqual(F.batchMessage([
    { name: 'x.zip', ok: false, text: 'x.zip cannot be attached.' },
    { name: 'y.zip', ok: false, text: 'y.zip cannot be attached.' }
  ]), { bad: true, text: 'None of the 2 were added. Not added:', notes: ['x.zip cannot be attached.', 'y.zip cannot be attached.'] });
});
