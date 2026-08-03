// ════════════════════════════════════════════════════════════
// MODALS
// ════════════════════════════════════════════════════════════

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

async function openAssignmentModal(preSelectJobId, preDate, preCrew) {
  _editAssignmentId = null; // Reset — this is a new assignment
  document.getElementById('assignmentModal').classList.add('active');
  document.getElementById('assignModalTitle').textContent = 'Schedule Assignment';
  document.getElementById('assignDate').value = preDate || new Date().toISOString().slice(0, 10);
  document.getElementById('assignJobSearch').value = '';
  document.getElementById('assignJobSelect').value = '';
  await loadPOJobList();
  await loadCrewList();
  // Render crew dropdown — preCrew can be a user ID or a name
  var preCrewId = preCrew || '';
  if (preCrewId && !_crewList.some(function(u) { return u.id === preCrewId; })) {
    // It's a name, not an ID — find the matching user (exact, then case-insensitive, then partial)
    var preCrewLower = preCrewId.toLowerCase();
    var match = _crewList.find(function(u) { return u.name === preCrewId; }) ||
      _crewList.find(function(u) { return u.name.toLowerCase() === preCrewLower; }) ||
      _crewList.find(function(u) { return u.name.toLowerCase().indexOf(preCrewLower) !== -1 || preCrewLower.indexOf(u.name.toLowerCase()) !== -1; });
    preCrewId = match ? match.id : '';
  }
  document.getElementById('assignCrewContainer').innerHTML = renderCrewDropdown('assignCrew', preCrewId);
  document.getElementById('assignMembersContainer').innerHTML = renderMemberCheckboxes(preCrewId);
  // Update member checkboxes when lead changes (hide lead from members list)
  document.getElementById('assignCrew').onchange = function() {
    document.getElementById('assignMembersContainer').innerHTML = renderMemberCheckboxes(this.value);
  };
  if (preSelectJobId) {
    selectJobPicker('assign', preSelectJobId);
  }
}

// ── Edit existing assignment ──
var _editAssignmentId = null;

async function openEditAssignmentModal(assignmentId) {
  var ev = _calEvents.find(function(e) { return e.assignment_id === assignmentId; });
  if (!ev) { alert('Assignment not found'); return; }

  _editAssignmentId = assignmentId;
  document.getElementById('assignModalTitle').textContent = 'Edit Assignment — ' + (ev.client_name || '');

  document.getElementById('assignmentModal').classList.add('active');
  document.getElementById('assignDate').value = ev.scheduled_date || '';
  document.getElementById('assignEndDate').value = ev.scheduled_end || '';
  document.getElementById('assignStartTime').value = ev.start_time || '07:00';
  document.getElementById('assignEndTime').value = ev.end_time || '15:00';
  document.getElementById('assignJobSearch').value = '';
  document.getElementById('assignJobSelect').value = '';
  document.getElementById('assignNotes').value = ev.notes || '';

  await loadPOJobList();
  await loadCrewList();

  // Pre-select crew
  var crewName = cleanCrewName(ev.crew_name || ev.assigned_to) || '';
  var crewMatch = _crewList.find(function(u) { return u.name === crewName; }) ||
    _crewList.find(function(u) { return u.id === ev.user_id; });
  var crewId = crewMatch ? crewMatch.id : '';

  document.getElementById('assignCrewContainer').innerHTML = renderCrewDropdown('assignCrew', crewId);
  document.getElementById('assignMembersContainer').innerHTML = renderMemberCheckboxes(crewId);
  document.getElementById('assignCrew').onchange = function() {
    document.getElementById('assignMembersContainer').innerHTML = renderMemberCheckboxes(this.value);
  };

  // Pre-select job or populate label into search box
  if (ev.job_id) {
    selectJobPicker('assign', ev.job_id);
  } else {
    document.getElementById('assignJobSearch').value = ev.label || '';
  }
}

var _poJobList = [];

async function openPOModal(preSelectJobId) {
  resetPOModal();
  document.getElementById('poModal').classList.add('active');
  await loadPOJobList();
  await loadSupplierList();
  if (preSelectJobId) {
    selectJobPicker('po', preSelectJobId);
  }
}

async function loadPOJobList() {
  if (_poJobList.length > 0) return;
  try {
    var data = await opsFetch('pipeline');
    _poJobList = [];
    Object.values(data.columns).forEach(function(arr) { _poJobList = _poJobList.concat(arr); });
  } catch (e) {
    console.error('loadPOJobList error:', e);
  }
}

// ── Unified searchable job picker ──
// Prefixes: 'po', 'assign', 'wo', 'inv'
// Each has: {prefix}JobSearch (input), {prefix}JobSelect (hidden), {prefix}JobDropdown (div)
// Status filters per picker context
var _jobPickerStatuses = {
  assign: ['accepted', 'scheduled', 'in_progress'],
  wo: ['accepted', 'scheduled', 'in_progress'],
  inv: ['accepted', 'scheduled', 'in_progress', 'complete'],
  po: null  // PO shows all statuses
};

function filterJobPicker(prefix, val) {
  var dd = document.getElementById(prefix + 'JobDropdown');
  if (!dd) return;
  var q = (val || '').toLowerCase().trim();
  var statusFilter = _jobPickerStatuses[prefix];

  // Filter by status first
  var jobs = _poJobList;
  if (statusFilter) {
    jobs = jobs.filter(function(j) { return statusFilter.indexOf(j.status) >= 0; });
  }

  // Then filter by search query
  var totalMatched = jobs.length;
  if (q) {
    jobs = jobs.filter(function(j) {
      return (j.client_name || '').toLowerCase().indexOf(q) !== -1 ||
        (j.job_number || '').toLowerCase().indexOf(q) !== -1 ||
        (j.site_suburb || '').toLowerCase().indexOf(q) !== -1;
    });
    totalMatched = jobs.length;
  }

  // Limit to 20 results
  var limited = jobs.length > 20;
  var shown = jobs.slice(0, 20);

  // Group by type
  var patioJobs = shown.filter(function(j) { return j.type === 'patio'; });
  var fencingJobs = shown.filter(function(j) { return j.type === 'fencing'; });
  var otherJobs = shown.filter(function(j) { return j.type !== 'patio' && j.type !== 'fencing'; });

  var html = '';

  function renderGroup(label, color, list) {
    if (list.length === 0) return '';
    var h = '<div class="jp-group-header" style="color:' + color + ';">' + label + '</div>';
    list.forEach(function(j) {
      h += '<div class="jp-option" onmousedown="selectJobPicker(\'' + prefix + '\',\'' + j.id + '\')">';
      h += '<div style="flex:1;">';
      h += '<div class="jp-option-main">' + (j.job_number || '') + (j.job_number && j.client_name ? ' \u2014 ' : '') + (j.client_name || 'Unknown') + (j.site_suburb ? ' \u2014 ' + j.site_suburb : '') + '</div>';
      h += '<div class="jp-option-sub">' + (j.status || '') + (j.type ? ' \u00b7 ' + j.type : '') + '</div>';
      h += '</div>';
      h += '</div>';
    });
    return h;
  }

  html += renderGroup('Patios', '#F15A29', patioJobs);
  html += renderGroup('Fencing', '#4C6A7C', fencingJobs);
  html += renderGroup('Other', '#95A5A6', otherJobs);

  if (shown.length === 0) {
    html = '<div style="padding:16px; text-align:center; color:var(--sw-text-sec); font-size:12px;">No matching jobs</div>';
  }

  if (limited) {
    html += '<div class="jp-count">Showing 20 of ' + totalMatched + ' results \u2014 type to narrow down</div>';
  }

  // PO gets an "unlink" option
  if (prefix === 'po') {
    html += '<div class="jp-option" style="font-size:12px; color:var(--sw-text-sec); border-top:1px solid var(--sw-border);" onmousedown="selectJobPicker(\'po\',\'\')">No job linked</div>';
  }

  dd.innerHTML = html;
  dd.classList.add('show');
}

function selectJobPicker(prefix, jobId) {
  var dd = document.getElementById(prefix + 'JobDropdown');
  var search = document.getElementById(prefix + 'JobSearch');
  var hidden = document.getElementById(prefix + 'JobSelect');
  if (dd) dd.classList.remove('show');
  if (hidden) hidden.value = jobId || '';

  if (!jobId) {
    if (search) search.value = '';
    // PO-specific cleanup
    if (prefix === 'po') {
      document.getElementById('poDeliveryAddress').value = '';
      document.getElementById('poReference').value = '';
    }
    return;
  }

  var job = _poJobList.find(function(j) { return j.id === jobId; });
  if (job && search) {
    search.value = (job.job_number || '') + ' \u2014 ' + (job.client_name || 'Unknown') + (job.site_suburb ? ' \u2014 ' + job.site_suburb : '');
  }

  // Picker-specific post-select hooks
  if (prefix === 'po') onPOJobSelect(jobId);
  if (prefix === 'inv') onInvJobSelect(jobId);
  if (prefix === 'wo') autoWOFromScope(jobId);
  if (prefix === 'assign') {
    // Hide label field when a job is selected
    var labelGroup = document.getElementById('assignLabelGroup');
    if (labelGroup) labelGroup.style.display = jobId ? 'none' : '';
  }
}

// Legacy wrappers for PO modal (existing code calls these)
function showJobDropdown() { filterJobPicker('po', document.getElementById('poJobSearch').value); }
function filterJobDropdown(val) { filterJobPicker('po', val); }
function selectPOJob(jobId) { selectJobPicker('po', jobId); }

async function onPOJobSelect(jobId) {
  if (!jobId) return;
  autoPOFromScope(jobId);
  try {
    var data = await opsFetch('job_detail', { jobId: jobId });
    var j = data.job || data;
    if (j.site_address) document.getElementById('poDeliveryAddress').value = j.site_address + (j.site_suburb ? ', ' + j.site_suburb : '');
    if (j.job_number) document.getElementById('poReference').value = j.job_number;
  } catch(e) { /* non-critical */ }
}

// Close all job picker dropdowns when clicking outside
document.addEventListener('click', function(e) {
  ['po', 'assign', 'wo', 'inv'].forEach(function(prefix) {
    var dd = document.getElementById(prefix + 'JobDropdown');
    var search = document.getElementById(prefix + 'JobSearch');
    if (dd && search && !dd.contains(e.target) && e.target !== search) {
      dd.classList.remove('show');
    }
  });
});

// Fulfilment type toggle (delivery vs pickup)
function onPOFulfilmentChange(type) {
  var dateLabel = document.getElementById('poDateLabel');
  var addressLabel = document.getElementById('poAddressLabel');
  var addressGroup = document.getElementById('poAddressGroup');
  var addressInput = document.getElementById('poDeliveryAddress');

  if (type === 'delivery') {
    dateLabel.textContent = 'Delivery Date';
    addressLabel.textContent = 'Delivery Address';
    addressInput.placeholder = 'Job site address';
    addressGroup.style.display = '';
  } else if (type === 'pickup') {
    dateLabel.textContent = 'Pickup Date';
    addressLabel.textContent = 'Pickup Location';
    addressInput.placeholder = 'Supplier branch address';
    addressGroup.style.display = '';
  } else {
    dateLabel.textContent = 'Pickup Date';
    addressLabel.textContent = 'Pickup Location';
    addressInput.placeholder = 'Address for pickup';
    addressGroup.style.display = '';
  }
}

async function openWOModal() {
  document.getElementById('woModal').classList.add('active');
  document.getElementById('woJobSearch').value = '';
  document.getElementById('woJobSelect').value = '';
  await loadPOJobList();
}

