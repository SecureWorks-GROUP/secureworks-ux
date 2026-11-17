// Dispatch v2 Book install (modules/dispatch-book-install.js): the days it
// lays and what the Install row draws for each step. No browser: the module
// is loaded into node with a fake opsFetch.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let answer = null;
const calls = [];
globalThis.opsFetch = (action, params) => {
  calls.push({ action, params });
  return Promise.resolve(answer);
};
require('../../modules/dispatch-book-install.js');
const BI = globalThis.OpsDispatchBookInstall;
const flush = () => new Promise((r) => setTimeout(r, 0));

function install(over) {
  return Object.assign({
    job_id: 'job-1', booked: true, state: 'tentative',
    days: ['2026-11-20', '2026-11-23'], first_day: '2026-11-20', last_day: '2026-11-23',
    people: [{ user_id: 'u1', name: 'Henry', role: 'lead_installer', days: [] }, { user_id: 'u2', name: 'Jan', role: 'helper', days: [] }],
    booking_ids: ['a', 'b'], booked_at: '2026-11-16T06:10:00Z',
  }, over || {});
}

async function draw(ins, ctx) {
  BI._reset();
  answer = { install: ins };
  let painted = 0;
  const c = Object.assign({ repaint: () => { painted++; }, currentJobId: () => 'job-1' }, ctx || {});
  BI.html({ id: 'job-1' }, c);
  await flush();
  return { html: BI.html({ id: 'job-1' }, c), painted };
}

test('working days skip the weekend, a weekend start goes to Monday', () => {
  assert.deepEqual(BI._workingDays('2026-11-19', 3), ['2026-11-19', '2026-11-20', '2026-11-23']);
  assert.deepEqual(BI._workingDays('2026-11-21', 1), ['2026-11-23']);
  assert.deepEqual(BI._workingDays('', 2), []);
});

test('the read is dispatch_v2_install with the job id, then a repaint', async () => {
  calls.length = 0;
  const r = await draw(install());
  assert.equal(calls[0].action, 'dispatch_v2_install');
  assert.deepEqual(calls[0].params, { job_id: 'job-1' });
  assert.equal(r.painted, 1);
});

test('not booked: Book install, with the earliest install day beside it', async () => {
  const r = await draw({ job_id: 'job-1', booked: false, state: 'none', days: [], people: [], booking_ids: [] }, { earliest: '2026-11-20' });
  assert.match(r.html, /data-dpc-bi="book"[^>]*>Book install</);
  assert.match(r.html, /Earliest install: Fri 20 Nov/);
  assert.doesNotMatch(r.html, /Confirm/);
});

test('booked tentative: days, crew, Tentative chip, Confirm Move Remove', async () => {
  const r = await draw(install());
  assert.match(r.html, /Fri 20 Nov to Mon 23 Nov \(2 days\)/);
  assert.match(r.html, /Henry, Jan/);
  assert.match(r.html, />Tentative</);
  assert.match(r.html, /data-dpc-bi="confirm"[^>]*>Confirm \(texts crew\)</);
  assert.match(r.html, /data-dpc-bi="move"/);
  assert.match(r.html, /data-dpc-bi="remove"/);
});

test('booked confirmed: Confirmed chip and no Confirm button', async () => {
  const r = await draw(install({ state: 'confirmed', days: ['2026-11-20'] }));
  assert.match(r.html, />Confirmed</);
  assert.match(r.html, /<strong>Fri 20 Nov<\/strong>/);
  assert.doesNotMatch(r.html, /data-dpc-bi="confirm"/);
  assert.match(r.html, /data-dpc-bi="move"/);
});

test('a failed read says so with a Retry', async () => {
  BI._reset();
  globalThis.opsFetch = () => Promise.reject(new Error('down'));
  const c = { repaint: () => {}, currentJobId: () => 'job-1' };
  BI.html({ id: 'job-1' }, c);
  await flush();
  const h = BI.html({ id: 'job-1' }, c);
  assert.match(h, /Could not load the booking/);
  assert.match(h, /data-dpc-bi="read-retry"/);
});

test('an ops-api from before Book install (no install block, or Unknown action) draws nothing', async () => {
  const c = { repaint: () => {}, currentJobId: () => 'job-1' };
  BI._reset();
  globalThis.opsFetch = () => Promise.resolve({});
  BI.html({ id: 'job-1' }, c);
  await flush();
  assert.equal(BI.html({ id: 'job-1' }, c), '');
  BI._reset();
  globalThis.opsFetch = () => { const e = new Error('Unknown action: dispatch_v2_install'); e.status = 400; return Promise.reject(e); };
  BI.html({ id: 'job-1' }, c);
  await flush();
  assert.equal(BI.html({ id: 'job-1' }, c), '');
});

test('names are escaped', async () => {
  globalThis.opsFetch = () => Promise.resolve({ install: install({ people: [{ name: '<b>x</b>' }] }) });
  BI._reset();
  const c = { repaint: () => {}, currentJobId: () => 'job-1' };
  BI.html({ id: 'job-1' }, c);
  await flush();
  assert.doesNotMatch(BI.html({ id: 'job-1' }, c), /<b>x<\/b>/);
});
