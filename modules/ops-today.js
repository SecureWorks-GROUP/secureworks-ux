// ════════════════════════════════════════════════════════════

function showView(view) {
  // Close full-page job detail if open
  if (document.getElementById('jobDetailView').classList.contains('active')) {
    closeJobDetail(true);
  }
  document.querySelectorAll('.view').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.header-nav button').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.mobile-nav button').forEach(function(el) { el.classList.remove('active'); });

  var viewEl = document.getElementById('view' + view.charAt(0).toUpperCase() + view.slice(1));
  if (viewEl) viewEl.classList.add('active');

  document.querySelectorAll('[data-view="' + view + '"]').forEach(function(btn) {
    btn.classList.add('active');
  });

  if (history.replaceState) history.replaceState(null, '', '#' + view);
  localStorage.setItem('sw_ops_tab', view);

  if (view === 'today') loadToday();
  if (view === 'calendar') loadCalendar();
  if (view === 'jobs') loadJobs();
  if (view === 'financials') loadFinancials();
  if (view === 'materials') loadMaterials();
  if (view === 'inbox') loadInbox();
  if (view === 'approvals') loadApprovals();
}

function restoreTab() {
  var hash = window.location.hash.slice(1);
  // Handle #job/<jobNumber> deep links
  if (hash.startsWith('job/')) {
    var jobRef = hash.slice(4);
    showView('jobs');
    // Delay to allow jobs to load, then open the job detail
    setTimeout(function() { openJobDetailByRef(jobRef); }, 500);
    return;
  }
  var validTabs = ['today', 'calendar', 'jobs', 'financials', 'materials', 'inbox', 'approvals'];
  if (hash && validTabs.indexOf(hash) >= 0) { showView(hash); return; }
  var saved = localStorage.getItem('sw_ops_tab');
  if (saved && validTabs.indexOf(saved) >= 0) { showView(saved); return; }
  showView('today');
}

// ════════════════════════════════════════════════════════════
// GLOBAL SEARCH — search by job_number, client name, suburb
// ════════════════════════════════════════════════════════════

var _searchTimer = null;

function globalJobSearch(query) {
  clearTimeout(_searchTimer);
  var resultsEl = document.getElementById('globalSearchResults');
  if (!query || query.length < 2) {
    resultsEl.style.display = 'none';
    return;
  }
  _searchTimer = setTimeout(async function() {
    try {
      var data = _pipelineData || await opsFetch('pipeline');
      var allJobs = [];
      if (data.columns) {
        Object.values(data.columns).forEach(function(col) {
          if (Array.isArray(col)) col.forEach(function(j) { allJobs.push(j); });
          else if (col && col.jobs) col.jobs.forEach(function(j) { allJobs.push(j); });
        });
      }
      var q = query.toLowerCase();
      var matches = allJobs.filter(function(j) {
        return (j.client_name || '').toLowerCase().indexOf(q) !== -1 ||
               (j.job_number || '').toLowerCase().indexOf(q) !== -1 ||
               (j.site_suburb || '').toLowerCase().indexOf(q) !== -1 ||
               (j.site_address || '').toLowerCase().indexOf(q) !== -1;
      }).slice(0, 10);

      if (matches.length === 0) {
        resultsEl.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--sw-text-sec)">No jobs found</div>';
      } else {
        var html = '';
        matches.forEach(function(j) {
          html += '<div onclick="openJobPeek(\'' + j.id + '\');document.getElementById(\'globalSearchResults\').style.display=\'none\'" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--sw-border);font-size:13px" onmouseover="this.style.background=\'var(--sw-light)\'" onmouseout="this.style.background=\'\'">';
          html += '<div style="font-weight:600;color:var(--sw-dark)">' + (j.client_name || 'Unknown') + '</div>';
          html += '<div style="color:var(--sw-text-sec);font-size:12px">';
          if (j.job_number) html += j.job_number + ' · ';
          html += (j.site_suburb || j.site_address || '') + ' · ';
          html += '<span class="type-badge ' + (j.type || '') + '" style="font-size:10px;padding:1px 6px">' + typeBadgeLabel(j.type) + '</span>';
          html += '</div></div>';
        });
        resultsEl.innerHTML = html;
      }
      resultsEl.style.display = 'block';
    } catch (e) {
      resultsEl.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--sw-red)">Search error</div>';
      resultsEl.style.display = 'block';
    }
  }, 300);
}

