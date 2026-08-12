// ════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════

var cloud = null;
var _swAuthToken = null; // populated from Supabase session

// Get fresh JWT from Supabase session
async function _getAuthToken() {
  try {
    if (window.SECUREWORKS_CLOUD && window.SECUREWORKS_CLOUD.supabase) {
      var res = await window.SECUREWORKS_CLOUD.supabase.auth.getSession();
      var session = res.data && res.data.session;
      if (session && session.access_token) {
        _swAuthToken = session.access_token;
        return session.access_token;
      }
    }
  } catch(e) { /* caller fails closed below */ }
  return null;
}

// Build auth headers from the signed-in Supabase user only.
async function _getAuthHeaders(extra) {
  var token = await _getAuthToken();
  if (!token) throw new Error('Sign in required');
  var h = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
  if (extra) { for (var k in extra) h[k] = extra[k]; }
  return h;
}
var _opsApiBase = window.SUPABASE_URL + '/functions/v1/ops-api';
var _digestBase = window.SUPABASE_URL + '/functions/v1/daily-digest';
var _digestCache = null;
var _digestCacheTime = 0;
var _amberExpanded = false;
var _calView = 'crew'; // 'crew', 'week', or 'month'
var _unschedJobs = []; // Unscheduled jobs for crew sidebar
var _calDate = new Date(); // current focus date for calendar
var _jobView = 'kanban'; // 'kanban' or 'list'
var _jobFilter = 'all'; // 'all', 'fencing', 'patio'
var _jobSearch = '';
var _invFilter = 'ACCREC';
var _invStatusFilter = 'all'; // 'all', 'DRAFT', 'AUTHORISED', 'PAID', 'overdue'
var _poStatusFilter = 'all'; // 'all', 'draft', 'submitted', 'authorised', 'billed'
var _invJobCache = null; // cached job data for invoice modal
var _calEvents = [];
var _calDeliveries = [];
var _pipelineData = null;
var _jobsCache = [];
var _suppliers = [];

// Deterministic crew colour palette (10 distinct colours)
var CREW_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#F97316','#6366F1','#14B8A6'];
function crewColor(name) {
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  return CREW_COLORS[Math.abs(hash) % CREW_COLORS.length];
}

// GHL sub-account ID for "View in GHL" links (visible in your GHL dashboard URL)
var GHL_LOCATION_ID = '13yKADzN94BRxX4hByYX';

var STATUS_LABELS = {
  draft: 'Drafts', quoted: 'Quoted', accepted: 'Accepted', approvals: 'Approvals', deposit: 'Deposit', processing: 'Processing',
  scheduled: 'Scheduled', in_progress: 'In Progress',
  complete: 'Complete', invoiced: 'Invoiced', paid: 'Paid', lost: 'Lost', cancelled: 'Cancelled',
  awaiting_deposit: 'Awaiting Deposit', order_materials: 'Order Materials', awaiting_supplier: 'Awaiting Supplier',
  order_confirmed: 'Order Confirmed', schedule_install: 'Schedule Install', rectification: 'Rectification',
  final_payment: 'Final Payment', get_review: 'Get Review'
};
var STATUS_COLORS = {
  draft: '#8FA4B2', quoted: '#9B59B6', accepted: '#3498DB', approvals: '#1ABC9C', deposit: '#F39C12', processing: '#E74C3C',
  scheduled: '#E67E22', in_progress: '#F15A29',
  complete: '#27AE60', invoiced: '#7F8C8D', cancelled: '#E74C3C', lost: '#95A5A6',
  awaiting_deposit: '#F39C12', order_materials: '#E67E22', awaiting_supplier: '#D35400',
  order_confirmed: '#2980B9', schedule_install: '#8E44AD', rectification: '#C0392B',
  final_payment: '#27AE60', get_review: '#16A085'
};
var _showDrafts = false;
var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Demo mode removed — all data comes from live API

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

