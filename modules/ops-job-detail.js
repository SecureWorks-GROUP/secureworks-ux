// ════════════════════════════════════════════════════════════
// JOB DETAIL SLIDE PANEL (legacy peek — used by Today/Calendar)
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// LIGHTBOX — full-screen photo/video gallery
// ════════════════════════════════════════════════════════════

var _lbState = { items: [], idx: 0, overlay: null, touchStartX: 0 };

function openLightbox(mediaArray, startIndex) {
  if (!mediaArray || mediaArray.length === 0) return;
  _lbState.items = mediaArray;
  _lbState.idx = startIndex || 0;

  var ov = document.createElement('div');
  ov.className = 'sw-lb-overlay';
  ov.innerHTML = '<button class="sw-lb-close" aria-label="Close">&times;</button>' +
    '<span class="sw-lb-counter"></span>' +
    (mediaArray.length > 1 ? '<button class="sw-lb-nav sw-lb-prev" aria-label="Previous">&#8249;</button><button class="sw-lb-nav sw-lb-next" aria-label="Next">&#8250;</button>' : '') +
    '<div class="sw-lb-media"></div>' +
    '<div class="sw-lb-info"><div class="sw-lb-label"></div><div class="sw-lb-meta"></div></div>';

  ov.querySelector('.sw-lb-close').onclick = closeLightbox;
  if (mediaArray.length > 1) {
    ov.querySelector('.sw-lb-prev').onclick = function() { _lbNav(-1); };
    ov.querySelector('.sw-lb-next').onclick = function() { _lbNav(1); };
  }

  // Close on background click
  ov.addEventListener('click', function(e) {
    if (e.target === ov || e.target.classList.contains('sw-lb-media')) closeLightbox();
  });

  // Touch swipe
  ov.addEventListener('touchstart', function(e) {
    _lbState.touchStartX = e.touches[0].clientX;
  }, { passive: true });
  ov.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - _lbState.touchStartX;
    if (Math.abs(dx) > 50) _lbNav(dx < 0 ? 1 : -1);
  });

  // Keyboard
  document.addEventListener('keydown', _lbKeyHandler);

  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  _lbState.overlay = ov;
  _lbRender();
}

function closeLightbox() {
  if (_lbState.overlay) {
    _lbState.overlay.remove();
    _lbState.overlay = null;
  }
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _lbKeyHandler);
}

function _lbKeyHandler(e) {
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') _lbNav(-1);
  else if (e.key === 'ArrowRight') _lbNav(1);
}

function _lbNav(dir) {
  if (_lbState.items.length <= 1) return;
  _lbState.idx = (_lbState.idx + dir + _lbState.items.length) % _lbState.items.length;
  _lbRender();
}

function _lbRender() {
  var ov = _lbState.overlay;
  if (!ov) return;
  var item = _lbState.items[_lbState.idx];
  var src = item.storage_url || item.url || '';
  var isVideo = (item.type === 'video') || /\.(mp4|mov|webm|avi)$/i.test(src);

  var mediaEl = ov.querySelector('.sw-lb-media');
  if (isVideo) {
    mediaEl.innerHTML = '<video src="' + escapeHtml(src) + '" controls autoplay playsinline style="max-width:100%;max-height:100%;border-radius:4px;"></video>';
  } else {
    mediaEl.innerHTML = '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(item.label || '') + '">';
  }

  ov.querySelector('.sw-lb-counter').textContent = (_lbState.idx + 1) + ' / ' + _lbState.items.length;

  var labelEl = ov.querySelector('.sw-lb-label');
  var metaEl = ov.querySelector('.sw-lb-meta');
  var labelHtml = '';
  if (item.phase) labelHtml += '<span class="sw-lb-phase">' + escapeHtml(item.phase) + '</span>';
  labelHtml += escapeHtml(item.label || item.file_name || '');
  labelEl.innerHTML = labelHtml;
  metaEl.textContent = item.created_at ? fmtDate(item.created_at) : '';
}

function confirmEditScope(url) {
  if (confirm('This will open the scope in the live editor with current pricing.\n\nAuto-save is active \u2014 any changes will overwrite the original scope.\n\nContinue?')) {
    window.open(url, '_blank');
  }
}

// ════════════════════════════════════════════════════════════
// SCOPE SNAPSHOT VIEWER — read-only frozen view of scope + pricing
// ════════════════════════════════════════════════════════════

