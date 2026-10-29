// Placed by AI: what the AI bill reader did in Bills to place (Financials > Bill Reconciliation).
// Backend: secureworks-backend migration 20261028173000 and ops-api actions
//   materials_ai_status      the counts, the confidence bar and calls today
//   materials_ai_placements  each decision with its reason (view placed | left | undone | checked)
//   materials_ai_undo        takes one placement or filing back; the bill returns to the list
//                            below and the AI never reads it again
//   materials_ai_settings    pause or resume, and the confidence bar
// Jan's word, 28 Oct 2026: the AI places every bill it is sure of; a person sees only the
// rest. Undo takes two presses. Nothing here writes Xero. A failed read says so, never 0.
// Every rule the panel applies lives in the pure BillsAiCore between the sentinels below.
// Guard: tests/e2e/ops-bills-ai.spec.js.

// <bills-ai-core>
var BillsAiCore = (function () {
  var VIEWS = [
    { key: 'placed', label: 'Placed by AI' },
    { key: 'left', label: 'Left for a person' },
    { key: 'checked', label: 'Second checks' },
    { key: 'undone', label: 'Undone' }
  ];
  var CHECK_WORDS = {
    not_needed: '',
    due: 'Second check waiting',
    agreed: 'Second check agreed',
    disagreed: 'Second check disagreed'
  };

  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    return Math.round(v * 100) + '%';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // One line a bookkeeper reads at a glance. Missing status is never shown as zero.
  function summary(st) {
    if (!st) return '';
    var parts = [];
    parts.push((st.enabled ? 'On' : 'Paused'));
    parts.push('placed ' + (st.placed || 0) + ' bills (' + money(st.placed_ex || 0) + ' ex GST)');
    if (st.placed_installer) parts.push(st.placed_installer + ' of them installer bills');
    parts.push('filed ' + (st.filed_not_job_related || 0) + ' as not job related');
    parts.push((st.left_for_person_open || 0) + ' left for a person');
    if (st.undone) parts.push(st.undone + ' undone');
    parts.push('sure enough at ' + pct(st.confidence_bar));
    parts.push((st.calls_today || 0) + ' of ' + (st.daily_call_cap || 0) + ' reads today');
    if (st.bills_to_place_open != null) parts.push((st.bills_to_place_open) + ' bills (' + money(st.bills_to_place_open_ex || 0) + ') still in Bills to place');
    return parts.join(', ') + '.';
  }
  function outcomeWords(p) {
    if (p.undone_at) return 'Undone' + (p.undone_by ? ' by ' + p.undone_by : '');
    if (p.outcome === 'placed') return 'Placed on ' + (p.job_number || 'a job');
    if (p.outcome === 'filed_not_job_related') return 'Filed as not job related';
    if (p.outcome === 'left_for_person') {
      if (p.decision === 'job' && p.job_number) return 'Left for a person (best guess ' + p.job_number + ')';
      return 'Left for a person';
    }
    if (p.outcome === 'refused') return 'Not placed: ' + String(p.refusal || 'refused');
    return String(p.outcome || '');
  }
  function checkWords(p) {
    var w = CHECK_WORDS[p.second_check_status] || '';
    if (p.second_check_status === 'disagreed' && p.second_check) {
      var c = p.second_check;
      w += c.decision === 'job' && c.job_number ? ': says ' + c.job_number : c.decision ? ': says ' + String(c.decision).replace(/_/g, ' ') : '';
    }
    return w;
  }
  function canUndo(p) {
    return !p.undone_at && (p.outcome === 'placed' || p.outcome === 'filed_not_job_related');
  }
  function undoWords(err) {
    var m = err && err.message ? String(err.message) : '';
    return m ? 'Not undone: ' + m : 'Not undone. Please try again.';
  }
  return { VIEWS: VIEWS, money: money, pct: pct, esc: esc, summary: summary, outcomeWords: outcomeWords,
    checkWords: checkWords, canUndo: canUndo, undoWords: undoWords };
})();
// </bills-ai-core>

