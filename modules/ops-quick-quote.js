// QUICK QUOTE
// ════════════════════════════════════════════════════════════

var QQ_TEMPLATES = {
  labour_general:  { description: 'Labour — General',    quantity: 8,  unit: 'hr',  unit_price: 65, cost_price: 45 },
  labour_skilled:  { description: 'Labour — Skilled',    quantity: 8,  unit: 'hr',  unit_price: 85, cost_price: 60 },
  materials:       { description: 'Materials',           quantity: 1,  unit: 'lot', unit_price: 0,  cost_price: 0 },
  demolition:      { description: 'Demolition & Removal',quantity: 1,  unit: 'lot', unit_price: 0,  cost_price: 0 },
  skip_bin:        { description: 'Skip Bin',            quantity: 1,  unit: 'ea',  unit_price: 450,cost_price: 350 },
  concrete:        { description: 'Concrete Supply',     quantity: 1,  unit: 'm³',  unit_price: 0,  cost_price: 0 },
  permit:          { description: 'Permit / Council Fee', quantity: 1, unit: 'ea',  unit_price: 0,  cost_price: 0 },
  custom:          { description: '',                    quantity: 1,  unit: 'ea',  unit_price: 0,  cost_price: 0 },
};

var TYPE_LABELS = { miscellaneous: 'misc' };

function typeBadgeLabel(type) {
  return TYPE_LABELS[type] || type || '';
}