function fmt$(n) {
  if (n == null || isNaN(n)) return '$0';
  return '$' + Math.round(Number(n)).toLocaleString();
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function fmtTime(t) {
  if (!t) return '';
  return t.slice(0, 5);
}

// ── Weather (BOM Australia — Perth metro, geohash qd66hrm) ──
var WEATHER_CACHE_KEY = 'sw_weather_cache_bom';
var WEATHER_CACHE_TTL = 3600000; // 1 hour

var weatherData = null;

function bomWeatherIcon(shortText) {
  if (!shortText) return '\uD83C\uDF21';
  var t = shortText.toLowerCase();
  if (t.indexOf('storm') !== -1 || t.indexOf('thunder') !== -1) return '\u26C8';
  if (t.indexOf('heavy rain') !== -1 || t.indexOf('heavy shower') !== -1) return '\uD83C\uDF27\uFE0F';
  if (t.indexOf('rain') !== -1 || t.indexOf('shower') !== -1) return '\uD83C\uDF27';
  if (t.indexOf('drizzle') !== -1) return '\uD83C\uDF26';
  if (t.indexOf('fog') !== -1) return '\uD83C\uDF2B';
  if (t.indexOf('overcast') !== -1 || t.indexOf('cloudy') !== -1) return '\u2601\uFE0F';
  if (t.indexOf('partly') !== -1 || t.indexOf('mostly sunny') !== -1) return '\u26C5';
  if (t.indexOf('clear') !== -1 || t.indexOf('sunny') !== -1) return '\u2600\uFE0F';
  return '\uD83C\uDF24';
}

async function loadWeather() {
  // Check cache
  try {
    var cached = JSON.parse(sessionStorage.getItem(WEATHER_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.ts < WEATHER_CACHE_TTL) {
      weatherData = cached.data;
      renderWeatherBanner();
      return weatherData;
    }
  } catch (e) {}

  try {
    var res = await fetch('https://api.weather.bom.gov.au/v1/locations/qd66hrm/forecasts/daily', {
      headers: { 'Accept': 'application/json' }
    });
    var json = await res.json();

    // Build lookup by date
    var days = {};
    var forecasts = json.data || [];
    for (var i = 0; i < forecasts.length; i++) {
      var fc = forecasts[i];
      var dateStr = (fc.date || '').slice(0, 10);
      if (!dateStr) continue;
      var shortText = fc.short_text || fc.extended_text || '';
      var rainChance = (fc.rain || {}).chance || 0;
      var rainAmount = (fc.rain || {}).amount || {};
      var rainMm = rainAmount.max || rainAmount.min || 0;
      days[dateStr] = {
        date: dateStr,
        icon: bomWeatherIcon(shortText),
        label: shortText,
        max: fc.temp_max != null ? Math.round(fc.temp_max) : null,
        min: fc.temp_min != null ? Math.round(fc.temp_min) : null,
        rain_mm: rainMm,
        rain_pct: rainChance,
        wind_max: null,
      };
    }
    weatherData = days;
    sessionStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: days }));
    renderWeatherBanner();
    return days;
  } catch (e) {
    console.log('[weather] BOM fetch failed, falling back to Open-Meteo:', e.message);
    return loadWeatherFallback();
  }
}

// Fallback to Open-Meteo if BOM is down (CORS issues etc)
async function loadWeatherFallback() {
  try {
    var res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=-31.9505&longitude=115.8605&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max&timezone=Australia%2FPerth&forecast_days=14');
    var json = await res.json();
    var WMO = { 0:'\u2600\uFE0F', 1:'\uD83C\uDF24', 2:'\u26C5', 3:'\u2601\uFE0F', 51:'\uD83C\uDF26', 53:'\uD83C\uDF26', 61:'\uD83C\uDF27', 63:'\uD83C\uDF27', 65:'\uD83C\uDF27', 80:'\uD83C\uDF26', 81:'\uD83C\uDF27', 95:'\u26C8' };
    var days = {};
    var d = json.daily;
    for (var i = 0; i < d.time.length; i++) {
      days[d.time[i]] = {
        date: d.time[i], icon: WMO[d.weather_code[i]] || '\uD83C\uDF21', label: 'Forecast',
        max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]),
        rain_mm: d.precipitation_sum[i], rain_pct: d.precipitation_probability_max[i],
        wind_max: Math.round(d.wind_speed_10m_max[i]),
      };
    }
    weatherData = days;
    sessionStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: days }));
    renderWeatherBanner();
    return days;
  } catch (e2) {
    console.log('[weather] Fallback also failed:', e2.message);
    return null;
  }
}

function getWeatherForDate(dateStr) {
  if (!weatherData || !dateStr) return null;
  return weatherData[dateStr] || null;
}

