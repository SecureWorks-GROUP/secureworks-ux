#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');
const open = '// <trade-reportdone>';
const close = '// </trade-reportdone>';
const start = html.indexOf(open);
const end = html.indexOf(close);

assert(start >= 0 && end > start, 'trade report-done sentinels exist');

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(start + open.length, end), context);

const core = context.ReportDoneCore;
assert(core, 'ReportDoneCore is extracted from the shipped trade app');

const unverifiedDoneLookingDetails = [
  { cycle_number: 1, substatus: 'ready_to_invoice' },
  { cycle_number: 1, substatus: 'admin_to_send_report', report_received_at: '2026-08-01T00:00:00Z' },
  { cycle_number: 1, substatus: 'complete', report_on_portal: true }
];

for (const detail of unverifiedDoneLookingDetails) {
  assert.strictEqual(
    core.isMarkedDone(detail),
    false,
    'substatus, report_received_at and report_on_portal never replace current-cycle verification'
  );
}

assert.strictEqual(core.isMarkedDone({
  cycle_number: 2,
  portal_verified_at: '2026-08-01T00:00:00Z',
  portal_verified_cycle: 2
}), true, 'current-cycle portal verification hides the confirmation control');

assert.strictEqual(core.isMarkedDone({
  cycle_number: 2,
  portal_verified_at: '2026-07-01T00:00:00Z',
  portal_verified_cycle: 1
}), false, 'a prior-cycle portal verification does not hide the confirmation control');

const sealedCapture = {
  cycle_number: 2,
  attendance_cycle_id: 'cycle-current',
  portal_captures: [{
    attendance_cycle_id: 'cycle-current',
    capture_result: 'done',
    status: 'verified',
    screenshot_object_key: 'makesafe-docket-artifacts/portal-captures/example.png'
  }]
};
assert.strictEqual(core.isMarkedDone(sealedCapture), true, 'a sealed current-cycle done capture hides the confirmation control');

sealedCapture.portal_captures[0].attendance_cycle_id = 'cycle-prior';
assert.strictEqual(core.isMarkedDone(sealedCapture), false, 'a prior-cycle sealed capture does not hide the confirmation control');

const unverifiedModel = {
  jobId: 'synthetic-roof-1',
  label: 'Roof Report',
  done: false,
  portalUrl: 'https://example.invalid/share/aged-link'
};
const unverifiedHtml = core.panelHTML(unverifiedModel);
assert(unverifiedHtml.includes('id="reportDoneAskBtn"'), 'unverified cards render the confirmation button');
assert(!unverifiedHtml.includes('id="reportDoneAskBtn" disabled'), 'the confirmation button remains enabled for an aged share link');
assert(unverifiedHtml.includes('If the link has expired'), 'the trade sees the aged-link resend guidance');

const verifiedHtml = core.panelHTML({ ...unverifiedModel, done: true });
assert(!verifiedHtml.includes('id="reportDoneAskBtn"'), 'verified cards do not render the confirmation button');
assert(verifiedHtml.includes('Report completed on builder portal'), 'verified cards render the completion state');

console.log('PASS Trade App portal confirmation visibility regressions');