// Close search results when clicking outside
document.addEventListener('click', function(e) {
  var resultsEl = document.getElementById('globalSearchResults');
  var searchInput = document.getElementById('globalSearch');
  if (resultsEl && !resultsEl.contains(e.target) && e.target !== searchInput) {
    resultsEl.style.display = 'none';
  }
});

// ════════════════════════════════════════════════════════════
// TODAY TAB
// ════════════════════════════════════════════════════════════

async function loadAiAlerts() {
  try {
    // Cache for 30 minutes
    if (_digestCache && Date.now() - _digestCacheTime < 30 * 60 * 1000) {
      renderAiAlerts(_digestCache);
      return;
    }

    var resp = await fetch(_digestBase, {
      headers: await _getAuthHeaders()
    });
    if (!resp.ok) throw new Error('Digest API error: ' + resp.status);
    var digest = await resp.json();
    _digestCache = digest;
    _digestCacheTime = Date.now();
    renderAiAlerts(digest);
  } catch (e) {
    console.error('loadAiAlerts error:', e);
    // Don't show panel if digest fails — non-critical
  }
}

function renderAiAlerts(digest) {
  var panel = document.getElementById('aiAlertsPanel');
  if (!digest || !digest.alerts) return;

  var alerts = digest.alerts || [];
  var narrative = digest.ai_narrative || digest.summary_text || '';
  var redAlerts = alerts.filter(function(a) { return a.severity === 'critical'; });
  var amberAlerts = alerts.filter(function(a) { return a.severity === 'warning'; });

  // If no alerts and no narrative, show green "all clear"
  if (alerts.length === 0) {
    document.getElementById('aiNarrative').innerHTML = '<div class="ai-alert-green">&#9989; All clear — no issues detected this morning.' + (narrative ? ' ' + narrative : '') + '</div>';
    panel.style.display = 'block';
    return;
  }

  // Render narrative
  var narHtml = '';
  if (narrative) {
    narHtml = '<div class="ai-alert-narrative"><div class="narrative-label">AI Morning Brief</div>' + narrative + '</div>';
  }
  document.getElementById('aiNarrative').innerHTML = narHtml;

  // Render red alerts (always visible)
  var redHtml = '';
  redAlerts.forEach(function(a) {
    redHtml += renderAlertCard(a, 'red');
  });
  document.getElementById('aiRedAlerts').innerHTML = redHtml;

  // Render amber alerts (collapsed by default)
  if (amberAlerts.length > 0) {
    var amberHtml = '';
    amberAlerts.forEach(function(a) {
      amberHtml += renderAlertCard(a, 'amber');
    });
    document.getElementById('aiAmberAlerts').innerHTML = amberHtml;
    document.getElementById('aiAmberToggle').style.display = 'flex';
    document.getElementById('amberToggleText').textContent = amberAlerts.length + ' amber alert' + (amberAlerts.length > 1 ? 's' : '');
  }

  panel.style.display = 'block';
}

function renderAlertCard(alert, severity) {
  var icon = severity === 'red' ? '&#128308;' : '&#128992;';
  var impact = alert.data && (alert.data.total_value || alert.data.total) ? ' — ' + fmt$(alert.data.total_value || alert.data.total) + ' at risk' : '';
  return '<div class="ai-alert-card ' + severity + '">' +
    '<div class="ai-alert-icon ' + severity + '">' + icon + '</div>' +
    '<div class="ai-alert-body">' +
      '<div class="ai-alert-title">' + (alert.title || alert.message || '') + impact + '</div>' +
      '<div class="ai-alert-detail">' + (alert.detail || '') + '</div>' +
      '<div class="ai-alert-action">' + (alert.action || alert.recommended_action || '') + '</div>' +
    '</div>' +
    '<button class="ai-alert-dismiss" onclick="dismissAlert(this, \'' + (alert.id || '') + '\')">Dismiss</button>' +
  '</div>';
}

