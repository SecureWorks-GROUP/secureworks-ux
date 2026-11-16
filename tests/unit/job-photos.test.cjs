// Add job photos page rules (modules/job-photos.js, <job-photos-core>).
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../../modules/job-photos.js');

const JOB = '9de1d7b8-4aec-47d8-85bf-2c1ea72b6d53';

test('the link must name a job by its id; nothing else is accepted', () => {
  assert.equal(Core.jobIdFromSearch('?jobId=' + JOB), JOB);
  assert.equal(Core.jobIdFromSearch('?x=1&jobId=' + JOB.toUpperCase() + '&y=2'), JOB);
  assert.equal(Core.jobIdFromSearch('?jobId=SWMS-261710'), '');
  assert.equal(Core.jobIdFromSearch('?job=' + JOB), '');
  assert.equal(Core.jobIdFromSearch(''), '');
});

test('the job is named by its number and place, the suburb said once', () => {
  assert.equal(Core.jobTitle({ job: { job_number: 'SWMS-1', site_address: '24 Calendia Way', site_suburb: 'West Swan' } }), 'SWMS-1 · 24 Calendia Way, West Swan');
  assert.equal(Core.jobTitle({ job: { job_number: 'SWMS-2', site_address: '18 A Devon Way, Lynwood', site_suburb: 'Lynwood' } }), 'SWMS-2 · 18 A Devon Way, Lynwood');
  assert.equal(Core.jobTitle({ job: { job_number: 'SWMS-3' } }), 'SWMS-3');
  assert.equal(Core.jobTitle(null), '');
});

test('photos on this visit are counted as the Trade app report screen counts them', () => {
  const media = [
    { type: 'photo', attendance_cycle_id: 'c2', cycle_attribution: 'bound' },
    { type: 'photo', attendance_cycle_id: 'c2', cycle_attribution: 'bound' },
    { type: 'photo', attendance_cycle_id: 'c1', cycle_attribution: 'bound' },
    { type: 'photo', attendance_cycle_id: 'c2', cycle_attribution: 'legacy' },
    { type: 'video', attendance_cycle_id: 'c2', cycle_attribution: 'bound' },
    { type: 'photo', phase: 'receipt', attendance_cycle_id: 'c2', cycle_attribution: 'bound' },
  ];
  assert.equal(Core.visitPhotoCount({ media, makesafe_details: { attendance_cycle_id: 'c2' } }), 2);
  // A job with no attendance cycle counts every photo that is not a receipt.
  assert.equal(Core.visitPhotoCount({ media }), 4);
  assert.equal(Core.visitPhotoCount({}), 0);
});

test('the count says how many more the report needs', () => {
  assert.equal(Core.countLine(0), '0 photos on this visit. The report needs 5: 5 more.');
  assert.equal(Core.countLine(1), '1 photo on this visit. The report needs 5: 4 more.');
  assert.equal(Core.countLine(5), '5 photos on this visit. Enough for the report.');
  assert.equal(Core.countLine(12), '12 photos on this visit. Enough for the report.');
});

test('a failed photo is never hidden behind the ones that went up', () => {
  assert.equal(Core.outcomeLine(3, 0), '3 photos added.');
  assert.equal(Core.outcomeLine(1, 0), '1 photo added.');
  assert.equal(Core.outcomeLine(0, 2), 'None of the 2 photos went up. Check your signal and try again.');
  assert.equal(Core.outcomeLine(4, 1), '4 added, 1 did not go up. Pick the missing one again.');
  assert.equal(Core.outcomeLine(0, 0), '');
});

test('a photo is drawn at the Trade app upload size: longest side 1600', () => {
  assert.deepEqual(Core.scaledSize(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(Core.scaledSize(3024, 4032), { width: 1200, height: 1600 });
  assert.deepEqual(Core.scaledSize(1200, 900), { width: 1200, height: 900 });
});

test('a refusal is said in words', () => {
  assert.equal(Core.errorLine({ status: 401 }), 'Your sign-in has run out. Sign in again.');
  assert.match(Core.errorLine({ status: 403 }), /not on this job/);
  assert.equal(Core.errorLine({ status: 403, message: 'Not assigned to this job' }), 'Not assigned to this job');
  assert.equal(Core.errorLine({ status: 404 }), 'That job could not be found.');
  assert.match(Core.errorLine(null), /Check your signal/);
});
