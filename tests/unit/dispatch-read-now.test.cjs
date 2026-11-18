// Dispatch v2 item 19 (modules/dispatch-read-now.js): the one line after a
// Read now press, from the ops-api answer (backend contract section 3j).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../modules/dispatch-read-now.js');
const RN = globalThis.OpsDispatchReadNow;

// 06:32 UTC is 2:32pm in Perth.
const AT = '2026-11-18T06:32:05.000Z';
const ANSWER = (over) => Object.assign({
  ok: true, read_at: AT, lane: 'on', reused: false, left_to_sort: 0,
  mail: { status: 'read', emails_read: 4, mailboxes: 11, mailboxes_not_read: 0 },
  replies: { status: 'scanned', stored: 2, matched: 1, needs_confirmation: 1, unmatched: 0, suggestions: 0 },
}, over);

test('the time is Perth time, 12 hour', () => {
  assert.equal(RN.clock(AT), '2:32pm');
  assert.equal(RN.clock('2026-11-18T16:05:00Z'), '12:05am');
  assert.equal(RN.clock('2026-11-18T04:00:00Z'), '12:00pm');
  assert.equal(RN.clock('nope'), '');
});

test('Shaun\'s line: "Read 2:32pm. 2 new supplier emails."', () => {
  assert.equal(RN.lineFor(ANSWER()), 'Read 2:32pm. 2 new supplier emails.');
});

test('one, none, and what is left to sort', () => {
  assert.equal(RN.lineFor(ANSWER({ replies: { status: 'scanned', stored: 1 } })), 'Read 2:32pm. 1 new supplier email.');
  assert.equal(RN.lineFor(ANSWER({ replies: { status: 'scanned', stored: 0 }, left_to_sort: 3 })), 'Read 2:32pm. No new supplier emails. 3 emails to sort.');
  assert.equal(RN.lineFor(ANSWER({ left_to_sort: 1 })), 'Read 2:32pm. 2 new supplier emails. 1 email to sort.');
});

test('a paused capture lane says nothing new was read', () => {
  assert.equal(RN.lineFor(ANSWER({ lane: 'paused', mail: null, replies: null })), 'Read 2:32pm. Email reading is paused, so nothing new was read.');
});

test('slow, failed or switched off Outlook is said plainly', () => {
  assert.equal(RN.lineFor(ANSWER({ mail: { status: 'slow' } })), 'Read 2:32pm. 2 new supplier emails. Outlook was slow, so some new mail may only show at the next read.');
  assert.equal(RN.lineFor(ANSWER({ mail: { status: 'failed', code: 'reader_unreachable' } })), 'Read 2:32pm. 2 new supplier emails. Could not reach Outlook just now.');
  assert.equal(RN.lineFor(ANSWER({ mail: { status: 'off', reason: 'email_reader_v1_off' } })), 'Read 2:32pm. 2 new supplier emails. Outlook reading is switched off.');
  assert.equal(RN.lineFor(ANSWER({ mail: { status: 'read', emails_read: 0, mailboxes: 11, mailboxes_not_read: 1 } })), 'Read 2:32pm. 2 new supplier emails. 1 mailbox will be read at the next run.');
});

test('replies matching off or failed', () => {
  assert.equal(RN.lineFor(ANSWER({ replies: { status: 'off' } })), 'Read 2:32pm. Supplier email matching is switched off.');
  assert.equal(RN.lineFor(ANSWER({ replies: { status: 'failed', code: 'x' } })), 'Read 2:32pm. Could not match supplier emails just now.');
});

test('an answer that is not Read now\'s is a plain failure line, never codes', () => {
  for (const bad of [null, {}, { ok: false }, 'x']) {
    assert.equal(RN.lineFor(bad), 'Could not read the email just now. The board is reloaded with what was already read.');
  }
});

test('the lines carry no em dash', () => {
  const all = [ANSWER(), ANSWER({ lane: 'paused' }), ANSWER({ mail: { status: 'slow' } }), null].map(RN.lineFor).join(' ');
  assert.doesNotMatch(all, new RegExp('\\u2014'));
});
