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
// ════════════════════════════════════════════════════════════

var JobWorkOrderOps = (function () {
  'use strict';

  var STORE_KEY = 'sw_wo_preview';
  var MOUNT_ID = 'jdJobWorkOrder';
  var _preview = null;
  // One state per job_detail read: the job_work_order read and the approve button.
  var _state = { data: null, jobId: null, detail: null, detailState: 'idle', busy: false, confirming: false, message: '', level: 'info', seq: 0 };

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
    _state = { data: data, jobId: data.job.id, detail: null, detailState: 'idle', busy: false, confirming: false, message: '', level: 'info', seq: _state.seq + 1 };
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
      preview: true
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

  function repaint() {
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
  function rereadJob(message, level) {
    var jobId = _state.jobId;
    var done = function () {
      if (_state.jobId !== jobId) return;
      _state.busy = false;
      _state.message = message;
      _state.level = level;
      repaint();
    };
    if (typeof refreshJobDetail === 'function') refreshJobDetail().then(done, done);
    else done();
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
    if (wo && wo !== block.work_order) block = Object.assign({}, block, { work_order: wo });
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
      '@media (max-width:600px){.jwo-actions{margin-left:0;width:100%;}}';
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
    openPdf: openPdf,
    pdfSections: pdfSections
  };
})();
window.JobWorkOrderOps = JobWorkOrderOps;
