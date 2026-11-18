// ════════════════════════════════════════════════════════════
// MATERIALS TAB
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// TRADE BILLS
// ════════════════════════════════════════════════════════════

async function loadTradeBills() {
  try {
    var data = await opsFetch('list_trade_invoices');
    renderTradeBillTable(data.invoices || []);
    renderTradeRatesPanel(data.rates || []);
  } catch (e) {
    console.error('loadTradeBills error:', e);
  }

  // Also load new-format trade invoices
  try {
    var newInvoices = await opsFetch('list_new_trade_invoices');
    var invoices = newInvoices.invoices || [];
    if (invoices.length > 0) {
      var newHtml = '<div style="margin-top:16px;"><div style="font-size:13px;font-weight:700;color:var(--sw-dark);margin-bottom:8px;">Weekly Trade Invoices</div>';
      newHtml += '<div class="data-table-wrap"><table class="data-table"><thead><tr>';
      newHtml += '<th>Trade</th><th>Week</th><th>Hours</th><th>Total</th><th>Status</th><th>Actions</th>';
      newHtml += '</tr></thead><tbody>';

      invoices.forEach(function(inv) {
        var statusColors = { pending_acknowledgment: '#F59E0B', acknowledged: '#22C55E', pushed_to_xero: '#3B82F6', paid: '#22C55E', queried: '#EF4444', pending_ops_review: '#F59E0B' };
        var statusColor = statusColors[inv.status] || '#999';
        newHtml += '<tr>';
        newHtml += '<td>' + escapeHtml(inv.user?.name || '') + '</td>';
        newHtml += '<td>' + fmtDate(inv.week_start) + '</td>';
        newHtml += '<td>' + inv.total_hours + 'h</td>';
        newHtml += '<td>' + fmt$(inv.total_inc) + '</td>';
        newHtml += '<td><span style="color:' + statusColor + ';font-weight:600;">' + (inv.status || '').replace(/_/g, ' ') + '</span>';
        if (inv.has_manual_overrides) newHtml += ' <span style="color:var(--sw-orange);font-size:10px;">⚠ override</span>';
        newHtml += '</td>';
        newHtml += '<td>';
        if (inv.status === 'acknowledged' && !inv.xero_bill_id) {
          newHtml += '<button class="btn btn-sm" style="font-size:11px;background:var(--sw-green);color:#fff;" onclick="pushTradeInvoiceToXero(\'' + inv.id + '\')">Push to Xero</button>';
        }
        if (inv.xero_bill_id) {
          newHtml += '<a href="https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=' + inv.xero_bill_id + '" target="_blank" style="font-size:11px;color:var(--sw-mid);">View in Xero ↗</a>';
        }
        newHtml += '</td></tr>';
      });

      newHtml += '</tbody></table></div></div>';
      document.getElementById('tradeBillTable').parentElement.parentElement.insertAdjacentHTML('afterend', newHtml);
    }
  } catch (e) { console.log('New trade invoices load failed:', e); }
}

async function pushTradeInvoiceToXero(invoiceId) {
  if (!confirm('Push this trade invoice to Xero as a draft bill?')) return;
  try {
    await opsPost('push_trade_invoice_to_xero', { invoice_id: invoiceId });
    showToast('Pushed to Xero', 'success');
    loadTradeBills();
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}

function renderTradeBillTable(invoices) {
  var tbody = document.getElementById('tradeBillTableBody');
  if (!invoices.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--sw-text-sec)">No trade bills submitted yet</td></tr>';
    return;
  }
  var html = '';
  invoices.forEach(function(inv) {
    var tradeName = inv.users?.name || '—';
    var we = inv.week_ending || '';
    // Calculate hours from line_items total
    var hours = 0;
    if (inv.line_items && Array.isArray(inv.line_items)) {
      inv.line_items.forEach(function(li) { hours += (li.hours || 0); });
    }
    var statusClass = inv.status === 'pushed' ? 'color:var(--sw-green)' : 'color:var(--sw-red)';
    var billLink = inv.xero_bill_number || '—';
    if (inv.xero_invoice_id) {
      billLink = '<a href="https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=' + inv.xero_invoice_id + '" target="_blank" style="color:var(--sw-blue);text-decoration:none">' + (inv.xero_bill_number || 'View') + ' &#8599;</a>';
    }
    html += '<tr>';
    html += '<td>' + tradeName + '</td>';
    html += '<td>' + we + '</td>';
    html += '<td>' + hours.toFixed(1) + '</td>';
    html += '<td>$' + Number(inv.total).toFixed(2) + '</td>';
    html += '<td>' + billLink + '</td>';
    html += '<td style="' + statusClass + ';font-weight:600;text-transform:capitalize">' + (inv.status || '') + '</td>';
    html += '</tr>';
  });
  tbody.innerHTML = html;
}