function openQuickQuote() {
  resetQuickQuote();
  addQQLine('', '1', 'ea', '', '', '');
  document.getElementById('qqOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeQuickQuote() {
  document.getElementById('qqOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function resetQuickQuote() {
  ['qqGHLSearch','qqFirstName','qqLastName','qqPhone','qqEmail','qqAddress','qqSuburb',
   'qqDescription','qqReference','qqClientNotes','qqInternalNotes','qqGHLContactId'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('qqJobType').selectedIndex = 0;
  document.getElementById('qqPaymentTerms').selectedIndex = 0;
  document.getElementById('qqValidDays').value = '30';
  document.getElementById('qqLineBody').innerHTML = '';
  document.getElementById('qqGHLResults').classList.remove('open');
  document.getElementById('qqExistingJobs').innerHTML = '';
  document.getElementById('qqShowCosts').checked = false;
  toggleQQCosts();
  updateQQLineTotals();
}

// ── GHL Contact Search ──
async function searchQQContacts() {
  var q = document.getElementById('qqGHLSearch').value.trim();
  if (!q || q.length < 2) return;
  var resultsEl = document.getElementById('qqGHLResults');
  resultsEl.innerHTML = '<div class="qq-ghl-item"><em>Searching...</em></div>';
  resultsEl.classList.add('open');

  try {
    var data = await opsFetch('search_ghl_contacts', { q: q });
    if (!data.contacts || data.contacts.length === 0) {
      resultsEl.innerHTML = '<div class="qq-ghl-item"><em>No contacts found</em></div>';
      return;
    }
    var html = '';
    data.contacts.forEach(function(c, i) {
      html += '<div class="qq-ghl-item" onclick="selectQQContact(' + i + ')" data-idx="' + i + '">';
      html += '<div class="name">' + escapeHtml(c.name || 'No name') + '</div>';
      html += '<div class="detail">' + [c.phone, c.email, c.city].filter(Boolean).join(' · ') + '</div>';
      if (c.existing_jobs && c.existing_jobs.length > 0) {
        html += '<div class="detail" style="color:#8E44AD;">' + c.existing_jobs.length + ' existing job(s)</div>';
      }
      html += '</div>';
    });
    resultsEl.innerHTML = html;
    window._qqContacts = data.contacts;
  } catch (e) {
    resultsEl.innerHTML = '<div class="qq-ghl-item" style="color:var(--sw-red);">Error: ' + e.message + '</div>';
  }
}

function selectQQContact(idx) {
  var c = window._qqContacts[idx];
  if (!c) return;
  document.getElementById('qqFirstName').value = c.firstName || '';
  document.getElementById('qqLastName').value = c.lastName || '';
  document.getElementById('qqPhone').value = c.phone || '';
  document.getElementById('qqEmail').value = c.email || '';
  document.getElementById('qqAddress').value = c.address || '';
  document.getElementById('qqSuburb').value = c.city || '';
  document.getElementById('qqGHLContactId').value = c.id || '';
  document.getElementById('qqGHLResults').classList.remove('open');

  // Show existing jobs
  var ejEl = document.getElementById('qqExistingJobs');
  if (c.existing_jobs && c.existing_jobs.length > 0) {
    ejEl.innerHTML = 'Existing jobs: ' + c.existing_jobs.map(function(j) {
      return '<strong>' + (j.job_number || 'draft') + '</strong> (' + j.type + ' — ' + j.status + ')';
    }).join(', ');
  } else {
    ejEl.innerHTML = '';
  }
}

// ── Line Items ──
function addQQLine(desc, qty, unit, price, cost, total) {
  var tbody = document.getElementById('qqLineBody');
  var row = document.createElement('tr');
  row.className = 'qq-line-row';
  row.innerHTML =
    '<td class="col-desc"><input type="text" value="' + escapeHtml(desc || '') + '" placeholder="Description" oninput="updateQQLineTotals()"></td>' +
    '<td class="col-qty"><input type="number" value="' + (qty || 1) + '" min="0" step="0.5" oninput="updateQQLineTotals()"></td>' +
    '<td class="col-unit"><select><option value="hr">hr</option><option value="ea">ea</option><option value="m">m</option><option value="m²">m²</option><option value="m³">m³</option><option value="lot">lot</option><option value="day">day</option></select></td>' +
    '<td class="col-price"><input type="number" value="' + (price || '') + '" min="0" step="0.01" placeholder="0.00" oninput="updateQQLineTotals()"></td>' +
    '<td class="col-cost"><input type="number" value="' + (cost || '') + '" min="0" step="0.01" placeholder="0.00" oninput="updateQQLineTotals()"></td>' +
    '<td class="col-total" style="text-align:right;font-weight:600;font-family:var(--sw-font-num);">$0.00</td>' +
    '<td class="col-del"><button class="qq-line-remove" onclick="removeQQLine(this)" title="Remove">&times;</button></td>';
  tbody.appendChild(row);
  // Set unit select
  var sel = row.querySelector('.col-unit select');
  if (unit) sel.value = unit;
  updateQQLineTotals();
}

function removeQQLine(btn) {
  btn.closest('tr').remove();
  updateQQLineTotals();
}

function updateQQLineTotals() {
  var rows = document.querySelectorAll('#qqLineBody tr');
  var subtotal = 0;
  var totalCost = 0;
  rows.forEach(function(row) {
    var inputs = row.querySelectorAll('input');
    var qty = parseFloat(inputs[1].value) || 0;
    var price = parseFloat(inputs[2].value) || 0;
    var cost = parseFloat(inputs[3].value) || 0;
    var lineTotal = qty * price;
    subtotal += lineTotal;
    totalCost += qty * cost;
    row.querySelector('.col-total').textContent = '$' + lineTotal.toFixed(2);
  });
  var gst = Math.round(subtotal * 0.1 * 100) / 100;
  var total = subtotal + gst;
  document.getElementById('qqSubtotal').textContent = '$' + subtotal.toFixed(2);
  document.getElementById('qqGST').textContent = '$' + gst.toFixed(2);
  document.getElementById('qqTotal').textContent = '$' + total.toFixed(2);

  // Margin
  if (totalCost > 0) {
    var margin = ((subtotal - totalCost) / subtotal * 100).toFixed(1);
    document.getElementById('qqMargin').textContent = margin + '% ($' + (subtotal - totalCost).toFixed(2) + ')';
  } else {
    document.getElementById('qqMargin').textContent = '-';
  }
}

function addQQTemplate(key) {
  if (!key) return;
  var t = QQ_TEMPLATES[key];
  if (!t) return;
  addQQLine(t.description, t.quantity, t.unit, t.unit_price || '', t.cost_price || '', '');
}

function toggleQQCosts() {
  var show = document.getElementById('qqShowCosts').checked;
  var table = document.getElementById('qqLineTable');
  var totals = document.getElementById('qqTotals');
  if (show) {
    table.classList.add('show-costs');
    totals.classList.add('show-costs');
  } else {
    table.classList.remove('show-costs');
    totals.classList.remove('show-costs');
  }
}

// ── Gather Form Data ──
function gatherQQData() {
  var lineItems = [];
  document.querySelectorAll('#qqLineBody tr').forEach(function(row) {
    var inputs = row.querySelectorAll('input');
    var sel = row.querySelector('select');
    var qty = parseFloat(inputs[1].value) || 0;
    var price = parseFloat(inputs[2].value) || 0;
    var cost = parseFloat(inputs[3].value) || 0;
    lineItems.push({
      description: inputs[0].value,
      quantity: qty,
      unit: sel ? sel.value : 'ea',
      unit_price: price,
      cost_price: cost,
      total: qty * price,
    });
  });
  return {
    client_first_name: document.getElementById('qqFirstName').value,
    client_last_name: document.getElementById('qqLastName').value,
    client_phone: document.getElementById('qqPhone').value,
    client_email: document.getElementById('qqEmail').value,
    site_address: document.getElementById('qqAddress').value,
    site_suburb: document.getElementById('qqSuburb').value,
    ghl_contact_id: document.getElementById('qqGHLContactId').value || null,
    job_type_label: document.getElementById('qqJobType').value,
    description: document.getElementById('qqDescription').value,
    reference: document.getElementById('qqReference').value,
    line_items: lineItems,
    payment_terms: document.getElementById('qqPaymentTerms').value,
    valid_days: parseInt(document.getElementById('qqValidDays').value) || 30,
    client_notes: document.getElementById('qqClientNotes').value,
    internal_notes: document.getElementById('qqInternalNotes').value,
  };
}

// ── Save / Submit ──
async function saveQuickQuoteDraft() {
  var data = gatherQQData();
  data.status = 'draft';
  try {
    var res = await opsPost('create_misc_job', data);
    showToast('Draft saved: ' + (res.job.job_number || 'new job'), 'success');
    closeQuickQuote();
    loadJobs();
  } catch (e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

async function sendQuickQuote() {
  var data = gatherQQData();
  data.status = 'quoted';
  try {
    var res = await opsPost('create_misc_job', data);
    showToast('Quote created: ' + (res.job.job_number || ''), 'success');

    // Create GHL contact if none was linked (fire-and-forget)
    if (!data.ghl_contact_id && (data.client_email || data.client_phone)) {
      try {
        var ghlRes = await fetch(window.SUPABASE_URL + '/functions/v1/ghl-proxy?action=create_contact_and_opportunity', {
          method: 'POST',
          headers: await _getAuthHeaders(),
          body: JSON.stringify({
            firstName: data.client_first_name,
            lastName: data.client_last_name,
            email: data.client_email,
            phone: data.client_phone,
            address: data.site_address,
            suburb: data.site_suburb,
            toolType: 'miscellaneous',
            skipOpportunity: true,
          })
        });
        if (ghlRes.ok) {
          var ghlData = await ghlRes.json();
          if (ghlData.contactId && res.job.id) {
            // Backfill GHL contact ID on the job
            opsPost('update_job', { id: res.job.id, ghl_contact_id: ghlData.contactId }).catch(function() {});
            console.log('[QuickQuote] GHL contact created/linked:', ghlData.contactId, ghlData.contactExisted ? '(existing)' : '(new)');
          }
        }
      } catch (e) { console.log('[QuickQuote] GHL contact creation failed (non-blocking):', e.message); }
    }

    // Generate PDF and offer to send to client
    _lastQuickQuoteJob = res.job;
    _lastQuickQuoteData = data;
    await generateQuickQuotePDF(res.job);
    // Show "Send to Client" option if we have an email
    if (data.client_email) {
      var sendBtn = document.getElementById('qqSendToClient');
      if (sendBtn) { sendBtn.style.display = 'inline-block'; sendBtn.dataset.jobId = res.job.id; }
    }
    closeQuickQuote();
    loadJobs();
  } catch (e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

var _lastQuickQuoteJob = null;
var _lastQuickQuoteData = null;
var _lastQuickQuotePdfBlob = null;

async function sendQuickQuoteToClient(jobId) {
  if (!jobId && _lastQuickQuoteJob) jobId = _lastQuickQuoteJob.id;
  if (!jobId) { showToast('No job to send', 'warning'); return; }

  showToast('Uploading quote PDF...', 'info');

  // Generate PDF as blob for upload
  var pdfUrl = null;
  if (_lastQuickQuotePdfBlob) {
    try {
      var cloud = window.SECUREWORKS_CLOUD;
      if (cloud && cloud.supabase) {
        var jobNum = _lastQuickQuoteJob ? _lastQuickQuoteJob.job_number : 'quote';
        var path = 'po-documents/' + jobId + '/' + jobNum + '-quote.pdf';
        var { data: upData, error: upErr } = await cloud.supabase.storage
          .from('po-documents')
          .upload(path, _lastQuickQuotePdfBlob, { contentType: 'application/pdf', upsert: true });
        if (!upErr) {
          var { data: urlData } = cloud.supabase.storage.from('po-documents').getPublicUrl(path);
          pdfUrl = urlData ? urlData.publicUrl : null;
        }
      }
    } catch (e) { console.log('[QuickQuote] PDF upload failed:', e.message); }
  }

  try {
    var res = await opsPost('send_quick_quote_email', { job_id: jobId, pdf_url: pdfUrl });
    showToast('Quote sent to ' + (res.sent_to || 'client'), 'success');
    _lastQuickQuotePdfBlob = null;
    loadJobs();
  } catch (e) {
    showToast('Send failed: ' + e.message, 'warning');
  }
}

// ── PDF Generation ──
async function generateQuickQuotePDF(savedJob) {
  var data = gatherQQData();
  var jsPDF = window.jspdf ? window.jspdf.jsPDF : null;
  if (!jsPDF) { showToast('jsPDF not loaded', 'warning'); return; }

  var B = window.SW_BRAND;
  var P = B.pdf;
  var doc = new jsPDF({ unit: 'mm', format: 'a4' });
  var M = B.PDF_M;
  var W = B.PDF_W;
  var CW = B.PDF_CW;

  var jobNum = (savedJob && savedJob.job_number) ? savedJob.job_number : 'DRAFT';
  var clientName = [data.client_first_name, data.client_last_name].filter(Boolean).join(' ') || 'Client';
  var today = new Date();
  var dateStr = today.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  var validUntil = new Date(today.getTime() + data.valid_days * 86400000);
  var validStr = validUntil.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  // ── Header: orange strip + dark blue bar + logo ──
  doc.setFillColor(241, 90, 41);
  doc.rect(0, 0, W, 4, 'F');
  doc.setFillColor(41, 60, 70);
  doc.rect(0, 4, W, 32, 'F');

  // Logo
  try {
    var logoData = await B.getLogoPNG();
    doc.addImage(logoData, 'PNG', M, 8, 40, 24);
  } catch (e) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text('SecureWorks Group', M, 22);
  }

  // Quote number & date (right side of header)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text('QUOTE', W - M, 16, { align: 'right' });
  doc.setFontSize(11);
  doc.text(jobNum, W - M, 23, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(200, 210, 220);
  doc.text(dateStr, W - M, 30, { align: 'right' });

  var y = 44;

  // ── Client info card ──
  var clientPairs = [
    ['Client', clientName],
    ['Phone', data.client_phone || '-'],
    ['Email', data.client_email || '-'],
    ['Site', (data.site_address || '') + (data.site_suburb ? ', ' + data.site_suburb : '')],
  ];
  y = P.infoCard(doc, y, clientPairs, { cols: 2 });
  y += 2;

  // ── Quote details ──
  y = P.sectionTitle(doc, y, 'Quote Details');
  y = P.labelValue(doc, y, 'Job Type', data.job_type_label || 'Miscellaneous');
  if (data.reference) y = P.labelValue(doc, y, 'Reference', data.reference);
  y = P.labelValue(doc, y, 'Valid Until', validStr);
  y = P.labelValue(doc, y, 'Payment Terms', data.payment_terms);
  y += 4;

  // ── Description ──
  if (data.description) {
    y = P.sectionTitle(doc, y, 'Description');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor.apply(doc, B.SW_BODY);
    var descLines = doc.splitTextToSize(data.description, CW);
    descLines.forEach(function(line) {
      y = P.checkPage(doc, y, 5);
      doc.text(line, M, y);
      y += 4;
    });
    y += 4;
  }

  // ── Line Items Table ──
  y = P.checkPage(doc, y, 40);
  y = P.sectionTitle(doc, y, 'Line Items');

  // Table header
  var colX = [M, M + 80, M + 100, M + 120, M + 150];
  doc.setFillColor.apply(doc, B.SW_DARK);
  doc.rect(M, y - 3, CW, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text('DESCRIPTION', colX[0] + 2, y + 1);
  doc.text('QTY', colX[1] + 2, y + 1);
  doc.text('UNIT', colX[2] + 2, y + 1);
  doc.text('PRICE', colX[3] + 2, y + 1, { align: 'left' });
  doc.text('TOTAL', W - M, y + 1, { align: 'right' });
  y += 7;

  // Table rows
  var subtotal = 0;
  data.line_items.forEach(function(li, idx) {
    y = P.checkPage(doc, y, 7);
    if (idx % 2 === 0) {
      doc.setFillColor.apply(doc, B.SW_LIGHT);
      doc.rect(M, y - 3, CW, 6, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor.apply(doc, B.SW_BODY);
    var desc = li.description || '';
    if (desc.length > 45) desc = desc.substring(0, 42) + '...';
    doc.text(desc, colX[0] + 2, y);
    doc.text(String(li.quantity), colX[1] + 2, y);
    doc.text(li.unit, colX[2] + 2, y);
    doc.text('$' + Number(li.unit_price).toFixed(2), colX[3] + 2, y);
    var lineTotal = li.quantity * li.unit_price;
    subtotal += lineTotal;
    doc.setFont('helvetica', 'bold');
    doc.text('$' + lineTotal.toFixed(2), W - M, y, { align: 'right' });
    y += 6;
  });

  // Totals
  y += 4;
  var gst = Math.round(subtotal * 10) / 100;
  var total = subtotal + gst;

  doc.setDrawColor.apply(doc, B.SW_RULE);
  doc.line(M + 100, y - 2, W - M, y - 2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor.apply(doc, B.SW_MID);
  doc.text('Subtotal (ex GST)', M + 100, y + 2);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor.apply(doc, B.SW_DARK);
  doc.text('$' + subtotal.toFixed(2), W - M, y + 2, { align: 'right' });
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor.apply(doc, B.SW_MID);
  doc.text('GST (10%)', M + 100, y + 2);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor.apply(doc, B.SW_DARK);
  doc.text('$' + gst.toFixed(2), W - M, y + 2, { align: 'right' });
  y += 6;

  // Total inc GST — big + orange accent
  doc.setFillColor(241, 90, 41);
  doc.rect(M + 100, y, CW - 100, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text('TOTAL (inc GST)', M + 104, y + 6.5);
  doc.text('$' + total.toFixed(2), W - M - 3, y + 6.5, { align: 'right' });
  y += 16;

  // ── Client Notes ──
  if (data.client_notes) {
    y = P.checkPage(doc, y, 20);
    y = P.sectionTitle(doc, y, 'Notes');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor.apply(doc, B.SW_BODY);
    var noteLines = doc.splitTextToSize(data.client_notes, CW);
    noteLines.forEach(function(line) {
      y = P.checkPage(doc, y, 5);
      doc.text(line, M, y);
      y += 4;
    });
    y += 6;
  }

  // ── Terms & Conditions ──
  y = P.checkPage(doc, y, 30);
  y = P.sectionTitle(doc, y, 'Terms & Conditions');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor.apply(doc, B.SW_MUTED);
  var terms = [
    '1. This quote is valid for ' + data.valid_days + ' days from the date of issue.',
    '2. Payment terms: ' + data.payment_terms + '.',
    '3. All prices include GST unless otherwise stated.',
    '4. Additional work not specified in this quote will be charged at agreed rates.',
    '5. SecureWorks Group reserves the right to adjust pricing if site conditions differ from those assessed.',
  ];
  terms.forEach(function(t) {
    y = P.checkPage(doc, y, 5);
    doc.text(t, M, y);
    y += 3.5;
  });

  // ── Footer ──
  y = P.checkPage(doc, y, 20);
  y += 8;
  doc.setFillColor(41, 60, 70);
  doc.rect(0, y, W, 18, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(200, 210, 220);
  doc.text('SecureWorks Group Pty Ltd | ABN 31 672 816 729', M, y + 6);
  doc.text('0489 267 771 | admin@secureworkswa.com.au', M, y + 10);
  doc.text('secureworkswa.com.au', M, y + 14);

  // Page numbers
  P.addPageNumbers(doc);

  // Save locally + store blob for email sending
  var filename = jobNum + '-quote-' + clientName.replace(/\s+/g, '-').toLowerCase() + '.pdf';
  _lastQuickQuotePdfBlob = doc.output('blob');
  doc.save(filename);
  showToast('PDF downloaded: ' + filename, 'success');
}
