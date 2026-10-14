/* <ops-dispatch>
 * Dispatch tab, slice 1: the Dispatch view of any job. A real job list with
 * search and work type buttons, the real job header, and the Scope and notes
 * section with a working Save note. Mounted in #dispatchRoot above the live
 * purchase order board, which this module never touches.
 *
 * Reads (ops-api): pipeline with dispatch=1 (the list, counts and header
 * facts), job_detail once per job open (scope, photos, quote), job_notes
 * (every saved note). Slice 1 writes exactly one thing: add_note, always with
 * visibility 'internal_only' and from_ops true. Without that visibility a note
 * is copied to the customer's contact notes. Add no other write here beyond
 * slice 2's pressed send_sms and slice 3's two stage writes below.
 *
 * A failed read never renders as empty. An ops-api that does not know
 * dispatch=1 answers with rows missing description / value_inc_gst /
 * work_type, and one that does not know job_notes answers Unknown action:
 * both are failed reads.
 *
 * Slice 2 adds the right panel (Sources, Context story, Messages), which
 * collapses to a floating tab. It reuses slice 1's one job_detail result for
 * Sources and reads, each only when its tab is first shown for a job and kept
 * for the session: ops-api job_story (timeline only), ghl-proxy
 * get_conversation (a live GoHighLevel read, never polled) and ops-api
 * get_job_conversation (limit 200, email rows only). get_invoice_pdf is called
 * only when an invoice is pressed. Its one write is ghl-proxy send_sms, from
 * +61489267771, when a person presses Send; it never resends on its own.
 *
 * Slice 3 adds the To do list beside All jobs and the six-stop stage rail
 * (the tape) in the job header. The pipeline dispatch=1 read carries each
 * row's Dispatch stage, To do flag and next-step line, and todo_total. The
 * rail's stage is Dispatch's own record and never the job status (ruling T1).
 * Its two writes, each only on a person's press: ops-api set_dispatch_stage
 * (job_id, stage, expected_stage) after a confirm line, and
 * set_dispatch_next_step (job_id, text). Each writes one job_dispatch_state
 * row and one job_events row and nothing else. This module never calls
 * update_job_status, update_repair_stage or update_job_field. A stage read
 * that failed, or an answer without the stage fields, shows the failed line
 * for To do and the rail, never an empty To do or a rail at Not started.
 *
 * Slice 4 adds Materials by supplier under Scope and notes (never on a
 * make-safe job). Reads: ops-api dispatch_materials once per job open (the
 * job's chosen suppliers, material lines, counts, working out, sketch and its
 * purchase orders, read only), and list_suppliers once a session for Add
 * supplier; the list's materials_lines_total / materials_lines_ready draw a
 * card's "x of y items ready". Its six writes, each sent once on a person's
 * edit or press: dispatch_materials_add_supplier, _remove_supplier,
 * _save_line, _delete_line, _suggest and _save_workings. They touch only
 * Dispatch's own tables: no purchase order, no message, no job status.
 *
 * Guards: tests/e2e/ops-tab-set.spec.js (slices 1, 3 and 4) and
 * tests/e2e/ops-dispatch-panel.spec.js (slice 2).
 * Contracts: secureworks-backend docs/dispatch-slice-1-read-contract.md,
 * docs/dispatch-slice-3-contract.md and docs/dispatch-slice-4-contract.md.
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
  var LS_RIGHT = 'sw_dispatch_right';
  var LS_TAB = 'sw_dispatch_tab';
  var LS_MODE = 'sw_dispatch_mode';
  // The stage rail's six stops, in order (slice 3 build note section 4.1).
  var STAGES = [
    { key: 'accepted', label: 'Accepted' },
    { key: 'deposit_paid', label: 'Deposit paid' },
    { key: 'materials_ordered', label: 'Materials ordered' },
    { key: 'supplier_confirmed', label: 'Supplier confirmed' },
    { key: 'materials_on_site', label: 'Materials on site' },
    { key: 'trade_scheduled', label: 'Trade scheduled' }
  ];
  var STAGE_SOURCES = ['set', 'job_status', 'repairs_board'];
  var TODO_OUT = {
    in_council: 'Not in To do: in council.',
    council_to_come: 'Not in To do: council approval still to come.',
    council_not_decided: 'Not in To do: council not decided on the Jobs tab.'
  };
  var NEXT_STEP_MAX = 40;
  var LS_ORDER = 'sw_dispatch_order_open';
  var LS_WORKOUT = 'sw_dispatch_workout_open';
  var WORKOUT_SAVE_MS = 1200; // the pad saves when typing stops this long
  var TABS = [
    { key: 'sources', label: 'Sources' },
    { key: 'story', label: 'Context story' },
    { key: 'messages', label: 'Messages' }
  ];
  // Company rule: every ops text to a client goes from SecureWorks Group Admin.
  var SMS_FROM = '+61489267771';
  var EMAIL_LIMIT = 200; // the most get_job_conversation returns
  var CHAT_LIMIT = 30; // get_conversation returns the latest 30
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
      // Slice 4's materials_lines_total / materials_lines_ready are only real
      // when the list's materials read worked; a failed one is never 0 of 0.
      if (resp.dispatch_materials !== 'ok') { delete r.materials_lines_total; delete r.materials_lines_ready; }
    });
    rows.sort(function (a, b) {
      var ta = Date.parse(a.updated_at) || 0, tb = Date.parse(b.updated_at) || 0;
      return tb - ta;
    });
    // Slice 3: the stage fields are trusted only when the answer says the stage
    // read worked and every row carries them. Otherwise they are dropped from
    // every row, so no card, list or rail can draw a stage the read did not give.
    var stages = resp.dispatch_stages === 'ok' && typeof resp.todo_total === 'number' &&
      rows.every(function (r) { return typeof r.dispatch_todo === 'boolean' && stageOf(r) !== null; }) ? 'ok' : 'failed';
    if (stages === 'ok') {
      var todo = rows.filter(function (r) { return r.dispatch_todo === true; }).length;
      if (todo !== resp.todo_total) throw new Error('To do count does not match the To do rows');
    } else {
      rows.forEach(function (r) {
        Object.keys(r).forEach(function (k) { if (k.indexOf('dispatch_') === 0) delete r[k]; });
      });
    }
    return {
      rows: rows,
      total: typeof resp.total === 'number' ? resp.total : rows.length,
      degraded: resp.degraded === true,
      stages: stages,
      todoTotal: stages === 'ok' ? resp.todo_total : null
    };
  }

  // ── slice 3: the stage rail's rules ──

  // 0 for not_started, 1 to 6 for the stops, -1 for anything else.
  function stageIndex(key) {
    if (key === 'not_started') return 0;
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === key) return i + 1;
    return -1;
  }

  // A row's Dispatch stage as the read gave it: { none: true } for a make-safe
  // row (no rail), null when the fields are missing or do not agree.
  function stageOf(row) {
    if (!row || !('dispatch_stage' in row) || !('dispatch_stage_index' in row)) return null;
    if (row.dispatch_stage === null && row.dispatch_stage_index === null) return { none: true };
    var i = stageIndex(row.dispatch_stage);
    if (i < 0 || row.dispatch_stage_index !== i || STAGE_SOURCES.indexOf(row.dispatch_stage_source) < 0) return null;
    return {
      key: row.dispatch_stage,
      index: i,
      name: i ? STAGES[i - 1].label : 'Not started',
      source: row.dispatch_stage_source,
      from: text(row.dispatch_stage_from),
      setAt: row.dispatch_stage_set_at,
      setBy: text(row.dispatch_stage_set_by)
    };
  }

  // A label from a table the page already has, else the key in words.
  function keyWords(key) { return text(key).replace(/_/g, ' ') || 'not recorded'; }

  function statusLabel(key) {
    var sm = global.SW_STATE_MACHINE;
    var labels = sm && sm.STATUS_LABELS;
    return (labels && Object.prototype.hasOwnProperty.call(labels, key) && labels[key]) || keyWords(key);
  }

  function repairStageLabel(key) {
    var list = Array.isArray(global.REPAIR_STAGES) ? global.REPAIR_STAGES : [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].key === key && list[i].label) return list[i].label;
    return keyWords(key);
  }

  // Where the rail's place came from, in one line (build note row 15).
  function stageSourceText(s, yearNow) {
    if (s.source === 'set') {
      var when = parseStamp(s.setAt);
      var day = when ? dayText(when, yearNow) : '';
      if (s.setBy) return 'Set by ' + s.setBy + (day ? ', ' + day : '');
      return 'Set' + (day ? ' ' + day : '');
    }
    if (s.source === 'repairs_board') return 'From the Repairs board: ' + repairStageLabel(s.from) + '. Not set in Dispatch yet.';
    return 'From the job status: ' + statusLabel(s.from) + '. Not set in Dispatch yet.';
  }

  // The next-step line as the server stores it: trimmed, runs of space as one.
  function cleanNextStep(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

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

  // The Jobs tab's rule for a scope photo: any scope-phase picture. A picture
  // the office attached is stored as type 'image', so only a video is left out.
  function scopePhotos(media) {
    if (!Array.isArray(media)) return [];
    return media.filter(function (m) {
      return m && m.phase === 'scope' && m.type !== 'video' && safeUrl(m.storage_url || m.thumbnail_url);
    });
  }

  // The quote the customer signed, else the newest one sent to them. The line
  // is called "Signed quote" only when an acceptance is on record. It links to
  // its PDF only, never the customer's share page (send-quote/view): opening
  // that page records a customer view, which is a write. No PDF, no link.
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
    return {
      label: accepted ? 'Signed quote' : 'Quote sent',
      name: name,
      detail: (accepted ? 'accepted' : 'sent') + (when ? ' ' + dayMonth(when, yearNow) : ''),
      url: safeUrl(doc.storage_url) || safeUrl(doc.pdf_url)
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

  // ── slice 2: the right panel's rules ──

  function dayText(p, yearNow) { return p ? DOW[p.dow] + ' ' + dayMonth(p, yearNow) : ''; }

  function newestFirst(list, key) {
    return list.slice().sort(function (a, b) { return (Date.parse(b[key]) || 0) - (Date.parse(a[key]) || 0); });
  }

  // Quotes the client was sent or signed, newest first. A chip opens its stored
  // PDF only: the client's share page (send-quote/view) records a client view
  // when it is opened, so it is never offered here.
  function sourceQuotes(documents, yearNow) {
    var quotes = documents.filter(function (d) { return d && d.type === 'quote' && (d.sent_to_client === true || !!d.accepted_at); });
    quotes = quotes.slice().sort(function (a, b) {
      var d = (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
      return d || ((Number(b.version) || 0) - (Number(a.version) || 0));
    });
    return quotes.map(function (d) {
      var name = 'Quote' + (plain(d.quote_number) ? ' ' + plain(d.quote_number) : '') + (plain(d.version) ? ' v' + plain(d.version) : '');
      var detail;
      if (d.accepted_at) detail = 'Sent and accepted' + (parseStamp(d.accepted_at) ? ' ' + dayMonth(parseStamp(d.accepted_at), yearNow) : '');
      else if (d.superseded_at) detail = 'Superseded';
      else detail = 'Sent' + (parseStamp(d.sent_at) ? ' ' + dayMonth(parseStamp(d.sent_at), yearNow) : '');
      return { name: name, detail: detail, url: safeUrl(d.pdf_url) || safeUrl(d.storage_url) };
    });
  }

  var INVOICE_STATUS = { PAID: 'Paid', AUTHORISED: 'Sent, not paid yet', DRAFT: 'Draft, not issued', SUBMITTED: 'Awaiting approval' };

  // This job's client invoices only. job_detail falls back to invoices matched
  // on the client's name when none is linked to the job; those are not this
  // job's, and neither are supplier bills (ACCPAY) or voided and deleted ones.
  function sourceInvoices(invoices, jobId) {
    var mine = invoices.filter(function (inv) {
      if (!inv || !jobId || inv.job_id !== jobId) return false;
      if (text(inv.invoice_type).toUpperCase() !== 'ACCREC') return false;
      var st = text(inv.status).toUpperCase();
      return st !== 'VOIDED' && st !== 'DELETED';
    });
    return newestFirst(mine, 'invoice_date').map(function (inv) {
      var num = plain(inv.invoice_number) || 'Invoice';
      var st = text(inv.status).toUpperCase();
      return {
        name: (text(inv.reference).indexOf('DEP') >= 0 ? 'Deposit invoice ' : '') + num,
        detail: INVOICE_STATUS[st] || (st ? st.charAt(0) + st.slice(1).toLowerCase() : 'Status not recorded'),
        xeroId: text(inv.xero_invoice_id)
      };
    });
  }

  var STORY_LABELS = {
    first_contact: 'First contact', job_created: 'Job created', site_visit: 'Site visit', quote: 'Quote', status: 'Status',
    invoice: 'Invoice', payment: 'Payment', booking: 'Booking', booking_change: 'Booking change', system_email: 'System email',
    purchase_order: 'Purchase order', supplier_bill: 'Supplier bill', supplier_payment: 'Supplier payment', attendance: 'Attendance',
    note: 'Note', document: 'Document', makesafe: 'Make-safe'
  };

  // A kind the table does not name is still drawn, never dropped.
  function storyLabel(kind) {
    var k = text(kind);
    if (Object.prototype.hasOwnProperty.call(STORY_LABELS, k)) return STORY_LABELS[k];
    var words = k.replace(/_/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Event';
  }

  // job_story's timeline, in the order returned. Throws on any other answer so
  // the tab shows the failed-read line, never the empty one.
  function storyLines(resp) {
    if (!resp || typeof resp !== 'object' || resp.version !== 'job-story-v1' || !Array.isArray(resp.timeline)) {
      throw new Error('Unexpected story answer');
    }
    return resp.timeline;
  }

  // get_conversation answers messages: [] beside its error, so the error is
  // tested first and a rate-limited or failed read is never "no messages".
  function chatMessages(httpOk, data) {
    if (!httpOk || !data || typeof data !== 'object' || data.error || data.rate_limited || !Array.isArray(data.messages)) {
      throw new Error('Chat read failed');
    }
    return data.messages.filter(function (m) { return m && typeof m === 'object'; });
  }

  function isCall(m) { return text(m && m.type).toUpperCase().indexOf('CALL') >= 0; }

  // Email rows of get_job_conversation, GoHighLevel email included: Client
  // chat is a separate read of the latest 30 messages only.
  function emailRows(resp) {
    if (!resp || typeof resp !== 'object' || !Array.isArray(resp.messages)) throw new Error('Unexpected email answer');
    return {
      rows: resp.messages.filter(function (m) { return m && m.channel === 'email'; }),
      capped: !!(resp.summary && resp.summary.count === EMAIL_LIMIT)
    };
  }

  function emailWho(m) {
    if (m.direction === 'outbound') return m.customer_party === false ? 'SecureWorks, not to the client' : 'SecureWorks to client';
    if (m.direction === 'internal') return 'Internal, staff only';
    return text(m.author) || 'Sender not recorded';
  }

  // ── slice 4: Materials by supplier's rules ──

  // The three a person sets. On PO is worked out by the server from the line's
  // order; Delivered comes in slice 6. Neither is ever offered as a choice.
  var MAT_SETTABLE = ['not_reviewed', 'to_order', 'in_stock'];
  var MAT_STATUS = {
    not_reviewed: { label: 'Not reviewed', tone: 'muted' },
    to_order: { label: 'To order', tone: 'warn' },
    in_stock: { label: 'In stock', tone: 'ok' },
    on_po: { label: 'On PO', tone: 'info' },
    delivered: { label: 'Delivered', tone: 'ok' }
  };
  var MAT_QTY_MAX = 999999999.999;
  var MAT_SKETCH_MAX = 400000;

  function matSettable(s) { return MAT_SETTABLE.indexOf(s) >= 0; }

  // A display status the screen does not name is printed with its underscores
  // as spaces, never dropped.
  function matStatusLabel(s) {
    if (Object.prototype.hasOwnProperty.call(MAT_STATUS, s)) return MAT_STATUS[s].label;
    var words = text(s).replace(/_/g, ' ');
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Status not recorded';
  }

  // An order's stored status: first letter capital, underscores as spaces.
  function orderStatusWord(s) {
    var words = text(s).replace(/_/g, ' ');
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Status not recorded';
  }

  // A Qty cell: empty, or a plain number 0 or more. Nothing is sent otherwise.
  function matQty(v) {
    var s = text(v);
    if (!s) return { ok: true, value: null };
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return { ok: false, msg: 'Qty must be a number.' };
    var n = Number(s);
    if (!isFinite(n)) return { ok: false, msg: 'Qty must be a number.' };
    if (n > MAT_QTY_MAX) return { ok: false, msg: 'Qty is too large.' };
    return { ok: true, value: n };
  }

  function matQtyText(v) { return typeof v === 'number' && isFinite(v) ? String(v) : (v == null ? '' : String(v)); }

  // Names that are the same once case, spaces and punctuation are ignored.
  function nameKey(v) { return text(v).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // list_suppliers' answer as the Add supplier list: every active contact not
  // already chosen, the ones tagged with a category (the material suppliers)
  // first. Each reads its name, then its email or "no email on file"; where two
  // active contacts share a name, each also says whether it is in Xero.
  function supplierOptions(list, chosen) {
    var active = list.filter(function (s) { return s && s.id && s.is_active !== false; });
    var seen = {};
    active.forEach(function (s) { var k = nameKey(s.name); seen[k] = (seen[k] || 0) + 1; });
    var taken = {};
    (chosen || []).forEach(function (id) { taken[id] = true; });
    var out = { tagged: [], rest: [] };
    active.forEach(function (s) {
      if (taken[s.id]) return;
      var label = (text(s.name) || 'Name not recorded') + ' · ' + (text(s.email) || 'no email on file');
      if (seen[nameKey(s.name)] > 1) label += ' · ' + (text(s.xero_contact_id) ? 'in Xero' : 'not in Xero');
      (Array.isArray(s.categories) && s.categories.length ? out.tagged : out.rest).push({ id: String(s.id), label: label });
    });
    return out;
  }

  function suppliersFrom(resp) {
    if (!resp || typeof resp !== 'object' || !Array.isArray(resp.suppliers)) throw new Error('Unexpected suppliers answer');
    return resp.suppliers;
  }

  function isCounts(c) {
    return !!c && typeof c === 'object' && typeof c.total === 'number' && typeof c.ready === 'number';
  }

  // dispatch_materials' answer. Throws on anything else, so the section shows
  // its failed line and never an empty table.
  function materialsFrom(resp) {
    if (!resp || typeof resp !== 'object' || !Array.isArray(resp.suppliers) || !Array.isArray(resp.lines) ||
      !isCounts(resp.counts) || !resp.workings || typeof resp.workings !== 'object') {
      throw new Error('Unexpected materials answer');
    }
    var ordersOk = resp.orders_status === 'ok' && Array.isArray(resp.orders);
    return {
      suppliers: resp.suppliers.filter(function (s) { return s && s.supplier_id; }),
      lines: resp.lines.filter(function (l) { return l && l.id; }),
      counts: resp.counts,
      canSuggest: resp.can_suggest === true,
      workings: resp.workings,
      ordersOk: ordersOk,
      orders: ordersOk ? resp.orders.filter(function (o) { return o && typeof o === 'object'; }) : []
    };
  }

  // "x of y items ready", or '' when the job has no line or the count is not known.
  function readyText(total, ready) {
    if (typeof total !== 'number' || typeof ready !== 'number' || !(total > 0)) return '';
    return ready + ' of ' + total + ' items ready';
  }

  function newId() {
    var c = global.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // ───────────────────────── state ─────────────────────────

  function tabKey(v) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].key === v) return v;
    return 'sources';
  }

  function readStore(store, key) { try { return global[store].getItem(key); } catch (e) { return null; } }
  function writeStore(store, key, value) { try { global[store].setItem(key, value); } catch (e) { /* private mode */ } }

  var state = {
    type: 'all',
    search: '',
    leftOpen: readStore('localStorage', LS_LEFT) !== '0',
    scopeOpen: readStore('localStorage', LS_SCOPE) !== '0',
    base: { status: 'idle', rows: [], total: null, degraded: false, stages: null, todoTotal: null },
    found: { status: 'idle', rows: [], degraded: false, q: '', stages: null },
    jobId: null,
    row: null,
    rowStale: false,
    detail: { jobId: null, status: 'idle', data: null },
    notes: { jobId: null, status: 'idle', items: [] },
    drafts: {},
    saving: {},
    noteMsg: {},
    rightOpen: readStore('localStorage', LS_RIGHT) !== '0',
    tab: tabKey(readStore('localStorage', LS_TAB)),
    msg: 'client',
    // Panel reads, each kept per job for the session: { status, ... }.
    story: {},
    chat: {},
    email: {},
    replies: {},
    sending: {},
    replyMsg: {},
    pdfLoading: {},
    // Slice 3: which list is showing (opens on To do), and the rail's press
    // state: the one open confirm line, the move in flight, the last answer's
    // line, and the next-step box per job.
    mode: readStore('localStorage', LS_MODE) === 'all' ? 'all' : 'todo',
    stage: { confirm: null, moving: null, msg: null, drafts: {}, saving: {}, nextMsg: {} },
    // Slice 4, Materials by supplier. jobs[jobId] holds that job's read and
    // everything typed and not yet saved, so any repaint draws it back.
    mat: {
      open: readStore('localStorage', LS_ORDER) !== '0',
      workOpen: readStore('localStorage', LS_WORKOUT) === '1',
      sup: { status: 'idle', list: [] },
      jobs: {}
    }
  };
  var tokens = { base: 0, found: 0, fill: 0 };
  var searchTimer = null;
  var photoUrls = [];

  function root() { return document.getElementById(ROOT_ID); }
  function region(name) { var r = root(); return r ? r.querySelector('[data-dpc-region="' + name + '"]') : null; }
  function searching() { return state.search.trim() !== ''; }

  // To do keeps the rows the read marks dispatch_todo, and none at all when
  // the stage read failed: that shows the failed line, never an empty To do.
  function listedRows() {
    var from = searching() ? state.found : state.base;
    var rows = from.rows;
    if (state.mode === 'todo') {
      rows = from.stages === 'ok' ? rows.filter(function (r) { return r.dispatch_todo === true && typeKey(r) !== 'makesafe'; }) : [];
    }
    return filterByType(rows, state.type);
  }

  // The list that is showing has its rows, or failed (a failed stage read
  // fails To do).
  function listFailed() {
    var from = searching() ? state.found : state.base;
    if (from.status === 'error') return true;
    return state.mode === 'todo' && from.status === 'ok' && from.stages !== 'ok';
  }

  // ───────────────────────── reads ─────────────────────────

  function loadBase() {
    var token = ++tokens.base;
    if (state.base.status !== 'ok') { state.base.status = 'loading'; paintList(); paintWorkspace(); }
    return Promise.resolve().then(function () { return global.opsFetch('pipeline', { dispatch: 1 }); }).then(function (resp) {
      if (token !== tokens.base) return;
      var got = rowsFromPipeline(resp);
      state.base = { status: 'ok', rows: got.rows, total: got.total, degraded: got.degraded, stages: got.stages, todoTotal: got.todoTotal };
      adoptSelection();
    }).catch(function () {
      if (token !== tokens.base) return;
      state.base = { status: 'error', rows: [], total: null, degraded: false, stages: null, todoTotal: null };
      state.rowStale = true;
      paintList();
      paintWorkspace();
      paintContext();
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
    var todo = state.mode === 'todo' && state.base.stages === 'ok' ? rows.filter(function (r) { return r.dispatch_todo === true; }) : [];
    var pick = byId(readStore('sessionStorage', SS_JOB)) || todo[0] || rows[0] || null;
    if (pick) selectJob(pick); else { paintWorkspace(); paintContext(); }
  }

  function runSearch() {
    var q = state.search.trim();
    var token = ++tokens.found;
    if (!q) { state.found = { status: 'idle', rows: [], degraded: false, q: '', stages: null }; paintList(); return; }
    state.found = { status: 'loading', rows: [], degraded: false, q: q, stages: null };
    paintList();
    Promise.resolve().then(function () { return global.opsFetch('pipeline', { dispatch: 1, search: q }); }).then(function (resp) {
      if (token !== tokens.found) return;
      var got = rowsFromPipeline(resp);
      state.found = { status: 'ok', rows: got.rows, degraded: got.degraded, q: q, stages: got.stages };
      paintList();
    }).catch(function () {
      if (token !== tokens.found) return;
      state.found = { status: 'error', rows: [], degraded: false, q: q, stages: null };
      paintList();
    });
  }

  // job_detail writes annotation rows as a side effect, so it is read once per
  // job open (and on an explicit Retry), never on hover or in a loop.
  function loadDetail(jobId) {
    state.detail = { jobId: jobId, status: 'loading', data: null };
    paintScope();
    paintPanel();
    Promise.resolve().then(function () { return global.opsFetch('job_detail', { jobId: jobId }); }).then(function (data) {
      if (state.detail.jobId !== jobId) return;
      if (!data || typeof data !== 'object' || !data.job || typeof data.job !== 'object') throw new Error('Unexpected job answer');
      state.detail = { jobId: jobId, status: 'ok', data: data };
      paintScope();
      paintPanel();
      ensureTabData();
    }).catch(function () {
      if (state.detail.jobId !== jobId) return;
      state.detail = { jobId: jobId, status: 'error', data: null };
      paintScope();
      paintPanel();
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
      if (stale) { paintWorkspace(); paintContext(); }
      return;
    }
    state.detail = { jobId: row.id, status: 'loading', data: null };
    state.notes = { jobId: row.id, status: 'loading', items: [] };
    paintWorkspace();
    paintContext();
    loadDetail(row.id);
    loadNotes(row.id);
    loadMat(row);
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

  // ── slice 2 reads: each runs when its tab is first shown for a job ──

  // The open job's client contact, from slice 1's one job_detail result.
  function contactOf(jobId) {
    var d = state.detail;
    if (d.jobId !== jobId || d.status !== 'ok') return null;
    return text(d.data.job.ghl_contact_id);
  }

  // job_story writes nothing: a GET of read-only SQL functions.
  function loadStory(jobId) {
    var entry = { status: 'loading', lines: [] };
    state.story[jobId] = entry;
    paintPanel();
    Promise.resolve().then(function () { return global.opsFetch('job_story', { job_id: jobId }); }).then(function (resp) {
      if (state.story[jobId] !== entry) return;
      state.story[jobId] = { status: 'ok', lines: storyLines(resp) };
      paintPanel();
    }).catch(function (e) {
      if (state.story[jobId] !== entry) return;
      state.story[jobId] = { status: 'error', forbidden: !!(e && e.status === 403), lines: [] };
      paintPanel();
    });
  }

  // A live GoHighLevel read (provider calls, rate-limited): once per job, again
  // on Retry and once after a send. Never polled.
  function loadChat(jobId, contactId) {
    var entry = { status: 'loading', contactId: contactId, messages: [] };
    state.chat[jobId] = entry;
    paintChat();
    Promise.resolve().then(function () { return global.opsAuthHeaders(); }).then(function (headers) {
      return global.fetch(global.SUPABASE_URL + '/functions/v1/ghl-proxy?action=get_conversation&contactId=' + encodeURIComponent(contactId), { headers: headers, cache: 'no-store' });
    }).then(function (resp) {
      return resp.json().catch(function () { return null; }).then(function (data) { return chatMessages(resp.ok, data); });
    }).then(function (messages) {
      if (state.chat[jobId] !== entry) return;
      state.chat[jobId] = { status: 'ok', contactId: contactId, messages: messages };
      paintChat();
    }).catch(function () {
      if (state.chat[jobId] !== entry) return;
      state.chat[jobId] = { status: 'error', contactId: contactId, messages: [] };
      paintChat();
    });
  }

  // get_job_conversation reads four stores and writes nothing.
  function loadEmail(jobId) {
    var entry = { status: 'loading', rows: [] };
    state.email[jobId] = entry;
    paintPanel();
    Promise.resolve().then(function () { return global.opsPost('get_job_conversation', { job_id: jobId, limit: EMAIL_LIMIT }); }).then(function (resp) {
      if (state.email[jobId] !== entry) return;
      var got = emailRows(resp);
      state.email[jobId] = { status: 'ok', rows: got.rows, capped: got.capped };
      paintPanel();
    }).catch(function () {
      if (state.email[jobId] !== entry) return;
      state.email[jobId] = { status: 'error', rows: [] };
      paintPanel();
    });
  }

  // What the open tab needs and has not read yet for this job.
  function ensureTabData() {
    var jobId = state.jobId;
    if (!state.rightOpen || !jobId || !state.row || (state.base.status === 'error' && state.rowStale)) return;
    if (state.tab === 'story' && !state.story[jobId]) loadStory(jobId);
    if (state.tab !== 'messages') return;
    if (state.msg === 'email') { if (!state.email[jobId]) loadEmail(jobId); return; }
    var contactId = contactOf(jobId);
    if (contactId && !(state.chat[jobId] && state.chat[jobId].contactId === contactId)) loadChat(jobId, contactId);
  }

  // The one write the panel makes: a text to the client, on a person's press.
  function sendReply() {
    var jobId = state.jobId;
    var contactId = contactOf(jobId);
    var body = (state.replies[jobId] || '').trim();
    if (!jobId || !contactId || !body || state.sending[jobId]) return;
    state.sending[jobId] = true;
    state.replyMsg[jobId] = null;
    paintReply();
    Promise.resolve().then(function () { return global.opsAuthHeaders({ 'Content-Type': 'application/json' }); }).then(function (headers) {
      return global.fetch(global.SUPABASE_URL + '/functions/v1/ghl-proxy?action=send_sms', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ contactId: contactId, message: body, jobId: jobId, fromNumber: SMS_FROM })
      });
    }).then(function (resp) {
      return resp.json().catch(function () { return null; }).then(function (data) {
        if (!resp.ok || !data || data.success !== true) throw new Error('Send failed');
      });
    }).then(function () {
      state.sending[jobId] = false;
      state.replies[jobId] = '';
      state.replyMsg[jobId] = { ok: true, text: 'Message sent.' };
      try { global.sessionStorage.removeItem('sw_convo_' + contactId); } catch (e) { /* private mode */ }
      if (state.jobId === jobId) paintReply();
      // Once, to show the sent message. A tab showing something else re-reads
      // when Client chat is next shown.
      delete state.chat[jobId];
      if (state.jobId === jobId) ensureTabData();
    }, function () {
      state.sending[jobId] = false;
      state.replyMsg[jobId] = { ok: false, text: 'Message not sent. Your text is still here.' };
      if (state.jobId === jobId) paintReply();
    });
  }

  // ── slice 3 writes: the rail's stage and the next-step line ──

  // Puts what a write answered onto every copy of the job's row (the list, the
  // search and the open job), so the card and the rail redraw at once. Only
  // when the merged row still reads as a whole stage.
  function applyStageFields(jobId, fields) {
    var merge = function (r) { return r && r.id === jobId ? Object.assign({}, r, fields) : r; };
    var next = merge(rowById(jobId) || state.row);
    if (!next || next.id !== jobId || !stageOf(next)) return;
    state.base.rows = state.base.rows.map(merge);
    state.found.rows = state.found.rows.map(merge);
    if (state.row && state.row.id === jobId) state.row = merge(state.row);
  }

  function pickStageFields(answer) {
    var out = {};
    Object.keys(answer || {}).forEach(function (k) { if (k.indexOf('dispatch_') === 0) out[k] = answer[k]; });
    return out;
  }

  // One set_dispatch_stage per confirmed press. The rail is locked while it is
  // in flight and is never re-sent on its own.
  function moveStage(jobId, to) {
    var row = state.row;
    var s = row && row.id === jobId ? stageOf(row) : null;
    if (!s || s.none || state.stage.moving || stageIndex(to) < 1) return;
    state.stage.moving = jobId;
    state.stage.msg = null;
    paintTape();
    Promise.resolve().then(function () {
      return global.opsPost('set_dispatch_stage', { job_id: jobId, stage: to, expected_stage: s.key });
    }).then(function (resp) {
      if (!resp || resp.success !== true || resp.dispatch_stage !== to) throw new Error('Unexpected stage answer');
      state.stage.moving = null;
      state.stage.confirm = null;
      applyStageFields(jobId, Object.assign(pickStageFields(resp), { dispatch_stage_from: null }));
      paintTape();
      paintList(true);
      loadBase();
    }).catch(function (e) {
      state.stage.moving = null;
      state.stage.confirm = null;
      if (e && e.status === 409 && e.code === 'stage_changed') {
        if (e.body) applyStageFields(jobId, pickStageFields(e.body));
        state.stage.msg = { jobId: jobId, kind: 'changed', text: "This job's stage changed. Showing the latest." };
        paintTape();
        paintList(true);
        loadBase();
        return;
      }
      state.stage.msg = { jobId: jobId, kind: 'fail', text: 'Stage not moved.', to: to };
      paintTape();
    });
  }

  function nextDraft(jobId, row) {
    var d = state.stage.drafts[jobId];
    return typeof d === 'string' ? d : text(row && row.dispatch_next_step);
  }

  function nextUnchanged(jobId, row) {
    return cleanNextStep(nextDraft(jobId, row)) === text(row && row.dispatch_next_step);
  }

  // One set_dispatch_next_step per press of Save. An empty line clears it.
  function saveNextStep() {
    var jobId = state.jobId;
    var row = state.row;
    var s = stageOf(row);
    if (!jobId || !row || row.id !== jobId || !s || s.none || state.stage.saving[jobId] || nextUnchanged(jobId, row)) return;
    var body = cleanNextStep(nextDraft(jobId, row));
    if (body.length > NEXT_STEP_MAX) return;
    state.stage.saving[jobId] = true;
    state.stage.nextMsg[jobId] = null;
    paintTape();
    Promise.resolve().then(function () {
      return global.opsPost('set_dispatch_next_step', { job_id: jobId, text: body });
    }).then(function (resp) {
      if (!resp || resp.success !== true || !('dispatch_next_step' in resp)) throw new Error('Unexpected next step answer');
      state.stage.saving[jobId] = false;
      delete state.stage.drafts[jobId];
      state.stage.nextMsg[jobId] = { ok: true, text: resp.dispatch_next_step ? 'Next step saved.' : 'Next step cleared.' };
      applyStageFields(jobId, { dispatch_next_step: resp.dispatch_next_step == null ? null : String(resp.dispatch_next_step) });
      paintTape();
      paintList(true);
      loadBase();
    }).catch(function () {
      state.stage.saving[jobId] = false;
      state.stage.nextMsg[jobId] = { ok: false, text: 'Next step not saved. Your text is still here.' };
      paintTape();
    });
  }

  // ── slice 4: Materials by supplier, its one read and six writes ──
  // dispatch_materials is read once per job open, on Retry, and once after a
  // "changed somewhere else" answer. Each write is sent once, on a person's
  // edit or press; nothing here retries on its own.

  function isMakesafe(row) { return typeKey(row) === 'makesafe'; }
  function matEntry(jobId) { return (jobId && state.mat.jobs[jobId]) || null; }
  function matLine(e, id) {
    if (!e) return null;
    for (var i = 0; i < e.lines.length; i++) if (e.lines[i].id === id) return e.lines[i];
    return null;
  }
  function removeLine(e, id) { e.lines = e.lines.filter(function (l) { return l.id !== id; }); }
  function maxPos(e) { return e.lines.reduce(function (m, l) { return Math.max(m, Number(l.position) || 0); }, 0); }
  function onOrder(l) { return !matSettable(l.display_status); }

  // What the server holds for a line, to tell an edit from a cell left as it was.
  function lineSaved(l) {
    var q = l.quantity;
    return {
      supplier_id: String(l.supplier_id), description: text(l.description),
      quantity: typeof q === 'number' && isFinite(q) ? q : (q == null || q === '' ? null : Number(q)),
      unit: text(l.unit) || null, status: l.status, pos: Number(l.position) || 0
    };
  }

  // What the cells say now, as the save sends it.
  function lineOut(l) {
    return { id: l.id, supplier_id: l.supplier_id, description: text(l.description), quantity: matQty(l.quantity).value, unit: text(l.unit) || null, status: l.status };
  }

  function sameLine(a, b) {
    return a.supplier_id === b.supplier_id && a.description === b.description && a.quantity === b.quantity && a.unit === b.unit && a.status === b.status;
  }

  function lineDirty(l) { return !l.saved || !matQty(l.quantity).ok || !sameLine(lineOut(l), l.saved); }

  function lineFrom(l) {
    return {
      id: String(l.id), supplier_id: String(l.supplier_id), description: text(l.description), quantity: matQtyText(l.quantity), unit: text(l.unit),
      status: l.status, display_status: text(l.display_status) || l.status, purchase_order_id: l.purchase_order_id || null, source: l.source,
      position: Number(l.position) || 0, updated_at: l.updated_at, saved: lineSaved(l),
      busy: false, again: false, failed: false, delFailed: false, msg: '', retry: false, want: null, gone: false
    };
  }

  function newEntry(jobId) {
    return {
      jobId: jobId, status: 'loading', token: 0, rereading: false,
      suppliers: [], lines: [], counts: null, canSuggest: false, orders: [], ordersOk: true,
      w: {
        loaded: false, text: '', textSaved: '', textStamp: null, textBusy: false, textAgain: false, textFailed: false, timer: null,
        sketch: null, sketchSaved: null, sketchStamp: null, sketchBusy: false, sketchAgain: false, sketchFailed: false,
        sketchMsg: '', sketchBroken: false, clearWanted: false
      },
      adding: null, addMsg: null, card: {}, busyCard: {}, notice: '', touched: false
    };
  }

  // A fresh read over what the screen holds. A line typed and not yet saved
  // keeps its text while the server's copy is the one it was typed over; a new
  // line not yet saved is kept when it has text in it (an empty one only on a
  // quiet re-read, so a job open drops it). Everything else is the server's.
  function mergeMat(e, got, quiet) {
    var mine = {};
    e.lines.forEach(function (l) { mine[l.id] = l; });
    // A line is only ever kept under a supplier still chosen for the job.
    var chosen = {};
    got.suppliers.forEach(function (s) { chosen[String(s.supplier_id)] = true; });
    var seen = {};
    var lines = got.lines.map(function (fresh) {
      var id = String(fresh.id);
      seen[id] = true;
      var l = mine[id];
      if (l && l.updated_at === fresh.updated_at && chosen[l.supplier_id] && (l.busy || l.gone || l.failed || l.delFailed || lineDirty(l))) return l;
      return lineFrom(fresh);
    });
    e.lines.forEach(function (l) {
      if (!seen[l.id] && !l.saved && chosen[l.supplier_id] && (l.busy || quiet || text(l.description))) lines.push(l);
    });
    e.lines = lines;
    e.suppliers = got.suppliers;
    e.counts = got.counts;
    e.canSuggest = got.canSuggest;
    e.orders = got.orders;
    e.ordersOk = got.ordersOk;
    var w = e.w;
    var wo = typeof got.workings.working_out === 'string' ? got.workings.working_out : '';
    var woStamp = got.workings.working_out_updated_at || null;
    if (!(w.loaded && w.textStamp === woStamp && (w.textBusy || w.text !== w.textSaved))) w.text = wo;
    w.textSaved = wo;
    w.textStamp = woStamp;
    var sk = typeof got.workings.sketch_png === 'string' && got.workings.sketch_png ? got.workings.sketch_png : null;
    var skStamp = got.workings.sketch_updated_at || null;
    if (!(w.loaded && w.sketchStamp === skStamp && (w.sketchBusy || w.sketch !== w.sketchSaved))) { w.sketch = sk; w.sketchBroken = false; }
    w.sketchSaved = sk;
    w.sketchStamp = skStamp;
    w.loaded = true;
  }

  function loadMat(row) {
    if (!row || !row.id || isMakesafe(row)) return;
    ensureSuppliers();
    readMat(row.id, false);
  }

  function readMat(jobId, quiet) {
    var e = matEntry(jobId) || (state.mat.jobs[jobId] = newEntry(jobId));
    var token = ++e.token;
    if (!quiet || e.status !== 'ok') { e.status = 'loading'; e.notice = quiet ? e.notice : ''; }
    if (state.jobId === jobId) { paintMat(); paintHead(); }
    return Promise.resolve().then(function () { return global.opsFetch('dispatch_materials', { job_id: jobId }); }).then(function (resp) {
      if (token !== e.token) return;
      mergeMat(e, materialsFrom(resp), quiet);
      e.status = 'ok';
      if (state.jobId === jobId) { paintMat(); paintHead(); }
    }).catch(function () {
      if (token !== e.token) return;
      e.status = 'error';
      if (state.jobId === jobId) { paintMat(); paintHead(); }
    });
  }

  // Another tab or person changed what a write was based on: say so and show
  // the latest, by one quiet re-read.
  function matChanged(jobId) {
    var e = matEntry(jobId);
    if (!e) return;
    e.notice = 'This changed somewhere else. Showing the latest.';
    if (state.jobId === jobId) paintMat();
    if (e.rereading) return;
    e.rereading = true;
    readMat(jobId, true).then(function () { e.rereading = false; });
  }

  // list_suppliers: once a session, on the first job opened with the section,
  // and again only on Retry. Every column of every active contact (285 rows).
  function ensureSuppliers(force) {
    if (!force && state.mat.sup.status !== 'idle') return;
    var mine = state.mat.sup = { status: 'loading', list: [] };
    paintMat();
    Promise.resolve().then(function () { return global.opsFetch('list_suppliers'); }).then(function (resp) {
      if (state.mat.sup !== mine) return;
      state.mat.sup = { status: 'ok', list: suppliersFrom(resp) };
      paintMat();
    }).catch(function () {
      if (state.mat.sup !== mine) return;
      state.mat.sup = { status: 'error', list: [] };
      paintMat();
    });
  }

  // A write's counts redraw "items ready" on the header and the job's card,
  // without a list re-read. A null counts (the server's after-write count read
  // failed) keeps the figure already shown.
  function applyCounts(jobId, counts) {
    var e = matEntry(jobId);
    if (!e || !isCounts(counts)) return;
    e.counts = { total: counts.total, ready: counts.ready };
    [state.base.rows, state.found.rows, state.row ? [state.row] : []].forEach(function (rows) {
      rows.forEach(function (r) {
        if (r && r.id === jobId) { r.materials_lines_total = counts.total; r.materials_lines_ready = counts.ready; }
      });
    });
    if (state.jobId === jobId) paintHead();
    paintCard(jobId);
  }

  function writeOk(resp) {
    if (!resp || typeof resp !== 'object' || resp.success !== true) throw new Error('Unexpected answer');
    return resp;
  }

  function addSupplier(jobId, supplierId) {
    var e = matEntry(jobId);
    if (!e || e.status !== 'ok' || !supplierId || e.adding) return;
    e.adding = supplierId;
    e.addMsg = null;
    e.notice = '';
    paintMatIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_materials_add_supplier', { job_id: jobId, supplier_id: supplierId });
    }).then(writeOk).then(function (resp) {
      if (!resp.supplier || !resp.supplier.supplier_id) throw new Error('Unexpected answer');
      return resp;
    }).then(function (resp) {
      e.adding = null;
      var s = resp.supplier;
      if (!e.suppliers.some(function (x) { return String(x.supplier_id) === String(s.supplier_id); })) e.suppliers.push(s);
      applyCounts(jobId, resp.counts);
      paintMatIf(jobId);
    }, function (err) {
      e.adding = null;
      e.addMsg = err && err.code === 'supplier_inactive'
        ? { text: 'Supplier not added: that contact is no longer active.', id: null }
        : { text: 'Supplier not added.', id: supplierId };
      paintMatIf(jobId);
    });
  }

  function removeSupplier(jobId, supplierId) {
    var e = matEntry(jobId);
    if (!e || e.busyCard[supplierId]) return;
    e.busyCard[supplierId] = 'remove';
    e.card[supplierId] = null;
    e.notice = '';
    paintMatIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_materials_remove_supplier', { job_id: jobId, supplier_id: supplierId });
    }).then(writeOk).then(function (resp) {
      delete e.busyCard[supplierId];
      e.suppliers = e.suppliers.filter(function (s) { return String(s.supplier_id) !== supplierId; });
      applyCounts(jobId, resp.counts);
      paintMatIf(jobId);
    }, function (err) {
      delete e.busyCard[supplierId];
      if (err && err.code === 'supplier_has_lines') { matChanged(jobId); return; }
      e.card[supplierId] = { text: 'Supplier not removed.', retry: 'remove' };
      paintMatIf(jobId);
    });
  }

  // The scope's suggested lines, under this supplier, on a press. The server
  // reads the scope without its pricing, so no quote line or price comes over.
  function suggestLines(jobId, supplierId) {
    var e = matEntry(jobId);
    if (!e || e.busyCard[supplierId]) return;
    e.busyCard[supplierId] = 'suggest';
    e.card[supplierId] = null;
    e.notice = '';
    paintMatIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_materials_suggest', { job_id: jobId, supplier_id: supplierId });
    }).then(writeOk).then(function (resp) {
      if (!Array.isArray(resp.lines)) throw new Error('Unexpected answer');
      return resp;
    }).then(function (resp) {
      delete e.busyCard[supplierId];
      var added = resp.lines.filter(function (l) { return l && l.id; }).map(lineFrom);
      added.forEach(function (l) { if (!matLine(e, l.id)) e.lines.push(l); });
      if (added.length) { e.canSuggest = false; e.touched = true; }
      else e.card[supplierId] = { text: 'The scope has nothing to suggest.', retry: null };
      applyCounts(jobId, resp.counts);
      paintMatIf(jobId);
    }, function (err) {
      delete e.busyCard[supplierId];
      var code = err && err.code;
      if (code === 'lines_exist') { matChanged(jobId); return; }
      e.card[supplierId] = code === 'scope_unreadable'
        ? { text: 'The scope could not be read, so no lines were added.', retry: null }
        : { text: 'Lines not added.', retry: 'suggest' };
      paintMatIf(jobId);
    });
  }

  function addLine(jobId, supplierId) {
    var e = matEntry(jobId);
    if (!e || e.status !== 'ok') return;
    var l = {
      id: newId(), supplier_id: supplierId, description: '', quantity: '', unit: '', status: 'not_reviewed', display_status: 'not_reviewed',
      purchase_order_id: null, source: 'manual', position: maxPos(e) + 1, updated_at: null, saved: null,
      busy: false, again: false, failed: false, delFailed: false, msg: '', retry: false, want: null, gone: false
    };
    e.lines.push(l);
    e.notice = '';
    paintMat();
    var r = region('mat');
    var cell = r && r.querySelector('[data-dpc-mat-line="' + l.id + '"][data-dpc-mat-cell="description"]');
    if (cell) cell.focus();
  }

  // One save in flight per line: a second edit waits for the answer and is
  // then sent with the latest values. Sent when a cell is left, or a box changed.
  function saveLine(jobId, id) {
    var e = matEntry(jobId);
    var l = matLine(e, id);
    if (!l || l.gone || onOrder(l)) return;
    if (l.busy) { l.again = true; return; }
    var q = matQty(l.quantity);
    if (!q.ok) { l.msg = q.msg; l.retry = false; paintMatIf(jobId); return; }
    if (!text(l.description)) {
      // A new row is saved the first time its Item is left with text in it.
      if (l.saved) { l.msg = 'Item cannot be empty.'; l.retry = false; paintMatIf(jobId); }
      return;
    }
    var out = lineOut(l);
    if (l.saved && sameLine(out, l.saved)) {
      if (l.msg && !l.retry) { l.msg = ''; paintMatIf(jobId); }
      return;
    }
    var hadMsg = !!l.msg;
    l.msg = '';
    l.retry = false;
    l.busy = true;
    l.failed = false;
    e.touched = true;
    e.notice = '';
    var body = { job_id: jobId, line: out };
    if (l.saved) body.expected_updated_at = l.updated_at;
    var wasSuggest = e.canSuggest;
    if (hadMsg) paintMatIf(jobId); else paintMatSave(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_materials_save_line', body);
    }).then(writeOk).then(function (resp) {
      if (!resp.line || String(resp.line.id) !== id) throw new Error('Unexpected answer');
      return resp;
    }).then(function (resp) {
      e.canSuggest = false;
      applyCounts(jobId, resp.counts);
      var cur = matLine(e, id);
      if (!cur) { paintMatIf(jobId); return; }
      var got = resp.line;
      cur.busy = false;
      // A cell that still holds what was sent takes the stored form of it.
      if (text(cur.description) === out.description) cur.description = text(got.description);
      var cq = matQty(cur.quantity);
      if (cq.ok && cq.value === out.quantity) cur.quantity = matQtyText(got.quantity);
      if ((text(cur.unit) || null) === out.unit) cur.unit = text(got.unit);
      if (cur.status === out.status) cur.status = got.status;
      if (cur.supplier_id === out.supplier_id) cur.supplier_id = String(got.supplier_id);
      cur.saved = lineSaved(got);
      cur.updated_at = got.updated_at;
      cur.position = Number(got.position) || cur.position;
      cur.display_status = text(got.display_status) || got.status;
      cur.purchase_order_id = got.purchase_order_id || null;
      cur.source = got.source;
      var again = cur.again;
      cur.again = false;
      if (cur.gone) { sendDelete(jobId, id); return; }
      if (again && lineDirty(cur)) saveLine(jobId, id);
      if (wasSuggest || onOrder(cur)) paintMatIf(jobId); else paintMatSave(jobId);
    }, function (err) {
      var cur = matLine(e, id);
      if (cur) { cur.busy = false; cur.again = false; }
      var code = err && err.code;
      if (code === 'line_changed' || code === 'line_on_order') {
        var stored = err.body && err.body.line;
        if (stored && stored.id) e.lines = e.lines.map(function (x) { return x.id === id ? lineFrom(stored) : x; });
        else removeLine(e, id);
      }
      if (code === 'line_changed' || code === 'line_on_order' || code === 'supplier_not_on_job') { matChanged(jobId); return; }
      if (!cur) return;
      if (cur.gone) {
        if (cur.saved) sendDelete(jobId, id); else { removeLine(e, id); paintMatIf(jobId); }
        return;
      }
      cur.failed = true;
      // A moved line goes back under its supplier and a status back to what
      // is stored; Retry sends the change again. Typed text stays in its cell.
      var want = {};
      if (cur.saved && cur.supplier_id !== cur.saved.supplier_id) {
        want.supplier_id = cur.supplier_id;
        cur.supplier_id = cur.saved.supplier_id;
        cur.position = cur.saved.pos;
        cur.msg = 'Line not moved.';
        cur.retry = true;
      }
      if (cur.saved && cur.status !== cur.saved.status) {
        want.status = cur.status;
        cur.status = cur.saved.status;
        cur.display_status = cur.saved.status;
      }
      cur.want = (want.supplier_id || want.status) ? want : null;
      paintMatIf(jobId);
    });
  }

  function moveLine(jobId, id, supplierId) {
    var e = matEntry(jobId);
    var l = matLine(e, id);
    if (!l || !supplierId || l.supplier_id === supplierId) return;
    l.supplier_id = supplierId;
    l.position = maxPos(e) + 1;
    l.msg = '';
    l.retry = false;
    l.want = null;
    saveLine(jobId, id);
    paintMatIf(jobId);
  }

  function setStatus(jobId, id, status) {
    var l = matLine(matEntry(jobId), id);
    if (!l || !matSettable(status)) return;
    l.status = status;
    l.display_status = status;
    l.want = null;
    saveLine(jobId, id);
    paintMatIf(jobId);
  }

  // The cross: the line goes at once, and is deleted once.
  function deleteLine(jobId, id) {
    var e = matEntry(jobId);
    var l = matLine(e, id);
    if (!l || onOrder(l)) return;
    e.notice = '';
    if (!l.saved && !l.busy) { removeLine(e, id); paintMatIf(jobId); return; }
    l.gone = true;
    l.msg = '';
    l.retry = false;
    l.failed = false;
    l.delFailed = false;
    paintMatIf(jobId);
    if (!l.busy) sendDelete(jobId, id); // else sent once its save is answered
  }

  function sendDelete(jobId, id) {
    var e = matEntry(jobId);
    var l = matLine(e, id);
    if (!l) return;
    if (!l.saved) { removeLine(e, id); paintMatIf(jobId); return; }
    l.busy = true;
    e.touched = true;
    paintMatSave(jobId);
    var stamp = l.updated_at;
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_materials_delete_line', { job_id: jobId, id: id, expected_updated_at: stamp });
    }).then(writeOk).then(function (resp) {
      removeLine(e, id);
      applyCounts(jobId, resp.counts);
      paintMatIf(jobId);
    }, function (err) {
      var cur = matLine(e, id);
      if (cur) cur.busy = false;
      var code = err && err.code;
      if (code === 'line_changed' || code === 'line_on_order') {
        var stored = err.body && err.body.line;
        if (stored && stored.id) e.lines = e.lines.map(function (x) { return x.id === id ? lineFrom(stored) : x; });
        else removeLine(e, id);
        matChanged(jobId);
        return;
      }
      if (!cur) return;
      cur.gone = false;
      cur.delFailed = true;
      cur.msg = 'Line not removed.';
      cur.retry = true;
      paintMatIf(jobId);
    });
  }

  function retryLine(jobId, id) {
    var e = matEntry(jobId);
    var l = matLine(e, id);
    if (!l || l.busy) return;
    l.msg = '';
    l.retry = false;
    if (l.delFailed) { l.delFailed = false; deleteLine(jobId, id); return; }
    if (l.want) {
      if (l.want.supplier_id) { l.supplier_id = l.want.supplier_id; l.position = maxPos(e) + 1; }
      if (l.want.status) { l.status = l.want.status; l.display_status = l.want.status; }
      l.want = null;
    }
    l.failed = false;
    saveLine(jobId, id);
    paintMatIf(jobId);
  }

  // The save line's Retry: every failed save once more, once each.
  function retrySaves(jobId) {
    var e = matEntry(jobId);
    if (!e) return;
    e.lines.filter(function (l) { return l.failed || l.delFailed; }).forEach(function (l) { retryLine(jobId, l.id); });
    if (e.w.textFailed) { e.w.textFailed = false; saveText(jobId); }
    if (e.w.sketchFailed) { e.w.sketchFailed = false; if (e.w.clearWanted) clearSketch(jobId); else saveSketch(jobId); }
    paintMatIf(jobId);
  }

  // The working out pad: saved when typing stops, and when the pad is left.
  function padInput(jobId, value) {
    var e = matEntry(jobId);
    if (!e || e.status !== 'ok') return;
    e.w.text = value;
    clearTimeout(e.w.timer);
    e.w.timer = setTimeout(function () { saveText(jobId); }, WORKOUT_SAVE_MS);
  }

  function saveText(jobId) {
    var e = matEntry(jobId);
    if (!e || e.status !== 'ok') return;
    var w = e.w;
    clearTimeout(w.timer);
    w.timer = null;
    if (w.textBusy) { w.textAgain = true; return; }
    if (w.text === w.textSaved) { if (w.textFailed) { w.textFailed = false; paintMatSave(jobId); } return; }
    var sent = w.text;
    w.textBusy = true;
    w.textFailed = false;
    e.touched = true;
    paintMatSave(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_materials_save_workings', { job_id: jobId, working_out: sent, expected_working_out_updated_at: w.textStamp });
    }).then(writeOk).then(function (resp) {
      w.textBusy = false;
      w.textSaved = sent;
      w.textStamp = (resp.workings && resp.workings.working_out_updated_at) || null;
      var again = w.textAgain;
      w.textAgain = false;
      if (again && w.text !== w.textSaved) saveText(jobId); else paintMatSave(jobId);
    }, function (err) {
      w.textBusy = false;
      w.textAgain = false;
      if (err && err.code === 'workings_changed') { matChanged(jobId); return; }
      w.textFailed = true;
      paintMatSave(jobId);
    });
  }

  // The sketch: saved after each stroke, as the canvas's own PNG.
  function sketchDrawn(jobId, dataUrl) {
    var e = matEntry(jobId);
    if (!e || e.status !== 'ok') return;
    e.w.sketch = dataUrl;
    e.w.sketchBroken = false;
    e.w.sketchMsg = '';
    e.w.clearWanted = false;
    saveSketch(jobId);
    paintSketchMsg(jobId);
  }

  function clearSketch(jobId) {
    var e = matEntry(jobId);
    if (!e || e.status !== 'ok') return;
    e.w.sketch = null;
    e.w.sketchBroken = false;
    e.w.sketchMsg = '';
    if (state.jobId === jobId) redrawSketch();
    saveSketch(jobId);
    paintSketchMsg(jobId);
  }

  function saveSketch(jobId) {
    var e = matEntry(jobId);
    if (!e) return;
    var w = e.w;
    if (w.sketchBusy) { w.sketchAgain = true; return; }
    var sent = w.sketch;
    if (sent === w.sketchSaved) { if (w.sketchFailed) { w.sketchFailed = false; paintMatSave(jobId); } w.clearWanted = false; return; }
    if (sent && sent.length > MAT_SKETCH_MAX) {
      w.sketchMsg = 'Sketch not saved: too large. Clear it and draw again.';
      paintSketchMsg(jobId);
      return;
    }
    w.sketchBusy = true;
    w.sketchFailed = false;
    e.touched = true;
    paintMatSave(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_materials_save_workings', { job_id: jobId, sketch_png: sent, expected_sketch_updated_at: w.sketchStamp });
    }).then(writeOk).then(function (resp) {
      w.sketchBusy = false;
      w.sketchSaved = sent;
      w.sketchStamp = (resp.workings && resp.workings.sketch_updated_at) || null;
      w.clearWanted = false;
      var again = w.sketchAgain;
      w.sketchAgain = false;
      if (again && w.sketch !== w.sketchSaved) saveSketch(jobId); else paintMatSave(jobId);
    }, function (err) {
      w.sketchBusy = false;
      w.sketchAgain = false;
      if (err && err.code === 'workings_changed') { matChanged(jobId); return; }
      if (err && err.status === 400 && sent && /too large|at most/i.test(String(err.message))) {
        w.sketchMsg = 'Sketch not saved: too large. Clear it and draw again.';
      } else {
        w.sketchFailed = true;
        // A failed Clear brings the drawing back; Retry clears it again.
        if (sent === null) { w.clearWanted = true; w.sketch = w.sketchSaved; if (state.jobId === jobId) redrawSketch(); }
      }
      paintMatSave(jobId);
      paintSketchMsg(jobId);
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
    var s = stageOf(row);
    var next = s && !s.none ? text(row.dispatch_next_step) : '';
    h += '<span class="dpc-job-top"><span class="dpc-type' + (k ? ' dpc-type-' + k : '') + '">' + esc(typeLabel(row)) + '</span>' +
      (next ? '<span class="dpc-next">' + esc(next) + '</span>' : '') + '</span>';
    h += '<strong>' + esc(jobTitle(row)) + '</strong>';
    if (text(row.description)) h += '<span>' + esc(text(row.description)) + '</span>';
    h += stageLineHtml(s);
    var ready = readyText(row.materials_lines_total, row.materials_lines_ready);
    h += '<span class="dpc-muted">' + esc((ready ? ready + ' · ' : '') + installText(row)) + '</span>';
    return h + '</button>';
  }

  // The card's stage line (build note row 7). No line for a make-safe row or
  // when the read gave no stage.
  function stageLineHtml(s) {
    if (!s || s.none) return '';
    if (s.index === 6) return '<span class="dpc-stage dpc-stage-done">Done: trade scheduled</span>';
    if (s.index === 0) return '<span class="dpc-stage">Not on the rail yet</span>';
    return '<span class="dpc-stage">Stage: ' + esc(s.name) + '</span>';
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
    if (state.mode === 'todo') return todoState();
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

  function todoState() {
    var from = searching() ? state.found : state.base;
    var retry = searching() ? 'search' : 'list';
    if (searching() && from.status === 'error') return failLine('Search failed.', 'search');
    if (from.status === 'error') return failLine('Could not load jobs.', 'list');
    if (from.status !== 'ok') return '<div class="dpc-empty">' + (searching() ? 'Searching...' : 'Loading jobs...') + '</div>';
    if (from.stages !== 'ok') return failLine('Could not load Dispatch stages.', retry);
    if (listedRows().length) return '';
    if (searching()) return '<div class="dpc-empty">No To do jobs match.</div>';
    if (state.type === 'all') return '<div class="dpc-empty">Nothing in To do.</div>';
    return '<div class="dpc-empty">No ' + esc((TYPE_LABELS[state.type] || state.type).toLowerCase()) + ' jobs in To do.</div>';
  }

  function degradedNow() {
    return searching() ? (state.found.status === 'ok' && state.found.degraded) : (state.base.status === 'ok' && state.base.degraded);
  }

  // The two list buttons. To do's number is the read's todo_total, shown only
  // when the stage read worked.
  function modeHtml() {
    var todo = state.base.status === 'ok' && state.base.stages === 'ok' ? ' <b>' + esc(state.base.todoTotal) + '</b>' : '';
    var all = state.base.status === 'ok' ? ' <b>' + esc(state.base.total) + '</b>' : '';
    return '<button type="button" data-dpc-mode="todo" aria-pressed="' + (state.mode === 'todo') + '">To do' + todo + '</button>' +
      '<button type="button" data-dpc-mode="all" aria-pressed="' + (state.mode === 'all') + '">All jobs' + all + '</button>';
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
    h += '<div class="dpc-mode" role="group" aria-label="Which jobs" data-dpc-region="mode">' + modeHtml() + '</div>';
    h += '<div class="dpc-chips" role="group" aria-label="Work type" data-dpc-region="chips">' + chipsHtml() + '</div>';
    h += '<input type="search" class="dpc-search" data-dpc-search placeholder="Search job, suburb or client" value="' + esc(state.search) + '" aria-label="Search jobs">';
    h += '</div><div class="dpc-job-list" data-dpc-region="list"></div>';
    h += '<div class="dpc-foot">To do: jobs from Accepted until the trade is scheduled. All jobs: any job through the Dispatch lens, to check what was ordered and sent.</div>';
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
      var hadFocus = mode.contains(document.activeElement) ? document.activeElement.getAttribute('data-dpc-mode') : null;
      mode.innerHTML = modeHtml();
      if (hadFocus) mode.querySelector('[data-dpc-mode="' + hadFocus + '"]').focus();
    }
    var chips = region('chips');
    if (chips) Array.prototype.forEach.call(chips.querySelectorAll('[data-dpc-type]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-dpc-type') === state.type));
    });
    var stateHtml = listState();
    var rows = stateHtml ? [] : listedRows();
    if (!state.leftOpen) {
      var failed = listFailed();
      var ready = searching() ? state.found.status === 'ok' : state.base.status === 'ok';
      var head = region('railhead');
      if (head) {
        var from = searching() ? state.found : state.base;
        var failText = from.status !== 'error' ? 'Could not load Dispatch stages. Retry'
          : searching() ? 'Search failed. Retry' : 'Could not load jobs. Retry';
        head.innerHTML = failed
          ? '<button type="button" class="dpc-side-btn" data-dpc-retry="' + (searching() ? 'search' : 'list') + '" aria-label="' + failText + '" title="' + failText + '">&#8635;</button>'
          : ready ? '<span class="dpc-rail-count" title="' + (state.mode === 'todo' ? 'Jobs in To do' : 'Jobs listed') + '">' + rows.length + '</span>' : '';
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
    h += '<span class="dpc-pill">' + esc(installText(row)) + '</span>';
    var mat = isMakesafe(row) ? null : matEntry(row.id);
    var ready = mat && mat.status === 'ok' && mat.counts ? readyText(mat.counts.total, mat.counts.ready) : '';
    if (ready) h += '<span class="dpc-pill">' + esc(ready) + '</span>';
    return h + '</div>' + tapeHtml(row) + '</div>';
  }

  // The stage rail, the tape (approved still B). Drawn for every job but a
  // make-safe one. A press opens the confirm line; only Move or Set writes.
  function tapeHtml(row) {
    if (typeKey(row) === 'makesafe') return '';
    var s = stageOf(row);
    var h = '<div class="dpc-tape" data-dpc-region="tape"';
    if (!s || s.none) return h + '>' + failLine("Could not load this job's stage.", 'list', true) + '</div>';
    var jobId = row.id;
    var busy = !!state.stage.moving;
    var confirm = state.stage.confirm && state.stage.confirm.jobId === jobId ? state.stage.confirm : null;
    h += ' role="group" aria-label="Dispatch stage: ' + esc(s.name) + '"><div class="dpc-tape-meta"><span>Dispatch stage</span><strong>' + esc(s.name) + '</strong>';
    h += '<span class="dpc-grow"></span><span>' + s.index + ' of ' + STAGES.length + '</span></div>';
    h += '<div class="dpc-tape-track">';
    if (s.index > 1) h += '<div class="dpc-tape-fill" style="width:' + ((s.index - 1) / (STAGES.length - 1) * 100) + '%"></div>';
    h += '</div><ol class="dpc-tape-stops">';
    STAGES.forEach(function (st, i) {
      var n = i + 1;
      var cls = n < s.index ? 'done' : n === s.index ? 'now' : '';
      var left = i / (STAGES.length - 1) * 100;
      h += '<li class="' + cls + '" style="left:' + left + '%"><button type="button" class="dpc-tape-stop" data-dpc-stage="' + st.key + '"' +
        (n === s.index ? ' aria-current="step"' : '') + (busy ? ' disabled' : '') + '>' +
        '<span class="dpc-tape-mark' + (cls ? ' ' + cls : '') + '" aria-hidden="true"></span><span class="dpc-tape-label">' + esc(st.label) + '</span></button></li>';
    });
    h += '</ol>';
    h += '<p class="dpc-empty dpc-empty-tight dpc-tape-note">' + esc(stageSourceText(s)) + '</p>';
    if (TODO_OUT[row.dispatch_todo_out]) h += '<p class="dpc-empty dpc-empty-tight dpc-tape-note">' + esc(TODO_OUT[row.dispatch_todo_out]) + '</p>';
    if (confirm) {
      var num = text(row.job_number) || 'this job';
      var to = STAGES[stageIndex(confirm.to) - 1].label;
      var ask = confirm.to === s.key ? 'Set ' + num + ' at ' + to + '?' : 'Move ' + num + ' from ' + s.name + ' to ' + to + '?';
      h += '<div class="dpc-tape-confirm" role="group" aria-label="Confirm the stage"><span class="dpc-empty dpc-empty-tight dpc-grow">' + esc(ask) + '</span>';
      h += '<button type="button" class="dpc-primary" data-dpc-stage-go' + (busy ? ' disabled' : '') + '>' + (busy ? 'Moving...' : confirm.to === s.key ? 'Set' : 'Move') + '</button>';
      h += '<button type="button" data-dpc-stage-cancel' + (busy ? ' disabled' : '') + '>Cancel</button></div>';
    }
    var msg = state.stage.msg && state.stage.msg.jobId === jobId ? state.stage.msg : null;
    if (msg && msg.kind === 'fail') {
      h += '<div class="dpc-empty dpc-empty-tight dpc-tape-note dpc-note-msg-fail" role="alert">' + esc(msg.text) +
        ' <button type="button" class="dpc-retry" data-dpc-stage-retry' + (busy ? ' disabled' : '') + '>Retry</button></div>';
    } else if (msg) {
      h += '<p class="dpc-empty dpc-empty-tight dpc-tape-note" role="status">' + esc(msg.text) + '</p>';
    }
    var saving = !!state.stage.saving[jobId];
    var draft = nextDraft(jobId, row);
    var nmsg = state.stage.nextMsg[jobId];
    h += '<div class="dpc-tape-next"><label for="dpc-next-input">Next step</label>';
    h += '<input type="text" id="dpc-next-input" data-dpc-next maxlength="' + NEXT_STEP_MAX + '" placeholder="What happens next on this job" value="' + esc(draft) + '"' + (saving ? ' disabled' : '') + '>';
    h += '<button type="button" data-dpc-next-save' + (saving || nextUnchanged(jobId, row) ? ' disabled' : '') + '>' + (saving ? 'Saving...' : 'Save') + '</button></div>';
    if (nmsg) h += '<div class="dpc-note-msg' + (nmsg.ok ? '' : ' dpc-note-msg-fail') + '" role="' + (nmsg.ok ? 'status' : 'alert') + '">' + esc(nmsg.text) + '</div>';
    return h + '</div>';
  }

  // Redraws the rail in place, keeping the next-step box's typing and focus.
  function paintTape() {
    var el = region('tape');
    if (!el || !state.row) return;
    keepNextFocus(function () { el.outerHTML = tapeHtml(state.row); });
  }

  function keepNextFocus(paint) {
    var a = document.activeElement;
    var had = a && a.hasAttribute && a.hasAttribute('data-dpc-next') && root().contains(a);
    var at = had ? [a.selectionStart, a.selectionEnd] : null;
    paint();
    if (!had) return;
    var box = root().querySelector('[data-dpc-next]');
    if (box && !box.disabled) { box.focus(); try { box.setSelectionRange(at[0], at[1]); } catch (e) { /* not a text box */ } }
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

  // ───────────────────────── render: the right panel ─────────────────────────

  function docChip(name, detail, attrs, tag) {
    tag = tag || 'button';
    return '<' + tag + ' class="dpc-doc" ' + attrs + (tag === 'button' ? ' type="button"' : '') + '><span class="dpc-doc-ico" aria-hidden="true">PDF</span>' +
      '<span class="dpc-grow"><strong>' + esc(name) + '</strong><small>' + esc(detail) + '</small></span></' + tag + '>';
  }

  function sourcesHtml() {
    var d = state.detail;
    var jobId = state.jobId;
    var h = '<h4 class="dpc-h4">Quotes sent to client</h4>';
    if (d.status === 'error') {
      return h + failLine('Could not load documents.', 'detail', true) + '<h4 class="dpc-h4">Invoices</h4>' + failLine('Could not load documents.', 'detail', true);
    }
    if (d.status !== 'ok' || d.jobId !== jobId) {
      return h + '<div class="dpc-empty dpc-empty-tight">Loading documents...</div><h4 class="dpc-h4">Invoices</h4><div class="dpc-empty dpc-empty-tight">Loading documents...</div>';
    }
    var docs = d.data.documents;
    if (!Array.isArray(docs)) h += failLine('Could not load documents.', 'detail', true);
    else {
      var quotes = sourceQuotes(docs);
      if (!quotes.length) h += '<div class="dpc-empty dpc-empty-tight">No quote sent to the client yet.</div>';
      quotes.forEach(function (q) {
        // No stored PDF: listed, not pressable (desk ruling, 14 Oct).
        h += q.url
          ? docChip(q.name, q.detail, 'href="' + esc(q.url) + '" target="_blank" rel="noopener"', 'a')
          : docChip(q.name, q.detail + ' · No PDF stored', 'data-dpc-nopdf', 'div');
      });
    }
    h += '<h4 class="dpc-h4">Invoices</h4>';
    var invoices = d.data.invoices;
    if (!Array.isArray(invoices)) return h + failLine('Could not load documents.', 'detail', true);
    var mine = sourceInvoices(invoices, jobId);
    if (!mine.length) h += '<div class="dpc-empty dpc-empty-tight">No invoice on this job yet.</div>';
    mine.forEach(function (inv) {
      h += docChip(inv.name, inv.detail, 'data-dpc-invoice="' + esc(inv.xeroId) + '"');
    });
    return h;
  }

  function storyHtml() {
    var h = '<p class="dpc-sub">The whole job in one line of events, from the context system.</p>';
    var st = state.story[state.jobId];
    if (!st || st.status === 'loading') h += '<div class="dpc-empty dpc-empty-tight">Reading the story.</div>';
    else if (st.status === 'error') {
      h += st.forbidden
        ? '<div class="dpc-empty dpc-empty-tight" role="alert">The story needs a company sign-in.</div>'
        : failLine('Could not read the story.', 'story', true);
    } else if (!st.lines.length) h += '<div class="dpc-empty dpc-empty-tight">No story for this job yet.</div>';
    else {
      h += '<ol class="dpc-story">';
      st.lines.forEach(function (line) {
        line = line || {};
        var when = dayText(parseDay(line.date));
        h += '<li><strong>' + esc(storyLabel(line.kind)) + '</strong><span>' + esc(text(line.what)) + '</span>' + (when ? '<small>' + esc(when) + '</small>' : '') + '</li>';
      });
      h += '</ol>';
    }
    // The job page, opened the way the Jobs tab opens a job. Overview v2 is
    // neither asked for nor switched on: each person sees the Overview they have.
    var num = text(state.row && state.row.job_number);
    if (num) h += '<p class="dpc-joblink"><a href="#job/' + esc(encodeURIComponent(num)) + '" data-dpc-jobpage>Open job page</a></p>';
    return h;
  }

  function chatHtml() {
    var jobId = state.jobId;
    var d = state.detail;
    if (d.status === 'error') return failLine('Could not load the chat.', 'detail', true);
    if (d.status !== 'ok' || d.jobId !== jobId) return '<div class="dpc-empty dpc-empty-tight">Reading the chat.</div>';
    if (!contactOf(jobId)) return '<div class="dpc-empty dpc-empty-tight">No client contact is linked to this job, so there is no chat.</div>';
    var c = state.chat[jobId];
    if (!c || c.status === 'loading') return '<div class="dpc-empty dpc-empty-tight">Reading the chat.</div>';
    if (c.status === 'error') return failLine('Could not load the chat.', 'chat', true);
    if (!c.messages.length) return '<div class="dpc-empty dpc-empty-tight">No messages with this client yet.</div>';
    var h = '<div class="dpc-chat">';
    if (c.messages.length === CHAT_LIMIT) h += '<p class="dpc-chat-cap">Showing the latest 30 messages.</p>';
    c.messages.forEach(function (m) {
      var when = stampText(m.timestamp);
      var out = m.direction === 'outbound';
      if (isCall(m)) {
        h += '<p class="dpc-call">Call, ' + (out ? 'outbound' : 'inbound') + (when ? ', ' + esc(when) : '') + '</p>';
        return;
      }
      h += '<div class="dpc-bubble ' + (out ? 'us' : 'them') + '">' + esc(text(m.body)) +
        '<small>' + (out ? 'SecureWorks' : 'Client') + (when ? ', ' + esc(when) : '') + '</small></div>';
    });
    return h + '</div>';
  }

  function replyHtml() {
    var jobId = state.jobId;
    if (!contactOf(jobId)) return '';
    var sending = !!state.sending[jobId];
    var draft = state.replies[jobId] || '';
    var msg = state.replyMsg[jobId];
    var h = '<div class="dpc-compose"><textarea class="dpc-reply" data-dpc-reply placeholder="Reply to client..." aria-label="Reply to client by text"' + (sending ? ' disabled' : '') + '>' + esc(draft) + '</textarea>';
    h += '<button type="button" class="dpc-primary" data-dpc-send' + (sending || !draft.trim() ? ' disabled' : '') + '>' + (sending ? 'Sending...' : 'Send') + '</button></div>';
    if (msg) h += '<div class="dpc-note-msg' + (msg.ok ? '' : ' dpc-note-msg-fail') + '" role="' + (msg.ok ? 'status' : 'alert') + '">' + esc(msg.text) + '</div>';
    return h;
  }

  function emailHtml() {
    var e = state.email[state.jobId];
    var h = '';
    if (!e || e.status === 'loading') h += '<div class="dpc-empty dpc-empty-tight">Reading email.</div>';
    else if (e.status === 'error') h += failLine('Could not load email.', 'email', true);
    else if (!e.rows.length) h += '<div class="dpc-empty dpc-empty-tight">No email on this job yet.</div>';
    else {
      if (e.capped) h += '<p class="dpc-chat-cap">Showing the latest email only.</p>';
      e.rows.forEach(function (m) {
        var when = dayText(parseStamp(m.occurred_at));
        h += '<div class="dpc-source"><strong>' + esc(text(m.subject) || 'No subject') + '</strong>';
        h += '<p class="dpc-muted">' + esc(emailWho(m)) + (when ? ', ' + esc(when) : '') + '</p>';
        if (text(m.preview)) h += '<p class="dpc-preview">' + esc(text(m.preview)) + '</p>';
        h += '</div>';
      });
    }
    // get_job_conversation lists system email, GoHighLevel email, inbox
    // filings and the mailbox email the context system has placed on the job
    // (business_events).
    return h + '<p class="dpc-foot-line">Email sent by the system, GoHighLevel (client messaging) email, email filed from the inbox, and mailbox email the context system has placed on this job. Mailbox email not yet placed on a job is not listed.</p>';
  }

  function messagesHtml() {
    var h = '<div class="dpc-seg" role="group" aria-label="Message type">';
    h += '<button type="button" data-dpc-msg="client" aria-pressed="' + (state.msg === 'client') + '">Client chat (GHL)</button>';
    h += '<button type="button" data-dpc-msg="email" aria-pressed="' + (state.msg === 'email') + '">Email history</button></div>';
    if (state.msg === 'email') return h + emailHtml();
    return h + '<div data-dpc-region="chat">' + chatHtml() + '</div><div data-dpc-region="reply">' + replyHtml() + '</div>';
  }

  function panelHtml() {
    if (state.base.status === 'error' && state.rowStale) return failLine('Could not load this job.', 'list', true);
    if (!state.row) return '<div class="dpc-empty dpc-empty-tight">' + (state.base.status === 'ok' ? 'No job to show.' : 'Loading jobs...') + '</div>';
    if (state.tab === 'story') return storyHtml();
    if (state.tab === 'messages') return messagesHtml();
    return sourcesHtml();
  }

  function contextHtml() {
    if (!state.rightOpen) {
      var f = '<aside class="dpc-float" data-dpc-region="context" aria-label="Job context, collapsed">';
      TABS.forEach(function (t) { f += '<button type="button" data-dpc-opentab="' + t.key + '">' + esc(t.label) + '</button>'; });
      return f + '</aside>';
    }
    var h = '<aside class="dpc-panel dpc-context" data-dpc-region="context" aria-label="Job context"><div class="dpc-tabs" role="tablist">';
    TABS.forEach(function (t) {
      h += '<button type="button" role="tab" id="dpc-tab-' + t.key + '" data-dpc-tab="' + t.key + '" aria-selected="' + (state.tab === t.key) + '" aria-controls="dpc-tabpanel">' + esc(t.label) + '</button>';
    });
    h += '<button type="button" class="dpc-side-btn dpc-side-btn-light" data-dpc-right aria-label="Collapse job context" title="Collapse">&raquo;</button></div>';
    h += '<div class="dpc-pad" role="tabpanel" id="dpc-tabpanel" aria-labelledby="dpc-tab-' + state.tab + '" data-dpc-region="panel">' + panelHtml() + '</div>';
    return h + '</aside>';
  }

  // The whole panel (job, tab or open state changed), then any read it needs.
  function paintContext() {
    var el = region('context');
    if (!el) return;
    el.outerHTML = contextHtml();
    var layout = root().querySelector('.dpc-layout');
    if (layout) layout.classList.toggle('dpc-right-closed', !state.rightOpen);
    ensureTabData();
  }

  // The open tab's body, when a read lands. On Client chat only the chat is
  // redrawn, so the reply box keeps its text and the keyboard focus.
  function paintPanel() {
    var el = region('panel');
    if (!el) return;
    var reply = region('reply');
    if (reply && state.tab === 'messages' && state.msg === 'client') {
      paintChat();
      if (!reply.querySelector('[data-dpc-reply]') && contactOf(state.jobId)) paintReply();
      return;
    }
    el.innerHTML = panelHtml();
  }

  function paintChat() {
    var el = region('chat');
    if (!el) return;
    el.innerHTML = chatHtml();
  }

  function paintReply() {
    var el = region('reply');
    if (!el) return;
    var had = el.contains(document.activeElement) && document.activeElement.hasAttribute('data-dpc-reply');
    el.innerHTML = replyHtml();
    if (had) { var t = el.querySelector('[data-dpc-reply]'); if (t && !t.disabled) t.focus(); }
  }

  // ───────────────────────── render: Materials by supplier (slice 4) ─────────────────────────

  var CHEV_SVG = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function matFail(message, retry) {
    return '<div class="dpc-empty dpc-empty-tight dpc-mat-fail" role="alert">' + esc(message) +
      ' <button type="button" class="dpc-retry" data-dpc-mat-retry="' + esc(retry) + '">Retry</button></div>';
  }

  function addSupplierHtml(e) {
    var s = state.mat.sup;
    if (s.status === 'error') {
      return '<div class="dpc-addsup-state dpc-mat-fail" role="alert">Could not load suppliers <button type="button" class="dpc-retry" data-dpc-mat-retry="suppliers">Retry</button></div>';
    }
    if (s.status !== 'ok') return '<select class="dpc-addsup" disabled aria-label="Add supplier"><option>Loading suppliers...</option></select>';
    if (!s.list.some(function (x) { return x && x.id && x.is_active !== false; })) return '<div class="dpc-addsup-state">No supplier contacts on file.</div>';
    var opts = supplierOptions(s.list, e.suppliers.map(function (x) { return String(x.supplier_id); }));
    var h = '<select class="dpc-addsup" data-dpc-mat-addsup aria-label="Add supplier"' + (e.adding ? ' disabled' : '') + '>';
    h += '<option value="">' + (e.adding ? 'Adding supplier...' : '+ Add supplier') + '</option>';
    [['Material suppliers', opts.tagged], ['All supplier contacts', opts.rest]].forEach(function (g) {
      if (!g[1].length) return;
      h += '<optgroup label="' + esc(g[0]) + '">';
      g[1].forEach(function (o) { h += '<option value="' + esc(o.id) + '">' + esc(o.label) + '</option>'; });
      h += '</optgroup>';
    });
    return h + '</select>';
  }

  function supplierName(e, id) {
    for (var i = 0; i < e.suppliers.length; i++) if (String(e.suppliers[i].supplier_id) === id) return text(e.suppliers[i].name) || 'Name not recorded';
    return 'Supplier not recorded';
  }

  function lineHtml(e, l) {
    var id = esc(l.id);
    var h = '<div class="dpc-line-wrap" data-dpc-mat-row="' + id + '">';
    if (onOrder(l)) {
      // On an order (slice 5 stamps it): a plain label, no boxes and no cross.
      var tone = (MAT_STATUS[l.display_status] || { tone: 'muted' }).tone;
      h += '<div class="dpc-line dpc-line-ro"><span>' + esc(l.description) + '</span><span class="dpc-mono">' + esc(l.quantity) + '</span>';
      h += '<span class="dpc-mono">' + esc(l.unit) + '</span><span>' + esc(supplierName(e, l.supplier_id)) + '</span>';
      h += '<span><span class="dpc-status dpc-tone-' + tone + '">' + esc(matStatusLabel(l.display_status)) + '</span></span><span></span></div>';
      return h + '</div>';
    }
    var status = (MAT_STATUS[l.status] && matSettable(l.status)) ? l.status : 'not_reviewed';
    h += '<div class="dpc-line">';
    h += '<input type="text" data-dpc-mat-line="' + id + '" data-dpc-mat-cell="description" maxlength="300" value="' + esc(l.description) + '" aria-label="Item">';
    h += '<input type="text" inputmode="decimal" data-dpc-mat-line="' + id + '" data-dpc-mat-cell="quantity" value="' + esc(l.quantity) + '" aria-label="Qty"' + (matQty(l.quantity).ok ? '' : ' aria-invalid="true"') + '>';
    h += '<input type="text" data-dpc-mat-line="' + id + '" data-dpc-mat-cell="unit" maxlength="30" value="' + esc(l.unit) + '" aria-label="Unit">';
    h += '<select data-dpc-mat-move="' + id + '" aria-label="Supplier">';
    e.suppliers.forEach(function (s) {
      var sid = String(s.supplier_id);
      h += '<option value="' + esc(sid) + '"' + (sid === l.supplier_id ? ' selected' : '') + '>' + esc(text(s.name) || 'Name not recorded') + '</option>';
    });
    h += '</select>';
    h += '<select class="dpc-status dpc-status-pick dpc-tone-' + MAT_STATUS[status].tone + '" data-dpc-mat-status="' + id + '" aria-label="Status">';
    MAT_SETTABLE.forEach(function (k) { h += '<option value="' + k + '"' + (k === status ? ' selected' : '') + '>' + esc(MAT_STATUS[k].label) + '</option>'; });
    h += '</select>';
    h += '<button type="button" class="dpc-x" data-dpc-mat-del="' + id + '" aria-label="Remove line">&times;</button></div>';
    if (l.msg) {
      h += '<div class="dpc-line-msg dpc-mat-fail" role="alert">' + esc(l.msg) +
        (l.retry ? ' <button type="button" class="dpc-retry" data-dpc-mat-retry="line:' + id + '">Retry</button>' : '') + '</div>';
    }
    return h + '</div>';
  }

  function suggestShown(e) {
    return e.canSuggest && !e.lines.some(function (l) { return !!l.saved; });
  }

  function supCardHtml(e, s) {
    var sid = String(s.supplier_id);
    var name = text(s.name) || 'Name not recorded';
    var hasLines = e.lines.some(function (l) { return l.supplier_id === sid; });
    var lines = e.lines.filter(function (l) { return l.supplier_id === sid && !l.gone; })
      .sort(function (a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });
    var busy = e.busyCard[sid];
    var h = '<div class="dpc-supcard" data-dpc-mat-card="' + esc(sid) + '"><div class="dpc-suphead"><span class="dpc-supdot" aria-hidden="true"></span><strong>' + esc(name) + '</strong>';
    h += s.email ? '<span class="dpc-supmail">' + esc(s.email) + '</span>' : '<span class="dpc-status dpc-tone-muted">No email on file</span>';
    if (s.active === false) h += '<span class="dpc-status dpc-tone-muted">Contact no longer active</span>';
    h += '<span class="dpc-grow"></span>';
    if (!hasLines) h += '<button type="button" class="dpc-x" data-dpc-mat-remove="' + esc(sid) + '" aria-label="Take ' + esc(name) + ' off this job"' + (busy ? ' disabled' : '') + '>&times;</button>';
    h += '</div><div class="dpc-lines"><div class="dpc-line dpc-line-head"><span>Item</span><span>Qty</span><span>Unit</span><span>Supplier</span><span>Status</span><span></span></div>';
    if (!lines.length) h += '<div class="dpc-line-empty">No lines yet. Move lines here or add one.</div>';
    lines.forEach(function (l) { h += lineHtml(e, l); });
    h += '</div>';
    var msg = e.card[sid];
    if (msg) {
      h += '<div class="dpc-card-msg' + (msg.retry ? ' dpc-mat-fail' : '') + '" role="' + (msg.retry ? 'alert' : 'status') + '">' + esc(msg.text) +
        (msg.retry ? ' <button type="button" class="dpc-retry" data-dpc-mat-retry="card:' + esc(sid) + '">Retry</button>' : '') + '</div>';
    }
    h += '<div class="dpc-card-foot"><button type="button" class="dpc-addline" data-dpc-mat-addline="' + esc(sid) + '">+ Add line</button>';
    if (suggestShown(e)) {
      h += '<button type="button" class="dpc-addline" data-dpc-mat-suggest="' + esc(sid) + '"' + (busy ? ' disabled' : '') + '>' +
        (busy === 'suggest' ? 'Suggesting...' : 'Suggest lines from the scope') + '</button>';
    }
    return h + '</div></div>';
  }

  // The save line under the cards.
  function matSaveHtml(e) {
    var busy = e.w.textBusy || e.w.sketchBusy || e.lines.some(function (l) { return l.busy; });
    var failed = e.w.textFailed || e.w.sketchFailed || e.lines.some(function (l) { return l.failed || l.delFailed; });
    if (failed) return '<span class="dpc-mat-fail" role="alert">Not saved. <button type="button" class="dpc-retry" data-dpc-mat-retry="saves">Retry</button></span>';
    if (busy) return '<span role="status">Saving...</span>';
    if (e.touched) return '<span role="status">All changes saved</span>';
    return '';
  }

  // The job's purchase orders, read only and never merged into a supplier
  // card: an order names its supplier as typed text. No price is shown.
  function ordersHtml(e) {
    if (!e.ordersOk) return '<div class="dpc-orders">' + matFail("Could not load this job's orders.", 'orders') + '</div>';
    if (!e.orders.length) return '';
    var h = '<div class="dpc-orders"><h4 class="dpc-mat-h4">Orders on this job</h4>';
    e.orders.forEach(function (o) {
      h += '<div class="dpc-supcard dpc-ordercard"><div class="dpc-suphead"><strong>' + esc(text(o.supplier_name) || 'Supplier not recorded') + '</strong>';
      h += '<span class="dpc-status dpc-tone-info">' + esc((text(o.po_number) || 'No order number') + ' · ' + orderStatusWord(o.status)) + '</span></div>';
      h += '<div class="dpc-lines"><div class="dpc-line dpc-oline dpc-line-head"><span>Item</span><span>Qty</span><span>Unit</span></div>';
      var lines = Array.isArray(o.lines) ? o.lines : [];
      if (!lines.length) h += '<div class="dpc-line-empty">No lines on this order.</div>';
      lines.forEach(function (l) {
        l = l || {};
        h += '<div class="dpc-line dpc-oline"><span>' + esc(text(l.description) || 'No item recorded') + '</span><span class="dpc-mono">' + esc(matQtyText(l.quantity)) + '</span><span class="dpc-mono">' + esc(text(l.unit)) + '</span></div>';
      });
      h += '</div><p class="dpc-order-note">Made outside this list. Read only.</p></div>';
    });
    return h + '</div>';
  }

  function sketchMsgHtml(e) {
    if (e.w.sketchBroken) return '<div class="dpc-line-msg dpc-mat-fail" role="alert">Could not show the saved sketch.</div>';
    if (e.w.sketchMsg) return '<div class="dpc-line-msg dpc-mat-fail" role="alert">' + esc(e.w.sketchMsg) + '</div>';
    return '';
  }

  function workoutHtml(e) {
    var h = '<details class="dpc-workout" data-dpc-mat-workout' + (state.mat.workOpen ? ' open' : '') + '><summary>Working out and sketch</summary>';
    h += '<div class="dpc-scratch"><textarea class="dpc-textarea" data-dpc-mat-pad maxlength="20000" placeholder="42 m run / 2.4 m bays = 18 bays..." aria-label="Working out">' + esc(e.w.text) + '</textarea>';
    h += '<div class="dpc-canvas-wrap"><canvas class="dpc-canvas" data-dpc-mat-canvas width="600" height="220" role="img" aria-label="Sketch pad"></canvas>';
    h += '<button type="button" class="dpc-canvas-clear" data-dpc-mat-clear>Clear sketch</button></div></div>';
    return h + '<div data-dpc-region="matsketch">' + sketchMsgHtml(e) + '</div></details>';
  }

  function matBodyHtml(e) {
    if (!e || e.status === 'loading') return '<div class="dpc-empty dpc-empty-tight">Loading the materials...</div>';
    if (e.status === 'error') return matFail('Could not load the materials.', 'read');
    var h = '';
    if (e.notice) h += '<div class="dpc-mat-notice" role="status">' + esc(e.notice) + '</div>';
    if (e.addMsg) {
      h += '<div class="dpc-mat-notice dpc-mat-fail" role="alert">' + esc(e.addMsg.text) +
        (e.addMsg.id ? ' <button type="button" class="dpc-retry" data-dpc-mat-retry="add">Retry</button>' : '') + '</div>';
    }
    if (!e.suppliers.length) h += '<div class="dpc-empty dpc-empty-tight">No suppliers chosen for this job yet. Add one to start writing out the materials.</div>';
    e.suppliers.forEach(function (s) { h += supCardHtml(e, s); });
    h += '<div class="dpc-mat-save" data-dpc-region="matsave">' + matSaveHtml(e) + '</div>';
    return h + ordersHtml(e) + workoutHtml(e);
  }

  // Drawn on every job except a make-safe one.
  function matHtml() {
    var row = state.row;
    if (!row || isMakesafe(row)) return '';
    var e = matEntry(row.id);
    var open = state.mat.open;
    var h = '<div class="dpc-sec dpc-mat' + (open ? '' : ' dpc-collapsed') + '" data-dpc-region="mat"><div class="dpc-sec-head"><div class="dpc-grow"><span class="dpc-eyebrow">Order</span><h3>Materials by supplier</h3>';
    if (open) h += '<p>Write out the materials and split them by supplier</p>';
    h += '</div>';
    if (open && e && e.status === 'ok') h += addSupplierHtml(e);
    h += '<button type="button" class="dpc-chev" data-dpc-toggle="order" aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse' : 'Expand') + ' Materials by supplier">' + CHEV_SVG + '</button></div>';
    if (open) h += '<div class="dpc-sec-body">' + matBodyHtml(e) + '</div>';
    return h + '</div>';
  }

  // Where the keyboard was inside the section, to put it back after a repaint.
  var MAT_FOCUS_KEYS = ['data-dpc-mat-line', 'data-dpc-mat-cell', 'data-dpc-mat-move', 'data-dpc-mat-status', 'data-dpc-mat-pad', 'data-dpc-mat-addsup',
    'data-dpc-toggle', 'data-dpc-mat-addline', 'data-dpc-mat-suggest', 'data-dpc-mat-clear', 'data-dpc-mat-del', 'data-dpc-mat-retry'];
  function matFocus(el) {
    var a = document.activeElement;
    if (!a || !el.contains(a)) return null;
    var sel = MAT_FOCUS_KEYS.filter(function (k) { return a.hasAttribute(k); }).map(function (k) {
      return '[' + k + '="' + String(a.getAttribute(k)).replace(/["\\]/g, '\\$&') + '"]';
    }).join('');
    if (!sel) return null;
    var f = { sel: sel };
    try { f.start = a.selectionStart; f.end = a.selectionEnd; } catch (x) { /* not a text box */ }
    return f;
  }

  var painting = false;
  function paintMat() {
    var el = region('mat');
    if (!el) return;
    var f = matFocus(el);
    painting = true;
    try { el.outerHTML = matHtml(); } finally { painting = false; }
    wireMat();
    var now = f && region('mat') ? region('mat').querySelector(f.sel) : null;
    if (!now) return;
    now.focus({ preventScroll: true });
    if (typeof f.start === 'number' && now.setSelectionRange) { try { now.setSelectionRange(f.start, f.end); } catch (x) { /* not a text box */ } }
  }
  function paintMatIf(jobId) { if (state.jobId === jobId) paintMat(); }

  function paintMatSave(jobId) {
    if (state.jobId !== jobId) return;
    var el = region('matsave');
    var e = matEntry(jobId);
    if (el && e) el.innerHTML = matSaveHtml(e);
  }

  function paintSketchMsg(jobId) {
    if (state.jobId !== jobId) return;
    var el = region('matsketch');
    var e = matEntry(jobId);
    if (el && e) el.innerHTML = sketchMsgHtml(e);
  }

  // The open job's card, after a write changed its "items ready".
  function paintCard(jobId) {
    var list = region('list');
    var row = rowById(jobId);
    if (!list || !row || !state.leftOpen) return;
    Array.prototype.forEach.call(list.querySelectorAll('.dpc-job[data-dpc-job]'), function (el) {
      if (el.getAttribute('data-dpc-job') !== jobId) return;
      var had = document.activeElement === el;
      var tmp = document.createElement('div');
      tmp.innerHTML = cardHtml(row);
      var card = tmp.firstChild;
      el.parentNode.replaceChild(card, el);
      if (had) card.focus({ preventScroll: true });
    });
  }

  // The saved sketch, drawn back onto the pad after every paint of the section.
  function redrawSketch() {
    var e = matEntry(state.jobId);
    var r = region('mat');
    var c = r && r.querySelector('[data-dpc-mat-canvas]');
    var ctx = c && c.getContext && c.getContext('2d');
    if (!e || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    var src = e.w.sketch;
    if (!src) return;
    var img = new Image();
    c.dpcLoading = src;
    img.onload = function () {
      if (c.dpcLoading === src) c.dpcLoading = null;
      if (!c.isConnected) return;
      if (e.w.sketch === src) { ctx.drawImage(img, 0, 0); return; }
      // A stroke landed before the saved picture had drawn: put the picture
      // under it and save the two together, so the stroke never wipes it.
      if (c.dpcDrawnOver !== src) return;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.drawImage(img, 0, 0);
      ctx.restore();
      sketchDrawn(e.jobId, c.toDataURL('image/png'));
    };
    img.onerror = function () {
      if (c.dpcLoading === src) c.dpcLoading = null;
      if (e.w.sketch !== src) return;
      // Nothing is saved over it until a stroke is drawn.
      e.w.sketchBroken = true;
      paintSketchMsg(e.jobId);
    };
    img.src = src;
  }

  // A mouse, a finger or a pen draws; the page does not scroll while drawing.
  function wireMat() {
    var r = region('mat');
    var c = r && r.querySelector('[data-dpc-mat-canvas]');
    var ctx = c && c.getContext && c.getContext('2d');
    if (!ctx) return;
    var jobId = state.jobId;
    redrawSketch();
    var drawing = false;
    var at = function (ev) {
      var b = c.getBoundingClientRect();
      return [(ev.clientX - b.left) * c.width / (b.width || 1), (ev.clientY - b.top) * c.height / (b.height || 1)];
    };
    c.addEventListener('pointerdown', function (ev) {
      if (ev.button > 0) return;
      drawing = true;
      if (c.dpcLoading) c.dpcDrawnOver = c.dpcLoading;
      try { c.setPointerCapture(ev.pointerId); } catch (x) { /* already released */ }
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#293C46';
      var p = at(ev);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[0] + 0.01, p[1]);
      ctx.stroke();
      ev.preventDefault();
    });
    c.addEventListener('pointermove', function (ev) {
      if (!drawing) return;
      var p = at(ev);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ev.preventDefault();
    });
    var end = function () {
      if (!drawing) return;
      drawing = false;
      sketchDrawn(jobId, c.toDataURL('image/png'));
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
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
      h += headHtml(state.row) + sectionHtml() + matHtml();
    }
    return h + '</section>';
  }

  function paintWorkspace() {
    var w = region('workspace');
    if (w) w.outerHTML = workspaceHtml();
    wireMat();
  }
  function paintHead() { var el = region('head'); if (el) keepNextFocus(function () { el.outerHTML = headHtml(state.row); }); }
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
    h += '<div class="dpc-layout' + (state.leftOpen ? '' : ' dpc-left-closed') + (state.rightOpen ? '' : ' dpc-right-closed') + '">' + queueHtml() + workspaceHtml() + contextHtml() + '</div></div>';
    r.innerHTML = h;
    wireMat();
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
    var t = e.target.closest ? e.target.closest('[data-dpc-job],[data-dpc-type],[data-dpc-side],[data-dpc-toggle],[data-dpc-retry],[data-dpc-photo],[data-dpc-save],' +
      '[data-dpc-tab],[data-dpc-right],[data-dpc-opentab],[data-dpc-msg],[data-dpc-invoice],[data-dpc-send],[data-dpc-jobpage],' +
      '[data-dpc-mode],[data-dpc-stage],[data-dpc-stage-go],[data-dpc-stage-cancel],[data-dpc-stage-retry],[data-dpc-next-save],' +
      '[data-dpc-mat-retry],[data-dpc-mat-addline],[data-dpc-mat-suggest],[data-dpc-mat-remove],[data-dpc-mat-del],[data-dpc-mat-clear]') : null;
    if (!t || t.disabled) return;
    if (onPanelClick(t, e)) return;
    if (onStageClick(t)) return;
    if (onMatClick(t)) return;
    if (t.hasAttribute('data-dpc-job')) {
      if (t.getAttribute('data-dpc-job') !== state.jobId) state.stage.confirm = null;
      selectJob(rowById(t.getAttribute('data-dpc-job')));
    }
    else if (t.hasAttribute('data-dpc-type')) { state.type = t.getAttribute('data-dpc-type'); paintList(); }
    else if (t.hasAttribute('data-dpc-mode')) {
      state.mode = t.getAttribute('data-dpc-mode') === 'all' ? 'all' : 'todo';
      writeStore('localStorage', LS_MODE, state.mode);
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
      else if (what === 'story' && state.jobId) loadStory(state.jobId);
      else if (what === 'email' && state.jobId) loadEmail(state.jobId);
      else if (what === 'chat' && state.jobId && contactOf(state.jobId)) loadChat(state.jobId, contactOf(state.jobId));
    }
    else if (t.hasAttribute('data-dpc-photo')) {
      var url = photoUrls[+t.getAttribute('data-dpc-photo')];
      if (url) global.openOpsLightbox(url);
    }
    else if (t.hasAttribute('data-dpc-save')) { saveNote(); }
  }

  // The rail's controls. True when the press was one of them. A press on a
  // stop only opens the confirm line; pressing the stop already set does
  // nothing.
  function onStageClick(t) {
    var row = state.row;
    var s = stageOf(row);
    if (t.hasAttribute('data-dpc-stage')) {
      if (!s || s.none || state.stage.moving) return true;
      var to = t.getAttribute('data-dpc-stage');
      if (stageIndex(to) < 1 || (to === s.key && s.source === 'set')) return true;
      state.stage.confirm = { jobId: row.id, to: to };
      state.stage.msg = null;
      paintTape();
      refocus('[data-dpc-stage-go]');
    } else if (t.hasAttribute('data-dpc-stage-go')) {
      var c = state.stage.confirm;
      if (c && row && c.jobId === row.id) moveStage(row.id, c.to);
    } else if (t.hasAttribute('data-dpc-stage-cancel')) {
      var was = state.stage.confirm && state.stage.confirm.to;
      state.stage.confirm = null;
      paintTape();
      if (was) refocus('[data-dpc-stage="' + was + '"]');
    } else if (t.hasAttribute('data-dpc-stage-retry')) {
      var m = state.stage.msg;
      if (m && row && m.jobId === row.id && m.to) moveStage(row.id, m.to);
    } else if (t.hasAttribute('data-dpc-next-save')) {
      saveNextStep();
    } else {
      return false;
    }
    return true;
  }

  function setTab(key) {
    state.tab = tabKey(key);
    writeStore('localStorage', LS_TAB, state.tab);
  }

  // The panel's controls. True when the press was one of them.
  function onPanelClick(t, e) {
    if (t.hasAttribute('data-dpc-tab')) {
      setTab(t.getAttribute('data-dpc-tab'));
      paintContext();
      refocus('[data-dpc-tab="' + state.tab + '"]');
    } else if (t.hasAttribute('data-dpc-right')) {
      state.rightOpen = false;
      writeStore('localStorage', LS_RIGHT, '0');
      paintContext();
      refocus('[data-dpc-opentab="' + state.tab + '"]');
    } else if (t.hasAttribute('data-dpc-opentab')) {
      setTab(t.getAttribute('data-dpc-opentab'));
      state.rightOpen = true;
      writeStore('localStorage', LS_RIGHT, '1');
      paintContext();
      refocus('[data-dpc-tab="' + state.tab + '"]');
    } else if (t.hasAttribute('data-dpc-msg')) {
      state.msg = t.getAttribute('data-dpc-msg') === 'email' ? 'email' : 'client';
      var panel = region('panel');
      if (panel) panel.innerHTML = panelHtml();
      ensureTabData();
      refocus('[data-dpc-msg="' + state.msg + '"]');
    } else if (t.hasAttribute('data-dpc-invoice')) {
      var xeroId = t.getAttribute('data-dpc-invoice');
      if (!xeroId) global.showToast('Could not load invoice PDF', 'error');
      else if (!state.pdfLoading[xeroId]) {
        state.pdfLoading[xeroId] = true;
        Promise.resolve(global.openInvoicePdfFromXero(xeroId, t.querySelector('small'))).catch(function () {}).then(function () {
          delete state.pdfLoading[xeroId];
        });
      }
    } else if (t.hasAttribute('data-dpc-send')) {
      sendReply();
    } else if (t.hasAttribute('data-dpc-jobpage')) {
      // A plain press opens the job as the Jobs tab does, which puts
      // #job/<job number> in the address; a new-tab press keeps the link.
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || typeof global.openJobDetail !== 'function' || !state.jobId) return true;
      e.preventDefault();
      global.openJobDetail(state.jobId);
    } else {
      return false;
    }
    return true;
  }

  // Materials by supplier's controls. True when the press was one of them.
  function onMatClick(t) {
    var jobId = state.jobId;
    if (t.getAttribute('data-dpc-toggle') === 'order') {
      state.mat.open = !state.mat.open;
      writeStore('localStorage', LS_ORDER, state.mat.open ? '1' : '0');
      paintMat();
      refocus('[data-dpc-toggle="order"]');
    } else if (t.hasAttribute('data-dpc-mat-retry')) {
      var what = t.getAttribute('data-dpc-mat-retry');
      var e = matEntry(jobId);
      if (what === 'suppliers') ensureSuppliers(true);
      else if (!jobId) return true;
      else if (what === 'read') readMat(jobId, false);
      else if (what === 'orders') readMat(jobId, true);
      else if (what === 'saves') retrySaves(jobId);
      else if (what === 'add' && e && e.addMsg && e.addMsg.id) addSupplier(jobId, e.addMsg.id);
      else if (what.indexOf('line:') === 0) retryLine(jobId, what.slice(5));
      else if (what.indexOf('card:') === 0 && e) {
        var sid = what.slice(5);
        var msg = e.card[sid];
        if (msg && msg.retry === 'remove') removeSupplier(jobId, sid);
        else if (msg && msg.retry === 'suggest') suggestLines(jobId, sid);
      }
    } else if (t.hasAttribute('data-dpc-mat-addline')) {
      addLine(jobId, t.getAttribute('data-dpc-mat-addline'));
    } else if (t.hasAttribute('data-dpc-mat-suggest')) {
      suggestLines(jobId, t.getAttribute('data-dpc-mat-suggest'));
    } else if (t.hasAttribute('data-dpc-mat-remove')) {
      removeSupplier(jobId, t.getAttribute('data-dpc-mat-remove'));
    } else if (t.hasAttribute('data-dpc-mat-del')) {
      deleteLine(jobId, t.getAttribute('data-dpc-mat-del'));
    } else if (t.hasAttribute('data-dpc-mat-clear')) {
      clearSketch(jobId);
    } else {
      return false;
    }
    return true;
  }

  // Choice boxes: Add supplier, a line's supplier and its status.
  function onChange(e) {
    var t = e.target;
    if (!t || !t.hasAttribute || !state.jobId) return;
    if (t.hasAttribute('data-dpc-mat-addsup')) {
      var id = t.value;
      t.value = '';
      if (id) addSupplier(state.jobId, id);
    } else if (t.hasAttribute('data-dpc-mat-move')) {
      moveLine(state.jobId, t.getAttribute('data-dpc-mat-move'), t.value);
    } else if (t.hasAttribute('data-dpc-mat-status')) {
      setStatus(state.jobId, t.getAttribute('data-dpc-mat-status'), t.value);
    }
  }

  // A cell or the pad is saved when it is left. A repaint that takes the
  // focused cell away is not the person leaving it.
  function onFocusOut(e) {
    var t = e.target;
    if (painting || !t || !t.hasAttribute || !state.jobId) return;
    if (t.hasAttribute('data-dpc-mat-cell')) saveLine(state.jobId, t.getAttribute('data-dpc-mat-line'));
    else if (t.hasAttribute('data-dpc-mat-pad')) saveText(state.jobId);
  }

  function onToggle(e) {
    var t = e.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-dpc-mat-workout') || state.mat.workOpen === t.open) return;
    state.mat.workOpen = t.open;
    writeStore('localStorage', LS_WORKOUT, t.open ? '1' : '0');
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
    if (t.hasAttribute('data-dpc-reply') && state.jobId) {
      state.replies[state.jobId] = t.value;
      var box = region('reply');
      var send = box && box.querySelector('[data-dpc-send]');
      if (send) send.disabled = !t.value.trim() || !!state.sending[state.jobId];
      if (state.replyMsg[state.jobId]) {
        state.replyMsg[state.jobId] = null;
        var line = box && box.querySelector('.dpc-note-msg');
        if (line) line.remove();
      }
      return;
    }
    if (t.hasAttribute('data-dpc-next') && state.jobId && state.row) {
      state.stage.drafts[state.jobId] = t.value;
      var tape = region('tape');
      var save = tape && tape.querySelector('[data-dpc-next-save]');
      if (save) save.disabled = !!state.stage.saving[state.jobId] || nextUnchanged(state.jobId, state.row);
      if (state.stage.nextMsg[state.jobId]) {
        state.stage.nextMsg[state.jobId] = null;
        var said = tape && tape.querySelector('.dpc-tape-next + .dpc-note-msg');
        if (said) said.remove();
      }
      return;
    }
    if (t.hasAttribute('data-dpc-mat-cell') && state.jobId) {
      var matRow = matLine(matEntry(state.jobId), t.getAttribute('data-dpc-mat-line'));
      var field = t.getAttribute('data-dpc-mat-cell');
      if (matRow && (field === 'description' || field === 'quantity' || field === 'unit')) matRow[field] = t.value;
      return;
    }
    if (t.hasAttribute('data-dpc-mat-pad') && state.jobId) { padInput(state.jobId, t.value); return; }
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
      r.addEventListener('change', onChange);
      r.addEventListener('focusout', onFocusOut);
      r.addEventListener('toggle', onToggle, true);
      wired = true;
    }
    if (!r.firstChild) render();
    loadBase();
  }

  global.OpsDispatch = { show: show };
})(window);
