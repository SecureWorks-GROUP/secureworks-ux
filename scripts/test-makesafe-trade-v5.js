#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'trade.html'), 'utf8');

function block(open, close) {
  const a = html.indexOf(open), b = html.indexOf(close);
  assert(a >= 0 && b > a, `missing ${open}`);
  return html.slice(a + open.length, b);
}
const context = { console };
vm.createContext(context);
vm.runInContext([
  block('// <calendar-adapter-core>', '// </calendar-adapter-core>'),
  block('// <makesafe-trade-v5>', '// </makesafe-trade-v5>'),
  block('// <calendar-renderers>', '// </calendar-renderers>')
].join('\n'), context);
const V5 = context.MakesafeTradeV5;
const CR = context.CalRender;

const actions = {
  call: { available: true, href: 'tel:0400111222', unavailable_reason: null },
  navigate: { available: true, href: 'https://www.google.com/maps/search/?api=1&query=10%20Sample%20Street', unavailable_reason: null },
  text: { available: true, href: 'sms:0400111222', unavailable_reason: null }
};
function row(id, column, assignment = {}) {
  return {
    contract_version: 'makesafe-board.v1', id, job_number: `SWMS-${id}`, type: 'makesafe',
    makesafe_type: 'Roof report', column, canonical_stage: column === 'New' ? 'new' : 'allocated',
    job_state: 'scheduled', substatus: 'waiting_on_trade_report',
    builder: { name: 'ML Builders', external_ref: 'MLB-100' },
    contact: { client_name: 'Kim Client', phone: '0400 111 222', address: '10 Sample Street, Perth WA 6000', actions },
    assignments: assignment === null ? [] : [{ assignment_id: `a-${id}`, user_id: assignment.user_id || 'hugo', name: Object.prototype.hasOwnProperty.call(assignment, 'name') ? assignment.name : 'Hugo', status: assignment.status || 'complete', scheduled_date: '2026-07-21', start_time: '09:00' }],
    report: { state: 'waiting_on_trade_report', submitted_at: null, photo_count: 0 }, pack: { state: 'not_started' },
    notes: [{ id: 'n1', text: 'Client confirmed access', author: 'Hugo', created_at: '2026-07-20T08:00:00Z' }],
    lineage: { builder_po_number: `PO-${id}`, siblings: [] }, age: { age_hours: 30, age_days: 1 }, blockers: { real: [], stale_artifacts: [] }
  };
}
const allocated = row('allocated', 'Allocated'); // assignment says complete on purpose
const nobody = row('nobody', 'New', { name: null, user_id: null, status: 'scheduled' });
const unscheduled = row('unscheduled', 'New', null);
const payload = {
  contract_version: 'makesafe-board.v1', projection: 'trade', generated_at: '2026-07-20T10:00:00Z',
  columns: { New: [nobody, unscheduled], Allocated: [allocated], Complete: [row('complete', 'Complete')], Archive: [row('archive', 'Archive')] },
  rows: [], permissions: { visibility: 'all_makesafes', sees_all_makesafes: true, can_allocate: true },
  unmapped_stage_job_ids: [], parity: { ok: true, contract_version: 'makesafe-board.v1' }
};

assert.deepStrictEqual(Array.from(V5.COLUMNS), ['New', 'Allocated', 'Complete', 'Archive']);
const board = V5.board(payload);
assert.strictEqual(board.columns[1].cards[0].id, 'allocated', 'server Allocated wins over assignment complete');
assert(!board.columns.some(c => /office/i.test(c.label)), 'no office column');

const exactHrefs = [actions.call.href, actions.navigate.href, actions.text.href];
for (const surface of ['board-card', 'job-detail', 'calendar-card', 'calendar-agenda', 'calendar-run', 'calendar-sheet', 'calendar-nobody']) {
  const rendered = V5.contactActionsHTML(allocated, surface);
  for (const href of exactHrefs) assert(rendered.includes(`href="${V5.esc(href)}"`), `${surface} uses exact feed href ${href}`);
  assert.strictEqual((rendered.match(/data-feed-href="true"/g) || []).length, 3, `${surface} has three feed-linked actions`);
  assert(rendered.includes(`data-contact-surface="${surface}"`));
}