function weatherBadgeHtml(dateStr, compact) {
  var w = getWeatherForDate(dateStr);
  if (!w || w.max == null) return '';

  var isRainy = w.rain_pct > 40 || w.rain_mm > 2;
  var isHot = w.max >= 38;
  var borderColor = isRainy ? '#e74c3c' : isHot ? '#F15A29' : '#4C6A7C';
  var tempStr = w.max + '\u00B0' + (w.min != null ? '/' + w.min + '\u00B0' : '');
  var windStr = w.wind_max != null ? ' | Wind: ' + w.wind_max + 'km/h' : '';

  if (compact) {
    return '<span class="weather-badge-compact" title="' + w.label + ' ' + tempStr + ' | Rain: ' + (w.rain_pct || 0) + '% (' + (w.rain_mm || 0) + 'mm)' + windStr + '">' + w.icon + ' ' + w.max + '\u00B0</span>';
  }

  return '<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:6px;border:1px solid ' + borderColor + '20;background:' + borderColor + '08;font-size:0.82rem;color:#293C46">'
    + '<span style="font-size:1.1rem">' + w.icon + '</span>'
    + '<span><b>' + w.max + '\u00B0</b>/' + w.min + '\u00B0</span>'
    + (w.rain_pct > 0 ? '<span style="color:' + (isRainy ? '#e74c3c' : '#4C6A7C') + '">\uD83D\uDCA7' + w.rain_pct + '%</span>' : '')
    + (w.wind_max > 40 ? '<span style="color:#F15A29">\uD83D\uDCA8' + w.wind_max + 'km/h</span>' : '')
    + '</div>';
}

function renderWeatherBanner() {
  var banner = document.getElementById('weatherBanner');
  if (!banner) return;
  var today = new Date().toISOString().slice(0, 10);
  var w = getWeatherForDate(today);
  if (!w) { banner.style.display = 'none'; return; }

  var isRainy = w.rain_pct > 60 || w.rain_mm > 5;
  var isHot = w.max >= 40;
  var isWindy = w.wind_max >= 60;

  var bgColor, borderCol, msg;
  if (isRainy) {
    bgColor = '#fef2f2'; borderCol = '#e74c3c';
    msg = '\u26A0 Rain expected \u2014 check outdoor jobs';
  } else if (isHot) {
    bgColor = '#fff7ed'; borderCol = '#F15A29';
    msg = '\uD83D\uDD25 Extreme heat \u2014 ensure crew has water & shade breaks';
  } else if (isWindy) {
    bgColor = '#fff7ed'; borderCol = '#F15A29';
    msg = '\uD83D\uDCA8 High winds \u2014 check scaffolding & roof sheet safety';
  } else {
    bgColor = '#f0f7ff'; borderCol = '#4C6A7C';
    msg = '';
  }

  var html = '<div class="weather-banner" style="background:' + bgColor + ';border:1px solid ' + borderCol + '30;border-left:3px solid ' + borderCol + ';border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
  html += '<span style="font-size:1.3rem;">' + w.icon + '</span>';
  html += '<span style="font-weight:600;color:#293C46;">' + w.label + '</span>';
  html += '<span style="font-family:var(--sw-font-num,monospace);color:#293C46;"><b>' + w.max + '\u00B0</b> / ' + w.min + '\u00B0</span>';
  html += '<span style="color:#4C6A7C;font-size:0.85rem;">\uD83D\uDCA7 ' + w.rain_pct + '% (' + w.rain_mm + 'mm)</span>';
  html += '<span style="color:#4C6A7C;font-size:0.85rem;">\uD83D\uDCA8 ' + w.wind_max + ' km/h</span>';
  if (msg) {
    html += '<span style="flex-basis:100%;font-size:0.82rem;font-weight:600;color:' + borderCol + ';">' + msg + '</span>';
  }
  html += '</div>';
  banner.innerHTML = html;
  banner.style.display = 'block';

  // Also re-render calendar if it's visible, to add weather badges
  if (document.getElementById('viewCalendar') && document.getElementById('viewCalendar').classList.contains('active')) {
    renderCalendar();
  }
}