function toggleAmberAlerts() {
  _amberExpanded = !_amberExpanded;
  document.getElementById('aiAmberAlerts').style.display = _amberExpanded ? 'block' : 'none';
  document.getElementById('amberToggleIcon').innerHTML = _amberExpanded ? '&#9652;' : '&#9662;';
}

function dismissAlert(btn, alertId) {
  btn.closest('.ai-alert-card').style.display = 'none';
  if (alertId) {
    // Fire-and-forget dismiss to ai_alerts table via ops-api
    opsPost('dismiss_alert', { alert_id: alertId }).catch(function() {});
  }
}

async function loadToday() {
  try {
    // Fetch summary + pipeline + POs in parallel (2 calls, max efficiency)
    var results = await Promise.all([
      opsFetch('ops_summary'),
      opsFetch('pipeline'),
    ]);
    var data = results[0];
    var pipelineData = results[1];

    renderTodayStats(data.stat_cards, data.kpis);
    renderTodaySchedule(data.today_schedule, data.deliveries_today);
    renderActionableItems(pipelineData, data);
    renderPipelineOverview(data.stat_cards.pipeline);
    // Feature 2: Trigger morning brief (non-blocking)
    loadMorningBrief();
    // AI alerts from daily-digest
    loadAiAlerts();
    // Refresh inbox badge (non-blocking)
    refreshInboxBadge();
    // Pending SMS actions (non-blocking)
    loadPendingSms();
  } catch (e) {
    console.error('loadToday error:', e);
  }
}

function renderTodayStats(stats, kpis) {
  var el = function(id) { return document.getElementById(id); };

  el('valJobsWeek').textContent = stats.jobs_this_week;
  el('valMaterials').textContent = stats.awaiting_materials;
  el('valOverdue').textContent = stats.overdue_invoices.count;
  el('subOverdue').textContent = fmt$(stats.overdue_invoices.total) + ' total';
  el('valQuotes').textContent = stats.quotes_pending;
  el('valCompleted').textContent = kpis.jobs_completed_month;
  el('subCompleted').textContent = 'Target: ' + kpis.jobs_target;

  // RAG borders
  var statOverdue = el('statOverdue');
  statOverdue.className = 'stat-card ' + (stats.overdue_invoices.count === 0 ? 'rag-green' : stats.overdue_invoices.count <= 3 ? 'rag-amber' : 'rag-red');

  var statCompleted = el('statCompleted');
  var pct = kpis.jobs_target > 0 ? kpis.jobs_completed_month / kpis.jobs_target : 0;
  var dayPct = new Date().getDate() / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  statCompleted.className = 'stat-card ' + (pct >= dayPct ? 'rag-green' : pct >= dayPct * 0.6 ? 'rag-amber' : 'rag-red');
}