var BillsAi = (function () {
  var C = BillsAiCore;
  var ARM_GAP_MS = 700;
  var s = { view: 'placed', status: null, statusErr: null, rows: [], rowsErr: null, armed: {}, busy: {}, err: {}, open: false, seq: 0 };

  function host() { return document.getElementById('billsAiPanel'); }

  async function load() {
    var h = host();
    if (!h) return;
    var seq = ++s.seq;
    var st = opsFetch('materials_ai_status').then(function (r) { return { ok: r && r.status }; }, function (e) { return { err: e }; });
    var rows = opsFetch('materials_ai_placements', { view: s.view, limit: 200 }).then(function (r) { return { ok: (r && r.placements) || [] }; }, function (e) { return { err: e }; });
    var a = await st, b = await rows;
    if (seq !== s.seq) return;
    s.status = a.ok || null; s.statusErr = a.err ? (a.err.message || 'could not be read') : null;
    s.rows = b.ok || []; s.rowsErr = b.err ? (b.err.message || 'could not be read') : null;
    render();
  }

  function setView(v) { s.view = v; s.armed = {}; s.err = {}; load(); }
  function toggle() { s.open = !s.open; render(); }

  async function undo(id) {
    var now = Date.now();
    if (s.busy[id]) return;
    if (!s.armed[id]) { s.armed[id] = now; s.err[id] = null; render(); return; }
    if (now - s.armed[id] < ARM_GAP_MS) return;
    s.busy[id] = true; render();
    try {
      await opsPost('materials_ai_undo', { placement_id: id });
      delete s.armed[id];
      if (typeof loadMaterialsRecon === 'function') loadMaterialsRecon();
      await load();
    } catch (e) {
      s.err[id] = C.undoWords(e);
    } finally {
      s.busy[id] = false; render();
    }
  }

  async function setEnabled(on) {
    try { await opsPost('materials_ai_settings', { enabled: !!on }); }
    catch (e) { s.statusErr = 'Not changed: ' + (e.message || 'please try again'); }
    load();
  }
  async function setBar(v) {
    try { await opsPost('materials_ai_settings', { confidence_bar: Number(v) }); }
    catch (e) { s.statusErr = 'Not changed: ' + (e.message || 'please try again'); }
    load();
  }

  function rowHtml(p) {
    var id = C.esc(p.id);
    var h = '<div class="bai-row" data-bai-row="' + id + '" style="padding:9px 14px;border-top:1px solid var(--sw-border,#e2e8f0);">';
    h += '<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;">';
    h += '<strong>' + C.esc(p.contact_name || 'Supplier') + '</strong>';
    h += '<span class="mrq-muted">' + C.esc(p.invoice_number || '') + '</span>';
    h += '<span>' + C.money(p.amount_ex) + ' ex GST</span>';
    if (p.installer) h += '<span class="badge">Installer</span>';
    h += '<span data-bai-outcome>' + C.esc(C.outcomeWords(p)) + '</span>';
    if (p.confidence != null) h += '<span class="mrq-muted">sure ' + C.pct(p.confidence) + '</span>';
    var cw = C.checkWords(p);
    if (cw) h += '<span class="badge" data-bai-check>' + C.esc(cw) + '</span>';
    if (C.canUndo(p)) {
      var label = s.busy[p.id] ? 'Undoing...' : s.armed[p.id] ? 'Press again to undo' : 'Undo';
      h += '<button class="btn btn-secondary btn-sm" data-bai-undo="' + id + '" onclick="BillsAi.undo(\'' + id + '\')"' + (s.busy[p.id] ? ' disabled' : '') + '>' + label + '</button>';
    }
    h += '</div>';
    if (p.reason) h += '<div style="margin-top:3px;">' + C.esc(p.reason) + '</div>';
    if (s.armed[p.id] && !s.busy[p.id]) h += '<div class="mrq-muted">The bill goes back to the list below for a person, and the AI will not read it again.</div>';
    if (s.err[p.id]) h += '<div style="color:#b91c1c;" data-bai-err>' + C.esc(s.err[p.id]) + '</div>';
    h += '</div>';
    return h;
  }

  function render() {
    var h = host();
    if (!h) return;
    var st = s.status;
    var out = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 14px;background:var(--sw-light,#f6f8fa);border-bottom:1px solid var(--sw-border,#e2e8f0);">';
    out += '<strong>AI bill placement</strong>';
    out += '<span class="mrq-summary" data-bai-summary>' + C.esc(s.statusErr ? 'Status could not be read: ' + s.statusErr : C.summary(st)) + '</span>';
    out += '<span style="flex:1"></span>';
    if (st) {
      out += '<label class="mrq-muted">Sure enough at <select data-bai-bar onchange="BillsAi.setBar(this.value)">';
      [0.8, 0.85, 0.9, 0.95].forEach(function (v) {
        out += '<option value="' + v + '"' + (Math.abs(Number(st.confidence_bar) - v) < 0.001 ? ' selected' : '') + '>' + C.pct(v) + '</option>';
      });
      if ([0.8, 0.85, 0.9, 0.95].every(function (v) { return Math.abs(Number(st.confidence_bar) - v) >= 0.001; })) {
        out += '<option selected value="' + C.esc(st.confidence_bar) + '">' + C.pct(st.confidence_bar) + '</option>';
      }
      out += '</select></label>';
      out += '<button class="btn btn-secondary btn-sm" data-bai-toggle onclick="BillsAi.setEnabled(' + (st.enabled ? 'false' : 'true') + ')">' + (st.enabled ? 'Pause AI' : 'Resume AI') + '</button>';
    }
    out += '<button class="btn btn-secondary btn-sm" onclick="BillsAi.toggle()">' + (s.open ? 'Hide list' : 'Show list') + '</button>';
    out += '</div>';
    if (s.open) {
      out += '<div style="display:flex;gap:6px;padding:8px 14px;flex-wrap:wrap;">';
      C.VIEWS.forEach(function (v) {
        out += '<button class="btn btn-sm ' + (s.view === v.key ? 'btn-primary' : 'btn-secondary') + '" data-bai-view="' + v.key + '" onclick="BillsAi.setView(\'' + v.key + '\')">' + v.label + '</button>';
      });
      out += '</div>';
      if (s.rowsErr) out += '<div style="padding:12px 14px;color:#b91c1c;" data-bai-rows-err>The list could not be read: ' + C.esc(s.rowsErr) + '</div>';
      else if (!s.rows.length) out += '<div class="mrq-muted" style="padding:12px 14px;">Nothing here yet.</div>';
      else out += s.rows.map(rowHtml).join('');
    }
    h.innerHTML = out;
  }

  return { load: load, undo: undo, setView: setView, toggle: toggle, setEnabled: setEnabled, setBar: setBar, _state: s };
})();
