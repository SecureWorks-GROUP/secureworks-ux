// Group work orders on the weekly invoice. A group job shows its panel inside
// its own job card; a group with no card this week keeps a compact card in the
// group section. Crew see each other's hours, never rates or pay. A member
// logs their own hours for any day here, through the same group hours action
// the job page uses. The client signs on site; then the share unlocks. Server
// owns prices and gates. A failed group read only holds the group jobs: the
// trade's ordinary jobs can still be invoiced.
(function () {
  'use strict';
  var options = {}, submitted = {};
  var api, changed, owner = '', state = 'idle', loaded = false, groups = [], jobIds = [], payableRoutes = [], selected = {}, busy = '', generation = 0, sign = null;
  // Jobs my_hours says are paid through a group (with their booked days), and
  // the hours a trade is typing per group, kept across re-renders.
  var routeJobs = [], hoursDraft = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(n) { return Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function hrs(n) { var v = Number(n); return n != null && n !== '' && isFinite(v) ? (Math.round(v * 100) / 100) + 'h' : '–'; }
  function find(id) { return groups.find(function(g) { return g.group_id === id; }); }
  function say(msg, isError) { var fn = typeof options.toast === 'function' ? options.toast : window.toast; if (typeof fn === 'function') fn(msg, isError); }
  function use(transport, onChange, userId, config) {
    api = transport; changed = onChange; options = config || {};
    if (owner !== String(userId || '')) { owner = String(userId || ''); reset(); }
  }
  function reset() {
    generation++; state = 'idle'; loaded = false; groups = []; jobIds = []; payableRoutes = []; selected = {}; busy = ''; sign = null; routeJobs = []; hoursDraft = {};
    var open = document.querySelectorAll('dialog[data-group-sign-dialog],dialog[data-group-status-dialog]');
    for (var i = 0; i < open.length; i++) if (open[i].open) open[i].close();
  }
  function load(force) {
    if (!api || state === 'loading' || (!force && state !== 'idle')) return;
    var seq = ++generation; state = 'loading';
    api('my_group_work_orders').then(function(res) {
      if (seq !== generation) return;
      if (!res || !Array.isArray(res.groups)) throw new Error('Group work orders could not be checked.');
      groups = res.groups;
      payableRoutes = Array.isArray(res.payable_routes) ? res.payable_routes : [];
      jobIds = (res.group_job_ids || []).concat(groups.map(function(g) { return g.job_id; }))
        .concat(payableRoutes.filter(function(r) { return r.route === 'group_setup_required'; }).map(function(r) { return r.job_id; }));
      state = 'ready'; loaded = true;
      Object.keys(selected).forEach(function(id) { if (!groups.some(function(g) { return g.group_id === id && selectable(g); })) delete selected[id]; });
      changed();
    }).catch(function() { if (seq === generation) { state = 'error'; changed(); } });
  }
  function isGroupJob(id) {
    if (id == null) return false;
    return jobIds.some(function(jobId) { return String(jobId) === String(id); })
      || routeJobs.some(function(r) { return String(r.job_id) === String(id); });
  }
  function setRouteJobs(list) { routeJobs = Array.isArray(list) ? list.filter(function(r) { return r && r.job_id != null; }) : []; }
  function routeJob(jobId) { return routeJobs.find(function(r) { return String(r.job_id) === String(jobId); }) || null; }
  function settled() { return state === 'ready' || state === 'error'; }
  function allInBasis(g) { return g.pay_basis === 'all_in_12_6_v1' || g.pay_basis === 'all_in_12_v2'; }

  // The crew approve each other's hours; the client (or the office) signs.
  function crewHours(g) { return Array.isArray(g.crew_hours) ? g.crew_hours.filter(function(c) { return c && c.name; }) : []; }
  function asksApproval(g) { return g.crew_approval_required === true || g.awaiting === 'awaiting_crew_approval'; }
  function approvedRow(g, c) { return c.me && g.my_hours_approved != null ? g.my_hours_approved === true : c.approved === true; }
  function hoursOk(g) {
    if (g.awaiting === 'awaiting_crew_approval') return false;
    if (!asksApproval(g)) return true;
    var crew = crewHours(g);
    return crew.length > 0 && crew.every(function(c) { return approvedRow(g, c); });
  }
  function signed(g) { return g.client_signed === true; }
  function unlocked(g) { return signed(g) && hoursOk(g); }
  function myTurn(g) { return !g.submitted && asksApproval(g) && g.my_hours_approved !== true && g.awaiting !== 'needs_hours' && g.awaiting !== 'needs_join'; }
  function selectable(g) { return !g.submitted && !allInBasis(g) && g.awaiting === 'frozen' && unlocked(g) && Number(g.my_share) > 0; }
  function signoff(g) {
    var s = g.client_signoff;
    if (s && typeof s === 'object') return { kind: s.kind === 'office' ? 'office' : 'client', name: s.name || '', at: s.at || '', happy: s.happy };
    if (!signed(g)) return null;
    return { kind: g.release && g.release.signoff === 'office' ? 'office' : 'client', name: '', at: '', happy: null };
  }
  function when(at) {
    var d = new Date(at);
    if (!at || isNaN(d.getTime())) return '';
    try {
      var p = {};
      new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
        .formatToParts(d).forEach(function(x) { p[x.type] = x.value; });
      return p.weekday + ' ' + p.day + ' ' + p.month + ', ' + p.hour + ':' + p.minute + String(p.dayPeriod || '').toLowerCase().replace(/[^a-z]/g, '');
    } catch (e) { return d.toLocaleString('en-AU'); }
  }

  // A submitted share never rides on another invoice, even from a restored draft.
  function items() { if (state !== 'ready') return []; return groups.filter(function(g) { return selected[g.group_id] && selectable(g); }).map(function(g) {
    return { type: 'group share', group_id: g.group_id, job_id: g.job_id, job_number: g.job_number, quantity: 1, rate: Number(g.my_share) };
  }); }
  function selectedIds() { return Object.keys(selected).filter(function(id) { return selected[id]; }); }
  function restore(ids) { selected = {}; (ids || []).forEach(function(id) { selected[String(id)] = true; }); }
  function total() { return Math.round(items().reduce(function(n,g) { return n + g.rate; },0) * 100) / 100; }

  var CSS = ''
    + '.gw-card{background:var(--sw-card);border:1px solid var(--sw-border);border-radius:10px;padding:12px;margin:0 0 8px;font-size:14px}'
    + '.gw-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}'
    + '.gw-head>div{min-width:0}'
    + '.gw-title{font-weight:700;font-size:14px;line-height:1.3;color:var(--sw-dark)}'
    + '.gw-meta{font-size:12px;color:var(--sw-text-sec);margin-top:2px}'
    + '.gw-pill{flex:none;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}'
    + '.gw-sec{margin-top:16px}'
    + '.gw-label{font-family:var(--sw-mono);font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--sw-mid);margin:0 0 4px}'
    + '.gw-crewrow{display:grid;grid-template-columns:minmax(0,1fr) auto 92px;gap:10px;align-items:center;min-height:38px;border-bottom:1px solid var(--sw-border)}'
    + '.gw-crewrow.plain{grid-template-columns:minmax(0,1fr) auto}'
    + '.gw-crewrow:last-child{border-bottom:0}'
    + '.gw-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sw-text)}'
    + '.gw-name small{font-size:12px;color:var(--sw-text-sec)}'
    + '.gw-hrs{font-family:var(--sw-mono);font-weight:600;text-align:right;color:var(--sw-text)}'
    + '.gw-tag{justify-self:end}'
    + '.gw-line{display:flex;justify-content:space-between;align-items:center;gap:10px;min-height:30px;color:var(--sw-text)}'
    + '.gw-signed{padding:10px 12px;border-radius:10px;background:#E8F6EE;border:1px solid rgba(39,174,96,.35)}'
    + '.gw-signed b{display:block;color:#1E8A4C;font-size:15px;font-weight:800}'
    + '.gw-sub{font-size:12px;color:var(--sw-text-sec);margin-top:2px}'
    + '.gw-hint{margin-top:6px}'
    + '.gw-locked{font-size:13px;color:var(--sw-text-sec)}'
    + '.gw-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0;color:var(--sw-text-sec)}'
    + '.gw-row b{font-family:var(--sw-mono);font-weight:600;color:var(--sw-text);white-space:nowrap}'
    + '.gw-row.gw-total{color:var(--sw-text);font-weight:700;font-size:15px;padding-bottom:4px}'
    + '.gw-row.gw-total b{font-size:16px}'
    + '.gw-note{font-size:12px;color:var(--sw-text-sec);margin-top:8px}'
    + '.gw-crew{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:var(--sw-text-sec)}'
    + '.gw-dots{display:flex;gap:4px}.gw-dot{width:9px;height:9px;border-radius:50%;background:var(--sw-line-2)}'
    + '.gw-dot.ok{background:#27AE60}.gw-dot.wait{background:#E67E22}'
    + '.gw-btn{width:100%;margin-top:10px}'
    + '.gw-links{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px}'
    + '.gw-link{background:none;border:0;padding:6px 0;font:inherit;font-size:13px;font-weight:600;color:var(--sw-orange-deep,#C7431B);cursor:pointer}'
    + '.gw-dialog{border:0;border-radius:16px;padding:16px;width:min(92vw,420px);color:var(--sw-text);background:var(--sw-card)}'
    + '.gw-dialog::backdrop{background:rgba(20,28,33,.55)}'
    + '.gw-dialog.gw-sheet{width:100%;max-width:480px;max-height:96dvh;margin:auto auto 0;border-radius:18px 18px 0 0;overflow:auto;padding:16px 16px calc(16px + env(safe-area-inset-bottom))}'
    + '.gw-sheet-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px}'
    + '.gw-sheet-title{font-size:18px;font-weight:800;color:var(--sw-dark)}'
    + '.gw-x{flex:none;width:36px;height:36px;border:0;border-radius:50%;background:var(--sw-seg-bg,#E8EDEF);color:var(--sw-dark);font-size:15px;cursor:pointer}'
    + '.gw-rate{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--sw-text)}'
    + '.gw-stars{display:flex;flex:none}'
    + '.gw-stars button{width:34px;height:34px;border:0;background:none;padding:0;font-size:24px;line-height:1;color:var(--sw-line-2);cursor:pointer}'
    + '.gw-stars button.on{color:#F2A93B}'
    + '.gw-field{display:block;width:100%;padding:9px 10px;border:1px solid var(--sw-border);border-radius:10px;font:inherit;font-size:16px;color:var(--sw-text);background:var(--sw-card);box-sizing:border-box}'
    + 'textarea.gw-field{resize:vertical;min-height:58px}'
    + '.gw-labrow{display:flex;justify-content:space-between;align-items:center}'
    + '.gw-labrow .gw-link{padding:0;font-size:12px}'
    + '.gw-pad{position:relative;height:120px;border:1px dashed var(--sw-line-2);border-radius:10px;overflow:hidden;background:#fff}'
    + '.gw-pad canvas{display:block;width:100%;height:100%;touch-action:none}'
    + '.gw-pad span{position:absolute;inset:0;display:grid;place-items:center;font-size:13px;color:var(--sw-text-sec);pointer-events:none}'
    + '.gw-pad.drawn span{display:none}'
    + '.gw-err{margin-top:8px;font-size:13px;font-weight:600;color:var(--sw-red,#E74C3C)}'
    + '.gw-hours{margin-top:10px;padding:10px;border:1px solid var(--sw-border);border-radius:10px;background:var(--sw-bg,#F6F8F9)}'
    + '.gw-hgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}'
    + '.gw-hgrid label{font-size:12px;font-weight:600;color:var(--sw-mid)}'
    + '.gw-hgrid .gw-field{margin-top:3px}'
    + '.gw-hgrid .gw-wide{grid-column:1/-1}'
    + '.gw-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}'
    + '.gw-chip{border:1px solid var(--sw-border);background:var(--sw-card);border-radius:999px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer;color:var(--sw-text)}'
    + '.gw-chip.on{border-color:var(--sw-orange-deep,#C7431B);color:var(--sw-orange-deep,#C7431B);font-weight:700}'
    + '.gw-ok{margin-top:8px;font-size:13px;font-weight:600;color:#1E8A4C}';
  function ensureCss() {
    if (document.querySelector('style[data-gw-style]')) return;
    var style = document.createElement('style');
    style.setAttribute('data-gw-style', '');
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  // Dialogs live on <body> so a builder re-render never wipes a signature.
  function dialogEl(attr, cls) {
    ensureCss();
    var d = document.querySelector('dialog[' + attr + ']');
    if (!d) { d = document.createElement('dialog'); d.setAttribute(attr, ''); document.body.appendChild(d); }
    d.className = 'gw-dialog' + (cls ? ' ' + cls : '');
    return d;
  }
  function show(d) { if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', ''); }

  // Crew states mean the share was submitted, not office approval. Release
  // sends the crew's bills for payment together; it is not "paid".
  var STATE_WORDS = {not_invoiced:'Not yet', submitted:'Submitted', approved:'Submitted', queried:'Queried by office', rejected:'Sent back', released:'Sent for payment', no_share:'No share', duplicate:'Office check', mismatch:'Office check'};
  var STATE_TONE = {not_invoiced:'no', submitted:'info', approved:'info', queried:'wait', rejected:'bad', released:'ok'};
  var TONES = {ok:'background:#E8F6EE;color:#1E8A4C', wait:'background:#FDF1E5;color:#B9631A', no:'background:#EEF1F3;color:#5C7683', bad:'background:#FDECEA;color:#C0392B', info:'background:#EAF4FB;color:#2471A3'};
  function pill(text, tone, attr) { return '<span class="gw-pill" '+(attr||'')+' style="'+(TONES[tone]||TONES.no)+'">'+esc(text)+'</span>'; }
  function row(attr, label, amount, cls) { return '<div class="gw-row'+(cls ? ' '+cls : '')+'" '+attr+'><span>'+esc(label)+'</span><b>$'+money(amount)+'</b></div>'; }
  function superLabel(g) { return g.pay_basis === 'all_in_12_v2' ? 'Super 12%, paid by us' : 'Super'; }
  // One short status word per card.
  function headPill(g) {
    var r = g.release || {}, s = g.submitted;
    if (s) {
      if (r.released) return pill('Sent for payment','ok','data-group-pill');
      if (s.review === 'queried') return pill('Queried','wait','data-group-pill');
      if (s.review === 'rejected') return pill('Sent back','bad','data-group-pill');
      return pill('Submitted','info','data-group-pill');
    }
    if (g.awaiting === 'needs_join') return pill('Join to invoice','info','data-group-pill');
    if (myTurn(g)) return pill('Confirm hours','wait','data-group-pill');
    if (!signed(g) && g.awaiting !== 'needs_hours') return pill('Needs sign-off','wait','data-group-pill');
    if (!hoursOk(g)) return pill('Waiting on crew','no','data-group-pill');
    if (g.awaiting === 'frozen') return pill('Ready to invoice','ok','data-group-pill');
    if (g.awaiting === 'ready') return pill('Ready to finalise','info','data-group-pill');
    return pill('In progress','no','data-group-pill');
  }
  function crewLine(g) {
    var crew = Array.isArray(g.crew_status) ? g.crew_status : [], r = g.release || {};
    if (!crew.length) return '';
    var dots = crew.map(function(c) {
      var cls = ['submitted','approved','released'].indexOf(c.state) !== -1 ? 'ok' : ['queried','rejected'].indexOf(c.state) !== -1 ? 'wait' : '';
      return '<span class="gw-dot '+cls+'"></span>';
    }).join('');
    var all = Number(r.total || crew.length);
    var text = r.released ? 'All '+all+' in · sent for payment together' : Number(r.invoiced || 0)+' of '+all+' in · sent for payment when all are in';
    return '<div class="gw-crew" data-group-release="'+(r.released ? 'released' : 'held')+'"><span class="gw-dots">'+dots+'</span><span>'+esc(text)+'</span></div>';
  }
  function moneyBlock(g) {
    var budget = g.my_budget != null ? g.my_budget : g.projected_my_budget;
    var cash = g.my_cash_pay != null ? g.my_cash_pay : g.projected_cash_pay;
    var superPay = g.my_super != null ? g.my_super : g.projected_super;
    if (budget == null || cash == null || superPay == null) return '';
    return '<div class="gw-money">'+row('data-group-allocation','Your share',budget,'gw-total')+row('data-group-pay','Pay',cash)+row('data-group-super',superLabel(g),superPay)+'</div>';
  }
  function head(g) {
    return '<div class="gw-head"><div><div class="gw-title">'+esc(g.job_number)+(g.client_name ? ' · '+esc(g.client_name) : '')+'</div>'
      + '<div class="gw-meta">'+esc(g.site_suburb || 'Group job')+(g.pot_total != null ? ' · crew total $'+money(g.pot_total) : '')+'</div></div>'+(g.group_id ? headPill(g) : '')+'</div>';
  }
  function sec(n, label, body, attr) { return '<div class="gw-sec" '+(attr||'')+'><div class="gw-label">'+n+' · '+esc(label)+'</div>'+body+'</div>'; }

  // 1 · Crew hours: names and hours only. Each trade confirms their own
  // hours (owner, 6 Nov 2026); nobody approves anyone else's. The button
  // shows only while a server still asks this trade to confirm.
  function approveBtn(g) {
    if (!myTurn(g)) return '';
    return '<button type="button" class="btn btn-primary gw-btn" data-group-approve="'+esc(g.group_id)+'" '+(busy ? 'disabled ' : '')+'onclick="GroupWorkOrderInvoice.approve(this.getAttribute(\'data-group-approve\'))">'+(busy === g.group_id ? 'Confirming…' : 'Confirm my hours')+'</button>';
  }
  // A member logs their own hours for any day on the job; booked days are
  // offered as quick picks. One save per day: saving a day again replaces it.
  function canLog(g) { return !!g.group_id && !g.submitted && ['frozen','needs_join','awaiting_office'].indexOf(g.awaiting) === -1; }
  function bookedDays(g) {
    var r = routeJob(g.job_id);
    return r && Array.isArray(r.booked_dates) ? r.booked_dates.filter(function(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d)); }) : [];
  }
  function dayLabel(day) {
    var d = new Date(String(day) + 'T00:00:00');
    if (isNaN(d.getTime())) return String(day);
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()] + ' ' + d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  }
  function draftOf(id) { return hoursDraft[id] || (hoursDraft[id] = { work_date: '', start_time: '', finish_time: '', break_minutes: '', error: '', saved: '', saving: false }); }
  function hoursForm(g) {
    if (!canLog(g)) return '';
    var id = esc(g.group_id), d = draftOf(g.group_id), days = bookedDays(g);
    var h = '<div class="gw-hours" data-group-hours-form="'+id+'"><div class="gw-label" style="margin:0">Add your hours</div>'
      + '<div class="gw-sub">Any day you worked on this job. Saving confirms these are your hours. Saving a day again replaces it.</div>';
    if (days.length) {
      h += '<div class="gw-chips" data-group-hours-days>';
      days.forEach(function(day) { h += '<button type="button" class="gw-chip'+(d.work_date === day ? ' on' : '')+'" data-group-hours-day="'+esc(day)+'" onclick="GroupWorkOrderInvoice.hoursInput(this.closest(\'[data-group-hours-form]\').getAttribute(\'data-group-hours-form\'),\'work_date\',this.getAttribute(\'data-group-hours-day\'),true)">'+esc(dayLabel(day))+'</button>'; });
      h += '</div>';
    }
    function field(key, label, type, extra) {
      return '<label'+(extra || '')+'>'+label+'<input class="gw-field" type="'+type+'" data-group-hours-field="'+key+'" value="'+esc(d[key])+'"'+(type === 'number' ? ' inputmode="numeric" min="0" step="5"' : '')+' oninput="GroupWorkOrderInvoice.hoursInput(this.closest(\'[data-group-hours-form]\').getAttribute(\'data-group-hours-form\'),this.getAttribute(\'data-group-hours-field\'),this.value)"'+(d.saving ? ' disabled' : '')+'></label>';
    }
    h += '<div class="gw-hgrid">'+field('work_date','Date worked','date',' class="gw-wide"')+field('start_time','Start','time')+field('finish_time','Finish','time')+field('break_minutes','Break (min)','number',' class="gw-wide"')+'</div>';
    if (d.error) h += '<div class="gw-err" role="alert" data-group-hours-error>'+esc(d.error)+'</div>';
    else if (d.saved) h += '<div class="gw-ok" role="status" data-group-hours-saved>'+esc(d.saved)+'</div>';
    h += '<button type="button" class="btn btn-primary gw-btn" data-group-hours-save="'+id+'"'+(d.saving || busy ? ' disabled' : '')+' onclick="GroupWorkOrderInvoice.saveHours(this.getAttribute(\'data-group-hours-save\'))">'+(d.saving ? 'Saving…' : 'Save my hours')+'</button></div>';
    return h;
  }
  function parseHours(d) {
    var core = window.GroupWorkOrderCore;
    if (core && typeof core.parseHours === 'function') return core.parseHours(d);
    if (!d.work_date || !d.start_time || !d.finish_time) return { error: 'Enter the date, the start and the finish.' };
    var br = String(d.break_minutes == null ? '' : d.break_minutes).trim();
    if (br && (!isFinite(Number(br)) || Number(br) < 0)) return { error: 'Break minutes must be zero or more.' };
    return { work_date: d.work_date, start_time: d.start_time, finish_time: d.finish_time, break_minutes: br ? Math.round(Number(br)) : null };
  }
  function hoursBody(id, parsed) {
    var core = window.GroupWorkOrderCore;
    if (core && typeof core.hoursBody === 'function') return core.hoursBody(id, parsed);
    var body = { group_id: id, work_date: parsed.work_date, start_time: parsed.start_time, finish_time: parsed.finish_time };
    if (parsed.break_minutes != null) body.break_minutes = parsed.break_minutes;
    return body;
  }
  function crewHtml(g) {
    var crew = crewHours(g), ask = asksApproval(g);
    if (!crew.length) return (g.awaiting === 'needs_hours' && !canLog(g) ? '<div class="gw-locked" data-group-acceptance>Add your hours before your share can be calculated.</div>' : '') + hoursForm(g) + approveBtn(g);
    var h = '<div data-group-crew-hours>';
    crew.forEach(function(c) {
      var tag = '';
      if (ask && approvedRow(g, c)) tag = pill('✓ Confirmed','ok');
      h += '<div class="gw-crewrow'+(tag ? '' : ' plain')+'" data-group-crew-row'+(c.me ? ' data-me' : '')+'><span class="gw-name"><b>'+esc(c.name)+'</b>'+(c.me ? ' <small>(you)</small>' : '')+'</span>'
        + '<span class="gw-hrs">'+esc(hrs(c.hours))+'</span>'+(tag ? '<span class="gw-tag">'+tag+'</span>' : '')+'</div>';
    });
    return h + '</div>' + hoursForm(g) + approveBtn(g);
  }
  // 2 · Client sign-off: a plain green tick once signed.
  function signHtml(g) {
    var s = signoff(g);
    if (s) {
      var office = s.kind === 'office', bits = [];
      if (!office && s.name) bits.push(esc(s.name));
      if (s.at && when(s.at)) bits.push(esc(when(s.at)));
      if (!office && s.happy === true) bits.push('Happy');
      return '<div class="gw-signed" data-group-signed="'+(office ? 'office' : 'client')+'"><b>✓ '+(office ? 'Office' : 'Client')+' signed off</b>'
        + (bits.length ? '<div class="gw-sub">'+bits.join(' · ')+'</div>' : '')+'</div>';
    }
    return '<div class="gw-line" data-group-signed="no"><span>Not signed yet</span>'+pill('Waiting','no')+'</div>'
      + '<button type="button" class="btn btn-secondary gw-btn" data-group-sign-open="'+esc(g.group_id)+'" onclick="GroupWorkOrderInvoice.openSign(this.getAttribute(\'data-group-sign-open\'))">Hand phone to client to sign</button>'
      + '<div class="gw-sub gw-hint">Client can’t sign? The office can sign off instead.</div>';
  }
  // 3 · Your share: locked until hours are approved and the client has signed.
  function shareHtml(g) {
    var allIn = allInBasis(g), id = esc(g.group_id), h = '', note = submitted[owner+':'+g.group_id];
    if (g.submitted) {
      h += allIn ? moneyBlock(g) : (g.my_share != null ? '<div class="gw-money">'+row('data-group-allocation','Your share (ex GST)',g.my_share,'gw-total')+'</div>' : '');
      if (note) h += '<div class="gw-note" role="status" data-group-submit-note>'+esc(note)+'</div>';
      if (g.submitted.invoice_number) h += '<div class="gw-note">Invoice '+esc(g.submitted.invoice_number)+'</div>';
      return h + crewLine(g);
    }
    if (!unlocked(g)) {
      var text = !signed(g) && !hoursOk(g) ? 'Unlocks when the crew’s hours are confirmed and the client has signed.'
        : !signed(g) ? 'Unlocks when the client has signed.' : 'Unlocks when the crew’s hours are confirmed.';
      return '<div class="gw-locked" data-group-locked>'+text+'</div>';
    }
    if (g.awaiting === 'frozen' && Number(g.my_share) > 0) {
      h += allIn ? moneyBlock(g) : '<div class="gw-money">'+row('data-group-allocation','Your share (ex GST)',g.my_share,'gw-total')+'</div>';
      if (allIn) {
        if (note) h += '<div class="gw-note" role="status" data-group-submit-note>'+esc(note)+'</div>';
        else h += '<button type="button" class="btn btn-primary gw-btn" data-invoice-group-submit="'+id+'" '+(busy ? 'disabled ' : '')+'onclick="GroupWorkOrderInvoice.submit(this.getAttribute(\'data-invoice-group-submit\'))">'+(busy === g.group_id ? 'Submitting…' : 'Submit my group share')+'</button>';
      } else {
        h += '<label style="display:flex;align-items:center;gap:8px;min-height:44px;margin-top:4px"><input type="checkbox" data-invoice-group-select="'+id+'" '+(selected[g.group_id] ? 'checked ' : '')+'onchange="GroupWorkOrderInvoice.select(this.getAttribute(\'data-invoice-group-select\'),this.checked)">Include my share on this invoice</label>';
      }
      return h + crewLine(g);
    }
    if (g.awaiting === 'ready') {
      h += allIn ? moneyBlock(g) : (g.projected_my_share != null ? '<div class="gw-money">'+row('data-group-estimate','Your estimated share',g.projected_my_share,'gw-total')+'</div>' : '');
      h += '<button type="button" class="btn btn-primary gw-btn" data-invoice-group-finalise="'+id+'" '+(busy ? 'disabled ' : '')+'onclick="GroupWorkOrderInvoice.finalise(this.getAttribute(\'data-invoice-group-finalise\'))">'+(busy === g.group_id ? 'Finalising…' : 'Finalise group shares')+'</button>';
      return h + crewLine(g);
    }
    var messages = {needs_hours:'Add your hours in step 1 to see your share.', awaiting_others:'Waiting for the rest of the crew’s hours.', awaiting_rate:'The office needs to confirm a crew pay rate.', awaiting_signoff:'Needs a current sign-off before shares can be finalised.', awaiting_office:'Already finalised. Ask the office to check your share.'};
    return '<div class="gw-locked" data-group-acceptance>'+esc(messages[g.awaiting] || 'Not ready to invoice yet.')+'</div>';
  }
  function links(g) {
    var h = '<div class="gw-links">';
    if (g.submitted && g.submitted.invoice_id) h += '<button type="button" class="gw-link" data-invoice-group-view="'+esc(g.submitted.invoice_id)+'" onclick="viewInvoiceDetail(this.getAttribute(\'data-invoice-group-view\'))">View my invoice</button>';
    if (g.group_id && Array.isArray(g.crew_status) && g.crew_status.length) h += '<button type="button" class="gw-link" data-invoice-group-status="'+esc(g.group_id)+'" onclick="GroupWorkOrderInvoice.status(this.getAttribute(\'data-invoice-group-status\'))">Group status</button>';
    h += '<button type="button" class="gw-link" data-invoice-group-job="'+esc(g.job_id)+'" onclick="openJob(this.getAttribute(\'data-invoice-group-job\'))">Job details</button></div>';
    return h;
  }
  function panel(g) {
    if (g.awaiting === 'needs_join') {
      return '<button type="button" class="btn btn-primary gw-btn" data-invoice-group-join="'+esc(g.group_id)+'" '+(busy ? 'disabled ' : '')+'onclick="GroupWorkOrderInvoice.join(this.getAttribute(\'data-invoice-group-join\'))">Join group work order</button>'+links(g);
    }
    var n = 0, h = '';
    if (crewHours(g).length || g.awaiting === 'needs_hours' || myTurn(g) || canLog(g)) h += sec(++n, 'Crew hours', crewHtml(g), 'data-group-step="hours"');
    h += sec(++n, 'Client sign-off', signHtml(g), 'data-group-step="signoff"');
    h += sec(++n, 'Your share', shareHtml(g), 'data-group-step="share"');
    return h + links(g);
  }

  // Inside a job card: the card's mode toggle sits under the head.
  function discoveryHtml(card) {
    var route = payableRoutes.find(function(r) { return String(r.job_id) === String(card.job_id); });
    var d = route && route.discovery;
    if (!d || (d.state !== 'create' && d.state !== 'setup_required')) return '';
    if (d.state === 'setup_required') return '<p data-group-discovery style="font-size:12px;color:var(--sw-text-sec)">' + esc(d.message || 'The office needs to check the group setup.') + '</p>';
    return '<div data-group-discovery style="margin-top:10px"><button type="button" class="gw-link" data-invoice-group-create="' + esc(card.job_id) + '" onclick="GroupWorkOrderInvoice.create(this.getAttribute(\'data-invoice-group-create\'))"' + (busy ? ' disabled' : '') + '>Create group work order</button></div>';
  }

  // Canonical server routing is independent of the saved draft's old mode.
  function routeHtml(card) {
    var route = payableRoutes.find(function(r) { return String(r.job_id) === String(card.job_id); });
    if (!route || route.route !== 'hours' || card.job_type !== 'patio') return '';
    return '<p data-invoice-pay-route="hours" class="gw-locked">Paid by the hour on this invoice.</p>';
  }

  // Keep every saved day, including excluded and blank entries. These are
  // recovery notes, not submitted group hours or an entitlement calculation.
  function savedEntriesHtml(cards) {
    if (!cards || !cards.length) return '';
    var h = '<div data-saved-group-hours class="gw-sec"><strong>Times you saved earlier</strong>'
      + '<p class="gw-locked">Kept so nothing is lost. They are not added to this invoice. This job is paid through the group, so add these hours to the group above.</p>';
    cards.forEach(function(c) {
      var date = c.work_date || c.scheduled_date || 'Date not entered';
      var time = c.start_time || c.finish_time ? (c.start_time || '?') + ' to ' + (c.finish_time || '?') : 'Times not entered';
      var hours = c.hours == null || c.hours === '' ? 'Hours not entered' : hrs(c.hours);
      h += '<div data-saved-group-entry style="padding:8px 0;border-bottom:1px solid var(--sw-border);overflow-wrap:anywhere">'
        + '<div><b>' + esc(date) + '</b> · ' + esc(c.included === false ? 'Not ticked' : 'Saved') + '</div>'
        + '<div>' + esc(time) + ' · ' + esc(hours) + (c.break_minutes != null ? ' · Break ' + esc(c.break_minutes) + ' min' : '') + '</div>'
        + (c.description ? '<div>' + esc(c.description) + '</div>' : '') + '</div>';
    });
    return h + '</div>';
  }

  function jobCardHtml(card, toggle) {
    ensureCss();
    var list = groups.filter(function(g) { return String(g.job_id) === String(card.job_id); });
    if (!list.length) {
      var route = payableRoutes.find(function(r) { return String(r.job_id) === String(card.job_id); });
      if (route && route.route === 'group_setup_required') {
        var detail = route.setup_reason === 'group_missing'
          ? (route.discovery && route.discovery.state === 'create'
            ? 'The approved work-order amount is ready. Create the crew group below, then record your hours on it.'
            : 'The approved work-order amount is ready. The office needs to set up the crew group before you invoice your share.')
          : route.setup_reason === 'work_order_not_approved'
          ? 'The office needs to approve the job work order before setting up the crew group.'
          : 'The office needs to set the job work-order amount before setting up the crew group.';
        if (route.discovery && route.discovery.state === 'setup_required' && route.discovery.message) detail = route.discovery.message;
        return head({ job_number: card.job_number, client_name: card.client_name, site_suburb: card.site_suburb, job_id: card.job_id })
          + '<div class="gw-locked" data-group-setup-required data-invoice-pay-route="group_setup_required" style="margin-top:12px"><strong>Group work order needs setting up</strong><p>' + esc(detail) + '</p><p>Your other jobs can still be invoiced.</p></div>'
          + (route.discovery && route.discovery.state === 'setup_required' ? '' : discoveryHtml(card)) + links({ job_id: card.job_id });
      }
      return head({ job_number: card.job_number, client_name: card.client_name, site_suburb: card.site_suburb, job_id: card.job_id }) + (toggle || '')
        + '<div class="gw-locked" style="margin-top:12px">Paid from the group work order.</div>' + links({ job_id: card.job_id });
    }
    return list.map(function(g, i) { return '<div data-invoice-group="'+esc(g.group_id)+'" data-group-in-card data-invoice-pay-route="group">'+head(g)+(i === 0 ? (toggle || '') : '')+panel(g)+'</div>'; }).join('');
  }
  // A job this week that is paid through a group but has no group to show:
  // name it and say the next step, never offer it as an hours card.
  function routeJobCard(r, readFailed) {
    var d = r.discovery || {};
    var step = readFailed ? 'This job is paid through its group work order. Try again to load it.'
      : (r.next_step || (d.state === 'setup_required' && d.message) || 'This job is paid through its group work order.');
    var h = '<div class="gw-card" data-group-route-job="'+esc(r.job_id)+'" data-invoice-pay-route="'+esc(r.route || 'group')+'">'
      + head({ job_number: r.job_number, client_name: r.client_name, site_suburb: r.site_suburb, job_id: r.job_id })
      + '<div class="gw-locked" data-group-next-step style="margin-top:10px">'+esc(step)+'</div>';
    if (!readFailed && d.state === 'create') {
      h += '<button type="button" class="btn btn-primary gw-btn" data-invoice-group-create="'+esc(r.job_id)+'"'+(busy ? ' disabled' : '')+' onclick="GroupWorkOrderInvoice.create(this.getAttribute(\'data-invoice-group-create\'))">'+(busy === String(r.job_id) ? 'Creating…' : 'Create group work order')+'</button>';
    }
    return h + links({ job_id: r.job_id }) + '</div>';
  }
  // The group section: groups and group-paid jobs with no job card this week.
  function html(cardJobIds) {
    ensureCss();
    var shown = {};
    (cardJobIds || []).forEach(function(id) { if (id != null) shown[String(id)] = true; });
    var h = '<section data-invoice-groups style="margin:16px 0"><div class="inv-section-label">Group work orders</div>';
    if (!loaded && (state === 'idle' || state === 'loading')) return h + '<p class="gw-locked">Checking your group work orders…</p></section>';
    var waiting = routeJobs.filter(function(r) {
      return !shown[String(r.job_id)] && (state === 'error' || !groups.some(function(g) { return String(g.job_id) === String(r.job_id); }));
    });
    if (state === 'error') {
      h += '<div data-group-read-failed><p role="alert">Your group jobs could not be loaded. Your other jobs can still be invoiced.</p>'
        + '<button type="button" class="btn btn-secondary" data-group-retry onclick="GroupWorkOrderInvoice.retry()">Try again</button></div>';
      waiting.forEach(function(r) { h += routeJobCard(r, true); });
      return h + '</section>';
    }
    var rest = groups.filter(function(g) { return !shown[String(g.job_id)]; });
    if (!rest.length && !waiting.length) return '';
    rest.forEach(function(g) { h += '<div class="gw-card" data-invoice-group="'+esc(g.group_id)+'">'+head(g)+panel(g)+'</div>'; });
    waiting.forEach(function(r) { h += routeJobCard(r, false); });
    return h + '</section>';
  }

  function statusBody(g) {
    var r = g.release || {}, s = signoff(g);
    var h = '<div class="gw-title" style="font-size:17px">Group payment status</div><div class="gw-meta">'+esc(g.job_number)+(g.pot_total != null ? ' · pool $'+money(g.pot_total)+' ex GST' : '')+'</div><div style="margin-top:8px">';
    (g.crew_status || []).forEach(function(c) {
      h += '<div data-group-crew style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--sw-border)"><span><b>'+esc(c.name)+'</b>'+(c.me ? ' (you)' : '')+'</span>'+pill(STATE_WORDS[c.state] || 'Not known', STATE_TONE[c.state] || 'no')+'</div>';
    });
    h += '</div><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:9px 0"><span>Sign-off</span>'+(!s ? pill('Not signed off','wait') : s.kind === 'office' ? pill('Office signed off','ok') : pill('Client signed off','ok'))+'</div>';
    if (r.released) h += '<div data-group-released style="padding:9px 10px;border-radius:8px;border-left:3px solid #27AE60;background:#E8F6EE;font-size:13px">Sent for payment. The whole crew’s bills went to accounts together.</div>';
    else h += '<div data-group-hold style="padding:9px 10px;border-radius:8px;border-left:3px solid #E67E22;background:#FDF1E5;font-size:13px"><b>Pay held.</b> '+esc((r.hold || []).join(' ') || 'Waiting on the rest of the crew.')+'</div>';
    return h + '<button type="button" class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="this.closest(\'dialog\').close()">Close</button>';
  }

  // On-site sign sheet: five ratings, an optional note, a signature and a name.
  var RATINGS = [['sales_process','Sales and quote'],['communication','Communication'],['cleanliness','Cleanliness'],['punctuality','Punctuality'],['crew','The crew']];
  function signSheet(g) {
    var names = crewHours(g).map(function(c) { return c.name; });
    if (!names.length && Array.isArray(g.crew_status)) names = g.crew_status.map(function(c) { return c.name; });
    var h = '<div class="gw-sheet-head"><div><div class="gw-sheet-title">Sign off the job</div>'
      + '<div class="gw-sub">'+esc(g.job_number)+(g.site_suburb ? ' · '+esc(g.site_suburb) : '')+'</div>'
      + (names.length ? '<div class="gw-sub">SecureWorks crew: '+esc(names.join(', '))+'</div>' : '')+'</div>'
      + '<button type="button" class="gw-x" aria-label="Close" data-gw-sign-close>✕</button></div>';
    h += '<div class="gw-label">How did we go?</div>';
    RATINGS.forEach(function(pair) {
      h += '<div class="gw-rate"><span id="gwRate_'+pair[0]+'">'+esc(pair[1])+'</span><span class="gw-stars" role="radiogroup" aria-labelledby="gwRate_'+pair[0]+'" data-gw-rating="'+pair[0]+'">';
      for (var n = 1; n <= 5; n++) h += '<button type="button" role="radio" aria-checked="false" aria-label="'+esc(pair[1])+' '+n+' of 5" data-gw-star="'+pair[0]+'" data-n="'+n+'">★</button>';
      h += '</span></div>';
    });
    h += '<label class="gw-label" for="gwSignNote" style="display:block;margin-top:14px">Anything to tell us?</label>'
      + '<textarea class="gw-field" id="gwSignNote" data-gw-sign-note rows="2" maxlength="2000" placeholder="Notes for the team (optional)"></textarea>';
    h += '<div class="gw-labrow" style="margin-top:14px"><span class="gw-label" style="margin:0">Signature</span><button type="button" class="gw-link" data-gw-sign-clear>Clear</button></div>'
      + '<div class="gw-pad" data-gw-pad style="margin-top:4px"><canvas data-gw-sign-pad aria-label="Client signature"></canvas><span>Sign here</span></div>';
    h += '<label class="gw-label" for="gwSignName" style="display:block;margin-top:14px">Client’s name</label>'
      + '<input class="gw-field" id="gwSignName" data-gw-sign-name autocomplete="name" value="'+esc(g.client_name || '')+'">';
    h += '<div class="gw-err" data-gw-sign-err role="alert" hidden></div>';
    h += '<button type="button" class="btn btn-primary gw-btn" style="margin-top:14px" data-gw-sign-submit disabled>I’m happy with the work. Sign off</button>';
    return h;
  }
  // Every rating tapped (never defaulted), a signature and a name.
  function signReady(d) {
    var name = d.querySelector('[data-gw-sign-name]');
    return !!sign && !sign.busy && sign.drawn && !!name && name.value.trim().length > 0
      && RATINGS.every(function(pair) { return sign.ratings[pair[0]] >= 1; });
  }
  function signRefresh(d) {
    var btn = d.querySelector('[data-gw-sign-submit]');
    if (btn) btn.disabled = !signReady(d);
  }
  function signPad(d) {
    var canvas = d.querySelector('[data-gw-sign-pad]'), wrap = d.querySelector('[data-gw-pad]');
    var ratio = window.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
    var w = rect.width || 320, hgt = rect.height || 120;
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(hgt * ratio);
    var ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    function blank() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hgt); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#22333D'; }
    blank();
    var drawing = false, mine = sign;
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.onpointerdown = function(e) {
      if (mine.busy) return;
      drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* synthetic pointer */ } }
      e.preventDefault();
    };
    canvas.onpointermove = function(e) {
      if (!drawing) return;
      var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
      if (!mine.drawn) { mine.drawn = true; wrap.classList.add('drawn'); signRefresh(d); }
      e.preventDefault();
    };
    canvas.onpointerup = canvas.onpointercancel = function() { drawing = false; };
    mine.clear = function() { blank(); mine.drawn = false; wrap.classList.remove('drawn'); signRefresh(d); };
    mine.png = function() { return canvas.toDataURL('image/png'); };
  }
  function openSign(id) {
    var g = find(id);
    if (!g || signed(g) || busy || !api) return;
    var d = dialogEl('data-group-sign-dialog', 'gw-sheet');
    sign = { id: id, ratings: {}, drawn: false, busy: false };
    d.innerHTML = signSheet(g);
    d.onclick = function(e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t || !sign) return;
      var star = t.closest('[data-gw-star]');
      if (star && !sign.busy) {
        var key = star.getAttribute('data-gw-star'), n = Number(star.getAttribute('data-n'));
        sign.ratings[key] = n;
        d.querySelectorAll('[data-gw-star="'+key+'"]').forEach(function(b) {
          var v = Number(b.getAttribute('data-n'));
          b.classList.toggle('on', v <= n); b.setAttribute('aria-checked', v === n ? 'true' : 'false');
        });
        signRefresh(d);
      } else if (t.closest('[data-gw-sign-clear]')) { if (sign.clear && !sign.busy) sign.clear(); }
      else if (t.closest('[data-gw-sign-close]')) { if (!sign.busy) d.close(); }
      else if (t.closest('[data-gw-sign-submit]')) submitSign(d);
    };
    d.oninput = function() { signRefresh(d); };
    d.onclose = function() { if (sign && !sign.busy) sign = null; };
    d.oncancel = function(e) { if (sign && sign.busy) e.preventDefault(); };
    show(d);
    signPad(d);
  }
  function submitSign(d) {
    if (!signReady(d)) return;
    var g = find(sign.id);
    if (!g) return;
    var err = d.querySelector('[data-gw-sign-err]'), btn = d.querySelector('[data-gw-sign-submit]');
    var r = sign.ratings, current = sign;
    var body = {
      group_id: g.group_id,
      signer_name: d.querySelector('[data-gw-sign-name]').value.trim(),
      signature_png: sign.png(),
      happy: true,
      satisfaction_rating: r.crew,
      ratings: { sales_process: r.sales_process, communication: r.communication, cleanliness: r.cleanliness, punctuality: r.punctuality, crew: r.crew },
      note: d.querySelector('[data-gw-sign-note]').value.trim()
    };
    sign.busy = true; err.hidden = true; btn.disabled = true; btn.textContent = 'Signing…';
    api('capture_group_client_signoff', null, body).then(function(res) {
      if (!res || res.ok !== true) throw new Error((res && (res.error || res.message)) || 'The sign-off was not saved. Try again.');
      current.busy = false; sign = null;
      if (d.open) d.close();
      say('Signed off. Thank you.');
      load(true);
    }).catch(function(e) {
      current.busy = false;
      if (sign !== current) return;
      err.textContent = (e && e.message) || 'The sign-off was not saved. Try again.'; err.hidden = false;
      btn.textContent = 'I’m happy with the work. Sign off'; signRefresh(d);
    });
  }
  function submittedNote(g, res) {
    if (g.pay_basis !== 'all_in_12_v2') {
      return res && res.success === true && res.invoice_id && res.office_review === 'held' && !res.xero_bill_id
        ? 'Your group invoice is saved for office review.'
        : 'The office needs to check the submission outcome. Do not submit again.';
    }
    if (!res || res.success !== true || !res.invoice_id) return 'The office needs to check the submission outcome. Do not submit again.';
    return res.group_release && res.group_release.released === true ? 'Sent for payment with the whole crew.' : 'Saved. Paid together once the whole crew is in.';
  }

  window.GroupWorkOrderInvoice = { use: use, load: load, html: html, jobCardHtml: jobCardHtml, discoveryHtml: discoveryHtml, routeHtml: routeHtml, savedEntriesHtml: savedEntriesHtml, isGroupJob: isGroupJob, items: items, total: total,
    selectedIds: selectedIds, restore: restore, setRouteJobs: setRouteJobs,
    // routesReady: the group read succeeded. routesSettled: it finished, ok or
    // not; ordinary job cards render and submit once it has settled.
    routesReady: function() { return state === 'ready'; }, routesSettled: settled, readFailed: function() { return state === 'error'; },
    ready: function() { return settled() && !busy; }, reset: reset,
    hoursInput: function(id, key, value, rerender) {
      if (['work_date','start_time','finish_time','break_minutes'].indexOf(key) === -1) return;
      var d = draftOf(id);
      if (d.saving) return;
      d[key] = String(value == null ? '' : value); d.error = ''; d.saved = '';
      if (rerender) changed();
    },
    saveHours: function(id) {
      var g = find(id), d = draftOf(id);
      if (!g || !canLog(g) || d.saving || busy || !api) return;
      var parsed = parseHours(d);
      if (parsed.error) { d.error = parsed.error; changed(); return; }
      d.saving = true; d.error = ''; d.saved = ''; changed();
      api('submit_group_work_order_hours', null, hoursBody(id, parsed)).then(function(res) {
        if (res && res.ok === false) throw new Error(res.error || res.message || 'Your hours were not saved. Try again.');
        hoursDraft[id] = { work_date: '', start_time: '', finish_time: '', break_minutes: '', error: '', saved: 'Saved ' + dayLabel(parsed.work_date) + '.', saving: false };
        load(true);
      }).catch(function(err) {
        // Keep what the trade typed and say why it did not save.
        d.saving = false; d.error = (err && err.message) || 'Your hours were not saved. Try again.'; changed();
      });
    },
    retry: function() { load(true); changed(); },
    openSign: openSign,
    status: function(id) {
      var g = find(id);
      if (!g) return;
      var dialog = dialogEl('data-group-status-dialog');
      dialog.innerHTML = statusBody(g);
      show(dialog);
    },
    select: function(id,on) { var g = find(id); if (on && (!g || !selectable(g))) return; selected[id] = !!on; changed(); },
    approve: function(id) {
      var g = find(id);
      if (busy || !g || !myTurn(g)) return;
      var me = crewHours(g).find(function(c) { return c.me; });
      var name = (typeof options.userName === 'function' && options.userName()) || (me && me.name) || '';
      busy = id; changed();
      api('sign_group_work_order', null, {group_id:id, signer_name:String(name)}).then(function(res) {
        if (!res || res.ok !== true) throw new Error('Your hours were not confirmed. Try again.');
        busy = ''; load(true);
      }).catch(function(err) { busy = ''; say(err.message || 'Your hours were not confirmed. Try again.', true); changed(); });
    },
    create: function(jobId) {
      var route = payableRoutes.find(function(r) { return String(r.job_id) === String(jobId); }) || routeJob(jobId);
      if (busy || !route || !route.discovery || route.discovery.state !== 'create') return;
      busy = String(jobId); changed();
      api('create_group_work_order', null, {job_id:jobId}).then(function() {busy='';load(true);})
        .catch(function(err) {busy='';say(err.message || 'Could not create the group work order.',true);changed();});
    },
    join: function(id) {
      var g=find(id);
      if(busy || !g || g.awaiting!=='needs_join') return;
      busy=id; changed();
      api('join_group_work_order',null,{group_id:id}).then(function() {busy='';load(true);}).catch(function(err) {busy='';say(err.message || 'Could not join the group.',true);changed();});
    },
    submit: function(id) {
      var g = find(id);
      if (busy || submitted[owner+':'+id] || !g || g.submitted || g.awaiting !== 'frozen' || !unlocked(g) || !(Number(g.my_share)>0)) return;
      if (!window.confirm('Submit your group share for '+g.job_number+'? Pay $'+money(g.my_cash_pay)+' and super $'+money(g.my_super)+' within your $'+money(g.my_budget)+' allocation.')) return;
      var submissionKey=owner+':'+id;
      busy=id; changed();
      api('generate_trade_invoice',null,{extra_items:[{type:'group share',group_id:id}],gst_on:typeof options.gstOn==='function' ? options.gstOn() === true : false}).then(function(res) {
        submitted[submissionKey] = submittedNote(g, res);
      }).catch(function() { submitted[submissionKey]='The office needs to check the submission outcome. Do not submit again.'; }).finally(function() {busy='';load(true);changed();});
    },
    finalise: function(id) {
      var g = find(id);
      if (busy || !g || g.submitted || g.awaiting !== 'ready' || !unlocked(g)) return;
      if (!window.confirm('Finalise group shares for '+g.job_number+'? This locks the crew hours, rates and shares.')) return;
      busy = id; changed();
      api('freeze_group_work_order', null, {group_id:id}).then(function(res) {
        if (!res || res.awaiting !== 'frozen') throw new Error('Finalisation was not confirmed. Refresh before continuing.');
        if (!allInBasis(g)) selected[id] = true;
        busy = ''; load(true);
      }).catch(function(err) { busy = ''; say(err.message || 'Could not finalise the shares.',true); changed(); });
    }
  };
})();