function renderTradeRatesPanel(rates) {
  var panel = document.getElementById('tradeRatesPanel');
  if (window.rateHistoryEnabled) return renderRatesWithSetter(panel, rates);
  if (!rates.length) {
    panel.innerHTML = '';
    return;
  }
  var html = '<div style="display:flex;gap:8px;flex-wrap:wrap">';
  rates.forEach(function(r) {
    var name = r.users?.name || 'Unknown';
    html += '<div style="background:var(--sw-card);padding:8px 12px;border-radius:8px;box-shadow:var(--sw-shadow);font-size:13px;cursor:pointer" onclick="openRateModal(\'' + r.user_id + '\',\'' + name.replace(/'/g, "\\'") + '\',' + r.hourly_rate + ')">';
    html += '<span style="font-weight:600">' + name + '</span>';
    html += ' <span style="color:var(--sw-green);font-weight:700">$' + Number(r.hourly_rate).toFixed(2) + '/hr</span>';
    html += '</div>';
  });
  html += '</div>';
  panel.innerHTML = html;
}

var _rateModalUserId = null;
var _rateModalName = '';

function openRateModal(userId, name, currentRate) {
  if (window.rateHistoryEnabled) resetRateHistory(userId);
  _rateModalUserId = userId;
  _rateModalName = name;
  document.getElementById('rateModalTitle').textContent = 'Set Rate — ' + name;
  document.getElementById('rateModalCurrent').textContent = '$' + Number(currentRate).toFixed(2) + '/hr';
  document.getElementById('rateModalInput').value = currentRate;
  document.getElementById('rateModal').classList.add('active');
  document.getElementById('rateModalInput').focus();
}

function submitRateModal() {
  var val = parseFloat(document.getElementById('rateModalInput').value);
  if (!val || val <= 0) return;
  opsPost('set_trade_rate_ops', { user_id: _rateModalUserId, hourly_rate: val }).then(function() {
    closeModal('rateModal');
    showToast('Rate updated for ' + _rateModalName + ' to $' + val.toFixed(2) + '/hr', 'success');
    loadTradeBills();
  }).catch(function(e) {
    showToast('Error: ' + e.message, 'warning');
  });
}

// ════════════════════════════════════════════════════════════
// MATERIALS TAB
// ════════════════════════════════════════════════════════════

var _matTypeFilter = 'all';
var _matSearch = '';
var _allPOs = [];

async function loadMaterials() {
  try {
    var data = await opsFetch('list_pos');
    _allPOs = data.purchase_orders || [];
    renderMaterialsKanban();
    loadPendingPrices();
  } catch (e) {
    console.error('loadMaterials error:', e);
  }
}

async function loadPendingPrices() {
  try {
    var data = await opsFetch('pending_prices');
    var prices = data.pending_prices || [];
    var panel = document.getElementById('pendingPricesPanel');
    var list = document.getElementById('pendingPricesList');
    var badge = document.getElementById('pendingPriceCount');

    if (prices.length === 0) {
      panel.style.display = 'none';
      return;
    }

    badge.textContent = prices.length;
    var html = '';
    prices.forEach(function(p) {
      html += '<div class="today-action-card action" id="price-' + p.id + '" style="margin-bottom:6px;">';
      html += '<div class="today-card-main">';
      html += '<div class="today-card-title">' + (p.supplier_name || '') + ' — ' + (p.item_description || '').substring(0, 60) + '</div>';
      html += '<div class="today-card-detail">' + (p.material_category || 'uncategorized') + (p.material_code ? ' · ' + p.material_code : '') + ' · ' + (p.unit || '') + '</div>';
      html += '<div class="today-card-meta">$' + Number(p.unit_price || 0).toFixed(2) + ' per ' + (p.unit || 'unit') + '</div>';
      html += '</div>';
      html += '<button class="today-card-btn green" onclick="confirmPriceItem(\'' + p.id + '\')">Confirm</button>';
      html += '<button class="today-card-btn outline" onclick="dismissPriceItem(\'' + p.id + '\')">Dismiss</button>';
      html += '</div>';
    });
    list.innerHTML = html;
    panel.style.display = 'block';
  } catch (e) {
    console.error('loadPendingPrices error:', e);
  }
}

function confirmPriceItem(id) {
  document.getElementById('price-' + id).style.opacity = '0.5';
  opsPost('confirm_price', { ledger_id: id }).then(function() {
    document.getElementById('price-' + id).style.display = 'none';
    showToast('Price confirmed', 'success');
  }).catch(function(e) {
    document.getElementById('price-' + id).style.opacity = '1';
    showToast('Failed to confirm: ' + e.message, 'error');
  });
}

function dismissPriceItem(id) {
  var reason = prompt('Reason for dismissal? (optional)');
  document.getElementById('price-' + id).style.opacity = '0.5';
  opsPost('dismiss_price', { ledger_id: id, reason: reason || '' }).then(function() {
    document.getElementById('price-' + id).style.display = 'none';
    showToast('Price dismissed', 'info');
  }).catch(function(e) {
    document.getElementById('price-' + id).style.opacity = '1';
  });
}

// ── Materials Advanced Filter State ──
var _matFilterJob = '';
var _matFilterSupplier = '';
var _matFilterStatuses = ['draft', 'approved', 'submitted', 'quote_requested', 'authorised', 'billed'];
var _matAlertWarnDays = parseInt(localStorage.getItem('sw_mat_warn_days')) || 7;
var _matAlertCritDays = parseInt(localStorage.getItem('sw_mat_crit_days')) || 14;

function filterMaterials(type) {
  _matTypeFilter = type;
  document.querySelectorAll('[data-mat-filter]').forEach(function(el) {
    el.classList.toggle('active', el.dataset.matFilter === type);
  });
  renderMaterialsKanban();
}

function searchMaterials(val) {
  _matSearch = (val || '').toLowerCase().trim();
  renderMaterialsKanban();
}

function toggleMatFilters() {
  var el = document.getElementById('matAdvFilters');
  var isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) populateMatFilterDropdowns();
}

