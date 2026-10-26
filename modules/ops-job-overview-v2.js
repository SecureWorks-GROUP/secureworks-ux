// ════════════════════════════════════════════════════════════
// JOB OVERVIEW V2: the job page Overview of the ops dashboard (ops.html, route
// #job/<job number>), rebuilt around the job context system. Screen doc:
// docs/job-overview-v2.md. Layout: customer header with the money, a strip of real
// files, then three columns: timeline, the story, the conversation.
//
// Switch (off by default): ?overview=v2 (or =1) turns it on for that load and
// ?overview=classic (or =0) turns it off; otherwise localStorage sw_overview_v2 = '1'.
// Staff also get a small "Try the new Overview" / "Back to classic" link.
//
// Reads:  job_detail (already loaded by openJobDetail) and ops-api job_overview
//         (slow: the story card takes 10 to 20 seconds, so it is cached per job for
//         3 minutes, read once at a time, and the page paints from job_detail first).
// Writes: ops-api request_job_story (the Rewrite button) and ghl-proxy send_sms (the
//         reply box; the same request the Comms tab makes).
//
// The page must never break: render() returns false on any error and the classic
// Overview renders instead. No emoji and no long dashes anywhere in this file
// (tests/e2e/ops-job-overview-v2-core.spec.js checks it).
// ════════════════════════════════════════════════════════════