async function opsFetch(action, params) {
  var url = _opsApiBase + '?action=' + action;
  if (params) {
    Object.keys(params).forEach(function(k) {
      if (params[k] != null) url += '&' + k + '=' + encodeURIComponent(params[k]);
    });
  }
  var headers = await _getAuthHeaders();
  return fetch(url, { headers: headers }).then(function(resp) {
    if (resp.status === 401) {
      console.error('[ops] 401 on ' + action + ' — auth headers:', Object.keys(headers).join(','));
      throw new Error('Unauthorized — check API key');
    }
    if (!resp.ok) throw new Error('API error: ' + resp.status);
    return resp.json();
  });
}

async function opsPost(action, body) {
  body = Object.assign({}, body, { operator_email: (cloud && cloud.user && cloud.user.email) || null });
  var headers = await _getAuthHeaders();
  return fetch(_opsApiBase + '?action=' + action, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
  }).then(function(resp) {
    if (!resp.ok) {
      return resp.json().catch(function() { return {}; }).then(function(err) {
        throw new Error(err.error || 'API error: ' + resp.status);
      });
    }
    return resp.json();
  });
}

// ════════════════════════════════════════════════════════════
// AI ANNOTATIONS ENGINE
// ════════════════════════════════════════════════════════════

var _annotationCache = {};       // key: 'global' or 'job:{id}' → { data, ts }
var _activePopover = null;       // current popover element
var _currentJobAnnotations = []; // annotations for open job
var _dismissLog = [];            // timestamps of recent dismissals (fatigue prevention)
var _inlineSuppressedUntil = 0;  // timestamp: suppress inline dots until this time

// 1. Fetch annotations (cached per scope)
async function loadAnnotations(scope, entityType, entityId) {
  var cacheKey = scope === 'entity' ? entityType + ':' + entityId : 'global';
  var ttl = scope === 'entity' ? 5 * 60 * 1000 : 15 * 60 * 1000;
  var cached = _annotationCache[cacheKey];
  if (cached && Date.now() - cached.ts < ttl) return cached.data;

  try {
    var params = { scope: scope };
    if (entityType) params.entity_type = entityType;
    if (entityId) params.entity_id = entityId;
    var resp = await opsFetch('annotations', params);
    var annotations = resp.annotations || [];
    _annotationCache[cacheKey] = { data: annotations, ts: Date.now() };
    return annotations;
  } catch (e) {
    console.error('[annotations] load error:', e);
    return [];
  }
}

// 2. Render annotation dots into a container
function renderAnnotationDots(annotations, uiLocation, container) {
  if (!annotations || !annotations.length || !container) return;
  // Fatigue prevention: suppress inline dots during cooldown (Inbox still shows all)
  if (_inlineSuppressedUntil > Date.now()) return;
  var filtered = annotations.filter(function(a) { return !uiLocation || a.ui_location === uiLocation || a.effective_priority >= 80; });
  if (!filtered.length) return;

  var dotContainer = document.createElement('div');
  dotContainer.style.cssText = 'display:flex;align-items:center;gap:4px;margin:6px 0;';

  if (filtered.length <= 3) {
    filtered.forEach(function(ann) {
      var dot = document.createElement('span');
      dot.className = 'ai-dot ai-dot-' + getSeverityClass(ann) + ' ai-dot-pulse';
      dot.title = ann.title;
      dot.onclick = function(e) { e.stopPropagation(); openAnnotationPopover([ann], null, dot); };
      dotContainer.appendChild(dot);
    });
  } else {
    var dot = document.createElement('span');
    dot.className = 'ai-dot ai-dot-badge ai-dot-amber ai-dot-pulse';
    dot.textContent = filtered.length;
    dot.title = filtered.length + ' annotations';
    dot.onclick = function(e) { e.stopPropagation(); openAnnotationPopover(filtered, null, dot); };
    dotContainer.appendChild(dot);
  }

  container.insertBefore(dotContainer, container.firstChild);
}

function getSeverityClass(ann) {
  if (ann.category === 'learning') return 'learning';
  if (ann.severity === 'red' || ann.severity === 'amber') return ann.severity;
  return 'info';
}

