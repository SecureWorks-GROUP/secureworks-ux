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
 * is copied to the customer's contact notes. The other writes are the ones
 * named below, each on a person's press.
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
 * +61489267771, when a person presses Send and then Send text on the "Text
 * this to the client?" line; it never resends on its own.
 *
 * Dispatch v2 (slices 2 and 3 of the v2 build) replaces the v1 To do list
 * and six-stop Dispatch stage. The list reads pipeline with dispatch=1,
 * board=v2 and view=active or view=archive, and draws only each row's board
 * block (the v1 dispatch_stage / dispatch_todo fields and todo_total are
 * ignored). Active lists accepted jobs in folding stage sections in pipeline
 * order (Order Materials to Scheduled; repairs: Materials and Scheduled);
 * Archive lists jobs that left Scheduled in the last 30 days, and a search of
 * Archive finds older ones. The header rail shows the job's real pipeline
 * stage. A press on a stop asks "Move SWF-x to <Stage>?" and only Move
 * writes, through the same action the Ops Dash uses: update_job_status with
 * expected_statuses [the stage shown] and source 'dispatch' (compare and set:
 * a job moved meanwhile is not written), or update_repair_stage for a repair.
 * set_dispatch_stage and set_dispatch_install_confirmed are never called.
 * The next-step line still saves with set_dispatch_next_step (job_id, text).
 *
 * v2 slice 7 draws the Arrival line: a thin line under each list card from the
 * row's board.arrival, and the full line in the open job from ops-api
 * dispatch_arrival (read only, once per job open). v2 slice 8 adds Supplier
 * replies to the job (dispatch_v2_replies, read only) and the Unmatched
 * supplier emails tray (dispatch_v2_replies_unmatched, read only). Its six
 * presses, each sent once on a person's press: dispatch_v2_replies_confirm_guess,
 * _reject_guess, _assign, _hide, dispatch_v2_suggestion_accept and
 * _dismiss. Accept saves the supplier's delivery date on the supplier box and
 * never moves the job: when its answer offers a stage move, the rail's own
 * confirm line asks first.
 *
 * v2 slices 5 and 6 are Materials, under Scope and notes (never on a
 * make-safe job). They replace v1's Materials by supplier, purchase orders,
 * Emails and Deliveries screens: v2 has no purchase orders. On top is the
 * Draft list (typed, or filled from the scope, with photos); under it one
 * box per supplier, and lines are dragged between them (or moved with each
 * line's Move to box, which works on a phone). Each box makes one held order
 * email at a time, From admin@secureworkswa.com.au, with To and CC from the
 * app-kept approved list (never suppliers.email). A supplier with no approved
 * order email can hold lines, but its sending is blocked. On a fencing job the
 * main supplier's email ends with the two standing lines.
 *   Reads: ops-api dispatch_v2_materials once per job open and once after a
 * write that changes the boxes; dispatch_v2_supplier_search for Add
 * supplier; dispatch_v2_photo_url only when a photo is pressed. The list's
 * materials_lines_total / materials_lines_ready draw "x of y items ready".
 *   Writes, each sent once on a person's press or on leaving a box they
 * changed: dispatch_v2_save_line, _move_line, _delete_line, _suggest_draft,
 * _add_supplier, _remove_supplier, _set_main_supplier, _upload_photo,
 * _move_photo, _delete_photo, _make_email, _save_email, _discard_email and
 * dispatch_v2_send_email. Only the send sends, and only from the Send button
 * inside the confirm ("Send this order to <Supplier>?"). A TEST copy to
 * admin@ is optional (Shaun's ruling, 23 Oct): Send now is open straight
 * away, still behind its confirm. A send that may have gone is sent again only with confirm_resend
 * after a person checked admin@ Sent Items; one that went but was not noted
 * is never offered again. Never called: create_po, update_po, email_po,
 * push_po_to_xero, send-po-email, update_supplier_email and sync_suppliers,
 * nor any v1 dispatch_order_* action, nor any v1 dispatch_materials_* or
 * dispatch_delivery_* action other than the kept ones below.
 *
 * Deliveries and install keeps v1's table for purchase orders made outside
 * Dispatch (dispatch_delivery_set_expected, _set_confirmed, _mark_sighted;
 * the working out pad keeps dispatch_materials_save_workings). Under it, the
 * supplier boxes ordered by email, from the Arrival line's answer. Their
 * delivery date can be set, confirmed, changed or cleared by hand (Shaun's
 * ruling, 23 Oct: "we can tweak delivery dates manually", for example when a
 * supplier confirms by phone) through ops-api dispatch_v2_set_delivery_date,
 * sent once on Save or Clear, never on opening the line, typing or Cancel.
 * A date set by hand replaces the supplier's reply date and never moves the
 * job. Its answer redraws the Arrival line; the list is then read again.
 *
 * Material stages (Shaun and Marnin, 27 Oct 2026): each supplier box shows
 * where its order is at (Order materials, Sent to supplier, Quote received,
 * Awaiting payment, Order confirmed, Manufacturing, Materials ready,
 * Delivered), worked out from its emails and lines until a person picks one.
 * A pick sends ops-api dispatch_v2_set_material_stage once, guarded on the
 * stamp the box showed; it never moves the job and sends nothing. The list
 * now runs to In Progress and Rectification (extras are ordered there): an
 * on-site job with nothing open draws a short card. Each card says what is
 * waiting on us ("On us ..."), an order made on or after the install day is
 * tagged Extra, and the Waiting on us button keeps only those jobs.
 *
 * Delivery or pickup (Shaun, 29 Oct 2026): each supplier box picks Delivery
 * or Pickup next to its date by Make email (the box's own value, else
 * Delivery). It goes to dispatch_v2_make_email as fulfilment, on a rebuild
 * too; a pickup email opens "for pickup:" and has no Address line. The
 * server reads it back from the email's opening line, so the date reads
 * "Pickup date", the Arrival line says "Pickup Mon 2/11" and the boxes under
 * Deliveries say Pickup date. A reply suggestion shows the server's own
 * label ("Lysaght: pickup Mon 2 Nov"). With a server that does not send
 * fulfilment yet, everything reads Delivery as before.
 *
 * The Install section (v2 slice 7) shows the install day from the board and
 * who is booked from the list row's dispatch_install. It has no write: Mark
 * confirmed is gone. It makes, moves, locks or confirms no booking (never
 * create_assignment, update_assignment, confirm_assignment or bulk_confirm).
 * Open Calendar calls the page's own showView('calendar'), the same as the
 * Calendar tab.
 *
 * Guards: tests/e2e/ops-tab-set.spec.js (slice 1),
 * tests/e2e/ops-dispatch-panel.spec.js (slice 2),
 * tests/e2e/ops-dispatch-v2.spec.js (the v2 list, rail, Arrival line and
 * supplier replies), tests/e2e/ops-dispatch-v2-materials.spec.js (v2
 * Materials and the order emails) and tests/e2e/ops-dispatch-v2-restored.spec.js
 * (the kept v1 parts and the box delivery dates set by hand).
 * Contracts: secureworks-backend docs/dispatch-slice-1-read-contract.md, and
 * the Dispatch v2 contracts (board, replies, and supplier order emails on the
 * be-dispatch-supplier-order-emails branch).
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
  // Which list is showing: Active or Archive. (v1 kept To do / All jobs under
  // sw_dispatch_mode; that key is no longer read.)
  var LS_MODE = 'sw_dispatch_view';
  var LS_FOLDS = 'sw_dispatch_folds'; // the stage sections folded shut
  // The board's stages, used only when an answer's board summary has none. The
  // live list always sends them (board.stages), in pipeline order.
  var BOARD_STAGES = {
    pipeline: [
      { key: 'order_materials', label: 'Order Materials' },
      { key: 'awaiting_supplier', label: 'Awaiting Supplier' },
      { key: 'order_confirmed', label: 'Order Confirmed' },
      { key: 'schedule_install', label: 'Schedule Install' },
      { key: 'scheduled', label: 'Scheduled' },
      { key: 'in_progress', label: 'In Progress' },
      { key: 'rectification', label: 'Rectification' }
    ],
    repairs: [
      { key: 'materials', label: 'Materials' },
      { key: 'scheduled', label: 'Scheduled' }
    ]
  };
  var NEXT_STEP_MAX = 40;
  var LS_ORDER = 'sw_dispatch_order_open';
  var LS_SCHED = 'sw_dispatch_sched_open';
  // The Working out pad folded open or shut, and the Emails panel open or shut.
  var LS_WORKOUT = 'sw_dispatch_workout_open';
  var LS_MAIL = 'sw_dispatch_mail_open';
  // The pad saves this long after typing stops.
  var WORKOUT_SAVE_MS = 1200;
  // The largest sketch the server takes (characters of its PNG data).
  var MAT_SKETCH_MAX = 400000;
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
  // without one is a failed read (rowsFromBoard), so there is no fallback.
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

  // ── v2 slice 2: the board answer ──

  // The v2 board answer (pipeline with dispatch=1&board=v2): every row in the
  // order the board's stage groups give, and the groups themselves. Throws when
  // the answer carries no v2 board summary or a row has no board object, so the
  // caller shows the failed-read line instead of an old-style list. The v1 row
  // fields (dispatch_stage, dispatch_todo, todo_total and the rest) are never
  // read here: the board decides what is listed and where.
  function rowsFromBoard(resp) {
    var b = resp && typeof resp === 'object' ? resp.board : null;
    if (!b || typeof b !== 'object' || b.version !== 'v2' || !Array.isArray(b.groups) || !resp.columns || typeof resp.columns !== 'object') {
      throw new Error('Job list answer is not the Dispatch v2 board');
    }
    var byId = {};
    Object.keys(resp.columns).forEach(function (col) {
      var list = resp.columns[col];
      if (Array.isArray(list)) list.forEach(function (r) { if (r && typeof r === 'object' && r.id) byId[r.id] = r; });
    });
    Object.keys(byId).forEach(function (id) {
      var r = byId[id];
      if (!boardRowOk(r.board)) throw new Error('Job list answer is missing the board fields');
      // The dispatch=1 row fields are still needed (as in v1): an ops-api
      // without them is a failed read, never a list with gaps. The work type
      // is the row's or the board's, never the stored type.
      if (!text(r.work_type)) r.work_type = text(r.board.work_type);
      if (typeof r.value_inc_gst !== 'boolean' || !('description' in r) || !r.work_type) {
        throw new Error('Job list answer is missing the Dispatch fields');
      }
      // Slice 4's materials_lines_total / materials_lines_ready are only real
      // when the list's materials read worked; a failed one is never 0 of 0.
      if (resp.dispatch_materials !== 'ok') { delete r.materials_lines_total; delete r.materials_lines_ready; }
      // The rail's sightings counts, the same way.
      if (resp.dispatch_deliveries !== 'ok') { delete r.deliveries_orders_total; delete r.deliveries_orders_sighted; }
      // Who is booked (names only; the day comes from the board).
      if (resp.dispatch_installs !== 'ok') delete r.dispatch_install;
    });
    var used = {};
    var groups = b.groups.map(function (g) {
      var ids = g && Array.isArray(g.job_ids) ? g.job_ids : [];
      var rows = ids.map(function (id) { return byId[id]; }).filter(function (r) {
        if (!r || used[r.id]) return false;
        used[r.id] = true;
        return true;
      });
      return { key: text(g && g.key), track: text(g && g.track), label: text(g && g.label) || keyWords(g && g.key), rows: rows };
    });
    // A row no group names is still listed, never hidden.
    var rest = Object.keys(byId).filter(function (id) { return !used[id]; }).map(function (id) { return byId[id]; });
    if (rest.length) groups.push({ key: 'other', track: 'other', label: 'Other', rows: rest });
    var rows = [];
    groups.forEach(function (g) { rows.push.apply(rows, g.rows); });
    var reads = b.reads && typeof b.reads === 'object' ? b.reads : {};
    return {
      rows: rows,
      groups: groups,
      total: typeof b.total === 'number' ? b.total : rows.length,
      stages: b.stages && typeof b.stages === 'object' ? b.stages : null,
      archiveDays: typeof b.archive_days === 'number' ? b.archive_days : 30,
      failedReads: READ_NAMES.filter(function (r) { return reads[r.key] === 'failed'; }).map(function (r) { return r.words; }),
      degraded: resp.degraded === true
    };
  }

  // The side reads the board makes, in the words the list's notice uses.
  var READ_NAMES = [
    { key: 'installs', words: 'install bookings' },
    { key: 'days_in_stage', words: 'days in stage' },
    { key: 'deposits', words: 'deposits' },
    { key: 'arrival', words: 'Arrival lines' }
  ];

  function boardRowOk(b) {
    return !!b && typeof b === 'object' && (b.track === 'pipeline' || b.track === 'repairs') && typeof b.stage_key === 'string' && !!b.stage_key &&
      typeof b.title === 'string' && (b.stage_phase === 'window' || b.stage_phase === 'after');
  }

  // A row's board object, or null when the row did not come from the v2 board.
  function boardOf(row) { return row && boardRowOk(row.board) ? row.board : null; }

  // "SWF-xxxxx · Full Name" as the board writes it.
  function cardTitle(row) {
    var b = boardOf(row);
    return (b && text(b.title)) || jobTitle(row);
  }

  // A key in words, for a stage the page has no label for.
  function keyWords(key) { return text(key).replace(/_/g, ' ') || 'not recorded'; }

  // Whole days from one calendar day to another.
  function dayNum(p) { return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000); }

  // "3 days in stage", or '' when the events read gave no count.
  function daysText(b) {
    var n = b && b.days_in_stage;
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
    if (n < 1) return 'In stage since today';
    return Math.floor(n) + (Math.floor(n) === 1 ? ' day' : ' days') + ' in stage';
  }

  // The install day in words. long adds the last day of a run of days and
  // "tentative". A failed bookings read is never "Not booked".
  function installWords(b, long) {
    var ins = b && b.install;
    if (!ins || typeof ins !== 'object') return 'Install not known';
    if (!ins.booked) return 'Not booked';
    var day = parseDay(ins.day);
    if (!day) return 'Install not known';
    var lead = ins.passed ? 'Install was ' : 'Install ';
    var first = parseDay(ins.first_day), last = parseDay(ins.last_day);
    var w = lead + dayText(day);
    if (long && first && last && text(ins.first_day) !== text(ins.last_day)) w = lead + dayText(first) + ' to ' + dayText(last);
    if (long && ins.tentative === true && !ins.passed) w += ', tentative';
    return w;
  }

  // An archived card's line: "Installed Wed 21/10 · archived 22/10".
  function archiveWords(b) {
    var ins = b && b.install;
    var last = ins ? parseDay(ins.last_day) || parseDay(ins.day) : null;
    var on = ins ? parseDay(ins.archive_on) : null;
    var parts = [];
    if (last) parts.push('Installed ' + dayText(last));
    if (on) parts.push('archived ' + dayMonth(on));
    if (b.stage_phase === 'after') parts.push('Ops Dash: ' + (text(b.stage_label) || keyWords(b.stage_key)));
    return parts.join(' · ') || 'Install not known';
  }

  // The red and amber flags, in the order they show. Deposit not paid is never
  // hidden; an unknown deposit (the invoice read failed) is not a red flag.
  function flagsOf(b) {
    var f = b && b.flags && typeof b.flags === 'object' ? b.flags : {};
    var out = [];
    if (f.deposit_not_paid === true) out.push({ tone: 'red', text: 'Deposit not paid' });
    if (f.no_install_booked === true) out.push({ tone: 'amber', text: 'No install booked' });
    if (f.install_date_passed === true) out.push({ tone: 'amber', text: 'Install day passed' });
    return out;
  }

  function flagHtml(f) { return '<span class="dpc-flag dpc-flag-' + f.tone + '">' + esc(f.text) + '</span>'; }

  // ── Material stages and "waiting on us" (backend contract section 3b) ──

  // In Progress and Rectification: the crew has been, extras are ordered
  // there. Their card is short unless an order is still open.
  var ON_SITE_STAGES = { in_progress: true, rectification: true };
  function onSiteStage(b) { return !!b && b.track === 'pipeline' && ON_SITE_STAGES[b.stage_key] === true; }

  // What the job waits on us for, in plain words ([] when nothing).
  function waitingTodo(b) {
    var w = b && b.waiting;
    if (!w || typeof w !== 'object' || w.on_us !== true || !Array.isArray(w.todo)) return [];
    return w.todo.map(text).filter(Boolean);
  }

  // A listed Active job waiting on us (the Waiting on us button keeps these).
  function rowOnUs(row) {
    var b = boardOf(row);
    return !!b && b.view !== 'archive' && !!b.waiting && b.waiting.on_us === true;
  }

  function arrivalCount(a, name) {
    var c = arrivalOk(a) && a.counts && typeof a.counts === 'object' ? a.counts[name] : null;
    return typeof c === 'number' && isFinite(c) ? c : null;
  }

  // "Extra order" / "2 extra orders": ordered on or after the install day and
  // not delivered yet.
  function extraFlag(a) {
    var n = arrivalCount(a, 'extra_open');
    if (!n) return null;
    return { tone: 'extra', text: n === 1 ? 'Extra order' : n + ' extra orders' };
  }

  // The card's "On us" line: the first two things to do, then how many more.
  var ON_US_SHOWN = 2;
  function onUsHtml(todo) {
    if (!todo.length) return '';
    var shown = todo.slice(0, ON_US_SHOWN).join(' · ');
    var more = todo.length > ON_US_SHOWN ? ' (+' + (todo.length - ON_US_SHOWN) + ' more)' : '';
    return '<span class="dpc-onus"><b>On us</b> ' + esc(shown + more) + '</span>';
  }

  // ── v2 slice 3: the header rail's rules ──

  // A track's stages from the latest board answer, else the fixed lists.
  // stages: a board answer's own stages (the job page's read), else the
  // latest the list saw.
  function trackStages(b, stages) {
    var all = stages || state.stagesSeen;
    var seen = all && all[b.track];
    var list = Array.isArray(seen) && seen.length ? seen : (BOARD_STAGES[b.track] || []);
    return list.filter(function (s) { return s && text(s.key); }).map(function (s) { return { key: text(s.key), label: text(s.label) || keyWords(s.key) }; });
  }

  // The stop a press may move the job to, from the board's moves, or null.
  function moveTarget(b, key) {
    var mv = b && b.moves;
    if (!mv || typeof mv !== 'object' || !Array.isArray(mv.targets) || !text(mv.current)) return null;
    if (mv.action !== 'update_job_status' && mv.action !== 'update_repair_stage') return null;
    for (var i = 0; i < mv.targets.length; i++) {
      var t = mv.targets[i];
      if (t && t.key === key && key !== mv.current) return { key: key, label: text(t.label) || keyWords(key), direction: t.direction === 'back' ? 'back' : 'forward' };
    }
    return null;
  }

  // Where a move shows besides Dispatch.
  function moveWhere(b) { return b && b.track === 'repairs' ? 'the Repairs board' : 'the Ops Dash'; }

  // ── v2 slice 7: the Arrival line's rules ──

  var ARR_INSTALL = 80; // the install line sits at 80% of the width
  var ARR_OUT = 92; // anything not in time sits past it

  function arrivalOk(a) { return !!a && typeof a === 'object' && Array.isArray(a.orders) && !!parseDay(a.today); }

  function arrivalLate(o) { return !!o && (o.flag === 'no_date' || o.flag === 'after_install'); }

  // One order's words: "Tue 27/10", "Mon 2/11, not confirmed", "no date yet".
  // A pickup says so first: "Pickup Mon 2/11", "Pickup, no date yet".
  function arrivalWords(o) {
    var words = arrivalDateWords(o);
    if (o.fulfilment !== 'pickup') return words;
    return /^[A-Z]/.test(words) ? 'Pickup ' + words : 'Pickup, ' + words;
  }

  function arrivalDateWords(o) {
    var d = parseDay(o.delivery_date);
    if (o.flag === 'no_date') return 'no date yet';
    if (o.flag === 'after_install') return (d ? dayText(d) + ', ' : '') + 'after the install';
    if (o.flag === 'not_sent') return d ? dayText(d) + ', not sent yet' : 'not sent yet';
    if (!d) return 'no date yet';
    return dayText(d) + (o.mark === 'solid' ? '' : ', not confirmed');
  }

  // solid (ok), ring (wait), red (late), grey ring (draft: not sent, or no date).
  function arrivalClass(o) {
    if (arrivalLate(o)) return 'late';
    if (o.flag === 'not_sent' || !parseDay(o.delivery_date)) return 'draft';
    return o.mark === 'solid' ? 'ok' : 'wait';
  }

  // Places each order on the line: today at 0%, the install day at 80%, an
  // order with no date or arriving after the install past the line at 92%.
  // With nothing booked the line runs to the latest delivery date, or a week.
  // Labels that would sit on top of each other drop to a second row.
  function arrivalPlot(a) {
    var today = parseDay(a.today);
    var inst = parseDay(a.install_day);
    var t0 = dayNum(today);
    var dated = a.orders.map(function (o) { return parseDay(o.delivery_date); }).filter(Boolean).map(dayNum);
    var end = inst ? dayNum(inst) : Math.max.apply(null, [t0 + 7].concat(dated));
    var span = Math.max(1, end - t0);
    var marks = [], outs = [];
    a.orders.forEach(function (o) {
      if (!o || typeof o !== 'object') return;
      var d = parseDay(o.delivery_date);
      var m = { order: o, cls: arrivalClass(o), name: text(o.supplier_name) || 'Supplier', words: arrivalWords(o), row: 0 };
      if (arrivalLate(o) || !d) { m.pct = ARR_OUT; outs.push(m); return; }
      m.pct = Math.max(0, Math.min(ARR_INSTALL, (dayNum(d) - t0) / span * ARR_INSTALL));
      marks.push(m);
    });
    marks.sort(function (x, y) { return x.pct - y.pct; });
    var last = [-100, -100];
    marks.forEach(function (m) {
      // The label of the marker past the line takes the right of row 0.
      var blockedRight = outs.length && m.pct > 64;
      var row = !blockedRight && m.pct - last[0] >= 18 ? 0 : m.pct - last[1] >= 18 ? 1 : (blockedRight ? 1 : 0);
      m.row = row;
      last[row] = m.pct;
    });
    return { today: today, inst: inst, marks: marks, outs: outs, outCls: outs.some(function (m) { return m.cls === 'late'; }) ? 'late' : 'draft' };
  }

  // "2 orders: 1 confirmed, 1 not in time", or "All 3 confirmed in time".
  function arrivalSummary(a) {
    var n = a.orders.length;
    if (!n) return 'No orders yet';
    if (a.all_confirmed_in_time === true) return n === 1 ? 'Confirmed in time' : 'All ' + n + ' confirmed in time';
    var conf = a.orders.filter(function (o) { return o && o.mark === 'solid' && !arrivalLate(o); }).length;
    var late = a.orders.filter(arrivalLate).length;
    var parts = [conf + ' confirmed'];
    if (late) parts.push(late + ' not in time');
    return n + (n === 1 ? ' order: ' : ' orders: ') + parts.join(', ');
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
    // A Scope Engine record reads through the one scope reader (modules/job-scope-record.js).
    var rec = global.JobScopeRecord ? global.JobScopeRecord.read({ type: jobType, scope_json: scope }) : null;
    if (rec && rec.kind === 'engine-patio') {
      var out = [];
      if (rec.revision && rec.revision.n != null) out.push(['Revision', global.JobScopeRecord.revisionWords(rec)]);
      return out.concat(rec.inputs.map(function (f) { return [f.label, f.value]; }));
    }
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

  var INVOICE_STATUS = { PAID: 'Paid (Xero)', AUTHORISED: 'Owed · Approved in Xero', DRAFT: 'Draft in Xero', SUBMITTED: 'Awaiting approval in Xero' };

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

  function matSettable(s) { return MAT_SETTABLE.indexOf(s) >= 0; }

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

  // ── dates typed in a box ──

  // A date box's value worth saving: a whole YYYY-MM-DD in a four-figure year,
  // so a year still being typed (0002, 0020, 0202) is never sent.
  function wholeDay(v) {
    var p = parseDay(v);
    return p && p.y >= 2000 && p.y <= 2099 && /^\d{4}-\d{2}-\d{2}$/.test(text(v)) ? text(v) : '';
  }

  // ── the install row's rules ──

  // The list row's v1 install block (dispatch_install.ts), read only for who
  // is booked: the day itself comes from the board. Null when it is missing or
  // not whole.
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

  // The rail panel's sightings line, from the list row's two counts; '' when
  // the job has no counted order or the counts did not come.
  function deliveriesRailLine(row) {
    var total = row && row.deliveries_orders_total, seen = row && row.deliveries_orders_sighted;
    if (typeof total !== 'number' || typeof seen !== 'number' || !(total > 0)) return '';
    if (seen < total) return seen + ' of ' + total + ' orders sighted on site.';
    return 'Every order on this job is sighted on site.';
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

  // One view's board read before it lands, or after it failed.
  function emptyView() {
    return { status: 'idle', rows: [], groups: [], total: null, stages: null, archiveDays: 30, failedReads: [], degraded: false, q: '', view: 'active' };
  }

  // The folded stage sections, kept per browser: { group key: true }.
  function readFolds() {
    try {
      var v = JSON.parse(readStore('localStorage', LS_FOLDS) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }

  function tabKey(v) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].key === v) return v;
    return 'sources';
  }

  function readStore(store, key) { try { return global[store].getItem(key); } catch (e) { return null; } }
  function writeStore(store, key, value) { try { global[store].setItem(key, value); } catch (e) { /* private mode */ } }

  var state = {
    type: 'all',
    // The Waiting on us button: Active lists only the jobs waiting on us.
    onUs: false,
    search: '',
    leftOpen: readStore('localStorage', LS_LEFT) !== '0',
    scopeOpen: readStore('localStorage', LS_SCOPE) !== '0',
    // v2: each view's own board read (Active and Archive), and a search of
    // the view that is showing. found.view says which view it searched.
    base: emptyView(),
    arch: emptyView(),
    found: emptyView(),
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
    // v2 slices 2 and 3: which list is showing (opens on Active), the stage
    // sections folded shut, the latest board's stage lists, and the rail's
    // press state: the one open confirm line ({ jobId, to, label, offer }),
    // the move in flight, the last answer's line, and the next-step box per job.
    mode: readStore('localStorage', LS_MODE) === 'archive' ? 'archive' : 'active',
    folds: readFolds(),
    stagesSeen: null,
    stage: { confirm: null, moving: null, msg: null, drafts: {}, saving: {}, nextMsg: {} },
    // v2 slice 7: each open job's dispatch_arrival read, kept for the session.
    arrival: {},
    // v2 slice 8: each job's supplier replies read and its presses, and the
    // Unmatched supplier emails tray.
    rep: { jobs: {}, tray: { open: false, status: 'idle', data: null, other: false, busy: {}, msg: null, pick: {}, hideAsk: null } },
    // Slice 4: the client text's "Text this to the client?" line, per job.
    smsAsk: {},
    // v2 slices 5 and 6, Materials: jobs[jobId] holds that job's
    // dispatch_v2_materials read and everything typed and not yet saved, so
    // any repaint draws it back. find is Add supplier's search, modal the one
    // open send confirm, drag the line being dragged, and unrecorded the
    // emails that went but could not be noted (never offered again).
    v2m: {
      open: readStore('localStorage', LS_ORDER) !== '0',
      jobs: {},
      find: { open: false, q: '', status: 'idle', data: null, token: 0, timer: null },
      modal: null,
      drag: null,
      unrecorded: {}
    },
    // The Install section, folded or open (kept per browser).
    sched: { open: readStore('localStorage', LS_SCHED) !== '0' },
    // Kept from v1: the dispatch_materials read per job (working out pad,
    // purchase orders, Deliveries), and the pad folded open or shut.
    old: { jobs: {}, workOpen: readStore('localStorage', LS_WORKOUT) === '1', pdf: {} },
    // The Deliveries table: the row being saved, its message, the date being
    // edited, the confirm question open, and what was typed in a date box.
    deliv: { busy: {}, msg: null, edit: null, ask: null, typed: {}, boxEdit: null, boxMsg: null },
    // The Emails panel: open or shut, and the email picked on each job.
    mail: { open: readStore('localStorage', LS_MAIL) !== '0', sel: {} }
  };
  var tokens = { active: 0, archive: 0, found: 0, fill: 0 };
  var searchTimer = null;
  var photoUrls = [];

  function root() { return document.getElementById(ROOT_ID); }
  function region(name) { var r = root(); return r ? r.querySelector('[data-dpc-region="' + name + '"]') : null; }
  function searching() { return state.search.trim() !== ''; }

  // The view that is showing: a search of it while the search box has words.
  function viewData(view) { return view === 'archive' ? state.arch : state.base; }
  function current() { return searching() ? state.found : viewData(state.mode); }

  // The listed rows of the view that is showing, through the work type buttons.
  function listedRows() { return narrowRows(current().rows); }

  // Through the work type buttons, and on Active the Waiting on us button.
  function onUsFiltering() { return state.onUs && state.mode === 'active'; }
  function narrowRows(rows) {
    var out = filterByType(rows, state.type);
    return onUsFiltering() ? out.filter(rowOnUs) : out;
  }

  function listFailed() { return current().status === 'error'; }

  // ───────────────────────── reads ─────────────────────────

  // One board read of a view ('active' or 'archive'). Each view keeps its own
  // answer, so a failed Archive read never empties Active.
  function loadView(view) {
    var token = ++tokens[view];
    var cur = viewData(view);
    if (cur.status !== 'ok') {
      cur.status = 'loading';
      if (view === state.mode && !searching()) paintList();
      if (view === 'active') paintWorkspace();
    }
    return Promise.resolve().then(function () { return global.opsFetch('pipeline', { dispatch: 1, board: 'v2', view: view }); }).then(function (resp) {
      if (token !== tokens[view]) return;
      var got = rowsFromBoard(resp);
      var next = Object.assign(emptyView(), got, { status: 'ok' });
      if (got.stages) state.stagesSeen = got.stages;
      if (view === 'archive') {
        state.arch = next;
        refreshOpenRow();
        paintList(true);
        return;
      }
      state.base = next;
      adoptSelection();
    }).catch(function () {
      if (token !== tokens[view]) return;
      if (view === 'archive') {
        state.arch = Object.assign(emptyView(), { status: 'error' });
        paintList();
        return;
      }
      state.base = Object.assign(emptyView(), { status: 'error' });
      state.rowStale = true;
      paintList();
      paintWorkspace();
      paintContext();
    });
  }

  function loadBase() { return loadView('active'); }

  // After an Archive read: the open job's header facts from the new row.
  function refreshOpenRow() {
    var r = state.jobId ? rowById(state.jobId) : null;
    if (r && r !== state.row) { state.row = r; paintHead(); }
  }

  // After an Active read: keep the open job if it is still known, else open
  // the one remembered for this session, else the first Active job. An open
  // job keeps its sections as drawn: only the list, the header, the Council
  // line and the install row (the facts the list carries) are redrawn, so
  // typing and the list's place are kept.
  function adoptSelection() {
    state.rowStale = false;
    var now = state.jobId ? rowById(state.jobId) : null;
    if (now) state.row = now;
    paintList(true);
    if (state.jobId && state.row) { paintHead(); paintCouncil(); paintSched(); return; }
    var pick = rowById(readStore('sessionStorage', SS_JOB)) || state.base.rows[0] || null;
    if (pick) selectJob(pick); else { paintWorkspace(); paintContext(); }
  }

  // A search of the view that is showing. In Archive it finds every archived
  // job, however old.
  function runSearch() {
    var q = state.search.trim();
    var view = state.mode;
    var token = ++tokens.found;
    if (!q) { state.found = emptyView(); paintList(); return; }
    state.found = Object.assign(emptyView(), { status: 'loading', q: q, view: view });
    paintList();
    Promise.resolve().then(function () { return global.opsFetch('pipeline', { dispatch: 1, board: 'v2', view: view, search: q }); }).then(function (resp) {
      if (token !== tokens.found) return;
      var got = rowsFromBoard(resp);
      if (got.stages) state.stagesSeen = got.stages;
      state.found = Object.assign(emptyView(), got, { status: 'ok', q: q, view: view });
      paintList();
    }).catch(function () {
      if (token !== tokens.found) return;
      state.found = Object.assign(emptyView(), { status: 'error', q: q, view: view });
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
    if (!same) v2Leave();
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
    loadV2(row);
    loadArrival(row);
    loadReplies(row);
    loadOld(row);
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
    state.smsAsk[jobId] = false;
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

  // ── v2 slice 3 writes: moving the job, and the next-step line ──

  // Puts what a write answered onto every copy of the job's row (Active,
  // Archive, the search and the open job), so the card and the rail redraw at
  // once. Only when the merged row still reads as a whole board row.
  function applyStageFields(jobId, fields) {
    var merge = function (r) { return r && r.id === jobId ? Object.assign({}, r, fields) : r; };
    var next = merge(rowById(jobId) || state.row);
    if (!next || next.id !== jobId || !boardOf(next)) return;
    [state.base, state.arch, state.found].forEach(function (v) {
      v.rows = v.rows.map(merge);
      v.groups = v.groups.map(function (g) { return Object.assign({}, g, { rows: g.rows.map(merge) }); });
    });
    if (state.row && state.row.id === jobId) state.row = merge(state.row);
  }

  // One move per confirmed press, through the same action the Ops Dash (or the
  // Repairs board) uses, so the GHL stage and the manager texts follow as they
  // do there. A pipeline move is compare-and-set against the stage the screen
  // showed (expected_statuses): if the job moved meanwhile nothing is written.
  // The rail is locked while the move is in flight and nothing is re-sent on
  // its own. c is the confirm line: { jobId, to, label, offer }, where offer
  // is a supplier reply's stage-move offer ({ from_status }).
  function moveStage(c) {
    var row = state.row;
    var b = boardOf(row);
    if (!c || !b || row.id !== c.jobId || state.stage.moving) return;
    var body, action;
    if (c.offer) {
      action = 'update_job_status';
      body = { jobId: c.jobId, status: c.to, expected_statuses: [c.offer.from_status], source: 'dispatch' };
    } else {
      if (!moveTarget(b, c.to)) return;
      action = b.moves.action;
      body = action === 'update_repair_stage'
        ? { jobId: c.jobId, stage: c.to }
        : { jobId: c.jobId, status: c.to, expected_statuses: [b.moves.current], source: 'dispatch' };
    }
    var jobId = c.jobId;
    state.stage.moving = jobId;
    state.stage.msg = null;
    paintTape();
    Promise.resolve().then(function () { return global.opsPost(action, body); }).then(function (resp) {
      state.stage.moving = null;
      state.stage.confirm = null;
      if (resp && resp.success === false && resp.skipped === 'status_changed') {
        state.stage.msg = { jobId: jobId, kind: 'changed', text: 'This job moved somewhere else. Showing the latest.' };
        paintTape();
        loadBase();
        return;
      }
      if (!resp || resp.success !== true) throw new Error('Unexpected move answer');
      state.stage.msg = { jobId: jobId, kind: 'ok', text: 'Moved to ' + c.label + '.' };
      paintTape();
      loadBase();
      if (state.arch.status !== 'idle') loadView('archive');
    }).catch(function () {
      state.stage.moving = null;
      state.stage.confirm = null;
      state.stage.msg = { jobId: jobId, kind: 'fail', text: 'Not moved. The job is still in ' + (text(b.stage_label) || keyWords(b.stage_key)) + '.', retry: c };
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
  // The line is a note on the card only: it moves nothing.
  function saveNextStep() {
    var jobId = state.jobId;
    var row = state.row;
    if (!jobId || !row || row.id !== jobId || !boardOf(row) || state.stage.saving[jobId] || nextUnchanged(jobId, row)) return;
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

  // ── v2 slice 7: the job's full Arrival line ──
  // dispatch_arrival writes nothing. Read once per job open and once after a
  // delivery date is accepted; until it lands (or if it fails) the list row's
  // own Arrival line is drawn.
  function loadArrival(row) {
    if (!row || !row.id || isMakesafe(row)) return;
    var jobId = row.id;
    var entry = { status: 'loading', data: null };
    state.arrival[jobId] = entry;
    paintArrival();
    Promise.resolve().then(function () { return global.opsFetch('dispatch_arrival', { job_id: jobId }); }).then(function (resp) {
      if (state.arrival[jobId] !== entry) return;
      if (!resp || typeof resp !== 'object' || resp.job_id !== jobId) throw new Error('Unexpected arrival answer');
      state.arrival[jobId] = { status: 'ok', data: resp };
      paintArrival();
    }).catch(function () {
      if (state.arrival[jobId] !== entry) return;
      state.arrival[jobId] = { status: 'error', data: null };
      paintArrival();
    });
  }

  // The Arrival line to draw: the job's own read when it worked, else the list
  // row's, else nothing (loading, or failed).
  function arrivalFor(row) {
    var e = state.arrival[row.id];
    if (e && e.status === 'ok' && e.data.arrival_read !== 'failed' && arrivalOk(e.data.arrival)) return { arrival: e.data.arrival };
    var b = boardOf(row);
    if (b && arrivalOk(b.arrival)) return { arrival: b.arrival };
    return { arrival: null, loading: !e || e.status === 'loading' };
  }

  // ── v2 slice 8: supplier replies and suggested delivery dates ──
  // Two reads, each writing nothing: dispatch_v2_replies once per job open
  // (and once after each press on it), and dispatch_v2_replies_unmatched once
  // each time the tab is shown (and after each tray press). Six presses, each
  // sent once on a person's press, never on their own: confirm_guess,
  // reject_guess, assign, hide, suggestion_accept and suggestion_dismiss.
  // Accept saves the supplier's delivery date on the supplier box and moves no
  // stage: when its answer offers a stage move, the rail's own confirm line
  // asks first, and only Move sends update_job_status.

  var REP_ACTIONS = {
    confirm: 'dispatch_v2_replies_confirm_guess',
    reject: 'dispatch_v2_replies_reject_guess',
    assign: 'dispatch_v2_replies_assign',
    hide: 'dispatch_v2_replies_hide',
    accept: 'dispatch_v2_suggestion_accept',
    dismiss: 'dispatch_v2_suggestion_dismiss'
  };

  function isObj(v) { return !!v && typeof v === 'object'; }

  function repEntry(jobId) { return (jobId && state.rep.jobs[jobId]) || null; }

  function repliesFrom(resp) {
    if (!isObj(resp) || resp.ok !== true || !Array.isArray(resp.emails) || !Array.isArray(resp.suggestions)) throw new Error('Unexpected replies answer');
    return {
      emails: resp.emails.filter(function (m) { return isObj(m) && m.id; }),
      suggestions: resp.suggestions.filter(function (s) { return isObj(s) && s.id; }),
      orders: Array.isArray(resp.orders) ? resp.orders.filter(function (o) { return isObj(o) && o.order_id; }) : [],
      ordersWired: resp.orders_wired !== false,
      scan: isObj(resp.scan) ? resp.scan : null
    };
  }

  function loadReplies(row) {
    if (!row || !row.id || isMakesafe(row)) return;
    state.rep.jobs[row.id] = { status: 'loading', data: null, busy: {}, msg: {}, pick: {} };
    readReplies(row.id, false);
  }

  // quiet keeps what is drawn until the new answer lands.
  function readReplies(jobId, quiet) {
    var e = repEntry(jobId);
    if (!e) return;
    var token = e.token = {};
    if (!quiet || e.status !== 'ok') { e.status = 'loading'; paintRepIf(jobId); }
    Promise.resolve().then(function () { return global.opsFetch('dispatch_v2_replies', { job_id: jobId }); }).then(function (resp) {
      if (e.token !== token || state.rep.jobs[jobId] !== e) return;
      e.data = repliesFrom(resp);
      e.status = 'ok';
      paintRepIf(jobId);
    }).catch(function () {
      if (e.token !== token || state.rep.jobs[jobId] !== e) return;
      e.status = 'error';
      paintRepIf(jobId);
    });
  }

  // A refusal in plain words. changed: re-read, the screen was out of date.
  function repWords(err) {
    var code = err && err.code;
    if (['email_changed', 'suggestion_changed', 'suggestion_not_open', 'not_a_best_guess', 'not_unmatched'].indexOf(code) >= 0) {
      return { changed: true, text: 'This changed somewhere else. Showing the latest.' };
    }
    if (code === 'order_required') return { changed: true, text: 'Pick the order this date is for, then press Accept again.' };
    if (code === 'order_not_on_job' || code === 'order_mismatch') return { changed: true, text: 'That order is not on this job any more. Showing the latest.' };
    if (code === 'orders_not_wired') return { text: 'Supplier orders are not switched on yet, so a delivery date cannot be saved.' };
    if (code === 'supplier_box_not_found' || code === 'order_has_no_supplier_box') return { text: "That order's supplier box is no longer on the job, so the date was not saved." };
    if (code === 'job_not_found') return { changed: true, text: 'That job was not found. Showing the latest.' };
    return null;
  }

  function repDoneWords(kind, resp) {
    if (kind === 'confirm') return 'Put on this job.';
    if (kind === 'reject') return 'Sent back to the Unmatched supplier emails tray.';
    if (kind === 'hide') return 'Hidden from the tray. The email stays in admin@.';
    if (kind === 'dismiss') return 'Dismissed. No date was saved.';
    if (kind === 'assign') return 'Put on ' + (text(resp && resp.job_number) || 'the job') + '.';
    var o = resp && resp.order;
    var d = o && parseDay(o.confirmed_delivery_date);
    return 'Delivery date saved' + (o && text(o.supplier_name) ? ': ' + text(o.supplier_name) : '') + (d ? ', ' + dayText(d) : '') + '.';
  }

  // ── The payment hold on Accept (backend contract section 3c, piece B) ──
  // Accept saves a supplier's date, but a pay-first box stays at Awaiting
  // payment until someone presses Mark paid, and the job-wide "Move to Order
  // Confirmed?" offer is withheld while any pay-first box on the job is
  // unpaid. An older server sends none of these fields: today's behaviour.

  // True when the job's move must not be offered after an Accept: the answer
  // says so, or the job's own reads already did.
  function acceptHeld(jobId, resp) {
    if (resp && (resp.payment_hold === true || isObj(resp.stage_move_held))) return true;
    return jobPayHold(jobId);
  }

  // Whether the job is held by an unpaid pay-first box, from its Arrival read
  // or its list row. False when the server does not say (an older server).
  function jobPayHold(jobId) {
    var e = state.arrival[jobId];
    if (e && e.status === 'ok' && e.data && e.data.payment_hold === true) return true;
    var b = boardOf(rowById(jobId));
    if (b && b.payment_hold === true) return true;
    var a = b && isObj(b.arrival) ? b.arrival : null;
    return !!(a && isObj(a.payment) && a.payment.any_unpaid === true);
  }

  // The payment words after an Accept's "Delivery date saved" line.
  function acceptPayWords(resp) {
    if (!isObj(resp)) return '';
    var out = '';
    var name = (isObj(resp.order) && text(resp.order.supplier_name)) || 'This supplier';
    if (isObj(resp.box_payment) && resp.box_payment.holds_stage === true) out += ' ' + name + ' stays at Awaiting payment until someone presses Mark paid.';
    var held = resp.stage_move_held;
    if (isObj(held)) {
      var names = Array.isArray(held.suppliers) ? held.suppliers.map(text).filter(Boolean) : [];
      if (held.reason === 'payment_unknown') out += ' The job is not offered a move to Order Confirmed: the payments could not be checked.';
      else out += ' The job is not offered a move to Order Confirmed while ' + (names.length ? listWords(names) + (names.length === 1 ? ' is' : ' are') : 'a supplier is') + ' not paid.';
    }
    return out;
  }

  // "A", "A and B", "A, B and C".
  function listWords(names) {
    if (names.length < 2) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  // The supplier box a suggested date is for, as its Arrival line order: by
  // the suggestion's order (or the order picked, or the email's), through the
  // replies read's orders, else by the supplier's name. Null when unknown.
  function sugBoxOrder(e, s) {
    var a = state.row ? arrivalFor(state.row).arrival : null;
    if (!a) return null;
    var oid = text(s.order_id) || text(e.pick[s.id]);
    if (!oid) {
      var m = e.data.emails.filter(function (x) { return x.id === s.email_id; })[0];
      oid = m ? text(m.order_id) : '';
    }
    var ro = oid ? e.data.orders.filter(function (o) { return o.order_id === oid; })[0] : null;
    var sid = ro ? text(ro.supplier_id) : '';
    var name = (ro && text(ro.supplier_name)) || text(s.supplier_name);
    for (var i = 0; i < a.orders.length; i++) {
      var o = a.orders[i];
      if (!o || o.source !== 'supplier_box') continue;
      if (sid ? String(o.supplier_id) === sid : name && text(o.supplier_name) === name) return o;
    }
    return null;
  }

  // The note under Accept: as today, unless the box is pay first, unpaid and
  // still before Order confirmed (a later stage set by hand keeps today's).
  function sugFootWords(e, s) {
    var o = sugBoxOrder(e, s);
    var p = o ? v2PayFrom(o.payment) : null;
    var at = o ? v2StageAt(o.material_stage) : -1;
    if (!p || p.state !== 'unpaid' || at < 0 || at >= v2StageAt('order_confirmed')) return 'Accept saves this date on the supplier box. It does not move the job.';
    return 'Accept saves this ' + (o.fulfilment === 'pickup' ? 'pickup' : 'delivery') + ' date. ' + (text(o.supplier_name) || 'This supplier') +
      ' stays at Awaiting payment until someone presses Mark paid.';
  }

  var REP_NOT_DONE = {
    confirm: 'Not put on the job.', reject: 'Not sent back.', hide: 'Not hidden.',
    dismiss: 'Not dismissed.', assign: 'Not put on the job.', accept: 'Delivery date not saved.'
  };

  // A stage's label, from the latest board answer, for a stage-move offer.
  function pipelineLabel(key) {
    var list = trackStages({ track: 'pipeline' });
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].label;
    return keyWords(key);
  }

  // One press on a supplier reply in the job's Emails panel. id is the email's id (confirm,
  // reject) or the suggestion's (accept, dismiss).
  function repPress(jobId, kind, id, extra) {
    var e = repEntry(jobId);
    if (!e || !id || e.busy[id] || !REP_ACTIONS[kind]) return;
    e.busy[id] = kind;
    e.msg[id] = null;
    paintRepIf(jobId);
    var body = kind === 'accept' || kind === 'dismiss' ? { suggestion_id: id } : { email_id: id };
    if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    Promise.resolve().then(function () { return global.opsPost(REP_ACTIONS[kind], body); }).then(function (resp) {
      if (!resp || resp.ok !== true) throw new Error('Unexpected answer');
      delete e.busy[id];
      e.msg[id] = { ok: true, text: repDoneWords(kind, resp) + (kind === 'accept' ? acceptPayWords(resp) : '') };
      readReplies(jobId, true);
      if (kind === 'confirm' || kind === 'reject') trayReread();
      if (kind !== 'accept') return;
      // Read before the Arrival line is read again below.
      var held = acceptHeld(jobId, resp);
      // The date is on the supplier box now: redraw the Arrival line and the list.
      if (state.row && state.row.id === jobId) loadArrival(state.row);
      loadBase();
      var offer = resp.stage_move_offer;
      // Never offered while a pay-first box is unpaid (piece B): that move
      // texts the fencing or patio manager, so it must wait for the payment.
      if (!held && isObj(offer) && offer.job_id === jobId && text(offer.to_status) && text(offer.from_status) && state.jobId === jobId) {
        state.stage.confirm = { jobId: jobId, to: text(offer.to_status), label: pipelineLabel(text(offer.to_status)), offer: { from_status: text(offer.from_status) } };
        state.stage.msg = null;
        paintTape();
        refocus('[data-dpc-stage-go]');
      }
    }, function (err) {
      delete e.busy[id];
      var w = repWords(err);
      e.msg[id] = { ok: false, text: w ? w.text : REP_NOT_DONE[kind], retry: w ? null : { kind: kind, extra: extra || null } };
      if (w && w.changed) readReplies(jobId, true); else paintRepIf(jobId);
    });
  }

  // ── the Unmatched supplier emails tray ──

  function loadTray() {
    var t = state.rep.tray;
    var token = t.token = {};
    if (t.status !== 'ok') t.status = 'loading';
    paintTray();
    Promise.resolve().then(function () {
      return global.opsFetch('dispatch_v2_replies_unmatched', t.other ? { include_other: 1 } : {});
    }).then(function (resp) {
      if (t.token !== token) return;
      if (!isObj(resp) || resp.ok !== true || !Array.isArray(resp.emails)) throw new Error('Unexpected tray answer');
      t.data = { emails: resp.emails.filter(function (m) { return isObj(m) && m.id; }), counts: isObj(resp.counts) ? resp.counts : {} };
      t.status = 'ok';
      paintTray();
    }).catch(function () {
      if (t.token !== token) return;
      t.status = 'error';
      t.data = null;
      paintTray();
    });
  }

  // After a press elsewhere that can change the tray, only when it was read.
  function trayReread() { if (state.rep.tray.status !== 'idle') loadTray(); }

  // One press in the tray, on one email.
  function trayPress(kind, emailId, extra) {
    var t = state.rep.tray;
    if (!emailId || t.busy[emailId] || !REP_ACTIONS[kind]) return;
    t.busy[emailId] = kind;
    t.msg = null;
    paintTray();
    var body = { email_id: emailId };
    if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    Promise.resolve().then(function () { return global.opsPost(REP_ACTIONS[kind], body); }).then(function (resp) {
      if (!resp || resp.ok !== true) throw new Error('Unexpected answer');
      delete t.busy[emailId];
      t.hideAsk = null;
      t.msg = { ok: true, text: repDoneWords(kind, resp) };
      loadTray();
      var jobId = (extra && extra.job_id) || (resp.email && resp.email.job_id) || null;
      if (jobId && state.jobId === jobId && repEntry(jobId)) readReplies(jobId, true);
    }, function (err) {
      delete t.busy[emailId];
      var w = repWords(err);
      t.msg = { ok: false, text: w ? w.text : REP_NOT_DONE[kind] };
      if (w && w.changed) loadTray(); else paintTray();
    });
  }

  // Make-safe jobs have no Materials, Arrival line or Install section.
  function isMakesafe(row) { return typeKey(row) === 'makesafe'; }

  // ───────────────────────── render: sidebar ─────────────────────────

  function failLine(message, retry, tight) {
    return '<div class="dpc-empty' + (tight ? ' dpc-empty-tight' : '') + '" role="alert">' + esc(message) +
      ' <button type="button" class="dpc-retry" data-dpc-retry="' + retry + '">Retry</button></div>';
  }

  // A list card (approved mock m02): type and next step, "SWF-xxxxx · Full
  // Name", suburb and what the job is, days in stage and the install day (an
  // archived card: when it was installed and archived), the red and amber
  // flags, and the thin Arrival line.
  //
  // In Progress and Rectification with no open order and nothing on us draw
  // short: type, title, and one line (days in stage and the install day).
  function cardHtml(row) {
    var b = boardOf(row);
    var k = typeKey(row);
    var archived = !!b && b.view === 'archive';
    var todo = b && !archived ? waitingTodo(b) : [];
    var compact = !archived && onSiteStage(b) && arrivalCount(b.arrival, 'open') === 0 && !todo.length;
    var h = '<button type="button" class="dpc-job' + (archived ? ' dpc-job-archived' : '') + (compact ? ' dpc-job-compact' : '') + '" data-dpc-job="' + esc(row.id) + '" aria-pressed="' + (row.id === state.jobId) + '">';
    var next = text(row.dispatch_next_step);
    h += '<span class="dpc-job-top"><span class="dpc-type' + (k ? ' dpc-type-' + k : '') + '">' + esc(typeLabel(row)) + '</span>' +
      (next ? '<span class="dpc-next">' + esc(next) + '</span>' : '') + '</span>';
    h += '<strong>' + esc(cardTitle(row)) + '</strong>';
    if (compact) {
      var short = [b ? text(b.suburb) : text(row.site_suburb), daysText(b), installWords(b)].filter(Boolean).join(' · ');
      if (short) h += '<span class="dpc-muted">' + esc(short) + '</span>';
      var cflags = flagsOf(b);
      if (cflags.length) h += '<span class="dpc-flags">' + cflags.map(flagHtml).join('') + '</span>';
      return h + '</button>';
    }
    var sub = [b ? text(b.suburb) : text(row.site_suburb), text(row.description)].filter(Boolean).join(' · ');
    if (sub) h += '<span>' + esc(sub) + '</span>';
    // Items ready (slice 4, kept from v1), days in stage and the install day.
    var ready = readyText(row.materials_lines_total, row.materials_lines_ready);
    var meta = !b ? '' : archived ? archiveWords(b) : [ready, daysText(b), installWords(b)].filter(Boolean).join(' · ');
    if (meta) h += '<span class="dpc-muted">' + esc(meta) + '</span>';
    var flags = b ? flagsOf(b) : [];
    var extra = b && !archived ? extraFlag(b.arrival) : null;
    if (extra) flags.push(extra);
    if (flags.length) h += '<span class="dpc-flags">' + flags.map(flagHtml).join('') + '</span>';
    h += onUsHtml(todo);
    if (b && !archived) h += arrivalThinHtml(b.arrival);
    return h + '</button>';
  }

  // The card's Arrival line: one thin line, a dot per order. Its words are for
  // screen readers; the full line is in the open job.
  function arrivalThinHtml(a) {
    if (!arrivalOk(a) || !a.orders.length) return '';
    var p = arrivalPlot(a);
    var h = '<span class="dpc-arrthin" aria-hidden="true"><span class="dpc-arrthin-rail"></span>';
    if (p.inst) h += '<span class="dpc-arrthin-inst"></span>';
    p.marks.forEach(function (m) { h += '<i class="dpc-arrthin-dot ' + m.cls + '" style="left:' + m.pct.toFixed(1) + '%"></i>'; });
    if (p.outs.length) h += '<i class="dpc-arrthin-dot ' + p.outCls + '" style="left:' + ARR_OUT + '%"></i>';
    return h + '</span><span class="dpc-vh">Arrival: ' + esc(arrivalSummary(a)) + '.</span>';
  }

  function railHtml(row, labels) {
    var k = typeKey(row);
    return '<button type="button" class="dpc-rail-job' + (k ? ' dpc-rail-' + k : '') + '" data-dpc-job="' + esc(row.id) + '" aria-pressed="' + (row.id === state.jobId) +
      '" title="' + esc(cardTitle(row)) + '" aria-label="' + esc(cardTitle(row)) + '">' + esc(labels[row.id]) + '</button>';
  }

  // The whole strip is always drawn, never capped: the first buttons at once
  // and the rest over the next frames, so a long list does not stall the tab.
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

  function retryKey() { return searching() ? 'search' : state.mode === 'archive' ? 'archive' : 'list'; }

  // What the list area says when it is not showing jobs, or '' when it is.
  function listState() {
    var from = current();
    var archive = state.mode === 'archive';
    if (from.status === 'error') return failLine(searching() ? 'Search failed.' : archive ? 'Could not load the archive.' : 'Could not load jobs.', retryKey());
    if (from.status !== 'ok') return '<div class="dpc-empty">' + (searching() ? 'Searching...' : 'Loading jobs...') + '</div>';
    if (listedRows().length) return '';
    var kind = state.type === 'all' ? '' : (TYPE_LABELS[state.type] || state.type).toLowerCase() + ' ';
    if (searching()) return '<div class="dpc-empty">No ' + (archive ? 'archived ' : '') + 'jobs match.</div>';
    if (onUsFiltering()) return '<div class="dpc-empty">No ' + esc(kind) + 'jobs are waiting on us.</div>';
    if (archive) return '<div class="dpc-empty">No ' + esc(kind) + 'jobs archived in the last ' + esc(from.archiveDays) + ' days.</div>';
    if (kind) return '<div class="dpc-empty">No ' + esc(kind) + 'jobs.</div>';
    // Active with no jobs at all: says so, and still shows its stage
    // sections, each at 0 (paintList draws them under this line).
    return '';
  }

  // A read beside the board's own (bookings, days in stage, deposits, Arrival)
  // failed: the jobs are all listed, and the list says what is missing.
  function listNotice() {
    var from = current();
    if (from.status !== 'ok') return '';
    var missing = from.failedReads.slice();
    if (!missing.length && !from.degraded) return '';
    var what = missing.length ? 'Some details did not load: ' + missing.join(', ') + '.' : 'Some job details did not load.';
    return failLine(what, retryKey());
  }

  // The stage sections (approved mock m02 and m07): each a folding header with
  // its count, in pipeline order. An empty section shows its header at 0 while
  // nothing narrows the list, and is left out of a search or a type.
  function groupsHtml() {
    var from = current();
    var narrowed = searching() || state.type !== 'all' || onUsFiltering();
    var h = '';
    from.groups.forEach(function (g) {
      var rows = narrowRows(g.rows);
      if (!rows.length && narrowed) return;
      var archive = g.key === 'archive';
      var label = archive ? 'Dispatch archive' : g.label;
      var folded = !!state.folds[g.key];
      h += '<div class="dpc-grp" data-dpc-grp="' + esc(g.key) + '">';
      var inner = '<span class="dpc-grp-name">' + esc(label) + '</span><span class="dpc-grp-count">' + rows.length + '</span><span class="dpc-grow dpc-grp-rule"></span>';
      if (rows.length) {
        h += '<button type="button" class="dpc-grp-head" data-dpc-fold="' + esc(g.key) + '" aria-expanded="' + !folded + '" aria-label="' + esc(label + ', ' + rows.length + (rows.length === 1 ? ' job' : ' jobs')) + '">' +
          inner + '<span class="dpc-grp-chev">' + CHEV_SMALL + '</span></button>';
      } else {
        h += '<div class="dpc-grp-head dpc-grp-empty">' + inner + '</div>';
      }
      if (archive) h += '<span class="dpc-grp-sub">' + esc(searching() ? 'Every archived job that matches, newest first' : 'Last ' + from.archiveDays + ' days, newest first') + '</span>';
      if (rows.length && !folded) h += '<div class="dpc-grp-body">' + rows.map(cardHtml).join('') + '</div>';
      h += '</div>';
    });
    return h;
  }

  // The two list buttons, each with its view's count once read.
  function modeHtml() {
    var count = function (v) { return v.status === 'ok' ? ' <b>' + esc(v.total) + '</b>' : ''; };
    return '<button type="button" data-dpc-mode="active" aria-pressed="' + (state.mode === 'active') + '">Active' + count(state.base) + '</button>' +
      '<button type="button" data-dpc-mode="archive" aria-pressed="' + (state.mode === 'archive') + '">Archive' + count(state.arch) + '</button>';
  }

  // The Waiting on us button (Active only), with how many listed jobs wait on
  // us through the work type buttons.
  function onUsBtnHtml() {
    if (state.mode !== 'active') return '';
    var from = current();
    var n = from.status === 'ok' ? filterByType(from.rows, state.type).filter(rowOnUs).length : null;
    return '<button type="button" data-dpc-onus aria-pressed="' + state.onUs + '">Waiting on us' + (n === null ? '' : ' <b>' + n + '</b>') + '</button>';
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
    h += '<div class="dpc-chips dpc-onus-row" data-dpc-region="onus">' + onUsBtnHtml() + '</div>';
    h += '<input type="search" class="dpc-search" data-dpc-search placeholder="Search job, suburb or client" value="' + esc(state.search) + '" aria-label="Search jobs">';
    h += '</div><div class="dpc-job-list" data-dpc-region="list"></div>';
    h += '<div class="dpc-foot">Active: accepted jobs in pipeline order, from Order Materials to Rectification. Archive: jobs that left Scheduled in the last 30 days.</div>';
    return h + '</aside>';
  }

  // Repaints the list (or the strip's buttons) without touching the search
  // box, so typing is never interrupted. keepPlace puts the list back where it
  // was scrolled to.
  function paintList(keepPlace) {
    var list = region('list');
    if (!list) return;
    tokens.fill++;
    var drawn = keepPlace ? list.querySelectorAll('[data-dpc-job]').length : 0;
    var top = list.scrollTop;
    var a = list.contains(document.activeElement) ? document.activeElement : null;
    var focused = a ? (a.hasAttribute('data-dpc-job') ? '[data-dpc-job="' + a.getAttribute('data-dpc-job') + '"]' : a.hasAttribute('data-dpc-fold') ? '[data-dpc-fold="' + a.getAttribute('data-dpc-fold') + '"]' : null) : null;
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
    var onus = region('onus');
    if (onus && onus.innerHTML !== onUsBtnHtml()) {
      var hadOnUs = onus.contains(document.activeElement);
      onus.innerHTML = onUsBtnHtml();
      var ob = onus.querySelector('[data-dpc-onus]');
      if (hadOnUs && ob) ob.focus();
    }
    var stateHtml = listState();
    var rows = stateHtml ? [] : listedRows();
    if (!state.leftOpen) {
      var head = region('railhead');
      if (head) {
        var from = current();
        var failText = searching() ? 'Search failed. Retry' : state.mode === 'archive' ? 'Could not load the archive. Retry' : 'Could not load jobs. Retry';
        head.innerHTML = listFailed()
          ? '<button type="button" class="dpc-side-btn" data-dpc-retry="' + retryKey() + '" aria-label="' + failText + '" title="' + failText + '">&#8635;</button>'
          : from.status === 'ok' ? '<span class="dpc-rail-count" title="Jobs listed">' + rows.length + '</span>' : '';
      }
      list.innerHTML = '';
      if (rows.length) { var labels = railLabels(rows); fill(list, rows, function (row) { return railHtml(row, labels); }, drawn); }
      if (focused) { var f = list.querySelector(focused); if (f) f.focus({ preventScroll: true }); }
      if (keepPlace) list.scrollTop = top;
      return;
    }
    var none = !rows.length && state.mode === 'active' ? '<div class="dpc-empty">No jobs to show.</div>' : '';
    list.innerHTML = stateHtml || (listNotice() + none + groupsHtml());
    if (focused) { var el = list.querySelector(focused); if (el) el.focus({ preventScroll: true }); }
    if (keepPlace) list.scrollTop = top;
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

  // The job header: "SWF-xxxxx · Full Name", the price, suburb and what the
  // job is, the facts as pills (with the red and amber flags), the rail, the
  // Arrival line, and a line pointing at any delivery date waiting below.
  function headHtml(row) {
    var b = boardOf(row);
    var price = priceText(row);
    var k = typeKey(row);
    var h = '<div class="dpc-jobhead" data-dpc-region="head"><div class="dpc-row"><h2 class="dpc-grow">' + esc(cardTitle(row)) + '</h2>';
    h += price
      ? '<span class="dpc-price">' + esc(price) + (row.value_inc_gst === true ? ' <small>inc GST</small>' : '') + '</span>'
      : '<span class="dpc-price-none">No price on record</span>';
    h += '</div>';
    var sub = [b ? text(b.suburb) : text(row.site_suburb), text(row.description)].filter(Boolean).join(' · ');
    if (sub) h += '<p>' + esc(sub) + '</p>';
    h += '<div class="dpc-pills"><span class="dpc-type' + (k ? ' dpc-type-' + k : '') + '">' + esc(typeLabel(row)) + '</span>';
    h += '<span class="dpc-pill">' + esc(b ? installWords(b, true) : 'Install not known') + '</span>';
    var days = daysText(b);
    if (days) h += '<span class="dpc-pill">' + esc(days) + '</span>';
    var ready = isMakesafe(row) ? '' : readyText(row.materials_lines_total, row.materials_lines_ready);
    if (ready) h += '<span class="dpc-pill">' + esc(ready) + '</span>';
    if (b) h += flagsOf(b).map(flagHtml).join('');
    // An unknown deposit (the invoice read failed) is said, never shown as paid or not paid.
    if (b && b.deposit && b.deposit.state === 'unknown') h += '<span class="dpc-flag dpc-flag-grey">Deposit not checked</span>';
    h += '</div>' + tapeHtml(row) + arrivalHtml(row) + sugNoteHtml(row);
    return h + '</div>';
  }

  function tapeNote(words, attrs) {
    return '<p class="dpc-empty dpc-empty-tight dpc-tape-note"' + (attrs || '') + '>' + esc(words) + '</p>';
  }

  // The header rail (approved mock m03, m04 and m06): the job's real pipeline
  // stages (repairs: the Repairs board's Materials and Scheduled). Only a stop
  // the board says the job can move to can be pressed; a press opens the
  // confirm line, and only Move writes. Backwards moves ask the same way.
  function tapeHtml(row) {
    if (typeKey(row) === 'makesafe') return '';
    var b = boardOf(row);
    var h = '<div class="dpc-tape" data-dpc-region="tape"';
    if (!b) return h + '>' + failLine("Could not load this job's stage.", 'list', true) + '</div>';
    var jobId = row.id;
    var repairs = b.track === 'repairs';
    var where = moveWhere(b);
    var stops = trackStages(b);
    var now = 0;
    stops.forEach(function (st, i) { if (st.key === b.stage_key) now = i + 1; });
    var label = text(b.stage_label) || keyWords(b.stage_key);
    var busy = !!state.stage.moving;
    var confirm = state.stage.confirm && state.stage.confirm.jobId === jobId ? state.stage.confirm : null;
    var kind = repairs ? 'Repairs stage' : 'Pipeline stage';
    h += ' role="group" aria-label="' + esc(kind + ': ' + label) + '"><div class="dpc-tape-meta"><span>' + kind + '</span><strong>' + esc(label) + '</strong>';
    h += '<span class="dpc-grow"></span>' + (now ? '<span>' + now + ' of ' + stops.length + '</span>' : '') + '</div>';
    if (b.stage_phase === 'after' || !now) {
      h += tapeNote('Moved past Scheduled on ' + where + '. Dispatch does not move it from here.');
    } else {
      var last = Math.max(1, stops.length - 1);
      h += '<div class="dpc-tape-track">';
      if (now > 1) h += '<div class="dpc-tape-fill" style="width:' + ((now - 1) / last * 100) + '%"></div>';
      h += '</div><ol class="dpc-tape-stops">';
      stops.forEach(function (st, i) {
        var n = i + 1;
        var cls = n < now ? 'done' : n === now ? 'now' : '';
        var can = !!moveTarget(b, st.key);
        h += '<li class="' + cls + '" style="left:' + (i / last * 100) + '%"><button type="button" class="dpc-tape-stop" data-dpc-stage="' + esc(st.key) + '"' +
          (n === now ? ' aria-current="step"' : '') + (busy || !can ? ' disabled' : '') + '>' +
          '<span class="dpc-tape-mark' + (cls ? ' ' + cls : '') + '" aria-hidden="true"></span><span class="dpc-tape-label">' + esc(st.label) + '</span></button></li>';
      });
      h += '</ol>';
      h += tapeNote(repairs ? 'Same as the Repairs board. Moving here moves the job there too.' : 'Same as the Ops Dash pipeline. Moving here moves the job there too.');
      if (!b.moves) h += tapeNote('This job cannot be moved from Dispatch.');
    }
    var sightings = deliveriesRailLine(row);
    if (sightings) h += tapeNote(sightings, ' data-dpc-deliv-rail');
    if (confirm) {
      var num = text(b.job_number) || text(row.job_number) || 'this job';
      var ask = 'Move ' + num + ' to ' + confirm.label + '? It moves on ' + where + ' too.';
      if (confirm.offer) ask = 'The supplier confirmed the delivery. ' + ask;
      // Move still works with nothing booked; the line says so.
      if (confirm.to === 'scheduled' && b.install && b.install.booked === false) ask += ' No install is booked on this job.';
      h += '<div class="dpc-tape-confirm" role="group" aria-label="Confirm the move"><span class="dpc-empty dpc-empty-tight dpc-grow">' + esc(ask) + '</span>';
      h += '<button type="button" class="dpc-primary" data-dpc-stage-go' + (busy ? ' disabled' : '') + '>' + (busy ? 'Moving...' : 'Move') + '</button>';
      h += '<button type="button" data-dpc-stage-cancel' + (busy ? ' disabled' : '') + '>' + (confirm.offer ? 'Not now' : 'Cancel') + '</button></div>';
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

  // ── v2 slice 7: the full Arrival line in the open job ──
  // The approved page's .arr: today at the left, the install line at 80%, each
  // supplier order on its delivery date. Solid green = the supplier confirmed
  // the date; amber ring = a date, not confirmed; red past the install line =
  // no date yet, or arriving after the install; grey ring = not sent yet.
  // A narrow screen hides the labels and lists the orders under the line.
  function arrivalHtml(row) {
    if (!row || isMakesafe(row)) return '';
    var got = arrivalFor(row);
    var a = got.arrival;
    var h = '<div class="dpc-arrival" data-dpc-region="arrival"><div class="dpc-arr-head"><span class="dpc-arr-title">Arrival line</span>' +
      '<span class="dpc-arr-q">Will it all be on site before the install?</span>';
    if (a && a.orders.length) h += '<span class="dpc-arr-count' + (a.all_confirmed_in_time === true ? ' ok' : a.orders.some(arrivalLate) ? ' late' : '') + '">' + esc(arrivalSummary(a)) + '</span>';
    h += '</div>';
    if (!a) {
      return h + (got.loading ? '<p class="dpc-empty dpc-empty-tight">Reading the orders...</p>' : failLine('Could not load the Arrival line.', 'arrival', true)) + '</div>';
    }
    if (!a.orders.length) return h + '<p class="dpc-empty dpc-empty-tight">No supplier orders on this job yet.</p></div>';
    var p = arrivalPlot(a);
    var two = p.marks.some(function (m) { return m.row === 1; });
    // A payment pill under a marker needs a little more room below the line.
    var pays = a.orders.some(function (o) { return !!arrMarkPayHtml(o); });
    h += '<div class="dpc-arr-wrap"><div class="dpc-arr' + (two ? ' dpc-arr-two' : '') + (pays ? ' dpc-arr-pays' : '') + '"><span class="dpc-arr-rail"></span>';
    h += '<span class="dpc-arr-tod">Today ' + esc(dayText(p.today)) + '</span>';
    h += p.inst ? '<span class="dpc-arr-inst"><span>Install ' + esc(dayText(p.inst)) + '</span></span>' : '<span class="dpc-arr-noinst">No install booked</span>';
    p.marks.forEach(function (m) {
      var edge = m.pct < 7 ? ' dpc-arr-edge' : '';
      h += '<span class="dpc-arr-mk ' + m.cls + (m.row ? ' dpc-arr-r1' : '') + edge + '" style="left:' + m.pct.toFixed(1) + '%"><i></i><b>' + esc(m.name) + '</b><small>' + esc(m.words) + '</small>' + arrMarkPayHtml(m.order) + '</span>';
    });
    if (p.outs.length) {
      var one = p.outs.length === 1 ? p.outs[0] : null;
      h += '<span class="dpc-arr-mk dpc-arr-out ' + p.outCls + '"><i></i><b>' + esc(one ? one.name : p.outs.length + ' orders') + '</b><small>' + esc(one ? one.words : 'not on the line') + '</small>' + (one ? arrMarkPayHtml(one.order) : '') + '</span>';
    }
    h += '</div><ul class="dpc-arr-list' + (p.outs.length > 1 ? ' dpc-arr-list-outs' : '') + '">';
    p.marks.concat(p.outs).forEach(function (m) {
      h += '<li class="' + (p.outs.indexOf(m) >= 0 ? 'out' : 'on') + '"><i class="dpc-arr-dot ' + m.cls + '"></i><b>' + esc(m.name) + '</b> ' + esc(m.words) + arrStageHtml(m.order) + arrPayHtml(m.order) + '</li>';
    });
    h += '</ul></div>';
    h += '<p class="dpc-arr-legend"><b class="ok">Solid</b> = supplier confirmed the date. <b class="wait">Ring</b> = date expected, not confirmed. <b class="late">Past the install line</b> = no date, or arriving too late.</p>';
    return h + '</div>';
  }

  // An order's material stage on the full Arrival line: "· Awaiting payment,
  // on us: Pay Metroll", and Extra for an order made once the crew was on site.
  function arrStageHtml(o) {
    if (!o || !text(o.material_stage_label)) return '';
    var h = ' <span class="dpc-arr-stage">· ' + esc(o.material_stage_label);
    if (o.waiting_on === 'us' && text(o.todo)) h += ', on us: ' + esc(o.todo);
    h += '</span>';
    if (o.extra === true) h += ' <span class="dpc-flag dpc-flag-extra">Extra</span>';
    return h;
  }

  // An order's payment pill on the full Arrival line (piece B).
  function arrPayHtml(o) {
    var pill = o ? payPillHtml(v2PayFrom(o.payment)) : '';
    return pill ? ' ' + pill : '';
  }

  // The payment pill under an order's marker on the Arrival line itself
  // (the list under the line is for narrow screens).
  function arrMarkPayHtml(o) {
    var pill = o ? payPillHtml(v2PayFrom(o.payment)) : '';
    return pill ? '<span class="dpc-arr-pay">' + pill + '</span>' : '';
  }

  function paintArrival() {
    var el = region('arrival');
    if (el && state.row) el.outerHTML = arrivalHtml(state.row);
    // The Deliveries table lists the supplier boxes from the same answer.
    var sched = region('sched');
    if (sched && state.row && !sched.contains(document.activeElement)) paintSched();
  }

  // Under the Arrival line: how many supplier delivery dates wait for Accept
  // or Dismiss in the Emails panel, with a button that goes to them.
  function sugNoteHtml(row) {
    var e = row ? repEntry(row.id) : null;
    var open = e && e.status === 'ok' ? e.data.suggestions.filter(function (s) { return s.state === 'open'; }) : [];
    var guesses = e && e.status === 'ok' ? e.data.emails.filter(function (m) { return m.state === 'needs_confirmation'; }) : [];
    var h = '<div data-dpc-region="sugnote">';
    if (open.length || guesses.length) {
      var parts = [];
      if (open.length) parts.push(open.length === 1 ? '1 supplier delivery date to check' : open.length + ' supplier delivery dates to check');
      if (guesses.length) parts.push(guesses.length === 1 ? '1 best guess email to confirm' : guesses.length + ' best guess emails to confirm');
      h += '<div class="dpc-sugnote" role="status"><span class="dpc-grow">' + esc(parts.join(', ') + '.') + '</span><button type="button" data-dpc-rep-goto>Show in Emails</button></div>';
    }
    return h + '</div>';
  }

  function paintSugNote() {
    var el = region('sugnote');
    if (el && state.row) el.outerHTML = sugNoteHtml(state.row);
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
      h += '<div data-dpc-region="composer">' + composerHtml() + '</div>';
      h += workoutHtml() + '</div>';
    }
    return h + '</div>';
  }

  // ───────────────────────── render: the right panel ─────────────────────────

  function docChip(name, detail, attrs, tag) {
    tag = tag || 'button';
    return '<' + tag + ' class="dpc-doc" ' + attrs + (tag === 'button' ? ' type="button"' : '') + '><span class="dpc-doc-ico" aria-hidden="true">PDF</span>' +
      '<span class="dpc-grow"><strong>' + esc(name) + '</strong><small>' + esc(detail) + '</small></span></' + tag + '>';
  }

  // Sources: quotes and invoices from job_detail, then the job's old purchase
  // orders (if any) from the v1 materials read already made on job open.
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
    // Slice 4: Send only asks. The text goes on "Send text"; while asking,
    // the box is read only so what is sent is what was asked about.
    var asking = !!state.smsAsk[jobId] && !sending;
    var h = '<div class="dpc-compose"><textarea class="dpc-reply" data-dpc-reply placeholder="Reply to client..." aria-label="Reply to client by text"' + (sending ? ' disabled' : '') + (asking ? ' readonly' : '') + '>' + esc(draft) + '</textarea>';
    if (!asking) h += '<button type="button" class="dpc-primary" data-dpc-send' + (sending || !draft.trim() ? ' disabled' : '') + '>' + (sending ? 'Sending...' : 'Send') + '</button>';
    h += '</div>';
    if (asking) {
      h += '<div class="dpc-sms-ask" role="group" aria-label="Confirm the text"><span class="dpc-grow">Text this to the client? It sends from the admin line.</span>' +
        '<button type="button" class="dpc-primary" data-dpc-send-go>Send text</button><button type="button" data-dpc-send-no>Cancel</button></div>';
    }
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

  // ───────────────────────── render: shared marks ─────────────────────────

  var CHEV_SVG = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHEV_SMALL = '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // True while a section is redrawn, so the focus leaving a box that is being
  // replaced is not taken as a person leaving it (which would save it).
  var painting = false;

  // ───────────────────────── kept from v1: the working out pad, Deliveries and old orders ─────────────────────────
  //
  // v2 keeps three parts of the v1 job workspace, working as they were built:
  //   - the Working out and sketch pad, at the foot of Scope and notes;
  //   - the Deliveries table, where a person records what arrived on a
  //     purchase order (expected date, confirmed date, sighted on site);
  //   - the Purchase orders group in Sources, read only.
  // All three come from the v1 read dispatch_materials, read once per job open
  // (never on a make-safe), on Retry, and once after a "changed somewhere
  // else" answer. v2 itself makes no purchase orders; the orders here are ones
  // a job already has. The writes are the pad's dispatch_materials_save_workings
  // and the three v1 delivery writes (dispatch_delivery_set_expected,
  // dispatch_delivery_set_confirmed, dispatch_delivery_mark_sighted), each sent
  // once on a person's edit or press, never retried on their own. None of them
  // touches a v2 line, supplier box or order email.

  function oldEntry(jobId) { return (jobId && state.old.jobs[jobId]) || null; }

  function oldNew(jobId) {
    return {
      jobId: jobId, status: 'loading', token: 0, rereading: false, notice: '', touched: false,
      ordersOk: false, orders: [], deliveries: null,
      w: {
        loaded: false, text: '', textSaved: '', textStamp: null, textBusy: false, textAgain: false, textFailed: false, timer: null,
        sketch: null, sketchSaved: null, sketchStamp: null, sketchBusy: false, sketchAgain: false, sketchFailed: false,
        sketchMsg: '', sketchBroken: false, clearWanted: false
      }
    };
  }

  // An order's delivery block as the server works it out (dispatch_deliveries.ts).
  function delivOk(d) {
    return !!d && typeof d === 'object' && typeof d.step === 'number' && typeof d.expected_editable === 'boolean' &&
      !!d.confirmed && typeof d.confirmed === 'object' && typeof d.confirmed.state === 'string';
  }

  // The deliveries block of dispatch_materials, or null when it is missing or
  // any row is not whole: the table then shows its failed line, never a short
  // or empty table. v1's "not ordered yet" rows are left out: in v2 a supplier
  // box is ordered by email from Materials, not by a purchase order.
  function deliveriesFrom(v) {
    if (!v || typeof v !== 'object' || !Array.isArray(v.rows) || typeof v.counted !== 'number' || typeof v.sighted !== 'number') return null;
    var ok = v.rows.every(function (r) {
      if (!r || typeof r !== 'object') return false;
      if (r.kind === 'not_ordered') return !!r.supplier_id;
      return r.kind === 'order' && !!r.purchase_order_id && delivOk(r.delivery);
    });
    if (!ok) return null;
    return { rows: v.rows.filter(function (r) { return r.kind === 'order'; }), counted: v.counted, sighted: v.sighted, all_sighted: v.all_sighted === true };
  }

  // dispatch_materials' answer, the parts v2 still uses. No workings is a
  // failed read: the pad shows its failed line, never an empty pad.
  function oldFrom(resp) {
    if (!isObj(resp) || !isObj(resp.workings)) throw new Error('Unexpected materials answer');
    var ordersOk = resp.orders_status === 'ok' && Array.isArray(resp.orders);
    return {
      workings: resp.workings,
      ordersOk: ordersOk,
      orders: ordersOk ? resp.orders.filter(isObj) : [],
      deliveries: ordersOk ? deliveriesFrom(resp.deliveries) : null
    };
  }

  // A fresh read over what the screen holds. Pad text typed and not yet saved
  // is kept while the server's copy is the one it was typed over.
  function mergeOld(e, got) {
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

  function loadOld(row) {
    if (!row || !row.id || isMakesafe(row)) return;
    readOld(row.id, false);
  }

  // quiet keeps what is drawn until the new answer lands.
  function readOld(jobId, quiet) {
    var e = oldEntry(jobId) || (state.old.jobs[jobId] = oldNew(jobId));
    var token = ++e.token;
    if (!quiet || e.status !== 'ok') { e.status = 'loading'; if (!quiet) e.notice = ''; }
    paintOldIf(jobId);
    return Promise.resolve().then(function () { return global.opsFetch('dispatch_materials', { job_id: jobId }); }).then(function (resp) {
      if (token !== e.token) return;
      mergeOld(e, oldFrom(resp));
      e.status = 'ok';
      paintOldIf(jobId);
    }).catch(function () {
      if (token !== e.token) return;
      e.status = 'error';
      paintOldIf(jobId);
    });
  }

  // The pad, the Deliveries table and Sources, after the read or a write.
  function paintOldIf(jobId) {
    if (state.jobId !== jobId) return;
    paintWorkout();
    paintSched();
    paintSources();
  }

  // The pad changed somewhere else: say so and show the latest, by one quiet re-read.
  function oldChanged(jobId) {
    var e = oldEntry(jobId);
    if (!e) return;
    e.notice = 'This changed somewhere else. Showing the latest.';
    if (state.jobId === jobId) paintWorkout();
    if (e.rereading) return;
    e.rereading = true;
    readOld(jobId, true).then(function () { e.rereading = false; });
  }

  function oldOk(resp) {
    if (!resp || typeof resp !== 'object' || resp.success !== true) throw new Error('Unexpected answer');
    return resp;
  }

  // ── the working out pad: saved when typing stops, and when the pad is left ──

  function padInput(jobId, value) {
    var e = oldEntry(jobId);
    if (!e || e.status !== 'ok') return;
    e.w.text = value;
    clearTimeout(e.w.timer);
    e.w.timer = setTimeout(function () { saveText(jobId); }, WORKOUT_SAVE_MS);
  }

  function saveText(jobId) {
    var e = oldEntry(jobId);
    if (!e || e.status !== 'ok') return;
    var w = e.w;
    clearTimeout(w.timer);
    w.timer = null;
    if (w.textBusy) { w.textAgain = true; return; }
    if (w.text === w.textSaved) { if (w.textFailed) { w.textFailed = false; paintPadSave(jobId); } return; }
    var sent = w.text;
    w.textBusy = true;
    w.textFailed = false;
    e.touched = true;
    paintPadSave(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_materials_save_workings', { job_id: jobId, working_out: sent, expected_working_out_updated_at: w.textStamp });
    }).then(oldOk).then(function (resp) {
      w.textBusy = false;
      w.textSaved = sent;
      w.textStamp = (resp.workings && resp.workings.working_out_updated_at) || null;
      var again = w.textAgain;
      w.textAgain = false;
      if (again && w.text !== w.textSaved) saveText(jobId); else paintPadSave(jobId);
    }, function (err) {
      w.textBusy = false;
      w.textAgain = false;
      if (err && err.code === 'workings_changed') { oldChanged(jobId); return; }
      w.textFailed = true;
      paintPadSave(jobId);
    });
  }

  // The sketch: saved after each stroke, as the canvas's own PNG.
  function sketchDrawn(jobId, dataUrl) {
    var e = oldEntry(jobId);
    if (!e || e.status !== 'ok') return;
    e.w.sketch = dataUrl;
    e.w.sketchBroken = false;
    e.w.sketchMsg = '';
    e.w.clearWanted = false;
    saveSketch(jobId);
    paintSketchMsg(jobId);
  }

  function clearSketch(jobId) {
    var e = oldEntry(jobId);
    if (!e || e.status !== 'ok') return;
    e.w.sketch = null;
    e.w.sketchBroken = false;
    e.w.sketchMsg = '';
    if (state.jobId === jobId) redrawSketch();
    saveSketch(jobId);
    paintSketchMsg(jobId);
  }

  function saveSketch(jobId) {
    var e = oldEntry(jobId);
    if (!e) return;
    var w = e.w;
    if (w.sketchBusy) { w.sketchAgain = true; return; }
    var sent = w.sketch;
    if (sent === w.sketchSaved) { if (w.sketchFailed) { w.sketchFailed = false; paintPadSave(jobId); } w.clearWanted = false; return; }
    if (sent && sent.length > MAT_SKETCH_MAX) {
      w.sketchMsg = 'Sketch not saved: too large. Clear it and draw again.';
      paintSketchMsg(jobId);
      return;
    }
    w.sketchBusy = true;
    w.sketchFailed = false;
    e.touched = true;
    paintPadSave(jobId);
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_materials_save_workings', { job_id: jobId, sketch_png: sent, expected_sketch_updated_at: w.sketchStamp });
    }).then(oldOk).then(function (resp) {
      w.sketchBusy = false;
      w.sketchSaved = sent;
      w.sketchStamp = (resp.workings && resp.workings.sketch_updated_at) || null;
      w.clearWanted = false;
      var again = w.sketchAgain;
      w.sketchAgain = false;
      if (again && w.sketch !== w.sketchSaved) saveSketch(jobId); else paintPadSave(jobId);
    }, function (err) {
      w.sketchBusy = false;
      w.sketchAgain = false;
      if (err && err.code === 'workings_changed') { oldChanged(jobId); return; }
      if (err && err.status === 400 && sent && /too large|at most/i.test(String(err.message))) {
        w.sketchMsg = 'Sketch not saved: too large. Clear it and draw again.';
      } else {
        w.sketchFailed = true;
        // A failed Clear brings the drawing back; Retry clears it again.
        if (sent === null) { w.clearWanted = true; w.sketch = w.sketchSaved; if (state.jobId === jobId) redrawSketch(); }
      }
      paintPadSave(jobId);
      paintSketchMsg(jobId);
    });
  }

  // The save line's Retry: the pad text and the sketch once more, once each.
  function retryPad(jobId) {
    var e = oldEntry(jobId);
    if (!e) return;
    if (e.w.textFailed) { e.w.textFailed = false; saveText(jobId); }
    if (e.w.sketchFailed) { e.w.sketchFailed = false; if (e.w.clearWanted) clearSketch(jobId); else saveSketch(jobId); }
    paintPadSave(jobId);
  }

  // ── render: the working out pad (foot of Scope and notes) ──

  function padSaveHtml(e) {
    if (e.w.textFailed || e.w.sketchFailed) return '<span class="dpc-mat-fail" role="alert">Not saved. <button type="button" class="dpc-retry" data-dpc-mat-retry="saves">Retry</button></span>';
    if (e.w.textBusy || e.w.sketchBusy) return '<span role="status">Saving...</span>';
    if (e.touched) return '<span role="status">All changes saved</span>';
    return '';
  }

  function sketchMsgHtml(e) {
    if (e.w.sketchBroken) return '<div class="dpc-line-msg dpc-mat-fail" role="alert">Could not show the saved sketch.</div>';
    if (e.w.sketchMsg) return '<div class="dpc-line-msg dpc-mat-fail" role="alert">' + esc(e.w.sketchMsg) + '</div>';
    return '';
  }

  // Drawn on every job except a make-safe one.
  function workoutHtml() {
    var row = state.row;
    if (!row || isMakesafe(row)) return '<div data-dpc-region="workout"></div>';
    var e = oldEntry(row.id);
    var h = '<div data-dpc-region="workout"><details class="dpc-workout" data-dpc-mat-workout' + (state.old.workOpen ? ' open' : '') + '><summary>Working out and sketch</summary>';
    if (!e || e.status === 'loading' && !e.w.loaded) return h + '<div class="dpc-empty dpc-empty-tight">Loading the working out...</div></details></div>';
    if (e.status === 'error' && !e.w.loaded) {
      return h + '<div class="dpc-empty dpc-empty-tight dpc-mat-fail" role="alert">Could not load the working out. <button type="button" class="dpc-retry" data-dpc-mat-retry="read">Retry</button></div></details></div>';
    }
    if (e.notice) h += '<div class="dpc-mat-notice" role="status">' + esc(e.notice) + '</div>';
    h += '<div class="dpc-scratch"><textarea class="dpc-textarea" data-dpc-mat-pad maxlength="20000" placeholder="42 m run / 2.4 m bays = 18 bays..." aria-label="Working out">' + esc(e.w.text) + '</textarea>';
    h += '<div class="dpc-canvas-wrap"><canvas class="dpc-canvas" data-dpc-mat-canvas width="600" height="220" role="img" aria-label="Sketch pad"></canvas>';
    h += '<button type="button" class="dpc-canvas-clear" data-dpc-mat-clear>Clear sketch</button></div></div>';
    h += '<div data-dpc-region="matsketch">' + sketchMsgHtml(e) + '</div>';
    h += '<div class="dpc-mat-save" data-dpc-region="matsave">' + padSaveHtml(e) + '</div>';
    return h + '</details></div>';
  }

  function paintWorkout() {
    var el = region('workout');
    if (!el) return;
    var a = document.activeElement;
    var hadPad = !!a && el.contains(a) && a.hasAttribute('data-dpc-mat-pad');
    var start = hadPad ? a.selectionStart : null, end = hadPad ? a.selectionEnd : null;
    painting = true;
    try { el.outerHTML = workoutHtml(); } finally { painting = false; }
    wirePad();
    var pad = hadPad && region('workout') ? region('workout').querySelector('[data-dpc-mat-pad]') : null;
    if (pad) { pad.focus({ preventScroll: true }); try { pad.setSelectionRange(start, end); } catch (x) { /* not a text box */ } }
  }

  function paintPadSave(jobId) {
    if (state.jobId !== jobId) return;
    var el = region('matsave');
    var e = oldEntry(jobId);
    if (el && e) el.innerHTML = padSaveHtml(e);
  }

  function paintSketchMsg(jobId) {
    if (state.jobId !== jobId) return;
    var el = region('matsketch');
    var e = oldEntry(jobId);
    if (el && e) el.innerHTML = sketchMsgHtml(e);
  }

  // The saved sketch, drawn back onto the pad after every paint of it.
  function redrawSketch() {
    var e = oldEntry(state.jobId);
    var r = region('workout');
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
  function wirePad() {
    var r = region('workout');
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

  // The pad's presses. True when the press was one of them.
  function onPadClick(t) {
    var jobId = state.jobId;
    if (t.hasAttribute('data-dpc-mat-clear')) { if (jobId) clearSketch(jobId); return true; }
    if (t.hasAttribute('data-dpc-order-pdf')) {
      openOrderPdf(t.getAttribute('data-dpc-order-pdf'), t.getAttribute('data-dpc-order-pdf-version'), t.getAttribute('data-dpc-order-pdf-key'));
      return true;
    }
    if (t.hasAttribute('data-dpc-mat-retry')) {
      if (!jobId) return true;
      if (t.getAttribute('data-dpc-mat-retry') === 'read') { var e = oldEntry(jobId); readOld(jobId, !!e && e.w.loaded); }
      else retryPad(jobId);
      return true;
    }
    return false;
  }

  // The pad folded open or shut is kept per browser.
  function onToggle(e) {
    var t = e.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-dpc-mat-workout') || state.old.workOpen === t.open) return;
    state.old.workOpen = t.open;
    writeStore('localStorage', LS_WORKOUT, t.open ? '1' : '0');
  }

  // ── kept from v1: the Deliveries table and its three writes ──
  // Each write is sent once, on a person's change or press, against the
  // order's updated_at the screen was showing. Its answer redraws the row, the
  // open job's list counts and the rail line, then the Arrival line is read
  // again (it takes a purchase order's dates when its supplier box has none of
  // its own). Nothing here retries on its own.

  function delivRow(e, poId) {
    var rows = e && e.deliveries ? e.deliveries.rows : [];
    for (var i = 0; i < rows.length; i++) if (rows[i].purchase_order_id === poId) return rows[i];
    return null;
  }

  // An order as a write (or its order_changed refusal) answered it, onto the
  // row and the job's orders.
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
    return true;
  }

  // The answer's counted and sighted, onto the table and onto every copy of
  // the job's list row that carries the counts (the rail line reads them).
  function applyDelivCounts(jobId, c) {
    var e = oldEntry(jobId);
    if (!e || !e.deliveries || !c || typeof c.counted !== 'number' || typeof c.sighted !== 'number') return;
    e.deliveries.counted = c.counted;
    e.deliveries.sighted = c.sighted;
    e.deliveries.all_sighted = c.all_sighted === true;
    [state.base.rows, state.found.rows, state.arch.rows, state.row ? [state.row] : []].forEach(function (rows) {
      rows.forEach(function (r) {
        if (r && r.id === jobId && typeof r.deliveries_orders_total === 'number') { r.deliveries_orders_total = c.counted; r.deliveries_orders_sighted = c.sighted; }
      });
    });
  }

  // The order changed somewhere else, or cannot be changed here: say so, and
  // show the latest by one quiet re-read.
  function delivChanged(jobId, words) {
    var e = oldEntry(jobId);
    state.deliv.msg = { jobId: jobId, text: words };
    state.deliv.edit = null;
    state.deliv.ask = null;
    paintSchedIf(jobId);
    if (!e || e.rereading) return;
    e.rereading = true;
    readOld(jobId, true).then(function () { e.rereading = false; });
  }

  var DELIV_REFUSED = ['order_in_xero', 'order_cancelled', 'not_material', 'not_dispatch_work', 'order_not_found'];

  // One delivery write. onFail says what a failed press leaves on screen.
  // Resolves true when it landed.
  function delivSend(jobId, poId, action, body, onFail) {
    var e = oldEntry(jobId);
    var r = delivRow(e, poId);
    var d = state.deliv;
    if (!r || d.busy[poId]) return Promise.resolve(false);
    d.busy[poId] = action;
    d.msg = null;
    paintSchedIf(jobId);
    return Promise.resolve().then(function () {
      return global.opsPost(action, Object.assign({ purchase_order_id: poId, expected_updated_at: r.updated_at || null }, body));
    }).then(oldOk).then(function (resp) {
      delete d.busy[poId];
      // Saved, but an answer without the order cannot redraw the row: one quiet re-read shows it.
      if (!applyDelivOrder(e, poId, resp.order)) readOld(jobId, true);
      applyDelivCounts(jobId, resp.deliveries);
      if (state.jobId === jobId) {
        paintTape();
        paintSources();
        // The Arrival line takes a purchase order's dates: read it again.
        loadArrival(rowById(jobId) || state.row);
      }
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
      return landed;
    });
  }

  function setExpected(jobId, poId, value) {
    var r = delivRow(oldEntry(jobId), poId);
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
    delivSend(ed.jobId, ed.poId, 'dispatch_delivery_set_confirmed', { confirmed_delivery_date: value, via: 'deliveries' }, function () {
      ed.fail = true;
    }).then(function (landed) {
      ed.busy = false;
      if (landed && state.deliv.edit === ed) state.deliv.edit = null;
      paintSchedIf(ed.jobId);
    });
  }

  // Opens the one inline line on a row. Nothing is sent until Save or Clear.
  function openConfirmedLine(jobId, poId) {
    var r = delivRow(oldEntry(jobId), poId);
    if (!r) return;
    var c = r.delivery.confirmed;
    var day = c.by_hand ? c.date : r.delivery.expected;
    state.deliv.edit = { jobId: jobId, poId: poId, date: wholeDay(day), busy: false, fail: false, last: null };
    state.deliv.ask = null;
    state.deliv.msg = null;
  }

  // ── render: the Deliveries table ──

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

  // The inline confirmed-date line under a row.
  function delivEditHtml(r, ed) {
    var po = text(r.po_number) || 'this order';
    var off = ed.busy ? ' disabled' : '';
    var h = '<div class="dpc-deliv-edit" role="group" aria-label="Confirmed delivery date"><p class="dpc-empty dpc-empty-tight">Confirmed delivery for ' + esc(po) + ':</p><div class="dpc-actions">';
    h += dateBoxHtml(ed.date, 'data-dpc-deliv-edit-date', 'Confirmed delivery date for ' + po, ed.busy);
    h += '<button type="button" class="dpc-primary" data-dpc-deliv-edit="save"' + (ed.busy || !wholeDay(ed.date) ? ' disabled' : '') + '>' + (ed.busy && ed.last !== null ? 'Saving...' : 'Save') + '</button>';
    if (r.delivery.confirmed.by_hand) h += '<button type="button" class="dpc-primary" data-dpc-deliv-edit="clear"' + off + '>' + (ed.busy && ed.last === null ? 'Clearing...' : 'Clear') + '</button>';
    h += '<button type="button" data-dpc-deliv-edit="cancel"' + off + '>Cancel</button></div>';
    if (ed.fail) h += '<p class="dpc-empty dpc-empty-tight dpc-mat-fail" role="alert">Confirmed date not saved. <button type="button" class="dpc-retry" data-dpc-deliv-edit="retry"' + off + '>Retry</button></p>';
    return h + '</div>';
  }

  function delivRowHtml(jobId, r) {
    var d = state.deliv;
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
    if (d.edit && d.edit.jobId === jobId && d.edit.poId === poId) h += '<div class="dpc-deliv-sub">' + delivEditHtml(r, d.edit) + '</div>';
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

  // ── The supplier boxes ordered by email from Materials: the delivery date ──
  // Listed from the Arrival line's own answer. Their date comes from a
  // supplier reply (Accept in Emails), from a person by hand, or else the date
  // our order email asked for. Shaun's ruling (23 Oct): "we can tweak delivery
  // dates manually", for example when a supplier confirms by phone. Each box
  // has one inline line: a date, a Confirmed tick, Save, Clear and Cancel.
  // One write, ops-api dispatch_v2_set_delivery_date, sent once on Save or
  // Clear (never on opening the line, typing, ticking or Cancel). A date set by
  // hand replaces the supplier's date; it never moves the job's stage. The
  // answer carries the job's fresh Arrival line, then the list is read again
  // so the card's thin line and its count follow. No sighting is recorded on
  // these orders (v1 purchase orders keep theirs).
  function boxDateFrom(o) {
    if (o.date_source === 'box') {
      if (o.box_date_source === 'by_hand') return 'Set by hand' + (text(o.box_date_set_by_email) ? ' by ' + text(o.box_date_set_by_email) : '');
      return "From the supplier's reply";
    }
    return o.date_source === 'requested' ? 'Asked for in our email' : o.date_source === 'order' ? 'From the purchase order' : '';
  }

  function boxOrders(row) {
    var a = arrivalFor(row).arrival;
    return a && Array.isArray(a.orders) ? a.orders.filter(function (o) { return o && o.source === 'supplier_box' && text(o.supplier_id); }) : [];
  }

  function boxOrderOf(row, supplierId) {
    var list = boxOrders(row);
    for (var i = 0; i < list.length; i++) if (text(list[i].supplier_id) === supplierId) return list[i];
    return null;
  }

  // Opens the one inline line on a box, filled with the date shown (so a
  // supplier's yes by phone to the date we asked for is one tick and Save).
  // Nothing is sent until Save or Clear.
  function openBoxLine(row, supplierId, tick) {
    var o = boxOrderOf(row, supplierId);
    if (!o) return;
    var own = o.date_source === 'box';
    state.deliv.boxEdit = {
      jobId: row.id, supplierId: supplierId, boxId: text(o.box_id) || null, name: text(o.supplier_name) || 'this supplier',
      date: wholeDay(o.delivery_date), confirmed: tick || (own && o.date_confirmed === true), own: own,
      // The guard: the box's own date stamp as shown (null = no date of its
      // own). Sent only when the Arrival answer carries it.
      guard: Object.prototype.hasOwnProperty.call(o, 'box_date_set_at') ? { set_at: own ? (text(o.box_date_set_at) || null) : null } : null,
      fromReply: own && o.box_date_source === 'supplier_reply',
      dateWord: o.fulfilment === 'pickup' ? 'Pickup date' : 'Delivery date',
      busy: false, fail: false, last: null
    };
    state.deliv.boxMsg = null;
  }

  // The answer's fresh Arrival line onto the open job and every copy of its
  // list row, so the full line, its count and the card's thin line redraw.
  function applyBoxArrival(jobId, resp) {
    var fresh = resp && isObj(resp.arrival) && resp.arrival.job_id === jobId && resp.arrival.arrival_read !== 'failed' && arrivalOk(resp.arrival.arrival) ? resp.arrival : null;
    if (!fresh) return false;
    state.arrival[jobId] = { status: 'ok', data: fresh };
    [state.base.rows, state.found.rows, state.arch.rows, state.row ? [state.row] : []].forEach(function (rows) {
      rows.forEach(function (r) {
        if (!r || r.id !== jobId || !boardOf(r)) return;
        r.board.arrival = fresh.arrival;
        if (isObj(fresh.waiting)) r.board.waiting = fresh.waiting;
      });
    });
    return true;
  }

  var BOX_REFUSED = {
    date_changed: 'This date was changed somewhere else. Showing the latest.',
    box_not_found: 'That supplier order is no longer on this job. Showing the latest.',
    not_dispatch_work: 'Delivery dates cannot be set on this job.'
  };

  function boxSavedWords(ed, resp) {
    if (resp && resp.unchanged) return 'No change: ' + ed.name + ' already had that date.';
    var b = resp && resp.box;
    var d = b && parseDay(b.delivery_date);
    var word = ed.dateWord || 'Delivery date';
    if (!d) return word + ' cleared: ' + ed.name + '.';
    return word + ' saved: ' + ed.name + ', ' + dayText(d) + (b.confirmed ? ', confirmed.' : ', not confirmed yet.');
  }

  // Save (value: a date) or Clear (value: null). The line stays open with
  // what was typed when the press fails.
  function saveBoxDate(value) {
    var ed = state.deliv.boxEdit;
    if (!ed || ed.busy || (value !== null && !wholeDay(value))) return;
    var jobId = ed.jobId;
    ed.busy = true;
    ed.fail = false;
    ed.last = value;
    paintSchedIf(jobId);
    var body = ed.boxId ? { box_id: ed.boxId } : { job_id: jobId, supplier_id: ed.supplierId };
    body.delivery_date = value;
    body.confirmed = value !== null && ed.confirmed === true;
    if (ed.guard) body.expected_set_at = ed.guard.set_at;
    Promise.resolve().then(function () { return global.opsPost('dispatch_v2_set_delivery_date', body); }).then(function (resp) {
      if (!resp || resp.success !== true) throw new Error('Unexpected answer');
      if (state.deliv.boxEdit === ed) state.deliv.boxEdit = null;
      state.deliv.boxMsg = { jobId: jobId, text: boxSavedWords(ed, resp) };
      if (!applyBoxArrival(jobId, resp)) loadArrival(rowById(jobId) || state.row);
      if (state.jobId === jobId) { paintArrival(); paintSched(); refocus('[data-dpc-box-open="' + ed.supplierId + '"]'); }
      paintList(true);
      // The list read again: the card's thin line and count, from the server.
      if (!resp.unchanged) loadBase();
    }, function (err) {
      ed.busy = false;
      var words = BOX_REFUSED[err && err.code];
      if (words) {
        if (state.deliv.boxEdit === ed) state.deliv.boxEdit = null;
        state.deliv.boxMsg = { jobId: jobId, text: words };
        if (state.jobId === jobId) loadArrival(rowById(jobId) || state.row);
      } else {
        ed.fail = true;
      }
      paintSchedIf(jobId);
    });
  }

  // The inline delivery (or pickup) date line under a box.
  function boxEditHtml(ed) {
    var off = ed.busy ? ' disabled' : '';
    var word = ed.dateWord || 'Delivery date';
    var h = '<div class="dpc-deliv-edit" role="group" aria-label="' + esc(word) + ' for ' + esc(ed.name) + '"><p class="dpc-empty dpc-empty-tight">' + esc(word) + ' for ' + esc(ed.name) + ', set by hand:</p><div class="dpc-actions">';
    h += dateBoxHtml(ed.date, 'data-dpc-box-date', word + ' for ' + ed.name, ed.busy, true);
    h += '<label class="dpc-v2-main dpc-box-tick"><input type="checkbox" data-dpc-box-confirmed' + (ed.confirmed ? ' checked' : '') + off + '> Confirmed by the supplier</label>';
    h += '<button type="button" class="dpc-primary" data-dpc-box-edit="save"' + (ed.busy || !wholeDay(ed.date) ? ' disabled' : '') + '>' + (ed.busy && ed.last !== null ? 'Saving...' : 'Save') + '</button>';
    if (ed.own) h += '<button type="button" class="dpc-primary" data-dpc-box-edit="clear"' + off + '>' + (ed.busy && ed.last === null ? 'Clearing...' : 'Clear') + '</button>';
    h += '<button type="button" data-dpc-box-edit="cancel"' + off + '>Cancel</button></div>';
    if (ed.fromReply) h += '<p class="dpc-empty dpc-empty-tight">A date saved here replaces the date from the supplier\'s reply.</p>';
    if (ed.fail) h += '<p class="dpc-empty dpc-empty-tight dpc-mat-fail" role="alert">' + esc(word) + ' not saved. <button type="button" class="dpc-retry" data-dpc-box-edit="retry"' + off + '>Retry</button></p>';
    return h + '</div>';
  }

  function boxDelivHtml(row) {
    var boxes = boxOrders(row);
    if (!boxes.length) return '';
    var ed = state.deliv.boxEdit && state.deliv.boxEdit.jobId === row.id ? state.deliv.boxEdit : null;
    var h = '<div class="dpc-deliv dpc-deliv-boxes"><div class="dpc-deliv-row dpc-deliv-head"><span>Supplier (order email)</span><span>Expected</span><span>Confirmed by supplier</span><span>Sighted on site</span></div>';
    boxes.forEach(function (o) {
      var sid = text(o.supplier_id);
      var name = text(o.supplier_name) || 'Supplier not recorded';
      var day = parseDay(o.delivery_date);
      var from = boxDateFrom(o);
      var small = from ? '<small>' + esc(from) + '</small>' : '';
      var off = ed && ed.busy ? ' disabled' : '';
      var pickup = o.fulfilment === 'pickup';
      // Not paid yet or Paid, beside the date (piece B; nothing from an older server).
      var pill = payPillHtml(v2PayFrom(o.payment));
      var dayBtn = '<button type="button" class="dpc-deliv-daybtn" data-dpc-box-open="' + esc(sid) + '" aria-label="Change the ' + (pickup ? 'pickup' : 'delivery') + ' date for ' + esc(name) + '"' + off + '>' + esc(dayText(day)) + '</button>' + pill;
      h += '<div class="dpc-deliv-item" data-dpc-deliv-box="' + esc(sid) + '"><div class="dpc-deliv-row" data-step="' + (o.date_confirmed ? 2 : day ? 1 : 0) + '">';
      h += '<span><strong>' + esc(name) + '</strong><small>' + (o.order_sent ? 'Order email sent' : 'Order email not sent yet') + (pickup ? ', pickup' : '') + '</small></span>';
      // Expected: the date while it is not confirmed.
      if (!day) h += '<span class="dpc-dstate"><em>No date yet</em>' + pill + '<button type="button" class="dpc-textbtn" data-dpc-box-open="' + esc(sid) + '"' + off + '>Set date</button></span>';
      else if (!o.date_confirmed) h += '<span class="dpc-dstate on">' + dayBtn + small + '</span>';
      else h += '<span class="dpc-dstate"><em>-</em></span>';
      // Confirmed by supplier: the date once it is.
      if (o.date_confirmed && day) h += '<span class="dpc-dstate on">' + dayBtn + small + '</span>';
      else h += '<span class="dpc-dstate"><em>Waiting on supplier</em><button type="button" class="dpc-textbtn" data-dpc-box-open="' + esc(sid) + '" data-dpc-box-tick' + off + '>Set confirmed date</button></span>';
      h += '<span class="dpc-dstate"><em>Not recorded here</em></span></div>';
      if (ed && ed.supplierId === sid) h += '<div class="dpc-deliv-sub">' + boxEditHtml(ed) + '</div>';
      h += '</div>';
    });
    h += '</div>';
    var m = state.deliv.boxMsg;
    if (m && m.jobId === row.id) h += '<p class="dpc-deliv-msg dpc-deliv-boxmsg" role="status">' + esc(m.text) + '</p>';
    h += '<p class="dpc-deliv-sub dpc-deliv-boxnote">Orders sent by email from Materials take their dates from supplier replies (Accept in Emails), or set one here by hand, for example when a supplier confirms by phone. A date set by hand replaces the supplier\'s date and never moves the job. Sightings are not recorded on these orders.</p>';
    return h;
  }

  // The box lines' presses. True when the press was one of them. Only Save,
  // Clear and Retry send anything.
  function onBoxClick(t) {
    if (t.hasAttribute('data-dpc-box-open')) {
      if (!state.row || state.deliv.boxEdit && state.deliv.boxEdit.busy) return true;
      openBoxLine(state.row, t.getAttribute('data-dpc-box-open'), t.hasAttribute('data-dpc-box-tick'));
      paintSched();
      refocus('[data-dpc-box-date]');
      return true;
    }
    if (!t.hasAttribute('data-dpc-box-edit')) return false;
    var ed = state.deliv.boxEdit;
    if (!ed) return true;
    var act = t.getAttribute('data-dpc-box-edit');
    if (act === 'save') saveBoxDate(ed.date);
    else if (act === 'clear') saveBoxDate(null);
    else if (act === 'retry') saveBoxDate(ed.last);
    else if (act === 'cancel') {
      state.deliv.boxEdit = null;
      paintSched();
      refocus('[data-dpc-box-open="' + ed.supplierId + '"]');
    }
    return true;
  }

  // Typing a date or ticking Confirmed on the open line. True when it was one.
  function onBoxInput(t) {
    var ed = state.deliv.boxEdit;
    if (t.hasAttribute('data-dpc-box-confirmed')) {
      if (ed) ed.confirmed = !!t.checked;
      return true;
    }
    if (!t.hasAttribute('data-dpc-box-date')) return false;
    var wrap = t.parentNode;
    if (wrap && wrap.classList) wrap.classList.toggle('dpc-deliv-blank', !t.value);
    if (ed) {
      ed.date = t.value;
      var line = t.closest('.dpc-deliv-edit');
      var saveBtn = line && line.querySelector('[data-dpc-box-edit="save"]');
      if (saveBtn) saveBtn.disabled = !!ed.busy || !wholeDay(t.value);
    }
    return true;
  }

  var DELIV_EMPTY = 'No orders on this job yet. Orders sent from Materials show here with their delivery dates.';

  function delivBodyHtml(row) {
    var jobId = row.id;
    var e = oldEntry(jobId);
    var boxes = boxDelivHtml(row);
    var h = '';
    if (!e || e.status === 'loading' && !e.w.loaded) h += '<div class="dpc-empty dpc-empty-tight">Loading the deliveries...</div>';
    else if (e.status === 'error' && !e.w.loaded || !e.deliveries) {
      h += '<div class="dpc-empty dpc-empty-tight dpc-mat-fail" role="alert">Could not load the deliveries. <button type="button" class="dpc-retry" data-dpc-deliv-retry="read">Retry</button></div>';
    } else if (e.deliveries.rows.length) {
      h += '<div class="dpc-deliv"><div class="dpc-deliv-row dpc-deliv-head"><span>Supplier and PO</span><span>Expected</span><span>Confirmed by supplier</span><span>Sighted on site</span></div>';
      e.deliveries.rows.forEach(function (r) { h += delivRowHtml(jobId, r); });
      h += '</div>';
    } else if (!boxes) {
      h += '<div class="dpc-empty dpc-empty-tight">' + esc(DELIV_EMPTY) + '</div>';
    }
    return h + delivMsgHtml(jobId) + boxes;
  }

  // The Deliveries table's presses. True when the press was one of them. Only
  // Mark sighted, Clear, Save, Clear (a hand-set date) and Retry send
  // anything; opening and cancelling a line writes nothing.
  function onDelivClick(t) {
    var jobId = state.jobId;
    var d = state.deliv;
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
        paintSched();
        refocus('[data-dpc-deliv-unsight="keep"]');
      } else if (u === 'keep') {
        d.ask = null;
        paintSched();
        refocus('[data-dpc-deliv-unsight="ask"][data-dpc-deliv-po="' + poId + '"]');
      } else if (u === 'go') {
        markSighted(jobId, poId, false);
      }
    } else if (t.hasAttribute('data-dpc-deliv-confirm')) {
      if (!jobId) return true;
      openConfirmedLine(jobId, poId);
      paintSched();
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
        paintSched();
        refocus('[data-dpc-deliv-confirm="' + ed.poId + '"]');
      }
    } else if (t.hasAttribute('data-dpc-deliv-retry')) {
      if (!jobId) return true;
      if (t.getAttribute('data-dpc-deliv-retry') === 'read') {
        var e = oldEntry(jobId);
        readOld(jobId, !!e && e.status === 'ok');
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

  // The expected date box is saved when it is left or Enter is pressed, never
  // while a segment is still being typed. A box only part filled is not a date
  // and is never sent; an emptied box clears the date.
  function commitExpected(jobId, t) {
    var poId = t.getAttribute('data-dpc-deliv-expected');
    var v = text(t.value);
    if ((!v && t.validity && t.validity.badInput) || (v && !wholeDay(v))) {
      delete state.deliv.typed[poId];
      var r = delivRow(oldEntry(jobId), poId);
      t.value = r ? wholeDay(r.delivery.expected) : '';
      if (t.parentNode && t.parentNode.classList) t.parentNode.classList.toggle('dpc-deliv-blank', !t.value);
      return;
    }
    setExpected(jobId, poId, v || null);
  }

  // Typing in a date box: its "Set date" look, what was typed, and the
  // inline line's Save button.
  function onDelivInput(t) {
    if (!t.hasAttribute('data-dpc-deliv-edit-date') && !t.hasAttribute('data-dpc-deliv-expected')) return false;
    var wrap = t.parentNode;
    if (wrap && wrap.classList) wrap.classList.toggle('dpc-deliv-blank', !t.value);
    if (t.hasAttribute('data-dpc-deliv-expected') && state.jobId && !(!t.value && t.validity && t.validity.badInput)) {
      var poId = t.getAttribute('data-dpc-deliv-expected');
      var dr = delivRow(oldEntry(state.jobId), poId);
      if (dr && (dr.delivery.expected || '') === t.value) delete state.deliv.typed[poId];
      else state.deliv.typed[poId] = t.value;
    }
    if (t.hasAttribute('data-dpc-deliv-edit-date') && state.deliv.edit) {
      state.deliv.edit.date = t.value;
      var line = t.closest('.dpc-deliv-edit');
      var saveBtn = line && line.querySelector('[data-dpc-deliv-edit="save"]');
      if (saveBtn) saveBtn.disabled = !!state.deliv.edit.busy || !wholeDay(t.value);
    }
    return true;
  }

  // ── render: the Purchase orders group in Sources (kept from v1, read only) ──
  // v2 makes no purchase orders, so the group shows only on a job that has
  // some already (made in v1 Dispatch, or elsewhere). An order made in v1
  // Dispatch with a stored PDF opens it through dispatch_order_pdf (a read).

  // An order made in v1 Dispatch carries its supplier and source.
  function isDispatchOrder(o) { return !!(o && o.supplier_id && o.source); }

  function orderStatusWord(s) {
    if (s === 'cancelled') return 'Cancelled';
    var words = text(s).replace(/_/g, ' ');
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Status not recorded';
  }

  function pdfFailHtml(key, attrs) {
    if (state.old.pdf[key] !== 'failed') return '';
    return '<div class="dpc-line-msg dpc-mat-fail dpc-pdf-fail" role="alert">Could not open the PDF. <button type="button" class="dpc-retry" ' + attrs + '>Retry</button></div>';
  }

  function poSourcesHtml() {
    var row = state.row;
    if (!row || isMakesafe(row)) return '';
    var e = oldEntry(row.id);
    var h = '<h4 class="dpc-h4">Purchase orders</h4>';
    if (!e || !e.w.loaded && e.status !== 'error') return '';
    if (e.status === 'error' && !e.w.loaded || !e.ordersOk) {
      return h + '<div class="dpc-empty dpc-empty-tight dpc-mat-fail" role="alert">Could not load this job\'s orders. <button type="button" class="dpc-retry" data-dpc-mat-retry="read">Retry</button></div>';
    }
    if (!e.orders.length) return '';
    e.orders.forEach(function (o) {
      var po = text(o.po_number);
      var words = (text(o.supplier_name) || 'Supplier not recorded') + ', ' + orderStatusWord(o.status);
      if (isDispatchOrder(o) && o.pdf_version) {
        var key = 'src:' + o.id;
        var attrs = 'data-dpc-order-pdf="' + esc(o.id) + '" data-dpc-order-pdf-version="' + esc(o.pdf_version) + '" data-dpc-order-pdf-key="' + esc(key) + '"';
        h += docChip((po || 'Order') + '.pdf', words + (state.old.pdf[key] === 'busy' ? ' · Opening...' : ''), attrs) + pdfFailHtml(key, attrs);
      } else {
        h += '<div class="dpc-doc dpc-doc-nopdf"><span class="dpc-grow"><strong>' + esc(po || 'No order number') + '</strong><small>' + esc(words) + '</small><small>No PDF on file</small></span></div>';
      }
    });
    return h + '<p class="dpc-foot-line">Read only. New orders are sent by email from Materials.</p>';
  }

  // An order's PDF, through a short-lived link, opened in a new tab. The tab is
  // opened on the press so the browser does not block it, then pointed at the link.
  function openOrderPdf(poId, version, key) {
    if (!poId || state.old.pdf[key] === 'busy') return;
    state.old.pdf[key] = 'busy';
    paintSources();
    var win = null;
    try { win = global.open('', '_blank'); if (win) win.opener = null; } catch (x) { win = null; }
    var params = { purchase_order_id: poId };
    if (version) params.version = version;
    Promise.resolve().then(function () { return global.opsFetch('dispatch_order_pdf', params); }).then(function (resp) {
      var url = safeUrl(resp && resp.url);
      if (!url) throw new Error('Unexpected PDF answer');
      delete state.old.pdf[key];
      if (win && !win.closed) win.location.href = url; else global.open(url, '_blank', 'noopener');
      paintSources();
    }).catch(function () {
      if (win) { try { win.close(); } catch (x) { /* already gone */ } }
      state.old.pdf[key] = 'failed';
      paintSources();
    });
  }

  // The Sources tab, when it is the one showing.
  function paintSources() {
    if (!state.rightOpen || state.tab !== 'sources' || !state.row) return;
    var el = region('panel');
    if (el) el.innerHTML = panelHtml();
  }

  // ───────────────────────── render: Install ─────────────────────────

  var PORTAL_TEXT = 'The real schedule lives in the Ops Calendar, with the material deliveries next to the crews.';

  // The install row (v2): the install day from the board, and who is booked
  // from the list row's booking names when they are for the same day. Mark
  // confirmed is gone: a booked install shows as booked, nothing more.
  function installHtml(row) {
    var h = '<div class="dpc-deliv dpc-install"><div class="dpc-deliv-row dpc-install-row dpc-deliv-head"><span>Install</span><span>Trade booked</span></div>';
    var b = boardOf(row);
    var ins = b && b.install && typeof b.install === 'object' ? b.install : null;
    if (!ins) {
      return h + '<div class="dpc-deliv-item"><div class="dpc-empty dpc-mat-fail" role="alert">Could not load the bookings. <button type="button" class="dpc-retry" data-dpc-install="retry-read">Retry</button></div></div></div>';
    }
    var v1 = installOf(row);
    var names = v1 && v1.state !== 'none' && text(v1.day) === text(ins.day)
      ? v1.people.map(function (p) { return text(p && p.name) || 'Name not on record'; }).join(', ') : '';
    var booked = ins.booked ? installWords(b, true) + (names ? ', ' + names : '') : '';
    h += '<div class="dpc-deliv-item"><div class="dpc-deliv-row dpc-install-row" data-step="' + (booked ? 2 : 1) + '">';
    h += '<span><strong>Install</strong><small>' + esc(text(b.job_number) || text(row.job_number) || 'No job number') + '</small></span>';
    h += '<span class="dpc-dstate' + (booked ? ' on' : '') + '">' + (booked ? esc(booked) : '<em>Not booked</em>') + '</span></div>';
    if (v1 && v1.also_days.length) {
      h += '<p class="dpc-deliv-sub">Also booked: ' + esc(v1.also_days.map(function (v) { return dayText(parseDay(v)); }).filter(Boolean).join(', ')) + '.</p>';
    }
    if (v1 && v1.calendar_confirmed) h += '<p class="dpc-deliv-sub">The calendar shows this booking as confirmed.</p>';
    return h + '</div></div>';
  }

  // The one way into the live calendar, at the foot of the section. Not drawn
  // when the page has no showView.
  function portalHtml() {
    var h = '<div class="dpc-portal"><span class="dpc-grow">' + esc(PORTAL_TEXT) + ' Bookings are made and changed there.</span>';
    if (typeof global.showView === 'function') h += '<button type="button" data-dpc-deliv-cal>Open Calendar</button>';
    return h + '</div>';
  }

  // Drawn on every job except a make-safe one, under Emails: the v1
  // Deliveries table (each purchase order to site, working as v1 does), the
  // supplier boxes ordered by email (read only), then the install row.
  function schedHtml() {
    var row = state.row;
    if (!row || isMakesafe(row)) return '';
    var open = state.sched.open;
    var h = '<div class="dpc-sec dpc-sched' + (open ? '' : ' dpc-collapsed') + '" data-dpc-region="sched"><div class="dpc-sec-head"><div class="dpc-grow"><span class="dpc-eyebrow">Schedule</span><h3>Deliveries and install</h3>';
    if (open) h += '<p>Each order to site, then the trade booked</p>';
    h += '</div><button type="button" class="dpc-chev" data-dpc-sched-toggle aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse' : 'Expand') + ' Deliveries and install">' + CHEV_SVG + '</button></div>';
    if (open) h += '<div class="dpc-sec-body">' + delivBodyHtml(row) + installHtml(row) + portalHtml() + '</div>';
    return h + '</div>';
  }

  var SCHED_FOCUS_KEYS = ['data-dpc-deliv-expected', 'data-dpc-deliv-edit-date', 'data-dpc-deliv-sight', 'data-dpc-deliv-unsight', 'data-dpc-deliv-po',
    'data-dpc-deliv-confirm', 'data-dpc-deliv-edit', 'data-dpc-deliv-retry', 'data-dpc-box-open', 'data-dpc-box-date', 'data-dpc-box-confirmed', 'data-dpc-box-edit', 'data-dpc-deliv-cal', 'data-dpc-install', 'data-dpc-sched-toggle'];
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

  // ───────────────────────── render: supplier replies (slice 8) ─────────────────────────

  // The rung pill: how the email was put on the job.
  var RUNG_WORDS = { thread: 'Same thread', job_number: 'Job number', supplier_ref: 'Their number', best_guess: 'Best guess', manual: 'Picked by hand' };
  function rungHtml(m) {
    var w = RUNG_WORDS[m.rung];
    if (!w) return '';
    if (m.rung === 'best_guess' && m.decision === 'confirmed') w = 'Best guess, confirmed';
    var tone = m.rung === 'best_guess' && m.state === 'needs_confirmation' ? ' dpc-rung-guess' : '';
    return '<span class="dpc-rung' + tone + '">' + esc(w) + '</span>';
  }

  // A press's answer under the thing pressed.
  function repMsgHtml(msg, retryAttrs) {
    if (!msg) return '';
    if (msg.ok) return '<p class="dpc-rep-msg" role="status">' + esc(msg.text) + '</p>';
    return '<p class="dpc-rep-msg dpc-mat-fail" role="alert">' + esc(msg.text) +
      (msg.retry && retryAttrs ? ' <button type="button" class="dpc-retry" ' + retryAttrs + '>Retry</button>' : '') + '</p>';
  }

  // "Check this" hints from the date reader, in plain words.
  function sugHints(s) {
    var out = [];
    if (s.weekday_mismatch) out.push('The email named a weekday that is not on this date. The date was used.');
    if (s.day_word_only) out.push('The email gave only a day word, such as "Thursday" or "tomorrow".');
    var others = Array.isArray(s.other_dates) ? s.other_dates.map(function (d) { return dayText(parseDay(d)); }).filter(Boolean) : [];
    if (others.length) out.push('The email also named ' + others.join(', ') + '.');
    return out;
  }

  var SUG_STATE = { accepted: 'Accepted', dismissed: 'Dismissed', superseded: 'Replaced by a newer date' };

  // The suggestion card under its email (approved #senddemo .sug): the label,
  // the sentence it was read from, the hints, and Accept / Dismiss.
  function sugHtml(e, s) {
    var busy = e.busy[s.id];
    var off = busy ? ' disabled' : '';
    var open = s.state === 'open';
    var h = '<div class="dpc-sug' + (open ? '' : ' dpc-sug-done') + '" data-dpc-sug="' + esc(s.id) + '"><div class="dpc-sug-top"><span class="dpc-sug-eyebrow">Suggested</span><strong>' + esc(text(s.label) || 'A delivery date') + '</strong></div>';
    if (text(s.quote)) h += '<p class="dpc-sug-quote">"' + esc(text(s.quote)) + '"</p>';
    var hints = open ? sugHints(s) : [];
    if (hints.length) h += '<ul class="dpc-sug-hints">' + hints.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    if (open) {
      var orders = e.data.orders;
      if (s.needs_order_pick) {
        if (!e.data.ordersWired) {
          h += '<p class="dpc-empty dpc-empty-tight">Supplier orders are not switched on yet, so this date cannot be saved.</p>';
        } else if (!orders.length) {
          h += '<p class="dpc-empty dpc-empty-tight">This job has no sent order to put this date on.</p>';
        } else {
          h += '<label class="dpc-sug-pick">Which order is this for? <select data-dpc-sug-order="' + esc(s.id) + '"' + off + '><option value="">Pick the order</option>' +
            orders.map(function (o) {
              return '<option value="' + esc(o.order_id) + '"' + (e.pick[s.id] === o.order_id ? ' selected' : '') + '>' + esc((text(o.supplier_name) || 'Supplier') + (parseStamp(o.sent_at) ? ', sent ' + stampText(o.sent_at) : '')) + '</option>';
            }).join('') + '</select></label>';
        }
      }
      var canAccept = s.can_accept !== false && (!s.needs_order_pick || !!e.pick[s.id]);
      h += '<div class="dpc-actions"><button type="button" class="dpc-primary" data-dpc-sug-accept="' + esc(s.id) + '"' + (busy || !canAccept ? ' disabled' : '') + '>' + (busy === 'accept' ? 'Saving...' : 'Accept') + '</button>';
      h += '<button type="button" data-dpc-sug-dismiss="' + esc(s.id) + '"' + off + '>' + (busy === 'dismiss' ? 'Dismissing...' : 'Dismiss') + '</button></div>';
      h += '<p class="dpc-sug-foot">' + esc(sugFootWords(e, s)) + '</p>';
    } else {
      var who = text(s.acted_by_email);
      h += '<p class="dpc-sug-state">' + esc((SUG_STATE[s.state] || 'Done') + (who ? ' by ' + who : '') + (parseStamp(s.acted_at) ? ', ' + stampText(s.acted_at) : '') + '.') + '</p>';
    }
    return h + repMsgHtml(e.msg[s.id], 'data-dpc-sug-retry="' + esc(s.id) + '"') + '</div>';
  }

  function repEmailHtml(e, m, sugs) {
    var guess = m.state === 'needs_confirmation';
    var busy = e.busy[m.id];
    var off = busy ? ' disabled' : '';
    // The rung pill is on the email's line in the list, not repeated here.
    var h = '<li class="dpc-rep' + (guess ? ' dpc-rep-guess' : '') + '" data-dpc-rep="' + esc(m.id) + '"><div class="dpc-rep-top"><strong>' + esc(text(m.supplier_name) || text(m.from_email) || 'Supplier') + '</strong>' +
      '<span class="dpc-grow"></span><span class="dpc-muted">' + esc(parseStamp(m.received_at) ? stampText(m.received_at) : '') + '</span></div>';
    if (text(m.subject)) h += '<p class="dpc-rep-subj">' + esc(text(m.subject)) + '</p>';
    if (text(m.snippet)) h += '<p class="dpc-rep-snip">' + esc(text(m.snippet)) + '</p>';
    if (text(m.match_reason)) h += '<p class="dpc-rep-why">' + esc(text(m.match_reason)) + '</p>';
    if (guess) {
      h += '<div class="dpc-rep-ask"><span class="dpc-grow">Is this email about this job?</span>' +
        '<button type="button" class="dpc-primary" data-dpc-rep-confirm="' + esc(m.id) + '"' + off + '>' + (busy === 'confirm' ? 'Saving...' : 'Yes, this job') + '</button>' +
        '<button type="button" data-dpc-rep-reject="' + esc(m.id) + '"' + off + '>' + (busy === 'reject' ? 'Saving...' : 'Not this one') + '</button></div>';
    }
    h += repMsgHtml(e.msg[m.id], 'data-dpc-rep-retry="' + esc(m.id) + '"');
    sugs.forEach(function (s) { h += sugHtml(e, s); });
    return h + '</li>';
  }

  // ───────────────────────── render: Emails (the job's one email panel) ─────────────────────────
  //
  // The v1 Emails panel, kept in its list-and-view look, now holding what v2
  // sends and receives:
  //   - the v2 order emails from Materials (held, TEST copy sent, sent), read
  //     from dispatch_v2_materials. They are shown here only: making, editing
  //     and sending stay in Materials, behind its test-first and confirm
  //     checks, so this panel has no send button;
  //   - the supplier replies matched to the job (dispatch_v2_replies), with
  //     the delivery dates read from them (Accept or Dismiss) and the best
  //     guesses to confirm.
  // The v1 purchase order email threads are not shown: v2 orders are emails,
  // not purchase orders.

  var MAIL_FOOT = 'Order emails are made and sent in Materials; this panel only shows them. Supplier replies are read from admin@.';

  // The words for an order email's state, short (list) and long (view).
  function orderMailState(m) {
    if (state.v2m.unrecorded[m.id]) return { tag: 'Went, not noted', bad: true, line: 'This email went, but Dispatch could not note it. Do not send it again.' };
    if (m.sent) return { tag: 'Sent', line: 'Sent ' + stampText(m.sent.sent_at) + (text(m.sent.sent_by_email) ? ' by ' + text(m.sent.sent_by_email) : '') + '.' };
    if (m.status === 'sending') return { tag: 'Sending', line: 'Sending now. If this stays for more than 2 minutes, check admin@ Sent Items.' };
    if (m.status === 'send_unknown') return { tag: 'May have gone', bad: true, line: 'This email may have gone. Check admin@ Sent Items, then use Materials to send it again only if it is not there.' };
    return { tag: m.test ? 'Held, test sent' : 'Held', line: 'Held, nothing sent yet. Check it and send it in Materials.' };
  }

  // Every order email on the job: each box's open email, then the ones sent.
  function orderMails(e) {
    var out = [];
    if (!e || !e.d) return out;
    e.d.boxes.forEach(function (b) {
      if (b.open) out.push({ m: b.open, box: b });
      b.sent.forEach(function (m) { out.push({ m: m, box: b }); });
    });
    return out;
  }

  // The panel's list: held order emails first, then sent order emails and
  // supplier emails together, newest first.
  function mailItems(jobId) {
    var v = v2Entry(jobId);
    var r = repEntry(jobId);
    var held = [], rest = [];
    orderMails(v).forEach(function (o) {
      var item = { key: 'o:' + o.m.id, kind: 'order', m: o.m, box: o.box, at: o.m.sent ? o.m.sent.sent_at : o.m.updated_at };
      if (o.m.sent || state.v2m.unrecorded[o.m.id]) rest.push(item); else held.push(item);
    });
    if (r && r.data && r.status !== 'error') {
      r.data.emails.forEach(function (m) {
        var sugs = r.data.suggestions.filter(function (s) { return s.email_id === m.id; });
        rest.push({ key: 'r:' + m.id, kind: 'reply', m: m, sugs: sugs, at: m.received_at,
          ask: m.state === 'needs_confirmation' || sugs.some(function (s) { return s.state === 'open'; }) });
      });
    }
    var ms = function (v) { var t = Date.parse(text(v)); return isFinite(t) ? t : 0; };
    rest.sort(function (a, b) { return ms(b.at) - ms(a.at); });
    return held.concat(rest);
  }

  // The email open in the view: the one picked, else the first reply that
  // needs an answer, else the first held email, else the first in the list.
  function mailSel(jobId, items) {
    var want = state.mail.sel[jobId];
    var i;
    for (i = 0; i < items.length; i++) if (items[i].key === want) return items[i];
    for (i = 0; i < items.length; i++) if (items[i].ask) return items[i];
    for (i = 0; i < items.length; i++) if (items[i].kind === 'order' && !items[i].m.sent) return items[i];
    return items[0] || null;
  }

  function mailItemHtml(it, on) {
    var h = '<button type="button" class="dpc-mail-item' + (it.kind === 'order' && !it.m.sent ? ' dpc-mail-draft' : '') + '" data-dpc-mail="pick" data-dpc-mail-key="' + esc(it.key) + '" aria-pressed="' + on + '">';
    if (it.kind === 'order') {
      var st = orderMailState(it.m);
      h += '<span class="dpc-mail-top"><strong>' + esc(it.box.name) + (it.m.sent ? '' : '<span class="dpc-mail-drafttag">Held</span>') + '</strong><small>' + esc(stampText(it.at)) + '</small></span>';
      h += '<span class="dpc-mail-subj">' + esc(text(it.m.subject) || 'No subject') + '</span>';
      return h + '<span class="dpc-mail-tags"><span class="dpc-type">Order email</span><span class="' + (st.bad ? 'dpc-mat-fail' : 'dpc-muted') + '">' + esc(st.tag) + '</span></span></button>';
    }
    var m = it.m;
    h += '<span class="dpc-mail-top"><strong>' + esc(text(m.supplier_name) || text(m.from_email) || 'Supplier') + '</strong><small>' + esc(parseStamp(m.received_at) ? stampText(m.received_at) : '') + '</small></span>';
    h += '<span class="dpc-mail-subj">' + esc(text(m.subject) || 'No subject') + '</span>';
    if (text(m.snippet)) h += '<span class="dpc-muted dpc-mail-prev">' + esc(text(m.snippet)) + '</span>';
    h += '<span class="dpc-mail-tags"><span class="dpc-type">Supplier</span>' + rungHtml(m);
    if (it.sugs.some(function (s) { return s.state === 'open'; })) h += '<span class="dpc-mail-drafttag">Date to check</span>';
    return h + '</span></button>';
  }

  // An order email, read only, with the way back to Materials.
  function orderViewHtml(it) {
    var m = it.m;
    var st = orderMailState(m);
    var s = m.sent || {};
    var to = v2Arr(s.to).length ? v2Arr(s.to) : m.to;
    var cc = v2Arr(s.cc).length ? v2Arr(s.cc) : m.cc;
    var sid = esc(it.box.supplier_id);
    var h = '<div class="dpc-mail-head"><strong>Order email to ' + esc(it.box.name) + '</strong><span class="dpc-mail-tags"><span class="dpc-type">' + esc(st.tag) + '</span></span></div>';
    h += '<p class="dpc-mail-msg' + (st.bad ? ' dpc-mat-fail' : '') + '" role="' + (st.bad ? 'alert' : 'status') + '">' + esc(st.line) + '</p>';
    h += '<div class="dpc-field"><span>From</span><span class="dpc-field-val">' + esc(text(s.from) || m.from || V2_FROM) + '</span></div>';
    h += '<div class="dpc-field"><span>To</span><span class="dpc-field-val">' + esc(to.join(', ') || 'Not filled in yet') + '</span></div>';
    h += '<div class="dpc-field"><span>CC</span><span class="dpc-field-val">' + esc(cc.join(', ') || 'None') + '</span></div>';
    h += '<div class="dpc-field"><span>Subject</span><span class="dpc-field-val">' + esc(text(m.subject) || 'No subject') + '</span></div>';
    var facts = [v2Count(m.line_count, 'line', 'lines')];
    if (m.photo_ids.length) facts.push(v2Count(m.photo_ids.length, 'photo', 'photos'));
    var day = parseDay(m.delivery_date);
    if (day) facts.push((m.fulfilment === 'pickup' ? 'pickup' : 'delivery') + ' asked for ' + dayText(day));
    h += '<p class="dpc-mail-msg">' + esc(facts.join(', ') + '.') + '</p>';
    if (m.test) h += '<p class="dpc-mail-msg">Test copy sent to ' + esc(text(m.test.sent_to) || V2_FROM) + ', ' + esc(stampText(m.test.sent_at)) + (text(m.test.sent_by_email) ? ' by ' + esc(m.test.sent_by_email) : '') + '.</p>';
    h += '<pre class="dpc-v2-pre">' + esc(m.body) + '</pre>';
    return h + '<div class="dpc-actions"><button type="button" data-dpc-mail-goto="' + sid + '" data-dpc-mail-id="' + esc(m.id) + '">' + (m.sent ? 'Show in Materials' : 'Edit and send in Materials') + '</button></div>';
  }

  function mailBodyHtml(jobId) {
    var v = v2Entry(jobId);
    var r = repEntry(jobId);
    var vWait = !v || !v.d && v.status !== 'error';
    var rWait = !r || !r.data && r.status !== 'error';
    if (vWait && rWait) return '<div class="dpc-empty dpc-empty-tight">Loading email...</div>';
    var h = '';
    var d = r && r.data;
    if (d && d.scan && d.scan.enabled === false) h += '<p class="dpc-empty dpc-empty-tight dpc-rep-off">Supplier emails are not being read yet. Nothing new will show here until reading is switched on.</p>';
    // A press whose email has gone from the list (put on another job, sent back) keeps its answer at the top.
    if (d) {
      var shown = {};
      d.emails.forEach(function (m) { shown[m.id] = true; });
      d.suggestions.forEach(function (s) { shown[s.id] = true; });
      Object.keys(r.msg).forEach(function (id) { if (!shown[id] && r.msg[id]) h += repMsgHtml(r.msg[id]); });
    }
    var items = mailItems(jobId);
    var fails = '';
    if (v && v.status === 'error' && !v.d) fails += '<div class="dpc-mail-listfail">' + v2Fail1('Could not load the order emails.', 'data-dpc-v2="retry"') + '</div>';
    else if (vWait) fails += '<div class="dpc-mail-listfail"><span class="dpc-muted">Loading the order emails...</span></div>';
    if (r && r.status === 'error') fails += '<div class="dpc-mail-listfail">' + failLine('Could not load the supplier replies.', 'replies', true) + '</div>';
    else if (rWait) fails += '<div class="dpc-mail-listfail"><span class="dpc-muted">Reading supplier replies...</span></div>';
    // A suggestion whose email is not listed (it is older than the newest 100) still shows.
    var loose = d && r.status !== 'error' ? d.suggestions.filter(function (s) { return !d.emails.some(function (m) { return m.id === s.email_id; }); }) : [];
    var foot = '<p class="dpc-foot-line">' + esc(MAIL_FOOT) + '</p>';
    if (!items.length && !fails) {
      h += '<div class="dpc-empty dpc-empty-tight">No email on this job yet. Order emails made in Materials, and supplier replies to them, show here.</div>';
      loose.forEach(function (s) { h += sugHtml(r, s); });
      return h + foot;
    }
    var sel = mailSel(jobId, items);
    h += '<div class="dpc-mail"><div class="dpc-mail-list">' + fails;
    items.forEach(function (it) { h += mailItemHtml(it, !!sel && sel.key === it.key); });
    h += '</div><div class="dpc-mail-view">';
    if (!sel) h += '<div class="dpc-empty dpc-empty-tight">Nothing open.</div>';
    else if (sel.kind === 'order') h += orderViewHtml(sel);
    else h += '<ul class="dpc-rep-list">' + repEmailHtml(r, sel.m, sel.sugs) + '</ul>';
    h += '</div></div>';
    loose.forEach(function (s) { h += sugHtml(r, s); });
    return h + foot;
  }

  // Drawn on every job except a make-safe one, under Materials.
  function mailHtml() {
    var row = state.row;
    if (!row || isMakesafe(row)) return '';
    var open = state.mail.open;
    var h = '<div class="dpc-sec dpc-mailsec' + (open ? '' : ' dpc-collapsed') + '" data-dpc-region="mail" id="dpc-emails"><div class="dpc-sec-head"><div class="dpc-grow"><span class="dpc-eyebrow">Send</span><h3>Emails</h3>';
    if (open) h += '<p>Order emails from Materials, and supplier replies matched to this job with the delivery dates read from them</p>';
    h += '</div><button type="button" class="dpc-chev" data-dpc-mail-toggle aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse' : 'Expand') + ' Emails">' + CHEV_SVG + '</button></div>';
    if (open) h += '<div class="dpc-sec-body">' + mailBodyHtml(row.id) + '</div>';
    return h + '</div>';
  }

  var MAIL_FOCUS_KEYS = ['data-dpc-rep-confirm', 'data-dpc-rep-reject', 'data-dpc-rep-retry', 'data-dpc-sug-accept', 'data-dpc-sug-dismiss', 'data-dpc-sug-order', 'data-dpc-sug-retry', 'data-dpc-retry',
    'data-dpc-mail', 'data-dpc-mail-key', 'data-dpc-mail-toggle', 'data-dpc-mail-goto', 'data-dpc-v2'];
  function paintMail() {
    var el = region('mail');
    if (!el) return;
    var a = document.activeElement;
    var sel = a && el.contains(a) ? MAIL_FOCUS_KEYS.filter(function (k) { return a.hasAttribute(k); }).map(function (k) {
      return '[' + k + '="' + String(a.getAttribute(k)).replace(/["\\]/g, '\\$&') + '"]';
    }).join('') : '';
    painting = true;
    try { el.outerHTML = mailHtml(); } finally { painting = false; }
    var now = sel && region('mail') ? region('mail').querySelector(sel) : null;
    if (now && !now.disabled) now.focus({ preventScroll: true });
  }

  function paintRepIf(jobId) {
    if (state.jobId !== jobId) return;
    paintMail();
    paintSugNote();
  }

  // Opens the Emails panel on the first email that needs an answer.
  function mailGotoAsk() {
    var jobId = state.jobId;
    if (!jobId) return;
    var items = mailItems(jobId);
    for (var i = 0; i < items.length; i++) if (items[i].ask) { state.mail.sel[jobId] = items[i].key; break; }
    if (!state.mail.open) { state.mail.open = true; writeStore('localStorage', LS_MAIL, '1'); }
    paintMail();
    var sec = region('mail');
    if (!sec) return;
    sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    var first = sec.querySelector('.dpc-mail-view [data-dpc-sug-accept]:not([disabled]),.dpc-mail-view [data-dpc-rep-confirm]:not([disabled])');
    if (first) first.focus({ preventScroll: true });
  }

  // The Emails panel's own presses. True when the press was one of them.
  function onMailClick(t) {
    var jobId = state.jobId;
    // A press on the reply open in the view keeps that reply open after it lands.
    var li = t.closest ? t.closest('.dpc-mail-view [data-dpc-rep]') : null;
    if (li && jobId) state.mail.sel[jobId] = 'r:' + li.getAttribute('data-dpc-rep');
    if (t.hasAttribute('data-dpc-mail-toggle')) {
      state.mail.open = !state.mail.open;
      writeStore('localStorage', LS_MAIL, state.mail.open ? '1' : '0');
      paintMail();
      refocus('[data-dpc-mail-toggle]');
      return true;
    }
    if (t.getAttribute('data-dpc-mail') === 'pick') {
      if (!jobId) return true;
      var key = t.getAttribute('data-dpc-mail-key');
      state.mail.sel[jobId] = key;
      paintMail();
      refocus('[data-dpc-mail-key="' + String(key).replace(/["\\]/g, '\\$&') + '"]');
      return true;
    }
    var sid = t.getAttribute('data-dpc-mail-goto');
    if (sid) {
      // The email lives in its supplier box in Materials: open Materials and go there.
      if (!state.v2m.open) { state.v2m.open = true; writeStore('localStorage', LS_ORDER, '1'); paintV2(); }
      var mid = t.getAttribute('data-dpc-mail-id');
      var box = root().querySelector('[data-dpc-v2-box="' + sid.replace(/["\\]/g, '\\$&') + '"]');
      if (box) {
        box.scrollIntoView({ block: 'start', behavior: 'smooth' });
        var field = mid ? box.querySelector('[data-dpc-v2-mf="subject"][data-dpc-v2-mid="' + mid.replace(/["\\]/g, '\\$&') + '"]') : null;
        if (field) field.focus({ preventScroll: true });
      }
      return true;
    }
    return false;
  }

  // ── the Unmatched supplier emails tray ──

  function trayCount() {
    var t = state.rep.tray;
    var c = t.data && t.data.counts;
    if (!c) return null;
    return (Number(c.needs_confirmation) || 0) + (Number(c.unmatched_order_desk) || 0);
  }

  function trayBtnHtml() {
    var t = state.rep.tray;
    var n = trayCount();
    var count = t.status === 'error' ? ' <b class="dpc-tray-n dpc-tray-n-fail">?</b>' : n === null ? '' : ' <b class="dpc-tray-n' + (n ? ' on' : '') + '">' + n + '</b>';
    return '<button type="button" class="dpc-tray-btn" data-dpc-tray-toggle aria-expanded="' + t.open + '" aria-controls="dpc-tray">Unmatched supplier emails' + count + '</button>';
  }

  // Every job listed in Active and Archive, for "Put on job".
  function trayJobs() {
    var seen = {};
    var out = [];
    state.base.rows.concat(state.arch.rows).forEach(function (r) {
      if (!r || seen[r.id] || isMakesafe(r)) return;
      seen[r.id] = true;
      out.push(r);
    });
    return out;
  }

  function trayItemHtml(t, m) {
    var busy = t.busy[m.id];
    var off = busy ? ' disabled' : '';
    var guess = m.state === 'needs_confirmation';
    var h = '<li class="dpc-rep' + (guess ? ' dpc-rep-guess' : '') + '" data-dpc-tray-item="' + esc(m.id) + '"><div class="dpc-rep-top"><strong>' + esc(text(m.supplier_name) || text(m.from_email) || 'Unknown sender') + '</strong>' + rungHtml(m) +
      '<span class="dpc-grow"></span><span class="dpc-muted">' + esc(parseStamp(m.received_at) ? stampText(m.received_at) : '') + '</span></div>';
    if (text(m.from_email)) h += '<p class="dpc-rep-why">' + esc(text(m.from_email)) + '</p>';
    if (text(m.subject)) h += '<p class="dpc-rep-subj">' + esc(text(m.subject)) + '</p>';
    if (text(m.snippet)) h += '<p class="dpc-rep-snip">' + esc(text(m.snippet)) + '</p>';
    if (text(m.delivery_label)) h += '<p class="dpc-rep-why">Delivery date in the email: ' + esc(text(m.delivery_label)) + '</p>';
    if (guess) {
      h += '<div class="dpc-rep-ask"><span class="dpc-grow">Best guess: ' + esc(text(m.job_number) || 'a job') + (text(m.match_reason) ? '. ' + esc(text(m.match_reason)) + '.' : '.') + '</span>' +
        '<button type="button" class="dpc-primary" data-dpc-tray-confirm="' + esc(m.id) + '"' + off + '>' + (busy === 'confirm' ? 'Saving...' : 'Yes, this job') + '</button>' +
        '<button type="button" data-dpc-tray-reject="' + esc(m.id) + '"' + off + '>' + (busy === 'reject' ? 'Saving...' : 'Not this one') + '</button></div>';
      return h + '</li>';
    }
    var cands = Array.isArray(m.candidates) ? m.candidates.filter(function (c) { return isObj(c) && c.job_id; }) : [];
    if (cands.length) {
      h += '<div class="dpc-tray-cands"><span>Could be:</span>' + cands.map(function (c) {
        return '<button type="button" data-dpc-tray-assign="' + esc(m.id) + '" data-job="' + esc(c.job_id) + '" data-order="' + esc(c.order_id || '') + '"' + off + '>' +
          esc((text(c.job_number) || 'Job') + (text(c.reason) ? ', ' + text(c.reason) : '')) + '</button>';
      }).join('') + '</div>';
    }
    var jobs = trayJobs();
    var pick = t.pick[m.id] || '';
    h += '<div class="dpc-tray-pick"><label class="dpc-vh" for="dpc-tray-job-' + esc(m.id) + '">Job for this email</label><select id="dpc-tray-job-' + esc(m.id) + '" data-dpc-tray-job="' + esc(m.id) + '"' + off + '><option value="">Pick the job</option>' +
      jobs.map(function (r) { return '<option value="' + esc(r.id) + '"' + (pick === r.id ? ' selected' : '') + '>' + esc(cardTitle(r)) + '</option>'; }).join('') + '</select>' +
      '<button type="button" data-dpc-tray-put="' + esc(m.id) + '"' + (busy || !pick ? ' disabled' : '') + '>' + (busy === 'assign' ? 'Saving...' : 'Put on job') + '</button>';
    if (t.hideAsk === m.id) {
      h += '</div><div class="dpc-rep-ask" role="group" aria-label="Hide this email"><span class="dpc-grow">Hide this email from the tray? It stays in admin@.</span>' +
        '<button type="button" class="dpc-primary" data-dpc-tray-hide-go="' + esc(m.id) + '"' + off + '>' + (busy === 'hide' ? 'Hiding...' : 'Hide') + '</button>' +
        '<button type="button" data-dpc-tray-hide-no' + off + '>Keep</button></div>';
    } else {
      h += '<button type="button" class="dpc-textbtn" data-dpc-tray-hide="' + esc(m.id) + '"' + off + '>Hide</button></div>';
    }
    return h + '</li>';
  }

  function trayHtml() {
    var t = state.rep.tray;
    if (!t.open) return '<div data-dpc-region="tray" hidden></div>';
    var h = '<div class="dpc-panel dpc-tray" data-dpc-region="tray" id="dpc-tray" role="region" aria-label="Unmatched supplier emails"><div class="dpc-row"><h3 class="dpc-grow">Unmatched supplier emails</h3>';
    h += '<label class="dpc-tray-other"><input type="checkbox" data-dpc-tray-other' + (t.other ? ' checked' : '') + '> Also show accounts and other supplier mail</label></div>';
    h += '<p class="dpc-empty dpc-empty-tight">Supplier emails that could not be matched to a job, and best guesses to check. Pick the job, and it moves to that job\'s Emails.</p>';
    if (t.msg) h += repMsgHtml(t.msg);
    if (t.status === 'error') return h + failLine('Could not load the unmatched supplier emails.', 'tray', true) + '</div>';
    if (!t.data) return h + '<p class="dpc-empty">Reading supplier emails...</p></div>';
    if (!t.data.emails.length) return h + '<p class="dpc-empty">Nothing to sort. Every supplier email is on a job.</p></div>';
    h += '<ul class="dpc-rep-list">' + t.data.emails.map(function (m) { return trayItemHtml(t, m); }).join('') + '</ul>';
    return h + '</div>';
  }

  var TRAY_FOCUS_KEYS = ['data-dpc-tray-confirm', 'data-dpc-tray-reject', 'data-dpc-tray-assign', 'data-dpc-tray-job', 'data-dpc-tray-put', 'data-dpc-tray-hide', 'data-dpc-tray-hide-go', 'data-dpc-tray-other'];
  function paintTray() {
    var btn = root() ? root().querySelector('[data-dpc-tray-toggle]') : null;
    if (btn) {
      var had = document.activeElement === btn;
      btn.outerHTML = trayBtnHtml();
      if (had) root().querySelector('[data-dpc-tray-toggle]').focus({ preventScroll: true });
    }
    var el = region('tray');
    if (!el) return;
    var a = document.activeElement;
    var sel = a && el.contains(a) ? TRAY_FOCUS_KEYS.filter(function (k) { return a.hasAttribute(k); }).map(function (k) {
      return '[' + k + '="' + String(a.getAttribute(k)).replace(/["\\]/g, '\\$&') + '"]';
    }).join('') : '';
    painting = true;
    try { el.outerHTML = trayHtml(); } finally { painting = false; }
    var now = sel && region('tray') ? region('tray').querySelector(sel) : null;
    if (now && !now.disabled) now.focus({ preventScroll: true });
  }

  // ───────────────────────── v2 Materials: draft list, supplier boxes and order emails (v2 slices 5 and 6) ─────────────────────────
  //
  // How a materials order goes out in Dispatch v2:
  //   1. Type the list on the Draft list (or fill it from the scope), with a
  //      photo of a handwritten list if there is one.
  //   2. Add a supplier box per supplier and drag each line into its box (or
  //      use the line's "Move to" box, which works on a phone).
  //   3. Make email: a held email in Shaun's template, From admin@, To and CC
  //      from the app-kept approved list. Every field can be edited.
  //   4. Send now asks "Send this order to <Supplier>?" first. A TEST copy
  //      to admin@ (its own TEST ONLY confirm) can be sent before it, but is
  //      not required (Shaun's ruling on the preview, 23 Oct).
  // One email per supplier box at a time. Nothing here makes a purchase order:
  // v2 has none. Every read and write is an ops-api dispatch_v2_* action
  // (secureworks-backend contract: Dispatch v2 supplier order emails). Each
  // write is sent once, on a person's press or on leaving a box they changed;
  // nothing sends or retries on its own. Only dispatch_v2_send_email sends.

  var V2_FROM = 'admin@secureworkswa.com.au';
  var V2_STANDING = ['4 x bags of quickset', 'Fixings, Post Caps and Screws as necessary'];
  var V2_LINE_FIELDS = ['description', 'quantity', 'unit', 'detail', 'profile', 'colour'];
  var V2_PHOTO_LIMIT = 3000000; // Outlook's limit per attachment; the server checks the real bytes
  var V2_PHOTO_AIM = 2700000; // the screen shrinks a photo to under this first
  var V2_PHOTO_SIDE = 2000; // longest side, in pixels, after shrinking
  var V2_EMAIL_PHOTOS = 3; // the most photos one email carries
  var V2_FIND_MS = 250;
  var V2_DETAIL_WORDS = { date: 'Date', address: 'Address', contact: 'Contact' };
  var V2_USED_FOR = { fencing: 'Fencing', patio: 'Patio', 'fencing+patio': 'Fencing and patio', any: 'Any job' };
  var EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

  // ── the read, made into what the screen draws ──

  function v2Entry(jobId) { return (jobId && state.v2m.jobs[jobId]) || null; }

  function v2Arr(v) { return Array.isArray(v) ? v.map(text).filter(Boolean) : []; }

  // A long dash from the server is shown as a comma, never as itself.
  function v2Plain(v) { return text(v).replace(/\s*[\u2013\u2014]\s*/g, ', '); }

  function v2LineFrom(l) {
    var q = l.quantity;
    return {
      id: String(l.id), supplier_id: l.supplier_id == null ? null : String(l.supplier_id),
      description: text(l.description), quantity: typeof q === 'number' && isFinite(q) ? q : null, unit: text(l.unit),
      detail: l.detail == null ? '' : String(l.detail).trim(), profile: text(l.profile), colour: text(l.colour),
      status: matSettable(l.status) ? l.status : 'not_reviewed', source: text(l.source), position: Number(l.position) || 0,
      locked: l.locked === true, sentOn: l.sent_on_email_id ? String(l.sent_on_email_id) : null, updated_at: l.updated_at || null
    };
  }

  function v2PhotoFrom(p) {
    return {
      id: String(p.id), supplier_id: p.supplier_id == null ? null : String(p.supplier_id), file_name: text(p.file_name) || 'Photo',
      size_bytes: Number(p.size_bytes) || 0, added_at: p.added_at || null
    };
  }

  function v2EmailFrom(m) {
    if (!isObj(m) || !m.id) return null;
    return {
      id: String(m.id), supplier_id: m.supplier_id == null ? null : String(m.supplier_id), supplier_name: text(m.supplier_name),
      status: text(m.status), from: text(m.from) || V2_FROM, to: v2Arr(m.to), cc: v2Arr(m.cc), team_cc: text(m.team_cc),
      subject: m.subject == null ? '' : String(m.subject), body: m.body_text == null ? '' : String(m.body_text), edited: m.edited === true,
      delivery_date: text(m.delivery_date), fulfilment: v2Fulfil(m.fulfilment), is_main: m.is_main_supplier === true, standing: m.standing_lines_included === true,
      line_count: Number(m.line_count) || 0, photo_ids: v2Arr(m.photo_ids), missing: v2Arr(m.empty_detail_lines),
      test: isObj(m.test) && m.test.sent_at ? m.test : null, sent: isObj(m.sent) && m.sent.sent_at ? m.sent : null,
      last_error: text(m.last_error), updated_at: m.updated_at || null
    };
  }

  function v2ByPos(a, b) { return a.position - b.position; }

  // Delivery or pickup as the server says it, else null (an older server).
  function v2Fulfil(v) { return v === 'pickup' || v === 'delivery' ? v : null; }

  // The box's choice by Make email: picked here, else the box's own, else
  // Delivery.
  function v2FulfilOf(e, b) { return v2Fulfil((e.fulfil || {})[b.supplier_id]) || b.fulfilment || 'delivery'; }

  function v2BoxFrom(s) {
    var ap = isObj(s.approved_email) ? s.approved_email : null;
    return {
      supplier_id: String(s.supplier_id), name: text(s.name) || 'Name not recorded', active: s.active !== false, position: Number(s.position) || 0,
      is_main: s.is_main === true,
      approved: ap ? { id: ap.id, name: text(ap.name), used_for: text(ap.used_for), to: v2Arr(ap.to), cc: v2Arr(ap.cc) } : null,
      blocked: isObj(s.send_blocked) ? { code: text(s.send_blocked.code), message: v2Plain(s.send_blocked.message) } : null,
      lines: (Array.isArray(s.lines) ? s.lines : []).filter(function (l) { return isObj(l) && l.id; }).map(v2LineFrom).sort(v2ByPos),
      photos: (Array.isArray(s.photos) ? s.photos : []).filter(function (p) { return isObj(p) && p.id; }).map(v2PhotoFrom),
      open: v2EmailFrom(s.open_email),
      sent: (Array.isArray(s.sent_emails) ? s.sent_emails : []).map(v2EmailFrom).filter(Boolean),
      fulfilment: v2Fulfil(s.fulfilment),
      stage: v2StageFrom(s.material_stage),
      // The payment step (section 3c): null from an older server.
      payment: v2PayFrom(s.payment)
    };
  }

  // The order's material stage (backend contract section 3b): picked by a
  // person, or worked out from the box's emails and lines. set_at is the
  // stamp the press guards on (null = no stage of its own yet).
  var V2_STAGES = [
    { key: 'order_materials', label: 'Order materials' },
    { key: 'sent', label: 'Sent to supplier' },
    { key: 'quote_received', label: 'Quote received' },
    { key: 'awaiting_payment', label: 'Awaiting payment' },
    { key: 'order_confirmed', label: 'Order confirmed' },
    { key: 'manufacturing', label: 'Manufacturing' },
    { key: 'ready', label: 'Materials ready' },
    { key: 'delivered', label: 'Delivered' }
  ];
  function v2StageLabel(key) {
    for (var i = 0; i < V2_STAGES.length; i++) if (V2_STAGES[i].key === key) return V2_STAGES[i].label;
    return null;
  }
  // A stage's place in the list (0 to 7), or -1 when unknown.
  function v2StageAt(key) {
    for (var i = 0; i < V2_STAGES.length; i++) if (V2_STAGES[i].key === key) return i;
    return -1;
  }
  // Where a stage came from: picked by a person (set), moved by a matched
  // supplier reply (reply) or by Mark paid / Pay on (payment), else worked
  // out. An unknown value reads as worked out.
  var V2_STAGE_SOURCES = ['set', 'reply', 'payment'];
  function v2StageFrom(m) {
    if (!isObj(m) || !v2StageLabel(m.key)) return null;
    var r = isObj(m.reply) ? m.reply : null;
    return {
      box_id: text(m.box_id) || null, key: m.key, label: text(m.label) || v2StageLabel(m.key),
      source: V2_STAGE_SOURCES.indexOf(m.source) >= 0 ? m.source : 'worked_out', set_at: text(m.set_at) || null, set_by_email: text(m.set_by_email) || null,
      // Piece B (section 3c): the reply that moved it, a confirmed date the
      // payment step is holding, and a pickup on the install's first day that
      // skips Materials ready. All absent from an older server.
      reply: r ? { email_id: text(r.email_id) || null, received_at: text(r.received_at) || null } : null,
      held_by_payment: m.held_by_payment === true, skips_ready: m.skips_ready === true
    };
  }

  // A stage's word on this box: a pickup's last stage is Picked up. Only from
  // a server that knows the payment step (it sends the payment object, or
  // says Picked up itself); an older one keeps Delivered, as today.
  function v2StageWord(b, key) {
    var knows = b && (b.payment || (b.stage && b.stage.key === 'delivered' && b.stage.label === 'Picked up'));
    if (key === 'delivered' && knows && b.fulfilment === 'pickup') return 'Picked up';
    return v2StageLabel(key);
  }

  // A dispatch_v2_materials answer missing its draft list or its boxes is a
  // failed read, never an empty tab.
  function v2From(resp) {
    if (!isObj(resp) || !isObj(resp.draft_list) || !Array.isArray(resp.draft_list.lines) || !Array.isArray(resp.draft_list.photos) ||
      !Array.isArray(resp.suppliers)) throw new Error('Unexpected materials answer');
    var team = isObj(resp.team_cc) ? resp.team_cc : {};
    return {
      jobNumber: text(resp.job_number), workType: text(resp.work_type).toLowerCase(),
      teamCc: { email: text(team.email), question: v2Plain(team.open_question) },
      from: text(resp.from) || V2_FROM, testDone: resp.test_send_done === true,
      mainId: resp.main_supplier_id ? String(resp.main_supplier_id) : null, mainTicked: resp.main_supplier_ticked === true,
      canSuggest: resp.can_suggest === true,
      draft: {
        lines: resp.draft_list.lines.filter(function (l) { return isObj(l) && l.id; }).map(v2LineFrom).sort(v2ByPos),
        photos: resp.draft_list.photos.filter(function (p) { return isObj(p) && p.id; }).map(v2PhotoFrom)
      },
      boxes: resp.suppliers.filter(function (s) { return isObj(s) && s.supplier_id; }).map(v2BoxFrom).sort(v2ByPos)
    };
  }

  function v2New(jobId) {
    return {
      jobId: jobId, status: 'loading', token: 0, d: null, rereading: false,
      // Lines added and not saved yet: { id, supplier_id, status }. What is
      // typed in any line (saved or not) is in typed[id][field] until saved,
      // and typedAt[id] is the line's stamp when the typing began.
      local: [], typed: {}, typedAt: {}, again: {}, more: {},
      mailTyped: {}, mailAt: {}, mailAgain: {},
      dates: {}, fulfil: {}, busy: {}, msg: {}, notice: '', ask: null
    };
  }

  // Every box key: null is the draft list.
  function v2Key(sid) { return sid == null || sid === '' || sid === 'draft' ? null : String(sid); }
  function v2KeyAttr(sid) { return sid == null ? 'draft' : sid; }

  function v2Box(e, sid) {
    if (!e || !e.d || sid == null) return null;
    for (var i = 0; i < e.d.boxes.length; i++) if (e.d.boxes[i].supplier_id === sid) return e.d.boxes[i];
    return null;
  }

  function v2ListOf(e, sid) { var b = v2Box(e, sid); return sid == null ? e.d.draft.lines : b ? b.lines : null; }
  function v2PhotosOf(e, sid) { var b = v2Box(e, sid); return sid == null ? e.d.draft.photos : b ? b.photos : null; }

  // A saved line, wherever it sits.
  function v2Line(e, id) {
    if (!e || !e.d) return null;
    var lists = [e.d.draft.lines].concat(e.d.boxes.map(function (b) { return b.lines; }));
    for (var i = 0; i < lists.length; i++) for (var j = 0; j < lists[i].length; j++) if (lists[i][j].id === id) return lists[i][j];
    return null;
  }

  function v2Local(e, id) {
    for (var i = 0; i < e.local.length; i++) if (e.local[i].id === id) return e.local[i];
    return null;
  }

  function v2Photo(e, id) {
    if (!e || !e.d) return null;
    var lists = [e.d.draft.photos].concat(e.d.boxes.map(function (b) { return b.photos; }));
    for (var i = 0; i < lists.length; i++) for (var j = 0; j < lists[i].length; j++) if (lists[i][j].id === id) return lists[i][j];
    return null;
  }

  // Take a saved line out of its list; put it at the end of another.
  function v2Unlist(e, id) {
    var lists = [e.d.draft.lines].concat(e.d.boxes.map(function (b) { return b.lines; }));
    lists.forEach(function (list) { for (var i = list.length - 1; i >= 0; i--) if (list[i].id === id) list.splice(i, 1); });
  }
  function v2Place(e, l) {
    v2Unlist(e, l.id);
    var list = v2ListOf(e, l.supplier_id);
    if (!list) return;
    list.push(l);
    list.sort(v2ByPos);
  }

  function v2Unphoto(e, id) {
    var lists = [e.d.draft.photos].concat(e.d.boxes.map(function (b) { return b.photos; }));
    lists.forEach(function (list) { for (var i = list.length - 1; i >= 0; i--) if (list[i].id === id) list.splice(i, 1); });
  }

  // A cell's text as the box shows it: what is typed, else what is saved.
  function v2Saved(l, f) {
    if (!l || l.local) return '';
    return f === 'quantity' ? matQtyText(l.quantity) : String(l[f] == null ? '' : l[f]);
  }
  function v2Cell(e, l, f) {
    var t = e.typed[l.id];
    return t && Object.prototype.hasOwnProperty.call(t, f) ? t[f] : v2Saved(l, f);
  }

  // The fields typed that differ from the saved line.
  function v2Changed(e, l) {
    var t = e.typed[l.id] || {};
    return V2_LINE_FIELDS.filter(function (f) {
      return Object.prototype.hasOwnProperty.call(t, f) && text(t[f]) !== text(v2Saved(l, f));
    });
  }

  // A fresh read over what the screen holds: lines still being typed in keep
  // their text while the saved line is the one it was typed over.
  function v2Merge(e, d) {
    var keep = {};
    e.local = e.local.filter(function (l) { return l.supplier_id == null || d.boxes.some(function (b) { return b.supplier_id === l.supplier_id; }); });
    e.local.forEach(function (l) { keep[l.id] = true; });
    var old = e.d;
    e.d = d;
    Object.keys(e.typed).forEach(function (id) {
      if (keep[id]) return;
      var now = v2Line(e, id);
      if (!now || now.locked || (e.typedAt[id] !== undefined && e.typedAt[id] !== now.updated_at && !e.busy['line:' + id])) {
        delete e.typed[id];
        delete e.typedAt[id];
      }
    });
    Object.keys(e.mailTyped).forEach(function (id) {
      var m = v2OpenById(e, id);
      if (!m || m.status !== 'draft' || (e.mailAt[id] !== m.updated_at && !e.busy['mail:' + id])) { delete e.mailTyped[id]; delete e.mailAt[id]; }
    });
    return old;
  }

  function v2OpenById(e, id) {
    if (!e || !e.d) return null;
    for (var i = 0; i < e.d.boxes.length; i++) { var m = e.d.boxes[i].open; if (m && m.id === id) return m; }
    return null;
  }
  function v2BoxOfEmail(e, id) {
    if (!e || !e.d) return null;
    for (var i = 0; i < e.d.boxes.length; i++) { var m = e.d.boxes[i].open; if (m && m.id === id) return e.d.boxes[i]; }
    return null;
  }

  // The lines a Make email takes: not In stock, not sent.
  function v2Orderable(box) { return box.lines.filter(function (l) { return !l.locked && l.status !== 'in_stock'; }); }

  // The supplier's short name from the approved list, for "Send this order to Stratco?".
  function v2SupWord(box) { return (box && box.approved && box.approved.name) || (box && box.name) || 'this supplier'; }

  function v2Mb(bytes) {
    var mb = (Number(bytes) || 0) / 1000000;
    return (mb > 0 && mb < 0.1 ? '0.1' : mb.toFixed(1)) + ' MB';
  }
  function v2Count(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ── reads ──

  function loadV2(row) {
    if (!row || !row.id || isMakesafe(row)) return;
    if (!v2Entry(row.id)) state.v2m.jobs[row.id] = v2New(row.id);
    readV2(row.id, false);
  }

  // quiet keeps what is drawn until the new answer lands (a re-read after a write).
  function readV2(jobId, quiet) {
    var e = v2Entry(jobId) || (state.v2m.jobs[jobId] = v2New(jobId));
    var token = ++e.token;
    if (!quiet || e.status !== 'ok') { e.status = 'loading'; paintV2If(jobId); }
    return Promise.resolve().then(function () { return global.opsFetch('dispatch_v2_materials', { job_id: jobId }); }).then(function (resp) {
      if (token !== e.token) return;
      v2Merge(e, v2From(resp));
      e.status = 'ok';
      paintV2If(jobId);
      // A fencing job with an empty list that was never filled: fill it from
      // the scope now, once, so nobody has to press Fill from the scope.
      if (resp.auto_fill === true && !e.autoTried && !e.local.length) { e.autoTried = true; v2Suggest(jobId, true); }
    }).catch(function () {
      if (token !== e.token) return;
      // A quiet re-read that fails keeps the last good answer on screen.
      if (!(quiet && e.d)) e.status = 'error';
      else e.notice = 'Could not load the latest materials. What is shown may be out of date.';
      paintV2If(jobId);
    });
  }

  // A write was refused because something changed elsewhere: say so, then
  // one quiet re-read shows the latest.
  function v2Changed409(jobId, words) {
    var e = v2Entry(jobId);
    if (!e) return;
    e.notice = words || 'This changed somewhere else. Showing the latest.';
    paintV2If(jobId);
    if (e.rereading) return;
    e.rereading = true;
    readV2(jobId, true).then(function () { e.rereading = false; }, function () { e.rereading = false; });
  }

  function v2Ok(resp) {
    if (!isObj(resp) || resp.success !== true) throw new Error('Unexpected answer');
    return resp;
  }

  // A refusal the screen words itself. changed: re-read, the screen was out of date.
  var V2_CHANGED = ['line_changed', 'line_not_on_job', 'supplier_not_on_job', 'email_changed', 'email_not_editable', 'email_not_discardable',
    'email_not_sendable', 'job_not_found', 'stage_changed', 'box_not_found'];
  function v2Words(err, fallback) {
    var code = err && err.code;
    if (code === 'line_locked') return { changed: true, text: 'That line went out on a sent order, so it cannot be changed.' };
    if (code === 'stage_changed') return { changed: true, text: 'This order\'s stage was changed somewhere else. Showing the latest.' };
    if (V2_CHANGED.indexOf(code) >= 0) return { changed: true, text: 'This changed somewhere else. Showing the latest.' };
    if (code === 'too_many_lines') return { text: 'A job can hold 500 lines at most.' };
    if (code === 'too_many_photos') return { text: 'A job can hold 20 photos at most. Delete one first.' };
    if (code === 'photo_on_email') return { text: 'That photo is on an order email. Take it off the email, or discard the email, first.' };
    if (code === 'supplier_has_lines') return { text: 'Move this box\'s lines and photos out first, then take the supplier off.' };
    if (code === 'supplier_has_emails') return { text: 'This supplier has an email on this job, so the box stays.' };
    if (code === 'supplier_inactive') return { text: 'That supplier contact is no longer active in Xero, so it cannot be added.' };
    if (code === 'supplier_not_found') return { text: 'That supplier was not found. Search again.' };
    if (code === 'no_suggestion_for_work_type') return { text: 'Fill from the scope works on fencing and patio jobs only. Type the lines in.' };
    if (code === 'lines_exist') return { changed: true, text: 'This job already has lines, so nothing was filled in. Showing the latest.' };
    if (code === 'scope_unreadable') return { text: 'The scope on this job could not be read, so nothing was filled in. Type the lines in.' };
    if (code === 'no_approved_email') return { text: 'This supplier has no approved order email, so Dispatch cannot send to it. Ask Shaun to add one.' };
    if (code === 'no_lines_to_order') return { text: 'Nothing in this box to order. In stock lines and lines already sent are left off.' };
    if (code === 'not_dispatch_work') return { text: 'Make-safe jobs are not ordered from Dispatch.' };
    if (code === 'invalid_request' && err && text(err.message) && !/^API error/.test(err.message)) return { text: v2Plain(err.message) };
    return fallback ? { text: fallback, retry: true } : null;
  }

  // Put a refusal on the screen: the line or box it belongs to, or the notice.
  function v2Fail(jobId, key, err, fallback) {
    var e = v2Entry(jobId);
    if (!e) return;
    var w = v2Words(err, fallback) || { text: fallback || 'Not done.', retry: true };
    if (w.changed) { e.msg[key] = { bad: true, text: w.text }; v2Changed409(jobId, w.text); return; }
    e.msg[key] = { bad: true, text: w.text, retry: !!w.retry };
    paintV2If(jobId);
  }

  // A refusal said without a Retry button, where Retry would do something else.
  function v2NoRetry(e, jobId, key) {
    if (e.msg[key] && e.msg[key].retry) { e.msg[key].retry = false; paintV2If(jobId); }
  }

  // ── lines ──

  function v2AddLine(jobId, sid) {
    var e = v2Entry(jobId);
    if (!e || e.status !== 'ok') return;
    var id = newId();
    e.local.push({ id: id, supplier_id: sid, status: 'to_order', local: true });
    e.typed[id] = {};
    paintV2();
    refocus('[data-dpc-v2-cell="description"][data-dpc-v2-id="' + id + '"]');
  }

  // Save one line: a new one (no stamp) once it has an item, or the changed
  // cells of a saved one against its stamp. Never two at once for a line: an
  // edit made while one is in flight goes after it.
  function v2SaveLine(jobId, id) {
    var e = v2Entry(jobId);
    if (!e || e.status !== 'ok') return;
    var loc = v2Local(e, id);
    var l = loc || v2Line(e, id);
    if (!l || l.locked) return;
    var key = 'line:' + id;
    if (e.busy[key]) { e.again[id] = true; return; }
    var t = e.typed[id] || {};
    var changed = loc ? V2_LINE_FIELDS.filter(function (f) { return text(t[f]) !== ''; }) : v2Changed(e, l);
    var statusWanted = loc ? null : t.status !== undefined && t.status !== l.status ? t.status : null;
    if (!changed.length && !statusWanted && !loc) return;
    var desc = text(v2Cell(e, l, 'description'));
    if (!desc) {
      if (loc) return; // an empty new row is never saved
      e.msg[key] = { bad: true, text: 'An item needs a name. To take the line off, press the cross.' };
      paintV2();
      return;
    }
    var q = matQty(v2Cell(e, l, 'quantity'));
    if (!q.ok) { e.msg[key] = { bad: true, text: q.msg + ' For example 14 or 2.5.' }; paintV2(); return; }
    var sentText = {};
    V2_LINE_FIELDS.forEach(function (f) { sentText[f] = v2Cell(e, l, f); });
    var status = loc ? (t.status || loc.status) : (statusWanted || l.status);
    var line = {
      id: id, description: desc, quantity: q.value, unit: text(sentText.unit) || null, detail: text(sentText.detail) || null,
      profile: text(sentText.profile) || null, colour: text(sentText.colour) || null, status: status
    };
    var body = { job_id: jobId, line: line };
    if (loc) line.supplier_id = loc.supplier_id; else body.expected_updated_at = l.updated_at;
    e.busy[key] = true;
    e.again[id] = false;
    delete e.msg[key];
    e.notice = '';
    paintV2If(jobId);
    Promise.resolve().then(function () { return global.opsPost('dispatch_v2_save_line', body); }).then(v2Ok).then(function (resp) {
      delete e.busy[key];
      if (!isObj(resp.line) || !resp.line.id) throw new Error('Unexpected answer');
      var fresh = v2LineFrom(resp.line);
      if (loc) e.local = e.local.filter(function (x) { return x.id !== id; });
      v2Place(e, fresh);
      // Keep only what was typed after this save went.
      var now = e.typed[id] || {};
      Object.keys(now).forEach(function (f) { if (f === 'status' ? now[f] === status : now[f] === sentText[f]) delete now[f]; });
      e.typedAt[id] = fresh.updated_at;
      if (e.again[id] || v2Changed(e, fresh).length) { e.again[id] = false; v2SaveLine(jobId, id); }
      paintV2If(jobId);
    }, function (err) {
      delete e.busy[key];
      e.again[id] = false;
      v2Fail(jobId, key, err, 'Not saved.');
    });
  }

  function v2SetStatus(jobId, id, status) {
    var e = v2Entry(jobId);
    if (!e || !matSettable(status)) return;
    var loc = v2Local(e, id);
    (e.typed[id] = e.typed[id] || {}).status = status;
    if (loc) { loc.status = status; return; }
    v2SaveLine(jobId, id);
  }

  // Move a line into a box, between boxes, or back to the draft list. A line
  // not saved yet just changes box; a saved one is moved by one write.
  function v2MoveLine(jobId, id, sid) {
    var e = v2Entry(jobId);
    if (!e || e.status !== 'ok') return;
    if (sid != null && !v2Box(e, sid)) return;
    var loc = v2Local(e, id);
    if (loc) { loc.supplier_id = sid; paintV2(); return; }
    var l = v2Line(e, id);
    var key = 'line:' + id;
    if (!l || l.locked || e.busy[key] || l.supplier_id === sid) { paintV2(); return; }
    var from = l.supplier_id;
    e.busy[key] = true;
    delete e.msg[key];
    e.notice = '';
    // Shown in its new box at once; put back if the move is refused.
    l.supplier_id = sid;
    v2Place(e, l);
    paintV2();
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_v2_move_line', { job_id: jobId, id: id, supplier_id: sid, expected_updated_at: l.updated_at });
    }).then(v2Ok).then(function (resp) {
      delete e.busy[key];
      if (isObj(resp.line) && resp.line.id) {
        var fresh = v2LineFrom(resp.line);
        v2Place(e, fresh);
        if (e.typedAt[id] !== undefined) e.typedAt[id] = fresh.updated_at;
      }
      paintV2If(jobId);
      // Anything typed in the line while it moved goes now, on the new stamp.
      var moved = v2Line(e, id);
      if (moved && v2Changed(e, moved).length) v2SaveLine(jobId, id);
    }, function (err) {
      delete e.busy[key];
      var back = v2Line(e, id);
      if (back) { back.supplier_id = from; v2Place(e, back); }
      // No Retry button: the line's Retry saves its cells, so a failed move
      // is simply made again.
      v2Fail(jobId, key, err, 'Not moved. Move it again.');
      v2NoRetry(e, jobId, key);
    });
  }

  function v2DeleteLine(jobId, id) {
    var e = v2Entry(jobId);
    if (!e || e.status !== 'ok') return;
    if (v2Local(e, id)) {
      e.local = e.local.filter(function (x) { return x.id !== id; });
      delete e.typed[id];
      paintV2();
      return;
    }
    var l = v2Line(e, id);
    var key = 'line:' + id;
    if (!l || l.locked || e.busy[key]) return;
    e.busy[key] = 'delete';
    delete e.msg[key];
    paintV2();
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_v2_delete_line', { job_id: jobId, id: id, expected_updated_at: l.updated_at });
    }).then(v2Ok).then(function () {
      delete e.busy[key];
      v2Unlist(e, id);
      delete e.typed[id];
      delete e.typedAt[id];
      paintV2If(jobId);
    }, function (err) {
      delete e.busy[key];
      v2Fail(jobId, key, err, 'Not taken off.');
    });
  }

  // auto: the screen filling a fencing job by itself when it opens (the
  // materials read said auto_fill). The server fills a job that way only
  // once, so a refusal for that just shows the latest, with no message.
  var V2_AUTO_QUIET = ['already_filled', 'lines_exist', 'no_auto_fill'];
  function v2Suggest(jobId, auto) {
    var e = v2Entry(jobId);
    if (!e || e.status !== 'ok' || e.busy.suggest) return;
    e.busy.suggest = true;
    delete e.msg.draft;
    paintV2();
    var body = auto ? { job_id: jobId, auto: true } : { job_id: jobId };
    Promise.resolve().then(function () { return global.opsPost('dispatch_v2_suggest_draft', body); }).then(v2Ok).then(function (resp) {
      delete e.busy.suggest;
      var n = Number(resp.added) || 0;
      // The scope reader's notes (a long panel, a height with no post rule, a
      // gate with no size) are shown under the message, never guessed into a line.
      var notes = Array.isArray(resp.notes) ? resp.notes.filter(function (t) { return typeof t === 'string' && t; }) : [];
      // The scope named a supplier with an approved order email: the lines
      // went straight into that supplier's box.
      var box = isObj(resp.supplier) ? text(resp.supplier.name) : '';
      var words = !n ? 'The scope had nothing to fill in. Type the lines in.'
        : box ? v2Count(n, 'line', 'lines') + ' filled in from the scope into the ' + box + ' box. Check each one, then press Make email on that box.'
        : v2Count(n, 'line', 'lines') + ' filled in from the scope. Check each one before ordering.';
      e.msg.draft = { text: words, notes: notes };
      readV2(jobId, true);
    }, function (err) {
      delete e.busy.suggest;
      if (auto && err && V2_AUTO_QUIET.indexOf(err.code) >= 0) { paintV2If(jobId); readV2(jobId, true); return; }
      v2Fail(jobId, 'draft', err, 'Nothing was filled in.');
    });
  }

  // ── supplier boxes ──

  function v2AddSupplier(jobId, supplierId) {
    var e = v2Entry(jobId);
    if (!e || e.status !== 'ok' || !supplierId || e.busy.add) return;
    e.busy.add = supplierId;
    delete e.msg.add;
    paintV2Find();
    Promise.resolve().then(function () { return global.opsPost('dispatch_v2_add_supplier', { job_id: jobId, supplier_id: supplierId }); }).then(v2Ok).then(function (resp) {
      delete e.busy.add;
      var s = isObj(resp.supplier) ? resp.supplier : {};
      state.v2m.find.open = false;
      paintV2If(jobId);
      e.msg['box:' + supplierId] = {
        text: resp.unchanged ? 'Already on this job.' : isObj(s.send_blocked)
          ? 'Added. This supplier has no approved order email, so you can split lines to it but Dispatch will not send to it.'
          : 'Added. Drag lines into this box, or use Move to on a line.'
      };
      readV2(jobId, true);
    }, function (err) {
      delete e.busy.add;
      var w = v2Words(err, 'Not added.') || { text: 'Not added.', retry: true };
      e.msg.add = { bad: true, text: w.text, retry: w.retry ? supplierId : null };
      if (w.changed) v2Changed409(jobId, w.text);
      paintV2If(jobId);
    });
  }

  function v2RemoveSupplier(jobId, sid) {
    var e = v2Entry(jobId);
    var key = 'box:' + sid;
    if (!e || e.status !== 'ok' || e.busy[key]) return;
    e.busy[key] = 'remove';
    delete e.msg[key];
    paintV2();
    Promise.resolve().then(function () { return global.opsPost('dispatch_v2_remove_supplier', { job_id: jobId, supplier_id: sid }); }).then(v2Ok).then(function () {
      delete e.busy[key];
      e.d.boxes = e.d.boxes.filter(function (b) { return b.supplier_id !== sid; });
      paintV2If(jobId);
      readV2(jobId, true);
    }, function (err) {
      delete e.busy[key];
      v2Fail(jobId, key, err, 'Not taken off.');
    });
  }

  // The main supplier tick (fencing only): the box whose email gets the two
  // standing lines. Unticking the ticked box clears the tick, and the server's
  // default (the box with the panels, else the first box) applies again.
  // One press: the order's material stage, set by hand. Never moves the job's
  // stage or status and sends nothing.
  function v2SetStage(jobId, sid, value) {
    var e = v2Entry(jobId);
    var b = v2Box(e, sid);
    var key = 'stage:' + sid;
    var label = v2StageLabel(value);
    if (!e || e.status !== 'ok' || !b || !b.stage || e.busy[key] || !label) return;
    e.busy[key] = true;
    delete e.msg[key];
    paintV2();
    var body = b.stage.box_id ? { box_id: b.stage.box_id } : { job_id: jobId, supplier_id: sid };
    body.material_stage = value;
    body.expected_set_at = b.stage.set_at;
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_v2_set_material_stage', body);
    }).then(v2Ok).then(function (resp) {
      delete e.busy[key];
      e.msg[key] = { text: 'Stage saved: ' + v2SupWord(b) + ', ' + (v2StageWord(b, value) || label) + '.' };
      if (!applyBoxArrival(jobId, resp)) { var r = rowById(jobId) || state.row; if (r) loadArrival(r); }
      if (state.jobId === jobId) paintArrival();
      paintList(true);
      // The list read again: the card's On us line and counts, from the server.
      loadBase();
      readV2(jobId, true);
    }, function (err) {
      delete e.busy[key];
      v2Fail(jobId, key, err, 'The stage was not saved.');
    });
  }

  // The open job's Arrival line entry for a supplier box, or null.
  function v2ArrivalOrder(sid) {
    var a = state.row ? arrivalFor(state.row).arrival : null;
    if (!a) return null;
    for (var i = 0; i < a.orders.length; i++) {
      var o = a.orders[i];
      if (o && o.source === 'supplier_box' && String(o.supplier_id) === sid) return o;
    }
    return null;
  }

  // The stage line under a box's head: the picker, who it waits on, who set
  // it, and the next thing to do.
  function v2StageHtml(e, b) {
    var s = b.stage;
    if (!s) return '';
    var key = 'stage:' + b.supplier_id;
    var busy = !!e.busy[key];
    var h = '<div class="dpc-v2-stage"><label class="dpc-v2-stage-pick"><span>Materials stage</span><select data-dpc-v2-stage="' + esc(b.supplier_id) + '"' +
      ' aria-label="Materials stage for ' + esc(b.name) + '"' + (busy ? ' disabled' : '') + '>';
    V2_STAGES.forEach(function (st) {
      // A pickup collected on the install's first day skips Materials ready.
      if (st.key === 'ready' && s.skips_ready && s.key !== 'ready') return;
      h += '<option value="' + st.key + '"' + (st.key === s.key ? ' selected' : '') + '>' + esc(v2StageWord(b, st.key)) + '</option>';
    });
    h += '</select></label>';
    var o = v2ArrivalOrder(b.supplier_id);
    if (o && o.waiting_on === 'us') h += '<span class="dpc-status dpc-tone-warn">On us</span>';
    else if (o && o.waiting_on === 'supplier') h += '<span class="dpc-status dpc-tone-muted">Waiting on the supplier</span>';
    if (o && o.extra === true) h += '<span class="dpc-flag dpc-flag-extra">Extra order</span>';
    // A counting Pay on tag shows once, on its own row under the stage.
    var bp = v2BoxPay(b);
    if (!(bp && bp.pay_on)) h += payPillHtml(bp);
    h += '<span class="dpc-v2-stage-who">' + esc(busy ? 'Saving...' : v2StageWho(b, s)) + '</span>';
    if (o && text(o.todo)) h += '<p class="dpc-v2-hint dpc-v2-stage-next">Next: ' + esc(o.todo) + '</p>';
    if (s.held_by_payment) h += '<p class="dpc-v2-hint">The supplier\'s date is saved. This order stays at Awaiting payment until someone presses Mark paid.</p>';
    h += '</div>';
    return h + v2MsgHtml(e.msg[key]) + v2PayHtml(e, b);
  }

  // Who or what put the box at its stage.
  function v2StageWho(b, s) {
    if (s.source === 'set') return 'Set' + (s.set_by_email ? ' by ' + s.set_by_email : '') + (s.set_at ? ', ' + stampText(s.set_at) : '');
    if (s.source === 'reply') return 'Moved here by their reply' + (s.reply && s.reply.received_at ? ', ' + stampText(s.reply.received_at) : '');
    if (s.source === 'payment') {
      var p = v2BoxPay(b);
      if (p && p.paid) return 'Moved here when marked paid' + (p.paid_at ? ', ' + stampText(p.paid_at) : '');
      if (p && p.pay_on) return 'Moved here by ' + payOnWord(p.pay_on) + (p.pay_on_set_at ? ', ' + stampText(p.pay_on_set_at) : '');
      return 'Moved here by the payment';
    }
    return 'Worked out from the emails and lines';
  }

  // ── The payment step (backend contract section 3c, piece B) ──
  // A supplier we have no account with is paid first: once their quote is in,
  // the order waits on us until someone records here that we paid. Mark paid
  // and Undo paid are records only: they pay nobody, touch no Xero, send
  // nothing and never move the job. Each is one press, sent once, guarded on
  // the paid stamp the box showed (compare and set). An ops-api that does not
  // send the payment object yet shows no payment buttons at all.

  var PAY_STATES = ['not_needed', 'unpaid', 'paid', 'pay_on_pickup', 'pay_on_delivery', 'unknown'];

  // The box's payment as the server says it, or null (an older server, or a
  // purchase order with no box).
  function v2PayFrom(p) {
    if (!isObj(p) || PAY_STATES.indexOf(p.state) < 0) return null;
    var g = isObj(p.guard) ? p.guard : {};
    return {
      terms: text(p.terms) || 'unknown', state: p.state, paid: p.paid === true,
      paid_at: text(p.paid_at) || null, paid_by_email: text(p.paid_by_email) || null,
      pay_on: p.pay_on === 'pickup' || p.pay_on === 'delivery' ? p.pay_on : null,
      pay_on_set_at: text(p.pay_on_set_at) || null, pay_on_set_by_email: text(p.pay_on_set_by_email) || null,
      earlier_order_paid_at: text(p.earlier_order_paid_at) || null,
      holds_stage: p.holds_stage === true, blocks_job_move: p.blocks_job_move === true,
      can_mark_paid: p.can_mark_paid === true, can_undo_paid: p.can_undo_paid === true, can_set_pay_on: p.can_set_pay_on === true,
      // The stored stamps the presses guard on (null = never set).
      guard: { paid_at: text(g.paid_at) || null, pay_on_set_at: text(g.pay_on_set_at) || null }
    };
  }

  // A box's payment: the materials read's own, else the Arrival line's.
  function v2BoxPay(b) {
    if (!b) return null;
    if (b.payment) return b.payment;
    var o = v2ArrivalOrder(b.supplier_id);
    return o ? v2PayFrom(o.payment) : null;
  }

  // Which box a press is for: its id when the screen knows it, else the job
  // and the supplier (one box per supplier per job).
  function v2BoxRef(jobId, b) {
    var o = v2ArrivalOrder(b.supplier_id);
    var id = (b.stage && b.stage.box_id) || (o && text(o.box_id)) || null;
    return id ? { box_id: id } : { job_id: jobId, supplier_id: b.supplier_id };
  }

  var PAY_ACTIONS = { paid: 'dispatch_v2_mark_paid', unpaid: 'dispatch_v2_undo_paid', payon: 'dispatch_v2_set_pay_on' };

  // "Pay on pickup" or "Pay on delivery".
  function payOnWord(v) { return v === 'pickup' ? 'Pay on pickup' : 'Pay on delivery'; }

  function v2PayDoneWords(kind, b, resp, payOn) {
    var name = v2SupWord(b);
    if (kind === 'payon' && payOn) return resp.unchanged ? 'No change: ' + name + ' was already set to ' + payOnWord(payOn).toLowerCase() + '.' : payOnWord(payOn) + ' set: ' + name + '. The order counts as confirmed. Nothing was paid or sent.';
    if (kind === 'payon') return resp.unchanged ? 'No change: ' + name + ' had no pay on tag.' : 'Pay on tag taken off: ' + name + '.';
    if (kind === 'paid') return resp.unchanged ? 'No change: ' + name + ' was already marked paid.' : 'Marked paid: ' + name + '. This is a record only: nobody was paid and nothing was sent.';
    return resp.unchanged ? 'No change: ' + name + ' had no paid mark.' : 'Paid mark taken off: ' + name + '.';
  }

  // A payment press refused: what to say, and whether the box was out of date.
  function v2PayWords(err, b) {
    var code = err && err.code;
    var name = v2SupWord(b);
    if (code === 'paid_changed') return { changed: true, text: 'The paid mark on ' + name + ' was changed somewhere else. Showing the latest.' };
    if (code === 'pay_on_changed') return { changed: true, text: 'The pay on tag on ' + name + ' was changed somewhere else. Showing the latest.' };
    if (code === 'on_account') return { changed: true, text: name + ' is on account, so there is no payment to mark. Showing the latest.' };
    if (code === 'box_not_found') return { changed: true, text: 'That supplier order is no longer on this job. Showing the latest.' };
    if (code === 'not_dispatch_work') return { text: 'Payments are not recorded on this job in Dispatch.' };
    if (code === 'dispatch_read_failed') return { text: 'Could not check ' + name + "'s account terms, so nothing was saved.", retry: true };
    return null;
  }

  // One press on a box's payment: Mark paid, Undo paid, or (kind payon)
  // Pay on pickup / Pay on delivery, payOn 'pickup' or 'delivery' to set the
  // tag and 'off' to take it off.
  function v2PayPress(jobId, sid, kind, payOn) {
    var e = v2Entry(jobId);
    var b = v2Box(e, sid);
    var p = v2BoxPay(b);
    var key = 'pay:' + sid;
    if (!e || e.status !== 'ok' || !b || !p || e.busy[key] || !PAY_ACTIONS[kind]) return;
    // Undo needs the stamp it takes off.
    if (kind === 'unpaid' && !p.guard.paid_at) return;
    // The tag to set (null = take it off); anything else is not a press.
    var tag = kind === 'payon' ? (payOn === 'pickup' || payOn === 'delivery' ? payOn : null) : undefined;
    if (kind === 'payon' && tag === null && payOn !== 'off') return;
    e.busy[key] = kind;
    delete e.msg[key];
    paintV2();
    var body = v2BoxRef(jobId, b);
    if (kind === 'payon') { body.pay_on = tag; body.expected_set_at = p.guard.pay_on_set_at; } else body.expected_paid_at = p.guard.paid_at;
    Promise.resolve().then(function () { return global.opsPost(PAY_ACTIONS[kind], body); }).then(v2Ok).then(function (resp) {
      delete e.busy[key];
      var fresh = isObj(resp.box) ? v2PayFrom(resp.box.payment) : null;
      if (fresh) b.payment = fresh;
      e.msg[key] = { text: v2PayDoneWords(kind, b, resp, tag) };
      v2PayAfter(jobId, resp);
    }, function (err) {
      delete e.busy[key];
      var fallback = kind === 'paid' ? 'Not marked paid.' : kind === 'unpaid' ? 'The paid mark was not taken off.' : tag ? payOnWord(tag) + ' was not set.' : 'The pay on tag was not taken off.';
      v2PayFail(jobId, key, err, b, { kind: kind, payOn: payOn }, fallback);
    });
  }

  // After a payment press: the answer's Arrival line onto the job and its
  // list row, then the list and the boxes read again from the server.
  function v2PayAfter(jobId, resp) {
    if (!applyBoxArrival(jobId, resp)) { var r = rowById(jobId) || state.row; if (r) loadArrival(r); }
    if (state.jobId === jobId) paintArrival();
    paintList(true);
    loadBase();
    readV2(jobId, true);
  }

  // A refusal under the box. Out of date: say so, then the box, the Arrival
  // line and the list are read again. press ({ kind }) is what Retry sends again.
  function v2PayFail(jobId, key, err, b, press, fallback) {
    var e = v2Entry(jobId);
    if (!e) return;
    var w = v2PayWords(err, b);
    if (w && w.changed) {
      e.msg[key] = { bad: true, text: w.text };
      v2Changed409(jobId, w.text);
      var r = rowById(jobId) || state.row;
      if (r && state.jobId === jobId) loadArrival(r);
      loadBase();
      return;
    }
    if (!w) w = v2Words(err, fallback) || { text: fallback, retry: true };
    e.msg[key] = { bad: true, text: w.text, retry: !!w.retry, press: press };
    paintV2If(jobId);
  }

  // Retry on a refused payment press: the same press again.
  function v2PayRetryAttrs(m, sid) {
    if (!m || !m.press) return null;
    return 'data-dpc-v2="' + esc(m.press.kind) + '" data-dpc-v2-sid="' + esc(sid) + '"' + (m.press.payOn ? ' data-dpc-v2-payon="' + esc(m.press.payOn) + '"' : '');
  }

  // The payment pill beside an order: Not paid yet (amber) on a pay-first
  // order nobody has marked paid, Paid (green) once someone has. Nothing on an
  // on-account order, and nothing from an older server (p is null).
  function payPillHtml(p) {
    if (!p) return '';
    if (p.state === 'unpaid') return '<span class="dpc-flag dpc-flag-amber dpc-paypill">Not paid yet</span>';
    if (p.state === 'paid') return '<span class="dpc-flag dpc-flag-paid dpc-paypill">Paid</span>';
    // Pay on pickup / delivery: confirmed without paying yet.
    if (p.state === 'pay_on_pickup' || p.state === 'pay_on_delivery') return '<span class="dpc-flag dpc-flag-payon dpc-paypill">' + payOnWord(p.state === 'pay_on_pickup' ? 'pickup' : 'delivery') + '</span>';
    return '';
  }

  // Mark paid (and what it does) on a pay-first box not paid for this order;
  // who marked it paid, with Undo paid, once it is.
  function v2PayHtml(e, b) {
    var p = v2BoxPay(b);
    if (!p) return '';
    var sid = esc(b.supplier_id);
    var key = 'pay:' + b.supplier_id;
    var busy = e.busy[key];
    var off = busy ? ' disabled' : '';
    var h = '';
    var payOn = v2PayOnBtnHtml(b, p, busy);
    if (p.can_mark_paid) {
      h += '<div class="dpc-v2-pay" role="group" aria-label="Payment for ' + esc(b.name) + '">';
      h += '<button type="button" class="dpc-v2-paybtn" data-dpc-v2="paid" data-dpc-v2-sid="' + sid + '"' + off + '>' + (busy === 'paid' ? 'Saving...' : 'Mark paid') + '</button>';
      h += payOn;
      h += '<small>Moves it to Order confirmed and records who paid and when. A record only: it pays nobody and sends nothing.</small></div>';
      if (p.earlier_order_paid_at) h += '<p class="dpc-v2-hint">An earlier order to ' + esc(v2SupWord(b)) + ' was marked paid ' + esc(stampText(p.earlier_order_paid_at)) + '. This order is not paid yet.</p>';
    } else if (p.paid && p.can_undo_paid) {
      h += '<div class="dpc-v2-pay" role="group" aria-label="Payment for ' + esc(b.name) + '">';
      h += '<span class="dpc-v2-paid">Paid, marked' + (p.paid_by_email ? ' by ' + esc(p.paid_by_email) : '') + (p.paid_at ? ', ' + esc(stampText(p.paid_at)) : '') + '</span>';
      h += '<button type="button" data-dpc-v2="unpaid" data-dpc-v2-sid="' + sid + '"' + off + '>' + (busy === 'unpaid' ? 'Saving...' : 'Undo paid') + '</button></div>';
    } else if (payOn) {
      // Pay on alone: an on-account box, or one with no Mark paid on offer.
      h += '<div class="dpc-v2-pay" role="group" aria-label="Payment for ' + esc(b.name) + '">' + payOn +
        '<small>Confirms the order now and records who set it. A record only: it pays nobody and sends nothing.</small></div>';
    }
    h += v2PayOnTagHtml(b, p, busy);
    return h + v2MsgHtml(e.msg[key], v2PayRetryAttrs(e.msg[key], b.supplier_id));
  }

  // Pay on pickup (or delivery, as the box goes out): the order is confirmed
  // now and paid on the day. Offered on any box the server allows it on
  // (on-account ones too, contract rule 6) that is not paid and has no tag.
  function v2PayOnBtnHtml(b, p, busy) {
    if (!p.can_set_pay_on || p.paid || p.pay_on) return '';
    var v = b.fulfilment === 'pickup' ? 'pickup' : 'delivery';
    return '<button type="button" class="dpc-v2-payon" data-dpc-v2="payon" data-dpc-v2-payon="' + v + '" data-dpc-v2-sid="' + esc(b.supplier_id) + '"' +
      (busy ? ' disabled' : '') + ' title="Confirms the order without paying now">' + (busy === 'payon' ? 'Saving...' : esc(payOnWord(v))) + '</button>';
  }

  // A pay on tag that counts: the tag, who set it, and Take off.
  function v2PayOnTagHtml(b, p, busy) {
    if (!p.pay_on) return '';
    var h = '<div class="dpc-v2-pay dpc-v2-payon-set" role="group" aria-label="' + esc(payOnWord(p.pay_on)) + ' for ' + esc(b.name) + '">';
    h += '<span class="dpc-flag dpc-flag-payon">' + esc(payOnWord(p.pay_on)) + '</span>';
    h += '<span class="dpc-v2-stage-who">Set' + (p.pay_on_set_by_email ? ' by ' + esc(p.pay_on_set_by_email) : '') + (p.pay_on_set_at ? ', ' + esc(stampText(p.pay_on_set_at)) : '') +
      '. The order counts as confirmed.</span>';
    h += '<button type="button" class="dpc-textbtn" data-dpc-v2="payon" data-dpc-v2-payon="off" data-dpc-v2-sid="' + esc(b.supplier_id) + '"' + (busy ? ' disabled' : '') + '>' +
      (busy === 'payon' ? 'Saving...' : 'Take off') + '</button></div>';
    return h;
  }

  function v2SetMain(jobId, sid, on) {
    var e = v2Entry(jobId);
    if (!e || e.status !== 'ok' || e.busy.main) return;
    e.busy.main = true;
    delete e.msg['box:' + sid];
    paintV2();
    Promise.resolve().then(function () {
      return global.opsPost('dispatch_v2_set_main_supplier', { job_id: jobId, supplier_id: on ? sid : null });
    }).then(v2Ok).then(function () {
      delete e.busy.main;
      readV2(jobId, true);
    }, function (err) {
      delete e.busy.main;
      v2Fail(jobId, 'box:' + sid, err, 'The main supplier was not changed.');
    });
  }

  // ── photos ──

  // A photo shrunk to a JPEG under the limit, as a data: URL. Null when the
  // browser cannot open the file as a picture (an iPhone HEIC on a PC, a PDF):
  // that file goes as it is, and the server says plainly why it cannot take it.
  function v2Shrink(file) {
    return new Promise(function (resolve) {
      var url = null;
      try { url = global.URL.createObjectURL(file); } catch (x) { /* no object URLs */ }
      if (!url) { resolve(null); return; }
      var img = new Image();
      img.onload = function () {
        try {
          var side = V2_PHOTO_SIDE, quality = 0.85, data = null;
          for (var i = 0; i < 6; i++) {
            var scale = Math.min(1, side / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
            c.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
            var g = c.getContext('2d');
            g.fillStyle = '#fff';
            g.fillRect(0, 0, c.width, c.height);
            g.drawImage(img, 0, 0, c.width, c.height);
            data = c.toDataURL('image/jpeg', quality);
            if (v2DataBytes(data) <= V2_PHOTO_AIM) break;
            side = Math.round(side * 0.8);
            quality = Math.max(0.5, quality - 0.08);
          }
          resolve(data);
        } catch (x) { resolve(null); }
        global.URL.revokeObjectURL(url);
      };
      img.onerror = function () { global.URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  function v2DataBytes(dataUrl) {
    var b64 = String(dataUrl).slice(String(dataUrl).indexOf(',') + 1);
    return Math.floor(b64.length * 3 / 4) - (/==$/.test(b64) ? 2 : /=$/.test(b64) ? 1 : 0);
  }

  function v2RawFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error('Could not read the file')); };
      r.readAsDataURL(file);
    });
  }

  var V2_PHOTO_WORDS = {
    photo_type_not_allowed: 'Dispatch can only send JPEG, PNG or WebP photos, and this file is another kind (an iPhone HEIC photo or a PDF, for example). ' +
      'Take a screenshot of it and add that, or on the iPhone set Camera, Formats to Most Compatible.'
  };

  function v2UploadPhoto(jobId, sid, file) {
    var e = v2Entry(jobId);
    var key = 'photo:' + v2KeyAttr(sid);
    if (!e || e.status !== 'ok' || !file || e.busy[key]) return;
    e.busy[key] = true;
    delete e.msg[key];
    paintV2();
    var base = text(file.name).replace(/\.[^.]+$/, '') || 'photo';
    v2Shrink(file).then(function (jpeg) {
      return jpeg ? { name: base + '.jpg', data: jpeg } : v2RawFile(file).then(function (raw) { return { name: text(file.name) || 'photo', data: raw }; });
    }).then(function (p) {
      return global.opsPost('dispatch_v2_upload_photo', { job_id: jobId, supplier_id: sid, file_name: p.name, data_base64: p.data });
    }).then(v2Ok).then(function (resp) {
      delete e.busy[key];
      if (!isObj(resp.photo) || !resp.photo.id) throw new Error('Unexpected answer');
      var ph = v2PhotoFrom(resp.photo);
      var list = v2PhotosOf(e, ph.supplier_id);
      if (list && !list.some(function (x) { return x.id === ph.id; })) list.push(ph);
      e.msg[key] = { text: 'Photo added: ' + ph.file_name + ', ' + v2Mb(ph.size_bytes) + '.' };
      paintV2If(jobId);
    }).catch(function (err) {
      delete e.busy[key];
      var code = err && err.code;
      if (code === 'photo_too_large') {
        var size = err.body && Number(err.body.size_bytes);
        e.msg[key] = { bad: true, text: 'This photo is too big to send' + (size ? ' (' + v2Mb(size) + ')' : '') + '. Outlook takes 3 MB at most. Take a smaller photo, or a screenshot of it, and add that.' };
        paintV2If(jobId);
        return;
      }
      if (V2_PHOTO_WORDS[code]) { e.msg[key] = { bad: true, text: V2_PHOTO_WORDS[code] }; paintV2If(jobId); return; }
      v2Fail(jobId, key, err, 'The photo was not added.');
    });
  }

  function v2MovePhoto(jobId, photoId, sid) {
    var e = v2Entry(jobId);
    var key = 'ph:' + photoId;
    var p = v2Photo(e, photoId);
    if (!p || e.busy[key] || p.supplier_id === sid) { paintV2(); return; }
    e.busy[key] = true;
    delete e.msg[key];
    paintV2();
    Promise.resolve().then(function () { return global.opsPost('dispatch_v2_move_photo', { job_id: jobId, photo_id: photoId, supplier_id: sid }); }).then(v2Ok).then(function (resp) {
      delete e.busy[key];
      var ph = isObj(resp.photo) && resp.photo.id ? v2PhotoFrom(resp.photo) : null;
      v2Unphoto(e, photoId);
      if (ph) { var list = v2PhotosOf(e, ph.supplier_id); if (list) list.push(ph); }
      paintV2If(jobId);
    }, function (err) {
      delete e.busy[key];
      v2Fail(jobId, key, err, 'Not moved. Move it again.');
      v2NoRetry(e, jobId, key);
    });
  }

  function v2DeletePhoto(jobId, photoId) {
    var e = v2Entry(jobId);
    var key = 'ph:' + photoId;
    if (!e || e.busy[key]) return;
    e.busy[key] = true;
    delete e.msg[key];
    paintV2();
    Promise.resolve().then(function () { return global.opsPost('dispatch_v2_delete_photo', { job_id: jobId, photo_id: photoId }); }).then(v2Ok).then(function () {
      delete e.busy[key];
      v2Unphoto(e, photoId);
      paintV2If(jobId);
    }, function (err) {
      delete e.busy[key];
      v2Fail(jobId, key, err, 'Not deleted. Press the cross again.');
      v2NoRetry(e, jobId, key);
    });
  }

  // A 600 second link to the photo, read only on a press.
  function v2ViewPhoto(jobId, photoId) {
    var e = v2Entry(jobId);
    var key = 'ph:' + photoId;
    if (!e || e.busy[key]) return;
    e.busy[key] = 'view';
    delete e.msg[key];
    paintV2();
    Promise.resolve().then(function () { return global.opsFetch('dispatch_v2_photo_url', { job_id: jobId, photo_id: photoId }); }).then(function (resp) {
      delete e.busy[key];
      var url = safeUrl(resp && resp.url);
      if (!url) throw new Error('No link');
      paintV2If(jobId);
      if (typeof global.openOpsLightbox === 'function') global.openOpsLightbox(url); else global.open(url, '_blank', 'noopener');
    }).catch(function () {
      delete e.busy[key];
      e.msg[key] = { bad: true, text: 'Could not open the photo.', retry: true };
      paintV2If(jobId);
    });
  }

  // ── the order email ──

  // One held email per box. A press while the box already holds one answers
  // "unchanged" with that email: it is shown, with why a second cannot be made.
  function v2MakeEmail(jobId, sid, rebuild) {
    var e = v2Entry(jobId);
    var box = v2Box(e, sid);
    var key = 'make:' + sid;
    if (!box || e.busy[key]) return;
    var date = wholeDay(e.dates[sid] || '') || null;
    // A rebuild keeps the held email's own delivery or pickup.
    var fulfilment = rebuild ? (box.open && box.open.fulfilment) || v2FulfilOf(e, box) : v2FulfilOf(e, box);
    if (!rebuild && text(e.dates[sid]) && !date) { e.msg[key] = { bad: true, text: 'That ' + fulfilment + ' date is not a whole date. Pick it again, or leave it empty.' }; paintV2(); return; }
    e.busy[key] = true;
    delete e.msg[key];
    e.ask = null;
    paintV2();
    var body = { job_id: jobId, supplier_id: sid, delivery_date: rebuild ? (box.open && box.open.delivery_date) || null : date, rebuild: !!rebuild, fulfilment: fulfilment };
    if (rebuild && box.open) body.expected_updated_at = box.open.updated_at;
    Promise.resolve().then(function () { return global.opsPost('dispatch_v2_make_email', body); }).then(v2Ok).then(function (resp) {
      delete e.busy[key];
      var m = v2EmailFrom(resp.email);
      if (!m) throw new Error('Unexpected answer');
      box.open = m;
      delete e.mailTyped[m.id];
      if (resp.unchanged) {
        e.msg[key] = { text: 'One email per supplier at a time. ' + v2SupWord(box) + ' already has an email waiting on this job: send it or discard it, then make the next one.' };
      } else {
        e.msg[key] = { text: rebuild ? 'Rebuilt from the lines. Your edits to it were lost.' : 'Held email made. Nothing has been sent. Check it, then send.' };
      }
      paintV2If(jobId);
      readV2(jobId, true);
    }, function (err) {
      delete e.busy[key];
      v2Fail(jobId, key, err, 'The email was not made.');
    });
  }

  function v2AddrText(list) { return list.join(', '); }
  function v2Addrs(v) { return text(v).split(/[\s,;]+/).map(function (a) { return a.toLowerCase(); }).filter(Boolean); }

  function v2MailField(e, m, f) {
    var t = e.mailTyped[m.id];
    if (t && Object.prototype.hasOwnProperty.call(t, f)) return t[f];
    return f === 'to' || f === 'cc' ? v2AddrText(m[f]) : f === 'body' ? m.body : m.subject;
  }

  // The held email's fields typed and not yet saved.
  function v2MailChanges(e, m) {
    var t = e.mailTyped[m.id] || {};
    var out = {};
    if (t.to !== undefined && v2Addrs(t.to).join(',') !== m.to.join(',')) out.to = v2Addrs(t.to);
    if (t.cc !== undefined && v2Addrs(t.cc).join(',') !== m.cc.join(',')) out.cc = v2Addrs(t.cc);
    if (t.subject !== undefined && t.subject !== m.subject) out.subject = t.subject;
    if (t.body !== undefined && t.body !== m.body) out.body_text = t.body;
    if (t.photo_ids !== undefined && t.photo_ids.join(',') !== m.photo_ids.join(',')) out.photo_ids = t.photo_ids.slice();
    return out;
  }

  // Save the held email's edits against its stamp. Resolves true when it is
  // saved (or nothing needed saving), false when it was not.
  function v2SaveMail(jobId, emailId) {
    var e = v2Entry(jobId);
    var m = v2OpenById(e, emailId);
    var key = 'mail:' + emailId;
    if (!m || m.status !== 'draft') return Promise.resolve(false);
    if (e.busy[key]) { e.mailAgain[emailId] = true; return e.busy[key]; }
    var out = v2MailChanges(e, m);
    if (!Object.keys(out).length) return Promise.resolve(true);
    var bad = (out.to || []).concat(out.cc || []).filter(function (a) { return !EMAIL_RE.test(a); });
    if (bad.length) { e.msg[key] = { bad: true, text: 'Not saved: ' + bad.join(', ') + (bad.length === 1 ? ' is' : ' are') + ' not an email address.' }; paintV2(); return Promise.resolve(false); }
    if (out.to && !out.to.length) { e.msg[key] = { bad: true, text: 'Not saved: the email needs at least one To address.' }; paintV2(); return Promise.resolve(false); }
    out.email_id = emailId;
    out.expected_updated_at = m.updated_at;
    delete e.msg[key];
    var p = Promise.resolve().then(function () { return global.opsPost('dispatch_v2_save_email', out); }).then(v2Ok).then(function (resp) {
      delete e.busy[key];
      var fresh = v2EmailFrom(resp.email);
      var box = v2BoxOfEmail(e, emailId);
      if (fresh && box) box.open = fresh;
      // Keep only what was typed after this save went.
      var t = e.mailTyped[emailId] || {};
      if (fresh) {
        if (t.to !== undefined && v2Addrs(t.to).join(',') === fresh.to.join(',')) delete t.to;
        if (t.cc !== undefined && v2Addrs(t.cc).join(',') === fresh.cc.join(',')) delete t.cc;
        if (t.subject === fresh.subject) delete t.subject;
        if (t.body === fresh.body) delete t.body;
        if (t.photo_ids && t.photo_ids.join(',') === fresh.photo_ids.join(',')) delete t.photo_ids;
        e.mailAt[emailId] = fresh.updated_at;
      }
      e.msg[key] = { text: 'Saved.' };
      paintV2If(jobId);
      if (e.mailAgain[emailId]) { e.mailAgain[emailId] = false; return v2SaveMail(jobId, emailId); }
      return true;
    }, function (err) {
      delete e.busy[key];
      e.mailAgain[emailId] = false;
      if (err && err.code === 'email_changed' && err.body && err.body.email) {
        var box = v2BoxOfEmail(e, emailId);
        var fresh = v2EmailFrom(err.body.email);
        if (box && fresh) box.open = fresh;
        delete e.mailTyped[emailId];
      }
      v2Fail(jobId, key, err, 'Not saved.');
      return false;
    });
    e.busy[key] = p;
    paintV2();
    return p;
  }

  function v2Discard(jobId, emailId) {
    var e = v2Entry(jobId);
    var m = v2OpenById(e, emailId);
    var box = v2BoxOfEmail(e, emailId);
    var key = 'mail:' + emailId;
    if (!m || !box || e.busy[key]) return;
    e.busy[key] = true;
    e.ask = null;
    paintV2();
    Promise.resolve().then(function () { return global.opsPost('dispatch_v2_discard_email', { email_id: emailId, expected_updated_at: m.updated_at }); }).then(v2Ok).then(function () {
      delete e.busy[key];
      box.open = null;
      delete e.mailTyped[emailId];
      e.msg['make:' + box.supplier_id] = { text: 'Email discarded. Nothing was sent.' };
      paintV2If(jobId);
      readV2(jobId, true);
    }, function (err) {
      delete e.busy[key];
      v2Fail(jobId, key, err, 'Not discarded.');
    });
  }

  // Send now and Send a test copy both save any edits first, then open the
  // confirm. The confirm's own Send is the only press that sends.
  function v2AskSend(jobId, emailId, mode) {
    var e = v2Entry(jobId);
    // A send that may have gone has nothing to save: it is not held.
    var saved = mode === 'resend' ? Promise.resolve(true) : v2SaveMail(jobId, emailId);
    saved.then(function (ok) {
      var m = v2OpenById(e, emailId);
      if (!ok || !m) return;
      if (mode !== 'resend' && m.status !== 'draft') return;
      var key = 'mail:' + emailId;
      if (m.missing.length) {
        e.msg[key] = { bad: true, text: 'Fill in the ' + v2MissingWords(m.missing) + ' in the email first. Dispatch will not send it with a blank one.' };
        paintV2If(jobId);
        return;
      }
      state.v2m.modal = { jobId: jobId, emailId: emailId, mode: mode, busy: false, msg: null };
      paintV2Modal();
      refocus('[data-dpc-v2="modal-go"]');
    });
  }

  function v2MissingWords(list) {
    var words = list.map(function (k) { return V2_DETAIL_WORDS[k] || k; });
    var tail = words.length > 1 ? words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1] : words[0];
    return tail + (words.length > 1 ? ' lines' : ' line');
  }

  function v2CloseModal() {
    var md = state.v2m.modal;
    if (!md || md.busy) return;
    state.v2m.modal = null;
    paintV2Modal();
    var back = root() && root().querySelector('[data-dpc-v2="' + (md.mode === 'test' ? 'test' : md.mode === 'resend' ? 'resend' : 'send') + '"][data-dpc-v2-id="' + md.emailId + '"]');
    if (back) back.focus();
  }

  // The one press that sends. test: one copy to admin@ only, marked TEST ONLY.
  // resend: an email whose first send could not be confirmed, sent again only
  // after a person checked admin@ Sent Items.
  function v2Send() {
    var md = state.v2m.modal;
    if (!md || md.busy) return;
    var jobId = md.jobId, emailId = md.emailId;
    var e = v2Entry(jobId);
    var m = v2OpenById(e, emailId);
    var box = v2BoxOfEmail(e, emailId);
    if (!m || !box || state.v2m.unrecorded[emailId]) return;
    md.busy = true;
    md.msg = null;
    paintV2Modal();
    var test = md.mode === 'test';
    var body = { email_id: emailId, expected_updated_at: m.updated_at, test: test, confirm_resend: md.mode === 'resend' };
    var key = 'mail:' + emailId, sup = v2SupWord(box);
    Promise.resolve().then(function () { return global.opsPost('dispatch_v2_send_email', body); }).then(v2Ok).then(function (resp) {
      md.busy = false;
      state.v2m.modal = null;
      paintV2Modal();
      if (test) {
        e.d.testDone = true;
        e.msg[key] = { text: 'Test copy sent to ' + (text(resp.sent_to) || V2_FROM) + ' only. Check it in admin@, then press Send now when it looks right.' };
      } else if (resp.recorded === false) {
        // It went, but noting it failed: never offer a second send of it.
        state.v2m.unrecorded[emailId] = true;
        e.msg['make:' + box.supplier_id] = { bad: true, text: 'The email went to ' + sup + ', but Dispatch could not note it on the order. Do not send it again. Tell Shaun so it can be put right.' };
      } else {
        e.msg['make:' + box.supplier_id] = { text: 'Sent to ' + sup + ' from admin@. A copy is in admin@ Sent Items. Its lines are now locked.' };
      }
      var fresh = v2EmailFrom(resp.email);
      if (fresh && fresh.status === 'draft') box.open = fresh;
      paintV2If(jobId);
      readV2(jobId, true);
    }, function (err) {
      md.busy = false;
      var code = err && err.code;
      var stay = null; // a line in the confirm, which stays open
      var after = null; // a line on the box once the confirm closes
      // An older server can still ask for the test copy first.
      if (code === 'test_send_first') stay = 'The server still asks for a test copy to admin@ before this send. Send a test copy, then Send now.';
      else if (code === 'no_approved_email') stay = 'This supplier has no approved order email any more, so Dispatch cannot send to it. Ask Shaun.';
      else if (code === 'order_lines_changed') stay = 'The lines in this box changed after the email was made. Go back, press Rebuild from the lines, check the email, then send.';
      else if (code === 'email_details_missing') stay = 'Fill in the ' + v2MissingWords(v2Arr(err.body && err.body.missing).length ? v2Arr(err.body.missing) : ['date']) + ' in the email first.';
      else if (code === 'photo_not_found' || code === 'photo_changed') stay = 'A photo on this email changed or is gone. Go back and change its photos, or rebuild it.';
      else if (code === 'operator_email_required') stay = 'Dispatch cannot tell who is signed in, so it did not send. Sign in again, then send.';
      else if (code === 'test_send_refused') stay = 'Outlook refused the test copy, so nothing was sent.' + (err.message ? ' ' + v2Plain(err.message) : '') + ' You can try again.';
      else if (code === 'test_send_unknown') after = { bad: true, text: 'We could not tell whether the test copy went. Look for it in admin@. If it is not there, send the test again.' };
      else if (code === 'send_refused') after = { bad: true, text: 'Outlook refused the email, so nothing was sent.' + (err.message ? ' ' + v2Plain(err.message) : '') + ' Check the email, then press Send now again.' };
      else if (code === 'send_unknown') after = { bad: true, text: 'We could not tell whether the email went to ' + sup + '. Check admin@ Sent Items before doing anything else.' };
      else if (V2_CHANGED.indexOf(code) >= 0) after = { bad: true, text: 'This email changed somewhere else. Showing the latest. Nothing was sent.' };
      else if (test) after = { bad: true, text: 'No clear answer came back for the test copy. Look for it in admin@ before sending it again.' };
      else after = { bad: true, text: 'No clear answer came back, so we cannot tell whether it went to ' + sup + '. Check admin@ Sent Items before sending again.' };
      if (stay) {
        md.msg = stay;
        paintV2Modal();
        return;
      }
      state.v2m.modal = null;
      paintV2Modal();
      e.msg[key] = after;
      // A send that may have gone shows on the box (its email reads "may have
      // gone" after the re-read); nothing here sends it again.
      e.msg['make:' + box.supplier_id] = after;
      paintV2If(jobId);
      readV2(jobId, true);
    });
  }

  // ── supplier search (Add supplier) ──

  function v2OpenFind() {
    var f = state.v2m.find;
    f.open = !f.open;
    paintV2();
    if (f.open) {
      refocus('[data-dpc-v2-q]');
      if (f.status === 'idle' || f.status === 'error' || f.q) { f.q = ''; v2RunFind(); }
    }
  }

  function v2RunFind() {
    var f = state.v2m.find;
    var token = ++f.token;
    f.status = 'loading';
    paintV2FindRes();
    var params = { limit: 25 };
    if (text(f.q)) params.q = text(f.q);
    Promise.resolve().then(function () { return global.opsFetch('dispatch_v2_supplier_search', params); }).then(function (resp) {
      if (token !== f.token) return;
      if (!isObj(resp) || !Array.isArray(resp.approved) || !Array.isArray(resp.others)) throw new Error('Unexpected search answer');
      f.data = { approved: resp.approved.filter(isObj), others: resp.others.filter(isObj) };
      f.status = 'ok';
      paintV2FindRes();
    }).catch(function () {
      if (token !== f.token) return;
      f.status = 'error';
      paintV2FindRes();
    });
  }

  // ───────────────────────── render: v2 Materials ─────────────────────────

  function v2Fail1(text1, retryAttrs) {
    return '<div class="dpc-empty dpc-empty-tight dpc-mat-fail" role="alert">' + esc(text1) +
      (retryAttrs ? ' <button type="button" class="dpc-retry" ' + retryAttrs + '>Retry</button>' : '') + '</div>';
  }

  // A line under a box or the draft list: what a press said.
  function v2MsgHtml(m, retryAttrs, cls) {
    if (!m) return '';
    var notes = Array.isArray(m.notes) && m.notes.length
      ? '<ul class="dpc-msg-notes">' + m.notes.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
      : '';
    return '<div class="' + (cls || 'dpc-card-msg') + (m.bad ? ' dpc-mat-fail' : '') + '" role="' + (m.bad ? 'alert' : 'status') + '">' + esc(m.text) +
      (m.retry && retryAttrs ? ' <button type="button" class="dpc-retry" ' + retryAttrs + '>Retry</button>' : '') + notes + '</div>';
  }

  function v2MoveOptions(e, current) {
    var h = '<option value="draft"' + (current == null ? ' selected' : '') + '>Draft list</option>';
    e.d.boxes.forEach(function (b) {
      h += '<option value="' + esc(b.supplier_id) + '"' + (b.supplier_id === current ? ' selected' : '') + '>' + esc(b.name) + '</option>';
    });
    return h;
  }

  // "14 x 1800H panels", as the email will read it.
  function v2LineText(l) {
    var q = matQtyText(l.quantity);
    return (q ? q + (l.unit ? ' ' + l.unit : '') + ' x ' : '') + l.description;
  }

  function v2SentWhen(box, emailId) {
    for (var i = 0; i < box.sent.length; i++) if (box.sent[i].id === emailId) return stampText(box.sent[i].sent.sent_at);
    return '';
  }

  function v2LineHtml(e, l, box) {
    var id = esc(l.id);
    var key = 'line:' + l.id;
    var busy = e.busy[key];
    var h = '<div class="dpc-line-wrap dpc-v2-wrap" data-dpc-v2-row="' + id + '">';
    if (l.locked) {
      var when = box && l.sentOn ? v2SentWhen(box, l.sentOn) : '';
      var extra = [l.profile ? 'Profile: ' + l.profile : '', l.colour ? 'Colour: ' + l.colour : '', l.detail].filter(Boolean).join(' · ');
      h += '<div class="dpc-v2-line dpc-v2-ro"><span class="dpc-v2-grip dpc-v2-grip-off" aria-hidden="true"></span><span class="dpc-v2-rotext">' + esc(v2LineText(l)) +
        (extra ? '<small>' + esc(extra) + '</small>' : '') + '</span><span class="dpc-status dpc-tone-ok">' + esc(when ? 'Sent ' + when : 'Sent') + '</span></div>';
      return h + '</div>';
    }
    var cell = function (f) { return esc(v2Cell(e, l, f)); };
    var status = (e.typed[l.id] && e.typed[l.id].status) || l.status;
    if (!matSettable(status)) status = 'not_reviewed';
    var q = matQty(v2Cell(e, l, 'quantity'));
    var off = busy ? ' disabled' : '';
    h += '<div class="dpc-v2-line">';
    h += '<span class="dpc-v2-grip" draggable="true" data-dpc-v2-grip="' + id + '" title="Drag to a supplier box" aria-hidden="true"></span>';
    h += '<input type="text" data-dpc-v2-cell="description" data-dpc-v2-id="' + id + '" maxlength="300" value="' + cell('description') + '" placeholder="Item" aria-label="Item">';
    h += '<input type="text" inputmode="decimal" data-dpc-v2-cell="quantity" data-dpc-v2-id="' + id + '" value="' + cell('quantity') + '" placeholder="Qty" aria-label="Qty"' + (q.ok ? '' : ' aria-invalid="true"') + '>';
    h += '<input type="text" data-dpc-v2-cell="unit" data-dpc-v2-id="' + id + '" maxlength="30" value="' + cell('unit') + '" placeholder="Unit" aria-label="Unit">';
    h += '<select class="dpc-status dpc-status-pick dpc-tone-' + MAT_STATUS[status].tone + '" data-dpc-v2-status="' + id + '" aria-label="Status"' + off + '>';
    MAT_SETTABLE.forEach(function (k) { h += '<option value="' + k + '"' + (k === status ? ' selected' : '') + '>' + esc(MAT_STATUS[k].label) + '</option>'; });
    h += '</select>';
    h += '<select class="dpc-v2-move" data-dpc-v2-move="' + id + '" aria-label="Move to"' + off + '>' + v2MoveOptions(e, l.supplier_id) + '</select>';
    h += '<button type="button" class="dpc-x" data-dpc-v2="del" data-dpc-v2-id="' + id + '" aria-label="Take this line off"' + off + '>&times;</button>';
    h += '</div>';
    var extraOpen = e.more[l.id] || ['detail', 'profile', 'colour'].some(function (f) { return text(v2Cell(e, l, f)); });
    if (extraOpen) {
      h += '<div class="dpc-v2-extra">';
      h += '<input type="text" data-dpc-v2-cell="profile" data-dpc-v2-id="' + id + '" maxlength="80" value="' + cell('profile') + '" placeholder="Profile" aria-label="Profile">';
      h += '<input type="text" data-dpc-v2-cell="colour" data-dpc-v2-id="' + id + '" maxlength="80" value="' + cell('colour') + '" placeholder="Colour" aria-label="Colour">';
      h += '<input type="text" data-dpc-v2-cell="detail" data-dpc-v2-id="' + id + '" maxlength="300" value="' + cell('detail') + '" placeholder="Detail, for example Gate: pedestrian gate 1270mm" aria-label="Detail">';
      h += '</div>';
    } else {
      h += '<button type="button" class="dpc-textbtn dpc-v2-morebtn" data-dpc-v2="more" data-dpc-v2-id="' + id + '">+ Profile, colour, detail</button>';
    }
    if (busy === 'delete') h += '<div class="dpc-line-msg" role="status">Taking off...</div>';
    h += v2MsgHtml(e.msg[key], 'data-dpc-v2="line-retry" data-dpc-v2-id="' + id + '"', 'dpc-line-msg');
    return h + '</div>';
  }

  function v2PhotosHtml(e, sid, photos, lockedIds) {
    var k = v2KeyAttr(sid);
    var h = '';
    if (photos.length) {
      h += '<div class="dpc-v2-photos">';
      photos.forEach(function (p) {
        var key = 'ph:' + p.id;
        var busy = e.busy[key];
        var onMail = lockedIds[p.id];
        h += '<div class="dpc-v2-photo"><button type="button" class="dpc-textbtn dpc-v2-photoname" data-dpc-v2="photo-view" data-dpc-v2-id="' + esc(p.id) + '"' + (busy ? ' disabled' : '') + '>' +
          esc(p.file_name) + ' <small>' + esc(v2Mb(p.size_bytes)) + (busy === 'view' ? ', opening...' : '') + '</small></button>';
        if (!onMail) {
          h += '<select class="dpc-v2-move" data-dpc-v2-pmove="' + esc(p.id) + '" aria-label="Move photo to"' + (busy ? ' disabled' : '') + '>' + v2MoveOptions(e, sid) + '</select>';
          h += '<button type="button" class="dpc-x" data-dpc-v2="photo-del" data-dpc-v2-id="' + esc(p.id) + '" aria-label="Delete photo ' + esc(p.file_name) + '"' + (busy ? ' disabled' : '') + '>&times;</button>';
        } else {
          h += '<small class="dpc-muted">' + esc(onMail) + '</small>';
        }
        h += v2MsgHtml(e.msg[key], 'data-dpc-v2="photo-view" data-dpc-v2-id="' + esc(p.id) + '"', 'dpc-line-msg');
        h += '</div>';
      });
      h += '</div>';
    }
    var pkey = 'photo:' + k;
    if (e.busy[pkey]) h += '<div class="dpc-card-msg" role="status">Shrinking and adding the photo...</div>';
    h += v2MsgHtml(e.msg[pkey]);
    return h;
  }

  // The photos an email names can only be changed on the email.
  function v2PhotoUse(box) {
    var use = {};
    if (!box) return use;
    if (box.open) box.open.photo_ids.forEach(function (id) { use[id] = 'On the held email'; });
    box.sent.forEach(function (m) { m.photo_ids.forEach(function (id) { use[id] = 'Sent'; }); });
    return use;
  }

  function v2FootHtml(e, sid, extra) {
    var k = esc(v2KeyAttr(sid));
    var h = '<div class="dpc-card-foot"><button type="button" class="dpc-addline" data-dpc-v2="addline" data-dpc-v2-sid="' + k + '">+ Add line</button>';
    h += '<button type="button" class="dpc-addline" data-dpc-v2="photo-add" data-dpc-v2-sid="' + k + '"' + (e.busy['photo:' + v2KeyAttr(sid)] ? ' disabled' : '') + '>+ Add photo</button>';
    h += '<input type="file" accept="image/*" hidden data-dpc-v2-file="' + k + '" aria-label="Add photo">';
    return h + (extra || '') + '</div>';
  }

  function v2LinesHtml(e, sid, saved, box) {
    var lines = saved.concat(e.local.filter(function (l) { return l.supplier_id === sid; }));
    var h = '<div class="dpc-lines dpc-v2-lines" data-dpc-v2-drop="' + esc(v2KeyAttr(sid)) + '">';
    if (!lines.length) h += '<div class="dpc-line-empty">' + (sid == null ? 'No lines yet. Add one, or fill the list from the scope.' : 'No lines yet. Drag lines here, or use Move to on a line.') + '</div>';
    lines.forEach(function (l) { h += v2LineHtml(e, l, box); });
    return h + '</div>';
  }

  function v2DraftHtml(e) {
    var d = e.d;
    var h = '<div class="dpc-supcard dpc-v2-draft" data-dpc-v2-box="draft"><div class="dpc-suphead"><strong>Draft list</strong>';
    h += '<span class="dpc-supmail">Type the materials, then move each line to its supplier.</span></div>';
    h += v2LinesHtml(e, null, d.draft.lines, null);
    h += v2PhotosHtml(e, null, d.draft.photos, {});
    h += v2MsgHtml(e.msg.draft, 'data-dpc-v2="suggest"');
    var suggest = d.canSuggest && !d.draft.lines.length && !e.local.length && !d.boxes.some(function (b) { return b.lines.length; })
      ? '<button type="button" class="dpc-addline" data-dpc-v2="suggest"' + (e.busy.suggest ? ' disabled' : '') + '>' + (e.busy.suggest ? 'Filling in...' : 'Fill from the scope') + '</button>' : '';
    return h + v2FootHtml(e, null, suggest) + '</div>';
  }

  // The two fencing lines the main supplier's email ends with. Shown on the
  // box, never editable: the server adds them when it makes the email.
  function v2StandingHtml() {
    return V2_STANDING.map(function (t) {
      return '<div class="dpc-line-wrap dpc-v2-wrap"><div class="dpc-v2-line dpc-v2-ro dpc-v2-standing"><span class="dpc-v2-grip dpc-v2-grip-off" aria-hidden="true"></span>' +
        '<span class="dpc-v2-rotext">' + esc(t) + '</span><span class="dpc-status dpc-tone-muted">Fencing standing line</span></div></div>';
    }).join('');
  }

  function v2BoxHtml(e, b) {
    var d = e.d;
    var sid = b.supplier_id;
    var key = 'box:' + sid;
    var fencing = d.workType === 'fencing';
    var h = '<div class="dpc-supcard dpc-v2-box' + (b.blocked ? ' dpc-v2-isblocked' : '') + '" data-dpc-v2-box="' + esc(sid) + '"><div class="dpc-suphead">';
    h += '<span class="dpc-supdot" aria-hidden="true"></span><strong>' + esc(b.name) + '</strong>';
    if (b.approved) {
      h += '<span class="dpc-supmail">' + esc(b.approved.to.join(', ')) + (b.approved.cc.length ? ', CC ' + esc(b.approved.cc.join(', ')) : '') + '</span>';
    } else {
      h += '<span class="dpc-status dpc-tone-warn">No approved order email</span>';
    }
    if (!b.active) h += '<span class="dpc-status dpc-tone-muted">Contact no longer active</span>';
    h += '<span class="dpc-grow"></span>';
    if (fencing) {
      h += '<label class="dpc-v2-main"><input type="checkbox" data-dpc-v2-main="' + esc(sid) + '"' + (b.is_main ? ' checked' : '') + (e.busy.main ? ' disabled' : '') + '> Main supplier' +
        (b.is_main && !d.mainTicked ? ' <small>(default)</small>' : '') + '</label>';
    }
    var empty = !b.lines.length && !b.photos.length && !b.open && !b.sent.length && !e.local.some(function (l) { return l.supplier_id === sid; });
    if (empty) h += '<button type="button" class="dpc-x" data-dpc-v2="remove-sup" data-dpc-v2-sid="' + esc(sid) + '" aria-label="Take ' + esc(b.name) + ' off this job"' + (e.busy[key] ? ' disabled' : '') + '>&times;</button>';
    h += '</div>';
    if (b.blocked) {
      h += '<div class="dpc-v2-blocked" role="note"><strong>Send blocked.</strong> ' + esc(b.blocked.message || 'This supplier has no approved order email. Ask Shaun to add one before sending.') +
        ' You can still split lines to it.</div>';
    }
    h += v2StageHtml(e, b);
    if (fencing && b.is_main) h += '<p class="dpc-v2-hint">Main supplier: its email ends with 4 x bags of quickset, then Fixings, Post Caps and Screws as necessary.</p>';
    h += v2LinesHtml(e, sid, b.lines, b);
    if (fencing && b.is_main) h += '<div class="dpc-lines dpc-v2-lines">' + v2StandingHtml() + '</div>';
    h += v2PhotosHtml(e, sid, b.photos, v2PhotoUse(b));
    h += v2MsgHtml(e.msg[key], 'data-dpc-v2="retry"');
    h += v2FootHtml(e, sid, '');
    h += v2OrderHtml(e, b);
    h += v2SentHtml(b);
    return h + '</div>';
  }

  // The order email part of a box: Make email, the held email, or the
  // send that may have gone.
  function v2OrderHtml(e, b) {
    var sid = b.supplier_id;
    var mkey = 'make:' + sid;
    var m = b.open;
    var h = '<div class="dpc-v2-order">';
    if (!m) {
      var n = v2Orderable(b).length;
      var off = !!b.blocked || !n || !!e.busy[mkey];
      var pick = v2FulfilOf(e, b) === 'pickup';
      h += '<div class="dpc-v2-make"><label class="dpc-v2-date dpc-v2-fulfil"><span>Delivery or pickup</span><select data-dpc-v2-fulfil="' + esc(sid) + '"' + (b.blocked ? ' disabled' : '') + '>' +
        '<option value="delivery"' + (pick ? '' : ' selected') + '>Delivery</option><option value="pickup"' + (pick ? ' selected' : '') + '>Pickup</option></select></label>';
      h += '<label class="dpc-v2-date"><span>' + (pick ? 'Pickup date' : 'Delivery date') + '</span><input type="date" data-dpc-v2-date="' + esc(sid) + '" value="' + esc(e.dates[sid] || '') + '"' + (b.blocked ? ' disabled' : '') + '></label>';
      h += '<button type="button" class="dpc-primary" data-dpc-v2="make" data-dpc-v2-sid="' + esc(sid) + '"' + (off ? ' disabled' : '') + '>' + (e.busy[mkey] ? 'Making the email...' : 'Make email') + '</button></div>';
      if (b.blocked) h += '<p class="dpc-v2-hint">Make email and Send now are off: this supplier has no approved order email.</p>';
      else if (!n) h += '<p class="dpc-v2-hint">' + (b.sent.length ? 'Every line here has gone. Add a line to order more.' : 'Add a line that is not In stock to make an email.') + '</p>';
      else h += '<p class="dpc-v2-hint">' + esc(v2Count(n, 'line', 'lines')) + ' to order. The email is held for you to check; nothing is sent until you press Send now and confirm.</p>';
      h += v2MsgHtml(e.msg[mkey], 'data-dpc-v2="make" data-dpc-v2-sid="' + esc(sid) + '"');
      return h + '</div>';
    }
    h += v2MsgHtml(e.msg[mkey]);
    if (state.v2m.unrecorded[m.id]) {
      return h + '<div class="dpc-v2-callout dpc-v2-bad" role="alert">This email went to ' + esc(v2SupWord(b)) + ', but Dispatch could not note it. Do not send it again.</div></div>';
    }
    if (m.status === 'sending') {
      h += '<div class="dpc-v2-callout" role="status">Sending now. If this stays for more than 2 minutes, check admin@ Sent Items. <button type="button" class="dpc-retry" data-dpc-v2="retry">Check again</button></div>';
      return h + '</div>';
    }
    if (m.status === 'send_unknown') {
      h += '<div class="dpc-v2-callout dpc-v2-bad" role="alert"><strong>This email may have gone.</strong> We could not tell whether it reached ' + esc(v2SupWord(b)) +
        '. Look in admin@ Sent Items for "' + esc(m.subject) + '". If it is there, do nothing more. If it is not, send it again.';
      h += '<div class="dpc-actions"><button type="button" data-dpc-v2="resend" data-dpc-v2-id="' + esc(m.id) + '"' + (e.busy['mail:' + m.id] ? ' disabled' : '') + '>It is not in Sent Items: send again</button></div>';
      h += v2MsgHtml(e.msg['mail:' + m.id], null, 'dpc-mail-msg');
      return h + '</div></div>';
    }
    if (m.status !== 'draft') return h + '</div>';
    return h + v2EditorHtml(e, b, m) + '</div>';
  }

  // The held email: From fixed, every other field editable, saved when left.
  function v2EditorHtml(e, b, m) {
    var id = esc(m.id);
    var key = 'mail:' + m.id;
    var busy = !!e.busy[key];
    var d = e.d;
    var f = function (name) { return esc(v2MailField(e, m, name)); };
    var h = '<div class="dpc-v2-mail" data-dpc-v2-mail="' + id + '">';
    h += '<div class="dpc-v2-mailhead"><span class="dpc-status dpc-tone-info">Held email, nothing sent yet</span>' + (m.edited ? '<span class="dpc-status dpc-tone-muted">Edited</span>' : '') + '</div>';
    h += '<div class="dpc-field"><span>From</span><span class="dpc-field-val"><strong>' + esc(m.from || V2_FROM) + '</strong> <small>Fixed. Sent through Outlook.</small></span></div>';
    h += '<div class="dpc-field"><label for="dpcV2To' + id + '">To</label><input id="dpcV2To' + id + '" type="text" data-dpc-v2-mf="to" data-dpc-v2-mid="' + id + '" value="' + f('to') + '"></div>';
    h += '<div class="dpc-field"><label for="dpcV2Cc' + id + '">CC</label><input id="dpcV2Cc' + id + '" type="text" data-dpc-v2-mf="cc" data-dpc-v2-mid="' + id + '" value="' + f('cc') + '"></div>';
    var team = m.team_cc || d.teamCc.email;
    h += '<p class="dpc-v2-hint">' + (team ? 'Team mailbox on the CC: ' + esc(team) + '.' : 'No team mailbox on the CC for this kind of job.') +
      (d.teamCc.question ? ' <strong>Open question:</strong> ' + esc(d.teamCc.question) : '') + '</p>';
    h += '<div class="dpc-field"><label for="dpcV2Sub' + id + '">Subject</label><input id="dpcV2Sub' + id + '" type="text" maxlength="250" data-dpc-v2-mf="subject" data-dpc-v2-mid="' + id + '" value="' + f('subject') + '"></div>';
    h += '<textarea class="dpc-textarea dpc-v2-body" maxlength="20000" data-dpc-v2-mf="body" data-dpc-v2-mid="' + id + '" aria-label="Email body">' + f('body') + '</textarea>';
    // Photos: the box's photos, three at most on one email.
    var typedPh = e.mailTyped[m.id] && e.mailTyped[m.id].photo_ids;
    var chosen = typedPh || m.photo_ids;
    if (b.photos.length) {
      h += '<div class="dpc-v2-attach"><span class="dpc-v2-attlabel">Attach</span>';
      b.photos.forEach(function (p) {
        var on = chosen.indexOf(p.id) >= 0;
        h += '<label><input type="checkbox" data-dpc-v2-attach="' + esc(p.id) + '" data-dpc-v2-mid="' + id + '"' + (on ? ' checked' : '') +
          (!on && chosen.length >= V2_EMAIL_PHOTOS ? ' disabled' : '') + '> ' + esc(p.file_name) + ' <small>' + esc(v2Mb(p.size_bytes)) + '</small></label>';
      });
      h += '</div>';
    } else {
      h += '<p class="dpc-v2-hint">No photo attached. Add one to this box to attach it.</p>';
    }
    if (m.missing.length) h += '<p class="dpc-v2-warn" role="note">The ' + esc(v2MissingWords(m.missing)) + (m.missing.length > 1 ? ' are' : ' is') + ' blank. Fill ' + (m.missing.length > 1 ? 'them' : 'it') + ' in before sending.</p>';
    if (m.last_error) h += '<p class="dpc-v2-warn" role="note">Last try: ' + esc(v2Plain(m.last_error)) + '</p>';
    if (m.test) h += '<p class="dpc-v2-hint">Test copy sent to ' + esc(text(m.test.sent_to) || V2_FROM) + ', ' + esc(stampText(m.test.sent_at)) + (text(m.test.sent_by_email) ? ' by ' + esc(m.test.sent_by_email) : '') + '.</p>';
    h += v2MsgHtml(e.msg[key], null, 'dpc-mail-msg');
    if (e.ask && e.ask.emailId === m.id) {
      var rebuild = e.ask.kind === 'rebuild';
      h += '<div class="dpc-v2-ask" role="group" aria-label="Confirm"><span>' + (rebuild ? 'Rebuild this email from the lines? Any edits to it are lost.' : 'Discard this email? Nothing has been sent.') + '</span>';
      h += '<div class="dpc-actions"><button type="button" class="dpc-primary" data-dpc-v2="' + (rebuild ? 'rebuild-go' : 'discard-go') + '" data-dpc-v2-id="' + id + '">' + (rebuild ? 'Rebuild' : 'Discard') + '</button>';
      h += '<button type="button" data-dpc-v2="ask-no">Keep it</button></div></div>';
    }
    // The test copy is optional: Send now is open straight away, behind its confirm.
    h += '<div class="dpc-actions dpc-v2-sendrow">';
    h += '<button type="button" class="dpc-v2-testbtn" data-dpc-v2="test" data-dpc-v2-id="' + id + '"' + (busy ? ' disabled' : '') + '><span class="dpc-v2-testtag">Test</span> Send a test copy to admin@</button>';
    h += '<button type="button" class="dpc-primary" data-dpc-v2="send" data-dpc-v2-id="' + id + '"' + (busy || !!b.blocked ? ' disabled' : '') + '>Send now</button>';
    h += '<button type="button" data-dpc-v2="rebuild" data-dpc-v2-id="' + id + '"' + (busy ? ' disabled' : '') + '>Rebuild from the lines</button>';
    h += '<button type="button" data-dpc-v2="discard" data-dpc-v2-id="' + id + '"' + (busy ? ' disabled' : '') + '>Discard</button>';
    h += '</div>';
    if (!m.test) h += '<p class="dpc-v2-hint">A test copy is optional. It goes to admin@ only, marked TEST ONLY; the supplier gets nothing.</p>';
    h += '<p class="dpc-v2-hint">One email per supplier at a time. Lines added to this box now need Rebuild from the lines, or go on the next email.</p>';
    return h + '</div>';
  }

  function v2SentHtml(b) {
    if (!b.sent.length) return '';
    var h = '<div class="dpc-v2-sent"><h4 class="dpc-mat-h4">Sent</h4>';
    b.sent.forEach(function (m) {
      var s = m.sent || {};
      var to = v2Arr(s.to).length ? v2Arr(s.to) : m.to;
      var cc = v2Arr(s.cc).length ? v2Arr(s.cc) : m.cc;
      h += '<details class="dpc-v2-sentitem"><summary><strong>' + esc(m.subject) + '</strong> <small>' + esc(stampText(s.sent_at)) + (text(s.sent_by_email) ? ' by ' + esc(s.sent_by_email) : '') + '</small></summary>';
      h += '<p class="dpc-v2-hint">From ' + esc(text(s.from) || m.from) + ' to ' + esc(to.join(', ')) + (cc.length ? ', CC ' + esc(cc.join(', ')) : '') + '. ' +
        esc(v2Count(m.line_count, 'line', 'lines')) + (m.photo_ids.length ? ', ' + esc(v2Count(m.photo_ids.length, 'photo', 'photos')) : '') + '.</p>';
      h += '<pre class="dpc-v2-pre">' + esc(m.body) + '</pre></details>';
    });
    return h + '</div>';
  }

  function v2FindResHtml() {
    var f = state.v2m.find;
    var e = v2Entry(state.jobId);
    if (f.status === 'loading' || f.status === 'idle') return '<div class="dpc-empty dpc-empty-tight">Searching...</div>';
    if (f.status === 'error') return v2Fail1('Could not search the suppliers.', 'data-dpc-v2="find-retry"');
    var on = {};
    if (e && e.d) e.d.boxes.forEach(function (b) { on[b.supplier_id] = true; });
    var adding = e && e.busy.add;
    var item = function (r, approved) {
      var sid = r.supplier_id ? String(r.supplier_id) : '';
      var note = !sid ? 'Not linked to a Xero contact yet. Ask Shaun to name the contact.' : on[sid] ? 'On this job' : r.has_approved_email ? '' : v2Plain(r.note) || 'No approved order email: Dispatch will not send to this supplier';
      var off = !sid || r.can_add === false || on[sid] || !!adding;
      var sub = approved
        ? [text(r.approved_name) && text(r.approved_name) !== text(r.name) ? text(r.approved_name) : '', V2_USED_FOR[text(r.used_for)] || text(r.used_for), v2Arr(r.to).join(', ')].filter(Boolean).join(' · ')
        : '';
      return '<button type="button" class="dpc-v2-res' + (r.has_approved_email ? '' : ' dpc-v2-res-noemail') + '" data-dpc-v2="addsup" data-dpc-v2-sid="' + esc(sid) + '"' + (off ? ' disabled' : '') + '>' +
        '<strong>' + esc(text(r.name) || text(r.approved_name) || 'Name not recorded') + (adding && adding === sid ? ' <small>Adding...</small>' : '') + '</strong>' +
        (sub ? '<small>' + esc(sub) + '</small>' : '') + (note ? '<small class="dpc-v2-resnote">' + esc(note) + '</small>' : '') + '</button>';
    };
    var h = '';
    h += '<h4 class="dpc-mat-h4">Approved order emails</h4>';
    h += f.data.approved.length ? f.data.approved.map(function (r) { return item(r, true); }).join('') : '<div class="dpc-empty dpc-empty-tight">No approved supplier matches.</div>';
    h += '<h4 class="dpc-mat-h4">All other suppliers</h4>';
    h += f.data.others.length ? f.data.others.map(function (r) { return item(r, false); }).join('') : '<div class="dpc-empty dpc-empty-tight">No other supplier matches.</div>';
    if (e && e.msg.add) h += v2MsgHtml(e.msg.add, e.msg.add.retry ? 'data-dpc-v2="addsup" data-dpc-v2-sid="' + esc(e.msg.add.retry) + '"' : null);
    return h;
  }

  function v2FindHtml() {
    var f = state.v2m.find;
    if (!f.open) return '';
    var h = '<div class="dpc-v2-find" data-dpc-region="v2find"><div class="dpc-row"><input type="search" class="dpc-v2-q" data-dpc-v2-q value="' + esc(f.q) + '" placeholder="Search suppliers by name" aria-label="Search suppliers">';
    h += '<button type="button" data-dpc-v2="find-close">Close</button></div>';
    h += '<p class="dpc-v2-hint">Approved suppliers come first. Any other supplier can be added to split lines to, but Dispatch will not send to it.</p>';
    return h + '<div class="dpc-v2-findres" data-dpc-region="v2findres">' + v2FindResHtml() + '</div></div>';
  }

  function v2BodyHtml(e) {
    if (!e || e.status === 'loading' || (e.status === 'idle')) return '<div class="dpc-empty dpc-empty-tight">Loading the materials...</div>';
    if (e.status === 'error' || !e.d) return v2Fail1('Could not load the materials.', 'data-dpc-v2="retry"');
    var h = '';
    if (e.notice) h += '<div class="dpc-mat-notice" role="status">' + esc(e.notice) + '</div>';
    h += v2FindHtml();
    h += v2DraftHtml(e);
    if (!e.d.boxes.length) h += '<div class="dpc-empty dpc-v2-nobox">No supplier boxes yet. Press Add supplier to make one, then move lines into it.</div>';
    e.d.boxes.forEach(function (b) { h += v2BoxHtml(e, b); });
    return h;
  }

  // Drawn on every job except a make-safe one, under Scope and notes.
  function v2Html() {
    var row = state.row;
    if (!row || isMakesafe(row)) return '';
    var e = v2Entry(row.id);
    var open = state.v2m.open;
    var h = '<div class="dpc-sec dpc-mat dpc-v2m' + (open ? '' : ' dpc-collapsed') + '" data-dpc-region="v2mat"><div class="dpc-sec-head"><div class="dpc-grow"><span class="dpc-eyebrow">Order</span><h3>Materials</h3>';
    if (open) h += '<p>Write the list, split it by supplier, then make and send one email per supplier</p>';
    h += '</div>';
    if (open && e && e.status === 'ok') h += '<button type="button" class="dpc-addsup" data-dpc-v2="find" aria-expanded="' + state.v2m.find.open + '">+ Add supplier</button>';
    h += '<button type="button" class="dpc-chev" data-dpc-v2="toggle" aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse' : 'Expand') + ' Materials">' + CHEV_SVG + '</button></div>';
    if (open) h += '<div class="dpc-sec-body">' + v2BodyHtml(e) + '</div>';
    return h + '</div>';
  }

  // The confirm before anything is sent. Drawn over the page.
  function v2ModalHtml() {
    var md = state.v2m.modal;
    if (!md) return '';
    var e = v2Entry(md.jobId);
    var m = v2OpenById(e, md.emailId);
    var b = v2BoxOfEmail(e, md.emailId);
    if (!m || !b) return '';
    var test = md.mode === 'test', again = md.mode === 'resend';
    var sup = v2SupWord(b);
    var photos = m.photo_ids.length;
    var h = '<div class="dpc-v2-back"><div class="dpc-v2-modal' + (test ? ' dpc-v2-modal-test' : '') + '" role="dialog" aria-modal="true" aria-labelledby="dpcV2ModalTitle">';
    if (test) h += '<span class="dpc-v2-testtag dpc-v2-testtag-big">TEST ONLY</span>';
    h += '<h3 id="dpcV2ModalTitle">' + esc(test ? 'Send a test copy to admin@?' : again ? 'Send this order to ' + sup + ' again?' : 'Send this order to ' + sup + '?') + '</h3>';
    h += '<div class="dpc-v2-mfields">';
    h += '<span>From</span><span>' + esc(m.from || V2_FROM) + '</span>';
    h += '<span>To</span><span>' + esc(test ? V2_FROM : m.to.join(', ')) + '</span>';
    h += '<span>CC</span><span>' + esc(test ? 'None' : (m.cc.join(', ') || 'None')) + '</span>';
    h += '<span>Subject</span><span>' + esc((test ? 'TEST ONLY: ' : '') + m.subject) + '</span>';
    h += '<span>Lines</span><span>' + esc(v2Count(m.line_count, 'line', 'lines') + ', ' + (photos ? v2Count(photos, 'photo', 'photos') : 'no photo')) + '</span>';
    h += '</div>';
    if (test) h += '<p class="dpc-v2-hint">Only admin@ gets this copy, marked TEST ONLY. ' + esc(sup) + ' gets nothing. Check it in admin@, then come back and press Send now.</p>';
    if (again) h += '<p class="dpc-v2-warn">Only send again if the email is not in admin@ Sent Items. If it did go, ' + esc(sup) + ' gets it twice.</p>';
    if (md.msg) h += '<p class="dpc-v2-warn" role="alert">' + esc(md.msg) + '</p>';
    h += '<div class="dpc-actions"><button type="button" class="dpc-primary" data-dpc-v2="modal-go"' + (md.busy ? ' disabled' : '') + '>' +
      esc(md.busy ? 'Sending...' : test ? 'Send test' : again ? 'Send again' : 'Send') + '</button>';
    h += '<button type="button" data-dpc-v2="modal-no"' + (md.busy ? ' disabled' : '') + '>Back to the email</button></div>';
    return h + '</div></div>';
  }

  // Where the keyboard was inside the section, to put it back after a repaint.
  var V2_FOCUS_KEYS = ['data-dpc-v2-cell', 'data-dpc-v2-id', 'data-dpc-v2-mf', 'data-dpc-v2-mid', 'data-dpc-v2', 'data-dpc-v2-sid', 'data-dpc-v2-status',
    'data-dpc-v2-move', 'data-dpc-v2-pmove', 'data-dpc-v2-main', 'data-dpc-v2-date', 'data-dpc-v2-attach', 'data-dpc-v2-q', 'data-dpc-v2-stage', 'data-dpc-v2-fulfil'];
  function v2Focus(el) {
    var a = document.activeElement;
    if (!a || !el.contains(a)) return null;
    var sel = V2_FOCUS_KEYS.filter(function (k) { return a.hasAttribute(k); }).map(function (k) {
      return '[' + k + '="' + String(a.getAttribute(k)).replace(/["\\]/g, '\\$&') + '"]';
    }).join('');
    if (!sel) return null;
    var f = { sel: sel };
    try { f.start = a.selectionStart; f.end = a.selectionEnd; } catch (x) { /* not a text box */ }
    return f;
  }

  function paintV2() {
    var el = region('v2mat');
    if (!el) return;
    var f = v2Focus(el);
    painting = true;
    try { el.outerHTML = v2Html(); } finally { painting = false; }
    // The order emails are also listed in the Emails panel.
    paintMail();
    var now = f && region('v2mat') ? region('v2mat').querySelector(f.sel) : null;
    if (!now || now.disabled) return;
    now.focus({ preventScroll: true });
    if (typeof f.start === 'number' && now.setSelectionRange) { try { now.setSelectionRange(f.start, f.end); } catch (x) { /* not a text box */ } }
  }
  function paintV2If(jobId) { if (state.jobId === jobId) paintV2(); }
  function paintV2Find() { var el = region('v2findres'); if (el) el.innerHTML = v2FindResHtml(); else paintV2(); }
  function paintV2FindRes() { var el = region('v2findres'); if (el) el.innerHTML = v2FindResHtml(); }
  function paintV2Modal() {
    var el = region('v2modal');
    if (el) el.innerHTML = v2ModalHtml();
  }

  // ── v2 Materials: events ──

  // Opening another job closes the send confirm (never while it is sending),
  // the supplier search and any open Rebuild or Discard question.
  function v2Leave() {
    if (state.v2m.modal && !state.v2m.modal.busy) { state.v2m.modal = null; paintV2Modal(); }
    state.v2m.find.open = false;
    Object.keys(state.v2m.jobs).forEach(function (id) { state.v2m.jobs[id].ask = null; });
  }

  function onV2Click(t) {
    var verb = t.getAttribute('data-dpc-v2');
    if (verb == null) return false;
    var jobId = state.jobId;
    var id = t.getAttribute('data-dpc-v2-id');
    var sid = v2Key(t.getAttribute('data-dpc-v2-sid'));
    var e = v2Entry(jobId);
    if (verb === 'modal-go') { v2Send(); return true; }
    if (verb === 'modal-no') { v2CloseModal(); return true; }
    if (verb === 'toggle') {
      state.v2m.open = !state.v2m.open;
      writeStore('localStorage', LS_ORDER, state.v2m.open ? '1' : '0');
      paintV2();
      refocus('[data-dpc-v2="toggle"]');
      return true;
    }
    if (verb === 'find') { v2OpenFind(); return true; }
    if (verb === 'find-close') { state.v2m.find.open = false; paintV2(); refocus('[data-dpc-v2="find"]'); return true; }
    if (verb === 'find-retry') { v2RunFind(); return true; }
    if (!jobId) return true;
    if (verb === 'retry') { readV2(jobId, !!(e && e.d)); return true; }
    if (!e || e.status !== 'ok') return true;
    if (verb === 'addsup') v2AddSupplier(jobId, sid);
    else if (verb === 'addline') v2AddLine(jobId, sid);
    else if (verb === 'suggest') v2Suggest(jobId);
    else if (verb === 'del') v2DeleteLine(jobId, id);
    else if (verb === 'line-retry') {
      if (e.busy['line:' + id] === 'delete' || (e.msg['line:' + id] && /taken off/i.test(e.msg['line:' + id].text))) v2DeleteLine(jobId, id); else v2SaveLine(jobId, id);
    }
    else if (verb === 'more') { e.more[id] = true; paintV2(); refocus('[data-dpc-v2-cell="profile"][data-dpc-v2-id="' + id + '"]'); }
    else if (verb === 'remove-sup') v2RemoveSupplier(jobId, sid);
    else if (verb === 'photo-add') {
      var input = region('v2mat') && region('v2mat').querySelector('[data-dpc-v2-file="' + v2KeyAttr(sid) + '"]');
      if (input) input.click();
    }
    else if (verb === 'photo-view') v2ViewPhoto(jobId, id);
    else if (verb === 'photo-del') v2DeletePhoto(jobId, id);
    else if (verb === 'make') v2MakeEmail(jobId, sid, false);
    else if (verb === 'paid' || verb === 'unpaid') v2PayPress(jobId, sid, verb);
    else if (verb === 'payon') v2PayPress(jobId, sid, verb, t.getAttribute('data-dpc-v2-payon'));
    else if (verb === 'test') v2AskSend(jobId, id, 'test');
    else if (verb === 'send') v2AskSend(jobId, id, 'real');
    else if (verb === 'resend') v2AskSend(jobId, id, 'resend');
    else if (verb === 'rebuild' || verb === 'discard') { e.ask = { kind: verb, emailId: id }; paintV2(); refocus('[data-dpc-v2="' + verb + '-go"]'); }
    else if (verb === 'ask-no') { var was = e.ask; e.ask = null; paintV2(); if (was) refocus('[data-dpc-v2="' + was.kind + '"][data-dpc-v2-id="' + was.emailId + '"]'); }
    else if (verb === 'rebuild-go') { var bx = v2BoxOfEmail(e, id); if (bx) v2MakeEmail(jobId, bx.supplier_id, true); }
    else if (verb === 'discard-go') v2Discard(jobId, id);
    return true;
  }

  // True when the change was one of v2 Materials' boxes.
  function onV2Change(t) {
    var jobId = state.jobId;
    var e = v2Entry(jobId);
    if (!e || e.status !== 'ok') return false;
    if (t.hasAttribute('data-dpc-v2-status')) { v2SetStatus(jobId, t.getAttribute('data-dpc-v2-status'), t.value); return true; }
    if (t.hasAttribute('data-dpc-v2-move')) { v2MoveLine(jobId, t.getAttribute('data-dpc-v2-move'), v2Key(t.value)); return true; }
    if (t.hasAttribute('data-dpc-v2-pmove')) { v2MovePhoto(jobId, t.getAttribute('data-dpc-v2-pmove'), v2Key(t.value)); return true; }
    if (t.hasAttribute('data-dpc-v2-main')) { v2SetMain(jobId, t.getAttribute('data-dpc-v2-main'), !!t.checked); return true; }
    if (t.hasAttribute('data-dpc-v2-stage')) { v2SetStage(jobId, t.getAttribute('data-dpc-v2-stage'), t.value); return true; }
    if (t.hasAttribute('data-dpc-v2-date')) { e.dates[t.getAttribute('data-dpc-v2-date')] = t.value; return true; }
    // Delivery or pickup: kept on the screen until Make email; nothing is sent.
    if (t.hasAttribute('data-dpc-v2-fulfil')) { e.fulfil[t.getAttribute('data-dpc-v2-fulfil')] = t.value === 'pickup' ? 'pickup' : 'delivery'; paintV2(); return true; }
    if (t.hasAttribute('data-dpc-v2-file')) {
      var file = t.files && t.files[0];
      var where = v2Key(t.getAttribute('data-dpc-v2-file'));
      t.value = '';
      if (file) v2UploadPhoto(jobId, where, file);
      return true;
    }
    if (t.hasAttribute('data-dpc-v2-attach')) {
      var mid = t.getAttribute('data-dpc-v2-mid');
      var m = v2OpenById(e, mid);
      if (!m) return true;
      var typed = e.mailTyped[mid] || (e.mailTyped[mid] = {});
      if (e.mailAt[mid] === undefined) e.mailAt[mid] = m.updated_at;
      var ids = (typed.photo_ids || m.photo_ids).filter(function (x) { return x !== t.getAttribute('data-dpc-v2-attach'); });
      if (t.checked) ids.push(t.getAttribute('data-dpc-v2-attach'));
      typed.photo_ids = ids.slice(0, V2_EMAIL_PHOTOS);
      v2SaveMail(jobId, mid);
      return true;
    }
    return false;
  }

  function onV2Input(t) {
    var jobId = state.jobId;
    if (t.hasAttribute('data-dpc-v2-q')) {
      var f = state.v2m.find;
      f.q = t.value || '';
      clearTimeout(f.timer);
      f.timer = setTimeout(v2RunFind, V2_FIND_MS);
      return true;
    }
    var e = v2Entry(jobId);
    if (!e || e.status !== 'ok') return false;
    if (t.hasAttribute('data-dpc-v2-cell')) {
      var id = t.getAttribute('data-dpc-v2-id');
      var l = v2Local(e, id) || v2Line(e, id);
      if (!l) return true;
      if (e.typed[id] === undefined) e.typed[id] = {};
      if (e.typedAt[id] === undefined && !l.local) e.typedAt[id] = l.updated_at;
      e.typed[id][t.getAttribute('data-dpc-v2-cell')] = t.value;
      if (t.getAttribute('data-dpc-v2-cell') === 'quantity') {
        if (matQty(t.value).ok) t.removeAttribute('aria-invalid'); else t.setAttribute('aria-invalid', 'true');
      }
      return true;
    }
    if (t.hasAttribute('data-dpc-v2-mf')) {
      var mid = t.getAttribute('data-dpc-v2-mid');
      var m = v2OpenById(e, mid);
      if (!m) return true;
      if (e.mailTyped[mid] === undefined) e.mailTyped[mid] = {};
      if (e.mailAt[mid] === undefined) e.mailAt[mid] = m.updated_at;
      e.mailTyped[mid][t.getAttribute('data-dpc-v2-mf')] = t.value;
      return true;
    }
    if (t.hasAttribute('data-dpc-v2-date')) { e.dates[t.getAttribute('data-dpc-v2-date')] = t.value; return true; }
    return false;
  }

  // A line's cell or the held email's field is saved when it is left. A
  // repaint that takes the focused box away is not the person leaving it.
  function onV2FocusOut(t) {
    var jobId = state.jobId;
    if (t.hasAttribute('data-dpc-v2-cell')) {
      var id = t.getAttribute('data-dpc-v2-id');
      setTimeout(function () { v2SaveLine(jobId, id); }, 0);
      return true;
    }
    if (t.hasAttribute('data-dpc-v2-mf')) {
      var mid = t.getAttribute('data-dpc-v2-mid');
      // A press on Send now or the test button saves first itself.
      setTimeout(function () { v2SaveMail(jobId, mid); }, 0);
      return true;
    }
    return false;
  }

  // Drag a line by its grip into a box, between boxes or back to the draft
  // list. Phones use the line's Move to box instead.
  function onV2DragStart(ev) {
    var g = ev.target && ev.target.closest ? ev.target.closest('[data-dpc-v2-grip]') : null;
    if (!g) return;
    state.v2m.drag = g.getAttribute('data-dpc-v2-grip');
    try {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', state.v2m.drag);
      var row = g.closest('[data-dpc-v2-row]');
      if (row && ev.dataTransfer.setDragImage) ev.dataTransfer.setDragImage(row, 12, 12);
    } catch (x) { /* an old browser */ }
    var r = root();
    if (r) r.classList.add('dpc-v2-dragging');
  }
  function v2DropZone(ev) {
    var z = ev.target && ev.target.closest ? ev.target.closest('[data-dpc-v2-box]') : null;
    return z && root() && root().contains(z) ? z : null;
  }
  function onV2DragOver(ev) {
    if (!state.v2m.drag) return;
    var z = v2DropZone(ev);
    if (!z) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'move'; } catch (x) { /* an old browser */ }
    var r = root();
    Array.prototype.forEach.call(r.querySelectorAll('.dpc-v2-over'), function (x) { if (x !== z) x.classList.remove('dpc-v2-over'); });
    z.classList.add('dpc-v2-over');
  }
  function onV2Drop(ev) {
    var id = state.v2m.drag;
    var z = v2DropZone(ev);
    if (!id || !z) return;
    ev.preventDefault();
    v2DragEnd();
    v2MoveLine(state.jobId, id, v2Key(z.getAttribute('data-dpc-v2-box')));
  }
  function v2DragEnd() {
    state.v2m.drag = null;
    var r = root();
    if (!r) return;
    r.classList.remove('dpc-v2-dragging');
    Array.prototype.forEach.call(r.querySelectorAll('.dpc-v2-over'), function (x) { x.classList.remove('dpc-v2-over'); });
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
      h += headHtml(state.row) + sectionHtml() + v2Html() + mailHtml() + schedHtml();
    }
    return h + '</section>';
  }

  function paintWorkspace() {
    var w = region('workspace');
    if (w) w.outerHTML = workspaceHtml();
    wirePad();
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
    var h = '<div class="dpc"><div class="dpc-header"><div class="dpc-row"><div class="dpc-grow"><h1>Dispatch</h1><p>Accepted work, what each job needs, and how the materials get to site.</p></div>' + trayBtnHtml() + '</div></div>';
    h += trayHtml();
    h += '<div class="dpc-layout' + (state.leftOpen ? '' : ' dpc-left-closed') + (state.rightOpen ? '' : ' dpc-right-closed') + '">' + queueHtml() + workspaceHtml() + contextHtml() + '</div>';
    h += '<div data-dpc-region="v2modal">' + v2ModalHtml() + '</div></div>';
    r.innerHTML = h;
    wirePad();
    paintList();
  }

  // ───────────────────────── events ─────────────────────────

  function rowById(id) {
    var lists = [state.found.rows, state.base.rows, state.arch.rows];
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
      '[data-dpc-tab],[data-dpc-right],[data-dpc-opentab],[data-dpc-msg],[data-dpc-invoice],[data-dpc-send],[data-dpc-send-go],[data-dpc-send-no],[data-dpc-jobpage],' +
      '[data-dpc-mode],[data-dpc-onus],[data-dpc-fold],[data-dpc-stage],[data-dpc-stage-go],[data-dpc-stage-cancel],[data-dpc-stage-retry],[data-dpc-next-save],' +
      '[data-dpc-deliv-cal],[data-dpc-install],[data-dpc-sched-toggle],' +
      '[data-dpc-deliv-sight],[data-dpc-deliv-unsight],[data-dpc-deliv-confirm],[data-dpc-deliv-edit],[data-dpc-deliv-retry],[data-dpc-box-open],[data-dpc-box-edit],' +
      '[data-dpc-rep-goto],[data-dpc-rep-confirm],[data-dpc-rep-reject],[data-dpc-rep-retry],[data-dpc-sug-accept],[data-dpc-sug-dismiss],[data-dpc-sug-retry],' +
      '[data-dpc-tray-toggle],[data-dpc-tray-confirm],[data-dpc-tray-reject],[data-dpc-tray-assign],[data-dpc-tray-put],[data-dpc-tray-hide],[data-dpc-tray-hide-go],[data-dpc-tray-hide-no],' +
      '[data-dpc-v2],[data-dpc-mat-clear],[data-dpc-mat-retry],[data-dpc-order-pdf],[data-dpc-mail],[data-dpc-mail-toggle],[data-dpc-mail-goto]') : null;
    if (!t || t.disabled) return;
    if (onV2Click(t)) return;
    if (onPadClick(t)) return;
    if (onMailClick(t)) return;
    if (onPanelClick(t, e)) return;
    if (onStageClick(t)) return;
    if (onRepClick(t)) return;
    if (onInstallClick(t)) return;
    if (onBoxClick(t)) return;
    if (onDelivClick(t)) return;
    if (t.hasAttribute('data-dpc-deliv-cal')) {
      // The Calendar tab's own call, once: the calendar opens as it was left.
      if (typeof global.showView === 'function') global.showView('calendar');
      return;
    }
    if (t.hasAttribute('data-dpc-sched-toggle')) {
      state.sched.open = !state.sched.open;
      state.deliv.edit = null;
      state.deliv.ask = null;
      writeStore('localStorage', LS_SCHED, state.sched.open ? '1' : '0');
      paintSched();
      refocus('[data-dpc-sched-toggle]');
      return;
    }
    if (t.hasAttribute('data-dpc-job')) {
      if (t.getAttribute('data-dpc-job') !== state.jobId) state.stage.confirm = null;
      selectJob(rowById(t.getAttribute('data-dpc-job')));
    }
    else if (t.hasAttribute('data-dpc-type')) { state.type = t.getAttribute('data-dpc-type'); paintList(); }
    else if (t.hasAttribute('data-dpc-onus')) { state.onUs = !state.onUs; paintList(); }
    else if (t.hasAttribute('data-dpc-mode')) {
      // Active or Archive. The work type and a search are cleared; a view
      // not read yet (or failed) is read now.
      state.mode = t.getAttribute('data-dpc-mode') === 'archive' ? 'archive' : 'active';
      writeStore('localStorage', LS_MODE, state.mode);
      state.type = 'all';
      state.search = '';
      clearTimeout(searchTimer);
      var box = root().querySelector('[data-dpc-search]');
      if (box) box.value = '';
      var v = viewData(state.mode);
      if (v.status === 'idle' || v.status === 'error') loadView(state.mode);
      paintList();
    }
    else if (t.hasAttribute('data-dpc-fold')) {
      var key = t.getAttribute('data-dpc-fold');
      if (state.folds[key]) delete state.folds[key]; else state.folds[key] = true;
      writeStore('localStorage', LS_FOLDS, JSON.stringify(state.folds));
      paintList(true);
      refocus('[data-dpc-fold="' + key.replace(/["\\]/g, '\\$&') + '"]');
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
      else if (what === 'archive') loadView('archive');
      else if (what === 'search') runSearch();
      else if (what === 'arrival' && state.row) loadArrival(state.row);
      else if (what === 'replies' && state.row) loadReplies(state.row);
      else if (what === 'tray') loadTray();
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
  // stop only opens the confirm line ("Move SWF-x to <Stage>?"); only Move
  // writes. A stop the job cannot move to is disabled and does nothing.
  function onStageClick(t) {
    var row = state.row;
    var b = boardOf(row);
    if (t.hasAttribute('data-dpc-stage')) {
      if (!b || state.stage.moving) return true;
      var target = moveTarget(b, t.getAttribute('data-dpc-stage'));
      if (!target) return true;
      state.stage.confirm = { jobId: row.id, to: target.key, label: text(target.label) || keyWords(target.key) };
      state.stage.msg = null;
      paintTape();
      refocus('[data-dpc-stage-go]');
    } else if (t.hasAttribute('data-dpc-stage-go')) {
      var c = state.stage.confirm;
      if (c && row && c.jobId === row.id) moveStage(c);
    } else if (t.hasAttribute('data-dpc-stage-cancel')) {
      var was = state.stage.confirm && !state.stage.confirm.offer && state.stage.confirm.to;
      state.stage.confirm = null;
      paintTape();
      if (was) refocus('[data-dpc-stage="' + was + '"]');
    } else if (t.hasAttribute('data-dpc-stage-retry')) {
      var m = state.stage.msg;
      if (m && row && m.jobId === row.id && m.retry) moveStage(m.retry);
    } else if (t.hasAttribute('data-dpc-next-save')) {
      saveNextStep();
    } else {
      return false;
    }
    return true;
  }

  // Supplier replies (in the Emails panel) and the tray. True when the press was one of them.
  function onRepClick(t) {
    var jobId = state.jobId;
    var e = repEntry(jobId);
    var tray = state.rep.tray;
    var id;
    if (t.hasAttribute('data-dpc-rep-goto')) {
      mailGotoAsk();
    } else if ((id = t.getAttribute('data-dpc-rep-confirm'))) {
      repPress(jobId, 'confirm', id);
    } else if ((id = t.getAttribute('data-dpc-rep-reject'))) {
      repPress(jobId, 'reject', id);
    } else if ((id = t.getAttribute('data-dpc-sug-accept'))) {
      repPress(jobId, 'accept', id, e && e.pick[id] ? { order_id: e.pick[id] } : null);
    } else if ((id = t.getAttribute('data-dpc-sug-dismiss'))) {
      repPress(jobId, 'dismiss', id);
    } else if ((id = t.getAttribute('data-dpc-rep-retry') || t.getAttribute('data-dpc-sug-retry'))) {
      var r = e && e.msg[id] && e.msg[id].retry;
      if (r) repPress(jobId, r.kind, id, r.extra);
    } else if (t.hasAttribute('data-dpc-tray-toggle')) {
      tray.open = !tray.open;
      if (tray.open && (tray.status === 'idle' || tray.status === 'error')) loadTray(); else paintTray();
      if (tray.open) { var panel = region('tray'); if (panel) panel.scrollIntoView({ block: 'nearest' }); }
    } else if ((id = t.getAttribute('data-dpc-tray-confirm'))) {
      trayPress('confirm', id);
    } else if ((id = t.getAttribute('data-dpc-tray-reject'))) {
      trayPress('reject', id);
    } else if ((id = t.getAttribute('data-dpc-tray-assign'))) {
      var extra = { job_id: t.getAttribute('data-job') };
      if (t.getAttribute('data-order')) extra.order_id = t.getAttribute('data-order');
      trayPress('assign', id, extra);
    } else if ((id = t.getAttribute('data-dpc-tray-put'))) {
      if (tray.pick[id]) trayPress('assign', id, { job_id: tray.pick[id] });
    } else if ((id = t.getAttribute('data-dpc-tray-hide'))) {
      tray.hideAsk = id;
      paintTray();
      refocus('[data-dpc-tray-hide-go="' + id + '"]');
    } else if ((id = t.getAttribute('data-dpc-tray-hide-go'))) {
      trayPress('hide', id);
    } else if (t.hasAttribute('data-dpc-tray-hide-no')) {
      var was = tray.hideAsk;
      tray.hideAsk = null;
      paintTray();
      if (was) refocus('[data-dpc-tray-hide="' + was + '"]');
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
      // Asks first: "Text this to the client?". Nothing is sent here.
      if (!state.jobId || !(state.replies[state.jobId] || '').trim()) return true;
      state.smsAsk[state.jobId] = true;
      state.replyMsg[state.jobId] = null;
      paintReply();
      refocus('[data-dpc-send-go]');
    } else if (t.hasAttribute('data-dpc-send-go')) {
      if (state.jobId && state.smsAsk[state.jobId]) sendReply();
    } else if (t.hasAttribute('data-dpc-send-no')) {
      if (state.jobId) state.smsAsk[state.jobId] = false;
      paintReply();
      refocus('[data-dpc-reply]');
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

  // The install row has one press left: Retry when the bookings did not load.
  function onInstallClick(t) {
    if (!t.hasAttribute('data-dpc-install')) return false;
    if (t.getAttribute('data-dpc-install') === 'retry-read') loadBase();
    return true;
  }

  // Choice boxes: Add supplier, a line's supplier and its status.
  function onChange(e) {
    var t = e.target;
    if (!t || !t.hasAttribute) return;
    // The tray works with no job open.
    var tray = state.rep.tray;
    if (t.hasAttribute('data-dpc-tray-job')) {
      tray.pick[t.getAttribute('data-dpc-tray-job')] = t.value;
      var put = region('tray') && region('tray').querySelector('[data-dpc-tray-put="' + t.getAttribute('data-dpc-tray-job') + '"]');
      if (put) put.disabled = !t.value || !!tray.busy[t.getAttribute('data-dpc-tray-job')];
      return;
    }
    if (t.hasAttribute('data-dpc-tray-other')) {
      tray.other = !!t.checked;
      tray.data = null;
      tray.status = 'idle';
      loadTray();
      return;
    }
    if (!state.jobId) return;
    if (t.hasAttribute('data-dpc-box-confirmed')) { onBoxInput(t); return; }
    if (onV2Change(t)) return;
    if (t.hasAttribute('data-dpc-sug-order')) {
      var e2 = repEntry(state.jobId);
      if (!e2) return;
      var sid = t.getAttribute('data-dpc-sug-order');
      e2.pick[sid] = t.value;
      var acc = region('mail') && region('mail').querySelector('[data-dpc-sug-accept="' + sid + '"]');
      if (acc) acc.disabled = !t.value || !!e2.busy[sid];
      return;
    }
  }

  function onKeyDown(e) {
    var t = e.target;
    // Escape closes the send confirm (never while it is sending) and the supplier search.
    if (e.key === 'Escape' && state.v2m.modal) { e.preventDefault(); v2CloseModal(); return; }
    if (e.key === 'Escape' && t && t.hasAttribute && t.hasAttribute('data-dpc-v2-q')) { state.v2m.find.open = false; paintV2(); refocus('[data-dpc-v2="find"]'); return; }
    // Enter in a Deliveries expected date saves it.
    if (e.key === 'Enter' && t && t.hasAttribute && state.jobId && t.hasAttribute('data-dpc-deliv-expected')) { e.preventDefault(); commitExpected(state.jobId, t); }
  }

  // A cell or the held email is saved when it is left. A repaint that takes
  // the focused box away is not the person leaving it.
  function onFocusOut(e) {
    var t = e.target;
    if (painting || !t || !t.hasAttribute || !state.jobId) return;
    if (t.hasAttribute('data-dpc-mat-pad')) { saveText(state.jobId); return; }
    if (t.hasAttribute('data-dpc-deliv-expected')) { commitExpected(state.jobId, t); return; }
    onV2FocusOut(t);
  }

  function onInput(e) {
    var t = e.target;
    if (!t || !t.hasAttribute) return;
    if (onV2Input(t)) return;
    if (t.hasAttribute('data-dpc-mat-pad')) { if (state.jobId) padInput(state.jobId, t.value); return; }
    if (onBoxInput(t)) return;
    if (onDelivInput(t)) return;
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
      // A details element's toggle does not bubble, so it is caught on the way down.
      r.addEventListener('toggle', onToggle, true);
      r.addEventListener('dragstart', onV2DragStart);
      r.addEventListener('dragover', onV2DragOver);
      r.addEventListener('drop', onV2Drop);
      r.addEventListener('dragend', v2DragEnd);
      wired = true;
    }
    if (!r.firstChild) render();
    loadBase();
    // Both lists are read up front so the Active and Archive buttons carry
    // their counts; the tray is read for its count on the header button.
    loadView('archive');
    loadTray();
  }

  // ── The job page (ops.html Overview): one job's Dispatch stage ──
  // A job page open reads its stage once (cached a minute per job): the v2
  // board searched by the job number, Active first and Archive only when the
  // job is not there, through the same rowsFromBoard checks as the list, so
  // the page can never draw a stage Dispatch would not. The stage is the job's
  // real pipeline (or Repairs) stage, the same as the Dispatch header rail. A
  // failed read says so and is not cached; it never reads as "not listed".
  var stageReads = {};
  function boardSearch(view, num, jobId) {
    return Promise.resolve().then(function () { return global.opsFetch('pipeline', { dispatch: 1, board: 'v2', view: view, search: num }); }).then(function (resp) {
      var got = rowsFromBoard(resp);
      var row = null;
      got.rows.forEach(function (r) { if (r.id === jobId) row = r; });
      return { row: row, stages: got.stages };
    });
  }

  function stageForJob(job) {
    var num = job ? text(job.job_number) : '';
    if (!job || !job.id || !num) return Promise.resolve({ status: 'unknown' });
    var hit = stageReads[job.id];
    if (hit && Date.now() - hit.at < 60000) return hit.p;
    var p = boardSearch('active', num, job.id).then(function (got) {
      return got.row ? got : boardSearch('archive', num, job.id);
    }).then(function (got) {
      return got.row ? { status: 'ok', row: got.row, stages: got.stages } : { status: 'not_listed' };
    }).catch(function () { return { status: 'error' }; });
    stageReads[job.id] = { at: Date.now(), p: p };
    p.then(function (r) { if (r.status === 'error' && stageReads[job.id] && stageReads[job.id].p === p) delete stageReads[job.id]; });
    return p;
  }

  // The card the job page shows for that answer: the track's stops, where the
  // job is and its next step. '' when there is nothing to say.
  function stageCardHtml(result) {
    if (!result || result.status === 'unknown') return '';
    var body;
    if (result.status === 'error') body = '<div style="font-size:12px;color:var(--sw-red);">Could not read the Dispatch stage.</div>';
    else if (result.status === 'not_listed') body = '<div style="font-size:12px;color:var(--sw-text-sec);">Not on the Dispatch list.</div>';
    else {
      var row = result.row || {}, b = row.board || {};
      var stops = trackStages(b, result.stages);
      var now = 0;
      stops.forEach(function (st, i) { if (st.key === b.stage_key) now = i + 1; });
      // Archived (moved past Scheduled): every stop is done.
      var after = b.stage_phase === 'after';
      var bars = stops.map(function (st, i) {
        var n = i + 1, at = !after && n === now, done = after || n < now;
        var bg = done ? 'var(--sw-green)' : at ? 'var(--sw-orange)' : 'var(--sw-light)';
        return '<div data-dispatch-stop="' + esc(st.key) + '"' + (at ? ' aria-current="step"' : '') + ' style="flex:1;min-width:0;">' +
          '<div style="height:4px;background:' + bg + ';margin-bottom:4px;"></div>' +
          '<div style="font-size:10px;line-height:1.25;color:' + (at ? 'var(--sw-dark)' : 'var(--sw-text-sec)') + ';font-weight:' + (at ? 700 : 500) + ';">' + esc(st.label) + '</div></div>';
      }).join('');
      var line = (b.track === 'repairs' ? 'Repairs stage: ' : 'Pipeline stage: ') + (text(b.stage_label) || keyWords(b.stage_key)) + (after ? ' · in the Dispatch archive' : '');
      var next = text(row.dispatch_next_step);
      body = '<div style="font-size:13px;color:var(--sw-text);margin-bottom:8px;">' + esc(line) + '</div>' +
        '<div style="display:flex;gap:4px;">' + bars + '</div>' +
        (next ? '<div style="font-size:12px;color:var(--sw-text);margin-top:8px;">Next step: ' + esc(next) + '</div>' : '');
    }
    var open = result.status === 'ok' ? '<a href="#dispatch" data-open-dispatch="1" style="font-size:11px;color:var(--sw-mid);">Open in Dispatch &#8599;</a>' : '';
    return '<div data-dispatch-card="1" style="background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;"><div style="font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;">Dispatch</div>' + open + '</div>' +
      body + '</div>';
  }

  // Open a job in Dispatch: the page then shows the Dispatch tab and this job.
  // A job the lists have not loaded yet is picked up when Active loads.
  function openJob(jobId) {
    if (!jobId) return;
    writeStore('sessionStorage', SS_JOB, jobId);
    var row = rowById(jobId);
    if (row) { selectJob(row); return; }
    state.jobId = null;
    state.row = null;
  }

  global.OpsDispatch = { show: show, stageForJob: stageForJob, stageCardHtml: stageCardHtml, openJob: openJob };
})(window);
