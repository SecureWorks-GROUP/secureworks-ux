// ════════════════════════════════════════════════════════════
// MAKESAFE REPORTING COCKPIT - APPROVALS VIEW (right column)
// The INFORMED-APPROVE CONTENT GATE for make-safe report packs. Sibling to the
// intake cockpit (ops-makesafe-intake-cockpit.js): same approvals split-pane,
// its own tab. Renders into #msReportingListBody (left column) and
// #msReportingDetailPanel (right detail).
//
// MONEY/COMMS critical. The approve button here triggers a LIVE authorise + send
// (makesafe_send_pack authorises the Xero invoice and emails the builder), so the
// detail panel MUST show enough for an informed human decision BEFORE the click:
// the report photos, the invoice line items + totals, BOTH PDFs inline (report +
// draft invoice), and the exact builder recipient the pack will go to.
//
// Globals consumed (all defined in ops.html):
//   opsFetch, opsPost, showToast, escapeHtml, escapeAttr
// ════════════════════════════════════════════════════════════

var _msReportingCache = {};

// ────────────────────────────────────────────────────────────
// 1. LIST PANEL - load + render the reporting column
// ────────────────────────────────────────────────────────────

/**
 * Load report-draft-ready packs and render the cockpit column.
 * Returns the count of drafts (resolves to 0 on error).
 */
async function loadMakesafeReportingCockpit() {
  var body = document.getElementById('msReportingListBody');
  if (body) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--sw-text-sec);font-size:13px;">Loading report drafts...</div>';
  }
  try {
    var data = await opsFetch('makesafe_report_drafts', {});
    var drafts = (data && data.drafts) || [];
    _msReportingCache = {};
    drafts.forEach(function(d) { _msReportingCache[d.job_id] = d; });

    if (body) {
      if (drafts.length === 0) {
        body.innerHTML = '<div style="padding:40px 20px;text-align:center;">'
          + '<div style="font-size:36px;opacity:0.3;margin-bottom:12px;">&#128203;</div>'
          + '<div style="font-size:14px;font-weight:600;color:var(--sw-dark);">No report drafts to send</div>'
          + '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:6px;">Packs appear here once the reporting routine has drafted the invoice and rendered the report.</div>'
          + '</div>';
      } else {
        var html = '';
        drafts.forEach(function(d) { html += renderMsReportingCard(d); });
        body.innerHTML = html;
      }
    }

    refreshMsReportingBadge(drafts.length);
    return drafts.length;
  } catch (e) {
    if (body) {
      body.innerHTML = '<div style="padding:20px;text-align:center;color:#E74C3C;font-size:13px;">Failed to load report drafts: ' + escapeHtml(e.message || String(e)) + '</div>';
    }
    refreshMsReportingBadge(0);
    return 0;
  }
}

/**
 * Format a number as AUD currency for display.
 */
