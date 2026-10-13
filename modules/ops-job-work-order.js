// ════════════════════════════════════════════════════════════
// JOB WORK ORDER on the Ops job page (Build tab) and in the office Work Order
// PDF. Screen doc: docs/job-work-order-screens.md. Lines, status, refusal
// words and the HTML come from shared/job-work-order.js (JobWorkOrderCore).
//
// Preview: off unless ?wo=preview or localStorage sw_wo_preview = '1'
// (?wo=live turns it off). With it off, the Build tab and the Work Order PDF
// are exactly as before.
//
// Reads:  job_detail.job_work_order (already loaded by openJobDetail) and
//         ops-api job_work_order (the billed lines and trade-reported
//         variations), read again for every job_detail read (job open or
//         refresh), so the panel never shows an older copy than job_detail.
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
//
// Create work order: while the preview is on, a fencing or patio job's
// "Create work order" (job quick view, calendar, the old office form) comes
// here (openForJob) instead of the old form, so the job work order is the one
// way to make a work order for those jobs. Other job types keep the old form.
// ════════════════════════════════════════════════════════════

var JobWorkOrderOps = (function () {
  'use strict';

  var STORE_KEY = 'sw_wo_preview';
  var MOUNT_ID = 'jdJobWorkOrder';
  var _preview = null;
  // One state per job_detail read: the job_work_order read and the approve button.
  var _state = { data: null, jobId: null, detail: null, detailState: 'idle', busy: false, confirming: false, message: '', level: 'info', seq: 0, cv: freshCv() };

  // The customer variations section: the open form, the confirm row, the
  // invoice line previews, and its own message.
  function freshCv() {
    return { form: null, confirm: null, busy: false, previews: {}, previewBusyId: null, message: '', level: 'info' };
  }

  function core() { return window.JobWorkOrderCore || null; }

  function previewOn() {
    if (_preview !== null) return _preview;
    var C = core();
    if (!C) { _preview = false; return false; }
    var stored = null;
    try { stored = localStorage.getItem(STORE_KEY); } catch (e) { stored = null; }
    var st = C.previewState(location.search, stored);
    if (st.persist) {
      try {
        if (st.persist === '1') localStorage.setItem(STORE_KEY, '1');
        else localStorage.removeItem(STORE_KEY);
      } catch (e) { /* private window: the URL still decides this load */ }
    }
    _preview = st.on;
    return _preview;
  }

  function viewerEmail() {
    return (typeof _opsUserEmail !== 'undefined' && _opsUserEmail) || '';
  }

  function currentData() {
    return (typeof _currentJobData !== 'undefined' && _currentJobData) || null;
  }

  function resetFor(data) {
    if (_state.data === data) return;
    _state = { data: data, jobId: data.job.id, detail: null, detailState: 'idle', busy: false, confirming: false, message: '', level: 'info', seq: _state.seq + 1, cv: freshCv() };
  }

  function panelHtml(data) {
    var C = core();
    var block = data && data.job_work_order;
    if (!C || !block) return '';
    var h = C.renderOpsPanel(block, _state.detail, _state.detailState, {
      viewerEmail: viewerEmail(),
      busy: _state.busy,
      message: _state.message,
      messageLevel: _state.level,
      preview: true,
      canOpen: true,
      cv: _state.cv
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
    if (!previewOn() || !data || !data.job || !data.job_work_order) return '';
    injectCss();
    resetFor(data);
    if (_state.detailState === 'idle' && data.job_work_order.work_order) loadDetail(data.job.id);
    return '<div id="' + MOUNT_ID + '">' + panelHtml(data) + '</div>';
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
    var el = document.getElementById(MOUNT_ID);
    if (!el || !data || data !== _state.data) return;
    el.innerHTML = panelHtml(data);
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
    if (!block || block.unreadable || block.work_order) return;
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

  // 'job' when this job type's "Create work order" goes to the job work order,
  // else 'crew' (the old office form).
  function createRoute(type) {
    var C = core();
    return C ? C.createRoute(type, previewOn()) : 'crew';
  }

  // The job page, on the Build tab, where the job work order is.
  function openForJob(jobId) {
    if (!jobId || typeof openJobDetail !== 'function') return Promise.resolve();
    return Promise.resolve(openJobDetail(jobId)).then(function () {
      var data = currentData();
      var current = (typeof _currentJobId !== 'undefined') ? _currentJobId : null;
      if (data && String(current) === String(jobId) && typeof showJobSubView === 'function') showJobSubView('build');
    });
  }

  // From the old office form's notice: close the form, open the job page.
  function openFromForm(jobId) {
    if (typeof closeModal === 'function') closeModal('woModal');
    return openForJob(jobId);
  }

  // The old office form's notice for a fencing or patio job.
  function formNoticeHtml(job) {
    var C = core();
    if (!C) return '';
    injectCss();
    return C.crewFormNoticeHtml(job);
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
      var el = document.getElementById(MOUNT_ID);
      var input = el && el.querySelector('[data-job-wo-cv-cancel-reason]');
      var reason = input ? String(input.value || '').trim() : '';
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
      _state.cv.previewBusyId = null;
      cvRefused(e, seq);
    });
  }

  function openPdf() {
    var data = currentData();
    if (data && typeof generateRichWorkOrder === 'function') generateRichWorkOrder(data);
  }

  // The office printout: the stored work order's sections when there is one
  // (preview only), else null and the printout keeps its old content.
  function pdfSections(data) {
    var C = core();
    if (!previewOn() || !C || !data || !data.job_work_order || !data.job_work_order.work_order) return null;
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
      '.jwo-chip-draft{background:#F59E0B20;color:#B45309;}' +
      '.jwo-chip-unreadable{background:#EF444420;color:#B91C1C;}' +
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
      '.jwo .btn:disabled,#woSubmitBtn:disabled{opacity:0.45;cursor:not-allowed;}' +
      '.jwo-redirect{border:1px solid var(--sw-border);background:var(--sw-light);padding:10px 12px;font-size:13px;color:var(--sw-text);display:flex;flex-direction:column;gap:8px;align-items:flex-start;}' +
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
    previewOn: previewOn,
    buildTabHtml: buildTabHtml,
    approve: approve,
    approveConfirmed: approveConfirmed,
    cancelApprove: cancelApprove,
    openDraft: openDraft,
    createRoute: createRoute,
    openForJob: openForJob,
    openFromForm: openFromForm,
    formNoticeHtml: formNoticeHtml,
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
    cvInvoiceLine: cvInvoiceLine
  };
})();
window.JobWorkOrderOps = JobWorkOrderOps;
