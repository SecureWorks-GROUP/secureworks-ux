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
var _msPhotoApprovalState = {};

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

  // The pack status badge: keyed off resume_action (drives the button + chip).
  // Fallback to the legacy pack_status whitelist when resume_action is absent.
  var packStatus = d.pack_status ? (d.pack_status.status || '') : '';
  var badge = _msReportingCardBadge(d.resume_action, packStatus);
  var statusBg = badge.bg;
  var statusLabel = badge.label;

  var safeId = escapeAttr(d.job_id);
  var html = '<div onclick="showMsReportingDetail(\'' + safeId + '\')" style="background:#fff;border:1px solid var(--sw-border);border-radius:8px;padding:12px;margin:10px;cursor:pointer;box-shadow:0 1px 3px rgba(41,60,70,0.06);border-left:4px solid ' + statusBg + ';">';

  // Top row: status badge (+ amber money-review chip when flagged + first-draft chip)
  var action = d.resume_action || '';
  html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;">';
  html += '<span style="font-size:9px;font-weight:800;letter-spacing:0.04em;padding:2px 7px;border-radius:10px;background:' + statusBg + ';color:#fff;">' + statusLabel + '</span>';
  if (d.needs_money_review === true) {
    html += '<span style="font-size:9px;font-weight:800;letter-spacing:0.04em;padding:2px 7px;border-radius:10px;background:#B45309;color:#fff;">CHECK PRICING</span>';
  }
  var isFirstDraft = d.first_draft_ready === true ||
    (action === 'send' && (!packStatus || packStatus === 'drafted' || packStatus === 'admin_to_send_report'));
  if (isFirstDraft) {
    html += '<span style="font-size:9px;font-weight:700;letter-spacing:0.04em;padding:2px 7px;border-radius:10px;background:#0E7C7B;color:#fff;opacity:0.75;">FIRST DRAFT</span>';
  }
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

