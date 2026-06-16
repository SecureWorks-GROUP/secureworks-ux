// Standalone smoke test for the MakeSafe Reporting cockpit module.
//
// The ops dashboard has no JS test runner; the intake cockpit ships a manual
// console-smoke comment only. This is a stricter, automated smoke for the
// MONEY/COMMS-critical reporting cockpit: it evals the module in a stubbed
// browser-ish global scope and asserts the gate-critical wiring WITHOUT a real
// browser, real DOM, or real network.
//
// Run:  node modules/ops-makesafe-reporting-cockpit.smoke.mjs
// Exit code 0 == pass, 1 == fail.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'ops-makesafe-reporting-cockpit.js');
const code = readFileSync(SRC, 'utf8');

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log('  ok  - ' + name);
  } else {
    console.log('  FAIL - ' + name);
    failures++;
  }
}

// ── 1. Capture the recorded opsPost call + toasts via a stubbed global scope ──
const calls = { opsPost: [], opsFetch: [], toasts: [], confirms: [] };

// A minimal DOM stub: getElementById returns a recording element; the approve
// button element lets us drive the disabled/textContent path.
function makeEl() {
  return {
    _html: '',
    style: {},
    disabled: false,
    textContent: '',
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
  };
}
const elements = {};
const documentStub = {
  getElementById: (id) => (elements[id] ||= makeEl()),
};

// Mutable behaviour holders so the test can swap what opsFetch returns AFTER
// the module has closed over the stub (the module captures these wrappers by
// reference; the wrappers delegate to the holder, which the test can repoint).
const behaviour = {
  fetchResult: { drafts: [] },
  postResult: { success: true, status: 'sent', invoice_number: 'INV-1' },
  confirmReturns: true,
};
const sandbox = {
  document: documentStub,
  opsFetch: (action, params) => { calls.opsFetch.push({ action, params }); return Promise.resolve(behaviour.fetchResult); },
  opsPost: (action, body) => { calls.opsPost.push({ action, body }); return Promise.resolve(behaviour.postResult); },
  showToast: (msg, kind) => { calls.toasts.push({ msg, kind }); },
  confirm: (msg) => { calls.confirms.push(msg); return behaviour.confirmReturns; },
  escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  escapeAttr: (s) => String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/&/g, '&amp;'),
  module: undefined,
  console,
};

// Eval the module body inside the sandbox, exposing its top-level functions by
// returning them. We append a return-map so the IIFE hands them back.
const exposed = [
  'loadMakesafeReportingCockpit',
  'renderMsReportingCard',
  'showMsReportingDetail',
  'renderMsReportingPdf',
  'showMsReportingDetailEmpty',
  'approveMakesafeReportPack',
  'refreshMsReportingBadge',
  '_msReportingSubjectHasReviewMarker',
];
const wrapped = '"use strict";\n' + code + '\nreturn { ' + exposed.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ') + ', _msReportingCache: typeof _msReportingCache !== "undefined" ? _msReportingCache : undefined };';

const argNames = Object.keys(sandbox);
const argVals = argNames.map((k) => sandbox[k]);
let mod;
try {
  // eslint-disable-next-line no-new-func
  mod = new Function(...argNames, wrapped)(...argVals);
} catch (e) {
  console.log('  FAIL - module evaluates without throwing: ' + e.message);
  process.exit(1);
}

console.log('MakeSafe Reporting cockpit smoke test');

// ── 2. Key functions exist ──
check('defines loadMakesafeReportingCockpit', typeof mod.loadMakesafeReportingCockpit === 'function');
check('defines renderMsReportingCard', typeof mod.renderMsReportingCard === 'function');
check('defines showMsReportingDetail', typeof mod.showMsReportingDetail === 'function');
check('defines approveMakesafeReportPack', typeof mod.approveMakesafeReportPack === 'function');
check('defines refreshMsReportingBadge', typeof mod.refreshMsReportingBadge === 'function');

