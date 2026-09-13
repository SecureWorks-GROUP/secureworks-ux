/*
 * Fencing Stratco week, filed read of 20:04 Perth, Sunday 13 September 2026.
 *
 * <fencing-stratco-filed-read>
 * This module states what the Stratco week of Monday 14 September 2026 really
 * is, from a read that has already happened and is filed in the wiki. It is a
 * FILED read, never a live one, and every surface that renders it says so.
 *
 * The numbers below are a copy of
 *   docs/evidence/fencing-stratco-week-2026-09-13/stratco-week-filed-read.json
 * which is itself a privacy-scrubbed copy of the wiki report and its evidence
 * file. modules/ops-sales-performance.test.cjs asserts this copy still equals
 * that file, so the two cannot drift apart quietly.
 *
 * Rules this module keeps:
 *  - A number with no evidence renders as unmeasured. Never as zero.
 *  - A filed figure is never dressed as a live figure. Where a live read is
 *    present it is reconciled against the filed one and any difference is
 *    named, not smoothed over.
 *  - No control here moves, cancels, books or sends anything. There is no move
 *    or cancel tool for a scope event, so every flag ends at the captain.
 *  - Customer names and street addresses do not appear. Suburb, Stratco ref and
 *    provider event id only.
 */
(function (global) {
  'use strict';

  var FILED = {
    week_start: '2026-09-14',
    lane: 'fencing',
    resource_id: 'marnin',
    scoper_name: 'Marnin',
    scoper_user_id: '706c5258-70dd-483a-b36c-af6864b24498',
    timezone: 'Australia/Perth',
    read_display: '20:04 Perth, Sunday 13 September 2026',
    read_iso: '2026-09-13T20:04:31+08:00',
    evidence_file: 'docs/evidence/fencing-stratco-week-2026-09-13/stratco-week-filed-read.json',
    wiki_report: 'secureworks-wiki coding/work/campaigns/ceo-ops/lanes/FENCING_SALES/STRATCO-CALENDAR-TRUTH-2026-09-13.md',
    wiki_evidence: 'secureworks-wiki coding/work/campaigns/ceo-ops/lanes/FENCING_SALES/evidence/2026-09-13-stratco-calendar-readback.json',
    read_only_pass: 'Calendar writes 0. SMS sent 0. Customer contact none.',
    move_cancel_tool_present: false,
    no_tool_line: 'The tool catalog exposes sw_create_scope_booking and calendar reads only. There is no move or cancel action for a scope event, so no desk can fix these. The fix is the captain’s call.',
    counts: {
      visits_agreed: 8,
      in_calendar: 6,
      initial_booking_threads_unanswered: 5,
      agreed_versus_calendar_breaches: 2
    },
    unmeasured: [
      { key: 'khairo_calendar', label: 'Khairo’s own Stratco calendar', reason: 'Not read in this pass. Khairo’s calendar is separate from Marnin’s and was outside the read.' },
      { key: 'agreed_without_event_composition', label: 'Which 2 agreed visits have no event at all', reason: 'The read publishes the totals 8 agreed and 6 in calendar. It does not enumerate the 2 with no event, so this surface does not name them. The one the report does name is ref 230849 Redcliffe.' },
      { key: 'operational_leave', label: 'Operational leave', reason: 'Not read in this pass.' },
      { key: 'non_primary_calendars', label: 'Non-primary calendars', reason: 'Not read in this pass.' }
    ],
    breaches: [
      {
        id: 'woodlands-231399',
        stratco_ref: '231399',
        suburb: 'Woodlands',
        postcode: '6018',
        event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObgAAAA==',
        calendar_start: '2026-09-15T11:45:00',
        calendar_end: '2026-09-15T12:30:00',
        agreed_start: '2026-09-18T08:30:00',
        agreed_end: '2026-09-18T09:15:00',
        kind: 'wrong_day_and_time',
        summary: 'Wrong day and wrong time. The customer agreed Friday 18 September 08:30. The event reads Tuesday 15 September 11:45 to 12:30.',
        acceptance_message_id: 'BGN3JeJ8PRJsQKoQ2IgW',
        acceptance_at_utc: '2026-09-11T08:25:20.398Z',
        wrong_since_hours_at_read: 51,
        missing_slot: {
          start: '2026-09-18T08:30:00',
          end: '2026-09-18T09:15:00',
          label: 'Agreed, not in the calendar',
          detail: 'Friday holds 2 events against an agreed run of 3. Woodlands 08:30 is missing from Friday entirely because its event sits on Tuesday.'
        }
      },
      {
        id: 'balga-231211',
        stratco_ref: '231211',
        suburb: 'Balga',
        postcode: '6061',
        event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObQAAAA==',
        calendar_start: '2026-09-15T11:15:00',
        calendar_end: '2026-09-15T11:45:00',
        agreed_start: '2026-09-15T11:30:00',
        agreed_end: '2026-09-15T12:00:00',
        kind: 'fifteen_minutes_early',
        summary: 'Fifteen minutes early. The customer agreed 11:30. The event reads Tuesday 15 September 11:15 to 11:45.',
        acceptance_message_id: 'mmD399s42QS42Dh9lLHZ',
        acceptance_at_utc: '2026-09-11T08:19:19.009Z',
        wrong_since_hours_at_read: 51,
        missing_slot: null
      }
    ],
    zero_travel_adjacencies: [
      {
        id: 'greenwood-balga-1115',
        at: '2026-09-15T11:15:00',
        from: { suburb: 'Greenwood', stratco_ref: '231238', ends: '2026-09-15T11:15:00', event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObAAAAA==' },
        to: { suburb: 'Balga', stratco_ref: '231211', starts: '2026-09-15T11:15:00', event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObQAAAA==' },
        summary: 'Greenwood ends 11:15 and Balga starts 11:15. Zero travel.'
      },
      {
        id: 'balga-woodlands-1145',
        at: '2026-09-15T11:45:00',
        from: { suburb: 'Balga', stratco_ref: '231211', ends: '2026-09-15T11:45:00', event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObQAAAA==' },
        to: { suburb: 'Woodlands', stratco_ref: '231399', starts: '2026-09-15T11:45:00', event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObgAAAA==' },
        summary: 'Balga ends 11:45 and Woodlands starts 11:45. Zero travel.'
      }
    ],
    protected_band: {
      start: '2026-09-15T13:00:00',
      end: '2026-09-15T15:30:00',
      label: 'Protected for the Canning Vale meeting',
      stratco_events_inside: 0,
      letter_clear: true,
      travel_clear: false,
      meeting: {
        subject: 'Outback Agreements',
        suburb: 'Canning Vale',
        start: '2026-09-15T13:00:00',
        end: '2026-09-15T14:00:00',
        show_as: 'tentative',
        event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAOagAAAA=='
      },
      reason: 'No Stratco visit sits inside the band, so the letter of the rule holds. Travel breaks it. Woodlands ends 12:30 in Woodlands 6018 and the Canning Vale board room starts 13:00. That leg does not fit in 30 minutes. The cause is the Woodlands event being on Tuesday at all. With it gone, Balga at 11:30 to 12:00 leaves 60 minutes to Canning Vale, which is what the agreed run assumes.',
      blocked_by_event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObgAAAA=='
    },
    stratco_events: [
      { stratco_ref: '230769', suburb: 'Alkimos', start: '2026-09-15T08:30:00', end: '2026-09-15T09:30:00', matches_agreed_run: true, event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAOawAAAA==' },
      { stratco_ref: '231238', suburb: 'Greenwood', start: '2026-09-15T10:30:00', end: '2026-09-15T11:15:00', matches_agreed_run: true, event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObAAAAA==' },
      { stratco_ref: '231211', suburb: 'Balga', start: '2026-09-15T11:15:00', end: '2026-09-15T11:45:00', matches_agreed_run: false, event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObQAAAA==' },
      { stratco_ref: '231399', suburb: 'Woodlands', start: '2026-09-15T11:45:00', end: '2026-09-15T12:30:00', matches_agreed_run: false, event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObgAAAA==' },
      { stratco_ref: '231514', suburb: 'Scarborough', start: '2026-09-18T10:00:00', end: '2026-09-18T10:45:00', matches_agreed_run: true, event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0SwuDAAAAA==' },
      { stratco_ref: '231284', suburb: 'Aubin Grove', start: '2026-09-18T13:30:00', end: '2026-09-18T14:30:00', matches_agreed_run: true, event_id: 'AQMkADg5YzhkM2IzLTdhYzAtNGY5ZC05NjQwLTRkMjRjMmI2OTIwNQBGAAADa9g1DmLEXUCA7RkJlzBCdgcA--dzT5ogUEm3FVkMazsV7QAAAgENAAAA--dzT5ogUEm3FVkMazsV7QAD0CAObwAAAA==' }
    ],
    unanswered_threads: [
      { stratco_ref: '230183', suburb: 'Balga', direction: 'outbound', silent_since_perth: '2026-09-11T08:03:00+08:00' },
      { stratco_ref: '231030', suburb: 'Camboon Road', direction: 'outbound', silent_since_perth: '2026-09-11T08:05:00+08:00' },
      { stratco_ref: '230052', suburb: 'Fenchurch Street', direction: 'outbound', silent_since_perth: '2026-09-11T08:05:00+08:00' },
      { stratco_ref: '230442', suburb: 'Princeville Tor', direction: 'outbound', silent_since_perth: '2026-09-11T08:05:00+08:00' },
      { stratco_ref: '230997', suburb: 'Sinagra', direction: 'outbound', silent_since_perth: '2026-09-11T08:06:00+08:00' }
    ],
    agreed_not_in_calendar_named: [
      { stratco_ref: '230849', suburb: 'Redcliffe', detail: 'Accepted Tuesday 15:45 is not in the calendar, so it is not a live breach. Booked, it would breach both the protected band’s tail and the 16:30 scoper window close.' }
    ]
  };

  var DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Local wall-clock only. These strings carry no zone and must never be fed
     through Date parsing that could shift them a day (Perth is UTC+8). */
  function dateOf(iso) { return String(iso || '').slice(0, 10); }
  function timeOf(iso) { return String(iso || '').slice(11, 16); }

  function dayIndex(iso, weekStart) {
    var a = dateOf(iso), b = dateOf(weekStart);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
    var diff = Math.round((Date.UTC.apply(null, a.split('-').map(function (v, i) { return i === 1 ? Number(v) - 1 : Number(v); }))
      - Date.UTC.apply(null, b.split('-').map(function (v, i) { return i === 1 ? Number(v) - 1 : Number(v); }))) / 86400000);
    return diff >= 0 && diff <= 6 ? diff : null;
  }

  function hourOf(iso) {
    var t = timeOf(iso);
    if (!/^\d{2}:\d{2}$/.test(t)) return null;
    return Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60;
  }

  function longDate(iso) {
    var d = dateOf(iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'date unknown';
    var parts = d.split('-').map(Number);
    var day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    return DAY_NAMES[(day + 6) % 7] + ' ' + parts[2] + ' ' + MONTHS[parts[1] - 1];
  }

  function when(startIso, endIso) {
    return longDate(startIso) + ' ' + timeOf(startIso) + (endIso ? ' to ' + timeOf(endIso) : '');
  }

  function appliesTo(weekStart, resourceId) {
    return dateOf(weekStart) === FILED.week_start && (!resourceId || resourceId === FILED.resource_id);
  }

  /* Four countable figures, each carrying the read that produced it. A figure
     with no evidence returns value null and renders as unmeasured. */
  function counts() {
    var c = FILED.counts;
    return [
      { key: 'visits_agreed', label: 'Visits agreed', value: num(c.visits_agreed), detail: 'Customers who said yes to a time for this week.' },
      { key: 'in_calendar', label: 'In calendar', value: num(c.in_calendar), detail: 'Stratco events actually present in Marnin’s primary calendar for this week.' },
      { key: 'initial_booking_threads_unanswered', label: 'Booking threads unanswered', value: num(c.initial_booking_threads_unanswered), detail: 'First offers sent 11 September that no customer has answered.' },
      { key: 'agreed_versus_calendar_breaches', label: 'Agreed versus calendar breaches', value: num(c.agreed_versus_calendar_breaches), detail: 'Events that contradict a recorded customer acceptance. Both are named below.' }
    ];
  }

  function num(value) { return typeof value === 'number' && isFinite(value) ? value : null; }

  /* A live read, when one is present, is reconciled against the filed one by
     event id. A difference is stated, never smoothed away. */
  function reconcile(liveEvents) {
    var live = Array.isArray(liveEvents) ? liveEvents : null;
    if (!live || !liveCoversWeek(live)) {
      return {
        has_live: false,
        rows: [],
        summary: 'No live calendar read in this copy, so the week above is painted from the filed read of ' + FILED.read_display + ' and every block on it is marked filed. A provider event count of zero on this calendar is the live read, which returned nothing here.'
      };
    }
    var byId = {};
    live.forEach(function (ev) { if (ev && ev.event_id) byId[ev.event_id] = ev; });
    var rows = FILED.stratco_events.map(function (filedEv) {
      var hit = byId[filedEv.event_id];
      if (!hit) return { stratco_ref: filedEv.stratco_ref, suburb: filedEv.suburb, event_id: filedEv.event_id, status: 'absent', note: 'Filed read holds this event. The live read in this copy does not return it.' };
      var same = dateOf(hit.start_iso) === dateOf(filedEv.start) && timeOf(hit.start_iso) === timeOf(filedEv.start) && timeOf(hit.end_iso) === timeOf(filedEv.end);
      return {
        stratco_ref: filedEv.stratco_ref,
        suburb: filedEv.suburb,
        event_id: filedEv.event_id,
        status: same ? 'agrees' : 'moved',
        note: same
          ? 'Live read agrees with the filed read.'
          : 'Live read differs. Filed ' + when(filedEv.start, filedEv.end) + '. Live ' + when(hit.start_iso, hit.end_iso) + '. The filed read is what the flags below describe.'
      };
    });
    var agreeing = rows.filter(function (r) { return r.status === 'agrees'; }).length;
    return {
      has_live: true,
      rows: rows,
      summary: agreeing + ' of ' + rows.length + ' filed Stratco events are confirmed unchanged by the live read in this copy. The flags state the filed read.'
    };
  }

  /* ---- Performance surface ------------------------------------------- */

  function figureHTML(item) {
    var unmeasured = item.value === null;
    return '<div class="fsw-figure' + (unmeasured ? ' unmeasured' : '') + '">' +
      '<span class="fsw-n">' + (unmeasured ? 'Unmeasured' : esc(String(item.value))) + '</span>' +
      '<span class="fsw-k">' + esc(item.label) + '</span>' +
      '<span class="fsw-d">' + esc(item.detail) + '</span>' +
      '<span class="fsw-src">Filed read ' + esc(FILED.read_display) + ' · <code>' + esc(FILED.evidence_file) + '</code></span>' +
      '</div>';
  }

  function renderPerformanceHTML(liveEvents) {
    var rec = reconcile(liveEvents);
    var figures = counts().map(figureHTML).join('');
    var named = FILED.breaches.map(function (b) {
      return '<li><b>' + esc(b.suburb) + ' ' + esc(b.stratco_ref) + '.</b> ' + esc(b.summary) +
        ' Wrong for over ' + esc(String(b.wrong_since_hours_at_read)) + ' hours at the read.' +
        '<br><span class="fsw-eid">Event ' + esc(b.event_id) + '</span></li>';
    }).join('');
    var unmeasured = FILED.unmeasured.map(function (u) {
      return '<li><b>' + esc(u.label) + ':</b> unmeasured. ' + esc(u.reason) + '</li>';
    }).join('');
    return '<section class="fsw" aria-labelledby="fswHeading">' +
      '<div class="fsw-head">' +
      '<div><p class="fsw-eyebrow">Fencing · Stratco week</p><h2 id="fswHeading">Week of Monday 14 September 2026</h2>' +
      '<p class="fsw-sub">Marnin’s fencing scoper calendar, Australia/Perth. Separate from the patio lane and from Khairo’s own calendar.</p></div>' +
      '<p class="fsw-stamp">Filed read, not live<br><b>' + esc(FILED.read_display) + '</b></p>' +
      '</div>' +
      '<div class="fsw-figures">' + figures + '</div>' +
      '<p class="fsw-recon">' + esc(rec.summary) + '</p>' +
      '<div class="fsw-cols">' +
      '<div><h3>The two breaches</h3><ul class="fsw-list">' + named + '</ul>' +
      '<p class="fsw-note">' + esc(FILED.no_tool_line) + '</p></div>' +
      '<div><h3>What this read does not measure</h3><ul class="fsw-list">' + unmeasured + '</ul></div>' +
      '</div>' +
      '<p class="fsw-prov">' + esc(FILED.read_only_pass) + ' Evidence in this repo: <code>' + esc(FILED.evidence_file) + '</code>. Source report: <code>' + esc(FILED.wiki_report) + '</code>. Source evidence: <code>' + esc(FILED.wiki_evidence) + '</code>.</p>' +
      '</section>';
  }

  /* ---- Booking surface ------------------------------------------------ */

  /* Compact enough to read inside a 30-minute block. The full sentence lives
     in the written flag underneath the grid, never only in a clipped box. */
  function agreedShort(breach) {
    var sameDay = dateOf(breach.agreed_start) === dateOf(breach.calendar_start);
    return sameDay
      ? 'Agreed ' + timeOf(breach.agreed_start)
      : 'Agreed ' + longDate(breach.agreed_start).replace(/^(\w{3})\w*day (\d+) (\w{3})\w*$/, '$1 $2 $3') + ' ' + timeOf(breach.agreed_start);
  }

  /* Does this live read actually carry the week? A read that returns none of
     the filed Stratco events cannot paint the week, so the overlay paints the
     filed events instead and labels every one of them as filed. */
  function liveCoversWeek(liveEvents) {
    if (!Array.isArray(liveEvents) || !liveEvents.length) return false;
    var ids = {};
    liveEvents.forEach(function (ev) { if (ev && ev.event_id) ids[ev.event_id] = true; });
    return FILED.stratco_events.some(function (e) { return ids[e.event_id]; });
  }

  /* Overlay blocks painted into the week grid. Geometry comes from the caller
     so this module never keeps a second copy of the calendar's scale. */
  function dayOverlayHTML(dayIdx, weekStart, resourceId, geometry, liveEvents) {
    if (!appliesTo(weekStart, resourceId)) return '';
    var geo = geometry || {};
    var pxPerHour = num(geo.pxPerHour) || 68;
    var dayStart = num(geo.dayStart) === null ? 8 : geo.dayStart;
    var out = '';

    function place(startIso, endIso, cls, inner) {
      var hour = hourOf(startIso);
      if (hour === null) return '';
      var endHour = hourOf(endIso);
      var height = endHour === null ? 0.5 : Math.max(0.25, endHour - hour);
      return '<div class="' + cls + '" style="top:' + ((hour - dayStart) * pxPerHour) + 'px;height:' + (height * pxPerHour) + 'px">' + inner + '</div>';
    }

    /* An empty grid under a breach outline reads as an empty week, which is
       the thing this surface exists to stop. When the live read cannot paint
       the week, paint the filed events and say on every block that they are
       filed. */
    if (!liveCoversWeek(liveEvents)) {
      FILED.stratco_events.forEach(function (ev) {
        if (dayIndex(ev.start, weekStart) !== dayIdx) return;
        out += place(ev.start, ev.end, 'fsw-filed' + (ev.matches_agreed_run ? '' : ' off'),
          '<span class="fsw-t">' + esc(timeOf(ev.start)) + ' to ' + esc(timeOf(ev.end)) + '</span>' +
          '<span class="fsw-s">' + esc(ev.suburb) + '</span>' +
          '<span class="fsw-r">' + esc(ev.stratco_ref) + ' · filed</span>');
      });
      var meeting = FILED.protected_band.meeting;
      if (dayIndex(meeting.start, weekStart) === dayIdx) {
        out += place(meeting.start, meeting.end, 'fsw-filed meeting',
          '<span class="fsw-t">' + esc(timeOf(meeting.start)) + ' to ' + esc(timeOf(meeting.end)) + '</span>' +
          '<span class="fsw-s">' + esc(meeting.suburb) + '</span>' +
          '<span class="fsw-r">' + esc(meeting.show_as) + ' · filed</span>');
      }
    }

    FILED.breaches.forEach(function (b) {
      if (dayIndex(b.calendar_start, weekStart) === dayIdx) {
        out += place(b.calendar_start, b.calendar_end, 'fsw-flagged',
          '<b>Breach</b><span>' + esc(b.suburb) + ' ' + esc(b.stratco_ref) + '</span><span>' + esc(agreedShort(b)) + '</span>');
      }
      if (b.missing_slot && dayIndex(b.missing_slot.start, weekStart) === dayIdx) {
        out += place(b.missing_slot.start, b.missing_slot.end, 'fsw-missing',
          '<b>' + esc(b.missing_slot.label) + '</b><span>' + esc(b.suburb) + ' ' + esc(b.stratco_ref) + '</span><span>' + esc(timeOf(b.missing_slot.start)) + ' to ' + esc(timeOf(b.missing_slot.end)) + '</span>');
      }
    });

    FILED.zero_travel_adjacencies.forEach(function (a) {
      if (dayIndex(a.at, weekStart) !== dayIdx) return;
      var hour = hourOf(a.at);
      if (hour === null) return;
      out += '<div class="fsw-seam" style="top:' + ((hour - dayStart) * pxPerHour) + 'px" title="' + esc(a.summary) + '"><span>' + esc(timeOf(a.at)) + ' zero travel</span></div>';
    });

    var band = FILED.protected_band;
    if (dayIndex(band.start, weekStart) === dayIdx) {
      out += place(band.start, band.end, 'fsw-band',
        '<span class="fsw-band-label"><b>Protected ' + esc(timeOf(band.start)) + ' to ' + esc(timeOf(band.end)) + '</b>' +
        (band.travel_clear ? 'Reachable' : 'Not reachable by travel') + '</span>');
    }
    return out;
  }

  /* The written flags. Each one names its full event id and ends at the
     captain, because there is nothing here that can move or cancel an event. */
  function flagsHTML(weekStart, resourceId, liveEvents) {
    if (!appliesTo(weekStart, resourceId)) {
      return '<div class="fsw-flags quiet"><p>The filed Stratco read covers the fencing week of ' + esc(FILED.week_start) + ' on ' + esc(FILED.scoper_name) + '’s calendar. Nothing is claimed about this week or this scoper.</p></div>';
    }
    var rec = reconcile(liveEvents);
    var band = FILED.protected_band;
    var items = [];

    FILED.breaches.forEach(function (b) {
      items.push({
        tone: 'breach',
        title: b.suburb + ' ' + b.stratco_ref + ' contradicts the customer’s acceptance',
        body: b.summary + ' It has been wrong for over ' + b.wrong_since_hours_at_read + ' hours as at the filed read. Customer acceptance ' + b.acceptance_message_id + '.',
        event_id: b.event_id
      });
      if (b.missing_slot) {
        items.push({
          tone: 'missing',
          title: b.suburb + ' ' + b.stratco_ref + ' agreed ' + when(b.missing_slot.start, b.missing_slot.end) + ', no event exists',
          body: b.missing_slot.detail,
          event_id: null
        });
      }
    });

    FILED.zero_travel_adjacencies.forEach(function (a) {
      items.push({
        tone: 'seam',
        title: a.from.suburb + ' into ' + a.to.suburb + ' at ' + timeOf(a.at) + ' leaves zero travel',
        body: a.summary + ' Both refs are ' + a.from.stratco_ref + ' and ' + a.to.stratco_ref + '.',
        event_id: a.to.event_id
      });
    });

    items.push({
      tone: 'band',
      title: 'Tuesday 13:00 to 15:30 is not reachable by travel',
      body: band.reason,
      event_id: band.blocked_by_event_id
    });

    var list = items.map(function (it) {
      return '<li class="fsw-flag ' + esc(it.tone) + '"><b>' + esc(it.title) + '</b><p>' + esc(it.body) + '</p>' +
        (it.event_id ? '<p class="fsw-eid">Event ' + esc(it.event_id) + '</p>' : '') +
        '<p class="fsw-owner">No move or cancel tool exists for a scope event. This is the captain’s call, not a desk action.</p></li>';
    }).join('');

    return '<div class="fsw-flags">' +
      '<div class="fsw-flags-head"><h3>Stratco week flags, filed read ' + esc(FILED.read_display) + '</h3>' +
      '<p>' + esc(rec.summary) + '</p></div>' +
      '<ul>' + list + '</ul>' +
      '<p class="fsw-note">' + esc(FILED.no_tool_line) + ' ' + esc(FILED.read_only_pass) + ' Evidence <code>' + esc(FILED.evidence_file) + '</code>.</p>' +
      '</div>';
  }

  function mount() {
    if (!global.document) return;
    var el = global.document.getElementById('fencingStratcoWeekRoot');
    if (!el) return;
    el.innerHTML = renderPerformanceHTML(null);
  }

  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', mount);
    else mount();
    global.document.addEventListener('sales-performance:render', mount);
  }

  var api = {
    FILED: FILED,
    escape: esc,
    appliesTo: appliesTo,
    counts: counts,
    reconcile: reconcile,
    renderPerformanceHTML: renderPerformanceHTML,
    dayOverlayHTML: dayOverlayHTML,
    flagsHTML: flagsHTML,
    mount: mount,
    when: when,
    dayIndex: dayIndex,
    agreedShort: agreedShort,
    liveCoversWeek: liveCoversWeek
  };
  global.FencingStratcoWeek = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