function renderTodaySchedule(schedule, deliveries) {
  var container = document.getElementById('todayScheduleList');
  var items = (schedule || []);
  var dels = (deliveries || []);

  if (items.length === 0 && dels.length === 0) {
    container.innerHTML = '<div style="padding:12px;color:var(--sw-text-sec);font-size:12px;text-align:center;">No jobs or deliveries scheduled for today</div>';
    return;
  }

  var html = '';
  items.forEach(function(ev) {
    html += '<div class="today-action-card schedule" onclick="openJobQuickView(\'' + ev.job_id + '\')">';
    html += '<div class="status-dot ' + ev.assignment_status + '"></div>';
    html += '<div class="today-card-main">';
    html += '<div class="today-card-title">' + (ev.job_number || '') + (ev.job_number && ev.client_name ? ' — ' : '') + (ev.client_name || 'Unknown') + '</div>';
    html += '<div class="today-card-detail">' + (ev.site_address || ev.site_suburb || '') + (ev.crew_name ? ' &middot; ' + cleanCrewName(ev.crew_name) : '') + '</div>';
    html += '</div>';
    html += '<span class="type-badge ' + (ev.job_type || '') + '">' + typeBadgeLabel(ev.job_type) + '</span>';
    var schedDate = ev.scheduled_date || new Date().toISOString().slice(0, 10);
    html += weatherBadgeHtml(schedDate, true);
    if (ev.start_time) html += '<span style="font-size:11px;color:var(--sw-mid);font-family:var(--sw-font-num);">' + fmtTime(ev.start_time) + '</span>';
    html += '</div>';
  });

  // Deliveries today
  dels.forEach(function(del) {
    html += '<div class="today-action-card schedule" style="border-left-color:var(--sw-purple);">';
    html += '<span style="font-size:14px;">&#128666;</span>';
    html += '<div class="today-card-main">';
    html += '<div class="today-card-title">' + escapeHtml(del.supplier_name || '') + '</div>';
    html += '<div class="today-card-detail">' + (del.po_number || '') + (del.job_number ? ' &middot; ' + del.job_number : '') + '</div>';
    html += '</div>';
    if (del.delivery_time) html += '<span style="font-size:11px;color:var(--sw-mid);">' + del.delivery_time + '</span>';
    html += '</div>';
  });

  container.innerHTML = html;
}

// ── Pending SMS Actions ──
async function loadPendingSms() {
  var section = document.getElementById('todayPendingSms');
  var container = document.getElementById('pendingSmsList');
  if (!section || !container) return;
  try {
    var data = await opsFetch('list_proposed_actions');
    var actions = data.actions || data.proposed_actions || [];
    if (actions.length === 0) { section.style.display = 'none'; return; }
    section.style.display = '';
    var html = '';
    actions.forEach(function(act) {
      // ai_proposed_actions PK is `proposal_id` (not `id`). See ops.html sibling.
      var pid = act.proposal_id || act.id || '';
      var preview = (act.message || act.drafted_message || '').substring(0, 80);
      if ((act.message || act.drafted_message || '').length > 80) preview += '...';
      html += '<div class="today-action-card" id="smsCard_' + pid + '" style="border-left:3px solid #D97706;padding:10px 12px;margin-bottom:8px;background:var(--sw-card);border-radius:8px;border:1px solid var(--sw-border);border-left:3px solid #D97706;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">';
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-size:13px;font-weight:600;">' + escapeHtml(act.job_number || '') + ' — ' + escapeHtml(act.client_name || '') + '</div>';
      html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(preview) + '</div>';
      html += '</div>';
      html += '<div style="display:flex;gap:6px;flex-shrink:0;">';
      html += '<button onclick="sendProposedSms(\'' + pid + '\')" style="font-size:11px;padding:4px 10px;border:1px solid var(--sw-green);border-radius:4px;background:var(--sw-green);color:#fff;cursor:pointer;font-weight:600;">Send</button>';
      html += '<button onclick="dismissProposedSms(\'' + pid + '\')" style="font-size:11px;padding:4px 10px;border:1px solid var(--sw-border);border-radius:4px;background:var(--sw-card);color:var(--sw-text-sec);cursor:pointer;">Dismiss</button>';
      html += '</div></div></div>';
    });
    container.innerHTML = html;
  } catch(e) {
    section.style.display = 'none';
    console.error('loadPendingSms error:', e);
  }
}

async function sendProposedSms(actionId) {
  try {
    await opsPost('send_proposed_sms', { action_id: actionId });
    var card = document.getElementById('smsCard_' + actionId);
    if (card) { card.style.transition = 'opacity 0.3s'; card.style.opacity = '0'; setTimeout(function() { card.remove(); checkPendingSmsEmpty(); }, 300); }
    showToast('SMS sent', 'success');
  } catch(e) {
    showToast('Failed to send SMS: ' + e.message, 'warning');
  }
}

