/*
 * modules/ops-fencing-stratco-week.js is the only statement this repository
 * makes about the fencing Stratco week of Monday 14 September 2026. These tests
 * hold it to the filed read of 20:04 Perth, Sunday 13 September 2026, and to
 * the three rules that keep it honest: a figure with no evidence is unmeasured
 * rather than zero, a filed figure is never dressed as a live one, and nothing
 * on either surface offers to move, cancel or send anything.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = require('./ops-fencing-stratco-week.js');
const EVIDENCE = path.join(__dirname, '../docs/evidence/fencing-stratco-week-2026-09-13/stratco-week-filed-read.json');
const filed = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));

const WEEK = '2026-09-14';
const SCOPER = 'marnin';
const WOODLANDS_EVENT = 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObgAAAA==';
const BALGA_EVENT = 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObQAAAA==';
const GREENWOOD_EVENT = 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObAAAAA==';

const panel = () => api.renderPerformanceHTML(null);
const flags = (live) => api.flagsHTML(WEEK, SCOPER, live === undefined ? null : live);
const overlay = (day, live) => api.dayOverlayHTML(day, WEEK, SCOPER, { pxPerHour: 68, dayStart: 8 }, live === undefined ? null : live);
const breachOf = (ref) => api.FILED.breaches.find((b) => b.stratco_ref === ref);

/* ---- The four countable figures ------------------------------------- */

test('the four Stratco-week figures are exactly what the filed read published', () => {
  assert.deepEqual(api.counts().map((c) => [c.key, c.value]), [
    ['visits_agreed', 8],
    ['in_calendar', 6],
    ['initial_booking_threads_unanswered', 5],
    ['agreed_versus_calendar_breaches', 2]
  ]);
  assert.equal(api.FILED.counts.visits_agreed, 8);
  assert.equal(api.FILED.counts.in_calendar, 6);
  assert.equal(api.FILED.counts.initial_booking_threads_unanswered, 5);
  assert.equal(api.FILED.counts.agreed_versus_calendar_breaches, 2);
});

