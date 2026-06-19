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

// JS-STRING escape for values interpolated INSIDE a single-quoted JS string in an
// inline onclick handler. escapeAttr/escapeHtml are HTML-context escapes (entities
// are decoded by the parser BEFORE the handler runs), so they do NOT protect the JS
// string boundary. This escapes the chars that break out of a '...'-quoted JS string
// (backslash, single quote) so a value carrying a quote can never inject handler JS.
// (job_ids are UUIDs and our photo URLs are clean, but this fails closed against any
// future field that isn't.) Pair with escapeAttr when the result also sits in an
// HTML attribute: jsAttr(v) = escapeAttr applied to the JS-escaped value.
function _msJsStr(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
function _msJsAttr(s) {
  // Safe for: onclick="fn('<HERE>')" — JS-escape first, then HTML-attr-escape so the
  // double-quoted attribute and the single-quoted JS string are both intact.
  return escapeAttr(_msJsStr(s));
}

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

  // Review button. Same approval mechanism as the board "Review job pack" action.
  html += '<div style="margin-top:10px;">';
  html += '<button onclick="event.stopPropagation();showMsReportingDetail(\'' + safeId + '\')" style="width:100%;background:#1F3A44;color:#fff;border:none;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Review job pack</button>';
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
 * Render the integrated review-and-send pack (design ref state A) into the target
 * panel. Top-to-bottom: job header (type chip + status chip), doc tabs (Report /
 * Invoice / SWMS) with a fit-to-page PDF stage, trade notes, recipient + per-builder
 * note, photos-at-bottom with the mandatory approval gate, then the per-builder
 * send/submit action block.
 *
 * Works in BOTH hosts: the board overlay (targetPanelId = ...Board) and the inline
 * Approvals-tab panel (targetPanelId = 'msReportingDetailPanel' / undefined).
 *
 * All money-safety behaviour is preserved: the photo-approval gate, the send-disabled
 * states, the resume_action branches (finish_send / finish_close_out /
 * resolve_send_state), and the money-review banner all flow through the reused
 * _msReportingActionBlock + _msRenderPhotoApproval helpers.
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
  var safeJobKey = _msDocTabKey(d.job_id);
  var builder = d.builder || d.requesting_company_name || '(no builder)';
  var inv = d.invoice || null;
  // When hosted in the board overlay, Back/Hold should close the overlay rather
  // than empty the (off-screen) inline approvals panel.
  var isOverlay = !!(targetPanelId && targetPanelId !== 'msReportingDetailPanel');
  var dismissAction = isOverlay ? 'closeMakesafeReportingOverlay()' : 'showMsReportingDetailEmpty()';
  var isPortal = _msIsPortalBuilder(d);

  // ── DOC TABS SOURCE ───────────────────────────────────────────────────────
  // Only the drafted outputs (report / invoice / SWMS) become tabs; source docs
  // (work order, photos) are not tabbed (photos render in the approval grid below).
  // _msReportingDocTabs filters _msReportingBuildCarouselDocs(d) to report/invoice/
  // SWMS PDFs. The SWMS tab appears only when a SWMS doc exists.
  var docTabs = _msReportingDocTabs(d);
  // Reset the active tab to the first doc on each fresh open of this job.
  _msActiveDocTab[d.job_id] = 0;

  // Initialize photo approval state for this job (all photos approved by default on first open)
  var allPhotosForInit = _msGetAllPhotos(d);
  _msGetPhotoApprovalState(d.job_id, allPhotosForInit);

  // Status chip on the right: send-ready vs resume vs portal.
  var statusChip = _msReportingStatusChip(d);

  var html = '';

  // ── JOB HEADER ─────────────────────────────────────────────────────────────
  var typeLabel = (d.makesafe_type || d.makesafe_type_detail || d.job_type || 'Make safe');
  typeLabel = String(typeLabel).toUpperCase();
  html += '<div style="flex-shrink:0;display:flex;align-items:flex-start;gap:12px;padding:16px 20px;background:#fff;border-bottom:1px solid var(--sw-border);">';
  html += '<button onclick="' + dismissAction + '" style="background:none;border:none;color:var(--sw-orange);font-size:13px;font-weight:700;cursor:pointer;padding:4px 0;white-space:nowrap;">&#8592; Back</button>';
  html += '<div style="flex:1;min-width:0;">';
  html += '<div style="font-size:17px;font-weight:700;color:var(--sw-dark);display:flex;align-items:center;flex-wrap:wrap;gap:8px;">';
  html += '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">' + escapeHtml(builder) + (d.external_ref ? ' &middot; ' + escapeHtml(d.external_ref) : '') + '</span>';
  html += '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.3px;background:#FDEBE4;color:var(--sw-orange);">' + escapeHtml(typeLabel) + '</span>';
  html += '</div>';
  var headerBits = [];
  if (d.job_number) headerBits.push('Job ' + d.job_number);
  if (d.client_name) headerBits.push(d.client_name);
  if (d.site_address) headerBits.push(d.site_address);
  else if (d.site_suburb) headerBits.push(d.site_suburb);
  html += '<div style="font-size:13px;color:var(--sw-text-sec);margin-top:3px;">' + escapeHtml(headerBits.join('  ·  ')) + '</div>';
  html += '</div>';
  html += '<div style="flex-shrink:0;"><span style="display:inline-block;padding:4px 11px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.3px;background:' + statusChip.bg + ';color:' + statusChip.fg + ';white-space:nowrap;">' + escapeHtml(statusChip.label) + '</span></div>';
  html += '</div>';

  // Scrollable body (single scroll column - everything visible without leaving the panel)
  html += '<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 0 16px;background:#F7FAFB;">';

  // Pack-status / resume banner (only when there is something to flag)
  if (d.pack_status && d.pack_status.status && d.pack_status.status !== 'drafted' && d.pack_status.status !== 'admin_to_send_report') {
    var ps = d.pack_status;
    var isFailed = ps.status === 'failed';
    html += '<div style="margin:16px 20px 0;padding:10px 14px;border-radius:8px;border:1px solid ' + (isFailed ? '#FECACA' : '#FDE68A') + ';background:' + (isFailed ? '#FEF2F2' : '#FFFBEB') + ';font-size:12px;color:' + (isFailed ? '#991B1B' : '#92400E') + ';">';
    html += '<strong>Pack state:</strong> ' + escapeHtml(ps.status);
    if (ps.failed_step) html += ' (last step: ' + escapeHtml(ps.failed_step) + ')';
    if (ps.error_detail) html += '<div style="margin-top:4px;">' + escapeHtml(ps.error_detail) + '</div>';
    if (ps.send_started_at) {
      html += '<div style="margin-top:4px;">Send started ' + escapeHtml(_msReportingAgeText(ps.send_started_at)) + (ps.in_flight_stale ? ' - flagged STALE.' : '.') + '</div>';
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
    html += '<div style="margin:16px 20px 0;padding:10px 14px;border-radius:8px;border:1px solid #FCD34D;background:#FFFBEB;font-size:12px;color:#92400E;">';
    html += '<strong>&#9888; Pricing flagged for review.</strong>';
    if (mr.reason) html += ' ' + escapeHtml(mr.reason);
    if (mr.flagged_lines && mr.flagged_lines.length) {
      html += '<div style="margin-top:4px;">' + mr.flagged_lines.length + ' invoice line' + (mr.flagged_lines.length === 1 ? '' : 's') + ' flagged. Open the Draft Invoice tab and confirm pricing before you send.</div>';
    }
    html += '</div>';
  }

  // ── DOCUMENTS — CLICK THROUGH (doc tabs + fit-to-page PDF stage) ───────────
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Documents &mdash; click through</div>';
  if (docTabs.length) {
    // Tab buttons.
    html += '<div id="msDocTabs_' + safeJobKey + '" style="display:flex;gap:8px;padding:0 20px 10px;flex-wrap:wrap;">';
    docTabs.forEach(function(t, i) {
      var active = (i === 0);
      var bg = active ? 'var(--sw-orange)' : '#fff';
      var fg = active ? '#fff' : 'var(--sw-dark)';
      var bd = active ? 'var(--sw-orange)' : 'var(--sw-border)';
      html += '<button type="button" data-tabidx="' + i + '" data-doc-url="' + escapeAttr(t.url || '') + '" onclick="_msSwitchDocTab(\'' + safeId + '\',' + i + ',\'' + escapeAttr(targetPanelId || 'msReportingDetailPanel') + '\')" style="border:1px solid ' + bd + ';background:' + bg + ';color:' + fg + ';padding:7px 13px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">' + escapeHtml(t.tabLabel) + '</button>';
    });
    html += '</div>';
    // PDF stage (whole-page). Stable id so _msSwitchDocTab can re-render just this.
    // Width is capped so a large monitor does not stretch the dark viewer gutters
    // across the whole approval panel; narrow screens still use the available width.
    html += '<div id="msDocStage_' + safeJobKey + '" style="margin:0 auto;width:calc(100% - 40px);max-width:980px;">' + _msRenderDocStage(docTabs, 0) + '</div>';
  } else {
    html += '<div style="margin:0 20px 4px;font-size:12px;color:var(--sw-text-sec);background:#fff;border:1px dashed var(--sw-border);border-radius:8px;padding:12px;">No drafted documents attached to this pack yet.</div>';
  }

  // ── INVOICE REVIEW (line items + totals + pricing flags) ───────────────────
  html += _msRenderInvoiceReview(d);

  // ── SOURCE EVIDENCE (work order / trade docs; photos are approved below) ───
  html += _msRenderSourceEvidence(d);

  // ── TRADE NOTES (raw from submission) ──────────────────────────────────────
  if (d.trade_notes && d.trade_notes.trim()) {
    html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Trade notes (raw from submission)</div>';
    html += '<div style="margin:0 20px 4px;background:#F7FAFC;border:1px solid var(--sw-border);border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.5;color:var(--sw-dark);white-space:pre-wrap;word-break:break-word;">' + escapeHtml(d.trade_notes) + '</div>';
  }

  // ── RECIPIENT + PER-BUILDER NOTE ───────────────────────────────────────────
  var builderNote = _msReportingBuilderNote(d);
  if (isPortal) {
    var portalPackFailed = d.pack_status && d.pack_status.status === 'failed';
    // Portal builders (Western / Builderwest): no recipient email. If the pack is
    // failed, do NOT tell ops to submit manually; the failed state must win until
    // reset/retried.
    html += '<div style="margin:14px 20px 4px;background:' + (portalPackFailed ? '#FEF2F2' : '#EAF4F4') + ';border:1px solid ' + (portalPackFailed ? '#FECACA' : '#BBE0DF') + ';border-radius:8px;padding:12px 14px;font-size:13px;">';
    if (portalPackFailed) {
      html += '<b style="display:block;font-size:11px;color:#991B1B;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:3px;">Portal pack blocked</b>';
      html += 'Do not submit this Western/Builderwest pack manually until the failed pack is reset or retried.';
    } else {
      html += '<b style="display:block;font-size:11px;color:var(--sw-mid);letter-spacing:0.4px;text-transform:uppercase;margin-bottom:3px;">Submit on portal</b>';
      html += 'Western Building / Builderwest use their Prime-system portal. Submit the pack manually.';
    }
    html += '</div>';
  } else {
    html += '<div style="margin:14px 20px 4px;background:#F1F8F3;border:1px solid #CFE6D6;border-radius:8px;padding:12px 14px;font-size:13px;' + (d.recipient_email ? '' : 'border-color:#FECACA;background:#FEF2F2;') + '">';
    html += '<b style="display:block;font-size:11px;color:var(--sw-mid);letter-spacing:0.4px;text-transform:uppercase;margin-bottom:3px;">Pack will be emailed to</b>';
    if (d.recipient_email) {
      html += '<span style="font-weight:700;color:var(--sw-dark);">' + escapeHtml(d.recipient_email) + '</span>';
      var ccList = Array.isArray(d.cc) ? d.cc.filter(Boolean) : [];
      if (ccList.length) {
        html += ' &nbsp; <span style="color:var(--sw-text-sec);">CC ' + escapeHtml(ccList.join(', ')) + '</span>';
      }
    } else {
      html += '<span style="font-weight:700;color:#B91C1C;">No builder email on file. The send cannot proceed until a recipient is set.</span>';
    }
    if (builderNote) {
      html += '<br/><span style="color:var(--sw-text-sec);font-size:12px;">' + escapeHtml(builderNote) + '</span>';
    }
    html += '</div>';
  }

  // ── PHOTOS AT THE BOTTOM (mandatory approval gate) ─────────────────────────
  // Reuses _msRenderPhotoApproval (grid + approve/exclude + count + send gate).
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Photos &mdash; approve which go in the pack (mandatory)</div>';
  html += '<div style="padding:0 20px;">' + _msRenderPhotoApprovalBody(d, d.job_id) + '</div>';

  // ── DRAFT FEEDBACK / REVISE PACK ─────────────────────────────────────────
  // Natural-language feedback surface: Marnin can ask for report, invoice,
  // photo or rules changes. The Revise Pack action is draft-only and never sends.
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Feedback &mdash; Revise Pack</div>';
  html += '<div id="msNotesPanel-' + safeId + '" style="padding:0 20px;"></div>';

  // ── ACTION BLOCK (per-builder send / submit) ──────────────────────────────
  // Reuses _msReportingActionBlock — keeps all resume_action + portal + failed
  // branches and the money-safety send gate intact.
  html += '<div style="margin-top:16px;padding:16px 20px;border-top:1px solid var(--sw-border);background:#fff;display:flex;flex-direction:column;gap:8px;">';
  html += _msReportingActionBlock(d, safeId, inv, dismissAction);
  html += '</div>';

  html += '</div>'; // end scroll body

  panel.innerHTML = html;

  // Populate the draft-feedback thread after the container exists. Guarded so
  // the review panel still works if the feedback module is absent/still loading.
  if (typeof loadMsNotes === 'function') {
    loadMsNotes(d.job_id, 'msNotesPanel-' + d.job_id);
  }
  _msUpdateSendButtonPhotoGate(d.job_id);
}

// ── DOC TABS (report / invoice / SWMS) ───────────────────────────────────────
// Module state: the active doc-tab index per job_id (default 0 = first doc).
var _msActiveDocTab = {};

// A DOM-safe key for element ids derived from a job id (no hyphens that break selectors).
function _msDocTabKey(jobId) {
  return String(jobId || '').replace(/[^A-Za-z0-9]/g, '_');
}

/**
 * Build the doc-tab list for a pack: the drafted outputs only (Make Safe Report /
 * Draft Invoice / SWMS). Source docs (work order, photos) are intentionally excluded
 * — photos render in the approval grid, the work order is not part of the send pack.
 * The SWMS tab appears only when a SWMS doc is present in the feed.
 * Each entry: { tabLabel, url, kind } where url already carries #view=Fit for PDFs
 * (via _msReportingBuildCarouselDocs) and keeps the versioned ?v= query intact.
 */
function _msReportingDocTabs(d) {
  var docs = _msReportingBuildCarouselDocs(d);
  var out = [];
  docs.forEach(function(doc) {
    var label = String(doc.label || '').toLowerCase();
    var tabLabel = null;
    if (/report/.test(label)) tabLabel = 'Make Safe Report';
    else if (/invoice/.test(label)) tabLabel = 'Draft Invoice';
    else if (/swms/.test(label)) tabLabel = 'SWMS';
    if (!tabLabel) return; // skip work order / photos / other source docs
    // De-dupe by tab label (one report, one invoice, one SWMS).
    if (out.some(function(o) { return o.tabLabel === tabLabel; })) return;
    out.push({ tabLabel: tabLabel, url: doc.url, kind: doc.kind });
  });
  // Order: Report, Invoice, SWMS (so SWMS is always the trailing optional tab).
  // Note: use a has-own check, not `|| 9` — 'Make Safe Report' maps to 0 (falsy).
  var order = { 'Make Safe Report': 0, 'Draft Invoice': 1, 'SWMS': 2 };
  out.sort(function(a, b) {
    var oa = (order[a.tabLabel] != null) ? order[a.tabLabel] : 9;
    var ob = (order[b.tabLabel] != null) ? order[b.tabLabel] : 9;
    return oa - ob;
  });
  return out;
}

/**
 * Render the whole-page PDF stage for the doc at index idx. Dark stage with the
 * PDF page centered + a "whole page" badge in the corner (matches the design ref
 * .pdfstage / .pdffit). For PDFs we embed an iframe with the Fit-fragment URL; for
 * an image we render it contained; for anything else, an open-in-new-tab fallback.
 */
function _msRenderDocStage(docTabs, idx) {
  var t = docTabs[idx];
  var inner;
  if (!t || !t.url) {
    inner = '<div style="color:#cdd8df;font-size:13px;">Document not available.</div>';
  } else if (t.kind === 'image') {
    inner = '<img src="' + escapeAttr(t.url) + '" alt="' + escapeAttr(t.tabLabel) + '" style="max-width:94%;max-height:94%;border-radius:3px;box-shadow:0 4px 18px rgba(0,0,0,.3);">';
  } else if (t.kind === 'pdf') {
    inner = '<iframe title="' + escapeAttr(t.tabLabel) + '" src="' + escapeAttr(t.url) + '" style="width:min(92%,720px);height:96%;border:none;border-radius:3px;box-shadow:0 4px 18px rgba(0,0,0,.3);background:#fff;"></iframe>';
  } else {
    inner = '<a href="' + escapeAttr(t.url) + '" target="_blank" rel="noopener" style="color:#fff;background:rgba(255,255,255,0.12);padding:10px 16px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;">Open ' + escapeHtml(t.tabLabel) + ' &#8599;</a>';
  }
  return '<div style="background:#3a464d;border-radius:8px;height:clamp(680px,78vh,900px);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">'
    + '<div style="position:absolute;top:8px;right:14px;font-size:11px;color:#cdd8df;background:rgba(0,0,0,.3);padding:2px 8px;border-radius:5px;">whole page</div>'
    + inner
    + '</div>';
}

/**
 * Switch the active doc tab: update tab button styling + re-render just the PDF stage.
 * Re-resolves the buttons + stage from the live panel so it works in BOTH hosts.
 */
function _msSwitchDocTab(jobId, idx, panelId) {
  var d = _msReportingCache[jobId];
  if (!d) return;
  var docTabs = _msReportingDocTabs(d);
  if (idx < 0 || idx >= docTabs.length) return;
  _msActiveDocTab[jobId] = idx;
  var key = _msDocTabKey(jobId);
  // Scope the lookup to the HOST PANEL so the inline approvals panel and the board
  // overlay (which can both contain the same job's msDocStage_<key>) never collide:
  // getElementById would return whichever is first in the DOM, so an overlay tab
  // click could update the hidden inline copy. Resolve within the panel passed from
  // the click (the same id used to render this panel); fall back to document scope.
  var root = (panelId && document.getElementById(panelId)) || document;
  var tabsWrap = root.querySelector
    ? (root.querySelector('#msDocTabs_' + key) || document.getElementById('msDocTabs_' + key))
    : document.getElementById('msDocTabs_' + key);
  if (tabsWrap) {
    var btns = tabsWrap.querySelectorAll('button[data-tabidx]');
    for (var i = 0; i < btns.length; i++) {
      var active = (Number(btns[i].getAttribute('data-tabidx')) === idx);
      btns[i].style.background = active ? 'var(--sw-orange)' : '#fff';
      btns[i].style.color = active ? '#fff' : 'var(--sw-dark)';
      btns[i].style.borderColor = active ? 'var(--sw-orange)' : 'var(--sw-border)';
    }
  }
  var stage = (root.querySelector && root.querySelector('#msDocStage_' + key)) || document.getElementById('msDocStage_' + key);
  if (stage) stage.innerHTML = _msRenderDocStage(docTabs, idx);
}

/**
 * The right-hand status chip for the header: maps resume_action / pack state /
 * portal builder to a {label, bg, fg}. Teal "first draft ready" for the send case.
 */
function _msReportingStatusChip(d) {
  var action = d.resume_action || '';
  var packStatus = d.pack_status ? (d.pack_status.status || '') : '';
  // Failed state wins over builder type. A failed Western/Builderwest portal pack
  // must look blocked, never ready/submittable.
  if (packStatus === 'failed') return { label: 'BLOCKED', bg: '#991B1B', fg: '#fff' };
  if (_msIsPortalBuilder(d)) return { label: 'READY TO SUBMIT', bg: '#0E7C7B', fg: '#fff' };
  if (action === 'resolve_send_state') return { label: 'SEND STATE UNCLEAR', bg: '#B91C1C', fg: '#fff' };
  if (action === 'finish_close_out') return { label: 'FINISH CLOSE-OUT', bg: '#6D28D9', fg: '#fff' };
  if (action === 'finish_send') return { label: 'FINISH SEND', bg: '#B45309', fg: '#fff' };
  return { label: 'FIRST DRAFT READY', bg: '#0E7C7B', fg: '#fff' };
}

/**
 * The per-builder note shown under the recipient line. AJS and MLB send two emails
 * (email 1 = the pack, email 2 = the approved photos individually); MLB's pack also
 * includes the SWMS. Returns '' when there is no specific note (no em dashes).
 */
function _msReportingBuilderNote(d) {
  var name = String((d.builder || d.requesting_company_name || '')).toLowerCase();
  var slug = String(d.requesting_company_slug || '').toLowerCase();
  var ref = String(d.external_ref || '').toUpperCase();
  var isMlb = slug.indexOf('mlb') >= 0 || name.indexOf('mlb') >= 0 || ref.indexOf('MLB') === 0;
  var isAjs = slug.indexOf('ajs') >= 0 || name.indexOf('ajs') >= 0 || ref.indexOf('AJS') === 0 || ref.indexOf('AJBR') === 0;
  if (isMlb) return 'MLB: email 1 = report + invoice + SWMS, email 2 = the approved photos individually.';
  if (isAjs) return 'AJS: email 1 = report + invoice, email 2 = the approved photos individually.';
  return '';
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
    // For PDFs, append #view=Fit so the iframe opens to the whole page, not fit-width.
    var displayUrl = url;
    if (k === 'pdf' && url.indexOf('#') === -1) {
      displayUrl = url + '#view=Fit';
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

// Render the draft invoice facts inside the review panel so Marnin can check the
// money before the send click. This is deliberately read-only: editing/pricing
// changes still go through the Draft Pack / Revise Pack loop, not the send button.
function _msRenderInvoiceReview(d) {
  var inv = d && d.invoice;
  if (!inv) return '';
  var lines = Array.isArray(inv.lines) ? inv.lines : [];
  var flags = _msReportingFlaggedLineMap(d);
  var html = '';
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Draft invoice review</div>';
  html += '<div style="margin:0 20px 4px;background:#fff;border:1px solid var(--sw-border);border-radius:8px;overflow:hidden;font-size:12px;color:var(--sw-dark);">';
  if (inv.invoice_number || inv.status) {
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--sw-border);background:#F7FAFB;color:var(--sw-text-sec);">';
    if (inv.invoice_number) html += '<span><strong>Invoice:</strong> ' + escapeHtml(inv.invoice_number) + '</span>';
    if (inv.status) html += '<span><strong>Status:</strong> ' + escapeHtml(inv.status) + '</span>';
    html += '</div>';
  }
  if (lines.length) {
    html += '<div style="display:flex;flex-direction:column;">';
    lines.forEach(function(li, idx) {
      li = li || {};
      var flag = _msReportingLineFlag(flags, idx, li);
      var bg = flag ? '#FFFBEB' : '#fff';
      var bd = flag ? '#FCD34D' : 'var(--sw-border)';
      var desc = li.description || li.name || ('Line ' + (idx + 1));
      var qty = li.quantity != null ? Number(li.quantity) : null;
      var unit = li.unit_price != null ? Number(li.unit_price) : (li.unit_amount != null ? Number(li.unit_amount) : null);
      var total = li.line_total != null ? Number(li.line_total) : (li.amount != null ? Number(li.amount) : null);
      html += '<div style="padding:10px 12px;border-bottom:1px solid ' + bd + ';background:' + bg + ';">';
      html += '<div style="font-weight:700;">' + escapeHtml(desc) + '</div>';
      var bits = [];
      if (qty != null && isFinite(qty)) bits.push('Qty ' + qty);
      if (unit != null && isFinite(unit)) bits.push('Unit ' + _msFmtAud(unit));
      if (total != null && isFinite(total)) bits.push('Line ' + _msFmtAud(total));
      if (bits.length) html += '<div style="margin-top:3px;color:var(--sw-text-sec);">' + escapeHtml(bits.join(' · ')) + '</div>';
      if (flag) {
        var note = flag.note || flag.reason || flag.description || 'Check this line before sending.';
        html += '<div style="margin-top:5px;color:#92400E;font-weight:700;">Pricing note: ' + escapeHtml(note) + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  } else if (inv.lines_unavailable) {
    html += '<div style="padding:10px 12px;color:var(--sw-text-sec);">Invoice line detail is unavailable for this draft.</div>';
  }
  html += '<div style="display:flex;justify-content:flex-end;gap:18px;padding:10px 12px;background:#F7FAFB;font-weight:800;">';
  if (inv.total_ex_gst != null) html += '<span>ex GST ' + escapeHtml(_msFmtAud(inv.total_ex_gst)) + '</span>';
  if (inv.total_inc_gst != null) html += '<span>inc GST ' + escapeHtml(_msFmtAud(inv.total_inc_gst)) + '</span>';
  html += '</div>';
  html += '</div>';
  return html;
}

// Render non-photo source evidence links in the review panel. The photo evidence
// is still shown in the mandatory approval section below, but work orders and
// trade/source PDFs must stay visible for draft-vs-source checking.
function _msRenderSourceEvidence(d) {
  if (!d || !Array.isArray(d.source_docs)) return '';
  var docs = d.source_docs.filter(function(sd) {
    if (!sd || !sd.url) return false;
    var kind = sd.kind || _msReportingDocKind(sd.url || '');
    return kind !== 'image';
  });
  if (!docs.length) return '';
  var html = '';
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Source evidence</div>';
  html += '<div style="margin:0 20px 4px;background:#fff;border:1px solid var(--sw-border);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:7px;font-size:12px;">';
  docs.forEach(function(sd) {
    var label = sd.label || 'Source document';
    html += '<a href="' + escapeAttr(sd.url) + '" target="_blank" rel="noopener" data-source-url="' + escapeAttr(sd.url) + '" style="color:var(--sw-orange);font-weight:700;text-decoration:none;word-break:break-all;">' + escapeHtml(label) + ' ↗</a>';
  });
  html += '</div>';
  return html;
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

  // Blocked / failed: no send/portal action — needs ops. This must come BEFORE
  // portal-builder handling so a failed Western/Builderwest pack cannot be shown as
  // ready/submittable.
  if (packStatus === 'failed') {
    var ps = d.pack_status || {};
    html += '<div style="padding:12px 14px;border-radius:8px;border:1px solid #FECACA;background:#FEF2F2;">';
    html += '<div style="font-size:13px;font-weight:800;color:#991B1B;">Blocked &mdash; needs ops</div>';
    html += '<div style="font-size:12px;color:#991B1B;margin-top:4px;">This pack failed' + (ps.failed_step ? ' at step <strong>' + escapeHtml(ps.failed_step) + '</strong>' : '') + '. It cannot be sent from here until it is reset.</div>';
    html += '</div>';
    html += '<button onclick="resetMakesafeFailedPack(\'' + safeId + '\')" style="background:#fff;color:#991B1B;border:1px solid #FECACA;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Reset &amp; retry (ops)</button>';
    html += '<button onclick="' + dismissAction + '" style="background:#E5EEF3;color:#1F3A44;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Hold for later</button>';
    return html;
  }

  // Portal builders (Western Building / Builderwest): manual portal submission, no email button.
  if (_msIsPortalBuilder(d)) {
    html += '<div style="padding:12px 14px;border-radius:8px;border:1px solid #BBE0DF;background:#EAF4F4;">';
    html += '<div style="font-size:13px;font-weight:800;color:#0E5F5E;">Ready to submit on portal</div>';
    html += '<div style="font-size:12px;color:#0E5F5E;margin-top:4px;">This builder uses a secure portal (Prime system) for report submission. The pack (report + invoice + SWMS) has been prepared. Submit manually on their portal link.</div>';
    html += '</div>';
    html += '<button id="msReportingApproveBtn" onclick="approveMakesafeReportPack(\'' + safeId + '\')" style="width:100%;background:#0E7C7B;color:#fff;border:none;padding:14px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">Mark as portal submitted</button>';
    html += '<div style="font-size:12px;color:var(--sw-text-sec);text-align:center;">This marks the pack as portal-ready and records your approval. No email is sent.</div>';
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
    + ' style="width:100%;background:' + (isFinishSend ? '#B45309' : '#27AE60') + ';color:#fff;border:none;padding:14px;border-radius:10px;font-size:15px;font-weight:700;cursor:' + (canSend ? 'pointer' : 'not-allowed') + ';opacity:' + (canSend ? '1' : '.45') + ';">' + label + '</button>';
  if (!canSend) {
    html += '<div style="font-size:12px;color:#B91C1C;text-align:center;">' + (!d.recipient_email ? 'A builder recipient email is required. ' : '') + (!inv ? 'A linked invoice is required.' : '') + '</div>';
  } else if (isFinishSend) {
    html += '<div style="font-size:12px;color:var(--sw-text-sec);text-align:center;">The invoice is already authorised. This finishes the send by re-emailing the pack once to ' + escapeHtml(d.recipient_email) + ' (no re-authorise).</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--sw-text-sec);text-align:center;">Authorises the invoice in Xero and emails the pack to ' + escapeHtml(d.recipient_email) + '. Your click, every time.</div>';
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


function _msApprovedPhotosOrBlock(jobId, d) {
  var allPhotos = _msGetAllPhotos(d);
  var state = _msGetPhotoApprovalState(jobId, allPhotos);
  var approvedPhotos = allPhotos.filter(function(p) {
    return p && p.url && !!state.approved[p.url];
  });
  if (allPhotos.length > 0 && approvedPhotos.length === 0) {
    showToast('Approve at least one photo before sending (only approved photos go in the pack).', 'error');
    return null;
  }
  return approvedPhotos;
}

/**
 * Approve the pack: confirm, then call makesafe_send_pack with the recipient +
 * the gate-passing default subject/body the read endpoint supplied. Surfaces the
 * backend's fail-closed errors verbatim; treats {already_sent:true} as info.
 */
async function approveMakesafeReportPack(jobId) {
  var d = _msReportingCache[jobId];
  if (!d) { showToast('Pack not loaded; reload the list.', 'error'); return; }
  var isPortal = (typeof _msIsPortalBuilder === 'function') && _msIsPortalBuilder(d);

  // Email builders (AJS / MLB) MUST have a recipient. Portal builders (Western /
  // Builderwest) intentionally have NONE — they prep the pack for manual portal
  // submission, so the recipient/subject/body checks are skipped for them.
  if (!isPortal && !d.recipient_email) { showToast('No builder recipient email on file; cannot send.', 'error'); return; }

  // FAIL-CLOSED PHOTO GATE (defence in depth — not just the disabled button). The
  // mandatory rule: ONLY approved photos go out, and at least one must be approved
  // when photos were submitted. Refuse the call if photos exist but none approved,
  // so a stale handler / direct invocation can never send a photo-less pack or
  // (for the follow-up) an empty photo set. Applies to BOTH email + portal.
  var approvedPhotos = _msApprovedPhotosOrBlock(jobId, d);
  if (approvedPhotos === null) return;

  var subject = d.default_subject || '';
  var htmlBody = d.default_html_body || '';
  if (!isPortal) {
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
  }

  // State-aware confirm. Portal = prep-for-portal (no email). finish_send resumes an
  // already-authorised invoice (re-emails once, no re-authorise). Normal = authorise
  // + email. The makesafe_send_pack call below is the same shape; only wording differs.
  var confirmMsg;
  if (isPortal) {
    confirmMsg = 'This prepares the pack (report + invoice + SWMS) for manual submission on the builder portal and records your approval. NO email is sent. Continue?';
  } else if (d.resume_action === 'finish_send') {
    confirmMsg = 'This finishes sending the pack to ' + d.recipient_email + ' (the invoice is already authorised; it will not be re-authorised). Send now?';
  } else {
    confirmMsg = 'This authorises the invoice and emails the builder. Send now?';
  }
  if (!confirm(confirmMsg)) return;

  var btn = document.getElementById('msReportingApproveBtn');
  var origLabel = btn ? btn.textContent : (isPortal ? 'Mark as portal submitted' : 'Approve & send pack');
  if (btn) { btn.disabled = true; btn.textContent = isPortal ? 'Preparing...' : 'Sending...'; }

  try {
    // Portal builders send NO recipient/subject/body — the backend detects the
    // portal builder, prepares the pack and returns { portal_ready: true } (no email).
    var payload = {
      job_id: jobId,
      pack_kind: 'main',
      approved_photos: approvedPhotos
    };
    if (!isPortal) {
      payload.recipient_email = d.recipient_email;
      payload.subject = subject;
      payload.html_body = htmlBody;
    }
    var result = await opsPost('makesafe_send_pack', payload);
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
  var approvedPhotos = [];
  if (choice === 'confirmed_not_sent') {
    approvedPhotos = _msApprovedPhotosOrBlock(jobId, d);
    if (approvedPhotos === null) return;
  }

  var confirmMsg = (choice === 'confirmed_sent')
    ? 'You confirmed (from the Sent Items folder) that the pack WAS already sent. This will reconcile the send state without emailing again. Continue?'
    : 'You confirmed (from the Sent Items folder) that the pack was NOT sent. This will RE-SEND the pack to ' + d.recipient_email + ' now. Continue?';
  if (!confirm(confirmMsg)) return;

  // Disable both choice buttons during the call (they share no single id).
  var actionWrap = document.getElementById('msReportingApproveBtn');
  if (actionWrap) actionWrap.disabled = true;

  try {
    var payload = {
      job_id: jobId,
      pack_kind: 'main',
      recipient_email: d.recipient_email,
      subject: subject,
      html_body: htmlBody,
      sending_resolution: choice
    };
    if (choice === 'confirmed_not_sent') payload.approved_photos = approvedPhotos;
    var result = await opsPost('makesafe_send_pack', payload);
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
var _MS_REPORTING_REVIEW_MARKERS = ['TE'+'ST', 'RO'+'UND', 'DR'+'AFT', 'RE'+'VIEW', 'IN'+'TERNAL', 'PRE'+'VIEW'];
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
  var excludedCount = allPhotos.length - approvedCount;
  var html = '';
  // Count line (matches the ref .photocount).
  html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-bottom:8px;">';
  html += approvedCount + ' of ' + allPhotos.length + ' photos approved';
  if (excludedCount > 0) html += ' &middot; ' + excludedCount + ' excluded';
  html += '. ';
  if (approvedCount === 0) {
    html += '<strong style="color:#B91C1C;">At least one photo must be approved to send.</strong>';
  }
  html += '</div>';
  // Wider tiles (120x88) with green outline (approved) / red outline + dimmed
  // (excluded) and a corner marker — matches the ref .ph / .ph.ok / .ph.no.
  html += '<div style="display:flex;flex-wrap:wrap;gap:10px;">';
  allPhotos.forEach(function(p) {
    var isApproved = !!state.approved[p.url];
    var safeUrl = escapeAttr(p.url);          // for src="..." (HTML attribute context)
    var jsUrl = _msJsAttr(p.url);             // for onclick fn('...') (JS-string-in-attr)
    var jsJobId = _msJsAttr(jobId);           // UUID, but escaped fail-closed
    var outline = isApproved ? '3px solid #5E8B6E' : '3px solid #E74C3C';
    var opacity = isApproved ? '1' : '0.5';
    html += '<div style="position:relative;width:120px;height:88px;border-radius:8px;overflow:hidden;outline:' + outline + ';opacity:' + opacity + ';cursor:pointer;flex-shrink:0;background:#5b6b73;"'
      + ' onclick="_msTogglePhotoApproval(\'' + jsJobId + '\',\'' + jsUrl + '\')"'
      + ' title="' + (isApproved ? 'Click to exclude' : 'Click to include') + '">';
    html += '<img src="' + safeUrl + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';
    html += '<div style="position:absolute;top:5px;right:5px;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;background:' + (isApproved ? '#5E8B6E' : '#E74C3C') + ';">'
      + (isApproved ? '&#10003;' : '&times;') + '</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

/**
 * Build the outer photo-approval container (heading + section div with id for re-render).
 * Kept for any caller that wants the labelled card; the integrated review screen uses
 * _msRenderPhotoApprovalBody instead (it supplies its own section label).
 */
function _msRenderPhotoApproval(d, jobId) {
  var allPhotos = _msGetAllPhotos(d);
  var html = '';
  html += '<div style="margin-bottom:8px;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Photo approval';
  if (allPhotos.length > 0) {
    html += ' <span style="font-size:10px;font-weight:600;color:#B91C1C;">(mandatory)</span>';
  }
  html += '</div>';
  html += _msRenderPhotoApprovalBody(d, jobId);
  return html;
}

/**
 * The photo-approval section body only (no heading) — the re-renderable container
 * with the stable section id. Used by the integrated review screen which supplies its
 * own "Photos — approve which go in the pack (mandatory)" section label.
 */
function _msRenderPhotoApprovalBody(d, jobId) {
  var safeJobIdAttr = escapeAttr(jobId).replace(/-/g, '_');
  return '<div id="msPhotoApprovalSection_' + safeJobIdAttr + '">' + _msRenderPhotoApprovalInner(d, jobId) + '</div>';
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
  // Portal builders submit manually (no email) — the portal button is never gated on
  // recipient/invoice, only on the photo gate (the photos still go in the pack).
  var isPortal = _msIsPortalBuilder(d);
  // If photos exist but none approved, disable send
  if (hasPhotos && !hasApproved) {
    btn.disabled = true;
    btn.style.opacity = '0.45';
    btn.style.cursor = 'not-allowed';
    btn.title = 'Approve at least one photo to send';
  } else {
    var canSend = isPortal ? true : (!!d.recipient_email && !!d.invoice);
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
  // MUST mirror the backend _isMakesafeWesternCompany (ops-api index.ts) exactly so
  // the UI and the send path agree on who is a portal builder. Backend matches:
  //   slug: builderwest / western-building
  //   name: builderwest / western building
  //   ref:  BWCWA* or WB-<digit> / WB <digit>
  var name = String((d.builder || d.requesting_company_name || '')).toLowerCase();
  var slug = String(d.requesting_company_slug || '').toLowerCase();
  var ref = String(d.external_ref || '').toUpperCase();
  if (slug.indexOf('builderwest') >= 0 || slug.indexOf('western-building') >= 0) return true;
  if (name.indexOf('builderwest') >= 0 || name.indexOf('western building') >= 0) return true;
  if (ref.indexOf('BWCWA') === 0 || /\bWB[-\s]?\d/.test(ref)) return true;
  return false;
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