const blocks = V5.calendarBlocks(payload);
const model = { blocks, people: context.CalAdapterCore.buildPeople([], blocks), unscheduledRows: [unscheduled], today: '2026-07-21', now: 10 };
const baseState = { calView: 'cal', scale: 'day', axis: 'jobs', type: 'makesafe', scope: 'everyone', date: '2026-07-21', month: '2026-07-01', me: { id: 'hugo', name: 'Hugo' }, boardAllowed: true };
for (const [name, state] of [
  ['job day', baseState],
  ['crew day', { ...baseState, axis: 'crew' }],
  ['job week', { ...baseState, scale: 'week' }],
  ['run sheet', { ...baseState, calView: 'run' }]
]) {
  const rendered = CR.render(model, state);
  assert(rendered.includes(V5.esc(actions.call.href)), `${name} renders feed Call`);
  assert(rendered.includes(V5.esc(actions.navigate.href)), `${name} renders feed Navigate`);
  assert(rendered.includes(V5.esc(actions.text.href)), `${name} renders feed Text`);
}
const weekCrew = CR.render(model, { ...baseState, axis: 'crew', scale: 'week' });
assert(weekCrew.includes('Nobody'), 'crew calendar retains Nobody row');
assert(weekCrew.includes('no day set'), 'crew calendar retains undated jobs without inventing a date');

const missing = row('missing', 'New', null);
missing.contact = {
  client_name: null, phone: null, address: null,
  actions: {
    call: { available: false, href: null, unavailable_reason: 'No client phone on file' },
    navigate: { available: false, href: null, unavailable_reason: 'No site address on file' },
    text: { available: false, href: null, unavailable_reason: 'No client phone on file' }
  }
};
const missingHTML = V5.contactActionsHTML(missing, 'board-card');
assert(missingHTML.includes('aria-disabled="true"'));
assert(missingHTML.includes('No client phone on file'));
assert(missingHTML.includes('No site address on file'));

const broken = JSON.parse(JSON.stringify(payload));
broken.columns.Allocated[0].contact.actions.call = { available: true, href: 'tel:', unavailable_reason: null };
assert.throws(() => V5.validate(broken), /broken call contact action/);
const duplicate = JSON.parse(JSON.stringify(payload));
duplicate.columns.New.push(duplicate.columns.Allocated[0]);
assert.throws(() => V5.validate(duplicate), /Duplicate make-safe card|feed column mismatch/);
const parityBroken = JSON.parse(JSON.stringify(payload));
parityBroken.parity.ok = false;
assert.throws(() => V5.validate(parityBroken), /parity/);

allocated.pricing_json = { total: 999 };
allocated.trade_invoices = [{ amount: 999 }];
allocated.report.portal_url = 'https://roof.example/report/allocated';
const card = V5.cardBodyHTML(allocated);
assert(!/999|pricing|invoice/i.test(card), 'trade v5 card never renders pricing or invoices');
assert(V5.portalHTML(allocated, 'board-card').includes('https://roof.example/report/allocated'), 'roof portal renders when the feed exposes it');

assert(/api\('makesafe_board', \{ projection: 'trade' \}\)/.test(html), 'canonical trade projection is fetched');
assert(!/MS_COLUMN_OVERRIDE|COLUMNS_MAKESAFE/.test(html), 'assignment-derived make-safe columns are retired');
assert(/NC = \{ calView: 'cal', scale: 'day', axis: 'jobs'/.test(html), 'job-based Today is the calendar default');
assert(/function ncBoardAllowed\(\) \{ return !!\(NC\.model && NC\.model\.permissions/.test(html), 'calendar action rights come from feed permissions');
assert(/_boardCache\.permissions && _boardCache\.permissions\.can_allocate/.test(html), 'board action rights come from feed permissions');
assert(/_boardBtn\.style\.display = ''/.test(html), 'server-filtered board is visible to ordinary allocated-only trades');
assert(/Could not load the make-safe board[\s\S]*Retry/.test(html), 'board failure is distinct and retryable');
const fetchBody = html.slice(html.indexOf('async function caFetchCalendarModel'), html.indexOf('// ══════════════════════════════════════════════════════════════════════\n  // M2 U2'));
assert(!/api\('calendar'/.test(fetchBody), 'make-safe calendar no longer reads the legacy calendar feed');
console.log('make-safe trade v5 tests passed');
