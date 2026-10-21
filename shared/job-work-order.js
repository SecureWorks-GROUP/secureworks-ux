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
// Office (Ops) screens are on for an office viewer, on every job type. The
// old per-trade form that wrote kind='crew' is retired. ?wo=live does not
// hide these screens and does not bring that form back. The Trade App does
// not read this switch (captain, 16 Oct 2026): hours only, and no agreed labour.
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

  function eligibleType(type) { return ELIGIBLE_TYPES.indexOf(lower(type)) >= 0; }

  // Every job's "Create work order" goes to the one job work order on the
  // job page. The old office form that wrote kind='crew' is retired for
  // every type and every role. Arguments are ignored: ?wo=live does not
  // bring that form back. eligibleType still says which jobs the Trade App
  // treats as having a job work order today (fencing and patio).
  function createRoute() {
    return 'job';
  }

  // kind='crew' is the old per-trade order. The office still lists those rows,
  // read-only, until the server retires them at go-live. The Trade App does
  // not filter on kind: my_work_orders does not send it, and a client filter
  // would empty trade invoicing the day the field appears. A row with no kind
  // is not labelled as retiring.
  var RETIRING_CREW_LABEL = 'Old crew work order (retiring)';
  function isRetiredCrewWorkOrder(wo) {
    return lower(wo && wo.kind) === 'crew';
  }
  function retiringCrewLabel(wo) {
    return isRetiredCrewWorkOrder(wo) ? RETIRING_CREW_LABEL : '';
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
  //   rate, rate_unit, total                Ops only (total is the
  //                                         line's allocation)
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
      // sends total, rate and rate_unit ('m', 'each', 'hr', 'pct', ...).
      allocationEx: firstNum(it.total),
      rateEx: firstNum(it.rate),
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
    job_type_not_eligible: 'The draft could not be opened. This job type is not on the server yet.',
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

  // ── A stuck Xero draft record ──
  // A customer variation's invoice record (invoice on customer_variations[])
  // that is 'unknown' (Xero did not confirm the create) or 'creating' (a claim
  // never finished) is not retried by anything. A work order approver checks
  // Xero by hand, then answers with reconcile_customer_variation_xero_draft
  // (backend docs/job-work-orders-v1.md, "A stuck Xero draft record"), which
  // never calls Xero. A 'creating' record is answered for only once its claim
  // (xero_requested_at) is 15 minutes old; before that the server refuses
  // 409 xero_draft_in_progress.
  var XERO_CREATING_STALE_AFTER_MS = 15 * 60 * 1000;
  var XERO_INVOICE_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  var XERO_INVOICE_ID_RE = new RegExp('^' + XERO_INVOICE_ID + '$', 'i');
  var XERO_INVOICE_LINK_RE = new RegExp('^\\S*[?&]InvoiceID=(' + XERO_INVOICE_ID + ')(?![0-9a-f-])', 'i');

  // "13 Oct 2026, 2:05 pm" in Perth.
  function timeWords(v) {
    var ms = typeof v === 'number' ? v : toMs(v);
    if (!isFinite(ms)) return '';
    var d = new Date(ms + PERTH_MS);
    var h = d.getUTCHours();
    var mm = d.getUTCMinutes();
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' +
      ((h % 12) || 12) + ':' + (mm < 10 ? '0' : '') + mm + (h < 12 ? ' am' : ' pm');
  }

  // null unless the record is stuck, else {status, answerable, requestedAt,
  // answerableAt}: answerable says whether the approver may answer for it now.
  function xeroDraftStuck(invoice, nowMs) {
    var inv = obj(invoice);
    if (!inv || (inv.status !== 'unknown' && inv.status !== 'creating')) return null;
    var requested = toMs(inv.xero_requested_at);
    var out = { status: inv.status, answerable: true, requestedAt: isFinite(requested) ? requested : null, answerableAt: null };
    if (inv.status === 'creating') {
      out.answerableAt = isFinite(requested) ? requested + XERO_CREATING_STALE_AFTER_MS : null;
      out.answerable = isFinite(requested) && isFinite(nowMs) && nowMs - requested >= XERO_CREATING_STALE_AFTER_MS;
    }
    return out;
  }

  // The answer button: an approver (display hint; the server checks the
  // approver list), on a stuck record that may be answered for now, read with
  // its updated_at.
  function canReconcileXeroDraft(invoice, viewerEmail, nowMs) {
    var stuck = xeroDraftStuck(invoice, nowMs);
    return !!(stuck && stuck.answerable && obj(invoice).updated_at && isApprover(viewerEmail));
  }

  // The Xero InvoiceID from what was pasted: the whole text is the id, or a
  // link carrying it after InvoiceID= (.../Edit.aspx?InvoiceID=<id>). Any
  // other text, a Xero link with some other id in it included, gives ''.
  function xeroInvoiceIdFrom(text) {
    var s = str(text).trim();
    if (XERO_INVOICE_ID_RE.test(s)) return s.toLowerCase();
    var link = XERO_INVOICE_LINK_RE.exec(s);
    return link ? link[1].toLowerCase() : '';
  }

  // The dialog, as answered: {outcome, invoiceId, invoiceNumber, checked}.
  // Returns {fields, errors}: fields in the reconcile input shape without
  // variation_id and expected_updated_at, errors in words.
  function xeroReconcileFields(values) {
    var v = obj(values) || {};
    var errors = [];
    var fields = null;
    if (v.outcome === 'draft_exists') {
      var id = xeroInvoiceIdFrom(v.invoiceId);
      var number = str(v.invoiceNumber).trim();
      if (!str(v.invoiceId).trim()) errors.push('Paste the Xero invoice id, or the link to the draft in Xero.');
      else if (!id) errors.push('That is not a Xero invoice id. Open the draft in Xero and copy the link from the address bar: the id is the part after InvoiceID=.');
      if (number.length > 50) errors.push('The invoice number is longer than 50 characters.');
      fields = { outcome: 'draft_exists', xero_invoice_id: id };
      if (number) fields.invoice_number = number;
    } else if (v.outcome === 'no_draft') {
      fields = { outcome: 'no_draft' };
    } else {
      errors.push('Say what you found in Xero.');
    }
    if (!v.checked) errors.push('Tick that you checked Xero by hand first.');
    return { fields: errors.length ? null : fields, errors: errors };
  }

  // reconcile_customer_variation_xero_draft refusals, in words.
  var XERO_RECONCILE_REFUSALS = {
    nothing_to_reconcile: 'This line is no longer stuck: it is back to prepared, so there is nothing to answer for. It has been read again.',
    xero_draft_already_recorded: 'A Xero draft is already recorded for this variation. It has been read again. Change it in Xero if it is wrong.',
    xero_draft_in_progress: 'The Xero draft was asked for less than 15 minutes ago and may still be on its way. It has been read again: wait, check Xero, then answer.',
    xero_invoice_already_recorded: 'That Xero invoice is already recorded for another variation. Check the invoice id in Xero.',
    stale_review: 'The Xero draft record changed after it was read. It has been read again: check it, then answer.',
    expected_updated_at_required: 'The Xero draft record has been read again: check it, then answer.',
    invoice_line_not_found: 'This variation has no invoice record to answer for. It has been read again.',
    invalid_outcome: 'Say whether you found the draft in Xero or found none.',
    invalid_request: 'That is not a Xero invoice id. Copy it from the draft\'s link in Xero.',
    invalid_invoice_number: 'The invoice number is the one Xero shows (at most 50 characters).',
    approver_required: 'Only Shaun answers for a stuck Xero draft.',
    approver_identity_missing: 'Answering for a stuck Xero draft needs Shaun\'s own signed-in session.',
    approver_not_set: 'No work order approver is named, so nobody can answer for it.',
    terminal_approval_switched_off: 'Answering from the terminal is switched off. Answer from the Ops dashboard.'
  };
  function xeroReconcileRefusalWords(code, message) {
    return XERO_RECONCILE_REFUSALS[str(code)] || str(message) || 'The answer could not be saved. Nothing changed.';
  }
  // A refusal after which the record must be read again: it moved on, or is
  // not in the state the screen showed.
  function xeroReconcileNeedsReread(code) {
    return ['nothing_to_reconcile', 'xero_draft_already_recorded', 'xero_draft_in_progress', 'stale_review', 'expected_updated_at_required', 'invoice_line_not_found'].indexOf(str(code)) >= 0;
  }

  // What a saved answer did, in words. res: the reconcile response.
  function xeroReconcileDoneWords(outcome, res) {
    var inv = obj(res && res.invoice) || {};
    if (outcome === 'draft_exists') {
      var name = firstText(inv.invoice_number) || 'the Xero draft';
      if (res && res.duplicate) return name + ' was already recorded for this variation. Nothing changed.';
      return 'Recorded: ' + name + ' is this variation\'s Xero draft. Nothing was sent to Xero or the customer.';
    }
    return 'Released: the line is back to prepared, so its Xero draft can be made again. Nothing was sent to Xero or the customer.';
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
        h += '<div class="jwo-empty" data-job-wo-none>Work order not filled yet. Open its draft: it fills from the accepted quote, then Shaun approves it.</div>' +
          '<button type="button" class="btn btn-primary btn-sm" data-job-wo-open' + (opts.busy ? ' disabled' : '') +
          ' onclick="JobWorkOrderOps.openDraft()">' + (opts.busy ? 'Opening...' : 'Open the draft') + '</button></div>';
      } else {
        h += '<div class="jwo-empty" data-job-wo-none>Work order not filled yet.</div></div>';
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
          esc(moneyWords(f.agreed_total_ex) || 'Not set') + '</div></div>';
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
      h += renderCustomerVariationConfirm(confirm, c, wo, ui.busy);
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
      h += renderCustomerVariationInvoiceLine(c, obj(ui.previews) && ui.previews[c.id], ui.previewBusyId === c.id, ui.busy, ui, viewerEmail);
    }
    return h + '</div>';
  }

  function renderCustomerVariationConfirm(confirm, c, wo, busy) {
    var id = esc(c.id);
    if (confirm.kind === 'approve') {
      return '<div class="jwo-confirm" data-job-wo-cv-confirm="approve">' +
        '<div>Approve this variation as shown? It joins ' + esc((wo && wo.wo_number) || 'the work order') +
        ' as the next numbered addendum and is sealed: it cannot change or be cancelled after.</div>' +
        '<div class="jwo-confirm-actions"><button type="button" class="btn btn-primary btn-sm" data-job-wo-cv-confirm-yes data-cv-id="' + id + '"' + (busy ? ' disabled' : '') +
        ' onclick="JobWorkOrderOps.cvConfirmed()">' + (busy ? 'Approving...' : 'Approve variation') + '</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="JobWorkOrderOps.cvConfirmBack()">Back</button></div></div>';
    }
    return '<div class="jwo-confirm" data-job-wo-cv-confirm="cancel">' +
      '<div>Cancel this draft variation? It stays on the record as cancelled and never joins the work order.</div>' +
      '<input type="text" class="form-input" data-job-wo-cv-cancel-reason maxlength="500" placeholder="Reason (optional)" value="' + esc(confirm.reason || '') + '">' +
      '<div class="jwo-confirm-actions"><button type="button" class="btn btn-primary btn-sm" data-job-wo-cv-confirm-yes data-cv-id="' + id + '"' + (busy ? ' disabled' : '') +
      ' onclick="JobWorkOrderOps.cvConfirmed()">' + (busy ? 'Cancelling...' : 'Cancel variation') + '</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" onclick="JobWorkOrderOps.cvConfirmBack()">Keep it</button></div></div>';
  }

  // The customer invoice line of an approved variation, as a preview only:
  // the line prepare_customer_variation_invoice_line builds from the record.
  // This screen never creates the Xero draft (that switch is off).
  function renderCustomerVariationInvoiceLine(c, preview, previewBusy, busy, ui, viewerEmail) {
    var h = '<div class="jwo-cv-inv" data-job-wo-cv-invoice>';
    var price = num(c.customer_price_ex);
    if (isFinite(price) && price <= 0) {
      return h + '<div class="jwo-line-note" data-job-wo-cv-no-charge>Charges the customer nothing, so it has no invoice line.</div></div>';
    }
    var p = obj(preview);
    var inv = (p && obj(p.invoice)) || obj(c.invoice);
    var line = (p && obj(p.line)) || (inv && obj(inv.line));
    ui = obj(ui) || {};
    var ref = p && obj(p.create_invoice_draft) ? firstText(p.create_invoice_draft.reference) : '';
    h += renderXeroDraftStuck(c, inv, ui, viewerEmail, ref);
    if (!line) {
      return h + '<button type="button" class="btn btn-secondary btn-sm" data-job-wo-cv-invoice-line data-cv-id="' + esc(c.id) + '"' + (busy || previewBusy ? ' disabled' : '') +
        ' onclick="JobWorkOrderOps.cvInvoiceLine(this.getAttribute(\'data-cv-id\'))">' + (previewBusy ? 'Preparing...' : 'Preview the customer invoice line') + '</button></div>';
    }
    h += '<div class="jwo-k">Customer invoice line<span class="jwo-k-sub">Preview</span></div>';
    h += '<table class="jwo-table" data-job-wo-cv-invoice-preview><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price ex GST</th><th class="r">Account</th></tr></thead><tbody>' +
      '<tr><td class="jwo-instr">' + esc(line.description || '') + '</td><td class="r">' + esc(numWords(num(line.quantity))) + '</td>' +
      '<td class="r">' + esc(moneyWords(line.unit_price)) + '</td><td class="r">' + esc(line.account_code || '') + '</td></tr></tbody></table>';
    if (ref) h += '<div class="jwo-line-note">Reference ' + esc(ref) + '</div>';
    if (inv && inv.status === 'xero_draft_created') {
      h += '<div class="jwo-line-note">In Xero as a draft' + (inv.invoice_number ? ' ' + esc(inv.invoice_number) : '') + '.</div>';
    }
    h += '<div class="jwo-line-note" data-job-wo-cv-invoice-note>Preview only: nothing is sent to Xero from here. Hours, the trade allocation and rates stay off the customer\'s line.</div>';
    return h + '</div>';
  }

  // The stuck Xero draft state of an approved variation's invoice record
  // (preview only), with the approver's button and, while open, its dialog.
  // '' when the record is not stuck.
  function renderXeroDraftStuck(c, inv, ui, viewerEmail, reference) {
    var nowMs = num(ui.now);
    var stuck = xeroDraftStuck(inv, nowMs);
    if (!stuck) return '';
    var name = firstText(c.label) || 'this variation';
    var asked = stuck.requestedAt != null ? ' (asked for ' + timeWords(stuck.requestedAt) + ')' : '';
    var lookFor = reference ? 'a draft with reference ' + reference : 'a draft for ' + name;
    var h = '<div class="jwo-xd-stuck" data-job-wo-cv-xero-stuck="' + esc(stuck.status) + '" data-cv-answerable="' + (stuck.answerable ? '1' : '0') + '">';
    if (stuck.status === 'unknown') {
      h += '<div class="jwo-xd-head"><span class="jwo-chip jwo-chip-unreadable">Xero draft not confirmed</span></div>';
      h += '<div>Xero did not confirm whether the draft for this line was made' + esc(asked) + '. It may be in Xero. Nothing tries again by itself: check Xero for ' + esc(lookFor) + ', then record what you found.</div>';
    } else if (stuck.answerable) {
      h += '<div class="jwo-xd-head"><span class="jwo-chip jwo-chip-unreadable">Xero draft stuck</span></div>';
      h += '<div>Making the Xero draft for this line started' + esc(asked) + ' and never finished. It may be in Xero. Nothing tries again by itself: check Xero for ' + esc(lookFor) + ', then record what you found.</div>';
    } else {
      h += '<div class="jwo-xd-head"><span class="jwo-chip jwo-chip-draft">Xero draft being made</span></div>';
      h += '<div>The Xero draft for this line is being made' + esc(asked) + '. If it still says this after ' +
        esc(stuck.answerableAt != null ? timeWords(stuck.answerableAt) : '15 minutes') + ', check Xero and record what you found.</div>';
    }
    if (firstText(inv && inv.failure)) h += '<div class="jwo-line-note" data-job-wo-cv-xero-failure>What went wrong: ' + esc(firstText(inv.failure)) + '</div>';
    if (stuck.answerable) {
      if (isApprover(viewerEmail)) {
        var dialog = obj(ui.xero);
        var can = canReconcileXeroDraft(inv, viewerEmail, nowMs);
        h += '<div class="jwo-cv-actions"><button type="button" class="btn btn-primary btn-sm" data-job-wo-cv-xero-open data-cv-id="' + esc(c.id) + '"' +
          (!can || ui.busy || dialog || obj(ui.form) ? ' disabled' : '') +
          ' onclick="JobWorkOrderOps.cvXeroOpen(this.getAttribute(\'data-cv-id\'))">Record what Xero shows</button></div>';
        if (dialog && dialog.id === c.id) h += renderXeroReconcileDialog(dialog, c, stuck, ui.busy);
      } else {
        h += '<div class="jwo-line-note" data-job-wo-cv-xero-approver-only>Only Shaun records what Xero shows, after checking it by hand.</div>';
      }
    }
    return h + '</div>';
  }

  // The small dialog: found the draft (its Xero invoice id and number) or
  // found none (release the line to be made again). dialog: {id, outcome,
  // invoiceId, invoiceNumber, checked, errors}.
  function renderXeroReconcileDialog(dialog, c, stuck, busy) {
    var v = dialog;
    var found = v.outcome === 'draft_exists';
    var none = v.outcome === 'no_draft';
    var h = '<div class="jwo-xd-backdrop" data-job-wo-cv-xero-backdrop>' +
      '<div class="jwo-xd" role="dialog" aria-modal="true" aria-labelledby="jwoXdTitle" data-job-wo-cv-xero-dialog data-cv-id="' + esc(c.id) + '"' +
      ' onkeydown="if(event.key===\'Escape\')JobWorkOrderOps.cvXeroClose()">';
    h += '<div class="jwo-xd-title" id="jwoXdTitle">What does Xero show?</div>';
    h += '<div class="jwo-sub">' + esc(firstText(c.label) || 'This variation') + DOT +
      (stuck.status === 'unknown' ? 'Xero did not confirm the draft.' : 'Making the draft never finished.') +
      ' This screen never calls Xero: it records what you found there.</div>';
    var errors = arr(v.errors);
    if (errors.length) h += '<div class="jwo-msg jwo-msg-error" data-job-wo-cv-xero-errors>' + errors.map(esc).join('<br>') + '</div>';
    h += '<label class="jwo-xd-choice"><input type="radio" name="jwoXdOutcome" value="draft_exists" data-cv-xero-f="outcome"' + (found ? ' checked' : '') +
      ' onchange="JobWorkOrderOps.cvXeroChanged(this)"> <span><b>I found the draft in Xero.</b> Record it as this variation\'s draft.</span></label>';
    if (found) {
      h += '<div class="jwo-xd-fields">' +
        '<label class="jwo-cv-label">Xero invoice id, or the draft\'s link from Xero<input type="text" class="form-input" maxlength="300" autocomplete="off" spellcheck="false"' +
        ' placeholder="https://go.xero.com/...InvoiceID=..." data-cv-xero-f="invoiceId" value="' + esc(v.invoiceId || '') + '"></label>' +
        '<label class="jwo-cv-label">Invoice number (optional)<input type="text" class="form-input" maxlength="50" autocomplete="off" placeholder="INV-0000"' +
        ' data-cv-xero-f="invoiceNumber" value="' + esc(v.invoiceNumber || '') + '"></label></div>';
    }
    h += '<label class="jwo-xd-choice"><input type="radio" name="jwoXdOutcome" value="no_draft" data-cv-xero-f="outcome"' + (none ? ' checked' : '') +
      ' onchange="JobWorkOrderOps.cvXeroChanged(this)"> <span><b>There is no draft in Xero.</b> Put the line back so the draft can be made again.</span></label>';
    if (none) {
      h += '<div class="jwo-rule jwo-rule-warn jwo-xd-fields" data-job-wo-cv-xero-release-warn>Only if you are sure: if a draft is in Xero after all, making it again puts a second one there.</div>';
    }
    h += '<label class="jwo-xd-choice jwo-xd-check"><input type="checkbox" data-cv-xero-f="checked"' + (v.checked ? ' checked' : '') +
      ' onchange="JobWorkOrderOps.cvXeroChanged(this)"> <span>I checked Xero by hand just now.</span></label>';
    var what = found
      ? 'This records that Xero draft against the variation. It is then kept like any draft made from here. Nothing is sent to Xero or the customer.'
      : none
        ? 'This puts the line back to prepared. Nothing is sent to Xero or the customer.'
        : '';
    if (what) h += '<div class="jwo-line-note" data-job-wo-cv-xero-what>' + esc(what) + '</div>';
    var label = found ? 'Record this Xero draft' : none ? 'Release the line' : 'Save';
    h += '<div class="jwo-cv-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" data-job-wo-cv-xero-submit' + (busy || (!found && !none) || !v.checked ? ' disabled' : '') +
      ' onclick="JobWorkOrderOps.cvXeroSubmit()">' + (busy ? 'Saving...' : label) + '</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-job-wo-cv-xero-close' + (busy ? ' disabled' : '') + ' onclick="JobWorkOrderOps.cvXeroClose()">Back</button></div>';
    return h + '</div></div>';
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

  // <job-wo-overview-fields>
  // Overview card. Office only (showMoney). Reads the job_work_order block
  // already on job_detail, plus the job_work_order read (figures, lines,
  // labour_before_approval) and list_trade_invoice_lines, which is always
  // read and merged by line id even when the work order already has lines.
  //
  // Assumed fields the parallel backend PR is adding. Each one is optional.
  // Absent means the card leaves that fact blank. It never invents a number,
  // a name, or a review state.
  //   work_order.status                         draft | issued | sent | approved
  //                                             (no work_order: Blank)
  //   work_order.makesafe_labour_allowance_ex  make-safe labour allowance, ex GST
  //   work_order.labour_allowance_ex            same figure, other spelling
  //   figures.makesafe_labour_allowance_ex      same, on the figures object
  //   figures.labour_allowance_ex               same, on the figures object
  //   work_order.approved_by_name               who approved (a person)
  //   work_order.approver_name                  same, other spelling
  //   work_order.approved_by_email              email when no name
  //   work_order.approved_by                    used only when it is a name or
  //                                             an email, never a uuid
  //   line.review_state                         held | approved | queried | rejected
  //   line.work_order_id                        job work order this line bills
  //   line.job_work_order_id                    same link, the column that
  //                                             exists today
  // Already read when the new field is absent:
  //   acknowledgment_status  pending|submitted|held -> Held,
  //                          acknowledged|approved -> Approved,
  //                          queried -> Queried, rejected -> Rejected
  //   agreed_labour_ex, figures.agreed_ex, figures.agreed_total_ex,
  //   figures.billed_to_date_ex, figures.remaining_ex, figures.over_agreed,
  //   labour_before_approval, approved_at, approved_via,
  //   line.trade_name, description, line_type, cost_lane, override_amount,
  //   line_total_ex, amount_ex, total_hours, work_date, week_label,
  //   line.trade_invoices.status                 live list_trade_invoice_lines
  //                                             shape: an object, or a one-element
  //                                             array. There is no flat
  //                                             invoice_status column.
  //   invoice_status, trade_invoice_status, invoice.status, counted
  // Billed labour uses counted when the server sends it. Otherwise a line
  // counts only when its invoice status is a billed one AND the line is
  // labour. Status on a live invoice line is trade_invoices.status. If neither
  // fact is on the read, the total says "Not on this read"
  // and each such line is marked. A line with no work order id is still listed
  // (the read is this job) and the card says the id is not on the read yet.
  // A line whose id is a different work order is left out.
  // </job-wo-overview-fields>
  var REVIEW_LABELS = { held: 'Held', approved: 'Approved', queried: 'Queried', rejected: 'Rejected' };
  var ACK_TO_REVIEW = {
    held: 'held', pending: 'held', submitted: 'held',
    acknowledged: 'approved', approved: 'approved',
    queried: 'queried', rejected: 'rejected'
  };

  function cardStatus(block) {
    if (!block || !obj(block.work_order)) {
      if (block && block.unreadable) return { key: 'unreadable', label: 'Could not be read' };
      return { key: 'blank', label: 'Blank' };
    }
    var s = lower(block.work_order.status);
    if (s === 'approved') return { key: 'approved', label: 'Approved' };
    if (s === 'issued' || s === 'sent') return { key: 'issued', label: 'Issued' };
    if (s === 'draft' || !s) return { key: 'draft', label: 'Draft' };
    return { key: s, label: str(block.work_order.status) };
  }

  function isUuid(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str(v).trim());
  }

  function approverWords(wo) {
    var w = obj(wo);
    if (!w) return '';
    var sealed = lower(w.status) === 'approved' || !!firstText(w.approved_at);
    if (!sealed) return '';
    var name = firstText(w.approved_by_name, w.approver_name);
    if (!name && firstText(w.approved_by_email).indexOf('@') >= 0) name = firstText(w.approved_by_email);
    if (!name && typeof w.approved_by === 'string' && !isUuid(w.approved_by)) {
      var raw = w.approved_by.trim();
      if (raw.indexOf('@') >= 0 || raw.indexOf(' ') >= 0) name = raw;
    }
    var when = dateWords(w.approved_at);
    if (name) return 'Approved by ' + name + (when ? ' on ' + when : '');
    if (lower(w.approved_via) === 'auto') return 'Approved automatically' + (when ? ' on ' + when : '');
    return 'Approver not recorded' + (when ? '. Approved on ' + when : '');
  }

  function cardFigures(block, detail) {
    return (detail && obj(detail.figures)) || (block && obj(block.figures)) || null;
  }

  function allowanceEx(wo, figures) {
    var w = obj(wo) || {};
    var f = obj(figures) || {};
    return firstNum(w.makesafe_labour_allowance_ex, w.labour_allowance_ex, f.makesafe_labour_allowance_ex, f.labour_allowance_ex);
  }

  function agreedExOf(wo, figures) {
    var f = obj(figures) || {};
    var w = obj(wo) || {};
    if (num(f.customer_variation_count) > 0 && isFinite(num(f.agreed_total_ex))) return num(f.agreed_total_ex);
    if (isFinite(num(f.agreed_ex))) return num(f.agreed_ex);
    if (isFinite(num(w.agreed_labour_ex))) return num(w.agreed_labour_ex);
    return null;
  }

  function reviewOf(raw) {
    var it = obj(raw) || {};
    var direct = lower(it.review_state);
    if (REVIEW_LABELS[direct]) return { key: direct, label: REVIEW_LABELS[direct], source: 'review_state' };
    var mapped = ACK_TO_REVIEW[lower(it.acknowledgment_status)];
    if (mapped) return { key: mapped, label: REVIEW_LABELS[mapped], source: 'acknowledgment_status' };
    return { key: 'none', label: 'Not reviewed yet', source: 'none' };
  }

  // Invoice statuses that have been billed. Anything else the read names
  // (draft, failed, ops-reject, rejected, void, cancelled) is not labour billed.
  var BILLED_INVOICE_STATUSES = {
    pending_acknowledgment: 1, queried: 1, acknowledged: 1,
    pending_ops_review: 1, approved: 1, pushed_to_xero: 1, paid: 1
  };
  var LABOUR_LINE_TYPES = {
    labour: 1, work_order: 1, 'work order': 1, general_labour: 1, 'general labour': 1,
    fencing: 1, patio: 1, makesafe: 1, make_safe: 1, 'make safe': 1
  };

  function tokenOf(v) {
    return lower(v).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function statusKey(v) {
    return lower(v).replace(/[\s-]+/g, '_');
  }
  function isLabourType(type) {
    if (!type) return false;
    return !!(LABOUR_LINE_TYPES[lower(type)] || LABOUR_LINE_TYPES[tokenOf(type)]);
  }
  function isBilledStatus(status) {
    return !!(status && BILLED_INVOICE_STATUSES[statusKey(status)]);
  }
  // list_trade_invoice_lines nests the invoice as trade_invoices: an object,
  // or a one-element array when the join comes back as a list. A flat
  // invoice_status is only present when some other read adds it.
  function tradeInvoiceStatus(raw) {
    if (raw == null || raw === '') return '';
    var row = Array.isArray(raw) ? (raw.length ? raw[0] : null) : raw;
    var inv = obj(row);
    if (!inv) return '';
    return lower(firstText(inv.status, inv.invoice_status));
  }
  function invoiceStatusOf(it) {
    var row = obj(it) || {};
    var direct = firstText(row.invoice_status, row.trade_invoice_status, row.invoiceStatus);
    if (direct) return lower(direct);
    var joined = tradeInvoiceStatus(row.trade_invoices);
    if (joined) return joined;
    var inv = obj(row.invoice);
    if (inv) {
      var nested = firstText(inv.status, inv.invoice_status);
      if (nested) return lower(nested);
    }
    return '';
  }
  function countedFlag(it) {
    var row = obj(it) || {};
    if (row.counted === true) return true;
    if (row.counted === false) return false;
    return null;
  }

  // true counts, false does not, null means this read cannot decide.
  // The server's counted flag wins. Otherwise a non-billed status or a
  // non-labour type is enough to leave the line out. A billed status with no
  // type, or a labour type with no status, is not decided here.
  function countsAsBilledLabour(line) {
    if (!line) return null;
    var flag = countedFlag(line);
    if (flag !== null) return flag;
    var lane = lower(line.costLane != null ? line.costLane : line.cost_lane);
    var type = lower(line.lineType != null ? line.lineType : firstText(line.line_type, line.lane));
    var status = lower(line.invoiceStatus != null ? line.invoiceStatus : invoiceStatusOf(line));
    var labour = lane === 'labour' || isLabourType(type);
    var nonLabour = line.commission === true || (lane && lane !== 'labour') || (type && !isLabourType(type) && lane !== 'labour');
    if (status && !isBilledStatus(status)) return false;
    if (nonLabour) return false;
    if (labour && status && isBilledStatus(status)) return true;
    return null;
  }

  function uncountedStatusWord(status) {
    var s = statusKey(status);
    if (s === 'rejected' || s === 'ops_reject') return 'Rejected';
    if (s === 'draft') return 'Draft';
    if (s === 'failed') return 'Failed';
    if (s === 'void' || s === 'voided') return 'Void';
    if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
    return '';
  }

  function lineBlank(v) { return v == null || v === ''; }

  // Work-order lines keep their own fields. Review, status, counted, type
  // and amounts are copied from the matching trade invoice line when the
  // work-order line does not already have them. Match is by
  // trade_invoice_line_id, else id. Invoice lines with no match are kept.
  // An empty work-order lines array is "none linked yet", so the invoice
  // lines are the list.
  function enrichCrewLine(wo, inv) {
    var out = {};
    Object.keys(wo).forEach(function (k) { out[k] = wo[k]; });
    ['review_state', 'acknowledgment_status', 'invoice_status', 'trade_invoice_status', 'counted', 'line_type', 'cost_lane', 'override_amount', 'line_total_ex', 'amount_ex', 'trade_name', 'description', 'total_hours', 'hours', 'work_date', 'week_label'].forEach(function (k) {
      if (lineBlank(out[k]) && !lineBlank(inv[k])) out[k] = inv[k];
    });
    if (!out.invoice && inv.invoice) out.invoice = inv.invoice;
    if (lineBlank(out.trade_invoices) && !lineBlank(inv.trade_invoices)) out.trade_invoices = inv.trade_invoices;
    if (lineBlank(out.trade_invoice_line_id) && !lineBlank(inv.id)) out.trade_invoice_line_id = inv.id;
    return out;
  }
  function mergeCrewInvoiceLines(woLines, invoiceLines) {
    var wo = arr(woLines);
    var inv = arr(invoiceLines).filter(function (row) { return row; });
    var shaped = wo.filter(function (row) { return crewInvoiceLine(row); });
    if (!shaped.length) return inv.slice();
    var byId = {};
    inv.forEach(function (row) {
      if (row.id != null && str(row.id) !== '') byId[String(row.id)] = row;
    });
    var used = {};
    var out = shaped.map(function (row) {
      var key = !lineBlank(row.trade_invoice_line_id) ? String(row.trade_invoice_line_id)
        : (!lineBlank(row.id) ? String(row.id) : '');
      var extra = key && byId[key];
      if (!extra) return row;
      used[key] = true;
      return enrichCrewLine(row, extra);
    });
    inv.forEach(function (row) {
      var id = row.id != null ? String(row.id) : '';
      if (id && used[id]) return;
      out.push(row);
    });
    return out;
  }

  // A crew invoice line, or null when the row is a scope task (no invoice
  // fields). Amounts prefer override_amount, then line_total_ex, then amount_ex.
  function crewInvoiceLine(raw) {
    var it = obj(raw);
    if (!it) return null;
    var looks = it.trade_name != null || it.line_total_ex != null || it.override_amount != null
      || it.acknowledgment_status != null || it.review_state != null || it.trade_invoice_id != null
      || it.line_type != null || it.week_label != null || it.total_hours != null || it.amount_ex != null
      || it.invoice_status != null || it.trade_invoices != null || it.counted != null || it.cost_lane != null;
    if (!looks) return null;
    var ids = [];
    if (it.work_order_id != null && str(it.work_order_id) !== '') ids.push(String(it.work_order_id));
    if (it.job_work_order_id != null && str(it.job_work_order_id) !== '') ids.push(String(it.job_work_order_id));
    var type = lower(firstText(it.line_type, it.lane));
    var line = {
      trade: firstText(it.trade_name, it.user_name, it.worker_name) || 'Trade',
      work: firstText(it.description, it.line_description) || 'Labour',
      hours: firstNum(it.total_hours, it.hours),
      workDate: firstText(it.work_date),
      week: firstText(it.week_label),
      amount: firstNum(it.override_amount, it.line_total_ex, it.amount_ex),
      commission: type === 'commission',
      lineType: type,
      costLane: lower(it.cost_lane),
      invoiceStatus: invoiceStatusOf(it),
      counted: countedFlag(it),
      review: reviewOf(it),
      woIds: ids
    };
    line.counts = countsAsBilledLabour(line);
    return line;
  }

  function crewLinesFor(list, woId) {
    var lines = [];
    var unstamped = 0;
    arr(list).forEach(function (raw) {
      var line = crewInvoiceLine(raw);
      if (!line) return;
      if (woId && line.woIds.length && line.woIds.indexOf(String(woId)) < 0) return;
      if (!line.woIds.length) unstamped++;
      lines.push(line);
    });
    return { lines: lines, unstamped: unstamped };
  }

  // Null when there are no lines, or any line cannot be decided: the card
  // then says the total is not on this read rather than a partial sum.
  // Every line decided and none of them labour bills as 0.
  function labourSumOf(lines) {
    var total = 0;
    var undecided = false;
    var saw = false;
    arr(lines).forEach(function (l) {
      if (!l) return;
      saw = true;
      var c = l.counts;
      if (c == null) c = countsAsBilledLabour(l);
      if (c === null) { undecided = true; return; }
      if (c && l.amount != null) total += l.amount;
    });
    if (!saw || undecided) return null;
    return Math.round(total * 100) / 100;
  }

  function linesPayload(detail, opts) {
    opts = opts || {};
    if (opts.linesState) return { list: opts.lines !== undefined ? opts.lines : [], state: opts.linesState };
    if (detail && Array.isArray(detail.crew_lines)) return { list: detail.crew_lines, state: 'ready' };
    if (detail && Array.isArray(detail.lines)) return { list: detail.lines, state: 'ready' };
    return { list: [], state: 'absent' };
  }

  function billedForCard(wo, figures, detail, labourSum) {
    var f = obj(figures) || {};
    var approved = lower(wo && wo.status) === 'approved';
    if (approved && isFinite(num(f.billed_to_date_ex))) return { amount: num(f.billed_to_date_ex), source: 'figures' };
    var before = detail && obj(detail.labour_before_approval);
    if (!approved && before && isFinite(num(before.amount_ex))) return { amount: num(before.amount_ex), source: 'before' };
    if (isFinite(num(f.billed_to_date_ex)) && (num(f.billed_to_date_ex) > 0 || labourSum == null)) {
      return { amount: num(f.billed_to_date_ex), source: 'figures' };
    }
    if (labourSum != null) return { amount: labourSum, source: 'lines' };
    return { amount: null, source: '' };
  }

  // The job Overview card (classic and the new Overview). showMoney is office
  // only: a trade render carries no agreed labour and no dollar figure.
  function renderOverviewCard(block, detail, opts) {
    opts = opts || {};
    var showMoney = opts.showMoney === true;
    var st = cardStatus(block);
    var wo = (detail && obj(detail.work_order)) || (block && obj(block.work_order)) || null;
    var figures = cardFigures(block, detail);
    var h = '<section class="jwo jwo-ov" data-job-wo-overview-card data-job-wo-card-status="' + esc(st.key) + '" aria-label="Work order">';
    h += '<div class="jwo-head"><div class="jwo-title">Work order' + (wo && wo.wo_number ? ' <b>' + esc(wo.wo_number) + '</b>' : '') + '</div>';
    h += '<span class="jwo-chip jwo-chip-' + esc(st.key) + '" data-job-wo-card-chip>' + esc(st.label) + '</span></div>';

    if (st.key === 'unreadable') {
      return h + '<div class="jwo-empty">The work order could not be read. Reopen the job to try again.</div></section>';
    }
    if (st.key === 'blank') {
      h += '<div class="jwo-sub" data-job-wo-card-blank>Work order not filled yet.</div>';
      if (opts.canOpen) {
        h += '<button type="button" class="btn btn-primary btn-sm" data-job-wo-card-open' + (opts.busy ? ' disabled' : '') +
          ' onclick="JobWorkOrderOps.openDraft()">' + (opts.busy ? 'Opening...' : 'Open the draft') + '</button>';
      }
    }
    if (opts.message) {
      h += '<div class="jwo-msg jwo-msg-' + esc(opts.messageLevel || 'info') + '" data-job-wo-message>' + esc(opts.message) + '</div>';
    }
    var who = approverWords(wo);
    if (who) h += '<div class="jwo-sub" data-job-wo-approved-by>' + esc(who) + '</div>';

    var agreed = showMoney ? agreedExOf(wo, figures) : null;
    var allowance = showMoney ? allowanceEx(wo, figures) : null;
    var payload = linesPayload(detail, opts);
    var packed = crewLinesFor(payload.list, wo && wo.id);
    var billed = showMoney ? billedForCard(wo, figures, detail, labourSumOf(packed.lines)) : { amount: null, source: '' };
    var overBy = (agreed != null && billed.amount != null) ? Math.round((billed.amount - agreed) * 100) / 100 : null;
    var over = showMoney && ((overBy != null && overBy > 0.009) || !!(figures && figures.over_agreed === true));

    if (showMoney) {
      h += '<div class="jwo-figs" data-job-wo-card-figures>';
      h += figureCell('Agreed labour', agreed != null ? moneyWords(agreed) : 'Not set');
      if (allowance != null) h += '<div class="jwo-fig" data-job-wo-allowance><div class="jwo-fig-k">Make-safe allowance</div><div class="jwo-fig-v">' + esc(moneyWords(allowance)) + '</div></div>';
      h += figureCell('Billed labour', billed.amount != null ? moneyWords(billed.amount) : 'Not on this read', over ? 'jwo-fig-over' : '');
      if (figures && isFinite(num(figures.remaining_ex))) {
        h += figureCell('Remaining', moneyWords(figures.remaining_ex), over ? 'jwo-fig-over' : '');
      }
      h += '</div>';
      if (over) {
        h += '<div class="jwo-overrun" data-job-wo-overrun>' +
          (overBy != null && overBy > 0.009 ? 'Over agreed by ' + esc(moneyWords(overBy)) : 'Over the agreed labour.') + '</div>';
      }
    }

    h += '<div class="jwo-k">Crew lines</div>';
    if (payload.state === 'loading') {
      h += '<div class="jwo-empty" data-job-wo-crew-state="loading">Crew lines are loading.</div>';
    } else if (payload.state === 'failed') {
      h += '<div class="jwo-empty" data-job-wo-crew-state="failed">Crew lines could not be read.</div>';
    } else if (payload.state === 'absent') {
      h += '<div class="jwo-empty" data-job-wo-crew-state="absent">Crew lines are not on this read yet.</div>';
    } else if (!packed.lines.length) {
      var billedWaiting = showMoney && billed.amount != null && billed.amount > 0.009;
      h += '<div class="jwo-empty" data-job-wo-crew-state="' + (billedWaiting ? 'absent' : 'empty') + '">' +
        (billedWaiting ? 'Crew lines are not on this read yet.' : 'No crew invoice lines on this work order yet.') + '</div>';
    } else {
      h += '<table class="jwo-table" data-job-wo-crew-lines><thead><tr><th>Trade</th><th>Work</th>' +
        (showMoney ? '<th class="r">Amount</th>' : '') + '<th>Review</th></tr></thead><tbody>';
      packed.lines.forEach(function (l) {
        var meta = [];
        if (l.workDate) meta.push(dateWords(l.workDate) || l.workDate);
        if (l.hours != null) meta.push(hoursWords(l.hours));
        if (l.week) meta.push(l.week);
        if (l.counts === false) {
          meta.push('Not counted as labour');
          var statusWord = uncountedStatusWord(l.invoiceStatus);
          if (statusWord) meta.push(statusWord);
        } else if (l.counts == null) {
          meta.push('Not counted on this read');
        }
        h += '<tr>';
        h += '<td>' + esc(l.trade) + '</td>';
        h += '<td>' + esc(l.work) + (meta.length ? '<div class="jwo-line-note">' + esc(meta.join(DOT)) + '</div>' : '') + '</td>';
        if (showMoney) h += '<td class="r">' + esc(l.amount != null ? moneyWords(l.amount) : '') + '</td>';
        h += '<td><span class="jwo-chip jwo-chip-' + esc(l.review.key) + '" data-job-wo-review="' + esc(l.review.key) + '" data-review-source="' + esc(l.review.source) + '">' + esc(l.review.label) + '</span></td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
      if (packed.unstamped === packed.lines.length) {
        h += '<div class="jwo-line-note" data-job-wo-lines-unstamped>These lines are on the job. A work order id on each line is not in this read yet.</div>';
      } else if (packed.unstamped > 0) {
        h += '<div class="jwo-line-note" data-job-wo-lines-unstamped>' + packed.unstamped +
          (packed.unstamped === 1 ? ' of these lines has' : ' of these lines have') +
          ' no work order id on this read yet.</div>';
      }
    }

    if (showMoney && (billed.amount != null || agreed != null)) {
      var vs = 'Billed labour ' + (billed.amount != null ? moneyWords(billed.amount) : 'not on this read');
      vs += ' against agreed labour ' + (agreed != null ? moneyWords(agreed) : 'not set');
      h += '<div class="jwo-sub" data-job-wo-vs-agreed>' + esc(vs) + '</div>';
    }
    return h + '</section>';
  }

  return {
    addendaOf: addendaOf,
    customerVariationStatus: customerVariationStatus,
    customerVariationMissing: customerVariationMissing,
    canApproveCustomerVariation: canApproveCustomerVariation,
    customerVariationApproveHold: customerVariationApproveHold,
    customerVariationFields: customerVariationFields,
    customerVariationFormValues: customerVariationFormValues,
    customerVariationRefusalWords: customerVariationRefusalWords,
    customerVariationNeedsReread: customerVariationNeedsReread,
    xeroDraftStuck: xeroDraftStuck,
    canReconcileXeroDraft: canReconcileXeroDraft,
    xeroInvoiceIdFrom: xeroInvoiceIdFrom,
    xeroReconcileFields: xeroReconcileFields,
    xeroReconcileRefusalWords: xeroReconcileRefusalWords,
    xeroReconcileNeedsReread: xeroReconcileNeedsReread,
    xeroReconcileDoneWords: xeroReconcileDoneWords,
    timeWords: timeWords,
    eligibleType: eligibleType,
    createRoute: createRoute,
    isRetiredCrewWorkOrder: isRetiredCrewWorkOrder,
    retiringCrewLabel: retiringCrewLabel,
    mergeCrewInvoiceLines: mergeCrewInvoiceLines,
    countsAsBilledLabour: countsAsBilledLabour,
    labourSumOf: labourSumOf,
    cardStatus: cardStatus,
    renderOverviewCard: renderOverviewCard,
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
    renderOpsPanel: renderOpsPanel,
    pdfSections: pdfSections,
    renderTrade: renderTrade,
    invoiceNote: invoiceNote,
    esc: esc
  };
})();
// </job-work-order-core>

if (typeof window !== 'undefined') window.JobWorkOrderCore = JobWorkOrderCore;
