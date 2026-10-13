// ════════════════════════════════════════════════════════════
// JOB WORK ORDER: the one work order per fencing or patio job (backend
// secureworks-backend docs/job-work-orders-v1.md), as the Ops dashboard and the
// Trade App show it. Screen doc: docs/job-work-order-screens.md.
//
// Loaded by ops.html (modules/ops-job-work-order.js draws it on the job page
// and in the Work Order PDF) and by trade.html (the job's work order scope and
// the invoice). Both pages read a work order's lines through this file only,
// so a task, its hours and a variation addendum read the same everywhere.
//
// Preview (captain's rule for new screens): off unless ?wo=preview or
// localStorage sw_wo_preview = '1'. ?wo=live turns it off.
// With it off, both pages behave exactly as before.
//
// Money: the Ops renderer shows the agreed labour, each line's allocation and
// the billed figures (office staff only). The trade renderer reads no money
// field at all and prints no dollar figure, for every trade, the lead included
// (captain, 12 Oct 2026). No emoji and no long dashes in what it renders
// (tests/e2e/job-work-order-core.spec.js checks it).
// ════════════════════════════════════════════════════════════

// <job-work-order-core>
// Pure rules and HTML only: no DOM, no fetch, no window, no storage.
// tests/e2e/job-work-order-core.spec.js runs this block in node.
var JobWorkOrderCore = (function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PERTH_MS = 8 * 3600000; // Western Australia stays on UTC+8 all year
  var DOT = ' · ';
  var ELIGIBLE_TYPES = ['fencing', 'patio'];
  var HOUR_UNITS = ['h', 'hr', 'hrs', 'hour', 'hours'];
  // A lump-sum quantity: one job, one lot. Per-metre and per-each lines are
  // priced as quoted and need no hours (captain, 12 Oct 2026).
  var LUMP_UNITS = ['job', 'jobs', 'lot', 'lots'];
  // Approvers by sign-in email, as a display hint only: the server checks
  // work_order_settings.approver_user_ids and refuses anyone else.
  var APPROVER_EMAILS = ['shaun@secureworkswa.com.au'];

  function str(v) { return v == null ? '' : String(v); }
  function lower(v) { return str(v).trim().toLowerCase(); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  function num(v) {
    if (v == null || v === '' || typeof v === 'boolean') return NaN;
    var n = Number(v);
    return isFinite(n) ? n : NaN;
  }
  function firstNum() {
    for (var i = 0; i < arguments.length; i++) { var n = num(arguments[i]); if (isFinite(n)) return n; }
    return null;
  }
  function firstText() {
    for (var i = 0; i < arguments.length; i++) {
      var s = arguments[i];
      if (typeof s === 'string' && s.trim()) return s.trim();
    }
    return '';
  }
  function esc(s) {
    return str(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ── Preview switch ──
  // Returns {on, persist}: persist is '1' or '0' when the URL asked for a
  // change the page should remember, else null.
  function previewState(search, stored) {
    var m = /[?&]wo=([^&#]*)/.exec(str(search));
    if (m) {
      var v = lower(m[1].replace(/%20|\+/g, ''));
      if (v === 'preview') return { on: true, persist: '1' };
      if (v === 'live') return { on: false, persist: '0' };
    }
    return { on: str(stored) === '1', persist: null };
  }

  function eligibleType(type) { return ELIGIBLE_TYPES.indexOf(lower(type)) >= 0; }

  // Which way "Create work order" goes for a job: 'job' (the one job work
  // order, on the job page) for a fencing or patio job while the preview is on,
  // else 'crew' (the old office form, unchanged: repairs, make-safe, builder
  // crew work orders, and every job while the preview is off).
  function createRoute(type, previewOn) {
    return previewOn && eligibleType(type) ? 'job' : 'crew';
  }

  // ── Numbers and dates ──
  function numWords(n) {
    if (!isFinite(n)) return '';
    var r = Math.round(n * 100) / 100;
    return String(r);
  }
  function hoursWords(h) {
    if (h == null || !isFinite(h)) return '';
    return numWords(h) + ' h';
  }
  function moneyWords(n) {
    var v = num(n);
    if (!isFinite(v)) return '';
    var neg = v < 0;
    var parts = Math.abs(Math.round(v * 100) / 100).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + parts[0] + '.' + parts[1];
  }
  function toMs(v) {
    if (v == null || v === '') return NaN;
    var s = str(v).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) - PERTH_MS;
    s = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2').replace(/([+-]\d{2})$/, '$1:00');
    var t = Date.parse(s);
    return isFinite(t) ? t : NaN;
  }
  // "13 Oct 2026" in Perth, whatever zone the browser is in.
  function dateWords(v) {
    var ms = toMs(v);
    if (!isFinite(ms)) return '';
    var d = new Date(ms + PERTH_MS);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  // ── One scope line ──
  // The backend line builder fills work_orders.scope_items from the accepted
  // quote. Exactly these keys are read (docs/job-work-order-screens.md):
  //   description, qty, unit, kind, notes   the scope line (backend #1022)
  //   hours                                 a line priced in hours (unit h /
  //                                         hr / hrs / hour / hours) is its
  //                                         own hours
  //   rate_ex, allocation_ex                Ops only
  //   variation_number, variation_label,    a variation addendum
  //   variation_approved_at, is_variation
  function lineOf(item) {
    var it = obj(item) || {};
    var unit = firstText(it.unit);
    var qty = firstNum(it.qty);
    var hours = firstNum(it.hours);
    var unitIsHours = HOUR_UNITS.indexOf(lower(unit)) >= 0;
    if (hours == null && unitIsHours && qty != null) hours = qty;
    var number = firstNum(it.variation_number);
    var label = firstText(it.variation_label);
    return {
      task: firstText(it.description),
      qty: qty,
      unit: unit,
      unitIsHours: unitIsHours,
      hours: hours,
      kind: lower(it.kind),
      notes: firstText(it.notes),
      // The quote line builder (backend docs/quote-work-order-lines-v1.md)
      // sends total, rate and rate_unit ('m', 'each', 'hr', 'pct', ...);
      // allocation_ex / rate_ex are read first where a line carries them.
      allocationEx: firstNum(it.allocation_ex, it.total),
      rateEx: firstNum(it.rate_ex, it.rate),
      rateUnit: firstText(it.rate_unit),
      // false: the quote's labour figure is not made of this line, so the
      // agreed labour does not include it (removal, an uncertain extra).
      counted: it.counted === false ? false : (it.counted === true ? true : null),
      addendumKey: number != null ? 'n:' + number : (label ? 'label:' + lower(label) : ''),
      addendumLabel: label,
      addendumNumber: number,
      addendumAt: firstText(it.variation_approved_at),
      isVariation: it.is_variation === true || number != null
    };
  }

  // A labour line whose quantity is a lump ("Root removal, 1 job") with no
  // hours on it: the captain's example of an unclear work order line.
  function needsHours(line) {
    if (!line || line.hours != null) return false;
    if (line.kind && line.kind !== 'labour') return false;
    return LUMP_UNITS.indexOf(lower(line.unit)) >= 0 || (!line.unit && line.qty != null && line.qty <= 1);
  }

  // Quantity as quoted: "37.6 m", "21 each". A line priced in hours shows its
  // hours in the hours column instead, so it has no quantity text.
  function qtyWords(line) {
    if (!line || line.unitIsHours) return '';
    if (line.qty == null) return line.unit || '';
    return numWords(line.qty) + (line.unit ? ' ' + line.unit : '');
  }

  // The approved lines first, then each variation as its own marked addendum,
  // in the order they appear. The approved lines are never mixed with one.
  // extra: the work order's addenda[] as the backend sends them (approved
  // customer variations, see addendaOf); one with the same number as a
  // variation line in scope_items replaces that group.
  function groupLines(items, extra) {
    var base = [];
    var addenda = [];
    var byKey = {};
    arr(items).forEach(function (item) {
      var line = lineOf(item);
      if (!line.task && line.qty == null && line.hours == null) return;
      if (!line.addendumKey) { base.push(line); return; }
      var g = byKey[line.addendumKey];
      if (!g) {
        g = { key: line.addendumKey, number: line.addendumNumber, label: line.addendumLabel, at: line.addendumAt, lines: [] };
        byKey[line.addendumKey] = g;
        addenda.push(g);
      }
      if (!g.at && line.addendumAt) g.at = line.addendumAt;
      g.lines.push(line);
    });
    addenda.forEach(function (g, i) {
      var n = g.number != null ? g.number : i + 1;
      g.title = g.label || ('Variation ' + numWords(n));
    });
    var sent = arr(extra);
    if (sent.length) {
      var numbers = {};
      sent.forEach(function (a) { if (a.number != null) numbers['n:' + a.number] = true; });
      addenda = addenda.filter(function (g) { return !numbers[g.key]; }).concat(sent);
      addenda.sort(function (a, b) {
        if (a.number == null || b.number == null) return 0;
        return a.number - b.number;
      });
    }
    return { base: base, addenda: addenda };
  }

  // ── Customer variations as addenda ──
  // The backend sends each approved customer variation as an addendum of the
  // work order (secureworks-backend docs/job-work-orders-v1.md, "Customer
  // variations"): staff reads (job_detail.job_work_order.addenda, the
  // job_work_order read) as
  //   {id, variation_number, label, approved_at, approved_by, description,
  //    lines[], hours_total, trade_allocation_ex, customer_price_ex}
  // and the trade read (my_job_work_order work_order.addenda) as
  //   {variation_number, label, approved_at, description, scope_items[]}.
  // label reads "Variation 1 - approved 13 Oct 2026". Each line is a scope
  // line {description, qty, unit, hours, is_variation, variation_number}.
  // opts.money (Ops only) also reads the allocation and the customer price;
  // without it no money field is read at all.
  function addendaOf(list, opts) {
    var money = !!(opts && opts.money);
    var out = [];
    arr(list).forEach(function (a, i) {
      var ad = obj(a);
      if (!ad) return;
      var number = firstNum(ad.variation_number);
      var lines = [];
      arr(ad.scope_items).concat(arr(ad.lines)).forEach(function (item) {
        var line = lineOf(item);
        if (!line.task && line.qty == null && line.hours == null) return;
        line.isVariation = true;
        if (!money) { line.allocationEx = null; line.rateEx = null; line.rateUnit = ''; }
        lines.push(line);
      });
      var g = {
        key: number != null ? 'n:' + number : 'addendum:' + i,
        number: number,
        label: firstText(ad.label),
        at: firstText(ad.approved_at),
        description: firstText(ad.description),
        lines: lines,
        fromServer: true
      };
      g.title = g.label || ('Variation ' + (number != null ? numWords(number) : numWords(i + 1)));
      if (money) {
        g.tradeAllocationEx = firstNum(ad.trade_allocation_ex);
        g.customerPriceEx = firstNum(ad.customer_price_ex);
      }
      out.push(g);
    });
    return out;
  }

  function hoursTotal(lines) {
    var total = 0;
    var any = false;
    var without = 0;
    arr(lines).forEach(function (l) {
      if (l.hours != null) { total += l.hours; any = true; } else without++;
    });
    return { hours: any ? Math.round(total * 100) / 100 : null, without: without };
  }

  function allocationTotal(lines) {
    var total = 0;
    var any = false;
    arr(lines).forEach(function (l) { if (l.allocationEx != null && l.counted !== false) { total += l.allocationEx; any = true; } });
    return any ? Math.round(total * 100) / 100 : null;
  }

  // A line's rate in words (office only): "$35.00/m", "$80.00/h", "10%".
  function rateWords(l) {
    if (!l || l.rateEx == null) return '';
    var u = lower(l.rateUnit);
    if (u === 'pct' || u === '%') return numWords(l.rateEx) + '%';
    if (HOUR_UNITS.indexOf(u) >= 0) return moneyWords(l.rateEx) + '/h';
    if (u) return moneyWords(l.rateEx) + '/' + l.rateUnit;
    return moneyWords(l.rateEx) + (l.unitIsHours || l.hours != null ? '/h' : (l.unit ? '/' + l.unit : ''));
  }

  // ── The job's work order as job_detail.job_work_order carries it ──
  function statusOf(block) {
    if (!block) return { key: 'not_applicable', label: '' };
    if (block.unreadable) return { key: 'unreadable', label: 'Could not be read' };
    var wo = obj(block.work_order);
    if (!wo) return { key: 'none', label: 'No work order yet' };
    if (wo.status === 'approved') return { key: 'approved', label: 'Approved and sealed' };
    if (wo.status === 'draft') return { key: 'draft', label: 'Draft, not approved' };
    return { key: lower(wo.status) || 'unknown', label: str(wo.status) || 'Unknown status' };
  }

  // What a draft still needs before it can be approved: the agreed labour and
  // some scope (a task line or the special instructions). The server checks
  // the same two things and refuses 422 work_order_not_ready.
  function missingForApproval(wo) {
    var w = obj(wo) || {};
    var missing = [];
    if (!isFinite(num(w.agreed_labour_ex))) missing.push('the agreed labour');
    var hasScope = arr(w.scope_items).length > 0 || firstText(w.special_instructions) !== '';
    if (!hasScope) missing.push('a task line or the special instructions');
    return missing;
  }

  function isApprover(email) { return APPROVER_EMAILS.indexOf(lower(email)) >= 0; }

  function canApprove(wo, viewerEmail) {
    var w = obj(wo);
    return !!(w && w.status === 'draft' && w.id && w.updated_at && isApprover(viewerEmail));
  }

  // approve_work_order refusals, in words (codes: docs/job-work-orders-v1.md).
  var REFUSALS = {
    stale_review: 'The draft changed after it was read. It has been read again: check it, then approve.',
    expected_updated_at_required: 'The draft has been read again: check it, then approve.',
    approver_required: 'Only Shaun approves job work orders.',
    approver_identity_missing: 'Approving needs Shaun\'s own signed-in session.',
    approver_not_set: 'No work order approver is named, so nobody can approve.',
    terminal_approval_switched_off: 'Approving from the terminal is switched off. Approve from the Ops dashboard.',
    work_order_not_ready: 'It needs the agreed labour and a task line or instructions before it can be approved.',
    not_a_draft: 'This work order is already approved.',
    work_order_not_found: 'This work order was not found.',
    not_a_job_work_order: 'That is a crew work order, not the job\'s work order.'
  };
  function refusalWords(code, message) {
    return REFUSALS[str(code)] || str(message) || 'The work order could not be approved.';
  }
  // A refusal after which the draft must be read again before anyone approves.
  function refusalNeedsReread(code) {
    return code === 'stale_review' || code === 'expected_updated_at_required' || code === 'not_a_draft';
  }

  // create_work_order {kind:'job'} (open the job's draft) refusals, in words.
  var OPEN_REFUSALS = {
    job_type_not_eligible: 'Job work orders are for fencing and patio jobs.',
    work_order_sealed: 'This job\'s work order is already approved and sealed. A later change is a variation.',
    draft_not_created: 'The draft could not be opened. Try again.',
    draft_not_updated: 'The draft could not be opened. Try again.',
    not_a_draft: 'This job\'s work order is already approved and sealed.'
  };
  function openRefusalWords(code, message) {
    return OPEN_REFUSALS[str(code)] || str(message) || 'The draft could not be opened.';
  }
  // A refusal that means the job already has a work order the page has not shown.
  function openRefusalNeedsReread(code) {
    return code === 'work_order_sealed' || code === 'not_a_draft';
  }
  // What opening the draft did, from the answer's quote_fill.reason.
  function openedWords(res) {
    var fill = res && obj(res.quote_fill);
    var reason = fill ? str(fill.reason) : '';
    var opened = res && res.created === false ? 'The draft was already open' : 'Draft opened';
    if (reason === 'filled') return opened + ', filled from the accepted quote. Check it, then approve.';
    if (reason === 'no_accepted_quote') return opened + '. The job has no accepted quote to fill it from.';
    if (reason === 'no_quote_lines') return opened + '. The accepted quote has no labour lines to fill it from.';
    return opened + '.';
  }

  // ── Customer variations (the office's record; staff only) ──
  // One row of customer_variations[] on the staff job_work_order read, or the
  // customer_variation of a write: {id, status, variation_number, label,
  // description, tasks[{description, hours, qty?, unit?}], hours_total,
  // trade_allocation_ex, customer_price_ex, updated_at, approved_at,
  // cancelled_at, cancel_reason, invoice}.
  function customerVariationStatus(v) {
    var c = obj(v) || {};
    if (c.status === 'approved') {
      var n = firstNum(c.variation_number);
      return { key: 'approved', label: firstText(c.label) || (n != null ? 'Variation ' + numWords(n) + ' - approved' : 'Approved') };
    }
    if (c.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled' };
    if (c.status === 'draft') return { key: 'draft', label: 'Draft, not approved' };
    return { key: lower(c.status) || 'unknown', label: str(c.status) || 'Unknown status' };
  }

  // What a draft still needs before it can be approved; the server checks the
  // same and refuses 422 variation_not_ready.
  function customerVariationMissing(v) {
    var c = obj(v) || {};
    var missing = [];
    var tasks = arr(c.tasks);
    var allHours = tasks.length > 0 && tasks.every(function (t) { return num(t && t.hours) > 0; });
    if (!allHours) missing.push('a task with its hours');
    if (!isFinite(num(c.trade_allocation_ex))) missing.push('the trade allocation');
    if (!isFinite(num(c.customer_price_ex))) missing.push('the customer price');
    return missing;
  }

  // The approve button: an approver (display hint; the server checks
  // work_order_settings), on a draft read with its updated_at.
  function canApproveCustomerVariation(v, viewerEmail) {
    var c = obj(v);
    return !!(c && c.status === 'draft' && c.id && c.updated_at && isApprover(viewerEmail));
  }

  // Why the approve button is held, in words, or '' when it can be pressed.
  // wo: the job's work order as shown.
  function customerVariationApproveHold(v, wo) {
    var w = obj(wo);
    if (!w || w.status !== 'approved') return 'Approve the work order first: a variation joins an approved work order.';
    var missing = customerVariationMissing(v);
    return missing.length ? 'Still needs ' + missing.join(', ') + '.' : '';
  }

  // The form, as typed: {description, tasks:[{description, hours, qty, unit}],
  // trade_allocation_ex, customer_price_ex}, every value a string. Returns
  // {fields, errors}: fields in the create/update input shape (amounts null
  // when left empty), errors in words. A task row left wholly blank is dropped.
  function customerVariationFields(values) {
    var v = obj(values) || {};
    var errors = [];
    var description = str(v.description).trim();
    if (!description) errors.push('Describe the variation.');
    else if (description.length > 2000) errors.push('The description is longer than 2000 characters.');
    if (description.indexOf('$') >= 0) errors.push('Leave prices out of the description: trades read it.');
    var tasks = [];
    arr(v.tasks).forEach(function (t) {
      var row = obj(t) || {};
      var text = str(row.description).trim();
      var hoursText = str(row.hours).trim();
      var qtyText = str(row.qty).trim();
      var unit = str(row.unit).trim();
      if (!text && !hoursText && !qtyText && !unit) return;
      var n = tasks.length + 1;
      var task = { description: text };
      if (!text) errors.push('Task ' + n + ' needs its words.');
      else if (text.length > 500) errors.push('Task ' + n + ' is longer than 500 characters.');
      if (text.indexOf('$') >= 0 || unit.indexOf('$') >= 0) errors.push('Leave prices out of task ' + n + ': trades read it.');
      var hours = Number(hoursText);
      if (!hoursText || !isFinite(hours) || hours <= 0 || hours > 1000) errors.push('Task ' + n + ' needs the hours it takes (more than 0).');
      else task.hours = Math.round(hours * 100) / 100;
      if (qtyText || unit) {
        var qty = Number(qtyText);
        if (!qtyText || !isFinite(qty) || qty <= 0 || !unit || unit.length > 20) {
          errors.push('Task ' + n + ': give a quantity with its unit (for example 6 and m), or neither.');
        } else {
          task.qty = Math.round(qty * 100) / 100;
          task.unit = unit;
        }
      }
      tasks.push(task);
    });
    if (tasks.length > 50) errors.push('A variation holds at most 50 tasks.');
    function amount(text, words) {
      var s = str(text).replace(/[$,\s]/g, '');
      if (!s) return null;
      var n = Number(s);
      if (!isFinite(n) || n < 0 || n > 10000000) { errors.push(words + ' must be a dollar amount of zero or more, ex GST.'); return null; }
      return Math.round(n * 100) / 100;
    }
    var fields = {
      description: description,
      tasks: tasks,
      trade_allocation_ex: amount(v.trade_allocation_ex, 'The trade allocation'),
      customer_price_ex: amount(v.customer_price_ex, 'The customer price')
    };
    return { fields: fields, errors: errors };
  }

  // The form's starting values: blank for a new variation, else the draft's.
  function customerVariationFormValues(v) {
    var c = obj(v);
    if (!c) return { description: '', tasks: [{ description: '', hours: '', qty: '', unit: '' }], trade_allocation_ex: '', customer_price_ex: '' };
    var tasks = arr(c.tasks).map(function (t) {
      var r = obj(t) || {};
      return { description: str(r.description), hours: r.hours == null ? '' : str(r.hours), qty: r.qty == null ? '' : str(r.qty), unit: str(r.unit) };
    });
    if (!tasks.length) tasks.push({ description: '', hours: '', qty: '', unit: '' });
    return {
      description: str(c.description),
      tasks: tasks,
      trade_allocation_ex: c.trade_allocation_ex == null ? '' : str(c.trade_allocation_ex),
      customer_price_ex: c.customer_price_ex == null ? '' : str(c.customer_price_ex)
    };
  }

  // Customer variation refusals, in words (codes: docs/job-work-orders-v1.md).
  var CV_REFUSALS = {
    stale_review: 'The variation changed after it was read. It has been read again: check it, then try again.',
    expected_updated_at_required: 'The variation has been read again: check it, then try again.',
    variation_sealed: 'This variation is no longer a draft, so it cannot change. Record a further variation instead.',
    not_a_draft: 'This variation is no longer a draft.',
    work_order_not_approved: 'Approve the work order first: a variation joins an approved work order.',
    variation_not_ready: 'It needs every task with its hours, the trade allocation and the customer price before it can be approved.',
    approver_required: 'Only Shaun approves variations to a work order.',
    approver_identity_missing: 'Approving needs Shaun\'s own signed-in session.',
    approver_not_set: 'No work order approver is named, so nobody can approve.',
    terminal_approval_switched_off: 'Approving from the terminal is switched off. Approve from the Ops dashboard.',
    actor_identity_missing: 'A variation records who wrote it: sign in again, then try again.',
    job_type_not_eligible: 'Variations on a work order are for fencing and patio jobs.',
    money_in_text: 'Leave prices out of the words: trades read them.',
    invalid_tasks: 'Every task needs its words and the hours it takes, and a quantity only with its unit.',
    invalid_description: 'Describe the variation (at most 2000 characters).',
    nothing_to_update: 'Nothing was changed.',
    customer_variation_not_found: 'This variation was not found.',
    variation_not_approved: 'Only an approved variation has a customer invoice line.',
    no_customer_charge: 'This variation charges the customer nothing, so it has no invoice line.'
  };
  function customerVariationRefusalWords(code, message) {
    return CV_REFUSALS[str(code)] || str(message) || 'The variation could not be saved.';
  }
  // A refusal after which the variations must be read again.
  function customerVariationNeedsReread(code) {
    return ['stale_review', 'expected_updated_at_required', 'variation_sealed', 'not_a_draft', 'work_order_not_approved', 'customer_variation_not_found'].indexOf(str(code)) >= 0;
  }

  // The old office "New Work Order" form, when a fencing or patio job is picked
  // while the preview is on: it makes no work order for that job and points to
  // the job work order instead. job: {id, job_number, type}.
  function crewFormNoticeHtml(job) {
    var j = obj(job) || {};
    var kind = lower(j.type) === 'patio' ? 'a patio job' : 'a fencing job';
    return '<div class="jwo-redirect" data-wo-form-job-wo>' +
      '<div>' + (j.job_number ? '<b>' + esc(j.job_number) + '</b> is ' : 'This is ') + kind +
      '. Fencing and patio jobs have one work order, made from the accepted quote on the job page, so this form does not make one for it.</div>' +
      '<button type="button" class="btn btn-primary btn-sm" data-wo-form-open-job-wo data-job-id="' + esc(j.id) + '" onclick="JobWorkOrderOps.openFromForm(this.getAttribute(\'data-job-id\'))">Open the job work order</button>' +
      '</div>';
  }

  // ── Ops panel (office staff) ──
  // block: job_detail.job_work_order. detail: the job_work_order read (null
  // while it loads), detailState: 'loading' | 'ready' | 'failed'.
  // opts: {viewerEmail, busy, message, messageLevel, preview}
  function renderOpsPanel(block, detail, detailState, opts) {
    opts = opts || {};
    var st = statusOf(block);
    if (st.key === 'not_applicable') return '';
    var h = '<div class="jwo" data-job-wo-panel data-job-wo-status="' + esc(st.key) + '">';
    var wo = (detail && obj(detail.work_order)) || (block && obj(block.work_order)) || null;
    h += '<div class="jwo-head">';
    h += '<div class="jwo-title">Work order' + (wo && wo.wo_number ? ' <b>' + esc(wo.wo_number) + '</b>' : '') + '</div>';
    if (st.label) h += '<span class="jwo-chip jwo-chip-' + esc(st.key) + '" data-job-wo-chip>' + esc(st.label) + '</span>';
    if (opts.preview) h += '<span class="jwo-preview">Preview</span>';
    h += '<div class="jwo-actions">';
    if (wo) h += '<button type="button" class="btn btn-secondary btn-sm" data-job-wo-pdf onclick="JobWorkOrderOps.openPdf()">Work order PDF</button>';
    if (canApprove(wo, opts.viewerEmail)) {
      var missing = missingForApproval(wo);
      var dis = opts.busy || missing.length > 0;
      h += '<button type="button" class="btn btn-primary btn-sm" data-job-wo-approve' + (dis ? ' disabled' : '') +
        ' onclick="JobWorkOrderOps.approve()">' + (opts.busy ? 'Approving...' : 'Approve and seal') + '</button>';
    }
    h += '</div></div>';

    if (opts.message) {
      h += '<div class="jwo-msg jwo-msg-' + esc(opts.messageLevel || 'info') + '" data-job-wo-message>' + esc(opts.message) + '</div>';
    }

    if (st.key === 'unreadable') {
      h += '<div class="jwo-empty" data-job-wo-unreadable>The work order could not be read. Reopen the job to try again.</div></div>';
      return h;
    }
    if (st.key === 'none') {
      if (opts.canOpen) {
        h += '<div class="jwo-empty" data-job-wo-none>No work order on this job yet. Open its draft: it fills from the accepted quote, then Shaun approves it.</div>' +
          '<button type="button" class="btn btn-primary btn-sm" data-job-wo-open' + (opts.busy ? ' disabled' : '') +
          ' onclick="JobWorkOrderOps.openDraft()">' + (opts.busy ? 'Opening...' : 'Open the draft') + '</button></div>';
      } else {
        h += '<div class="jwo-empty" data-job-wo-none>No work order on this job yet. One opens as a draft when the job is approved.</div></div>';
      }
      return h;
    }

    if (st.key === 'approved') {
      h += '<div class="jwo-sub">Approved' + (wo.approved_at ? ' ' + esc(dateWords(wo.approved_at)) : '') +
        '. Sealed: nothing on it can change. A later change joins it as a variation.</div>';
    } else if (st.key === 'draft') {
      var miss = missingForApproval(wo);
      h += '<div class="jwo-sub">Draft. Nothing counts against it until Shaun approves it' +
        (miss.length ? '. Still needs ' + esc(miss.join(' and ')) : '') + '.</div>';
    }

    var groups = groupLines(wo.scope_items, addendaOf(staffAddenda(block, detail), { money: true }));
    h += renderOpsLines(groups.base, 'Task lines', '');
    if (!groups.base.length) {
      h += '<div class="jwo-empty" data-job-wo-no-lines>No task lines yet. They come from the accepted quote' +
        (st.key === 'draft' ? '; this draft has none so far.' : '.') + '</div>';
    }
    groups.addenda.forEach(function (g) {
      h += renderOpsAddendum(g);
    });

    if (firstText(wo.special_instructions)) {
      h += '<div class="jwo-k">Special instructions</div><div class="jwo-instr">' + esc(wo.special_instructions) + '</div>';
    }

    h += renderOpsFigures(block, detail, detailState, wo, st.key);
    h += renderOpsCustomerVariations(block, detail, detailState, wo, opts);
    h += renderOpsReportedVariations(detail, detailState);
    h += '</div>';
    return h;
  }

  // The addenda as the freshest staff read has them: the job_work_order read
  // once it has landed, else the copy job_detail carried.
  function staffAddenda(block, detail) {
    if (detail && Array.isArray(detail.addenda)) return detail.addenda;
    return (block && arr(block.addenda)) || [];
  }

  // One addendum, under the approved lines and never mixed into them: its
  // label ("Variation 1 - approved 13 Oct 2026"), what the office wrote, its
  // tasks with hours, and (office only) the trade allocation and the price.
  function renderOpsAddendum(g) {
    var sub = g.fromServer && g.label ? 'Addendum' : (g.at ? 'Approved ' + dateWords(g.at) : '');
    var h = '<div class="jwo-addendum" data-job-wo-addendum' + (g.number != null ? ' data-variation-number="' + esc(g.number) + '"' : '') + '>';
    h += '<div class="jwo-k" data-job-wo-addendum-title>' + esc(g.title) + (sub ? '<span class="jwo-k-sub">' + esc(sub) + '</span>' : '') + '</div>';
    if (g.description) h += '<div class="jwo-add-desc">' + esc(g.description) + '</div>';
    h += renderOpsLines(g.lines, null, '');
    var money = [];
    if (g.tradeAllocationEx != null) money.push('Trade allocation ' + moneyWords(g.tradeAllocationEx));
    if (g.customerPriceEx != null) money.push('Customer price ' + moneyWords(g.customerPriceEx) + ' ex GST');
    if (money.length) h += '<div class="jwo-add-money" data-job-wo-addendum-money>' + esc(money.join(DOT)) + '</div>';
    h += '</div>';
    return h;
  }

  function renderOpsLines(lines, title, sub) {
    if (!lines.length) return '';
    var showMoney = lines.some(function (l) { return l.allocationEx != null || l.rateEx != null; });
    var h = title == null ? '' : '<div class="jwo-k">' + esc(title) + (sub ? '<span class="jwo-k-sub">' + esc(sub) + '</span>' : '') + '</div>';
    h += '<table class="jwo-table" data-job-wo-lines><thead><tr><th>Task</th><th>Quantity</th><th class="r">Hours</th>' +
      (showMoney ? '<th class="r">Allocation</th>' : '') + '</tr></thead><tbody>';
    lines.forEach(function (l) {
      var flag = needsHours(l);
      h += '<tr' + (flag ? ' class="jwo-needs-hours"' : '') + '>';
      h += '<td>' + esc(l.task || 'Untitled task') + (l.notes ? '<div class="jwo-line-note">' + esc(l.notes) + '</div>' : '') + '</td>';
      h += '<td>' + esc(qtyWords(l)) + '</td>';
      h += '<td class="r">' + (l.hours != null ? esc(hoursWords(l.hours)) : (flag ? '<span class="jwo-warn" title="A lump-sum line with no hours on it">No hours</span>' : '')) + '</td>';
      if (showMoney) {
        var alloc = l.allocationEx != null ? moneyWords(l.allocationEx) : '';
        var rate = rateWords(l);
        h += '<td class="r">' + esc(alloc) + (rate ? '<div class="jwo-line-note">' + esc(rate) + '</div>' : '') +
          (l.counted === false && l.allocationEx != null ? '<div class="jwo-line-note" data-job-wo-not-counted>Not in the agreed labour</div>' : '') + '</td>';
      }
      h += '</tr>';
    });
    var t = hoursTotal(lines);
    var a = allocationTotal(lines);
    h += '</tbody><tfoot><tr><td>Total</td><td></td><td class="r" data-job-wo-total-hours>' +
      (t.hours != null ? esc(hoursWords(t.hours)) : '') + '</td>' +
      (showMoney ? '<td class="r">' + esc(a != null ? moneyWords(a) : '') + '</td>' : '') + '</tr></tfoot></table>';
    return h;
  }

  function figureCell(label, value, cls) {
    return '<div class="jwo-fig' + (cls ? ' ' + cls : '') + '"><div class="jwo-fig-k">' + esc(label) + '</div><div class="jwo-fig-v">' + esc(value) + '</div></div>';
  }

  function renderOpsFigures(block, detail, detailState, wo, statusKey) {
    var f = (detail && obj(detail.figures)) || (block && obj(block.figures)) || null;
    var h = '<div class="jwo-figs" data-job-wo-figures>';
    if (statusKey === 'approved' && f) {
      h += figureCell('Agreed labour', moneyWords(f.agreed_ex) || 'Not set');
      // Approved customer variations add their trade allocation to what billed
      // is measured against (figures.agreed_total_ex).
      var cvCount = num(f.customer_variation_count);
      if (cvCount > 0) {
        h += figureCell('Approved variations', moneyWords(f.customer_variations_ex) + DOT + cvCount);
        h += '<div class="jwo-fig" data-job-wo-agreed-total><div class="jwo-fig-k">Agreed total</div><div class="jwo-fig-v">' +
          esc(moneyWords(f.agreed_total_ex) || moneyWords(f.agreed_ex) || 'Not set') + '</div></div>';
      }
      h += figureCell('Billed to date', moneyWords(f.billed_to_date_ex) || '$0.00');
      h += figureCell('Remaining', f.remaining_ex == null ? '' : moneyWords(f.remaining_ex), f.over_agreed ? 'jwo-fig-over' : '');
    } else {
      var agreed = num(wo && wo.agreed_labour_ex);
      h += figureCell('Agreed labour (draft)', isFinite(agreed) ? moneyWords(agreed) : 'Not set');
      var before = detail && obj(detail.labour_before_approval);
      if (before) {
        h += figureCell('Billed before approval', moneyWords(before.amount_ex) + DOT + before.line_count + ' line' + (before.line_count === 1 ? '' : 's'));
      } else if (detailState === 'loading') {
        h += figureCell('Billed before approval', 'Loading');
      }
    }
    h += '</div>';
    var rules = f ? arr(f.rules).filter(function (r) { return r && r.key !== 'no_approved_work_order'; }) : [];
    rules.forEach(function (r) {
      h += '<div class="jwo-rule jwo-rule-' + esc(r.level) + '" data-job-wo-rule="' + esc(r.key) + '">' + esc(r.message) + '</div>';
    });
    if (statusKey !== 'approved' && detail && obj(detail.labour_before_approval) && num(detail.labour_before_approval.amount_ex) > 0) {
      h += '<div class="jwo-rule jwo-rule-info">' + esc(detail.labour_before_approval.note || '') + '</div>';
    }
    if (detailState === 'failed') {
      h += '<div class="jwo-rule jwo-rule-warn" data-job-wo-detail-failed>The billed lines and reported variations could not be read just now.</div>';
    }
    return h;
  }

  // ── Customer variations section (office staff) ──
  // The list comes from the job_work_order read (customer_variations[], every
  // status). opts.cv is the screen's state: {form: {mode:'create'|'edit', id,
  // values, errors} or null, confirm: {kind:'approve'|'cancel', id} or null,
  // busy, previews: {variation id: prepare answer}, previewBusyId}.
  function renderOpsCustomerVariations(block, detail, detailState, wo, opts) {
    opts = opts || {};
    var ui = obj(opts.cv) || {};
    var list = detail && Array.isArray(detail.customer_variations) ? detail.customer_variations : null;
    var h = '<div class="jwo-cv" data-job-wo-cv>';
    h += '<div class="jwo-k">Customer variations' + (list && list.length ? '<span class="jwo-k-sub">' + list.length + '</span>' : '') + '</div>';
    h += '<div class="jwo-sub">Extra work the customer agreed to. Once Shaun approves one it joins this work order as the next numbered addendum; the lines above never change. Trades see its tasks and hours, never an amount.</div>';
    if (ui.message) {
      h += '<div class="jwo-msg jwo-msg-' + esc(ui.level || 'info') + '" data-job-wo-cv-message>' + esc(ui.message) + '</div>';
    }
    if (!list) {
      var open = num(block && block.customer_variations_open_count);
      if (detailState === 'failed') {
        h += '<div class="jwo-rule jwo-rule-warn" data-job-wo-cv-failed>The customer variations could not be read just now. Reopen the job to try again.</div>';
      } else {
        h += '<div class="jwo-empty" data-job-wo-cv-loading>Loading the variations' + (open > 0 ? ' (' + open + ' recorded)' : '') + '...</div>';
      }
      return h + '</div>';
    }
    list.forEach(function (v) { h += renderCustomerVariationRow(v, wo, ui, opts.viewerEmail); });
    var form = obj(ui.form);
    if (form && form.mode === 'create') {
      h += renderCustomerVariationForm(form, ui.busy);
    } else {
      h += '<button type="button" class="btn btn-secondary btn-sm" data-job-wo-cv-add' + (ui.busy || form ? ' disabled' : '') +
        ' onclick="JobWorkOrderOps.cvAdd()">Add a variation</button>';
    }
    return h + '</div>';
  }

  function renderCustomerVariationRow(v, wo, ui, viewerEmail) {
    var c = obj(v) || {};
    var st = customerVariationStatus(c);
    var id = esc(c.id);
    var h = '<div class="jwo-cv-row jwo-cv-' + esc(st.key) + '" data-job-wo-cv-row data-cv-id="' + id + '" data-cv-status="' + esc(st.key) + '">';
    h += '<div class="jwo-cv-head"><span class="jwo-chip jwo-chip-' + esc(st.key === 'cancelled' ? 'unreadable' : st.key) + '" data-job-wo-cv-chip>' + esc(st.label) + '</span>' +
      '<span class="jwo-cv-desc">' + esc(c.description || '') + '</span></div>';
    var form = obj(ui.form);
    if (form && form.mode === 'edit' && form.id === c.id) {
      return h + renderCustomerVariationForm(form, ui.busy) + '</div>';
    }
    var tasks = arr(c.tasks);
    if (tasks.length) {
      h += '<ul class="jwo-cv-tasks">';
      tasks.forEach(function (t) {
        var line = lineOf(t);
        var q = qtyWords(line);
        h += '<li>' + esc(line.task || 'Task') + (q ? DOT + esc(q) : '') + (line.hours != null ? DOT + esc(hoursWords(line.hours)) : '') + '</li>';
      });
      h += '</ul>';
    } else {
      h += '<div class="jwo-line-note">No tasks yet.</div>';
    }
    var hoursTotal = num(c.hours_total);
    h += '<div class="jwo-cv-money" data-job-wo-cv-money>' +
      (isFinite(hoursTotal) && hoursTotal > 0 ? esc(hoursWords(hoursTotal)) + DOT : '') +
      'Trade allocation ' + esc(moneyWords(c.trade_allocation_ex) || 'not set') + DOT +
      'Customer price ' + esc(moneyWords(c.customer_price_ex) || 'not set') + ' ex GST</div>';
    var meta = [];
    if (c.created_at) meta.push('Recorded ' + dateWords(c.created_at));
    if (st.key === 'cancelled' && c.cancelled_at) meta.push('Cancelled ' + dateWords(c.cancelled_at) + (firstText(c.cancel_reason) ? ': ' + firstText(c.cancel_reason) : ''));
    if (meta.length) h += '<div class="jwo-line-note">' + esc(meta.join(DOT)) + '</div>';

    var confirm = obj(ui.confirm);
    if (confirm && confirm.id === c.id) {
      h += renderCustomerVariationConfirm(confirm.kind, c, wo, ui.busy);
    } else if (st.key === 'draft') {
      var approver = canApproveCustomerVariation(c, viewerEmail);
      var hold = approver ? customerVariationApproveHold(c, wo) : '';
      var dis = ui.busy || !!form;
      h += '<div class="jwo-cv-actions">';
      h += '<button type="button" class="btn btn-secondary btn-sm" data-job-wo-cv-edit data-cv-id="' + id + '"' + (dis ? ' disabled' : '') +
        ' onclick="JobWorkOrderOps.cvEdit(this.getAttribute(\'data-cv-id\'))">Edit</button>';
      if (approver) {
        h += '<button type="button" class="btn btn-primary btn-sm" data-job-wo-cv-approve data-cv-id="' + id + '"' + (dis || hold ? ' disabled' : '') +
          ' onclick="JobWorkOrderOps.cvApprove(this.getAttribute(\'data-cv-id\'))">Approve</button>';
      }
      h += '<button type="button" class="btn btn-secondary btn-sm" data-job-wo-cv-cancel data-cv-id="' + id + '"' + (dis ? ' disabled' : '') +
        ' onclick="JobWorkOrderOps.cvCancel(this.getAttribute(\'data-cv-id\'))">Cancel variation</button>';
      h += '</div>';
      if (hold) h += '<div class="jwo-rule jwo-rule-info" data-job-wo-cv-hold>' + esc(hold) + '</div>';
    } else if (st.key === 'approved') {
      h += renderCustomerVariationInvoiceLine(c, obj(ui.previews) && ui.previews[c.id], ui.previewBusyId === c.id, ui.busy);
    }
    return h + '</div>';
  }

  function renderCustomerVariationConfirm(kind, c, wo, busy) {
    var id = esc(c.id);
    if (kind === 'approve') {
      return '<div class="jwo-confirm" data-job-wo-cv-confirm="approve">' +
        '<div>Approve this variation as shown? It joins ' + esc((wo && wo.wo_number) || 'the work order') +
        ' as the next numbered addendum and is sealed: it cannot change or be cancelled after.</div>' +
        '<div class="jwo-confirm-actions"><button type="button" class="btn btn-primary btn-sm" data-job-wo-cv-confirm-yes data-cv-id="' + id + '"' + (busy ? ' disabled' : '') +
        ' onclick="JobWorkOrderOps.cvConfirmed()">' + (busy ? 'Approving...' : 'Approve variation') + '</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="JobWorkOrderOps.cvConfirmBack()">Back</button></div></div>';
    }
    return '<div class="jwo-confirm" data-job-wo-cv-confirm="cancel">' +
      '<div>Cancel this draft variation? It stays on the record as cancelled and never joins the work order.</div>' +
      '<input type="text" class="form-input" data-job-wo-cv-cancel-reason maxlength="500" placeholder="Reason (optional)">' +
      '<div class="jwo-confirm-actions"><button type="button" class="btn btn-primary btn-sm" data-job-wo-cv-confirm-yes data-cv-id="' + id + '"' + (busy ? ' disabled' : '') +
      ' onclick="JobWorkOrderOps.cvConfirmed()">' + (busy ? 'Cancelling...' : 'Cancel variation') + '</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" onclick="JobWorkOrderOps.cvConfirmBack()">Keep it</button></div></div>';
  }

  // The customer invoice line of an approved variation, as a preview only:
  // the line prepare_customer_variation_invoice_line builds from the record.
  // This screen never creates the Xero draft (that switch is off).
  function renderCustomerVariationInvoiceLine(c, preview, previewBusy, busy) {
    var h = '<div class="jwo-cv-inv" data-job-wo-cv-invoice>';
    var price = num(c.customer_price_ex);
    if (isFinite(price) && price <= 0) {
      return h + '<div class="jwo-line-note" data-job-wo-cv-no-charge>Charges the customer nothing, so it has no invoice line.</div></div>';
    }
    var p = obj(preview);
    var inv = (p && obj(p.invoice)) || obj(c.invoice);
    var line = (p && obj(p.line)) || (inv && obj(inv.line));
    if (!line) {
      return h + '<button type="button" class="btn btn-secondary btn-sm" data-job-wo-cv-invoice-line data-cv-id="' + esc(c.id) + '"' + (busy || previewBusy ? ' disabled' : '') +
        ' onclick="JobWorkOrderOps.cvInvoiceLine(this.getAttribute(\'data-cv-id\'))">' + (previewBusy ? 'Preparing...' : 'Preview the customer invoice line') + '</button></div>';
    }
    var reference = p && obj(p.create_invoice_draft) ? firstText(p.create_invoice_draft.reference) : '';
    h += '<div class="jwo-k">Customer invoice line<span class="jwo-k-sub">Preview</span></div>';
    h += '<table class="jwo-table" data-job-wo-cv-invoice-preview><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price ex GST</th><th class="r">Account</th></tr></thead><tbody>' +
      '<tr><td class="jwo-instr">' + esc(line.description || '') + '</td><td class="r">' + esc(numWords(num(line.quantity))) + '</td>' +
      '<td class="r">' + esc(moneyWords(line.unit_price)) + '</td><td class="r">' + esc(line.account_code || '') + '</td></tr></tbody></table>';
    if (reference) h += '<div class="jwo-line-note">Reference ' + esc(reference) + '</div>';
    if (inv && inv.status === 'xero_draft_created') {
      h += '<div class="jwo-line-note">In Xero as a draft' + (inv.invoice_number ? ' ' + esc(inv.invoice_number) : '') + '.</div>';
    }
    h += '<div class="jwo-line-note" data-job-wo-cv-invoice-note>Preview only: nothing is sent to Xero from here. Hours, the trade allocation and rates stay off the customer\'s line.</div>';
    return h + '</div>';
  }

  // The add or edit form. form.values as customerVariationFormValues gives.
  function renderCustomerVariationForm(form, busy) {
    var v = obj(form.values) || customerVariationFormValues(null);
    var h = '<div class="jwo-cv-form" data-job-wo-cv-form="' + esc(form.mode) + '">';
    var errors = arr(form.errors);
    if (errors.length) {
      h += '<div class="jwo-msg jwo-msg-error" data-job-wo-cv-errors>' + errors.map(esc).join('<br>') + '</div>';
    }
    h += '<label class="jwo-cv-label">What the customer agreed to<textarea class="form-input" rows="2" maxlength="2000" data-cv-f="description">' + esc(v.description) + '</textarea></label>';
    h += '<div class="jwo-cv-label">Tasks, each with the hours it takes</div>';
    h += '<table class="jwo-table jwo-cv-task-table"><thead><tr><th>Task</th><th class="r">Hours</th><th class="r">Qty (optional)</th><th>Unit</th><th></th></tr></thead><tbody>';
    arr(v.tasks).forEach(function (t, i) {
      var r = obj(t) || {};
      h += '<tr data-cv-task="' + i + '">' +
        '<td><input type="text" class="form-input" maxlength="500" placeholder="Task" data-cv-tf="description" value="' + esc(r.description) + '"></td>' +
        '<td class="r"><input type="number" class="form-input jwo-cv-num" min="0" step="0.25" inputmode="decimal" placeholder="Hours" data-cv-tf="hours" value="' + esc(r.hours) + '"></td>' +
        '<td class="r"><input type="number" class="form-input jwo-cv-num" min="0" step="any" inputmode="decimal" placeholder="Qty" data-cv-tf="qty" value="' + esc(r.qty) + '"></td>' +
        '<td><input type="text" class="form-input jwo-cv-unit" maxlength="20" placeholder="Unit" data-cv-tf="unit" value="' + esc(r.unit) + '"></td>' +
        '<td class="r"><button type="button" class="btn btn-secondary btn-sm" data-job-wo-cv-remove-task data-cv-i="' + i + '"' +
        ' onclick="JobWorkOrderOps.cvRemoveTask(this.getAttribute(\'data-cv-i\'))">Remove</button></td></tr>';
    });
    h += '</tbody></table>';
    h += '<button type="button" class="btn btn-secondary btn-sm" data-job-wo-cv-add-task onclick="JobWorkOrderOps.cvAddTask()">Add a task</button>';
    h += '<div class="jwo-cv-amounts">' +
      '<label class="jwo-cv-label">Trade allocation, ex GST<input type="text" class="form-input" inputmode="decimal" data-cv-f="trade_allocation_ex" value="' + esc(v.trade_allocation_ex) + '"></label>' +
      '<label class="jwo-cv-label">Customer price, ex GST<input type="text" class="form-input" inputmode="decimal" data-cv-f="customer_price_ex" value="' + esc(v.customer_price_ex) + '"></label></div>';
    h += '<div class="jwo-line-note">The amounts are office only: trades see the tasks and hours, never an amount. Leave prices out of the words.</div>';
    h += '<div class="jwo-cv-actions"><button type="button" class="btn btn-primary btn-sm" data-job-wo-cv-save' + (busy ? ' disabled' : '') +
      ' onclick="JobWorkOrderOps.cvSave()">' + (busy ? 'Saving...' : (form.mode === 'edit' ? 'Save changes' : 'Save draft variation')) + '</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-job-wo-cv-close' + (busy ? ' disabled' : '') + ' onclick="JobWorkOrderOps.cvCloseForm()">Back</button></div>';
    return h + '</div>';
  }

  function renderOpsReportedVariations(detail, detailState) {
    var vs = detail ? arr(detail.variations) : [];
    if (!vs.length) return '';
    var h = '<div class="jwo-k">Variations reported by trades<span class="jwo-k-sub">' + vs.length + '</span></div>';
    h += '<div class="jwo-reported" data-job-wo-reported>';
    vs.forEach(function (v) {
      h += '<div class="jwo-rv">';
      h += '<div class="jwo-rv-main"><b>' + esc(v.reported_by_name || 'A trade') + '</b>' + DOT + esc(dateWords(v.created_at)) +
        (v.amount_ex != null ? DOT + esc(moneyWords(v.amount_ex)) : '') + (v.counted ? '' : DOT + 'invoice not billed yet') + '</div>';
      h += '<div class="jwo-rv-desc">' + esc(v.description || '') + '</div>';
      if (v.corrected_at) {
        h += '<div class="jwo-line-note">Corrected ' + esc(dateWords(v.corrected_at)) + '. The trade first reported: ' +
          esc(v.original_description || '') + (v.original_amount_ex != null ? ' (' + esc(moneyWords(v.original_amount_ex)) + ')' : '') + '</div>';
      }
      if (v.over_invoice_labour) h += '<div class="jwo-rule jwo-rule-warn">More than the labour its invoice now bills on this job.</div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  // ── Work Order PDF sections (office printout) ──
  // The stored work order replaces the printout's recomputed labour. Returns
  // {title, scopeHtml, costHtml} built only from the stored work order.
  function pdfSections(block) {
    var st = statusOf(block);
    var wo = block && obj(block.work_order);
    if (!wo) return null;
    // Approved customer variations: the block's addenda[] (job_detail or the
    // job_work_order read), each printed as its own marked addendum.
    var groups = groupLines(wo.scope_items, addendaOf(block.addenda, { money: true }));
    var scope = '';
    if (st.key === 'draft') scope += '<p class="wo-draft">DRAFT: not approved yet. This work order can still change.</p>';
    scope += pdfLines(groups.base, false);
    if (!groups.base.length) scope += '<p style="padding-left:12px;">No task lines on this work order yet.</p>';
    groups.addenda.forEach(function (g) {
      var dated = g.fromServer && g.label ? '' : (g.at ? ' (approved ' + esc(dateWords(g.at)) + ')' : '');
      scope += '<div class="wo-addendum-block" data-wo-addendum style="border-left:3px solid #F15A29;padding-left:10px;margin:12px 0;">';
      scope += '<h3 class="wo-addendum">ADDENDUM: ' + esc(g.title) + dated + '</h3>';
      if (g.description) scope += '<p style="padding-left:12px;">' + esc(g.description).replace(/\n/g, '<br>') + '</p>';
      scope += pdfLines(g.lines, false);
      scope += '</div>';
    });
    if (firstText(wo.special_instructions)) {
      scope += '<p style="padding-left:12px;"><strong>Special instructions:</strong> ' + esc(wo.special_instructions).replace(/\n/g, '<br>') + '</p>';
    }
    var cost = pdfLines(groups.base, true);
    groups.addenda.forEach(function (g) {
      cost += '<h3 class="wo-addendum">' + esc(g.title) + ': addendum</h3>';
      cost += pdfLines(g.lines, g.lines.some(function (l) { return l.allocationEx != null; }));
      if (g.tradeAllocationEx != null) {
        cost += '<table><tbody><tr><td>Trade allocation for this variation</td><td class="text-right">' + moneyWords(g.tradeAllocationEx) + '</td></tr></tbody></table>';
      }
    });
    var f = obj(block.figures) || {};
    cost += '<table><tbody>';
    var agreed = st.key === 'approved' ? num(f.agreed_ex) : num(wo.agreed_labour_ex);
    cost += '<tr class="total-row"><td>Agreed labour' + (st.key === 'approved' ? '' : ' (draft)') + '</td><td class="text-right">' + (isFinite(agreed) ? moneyWords(agreed) : 'Not set') + '</td></tr>';
    if (st.key === 'approved' && num(f.customer_variation_count) > 0) {
      cost += '<tr><td>Approved variations (' + esc(numWords(num(f.customer_variation_count))) + ')</td><td class="text-right">' + moneyWords(f.customer_variations_ex || 0) + '</td></tr>';
      var total = num(f.agreed_total_ex);
      cost += '<tr class="total-row"><td>Agreed total</td><td class="text-right">' + (isFinite(total) ? moneyWords(total) : 'Not set') + '</td></tr>';
    }
    if (st.key === 'approved') {
      cost += '<tr><td>Billed to date</td><td class="text-right">' + moneyWords(f.billed_to_date_ex || 0) + '</td></tr>';
      cost += '<tr><td>Remaining</td><td class="text-right">' + (f.remaining_ex == null ? '' : moneyWords(f.remaining_ex)) + '</td></tr>';
    }
    cost += '</tbody></table>';
    return {
      title: 'Work Order' + (wo.wo_number ? ' ' + esc(wo.wo_number) : ''),
      status: st,
      scopeHtml: scope,
      costHtml: cost
    };
  }

  function pdfLines(lines, money) {
    if (!lines.length) return '';
    var h = '<table data-wo-stored-lines><thead><tr><th>Task</th><th>Quantity</th><th class="text-right">Hours</th>' +
      (money ? '<th class="text-right">Allocation</th>' : '') + '</tr></thead><tbody>';
    lines.forEach(function (l) {
      h += '<tr><td>' + esc(l.task || 'Untitled task') + (l.notes ? '<br><small>' + esc(l.notes) + '</small>' : '') + '</td><td>' + esc(qtyWords(l)) +
        '</td><td class="text-right">' + esc(l.hours != null ? hoursWords(l.hours) : '') + '</td>' +
        (money ? '<td class="text-right">' + esc(l.allocationEx != null ? moneyWords(l.allocationEx) : '') +
          (l.counted === false && l.allocationEx != null ? '<br><small>Not in the agreed labour</small>' : '') + '</td>' : '') + '</tr>';
    });
    var t = hoursTotal(lines);
    h += '<tr class="total-row"><td>Total</td><td></td><td class="text-right">' + esc(t.hours != null ? hoursWords(t.hours) : '') + '</td>' +
      (money ? '<td class="text-right">' + esc(allocationTotal(lines) != null ? moneyWords(allocationTotal(lines)) : '') + '</td>' : '') + '</tr>';
    h += '</tbody></table>';
    return h;
  }

  // ── Trade view (every trade, the lead included): tasks and hours, no money ──
  // read: the my_job_work_order answer, or null while it loads.
  // state: 'loading' | 'ready' | 'failed'.
  function renderTrade(read, state) {
    var h = '<div class="detail-section two" data-trade-job-wo>';
    h += '<h3>Work order</h3>';
    if (state === 'loading') return h + '<div class="two-empty">Loading the work order...</div></div>';
    if (state === 'failed' || !read) return h + '<div class="two-empty" data-trade-job-wo-failed>The work order could not be loaded. Reopen the job to try again, or ask the office.</div></div>';
    var wo = obj(read.work_order);
    if (!wo) return h + '<div class="two-empty" data-trade-job-wo-none>No approved work order on this job yet. The office is preparing it.</div></div>';
    h += '<div class="two-head">' + (wo.wo_number ? '<span class="two-num">' + esc(wo.wo_number) + '</span>' : '') +
      '<span class="two-chip">Approved' + (wo.approved_at ? ' ' + esc(dateWords(wo.approved_at)) : '') + '</span></div>';
    // addendaOf without money: an addendum's description and task lines only.
    var groups = groupLines(wo.scope_items, addendaOf(wo.addenda));
    h += renderTradeLines(groups.base);
    if (!groups.base.length) h += '<div class="two-empty" data-trade-job-wo-no-lines>No task lines on this work order. Ask the office for the scope.</div>';
    groups.addenda.forEach(function (g) {
      var dated = g.fromServer && g.label ? '' : (g.at ? '<span> approved ' + esc(dateWords(g.at)) + '</span>' : '');
      h += '<div class="two-addendum" data-trade-job-wo-addendum' + (g.number != null ? ' data-variation-number="' + esc(g.number) + '"' : '') +
        '><div class="two-add-k">' + esc(g.title) + dated + '</div>';
      if (g.description) h += '<div class="two-add-desc">' + esc(g.description) + '</div>';
      h += renderTradeLines(g.lines, true);
      h += '</div>';
    });
    if (firstText(wo.special_instructions)) {
      h += '<div class="two-instr"><span class="two-k">Instructions</span>' + esc(wo.special_instructions) + '</div>';
    }
    h += '</div>';
    return h;
  }

  // Each task with its hours; a per-metre line shows its quantity as quoted.
  // Reads task, quantity, unit and hours only: never a money field.
  // variation: each line is marked as a variation line.
  function renderTradeLines(lines, variation) {
    if (!lines.length) return '';
    var h = '<div class="two-lines">';
    lines.forEach(function (l) {
      var q = qtyWords(l);
      var marked = variation || l.isVariation;
      h += '<div class="two-line' + (marked ? ' two-var' : '') + '"' + (marked ? ' data-trade-job-wo-variation-line' : '') + '><div class="two-task">' +
        (marked ? '<span class="two-var-tag">Variation</span>' : '') + esc(l.task || 'Task') +
        (q ? '<span class="two-qty">' + esc(q) + '</span>' : '') + '</div>';
      h += '<div class="two-hours">' + (l.hours != null ? esc(hoursWords(l.hours)) : '') + '</div></div>';
    });
    // "Total hours" only when every task has hours; with per-metre lines in
    // the list the sum covers the hourly tasks only and says so.
    var t = hoursTotal(lines);
    if (t.hours != null) {
      h += '<div class="two-line two-total"><div class="two-task">' + (t.without ? 'Hours on hourly tasks' : 'Total hours') +
        '</div><div class="two-hours">' + esc(hoursWords(t.hours)) + '</div></div>';
    }
    h += '</div>';
    return h;
  }

  // The invoice note on a job that has an approved work order: the typed
  // "WO allocated $" box is retired and the trade bills the hours worked.
  function invoiceNote(read) {
    var wo = read && obj(read.work_order);
    if (!wo) return '';
    var t = hoursTotal(groupLinesFlat(wo.scope_items, wo.addenda));
    return 'Work order ' + (wo.wo_number || '') + ' is on this job' +
      (t.hours != null && !t.without ? ' (' + hoursWords(t.hours) + ' of tasks)' : '') +
      '. Bill the hours you worked; the office checks them against the work order.';
  }
  function groupLinesFlat(items, addenda) {
    var g = groupLines(items, addendaOf(addenda));
    return g.base.concat.apply(g.base, g.addenda.map(function (a) { return a.lines; }));
  }

  return {
    previewState: previewState,
    addendaOf: addendaOf,
    customerVariationStatus: customerVariationStatus,
    customerVariationMissing: customerVariationMissing,
    canApproveCustomerVariation: canApproveCustomerVariation,
    customerVariationApproveHold: customerVariationApproveHold,
    customerVariationFields: customerVariationFields,
    customerVariationFormValues: customerVariationFormValues,
    customerVariationRefusalWords: customerVariationRefusalWords,
    customerVariationNeedsReread: customerVariationNeedsReread,
    eligibleType: eligibleType,
    createRoute: createRoute,
    lineOf: lineOf,
    groupLines: groupLines,
    hoursTotal: hoursTotal,
    allocationTotal: allocationTotal,
    rateWords: rateWords,
    needsHours: needsHours,
    qtyWords: qtyWords,
    hoursWords: hoursWords,
    moneyWords: moneyWords,
    dateWords: dateWords,
    statusOf: statusOf,
    missingForApproval: missingForApproval,
    isApprover: isApprover,
    canApprove: canApprove,
    refusalWords: refusalWords,
    refusalNeedsReread: refusalNeedsReread,
    openRefusalWords: openRefusalWords,
    openRefusalNeedsReread: openRefusalNeedsReread,
    openedWords: openedWords,
    crewFormNoticeHtml: crewFormNoticeHtml,
    renderOpsPanel: renderOpsPanel,
    pdfSections: pdfSections,
    renderTrade: renderTrade,
    invoiceNote: invoiceNote,
    esc: esc
  };
})();
// </job-work-order-core>

if (typeof window !== 'undefined') window.JobWorkOrderCore = JobWorkOrderCore;
