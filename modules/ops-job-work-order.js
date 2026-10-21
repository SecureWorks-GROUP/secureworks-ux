// ════════════════════════════════════════════════════════════
// JOB WORK ORDER on the Ops job page (Build tab) and in the office Work Order
// PDF. Screen doc: docs/job-work-order-screens.md. Lines, status, refusal
// words and the HTML come from shared/job-work-order.js (JobWorkOrderCore).
//
// Office sees this on every job type. A trade role on this page does not see
// it: agreed labour stays off every trade screen. ?wo=live does not hide it
// and does not bring back the retired crew form. The Trade App does not
// load this file.
//
// Reads:  job_detail.job_work_order (already loaded by openJobDetail),
//         ops-api job_work_order (the billed lines and trade-reported
//         variations), read again for every job_detail read (job open or
//         refresh), so the panel never shows an older copy than job_detail,
//         and list_trade_invoice_lines on every office open, merged onto the
//         work order lines by line id so review state is not dropped when a
//         work order exists.
// Writes: ops-api approve_work_order {work_order_id, expected_updated_at},
//         only from the approver's button, with the updated_at of the draft
//         this panel shows, so the seal covers exactly what was read.
//         ops-api create_work_order {kind:'job', job_id}, only from the
//         "Open the draft" button on a job with no work order yet; the
//         server opens the job's draft and fills it from the accepted quote.
//         Customer variations (staff): create_customer_variation,
//         update_customer_variation, approve_customer_variation (the
//         approver) and cancel_customer_variation, each edit, approval and
//         cancellation with the updated_at of the variation on screen; and
//         prepare_customer_variation_invoice_line, which only builds the
//         customer's invoice line for a preview. Nothing here creates a Xero
//         draft (create_customer_variation_xero_draft is never called).
//         An approved variation whose Xero draft record is stuck ('unknown',
//         or 'creating' for 15 minutes) says so, and the approver answers
//         what Xero shows with reconcile_customer_variation_xero_draft
//         {variation_id, expected_updated_at (invoice.updated_at as read),
//         outcome, xero_invoice_id?, invoice_number?}, which never calls Xero.
//
// Create work order: every job type's "Create work order" (job quick view,
// calendar) opens this panel (openForJob). The old office form that wrote
// kind='crew' does not. Open the draft posts create_work_order {kind:'job'}.
// Until the server accepts every job type, a refusal reads in words and the
// old form is not offered.
// ════════════════════════════════════════════════════════════

