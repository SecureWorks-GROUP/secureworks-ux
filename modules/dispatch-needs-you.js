/* <dispatch-needs-you>
 * Dispatch v2, "Needs you now": what on the Active jobs is waiting on Shaun,
 * by kind of action. Pure functions only (no page, no reads, no writes), so
 * the counting and the filter are tested on their own
 * (tests/unit/dispatch-needs-you.test.cjs). Loaded before
 * modules/ops-dispatch.js as window.OpsDispatchNeeds; the file name leaves
 * out "ops-dispatch" so the v1/v2 switch's own file checks still see one
 * Dispatch module.
 *
 * Everything is worked out from what the board read (pipeline dispatch=1
 * board=v2) already returns for each job: board.arrival.orders (one per
 * supplier box or order) and board.install. Two things come from elsewhere:
 *   - date suggestions to Accept: the job's own dispatch_v2_replies read,
 *     which the screen only makes when a job is opened. The board does not
 *     carry them, so a job not opened yet this session counts only its boxes
 *     at Quote received under Supplier replied.
 *   - Emails to sort: the Unmatched supplier emails tray's own count.
 *
 * The seven kinds, in the order the bar shows them:
 *   order   To order          a supplier box whose order is not sent yet and
 *                             has no email written, and every job at the
 *                             Order Materials stage (repairs: Materials) with
 *                             nothing drafted (Shaun's Go, 12 Nov 2026)
 *   drafted Order drafted     a supplier box with its order email saved as a
 *                             draft and not sent: only the send is left
 *                             (order_drafted on the board; Shaun's Go,
 *                             13 Nov 2026). It moves the box out of To order.
 *   pay     To pay            a pay-first box at Awaiting payment (payment.to_pay)
 *   replied Supplier replied  a box at Quote received to check, or a matched
 *                             reply with a date suggestion to Accept
 *   follow  Follow up         order sent, still at Sent to supplier (no reply has
 *                             moved it) FOLLOW_UP_AFTER_WORKING_DAYS or more
 *                             working days after it went
 *   risk    Date at risk      materials due after the install day, or no
 *                             confirmed date with the install
 *                             DATE_RISK_WITHIN_WORKING_DAYS working days away or less
 *   emails  Emails to sort    supplier emails waiting in the tray (not jobs)
 *
 * Working days are Monday to Friday, leaving out WA public holidays (the
 * caller passes isHoliday, from the calendar's own WaHolidaysCore).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpsDispatchNeeds = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Follow up an order that has had no supplier reply for this many working
  // days since it was sent (Shaun's Go, 5 Nov 2026).
  var FOLLOW_UP_AFTER_WORKING_DAYS = 2;

  // An order with no confirmed date is at risk once the install is this many
  // working days away or less (Shaun's Go, 5 Nov 2026).
  var DATE_RISK_WITHIN_WORKING_DAYS = 5;

  // The chips, in order. jobs: false for a kind that counts emails, not jobs.
  var KINDS = [
    { key: 'order', label: 'To order', jobs: true },
    { key: 'drafted', label: 'Order drafted', jobs: true },
    { key: 'pay', label: 'To pay', jobs: true },
    { key: 'replied', label: 'Supplier replied', jobs: true },
    { key: 'follow', label: 'Follow up', jobs: true },
    { key: 'risk', label: 'Date at risk', jobs: true },
    { key: 'emails', label: 'Emails to sort', jobs: false }
  ];

  var DAY_MS = 86400000;
  var PERTH_OFFSET_MS = 8 * 3600000; // WA has no daylight saving

  function isObj(v) { return !!v && typeof v === 'object'; }
  function text(v) { return typeof v === 'string' ? v.trim() : ''; }

  // 'YYYY-MM-DD' to whole days since 1970, or null.
  function dayIndex(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(iso).slice(0, 10));
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return isFinite(t) ? Math.round(t / DAY_MS) : null;
  }
  function isoOf(index) { return new Date(index * DAY_MS).toISOString().slice(0, 10); }

  // The Perth day a timestamp falls on ('2026-11-02T23:30:00Z' is Tue 3/11
  // in Perth), or null.
  function perthDay(stamp) {
    var t = Date.parse(text(stamp));
    return isFinite(t) ? new Date(t + PERTH_OFFSET_MS).toISOString().slice(0, 10) : null;
  }

  // A working day: Monday to Friday and not a holiday.
  function isWorkingDay(index, isHoliday) {
    var dow = new Date(index * DAY_MS).getUTCDay();
    return dow !== 0 && dow !== 6 && !(isHoliday && isHoliday(isoOf(index)));
  }

  // The working days after `from` up to and including `to` (0 when `to` is
  // not after `from`). Sent Monday, today Wednesday: 2. Sent Friday, today
  // Monday: 1. null when either day is not a day.
  function workingDaysBetween(from, to, isHoliday) {
    var a = dayIndex(from), b = dayIndex(to);
    if (a === null || b === null) return null;
    var n = 0;
    for (var d = a + 1; d <= b; d++) if (isWorkingDay(d, isHoliday)) n++;
    return n;
  }

  // A count of days in words: "1 day", "3 days".
  function daysWords(n) { return n + (n === 1 ? ' day' : ' days'); }

  // An order's supplier, for a tag.
  function nameOf(o) { return text(o.supplier_name) || 'the supplier'; }

  // To pay: the server's payment.to_pay, or for a server from before that
  // field, unpaid and at Awaiting payment (as the Materials panel works it out).
  function toPay(o) {
    var p = o.payment;
    if (!isObj(p)) return false;
    if (typeof p.to_pay === 'boolean') return p.to_pay;
    return p.state === 'unpaid' && text(o.material_stage) === 'awaiting_payment';
  }

  // Why one job needs Shaun: [{ kind, text }], in chip order, at most one
  // tag per kind and supplier. job: { id, board, suggestions } where
  // suggestions is the job's dispatch_v2_replies suggestions (or null when
  // not read). ctx: { today: 'YYYY-MM-DD', isHoliday }.
  function jobReasons(job, ctx) {
    var b = job && job.board;
    if (!isObj(b) || b.view === 'archive' || b.stage_phase === 'after') return [];
    var a = isObj(b.arrival) && Array.isArray(b.arrival.orders) ? b.arrival : null;
    var today = text(ctx && ctx.today) || (a && text(a.today)) || '';
    var isHoliday = ctx && ctx.isHoliday;
    var out = [];
    var seen = {};
    var add = function (kind, words) {
      if (seen[kind + '|' + words]) return;
      seen[kind + '|' + words] = true;
      out.push({ kind: kind, text: words });
    };
    var orders = a ? a.orders.filter(isObj) : [];
    // The install the dates are measured against: booked, and not passed.
    var ins = isObj(b.install) ? b.install : null;
    var installDay = ins && ins.booked === true && ins.passed !== true ? text(ins.first_day) || text(ins.day) : '';
    if (!installDay && a && a.install_day) installDay = text(a.install_day);
    var untilInstall = installDay && today && dayIndex(installDay) >= dayIndex(today) ? workingDaysBetween(today, installDay, isHoliday) : null;

    orders.forEach(function (o) {
      var stage = text(o.material_stage);
      if (stage === 'delivered') return;
      var name = nameOf(o);
      // A box whose email is written and saved is Order drafted, not To
      // order (Shaun, 13 Nov 2026): only the send is left. A sent box with a
      // new draft (an extra order) is drafted too.
      if (o.source === 'supplier_box' && o.order_drafted === true) add('drafted', 'Send ' + name + ' order');
      else if (o.source === 'supplier_box' && o.order_sent === false) add('order', 'Order ' + name);
      if (toPay(o)) add('pay', 'Pay ' + name);
      if (stage === 'quote_received') add('replied', 'Check ' + name + ' quote');
      // Still at Sent to supplier: no reply has moved it on.
      if (o.order_sent === true && stage === 'sent' && today) {
        var sent = perthDay(o.sent_at);
        var waited = sent ? workingDaysBetween(sent, today, isHoliday) : null;
        if (waited !== null && waited >= FOLLOW_UP_AFTER_WORKING_DAYS) add('follow', 'Follow up ' + name + ', ' + daysWords(waited));
      }
      if (o.flag === 'after_install') add('risk', name + ' due after install');
      else if (untilInstall !== null && untilInstall <= DATE_RISK_WITHIN_WORKING_DAYS && o.date_confirmed !== true) {
        add('risk', name + ' date not confirmed, install in ' + daysWords(untilInstall));
      }
    });
    // Every job at the ordering stage counts under To order, boxes or not
    // (Shaun's Go, 12 Nov 2026): on 12 Nov eight patio jobs sat at Order
    // Materials with no supplier box set up, so the box rule above never saw
    // them. One with an unsent box already carries "Order <supplier>"; one
    // with no box at all needs its order set up; one whose boxes are all sent
    // is still at the stage and waits to be moved on. One with an email
    // drafted is under Order drafted alone (Shaun, 13 Nov 2026): its order is
    // written, so it is not To order as well.
    var stageKey = text(b.stage_key);
    var atOrderStage = stageKey === 'order_materials' || (stageKey === 'materials' && b.track === 'repairs');
    if (atOrderStage && !out.some(function (r) { return r.kind === 'order' || r.kind === 'drafted'; })) {
      var boxes = orders.filter(function (o) { return o.source === 'supplier_box'; });
      add('order', boxes.length ? 'Still at Order materials' : 'Set up order');
    }
    (Array.isArray(job.suggestions) ? job.suggestions : []).forEach(function (s) {
      if (isObj(s) && s.state === 'open') add('replied', 'Accept ' + (text(s.supplier_name) || 'supplier') + ' date');
    });
    var order = {};
    KINDS.forEach(function (k, i) { order[k.key] = i; });
    // Stable: tags of one kind keep the order of the boxes.
    return out.map(function (r, i) { return { r: r, i: i }; })
      .sort(function (x, y) { return order[x.r.kind] - order[y.r.kind] || x.i - y.i; })
      .map(function (x) { return x.r; });
  }

  // Whether the board carries what a chip needs. A kind with nothing to go
  // on is hidden rather than shown as a false 0:
  //   drafted needs each box's order_drafted (an older server leaves it out,
  //     and its drafts simply stay under To order),
  //   follow needs each order's sent_at (an older server leaves it out),
  //   emails needs the tray's count (null when the tray was not read or failed).
  function available(jobs, emails) {
    var anyOrder = false, anySentAt = false, anyBox = false, anyDrafted = false;
    var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    jobs.forEach(function (j) {
      var a = j && isObj(j.board) && isObj(j.board.arrival) && Array.isArray(j.board.arrival.orders) ? j.board.arrival.orders : [];
      a.forEach(function (o) {
        if (!isObj(o)) return;
        anyOrder = true;
        if (has(o, 'sent_at')) anySentAt = true;
        if (o.source === 'supplier_box') {
          anyBox = true;
          if (has(o, 'order_drafted')) anyDrafted = true;
        }
      });
    });
    return { order: true, drafted: !anyBox || anyDrafted, pay: true, replied: true, follow: !anyOrder || anySentAt, risk: true, emails: typeof emails === 'number' && isFinite(emails) };
  }

  // The whole bar. jobs: [{ id, board, suggestions }]; emails: the tray's
  // count or null. Returns
  //   reasons: { jobId: [{ kind, text }] } for every job that needs something
  //   ids:     { kind: [jobId, ...] } in the order the jobs came
  //   counts:  { kind: n } (jobs; emails for Emails to sort)
  //   shown:   { kind: true/false } whether the chip is drawn
  //   jobs:    how many jobs need something (any kind)
  //   total:   jobs plus emails to sort, for the Dispatch tab
  function summarise(jobs, ctx, emails) {
    jobs = Array.isArray(jobs) ? jobs : [];
    var shown = available(jobs, emails);
    var reasons = {}, ids = {}, counts = {};
    KINDS.forEach(function (k) { ids[k.key] = []; counts[k.key] = 0; });
    var n = 0;
    jobs.forEach(function (j) {
      if (!j || !j.id) return;
      var r = jobReasons(j, ctx).filter(function (x) { return shown[x.kind]; });
      if (!r.length) return;
      reasons[j.id] = r;
      n++;
      var kinds = {};
      r.forEach(function (x) { kinds[x.kind] = true; });
      Object.keys(kinds).forEach(function (k) { ids[k].push(j.id); counts[k]++; });
    });
    counts.emails = shown.emails ? emails : 0;
    return { reasons: reasons, ids: ids, counts: counts, shown: shown, jobs: n, total: n + counts.emails };
  }

  // The rows a chip keeps: the rows whose job needs that kind, in their own
  // order. No kind (or emails, which is not about jobs) keeps every row.
  function filterRows(rows, summary, kind) {
    if (!kind || kind === 'emails' || !summary) return rows;
    var keep = {};
    (summary.ids[kind] || []).forEach(function (id) { keep[id] = true; });
    return rows.filter(function (r) { return r && keep[r.id]; });
  }

  // Rows that need something first, the rest below in the order they came.
  function needsFirst(rows, summary) {
    if (!summary) return rows;
    var need = [], rest = [];
    rows.forEach(function (r) { (r && summary.reasons[r.id] ? need : rest).push(r); });
    return need.concat(rest);
  }

  return {
    FOLLOW_UP_AFTER_WORKING_DAYS: FOLLOW_UP_AFTER_WORKING_DAYS,
    DATE_RISK_WITHIN_WORKING_DAYS: DATE_RISK_WITHIN_WORKING_DAYS,
    KINDS: KINDS,
    perthDay: perthDay,
    workingDaysBetween: workingDaysBetween,
    jobReasons: jobReasons,
    summarise: summarise,
    filterRows: filterRows,
    needsFirst: needsFirst
  };
});
