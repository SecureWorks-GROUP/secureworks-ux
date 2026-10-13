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
  //   variation_approved_at
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
      allocationEx: firstNum(it.allocation_ex),
      rateEx: firstNum(it.rate_ex),
      addendumKey: number != null ? 'n:' + number : (label ? 'label:' + lower(label) : ''),
      addendumLabel: label,
      addendumNumber: number,
      addendumAt: firstText(it.variation_approved_at)
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
  function groupLines(items) {
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
    return { base: base, addenda: addenda };
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
    arr(lines).forEach(function (l) { if (l.allocationEx != null) { total += l.allocationEx; any = true; } });
    return any ? Math.round(total * 100) / 100 : null;
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

    var groups = groupLines(wo.scope_items);
    h += renderOpsLines(groups.base, 'Task lines', '');
    if (!groups.base.length) {
      h += '<div class="jwo-empty" data-job-wo-no-lines>No task lines yet. They come from the accepted quote' +
        (st.key === 'draft' ? '; this draft has none so far.' : '.') + '</div>';
    }
    groups.addenda.forEach(function (g) {
      h += '<div class="jwo-addendum" data-job-wo-addendum>';
      h += renderOpsLines(g.lines, g.title, g.at ? 'Approved ' + dateWords(g.at) : '');
      h += '</div>';
    });

    if (firstText(wo.special_instructions)) {
      h += '<div class="jwo-k">Special instructions</div><div class="jwo-instr">' + esc(wo.special_instructions) + '</div>';
    }

    h += renderOpsFigures(block, detail, detailState, wo, st.key);
    h += renderOpsReportedVariations(detail, detailState);
    h += '</div>';
    return h;
  }

  function renderOpsLines(lines, title, sub) {
    if (!lines.length) return '';
    var showMoney = lines.some(function (l) { return l.allocationEx != null || l.rateEx != null; });
    var h = '<div class="jwo-k">' + esc(title) + (sub ? '<span class="jwo-k-sub">' + esc(sub) + '</span>' : '') + '</div>';
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
        var rate = l.rateEx != null ? moneyWords(l.rateEx) + (l.unitIsHours || l.hours != null ? '/h' : (l.unit ? '/' + l.unit : '')) : '';
        h += '<td class="r">' + esc(alloc) + (rate ? '<div class="jwo-line-note">' + esc(rate) + '</div>' : '') + '</td>';
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
    var groups = groupLines(wo.scope_items);
    var scope = '';
    if (st.key === 'draft') scope += '<p class="wo-draft">DRAFT: not approved yet. This work order can still change.</p>';
    scope += pdfLines(groups.base, false);
    if (!groups.base.length) scope += '<p style="padding-left:12px;">No task lines on this work order yet.</p>';
    groups.addenda.forEach(function (g) {
      scope += '<h3 class="wo-addendum">' + esc(g.title) + (g.at ? ' (approved ' + esc(dateWords(g.at)) + ')' : '') + ': addendum</h3>';
      scope += pdfLines(g.lines, false);
    });
    if (firstText(wo.special_instructions)) {
      scope += '<p style="padding-left:12px;"><strong>Special instructions:</strong> ' + esc(wo.special_instructions).replace(/\n/g, '<br>') + '</p>';
    }
    var all = groups.base.concat.apply(groups.base, groups.addenda.map(function (g) { return g.lines; }));
    var cost = pdfLines(all, true);
    var f = obj(block.figures) || {};
    cost += '<table><tbody>';
    var agreed = st.key === 'approved' ? num(f.agreed_ex) : num(wo.agreed_labour_ex);
    cost += '<tr class="total-row"><td>Agreed labour' + (st.key === 'approved' ? '' : ' (draft)') + '</td><td class="text-right">' + (isFinite(agreed) ? moneyWords(agreed) : 'Not set') + '</td></tr>';
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
        (money ? '<td class="text-right">' + esc(l.allocationEx != null ? moneyWords(l.allocationEx) : '') + '</td>' : '') + '</tr>';
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
    var groups = groupLines(wo.scope_items);
    h += renderTradeLines(groups.base);
    if (!groups.base.length) h += '<div class="two-empty" data-trade-job-wo-no-lines>No task lines on this work order. Ask the office for the scope.</div>';
    groups.addenda.forEach(function (g) {
      h += '<div class="two-addendum" data-trade-job-wo-addendum><div class="two-add-k">' + esc(g.title) +
        (g.at ? '<span> approved ' + esc(dateWords(g.at)) + '</span>' : '') + '</div>';
      h += renderTradeLines(g.lines);
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
  function renderTradeLines(lines) {
    if (!lines.length) return '';
    var h = '<div class="two-lines">';
    lines.forEach(function (l) {
      var q = qtyWords(l);
      h += '<div class="two-line"><div class="two-task">' + esc(l.task || 'Task') +
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
    var t = hoursTotal(groupLinesFlat(wo.scope_items));
    return 'Work order ' + (wo.wo_number || '') + ' is on this job' +
      (t.hours != null && !t.without ? ' (' + hoursWords(t.hours) + ' of tasks)' : '') +
      '. Bill the hours you worked; the office checks them against the work order.';
  }
  function groupLinesFlat(items) {
    var g = groupLines(items);
    return g.base.concat.apply(g.base, g.addenda.map(function (a) { return a.lines; }));
  }

  return {
    previewState: previewState,
    eligibleType: eligibleType,
    createRoute: createRoute,
    lineOf: lineOf,
    groupLines: groupLines,
    hoursTotal: hoursTotal,
    allocationTotal: allocationTotal,
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