// Map resume_action (with a legacy pack_status fallback) to the list-card badge.
function _msReportingCardBadge(resumeAction, packStatus) {
  var map = {
    send:               { label: 'NEEDS YOUR TICK',    bg: '#0E7C7B' },
    finish_send:        { label: 'FINISH SEND',        bg: '#B45309' },
    finish_close_out:   { label: 'FINISH CLOSE-OUT',   bg: '#6D28D9' },
    resolve_send_state: { label: 'RESOLVE SEND STATE', bg: '#B91C1C' }
  };
  if (resumeAction && map[resumeAction]) return map[resumeAction];
  if (packStatus === 'failed') return { label: 'BLOCKED', bg: '#991B1B' };
  var legacyResume = ['authorised_not_sent', 'sent_marker_failed', 'sent_not_closed', 'close_failed'].indexOf(packStatus) >= 0;
  return legacyResume ? { label: 'NEEDS RESUME', bg: '#B45309' } : { label: 'NEEDS YOUR TICK', bg: '#0E7C7B' };
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
function showMsReportingDetail(jobId, targetPanelId) {
  var d = _msReportingCache[jobId];
  var panel = document.getElementById(targetPanelId || 'msReportingDetailPanel');
  if (!panel) return;
  if (!d) {
    panel.innerHTML = '<div style="padding:20px;color:#E74C3C;font-size:13px;">Pack not loaded. <button onclick="loadMakesafeReportingCockpit()" style="margin-left:8px;">Reload</button></div>';
    return;
  }

  var safeId = escapeAttr(d.job_id);
  var builder = d.builder || d.requesting_company_name || '(no builder)';
  var inv = d.invoice || null;
  // When hosted in the board overlay, Back/Hold should close the overlay rather
  // than empty the (off-screen) inline approvals panel.
  var isOverlay = !!(targetPanelId && targetPanelId !== 'msReportingDetailPanel');
  var dismissAction = isOverlay ? 'closeMakesafeReportingOverlay()' : 'showMsReportingDetailEmpty()';

  // ── CAROUSEL FEED ────────────────────────────────────────────────────────
  // Build the doc-viewer entry list from the feed: drafted outputs first (report,
  // invoice, SWMS if present), then the source docs (work order, photos). Each
  // entry is {label, url, kind} — the shape renderMakesafeDocViewerFrame expects
  // (doc:null is fine; the footer/chip title fall back to the label).
  // Reuse: the job-detail carousel uses the SAME global _msafeDocViewer + the fixed
  // element id 'msafeDocViewerInner'. Only one doc viewer is visible at a time (the
  // review overlay sits over the board; the job-detail viewer is a different screen),
  // so we re-init the shared global here on open. msafeDocViewerGo/Jump operate on
  // that global and re-render #msafeDocViewerInner — which is exactly the node this
  // panel mounts — so navigation works without a second instance. Opening a job-detail
  // afterwards calls renderMakesafeDocViewer(data) which re-inits the global, so no leak.
  var carouselDocs = _msReportingBuildCarouselDocs(d);
  if (typeof _msafeDocViewer !== 'undefined') {
    _msafeDocViewer.docs = carouselDocs;
    _msafeDocViewer.idx = 0;
  }

  // Initialize photo approval state for this job (all photos approved by default on first open)
  var allPhotosForInit = _msGetAllPhotos(d);
  _msGetPhotoApprovalState(d.job_id, allPhotosForInit);

  var html = '';

  // Header
  html += '<div style="flex-shrink:0;display:flex;align-items:flex-start;gap:12px;padding:14px 18px;background:#fff;border-bottom:1px solid var(--sw-border);">';
  html += '<button onclick="' + dismissAction + '" style="background:none;border:none;color:var(--sw-orange);font-size:13px;font-weight:600;cursor:pointer;padding:4px 0;white-space:nowrap;">&#8592; Back</button>';
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
    var isFailed = ps.status === 'failed';
    html += '<div style="margin-bottom:14px;padding:10px 14px;border-radius:8px;border:1px solid ' + (isFailed ? '#FECACA' : '#FDE68A') + ';background:' + (isFailed ? '#FEF2F2' : '#FFFBEB') + ';font-size:12px;color:' + (isFailed ? '#991B1B' : '#92400E') + ';">';
    html += '<strong>Pack state:</strong> ' + escapeHtml(ps.status);
    if (ps.failed_step) html += ' (last step: ' + escapeHtml(ps.failed_step) + ')';
    if (ps.error_detail) html += '<div style="margin-top:4px;">' + escapeHtml(ps.error_detail) + '</div>';
    if (ps.send_started_at) {
      html += '<div style="margin-top:4px;">Send started ' + escapeHtml(_msReportingAgeText(ps.send_started_at)) + (ps.in_flight_stale ? ' — flagged STALE.' : '.') + '</div>';
    }
    if (!isFailed) {
      html += '<div style="margin-top:4px;">Resuming is safe: an authorised invoice is not re-authorised, a sent pack is not re-sent.</div>';
    }
    html += '</div>';
  }

  // Money-review banner (Task 4) — only when the backend flags pricing. Defensive:
  // absent needs_money_review renders nothing.
  if (d.needs_money_review === true) {
    var mr = d.money_review || {};
    html += '<div style="margin-bottom:14px;padding:10px 14px;border-radius:8px;border:1px solid #FCD34D;background:#FFFBEB;font-size:12px;color:#92400E;">';
    html += '<strong>&#9888; Pricing flagged for review.</strong>';
    if (mr.reason) html += ' ' + escapeHtml(mr.reason);
    if (mr.flagged_lines && mr.flagged_lines.length) {
      html += '<div style="margin-top:4px;">' + mr.flagged_lines.length + ' invoice line' + (mr.flagged_lines.length === 1 ? '' : 's') + ' highlighted below — confirm pricing before you send.</div>';
    }
    html += '</div>';
  }

  // Trade notes (raw submission notes from the trade — shown when present)
  if (d.trade_notes && d.trade_notes.trim()) {
    html += '<div style="margin-bottom:16px;padding:12px 14px;border-radius:8px;background:#F8FAFC;border:1px solid #CBD5E1;">';
    html += '<div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;margin-bottom:8px;">Trade notes (raw from submission)</div>';
    html += '<div style="font-size:13px;color:var(--sw-dark);white-space:pre-wrap;word-break:break-word;">' + escapeHtml(d.trade_notes) + '</div>';
    html += '</div>';
  }

  // Recipient - who gets this pack (recipient + CC)
  html += '<div style="margin-bottom:16px;padding:12px 14px;border-radius:8px;border:1px solid ' + (d.recipient_email ? '#BBF7D0' : '#FECACA') + ';background:' + (d.recipient_email ? '#F0FDF4' : '#FEF2F2') + ';">';
  html += '<div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Pack will be emailed to</div>';
  if (d.recipient_email) {
    html += '<div style="font-size:14px;font-weight:700;color:var(--sw-dark);margin-top:4px;">' + escapeHtml(d.recipient_email) + '</div>';
    var ccList = Array.isArray(d.cc) ? d.cc.filter(Boolean) : [];
    if (ccList.length) {
      html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:2px;">CC ' + escapeHtml(ccList.join(', ')) + '</div>';
    }
  } else {
    html += '<div style="font-size:13px;font-weight:700;color:#B91C1C;margin-top:4px;">No builder email on file. The send cannot proceed until a recipient is set.</div>';
  }
  html += '</div>';

  // DOCUMENT CAROUSEL — report, invoice, SWMS, work order, photos (one viewer, swipe
  // through). Reuses the ops.html .ms-docviewer-* CSS + the shared carousel renderer.
  html += '<div style="margin-bottom:8px;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Documents &amp; evidence</div>';
  html += '<div style="margin-bottom:18px;">';
  if (carouselDocs.length && typeof renderMakesafeDocViewerInner === 'function') {
    html += '<div class="ms-docviewer-card" style="margin-bottom:0;"><div id="msafeDocViewerInner">' + renderMakesafeDocViewerInner() + '</div></div>';
  } else {
    html += '<div style="font-size:12px;color:var(--sw-text-sec);background:#fff;border:1px dashed var(--sw-border);border-radius:8px;padding:12px;">No documents or evidence attached to this pack yet.</div>';
  }
  html += '</div>';

  // PHOTO APPROVAL (MANDATORY gate — all start approved, opt-out model)
  html += _msRenderPhotoApproval(d, d.job_id);

  // INVOICE LINE ITEMS + totals (with money-review line highlights)
  html += '<div style="margin-bottom:8px;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Invoice</div>';
  if (inv) {
    var flaggedByIndex = _msReportingFlaggedLineMap(d);
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
      inv.lines.forEach(function(li, idx) {
        var flag = _msReportingLineFlag(flaggedByIndex, idx, li);
        var rowStyle = flag ? 'border-bottom:1px solid #e5e7eb;background:#FFFBEB;' : 'border-bottom:1px solid #e5e7eb;';
        html += '<tr style="' + rowStyle + '">'
          + '<td style="padding:7px 12px;">' + (flag ? '<span style="color:#B45309;font-weight:800;margin-right:4px;">&#9888;</span>' : '') + escapeHtml(li.description || '') + '</td>'
          + '<td style="padding:7px 12px;text-align:right;">' + escapeHtml(String(li.quantity)) + '</td>'
          + '<td style="padding:7px 12px;text-align:right;">' + _msFmtAud(li.unit_price) + '</td>'
          + '<td style="padding:7px 12px;text-align:right;">' + _msFmtAud(li.line_total) + '</td>'
          + '</tr>';
        if (flag) {
          var note = [];
          if (flag.confidence != null) note.push('confidence ' + escapeHtml(String(flag.confidence)));
          if (flag.note) note.push(escapeHtml(flag.note));
          html += '<tr style="background:#FFFBEB;"><td colspan="4" style="padding:0 12px 7px 12px;font-size:11px;color:#92400E;">'
            + (note.length ? note.join(' · ') : 'Flagged for pricing review.') + '</td></tr>';
        }
      });
      html += '</tbody></table>';
    } else if (inv.lines_unavailable) {
      html += '<div style="padding:12px;font-size:12px;color:#92400E;background:#FFFBEB;">' + escapeHtml(inv.lines_note || 'Line detail in the invoice PDF in the carousel above.') + '</div>';
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

  // STATE-AWARE PRIMARY ACTION (Task 2): label + handler key off resume_action.
  html += '<div style="border-top:1px solid #EEF2F5;padding-top:14px;display:flex;flex-direction:column;gap:8px;">';
  html += _msReportingActionBlock(d, safeId, inv, dismissAction);
  html += '</div>';

  html += '</div>'; // end scroll body

  panel.innerHTML = html;
}

// ── CAROUSEL + MONEY-REVIEW HELPERS ─────────────────────────────────────────

/**
 * Map the feed's draft_docs[] + source_docs[] into the shared doc-viewer entry
 * shape ({label, url, kind, doc}). draft outputs lead (report/invoice/SWMS), then
 * source docs (work order, photos). Falls back to the legacy report_pdf_url /
 * invoice_pdf_url + photos[] fields if the new arrays are absent (pre-#193 feed).
 */
function _msReportingBuildCarouselDocs(d) {
  var out = [];
  var seen = {};
  function add(label, url, kind) {
    if (!url) return;
    if (seen[url]) return;
    seen[url] = true;
    var k = kind || _msReportingDocKind(url);
    // For PDFs, append #view=FitH so iframe renders fit-to-page (only when no fragment already present).
    var displayUrl = url;
    if (k === 'pdf' && url.indexOf('#') === -1) {
      displayUrl = url + '#view=FitH';
    }
    out.push({ label: label || 'Document', url: displayUrl, kind: k, doc: null });
  }
  // Drafted outputs first.
  if (Array.isArray(d.draft_docs)) {
    d.draft_docs.forEach(function(dd) { if (dd) add(dd.label, dd.url, _msReportingNormaliseKind(dd.kind)); });
  } else {
    add('Make safe report', d.report_pdf_url, 'pdf');
    add('Draft invoice', d.invoice_pdf_url, 'pdf');
  }
  // Source docs next (work order, photos, etc.).
  if (Array.isArray(d.source_docs)) {
    d.source_docs.forEach(function(sd) { if (sd) add(sd.label, sd.url, _msReportingNormaliseKind(sd.kind)); });
  }
  // Legacy photos[] fallback if no source_docs supplied them.
  if (!Array.isArray(d.source_docs) && Array.isArray(d.photos)) {
    d.photos.forEach(function(p, i) {
      if (!p) return;
      add(p.label || ('Photo ' + (i + 1)), p.url || p.thumbnail_url, 'image');
    });
  }
  return out;
}

// Normalise a feed kind ('pdf'|'image') to the viewer's kind vocabulary
// ('pdf'|'image'|'other'). Unknown kinds get classified by URL.
function _msReportingNormaliseKind(kind) {
  if (kind === 'pdf' || kind === 'image') return kind;
  return null;
}

// Classify a URL when the feed didn't supply a kind.
function _msReportingDocKind(url) {
  var u = String(url || '').split('?')[0].toLowerCase();
  if (/\.pdf$/.test(u)) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|svg|heic)$/.test(u)) return 'image';
  return 'other';
}

