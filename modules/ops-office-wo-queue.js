// Office list of jobs needing a work order (job_work_order_gaps, P1-05.3) and
// the office queue of blank and draft job work orders
// (list_office_job_work_orders, fill_job_work_order_allowance,
// approve_office_job_work_order; flag job_work_order_office_fill_v1).
// While job_work_order_office_fill_v1 is off, or its action is not deployed,
// the fill queue host paints nothing. Needs a work order is staff-only and
// fails closed to its error state, never showing 0 on an unreadable response.
// No send control: a job work order is approved, not sent.
//
// <office-wo-fill-core>
var OfficeWoFillCore = (function () {
  'use strict';

  var TRADE_ROLES = { installer: 1, lead_installer: 1, crew: 1, trade: 1, subcontractor: 1 };

  function validNum(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function validCount(v) {
    var n = validNum(v);
    if (n === null || n < 0) return null;
    return Math.floor(n);
  }

  function money(n) {
    var v = validNum(n);
    if (v === null) return '';
    var neg = v < 0;
    var parts = Math.abs(Math.round(v * 100) / 100).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + parts[0] + '.' + parts[1];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function isTradeRole(role) {
    return !!TRADE_ROLES[String(role || '').toLowerCase()];
  }

  // The queue is absent when the server says the flag is off, or the action
  // is not deployed yet. A real read failure is not this.
  function isOff(res, err) {
    if (res && res.enabled === false) return true;
    if (!err) return false;
    var code = String(err.code || '');
    var msg = String(err.message || '');
    return code === 'unknown_action' || /unknown action/i.test(msg);
  }

  function fillBody(row, amount) {
    return {
      work_order_id: row.id,
      expected_updated_at: row.updated_at,
      agreed_labour_ex: amount
    };
  }

  function approveBody(row) {
    return {
      work_order_id: row.id,
      expected_updated_at: row.updated_at
    };
  }

  function parseAllowance(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (!text) return { error: 'Set the labour allowance. Use 0 when there is none.' };
    var amount = Number(text);
    if (!isFinite(amount) || amount < 0) return { error: 'The labour allowance must be zero or more.' };
    return { amount: Math.round(amount * 100) / 100 };
  }

  function parseGaps(res) {
    if (!res || typeof res !== 'object' || res.ok === false) return null;
    var c = res.counts;
    if (!c || typeof c !== 'object' || !Array.isArray(res.jobs)) return null;
    var noWo = validCount(c.no_work_order);
    var noAmt = validCount(c.no_amount);
    var withHeld = validCount(c.jobs_with_held_lines);
    if (noWo === null || noAmt === null || withHeld === null) return null;

    var jobs = [];
    for (var i = 0; i < res.jobs.length; i++) {
      var raw = res.jobs[i];
      if (!raw || typeof raw !== 'object') return null;
      var heldLines = raw.held_lines === undefined ? 0 : validCount(raw.held_lines);
      if (heldLines === null) return null;
      var heldTrades = 0;
      var heldAmt = 0;
      if (heldLines > 0) {
        heldTrades = validCount(raw.held_trades);
        var amtNum = validNum(raw.held_amount_ex);
        if (heldTrades === null || amtNum === null || amtNum < 0) return null;
        heldAmt = Math.round(amtNum * 100) / 100;
      }
      jobs.push({
        job_id: raw.job_id || '',
        job_number: raw.job_number || '',
        type: raw.type || raw.job_type || '',
        status: raw.status || '',
        reason: raw.reason === 'no_work_order' ? 'no_work_order' : 'no_amount',
        work_order_id: raw.work_order_id || '',
        held_lines: heldLines,
        held_trades: heldTrades,
        held_amount_ex: heldAmt,
        oldest_held_at: raw.oldest_held_at || null
      });
    }

    return {
      counts: {
        no_work_order: noWo,
        no_amount: noAmt,
        jobs_with_held_lines: withHeld
      },
      jobs: jobs
    };
  }

  function gapReasonWords(reason) {
    return reason === 'no_work_order' ? 'No work order' : 'No amount yet';
  }

  function oldestDays(oldestHeldAt, nowMs) {
    if (!oldestHeldAt) return null;
    var t = Date.parse(String(oldestHeldAt));
    if (!isFinite(t)) return null;
    var ref = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    return Math.max(0, Math.floor((ref - t) / 86400000));
  }

  function waitingNote(row, nowMs) {
    if (!row || !(row.held_lines > 0)) return '';
    var days = oldestDays(row.oldest_held_at, nowMs);
    var suffix = days === null ? '' : ', oldest ' + days + ' days';
    return row.held_lines + ' pay lines from ' + row.held_trades +
      ' trades are waiting on this job (' + money(row.held_amount_ex) + ')' + suffix;
  }

  function findGapJob(jobs, woId, jobId) {
    var list = Array.isArray(jobs) ? jobs : [];
    var i;
    if (woId) {
      for (i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].work_order_id || '') === String(woId)) return list[i];
      }
    }
    if (jobId) {
      for (i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].job_id || '') === String(jobId)) return list[i];
      }
    }
    return null;
  }

  function sumHeldLines(jobs) {
    var total = 0;
    var list = Array.isArray(jobs) ? jobs : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].held_lines > 0) total += list[i].held_lines;
    }
    return total;
  }

  function releasedLinesCount(check, nextGaps) {
    if (!check || !nextGaps) return 0;
    if (check.postRes && typeof check.postRes.released === 'number' &&
        isFinite(check.postRes.released) && check.postRes.released > 0) {
      return Math.floor(check.postRes.released);
    }
    var prev = check.prevGaps;
    if (!prev || !Array.isArray(prev.jobs) || !Array.isArray(nextGaps.jobs)) return 0;
    var prevJob = findGapJob(prev.jobs, check.woId, check.jobId);
    if (prevJob) {
      var nextJob = findGapJob(nextGaps.jobs, check.woId, check.jobId);
      var before = prevJob.held_lines;
      var after = nextJob ? nextJob.held_lines : 0;
      return before > after ? before - after : 0;
    }
    var prevSum = sumHeldLines(prev.jobs);
    var nextSum = sumHeldLines(nextGaps.jobs);
    return prevSum > nextSum ? prevSum - nextSum : 0;
  }

  // <labour-confirm> FU49 9(a): list_job_work_order_labour_confirm and the
  // one office press confirm_job_work_order_labour (switch
  // job_work_order_labour_confirm_v1). The proposal is the sealed quote's
  // labour amount as the server read it; this page never works one out.
  var OFFICE_ROLES = { admin: 1, owner: 1, ops_manager: 1 };
  var LABOUR_REASONS = {
    sealed_amount: 1,
    no_amount_in_sealed_quote: 1,
    no_sealed_quote: 1,
    revision_differs: 1
  };

  function isOfficeRole(role) {
    return !!OFFICE_ROLES[String(role || '').toLowerCase()];
  }

  // The confirm read: 'off' (switch off, not deployed, refused before the
  // switch, or any answer that does not say enabled), 'error' (a read that
  // failed for another reason), or 'on' with rows keyed by work order id.
  // A sealed_amount row without a readable amount and budget proposes
  // nothing and is marked unreadable, never $0.00.
  function parseLabourConfirm(res, err) {
    if (err) {
      if (isOff(null, err)) return { state: 'off' };
      var status = Number(err.status);
      if (status === 401 || status === 403) return { state: 'off' };
      return { state: 'error' };
    }
    if (!res || typeof res !== 'object' || res.enabled !== true) return { state: 'off' };
    if (!Array.isArray(res.jobs)) return { state: 'error' };
    var byWo = {};
    res.jobs.forEach(function (raw) {
      if (!raw || typeof raw !== 'object' || !raw.work_order_id) return;
      var reason = LABOUR_REASONS[raw.reason] ? raw.reason : 'unreadable';
      var proposal = null;
      if (reason === 'sealed_amount') {
        var p = raw.proposal;
        var amt = p && typeof p === 'object' ? validNum(p.agreed_labour_ex) : null;
        if (amt === null || amt < 0 || !p.job_budget_id) {
          reason = 'unreadable';
        } else {
          proposal = {
            agreed_labour_ex: Math.round(amt * 100) / 100,
            job_budget_id: String(p.job_budget_id)
          };
        }
      }
      byWo[String(raw.work_order_id)] = {
        work_order_id: String(raw.work_order_id),
        job_number: raw.job_number || '',
        reason: reason,
        proposal: proposal
      };
    });
    return { state: 'on', byWo: byWo, more: res.more === true };
  }

  function confirmBody(row) {
    return {
      work_order_id: row.work_order_id,
      job_budget_id: row.proposal.job_budget_id,
      agreed_labour_ex: row.proposal.agreed_labour_ex
    };
  }

  var CONFIRM_REFUSALS = {
    labour_confirm_off: 'Filling from the sealed quote is switched off. Nothing was saved.',
    proposal_changed: 'The sealed quote changed since this list was read. Nothing was saved. Read the list again.',
    work_order_has_amount: 'This work order already has an amount. Nothing was saved.',
    work_order_not_draft: 'This work order is no longer a draft. Nothing was saved.',
    work_order_not_found: 'This work order was not found. Nothing was saved.',
    job_not_open: 'This job is no longer open. Nothing was saved.',
    no_sealed_budget: 'This job has no sealed quote. Nothing was saved.',
    no_amount_in_sealed_quote: 'No amount in the sealed quote. Nothing was saved.',
    revision_differs: 'The draft came from a different quote revision. Nothing was saved.',
    signed_in_person_required: 'Only a signed-in office person can fill this. Nothing was saved.',
    operator_access_required: 'Only a signed-in office person can fill this. Nothing was saved.'
  };

  function confirmRefusalWords(err) {
    var code = err && (err.code || (err.body && err.body.code));
    return CONFIRM_REFUSALS[code] || 'The amount could not be filled. Nothing was saved. Read the list again.';
  }

  // Only a generic failure leaves the press open for another try; a named
  // refusal means the record changed, so the press stays shut.
  function confirmRetryable(err) {
    var code = err && (err.code || (err.body && err.body.code));
    return !CONFIRM_REFUSALS[code];
  }

  function confirmedNote(res, jobNumber) {
    if (!res || (res.state !== 'confirmed' && res.state !== 'already_confirmed')) return null;
    var amt = validNum(res.agreed_labour_ex);
    var what = amt === null ? 'The agreed amount' : money(amt);
    var on = jobNumber ? ' on ' + jobNumber : '';
    var lead = res.state === 'already_confirmed'
      ? what + on + ' was already filled from the sealed quote.'
      : what + on + ' was filled from the sealed quote.';
    return lead + ' A named approver still approves the work order in Work orders to fill.';
  }

  function labourRowHtml(lc, gapRow, canPress) {
    if (!lc || lc.state !== 'on' || !gapRow || gapRow.reason !== 'no_amount' || !gapRow.work_order_id) return '';
    var row = lc.byWo[String(gapRow.work_order_id)];
    if (!row) return '';
    var h = '<div class="owc" data-office-wo-labour="' + esc(row.reason) + '">';
    if (row.reason === 'sealed_amount') {
      h += '<div class="owc-line"><span class="owc-label">Sealed quote labour</span> ' +
        '<b data-office-wo-labour-amount>' + esc(money(row.proposal.agreed_labour_ex)) + '</b> <span class="owc-tag">proposed</span></div>';
      if (canPress) {
        h += '<div class="owc-act"><button type="button" class="btn btn-primary btn-sm" data-office-wo-labour-confirm' +
          ' data-job-budget-id="' + esc(row.proposal.job_budget_id) + '"' +
          ' data-agreed-labour-ex="' + esc(String(row.proposal.agreed_labour_ex)) + '">Fill from sealed quote</button>' +
          '<span class="owc-note">Fills the draft only. A named approver still approves it.</span></div>';
      }
    } else if (row.reason === 'no_amount_in_sealed_quote') {
      h += '<div class="owc-line owc-none">No amount in the sealed quote</div>';
    } else if (row.reason === 'no_sealed_quote') {
      h += '<div class="owc-line owc-none">No sealed quote for this job</div>';
    } else if (row.reason === 'revision_differs') {
      h += '<div class="owc-line owc-none">The draft came from a different quote revision, so nothing is proposed</div>';
    } else {
      h += '<div class="owc-line owc-none">The sealed quote amount could not be read, so nothing is proposed</div>';
    }
    h += '</div>';
    return h;
  }
  // </labour-confirm>

  function gapsLoadingHtml() {
    return '<section class="owf owg" data-office-wo-gaps aria-label="Needs a work order">' +
      '<div class="owf-title">Needs a work order</div>' +
      '<div class="owg-loading" data-office-wo-gaps-loading role="status">Checking for jobs with no work order...</div>' +
      '</section>';
  }

  function gapsErrorHtml() {
    return '<section class="owf owg" data-office-wo-gaps aria-label="Needs a work order">' +
      '<div class="owf-title">Needs a work order</div>' +
      '<div class="owg-error" data-office-wo-gaps-error role="alert">' +
      '<span>The list could not be read, so it is not shown. Try again.</span>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-office-wo-gaps-retry>Retry</button>' +
      '</div></section>';
  }

  function gapsHtml(parsed, opts) {
    opts = opts || {};
    var c = parsed.counts;
    var h = '<section class="owf owg" data-office-wo-gaps aria-label="Needs a work order">';
    h += '<div class="owf-title">Needs a work order</div>';
    h += '<div class="owg-counts" data-office-wo-gaps-counts>';
    h += '<span class="owg-count" data-office-wo-gaps-count="no_work_order">Jobs with no work order: ' + esc(c.no_work_order) + '</span>';
    h += '<span class="owg-count" data-office-wo-gaps-count="no_amount">Work orders with no amount: ' + esc(c.no_amount) + '</span>';
    h += '<span class="owg-count" data-office-wo-gaps-count="jobs_with_held_lines">Jobs with pay waiting: ' + esc(c.jobs_with_held_lines) + '</span>';
    h += '</div>';
    if (opts.released && opts.released > 0) {
      h += '<div class="owg-released" role="status" data-office-wo-gaps-released>Work order approved</div>';
    }
    if (opts.confirmed) {
      h += '<div class="owg-released" role="status" data-office-wo-labour-confirmed>' + esc(opts.confirmed) + '</div>';
    }
    var lc = opts.labour || null;
    if (lc && lc.state === 'error' && parsed.jobs.some(function (r) { return r.reason === 'no_amount'; })) {
      h += '<div class="owg-error" data-office-wo-labour-error role="alert">The sealed quote amounts could not be read, so none is proposed.</div>';
    }
    if (!parsed.jobs.length) {
      h += '<div class="owf-empty" data-office-wo-gaps-empty>Every live job has a work order with an amount.</div></section>';
      return h;
    }
    parsed.jobs.forEach(function (row) {
      var note = waitingNote(row, opts.nowMs);
      h += '<article class="owg-row" data-office-wo-gap="' + esc(row.job_id) + '" data-gap-reason="' + esc(row.reason) + '" data-work-order-id="' + esc(row.work_order_id) + '">';
      h += '<div class="owg-main"><div class="owg-info"><div class="owg-id">';
      h += '<b>' + esc(row.job_number || '-') + '</b>';
      if (row.type) h += ' <span class="owg-type">' + esc(row.type) + '</span>';
      h += ' <span class="owg-reason">' + esc(gapReasonWords(row.reason)) + '</span>';
      h += '</div>';
      if (note) {
        h += '<div class="owg-waiting" data-office-wo-gap-waiting>' + esc(note) + '</div>';
      }
      h += labourRowHtml(lc, row, opts.canPress === true);
      h += '</div><div class="owg-actions">';
      if (row.reason === 'no_work_order') {
        h += '<button type="button" class="btn btn-secondary btn-sm" data-office-wo-gap-open>Open a work order</button>';
      } else {
        h += '<button type="button" class="btn btn-secondary btn-sm" data-office-wo-gap-fill>Fill the amount</button>';
      }
      h += '</div></div>';
      h += '<div class="owf-msg" data-office-wo-gap-msg role="alert" hidden></div>';
      h += '</article>';
    });
    h += '</section>';
    return h;
  }

  function queueHtml(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var h = '<section class="owf" data-office-wo-fill-queue aria-label="Work orders to fill">';
    h += '<div class="owf-title">Work orders to fill</div>';
    if (!list.length) {
      h += '<div class="owf-empty" data-office-wo-fill-empty>No draft job work orders to fill.</div></section>';
      return h;
    }
    list.forEach(function (row) {
      if (!row) return;
      var needs = row.needs_allowance === true || row.agreed_labour_ex == null;
      var amount = needs ? '' : money(row.agreed_labour_ex);
      h += '<article class="owf-row" data-office-wo-fill="' + esc(row.id) + '" data-job-id="' + esc(row.job_id || '') + '" data-updated-at="' + esc(row.updated_at || '') + '" data-needs-allowance="' + (needs ? '1' : '0') + '">';
      h += '<div class="owf-id"><b>' + esc(row.wo_number || 'Draft') + '</b>';
      h += ' <span>' + esc(row.job_number || '') + '</span>';
      if (row.job_type) h += ' <span>' + esc(row.job_type) + '</span>';
      h += '</div>';
      h += '<div class="owf-who">' + esc(row.client_name || 'Client') + (row.site_suburb ? ' \u00b7 ' + esc(row.site_suburb) : '') + '</div>';
      h += '<label class="owf-allow">Labour allowance';
      h += '<input data-office-wo-allowance inputmode="decimal" value="' + esc(needs ? '' : String(row.agreed_labour_ex)) + '" aria-label="Labour allowance">';
      h += '</label>';
      h += '<div class="owf-fig" data-office-wo-allowance-shown>' + (needs ? 'Needs a labour allowance' : esc(amount)) + '</div>';
      h += '<div class="owf-actions">';
      h += '<button type="button" class="btn btn-secondary btn-sm" data-office-wo-fill-save>Save allowance</button>';
      if (!needs) h += '<button type="button" class="btn btn-primary btn-sm" data-office-wo-fill-approve>Approve</button>';
      h += '</div>';
      h += '<div class="owf-msg" data-office-wo-fill-msg hidden></div>';
      h += '</article>';
    });
    h += '</section>';
    return h;
  }

  return {
    money: money,
    isTradeRole: isTradeRole,
    isOff: isOff,
    fillBody: fillBody,
    approveBody: approveBody,
    parseAllowance: parseAllowance,
    parseGaps: parseGaps,
    gapReasonWords: gapReasonWords,
    waitingNote: waitingNote,
    releasedLinesCount: releasedLinesCount,
    isOfficeRole: isOfficeRole,
    parseLabourConfirm: parseLabourConfirm,
    confirmBody: confirmBody,
    confirmRefusalWords: confirmRefusalWords,
    confirmRetryable: confirmRetryable,
    confirmedNote: confirmedNote,
    labourRowHtml: labourRowHtml,
    gapsLoadingHtml: gapsLoadingHtml,
    gapsErrorHtml: gapsErrorHtml,
    gapsHtml: gapsHtml,
    queueHtml: queueHtml
  };
})();
// </office-wo-fill-core>

