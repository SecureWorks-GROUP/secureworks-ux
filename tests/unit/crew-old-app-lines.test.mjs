import assert from 'node:assert/strict';
const m = await import(new URL('../../crew/js/lib/invoice.js', import.meta.url).href);
const b = { invRows: [
  { _source: 'manual', date: '2026-11-11', job_text: 'SWP-ZZ01', hours: 8.75, rate: 35, amount: 306.25, start_time: '08:00', description: 'ZZ site' },
  { _source: 'manual', date: '', hours: 0, amount: 0, job_text: '', description: '', start_time: '' },
  { _source: 'clock', date: '2026-11-18', job_text: 'SWP-ZZ02', hours: 6, amount: 210, start_time: '12:00', description: 'ZZ' },
  { _source: 'clock', hours: 0, job_text: 'SWP-ZZ03' },
  { _source: 'crew_app', amount: 40, description: 'keep', crew_line: { key: 'k' } } ],
  jobCards: [ { job_number: 'SWF-ZZ04', travel_amount: 40, wo_lump_lines: [] }, { job_number: 'SWF-ZZ05', wo_lump_lines: [{ amount: 300 }] }, { job_number: 'SWF-ZZ06', travel_amount: 150, included: false }, { job_number: 'SWF-ZZ07' } ] };
const l = m.oldAppLines(b); console.log(l);
assert.equal(l.length, 4); assert.equal(m.foreignDraftLines(b), 4);
const c = m.withoutOldAppLines(b);
assert.equal(m.foreignDraftLines(c), 0);
assert.equal(c.invRows.length, 3); assert.ok(c.invRows.some((r) => r._source === 'crew_app'));
assert.equal(c.jobCards[0].travel_amount, null); assert.deepEqual(c.jobCards[1].wo_lump_lines, []); assert.equal(c.jobCards[2].travel_amount, 150);
assert.equal(m.lineProblem({ kind: 'deduction', amount: 5, description: 'x' }, { monday: '2026-11-09' }), 'This cannot be sent. Remove it and tell the office');
console.log('ok');