function openScopeSnapshot(jobOrData) {
  var j = jobOrData.job || jobOrData;
  var docs = jobOrData.documents || [];
  var scope = typeof j.scope_json === 'string' ? JSON.parse(j.scope_json) : j.scope_json;
  var pricing = j.pricing_json || null;
  var config = scope ? (scope.config || scope) : {};

  document.getElementById('scopeSnapshotTitle').textContent =
    (j.job_number || '') + ' \u2014 Scope Snapshot' + (j.client_name ? ' \u2014 ' + j.client_name : '');
  document.getElementById('scopeSnapshotModal').classList.add('active');

  var html = '';

  // ── Warning if no pricing snapshot ──
  if (!pricing) {
    html += '<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:4px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#92400E;">' +
      '\u26A0 No pricing snapshot available for this job. This scope was saved before pricing capture was implemented. Prices shown in the scoping tool may differ from the original quote.</div>';
  }

  // ── Pricing summary (frozen) ──
  if (pricing) {
    var totalInc = pricing.totalIncGST || pricing.total || 0;
    var totalEx = pricing.totalExGST || 0;
    var margin = pricing.margin_pct || 0;
    var matCost = pricing.materialCostEstimate || 0;
    var labCost = pricing.labourCostEstimate || 0;
    var genAt = pricing.generated_at ? new Date(pricing.generated_at).toLocaleDateString('en-AU') : '';

    html += '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Frozen Pricing' + (genAt ? ' \u2014 ' + genAt : '') + '</div>';
    html += '<div style="display:flex;gap:16px;align-items:baseline;margin-bottom:8px;">';
    html += '<span style="font-size:22px;font-weight:700;color:var(--sw-green);font-family:var(--sw-font-num);">' + fmt$(totalInc) + ' <span style="font-size:12px;color:var(--sw-text-sec);font-weight:400;">inc GST</span></span>';
    if (totalEx) html += '<span style="font-size:14px;color:var(--sw-text-sec);font-family:var(--sw-font-num);">' + fmt$(totalEx) + ' ex GST</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:16px;font-size:12px;color:var(--sw-text-sec);">';
    if (matCost) html += '<span>Materials: ' + fmt$(matCost) + '</span>';
    if (labCost) html += '<span>Labour: ' + fmt$(labCost) + '</span>';
    if (margin) html += '<span>Margin: ' + margin.toFixed(1) + '%</span>';
    html += '</div>';

    // Deposit
    if (pricing.deposit && pricing.deposit.total_deposit_inc_gst) {
      html += '<div style="margin-top:8px;font-size:12px;color:var(--sw-dark);">Deposit: ' + fmt$(pricing.deposit.total_deposit_inc_gst) + ' (' + (pricing.deposit.percent || 0) + '%' + (pricing.deposit.council_fees ? ' + $' + pricing.deposit.council_fees + ' council' : '') + ')</div>';
    }

    // Line items
    if (pricing.line_items && pricing.line_items.length > 0) {
      html += '<details style="margin-top:10px;"><summary style="font-size:11px;font-weight:600;color:var(--sw-mid);cursor:pointer;text-transform:uppercase;letter-spacing:0.5px;">Line Items (' + pricing.line_items.length + ')</summary>';
      html += '<table style="width:100%;font-size:11px;margin-top:6px;border-collapse:collapse;">';
      html += '<tr style="border-bottom:1px solid var(--sw-border);"><th style="text-align:left;padding:4px 6px;color:var(--sw-mid);">Item</th><th style="text-align:right;padding:4px 6px;color:var(--sw-mid);">Qty</th><th style="text-align:right;padding:4px 6px;color:var(--sw-mid);">Cost</th><th style="text-align:right;padding:4px 6px;color:var(--sw-mid);">Sell</th></tr>';
      pricing.line_items.forEach(function(li) {
        html += '<tr style="border-bottom:1px solid var(--sw-border);">';
        html += '<td style="padding:3px 6px;">' + escapeHtml(li.description || '') + '</td>';
        html += '<td style="padding:3px 6px;text-align:right;">' + (li.quantity || '') + '</td>';
        html += '<td style="padding:3px 6px;text-align:right;">' + fmt$(li.total_cost || 0) + '</td>';
        html += '<td style="padding:3px 6px;text-align:right;">' + fmt$(li.total_sell || 0) + '</td>';
        html += '</tr>';
      });
      html += '</table></details>';
    }
    html += '</div>';
  }

  // ── Scope inputs ──
  if (scope) {
    html += '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Scope Inputs</div>';

    if (j.type === 'fencing') {
      html += renderScopeSummary(j.scope_json, 'fencing', j.id);
    } else {
      // Patio scope detail
      var badgeStyle = 'display:inline-block;font-size:11px;font-weight:600;padding:3px 8px;margin:2px 3px 2px 0;background:var(--sw-light);color:var(--sw-dark);border-left:3px solid var(--sw-mid);';
      if (config.length || config.projection) {
        html += '<div style="font-size:14px;font-weight:600;margin-bottom:6px;">' + (config.length || '?') + 'm \u00D7 ' + (config.projection || '?') + 'm';
        if (config.length && config.projection) html += ' (' + (config.length * config.projection).toFixed(1) + 'm\u00B2)';
        html += '</div>';
      }
      html += '<div style="margin:6px 0;flex-wrap:wrap;">';
      if (config.roofStyle) html += '<span style="' + badgeStyle + '">' + escapeHtml(config.roofStyle) + '</span>';
      if (config.roofing) html += '<span style="' + badgeStyle + '">' + escapeHtml(config.roofing) + '</span>';
      if (config.connection) html += '<span style="' + badgeStyle + '">' + escapeHtml(config.connection) + '</span>';
      if (config.sheetColor) html += '<span style="' + badgeStyle + 'border-color:var(--sw-orange);">' + escapeHtml(config.sheetColor) + '</span>';
      if (config.steelColor) html += '<span style="' + badgeStyle + '">Steel: ' + escapeHtml(config.steelColor) + '</span>';
      if (config.ceilingFinish) html += '<span style="' + badgeStyle + '">Ceiling: ' + escapeHtml(config.ceilingFinish) + '</span>';
      html += '</div>';

      // Structure details
      var details = [];
      if (config.postSize) details.push('Posts: ' + config.postSize);
      if (config.posts) details.push(config.posts + ' posts');
      if (config.beamSize) details.push('Beams: ' + config.beamSize);
      if (config.pitch) details.push('Pitch: ' + config.pitch + '\u00B0');
      if (config.postHeight) details.push('Post height: ' + config.postHeight + 'm');
      if (config.infill) details.push('Infill: ' + config.infill);
      if (details.length > 0) {
        html += '<div style="font-size:12px;color:var(--sw-text-sec);line-height:1.6;margin-top:4px;">' + details.join(' &middot; ') + '</div>';
      }

      // Complexity
      var cx = scope.complexity;
      if (cx && (cx.build || cx.access || cx.height || cx.footing || cx.distance)) {
        html += '<div style="margin-top:8px;font-size:11px;color:var(--sw-mid);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Complexity</div>';
        html += '<div style="display:flex;gap:12px;margin-top:4px;font-size:12px;">';
        ['build','access','height','footing','distance'].forEach(function(k) {
          if (cx[k]) html += '<span>' + k.charAt(0).toUpperCase() + k.slice(1) + ': <strong>' + cx[k] + '/5</strong></span>';
        });
        html += '</div>';
      }

      // Notes
      var notes = scope.notes;
      if (notes) {
        var noteList = [];
        if (notes.noteQuote) noteList.push({ label: 'Quote Note', text: notes.noteQuote });
        if (notes.noteInternal) noteList.push({ label: 'Internal', text: notes.noteInternal });
        if (notes.pricingNotes) noteList.push({ label: 'Pricing', text: notes.pricingNotes });
        if (noteList.length > 0) {
          html += '<div style="margin-top:8px;">';
          noteList.forEach(function(n) {
            html += '<div style="font-size:11px;color:var(--sw-mid);font-weight:600;margin-top:6px;">' + n.label + '</div>';
            html += '<div style="font-size:12px;color:var(--sw-text);white-space:pre-wrap;">' + escapeHtml(n.text) + '</div>';
          });
          html += '</div>';
        }
      }

      // Scope extras
      var sc = scope.scope;
      if (sc) {
        var extras = [];
        if (sc.elecDownlights && sc.elecDownlightsQty) extras.push(sc.elecDownlightsQty + ' downlights');
        if (sc.elecFan && sc.elecFanQty) extras.push(sc.elecFanQty + ' fan(s)');
        if (sc.elecGPO && sc.elecGPOQty) extras.push(sc.elecGPOQty + ' GPO(s)');
        if (sc.scopeDemo) extras.push('Demo required');
        if (sc.scopePermit) extras.push('Permit required');
        if (extras.length > 0) {
          html += '<div style="margin-top:8px;font-size:12px;color:var(--sw-text);">' + extras.join(' &middot; ') + '</div>';
        }
      }
    }
    html += '</div>';
  } else {
    html += '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);color:var(--sw-text-sec);font-size:13px;">No scope data saved for this job.</div>';
  }

  // ── Quote PDF links ──
  var quoteDocs = docs.filter(function(d) { return d.type === 'quote'; });
  if (quoteDocs.length > 0) {
    html += '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Quote PDFs</div>';
    quoteDocs.forEach(function(doc) {
      var url = doc.storage_url || doc.pdf_url;
      var name = doc.file_name || ('Quote v' + (doc.version || 1));
      var sent = doc.sent_to_client ? ' \u2714 Sent' : '';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;">';
      html += '<a href="' + url + '" target="_blank" style="color:var(--sw-mid);font-weight:600;">\uD83D\uDCC4 ' + escapeHtml(name) + '</a>';
      if (doc.quote_number) html += '<span style="color:var(--sw-text-sec);">' + doc.quote_number + '</span>';
      if (sent) html += '<span style="color:var(--sw-green);font-size:11px;">' + sent + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  // ── Scope photos ──
  var snapshotMedia = (jobOrData.media || []).filter(function(m) { return m.phase !== 'receipt'; });
  if (snapshotMedia.length > 0) {
    window._snapshotPhotos = snapshotMedia;
    html += '<div style="font-size:12px;font-weight:700;margin-top:12px;margin-bottom:6px;">Site Photos (' + snapshotMedia.length + ')</div>';
    html += '<div class="jd-photo-grid" style="grid-template-columns:repeat(auto-fill,minmax(80px,1fr));">';
    snapshotMedia.forEach(function(m, idx) {
      var src = m.thumbnail_url || m.storage_url;
      html += '<div class="jd-photo-item">';
      html += '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(m.label || '') + '" onclick="openLightbox(window._snapshotPhotos,' + idx + ')">';
      if (m.label || m.phase) html += '<span class="jd-photo-phase">' + escapeHtml(m.label || m.phase) + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  // ── Metadata ──
  html += '<div style="font-size:11px;color:var(--sw-text-sec);padding-top:4px;">';
  if (scope && scope._exported) html += 'Scope saved: ' + new Date(scope._exported).toLocaleString('en-AU') + '<br>';
  if (scope && scope._version) html += 'Tool version: ' + scope._version + '<br>';
  if (pricing && pricing.generated_at) html += 'Pricing snapshot: ' + new Date(pricing.generated_at).toLocaleString('en-AU');
  html += '</div>';

  document.getElementById('scopeSnapshotBody').innerHTML = html;
}

async function openJobPeek(jobId) {
  document.getElementById('slidePanel').classList.add('open');
  document.getElementById('slideBackdrop').classList.add('open');
  document.getElementById('slidePanelBody').innerHTML = '<div class="loading">Loading job details...</div>';

  try {
    var data = await opsFetch('job_detail', { jobId: jobId });
    renderJobPeek(data);
  } catch (e) {
    document.getElementById('slidePanelBody').innerHTML = '<div style="color:var(--sw-red); padding:20px;">Error: ' + e.message + '</div>';
  }
}

function closeSlidePanel() {
  document.getElementById('slidePanel').classList.remove('open');
  document.getElementById('slideBackdrop').classList.remove('open');
}

function togglePeekQuoteDetail(el) {
  var detail = el.querySelector('.peek-quote-detail');
  if (detail) detail.style.display = detail.style.display === 'none' ? '' : 'none';
}

function togglePeekInvoiceDetail(el) {
  var detail = el.querySelector('.peek-inv-detail');
  if (detail) detail.style.display = detail.style.display === 'none' ? '' : 'none';
}

var _peekData = null;
function renderJobPeek(data) {
  _peekData = data;
  var j = data.job;
  var title = (j.job_number || '') + (j.job_number ? ' — ' : '') + (j.client_name || 'Unknown') + ' — ' + (j.site_suburb || '');
  document.getElementById('slidePanelTitle').textContent = title;

  var html = '';

  // Job info + external links
  html += '<div style="margin-bottom:16px;">';
  html += '<div style="display:flex; gap:8px; margin-bottom:8px; align-items:center; flex-wrap:wrap;">';
  html += '<span class="type-badge ' + j.type + '">' + typeBadgeLabel(j.type) + '</span>';
  html += '<span class="status-badge ' + j.status + '">' + (STATUS_LABELS[j.status] || j.status) + '</span>';
  // External link buttons
  if (j.ghl_opportunity_id) {
    html += '<a href="https://app.maxlead.com.au/v2/location/' + GHL_LOCATION_ID + '/opportunities/' + j.ghl_opportunity_id + '" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 8px; text-decoration:none;">View in GHL &#8599;</a>';
  }
  if (j.type !== 'miscellaneous') {
    var scopeToolUrl = j.type === 'fencing' ? 'https://secureworks-group.github.io/fence-designer/' : 'https://secureworks-group.github.io/patio/';
    html += '<a href="#" onclick="openScopeSnapshot(_peekData);return false;" class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 8px; text-decoration:none;">Snapshot &#128248;</a>';
    html += '<a href="' + scopeToolUrl + '?jobId=' + j.id + '&mode=readonly" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 8px; text-decoration:none;">View Scope &#8599;</a>';
    html += '<a href="#" onclick="confirmEditScope(\'' + scopeToolUrl + '?jobId=' + j.id + '\');return false;" class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 8px; text-decoration:none; color:var(--sw-orange);">Edit Scope &#9998;</a>';
  }
  html += '</div>';
  if (j.site_address) html += '<div style="font-size:13px; margin-bottom:4px;">' + j.site_address + '</div>';
  if (j.client_phone) html += '<div style="font-size:13px; color:var(--sw-text-sec);">Phone: <a href="tel:' + j.client_phone + '">' + j.client_phone + '</a></div>';
  if (j.client_email) html += '<div style="font-size:13px; color:var(--sw-text-sec);">Email: <a href="mailto:' + j.client_email + '">' + j.client_email + '</a></div>';

  var val = j.pricing_json?.totalIncGST || j.pricing_json?.total;
  if (val) html += '<div style="font-size:15px; font-weight:700; margin-top:8px; color:var(--sw-green);">' + fmt$(val) + '</div>';
  html += '</div>';

  // ── Financials mini-section ──
  var quoteVal = j.pricing_json?.totalIncGST || j.pricing_json?.total || 0;
  var poCostsTotal = (data.purchase_orders || []).reduce(function(s, po) { return s + (po.total || 0); }, 0);
  // Only count ACCREC (sales) invoices, exclude voided/deleted
  var salesInvoices = (data.invoices || []).filter(function(inv) {
    return inv.invoice_type === 'ACCREC' && ['VOIDED','DELETED'].indexOf(inv.status) < 0;
  });
  var invoicedTotal = salesInvoices.reduce(function(s, inv) { return s + (parseFloat(inv.total) || 0); }, 0);
  var invoicePaid = salesInvoices.reduce(function(s, inv) { return s + (parseFloat(inv.amount_paid) || 0); }, 0);
  var invoiceRemaining = Math.max(0, quoteVal - invoicedTotal);
  if (quoteVal > 0 || poCostsTotal > 0 || invoicedTotal > 0) {
    var margin = quoteVal > 0 ? ((quoteVal - poCostsTotal) / quoteVal * 100) : 0;
    var marginColor = margin >= 25 ? 'var(--sw-green)' : margin >= 15 ? 'var(--sw-yellow)' : 'var(--sw-red)';
    html += '<div style="margin-bottom:16px; padding:10px; background:var(--sw-light); border-radius:8px; font-size:12px;">';
    html += '<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Quote value</span><strong>' + fmt$(quoteVal) + '</strong></div>';
    // Cost estimate from pricing_json vs actual PO spend
    var costEstimate = j.pricing_json?.costEstimate || j.pricing_json?.totalCost || j.pricing_json?.cost || 0;
    if (costEstimate > 0) {
      html += '<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span>Est. costs</span><strong style="color:var(--sw-text-sec);">' + fmt$(costEstimate) + '</strong></div>';
      var costDiff = poCostsTotal - costEstimate;
      var costDiffLabel = costDiff > 0 ? 'Over by ' + fmt$(costDiff) : costDiff < 0 ? 'Under by ' + fmt$(Math.abs(costDiff)) : 'On target';
      var costDiffColor = costDiff > 0 ? 'var(--sw-red)' : 'var(--sw-green)';
      html += '<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>PO costs (actual)</span><strong style="color:var(--sw-red);">' + fmt$(poCostsTotal) + ' <span style="font-size:10px; color:' + costDiffColor + '">(' + costDiffLabel + ')</span></strong></div>';
    } else {
      html += '<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>PO costs</span><strong style="color:var(--sw-red);">' + fmt$(poCostsTotal) + '</strong></div>';
    }
    // Invoice running total with progress bar
    html += '<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span>Invoiced</span><strong>' + fmt$(invoicedTotal) + '</strong></div>';
    if (quoteVal > 0) {
      var invPct = Math.min(100, invoicedTotal / quoteVal * 100);
      html += '<div style="height:4px; background:#e0e0e0; border-radius:2px; overflow:hidden; margin-bottom:4px;">';
      html += '<div style="height:100%; width:' + invPct + '%; background:var(--sw-green); border-radius:2px;"></div></div>';
    }
    html += '<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span>Collected</span><strong style="color:var(--sw-green);">' + fmt$(invoicePaid) + '</strong></div>';
    html += '<div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Still to invoice</span><strong style="color:' + (invoiceRemaining > 0 ? 'var(--sw-orange)' : 'var(--sw-green)') + ';">' + fmt$(invoiceRemaining) + '</strong></div>';
    if (quoteVal > 0) {
      var barPct = Math.min(100, poCostsTotal / quoteVal * 100);
      html += '<div style="height:6px; background:#e0e0e0; border-radius:3px; overflow:hidden;">';
      html += '<div style="height:100%; width:' + barPct + '%; background:' + marginColor + '; border-radius:3px;"></div></div>';
      html += '<div style="text-align:right; margin-top:2px; font-weight:600; color:' + marginColor + ';">Margin: ' + margin.toFixed(0) + '%</div>';
    }
    html += '</div>';
  }

  // ── Quotes Section ──
  var quoteDocs = (data.documents || []).filter(function(d) { return d.type === 'quote'; });
  if (quoteDocs.length > 0) {
    html += '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Quotes (' + quoteDocs.length + ')</div>';
    quoteDocs.forEach(function(doc, idx) {
      var statusLabel = doc.accepted_at ? 'Accepted' : doc.sent_to_client ? (doc.viewed_at ? 'Viewed' : 'Sent') : 'Draft';
      var statusBg = doc.accepted_at ? 'var(--sw-green)' : doc.sent_to_client ? '#2196F3' : '#e0e0e0';
      var statusColor = doc.accepted_at || doc.sent_to_client ? '#fff' : '#333';
      var quoteNum = doc.quote_number || ('v' + (doc.version || 1));
      var quoteTotal = doc.data_snapshot_json?.totalIncGST || doc.data_snapshot_json?.total || '';
      var url = doc.storage_url || doc.pdf_url;
      var shareUrl = doc.share_token ? 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/send-quote/view?token=' + encodeURIComponent(doc.share_token) : url;

      html += '<div style="border:1px solid var(--sw-border);padding:10px;margin-bottom:6px;cursor:pointer;" onclick="togglePeekQuoteDetail(this)">';
      // Quote row header
      html += '<div style="display:flex;align-items:center;gap:8px;font-size:13px;">';
      html += '<span style="font-weight:600;">' + escapeHtml(quoteNum) + '</span>';
      html += '<span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:600;background:' + statusBg + ';color:' + statusColor + ';">' + statusLabel + '</span>';
      if (doc.sent_at) html += '<span style="color:var(--sw-text-sec);font-size:11px;">' + fmtDate(doc.sent_at) + '</span>';
      if (quoteTotal) html += '<span style="margin-left:auto;font-weight:700;font-family:var(--sw-font-num);">' + fmt$(quoteTotal) + '</span>';
      html += '</div>';

      // Expandable quote detail (hidden by default)
      html += '<div class="peek-quote-detail" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--sw-border);" onclick="event.stopPropagation();">';
      // Line items from data_snapshot_json
      var snapItems = doc.data_snapshot_json?.items || doc.data_snapshot_json?.lineItems || [];
      if (snapItems.length > 0) {
        html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">';
        html += '<thead><tr style="border-bottom:1px solid var(--sw-border);text-align:left;"><th style="padding:3px 4px;">Description</th><th style="padding:3px 4px;text-align:center;width:35px;">Qty</th><th style="padding:3px 4px;text-align:right;width:65px;">Price</th><th style="padding:3px 4px;text-align:right;width:65px;">Total</th></tr></thead><tbody>';
        snapItems.forEach(function(item) {
          var iDesc = item.description || item.name || '';
          var iQty = item.quantity || item.qty || 1;
          var iPrice = item.unit_price || item.unitPrice || item.price || 0;
          html += '<tr style="border-bottom:1px solid var(--sw-border);">';
          html += '<td style="padding:3px 4px;">' + escapeHtml(iDesc) + '</td>';
          html += '<td style="padding:3px 4px;text-align:center;">' + iQty + '</td>';
          html += '<td style="padding:3px 4px;text-align:right;font-family:var(--sw-font-num);">' + fmt$(iPrice) + '</td>';
          html += '<td style="padding:3px 4px;text-align:right;font-family:var(--sw-font-num);">' + fmt$(iQty * iPrice) + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table>';
      }
      // Totals
      var snapTotal = doc.data_snapshot_json?.totalIncGST || doc.data_snapshot_json?.total || 0;
      var snapTotalEx = Math.round((snapTotal / 1.1) * 100) / 100;
      var snapGst = Math.round((snapTotal - snapTotalEx) * 100) / 100;
      html += '<div style="display:flex;justify-content:flex-end;font-size:12px;gap:12px;">';
      html += '<span style="color:var(--sw-text-sec);">Ex GST: <strong>' + fmt$(snapTotalEx) + '</strong></span>';
      html += '<span style="color:var(--sw-text-sec);">GST: <strong>' + fmt$(snapGst) + '</strong></span>';
      html += '<span style="font-weight:700;">Inc GST: <strong>' + fmt$(snapTotal) + '</strong></span>';
      html += '</div>';
      // Action buttons
      html += '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">';
      if (shareUrl) {
        html += '<a href="' + escapeHtml(shareUrl) + '" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px;text-decoration:none;">View PDF</a>';
      }
      if (doc.accepted_at && ['accepted','approvals','deposit','processing','scheduled','in_progress','complete'].indexOf(j.status) >= 0) {
        html += '<button class="btn btn-sm" onclick="event.stopPropagation();createInvoiceFromQuote(\'' + j.id + '\',\'' + doc.id + '\')" style="background:var(--sw-green);color:#fff;font-size:11px;font-weight:600;">Create Invoice from Quote</button>';
      }
      html += '</div>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  // ── Invoices Section ──
  var peekInvoices = (data.invoices || []).filter(function(inv) {
    return inv.invoice_type === 'ACCREC' && ['VOIDED','DELETED'].indexOf(inv.status) < 0;
  });
  if (peekInvoices.length > 0) {
    html += '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Invoices (' + peekInvoices.length + ')</div>';
    peekInvoices.forEach(function(inv) {
      var isPaid = inv.status === 'PAID';
      var isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && ['AUTHORISED','SUBMITTED','SENT'].indexOf(inv.status) >= 0;
      var isDraft = inv.status === 'DRAFT';
      var amountDue = parseFloat(inv.amount_due) || (parseFloat(inv.total) - parseFloat(inv.amount_paid || 0));
      var amountPaid = parseFloat(inv.amount_paid) || 0;

      var sBg, sColor;
      if (isOverdue) { sBg = 'var(--sw-red)'; sColor = '#fff'; }
      else if (isDraft) { sBg = '#e0e0e0'; sColor = '#333'; }
      else if (inv.status === 'AUTHORISED') { sBg = '#2196F3'; sColor = '#fff'; }
      else if (isPaid) { sBg = 'var(--sw-green)'; sColor = '#fff'; }
      else { sBg = 'var(--sw-orange)'; sColor = '#fff'; }
      var sLabel = isOverdue ? 'OVERDUE' : inv.status;

      var xeroLink = inv.xero_invoice_id ? 'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=' + inv.xero_invoice_id : '';

      html += '<div style="border:1px solid var(--sw-border);padding:10px;margin-bottom:6px;cursor:pointer;" onclick="togglePeekInvoiceDetail(this)">';
      // Invoice row header
      html += '<div style="display:flex;align-items:center;gap:8px;font-size:13px;">';
      html += '<span style="font-weight:600;">' + (inv.invoice_number || 'Draft') + '</span>';
      html += '<span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:600;background:' + sBg + ';color:' + sColor + ';">' + sLabel + '</span>';
      if (inv.due_date) html += '<span style="color:var(--sw-text-sec);font-size:11px;">Due ' + fmtDate(inv.due_date) + '</span>';
      html += '<span style="margin-left:auto;font-weight:700;font-family:var(--sw-font-num);">' + fmt$(inv.total) + '</span>';
      html += '</div>';
      // Paid/owing summary
      if (!isDraft) {
        html += '<div style="display:flex;gap:12px;font-size:11px;margin-top:4px;color:var(--sw-text-sec);">';
        html += '<span>Paid: <strong style="color:var(--sw-green);">' + fmt$(amountPaid) + '</strong></span>';
        if (amountDue > 0) html += '<span>Owing: <strong style="color:' + (isOverdue ? 'var(--sw-red)' : 'var(--sw-dark)') + ';">' + fmt$(amountDue) + '</strong></span>';
        html += '</div>';
      }

      // Expandable invoice detail (hidden by default)
      html += '<div class="peek-inv-detail" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--sw-border);" onclick="event.stopPropagation();">';
      var lineItems = inv.line_items || [];
      if (Array.isArray(lineItems) && lineItems.length > 0) {
        html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">';
        html += '<thead><tr style="border-bottom:1px solid var(--sw-border);text-align:left;"><th style="padding:3px 4px;">Description</th><th style="padding:3px 4px;text-align:center;width:35px;">Qty</th><th style="padding:3px 4px;text-align:right;width:65px;">Price</th><th style="padding:3px 4px;text-align:right;width:65px;">Total</th></tr></thead><tbody>';
        lineItems.forEach(function(li) {
          var desc = li.Description || li.description || '';
          var qty = li.Quantity || li.quantity || 1;
          var unitPrice = li.UnitAmount || li.unit_price || 0;
          var lineTotal = li.LineAmount || li.total || (qty * unitPrice);
          html += '<tr style="border-bottom:1px solid var(--sw-border);">';
          html += '<td style="padding:3px 4px;">' + escapeHtml(desc) + '</td>';
          html += '<td style="padding:3px 4px;text-align:center;">' + qty + '</td>';
          html += '<td style="padding:3px 4px;text-align:right;font-family:var(--sw-font-num);">' + fmt$(unitPrice) + '</td>';
          html += '<td style="padding:3px 4px;text-align:right;font-family:var(--sw-font-num);">' + fmt$(lineTotal) + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table>';
      }
      // Totals
      html += '<div style="display:flex;justify-content:flex-end;font-size:12px;gap:12px;">';
      html += '<span style="color:var(--sw-text-sec);">Ex GST: <strong>' + fmt$(inv.sub_total || 0) + '</strong></span>';
      html += '<span style="color:var(--sw-text-sec);">GST: <strong>' + fmt$(inv.total_tax || 0) + '</strong></span>';
      html += '<span style="font-weight:700;">Total: <strong>' + fmt$(inv.total) + '</strong></span>';
      html += '</div>';
      // Action buttons
      html += '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">';
      if (xeroLink) html += '<a href="' + xeroLink + '" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px;text-decoration:none;">Open in Xero &#8599;</a>';
      if (isDraft) html += '<button class="btn btn-sm" onclick="event.stopPropagation();closeSlidePanel();approveInvoice(\'' + inv.xero_invoice_id + '\',\'' + (inv.invoice_number || '') + '\',\'' + escapeHtml(j.client_email || '') + '\')" style="background:#2196F3;color:#fff;font-size:11px;">Approve</button>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  // Status actions + PO/Invoice buttons
  html += '<div style="margin-bottom:16px; display:flex; gap:6px; flex-wrap:wrap;">';
  var nextStatuses = getNextStatuses(j.status, j.type);
  nextStatuses.forEach(function(s) {
    html += '<button class="btn btn-secondary btn-sm" onclick="changeJobStatus(\'' + j.id + '\',\'' + s + '\')">' + STATUS_LABELS[s] + '</button>';
  });
  // PO and Invoice action buttons
  html += '<button class="btn btn-secondary btn-sm" onclick="closeSlidePanel(); openPOModal(\'' + j.id + '\')" style="border-color:var(--sw-purple); color:var(--sw-purple);">+ PO</button>';
  if (['accepted', 'approvals', 'deposit', 'processing', 'quoted', 'scheduled', 'in_progress', 'complete'].indexOf(j.status) >= 0) {
    html += '<button class="btn btn-secondary btn-sm" onclick="closeSlidePanel(); openUnifiedInvoiceModal(\'' + j.id + '\')" style="border-color:var(--sw-green); color:var(--sw-green);">+ Invoice</button>';
  }
  // Quick Quote shortcut: Accept & Create Deposit Invoice in one click
  if (j.status === 'quoted' && j.pricing_json && j.pricing_json.source === 'quick_quote') {
    html += '<button class="btn btn-sm" onclick="acceptAndDepositQuickQuote(\'' + j.id + '\')" style="background:var(--sw-green); color:#fff; font-weight:600;">Accept &amp; Deposit</button>';
  }
  // Mark Lost — available for quoted/accepted/scheduled jobs
  if (['quoted', 'accepted', 'approvals', 'deposit', 'processing', 'scheduled'].indexOf(j.status) >= 0) {
    html += '<button class="btn btn-secondary btn-sm" onclick="markJobLost(\'' + j.id + '\')" style="border-color:var(--sw-red); color:var(--sw-red); margin-left:auto;">Mark Lost</button>';
  }
  html += '</div>';

  // ── Scope Summary ──
  if (j.scope_json) {
    html += '<div class="panel-title" style="margin-top:16px;">Scope Summary</div>';
    html += renderScopeSummary(j.scope_json, j.type, j.id);
  }

  // Assignments
  html += '<div class="panel-title" style="margin-top:16px;">Assignments (' + data.assignments.length + ')</div>';
  if (data.assignments.length > 0) {
    data.assignments.forEach(function(a) {
      html += '<div style="padding:8px 0; border-bottom:1px solid var(--sw-border); font-size:13px; display:flex; align-items:center; gap:6px;">';
      html += '<div style="flex:1;">';
      html += '<strong>' + fmtDate(a.scheduled_date) + '</strong>';
      if (a.users?.name) html += ' — ' + a.users.name;
      if (a.crew_name) html += ' (' + cleanCrewName(a.crew_name) + ')';
      html += ' <span class="status-badge ' + a.status + '">' + a.status + '</span>';
      html += '</div>';
      if (a.status !== 'complete' && a.status !== 'cancelled') {
        html += '<button class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 8px; white-space:nowrap;" onclick="markAssignmentComplete(\'' + a.id + '\',\'' + j.id + '\')">&#9989; Complete</button>';
      }
      html += '</div>';
    });
  } else {
    html += '<div style="font-size:12px; color:var(--sw-text-sec); padding:8px 0;">No assignments</div>';
  }

  // POs
  if (data.purchase_orders && data.purchase_orders.length > 0) {
    html += '<div class="panel-title" style="margin-top:16px;">Purchase Orders (' + data.purchase_orders.length + ')</div>';
    data.purchase_orders.forEach(function(po) {
      html += '<div style="padding:8px 0; border-bottom:1px solid var(--sw-border); font-size:13px;">';
      html += '<strong>' + po.po_number + '</strong> — ' + po.supplier_name;
      html += ' <span class="status-badge ' + po.status + '">' + po.status + '</span>';
      html += ' ' + fmt$(po.total);
      html += '</div>';
    });
  }

  // WOs
  if (data.work_orders && data.work_orders.length > 0) {
    html += '<div class="panel-title" style="margin-top:16px;">Work Orders (' + data.work_orders.length + ')</div>';
    data.work_orders.forEach(function(wo) {
      html += '<div style="padding:8px 0; border-bottom:1px solid var(--sw-border); font-size:13px;">';
      html += '<strong>' + wo.wo_number + '</strong>';
      if (wo.trade_name) html += ' — ' + wo.trade_name;
      html += ' <span class="status-badge ' + wo.status + '">' + wo.status + '</span>';
      html += '</div>';
    });
  }

  // Photos — split into job photos and receipts
  if (data.media && data.media.length > 0) {
    var jobPhotos = data.media.filter(function(m) { return m.phase !== 'receipt'; });
    var receiptPhotos = data.media.filter(function(m) { return m.phase === 'receipt'; });

    // Store for lightbox in peek panel
    window._peekJobPhotos = jobPhotos;
    window._peekReceiptPhotos = receiptPhotos;

    if (jobPhotos.length > 0) {
      html += '<div class="panel-title" style="margin-top:16px;">Photos (' + jobPhotos.length + ')</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;">';
      jobPhotos.forEach(function(m, idx) {
        var src = m.thumbnail_url || m.storage_url;
        var phase = m.phase || '';
        html += '<div style="position:relative">';
        html += '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(m.label || phase) + '" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;cursor:pointer" onclick="openLightbox(window._peekJobPhotos,' + idx + ')">';
        if (phase) html += '<span style="position:absolute;bottom:2px;left:2px;font-size:9px;background:rgba(0,0,0,0.6);color:#fff;padding:1px 4px;border-radius:3px">' + phase + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    if (receiptPhotos.length > 0) {
      html += '<div class="panel-title" style="margin-top:16px;">Receipts (' + receiptPhotos.length + ')</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;">';
      var poLookup = {};
      (data.purchase_orders || []).forEach(function(po) { poLookup[po.id] = po.po_number; });
      receiptPhotos.forEach(function(m, idx) {
        var src = m.thumbnail_url || m.storage_url;
        var poLabel = m.po_id && poLookup[m.po_id] ? poLookup[m.po_id] : 'No PO';
        html += '<div style="position:relative">';
        html += '<img src="' + escapeHtml(src) + '" alt="Receipt" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;cursor:pointer" onclick="openLightbox(window._peekReceiptPhotos,' + idx + ')">';
        html += '<span style="position:absolute;bottom:2px;left:2px;font-size:9px;background:rgba(0,0,0,0.6);color:#fff;padding:1px 4px;border-radius:3px">' + poLabel + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
  }

  // Xero project
  if (data.xero_project) {
    html += '<div class="panel-title" style="margin-top:16px;">Xero Project</div>';
    html += '<div style="font-size:13px;">';
    html += '<div>' + (data.xero_project.project_name || '') + '</div>';
    html += '<div>Invoiced: ' + fmt$(data.xero_project.total_invoiced) + '</div>';
    html += '<div>Expenses: ' + fmt$(data.xero_project.total_expenses) + '</div>';
    var margin = data.xero_project.total_invoiced > 0
      ? ((data.xero_project.total_invoiced - data.xero_project.total_expenses) / data.xero_project.total_invoiced * 100).toFixed(0)
      : 0;
    html += '<div>Margin: ' + margin + '%</div>';
    html += '</div>';
  }

  // Council/Engineering section
  html += '<div id="jdCouncilSection"></div>';
  loadJobCouncilSection(data.job.id);

  // Timeline (chronological events)
  if (data.events && data.events.length > 0) {
    html += '<div class="panel-title" style="margin-top:16px;">Timeline</div>';
    html += '<div style="border-left:2px solid var(--sw-border); margin-left:8px; padding-left:12px;">';
    data.events.slice(0, 20).forEach(function(ev) {
      var label = formatEventType(ev.event_type, ev.detail_json);
      var dot = '&#9679;';
      html += '<div style="padding:4px 0; font-size:12px; position:relative;">';
      html += '<span style="position:absolute; left:-18px; color:var(--sw-text-sec); font-size:8px; top:6px;">' + dot + '</span>';
      html += '<strong style="color:var(--sw-text);">' + label + '</strong>';
      if (ev.users?.name) html += ' <span style="color:var(--sw-text-sec);">by ' + ev.users.name + '</span>';
      html += '<div style="font-size:11px; color:var(--sw-text-sec);">' + new Date(ev.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  document.getElementById('slidePanelBody').innerHTML = html;
}

async function loadJobCouncilSection(jobId) {
  var el = document.getElementById('jdCouncilSection');
  if (!el) return;
  try {
    var resp = await opsFetch('list_council_submissions', { job_id: jobId });
    var subs = resp.submissions || [];
    if (subs.length === 0) {
      // Show "Start Council Process" button for patio jobs
      var jd = _currentJobData ? _currentJobData.job : null;
      if (jd && jd.type === 'patio') {
        el.innerHTML = '<div style="margin-top:12px;">' +
          '<button class="btn btn-secondary" style="width:100%;font-size:12px;font-weight:600;" onclick="openCouncilStartModal(\'' + jobId + '\')">' +
          '&#127970; Start Council / Engineering Process</button></div>';
      } else {
        el.innerHTML = '';
      }
      return;
    }
    var sub = subs[0];
    var steps = sub.steps || [];
    var completed = steps.filter(function(s) { return s.status === 'complete'; }).length;
    var html = '<div class="panel-title" style="margin-top:16px;">Council/Engineering</div>';
    html += '<div style="font-size:12px;margin-bottom:6px;color:var(--sw-dark);font-weight:600;">' + completed + '/' + steps.length + ' steps complete — ' + (sub.overall_status || '').replace(/_/g, ' ') + '</div>';
    html += '<div style="display:flex;gap:2px;margin-bottom:6px;">';
    steps.forEach(function(step) {
      var c = step.status === 'complete' ? 'var(--sw-green)' : step.status === 'in_progress' ? 'var(--sw-mid)' : step.status === 'blocked' ? 'var(--sw-red)' : '#E0E0E0';
      html += '<div title="' + escapeHtml(step.name) + '" style="flex:1;height:6px;border-radius:3px;background:' + c + ';"></div>';
    });
    html += '</div>';
    steps.forEach(function(step) {
      var icon = step.status === 'complete' ? '&#10003;' : step.status === 'in_progress' ? '&#9679;' : step.status === 'blocked' ? '&#10007;' : '&#9675;';
      var color = step.status === 'complete' ? 'var(--sw-green)' : step.status === 'in_progress' ? 'var(--sw-mid)' : step.status === 'blocked' ? 'var(--sw-red)' : 'var(--sw-text-sec)';
      html += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;">';
      html += '<span style="color:' + color + ';">' + icon + '</span>';
      html += '<span>' + escapeHtml(step.name) + '</span>';
      if (step.vendor) html += '<span style="color:var(--sw-text-sec);font-size:11px;">(' + escapeHtml(step.vendor) + ')</span>';
      html += '</div>';
    });
    html += '<div style="margin-top:6px;"><button class="btn btn-sm btn-secondary" style="font-size:11px;" onclick="showView(\'approvals\')">View in Approvals</button></div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '';
  }
}

function formatEventType(type, detail) {
  var labels = {
    'job_created': 'Job created',
    'status_changed': 'Status → ' + (detail?.new_status || ''),
    'ghl_linked': 'Linked to GHL',
    'ghl_stage_synced': 'GHL stage synced',
    'ghl_updated': 'Updated from GHL',
    'assignment_created': 'Scheduled',
    'assignment_deleted': 'Assignment removed',
    'assignment_status_changed': 'Assignment ' + (detail?.new_status || 'updated'),
    'po_created': 'PO created' + (detail?.po_number ? ' (' + detail.po_number + ')' : ''),
    'po_email_log': (detail?.direction === 'received' ? 'Email received' : 'Email sent') + (detail?.supplier ? ' — ' + detail.supplier : ''),
    'scope_saved': 'Scope saved',
    'note_added': 'Note added',
    'photo_uploaded': 'Photo uploaded',
    'report_submitted': 'Service report submitted',
    'invoice_created': 'Invoice created',
  };
  return labels[type] || type.replace(/_/g, ' ');
}

// ── Site Plan Image Overlay ──
function showSitePlanOverlay(src) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(26,39,46,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:16px;';
  overlay.onclick = function() { overlay.remove(); };
  var img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
  overlay.appendChild(img);
  document.body.appendChild(overlay);
}

// ── Site Plan Panel ──
function renderSitePlanPanel(scope_json, compact) {
  var scope = typeof scope_json === 'string' ? JSON.parse(scope_json) : scope_json;
  if (!scope) return '';
  var imgSrc = null;
  var label = 'Site Plan';

  // Patio: scope_json.client._sitePlanImage
  if (scope.client && scope.client._sitePlanImage) {
    imgSrc = scope.client._sitePlanImage;
    label = 'Site Plan (Patio Scope)';
  }
  // Fencing: scope_json.job.sitePlanImage
  if (!imgSrc && scope.job && scope.job.sitePlanImage) {
    imgSrc = scope.job.sitePlanImage;
    label = 'Site Plan (Fencing Scope)';
  }
  // Fallback: Google Static Maps satellite if coordinates available
  if (!imgSrc) {
    var latlng = null;
    if (scope.client && scope.client._latlng) latlng = scope.client._latlng;
    else if (scope.job && scope.job._latlng) latlng = scope.job._latlng;
    if (latlng && latlng.lat && latlng.lng) {
      imgSrc = 'https://maps.googleapis.com/maps/api/staticmap?center=' + latlng.lat + ',' + latlng.lng + '&zoom=19&size=600x400&maptype=satellite&key=AIzaSyCVNUaGS6k6MBG6_-MbCyiIGUajnzHU7DM';
      label = 'Satellite View';
    }
  }

  if (!imgSrc) return '';
  var maxW = compact ? '200px' : '100%';
  var html = '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">';
  html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">&#128205; ' + label + '</div>';
  html += '<img src="' + imgSrc + '" style="max-width:' + maxW + ';width:100%;cursor:pointer;display:block;" onclick="showSitePlanOverlay(this.src)" alt="Site plan">';
  html += '<div style="font-size:10px;color:var(--sw-text-sec);margin-top:4px;">Click to enlarge</div>';
  html += '</div>';
  return html;
}

// ── Document Links by Type ──
function renderDocumentLinks(documents, types, heading) {
  var docs = (documents || []).filter(function(d) { return types.indexOf(d.type) >= 0; });
  if (docs.length === 0) return '';
  var html = '<div style="margin-top:12px;">';
  html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">' + heading + '</div>';
  docs.forEach(function(doc) {
    var url = doc.storage_url || doc.pdf_url;
    var name = doc.file_name || doc.type || 'Document';
    html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--sw-border);font-size:13px;">';
    html += '<span style="font-size:16px;">&#128196;</span>';
    html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(name) + '</span>';
    if (doc.version > 1) html += '<span style="font-size:11px;color:var(--sw-text-sec);">v' + doc.version + '</span>';
    if (url) html += '<a href="' + escapeHtml(url) + '" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px;padding:2px 8px;text-decoration:none;">View</a>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function renderScopeSummary(scope_json, jobType, jobId) {
  var scope = typeof scope_json === 'string' ? JSON.parse(scope_json) : scope_json;
  if (!scope) return '<div style="font-size:12px; color:var(--sw-text-sec); padding:4px 0;">No scope data</div>';

  var config = scope.config || scope;
  var badgeStyle = 'display:inline-block;font-size:11px;font-weight:600;padding:3px 8px;margin:2px 3px 2px 0;background:var(--sw-light);color:var(--sw-dark);border-left:3px solid var(--sw-mid);';
  var html = '<div style="font-size:12px; padding:6px 0; line-height:1.6;">';

  if (jobType === 'fencing') {
    // Fencing scope summary
    var fenceJob = scope.job || {};
    var sections = fenceJob.runs || scope.sections || [];
    if (sections.length > 0) {
      var totalMetres = sections.reduce(function(s, sec) { return s + (parseFloat(sec.length) || 0); }, 0);
      var totalPanels = sections.reduce(function(s, sec) { return s + (sec.panels || []).length; }, 0);
      html += '<div><strong>Total:</strong> ' + totalMetres.toFixed(1) + 'm fence across ' + sections.length + ' run' + (sections.length === 1 ? '' : 's') + '</div>';
      // Visual badges
      html += '<div style="margin:6px 0;">';
      html += '<span style="' + badgeStyle + '">' + totalMetres.toFixed(1) + 'm total</span>';
      if (totalPanels > 0) html += '<span style="' + badgeStyle + '">' + totalPanels + ' panels</span>';
      var fenceColor = fenceJob.sheetColour || fenceJob.colour || '';
      if (fenceColor) html += '<span style="' + badgeStyle + 'border-color:var(--sw-orange);">&#127912; ' + escapeHtml(fenceColor) + '</span>';
      var fenceProfile = fenceJob.profile || '';
      if (fenceProfile) html += '<span style="' + badgeStyle + '">' + escapeHtml(fenceProfile) + '</span>';
      html += '</div>';
      sections.forEach(function(sec, i) {
        html += '<div style="margin-left:8px; color:var(--sw-text-sec);">Run ' + (i+1) + ': ' + (sec.length || 0) + 'm, ' + (sec.sheetHeight || 1800) + 'mm high';
        if (sec.retaining) html += ', retaining';
        html += '</div>';
      });
    }
    // Gates
    var gates = fenceJob.gates || scope.gates || [];
    if (gates.length > 0) {
      html += '<div style="margin:4px 0;"><strong>Gates (' + gates.length + '):</strong> ' + gates.map(function(g) { return (g.type || 'pedestrian') + ' (' + (g.width || 900) + 'mm)'; }).join(', ') + '</div>';
    }
    // Removal
    var removal = fenceJob.removal || scope.removal;
    if (removal && (removal.length > 0 || removal.totalMetres > 0)) {
      html += '<div><strong>Removal:</strong> ' + (removal.totalMetres || removal.length || 0) + 'm old fence</div>';
    }
  } else {
    // Patio scope summary
    if (config.length || config.projection) {
      html += '<div><strong>Size:</strong> ' + (config.length || '?') + 'm × ' + (config.projection || '?') + 'm';
      if (config.length && config.projection) html += ' (' + (config.length * config.projection).toFixed(1) + 'm²)';
      html += '</div>';
    }
    // Visual badges for patio
    html += '<div style="margin:6px 0;">';
    if (config.roofStyle) html += '<span style="' + badgeStyle + '">' + escapeHtml(config.roofStyle) + '</span>';
    if (config.roofing || config.panel_type) html += '<span style="' + badgeStyle + '">' + escapeHtml(config.roofing || config.panel_type) + '</span>';
    if (config.connection) html += '<span style="' + badgeStyle + '">' + escapeHtml(config.connection) + '</span>';
    if (config.sheetColor) html += '<span style="' + badgeStyle + 'border-color:var(--sw-orange);">&#127912; ' + escapeHtml(config.sheetColor) + '</span>';
    if (config.steelColor) html += '<span style="' + badgeStyle + '">Steel: ' + escapeHtml(config.steelColor) + '</span>';
    html += '</div>';
    if (config.posts || config.post_count) html += '<div><strong>Posts:</strong> ' + (config.post_count || config.posts?.count || config.posts) + ' × ' + (config.post_size || config.posts?.size || '100x100 SHS') + '</div>';
  }

  if (Object.keys(config).length === 0 && !scope.sections && !(scope.job && scope.job.runs)) {
    html += '<div style="color:var(--sw-text-sec);">No scope data</div>';
  }

  // Scope tool link (readonly by default)
  var scopeToolUrl = jobType === 'fencing' ? 'https://secureworks-group.github.io/fence-designer/' : 'https://secureworks-group.github.io/patio/';
  var linkId = jobId || scope.jobId || '';
  if (linkId) {
    html += '<div style="margin-top:6px;"><a href="' + scopeToolUrl + '?jobId=' + linkId + '" target="_blank" style="font-size:11px;color:var(--sw-mid);font-weight:600;text-decoration:none;">&#128279; View in Scope Tool &#8599;</a></div>';
  }

  html += '</div>';
  return html;
}

// ════════════════════════════════════════════════════════════
// FULL-PAGE JOB DETAIL VIEW
// ════════════════════════════════════════════════════════════

var _currentJobData = null;
var _currentJobId = null;

// Open full-page job detail by UUID
async function openJobDetail(jobId) {
  _currentJobId = jobId;
  _emailLogLoaded = false; // reset email log when switching jobs
  _commsCouncilLoaded = false; // reset council comms
  _allEmailsLoaded = false; // reset all emails timeline
  // Save scroll position for kanban return
  var jobsBody = document.getElementById('jobsBody');
  if (jobsBody) sessionStorage.setItem('sw_kanban_scroll', jobsBody.scrollTop || window.scrollY);

  // Show the view
  document.getElementById('jobDetailView').classList.add('active');
  document.querySelector('.header').style.display = 'none';
  document.querySelector('.mobile-nav').style.display = 'none';
  document.querySelector('.container').style.display = 'none';

  // Show loading
  document.getElementById('jdHealthTop').innerHTML = '<div class="loading" style="padding:8px;">Loading...</div>';
  var _clrIds = ['jdOverview','jdMoney','jdBuild','jdFiles','jdComms','jdHistory'];
  _clrIds.forEach(function(id) { var el = document.getElementById(id); if (el) el.innerHTML = ''; });

  try {
    var data = await opsFetch('job_detail', { jobId: jobId });
    _currentJobData = data;

    // Update URL hash
    var jobNum = data.job.job_number || jobId.slice(0, 8);
    if (history.pushState) history.pushState({ job: jobId }, '', '#job/' + jobNum);

    // Load annotations for this job (async, non-blocking)
    loadAnnotations('entity', 'job', jobId).then(function(anns) {
      _currentJobAnnotations = anns || [];
      // If overview is showing, inject dots
      var overviewEl = document.getElementById('jdOverview');
      if (overviewEl && overviewEl.innerHTML && _currentJobAnnotations.length > 0) {
        renderAnnotationDots(_currentJobAnnotations, 'job_overview', overviewEl);
      }
    }).catch(function() { _currentJobAnnotations = []; });

    renderHealthBar(data);
    // Render the active sub-view (default to overview)
    var activeTab = localStorage.getItem('sw_jd_tab') || 'overview';
    showJobSubView(activeTab);
  } catch (e) {
    document.getElementById('jdHealthTop').innerHTML = '<div style="color:var(--sw-red);padding:12px;">Error: ' + e.message + '</div>';
  }
}

// Open job detail by job_number reference (for #job/SWP-25019 deep links)
async function openJobDetailByRef(ref) {
  // If ref looks like a UUID, open directly
  if (ref.length > 20) { openJobDetail(ref); return; }
  // Otherwise search jobs cache for matching job_number
  if (_jobsCache && _jobsCache.length > 0) {
    var match = _jobsCache.find(function(j) { return j.job_number === ref; });
    if (match) { openJobDetail(match.id); return; }
  }
  // Fallback: load pipeline and search
  try {
    var data = await opsFetch('pipeline');
    var allJobs = [];
    Object.keys(data.columns || {}).forEach(function(s) { allJobs = allJobs.concat(data.columns[s]); });
    var match = allJobs.find(function(j) { return j.job_number === ref; });
    if (match) { openJobDetail(match.id); return; }
  } catch(e) {}
  showToast('Job "' + ref + '" not found', 'warning');
}

function closeJobDetail(skipHistory) {
  document.getElementById('jobDetailView').classList.remove('active');
  document.querySelector('.header').style.display = '';
  document.querySelector('.mobile-nav').style.display = '';
  document.querySelector('.container').style.display = '';
  _currentJobData = null;
  _currentJobId = null;

  if (!skipHistory && history.pushState) {
    var savedTab = localStorage.getItem('sw_ops_tab') || 'jobs';
    history.pushState(null, '', '#' + savedTab);
  }

  // Restore kanban scroll position
  var savedScroll = sessionStorage.getItem('sw_kanban_scroll');
  if (savedScroll) {
    setTimeout(function() { window.scrollTo(0, parseInt(savedScroll)); }, 50);
  }
}

// Refresh current job detail (after an action)
async function refreshJobDetail() {
  if (_currentJobId) {
    try {
      var data = await opsFetch('job_detail', { jobId: _currentJobId });
      _currentJobData = data;
      renderHealthBar(data);
      renderActionDrawer(data);
      var activeTab = document.querySelector('.jd-tab.active');
      var tab = activeTab ? activeTab.getAttribute('data-jd-tab') : 'timeline';
      showJobSubView(tab);
    } catch(e) {}
  }
}

function showJobSubView(tab) {
  // Map legacy tab names
  if (tab === 'timeline') tab = 'history';
  var tabs = ['overview', 'money', 'build', 'files', 'comms', 'history'];
  var ids = ['jdOverview', 'jdMoney', 'jdBuild', 'jdFiles', 'jdComms', 'jdHistory'];
  tabs.forEach(function(t, i) {
    var el = document.getElementById(ids[i]);
    var btn = document.querySelector('[data-jd-tab="' + t + '"]');
    if (t === tab) {
      if (el) el.classList.add('active');
      if (btn) btn.classList.add('active');
    } else {
      if (el) el.classList.remove('active');
      if (btn) btn.classList.remove('active');
    }
  });
  localStorage.setItem('sw_jd_tab', tab);

  if (!_currentJobData) return;
  if (tab === 'overview') renderOverviewView(_currentJobData);
  if (tab === 'money') renderMoneyView(_currentJobData);
  if (tab === 'build') renderBuildView(_currentJobData);
  if (tab === 'files') renderFilesView(_currentJobData);
  if (tab === 'comms') renderCommsView(_currentJobData);
  if (tab === 'history') renderHistoryView(_currentJobData);
}

// ── Health Bar (Zone 1) ──

var STATUS_SEQUENCE = ['draft', 'quoted', 'accepted', 'scheduled', 'in_progress', 'complete', 'invoiced', 'paid'];

function renderHealthBar(data) {
  var j = data.job;

  // Minimal header: back, job#, client, suburb, type, status — nothing else
  var html = '<button class="jd-back" onclick="closeJobDetail()" title="Back">&larr;</button>';
  html += '<span class="jd-job-id">' + (j.job_number || '') + '</span>';
  html += '<span class="jd-client-name">' + escapeHtml(j.client_name || 'Unknown') + '</span>';
  html += '<span class="jd-suburb">' + escapeHtml(j.site_suburb || '') + '</span>';
  html += '<span class="jd-type-badge ' + j.type + '">' + typeBadgeLabel(j.type) + '</span>';
  html += '<span class="jd-status-badge" style="background:transparent;color:' + (STATUS_COLORS[j.status] || '#999') + ';border:1px solid ' + (STATUS_COLORS[j.status] || '#999') + '40">' + (STATUS_LABELS[j.status] || j.status) + '</span>';
  document.getElementById('jdHealthTop').innerHTML = html;
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  var d = new Date(dateStr);
  var now = new Date();
  return Math.max(0, Math.floor((now - d) / 86400000));
}

function confirmStepChange(jobId, targetStatus, targetIdx, currentIdx) {
  if (targetIdx <= currentIdx) return; // Can't go backwards
  if (targetIdx !== currentIdx + 1) return; // Only advance one step
  if (targetStatus === 'complete') {
    // Use existing cascade modal
    openCascadeModal(jobId);
    return;
  }
  if (confirm('Move job to ' + (STATUS_LABELS[targetStatus] || targetStatus) + '?')) {
    changeJobStatus(jobId, targetStatus);
  }
}

// ── Health Check Alerts ──

function evaluateJobAlerts(data) {
  var j = data.job;
  var alerts = [];
  var today = new Date().toISOString().slice(0, 10);

  var salesInvoices = (data.invoices || []).filter(function(inv) {
    return inv.invoice_type === 'ACCREC' && ['VOIDED','DELETED'].indexOf(inv.status) < 0;
  });

  // 1. RED: complete/in_progress + 0 assignments
  if ((['complete','in_progress'].indexOf(j.status) >= 0) && (data.assignments || []).length === 0) {
    alerts.push({ level: 'red', icon: '&#9888;', message: 'No crew assigned', target: 'build' });
  }

  // 2. RED: complete + no sales invoices
  if (j.status === 'complete' && salesInvoices.length === 0) {
    alerts.push({ level: 'red', icon: '&#9888;', message: 'Job complete — not invoiced', target: 'money' });
  }

  // 3. RED: overdue invoice
  salesInvoices.forEach(function(inv) {
    if (inv.status === 'AUTHORISED' && inv.due_date && inv.due_date < today) {
      var overdueDays = daysSince(inv.due_date);
      alerts.push({ level: 'red', icon: '&#9888;', message: 'Invoice ' + overdueDays + ' days overdue — chase', target: 'money' });
    }
  });

  // 4. AMBER: accepted/scheduled + 0 POs + has scope
  if ((['accepted','scheduled'].indexOf(j.status) >= 0) && (data.purchase_orders || []).length === 0 && j.scope_json) {
    alerts.push({ level: 'amber', icon: '&#9888;', message: 'Materials not ordered', target: 'build' });
  }

  // 5. AMBER: PO costs > quote
  var quoteVal = j.pricing_json?.totalIncGST || j.pricing_json?.total || 0;
  var poCosts = (data.purchase_orders || []).reduce(function(s, po) { return s + (po.total || 0); }, 0);
  if (quoteVal > 0 && poCosts > quoteVal) {
    alerts.push({ level: 'amber', icon: '&#9888;', message: 'Over budget by ' + fmt$(poCosts - quoteVal), target: 'money' });
  }

  // 6. AMBER: quoted for >14 days
  if (j.status === 'quoted' && j.quoted_at && daysSince(j.quoted_at) > 14) {
    alerts.push({ level: 'amber', icon: '&#9888;', message: 'Quote stale — follow up', target: 'timeline' });
  }

  // 7. AMBER: scheduled + all assignments missing user
  if (j.status === 'scheduled' && (data.assignments || []).length > 0) {
    var allUnassigned = data.assignments.every(function(a) { return !a.users || !a.users.name; });
    if (allUnassigned) {
      alerts.push({ level: 'amber', icon: '&#9888;', message: 'No crew assigned to schedule', target: 'build' });
    }
  }

  // 8. AMBER: PO delivery tomorrow + not confirmed
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var tomorrowStr = tomorrow.toISOString().slice(0, 10);
  (data.purchase_orders || []).forEach(function(po) {
    if (po.delivery_date === tomorrowStr && ['authorised','billed'].indexOf(po.status) < 0) {
      alerts.push({ level: 'amber', icon: '&#9888;', message: 'Delivery tomorrow — not confirmed', target: 'build' });
    }
  });

  return alerts;
}

// ── Timeline View ──

// ════════════════════════════════════════════════════════════
// OVERVIEW TAB — Job Command Centre
// ════════════════════════════════════════════════════════════

function renderOverviewView(data) {
  var j = data.job;
  var html = '';
  // Section 1: Client Card
  html += '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">';
  html += '<div style="font-size:16px;font-weight:700;color:var(--sw-dark);margin-bottom:6px;">' + escapeHtml(j.client_name || 'Unknown Client') + '</div>';
  if (j.site_address) html += '<div style="font-size:13px;color:var(--sw-text-sec);margin-bottom:2px;">' + escapeHtml(j.site_address) + '</div>';
  if (j.site_suburb) html += '<div style="font-size:12px;color:var(--sw-mid);">' + escapeHtml(j.site_suburb) + '</div>';
  html += '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">';
  if (j.client_phone) {
    html += '<button class="btn btn-secondary btn-sm" onclick="scheduleCallLog()">&#9742; Call ' + j.client_phone + '</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="showJobSubView(\x27comms\x27)">&#128172; SMS</button>';
  }
  if (j.client_email) html += '<a href="mailto:' + j.client_email + '" class="btn btn-secondary btn-sm" style="text-decoration:none;">&#9993; Email</a>';
  if (j.site_address) html += '<a href="https://maps.google.com/?q=' + encodeURIComponent((j.site_address||'') + (j.site_suburb ? ', ' + j.site_suburb : '')) + '" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration:none;">&#128205; Navigate</a>';
  html += '</div></div>';

  // Site Plan Image (between client card and job summary)
  if (j.scope_json && j.type !== 'miscellaneous') {
    html += renderSitePlanPanel(j.scope_json, false);
  }

  // Section 2: Job Summary
  html += '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">';
  var scopeDesc = typeBadgeLabel(j.type) + ' project';
  if (j.scope_json) {
    var sc = j.scope_json.config || j.scope_json;
    var parts = [];
    if (sc.length && sc.projection) parts.push(sc.length + 'm x ' + sc.projection + 'm');
    if (sc.roofStyle) parts.push(sc.roofStyle);
    if (sc.roofing || sc.panel_type) parts.push(sc.roofing || sc.panel_type);
    if (parts.length) scopeDesc = parts.join(', ');
  } else if (j.pricing_json && j.pricing_json.job_description) {
    scopeDesc = j.pricing_json.job_description.substring(0, 80);
  }
  html += '<div style="font-size:13px;color:var(--sw-text);margin-bottom:8px;">' + escapeHtml(scopeDesc) + '</div>';
  var quoteVal = j.pricing_json ? (j.pricing_json.totalIncGST || j.pricing_json.total || 0) : 0;
  var poCosts = (data.purchase_orders || []).reduce(function(s, po) { return s + (po.total || 0); }, 0);
  var margin = quoteVal > 0 ? quoteVal - poCosts : 0;
  var marginPct = quoteVal > 0 ? (margin / quoteVal * 100).toFixed(0) : 0;
  var marginColor = marginPct >= 35 ? 'var(--sw-green)' : marginPct >= 25 ? 'var(--sw-yellow)' : 'var(--sw-red)';
  html += '<div style="display:flex;gap:16px;align-items:baseline;">';
  html += '<span style="font-size:20px;font-weight:700;color:var(--sw-dark);font-family:var(--sw-font-num);">' + fmt$(quoteVal) + '</span>';
  if (quoteVal > 0 && poCosts > 0) html += '<span style="font-size:13px;font-weight:600;color:' + marginColor + ';">' + marginPct + '% margin (' + fmt$(margin) + ')</span>';
  html += '</div>';
  html += '<div style="margin-top:8px;font-size:11px;display:flex;gap:12px;">';
  if (j.type !== 'miscellaneous') {
    var scopeUrl = j.type === 'fencing' ? 'https://secureworks-group.github.io/fence-designer/' : 'https://secureworks-group.github.io/patio/';
    html += '<a href="#" onclick="openScopeSnapshot(_currentJobData);return false;" style="color:var(--sw-dark);font-weight:600;">Snapshot &#128248;</a>';
    html += '<a href="' + scopeUrl + '?jobId=' + j.id + '&mode=readonly" target="_blank" style="color:var(--sw-mid);">View Scope &#8599;</a>';
    html += '<a href="#" onclick="confirmEditScope(\'' + scopeUrl + '?jobId=' + j.id + '\');return false;" style="color:var(--sw-orange);">Edit Scope &#9998;</a>';
  }
  if (j.ghl_opportunity_id) html += '<a href="https://app.maxlead.com.au/v2/location/' + GHL_LOCATION_ID + '/opportunities/' + j.ghl_opportunity_id + '" target="_blank" style="color:var(--sw-mid);">View in GHL &#8599;</a>';
  html += '</div></div>';

  // Section 3: Next Actions
  var alerts = evaluateJobAlerts(data);
  html += '<div style="margin-bottom:12px;">';
  html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Next Actions</div>';
  if (alerts.length === 0) html += '<div style="background:rgba(39,174,96,0.06);padding:10px 14px;font-size:13px;color:var(--sw-green);font-weight:500;">&#9989; Job on track</div>';
  alerts.forEach(function(a) {
    var targetTab = a.target === 'timeline' ? 'history' : a.target;
    html += '<div style="background:' + (a.level === 'red' ? 'rgba(231,76,60,0.06)' : 'rgba(230,126,34,0.06)') + ';padding:8px 12px;margin-bottom:4px;display:flex;align-items:center;gap:8px;border-left:3px solid ' + (a.level === 'red' ? 'var(--sw-red)' : 'var(--sw-yellow)') + ';cursor:pointer;" onclick="showJobSubView(\x27' + targetTab + '\x27)">';
    html += '<span style="font-size:13px;flex:1;">' + a.icon + ' ' + a.message + '</span>';
    html += '<span style="font-size:11px;color:var(--sw-mid);">&#8594;</span></div>';
  });
  var nextStatuses = getNextStatuses(j.status, j.type);
  nextStatuses.forEach(function(s) {
    var color = s === 'cancelled' ? 'var(--sw-red)' : 'var(--sw-dark)';
    html += '<div style="background:var(--sw-light);padding:8px 12px;margin-bottom:4px;display:flex;align-items:center;gap:8px;border-left:3px solid ' + color + ';">';
    html += '<span style="font-size:13px;flex:1;">Mark as ' + (STATUS_LABELS[s] || s) + '</span>';
    html += '<button class="btn btn-sm" style="background:' + color + ';color:#fff;" onclick="changeJobStatus(\x27' + j.id + '\x27,\x27' + s + '\x27)">' + (STATUS_LABELS[s] || s) + '</button></div>';
  });
  // Send Run Quotes button (fencing multi-run jobs that haven't been quoted yet)
  var pj = j.pricing_json ? (typeof j.pricing_json === 'string' ? JSON.parse(j.pricing_json) : j.pricing_json) : {};
  if (j.type === 'fencing' && pj.runs && pj.runs.length > 0 && !j.quoted_at) {
    html += '<div style="background:rgba(241,90,41,0.06);padding:10px 12px;margin-bottom:4px;border-left:3px solid var(--sw-orange);display:flex;align-items:center;gap:8px;">';
    html += '<span style="font-size:13px;flex:1;">&#128233; ' + pj.runs.length + ' fence run' + (pj.runs.length > 1 ? 's' : '') + ' ready to quote</span>';
    html += '<button class="btn btn-sm" style="background:var(--sw-orange);color:#fff;" onclick="showSendRunQuotesConfirm(\'' + j.id + '\')">Send Run Quotes</button></div>';
  }
  html += '</div>';

  // AI Annotations section (between Next Actions and Progress)
  if (_currentJobAnnotations && _currentJobAnnotations.length > 0) {
    var jobAnns = _currentJobAnnotations.filter(function(a) { return a.ui_location === 'job_overview' || (a.effective_priority || a.priority) >= 80; });
    if (jobAnns.length > 0) {
      html += '<div style="margin-bottom:12px;">';
      html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">AI Insights</div>';
      jobAnns.forEach(function(ann) {
        var borderColor = ann.severity === 'amber' ? '#e67e22' : ann.category === 'learning' ? '#9b59b6' : '#3498db';
        html += '<div style="background:' + borderColor + '08;padding:10px 12px;margin-bottom:4px;border-left:3px solid ' + borderColor + ';" id="ann-overview-' + ann.id + '">';
        html += '<div style="font-size:13px;font-weight:600;color:var(--sw-dark);margin-bottom:4px;">' + escapeHtml(ann.title) + '</div>';
        if (ann.body) html += '<div style="font-size:11px;color:var(--sw-text-sec);margin-bottom:6px;">' + escapeHtml(ann.body) + '</div>';
        html += renderAnnotationResponse(ann);
        html += '</div>';
      });
      html += '</div>';
    }
  }

  // Section 4: Progress Checklist
  html += '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">';
  html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Progress</div>';
  var salesInvs = (data.invoices || []).filter(function(i) { return i.invoice_type === 'ACCREC' && ['VOIDED','DELETED'].indexOf(i.status) < 0; });
  var paidInvs = salesInvs.filter(function(i) { return i.status === 'PAID'; });
  var depInvs = salesInvs.filter(function(i) { return (i.reference || '').indexOf('DEP') >= 0; });
  var depPaid = depInvs.filter(function(i) { return i.status === 'PAID'; });
  var checkSteps = [
    { label: 'Lead received', done: !!j.created_at, date: j.created_at },
    { label: 'Quote sent', done: !!j.quoted_at, date: j.quoted_at, extra: quoteVal > 0 ? fmt$(quoteVal) : '' },
    { label: 'Quote accepted', done: !!j.accepted_at, date: j.accepted_at },
    { label: 'Deposit invoiced', done: depInvs.length > 0, extra: depPaid.length > 0 ? 'Paid' : depInvs.length > 0 ? 'Sent' : '' },
    { label: 'Materials ordered', done: (data.purchase_orders || []).length > 0, extra: (data.purchase_orders || []).length + ' POs' },
    { label: 'Crew assigned', done: (data.assignments || []).length > 0, extra: (data.assignments || []).length + ' assignments' },
    { label: 'Build complete', done: !!j.completed_at, date: j.completed_at },
    { label: 'Invoiced', done: salesInvs.length > 0 },
    { label: 'Paid', done: paidInvs.length > 0 },
  ];
  checkSteps.forEach(function(s) {
    var icon = s.done ? '<span style="color:var(--sw-green);">&#9989;</span>' : '<span style="color:var(--sw-border);">&#9744;</span>';
    var dateStr = s.date ? ' <span style="font-size:10px;color:var(--sw-text-sec);">' + fmtDate((s.date||'').slice(0,10)) + '</span>' : '';
    var extraStr = s.extra ? ' <span style="font-size:10px;color:var(--sw-mid);">' + s.extra + '</span>' : '';
    html += '<div style="padding:3px 0;display:flex;align-items:center;gap:8px;font-size:13px;">' + icon + '<span style="' + (s.done ? '' : 'color:var(--sw-text-sec);') + '">' + s.label + '</span>' + dateStr + extraStr + '</div>';
  });
  html += '</div>';

  // Section 4b: Per-run acceptance status (async-loaded, fencing multi-run only)
  if (j.type === 'fencing' && j.quoted_at) {
    html += '<div id="jdRunAcceptanceStatus"></div>';
  }

  // Section 4c: Council / Engineering (async-loaded)
  html += '<div id="jdOverviewCouncil"></div>';

  // Section 5: Recent Activity
  html += '<div style="background:var(--sw-card);padding:14px;box-shadow:var(--sw-shadow);">';
  html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Recent Activity</div>';
  var evts = buildTimelineEvents(data);
  evts.sort(function(a, b) { return (b.datetime || '') > (a.datetime || '') ? 1 : -1; });
  var shown = 0;
  evts.forEach(function(ev) {
    if (shown >= 5) return;
    if (ev.source === 'photo') return;
    html += '<div style="padding:3px 0;font-size:12px;display:flex;gap:6px;">';
    html += '<span style="color:' + getTimelineColor(ev.source) + ';">&#9679;</span>';
    html += '<span style="flex:1;color:var(--sw-text);">' + escapeHtml(ev.label) + '</span>';
    html += '<span style="font-size:10px;color:var(--sw-text-sec);white-space:nowrap;">' + (ev.datetime ? fmtDate(ev.datetime.slice(0,10)) : '') + '</span></div>';
    shown++;
  });
  if (evts.length > 5) html += '<div style="margin-top:6px;"><a href="#" onclick="event.preventDefault();showJobSubView(\x27history\x27)" style="font-size:11px;color:var(--sw-mid);">View full history &#8594;</a></div>';
  html += '</div>';

  document.getElementById('jdOverview').innerHTML = html;

  // Load council section async (shows button or status)
  loadOverviewCouncilSection(j.id, j.type);

  // Load per-run acceptance status (fencing multi-run)
  if (j.type === 'fencing' && j.quoted_at) {
    loadRunAcceptanceStatus(j.id);
  }
}

// ── Per-Run Acceptance Status (fencing multi-run) ──

async function loadRunAcceptanceStatus(jobId) {
  var el = document.getElementById('jdRunAcceptanceStatus');
  if (!el) return;
  try {
    var resp = await opsFetch('list_run_acceptances', { job_id: jobId });
    var acceptances = resp.acceptances || [];
    if (acceptances.length === 0) { el.innerHTML = ''; return; }

    // Group by run_label
    var runMap = {};
    acceptances.forEach(function(ra) {
      if (!runMap[ra.run_label]) runMap[ra.run_label] = [];
      runMap[ra.run_label].push(ra);
    });

    var html = '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Run Acceptance</div>';

    Object.keys(runMap).forEach(function(rl, idx) {
      var parties = runMap[rl];
      var prefix = idx === Object.keys(runMap).length - 1 ? '└─' : '├─';
      html += '<div style="padding:4px 0 4px 12px;font-size:12px;border-left:2px solid var(--sw-border);margin-left:8px;">';
      html += '<strong>' + prefix + ' ' + escapeHtml(rl) + ':</strong> ';

      parties.forEach(function(ra, pi) {
        var isPrimary = ra.job_contacts?.is_primary;
        var name = ra.job_contacts?.client_name || (isPrimary ? 'Client' : 'Neighbour');
        var label = isPrimary ? 'Client' : name;
        var statusIcon = ra.status === 'accepted' ? '<span style="color:var(--sw-green);">&#9989;</span>' :
                         ra.status === 'declined' ? '<span style="color:var(--sw-red);">&#10060;</span>' :
                         '<span style="color:var(--sw-text-sec);">&#9203;</span>';

        if (pi > 0) html += ' · ';
        html += statusIcon + ' ' + escapeHtml(label);

        // Deposit payment status
        if (ra.deposit) {
          if (ra.deposit.paid) {
            html += ' <span style="font-size:10px;color:var(--sw-green);font-weight:600;">Paid &#9989;</span>';
          } else if (ra.deposit.total) {
            html += ' <span style="font-size:10px;color:var(--sw-orange);">Deposit sent</span>';
          }
        }
      });

      // Run summary + actions
      var allAccepted = parties.every(function(p) { return p.status === 'accepted'; });
      var anyDeclined = parties.some(function(p) { return p.status === 'declined'; });
      var anyPending = parties.some(function(p) { return p.status === 'pending'; });
      if (anyDeclined) html += ' <span style="font-size:10px;color:var(--sw-red);font-weight:600;">Run dropped</span>';
      else if (allAccepted) html += ' <span style="font-size:10px;color:var(--sw-green);font-weight:600;">Ready</span>';

      // Resend button for runs with pending parties
      if (anyPending && !anyDeclined) {
        var pendingNames = parties.filter(function(p) { return p.status === 'pending'; }).map(function(p) { return p.job_contacts?.client_name || 'party'; });
        html += ' <button class="btn btn-sm" style="font-size:9px;padding:1px 6px;background:none;border:1px solid var(--sw-border);color:var(--sw-text-sec);margin-left:4px;" onclick="event.stopPropagation();resendRunQuote(\'' + jobId + '\',\'' + escapeHtml(rl) + '\')" title="Resend to ' + escapeHtml(pendingNames.join(', ')) + '">Resend</button>';
      }

      html += '</div>';
    });

    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '';
  }
}

// ── Send Run Quotes Confirmation ──

async function showSendRunQuotesConfirm(jobId) {
  var j = _currentJobData ? _currentJobData.job : null;
  if (!j) return;
  var pj = j.pricing_json ? (typeof j.pricing_json === 'string' ? JSON.parse(j.pricing_json) : j.pricing_json) : {};
  var runs = pj.runs || [];
  if (runs.length === 0) { showToast('No runs in pricing data', 'warning'); return; }

  var lines = runs.map(function(run) {
    var nbName = run.neighbour_name || null;
    var clientShare = run.totals ? fmt$(run.totals.client_share_inc || 0) : '';
    var nbShare = run.totals ? fmt$(run.totals.neighbour_share_inc || 0) : '';
    var line = '<strong>' + escapeHtml(run.run_label || run.run_name) + '</strong> — Client: ' + escapeHtml(j.client_name || '') + ' (' + clientShare + ')';
    if (nbName) {
      line += ' + Neighbour: ' + escapeHtml(nbName) + ' (' + nbShare + ')';
    } else {
      line += ' <span style="color:var(--sw-text-sec);">[No neighbour]</span>';
    }
    return '<div style="padding:4px 0;border-bottom:1px solid var(--sw-border);font-size:12px;">' + line + '</div>';
  }).join('');

  // Count unique recipients
  var clientEmail = j.client_email || '';
  var nbEmails = runs.filter(function(r) { return r.neighbour_name; }).map(function(r) { return r.neighbour_name; });
  var uniqueNbs = [...new Set(nbEmails)];

  var confirmHtml = '<div style="font-size:14px;font-weight:700;margin-bottom:12px;">Send quotes for ' + escapeHtml(j.job_number || '') + '?</div>';
  confirmHtml += '<div style="margin-bottom:12px;">' + lines + '</div>';
  confirmHtml += '<div style="font-size:12px;color:var(--sw-text-sec);margin-bottom:16px;">';
  confirmHtml += 'Client gets ' + runs.length + ' run quote' + (runs.length > 1 ? 's' : '') + ' in one email.';
  if (uniqueNbs.length > 0) confirmHtml += '<br>Each neighbour gets their run quote(s) separately.';
  confirmHtml += '</div>';
  confirmHtml += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
  confirmHtml += '<button class="btn btn-secondary" onclick="closeModal(\'sendRunConfirmModal\')">Cancel</button>';
  confirmHtml += '<button class="btn btn-primary" onclick="executeSendRunQuotes(\'' + jobId + '\')">Send All Quotes</button>';
  confirmHtml += '</div>';

  // Use a generic modal overlay
  var overlay = document.getElementById('sendRunConfirmModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sendRunConfirmModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal" style="max-width:500px;">' + confirmHtml + '</div>';
    document.body.appendChild(overlay);
  } else {
    overlay.querySelector('.modal').innerHTML = confirmHtml;
  }
  overlay.classList.add('active');
}

async function executeSendRunQuotes(jobId) {
  closeModal('sendRunConfirmModal');
  showToast('Sending run quotes...', 'info');
  try {
    var resp = await fetch(window.SUPABASE_URL + '/functions/v1/send-quote/send-runs', {
      method: 'POST',
      headers: await _getAuthHeaders(),
      body: JSON.stringify({ job_id: jobId }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var result = await resp.json();
    if (result.error) throw new Error(result.error);
    showToast(result.runs_sent + ' run quotes sent, ' + result.emails_sent + ' emails delivered', 'success');
    // Refresh job detail
    if (typeof openJobPeek === 'function') openJobPeek(jobId);
    refreshActiveView();
  } catch (e) {
    showToast('Failed to send: ' + (e.message || e), 'warning');
  }
}

async function resendRunQuote(jobId, runLabel) {
  if (!confirm('Resend quote for run ' + runLabel + '? This will re-send emails to any pending parties.')) return;
  try {
    showToast('Resending ' + runLabel + '...', 'info');
    // Call send-runs which is idempotent — creates new documents for unsent runs
    await fetch(window.SUPABASE_URL + '/functions/v1/send-quote/send-runs', {
      method: 'POST',
      headers: await _getAuthHeaders(),
      body: JSON.stringify({ job_id: jobId }),
    });
    showToast('Quotes resent for ' + runLabel, 'success');
    loadRunAcceptanceStatus(jobId);
  } catch (e) {
    showToast('Failed: ' + (e.message || e), 'warning');
  }
}

async function loadOverviewCouncilSection(jobId, jobType) {
  var el = document.getElementById('jdOverviewCouncil');
  if (!el) return;
  try {
    var resp = await opsFetch('list_council_submissions', { job_id: jobId });
    var subs = resp.submissions || [];
    if (subs.length === 0) {
      // Show start button for patio jobs only
      if (jobType === 'patio') {
        el.innerHTML = '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">' +
          '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Council / Engineering</div>' +
          '<div style="font-size:12px;color:var(--sw-text-sec);margin-bottom:8px;">No council process started for this job.</div>' +
          '<button class="btn btn-secondary" style="width:100%;font-size:12px;font-weight:600;" onclick="openCouncilStartModal(\'' + jobId + '\')">' +
          '&#127970; Start Council / Engineering Process</button></div>';
      }
      return;
    }
    // Show council status summary
    var sub = subs[0];
    var steps = sub.steps || [];
    var completed = steps.filter(function(s) { return s.status === 'complete'; }).length;
    var html = '<div style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Council / Engineering</div>';
    html += '<div style="font-size:12px;margin-bottom:6px;color:var(--sw-dark);font-weight:600;">' + completed + '/' + steps.length + ' steps complete — ' + (sub.overall_status || '').replace(/_/g, ' ') + '</div>';
    html += '<div style="display:flex;gap:2px;margin-bottom:8px;">';
    steps.forEach(function(step) {
      var c = step.status === 'complete' ? 'var(--sw-green)' : step.status === 'in_progress' ? 'var(--sw-mid)' : step.status === 'blocked' ? 'var(--sw-red)' : '#E0E0E0';
      html += '<div title="' + escapeHtml(step.name) + '" style="flex:1;height:6px;border-radius:3px;background:' + c + ';"></div>';
    });
    html += '</div>';
    steps.forEach(function(step) {
      var icon = step.status === 'complete' ? '&#10003;' : step.status === 'in_progress' ? '&#9679;' : step.status === 'blocked' ? '&#10007;' : '&#9675;';
      var color = step.status === 'complete' ? 'var(--sw-green)' : step.status === 'in_progress' ? 'var(--sw-mid)' : step.status === 'blocked' ? 'var(--sw-red)' : 'var(--sw-text-sec)';
      html += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;">';
      html += '<span style="color:' + color + ';">' + icon + '</span>';
      html += '<span>' + escapeHtml(step.name) + '</span>';
      if (step.vendor) html += '<span style="color:var(--sw-text-sec);font-size:11px;">(' + escapeHtml(step.vendor) + ')</span>';
      html += '</div>';
    });
    html += '<div style="margin-top:8px;"><button class="btn btn-sm btn-secondary" style="font-size:11px;" onclick="showView(\'approvals\')">View in Approvals &#8594;</button></div>';
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '';
  }
}

// ════════════════════════════════════════════════════════════
// HISTORY TAB — Filtered Timeline
// ════════════════════════════════════════════════════════════

function renderHistoryView(data) {
  var events = buildTimelineEvents(data);
  var today = new Date().toISOString().slice(0, 10);
  var filtered = [];
  var lastScope = null;
  events.sort(function(a, b) { return (a.datetime || '') < (b.datetime || '') ? -1 : 1; });
  events.forEach(function(ev) {
    if (ev.type === 'scope_saved') {
      if (lastScope && (new Date(ev.datetime).getTime() - new Date(lastScope.datetime).getTime()) < 300000) { lastScope = ev; return; }
      if (lastScope) filtered.push(lastScope);
      lastScope = ev;
    } else {
      if (lastScope) { filtered.push(lastScope); lastScope = null; }
      filtered.push(ev);
    }
  });
  if (lastScope) filtered.push(lastScope);
  var past = filtered.filter(function(e) { return e.date <= today; });
  var future = filtered.filter(function(e) { return e.date > today; });
  var html = '<div class="jd-timeline">';
  past.sort(function(a, b) { return b.datetime > a.datetime ? 1 : -1; });
  past.forEach(function(ev) { html += renderTimelineItem(ev, false); });
  if (future.length > 0) {
    html += '<div class="jd-tl-divider">&#9660; Upcoming</div>';
    future.sort(function(a, b) { return a.datetime < b.datetime ? -1 : 1; });
    future.forEach(function(ev) { html += renderTimelineItem(ev, true); });
  }
  html += '</div>';
  document.getElementById('jdHistory').innerHTML = html;
}

function renderTimelineView(data) {
  renderHistoryView(data);
  var today = new Date().toISOString().slice(0, 10);

  // Split into past and future
  var past = events.filter(function(e) { return e.date <= today; });
  var future = events.filter(function(e) { return e.date > today; });

  var html = '<div class="jd-timeline">';

  // Past events (most recent first)
  past.sort(function(a, b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : 0; });
  past.forEach(function(ev) {
    html += renderTimelineItem(ev, false);
  });

  // TODAY divider
  if (future.length > 0) {
    html += '<div class="jd-tl-divider">&#9660; Upcoming</div>';
    future.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    future.forEach(function(ev) {
      html += renderTimelineItem(ev, true);
    });
  }

  html += '</div>';

  var tlEl = document.getElementById('jdTimeline') || document.getElementById('jdHistory');
  if (tlEl) tlEl.innerHTML = html;
}

function buildTimelineEvents(data) {
  var events = [];
  var j = data.job;

  // Job events
  (data.events || []).forEach(function(ev) {
    var label = formatEventType(ev.event_type, ev.detail_json);
    // Format detail for display
    var detailStr = '';
    var d = ev.detail_json;
    if (d && typeof d === 'object') {
      if (ev.event_type === 'po_email_log') {
        detailStr = (d.direction === 'received' ? 'Received: ' : 'Sent: ') + (d.summary || '');
      } else if (d.from && d.to) {
        detailStr = d.from + ' → ' + d.to;
      } else {
        detailStr = Object.entries(d).filter(function(p) { return p[1] && p[0] !== 'po_id'; }).map(function(p) { return p[0] + ': ' + p[1]; }).join(' | ');
      }
    } else if (d) {
      detailStr = String(d);
    }
    events.push({
      date: (ev.created_at || '').slice(0, 10),
      datetime: ev.created_at,
      label: label,
      by: ev.users?.name || '',
      type: ev.event_type,
      detail: detailStr,
      source: ev.event_type === 'po_email_log' ? 'po' : 'event'
    });
  });

  // POs as synthetic events
  (data.purchase_orders || []).forEach(function(po) {
    events.push({
      date: (po.created_at || '').slice(0, 10),
      datetime: po.created_at,
      label: 'PO created — ' + (po.supplier_name || 'Unknown'),
      detail: po.po_number + ' | ' + fmt$(po.total) + ' | ' + (po.status || ''),
      source: 'po'
    });
    // Future: delivery date
    if (po.delivery_date && po.delivery_date > new Date().toISOString().slice(0, 10)) {
      events.push({
        date: po.delivery_date,
        datetime: po.delivery_date + 'T00:00:00',
        label: 'Delivery — ' + (po.supplier_name || ''),
        detail: po.po_number + ' | ' + fmt$(po.total),
        source: 'po_future',
        isFuture: true
      });
    }
  });

  // Assignments as synthetic events
  (data.assignments || []).forEach(function(a) {
    events.push({
      date: a.scheduled_date || (a.created_at || '').slice(0, 10),
      datetime: a.scheduled_date ? a.scheduled_date + 'T07:00:00' : a.created_at,
      label: 'Crew scheduled' + (a.crew_name ? ' — ' + cleanCrewName(a.crew_name) : ''),
      by: a.users?.name || '',
      detail: fmtDate(a.scheduled_date) + (a.scheduled_end ? ' to ' + fmtDate(a.scheduled_end) : '') + ' | ' + (a.status || ''),
      source: 'assignment'
    });
  });

  // Invoices as synthetic events
  (data.invoices || []).filter(function(inv) {
    return inv.invoice_type === 'ACCREC' && ['VOIDED','DELETED'].indexOf(inv.status) < 0;
  }).forEach(function(inv) {
    events.push({
      date: (inv.created_at || inv.date || '').slice(0, 10),
      datetime: inv.created_at || inv.date,
      label: 'Invoice ' + (inv.invoice_number || '') + ' created',
      detail: fmt$(inv.total) + ' | ' + (inv.status || ''),
      source: 'invoice'
    });
    // Future: due date
    if (inv.due_date && inv.due_date > new Date().toISOString().slice(0, 10) && inv.status !== 'PAID') {
      events.push({
        date: inv.due_date,
        datetime: inv.due_date + 'T00:00:00',
        label: 'Invoice ' + (inv.invoice_number || '') + ' due',
        detail: fmt$(inv.amount_due || inv.total),
        source: 'invoice_future',
        isFuture: true
      });
    }
  });

  // Photos as timeline entries
  (data.media || []).forEach(function(m) {
    events.push({
      date: (m.taken_at || m.created_at || '').slice(0, 10),
      datetime: m.taken_at || m.created_at,
      label: 'Photo' + (m.phase ? ' — ' + m.phase : ''),
      source: 'photo',
      photoUrl: m.thumbnail_url || m.storage_url,
      fullUrl: m.storage_url
    });
  });

  return events;
}

function renderTimelineItem(ev, isFuture) {
  var html = '<div class="jd-tl-item' + (isFuture ? ' future' : '') + '">';
  html += '<div class="jd-tl-dot" style="background:' + getTimelineColor(ev.source) + '"></div>';
  html += '<div class="jd-tl-label">' + escapeHtml(ev.label) + '</div>';
  html += '<div class="jd-tl-meta">';
  if (ev.datetime) {
    html += new Date(ev.datetime).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    if (!isFuture && ev.datetime.includes('T')) {
      html += ' ' + new Date(ev.datetime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    }
  }
  if (ev.by) html += ' &middot; ' + escapeHtml(ev.by);
  html += '</div>';
  if (ev.detail) {
    html += '<div class="jd-tl-detail">' + escapeHtml(String(ev.detail)) + '</div>';
  }
  if (ev.photoUrl) {
    html += '<img class="jd-tl-photo" src="' + escapeHtml(ev.photoUrl) + '" onclick="openLightbox([{storage_url:\'' + escapeHtml(ev.fullUrl || ev.photoUrl) + '\',label:\'Timeline photo\'}],0)" alt="Photo">';
  }
  html += '</div>';
  return html;
}

function getTimelineColor(source) {
  var colors = {
    event: 'var(--sw-mid)', po: 'var(--sw-purple)', po_future: 'var(--sw-purple)',
    assignment: 'var(--sw-blue)', invoice: 'var(--sw-green)', invoice_future: 'var(--sw-green)',
    photo: 'var(--sw-orange)'
  };
  return colors[source] || 'var(--sw-mid)';
}

// ── Money View ──

var _currentInvoices = [];

// ── Invoice Preview Overlay ──
function openInvoicePreview(inv) {
  var overlay = document.getElementById('invoicePreviewOverlay');
  if (!overlay) {
    // Create overlay container if it doesn't exist
    overlay = document.createElement('div');
    overlay.id = 'invoicePreviewOverlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:#fff;z-index:50;overflow-y:auto;padding:20px;display:none;';
    document.getElementById('jdMoney').parentElement.appendChild(overlay);
  }

  var j = _currentJobData?.job || {};
  var isPaid = inv.status === 'PAID';
  var isVoided = inv.status === 'VOIDED' || inv.status === 'DELETED';
  var isDraft = inv.status === 'DRAFT';
  var isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && ['AUTHORISED','SUBMITTED','SENT'].indexOf(inv.status) >= 0;
  var xeroLink = inv.xero_invoice_id ? 'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=' + inv.xero_invoice_id : '';

  var statusBg, statusColor;
  if (isOverdue) { statusBg = 'var(--sw-red)'; statusColor = '#fff'; }
  else if (isDraft) { statusBg = '#e0e0e0'; statusColor = '#333'; }
  else if (inv.status === 'AUTHORISED') { statusBg = '#2196F3'; statusColor = '#fff'; }
  else if (inv.status === 'SENT' || inv.status === 'SUBMITTED') { statusBg = 'var(--sw-orange)'; statusColor = '#fff'; }
  else if (isPaid) { statusBg = 'var(--sw-green)'; statusColor = '#fff'; }
  else if (isVoided) { statusBg = '#e0e0e0'; statusColor = 'var(--sw-text-sec)'; }
  else { statusBg = '#e0e0e0'; statusColor = '#333'; }

  var html = '';

  // Close button
  html += '<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">';
  html += '<button onclick="closeInvoicePreview()" style="background:none;border:none;cursor:pointer;font-size:24px;color:var(--sw-text-sec);padding:4px 8px;">&times;</button>';
  html += '</div>';

  // Header
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">';
  html += '<div>';
  html += '<div style="font-size:20px;font-weight:700;color:var(--sw-dark);">' + (inv.invoice_number || 'DRAFT') + '</div>';
  html += '<div style="font-size:13px;color:var(--sw-text-sec);">' + escapeHtml(inv.contact_name || j.client_name || '') + ' — ' + (j.job_number || inv.reference || '') + ' ' + (j.type || '').toUpperCase() + '</div>';
  html += '<div style="font-size:12px;color:var(--sw-text-sec);">' + (j.site_suburb || j.site_address || '') + '</div>';
  html += '</div>';
  html += '<div style="text-align:right;">';
  html += '<span style="display:inline-block;padding:4px 12px;border-radius:3px;font-size:12px;font-weight:700;background:' + statusBg + ';color:' + statusColor + ';">' + (isOverdue ? 'OVERDUE' : inv.status) + '</span>';
  if (inv.due_date) html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:4px;">Due: ' + fmtDate(inv.due_date) + '</div>';
  html += '</div>';
  html += '</div>';

  // Line items table
  var lineItems = inv.line_items || [];
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">';
  html += '<thead><tr style="border-bottom:2px solid var(--sw-dark);text-align:left;">';
  html += '<th style="padding:8px 6px;">DESCRIPTION</th>';
  html += '<th style="padding:8px 6px;text-align:right;width:60px;">QTY</th>';
  html += '<th style="padding:8px 6px;text-align:right;width:100px;">UNIT PRICE</th>';
  html += '<th style="padding:8px 6px;text-align:right;width:100px;">TOTAL</th>';
  html += '<th style="padding:8px 6px;text-align:right;width:80px;">ACCOUNT</th>';
  html += '</tr></thead><tbody>';

  if (Array.isArray(lineItems) && lineItems.length > 0) {
    lineItems.forEach(function(li) {
      var desc = li.Description || li.description || '';
      var qty = li.Quantity || li.quantity || 1;
      var unitPrice = li.UnitAmount || li.unit_price || 0;
      var lineTotal = li.LineAmount || li.total || (qty * unitPrice);
      var account = li.AccountCode || li.account_code || '';

      html += '<tr style="border-bottom:1px solid var(--sw-border);">';
      html += '<td style="padding:8px 6px;">' + escapeHtml(desc) + '</td>';
      html += '<td style="padding:8px 6px;text-align:right;">' + qty + '</td>';
      html += '<td style="padding:8px 6px;text-align:right;">' + fmt$(unitPrice) + '</td>';
      html += '<td style="padding:8px 6px;text-align:right;font-weight:600;">' + fmt$(lineTotal) + '</td>';
      html += '<td style="padding:8px 6px;text-align:right;color:var(--sw-text-sec);">' + account + '</td>';
      html += '</tr>';
    });
  } else {
    html += '<tr><td colspan="5" style="padding:12px;text-align:center;color:var(--sw-text-sec);font-style:italic;">No line item data available</td></tr>';
  }

  html += '</tbody></table>';

  // Totals
  var subTotal = parseFloat(inv.sub_total) || 0;
  var totalTax = parseFloat(inv.total_tax) || 0;
  var total = parseFloat(inv.total) || 0;
  var amountPaid = parseFloat(inv.amount_paid) || 0;
  var amountDue = parseFloat(inv.amount_due) || (total - amountPaid);

  html += '<div style="display:flex;justify-content:flex-end;margin-bottom:16px;">';
  html += '<div style="min-width:250px;">';
  html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span>Subtotal:</span><span>' + fmt$(subTotal) + '</span></div>';
  html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span>GST:</span><span>' + fmt$(totalTax) + '</span></div>';
  html += '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:15px;font-weight:700;border-top:2px solid var(--sw-dark);"><span>Total:</span><span>' + fmt$(total) + '</span></div>';
  html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:var(--sw-green);"><span>Paid:</span><span>' + fmt$(amountPaid) + '</span></div>';
  html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px;font-weight:700;color:' + (amountDue > 0 && isOverdue ? 'var(--sw-red)' : 'var(--sw-dark)') + '"><span>Amount Due:</span><span>' + fmt$(amountDue) + '</span></div>';
  html += '</div></div>';

  // Status timeline
  html += '<div style="display:flex;align-items:center;gap:6px;padding:12px 0;border-top:1px solid var(--sw-border);border-bottom:1px solid var(--sw-border);margin-bottom:16px;font-size:12px;">';
  var steps = [
    { label: 'Created', done: true, date: inv.created_at || inv.invoice_date },
    { label: 'Approved', done: ['AUTHORISED','SENT','SUBMITTED','PAID'].indexOf(inv.status) >= 0 },
    { label: 'Sent', done: ['SENT','SUBMITTED'].indexOf(inv.status) >= 0 || isPaid },
    { label: 'Paid', done: isPaid, date: inv.fully_paid_on },
  ];
  steps.forEach(function(step, idx) {
    if (idx > 0) html += '<span style="color:var(--sw-text-sec);">&rarr;</span>';
    var color = step.done ? 'var(--sw-green)' : 'var(--sw-text-sec)';
    html += '<span style="color:' + color + ';">' + (step.done ? '&#10003; ' : '') + step.label;
    if (step.date) html += ' ' + fmtDate(step.date);
    html += '</span>';
  });
  html += '</div>';

  // Action buttons
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  if (isDraft) {
    html += '<button class="btn btn-sm" style="background:var(--sw-green);color:#fff;" onclick="closeInvoicePreview();approveInvoiceFromPreview(window._previewInvoice, false)">Approve</button>';
    html += '<button class="btn btn-sm" style="background:#2196F3;color:#fff;" onclick="closeInvoicePreview();approveInvoiceFromPreview(window._previewInvoice, true)">Approve &amp; Send</button>';
  }
  if (!isPaid && !isVoided) {
    html += '<button class="btn btn-sm" style="background:var(--sw-dark);color:#fff;" onclick="closeInvoicePreview();openEditInvoiceModal(window._previewInvoice)">Edit Invoice</button>';
  }
  if (!isPaid && !isVoided) {
    html += '<button class="btn btn-sm" style="background:var(--sw-red);color:#fff;" onclick="closeInvoicePreview();confirmVoidInvoice(window._previewInvoice)">Void Invoice</button>';
  }
  if (!isPaid && !isVoided && !isDraft) {
    html += '<button class="btn btn-sm" style="background:var(--sw-green);color:#fff;" onclick="closeInvoicePreview();markInvoiceAsPaid(window._previewInvoice)">Mark as Paid</button>';
  }
  if (!isDraft && !isVoided && (inv.status === 'AUTHORISED' || inv.status === 'SENT')) {
    html += '<button class="btn btn-sm btn-secondary" onclick="resendInvoice(window._previewInvoice)">Resend to Client</button>';
  }
  if (xeroLink) {
    html += '<a href="' + xeroLink + '" target="_blank" class="btn btn-sm btn-secondary" style="text-decoration:none;">Open in Xero &#8599;</a>';
  }
  html += '</div>';

  window._previewInvoice = inv;
  overlay.innerHTML = html;
  overlay.style.display = 'block';
}

function closeInvoicePreview() {
  var overlay = document.getElementById('invoicePreviewOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ── Invoice Action Helpers ──

function approveInvoiceFromPreview(inv, sendEmail) {
  if (!inv || !inv.xero_invoice_id) return;
  var msg = sendEmail
    ? 'Approve and send ' + (inv.invoice_number || 'this invoice') + ' (' + fmt$(inv.total) + ') to the client?'
    : 'Approve ' + (inv.invoice_number || 'this invoice') + ' (' + fmt$(inv.total) + ')? It will be authorised in Xero but not sent yet.';
  if (!confirm(msg)) return;

  var action = sendEmail ? 'approve_and_send_invoice' : 'approve_invoice';
  var payload = { xero_invoice_id: inv.xero_invoice_id };
  if (sendEmail) {
    var j = _currentJobData?.job || {};
    payload.email_override = j.client_email || '';
    payload.use_branded_email = true;
  }

  opsPost(action, payload).then(function(res) {
    if (res.error) { alert('Error: ' + res.error); return; }
    showToast('Invoice ' + (sendEmail ? 'approved and sent' : 'approved'), 'success');
    if (_currentJobData?.job?.id) openJobDetail(_currentJobData.job.id);
  }).catch(function(e) {
    alert('Failed to approve: ' + e.message);
  });
}

// Sync fencing neighbours from scope/pricing → job_contacts
window.syncFencingNeighbours = function(jobId) {
  showToast('Syncing neighbours...', 'info');
  opsPost('sync_fencing_neighbours', { job_id: jobId }).then(function(res) {
    showToast('Synced ' + (res.synced_count || 0) + ' contacts', 'success');
    if (_currentJobId) refreshJobDetail(_currentJobId);
  }).catch(function(err) {
    showToast('Sync failed: ' + (err.message || err), 'error');
  });
};

function confirmVoidInvoice(inv) {
  var action = inv.status === 'DRAFT' ? 'delete' : 'void';
  var msg = action === 'delete'
    ? 'Delete draft invoice ' + (inv.invoice_number || '') + ' (' + fmt$(inv.total) + ')? This will be permanently removed from Xero.'
    : 'Void invoice ' + (inv.invoice_number || '') + ' (' + fmt$(inv.total) + ')? This cannot be undone.';

  if (!confirm(msg)) return;

  opsPost('void_invoice', {
    xero_invoice_id: inv.xero_invoice_id,
    void: action === 'void'
  }).then(function(res) {
    if (res.success || res.status) {
      // Refresh job detail to update invoice list
      openJobDetail(_currentJobData.job.id);
    }
  }).catch(function(e) {
    alert('Failed to ' + action + ' invoice: ' + e.message);
  });
}

function markInvoiceAsPaid(inv) {
  var today = new Date().toISOString().slice(0, 10);
  var dateStr = prompt('Mark ' + (inv.invoice_number || 'this invoice') + ' as paid? Enter payment date:', today);
  if (!dateStr) return;

  opsPost('mark_invoice_paid', {
    xero_invoice_id: inv.xero_invoice_id,
    payment_date: dateStr,
    amount: inv.total,
  }).then(function(res) {
    if (res.success) {
      openJobDetail(_currentJobData.job.id);
    }
  }).catch(function(e) {
    alert('Failed to mark as paid: ' + e.message);
  });
}

function resendInvoice(inv) {
  if (!confirm('Resend invoice ' + (inv.invoice_number || '') + ' to the client?')) return;

  opsPost('send_invoice_email', {
    xero_invoice_id: inv.xero_invoice_id,
  }).then(function(res) {
    if (res.success) {
      alert('Invoice resent');
    }
  }).catch(function(e) {
    alert('Failed to resend: ' + e.message);
  });
}

function togglePODetailExpand(poId) {
  var el = document.getElementById('poDetail_' + poId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function toggleInvDetailExpand(invId) {
  var el = document.getElementById('invDetail_' + invId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function toggleQuoteDetailExpand(docId) {
  var el = document.getElementById('quoteDetail_' + docId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function renderMoneyView(data) {
  var j = data.job;
  var quoteVal = j.pricing_json?.totalIncGST || j.pricing_json?.total || 0;
  var costEstimate = j.pricing_json?.costEstimate || j.pricing_json?.totalCost || j.pricing_json?.cost || 0;
  var poCosts = (data.purchase_orders || []).reduce(function(s, po) { return s + (po.total || 0); }, 0);
  var salesInvoices = (data.invoices || []).filter(function(inv) {
    return inv.invoice_type === 'ACCREC' && ['VOIDED','DELETED'].indexOf(inv.status) < 0;
  });
  var invoicedTotal = salesInvoices.reduce(function(s, inv) { return s + (parseFloat(inv.total) || 0); }, 0);
  var invoicePaid = salesInvoices.reduce(function(s, inv) { return s + (parseFloat(inv.amount_paid) || 0); }, 0);
  var margin = quoteVal > 0 ? quoteVal - poCosts : 0;
  var marginPct = quoteVal > 0 ? (margin / quoteVal * 100).toFixed(0) : 0;
  var marginColor = marginPct >= 25 ? 'var(--sw-green)' : marginPct >= 15 ? 'var(--sw-yellow)' : 'var(--sw-red)';

  var html = '<div class="jd-money-grid">';

  // Revenue column
  html += '<div class="jd-money-col">';
  html += '<div class="jd-money-heading">Revenue</div>';
  html += '<div class="jd-money-card"><div class="jd-money-card-head"><span>Quote Value</span><strong>' + fmt$(quoteVal) + '</strong></div>';
  // Quote breakdown — show what was actually quoted
  if (j.scope_json) {
    html += '<div style="font-size:11px;padding:6px 0 2px;border-top:1px solid var(--sw-border);margin-top:6px;color:var(--sw-text-sec);">';
    html += renderScopeSummary(j.scope_json, j.type, j.id);
    html += '</div>';
  }
  // Quote cards with expandable detail
  var quoteDocs = (data.documents || []).filter(function(d) { return d.type === 'quote' || d.type === 'permit_quote'; });
  if (quoteDocs.length > 0) {
    quoteDocs.forEach(function(doc) {
      var url = doc.storage_url || doc.pdf_url;
      var shareUrl = doc.share_token ? 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/send-quote/view?token=' + encodeURIComponent(doc.share_token) : url;
      var name = doc.file_name || 'Quote PDF';
      var quoteNum = doc.quote_number || ('v' + (doc.version || 1));
      var statusLabel = doc.accepted_at ? 'Accepted' : doc.sent_to_client ? (doc.viewed_at ? 'Viewed' : 'Sent') : 'Draft';
      var statusBg = doc.accepted_at ? 'var(--sw-green)' : doc.sent_to_client ? '#2196F3' : '#e0e0e0';
      var statusCol = doc.accepted_at || doc.sent_to_client ? '#fff' : '#333';
      var snapTotal = doc.data_snapshot_json?.totalIncGST || doc.data_snapshot_json?.total || 0;

      html += '<div class="jd-money-card" style="cursor:pointer;" onclick="toggleQuoteDetailExpand(\'' + doc.id + '\')">';
      html += '<div class="jd-money-card-head">';
      html += '<span>&#128196; ' + escapeHtml(quoteNum) + ' <span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:600;background:' + statusBg + ';color:' + statusCol + ';vertical-align:middle;margin-left:4px;">' + statusLabel + '</span></span>';
      if (snapTotal) html += '<strong>' + fmt$(snapTotal) + '</strong>';
      html += '</div>';
      if (doc.sent_at) html += '<div class="jd-money-card-sub">' + (doc.sent_to_client ? 'Sent ' + fmtDate(doc.sent_at) : '') + '</div>';

      // Expandable detail
      html += '<div id="quoteDetail_' + doc.id + '" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--sw-border);font-size:11px;" onclick="event.stopPropagation();">';
      // Line items
      var snapItems = doc.data_snapshot_json?.items || doc.data_snapshot_json?.lineItems || [];
      if (snapItems.length > 0) {
        html += '<div style="font-weight:600;margin-bottom:4px;color:var(--sw-dark);">Line Items</div>';
        snapItems.forEach(function(item) {
          var iDesc = item.description || item.name || '';
          var iQty = item.quantity || item.qty || 1;
          var iPrice = item.unit_price || item.unitPrice || item.price || 0;
          html += '<div style="display:flex;gap:6px;padding:2px 0;color:var(--sw-text-sec);">';
          html += '<span style="flex:1;">' + escapeHtml(iDesc) + '</span>';
          if (iQty > 1) html += '<span>' + iQty + 'x</span>';
          html += '<span style="font-weight:600;font-family:var(--sw-font-num);">' + fmt$(iPrice) + '</span>';
          html += '</div>';
        });
      }
      // Totals
      if (snapTotal) {
        var snapEx = Math.round((snapTotal / 1.1) * 100) / 100;
        var snapGst = Math.round((snapTotal - snapEx) * 100) / 100;
        html += '<div style="display:flex;gap:12px;justify-content:flex-end;margin-top:6px;padding-top:4px;border-top:1px solid var(--sw-border);font-size:11px;">';
        html += '<span style="color:var(--sw-text-sec);">Ex GST: <strong>' + fmt$(snapEx) + '</strong></span>';
        html += '<span style="color:var(--sw-text-sec);">GST: <strong>' + fmt$(snapGst) + '</strong></span>';
        html += '<span style="font-weight:700;">Total: ' + fmt$(snapTotal) + '</span>';
        html += '</div>';
      }
      // Action buttons
      html += '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">';
      if (shareUrl) html += '<a href="' + escapeHtml(shareUrl) + '" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px;text-decoration:none;">View Quote PDF &#8599;</a>';
      if (doc.accepted_at && ['accepted','approvals','deposit','pre_build','scheduled','in_progress','complete'].indexOf(j.status) >= 0) {
        html += '<button class="btn btn-sm" onclick="event.stopPropagation();createInvoiceFromQuote(\'' + j.id + '\',\'' + doc.id + '\')" style="background:var(--sw-green);color:#fff;font-size:11px;font-weight:600;">Create Invoice from Quote</button>';
      }
      html += '</div>';
      html += '</div>';
      html += '</div>';
    });
  } else {
    html += '<div style="font-size:11px;color:var(--sw-text-sec);padding:4px 0;font-style:italic;">No quote PDF attached</div>';
  }
  html += '</div>';
  html += '<div class="jd-money-card"><div class="jd-money-card-head"><span>Invoiced</span><strong>' + fmt$(invoicedTotal) + '</strong></div>';
  if (quoteVal > 0) {
    var invPct = Math.min(100, invoicedTotal / quoteVal * 100);
    html += '<div style="height:4px;background:#e0e0e0;border-radius:2px;overflow:hidden;margin-top:6px"><div style="height:100%;width:' + invPct + '%;background:var(--sw-green);border-radius:2px"></div></div>';
  }
  html += '</div>';
  html += '<div class="jd-money-card"><div class="jd-money-card-head"><span>Collected</span><strong style="color:var(--sw-green)">' + fmt$(invoicePaid) + '</strong></div></div>';
  html += '<div class="jd-money-card"><div class="jd-money-card-head"><span>Still to Invoice</span><strong style="color:' + (quoteVal - invoicedTotal > 0 ? 'var(--sw-orange)' : 'var(--sw-green)') + '">' + fmt$(Math.max(0, quoteVal - invoicedTotal)) + '</strong></div></div>';

  // ── Payment Status card (overdue invoices only) ──
  var overdueInvs = salesInvoices.filter(function(inv) {
    return inv.due_date && new Date(inv.due_date + 'T00:00:00') < new Date() && ['AUTHORISED','SUBMITTED','SENT'].indexOf(inv.status) >= 0 && (parseFloat(inv.amount_due) || 0) > 0;
  });
  if (overdueInvs.length > 0) {
    var chaseLogs = data.chase_logs || [];
    var classLabels = { unclassified: { icon: '\u2B1C', label: 'Unclassified', color: '#999' }, genuine_debt: { icon: '\uD83D\uDD34', label: 'Genuine Debt', color: '#e74c3c' }, blocked_by_us: { icon: '\uD83D\uDFE1', label: 'Blocked by Us', color: '#f39c12' }, in_dispute: { icon: '\uD83D\uDFE0', label: 'In Dispute', color: '#e67e22' }, bad_debt: { icon: '\u26AB', label: 'Bad Debt', color: '#2c3e50' } };

    html += '<div style="margin-top:10px;padding:12px;background:var(--sw-card);border-radius:10px;box-shadow:var(--sw-shadow);border-left:4px solid var(--sw-red)">';
    html += '<div style="font-size:13px;font-weight:700;color:var(--sw-dark);margin-bottom:8px;">\u26A1 PAYMENT STATUS</div>';

    overdueInvs.forEach(function(inv) {
      var daysOverdue = Math.ceil((Date.now() - new Date(inv.due_date + 'T00:00:00').getTime()) / 86400000);
      var agingColor = daysOverdue <= 30 ? '#27ae60' : daysOverdue <= 60 ? '#f39c12' : '#e74c3c';
      var cls = classLabels[inv.debt_classification || 'unclassified'] || classLabels.unclassified;
      var amtDue = parseFloat(inv.amount_due) || 0;

      html += '<div style="padding:8px 0;border-bottom:1px solid var(--sw-border);">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">';
      html += '<span style="font-size:13px;font-weight:600;color:var(--sw-dark);">' + (inv.invoice_number || '-') + ' \u00B7 ' + fmt$(amtDue) + '</span>';
      html += '<span style="font-size:12px;font-weight:600;color:' + agingColor + ';">' + daysOverdue + ' days overdue</span>';
      html += '</div>';

      // Classification badge
      html += '<div style="margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
      html += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + cls.color + '18;color:' + cls.color + ';font-weight:600;">' + cls.icon + ' ' + cls.label + '</span>';
      if (inv.debt_classification_reason) html += '<span style="font-size:10px;color:var(--sw-text-sec);font-style:italic;">' + escapeHtml(inv.debt_classification_reason) + '</span>';
      html += '</div>';

      // Last chase interaction for this invoice
      var invLogs = chaseLogs.filter(function(cl) { return cl.xero_invoice_id === inv.xero_invoice_id; }).slice(0, 2);
      if (invLogs.length > 0) {
        html += '<div style="margin-top:4px;">';
        var methodIcons = { call: '\uD83D\uDCDE', sms: '\uD83D\uDCAC', auto_sms: '\uD83E\uDD16', email: '\uD83D\uDCE7', note: '\uD83D\uDCDD', status_change: '\uD83C\uDFF7' };
        invLogs.forEach(function(log) {
          var icon = methodIcons[log.method] || '\u2022';
          html += '<div style="font-size:11px;color:var(--sw-text-sec);">' + icon + ' ' + fmtDate(log.created_at) + ' \u2014 ' + (log.outcome ? '<strong>' + escapeHtml(log.outcome) + '</strong>' : '') + (log.notes ? ' ' + escapeHtml(log.notes).substring(0, 60) : '') + '</div>';
        });
        // Next follow-up
        var nextFU = invLogs.find(function(l) { return l.follow_up_date && !l.follow_up_resolved; });
        if (nextFU) {
          var fuOverdue = nextFU.follow_up_date <= new Date().toISOString().slice(0, 10);
          html += '<div style="font-size:11px;color:' + (fuOverdue ? 'var(--sw-red)' : 'var(--sw-text-sec)') + ';font-weight:' + (fuOverdue ? '600' : '400') + ';">\u23F0 Follow-up: ' + fmtDate(nextFU.follow_up_date) + (fuOverdue ? ' (overdue)' : '') + '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    });

    // Link to Clear Debt
    html += '<div style="margin-top:8px;text-align:right;">';
    html += '<button class="btn btn-sm" style="font-size:11px;color:var(--sw-red);" onclick="closeJobDetail();showView(\'financials\');showSubTab(\'cleardebt\')">View in Clear Debt \u2192</button>';
    html += '</div>';
    html += '</div>';
  }

  // ── Job Contacts panel (multi-neighbour fencing) ──
  var jobContacts = data.job_contacts || [];
  var isMultiContact = jobContacts.length > 1;
  var hasNeighbourData = j.pricing_json && j.pricing_json.neighbour_splits && j.pricing_json.neighbour_splits.neighbours && j.pricing_json.neighbour_splits.neighbours.length > 0;

  if (isMultiContact) {
    html += '<div style="margin-top:10px;padding:12px;background:var(--sw-card);border-radius:10px;box-shadow:var(--sw-shadow);border-left:4px solid var(--sw-orange)">';
    html += '<div style="font-size:13px;font-weight:700;color:var(--sw-dark);margin-bottom:8px;">JOB CONTACTS — ' + jobContacts.length + ' payers</div>';
    jobContacts.forEach(function(c) {
      var invoicedForContact = salesInvoices.filter(function(inv) { return inv.job_contact_id === c.id; }).reduce(function(s, inv) { return s + (parseFloat(inv.total) || 0); }, 0);
      var paidForContact = salesInvoices.filter(function(inv) { return inv.job_contact_id === c.id; }).reduce(function(s, inv) { return s + (parseFloat(inv.amount_paid) || 0); }, 0);
      var remaining = Math.max(0, (c.quote_value_ex_gst * 1.1) - invoicedForContact);
      var label = c.contact_label || '?';
      var isPrimary = c.is_primary;
      var typeLabel = isPrimary ? 'primary' : 'neighbour';
      var runs = c.assigned_runs || [];

      html += '<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--sw-border);">';
      html += '<div style="width:28px;height:28px;border-radius:50%;background:' + (isPrimary ? 'var(--sw-dark)' : 'var(--sw-orange)') + ';color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + escapeHtml(label) + '</div>';
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-weight:600;font-size:13px">' + escapeHtml(c.client_name || 'Unknown') + ' <span style="font-weight:400;color:var(--sw-text-sec);font-size:11px">(' + typeLabel + ')</span></div>';
      if (runs.length > 0) html += '<div style="font-size:11px;color:var(--sw-text-sec)">Runs: ' + runs.join(', ') + '</div>';
      html += '<div style="font-size:11px;margin-top:2px">';
      html += '<span style="color:var(--sw-text-sec)">Quoted:</span> <strong>' + fmt$(c.quote_value_ex_gst * 1.1) + '</strong>';
      html += ' &nbsp;|&nbsp; <span style="color:var(--sw-text-sec)">Invoiced:</span> <strong>' + fmt$(invoicedForContact) + '</strong>';
      html += ' &nbsp;|&nbsp; <span style="color:var(--sw-text-sec)">Paid:</span> <strong style="color:var(--sw-green)">' + fmt$(paidForContact) + '</strong>';
      if (remaining > 0) html += ' &nbsp;|&nbsp; <span style="color:var(--sw-orange);font-weight:600">Remaining: ' + fmt$(remaining) + '</span>';
      html += '</div>';
      html += '</div>';
      html += '<button class="btn btn-sm" style="background:var(--sw-dark);color:#fff;font-size:10px;white-space:nowrap" onclick="openUnifiedInvoiceModal(\'' + j.id + '\',\'' + c.id + '\')">+ Invoice</button>';
      html += '</div>';
    });
    html += '</div>';
  } else if (!isMultiContact && hasNeighbourData && jobContacts.length === 0) {
    // Neighbours in scope but no job_contacts — offer sync
    html += '<div style="margin-top:10px;padding:12px;background:#FEF3CD;border-radius:10px;font-size:12px;color:#92400E;display:flex;align-items:center;gap:8px">';
    html += '<span>This fencing job has neighbours in the scope but no contacts set up.</span>';
    html += '<button class="btn btn-sm" style="background:var(--sw-orange);color:#fff" onclick="syncFencingNeighbours(\'' + j.id + '\')">Set Up Contacts</button>';
    html += '</div>';
  }

  // Individual invoices — expandable cards
  _currentInvoices = salesInvoices;
  if (salesInvoices.length > 0) {
    html += '<div style="margin-top:8px;font-size:12px;font-weight:600;color:var(--sw-text-sec);">Invoices</div>';

    salesInvoices.forEach(function(inv, i) {
      var isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && ['AUTHORISED','SUBMITTED','SENT'].indexOf(inv.status) >= 0;
      var isPaid = inv.status === 'PAID';
      var isDraft = inv.status === 'DRAFT';
      var isVoided = inv.status === 'VOIDED' || inv.status === 'DELETED';
      var amountDue = parseFloat(inv.amount_due) || (parseFloat(inv.total) - parseFloat(inv.amount_paid || 0));
      var amountPaid = parseFloat(inv.amount_paid) || 0;
      var xeroLink = inv.xero_invoice_id ? 'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=' + inv.xero_invoice_id : '';
      var invCardId = inv.xero_invoice_id || ('inv_' + i);

      // Status badge
      var sBg, sCol;
      if (isOverdue) { sBg = 'var(--sw-red)'; sCol = '#fff'; }
      else if (isDraft) { sBg = '#e0e0e0'; sCol = '#333'; }
      else if (inv.status === 'AUTHORISED') { sBg = '#2196F3'; sCol = '#fff'; }
      else if (inv.status === 'SENT' || inv.status === 'SUBMITTED') { sBg = 'var(--sw-orange)'; sCol = '#fff'; }
      else if (isPaid) { sBg = 'var(--sw-green)'; sCol = '#fff'; }
      else { sBg = '#e0e0e0'; sCol = '#333'; }
      var sLabel = isOverdue ? 'OVERDUE' : inv.status;

      var cardBorder = isOverdue ? 'border-left:3px solid var(--sw-red);' : '';

      html += '<div class="jd-money-card" style="cursor:pointer;' + cardBorder + '" onclick="toggleInvDetailExpand(\'' + invCardId + '\')">';
      html += '<div class="jd-money-card-head">';
      html += '<span>' + (inv.invoice_number || 'Draft') + ' <span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:600;background:' + sBg + ';color:' + sCol + ';vertical-align:middle;margin-left:4px;">' + sLabel + '</span></span>';
      html += '<strong>' + fmt$(inv.total) + '</strong>';
      html += '</div>';
      // Sub line: due date, paid, owing
      html += '<div class="jd-money-card-sub">';
      if (inv.due_date) html += 'Due ' + fmtDate(inv.due_date);
      if (isMultiContact) {
        var contactMatch = jobContacts.find(function(c) { return c.id === inv.job_contact_id; });
        if (contactMatch) html += ' &middot; ' + escapeHtml(contactMatch.client_name || contactMatch.contact_label);
      }
      if (!isDraft) {
        html += ' &middot; Paid: <strong style="color:var(--sw-green);">' + fmt$(amountPaid) + '</strong>';
        if (amountDue > 0) html += ' &middot; Owing: <strong style="color:' + (isOverdue ? 'var(--sw-red)' : 'var(--sw-dark)') + ';">' + fmt$(amountDue) + '</strong>';
      }
      html += '</div>';

      // Expandable detail
      html += '<div id="invDetail_' + invCardId + '" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--sw-border);font-size:11px;" onclick="event.stopPropagation();">';

      // Line items
      var lineItems = inv.line_items || [];
      if (Array.isArray(lineItems) && lineItems.length > 0) {
        html += '<div style="font-weight:600;margin-bottom:4px;color:var(--sw-dark);">Line Items</div>';
        lineItems.forEach(function(li) {
          var desc = li.Description || li.description || '';
          var qty = li.Quantity || li.quantity || 1;
          var unitPrice = li.UnitAmount || li.unit_price || 0;
          var lineTotal = li.LineAmount || li.total || (qty * unitPrice);
          html += '<div style="display:flex;gap:6px;padding:3px 0;color:var(--sw-text-sec);border-bottom:1px solid var(--sw-border);">';
          html += '<span style="flex:1;">' + escapeHtml(desc) + '</span>';
          if (qty > 1) html += '<span>' + qty + 'x ' + fmt$(unitPrice) + '</span>';
          html += '<span style="font-weight:600;font-family:var(--sw-font-num);">' + fmt$(lineTotal) + '</span>';
          html += '</div>';
        });
      }

      // Totals
      var subTotal = parseFloat(inv.sub_total) || 0;
      var totalTax = parseFloat(inv.total_tax) || 0;
      var total = parseFloat(inv.total) || 0;
      html += '<div style="display:flex;gap:12px;justify-content:flex-end;margin-top:6px;padding-top:4px;border-top:1px solid var(--sw-border);font-size:11px;">';
      html += '<span style="color:var(--sw-text-sec);">Ex GST: <strong>' + fmt$(subTotal) + '</strong></span>';
      html += '<span style="color:var(--sw-text-sec);">GST: <strong>' + fmt$(totalTax) + '</strong></span>';
      html += '<span style="font-weight:700;">Total: ' + fmt$(total) + '</span>';
      html += '</div>';

      // Status timeline
      html += '<div style="display:flex;align-items:center;gap:4px;margin-top:8px;padding:6px 0;font-size:11px;flex-wrap:wrap;">';
      var steps = [
        { label: 'Created', done: true },
        { label: 'Approved', done: ['AUTHORISED','SENT','SUBMITTED','PAID'].indexOf(inv.status) >= 0 },
        { label: 'Sent', done: ['SENT','SUBMITTED'].indexOf(inv.status) >= 0 || isPaid },
        { label: 'Paid', done: isPaid }
      ];
      steps.forEach(function(step, idx) {
        if (idx > 0) html += '<span style="color:var(--sw-text-sec);font-size:9px;">&rarr;</span>';
        var col = step.done ? 'var(--sw-green)' : 'var(--sw-text-sec)';
        html += '<span style="color:' + col + ';font-weight:' + (step.done ? '600' : '400') + ';">' + (step.done ? '&#10003; ' : '') + step.label + '</span>';
      });
      html += '</div>';

      // Action buttons
      html += '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">';
      if (xeroLink) html += '<a href="' + xeroLink + '" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px;text-decoration:none;">Open in Xero &#8599;</a>';
      if (isDraft) {
        html += '<button class="btn btn-sm" onclick="approveInvoiceFromPreview(_currentInvoices[' + i + '], false)" style="background:var(--sw-green);color:#fff;font-size:11px;">Approve</button>';
        html += '<button class="btn btn-sm" onclick="approveInvoiceFromPreview(_currentInvoices[' + i + '], true)" style="background:#2196F3;color:#fff;font-size:11px;">Approve &amp; Send</button>';
      }
      if (!isPaid && !isVoided) {
        html += '<button class="btn btn-sm btn-secondary" onclick="openEditInvoiceModal(_currentInvoices[' + i + '])" style="font-size:11px;">Edit</button>';
        html += '<button class="btn btn-sm btn-secondary" onclick="confirmVoidInvoice(_currentInvoices[' + i + '])" style="font-size:11px;color:var(--sw-red);border-color:var(--sw-red);">Void</button>';
      }
      if (!isPaid && !isVoided && !isDraft) {
        html += '<button class="btn btn-sm btn-secondary" onclick="markInvoiceAsPaid(_currentInvoices[' + i + '])" style="font-size:11px;">Mark Paid</button>';
        html += '<button class="btn btn-sm btn-secondary" onclick="resendInvoice(_currentInvoices[' + i + '])" style="font-size:11px;">Resend</button>';
      }
      html += '</div>';
      html += '</div>';
      html += '</div>';
    });
  }
  // Unified invoice button
  html += '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">';
  html += '<button class="btn btn-sm" style="background:var(--sw-dark);color:#fff;" onclick="openUnifiedInvoiceModal(\'' + j.id + '\')">+ Invoice</button>';
  html += '</div>';
  html += '</div>';

  // Costs column
  html += '<div class="jd-money-col">';
  html += '<div class="jd-money-heading">Costs</div>';
  if (costEstimate > 0) {
    html += '<div class="jd-money-card"><div class="jd-money-card-head"><span>Est. Costs</span><strong style="color:var(--sw-text-sec)">' + fmt$(costEstimate) + '</strong></div></div>';
  }
  html += '<div class="jd-money-card"><div class="jd-money-card-head"><span>PO Spend (Actual)</span><strong style="color:var(--sw-red)">' + fmt$(poCosts) + '</strong></div>';
  if (costEstimate > 0) {
    var diff = poCosts - costEstimate;
    var diffLabel = diff > 0 ? 'Over by ' + fmt$(diff) : diff < 0 ? 'Under by ' + fmt$(Math.abs(diff)) : 'On target';
    var diffColor = diff > 0 ? 'var(--sw-red)' : 'var(--sw-green)';
    html += '<div class="jd-money-card-sub" style="color:' + diffColor + '">' + diffLabel + '</div>';
  }
  html += '</div>';

  // PO list with readiness summary
  var pos = data.purchase_orders || [];
  if (pos.length > 0) {
    // Per-job PO readiness summary
    var poByStatus = { draft: 0, approved: 0, sent: 0, confirmed: 0, delivered: 0, other: 0 };
    var awaitingReply = 0;
    var now = Date.now();
    pos.forEach(function(po) {
      if (po.status === 'draft') poByStatus.draft++;
      else if (po.status === 'approved') poByStatus.draft++;
      else if (po.status === 'submitted' || po.status === 'sent') { poByStatus.sent++; var sentTs = po.updated_at || po.created_at; if (sentTs && (now - new Date(sentTs).getTime()) > 48*3600*1000) awaitingReply++; }
      else if (po.status === 'authorised' || po.status === 'confirmed') poByStatus.confirmed++;
      else if (po.status === 'billed' || po.status === 'delivered') poByStatus.delivered++;
      else poByStatus.other++;
    });
    var readyCount = poByStatus.confirmed + poByStatus.delivered;
    var readyColor = readyCount === pos.length ? 'var(--sw-green)' : poByStatus.draft > 0 ? 'var(--sw-red)' : 'var(--sw-orange)';
    html += '<div style="margin-top:8px;font-size:12px;font-weight:600;color:var(--sw-text-sec);">Purchase Orders</div>';
    html += '<div style="font-size:11px;color:' + readyColor + ';margin-bottom:4px;">';
    html += readyCount + '/' + pos.length + ' confirmed/delivered';
    if (poByStatus.draft > 0) html += ', ' + poByStatus.draft + ' draft';
    if (poByStatus.sent > 0) html += ', ' + poByStatus.sent + ' sent';
    if (awaitingReply > 0) html += ' (' + awaitingReply + ' awaiting reply 48h+)';
    html += '</div>';
    pos.forEach(function(po) {
      var poCardId = 'poDetail_' + po.id;
      html += '<div class="jd-money-card" style="cursor:pointer;" onclick="togglePODetailExpand(\'' + po.id + '\')">';
      html += '<div class="jd-money-card-head">';
      html += '<span>' + (po.po_number || '') + ' — ' + escapeHtml(po.supplier_name || '') + '</span>';
      html += '<strong>' + fmt$(po.total) + '</strong></div>';
      html += '<div class="jd-money-card-sub"><span class="status-badge ' + po.status + '">' + (po.status || '') + '</span>';
      if (po.confirmed_delivery_date) html += ' &middot; Delivery ' + fmtDate(po.confirmed_delivery_date);
      else if (po.delivery_date) html += ' &middot; Req. ' + fmtDate(po.delivery_date);
      // Email count preview
      var poEmails = po.communications || po.email_threads || [];
      if (poEmails.length > 0) {
        var lastPE = poEmails[poEmails.length - 1];
        var lastPEPreview = (lastPE.subject || lastPE.body_text || '').slice(0, 40);
        html += ' &middot; <span style="color:var(--sw-mid);">' + poEmails.length + ' email' + (poEmails.length > 1 ? 's' : '') + '</span>';
      }
      html += '</div>';
      // Expandable detail section
      html += '<div id="' + poCardId + '" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--sw-border);font-size:11px;">';
      // Line items
      if (po.line_items && po.line_items.length > 0) {
        html += '<div style="font-weight:600;margin-bottom:4px;color:var(--sw-dark);">Line Items</div>';
        po.line_items.forEach(function(li) {
          html += '<div style="display:flex;gap:6px;padding:2px 0;color:var(--sw-text-sec);">';
          html += '<span style="flex:1;">' + escapeHtml(li.description || '') + '</span>';
          if (li.quantity) html += '<span>' + li.quantity + (li.unit ? ' ' + li.unit : '') + '</span>';
          if (li.total) html += '<span style="font-weight:600;">' + fmt$(li.total) + '</span>';
          html += '</div>';
        });
      }
      // Email thread
      if (poEmails.length > 0) {
        html += '<div style="font-weight:600;margin:8px 0 4px;color:var(--sw-dark);">Email Thread</div>';
        poEmails.forEach(function(em) {
          var dir = em.direction === 'inbound' ? '&#8601; Received' : '&#8599; Sent';
          var emDate = em.created_at ? fmtDate(em.created_at) : '';
          html += '<div style="padding:4px 0;border-bottom:1px solid var(--sw-border);">';
          html += '<div style="display:flex;gap:6px;align-items:center;">';
          html += '<span style="color:var(--sw-mid);font-weight:600;">' + dir + '</span>';
          html += '<span style="color:var(--sw-text-sec);">' + emDate + '</span>';
          if (em.from_email) html += '<span style="color:var(--sw-text-sec);">' + escapeHtml(em.from_email) + '</span>';
          html += '</div>';
          if (em.subject) html += '<div style="font-weight:600;color:var(--sw-dark);">' + escapeHtml(em.subject) + '</div>';
          if (em.body_text) html += '<div style="color:var(--sw-text-sec);white-space:pre-wrap;max-height:80px;overflow:auto;">' + escapeHtml(em.body_text.slice(0, 300)) + '</div>';
          if (em.attachments && em.attachments.length > 0) {
            em.attachments.forEach(function(att) {
              html += '<a href="' + escapeHtml(att.url || '') + '" target="_blank" style="font-size:10px;color:var(--sw-mid);">&#128206; ' + escapeHtml(att.filename || 'Attachment') + '</a> ';
            });
          }
          html += '</div>';
        });
      }
      html += '<div style="margin-top:8px;"><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openPOEdit(\'' + po.id + '\')">Open PO</button></div>';
      html += '</div></div>';
    });
  }

  // PO action button
  html += '<div style="margin-top:8px;"><button class="btn btn-secondary btn-sm" onclick="closeJobDetail();openPOModal(\'' + j.id + '\')">+ New PO</button></div>';

  // Xero project
  if (data.xero_project) {
    html += '<div class="jd-money-card" style="border-color:var(--sw-mid);"><div class="jd-money-card-head"><span>Xero Project</span></div>';
    html += '<div class="jd-money-card-sub">' + (data.xero_project.project_name || '') + '</div>';
    html += '<div class="jd-money-card-sub">Invoiced: ' + fmt$(data.xero_project.total_invoiced) + ' | Expenses: ' + fmt$(data.xero_project.total_expenses) + '</div></div>';
  }
  html += '</div></div>';

  // ── Labour Cost Section ──
  var assignments = data.assignments || [];
  var labourPOs = pos.filter(function(po) {
    return (po.category || '').toLowerCase() === 'labour' ||
           (po.supplier_name || '').toLowerCase().includes('labour') ||
           (po.description || '').toLowerCase().includes('labour');
  });
  var labourBudget = labourPOs.reduce(function(s, po) { return s + (po.total || 0); }, 0);

  // Group assignments by crew member and calculate hours
  var crewHours = {};
  assignments.forEach(function(a) {
    if (a.status === 'cancelled') return;
    var name = cleanCrewName(a.crew_name || a.users?.name || 'Unknown');
    if (!crewHours[name]) crewHours[name] = { hours: 0, days: 0, rate: 0, verified: 0, unverified: 0 };
    crewHours[name].days++;
    // Use server-side hours_worked (breaks subtracted) if available
    if (a.hours_worked) {
      crewHours[name].hours += parseFloat(a.hours_worked) || 0;
      crewHours[name].verified++;
    } else if (a.clocked_on_at && a.clocked_off_at) {
      var hrs = (new Date(a.clocked_off_at) - new Date(a.clocked_on_at)) / 3600000;
      var breaks = (a.break_minutes || 0) / 60;
      crewHours[name].hours += Math.round((hrs - breaks) * 100) / 100;
      crewHours[name].verified++;
    } else if (a.clocked_on && a.clocked_off) {
      // Legacy fallback
      var hrs2 = (new Date(a.clocked_off) - new Date(a.clocked_on)) / 3600000;
      crewHours[name].hours += Math.round(hrs2 * 10) / 10;
      crewHours[name].verified++;
    } else if (a.clocked_on_at && !a.clocked_off_at) {
      // Currently on site — show live hours
      var liveHrs = (Date.now() - new Date(a.clocked_on_at).getTime()) / 3600000;
      crewHours[name].hours += Math.round(liveHrs * 10) / 10;
      crewHours[name].live = true;
    } else if (a.status === 'complete') {
      crewHours[name].hours += 8; // Default 8hr day estimate
      crewHours[name].unverified++;
    }
  });

  var crewNames = Object.keys(crewHours);
  if (crewNames.length > 0) {
    html += '<div style="margin-top:16px;padding-top:12px;border-top:2px solid var(--sw-border);">';
    html += '<div style="font-size:13px;font-weight:700;color:var(--sw-dark);margin-bottom:8px;">Labour' + (labourBudget > 0 ? ' — ' + fmt$(labourBudget) + ' budgeted' : '') + '</div>';

    var totalLabourCost = 0;
    crewNames.forEach(function(name) {
      var c = crewHours[name];
      // Look up trade rate from work_orders or use default
      var rate = 0;
      var wos = data.work_orders || [];
      wos.forEach(function(wo) {
        if (wo.trade_name && cleanCrewName(wo.trade_name) === name && wo.hourly_rate) {
          rate = parseFloat(wo.hourly_rate) || 0;
        }
      });
      if (!rate) rate = 45; // Default $45/hr
      c.rate = rate;
      var cost = c.hours * rate;
      totalLabourCost += cost;

      var verifiedLabel = c.live ? 'On site now' : c.verified > 0 ? (c.unverified > 0 ? 'Partial' : 'Verified') : (c.hours > 0 ? 'Estimated' : '');
      var verifiedColor = c.live ? 'var(--sw-green)' : c.verified > 0 && c.unverified === 0 ? 'var(--sw-green)' : 'var(--sw-orange)';

      html += '<div class="jd-money-card"><div class="jd-money-card-head">';
      html += '<span>' + escapeHtml(name) + '</span>';
      html += '<strong>' + fmt$(cost) + '</strong></div>';
      html += '<div class="jd-money-card-sub">';
      html += c.days + ' day' + (c.days > 1 ? 's' : '') + ' &middot; ' + c.hours + 'h &times; $' + rate + '/hr';
      if (verifiedLabel) html += ' &middot; <span style="color:' + verifiedColor + '">' + verifiedLabel + ' &#10003;</span>';
      html += '</div></div>';
    });

    // Total and budget comparison
    html += '<div class="jd-money-card" style="border-color:var(--sw-dark);"><div class="jd-money-card-head">';
    html += '<span style="font-weight:700;">Total Labour</span>';
    html += '<strong>' + fmt$(totalLabourCost) + '</strong></div>';
    if (labourBudget > 0) {
      var labourDiff = totalLabourCost - labourBudget;
      var labourPct = Math.round(labourDiff / labourBudget * 100);
      var remaining = labourBudget - totalLabourCost;
      var labourWarnColor = labourPct > 25 ? 'var(--sw-red)' : labourPct > 10 ? 'var(--sw-orange)' : 'var(--sw-green)';
      html += '<div class="jd-money-card-sub" style="color:' + labourWarnColor + '">';
      if (remaining >= 0) {
        html += 'Remaining: ' + fmt$(remaining) + ' (' + Math.abs(labourPct) + '% used)';
      } else {
        html += 'Over budget by ' + fmt$(Math.abs(remaining)) + ' (' + labourPct + '% over)';
      }
      html += '</div>';
    }
    html += '</div></div>';
  }

  // ── Trade Invoices for this job ──
  var jobId = j.id;
  html += '<div id="jdTradeInvoices"></div>';
  // Load async
  loadJobTradeInvoices(jobId);

  // Margin bar
  if (quoteVal > 0) {
    var costBarPct = Math.min(100, poCosts / quoteVal * 100);
    html += '<div class="jd-margin-bar-wrap">';
    html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-bottom:4px;">Cost vs Quote</div>';
    html += '<div class="jd-margin-bar"><div class="jd-margin-bar-cost" style="width:' + costBarPct + '%;background:' + marginColor + '"></div>';
    html += '<span class="jd-margin-bar-label" style="color:' + marginColor + '">Margin: ' + marginPct + '%</span></div>';
    html += '</div>';
  }

  document.getElementById('jdMoney').innerHTML = html;
}

async function loadJobTradeInvoices(jobId) {
  var el = document.getElementById('jdTradeInvoices');
  if (!el) return;
  try {
    var resp = await opsFetch('list_trade_invoice_lines', { job_id: jobId });
    var lines = resp.lines || [];
    if (lines.length === 0) { el.innerHTML = ''; return; }

    var html = '<div style="margin-top:16px;padding-top:12px;border-top:2px solid var(--sw-border);">';
    html += '<div style="font-size:13px;font-weight:700;color:var(--sw-dark);margin-bottom:8px;">Trade Invoices</div>';

    lines.forEach(function(line) {
      var statusColors = {
        pending: 'var(--sw-orange)',
        acknowledged: 'var(--sw-green)',
        queried: 'var(--sw-red)',
      };
      var statusLabel = line.acknowledgment_status || 'pending';
      var statusColor = statusColors[statusLabel] || 'var(--sw-text-sec)';
      var invStatus = line.trade_invoices?.status || '';

      html += '<div class="jd-money-card"><div class="jd-money-card-head">';
      html += '<span>' + escapeHtml(line.trade_name || 'Trade') + ' — WK' + (line.week_label || '') + '</span>';
      html += '<strong>' + fmt$(line.line_total_ex) + '</strong></div>';
      html += '<div class="jd-money-card-sub">';
      html += line.total_hours + 'h @ $' + line.hourly_rate + '/hr';
      html += ' &middot; <span style="color:' + statusColor + ';font-weight:600;">' + statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1) + '</span>';
      if (invStatus === 'pushed_to_xero') html += ' &middot; <span style="color:var(--sw-green);">In Xero</span>';
      html += '</div>';

      // Acknowledge/Query buttons for pending lines (ops can do this)
      if (statusLabel === 'pending') {
        html += '<div style="display:flex;gap:6px;margin-top:6px;">';
        html += '<button class="btn btn-sm" style="background:var(--sw-green);color:#fff;font-size:11px;" onclick="acknowledgeInvoiceLine(\'' + line.id + '\',true)">Acknowledge</button>';
        html += '<button class="btn btn-sm" style="background:var(--sw-red);color:#fff;font-size:11px;" onclick="acknowledgeInvoiceLine(\'' + line.id + '\',false)">Query</button>';
        html += '</div>';
      }

      html += '</div>';
    });

    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '';
  }
}

async function acknowledgeInvoiceLine(lineId, approved) {
  var note = '';
  if (!approved) {
    note = prompt('Reason for query:');
    if (note === null) return; // Cancelled
  }
  try {
    await opsPost('acknowledge_invoice_line', { line_id: lineId, acknowledged: approved, query_note: note || undefined });
    showToast(approved ? 'Acknowledged' : 'Query sent', 'success');
    if (_currentJobData?.job?.id) openJobDetail(_currentJobData.job.id);
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}

// ── Build View ──

function renderBuildView(data) {
  var j = data.job;
  var html = '';

  // Miscellaneous jobs: show description + line items instead of scope tool
  if (j.type === 'miscellaneous' && j.pricing_json && j.pricing_json.source === 'quick_quote') {
    var pj = j.pricing_json;
    // Quote lifecycle status pill
    var qs = j.status === 'invoiced' ? 'invoiced' : j.status === 'accepted' ? 'accepted' : j.quoted_at ? 'sent' : 'draft';
    var qsColors = { draft: '#95A5A6', sent: '#3498DB', accepted: '#E67E22', invoiced: '#27AE60' };
    var qsLabels = { draft: 'Quote Draft', sent: 'Quote Sent', accepted: 'Accepted', invoiced: 'Invoiced' };
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">';
    html += '<span style="font-size:14px;font-weight:700;">Job Details</span>';
    html += '<span style="font-size:10px;padding:2px 8px;border-radius:3px;background:' + (qsColors[qs] || '#999') + '20;color:' + (qsColors[qs] || '#999') + ';font-weight:600;text-transform:uppercase;">' + (qsLabels[qs] || qs) + '</span>';
    if (qs === 'draft' || qs === 'sent') {
      html += '<button class="btn btn-sm" style="font-size:10px;background:var(--sw-green);color:#fff;margin-left:auto;" onclick="sendQuickQuoteToClient(\'' + j.id + '\')">&#9993; Send to Client</button>';
    }
    html += '</div>';
    if (pj.job_type_label) html += '<div style="margin-bottom:4px;"><strong>Type:</strong> ' + escapeHtml(pj.job_type_label) + '</div>';
    if (pj.job_description) html += '<div style="margin-bottom:8px;white-space:pre-wrap;font-size:13px;">' + escapeHtml(pj.job_description) + '</div>';
    if (pj.reference) html += '<div style="margin-bottom:8px;font-size:12px;color:var(--sw-text-sec);">Ref: ' + escapeHtml(pj.reference) + '</div>';
    if (pj.line_items && pj.line_items.length > 0) {
      html += '<div style="font-size:13px;font-weight:600;margin:12px 0 6px;">Line Items</div>';
      html += '<table class="data-table" style="font-size:12px;"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead><tbody>';
      pj.line_items.forEach(function(li) {
        html += '<tr><td>' + escapeHtml(li.description) + '</td><td>' + li.quantity + '</td><td>' + li.unit + '</td><td style="text-align:right">' + fmt$(li.unit_price) + '</td><td style="text-align:right">' + fmt$(li.total) + '</td></tr>';
      });
      html += '</tbody></table>';
      html += '<div style="text-align:right;margin-top:6px;font-size:13px;"><strong>Total inc GST: ' + fmt$(pj.totalIncGST) + '</strong></div>';
    }
    if (pj.client_notes) html += '<div style="margin-top:8px;font-size:12px;"><strong>Client Notes:</strong> ' + escapeHtml(pj.client_notes) + '</div>';
    if (pj.internal_notes) html += '<div style="margin-top:4px;font-size:12px;color:var(--sw-text-sec);"><strong>Internal:</strong> ' + escapeHtml(pj.internal_notes) + '</div>';
    document.getElementById('jdBuild').innerHTML = html;
    return;
  }

  // 3D Scope Viewer iframe (above scope summary)
  if (j.scope_json && j.type !== 'miscellaneous') {
    var viewerBaseUrl = j.type === 'fencing'
      ? 'https://secureworks-group.github.io/fence-designer/'
      : 'https://secureworks-group.github.io/patio/';
    var viewerJobId = j.id || '';
    if (viewerJobId) {
      html += '<div style="margin-bottom:12px;position:relative;">';
      html += '<div id="scopeViewerLoading" style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;background:var(--sw-bg-card,#f8fafc);border:1px solid #e2e8f0;border-radius:8px;z-index:1;font-size:12px;color:var(--sw-text-sec,#86868B);">';
      html += '<span>Loading 3D scope viewer...</span></div>';
      html += '<iframe src="' + viewerBaseUrl + '?jobId=' + viewerJobId + '" ';
      html += 'style="width:100%;height:400px;border:1px solid #e2e8f0;border-radius:8px;display:block;background:#f0f0f0;" ';
      html += 'frameborder="0" allowfullscreen ';
      html += 'onload="var el=document.getElementById(\'scopeViewerLoading\');if(el)el.style.display=\'none\';">';
      html += '</iframe></div>';
    }
  }

  // Scope summary
  if (j.scope_json) {
    html += '<div style="font-size:14px;font-weight:700;margin-bottom:8px;">Scope Summary</div>';
    html += renderScopeSummary(j.scope_json, j.type, j.id);
  }

  // Site plan thumbnail (compact) in build view
  if (j.scope_json && j.type !== 'miscellaneous') {
    html += renderSitePlanPanel(j.scope_json, true);
  }

  // Scope photos strip
  var buildPhotos = (data.media || []).filter(function(m) { return m.phase !== 'receipt'; });
  if (buildPhotos.length > 0) {
    window._buildPhotos = buildPhotos;
    html += '<div style="font-size:14px;font-weight:700;margin-top:12px;margin-bottom:6px;">Site Photos (' + buildPhotos.length + ')</div>';
    html += '<div class="jd-photo-strip">';
    buildPhotos.forEach(function(m, idx) {
      var src = m.thumbnail_url || m.storage_url;
      html += '<div class="jd-photo-strip-item" onclick="openLightbox(window._buildPhotos,' + idx + ')">';
      html += '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(m.label || m.phase || '') + '">';
      if (m.label || m.phase) html += '<span class="jd-photo-phase">' + escapeHtml(m.label || m.phase) + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  // Work Order documents
  html += renderDocumentLinks(data.documents, ['work_order'], '&#128203; Work Orders');

  // Material Order documents
  html += renderDocumentLinks(data.documents, ['material_order', 'supplier_quote'], '&#128230; Material Documents');

  // Materials readiness
  html += '<div style="font-size:14px;font-weight:700;margin-top:16px;margin-bottom:8px;display:flex;align-items:center;gap:8px;">Materials Readiness <button class="btn btn-secondary btn-sm" onclick="closeJobDetail();openPOModal(\'' + j.id + '\')" style="font-size:10px;">+ New PO</button></div>';
  var categories = getMaterialCategories(j);
  var materialsHtml = '<div class="jd-materials-grid">';
  categories.forEach(function(cat) {
    var status = matchMaterialStatus(cat, data.purchase_orders || []);
    materialsHtml += '<div class="jd-material-card">';
    materialsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    materialsHtml += '<strong>' + cat.name + '</strong>';
    materialsHtml += '<span class="jd-material-status ' + status.status + '">' + status.status + '</span>';
    materialsHtml += '</div>';
    if (status.poNumber) {
      materialsHtml += '<div style="font-size:11px;color:var(--sw-text-sec);margin-top:4px;">' + status.poNumber + ' — ' + escapeHtml(status.supplier || '') + '</div>';
    }
    materialsHtml += '</div>';
  });
  materialsHtml += '</div>';
  html += materialsHtml;

  // PO list with expandable review cards for drafts
  if ((data.purchase_orders || []).length > 0) {
    html += '<div style="font-size:14px;font-weight:700;margin-top:16px;margin-bottom:8px;">Purchase Orders (' + data.purchase_orders.length + ')</div>';
    data.purchase_orders.forEach(function(po) {
      if (po.status === 'draft') {
        // Draft PO — expandable review card
        var poType = 'Purchase Order';
        var isCommission = false;
        if (po.notes) {
          if (po.notes.indexOf('MATERIALS') !== -1) poType = 'Materials PO';
          else if (po.notes.indexOf('LABOUR') !== -1) poType = 'Labour PO';
          if (po.notes.indexOf('SALES COMMISSION') !== -1 || po.notes.indexOf('Commission') !== -1) {
            poType = 'Commission PO';
            isCommission = true;
          }
        }

        var items = [];
        try { items = typeof po.line_items === 'string' ? JSON.parse(po.line_items) : (po.line_items || []); } catch(e) {}
        var subtotal = items.reduce(function(sum, item) { return sum + (item.quantity || 1) * (item.unit_price || 0); }, 0);

        html += '<div class="po-review-card" id="poCard' + po.id + '" data-supplier="' + escapeHtml(po.supplier_name || '') + '">';
        html += '<div class="po-review-header" onclick="togglePOCard(\'' + po.id + '\')">';
        html += '<div style="display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap">';
        html += '<span style="font-weight:600">' + poType + '</span>';
        html += '<span class="status-badge draft" style="font-size:11px">Draft</span>';
        html += po.supplier_name ? '<span class="status-badge" style="font-size:11px;background:rgba(52,152,219,0.1);color:var(--sw-blue);">' + escapeHtml(po.supplier_name) + '</span>' : '<span class="status-badge" style="font-size:11px;background:#F15A29;color:#fff">Needs Supplier</span>';
        if (po.po_number) html += '<span style="font-size:11px;color:var(--sw-text-sec)">' + po.po_number + '</span>';
        html += '</div>';
        html += '<span style="font-weight:600;font-family:var(--sw-font-num);">$' + subtotal.toFixed(2) + '</span>';
        html += '<span class="po-card-chevron" id="poChevron' + po.id + '">&#9660;</span>';
        html += '</div>';

        // Expandable body (hidden by default)
        html += '<div class="po-review-body" id="poBody' + po.id + '" style="display:none">';

        // Line items table
        html += '<div style="overflow-x:auto">';
        html += '<table class="po-items-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>';
        items.forEach(function(item) {
          var lineTotal = (item.quantity || 1) * (item.unit_price || 0);
          html += '<tr><td>' + escapeHtml(item.description || '') + '</td><td>' + (item.quantity || 1) + '</td><td>' + (item.unit || 'ea') + '</td><td>$' + (item.unit_price || 0).toFixed(2) + '</td><td>$' + lineTotal.toFixed(2) + '</td></tr>';
        });
        html += '<tr class="po-subtotal-row"><td colspan="4" style="text-align:right;font-weight:600">Subtotal</td><td style="font-weight:600">$' + subtotal.toFixed(2) + '</td></tr>';
        html += '</tbody></table>';
        html += '</div>';

        // Inline supplier picker + actions
        html += '<div class="po-review-actions">';
        html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
        html += '<select id="poSupplierPick' + po.id + '" class="form-input" style="max-width:220px;font-size:13px;padding:6px 8px"><option value="">Select supplier...</option></select>';
        if (poType === 'Materials PO') {
          html += '<input type="date" id="poDeliveryPick' + po.id + '" class="form-input" style="max-width:160px;font-size:13px;padding:6px 8px" placeholder="Delivery date">';
        }
        html += '</div>';

        // Action buttons
        html += '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">';
        if (!isCommission) {
          html += '<button class="btn btn-sm btn-primary" onclick="quickApprovePO(\'' + po.id + '\', false)">Approve as Draft in Xero</button>';
          html += '<button class="btn btn-sm btn-success" onclick="approveAndComposePO(\'' + po.id + '\')">Approve &amp; Send to Supplier</button>';
        }
        html += '<button class="btn btn-sm btn-outline" onclick="openPOEdit(\'' + po.id + '\')">Edit Full PO</button>';
        html += '</div>';
        html += '</div>';  // po-review-actions
        html += '</div>';  // po-review-body
        html += '</div>';  // po-review-card
      } else {
        // Non-draft POs — shared compact card with expand/thread/reply
        html += (typeof renderPOCardCompact === 'function') ? renderPOCardCompact(po) :
          '<div style="padding:8px 0;border-bottom:1px solid var(--sw-border);font-size:13px;">' +
          '<strong>' + (po.po_number || '') + '</strong> — ' + escapeHtml(po.supplier_name || '') + ' ' + fmt$(po.total) + '</div>';
      }
    });
  }

  // Assignments
  html += '<div style="font-size:14px;font-weight:700;margin-top:16px;margin-bottom:8px;display:flex;align-items:center;gap:8px;">Crew Assignments (' + (data.assignments || []).length + ') <button class="btn btn-secondary btn-sm" onclick="openActionSheet(\'Assign\')" style="font-size:10px;">+ Assign Crew</button></div>';
  if ((data.assignments || []).length > 0) {
    data.assignments.forEach(function(a) {
      html += '<div style="padding:8px 0;border-bottom:1px solid var(--sw-border);font-size:13px;display:flex;align-items:center;gap:8px;">';
      html += '<div style="flex:1;">';
      html += '<strong>' + fmtDate(a.scheduled_date) + '</strong>';
      if (a.scheduled_end) html += ' — ' + fmtDate(a.scheduled_end);
      if (a.users?.name) html += ' &middot; ' + a.users.name;
      if (a.crew_name) html += ' (' + cleanCrewName(a.crew_name) + ')';
      html += ' <span class="status-badge ' + a.status + '">' + a.status + '</span>';
      html += '</div>';
      if (a.status !== 'complete' && a.status !== 'cancelled') {
        html += '<button class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 8px;" onclick="markAssignmentComplete(\'' + a.id + '\',\'' + j.id + '\')">&#9989;</button>';
      }
      html += '</div>';
    });
  } else {
    html += '<div style="font-size:12px;color:var(--sw-text-sec);">No assignments yet</div>';
  }

  // Work Orders
  if ((data.work_orders || []).length > 0) {
    html += '<div style="font-size:14px;font-weight:700;margin-top:16px;margin-bottom:8px;">Work Orders (' + data.work_orders.length + ')</div>';
    data.work_orders.forEach(function(wo) {
      html += '<div style="padding:6px 0;border-bottom:1px solid var(--sw-border);font-size:13px;">';
      html += '<strong>' + (wo.wo_number || '') + '</strong>';
      if (wo.trade_name) html += ' — ' + wo.trade_name;
      html += ' <span class="status-badge ' + wo.status + '">' + wo.status + '</span>';
      html += '</div>';
    });
  }

  // Labour Reconciliation placeholder — loads async
  html += '<div id="jdLabourRecon" style="margin-top:16px;"></div>';

  document.getElementById('jdBuild').innerHTML = html;

  // Load labour reconciliation data
  loadLabourReconciliation(j.id);
}

async function loadLabourReconciliation(jobId) {
  var container = document.getElementById('jdLabourRecon');
  if (!container) return;
  try {
    var data = await opsFetch('labour_reconciliation', { job_id: jobId });
    var recon = data.reconciliation || data;
    var budget = recon.labour_budget || 0;
    var hoursLogged = recon.hours_logged || 0;
    var labourCost = recon.labour_cost || 0;
    var remainder = budget - labourCost;
    var trades = recon.trades || [];

    var html = '<div style="font-size:14px;font-weight:700;margin-bottom:8px;">Labour Reconciliation</div>';

    // Summary cards row
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px;">';
    html += '<div style="background:var(--sw-card);border:1px solid var(--sw-border);border-radius:8px;padding:10px;text-align:center;">';
    html += '<div style="font-size:11px;color:var(--sw-text-sec);">Labour Budget</div>';
    html += '<div style="font-size:16px;font-weight:700;font-family:var(--sw-font-num);color:var(--sw-mid);">' + fmt$(budget) + '</div></div>';
    html += '<div style="background:var(--sw-card);border:1px solid var(--sw-border);border-radius:8px;padding:10px;text-align:center;">';
    html += '<div style="font-size:11px;color:var(--sw-text-sec);">Hours Logged</div>';
    html += '<div style="font-size:16px;font-weight:700;font-family:var(--sw-font-num);">' + hoursLogged.toFixed(1) + 'h</div></div>';
    html += '<div style="background:var(--sw-card);border:1px solid var(--sw-border);border-radius:8px;padding:10px;text-align:center;">';
    html += '<div style="font-size:11px;color:var(--sw-text-sec);">Labour Cost</div>';
    html += '<div style="font-size:16px;font-weight:700;font-family:var(--sw-font-num);color:var(--sw-red);">' + fmt$(labourCost) + '</div></div>';
    html += '<div style="background:var(--sw-card);border:1px solid var(--sw-border);border-radius:8px;padding:10px;text-align:center;">';
    html += '<div style="font-size:11px;color:var(--sw-text-sec);">Remainder</div>';
    html += '<div style="font-size:16px;font-weight:700;font-family:var(--sw-font-num);color:' + (remainder >= 0 ? 'var(--sw-green)' : 'var(--sw-red)') + ';">' + fmt$(remainder) + '</div></div>';
    html += '</div>';

    // Trades table
    if (trades.length > 0) {
      html += '<table class="data-table" style="font-size:12px;width:100%;"><thead><tr><th>Trade</th><th style="text-align:right">Hours</th><th style="text-align:right">Rate</th><th style="text-align:right">Cost</th></tr></thead><tbody>';
      trades.forEach(function(t) {
        html += '<tr><td>' + escapeHtml(t.name || '') + '</td>';
        html += '<td style="text-align:right;font-family:var(--sw-font-num);">' + (t.hours || 0).toFixed(1) + '</td>';
        html += '<td style="text-align:right;font-family:var(--sw-font-num);">' + fmt$(t.rate || 0) + '/h</td>';
        html += '<td style="text-align:right;font-family:var(--sw-font-num);">' + fmt$(t.cost || 0) + '</td></tr>';
      });
      html += '</tbody></table>';
    } else if (budget === 0 && hoursLogged === 0) {
      html += '<div style="font-size:12px;color:var(--sw-text-sec);">No labour data recorded yet</div>';
    }

    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div style="font-size:12px;color:var(--sw-text-sec);">Labour data unavailable</div>';
    console.error('Labour reconciliation error:', e);
  }
}

function getMaterialCategories(job) {
  var scope = job.scope_json;
  if (typeof scope === 'string') { try { scope = JSON.parse(scope); } catch(e) { scope = null; } }
  if (!scope) return [];

  if (job.type === 'fencing') {
    var cats = [];
    cats.push({ name: 'Panels & Posts', keywords: ['panel', 'sheet', 'post', 'rail'] });
    if (scope.sections && scope.sections.some(function(s) { return s.retaining; })) {
      cats.push({ name: 'Plinths / Sleepers', keywords: ['plinth', 'sleeper'] });
    }
    if (scope.gates && scope.gates.length > 0) {
      cats.push({ name: 'Gate Kits', keywords: ['gate'] });
    }
    cats.push({ name: 'Concrete', keywords: ['concrete', 'footing', 'boral'] });
    cats.push({ name: 'Fixings', keywords: ['fixing', 'screw', 'bracket', 'rivet'] });
    return cats;
  }

  // Patio/Decking
  var config = scope.config || scope;
  var cats = [];
  if (config.roofing || config.panel_type) {
    cats.push({ name: 'Roofing Panels', keywords: ['panel', 'solarspan', 'trimdek', 'spandek', 'corrugated'] });
  }
  cats.push({ name: 'Steel (Beams + Posts)', keywords: ['beam', 'post', 'shs', 'steel'] });
  cats.push({ name: 'Flashings', keywords: ['flash'] });
  cats.push({ name: 'Footings (Concrete)', keywords: ['concrete', 'footing', 'boral'] });
  if (config.gutters) {
    cats.push({ name: 'Gutters / Downpipes', keywords: ['gutter', 'downpipe'] });
  }
  return cats;
}

function matchMaterialStatus(category, purchaseOrders) {
  var matchedPO = null;
  purchaseOrders.forEach(function(po) {
    if (matchedPO) return;
    var items = po.line_items || [];
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
    var poDesc = ((po.supplier_name || '') + ' ' + items.map(function(i) { return i.description || i.name || ''; }).join(' ')).toLowerCase();
    var matched = category.keywords.some(function(kw) { return poDesc.indexOf(kw) >= 0; });
    if (matched) matchedPO = po;
  });

  if (!matchedPO) return { status: 'missing' };
  var s = (matchedPO.status || '').toLowerCase();
  if (s === 'billed') return { status: 'delivered', poNumber: matchedPO.po_number, supplier: matchedPO.supplier_name };
  if (s === 'submitted' || s === 'authorised') return { status: 'ordered', poNumber: matchedPO.po_number, supplier: matchedPO.supplier_name };
  return { status: 'draft', poNumber: matchedPO.po_number, supplier: matchedPO.supplier_name };
}

// ── Files View ──

function renderFilesView(data) {
  var j = data.job;
  var html = '';

  // ── Readiness Checklist (from backend) ──
  var readiness = data.readiness;
  if (readiness) {
    var statusColors = { blocked: '#EF4444', at_risk: '#F59E0B', ready: '#22C55E' };
    var statusLabels = { blocked: 'Blocked', at_risk: 'At Risk', ready: 'Ready' };
    var statusIcons = { blocked: '&#128308;', at_risk: '&#128992;', ready: '&#128994;' };

    html += '<div style="margin-bottom:16px;padding:12px;background:var(--sw-light);border-radius:8px;border-left:3px solid ' + (statusColors[readiness.status] || '#6B7280') + '">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
    html += '<div style="font-size:14px;font-weight:700">Job Readiness</div>';
    html += '<div style="font-size:12px;font-weight:700;color:' + (statusColors[readiness.status] || '#6B7280') + '">' + statusIcons[readiness.status] + ' ' + (statusLabels[readiness.status] || readiness.status) + ' &middot; ' + readiness.score + '%</div>';
    html += '</div>';

    // Show all items grouped by severity
    var allItems = [].concat(readiness.blockers || [], readiness.warnings || [], readiness.completeness || []);
    allItems.forEach(function(item) {
      var icon = item.met ? '&#9989;' : (item.severity === 'blocker' ? '&#128308;' : item.severity === 'warning' ? '&#128992;' : '&#9898;');
      var textStyle = item.met ? 'color:var(--sw-text-sec);' : (item.severity === 'blocker' ? 'color:#EF4444;font-weight:600;' : item.severity === 'warning' ? 'color:#D97706;' : 'color:var(--sw-text-sec);');
      html += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;' + textStyle + '">';
      html += '<span>' + icon + '</span>';
      html += '<span' + (item.met ? ' style="text-decoration:line-through;opacity:0.6"' : '') + '>' + escapeHtml(item.label) + '</span>';
      if (!item.met && item.severity !== 'optional') {
        html += '<span style="font-size:10px;text-transform:uppercase;letter-spacing:0.3px;opacity:0.7">' + item.severity + '</span>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // Photos
  var jobPhotos = (data.media || []).filter(function(m) { return m.phase !== 'receipt'; });
  var receiptPhotos = (data.media || []).filter(function(m) { return m.phase === 'receipt'; });

  // Store for lightbox access
  window._jdJobPhotos = jobPhotos;
  window._jdReceiptPhotos = receiptPhotos;

  if (jobPhotos.length > 0) {
    html += '<div style="font-size:14px;font-weight:700;margin-bottom:8px;">Photos (' + jobPhotos.length + ')</div>';
    html += '<div class="jd-photo-grid">';
    jobPhotos.forEach(function(m, idx) {
      var src = m.thumbnail_url || m.storage_url;
      html += '<div class="jd-photo-item">';
      html += '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(m.label || m.phase || '') + '" onclick="openLightbox(window._jdJobPhotos,' + idx + ')">';
      if (m.phase) html += '<span class="jd-photo-phase">' + m.phase + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  // Receipts
  if (receiptPhotos.length > 0) {
    var poLookup = {};
    (data.purchase_orders || []).forEach(function(po) { poLookup[po.id] = po.po_number; });
    html += '<div style="font-size:14px;font-weight:700;margin-top:16px;margin-bottom:8px;">Receipts (' + receiptPhotos.length + ')</div>';
    html += '<div class="jd-photo-grid">';
    receiptPhotos.forEach(function(m, idx) {
      var src = m.thumbnail_url || m.storage_url;
      var poLabel = m.po_id && poLookup[m.po_id] ? poLookup[m.po_id] : 'No PO';
      html += '<div class="jd-photo-item">';
      html += '<img src="' + escapeHtml(src) + '" alt="Receipt" onclick="openLightbox(window._jdReceiptPhotos,' + idx + ')">';
      html += '<span class="jd-photo-phase">' + poLabel + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  // ── Upload Documents ──
  html += '<div style="margin-top:16px;margin-bottom:16px">';
  html += '<div style="font-size:14px;font-weight:700;margin-bottom:8px">Upload Files</div>';
  html += '<div id="jdUploadArea" style="border:2px dashed var(--sw-border);border-radius:10px;padding:20px;text-align:center;cursor:pointer;background:var(--sw-light);transition:border-color 0.2s" onclick="document.getElementById(\'jdFileInput\').click()" ondragover="event.preventDefault();this.style.borderColor=\'var(--sw-orange)\'" ondragleave="this.style.borderColor=\'var(--sw-border)\'" ondrop="event.preventDefault();this.style.borderColor=\'var(--sw-border)\';handleDocDrop(event)">';
  html += '  <div style="font-size:24px;margin-bottom:4px">&#128206;</div>';
  html += '  <div style="font-size:13px;color:var(--sw-text-sec)">Drag files here or tap to upload</div>';
  html += '  <div style="font-size:11px;color:var(--sw-text-sec);margin-top:2px">Photos, PDFs, videos</div>';
  html += '</div>';
  html += '<input type="file" id="jdFileInput" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" style="display:none" onchange="handleDocFiles(this.files)">';
  html += '<div id="jdUploadQueue" style="margin-top:8px"></div>';
  html += '</div>';

  // Documents — with visibility controls, thumbnails, delete
  var allDocs = data.documents || [];
  if (allDocs.length > 0) {
    html += '<div style="font-size:14px;font-weight:700;margin-top:16px;margin-bottom:8px;">Documents (' + allDocs.length + ')</div>';
    allDocs.forEach(function(doc) {
      var url = doc.storage_url || doc.pdf_url;
      var name = doc.file_name || doc.type || 'Document';
      var isVisible = doc.visible_to_trades;

      // Type badge colours
      var typeColors = {
        council_plans: '#8B5CF6', engineering: '#3B82F6', work_order: '#F59E0B',
        supplier_quote: '#EF4444', site_photo: '#10B981', approval: '#6366F1',
        quote: '#F97316', general: '#6B7280', client_reference: '#0EA5E9',
        asbestos: '#DC2626', other: '#9CA3AF'
      };
      var badgeColor = typeColors[doc.type] || '#6B7280';

      // File type icon
      var fileIcon = '&#128196;'; // default doc
      if (name && /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(name)) fileIcon = '&#128247;';
      else if (name && /\.pdf$/i.test(name)) fileIcon = '&#128213;';
      else if (name && /\.(mp4|mov|avi|webm)$/i.test(name)) fileIcon = '&#127909;';
      else if (name && /\.(doc|docx)$/i.test(name)) fileIcon = '&#128462;';
      else if (name && /\.(xls|xlsx)$/i.test(name)) fileIcon = '&#128202;';

      html += '<div style="padding:8px 0;border-bottom:1px solid var(--sw-border);font-size:13px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;">';

      // Thumbnail or file icon
      if (url && /\.(jpg|jpeg|png|gif|webp)$/i.test(name)) {
        html += '<img src="' + escapeHtml(url) + '" style="width:32px;height:32px;object-fit:cover;border-radius:3px;cursor:pointer;flex-shrink:0" onclick="openLightbox([{storage_url:\'' + escapeHtml(url) + '\',label:\'' + escapeHtml(name).replace(/'/g, "\\'") + '\'}],0)">';
      } else {
        html += '<span style="font-size:20px;flex-shrink:0;width:32px;text-align:center">' + fileIcon + '</span>';
      }

      // Type badge
      html += '<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;padding:2px 6px;border-radius:3px;background:' + badgeColor + '20;color:' + badgeColor + ';white-space:nowrap">' + escapeHtml((doc.type || 'general').replace(/_/g, ' ')) + '</span>';

      // File name
      html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(name) + '</span>';

      // Version
      if (doc.version > 1) html += '<span style="color:var(--sw-text-sec);font-size:11px;">v' + doc.version + '</span>';

      // Visibility toggle
      html += '<button onclick="toggleDocVisibility(\'' + doc.id + '\', ' + !isVisible + ')" style="background:none;border:1px solid var(--sw-border);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;color:' + (isVisible ? 'var(--sw-green)' : 'var(--sw-text-sec)') + ';white-space:nowrap" title="' + (isVisible ? 'Visible to trades' : 'Hidden from trades') + '">' + (isVisible ? '&#128065; Trades' : '&#128274; Hidden') + '</button>';

      // View button
      if (url) html += '<a href="' + escapeHtml(url) + '" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px;padding:2px 8px;">View</a>';

      // Delete button
      html += '<button onclick="deleteDocument(\'' + doc.id + '\',\'' + escapeHtml(name).replace(/'/g, "\\'") + '\')" style="background:none;border:none;cursor:pointer;padding:4px;font-size:14px;color:var(--sw-text-sec);opacity:0.5" title="Delete">&times;</button>';

      html += '</div>';

      // Date + uploaded by
      var metaLine = '';
      if (doc.created_at) metaLine += fmtDate(doc.created_at);
      if (doc.uploaded_by) metaLine += (metaLine ? ' &middot; ' : '') + escapeHtml(doc.uploaded_by);
      if (metaLine) {
        html += '<div style="font-size:11px;color:var(--sw-text-sec);margin-top:2px;margin-left:40px">' + metaLine + '</div>';
      }
      html += '</div>';
    });
  }

  // Notes
  html += '<div style="font-size:14px;font-weight:700;margin-top:16px;margin-bottom:8px;">Notes</div>';
  var noteEvents = (data.events || []).filter(function(ev) { return ev.event_type === 'note_added'; });
  if (noteEvents.length > 0) {
    html += '<div class="jd-notes-feed">';
    noteEvents.forEach(function(ev) {
      html += '<div class="jd-note-item">';
      html += '<div style="font-size:11px;color:var(--sw-text-sec);">' + (ev.users?.name || '') + ' &middot; ' + new Date(ev.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + '</div>';
      html += '<div>' + escapeHtml(ev.detail_json?.note || ev.detail_json?.text || JSON.stringify(ev.detail_json || '')) + '</div>';
      html += '</div>';
    });
    html += '</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--sw-text-sec);">No notes yet</div>';
  }

  // Note input
  html += '<div class="jd-note-input-wrap">';
  html += '<textarea class="jd-note-input" id="jdNoteInput" placeholder="Add a note..."></textarea>';
  html += '<button class="btn btn-primary btn-sm" onclick="submitJobNote()">Add</button>';
  html += '</div>';

  // ── Thread Documents (from PO and council email attachments) ──
  html += '<div id="jdThreadDocs"></div>';

  if (!readiness && jobPhotos.length === 0 && receiptPhotos.length === 0 && (data.documents || []).length === 0 && noteEvents.length === 0) {
    html = '<div class="empty-state"><div class="empty-state-icon">&#128247;</div><div class="empty-state-text">No files or notes yet</div></div>' + html.slice(html.lastIndexOf('<div class="jd-note-input-wrap">'));
  }

  document.getElementById('jdFiles').innerHTML = html;

  // Async-load thread documents
  loadThreadDocuments(j.id);
}

async function loadThreadDocuments(jobId) {
  var el = document.getElementById('jdThreadDocs');
  if (!el) return;
  try {
    var data = await opsFetch('list_po_communications', { job_id: jobId });
    var comms = data.emails || data || [];
    if (!Array.isArray(comms)) comms = [];

    // Extract all attachments across all threads
    var docs = [];
    comms.forEach(function(em) {
      var atts = em.attachments_json || em.attachments || [];
      if (!Array.isArray(atts)) return;
      atts.forEach(function(att) {
        var isInbound = em.direction === 'inbound' || em.direction === 'received';
        docs.push({
          filename: att.filename || att.name || 'Attachment',
          url: att.storage_url || att.url || att.publicUrl || '',
          who: isInbound ? ('From ' + (em.from_email || '').split('@')[0]) : ('Sent to ' + (em.to_email || '').split('@')[0]),
          date: em.created_at || em.sent_at || '',
          type: em.communication_type || 'purchase_order',
        });
      });
    });

    if (docs.length === 0) { el.innerHTML = ''; return; }

    var html = '<div style="font-size:14px;font-weight:700;margin-top:16px;margin-bottom:8px;">Thread Documents</div>';
    docs.forEach(function(doc) {
      var dateStr = doc.date ? new Date(doc.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '';
      var typeBadge = doc.type === 'council' ? '<span style="font-size:9px;padding:1px 4px;border-radius:2px;background:rgba(128,0,255,0.1);color:#8B5CF6;margin-right:4px;">Council</span>' : '';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--sw-border);font-size:12px;">';
      html += '<span>&#128206;</span>';
      html += '<span style="flex:1;">' + typeBadge + (doc.url ? '<a href="' + escapeHtml(doc.url) + '" target="_blank" style="color:var(--sw-mid);text-decoration:none;">' + escapeHtml(doc.filename) + '</a>' : escapeHtml(doc.filename)) + '</span>';
      html += '<span style="color:var(--sw-text-sec);font-size:11px;">' + escapeHtml(doc.who) + '</span>';
      html += '<span style="color:var(--sw-text-sec);font-size:11px;">' + dateStr + '</span>';
      html += '</div>';
    });
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '';
  }
}

window.handleDocDrop = function(e) {
  var files = e.dataTransfer.files;
  if (files.length > 0) handleDocFiles(files);
};

window.handleDocFiles = function(files) {
  if (!_currentJobData || !_currentJobData.job) return;
  var queue = document.getElementById('jdUploadQueue');

  Array.from(files).forEach(function(file) {
    // Auto-detect type from file name + MIME
    var docType = 'general';
    var fname = file.name.toLowerCase();
    var fmime = (file.type || '').toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|heic)$/i.test(fname) || fmime.startsWith('image/')) docType = 'site_photo';
    else if (/council|permit|approval/i.test(fname)) docType = 'council_plans';
    else if (/engineer|structural|cert/i.test(fname)) docType = 'engineering';
    else if (/quote|supplier/i.test(fname)) docType = 'supplier_quote';
    else if (/work.?order|wo\b/i.test(fname)) docType = 'work_order';
    else if (/asbestos|hazmat/i.test(fname)) docType = 'asbestos';
    else if (/reference|client.?ref/i.test(fname)) docType = 'client_reference';

    // Show upload row with type selector
    var rowId = 'upload_' + Date.now() + '_' + Math.random().toString(36).substr(2,4);
    var rowHtml = '<div id="' + rowId + '" style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--sw-border);font-size:12px">';
    rowHtml += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(file.name) + '</span>';
    rowHtml += '<select id="' + rowId + '_type" style="font-size:11px;padding:2px 4px;border:1px solid var(--sw-border);border-radius:4px">';
    ['site_photo','council_plans','engineering','supplier_quote','work_order','approval','client_reference','asbestos','general','other'].forEach(function(t) {
      rowHtml += '<option value="' + t + '"' + (t === docType ? ' selected' : '') + '>' + t.replace(/_/g, ' ') + '</option>';
    });
    rowHtml += '</select>';
    rowHtml += '<label style="font-size:11px;white-space:nowrap;display:flex;align-items:center;gap:3px"><input type="checkbox" id="' + rowId + '_vis" ' + (['site_photo','council_plans','engineering','work_order','approval'].includes(docType) ? 'checked' : '') + '> Trades</label>';
    rowHtml += '<span id="' + rowId + '_status" style="font-size:11px;color:var(--sw-text-sec)">Ready</span>';
    rowHtml += '</div>';
    queue.insertAdjacentHTML('beforeend', rowHtml);

    // Start upload
    uploadOneDocument(file, _currentJobData.job.id, rowId);
  });
};

window.uploadOneDocument = async function(file, jobId, rowId) {
  var statusEl = document.getElementById(rowId + '_status');
  var typeEl = document.getElementById(rowId + '_type');
  var visEl = document.getElementById(rowId + '_vis');

  try {
    statusEl.textContent = 'Uploading...';
    statusEl.style.color = 'var(--sw-orange)';

    var docType = typeEl ? typeEl.value : 'general';
    var visible = visEl ? visEl.checked : false;

    // 1. Get signed upload URL
    var urlData = await opsPost('upload_document', {
      jobId: jobId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      type: docType,
      visible_to_trades: visible,
    });

    // 2. Upload binary
    var uploadResp = await fetch(urlData.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!uploadResp.ok) throw new Error('Upload failed: ' + uploadResp.status);

    // 3. Confirm upload
    await opsPost('confirm_document_upload', {
      jobId: jobId,
      publicUrl: urlData.publicUrl,
      path: urlData.path,
      fileName: file.name,
      type: docType,
      visible_to_trades: visible,
    });

    statusEl.textContent = 'Done';
    statusEl.style.color = 'var(--sw-green)';

    // Refresh files view after short delay
    setTimeout(function() {
      if (_currentJobId) {
        openJobDetail(_currentJobId);
      }
    }, 1000);

  } catch (err) {
    statusEl.textContent = 'Error: ' + (err.message || err);
    statusEl.style.color = 'var(--sw-red, #EF4444)';
  }
};

window.toggleDocVisibility = async function(docId, newValue) {
  try {
    await opsPost('toggle_document_visibility', { documentId: docId, visible_to_trades: newValue });
    // Refresh (preserve active tab)
    if (_currentJobId) refreshJobDetail();
  } catch (err) {
    alert('Error: ' + (err.message || err));
  }
};

window.deleteDocument = async function(docId, fileName) {
  if (!confirm('Delete "' + fileName + '"? This cannot be undone.')) return;
  try {
    await opsPost('delete_document', { documentId: docId });
    if (_currentJobId) refreshJobDetail();
  } catch (err) {
    alert('Error: ' + (err.message || err));
  }
};

async function submitJobNote() {
  var input = document.getElementById('jdNoteInput');
  var text = input.value.trim();
  if (!text || !_currentJobId) return;

  try {
    await opsPost('add_note', {
      job_id: _currentJobId,
      note: text,
      event_type: 'note_added',
    });
    input.value = '';
    showToast('Note added', 'success');
    refreshJobDetail();
  } catch(e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

// ── Action Drawer (Zone 3) ──

function renderActionDrawer(data) {
  var j = data.job;
  var html = '';
  html += '<button class="jd-drawer-btn" onclick="openActionSheet(\'PO\')"><span class="icon">&#128230;</span> +PO</button>';
  html += '<button class="jd-drawer-btn" onclick="openActionSheet(\'Invoice\')"><span class="icon">&#128179;</span> +Invoice</button>';
  if (j.type === 'miscellaneous') {
    html += '<button class="jd-drawer-btn" style="border-color:#8E44AD;color:#8E44AD;" onclick="closeJobDetail();openQuickQuote()"><span class="icon">&#9889;</span> Quick Quote</button>';
  }
  html += '<button class="jd-drawer-btn" onclick="openActionSheet(\'Assign\')"><span class="icon">&#128197;</span> +Assign</button>';
  html += '<button class="jd-drawer-btn" onclick="openActionSheet(\'Note\')"><span class="icon">&#128221;</span> +Note</button>';
  if (j.client_phone) {
    html += '<button class="jd-drawer-btn" onclick="showJobSubView(\'comms\')"><span class="icon">&#128172;</span> SMS</button>';
  }
  // Status change buttons
  var nextStatuses = getNextStatuses(j.status, j.type);
  nextStatuses.forEach(function(s) {
    var bgColor = s === 'cancelled' ? 'var(--sw-red)' : 'var(--sw-orange)';
    html += '<button class="jd-drawer-btn" style="border-color:' + bgColor + ';color:' + bgColor + ';" onclick="changeJobStatus(\'' + j.id + '\',\'' + s + '\')">' + (STATUS_LABELS[s] || s) + '</button>';
  });
  document.getElementById('jdDrawer').innerHTML = html;
}

// ── Action Sheets ──

function openActionSheet(type) {
  document.getElementById('jdSheetBackdrop').classList.add('open');
  var sheet = document.getElementById('jdSheet' + type);
  if (!sheet) return;

  // Populate sheet body
  var bodyEl = document.getElementById('jdSheet' + type + 'Body');
  if (type === 'PO') {
    bodyEl.innerHTML = '<p style="font-size:13px;color:var(--sw-text-sec);margin-bottom:12px;">This will open the PO creation form with the job pre-selected.</p>' +
      '<button class="btn btn-primary" onclick="closeActionSheet(); closeJobDetail(); openPOModal(\'' + _currentJobId + '\')">Open PO Form</button>';
  } else if (type === 'Invoice') {
    bodyEl.innerHTML = '<p style="font-size:13px;color:var(--sw-text-sec);margin-bottom:12px;">Create an invoice for this job.</p>' +
      '<button class="btn btn-primary" onclick="closeActionSheet(); closeJobDetail(); openUnifiedInvoiceModal(\'' + _currentJobId + '\')">Create Invoice</button>';
  } else if (type === 'Assign') {
    bodyEl.innerHTML = '<p style="font-size:13px;color:var(--sw-text-sec);margin-bottom:12px;">Schedule a crew assignment for this job.</p>' +
      '<button class="btn btn-primary" onclick="closeActionSheet(); closeJobDetail(); openAssignmentModalForJob(\'' + _currentJobId + '\')">Open Assignment Form</button>';
  } else if (type === 'Note') {
    bodyEl.innerHTML = '<textarea id="jdSheetNoteText" class="form-textarea" style="width:100%;min-height:80px;" placeholder="Type your note..."></textarea>' +
      '<div style="margin-top:12px;"><button class="btn btn-primary" onclick="submitSheetNote()">Save Note</button></div>';
  } else if (type === 'SMS') {
    var phone = _currentJobData?.job?.client_phone || '';
    var name = _currentJobData?.job?.client_name || 'there';
    bodyEl.innerHTML = '<div style="margin-bottom:12px;">' +
      '<div style="font-size:12px;font-weight:600;margin-bottom:4px;">Quick Templates</div>' +
      '<button class="btn btn-secondary btn-sm" style="margin:2px;" onclick="setSMSTemplate(\'Hi ' + escapeHtml(name) + ', just confirming your appointment tomorrow. Please let us know if anything changes. Thanks, SecureWorks Group\')">Confirm Appointment</button>' +
      '<button class="btn btn-secondary btn-sm" style="margin:2px;" onclick="setSMSTemplate(\'Hi ' + escapeHtml(name) + ', your materials have arrived and we are on track for the scheduled date. Thanks, SecureWorks Group\')">Materials Arrived</button>' +
      '<button class="btn btn-secondary btn-sm" style="margin:2px;" onclick="setSMSTemplate(\'Hi ' + escapeHtml(name) + ', just following up on the quote we sent. Happy to answer any questions. Thanks, SecureWorks Group\')">Quote Follow Up</button>' +
      '</div>' +
      '<textarea id="jdSheetSMSText" class="form-textarea" style="width:100%;min-height:60px;" placeholder="Type your message..."></textarea>' +
      '<div style="margin-top:12px;"><a href="sms:' + phone + '" id="jdSMSLink" class="btn btn-primary" style="text-decoration:none;display:inline-block;">Send via SMS App</a></div>';
  }

  setTimeout(function() { sheet.classList.add('open'); }, 10);
}

function closeActionSheet() {
  document.getElementById('jdSheetBackdrop').classList.remove('open');
  document.querySelectorAll('.jd-sheet').forEach(function(s) { s.classList.remove('open'); });
}

function setSMSTemplate(text) {
  var ta = document.getElementById('jdSheetSMSText');
  if (ta) ta.value = text;
  // Update SMS link with body
  var link = document.getElementById('jdSMSLink');
  var phone = _currentJobData?.job?.client_phone || '';
  if (link) link.href = 'sms:' + phone + '?body=' + encodeURIComponent(text);
}

async function submitSheetNote() {
  var ta = document.getElementById('jdSheetNoteText');
  var text = ta ? ta.value.trim() : '';
  if (!text || !_currentJobId) return;
  try {
    await opsPost('add_note', {
      job_id: _currentJobId,
      note: text,
      event_type: 'note_added',
    });
    showToast('Note added', 'success');
    closeActionSheet();
    refreshJobDetail();
  } catch(e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

// Helper to open assignment modal pre-filled for a specific job
function openAssignmentModalForJob(jobId) {
  openAssignmentModal();
  // Pre-select the job after modal opens
  setTimeout(function() {
    var sel = document.getElementById('assignJobSelect');
    if (sel) sel.value = jobId;
  }, 300);
}

// ── Quick-View Popup (Kanban card click) ──

async function openJobQuickView(jobId) {
  var overlay = document.getElementById('jdQuickviewOverlay');
  overlay.classList.add('open');
  document.getElementById('jdQvTitle').innerHTML = '<strong style="font-size:15px;">Loading...</strong>';
  document.getElementById('jdQvBody').innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('jdQvFooter').innerHTML = '';

  try {
    var data = await opsFetch('job_detail', { jobId: jobId });
    var j = data.job;

    // Title
    document.getElementById('jdQvTitle').innerHTML = '<div><strong style="font-size:15px;">' + escapeHtml(j.client_name || 'Unknown') + '</strong>' +
      '<div style="font-size:12px;color:var(--sw-text-sec);">' + (j.job_number || '') + ' &middot; ' + escapeHtml(j.site_suburb || '') + '</div></div>';

    // Body
    var html = '';
    html += '<div class="jd-qv-row"><span class="jd-qv-label">Type</span><span class="type-badge ' + j.type + '">' + typeBadgeLabel(j.type) + '</span></div>';
    html += '<div class="jd-qv-row"><span class="jd-qv-label">Status</span><span class="status-badge ' + j.status + '">' + (STATUS_LABELS[j.status] || j.status) + '</span></div>';

    var quoteVal = j.pricing_json?.totalIncGST || j.pricing_json?.total || 0;
    if (quoteVal) html += '<div class="jd-qv-row"><span class="jd-qv-label">Quote</span><strong style="color:var(--sw-green)">' + fmt$(quoteVal) + '</strong></div>';

    if (j.site_address) html += '<div class="jd-qv-row"><span class="jd-qv-label">Address</span><span style="font-size:12px">' + escapeHtml(j.site_address) + '</span></div>';
    if (j.client_phone) html += '<div class="jd-qv-row"><span class="jd-qv-label">Phone</span><a href="tel:' + j.client_phone + '">' + j.client_phone + '</a></div>';

    // Quick stats
    html += '<div style="display:flex;gap:12px;margin-top:12px;padding-top:8px;border-top:1px solid var(--sw-border);font-size:12px;color:var(--sw-text-sec);">';
    html += '<span>' + (data.assignments || []).length + ' assignments</span>';
    html += '<span>' + (data.purchase_orders || []).length + ' POs</span>';
    html += '<span>' + (data.work_orders || []).length + ' WOs</span>';
    html += '</div>';

    // Alerts preview
    var alerts = evaluateJobAlerts(data);
    if (alerts.length > 0) {
      html += '<div style="margin-top:8px;">';
      alerts.slice(0, 3).forEach(function(a) {
        html += '<div class="jd-alert ' + a.level + '" style="margin-bottom:4px;">' + a.icon + ' ' + a.message + '</div>';
      });
      html += '</div>';
    }

    document.getElementById('jdQvBody').innerHTML = html;

    // Footer
    var footerHtml = '';
    // Quick action buttons
    var nextStatuses = getNextStatuses(j.status, j.type);
    nextStatuses.forEach(function(s) {
      footerHtml += '<button class="btn btn-secondary btn-sm" onclick="closeQuickView();changeJobStatus(\'' + j.id + '\',\'' + s + '\')">' + (STATUS_LABELS[s] || s) + '</button>';
    });
    footerHtml += '<button class="btn btn-primary btn-sm" onclick="closeQuickView();openJobDetail(\'' + j.id + '\')">Open Full Record</button>';
    document.getElementById('jdQvFooter').innerHTML = footerHtml;

  } catch(e) {
    document.getElementById('jdQvBody').innerHTML = '<div style="color:var(--sw-red);">Error: ' + e.message + '</div>';
  }
}

function closeQuickView() {
  document.getElementById('jdQuickviewOverlay').classList.remove('open');
}

function getNextStatuses(current, jobType) {
  var transitions = {
    'quoted': ['accepted', 'cancelled'],
    'accepted': jobType === 'fencing' ? ['processing'] : ['approvals', 'processing'],
    'approvals': ['processing'],
    'processing': ['in_progress'],
    'scheduled': ['in_progress', 'cancelled'],
    'in_progress': ['complete', 'cancelled'],
    'complete': ['invoiced'],
    'invoiced': [],
  };
  return transitions[current] || [];
}

// Quick Quote: Accept quote and create deposit invoice in one step
async function acceptAndDepositQuickQuote(jobId) {
  if (!confirm('Accept this quote and create a deposit invoice?')) return;
  try {
    // 1. Accept the job
    await opsPost('update_job_status', { jobId: jobId, status: 'accepted' });
    showToast('Quote accepted', 'success');
    // 2. Create deposit invoice (50% default)
    try {
      var invoiceRes = await opsPost('create_deposit_invoice', { job_id: jobId, deposit_percent: 50 });
      showToast('Deposit invoice created: ' + (invoiceRes.invoice_number || ''), 'success');
    } catch (e2) {
      showToast('Quote accepted but deposit invoice failed: ' + e2.message, 'warning');
    }
    // Refresh view
    if (document.getElementById('jobDetailView').classList.contains('active')) {
      refreshJobDetail();
    } else {
      openJobPeek(jobId);
    }
    refreshActiveView();
  } catch (e) {
    showToast('Failed: ' + e.message, 'warning');
  }
}

async function changeJobStatus(jobId, status) {
  // Feature 4: If moving to "complete", offer cascade modal instead
  if (status === 'complete') {
    openCascadeModal(jobId);
    return;
  }
  // Acceptance review gate — verify client data before accepting
  if (status === 'accepted') {
    openAcceptModal(jobId);
    return;
  }
  try {
    await opsPost('update_job_status', { jobId: jobId, status: status });
    // Refresh whichever view is open
    if (document.getElementById('jobDetailView').classList.contains('active')) {
      refreshJobDetail();
    } else {
      openJobPeek(jobId);
    }
    refreshActiveView();
  } catch (e) {
    alert('Failed to update status: ' + e.message);
  }
}

async function markJobLost(jobId) {
  // Capture lost reason for AI conversion intelligence
  var reasons = ['Too expensive', 'Wrong timing', 'Chose competitor', 'Project cancelled', 'No response', 'Other'];
  var reasonHtml = reasons.map(function(r, i) { return (i + 1) + '. ' + r; }).join('\n');
  var choice = prompt('Why was this job lost?\n\n' + reasonHtml + '\n\nEnter number (1-6) or type a reason:');
  if (choice === null) return; // cancelled
  var lostReason = '';
  var num = parseInt(choice);
  if (num >= 1 && num <= reasons.length) {
    lostReason = reasons[num - 1];
  } else {
    lostReason = choice.trim() || 'Not specified';
  }
  try {
    await opsPost('update_job_status', { jobId: jobId, status: 'lost', lost_reason: lostReason });
    closeSlidePanel();
    showToast('Job marked as lost — ' + lostReason, 'info');
    refreshActiveView();
  } catch (e) {
    alert('Failed to mark job as lost: ' + e.message);
  }
}

function refreshActiveView() {
  var activeView = document.querySelector('.view.active');
  if (activeView) {
    var id = activeView.id.replace('view', '').toLowerCase();
    if (id === 'today') loadToday();
    if (id === 'jobs') loadJobs();
    if (id === 'calendar') loadCalendar();
  }
}
