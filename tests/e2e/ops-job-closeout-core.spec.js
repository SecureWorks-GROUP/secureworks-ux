// Paid close-out tags and the Get Review ladder: the pure rules
// (docs/job-closeout-screens.md).
// ---------------------------------------------------------------------------
// Pure node, no browser: this spec READS ../../modules/ops-job-closeout.js, takes the
// code between `// <job-closeout-core>` and `// </job-closeout-core>`, and runs it, so
// every assertion is against the shipped functions.
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const MODULE = resolve(__dirname, '../../modules/ops-job-closeout.js');
const OPEN = '// <job-closeout-core>';
const CLOSE = '// </job-closeout-core>';
const SOURCE = readFileSync(MODULE, 'utf8');

function extractCore() {
  const a = SOURCE.indexOf(OPEN);
  const b = SOURCE.indexOf(CLOSE);
  if (a < 0 || b < 0 || b <= a) throw new Error(`job-closeout-core sentinels not found in ${MODULE}`);
  // eslint-disable-next-line no-new-func
  return new Function(SOURCE.slice(a + OPEN.length, b) + '\n;return JobCloseoutCore;')();
}

const C = extractCore();
const NOW = Date.parse('2026-10-14T02:00:00Z');
const H = 3600000;
const job = (closeout, extra = {}) => Object.assign({ id: 'j1', type: 'fencing', status: 'invoiced', closeout }, extra);
const texts = (j, status) => C.tags(j, status, NOW).map((t) => t.text);

