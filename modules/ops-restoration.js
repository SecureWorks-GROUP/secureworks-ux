// Restoration panel on a make-safe job page (secureworks-backend
// docs/restoration-workflow-v1.md). A restoration job is a make-safe board
// card that runs one of two ways: do and charge, or assess and quote. This
// panel says which, where the job is at, what happens next, and shows the
// quote and the builder's answer.
//
// Read only. It calls ops-api restoration_plan once per job open and writes
// nothing. Office only: the quote carries prices, and a trade sees no money.
// It paints nothing for a job that is not restoration, and nothing while the
// back end does not know the action yet. Any other failed read says so in
// words: a failed read never renders as "no quote".
(function (root) {
  'use strict';

  // <ops-restoration-core>
  var Core = {};

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function token(value) {
    return text(value).toLowerCase().replace(/[\s-]+/g, '_');
  }

  // The same two fields the back end's canonical family reader uses. The old
  // storage shape (insurance_job_type) outranks the family field, as it does there.
  Core.isRestorationJob = function (job) {
    if (!job) return false;
    var type = token(job.type);
    if (type !== 'makesafe' && type !== 'insurance') return false;
    var md = job.metadata || {};
    var insurance = token(md.insurance_job_type);
    if (insurance === 'restoration' || insurance === 'restoration_work') return true;
    var family = token(md.makesafe_job_family);
    return family === 'restoration' || family === 'restoration_work' || family === 'insurance_restoration';
  };

  Core.money = function (amount) {
    var n = Number(amount);
    if (amount === null || amount === undefined || amount === '' || !isFinite(n)) return '';
    var fixed = Math.abs(n).toFixed(2).split('.');
    return (n < 0 ? '-' : '') + '$' + fixed[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fixed[1];
  };

  // "2026-11-13T02:00:00.000Z" -> "13 Nov 2026". The date as recorded; no clock arithmetic.
  Core.day = function (iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Number(m[3]) + ' ' + (months[Number(m[2]) - 1] || '') + ' ' + m[1];
  };

  var MODE_LABELS = { do_and_charge: 'Do and charge', assess_and_quote: 'Assess and quote' };
  var STATUS_WORDS = { draft: 'Draft, not sent', sent: 'With the builder', approved: 'Approved', declined: 'Declined' };

  Core.modeLabel = function (mode) {
    return MODE_LABELS[mode] || '';
  };

  // One line about the current quote: number, amount, and where it stands.
  Core.quoteLine = function (quote) {
    if (!quote) return '';
    var parts = [text(quote.quote_number) || ('Revision ' + quote.revision)];
    var amount = Core.money(quote.subtotal_ex_gst);
    if (amount) parts.push(amount + ' ex GST');
    var status = STATUS_WORDS[quote.status] || '';
    var decision = quote.decision || null;
    if (decision && (quote.status === 'approved' || quote.status === 'declined')) {
      status += ' by ' + (text(decision.decided_by) || 'the builder');
      var when = Core.day(decision.decided_at);
      if (when) status += ' on ' + when;
    } else if (quote.status === 'sent' && quote.sent) {
      var sentOn = Core.day(quote.sent.at);
      if (text(quote.sent.to)) status += ' (' + text(quote.sent.to) + ')';
      if (sentOn) status += ', sent ' + sentOn;
    }
    if (status) parts.push(status);
    return parts.join(' · ');
  };

  // What the panel says about invoicing. Empty until a quote is approved.
  Core.invoiceLine = function (handoff) {
    if (!handoff) return '';
    if (handoff.ready) {
      return 'Ready to invoice the approved quote: ' + Core.money(handoff.total_ex_gst) + ' ex GST.';
    }
    return text(handoff.reason);
  };

  // True when the answer is the back end saying it has no such action yet
  // (this page can be live before the back end is): paint nothing.
  Core.isUnknownAction = function (err) {
    var message = text(err && err.message) || text(err && err.body && err.body.error);
    return /^Unknown action/i.test(message);
  };

  Core.cardHtml = function (res, esc) {
    esc = esc || function (v) { return String(v == null ? '' : v); };
    var plan = res && res.restoration;
    if (!plan || !plan.mode) return '';
    var html = '<div data-restoration-card style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);border-left:4px solid #0D9488;">';
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">';
    html += '<div style="font-size:11px;font-weight:850;color:var(--sw-mid);text-transform:uppercase;">Restoration</div>';
    html += '<span data-restoration-mode style="font-size:11px;font-weight:800;color:#0F766E;background:#CCFBF1;padding:2px 8px;border-radius:999px;">' + esc(Core.modeLabel(plan.mode)) + '</span>';
    if (plan.phase_label && plan.phase !== 'attend_and_charge' && plan.phase !== 'assess') {
      html += '<span data-restoration-phase style="font-size:11px;font-weight:800;color:var(--sw-dark);background:#E5E7EB;padding:2px 8px;border-radius:999px;">' + esc(plan.phase_label) + '</span>';
    }
    html += '</div>';
    if (plan.next_step) {
      html += '<div data-restoration-next style="font-size:13px;color:var(--sw-text);margin-bottom:6px;">' + esc(plan.next_step) + '</div>';
    }
    var limit = res.authority_limit;
    if (limit && limit.status !== 'no_limit' && limit.note) {
      var over = limit.status === 'over_limit';
      html += '<div data-restoration-limit style="font-size:12px;margin-bottom:6px;color:' + (over ? '#B45309' : 'var(--sw-mid)') + ';' + (over ? 'font-weight:700;' : '') + '">' + esc(limit.note) + '</div>';
    }
    var quote = plan.quote;
    if (quote) {
      html += '<div data-restoration-quote style="font-size:13px;color:var(--sw-dark);font-weight:700;margin-top:8px;">' + esc(Core.quoteLine(quote)) + '</div>';
      var decision = quote.decision;
      if (decision && text(decision.evidence_ref)) {
        html += '<div style="font-size:12px;color:var(--sw-mid);margin-top:2px;">Recorded from: ' + esc(decision.evidence_ref) + '</div>';
      }
      if (/^https:\/\//.test(text(quote.pdf_url))) {
        html += '<div style="margin-top:8px;"><a data-restoration-pdf href="' + esc(quote.pdf_url) + '" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="text-decoration:none;font-size:12px;">Open quote PDF</a></div>';
      }
      if (plan.approved_quote_number && plan.approved_quote_number !== quote.quote_number) {
        html += '<div style="font-size:12px;color:var(--sw-mid);margin-top:6px;">' + esc(plan.approved_quote_number) + ' is the approved quote in force (' + esc(Core.money(plan.approved_total_ex_gst)) + ' ex GST).</div>';
      }
    }
    var invoice = Core.invoiceLine(res.invoice_handoff);
    if (invoice) {
      html += '<div data-restoration-invoice style="font-size:12px;color:var(--sw-mid);margin-top:8px;">' + esc(invoice) + '</div>';
    }
    html += '</div>';
    return html;
  };

  Core.failedHtml = function (message, esc) {
    esc = esc || function (v) { return String(v == null ? '' : v); };
    return '<div data-restoration-card data-restoration-failed style="background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;padding:10px 12px;margin-bottom:12px;font-size:12px;">' +
      '<strong>Restoration plan not shown.</strong> ' + esc(text(message) || 'It could not be read. Refresh to try again.') + '</div>';
  };
  // </ops-restoration-core>

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Core;
    return;
  }

  var TRADE_ROLES = { installer: 1, lead_installer: 1, crew: 1, trade: 1, subcontractor: 1 };
  var shownJobId = '';

  function role() {
    try {
      var cloud = root.SECUREWORKS_CLOUD;
      if (cloud && cloud.auth && typeof cloud.auth.getRole === 'function') return String(cloud.auth.getRole() || '').toLowerCase();
    } catch (e) { /* an unknown role stays office */ }
    return '';
  }

  function host() {
    return document.querySelector('#jdOverview [data-restoration-plan]');
  }

  function currentJob(jobId) {
    return shownJobId === String(jobId) &&
      (typeof _currentJobId === 'undefined' || String(_currentJobId) === String(jobId));
  }

  function esc(value) {
    return typeof escapeHtml === 'function'
      ? escapeHtml(value)
      : String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  }

  function paint(data) {
    var el = host();
    if (!el) return;
    el.innerHTML = '';
    var job = data && data.job;
    if (!job || TRADE_ROLES[role()] || !Core.isRestorationJob(job) || typeof opsFetch !== 'function') return;
    var jobId = String(job.id);
    shownJobId = jobId;
    opsFetch('restoration_plan', { job_id: jobId }).then(function (res) {
      var box = host();
      if (!box || !currentJob(jobId)) return;
      box.innerHTML = Core.cardHtml(res, esc);
    }).catch(function (err) {
      var box = host();
      if (!box || !currentJob(jobId)) return;
      box.innerHTML = Core.isUnknownAction(err) ? '' : Core.failedHtml(err && err.message, esc);
    });
  }

  root.RestorationOpsCore = Core;
  root.RestorationOps = { paint: paint };
})(typeof window !== 'undefined' ? window : globalThis);
