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
 * Slice 5 turns a supplier's To order lines into a purchase order, its PDF and
 * a held email, and adds the Emails section under Materials by supplier and the
 * Purchase orders group in Sources. Reads: ops-api dispatch_order_emails once
 * per job open and once after each slice 5 write (drafts and the job's order
 * and client email threads), and dispatch_order_pdf only on a press (a 300
 * second link to an order's PDF). Its writes, each sent once on a person's
 * press or on leaving a draft box: dispatch_order_create, _update (Update PO
 * and email, and Take off), _cancel, _draft_save, _discard,
 * _release_unknown, dispatch_order_send, dispatch_order_reply and
 * dispatch_email_link_po. An email goes to a supplier only from the two Send
 * now presses (sendDraft, sendThreadReply below) or Try the send again after a send
 * whose result was not confirmed; nothing sends on create, on open or on its
 * own. Never called: create_po, update_po, delete_po, email_po,
 * push_po_to_xero, send-po-email, update_supplier_email, sync_suppliers,
 * update_job_status.
 *
 * Slice 6 adds the Schedule section (Deliveries) under Emails (never on a
 * make-safe job): one row per purchase order per chosen supplier, each from
 * expected, to confirmed by the supplier, to sighted on site. It adds no read:
 * its rows are the deliveries block of slice 4's one dispatch_materials read,
 * and the rail's sightings line reads the list row's deliveries_orders_total /
 * deliveries_orders_sighted. Its three writes, each sent once on a person's
 * press (the expected date only when its box is left or Enter is pressed),
 * against the order's updated_at: ops-api
 * dispatch_delivery_set_expected, dispatch_delivery_set_confirmed (from the
 * row or a supplier thread) and dispatch_delivery_mark_sighted. Each writes one
 * purchase_orders row and one job_events row: never the order's status, a job
 * status, a Dispatch stage, Xero or a message. Open Calendar calls the page's
 * own showView('calendar') once, the same as the Calendar tab.
 *
 * Slice 7 finishes that section as Deliveries and install: under the
 * deliveries table, the install row (who is booked on which day, from the list
 * row's dispatch_install; no new read) and Mark confirmed. Its one write, on a
 * person's press: ops-api set_dispatch_install_confirmed (job_id, confirmed,
 * expected_install_day, expected_confirmed_at), which writes Dispatch's own
 * mark on job_dispatch_state and one job_events row. It makes, moves, locks or
 * confirms no booking (never create_assignment, update_assignment,
 * confirm_assignment or bulk_confirm), sends nothing and moves no job status
 * or Dispatch stage. A stop 6 job stays in To do until its install is
 * confirmed; the card and the rail say why.
 *
 * Guards: tests/e2e/ops-tab-set.spec.js (slices 1, 3, 4 and 5) and
 * tests/e2e/ops-dispatch-panel.spec.js (slice 2).
 * Contracts: secureworks-backend docs/dispatch-slice-1-read-contract.md,
 * docs/dispatch-slice-3-contract.md, docs/dispatch-slice-4-contract.md,
 * docs/dispatch-slice-5-contract.md and docs/dispatch-slice-6-contract.md.
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
  var LS_MAIL = 'sw_dispatch_mail_open';
  var ORDERS_FROM = 'orders@secureworksgroup.app';
  var LS_SCHED = 'sw_dispatch_sched_open';
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
      // Slice 6: the rail's sightings counts, the same way.
      if (resp.dispatch_deliveries !== 'ok') { delete r.deliveries_orders_total; delete r.deliveries_orders_sighted; }
      // Slice 7: a failed bookings read is never "Not booked".
      if (resp.dispatch_installs !== 'ok') { delete r.dispatch_install; delete r.dispatch_install_open; }
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
    // A todo_total that does not match the To do rows fails To do only: the
    // stage fields stay on the rows, and All jobs, the cards and the rail draw.
    var todo = 'failed';
    if (stages === 'ok') {
      var marked = rows.filter(function (r) { return r.dispatch_todo === true; }).length;
      todo = marked === resp.todo_total ? 'ok' : 'failed';
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
      todo: todo,
      todoTotal: todo === 'ok' ? resp.todo_total : null
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
    return orderStatusWord(s);
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
      orders: ordersOk ? resp.orders.filter(function (o) { return o && typeof o === 'object'; }) : [],
      deliveries: ordersOk ? deliveriesFrom(resp.deliveries) : null
    };
  }

  // ── slice 6: Deliveries ──

  // An order's delivery block as the server works it out (dispatch_deliveries.ts).
  function delivOk(d) {
    return !!d && typeof d === 'object' && typeof d.step === 'number' && typeof d.expected_editable === 'boolean' &&
      !!d.confirmed && typeof d.confirmed === 'object' && typeof d.confirmed.state === 'string';
  }

  // The deliveries block of dispatch_materials, or null when it is missing or
  // any row is not whole: the section then shows its failed line, never a short
  // or empty table.
  function deliveriesFrom(v) {
    if (!v || typeof v !== 'object' || !Array.isArray(v.rows) || typeof v.counted !== 'number' || typeof v.sighted !== 'number') return null;
    var ok = v.rows.every(function (r) {
      if (!r || typeof r !== 'object') return false;
      if (r.kind === 'not_ordered') return !!r.supplier_id;
      return r.kind === 'order' && !!r.purchase_order_id && delivOk(r.delivery);
    });
    return ok ? { rows: v.rows.slice(), counted: v.counted, sighted: v.sighted, all_sighted: v.all_sighted === true } : null;
  }

  // A date box's value worth saving: a whole YYYY-MM-DD in a four-figure year,
  // so a year still being typed (0002, 0020, 0202) is never sent.
  function wholeDay(v) {
    var p = parseDay(v);
    return p && p.y >= 2000 && p.y <= 2099 && /^\d{4}-\d{2}-\d{2}$/.test(text(v)) ? text(v) : '';
  }

  // ── slice 7: the install row's rules ──

  // Why a stop 6 job is in To do (the read's dispatch_install_open).
  var INSTALL_OPEN = {
    not_confirmed: 'In To do until the install is confirmed.',
    moved: 'In To do: the install booking moved after it was confirmed.',
    booked_after: 'In To do: the install was booked after it was confirmed.'
  };

  // The list row's install block as the server works it out
  // (dispatch_install.ts), or null when it is missing or not whole.
  function installOf(row) {
    var d = row && row.dispatch_install;
    if (!d || typeof d !== 'object' || ['ahead', 'past', 'none'].indexOf(d.state) < 0 || !Array.isArray(d.people) || !Array.isArray(d.also_days) ||
      typeof d.calendar_confirmed !== 'boolean' || typeof d.confirmed_current !== 'boolean') return null;
    if (d.state !== 'none' && !parseDay(d.day)) return null;
    if (d.confirmed !== null && (!d.confirmed || typeof d.confirmed !== 'object' || !parseStamp(d.confirmed.at))) return null;
    return d;
  }

  // The Trade booked cell: "Tue 20/10, names", "Tue 20/10 to Thu 22/10,
  // names", "Last booked 4/9, names"; '' when nothing is booked.
  function bookedText(d) {
    var names = d.people.map(function (p) { return text(p && p.name) || 'Name not on record'; }).join(', ');
    var tail = names ? ', ' + names : '';
    if (d.state === 'ahead') {
      var end = parseDay(d.end_day);
      return dayText(parseDay(d.day)) + (end && text(d.end_day) !== text(d.day) ? ' to ' + dayText(end) : '') + tail;
    }
    if (d.state === 'past') return 'Last booked ' + dayMonth(parseDay(d.day)) + tail;
    return '';
  }

  // The rail panel's sightings line (build note section 4.4), from the list
  // row's two counts; '' when the job has no counted order or the counts did
  // not come.
  function deliveriesRailLine(row, s) {
    var total = row && row.deliveries_orders_total, seen = row && row.deliveries_orders_sighted;
    if (typeof total !== 'number' || typeof seen !== 'number' || !(total > 0)) return '';
    if (seen < total) return seen + ' of ' + total + ' orders sighted on site.';
    return s && (s.index === 5 || s.index === 6)
      ? 'Every order on this job is sighted on site.'
      : 'Every order on this job is sighted on site. Press Materials on site to move the job.';
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
    base: { status: 'idle', rows: [], total: null, degraded: false, stages: null, todo: null, todoTotal: null },
    found: { status: 'idle', rows: [], degraded: false, q: '', stages: null, todo: null },
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
    },
    // Slice 5, orders and Emails. jobs[jobId] holds that job's
    // dispatch_order_emails read, the open item, typed text not yet saved and
    // each press's state. note is the strip under a card after a create or
    // update, and goes when another job is opened.
    mail: {
      open: readStore('localStorage', LS_MAIL) !== '0',
      jobs: {},
      note: null,
      pdf: {}
    },
    // Slice 6, Deliveries. The rows live in the job's materials read (mat.jobs);
    // here is only what a person is doing: the press in flight per order, the
    // one open inline line (a confirmed date, from the row or a thread), the
    // open "Not sighted" confirm, the last line under the table, and what is
    // typed in an expected date box per order until it is saved.
    deliv: {
      open: readStore('localStorage', LS_SCHED) !== '0',
      busy: {},
      typed: {},
      edit: null,
      ask: null,
      msg: null
    },
    // Slice 7, the install row: the job whose press is in flight, the open
    // confirm line ({ jobId, kind: 'none' | 'clear' }) and the line under the table.
    install: { busy: null, ask: null, msg: null }
  };
  var tokens = { base: 0, found: 0, fill: 0 };
  var searchTimer = null;
  var photoUrls = [];

  function root() { return document.getElementById(ROOT_ID); }
  function region(name) { var r = root(); return r ? r.querySelector('[data-dpc-region="' + name + '"]') : null; }
  function searching() { return state.search.trim() !== ''; }

  // To do keeps the rows the read marks dispatch_todo, and none at all when
  // the stage read failed: that shows the failed line, never an empty To do.
  // To do is drawn only from an answer whose stage read worked and whose
  // todo_total matches its To do rows.
  function todoOk(from) { return from.stages === 'ok' && from.todo === 'ok'; }

  function listedRows() {
    var from = searching() ? state.found : state.base;
    var rows = from.rows;
    if (state.mode === 'todo') {
      rows = todoOk(from) ? rows.filter(function (r) { return r.dispatch_todo === true && typeKey(r) !== 'makesafe'; }) : [];
    }
    return filterByType(rows, state.type);
  }

  // The list that is showing has its rows, or failed (a failed stage read
  // fails To do).
  function listFailed() {
    var from = searching() ? state.found : state.base;
    if (from.status === 'error') return true;
    return state.mode === 'todo' && from.status === 'ok' && !todoOk(from);
  }

  // ───────────────────────── reads ─────────────────────────

  function loadBase() {
    var token = ++tokens.base;
    if (state.base.status !== 'ok') { state.base.status = 'loading'; paintList(); paintWorkspace(); }
    return Promise.resolve().then(function () { return global.opsFetch('pipeline', { dispatch: 1 }); }).then(function (resp) {
      if (token !== tokens.base) return;
      var got = rowsFromPipeline(resp);
      state.base = { status: 'ok', rows: got.rows, total: got.total, degraded: got.degraded, stages: got.stages, todo: got.todo, todoTotal: got.todoTotal };
      adoptSelection();
    }).catch(function () {
      if (token !== tokens.base) return;
      state.base = { status: 'error', rows: [], total: null, degraded: false, stages: null, todo: null, todoTotal: null };
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
    if (state.jobId && state.row) { paintHead(); paintCouncil(); paintSched(); return; }
    var todo = state.mode === 'todo' && todoOk(state.base) ? rows.filter(function (r) { return r.dispatch_todo === true; }) : [];
    var pick = byId(readStore('sessionStorage', SS_JOB)) || todo[0] || rows[0] || null;
    if (pick) selectJob(pick); else { paintWorkspace(); paintContext(); }
  }

  function runSearch() {
    var q = state.search.trim();
    var token = ++tokens.found;
    if (!q) { state.found = { status: 'idle', rows: [], degraded: false, q: '', stages: null, todo: null }; paintList(); return; }
    state.found = { status: 'loading', rows: [], degraded: false, q: q, stages: null, todo: null };
    paintList();
    Promise.resolve().then(function () { return global.opsFetch('pipeline', { dispatch: 1, search: q }); }).then(function (resp) {
      if (token !== tokens.found) return;
      var got = rowsFromPipeline(resp);
      state.found = { status: 'ok', rows: got.rows, degraded: got.degraded, q: q, stages: got.stages, todo: got.todo };
      paintList();
    }).catch(function () {
      if (token !== tokens.found) return;
      state.found = { status: 'error', rows: [], degraded: false, q: q, stages: null, todo: null };
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
    if (!same) closeMailPresses();
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
    loadMail(row);
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
      suppliers: [], lines: [], counts: null, canSuggest: false, orders: [], ordersOk: true, deliveries: null,
      w: {
        loaded: false, text: '', textSaved: '', textStamp: null, textBusy: false, textAgain: false, textFailed: false, timer: null,
        sketch: null, sketchSaved: null, sketchStamp: null, sketchBusy: false, sketchAgain: false, sketchFailed: false,
        sketchMsg: '', sketchBroken: false, clearWanted: false
      },
      adding: null, addMsg: null, card: {}, busyCard: {}, notice: '', touched: false,
      // Slice 5: an order press in flight per supplier, its failed line, and the open Cancel order confirm.
      orderBusy: {}, orderMsg: {}, cancelAsk: null
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
    e.deliveries = got.deliveries;
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
    if (state.jobId === jobId) { paintMat(); paintHead(); paintSources(); paintSched(); }
    return Promise.resolve().then(function () { return global.opsFetch('dispatch_materials', { job_id: jobId }); }).then(function (resp) {
      if (token !== e.token) return;
      mergeMat(e, materialsFrom(resp), quiet);
      e.status = 'ok';
      if (state.jobId === jobId) { paintMat(); paintHead(); paintSources(); paintSched(); paintMail(); }
    }).catch(function () {
      if (token !== e.token) return;
      e.status = 'error';
      if (state.jobId === jobId) { paintMat(); paintHead(); paintSources(); paintSched(); paintMail(); }
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
      e.card[supplierId] = err && err.code === 'supplier_has_orders'
        ? { text: 'Supplier not removed: it has an order on this job.', retry: null }
        : { text: 'Supplier not removed.', retry: 'remove' };
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

  // ── slice 5: purchase orders and Emails, two reads and nine writes ──
  // dispatch_order_emails is read once per job open, on Retry, and once after
  // each slice 5 write; dispatch_order_pdf only on a press. Every write is sent
  // once, on a person's press or on leaving a draft box. Nothing here retries,
  // and nothing sends, on its own.

  function supById(e, sid) {
    if (!e) return null;
    for (var i = 0; i < e.suppliers.length; i++) if (String(e.suppliers[i].supplier_id) === sid) return e.suppliers[i];
    return null;
  }

  // The supplier's open Dispatch order as the read gave it, or null. Known only
  // when the orders read worked: then every supplier carries an `order` key.
  function orderKnown(e, s) { return !!(e && e.ordersOk && s && Object.prototype.hasOwnProperty.call(s, 'order')); }
  function supOrder(e, s) { return orderKnown(e, s) && s.order && typeof s.order === 'object' && s.order.id ? s.order : null; }
  // The order a card can change: its open Dispatch order, while Xero does not hold it.
  function changeableOrder(e, s) { var o = supOrder(e, s); return o && !o.in_xero && o.status !== 'cancelled' ? o : null; }
  function orderStamp(e, o) {
    if (o.updated_at) return o.updated_at;
    for (var i = 0; i < e.orders.length; i++) if (e.orders[i] && e.orders[i].id === o.id && e.orders[i].updated_at) return e.orders[i].updated_at;
    return null;
  }

  // The card's lines that go on its order: To order as stored and on no order,
  // each as the server last gave it (build note section 4.1).
  function orderableLines(e, sid) {
    return e.lines.filter(function (l) {
      return l.supplier_id === sid && l.saved && l.saved.supplier_id === sid && l.saved.status === 'to_order' && !l.purchase_order_id && !l.gone;
    }).map(function (l) { return { id: l.id, updated_at: l.updated_at }; });
  }

  function cardSaving(e, sid) { return e.lines.some(function (l) { return (l.supplier_id === sid || (l.saved && l.saved.supplier_id === sid)) && l.busy; }); }

  function mailEntry(jobId) { return (jobId && state.mail.jobs[jobId]) || null; }

  function newMail(jobId) {
    return {
      jobId: jobId, status: 'loading', token: 0, drafts: [], threads: [], threadsOk: true, ordersForLink: [],
      sel: null, edits: {}, ask: null, busy: {}, msg: {}, replies: {}, link: {}, notice: '', released: {}
    };
  }

  // dispatch_order_emails' answer. Throws on anything else, so the section
  // shows its failed line and never "No email on this job yet."
  function mailFrom(resp) {
    if (!resp || typeof resp !== 'object' || !Array.isArray(resp.drafts) ||
      (resp.threads_status !== 'ok' && resp.threads_status !== 'failed') ||
      (resp.threads_status === 'ok' && !Array.isArray(resp.threads))) {
      throw new Error('Unexpected email answer');
    }
    var ok = resp.threads_status === 'ok';
    return {
      drafts: resp.drafts.filter(function (d) { return d && d.id; }),
      threads: ok ? resp.threads.filter(function (t) { return t && t.key && Array.isArray(t.messages); }) : [],
      threadsOk: ok,
      ordersForLink: Array.isArray(resp.orders_for_link) ? resp.orders_for_link.filter(function (o) { return o && o.id; }) : [],
      otherOrders: otherOrdersFrom(resp)
    };
  }

  // The job's open orders made outside Dispatch (the office's Create PO, the
  // quote builder, Xero), so nobody orders the same materials twice. ops-api
  // sends a one-line note, or status failed when it could not check. A reply
  // without the fields (an older ops-api) shows nothing. It never blocks a
  // press.
  var OTHER_ORDERS_FAILED = 'Could not check this job\'s other orders. Look at its purchase orders before you order or send.';
  function otherOrdersFrom(resp) {
    var st = resp.other_open_orders_status;
    if (st === 'failed') return { text: OTHER_ORDERS_FAILED, failed: true };
    if (st === 'ok' && typeof resp.other_open_orders_note === 'string' && resp.other_open_orders_note.trim()) {
      return { text: resp.other_open_orders_note.trim(), failed: false };
    }
    return null;
  }

  function otherOrdersLine(jobId) {
    var m = mailEntry(jobId);
    // A failed email read has no answer about other orders either: say so.
    var o = !m ? null : m.status === 'error' ? { text: OTHER_ORDERS_FAILED, failed: true } : m.status === 'ok' ? m.otherOrders : null;
    if (!o) return '';
    return '<div class="dpc-mat-notice dpc-other-orders' + (o.failed ? ' dpc-mat-fail' : '') + '" role="status">' + esc(o.text) + '</div>';
  }

  function mailKeys(m) {
    return m.drafts.map(function (d) { return 'd:' + d.id; }).concat(m.threads.map(function (t) { return 't:' + t.key; }));
  }

  function mergeMail(m, got) {
    m.drafts = got.drafts;
    m.threads = got.threads;
    m.threadsOk = got.threadsOk;
    m.ordersForLink = got.ordersForLink;
    m.otherOrders = got.otherOrders;
    var keys = mailKeys(m);
    if (keys.indexOf(m.sel) < 0) { m.sel = keys[0] || null; m.ask = null; }
    // Typed text is kept only while it differs from what is stored.
    Object.keys(m.edits).forEach(function (id) {
      var d = draftById(m, id);
      var ed = m.edits[id];
      if (!d || d.status !== 'draft') { delete m.edits[id]; return; }
      if (ed.saving) return;
      if (ed.subject === d.subject) delete ed.subject;
      if (ed.body === d.body_text) delete ed.body;
    });
  }

  function loadMail(row) {
    if (!row || !row.id || isMakesafe(row)) return;
    readMail(row.id, false);
  }

  function readMail(jobId, quiet) {
    var m = mailEntry(jobId) || (state.mail.jobs[jobId] = newMail(jobId));
    var token = ++m.token;
    if (!quiet || m.status !== 'ok') m.status = 'loading';
    paintMailIf(jobId);
    return Promise.resolve().then(function () { return global.opsFetch('dispatch_order_emails', { job_id: jobId }); }).then(function (resp) {
      if (token !== m.token) return;
      var before = m.status === 'ok' ? JSON.stringify(m.otherOrders || null) : null;
      mergeMail(m, mailFrom(resp));
      m.status = 'ok';
      paintMailIf(jobId);
      // The other-orders line also shows in Materials by supplier.
      if (JSON.stringify(m.otherOrders || null) !== before) paintMatIf(jobId);
    }).catch(function () {
      if (token !== m.token) return;
      m.status = 'error';
      paintMailIf(jobId);
      paintMatIf(jobId);
    });
  }

  // Opening another job closes every confirm line and the notice strip.
  function closeMailPresses() {
    state.mail.note = null;
    Object.keys(state.mail.jobs).forEach(function (id) { state.mail.jobs[id].ask = null; });
    Object.keys(state.mat.jobs).forEach(function (id) { state.mat.jobs[id].cancelAsk = null; });
    // Slice 6: the open inline line, the Not sighted confirm and the last line under the table.
    state.deliv.edit = null;
    state.deliv.ask = null;
    state.deliv.msg = null;
    state.deliv.typed = {};
    // Slice 7: the install row's confirm line and its last line.
    state.install.ask = null;
    state.install.msg = null;
  }

  function mailPick(jobId, key) {
    var m = mailEntry(jobId) || (state.mail.jobs[jobId] = newMail(jobId));
    m.sel = key;
    m.ask = null;
  }

  // After every order or email write: both reads once each.
  function afterOrderWrite(jobId, resp) {
    if (resp) applyCounts(jobId, resp.counts);
    readMat(jobId, true);
    readMail(jobId, true);
  }

  function setSupOrder(e, sid, order) {
    var s = supById(e, sid);
    if (s && orderKnown(e, s)) s.order = order && order.id ? order : null;
  }

  // The strip under a card after a create or an update (row 6).
  function orderNote(jobId, sid, resp, verb) {
    var e = matEntry(jobId);
    var po = text(resp.order && resp.order.po_number) || 'The PO';
    var to = resp.draft && resp.draft.to;
    var canSend = !resp.draft || (to && to.state === 'ok');
    state.mail.note = {
      jobId: jobId, sid: sid,
      text: po + ' ' + verb + ' for ' + supplierName(e, sid) + '. ' + (canSend
        ? 'Its email and PO PDF are waiting in Emails below for you to check and send.'
        : 'There is no usable email on file for this supplier, so it cannot be sent yet.')
    };
  }

  // A refused order write. "Changed somewhere else" answers re-read both
  // reads once; the rest say what happened under the card.
  var ORDER_CHANGED = ['lines_changed', 'order_changed', 'order_open', 'no_lines_to_order', 'order_cancelled', 'order_in_xero',
    'order_sent', 'supplier_not_on_job', 'not_dispatch_order', 'order_not_found'];
  function orderRefused(jobId, key, err, fail) {
    var e = matEntry(jobId);
    var code = err && err.code;
    if (ORDER_CHANGED.indexOf(code) >= 0) { matChanged(jobId); readMail(jobId, true); return; }
    if (code === 'not_dispatch_work') e.orderMsg[key] = { text: 'This job is not ordered through Dispatch.', retry: null };
    else if (code === 'draft_sending') {
      e.orderMsg[key] = { text: "This order's email is being sent or its send was not confirmed. Settle it in Emails below first.", retry: null };
      readMail(jobId, true);
    } else if (code === 'order_would_be_empty') e.orderMsg[key] = { text: 'Every line would come off. Cancel the order instead, if it was never sent.', retry: null };
    else e.orderMsg[key] = fail;
    paintMatIf(jobId);
  }

  function createOrder(jobId, sid) {
    var e = matEntry(jobId);
    var s = supById(e, sid);
    if (!s || e.status !== 'ok' || e.orderBusy[sid] || changeableOrder(e, s) || !orderKnown(e, s)) return;
    var lines = orderableLines(e, sid);
    if (!lines.length) return;
    e.orderBusy[sid] = 'create';
    e.orderMsg[sid] = null;
    e.notice = '';
    state.mail.note = null;
    paintMatIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_order_create', { job_id: jobId, supplier_id: sid, lines: lines });
    }).then(writeOk).then(function (resp) {
      delete e.orderBusy[sid];
      setSupOrder(e, sid, resp.order);
      orderNote(jobId, sid, resp, 'created');
      if (resp.draft && resp.draft.id) mailPick(jobId, 'd:' + resp.draft.id);
      afterOrderWrite(jobId, resp);
      paintMatIf(jobId);
    }, function (err) {
      delete e.orderBusy[sid];
      orderRefused(jobId, sid, err, { text: 'PO not made.', retry: 'create' });
    });
  }

  // Update PO and email, and a locked line's Take off (removeId).
  function updateOrder(jobId, sid, removeId) {
    var e = matEntry(jobId);
    var s = supById(e, sid);
    var o = s && changeableOrder(e, s);
    if (!o || e.orderBusy[sid]) return;
    var lines = orderableLines(e, sid);
    if (!removeId && !lines.length) return;
    var key = removeId ? 'line:' + removeId : sid;
    e.orderBusy[sid] = removeId ? 'takeoff' : 'update';
    e.orderMsg[key] = null;
    e.notice = '';
    state.mail.note = null;
    paintMatIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_order_update', {
        job_id: jobId, purchase_order_id: o.id, expected_order_updated_at: orderStamp(e, o),
        lines: lines, remove_line_ids: removeId ? [removeId] : []
      });
    }).then(writeOk).then(function (resp) {
      delete e.orderBusy[sid];
      if (resp.unchanged) e.orderMsg[sid] = { text: 'Nothing has changed on ' + (text(o.po_number) || 'this order') + '.', retry: null };
      else {
        setSupOrder(e, sid, resp.order);
        orderNote(jobId, sid, resp, 'updated');
        if (resp.draft && resp.draft.id) mailPick(jobId, 'd:' + resp.draft.id);
      }
      afterOrderWrite(jobId, resp);
      paintMatIf(jobId);
    }, function (err) {
      delete e.orderBusy[sid];
      orderRefused(jobId, key, err, removeId
        ? { text: 'Line not taken off.', retry: 'takeoff:' + removeId }
        : { text: 'PO not updated.', retry: 'update' });
    });
  }

  function cancelOrder(jobId, sid) {
    var e = matEntry(jobId);
    var s = supById(e, sid);
    var o = s && changeableOrder(e, s);
    if (!o || o.last_sent_at || e.orderBusy[sid]) return;
    e.cancelAsk = null;
    e.orderBusy[sid] = 'cancel';
    e.orderMsg[sid] = null;
    e.notice = '';
    state.mail.note = null;
    paintMatIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_order_cancel', { job_id: jobId, purchase_order_id: o.id, expected_order_updated_at: orderStamp(e, o) });
    }).then(writeOk).then(function (resp) {
      delete e.orderBusy[sid];
      setSupOrder(e, sid, null);
      afterOrderWrite(jobId, resp);
      paintMatIf(jobId);
    }, function (err) {
      delete e.orderBusy[sid];
      orderRefused(jobId, sid, err, { text: 'Order not cancelled.', retry: 'cancel' });
    });
  }

  // An order's PDF, through a 300 second link, opened in a new tab. The tab is
  // opened on the press so the browser does not block it, then pointed at the link.
  function openOrderPdf(poId, version, key) {
    if (!poId || state.mail.pdf[key] === 'busy') return;
    state.mail.pdf[key] = 'busy';
    paintPdfLines();
    var win = null;
    try { win = global.open('', '_blank'); if (win) win.opener = null; } catch (x) { win = null; }
    var params = { purchase_order_id: poId };
    if (version) params.version = version;
    Promise.resolve().then(function () { return global.opsFetch('dispatch_order_pdf', params); }).then(function (resp) {
      var url = safeUrl(resp && resp.url);
      if (!url) throw new Error('Unexpected PDF answer');
      delete state.mail.pdf[key];
      if (win && !win.closed) win.location.href = url; else global.open(url, '_blank', 'noopener');
      paintPdfLines();
    }).catch(function () {
      if (win) { try { win.close(); } catch (x) { /* already gone */ } }
      state.mail.pdf[key] = 'failed';
      paintPdfLines();
    });
  }

  function draftById(m, id) {
    for (var i = 0; i < m.drafts.length; i++) if (m.drafts[i].id === id) return m.drafts[i];
    return null;
  }
  function threadByKey(m, key) {
    for (var i = 0; i < m.threads.length; i++) if (m.threads[i].key === key) return m.threads[i];
    return null;
  }

  function draftText(m, d, field) {
    var ed = m.edits[d.id];
    if (ed && typeof ed[field] === 'string') return ed[field];
    return String((field === 'subject' ? d.subject : d.body_text) || '');
  }
  function draftDirty(m, d) { return draftText(m, d, 'subject') !== String(d.subject || '') || draftText(m, d, 'body') !== String(d.body_text || ''); }

  // Why Send is off, or '' when it can be pressed (row 24).
  function sendBlock(m, d) {
    var ed = m.edits[d.id] || {};
    if (d.status !== 'draft') return 'status';
    if (!d.to || d.to.state !== 'ok') return 'address';
    if (ed.saving || ed.failed || draftDirty(m, d)) return 'save';
    if (!draftText(m, d, 'subject').trim() || !draftText(m, d, 'body').trim()) return 'empty';
    if (m.busy['send:' + d.id]) return 'busy';
    return '';
  }

  // Subject and message are saved when their box is left, once, with the
  // latest text if typing went on while a save was out.
  function saveDraft(jobId, id) {
    var m = mailEntry(jobId);
    var d = m && draftById(m, id);
    if (!d || d.status !== 'draft') return;
    var ed = m.edits[id] || (m.edits[id] = {});
    if (ed.saving) { ed.again = true; return; }
    if (!draftDirty(m, d)) { if (ed.failed) { ed.failed = false; paintMailIf(jobId); } return; }
    var subject = draftText(m, d, 'subject');
    var body = draftText(m, d, 'body');
    if (!subject.trim() || !body.trim()) { paintSendState(jobId); return; }
    var out = { draft_id: id, expected_updated_at: d.updated_at };
    if (subject !== d.subject) out.subject = subject;
    if (body !== d.body_text) out.body_text = body;
    ed.saving = true;
    ed.failed = false;
    m.ask = null;
    paintMailIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_order_draft_save', out);
    }).then(writeOk).then(function (resp) {
      if (!resp.draft || resp.draft.id !== id) throw new Error('Unexpected answer');
      return resp;
    }).then(function (resp) {
      ed.saving = false;
      m.drafts = m.drafts.map(function (x) { return x.id === id ? resp.draft : x; });
      // Text still as sent takes the stored form of it.
      if (ed.subject === subject) delete ed.subject;
      if (ed.body === body) delete ed.body;
      var again = ed.again;
      ed.again = false;
      if (again && draftDirty(m, resp.draft)) saveDraft(jobId, id); else paintMailIf(jobId);
    }, function (err) {
      ed.saving = false;
      ed.again = false;
      var code = err && err.code;
      if (code === 'draft_changed' || code === 'draft_not_editable') {
        delete m.edits[id];
        m.notice = 'This draft changed. Showing the latest.';
        readMail(jobId, true);
      } else ed.failed = true;
      paintMailIf(jobId);
    });
  }

  // The one route to a supplier email: the draft's Send now press, or Try the
  // send again after a send whose result was not confirmed. It sends exactly
  // the version on screen; the server refuses it if its hash has moved.
  function sendDraft(jobId, id, retry) {
    var m = mailEntry(jobId);
    var d = m && draftById(m, id);
    if (!d || m.busy['send:' + id]) return;
    if (retry ? d.status !== 'send_unknown' : sendBlock(m, d)) return;
    m.busy['send:' + id] = true;
    m.msg['send:' + id] = null;
    m.ask = null;
    paintMailIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_order_send', { draft_id: id, expected_draft_hash: d.draft_hash });
    }).then(writeOk).then(function (resp) {
      delete m.busy['send:' + id];
      m.notice = resp.filed === false ? 'Sent. It went to the supplier, but filing it on the order did not finish; it may not show below.' : '';
      // The draft leaves the list; its thread comes in with the re-read.
      m.drafts = m.drafts.filter(function (x) { return x.id !== id; });
      m.sel = null;
      afterOrderWrite(jobId, null);
      paintMailIf(jobId);
    }, function (err) {
      delete m.busy['send:' + id];
      var code = err && err.code;
      if (code === 'send_unknown') m.msg['send:' + id] = { text: 'We could not tell whether this email went. Check the thread before trying again.', unknown: true };
      else if (code === 'send_refused') m.msg['send:' + id] = { text: (text(err.message) || 'Not sent.').replace(/\.?$/, '.') };
      else if (code === 'draft_changed' || code === 'draft_not_sendable' || code === 'order_cancelled' || code === 'pdf_changed') {
        m.notice = 'This draft changed. Showing the latest.';
      } else if (code === 'supplier_email_missing' || code === 'supplier_email_not_supplier' || code === 'supplier_email_malformed') {
        m.notice = 'The supplier\'s email on file changed. Showing the latest.';
      } else m.msg['send:' + id] = { text: 'Not sent. Nothing went to the supplier.' };
      // The card's chip reads the draft's state too.
      if (code === 'send_unknown') readMat(jobId, true);
      readMail(jobId, true);
      paintMailIf(jobId);
    });
  }

  // A send whose result was not confirmed stays locked until a person, having
  // checked the thread and the supplier's mailbox, says it did not go.
  function releaseDraft(jobId, id) {
    var m = mailEntry(jobId);
    var d = m && draftById(m, id);
    if (!d || m.busy['release:' + id]) return;
    m.busy['release:' + id] = true;
    m.msg['release:' + id] = null;
    m.ask = null;
    paintMailIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_order_release_unknown', { draft_id: id, expected_updated_at: d.updated_at });
    }).then(writeOk).then(function (resp) {
      delete m.busy['release:' + id];
      m.msg['send:' + id] = null;
      // When it was released: the release answer's stamp (the server keeps who).
      m.released[id] = (resp.draft && resp.draft.updated_at) || new Date().toISOString();
      afterOrderWrite(jobId, null);
    }, function (err) {
      delete m.busy['release:' + id];
      var code = err && err.code;
      if (code === 'draft_changed' || code === 'draft_not_unknown') { m.notice = 'This draft changed. Showing the latest.'; readMail(jobId, true); }
      else m.msg['release:' + id] = { text: 'Draft not unlocked.' };
      paintMailIf(jobId);
    });
  }

  function discardDraft(jobId, id) {
    var m = mailEntry(jobId);
    var d = m && draftById(m, id);
    if (!d || d.status !== 'draft' || m.busy['discard:' + id]) return;
    m.busy['discard:' + id] = true;
    m.msg['discard:' + id] = null;
    m.ask = null;
    paintMailIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_order_discard', { draft_id: id, expected_updated_at: d.updated_at });
    }).then(writeOk).then(function () {
      delete m.busy['discard:' + id];
      m.drafts = m.drafts.filter(function (x) { return x.id !== id; });
      delete m.edits[id];
      m.sel = null;
      afterOrderWrite(jobId, null);
      paintMailIf(jobId);
    }, function (err) {
      delete m.busy['discard:' + id];
      var code = err && err.code;
      if (code === 'draft_changed' || code === 'draft_not_editable') { m.notice = 'This draft changed. Showing the latest.'; readMail(jobId, true); }
      else m.msg['discard:' + id] = { text: 'Draft not discarded.', retry: true };
      paintMailIf(jobId);
    });
  }

  // The newest inbound sender on a supplier thread: who a reply goes to.
  function replyTo(t) {
    for (var i = t.messages.length - 1; i >= 0; i--) if (t.messages[i] && t.messages[i].direction === 'inbound') return text(t.messages[i].from_email);
    return '';
  }

  function newestMessageId(t) { var last = t.messages[t.messages.length - 1]; return last ? last.id : null; }

  // The thread's Send now press (or Try the send again after an unconfirmed
  // reply). The address is the supplier's own, never typed.
  function sendThreadReply(jobId, key, retry) {
    var m = mailEntry(jobId);
    var t = m && threadByKey(m, key);
    var held = m && m.msg['reply:' + key];
    if (!t || !t.can_reply || m.busy['reply:' + key]) return;
    if (retry ? !(held && held.unknown) : held && held.unknown) return;
    var attempt = retry ? held.attempt : { reply_to_message_id: newestMessageId(t), body_text: String(m.replies[key] || '') };
    if (!attempt.body_text.trim()) return;
    m.busy['reply:' + key] = true;
    m.msg['reply:' + key] = null;
    m.ask = null;
    paintMailIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_order_reply', { job_id: jobId, thread_key: key, reply_to_message_id: attempt.reply_to_message_id, body_text: attempt.body_text });
    }).then(writeOk).then(function () {
      delete m.busy['reply:' + key];
      m.replies[key] = '';
      afterOrderWrite(jobId, null);
      paintMailIf(jobId);
    }, function (err) {
      delete m.busy['reply:' + key];
      var code = err && err.code;
      var lost = !code && !(err && err.status >= 400 && err.status < 500);
      if (code === 'send_unknown' || lost) m.msg['reply:' + key] = { text: 'We could not tell whether this reply went. Check the thread before trying again.', unknown: true, attempt: attempt };
      else if (code === 'thread_changed' && retry) {
        m.replies[key] = attempt.body_text;
        m.msg['reply:' + key] = { text: 'This thread changed. Check it for your reply before sending again.' };
        readMail(jobId, true);
      } else if (code === 'thread_changed') { m.notice = 'This thread changed. Showing the latest. Your text is still here.'; readMail(jobId, true); }
      else m.msg['reply:' + key] = { text: 'Reply not sent. Your text is still here.' };
      paintMailIf(jobId);
    });
  }

  function linkThread(jobId, key) {
    var m = mailEntry(jobId);
    var t = m && threadByKey(m, key);
    var poId = m && m.link[key];
    if (!t || !t.can_link || !poId || m.busy['link:' + key]) return;
    m.busy['link:' + key] = true;
    m.msg['link:' + key] = null;
    paintMailIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_email_link_po', { job_id: jobId, thread_key: key, purchase_order_id: poId });
    }).then(writeOk).then(function () {
      delete m.busy['link:' + key];
      afterOrderWrite(jobId, null);
    }, function (err) {
      delete m.busy['link:' + key];
      var code = err && err.code;
      if (code === 'thread_has_order' || code === 'order_not_on_job' || code === 'thread_not_found') { m.notice = 'This changed somewhere else. Showing the latest.'; readMail(jobId, true); }
      else m.msg['link:' + key] = { text: 'Not linked.', retry: true };
      paintMailIf(jobId);
    });
  }

  // ── slice 6: Deliveries, its three writes ──
  // Each is sent once, on a person's change or press, against the order's
  // updated_at the screen was showing. Its answer redraws the row, items ready,
  // the open job's list counts and the rail line: no list re-read, and nothing
  // here retries on its own.

  function delivRow(e, poId) {
    var rows = e && e.deliveries ? e.deliveries.rows : [];
    for (var i = 0; i < rows.length; i++) if (rows[i].kind === 'order' && rows[i].purchase_order_id === poId) return rows[i];
    return null;
  }

  // An order as a write (or its order_changed refusal) answered it, onto the
  // row, the job's orders and the lines on it. A line on an order that has been
  // sighted reads Delivered, else On PO: the server's rule, kept until the next read.
  function applyDelivOrder(e, poId, o) {
    if (!e || !o || typeof o !== 'object' || o.id !== poId || !delivOk(o.delivery)) return false;
    e.orders = e.orders.map(function (x) {
      if (!x || x.id !== poId) return x;
      var merged = Object.assign({}, x, o);
      if (!Array.isArray(o.lines)) merged.lines = x.lines;
      return merged;
    });
    var r = delivRow(e, poId);
    if (r) {
      r.updated_at = o.updated_at;
      r.delivery = o.delivery;
      if ('status' in o) r.status = o.status;
      if ('in_xero' in o) r.in_xero = o.in_xero === true;
    }
    e.lines.forEach(function (l) {
      if (l.purchase_order_id === poId && (l.display_status === 'on_po' || l.display_status === 'delivered')) l.display_status = o.delivery.sighted ? 'delivered' : 'on_po';
    });
    return true;
  }

  // The answer's counted and sighted, onto the section and onto every copy of
  // the job's list row that carries the counts (the rail line reads them).
  function applyDelivCounts(jobId, c) {
    var e = matEntry(jobId);
    if (!e || !e.deliveries || !c || typeof c.counted !== 'number' || typeof c.sighted !== 'number') return;
    e.deliveries.counted = c.counted;
    e.deliveries.sighted = c.sighted;
    e.deliveries.all_sighted = c.all_sighted === true;
    [state.base.rows, state.found.rows, state.row ? [state.row] : []].forEach(function (rows) {
      rows.forEach(function (r) {
        if (r && r.id === jobId && typeof r.deliveries_orders_total === 'number') { r.deliveries_orders_total = c.counted; r.deliveries_orders_sighted = c.sighted; }
      });
    });
  }

  // The order changed somewhere else, or cannot be changed here: say so, and
  // show the latest by one quiet re-read.
  function delivChanged(jobId, words) {
    var e = matEntry(jobId);
    state.deliv.msg = { jobId: jobId, text: words };
    state.deliv.edit = null;
    state.deliv.ask = null;
    paintSchedIf(jobId);
    paintMailIf(jobId);
    if (!e || e.rereading) return;
    e.rereading = true;
    readMat(jobId, true).then(function () { e.rereading = false; });
  }

  var DELIV_REFUSED = ['order_in_xero', 'order_cancelled', 'not_material', 'not_dispatch_work', 'order_not_found'];

  // One delivery write. onFail says what a failed press leaves on screen.
  // Resolves true when it landed.
  function delivSend(jobId, poId, action, body, onFail) {
    var e = matEntry(jobId);
    var r = delivRow(e, poId);
    var d = state.deliv;
    if (!r || d.busy[poId]) return Promise.resolve(false);
    d.busy[poId] = action;
    d.msg = null;
    paintSchedIf(jobId);
    paintMailIf(jobId);
    return Promise.resolve().then(function () {
      return global.opsPost(action, Object.assign({ purchase_order_id: poId, expected_updated_at: r.updated_at || null }, body));
    }).then(writeOk).then(function (resp) {
      delete d.busy[poId];
      // Saved, but an answer without the order cannot redraw the row: one quiet re-read shows it.
      if (!applyDelivOrder(e, poId, resp.order)) readMat(jobId, true);
      applyDelivCounts(jobId, resp.deliveries);
      applyCounts(jobId, resp.counts);
      if (state.jobId === jobId) { paintMat(); paintHead(); paintSources(); }
      paintCard(jobId);
      return true;
    }, function (err) {
      delete d.busy[poId];
      var code = err && err.code;
      if (code === 'order_changed') {
        if (err.body) applyDelivOrder(e, poId, err.body.order);
        delivChanged(jobId, 'This order changed somewhere else. Showing the latest.');
      } else if (DELIV_REFUSED.indexOf(code) >= 0) {
        delivChanged(jobId, 'This order cannot be changed here.');
      } else {
        onFail();
      }
      return false;
    }).then(function (landed) {
      paintSchedIf(jobId);
      paintMailIf(jobId);
      return landed;
    });
  }

  function setExpected(jobId, poId, value) {
    var r = delivRow(matEntry(jobId), poId);
    if (!r || !r.delivery.expected_editable || (r.delivery.expected || null) === value) {
      delete state.deliv.typed[poId];
      return;
    }
    delivSend(jobId, poId, 'dispatch_delivery_set_expected', { delivery_date: value }, function () {
      state.deliv.msg = { jobId: jobId, text: 'Not saved.', retry: { kind: 'expected', poId: poId, value: value } };
    }).then(function () {
      delete state.deliv.typed[poId];
      paintSchedIf(jobId);
    });
  }

  function markSighted(jobId, poId, sighted) {
    state.deliv.ask = null;
    delivSend(jobId, poId, 'dispatch_delivery_mark_sighted', { sighted: sighted }, function () {
      state.deliv.msg = { jobId: jobId, text: sighted ? 'Not saved.' : 'Sighting not cleared.', retry: { kind: 'sight', poId: poId, value: sighted } };
    });
  }

  // The open inline line's Save (a date) or Clear (null). The line stays open
  // with its date when the press fails.
  function saveConfirmed(value) {
    var ed = state.deliv.edit;
    if (!ed || ed.busy || (value !== null && !wholeDay(value))) return;
    ed.busy = true;
    ed.fail = false;
    ed.last = value;
    delivSend(ed.jobId, ed.poId, 'dispatch_delivery_set_confirmed', { confirmed_delivery_date: value, via: ed.via }, function () {
      ed.fail = true;
    }).then(function (landed) {
      ed.busy = false;
      if (landed && state.deliv.edit === ed) state.deliv.edit = null;
      paintSchedIf(ed.jobId);
      paintMailIf(ed.jobId);
    });
  }

  // Opens the one inline line: from the row (via deliveries) or a supplier
  // thread (via thread). Nothing is sent until Save or Clear.
  function openConfirmedLine(jobId, poId, via, key) {
    var r = delivRow(matEntry(jobId), poId);
    if (!r) return;
    var c = r.delivery.confirmed;
    var day = via === 'thread' ? (c.date || r.delivery.expected) : (c.by_hand ? c.date : r.delivery.expected);
    state.deliv.edit = { jobId: jobId, poId: poId, via: via, key: key || null, date: wholeDay(day), busy: false, fail: false, last: null };
    state.deliv.ask = null;
    state.deliv.msg = null;
  }

  // ── slice 7: Mark confirmed, its one write ──
  // Sent once per press, against the install day and mark the screen showed.
  // Its answer redraws the row, the open job's list row, To do's count, the
  // card and the rail line: no list re-read, the open job stays open, and
  // nothing here retries on its own.

  // A write's (or a refusal's) install fields onto every copy of the job's row.
  function applyInstallFields(jobId, src) {
    if (!src || typeof src !== 'object') return;
    var f = {};
    if (installOf({ dispatch_install: src.dispatch_install })) f.dispatch_install = src.dispatch_install;
    if (src.dispatch_install_open === null || INSTALL_OPEN[src.dispatch_install_open]) f.dispatch_install_open = src.dispatch_install_open;
    if (typeof src.dispatch_todo === 'boolean') f.dispatch_todo = src.dispatch_todo;
    if (src.dispatch_todo_out === null || typeof src.dispatch_todo_out === 'string') f.dispatch_todo_out = src.dispatch_todo_out;
    applyStageFields(jobId, f);
    // To do's number, counted again from the rows the list read gave.
    if (state.base.status === 'ok' && todoOk(state.base)) {
      state.base.todoTotal = state.base.rows.filter(function (r) { return r.dispatch_todo === true; }).length;
    }
    paintList(true);
    if (state.jobId === jobId) paintHead();
  }

  var INSTALL_CHANGED = ['install_changed', 'confirmation_changed'];

  function confirmInstall(jobId, confirmed) {
    var row = state.row;
    var d = row && row.id === jobId ? installOf(row) : null;
    var ins = state.install;
    if (!d || ins.busy) return;
    ins.busy = jobId;
    ins.ask = null;
    ins.msg = null;
    paintSchedIf(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('set_dispatch_install_confirmed', {
        job_id: jobId, confirmed: confirmed, expected_install_day: d.state === 'none' ? null : d.day, expected_confirmed_at: d.confirmed ? d.confirmed.at : null
      });
    }).then(writeOk).then(function (resp) {
      ins.busy = null;
      if (installOf({ dispatch_install: resp.dispatch_install })) applyInstallFields(jobId, resp);
      else loadBase(); // saved, but the answer cannot redraw the row: one list read shows it
      paintSchedIf(jobId);
    }, function (err) {
      ins.busy = null;
      if (err && INSTALL_CHANGED.indexOf(err.code) >= 0) {
        applyInstallFields(jobId, err.body);
        ins.msg = { jobId: jobId, text: 'This booking changed somewhere else. Showing the latest.' };
        paintSchedIf(jobId);
        loadBase();
        return;
      }
      ins.msg = { jobId: jobId, text: confirmed ? 'Not saved.' : 'Confirmation not cleared.', retry: confirmed };
      paintSchedIf(jobId);
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
    h += stageLineHtml(s, row);
    var ready = readyText(row.materials_lines_total, row.materials_lines_ready);
    h += '<span class="dpc-muted">' + esc((ready ? ready + ' · ' : '') + installText(row)) + '</span>';
    return h + '</button>';
  }

  // The card's stage line (build note row 7). No line for a make-safe row or
  // when the read gave no stage.
  function stageLineHtml(s, row) {
    if (!s || s.none) return '';
    // Slice 7: a stop 6 job back in To do until its install is confirmed, in the to-come look.
    if (s.index === 6 && row && row.dispatch_todo === true && INSTALL_OPEN[row.dispatch_install_open]) return '<span class="dpc-stage">Stage: Trade scheduled · install not confirmed</span>';
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
    if (!todoOk(from)) return failLine('Could not load To do.', retry);
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
    var todo = state.base.status === 'ok' && todoOk(state.base) ? ' <b>' + esc(state.base.todoTotal) + '</b>' : '';
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
    h += '<div class="dpc-foot">To do: jobs from Accepted until the trade is scheduled and the install confirmed. All jobs: any job through the Dispatch lens, to check what was ordered and sent.</div>';
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
        var failText = from.status !== 'error' ? (from.stages !== 'ok' ? 'Could not load Dispatch stages. Retry' : 'Could not load To do. Retry')
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
    var sightings = deliveriesRailLine(row, s);
    if (sightings) h += '<p class="dpc-empty dpc-empty-tight dpc-tape-note" data-dpc-deliv-rail>' + esc(sightings) + '</p>';
    if (INSTALL_OPEN[row.dispatch_install_open]) h += '<p class="dpc-empty dpc-empty-tight dpc-tape-note" data-dpc-install-rail>' + esc(INSTALL_OPEN[row.dispatch_install_open]) + '</p>';
    if (confirm) {
      var num = text(row.job_number) || 'this job';
      var to = STAGES[stageIndex(confirm.to) - 1].label;
      var ask = confirm.to === s.key ? 'Set ' + num + ' at ' + to + '?' : 'Move ' + num + ' from ' + s.name + ' to ' + to + '?';
      // Slice 7: Move still works with nothing booked; the line says so.
      var inst = installOf(row);
      if (confirm.to === 'trade_scheduled' && inst && inst.state === 'none') ask += ' No install is booked on this job.';
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

  // Sources: quotes and invoices from job_detail, then the job's purchase
  // orders from the materials read already made on job open (slice 5).
  function sourcesHtml() { return sourceDocsHtml() + poSourcesHtml(); }

  function sourceDocsHtml() {
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
      h += '<span><span class="dpc-status dpc-tone-' + tone + '">' + esc(matStatusLabel(l.display_status)) + '</span></span>' + takeOffHtml(e, l) + '</div>';
      var off = e.orderMsg['line:' + l.id];
      if (off) {
        h += '<div class="dpc-line-msg' + (off.retry ? ' dpc-mat-fail' : '') + '" role="' + (off.retry ? 'alert' : 'status') + '">' + esc(off.text) +
          (off.retry ? ' <button type="button" class="dpc-retry" data-dpc-order="retry" data-dpc-order-retry="' + esc(off.retry) + '" data-dpc-order-sid="' + esc(l.supplier_id) + '">Retry</button>' : '') + '</div>';
      }
      return h + '</div>';
    }
    var status = (MAT_STATUS[l.status] && matSettable(l.status)) ? l.status : 'not_reviewed';
    // Slice 5: off while an order press is in flight on this card.
    var off = e.orderBusy[l.supplier_id] ? ' disabled' : '';
    h += '<div class="dpc-line">';
    h += '<input type="text" data-dpc-mat-line="' + id + '" data-dpc-mat-cell="description" maxlength="300" value="' + esc(l.description) + '" aria-label="Item"' + off + '>';
    h += '<input type="text" inputmode="decimal" data-dpc-mat-line="' + id + '" data-dpc-mat-cell="quantity" value="' + esc(l.quantity) + '" aria-label="Qty"' + (matQty(l.quantity).ok ? '' : ' aria-invalid="true"') + off + '>';
    h += '<input type="text" data-dpc-mat-line="' + id + '" data-dpc-mat-cell="unit" maxlength="30" value="' + esc(l.unit) + '" aria-label="Unit"' + off + '>';
    h += '<select data-dpc-mat-move="' + id + '" aria-label="Supplier"' + off + '>';
    e.suppliers.forEach(function (s) {
      var sid = String(s.supplier_id);
      h += '<option value="' + esc(sid) + '"' + (sid === l.supplier_id ? ' selected' : '') + '>' + esc(text(s.name) || 'Name not recorded') + '</option>';
    });
    h += '</select>';
    h += '<select class="dpc-status dpc-status-pick dpc-tone-' + MAT_STATUS[status].tone + '" data-dpc-mat-status="' + id + '" aria-label="Status"' + off + '>';
    MAT_SETTABLE.forEach(function (k) { h += '<option value="' + k + '"' + (k === status ? ' selected' : '') + '>' + esc(MAT_STATUS[k].label) + '</option>'; });
    h += '</select>';
    h += '<button type="button" class="dpc-x" data-dpc-mat-del="' + id + '" aria-label="Remove line"' + off + '>&times;</button></div>';
    if (l.msg) {
      h += '<div class="dpc-line-msg dpc-mat-fail" role="alert">' + esc(l.msg) +
        (l.retry ? ' <button type="button" class="dpc-retry" data-dpc-mat-retry="line:' + id + '">Retry</button>' : '') + '</div>';
    }
    return h + '</div>';
  }

  // ── slice 5 on the supplier card: the chip, the button and the strip ──

  var TONES = ['muted', 'warn', 'info', 'ok'];

  // The chip words without the order number in front (Sources' second line).
  function chipWords(o) {
    var t = text(o && o.chip && o.chip.text);
    var po = text(o && o.po_number);
    return po && t.indexOf(po + ' · ') === 0 ? t.slice(po.length + 3) : t;
  }

  // Row 2 and section 4.2: the server's chip, else "Not ordered". No chip at
  // all when the orders read failed. Cancel order sits beside it (row 5).
  function orderChipHtml(e, s) {
    if (!orderKnown(e, s)) return '';
    var o = supOrder(e, s);
    if (!o) return '<span class="dpc-status dpc-tone-muted">Not ordered</span>';
    var chip = o.chip && typeof o.chip === 'object' ? o.chip : {};
    var tone = TONES.indexOf(chip.tone) >= 0 ? chip.tone : 'info';
    var words = text(chip.text) || (text(o.po_number) || 'Order') + ' · ' + orderStatusWord(o.status);
    var h = '<span class="dpc-status dpc-tone-' + tone + '">' + esc(words) + '</span>';
    if (changeableOrder(e, s) && !o.last_sent_at) {
      var sid = String(s.supplier_id);
      h += '<button type="button" class="dpc-textbtn" data-dpc-order="cancel" data-dpc-order-sid="' + esc(sid) + '"' + (e.orderBusy[sid] ? ' disabled' : '') + '>Cancel order</button>';
    }
    return h;
  }

  // Rows 3 and 4: Create PO and email, or Update PO and email once the
  // supplier has an open order Xero does not hold.
  function orderButtonHtml(e, s) {
    if (!orderKnown(e, s)) return '';
    var sid = String(s.supplier_id);
    var o = changeableOrder(e, s);
    var busy = e.orderBusy[sid];
    var ready = orderableLines(e, sid).length > 0;
    var off = !!busy || !!e.busyCard[sid] || cardSaving(e, sid) || !ready;
    var label = o ? (busy === 'update' ? 'Updating...' : 'Update PO and email') : (busy === 'create' ? 'Creating...' : 'Create PO and email');
    var title = ready ? '' : (o ? 'Nothing new to add' : 'Mark lines To order first');
    return '<button type="button" class="dpc-primary dpc-order-btn" data-dpc-order="' + (o ? 'update' : 'create') + '" data-dpc-order-sid="' + esc(sid) + '"' +
      (title ? ' title="' + esc(title) + '"' : '') + (off ? ' disabled' : '') + '>' + label + '</button>';
  }

  // Under the lines: the Cancel order confirm, the notice strip after a
  // create or update, and a failed press's line.
  function orderStripHtml(e, s) {
    var sid = String(s.supplier_id);
    var h = '';
    var o = changeableOrder(e, s);
    if (e.cancelAsk === sid && o && !o.last_sent_at) {
      h += '<div class="dpc-order-confirm" role="group" aria-label="Cancel order"><p class="dpc-empty dpc-empty-tight">Cancel ' + esc(text(o.po_number) || 'this order') + '? Its lines go back to To order.</p>';
      h += '<div class="dpc-actions"><button type="button" data-dpc-order="cancel-go" data-dpc-order-sid="' + esc(sid) + '">Cancel order</button>';
      h += '<button type="button" data-dpc-order="cancel-keep" data-dpc-order-sid="' + esc(sid) + '">Keep it</button></div></div>';
    }
    var n = state.mail.note;
    if (n && n.jobId === e.jobId && n.sid === sid) h += '<div class="dpc-note dpc-order-note-strip" role="status">' + esc(n.text) + '</div>';
    var msg = e.orderMsg[sid];
    if (msg) {
      h += '<div class="dpc-card-msg' + (msg.retry ? ' dpc-mat-fail' : '') + '" role="' + (msg.retry ? 'alert' : 'status') + '">' + esc(msg.text) +
        (msg.retry ? ' <button type="button" class="dpc-retry" data-dpc-order="retry" data-dpc-order-retry="' + esc(msg.retry) + '" data-dpc-order-sid="' + esc(sid) + '">Retry</button>' : '') + '</div>';
    }
    return h;
  }

  // Row 7: a line on the supplier's open order, not in Xero, comes off with Take off.
  function takeOffHtml(e, l) {
    var s = supById(e, l.supplier_id);
    var o = s && changeableOrder(e, s);
    if (!o || l.purchase_order_id !== o.id) return '<span></span>';
    return '<button type="button" class="dpc-takeoff" data-dpc-order="takeoff" data-dpc-order-sid="' + esc(l.supplier_id) + '" data-dpc-order-line="' + esc(l.id) + '"' +
      (e.orderBusy[l.supplier_id] ? ' disabled' : '') + '>Take off</button>';
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
    h += orderChipHtml(e, s);
    h += '<span class="dpc-grow"></span>';
    h += orderButtonHtml(e, s);
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
    h += orderStripHtml(e, s);
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

  // An order made in Dispatch carries its supplier and source (slice 5); any
  // other order was made outside it.
  function isDispatchOrder(o) { return !!(o && o.supplier_id && o.source); }

  // The job's purchase orders made outside Dispatch, read only and never
  // merged into a supplier card: an order names its supplier as typed text.
  // No price is shown. Dispatch's own orders are on their supplier's card.
  function ordersHtml(e) {
    if (!e.ordersOk) return '<div class="dpc-orders">' + matFail("Could not load this job's orders.", 'orders') + '</div>';
    var outside = e.orders.filter(function (o) { return !isDispatchOrder(o); });
    if (!outside.length) return '';
    var h = '<div class="dpc-orders"><h4 class="dpc-mat-h4">Orders on this job</h4>';
    outside.forEach(function (o) {
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
    var h = otherOrdersLine(e.jobId);
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
    if (open) h += '<p>Write out the materials, split them by supplier, then create the PO and email in one go</p>';
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

  // ───────────────────────── render: Emails (slice 5) ─────────────────────────

  var MAIL_FOOT = 'Email sent and received through the orders address, and system email to the client. Email in staff mailboxes is not listed here yet.';

  function mailFail(message, retry) {
    return '<div class="dpc-empty dpc-empty-tight dpc-mat-fail" role="alert">' + esc(message) +
      ' <button type="button" class="dpc-retry" data-dpc-mail="retry" data-dpc-mail-key="' + esc(retry) + '">Retry</button></div>';
  }

  // "Now" for a draft made in the last two minutes, else when it was made.
  function madeText(v) {
    var t = Date.parse(text(v));
    if (isFinite(t) && Date.now() - t < 120000) return 'Now';
    return stampText(v);
  }

  function draftItemHtml(m, d) {
    var key = 'd:' + d.id;
    var unknown = d.status === 'send_unknown';
    var h = '<button type="button" class="dpc-mail-item dpc-mail-draft" data-dpc-mail="pick" data-dpc-mail-key="' + esc(key) + '" aria-pressed="' + (m.sel === key) + '">';
    h += '<span class="dpc-mail-top"><strong>' + esc(text(d.supplier_name) || 'Supplier not recorded') + '<span class="dpc-mail-drafttag">Draft</span></strong><small>' + esc(madeText(d.created_at)) + '</small></span>';
    h += '<span class="dpc-mail-subj">' + esc(text(d.subject)) + '</span>';
    return h + '<span class="' + (unknown ? 'dpc-mat-fail' : 'dpc-muted') + '">' + (unknown ? 'Send not confirmed' : d.status === 'sending' ? 'Sending...' : 'Draft ready to send') + '</span></button>';
  }

  function tagWord(t) { return t.tag === 'client' ? 'Client' : 'Supplier'; }

  function threadItemHtml(m, t) {
    var key = 't:' + t.key;
    var who = t.tag === 'client' ? 'Client' : (text(t.counterpart) || 'Sender not recorded');
    var h = '<button type="button" class="dpc-mail-item" data-dpc-mail="pick" data-dpc-mail-key="' + esc(key) + '" aria-pressed="' + (m.sel === key) + '">';
    h += '<span class="dpc-mail-top"><strong>' + esc(who) + '</strong><small>' + esc(stampText(t.last_at)) + '</small></span>';
    h += '<span class="dpc-mail-subj">' + esc(text(t.subject) || 'No subject') + '</span>';
    if (text(t.last_preview)) h += '<span class="dpc-muted dpc-mail-prev">' + esc(text(t.last_preview)) + '</span>';
    return h + '<span class="dpc-mail-tags"><span class="dpc-type">' + tagWord(t) + '</span></span></button>';
  }

  // Row 19: the address is fixed text from the supplier's contact, never a box.
  function toHtml(d) {
    var name = text(d.supplier_name) || 'this supplier';
    var to = d.to || {};
    if (to.state === 'ok') return '<strong class="dpc-mail-to">' + esc(text(to.email)) + '</strong><small>From the supplier\'s contact</small>';
    var why = to.state === 'not_supplier'
      ? 'The email on file for ' + name + ' is one of ours or a test address, not the supplier\'s. Fix the contact in Xero.'
      : to.state === 'malformed'
        ? 'The email on file for ' + name + ' is not a single address. Fix the contact in Xero.'
        : 'No email on file for ' + name + '. Add it to the supplier\'s contact in Xero; it reaches here after the nightly sync.';
    return '<span class="dpc-mat-fail">' + esc(why) + '</span>';
  }

  function pdfFailHtml(key, attrs) {
    if (state.mail.pdf[key] !== 'failed') return '';
    return '<div class="dpc-line-msg dpc-mat-fail dpc-pdf-fail" role="alert">Could not open the PDF. <button type="button" class="dpc-retry" ' + attrs + '>Retry</button></div>';
  }

  function confirmHtml(question, go, no, attrs) {
    return '<div class="dpc-mail-confirm" role="group"><p class="dpc-empty dpc-empty-tight">' + esc(question) + '</p><div class="dpc-actions">' +
      '<button type="button" class="dpc-primary" data-dpc-mail="' + go[0] + '" ' + attrs + '>' + go[1] + '</button>' +
      '<button type="button" data-dpc-mail="' + no[0] + '" ' + attrs + '>' + no[1] + '</button></div></div>';
  }

  function msgHtml(msg, retryAttrs) {
    if (!msg) return '';
    return '<p class="dpc-mail-msg dpc-mat-fail" role="alert">' + esc(msg.text) +
      (msg.retry && retryAttrs ? ' <button type="button" class="dpc-retry" ' + retryAttrs + '>Retry</button>' : '') + '</p>';
  }

  // A released send (dispatch_order_release_unknown): the server writes who into
  // last_error; when comes from the release answer's stamp, known only to the
  // tab that released it. A later save moves the draft's own stamp, so it is
  // never used as the release time. Follow-up: a back-end released_at on the
  // draft read.
  var RELEASED_RE = /^Released as not sent by (.+)$/;
  function releasedHtml(m, d) {
    var who = RELEASED_RE.exec(text(d.last_error));
    if (!who || d.status !== 'draft') return '';
    var at = m.released[d.id] || null;
    var when = stampText(at);
    return '<p class="dpc-mail-msg" role="status">Released as not sent by ' + esc(who[1]) + (when ? ', ' + esc(when) : '') + '. Nothing was sent by the release.</p>';
  }

  // A send not confirmed for more than a day: Resend's guard against a second
  // copy has lapsed, so the person must check before trying again. Each retry
  // moves updated_at, so this counts from when the draft was made: early, never
  // late. Follow-up: a back-end first_attempt_at on the draft read.
  var DAY_MS = 24 * 3600 * 1000;
  function stuckOverDay(d) { var t = Date.parse(text(d.created_at)); return isFinite(t) && Date.now() - t > DAY_MS; }

  function draftViewHtml(m, d) {
    var id = esc(d.id);
    var ref = 'data-dpc-mail-key="' + id + '"';
    var unknown = d.status === 'send_unknown';
    var sending = !!m.busy['send:' + d.id] || d.status === 'sending';
    var editable = d.status === 'draft' && !sending;
    var ed = m.edits[d.id] || {};
    var po = text(d.po_number) || 'the order';
    var h = '<div class="dpc-mail-head"><strong>Draft to ' + esc(text(d.supplier_name) || 'Supplier not recorded') + '</strong><span class="dpc-type">Draft</span></div>';
    h += '<div class="dpc-field"><span>To</span><div class="dpc-field-val">' + toHtml(d) + '</div></div>';
    h += '<div class="dpc-field"><label for="dpc-mail-subj">Subject</label><input type="text" id="dpc-mail-subj" data-dpc-mail-subject="' + id + '" maxlength="300" value="' +
      esc(draftText(m, d, 'subject')) + '"' + (editable ? '' : ' disabled') + '></div>';
    h += '<textarea class="dpc-textarea dpc-mail-body" data-dpc-mail-body="' + id + '" maxlength="20000" aria-label="Message"' + (editable ? '' : ' disabled') + '>' + esc(draftText(m, d, 'body')) + '</textarea>';
    if (d.order_changed_since_edit) h += '<p class="dpc-mail-msg" role="status">The order changed after you edited this message. Check the lines in it.</p>';
    h += '<div data-dpc-region="mailsave">' + (ed.saving ? '<p class="dpc-mail-msg" role="status">Saving...</p>' : ed.failed
      ? '<p class="dpc-mail-msg dpc-mat-fail" role="alert">Not saved. <button type="button" class="dpc-retry" data-dpc-mail="save-retry" ' + ref + '>Retry</button></p>' : '') + '</div>';
    var pdf = d.pdf || {};
    var n = Number(pdf.line_count);
    var file = text(pdf.file_name) || po + '.pdf';
    var pdfAttrs = 'data-dpc-order-pdf="' + esc(d.purchase_order_id) + '" data-dpc-order-pdf-version="' + esc(pdf.version || '') + '" data-dpc-order-pdf-key="draft:' + id + '"';
    h += '<div class="dpc-attach">' + docChip(file, 'PO with ' + (isFinite(n) ? n : '?') + ' line' + (n === 1 ? '' : 's') + ' and the delivery address' +
      (state.mail.pdf['draft:' + d.id] === 'busy' ? ' · Opening...' : ''), pdfAttrs) + pdfFailHtml('draft:' + d.id, pdfAttrs) + '</div>';
    var ask = m.ask && m.ask.id === d.id ? m.ask.kind : null;
    if (d.status === 'sending') {
      return h + '<div class="dpc-actions"><button type="button" class="dpc-primary" disabled>Sending...</button></div>';
    }
    if (unknown) {
      h += '<p class="dpc-mail-msg dpc-mat-fail" role="alert">We could not tell whether this email went. Check the thread before trying again.</p>';
      if (stuckOverDay(d)) {
        h += '<p class="dpc-mail-msg dpc-mat-fail" role="alert">This send has not been confirmed for more than 24 hours. Check the supplier thread and ask the supplier before trying again: a retry now can send them a second copy.</p>';
      }
      h += msgHtml(m.msg['release:' + d.id]);
      if (ask === 'release') {
        h += confirmHtml('Unlock this draft? Only do this once you have checked the thread and the supplier\'s mailbox and the email did not go. Nothing is sent.',
          ['release-go', 'Unlock draft'], ['release-no', 'Not yet'], ref);
      } else {
        h += '<div class="dpc-actions"><button type="button" class="dpc-primary" data-dpc-mail="send-again" ' + ref + (sending ? ' disabled' : '') + '>' + (sending ? 'Sending...' : 'Try the send again') + '</button>';
        h += '<button type="button" data-dpc-mail="release" ' + ref + (m.busy['release:' + d.id] ? ' disabled' : '') + '>It did not go</button></div>';
      }
      return h;
    }
    h += releasedHtml(m, d);
    h += msgHtml(m.msg['send:' + d.id]);
    h += msgHtml(m.msg['discard:' + d.id], 'data-dpc-mail="discard-go" ' + ref);
    if (ask === 'send' && !sendBlock(m, d)) {
      h += otherOrdersLine(m.jobId);
      h += confirmHtml('Send ' + po + ' to ' + text(d.to.email) + ' with ' + file + '? It goes from ' + ORDERS_FROM + '.', ['send-go', 'Send now'], ['send-no', 'Not yet'], ref);
    } else if (ask === 'discard') {
      h += confirmHtml('Discard this email? The order stays.', ['discard-go', 'Discard'], ['discard-no', 'Keep'], ref);
    } else {
      h += '<div class="dpc-actions"><button type="button" class="dpc-primary" data-dpc-mail="send" ' + ref + (sendBlock(m, d) ? ' disabled' : '') + '>' + (sending ? 'Sending...' : 'Send') + '</button>';
      h += '<button type="button" data-dpc-mail="discard" ' + ref + (sending || m.busy['discard:' + d.id] ? ' disabled' : '') + '>Discard draft</button></div>';
    }
    return h;
  }

  function threadViewHtml(m, t) {
    var key = esc(t.key);
    var ref = 'data-dpc-mail-key="' + key + '"';
    var h = '<div class="dpc-mail-head"><strong>' + esc(text(t.subject) || 'No subject') + '</strong><span class="dpc-mail-tags"><span class="dpc-type">' + tagWord(t) + '</span>' +
      (text(t.po_number) ? '<span class="dpc-status dpc-tone-info">' + esc(text(t.po_number)) + '</span>' : '') + '</span></div>';
    h += '<div class="dpc-chat dpc-mail-chat">';
    t.messages.forEach(function (msg) {
      msg = msg || {};
      var out = msg.direction === 'outbound';
      var when = stampText(msg.at);
      h += '<div class="dpc-bubble ' + (out ? 'us' : 'them') + '">' + esc(text(msg.text) || 'No message text recorded.');
      var atts = Array.isArray(msg.attachments) ? msg.attachments.filter(function (a) { return a && text(a.file_name); }) : [];
      if (atts.length) {
        h += '<span class="dpc-mail-atts">' + atts.map(function (a) { return '<span class="dpc-mail-att">' + esc(text(a.file_name)) + '</span>'; }).join('') + '</span>';
      }
      h += '<small>' + esc(out ? 'SecureWorks' : (text(msg.from_email) || 'Sender not recorded')) + (when ? ', ' + esc(when) : '') + '</small></div>';
    });
    h += '</div>';
    if (t.tag !== 'supplier') return h;
    if (t.can_reply) {
      var busy = !!m.busy['reply:' + t.key];
      var msg = m.msg['reply:' + t.key];
      var held = !!(msg && msg.unknown);
      var draft = held ? msg.attempt.body_text : String(m.replies[t.key] || '');
      var to = replyTo(t);
      h += '<div class="dpc-mail-reply"><textarea class="dpc-textarea dpc-mail-replybox" data-dpc-mail-reply="' + key + '" maxlength="20000" placeholder="Reply to the supplier..." aria-label="Reply to the supplier"' +
        (busy || held ? ' disabled' : '') + '>' + esc(draft) + '</textarea>';
      if (msg) {
        h += '<p class="dpc-mail-msg dpc-mat-fail" role="alert">' + esc(msg.text) + '</p>';
        if (msg.unknown) h += '<div class="dpc-actions"><button type="button" class="dpc-primary" data-dpc-mail="reply-again" ' + ref + (busy ? ' disabled' : '') + '>Try the send again</button></div>';
      }
      if (m.ask && m.ask.kind === 'reply' && m.ask.id === t.key && draft.trim() && !busy) {
        h += confirmHtml('Send this reply to ' + to + '?', ['reply-go', 'Send now'], ['reply-no', 'Not yet'], ref);
      } else if (!held) {
        h += '<div class="dpc-actions"><button type="button" class="dpc-primary" data-dpc-mail="reply" ' + ref + (busy || !draft.trim() ? ' disabled' : '') + '>' + (busy ? 'Sending...' : 'Send reply') + '</button></div>';
      }
      h += '</div>';
    }
    if (t.can_link) {
      var chosen = m.link[t.key] || '';
      var linking = !!m.busy['link:' + t.key];
      h += '<div class="dpc-mail-link"><select data-dpc-mail-link="' + key + '" aria-label="Link to PO"' + (linking ? ' disabled' : '') + '><option value="">Link to PO...</option>';
      m.ordersForLink.forEach(function (o) {
        h += '<option value="' + esc(o.id) + '"' + (o.id === chosen ? ' selected' : '') + '>' + esc((text(o.po_number) || 'No order number') + ' · ' + (text(o.supplier_name) || 'Supplier not recorded')) + '</option>';
      });
      h += '</select><button type="button" data-dpc-mail="link" ' + ref + (linking || !chosen ? ' disabled' : '') + '>Link</button></div>';
      h += msgHtml(m.msg['link:' + t.key], 'data-dpc-mail="link" ' + ref);
    }
    return h + threadDelivHtml(m, t);
  }

  // Slice 6: Mark delivery confirmed, on a supplier thread linked to one of the
  // job's live orders (a row in its deliveries). Its inline line is the row's.
  function threadDelivHtml(m, t) {
    var e = matEntry(m.jobId);
    var r = t.po_id && e && e.status === 'ok' ? delivRow(e, String(t.po_id)) : null;
    if (!r) return '';
    var ed = state.deliv.edit;
    if (ed && ed.jobId === m.jobId && ed.via === 'thread' && ed.key === t.key && ed.poId === r.purchase_order_id) {
      return '<div class="dpc-mail-deliv">' + delivEditHtml(r, ed) + '</div>';
    }
    return '<div class="dpc-actions dpc-mail-deliv"><button type="button" data-dpc-deliv-thread="' + esc(t.key) + '" data-dpc-deliv-po="' + esc(r.purchase_order_id) + '"' +
      (state.deliv.busy[r.purchase_order_id] ? ' disabled' : '') + '>Mark delivery confirmed</button></div>';
  }

  function mailViewHtml(m) {
    var sel = m.sel || '';
    if (sel.indexOf('d:') === 0) { var d = draftById(m, sel.slice(2)); if (d) return draftViewHtml(m, d); }
    if (sel.indexOf('t:') === 0) { var t = threadByKey(m, sel.slice(2)); if (t) return threadViewHtml(m, t); }
    return '<div class="dpc-empty dpc-empty-tight">Nothing open.</div>';
  }

  function mailBodyHtml(m) {
    var foot = '<p class="dpc-foot-line">' + esc(MAIL_FOOT) + '</p>';
    if (!m || m.status === 'loading') return '<div class="dpc-empty dpc-empty-tight">Loading email...</div>';
    if (m.status === 'error') return mailFail('Could not load email.', 'read');
    var h = m.notice ? '<div class="dpc-mat-notice" role="status">' + esc(m.notice) + '</div>' : '';
    if (!mailKeys(m).length && m.threadsOk) return h + '<div class="dpc-empty dpc-empty-tight">No email on this job yet.</div>' + foot;
    h += '<div class="dpc-mail"><div class="dpc-mail-list">';
    m.drafts.forEach(function (d) { h += draftItemHtml(m, d); });
    if (!m.threadsOk) h += '<div class="dpc-mail-listfail">' + mailFail('Could not load the email threads.', 'threads') + '</div>';
    m.threads.forEach(function (t) { h += threadItemHtml(m, t); });
    h += '</div><div class="dpc-mail-view">' + mailViewHtml(m) + '</div></div>';
    return h + foot;
  }

  // Drawn on every job except a make-safe one, under Materials by supplier.
  function mailHtml() {
    var row = state.row;
    if (!row || isMakesafe(row)) return '';
    var open = state.mail.open;
    var h = '<div class="dpc-sec dpc-mailsec' + (open ? '' : ' dpc-collapsed') + '" data-dpc-region="mail"><div class="dpc-sec-head"><div class="dpc-grow"><span class="dpc-eyebrow">Send</span><h3>Emails</h3>';
    if (open) h += '<p>Supplier and client email for this job. A created PO lands here as a ready-to-send draft</p>';
    h += '</div><button type="button" class="dpc-chev" data-dpc-toggle="mail" aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse' : 'Expand') + ' Emails">' + CHEV_SVG + '</button></div>';
    if (open) h += '<div class="dpc-sec-body">' + mailBodyHtml(mailEntry(row.id)) + '</div>';
    return h + '</div>';
  }

  var MAIL_FOCUS_KEYS = ['data-dpc-mail-subject', 'data-dpc-mail-body', 'data-dpc-mail-reply', 'data-dpc-mail-link', 'data-dpc-mail', 'data-dpc-mail-key', 'data-dpc-toggle',
    'data-dpc-deliv-thread', 'data-dpc-deliv-edit', 'data-dpc-deliv-edit-date'];
  function paintMail() {
    var el = region('mail');
    if (!el) return;
    var a = document.activeElement;
    var f = null;
    if (a && el.contains(a)) {
      var sel = MAIL_FOCUS_KEYS.filter(function (k) { return a.hasAttribute(k); }).map(function (k) {
        return '[' + k + '="' + String(a.getAttribute(k)).replace(/["\\]/g, '\\$&') + '"]';
      }).join('');
      if (sel) { f = { sel: sel }; try { f.start = a.selectionStart; f.end = a.selectionEnd; } catch (x) { /* not a text box */ } }
    }
    painting = true;
    try { el.outerHTML = mailHtml(); } finally { painting = false; }
    var now = f && region('mail') ? region('mail').querySelector(f.sel) : null;
    if (!now || now.disabled) return;
    now.focus({ preventScroll: true });
    if (typeof f.start === 'number' && now.setSelectionRange) { try { now.setSelectionRange(f.start, f.end); } catch (x) { /* not a text box */ } }
  }
  function paintMailIf(jobId) { if (state.jobId === jobId) paintMail(); }

  // While typing in a draft: only the Send button's state, so the box keeps its place.
  function paintSendState(jobId) {
    var m = mailEntry(jobId);
    var r = region('mail');
    if (!m || !r || state.jobId !== jobId) return;
    m.drafts.forEach(function (d) {
      var b = r.querySelector('[data-dpc-mail="send"][data-dpc-mail-key="' + d.id + '"]');
      if (b) b.disabled = !!sendBlock(m, d);
    });
  }

  // ── Sources: the Purchase orders group (slice 5, rows 33 to 35) ──

  function poSourceWords(e, o) {
    if (o.status === 'cancelled') return 'Cancelled';
    if (isDispatchOrder(o)) {
      for (var i = 0; i < e.suppliers.length; i++) {
        var so = supOrder(e, e.suppliers[i]);
        if (so && so.id === o.id && chipWords(so)) return chipWords(so);
      }
    }
    return orderStatusWord(o.status);
  }

  function poSourcesHtml() {
    var row = state.row;
    if (!row || isMakesafe(row)) return '';
    var e = matEntry(row.id);
    var h = '<h4 class="dpc-h4">Purchase orders</h4>';
    if (!e || e.status === 'loading') return h + '<div class="dpc-empty dpc-empty-tight">Loading purchase orders...</div>';
    if (e.status === 'error' || !e.ordersOk) {
      return h + '<div class="dpc-empty dpc-empty-tight" role="alert">Could not load this job\'s orders. <button type="button" class="dpc-retry" data-dpc-order="sources-retry">Retry</button></div>';
    }
    if (!e.orders.length) return h + '<div class="dpc-empty dpc-empty-tight">No purchase order yet.</div>';
    e.orders.forEach(function (o) {
      var po = text(o.po_number);
      var words = (text(o.supplier_name) || 'Supplier not recorded') + ', ' + poSourceWords(e, o);
      if (isDispatchOrder(o) && o.pdf_version) {
        var key = 'src:' + o.id;
        var attrs = 'data-dpc-order-pdf="' + esc(o.id) + '" data-dpc-order-pdf-key="' + esc(key) + '"';
        h += docChip((po || 'Order') + '.pdf', words + (state.mail.pdf[key] === 'busy' ? ' · Opening...' : ''), attrs) + pdfFailHtml(key, attrs);
      } else {
        h += '<div class="dpc-doc dpc-doc-nopdf"><span class="dpc-grow"><strong>' + esc(po || 'No order number') + '</strong><small>' + esc(words) + '</small><small>No PDF on file</small></span></div>';
      }
    });
    return h;
  }

  // The Sources tab, redrawn when the materials read (its orders) lands.
  function paintSources() {
    if (!state.rightOpen || state.tab !== 'sources') return;
    var el = region('panel');
    if (el) el.innerHTML = panelHtml();
  }

  function paintPdfLines() { paintSources(); paintMail(); }

  // ───────────────────────── render: Schedule (slice 6) ─────────────────────────

  var DELIV_EMPTY = 'No orders on this job yet. Orders made in Materials by supplier show here.';
  var PORTAL_TEXT = 'The real schedule lives in the Ops Calendar. These orders show there as material deliveries, next to the crews.';

  function dayOf(v) { return dayText(parseDay(v)); }

  // A date box styled as the approved dashed input. Empty, it reads "Set date".
  function dateBoxHtml(value, attrs, label, off, asTyped) {
    var v = asTyped ? value : wholeDay(value);
    return '<span class="dpc-deliv-date' + (v ? '' : ' dpc-deliv-blank') + '"><input type="date" ' + attrs + ' value="' + esc(v) + '" aria-label="' + esc(label) + '"' +
      (off ? ' disabled' : '') + '><span class="dpc-deliv-ph" aria-hidden="true">Set date</span></span>';
  }

  function delivExpectedHtml(r, busy) {
    var d = r.delivery;
    var po = text(r.po_number) || 'this order';
    if (!d.expected_editable) {
      return '<span class="dpc-dstate' + (d.expected ? ' on' : '') + '">' + (d.expected ? esc(dayOf(d.expected)) : '<em>No date in Xero</em>') + '<small>Set in Xero</small></span>';
    }
    var typed = state.deliv.typed[r.purchase_order_id];
    var asTyped = Object.prototype.hasOwnProperty.call(state.deliv.typed, r.purchase_order_id) && (typed === '' || /^\d{4}-\d{2}-\d{2}$/.test(typed));
    return '<span class="dpc-dstate' + (d.expected ? ' on' : '') + '">' +
      dateBoxHtml(asTyped ? typed : d.expected, 'data-dpc-deliv-expected="' + esc(r.purchase_order_id) + '"', 'Expected date for ' + po, busy, asTyped) + '</span>';
  }

  function delivConfirmedHtml(r, busy) {
    var c = r.delivery.confirmed;
    var poId = esc(r.purchase_order_id);
    var open = ' data-dpc-deliv-confirm="' + poId + '"' + (busy ? ' disabled' : '');
    if (c.state === 'date') {
      if (!c.by_hand) return '<span class="dpc-dstate on">' + esc(dayOf(c.date)) + '</span>';
      var when = dayText(parseStamp(c.set_at));
      return '<span class="dpc-dstate on"><button type="button" class="dpc-deliv-daybtn" aria-label="Change the confirmed date"' + open + '>' + esc(dayOf(c.date)) + '</button>' +
        '<small>Set by ' + esc(text(c.set_by) || 'name not recorded') + (when ? ', ' + esc(when) : '') + '</small></span>';
    }
    if (c.state === 'status_only') return '<span class="dpc-dstate on">Confirmed, no date given</span>';
    var words = c.state === 'not_confirmed' ? 'Not confirmed by supplier' : 'Waiting on supplier';
    return '<span class="dpc-dstate"><em>' + words + '</em><button type="button" class="dpc-textbtn"' + open + '>Set confirmed date</button></span>';
  }

  function delivSightedHtml(r, busy) {
    var s = r.delivery.sighted;
    var poId = esc(r.purchase_order_id);
    if (!s) {
      return '<span class="dpc-dstate"><button type="button" class="dpc-deliv-btn" data-dpc-deliv-sight="' + poId + '"' + (busy ? ' disabled' : '') + '>' +
        (busy === 'dispatch_delivery_mark_sighted' ? 'Saving...' : 'Mark sighted') + '</button></span>';
    }
    var who = [stampText(s.at), text(s.by)].filter(Boolean).join(', ');
    return '<span class="dpc-dstate on">' + esc(who || 'Sighted') + '<button type="button" class="dpc-textbtn" data-dpc-deliv-unsight="ask" data-dpc-deliv-po="' + poId + '"' +
      (busy ? ' disabled' : '') + '>Not sighted</button></span>';
  }

  // The inline confirmed-date line, shared by the row and a supplier thread.
  function delivEditHtml(r, ed) {
    var po = text(r.po_number) || 'this order';
    var off = ed.busy ? ' disabled' : '';
    var h = '<div class="dpc-deliv-edit" role="group" aria-label="Confirmed delivery date"><p class="dpc-empty dpc-empty-tight">Confirmed delivery for ' + esc(po) + ':</p><div class="dpc-actions">';
    h += dateBoxHtml(ed.date, 'data-dpc-deliv-edit-date', 'Confirmed delivery date for ' + po, ed.busy);
    h += '<button type="button" class="dpc-primary" data-dpc-deliv-edit="save"' + (ed.busy || !wholeDay(ed.date) ? ' disabled' : '') + '>' + (ed.busy && ed.last !== null ? 'Saving...' : 'Save') + '</button>';
    if (ed.via === 'deliveries' && r.delivery.confirmed.by_hand) h += '<button type="button" class="dpc-primary" data-dpc-deliv-edit="clear"' + off + '>' + (ed.busy && ed.last === null ? 'Clearing...' : 'Clear') + '</button>';
    h += '<button type="button" data-dpc-deliv-edit="cancel"' + off + '>Cancel</button></div>';
    if (ed.fail) h += '<p class="dpc-empty dpc-empty-tight dpc-mat-fail" role="alert">Confirmed date not saved. <button type="button" class="dpc-retry" data-dpc-deliv-edit="retry"' + off + '>Retry</button></p>';
    return h + '</div>';
  }

  function delivRowHtml(jobId, r) {
    var d = state.deliv;
    if (r.kind === 'not_ordered') {
      return '<div class="dpc-deliv-item"><div class="dpc-deliv-row" data-step="0"><span><strong>' + esc(text(r.supplier_name) || 'Name not recorded') + '</strong><small>Not ordered yet</small></span>' +
        '<span class="dpc-dstate"><em>Order first</em></span><span class="dpc-dstate"><em>-</em></span><span class="dpc-dstate"><em>-</em></span></div></div>';
    }
    var poId = r.purchase_order_id;
    var busy = d.busy[poId] || false;
    var dl = r.delivery;
    var h = '<div class="dpc-deliv-item" data-dpc-deliv-row="' + esc(poId) + '"><div class="dpc-deliv-row" data-step="' + esc(dl.step) + '">';
    h += '<span><strong>' + esc(text(r.supplier_name) || 'Supplier not recorded') + '</strong><small>' + esc(text(r.po_number) || 'No order number') +
      (r.made_in_dispatch ? '' : ' · Made outside Dispatch') + '</small></span>';
    h += delivExpectedHtml(r, busy) + delivConfirmedHtml(r, busy) + delivSightedHtml(r, busy) + '</div>';
    var confirmedDay = dl.confirmed.state === 'date' ? text(dl.confirmed.date) : '';
    if (confirmedDay && text(dl.expected) && confirmedDay !== text(dl.expected)) {
      h += '<p class="dpc-deliv-sub">The calendar shows this delivery on the expected day, ' + esc(dayOf(dl.expected)) + '.</p>';
    }
    if (d.edit && d.edit.jobId === jobId && d.edit.poId === poId && d.edit.via === 'deliveries') h += '<div class="dpc-deliv-sub">' + delivEditHtml(r, d.edit) + '</div>';
    if (d.ask && d.ask.jobId === jobId && d.ask.poId === poId && dl.sighted) {
      h += '<div class="dpc-deliv-sub"><div class="dpc-deliv-edit" role="group" aria-label="Clear the sighting"><p class="dpc-empty dpc-empty-tight">Clear the sighting on ' +
        esc(text(r.po_number) || 'this order') + '? It was marked by ' + esc(text(dl.sighted.by) || 'someone not recorded') + '.</p><div class="dpc-actions">' +
        '<button type="button" class="dpc-primary" data-dpc-deliv-unsight="go" data-dpc-deliv-po="' + esc(poId) + '"' + (busy ? ' disabled' : '') + '>Clear</button>' +
        '<button type="button" data-dpc-deliv-unsight="keep" data-dpc-deliv-po="' + esc(poId) + '"' + (busy ? ' disabled' : '') + '>Keep</button></div></div></div>';
    }
    return h + '</div>';
  }

  // The line under the table: a failed press with its Retry, or a notice.
  function delivMsgHtml(jobId) {
    var m = state.deliv.msg;
    if (!m || m.jobId !== jobId) return '';
    if (!m.retry) return '<p class="dpc-deliv-msg" role="status">' + esc(m.text) + '</p>';
    return '<p class="dpc-deliv-msg dpc-mat-fail" role="alert">' + esc(m.text) + ' <button type="button" class="dpc-retry" data-dpc-deliv-retry="write">Retry</button></p>';
  }

  function delivBodyHtml(e) {
    var jobId = state.jobId;
    if (!e || e.status === 'loading') return '<div class="dpc-empty dpc-empty-tight">Loading the deliveries...</div>';
    if (e.status === 'error' || !e.deliveries) {
      return '<div class="dpc-empty dpc-empty-tight dpc-mat-fail" role="alert">Could not load the deliveries. <button type="button" class="dpc-retry" data-dpc-deliv-retry="read">Retry</button></div>';
    }
    if (!e.deliveries.rows.length) return '<div class="dpc-empty dpc-empty-tight">' + DELIV_EMPTY + '</div>' + delivMsgHtml(jobId);
    var h = '<div class="dpc-deliv"><div class="dpc-deliv-row dpc-deliv-head"><span>Supplier and PO</span><span>Expected</span><span>Confirmed by supplier</span><span>Sighted on site</span></div>';
    e.deliveries.rows.forEach(function (r) { h += delivRowHtml(jobId, r); });
    return h + '</div>' + delivMsgHtml(jobId);
  }

  // ── slice 7: the install row, under the deliveries table ──

  function installMarkBtn(busy) {
    return '<button type="button" class="dpc-deliv-btn" data-dpc-install="mark"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving...' : 'Mark confirmed') + '</button>';
  }

  function installConfirmedHtml(d, busy) {
    var c = d.confirmed;
    var by = c ? text(c.by) || 'someone not recorded' : '';
    if (c && d.confirmed_current) {
      return '<span class="dpc-dstate on">' + esc(stampText(c.at) + ', ' + by) + '<button type="button" class="dpc-textbtn" data-dpc-install="clear-ask"' + (busy ? ' disabled' : '') + '>Not confirmed</button></span>';
    }
    if (c) {
      var why = parseDay(c.for_day)
        ? 'Confirmed for ' + dayText(parseDay(c.for_day)) + ' by ' + by + '. The booking has moved.'
        : 'Confirmed with nothing booked, by ' + by + '. A booking has been made since.';
      return '<span class="dpc-dstate"><em>' + esc(why) + '</em>' + installMarkBtn(busy) + '</span>';
    }
    return '<span class="dpc-dstate">' + installMarkBtn(busy) + '</span>';
  }

  function installMsgHtml(jobId) {
    var m = state.install.msg;
    if (!m || m.jobId !== jobId) return '';
    if (typeof m.retry !== 'boolean') return '<p class="dpc-deliv-msg" role="status">' + esc(m.text) + '</p>';
    return '<p class="dpc-deliv-msg dpc-mat-fail" role="alert">' + esc(m.text) + ' <button type="button" class="dpc-retry" data-dpc-install="retry">Retry</button></p>';
  }

  function installHtml(row) {
    var h = '<div class="dpc-deliv dpc-install"><div class="dpc-deliv-row dpc-install-row dpc-deliv-head"><span>Install</span><span>Trade booked</span><span>Install confirmed</span></div>';
    var d = installOf(row);
    if (!d) {
      return h + '<div class="dpc-deliv-item"><div class="dpc-empty dpc-mat-fail" role="alert">Could not load the bookings. <button type="button" class="dpc-retry" data-dpc-install="retry-read">Retry</button></div></div></div>';
    }
    var ins = state.install;
    var busy = ins.busy === row.id;
    var current = !!(d.confirmed && d.confirmed_current);
    var booked = bookedText(d);
    h += '<div class="dpc-deliv-item"><div class="dpc-deliv-row dpc-install-row" data-step="' + (current ? 3 : 1) + '">';
    h += '<span><strong>Install</strong><small>' + esc(text(row.job_number) || 'No job number') + '</small></span>';
    h += '<span class="dpc-dstate' + (booked ? ' on' : '') + '">' + (booked ? esc(booked) : '<em>Not booked</em>') + '</span>';
    h += installConfirmedHtml(d, busy) + '</div>';
    if (d.also_days.length) {
      h += '<p class="dpc-deliv-sub">Also booked: ' + esc(d.also_days.map(function (v) { return dayText(parseDay(v)); }).filter(Boolean).join(', ')) + '.</p>';
    }
    if (d.calendar_confirmed) h += '<p class="dpc-deliv-sub">The calendar shows this booking as confirmed.</p>';
    var ask = ins.ask && ins.ask.jobId === row.id ? ins.ask.kind : null;
    var off = busy ? ' disabled' : '';
    if (ask === 'none' && !d.confirmed_current) {
      h += '<div class="dpc-deliv-sub"><div class="dpc-deliv-edit" role="group" aria-label="Mark the install confirmed"><p class="dpc-empty dpc-empty-tight">No install is booked on this job. Mark the install confirmed anyway?</p>' +
        '<div class="dpc-actions"><button type="button" class="dpc-primary" data-dpc-install="go"' + off + '>' + (busy ? 'Saving...' : 'Mark confirmed') + '</button>' +
        '<button type="button" data-dpc-install="cancel"' + off + '>Cancel</button></div></div></div>';
    } else if (ask === 'clear' && current) {
      h += '<div class="dpc-deliv-sub"><div class="dpc-deliv-edit" role="group" aria-label="Clear the install confirmation"><p class="dpc-empty dpc-empty-tight">Clear the install confirmation? It was marked by ' +
        esc(text(d.confirmed.by) || 'someone not recorded') + '.</p><div class="dpc-actions"><button type="button" class="dpc-primary" data-dpc-install="clear-go"' + off + '>' + (busy ? 'Clearing...' : 'Clear') + '</button>' +
        '<button type="button" data-dpc-install="keep"' + off + '>Keep</button></div></div></div>';
    }
    return h + '</div></div>' + installMsgHtml(row.id);
  }

  // The one way into the live calendar, at the foot of the section. Not drawn
  // when the page has no showView.
  function portalHtml() {
    var h = '<div class="dpc-portal"><span class="dpc-grow">' + esc(PORTAL_TEXT) + ' Bookings are made and changed there.</span>';
    if (typeof global.showView === 'function') h += '<button type="button" data-dpc-deliv-cal>Open Calendar</button>';
    return h + '</div>';
  }

  // Drawn on every job except a make-safe one, under Emails.
  function schedHtml() {
    var row = state.row;
    if (!row || isMakesafe(row)) return '';
    var open = state.deliv.open;
    var h = '<div class="dpc-sec dpc-sched' + (open ? '' : ' dpc-collapsed') + '" data-dpc-region="sched"><div class="dpc-sec-head"><div class="dpc-grow"><span class="dpc-eyebrow">Schedule</span><h3>Deliveries and install</h3>';
    if (open) h += '<p>Each PO to site, then the trade booked and the install confirmed</p>';
    h += '</div><button type="button" class="dpc-chev" data-dpc-toggle="sched" aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse' : 'Expand') + ' Deliveries and install">' + CHEV_SVG + '</button></div>';
    if (open) h += '<div class="dpc-sec-body">' + delivBodyHtml(matEntry(row.id)) + installHtml(row) + portalHtml() + '</div>';
    return h + '</div>';
  }

  var SCHED_FOCUS_KEYS = ['data-dpc-deliv-expected', 'data-dpc-deliv-edit-date', 'data-dpc-deliv-sight', 'data-dpc-deliv-unsight', 'data-dpc-deliv-po',
    'data-dpc-deliv-confirm', 'data-dpc-deliv-edit', 'data-dpc-deliv-retry', 'data-dpc-deliv-cal', 'data-dpc-install', 'data-dpc-toggle'];
  function paintSched() {
    var el = region('sched');
    if (!el) return;
    var a = document.activeElement;
    var sel = a && el.contains(a) ? SCHED_FOCUS_KEYS.filter(function (k) { return a.hasAttribute(k); }).map(function (k) {
      return '[' + k + '="' + String(a.getAttribute(k)).replace(/["\\]/g, '\\$&') + '"]';
    }).join('') : '';
    painting = true;
    try { el.outerHTML = schedHtml(); } finally { painting = false; }
    var now = sel && region('sched') ? region('sched').querySelector(sel) : null;
    if (now && !now.disabled) now.focus({ preventScroll: true });
  }
  function paintSchedIf(jobId) { if (state.jobId === jobId) paintSched(); }

  function workspaceHtml() {
    var h = '<section class="dpc-workspace" data-dpc-region="workspace" aria-label="Job">';
    if (state.base.status === 'error' && state.rowStale) {
      // No stale job: the header facts come from the list read that failed. A
      // job opened since, from a search that did load, is shown.
      h += '<div class="dpc-jobhead">' + failLine('Could not load this job.', 'list', true) + '</div>';
    } else if (!state.row) {
      h += '<div class="dpc-jobhead"><div class="dpc-empty dpc-empty-tight">' + (state.base.status === 'ok' ? 'No job to show.' : 'Loading jobs...') + '</div></div>';
    } else {
      h += headHtml(state.row) + sectionHtml() + matHtml() + mailHtml() + schedHtml();
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
      '[data-dpc-mat-retry],[data-dpc-mat-addline],[data-dpc-mat-suggest],[data-dpc-mat-remove],[data-dpc-mat-del],[data-dpc-mat-clear],' +
      '[data-dpc-order],[data-dpc-order-pdf],[data-dpc-mail],' +
      '[data-dpc-deliv-sight],[data-dpc-deliv-unsight],[data-dpc-deliv-confirm],[data-dpc-deliv-thread],[data-dpc-deliv-edit],[data-dpc-deliv-retry],[data-dpc-deliv-cal],[data-dpc-install]') : null;
    if (!t || t.disabled) return;
    if (onPanelClick(t, e)) return;
    if (onStageClick(t)) return;
    if (onMatClick(t)) return;
    if (onOrderClick(t)) return;
    if (onMailClick(t)) return;
    if (onDelivClick(t)) return;
    if (onInstallClick(t)) return;
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

  // Slice 5's presses on a supplier card, a locked line and an order PDF.
  // True when the press was one of them.
  function onOrderClick(t) {
    var jobId = state.jobId;
    if (t.hasAttribute('data-dpc-order-pdf')) {
      openOrderPdf(t.getAttribute('data-dpc-order-pdf'), t.getAttribute('data-dpc-order-pdf-version'), t.getAttribute('data-dpc-order-pdf-key'));
      return true;
    }
    if (!t.hasAttribute('data-dpc-order')) return false;
    var act = t.getAttribute('data-dpc-order');
    var sid = t.getAttribute('data-dpc-order-sid');
    var e = matEntry(jobId);
    if (!jobId) return true;
    if (act === 'sources-retry') { readMat(jobId, true); return true; }
    if (!e) return true;
    if (act === 'create') createOrder(jobId, sid);
    else if (act === 'update') updateOrder(jobId, sid, null);
    else if (act === 'takeoff') updateOrder(jobId, sid, t.getAttribute('data-dpc-order-line'));
    else if (act === 'cancel') { e.cancelAsk = sid; paintMat(); refocus('[data-dpc-order="cancel-keep"]'); }
    else if (act === 'cancel-keep') { e.cancelAsk = null; paintMat(); refocus('[data-dpc-order="cancel"][data-dpc-order-sid="' + sid + '"]'); }
    else if (act === 'cancel-go') cancelOrder(jobId, sid);
    else if (act === 'retry') {
      var what = t.getAttribute('data-dpc-order-retry') || '';
      if (what === 'create') createOrder(jobId, sid);
      else if (what === 'update') updateOrder(jobId, sid, null);
      else if (what === 'cancel') cancelOrder(jobId, sid);
      else if (what.indexOf('takeoff:') === 0) updateOrder(jobId, sid, what.slice(8));
    }
    return true;
  }

  // The Emails section's presses. True when the press was one of them. Only
  // send-go and send-again reach dispatch_order_send, and only reply-go and
  // reply-again reach dispatch_order_reply.
  function onMailClick(t) {
    var jobId = state.jobId;
    if (t.getAttribute('data-dpc-toggle') === 'mail') {
      state.mail.open = !state.mail.open;
      writeStore('localStorage', LS_MAIL, state.mail.open ? '1' : '0');
      Object.keys(state.mail.jobs).forEach(function (id) { state.mail.jobs[id].ask = null; });
      paintMail();
      refocus('[data-dpc-toggle="mail"]');
      return true;
    }
    if (!t.hasAttribute('data-dpc-mail')) return false;
    var act = t.getAttribute('data-dpc-mail');
    var key = t.getAttribute('data-dpc-mail-key') || '';
    var m = mailEntry(jobId);
    if (!jobId || !m) return true;
    var ask = function (kind, focus) { m.ask = { kind: kind, id: key }; paintMail(); refocus('[data-dpc-mail="' + focus + '"]'); };
    var unask = function (focus) { m.ask = null; paintMail(); refocus('[data-dpc-mail="' + focus + '"][data-dpc-mail-key="' + key + '"]'); };
    if (act === 'retry') readMail(jobId, key === 'threads');
    else if (act === 'pick') {
      if (m.sel !== key) { m.sel = key; m.ask = null; m.notice = ''; paintMail(); refocus('[data-dpc-mail="pick"][data-dpc-mail-key="' + key + '"]'); }
    }
    else if (act === 'send') ask('send', 'send-no');
    else if (act === 'send-no') unask('send');
    else if (act === 'send-go') sendDraft(jobId, key, false);
    else if (act === 'send-again') sendDraft(jobId, key, true);
    else if (act === 'release') ask('release', 'release-no');
    else if (act === 'release-no') unask('release');
    else if (act === 'release-go') releaseDraft(jobId, key);
    else if (act === 'discard') ask('discard', 'discard-no');
    else if (act === 'discard-no') unask('discard');
    else if (act === 'discard-go') discardDraft(jobId, key);
    else if (act === 'save-retry') saveDraft(jobId, key);
    else if (act === 'reply') ask('reply', 'reply-no');
    else if (act === 'reply-no') unask('reply');
    else if (act === 'reply-go') sendThreadReply(jobId, key, false);
    else if (act === 'reply-again') sendThreadReply(jobId, key, true);
    else if (act === 'link') linkThread(jobId, key);
    return true;
  }

  // The install row's presses. True when the press was one of them. Only
  // Mark confirmed (with a booking), its confirm line's Mark confirmed, Clear
  // and Retry send anything.
  function onInstallClick(t) {
    if (!t.hasAttribute('data-dpc-install')) return false;
    var jobId = state.jobId;
    var ins = state.install;
    var act = t.getAttribute('data-dpc-install');
    var d = state.row && state.row.id === jobId ? installOf(state.row) : null;
    if (!jobId) return true;
    if (act === 'retry-read') { loadBase(); return true; }
    if (!d) return true;
    if (act === 'mark') {
      if (d.state === 'none') {
        ins.ask = { jobId: jobId, kind: 'none' };
        ins.msg = null;
        paintSched();
        refocus('[data-dpc-install="cancel"]');
      } else confirmInstall(jobId, true);
    } else if (act === 'go') confirmInstall(jobId, true);
    else if (act === 'clear-ask') {
      ins.ask = { jobId: jobId, kind: 'clear' };
      ins.msg = null;
      paintSched();
      refocus('[data-dpc-install="keep"]');
    } else if (act === 'clear-go') confirmInstall(jobId, false);
    else if (act === 'cancel' || act === 'keep') {
      ins.ask = null;
      paintSched();
      refocus(act === 'keep' ? '[data-dpc-install="clear-ask"]' : '[data-dpc-install="mark"]');
    } else if (act === 'retry') {
      var m = ins.msg && ins.msg.jobId === jobId ? ins.msg.retry : null;
      if (typeof m === 'boolean') confirmInstall(jobId, m);
    }
    return true;
  }

  // The Schedule section's presses, and a thread's Mark delivery confirmed.
  // True when the press was one of them. Only Mark sighted, Clear, Save, Clear
  // (a hand-set date) and Retry send anything; opening and cancelling a line
  // writes nothing.
  function onDelivClick(t) {
    var jobId = state.jobId;
    var d = state.deliv;
    var paintBoth = function () { paintSched(); paintMail(); };
    if (t.getAttribute('data-dpc-toggle') === 'sched') {
      d.open = !d.open;
      writeStore('localStorage', LS_SCHED, d.open ? '1' : '0');
      if (d.edit && d.edit.via === 'deliveries') d.edit = null;
      d.ask = null;
      state.install.ask = null;
      paintSched();
      refocus('[data-dpc-toggle="sched"]');
      return true;
    }
    if (t.hasAttribute('data-dpc-deliv-cal')) {
      // The Calendar tab's own call, once: the calendar opens as it was left.
      if (typeof global.showView === 'function') global.showView('calendar');
      return true;
    }
    var poId = t.getAttribute('data-dpc-deliv-po') || t.getAttribute('data-dpc-deliv-sight') || t.getAttribute('data-dpc-deliv-confirm') || '';
    if (t.hasAttribute('data-dpc-deliv-sight')) {
      if (jobId) markSighted(jobId, poId, true);
    } else if (t.hasAttribute('data-dpc-deliv-unsight')) {
      var u = t.getAttribute('data-dpc-deliv-unsight');
      if (!jobId) return true;
      if (u === 'ask') {
        d.ask = { jobId: jobId, poId: poId };
        d.edit = null;
        d.msg = null;
        paintBoth();
        refocus('[data-dpc-deliv-unsight="keep"]');
      } else if (u === 'keep') {
        d.ask = null;
        paintSched();
        refocus('[data-dpc-deliv-unsight="ask"][data-dpc-deliv-po="' + poId + '"]');
      } else if (u === 'go') {
        markSighted(jobId, poId, false);
      }
    } else if (t.hasAttribute('data-dpc-deliv-confirm') || t.hasAttribute('data-dpc-deliv-thread')) {
      if (!jobId) return true;
      openConfirmedLine(jobId, poId, t.hasAttribute('data-dpc-deliv-thread') ? 'thread' : 'deliveries', t.getAttribute('data-dpc-deliv-thread'));
      paintBoth();
      refocus('[data-dpc-deliv-edit-date]');
    } else if (t.hasAttribute('data-dpc-deliv-edit')) {
      var ed = d.edit;
      var act = t.getAttribute('data-dpc-deliv-edit');
      if (!ed) return true;
      if (act === 'save') { if (wholeDay(ed.date)) saveConfirmed(ed.date); }
      else if (act === 'clear') saveConfirmed(null);
      else if (act === 'retry') saveConfirmed(ed.last);
      else if (act === 'cancel') {
        d.edit = null;
        paintBoth();
        refocus(ed.via === 'thread' ? '[data-dpc-deliv-thread="' + ed.key + '"]' : '[data-dpc-deliv-confirm="' + ed.poId + '"]');
      }
    } else if (t.hasAttribute('data-dpc-deliv-retry')) {
      if (!jobId) return true;
      if (t.getAttribute('data-dpc-deliv-retry') === 'read') {
        var e = matEntry(jobId);
        readMat(jobId, !!e && e.status === 'ok');
      } else {
        var m = d.msg && d.msg.jobId === jobId ? d.msg.retry : null;
        if (m && m.kind === 'expected') setExpected(jobId, m.poId, m.value);
        else if (m && m.kind === 'sight') markSighted(jobId, m.poId, m.value);
      }
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
    } else if (t.hasAttribute('data-dpc-mail-link')) {
      var m = mailEntry(state.jobId);
      if (!m) return;
      var key = t.getAttribute('data-dpc-mail-link');
      m.link[key] = t.value;
      var btn = region('mail') && region('mail').querySelector('[data-dpc-mail="link"][data-dpc-mail-key="' + key + '"]');
      if (btn) btn.disabled = !t.value || !!m.busy['link:' + key];
    }
  }

  // The expected date box is saved when it is left or Enter is pressed, never
  // while a segment is still being typed. A box only part filled is not a date
  // and is never sent; an emptied box clears the date.
  function commitExpected(jobId, t) {
    var poId = t.getAttribute('data-dpc-deliv-expected');
    var v = text(t.value);
    if ((!v && t.validity && t.validity.badInput) || (v && !wholeDay(v))) {
      delete state.deliv.typed[poId];
      var r = delivRow(matEntry(jobId), poId);
      t.value = r ? wholeDay(r.delivery.expected) : '';
      if (t.parentNode && t.parentNode.classList) t.parentNode.classList.toggle('dpc-deliv-blank', !t.value);
      return;
    }
    setExpected(jobId, poId, v || null);
  }

  function onKeyDown(e) {
    var t = e.target;
    if (e.key !== 'Enter' || !t || !t.hasAttribute || !state.jobId || !t.hasAttribute('data-dpc-deliv-expected')) return;
    e.preventDefault();
    commitExpected(state.jobId, t);
  }

  // A cell or the pad is saved when it is left. A repaint that takes the
  // focused cell away is not the person leaving it.
  function onFocusOut(e) {
    var t = e.target;
    if (painting || !t || !t.hasAttribute || !state.jobId) return;
    var jobId = state.jobId;
    if (t.hasAttribute('data-dpc-mat-cell')) {
      var id = t.getAttribute('data-dpc-mat-line');
      setTimeout(function () { saveLine(jobId, id); }, 0);
    } else if (t.hasAttribute('data-dpc-mat-pad')) {
      saveText(jobId);
    } else if (t.hasAttribute('data-dpc-mail-subject') || t.hasAttribute('data-dpc-mail-body')) {
      var draftId = t.getAttribute('data-dpc-mail-subject') || t.getAttribute('data-dpc-mail-body');
      setTimeout(function () { saveDraft(jobId, draftId); }, 0);
    } else if (t.hasAttribute('data-dpc-deliv-expected')) {
      commitExpected(jobId, t);
    }
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
    if (t.hasAttribute('data-dpc-deliv-edit-date') || t.hasAttribute('data-dpc-deliv-expected')) {
      var wrap = t.parentNode;
      if (wrap && wrap.classList) wrap.classList.toggle('dpc-deliv-blank', !t.value);
      if (t.hasAttribute('data-dpc-deliv-expected') && state.jobId && !(!t.value && t.validity && t.validity.badInput)) {
        var poId = t.getAttribute('data-dpc-deliv-expected');
        var dr = delivRow(matEntry(state.jobId), poId);
        if (dr && (dr.delivery.expected || '') === t.value) delete state.deliv.typed[poId];
        else state.deliv.typed[poId] = t.value;
      }
      if (t.hasAttribute('data-dpc-deliv-edit-date') && state.deliv.edit) {
        state.deliv.edit.date = t.value;
        var line = t.closest('.dpc-deliv-edit');
        var saveBtn = line && line.querySelector('[data-dpc-deliv-edit="save"]');
        if (saveBtn) saveBtn.disabled = !!state.deliv.edit.busy || !wholeDay(t.value);
      }
      return;
    }
    if ((t.hasAttribute('data-dpc-mail-subject') || t.hasAttribute('data-dpc-mail-body')) && state.jobId) {
      var mm = mailEntry(state.jobId);
      var draftId = t.getAttribute('data-dpc-mail-subject') || t.getAttribute('data-dpc-mail-body');
      if (!mm) return;
      var ed = mm.edits[draftId] || (mm.edits[draftId] = {});
      ed[t.hasAttribute('data-dpc-mail-subject') ? 'subject' : 'body'] = t.value;
      paintSendState(state.jobId);
      return;
    }
    if (t.hasAttribute('data-dpc-mail-reply') && state.jobId) {
      var mr = mailEntry(state.jobId);
      var tk = t.getAttribute('data-dpc-mail-reply');
      if (!mr) return;
      mr.replies[tk] = t.value;
      var rb = region('mail') && region('mail').querySelector('[data-dpc-mail="reply"][data-dpc-mail-key="' + tk + '"]');
      if (rb) rb.disabled = !t.value.trim() || !!mr.busy['reply:' + tk];
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
      r.addEventListener('change', onChange);
      r.addEventListener('focusout', onFocusOut);
      r.addEventListener('keydown', onKeyDown);
      r.addEventListener('toggle', onToggle, true);
      wired = true;
    }
    if (!r.firstChild) render();
    loadBase();
  }

  global.OpsDispatch = { show: show };
})(window);
