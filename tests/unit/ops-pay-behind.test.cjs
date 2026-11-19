const { test } = require('node:test');
const assert = require('node:assert/strict');
const behind = require('../../modules/ops-pay-behind.js');

const trade = {
  user_id: '00000000-0000-4000-8000-000000000001',
  display_name: 'ZZTEST Trade',
  hourly_rate: 'RATELEAK',
  weeks: [
    { week_start: '2026-10-26', invoice_status: 'paid', draft_lines_count: 0, held_lines_count: 0, unpriced_wo_lines_count: 0, amount: 'AMOUNTLEAK' },
    { week_start: '2026-11-02', invoice_status: 'missing', draft_lines_count: 0, held_lines_count: 0, unpriced_wo_lines_count: 0 },
    { week_start: '2026-11-09', invoice_status: 'draft', draft_lines_count: 2, held_lines_count: 0, unpriced_wo_lines_count: 0 },
    { week_start: '2026-11-16', invoice_status: 'held', draft_lines_count: 0, held_lines_count: 3, unpriced_wo_lines_count: 1 }
  ],
  missing_weeks_count: 1,
  unsent_draft_count: 1,
  held_count: 1
};
const answer = {
  ok: true,
  as_of: '2026-11-20',
  weeks: ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'],
  behind_trades: [trade, {
    display_name: 'ZZTEST Lead',
    weeks: [
      { week_start: '2026-11-09', invoice_status: 'submitted', held_lines_count: 0, unpriced_wo_lines_count: 0 },
      { week_start: '2026-11-16', invoice_status: 'approved', held_lines_count: 0, unpriced_wo_lines_count: 0 }
    ],
    missing_weeks_count: 0,
    unsent_draft_count: 0
  }],
  stuck_groups: [{
    group_id: '00000000-0000-4000-8000-0000000000aa',
    job_id: '00000000-0000-4000-8000-0000000000bb',
    job_number: 'ZZTEST-440',
    site_suburb: 'ZZTEST North',
    stuck_step: 'awaiting_others',
    days_stuck: 6,
    crew_missing: [{
      user_id: '00000000-0000-4000-8000-0000000000cc',
      display_name: 'ZZTEST Crew',
      hours_entered: 0,
      hourly_rate: 'RATELEAK'
    }]
  }]
};

test('a live read draws the trades, the six statuses and the stuck group, with no rate or amount', () => {
  assert.equal(behind.classifyRead(answer, null).kind, 'show');
  const html = behind.panelHtml(answer, { tab: 'behind' });
  assert.match(html, /ZZTEST Trade/);
  assert.match(html, /ZZTEST Lead/);
  for (const word of ['Paid', 'Missing', 'Draft', 'Held', 'Submitted', 'Approved']) assert.match(html, new RegExp(word));
  assert.match(html, />1</);
  assert.match(html, />3</);
  assert.match(html, /ZZTEST-440/);
  assert.match(html, /ZZTEST North/);
  assert.match(html, /Waiting on the crew/);
  assert.match(html, /6 days/);
  assert.match(html, /ZZTEST Crew/);
  assert.match(html, /Enter days/);
  assert.doesNotMatch(html, /RATELEAK|AMOUNTLEAK|hourly_rate/);
});

test('a refusal, a missing action and enabled false draw nothing', () => {
  for (const status of [403, 404]) {
    assert.equal(behind.classifyRead(null, Object.assign(new Error('no'), { status })).kind, 'hidden');
  }
  assert.equal(behind.classifyRead(null, Object.assign(new Error('Unknown action'), { status: 400 })).kind, 'hidden');
  assert.equal(behind.classifyRead({ enabled: false, behind_trades: answer.behind_trades }, null).kind, 'hidden');
  assert.equal(behind.classifyRead(null, Object.assign(new Error('down'), { status: 503 })).kind, 'error');
});

test('the day entry reason is 3 to 500 characters and the body carries times, not a bare hours number', () => {
  const days = [{ work_date: '2026-11-18', start_time: '07:00', finish_time: '15:00', break_minutes: '30' }];
  const id = ['00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000cc'];
  assert.match(behind.entryFromDays(id[0], id[1], days, 'ab').error, /3 to 500/);
  assert.match(behind.entryFromDays(id[0], id[1], days, 'x'.repeat(501)).error, /3 to 500/);
  const built = behind.entryFromDays(id[0], id[1], days, 'ZZTEST they worked this day and did not enter it');
  assert.equal(built.error, undefined);
  assert.equal(built.body.reason.length >= 3 && built.body.reason.length <= 500, true);
  assert.deepEqual(built.body.entries, [{ work_date: '2026-11-18', start_time: '07:00', finish_time: '15:00', break_minutes: 30 }]);
  assert.equal('hours' in built.body, false);
  assert.equal(behind.hoursBetween('07:00', '15:00', 30), 7.5);
  assert.match(behind.entryFromDays(id[0], id[1], [
    { work_date: '2026-11-18', start_time: '07:00', finish_time: '15:00' },
    { work_date: '2026-11-18', start_time: '08:00', finish_time: '12:00' }
  ], 'ZZTEST same day twice').error, /entered twice/);
});

test('a switched-off day entry is the plain sentence', () => {
  const err = Object.assign(new Error('The office cannot enter crew days yet: it is switched off.'), {
    status: 409,
    code: 'group_office_day_entry_disabled',
    body: { code: 'group_office_day_entry_disabled', error: 'The office cannot enter crew days yet: it is switched off.' }
  });
  assert.equal(behind.isOfficeEntryOff(err), true);
  assert.equal(behind.failureText(err), 'Office day entry is currently switched off');
  assert.equal(behind.failureText(Object.assign(new Error('That person is not on this group\'s crew.'), { status: 409, code: 'group_office_target_not_member' })), 'That person is not on this group\'s crew.');
});
