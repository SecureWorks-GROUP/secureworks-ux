/* <ops-dispatch>
 * Dispatch tab, slice 1: the Dispatch view of any job. A real job list with
 * search and work type buttons, the real job header, and the Scope and notes
 * section with a working Save note. Mounted in #dispatchRoot above the live
 * purchase order board, which this module never touches.
 *
 * Reads (ops-api): pipeline with dispatch=1 (the list, counts and header
 * facts), job_detail once per job open (scope, photos, quote), job_notes
 * (every saved note). Writes exactly one thing: add_note, always with
 * visibility 'internal_only' and from_ops true. Without that visibility a note
 * is copied to the customer's contact notes. Add no other write here.
 *
 * A failed read never renders as empty. An ops-api that does not know
 * dispatch=1 answers with rows missing description / value_inc_gst /
 * work_type, and one that does not know job_notes answers Unknown action:
 * both are failed reads.
 *
 * Guard: tests/e2e/ops-tab-set.spec.js.
 * Contract: secureworks-backend docs/dispatch-slice-1-read-contract.md.
 */
(function (global) {
  'use strict';

  var TYPES = [
    { key: 'all', label: 'All' },
    { key: 'fencing', label: 'Fencing' },
    { key: 'patio', label: 'Patio' },
    { key: 'decking', label: 'Decking' },
    { key: 'repair', label: 'Repair' }
  ];
  var TYPE_LABELS = { fencing: 'Fencing', patio: 'Patio', decking: 'Decking', repair: 'Repair', makesafe: 'Make-safe', insurance: 'Insurance' };
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var PERTH_OFFSET_MS = 8 * 3600 * 1000; // Perth is UTC+8 all year
  var LS_LEFT = 'sw_dispatch_left';
  var LS_SCOPE = 'sw_dispatch_scope_open';
  var SS_JOB = 'sw_dispatch_job';
  var FIRST_CHUNK = 60;
  var NEXT_CHUNK = 150;
  var SEARCH_DEBOUNCE_MS = 300;
  var ROOT_ID = 'dispatchRoot';
  // The approved design's three typefaces. Loaded when Dispatch first opens, so
  // no other Ops tab makes the request.
  var FONTS_URL = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ───────────────────────── pure rules ─────────────────────────

  function text(v) { return v == null ? '' : String(v).trim(); }

  // A link is only offered when it is a plain http(s) address.
  function safeUrl(v) {
    var s = text(v);
    return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
  }

  function perthYearNow() { return new Date(Date.now() + PERTH_OFFSET_MS).getUTCFullYear(); }

  // A stored calendar day (YYYY-MM-DD...), read without any timezone shift.
  function parseDay(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(v));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    return { y: y, m: mo, d: d, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
  }

  // A stored instant, as the Perth calendar day and clock time.
  function parseStamp(v) {
    var t = Date.parse(text(v));
    if (!isFinite(t)) return null;
    var p = new Date(t + PERTH_OFFSET_MS);
    return { y: p.getUTCFullYear(), m: p.getUTCMonth() + 1, d: p.getUTCDate(), dow: p.getUTCDay(), h: p.getUTCHours(), min: p.getUTCMinutes() };
  }

  function dayMonth(p, yearNow) {
    return p.d + '/' + p.m + (p.y !== (yearNow || perthYearNow()) ? '/' + p.y : '');
  }

  function installText(row, yearNow) {
    var next = parseDay(row && row.next_scheduled_date);
    if (next) return 'Install ' + DOW[next.dow] + ' ' + dayMonth(next, yearNow);
    var last = parseDay(row && row.last_scheduled_date);
    if (last) return 'Last booked ' + dayMonth(last, yearNow);
    return 'Not booked';
  }

  function stampText(v, yearNow) {
    var p = parseStamp(v);
    if (!p) return '';
    var h12 = p.h % 12 || 12;
    return DOW[p.dow] + ' ' + dayMonth(p, yearNow) + ' ' + h12 + ':' + (p.min < 10 ? '0' : '') + p.min + (p.h < 12 ? 'am' : 'pm');
  }

  // Whole dollars, rounded half up. Null when there is no price on record, so
  // the header can never print "$0".
  function priceText(row) {
    var v = Number(row && row.value);
    if (!isFinite(v) || v <= 0) return null;
    var n = Math.floor(v + 0.5);
    if (n < 1) return null;
    return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // A list row's work type is the server's work_type, never its stored type: a
  // repair-family job stored as make-safe arrives as work_type 'repair'. A row
  // without one is a failed read (rowsFromPipeline), so there is no fallback.
  function typeKey(row) {
    var t = text(row && row.work_type).toLowerCase();
    return /^[a-z0-9_-]+$/.test(t) ? t : '';
  }

  // job_detail's job carries only the stored type.
  function storedTypeKey(job) {
    var t = text(job && job.type).toLowerCase();
    return /^[a-z0-9_-]+$/.test(t) ? t : '';
  }

  function typeLabel(row) {
    var k = typeKey(row);
    return TYPE_LABELS[k] || (k ? k.replace(/_/g, ' ') : 'Job');
  }

  function jobTitle(row) {
    var num = text(row && row.job_number) || 'No job number';
    var sub = text(row && row.site_suburb);
    return sub ? num + ' · ' + sub : num;
  }

  // Merge the status columns of a dispatch=1 answer into one newest-first
  // list. Throws when the answer is not the dispatch read, so the caller shows
  // the failed-read line instead of a short or mislabelled list.
  function rowsFromPipeline(resp) {
    if (!resp || typeof resp !== 'object' || !resp.columns || typeof resp.columns !== 'object') {
      throw new Error('Unexpected job list answer');
    }
    var rows = [];
    Object.keys(resp.columns).forEach(function (col) {
      var list = resp.columns[col];
      if (Array.isArray(list)) list.forEach(function (r) { if (r && typeof r === 'object') rows.push(r); });
    });
    rows.forEach(function (r) {
      if (typeof r.value_inc_gst !== 'boolean' || !('description' in r) || typeof r.work_type !== 'string' || !r.work_type.trim()) {
        throw new Error('Job list answer is missing the Dispatch fields');
      }
    });
    rows.sort(function (a, b) {
      var ta = Date.parse(a.updated_at) || 0, tb = Date.parse(b.updated_at) || 0;
      return tb - ta;
    });
    return {
      rows: rows,
      total: typeof resp.total === 'number' ? resp.total : rows.length,
      degraded: resp.degraded === true
    };
  }

  function filterByType(rows, type) {
    if (!type || type === 'all') return rows;
    return rows.filter(function (r) { return typeKey(r) === type; });
  }

  // Short label for the collapsed strip: the job number without its prefix
  // letters, or the whole number where two listed jobs would read the same.
  function railLabels(rows) {
    var shortOf = function (r) {
      var num = text(r.job_number);
      var s = num.replace(/^[A-Za-z]+[-\s]*/, '');
      return s || num;
    };
    var seen = {};
    rows.forEach(function (r) { var s = shortOf(r); seen[s] = (seen[s] || 0) + 1; });
    var out = {};
    rows.forEach(function (r) {
      var s = shortOf(r);
      out[r.id] = (seen[s] > 1 ? text(r.job_number) : s) || '?';
    });
    return out;
  }

  function parseScope(scope_json) {
    if (scope_json == null || scope_json === '') return null;
    if (typeof scope_json === 'string') {
      try { return JSON.parse(scope_json); } catch (e) { return null; }
    }
    return scope_json;
  }

  function hasFenceShape(scope) {
    var job = scope && scope.job;
    return !!((job && Array.isArray(job.runs) && job.runs.length) ||
      (job && Array.isArray(job.gates) && job.gates.length) ||
      (scope && Array.isArray(scope.sections) && scope.sections.length));
  }

  function plain(v) {
    return (typeof v === 'string' || typeof v === 'number') && text(v) !== '' ? text(v) : '';
  }

  // The scope facts, label and value, through the same field picks the Jobs
  // tab's renderScopeSummary (ops.html) uses. Values are printed as stored.
  // Shape decides between the fence and patio picks, as the server's
  // description line does, so a repair scoped in the fence tool reads right.
  function scopeFacts(scope_json, jobType) {
    var scope = parseScope(scope_json);
    if (!scope || typeof scope !== 'object') return [];
    var facts = [];
    if (jobType === 'fencing' || hasFenceShape(scope)) {
      var fenceJob = scope.job || {};
      var runs = fenceJob.runs || scope.sections || [];
      if (!Array.isArray(runs)) runs = [];
      if (runs.length > 0) {
        var metres = runs.reduce(function (s, r) { return s + (parseFloat(r && r.length) || 0); }, 0);
        var panels = runs.reduce(function (s, r) { return s + ((r && Array.isArray(r.panels)) ? r.panels.length : 0); }, 0);
        facts.push(['Total', metres.toFixed(1) + 'm fence across ' + runs.length + ' run' + (runs.length === 1 ? '' : 's')]);
        if (panels > 0) facts.push(['Panels', String(panels)]);
        var colour = plain(fenceJob.sheetColour) || plain(fenceJob.colour);
        if (colour) facts.push(['Colour', colour]);
        var profile = plain(fenceJob.profile);
        if (profile) facts.push(['Profile', profile]);
        runs.forEach(function (r, i) {
          r = r || {};
          facts.push(['Run ' + (i + 1), (plain(r.length) || '0') + 'm, ' + (plain(r.sheetHeight) || '1800') + 'mm high' + (r.retaining ? ', retaining' : '')]);
        });
      }
      var gates = fenceJob.gates || scope.gates || [];
      if (Array.isArray(gates) && gates.length > 0) {
        facts.push(['Gates (' + gates.length + ')', gates.map(function (g) {
          g = g || {};
          return (plain(g.type) || 'pedestrian') + ' (' + (plain(g.width) || '900') + 'mm)';
        }).join(', ')]);
      }
      var removal = fenceJob.removal || scope.removal;
      if (removal && (removal.length > 0 || removal.totalMetres > 0)) {
        facts.push(['Removal', (removal.totalMetres || removal.length || 0) + 'm old fence']);
      }
      return facts;
    }
    var config = (scope.config && typeof scope.config === 'object') ? scope.config : scope;
    if (config.length || config.projection) {
      var size = (plain(config.length) || '?') + 'm × ' + (plain(config.projection) || '?') + 'm';
      var area = Number(config.length) * Number(config.projection);
      if (config.length && config.projection && isFinite(area)) size += ' (' + area.toFixed(1) + 'm²)';
      facts.push(['Size', size]);
    }
    if (plain(config.roofStyle)) facts.push(['Roof style', plain(config.roofStyle)]);
    var roofing = plain(config.roofing) || plain(config.panel_type);
    if (roofing) facts.push(['Roofing', roofing]);
    if (plain(config.connection)) facts.push(['Connection', plain(config.connection)]);
    if (plain(config.sheetColor)) facts.push(['Sheet colour', plain(config.sheetColor)]);
    if (plain(config.steelColor)) facts.push(['Steel colour', plain(config.steelColor)]);
    var posts = config.posts;
    var postCount = plain(config.post_count) || plain(posts && posts.count) || plain(posts);
    if (postCount) {
      facts.push(['Posts', postCount + ' × ' + (plain(config.post_size) || plain(posts && posts.size) || '100x100 SHS')]);
    }
    return facts;
  }

  // The scoper's own notes from the scope tools. Fence tool: the field list
  // fenceScopingNoteFields (ops.html) owns, shared with the Jobs tab. Patio
  // tool: its notes key.
  function scoperNotes(scope_json) {
    var scope = parseScope(scope_json);
    if (!scope || typeof scope !== 'object') return [];
    var out = [];
    var add = function (label, v) { var s = plain(v); if (s) out.push([label, s]); };
    global.fenceScopingNoteFields(scope).forEach(function (f) { add(f.key, f.text); });
    var notes = scope.notes;
    if (typeof notes === 'string') add('', notes);
    else if (notes && typeof notes === 'object') {
      add('internal', notes.noteInternal);
      add('material order', notes.noteMaterialOrder);
      add('work order', notes.noteWorkOrder);
      add('quote', notes.noteQuote);
      add('pricing', notes.pricingNotes);
    }
    return out;
  }

  function scopePhotos(media) {
    if (!Array.isArray(media)) return [];
    return media.filter(function (m) {
      return m && m.phase === 'scope' && m.type === 'photo' && safeUrl(m.storage_url || m.thumbnail_url);
    });
  }

  // The quote the customer signed, else the newest one sent to them. The line
  // is called "Signed quote" only when an acceptance is on record.
  function pickQuote(documents, yearNow) {
    if (!Array.isArray(documents)) return null;
    var quotes = documents.filter(function (d) { return d && d.type === 'quote'; });
    var newest = function (list) {
      return list.slice().sort(function (a, b) {
        var d = (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
        return d || ((Number(b.version) || 0) - (Number(a.version) || 0));
      })[0] || null;
    };
    var doc = newest(quotes.filter(function (d) { return !!d.accepted_at; }));
    var accepted = !!doc;
    if (!doc) doc = newest(quotes.filter(function (d) { return d.sent_to_client === true; }));
    if (!doc) return null;
    var name = plain(doc.quote_number) || 'Quote';
    if (plain(doc.version)) name += ' v' + plain(doc.version);
    var when = parseStamp(accepted ? doc.accepted_at : doc.sent_at);
    var url = safeUrl(doc.storage_url) || safeUrl(doc.pdf_url);
    if (!url && plain(doc.share_token) && doc.sent_to_client === true) {
      var base = safeUrl(global.SUPABASE_URL);
      if (base) url = base.replace(/\/+$/, '') + '/functions/v1/send-quote/view?token=' + encodeURIComponent(plain(doc.share_token));
    }
    return {
      label: accepted ? 'Signed quote' : 'Quote sent',
      name: name,
      detail: (accepted ? 'accepted' : 'sent') + (when ? ' ' + dayMonth(when, yearNow) : ''),
      url: url
    };
  }

  function councilText(row) {
    if (!row) return '';
    var status = text(row.council_status).toLowerCase();
    var step = text(row.council_step);
    if (!status && !step && row.council_required !== true) return '';
    var words = status === 'complete' ? 'approved'
      : status ? status.replace(/_/g, ' ')
      : step ? 'in progress' : 'required, not started';
    return words + (step && status !== 'complete' ? ', step ' + step : '');
  }

  // ───────────────────────── state ─────────────────────────

  function readStore(store, key) { try { return global[store].getItem(key); } catch (e) { return null; } }
  function writeStore(store, key, value) { try { global[store].setItem(key, value); } catch (e) { /* private mode */ } }

  var state = {
    type: 'all',
    search: '',
    leftOpen: readStore('localStorage', LS_LEFT) !== '0',
    scopeOpen: readStore('localStorage', LS_SCOPE) !== '0',
    base: { status: 'idle', rows: [], total: null, degraded: false },
    found: { status: 'idle', rows: [], degraded: false, q: '' },
    jobId: null,
    row: null,
    rowStale: false,
    detail: { jobId: null, status: 'idle', data: null },
    notes: { jobId: null, status: 'idle', items: [] },
    drafts: {},
    saving: {},
    noteMsg: {}
  };
  var tokens = { base: 0, found: 0, fill: 0 };
  var searchTimer = null;
  var photoUrls = [];

  function root() { return document.getElementById(ROOT_ID); }
  function region(name) { var r = root(); return r ? r.querySelector('[data-dpc-region="' + name + '"]') : null; }
  function searching() { return state.search.trim() !== ''; }

  function listedRows() {
    return filterByType(searching() ? state.found.rows : state.base.rows, state.type);
  }

  // ───────────────────────── reads ─────────────────────────

  function loadBase() {
    var token = ++tokens.base;
    if (state.base.status !== 'ok') { state.base.status = 'loading'; paintList(); paintWorkspace(); }
    return Promise.resolve().then(function () { return global.opsFetch('pipeline', { dispatch: 1 }); }).then(function (resp) {
      if (token !== tokens.base) return;
      var got = rowsFromPipeline(resp);
      state.base = { status: 'ok', rows: got.rows, total: got.total, degraded: got.degraded };
      adoptSelection();
    }).catch(function () {
      if (token !== tokens.base) return;
      state.base = { status: 'error', rows: [], total: null, degraded: false };
      state.rowStale = true;
      paintList();
      paintWorkspace();
    });
  }

  // After a list read: keep the open job if it is still known, else open the
  // one remembered for this session, else the first job in the list. An open
  // job (one reached by search included) keeps its section as drawn: only the
  // list, the header and the Council line (the facts the list carries) are
  // redrawn, so typing and the list's place are kept.
  function adoptSelection() {
    state.rowStale = false;
    var rows = state.base.rows;
    var byId = function (id) { for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i]; return null; };
    var current = state.jobId ? byId(state.jobId) : null;
    if (current) state.row = current;
    paintList(true);
    if (state.jobId && state.row) { paintHead(); paintCouncil(); return; }
    var pick = byId(readStore('sessionStorage', SS_JOB)) || rows[0] || null;
    if (pick) selectJob(pick); else paintWorkspace();
  }

  function runSearch() {
    var q = state.search.trim();
    var token = ++tokens.found;
    if (!q) { state.found = { status: 'idle', rows: [], degraded: false, q: '' }; paintList(); return; }
    state.found = { status: 'loading', rows: [], degraded: false, q: q };
    paintList();
    Promise.resolve().then(function () { return global.opsFetch('pipeline', { dispatch: 1, search: q }); }).then(function (resp) {
      if (token !== tokens.found) return;
      var got = rowsFromPipeline(resp);
      state.found = { status: 'ok', rows: got.rows, degraded: got.degraded, q: q };
      paintList();
    }).catch(function () {
      if (token !== tokens.found) return;
      state.found = { status: 'error', rows: [], degraded: false, q: q };
      paintList();
    });
  }

  // job_detail writes annotation rows as a side effect, so it is read once per
  // job open (and on an explicit Retry), never on hover or in a loop.
  function loadDetail(jobId) {
    state.detail = { jobId: jobId, status: 'loading', data: null };
    paintScope();
    Promise.resolve().then(function () { return global.opsFetch('job_detail', { jobId: jobId }); }).then(function (data) {
      if (state.detail.jobId !== jobId) return;
      if (!data || typeof data !== 'object' || !data.job || typeof data.job !== 'object') throw new Error('Unexpected job answer');
      state.detail = { jobId: jobId, status: 'ok', data: data };
      paintScope();
    }).catch(function () {
      if (state.detail.jobId !== jobId) return;
      state.detail = { jobId: jobId, status: 'error', data: null };
      paintScope();
    });
  }

  // job_notes writes nothing, so it is safe after a save and on Retry.
  function loadNotes(jobId, keepShown) {
    if (!(keepShown && state.notes.jobId === jobId && state.notes.status === 'ok')) {
      state.notes = { jobId: jobId, status: 'loading', items: [] };
      paintNotes();
    }
    return Promise.resolve().then(function () { return global.opsFetch('job_notes', { jobId: jobId }); }).then(function (resp) {
      if (state.notes.jobId !== jobId) return;
      if (!resp || typeof resp !== 'object' || !Array.isArray(resp.notes)) throw new Error('Unexpected notes answer');
      state.notes = { jobId: jobId, status: 'ok', items: resp.notes };
      paintNotes();
    }).catch(function () {
      if (state.notes.jobId !== jobId) return;
      state.notes = { jobId: jobId, status: 'error', items: [] };
      paintNotes();
    });
  }

  function selectJob(row) {
    if (!row || !row.id) return;
    var same = state.jobId === row.id;
    var stale = state.rowStale;
    state.jobId = row.id;
    state.row = row;
    state.rowStale = false;
    writeStore('sessionStorage', SS_JOB, row.id);
    markSelected();
    if (same && state.detail.jobId === row.id) { // already open: no second read
      if (stale) paintWorkspace();
      return;
    }
    state.detail = { jobId: row.id, status: 'loading', data: null };
    state.notes = { jobId: row.id, status: 'loading', items: [] };
    paintWorkspace();
    loadDetail(row.id);
    loadNotes(row.id);
  }

  // The one write this module makes.
  function saveNote() {
    var jobId = state.jobId;
    var body = (state.drafts[jobId] || '').trim();
    if (!jobId || !body || state.saving[jobId]) return;
    state.saving[jobId] = true;
    state.noteMsg[jobId] = null;
    paintComposer();
    Promise.resolve().then(function () {
      return global.opsPost('add_note', { job_id: jobId, text: body, visibility: 'internal_only', from_ops: true });
    }).then(function () {
      state.saving[jobId] = false;
      state.drafts[jobId] = '';
      state.noteMsg[jobId] = { ok: true, text: 'Note saved.' };
      if (state.jobId === jobId) { paintComposer(); loadNotes(jobId, true); }
    }, function () {
      state.saving[jobId] = false;
      state.noteMsg[jobId] = { ok: false, text: 'Note not saved. Your text is still here.' };
      if (state.jobId === jobId) paintComposer();
    });
  }

  // ───────────────────────── render: sidebar ─────────────────────────

  function failLine(message, retry, tight) {
    return '<div class="dpc-empty' + (tight ? ' dpc-empty-tight' : '') + '" role="alert">' + esc(message) +
      ' <button type="button" class="dpc-retry" data-dpc-retry="' + retry + '">Retry</button></div>';
  }

  function cardHtml(row) {
    var k = typeKey(row);
    var h = '<button type="button" class="dpc-job" data-dpc-job="' + esc(row.id) + '" aria-pressed="' + (row.id === state.jobId) + '">';
    h += '<span class="dpc-job-top"><span class="dpc-type' + (k ? ' dpc-type-' + k : '') + '">' + esc(typeLabel(row)) + '</span></span>';
    h += '<strong>' + esc(jobTitle(row)) + '</strong>';
    if (text(row.description)) h += '<span>' + esc(text(row.description)) + '</span>';
    h += '<span class="dpc-muted">' + esc(installText(row)) + '</span>';
    return h + '</button>';
  }

  function railHtml(row, labels) {
    var k = typeKey(row);
    return '<button type="button" class="dpc-rail-job' + (k ? ' dpc-rail-' + k : '') + '" data-dpc-job="' + esc(row.id) + '" aria-pressed="' + (row.id === state.jobId) +
      '" title="' + esc(jobTitle(row)) + '" aria-label="' + esc(jobTitle(row)) + '">' + esc(labels[row.id]) + '</button>';
  }

  // The whole list is always drawn, never capped: the first cards at once and
  // the rest over the next frames, so a long list does not stall the tab.
  function fill(container, rows, toHtml, first) {
    var token = ++tokens.fill;
    var at = Math.max(FIRST_CHUNK, first || 0);
    container.insertAdjacentHTML('beforeend', rows.slice(0, at).map(toHtml).join(''));
    var step = function () {
      if (token !== tokens.fill || at >= rows.length || !container.isConnected) return;
      container.insertAdjacentHTML('beforeend', rows.slice(at, at + NEXT_CHUNK).map(toHtml).join(''));
      at += NEXT_CHUNK;
      global.requestAnimationFrame(step);
    };
    if (at < rows.length) global.requestAnimationFrame(step);
  }

  // What the list area says when it is not showing jobs, or '' when it is.
  function listState() {
    if (searching()) {
      if (state.found.status === 'error') return failLine('Search failed.', 'search');
      if (state.found.status !== 'ok') return '<div class="dpc-empty">Searching...</div>';
      return listedRows().length ? '' : '<div class="dpc-empty">No jobs match.</div>';
    }
    if (state.base.status === 'error') return failLine('Could not load jobs.', 'list');
    if (state.base.status !== 'ok') return '<div class="dpc-empty">Loading jobs...</div>';
    if (listedRows().length) return '';
    if (state.type === 'all') return '<div class="dpc-empty">No jobs to show.</div>';
    return '<div class="dpc-empty">No ' + esc((TYPE_LABELS[state.type] || state.type).toLowerCase()) + ' jobs.</div>';
  }

  function degradedNow() {
    return searching() ? (state.found.status === 'ok' && state.found.degraded) : (state.base.status === 'ok' && state.base.degraded);
  }

  function modeHtml() {
    var pressed = !searching() && state.type === 'all';
    var count = state.base.status === 'ok' ? ' <b>' + esc(state.base.total) + '</b>' : '';
    return '<button type="button" data-dpc-reset aria-pressed="' + pressed + '">All jobs' + count + '</button>';
  }

  function chipsHtml() {
    return TYPES.map(function (t) {
      return '<button type="button" data-dpc-type="' + t.key + '" aria-pressed="' + (state.type === t.key) + '">' + esc(t.label) + '</button>';
    }).join('');
  }

  function queueHtml() {
    if (!state.leftOpen) {
      var r = '<aside class="dpc-panel dpc-queue dpc-rail" data-dpc-region="queue" aria-label="Accepted work, collapsed">';
      r += '<button type="button" class="dpc-side-btn" data-dpc-side aria-label="Open accepted work" title="Open accepted work">&raquo;</button>';
      r += '<span data-dpc-region="railhead"></span><div class="dpc-rail-list" data-dpc-region="list"></div>';
      return r + '</aside>';
    }
    var h = '<aside class="dpc-panel dpc-queue" data-dpc-region="queue" aria-label="Accepted work">';
    h += '<div class="dpc-pad"><div class="dpc-row"><h3 class="dpc-grow">Accepted work</h3>';
    h += '<button type="button" class="dpc-side-btn" data-dpc-side aria-label="Collapse accepted work" title="Collapse">&laquo;</button></div>';
    h += '<div class="dpc-mode" data-dpc-region="mode">' + modeHtml() + '</div>';
    h += '<div class="dpc-chips" role="group" aria-label="Work type" data-dpc-region="chips">' + chipsHtml() + '</div>';
    h += '<input type="search" class="dpc-search" data-dpc-search placeholder="Search job, suburb or client" value="' + esc(state.search) + '" aria-label="Search jobs">';
    h += '</div><div class="dpc-job-list" data-dpc-region="list"></div>';
    h += '<div class="dpc-foot">All jobs: any job through the Dispatch lens, to check what was ordered and sent.</div>';
    return h + '</aside>';
  }

  // Repaints the list (or the strip's buttons) without touching the search
  // box, so typing is never interrupted. keepPlace redraws as many jobs at
  // once as were drawn and puts the list back where it was scrolled to.
  function paintList(keepPlace) {
    var list = region('list');
    if (!list) return;
    tokens.fill++;
    var drawn = keepPlace ? list.querySelectorAll('[data-dpc-job]').length : 0;
    var top = list.scrollTop;
    var focused = list.contains(document.activeElement) ? document.activeElement.getAttribute('data-dpc-job') : null;
    // Updated in place so a pressed button keeps the keyboard focus.
    var mode = region('mode');
    if (mode && mode.innerHTML !== modeHtml()) {
      var hadFocus = mode.contains(document.activeElement);
      mode.innerHTML = modeHtml();
      if (hadFocus) mode.querySelector('button').focus();
    }
    var chips = region('chips');
    if (chips) Array.prototype.forEach.call(chips.querySelectorAll('[data-dpc-type]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-dpc-type') === state.type));
    });
    var stateHtml = listState();
    var rows = stateHtml ? [] : listedRows();
    if (!state.leftOpen) {
      var failed = searching() ? state.found.status === 'error' : state.base.status === 'error';
      var ready = searching() ? state.found.status === 'ok' : state.base.status === 'ok';
      var head = region('railhead');
      if (head) {
        head.innerHTML = failed
          ? '<button type="button" class="dpc-side-btn" data-dpc-retry="' + (searching() ? 'search' : 'list') + '" aria-label="' + (searching() ? 'Search failed. Retry' : 'Could not load jobs. Retry') + '" title="' + (searching() ? 'Search failed. Retry' : 'Could not load jobs. Retry') + '">&#8635;</button>'
          : ready ? '<span class="dpc-rail-count" title="Jobs listed">' + rows.length + '</span>' : '';
      }
      list.innerHTML = '';
      if (rows.length) { var labels = railLabels(rows); fill(list, rows, function (row) { return railHtml(row, labels); }, drawn); }
      refocusJob(list, focused);
      if (keepPlace) list.scrollTop = top;
      return;
    }
    list.innerHTML = stateHtml || (degradedNow() ? failLine('Some job details did not load.', searching() ? 'search' : 'list') : '');
    if (rows.length) fill(list, rows, cardHtml, drawn);
    refocusJob(list, focused);
    if (keepPlace) list.scrollTop = top;
  }

  // The list was rebuilt: put the keyboard focus back on the job it was on.
  function refocusJob(list, jobId) {
    if (!jobId) return;
    var cards = list.querySelectorAll('[data-dpc-job]');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute('data-dpc-job') === jobId) { cards[i].focus({ preventScroll: true }); return; }
    }
  }

  function paintQueue() {
    var q = region('queue');
    if (!q) return;
    q.outerHTML = queueHtml();
    var layout = root().querySelector('.dpc-layout');
    if (layout) layout.classList.toggle('dpc-left-closed', !state.leftOpen);
    paintList();
  }

  function markSelected() {
    var r = root();
    if (!r) return;
    Array.prototype.forEach.call(r.querySelectorAll('[data-dpc-job]'), function (el) {
      el.setAttribute('aria-pressed', String(el.getAttribute('data-dpc-job') === state.jobId));
    });
  }

  // ───────────────────────── render: the job ─────────────────────────

  function headHtml(row) {
    var price = priceText(row);
    var k = typeKey(row);
    var h = '<div class="dpc-jobhead" data-dpc-region="head"><div class="dpc-row"><h2 class="dpc-grow">' + esc(jobTitle(row)) + '</h2>';
    h += price
      ? '<span class="dpc-price">' + esc(price) + (row.value_inc_gst === true ? ' <small>inc GST</small>' : '') + '</span>'
      : '<span class="dpc-price-none">No price on record</span>';
    h += '</div>';
    if (text(row.description)) h += '<p>' + esc(text(row.description)) + '</p>';
    h += '<div class="dpc-pills"><span class="dpc-type' + (k ? ' dpc-type-' + k : '') + '">' + esc(typeLabel(row)) + '</span>';
    h += '<span class="dpc-pill">' + esc(installText(row)) + '</span></div>';
    return h + '</div>';
  }

  function scopeHtml() {
    var row = state.row;
    var d = state.detail;
    var h = '';
    photoUrls = [];
    if (d.status === 'error') {
      h += '<div class="dpc-scope-state">' + failLine('Could not load the scope.', 'detail', true) + failLine('Could not load photos.', 'detail', true) + '</div>';
    } else if (d.status !== 'ok') {
      h += '<div class="dpc-scope-state"><div class="dpc-empty dpc-empty-tight">Loading scope and photos...</div></div>';
    } else {
      var job = d.data.job;
      var scope = parseScope(job.scope_json);
      var facts = scopeFacts(scope, storedTypeKey(job) || typeKey(row));
      if (facts.length) {
        h += '<div class="dpc-facts">';
        facts.forEach(function (f) { h += '<div><span>' + esc(f[0]) + '</span><strong>' + esc(f[1]) + '</strong></div>'; });
        h += '</div>';
      } else if (scope && typeof scope === 'object' && Object.keys(scope).length) {
        h += '<div class="dpc-empty dpc-empty-tight">A scope is saved on this job, but it holds none of the facts this view reads.</div>';
      } else {
        h += '<div class="dpc-empty dpc-empty-tight">No scope saved on this job.</div>';
      }
      if (!Array.isArray(d.data.media)) {
        h += '<div class="dpc-scope-state">' + failLine('Could not load photos.', 'detail', true) + '</div>';
      } else {
        var photos = scopePhotos(d.data.media);
        if (!photos.length) {
          h += '<div class="dpc-scope-state"><div class="dpc-empty dpc-empty-tight">No scope photos on this job.</div></div>';
        } else {
          h += '<div class="dpc-photos' + (photos.length > 5 ? ' dpc-photos-many' : '') + '">';
          photos.forEach(function (m, i) {
            var full = safeUrl(m.storage_url) || safeUrl(m.thumbnail_url);
            var thumb = safeUrl(m.thumbnail_url) || full;
            var label = text(m.label);
            photoUrls.push(full);
            h += '<button type="button" class="dpc-photo" data-dpc-photo="' + i + '" aria-label="Open scope photo ' + (i + 1) + (label ? ': ' + esc(label) : '') + '">';
            h += '<img src="' + esc(thumb) + '" alt="" loading="lazy" onerror="this.remove()">';
            if (label) h += '<span>' + esc(label) + '</span>';
            h += '</button>';
          });
          h += '</div>';
        }
      }
      var quote = pickQuote(d.data.documents);
      if (quote) {
        h += '<p class="dpc-scope-line"><strong>' + esc(quote.label) + ':</strong> ';
        h += quote.url ? '<a href="' + esc(quote.url) + '" target="_blank" rel="noopener">' + esc(quote.name) + '</a>' : esc(quote.name);
        h += ', ' + esc(quote.detail) + '</p>';
      }
      scoperNotes(scope).forEach(function (n) {
        h += '<p class="dpc-scope-line"><strong>Scoper notes' + (n[0] ? ' (' + esc(n[0]) + ')' : '') + ':</strong> ' + esc(n[1]) + '</p>';
      });
    }
    return h;
  }

  function councilHtml() {
    var council = councilText(state.row);
    return council ? '<p class="dpc-scope-line"><strong>Council:</strong> ' + esc(council) + '</p>' : '';
  }

  function notesHtml() {
    var n = state.notes;
    if (n.status === 'error') return failLine('Could not load notes.', 'notes', true);
    if (n.status !== 'ok') return '<div class="dpc-empty dpc-empty-tight">Loading notes...</div>';
    if (!n.items.length) return '<div class="dpc-empty dpc-empty-tight">No notes saved on this job yet.</div>';
    return n.items.map(function (note) {
      note = note || {};
      var meta = [text(note.author), stampText(note.created_at)].filter(Boolean).join(', ');
      return '<div class="dpc-note-saved">' + esc(text(note.text)) + (meta ? '<small>' + esc(meta) + '</small>' : '') + '</div>';
    }).join('');
  }

  function composerHtml() {
    var jobId = state.jobId;
    var saving = !!state.saving[jobId];
    var draft = state.drafts[jobId] || '';
    var msg = state.noteMsg[jobId];
    var h = '<div class="dpc-inline"><textarea class="dpc-textarea" data-dpc-note placeholder="Add a note to this job..." aria-label="Add a note to this job"' + (saving ? ' disabled' : '') + '>' + esc(draft) + '</textarea>';
    h += '<button type="button" data-dpc-save' + (saving || !draft.trim() ? ' disabled' : '') + '>' + (saving ? 'Saving...' : 'Save note') + '</button></div>';
    if (msg) h += '<div class="dpc-note-msg' + (msg.ok ? '' : ' dpc-note-msg-fail') + '" role="' + (msg.ok ? 'status' : 'alert') + '">' + esc(msg.text) + '</div>';
    return h;
  }

  function sectionHtml() {
    var open = state.scopeOpen;
    var h = '<div class="dpc-sec' + (open ? '' : ' dpc-collapsed') + '"><div class="dpc-sec-head"><div class="dpc-grow"><span class="dpc-eyebrow">Before ordering</span><h3>Scope and notes</h3>';
    if (open) h += '<p>From the scope tool, plus notes saved on the job</p>';
    h += '</div><button type="button" class="dpc-chev" data-dpc-toggle aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse' : 'Expand') + ' Scope and notes">';
    h += '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>';
    if (open) {
      h += '<div class="dpc-sec-body"><div data-dpc-region="scope">' + scopeHtml() + '</div>';
      h += '<div data-dpc-region="council">' + councilHtml() + '</div>';
      h += '<div data-dpc-region="notes">' + notesHtml() + '</div>';
      h += '<div data-dpc-region="composer">' + composerHtml() + '</div></div>';
    }
    return h + '</div>';
  }

  function workspaceHtml() {
    var h = '<section class="dpc-workspace" data-dpc-region="workspace" aria-label="Job">';
    if (state.base.status === 'error' && state.rowStale) {
      // No stale job: the header facts come from the list read that failed. A
      // job opened since, from a search that did load, is shown.
      h += '<div class="dpc-jobhead">' + failLine('Could not load this job.', 'list', true) + '</div>';
    } else if (!state.row) {
      h += '<div class="dpc-jobhead"><div class="dpc-empty dpc-empty-tight">' + (state.base.status === 'ok' ? 'No job to show.' : 'Loading jobs...') + '</div></div>';
    } else {
      h += headHtml(state.row) + sectionHtml();
    }
    return h + '</section>';
  }

  function paintWorkspace() {
    var w = region('workspace');
    if (w) w.outerHTML = workspaceHtml();
  }
  function paintHead() { var el = region('head'); if (el) el.outerHTML = headHtml(state.row); }
  function paintCouncil() { var el = region('council'); if (el) el.innerHTML = councilHtml(); }
  function paintScope() { var el = region('scope'); if (el) el.innerHTML = scopeHtml(); }
  function paintNotes() { var el = region('notes'); if (el) el.innerHTML = notesHtml(); }
  function paintComposer() {
    var el = region('composer');
    if (!el) return;
    var had = el.contains(document.activeElement) && document.activeElement.hasAttribute('data-dpc-note');
    el.innerHTML = composerHtml();
    if (had) { var t = el.querySelector('[data-dpc-note]'); if (t && !t.disabled) t.focus(); }
  }

  function render() {
    var r = root();
    if (!r) return;
    var h = '<div class="dpc"><div class="dpc-header"><h1>Dispatch</h1><p>Accepted work, what each job needs, and how the materials get to site.</p></div>';
    h += '<div class="dpc-layout' + (state.leftOpen ? '' : ' dpc-left-closed') + '">' + queueHtml() + workspaceHtml() + '</div></div>';
    r.innerHTML = h;
    paintList();
  }

  // ───────────────────────── events ─────────────────────────

  function rowById(id) {
    var lists = [state.found.rows, state.base.rows];
    for (var l = 0; l < lists.length; l++) for (var i = 0; i < lists[l].length; i++) if (lists[l][i].id === id) return lists[l][i];
    return null;
  }

  // A repaint replaces the pressed control; put the keyboard focus back on it.
  function refocus(selector) {
    var el = root().querySelector(selector);
    if (el) el.focus();
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-dpc-job],[data-dpc-type],[data-dpc-reset],[data-dpc-side],[data-dpc-toggle],[data-dpc-retry],[data-dpc-photo],[data-dpc-save]') : null;
    if (!t || t.disabled) return;
    if (t.hasAttribute('data-dpc-job')) { selectJob(rowById(t.getAttribute('data-dpc-job'))); }
    else if (t.hasAttribute('data-dpc-type')) { state.type = t.getAttribute('data-dpc-type'); paintList(); }
    else if (t.hasAttribute('data-dpc-reset')) {
      state.type = 'all';
      state.search = '';
      clearTimeout(searchTimer);
      var box = root().querySelector('[data-dpc-search]');
      if (box) box.value = '';
      runSearch();
    }
    else if (t.hasAttribute('data-dpc-side')) {
      state.leftOpen = !state.leftOpen;
      writeStore('localStorage', LS_LEFT, state.leftOpen ? '1' : '0');
      paintQueue();
      refocus('[data-dpc-side]');
    }
    else if (t.hasAttribute('data-dpc-toggle')) {
      state.scopeOpen = !state.scopeOpen;
      writeStore('localStorage', LS_SCOPE, state.scopeOpen ? '1' : '0');
      paintWorkspace();
      refocus('[data-dpc-toggle]');
    }
    else if (t.hasAttribute('data-dpc-retry')) {
      var what = t.getAttribute('data-dpc-retry');
      if (what === 'list') loadBase();
      else if (what === 'search') runSearch();
      else if (what === 'detail' && state.jobId) loadDetail(state.jobId);
      else if (what === 'notes' && state.jobId) loadNotes(state.jobId);
    }
    else if (t.hasAttribute('data-dpc-photo')) {
      var url = photoUrls[+t.getAttribute('data-dpc-photo')];
      if (url) global.openOpsLightbox(url);
    }
    else if (t.hasAttribute('data-dpc-save')) { saveNote(); }
  }

  function onInput(e) {
    var t = e.target;
    if (!t || !t.hasAttribute) return;
    if (t.hasAttribute('data-dpc-search')) {
      state.search = t.value || '';
      clearTimeout(searchTimer);
      if (!searching()) { runSearch(); return; }
      searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
      return;
    }
    if (t.hasAttribute('data-dpc-note') && state.jobId) {
      state.drafts[state.jobId] = t.value;
      var el = region('composer');
      var btn = el && el.querySelector('[data-dpc-save]');
      if (btn) btn.disabled = !t.value.trim() || !!state.saving[state.jobId];
      if (state.noteMsg[state.jobId]) {
        state.noteMsg[state.jobId] = null;
        var msg = el && el.querySelector('.dpc-note-msg');
        if (msg) msg.remove();
      }
    }
  }

  function loadFonts() {
    if (document.querySelector('link[data-dpc-fonts]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS_URL;
    link.setAttribute('data-dpc-fonts', '');
    document.head.appendChild(link);
  }

  var wired = false;
  function show() {
    var r = root();
    if (!r) return;
    if (!wired) {
      loadFonts();
      r.addEventListener('click', onClick);
      r.addEventListener('input', onInput);
      wired = true;
    }
    if (!r.firstChild) render();
    loadBase();
  }

  global.OpsDispatch = { show: show };
})(window);
