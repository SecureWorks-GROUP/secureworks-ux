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
  block('// <friendly-error>', '// </friendly-error>'),
  block('// <calendar-adapter-core>', '// </calendar-adapter-core>'),
  block('// <makesafe-trade-v5>', '// </makesafe-trade-v5>'),
  block('// <calendar-renderers>', '// </calendar-renderers>')
].join('\n'), context);
const V5 = context.MakesafeTradeV5;
const CR = context.CalRender;

function mockResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 403 ? 'Forbidden' : (status === 401 ? 'Unauthorized' : 'Service Unavailable'),
    json: () => Promise.resolve(body || {})
  };
}

async function mockedFeedFailure(statuses) {
  let refreshes = 0, logouts = 0, expiryHandlers = 0;
  const requests = [];
  const responses = statuses.map(status => mockResponse(status, {
    error: status === 403 ? 'trade projection requires an authenticated trade session' :
      (status === 401 ? 'Invalid JWT' : 'Temporary upstream failure')
  }));
  const apiContext = {
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    // foreign-job-readonly exports helpers on window for regression pins
    window: {},
    _opsApiBase: 'https://example.supabase.co/functions/v1/ops-api',
    _swApiKey: 'test-api-key',
    _cachedAccessToken: 'signed-in-jwt',
    getAuthToken: () => Promise.resolve('signed-in-jwt'),
    fetch: (url, opts) => {
      requests.push({ url, opts });
      const response = responses.shift();
      assert(response, 'unexpected extra feed request');
      return Promise.resolve(response);
    },
    cloud: { supabase: { auth: { refreshSession: () => {
      refreshes++;
      return Promise.resolve({ data: { session: { access_token: 'refreshed-jwt' } } });
    } } } },
    _forceLogout: () => { logouts++; },
    handleSessionExpiry: () => { expiryHandlers++; },
    // api() runs the view-only guard before every request, so the sandbox needs
    // the real guard plus its scope: no job open, nothing to block.
    _user: null,
    _currentJob: null,
    getTradeJobType: () => 'makesafe',
    toast: () => {}
  };
  vm.createContext(apiContext);
  vm.runInContext([
    block('// <foreign-job-readonly>', '// </foreign-job-readonly>'),
    block('// <trade-api-helper>', '// </trade-api-helper>')
  ].join('\n'), apiContext);
  let error = null;
  try {
    await apiContext.api('makesafe_board', { projection: 'trade' }, null, { preserveSessionOnAuthFailure: true });
  } catch (err) {
    error = err;
  }
  assert(error, 'mocked failed feed must reject');
  return { error, refreshes, logouts, expiryHandlers, requests };
}

async function testFeedFailureStates() {
  const forbidden = await mockedFeedFailure([403]);
  assert.strictEqual(forbidden.error.status, 403);
  assert.strictEqual(forbidden.error.code, 'access_denied');
  assert.strictEqual(forbidden.refreshes, 0, '403 role rejection must not refresh a valid JWT');
  assert.strictEqual(forbidden.logouts, 0, '403 feed rejection must never log the user out');
  assert.strictEqual(forbidden.expiryHandlers, 0, '403 feed rejection must not enter session-expiry handling');
  assert.strictEqual(forbidden.requests[0].opts.headers.Authorization, 'Bearer signed-in-jwt');
  const accessHTML = V5.failureHTML(forbidden.error, 'calendar', 'renderNewCalendar()', 'emptyview');
  const boardAccessHTML = V5.failureHTML(forbidden.error, 'board', '_loadBoard(true)', 'empty-state');
  for (const rendered of [accessHTML, boardAccessHTML]) {
    assert(rendered.includes('data-feed-failure="access"'));
    assert(rendered.includes('No trade access for this account'));
    assert(rendered.includes('Sign in with another account'));
    assert(!rendered.includes('>Retry<'), 'role rejection is not masked as a transient retry state');
  }

  const expired = await mockedFeedFailure([401, 401]);
  assert.strictEqual(expired.refreshes, 1, '401 feed failure refreshes exactly once');
  assert.strictEqual(expired.logouts, 0, 'failed feed refresh must not log the user out');
  assert.strictEqual(expired.error.code, 'auth_expired');
  const authHTML = V5.failureHTML(expired.error, 'calendar', 'renderNewCalendar()', 'emptyview');
  assert(authHTML.includes('data-feed-failure="auth"'));
  assert(authHTML.includes('Please sign in again'));

  const transient = await mockedFeedFailure([503]);
  assert.strictEqual(transient.logouts, 0, 'transient feed failure must not log the user out');
  const retryHTML = V5.failureHTML(transient.error, 'calendar', 'renderNewCalendar()', 'emptyview');
  assert(retryHTML.includes('data-feed-failure="transient"'));
  assert(retryHTML.includes('>Retry<'), 'transient calendar failure keeps the retry pattern');

  const droppedSignal = V5.failureHTML(new Error('Failed to fetch'), 'calendar', 'renderNewCalendar()', 'emptyview');
  assert(droppedSignal.includes('data-feed-failure="transient"'));
  assert(droppedSignal.includes('No internet connection'), 'transient failures map raw network errors through friendlyError');
  assert(!droppedSignal.includes('Failed to fetch'), 'transient failures never surface the raw fetch error string');
}

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
assert.strictEqual(V5.VERSION, 'makesafe-board.v1.2');
assert.doesNotThrow(() => V5.validate(payload), 'v1 fixtures remain accepted');
const v12Payload = JSON.parse(JSON.stringify(payload));
v12Payload.contract_version = 'makesafe-board.v1.2';
v12Payload.parity.contract_version = 'makesafe-board.v1.2';
assert.doesNotThrow(() => V5.validate(v12Payload), 'live v1.2 feed is accepted');
const v0Payload = JSON.parse(JSON.stringify(payload));
v0Payload.contract_version = 'makesafe-board.v0';
assert.throws(() => V5.validate(v0Payload), /Unsupported make-safe board feed/);
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

assert(/api\('makesafe_board', \{ projection: 'trade' \}, null, \{ preserveSessionOnAuthFailure: true \}\)/.test(html), 'canonical trade projection preserves the signed-in session on auth failure');
assert(!/MS_COLUMN_OVERRIDE|COLUMNS_MAKESAFE/.test(html), 'assignment-derived make-safe columns are retired');
assert(/NC = \{ calView: 'cal', scale: 'day', axis: 'jobs'/.test(html), 'job-based Today is the calendar default');
assert(/function ncBoardAllowed\(\) \{ return !!\(NC\.model && NC\.model\.permissions/.test(html), 'calendar action rights come from feed permissions');
assert(/_boardCache\.permissions && _boardCache\.permissions\.can_allocate/.test(html), 'board action rights come from feed permissions');
assert(/_boardBtn\.style\.display = ''/.test(html), 'server-filtered board is visible to ordinary allocated-only trades');
assert(/MakesafeTradeV5\.failureHTML\(err, 'board', '_loadBoard\(true\)'/.test(html), 'board failures use the shared access/auth/retry state renderer');
const fetchBody = html.slice(html.indexOf('async function caFetchCalendarModel'), html.indexOf('// ══════════════════════════════════════════════════════════════════════\n  // M2 U2'));
assert(!/api\('calendar'/.test(fetchBody), 'make-safe calendar no longer reads the legacy calendar feed');
testFeedFailureStates().then(() => {
  console.log('make-safe trade v5 tests passed');
}).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
