/* <dispatch-supplier-picker>
 * Dispatch v2 Tweak 4: a simpler supplier picker (Shaun said Go on 5 Nov
 * 2026). Shaun's words: "when I search B&D Metals I see 3 of them. Show me
 * the one we use most, and put the other ones under Show more."
 *
 * Pure functions only (no page, no reads, no writes), so the rows are tested
 * on their own (tests/unit/dispatch-supplier-picker.test.cjs). Loaded before
 * modules/ops-dispatch.js as window.OpsDispatchPicker; the file name leaves
 * out "ops-dispatch" so the v1/v2 switch's own file checks still see one
 * Dispatch module.
 *
 * The search answer (ops-api dispatch_v2_supplier_search, backend contract
 * docs/dispatch-v2-emails-contract.md section "Tweak 4") has three lists:
 *   approved       one row per approved supplier, under its approved name,
 *                  on its main Xero contact (the one with the most Xero
 *                  bills in the last 12 months, or the pinned one)
 *   more_approved  the other Xero contacts of those suppliers
 *   others         every other Xero supplier (a one-off)
 * The first list always shows. The other two sit under Show more. When the
 * search finds no approved supplier, Show more opens by itself, so a one-off
 * supplier is still found just by typing its name.
 *
 * An approved supplier with no Xero contact yet still shows, greyed, with
 * "Add to Xero first": it cannot become a box until Xero has it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpsDispatchPicker = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var NO_XERO_NOTE = 'Add to Xero first: this supplier has no Xero contact yet';
  var NO_EMAIL_NOTE = 'No approved order email: Dispatch will not send to this supplier';
  var ON_JOB_NOTE = 'On this job';

  // What each approved entry is used for, in words.
  var USED_FOR = { any: 'Any job', fencing: 'Fencing', patio: 'Patio', 'fencing+patio': 'Fencing and patio' };

  function text(v) { return typeof v === 'string' ? v.trim() : (v === null || v === undefined ? '' : String(v).trim()); }
  function arr(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x.trim(); }) : []; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  /** The search answer, checked, with the Tweak 4 lists made safe for an
   * older answer that does not have them. Null when the answer is not one. */
  function readAnswer(resp) {
    if (!isObj(resp) || !Array.isArray(resp.approved) || !Array.isArray(resp.others)) return null;
    return {
      approved: resp.approved.filter(isObj),
      more_approved: Array.isArray(resp.more_approved) ? resp.more_approved.filter(isObj) : [],
      others: resp.others.filter(isObj),
      ranking: text(resp.ranking) || null
    };
  }

  /** One row as the screen draws it.
   *   kind     'approved' | 'more' | 'other'
   *   sid      the Xero contact the box would be made on ('' when none)
   *   title    the bold line
   *   sub      the small grey line, or ''
   *   note     the small amber line, or ''
   *   disabled true when it cannot be picked now
   *   greyed   true for an approved supplier with no Xero contact
   *   noEmail  true when Dispatch will not send to it
   * onJob: { supplier_id: true } for the boxes already on the job.
   * adding: the supplier_id being added now, or ''. */
  function row(r, kind, onJob, adding) {
    var sid = r.supplier_id ? String(r.supplier_id) : '';
    var on = !!(sid && onJob && onJob[sid]);
    var greyed = kind === 'approved' && !sid;
    var noEmail = kind === 'other' || r.has_approved_email === false;
    var title;
    var sub = [];
    if (kind === 'approved') {
      title = text(r.approved_name) || text(r.name);
      // The Xero contact behind the row, when its name differs.
      var xero = text(r.xero_name);
      if (xero && xero.toLowerCase() !== title.toLowerCase()) sub.push('Xero: ' + xero);
      if (r.other_contacts > 0) sub.push(r.other_contacts === 1 ? '1 more Xero contact under Show more' : r.other_contacts + ' more Xero contacts under Show more');
    } else if (kind === 'more') {
      title = text(r.name) || text(r.xero_name);
      if (text(r.approved_name)) sub.push('Another Xero contact of ' + text(r.approved_name));
    } else {
      title = text(r.name);
    }
    if (kind !== 'other') {
      var used = USED_FOR[text(r.used_for)] || text(r.used_for);
      if (used) sub.push(used);
      var to = arr(r.to);
      if (to.length) sub.push(to.join(', '));
    }
    var note = '';
    if (greyed) note = text(r.note) || NO_XERO_NOTE;
    else if (on) note = ON_JOB_NOTE;
    else if (noEmail) note = text(r.note) || NO_EMAIL_NOTE;
    return {
      kind: kind,
      sid: sid,
      title: title || 'Name not recorded',
      sub: sub.join(' · '),
      note: note,
      disabled: !sid || r.can_add === false || on || !!adding,
      adding: !!(adding && sid && adding === sid),
      greyed: greyed,
      noEmail: noEmail
    };
  }

  /** The picker's rows from a checked answer (readAnswer).
   * opts: { onJob, adding, more } where more is true once Show more is
   * pressed. Returns { approved, more, others, moreCount, showMore }. */
  function view(answer, opts) {
    var o = opts || {};
    var a = answer || { approved: [], more_approved: [], others: [] };
    var approved = a.approved.map(function (r) { return row(r, 'approved', o.onJob, o.adding); });
    var more = a.more_approved.map(function (r) { return row(r, 'more', o.onJob, o.adding); });
    var others = a.others.map(function (r) { return row(r, 'other', o.onJob, o.adding); });
    var moreCount = more.length + others.length;
    return {
      approved: approved,
      more: more,
      others: others,
      moreCount: moreCount,
      // Open by hand, or by itself when no approved supplier matched but
      // something else did.
      showMore: moreCount > 0 && (!!o.more || approved.length === 0)
    };
  }

  return {
    NO_XERO_NOTE: NO_XERO_NOTE,
    NO_EMAIL_NOTE: NO_EMAIL_NOTE,
    ON_JOB_NOTE: ON_JOB_NOTE,
    readAnswer: readAnswer,
    row: row,
    view: view
  };
});