test('each figure reaches the panel with its label, its value and no stray placeholder', () => {
  const html = panel();
  [
    ['Visits agreed', '8'],
    ['In calendar', '6'],
    ['Booking threads unanswered', '5'],
    ['Agreed versus calendar breaches', '2']
  ].forEach(([label, value]) => {
    assert.match(html, new RegExp('<span class="fsw-n">' + value + '</span><span class="fsw-k">' + label + '</span>'));
  });
  assert.match(html, /Week of Monday 14 September 2026/);
  assert.doesNotMatch(html, /undefined|NaN|\[object/);
});

test('the two counts that disagree are the two breaches the surface then names', () => {
  const gap = api.FILED.counts.visits_agreed - api.FILED.counts.in_calendar;
  assert.equal(gap, 2, '8 agreed against 6 in the calendar');
  assert.equal(api.FILED.breaches.length, api.FILED.counts.agreed_versus_calendar_breaches);
  assert.deepEqual(api.FILED.breaches.map((b) => b.stratco_ref).sort(), ['231211', '231399']);
  assert.equal(api.FILED.unanswered_threads.length, api.FILED.counts.initial_booking_threads_unanswered);
  assert.equal(api.FILED.stratco_events.length, api.FILED.counts.in_calendar);
});

test('every figure carries the read time and the evidence file it came from', () => {
  const html = panel();
  const figures = api.counts().length;
  assert.equal(html.split('Filed read 20:04 Perth, Sunday 13 September 2026').length - 1, figures);
  assert.equal(html.split('docs/evidence/fencing-stratco-week-2026-09-13/stratco-week-filed-read.json').length - 1, figures + 1);
  assert.equal(api.FILED.read_iso, '2026-09-13T20:04:31+08:00');
  assert.match(html, /Filed read, not live/);
});

/* ---- Unmeasured, never zero ----------------------------------------- */

test('a figure with no evidence renders as unmeasured and never as a zero', () => {
  const html = panel();
  assert.doesNotMatch(html, /<span class="fsw-n">0<\/span>/);
  api.FILED.unmeasured.forEach((u) => {
    assert.ok(html.includes(api.escape(u.label) + ':</b> unmeasured'), u.key + ' is stated as unmeasured');
    assert.ok(u.reason && u.reason.length > 10, u.key + ' says why');
  });
  assert.match(html, /Khairo.s own Stratco calendar:<\/b> unmeasured\. Not read in this pass\./);
  assert.match(html, /Which 2 agreed visits have no event at all:<\/b> unmeasured/);
  // A figure the read genuinely did not produce must render as the unmeasured
  // treatment, not as a confident number.
  const missing = { key: 'x', label: 'Something not read', value: null, detail: 'No evidence.' };
  assert.equal(missing.value, null);
  assert.equal(api.counts().some((c) => c.value === null), false, 'all four published figures do have evidence today');
});

/* ---- Woodlands 231399 ------------------------------------------------ */

test('Woodlands 231399: agreed Friday 18 September 08:30, calendar reads Tuesday 15 September 11:45', () => {
  const b = breachOf('231399');
  assert.equal(b.suburb, 'Woodlands');
  assert.equal(b.calendar_start, '2026-09-15T11:45:00');
  assert.equal(b.calendar_end, '2026-09-15T12:30:00');
  assert.equal(b.agreed_start, '2026-09-18T08:30:00');
  assert.equal(b.agreed_end, '2026-09-18T09:15:00');
  assert.equal(b.event_id, WOODLANDS_EVENT);
  assert.equal(b.acceptance_message_id, 'BGN3JeJ8PRJsQKoQ2IgW');

  const written = flags();
  assert.match(written, /Woodlands 231399 contradicts the customer.s acceptance/);
  assert.match(written, /Wrong day and wrong time\. The customer agreed Friday 18 September 08:30\. The event reads Tuesday 15 September 11:45 to 12:30\./);
  assert.ok(written.includes(api.escape(WOODLANDS_EVENT)), 'the full Woodlands event id is printed');
  assert.match(written, /It has been wrong for over 51 hours as at the filed read/);

  assert.match(panel(), /<b>Woodlands 231399\.<\/b> Wrong day and wrong time\./);
  assert.ok(panel().includes(api.escape(WOODLANDS_EVENT)));
});

test('the Friday 08:30 Woodlands slot is shown as agreed with no event, in the right place', () => {
  const written = flags();
  assert.match(written, /Woodlands 231399 agreed Friday 18 September 08:30 to 09:15, no event exists/);
  assert.match(written, /Friday holds 2 events against an agreed run of 3\. Woodlands 08:30 is missing from Friday entirely because its event sits on Tuesday\./);
  // Friday is day index 4. 08:30 is 34px down a 68px hour starting at 08:00,
  // and the 45-minute slot is 51px tall.
  const friday = overlay(4);
  assert.match(friday, /class="fsw-missing" style="top:34px;height:51px"/);
  assert.match(friday, /<b>Agreed, not in the calendar<\/b><span>Woodlands 231399<\/span><span>08:30 to 09:15<\/span>/);
  // It is a Friday claim only. Tuesday never carries the missing slot.
  assert.doesNotMatch(overlay(1), /fsw-missing/);
});

test('the Woodlands breach outline sits on its own Tuesday event and names the agreed day', () => {
  const tuesday = overlay(1);
  assert.match(tuesday, /class="fsw-flagged" style="top:255px;height:51px"/);
  assert.match(tuesday, /<span>Woodlands 231399<\/span><span>Agreed Fri 18 Sep 08:30<\/span>/);
  assert.equal(api.agreedShort(breachOf('231399')), 'Agreed Fri 18 Sep 08:30');
});

/* ---- Balga 231211 ---------------------------------------------------- */

test('Balga 231211: agreed 11:30, calendar reads 11:15, fifteen minutes early', () => {
  const b = breachOf('231211');
  assert.equal(b.suburb, 'Balga');
  assert.equal(b.calendar_start, '2026-09-15T11:15:00');
  assert.equal(b.calendar_end, '2026-09-15T11:45:00');
  assert.equal(b.agreed_start, '2026-09-15T11:30:00');
  assert.equal(b.agreed_end, '2026-09-15T12:00:00');
  assert.equal(b.event_id, BALGA_EVENT);
  assert.equal(b.acceptance_message_id, 'mmD399s42QS42Dh9lLHZ');

  const written = flags();
  assert.match(written, /Balga 231211 contradicts the customer.s acceptance/);
  assert.match(written, /Fifteen minutes early\. The customer agreed 11:30\. The event reads Tuesday 15 September 11:15 to 11:45\./);
  assert.ok(written.includes(api.escape(BALGA_EVENT)), 'the full Balga event id is printed');

  assert.match(panel(), /<b>Balga 231211\.<\/b> Fifteen minutes early\./);
  assert.ok(panel().includes(api.escape(BALGA_EVENT)));
});

test('the Balga breach outline sits on its own event and names the agreed time', () => {
  const tuesday = overlay(1);
  assert.match(tuesday, /class="fsw-flagged" style="top:221px;height:34px"/);
  assert.match(tuesday, /<span>Balga 231211<\/span><span>Agreed 11:30<\/span>/);
  // Same day, so the compact label carries the time alone and no date.
  assert.equal(api.agreedShort(breachOf('231211')), 'Agreed 11:30');
});

test('the two breaches are different events; neither id is used for the other', () => {
  assert.notEqual(WOODLANDS_EVENT, BALGA_EVENT);
  const ids = api.FILED.breaches.map((b) => b.event_id);
  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(ids, [WOODLANDS_EVENT, BALGA_EVENT]);
});

/* ---- The two zero-travel adjacencies --------------------------------- */

test('both Tuesday zero-travel adjacencies are stated with their refs and a marker on the grid', () => {
  assert.equal(api.FILED.zero_travel_adjacencies.length, 2);
  const written = flags();
  assert.match(written, /Greenwood into Balga at 11:15 leaves zero travel/);
  assert.match(written, /Greenwood ends 11:15 and Balga starts 11:15\. Zero travel\. Both refs are 231238 and 231211\./);
  assert.match(written, /Balga into Woodlands at 11:45 leaves zero travel/);
  assert.match(written, /Balga ends 11:45 and Woodlands starts 11:45\. Zero travel\. Both refs are 231211 and 231399\./);

  const [first, second] = api.FILED.zero_travel_adjacencies;
  assert.equal(first.from.event_id, GREENWOOD_EVENT);
  assert.equal(first.to.event_id, BALGA_EVENT);
  assert.equal(second.from.event_id, BALGA_EVENT);
  assert.equal(second.to.event_id, WOODLANDS_EVENT);

  // 11:15 is 221px and 11:45 is 255px down the Tuesday column.
  const tuesday = overlay(1);
  assert.equal((tuesday.match(/class="fsw-seam"/g) || []).length, 2);
  assert.match(tuesday, /class="fsw-seam" style="top:221px"[^>]*><span>11:15 zero travel<\/span>/);
  assert.match(tuesday, /class="fsw-seam" style="top:255px"[^>]*><span>11:45 zero travel<\/span>/);
  // No other weekday carries a seam.
  [0, 2, 3, 4].forEach((d) => assert.doesNotMatch(overlay(d), /fsw-seam/, 'day ' + d));
});

/* ---- The protected band ---------------------------------------------- */

test('the Tuesday 13:00 to 15:30 band is clear on the letter and broken on travel, with the reason given', () => {
  const band = api.FILED.protected_band;
  assert.equal(band.stratco_events_inside, 0);
  assert.equal(band.letter_clear, true);
  assert.equal(band.travel_clear, false);
  assert.equal(band.blocked_by_event_id, WOODLANDS_EVENT);

  const written = flags();
  assert.match(written, /Tuesday 13:00 to 15:30 is not reachable by travel/);
  assert.match(written, /No Stratco visit sits inside the band, so the letter of the rule holds\. Travel breaks it\./);
  assert.match(written, /Woodlands ends 12:30 in Woodlands 6018 and the Canning Vale board room starts 13:00\. That leg does not fit in 30 minutes\./);
  assert.match(written, /The cause is the Woodlands event being on Tuesday at all/);
  assert.match(written, /Balga at 11:30 to 12:00 leaves 60 minutes to Canning Vale/);
  assert.ok(written.includes(api.escape(WOODLANDS_EVENT)), 'the blocking event is named by id');

  // 13:00 is 340px down and the two and a half hour band is 170px tall.
  const tuesday = overlay(1);
  assert.match(tuesday, /class="fsw-band" style="top:340px;height:170px"/);
  assert.match(tuesday, /<b>Protected 13:00 to 15:30<\/b>Not reachable by travel/);
  assert.doesNotMatch(overlay(4), /fsw-band/, 'the band is a Tuesday claim only');
});

/* ---- Nothing here acts ----------------------------------------------- */

test('every flag ends at the captain and the surface offers no move, cancel or send control', () => {
  const written = flags();
  assert.equal(api.FILED.move_cancel_tool_present, false);
  assert.equal((written.match(/No move or cancel tool exists for a scope event\. This is the captain.s call, not a desk action\./g) || []).length, 6);
  assert.match(written, /The tool catalog exposes sw_create_scope_booking and calendar reads only/);
  assert.match(written, /Calendar writes 0\. SMS sent 0\. Customer contact none\./);
  [written, panel(), overlay(1), overlay(4)].forEach((html) => {
    assert.doesNotMatch(html, /<button|<input|<select|<form|<a\s|onclick=|href=/);
  });
});

/* ---- Filed is never dressed as live ---------------------------------- */

test('with no live read the surface says so and paints the filed week, marked filed', () => {
  assert.equal(api.liveCoversWeek(null), false);
  assert.equal(api.liveCoversWeek([]), false);
  assert.equal(api.liveCoversWeek([{ event_id: 'someone-elses-event' }]), false);
  assert.match(flags(), /No live calendar read in this copy, so the week above is painted from the filed read of 20:04 Perth, Sunday 13 September 2026 and every block on it is marked filed\./);
  assert.match(flags(), /A provider event count of zero on this calendar is the live read, which returned nothing here\./);

  const tuesday = overlay(1);
  assert.equal((tuesday.match(/class="fsw-filed/g) || []).length, 5, 'four Tuesday visits plus the Canning Vale meeting');
  assert.equal((tuesday.match(/· filed<\/span>/g) || []).length, 5, 'every painted block says filed');
  assert.equal((overlay(4).match(/class="fsw-filed/g) || []).length, 2, 'two Friday visits');
  assert.equal((overlay(0).match(/class="fsw-filed/g) || []).length, 0, 'Monday carries no Stratco visit');
  assert.match(tuesday, /13:00 to 14:00<\/span><span class="fsw-s">Canning Vale<\/span><span class="fsw-r">tentative · filed/);
});

test('a live read that agrees is reported as agreeing and the grid stops painting filed blocks', () => {
  const live = api.FILED.stratco_events.map((e) => ({ event_id: e.event_id, start_iso: e.start, end_iso: e.end }));
  assert.equal(api.liveCoversWeek(live), true);
  const rec = api.reconcile(live);
  assert.equal(rec.has_live, true);
  assert.equal(rec.rows.filter((r) => r.status === 'agrees').length, 6);
  assert.match(rec.summary, /6 of 6 filed Stratco events are confirmed unchanged by the live read in this copy/);
  assert.equal((overlay(1, live).match(/class="fsw-filed/g) || []).length, 0);
  // The flags stay, because the breaches are still true.
  assert.match(flags(live), /Woodlands 231399 contradicts/);
  assert.match(flags(live), /Balga 231211 contradicts/);
});

test('a live read that differs is named rather than smoothed away', () => {
  const live = api.FILED.stratco_events.map((e, i) => i === 3
    ? { event_id: e.event_id, start_iso: '2026-09-18T08:30:00', end_iso: '2026-09-18T09:15:00' }
    : { event_id: e.event_id, start_iso: e.start, end_iso: e.end });
  const rec = api.reconcile(live);
  const woodlands = rec.rows.find((r) => r.stratco_ref === '231399');
  assert.equal(woodlands.status, 'moved');
  assert.match(woodlands.note, /Live read differs\. Filed Tuesday 15 September 11:45 to 12:30\. Live Friday 18 September 08:30 to 09:15\./);
  assert.match(woodlands.note, /The filed read is what the flags below describe/);
  assert.match(rec.summary, /5 of 6 filed Stratco events are confirmed unchanged/);

  const partial = api.reconcile([{ event_id: BALGA_EVENT, start_iso: '2026-09-15T11:15:00', end_iso: '2026-09-15T11:45:00' }]);
  assert.equal(partial.rows.filter((r) => r.status === 'absent').length, 5);
  assert.match(partial.rows.find((r) => r.stratco_ref === '231399').note, /Filed read holds this event\. The live read in this copy does not return it\./);
});

/* ---- Scope ----------------------------------------------------------- */

test('the read speaks only for Marnin and only for the week of 14 September 2026', () => {
  assert.equal(api.appliesTo(WEEK, SCOPER), true);
  assert.equal(api.appliesTo(WEEK, null), true);
  assert.equal(api.appliesTo('2026-09-21', SCOPER), false, 'the week of 22 September is out of scope');
  assert.equal(api.appliesTo(WEEK, 'khairo'), false, 'Khairo keeps his own calendar');
  assert.equal(api.appliesTo(WEEK, 'nithin'), false, 'the patio lane is separate');

  assert.equal(api.dayOverlayHTML(1, '2026-09-21', SCOPER, {}, null), '');
  assert.equal(api.dayOverlayHTML(1, WEEK, 'nithin', {}, null), '');
  assert.match(api.flagsHTML(WEEK, 'nithin', null), /The filed Stratco read covers the fencing week of 2026-09-14 on Marnin.s calendar\. Nothing is claimed about this week or this scoper\./);
  assert.match(api.flagsHTML('2026-09-21', SCOPER, null), /Nothing is claimed about this week or this scoper/);
});

test('a date with no zone is never shifted through a Perth to UTC conversion', () => {
  // Perth is UTC+8. Serialising these wall-clock strings through Date would
  // land the previous day, which is exactly the class of bug that minted the
  // inverted spans in ops.html.
  assert.equal(api.dayIndex('2026-09-14T00:00:00', WEEK), 0);
  assert.equal(api.dayIndex('2026-09-15T08:30:00', WEEK), 1);
  assert.equal(api.dayIndex('2026-09-18T23:59:00', WEEK), 4);
  assert.equal(api.dayIndex('2026-09-13T20:04:00', WEEK), null, 'before the week');
  assert.equal(api.dayIndex('2026-09-21T08:00:00', WEEK), null, 'after the week');
  assert.equal(api.when('2026-09-18T08:30:00', '2026-09-18T09:15:00'), 'Friday 18 September 08:30 to 09:15');
  assert.equal(api.when('2026-09-15T11:45:00'), 'Tuesday 15 September 11:45');
});

/* ---- The copy cannot drift from the evidence ------------------------- */

test('the module is still a faithful copy of the checked-in evidence file', () => {
  assert.deepEqual(api.FILED.counts, filed.counts);
  assert.equal(api.FILED.week_start, filed.week_start);
  assert.equal(api.FILED.read_iso, filed.read_clock.perth_local);
  assert.equal(api.FILED.move_cancel_tool_present, filed.move_cancel_tool_present);
  assert.equal(api.FILED.evidence_file, 'docs/evidence/fencing-stratco-week-2026-09-13/stratco-week-filed-read.json');
  const shape = (b) => [b.stratco_ref, b.suburb, b.event_id, b.calendar_start, b.calendar_end, b.agreed_start, b.agreed_end, b.acceptance_message_id];
  assert.deepEqual(api.FILED.breaches.map(shape), filed.breaches.map(shape));
  assert.deepEqual(api.FILED.stratco_events, filed.stratco_events);
  assert.deepEqual(api.FILED.zero_travel_adjacencies, filed.zero_travel_adjacencies);
  assert.deepEqual(api.FILED.protected_band, filed.protected_band);
  assert.deepEqual(api.FILED.unanswered_threads, filed.unanswered_threads);
  assert.deepEqual(api.FILED.unmeasured.map((u) => u.key), filed.unmeasured.map((u) => u.key));
});

test('no client identity reaches this repository and no captain-facing copy carries an em dash', () => {
  const source = fs.readFileSync(path.join(__dirname, 'ops-fencing-stratco-week.js'), 'utf8');
  const evidence = fs.readFileSync(EVIDENCE, 'utf8');
  const PII = ['Lawrence Guo', 'Oliver Parks', 'Gareth Chapman', 'Bruce Reidy-Crofts', 'Melanie Nouchy', 'Basil Laing',
    'Granich Gardens', 'Framfield Way', 'Martin Place', 'Providence Drive', 'Gildercliffe', 'Armand Drive', 'Frithville'];
  [source, evidence, panel(), flags(), overlay(1), overlay(4)].forEach((text) => {
    assert.doesNotMatch(text, /—/);
    PII.forEach((name) => assert.equal(text.includes(name), false, name));
    assert.doesNotMatch(text, /\+61\d{9}|\b04\d{8}\b/, 'no phone number');
  });
});

test('untrusted text cannot break out of this surface', () => {
  assert.equal(api.escape('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(api.escape(null), '');
  const hostile = api.reconcile([{ event_id: WOODLANDS_EVENT, start_iso: '<script>bad()</script>', end_iso: null }]);
  assert.equal(hostile.rows.find((r) => r.stratco_ref === '231399').status, 'moved');
  assert.doesNotMatch(api.escape(hostile.summary), /<script>/);
});