function _msFmtAud(n) {
  var v = Number(n);
  if (!isFinite(v)) v = 0;
  return '$' + v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Render a single report-draft card for the cockpit column.
 */
function renderMsReportingCard(d) {
  var builder = d.builder || d.requesting_company_name || '(no builder)';
  var ref = d.external_ref;
  var suburb = d.site_suburb;
  var incGst = d.invoice ? d.invoice.total_inc_gst : null;

  // The pack status badge: most packs are simply awaiting a tick; a resumable
  // partial-failure state (authorised_not_sent etc.) is flagged distinctly.
  var packStatus = d.pack_status ? (d.pack_status.status || '') : '';
  var needsResume = ['authorised_not_sent', 'sent_marker_failed', 'sent_not_closed', 'close_failed', 'failed'].indexOf(packStatus) >= 0;
  var statusBg = needsResume ? '#B45309' : '#0E7C7B';
  var statusLabel = needsResume ? 'NEEDS RESUME' : 'NEEDS YOUR TICK';

  var safeId = escapeAttr(d.job_id);
  var html = '<div onclick="showMsReportingDetail(\'' + safeId + '\')" style="background:#fff;border:1px solid var(--sw-border);border-radius:8px;padding:12px;margin:10px;cursor:pointer;box-shadow:0 1px 3px rgba(41,60,70,0.06);border-left:4px solid ' + statusBg + ';">';

  // Top row: status badge
  html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;">';
  html += '<span style="font-size:9px;font-weight:800;letter-spacing:0.04em;padding:2px 7px;border-radius:10px;background:' + statusBg + ';color:#fff;">' + statusLabel + '</span>';
  html += '</div>';

  // Builder name
  html += '<div style="font-size:14px;font-weight:700;color:var(--sw-dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(builder) + '</div>';

  // Detail lines
  if (ref) html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:3px;"><strong>Ref:</strong> ' + escapeHtml(ref) + '</div>';
  if (suburb) html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:2px;"><strong>Suburb:</strong> ' + escapeHtml(suburb) + '</div>';

  // Invoice amount (inc GST) - prominent
  html += '<div style="margin-top:8px;font-size:18px;font-weight:800;color:var(--sw-dark);">' + (incGst != null ? _msFmtAud(incGst) : 'No invoice') + '<span style="font-size:10px;font-weight:600;color:var(--sw-text-sec);margin-left:4px;">inc GST</span></div>';

  // No-recipient warning at a glance
  if (!d.recipient_email) {
    html += '<div style="font-size:11px;color:#B91C1C;background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:5px 8px;margin-top:8px;">No builder email on file. Cannot send.</div>';
  }

  // Review button
  html += '<div style="margin-top:10px;">';
  html += '<button onclick="event.stopPropagation();showMsReportingDetail(\'' + safeId + '\')" style="width:100%;background:#1F3A44;color:#fff;border:none;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Review pack</button>';
  html += '</div>';

  html += '</div>';
  return html;
}

// ────────────────────────────────────────────────────────────
// 2. DETAIL PANEL - the informed-approve content gate
// ────────────────────────────────────────────────────────────

/**
 * Render the full informed-approve content gate for a pack into
 * #msReportingDetailPanel. Everything needed to decide is visible here:
 * job header, evidence photos, invoice line items + totals, BOTH PDFs inline,
 * the recipient the pack goes to, and the approve button.
 */
function showMsReportingDetail(jobId) {
  var d = _msReportingCache[jobId];
  var panel = document.getElementById('msReportingDetailPanel');
  if (!panel) return;
  if (!d) {
    panel.innerHTML = '<div style="padding:20px;color:#E74C3C;font-size:13px;">Pack not loaded. <button onclick="loadMakesafeReportingCockpit()" style="margin-left:8px;">Reload</button></div>';
    return;
  }

  var safeId = escapeAttr(d.job_id);
  var builder = d.builder || d.requesting_company_name || '(no builder)';
  var inv = d.invoice || null;

  var html = '';

  // Header
  html += '<div style="flex-shrink:0;display:flex;align-items:flex-start;gap:12px;padding:14px 18px;background:#fff;border-bottom:1px solid var(--sw-border);">';
  html += '<button onclick="showMsReportingDetailEmpty()" style="background:none;border:none;color:var(--sw-orange);font-size:13px;font-weight:600;cursor:pointer;padding:4px 0;white-space:nowrap;">&#8592; Back</button>';
  html += '<div style="flex:1;min-width:0;">';
  html += '<div style="font-size:15px;font-weight:700;color:var(--sw-dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(builder) + (d.external_ref ? ' &middot; ' + escapeHtml(d.external_ref) : '') + '</div>';
  var headerBits = [];
  if (d.job_number) headerBits.push('Job ' + d.job_number);
  if (d.client_name) headerBits.push(d.client_name);
  if (d.site_address) headerBits.push(d.site_address);
  else if (d.site_suburb) headerBits.push(d.site_suburb);
  html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:2px;">' + escapeHtml(headerBits.join('  ·  ')) + '</div>';
  html += '</div></div>';

  // Scrollable body (single scroll column - everything visible without leaving the panel)
  html += '<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 18px;background:#F7FAFB;">';

  // Pack-status / resume banner (only when there is something to flag)
  if (d.pack_status && d.pack_status.status && d.pack_status.status !== 'drafted' && d.pack_status.status !== 'admin_to_send_report') {
    var ps = d.pack_status;
    html += '<div style="margin-bottom:14px;padding:10px 14px;border-radius:8px;border:1px solid #FDE68A;background:#FFFBEB;font-size:12px;color:#92400E;">';
    html += '<strong>Pack state:</strong> ' + escapeHtml(ps.status);
    if (ps.failed_step) html += ' (last step: ' + escapeHtml(ps.failed_step) + ')';
    if (ps.error_detail) html += '<div style="margin-top:4px;">' + escapeHtml(ps.error_detail) + '</div>';
    html += '<div style="margin-top:4px;">Approving again resumes safely: an authorised invoice is not re-authorised, a sent pack is not re-sent.</div>';
    html += '</div>';
  }

  // Recipient - who gets this pack
  html += '<div style="margin-bottom:16px;padding:12px 14px;border-radius:8px;border:1px solid ' + (d.recipient_email ? '#BBF7D0' : '#FECACA') + ';background:' + (d.recipient_email ? '#F0FDF4' : '#FEF2F2') + ';">';
  html += '<div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Pack will be emailed to</div>';
  if (d.recipient_email) {
    html += '<div style="font-size:14px;font-weight:700;color:var(--sw-dark);margin-top:4px;">' + escapeHtml(d.recipient_email) + '</div>';
  } else {
    html += '<div style="font-size:13px;font-weight:700;color:#B91C1C;margin-top:4px;">No builder email on file. The send cannot proceed until a recipient is set.</div>';
  }
  html += '</div>';

  // PHOTOS - the report evidence (inline thumbnails)
  html += '<div style="margin-bottom:8px;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Report evidence photos</div>';
  if (d.photos && d.photos.length) {
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:18px;">';
    d.photos.forEach(function(p) {
      var src = p.thumbnail_url || p.url;
      var full = p.url || p.thumbnail_url;
      html += '<a href="' + escapeAttr(full) + '" target="_blank" rel="noopener" style="display:block;text-decoration:none;">';
      html += '<img src="' + escapeAttr(src) + '" alt="' + escapeAttr(p.label || 'evidence') + '" style="width:100%;height:96px;object-fit:cover;border-radius:6px;border:1px solid var(--sw-border);background:#fff;">';
      if (p.label) html += '<div style="font-size:10px;color:var(--sw-text-sec);margin-top:2px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(p.label) + '</div>';
      html += '</a>';
    });
    html += '</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--sw-text-sec);background:#fff;border:1px dashed var(--sw-border);border-radius:8px;padding:12px;margin-bottom:18px;">No evidence photos attached to this pack.</div>';
  }

  // INVOICE LINE ITEMS + totals
  html += '<div style="margin-bottom:8px;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Invoice</div>';
  if (inv) {
    html += '<div style="background:#fff;border:1px solid var(--sw-border);border-radius:8px;overflow:hidden;margin-bottom:18px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-bottom:1px solid var(--sw-border);font-size:12px;color:var(--sw-text-sec);">';
    html += '<span>' + escapeHtml(inv.invoice_number || '(draft, no number yet)') + (inv.status ? ' &middot; ' + escapeHtml(inv.status) : '') + '</span>';
    html += '</div>';
    if (inv.lines && inv.lines.length) {
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      html += '<thead><tr style="background:#293C46;color:#fff;">'
        + '<th style="text-align:left;padding:7px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Description</th>'
        + '<th style="text-align:right;padding:7px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>'
        + '<th style="text-align:right;padding:7px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Unit</th>'
        + '<th style="text-align:right;padding:7px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Line total</th>'
        + '</tr></thead><tbody>';
      inv.lines.forEach(function(li) {
        html += '<tr style="border-bottom:1px solid #e5e7eb;">'
          + '<td style="padding:7px 12px;">' + escapeHtml(li.description || '') + '</td>'
          + '<td style="padding:7px 12px;text-align:right;">' + escapeHtml(String(li.quantity)) + '</td>'
          + '<td style="padding:7px 12px;text-align:right;">' + _msFmtAud(li.unit_price) + '</td>'
          + '<td style="padding:7px 12px;text-align:right;">' + _msFmtAud(li.line_total) + '</td>'
          + '</tr>';
      });
      html += '</tbody></table>';
    } else if (inv.lines_unavailable) {
      html += '<div style="padding:12px;font-size:12px;color:#92400E;background:#FFFBEB;">' + escapeHtml(inv.lines_note || 'Line detail in the invoice PDF below.') + '</div>';
    }
    // Totals
    html += '<div style="padding:10px 12px;border-top:2px solid #293C46;display:flex;flex-direction:column;gap:3px;">';
    html += '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--sw-text-sec);"><span>Total ex GST</span><span>' + _msFmtAud(inv.total_ex_gst) + '</span></div>';
    html += '<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;color:var(--sw-dark);"><span>Total inc GST</span><span>' + _msFmtAud(inv.total_inc_gst) + '</span></div>';
    html += '</div>';
    html += '</div>';
  } else {
    html += '<div style="font-size:12px;color:#B91C1C;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px;margin-bottom:18px;">No Xero invoice is linked to this job. The send will fail preflight until a draft invoice exists.</div>';
  }

  // BOTH PDFs inline - report + draft invoice
  html += '<div style="margin-bottom:8px;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Documents</div>';
  html += '<div style="display:flex;flex-direction:column;gap:14px;margin-bottom:18px;">';
  html += renderMsReportingPdf('Make safe report', d.report_pdf_url);
  html += renderMsReportingPdf('Draft invoice', d.invoice_pdf_url);
  html += '</div>';

  // APPROVE - the live authorise + send
  html += '<div style="border-top:1px solid #EEF2F5;padding-top:14px;display:flex;flex-direction:column;gap:8px;">';
  var canSend = !!d.recipient_email && !!inv;
  html += '<button id="msReportingApproveBtn" onclick="approveMakesafeReportPack(\'' + safeId + '\')"'
    + (canSend ? '' : ' disabled')
    + ' style="background:#27AE60;color:#fff;border:none;padding:12px 16px;border-radius:8px;font-size:14px;font-weight:800;cursor:' + (canSend ? 'pointer' : 'not-allowed') + ';opacity:' + (canSend ? '1' : '.45') + ';">Approve and send pack</button>';
  if (!canSend) {
    html += '<div style="font-size:12px;color:#B91C1C;">' + (!d.recipient_email ? 'A builder recipient email is required. ' : '') + (!inv ? 'A linked invoice is required.' : '') + '</div>';
  } else {
    html += '<div style="font-size:11px;color:var(--sw-text-sec);">This authorises the invoice in Xero and emails the pack to ' + escapeHtml(d.recipient_email) + '.</div>';
  }
  html += '<button onclick="showMsReportingDetailEmpty()" style="background:#E5EEF3;color:#1F3A44;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Hold for later</button>';
  html += '</div>';

  html += '</div>'; // end scroll body

  panel.innerHTML = html;
}

/**
 * Render one inline PDF block (iframe + open-in-new-tab fallback).
 */
function renderMsReportingPdf(label, url) {
  var html = '<div style="background:#fff;border:1px solid var(--sw-border);border-radius:8px;overflow:hidden;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-bottom:1px solid var(--sw-border);">';
  html += '<span style="font-size:12px;font-weight:700;color:var(--sw-dark);">' + escapeHtml(label) + '</span>';
  if (url) {
    html += '<a href="' + escapeAttr(url) + '" target="_blank" rel="noopener" style="font-size:11px;font-weight:700;color:var(--sw-orange);text-decoration:none;">Open in new tab</a>';
  }
  html += '</div>';
  if (url) {
    html += '<iframe title="' + escapeAttr(label) + '" src="' + escapeAttr(url) + '" style="width:100%;height:420px;border:0;display:block;background:#fff;"></iframe>';
  } else {
    html += '<div style="padding:18px 12px;font-size:12px;color:#B91C1C;background:#FFF7ED;">No ' + escapeHtml(label.toLowerCase()) + ' PDF found for this job. The send will fail preflight until it is attached.</div>';
  }
  html += '</div>';
  return html;
}

/**
 * Reset #msReportingDetailPanel to the empty state.
 */
function showMsReportingDetailEmpty() {
  var panel = document.getElementById('msReportingDetailPanel');
  if (!panel) return;
  panel.innerHTML = '<div class="approvals-empty-state">'
    + '<div style="font-size:36px;opacity:0.3;margin-bottom:12px;">&#128203;</div>'
    + '<div style="font-size:13px;color:var(--sw-text-sec);">Select a pack to review</div>'
    + '</div>';
}

// ────────────────────────────────────────────────────────────
// 3. ACTION - approve + send (LIVE authorise + email)
// ────────────────────────────────────────────────────────────

/**
 * Approve the pack: confirm, then call makesafe_send_pack with the recipient +
 * the gate-passing default subject/body the read endpoint supplied. Surfaces the
 * backend's fail-closed errors verbatim; treats {already_sent:true} as info.
 */
async function approveMakesafeReportPack(jobId) {
  var d = _msReportingCache[jobId];
  if (!d) { showToast('Pack not loaded; reload the list.', 'error'); return; }
  if (!d.recipient_email) { showToast('No builder recipient email on file; cannot send.', 'error'); return; }

  var subject = d.default_subject || '';
  var htmlBody = d.default_html_body || '';
  // Defence in depth: never send a subject carrying a review/test marker. The
  // backend gate also enforces this, but we refuse to even attempt the call.
  if (_msReportingSubjectHasReviewMarker(subject)) {
    showToast('Refusing to send: the subject contains a review/test marker.', 'error');
    return;
  }
  if (!subject || !htmlBody) {
    showToast('Missing subject or body for this pack; reload the list.', 'error');
    return;
  }

  if (!confirm('This authorises the invoice and emails the builder. Send now?')) return;

  var btn = document.getElementById('msReportingApproveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

  try {
    var result = await opsPost('makesafe_send_pack', {
      job_id: jobId,
      pack_kind: 'main',
      recipient_email: d.recipient_email,
      subject: subject,
      html_body: htmlBody
    });
    if (result && result.already_sent) {
      showToast('Pack was already sent for this job (marker present); nothing re-sent.', 'info');
    } else if (result && result.status === 'sent_not_closed') {
      showToast('Pack sent. Note: the make-safe close did not apply; resume to reconcile.', 'info');
    } else {
      showToast('Pack sent to ' + d.recipient_email + (result && result.invoice_number ? ' (invoice ' + result.invoice_number + ')' : ''), 'success');
    }
    loadMakesafeReportingCockpit();
    showMsReportingDetailEmpty();
  } catch (e) {
    // Backend returns clear fail-closed errors (client send gate failed,
    // conflict: pack already sending, preflight failed). Surface verbatim.
    showToast('Send failed: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Approve and send pack'; }
  }
}

// Whole-token review-marker check mirroring the backend gate. Used for the
// approve-time defence-in-depth refusal.
var _MS_REPORTING_REVIEW_MARKERS = ['TEST', 'ROUND', 'DRAFT', 'REVIEW', 'INTERNAL', 'PREVIEW'];
function _msReportingSubjectHasReviewMarker(subject) {
  var upper = String(subject || '').toUpperCase();
  for (var i = 0; i < _MS_REPORTING_REVIEW_MARKERS.length; i++) {
    var m = _MS_REPORTING_REVIEW_MARKERS[i];
    var re = new RegExp('(^|[^A-Z0-9])' + m + '([^A-Z0-9]|$)');
    if (re.test(upper)) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────
// 4. BADGE
// ────────────────────────────────────────────────────────────

/**
 * Update the Reporting tab badge with the pack count. Hidden when 0.
 */
function refreshMsReportingBadge(count) {
  var badge = document.getElementById('msReportingBadge');
  if (!badge) return;
  if (count && count > 0) {
    badge.textContent = String(count);
    badge.style.display = '';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}

// SMOKE TEST (manual, run in browser console):
// 1. showView('approvals') -- approvals view loads
// 2. Click "MakeSafe Reporting" tab -- reporting cockpit renders, loading state
// 3. loadMakesafeReportingCockpit() returns a count (0 or N)
// 4. If packs exist: clicking a card renders detail with photos, invoice line
//    items + totals, BOTH PDFs inline, the recipient email, an approve button
// 5. approve button disabled when no recipient_email or no invoice
// 6. approveMakesafeReportPack confirms, then opsPost('makesafe_send_pack', ...)
//    with recipient_email + the gate-passing default subject/body
// 7. {already_sent:true} -> info toast; backend errors -> error toast (not swallowed)
//
// Automated smoke: modules/ops-makesafe-reporting-cockpit.smoke.mjs

// Export for the node smoke test (no-op in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loadMakesafeReportingCockpit: typeof loadMakesafeReportingCockpit !== 'undefined' ? loadMakesafeReportingCockpit : undefined
  };
}