async function dismissProposedSms(actionId) {
  try {
    await opsPost('dismiss_proposed_action', { action_id: actionId });
    var card = document.getElementById('smsCard_' + actionId);
    if (card) { card.style.transition = 'opacity 0.3s'; card.style.opacity = '0'; setTimeout(function() { card.remove(); checkPendingSmsEmpty(); }, 300); }
  } catch(e) {
    showToast('Failed to dismiss: ' + e.message, 'warning');
  }
}

function checkPendingSmsEmpty() {
  var container = document.getElementById('pendingSmsList');
  if (container && container.children.length === 0) {
    document.getElementById('todayPendingSms').style.display = 'none';
  }
}

// ── Actionable Attention Items (client-side from pipeline data) ──
function renderActionableItems(pipelineData, summaryData) {
  var cols = pipelineData.columns || {};
  var allJobs = [];
  Object.keys(cols).forEach(function(s) { allJobs = allJobs.concat(cols[s]); });
  var todayStr = new Date().toISOString().slice(0, 10);
  var now = Date.now();

  var urgent = [];  // 🔴
  var action = [];  // 🟡

  // ── 🔴 URGENT ──

  // 1. Jobs complete but not invoiced
  var completeJobs = cols.complete || [];
  completeJobs.forEach(function(j) {
    var daysSince = j.completed_at ? Math.floor((now - new Date(j.completed_at).getTime()) / 86400000) : 0;
    var quoteVal = j.value || j.pricing_json?.totalIncGST || 0;
    urgent.push({
      title: (j.job_number || '') + (j.job_number && j.client_name ? ' — ' : '') + (j.client_name || 'Unknown'),
      detail: fmt$(quoteVal) + ' &middot; ' + daysSince + 'd since completion',
      type: 'not_invoiced',
      jobId: j.id,
      btnLabel: 'Create Invoice',
      btnClass: 'red',
      btnAction: 'openCascadeModal(\'' + j.id + '\')',
    });
  });

  // 2. Overdue invoices (from summary data)
  var attentionItems = summaryData.attention || [];
  attentionItems.forEach(function(item) {
    if (item.type === 'overdue_invoice' || (item.type || '').indexOf('overdue') !== -1) {
      if (item.severity === 'red') {
        urgent.push({
          title: item.title,
          detail: '',
          type: 'overdue_invoice',
          jobId: (item.job_ids && item.job_ids[0]) || null,
          btnLabel: 'View Invoices',
          btnClass: 'red',
          btnAction: 'showView(\'financials\'); showSubTab(\'invoices\')',
        });
      }
    }
  });

  // 3. Materials not ordered but build within 5 days
  var scheduledJobs = (cols.scheduled || []).concat(cols.accepted || []);
  scheduledJobs.forEach(function(j) {
    if (j.scheduled_at) {
      var buildDate = new Date(j.scheduled_at);
      var daysUntil = Math.floor((buildDate.getTime() - now) / 86400000);
      if (daysUntil <= 5 && daysUntil >= 0 && (j.po_count || 0) === 0 && j.scope_json) {
        urgent.push({
          title: (j.job_number || '') + (j.job_number && j.client_name ? ' — ' : '') + (j.client_name || 'Unknown'),
          detail: 'Build in ' + daysUntil + ' days &middot; No materials ordered',
          type: 'materials_urgent',
          jobId: j.id,
          btnLabel: 'Create PO',
          btnClass: 'red',
          btnAction: 'showView(\'materials\'); openPOModal(\'' + j.id + '\')',
        });
      }
    }
  });

  // ── 🟡 ACTION NEEDED ──

  // 4. Accepted jobs with no crew assigned
  var acceptedJobs = cols.accepted || [];
  acceptedJobs.forEach(function(j) {
    if ((j.assignment_count || 0) === 0) {
      var daysSince = j.accepted_at ? Math.floor((now - new Date(j.accepted_at).getTime()) / 86400000) : 0;
      action.push({
        title: (j.job_number || '') + (j.job_number && j.client_name ? ' — ' : '') + (j.client_name || 'Unknown'),
        detail: daysSince + 'd since accepted &middot; No crew assigned',
        type: 'unassigned',
        jobId: j.id,
        btnLabel: 'Assign Crew',
        btnClass: 'amber',
        btnAction: 'showView(\'calendar\'); openAssignmentModal(\'' + j.id + '\')',
      });
    }
  });

  // 5. POs awaiting invoice (from attention items)
  attentionItems.forEach(function(item) {
    if ((item.type || '').indexOf('po') !== -1 && item.severity === 'amber') {
      action.push({
        title: item.title,
        detail: '',
        type: 'po_attention',
        jobId: (item.job_ids && item.job_ids[0]) || null,
        btnLabel: 'View POs',
        btnClass: 'outline',
        btnAction: 'showView(\'materials\')',
      });
    }
  });

  // 6. Quotes with no response in 14+ days
  var quotedJobs = cols.quoted || [];
  quotedJobs.forEach(function(j) {
    var daysSince = j.created_at ? Math.floor((now - new Date(j.created_at).getTime()) / 86400000) : 0;
    if (daysSince >= 14) {
      var quoteVal = j.value || j.pricing_json?.totalIncGST || 0;
      action.push({
        title: (j.job_number || '') + (j.job_number && j.client_name ? ' — ' : '') + (j.client_name || 'Unknown'),
        detail: fmt$(quoteVal) + ' &middot; Sent ' + daysSince + ' days ago',
        type: 'stale_quote',
        jobId: j.id,
        btnLabel: 'Follow Up',
        btnClass: 'outline',
        btnAction: 'openJobQuickView(\'' + j.id + '\')',
      });
    }
  });

  // 7. Other amber attention items from backend
  attentionItems.forEach(function(item) {
    if (item.severity === 'amber' && (item.type || '').indexOf('po') === -1) {
      var existing = action.some(function(a) { return a.title === item.title; });
      if (!existing) {
        action.push({
          title: item.title,
          detail: '',
          type: item.type,
          jobId: (item.job_ids && item.job_ids[0]) || null,
          btnLabel: 'View',
          btnClass: 'outline',
          btnAction: item.job_ids && item.job_ids[0] ? 'openJobQuickView(\'' + item.job_ids[0] + '\')' : '',
        });
      }
    }
  });

  // ── Render ──
  renderTodaySection('todayUrgent', '&#128308; Urgent', 'urgent', urgent);
  renderTodaySection('todayAction', '&#128992; Action Needed', 'action', action);
}