var JobWorkOrderOps = (function () {
  'use strict';

  var MOUNT_ID = 'jdJobWorkOrder';
  // Same trade roles as the job Overview. An empty role is office: this page
  // is the Ops dashboard, and the tests sign in by email without a role.
  var TRADE_ROLES = ['installer', 'lead_installer', 'crew', 'trade', 'subcontractor'];
  // One state per job_detail read: the job_work_order read and the approve button.
  var _state = { data: null, jobId: null, detail: null, detailState: 'idle', busy: false, confirming: false, message: '', level: 'info', seq: 0, cv: freshCv() };

  // The customer variations section: the open form, the confirm row, the
  // invoice line previews, and its own message.
  function freshCv() {
    return { form: null, confirm: null, busy: false, previews: {}, previewBusyId: null, xero: null, message: '', level: 'info' };
  }

  function core() { return window.JobWorkOrderCore || null; }

  function viewerEmail() {
    return (typeof _opsUserEmail !== 'undefined' && _opsUserEmail) || '';
  }

  function viewerRole() {
    try {
      var c = window.SECUREWORKS_CLOUD;
      if (c && c.auth && typeof c.auth.getRole === 'function') return String(c.auth.getRole() || '').toLowerCase();
    } catch (e) { /* no session object: treat as office, below */ }
    return '';
  }

  // Office and admin see the panel and the agreed labour. A trade role does not.
  function viewerIsOffice() {
    var role = viewerRole();
    if (!role) return true;
    return TRADE_ROLES.indexOf(role) < 0;
  }

  // Office and admin. The old ?wo=live switch does not hide this and does not
  // choose a create path.
  function officeOn() {
    return viewerIsOffice();
  }

  function currentData() {
    return (typeof _currentJobData !== 'undefined' && _currentJobData) || null;
  }

  function resetFor(data) {
    if (_state.data === data) return;
    _state = { data: data, jobId: data.job.id, detail: null, detailState: 'idle', invoiceLines: null, invoiceLinesState: 'idle', busy: false, confirming: false, message: '', level: 'info', seq: _state.seq + 1, cv: freshCv() };
  }

  function panelHtml(data) {
    var C = core();
    if (!C || !data || !data.job) return '';
    // A missing block is a job with no work order yet, not a hidden panel.
    // statusOf(null) is not_applicable and would draw nothing.
    var block = data.job_work_order || { work_order: null };
    var h = C.renderOpsPanel(block, _state.detail, _state.detailState, {
      viewerEmail: viewerEmail(),
      busy: _state.busy,
      message: _state.message,
      messageLevel: _state.level,
      preview: false,
      canOpen: true,
      cv: Object.assign({}, _state.cv, { now: Date.now() })
    });
    if (_state.confirming && h) {
      var wo = shownWorkOrder(data);
      h = h.replace('<div class="jwo-sub">', confirmHtml(wo) + '<div class="jwo-sub">');
    }
    return h;
  }

  function confirmHtml(wo) {
    var C = core();
    return '<div class="jwo-confirm" data-job-wo-confirm>' +
      '<div>Approve and seal ' + C.esc((wo && wo.wo_number) || 'this work order') + ' as shown? Once sealed nothing on it can change; a later change is a variation.</div>' +
      '<div class="jwo-confirm-actions"><button type="button" class="btn btn-primary btn-sm" data-job-wo-approve-yes onclick="JobWorkOrderOps.approveConfirmed()">Approve and seal</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" onclick="JobWorkOrderOps.cancelApprove()">Cancel</button></div></div>';
  }

  // The work order on screen: the job_work_order read made for this
  // job_detail read when it has landed, else the copy job_detail carried.
  // Approval carries ITS updated_at.
  function shownWorkOrder(data) {
    if (_state.data === data && _state.detail && _state.detail.work_order) return _state.detail.work_order;
    var block = data && data.job_work_order;
    return (block && block.work_order) || null;
  }

  // The Build tab calls this; it returns the mount, filled with what is known
  // now, and starts the job_work_order read once per job_detail read.
  function buildTabHtml(data) {
    if (!officeOn() || !data || !data.job) return '';
    injectCss();
    ensureReads(data);
    return '<div id="' + MOUNT_ID + '">' + panelHtml(data) + '</div>';
  }

  // The Overview mount. Same office gate as the Build tab. The card itself
  // is JobWorkOrderCore.renderOverviewCard.
  function paintOverview(data) {
    var host = document.querySelector('[data-job-wo-overview]');
    if (!host) return;
    if (!officeOn() || !data || !data.job) { host.innerHTML = ''; return; }
    injectCss();
    ensureReads(data);
    host.innerHTML = overviewInner(data);
  }

  // The job_work_order lines array, when it is actually crew invoice lines.
  // An empty array is an answer (none). Scope rows are not, so the card
  // falls through to list_trade_invoice_lines.
  function crewLinesAnswer(res) {
    if (!res) return null;
    var list = Array.isArray(res.crew_lines) ? res.crew_lines : (Array.isArray(res.lines) ? res.lines : null);
    if (!list) return null;
    if (!list.length) return list;
    var shaped = list.some(function (row) {
      return row && (row.trade_name != null || row.line_total_ex != null || row.override_amount != null
        || row.review_state != null || row.acknowledgment_status != null || row.trade_invoice_id != null
        || row.amount_ex != null || row.week_label != null || row.total_hours != null || row.line_type != null);
    });
    return shaped ? list : null;
  }

  function overviewInner(data) {
    var C = core();
    if (!C || !data) return '';
    var opts = { showMoney: true, linesState: 'absent', canOpen: true, busy: _state.busy };
    if (_state.data === data) {
      opts.message = _state.message;
      opts.messageLevel = _state.level;
      var detail = _state.detail;
      var woLines = crewLinesAnswer(detail);
      var invState = _state.invoiceLinesState;
      var hasWo = data.job_work_order && data.job_work_order.work_order;
      if (invState === 'ready') {
        opts.lines = C.mergeCrewInvoiceLines(woLines || [], _state.invoiceLines || []);
        opts.linesState = 'ready';
      } else if (woLines && woLines.length) {
        opts.lines = woLines;
        opts.linesState = 'ready';
      } else if (invState === 'loading' || _state.detailState === 'loading' || (hasWo && _state.detailState === 'idle')) {
        opts.linesState = 'loading';
      } else if (invState === 'failed' || _state.detailState === 'failed') {
        opts.linesState = 'failed';
      } else if (woLines) {
        opts.lines = woLines;
        opts.linesState = 'ready';
      }
    }
    return C.renderOverviewCard(data.job_work_order || null, _state.data === data ? _state.detail : null, opts);
  }

  // One read for the open job_detail: job_work_order when the job has one,
  // and list_trade_invoice_lines every time, including when a work order
  // already carries lines. Review state is merged by line id.
  function ensureReads(data) {
    if (!data || !data.job) return;
    resetFor(data);
    var hasWo = data.job_work_order && data.job_work_order.work_order;
    if (hasWo && _state.detailState === 'idle') loadDetail(data.job.id);
    if (_state.invoiceLinesState === 'idle') loadInvoiceLines(data.job.id);
  }

  // Repaint with what is typed in the variation form kept.
  function repaint() {
    syncForm();
    render();
  }

  // Repaint from the state alone: for a change made to the form's state
  // itself (a task row added or removed) after it was read from the page.
  function render() {
    var data = currentData();
    if (!data || data !== _state.data) return;
    var el = document.getElementById(MOUNT_ID);
    if (el) el.innerHTML = panelHtml(data);
    var host = document.querySelector('[data-job-wo-overview]');
    if (host && officeOn()) host.innerHTML = overviewInner(data);
  }

  function loadInvoiceLines(jobId) {
    var seq = _state.seq;
    _state.invoiceLinesState = 'loading';
    opsFetch('list_trade_invoice_lines', { job_id: jobId }).then(function (inv) {
      if (seq !== _state.seq) return;
      _state.invoiceLines = (inv && inv.lines) || [];
      _state.invoiceLinesState = 'ready';
      repaint();
    }).catch(function () {
      if (seq !== _state.seq) return;
      _state.invoiceLinesState = 'failed';
      repaint();
    });
  }

  function loadDetail(jobId) {
    var seq = _state.seq;
    _state.detailState = 'loading';
    opsFetch('job_work_order', { job_id: jobId }).then(function (res) {
      if (seq !== _state.seq) return;
      _state.detail = res || null;
      _state.detailState = res ? 'ready' : 'failed';
      repaint();
    }).catch(function () {
      if (seq !== _state.seq) return;
      _state.detailState = 'failed';
      repaint();
    });
  }

  function approve() {
    var C = core();
    var data = currentData();
    var wo = shownWorkOrder(data);
    if (!C || !C.canApprove(wo, viewerEmail()) || _state.busy) return;
    _state.confirming = true;
    _state.message = '';
    repaint();
  }

  function cancelApprove() {
    _state.confirming = false;
    repaint();
  }

  function approveConfirmed() {
    var C = core();
    var data = currentData();
    var wo = shownWorkOrder(data);
    if (!C || !C.canApprove(wo, viewerEmail()) || _state.busy) return;
    var seq = _state.seq;
    _state.busy = true;
    _state.confirming = false;
    _state.message = '';
    repaint();
    opsPost('approve_work_order', { work_order_id: wo.id, expected_updated_at: wo.updated_at }).then(function () {
      if (seq !== _state.seq) return;
      rereadJob('Approved and sealed.', 'ok');
      if (typeof showToast === 'function') showToast('Work order approved and sealed', 'success');
    }).catch(function (e) {
      if (seq !== _state.seq) return;
      var code = (e && e.code) || '';
      var words = C.refusalWords(code, e && e.message);
      if (C.refusalNeedsReread(code)) {
        rereadJob(words, 'warn');
      } else {
        _state.busy = false;
        _state.message = words;
        _state.level = 'error';
        repaint();
      }
    });
  }

  // Read the job (and so the work order) again after an approval or a
  // refusal that says the draft moved, then show the message on the fresh
  // copy: the fresh job_detail read resets this panel and reads its work order.
  // where 'cv' shows the message in the customer variations section.
  function rereadJob(message, level, where) {
    var jobId = _state.jobId;
    var done = function () {
      if (_state.jobId !== jobId) return;
      _state.busy = false;
      _state.cv.busy = false;
      if (where === 'cv') {
        _state.cv.message = message;
        _state.cv.level = level;
      } else {
        _state.message = message;
        _state.level = level;
      }
      repaint();
    };
    if (typeof refreshJobDetail === 'function') refreshJobDetail().then(done, done);
    else done();
  }

  // Open the job's draft on a job with no work order yet. The server opens it
  // (or answers with the one already open) and fills it from the accepted
  // quote; the job is then read again so the draft is shown as stored.
  function openDraft() {
    var C = core();
    var data = currentData();
    if (!C || !data || data !== _state.data || _state.busy) return;
    var block = data.job_work_order;
    if (block && (block.unreadable || block.work_order)) return;
    var seq = _state.seq;
    _state.busy = true;
    _state.message = '';
    repaint();
    opsPost('create_work_order', { kind: 'job', job_id: _state.jobId }).then(function (res) {
      if (seq !== _state.seq) return;
      rereadJob(C.openedWords(res), 'ok');
    }).catch(function (e) {
      if (seq !== _state.seq) return;
      var code = (e && e.code) || '';
      var words = C.openRefusalWords(code, e && e.message);
      if (C.openRefusalNeedsReread(code)) {
        rereadJob(words, 'warn');
      } else {
        _state.busy = false;
        _state.message = words;
        _state.level = 'error';
        repaint();
      }
    });
  }

  // Always the job work order. The old form that wrote kind='crew' is retired,
  // including while ?wo=live is in the address.
  function createRoute() {
    return 'job';
  }

  // Fencing and patio open on Build, where the panel sits. A make-safe has
  // no Build tab: that tab is the patio scope tool, so Open Work Order stays
  // on Overview, where the card's Open the draft lives.
  function openForJob(jobId) {
    if (!jobId || typeof openJobDetail !== 'function') return Promise.resolve();
    return Promise.resolve(openJobDetail(jobId)).then(function () {
      var data = currentData();
      var current = (typeof _currentJobId !== 'undefined') ? _currentJobId : null;
      if (!(data && String(current) === String(jobId) && typeof showJobSubView === 'function')) return;
      var type = data.job && String(data.job.type || '').toLowerCase();
      showJobSubView(type === 'makesafe' ? 'overview' : 'build');
    });
  }

  // ── Customer variations ──
  function customerVariations() {
    return (_state.detail && Array.isArray(_state.detail.customer_variations)) ? _state.detail.customer_variations : [];
  }

  function findVariation(id) {
    var list = customerVariations();
    for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === String(id)) return list[i];
    return null;
  }

  // The form's typed values, read from the page into the state before any
  // repaint, so a read landing while someone types never loses their words.
  function syncForm() {
    var form = _state.cv.form;
    var el = document.getElementById(MOUNT_ID);
    var confirm = _state.cv.confirm;
    var reason = el && el.querySelector('[data-job-wo-cv-cancel-reason]');
    if (confirm && confirm.kind === 'cancel' && reason) confirm.reason = reason.value;
    var dialog = _state.cv.xero;
    var dbox = el && el.querySelector('[data-job-wo-cv-xero-dialog]');
    if (dialog && dbox) {
      var outcome = dbox.querySelector('[data-cv-xero-f="outcome"]:checked');
      dialog.outcome = outcome ? outcome.value : '';
      var idBox = dbox.querySelector('[data-cv-xero-f="invoiceId"]');
      if (idBox) dialog.invoiceId = idBox.value;
      var numBox = dbox.querySelector('[data-cv-xero-f="invoiceNumber"]');
      if (numBox) dialog.invoiceNumber = numBox.value;
      var checked = dbox.querySelector('[data-cv-xero-f="checked"]');
      dialog.checked = !!(checked && checked.checked);
    }
    var box = el && el.querySelector('[data-job-wo-cv-form]');
    if (!form || !box) return;
    var values = { description: '', tasks: [], trade_allocation_ex: '', customer_price_ex: '' };
    var fields = box.querySelectorAll('[data-cv-f]');
    for (var i = 0; i < fields.length; i++) values[fields[i].getAttribute('data-cv-f')] = fields[i].value;
    var rows = box.querySelectorAll('[data-cv-task]');
    for (var r = 0; r < rows.length; r++) {
      var task = { description: '', hours: '', qty: '', unit: '' };
      var cells = rows[r].querySelectorAll('[data-cv-tf]');
      for (var c = 0; c < cells.length; c++) task[cells[c].getAttribute('data-cv-tf')] = cells[c].value;
      values.tasks.push(task);
    }
    form.values = values;
  }

  function cvAdd() {
    var C = core();
    if (!C || _state.cv.busy || _state.cv.form) return;
    _state.cv.form = { mode: 'create', id: null, updatedAt: null, values: C.customerVariationFormValues(null), errors: [] };
    _state.cv.confirm = null;
    _state.cv.message = '';
    repaint();
  }

  function cvEdit(id) {
    var C = core();
    var v = findVariation(id);
    if (!C || !v || v.status !== 'draft' || _state.cv.busy || _state.cv.form) return;
    _state.cv.form = { mode: 'edit', id: v.id, updatedAt: v.updated_at, values: C.customerVariationFormValues(v), errors: [] };
    _state.cv.confirm = null;
    _state.cv.message = '';
    repaint();
  }

  function cvAddTask() {
    if (!_state.cv.form) return;
    syncForm();
    _state.cv.form.values.tasks.push({ description: '', hours: '', qty: '', unit: '' });
    render();
  }

  function cvRemoveTask(i) {
    if (!_state.cv.form) return;
    syncForm();
    var tasks = _state.cv.form.values.tasks;
    tasks.splice(Number(i), 1);
    if (!tasks.length) tasks.push({ description: '', hours: '', qty: '', unit: '' });
    render();
  }

  function cvCloseForm() {
    if (_state.cv.busy) return;
    _state.cv.form = null;
    repaint();
  }

  // A refused variation write: in words, and read again when the variation
  // moved on (or the work order did) so nobody acts on an old copy.
  function cvRefused(e, seq) {
    var C = core();
    if (seq !== _state.seq) return;
    var code = (e && e.code) || '';
    var words = C.customerVariationRefusalWords(code, e && e.message);
    if (C.customerVariationNeedsReread(code)) {
      _state.cv.form = null;
      _state.cv.confirm = null;
      rereadJob(words, 'warn', 'cv');
      return;
    }
    _state.cv.busy = false;
    if (_state.cv.form) {
      _state.cv.form.errors = [words];
    } else {
      _state.cv.message = words;
      _state.cv.level = 'error';
    }
    repaint();
  }

  function cvSave() {
    var C = core();
    var form = _state.cv.form;
    if (!C || !form || _state.cv.busy) return;
    syncForm();
    var checked = C.customerVariationFields(form.values);
    if (checked.errors.length) {
      form.errors = checked.errors;
      repaint();
      return;
    }
    var seq = _state.seq;
    var body;
    var action;
    if (form.mode === 'edit') {
      action = 'update_customer_variation';
      body = Object.assign({ variation_id: form.id, expected_updated_at: form.updatedAt }, checked.fields);
    } else {
      action = 'create_customer_variation';
      body = Object.assign({ job_id: _state.jobId }, checked.fields);
    }
    form.errors = [];
    _state.cv.busy = true;
    repaint();
    opsPost(action, body).then(function () {
      if (seq !== _state.seq) return;
      _state.cv.form = null;
      rereadJob(form.mode === 'edit' ? 'Variation saved.' : 'Variation saved as a draft. Shaun approves it to join the work order.', 'ok', 'cv');
    }).catch(function (e) { cvRefused(e, seq); });
  }

  function cvApprove(id) {
    var C = core();
    var v = findVariation(id);
    if (!C || !v || !C.canApproveCustomerVariation(v, viewerEmail()) || _state.cv.busy) return;
    if (C.customerVariationApproveHold(v, shownWorkOrder(currentData()))) return;
    _state.cv.confirm = { kind: 'approve', id: v.id };
    _state.cv.message = '';
    repaint();
  }

  function cvCancel(id) {
    var v = findVariation(id);
    if (!v || v.status !== 'draft' || _state.cv.busy) return;
    _state.cv.confirm = { kind: 'cancel', id: v.id };
    _state.cv.message = '';
    repaint();
  }

  function cvConfirmBack() {
    if (_state.cv.busy) return;
    _state.cv.confirm = null;
    repaint();
  }

  // The confirmed approve or cancel, carrying the updated_at of the variation
  // on screen, so the seal covers exactly what was read.
  function cvConfirmed() {
    var C = core();
    var confirm = _state.cv.confirm;
    var v = confirm && findVariation(confirm.id);
    if (!C || !v || _state.cv.busy) return;
    var seq = _state.seq;
    var action;
    var body = { variation_id: v.id, expected_updated_at: v.updated_at };
    if (confirm.kind === 'approve') {
      if (!C.canApproveCustomerVariation(v, viewerEmail())) return;
      action = 'approve_customer_variation';
    } else {
      action = 'cancel_customer_variation';
      syncForm();
      var reason = String(confirm.reason || '').trim();
      if (reason) body.reason = reason;
    }
    _state.cv.busy = true;
    repaint();
    opsPost(action, body).then(function (res) {
      if (seq !== _state.seq) return;
      _state.cv.confirm = null;
      var saved = res && res.customer_variation;
      var words = confirm.kind === 'approve'
        ? ((saved && saved.label) || 'Variation approved') + '. It is on the work order as an addendum.'
        : 'Variation cancelled. It never joins the work order.';
      rereadJob(words, 'ok', 'cv');
      if (confirm.kind === 'approve' && typeof showToast === 'function') showToast('Variation approved and added to the work order', 'success');
    }).catch(function (e) { cvRefused(e, seq); });
  }

  // The customer's invoice line for an approved variation, shown as a preview.
  // prepare_customer_variation_invoice_line builds it from the record and
  // writes nothing to Xero; no Xero draft is ever made from this screen.
  function cvInvoiceLine(id) {
    var v = findVariation(id);
    if (!v || v.status !== 'approved' || _state.cv.busy || _state.cv.previewBusyId) return;
    var seq = _state.seq;
    _state.cv.previewBusyId = v.id;
    _state.cv.message = '';
    repaint();
    opsPost('prepare_customer_variation_invoice_line', { variation_id: v.id }).then(function (res) {
      if (seq !== _state.seq) return;
      _state.cv.previewBusyId = null;
      _state.cv.previews[v.id] = res || null;
      repaint();
    }).catch(function (e) {
      if (seq !== _state.seq) return;
      var C = core();
      _state.cv.previewBusyId = null;
      _state.cv.message = C.customerVariationRefusalWords((e && e.code) || '', e && e.message);
      _state.cv.level = 'error';
      repaint();
    });
  }

  // ── A stuck Xero draft record ──
  // The approver checked Xero by hand and says what is there. The answer
  // carries the record's updated_at as it was read when the dialog opened.
  function stuckInvoiceOf(v) {
    var p = _state.cv.previews[v.id];
    return (p && p.invoice) || v.invoice || null;
  }

  function cvXeroOpen(id) {
    var C = core();
    var v = findVariation(id);
    if (!C || !v || v.status !== 'approved' || _state.cv.busy || _state.cv.form || _state.cv.xero) return;
    var inv = stuckInvoiceOf(v);
    if (!C.canReconcileXeroDraft(inv, viewerEmail(), Date.now())) return;
    syncForm();
    _state.cv.confirm = null;
    _state.cv.message = '';
    _state.cv.xero = { id: v.id, updatedAt: inv.updated_at, outcome: '', invoiceId: '', invoiceNumber: '', checked: false, errors: [] };
    render();
    focusIn('[data-job-wo-cv-xero-dialog] [data-cv-xero-f="outcome"]');
  }

  // A choice in the dialog changed: show the fields that go with it.
  function cvXeroChanged(el) {
    if (!_state.cv.xero) return;
    var key = el && el.getAttribute('data-cv-xero-f');
    var value = el && el.value;
    syncForm();
    render();
    if (key === 'outcome') focusIn('[data-job-wo-cv-xero-dialog] [data-cv-xero-f="outcome"][value="' + value + '"]');
    else if (key) focusIn('[data-job-wo-cv-xero-dialog] [data-cv-xero-f="' + key + '"]');
  }

  function cvXeroClose() {
    if (_state.cv.busy || !_state.cv.xero) return;
    var id = _state.cv.xero.id;
    _state.cv.xero = null;
    repaint();
    focusIn('[data-job-wo-cv-xero-open][data-cv-id="' + id + '"]');
  }

  function cvXeroSubmit() {
    var C = core();
    var dialog = _state.cv.xero;
    var v = dialog && findVariation(dialog.id);
    if (!C || !dialog || !v || _state.cv.busy) return;
    syncForm();
    var checked = C.xeroReconcileFields(dialog);
    if (checked.errors.length) {
      dialog.errors = checked.errors;
      render();
      return;
    }
    var seq = _state.seq;
    var body = Object.assign({ variation_id: v.id, expected_updated_at: dialog.updatedAt }, checked.fields);
    dialog.errors = [];
    _state.cv.busy = true;
    render();
    opsPost('reconcile_customer_variation_xero_draft', body).then(function (res) {
      if (seq !== _state.seq) return;
      _state.cv.xero = null;
      rereadJob(C.xeroReconcileDoneWords(body.outcome, res), 'ok', 'cv');
      if (typeof showToast === 'function') showToast(body.outcome === 'draft_exists' ? 'Xero draft recorded' : 'Line released to be made again', 'success');
    }).catch(function (e) {
      if (seq !== _state.seq) return;
      var code = (e && e.code) || '';
      var words = C.xeroReconcileRefusalWords(code, e && e.message);
      if (C.xeroReconcileNeedsReread(code)) {
        _state.cv.xero = null;
        rereadJob(words, 'warn', 'cv');
        return;
      }
      _state.cv.busy = false;
      if (_state.cv.xero) _state.cv.xero.errors = [words];
      render();
    });
  }

  function focusIn(selector) {
    var el = document.getElementById(MOUNT_ID);
    var target = el && el.querySelector(selector);
    if (target && typeof target.focus === 'function') target.focus();
  }

  function openPdf() {
    var data = currentData();
    if (data && typeof generateRichWorkOrder === 'function') generateRichWorkOrder(data);
  }

  // The office printout: the stored work order's sections when there is one,
  // else null and the printout keeps its old content. A trade role gets null.
  function pdfSections(data) {
    var C = core();
    if (!officeOn() || !C || !data || !data.job_work_order || !data.job_work_order.work_order) return null;
    var block = data.job_work_order;
    var wo = shownWorkOrder(data);
    var fresher = {};
    if (wo && wo !== block.work_order) fresher.work_order = wo;
    // The job_work_order read for this job_detail read, once landed, carries
    // the newest addenda (approved customer variations) and figures.
    var detail = _state.data === data ? _state.detail : null;
    if (detail && Array.isArray(detail.addenda)) fresher.addenda = detail.addenda;
    if (detail && detail.figures && detail.figures.agreed_ex !== undefined) fresher.figures = detail.figures;
    if (Object.keys(fresher).length) block = Object.assign({}, block, fresher);
    return C.pdfSections(block);
  }

  var _cssDone = false;
  function injectCss() {
    if (_cssDone) return;
    _cssDone = true;
    var css = '' +
      '.jwo{border:1px solid var(--sw-border);background:var(--sw-card);padding:12px 14px;margin-bottom:16px;}' +
      '.jwo-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      '.jwo-title{font-size:14px;font-weight:700;color:var(--sw-dark);}' +
      '.jwo-chip{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;padding:2px 8px;border-radius:10px;background:var(--sw-light);color:var(--sw-text-sec);}' +
      '.jwo-chip-approved{background:#10B98120;color:#047857;}' +
      '.jwo-chip-draft,.jwo-chip-held,.jwo-chip-queried{background:#F59E0B20;color:#B45309;}' +
      '.jwo-chip-issued{background:#3B82F620;color:#1D4ED8;}' +
      '.jwo-chip-blank,.jwo-chip-none{background:var(--sw-light);color:var(--sw-text-sec);}' +
      '.jwo-chip-unreadable,.jwo-chip-rejected{background:#EF444420;color:#B91C1C;}' +
      '.jwo-ov{margin-bottom:12px;}' +
      '.jwo-overrun{margin-top:8px;padding:8px 10px;background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;font-size:13px;font-weight:700;}' +
      '.jwo-preview{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;padding:2px 6px;border:1px dashed var(--sw-mid);color:var(--sw-mid);}' +
      '.jwo-actions{margin-left:auto;display:flex;gap:6px;}' +
      '.jwo-sub{font-size:12px;color:var(--sw-text-sec);margin:6px 0 4px;}' +
      '.jwo-empty{font-size:12px;color:var(--sw-text-sec);padding:8px 0;}' +
      '.jwo-msg{font-size:12px;font-weight:600;padding:6px 8px;margin-top:8px;}' +
      '.jwo-msg-ok{background:#10B98115;color:#047857;}' +
      '.jwo-msg-warn{background:#F59E0B15;color:#B45309;}' +
      '.jwo-msg-error{background:#EF444415;color:#B91C1C;}' +
      '.jwo-confirm{border:1px solid var(--sw-orange);padding:8px 10px;margin:8px 0;font-size:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}' +
      '.jwo-confirm-actions{display:flex;gap:6px;margin-left:auto;}' +
      '.jwo-k{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--sw-mid);margin:12px 0 4px;}' +
      '.jwo-k-sub{font-weight:400;text-transform:none;letter-spacing:0;margin-left:6px;color:var(--sw-text-sec);}' +
      '.jwo-table{width:100%;border-collapse:collapse;font-size:12px;}' +
      '.jwo-table th{text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--sw-text-sec);padding:5px 6px;border-bottom:1px solid var(--sw-border);}' +
      '.jwo-table td{padding:5px 6px;border-bottom:1px solid var(--sw-border);vertical-align:top;}' +
      '.jwo-table tfoot td{font-weight:700;border-bottom:none;}' +
      '.jwo-table .r{text-align:right;white-space:nowrap;}' +
      '.jwo-line-note{font-size:11px;color:var(--sw-text-sec);}' +
      '.jwo-warn{font-size:10px;font-weight:700;color:#B45309;}' +
      '.jwo-addendum{border-left:3px solid var(--sw-orange);padding-left:10px;margin-top:8px;}' +
      '.jwo-add-desc{font-size:12px;white-space:pre-wrap;margin-bottom:4px;}' +
      '.jwo-add-money{font-size:12px;font-weight:600;color:var(--sw-dark);margin-top:4px;}' +
      '.jwo-cv{margin-top:14px;}' +
      '.jwo-cv-row{border:1px solid var(--sw-border);padding:8px 10px;margin:6px 0;font-size:12px;}' +
      '.jwo-cv-cancelled{opacity:0.6;}' +
      '.jwo-cv-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}' +
      '.jwo-cv-desc{font-weight:600;color:var(--sw-dark);white-space:pre-wrap;}' +
      '.jwo-cv-tasks{margin:6px 0 4px 18px;padding:0;}' +
      '.jwo-cv-money{font-size:12px;color:var(--sw-text-sec);}' +
      '.jwo-cv-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}' +
      '.jwo-cv-inv{margin-top:8px;}' +
      '.jwo-cv-form{border:1px solid var(--sw-border);background:var(--sw-light);padding:10px;margin:8px 0;display:flex;flex-direction:column;gap:8px;}' +
      '.jwo-cv-label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:var(--sw-text-sec);}' +
      '.jwo-cv-form .form-input{width:100%;box-sizing:border-box;}' +
      '.jwo-cv-form > .btn{align-self:flex-start;}' +
      '.jwo-cv-task-table{min-width:0;}' +
      '.jwo-cv-num{max-width:90px;}' +
      '.jwo-cv-unit{max-width:70px;}' +
      '.jwo-cv-amounts{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;}' +
      '.jwo-cv-task-table td{padding:3px 4px;}' +
      '.jwo-confirm .form-input{flex:1 1 200px;}' +
      '.jwo-instr{font-size:12px;white-space:pre-wrap;}' +
      '.jwo-xd-stuck{border:1px solid #EF444460;background:#EF444408;padding:8px 10px;margin:6px 0 8px;font-size:12px;display:flex;flex-direction:column;gap:6px;}' +
      '.jwo-xd-stuck[data-cv-answerable="0"]{border-color:#F59E0B60;background:#F59E0B08;}' +
      '.jwo-xd-head{display:flex;gap:8px;align-items:center;}' +
      '.jwo-xd-backdrop{position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:10050;padding:16px;}' +
      '.jwo-xd{background:var(--sw-card,#fff);color:var(--sw-text);width:100%;max-width:460px;max-height:calc(100vh - 32px);overflow:auto;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,0.25);display:flex;flex-direction:column;gap:10px;font-size:13px;}' +
      '.jwo-xd-title{font-size:15px;font-weight:700;color:var(--sw-dark);}' +
      '.jwo-xd-choice{display:flex;gap:8px;align-items:flex-start;cursor:pointer;}' +
      '.jwo-xd-choice input{margin-top:3px;}' +
      '.jwo-xd-fields{margin-left:24px;display:flex;flex-direction:column;gap:8px;}' +
      '.jwo-xd-fields .form-input{width:100%;box-sizing:border-box;}' +
      '.jwo-xd-check{border-top:1px solid var(--sw-border);padding-top:10px;}' +
      '.jwo-figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:12px;}' +
      '.jwo-fig{background:var(--sw-light);padding:8px 10px;}' +
      '.jwo-fig-k{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--sw-text-sec);}' +
      '.jwo-fig-v{font-size:15px;font-weight:700;color:var(--sw-dark);font-family:var(--sw-font-num);}' +
      '.jwo-fig-over .jwo-fig-v{color:#B91C1C;}' +
      '.jwo-rule{font-size:12px;margin-top:6px;}' +
      '.jwo-rule-flag{color:#B91C1C;font-weight:700;}' +
      '.jwo-rule-warn{color:#B45309;}' +
      '.jwo-rule-info{color:var(--sw-text-sec);}' +
      '.jwo-rv{padding:6px 0;border-bottom:1px solid var(--sw-border);font-size:12px;}' +
      '.jwo-rv-desc{white-space:pre-wrap;}' +
      '.jwo .btn:disabled{opacity:0.45;cursor:not-allowed;}' +
      '@media (max-width:600px){.jwo-actions{margin-left:0;width:100%;}' +
      '.jwo-cv-task-table thead{display:none;}' +
      '.jwo-cv-task-table tr{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;padding:6px 0;border-bottom:1px solid var(--sw-border);}' +
      '.jwo-cv-task-table td{display:block;border-bottom:none;padding:0;}' +
      '.jwo-cv-task-table td:first-child{grid-column:1/-1;}' +
      '.jwo-cv-num,.jwo-cv-unit{max-width:none;}}';
    var tag = document.createElement('style');
    tag.setAttribute('data-job-wo-css', '');
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  return {
    officeOn: officeOn,
    viewerIsOffice: viewerIsOffice,
    buildTabHtml: buildTabHtml,
    paintOverview: paintOverview,
    approve: approve,
    approveConfirmed: approveConfirmed,
    cancelApprove: cancelApprove,
    openDraft: openDraft,
    createRoute: createRoute,
    openForJob: openForJob,
    openPdf: openPdf,
    pdfSections: pdfSections,
    cvAdd: cvAdd,
    cvEdit: cvEdit,
    cvAddTask: cvAddTask,
    cvRemoveTask: cvRemoveTask,
    cvCloseForm: cvCloseForm,
    cvSave: cvSave,
    cvApprove: cvApprove,
    cvCancel: cvCancel,
    cvConfirmBack: cvConfirmBack,
    cvConfirmed: cvConfirmed,
    cvInvoiceLine: cvInvoiceLine,
    cvXeroOpen: cvXeroOpen,
    cvXeroChanged: cvXeroChanged,
    cvXeroClose: cvXeroClose,
    cvXeroSubmit: cvXeroSubmit
  };
})();
window.JobWorkOrderOps = JobWorkOrderOps;
