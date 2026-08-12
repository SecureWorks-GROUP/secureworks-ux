// ════════════════════════════════════════════════════════════
// PO MANAGEMENT (Delete, Invoice, Paid, Attachments)
// ════════════════════════════════════════════════════════════

// BUG 2: Delete PO
function deletePO(poId, poNumber, supplier, canDelete) {
  if (!canDelete) {
    showToast('Cannot delete — PO already sent to supplier. Use Cancel instead.', 'warning');
    return;
  }
  if (!confirm('Delete ' + poNumber + ' for ' + supplier + '? This cannot be undone.')) return;
  opsPost('delete_po', { id: poId }).then(function() {
    showToast(poNumber + ' deleted', 'success');
    loadMaterials();
  }).catch(function(e) {
    showToast('Error: ' + e.message, 'warning');
  });
}

// FEATURE 7: Mark invoice received
// TODO: Add invoice_received_at (timestamptz), paid_at (timestamptz), xero_bill_id (text) columns to purchase_orders table
// TODO: Add 'invoice_received_at', 'paid_at' to the allowed fields in updatePO() edge function
async function markPOInvoiceReceived(poId) {
  if (!confirm('Mark invoice received for this PO?')) return;
  try {
    // Use update_po to set status field as a proxy until column exists
    await opsPost('update_po', { id: poId, notes: '[Invoice received ' + new Date().toLocaleDateString('en-AU') + ']' });
    showToast('Invoice marked as received', 'success');
    loadMaterials();
  } catch (e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

// FEATURE 7: Mark paid
async function markPOPaid(poId) {
  if (!confirm('Mark this PO as paid?')) return;
  try {
    await opsPost('update_po', { id: poId, notes: '[Paid ' + new Date().toLocaleDateString('en-AU') + ']' });
    showToast('PO marked as paid', 'success');
    loadMaterials();
  } catch (e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

// ── Generate PO PDF (branded, using jsPDF + SW_BRAND helpers) ──
// Returns a base64 data URL string, or null on failure.
async function generatePOPDF(poId) {
  var jsPDF = window.jspdf ? window.jspdf.jsPDF : null;
  if (!jsPDF) { console.log('jsPDF not loaded'); return null; }

  var po = _allPOs.find(function(p) { return p.id === poId; });
  if (!po) return null;

  var B = window.SW_BRAND;
  var P = B.pdf;
  var M = B.PDF_M;
  var W = B.PDF_W;
  var CW = B.PDF_CW;
  var doc = new jsPDF({ unit: 'mm', format: 'a4' });
  var fmt = P.fmt;

  // Job data
  var jobAddress = '';
  var siteContact = '';
  if (_currentJobData && _currentJobData.job) {
    var j = _currentJobData.job;
    jobAddress = [j.site_address, j.site_suburb, 'WA', j.site_postcode].filter(Boolean).join(', ');
    siteContact = j.crew_lead || '';
  }

  var dateStr = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  var deliveryStr = po.delivery_date ? new Date(po.delivery_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'TBC';

  // ── Header ──
  var logoPng = null;
  try { logoPng = await B.getLogoPNG(); } catch(e) {}
  var y = P.header(doc, logoPng, 'PURCHASE ORDER', po.po_number || '');

  // ── PO details card ──
  var pairs = [
    ['PO Number', po.po_number || ''],
    ['Date', dateStr],
    ['Supplier', po.supplier_name || ''],
    ['Job Ref', po.job_number || ''],
    ['Required By', deliveryStr],
    ['Reference', po.reference || ''],
  ];
  y = P.infoCard(doc, y, pairs, { cols: 2 });

  // ── Deliver To section ──
  if (jobAddress) {
    y = P.subSection(doc, y, 'DELIVER TO');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor.apply(doc, B.SW_DARK);
    doc.text(jobAddress, M, y);
    y += 5;
    if (siteContact) {
      doc.setTextColor.apply(doc, B.SW_MID);
      doc.setFontSize(8);
      doc.text('Site contact: ' + siteContact, M, y);
      y += 5;
    }
    y += 2;
  }

  // ── Line Items Table ──
  y = P.sectionHeader(doc, y, 'ORDER ITEMS');

  var lineItems = po.line_items || [];
  // Table header
  doc.setFillColor(240, 244, 247);
  doc.rect(M, y, CW, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor.apply(doc, B.SW_MID);
  var cols = [M + 2, M + 90, M + 110, M + 132, M + 158];
  doc.text('Description', cols[0], y + 5);
  doc.text('Qty', cols[1], y + 5);
  doc.text('Unit', cols[2], y + 5);
  doc.text('Unit Price', cols[3], y + 5);
  doc.text('Total', cols[4], y + 5);
  y += 9;

  // Table rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  var subtotal = 0;
  lineItems.forEach(function(item, i) {
    y = P.checkPage(doc, y, 8);
    if (i % 2 === 0) {
      doc.setFillColor(250, 250, 252);
      doc.rect(M, y - 3.5, CW, 7, 'F');
    }
    var desc = item.description || item.item || item.desc || '';
    var qty = item.quantity || item.qty || 0;
    var unit = item.unit || 'ea';
    var price = item.unit_price || item.price || 0;
    var total = qty * price;
    subtotal += total;

    doc.setTextColor.apply(doc, B.SW_DARK);
    // Truncate long descriptions
    var descText = desc.length > 50 ? desc.substring(0, 47) + '...' : desc;
    doc.text(descText, cols[0], y);
    doc.text(String(qty), cols[1], y);
    doc.text(unit, cols[2], y);
    doc.text('$' + fmt(price), cols[3], y);
    doc.setFont('helvetica', 'bold');
    doc.text('$' + fmt(total), cols[4], y);
    doc.setFont('helvetica', 'normal');
    y += 7;
  });

  // Totals
  y += 2;
  doc.setDrawColor.apply(doc, B.SW_MID);
  doc.setLineWidth(0.3);
  doc.line(cols[3], y - 2, M + CW - 2, y - 2);
  var gst = subtotal * 0.1;
  var grandTotal = subtotal + gst;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor.apply(doc, B.SW_MID);
  doc.text('Subtotal', cols[3], y);
  doc.setTextColor.apply(doc, B.SW_DARK);
  doc.text('$' + fmt(subtotal), cols[4], y);
  y += 5;
  doc.setTextColor.apply(doc, B.SW_MID);
  doc.text('GST (10%)', cols[3], y);
  doc.setTextColor.apply(doc, B.SW_DARK);
  doc.text('$' + fmt(gst), cols[4], y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor.apply(doc, B.SW_DARK);
  doc.text('TOTAL', cols[3], y);
  doc.setTextColor.apply(doc, B.SW_ORANGE);
  doc.text('$' + fmt(grandTotal), cols[4], y);
  y += 8;

  // ── Notes ──
  if (po.notes) {
    y = P.checkPage(doc, y, 20);
    y = P.subSection(doc, y, 'NOTES');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor.apply(doc, B.SW_DARK);
    var noteLines = doc.splitTextToSize(po.notes, CW - 4);
    doc.text(noteLines, M, y);
    y += noteLines.length * 4 + 4;
  }

  // ── Confirmation request ──
  y = P.checkPage(doc, y, 15);
  doc.setFillColor(240, 244, 247);
  doc.rect(M, y, CW, 10, 'F');
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor.apply(doc, B.SW_MID);
  doc.text('Please confirm receipt and expected delivery date.', M + 4, y + 6);
  y += 14;

  // ── Footer ──
  P.addPageNumbers(doc);

  // Return as base64 blob
  return doc.output('datauristring');
}

// Upload PO PDF to Supabase Storage and return the public URL
async function uploadPOPDF(poId, dataUri) {
  if (!dataUri || !window.SUPABASE_URL) return null;
  try {
    // Convert data URI to blob
    var byteString = atob(dataUri.split(',')[1]);
    var ab = new ArrayBuffer(byteString.length);
    var ia = new Uint8Array(ab);
    for (var i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    var blob = new Blob([ab], { type: 'application/pdf' });

    var po = _allPOs.find(function(p) { return p.id === poId; });
    var filename = (po ? po.po_number : 'PO') + '.pdf';
    var path = 'po-documents/' + poId + '/' + filename;

    // Upload via Supabase Storage (use cloud.js client)
    var cloud = window.SECUREWORKS_CLOUD;
    if (!cloud || !cloud.supabase) return null;

    var { data, error } = await cloud.supabase.storage
      .from('po-documents')
      .upload(path, blob, { contentType: 'application/pdf', upsert: true });

    if (error) {
      console.log('[PO PDF] Upload error:', error.message);
      return null;
    }

    var { data: urlData } = cloud.supabase.storage.from('po-documents').getPublicUrl(path);
    return urlData ? urlData.publicUrl : null;
  } catch(e) {
    console.log('[PO PDF] Upload failed:', e.message);
    return null;
  }
}

// Approve & Send PO — pushes to Xero then emails supplier
async function approveAndSendPO(poId, btnEl) {
  if (!confirm('Approve this PO and send to supplier?')) return;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Sending...'; }
  try {
    await opsPost('push_po_to_xero', { id: poId, status: 'AUTHORISED' });
    await opsPost('email_po', { id: poId });
    showToast('PO approved and sent to supplier', 'success');
    loadMaterials();
  } catch(e) {
    showToast('Error: ' + e.message, 'warning');
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Approve & Send'; }
  }
}

// Toggle expandable PO review card
function togglePOCard(poId) {
  var body = document.getElementById('poBody' + poId);
  var chevron = document.getElementById('poChevron' + poId);
  if (!body) return;
  if (body.style.display === 'none') {
    body.style.display = '';
    chevron.innerHTML = '&#9650;';
    // Populate supplier dropdown if not already done
    var sel = document.getElementById('poSupplierPick' + poId);
    if (sel && sel.options.length <= 1) {
      if (_suppliers && _suppliers.length) {
        _suppliers.forEach(function(s) {
          var opt = document.createElement('option');
          opt.value = s.name;
          opt.textContent = s.name;
          sel.appendChild(opt);
        });
      } else {
        // Load suppliers then populate
        loadSupplierList().then(function() {
          if (_suppliers && _suppliers.length) {
            _suppliers.forEach(function(s) {
              var opt = document.createElement('option');
              opt.value = s.name;
              opt.textContent = s.name;
              sel.appendChild(opt);
            });
          }
        });
      }
    }
    // Pre-select supplier if PO already has one
    var card = document.getElementById('poCard' + poId);
    if (sel && card) {
      var existing = card.getAttribute('data-supplier');
      if (existing && sel.value === '') {
        sel.value = existing;
      }
    }
  } else {
    body.style.display = 'none';
    chevron.innerHTML = '&#9660;';
  }
}

// Quick approve PO from review card
async function quickApprovePO(poId, sendToSupplier) {
  var supplierEl = document.getElementById('poSupplierPick' + poId);
  var supplier = supplierEl ? supplierEl.value : '';
  var dateEl = document.getElementById('poDeliveryPick' + poId);
  var deliveryDate = dateEl ? dateEl.value : '';

  if (!supplier) {
    showToast('Please select a supplier first', 'warning');
    return;
  }

  try {
    // Update PO with supplier and delivery date
    await opsPost('update_po', {
      id: poId,
      supplier_name: supplier,
      delivery_date: deliveryDate || null,
      status: 'draft'
    });

    if (sendToSupplier) {
      // Push as authorised and email
      await opsPost('push_po_to_xero', { id: poId, status: 'AUTHORISED' });
      await opsPost('email_po', { id: poId });
      showToast('PO approved, synced to Xero, and emailed to ' + supplier, 'success');
    } else {
      // Push as draft to Xero
      await opsPost('push_po_to_xero', { id: poId, status: 'draft' });
      showToast('PO saved as draft in Xero', 'success');
    }

    // Refresh the job detail view
    if (_currentJobId) {
      openJobDetail(_currentJobId);
    }
  } catch(e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

// Approve PO + open compose modal (for "Approve & Send to Supplier" on draft review cards)
async function approveAndComposePO(poId) {
  var supplierEl = document.getElementById('poSupplierPick' + poId);
  var supplier = supplierEl ? supplierEl.value : '';
  var dateEl = document.getElementById('poDeliveryPick' + poId);
  var deliveryDate = dateEl ? dateEl.value : '';

  if (!supplier) {
    showToast('Please select a supplier first', 'warning');
    return;
  }

  try {
    // Save supplier + delivery date on the PO
    await opsPost('update_po', {
      id: poId,
      supplier_name: supplier,
      delivery_date: deliveryDate || null,
      status: 'approved'
    });

    // Sync to Xero as draft (actual send happens via compose modal email)
    try {
      await opsPost('push_po_to_xero', { id: poId, status: 'draft' });
    } catch (e) { /* Xero sync non-critical */ }

    // Refresh POs so compose modal sees updated data
    var data = await opsFetch('list_pos');
    _allPOs = data.purchase_orders || [];

    // Open the compose modal pre-filled
    openPOEmailCompose(poId);
  } catch(e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

// Mark PO as delivered (manual — Shaun clicks on Confirmed cards)
// Future: Trade app materials_check can trigger this
async function markPODelivered(poId, btnEl) {
  if (!confirm('Mark this PO as delivered?')) return;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Updating...'; }
  try {
    await opsPost('update_po', { id: poId, status: 'billed' });
    showToast('PO marked as delivered', 'success');
    loadMaterials();
    if (_currentJobId) openJobDetail(_currentJobId);
  } catch(e) {
    showToast('Error: ' + e.message, 'warning');
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Mark Delivered'; }
  }
}

// FEATURE 9: Attachment support (TODOs)
// TODO: Create po_attachments table: id (uuid), po_id (uuid FK), filename (text), storage_url (text),
//       file_type (text), attachment_type (text — Quote/Invoice/Delivery Docket/Credit Note/Other),
//       uploaded_by (uuid FK), created_at (timestamptz)
// TODO: Add ops-api actions: upload_po_attachment, list_po_attachments, delete_po_attachment
// TODO: Use Supabase Storage bucket 'po_attachments' with path: po_attachments/[po_id]/[filename]
// TODO: On PO edit modal, add 'Attachments' section with file picker + type dropdown
// TODO: When 'Mark Invoice Received' is clicked, prompt to attach the invoice document

// ════════════════════════════════════════════════════════════
// CLIENT COMMS (Conversation Thread + Compose)
// ════════════════════════════════════════════════════════════

var _commsMode = 'sms'; // 'sms' | 'email'
var _commsGHLBase = window.SUPABASE_URL + '/functions/v1/ghl-proxy';

// GHL phone numbers — auto-select by job type
var SW_PHONE_NUMBERS = [
  { number: '+61489267771', display: '0489 267 771', label: 'SecureWorks Group Admin', types: [] },
  { number: '+61489267772', display: '0489 267 772', label: 'SecureWorks Fencing Sales', types: ['fencing'] },
  { number: '+61489267774', display: '0489 267 774', label: 'SecureWorks Patios', types: ['patio', 'decking'] },
  { number: '+61489267776', display: '0489 267 776', label: 'SecureWorks Group Ops', types: ['miscellaneous'] },
  { number: '+61489267778', display: '0489 267 778', label: 'SecureWorks Fencing Mgmt', types: [] },
];

function getCommsNumberForJob(job) {
  // Ops dashboard always sends from the Ops number
  return SW_PHONE_NUMBERS.find(function(p) { return p.number === '+61489267776'; }) || SW_PHONE_NUMBERS[0];
}

var COMMS_TEMPLATES = {
  scheduled:   'Hi {firstName}, your {jobType} project at {address} is scheduled for {date}. Our team will arrive between 7–8am. Please ensure clear access to the work area. Thanks, SecureWorks Group',
  materials:   'Hi {firstName}, materials are arriving for your {jobType} project at {address}. Build is on track. Thanks, SecureWorks Group',
  complete:    'Hi {firstName}, great news — your {jobType} project at {address} is complete! Your completion report is attached. Thanks for choosing SecureWorks Group.',
  payment:     'Hi {firstName}, just a friendly reminder that invoice {invoiceNumber} is now overdue. Please let us know if you have any questions. Thanks, SecureWorks Group',
  follow_up:   'Hi {firstName}, just checking in on the quote we sent for your {jobType} project. Happy to answer any questions. Thanks, SecureWorks Group',
};

function renderCommsView(data) {
  var j = data.job;
  var container = document.getElementById('jdComms');
  var pos = data.purchase_orders || [];

  var html = '';

  // Channel tabs: Client | Suppliers | Council | All Emails
  html += '<div class="comms-channel-tabs">';
  html += '<button class="comms-channel-tab active" id="commsTabClient" onclick="setCommsChannel(\'client\')">Client</button>';
  html += '<button class="comms-channel-tab" id="commsTabSuppliers" onclick="setCommsChannel(\'suppliers\')">Suppliers' + (pos.length ? ' (' + pos.length + ')' : '') + '</button>';
  html += '<button class="comms-channel-tab" id="commsTabCouncil" onclick="setCommsChannel(\'council\')">Council</button>';
  html += '<button class="comms-channel-tab" id="commsTabEmail" onclick="setCommsChannel(\'email\')">All Emails</button>';
  html += '</div>';

  // ── Client View ──
  html += '<div id="commsClientView">';

  if (!j.ghl_contact_id) {
    // No GHL contact — show link button and attempt auto-link
    html += '<div id="commsNoGHL" class="comms-empty">';
    html += '<div style="margin-bottom:8px;">No GHL contact linked to this job.</div>';
    if (j.client_phone || j.client_email) {
      html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-bottom:10px;">' + escapeHtml(j.client_name || '') + ' &middot; ' + escapeHtml(j.client_phone || j.client_email || '') + '</div>';
      html += '<button class="btn btn-sm" style="background:var(--sw-green);color:#fff;" onclick="autoLinkGHLContact()" id="commsLinkBtn">Find & Link GHL Contact</button>';
      html += '<div id="commsLinkStatus" style="font-size:11px;color:var(--sw-text-sec);margin-top:6px;"></div>';
    } else {
      html += '<div style="font-size:11px;color:var(--sw-text-sec);">No phone or email on this job. Add contact details first.</div>';
    }
    html += '</div>';
    // Still render the thread area (hidden) + compose area so auto-link can reveal them
    html += '<div id="commsLinkedView" style="display:none;">';
    html += '<div class="comms-header">';
    if (j.client_phone) {
      html += '<span class="phone-num">' + j.client_phone + '</span>';
      html += '<button class="comms-call-btn" onclick="scheduleCallLog()">&#9742; Call</button>';
    }
    html += '<span style="flex:1;"></span>';
    html += '<span id="commsGHLLink" style="font-size:11px;color:var(--sw-text-sec);"></span>';
    html += '</div>';
    html += '<div id="commsThread" class="comms-thread"></div>';
    html += '</div>';
    // Auto-attempt GHL lookup in background
    if (j.client_phone || j.client_email) {
      setTimeout(function() { tryAutoLinkGHL(); }, 500);
    }
  } else {
    // Header: phone + call button
    html += '<div class="comms-header">';
    if (j.client_phone) {
      html += '<span class="phone-num">' + j.client_phone + '</span>';
      if (_isMobile) {
        html += '<a href="tel:' + j.client_phone + '" class="comms-call-btn" onclick="scheduleCallLog()">&#9742; Call</a>';
      } else {
        html += '<button class="comms-call-btn" onclick="scheduleCallLog()">&#9742; Call</button>';
      }
    }
    html += '<span style="flex:1;"></span>';
    html += '<a href="https://app.maxlead.com.au/v2/location/' + GHL_LOCATION_ID + '/contacts/' + j.ghl_contact_id + '" target="_blank" style="font-size:11px;color:var(--sw-text-sec);">View in GHL &#8599;</a>';
    html += '</div>';

    // Thread (placeholder — loaded async)
    html += '<div id="commsThread" class="comms-thread"><div class="loading" style="text-align:center;padding:20px;">Loading conversation...</div></div>';

    // Compose area
    html += '<div class="comms-compose">';

    // Sending identity — auto-select number by job type
    var autoNum = getCommsNumberForJob(j);
    html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--sw-light);margin-bottom:8px;font-size:12px;">';
    html += '<span style="color:var(--sw-mid);font-weight:600;">From:</span>';
    html += '<select id="commsSenderSelect" style="font-size:12px;font-weight:600;color:var(--sw-dark);border:1px solid var(--sw-border);border-radius:3px;padding:3px 8px;background:var(--sw-card);flex:1;">';
    SW_PHONE_NUMBERS.forEach(function(pn) {
      var sel = pn.number === autoNum.number ? ' selected' : '';
      html += '<option value="' + pn.number + '"' + sel + '>' + escapeHtml(pn.label) + ' — ' + pn.display + '</option>';
    });
    html += '</select>';
    html += '</div>';

    // To: line — who we're contacting
    html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;margin-bottom:6px;font-size:12px;">';
    html += '<span style="color:var(--sw-mid);font-weight:600;">To:</span>';
    html += '<span style="color:var(--sw-dark);font-weight:600;">' + escapeHtml(j.client_name || '') + '</span>';
    html += '<span id="commsToDetail" style="color:var(--sw-mid);">' + (j.client_phone || '') + '</span>';
    html += '</div>';

    html += '<div class="comms-mode-tabs">';
    html += '<button class="comms-mode-tab active" onclick="setCommsMode(\'sms\')">SMS</button>';
    html += '<button class="comms-mode-tab" onclick="setCommsMode(\'email\')">Email</button>';
    html += '</div>';

    // Templates
    html += '<div class="comms-templates">';
    html += '<button class="comms-template-btn" onclick="applyCommsTemplate(\'scheduled\')">Scheduled</button>';
    html += '<button class="comms-template-btn" onclick="applyCommsTemplate(\'materials\')">Materials</button>';
    html += '<button class="comms-template-btn" onclick="applyCommsTemplate(\'complete\')">Complete</button>';
    html += '<button class="comms-template-btn" onclick="applyCommsTemplate(\'payment\')">Payment</button>';
    html += '<button class="comms-template-btn" onclick="applyCommsTemplate(\'follow_up\')">Follow Up</button>';
    html += '</div>';

    // SMS compose
    html += '<div id="commsCompSMS">';
    html += '<textarea id="commsSMSText" class="form-textarea" style="width:100%;min-height:60px;resize:vertical;" placeholder="Type your SMS message..." oninput="updateCommsCharCount()"></textarea>';
    html += '<div class="comms-char-count"><span id="commsCharCount">0</span>/160</div>';
    html += '</div>';

    // Email compose (hidden by default)
    html += '<div id="commsCompEmail" style="display:none;">';
    html += '<input type="email" class="form-input" id="commsEmailTo" value="' + escapeHtml(j.client_email || '') + '" placeholder="Recipient email" style="margin-bottom:6px;">';
    html += '<input type="text" class="form-input" id="commsEmailSubject" placeholder="Subject" style="margin-bottom:6px;">';
    html += '<textarea id="commsEmailBody" class="form-textarea" style="width:100%;min-height:80px;resize:vertical;" placeholder="Email body..."></textarea>';
    html += '</div>';

    html += '<div class="comms-send-row">';
    html += '<button class="comms-send-btn" onclick="sendCommsMessage()">Send</button>';
    html += '</div>';
    html += '</div>';
  }
  // ── Automated Communications Timeline ──
  html += '<div id="commsAutoSection" style="margin-top:16px;border-top:2px solid var(--sw-border);padding-top:12px;">';
  html += '<div style="font-size:13px;font-weight:700;color:var(--sw-dark);margin-bottom:8px;">Automated Communications</div>';
  html += '<div id="commsAutoTimeline"><div class="loading" style="text-align:center;padding:12px;font-size:12px;color:var(--sw-text-sec);">Loading...</div></div>';
  html += '</div>';

  // ── Client Email Thread ──
  html += '<div id="commsClientEmailSection" style="margin-top:16px;border-top:2px solid var(--sw-border);padding-top:12px;">';
  html += '<div style="font-size:13px;font-weight:700;color:var(--sw-dark);margin-bottom:8px;">Client Emails</div>';
  html += '<div id="commsClientEmailThread"><div class="loading" style="text-align:center;padding:12px;font-size:12px;color:var(--sw-text-sec);">Loading...</div></div>';
  html += '</div>';

  html += '</div>'; // end commsClientView

  // ── Supplier View ──
  html += '<div id="commsSupplierView" style="display:none;">';
  if (pos.length === 0) {
    html += '<div class="comms-empty">No purchase orders for this job yet.</div>';
  } else {
    var supplierGroups = {};
    pos.forEach(function(po) {
      var sn = po.supplier_name || 'Unknown';
      if (!supplierGroups[sn]) supplierGroups[sn] = [];
      supplierGroups[sn].push(po);
    });
    Object.keys(supplierGroups).forEach(function(sn) {
      var spos = supplierGroups[sn];
      var supplierEmail = '';
      var sup = _suppliers.find(function(s) { return s.name === sn; });
      if (sup) supplierEmail = sup.email || '';
      var groupId = 'supplierGroup_' + sn.replace(/[^a-zA-Z0-9]/g, '_');
      html += '<div class="supplier-thread-group" id="' + groupId + '">';
      html += '<div class="supplier-thread-header" onclick="this.parentElement.classList.toggle(\'expanded\')">';
      html += '<div><strong>' + escapeHtml(sn) + '</strong>';
      if (supplierEmail) html += ' <span style="font-size:11px;color:var(--sw-text-sec);">' + escapeHtml(supplierEmail) + '</span>';
      html += '<div style="font-size:11px;color:var(--sw-text-sec);">' + spos.map(function(p) { return p.po_number; }).join(', ') + '</div>';
      html += '</div>';
      html += '<span style="font-size:11px;color:var(--sw-text-sec);">' + spos.length + ' PO' + (spos.length > 1 ? 's' : '') + '</span>';
      html += '</div>';
      html += '<div class="supplier-thread-body">';
      spos.forEach(function(po) {
        html += '<div style="padding:6px 0;border-bottom:1px solid var(--sw-border);font-size:12px;display:flex;align-items:center;gap:8px;">';
        html += '<div style="flex:1;"><strong>' + (po.po_number || '') + '</strong> <span class="status-badge ' + (po.status || '') + '">' + (po.status || '') + '</span> ' + fmt$(po.total) + '</div>';
        html += '<button onclick="openPOEmailCompose(\'' + po.id + '\')" style="font-size:10px;padding:3px 8px;border:1px solid var(--sw-border);border-radius:3px;background:var(--sw-card);cursor:pointer;color:var(--sw-text-sec);white-space:nowrap;">&#9993; Email</button>';
        html += '</div>';
        html += '<div class="po-email-thread" id="poThreadComms_' + po.id + '"></div>';
      });
      html += '</div>';
      html += '</div>';
    });
  }
  html += '</div>'; // end commsSupplierView

  // ── Council View ──
  html += '<div id="commsCouncilView" style="display:none;">';
  html += '<div id="commsCouncilContent"><div class="loading" style="text-align:center;padding:20px;">Loading council submissions...</div></div>';
  html += '</div>';

  // ── All Emails View (unified timeline) ──
  html += '<div id="commsEmailView" style="display:none;">';
  html += '<div id="emailLogContent"><div class="loading" style="text-align:center;padding:20px;">Loading all emails...</div></div>';
  html += '</div>';

  container.innerHTML = html;

  // Load client conversation async
  if (j.ghl_contact_id) {
    loadConversation(j.ghl_contact_id);
  }

  // Load automated comms timeline
  loadAutoCommsTimeline(j.id);

  // Load client email thread
  loadClientEmailThread(j.id);

  // Load supplier email threads
  if (pos.length > 0) {
    pos.forEach(function(po) {
      loadPOEmails(po.id).then(function(emails) {
        var threadEl = document.getElementById('poThreadComms_' + po.id);
        if (threadEl && emails.length > 0) {
          threadEl.innerHTML = renderPOEmailThread(emails, po.id);
          threadEl.style.display = 'block';
        }
      });
    });
  }
}

function setCommsChannel(channel) {
  var clientView = document.getElementById('commsClientView');
  var supplierView = document.getElementById('commsSupplierView');
  var councilView = document.getElementById('commsCouncilView');
  var emailView = document.getElementById('commsEmailView');
  var clientTab = document.getElementById('commsTabClient');
  var supplierTab = document.getElementById('commsTabSuppliers');
  var councilTab = document.getElementById('commsTabCouncil');
  var emailTab = document.getElementById('commsTabEmail');
  if (!clientView || !supplierView) return;

  // Hide all
  clientView.style.display = 'none';
  supplierView.style.display = 'none';
  if (councilView) councilView.style.display = 'none';
  if (emailView) emailView.style.display = 'none';
  clientTab.classList.remove('active');
  supplierTab.classList.remove('active');
  if (councilTab) councilTab.classList.remove('active');
  if (emailTab) emailTab.classList.remove('active');

  if (channel === 'suppliers') {
    supplierView.style.display = 'block';
    supplierTab.classList.add('active');
  } else if (channel === 'council') {
    if (councilView) councilView.style.display = 'block';
    if (councilTab) councilTab.classList.add('active');
    loadCommsCouncil();
  } else if (channel === 'email') {
    if (emailView) emailView.style.display = 'block';
    if (emailTab) emailTab.classList.add('active');
    loadAllEmails();
  } else {
    clientView.style.display = 'block';
    clientTab.classList.add('active');
  }
}

// ── Email Log: fetch + render ──
var _emailLogLoaded = false;
async function loadEmailLog() {
  if (_emailLogLoaded) return;
  var container = document.getElementById('emailLogContent');
  if (!container || !_currentJobId) return;

  try {
    var res = await fetch(OPS_API + '?action=get_email_events&job_id=' + _currentJobId);
    var events = await res.json();
    _emailLogLoaded = false; // allow refresh on next open
    if (!events || events.length === 0) {
      container.innerHTML = '<div class="comms-empty">No emails logged for this job yet.</div>';
      return;
    }
    _emailLogLoaded = true;
    container.innerHTML = renderEmailLog(events);
  } catch (e) {
    container.innerHTML = '<div class="comms-empty">Failed to load email log.</div>';
  }
}

// ── Council Comms: fetch council submissions + render step threads ──
var _commsCouncilLoaded = false;
async function loadCommsCouncil() {
  if (_commsCouncilLoaded) return;
  var container = document.getElementById('commsCouncilContent');
  if (!container || !_currentJobId) return;

  try {
    var data = await opsFetch('list_council_submissions', { job_id: _currentJobId });
    var subs = data.submissions || [];
    if (subs.length === 0) {
      container.innerHTML = '<div class="comms-empty">No council submissions for this job.</div>';
      return;
    }
    _commsCouncilLoaded = true;
    var html = '';
    subs.forEach(function(sub) {
      var steps = sub.steps || [];
      var emails = sub.email_threads || [];
      var statusLabel = (sub.overall_status || 'not_started').replace(/_/g, ' ');
      var statusColor = sub.overall_status === 'complete' ? 'var(--sw-green)' : sub.overall_status === 'blocked' ? 'var(--sw-red)' : sub.overall_status === 'in_progress' ? 'var(--sw-blue,#3498DB)' : 'var(--sw-text-sec)';

      html += '<div style="border:1px solid var(--sw-border);margin-bottom:10px;border-radius:6px;overflow:hidden;">';
      html += '<div style="padding:10px 12px;background:var(--sw-light);display:flex;justify-content:space-between;align-items:center;">';
      html += '<div><strong>' + escapeHtml(sub.job_number || '') + '</strong> <span style="font-size:11px;color:var(--sw-text-sec);">Council Submission</span></div>';
      html += '<span style="font-size:10px;padding:2px 8px;border-radius:3px;background:' + statusColor + '20;color:' + statusColor + ';font-weight:600;text-transform:capitalize;">' + statusLabel + '</span>';
      html += '</div>';
      html += '<div style="padding:8px 12px;">';
      // Render using the same pattern as council card detail
      if (typeof renderCouncilCardDetail === 'function') {
        html += renderCouncilCardDetail(sub);
      } else {
        // Fallback: simple step list
        steps.forEach(function(step, idx) {
          var icon = step.status === 'complete' ? '<span style="color:var(--sw-green);">&#10003;</span>' : step.status === 'in_progress' ? '<span style="color:var(--sw-blue,#3498DB);">&#9679;</span>' : step.status === 'blocked' ? '<span style="color:var(--sw-red);">&#10007;</span>' : '<span style="color:var(--sw-text-sec);">&#9675;</span>';
          html += '<div style="padding:3px 0;font-size:11px;">' + icon + ' ' + escapeHtml(step.name) + '</div>';
        });
      }
      html += '</div></div>';
    });
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="comms-empty">Failed to load council data: ' + escapeHtml(e.message) + '</div>';
  }
}

// ── All Emails: unified chronological timeline (PO + council) ──
var _allEmailsLoaded = false;
async function loadAllEmails() {
  if (_allEmailsLoaded) return;
  var container = document.getElementById('emailLogContent');
  if (!container || !_currentJobId) return;

  try {
    var data = await opsFetch('list_po_communications', { job_id: _currentJobId, limit: '100' });
    var emails = data.emails || [];
    if (emails.length === 0) {
      container.innerHTML = '<div class="comms-empty">No emails for this job yet.</div>';
      return;
    }
    _allEmailsLoaded = true;
    // Sort by date (newest first)
    emails.sort(function(a, b) { return (b.created_at || '') > (a.created_at || '') ? 1 : -1; });
    var html = '<div style="font-size:11px;color:var(--sw-text-sec);margin-bottom:8px;">' + emails.length + ' emails across all POs and council submissions</div>';
    emails.forEach(function(em) {
      var isInbound = em.direction === 'inbound' || em.direction === 'received';
      var dir = isInbound ? '<span style="color:var(--sw-blue,#3498DB)">&#8601;</span>' : '<span style="color:var(--sw-orange)">&#8599;</span>';
      var date = em.created_at ? new Date(em.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      var bgColor = isInbound ? 'rgba(52,152,219,0.04)' : 'rgba(241,90,41,0.04)';
      var borderColor = isInbound ? 'var(--sw-blue,#3498DB)' : 'var(--sw-orange)';
      var typeBadge = em.communication_type === 'council' ? '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(52,152,219,0.1);color:var(--sw-blue,#3498DB);font-weight:600;margin-left:4px;">Council</span>' : '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(241,90,41,0.1);color:var(--sw-orange);font-weight:600;margin-left:4px;">PO</span>';
      var statusBadge = '';
      if (!isInbound && em.delivery_status) {
        var bc = em.delivery_status === 'opened' ? 'var(--sw-green)' : em.delivery_status === 'delivered' ? 'var(--sw-blue,#3498DB)' : em.delivery_status === 'bounced' ? 'var(--sw-red)' : '#999';
        statusBadge = ' <span style="font-size:9px;padding:1px 4px;border-radius:3px;background:' + bc + '20;color:' + bc + ';font-weight:600;">' + escapeHtml(em.delivery_status) + '</span>';
      }
      var bodyText = em.body_text || '';
      var firstLine = bodyText.split('\n')[0] || '';
      if (firstLine.length > 80) firstLine = firstLine.substring(0, 80) + '...';

      html += '<div class="po-email-item" style="padding:8px 12px;margin-bottom:4px;border-left:3px solid ' + borderColor + ';background:' + bgColor + ';border-radius:0 6px 6px 0;cursor:pointer;" onclick="this.classList.toggle(\'expanded\')">';
      html += '<div style="font-size:10px;color:var(--sw-text-sec);display:flex;justify-content:space-between;align-items:center;">';
      html += '<span>' + dir + ' ' + escapeHtml(isInbound ? (em.from_email || '') : (em.to_email || '')) + typeBadge + '</span>';
      html += '<span>' + date + statusBadge + '</span></div>';
      if (em.subject) html += '<div style="font-size:11px;font-weight:600;margin-top:2px;">' + escapeHtml(em.subject.length > 70 ? em.subject.substring(0, 70) + '...' : em.subject) + '</div>';
      html += '<div class="po-email-preview" style="font-size:11px;color:var(--sw-text-sec);margin-top:2px;">' + escapeHtml(firstLine) + '</div>';
      html += '<div class="po-email-body" style="display:none;font-size:11px;color:var(--sw-text);margin-top:4px;white-space:pre-wrap;line-height:1.5;">' + escapeHtml(bodyText) + '</div>';
      html += '</div>';
    });
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="comms-empty">Failed to load emails: ' + escapeHtml(e.message) + '</div>';
  }
}

function renderEmailLog(events) {
  var html = '';

  // Group by type
  var groups = { quote: [], invoice: [], reminder: [], other: [] };
  events.forEach(function(ev) {
    var t = ev.email_type || 'other';
    if (groups[t]) groups[t].push(ev);
    else groups.other.push(ev);
  });

  var groupOrder = [
    { key: 'invoice', icon: '\uD83C\uDFE2', label: 'Invoice Emails' },
    { key: 'quote', icon: '\uD83D\uDC64', label: 'Quote Emails' },
    { key: 'reminder', icon: '\u23F0', label: 'Reminders' },
    { key: 'other', icon: '\uD83D\uDCE7', label: 'Other' }
  ];

  groupOrder.forEach(function(g) {
    var items = groups[g.key];
    if (!items || items.length === 0) return;

    html += '<div style="margin-bottom:16px;">';
    html += '<div style="font-size:12px;font-weight:600;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">' + g.icon + ' ' + g.label + ' (' + items.length + ')</div>';

    items.forEach(function(ev) {
      var statusColor = ev.status === 'sent' ? 'var(--sw-orange)' : ev.status === 'delivered' ? '#34C759' : ev.status === 'opened' ? '#007AFF' : ev.status === 'failed' ? '#FF3B30' : ev.status === 'bounced' ? '#FF3B30' : 'var(--sw-text-sec)';
      var statusLabel = (ev.status || 'unknown').charAt(0).toUpperCase() + (ev.status || 'unknown').slice(1);

      // Buying signal: opened multiple times
      var openBadge = '';
      var meta = ev.metadata || {};
      if (ev.status === 'opened' && meta.open_count && meta.open_count > 2) {
        openBadge = ' <span style="background:var(--sw-orange);color:#fff;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600;">Opened ' + meta.open_count + 'x</span>';
      }

      // Bounce warning
      var bounceBadge = '';
      if (ev.status === 'bounced') {
        bounceBadge = ' <span style="background:#FF3B30;color:#fff;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600;">Bounced</span>';
      }

      var dateStr = ev.sent_at ? new Date(ev.sent_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : (ev.created_at ? new Date(ev.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

      html += '<div style="padding:8px 10px;margin-bottom:4px;background:var(--sw-light);border-radius:6px;font-size:12px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      html += '<div style="font-weight:600;color:var(--sw-dark);">' + escapeHtml(ev.subject || 'No subject') + '</div>';
      html += '<span style="color:' + statusColor + ';font-size:11px;font-weight:600;">' + statusLabel + '</span>';
      html += '</div>';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;color:var(--sw-text-sec);font-size:11px;">';
      html += '<span>To: ' + escapeHtml(ev.recipient || '') + '</span>';
      html += '<span>' + dateStr + '</span>';
      html += '</div>';
      if (openBadge || bounceBadge) {
        html += '<div style="margin-top:4px;">' + openBadge + bounceBadge + '</div>';
      }
      if (ev.failure_reason) {
        html += '<div style="margin-top:4px;color:#FF3B30;font-size:11px;">Error: ' + escapeHtml(ev.failure_reason) + '</div>';
      }
      html += '</div>';
    });

    html += '</div>';
  });

  return html;
}

async function loadConversation(contactId) {
  var cacheKey = 'sw_convo_' + contactId;
  var cached = sessionStorage.getItem(cacheKey);

  if (cached) {
    try {
      var cachedData = JSON.parse(cached);
      renderMessageThread(cachedData.messages, cachedData.conversationId);
      return;
    } catch (e) {}
  }

  try {
    var resp = await fetch(_commsGHLBase + '?action=get_conversation&contactId=' + contactId, { headers: await _getAuthHeaders() });
    var data = await resp.json();

    if (data.error) throw new Error(data.error);

    // Cache for session
    sessionStorage.setItem(cacheKey, JSON.stringify(data));
    renderMessageThread(data.messages || [], data.conversationId);
  } catch (e) {
    console.error('[comms] Conversation load failed for contact ' + contactId + ':', e);
    var thread = document.getElementById('commsThread');
    if (thread) {
      var j = _currentJobData?.job;
      var ghlLink = j?.ghl_contact_id ? 'https://app.maxlead.com.au/v2/location/' + GHL_LOCATION_ID + '/contacts/' + j.ghl_contact_id : '#';
      thread.innerHTML = '<div class="comms-empty">Conversation failed to load: ' + escapeHtml(e.message || 'Unknown error') + '<br><a href="' + ghlLink + '" target="_blank" style="color:var(--sw-orange);">View in GHL &#8599;</a></div>';
    }
  }
}

function renderMessageThread(messages, conversationId) {
  var thread = document.getElementById('commsThread');
  if (!thread) return;

  if (!messages || messages.length === 0) {
    thread.innerHTML = '<div class="comms-empty">No messages yet. Send the first one below.</div>';
    return;
  }

  // Sort chronologically (oldest first)
  messages.sort(function(a, b) { return (a.timestamp || '') < (b.timestamp || '') ? -1 : 1; });

  var html = '';
  messages.forEach(function(msg) {
    var ts = msg.timestamp ? new Date(msg.timestamp) : null;
    var timeStr = ts ? ts.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' ' + ts.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '';
    var type = (msg.type || 'SMS').toUpperCase().replace('TYPE_', '');

    // Call logs
    if (type === 'CALL' || type === 'VOICEMAIL') {
      var durMin = msg.duration ? Math.round(msg.duration / 60) : 0;
      html += '<div class="comms-msg call-log">&#9742; Phone call' + (durMin > 0 ? ' — ' + durMin + ' min' : '') + ' — ' + timeStr + '</div>';
      return;
    }

    var dir = msg.direction === 'outbound' ? 'outbound' : 'inbound';
    var isEmail = type === 'EMAIL';

    html += '<div class="comms-msg ' + dir + (isEmail ? ' email' : '') + '">';
    if (isEmail && msg.subject) {
      html += '<div class="comms-msg-subject">&#9993; ' + escapeHtml(msg.subject || '') + '</div>';
    }
    html += '<div>' + escapeHtml(msg.body || '') + '</div>';
    html += '<div class="comms-msg-meta">' + timeStr;
    if (dir === 'outbound' && msg.sender_name) html += ' &middot; ' + escapeHtml(msg.sender_name);
    if (isEmail) html += ' &middot; Email';
    html += '</div>';
    html += '</div>';
  });

  thread.innerHTML = html;
  // Auto-scroll to bottom
  thread.scrollTop = thread.scrollHeight;
}

function setCommsMode(mode) {
  _commsMode = mode;
  document.querySelectorAll('.comms-mode-tab').forEach(function(b) {
    b.classList.toggle('active', b.textContent.toLowerCase() === mode);
  });
  document.getElementById('commsCompSMS').style.display = mode === 'sms' ? 'block' : 'none';
  document.getElementById('commsCompEmail').style.display = mode === 'email' ? 'block' : 'none';

  // Update To: line for SMS vs Email
  var j = _currentJobData ? _currentJobData.job : {};
  var toDetail = document.getElementById('commsToDetail');
  if (toDetail) toDetail.textContent = mode === 'sms' ? (j.client_phone || '') : (j.client_email || 'No email on file');
}

function updateCommsCharCount() {
  var text = document.getElementById('commsSMSText').value;
  var count = document.getElementById('commsCharCount');
  count.textContent = text.length;
  count.style.color = text.length > 160 ? 'var(--sw-red)' : 'var(--sw-text-sec)';
}

function applyCommsTemplate(key) {
  var tmpl = COMMS_TEMPLATES[key];
  if (!tmpl) return;
  var j = _currentJobData?.job;
  if (!j) return;

  var firstName = (j.client_name || '').split(' ')[0] || 'there';
  var text = tmpl
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{jobNumber\}/g, j.job_number || '')
    .replace(/\{address\}/g, j.site_address || j.site_suburb || '')
    .replace(/\{jobType\}/g, j.type || 'patio')
    .replace(/\{date\}/g, j.scheduled_at ? fmtDate(j.scheduled_at) : '[date]')
    .replace(/\{invoiceNumber\}/g, '[invoice #]');

  if (_commsMode === 'sms') {
    document.getElementById('commsSMSText').value = text;
    updateCommsCharCount();
  } else {
    document.getElementById('commsEmailBody').value = text;
    document.getElementById('commsEmailSubject').value = key === 'payment' ? 'Payment Reminder' : key === 'complete' ? 'Project Complete' : 'Update from SecureWorks Group';
  }
}

async function sendCommsMessage() {
  var j = _currentJobData?.job;
  if (!j || !j.ghl_contact_id) { showToast('No GHL contact linked', 'warning'); return; }

  if (_commsMode === 'sms') {
    var text = document.getElementById('commsSMSText').value.trim();
    if (!text) { showToast('Message is empty', 'warning'); return; }

    // Optimistic UI: show message immediately
    addOptimisticMessage(text, 'SMS');
    document.getElementById('commsSMSText').value = '';
    updateCommsCharCount();

    try {
      await fetch(_commsGHLBase + '?action=send_sms', {
        method: 'POST',
        headers: await _getAuthHeaders(),
        body: JSON.stringify({
          contactId: j.ghl_contact_id,
          message: text,
          jobId: j.id,
        }),
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (!data.success) throw new Error(data.error || 'Send failed');
      });
      // Clear cache so next load gets fresh data
      sessionStorage.removeItem('sw_convo_' + j.ghl_contact_id);
    } catch (e) {
      showToast('SMS failed: ' + e.message + ' — retry?', 'warning');
    }
  } else {
    var subject = document.getElementById('commsEmailSubject').value.trim();
    var body = document.getElementById('commsEmailBody').value.trim();
    if (!subject || !body) { showToast('Subject and body required', 'warning'); return; }

    addOptimisticMessage(body, 'EMAIL', subject);
    document.getElementById('commsEmailSubject').value = '';
    document.getElementById('commsEmailBody').value = '';

    try {
      await fetch(_commsGHLBase + '?action=send_email', {
        method: 'POST',
        headers: await _getAuthHeaders(),
        body: JSON.stringify({
          contactId: j.ghl_contact_id,
          subject: subject,
          htmlBody: '<p>' + body.replace(/\n/g, '<br>') + '</p>',
        }),
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (!data.success) throw new Error(data.error || 'Send failed');
      });
      sessionStorage.removeItem('sw_convo_' + j.ghl_contact_id);
    } catch (e) {
      showToast('Email failed: ' + e.message, 'warning');
    }
  }
}

// ── Auto-Link GHL Contact ──

async function tryAutoLinkGHL() {
  var j = _currentJobData?.job;
  if (!j || j.ghl_contact_id) return;
  var statusEl = document.getElementById('commsLinkStatus');
  if (statusEl) statusEl.textContent = 'Searching GHL...';

  try {
    var searchQuery = j.client_phone || j.client_email || j.client_name || '';
    if (!searchQuery) return;

    var resp = await fetch(window.SUPABASE_URL + '/functions/v1/ghl-proxy?action=search&q=' + encodeURIComponent(searchQuery), {
      headers: await _getAuthHeaders()
    });
    var data = await resp.json();
    var opps = data.opportunities || [];

    if (opps.length > 0) {
      // Found a match — auto-link
      var match = opps[0];
      var contactId = match.contactId;
      if (contactId) {
        // Update the job in Supabase
        await opsPost('update_job_field', { job_id: j.id, field: 'ghl_contact_id', value: contactId });
        j.ghl_contact_id = contactId;
        _currentJobData.job.ghl_contact_id = contactId;

        // Show the comms view
        var noGHL = document.getElementById('commsNoGHL');
        var linkedView = document.getElementById('commsLinkedView');
        if (noGHL) noGHL.style.display = 'none';
        if (linkedView) {
          linkedView.style.display = '';
          var ghlLink = document.getElementById('commsGHLLink');
          if (ghlLink) ghlLink.innerHTML = '<a href="https://app.maxlead.com.au/v2/location/' + GHL_LOCATION_ID + '/contacts/' + contactId + '" target="_blank" style="color:var(--sw-text-sec);">View in GHL &#8599;</a>';
        }
        loadConversation(contactId);
        if (statusEl) statusEl.textContent = '';
        showToast('GHL contact linked automatically', 'success');
        return;
      }
    }

    // No match found
    if (statusEl) statusEl.textContent = 'No existing GHL contact found. Click to create one.';
  } catch (e) {
    console.error('[comms] Auto-link failed:', e);
    if (statusEl) statusEl.textContent = 'Could not search GHL. Try manually.';
  }
}

async function autoLinkGHLContact() {
  var j = _currentJobData?.job;
  if (!j) return;
  var btn = document.getElementById('commsLinkBtn');
  var statusEl = document.getElementById('commsLinkStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Linking...'; }

  try {
    // Split client name into first/last
    var nameParts = (j.client_name || '').trim().split(/\s+/);
    var firstName = nameParts[0] || '';
    var lastName = nameParts.slice(1).join(' ') || '';

    var resp = await fetch(window.SUPABASE_URL + '/functions/v1/ghl-proxy?action=create_contact_and_opportunity', {
      method: 'POST',
      headers: await _getAuthHeaders(),
      body: JSON.stringify({
        firstName: firstName,
        lastName: lastName,
        email: j.client_email || '',
        phone: j.client_phone || '',
        address: j.site_address || '',
        suburb: j.site_suburb || '',
        toolType: j.type || 'patio',
      }),
    });
    var data = await resp.json();

    if (data.contactId) {
      // Update job with GHL contact + opportunity
      await opsPost('update_job_field', { job_id: j.id, field: 'ghl_contact_id', value: data.contactId });
      if (data.opportunityId) {
        await opsPost('update_job_field', { job_id: j.id, field: 'ghl_opportunity_id', value: data.opportunityId });
      }
      j.ghl_contact_id = data.contactId;
      _currentJobData.job.ghl_contact_id = data.contactId;

      showToast(data.contactExisted ? 'Linked to existing GHL contact' : 'New GHL contact created & linked', 'success');
      // Reload the full comms tab
      openJobDetail(j.id);
    } else {
      throw new Error(data.error || 'Failed to create GHL contact');
    }
  } catch (e) {
    console.error('[comms] Link failed:', e);
    if (statusEl) statusEl.textContent = 'Failed: ' + e.message;
    if (btn) { btn.disabled = false; btn.textContent = 'Find & Link GHL Contact'; }
  }
}

function addOptimisticMessage(body, type, subject) {
  var thread = document.getElementById('commsThread');
  if (!thread) return;
  var now = new Date();
  var timeStr = now.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' ' + now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  var isEmail = type === 'EMAIL';
  var div = document.createElement('div');
  div.className = 'comms-msg outbound' + (isEmail ? ' email' : '');
  div.style.opacity = '0.7';
  var html = '';
  if (isEmail && subject) html += '<div class="comms-msg-subject">&#9993; ' + escapeHtml(subject) + '</div>';
  html += '<div>' + escapeHtml(body) + '</div>';
  html += '<div class="comms-msg-meta">' + timeStr + ' &middot; Sending...</div>';
  div.innerHTML = html;
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
  // Confirm after 2s
  setTimeout(function() { div.style.opacity = '1'; var meta = div.querySelector('.comms-msg-meta'); if (meta) meta.textContent = timeStr + ' &middot; Sent'; }, 2000);
}

// ── Call System (Bridge on desktop, tel: on mobile) ──
var _isMobile = ('ontouchstart' in window) || window.innerWidth < 768;

function scheduleCallLog() {
  if (!_currentJobData) return;
  var j = _currentJobData.job;

  if (_isMobile) {
    // Mobile: use tel: link (already navigating) + log on return
    document.addEventListener('visibilitychange', _onCallReturn, { once: true });
  } else {
    // Desktop: show bridge calling modal
    openCallBridgeModal(j);
  }
}

function openCallBridgeModal(j) {
  var userPhone = localStorage.getItem('sw_my_phone') || '';
  var clientPhone = j.client_phone || '';
  var firstName = (j.client_name || '').split(' ')[0] || 'client';

  var html = '<div class="modal-title">Call ' + escapeHtml(j.client_name || 'Client') + '</div>';
  html += '<div style="margin-bottom:12px;font-size:13px;color:var(--sw-text-sec);">You\'ll receive a call on your phone that connects you to the client.</div>';
  html += '<div class="form-group"><label class="form-label">Client Number</label><input type="text" class="form-input" value="' + escapeHtml(clientPhone) + '" readonly style="background:var(--sw-light);"></div>';
  html += '<div class="form-group"><label class="form-label">Your Phone Number</label><input type="tel" class="form-input" id="callBridgeUserPhone" value="' + escapeHtml(userPhone) + '" placeholder="04XX XXX XXX"></div>';
  html += '<div style="font-size:10px;color:var(--sw-text-sec);margin-bottom:12px;"><a href="#" onclick="event.preventDefault();document.getElementById(\'callSettingsRow\').style.display=\'block\';">Settings</a></div>';
  html += '<div id="callSettingsRow" style="display:none;margin-bottom:12px;"><label class="form-label">Save as my default number</label><button class="btn btn-secondary btn-sm" onclick="localStorage.setItem(\'sw_my_phone\',document.getElementById(\'callBridgeUserPhone\').value);showToast(\'Saved\',\'success\');">Save</button></div>';
  html += '<div id="callBridgeStatus" style="display:none;text-align:center;padding:16px;font-size:13px;color:var(--sw-mid);"></div>';
  html += '<div class="modal-actions" id="callBridgeActions">';
  html += '<button class="btn btn-secondary" onclick="closeModal(\'callBridgeModal\')">Cancel</button>';

  // If bridge calling isn't available yet, offer fallback
  html += '<button class="btn btn-cta" onclick="startBridgeCall()" style="background:var(--sw-green);border-color:var(--sw-green);">Start Call</button>';
  html += '</div>';

  // Create or update the modal
  var modal = document.getElementById('callBridgeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'callBridgeModal';
    modal.innerHTML = '<div class="modal" style="max-width:400px;">' + html + '</div>';
    document.body.appendChild(modal);
  } else {
    modal.querySelector('.modal').innerHTML = html;
  }
  modal.classList.add('active');
}

async function startBridgeCall() {
  var j = _currentJobData?.job;
  if (!j) return;
  var userPhone = document.getElementById('callBridgeUserPhone').value.trim();
  if (!userPhone) { showToast('Enter your phone number', 'warning'); return; }

  // Save phone for next time
  localStorage.setItem('sw_my_phone', userPhone);

  var statusEl = document.getElementById('callBridgeStatus');
  var actionsEl = document.getElementById('callBridgeActions');
  statusEl.style.display = 'block';
  statusEl.innerHTML = '<div>Connecting...</div><button class="btn btn-secondary btn-sm" onclick="closeModal(\'callBridgeModal\')" style="margin-top:8px;">Cancel</button>';
  actionsEl.style.display = 'none';

  try {
    var resp = await fetch(_commsGHLBase + '?action=initiate_call', {
      method: 'POST',
      headers: await _getAuthHeaders(),
      body: JSON.stringify({
        contactId: j.ghl_contact_id,
        toNumber: j.client_phone,
        userPhone: userPhone,
      }),
    });
    var data = await resp.json();

    if (data.success) {
      statusEl.innerHTML = '<div style="color:var(--sw-green);font-weight:600;">Call connected</div><div style="font-size:11px;margin-top:4px;">Your phone should be ringing...</div>';
      // After a delay, show call notes prompt
      setTimeout(function() {
        closeModal('callBridgeModal');
        promptCallNotes();
      }, 5000);
    } else {
      // Fallback: copy number + tel link
      statusEl.innerHTML = '<div style="color:var(--sw-yellow);">Bridge calling not available yet</div>' +
        '<div style="margin-top:8px;font-size:13px;">Call directly: <a href="tel:' + j.client_phone + '" style="font-weight:600;color:var(--sw-dark);">' + j.client_phone + '</a></div>' +
        '<button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(\'' + j.client_phone + '\');showToast(\'Copied\',\'success\')" style="margin-top:6px;">Copy Number</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="closeModal(\'callBridgeModal\');promptCallNotes()" style="margin-top:6px;">Log Call Notes</button>';
    }
  } catch (e) {
    statusEl.innerHTML = '<div style="color:var(--sw-red);">Connection failed</div>' +
      '<div style="margin-top:8px;font-size:13px;">Call directly: <a href="tel:' + j.client_phone + '">' + j.client_phone + '</a></div>' +
      '<button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(\'' + j.client_phone + '\');showToast(\'Copied\',\'success\')" style="margin-top:6px;">Copy Number</button>';
  }
}

function promptCallNotes() {
  if (!_currentJobData) return;
  var note = prompt('Log call notes? (leave blank to skip)');
  if (note !== null && note.trim()) {
    opsPost('add_note', {
      job_id: _currentJobData.job.id,
      note: 'Phone call: ' + note.trim(),
      event_type: 'call_logged',
    }).then(function() {
      showToast('Call logged', 'success');
      var cid = _currentJobData?.job?.ghl_contact_id;
      if (cid) sessionStorage.removeItem('sw_convo_' + cid);
    }).catch(function() {});
  }
}

function _onCallReturn() {
  if (document.visibilityState !== 'visible') {
    document.addEventListener('visibilitychange', _onCallReturn, { once: true });
    return;
  }
  setTimeout(function() { promptCallNotes(); }, 500);
}

// ════════════════════════════════════════════════════════════
// PO EMAIL LOG
// ════════════════════════════════════════════════════════════

function openPOEmailLog(poId, supplier, jobId) {
  document.getElementById('poEmailPOId').value = poId;
  document.getElementById('poEmailJobId').value = jobId || '';
  document.getElementById('poEmailSupplier').value = supplier || '';
  document.getElementById('poEmailSummary').value = '';
  document.querySelector('input[name="poEmailDir"][value="sent"]').checked = true;
  document.getElementById('poEmailLogModal').classList.add('active');
}

async function submitPOEmailLog() {
  var poId = document.getElementById('poEmailPOId').value;
  var jobId = document.getElementById('poEmailJobId').value;
  var supplier = document.getElementById('poEmailSupplier').value;
  var summary = document.getElementById('poEmailSummary').value.trim();
  var direction = document.querySelector('input[name="poEmailDir"]:checked').value;

  if (!summary) { showToast('Summary is required', 'warning'); return; }

  try {
    await opsPost('add_po_event', {
      po_id: poId,
      job_id: jobId || null,
      event_type: 'po_email_log',
      supplier: supplier,
      summary: summary,
      direction: direction,
    });
    closeModal('poEmailLogModal');
    showToast('Email logged', 'success');
    // Refresh current view if job detail is open
    if (_currentJobId) {
      openJobDetail(_currentJobId);
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

// ════════════════════════════════════════════════════════════
// SHARED PO CARD COMPONENT (used by Materials kanban + Money tab)
// ════════════════════════════════════════════════════════════

var _expandedPOCardId = null;

function renderPOCardCompact(po, options) {
  options = options || {};
  var emails = po.communications || po.email_threads || [];
  var emailCount = emails.length;
  var lastEmail = emailCount > 0 ? emails[emailCount - 1] : null;

  // Status mapping
  var statusLabels = { draft: 'DRAFT', approved: 'APPROVED', submitted: 'SENT', quote_requested: 'QUOTED', authorised: 'CONFIRMED', billed: 'DELIVERED' };
  var statusColors = { draft: '#95A5A6', approved: '#2980B9', submitted: '#3498DB', quote_requested: '#8E44AD', authorised: '#E67E22', billed: '#27AE60' };
  var statusLabel = statusLabels[po.status] || (po.status || '').toUpperCase();
  var statusColor = statusColors[po.status] || '#95A5A6';

  // Job reference
  var jobRef = '';
  if (po.job_number || po.reference) jobRef = po.job_number || po.reference || '';

  // Description from first line item
  var desc = po.description || '';
  if (!desc) {
    var items = po.line_items || po.items || [];
    if (Array.isArray(items) && items.length > 0) {
      desc = items.map(function(li) { return li.description || ''; }).filter(Boolean).join(', ');
      if (desc.length > 50) desc = desc.slice(0, 50) + '...';
    }
  }

  var isExpanded = _expandedPOCardId === po.id;
  var cardId = 'poCardShared_' + po.id;

  var html = '<div class="po-card-shared" id="' + cardId + '" style="background:var(--sw-card,#fff);padding:12px;margin-bottom:8px;box-shadow:var(--sw-shadow,0 1px 3px rgba(0,0,0,0.08));border-left:3px solid ' + statusColor + ';">';

  // Row 1: Supplier + Amount + Status
  html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
  html += '<span style="font-weight:700;font-size:13px;color:var(--sw-dark);">' + escapeHtml(po.supplier_name || 'No supplier') + '</span>';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span style="font-weight:600;font-family:var(--sw-font-num);font-size:13px;">' + fmt$(po.total) + '</span>';
  html += '<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:' + statusColor + '18;color:' + statusColor + ';font-weight:700;letter-spacing:0.5px;">' + statusLabel + '</span>';
  html += '</div></div>';

  // Row 2: PO number + description + job number
  var metaParts = [po.po_number || '', desc, jobRef].filter(Boolean);
  if (metaParts.length > 0) {
    html += '<div style="font-size:11px;color:var(--sw-text-sec);margin-top:3px;">' + escapeHtml(metaParts.join(' · ')) + '</div>';
  }

  // Row 3: Email summary OR "Send PO" button
  if (emailCount > 0 && lastEmail) {
    var emailDir = (lastEmail.direction === 'inbound' || lastEmail.direction === 'received') ? '&#8601;' : '&#8599;';
    var emailPreview = (lastEmail.subject || lastEmail.body_text || '').slice(0, 50);
    var hasUnread = emails.some(function(e) { return (e.direction === 'inbound' || e.direction === 'received') && !e.read_at; });
    html += '<div style="font-size:11px;color:var(--sw-text-sec);margin-top:6px;display:flex;align-items:center;gap:4px;">';
    if (hasUnread) html += '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--sw-blue,#3498DB);"></span>';
    html += '<span>&#128233; ' + emailCount + ' email' + (emailCount > 1 ? 's' : '') + '</span>';
    html += '<span style="color:var(--sw-text-sec);">· "' + escapeHtml(emailPreview) + '"</span>';
    html += '</div>';
  } else if (po.status !== 'draft') {
    html += '<div style="margin-top:6px;">';
    html += '<button class="btn btn-sm btn-secondary" style="font-size:11px;" onclick="event.stopPropagation();openPOEmailCompose(\'' + po.id + '\')">&#9993; Send PO</button>';
    html += '</div>';
  }

  // Row 4: Expand/Collapse toggle
  html += '<div style="margin-top:6px;display:flex;justify-content:flex-end;">';
  html += '<button class="btn btn-sm" style="font-size:10px;padding:2px 8px;background:none;border:1px solid var(--sw-border);color:var(--sw-text-sec);" onclick="event.stopPropagation();togglePOCardExpand(\'' + po.id + '\')">' + (isExpanded ? '&#9650; Hide' : '&#9660; Expand') + '</button>';
  html += '</div>';

  // Expanded section
  html += '<div id="poCardBody_' + po.id + '" style="display:' + (isExpanded ? 'block' : 'none') + ';margin-top:10px;padding-top:10px;border-top:1px solid var(--sw-border);">';
  html += '<div style="display:flex;gap:6px;margin-bottom:8px;">';
  html += '<button class="btn btn-sm btn-secondary" style="font-size:11px;" onclick="event.stopPropagation();openPOEdit(\'' + po.id + '\')">Edit PO</button>';
  if (po.job_id) html += '<button class="btn btn-sm btn-secondary" style="font-size:11px;" onclick="event.stopPropagation();openJobQuickView(\'' + po.id.replace(/'/g, '') + '\')">View Job</button>';
  html += '</div>';

  // Email thread placeholder (loaded async)
  html += '<div id="poCardThread_' + po.id + '"><div style="font-size:11px;color:var(--sw-text-sec);">Loading emails...</div></div>';

  // Inline reply bar
  html += renderInlineReplyBar(po.id, 'po', lastEmail);

  html += '</div>'; // expanded body
  html += '</div>'; // card
  return html;
}

function togglePOCardExpand(poId) {
  var wasExpanded = _expandedPOCardId === poId;

  // Collapse previously expanded card
  if (_expandedPOCardId) {
    var prevBody = document.getElementById('poCardBody_' + _expandedPOCardId);
    if (prevBody) prevBody.style.display = 'none';
  }

  if (wasExpanded) {
    _expandedPOCardId = null;
    return;
  }

  // Expand new card
  _expandedPOCardId = poId;
  var body = document.getElementById('poCardBody_' + poId);
  if (body) {
    body.style.display = 'block';
    // Load email thread
    loadPOEmails(poId).then(function(emails) {
      var threadEl = document.getElementById('poCardThread_' + poId);
      if (threadEl) threadEl.innerHTML = renderPOEmailThread(emails, poId);
    });
  }
}

function renderInlineReplyBar(entityId, type, lastEmail) {
  var replyTo = '';
  var replySubject = '';
  var replyContext = '';
  if (lastEmail) {
    var isInbound = lastEmail.direction === 'inbound' || lastEmail.direction === 'received';
    replyTo = isInbound ? (lastEmail.from_email || '') : (lastEmail.to_email || '');
    replySubject = 'Re: ' + (lastEmail.subject || '');
    replyContext = lastEmail.subject || '';
  }
  // Try to get supplier email from PO data if no reply-to from emails
  if (!replyTo && type === 'po' && _allPOs) {
    var rPo = _allPOs.find(function(p) { return p.id === entityId; });
    if (rPo && rPo.supplier_name && _suppliers) {
      var rSup = _suppliers.find(function(s) { return s.name === rPo.supplier_name; });
      if (rSup && rSup.email) replyTo = rSup.email;
    }
    if (rPo && !replySubject) {
      replySubject = (rPo.po_number || '') + ' — ' + (rPo.supplier_name || '') + ' — SecureWorks Group';
    }
  }
  var placeholder = replyTo ? 'Reply to ' + replyTo + '...' : 'Type a message...';
  var barId = 'replyBar_' + type + '_' + entityId;

  var html = '<div id="' + barId + '" style="margin-top:8px;">';
  // Reply context
  if (replyContext) {
    html += '<div style="font-size:10px;color:var(--sw-text-sec);margin-bottom:4px;">Replying to: ' + escapeHtml(replyContext.length > 60 ? replyContext.substring(0, 60) + '...' : replyContext) + '</div>';
  }
  html += '<div style="display:flex;gap:6px;align-items:flex-end;">';
  html += '<textarea id="replyText_' + type + '_' + entityId + '" placeholder="' + escapeHtml(placeholder) + '" rows="1" style="flex:1;padding:8px 10px;border:1px solid var(--sw-border);border-radius:6px;font-size:12px;font-family:inherit;resize:none;min-height:36px;" onfocus="this.rows=3" onblur="if(!this.value)this.rows=1"></textarea>';
  html += '<button class="btn btn-sm btn-primary" style="font-size:11px;white-space:nowrap;height:36px;" onclick="sendInlineReply(\'' + entityId + '\',\'' + type + '\',\'' + escapeHtml(replyTo).replace(/'/g, "\\'") + '\',\'' + escapeHtml(replySubject).replace(/'/g, "\\'") + '\')">Send &#8599;</button>';
  html += '<button class="btn btn-sm btn-secondary" style="font-size:11px;white-space:nowrap;height:36px;" onclick="openPOEmailCompose(\'' + entityId + '\')">Full</button>';
  html += '</div></div>';
  return html;
}

async function sendInlineReply(entityId, type, toEmail, subject) {
  var textEl = document.getElementById('replyText_' + type + '_' + entityId);
  if (!textEl) return;
  var body = textEl.value.trim();
  if (!body) { showToast('Type a message first', 'warning'); return; }
  if (!toEmail) {
    toEmail = prompt('Enter recipient email:');
    if (!toEmail) return;
  }

  // Optimistic UI — show message immediately
  var threadEl = document.getElementById('poCardThread_' + entityId);
  if (threadEl) {
    var tempHtml = '<div style="padding:8px 12px;margin-bottom:6px;border-left:3px solid var(--sw-orange);background:rgba(241,90,41,0.04);border-radius:0 6px 6px 0;opacity:0.7;">';
    tempHtml += '<div style="font-size:11px;color:var(--sw-text-sec);">&#8599; Sending to ' + escapeHtml(toEmail) + '...</div>';
    tempHtml += '<div style="font-size:12px;margin-top:4px;white-space:pre-wrap;">' + escapeHtml(body) + '</div>';
    tempHtml += '</div>';
    threadEl.innerHTML += tempHtml;
  }
  textEl.value = '';
  textEl.rows = 1;

  try {
    if (type === 'council') {
      // Council email — need submission_id + step_index from context
      // For now, use the compose modal for council (full inline in Phase 3)
      await opsPost('send_council_email', {
        submission_id: entityId,
        to_email: toEmail,
        subject: subject || 'Council Application — SecureWorks Group',
        body_text: body,
      });
    } else {
      // PO email
      await fetch(window.SUPABASE_URL + '/functions/v1/send-po-email', {
        method: 'POST',
        headers: await _getAuthHeaders(),
        body: JSON.stringify({
          po_id: entityId,
          to_email: toEmail,
          subject: subject || 'SecureWorks Group',
          body_text: body,
          body_html: '<pre style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">' + body.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>',
        })
      }).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function(d) { if (d.error) throw new Error(d.error); });
    }

    showToast('Email sent', 'success');
    // Refresh thread
    if (_poEmailCache[entityId]) delete _poEmailCache[entityId];
    loadPOEmails(entityId).then(function(emails) {
      if (threadEl) threadEl.innerHTML = renderPOEmailThread(emails, entityId);
    });
  } catch (e) {
    showToast('Failed to send: ' + e.message, 'warning');
    // Update optimistic UI to show error
    if (threadEl) {
      var lastChild = threadEl.lastElementChild;
      if (lastChild && lastChild.style.opacity === '0.7') {
        lastChild.style.borderLeftColor = 'var(--sw-red)';
        lastChild.querySelector('div').innerHTML = '&#10007; Failed to send — <a href="#" onclick="event.preventDefault();sendInlineReply(\'' + entityId + '\',\'' + type + '\',\'' + toEmail + '\',\'' + subject + '\')">Retry</a>';
      }
    }
  }
}

// ════════════════════════════════════════════════════════════
// PO EMAIL COMPOSE + THREAD
// ════════════════════════════════════════════════════════════

var _poEmailCache = {};
var _poComposeData = null; // temp PO data for template replacements

var _poEmailTemplates = {
  new_order: 'Hi {supplier_name},\n\nPlease find attached PO {po_number} for job {job_number} at {site_address}.\n\nDelivery required by: {delivery_date}\n\n{line_items_summary}\n\nPlease confirm receipt and expected delivery date.\n\nThanks,\nSecureWorks Group',
  delivery_change: 'Hi {supplier_name},\n\nRegarding PO {po_number} for job {job_number} — we need to change the delivery details.\n\nNew delivery date: {delivery_date}\nDelivery address: {site_address}\n\nPlease confirm this change.\n\nThanks,\nSecureWorks Group',
  order_query: 'Hi {supplier_name},\n\nJust following up on PO {po_number} for job {job_number}.\n\nCould you please provide an update on the order status and expected delivery?\n\nThanks,\nSecureWorks Group',
  cancellation: 'Hi {supplier_name},\n\nPlease cancel PO {po_number} for job {job_number}.\n\nPlease confirm cancellation at your earliest convenience.\n\nThanks,\nSecureWorks Group',
  custom: ''
};

function openPOEmailCompose(poId) {
  // Reset preview/form toggle (always start on compose form)
  var formView = document.getElementById('poComposeFormView');
  var previewView = document.getElementById('poComposePreviewView');
  if (formView) formView.style.display = '';
  if (previewView) previewView.style.display = 'none';

  if (!poId) { showToast('No PO selected', 'warning'); return; }

  var po = _allPOs.find(function(p) { return p.id === poId; });
  if (!po) { showToast('PO not found', 'warning'); return; }

  // Find supplier email — prompt to add one if missing
  var supplierEmail = '';
  if (_suppliers && _suppliers.length > 0) {
    var sup = _suppliers.find(function(s) { return s.name === po.supplier_name; });
    if (sup && sup.email) {
      supplierEmail = sup.email;
    } else if (po.supplier_name) {
      var entered = prompt('No email on file for ' + po.supplier_name + '. Enter their email:');
      if (entered && entered.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        supplierEmail = entered;
        // Save it for next time
        opsPost('update_supplier_email', { supplier_name: po.supplier_name, email: entered }).then(function() {
          if (sup) sup.email = entered;
        }).catch(function() {});
      } else if (entered) {
        showToast('Invalid email address', 'warning');
      }
    }
  }

  // Build line items summary for email template
  var lineItemsSummary = '';
  var lineItems = po.line_items || po.items || [];
  if (Array.isArray(lineItems) && lineItems.length > 0) {
    lineItemsSummary = lineItems.map(function(li) {
      var desc = li.description || li.item || '';
      var qty = li.quantity || li.qty || '';
      return qty ? '- ' + desc + ' (x' + qty + ')' : '- ' + desc;
    }).join('\n');
  }

  // Resolve job address from current job data or PO
  var jobAddress = po.delivery_address || '';
  if (!jobAddress && _currentJobData && _currentJobData.job) {
    var addr = _currentJobData.job.site_address || '';
    var suburb = _currentJobData.job.site_suburb || '';
    // Avoid duplicating suburb if it's already in the address string
    if (suburb && addr && addr.toLowerCase().indexOf(suburb.toLowerCase()) >= 0) {
      jobAddress = addr;
    } else {
      jobAddress = [addr, suburb].filter(Boolean).join(', ');
    }
  }

  // Store PO data for template replacements
  _poComposeData = {
    po_number: po.po_number || '',
    job_number: po.job_number || '',
    site_address: jobAddress,
    delivery_date: po.delivery_date ? new Date(po.delivery_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'TBC',
    supplier_name: po.supplier_name || '',
    job_id: po.job_id || '',
    po_id: po.id,
    line_items_summary: lineItemsSummary
  };

  document.getElementById('poComposeTitle').textContent = 'Email Supplier \u2014 ' + (po.po_number || 'PO');
  document.getElementById('poComposeTo').value = supplierEmail;
  var subjectPO = (po.po_number || '');
  if (subjectPO && !subjectPO.toUpperCase().startsWith('PO')) subjectPO = 'PO ' + subjectPO;
  var subjectDesc = [po.description || lineItems.map(function(li) { return li.description || ''; }).filter(Boolean).join(', ').slice(0, 40), po.job_number || ''].filter(Boolean).join(' \u2014 ');
  document.getElementById('poComposeSubject').value = subjectPO + (subjectDesc ? ' \u2014 ' + subjectDesc : '') + ' \u2014 SecureWorks Group';
  document.getElementById('poComposePoId').value = po.id;
  document.getElementById('poComposeJobId').value = po.job_id || '';
  document.getElementById('poComposeTemplate').value = 'new_order';
  document.getElementById('poComposeAttachPDF').checked = true;
  document.getElementById('poComposeFiles').value = '';
  document.getElementById('poComposeFileList').textContent = '';
  var ccEl = document.getElementById('poComposeCc');
  if (ccEl) {
    var jobType = (po.job_type || po.type || '').toLowerCase();
    var ccDefault = (jobType === 'fencing') ? 'fencing@secureworkswa.com.au' : 'patios@secureworkswa.com.au';
    ccEl.value = ccDefault + ', admin@secureworkswa.com.au';
  }
  window._councilComposeContext = null; // Clear council context for PO sends

  applyPOEmailTemplate('new_order');
  document.getElementById('poEmailComposeModal').classList.add('active');
}

function applyPOEmailTemplate(templateKey) {
  var body = _poEmailTemplates[templateKey] || '';
  if (_poComposeData && body) {
    Object.keys(_poComposeData).forEach(function(k) {
      body = body.replace(new RegExp('\\{' + k + '\\}', 'g'), _poComposeData[k]);
    });
  }
  document.getElementById('poComposeBody').value = body;

  // Attach PDF checkbox: checked for new_order only
  var attachPDF = document.getElementById('poComposeAttachPDF');
  if (attachPDF) attachPDF.checked = (templateKey === 'new_order');
}

function updatePOComposeFileList() {
  var input = document.getElementById('poComposeFiles');
  var list = document.getElementById('poComposeFileList');
  if (!input || !list) return;
  if (input.files.length === 0) { list.textContent = ''; return; }
  var names = [];
  for (var i = 0; i < input.files.length; i++) names.push(input.files[i].name);
  list.textContent = names.join(', ');
}

// ── Email Preview Step ──
window.previewPOEmail = function() {
  var to = (document.getElementById('poComposeTo').value || '').trim();
  var subject = (document.getElementById('poComposeSubject').value || '').trim();
  var body = (document.getElementById('poComposeBody').value || '').trim();
  var attachPDF = document.getElementById('poComposeAttachPDF').checked;
  var poId = document.getElementById('poComposePoId').value;

  // Validate
  if (!to) { showToast('Recipient email is required', 'warning'); return; }
  if (!to.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) { showToast('Invalid email address', 'warning'); return; }
  if (!subject) { showToast('Subject is required', 'warning'); return; }
  if (!body) { showToast('Email body is required', 'warning'); return; }

  // Build preview
  var fromAddr = 'orders@secureworksgroup.app';
  var html = '';
  html += '<div style="border:1px solid var(--sw-border);border-radius:8px;overflow:hidden;margin-bottom:12px">';

  // Header
  html += '<div style="background:#293C46;padding:14px 16px;color:#fff">';
  html += '<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:2px">From: ' + escapeHtml(fromAddr) + '</div>';
  html += '<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:6px">To: ' + escapeHtml(to) + '</div>';
  html += '<div style="font-size:14px;font-weight:700">' + escapeHtml(subject) + '</div>';
  html += '</div>';

  // Body
  html += '<div style="padding:16px;background:#fff;font-size:13px;line-height:1.6;white-space:pre-wrap;font-family:Helvetica,Arial,sans-serif;min-height:100px;max-height:250px;overflow-y:auto">';
  html += escapeHtml(body);
  html += '</div>';

  // Attachments
  var atts = [];
  if (attachPDF && poId) atts.push('PO PDF (auto-generated)');
  var files = document.getElementById('poComposeFiles');
  if (files && files.files) {
    for (var i = 0; i < files.files.length; i++) atts.push(files.files[i].name);
  }
  if (atts.length > 0) {
    html += '<div style="padding:10px 16px;background:var(--sw-light);border-top:1px solid var(--sw-border);font-size:12px">';
    html += '<strong>Attachments:</strong><br>';
    atts.forEach(function(a) { html += '<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 0">&#128206; ' + escapeHtml(a) + '</span><br>'; });
    html += '</div>';
  }

  // Footer
  html += '<div style="padding:10px 16px;background:#f5f5f7;border-top:1px solid var(--sw-border);font-size:10px;color:#999">';
  html += 'SecureWorks Group Pty Ltd | ABN 64 689 223 416';
  html += '</div>';
  html += '</div>';

  html += '<div style="font-size:11px;color:var(--sw-text-sec);text-align:center;margin-top:4px">This is how the recipient will see your email</div>';

  document.getElementById('poPreviewContent').innerHTML = html;
  document.getElementById('poComposeFormView').style.display = 'none';
  document.getElementById('poComposePreviewView').style.display = '';
};

window.backFromPOPreview = function() {
  document.getElementById('poComposePreviewView').style.display = 'none';
  document.getElementById('poComposeFormView').style.display = '';
};

async function sendPOEmail() {
  var to = (document.getElementById('poComposeTo').value || '').trim();
  var ccRaw = (document.getElementById('poComposeCc') ? document.getElementById('poComposeCc').value : '').trim();
  var ccList = ccRaw ? ccRaw.split(',').map(function(e) { return e.trim(); }).filter(function(e) { return e.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/); }) : [];
  var subject = (document.getElementById('poComposeSubject').value || '').trim();
  var body = (document.getElementById('poComposeBody').value || '').trim();
  var attachPDF = document.getElementById('poComposeAttachPDF').checked;
  var poId = document.getElementById('poComposePoId').value;
  var jobId = document.getElementById('poComposeJobId').value;
  var supplierName = _poComposeData ? _poComposeData.supplier_name : '';

  // Validation
  if (!to) { showToast('Recipient email is required', 'warning'); return; }
  if (!to.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) { showToast('Invalid email address', 'warning'); return; }
  if (!subject) { showToast('Subject is required', 'warning'); return; }
  if (!body) { showToast('Email body is required', 'warning'); return; }

  // Try to save supplier email if it was manually entered
  if (supplierName && to) {
    var existingSup = _suppliers.find(function(s) { return s.name === supplierName; });
    if (!existingSup || !existingSup.email || existingSup.email !== to) {
      try {
        await opsPost('update_supplier_email', { supplier_name: supplierName, email: to });
        // Update local cache
        if (existingSup) { existingSup.email = to; }
      } catch (e) {
        // Silently fail — endpoint may not exist yet
      }
    }
  }

  // Generate + upload PO PDF if requested
  var pdfUrl = null;
  if (attachPDF && poId) {
    try {
      showToast('Generating PO PDF...', 'info');
      var pdfDataUri = await generatePOPDF(poId);
      if (pdfDataUri) {
        pdfUrl = await uploadPOPDF(poId, pdfDataUri);
        if (pdfUrl) console.log('[PO PDF] Uploaded:', pdfUrl);
      }
    } catch (e) {
      console.log('[PO PDF] Generation failed (non-blocking):', e.message);
    }
  }

  // Council email routing — use send_council_email if council context is set
  var councilCtx = window._councilComposeContext || null;
  window._councilComposeContext = null; // Clear after reading

  try {
    var resp;
    if (councilCtx && councilCtx.submission_id) {
      // Route through council email endpoint
      var councilPayload = {
        submission_id: councilCtx.submission_id,
        step_index: councilCtx.step_index,
        to_email: to,
        subject: subject,
        body_text: body,
        body_html: '<pre style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">' + body.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre>',
      };
      if (ccList.length > 0) councilPayload.cc = ccList;
      resp = await opsPost('send_council_email', councilPayload);
      showToast('Council email sent to ' + to, 'success');
      closeModal('poEmailComposeModal');
      if (typeof loadApprovals === 'function') loadApprovals();
      return;
    }

    resp = await fetch(window.SUPABASE_URL + '/functions/v1/send-po-email', {
      method: 'POST',
      headers: await _getAuthHeaders(),
      body: JSON.stringify({
        po_id: poId,
        to_email: to,
        cc: ccList.length > 0 ? ccList : undefined,
        subject: subject,
        body_text: body,
        body_html: '<pre style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">' + body.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre>',
        attach_po_pdf: attachPDF,
        pdf_url: pdfUrl
      })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var result = await resp.json();
    if (result.error) throw new Error(result.error);

    showToast('Email sent to ' + (supplierName || to), 'success');
    closeModal('poEmailComposeModal');

    // Update PO status to 'submitted' (sent)
    try {
      await opsPost('update_po', { id: poId, status: 'submitted' });
    } catch (e3) { /* status update non-critical */ }

    // Log the sent email as an event too
    try {
      await opsPost('add_po_event', {
        po_id: poId,
        job_id: jobId || null,
        event_type: 'po_email_log',
        supplier: supplierName,
        summary: 'Subject: ' + subject + '\n\n' + body,
        direction: 'sent',
      });
    } catch (e2) { /* event logging is secondary */ }

    // Refresh thread if visible
    if (_poEmailCache[poId]) delete _poEmailCache[poId];
    var threadEl = document.getElementById('poThread_' + poId);
    if (threadEl && threadEl.style.display !== 'none') {
      loadPOEmails(poId).then(function(emails) {
        threadEl.innerHTML = renderPOEmailThread(emails, poId);
      });
    }
    if (_currentJobId) openJobDetail(_currentJobId);
    return;
  } catch (e) {
    // Edge function not deployed — fall back to logging
    console.log('send-po-email not available, falling back to log:', e.message);
  }

  // Fallback: log the email
  try {
    await opsPost('add_po_event', {
      po_id: poId,
      job_id: jobId || null,
      event_type: 'po_email_log',
      supplier: supplierName,
      summary: 'Email composed (to: ' + to + ')\nSubject: ' + subject + '\n\n' + body,
      direction: 'sent',
    });
    showToast('Email logged (send-po-email not deployed yet \u2014 email saved as log)', 'warning');
    closeModal('poEmailComposeModal');
    if (_poEmailCache[poId]) delete _poEmailCache[poId];
    if (_currentJobId) openJobDetail(_currentJobId);
  } catch (e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

// ── PO Email Thread Loading & Rendering ──

async function loadPOEmails(poId, jobId) {
  if (_poEmailCache[poId]) return _poEmailCache[poId];
  try {
    // Use list_po_communications with both po_id and job_id for robust matching
    var params = { po_id: poId };
    if (jobId) params.job_id = jobId;
    var data = await opsFetch('list_po_communications', params);
    var emails = data.emails || data || [];
    if (!Array.isArray(emails)) emails = [];
    _poEmailCache[poId] = emails;
    return emails;
  } catch (e) {
    try {
      var data2 = await opsFetch('list_po_communications', { po_id: poId });
      var emails2 = data2.emails || data2 || [];
      if (!Array.isArray(emails2)) emails2 = [];
      _poEmailCache[poId] = emails2;
      return emails2;
    } catch (e2) {
      _poEmailCache[poId] = [];
      return [];
    }
  }
}

// Relative timestamp helper
function relativeTime(dateStr) {
  if (!dateStr) return '';
  var now = Date.now();
  var then = new Date(dateStr).getTime();
  var diffMs = now - then;
  var mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  var days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd';
  var weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks + 'w';
  return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// Extract short name from email (user part or first word)
function shortName(email) {
  if (!email) return '';
  var local = email.split('@')[0] || '';
  if (local.length > 15) return local.substring(0, 15) + '...';
  return local;
}

function renderPOEmailThread(emails, poId) {
  if (!emails || emails.length === 0) return '<div style="font-size:11px;color:var(--sw-text-sec);padding:6px 0;">No emails yet.</div>';
  var html = '';
  emails.sort(function(a, b) { return (a.created_at || '') < (b.created_at || '') ? -1 : 1; });

  // Thread header — subject shown ONCE
  var threadSubj = emails[0].subject || '';
  html += '<div class="po-thread-header">';
  html += '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">&#128233; ' + escapeHtml(threadSubj.length > 45 ? threadSubj.substring(0, 45) + '...' : threadSubj) + '</span>';
  html += '<span class="po-thread-count">' + emails.length + '</span>';
  html += '</div>';

  // "Show older" — default shows last 2, older are hidden
  var visibleCount = 2;
  var hiddenCount = Math.max(0, emails.length - visibleCount);
  var threadId = 'poThread_' + poId;

  if (hiddenCount > 0) {
    html += '<div class="po-thread-show-older" onclick="document.getElementById(\'' + threadId + '_older\').style.display=\'block\';this.style.display=\'none\';">&#9654; Show ' + hiddenCount + ' older message' + (hiddenCount > 1 ? 's' : '') + '</div>';
    html += '<div id="' + threadId + '_older" style="display:none;">';
  }

  emails.forEach(function(em, idx) {
    var isInbound = em.direction === 'inbound' || em.direction === 'received';
    var ts = em.created_at || em.sent_at || em.received_at || '';
    var bodyText = em.body_text || em.body || '';
    var preview = bodyText.replace(/\n/g, ' ').substring(0, 40);
    if (bodyText.length > 40) preview += '...';
    var who = isInbound ? shortName(em.from_email) : shortName(em.to_email);
    var arrow = isInbound ? '<span style="color:var(--sw-blue,#3498DB)">&#8601;</span>' : '<span style="color:var(--sw-orange)">&#8599;</span>';
    var atts = em.attachments_json || em.attachments || [];
    var hasAtts = Array.isArray(atts) && atts.length > 0;
    var isUnread = isInbound && !em.read_at;
    var rowId = 'emRow_' + poId + '_' + idx;

    // Auto-mark as read
    if (isUnread && em.id) {
      opsPost('mark_email_read', { email_id: em.id }).catch(function() {});
      em.read_at = new Date().toISOString();
    }

    // Close the "older" wrapper before the visible messages start
    if (hiddenCount > 0 && idx === hiddenCount) {
      html += '</div>'; // close #older
    }

    // Compact row
    html += '<div class="po-email-row' + (isInbound ? ' inbound' : '') + '" onclick="toggleEmailExpand(\'' + rowId + '\')">';
    if (isUnread) html += '<span class="em-dot"></span>';
    html += '<span class="em-icon">' + arrow + '</span>';
    html += '<span class="em-who">' + escapeHtml(who) + '</span>';
    html += '<span class="em-time">' + relativeTime(ts) + '</span>';
    html += '<span class="em-preview">' + escapeHtml(preview) + '</span>';
    if (hasAtts) html += '<span class="em-clip">&#128206;</span>';
    // Delivery status dot for sent emails
    var ds = em.delivery_status || '';
    if (!isInbound && ds) {
      var dc = ds === 'opened' ? 'var(--sw-green)' : ds === 'delivered' ? 'var(--sw-blue,#3498DB)' : ds === 'bounced' ? 'var(--sw-red)' : '#999';
      html += '<span style="width:6px;height:6px;border-radius:50%;background:' + dc + ';flex-shrink:0;" title="' + escapeHtml(ds) + '"></span>';
    }
    html += '</div>';

    // Expanded detail (hidden by default)
    html += '<div id="' + rowId + '" class="po-email-expanded ' + (isInbound ? 'inbound' : 'outbound') + '" style="display:none;">';
    html += '<div class="em-meta">';
    html += arrow + ' ' + (isInbound ? escapeHtml(em.from_email || '') : escapeHtml(em.to_email || ''));
    html += ' &middot; ' + (ts ? new Date(ts).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
    if (ds) html += ' &middot; ' + escapeHtml(ds);
    html += '</div>';
    // AI classification + extracted metadata
    if (em.ai_classification || em.quote_version) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin:4px 0;">';
      if (em.ai_classification) {
        var clsColors = { confirmation: 'var(--sw-green)', quote: '#8B5CF6', invoice: '#D97706', question: 'var(--sw-blue,#3498DB)', issue: 'var(--sw-red)', delivery_update: '#06B6D4' };
        var clsC = clsColors[em.ai_classification] || '#999';
        html += '<span style="font-size:9px;padding:1px 6px;border-radius:3px;background:' + clsC + '18;color:' + clsC + ';font-weight:600;text-transform:uppercase;">' + escapeHtml(em.ai_classification) + '</span>';
        if (em.ai_confidence) html += '<span style="font-size:9px;color:var(--sw-text-sec);">' + Math.round(em.ai_confidence * 100) + '% conf</span>';
      }
      if (em.quote_version) html += '<span style="font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(139,92,246,0.1);color:#8B5CF6;font-weight:600;">Quote v' + em.quote_version + '</span>';
      html += '</div>';
    }
    html += '<div class="em-body">' + escapeHtml(bodyText) + '</div>';
    // Attachments
    if (hasAtts) {
      html += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">';
      atts.forEach(function(att) {
        var name = att.filename || att.name || 'Document';
        var url = att.storage_url || att.url || '';
        html += '<a href="' + escapeHtml(url) + '" target="_blank" style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;background:var(--sw-card);border:1px solid var(--sw-border);border-radius:3px;font-size:10px;color:var(--sw-mid);text-decoration:none;font-weight:600;">&#128206; ' + escapeHtml(name) + '</a>';
      });
      html += '</div>';
    }
    if (isInbound) {
      var subj = em.subject || '';
      html += '<button class="po-email-reply-btn" onclick="event.stopPropagation();openPOEmailComposeReply(\'' + poId + '\',\'' + escapeHtml(subj).replace(/'/g, "\\'") + '\')">Reply</button>';
    }
    html += '</div>';
  });

  return html;
}

// Toggle email expand — only one open at a time per thread
var _expandedEmailRowId = null;
function toggleEmailExpand(rowId) {
  if (_expandedEmailRowId && _expandedEmailRowId !== rowId) {
    var prev = document.getElementById(_expandedEmailRowId);
    if (prev) prev.style.display = 'none';
  }
  var el = document.getElementById(rowId);
  if (!el) return;
  if (el.style.display === 'none') {
    el.style.display = 'block';
    _expandedEmailRowId = rowId;
  } else {
    el.style.display = 'none';
    _expandedEmailRowId = null;
  }
}

function openPOEmailComposeReply(poId, originalSubject) {
  openPOEmailCompose(poId);
  // After opening, set subject to Re: ...
  setTimeout(function() {
    var subjectEl = document.getElementById('poComposeSubject');
    if (subjectEl && originalSubject) {
      var reSubject = originalSubject.indexOf('Re:') === 0 ? originalSubject : 'Re: ' + originalSubject;
      subjectEl.value = reSubject;
    }
    document.getElementById('poComposeTemplate').value = 'custom';
    document.getElementById('poComposeBody').value = '';
    document.getElementById('poComposeAttachPDF').checked = false;
  }, 50);
}

function togglePOEmailThread(poId, toggleEl) {
  var threadEl = document.getElementById('poThread_' + poId);
  if (!threadEl) return;

  if (threadEl.style.display === 'none') {
    threadEl.style.display = 'block';
    threadEl.innerHTML = '<div style="font-size:11px;color:var(--sw-text-sec);padding:4px 0;">Loading...</div>';
    loadPOEmails(poId).then(function(emails) {
      threadEl.innerHTML = renderPOEmailThread(emails, poId);
      // Update count
      var countEl = document.getElementById('poEmailCount_' + poId);
      if (countEl) countEl.textContent = '(' + emails.length + ')';
    });
  } else {
    threadEl.style.display = 'none';
  }
}

// ── Automated Communications Timeline ──

var COMMS_TRIGGER_LABELS = {
  quote_sent: 'Quote sent',
  quote_accepted: 'Quote accepted',
  deposit_paid: 'Deposit paid',
  materials_ordered: 'Materials ordered',
  council_submitted: 'Council submitted',
  council_approved: 'Council approved',
  crew_scheduled: 'Crew scheduled',
  crew_arriving: 'Crew arriving',
  daily_progress: 'Daily progress',
  job_complete: 'Job complete',
  invoice_sent: 'Invoice sent',
  payment_received: 'Payment received',
  follow_up_30d: '30-day follow-up',
};

var COMMS_STATUS_ICONS = {
  sent: { icon: '&#10003;', color: 'var(--sw-mid)', label: 'Sent' },
  delivered: { icon: '&#10003;&#10003;', color: 'var(--sw-green)', label: 'Delivered' },
  opened: { icon: '&#128065;', color: 'var(--sw-green)', label: 'Opened' },
  bounced: { icon: '&#10007;', color: 'var(--sw-red)', label: 'Bounced' },
  failed: { icon: '&#10007;', color: 'var(--sw-red)', label: 'Failed' },
};

async function loadClientEmailThread(jobId) {
  var el = document.getElementById('commsClientEmailThread');
  if (!el) return;
  try {
    var resp = await opsFetch('list_job_communications', { job_id: jobId });
    var emails = resp.emails || [];
    if (emails.length === 0) {
      el.innerHTML = '<div style="font-size:12px;color:var(--sw-text-sec);padding:8px 0;font-style:italic;">No client emails sent yet.</div>';
      return;
    }
    el.innerHTML = renderPOEmailThread(emails, jobId);
  } catch (e) {
    el.innerHTML = '<div style="font-size:11px;color:var(--sw-text-sec);padding:8px 0;">Could not load client emails.</div>';
  }
}

async function loadAutoCommsTimeline(jobId) {
  var el = document.getElementById('commsAutoTimeline');
  if (!el) return;
  try {
    var resp = await opsFetch('list_email_events', { job_id: jobId, limit: 50 });
    var events = resp.events || resp.email_events || resp || [];
    if (!Array.isArray(events)) events = [];
    if (events.length === 0) {
      el.innerHTML = '<div style="font-size:12px;color:var(--sw-text-sec);padding:8px 0;font-style:italic;">No automated communications sent yet.</div>';
      return;
    }
    // Sort by created_at
    events.sort(function(a, b) { return new Date(a.created_at) - new Date(b.created_at); });
    var html = '';
    events.forEach(function(ev) {
      var trigger = ev.comms_trigger || ev.event_type || '';
      var label = COMMS_TRIGGER_LABELS[trigger] || trigger.replace(/_/g, ' ');
      var channel = ev.comms_channel || ev.channel || 'email';
      var channelBadge = channel === 'sms' ? '<span style="background:#e3f2fd;color:#1565c0;padding:1px 5px;border-radius:2px;font-size:10px;font-weight:600;">SMS</span>' :
                         '<span style="background:#fce4ec;color:#c62828;padding:1px 5px;border-radius:2px;font-size:10px;font-weight:600;">Email</span>';
      var status = ev.status || ev.delivery_status || 'sent';
      var statusInfo = COMMS_STATUS_ICONS[status] || COMMS_STATUS_ICONS.sent;
      var openCount = ev.open_count || ev.metadata?.open_count || 0;
      var openText = openCount > 0 ? ' &middot; Opened ' + openCount + ' time' + (openCount > 1 ? 's' : '') : '';
      var date = ev.created_at ? fmtDate(ev.created_at) : '';

      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--sw-border);font-size:12px;">';
      html += '<span style="color:' + statusInfo.color + ';font-size:14px;min-width:18px;">' + statusInfo.icon + '</span>';
      html += '<span style="min-width:60px;color:var(--sw-text-sec);font-size:11px;">' + date + '</span>';
      html += '<span style="flex:1;font-weight:600;color:var(--sw-dark);">' + escapeHtml(label) + '</span>';
      html += channelBadge;
      html += '<span style="font-size:11px;color:' + statusInfo.color + ';">' + statusInfo.label + openText + '</span>';
      html += '</div>';
    });
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div style="font-size:11px;color:var(--sw-text-sec);padding:8px 0;">Could not load automated comms.</div>';
  }
}

// ══════════════════════════════════════════════════════
// EMAIL INBOX — aggregated view of all supplier + council emails
// ══════════════════════════════════════════════════════

window.loadEmailInbox = async function(filter, btnEl) {
  // Update active chip
  if (btnEl) {
    var chips = btnEl.parentElement.querySelectorAll('.inbox-chip');
    chips.forEach(function(c) { c.classList.remove('active'); });
    btnEl.classList.add('active');
  }

  var el = document.getElementById('emailInboxList');
  if (!el) return;
  el.innerHTML = '<div style="font-size:13px;color:var(--sw-text-sec);padding:12px;">Loading...</div>';

  try {
    var params = { limit: '30' };
    if (filter === 'unread') params.unread_only = 'true';
    if (filter === 'po') params.type = 'po';
    if (filter === 'council') params.type = 'council';

    var data = await opsFetch('get_inbox', params);
    var emails = data.emails || [];
    var unreadCount = data.unread_count || 0;

    // Update badges
    var badge = document.getElementById('emailUnreadCount');
    if (badge) badge.textContent = unreadCount > 0 ? '(' + unreadCount + ' unread)' : '';
    var navBadge = document.getElementById('inboxBadge');
    if (navBadge && unreadCount > 0) { navBadge.textContent = unreadCount; navBadge.style.display = ''; }
    var navBadgeMobile = document.getElementById('inboxBadgeMobile');
    if (navBadgeMobile && unreadCount > 0) { navBadgeMobile.textContent = unreadCount; navBadgeMobile.style.display = ''; }

    if (emails.length === 0) {
      el.innerHTML = '<div style="font-size:13px;color:var(--sw-text-sec);padding:20px;text-align:center;">No emails found.</div>';
      return;
    }

    var html = '';
    var currentDay = '';
    emails.forEach(function(em) {
      var dateStr = (em.created_at || '').slice(0, 10);
      var dayLabel = dateStr === new Date().toISOString().slice(0, 10) ? 'Today' : (dateStr === new Date(Date.now() - 86400000).toISOString().slice(0, 10) ? 'Yesterday' : dateStr);
      if (dayLabel !== currentDay) {
        currentDay = dayLabel;
        html += '<div style="font-size:11px;font-weight:700;color:var(--sw-text-sec);text-transform:uppercase;padding:8px 0 4px;border-bottom:1px solid var(--sw-border);margin-top:8px">' + dayLabel + '</div>';
      }

      var isInbound = em.direction === 'inbound' || em.direction === 'received';
      var isUnread = isInbound && !em.read_at;
      var arrow = isInbound ? '<span style="color:var(--sw-blue, #3498DB)">&#8601;</span>' : '<span style="color:var(--sw-orange)">&#8599;</span>';
      var dot = isUnread ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--sw-blue, #3498DB);margin-right:4px"></span>' : '';
      var time = em.created_at ? new Date(em.created_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '';
      var who = isInbound ? (em.from_email || '').split('@')[0] : 'You';
      var jobNum = em.jobs ? em.jobs.job_number : '';
      var subj = em.subject || '';
      var preview = (em.body_text || '').split('\n')[0] || '';
      if (preview.length > 80) preview = preview.substring(0, 80) + '...';

      var jobId = em.job_id || '';
      var commType = em.communication_type || 'purchase_order';
      html += '<div style="display:flex;gap:8px;padding:10px 0;border-bottom:1px solid var(--sw-border);cursor:pointer;' + (isUnread ? 'font-weight:600;' : '') + '" onclick="openJobDetailAndFocus(\'' + jobId + '\',\'' + (em.po_id || '') + '\',\'' + commType + '\')">';
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="display:flex;justify-content:space-between;font-size:12px">';
      html += '<span>' + dot + arrow + ' ' + escapeHtml(who) + (jobNum ? ' — ' + escapeHtml(jobNum) : '') + '</span>';
      html += '<span style="color:var(--sw-text-sec);font-size:11px">' + time + '</span>';
      html += '</div>';
      html += '<div style="font-size:12px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(subj) + '</div>';
      html += '<div style="font-size:11px;color:var(--sw-text-sec);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(preview) + '</div>';
      html += '</div>';
      html += '</div>';
    });

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div style="font-size:13px;color:var(--sw-red);padding:12px;">Error loading emails: ' + (e.message || e) + '</div>';
  }
};

// Navigate to job detail and focus on the PO/council email
window.openJobDetailAndFocus = function(jobId, poId, commType) {
  if (!jobId) return;
  if (typeof openJobDetail === 'function') {
    openJobDetail(jobId);
    setTimeout(function() {
      if (commType === 'council' || commType === 'engineering') {
        // Council email — switch to overview tab (where council section lives)
        if (typeof showJobSubView === 'function') showJobSubView('overview');
      } else if (poId) {
        // PO email — switch to build tab and auto-expand the PO
        if (typeof showJobSubView === 'function') showJobSubView('build');
        // Auto-expand the relevant PO card after render
        setTimeout(function() {
          if (typeof togglePOCardExpand === 'function') togglePOCardExpand(poId);
        }, 300);
      } else {
        if (typeof showJobSubView === 'function') showJobSubView('build');
      }
    }, 500);
  }
};