test.describe('Job close-out core (extracted from modules/ops-job-closeout.js)', () => {
  test('no tag text or title carries a long dash, across every review status and reason', () => {
    const reasons = [undefined, 'asked_recently', 'no_contact', 'paid_too_long_ago', 'refused', 'stuck_claim',
      'facts_unreadable', 'quote_unreadable', 'lookback_unreadable', 'claim_failed', 'sender_off', 'switch_off',
      'dry_run', 'held', 'not_paid', 'some_new_reason'];
    const statuses = ['sent', 'claimed', 'unconfirmed', 'skipped', 'not_sent'];
    const due = new Date(NOW + 5 * H).toISOString();
    const entered = new Date(NOW - 2 * H).toISOString();
    const rendered = [];
    for (const status of statuses) {
      for (const reason of reasons) {
        for (const held of [null, 'callback', 'rectification']) {
          const closeout = {
            paid_less_than_quoted: true, shortfall_inc: 5649, review: { status, reason }, held,
            get_review_entered_at: entered, archive_due_at: due
          };
          rendered.push(...C.tags(job(closeout), 'get_review', NOW));
        }
      }
    }
    rendered.push(...C.tags(job({ archive_due_at: new Date(NOW - H).toISOString() }), 'get_review', NOW));
    expect(rendered.length).toBeGreaterThan(0);
    for (const t of rendered) {
      expect(t.text).not.toMatch(/[–—]/);
      expect(t.title).not.toMatch(/[–—]/);
    }
  });

  test('switch: off by default, ?closeout=preview turns it on and is remembered, ?closeout=live turns it off', () => {
    expect(C.previewState('', null)).toEqual({ on: false, persist: null });
    expect(C.previewState('', '1')).toEqual({ on: true, persist: null });
    expect(C.previewState('?closeout=preview', null)).toEqual({ on: true, persist: '1' });
    expect(C.previewState('?wo=preview&closeout=live', '1')).toEqual({ on: false, persist: '0' });
    // The work order switch is a different switch.
    expect(C.previewState('?wo=preview', null)).toEqual({ on: false, persist: null });
  });

  test('no block, no tags; other job types never get tags', () => {
    expect(C.tags(job(undefined), 'invoiced', NOW)).toEqual([]);
    expect(C.tags(job(null), 'invoiced', NOW)).toEqual([]);
    expect(C.tags(job('paid'), 'invoiced', NOW)).toEqual([]);
    const full = { paid_less_than_quoted: true, review: { status: 'sent' } };
    for (const type of ['makesafe', 'repair', 'decking', 'general']) {
      expect(C.tags(job(full, { type }), 'invoiced', NOW)).toEqual([]);
    }
    expect(texts(job(full, { type: 'Patio' }), 'invoiced')).toEqual(['Paid less than quoted', 'Review sent']);
    expect(C.tagsHtml([])).toBe('');
  });

  test('paid less than quoted names the shortfall in its title', () => {
    const [t] = C.tags(job({ paid_less_than_quoted: true, shortfall_inc: 5649 }), 'invoiced', NOW);
    expect(t.text).toBe('Paid less than quoted');
    expect(t.title).toContain('$5,649.00');
    expect(C.tags(job({ paid_less_than_quoted: false }), 'invoiced', NOW)).toEqual([]);
  });

  test('review sent, sending, not confirmed, and not sent with the reason in words', () => {
    const r = (review) => texts(job({ review }), 'get_review');
    expect(r({ status: 'sent' })).toEqual(['Review sent']);
    expect(r({ status: 'claimed' })).toEqual(['Review sending']);
    expect(r({ status: 'unconfirmed', reason: 'stuck_claim' })).toEqual(['Review not confirmed']);
    expect(r({ status: 'skipped', reason: 'asked_recently' })).toEqual(['Review not sent: asked in the last 90 days']);
    expect(r({ status: 'skipped' })).toEqual(['Review not sent']);
    expect(r({ status: 'not_sent', reason: 'no_contact' })).toEqual(['Review not sent: no contact linked']);
    expect(r({ status: 'not_sent', reason: 'paid_too_long_ago' })).toEqual(['Review not sent: paid over 30 days ago']);
    expect(r({ status: 'not_sent', reason: 'refused' })).toEqual(['Review not sent: text refused']);
    expect(r({ status: 'not_sent', reason: 'some_new_reason' })).toEqual(['Review not sent: some new reason']);
    expect(r({ status: 'not_sent' })).toEqual(['Review not sent']);
    expect(r(null)).toEqual([]);
  });

  test('archives in Xh only in Get Review, only from archive_due_at, never while held', () => {
    const due = (ms) => new Date(NOW + ms).toISOString();
    const at = (closeout, status = 'get_review') => texts(job(closeout), status);
    expect(at({ archive_due_at: due(5 * H) })).toEqual(['Archives in 5h']);
    expect(at({ archive_due_at: due(4.2 * H) })).toEqual(['Archives in 5h']);
    expect(at({ archive_due_at: due(20 * 60000) })).toEqual(['Archives in under 1h']);
    expect(at({ archive_due_at: due(-60000) })).toEqual(['Archive due']);
    // The backend decides when, or whether, a card archives: entry time alone draws nothing.
    expect(at({ get_review_entered_at: due(-2 * H), archive_due_at: null })).toEqual([]);
    expect(at({ archive_due_at: 'not a date' })).toEqual([]);
    expect(at({ archive_due_at: due(5 * H) }, 'invoiced')).toEqual([]);
    expect(at({ archive_due_at: due(5 * H), held: 'callback' })).toEqual(['Held: callback']);
  });

  test('held: callback always shows; rectification only off the Rectification column (it has RECT)', () => {
    expect(texts(job({ held: 'callback' }), 'invoiced')).toEqual(['Held: callback']);
    expect(texts(job({ held: 'rectification' }), 'rectification')).toEqual([]);
    expect(texts(job({ held: 'rectification' }), 'get_review')).toEqual(['Held: rectification']);
  });

  test('tags are escaped and use the card badge class', () => {
    const html = C.tagsHtml(C.tags(job({ review: { status: 'not_sent', reason: '<b>x</b>' } }), 'invoiced', NOW));
    expect(html).toContain('kanban-meta-badge closeout-tag');
    expect(html).toContain('data-closeout-tag="review_not_sent"');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  test('ladder: with the preview on, fencing and patio run invoiced -> get_review -> archived', () => {
    expect(C.nextStatuses('invoiced', 'fencing', true)).toEqual(['get_review']);
    expect(C.nextStatuses('get_review', 'fencing', true)).toEqual(['archived']);
    expect(C.nextStatuses('final_payment', 'fencing', true)).toEqual(['invoiced']);
    expect(C.nextStatuses('complete', 'fencing', true)).toEqual(['invoiced', 'archived']);
    expect(C.nextStatuses('invoiced', 'patio', true)).toEqual(['get_review']);
    expect(C.nextStatuses('get_review', 'patio', true)).toEqual(['archived']);
    expect(C.nextStatuses('complete', 'patio', true)).toEqual(['invoiced']);
    // Not mine: earlier stages, other types, preview off.
    expect(C.nextStatuses('scheduled', 'fencing', true)).toBeNull();
    expect(C.nextStatuses('invoiced', 'decking', true)).toBeNull();
    expect(C.nextStatuses('invoiced', 'repair', true)).toBeNull();
    expect(C.nextStatuses('invoiced', 'fencing', false)).toBeNull();
  });
});