// 3. Open popover anchored to a dot
function openAnnotationPopover(annotations, overflow, anchorEl) {
  closeAnnotationPopover();
  if (!annotations.length) return;

  var pop = document.createElement('div');
  pop.className = 'ai-popover';

  annotations.forEach(function(ann) {
    var item = document.createElement('div');
    item.className = 'ai-popover-item';
    item.id = 'ann-item-' + ann.id;

    var titleHtml = '<div class="ann-title">' + escapeHtml(ann.title) + '</div>';
    var bodyHtml = ann.body ? '<div class="ann-body">' + escapeHtml(ann.body) + '</div>' : '';
    var meta = '<div class="ann-meta">';
    meta += '<span style="text-transform:capitalize;">' + (ann.category || '') + '</span>';
    if (ann.confidence) meta += '<span>' + Math.round(ann.confidence * 100) + '% conf</span>';
    var age = getAnnotationAge(ann.created_at);
    if (age) meta += '<span>' + age + '</span>';
    meta += '</div>';

    var actionsHtml = renderAnnotationResponse(ann);
    item.innerHTML = titleHtml + bodyHtml + meta + actionsHtml;
    pop.appendChild(item);
  });

  // Position relative to anchor
  document.body.appendChild(pop);
  _activePopover = pop;
  positionPopover(pop, anchorEl);

  // Close on outside click (delay to avoid immediate close)
  setTimeout(function() {
    document.addEventListener('click', _popoverOutsideClick);
  }, 50);
}

function _popoverOutsideClick(e) {
  if (_activePopover && !_activePopover.contains(e.target)) {
    closeAnnotationPopover();
  }
}

function positionPopover(pop, anchor) {
  var rect = anchor.getBoundingClientRect();
  var popH = pop.offsetHeight;
  var spaceBelow = window.innerHeight - rect.bottom - 16;

  if (spaceBelow >= popH || spaceBelow > rect.top) {
    pop.style.top = (rect.bottom + 6) + 'px';
  } else {
    pop.style.top = Math.max(8, rect.top - popH - 6) + 'px';
  }

  var left = Math.min(rect.left, window.innerWidth - 316);
  pop.style.left = Math.max(8, left) + 'px';
}

// 4. Close popover
function closeAnnotationPopover() {
  if (_activePopover) {
    _activePopover.remove();
    _activePopover = null;
  }
  document.removeEventListener('click', _popoverOutsideClick);
}

// 5. Resolve annotation
async function resolveAnnotation(annotationId, responseValue, responseText) {
  try {
    var resp = await opsPost('resolve_annotation', {
      annotation_id: annotationId,
      response_value: responseValue,
      response_text: responseText || null,
    });

    // Fatigue prevention: track dismissals, suppress inline after 3 in 30min
    if (responseValue === 'dismiss') {
      var thirtyMinAgo = Date.now() - 30 * 60 * 1000;
      _dismissLog = _dismissLog.filter(function(ts) { return ts > thirtyMinAgo; });
      _dismissLog.push(Date.now());
      if (_dismissLog.length >= 3) {
        _inlineSuppressedUntil = Date.now() + 30 * 60 * 1000;
        console.log('[annotations] Inline dots suppressed for 30min after 3 dismissals');
      }
    }

    // Remove from cache
    Object.keys(_annotationCache).forEach(function(k) {
      if (_annotationCache[k] && _annotationCache[k].data) {
        _annotationCache[k].data = _annotationCache[k].data.filter(function(a) { return a.id !== annotationId; });
      }
    });
    _currentJobAnnotations = _currentJobAnnotations.filter(function(a) { return a.id !== annotationId; });

    // Fade out the item or close popover
    var item = document.getElementById('ann-item-' + annotationId);
    if (item) {
      item.style.transition = 'opacity 0.3s'; item.style.opacity = '0';
      setTimeout(function() {
        item.remove();
        if (_activePopover && !_activePopover.querySelector('.ai-popover-item')) closeAnnotationPopover();
      }, 300);
    }

    // Handle action responses
    if (resp.action) {
      closeAnnotationPopover();
      if (resp.action.action === 'open_po_modal' && resp.action.job_id) {
        openPOModal(resp.action.job_id);
      } else if (resp.action.action === 'open_invoice_modal' && resp.action.job_id) {
        openJobDetail(resp.action.job_id);
        setTimeout(function() { showJobSubView('money'); }, 500);
      } else if (resp.action.action === 'open_comms_tab' && resp.action.job_id) {
        openJobDetail(resp.action.job_id);
        setTimeout(function() { showJobSubView('comms'); }, 500);
      } else if (resp.action.action === 'send_payment_reminder') {
        if (resp.action.job_id) {
          openJobDetail(resp.action.job_id);
          setTimeout(function() { showJobSubView('comms'); }, 500);
        }
      }
    }

    // Refresh inbox badge
    refreshInboxBadge();
    return resp;
  } catch (e) {
    console.error('[annotations] resolve error:', e);
    alert('Failed to resolve: ' + e.message);
  }
}