function populateMatFilterDropdowns() {
  // Job dropdown
  var jobSel = document.getElementById('matFilterJob');
  var jobs = {};
  _allPOs.forEach(function(po) {
    if (po.job_id && po.job_number) {
      jobs[po.job_id] = (po.job_number || '') + ' — ' + (po.client_name || '');
    }
  });
  var jobHtml = '<option value="">All Jobs</option>';
  Object.keys(jobs).forEach(function(id) {
    jobHtml += '<option value="' + id + '"' + (_matFilterJob === id ? ' selected' : '') + '>' + escapeHtml(jobs[id]) + '</option>';
  });
  jobSel.innerHTML = jobHtml;

  // Supplier dropdown
  var supSel = document.getElementById('matFilterSupplier');
  var suppliers = {};
  _allPOs.forEach(function(po) { if (po.supplier_name) suppliers[po.supplier_name] = true; });
  var supHtml = '<option value="">All Suppliers</option>';
  Object.keys(suppliers).sort().forEach(function(s) {
    supHtml += '<option value="' + escapeHtml(s) + '"' + (_matFilterSupplier === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
  });
  supSel.innerHTML = supHtml;
}

function applyMatFilters() {
  _matFilterJob = document.getElementById('matFilterJob').value;
  _matFilterSupplier = document.getElementById('matFilterSupplier').value;
  _matFilterStatuses = [];
  document.querySelectorAll('.mat-status-cb:checked').forEach(function(cb) {
    _matFilterStatuses.push(cb.value);
  });
  updateMatFilterBadge();
  renderMaterialsKanban();
}

function clearMatFilters() {
  _matFilterJob = '';
  _matFilterSupplier = '';
  _matFilterStatuses = ['draft', 'approved', 'submitted', 'quote_requested', 'authorised', 'billed'];
  document.getElementById('matFilterJob').value = '';
  document.getElementById('matFilterSupplier').value = '';
  document.querySelectorAll('.mat-status-cb').forEach(function(cb) { cb.checked = true; });
  updateMatFilterBadge();
  renderMaterialsKanban();
}

function updateMatFilterBadge() {
  var count = 0;
  if (_matFilterJob) count++;
  if (_matFilterSupplier) count++;
  if (_matFilterStatuses.length < 6) count++;
  var badge = document.getElementById('matFilterBadge');
  badge.textContent = count > 0 ? '(' + count + ')' : '';
  badge.style.color = count > 0 ? 'var(--sw-orange)' : '';
}

// ── Threshold Alerts ──
function renderMatAlerts() {
  var el = document.getElementById('matAlerts');
  var now = Date.now();
  var alerts = [];

  _allPOs.forEach(function(po) {
    if (['draft', 'quote_requested', 'cancelled', 'deleted'].indexOf(po.status) >= 0) return;
    if (po.invoice_received_at || po.paid_at) return;
    var sinceDate = po.confirmed_at || po.ordered_at || po.created_at;
    if (!sinceDate) return;
    var days = Math.floor((now - new Date(sinceDate).getTime()) / 86400000);
    if (days >= _matAlertWarnDays) {
      alerts.push({ po: po, days: days, level: days >= _matAlertCritDays ? 'red' : 'amber' });
    }
  });

  if (alerts.length === 0) { el.innerHTML = ''; return; }

  var html = '';
  alerts.sort(function(a, b) { return b.days - a.days; });
  alerts.forEach(function(a) {
    var color = a.level === 'red' ? 'var(--sw-red)' : '#D97706';
    html += '<div class="attention-item" style="margin-bottom:4px; border-left:3px solid ' + color + ';">';
    html += '<span style="color:' + color + '; font-weight:600;">' + a.po.po_number + ' ' + escapeHtml(a.po.supplier_name || '') + '</span>';
    html += ' — awaiting invoice for <strong>' + a.days + ' days</strong>';
    if (a.po.job_number) html += ' <span style="color:var(--sw-text-sec);">(' + a.po.job_number + ')</span>';
    html += '<span style="margin-left:auto; display:flex; gap:4px;">';
    html += '<button onclick="event.stopPropagation();openPOEmailCompose(\'' + a.po.id + '\')" style="font-size:10px;padding:2px 6px;border:1px solid var(--sw-border);border-radius:3px;background:var(--sw-card);cursor:pointer;">Follow Up</button>';
    html += '<button onclick="event.stopPropagation();markPOInvoiceReceived(\'' + a.po.id + '\')" style="font-size:10px;padding:2px 6px;border:1px solid var(--sw-green);border-radius:3px;background:var(--sw-card);cursor:pointer;color:var(--sw-green);">Invoice Received</button>';
    html += '</span>';
    html += '</div>';
  });
  el.innerHTML = html;
}

function renderMaterialsKanban() {
  // Also render threshold alerts
  renderMatAlerts();

  var stages = [
    { key: 'draft', label: 'Draft', color: '#95A5A6' },
    { key: 'approved', label: 'Approved', color: '#2980B9' },
    { key: 'submitted', label: 'Sent', color: '#3498DB' },
    { key: 'quote_requested', label: 'Quoted', color: '#8E44AD' },
    { key: 'authorised', label: 'Confirmed', color: '#E67E22' },
    { key: 'billed', label: 'Delivered', color: '#27AE60' },
  ];

  // Apply type filter
  var filtered = _allPOs.filter(function(po) { return po.status !== 'cancelled' && po.status !== 'deleted'; });
  if (_matTypeFilter !== 'all') {
    filtered = filtered.filter(function(po) { return po.job_type === _matTypeFilter; });
  }

  // Apply search
  if (_matSearch) {
    filtered = filtered.filter(function(po) {
      return (po.supplier_name || '').toLowerCase().indexOf(_matSearch) !== -1 ||
        (po.job_number || '').toLowerCase().indexOf(_matSearch) !== -1 ||
        (po.client_name || '').toLowerCase().indexOf(_matSearch) !== -1 ||
        (po.po_number || '').toLowerCase().indexOf(_matSearch) !== -1;
    });
  }

  // Apply advanced filters
  if (_matFilterJob) {
    filtered = filtered.filter(function(po) { return po.job_id === _matFilterJob; });
  }
  if (_matFilterSupplier) {
    filtered = filtered.filter(function(po) { return po.supplier_name === _matFilterSupplier; });
  }
  if (_matFilterStatuses.length < 6) {
    filtered = filtered.filter(function(po) { return _matFilterStatuses.indexOf(po.status) >= 0; });
  }

  var container = document.getElementById('materialsKanban');
  var total = filtered.length;
  document.getElementById('materialsCount').textContent = total;

  var html = '';
  stages.forEach(function(stage) {
    var items = filtered.filter(function(po) { return po.status === stage.key; });
    html += '<div class="kanban-col" style="background:var(--sw-bg);">';
    html += '<div class="kanban-col-header" style="border-bottom-color:' + stage.color + ';">' +
      stage.label + '<span class="count">' + items.length + '</span></div>';
    html += '<div class="kanban-body">';

    items.forEach(function(po) {
      var daysInStage = po.updated_at ? Math.floor((Date.now() - new Date(po.updated_at).getTime()) / 86400000) : 0;
      var daysAge = po.created_at ? Math.floor((Date.now() - new Date(po.created_at).getTime()) / 86400000) : 0;
      var isStuck = stage.key === 'draft' && daysInStage >= 2;
      var deliverySoon = stage.key === 'submitted' && po.delivery_date &&
        (new Date(po.delivery_date).getTime() - Date.now()) <= 2 * 86400000 &&
        new Date(po.delivery_date).getTime() >= Date.now();

      // BUG 4: Job identification — always show number + client
      var jobRef = '';
      if (po.job_number || po.client_name) {
        var surname = (po.client_name || '').split(' ').pop();
        jobRef = (po.job_number || '') + (po.job_number && surname ? ' — ' + surname : surname || '');
      }

      html += '<div class="kanban-card" style="cursor:pointer; position:relative;' + (isStuck ? 'border-left:3px solid #E67E22;' : deliverySoon ? 'border-left:3px solid #E74C3C;' : '') + '" onclick="openPOEdit(\'' + po.id + '\')">';

      // BUG 2: Delete button (top-right)
      var canDelete = po.status === 'draft' || po.status === 'quote_requested';
      html += '<button onclick="event.stopPropagation();deletePO(\'' + po.id + '\',\'' + escapeHtml(po.po_number || '').replace(/'/g, "\\'") + '\',\'' + escapeHtml(po.supplier_name || '').replace(/'/g, "\\'") + '\',' + canDelete + ')" style="position:absolute;top:6px;right:6px;background:none;border:none;cursor:pointer;font-size:13px;color:var(--sw-text-sec);padding:2px;" title="Delete PO">&#128465;</button>';

      // Header: supplier + total
      html += '<div class="kanban-card-header" style="padding-right:24px;"><span class="kanban-client">' + (po.supplier_name || 'No supplier') + '</span>';
      html += '<span class="kanban-value">' + fmt$(po.total) + '</span></div>';

      // BUG 4: Job number + client name — formatted as "SWP-25019 — Smith"
      if (jobRef) {
        var typeBadgeCls = po.job_type || '';
        html += '<div style="font-size:12px; margin:4px 0 2px;">';
        html += '<span class="type-badge ' + typeBadgeCls + '" style="font-size:9px;padding:1px 5px;margin-right:3px;">' + typeBadgeLabel(typeBadgeCls) + '</span>';
        html += '<strong>' + escapeHtml(jobRef) + '</strong>';
        html += '</div>';
      }

      // PO number
      html += '<div class="kanban-suburb">' + po.po_number + '</div>';

      // Workflow step indicator
      var wfSteps = ['draft','approved','sent','quoted','confirmed','delivered'];
      var wfLabels = ['Draft','Approved','Sent','Quoted','Confirmed','Delivered'];
      var wfColors = ['#95A5A6','#2980B9','#3498DB','#8E44AD','#E67E22','#27AE60'];
      var wfMap = { draft:'draft', approved:'approved', submitted:'sent', quote_requested:'quoted', authorised:'confirmed', billed:'delivered' };
      var currentWf = wfMap[po.status] || 'draft';
      var currentIdx = wfSteps.indexOf(currentWf);
      html += '<div style="display:flex;gap:2px;align-items:center;margin:6px 0 4px;">';
      wfSteps.forEach(function(step, idx) {
        var active = idx <= currentIdx;
        var bg = active ? wfColors[idx] : '#E0E0E0';
        html += '<div title="' + wfLabels[idx] + '" style="flex:1;height:4px;border-radius:2px;background:' + bg + ';"></div>';
      });
      html += '</div>';
      html += '<div style="font-size:10px;color:' + wfColors[currentIdx] + ';font-weight:600;">' + wfLabels[currentIdx] + '</div>';

      // Delivery/pickup date
      if (po.delivery_date) {
        var dDate = new Date(po.delivery_date + 'T00:00:00');
        var dayLabel = dDate.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
        var urgencyStyle = deliverySoon ? 'color:#E74C3C; font-weight:600;' : 'color:var(--sw-text-sec);';
        html += '<div style="font-size:12px; margin-top:4px; ' + urgencyStyle + '">&#128666; ' + dayLabel + '</div>';
      }

      // FEATURE 6: PO age + invoice tracking
      // TODO: Add invoice_received_at, paid_at, xero_bill_id columns to purchase_orders table
      var invoiceStatus = '';
      if (po.paid_at) {
        invoiceStatus = '<span style="color:var(--sw-green);font-size:11px;font-weight:600;">Paid</span>';
      } else if (po.invoice_received_at) {
        invoiceStatus = '<span style="color:var(--sw-green);font-size:11px;font-weight:600;">Invoice received</span>';
      } else if (stage.key !== 'draft') {
        var sinceDate = po.confirmed_at || po.ordered_at || po.created_at;
        var invDays = sinceDate ? Math.floor((Date.now() - new Date(sinceDate).getTime()) / 86400000) : 0;
        if (invDays > 0) {
          var invColor = invDays >= _matAlertCritDays ? 'var(--sw-red)' : invDays >= _matAlertWarnDays ? '#D97706' : 'var(--sw-text-sec)';
          invoiceStatus = '<span style="color:' + invColor + ';font-size:11px;font-weight:' + (invDays >= _matAlertWarnDays ? '600' : '400') + ';">Awaiting invoice — ' + invDays + 'd</span>';
        }
      }
      if (invoiceStatus) html += '<div style="margin-top:3px;">' + invoiceStatus + '</div>';

      // Days in stage
      html += '<div class="kanban-days">';
      if (isStuck) {
        html += '<span style="color:#E67E22; font-weight:600;">&#9888; ' + daysInStage + 'd in Draft</span>';
      } else if (deliverySoon) {
        html += '<span style="color:#E74C3C; font-weight:600;">&#9888; Delivery soon — not confirmed</span>';
      } else {
        html += daysInStage + ' days in stage';
      }
      html += '</div>';

      // FEATURE 7: Lifecycle action buttons + BUG 3: Open Job (fixed to use openJobQuickView)
      html += '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">';
      // Log Email
      html += '<button onclick="event.stopPropagation();openPOEmailCompose(\'' + po.id + '\')" style="font-size:10px;padding:2px 6px;border:1px solid var(--sw-border);border-radius:3px;background:var(--sw-card);cursor:pointer;color:var(--sw-text-sec);">&#9993; Email</button>';
      // Open Job (BUG 3 — fixed: opens job detail, not patio tool)
      if (po.job_id) {
        html += '<button onclick="event.stopPropagation();openJobQuickView(\'' + po.job_id + '\')" style="font-size:10px;padding:2px 6px;border:1px solid var(--sw-border);border-radius:3px;background:var(--sw-card);cursor:pointer;color:var(--sw-text-sec);">Job</button>';
      }
      // Approve & Send button for draft POs
      if (stage.key === 'draft') {
        html += '<button onclick="event.stopPropagation();approveAndSendPO(\'' + po.id + '\',this)" style="font-size:10px;padding:2px 6px;border:1px solid var(--sw-green);border-radius:3px;background:var(--sw-green);cursor:pointer;color:#fff;font-weight:600;">Approve &amp; Send</button>';
      }
      // Mark Delivered for confirmed POs
      // Future: Trade app materials_check can trigger this
      if (stage.key === 'authorised') {
        html += '<button onclick="event.stopPropagation();markPODelivered(\'' + po.id + '\',this)" style="font-size:10px;padding:2px 6px;border:1px solid var(--sw-green);border-radius:3px;background:var(--sw-green);cursor:pointer;color:#fff;font-weight:600;">Mark Delivered</button>';
      }
      // FEATURE 7: Lifecycle buttons
      if (!po.invoice_received_at && (stage.key === 'authorised' || stage.key === 'billed')) {
        html += '<button onclick="event.stopPropagation();markPOInvoiceReceived(\'' + po.id + '\')" style="font-size:10px;padding:2px 6px;border:1px solid var(--sw-green);border-radius:3px;background:var(--sw-card);cursor:pointer;color:var(--sw-green);">Invoice Rcvd</button>';
      }
      if (po.invoice_received_at && !po.paid_at) {
        html += '<button onclick="event.stopPropagation();markPOPaid(\'' + po.id + '\')" style="font-size:10px;padding:2px 6px;border:1px solid var(--sw-green);border-radius:3px;background:var(--sw-card);cursor:pointer;color:var(--sw-green);">Mark Paid</button>';
      }
      html += '</div>';

      // PO Email summary + expand for thread
      var emailCount = (po.communications || po.email_threads || []).length;
      var lastEmail = emailCount > 0 ? (po.communications || po.email_threads)[emailCount - 1] : null;
      var hasUnread = (po.communications || po.email_threads || []).some(function(e) { return (e.direction === 'inbound' || e.direction === 'received') && !e.read_at; });
      if (emailCount > 0 && lastEmail) {
        var emailDir = (lastEmail.direction === 'inbound' || lastEmail.direction === 'received') ? '&#8601;' : '&#8599;';
        var emailPreview = (lastEmail.subject || lastEmail.body_text || '').slice(0, 50);
        html += '<div style="font-size:11px;color:var(--sw-text-sec);margin-top:4px;padding:4px 0;border-top:1px solid var(--sw-border);display:flex;align-items:center;gap:4px;">';
        if (hasUnread) html += '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--sw-blue,#3498DB);"></span>';
        html += '<span>&#128233; ' + emailCount + '</span>';
        html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + emailDir + ' "' + escapeHtml(emailPreview) + '"</span>';
        html += '<button onclick="event.stopPropagation();togglePOCardExpand(\'' + po.id + '\')" style="font-size:10px;padding:1px 6px;border:1px solid var(--sw-border);border-radius:3px;background:var(--sw-card);cursor:pointer;color:var(--sw-text-sec);">&#9660;</button>';
        html += '</div>';
      } else if (po.status !== 'draft') {
        html += '<div style="font-size:11px;color:var(--sw-text-sec);margin-top:4px;padding:4px 0;border-top:1px solid var(--sw-border);">';
        html += '&#128233; No emails yet';
        html += '</div>';
      }
      // Expandable email thread + inline reply (accordion via togglePOCardExpand)
      html += '<div id="poCardBody_' + po.id + '" style="display:' + (_expandedPOCardId === po.id ? 'block' : 'none') + ';margin-top:6px;padding-top:6px;border-top:1px solid var(--sw-border);">';
      html += '<div id="poCardThread_' + po.id + '"><div style="font-size:11px;color:var(--sw-text-sec);">Loading emails...</div></div>';
      if (typeof renderInlineReplyBar === 'function') html += renderInlineReplyBar(po.id, 'po', lastEmail);
      html += '</div>';

      html += '</div>';
    });

    if (items.length === 0) {
      html += '<div style="text-align:center; padding:20px; color:var(--sw-text-sec); font-size:12px;">None</div>';
    }

    html += '</div></div>';
  });

  container.innerHTML = html;
}