// ── 4. The detail renderer references photos + line items + BOTH pdf urls ──
const fixture = {
  job_id: 'job-1',
  job_number: 'MS-100',
  builder: 'MLB Constructions',
  external_ref: 'MLB-25248',
  client_name: 'Jane Homeowner',
  site_address: '12 Smith Street, Joondalup',
  site_suburb: 'Joondalup',
  recipient_email: 'accounts@mlb.com.au',
  invoice: {
    invoice_number: 'INV-1234',
    status: 'DRAFT',
    total_ex_gst: 100,
    total_inc_gst: 110,
    lines: [{ description: 'Temp fence hire', quantity: 2, unit_price: 50, line_total: 100 }],
    lines_unavailable: false,
  },
  report_pdf_url: 'https://example.com/report.pdf',
  invoice_pdf_url: 'https://example.com/invoice.pdf',
  photos: [{ url: 'https://example.com/p1.jpg', thumbnail_url: 'https://example.com/p1t.jpg', label: 'front' }],
  default_subject: 'Make Safe Completion - MLB-25248 - 12 Smith Street, Joondalup',
  default_html_body: '<p>hello builder</p>',
};
// ── 3. loadMakesafeReportingCockpit calls the read endpoint AND populates the
//    module's internal cache (load reassigns the cache var, so we seed THROUGH
//    load by stubbing opsFetch to return our fixture, then render from cache). ──
behaviour.fetchResult = { drafts: [fixture] };
await mod.loadMakesafeReportingCockpit();
check('loadMakesafeReportingCockpit calls opsFetch(makesafe_report_drafts)',
  calls.opsFetch.some((c) => c.action === 'makesafe_report_drafts'));
check('a card is rendered into the list body for the loaded pack',
  (elements['msReportingListBody']._html || '').includes('MLB Constructions'));

mod.showMsReportingDetail('job-1');
const detailHtml = elements['msReportingDetailPanel']._html || '';
check('detail renders the evidence photo url', detailHtml.includes('https://example.com/p1') );
check('detail renders the invoice line item description', detailHtml.includes('Temp fence hire'));
check('detail renders the report PDF url in an iframe', detailHtml.includes('https://example.com/report.pdf') && detailHtml.includes('<iframe'));
check('detail renders the invoice PDF url', detailHtml.includes('https://example.com/invoice.pdf'));
check('detail shows the recipient email', detailHtml.includes('accounts@mlb.com.au'));
check('detail shows the inc-GST total', detailHtml.includes('$110.00'));
check('detail has an Approve and send pack button', detailHtml.includes('Approve and send pack'));

// ── 5. Approve fires makesafe_send_pack with the gate-passing default subject ──
await mod.approveMakesafeReportPack('job-1');
const sendCall = calls.opsPost.find((c) => c.action === 'makesafe_send_pack');
check('approve calls opsPost(makesafe_send_pack)', !!sendCall);
check('approve confirms before sending', calls.confirms.length > 0);
if (sendCall) {
  check('send body carries the recipient_email', sendCall.body.recipient_email === 'accounts@mlb.com.au');
  check('send body carries pack_kind=main', sendCall.body.pack_kind === 'main');
  check('send body carries a subject + html_body', !!sendCall.body.subject && !!sendCall.body.html_body);
}

// ── 6. GATE ANTIDOTE - the composer refuses a review-marker subject ──
const REVIEW_MARKERS = ['TEST', 'ROUND', 'DRAFT', 'REVIEW', 'INTERNAL', 'PREVIEW'];
let markerCaught = true;
for (const marker of REVIEW_MARKERS) {
  if (!mod._msReportingSubjectHasReviewMarker('Make Safe ' + marker + ' Completion')) markerCaught = false;
}
check('subject marker guard catches every review marker token', markerCaught);
// A clean subject is allowed; a substring (PROTESTING) is not a whole token.
check('subject marker guard allows a clean subject', !mod._msReportingSubjectHasReviewMarker('Make Safe Completion - MLB-25248'));
check('subject marker guard ignores substrings (PROTESTING != TEST)', !mod._msReportingSubjectHasReviewMarker('PROTESTING site works'));

// A marker-laden subject must NOT reach opsPost. Seed job-2 THROUGH load (the
// cache var is reassigned by load, so a direct cache poke would miss it).
calls.opsPost.length = 0;
calls.toasts.length = 0;
const job2 = Object.assign({}, fixture, { job_id: 'job-2', default_subject: 'Make Safe DRAFT Completion' });
behaviour.fetchResult = { drafts: [job2] };
await mod.loadMakesafeReportingCockpit();
await mod.approveMakesafeReportPack('job-2');
check('approve REFUSES to send a review-marker subject (no opsPost)',
  !calls.opsPost.some((c) => c.action === 'makesafe_send_pack'));
check('approve surfaces an error toast on the refusal', calls.toasts.some((t) => t.kind === 'error'));

// ── 7. The module source never hard-codes a review-marker filename/subject ──
// (defence: nothing in the composer emits a literal marker into a name/subject)
const offending = ['"TEST', 'TEST"', '"DRAFT', '"REVIEW', '"PREVIEW', '"INTERNAL', '"ROUND'];
check('module source does not hardcode a review-marker literal in copy',
  !offending.some((s) => code.includes(s)));

console.log('');
if (failures) {
  console.log('SMOKE FAILED: ' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('SMOKE PASSED: all checks ok.');
  process.exit(0);
}