(function () {
  'use strict';
  var C = OfficeWoFillCore;
  var switchOn = false;
  var lastGaps = null;
  var gapsSeq = 0;
  var lastConfirmed = null;

  function noteSwitch(res) {
    if (res && (res.enabled === true || (res.enabled !== false && Array.isArray(res.work_orders)))) {
      switchOn = true;
      return;
    }
    switchOn = false;
  }

  function role() {
    try {
      var cloud = window.SECUREWORKS_CLOUD;
      if (cloud && cloud.auth && typeof cloud.auth.getRole === 'function') return String(cloud.auth.getRole() || '');
    } catch (e) { /* empty role stays office */ }
    return '';
  }

  function host() {
    return document.getElementById('officeWoFill');
  }

  function gapsHost() {
    return document.getElementById('officeWoGaps');
  }

  function clearFill() {
    var el = host();
    if (el) el.innerHTML = '';
  }

  function clearGaps() {
    var el = gapsHost();
    if (el) el.innerHTML = '';
    lastGaps = null;
  }

  function clearAll() {
    gapsSeq++;
    clearFill();
    clearGaps();
  }

  function cssEsc(val) {
    var s = String(val == null ? '' : val);
    return window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(s)
      : s.replace(/["\\]/g, '\\$&');
  }

  function showMsg(rowEl, text) {
    var msg = rowEl && rowEl.querySelector('[data-office-wo-fill-msg]');
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || '';
  }

  function showGapMsg(rowEl, text) {
    var msg = rowEl && rowEl.querySelector('[data-office-wo-gap-msg]');
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || '';
  }

  function refreshLoadedWorkOrdersList() {
    if (window.WorkOrdersList && window.WorkOrdersList._state &&
        window.WorkOrdersList._state.loaded && typeof window.WorkOrdersList.load === 'function') {
      window.WorkOrdersList.load();
    }
  }

  function focusQueueWorkOrder(woId, jobId) {
    var fillEl = host();
    if (fillEl) {
      fillEl.querySelectorAll('[data-office-wo-fill-active]').forEach(function (n) {
        n.removeAttribute('data-office-wo-fill-active');
      });
    }
    var target = null;
    if (fillEl && woId) {
      target = fillEl.querySelector('[data-office-wo-fill="' + cssEsc(woId) + '"]');
    }
    if (!target && fillEl && jobId) {
      target = fillEl.querySelector('[data-office-wo-fill][data-job-id="' + cssEsc(jobId) + '"]');
    }
    if (target) {
      target.setAttribute('data-office-wo-fill-active', '1');
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      var input = target.querySelector('[data-office-wo-allowance]');
      if (input) {
        try { input.focus({ preventScroll: true }); } catch (e) {
          try { input.focus(); } catch (e2) { /* ignore focus errors */ }
        }
      }
      return;
    }
    if (jobId && window.JobWorkOrderOps && typeof window.JobWorkOrderOps.openForJob === 'function') {
      window.JobWorkOrderOps.openForJob(jobId);
    }
  }

  async function onLabourConfirm(btn) {
    var gapRow = btn.closest('[data-office-wo-gap]');
    if (!gapRow || btn.disabled || typeof opsPost !== 'function') return;
    if (!C.isOfficeRole(role())) return;
    var amount = Number(btn.getAttribute('data-agreed-labour-ex'));
    var budgetId = btn.getAttribute('data-job-budget-id') || '';
    var woId = gapRow.getAttribute('data-work-order-id') || '';
    if (!woId || !budgetId || !isFinite(amount)) return;
    var jobNumber = (gapRow.querySelector('.owg-id b') || {}).textContent || '';
    btn.disabled = true;
    showGapMsg(gapRow, '');
    var res;
    try {
      res = await opsPost('confirm_job_work_order_labour', C.confirmBody({
        work_order_id: woId,
        proposal: { job_budget_id: budgetId, agreed_labour_ex: amount }
      }));
    } catch (e) {
      if (C.confirmRetryable(e)) btn.disabled = false;
      showGapMsg(gapRow, C.confirmRefusalWords(e));
      return;
    }
    var note = C.confirmedNote(res, jobNumber);
    if (!note) {
      btn.disabled = false;
      showGapMsg(gapRow, C.confirmRefusalWords(null));
      return;
    }
    lastConfirmed = note;
    await paint();
    refreshLoadedWorkOrdersList();
  }

  async function onGapsClick(ev) {
    var confirmBtn = ev.target.closest('[data-office-wo-labour-confirm]');
    if (confirmBtn) {
      await onLabourConfirm(confirmBtn);
      return;
    }
    var retryBtn = ev.target.closest('[data-office-wo-gaps-retry]');
    if (retryBtn) {
      await paintGaps(null);
      return;
    }
    var fillBtn = ev.target.closest('[data-office-wo-gap-fill]');
    if (fillBtn) {
      var fillGapRow = ev.target.closest('[data-office-wo-gap]');
      if (!fillGapRow) return;
      focusQueueWorkOrder(
        fillGapRow.getAttribute('data-work-order-id') || '',
        fillGapRow.getAttribute('data-office-wo-gap') || ''
      );
      return;
    }
    var openBtn = ev.target.closest('[data-office-wo-gap-open]');
    if (!openBtn) return;
    var gapRow = ev.target.closest('[data-office-wo-gap]');
    if (!gapRow || openBtn.disabled) return;
    var jobId = gapRow.getAttribute('data-office-wo-gap') || '';
    if (!jobId || typeof opsPost !== 'function') {
      showGapMsg(gapRow, 'Could not open a work order.');
      return;
    }
    openBtn.disabled = true;
    showGapMsg(gapRow, '');
    try {
      await opsPost('create_work_order', { kind: 'job', job_id: jobId });
      await paint();
      refreshLoadedWorkOrdersList();
    } catch (e) {
      openBtn.disabled = false;
      showGapMsg(gapRow, (e && e.message) || 'Could not open a work order.');
    }
  }

  async function onFillClick(ev) {
    var save = ev.target.closest('[data-office-wo-fill-save]');
    var approve = ev.target.closest('[data-office-wo-fill-approve]');
    if (!save && !approve) return;
    var rowEl = ev.target.closest('[data-office-wo-fill]');
    if (!rowEl || typeof opsPost !== 'function') return;
    var id = rowEl.getAttribute('data-office-wo-fill');
    var jobId = rowEl.getAttribute('data-job-id') || '';
    var input = rowEl.querySelector('[data-office-wo-allowance]');
    var stamp = rowEl.getAttribute('data-updated-at') || '';
    var row = { id: id, updated_at: stamp };
    var prevGaps = lastGaps;
    try {
      var postRes;
      if (save) {
        var parsed = C.parseAllowance(input && input.value);
        if (parsed.error) { showMsg(rowEl, parsed.error); return; }
        postRes = await opsPost('fill_job_work_order_allowance', C.fillBody(row, parsed.amount));
      } else {
        postRes = await opsPost('approve_office_job_work_order', C.approveBody(row));
      }
      await paint({
        releaseCheck: {
          prevGaps: prevGaps,
          woId: id,
          jobId: jobId,
          postRes: postRes
        }
      });
      refreshLoadedWorkOrdersList();
    } catch (e) {
      if (C.isOff(null, e)) { switchOn = false; clearFill(); return; }
      showMsg(rowEl, (e && e.message) || 'That could not be saved.');
    }
  }

  function bind() {
    var fillEl = host();
    if (fillEl && !fillEl.__owfBound) {
      fillEl.__owfBound = true;
      fillEl.addEventListener('click', onFillClick);
    }
    var gEl = gapsHost();
    if (gEl && !gEl.__owgBound) {
      gEl.__owgBound = true;
      gEl.addEventListener('click', onGapsClick);
    }
    if (!document.getElementById('officeWoFillCss')) {
      var style = document.createElement('style');
      style.id = 'officeWoFillCss';
      style.textContent =
        '.owf{margin:0 0 16px;padding:12px;background:var(--sw-card,#fff);border:1px solid var(--sw-border,#e5e7eb);border-radius:8px}' +
        '.owf-title{font-size:14px;font-weight:700;margin-bottom:8px;color:var(--sw-text,#1f2937)}' +
        '.owf-row{padding:10px 0;border-top:1px solid var(--sw-border,#e5e7eb)}' +
        '.owf-row[data-office-wo-fill-active="1"]{background:#f8fafc;padding-left:8px;padding-right:8px;border-left:3px solid var(--sw-orange,#d97706)}' +
        '.owf-who,.owf-fig,.owf-msg,.owf-empty{font-size:12px;color:var(--sw-text-sec,#4b5563);margin-top:4px}' +
        '.owf-allow{display:block;font-size:12px;margin-top:8px}.owf-allow input{display:block;margin-top:4px;padding:6px 8px;width:140px;max-width:100%;box-sizing:border-box}' +
        '.owf-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}' +
        '.owg-counts{display:flex;flex-wrap:wrap;gap:8px 12px;margin:0 0 10px;font-size:12px;color:var(--sw-text,#1f2937)}' +
        '.owg-count{background:var(--sw-light,#f3f4f6);border:1px solid var(--sw-border,#e5e7eb);border-radius:6px;padding:4px 10px;font-weight:600}' +
        '.owg-row{padding:10px 0;border-top:1px solid var(--sw-border,#e5e7eb)}' +
        '.owg-main{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:8px 12px}' +
        '.owg-info{min-width:0;flex:1 1 220px}' +
        '.owg-id{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;font-size:13px;color:var(--sw-text,#1f2937)}' +
        '.owg-type{font-size:12px;padding:1px 7px;border-radius:4px;background:#f1f5f9;color:#334155;font-weight:500}' +
        '.owg-reason{font-size:12px;font-weight:600;color:#334155}' +
        '.owg-waiting{margin-top:6px;padding:6px 10px;border-radius:6px;background:#fffbeb;border:1px solid #f59e0b;color:#92400e;font-size:12px;font-weight:500;line-height:1.4}' +
        '.owg-released{margin:0 0 10px;padding:8px 10px;border-radius:6px;background:#ecfdf5;border:1px solid #10b981;color:#065f46;font-size:12px;font-weight:600}' +
        '.owg-loading{font-size:12px;color:#334155;padding:4px 0}' +
        '.owg-error{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;padding:8px 10px;border-radius:6px;background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;font-size:12px}' +
        '.owg-actions{display:flex;align-items:center;gap:8px}' +
        '.owc{margin-top:6px;font-size:12px;color:var(--sw-text,#1f2937)}' +
        '.owc-label{color:#334155}.owc-tag{font-size:11px;padding:1px 6px;border-radius:4px;background:#eff6ff;color:#1e40af;font-weight:600}' +
        '.owc-none{color:#475569;font-style:italic}' +
        '.owc-act{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px}' +
        '.owc-note{color:#475569}';
      document.head.appendChild(style);
    }
  }

  async function paintGaps(releaseCheck) {
    var el = gapsHost();
    if (!el) return;
    var seq = ++gapsSeq;
    var confirmed = lastConfirmed;
    lastConfirmed = null;
    el.innerHTML = C.gapsLoadingHtml();
    // The sealed quote proposals are read beside the gaps; their failure
    // never hides the gaps, and the gaps' failure is the section's error.
    var labourRead = Promise.resolve()
      .then(function () { return opsFetch('list_job_work_order_labour_confirm', { limit: 50 }); })
      .then(function (r) { return C.parseLabourConfirm(r, null); },
        function (e) { return C.parseLabourConfirm(null, e || {}); });
    try {
      var res = await opsFetch('job_work_order_gaps');
      var labour = await labourRead;
      if (seq !== gapsSeq) return;
      var curEl = gapsHost();
      if (!curEl) return;
      var parsed = C.parseGaps(res);
      if (!parsed) {
        lastGaps = null;
        curEl.innerHTML = C.gapsErrorHtml();
        return;
      }
      var released = C.releasedLinesCount(releaseCheck, parsed);
      lastGaps = parsed;
      curEl.innerHTML = C.gapsHtml(parsed, {
        released: released,
        labour: labour,
        canPress: C.isOfficeRole(role()),
        confirmed: confirmed
      });
    } catch (e) {
      if (seq !== gapsSeq) return;
      lastGaps = null;
      var failEl = gapsHost();
      if (failEl) failEl.innerHTML = C.gapsErrorHtml();
    }
  }

  async function paintFill() {
    try {
      var res = await opsFetch('list_office_job_work_orders');
      var el = host();
      if (!el) return;
      if (C.isOff(res)) { switchOn = false; el.innerHTML = ''; return; }
      noteSwitch(res);
      el.innerHTML = C.queueHtml(res && res.work_orders);
    } catch (e) {
      clearFill();
      if (C.isOff(null, e)) { switchOn = false; return; }
      if (!switchOn) return;
      var elFail = host();
      if (elFail) elFail.innerHTML = '<div data-office-wo-fill-error>Work orders to fill could not be read.</div>';
    }
  }

  async function paint(opts) {
    bind();
    if (C.isTradeRole(role())) { clearAll(); return; }
    if (typeof opsFetch !== 'function') { clearAll(); return; }
    var releaseCheck = opts && opts.releaseCheck ? opts.releaseCheck : null;
    await Promise.all([
      paintGaps(releaseCheck),
      paintFill()
    ]);
  }

  window.OfficeWoFill = { paint: paint, loadGaps: paintGaps, core: C };
})();
