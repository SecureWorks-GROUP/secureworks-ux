const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '../..');
const week = JSON.parse(fs.readFileSync(path.join(rootDir, 'modules/nithin-week-proposals.json'), 'utf8'));
const source = fs.readFileSync(path.join(rootDir, 'modules/ops-sales-week-host.js'), 'utf8');
const opsHtml = fs.readFileSync(path.join(rootDir, 'ops.html'), 'utf8');

function host() {
  const context = { document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } } };
  vm.runInNewContext(source, context);
  return context.OpsSalesWeekHost;
}

test('proposed week is 14-18 Sep with existing vs tentative distinct and leave not free', () => {
  assert.equal(week.week, '2026-09-14/2026-09-18');
  assert.equal(week.scoper.id, 'nithin');
  assert.equal(week.existing_commitments.length, 5);
  assert.equal(week.tentative_placements.filter(p => p.persisted_on_4180).length, 4);
  assert.equal(week.desk_rules.no_wednesday, true);
  assert.equal(week.leave.state, 'incomplete');
  assert.equal(week.travel.state, 'unavailable');
  assert.equal(week.send, 'held');
  assert.equal(week.kind, 'tentative');
  const html = host().overlayHTML(week);
  assert.match(html, /data-kind="existing_calendar"/);
  assert.match(html, /data-kind="tentative"/);
  assert.match(html, /Unread or incomplete leave is not free capacity/);
  assert.match(html, /Travel minutes unavailable/);
  assert.match(html, /495 opportunities are not 495 jobs/);
  assert.match(html, /476 customers/);
  assert.match(html, /1 waiting_reply/);
  assert.match(html, /e26c908e is 4180 author evidence only/);
  assert.match(html, /Wednesday is empty by patio desk rule/);
  assert.match(html, /held on 4180/);
  assert.match(html, /data-kind="unplaced"/);
  assert.match(html, /Send and calendar writes held/);
  assert.match(html, /not Ready/);
});

test('Needs Scoper item stays open and client send is not approved', () => {
  const item = week.needs_scoper[0];
  assert.equal(item.item_id, '69f6b4c4-ca2b-48cd-a1ed-99bc01ba03e5');
  assert.equal(item.status, 'open');
  assert.equal(item.client_send_approved, false);
  const html = host().overlayHTML(week);
  assert.match(html, /Needs Scoper/);
  assert.match(html, /battens and shadecloth/);
  assert.match(html, /client_send_approved=false/);
});

test('scoper answer posts held fake path and refuses client forward', async () => {
  const context = {
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } },
    opsPost: async (action, body) => {
      assert.equal(action, 'sales_booking_needs_scoper_answer');
      assert.equal(body.fake, true);
      return { ok: true, status: 'closed', client_send: 'held', forwarded_to_client: false };
    }
  };
  vm.runInNewContext(source, context);
  const result = await context.OpsSalesWeekHost.answer('69f6b4c4-ca2b-48cd-a1ed-99bc01ba03e5', 'Yes if the posts are sound.');
  assert.equal(result.forwarded_to_client, false);
  assert.equal(result.client_send, 'held');
});

test('ops.html mounts the week board on the Booking tab', () => {
  assert.match(opsHtml, /id="salesWeekBoard"/);
  assert.match(opsHtml, /ops-sales-week-host\.js/);
});