async function loadSupplierList() {
  if (_suppliers.length > 0) return;
  try {
    var data = await opsFetch('list_suppliers');
    _suppliers = data.suppliers || [];
    var dl = document.getElementById('supplierList');
    dl.innerHTML = '';
    _suppliers.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s.name;
      opt.dataset.xeroId = s.xero_contact_id;
      dl.appendChild(opt);
    });
  } catch (e) {
    console.error('loadSupplierList error:', e);
  }
}

function toggleAssignLabelField() {
  var jobId = document.getElementById('assignJobSelect').value;
  var search = (document.getElementById('assignJobSearch').value || '').trim();
  var labelGroup = document.getElementById('assignLabelGroup');
  // Show label field when job search is empty/cleared and no job selected
  labelGroup.style.display = (!jobId && !search) ? '' : 'none';
}

function toggleAssignTypeField() {
  var jobId = document.getElementById('assignJobSelect').value;
  var text = (document.getElementById('assignJobSearch').value || '').trim();
  var grp = document.getElementById('assignTypeGroup');
  if (grp) grp.style.display = (!jobId && text) ? 'block' : 'none';
}

async function submitAssignment() {
  var jobId = document.getElementById('assignJobSelect').value;
  var date = document.getElementById('assignDate').value;
  if (!date) { alert('Please select a date.'); return; }

  var label = null;
  var jobType = null;
  if (!jobId) {
    label = (document.getElementById('assignJobSearch').value || '').trim();
    if (!label) { alert('Please select a job or type a label (e.g. Team meeting).'); return; }
    jobType = document.getElementById('assignJobType').value || null;
  }

  var crewUserId = getCrewSelectId('assignCrew');
  var crewName = getCrewSelectName('assignCrew');
  if (!crewUserId) { alert('Please select a Team Lead.'); return; }

  try {
    var endDate = document.getElementById('assignEndDate').value || null;
    var startTime = document.getElementById('assignStartTime').value || null;
    var endTime = document.getElementById('assignEndTime').value || null;
    var assignType = document.getElementById('assignType').value;
    var notes = document.getElementById('assignNotes').value || null;

    if (_editAssignmentId) {
      // Delete old assignment and create new one (update_assignment doesn't support crew changes)
      var editEv = _calEvents.find(function(e) { return e.assignment_id === _editAssignmentId; });
      await opsPost('delete_assignment', { assignmentId: _editAssignmentId });
      await opsPost('create_assignment', {
        jobId: jobId || null,
        scheduledDate: date,
        scheduledEnd: endDate,
        startTime: startTime,
        endTime: endTime,
        assignmentType: assignType,
        crewName: crewName || null,
        userId: crewUserId || null,
        role: 'lead_installer',
        notes: notes,
        label: label,
        jobType: jobType,
      });

      // Sync dates to sibling assignments (other crew on same job)
      if (editEv) {
        var siblings = _calEvents.filter(function(e) {
          return e.job_id === editEv.job_id && e.assignment_id !== _editAssignmentId;
        });
        for (var s = 0; s < siblings.length; s++) {
          try {
            await opsPost('update_assignment', {
              assignmentId: siblings[s].assignment_id,
              scheduled_date: date,
              scheduled_end: endDate,
            });
          } catch(e) { /* best effort */ }
        }
      }

      _editAssignmentId = null;
      var totalAssigned = 1;
    } else {
      // Create lead assignment
      await opsPost('create_assignment', {
        jobId: jobId || null,
        scheduledDate: date,
        scheduledEnd: endDate,
        startTime: startTime,
        endTime: endTime,
        assignmentType: assignType,
        crewName: crewName || null,
        userId: crewUserId || null,
        role: 'lead_installer',
        notes: notes,
        label: label,
        jobType: jobType,
      });

      // Create helper assignments for checked team members
      var memberCbs = document.querySelectorAll('.assign-member-cb:checked');
      for (var i = 0; i < memberCbs.length; i++) {
        var memberId = memberCbs[i].value;
        var memberName = memberCbs[i].getAttribute('data-name');
        await opsPost('create_assignment', {
          jobId: jobId || null,
          scheduledDate: date,
          scheduledEnd: endDate,
          startTime: startTime,
          endTime: endTime,
          assignmentType: assignType,
          crewName: memberName || null,
          userId: memberId || null,
          role: 'helper',
          notes: notes,
          label: label,
          jobType: jobType,
        });
      }
      var totalAssigned = 1 + memberCbs.length;
    }
    closeModal('assignmentModal');
    // Reset form
    document.getElementById('assignJobSelect').value = '';
    document.getElementById('assignJobSearch').value = '';
    document.getElementById('assignNotes').value = '';
    document.getElementById('assignCrewContainer').innerHTML = renderCrewDropdown('assignCrew', '');
    document.getElementById('assignMembersContainer').innerHTML = renderMemberCheckboxes('');
    showToast('Scheduled — ' + totalAssigned + ' person' + (totalAssigned > 1 ? 's' : '') + ' assigned', 'success');
    // Refresh
    var activeView = document.querySelector('.view.active');
    if (activeView) {
      var id = activeView.id.replace('view', '').toLowerCase();
      if (id === 'today') loadToday();
      if (id === 'calendar') loadCalendar();
      if (id === 'jobs') loadJobs();
    }
  } catch (e) {
    alert('Failed to create assignment: ' + e.message);
  }
}

