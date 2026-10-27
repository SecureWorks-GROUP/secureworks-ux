// Job page Overview v2: the pure rules (docs/job-overview-v2.md).
// ---------------------------------------------------------------------------
// Pure node, no browser: this spec READS ../../modules/ops-job-overview-v2.js, takes the
// code between `// <job-overview-v2-core>` and `// </job-overview-v2-core>`, and runs it,
// so every assertion is against the shipped functions. A fixed "now" (Fri 9 Oct 2026,
// 10:50am Perth) keeps the date words exact; the fixture builds every time from it.
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { buildJobDetail, buildJobOverview, IDS } = require('../fixtures/job-overview-v2');

const MODULE = resolve(__dirname, '../../modules/ops-job-overview-v2.js');
const OPEN = '// <job-overview-v2-core>';
const CLOSE = '// </job-overview-v2-core>';
const SOURCE = readFileSync(MODULE, 'utf8');

function extractCore() {
  const a = SOURCE.indexOf(OPEN);
  const b = SOURCE.indexOf(CLOSE);
  if (a < 0 || b < 0 || b <= a) throw new Error(`job-overview-v2-core sentinels not found in ${MODULE}`);
  // eslint-disable-next-line no-new-func
  return new Function(SOURCE.slice(a + OPEN.length, b) + '\n;return JobOverviewV2Core;')();
}

const C = extractCore();
const NOW = Date.parse('2026-10-09T02:50:00Z'); // Fri 9 Oct 2026, 10:50am Perth
const detail = () => buildJobDetail({ now: NOW });
const overview = (o = {}) => buildJobOverview(Object.assign({ now: NOW }, o));