// 6. Render response buttons
function renderAnnotationResponse(ann) {
  if (ann.response_type === 'dismiss') {
    return '<div class="ann-actions"><button class="ai-popover-btn ai-popover-btn-ghost" onclick="resolveAnnotation(\'' + ann.id + '\',\'dismiss\')">Dismiss</button></div>';
  }

  var html = '';
  if (ann.response_type === 'input') {
    html += '<input class="ai-popover-input" id="ann-input-' + ann.id + '" placeholder="Add context...">';
  }

  html += '<div class="ann-actions">';
  (ann.response_options || []).forEach(function(opt) {
    var btnClass = 'ai-popover-btn ai-popover-btn-' + (opt.style || 'secondary');
    var onclick;
    if (ann.response_type === 'input' && opt.value !== 'dismiss') {
      onclick = 'resolveAnnotation(\'' + ann.id + '\',\'' + opt.value + '\',document.getElementById(\'ann-input-' + ann.id + '\').value)';
    } else {
      onclick = 'resolveAnnotation(\'' + ann.id + '\',\'' + opt.value + '\')';
    }
    html += '<button class="' + btnClass + '" onclick="' + onclick + '">' + escapeHtml(opt.label || opt.value) + '</button>';
  });
  html += '</div>';
  return html;
}

// Helper: human-readable age
function getAnnotationAge(dateStr) {
  if (!dateStr) return '';
  var mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

// ── Inbox Tab ──
var _inboxFilter = 'all';

async function loadInbox() {
  var list = document.getElementById('inboxList');
  if (!list) return;
  list.innerHTML = '<div class="loading" style="padding:12px;">Loading annotations...</div>';

  var annotations = await loadAnnotations('global');
  renderInboxList(annotations);
  refreshInboxBadge();
}

function filterInbox(category) {
  _inboxFilter = category;
  document.querySelectorAll('.inbox-chip').forEach(function(c) { c.classList.remove('active'); });
  event.target.classList.add('active');
  var cached = _annotationCache['global'];
  if (cached) renderInboxList(cached.data);
}

function renderInboxList(annotations) {
  var list = document.getElementById('inboxList');
  if (!list) return;

  var filtered = annotations;
  if (_inboxFilter !== 'all') {
    filtered = annotations.filter(function(a) { return a.category === _inboxFilter; });
  }

  if (!filtered.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--sw-text-sec);font-size:13px;">No annotations' + (_inboxFilter !== 'all' ? ' in ' + _inboxFilter : '') + '</div>';
    return;
  }

  var html = '';
  filtered.slice(0, 30).forEach(function(ann) {
    var borderClass = 'inbox-card inbox-card-' + getSeverityClass(ann);
    html += '<div class="' + borderClass + '" id="inbox-ann-' + ann.id + '">';
    html += '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px;">';
    html += '<div style="font-weight:600;font-size:13px;color:var(--sw-dark);">' + escapeHtml(ann.title) + '</div>';
    html += '<span style="font-size:10px;color:var(--sw-text-sec);white-space:nowrap;margin-left:8px;">' + getAnnotationAge(ann.created_at) + '</span>';
    html += '</div>';

    if (ann.body) html += '<div style="font-size:11px;color:var(--sw-text-sec);margin-bottom:6px;line-height:1.4;">' + escapeHtml(ann.body) + '</div>';

    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
    html += '<span style="font-size:10px;padding:2px 8px;background:var(--sw-light);color:var(--sw-mid);font-weight:600;text-transform:capitalize;">' + (ann.category || '') + '</span>';
    if (ann.entity_type === 'job' && ann.entity_id) {
      html += '<a href="#" onclick="event.preventDefault();closeAnnotationPopover();openJobDetail(\'' + ann.entity_id + '\')" style="font-size:10px;color:var(--sw-mid);">Open Job &#8599;</a>';
    }
    html += '</div>';

    html += renderAnnotationResponse(ann);
    html += '</div>';
  });

  if (filtered.length > 30) {
    html += '<div style="padding:12px;text-align:center;font-size:12px;color:var(--sw-text-sec);">' + (filtered.length - 30) + ' more annotations</div>';
  }

  list.innerHTML = html;
}