function addPOLine(desc, qty, unit, unitPrice) {
  var container = document.getElementById('poLineItems');
  var row = document.createElement('div');
  row.className = 'po-line-row';
  row.style.cssText = 'display:grid; grid-template-columns:3fr 60px 60px 80px 80px auto; gap:6px; margin-bottom:4px; align-items:center;';
  row.innerHTML =
    '<input type="text" class="form-input" placeholder="Description" data-field="description" value="' + (desc || '').replace(/"/g, '&quot;') + '" style="font-size:12px; padding:6px 8px;">' +
    '<input type="number" class="form-input" placeholder="Qty" data-field="quantity" value="' + (qty || 1) + '" style="font-size:12px; padding:6px 4px; text-align:center;" oninput="updatePOLineTotals()">' +
    '<input type="text" class="form-input" placeholder="m/ea" data-field="unit" value="' + (unit || 'ea') + '" style="font-size:12px; padding:6px 4px; text-align:center;">' +
    '<input type="number" class="form-input" placeholder="0.00" data-field="unit_price" step="0.01"' + (unitPrice ? ' value="' + unitPrice + '"' : '') + ' style="font-size:12px; padding:6px 4px; text-align:right;" oninput="updatePOLineTotals()">' +
    '<div class="line-total" style="font-size:12px; font-family:var(--sw-font-num); text-align:right; color:var(--sw-text-sec);">$0</div>' +
    '<button class="btn btn-secondary btn-sm" onclick="this.parentElement.remove(); updatePOLineTotals();" style="padding:3px 6px; font-size:11px;">&times;</button>';
  container.appendChild(row);
  updatePOLineTotals();
}

function updatePOLineTotals() {
  var rows = document.querySelectorAll('#poLineItems .po-line-row');
  var total = 0;
  rows.forEach(function(row) {
    var qty = parseFloat(row.querySelector('[data-field="quantity"]').value) || 0;
    var price = parseFloat(row.querySelector('[data-field="unit_price"]').value) || 0;
    var lineTotal = qty * price;
    total += lineTotal;
    var ltEl = row.querySelector('.line-total');
    if (ltEl) ltEl.textContent = fmt$(lineTotal);
  });
  var totalEl = document.getElementById('poLineTotal');
  if (totalEl) totalEl.textContent = fmt$(total);
}

function formatScopeSummary(scope, jobType) {
  if (!scope) return '';
  if (typeof scope === 'string') return escapeHtml(scope);
  var parts = [];
  var s = scope.config || scope;
  var type = (jobType || '').toLowerCase();

  // Fencing: runs[] with name + length
  if (s.runs && Array.isArray(s.runs)) {
    var totalLen = 0;
    var runDescs = [];
    s.runs.forEach(function(r) {
      var len = parseFloat(r.length) || 0;
      if (len > 100) len = len / 1000; // mm to m
      totalLen += len;
      var name = r.name || 'Run';
      runDescs.push(name + ': ' + len.toFixed(1) + 'm');
    });
    if (runDescs.length > 0) parts.push('<strong>' + s.runs.length + ' run' + (s.runs.length > 1 ? 's' : '') + '</strong> — ' + totalLen.toFixed(1) + 'm total');
    runDescs.forEach(function(rd) { parts.push('&nbsp;&nbsp;' + escapeHtml(rd)); });
    // Fence height/type
    if (s.height || s.fenceHeight) parts.push('Height: ' + ((s.height || s.fenceHeight) / 1000 || s.height || s.fenceHeight) + 'm');
    if (s.style || s.fenceType) parts.push('Style: ' + escapeHtml(s.style || s.fenceType));
  }

  // Patio/decking: length, projection, roofing
  if (s.length && s.projection && !s.runs) {
    var len = typeof s.length === 'string' ? parseFloat(s.length) : s.length;
    var proj = typeof s.projection === 'string' ? parseFloat(s.projection) : s.projection;
    if (len > 100) len = len / 1000;
    if (proj > 100) proj = proj / 1000;
    var area = len * proj;
    parts.push('<strong>' + len.toFixed(1) + 'm × ' + proj.toFixed(1) + 'm</strong> (' + area.toFixed(1) + 'm²)');
  }

  // Roofing type
  if (s.roofing) {
    var roofMap = { solarspan75: 'SolarSpan 75mm', solarspan100: 'SolarSpan 100mm', trimdek: 'Trimdek', corrugated: 'Corrugated', spandek: 'Spandek', spanplus330: 'SpanPlus 330' };
    var roofLabel = typeof s.roofing === 'string' ? (roofMap[s.roofing] || s.roofing) : (s.roofing.type || '');
    if (roofLabel) parts.push('Roof: ' + escapeHtml(roofLabel));
  }

  // Roof style
  if (s.roofStyle || s.roof_style) parts.push('Style: ' + escapeHtml(s.roofStyle || s.roof_style));

  // Posts
  var postCount = s.post_count || s.postQtyOverride || 0;
  if (postCount > 0) parts.push('Posts: ' + postCount + (s.post_size || s.postSize ? ' × ' + escapeHtml(s.post_size || s.postSize) : ''));

  // Colour
  if (s.colour || s.color) parts.push('Colour: ' + escapeHtml(s.colour || s.color));

  // Gate info (fencing)
  if (s.gates && Array.isArray(s.gates) && s.gates.length > 0) {
    parts.push('Gates: ' + s.gates.length + ' (' + s.gates.map(function(g) { return escapeHtml(g.type || g.name || 'gate'); }).join(', ') + ')');
  }

  // Fallback — if nothing parsed, show summary/description if available, otherwise skip (don't dump JSON)
  if (parts.length === 0) {
    if (scope.summary) return escapeHtml(scope.summary);
    if (scope.description) return escapeHtml(scope.description);
    return '';
  }
  return parts.join('<br>');
}

function trackingCategoryLabel(jobNumber) {
  if (!jobNumber) return '';
  var prefix = jobNumber.slice(0, 3).toUpperCase();
  var map = { SWP: 'SW - PATIOS', SWF: 'SW - FENCING', SWD: 'SW - DECKING', SWR: 'SW - PRIVATE ROOFING', SWI: 'SW - INSURANCE WORK' };
  return map[prefix] || '';
}

function accountCodeLabel(jobType) {
  var map = { patio: '208 — Patios', fencing: '207 — Fencing', decking: '205 — Decking', roofing: '209 — Roofing', insurance: '210 — Insurance', renovation: '201 — Renovation' };
  return map[(jobType || '').toLowerCase()] || '200 — General';
}

function accountCodeForJobFE(jobType) {
  var map = { patio: '208', fencing: '207', decking: '205', roofing: '209', insurance: '210', renovation: '201' };
  return map[(jobType || '').toLowerCase()] || '200';
}

function addInvLine(desc, qty, unitPrice, acLabel) {
  var container = document.getElementById('invLineItems');
  var row = document.createElement('div');
  row.className = 'inv-line-row';
  row.style.cssText = 'display:grid; grid-template-columns:3fr 60px 80px 80px 72px auto; gap:6px; margin-bottom:4px; align-items:center;';
  var badgeLabel = acLabel || (_invJobCache ? accountCodeLabel(_invJobCache.type) : '200 — General');
  row.innerHTML =
    '<input type="text" class="form-input" placeholder="Description" data-field="description" value="' + (desc || '').replace(/"/g, '&quot;') + '" style="font-size:12px; padding:6px 8px;">' +
    '<input type="number" class="form-input" placeholder="Qty" data-field="quantity" value="' + (qty || 1) + '" style="font-size:12px; padding:6px 4px; text-align:center;" oninput="updateInvLineTotals()">' +
    '<input type="number" class="form-input" placeholder="0.00" data-field="unit_price" step="0.01"' + (unitPrice ? ' value="' + unitPrice + '"' : '') + ' style="font-size:12px; padding:6px 4px; text-align:right;" oninput="updateInvLineTotals()">' +
    '<div class="line-total" style="font-size:12px; font-family:var(--sw-font-num); text-align:right; color:var(--sw-text-sec);">$0</div>' +
    '<span style="font-size:9px; background:var(--sw-border); color:var(--sw-text-sec); padding:2px 5px; white-space:nowrap; text-align:center; font-weight:600; letter-spacing:0.2px;">' + escapeHtml(badgeLabel) + '</span>' +
    '<button class="btn btn-secondary btn-sm" onclick="this.parentElement.remove(); updateInvLineTotals();" style="padding:3px 6px; font-size:11px;">&times;</button>';
  container.appendChild(row);
  updateInvLineTotals();
}

function updateInvLineTotals() {
  var rows = document.querySelectorAll('#invLineItems .inv-line-row');
  var total = 0;
  rows.forEach(function(row) {
    var qty = parseFloat(row.querySelector('[data-field="quantity"]').value) || 0;
    var price = parseFloat(row.querySelector('[data-field="unit_price"]').value) || 0;
    var lineTotal = qty * price;
    total += lineTotal;
    var ltEl = row.querySelector('.line-total');
    if (ltEl) ltEl.textContent = fmt$(lineTotal);
  });
  var totalEl = document.getElementById('invLineTotal');
  if (totalEl) totalEl.textContent = fmt$(total);
  var gstEl = document.getElementById('invGstTotal');
  if (gstEl) gstEl.textContent = fmt$(Math.round(total * 0.1 * 100) / 100);
  var incGstEl = document.getElementById('invIncGstTotal');
  if (incGstEl) incGstEl.textContent = fmt$(Math.round(total * 1.1 * 100) / 100);
}

function gatherPOData() {
  var supplier = document.getElementById('poSupplier').value;
  if (!supplier) { alert('Please enter a supplier name.'); return null; }

  var rows = document.querySelectorAll('#poLineItems .po-line-row');
  var lineItems = [];
  rows.forEach(function(row) {
    var desc = row.querySelector('[data-field="description"]').value;
    var qty = parseFloat(row.querySelector('[data-field="quantity"]').value) || 1;
    var unit = row.querySelector('[data-field="unit"]');
    var unitVal = unit ? unit.value : 'ea';
    var price = parseFloat(row.querySelector('[data-field="unit_price"]').value) || 0;
    if (desc || price > 0) lineItems.push({ description: desc, quantity: qty, unit: unitVal, unit_price: price });
  });

  if (lineItems.length === 0) { alert('Please add at least one line item.'); return null; }

  var xeroId = null;
  var match = _suppliers.find(function(s) { return s.name === supplier; });
  if (match) xeroId = match.xero_contact_id;

  var fulfilment = document.getElementById('poFulfilment').value || 'delivery';
  var timeVal = document.getElementById('poDeliveryTime').value || '';
  var notesVal = document.getElementById('poNotes').value || '';
  // Prepend fulfilment + time info to notes for visibility
  var fulfilmentNote = '';
  if (fulfilment !== 'delivery') fulfilmentNote = 'PICKUP' + (timeVal ? ' @ ' + timeVal : '');
  else if (timeVal) fulfilmentNote = 'Delivery @ ' + timeVal;

  return {
    job_id: document.getElementById('poJobSelect').value || null,
    supplier_name: supplier,
    xero_contact_id: xeroId,
    line_items: lineItems,
    delivery_date: document.getElementById('poDeliveryDate').value || null,
    delivery_address: document.getElementById('poDeliveryAddress').value || null,
    reference: document.getElementById('poReference').value || null,
    notes: (fulfilmentNote ? fulfilmentNote + '\n' : '') + notesVal || null,
    supplier_reason: document.getElementById('poReason').value || null,
  };
}

function confirmPOSend() {
  var data = gatherPOData();
  if (!data) return;
  var supplier = data.supplier_name;
  var supplierMatch = _suppliers.find(function(s) { return s.name === supplier; });
  var email = supplierMatch ? (supplierMatch.email || 'no email on file') : 'no email on file';

  document.getElementById('sendConfirmTitle').textContent = 'Approve & Send PO';
  document.getElementById('sendConfirmBody').innerHTML =
    'This will create the PO and send it to:<br><br>' +
    '<strong>' + supplier + '</strong><br>' +
    '<span style="color:var(--sw-text-sec);">' + email + '</span><br><br>' +
    'The PO will be marked as <strong>AUTHORISED</strong> in Xero and emailed to the supplier.';
  document.getElementById('sendConfirmBtn').onclick = function() {
    closeModal('sendConfirmModal');
    submitPO('send');
  };
  document.getElementById('sendConfirmModal').classList.add('active');
}

var _editingPOId = null; // Set when editing an existing PO

async function submitPO(mode) {
  var poData = gatherPOData();
  if (!poData) return;

  try {
    var result;
    if (_editingPOId) {
      // Update existing PO
      result = await opsPost('update_po', { id: _editingPOId, ...poData, status: mode === 'quote_requested' ? 'quote_requested' : poData.status });
      result = { purchase_order: { id: _editingPOId } };
    } else {
      // Create new PO
      if (mode === 'quote_requested') poData.status = 'quote_requested';
      result = await opsPost('create_po', poData);
    }

    if (mode === 'quote_requested') {
      showToast('Material list saved — send to supplier for pricing', 'success');
    } else if ((mode === 'draft' || mode === 'send') && result.purchase_order && result.purchase_order.id) {
      try {
        var pushMode = mode === 'send' ? 'authorised' : 'draft';
        await opsPost('push_po_to_xero', { id: result.purchase_order.id, status: pushMode });
        if (mode === 'send') {
          await opsPost('email_po', { id: result.purchase_order.id });
          showToast('PO approved and sent to ' + poData.supplier_name, 'success');
        } else {
          showToast('PO saved as draft in Xero', 'success');
        }
      } catch (xe) {
        showToast('PO saved locally but Xero push failed: ' + xe.message, 'warning');
      }
    } else {
      showToast('PO saved as local draft', 'success');
    }

    closeModal('poModal');
    resetPOModal();
    loadPOs();
    loadMaterials();
  } catch (e) {
    alert('Failed to create PO: ' + e.message);
  }
}

// Save prices on a quote_requested PO (mode 2)
async function savePOPrices() {
  if (!_editingPOId) return;
  var poData = gatherPOData();
  if (!poData) return;

  try {
    await opsPost('update_po', { id: _editingPOId, line_items: poData.line_items, status: 'draft' });
    showToast('Prices saved — PO moved to Draft', 'success');
    closeModal('poModal');
    resetPOModal();
    loadPOs();
    loadMaterials();
  } catch (e) {
    alert('Failed to save prices: ' + e.message);
  }
}

// Open an existing PO for editing (pricing mode)
// PO Modal tab switching (Details / Communications)
var _poCommsLoaded = false;
function switchPOModalTab(tab) {
  var detailsView = document.getElementById('poDetailsView');
  var commsView = document.getElementById('poCommsView');
  var detailsTab = document.getElementById('poTabDetails');
  var commsTab = document.getElementById('poTabComms');
  if (!detailsView || !commsView) return;

  if (tab === 'comms') {
    detailsView.style.display = 'none';
    commsView.style.display = 'block';
    detailsTab.classList.remove('active');
    commsTab.classList.add('active');
    // Load emails on first switch
    if (!_poCommsLoaded && _editingPOId && typeof loadPOEmails === 'function') {
      _poCommsLoaded = true;
      var threadEl = document.getElementById('poCommsThread');
      var replyEl = document.getElementById('poCommsReplyBar');
      if (threadEl) threadEl.innerHTML = '<div style="font-size:11px;color:var(--sw-text-sec);text-align:center;padding:16px;">Loading emails...</div>';
      // Clear stale cache for this PO to force fresh fetch
      if (typeof _poEmailCache !== 'undefined') delete _poEmailCache[_editingPOId];
      // Use stored PO data for job_id (reliable, not dependent on _allPOs)
      var editPo = window._editingPO || (_allPOs ? _allPOs.find(function(p) { return p.id === _editingPOId; }) : null);
      var editJobId = editPo ? editPo.job_id : null;
      loadPOEmails(_editingPOId, editJobId).then(function(emails) {
        if (threadEl) threadEl.innerHTML = renderPOEmailThread(emails, _editingPOId);
        if (replyEl && typeof renderInlineReplyBar === 'function') {
          var lastEmail = emails.length > 0 ? emails[emails.length - 1] : null;
          replyEl.innerHTML = renderInlineReplyBar(_editingPOId, 'po', lastEmail);
        }
      });
    }
  } else {
    detailsView.style.display = 'block';
    commsView.style.display = 'none';
    detailsTab.classList.add('active');
    commsTab.classList.remove('active');
  }
}

async function openPOEdit(poId) {
  resetPOModal();
  _editingPOId = poId;

  try {
    var data = await opsFetch('list_pos', { job_id: '' });
    var po = (data.purchase_orders || []).find(function(p) { return p.id === poId; });
    if (!po) { alert('PO not found'); return; }

    document.getElementById('poModalTitle').textContent = 'Edit PO — ' + po.po_number;
    document.getElementById('poSupplier').value = po.supplier_name || '';
    document.getElementById('poReference').value = po.reference || '';
    document.getElementById('poDeliveryDate').value = po.delivery_date || '';

    // Populate job search field
    if (po.job_id) {
      document.getElementById('poJobSelect').value = po.job_id;
      await loadPOJobList();
      var matchedJob = _poJobList.find(function(j) { return j.id === po.job_id; });
      if (matchedJob) {
        document.getElementById('poJobSearch').value = (matchedJob.job_number || '') + ' — ' + (matchedJob.client_name || '');
      } else {
        // Fallback: show reference or job_number from PO data
        document.getElementById('poJobSearch').value = po.reference || po.job_number || po.job_id || '';
      }
    }

    // Parse fulfilment type + time from notes
    var notes = po.notes || '';
    if (notes.indexOf('PICKUP') === 0) {
      document.getElementById('poFulfilment').value = 'pickup';
      onPOFulfilmentChange('pickup');
      var timeMatch = notes.match(/@ (\d{2}:\d{2})/);
      if (timeMatch) document.getElementById('poDeliveryTime').value = timeMatch[1];
      notes = notes.replace(/^PICKUP(?: @ \d{2}:\d{2})?\n?/, '');
    } else if (notes.indexOf('Delivery @') === 0) {
      var timeMatch2 = notes.match(/@ (\d{2}:\d{2})/);
      if (timeMatch2) document.getElementById('poDeliveryTime').value = timeMatch2[1];
      notes = notes.replace(/^Delivery @ \d{2}:\d{2}\n?/, '');
    }
    if (notes) document.getElementById('poNotes').value = notes;

    // Show mode bar for quote_requested POs
    if (po.status === 'quote_requested') {
      var modeBar = document.getElementById('poModeBar');
      modeBar.style.display = 'block';
      modeBar.style.background = 'rgba(230,126,34,0.1)';
      modeBar.style.color = '#E67E22';
      modeBar.textContent = 'Awaiting supplier pricing — enter costs below and save';
      document.getElementById('poActionsNew').style.display = 'none';
      document.getElementById('poActionsPricing').style.display = 'flex';
    }

    // Populate line items
    var container = document.getElementById('poLineItems');
    container.innerHTML = '';
    (po.line_items || []).forEach(function(li) {
      addPOLine(li.description, li.quantity, li.unit, li.unit_price || null);
    });

    // Show tabs and set email count badge (editing existing PO)
    var emailCount = (po.communications || []).length;
    document.getElementById('poModalTabs').style.display = 'flex';
    var badge = document.getElementById('poTabCommsBadge');
    if (badge) badge.textContent = emailCount > 0 ? emailCount : '';
    // Store PO data for comms tab to use (avoids relying on stale _allPOs)
    window._editingPO = po;

    await loadSupplierList();
    document.getElementById('poModal').classList.add('active');
  } catch (e) {
    alert('Failed to load PO: ' + e.message);
  }
}

function resetPOModal() {
  _editingPOId = null;
  _poCommsLoaded = false;
  document.getElementById('poModalTitle').textContent = 'New Purchase Order';
  // Reset to Details tab
  document.getElementById('poModalTabs').style.display = 'none';
  document.getElementById('poDetailsView').style.display = 'block';
  document.getElementById('poCommsView').style.display = 'none';
  document.getElementById('poTabDetails').classList.add('active');
  document.getElementById('poTabComms').classList.remove('active');
  var badge = document.getElementById('poTabCommsBadge');
  if (badge) badge.textContent = '';
  var threadEl = document.getElementById('poCommsThread');
  if (threadEl) threadEl.innerHTML = '';
  var replyEl = document.getElementById('poCommsReplyBar');
  if (replyEl) replyEl.innerHTML = '';
  window._editingPO = null;
  // Reset form fields
  document.getElementById('poJobSelect').value = '';
  document.getElementById('poJobSearch').value = '';
  document.getElementById('poJobDropdown').style.display = 'none';
  document.getElementById('poSupplier').value = '';
  document.getElementById('poDeliveryDate').value = '';
  document.getElementById('poDeliveryTime').value = '';
  document.getElementById('poDeliveryAddress').value = '';
  document.getElementById('poFulfilment').value = 'delivery';
  onPOFulfilmentChange('delivery');
  document.getElementById('poReference').value = '';
  document.getElementById('poNotes').value = '';
  document.getElementById('poLineItems').innerHTML = '';
  document.getElementById('poModeBar').style.display = 'none';
  document.getElementById('poActionsNew').style.display = 'flex';
  document.getElementById('poActionsPricing').style.display = 'none';
  addPOLine(); // Start with one empty row
}

async function submitWO() {
  var jobId = document.getElementById('woJobSelect').value;
  if (!jobId) { alert('Please select a job.'); return; }

  try {
    var priceVal = document.getElementById('woPrice').value;
    await opsPost('create_work_order', {
      job_id: jobId,
      trade_name: document.getElementById('woTradeName').value || null,
      trade_phone: document.getElementById('woTradePhone').value || null,
      trade_email: document.getElementById('woTradeEmail').value || null,
      scheduled_date: document.getElementById('woScheduledDate').value || null,
      price: priceVal ? parseFloat(priceVal) : null,
      special_instructions: document.getElementById('woInstructions').value || null,
      scope_items: (typeof _woScopeItems !== 'undefined' && _woScopeItems.length > 0) ? _woScopeItems : null,
    });
    closeModal('woModal');
    loadWOs();
  } catch (e) {
    alert('Failed to create work order: ' + e.message);
  }
}

// ── Supplier Quote Scanner ──
function scanSupplierQuote(poId) {
  // Create a hidden file input
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.pdf';
  input.capture = 'environment';
  input.onchange = async function() {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    showToast('Analysing supplier quote with AI...', 'info');

    // Convert to base64
    var reader = new FileReader();
    reader.onload = async function() {
      var base64 = reader.result.split(',')[1];
      try {
        var result = await opsPost('analyse_supplier_quote', {
          po_id: poId,
          image_base64: base64,
        });
        if (result.success) {
          var alerts = result.price_alerts || [];
          var msg = result.items_extracted + ' items extracted from ' + result.supplier + '.';
          if (alerts.length > 0) {
            msg += ' ' + alerts.length + ' price difference(s) found >5%.';
          }
          msg += ' Check Pending Prices in Materials tab.';
          showToast(msg, 'success');
          // Refresh materials tab if we're on it
          if (typeof loadPendingPrices === 'function') loadPendingPrices();
        } else {
          showToast('Failed to analyse: ' + (result.error || 'unknown'), 'error');
        }
      } catch (e) {
        showToast('Analysis failed: ' + e.message, 'error');
      }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function pushPOToXero(poId) {
  if (!confirm('Push this PO to Xero?')) return;
  try {
    await opsPost('push_po_to_xero', { id: poId });
    showToast('PO pushed to Xero', 'success');
    loadPOs();
  } catch (e) {
    alert('Failed to push PO: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════
// INVOICE CREATION MODAL
// ════════════════════════════════════════════════════════════

// Unified invoice modal — replaces separate openInvoiceModal + openDepositModal
var _uniInvSelectedQuoteDocs = [];
var _currentRefSuffix = '';

function updateRefSuffixDisplay() {
  var refEl = document.getElementById('invReference');
  if (!refEl || !_invJobCache) return;
  var base = _invJobCache.job_number || '';
  refEl.value = _currentRefSuffix ? base + '-' + _currentRefSuffix : base;
}

var _invSelectedContactId = null; // Track selected contact for multi-neighbour jobs

async function openUnifiedInvoiceModal(preSelectJobId, preSelectContactId) {
  resetUnifiedInvoiceModal();
  _invSelectedContactId = preSelectContactId || null;
  document.getElementById('unifiedInvoiceModal').classList.add('active');

  // Set default due date to 14 days from now
  var due = new Date();
  due.setDate(due.getDate() + 14);
  document.getElementById('invDueDate').value = due.toISOString().slice(0, 10);

  // Load jobs for searchable picker
  document.getElementById('invJobSearch').value = '';
  document.getElementById('invJobSelect').value = '';
  await loadPOJobList();
  if (preSelectJobId) {
    selectJobPicker('inv', preSelectJobId);
  }
}

// Backward compat — old call sites
function openInvoiceModal(id) { openUnifiedInvoiceModal(id); }
function openDepositModal(id) { openUnifiedInvoiceModal(id); }

async function onInvJobSelect(jobId) {
  var infoEl = document.getElementById('invJobInfo');
  var refEl = document.getElementById('invReference');
  var container = document.getElementById('invLineItems');

  if (!jobId) {
    infoEl.style.display = 'none';
    refEl.value = '';
    container.innerHTML = '';
    addInvLine();
    hideUnifiedInvoiceSections();
    return;
  }

  infoEl.style.display = '';
  infoEl.textContent = 'Loading job data...';

  try {
    var data = await opsFetch('job_detail', { jobId: jobId });
    var j = data.job || data;
    _invJobCache = j;
    _invJobDetailCache = data;

    // Set job number as reference (read-only)
    refEl.value = j.job_number || '';

    // Show job header
    var headerEl = document.getElementById('uniInvJobHeader');
    headerEl.style.display = '';
    var typeBadge = j.type ? '<span style="display:inline-block;padding:1px 6px;background:var(--sw-border);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;margin-left:6px;">' + escapeHtml(j.type) + '</span>' : '';
    headerEl.innerHTML = '<div style="font-weight:700;">' + escapeHtml(j.client_name || '') + ' — ' + escapeHtml(j.job_number || '') + typeBadge + '</div>' +
      '<div style="color:var(--sw-text-sec);font-size:12px;">' + escapeHtml(j.site_address || j.site_suburb || '') + '</div>';
    infoEl.style.display = 'none';

    // Hide job picker since we have a job
    document.getElementById('uniInvJobPicker').style.display = 'none';

    // Show accepted quotes if any
    var docs = data.documents || [];
    var quoteDocs = docs.filter(function(d) { return d.type === 'quote'; });
    _uniInvSelectedQuoteDocs = [];
    if (quoteDocs.length > 0) {
      var quotesSection = document.getElementById('uniInvQuotesSection');
      quotesSection.style.display = '';
      var qhtml = '';
      quoteDocs.forEach(function(doc) {
        var statusLabel = doc.client_accepted ? 'Accepted' : doc.sent_to_client ? (doc.client_viewed_at ? 'Viewed' : 'Sent') : 'Draft';
        var statusColor = doc.client_accepted ? 'var(--sw-green)' : doc.sent_to_client ? 'var(--sw-blue-mid, #4C6A7C)' : 'var(--sw-text-sec)';
        var quoteNum = doc.quote_number || ('v' + doc.version);
        qhtml += '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--sw-border);margin-bottom:4px;cursor:pointer;font-size:13px;">';
        qhtml += '<input type="checkbox" class="uni-quote-check" value="' + doc.id + '" ' + (doc.client_accepted ? 'checked' : '') + ' onchange="updateSelectedQuoteDocs()">';
        qhtml += '<span style="font-weight:600;">' + escapeHtml(quoteNum) + '</span>';
        qhtml += '<span style="color:' + statusColor + ';font-size:11px;font-weight:600;">' + statusLabel + '</span>';
        if (doc.sent_at) qhtml += '<span style="color:var(--sw-text-sec);font-size:11px;">' + fmtDate(doc.sent_at) + '</span>';
        qhtml += '<span style="margin-left:auto;font-weight:600;font-family:var(--sw-font-num);">' + (doc.data_snapshot_json?.total ? fmt$(doc.data_snapshot_json.total) : '') + '</span>';
        qhtml += '</label>';
      });
      document.getElementById('uniInvQuotesList').innerHTML = qhtml;
      updateSelectedQuoteDocs();

      // Render quote detail panel from pricing_json
      var detailEl = document.getElementById('uniInvQuoteDetail');
      var pricing = j.pricing_json;
      if (typeof pricing === 'string') try { pricing = JSON.parse(pricing); } catch(e) { pricing = null; }
      if (pricing) {
        var dhtml = '<div style="font-size:11px; font-weight:700; color:var(--sw-mid); text-transform:uppercase; letter-spacing:0.3px; margin-bottom:6px; cursor:pointer;" onclick="var p=this.parentElement;var c=p.querySelector(\'.qd-body\');c.style.display=c.style.display===\'none\'?\'\':\'none\';">Quote Details &#9662;</div>';
        dhtml += '<div class="qd-body">';
        // Totals
        var totalInc = pricing.totalIncGST || pricing.total || 0;
        var totalEx = Math.round((totalInc / 1.1) * 100) / 100;
        dhtml += '<div style="display:flex; gap:16px; margin-bottom:8px; font-size:12px;">';
        dhtml += '<div><span style="color:var(--sw-text-sec);">Total (inc GST):</span> <strong style="font-family:var(--sw-font-num);">' + fmt$(totalInc) + '</strong></div>';
        dhtml += '<div><span style="color:var(--sw-text-sec);">Total (ex GST):</span> <strong style="font-family:var(--sw-font-num);">' + fmt$(totalEx) + '</strong></div>';
        dhtml += '</div>';
        // Line item breakdown
        var items = pricing.items || pricing.lineItems || [];
        if (items.length > 0) {
          dhtml += '<div style="font-size:10px; font-weight:600; color:var(--sw-text-sec); text-transform:uppercase; margin-bottom:3px;">Line Items</div>';
          dhtml += '<table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:8px;">';
          items.forEach(function(item) {
            var iDesc = item.description || item.name || '';
            var iQty = item.quantity || item.qty || 1;
            var iPrice = item.unit_price || item.unitPrice || item.price || 0;
            var iTotal = iQty * iPrice;
            dhtml += '<tr style="border-bottom:1px solid var(--sw-border);">';
            dhtml += '<td style="padding:2px 4px;">' + escapeHtml(iDesc) + '</td>';
            dhtml += '<td style="padding:2px 4px; text-align:center; width:40px;">' + iQty + '</td>';
            dhtml += '<td style="padding:2px 4px; text-align:right; width:70px; font-family:var(--sw-font-num);">' + fmt$(iPrice) + '</td>';
            dhtml += '<td style="padding:2px 4px; text-align:right; width:70px; font-family:var(--sw-font-num);">' + fmt$(iTotal) + '</td>';
            dhtml += '</tr>';
          });
          dhtml += '</table>';
        }
        // Scope summary — reuse the existing rich renderer
        if (j.scope_json) {
          dhtml += '<div style="font-size:10px; font-weight:600; color:var(--sw-text-sec); text-transform:uppercase; margin-bottom:3px;">Scope Summary</div>';
          dhtml += renderScopeSummary(j.scope_json, j.type, j.id);
        }
        // Xero mapping table — account + tracking category
        var acLabel = accountCodeLabel(j.type);
        var trackLabel = trackingCategoryLabel(j.job_number);
        dhtml += '<table style="width:100%; border-collapse:collapse; font-size:11px; margin-top:8px;">';
        dhtml += '<tr style="border-bottom:1px solid var(--sw-border);"><td style="padding:4px 6px; color:var(--sw-text-sec); font-weight:600; width:120px;">Sales Account</td>';
        dhtml += '<td style="padding:4px 6px;"><span style="display:inline-block;padding:2px 6px;background:var(--sw-border);font-size:10px;font-weight:700;letter-spacing:0.2px;">' + escapeHtml(acLabel) + '</span></td></tr>';
        if (trackLabel) {
          dhtml += '<tr style="border-bottom:1px solid var(--sw-border);"><td style="padding:4px 6px; color:var(--sw-text-sec); font-weight:600;">Tracking Category</td>';
          dhtml += '<td style="padding:4px 6px;"><span style="display:inline-block;padding:2px 6px;background:var(--sw-border);font-size:10px;font-weight:700;letter-spacing:0.2px;">' + escapeHtml(trackLabel) + '</span></td></tr>';
        }
        dhtml += '</table>';
        // View Quote PDF buttons
        var qdocs = (data.documents || []).filter(function(d) { return d.type === 'quote'; });
        if (qdocs.length > 0) {
          dhtml += '<div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">';
          qdocs.forEach(function(doc) {
            var url = doc.share_token ? 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/send-quote/view?token=' + encodeURIComponent(doc.share_token) : (doc.storage_url || doc.pdf_url);
            var label = doc.quote_number || doc.file_name || 'Quote PDF';
            if (url) {
              dhtml += '<a href="' + escapeHtml(url) + '" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">&#128196; View ' + escapeHtml(label) + '</a>';
            }
          });
          dhtml += '</div>';
        }
        dhtml += '</div>';
        detailEl.innerHTML = dhtml;
        detailEl.style.display = '';
      } else {
        detailEl.style.display = 'none';
      }
    }

    // Show invoice progress bar
    var invSummary = data.invoice_summary;
    if (invSummary && invSummary.quoted_total > 0) {
      document.getElementById('uniInvProgress').style.display = '';
      var pct = Math.min(100, Math.round((invSummary.invoiced_total / invSummary.quoted_total) * 100));
      document.getElementById('uniInvProgressBar').style.width = pct + '%';
      document.getElementById('uniInvInvoicedAmt').textContent = fmt$(invSummary.invoiced_total);
      document.getElementById('uniInvRemainingAmt').textContent = fmt$(invSummary.remaining_to_invoice);
    }

    // Show presets
    document.getElementById('uniInvPresets').style.display = '';

    // Start clean — user adds items via presets or manually
    container.innerHTML = '';
  } catch (e) {
    infoEl.textContent = 'Error loading job: ' + e.message;
  }
}

function hideUnifiedInvoiceSections() {
  document.getElementById('uniInvJobHeader').style.display = 'none';
  document.getElementById('uniInvQuotesSection').style.display = 'none';
  document.getElementById('uniInvProgress').style.display = 'none';
  document.getElementById('uniInvPresets').style.display = 'none';
  document.getElementById('uniInvJobPicker').style.display = '';
}

function updateSelectedQuoteDocs() {
  _uniInvSelectedQuoteDocs = [];
  document.querySelectorAll('.uni-quote-check:checked').forEach(function(cb) {
    _uniInvSelectedQuoteDocs.push(cb.value);
  });
}

function buildSmartInvoiceDescription(prefix, job) {
  if (!job) return prefix;
  var scope = job.scope_json;
  if (typeof scope === 'string') try { scope = JSON.parse(scope); } catch(e) { scope = null; }
  var type = (job.type || '').toLowerCase();
  var suburb = job.site_suburb || job.site_address || '';
  var parts = [prefix + ' —'];

  if (type === 'patio' || type === 'decking') {
    // Patio/decking: size, roof type, panel, colour
    if (scope) {
      var size = '';
      if (scope.length && scope.width) size = scope.length + 'm x ' + scope.width + 'm ';
      else if (scope.area) size = scope.area + 'm² ';
      var roofType = scope.roofType || scope.roof_type || '';
      var panel = scope.panelType || scope.panel_type || scope.sheeting || '';
      var colour = scope.colour || scope.roofColour || scope.roof_colour || '';
      parts.push((type === 'decking' ? 'Composite Decking' : 'Insulated Patio') + ' Installation');
      if (size) parts.push(size.trim());
      if (roofType) parts.push(roofType.charAt(0).toUpperCase() + roofType.slice(1));
      if (panel) parts.push(panel);
      if (colour) parts.push(colour);
    } else {
      parts.push((type === 'decking' ? 'Decking' : 'Patio') + ' Installation');
    }
  } else if (type === 'fencing') {
    // Fencing: metres, panel type, colour
    if (scope) {
      var totalMetres = 0;
      if (Array.isArray(scope.runs)) {
        scope.runs.forEach(function(r) { totalMetres += parseFloat(r.lengthM || r.length || 0); });
      } else if (scope.totalMetres || scope.total_metres) {
        totalMetres = scope.totalMetres || scope.total_metres;
      }
      var panelType = scope.panelType || scope.panel_type || 'Colorbond';
      var fenceColour = scope.colour || scope.panelColour || '';
      parts.push('Colorbond Fencing Installation');
      if (totalMetres > 0) parts.push(Math.round(totalMetres) + 'm');
      if (fenceColour) parts.push(fenceColour);
      if (panelType && panelType !== 'Colorbond') parts.push(panelType);
    } else {
      parts.push('Colorbond Fencing Installation');
    }
  } else {
    parts.push((type.charAt(0).toUpperCase() + type.slice(1)) + ' Installation');
  }

  // Line 1: Scope details (type, size, materials, colour, suburb)
  if (suburb) parts.push(suburb);
  var scopeLine = parts.join(', ').replace(', —,', ' —');

  // Line 2: Client name + full address
  var clientLine = job.client_name || '';
  var addrParts = [job.site_address, job.site_suburb].filter(Boolean);
  var addrLine = addrParts.join(', ');
  if (clientLine && addrLine) clientLine += ', ' + addrLine;
  else if (addrLine) clientLine = addrLine;

  // Line 3: Job number + account code + GST note
  var acLabel = accountCodeLabel(job.type || '');
  var metaLine = (job.job_number || '') + ' | ' + acLabel + ' | GST Inclusive';

  return scopeLine + '\n' + clientLine + '\n' + metaLine;
}

function addDepositPreset(pct) {
  if (!_invJobCache) return;
  var pricing = _invJobCache.pricing_json;
  if (typeof pricing === 'string') pricing = JSON.parse(pricing);
  var totalIncGst = pricing ? (pricing.totalIncGST || pricing.total || 0) : 0;

  // Per-contact amount: use contact's quote_value if selected
  var contactLabel = '';
  if (_invSelectedContactId && _invJobDetailCache && _invJobDetailCache.job_contacts) {
    var contact = _invJobDetailCache.job_contacts.find(function(c) { return c.id === _invSelectedContactId; });
    if (contact && contact.quote_value_ex_gst > 0) {
      totalIncGst = contact.quote_value_ex_gst * 1.1;
      contactLabel = contact.contact_label || '';
    }
  }

  if (totalIncGst <= 0) { alert('No pricing data on this job.'); return; }
  var depositIncGst = Math.round(totalIncGst * (pct / 100) * 100) / 100;
  var depositExGst = Math.round((depositIncGst / 1.1) * 100) / 100;
  var desc = buildSmartInvoiceDescription(pct + '% Deposit (' + fmt$(totalIncGst) + ' inc GST)', _invJobCache);
  _currentRefSuffix = (contactLabel ? contactLabel + '-' : '') + 'DEP' + pct;
  updateRefSuffixDisplay();
  addInvLine(desc, 1, depositExGst);
}

function addCouncilFeePreset() {
  var defaultFee = Math.round((350 / 1.1) * 100) / 100; // $350 inc GST → ex GST
  var desc = 'Council Application Fee';
  if (_invJobCache) {
    desc += ' — ' + [_invJobCache.site_address, _invJobCache.site_suburb, _invJobCache.client_name].filter(Boolean).join(', ');
    desc += '\n' + (_invJobCache.job_number || '') + ' | ' + accountCodeLabel(_invJobCache.type || '') + ' | GST Inclusive';
  }
  _currentRefSuffix = 'COUNCIL';
  updateRefSuffixDisplay();
  addInvLine(desc, 1, defaultFee);
}

function addBalancePreset() {
  if (!_invJobCache || !_invJobDetailCache) return;
  var pricing = _invJobCache.pricing_json;
  if (typeof pricing === 'string') pricing = JSON.parse(pricing);
  var totalIncGst = pricing ? (pricing.totalIncGST || pricing.total || 0) : 0;

  // Per-contact balance: use contact's quoted amount and their invoiced total
  var contactLabel = '';
  var remaining;
  if (_invSelectedContactId && _invJobDetailCache.job_contacts) {
    var contact = _invJobDetailCache.job_contacts.find(function(c) { return c.id === _invSelectedContactId; });
    if (contact) {
      totalIncGst = contact.quote_value_ex_gst * 1.1;
      var contactInvoiced = (_invJobDetailCache.invoices || [])
        .filter(function(inv) { return inv.job_contact_id === _invSelectedContactId && ['VOIDED','DELETED'].indexOf(inv.status) < 0; })
        .reduce(function(s, inv) { return s + (parseFloat(inv.total) || 0); }, 0);
      remaining = Math.max(0, totalIncGst - contactInvoiced);
      contactLabel = contact.contact_label || '';
    }
  }
  if (remaining === undefined) {
    var invSummary = _invJobDetailCache.invoice_summary;
    remaining = invSummary ? invSummary.remaining_to_invoice : totalIncGst;
  }

  if (remaining <= 0) { alert('This contact appears fully invoiced.'); return; }
  var exGst = Math.round((remaining / 1.1) * 100) / 100;
  var desc = buildSmartInvoiceDescription('Final Balance (' + fmt$(remaining) + ' inc GST)', _invJobCache);
  _currentRefSuffix = (contactLabel ? contactLabel + '-' : '') + 'BAL';
  updateRefSuffixDisplay();
  addInvLine(desc, 1, exGst);
}

function gatherInvoiceData() {
  var jobId = document.getElementById('invJobSelect').value;
  if (!jobId) { alert('Please select a job.'); return null; }

  var rows = document.querySelectorAll('#invLineItems .inv-line-row');
  var lineItems = [];
  rows.forEach(function(row) {
    var desc = row.querySelector('[data-field="description"]').value;
    var qty = parseFloat(row.querySelector('[data-field="quantity"]').value) || 1;
    var price = parseFloat(row.querySelector('[data-field="unit_price"]').value) || 0;
    var acCode = _invJobCache ? accountCodeForJobFE(_invJobCache.type) : '200';
    if (desc || price > 0) lineItems.push({ description: desc, quantity: qty, unit_price: price, account_code: acCode });
  });

  if (lineItems.length === 0) { alert('Please add at least one line item.'); return null; }

  var invData = {
    job_id: jobId,
    line_items_override: lineItems,
    due_date: document.getElementById('invDueDate').value || undefined,
  };

  // Include contact ID if selected (multi-neighbour jobs)
  if (_invSelectedContactId) {
    invData.job_contact_id = _invSelectedContactId;
    // Also resolve the contact's Xero contact ID and name
    if (_invJobDetailCache && _invJobDetailCache.job_contacts) {
      var contact = _invJobDetailCache.job_contacts.find(function(c) { return c.id === _invSelectedContactId; });
      if (contact) {
        if (contact.xero_contact_id) invData.xero_contact_id = contact.xero_contact_id;
        invData.contact_name = contact.client_name;
      }
    }
  }

  return invData;
}

function confirmUnifiedInvoiceSend() {
  var data = gatherInvoiceData();
  if (!data) return;

  var clientName = _invJobCache ? _invJobCache.client_name : 'the client';
  var clientEmail = _invJobCache ? (_invJobCache.client_email || '') : '';
  var jobNumber = _invJobCache ? (_invJobCache.job_number || '') : '';
  var dueDate = document.getElementById('invDueDate').value || 'Not set';
  var acCode = _invJobCache ? accountCodeForJobFE(_invJobCache.type) : '200';
  var acLabel = _invJobCache ? accountCodeLabel(_invJobCache.type) : '200 — General';

  // Build line items preview table
  var subtotal = 0;
  var linesHtml = '<table style="width:100%; border-collapse:collapse; font-size:12px; margin:8px 0;">';
  linesHtml += '<thead><tr style="border-bottom:2px solid var(--sw-border); text-align:left;">';
  linesHtml += '<th style="padding:4px 6px;">Description</th><th style="padding:4px 6px; text-align:center;">Qty</th>';
  linesHtml += '<th style="padding:4px 6px; text-align:right;">Unit Price</th><th style="padding:4px 6px; text-align:right;">Total</th>';
  linesHtml += '<th style="padding:4px 6px; text-align:center;">Account</th></tr></thead><tbody>';
  data.line_items_override.forEach(function(li) {
    var lineTotal = li.quantity * li.unit_price;
    subtotal += lineTotal;
    linesHtml += '<tr style="border-bottom:1px solid var(--sw-border);">';
    linesHtml += '<td style="padding:4px 6px;">' + escapeHtml(li.description) + '</td>';
    linesHtml += '<td style="padding:4px 6px; text-align:center;">' + li.quantity + '</td>';
    linesHtml += '<td style="padding:4px 6px; text-align:right; font-family:var(--sw-font-num);">' + fmt$(li.unit_price) + '</td>';
    linesHtml += '<td style="padding:4px 6px; text-align:right; font-family:var(--sw-font-num);">' + fmt$(lineTotal) + '</td>';
    linesHtml += '<td style="padding:4px 6px; text-align:center; font-size:10px;">' + li.account_code + '</td>';
    linesHtml += '</tr>';
  });
  var gst = Math.round(subtotal * 0.1 * 100) / 100;
  var totalIncGst = Math.round((subtotal + gst) * 100) / 100;
  linesHtml += '</tbody>';
  linesHtml += '<tfoot><tr style="border-top:2px solid var(--sw-border); font-weight:600;">';
  linesHtml += '<td colspan="3" style="padding:4px 6px; text-align:right;">Subtotal (ex GST):</td>';
  linesHtml += '<td style="padding:4px 6px; text-align:right; font-family:var(--sw-font-num);">' + fmt$(subtotal) + '</td><td></td></tr>';
  linesHtml += '<tr><td colspan="3" style="padding:4px 6px; text-align:right;">GST:</td>';
  linesHtml += '<td style="padding:4px 6px; text-align:right; font-family:var(--sw-font-num);">' + fmt$(gst) + '</td><td></td></tr>';
  linesHtml += '<tr style="font-size:14px;"><td colspan="3" style="padding:4px 6px; text-align:right; font-weight:700;">Total (inc GST):</td>';
  linesHtml += '<td style="padding:4px 6px; text-align:right; font-family:var(--sw-font-num); font-weight:700;">' + fmt$(totalIncGst) + '</td><td></td></tr>';
  linesHtml += '</tfoot></table>';

  var bodyHtml = '';

  // ── PDF-style invoice preview ──
  var siteAddr = _invJobCache ? (_invJobCache.site_address || _invJobCache.site_suburb || '') : '';
  var refSuffix = _currentRefSuffix ? '-' + _currentRefSuffix : '';
  bodyHtml += '<div style="border:1px solid var(--sw-border);background:#fff;padding:16px;margin-bottom:14px;">';
  // Header row
  bodyHtml += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid var(--sw-dark);">';
  bodyHtml += '<div>';
  bodyHtml += '<div style="font-size:18px;font-weight:700;color:var(--sw-dark);">TAX INVOICE</div>';
  bodyHtml += '<div style="font-size:11px;color:var(--sw-text-sec);margin-top:2px;">SecureWorks WA</div>';
  bodyHtml += '</div>';
  bodyHtml += '<div style="text-align:right;font-size:12px;">';
  bodyHtml += '<div><span style="color:var(--sw-text-sec);">Reference:</span> <strong>' + escapeHtml(jobNumber + refSuffix) + '</strong></div>';
  bodyHtml += '<div><span style="color:var(--sw-text-sec);">Due:</span> <strong>' + escapeHtml(dueDate) + '</strong></div>';
  bodyHtml += '</div>';
  bodyHtml += '</div>';
  // Bill to
  bodyHtml += '<div style="margin-bottom:12px;font-size:12px;">';
  bodyHtml += '<div style="font-size:10px;font-weight:600;color:var(--sw-text-sec);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:3px;">Bill To</div>';
  bodyHtml += '<div style="font-weight:600;">' + escapeHtml(clientName) + '</div>';
  if (siteAddr) bodyHtml += '<div style="color:var(--sw-text-sec);">' + escapeHtml(siteAddr) + '</div>';
  if (clientEmail) bodyHtml += '<div style="color:var(--sw-text-sec);">' + escapeHtml(clientEmail) + '</div>';
  bodyHtml += '</div>';
  // Line items
  bodyHtml += linesHtml;
  // Account info
  var trackLabel = _invJobCache ? trackingCategoryLabel(_invJobCache.job_number) : '';
  bodyHtml += '<div style="font-size:10px;color:var(--sw-text-sec);margin-top:6px;padding-top:6px;border-top:1px solid var(--sw-border);">';
  bodyHtml += 'Account: ' + acCode + ' (' + escapeHtml(acLabel.split(' — ')[1] || 'General') + ')';
  if (trackLabel) bodyHtml += ' &middot; Tracking: ' + escapeHtml(trackLabel);
  bodyHtml += '</div>';
  bodyHtml += '</div>';

  // ── Send controls ──
  bodyHtml += '<div style="margin-bottom:10px;">';
  bodyHtml += '<label style="font-size:11px; font-weight:600; color:var(--sw-text-sec); text-transform:uppercase; letter-spacing:0.3px;">Send To Email</label>';
  bodyHtml += '<input type="email" id="sendConfirmEmail" class="form-input" value="' + (clientEmail || '').replace(/"/g, '&quot;') + '" style="font-size:13px; padding:6px 8px; margin-top:2px;">';
  bodyHtml += '</div>';
  bodyHtml += '<label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer;">';
  bodyHtml += '<input type="checkbox" id="sendConfirmBranded" checked>';
  bodyHtml += '<span><strong>Send branded email</strong> (recommended)</span>';
  bodyHtml += '</label>';
  bodyHtml += '<div style="font-size:10px; color:var(--sw-text-sec); margin-left:24px;">Unchecked uses Xero\'s plain email template</div>';

  document.getElementById('sendConfirmTitle').textContent = 'Approve & Send Invoice';
  document.getElementById('sendConfirmBody').innerHTML = bodyHtml;
  document.getElementById('sendConfirmBtn').onclick = function() {
    closeModal('sendConfirmModal');
    var emailOverride = document.getElementById('sendConfirmEmail').value.trim();
    var useBranded = document.getElementById('sendConfirmBranded').checked;
    submitUnifiedInvoice('send', emailOverride, useBranded);
  };
  document.getElementById('sendConfirmModal').classList.add('active');
}

// Backward compat
function confirmInvoiceSend() { confirmUnifiedInvoiceSend(); }

async function submitUnifiedInvoice(mode, emailOverride, useBrandedEmail, openInXero) {
  var invData = gatherInvoiceData();
  if (!invData) return;

  invData.xero_status = mode === 'send' ? 'AUTHORISED' : 'DRAFT';
  invData.send_email = mode === 'send';
  invData.quote_document_ids = _uniInvSelectedQuoteDocs.length > 0 ? _uniInvSelectedQuoteDocs : undefined;

  if (emailOverride) invData.email_override = emailOverride;
  if (typeof useBrandedEmail !== 'undefined') invData.use_branded_email = useBrandedEmail;

  // Use unified invoice endpoint when we have a job, else fallback
  var action = 'create_unified_invoice';

  invData.line_items = invData.line_items_override;
  invData.reference = _invJobCache ? _invJobCache.job_number : '';
  invData.reference_suffix = _currentRefSuffix || undefined;
  invData.contact_name = _invJobCache ? _invJobCache.client_name : '';
  invData.xero_contact_id = _invJobCache ? _invJobCache.xero_contact_id : undefined;

  try {
    var result = await opsPost(action, invData);

    if (result.error) {
      alert('Error: ' + result.error);
      return;
    }

    var invTotal = result.total || 0;
    var invNum = result.invoice_number || '';
    var xeroInvId = result.xero_invoice_id || '';
    var msg = 'Invoice ' + invNum + (mode === 'send' ? ' sent' : ' saved as draft') + ' — ' + fmt$(invTotal);
    if (result.warning) msg += '\n' + result.warning;
    closeModal('unifiedInvoiceModal');
    closeSlidePanel();
    loadInvoices();
    refreshActiveView();

    if (mode === 'send' && xeroInvId) {
      showInvoiceSuccessModal(invNum, emailOverride || '', xeroInvId, 'sent');
    } else if (openInXero && xeroInvId) {
      showToast(msg, 'success');
      window.open('https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=' + xeroInvId, '_blank');
    } else {
      showToast(msg, 'success');
    }
  } catch (e) {
    alert('Failed to create invoice: ' + e.message);
  }
}

// Backward compat
function submitInvoice(mode) { submitUnifiedInvoice(mode); }

var _invJobDetailCache = null;

function resetUnifiedInvoiceModal() {
  var select = document.getElementById('invJobSelect');
  if (select) select.value = '';
  var search = document.getElementById('invJobSearch');
  if (search) search.value = '';
  var info = document.getElementById('invJobInfo');
  if (info) { info.style.display = 'none'; info.innerHTML = ''; }
  var ref = document.getElementById('invReference');
  if (ref) ref.value = '';
  var items = document.getElementById('invLineItems');
  if (items) items.innerHTML = '';
  var total = document.getElementById('invLineTotal');
  if (total) total.textContent = '$0';
  var gst = document.getElementById('invGstTotal');
  if (gst) gst.textContent = '$0';
  var incGst = document.getElementById('invIncGstTotal');
  if (incGst) incGst.textContent = '$0';
  _invJobCache = null;
  _invJobDetailCache = null;
  _uniInvSelectedQuoteDocs = [];
  _currentRefSuffix = '';
  hideUnifiedInvoiceSections();
}

// Backward compat
function resetInvoiceModal() { resetUnifiedInvoiceModal(); }

// ── Create Invoice from Quote (one-click auto-fill) ──
var _pendingQuoteAutoPopulate = null;

async function createInvoiceFromQuote(jobId, quoteDocId) {
  // Store the quote doc ID so we can auto-populate after the modal loads the job
  _pendingQuoteAutoPopulate = quoteDocId;
  closeSlidePanel();
  await openUnifiedInvoiceModal(jobId);

  // After modal has loaded, auto-populate from quote data
  if (_invJobCache && _invJobDetailCache) {
    autoPopulateFromQuoteData(_invJobCache, _invJobDetailCache, quoteDocId);
  }
  _pendingQuoteAutoPopulate = null;
}

function autoPopulateFromQuoteData(job, jobDetail, quoteDocId) {
  var pricing = job.pricing_json;
  if (typeof pricing === 'string') try { pricing = JSON.parse(pricing); } catch(e) { pricing = null; }
  if (!pricing) return;

  var totalIncGst = pricing.totalIncGST || pricing.total || 0;
  var totalExGst = Math.round((totalIncGst / 1.1) * 100) / 100;

  // Build rich description line
  var desc = buildSmartInvoiceDescription('Project', job);

  // Clear existing line items and add the auto-populated one
  var container = document.getElementById('invLineItems');
  container.innerHTML = '';

  addInvLine(desc, 1, totalExGst);

  // Auto-check the quote doc in the quotes section
  if (quoteDocId) {
    var checks = document.querySelectorAll('.uni-quote-check');
    checks.forEach(function(cb) {
      cb.checked = cb.value === quoteDocId;
    });
    updateSelectedQuoteDocs();
  }
}

// ════════════════════════════════════════════════════════════
// EDIT INVOICE MODAL
// ════════════════════════════════════════════════════════════

function openEditInvoiceModal(inv) {
  if (!inv) return;
  var isPaid = inv.status === 'PAID';
  var isVoided = inv.status === 'VOIDED' || inv.status === 'DELETED';
  if (isPaid || isVoided) {
    alert(isPaid ? 'This invoice has been paid and cannot be edited.' : 'This invoice has been voided and cannot be edited.');
    return;
  }

  var isSent = inv.status === 'SENT' || inv.status === 'SUBMITTED';
  window._editInvoiceData = inv;

  // Build the edit modal HTML
  var modalEl = document.getElementById('editInvoiceModal');
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'editInvoiceModal';
    modalEl.className = 'modal-overlay';
    document.body.appendChild(modalEl);
  }

  var lineItems = inv.line_items || [];
  var html = '<div class="modal-panel" style="max-width:700px;max-height:90vh;overflow-y:auto;">';
  html += '<div class="modal-header"><span>Edit Invoice — ' + (inv.invoice_number || 'DRAFT') + '</span>';
  html += '<button class="modal-close" onclick="closeEditInvoiceModal()">&times;</button></div>';
  html += '<div class="modal-body">';

  // Invoice info (read-only)
  html += '<div style="display:flex;gap:16px;margin-bottom:12px;font-size:12px;">';
  html += '<div><span style="color:var(--sw-text-sec);">Invoice #:</span> <strong>' + (inv.invoice_number || 'DRAFT') + '</strong></div>';
  html += '<div><span style="color:var(--sw-text-sec);">Reference:</span> <strong>' + escapeHtml(inv.reference || '') + '</strong></div>';
  html += '<div><span style="color:var(--sw-text-sec);">Contact:</span> <strong>' + escapeHtml(inv.contact_name || '') + '</strong></div>';
  html += '</div>';

  // Due date
  html += '<div style="margin-bottom:12px;">';
  html += '<label style="font-size:11px;font-weight:600;color:var(--sw-text-sec);text-transform:uppercase;letter-spacing:0.3px;">Due Date</label>';
  html += '<input type="date" id="editInvDueDate" class="form-input" value="' + (inv.due_date || '') + '" style="font-size:13px;padding:6px 8px;margin-top:2px;">';
  html += '</div>';

  if (isSent) {
    html += '<div style="padding:8px 12px;background:#FFF3E0;border:1px solid #FFB74D;font-size:12px;margin-bottom:12px;color:#E65100;">The client has already received this invoice. Saving changes will update the version they see.</div>';
  }

  // Line items
  html += '<div style="font-size:11px;font-weight:600;color:var(--sw-text-sec);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px;">Line Items</div>';
  html += '<div id="editInvLineItems">';

  if (Array.isArray(lineItems) && lineItems.length > 0) {
    lineItems.forEach(function(li, idx) {
      html += renderEditInvLineRow(li, idx);
    });
  } else {
    html += renderEditInvLineRow({}, 0);
  }

  html += '</div>';
  html += '<button class="btn btn-sm btn-secondary" style="margin-top:6px;font-size:11px;" onclick="addEditInvLine()">+ Add Line</button>';

  // Totals
  html += '<div style="display:flex;justify-content:flex-end;margin-top:12px;">';
  html += '<div style="min-width:200px;font-size:13px;">';
  html += '<div style="display:flex;justify-content:space-between;padding:3px 0;"><span>Subtotal:</span><span id="editInvSubtotal">-</span></div>';
  html += '<div style="display:flex;justify-content:space-between;padding:3px 0;"><span>GST:</span><span id="editInvGst">-</span></div>';
  html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-weight:700;border-top:2px solid var(--sw-dark);"><span>Total:</span><span id="editInvTotal">-</span></div>';
  html += '</div></div>';

  html += '</div>'; // modal-body

  // Footer buttons
  html += '<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--sw-border);">';
  html += '<button class="btn btn-secondary" onclick="closeEditInvoiceModal()">Cancel</button>';
  html += '<button class="btn" style="background:var(--sw-dark);color:#fff;" onclick="saveEditedInvoice(false)">Save Changes</button>';
  if (!inv.status || inv.status === 'DRAFT' || inv.status === 'AUTHORISED' || isSent) {
    html += '<button class="btn" style="background:var(--sw-green);color:#fff;" onclick="saveEditedInvoice(true)">Save & Resend</button>';
  }
  html += '</div>';

  html += '</div>'; // modal-panel
  modalEl.innerHTML = html;
  modalEl.classList.add('active');
  recalcEditInvTotals();
}

function renderEditInvLineRow(li, idx) {
  var desc = li.Description || li.description || '';
  var qty = li.Quantity || li.quantity || 1;
  var price = li.UnitAmount || li.unit_price || 0;
  var account = li.AccountCode || li.account_code || '200';

  var html = '<div class="edit-inv-line" style="display:flex;gap:6px;align-items:flex-start;margin-bottom:6px;padding:6px 0;border-bottom:1px solid var(--sw-border);">';
  html += '<textarea data-field="description" style="flex:3;min-height:36px;resize:vertical;font-size:12px;padding:4px 6px;border:1px solid var(--sw-border);" oninput="recalcEditInvTotals()">' + escapeHtml(desc) + '</textarea>';
  html += '<input type="number" data-field="quantity" value="' + qty + '" style="width:50px;font-size:12px;padding:4px 6px;border:1px solid var(--sw-border);text-align:center;" oninput="recalcEditInvTotals()" step="any">';
  html += '<input type="number" data-field="unit_price" value="' + price + '" style="width:90px;font-size:12px;padding:4px 6px;border:1px solid var(--sw-border);text-align:right;" oninput="recalcEditInvTotals()" step="0.01">';
  html += '<input type="text" data-field="account_code" value="' + escapeHtml(account) + '" style="width:50px;font-size:12px;padding:4px 6px;border:1px solid var(--sw-border);text-align:center;">';
  html += '<button onclick="this.parentElement.remove();recalcEditInvTotals();" style="background:none;border:none;cursor:pointer;color:var(--sw-red);font-size:16px;padding:4px;" title="Remove">&times;</button>';
  html += '</div>';
  return html;
}

function addEditInvLine() {
  var container = document.getElementById('editInvLineItems');
  if (!container) return;
  var idx = container.querySelectorAll('.edit-inv-line').length;
  container.insertAdjacentHTML('beforeend', renderEditInvLineRow({}, idx));
}

function recalcEditInvTotals() {
  var rows = document.querySelectorAll('#editInvLineItems .edit-inv-line');
  var subtotal = 0;
  rows.forEach(function(row) {
    var qty = parseFloat(row.querySelector('[data-field="quantity"]').value) || 0;
    var price = parseFloat(row.querySelector('[data-field="unit_price"]').value) || 0;
    subtotal += qty * price;
  });
  var gst = Math.round(subtotal * 0.1 * 100) / 100;
  var total = Math.round((subtotal + gst) * 100) / 100;
  var subEl = document.getElementById('editInvSubtotal');
  var gstEl = document.getElementById('editInvGst');
  var totEl = document.getElementById('editInvTotal');
  if (subEl) subEl.textContent = fmt$(subtotal);
  if (gstEl) gstEl.textContent = fmt$(gst);
  if (totEl) totEl.textContent = fmt$(total);
}

function closeEditInvoiceModal() {
  var modal = document.getElementById('editInvoiceModal');
  if (modal) modal.classList.remove('active');
  window._editInvoiceData = null;
}

async function saveEditedInvoice(resend) {
  var inv = window._editInvoiceData;
  if (!inv) return;

  var isSent = inv.status === 'SENT' || inv.status === 'SUBMITTED';
  if (isSent && resend && !confirm('The client has already received this invoice. Save changes and resend?')) return;

  // Gather edited line items
  var rows = document.querySelectorAll('#editInvLineItems .edit-inv-line');
  var lineItems = [];
  rows.forEach(function(row) {
    var desc = row.querySelector('[data-field="description"]').value;
    var qty = parseFloat(row.querySelector('[data-field="quantity"]').value) || 1;
    var price = parseFloat(row.querySelector('[data-field="unit_price"]').value) || 0;
    var account = row.querySelector('[data-field="account_code"]').value || '200';
    if (desc || price > 0) {
      lineItems.push({ description: desc, quantity: qty, unit_price: price, account_code: account });
    }
  });

  if (lineItems.length === 0) { alert('At least one line item is required.'); return; }

  var dueDate = document.getElementById('editInvDueDate').value || undefined;

  try {
    var result = await opsPost('update_invoice', {
      xero_invoice_id: inv.xero_invoice_id,
      line_items: lineItems,
      due_date: dueDate,
      resend_email: resend || false,
    });

    if (result.error) { alert('Error: ' + result.error); return; }

    closeEditInvoiceModal();
    showToast('Invoice updated' + (resend ? ' and resent' : ''), 'success');

    // Refresh job detail
    if (_currentJobData?.job?.id) {
      openJobDetail(_currentJobData.job.id);
    }
  } catch (e) {
    alert('Failed to update invoice: ' + e.message);
  }
}

async function sendWO(woId) {
  if (!confirm('Mark this work order as sent?')) return;
  try {
    await opsPost('send_work_order', { id: woId });
    loadWOs();
  } catch (e) {
    alert('Failed to send WO: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════
// ACCEPTANCE REVIEW MODAL
// ════════════════════════════════════════════════════════════

async function openAcceptModal(jobId) {
  document.getElementById('acceptJobId').value = jobId;
  // Show modal and load job data
  document.getElementById('acceptModal').classList.add('active');
  try {
    var data = await opsFetch('job_detail', { jobId: jobId });
    var j = data.job || data;
    document.getElementById('acceptName').value = j.client_name || '';
    document.getElementById('acceptPhone').value = j.client_phone || '';
    document.getElementById('acceptEmail').value = j.client_email || '';
    document.getElementById('acceptAddress').value = j.site_address || '';
    document.getElementById('acceptSuburb').value = j.site_suburb || '';
    document.getElementById('acceptType').value = j.type || '';
    var val = j.pricing_json?.totalIncGST || j.pricing_json?.total || 0;
    document.getElementById('acceptValue').value = fmt$(val);
  } catch (e) {
    console.error('Failed to load job for acceptance review:', e);
  }
}

async function confirmAcceptance() {
  var jobId = document.getElementById('acceptJobId').value;
  if (!jobId) return;

  // Gather possibly-edited fields
  var updates = {
    client_name: document.getElementById('acceptName').value.trim(),
    client_phone: document.getElementById('acceptPhone').value.trim(),
    client_email: document.getElementById('acceptEmail').value.trim(),
    site_address: document.getElementById('acceptAddress').value.trim(),
    site_suburb: document.getElementById('acceptSuburb').value.trim(),
  };

  // Validate — must have at least name, phone, email
  var missing = [];
  if (!updates.client_name) missing.push('Client name');
  if (!updates.client_phone) missing.push('Phone');
  if (!updates.client_email) missing.push('Email');
  if (!updates.site_address) missing.push('Address');
  if (missing.length > 0) {
    alert('Cannot accept — missing: ' + missing.join(', '));
    return;
  }

  try {
    // Update job fields if edited
    await opsPost('update_job_status', { jobId: jobId, status: 'accepted', updates: updates });
    closeModal('acceptModal');
    showToast('Job accepted — client data verified', 'success');
    openJobPeek(jobId);
    refreshActiveView();
  } catch (e) {
    alert('Failed to accept job: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════
// COUNCIL / ENGINEERING START MODAL
// ════════════════════════════════════════════════════════════

var _councilSteps = [];

var COUNCIL_DEFAULT_STEPS = {
  // Mirrors the `standard_council` council_step_templates row — the step list every
  // real submission actually uses. Replaced a 6-step 'full_building_permit' default
  // that no submission had ever been created from. Kept in sync with
  // COUNCIL_STANDARD_STEP_NAMES in ops.html, which drives the kanban step picker.
  standard_council: [
    { name: 'Get House Plans' },
    { name: 'Drafting' },
    { name: 'Engineering' },
    { name: 'Development Approval' },
    { name: 'CDC' },
    { name: 'Submit to Council + BA1' },
    { name: 'Complete' },
  ],
  full_building_permit_da: [
    { name: 'Get Client House Plans' },
    { name: 'Drafting (Patio Plans)' },
    { name: 'Development Approval (DA)' },
    { name: 'Engineering Certification' },
    { name: 'CDC (Private Building Surveyor)' },
    { name: 'Submit to Council for Building Permit' },
    { name: 'Building Permit Received' },
  ],
  engineering_only: [
    { name: 'Get Client House Plans' },
    { name: 'Drafting (Patio Plans)' },
    { name: 'Engineering Certification' },
  ],
  cdc_only: [
    { name: 'CDC (Private Building Surveyor)' },
    { name: 'Submit to Council for Building Permit' },
    { name: 'Building Permit Received' },
  ],
  custom: [],
};

function openCouncilStartModal(jobId) {
  var job = null;
  // Find job from current data
  if (typeof _currentJobData !== 'undefined' && _currentJobData && _currentJobData.job) {
    job = _currentJobData.job;
  } else if (typeof _allJobs !== 'undefined') {
    job = _allJobs.find(function(j) { return j.id === jobId; });
  }
  document.getElementById('councilJobId').value = jobId;
  var infoEl = document.getElementById('councilJobInfo');
  if (job) {
    infoEl.innerHTML = escapeHtml((job.job_number || '') + ' — ' + (job.client_name || '')) +
      '<div style="font-size:11px;color:var(--sw-text-sec);font-weight:400;">' + escapeHtml((job.site_address || '') + (job.suburb ? ', ' + job.suburb : '')) + '</div>';
  } else {
    infoEl.textContent = jobId;
  }
  document.getElementById('councilType').value = 'standard_council';
  updateCouncilDefaultSteps();
  document.getElementById('councilStartModal').classList.add('active');
}

function updateCouncilDefaultSteps() {
  var type = document.getElementById('councilType').value;
  _councilSteps = (COUNCIL_DEFAULT_STEPS[type] || []).map(function(s) { return { name: s.name, vendor: s.vendor || '', vendor_email: s.vendor_email || '' }; });
  renderCouncilStepsList();
}

function renderCouncilStepsList() {
  var el = document.getElementById('councilStepsList');
  if (!el) return;
  if (_councilSteps.length === 0) {
    el.innerHTML = '<div style="font-size:12px;color:var(--sw-text-sec);padding:8px;">No steps — add steps below or select a type above.</div>';
    return;
  }
  var html = '';
  _councilSteps.forEach(function(step, idx) {
    html += '<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--sw-border);">';
    html += '<span style="font-size:11px;color:var(--sw-text-sec);min-width:20px;">' + (idx + 1) + '.</span>';
    html += '<input type="text" class="form-input" value="' + escapeHtml(step.name) + '" onchange="_councilSteps[' + idx + '].name=this.value" style="flex:1;padding:4px 8px;font-size:12px;">';
    if (idx > 0) html += '<button class="btn btn-sm" style="font-size:10px;padding:2px 6px;background:none;color:var(--sw-text-sec);" onclick="moveCouncilStep(' + idx + ',-1)" title="Move up">&#9650;</button>';
    if (idx < _councilSteps.length - 1) html += '<button class="btn btn-sm" style="font-size:10px;padding:2px 6px;background:none;color:var(--sw-text-sec);" onclick="moveCouncilStep(' + idx + ',1)" title="Move down">&#9660;</button>';
    html += '<button class="btn btn-sm" style="font-size:10px;padding:2px 6px;background:none;color:var(--sw-red);" onclick="removeCouncilStep(' + idx + ')" title="Remove">&#10005;</button>';
    html += '</div>';
  });
  el.innerHTML = html;
}

function addCouncilStep() {
  var nameEl = document.getElementById('councilNewStepName');
  var name = (nameEl.value || '').trim();
  if (!name) return;
  _councilSteps.push({ name: name, vendor: '', vendor_email: '' });
  nameEl.value = '';
  renderCouncilStepsList();
}

function removeCouncilStep(idx) {
  _councilSteps.splice(idx, 1);
  renderCouncilStepsList();
}

function moveCouncilStep(idx, direction) {
  var newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= _councilSteps.length) return;
  var tmp = _councilSteps[idx];
  _councilSteps[idx] = _councilSteps[newIdx];
  _councilSteps[newIdx] = tmp;
  renderCouncilStepsList();
}

async function submitCouncilStart() {
  var jobId = document.getElementById('councilJobId').value;
  var type = document.getElementById('councilType').value;
  if (!jobId) return;
  if (_councilSteps.length === 0) { alert('Add at least one step.'); return; }

  try {
    await opsPost('create_council_submission', {
      job_id: jobId,
      template_type: type,
      steps: _councilSteps,
    });
    closeModal('councilStartModal');
    showToast('Council process started — ' + _councilSteps.length + ' steps', 'success');
    // Reload the job detail to show council status
    if (typeof openJobPeek === 'function') openJobPeek(jobId);
    if (typeof loadApprovals === 'function') loadApprovals();
    refreshActiveView();
  } catch (e) {
    alert('Failed to start council process: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════
// COUNCIL STEP ADVANCE CONFIRMATION
// ════════════════════════════════════════════════════════════

function openCouncilAdvanceModal(submissionId, stepIndex) {
  var sub = (_councilSubmissions || []).find(function(s) { return s.id === submissionId; });
  if (!sub) return;
  var steps = sub.steps || [];
  var currentStep = steps[stepIndex];
  var nextStep = steps[stepIndex + 1];

  document.getElementById('councilAdvanceSubId').value = submissionId;
  document.getElementById('councilAdvanceStepIdx').value = stepIndex;
  document.getElementById('councilAdvanceNotes').value = '';
  document.getElementById('councilAdvanceSMS').checked = true;

  var infoHtml = '<div style="margin-bottom:8px;">';
  infoHtml += '<div style="font-size:12px;color:var(--sw-text-sec);">Completing:</div>';
  infoHtml += '<div style="font-weight:600;">' + escapeHtml(currentStep ? currentStep.name : 'Step ' + (stepIndex + 1)) + '</div>';
  if (nextStep) {
    infoHtml += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:6px;">Next step auto-starts:</div>';
    infoHtml += '<div style="font-weight:600;">' + escapeHtml(nextStep.name) + '</div>';
  } else {
    infoHtml += '<div style="font-size:12px;color:var(--sw-green);margin-top:6px;font-weight:600;">This is the final step — process will be marked complete.</div>';
  }
  infoHtml += '</div>';
  document.getElementById('councilAdvanceInfo').innerHTML = infoHtml;

  var clientName = sub.client_name || sub.jobs?.client_name || 'there';
  var jobNum = sub.job_number || sub.jobs?.job_number || '';
  var nextStepName = nextStep ? nextStep.name : 'Complete';
  var smsText = 'Hi ' + clientName + ', your council application for ' + jobNum + ' has progressed. Current status: ' + nextStepName + '. — SecureWorks Group';
  document.getElementById('councilAdvanceSMSPreview').textContent = smsText;

  document.getElementById('councilAdvanceModal').classList.add('active');
}

async function confirmCouncilAdvance() {
  var subId = document.getElementById('councilAdvanceSubId').value;
  var stepIdx = parseInt(document.getElementById('councilAdvanceStepIdx').value, 10);
  var notes = document.getElementById('councilAdvanceNotes').value;
  var sendSMS = document.getElementById('councilAdvanceSMS').checked;

  try {
    // Complete current step
    await opsPost('update_council_status', {
      submission_id: subId,
      step_index: stepIdx,
      status: 'complete',
      notes: notes || undefined,
    });

    // Auto-advance next step to in_progress
    var sub = (_councilSubmissions || []).find(function(s) { return s.id === subId; });
    var steps = sub ? sub.steps || [] : [];
    if (stepIdx + 1 < steps.length) {
      await opsPost('update_council_status', {
        submission_id: subId,
        step_index: stepIdx + 1,
        status: 'in_progress',
      });
    }

    // Send SMS via GHL if checked
    if (sendSMS && sub) {
      var smsText = document.getElementById('councilAdvanceSMSPreview').textContent;
      try {
        await opsPost('send_council_sms', {
          job_id: sub.job_id,
          message: smsText,
        });
      } catch (smsErr) {
        console.warn('Council SMS failed (non-blocking):', smsErr);
      }
    }

    closeModal('councilAdvanceModal');
    showToast('Step completed — advancing to next step', 'success');
    loadApprovals();
  } catch (e) {
    alert('Failed to advance step: ' + e.message);
  }
}

