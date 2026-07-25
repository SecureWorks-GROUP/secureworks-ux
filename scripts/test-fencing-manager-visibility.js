#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');

function block(open, close) {
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  assert(start >= 0 && end > start, `missing ${open}`);
  return html.slice(start + open.length, end);
}

const context = {
  console,
  window: {},
  _isAdmin: false,
  _user: {
    id: 'henry',
    email: 'henry@example.test',
    role: 'lead_installer',
    managed_verticals: ['fencing']
  }
};
vm.createContext(context);
vm.runInContext([
  block('// <trade-visibility-core>', '// </trade-visibility-core>'),
  block('// <calendar-adapter-core>', '// </calendar-adapter-core>'),
  block('// <trade-calendar-source>', '// </trade-calendar-source>'),
  block('// <fencing-board-core>', '// </fencing-board-core>')
].join('\n'), context);

const visibility = {
  managed: context.managedTradeVerticals,
  canEveryone: context.canUseEveryoneLens,
  key: context.tradeSurfaceCacheKey
};
const calendar = context.TradeCalendarSource;
const fencing = context.FencingBoardCore;

assert.deepStrictEqual(Array.from(visibility.managed(context._user)), ['fencing']);
assert.strictEqual(visibility.canEveryone(), true, 'managed-vertical lead gets the explicit Everyone lens');
const allKey = visibility.key('calendar', 'fencing', 'everyone');
const mineKey = visibility.key('calendar', 'fencing', 'mine');
assert.notStrictEqual(allKey, mineKey, 'calendar cache is split by lens');
assert(allKey.includes('henry') && allKey.includes('fencing'), 'calendar cache is split by identity and vertical');
context._user = { id: 'installer', role: 'crew', managed_verticals: [] };
assert.strictEqual(visibility.canEveryone(), false, 'ordinary installer stays own-only');
context._user = { id: 'henry', role: 'lead_installer', managed_verticals: ['fencing'] };

const fencingJob = {
  id: 'fence-1', job_number: 'FENCE-1', type: 'fencing', status: 'scheduled',
  client_name: 'Fence Client', site_suburb: 'Perth'
};
const assigned = {
  id: 'assignment-1', user_id: 'alyx', status: 'confirmed',
  scheduled_date: '2026-07-25', crew_name: 'Alyx', jobs: fencingJob
};
const stalePool = {
  id: 'stale-open', status: 'available', assignment_type: 'fencing_open', jobs: fencingJob
};
const genuinePool = {
  id: 'open-2', status: 'available', assignment_type: 'fencing_open',
  jobs: { ...fencingJob, id: 'fence-2', job_number: 'FENCE-2' }
};
const duplicatePool = { ...genuinePool, id: 'open-2-duplicate' };
const mixed = {
  id: 'patio-1', status: 'scheduled',
  jobs: { id: 'patio-job', job_number: 'PATIO-1', type: 'patio', status: 'scheduled' }
};
const mislabeledPool = {
  id: 'patio-open', status: 'available', assignment_type: 'fencing_open',
  jobs: { id: 'patio-open-job', job_number: 'PATIO-OPEN', type: 'patio', status: 'new' }
};
const unknownStatus = {
  id: 'assignment-future', status: 'future_backend_status',
  jobs: { ...fencingJob, id: 'fence-3', job_number: 'FENCE-3' }
};
const board = fencing.buildBoard({
  today: [assigned, mixed, mislabeledPool, unknownStatus],
  thisWeek: [],
  upcoming: [],
  recent: [],
  makesafePool: [stalePool, genuinePool, duplicatePool]
}, (job, row) => ({ job, row }));
const cards = board.verticals[0].columns.flatMap((column) => column.cards);
assert.strictEqual(cards.length, 3, 'board keeps assigned, genuinely open, and review-required fencing');
assert.strictEqual(cards.filter((card) => card.job.id === 'fence-1').length, 1, 'old assigned work cannot reappear as available');
assert.strictEqual(cards.filter((card) => card.job.id === 'fence-2').length, 1, 'duplicate open rows cannot duplicate a fencing card');
assert.strictEqual(cards.some((card) => card.job.type !== 'fencing'), false, 'other verticals never enter the fencing board');
assert.strictEqual(board.verticals[0].columns.find((column) => column.key === 'attention').cards[0].job.id, 'fence-3',
  'unknown server statuses stay visible in Attention');
assert.deepStrictEqual(Array.from(board.unmappedStatuses), ['future_backend_status']);
assert.strictEqual(fencing.columnOf(assigned), 'scheduled');
assert.strictEqual(fencing.columnOf(genuinePool), 'needs');

const payload = {
  schema: 'trade-calendar.v1',
  mode: 'all',
  type: 'fencing',
  events: [{
    assignment_id: 'assignment-1',
    job_id: 'fence-1',
    user_id: 'alyx',
    job_number: 'FENCE-1',
    client_name: 'Fence Client',
    site_address: '1 Fence Road',
    site_suburb: 'Perth',
    scheduled_date: '2026-07-25',
    scheduled_end: '2026-07-25',
    start_time: '08:00',
    end_time: '16:00',
    crew_name: 'Alyx',
    assigned_to: 'Alyx',
    assignment_type: 'install',
    assignment_status: 'scheduled',
    confirmation_status: 'confirmed',
    job_type: 'fencing',
    job_status: 'scheduled'
  }],
  truncated: false
};
const request = { from: '2026-07-20', to: '2026-08-10', vertical: 'fencing', lens: 'everyone' };
const adapted = calendar.adaptV1(payload, request);
const normalized = calendar.validateModel(adapted, request);
assert.strictEqual(normalized.blocks.length, 1);
assert.strictEqual(normalized.blocks[0].type, 'fencing');
assert.strictEqual(normalized.mode, 'all');
assert.strictEqual(normalized.permissions.sees_all, true);
assert.strictEqual(normalized.truncated, false);

assert.throws(() => calendar.adaptV1({ ...payload, schema: 'calendar.v0' }, request), /schema/);
assert.throws(() => calendar.adaptV1({ ...payload, type: 'patio' }, request), /vertical/);
assert.throws(() => calendar.adaptV1({ ...payload, truncated: undefined }, request), /truncated/);
assert.throws(() => calendar.adaptV1({
  ...payload,
  events: [{ ...payload.events[0], job_type: 'patio' }]
}, request), /outside fencing/);

assert(/api\('trade_calendar', params, null, \{ preserveSessionOnAuthFailure: true \}\)/.test(html),
  'calendar uses the authenticated api helper');
assert(/mode: request\.lens === 'everyone' \? 'all' : 'mine'/.test(html),
  'calendar sends only the published mine or all modes');
assert(/type: 'fencing'/.test(html), 'calendar sends the published fencing type');
assert(/from: request\.from,[\s\S]*to: request\.to/.test(html), 'calendar sends the published inclusive date fields');
assert(/crewNone: isPool \? \(isMs \? 'All make-safe trades' : 'Nobody allocated'\)/.test(html),
  'generic fencing pool cards do not inherit make-safe-only crew copy');
assert(/_lastJobDataKey === activeCacheKey/.test(html),
  'a late projection refresh cannot repaint a broader My Jobs lens');

console.log('fencing manager visibility tests passed');