async function refreshInboxBadge() {
  try {
    var anns = await loadAnnotations('global');
    var count = anns.filter(function(a) { return (a.effective_priority || a.priority) >= 50; }).length;
    var badge = document.getElementById('inboxBadge');
    var badgeMobile = document.getElementById('inboxBadgeMobile');
    if (badge) { badge.textContent = count || ''; badge.style.display = count > 0 ? 'inline' : 'none'; }
    if (badgeMobile) { badgeMobile.textContent = count || ''; badgeMobile.style.display = count > 0 ? 'inline' : 'none'; }
  } catch (e) { /* non-critical */ }
}

// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// CREW LIST — cached from list_users
// ════════════════════════════════════════════════════════════

var _crewList = [];  // [{ id, name, email, role, division }]

// Map email prefixes / raw crew_name values to clean first names
var CREW_NAME_MAP = {
  'isaac.b3lch3r': 'Isaac',
  'khairopomare': 'Khairo',
  'marninms98': 'Marnin',
  'shaunlee': 'Shaun',
  'shaun': 'Shaun',
  'brotheremeka': 'Henry',
  'ryanhumphries2002': 'Ryan',
  'nithin': 'Nithin',
};

function cleanCrewName(name) {
  if (!name) return name;
  var key = name.toLowerCase().replace(/\s/g, '');
  return CREW_NAME_MAP[key] || name;
}

async function loadCrewList() {
  if (_crewList.length > 0) return;
  try {
    var data = await opsFetch('list_users');
    // Hide duplicate/invalid users by email prefix
    var CREW_HIDE = ['isaac']; // hide the non-real Isaac (isaac.b3lch3r is the real one)
    _crewList = (data.users || []).filter(function(u) {
      var prefix = u.email ? u.email.split('@')[0].toLowerCase() : '';
      return !CREW_HIDE.some(function(h) { return prefix === h; });
    }).map(function(u) {
      var div = '';
      if (u.role === 'installer' || u.role === 'lead_installer') div = 'trade';
      if (u.email && u.email.indexOf('fenc') !== -1) div = 'fencing';
      var rawName = u.name || u.email.split('@')[0];
      var displayName = cleanCrewName(rawName);
      return { id: u.id, name: displayName, email: u.email, role: u.role || '', division: div };
    }).sort(function(a, b) { return a.name.localeCompare(b.name); });
  } catch (e) {
    console.warn('Failed to load crew list:', e);
  }
}

function renderCrewDropdown(selectId, selectedUserId) {
  var html = '<select class="form-input" id="' + selectId + '" style="width:100%">';
  html += '<option value="">Select crew member...</option>';
  _crewList.forEach(function(u) {
    var sel = u.id === selectedUserId ? ' selected' : '';
    var label = u.name;
    if (u.role && u.role !== 'estimator') label += ' (' + u.role.replace(/_/g, ' ') + ')';
    html += '<option value="' + u.id + '" data-name="' + u.name.replace(/"/g, '&quot;') + '">' + label + '</option>';
  });
  html += '</select>';
  return html;
}

function renderMemberCheckboxes(excludeUserId) {
  var html = '';
  _crewList.forEach(function(u) {
    if (u.id === excludeUserId) return; // don't show the lead as a member option
    var label = u.name;
    if (u.role && u.role !== 'estimator') label += ' (' + u.role.replace(/_/g, ' ') + ')';
    html += '<label style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--sw-light);border:1px solid var(--sw-border);border-radius:6px;font-size:12px;cursor:pointer;user-select:none;">';
    html += '<input type="checkbox" class="assign-member-cb" value="' + u.id + '" data-name="' + u.name.replace(/"/g, '&quot;') + '"> ' + label;
    html += '</label>';
  });
  return html || '<span style="font-size:12px;color:var(--sw-text-sec);">No crew members loaded</span>';
}

function getCrewSelectName(selectId) {
  var sel = document.getElementById(selectId);
  if (!sel || !sel.value) return null;
  var opt = sel.options[sel.selectedIndex];
  return opt ? opt.getAttribute('data-name') : null;
}

function getCrewSelectId(selectId) {
  var sel = document.getElementById(selectId);
  return sel ? sel.value : null;
}

// VIEW SWITCHING