test.describe('Job Overview v2 core (extracted from modules/ops-job-overview-v2.js)', () => {
  test('the module file holds no long dash and no emoji', () => {
    expect(SOURCE).not.toMatch(/[\u2013\u2014]/);
    expect(SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test('switch: the URL wins over the browser setting both ways; off by default', () => {
    expect(C.flagOn('', null)).toBe(false);
    expect(C.flagOn('', '1')).toBe(true);
    expect(C.flagOn('', '0')).toBe(false);
    expect(C.flagOn('?overview=v2', null)).toBe(true);
    expect(C.flagOn('?overview=1', '0')).toBe(true);
    expect(C.flagOn('?overview=classic', '1')).toBe(false);
    expect(C.flagOn('?overview=0', '1')).toBe(false);
    expect(C.flagOn('?dragv2=1&overview=v2', '')).toBe(true);
    expect(C.flagOn('?overview=banana', '1')).toBe(true);
  });

  test('Perth time, whatever zone the process is in', () => {
    const saved = process.env.TZ;
    try {
      for (const tz of ['UTC', 'Europe/London', 'America/New_York', 'Australia/Perth']) {
        process.env.TZ = tz;
        expect(C.timeWords('2026-10-09T01:22:00Z')).toBe('9:22am');
        expect(C.timeWords('2026-10-09T13:05:00+00:00')).toBe('9:05pm');
        expect(C.timeWords('2026-10-09T04:00:00Z')).toBe('12:00pm');
        expect(C.when('2026-09-01T03:41:00.59+00:00', NOW)).toBe('Tue 1 Sep \u00b7 11:41am');
        expect(C.stamp('2026-10-09T02:52:00Z', NOW)).toBe('Fri 9 Oct, 10:52am');
        expect(C.shortWhen('2026-10-07T22:56:47Z', NOW)).toBe('8 Oct 6:56am');
      }
    } finally {
      if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
    }
  });

  test('day words count Perth days, with the year only when it is not this year', () => {
    expect(C.dayLabel('2026-10-09T01:22:00Z', NOW)).toBe('Today');
    expect(C.dayLabel('2026-10-08T17:30:00Z', NOW)).toBe('Today'); // 1:30am Perth on the 9th
    expect(C.dayLabel('2026-10-08T06:01:00Z', NOW)).toBe('Yesterday');
    expect(C.dayLabel('2026-10-07T02:17:00Z', NOW)).toBe('Wed 7 Oct');
    expect(C.dayLabel('2025-10-07T02:17:00Z', NOW)).toBe('Tue 7 Oct 2025');
  });

  test('date-only values show with no time, as written', () => {
    expect(C.timeWords('2026-10-01T16:00:00+00:00')).toBe(''); // Xero dates arrive as Perth midnight
    expect(C.when('2026-10-01T16:00:00+00:00', NOW)).toBe('Fri 2 Oct');
    expect(C.when('2026-10-16', NOW)).toBe('Fri 16 Oct');
    expect(C.shortDate('2026-10-16', NOW)).toBe('16 Oct');
    expect(C.toMs('2026-10-08 06:01:58.153+00')).toBe(Date.parse('2026-10-08T06:01:58.153Z'));
  });

  test('stored long dashes become commas, or "to" between numbers', () => {
    expect(C.clean('23m Colorbond Fencing \u2014 1800mm Wilderness \u2014 Carlisle')).toBe('23m Colorbond Fencing, 1800mm Wilderness, Carlisle');
    expect(C.clean('2\u20133 days')).toBe('2 to 3 days');
    expect(C.clean('$6,000\u2013$6,300')).toBe('$6,000 to $6,300');
    expect(C.clean('word\u2014word')).toBe('word, word');
    expect(C.clean('\u2014 a lead dash')).toBe('a lead dash');
    expect(C.clean('a, \u2014 b')).toBe('a, b');
    expect(C.clean('SWF-261387 and Q-0850 keep their hyphens')).toBe('SWF-261387 and Q-0850 keep their hyphens');
    expect(C.clean(null)).toBe('');
  });

  test('money is en-AU dollars with cents, never the browser locale', () => {
    expect(C.money(7065.85)).toBe('$7,065.85');
    expect(C.money(0)).toBe('$0.00');
    expect(C.money(1234567.5)).toBe('$1,234,567.50');
    expect(C.money(-5)).toBe('-$5.00');
    expect(C.money('3571.43')).toBe('$3,571.43');
  });

  test('money: DRAFT is not invoiced, DELETED and VOIDED never count, the story card wins', () => {
    // Record mode: job_detail rows only.
    const d = detail();
    d.invoices.push({ id: 'i3', xero_invoice_id: 'x3', invoice_number: 'INV-9003', invoice_type: 'ACCREC', status: 'AUTHORISED', total: 1000, amount_paid: 400, amount_due: 600, job_id: d.job.id });
    d.invoices.push({ id: 'i4', xero_invoice_id: 'x4', invoice_number: 'INV-9004', invoice_type: 'ACCREC', status: 'VOIDED', total: 999, amount_paid: 999, job_id: d.job.id });
    d.invoices.push({ id: 'b1', invoice_number: 'BILL-1', invoice_type: 'ACCPAY', status: 'AUTHORISED', total: 5000, job_id: d.job.id });
    const rec = C.moneySummary(d, null);
    expect(rec.basis).toBe('records');
    expect(rec.value).toBe(7065.85);
    expect(rec.invoiced).toBe(1000);
    expect(rec.paid).toBe(400);
    expect(rec.drafts.map((x) => x.number)).toEqual(['INV-9002']);
    expect(rec.drafts[0].xeroId).toBe(IDS.xero2);
    // A deleted invoice whose row still says it was paid: ignored.
    const partial = { story: null, files: overview().files };
    const p = C.moneySummary(detail(), partial);
    expect(p.paid).toBe(0);
    expect(p.invoiced).toBe(0);
    // Story mode: the story card's parties, even though job_detail's own summary counts the draft.
    const s = C.moneySummary(detail(), overview());
    expect(s.basis).toBe('story');
    expect(s.invoiced).toBe(0);
    expect(s.paid).toBe(0);
    expect(s.draftTotal).toBeCloseTo(3571.43, 2);
    expect(s.drafts[0].xeroId).toBe(IDS.xero2);
    // Who pays what, only from the recorded split.
    expect(s.splits).toEqual([{ who: 'Avery', amount: 3794.72 }, { who: 'Jordan (neighbour)', amount: 3271.13 }]);
  });

  test('money: an invoice matched only on the client name is flagged and not counted', () => {
    const m = C.moneySummary(buildJobDetail({ now: NOW, nameMatchedOnly: true }), null);
    expect(m.nameOnly).toBe(1);
    expect(m.invoiced).toBe(0);
    const f = C.files(buildJobDetail({ now: NOW, nameMatchedOnly: true }), null, NOW).find((x) => x.kind === 'invoice');
    expect(f.meta).toContain('matched by name only');
  });

  test('files: live first in order, replaced and deleted faded at the end, views as a count', () => {
    const list = C.files(detail(), overview(), NOW);
    expect(list.map((f) => f.kind)).toEqual(['quote', 'invoice', 'scope', 'attachment', 'attachment', 'photos', 'quote', 'quote', 'invoice']);
    expect(list.map((f) => f.faded)).toEqual([false, false, false, false, false, false, true, true, true]);
    const [current, draft, scope, att1, att2, photos, v2, v1, deleted] = list;
    expect(current.name).toBe('Quote Q-9003 \u00b7 v3');
    // The quote carries no value: the card says so and never borrows the job price.
    expect(current.meta).toBe('value not recorded \u00b7 sent 8 Oct 6:56am \u00b7 opened 15 times');
    expect(current.pill).toEqual({ cls: 'acc', words: 'Accepted 8 Oct' });
    expect(draft.name).toBe('Deposit invoice INV-9002');
    expect(draft.pill).toEqual({ cls: 'warn', words: 'Draft in Xero, cannot be paid' });
    expect(scope.meta).toBe('Sam \u00b7 1 Sep \u00b7 22.9m Ridgeside \u00b7 asbestos removal');
    expect(att1.name).toBe('Quote_Avery_Lin_Rear_Fence.pdf');
    expect(att1.meta).toBe('emailed 2 Oct 9:44am \u00b7 2 versions \u00b7 6 pages');
    expect(att2.name).toBe('Site plan, rear.pdf');
    expect(photos.meta).toBe('10 photos \u00b7 from 4 Sep');
    expect(v2.pill).toEqual({ cls: 'sup', words: 'Replaced 8 Oct' });
    expect(v2.meta).toBe('sent 18 Sep 5:11pm \u00b7 opened 7 times');
    expect(v1.meta).toBe('$8,296.75 \u00b7 sent 4 Sep 1:48pm \u00b7 opened 6 times');
    expect(deleted.pill).toEqual({ cls: 'sup', words: 'Deleted in Xero' });
  });

  test('timeline: noise folded, quote versions as single milestones, drafts as warnings, a now node', () => {
    const ov = overview();
    const items = C.timeline(ov.story, { now: NOW, quotes: C.quoteRows(detail(), ov), job: detail().job });
    const titles = items.map((i) => i.title);
    expect(titles.some((t) => /^Document read/.test(t))).toBe(false);
    expect(titles.some((t) => /^App recorded/.test(t))).toBe(false);
    expect(titles.some((t) => /^Job record stamp/.test(t))).toBe(false);
    expect(titles.some((t) => /^Our system emailed the customer \(quote/.test(t))).toBe(false);
    expect(titles.some((t) => /superseded|viewed$/.test(t))).toBe(false);
    const v1 = items.filter((i) => /^Quote Q-9001 v1/.test(i.title));
    expect(v1).toHaveLength(1);
    expect(v1[0].title).toBe('Quote Q-9001 v1 sent \u00b7 $8,296.75');
    expect(v1[0].cls).toBe('ms');
    expect(v1[0].sub).toBe('Quoting app \u00b7 opened 6 times');
    expect(v1[0].detail).toEqual(expect.arrayContaining(['Emailed to the customer and delivered.', 'Replaced Fri 18 Sep.', 'Opened 6 times in all.']));
    expect(titles).toContain('Quote Q-9003 v3 accepted');
    expect(items.find((i) => i.title === 'A system email did not send').cls).toBe('wn');
    expect(items.find((i) => /^Draft invoice INV-9002/.test(i.title)).cls).toBe('wn');
    expect(items.find((i) => i.title === 'Invoice INV-9001 deleted in Xero').cls).toBe('mu');
    expect(items.find((i) => i.title === 'Scope first saved in the scoping tool').cls).toBe('ms');
    const ms = items.filter((i) => !i.now).map((i) => i.ms);
    expect(ms).toEqual([...ms].sort((a, b) => a - b));
    const last = items[items.length - 1];
    expect(last.now).toBe(true);
    expect(last.title).toBe('Deposit stage');
    expect(last.sub).toBe('since Fri 9 Oct \u00b7 Our move');
  });

  test('timeline without the story: a plain record of the job', () => {
    const items = C.recordTimeline(detail(), { now: NOW, statusLabel: 'Awaiting Deposit' });
    const titles = items.map((i) => i.title);
    expect(titles[0]).toBe('Job created');
    expect(titles).toContain('Quote Q-9003 v3 accepted');
    expect(titles).not.toContain('Quote accepted'); // the job stamp in the same minute is the same event
    expect(items.find((i) => /^Draft invoice INV-9002/.test(i.title)).cls).toBe('wn');
    expect(items[items.length - 1]).toMatchObject({ now: true, title: 'Awaiting Deposit' });
  });

  test('open items: grouped blocking, waiting on someone, good to know, with owner tags and dates', () => {
    const g = C.openItems(overview().story, detail().job, [], NOW);
    expect(g.blocking.map((i) => i.tag.words)).toEqual(['US', 'US']);
    expect(g.waiting.map((i) => i.tag.words)).toEqual(['AVERY', 'REAR NEIGHBOUR']);
    expect(g.know.map((i) => i.tag.words)).toEqual(['US', 'HELD']);
    expect(g.blocking[0].when).toBe('As at Thu 8 Oct');
    expect(g.blocking[0].blocks).toBe('Holds up the deposit');
    expect(g.blocking[1].when).toBe('Since Fri 2 Oct');
    expect(g.know[0].what).toBe('The tenants are away for about two and a half weeks, Avery wants the fence done while they are away.');
    expect(g.waiting[0].why).toBe('"let me know when it is paid"');
    // No loops on the card: the open AI notes stand in.
    const fromNotes = C.openItems({ loops: [] }, detail().job, overview().notes, NOW);
    expect(fromNotes.waiting).toHaveLength(1);
    expect(fromNotes.waiting[0].tag.words).toBe('AVERY');
    const known = C.openItems({ loops: [] }, detail().job, { items: [{ id: 'note-2', status: 'open', what: 'Timing is unconfirmed.', owner: 'us', group: 'good_to_know' }] }, NOW);
    expect(known.know).toHaveLength(1);
  });

  test('whose move, in words', () => {
    const j = detail().job;
    const s = overview().story;
    expect(C.whoseMove('us', j, s)).toEqual({ key: 'us', words: 'Our move' });
    expect(C.whoseMove('customer', j, s).words).toBe('Avery\'s move');
    expect(C.whoseMove('third_party', j, s).words).toBe('Rear neighbour\'s move');
    expect(C.whoseMove('unknown', j, s).words).toBe('Whose move is unclear');
    expect(C.whoseMove('nobody', j, s).words).toBe('Nothing waiting');
    expect(C.whoseMove(null, j, s)).toBe(null);
  });

  test('conversation: machine rows dropped, one row per call, no transcript, day lines, filters', () => {
    const msgs = overview().messages;
    const all = C.conversation(msgs, 'all', NOW);
    expect(all.total).toBe(9);
    expect(all.counts).toMatchObject({ sms: 7, call: 1, email: 1 });
    expect(JSON.stringify(all.items)).not.toContain('TRANSCRIPT');
    expect(JSON.stringify(all.items)).not.toContain('event listener');
    expect(all.items[0]).toMatchObject({ type: 'day', label: 'Wed 7 Oct' });
    expect(all.items.filter((x) => x.type === 'day').map((x) => x.label)).toEqual(['Wed 7 Oct', 'Yesterday', 'Today']);
    const call = all.items.find((x) => x.type === 'msg' && x.m.channel === 'call').m;
    expect(call.secs).toBe(7);
    expect(call.text).toBe('');
    expect(all.ids[IDS.msgAcceptAndPay]).toBe(true);
    expect(all.items.find((x) => x.type === 'msg' && /gone back over the quote/.test(x.m.text)).m.text)
      .toBe('Hi Avery, I have gone back over the quote, the rear is 6m of Hardie and 14.5m of asbestos, 2 to 3 days of work.');
    expect(C.conversation(msgs, 'call', NOW).shown).toBe(1);
    expect(C.conversation(msgs, 'sms', NOW).shown).toBe(7);
    expect(C.conversation(msgs, 'email', NOW).shown).toBe(1);
    expect(C.callWords(7)).toBe('7 seconds');
    expect(C.callWords(65)).toBe('1 min 5 sec');
    expect(C.callWords(null)).toBe('no duration recorded');
  });

  test('conversation from job_detail when job_overview is not there', () => {
    const conv = C.conversation(C.messagesFromDetail(detail()), 'all', NOW);
    expect(conv.total).toBe(4); // call (merged with its transcript), email, text out, reply; the blank reply is gone
    expect(JSON.stringify(conv.items)).not.toContain('MUST NEVER SHOW');
    const email = conv.items.find((x) => x.type === 'msg' && x.m.channel === 'email').m;
    expect(email.text).toBe('Subject: Re: Quote SWF-990101\nThank you for sending the revised quote, which all looks good.');
  });

  test('held rows: marked in the conversation (also a CRM copy), never the last word, one row per held call', () => {
    const at = '2026-10-01T02:15:40.993+00:00';
    const story = { held_messages: { count: 3, items: [
      { id: 'h-text', at, channel: 'sms', kind: 'client.sms_out', direction: 'outbound', text: 'Deposit for the other fencing project', job_certain: false },
      { id: 'h-log', at: '2026-10-05T07:08:22.213+00:00', channel: 'call', kind: 'client.call_logged', direction: 'inbound', text: '[Call, inbound. Provider status: completed. Duration: 210 sec]', job_certain: false },
      { id: 'h-tr', at: '2026-10-05T07:08:22.213+00:00', channel: 'call', kind: 'call.transcript_completed', direction: 'inbound', text: null, text_withheld: 'call_transcript', job_certain: false },
    ] } };
    const msgs = [
      { id: 'ghl:copy', at: '2026-10-01T02:15:40.993Z', channel: 'sms', direction: 'outbound', party: 'us', text: 'Deposit for the other fencing project' },
      { id: 'bev:flagged', at: '2026-10-02T02:00:00Z', channel: 'sms', direction: 'inbound', party: 'customer', text: 'Held words', job_certain: false, label: 'Held message, job not certain' },
      { id: 'bev:placed', at: '2026-09-30T02:00:00Z', channel: 'sms', direction: 'inbound', party: 'customer', text: 'When will the crew be back?' },
      { id: 'bev:thumb', at: '2026-10-03T02:00:00Z', channel: 'sms', direction: 'inbound', party: 'customer', text: '\u{1F44D}' },
      { id: 'bev:held-call', at: '2026-10-05T07:08:22.213+00:00', channel: 'call', direction: 'inbound', call_seconds: 210, job_certain: false },
      { id: 'ghl:call-copy', at: '2026-10-05T07:08:22.213Z', channel: 'call', direction: 'inbound' },
    ];
    const conv = C.conversation(msgs, 'all', NOW, story);
    const held = conv.items.filter((x) => x.type === 'msg' && x.m.held).map((x) => x.m.id);
    expect(held).toEqual(['ghl:copy', 'bev:flagged', 'bev:held-call']);
    expect(conv.counts.held).toBe(3);
    expect(conv.items.filter((x) => x.type === 'msg' && x.m.channel === 'call').map((x) => [x.m.secs, x.m.otherIds])).toEqual([[210, ['ghl:call-copy']]]);
    const ex = C.customerExchange({ ...story, last_exchange: { customer_said: { at: msgs[3].at, channel: 'sms', text: '\u{1F44D}' }, we_told_customer: { at, channel: 'sms', text: 'Deposit for the other fencing project', job_certain: false } } }, msgs);
    expect(ex.customer.text).toBe('When will the crew be back?');
    expect(ex.customer.thenNoWordsAt).toBe(msgs[3].at);
    expect(ex.us).toBeNull();
    expect(C.customerExchange({ last_exchange: { customer_said: { at, channel: 'sms', text: '\u{1F44D}' } } }, []).customer).toMatchObject({ text: '', noWords: true });
    expect(C.customerExchange(story, msgs).us).toBeNull();
    const list = C.heldList(story.held_messages);
    expect(list.items.length).toBe(2);
    expect(list.count).toBe(2);
    expect(list.items[1].secs).toBe(210);
  });

  test('the written story: tolerant of its shape, cleaned, null when unusable', () => {
    expect(C.storyText(null)).toBe(null);
    expect(C.storyText({ status: 'none' })).toMatchObject({ state: 'none', sections: null });
    const nested = C.storyText(overview({ writtenStory: true }).story_text);
    expect(nested.state).toBe('fresh');
    expect(nested.sections.the_job).toBe('Replace the 23m back and side fence, the old asbestos fence comes out and Colorbond goes in. The rear neighbour pays half of the rear section.');
    expect(nested.written_at).toBe('2026-10-09T02:52:00.000Z');
    const flat = C.storyText({ freshness: 'stale', status: 'current', sections: '{"headline":"Waiting on the deposit."}', written_at: '2026-10-09T02:00:00Z' });
    expect(flat.state).toBe('stale');
    expect(flat.sections.headline).toBe('Waiting on the deposit.');
    expect(C.storyText({ status: 'fresh', sections: { headline: '' } }).state).toBe('none');
    expect(C.storyText({ status: 'fresh', text: { sections: { headline: 'Waiting on a reply.' } }, writer: { on: true, open_request: { id: 'request-1' } } }))
      .toMatchObject({ writer_on: true, request_open: true });
  });

  test('a long dash or an emoji blocks a text; a plain hyphen does not', () => {
    expect(C.hasBanned('Hi Avery \u2014 thanks')).toBe(true);
    expect(C.hasBanned('2\u20133 days')).toBe(true);
    expect(C.hasBanned('Thanks ' + String.fromCodePoint(0x1F600))).toBe(true);
    expect(C.hasBanned('Quote SWF-990101 - see you Monday')).toBe(false);
  });

  test('AI notes status line and the headline when no story is written', () => {
    expect(C.ledgerWords(null, NOW)).toBe('AI notes not built yet');
    expect(C.ledgerWords({ status: 'live', unread_rows: 3 }, NOW)).toBe('AI notes have not read the newest 3 records yet');
    expect(C.ledgerWords({ status: 'live', unread_rows: 0, evidence_until: '2026-10-09T01:33:03Z' }, NOW)).toBe('AI notes have read everything up to Fri 9 Oct, 9:33am');
    const h = C.headlineFrom('Deposit stage since today. 1 draft invoice not issued. Our move, we owe: a payment link.');
    expect(h).toEqual({ headline: 'Deposit stage since today. 1 draft invoice not issued.', rest: 'Our move, we owe: a payment link.' });
  });

  test('an unknown action means the backend is not deployed yet; other errors are real', () => {
    expect(C.isNotDeployed(Object.assign(new Error('Unknown action'), { status: 400 }))).toBe(true);
    expect(C.isNotDeployed(new Error('Unknown action'))).toBe(true);
    expect(C.isNotDeployed({ code: 'unknown_action' })).toBe(true);
    expect(C.isNotDeployed(Object.assign(new Error('Server error'), { status: 500 }))).toBe(false);
    expect(C.isNotDeployed(Object.assign(new Error('Unknown action'), { status: 500 }))).toBe(false);
  });
});


test('the deployed quotes.documents envelope supplies values, views and joined PDF links', () => {
  const ov = overview();
  ov.files.quotes = { status: 'quoted', documents: ov.files.quotes.map(q => ({ ...q, value_inc_gst: 1735.25 })), history_total: 2 };
  const q = C.quoteRows(detail(), ov);
  expect(q[0]).toMatchObject({ value: 1735.25, views: 15, doc: { id: IDS.q3 } });
  expect(C.files(detail(), ov, NOW)[0].meta).toContain('$1,735.25');
  ov.files.quotes.documents = [];
  expect(C.quoteRows(detail(), ov)).toEqual([]);
});

test('unlinked name matches and unissued invoices never become this job\'s invoiced money', () => {
  const d = detail();
  d.invoices = [{ id: 'unlinked', job_id: null, status: 'PAID', total: 999, amount_paid: 999 }];
  expect(C.moneySummary(d, null)).toMatchObject({ invoiced: 0, paid: 0, nameOnly: 1 });
  const ov = { files: { invoices: d.invoices } };
  expect(C.moneySummary(d, ov)).toMatchObject({ invoiced: 999, paid: 999, nameOnly: 0 });
  d.invoices = [{ id: 'pending', job_id: d.job.id, status: 'SUBMITTED', total: 500 }, { id: 'unknown', job_id: d.job.id, status: 'UNKNOWN', total: 600 }];
  expect(C.moneySummary(d, null)).toMatchObject({ invoiced: 0, paid: 0, draftTotal: 500 });
  expect(C.files(d, null, NOW).find(f => f.key === 'inv:pending').pill.words).toBe('Awaiting approval in Xero, cannot be paid');
});

test('writer off, refusal and unrecognised outcomes are never successful rewrite requests', () => {
  for (const result of [{ outcome: 'off' }, { outcome: 'not_live' }, {}, { ok: false, outcome: 'queued', error: 'refused' }]) {
    expect(C.rewriteAccepted(result)).toBe(false);
    expect(C.rewriteWords(result)).not.toBe('');
  }
  expect(C.rewriteWords({ outcome: 'off' })).toBe('Rewriting is not switched on yet.');
  for (const outcome of ['queued', 'already_open', 'recent']) expect(C.rewriteAccepted({ outcome })).toBe(true);
});

test('partial reads name each unavailable section and stored emoji cannot reach the screen', () => {
  expect(C.sourceFailures({ sources: { story: { ok: true }, messages: { ok: false }, story_text: { state: 'not_deployed' }, quotes: { state: 'failed' } } }))
    .toEqual(['conversation', 'quotes', 'written story']);
  expect(C.clean('Booked \uD83D\uDC4D\uD83C\uDFFD for 2\u20133 days \uD83C\uDDE6\uD83C\uDDFA 1\uFE0F\u20E3')).toBe('Booked for 2 to 3 days');
});


test('the quote headline cannot borrow an older value or one run of a shared job', () => {
  const ov = overview();
  ov.files.quotes = { documents: ov.files.quotes, headline: null };
  expect(C.quotedValue(detail(), ov)).toBeNull();
  ov.files.quotes.headline = { value_inc_gst: 1735.25 };
  expect(C.quotedValue(detail(), ov)).toBe(1735.25);
  ov.files.quotes.headline = { value_inc_gst: null };
  expect(C.quotedValue(detail(), ov)).toBeNull();
  ov.files.quotes = [{ id: 'old', sent_at: '2026-10-01', value_inc_gst: 300 }, { id: 'new', sent_at: '2026-10-02', value_inc_gst: null }];
  expect(C.quotedValue(detail(), ov)).toBeNull();
});


test('live Xero payment dates do not invent an 8am payment time', () => {
  const story = { timeline: [{ at: '2026-10-05T00:00:00+00:00', date: '2026-10-05', kind: 'payment', state: 'paid', source_table: 'xero_invoices', what: 'Payment received on INV-9001' }] };
  const row = C.timeline(story, { now: NOW })[0];
  expect(row.dateOnly).toBe(true);
  expect(C.when(row.at, NOW)).toBe('Mon 5 Oct');
  story.timeline[0].source_table = 'business_events';
  expect(C.when(C.timeline(story, { now: NOW })[0].at, NOW)).toContain('8:00am');
});

test('inconsistent recorded split amounts are named without changing the stored money', () => {
  const d = detail();
  d.job.pricing_json.neighbour_splits.client_portion_inc_gst = 7065.85;
  const money = C.moneySummary(d, overview());
  expect(money.value).toBe(7065.85);
  expect(money.splits[0].amount).toBe(7065.85);
  expect(money.splitWarning).toBe('Recorded shares total $10,336.98, which differs from the job value. Check the scope split.');
});


test('the live uploaded attachment is not described as an email', () => {
  const ov = overview();
  ov.files.attachments = [{ source: 'upload', file_name: 'site.png', at: '2026-10-12T05:47:00Z' }];
  const file = C.files(detail(), ov, NOW).find(f => f.kind === 'attachment');
  expect(file.meta).toBe('uploaded 12 Oct 1:47pm');
  expect(file.pill.words).toBe('Uploaded document');
});

test('CTX-T22 core: standing not-seen lines, the Matching count and placed-by words', () => {
  expect(C.notSeen(null)).toEqual(['Material orders and deliveries are not recorded here.', 'Crew tasks and GHL notes are not captured.']);
  expect(C.notSeen({})).toEqual(C.notSeen(null));
  // A source the overview no longer lists has been captured: its line goes.
  expect(C.notSeen({ not_seen: [{ key: 'material_orders', text: 'Material orders and deliveries are not recorded here.' }] }))
    .toEqual(['Material orders and deliveries are not recorded here.']);
  expect(C.matchingWait(null)).toBe(null);
  expect(C.matchingWait({ matching: null, sources: { matching: { ok: false, state: 'failed' } } }).state).toBe('failed');
  expect(C.matchingWait({ matching: { waiting: 'x' }, sources: {} }).state).toBe('failed');
  expect(C.matchingWait({ sources: { matching: { ok: false, state: 'not_deployed' } } }).state).toBe('not_deployed');
  expect(C.matchingWait({ matching: { waiting: 0 }, sources: { matching: { ok: true, state: 'ok' } } }).words).toBe('No messages wait in Matching for this job.');
  expect(C.matchingWait({ matching: { waiting: 1, left_off_daily_list: 1 } }).words)
    .toBe('1 message waits in Matching for a person to say which job it belongs to. It is not on the daily list; Find by job shows it.');
  expect(C.matchingWait({ matching: { waiting: 50, more: true, left_off_daily_list: 2 } }).words)
    .toBe('At least 50 messages wait in Matching for a person to say which job they belong to. 2 of them are not on the daily list; Find by job shows them.');
  expect(C.placedBy(null, NOW)).toBe(null);
  const p = C.placedBy({ action: 'correct', decided_at: '2026-10-09T01:22:00Z', decided_by_name: 'Sam', evidence_hash: 'h1' }, NOW);
  expect(p.words).toBe('Moved to this job by Sam in Matching, Fri 9 Oct, 9:22am.');
  expect(p.evidence).toBe('h1');
  expect(C.placedBy({ action: 'confirm' }, NOW).words).toBe('Confirmed for this job by a person in Matching.');
  expect(C.decisionsUnread({ sources: { messages: { decisions: 'unread' } } })).toBe(true);
  expect(C.decisionsUnread({ sources: { messages: { ok: true } } })).toBe(false);
  // A merged copy keeps the placement.
  const conv = C.conversation([
    { id: 'a', at: '2026-10-09T01:00:00Z', channel: 'sms', direction: 'inbound', text: 'Same words' },
    { id: 'b', at: '2026-10-09T01:00:00Z', channel: 'sms', direction: 'inbound', text: 'Same words', placed_by_person: { action: 'split' } },
  ], 'all', NOW, null);
  const msgs = conv.items.filter((x) => x.type === 'msg');
  expect(msgs).toHaveLength(1);
  expect(msgs[0].m.placed).toEqual({ action: 'split' });
});
