const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(resolve(__dirname, '../../modules/ops-job-overview-v2.js'), 'utf8');
const core = vm.runInNewContext(source + '\nJobOverviewV2Core');
const money = { source: 'job_profit', lines: ['Margin: $123.45 ex GST.'] };

test('the stored book shows the snapshot instant at Perth midnight', () => {
  const book = core.storyBook({ money: { ...money, computed_at: '2026-11-17T16:00:00Z' } });
  assert.equal(book.asAt, 'as at 18 Nov 2026, 12:00am Perth time');
  assert.equal(book.lines[0], money.lines[0]);
});

test('live or unreadable snapshot times leave the figures unstamped', () => {
  for (const computed_at of [undefined, null, '', 'invalid', '2026-11-18', '2026-11-18T12:00:00']) {
    assert.equal(core.storyBook({ money: { ...money, computed_at } }).asAt, '');
  }
  assert.equal(core.storyBook({}), null);
});