// Build a lookup of flagged invoice lines keyed by line_index (Task 4). Defensive:
// absent money_review / flagged_lines returns an empty map (no highlights).
function _msReportingFlaggedLineMap(d) {
  var map = {};
  if (!d || !d.needs_money_review || !d.money_review) return map;
  var lines = d.money_review.flagged_lines;
  if (!Array.isArray(lines)) return map;
  lines.forEach(function(fl) {
    if (!fl) return;
    if (fl.line_index != null) map['i:' + fl.line_index] = fl;
    if (fl.description) map['d:' + String(fl.description).trim().toLowerCase()] = fl;
  });
  return map;
}

// Resolve a flagged line for one invoice row: match by line_index first, then by
// description (fallback). Returns the flag object or null.
function _msReportingLineFlag(map, idx, li) {
  if (!map) return null;
  if (map['i:' + idx]) return map['i:' + idx];
  if (li && li.description) {
    var key = 'd:' + String(li.description).trim().toLowerCase();
    if (map[key]) return map[key];
  }
  return null;
}

// Human-readable age of an ISO timestamp ("12 minutes ago", "2 hours ago").
function _msReportingAgeText(iso) {
  var t = new Date(iso).getTime();
  if (isNaN(t)) return String(iso);
  var secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return secs + ' second' + (secs === 1 ? '' : 's') + ' ago';
  var mins = Math.floor(secs / 60);
  if (mins < 60) return mins + ' minute' + (mins === 1 ? '' : 's') + ' ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' hour' + (hrs === 1 ? '' : 's') + ' ago';
  var days = Math.floor(hrs / 24);
  return days + ' day' + (days === 1 ? '' : 's') + ' ago';
}

