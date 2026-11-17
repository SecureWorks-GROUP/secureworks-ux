// Dispatch v2 item 16 part 1 (modules/dispatch-tray-files.js): the files
// listed on an Unmatched supplier email, and the words after Put on job.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../modules/dispatch-tray-files.js');
const TF = globalThis.OpsDispatchTrayFiles;

const PDF = { id: 'a1', file_name: '16112026124402-0001.pdf', kind_label: 'PDF', size_label: '188 KB', openable: true, not_kept_reason: null };
const BIG = { id: 'a2', file_name: 'huge.pdf', kind_label: 'PDF', size_label: '19.1 MB', openable: false, not_kept_reason: 'Not saved: over 15 MB' };

test('an ops-api from before item 16 (no attachments field) draws nothing', () => {
  assert.equal(TF.html({ id: 'e1' }), '');
  assert.equal(TF.html(null), '');
});

test('no files draws nothing; a failed files read says so', () => {
  assert.equal(TF.html({ id: 'e1', attachments: [] }), '');
  assert.match(TF.html({ id: 'e1', attachments: null }), /Could not read the files on this email\./);
});

test('each file reads "PDF: name, size" with Open, or the reason it was not kept', () => {
  const h = TF.html({ id: 'e1', attachments: [PDF, BIG] });
  assert.match(h, /<span class="dpc-tf-kind">PDF:<\/span> <span class="dpc-tf-name">16112026124402-0001\.pdf<\/span><span class="dpc-tf-size">, 188 KB<\/span>/);
  assert.match(h, /data-dpc-tf-open="e1" data-att="a1"[^>]*>Open</);
  assert.doesNotMatch(h, /data-att="a2"/);
  assert.match(h, /Not saved: over 15 MB/);
});

test('names are escaped', () => {
  const h = TF.html({ id: 'e1', attachments: [Object.assign({}, PDF, { file_name: '<img src=x>.pdf' })] });
  assert.doesNotMatch(h, /<img/);
});

test('after Put on job: saved, already on the job, and not saved', () => {
  assert.equal(TF.doneWords({}), '');
  assert.equal(TF.doneWords({ documents: { read: 'ok', saved: [{ name: 'x' }], skipped: [] } }), " 1 file saved to the job's documents, office only.");
  assert.equal(TF.doneWords({ documents: { read: 'ok', saved: [{}, {}], skipped: [{ reason: 'already_on_job' }, { reason: 'not_kept' }, { reason: 'upload_failed' }] } }),
    " 2 files saved to the job's documents, office only. 1 file was already on the job. 1 file could not be saved.");
  assert.match(TF.doneWords({ documents: { read: 'failed', saved: [], skipped: [] } }), /could not be saved to the job/);
  assert.equal(TF.doneWords({ documents: { read: 'ok', saved: [], skipped: [] } }), '');
});