function renderTodaySection(containerId, headerText, cssClass, items) {
  var el = document.getElementById(containerId);
  if (items.length === 0) { el.innerHTML = ''; return; }

  var html = '<div class="today-section-header ' + cssClass + '">' + headerText + ' <span style="font-size:11px;font-weight:400;color:var(--sw-text-sec);">(' + items.length + ')</span></div>';
  items.forEach(function(item) {
    html += '<div class="today-action-card ' + cssClass + '"';
    if (item.jobId) html += ' onclick="openJobQuickView(\'' + item.jobId + '\')"';
    html += '>';
    html += '<div class="today-card-main">';
    html += '<div class="today-card-title">' + item.title + '</div>';
    if (item.detail) html += '<div class="today-card-detail">' + item.detail + '</div>';
    html += '</div>';
    if (item.btnLabel && item.btnAction) {
      html += '<button class="today-card-btn ' + item.btnClass + '" onclick="event.stopPropagation();' + item.btnAction + '">' + item.btnLabel + '</button>';
    }
    html += '</div>';
  });
  el.innerHTML = html;
}

// Legacy — kept for backward compat but no longer rendered as the primary view
function renderAttention(items) {
  var container = document.getElementById('attentionList');
  if (!items || items.length === 0) {
    container.innerHTML = '<div style="padding:12px; color:var(--sw-green); font-size:13px; font-weight:600;">All clear — nothing needs attention</div>';
    // Update tab badge
    var badge = document.getElementById('attentionBadge');
    if (badge) badge.style.display = 'none';
    return;
  }

  // Sort by severity: red first, then amber
  var sorted = items.slice().sort(function(a, b) {
    var rank = { red: 0, amber: 1, blue: 2 };
    return (rank[a.severity] || 2) - (rank[b.severity] || 2);
  });

  // Update tab badge with RED item count
  var redCount = sorted.filter(function(i) { return i.severity === 'red'; }).length;
  var badge = document.getElementById('attentionBadge');
  if (badge) {
    if (redCount > 0) {
      badge.textContent = redCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  var html = '';
  sorted.forEach(function(item) {
    var icon = item.severity === 'red' ? '&#10071;' : '&#9888;';
    var actionFn = '';
    var actionIcon = '&#10148;';
    var title = item.title || '';
    var type = item.type || '';

    // Route action based on attention item type
    if (type === 'stuck_job' && item.job_ids && item.job_ids.length) {
      actionFn = 'onclick="openJobPeek(\'' + item.job_ids[0] + '\')"';
      actionIcon = '&#128269;';
    } else if (type === 'material_conflict' && item.job_ids && item.job_ids.length) {
      actionFn = 'onclick="showView(\'materials\'); openJobPeek(\'' + item.job_ids[0] + '\')"';
      actionIcon = '&#128230;';
    } else if (type === 'scope_pending') {
      actionFn = 'onclick="showView(\'jobs\')"';
      actionIcon = '&#128203;';
    } else if (type === 'scheduling' && item.items && item.items.length) {
      actionFn = 'onclick="showView(\'calendar\'); openAssignmentModal(\'' + item.items[0].id + '\')"';
      actionIcon = '&#128197;';
    } else if (type.indexOf('overdue_invoice') !== -1) {
      actionFn = 'onclick="showView(\'financials\'); showSubTab(\'invoices\')"';
      actionIcon = '&#128176;';
    } else if (type === 'not_invoiced' && item.job_ids && item.job_ids.length) {
      actionFn = 'onclick="openCascadeModal(\'' + item.job_ids[0] + '\')"';
      actionIcon = '&#9989;';
    } else if (type === 'overdue_delivery' || type === 'stuck_draft_po' || type === 'unconfirmed_delivery' || type.indexOf('po') !== -1) {
      actionFn = 'onclick="showView(\'materials\')"';
      actionIcon = '&#128230;';
    } else if (type === 'unsent_wo') {
      actionFn = 'onclick="showView(\'financials\'); showSubTab(\'workorders\')"';
      actionIcon = '&#128221;';
    } else if (type === 'no_trade_rate') {
      actionFn = 'onclick="showView(\'financials\'); showSubTab(\'tradebills\')"';
      actionIcon = '&#128176;';
    } else if (item.job_ids && item.job_ids.length) {
      actionFn = 'onclick="openJobPeek(\'' + item.job_ids[0] + '\')"';
    }

    html += '<div class="attention-item ' + item.severity + '" ' + actionFn + '>' +
      '<span class="attention-icon">' + icon + '</span>' +
      '<span style="flex:1;">' + title + '</span>' +
      (actionFn ? '<button class="attention-action">' + actionIcon + '</button>' : '') +
    '</div>';
  });
  container.innerHTML = html;
}

function renderPipelineOverview(pipeline) {
  if (!pipeline) return;
  var container = document.getElementById('pipelineOverview');
  var html = '';
  var order = ['accepted', 'scheduled', 'in_progress', 'complete', 'invoiced'];
  order.forEach(function(s) {
    html += '<div style="text-align:center; flex:1; min-width:80px;">' +
      '<div style="font-size:24px; font-weight:700; color:' + STATUS_COLORS[s] + '; font-family:var(--sw-font-num);">' + (pipeline[s] || 0) + '</div>' +
      '<div style="font-size:10px; color:var(--sw-text-sec); text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">' + STATUS_LABELS[s] + '</div>' +
    '</div>';
  });
  container.innerHTML = html;
}