// <job-overview-v2-core>
// Pure rules only: no DOM, no fetch, no window. tests/e2e/ops-job-overview-v2-core.spec.js
// runs this block in node. Every function that compares with "now" takes it as an argument.
var JobOverviewV2Core = (function () {
  'use strict';

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PERTH_MS = 8 * 3600000; // Western Australia stays on UTC+8 all year (the fallback only)
  var DOT = ' \u00b7 ';
  var ELL = '\u2026';

  // Rows that are machinery, not conversation (current-overview.md section 8).
  var MACHINE_TYPES = ['scope_saved', 'event_listener.reaction', 'conversation.synced',
    'automation.actions_cancelled', 'document.text_extracted', 'quote_viewed', 'quote.viewed',
    'quote.release_packet.v2.sealed', 'machine'];

  // The phases context_job_story emits, in the words its own now.line uses.
  var PHASE_WORDS = {
    enquiry: 'New enquiry', scope: 'Scoping', quote: 'Quoted', accepted: 'Accepted',
    deposit: 'Deposit stage', approvals: 'In approvals', materials: 'Materials being ordered',
    scheduled: 'Scheduled', install: 'Install under way', complete: 'Work complete',
    invoice: 'Invoicing', payment: 'Final payment stage', rectification: 'In rectification',
    makesafe: 'Make-safe in progress', other: 'In progress'
  };

  var SRC_WORDS = {
    business_events: 'Messages', jobs: 'Job record', job_events: 'Office app',
    job_documents: 'Quoting app', xero_invoices: 'Xero', email_events: 'Our system email',
    ledger: 'AI notes', context_ledger_items: 'AI notes', job_assignments: 'Schedule',
    purchase_orders: 'Purchase order', work_orders: 'Work order', job_media: 'Photos'
  };

  // The same sources, for the sentence "From ...".
  var FROM_WORDS = {
    business_events: 'the messages', jobs: 'the job record', job_events: 'the office app',
    job_documents: 'the quoting app', xero_invoices: 'Xero', email_events: 'our system email',
    ledger: 'the AI notes, true as at their date', context_ledger_items: 'the AI notes, true as at their date',
    job_assignments: 'the schedule', purchase_orders: 'a purchase order', work_orders: 'a work order', job_media: 'the photos'
  };

  var BLOCKS_WORDS = {
    deposit: 'the deposit', booking: 'booking', quote: 'the quote', payment: 'payment',
    install: 'the install', materials: 'materials', scheduled: 'scheduling', invoice: 'invoicing',
    scope: 'scoping', approvals: 'approvals'
  };

  var TITLE_WORDS = ['mr', 'mrs', 'ms', 'miss', 'dr', 'mx'];

  function str(v) { return v == null ? '' : String(v); }
  function lower(v) { return str(v).trim().toLowerCase(); }
  function num(v) {
    if (v == null || v === '' || typeof v === 'boolean') return NaN;
    var n = Number(v);
    return isFinite(n) ? n : NaN;
  }
  function n0(v) { var n = num(v); return isFinite(n) ? n : 0; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  function parseJson(v) {
    if (typeof v !== 'string') return obj(v);
    try { return obj(JSON.parse(v)); } catch (e) { return null; }
  }
  function firstNum() {
    for (var i = 0; i < arguments.length; i++) { var n = num(arguments[i]); if (isFinite(n)) return n; }
    return null;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function times(n) { return n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times'; }
  function cap(s) { s = str(s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function hash(s) {
    s = str(s);
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  // ── Time: everything shows in Perth time, whatever zone the browser is in ──

  // Milliseconds for an ISO instant, a Postgres timestamp, or a date. A bare date
  // (2026-10-16) is a Perth calendar date, so it is read as Perth midnight.
  function toMs(v) {
    if (v == null || v === '' || typeof v === 'boolean') return NaN;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v instanceof Date) return v.getTime();
    var s = String(v).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) - PERTH_MS;
    s = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2').replace(/([+-]\d{2})$/, '$1:00');
    var t = Date.parse(s);
    return isFinite(t) ? t : NaN;
  }

  var _pf = null;
  function perth(ms) {
    var y, mo, d, h, mi;
    try {
      if (!_pf) {
        _pf = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Perth', year: 'numeric', month: 'numeric',
          day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
      }
      var o = {};
      _pf.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
      y = parseInt(o.year, 10); mo = parseInt(o.month, 10); d = parseInt(o.day, 10);
      h = parseInt(o.hour, 10) % 24; mi = parseInt(o.minute, 10);
      if (!(y > 0 && mo > 0 && d > 0) || isNaN(h) || isNaN(mi)) throw new Error('parts');
    } catch (e) {
      var t = new Date(ms + PERTH_MS);
      y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = t.getUTCDate(); h = t.getUTCHours(); mi = t.getUTCMinutes();
    }
    return { y: y, mo: mo, d: d, h: h, mi: mi, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(), key: y + '-' + pad(mo) + '-' + pad(d) };
  }

  // Perth fields for a value, plus dateOnly: a bare date, or exactly Perth midnight
  // (Xero rows arrive that way, for example 2026-10-01T16:00Z), shows with no time.
  function pt(v) {
    var ms = toMs(v);
    if (!isFinite(ms)) return null;
    var p = perth(ms);
    p.ms = ms;
    p.dateOnly = (typeof v === 'string' && /^\s*\d{4}-\d{2}-\d{2}\s*$/.test(v)) || (p.h === 0 && p.mi === 0 && ms % 60000 === 0);
    return p;
  }
  function nowPt(now) { return pt(now == null ? Date.now() : now) || perth(Date.now()); }
  function clock(p) { return (p.h % 12 || 12) + ':' + pad(p.mi) + (p.h < 12 ? 'am' : 'pm'); }
  function dateWords(p, np, noDow) {
    return (noDow ? '' : DAYS[p.dow] + ' ') + p.d + ' ' + MONTHS[p.mo - 1] + (np && np.y !== p.y ? ' ' + p.y : '');
  }
  function dayIndex(p) { return Date.UTC(p.y, p.mo - 1, p.d) / 86400000; }

  // "Today", "Yesterday" or "Wed 7 Oct" (with the year when it is not this year).
  function dayLabel(v, now) {
    var p = pt(v);
    if (!p) return '';
    var np = nowPt(now);
    var diff = dayIndex(np) - dayIndex(p);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return dateWords(p, np);
  }
  // "9:22am"; empty for a date-only value.
  function timeWords(v) { var p = pt(v); return p && !p.dateOnly ? clock(p) : ''; }
  // "Tue 1 Sep · 11:41am", or "Fri 2 Oct" for a date-only value.
  function when(v, now) {
    var p = pt(v);
    if (!p) return '';
    var s = dateWords(p, nowPt(now));
    return p.dateOnly ? s : s + DOT + clock(p);
  }
  // "Fri 9 Oct, 10:50am" for stamps.
  function stamp(v, now) {
    var p = pt(v);
    if (!p) return '';
    var s = dateWords(p, nowPt(now));
    return p.dateOnly ? s : s + ', ' + clock(p);
  }
  // "8 Oct 6:56am" for file cards, "8 Oct" for a date-only value.
  function shortWhen(v, now) {
    var p = pt(v);
    if (!p) return '';
    var s = dateWords(p, nowPt(now), true);
    return p.dateOnly ? s : s + ' ' + clock(p);
  }
  function shortDate(v, now) { var p = pt(v); return p ? dateWords(p, nowPt(now), true) : ''; }
  function longDate(v, now) { var p = pt(v); return p ? dateWords(p, nowPt(now)) : ''; }
  function perthDayKey(v) { var p = pt(v); return p ? p.key : ''; }

  // ── Words ──

  // Stored text can hold long dashes; the screen never shows one. A dash between two
  // numbers is a range ("2 to 3"); any other becomes a comma.
  var DASHES = '\\u2012\\u2013\\u2014\\u2015\\u2E3A\\u2E3B';
  var RANGE_RE = new RegExp('(\\d)[ \\t]*[' + DASHES + ']+[ \\t]*(\\$?\\d)', 'g');
  var DASH_RE = new RegExp('[ \\t]*[' + DASHES + ']+[ \\t]*', 'g');
  var EMOJI_RE = new RegExp('(?:[0-9#*]\\uFE0F?\\u20E3)|[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\p{Emoji_Modifier}\\uFE0F\\u200D]', 'gu');
  function clean(v) {
    if (v == null) return '';
    var s = String(v).replace(/\r\n?/g, '\n');
    s = s.replace(RANGE_RE, '$1 to $2').replace(DASH_RE, ', ');
    s = s.replace(EMOJI_RE, '');
    s = s.replace(/[ \t]*,(?:[ \t]*,)+/g, ',').replace(/[ \t]+,/g, ',');
    s = s.replace(/[ \t]{2,}/g, ' ').replace(/^[\s,]+/, '').replace(/[\s,]+$/, '');
    return s;
  }
  // Cut at a word for previews.
  function cut(v, n) {
    var s = str(v);
    if (s.length <= n) return s;
    var c = s.slice(0, n), i = c.lastIndexOf(' ');
    if (i > n * 0.6) c = c.slice(0, i);
    return c.replace(/[\s,;:.(]+$/, '') + ELL;
  }
  function sentences(v) {
    var s = clean(v), out = [], re = /[\s\S]+?[.!?](?=\s|$)|[\s\S]+$/g, m;
    while ((m = re.exec(s))) { var t = m[0].trim(); if (t) out.push(t); if (re.lastIndex >= s.length) break; }
    return out;
  }
  function firstSentence(v) { return sentences(v)[0] || ''; }
  // A headline from the story card's own line when no written story exists: the first sentence,
  // plus the second when the first is short. rest is what is left of the line.
  function headlineFrom(line) {
    var ss = sentences(line);
    var n = ss.length > 1 && ss[0].length < 60 && (ss[0].length + ss[1].length) <= 150 ? 2 : 1;
    return { headline: ss.slice(0, n).join(' '), rest: ss.slice(n).join(' ') };
  }
  function firstName(v) {
    var s = clean(v);
    if (!s || s.indexOf('@') >= 0) return s;
    var w = s.split(/\s+/);
    if (TITLE_WORDS.indexOf(w[0].toLowerCase().replace(/\.$/, '')) >= 0) return cut(s, 24);
    return w[0];
  }
  function money(v) {
    var n = num(v);
    if (!isFinite(n)) n = 0;
    var neg = n < 0;
    n = Math.round(Math.abs(n) * 100) / 100;
    var p = n.toFixed(2).split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + '$' + p[0] + '.' + p[1];
  }
  function humanStatus(s) { s = lower(s).replace(/_/g, ' '); return cap(s); }

  // A long dash, an en dash or an emoji has no place in a text to a customer (company rule).
  var BANNED_RE = (function () {
    try { return new RegExp('[' + DASHES + ']|\\p{Extended_Pictographic}', 'u'); }
    catch (e) { return new RegExp('[' + DASHES + ']|[\\u2600-\\u27BF]|[\\uD83C-\\uDBFF][\\uDC00-\\uDFFF]'); }
  })();
  function hasBanned(v) { return BANNED_RE.test(str(v)); }

  // ── The switch ──

  // ?overview=v2 or =1 turns it on, ?overview=classic or =0 turns it off; the URL wins over
  // the browser setting both ways. Otherwise localStorage sw_overview_v2 === '1'. Off by default.
  function flagOn(search, stored) {
    var m = /[?&]overview=([^&#]*)/.exec(str(search));
    if (m) {
      var v = m[1];
      try { v = decodeURIComponent(v); } catch (e) { /* keep it raw */ }
      v = lower(v);
      if (v === 'v2' || v === '1' || v === 'new' || v === 'on') return true;
      if (v === 'classic' || v === '0' || v === 'v1' || v === 'off') return false;
    }
    return str(stored) === '1';
  }

  // An action ops-api does not know yet: the backend part has not been deployed.
  function isNotDeployed(e) {
    if (!e) return false;
    var b = obj(e.body) || {};
    if (e.code === 'unknown_action' || b.code === 'unknown_action') return true;
    var msg = str(e.message) + ' ' + (typeof b.error === 'string' ? b.error : '');
    return /unknown action/i.test(msg) && (e.status == null || e.status === 400 || e.status === 404);
  }

  // ── The written story (context_job_story_text_get) ──

  var SECTION_KEYS = ['headline', 'the_job', 'how_we_got_here', 'where_it_is_at', 'watch_out'];
  // Accepts the text flat or one level down; returns null when there is nothing usable.
  function storyText(raw) {
    var r = obj(raw);
    if (!r) return null;
    var src = r;
    if (!obj(r.sections) && typeof r.sections !== 'string') {
      ['text', 'current', 'story_text', 'row', 'data', 'story'].some(function (k) {
        var c = obj(r[k]);
        if (c && (obj(c.sections) || typeof c.sections === 'string')) { src = c; return true; }
        return false;
      });
    }
    var fresh = '';
    [r.freshness, r.state, r.status, src.freshness, src.state, src.status].some(function (v) {
      var s = lower(v);
      if (s === 'fresh' || s === 'stale' || s === 'none') { fresh = s; return true; }
      return false;
    });
    var sec = parseJson(src.sections);
    var sections = null;
    if (sec) {
      var any = false;
      sections = {};
      SECTION_KEYS.forEach(function (k) { var t = clean(sec[k]); sections[k] = t; if (t) any = true; });
      if (!any) sections = null;
    }
    var req = obj(r.request) || {};
    var writer = obj(r.writer) || {};
    return {
      state: !sections ? 'none' : (fresh === 'stale' ? 'stale' : 'fresh'),
      sections: sections,
      written_at: src.written_at || r.written_at || null,
      evidence_until: src.evidence_until || r.evidence_until || null,
      request_open: !!(r.request_open || src.request_open || writer.open_request || (req.requested_at && !req.done_at)),
      requested_at: r.requested_at || req.requested_at || null,
      writer_on: writer.on == null ? (r.writer_on == null ? null : !!r.writer_on) : !!writer.on
    };
  }
  // Paragraphs of a section: blank lines split them.
  function paragraphs(v) {
    return clean(v).split(/\n\s*\n/).map(function (p) { return p.replace(/\s*\n\s*/g, ' ').trim(); }).filter(Boolean);
  }

  // What the request_job_story answer means, in words ('' for a plain "queued").
  function rewriteWords(res) {
    var r = obj(res) || {};
    var s = lower(r.state || r.result || r.outcome || r.status || '');
    if (r.ok === false || r.requested === false) return clean(r.reason || r.error || 'The rewrite was not asked for.');
    if (s === 'off') return 'Rewriting is not switched on yet.';
    if (!s) return 'The rewrite could not be confirmed. Refresh before trying again.';
    if (/already|open|pending|exists|in_progress/.test(s)) return 'A rewrite was already asked for; it is on its way.';
    if (/recent|fresh|rate|too_soon|up_to_date|nothing/.test(s)) return 'It was rewritten in the last 10 minutes and nothing new has happened since.';
    if (s && s !== 'queued') return 'The rewrite could not be confirmed. Refresh before trying again.';
    return '';
  }
  function rewriteAccepted(res) {
    var r = obj(res) || {};
    if (r.ok === false || r.requested === false) return false;
    return ['queued', 'already_open', 'recent'].indexOf(lower(r.state || r.result || r.outcome || r.status)) >= 0;
  }

  function sourceFailures(overview) {
    var sources = obj(overview && overview.sources) || {};
    var labels = { job: 'customer details', story: 'job story', notes: 'AI notes', messages: 'conversation',
      quotes: 'quotes', quote_views: 'quote views', invoices: 'invoices', attachments: 'attachments',
      media: 'photos', scope: 'scope', story_text: 'written story' };
    return Object.keys(labels).filter(function (key) {
      var s = obj(sources[key]);
      return s && (s.ok === false || s.state === 'failed' || s.state === 'not_deployed');
    }).map(function (key) { return labels[key]; });
  }

  // ── People and whose move ──

  function customerName(job, story) {
    var n = job && job.client_name;
    if (!n && story) {
      var c = arr(story.who).filter(function (w) { return w && lower(w.role) === 'customer'; })[0];
      n = (c && c.name) || (obj(story.job) && story.job.client_name);
    }
    return clean(n);
  }
  function thirdPartyName(story, loop) {
    if (loop && loop.owner_name) return clean(loop.owner_name);
    var tp = arr(story && story.who).filter(function (w) { return w && lower(w.role) === 'third_party' && w.name; })[0];
    return tp ? clean(tp.name) : '';
  }
  // The only values context_job_story emits: us, customer, third_party, unknown, nobody.
  function whoseMove(whose, job, story) {
    var w = lower(whose);
    if (!w) return null;
    if (w === 'us') return { key: 'us', words: 'Our move' };
    if (w === 'customer') {
      var fn = firstName(customerName(job, story));
      return { key: 'customer', words: fn ? fn + '\'s move' : 'The customer\'s move' };
    }
    if (w === 'third_party') {
      var tp = thirdPartyName(story);
      return { key: 'third_party', words: tp ? cap(tp) + '\'s move' : 'The other party\'s move' };
    }
    if (w === 'nobody') return { key: 'nobody', words: 'Nothing waiting' };
    return { key: 'unknown', words: 'Whose move is unclear' };
  }

  // ── Open items: blocking, waiting on someone, good to know ──

  function loopGroup(l) {
    if (lower(l.status) === 'not_due' || lower(l.status) === 'unconfirmed') return 'know';
    var named = lower(l.group);
    if (named === 'blocking' || named === 'waiting') return named;
    if (named === 'good_to_know' || named === 'know') return 'know';
    var rule = lower(l.rule), st = lower(l.status), o = lower(l.owner);
    if (rule === 'constraint' || rule === 'claim' || st === 'closing_evidence' || st === 'not_due' || st === 'unconfirmed') return 'know';
    if (o === 'customer' || o === 'third_party') return 'waiting';
    return 'blocking';
  }
  function ownerTag(l, job, story) {
    var o = lower(l.owner);
    if (o === 'us') return { cls: 'us', words: 'US' };
    if (o === 'customer') {
      var fn = firstName(l.owner_name || customerName(job, story));
      return { cls: 'cust', words: (fn || 'customer').toUpperCase() };
    }
    if (o === 'third_party') return { cls: 'tp', words: cut(thirdPartyName(story, l) || 'other party', 22).toUpperCase() };
    return { cls: 'unk', words: 'UNCLEAR' };
  }
  var ROLE_OWNER = { us: 'us', staff: 'us', ours: 'us', customer: 'customer', client: 'customer', third_party: 'third_party', neighbour: 'third_party', other: 'third_party' };
  // The live AI notes, read as open items when the story card has no loops.
  function loopsFromNotes(notes) {
    return arr(notes).filter(function (n) { return n && n.what && lower(n.status) === 'open'; }).map(function (n) {
      var commit = lower(n.item_type) === 'commitment';
      var role = lower(n.owner || (commit ? n.from_role : n.to_role));
      return {
        key: 'note:' + str(n.id || hash(n.what)), owner: ROLE_OWNER[role] || 'unknown',
        owner_name: n.owner_name || (commit ? n.from_name : n.to_name), group: n.group,
        rule: n.item_type, status: n.status,
        what: n.what, why: n.quote, since: n.opened_at, blocks: n.blocks, source: 'ledger', closes_when: null
      };
    });
  }
  function openItems(story, job, notes, now) {
    var loops = arr(story && story.loops).filter(function (l) {
      return l && l.what && ['closed', 'superseded', 'done', 'resolved'].indexOf(lower(l.status)) < 0;
    });
    if (!loops.length) loops = loopsFromNotes(Array.isArray(notes) ? notes : (obj(notes) && notes.items));
    var groups = { blocking: [], waiting: [], know: [] };
    loops.forEach(function (l, i) {
      var g = loopGroup(l);
      var ledger = lower(l.source) === 'ledger';
      var since = l.since || l.opened_at;
      var blocks = lower(l.blocks);
      groups[g].push({
        key: 'loop:' + str(l.key || ('i' + i + ':' + hash(l.what))),
        group: g,
        tag: lower(l.status) === 'not_due' ? { cls: 'unk', words: 'HELD' } : ownerTag(l, job, story),
        status: lower(l.status),
        what: clean(l.what),
        when: since ? (ledger ? 'As at ' : 'Since ') + longDate(since, now) : '',
        blocks: blocks ? 'Holds up ' + (BLOCKS_WORDS[blocks] || clean(blocks).replace(/_/g, ' ')) : '',
        why: clean(l.why),
        whyLabel: ledger ? 'In their words: ' : 'Why: ',
        closes: clean(l.closes_when),
        rank: isFinite(num(l.rank)) ? num(l.rank) : 100000 + i,
        cites: arr(l.cites)
      });
    });
    ['blocking', 'waiting', 'know'].forEach(function (k) { groups[k].sort(function (a, b) { return a.rank - b.rank; }); });
    return groups;
  }

  // The AI notes status line, said every time.
  function ledgerWords(ledger, now) {
    var l = obj(ledger);
    var st = lower(l && l.status);
    if (!l || !st || st === 'none' || st === 'missing' || st === 'not_built') return 'AI notes not built yet';
    var unread = n0(l.unread_rows);
    if (unread > 0) return 'AI notes have not read the newest ' + plural(unread, 'record') + ' yet';
    if (l.stale === true || l.needs_rebuild === true) return 'AI notes are due for a fresh read';
    var until = l.evidence_until ? stamp(l.evidence_until, now) : '';
    return until ? 'AI notes have read everything up to ' + until : 'AI notes are up to date';
  }

  // ── Money ──

  function pricing(job) { return parseJson(job && job.pricing_json) || {}; }
  function invoiceRow(r, jobId) {
    r = obj(r) || {};
    var dates = obj(r.dates) || {};
    var due = r.amount_due != null ? r.amount_due : (r.owing != null ? r.owing : (typeof r.due === 'number' ? r.due : null));
    var paid = num(r.amount_paid != null ? r.amount_paid : r.paid);
    var jid = r.job_id == null ? null : str(r.job_id);
    return {
      id: r.id != null ? str(r.id) : null,
      xeroId: r.xero_invoice_id ? str(r.xero_invoice_id) : (r.xero_id ? str(r.xero_id) : null),
      number: clean(r.invoice_number || r.number || ''),
      reference: clean(r.reference || ''),
      status: str(r.status).trim().toUpperCase(),
      type: str(r.invoice_type || r.type || 'ACCREC').trim().toUpperCase(),
      total: n0(r.total),
      paid: isFinite(paid) ? paid : 0,
      due: isFinite(num(due)) ? num(due) : null,
      dueDate: r.due_date || (typeof r.due === 'string' ? r.due : null) || dates.due || null,
      invoiceDate: r.invoice_date || r.date || dates.invoice || dates.invoice_date || null,
      paidOn: r.fully_paid_on || r.paid_on || dates.paid || dates.fully_paid_on || null,
      createdAt: r.created_at || dates.created || null,
      byName: !!(jobId && jid !== str(jobId)),
      raw: r
    };
  }
  // Customer invoices: job_overview's files when it has them, else job_detail's rows (which can
  // hold another job's invoices, matched on the client name: flagged byName). Supplier bills
  // (ACCPAY) are not the customer's money and are left out.
  function invoices(detail, overview) {
    var job = (detail && detail.job) || {};
    var fx = obj(overview && overview.files);
    var src = fx && Array.isArray(fx.invoices) ? fx.invoices : arr(detail && detail.invoices);
    var records = arr(detail && detail.invoices);
    return src.map(function (r) {
      // job_overview owns the amount and status; job_detail still carries the Xero link id.
      var match = fx && records.filter(function (d) { return d && r && r.id && String(d.id) === String(r.id); })[0];
      var row = match ? Object.assign({}, match, r, { xero_invoice_id: r.xero_invoice_id || match.xero_invoice_id }) : r;
      // The overview read selects by job_id. A fallback detail row with no link
      // may have been matched by customer name and cannot speak for this job.
      return invoiceRow(fx && Array.isArray(fx.invoices) ? Object.assign({}, row, { job_id: job.id }) : row, job.id);
    }).filter(function (i) { return !/ACCPAY|BILL/.test(i.type); });
  }
  function jobValue(detail, overview) {
    var job = (detail && detail.job) || {};
    var story = obj(overview && overview.story);
    var sm = story && obj(story.money);
    var jv = sm && obj(sm.job_value) ? num(sm.job_value.amount) : NaN;
    if (isFinite(jv) && jv > 0) return jv;
    var pj = pricing(job);
    var v = firstNum(pj.totalIncGST, pj.total);
    return v != null && v > 0 ? v : null;
  }
  // A recorded price is not a settled contract when the card carries a value check.
  // Keep the source and the conflicting records beside it; never infer a new contract
  // or a receivable from invoice percentages in the browser.
  function valueAuthority(detail, overview) {
    var story = obj(overview && overview.story) || {};
    var sm = obj(story.money) || {};
    var value = obj(sm.job_value) || {};
    var future = obj(sm.not_yet_invoiced) || {};
    var checks = arr(story.checks).filter(function (c) { return c && lower(c.rule) === 'c2_value_mismatch'; });
    var unconfirmed = value.unconfirmed === true || future.unconfirmed === true || checks.length > 0 ||
      arr(story.loops).some(function (l) { return l && lower(l.rule) === 'r8_not_yet_invoiced' && lower(l.status) === 'unconfirmed'; });
    var basis = clean(value.basis);
    if (!basis || /^pricing_json\./.test(basis)) basis = 'Saved scope price';
    else if (basis === 'jobs.quoted_value') basis = 'Recorded quote value';
    return { unconfirmed: unconfirmed, recordOnly: !obj(sm.job_value), basis: basis,
      checks: checks.map(function (c) { return clean(c.what); }).filter(Boolean) };
  }
  function futureMoney(story) {
    var f = obj(story && story.money && story.money.not_yet_invoiced);
    if (!f) return null;
    var loop = arr(story.loops).filter(function (l) { return l && lower(l.rule) === 'r8_not_yet_invoiced'; })[0];
    return { amount: f.amount == null ? null : firstNum(f.amount), unconfirmed: f.unconfirmed === true,
      held: f.held === true || lower(f.status) === 'not_due' || !!(loop && lower(loop.status) === 'not_due'),
      basis: clean(f.basis), why: clean(loop && loop.why) };
  }
  // Job value, invoiced and paid. DRAFT invoices are not invoiced; VOIDED and DELETED are ignored
  // (so a false "paid" on a deleted invoice never counts). The story card's money wins when present.
  function moneySummary(detail, overview) {
    var job = (detail && detail.job) || {};
    var story = obj(overview && overview.story);
    var sm = story && obj(story.money);
    var out = { value: jobValue(detail, overview), invoiced: 0, paid: 0, drafts: [], draftTotal: 0, nameOnly: 0, splits: [], basis: 'records' };
    var invs = invoices(detail, overview);
    if (sm && Array.isArray(sm.parties)) {
      out.basis = 'story';
      sm.parties.forEach(function (p) {
        if (!p) return;
        out.invoiced += n0(p.invoiced);
        out.paid += n0(p.paid);
        arr(p.invoices).forEach(function (i) {
          if (i && str(i.status).toUpperCase() === 'DRAFT') out.drafts.push({ id: i.id != null ? str(i.id) : null, number: clean(i.number || i.invoice_number), total: n0(i.total), xeroId: i.xero_invoice_id ? str(i.xero_invoice_id) : null });
        });
      });
    } else {
      invs.forEach(function (i) {
        if (i.byName) { out.nameOnly++; return; }
        if (i.status === 'DRAFT' || i.status === 'SUBMITTED') { out.drafts.push({ id: i.id, number: i.number, total: i.total, xeroId: i.xeroId }); return; }
        if (i.status !== 'AUTHORISED' && i.status !== 'PAID') return;
        out.invoiced += i.total;
        out.paid += i.paid;
      });
    }
    out.drafts.forEach(function (d) {
      if (d.xeroId) return;
      var m = invs.filter(function (i) { return (d.id && i.id === d.id) || (d.number && i.number === d.number); })[0];
      if (m) d.xeroId = m.xeroId;
    });
    out.draftTotal = out.drafts.reduce(function (s, d) { return s + d.total; }, 0);
    // Who pays what, only when the scoping tool recorded the split.
    var ns = obj(pricing(job).neighbour_splits);
    if (ns) {
      var cp = num(ns.client_portion_inc_gst);
      if (isFinite(cp)) out.splits.push({ who: firstName(customerName(job, story)) || 'Customer', amount: cp });
      var nbs = arr(ns.neighbours);
      nbs.forEach(function (nb, i) {
        var a = num(nb && nb.portion_inc_gst);
        if (!isFinite(a)) return;
        var nm = firstName(nb.name);
        out.splits.push({ who: nm ? nm + ' (neighbour)' : 'Neighbour' + (nbs.length > 1 ? ' ' + (i + 1) : ''), amount: a });
      });
      if (out.splits.length < 2) out.splits = [];
      if (out.splits.length && out.value != null) {
        var splitTotal = out.splits.reduce(function (sum, sp) { return sum + sp.amount; }, 0);
        if (Math.abs(splitTotal - out.value) > 0.02) out.splitWarning = 'Recorded shares total ' + money(splitTotal) + ', which differs from the job value. Check the scope split.';
      }
    }
    return out;
  }

  // ── Files ──

  function normQuote(q) {
    q = obj(q) || {};
    var sentAt = q.sent_at || (typeof q.sent === 'string' ? q.sent : null);
    var supAt = q.superseded_at || (typeof q.superseded === 'string' ? q.superseded : null);
    var views = firstNum(q.view_count, q.views, q.views_count);
    return {
      id: q.id != null ? str(q.id) : (q.document_id != null ? str(q.document_id) : null),
      number: clean(q.quote_number || q.number || ''),
      version: isFinite(num(q.version)) ? num(q.version) : null,
      type: lower(q.type || 'quote'),
      sentAt: sentAt || null,
      sent: !!(sentAt || q.sent === true || q.sent_to_client === true),
      viewedAt: q.first_viewed_at || q.first_viewed || q.viewed_at || null,
      acceptedAt: q.accepted_at || (typeof q.accepted === 'string' ? q.accepted : null) || null,
      supersededAt: supAt || null,
      superseded: !!(supAt || q.superseded === true),
      declinedAt: q.declined_at || null,
      views: views,
      value: firstNum(q.value_inc_gst, q.value, q.total_inc_gst),
      createdAt: q.created_at || null
    };
  }
  // Quotes with the job_detail document joined on (it carries pdf_url and share_token).
  function quoteRows(detail, overview) {
    var fx = obj(overview && overview.files);
    var docs = arr(detail && detail.documents).filter(Boolean);
    var rows = fx && (Array.isArray(fx.quotes) ? fx.quotes : (obj(fx.quotes) && Array.isArray(fx.quotes.documents) ? fx.quotes.documents : null));
    if (rows) {
      return rows.map(function (raw) {
        var q = normQuote(raw);
        q.doc = docs.filter(function (d) { return q.id && str(d.id) === q.id; })[0] ||
          docs.filter(function (d) { return q.number && clean(d.quote_number) === q.number && num(d.version) === q.version; })[0] || null;
        return q;
      });
    }
    return docs.filter(function (d) { return d.type === 'quote' || d.type === 'permit_quote'; }).map(function (d) {
      var q = normQuote(d);
      q.doc = d;
      q.fromRecord = true;
      return q;
    });
  }
  function quotedValue(detail, overview) {
    var fx = obj(overview && overview.files);
    var envelope = obj(fx && fx.quotes);
    if (envelope && Object.prototype.hasOwnProperty.call(envelope, 'headline')) {
      return firstNum(envelope.headline && envelope.headline.value_inc_gst);
    }
    var current = quoteRows(detail, overview).filter(function (q) { return !q.superseded; })
      .sort(function (a, b) { return toMs(b.sentAt || b.createdAt) - toMs(a.sentAt || a.createdAt); })[0];
    return current ? current.value : null;
  }
  function scopeMeta(job, sj, now) {
    if (!sj) return '';
    if (lower(job.type) === 'fencing') {
      var fj = obj(sj.job) || {};
      var total = arr(fj.runs).reduce(function (s, r) { return s + n0(r && r.length); }, 0);
      var len = total > 0 ? (Math.round(total * 10) / 10) + 'm' : '';
      var parts = [clean(fj.scoper), fj.date ? shortDate(fj.date, now) : '', [len, clean(fj.profile)].filter(Boolean).join(' ')];
      var rem = obj(fj.removal);
      if (rem && rem.removalRequired && lower(rem.existingFenceType) === 'asbestos') parts.push('asbestos removal');
      return parts.filter(Boolean).join(DOT);
    }
    var sc = obj(sj.config) || sj;
    var p = [];
    if (sc.length && sc.projection) p.push(sc.length + 'm x ' + sc.projection + 'm');
    if (sc.roofStyle) p.push(clean(sc.roofStyle));
    return p.join(', ');
  }
  function normAttachment(a) {
    a = obj(a) || {};
    var at = a.at || a.date || a.event_at || a.occurred_at || a.created_at || a.received_at || null;
    return {
      name: clean(a.file_name || a.name || a.filename || 'Attachment'), source: lower(a.source),
      at: at, ms: toMs(at),
      pages: firstNum(a.page_count, a.pages),
      contentType: lower(a.content_type || a.mime || '')
    };
  }
  // Email attachments the context system read (business_events document rows), when job_overview is absent.
  function attachmentsFromDetail(detail) {
    return arr(detail && detail.business_events).filter(function (r) {
      return r && lower(r.event_type) === 'document.text_extracted';
    }).map(function (r) {
      var p = parseJson(r.payload) || {};
      var d = obj(p.document) || {};
      if (lower(d.source_kind) !== 'email_attachment' || !d.file_name) return null;
      return normAttachment({ file_name: d.file_name, at: r.event_at || r.occurred_at, page_count: d.page_count, content_type: d.content_type });
    }).filter(Boolean);
  }
  function attIcon(a) {
    var ext = (/\.([a-z0-9]{2,5})$/i.exec(a.name) || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    if (/^(jpe?g|png|gif|heic|webp)$/.test(ext) || /^image\//.test(a.contentType)) return { cls: 'img', label: ext === 'jpeg' ? 'JPG' : (ext || 'img').toUpperCase() };
    return { cls: 'doc', label: ext ? ext.toUpperCase().slice(0, 4) : 'FILE' };
  }
  function attName(a) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(a.name) && attIcon(a).cls === 'img') return 'Picture from an email';
    return a.name;
  }
  // The files strip: live quotes (newest first), live invoices, the scope, email attachments,
  // photos, then the faded ones (replaced quotes, deleted or voided invoices).
  function files(detail, overview, now) {
    var job = (detail && detail.job) || {};
    var fx = obj(overview && overview.files);
    var live = [], faded = [];

    var qs = quoteRows(detail, overview);
    var recordMode = !(fx && Array.isArray(fx.quotes));
    qs.sort(function (a, b) {
      return (n0(b.version) - n0(a.version)) || ((toMs(b.sentAt || b.createdAt) - toMs(a.sentAt || a.createdAt)) || 0);
    });
    var currentSeen = false;
    qs.forEach(function (q, i) {
      var old = q.superseded || (recordMode && currentSeen && !q.acceptedAt);
      var isCurrent = !old && !currentSeen;
      if (!old) currentSeen = true;
      var name = (q.type === 'permit_quote' ? 'Permit quote' : 'Quote') + (q.number ? ' ' + q.number : '') + (q.version ? DOT + 'v' + q.version : '');
      // A quote card shows only the value recorded on that quote, never today's job price.
      var meta = [];
      if (q.value != null) meta.push(money(q.value));
      else if (isCurrent) meta.push('value not recorded');
      meta.push(q.sentAt ? 'sent ' + shortWhen(q.sentAt, now) : (q.sent ? 'sent' : 'not sent'));
      if (q.views != null) meta.push(q.views === 0 ? 'not opened yet' : 'opened ' + times(q.views));
      var pill;
      if (q.acceptedAt) pill = { cls: 'acc', words: 'Accepted ' + shortDate(q.acceptedAt, now) };
      else if (q.declinedAt) pill = { cls: 'warn', words: 'Declined ' + shortDate(q.declinedAt, now) };
      else if (q.superseded) pill = { cls: 'sup', words: 'Replaced' + (q.supersededAt ? ' ' + shortDate(q.supersededAt, now) : '') };
      else if (old) pill = { cls: 'sup', words: 'Earlier version' };
      else pill = { cls: 'info', words: q.sent ? 'Sent' : 'Not sent' };
      (old ? faded : live).push({
        key: 'quote:' + (q.id || (q.number + ':' + q.version + ':' + i)), kind: 'quote', icon: { cls: 'q', label: 'PDF' },
        name: name, meta: meta.join(DOT), pill: pill, faded: !!old, open: { type: 'quote', doc: q.doc || null, quote: q }
      });
    });

    var today = perthDayKey(now == null ? Date.now() : now);
    var invs = invoices(detail, overview);
    invs.sort(function (a, b) { return (toMs(b.invoiceDate || b.createdAt) - toMs(a.invoiceDate || a.createdAt)) || 0; });
    invs.forEach(function (i, idx) {
      var dead = i.status === 'VOIDED' || i.status === 'DELETED';
      var name = (/DEP/i.test(i.reference) || /deposit/i.test(i.reference) ? 'Deposit invoice ' : 'Invoice ') + (i.number || '(no number)');
      var meta = [money(i.total)];
      var d = i.invoiceDate || i.createdAt;
      if (d) meta.push(shortDate(d, now));
      var pill;
      if (i.status === 'SUBMITTED') pill = { cls: 'warn', words: 'Awaiting approval in Xero, cannot be paid' };
      else if (i.status === 'DRAFT') pill = { cls: 'warn', words: 'Draft in Xero, cannot be paid' };
      else if (i.status === 'DELETED') pill = { cls: 'sup', words: 'Deleted in Xero' };
      else if (i.status === 'VOIDED') pill = { cls: 'sup', words: 'Voided in Xero' };
      else if (i.status === 'PAID') pill = { cls: 'acc', words: 'Paid (Xero)' + (i.paidOn ? ' ' + shortDate(i.paidOn, now) : '') };
      else {
        var owing = i.due != null ? i.due : Math.max(0, i.total - i.paid);
        var overdue = owing > 0 && i.dueDate && perthDayKey(i.dueDate) && perthDayKey(i.dueDate) < today;
        if (i.paid > 0 && owing > 0) meta.push('paid ' + money(i.paid));
        if (i.dueDate && owing > 0) meta.push('due ' + shortDate(i.dueDate, now));
        pill = overdue ? { cls: 'warn', words: 'Owed · past due ' + money(owing) } : (owing > 0 ? { cls: 'info', words: 'Owed ' + money(owing) } : { cls: 'info', words: 'Approved in Xero' });
      }
      if (i.byName) meta.push('matched by name only');
      (dead ? faded : live).push({
        key: 'inv:' + (i.id || i.xeroId || i.number || idx), kind: 'invoice', icon: { cls: 'inv', label: 'XERO' },
        name: name, meta: meta.join(DOT), pill: pill, faded: dead, open: { type: 'invoice', inv: i }
      });
    });

    var sj = parseJson(job.scope_json);
    var hasScope = fx && fx.scope != null ? !!(fx.scope === true || (obj(fx.scope) && fx.scope.exists !== false)) : !!sj;
    var type = lower(job.type);
    if (hasScope && type !== 'miscellaneous' && type !== 'makesafe') {
      live.push({ key: 'scope', kind: 'scope', icon: { cls: 'doc', label: 'SCOPE' }, name: 'Scope of works',
        meta: scopeMeta(job, sj, now), pill: { cls: 'info', words: 'Scoping tool' }, faded: false, open: { type: 'scope' } });
    }

    var atts = fx && Array.isArray(fx.attachments) ? fx.attachments.map(normAttachment) : attachmentsFromDetail(detail);
    var byName = {}, order = [];
    atts.forEach(function (a) {
      var k = a.name.toLowerCase();
      if (!byName[k]) { byName[k] = { a: a, count: 0 }; order.push(k); }
      byName[k].count++;
      if (isFinite(a.ms) && (!isFinite(byName[k].a.ms) || a.ms > byName[k].a.ms)) byName[k].a = a;
    });
    order.sort(function (x, y) { return (byName[y].a.ms - byName[x].a.ms) || 0; });
    order.forEach(function (k) {
      var a = byName[k].a, n = byName[k].count;
      var how = a.source === 'upload' ? 'uploaded' : 'emailed';
      var meta = [a.at ? how + ' ' + shortWhen(a.at, now) : how];
      if (n > 1) meta.push(n + ' versions');
      if (a.pages) meta.push(plural(a.pages, 'page'));
      live.push({ key: 'att:' + k, kind: 'attachment', icon: attIcon(a), name: attName(a), meta: meta.join(DOT),
        pill: { cls: 'info', words: a.source === 'upload' ? 'Uploaded document' : 'Email attachment' }, faded: false, open: null });
    });

    var media = arr(detail && detail.media).filter(function (mm) {
      return mm && lower(mm.phase) !== 'receipt' && lower(mm.type) !== 'video' && !/\.(mp4|mov|m4v|webm|avi)(\?|$)/i.test(str(mm.storage_url));
    });
    var count = media.length || (fx && isFinite(num(fx.media_count)) ? num(fx.media_count) : 0);
    if (count > 0) {
      var firstAt = media.map(function (mm) { return toMs(mm.taken_at || mm.created_at); }).filter(isFinite).sort(function (a, b) { return a - b; })[0];
      live.push({ key: 'photos', kind: 'photos', icon: { cls: 'img', label: String(count) }, name: 'Site photos',
        meta: plural(count, 'photo') + (firstAt ? DOT + 'from ' + shortDate(firstAt, now) : ''), pill: { cls: 'info', words: 'Photos' },
        faded: false, open: { type: 'photos' } });
    }
    return live.concat(faded);
  }

  // ── Timeline ──

  var QUOTE_RE = /^Quote\s+(?:(Q-[\w-]+)\s+)?v(\d+)\s+(sent|viewed|superseded|accepted|declined)\b/i;
  var QUOTE_APP_RE = /^App recorded quote\s+(?:(Q-[\w-]+)\s+)?v(\d+)\s+sent/i;
  var STATUS_INTO_RE = /status set to ([a-z _]+?)(?:\s*\(from\b|\.|$)/i;
  var MILESTONE_STATUS = ['accepted', 'scheduled', 'in progress', 'in_progress', 'complete', 'completed'];
  var STATE_WORDS = { draft: 'Draft in Xero (a draft cannot be paid)', voided: 'Voided or deleted in Xero', deleted: 'Deleted in Xero',
    paid: 'Paid (Xero)', delivered: 'Delivered', failed: 'Did not send', accepted: 'Accepted', superseded: 'Replaced by a later version' };

  // "Draft invoice INV-9002 · $3,571.43, draft in Xero" from the story's longer sentence.
  function invoiceTitle(r) {
    var m = /\b(INV-[\w-]+)/.exec(r.what);
    var name = m ? m[1] : 'invoice';
    var amt = isFinite(r.amount) ? DOT + money(r.amount) : '';
    if (r.state === 'draft') return 'Draft invoice ' + name + amt + ', draft in Xero';
    if (r.state === 'voided' || r.state === 'deleted') return 'Invoice ' + name + (/deleted/i.test(r.what) ? ' deleted' : ' voided') + ' in Xero';
    if (r.state === 'paid') return 'Invoice ' + name + ' paid (Xero)' + amt;
    if (r.state) return 'Invoice ' + name + ' approved in Xero' + amt;
    return cut(r.what, 84);
  }
  function quoteLabel(num0, ver) { return 'Quote ' + (num0 ? num0 + ' ' : '') + 'v' + ver; }
  function findQuote(quotes, numb, ver) {
    return arr(quotes).filter(function (q) { return q && q.version === ver && (!numb || !q.number || q.number === numb); })[0] || null;
  }

  // The story timeline plus its dated events, oldest first, with the noise folded away:
  // document reads hidden, each quote version as one "sent" milestone (views as a count),
  // acceptance on its own, delivered system emails folded into their quote, the job record's
  // own acceptance stamp dropped, drafts as warnings, and a closing "now" node.
  function timeline(story, opts) {
    opts = opts || {};
    var now = opts.now;
    var rows = [];
    arr(story && story.timeline).forEach(function (t, i) {
      if (!t) return;
      // Xero invoice/payment facts carry calendar dates, not an observed time.
      var raw = lower(t.source_table) === 'xero_invoices' && /^\d{4}-\d{2}-\d{2}$/.test(str(t.date)) ? t.date : (t.at || t.date);
      var ms = toMs(raw);
      if (!isFinite(ms)) return;
      rows.push({ i: i, ms: ms, raw: raw, kind: lower(t.kind), what: clean(t.what), state: lower(t.state), amount: num(t.amount), src: lower(t.source_table), sid: str(t.source_id) });
    });
    arr(story && story.events).forEach(function (e, i) {
      if (!e) return;
      var ms = toMs(e.at);
      if (!isFinite(ms)) return;
      rows.push({ i: 100000 + i, ms: ms, raw: e.at, kind: 'event', what: clean(e.what), state: '', amount: NaN, src: 'ledger', sid: str(e.key || '') });
    });
    rows.sort(function (a, b) { return (a.ms - b.ms) || (a.i - b.i); });

    var out = [], qms = {}, accepted = [];
    function add(r, extra) {
      var p = pt(r.raw);
      var it = {
        key: r.kind + ':' + (r.sid || r.i) + ':' + hash(r.what), at: r.raw, ms: r.ms, dateOnly: p ? p.dateOnly : false,
        title: cut(r.what, 84), sub: SRC_WORDS[r.src] || 'Record', from: FROM_WORDS[r.src] || 'the records', cls: '',
        amount: isFinite(r.amount) ? r.amount : null, text: r.what, state: r.state, lines: null
      };
      for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) it[k] = extra[k]; }
      out.push(it);
      return it;
    }
    rows.forEach(function (r) {
      if (r.kind === 'document') return;
      if (r.kind === 'quote') {
        var m = QUOTE_RE.exec(r.what), app = QUOTE_APP_RE.exec(r.what);
        var numb = m ? m[1] : (app ? app[1] : null), ver = m ? +m[2] : (app ? +app[2] : null);
        var verb = m ? lower(m[3]) : (app ? 'sent' : '');
        if (ver != null) {
          var qk = (numb || '') + ' v' + ver, label = quoteLabel(numb, ver);
          if (verb === 'sent') {
            if (!qms[qk]) qms[qk] = add(r, { key: 'quote:' + qk + ':sent', title: label + ' sent', sub: 'Quoting app', from: 'the quoting app', cls: 'ms', quote: { numb: numb, ver: ver }, text: label + ' sent to the customer.' });
            if (isFinite(r.amount) && qms[qk].amount == null) qms[qk].amount = r.amount;
            return;
          }
          if (verb === 'viewed' && qms[qk]) { if (!qms[qk].firstViewed) qms[qk].firstViewed = r.raw; return; }
          if (verb === 'superseded' && qms[qk]) { qms[qk].replaced = r.raw; return; }
          if (verb === 'accepted') {
            accepted.push(r.ms);
            add(r, { key: 'quote:' + qk + ':accepted', title: label + ' accepted', sub: 'Quoting app', from: 'the quoting app', cls: 'ms' });
            return;
          }
          if (verb === 'declined') { add(r, { key: 'quote:' + qk + ':declined', title: label + ' declined', sub: 'Quoting app', from: 'the quoting app', cls: 'wn' }); return; }
        }
        add(r, {});
        return;
      }
      if (r.kind === 'system_email') {
        if (r.state === 'failed' || r.state === 'bounced' || r.state === 'error') { add(r, { cls: 'wn', title: 'A system email did not send' }); return; }
        if (/\(quote,/i.test(r.what)) {
          for (var k = out.length - 1; k >= 0; k--) {
            if (r.ms - out[k].ms > 15 * 60000) break;
            if (out[k].quote && out[k].cls === 'ms' && /sent$/.test(out[k].title)) { out[k].emailed = true; return; }
          }
        }
        add(r, { cls: 'mu' });
        return;
      }
      if (r.kind === 'status') {
        if (/^job record stamp/i.test(r.what) && accepted.some(function (a) { return Math.abs(a - r.ms) < 60000; })) return;
        var into = STATUS_INTO_RE.exec(r.what);
        add(r, { cls: into && MILESTONE_STATUS.indexOf(lower(into[1])) >= 0 ? 'ms' : '' });
        return;
      }
      if (r.kind === 'invoice') {
        var st = r.state;
        add(r, { cls: st === 'draft' ? 'wn' : (st === 'voided' || st === 'deleted') ? 'mu' : (st ? 'ms' : ''), title: invoiceTitle(r) });
        return;
      }
      if (r.kind === 'first_contact' || r.kind === 'site_visit') { add(r, { cls: 'ms' }); return; }
      if (r.kind === 'event') { add(r, { sub: 'AI notes, true as at ' + longDate(r.raw, now), title: cut(firstSentence(r.what), 90) }); return; }
      add(r, {});
    });

    Object.keys(qms).forEach(function (qk) {
      var it = qms[qk];
      var q = findQuote(opts.quotes, it.quote.numb, it.quote.ver);
      if (it.amount == null && q && q.value != null) it.amount = q.value;
      if (it.amount != null) it.title += DOT + money(it.amount);
      var views = q && q.views != null ? q.views : null;
      var subs = ['Quoting app'];
      if (views != null) subs.push(views === 0 ? 'not opened yet' : 'opened ' + times(views));
      else if (it.firstViewed) subs.push('opened ' + (perthDayKey(it.firstViewed) === perthDayKey(it.ms) ? timeWords(it.firstViewed) : shortWhen(it.firstViewed, now)));
      it.sub = subs.join(DOT);
      var lines = [];
      if (it.emailed) lines.push('Emailed to the customer and delivered.');
      if (it.firstViewed) lines.push('First opened ' + stamp(it.firstViewed, now) + '.');
      if (views != null) lines.push(views === 0 ? 'Not opened yet.' : 'Opened ' + times(views) + ' in all.');
      if (it.replaced) lines.push('Replaced ' + longDate(it.replaced, now) + '.');
      it.lines = lines;
    });

    out.forEach(function (it) {
      var lines = [it.text];
      if (it.lines) lines = lines.concat(it.lines);
      lines.push(it.dateOnly ? 'On ' + stamp(it.at, now) + '.' : 'At ' + stamp(it.at, now) + ', Perth time.');
      lines.push('From ' + it.from + '.');
      if (it.amount != null && !it.quote && it.text.indexOf(money(it.amount)) < 0) lines.push('Amount: ' + money(it.amount) + '.');
      if (it.state && STATE_WORDS[it.state] && !it.quote) lines.push('State: ' + STATE_WORDS[it.state] + '.');
      it.detail = lines;
    });

    var nw = obj(story && story.now);
    if (nw) {
      var phase = lower(nw.phase);
      var wm = whoseMove(nw.whose_move, opts.job, story);
      out.push({
        key: 'now', now: true, cls: 'now', at: null, ms: Infinity,
        title: PHASE_WORDS[phase] || (phase ? cap(phase.replace(/_/g, ' ')) : 'Where it is now'),
        sub: [nw.phase_since ? 'since ' + longDate(nw.phase_since, now) : '', wm ? wm.words : ''].filter(Boolean).join(DOT),
        detail: [clean(nw.line) || 'This is where the job is now.']
      });
    }
    return out;
  }

  // A plain timeline from the job record, for when job_overview is not there.
  function recordTimeline(detail, opts) {
    opts = opts || {};
    var now = opts.now;
    var job = (detail && detail.job) || {};
    var out = [];
    function add(at, title, cls, sub, extra) {
      var p = pt(at);
      if (!p) return;
      out.push({ key: 'rec:' + hash(title + ':' + p.ms), at: at, ms: p.ms, dateOnly: p.dateOnly, title: title, cls: cls || '', sub: sub || 'Job record',
        detail: [title + '.'].concat(extra || []).concat([(p.dateOnly ? 'On ' : 'At ') + stamp(at, now) + ' Perth time.', 'From: ' + (sub || 'Job record') + '.']) });
    }
    add(job.created_at, 'Job created', '', 'Job record');
    add(job.quoted_at, 'First quote sent', 'ms', 'Job record');
    var docAccepted = [];
    arr(detail && detail.documents).filter(function (d) { return d && (d.type === 'quote' || d.type === 'permit_quote'); }).forEach(function (d) {
      var label = quoteLabel(clean(d.quote_number), d.version || 1);
      add(d.created_at, label + ' made', '', 'Quoting app');
      if (d.accepted_at) { docAccepted.push(toMs(d.accepted_at)); add(d.accepted_at, label + ' accepted', 'ms', 'Quoting app'); }
    });
    var acc = toMs(job.accepted_at);
    if (isFinite(acc) && !docAccepted.some(function (a) { return Math.abs(a - acc) < 60000; })) add(job.accepted_at, 'Quote accepted', 'ms', 'Job record');
    add(job.scheduled_at, 'Scheduled', 'ms', 'Job record');
    add(job.completed_at, 'Work complete', 'ms', 'Job record');
    invoices(detail, null).forEach(function (i) {
      if (i.byName) return;
      var when0 = i.invoiceDate || i.createdAt;
      var name = 'Invoice ' + (i.number || '(no number)');
      if (i.status === 'DRAFT') add(when0, 'Draft invoice ' + (i.number || '') + ', ' + money(i.total) + ', draft in Xero', 'wn', 'Xero', ['A draft cannot be paid.']);
      else if (i.status === 'VOIDED' || i.status === 'DELETED') add(when0, name + ' ' + (i.status === 'DELETED' ? 'deleted' : 'voided') + ' in Xero', 'mu', 'Xero');
      else {
        add(when0, name + ' issued, ' + money(i.total), 'ms', 'Xero');
        if (i.status === 'PAID' && i.paidOn) add(i.paidOn, name + ' paid', 'ms', 'Xero');
      }
    });
    out.sort(function (a, b) { return a.ms - b.ms; });
    out.push({ key: 'now', now: true, cls: 'now', at: null, ms: Infinity, title: opts.statusLabel || humanStatus(job.status) || 'Where it is now',
      sub: 'Job status', detail: ['The job record says: ' + (opts.statusLabel || humanStatus(job.status) || 'no status') + '.'] });
    return out;
  }

  // ── Conversation ──

  function normMessage(m, i) {
    m = obj(m) || {};
    var et = lower(m.event_type || '');
    var kind = lower(m.kind || '');
    var ch = lower(m.channel || '');
    if (kind === 'call' || kind === 'transcript' || /call_logged|transcript|\bcall\b/.test(et)) ch = 'call';
    if (!ch) {
      if (/sms|reply|text/.test(et)) ch = 'sms';
      else if (/email/.test(et)) ch = 'email';
    }
    var dir = lower(m.direction || '');
    if (dir === 'in') dir = 'inbound';
    if (dir === 'out') dir = 'outbound';
    if (!dir) {
      if (/reply|_in$|inbound/.test(et)) dir = 'inbound';
      else if (/_out$|sent|outbound/.test(et)) dir = 'outbound';
    }
    var at = m.at || m.event_at || m.occurred_at || m.created_at || null;
    var secs = firstNum(m.call_seconds, m.duration_seconds, m.duration);
    var raw = str(m.text || m.body || m.message || '');
    var text = ch === 'call' ? '' : clean(raw);
    return {
      id: m.id != null ? str(m.id) : (m.event_id != null ? str(m.event_id) : (m.business_event_id != null ? str(m.business_event_id) : null)),
      i: i, at: at, ms: toMs(at), channel: ch, direction: dir,
      who: clean(m.who || m.sender_name || m.from_name || ''),
      // A call never shows words: no raw transcript, ever.
      text: text,
      // Only an emoji or symbol, which the screen never prints.
      noWords: ch !== 'call' && !text && !!raw.trim(),
      kind: kind, eventType: et, secs: secs,
      transcript: kind === 'transcript' || /transcript/.test(et),
      held: heldFlag(m),
      pending: m.pending === true
    };
  }
  // A message whose job is not certain may belong to another job. It is marked wherever it shows
  // and never feeds the last word.
  function heldFlag(m) {
    return !!(m && (m.job_certain === false || m.held === true || m.unplaced === true || lower(m.certainty) === 'job_not_certain'));
  }
  function bareId(v) { return str(v).replace(/^[a-z]+:/i, ''); }
  // The card's held list names rows by id; the same text can reach messages[] as another copy
  // (the CRM cache), so a held row is also matched on its exact time, channel and direction.
  function heldIndex(story) {
    var held = obj(story && story.held_messages);
    var idx = { ids: {}, at: {} };
    arr(held && held.items).forEach(function (x) {
      if (!obj(x)) return;
      if (x.id != null) idx.ids[bareId(x.id)] = true;
      var n = normMessage(x, 0);
      if (isFinite(n.ms)) idx.at[n.ms + '|' + n.channel + '|' + n.direction] = true;
    });
    return idx;
  }
  function isHeld(x, idx) {
    if (!obj(x)) return false;
    if (heldFlag(x)) return true;
    if (!idx) return false;
    if (x.id != null && idx.ids[bareId(x.id)]) return true;
    var n = normMessage(x, 0);
    return isFinite(n.ms) && !!idx.at[n.ms + '|' + n.channel + '|' + n.direction];
  }
  function customerExchange(story, list) {
    var le = obj(story && story.last_exchange);
    var idx = heldIndex(story);
    var known = arr(list).filter(function (x) {
      if (!x || isHeld(x, idx)) return false;
      if (x.customer_party === false || lower(x.audience) === 'other_party' || lower(x.party) === 'other') return false;
      var role = lower(x.counterpart_role);
      if (role && role !== 'customer' && role !== 'client') return false;
      return x.customer_party === true || role === 'customer' || role === 'client' ||
        lower(x.audience) === 'customer' || (lower(x.direction) === 'inbound' && lower(x.party) === 'customer');
    }).map(normMessage).filter(function (n) { return n.text && (n.channel === 'sms' || n.channel === 'email'); });
    known.sort(function (a, b) { return a.ms - b.ms; });
    function newest(dir, beforeMs) {
      return known.filter(function (n) { return n.direction === dir && (!isFinite(beforeMs) || n.ms <= beforeMs); }).slice(-1)[0] || null;
    }
    function words(x, dir) {
      if (!obj(x) || isHeld(x, idx)) return null;
      var n = normMessage(x, 0);
      if (x.text_withheld === 'call_transcript' || n.channel === 'call') {
        return { text: 'Call on record. Transcript words are not shown.', at: n.at };
      }
      if (n.text) return n;
      if (!n.noWords) return null;
      // An emoji-only reply: show the last words before it, and say the reply had none.
      var prior = newest(dir, n.ms);
      if (prior) { prior = Object.assign({}, prior); prior.thenNoWordsAt = n.at; return prior; }
      return { text: '', noWords: true, at: n.at };
    }
    // Null entries in the canonical exchange are meaningful. Do not replace them
    // with a more recent supplier message, or with unplaced contact history.
    if (le) return { customer: words(le.customer_said, 'inbound'), us: words(le.we_told_customer, 'outbound') };
    return { customer: newest('inbound'), us: newest('outbound') };
  }
  function isMachine(n) {
    if (MACHINE_TYPES.indexOf(n.eventType) >= 0 || MACHINE_TYPES.indexOf(n.kind) >= 0) return true;
    if (n.channel === 'call') return false;
    return !n.text;
  }
  // One row per call: a call log and its transcript row merge, keeping the duration. Two copies
  // of one message (the business record and the CRM copy, same time to the second) are one row.
  function mergeCalls(list) {
    var out = [];
    list.forEach(function (n) {
      for (var j = out.length - 1; j >= 0 && n.ms - out[j].ms < 1000; j--) {
        var t = out[j];
        if (t.channel === n.channel && t.direction === n.direction && (n.channel === 'call' || t.text === n.text)) {
          if (n.secs != null && (t.secs == null || n.secs > t.secs)) t.secs = n.secs;
          if (!t.id) t.id = n.id;
          if (n.id) t.otherIds.push(n.id);
          if (n.held) t.held = true;
          return;
        }
      }
      if (n.channel === 'call') {
        for (var k = out.length - 1; k >= 0; k--) {
          var c = out[k];
          if (n.ms - c.ms > 45 * 60000) break;
          if (c.channel === 'call' && !c.merged && c.transcript !== n.transcript && (!c.direction || !n.direction || c.direction === n.direction)) {
            if (n.secs != null && (c.secs == null || n.secs > c.secs)) c.secs = n.secs;
            if (!c.direction) c.direction = n.direction;
            if (!c.id) c.id = n.id;
            if (n.id) c.otherIds.push(n.id);
            if (n.held) c.held = true;
            c.merged = true;
            return;
          }
        }
      }
      n.otherIds = [];
      out.push(n);
    });
    return out;
  }
  // Oldest first (newest at the bottom), a day line wherever the Perth day changes,
  // machine rows dropped, calls merged, then the filter: all, sms, call or email.
  // Held rows (job not certain) stay in place but carry held: true for their own mark.
  function conversation(list, filter, now, story) {
    var f = lower(filter) || 'all';
    var idx = heldIndex(story);
    var msgs = arr(list).map(function (x, i) {
      var n = normMessage(x, i);
      n.held = isHeld(x, idx);
      return n;
    }).filter(function (n) { return isFinite(n.ms) && !isMachine(n); });
    msgs.sort(function (a, b) { return (a.ms - b.ms) || (a.i - b.i); });
    msgs = mergeCalls(msgs);
    var counts = { sms: 0, call: 0, email: 0, other: 0, held: 0 };
    var ids = {};
    msgs.forEach(function (n) {
      counts[counts[n.channel] != null ? n.channel : 'other']++;
      if (n.held) counts.held++;
      if (n.id) ids[n.id] = true;
      n.otherIds.forEach(function (x) { ids[x] = true; });
    });
    var shown = msgs.filter(function (n) { return f === 'all' || n.channel === f; });
    var items = [], last = '';
    shown.forEach(function (n) {
      var d = perthDayKey(n.ms);
      if (d !== last) { items.push({ type: 'day', label: dayLabel(n.ms, now), key: d }); last = d; }
      items.push({ type: 'msg', m: n });
    });
    return { items: items, total: msgs.length, shown: shown.length, counts: counts, ids: ids };
  }
  // The card's held list carries a call twice (its call log and its transcript row): one row per
  // call, keeping a producer summary and the logged duration. The total drops by the same count.
  function heldList(held) {
    held = obj(held) || {};
    var out = [], dupes = 0;
    arr(held.items).filter(function (x) { return obj(x); }).forEach(function (x) {
      var n = normMessage(x, 0);
      var call = n.channel === 'call' || /call|transcript/.test(lower(x.kind) + ' ' + lower(x.channel));
      var kinds = lower(x.kind) + ' ' + lower(x.event_type);
      var log = /call_logged/.test(kinds);
      var secs = log ? firstNum(x.call_seconds, (/Duration:\s*(\d+)\s*sec/i.exec(str(x.text)) || [])[1]) : firstNum(x.call_seconds);
      var row = { x: x, call: call, ms: n.ms, dir: n.direction, transcript: /transcript/.test(kinds), secs: secs, summary: call ? clean(x.summary) : '' };
      if (call && isFinite(n.ms)) {
        var twin = out.filter(function (r) {
          return r.call && !r.pair && r.transcript !== row.transcript && Math.abs(r.ms - row.ms) < 60000 && (!r.dir || !row.dir || r.dir === row.dir);
        })[0];
        if (twin) {
          twin.pair = true;
          if (row.secs != null && twin.secs == null) twin.secs = row.secs;
          if (!twin.summary && row.summary) twin.summary = row.summary;
          if (row.x.cut) twin.cut = true;
          dupes++;
          return;
        }
      }
      out.push(row);
    });
    var total = Math.max(out.length, (Number(held.count) || 0) - dupes);
    return { items: out, count: total };
  }
  function callWords(secs) {
    var s = num(secs);
    if (!isFinite(s) || s <= 0) return 'no duration recorded';
    s = Math.round(s);
    if (s < 60) return plural(s, 'second');
    var mins = Math.floor(s / 60), rest = s % 60;
    if (mins < 60) return mins + ' min' + (rest ? ' ' + rest + ' sec' : '');
    return Math.floor(mins / 60) + ' hr ' + (mins % 60) + ' min';
  }

  // Texts, emails and calls from job_detail's newest records, for when job_overview is not there.
  var RECORD_MSG = {
    'client.reply': { channel: 'sms', direction: 'inbound' },
    'client.sms_in': { channel: 'sms', direction: 'inbound' },
    'client.sms_out': { channel: 'sms', direction: 'outbound' },
    'client.email_in': { channel: 'email', direction: 'inbound' },
    'client.email_out': { channel: 'email', direction: 'outbound' },
    'client.call_logged': { channel: 'call' },
    'call.transcript_completed': { channel: 'call', kind: 'transcript' }
  };
  function messagesFromDetail(detail) {
    return arr(detail && detail.business_events).map(function (r) {
      var t = lower(r && r.event_type), spec = RECORD_MSG[t];
      if (!spec) return null;
      var p = parseJson(r.payload) || {};
      var text = '';
      if (spec.channel === 'sms') text = p.message_text || p.text || p.body || p.message || '';
      if (spec.channel === 'email') {
        var body = str(p.text || p.message_text || p.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        text = (p.subject ? 'Subject: ' + p.subject + (body ? '\n' : '') : '') + body;
      }
      return {
        id: r.id, at: r.event_at || r.occurred_at, channel: spec.channel, direction: spec.direction || lower(p.direction),
        kind: spec.kind || '', event_type: t, text: cut(clean(text), 400),
        call_seconds: spec.channel === 'call' ? firstNum(p.duration_seconds) : null
      };
    }).filter(Boolean);
  }

  return {
    DOT: DOT, PHASE_WORDS: PHASE_WORDS, MACHINE_TYPES: MACHINE_TYPES,
    str: str, lower: lower, num: num, arr: arr, obj: obj, plural: plural, times: times, hash: hash,
    toMs: toMs, pt: pt, dayLabel: dayLabel, timeWords: timeWords, when: when, stamp: stamp,
    shortWhen: shortWhen, shortDate: shortDate, longDate: longDate, perthDayKey: perthDayKey,
    clean: clean, cut: cut, firstSentence: firstSentence, headlineFrom: headlineFrom, firstName: firstName, money: money,
    humanStatus: humanStatus, hasBanned: hasBanned, flagOn: flagOn, isNotDeployed: isNotDeployed,
    storyText: storyText, paragraphs: paragraphs, rewriteWords: rewriteWords, rewriteAccepted: rewriteAccepted, sourceFailures: sourceFailures,
    customerName: customerName, whoseMove: whoseMove, openItems: openItems, ledgerWords: ledgerWords,
    invoices: invoices, moneySummary: moneySummary, valueAuthority: valueAuthority, futureMoney: futureMoney, quoteRows: quoteRows, quotedValue: quotedValue, files: files,
    timeline: timeline, recordTimeline: recordTimeline, conversation: conversation, heldList: heldList,
    callWords: callWords, messagesFromDetail: messagesFromDetail, customerExchange: customerExchange
  };
})();
// </job-overview-v2-core>

// ── The screen ──
// Lives inside #jdOverview. renderOverviewView (ops.html) calls render(data) first and falls
// back to the classic Overview when it returns false.
var JobOverviewV2 = (function () {
  'use strict';
  var C = JobOverviewV2Core;
  var DOT = C.DOT;
  var CACHE_MS = 3 * 60 * 1000;   // a re-render inside this window reuses the last read
  var TIMEOUT_MS = 60 * 1000;     // job_overview is abandoned after a minute
  var FLAG_KEY = 'sw_overview_v2';
  var FILTER_KEY = 'sw_ov2_conv_filter';
  var TRADE_ROLES = ['installer', 'lead_installer', 'crew', 'trade', 'subcontractor'];
  var cache = {};      // job id -> { status: ok | notdeployed | error, data, at, error, promise }
  var uiState = {};    // job id -> what the viewer opened, typed or asked, kept across re-renders
  var override = null; // the toggle's choice for this page, in case browser storage is blocked
  var memFilter = 'all';

  function g(name) { try { return window[name]; } catch (e) { return undefined; } }
  function fn(name) { var f = g(name); return typeof f === 'function' ? f : null; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"'`]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;', '`': '&#96;' }[c];
    });
  }
  function safeUrl(u) { var s = String(u || '').trim(); return /^(https?:|mailto:|tel:)/i.test(s) ? s : ''; }
  function toast(msg, type) { var t = fn('showToast'); if (t) { try { t(esc(msg), type || 'info'); } catch (e) { /* no toast */ } } }
  function readStore(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function writeStore(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function logErr(what, e) { try { console.error('[JobOverviewV2] ' + what, e); } catch (x) { /* nothing */ } }

  function isOn() {
    if (override !== null) return override;
    var search = '';
    try { search = window.location.search || ''; } catch (e) { /* none */ }
    return C.flagOn(search, readStore(FLAG_KEY));
  }
  function getFilter() {
    var f = readStore(FILTER_KEY) || memFilter;
    return ['all', 'sms', 'call', 'email'].indexOf(f) >= 0 ? f : 'all';
  }
  function setFilter(f) { memFilter = f; writeStore(FILTER_KEY, f); }
  function ui(k) {
    k = String(k || '');
    if (!uiState[k]) {
      uiState[k] = { tlOpen: {}, itemOpen: {}, tlAll: false, draft: '', asked: null, sent: [], files: {},
        convAtBottom: true, convTop: 0, tlAtBottom: true, tlTop: 0, sending: false, sendErr: '' };
    }
    return uiState[k];
  }

  // ── Links built the way the rest of ops.html builds them ──
  function ghlUrl(j) {
    var loc = g('GHL_LOCATION_ID');
    if (!loc) return '';
    if (j.ghl_opportunity_id) return 'https://app.maxlead.com.au/v2/location/' + encodeURIComponent(loc) + '/opportunities/' + encodeURIComponent(j.ghl_opportunity_id);
    if (j.ghl_contact_id) return 'https://app.maxlead.com.au/v2/location/' + encodeURIComponent(loc) + '/contacts/' + encodeURIComponent(j.ghl_contact_id);
    return '';
  }
  function mapsUrl(j) {
    var a = String(j.site_address || '').trim(), s = String(j.site_suburb || '').trim();
    if (s && a.toLowerCase().indexOf(s.toLowerCase()) < 0) a += ', ' + s;
    return 'https://maps.google.com/?q=' + encodeURIComponent(a);
  }
  function mailtoUrl(email) { return 'mailto:' + encodeURIComponent(String(email || '').trim()).replace(/%40/g, '@'); }
  function telUrl(phone) { return 'tel:' + String(phone || '').replace(/[^\d+]/g, ''); }
  function xeroUrl(id) { return 'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=' + encodeURIComponent(id); }
  function scopeUrl(j) {
    var f = fn('scopeToolUrlFor');
    var base = f ? f(j.type) : (j.type === 'fencing' ? 'https://marninms98-dotcom.github.io/fence-designer/' : 'https://marninms98-dotcom.github.io/patio/');
    return base + '?jobId=' + encodeURIComponent(j.id);
  }
  function quoteUrl(doc) {
    if (!doc) return '';
    var open = fn('getDocOpenUrl');
    var u = open ? open(doc) : '';
    if (u) return u;
    if (doc.share_token && g('SUPABASE_URL')) return g('SUPABASE_URL') + '/functions/v1/send-quote/view?token=' + encodeURIComponent(doc.share_token);
    return '';
  }

  // ── Data for one paint ──
  function model(detail) {
    var job = detail.job || {};
    var k = String(job.id || '');
    var e = cache[k] || null;
    var ov = e && e.data && typeof e.data === 'object' ? e.data : null;
    var story = ov && C.obj(ov.story) ? ov.story : null;
    var now = Date.now();
    var u = ui(k);
    var m = { detail: detail, job: job, k: k, entry: e, ov: ov, story: story, now: now, u: u, filter: getFilter(),
      state: !e ? 'loading' : (ov ? 'ok' : e.status) };
    m.first = C.firstName(C.customerName(job, story)) || 'the customer';
    m.money = C.moneySummary(detail, ov);
    m.valueAuthority = C.valueAuthority(detail, ov);
    m.futureMoney = C.futureMoney(story);
    m.quoted = C.quotedValue(detail, ov);
    m.text = C.storyText(ov && ov.story_text);
    m.failures = C.sourceFailures(ov);
    m.refreshFailed = !!(e && e.refreshFailed);
    m.wm = story && C.obj(story.now) ? C.whoseMove(story.now.whose_move, job, story) : null;
    m.items = C.openItems(story, job, ov && ov.notes, now);
    var labels = g('STATUS_LABELS') || {};
    if (story && (C.arr(story.timeline).length || C.arr(story.events).length || C.obj(story.now))) {
      m.timeline = C.timeline(story, { now: now, quotes: C.quoteRows(detail, ov), job: job });
      m.tlSource = 'story';
    } else {
      m.timeline = C.recordTimeline(detail, { now: now, statusLabel: labels[job.status] || '' });
      m.tlSource = 'record';
    }
    var msgs = ov && Array.isArray(ov.messages) ? ov.messages : null;
    m.convSource = msgs ? 'story' : 'record';
    var list = (msgs || C.messagesFromDetail(detail)).slice();
    // Texts sent from this box show at once, until the record catches up.
    u.sent = u.sent.filter(function (s) {
      return !list.some(function (x) {
        var t = C.toMs(x && (x.at || x.event_at || x.occurred_at));
        return x && C.clean(x.text) === C.clean(s.text) && isFinite(t) && Math.abs(t - s.ms) < 30 * 60000;
      });
    });
    u.sent.forEach(function (s) { list.push({ at: new Date(s.ms).toISOString(), channel: 'sms', direction: 'outbound', who: 'You', text: s.text, pending: true }); });
    m.conv = C.conversation(list, m.filter, now, story);
    var exchange = C.customerExchange(story, list);
    m.lastCustomer = exchange.customer;
    m.lastUs = exchange.us;
    m.files = C.files(detail, ov, now).map(function (f) { return decorateFile(f, m); });
    u.files = {};
    m.files.forEach(function (f) { u.files[f.key] = f; });
    return m;
  }
  function decorateFile(f, m) {
    if (!f.open) return f;
    if (f.open.type === 'quote') f.href = quoteUrl(f.open.doc);
    else if (f.open.type === 'scope') f.href = scopeUrl(m.job);
    else if (f.open.type === 'photos') f.act = true;
    else if (f.open.type === 'invoice') {
      var i = f.open.inv;
      f.act = true;
      if (i.xeroId) f.link = { href: xeroUrl(i.xeroId), words: 'Open in Xero' };
      var rows = C.arr(m.detail.invoices);
      var row = rows.filter(function (r) { return r && ((i.xeroId && r.xero_invoice_id === i.xeroId) || (i.id && String(r.id) === i.id)); })[0] ||
        rows.filter(function (r) { return r && i.number && r.invoice_number === i.number; })[0];
      f.previewRow = row || { invoice_number: i.number || null, contact_name: m.job.client_name || '', reference: i.reference, status: i.status,
        due_date: i.dueDate, amount_due: i.due, amount_paid: i.paid, total: i.total, xero_invoice_id: i.xeroId, invoice_type: 'ACCREC' };
    }
    return f;
  }

  // ── HTML ──
  function pageHtml(m) {
    return '<div class="ov2" id="ov2Root" data-job="' + esc(m.k) + '">' +
      (api.isStaffViewer() ? '<div class="ov2-switch"><button type="button" class="ov2-linkbtn" id="ov2Toggle" data-ov2-act="classic">Back to classic</button></div>' : '') +
      readNoticeHtml(m) + custHtml(m) + filesHtml(m) + workOrderMountHtml() +
      '<div class="ov2-cols">' + timelineHtml(m) + storyHtml(m) +
      '<section class="ov2-card ov2-col ov2-convcol" id="ov2ConvCol" aria-label="Conversation"><div id="ov2ConvBody">' + convBodyHtml(m) + '</div>' + composeHtml(m) + '</section>' +
      '</div></div>';
  }

  function readNoticeHtml(m) {
    var lines = [];
    if (m.refreshFailed) lines.push('Refresh failed. Showing the previous read.');
    if (m.failures.length) lines.push('Could not read: ' + m.failures.join(', ') + '. The sections below may show only the job record.');
    return lines.length ? '<div class="ov2-state" id="ov2ReadNotice" role="status">' + esc(lines.join(' ')) +
      ' <button type="button" class="ov2-linkbtn" data-ov2-act="retry">Try again</button></div>' : '';
  }
  function custHtml(m) {
    var j = m.job;
    var name = C.clean(j.client_name) || 'Unknown client';
    var addr = C.clean(String(j.site_address || '').replace(/,\s*Australia\s*$/i, ''));
    var line = [addr, C.clean(j.client_phone), C.clean(j.client_email)].filter(Boolean).join(DOT);
    var note = whoNote(m);
    return '<section class="ov2-card ov2-cust" id="ov2Cust" aria-label="Customer"><div class="ov2-cust-main">' +
      '<div class="ov2-lbl">Customer</div>' +
      '<div class="ov2-name" id="jdClientNameRow"><span class="ov2-name-t">' + esc(name) + '</span>' +
      '<button type="button" class="ov2-edit" data-ov2-act="edit-name" aria-label="Edit the customer name">Edit</button></div>' +
      (line ? '<div class="ov2-addr">' + esc(line) + '</div>' : '') +
      (note ? '<div class="ov2-note">' + esc(note) + '</div>' : '') +
      '<div class="ov2-acts">' + actionsHtml(m) + '</div></div>' + moneyHtml(m) + '</section>';
  }
  function whoNote(m) {
    var who = m.story ? C.arr(m.story.who) : [];
    var other = who.filter(function (w) { return w && C.lower(w.role) === 'third_party'; }).map(function (w) { return C.clean(w.name); }).filter(Boolean);
    var ours = who.filter(function (w) { return w && C.lower(w.role) === 'us'; }).map(function (w) { return C.clean(w.name); }).filter(Boolean);
    var parts = [];
    if (other.length) parts.push('Also involved: ' + other.join(', '));
    if (ours.length) parts.push('Ours: ' + ours.join(', '));
    return parts.join(DOT);
  }
  function callHtml(m, cls) {
    var phone = String(m.job.client_phone || '').trim();
    if (!phone) return '';
    if (g('_isMobile')) return '<a class="ov2-btn' + (cls || '') + '" href="' + esc(telUrl(phone)) + '" data-ov2-act="call-tel">Call</a>';
    return '<button type="button" class="ov2-btn' + (cls || '') + '" data-ov2-act="call">Call</button>';
  }
  function actionsHtml(m) {
    var j = m.job, h = callHtml(m, '');
    if (j.client_phone || j.ghl_contact_id) h += '<button type="button" class="ov2-btn" data-ov2-act="sms">SMS</button>';
    if (j.client_email) h += '<a class="ov2-btn" href="' + esc(mailtoUrl(j.client_email)) + '">Email</a>';
    if (j.site_address) h += '<a class="ov2-btn" href="' + esc(mapsUrl(j)) + '" target="_blank" rel="noopener">Navigate</a>';
    var ghl = ghlUrl(j);
    if (ghl) h += '<a class="ov2-btn" href="' + esc(ghl) + '" target="_blank" rel="noopener">View in GHL</a>';
    return h;
  }
  function moneyHtml(m) {
    var s = m.money, authority = m.valueAuthority;
    var h = '<div class="ov2-money"><div class="ov2-lbl">Job value</div>';
    h += '<div class="ov2-val" id="ov2Value">' + esc(authority.unconfirmed ? 'Unconfirmed' : (s.value != null ? (authority.recordOnly ? 'Not checked' : C.money(s.value)) : 'Not priced yet')) + '</div>';
    if (authority.unconfirmed || (authority.recordOnly && s.value != null)) {
      h += '<div class="ov2-value-check" id="ov2ValueCheck"><p>' + esc((s.value != null ? 'Recorded value ' + C.money(s.value) + '. ' : '') + 'Source: ' + authority.basis + '. ' + (authority.recordOnly ? 'The story card has not checked this contract value.' : 'This is not a confirmed contract value.')) + '</p>' +
        authority.checks.map(function (s) { return '<p>' + esc(s) + '</p>'; }).join('') + '</div>';
    }
    h += '<div class="ov2-mrow" id="ov2Paid">Invoiced ' + esc(C.money(s.invoiced)) + DOT + 'Paid (Xero) ' + esc(C.money(s.paid)) + DOT + 'inc GST</div>';
    if (s.drafts.length === 1) h += '<div class="ov2-mrow ov2-warnt">Draft ' + esc((s.drafts[0].number ? s.drafts[0].number + ' ' : '') + C.money(s.drafts[0].total)) + ', draft in Xero</div>';
    else if (s.drafts.length > 1) h += '<div class="ov2-mrow ov2-warnt">' + esc(s.drafts.length + ' drafts, ' + C.money(s.draftTotal) + ', draft in Xero') + '</div>';
    if (s.nameOnly) h += '<div class="ov2-mrow">' + esc(C.plural(s.nameOnly, 'Xero invoice') + ' matched by name only, not counted') + '</div>';
    if (s.splitWarning) h += '<div class="ov2-mrow ov2-warnt" id="ov2SplitWarning">' + esc(s.splitWarning) + '</div>';
    var chips = s.splits.map(function (sp) { return '<span class="ov2-chip">' + esc(sp.who + ' ' + C.money(sp.amount)) + '</span>'; }).join('');
    if (m.wm) chips += '<span class="ov2-chip' + (m.wm.key === 'us' ? ' us' : '') + '" id="ov2Whose">' + esc(m.wm.words) + '</span>';
    if (chips) h += '<div class="ov2-who">' + chips + '</div>';
    return h + '</div>';
  }

  // Office work order card. Outside the regions repaint() swaps, so a later
  // job_overview answer leaves it in place. JobWorkOrderOps.paintOverview fills it.
  function workOrderMountHtml() {
    return '<div data-job-wo-overview></div>';
  }

  function filesHtml(m) {
    var list = m.files;
    var h = '<section class="ov2-files" id="ov2Files" aria-label="Files"><div class="ov2-fhead"><span class="ov2-lbl">Files</span>' +
      '<span class="ov2-hint">' + esc(list.length ? C.plural(list.length, 'file') : '') + '</span></div>';
    if (!list.length) return h + '<div class="ov2-card ov2-empty">No quotes, invoices or files yet.</div></section>';
    return h + '<div class="ov2-strip">' + list.map(fileHtml).join('') + '</div></section>';
  }
  function fileHtml(f) {
    var inner = '<span class="ov2-ico ' + esc(f.icon.cls) + '" data-k="' + esc(f.icon.label) + '" aria-hidden="true"></span>' +
      '<span class="ov2-ftxt"><span class="ov2-fn">' + esc(f.name).replace(/_/g, '_<wbr>') + '</span>' +
      (f.meta ? '<span class="ov2-fm">' + esc(f.meta) + '</span>' : '') +
      (f.pill ? '<span class="ov2-st s-' + esc(f.pill.cls) + '">' + esc(f.pill.words) + '</span>' : '') + '</span>';
    var cls = 'ov2-card ov2-file' + (f.faded ? ' faded' : '');
    var attrs = ' data-kind="' + esc(f.kind) + '" data-ov2-file="' + esc(f.key) + '"';
    var link = f.link && safeUrl(f.link.href) ? '<a class="ov2-flink" href="' + esc(safeUrl(f.link.href)) + '" target="_blank" rel="noopener">' + esc(f.link.words) + '</a>' : '';
    var main;
    if (f.href && safeUrl(f.href)) main = '<a class="ov2-fmain" href="' + esc(safeUrl(f.href)) + '" target="_blank" rel="noopener">' + inner + '</a>';
    else if (f.act) main = '<button type="button" class="ov2-fmain" data-ov2-act="file" data-ov2-key="' + esc(f.key) + '">' + inner + '</button>';
    else main = '<div class="ov2-fmain">' + inner + '</div>';
    return '<div class="' + cls + '"' + attrs + '>' + main + link + '</div>';
  }

  function timelineHtml(m) {
    var items = m.timeline;
    var hint = m.tlSource === 'story' ? 'tap for detail' : 'from the job record';
    var h = '<section class="ov2-card ov2-col ov2-tlcol" id="ov2Timeline" aria-label="Timeline"><div class="ov2-ch"><span class="ov2-lbl">Timeline</span>' +
      '<span class="ov2-hint">' + esc(hint) + '</span></div>';
    if (!items.length) return h + '<div class="ov2-empty">Nothing on record yet.</div></section>';
    var clip = !m.u.tlAll && items.length > 8;
    h += '<ol class="ov2-tl' + (clip ? ' clip' : '') + '" id="ov2TlList">';
    items.forEach(function (it, i) {
      var open = !!m.u.tlOpen[it.key];
      var cls = [it.cls, open ? 'open' : '', clip && i < items.length - 8 ? 'old' : ''].filter(Boolean).join(' ');
      h += '<li' + (cls ? ' class="' + esc(cls) + '"' : '') + ' data-ov2-tl="' + esc(it.key) + '">' +
        '<button type="button" class="ov2-tli" data-ov2-act="tl" data-ov2-key="' + esc(it.key) + '" aria-expanded="' + open + '">' +
        '<span class="ov2-d">' + esc(it.now ? 'Now' : C.when(it.at, m.now)) + '</span>' +
        '<span class="ov2-t">' + esc(it.title) + '</span>' + (it.sub ? '<span class="ov2-s">' + esc(it.sub) + '</span>' : '') + '</button>' +
        '<div class="ov2-more">' + (it.detail || []).map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') + '</div></li>';
    });
    h += '</ol>';
    if (clip) h += '<button type="button" class="ov2-linkbtn ov2-tlall" data-ov2-act="tl-all">Show all ' + items.length + '</button>';
    return h + '</section>';
  }

  function storyHtml(m) {
    var st = m.story;
    var asOf = st ? ((C.obj(st.meta) && st.meta.built_at) || st.as_of) : null;
    var age = m.now - C.toMs(asOf);
    var built = asOf ? (age >= 0 && age < 5 * 60000 ? 'just now' : C.stamp(asOf, m.now)) : '';
    var h = '<section class="ov2-card ov2-col ov2-mid ov2-story" id="ov2Story" aria-label="The story">' +
      '<div class="ov2-ch ov2-story-head"><h2>Job story' + esc(built ? ', built ' + built : '') + '</h2>' +
      '<button type="button" class="ov2-linkbtn" data-ov2-act="refresh"' + (m.entry && m.entry.promise ? ' disabled' : '') + '>Refresh</button></div>';
    if (!st) return h + stateHtml(m) + '</section>';
    var nw = C.obj(st.now) || {};
    var sec = m.text && m.text.sections;
    var hl = C.headlineFrom(nw.line);
    var headline = (sec && sec.headline) || hl.headline || 'Where this job is at';
    h += '<div class="ov2-story-now"><div class="ov2-story-row"><h3>Where it\'s at</h3>' +
      (m.wm ? '<span class="ov2-chip' + (m.wm.key === 'us' ? ' us' : '') + '">' + esc(m.wm.words) + '</span>' : '') +
      '</div><div class="ov2-lede" id="ov2Headline">' + esc(headline) + '</div>' +
      (sec && sec.where_it_is_at ? '<p class="ov2-p">' + esc(sec.where_it_is_at) + '</p>' : (hl.rest ? '<p class="ov2-p">' + esc(hl.rest) + '</p>' : '')) + '</div>';
    h += nextHtml(m);
    h += storyMomentsHtml(m) + storyMoneyHtml(m);
    h += openItemsHtml(m, true);
    h += heldMessagesHtml(m) + lastWordHtml(m) + unknownHtml(m);
    if (sec) {
      var more = [['the_job', 'The job'], ['how_we_got_here', 'How we got here'], ['watch_out', 'Watch out']]
        .filter(function (p) { return !!sec[p[0]]; });
      if (more.length) {
        h += '<details class="ov2-story-more"><summary>More story</summary>';
        more.forEach(function (p) { h += '<h3 class="ov2-lbl ov2-h">' + p[1] + '</h3>' + C.paragraphs(sec[p[0]]).map(function (x) { return '<p class="ov2-p">' + esc(x) + '</p>'; }).join(''); });
        h += '</details>';
      }
    } else h += '<p class="ov2-none" id="ov2NoText">No written story yet. This card comes from the job records.</p>';
    h += stampHtml(m);
    return h + '</section>';
  }
  function storyMomentsHtml(m) {
    var moments = m.timeline.filter(function (it) { return it.now || it.cls === 'ms' || it.cls === 'wn'; }).slice(-4);
    if (!moments.length) return '';
    return '<div class="ov2-story-block"><h3>Key moments</h3><ol class="ov2-story-moments">' + moments.map(function (it) {
      return '<li class="' + esc(it.cls || '') + '"><span class="ov2-story-dot" aria-hidden="true"></span><span>' +
        '<small>' + esc(it.now ? 'Now' : C.when(it.at, m.now)) + '</small><strong>' + esc(it.title) + '</strong></span></li>';
    }).join('') + '</ol></div>';
  }
  function storyMoneyHtml(m) {
    var cells = [['Quoted', m.quoted], ['Invoiced', m.money.invoiced], ['Paid (Xero)', m.money.paid]];
    var h = '<div class="ov2-story-money" aria-label="Job money">' + cells.map(function (c) {
      return '<div><span>' + c[0] + '</span><strong>' + esc(c[1] == null ? 'Not recorded' : C.money(c[1])) + '</strong></div>';
    }).join('') + '</div>';
    var f = m.futureMoney;
    if (f) h += '<div class="ov2-future-money" id="ov2FutureMoney"><strong>' +
      esc(f.unconfirmed || f.amount == null ? 'Future amount unconfirmed' : C.money(f.amount) + ' not yet invoiced') + '</strong>' +
      '<p>' + esc(f.held ? 'Held, not owed now.' : 'Not an issued debt.') + '</p>' +
      (f.basis ? '<p>' + esc(f.basis) + '</p>' : '') + (f.why ? '<p>' + esc(f.why) + '</p>' : '') + '</div>';
    return h;
  }
  function lastWordHtml(m) {
    function row(label, n) {
      var words = !n ? 'No customer-specific message words on this job record.' :
        (n.text ? C.cut(n.text, 160) : 'A reply with no words (an emoji only), ' + C.stamp(n.at, m.now) + '.');
      var then = n && n.text && n.thenNoWordsAt ? '<p class="ov2-im">Then a reply with no words (an emoji only), ' + esc(C.stamp(n.thenNoWordsAt, m.now)) + '.</p>' : '';
      return '<div><span class="ov2-lbl">' + label + '</span><p>' + esc(words) + '</p>' + then + '</div>';
    }
    return '<div class="ov2-story-block ov2-story-last"><h3>Last word</h3>' + row('Customer said', m.lastCustomer) + row('We told the customer', m.lastUs) + '</div>';
  }
  function heldMessagesHtml(m) {
    var held = C.obj(m.story && m.story.held_messages);
    if (!held) return '';
    var list = C.heldList(held);
    var items = list.items, count = list.count;
    var h = '<section class="ov2-story-block ov2-held" id="ov2Held" aria-label="Messages, job not certain"><h3>Messages, job not certain</h3>' +
      '<p>These messages may belong to this job or another job. They are not settled facts or open items for this job.</p>' +
      '<p>' + esc(items.length + ' of ' + count + ' messages shown.') + '</p>';
    if (held.why) h += '<p>' + esc(C.clean(held.why)) + '</p>';
    if (!items.length) h += '<p>Message content is unavailable in this read.</p>';
    items.forEach(function (r) {
      var x = r.x, call = r.call;
      // Held calls obey the same no-transcript rule as the conversation. A safe
      // sourced summary may be supplied by the producer; raw text is never one.
      var words = call ? r.summary : C.clean(x.text);
      var meta = [x.at ? C.stamp(x.at, m.now) : 'Date not recorded', call ? 'Call' : C.clean(x.channel),
        call && r.secs != null ? C.callWords(r.secs) : '',
        C.clean(x.from), x.ours ? 'From us' : C.clean(x.from_role)].filter(Boolean).join(DOT);
      h += '<article class="ov2-held-item" data-ov2-held="' + esc(x.id || '') + '"><strong>Job not certain</strong>' +
        '<div class="ov2-im">' + esc(meta) + '</div>' +
        (x.subject ? '<p>' + esc(C.clean(x.subject)) + '</p>' : '') +
        '<p class="ov2-held-words">' + esc(words || (call ? 'Call summary unavailable. Transcript words are not shown; commitments in this call may still need review.' : 'Message words unavailable.')) + '</p>' +
        (x.held_because ? '<p>Held because ' + esc(C.clean(x.held_because)) + '.</p>' : '') +
        (C.arr(x.other_jobs).length ? '<p>Other possible jobs: ' + esc(x.other_jobs.map(C.clean).join(', ')) + '.</p>' : '') +
        (x.cut || r.cut ? '<p>Only part of this source was returned.</p>' : '') + '</article>';
    });
    return h + '</section>';
  }
  function unknownHtml(m) {
    var gaps = C.arr(m.story && m.story.not_known).map(function (x) {
      return C.clean(typeof x === 'string' ? x : (x && (x.what || x.line || x.text)));
    }).filter(Boolean);
    return '<div class="ov2-story-block ov2-story-unknown"><h3>What we don\'t know</h3>' +
      (gaps.length ? '<ul>' + gaps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p>Nothing listed in the story card.</p>') + '</div>';
  }
  function stateHtml(m) {
    var e = m.entry || {};
    var h;
    if (m.state === 'loading') {
      h = '<div class="ov2-state" id="ov2StoryState" data-state="loading"><span class="ov2-sk" style="width:85%;height:18px"></span><span class="ov2-sk" style="width:60%;height:18px"></span>' +
        '<span class="ov2-sk" style="width:100%;height:56px;margin-top:10px"></span>' +
        '<p class="ov2-wait">Reading the story, this can take up to 20 seconds.</p></div>';
    } else if (m.state === 'notdeployed') {
      h = '<div class="ov2-state" id="ov2StoryState" data-state="notdeployed"><p class="ov2-state-t">The story is not switched on yet.</p>' +
        '<p>Until the backend update is live, the timeline and conversation here come from the job record. Everything else on this page works.</p></div>';
    } else if (m.state === 'error') {
      h = '<div class="ov2-state" id="ov2StoryState" data-state="error"><p class="ov2-state-t">Story not available right now.</p>' +
        '<p>' + esc(e.error === 'timeout' ? 'It took too long to read.' : 'It could not be read.') + ' The rest of this page comes from the job record.</p>' +
        '<button type="button" class="ov2-btn" data-ov2-act="retry">Try again</button></div>';
    } else {
      h = '<div class="ov2-state" id="ov2StoryState" data-state="partial"><p class="ov2-state-t">The story could not be built for this job right now.</p>' +
        '<p>The other sections may show only the job record.</p><button type="button" class="ov2-btn" data-ov2-act="retry">Try again</button></div>';
    }
    var move = moveHtml(m);
    return h + (move ? '<div class="ov2-next ov2-quiet">' + move + '</div>' : '');
  }
  function nextHtml(m) {
    var nw = C.obj(m.story.now) || {};
    var nx = C.obj(nw.next) || {};
    var wm = m.wm || { key: 'unknown', words: 'Whose move is unclear' };
    var what = C.clean(nx.what) || (wm.key === 'nobody' ? 'Nothing is waiting on anyone right now.' : 'No next step is on record.');
    var whenTxt = '';
    if (nx.when) whenTxt = isFinite(C.toMs(nx.when)) ? ' By ' + C.longDate(nx.when, m.now) + '.' : ' ' + C.clean(nx.when);
    var btns = [];
    var draft = m.money.drafts.filter(function (d) { return d.xeroId; })[0];
    if (draft && wm.key === 'us') btns.push('<a class="ov2-btn pri" href="' + esc(xeroUrl(draft.xeroId)) + '" target="_blank" rel="noopener">Open draft in Xero</a>');
    var cite = C.arr(nx.cites).filter(function (c) { return c && c.t === 'business_events' && c.id && m.conv.ids[String(c.id)]; })[0];
    if (cite) btns.push('<button type="button" class="ov2-btn' + (btns.length ? '' : ' pri') + '" data-ov2-act="show-msg" data-ov2-id="' + esc(cite.id) + '">Show the message</button>');
    if (btns.length < 2 && (m.job.ghl_contact_id || m.job.client_phone)) btns.push('<button type="button" class="ov2-btn" data-ov2-act="text">Text ' + esc(m.first) + '</button>');
    if (btns.length < 2) { var call = callHtml(m, ''); if (call) btns.push(call); }
    var move = moveHtml(m);
    return '<div class="ov2-next" id="ov2Next"><span class="ov2-lbl">Next step</span><p>' + esc(what + whenTxt) + '</p>' +
      (btns.length ? '<div class="ov2-nacts">' + btns.slice(0, 2).join('') + '</div>' : '') + move + '</div>';
  }
  // The classic Overview's "Mark as" moves, kept in one quiet row.
  function moveHtml(m) {
    var next = fn('getNextStatuses'), labels = g('STATUS_LABELS') || {};
    if (!next || !fn('changeJobStatus')) return '';
    var list = [];
    try { list = next(m.job.status, m.job.type) || []; } catch (e) { return ''; }
    if (!list.length) return '';
    return '<div class="ov2-move"><span>Move job to</span>' + list.map(function (s) {
      return '<button type="button" class="ov2-mini' + (s === 'cancelled' ? ' danger' : '') + '" data-ov2-act="status" data-ov2-s="' + esc(s) + '">' + esc(labels[s] || C.humanStatus(s)) + '</button>';
    }).join('') + '</div>';
  }
  function openItemsHtml(m, withKnow) {
    var g0 = m.items;
    var parts = [['blocking', 'Blocking'], ['waiting', 'Waiting on someone']];
    if (withKnow) parts.push(['know', 'Good to know']);
    var h = '<h3 class="ov2-lbl ov2-h">Open loops</h3>';
    var any = false;
    parts.forEach(function (p) {
      var list = g0[p[0]];
      if (!list.length) return;
      any = true;
      h += '<div class="ov2-gh" data-ov2-group="' + p[0] + '">' + esc(p[1]) + ' <span>' + list.length + '</span></div>' +
        '<ul class="ov2-open">' + list.map(function (it) { return itemHtml(m, it); }).join('') + '</ul>';
    });
    return any ? h : h + '<p class="ov2-none">Nothing open.</p>';
  }
  function itemHtml(m, it) {
    var open = !!m.u.itemOpen[it.key];
    var meta = [it.when, it.blocks].filter(Boolean).join(DOT);
    var more = [];
    if (it.why) more.push(it.whyLabel + it.why);
    if (it.closes) more.push('Closes when: ' + it.closes);
    var owner = it.group === 'waiting' ? 'Waiting on ' + it.tag.words : it.tag.words;
    return '<li' + (open ? ' class="open"' : '') + '><span class="ov2-own o-' + esc(it.tag.cls) + '">' + esc(owner) + '</span><div class="ov2-it">' +
      (more.length ? '<button type="button" class="ov2-itb" data-ov2-act="item" data-ov2-key="' + esc(it.key) + '" aria-expanded="' + open + '">' + esc(it.what) + '</button>' : '<span>' + esc(it.what) + '</span>') +
      (it.status === 'not_due' || it.status === 'unconfirmed' ? '<p class="ov2-im">' + esc((it.status === 'not_due' ? 'Held, not owed now.' : 'Unconfirmed, not an established debt.') + (it.why ? ' ' + it.why : '')) + '</p>' : '') +
      (meta ? '<div class="ov2-im">' + esc(meta) + '</div>' : '') +
      (more.length ? '<div class="ov2-imore">' + more.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') + '</div>' : '') + '</div></li>';
  }
  function stampHtml(m) {
    var t = m.text, u = m.u, parts = [];
    if (t && t.sections) {
      parts.push((t.written_at ? 'Story as of ' + C.stamp(t.written_at, m.now) : 'Story written') + ', rewritten when something new happens');
      if (t.state === 'stale') parts.push('Something newer has happened since it was written');
    }
    parts.push(C.ledgerWords(C.obj(m.story.meta) && m.story.meta.ledger, m.now));
    var h = '<div class="ov2-stamp" id="ov2Stamp"><p>' + esc(parts.join('. ') + '.') + '</p>';
    if (t && t.writer_on === false) {
      h += '<p id="ov2WriterOff">Written stories and rewriting are not switched on yet.</p>';
    } else if (u.asked && u.asked.ok) {
      h += '<p class="ov2-asked" id="ov2Asked">' + esc('Asked at ' + C.timeWords(u.asked.at) + '.' + (u.asked.words ? ' ' + u.asked.words : '')) + '</p>';
    } else if (t && t.request_open) {
      h += '<p class="ov2-asked" id="ov2Asked">A rewrite has been asked for.</p>';
    } else {
      if (u.asked && !u.asked.ok) h += '<p class="ov2-asked ov2-bad" id="ov2Asked">' + esc(u.asked.words) + '</p>';
      h += '<button type="button" class="ov2-linkbtn" id="ov2Rewrite" data-ov2-act="rewrite" aria-label="Ask for the story to be rewritten">Rewrite</button>';
    }
    return h + '</div>';
  }

  function convBodyHtml(m) {
    var c = m.conv, f = m.filter;
    var hint = c.total ? C.plural(c.total, 'message') + (c.counts.held ? DOT + c.counts.held + ' may belong to another job' : '') : '';
    if (m.convSource === 'record') hint = (hint ? hint + DOT : '') + 'latest from the job record';
    var h = '<div class="ov2-ch"><span class="ov2-lbl">Conversation</span><span class="ov2-hint">' + esc(hint) + '</span></div>' +
      '<div class="ov2-seg" role="group" aria-label="Show">' + [['all', 'All'], ['sms', 'Texts'], ['call', 'Calls'], ['email', 'Email']].map(function (p) {
        return '<button type="button" data-ov2-act="filter" data-ov2-f="' + p[0] + '" aria-pressed="' + (f === p[0]) + '"' + (f === p[0] ? ' class="on"' : '') + '>' + p[1] + '</button>';
      }).join('') + '</div><div class="ov2-conv" id="ov2Conv">';
    if (!c.items.length) {
      h += '<div class="ov2-empty">' + esc(c.total ? 'Nothing here for this filter.' : (m.failures.indexOf('conversation') >= 0 ? 'Conversation could not be read. Try again.' : (m.state === 'loading' ? 'Loading the conversation.' : 'No texts, calls or emails on record yet.'))) + '</div>';
    }
    c.items.forEach(function (x) { h += x.type === 'day' ? '<div class="ov2-day">' + esc(x.label) + '</div>' : bubbleHtml(m, x.m); });
    return h + '</div>';
  }
  function whoName(n, fallback, m) {
    var w = C.lower(n.who);
    if (!w) return fallback;
    if (w === 'customer' || w === 'client') return m.first;
    if (w === 'staff' || w === 'us' || w === 'ours' || w === 'team' || w === 'office') return 'Us';
    return C.firstName(n.who) || fallback;
  }
  // A held row keeps its place in the thread with its own mark: it may belong to another job.
  var HELD_TAG = '<span class="ov2-btag">Job not certain: may belong to another job</span>';
  function bubbleHtml(m, n) {
    var idAttr = (n.id ? ' data-ov2-msg="' + esc(n.id) + '"' : '') + (n.held ? ' data-ov2-held-msg="1"' : '');
    var held = n.held ? ' held' : '';
    var tag = n.held ? HELD_TAG : '';
    var t = C.timeWords(n.at);
    if (n.channel === 'call') {
      var who = n.direction === 'inbound' ? 'Call from ' + whoName(n, m.first, m) : 'Call to ' + m.first;
      return '<div class="ov2-b sys call' + held + '"' + idAttr + '>' + tag + esc([who, C.callWords(n.secs), t].filter(Boolean).join(DOT)) + '</div>';
    }
    if (n.channel !== 'sms' && n.channel !== 'email') return '<div class="ov2-b sys' + held + '"' + idAttr + '>' + tag + esc([C.cut(n.text, 160), t].filter(Boolean).join(DOT)) + '</div>';
    var inbound = n.direction === 'inbound';
    var meta = [whoName(n, inbound ? m.first : 'Us', m), n.channel === 'sms' ? 'text' : 'email', t].filter(Boolean).join(DOT) + (n.pending ? DOT + 'sent just now' : '');
    return '<div class="ov2-b ' + (inbound ? 'in' : 'out') + (n.pending ? ' pending' : '') + held + '"' + idAttr + '>' + tag + '<small>' + esc(meta) + '</small>' + esc(n.text) + '</div>';
  }
  function composeHtml(m) {
    if (!m.job.ghl_contact_id) {
      return '<div class="ov2-compose" id="ov2Compose"><textarea id="ov2Reply" rows="2" disabled placeholder="Texting needs a GoHighLevel contact"></textarea>' +
        '<div class="ov2-crow"><span class="ov2-why" id="ov2Why">No GoHighLevel contact is linked to this job.</span>' +
        '<button type="button" class="ov2-btn" data-ov2-act="comms">Link one on Comms</button></div></div>';
    }
    return '<div class="ov2-compose" id="ov2Compose"><label class="ov2-sr" for="ov2Reply">Reply to ' + esc(m.first) + ' by text</label>' +
      '<textarea id="ov2Reply" rows="2" placeholder="Reply to ' + esc(m.first) + ' by text"></textarea>' +
      '<div class="ov2-crow"><span class="ov2-count" id="ov2Count"></span><span class="ov2-why" id="ov2Why" role="status"></span>' +
      '<button type="button" class="ov2-btn pri" id="ov2ReplySend" data-ov2-act="send" disabled>Send</button></div></div>';
  }

  // ── Paint ──
  function captureScroll(u) {
    var c = document.getElementById('ov2Conv');
    if (c) { u.convAtBottom = c.scrollTop + c.clientHeight >= c.scrollHeight - 6; u.convTop = c.scrollTop; }
    var t = document.getElementById('ov2TlList');
    if (t) { u.tlAtBottom = t.scrollTop + t.clientHeight >= t.scrollHeight - 6; u.tlTop = t.scrollTop; }
  }
  function restoreScroll(u) {
    var c = document.getElementById('ov2Conv');
    if (c) c.scrollTop = u.convAtBottom ? c.scrollHeight : u.convTop;
    var t = document.getElementById('ov2TlList');
    if (t) t.scrollTop = u.tlAtBottom ? t.scrollHeight : u.tlTop;
  }
  function updateCompose(u) {
    var ta = document.getElementById('ov2Reply'), btn = document.getElementById('ov2ReplySend');
    if (!ta || !btn) return;
    var why = document.getElementById('ov2Why'), cnt = document.getElementById('ov2Count');
    var text = ta.value, banned = C.hasBanned(text);
    btn.disabled = !!(u.sending || !text.trim() || banned);
    btn.textContent = u.sending ? 'Sending...' : 'Send';
    if (why) why.textContent = banned ? 'Take out the long dash or emoji first. Texts to customers cannot have them.' : (u.sendErr || '');
    if (why) why.className = 'ov2-why' + (banned || u.sendErr ? ' bad' : '');
    if (cnt) cnt.textContent = text.length + '/160' + (text.length > 160 ? DOT + Math.ceil(text.length / 153) + ' texts' : '');
  }
  function afterPaint(m) {
    try {
      var ta = document.getElementById('ov2Reply');
      if (ta && !ta.disabled && ta.value !== m.u.draft) ta.value = m.u.draft;
      updateCompose(m.u);
      restoreScroll(m.u);
    } catch (e) { logErr('after paint', e); }
  }
  function swap(id, html) { var el = document.getElementById(id); if (el) el.outerHTML = html; }

  // Is the screen still showing this job? A late answer for another job paints nothing.
  function stillShowing(k) {
    if (!isOn()) return false;
    var d = g('_currentJobData');
    if (!d || !d.job || String(d.job.id) !== k) return false;
    var cur = g('_currentJobId');
    if (cur != null && String(cur) !== k && String(cur) !== String(d.job.job_number || '')) return false;
    var ov = document.getElementById('jdOverview');
    if (!ov || !ov.classList.contains('active')) return false;
    var root = document.getElementById('ov2Root');
    return !!root && root.getAttribute('data-job') === k;
  }
  // Repaint the regions after job_overview answers; the reply box and a name being edited stay put.
  function repaint(k) {
    try {
      if (!stillShowing(k)) return;
      var m = model(g('_currentJobData'));
      captureScroll(m.u);
      var notice = document.getElementById('ov2ReadNotice');
      if (notice) notice.remove();
      document.getElementById('ov2Root').insertAdjacentHTML('afterbegin', readNoticeHtml(m));
      if (!document.getElementById('jdClientNameInput')) swap('ov2Cust', custHtml(m));
      swap('ov2Files', filesHtml(m));
      swap('ov2Timeline', timelineHtml(m));
      swap('ov2Story', storyHtml(m));
      var body = document.getElementById('ov2ConvBody');
      if (body) body.innerHTML = convBodyHtml(m);
      afterPaint(m);
    } catch (e) { logErr('repaint failed', e); }
  }
  function repaintConv(k, toBottom) {
    if (!stillShowing(k)) return;
    var m = model(g('_currentJobData'));
    captureScroll(m.u);
    if (toBottom) m.u.convAtBottom = true;
    var body = document.getElementById('ov2ConvBody');
    if (body) body.innerHTML = convBodyHtml(m);
    afterPaint(m);
    return m;
  }

  // ── job_overview: read once at a time, reused for 3 minutes ──
  function load(k, force) {
    k = String(k || '');
    if (!k) return;
    var e = cache[k];
    if (e && e.promise) return;
    if (e && !force && Date.now() - e.at < CACHE_MS) return;
    var prev = e && e.data ? e.data : null;
    var next = { status: prev ? 'ok' : 'loading', data: prev, at: e ? e.at : 0, promise: null, error: null };
    cache[k] = next;
    var f = fn('opsFetch');
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    var p;
    try { p = f ? Promise.resolve(f('job_overview', { jobId: k }, ctrl ? { signal: ctrl.signal } : {})) : Promise.reject(new Error('opsFetch missing')); }
    catch (err) { p = Promise.reject(err); }
    next.promise = p.then(function (res) {
      cache[k] = { status: 'ok', data: res && typeof res === 'object' ? res : {}, at: Date.now(), promise: null, error: null };
    }, function (err) {
      if (prev) { cache[k] = { status: 'ok', data: prev, at: Date.now(), promise: null, error: null, refreshFailed: true }; return; }
      var timedOut = !!(err && err.name === 'AbortError');
      cache[k] = { status: C.isNotDeployed(err) ? 'notdeployed' : 'error', data: null, at: Date.now(), promise: null,
        error: timedOut ? 'timeout' : String((err && err.message) || 'error') };
      if (!timedOut && !C.isNotDeployed(err)) logErr('job_overview failed', err);
    }).then(function () { clearTimeout(timer); repaint(k); });
  }

  // ── Actions ──
  function currentJob() { var d = g('_currentJobData'); return d && d.job ? d.job : null; }
  function focusReply() {
    var ta = document.getElementById('ov2Reply');
    if (!ta || ta.disabled) return false;
    try { ta.scrollIntoView({ block: 'center' }); } catch (e) { /* old browser */ }
    ta.focus();
    return true;
  }
  function showMessage(k, id) {
    var sel = '[data-ov2-msg="' + String(id).replace(/["\\]/g, '') + '"]';
    var el = document.querySelector('#ov2Conv ' + sel);
    if (!el && getFilter() !== 'all') { setFilter('all'); repaintConv(k, false); el = document.querySelector('#ov2Conv ' + sel); }
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 2200);
  }
  function rewrite(k) {
    var u = ui(k), post = fn('opsPost');
    var btn = document.getElementById('ov2Rewrite');
    var entry = cache[k];
    var textState = C.storyText(entry && entry.data && entry.data.story_text);
    if (!post || (btn && btn.disabled) || (textState && textState.writer_on === false)) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Asking...'; }
    Promise.resolve().then(function () { return post('request_job_story', { jobId: k }); }).then(function (res) {
      u.asked = { at: Date.now(), ok: C.rewriteAccepted(res), words: C.rewriteWords(res) };
    }, function (err) {
      u.asked = { at: Date.now(), ok: false, words: C.isNotDeployed(err) ? 'Rewriting is not switched on yet.' : 'Could not ask for a rewrite: ' + C.clean((err && err.message) || 'unknown error') + '.' };
    }).then(function () {
      if (!stillShowing(k)) return;
      var m = model(g('_currentJobData'));
      if (m.story) swap('ov2Stamp', stampHtml(m));
    });
  }
  // A refusal in words. No answer at all (the network) is not proof nothing went, so it says so.
  function sendWords(status, d) {
    d = d || {};
    var why = d.error && typeof d.error === 'string' ? C.clean(d.error).replace(/[.\s]+$/, '') : '';
    if (d.dedup_blocked) return 'The same text went to this customer in the last 10 minutes, so it was not sent again.';
    if (status === 409 && /mismatch/i.test(why)) return 'The GoHighLevel contact does not match this job, so nothing was sent. Check the contact on the Comms tab.';
    if (status === 429) return 'GoHighLevel is busy right now. Nothing was sent; try again in a minute.';
    if (!status) return 'The text could not be confirmed' + (why ? ' (' + why + ')' : '') + '. Check the Comms tab before sending it again.';
    return 'The text did not send' + (why ? ': ' + why : '') + '.';
  }
  function send(k) {
    var u = ui(k), job = currentJob();
    var ta = document.getElementById('ov2Reply');
    if (!job || String(job.id) !== k || !ta || u.sending) return;
    var text = ta.value.trim();
    if (!text || C.hasBanned(text) || !job.ghl_contact_id) return;
    var base = g('_commsGHLBase') || (g('SUPABASE_URL') ? g('SUPABASE_URL') + '/functions/v1/ghl-proxy' : '');
    var headersFn = fn('opsAuthHeaders');
    if (!base || !headersFn) return;
    u.sending = true; u.sendErr = '';
    updateCompose(u);
    var contactId = job.ghl_contact_id;
    Promise.resolve().then(function () { return headersFn({ 'Content-Type': 'application/json' }); }).catch(function (e) {
      var err = e instanceof Error ? e : new Error('Sign in required');
      err.beforeSend = true;
      throw err;
    }).then(function (headers) {
      return fetch(base + '?action=send_sms', { method: 'POST', headers: headers, body: JSON.stringify({ contactId: contactId, message: text, jobId: job.id }) });
    }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (d) {
        if (!resp.ok || !d || d.success !== true) { var err = new Error('send failed'); err.status = resp.status; err.body = d; throw err; }
        return d;
      });
    }).then(function () {
      u.sending = false; u.sendErr = ''; u.draft = '';
      u.sent.push({ ms: Date.now(), text: text });
      try { window.sessionStorage.removeItem('sw_convo_' + contactId); } catch (e) { /* storage blocked */ }
      var box = document.getElementById('ov2Reply');
      if (box) box.value = '';
      repaintConv(k, true);
      updateCompose(u);
      toast('Text sent to ' + (C.firstName(job.client_name) || 'the customer') + '.', 'success');
    }, function (err) {
      u.sending = false;
      u.sendErr = err && err.beforeSend ? 'Nothing was sent: ' + C.clean(err.message || 'sign in required') + '.'
        : sendWords(err && err.status, err && err.body ? err.body : { error: err && err.message });
      updateCompose(u);
    });
  }

  function toggle(on) {
    override = !!on;
    writeStore(FLAG_KEY, on ? '1' : '0');
    try {
      var url = new URL(window.location.href);
      if (url.searchParams.has('overview')) {
        url.searchParams.delete('overview');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
    } catch (e) { /* keep the URL */ }
    var d = g('_currentJobData'), r = fn('renderOverviewView');
    if (d && d.job && r) r(d);
  }

  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-ov2-act]') : null;
    if (!t || !this.contains(t)) return;
    var act = t.getAttribute('data-ov2-act');
    var job = currentJob();
    var k = job ? String(job.id) : '';
    try {
      if (act === 'try') { toggle(true); return; }
      if (act === 'classic') { toggle(false); return; }
      if (!job || !document.getElementById('ov2Root')) return;
      var u = ui(k);
      if (act === 'tl' || act === 'item') {
        var li = t.closest('li');
        if (!li) return;
        var open = !li.classList.contains('open');
        li.classList.toggle('open', open);
        t.setAttribute('aria-expanded', String(open));
        (act === 'tl' ? u.tlOpen : u.itemOpen)[t.getAttribute('data-ov2-key')] = open;
      } else if (act === 'tl-all') {
        u.tlAll = true;
        var m = model(g('_currentJobData'));
        swap('ov2Timeline', timelineHtml(m));
      } else if (act === 'filter') {
        setFilter(t.getAttribute('data-ov2-f') || 'all');
        repaintConv(k, true);
      } else if (act === 'show-msg') {
        showMessage(k, t.getAttribute('data-ov2-id'));
      } else if (act === 'text' || act === 'sms') {
        if (!focusReply()) { var sv = fn('showJobSubView'); if (sv) sv('comms'); }
      } else if (act === 'call' || act === 'call-tel') {
        var call = fn('scheduleCallLog');
        if (call) call(); // a tel: link still dials; the bridge modal opens on desktop
      } else if (act === 'edit-name') {
        var edit = fn('editClientName');
        if (edit) edit(job.id, job.client_name || '');
      } else if (act === 'file') {
        var f = u.files[t.getAttribute('data-ov2-key')];
        if (!f || !f.open) return;
        if (f.open.type === 'photos') { var sv2 = fn('showJobSubView'); if (sv2) sv2('files'); }
        if (f.open.type === 'invoice') { var pv = fn('showGlobalInvoicePreview'); if (pv) pv(f.previewRow); }
      } else if (act === 'retry' || act === 'refresh') {
        if (cache[k] && !cache[k].data) delete cache[k];
        load(k, true);
        repaint(k);
      } else if (act === 'rewrite') {
        rewrite(k);
      } else if (act === 'send') {
        send(k);
      } else if (act === 'comms') {
        var sv3 = fn('showJobSubView');
        if (sv3) sv3('comms');
      } else if (act === 'status') {
        var change = fn('changeJobStatus');
        if (change) change(job.id, t.getAttribute('data-ov2-s'));
      }
    } catch (e) { logErr(act + ' failed', e); }
  }
  function onInput(ev) {
    var t = ev.target;
    if (!t || t.id !== 'ov2Reply') return;
    var job = currentJob();
    if (!job) return;
    var u = ui(job.id);
    u.draft = t.value;
    u.sendErr = '';
    updateCompose(u);
  }
  function bind(el) {
    if (!el || el.__ov2Bound) return;
    el.__ov2Bound = true;
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
  }
  function ensureCss() {
    if (document.getElementById('ov2-css')) return;
    var s = document.createElement('style');
    s.id = 'ov2-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // Paint the new Overview. Returns false (and paints nothing) when the switch is off, the job is a
  // make-safe, or anything goes wrong, so the classic Overview renders instead.
  function render(data) {
    try {
      if (!data || !data.job || !data.job.id) return false;
      if (String(data.job.type || '') === 'makesafe') return false;
      if (!isOn()) return false;
      var el = document.getElementById('jdOverview');
      if (!el) return false;
      ensureCss();
      bind(el);
      var m = model(data);
      var prev = document.getElementById('ov2Root');
      if (prev && prev.getAttribute('data-job') === m.k) captureScroll(m.u);
      else { m.u.convAtBottom = true; m.u.tlAtBottom = true; }
      el.innerHTML = pageHtml(m);
      try {
        if (window.JobWorkOrderOps && JobWorkOrderOps.paintOverview) JobWorkOrderOps.paintOverview(data);
      } catch (woErr) { logErr('work order card', woErr); }
      afterPaint(m);
      setTimeout(function () { load(m.k, false); }, 0);
      return true;
    } catch (e) {
      logErr('render failed; showing the classic Overview', e);
      return false;
    }
  }
  // After the classic Overview paints: a small link to try the new one, for staff only.
  function afterClassic(data) {
    try {
      if (!data || !data.job || String(data.job.type || '') === 'makesafe' || !api.isStaffViewer()) return;
      var el = document.getElementById('jdOverview');
      if (!el || el.querySelector('[data-ov2-act="try"]')) return;
      bind(el);
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:flex-end;margin:-6px 0 8px;';
      row.innerHTML = '<button type="button" id="ov2Toggle" data-ov2-act="try" style="background:none;border:0;padding:2px 0;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;color:var(--sw-orange,#F15A29);">Try the new Overview</button>';
      el.insertBefore(row, el.firstChild);
    } catch (e) { logErr('toggle link failed', e); }
  }

  var CSS = [
    '.ov2{max-width:1500px;margin:0 auto;color:var(--sw-text,#1A272E);font-family:var(--sw-font,"Helvetica Neue",Helvetica,Arial,sans-serif);font-size:13px;line-height:1.5}',
    '.ov2 *,.ov2 *:before,.ov2 *:after{box-sizing:border-box}',
    '.ov2 button,.ov2 textarea{font-family:inherit}',
    '.ov2 :focus-visible{outline:2px solid var(--sw-orange,#F15A29);outline-offset:2px}',
    '.ov2-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.ov2-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--sw-mid,#4C6A7C)}',
    '.ov2-hint{font-size:11px;color:var(--sw-text-sec,#8FA4B2);text-align:right}',
    '.ov2-card{background:var(--sw-card,#FCFBFA);border:1px solid var(--sw-border,#D4DEE4);box-shadow:var(--sw-shadow,0 1px 3px rgba(41,60,70,.06))}',
    '.ov2-empty{padding:12px;color:var(--sw-mid,#4C6A7C);font-size:12px}',
    '.ov2-switch{display:flex;justify-content:flex-end;margin:-6px 0 8px}',
    '.ov2-linkbtn{background:none;border:0;padding:2px 0;cursor:pointer;font-size:12px;font-weight:600;color:var(--sw-orange,#F15A29)}',
    '.ov2-linkbtn:hover{color:var(--sw-orange-hover,#C4481F);text-decoration:underline}',
    '.ov2-linkbtn[disabled]{color:var(--sw-mid-light,#8FA4B2);cursor:default;text-decoration:none}',
    '.ov2-cust{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;padding:16px 18px;align-items:center}',
    '.ov2-cust-main{min-width:0}',
    '.ov2-name{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:18px;font-weight:700;color:var(--sw-dark,#293C46);line-height:1.3;margin-top:2px}',
    '.ov2-name-t{overflow-wrap:anywhere}',
    '.ov2-edit{background:none;border:0;padding:0;cursor:pointer;font-size:11px;font-weight:600;color:var(--sw-mid,#4C6A7C);opacity:.75}',
    '.ov2-edit:hover{opacity:1;color:var(--sw-orange,#F15A29)}',
    '.ov2-addr{color:var(--sw-mid,#4C6A7C);margin:2px 0;overflow-wrap:anywhere}',
    '.ov2-note{color:var(--sw-mid,#4C6A7C);font-size:12px}',
    '.ov2-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}',
    '.ov2-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--sw-border,#D4DEE4);background:#fff;color:var(--sw-dark,#293C46);border-radius:var(--sw-radius-sm,3px);padding:6px 11px;font-size:12px;font-weight:600;line-height:1.3;cursor:pointer;text-decoration:none;white-space:nowrap}',
    '.ov2-btn:hover{border-color:var(--sw-orange,#F15A29);color:var(--sw-orange,#F15A29)}',
    '.ov2-btn.pri{background:var(--sw-orange,#F15A29);border-color:var(--sw-orange,#F15A29);color:#fff}',
    '.ov2-btn.pri:hover{background:var(--sw-orange-hover,#C4481F);border-color:var(--sw-orange-hover,#C4481F);color:#fff}',
    '.ov2-btn[disabled],.ov2-btn[disabled]:hover{opacity:.45;cursor:not-allowed}',
    '.ov2-btn.pri[disabled]:hover{background:var(--sw-orange,#F15A29);border-color:var(--sw-orange,#F15A29)}',
    '.ov2-money{text-align:right;font-variant-numeric:tabular-nums}',
    '.ov2-val{font-size:22px;font-weight:700;color:var(--sw-dark,#293C46);line-height:1.25}',
    '.ov2-mrow{color:var(--sw-mid,#4C6A7C);font-size:12px;margin-top:2px}',
    '.ov2-value-check{max-width:48ch;margin-left:auto;font-size:12px;color:var(--sw-dark,#293C46);overflow-wrap:anywhere}',
    '.ov2-value-check p,.ov2-future-money p{margin:4px 0}',
    '.ov2-future-money{font-size:12px;color:var(--sw-dark,#293C46);margin:8px 0 12px;overflow-wrap:anywhere}',
    '.ov2-held{font-size:12px;overflow-wrap:anywhere}.ov2-held p{margin:6px 0}',
    '.ov2-held-item{border-top:1px solid var(--sw-border,#D4DEE4);margin-top:10px;padding-top:10px}',
    '.ov2-held-words{white-space:pre-wrap}',
    '.ov2-warnt{color:#B9770E;font-weight:600}',
    '.ov2-who{display:flex;gap:6px;justify-content:flex-end;margin-top:6px;flex-wrap:wrap}',
    '.ov2-chip{font-size:11px;border:1px solid var(--sw-border,#D4DEE4);border-radius:var(--sw-radius-pill,100px);padding:2px 9px;color:var(--sw-mid,#4C6A7C);background:#fff;white-space:nowrap}',
    '.ov2-chip.us{border-color:var(--sw-orange-light,#FADDD2);background:var(--sw-orange-tint,#FDF2EE);color:var(--sw-orange-hover,#C4481F);font-weight:700}',
    '@media (max-width:820px){.ov2-cust{grid-template-columns:minmax(0,1fr);gap:12px;padding:14px}.ov2-money{text-align:left}.ov2-value-check{margin-left:0}.ov2-who{justify-content:flex-start}}',
    '.ov2-files{margin:12px 0}',
    '.ov2-fhead{display:flex;justify-content:space-between;align-items:baseline;margin:0 0 6px}',
    '.ov2-strip{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 6px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}',
    '.ov2-file{flex:0 0 200px;display:flex;flex-direction:column;scroll-snap-align:start;transition:box-shadow .15s}',
    '.ov2-file:hover{box-shadow:var(--sw-shadow-hover,0 4px 12px rgba(41,60,70,.10))}',
    '.ov2-file.faded{opacity:.62}',
    '.ov2-fmain{flex:1;display:flex;gap:10px;align-items:flex-start;width:100%;padding:10px 12px;margin:0;background:none;border:0;text-align:left;color:var(--sw-text,#1A272E);text-decoration:none;font-size:13px}',
    'button.ov2-fmain,a.ov2-fmain{cursor:pointer}',
    '.ov2-flink{padding:0 12px 8px 56px;font-size:11px;font-weight:600;color:var(--sw-mid,#4C6A7C);text-decoration:none}',
    '.ov2-flink:hover{color:var(--sw-orange,#F15A29);text-decoration:underline}',
    '.ov2-ico{width:34px;height:42px;flex:none;position:relative;background:var(--sw-light,#EDF1F4);border:1px solid var(--sw-border,#D4DEE4)}',
    '.ov2-ico:before{content:"";position:absolute;top:-1px;right:-1px;border-style:solid;border-width:0 9px 9px 0;border-color:transparent var(--sw-card,#FCFBFA) var(--sw-border,#D4DEE4) transparent}',
    '.ov2-ico:after{content:attr(data-k);position:absolute;left:0;right:0;bottom:4px;text-align:center;font-size:8.5px;font-weight:800;letter-spacing:.3px;color:var(--sw-mid,#4C6A7C)}',
    '.ov2-ico.q{background:var(--sw-orange-tint,#FDF2EE);border-color:var(--sw-orange-light,#FADDD2)}.ov2-ico.q:after{color:var(--sw-orange-hover,#C4481F)}',
    '.ov2-ico.inv{background:#FEF3E0;border-color:#F7D9A8}.ov2-ico.inv:after{color:#B9770E}',
    '.ov2-ico.img{background:#EAF4EC;border-color:#CFE5D5}.ov2-ico.img:after{color:#3E7D52}',
    '.ov2-ftxt{display:flex;flex-direction:column;align-items:flex-start;min-width:0}',
    '.ov2-fn{font-weight:700;font-size:12.5px;line-height:1.3;color:var(--sw-dark-deep,#1A272E);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.ov2-fm{font-size:11px;color:var(--sw-mid,#4C6A7C);margin-top:2px;line-height:1.35}',
    '.ov2-st{display:inline-block;margin-top:5px;font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;border-radius:var(--sw-radius-pill,100px);padding:2px 7px}',
    '.ov2 .s-acc{background:#E6F5EC;color:#1E8449}.ov2 .s-sup{background:var(--sw-light,#EDF1F4);color:var(--sw-mid,#4C6A7C)}.ov2 .s-warn{background:#FDECEA;color:#C0392B}.ov2 .s-info{background:var(--sw-light,#EDF1F4);color:var(--sw-mid,#4C6A7C)}',
    '.ov2-cols{display:grid;grid-template-columns:300px minmax(0,1fr) 340px;gap:12px;align-items:start}',
    '.ov2-cols>*{min-width:0}',
    '@media (max-width:1150px){.ov2-cols{grid-template-columns:minmax(0,1fr)}.ov2-mid{order:-1}}',
    '.ov2-col{padding:14px 16px 12px}',
    '.ov2-ch{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px}',
    '.ov2-story-head{align-items:center;border-bottom:1px solid var(--sw-border,#D4DEE4);padding-bottom:10px;margin-bottom:14px}',
    '.ov2-story-head h2{font-size:17px;line-height:1.3;margin:0;color:var(--sw-dark-deep,#1A272E)}',
    '.ov2-story-head .ov2-linkbtn[disabled]{opacity:.5;cursor:wait}',
    '.ov2-story-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:5px}',
    '.ov2-story-row h3,.ov2-story-block h3{font-size:12px;font-weight:700;color:var(--sw-dark,#293C46);margin:0}',
    '.ov2-story-now{margin-bottom:12px}',
    '.ov2-story-now .ov2-lede{margin:0 0 5px}',
    '.ov2-story-now .ov2-p{margin:0}',
    '.ov2-story-block{border-top:1px solid var(--sw-light,#EDF1F4);padding-top:12px;margin-top:12px}',
    '.ov2-story-moments{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;list-style:none;margin:10px 0 0;padding:0}',
    '.ov2-story-moments li{min-width:0;border-top:2px solid var(--sw-border,#D4DEE4);padding:8px 2px 0;position:relative}',
    '.ov2-story-dot{width:9px;height:9px;border:2px solid var(--sw-mid-light,#8FA4B2);background:#fff;border-radius:50%;position:absolute;top:-6px;left:0}',
    '.ov2-story-moments li.ms .ov2-story-dot{background:var(--sw-orange,#F15A29);border-color:var(--sw-orange,#F15A29)}',
    '.ov2-story-moments li.wn .ov2-story-dot{background:var(--sw-red,#E74C3C);border-color:var(--sw-red,#E74C3C)}',
    '.ov2-story-moments li.now .ov2-story-dot{background:#F39C12;border-color:#F39C12}',
    '.ov2-story-moments small{display:block;font-size:10px;color:var(--sw-mid,#4C6A7C);margin-bottom:3px}',
    '.ov2-story-moments strong{display:block;font-size:11px;line-height:1.35;overflow-wrap:anywhere}',
    '.ov2-story-money{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--sw-border,#D4DEE4);margin:14px 0 4px;border:1px solid var(--sw-border,#D4DEE4);font-variant-numeric:tabular-nums}',
    '.ov2-story-money>div{background:var(--sw-bg,#F8F6F3);padding:9px 10px;min-width:0}',
    '.ov2-story-money span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--sw-mid,#4C6A7C)}',
    '.ov2-story-money strong{display:block;font-size:15px;line-height:1.3;color:var(--sw-dark-deep,#1A272E);overflow-wrap:anywhere}',
    '.ov2-story-last{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
    '.ov2-story-last h3{grid-column:1/-1}',
    '.ov2-story-last>div{min-width:0;background:var(--sw-bg,#F8F6F3);padding:8px 10px}',
    '.ov2-story-last p,.ov2-story-unknown p{margin:4px 0 0;font-size:12px;line-height:1.45;overflow-wrap:anywhere}',
    '.ov2-story-unknown ul{margin:6px 0 0;padding-left:18px;font-size:12px}',
    '.ov2-story-more{margin-top:14px;font-size:12px}',
    '.ov2-story-more summary{cursor:pointer;color:var(--sw-mid,#4C6A7C);font-weight:700}',
    '@media (max-width:540px){.ov2-story-moments{grid-template-columns:repeat(2,minmax(0,1fr))}.ov2-story-last{grid-template-columns:minmax(0,1fr)}.ov2-story-money strong{font-size:12px}}',
    '.ov2-tl{list-style:none;margin:0;padding:0 0 0 20px;max-height:780px;overflow:auto}',
    '.ov2-tl li{position:relative}',
    '.ov2-tl li:after{content:"";position:absolute;left:-12px;top:0;bottom:0;width:2px;background:var(--sw-border,#D4DEE4)}',
    '.ov2-tl li:first-child:after{top:14px}.ov2-tl li:last-child:after{bottom:auto;height:14px}',
    '.ov2-tl li:before{content:"";position:absolute;left:-16px;top:12px;width:10px;height:10px;background:var(--sw-card,#FCFBFA);border:2px solid var(--sw-mid-light,#8FA4B2);border-radius:50%;z-index:1}',
    '.ov2-tl li.ms:before{background:var(--sw-orange,#F15A29);border-color:var(--sw-orange,#F15A29)}',
    '.ov2-tl li.wn:before{background:var(--sw-red,#E74C3C);border-color:var(--sw-red,#E74C3C)}',
    '.ov2-tl li.now:before{background:#F39C12;border-color:#F39C12;box-shadow:0 0 0 4px #FEF3E0}',
    '.ov2-tl li.mu .ov2-tli{opacity:.6}',
    '.ov2-tli{display:block;width:100%;text-align:left;background:none;border:0;padding:6px 6px 6px 10px;margin:0;cursor:pointer;font-size:13px;color:var(--sw-text,#1A272E)}',
    '.ov2-tli:hover{background:var(--sw-light,#EDF1F4)}',
    '.ov2-d,.ov2-t,.ov2-s{display:block}',
    '.ov2-d{font-size:11px;color:var(--sw-text-sec,#8FA4B2)}',
    '.ov2-t{font-weight:700;font-size:13px;line-height:1.35;color:var(--sw-dark-deep,#1A272E)}',
    '.ov2-tl li.wn .ov2-t{color:#C0392B}',
    '.ov2-s{font-size:11px;color:var(--sw-mid-light,#8FA4B2)}',
    '.ov2-more{display:none;margin:0 6px 6px 10px;padding:6px 8px;background:var(--sw-bg,#F8F6F3);border-top:1px solid var(--sw-orange-light,#FADDD2);color:var(--sw-mid,#4C6A7C);font-size:12px}',
    '.ov2-more p{margin:0 0 4px}.ov2-more p:last-child{margin:0}',
    '.ov2-tl li.open .ov2-more{display:block}',
    '.ov2-tlall{display:none;margin:6px 0 0 20px}',
    '.ov2-lede{font-size:17px;font-weight:700;line-height:1.35;margin:2px 0 12px;color:var(--sw-dark-deep,#1A272E)}',
    '.ov2-next{border:1px solid var(--sw-orange-light,#FADDD2);background:var(--sw-orange-tint,#FDF2EE);padding:10px 12px;margin:0 0 14px}',
    '.ov2-next .ov2-lbl{color:var(--sw-orange-hover,#C4481F)}',
    '.ov2-next p{margin:4px 0 10px;font-weight:600;max-width:70ch}',
    '.ov2-next.ov2-quiet{border-color:var(--sw-border,#D4DEE4);background:var(--sw-bg,#F8F6F3);margin-top:12px}',
    '.ov2-nacts{display:flex;gap:6px;flex-wrap:wrap}',
    '.ov2-move{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:var(--sw-mid,#4C6A7C)}',
    '.ov2-quiet .ov2-move{margin-top:0}',
    '.ov2-mini{border:1px solid var(--sw-border,#D4DEE4);background:#fff;border-radius:var(--sw-radius-sm,3px);padding:3px 8px;font-size:11px;font-weight:600;color:var(--sw-dark,#293C46);cursor:pointer}',
    '.ov2-mini:hover{border-color:var(--sw-dark,#293C46)}',
    '.ov2-mini.danger{color:#C0392B}',
    '.ov2-h{margin:16px 0 4px}',
    '.ov2-p{margin:0 0 10px;max-width:70ch}',
    '.ov2-none{margin:8px 0 0;font-size:12px;color:var(--sw-mid,#4C6A7C);font-style:italic}',
    '.ov2-gh{margin:10px 0 0;font-size:11px;font-weight:700;color:var(--sw-dark,#293C46)}',
    '.ov2-gh span{color:var(--sw-text-sec,#8FA4B2);font-weight:600}',
    '.ov2-open{list-style:none;margin:0;padding:0}',
    '.ov2-open li{display:flex;gap:10px;align-items:baseline;padding:8px 0;border-top:1px solid var(--sw-light,#EDF1F4)}',
    '.ov2-open li:first-child{border-top:0}',
    '.ov2-own{font-size:10px;font-weight:800;letter-spacing:.5px;border-radius:var(--sw-radius-pill,100px);padding:2px 8px;flex:none;white-space:nowrap}',
    '.ov2 .o-us{background:var(--sw-orange-tint,#FDF2EE);color:var(--sw-orange-hover,#C4481F);border:1px solid var(--sw-orange-light,#FADDD2)}',
    '.ov2 .o-cust{background:#E8F2FB;color:#1F6FA8}',
    '.ov2 .o-tp{background:var(--sw-light,#EDF1F4);color:var(--sw-mid,#4C6A7C)}',
    '.ov2 .o-unk{background:#fff;color:var(--sw-mid,#4C6A7C);border:1px dashed var(--sw-border,#D4DEE4)}',
    '.ov2-it{min-width:0;flex:1}',
    '.ov2-itb{background:none;border:0;padding:0;margin:0;text-align:left;cursor:pointer;font-size:13px;line-height:1.5;color:var(--sw-text,#1A272E)}',
    '.ov2-itb:hover{color:var(--sw-orange-hover,#C4481F)}',
    '.ov2-im{font-size:11px;color:var(--sw-mid,#4C6A7C);margin-top:1px}',
    '.ov2-imore{display:none;margin-top:4px;padding:6px 8px;background:var(--sw-bg,#F8F6F3);border-top:1px solid var(--sw-orange-light,#FADDD2);font-size:12px;color:var(--sw-mid,#4C6A7C)}',
    '.ov2-imore p{margin:0 0 4px}.ov2-imore p:last-child{margin:0}',
    '.ov2-open li.open .ov2-imore{display:block}',
    '.ov2-stamp{font-size:11px;color:var(--sw-mid,#4C6A7C);border-top:1px dashed var(--sw-border,#D4DEE4);padding-top:8px;margin-top:14px}',
    '.ov2-stamp p{margin:0 0 4px}',
    '.ov2-asked{color:var(--sw-dark,#293C46);font-weight:600}',
    '.ov2-bad{color:#C0392B}',
    '.ov2-state{padding:4px 0}',
    '.ov2-state p{margin:0 0 8px;color:var(--sw-mid,#4C6A7C);max-width:60ch}',
    '.ov2-state .ov2-state-t{font-size:15px;font-weight:700;color:var(--sw-dark-deep,#1A272E)}',
    '.ov2-wait{margin-top:10px;font-size:12px}',
    '.ov2-sk{display:block;margin:0 0 8px;background:linear-gradient(90deg,var(--sw-light,#EDF1F4) 0%,#F6F8FA 50%,var(--sw-light,#EDF1F4) 100%);background-size:200% 100%;animation:ov2sh 1.3s ease-in-out infinite}',
    '@keyframes ov2sh{0%{background-position:100% 0}100%{background-position:-100% 0}}',
    '@media (prefers-reduced-motion:reduce){.ov2-sk{animation:none}}',
    '.ov2-seg{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}',
    '.ov2-seg button{font-size:11px;font-weight:600;border-radius:var(--sw-radius-pill,100px);padding:3px 10px;background:var(--sw-light,#EDF1F4);color:var(--sw-mid,#4C6A7C);border:0;cursor:pointer}',
    '.ov2-seg button.on{background:var(--sw-dark,#293C46);color:#fff}',
    '.ov2-conv{max-height:690px;overflow:auto;display:flex;flex-direction:column;gap:6px;padding:2px 2px 2px 0}',
    '.ov2-day{text-align:center;font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--sw-mid-light,#8FA4B2);margin:8px 0 2px}',
    '.ov2-b{max-width:86%;padding:7px 10px;font-size:12.5px;line-height:1.45;border:1px solid var(--sw-border,#D4DEE4);overflow-wrap:anywhere;white-space:pre-line}',
    '.ov2-b small{display:block;font-size:10.5px;color:var(--sw-text-sec,#8FA4B2);margin-bottom:1px;white-space:normal}',
    '.ov2-b.in{background:#fff;align-self:flex-start}',
    '.ov2-b.out{background:var(--sw-light,#EDF1F4);align-self:flex-end;border-color:#C9D6DE}',
    '.ov2-b.pending{opacity:.75}',
    '.ov2-b.sys{align-self:center;max-width:100%;border:0;background:transparent;color:var(--sw-mid,#4C6A7C);font-size:11px;padding:1px 4px;text-align:center}',
    '.ov2-b.flash{box-shadow:0 0 0 3px var(--sw-orange-light,#FADDD2)}',
    '.ov2-b.held{border:1px dashed #B9770E;background:#FFF8EC;color:var(--sw-dark,#293C46)}',
    '.ov2-b.sys.held{padding:4px 8px}',
    '.ov2-btag{display:block;font-size:10.5px;font-weight:600;color:#8A5A0B;margin-bottom:2px;white-space:normal}',
    '.ov2-compose{margin-top:10px;border-top:1px solid var(--sw-light,#EDF1F4);padding-top:10px}',
    '.ov2-compose textarea{display:block;width:100%;min-height:58px;border:1px solid var(--sw-border,#D4DEE4);border-radius:var(--sw-radius-sm,3px);padding:7px 9px;font-size:12.5px;line-height:1.45;background:#fff;resize:vertical}',
    '.ov2-compose textarea:focus{outline:none;border-color:var(--sw-orange,#F15A29)}',
    '.ov2-compose textarea[disabled]{background:var(--sw-light,#EDF1F4)}',
    '.ov2-crow{display:flex;align-items:center;gap:8px;margin-top:6px}',
    '.ov2-count{font-size:11px;color:var(--sw-text-sec,#8FA4B2);flex:none}',
    '.ov2-why{flex:1;font-size:11px;color:var(--sw-mid,#4C6A7C);min-width:0}',
    '.ov2-why.bad{color:#C0392B}',
    '.ov2-crow .ov2-btn{margin-left:auto;flex:none}',
    '@media (max-width:768px){.ov2-tl{max-height:none;overflow:visible}.ov2-tl.clip li.old{display:none}.ov2-tlall{display:inline-block}.ov2-conv{max-height:60vh}.ov2-col{padding:12px}.ov2-lede{font-size:16px}}'
  ].join('\n');

  var api = {
    isOn: isOn,
    render: render,
    afterClassic: afterClassic,
    toggle: toggle,
    reload: function (force) { var j = currentJob(); if (j) { load(String(j.id), force !== false); } },
    // Staff only: a signed-in user whose role is not a trade role. Tests override this.
    isStaffViewer: function () {
      try {
        var c = window.SECUREWORKS_CLOUD;
        if (!c || !c.auth || typeof c.auth.isLoggedIn !== 'function' || !c.auth.isLoggedIn()) return false;
        var role = typeof c.auth.getRole === 'function' ? String(c.auth.getRole() || '').toLowerCase() : '';
        return TRADE_ROLES.indexOf(role) < 0;
      } catch (e) { return false; }
    },
    core: C,
    _state: { cache: cache, ui: uiState }
  };
  return api;
})();