// ── STATE-AWARE ACTION BLOCK (Task 2) ───────────────────────────────────────

/**
 * Build the primary-action block for the panel, keyed off d.resume_action:
 *   'send' / absent+drafted -> "Approve & send pack"  -> approveMakesafeReportPack
 *   'finish_send'           -> "Finish send"           -> approveMakesafeReportPack
 *   'finish_close_out'      -> "Finish close-out"      -> finishMakesafeCloseOut
 *   'resolve_send_state'    -> "Resolve send state"    -> resolveMakesafeSendState
 *   failed (no resume_action + pack_status.status==='failed') -> blocked, no send btn
 */
function _msReportingActionBlock(d, safeId, inv, dismissAction) {
  var html = '';
  var action = d.resume_action || '';
  var packStatus = d.pack_status ? (d.pack_status.status || '') : '';

  // Portal builders (Western Building / Builderwest): manual portal submission, no email button.
  if (_msIsPortalBuilder(d)) {
    html += '<div style="padding:12px 14px;border-radius:8px;border:1px solid #BBF7D0;background:#F0FDF4;">';
    html += '<div style="font-size:13px;font-weight:800;color:#166534;">Ready to submit on portal</div>';
    html += '<div style="font-size:12px;color:#166534;margin-top:4px;">This builder uses a secure portal (Prime system) for report submission. The pack (report + invoice + SWMS) has been prepared. Submit manually on their portal link.</div>';
    html += '</div>';
    html += '<button id="msReportingApproveBtn" onclick="approveMakesafeReportPack(\'' + safeId + '\')" style="background:#166534;color:#fff;border:none;padding:12px 16px;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer;">Mark as portal submitted</button>';
    html += '<div style="font-size:11px;color:var(--sw-text-sec);">This marks the pack as portal-ready and records your approval. No email is sent.</div>';
    html += '<button onclick="' + dismissAction + '" style="background:#E5EEF3;color:#1F3A44;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Hold for later</button>';
    return html;
  }

  // Blocked / failed: no send action — needs ops. Optional understated reset button.
  if (!action && packStatus === 'failed') {
    var ps = d.pack_status || {};
    html += '<div style="padding:12px 14px;border-radius:8px;border:1px solid #FECACA;background:#FEF2F2;">';
    html += '<div style="font-size:13px;font-weight:800;color:#991B1B;">Blocked &mdash; needs ops</div>';
    html += '<div style="font-size:12px;color:#991B1B;margin-top:4px;">This pack failed' + (ps.failed_step ? ' at step <strong>' + escapeHtml(ps.failed_step) + '</strong>' : '') + '. It cannot be sent from here until it is reset.</div>';
    html += '</div>';
    html += '<button onclick="resetMakesafeFailedPack(\'' + safeId + '\')" style="background:#fff;color:#991B1B;border:1px solid #FECACA;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Reset &amp; retry (ops)</button>';
    html += '<button onclick="' + dismissAction + '" style="background:#E5EEF3;color:#1F3A44;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Hold for later</button>';
    return html;
  }

  // resolve_send_state: ambiguous in-flight — Sent-Items-first, two explicit choices.
  if (action === 'resolve_send_state') {
    var rs = d.pack_status || {};
    html += '<div style="padding:12px 14px;border-radius:8px;border:1px solid #FCA5A5;background:#FEF2F2;">';
    html += '<div style="font-size:13px;font-weight:800;color:#991B1B;">Send state unclear &mdash; verify the Sent Items folder first</div>';
    html += '<div style="font-size:12px;color:#7F1D1D;margin-top:4px;">A send was started'
      + (rs.send_started_at ? ' ' + escapeHtml(_msReportingAgeText(rs.send_started_at)) : '')
      + (rs.in_flight_stale ? ' and is now flagged <strong>stale</strong>' : '')
      + ', but we cannot confirm whether the builder email actually went out. <strong>Open the orders@ Sent Items and check before choosing.</strong></div>';
    html += '</div>';
    // Primary (safe) choice: it WAS sent → just reconciles, no re-email.
    html += '<button onclick="resolveMakesafeSendState(\'' + safeId + '\',\'confirmed_sent\')" style="background:#27AE60;color:#fff;border:none;padding:11px 16px;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer;">It WAS sent &mdash; mark confirmed (no re-email)</button>';
    // Secondary, deliberate choice: it was NOT sent → triggers a real re-send.
    html += '<button onclick="resolveMakesafeSendState(\'' + safeId + '\',\'confirmed_not_sent\')" style="background:#fff;color:#B91C1C;border:1px solid #FCA5A5;padding:9px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">It was NOT sent &mdash; re-send the pack now</button>';
    html += '<button onclick="' + dismissAction + '" style="background:#E5EEF3;color:#1F3A44;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Hold for later</button>';
    return html;
  }

  // finish_close_out: already emailed — only finishes the close-out. Never sends.
  if (action === 'finish_close_out') {
    html += '<button id="msReportingApproveBtn" onclick="finishMakesafeCloseOut(\'' + safeId + '\')" style="background:#6D28D9;color:#fff;border:none;padding:12px 16px;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer;">Finish close-out</button>';
    html += '<div style="font-size:11px;color:var(--sw-text-sec);">This pack was already emailed. This only finishes the close-out (marks the job complete). It will NOT re-send or re-charge.</div>';
    html += '<button onclick="' + dismissAction + '" style="background:#E5EEF3;color:#1F3A44;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Hold for later</button>';
    return html;
  }

  // send / finish_send / (absent + drafted): both go through approveMakesafeReportPack
  // -> makesafe_send_pack (UNCHANGED signature). finish_send re-emails once (backend
  // resumes; no re-authorise). The confirm wording differs per action.
  var canSend = !!d.recipient_email && !!inv;
  var isFinishSend = action === 'finish_send';
  var label = isFinishSend ? 'Finish send' : 'Approve & send pack';
  html += '<button id="msReportingApproveBtn" onclick="approveMakesafeReportPack(\'' + safeId + '\')"'
    + (canSend ? '' : ' disabled')
    + ' style="background:' + (isFinishSend ? '#B45309' : '#27AE60') + ';color:#fff;border:none;padding:12px 16px;border-radius:8px;font-size:14px;font-weight:800;cursor:' + (canSend ? 'pointer' : 'not-allowed') + ';opacity:' + (canSend ? '1' : '.45') + ';">' + label + '</button>';
  if (!canSend) {
    html += '<div style="font-size:12px;color:#B91C1C;">' + (!d.recipient_email ? 'A builder recipient email is required. ' : '') + (!inv ? 'A linked invoice is required.' : '') + '</div>';
  } else if (isFinishSend) {
    html += '<div style="font-size:11px;color:var(--sw-text-sec);">The invoice is already authorised. This finishes the send by re-emailing the pack once to ' + escapeHtml(d.recipient_email) + ' (no re-authorise).</div>';
  } else {
    html += '<div style="font-size:11px;color:var(--sw-text-sec);">This authorises the invoice in Xero and emails the pack to ' + escapeHtml(d.recipient_email) + '.</div>';
  }
  html += '<button onclick="' + dismissAction + '" style="background:#E5EEF3;color:#1F3A44;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Hold for later</button>';
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

  // State-aware confirm: finish_send resumes an already-authorised invoice (re-emails
  // once, no re-authorise); the normal send authorises + emails. The makesafe_send_pack
  // call below is UNCHANGED in either case — only the operator wording differs.
  var confirmMsg;
  if (d.resume_action === 'finish_send') {
    confirmMsg = 'This finishes sending the pack to ' + d.recipient_email + ' (the invoice is already authorised; it will not be re-authorised). Send now?';
  } else {
    confirmMsg = 'This authorises the invoice and emails the builder. Send now?';
  }
  if (!confirm(confirmMsg)) return;

  var btn = document.getElementById('msReportingApproveBtn');
  var origLabel = btn ? btn.textContent : 'Approve & send pack';
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

  try {
    // Collect approved photos from the photo-approval gate
    var allPhotos = _msGetAllPhotos(d);
    var photoState = _msPhotoApprovalState[d.job_id] || { approved: {} };
    var approvedPhotos = allPhotos.filter(function(p) { return !!photoState.approved[p.url]; });

    var result = await opsPost('makesafe_send_pack', {
      job_id: jobId,
      pack_kind: 'main',
      recipient_email: d.recipient_email,
      subject: subject,
      html_body: htmlBody,
      approved_photos: approvedPhotos
    });
    if (result && result.portal_ready) {
      showToast('Pack marked as ready for portal submission.', 'success');
    } else if (result && result.already_sent) {
      showToast('Pack was already sent for this job (marker present); nothing re-sent.', 'info');
    } else if (result && result.status === 'sent_not_closed') {
      showToast('Pack sent. Note: the make-safe close did not apply; resume to reconcile.', 'info');
    } else {
      showToast('Pack sent to ' + d.recipient_email + (result && result.invoice_number ? ' (invoice ' + result.invoice_number + ')' : ''), 'success');
    }
    _msReportingAfterSend();
  } catch (e) {
    // Backend returns clear fail-closed errors (client send gate failed,
    // conflict: pack already sending, preflight failed). Surface verbatim.
    showToast('Send failed: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = origLabel; }
  }
}

// ────────────────────────────────────────────────────────────
// 3b. RESUME ACTIONS (state machine: close-out, resolve-send-state, reset)
// ────────────────────────────────────────────────────────────

/**
 * finish_close_out: the pack was already emailed; this ONLY finishes the close-out
 * (marks the job complete). It does NOT re-send or re-charge. Calls the new
 * makesafe_resume_close action (close-only). On success: toast + refresh.
 */
async function finishMakesafeCloseOut(jobId) {
  var d = _msReportingCache[jobId];
  if (!d) { showToast('Pack not loaded; reload the list.', 'error'); return; }
  if (!confirm('This pack was already emailed; this only finishes the close-out (marks the job complete). It will NOT re-send or re-charge. Continue?')) return;

  var btn = document.getElementById('msReportingApproveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Finishing close-out...'; }

  try {
    var result = await opsPost('makesafe_resume_close', { job_id: jobId, pack_kind: 'main' });
    showToast('Close-out finished' + (result && result.job_number ? ' for job ' + result.job_number : '') + '.', 'success');
    _msReportingAfterSend();
  } catch (e) {
    showToast('Close-out failed: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Finish close-out'; }
  }
}

/**
 * resolve_send_state: an in-flight send whose outcome is unknown. The operator must
 * verify the Sent Items folder first, then pick one of two EXPLICIT choices (never a
 * default): 'confirmed_sent' (reconcile only, no re-email) or 'confirmed_not_sent'
 * (triggers a real re-send). Both go through the UNCHANGED makesafe_send_pack with an
 * added sending_resolution field. choice is passed in from the two buttons.
 */
async function resolveMakesafeSendState(jobId, choice) {
  var d = _msReportingCache[jobId];
  if (!d) { showToast('Pack not loaded; reload the list.', 'error'); return; }
  if (choice !== 'confirmed_sent' && choice !== 'confirmed_not_sent') {
    showToast('Pick whether the pack was sent or not.', 'error');
    return;
  }
  if (choice === 'confirmed_not_sent' && !d.recipient_email) {
    showToast('No builder recipient email on file; cannot re-send.', 'error');
    return;
  }

  var subject = d.default_subject || '';
  var htmlBody = d.default_html_body || '';
  // Defence in depth, mirroring the normal send: never carry a review/test marker.
  if (_msReportingSubjectHasReviewMarker(subject)) {
    showToast('Refusing to send: the subject contains a review/test marker.', 'error');
    return;
  }
  if (choice === 'confirmed_not_sent' && (!subject || !htmlBody)) {
    showToast('Missing subject or body for this pack; reload the list.', 'error');
    return;
  }

  var confirmMsg = (choice === 'confirmed_sent')
    ? 'You confirmed (from the Sent Items folder) that the pack WAS already sent. This will reconcile the send state without emailing again. Continue?'
    : 'You confirmed (from the Sent Items folder) that the pack was NOT sent. This will RE-SEND the pack to ' + d.recipient_email + ' now. Continue?';
  if (!confirm(confirmMsg)) return;

  // Disable both choice buttons during the call (they share no single id).
  var actionWrap = document.getElementById('msReportingApproveBtn');
  if (actionWrap) actionWrap.disabled = true;

  try {
    var result = await opsPost('makesafe_send_pack', {
      job_id: jobId,
      pack_kind: 'main',
      recipient_email: d.recipient_email,
      subject: subject,
      html_body: htmlBody,
      sending_resolution: choice
    });
    if (choice === 'confirmed_sent') {
      showToast('Send state reconciled (marked already-sent); nothing re-emailed.', 'success');
    } else if (result && result.already_sent) {
      showToast('Pack was already sent for this job (marker present); nothing re-sent.', 'info');
    } else {
      showToast('Pack re-sent to ' + d.recipient_email + (result && result.invoice_number ? ' (invoice ' + result.invoice_number + ')' : ''), 'success');
    }
    _msReportingAfterSend();
  } catch (e) {
    showToast('Resolve failed: ' + (e.message || e), 'error');
    if (actionWrap) actionWrap.disabled = false;
  }
}

/**
 * Privileged reset for a failed pack: clears the failed pack state so it can be
 * re-attempted. No send/charge — just unblocks. Reloads the surface on success.
 */
async function resetMakesafeFailedPack(jobId) {
  var d = _msReportingCache[jobId];
  if (!d) { showToast('Pack not loaded; reload the list.', 'error'); return; }
  if (!confirm('Reset this failed pack so it can be retried? This does not send or charge anything — it only clears the failed state.')) return;
  try {
    await opsPost('makesafe_reset_failed_pack', { job_id: jobId, pack_kind: 'main' });
    showToast('Failed pack reset; reloading.', 'success');
    _msReportingAfterSend();
  } catch (e) {
    showToast('Reset failed: ' + (e.message || e), 'error');
  }
}

/**
 * Refresh whichever surface hosts the reporting review after a successful send.
 * Board overlay: close it and reload the unified kanban (the card moves out of
 * Report Ready). Inline approvals tab: reload the cockpit list + reset the detail
 * panel (legacy fallback behaviour, unchanged).
 */
function _msReportingAfterSend() {
  if (typeof closeMakesafeReportingOverlay === 'function' && document.getElementById('makesafeReportingOverlay')) {
    closeMakesafeReportingOverlay();
    if (typeof loadJobs === 'function') loadJobs();
    return;
  }
  loadMakesafeReportingCockpit();
  showMsReportingDetailEmpty();
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

// ── PHOTO APPROVAL HELPERS ───────────────────────────────────────────────────

/**
 * Collect all photos from d.source_docs (kind=image) or d.photos[] as a fallback.
 * Returns [{url, label}] — used by the photo approval section and the send gate.
 */
function _msGetAllPhotos(d) {
  var photos = [];
  if (Array.isArray(d.source_docs)) {
    d.source_docs.forEach(function(sd) {
      if (sd && (sd.kind === 'image' || _msReportingDocKind(sd.url || '') === 'image')) {
        photos.push({ url: sd.url, label: sd.label || 'Photo' });
      }
    });
  }
  if (!photos.length && Array.isArray(d.photos)) {
    d.photos.forEach(function(p, i) {
      if (p && (p.url || p.thumbnail_url)) {
        photos.push({ url: p.url || p.thumbnail_url, label: p.label || ('Photo ' + (i + 1)) });
      }
    });
  }
  return photos;
}

/**
 * Get (or initialize) photo approval state for a job. On first access, all photos
 * start as approved (opt-out model per the contract).
 */
function _msGetPhotoApprovalState(jobId, allPhotos) {
  if (!_msPhotoApprovalState[jobId]) {
    var approvedSet = {};
    allPhotos.forEach(function(p) { if (p && p.url) approvedSet[p.url] = true; });
    _msPhotoApprovalState[jobId] = { approved: approvedSet };
  }
  return _msPhotoApprovalState[jobId];
}

/**
 * Toggle a single photo's approval state, then re-render the approval section
 * and update the send button gate.
 */
function _msTogglePhotoApproval(jobId, photoUrl) {
  if (!_msPhotoApprovalState[jobId]) return;
  var state = _msPhotoApprovalState[jobId];
  if (state.approved[photoUrl]) {
    delete state.approved[photoUrl];
  } else {
    state.approved[photoUrl] = true;
  }
  // Re-render just the photo approval section
  var safeJobIdAttr = jobId.replace(/-/g, '_');
  var section = document.getElementById('msPhotoApprovalSection_' + safeJobIdAttr);
  if (section) {
    var d = _msReportingCache[jobId];
    if (d) section.innerHTML = _msRenderPhotoApprovalInner(d, jobId);
  }
  // Also update the send button state
  _msUpdateSendButtonPhotoGate(jobId);
}

/**
 * Render the inner content of the photo-approval section (photo grid + count summary).
 * Called on first render and on each toggle.
 */
function _msRenderPhotoApprovalInner(d, jobId) {
  var allPhotos = _msGetAllPhotos(d);
  if (!allPhotos.length) {
    return '<div style="font-size:12px;color:var(--sw-text-sec);">No photos submitted with this report.</div>';
  }
  var state = _msGetPhotoApprovalState(jobId, allPhotos);
  var approvedCount = Object.keys(state.approved).length;
  var html = '';
  html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-bottom:10px;">';
  html += approvedCount + ' of ' + allPhotos.length + ' photos approved. ';
  if (approvedCount === 0) {
    html += '<strong style="color:#B91C1C;">At least one photo must be approved to send.</strong>';
  } else if (approvedCount < allPhotos.length) {
    html += (allPhotos.length - approvedCount) + ' excluded.';
  }
  html += '</div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
  allPhotos.forEach(function(p) {
    var isApproved = !!state.approved[p.url];
    var safeUrl = escapeAttr(p.url);
    var safeJobId = escapeAttr(jobId);
    html += '<div style="position:relative;width:80px;height:80px;border-radius:6px;overflow:hidden;border:2px solid '
      + (isApproved ? '#22C55E' : '#E5E7EB') + ';cursor:pointer;flex-shrink:0;"'
      + ' onclick="_msTogglePhotoApproval(\'' + safeJobId + '\',\'' + safeUrl + '\')"'
      + ' title="' + (isApproved ? 'Click to exclude' : 'Click to include') + '">';
    html += '<img src="' + safeUrl + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';
    if (!isApproved) {
      html += '<div style="position:absolute;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;">'
        + '<span style="color:#fff;font-size:20px;">&#10005;</span></div>';
    } else {
      html += '<div style="position:absolute;top:3px;right:3px;background:#22C55E;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;">'
        + '<span style="color:#fff;font-size:10px;font-weight:900;">&#10003;</span></div>';
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

/**
 * Build the outer photo-approval container (heading + section div with id for re-render).
 */
function _msRenderPhotoApproval(d, jobId) {
  var allPhotos = _msGetAllPhotos(d);
  var safeJobIdAttr = escapeAttr(jobId).replace(/-/g, '_');
  var html = '';
  html += '<div style="margin-bottom:8px;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Photo approval';
  if (allPhotos.length > 0) {
    html += ' <span style="font-size:10px;font-weight:600;color:#B91C1C;">(mandatory)</span>';
  }
  html += '</div>';
  html += '<div id="msPhotoApprovalSection_' + safeJobIdAttr + '" style="background:#fff;border:1px solid var(--sw-border);border-radius:8px;padding:12px;margin-bottom:18px;">';
  html += _msRenderPhotoApprovalInner(d, jobId);
  html += '</div>';
  return html;
}

/**
 * Update the send button's disabled state based on photo approval gate.
 * If photos exist but none are approved, the send button is disabled.
 */
function _msUpdateSendButtonPhotoGate(jobId) {
  var d = _msReportingCache[jobId];
  if (!d) return;
  var allPhotos = _msGetAllPhotos(d);
  var state = _msPhotoApprovalState[jobId] || { approved: {} };
  var approvedCount = Object.keys(state.approved).length;
  var hasPhotos = allPhotos.length > 0;
  var hasApproved = approvedCount > 0;
  var btn = document.getElementById('msReportingApproveBtn');
  if (!btn) return;
  // If photos exist but none approved, disable send
  if (hasPhotos && !hasApproved) {
    btn.disabled = true;
    btn.style.opacity = '0.45';
    btn.style.cursor = 'not-allowed';
    btn.title = 'Approve at least one photo to send';
  } else {
    var canSend = !!d.recipient_email && !!d.invoice;
    btn.disabled = !canSend;
    btn.style.opacity = canSend ? '1' : '0.45';
    btn.style.cursor = canSend ? 'pointer' : 'not-allowed';
    btn.title = '';
  }
}

// ── PORTAL BUILDER DETECTION ─────────────────────────────────────────────────

/**
 * Returns true if this job belongs to a portal-submission builder
 * (Western Building or Builderwest). These builders use a secure portal
 * (e.g. Prime) rather than email, so we show "Ready to submit on portal"
 * instead of the normal email button.
 */
function _msIsPortalBuilder(d) {
  var name = String((d.builder || d.requesting_company_name || '')).toLowerCase();
  var slug = String(d.requesting_company_slug || '').toLowerCase();
  return slug.includes('builderwest') || slug.includes('western-building')
    || name.includes('builderwest') || name.includes('western building');
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
