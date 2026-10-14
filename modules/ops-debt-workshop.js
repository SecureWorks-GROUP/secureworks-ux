// ════════════════════════════════════════════════════════════
// DEBT WORKSHOP: the Debt tab (#viewDebt) of the ops dashboard.
// Contract: secureworks-wiki coding/capabilities/debt-follow-up/debt-workshop-spec.md
//   (section 9 is this screen; sections 3, 4 and 8 give the data and the actions).
// Screen doc: docs/debt-workshop.md.
//
// W1 (overview): a donut of the five categories by amount, job type filters, a legend
//   that picks the list, one row per invoice (companies grouped), Jan's visit list on
//   Bad debt, and a quiet footer (paid this week, needs a look, not chased, not due yet).
// W2 (job screen): a status strip with the ladder of follow-up steps, then three calm
//   columns: the job story, money and documents; the conversation with the suggested
//   message inline; notes.
//
// Reads:  debt_ws_overview, debt_ws_job, debt_ws_document, get_invoice_pdf,
//         debt_ws_statement_preview, debt_ws_jan_list.
// Writes: debt_ws_note (any staff), and owner only: debt_ws_decide (send, skip or dismiss),
//         debt_ws_set_category (a move card, Keep chasing, or Change beside the pill),
//         debt_ws_link_contact, debt_ws_statement_send, debt_ws_jan_list_remove. The backend runs every guard again; the screen only
//         disables what it already knows will be refused, and always says why.
//
// The tab is hidden until it is switched on: ?debt=1, localStorage.sw_debt_ws === '1',
// or the overview's settings.tab_visible. No emojis and no long dashes anywhere here
// (scripts/test-debt-workshop.js checks this file).
// ════════════════════════════════════════════════════════════

// <debt-workshop-core>
// Pure rules only: no DOM, no fetch. scripts/test-debt-workshop.js runs these in node.
var DebtWorkshopCore = (function () {
  // The five categories, in the order the legend shows them. Colours are from the approved plan.
  var CATS = [
    { key: 'active', name: 'Active', desc: 'Day 1 to 7, normal follow-ups', color: '#2E86C1' },
    { key: 'escalating', name: 'Escalating', desc: 'Day 8 to 20, getting firmer', color: '#E67E22' },
    { key: 'bad_debt', name: 'Bad debt', desc: 'Day 21 and on, a site visit', color: '#C0392B' },
    { key: 'says_paid', name: 'Says paid', desc: 'Says paid, not in Xero yet', color: '#16A3A1' },
    { key: 'rectification', name: 'Rectification', desc: 'Something to fix first', color: '#7B5EA7' },
  ];
  var FILTERS = [
    { key: 'all', label: 'All jobs' },
    { key: 'fencing', label: 'Fencing' },
    { key: 'patio', label: 'Patio' },
    { key: 'insurance', label: 'Insurance' },
  ];
  var BADGES = {
    fencing: { label: 'FENCING', cls: 'f', color: '#3B6E8F' },
    patio: { label: 'PATIO', cls: 'p', color: '#B5651D' },
    insurance: { label: 'INSURANCE', cls: 'i', color: '#5E5E8F' },
    other: { label: 'OTHER', cls: 'o', color: '#8FA4B2' },
  };
  // Follow-up steps (spec section 4). The backend's own labels win when it sends them.
  var STEPS = {
    d1: { day: 1, label: 'Day 1 text' },
    d3: { day: 3, label: 'Day 3 text' },
    d7: { day: 7, label: 'Day 7 text + call' },
    d12: { day: 12, label: 'Day 12 text' },
    d17: { day: 17, label: 'Day 17 final text' },
    d21: { day: 21, label: 'Jan\'s visit list' },
    // Replies the agent writes to something the client said (not on the ladder).
    reply_says_paid: { label: 'Reply: says paid' },
    reply_promise: { label: 'Reply: promise to pay' },
    reply_problem: { label: 'Reply: problem raised' },
  };
  // Job types that sit on the account (company) side: insurance work.
  var ACCOUNT_TYPES = ['makesafe', 'make_safe', 'repair', 'roof_report', 'roof', 'insurance'];
  var SENDING_OFF_WORDS = 'Sending is off until you switch it on';
  // Refusals in plain words (spec section 1). The code itself is never shown. Every key is a
  // code ops-api really throws (debt_ws_actions.ts); scripts/test-debt-workshop.js checks it.
  var REFUSALS = {
    sending_off: SENDING_OFF_WORDS + '.',
    not_owner: 'Only an owner can do this.',
    possible_payment: 'There may already be a payment for this in the bank feed. Match it in Xero first, or send anyway.',
    part_paid: 'This invoice has been part paid since the message was written. Read the job again before sending.',
    paid: 'Xero shows this invoice as paid now, so nothing was sent.',
    not_open: 'Xero no longer shows this invoice as open, so nothing was sent.',
    amount_required: 'The message did not say which amount it was written for. Read the job again before sending.',
    already_sent: 'This was already sent, so it was not sent again.',
    step_not_due: 'That step is not due now. Read the job again.',
    payer_not_linked: 'The person who owes this has no GoHighLevel contact linked. Link theirs first.',
    contact_belongs_to_other_payer: 'That GoHighLevel contact belongs to someone else on this job. Pick the contact of the person who owes this.',
    payer_not_on_job: 'This person has no contact row on the job, so there is nowhere to link them. Add them to the job\'s contacts first.',
    job_mismatch: 'That invoice is not on this job. Read the job again.',
    send_refused_by_guard: 'The text was stopped before it went, so nothing was sent.',
    send_not_confirmed: 'The send could not be confirmed. Check the GoHighLevel conversation before trying again; it will not send twice.',
    not_chased_by_text: 'This invoice is not chased by text.',
    xero_unavailable: 'Xero could not be read for the last check, so nothing was sent. Try again shortly.',
    xero_rate_limited: 'Xero is busy right now, so nothing was sent. Try again shortly.',
    bank_check_unavailable: 'The bank feed could not be read, so nothing was sent. Try again shortly.',
    suggestion_not_pending: 'This suggestion has already been dealt with. Read the job again.',
    suggestion_mismatch: 'This suggestion belongs to another invoice. Read the job again.',
    text_not_allowed: 'Take out the long dash or emoji before sending.',
    no_email: 'No accounts email is set for this company.',
    nothing_due: 'Nothing on this statement is past due any more.',
    email_failed: 'The email was refused, so nothing was sent.',
    jan_list_closed: 'This week\'s visit list has already gone to Jan, so it cannot change now.',
    jan_list_changed: 'The visit list changed while you were looking. Read it again.',
    contact_already_linked: 'This person already has a different contact linked.',
    no_job: 'This invoice has no job, so there is no card to move.',
    not_in_book: 'This invoice is not in the debt list any more. Read the list again.',
    not_found: 'That could not be found any more. Read the job again.',
  };

  function num(n) { var v = Number(n); return isFinite(v) ? v : 0; }
  function cents(n) { return Math.round(num(n) * 100); }
  function money(n) { return '$' + num(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n) { return '$' + Math.round(num(n)).toLocaleString('en-AU'); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function perthDate(now) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now || new Date());
    var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
    return o.year + '-' + o.month + '-' + o.day;
  }
  function dayNum(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null;
  }
  // "Fri 17 Oct" for an ISO date; the calendar date as written, never shifted by a time zone.
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateWords(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }
  // A moment (ISO date-time) as its Perth calendar date.
  function perthDay(iso) {
    if (!iso) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return String(iso);
    var t = Date.parse(iso); return isFinite(t) ? perthDate(new Date(t)) : '';
  }
  // "7:02am" in Perth.
  function perthTime(iso) {
    var t = Date.parse(iso || ''); if (!isFinite(t)) return '';
    var p = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(t));
    var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
    return o.hour + ':' + o.minute + String(o.dayPeriod || '').toLowerCase().replace(/[^a-z]/g, '');
  }
  // "today", "tomorrow", or "on Fri 17 Oct", counted on the Perth calendar.
  function whenWords(iso, today) {
    var d = dayNum(iso), t = dayNum(today);
    if (d === null) return '';
    if (t !== null && d === t) return 'today';
    if (t !== null && d === t + 1) return 'tomorrow';
    return 'on ' + dateWords(iso);
  }
  function dayLabel(iso, today) {
    var d = dayNum(iso), t = dayNum(today);
    if (d !== null && t !== null && d === t) return 'Today';
    if (d !== null && t !== null && d === t - 1) return 'Yesterday';
    return dateWords(iso);
  }

  function catByKey(key) { for (var i = 0; i < CATS.length; i++) if (CATS[i].key === key) return CATS[i]; return null; }
  function catRank(key) { for (var i = 0; i < CATS.length; i++) if (CATS[i].key === key) return i; return CATS.length; }

  // Which job type filter a row belongs to. The account lane is always Insurance.
  function typeKey(row) {
    if (!row) return 'other';
    if (row.lane === 'account') return 'insurance';
    var t = String(row.job_type || '').toLowerCase();
    if (t === 'fencing' || t === 'fence') return 'fencing';
    if (t === 'patio' || t === 'patios') return 'patio';
    if (ACCOUNT_TYPES.indexOf(t) >= 0) return 'insurance';
    return 'other';
  }
  function badge(key) { return BADGES[key] || BADGES.other; }

  function isReplyStep(step) { return /^reply_/.test(String(step || '')); }
  // A promise to pay holds while its date is still ahead (the backend's pausedUntil > today).
  function isPaused(row, today) {
    var p = row ? dayNum(row.paused_until) : null, t = dayNum(today);
    return p !== null && t !== null && p > t;
  }
  // The amount a draft was written for. It goes with every send so the backend can catch a part payment.
  function draftAmount(sug, row) {
    var a = num(sug && sug.amount);
    if (a > 0) return a;
    a = num(row && row.amount_due);
    return a > 0 ? a : null;
  }

  function stepLabel(step, kind) {
    if (step === 'd21' && kind === 'progress') return 'Hold, no more steps';
    return STEPS[step] ? STEPS[step].label : String(step || '');
  }
  function kindWord(kind) {
    return { final: 'Final', progress: 'Progress', account: 'Account', deposit: 'Deposit', go_ahead: 'Go-ahead' }[kind] || 'Invoice';
  }

  // A step is ready to act on when the backend says one is due (a draft always exists for a
  // due step: the template when the agent has not written one), or an agent suggestion waits.
  // Day 21 is not a message: finals go onto Jan's visit list, progress payments hold.
  function isReady(row) {
    if (!row) return false;
    if (row.step_due && row.step_due.step !== 'd21') return true;
    return !!(row.suggestion && row.suggestion.status === 'pending');
  }

  // The "next step" words on a list row. tone: ready (orange), quiet (grey) or plain.
  function nextStep(row, today) {
    if (!row) return { text: '', tone: 'quiet' };
    if (row.category === 'says_paid') return { text: 'Says paid, checking Xero', tone: 'quiet' };
    if (row.category === 'rectification') return { text: 'Waiting on the fix', tone: 'quiet' };
    var due = row.step_due;
    if (due && due.step !== 'd21') return { text: (due.label || stepLabel(due.step, row.kind)) + ' ready', tone: 'ready' };
    if (row.suggestion && row.suggestion.status === 'pending') return { text: 'Suggestion ready', tone: 'ready' };
    if (row.on_jan_list) return { text: 'On Jan\'s visit list', tone: 'plain' };
    if (due && due.step === 'd21') return { text: stepLabel('d21', row.kind), tone: 'plain' };
    if (isPaused(row, today)) return { text: 'Paused until ' + dateWords(row.paused_until), tone: 'quiet' };
    if (row.next_step && row.next_step.step) return { text: stepLabel(row.next_step.step, row.kind) + ' ' + whenWords(row.next_step.date, today), tone: 'plain' };
    return { text: 'Nothing due', tone: 'quiet' };
  }
  function dayText(row) {
    var d = row ? Number(row.day) : NaN;
    if (!isFinite(d)) return '';
    return d > 0 ? 'day ' + d : 'not due yet';
  }

  // Statement status words for a company row.
  function statementWords(company) {
    var s = (company && company.statement) || {};
    switch (s.status) {
      case 'ready': return { text: 'Statement ready', tone: 'ready' };
      case 'sent': return { text: 'Statement sent this week', tone: 'quiet' };
      case 'no_email': return { text: 'No accounts email set', tone: 'warn' };
      case 'nothing_due': return { text: 'Nothing past due', tone: 'quiet' };
      default: return { text: 'Statement not ready', tone: 'quiet' };
    }
  }
  // Can the statement be approved from here? Always says why not.
  function statementGate(company, settings) {
    var st = (company && company.statement && company.statement.status) || '';
    settings = settings || {};
    if (st === 'sent') return { ok: false, reason: 'Sent this week' };
    if (st === 'nothing_due') return { ok: false, reason: 'Nothing past due' };
    if (st === 'no_email') return { ok: false, reason: 'No accounts email set' };
    if (!settings.sending_on) return { ok: false, reason: SENDING_OFF_WORDS };
    if (!settings.viewer_is_owner) return { ok: false, reason: 'Only an owner can approve' };
    if (st !== 'ready') return { ok: false, reason: 'Not ready yet' };
    return { ok: true, reason: '' };
  }

  // Everything the list can show for one job type filter. Homeowner invoices are one item
  // each; companies are one item each (their invoices are grouped on the statement), so an
  // account-lane invoice row is only shown alone when the backend sends no companies.
  function items(ov, jt) {
    ov = ov || {}; jt = jt || 'all';
    var out = [], companies = Array.isArray(ov.companies) ? ov.companies : [];
    (ov.rows || []).forEach(function (r) {
      var t = typeKey(r);
      if (t === 'insurance' && companies.length) return;
      if (jt !== 'all' && t !== jt) return;
      out.push({ type: 'row', id: String(r.xero_invoice_id || r.share_key || ''), category: r.category || null, amount: num(r.amount_due), count: 1, day: num(r.day), jt: t, row: r });
    });
    if (jt === 'all' || jt === 'insurance') {
      companies.forEach(function (c) {
        var pd = c.past_due || {};
        out.push({ type: 'company', id: 'company:' + String(c.company_key || c.name || ''), category: c.category || null, amount: num(pd.amount), count: num(pd.count), day: num(pd.oldest_days), jt: 'insurance', company: c });
      });
    }
    return out;
  }
  // Category totals from the same items the list shows, so the donut always matches the list.
  function totals(list) {
    var res = { all: { count: 0, amount: 0 } }, c = {};
    CATS.forEach(function (k) { c[k.key] = { n: 0, c: 0 }; });
    (list || []).forEach(function (i) {
      if (!c[i.category]) return; // not due yet, or no category: counted elsewhere, never in the donut
      c[i.category].n += i.count; c[i.category].c += cents(i.amount);
    });
    var allN = 0, allC = 0;
    CATS.forEach(function (k) { res[k.key] = { count: c[k.key].n, amount: c[k.key].c / 100 }; allN += c[k.key].n; allC += c[k.key].c; });
    res.all = { count: allN, amount: allC / 100 };
    return res;
  }
  // The first category with money in it, else Active.
  function defaultCategory(t) {
    for (var i = 0; i < CATS.length; i++) if (t && t[CATS[i].key] && t[CATS[i].key].count > 0) return CATS[i].key;
    return CATS[0].key;
  }
  // Ready drafts first, then the oldest, then the biggest. Companies by amount.
  function byWork(a, b) {
    var ra = a.type === 'row' && isReady(a.row) ? 0 : 1, rb = b.type === 'row' && isReady(b.row) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    if (a.type !== b.type) return a.type === 'row' ? -1 : 1;
    if (a.type === 'row' && b.day !== a.day) return b.day - a.day;
    return cents(b.amount) - cents(a.amount);
  }
  // The list for one category; with no category (Insurance, "all companies") every item,
  // the biggest past-due amounts first and those with nothing past due last.
  function listFor(list, cat) {
    var mine = (list || []).filter(function (i) { return cat ? i.category === cat : true; });
    return mine.sort(function (a, b) {
      if (!cat) {
        var na = a.category ? 0 : 1, nb = b.category ? 0 : 1; // nothing past due goes last
        if (na !== nb) return na - nb;
        if (a.type === 'company' && b.type === 'company') return cents(b.amount) - cents(a.amount);
      }
      return byWork(a, b);
    });
  }
  // Rows in the backend's list that are not due yet (no category), for the greyed footer list.
  function notDueRows(ov) { return ((ov && ov.rows) || []).filter(function (r) { return !r.category; }); }

  // Donut arcs as SVG circle dashes. R is the radius on a 200 x 200 view box.
  function donut(t, selected, R) {
    R = R || 78;
    var C = 2 * Math.PI * R, all = t && t.all ? cents(t.all.amount) : 0, off = 0, out = [];
    var live = CATS.filter(function (k) { return t && t[k.key] && cents(t[k.key].amount) > 0; });
    var gap = live.length > 1 ? 2 : 0;
    live.forEach(function (k) {
      var len = all ? cents(t[k.key].amount) / all * C : 0;
      var draw = Math.max(len - gap, 0);
      out.push({ key: k.key, color: k.color, on: k.key === selected, dash: draw.toFixed(2) + ' ' + (C - draw).toFixed(2), offset: (-off).toFixed(2), share: all ? cents(t[k.key].amount) / all : 0 });
      off += len;
    });
    return out;
  }

  // Can the suggested message be sent from here? Checked in the order the backend refuses.
  // ctx.who: the payer's first name. A linked neighbour on a shared fence is texted at their own contact.
  function sendGate(ctx) {
    ctx = ctx || {};
    var s = ctx.settings || {};
    var who = ctx.who ? ctx.who + '\'s' : 'their';
    if (!s.sending_on) return { ok: false, reason: SENDING_OFF_WORDS, code: 'sending_off' };
    if (!s.viewer_is_owner) return { ok: false, reason: 'Only an owner can send', code: 'not_owner' };
    if (ctx.channel !== 'email' && !ctx.linked) return { ok: false, reason: 'Link ' + who + ' contact first', code: 'payer_not_linked' };
    if (ctx.possible && ctx.possible.length) return { ok: false, reason: 'Possible payment found', code: 'possible_payment', override: true };
    return { ok: true, reason: '', code: '' };
  }

  // ── The payer: the person who owes THIS invoice (a neighbour on a shared fence) ──
  function firstName(name) { var n = String(name || '').trim().split(/\s+/)[0]; return n || ''; }
  // The payer from debt_ws_job's payer_contact; an older backend without it reads as the job's client.
  function payerOf(J) {
    J = J || {};
    var p = J.payer_contact, row = J.row || {}, job = J.job || {};
    if (p && typeof p === 'object') {
      return { name: String(p.name || row.payer_name || 'Unknown payer'), phone: p.phone || null, email: p.email || null, ghl_contact_id: p.ghl_contact_id || null, label: p.label || '', is_primary: p.is_primary !== false, known: true };
    }
    var cid = job.ghl_contact_id || (J.contact && J.contact.ghl_contact_id) || null;
    return { name: String(row.payer_name || job.client_name || 'Unknown payer'), phone: job.client_phone || null, email: null, ghl_contact_id: cid, label: '', is_primary: !row.neighbour_of, known: false };
  }
  // "Shared fence: Peter (B) owes $1,420.37 · Ashlea (A) paid", the payer's share first. Empty
  // when the job has one share only.
  function shareSummary(shares, payerLabel) {
    var list = Array.isArray(shares) ? shares.filter(function (s) { return s && typeof s === 'object'; }) : [];
    if (list.length < 2) return '';
    var mine = String(payerLabel || '');
    list = list.slice().sort(function (a, b) { return (String(a.label) === mine ? 0 : 1) - (String(b.label) === mine ? 0 : 1) || String(a.label).localeCompare(String(b.label)); });
    return 'Shared fence: ' + list.map(function (s) {
      var who = firstName(s.payer_name) || 'Unknown';
      var lab = s.label && s.label !== 'main' ? ' (' + s.label + ')' : '';
      var state = s.paid ? 'paid' : num(s.owing) > 0 ? 'owes ' + money(s.owing) : 'nothing owing';
      return who + lab + ' ' + state;
    }).join(' · ');
  }
  // A message the system has not filed on any job yet (backend: unplaced, this job one of the
  // jobs it could belong to, from the payer's own contact). Shown like any other, with a quiet label.
  function unplacedWords(m) {
    return m && m.unplaced === true ? 'not yet filed on a job' : '';
  }
  // "GHL: Vincent" when drafts greet the payer by their GoHighLevel first name and it differs
  // from the Xero name shown (Xero "Tuan Tran", GoHighLevel "Vincent Tran"). Empty otherwise.
  function ghlNameHint(J) {
    var p = J && J.payer_contact, row = (J && J.row) || {};
    if (!p || p.greeting_name_source !== 'ghl' || !p.greeting_name) return '';
    var shown = firstName(row.payer_name || p.name);
    return shown.toLowerCase() === String(p.greeting_name).toLowerCase() ? '' : 'GHL: ' + String(p.greeting_name);
  }
  // How a message names the other person it is with, on the whole job's thread.
  function partyWords(m) {
    if (!m || m.is_payer !== false || !m.party_name) return '';
    return String(m.party_name);
  }

  // A long dash, an en dash or an emoji has no place in a client message (spec rule 7).
  var BANNED_RE = new RegExp('[\\u2013\\u2014]|\\p{Extended_Pictographic}', 'u'); // built from escapes so this file holds no such character
  function hasBanned(text) { return BANNED_RE.test(String(text || '')); }

  // The refusal code from a rejected call or an ok:false answer, whatever shape it came in.
  function refusalCode(x) {
    if (!x) return '';
    var r = x.refusal && typeof x.refusal === 'object' ? x.refusal : null;
    var b = x.body && typeof x.body === 'object' ? x.body : null;
    var code = (r && r.code) || x.code || (b && (b.code || (b.refused && b.refused.code))) || (x.refused && x.refused.code) || '';
    if (!code && x.error && typeof x.error === 'object') code = x.error.code || '';
    if (!code && typeof x.message === 'string' && REFUSALS[x.message]) code = x.message;
    if (!code && typeof x.error === 'string' && REFUSALS[x.error]) code = x.error;
    return String(code || '');
  }
  // Plain words for a refusal. Known codes get the screen's own words; otherwise the
  // backend's reason. Never a bare code, never "[object Object]".
  function refusalText(x) {
    var code = refusalCode(x);
    if (REFUSALS[code]) return REFUSALS[code];
    var pick = function (v) { return typeof v === 'string' && v && v !== code && !/^[a-z_]+$/.test(v) ? v : ''; };
    var b = x && x.body && typeof x.body === 'object' ? x.body : {};
    var r = x && x.refusal && typeof x.refusal === 'object' ? x.refusal : {};
    var words = pick(r.reason) || pick(r.fact) || pick(x && x.reason) || pick(b.reason) || pick(x && x.error) || pick(b.error) || pick(x && x.message);
    if (/unknown action/i.test(words)) return 'This part is not switched on yet: the backend has not been deployed.';
    return words || 'That did not go through. Nothing was sent.';
  }
  // An answer that came back 200 but refused (ok:false, sent:false or refused).
  function answerRefused(res) { return !!res && (res.ok === false || res.sent === false || !!res.refused); }
  // An action that ops-api does not know yet: the backend part has not been deployed.
  // Only an unknown action counts; any other 400 or 404 is a real answer and is shown as one.
  function isNotDeployed(e) {
    if (!e) return false;
    var b = e.body && typeof e.body === 'object' ? e.body : {};
    if (e.code === 'unknown_action' || b.code === 'unknown_action') return true;
    return /unknown action/i.test(String(e.message || '')) || /unknown action/i.test(typeof b.error === 'string' ? b.error : '');
  }

  // A statement refused for possible payments, as lines: { invoice: 'INV-9301', words: '$1,332.10 on Mon 6 Oct from ...' }.
  // ops-api sends possible_payments: [{ xero_invoice_id, invoice_number, possible_payments: [...] }].
  function statementPossible(body) {
    body = body && typeof body === 'object' ? body : {};
    var out = [];
    (Array.isArray(body.possible_payments) ? body.possible_payments : []).forEach(function (i) {
      if (!i || typeof i !== 'object') return;
      var inv = String(i.invoice_number || i.number || '');
      if (!Array.isArray(i.possible_payments)) { out.push({ invoice: inv, words: paymentWords(i) }); return; } // a bare payment
      i.possible_payments.forEach(function (p) { out.push({ invoice: inv, words: paymentWords(p) }); });
    });
    return out;
  }

  // The tab is visible with ?debt=1, localStorage sw_debt_ws = '1', or tab_visible from the backend.
  function tabVisible(search, stored, settings) {
    if (/[?&]debt=1(&|$)/.test(String(search || ''))) return true;
    if (String(stored || '') === '1') return true;
    return !!(settings && settings.tab_visible);
  }

  // A possible payment in words: "$1,420.37 on Mon 6 Oct from C MORGAN".
  function paymentWords(p) {
    p = p || {};
    var amt = p.amount != null ? p.amount : p.total;
    var who = p.payer || p.payer_text || p.contact_name || p.reference || p.description || '';
    return [amt != null ? money(amt) : '', p.date ? 'on ' + dateWords(p.date) : '', who ? 'from ' + who : ''].filter(Boolean).join(' ');
  }

  // Conversation: oldest first (newest at the bottom), with a day line wherever the Perth day changes.
  function thread(conv, today) {
    var msgs = Array.isArray(conv) ? conv : (conv && Array.isArray(conv.messages) ? conv.messages : []);
    var at = function (m) { var t = Date.parse(String(m.occurred_at || m.at || '')); return isFinite(t) ? t : 0; };
    var sorted = msgs.slice().sort(function (a, b) { return at(a) - at(b); });
    var out = [], last = null;
    sorted.forEach(function (m) {
      var d = perthDay(m.occurred_at || m.at);
      if (d && d !== last) { out.push({ type: 'day', label: dayLabel(d, today) }); last = d; }
      out.push({ type: 'msg', m: m });
    });
    return out;
  }
  function channelWord(ch) { return { sms: 'text', email: 'email', call: 'call', note: 'staff note' }[ch] || String(ch || 'message'); }
  function duration(v) {
    if (v == null || v === '') return '';
    var s = Number(v); if (!isFinite(s)) return String(v);
    s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  // "Call out · 0:31 · no answer"
  function callTitle(m) {
    var dir = m.direction === 'outbound' ? 'Call out' : 'Call in';
    var st = String(m.call_status || '').replace(/_/g, ' ').toLowerCase();
    return [dir, duration(m.call_duration), st].filter(Boolean).join(' · ');
  }

  // Notes: a person's note reads normally; the screen's own records (a text sent, a skip,
  // a category change) are muted auto rows.
  var HUMAN_NOTES = ['note', 'call', 'promise'];
  function noteView(n) {
    n = n || {};
    var k = n.kind || 'note', step = n.step ? stepLabel(n.step) : '';
    var body = String(n.body || '');
    var meta = n.meta && typeof n.meta === 'object' ? n.meta : {};
    var text;
    switch (k) {
      case 'note': text = body; break;
      case 'call': text = body ? 'Call: ' + body : 'Call'; break;
      case 'promise': text = body || 'Promised to pay by ' + dateWords(meta.promise_date || n.promise_date || ''); break; // the backend writes the whole line
      case 'text_sent': text = (step ? step : 'Text') + ' sent'; break;
      case 'email_sent': text = (step ? step.replace(/ text/, ' email') : 'Email') + ' sent'; break;
      case 'skip': text = step ? step + ' skipped' : body || 'Skipped'; break;
      case 'statement_sent': text = 'Statement sent'; break;
      case 'jan_list': text = meta.removed ? 'Removed from Jan\'s visit list' : 'Put on Jan\'s visit list'; break;
      case 'link_contact': text = 'Contact linked'; break;
      case 'category_change': text = body || 'Category changed'; break; // e.g. "Moved to Says paid"
      case 'agent_flag': text = 'Agent flag' + (body ? ': ' + body : ''); break;
      case 'send_refused': text = 'Send refused' + (body ? ': ' + body : ''); break;
      default: text = body || k;
    }
    return { auto: HUMAN_NOTES.indexOf(k) < 0, text: text, who: n.created_by_name || '', at: n.created_at || '' };
  }

  // The ladder, with the invoice as the first done step. status: done | due | upcoming | skipped | not_applicable.
  function ladder(steps, invoiceDate) {
    var out = [];
    if (invoiceDate) out.push({ step: 'invoice', label: 'Invoice', status: 'done', when: dateWords(invoiceDate) });
    (steps || []).forEach(function (s) {
      var st = s.status || 'upcoming';
      var when = st === 'due' ? 'ready now' : st === 'skipped' ? 'skipped' : st === 'not_applicable' ? 'not needed' : dateWords(s.date);
      out.push({ step: s.step, label: s.label || stepLabel(s.step), status: st, when: when });
    });
    return out;
  }

  // The job story in a few plain lines: where it is now, what is in the way, and the last few things that happened.
  function storyLines(story, max) {
    max = max || 4;
    if (!story || typeof story !== 'object') return null;
    var now = story.now || {};
    var tl = Array.isArray(story.timeline) ? story.timeline.filter(function (t) { return t && t.what; }) : [];
    var recent = tl.slice(-max).map(function (t) { return { date: dateWords(t.date || perthDay(t.at)), what: String(t.what) }; });
    return {
      now: now.line ? String(now.line) : '',
      next: now.next && now.next.what ? String(now.next.what) : '',
      blockers: (Array.isArray(now.blockers) ? now.blockers : []).map(function (b) { return String((b && b.what) || ''); }).filter(Boolean),
      recent: recent,
      money: story.money && story.money.line ? String(story.money.line) : '',
      jobValue: story.money && story.money.job_value && story.money.job_value.amount != null ? num(story.money.job_value.amount) : null,
    };
  }
  // The money box: each invoice on the job, paid or owing, and the total still owing.
  function moneyRows(invoices) {
    var rows = [], owing = 0;
    (invoices || []).forEach(function (i) {
      var due = num(i.amount_due), paid = String(i.status || '').toUpperCase() === 'PAID' || due <= 0;
      owing += paid ? 0 : cents(due);
      rows.push({ label: kindWord(i.kind) + ' ' + String(i.number || i.invoice_number || ''), value: paid ? money(i.total) : money(due), paid: paid, owing: !paid });
    });
    return { rows: rows, owing: owing / 100 };
  }

  // A document's file kind for the little tile: PDF, IMG or DOC.
  function fileKind(mime, name) {
    var m = String(mime || '').toLowerCase(), n = String(name || '').toLowerCase();
    if (m.indexOf('pdf') >= 0 || /\.pdf$/.test(n)) return 'PDF';
    if (m.indexOf('image/') === 0 || /\.(png|jpe?g|gif|webp|heic)$/.test(n)) return 'IMG';
    return 'DOC';
  }

  return {
    CATS: CATS, FILTERS: FILTERS, BADGES: BADGES, STEPS: STEPS, REFUSALS: REFUSALS, SENDING_OFF_WORDS: SENDING_OFF_WORDS,
    num: num, money: money, money0: money0, plural: plural, perthDate: perthDate, dayNum: dayNum, dateWords: dateWords,
    perthDay: perthDay, perthTime: perthTime, whenWords: whenWords, dayLabel: dayLabel, catByKey: catByKey,
    typeKey: typeKey, badge: badge, stepLabel: stepLabel, kindWord: kindWord, isReady: isReady, nextStep: nextStep,
    dayText: dayText, statementWords: statementWords, statementGate: statementGate, items: items, totals: totals,
    defaultCategory: defaultCategory, listFor: listFor, notDueRows: notDueRows, donut: donut, sendGate: sendGate,
    hasBanned: hasBanned, refusalCode: refusalCode, refusalText: refusalText, answerRefused: answerRefused,
    isNotDeployed: isNotDeployed, tabVisible: tabVisible, paymentWords: paymentWords, thread: thread,
    channelWord: channelWord, duration: duration, callTitle: callTitle, noteView: noteView, ladder: ladder,
    storyLines: storyLines, moneyRows: moneyRows, fileKind: fileKind, isReplyStep: isReplyStep, isPaused: isPaused,
    draftAmount: draftAmount, statementPossible: statementPossible,
    firstName: firstName, payerOf: payerOf, shareSummary: shareSummary, partyWords: partyWords,
    unplacedWords: unplacedWords, ghlNameHint: ghlNameHint,
  };
})();
// </debt-workshop-core>

// ════════════════════════════════════════════════════════════
// SCREEN STATE
// gen / jobGen / janGen: a newer read supersedes an older one still in flight, so a slow
// answer never paints over a newer screen.
// ════════════════════════════════════════════════════════════
var DW = {
  gen: 0, ov: null, ovErr: null, loading: false,
  jt: 'all', cat: null, // on Insurance, cat null means "all companies"
  view: 'list', // 'list' (W1) or 'job' (W2)
  jobGen: 0, jobId: null, job: null, jobErr: null, nav: [], navFrom: null,
  janGen: 0, jan: null, janErr: null, janLoading: false,
  busy: null, refusal: null, rowMsg: {},
  editing: false, why: false, drafts: {}, open: {}, noteText: '', promise: '', scrollThread: false,
  modalUrl: null, modalGen: 0, modalCompany: null, bound: false, focus: null,
  janLoaded: false, janMsg: null, noteMsg: null, catMenu: false, stmtPossible: {},
  convAll: false, // the job screen shows the payer's own messages; true: the whole job's thread
};

function dwEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
// showToast does not escape, so every toast goes through dwEsc.
function dwToast(msg, type) { if (typeof showToast === 'function') showToast(dwEsc(msg), type); }
function dwSettings() { return (DW.ov && DW.ov.settings) || (DW.job && DW.job.settings) || {}; }
function dwToday() { return (DW.ov && DW.ov.perth_date) || DebtWorkshopCore.perthDate(new Date()); }
function dwRoot() { return document.getElementById('debtWorkshopRoot'); }

// ── The nav buttons: hidden until the tab is switched on ──
function debtWsReveal(on) {
  document.querySelectorAll('[data-debt-nav]').forEach(function (b) { b.style.display = on ? '' : 'none'; });
}
function debtWsFlagOn() {
  var stored = null;
  try { stored = localStorage.getItem('sw_debt_ws'); } catch (e) {}
  return DebtWorkshopCore.tabVisible(window.location ? window.location.search : '', stored, null);
}
// Called once after login: the URL or browser flag shows the tab straight away; otherwise a
// quiet read of the overview decides. A failed read (not deployed yet, offline) shows nothing.
async function debtWsProbeVisibility() {
  if (debtWsFlagOn()) { debtWsReveal(true); return true; }
  try {
    var res = await opsFetch('debt_ws_overview');
    if (res && res.settings && res.settings.tab_visible) { if (!DW.ov) DW.ov = res; debtWsReveal(true); return true; }
  } catch (e) { /* not deployed yet or no access: the tab stays hidden */ }
  return false;
}

// ════════════════════════════════════════════════════════════
// STYLES (injected once; every rule scoped under #viewDebt or the modal)
// ════════════════════════════════════════════════════════════
function dwCss() {
  if (document.getElementById('dw-css')) return;
  var s = document.createElement('style'); s.id = 'dw-css';
  s.textContent = [
    '#viewDebt,.dw-modal{--dw-or:var(--sw-orange,#F15A29);--dw-orh:var(--sw-orange-hover,#C4481F);--dw-ort:var(--sw-orange-tint,#FDF2EE);--dw-dark:var(--sw-dark,#293C46);--dw-deep:var(--sw-dark-deep,#1A272E);--dw-mid:var(--sw-mid,#4C6A7C);--dw-midl:var(--sw-mid-light,#8FA4B2);--dw-line:var(--sw-border,#D4DEE4);--dw-soft:#E8EDF0;--dw-faint:#F1F4F6;--dw-warm:var(--sw-warm-200,#F0ECE8);--dw-sage:var(--sw-sage-deep,#4A7259);--dw-saget:var(--sw-sage-tint,#E7EFE8);--dw-red:#B03A2E;--dw-purple:#7B5EA7;--dw-r:var(--sw-radius-sm,3px);font-family:var(--sw-font,"Helvetica Neue",Helvetica,Arial,sans-serif)}',
    '.dw{display:grid;grid-template-columns:minmax(0,1fr);gap:20px;color:var(--dw-deep);font-variant-numeric:tabular-nums;max-width:1280px;margin:0 auto}',
    '.dw *,.dw-modal *{box-sizing:border-box}.dw>*{min-width:0}',
    '.dw button,.dw-modal button{font-family:inherit}',
    '.dw-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap}',
    '.dw-title{font-size:26px;font-weight:700;letter-spacing:-.02em;color:var(--dw-dark);margin:0;line-height:1.1}',
    '.dw-sub{font-size:12.5px;color:var(--dw-midl);margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.dw-state{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:100px;background:var(--dw-warm);color:var(--dw-mid);font-weight:600;font-size:11.5px}',
    '.dw-state.on{background:var(--dw-saget);color:var(--dw-sage)}',
    '.dw-state i{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block}',
    '.dw-filters{display:flex;gap:6px;flex-wrap:wrap}',
    '#viewDebt .dw-chip{border:1px solid var(--dw-line);background:#fff;padding:6px 14px;border-radius:100px;font-size:12.5px;font-weight:600;color:var(--dw-mid);cursor:pointer;line-height:1.3}',
    '#viewDebt .dw-chip:hover{border-color:var(--dw-mid)}',
    '#viewDebt .dw-chip.on{background:var(--dw-dark);border-color:var(--dw-dark);color:#fff}',
    '.dw-card{background:#fff;border:1px solid var(--dw-soft);border-radius:var(--dw-r);box-shadow:var(--sw-shadow,0 1px 3px rgba(41,60,70,.06))}',
    // W1: donut and legend
    '.dw-ov{display:grid;grid-template-columns:240px minmax(0,1fr);gap:36px;align-items:center;padding:26px 30px}',
    '.dw-donut{position:relative;width:220px;height:220px;margin:0 auto}',
    '.dw-donut svg{width:100%;height:100%;transform:rotate(-90deg);display:block}',
    '.dw-donut circle.seg{cursor:pointer;transition:stroke-width .15s,opacity .15s}',
    '.dw-donut circle.seg:hover{opacity:1 !important}',
    '.dw-mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;text-align:center}',
    '.dw-mid b{font-size:27px;font-weight:700;letter-spacing:-.02em;color:var(--dw-dark);line-height:1.05}',
    '.dw-mid span{font-size:10.5px;color:var(--dw-midl);text-transform:uppercase;letter-spacing:.08em;margin-top:5px}',
    '.dw-legend{display:grid;gap:4px;min-width:0}',
    '#viewDebt .dw-lg{display:grid;grid-template-columns:10px minmax(0,1fr) auto auto;gap:16px;align-items:center;padding:11px 14px;border:1px solid transparent;border-radius:var(--dw-r);background:none;text-align:left;cursor:pointer;color:inherit;width:100%;font-size:13px}',
    '#viewDebt .dw-lg:hover{background:var(--dw-faint)}',
    '#viewDebt .dw-lg.zero{opacity:.5}#viewDebt .dw-lg.zero.on{opacity:1}',
    '#viewDebt .dw-lg.on{border-color:var(--dw-dark);background:#fff;box-shadow:inset 0 0 0 1px var(--dw-dark)}',
    '.dw-dot{display:inline-block;width:10px;height:10px;border-radius:50%;flex:none}',
    '.dw-lg .nm{font-weight:700;font-size:13.5px;display:block}.dw-lg .ds{font-size:12px;color:var(--dw-midl);display:block;margin-top:1px}',
    '.dw-lg .ct{font-size:12.5px;color:var(--dw-mid);white-space:nowrap}.dw-lg .am{font-weight:700;white-space:nowrap;min-width:96px;text-align:right;font-size:14px}',
    // W1: the list
    '.dw-list-h{display:flex;justify-content:space-between;align-items:baseline;gap:6px 14px;padding:18px 22px 12px;flex-wrap:wrap}',
    '.dw-list-h h2{font-size:16px;font-weight:700;display:flex;gap:9px;align-items:center;margin:0;color:var(--dw-dark)}',
    '.dw-list-h .m{font-size:12.5px;color:var(--dw-midl)}',
    '#viewDebt .dw-row{display:grid;grid-template-columns:minmax(0,2.3fr) 92px 112px minmax(0,1.5fr) 14px;grid-template-areas:"main day amt nx chev";gap:16px;align-items:center;padding:14px 22px;border:0;border-top:1px solid var(--dw-faint);cursor:pointer;background:none;width:100%;text-align:left;color:inherit;font-size:13px}',
    '#viewDebt .dw-row:hover{background:#FBF8F5}',
    '#viewDebt .dw-row:focus-visible{outline:2px solid var(--dw-or);outline-offset:-2px}',
    '.dw-row .main{grid-area:main;min-width:0}.dw-row .dw-day{grid-area:day}.dw-row .dw-amt{grid-area:amt}.dw-row .dw-nx{grid-area:nx}.dw-row .dw-chev{grid-area:chev}',
    '.dw-nm{font-weight:700;font-size:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--dw-deep)}',
    '.dw-nm small{font-weight:400;font-size:12.5px;color:var(--dw-mid)}',
    '.dw-rs{font-size:12px;color:var(--dw-midl);margin-top:3px}',
    '.dw-flagm{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#8A5A12}',
    '.dw-flagm i{width:6px;height:6px;border-radius:50%;background:#D9922E;display:inline-block}',
    '.dw-day{font-size:12.5px;color:var(--dw-mid);white-space:nowrap}',
    '.dw-amt{font-weight:700;text-align:right;font-size:14px;white-space:nowrap}',
    '.dw-nx{font-size:12.5px;font-weight:600;color:var(--dw-dark)}',
    '.dw-nx.ready{color:var(--dw-or)}.dw-nx.quiet{color:var(--dw-midl);font-weight:500}.dw-nx.warn{color:#A8641A}',
    '.dw-chev{color:#B8C4CC;display:flex;align-items:center}',
    '.dw-jt{display:inline-block;font-size:9.5px;font-weight:700;letter-spacing:.06em;padding:2px 6px;border-radius:2px;color:#fff;line-height:1.4}',
    '.dw-jt.f{background:#3B6E8F}.dw-jt.p{background:#B5651D}.dw-jt.i{background:#5E5E8F}.dw-jt.o{background:#8FA4B2}',
    // Company rows (Insurance)
    '.dw-co{display:grid;grid-template-columns:minmax(0,2.3fr) 92px 112px minmax(0,1.5fr);grid-template-areas:"main day amt act";gap:16px;align-items:center;padding:14px 22px;border-top:1px solid var(--dw-faint)}',
    '.dw-co .main{grid-area:main;min-width:0;cursor:pointer}.dw-co .dw-day{grid-area:day}.dw-co .dw-amt{grid-area:amt}.dw-co .act{grid-area:act;display:flex;flex-direction:column;align-items:flex-end;gap:6px}',
    '.dw-co .btns{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}',
    '.dw-co .why{font-size:11.5px;color:var(--dw-midl);text-align:right}',
    '.dw-co .msg{grid-column:1 / -1}',
    // Jan's visit list
    '.dw-jan{padding:18px 22px 8px}',
    '.dw-jan-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px 16px;flex-wrap:wrap;margin-bottom:6px}',
    '.dw-jan-h h3{margin:0;font-size:15px;font-weight:700;color:var(--dw-dark)}',
    '.dw-jan-h .m{font-size:12.5px;color:var(--dw-mid)}',
    '.dw-jan-p{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:4px 16px;align-items:center;padding:11px 0;border-top:1px solid var(--dw-faint);font-size:13px}',
    '.dw-jan-p .who{font-weight:700}.dw-jan-p .where{font-size:12px;color:var(--dw-mid);margin-top:2px}.dw-jan-p .hist{font-size:12px;color:var(--dw-midl);margin-top:2px}',
    // Footer
    '.dw-foot{display:flex;gap:10px 26px;flex-wrap:wrap;font-size:12.5px;color:var(--dw-mid);padding:0 4px}',
    '.dw-foot b{color:var(--dw-dark)}.dw-foot .paid b{color:var(--dw-sage)}.dw-foot .grey,.dw-foot .grey b{color:var(--dw-midl);font-weight:500}',
    '#viewDebt .dw-link,.dw-modal .dw-link{background:none;border:0;padding:0;font-size:12.5px;color:var(--dw-mid);text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
    '#viewDebt .dw-link:hover,.dw-modal .dw-link:hover{color:var(--dw-orh)}',
    '#viewDebt .dw-link:disabled{opacity:.45;cursor:not-allowed;text-decoration:none}',
    // Buttons
    '#viewDebt .dw-btn,.dw-modal .dw-btn{border:1px solid var(--dw-or);background:var(--dw-or);color:#fff;padding:8px 15px;font-size:13px;font-weight:700;border-radius:var(--dw-r);cursor:pointer;line-height:1.3;white-space:nowrap}',
    '#viewDebt .dw-btn:hover:not(:disabled),.dw-modal .dw-btn:hover:not(:disabled){background:var(--dw-orh);border-color:var(--dw-orh)}',
    '#viewDebt .dw-btn.g,.dw-modal .dw-btn.g{background:#fff;color:var(--dw-dark);border-color:var(--dw-line);font-weight:600}',
    '#viewDebt .dw-btn.g:hover:not(:disabled),.dw-modal .dw-btn.g:hover:not(:disabled){background:var(--dw-faint);border-color:var(--dw-mid)}',
    '#viewDebt .dw-btn.p{background:var(--dw-purple);border-color:var(--dw-purple)}#viewDebt .dw-btn.p:hover:not(:disabled){background:#664A92;border-color:#664A92}',
    '#viewDebt .dw-btn.sm,.dw-modal .dw-btn.sm{padding:5px 11px;font-size:12px}',
    '#viewDebt .dw-btn:disabled,.dw-modal .dw-btn:disabled{background:var(--dw-faint);color:var(--dw-midl);border-color:var(--dw-soft);cursor:not-allowed;font-weight:600;white-space:normal;text-align:left}',
    // W2: crumbs, strip, ladder
    '.dw-crumb{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}',
    '#viewDebt .dw-nav{display:inline-flex;align-items:center;gap:6px;background:none;border:0;padding:4px 0;font-size:13px;font-weight:600;color:var(--dw-mid);cursor:pointer}',
    '#viewDebt .dw-nav:hover:not(:disabled){color:var(--dw-dark)}#viewDebt .dw-nav:disabled{opacity:.4;cursor:default}',
    '.dw-crumb .pos{font-size:12.5px;color:var(--dw-midl);margin:0 12px}',
    '.dw-strip{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:24px 26px 12px}',
    '.dw-strip h2{font-size:23px;font-weight:700;letter-spacing:-.015em;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0;color:var(--dw-dark)}',
    '.dw-strip h2 small{font-size:14px;font-weight:400;color:var(--dw-mid);letter-spacing:0}',
    '.dw-strip .sub{font-size:13px;color:var(--dw-mid);margin-top:6px}',
    '.dw-pill{display:inline-flex;align-items:center;font-size:11.5px;font-weight:700;padding:3px 11px;border-radius:100px;color:#fff;white-space:nowrap;letter-spacing:.01em}',
    '.dw-pill.none{background:var(--dw-faint);color:var(--dw-mid)}.dw-pill.paid{background:var(--dw-sage)}',
    // The quiet "Change" menu beside the category pill
    '.dw-catm{position:relative;display:inline-flex;align-items:center}',
    '#viewDebt .dw-chg{font-weight:500;letter-spacing:0}',
    '.dw-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:20;display:flex;flex-direction:column;min-width:200px;padding:4px 0;background:#fff;border:1px solid var(--dw-line);border-radius:var(--dw-r);box-shadow:0 8px 22px rgba(26,39,46,.13)}',
    '#viewDebt .dw-menu button{background:none;border:0;text-align:left;padding:9px 14px;font-size:13px;font-weight:500;letter-spacing:0;color:var(--dw-deep);cursor:pointer;white-space:nowrap}',
    '#viewDebt .dw-menu button:hover,#viewDebt .dw-menu button:focus-visible{background:var(--dw-faint);outline:0}',
    '.dw-confirm{padding:18px;font-size:13.5px;line-height:1.5;color:var(--dw-deep)}',
    '.dw-owing{text-align:right}.dw-owing b{font-size:32px;font-weight:700;letter-spacing:-.02em;display:block;line-height:1;color:var(--dw-dark)}.dw-owing span{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--dw-midl)}',
    '.dw-paused{font-size:12.5px;color:var(--dw-mid);margin-top:6px}',
    '.dw-ladder{display:flex;align-items:flex-start;padding:10px 26px 22px;overflow-x:auto;border-bottom:1px solid var(--dw-soft)}',
    '.dw-stp{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:88px;font-size:11px;color:var(--dw-midl);text-align:center;flex:none}',
    '.dw-stp .b{width:22px;height:22px;border-radius:50%;border:2px solid #CBD5DB;background:#fff;display:flex;align-items:center;justify-content:center;color:#fff}',
    '.dw-stp.done .b{background:var(--dw-sage);border-color:var(--dw-sage)}',
    '.dw-stp.due .b{background:var(--dw-or);border-color:var(--dw-or);box-shadow:0 0 0 4px var(--dw-ort)}',
    '.dw-stp.due{color:var(--dw-or);font-weight:600}.dw-stp.skipped .b{border-style:dashed}.dw-stp.not_applicable{opacity:.45}',
    '.dw-stp b.t{color:var(--dw-dark);font-weight:600;font-size:11.5px}',
    '.dw-bar{flex:1 1 auto;height:2px;background:#DCE3E8;min-width:14px;margin-top:11px}.dw-bar.done{background:var(--dw-sage)}',
    // W2: three columns
    '.dw-ws{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr) minmax(0,1fr)}',
    '.dw-ws>section{padding:22px 24px;min-width:0}',
    '.dw-ws>section+section{border-left:1px solid var(--dw-soft)}',
    '.dw-h{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--dw-mid);margin:0 0 12px;display:flex;justify-content:space-between;align-items:center;gap:8px}',
    '.dw-h span{text-transform:none;letter-spacing:0;font-weight:500;color:var(--dw-midl);font-size:12px}',
    '.dw-story p{font-size:13.5px;line-height:1.55;margin:0 0 10px;color:var(--dw-deep)}',
    '.dw-story .next{color:var(--dw-mid)}.dw-story .blk{color:#A8641A}',
    '.dw-recent{list-style:none;margin:2px 0 18px;padding:0;font-size:12.5px;color:var(--dw-mid);display:grid;gap:5px}',
    '.dw-recent li{display:grid;grid-template-columns:76px minmax(0,1fr);gap:8px}.dw-recent span{color:var(--dw-midl)}',
    '.dw-money{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;font-size:13px;padding:13px 15px;background:#F6F8F9;border-radius:var(--dw-r);margin:0 0 22px}',
    '.dw-money .paid{color:var(--dw-sage)}.dw-money .owe{color:var(--dw-red);font-weight:700}.dw-money .lbl{color:var(--dw-mid)}',
    '.dw-money .tot{border-top:1px solid var(--dw-line);padding-top:7px;font-weight:700}',
    '#viewDebt .dw-doc{display:flex;align-items:center;gap:11px;width:100%;padding:8px 10px;border:1px solid var(--dw-soft);background:#fff;border-radius:var(--dw-r);margin-bottom:6px;cursor:pointer;text-align:left;color:inherit}',
    '#viewDebt .dw-doc:hover{border-color:#BFCBD3;background:#FBFCFC}',
    '.dw-doc .ic{width:30px;height:36px;border-radius:2px;background:#FBEBE7;color:#B3321E;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;letter-spacing:.04em}',
    '.dw-doc .ic.IMG{background:#E8F1FA;color:#1F6FA8}.dw-doc .ic.DOC{background:var(--dw-faint);color:var(--dw-mid)}',
    '.dw-doc .n{font-weight:600;font-size:12.5px;display:block}.dw-doc .m{font-size:11.5px;color:var(--dw-midl);display:block;margin-top:1px}',
    // W2: conversation
    '.dw-thread{display:flex;flex-direction:column;gap:8px;max-height:540px;overflow-y:auto;padding:2px 6px 4px 0}',
    '.dw-dayl{text-align:center;font-size:10.5px;color:var(--dw-midl);text-transform:uppercase;letter-spacing:.07em;margin:8px 0 2px}',
    '.dw-msg{max-width:84%;padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.dw-msg .meta{display:block;font-size:10.5px;color:var(--dw-midl);margin-bottom:3px;white-space:normal}',
    '.dw-msg.in{background:#F1F3F5;border-bottom-left-radius:4px;align-self:flex-start}',
    '.dw-msg.out{background:#FDEFE9;border-bottom-right-radius:4px;align-self:flex-end}',
    '.dw-msg.call{max-width:100%;align-self:stretch;background:#fff;border:1px solid var(--dw-soft);border-radius:var(--dw-r);white-space:normal}',
    '.dw-msg.call .tr{white-space:pre-wrap;margin-top:6px;font-size:12.5px;color:var(--dw-mid);border-top:1px solid var(--dw-faint);padding-top:6px}',
    '.dw-msg.note{max-width:100%;align-self:stretch;background:#FBFAF6;border:1px dashed var(--dw-line);border-radius:var(--dw-r);color:var(--dw-mid);font-size:12.5px}',
    '.dw-msg .subj{font-weight:700;display:block;white-space:normal}',
    '.dw-msg .dw-link{font-size:11.5px;margin-top:4px;display:inline-block}',
    '.dw-quiet{font-size:13px;color:var(--dw-midl);padding:8px 0}',
    // Shared fences: the share line under the header, the whole-thread toggle, other people's messages
    '.dw-shares{font-size:12.5px;color:var(--dw-mid);margin-top:5px}',
    '#viewDebt .dw-convt{font-size:12px;margin-top:6px;display:inline-block}',
    '.dw-msg.other{opacity:.72}.dw-msg.in.other{background:#F6F7F8}.dw-msg.out.other{background:#FBF4F1}',
    // A message not yet filed on a job, and the payer's GoHighLevel first name when it differs from Xero's
    '.dw-msg .dw-unpl{display:block;font-size:10px;color:var(--dw-midl);margin-top:4px;font-style:italic;white-space:normal}',
    '.dw-strip h2 small.dw-ghlname{font-weight:400;color:var(--dw-midl)}',
    // W2: agent notices, the suggestion, the move card, the link card
    '.dw-notice{margin-top:12px;border:1px solid #EBD9BC;background:#FFF9EF;border-radius:10px;padding:11px 14px;font-size:13px;line-height:1.45;color:#4F3A16}',
    '.dw-notice .top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}',
    '.dw-notice .w{font-size:12px;color:#8A6A3A;margin-top:3px}',
    '.dw-notice .d{font-size:11px;color:#A8906A;margin-top:4px}',
    '.dw-sug{margin-top:16px;border:1.5px dashed var(--dw-or);border-radius:12px;padding:15px 16px;background:#FFFBF9}',
    '.dw-lab{font-size:10.5px;font-weight:700;color:var(--dw-or);text-transform:uppercase;letter-spacing:.08em;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}',
    '.dw-lab .src{color:var(--dw-midl);font-weight:600;text-transform:none;letter-spacing:0;font-size:11.5px}',
    '.dw-txt{font-size:13.5px;line-height:1.5;margin:10px 0 4px;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.dw-sug textarea,.dw-note-in{width:100%;border:1px solid var(--dw-line);border-radius:var(--dw-r);padding:9px 11px;font:inherit;font-size:13.5px;line-height:1.5;background:#fff;resize:vertical;color:var(--dw-deep)}',
    '.dw-sug textarea{min-height:170px;margin:10px 0 4px}',
    '.dw-sug textarea:focus,.dw-note-in:focus,.dw-note-row input:focus{outline:0;border-color:var(--dw-or)}',
    '.dw-acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}',
    '.dw-acts .spacer{flex:1}',
    '.dw-gate{font-size:12px;color:var(--dw-midl);margin-top:8px}',
    '.dw-why{font-size:12.5px;color:var(--dw-mid);background:#fff;border-left:2px solid var(--dw-or);padding:7px 11px;margin-top:10px;line-height:1.45}',
    '.dw-warn{margin-top:12px;padding:11px 13px;background:#FBEEDB;border-radius:var(--dw-r);color:#6E4510;font-size:12.5px;line-height:1.5}',
    '.dw-warn b{display:block;margin-bottom:2px;color:#5A380B}',
    '.dw-refuse{margin-top:12px;padding:10px 13px;background:#FBEBE7;color:#8E2B1E;border-radius:var(--dw-r);font-size:12.5px;line-height:1.45}',
    '.dw-move{margin-top:16px;border:1.5px solid var(--dw-purple);border-radius:12px;padding:15px 16px;background:#F8F5FC}',
    '.dw-move .dw-lab{color:var(--dw-purple)}',
    '.dw-move p{font-size:13px;line-height:1.5;margin:8px 0}',
    '.dw-reply{background:#fff;border:1px solid #DCCFEE;border-radius:10px;padding:10px 12px;font-size:13px;white-space:pre-wrap;margin:10px 0 2px;line-height:1.45}',
    '.dw-reply .dw-lab{margin-bottom:6px;white-space:normal}',
    '.dw-flag{margin-top:16px;border:1px solid var(--dw-line);border-radius:12px;padding:14px 16px;background:#fff;font-size:13px;line-height:1.5}',
    '.dw-linkc{margin-top:16px;border:1px solid var(--dw-line);border-radius:12px;padding:14px 16px;background:#fff}',
    '.dw-linkc .dw-lab{color:var(--dw-dark)}',
    '.dw-linkc p{font-size:13px;margin:6px 0 4px;color:var(--dw-mid);line-height:1.45}',
    '.dw-cand{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--dw-faint);font-size:13px}',
    '.dw-cand .d{font-size:12px;color:var(--dw-midl);margin-top:1px}',
    '.dw-nothing{margin-top:16px;padding:14px 16px;border-radius:12px;background:var(--dw-faint);font-size:13px;color:var(--dw-mid);line-height:1.5}',
    // W2: notes
    '.dw-note-in{min-height:84px}',
    '.dw-note-row{display:flex;gap:8px 10px;align-items:center;justify-content:space-between;margin:8px 0 16px;flex-wrap:wrap}',
    '.dw-note-row label{font-size:12px;color:var(--dw-mid);display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
    '.dw-note-row input{border:1px solid var(--dw-line);border-radius:var(--dw-r);padding:5px 7px;font:inherit;font-size:12.5px;color:var(--dw-deep)}',
    '.dw-note{padding:11px 0;border-top:1px solid var(--dw-faint);font-size:13px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.dw-note .m{font-size:11px;color:var(--dw-midl);margin-bottom:2px;white-space:normal}',
    '.dw-note.auto{color:var(--dw-midl);font-size:12px}',
    // Empty, error and loading states
    '.dw-empty{padding:30px 22px;color:var(--dw-midl);font-size:13.5px;text-align:center;line-height:1.5}',
    '.dw-calm{padding:56px 28px;text-align:center;line-height:1.55}.dw-calm h2{margin:0 0 6px;font-size:18px;color:var(--dw-dark)}.dw-calm p{margin:0 auto 14px;max-width:520px;font-size:13.5px;color:var(--dw-mid)}',
    '.dw-err{padding:14px 18px;background:#FBEBE7;color:#8E2B1E;font-size:13px;border-radius:var(--dw-r);line-height:1.5}',
    '.dw-sk{display:block;background:linear-gradient(90deg,#EEF1F3 25%,#F6F8F9 50%,#EEF1F3 75%);background-size:200% 100%;animation:dwsk 1.2s ease-in-out infinite;border-radius:3px}',
    '@keyframes dwsk{0%{background-position:200% 0}100%{background-position:-200% 0}}',
    '@media (prefers-reduced-motion: reduce){.dw-sk{animation:none}}',
    // Modal
    '.dw-modal{position:fixed;inset:0;background:rgba(26,39,46,.55);display:flex;align-items:center;justify-content:center;z-index:3000;padding:20px}',
    '.dw-sheet{background:#fff;width:min(900px,100%);max-height:calc(100vh - 40px);display:flex;flex-direction:column;border-radius:6px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.3);color:var(--dw-deep)}',
    '.dw-sheet.sm{width:min(580px,100%)}',
    '.dw-sheet .hd{padding:13px 18px;border-bottom:1px solid var(--dw-soft);display:flex;justify-content:space-between;align-items:center;gap:10px;font-weight:700;font-size:14px}',
    '.dw-sheet .bd{flex:1 1 auto;overflow:auto;min-height:0}',
    '.dw-sheet iframe{width:100%;height:72vh;border:0;display:block;background:#F6F8F9}',
    '.dw-sheet img{max-width:100%;display:block;margin:0 auto}',
    '.dw-sheet .ft{padding:12px 18px;border-top:1px solid var(--dw-soft);display:flex;justify-content:flex-end;gap:10px;align-items:center;flex-wrap:wrap}',
    '.dw-sheet .ft .why{font-size:12px;color:var(--dw-midl);margin-right:auto}',
    '.dw-sheet .to{padding:10px 18px;font-size:12.5px;color:var(--dw-mid);background:#F6F8F9;border-bottom:1px solid var(--dw-soft)}',
    '.dw-mlist{list-style:none;margin:0;padding:6px 18px 12px}',
    '.dw-mlist li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 14px;padding:10px 0;border-top:1px solid var(--dw-faint);font-size:13px}',
    '.dw-mlist li:first-child{border-top:0}.dw-mlist .d{font-size:12px;color:var(--dw-midl)}.dw-mlist .a{font-weight:700;text-align:right;white-space:nowrap}',
    '.dw-mlist.grey li{color:var(--dw-mid)}',
    // Phone and small screens: the columns stack under 900px, the list rows fold under 640px
    '@media (max-width:900px){.dw-ov{grid-template-columns:1fr;justify-items:center;gap:20px;padding:22px 16px}.dw-donut{width:176px;height:176px}.dw-mid b{font-size:22px}.dw-legend{width:100%}',
    '.dw-ws{grid-template-columns:1fr}.dw-ws>section+section{border-left:0;border-top:1px solid var(--dw-soft)}.dw-ws>section{padding:18px 16px}',
    '.dw-strip{grid-template-columns:1fr;padding:20px 16px 10px}.dw-owing{text-align:left}.dw-ladder{padding:8px 16px 18px}.dw-thread{max-height:440px}}',
    '@media (max-width:640px){.dw-title{font-size:22px}.dw-head{align-items:flex-start}',
    '#viewDebt .dw-row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"main amt" "nx day";gap:6px 12px;padding:13px 16px}.dw-row .dw-chev{display:none}.dw-row .dw-day{text-align:right}',
    '.dw-co{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"main amt" "day day" "act act";gap:6px 12px;padding:13px 16px}.dw-co .act{align-items:flex-start}.dw-co .btns{justify-content:flex-start}.dw-co .why{text-align:left}',
    '#viewDebt .dw-lg{gap:10px;padding:10px 10px}.dw-lg .am{min-width:0}.dw-list-h{padding:16px 16px 10px}.dw-jan{padding:16px 16px 6px}.dw-strip h2{font-size:20px}.dw-owing b{font-size:27px}.dw-msg{max-width:92%}.dw-sheet iframe{height:64vh}}',
  ].join('\n');
  document.head.appendChild(s);
}

// ════════════════════════════════════════════════════════════
// SMALL PIECES
// ════════════════════════════════════════════════════════════
var DW_IC = {
  right: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>',
  left: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 5"/></svg>',
};
var DW_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dwSk(w, h, extra) { return '<span class="dw-sk" style="width:' + w + ';height:' + h + 'px;' + (extra || '') + '"></span>'; }
function dwBadgeHtml(key) { var b = DebtWorkshopCore.badge(key); return '<span class="dw-jt ' + b.cls + '">' + dwEsc(b.label) + '</span>'; }
function dwDis(cond) { return cond ? ' disabled aria-disabled="true"' : ''; }
// "Casey Morgan" or "Riley Shaw (neighbour of Taylor Brooks)", the neighbour part quieter.
function dwPayerHtml(row) {
  row = row || {};
  var label = String(row.payer_label || row.payer_name || 'Unknown payer');
  var m = /^(.*?)\s*\((neighbour of [^)]*)\)\s*$/.exec(label);
  if (row.neighbour_of) return dwEsc(row.payer_name || (m ? m[1] : label)) + ' <small>(neighbour of ' + dwEsc(row.neighbour_of) + ')</small>';
  if (m) return dwEsc(m[1]) + ' <small>(' + dwEsc(m[2]) + ')</small>';
  return dwEsc(label);
}
function dwFailHtml(what, e, act) {
  if (DebtWorkshopCore.isNotDeployed(e)) {
    return '<div class="dw-calm" data-dw-state="not-deployed"><h2>Not switched on yet</h2><p>' + dwEsc(what) + ' is not live yet: the backend part has not been deployed. Nothing is guessed in its place.</p></div>';
  }
  return '<div class="dw-calm" data-dw-state="error"><h2>Could not read ' + dwEsc(String(what).toLowerCase()) + '</h2><p>' + dwEsc((e && e.message) || 'Something went wrong.') + '</p>' + (act ? '<button type="button" class="dw-btn g" data-dw="' + act + '">Read again</button>' : '') + '</div>';
}
// One post, with an ok:false answer turned into a thrown refusal so every caller handles both alike.
async function dwPost(action, body) {
  var res = await opsPost(action, body);
  if (DebtWorkshopCore.answerRefused(res)) {
    var e = new Error((res && (res.reason || (typeof res.error === 'string' ? res.error : ''))) || '');
    e.code = DebtWorkshopCore.refusalCode(res); e.body = res;
    throw e;
  }
  return res;
}

// ════════════════════════════════════════════════════════════
// LOAD
// ════════════════════════════════════════════════════════════
// showView('debt') calls this.
function loadDebtWorkshop() {
  dwCss(); dwBind();
  if (!dwRoot()) return;
  if (DW.view === 'job' && DW.jobId) { dwRender(); dwLoadJob(true); dwLoadOverview(true); return; }
  dwLoadOverview(!!DW.ov); // a probe may already have read it: show that, refresh underneath
}
async function dwLoadOverview(quiet) {
  var gen = ++DW.gen;
  if (!quiet || !DW.ov) DW.loading = true;
  if (DW.view === 'list') dwRender();
  var res = null, err = null;
  try { res = await opsFetch('debt_ws_overview'); } catch (e) { err = e; }
  if (gen !== DW.gen) return; // a newer read superseded this one
  DW.loading = false;
  if (err) {
    if (!quiet || !DW.ov) { DW.ov = null; DW.ovErr = err; } // a failed quiet refresh keeps what is on screen
  } else {
    DW.ov = res || {}; DW.ovErr = null;
    if (DW.ov.settings && DW.ov.settings.tab_visible) debtWsReveal(true);
    DW.janLoaded = false; // Jan's list is read again next time Bad debt shows
  }
  if (DW.view === 'list') dwRender();
}
async function dwLoadJan() {
  var g = ++DW.janGen; DW.janLoading = true;
  try {
    var r = await opsFetch('debt_ws_jan_list');
    if (g !== DW.janGen) return;
    DW.jan = r || {}; DW.janErr = null;
  } catch (e) {
    if (g !== DW.janGen) return;
    DW.jan = null; DW.janErr = e;
  }
  DW.janLoading = false; DW.janLoaded = true;
  if (DW.view === 'list') dwRender();
}
function dwOpenJob(id) {
  var cur = dwCurrent();
  DW.nav = DebtWorkshopCore.listFor(cur.items, cur.cat).filter(function (i) { return i.type === 'row'; }).map(function (i) { return i.id; });
  if (DW.nav.indexOf(id) < 0) DW.nav = [id];
  DW.navFrom = { cat: cur.cat, jt: DW.jt };
  dwShowJob(id);
}
function dwShowJob(id) {
  DW.view = 'job'; DW.jobId = id; DW.job = null; DW.jobErr = null;
  DW.editing = false; DW.why = false; DW.refusal = null; DW.noteText = ''; DW.promise = ''; DW.noteMsg = null; DW.open = {}; DW.catMenu = false; DW.convAll = false;
  dwRender();
  try { window.scrollTo(0, 0); } catch (e) {}
  dwLoadJob(false);
}
async function dwLoadJob(quiet) {
  var g = ++DW.jobGen, id = DW.jobId;
  try {
    var q = { xero_invoice_id: id };
    if (DW.convAll) q.conversation = 'all'; // the whole job's thread, each message marked by whose it is
    var r = await opsFetch('debt_ws_job', q);
    if (g !== DW.jobGen || id !== DW.jobId) return;
    DW.job = r || {}; DW.jobErr = null; DW.scrollThread = true;
  } catch (e) {
    if (g !== DW.jobGen || id !== DW.jobId) return;
    if (!quiet || !DW.job) { DW.job = null; DW.jobErr = e; }
  }
  if (DW.view === 'job') dwRender();
}

// The items, totals and category for the current filter.
function dwCurrent() {
  var C = DebtWorkshopCore, its = C.items(DW.ov, DW.jt), t = C.totals(its);
  var cat = DW.cat;
  if (DW.jt !== 'insurance' && !cat) cat = C.defaultCategory(t);
  return { items: its, totals: t, cat: cat };
}

// ════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════
function dwRender() {
  var root = dwRoot(); if (!root) return;
  var th = document.getElementById('dwThread'), prev = th ? th.scrollTop : null;
  root.innerHTML = DW.view === 'job' ? dwJobHtml() : dwListHtml();
  var nt = document.getElementById('dwThread');
  if (nt) {
    if (DW.scrollThread || prev === null) { nt.scrollTop = nt.scrollHeight; DW.scrollThread = false; } // newest at the bottom
    else nt.scrollTop = prev;
  }
  // On a narrow screen the ladder scrolls sideways: bring the step that is due into view.
  var lad = document.getElementById('dwLadder'), due = lad && lad.querySelector('.dw-stp.due');
  if (lad && due && lad.scrollWidth > lad.clientWidth) { var lr = lad.getBoundingClientRect(), dr = due.getBoundingClientRect(); lad.scrollLeft = Math.max(0, lad.scrollLeft + dr.left - lr.left - lad.clientWidth / 2 + dr.width / 2); }
  if (DW.focus) { var f = root.querySelector(DW.focus); DW.focus = null; if (f) { f.focus(); if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length); } }
}

// ── W1: the overview ──
function dwListSkeleton() {
  var legend = '', rows = '';
  for (var i = 0; i < 5; i++) legend += '<div style="display:flex;gap:14px;align-items:center;padding:12px 14px">' + dwSk('10px', 10, 'border-radius:50%') + '<span style="flex:1">' + dwSk('40%', 12) + '</span>' + dwSk('80px', 12) + '</div>';
  for (var j = 0; j < 5; j++) rows += '<div style="display:flex;gap:16px;align-items:center;padding:16px 22px;border-top:1px solid #F1F4F6"><span style="flex:2">' + dwSk('55%', 13) + dwSk('35%', 10, 'margin-top:7px') + '</span>' + dwSk('60px', 12) + dwSk('80px', 13) + '<span style="flex:1.4">' + dwSk('70%', 12) + '</span></div>';
  return '<div class="dw dw-loading" aria-busy="true"><div class="dw-head"><div><h1 class="dw-title">Debt</h1><div class="dw-sub">' + dwSk('160px', 11) + '</div></div></div>' +
    '<div class="dw-card dw-ov"><div class="dw-donut">' + dwSk('100%', 220, 'border-radius:50%;max-width:220px') + '</div><div class="dw-legend">' + legend + '</div></div>' +
    '<div class="dw-card"><div class="dw-list-h">' + dwSk('140px', 15) + '</div>' + rows + '</div></div>';
}
function dwListHtml() {
  var C = DebtWorkshopCore;
  if (!DW.ov && (DW.loading || !DW.ovErr)) return dwListSkeleton();
  if (!DW.ov) return '<div class="dw"><div class="dw-head"><div><h1 class="dw-title">Debt</h1></div></div><div class="dw-card">' + dwFailHtml('The Debt Workshop', DW.ovErr, 'reload') + '</div></div>';
  var ov = DW.ov, s = ov.settings || {}, cur = dwCurrent(), today = dwToday();
  var filter = C.FILTERS.filter(function (f) { return f.key === DW.jt; })[0] || C.FILTERS[0];

  var head = '<div class="dw-head"><div><h1 class="dw-title">Debt</h1><div class="dw-sub">' +
    (ov.read_at ? '<span>Read ' + dwEsc(C.perthTime(ov.read_at)) + '</span>' : '') +
    '<span class="dw-state' + (s.sending_on ? ' on' : '') + '" id="dwSendingState"><i></i>' + (s.sending_on ? 'Sending on' : 'Sending off') + '</span>' +
    (s.agent_on ? '<span class="dw-state on"><i></i>Agent on</span>' : '') +
    (DW.loading ? '<span>Refreshing</span>' : '') +
    '</div></div><div class="dw-filters" role="group" aria-label="Job type">' +
    C.FILTERS.map(function (f) { return '<button type="button" class="dw-chip' + (f.key === DW.jt ? ' on' : '') + '" data-dw="jt" data-k="' + f.key + '" aria-pressed="' + (f.key === DW.jt) + '">' + dwEsc(f.label) + '</button>'; }).join('') +
    '</div></div>';

  // Donut and legend
  var t = cur.totals, segs = C.donut(t, cur.cat, 78);
  var svg = '<svg viewBox="0 0 200 200" role="img" aria-label="Money owed by category"><circle cx="100" cy="100" r="78" fill="none" stroke="#EEF1F3" stroke-width="26"></circle>' +
    segs.map(function (g) {
      var cat = C.catByKey(g.key);
      return '<circle class="seg" data-dw="cat" data-k="' + g.key + '" cx="100" cy="100" r="78" fill="none" stroke="' + g.color + '" stroke-width="' + (g.on ? 34 : 26) + '" stroke-dasharray="' + g.dash + '" stroke-dashoffset="' + g.offset + '" style="opacity:' + (g.on || !cur.cat ? 1 : 0.78) + '"><title>' + dwEsc(cat.name + ' ' + C.money(t[g.key].amount)) + '</title></circle>';
    }).join('') + '</svg>';
  var donut = '<div class="dw-donut" id="dwDonut">' + svg + '<div class="dw-mid"><b id="dwTotal">' + dwEsc(C.money0(t.all.amount)) + '</b><span>owed, ' + dwEsc(DW.jt === 'all' ? 'all jobs' : filter.label.toLowerCase()) + '</span></div></div>';
  var legend = '<div class="dw-legend" id="dwLegend">' + C.CATS.map(function (c) {
    var on = c.key === cur.cat, n = t[c.key].count;
    return '<button type="button" class="dw-lg' + (on ? ' on' : '') + (n ? '' : ' zero') + '" data-dw="cat" data-k="' + c.key + '" aria-pressed="' + on + '"><span class="dw-dot" style="background:' + c.color + '"></span><span><span class="nm">' + dwEsc(c.name) + '</span><span class="ds">' + dwEsc(c.desc) + '</span></span><span class="ct">' + dwEsc(C.plural(n, 'invoice', 'invoices')) + '</span><span class="am">' + dwEsc(C.money(t[c.key].amount)) + '</span></button>';
  }).join('') + '</div>';
  var ovCard = '<div class="dw-card dw-ov">' + donut + legend + '</div>';

  var jan = cur.cat === 'bad_debt' && DW.jt !== 'insurance' ? dwJanHtml() : '';
  return '<div class="dw">' + head + ovCard + jan + dwListCardHtml(cur, s, today) + dwFootHtml(ov) + '</div>';
}

function dwListCardHtml(cur, s, today) {
  var C = DebtWorkshopCore, list = C.listFor(cur.items, cur.cat), insurance = DW.jt === 'insurance';
  var hasCompanies = Array.isArray(DW.ov.companies) && DW.ov.companies.length > 0;
  var cat = C.catByKey(cur.cat), title, meta;
  if (insurance && !cat) {
    title = hasCompanies ? 'Company statements' : 'Insurance';
    meta = C.plural(list.length, hasCompanies ? 'company' : 'invoice', hasCompanies ? 'companies' : 'invoices') + ', statements go every Monday';
  } else {
    var tt = cur.totals[cur.cat] || { count: 0, amount: 0 };
    title = '<span class="dw-dot" style="background:' + cat.color + '"></span>' + dwEsc(cat.name);
    meta = C.plural(tt.count, 'invoice', 'invoices') + ' · ' + C.money(tt.amount) + ' · ' + cat.desc;
  }
  var allLink = insurance && cat ? ' <button type="button" class="dw-link" data-dw="cats-all">Show all companies</button>' : '';
  var body;
  if (!list.length) {
    var empty = {
      active: 'Nothing in Active right now.',
      escalating: 'Nothing escalating right now.',
      bad_debt: 'No bad debt right now.',
      says_paid: 'Nobody right now. When a client says they have paid and Xero does not show it yet, they land here and the follow-ups pause.',
      rectification: 'Nothing waiting on a fix.',
    }[cur.cat] || 'Nothing here for this filter.';
    body = '<div class="dw-empty">' + dwEsc(insurance && !cat ? 'No company owes anything right now.' : empty) + '</div>';
  } else {
    body = list.map(function (it) {
      if (it.type === 'company') return insurance ? dwCompanyActHtml(it, s) : dwCompanyRowHtml(it);
      return dwRowHtml(it, today);
    }).join('');
  }
  return '<div class="dw-card" id="dwList"><div class="dw-list-h"><h2 id="dwListTitle">' + (insurance && !cat ? dwEsc(title) : title) + '</h2><span class="m">' + dwEsc(meta) + allLink + '</span></div>' + body + '</div>';
}

function dwRowHtml(it, today) {
  var C = DebtWorkshopCore, r = it.row, nx = C.nextStep(r, today);
  var sub = [r.invoice_number, r.kind === 'progress' ? 'progress payment' : r.kind === 'final' ? 'final invoice' : '', r.job_number].filter(Boolean).map(dwEsc).join(' · ');
  if (r.ghl_linked === false) sub += ' · no GHL contact';
  var flags = Number(r.flag_count) > 0 ? ' <span class="dw-flagm" title="The agent has left a notice on this job"><i></i>' + dwEsc(C.plural(Number(r.flag_count), 'notice', 'notices')) + '</span>' : '';
  return '<div class="dw-row" role="button" tabindex="0" data-dw="open" data-k="' + dwEsc(it.id) + '">' +
    '<span class="main"><span class="dw-nm">' + dwPayerHtml(r) + ' ' + dwBadgeHtml(it.jt) + '</span><span class="dw-rs" style="display:block">' + sub + flags + '</span></span>' +
    '<span class="dw-day">' + dwEsc(C.dayText(r)) + '</span><span class="dw-amt">' + dwEsc(C.money(r.amount_due)) + '</span>' +
    '<span class="dw-nx ' + nx.tone + '">' + dwEsc(nx.text) + '</span><span class="dw-chev">' + DW_IC.right + '</span></div>';
}
function dwCompanySub(c) {
  var C = DebtWorkshopCore, pd = c.past_due || {}, ig = c.in_grace || {}, n = Number(pd.count) || 0, g = Number(ig.count) || 0;
  return [n ? C.plural(n, 'invoice', 'invoices') + ' past due' : 'Nothing past due', g ? C.plural(g, 'invoice', 'invoices') + ' not due yet' : '', 'weekly statement'].filter(Boolean).join(' · ');
}
function dwOldest(c) { var d = Number(c.past_due && c.past_due.oldest_days); return d > 0 ? 'oldest ' + d + ' days' : ''; }
// On All jobs a company is one quiet row; clicking it opens its statement.
function dwCompanyRowHtml(it) {
  var C = DebtWorkshopCore, c = it.company, sw = C.statementWords(c);
  return '<div class="dw-row" role="button" tabindex="0" data-dw="company" data-k="' + dwEsc(c.company_key) + '">' +
    '<span class="main"><span class="dw-nm">' + dwEsc(c.name) + ' ' + dwBadgeHtml('insurance') + '</span><span class="dw-rs" style="display:block">' + dwEsc(dwCompanySub(c)) + '</span></span>' +
    '<span class="dw-day">' + dwEsc(dwOldest(c)) + '</span><span class="dw-amt">' + dwEsc(C.money(it.amount)) + '</span>' +
    '<span class="dw-nx ' + sw.tone + '">' + dwEsc(sw.text) + '</span><span class="dw-chev">' + DW_IC.right + '</span></div>';
}
// On Insurance each company carries its statement status, Preview and Approve.
function dwCompanyActHtml(it, s) {
  var C = DebtWorkshopCore, c = it.company, sw = C.statementWords(c), gate = C.statementGate(c, s), key = String(c.company_key || '');
  var busy = DW.busy === 'approve:' + key, msg = DW.rowMsg[key];
  return '<div class="dw-co" data-company="' + dwEsc(key) + '">' +
    '<div class="main" data-dw="preview" data-k="' + dwEsc(key) + '"><span class="dw-nm">' + dwEsc(c.name) + ' ' + dwBadgeHtml('insurance') + '</span><span class="dw-rs" style="display:block">' + dwEsc(dwCompanySub(c)) + '</span></div>' +
    '<span class="dw-day">' + dwEsc(dwOldest(c)) + '</span><span class="dw-amt">' + dwEsc(C.money(it.amount)) + '</span>' +
    '<div class="act"><span class="dw-nx ' + sw.tone + '">' + dwEsc(sw.text) + '</span><div class="btns">' +
    '<button type="button" class="dw-btn g sm" data-dw="preview" data-k="' + dwEsc(key) + '">Preview</button>' +
    '<button type="button" class="dw-btn sm" data-dw="approve" data-k="' + dwEsc(key) + '"' + dwDis(!gate.ok || !!DW.busy) + (gate.ok ? '' : ' title="' + dwEsc(gate.reason) + '"') + '>' + (busy ? 'Sending...' : 'Approve') + '</button>' +
    '</div>' + (gate.ok || gate.reason === sw.text ? '' : '<span class="why">' + dwEsc(gate.reason) + '</span>') + '</div>' +
    (DW.stmtPossible[key] ? '<div class="msg">' + dwStatementPossibleHtml(key) + '</div>' : msg ? '<div class="msg dw-refuse">' + dwEsc(msg) + '</div>' : '') + '</div>';
}

// Jan's visit list (Bad debt): who Jan visits this week, with Remove for the owner.
function dwJanHtml() {
  var C = DebtWorkshopCore, ov = DW.ov || {}, sum = ov.jan_list || {}, J = DW.jan, s = ov.settings || {};
  if (!DW.janLoaded && !DW.janLoading) setTimeout(dwLoadJan, 0);
  var status = (J && J.status) || sum.status || '', visit = (J && J.visit_date) || sum.visit_date || '';
  var words = {
    open: 'Open. Locks Friday 9am, then goes to Jan Sunday 7pm.',
    locked: 'Locked. Goes to Jan Sunday 7pm.',
    sending: 'Sending to Jan now.',
    sent:'Sent to Jan' + (J && J.sent_at ? ' ' + C.dateWords(C.perthDay(J.sent_at)) + ' ' + C.perthTime(J.sent_at) : '') + '.',
    failed: 'Did not send' + (J && J.error ? ': ' + J.error : '') + '.',
    skipped: 'Not sent this week.',
  }[status] || '';
  var people = J && Array.isArray(J.items) ? J.items : null;
  var count = people ? people.length : Number(sum.count) || 0;
  // Remove works while the list is open or locked (locked is the snapshot Jan gets; a removal
  // edits it). Once it is sending or sent, or did not go, it cannot change (jan_list_closed).
  var frozen = ['sending', 'sent', 'failed', 'skipped'].indexOf(status) >= 0;
  var body;
  if (DW.janLoading && !J) body = '<div style="padding:10px 0">' + dwSk('60%', 12) + dwSk('40%', 10, 'margin-top:8px') + '</div>';
  else if (DW.janErr && !J) body = '<div class="dw-quiet">' + (C.isNotDeployed(DW.janErr) ? 'The visit list is not live yet.' : 'The visit list could not be read: ' + dwEsc(DW.janErr.message)) + '</div>';
  else if (!people || !people.length) body = '<div class="dw-quiet">Nobody on the list this week.</div>';
  else body = people.map(function (p) {
    var key = String(p.share_key || p.xero_invoice_id || '');
    var where = [p.site_address || p.address, p.phone].filter(Boolean).join(' · ');
    var busy = DW.busy === 'jan:' + key;
    var why = !s.viewer_is_owner ? 'Only an owner can remove' : frozen ? (status === 'sending' || status === 'sent' ? 'The list has gone to Jan' : 'This week\'s list is closed') : '';
    return '<div class="dw-jan-p" data-jan="' + dwEsc(key) + '"><div><div class="who">' + dwEsc(p.name || p.payer_label || p.payer_name || 'Unknown') + '</div>' +
      (where ? '<div class="where">' + dwEsc(where) + '</div>' : '') + (p.history ? '<div class="hist">' + dwEsc(p.history) + '</div>' : '') + '</div>' +
      '<span class="dw-amt">' + dwEsc(C.money(p.amount != null ? p.amount : p.amount_due)) + '</span>' +
      '<button type="button" class="dw-link" data-dw="jan-remove" data-k="' + dwEsc(key) + '"' + dwDis(!!why || !!DW.busy) + (why ? ' title="' + dwEsc(why) + '"' : '') + '>' + (busy ? 'Removing...' : 'Remove') + '</button></div>';
  }).join('');
  return '<div class="dw-card dw-jan" id="dwJan"><div class="dw-jan-h"><h3>Jan\'s visit list' + (visit ? ', ' + dwEsc(C.dateWords(visit)) : '') + '</h3><span class="m">' + dwEsc(C.plural(count, 'person', 'people')) + (words ? ' · ' + dwEsc(words) : '') + '</span></div>' +
    body + (DW.janMsg ? '<div class="dw-refuse">' + dwEsc(DW.janMsg) + '</div>' : '') + '</div>';
}

// The quiet footer: paid this week, needs a look, not chased, and not due yet (greyed).
function dwFootHtml(ov) {
  var C = DebtWorkshopCore, paid = ov.paid_this_week || {}, look = ov.needs_a_look || [], nc = ov.not_chased || [], nd = ov.not_due || {};
  var pn = Number(paid.count) || 0;
  var parts = [
    '<span class="paid" id="dwPaid">Paid this week: <b>' + dwEsc(C.money(paid.amount)) + '</b> from ' + dwEsc(C.plural(pn, 'invoice', 'invoices')) + (pn ? ' <button type="button" class="dw-link" data-dw="foot" data-k="paid">see who</button>' : '') + '</span>',
    '<span id="dwLook">' + (look.length ? 'Needs a look: <b>' + look.length + '</b> <button type="button" class="dw-link" data-dw="foot" data-k="look">open</button>' : 'Nothing needs a look') + '</span>',
    nc.length ? '<span id="dwNotChased">Not chased: <b>' + nc.length + '</b> <button type="button" class="dw-link" data-dw="foot" data-k="notchased">see</button></span>' : '',
    '<span class="grey" id="dwNotDue">Not due yet: <b>' + dwEsc(C.money(nd.amount)) + '</b> from ' + dwEsc(C.plural(Number(nd.count) || 0, 'invoice', 'invoices')) + (C.notDueRows(ov).length ? ' <button type="button" class="dw-link" data-dw="foot" data-k="notdue">see</button>' : '') + '</span>',
  ];
  return '<div class="dw-foot">' + parts.filter(Boolean).join('') + '</div>';
}
function dwFootModal(k) {
  var C = DebtWorkshopCore, ov = DW.ov || {}, li = [], title = '', grey = false;
  var line = function (name, detail, amount, attrs) { return '<li' + (attrs || '') + '><div><b>' + dwEsc(name) + '</b><div class="d">' + dwEsc(detail) + '</div></div><span class="a">' + dwEsc(amount) + '</span></li>'; };
  if (k === 'paid') {
    title = 'Paid this week';
    li = ((ov.paid_this_week || {}).items || []).map(function (p) { return line(p.payer_name || 'Unknown', [p.invoice_number, p.paid_on ? 'paid ' + C.dateWords(p.paid_on) : ''].filter(Boolean).join(' · '), C.money(p.amount)); });
  } else if (k === 'look') {
    title = 'Needs a look';
    li = (ov.needs_a_look || []).map(function (n) { return line(n.payer_name || 'Unknown', [n.invoice_number, n.reason].filter(Boolean).join(' · '), C.money(n.amount_due)); });
  } else if (k === 'notchased') {
    title = 'Not chased';
    li = (ov.not_chased || []).map(function (n) {
      if (typeof n === 'string') return line(n, 'In the totals, never chased or put on a statement', '');
      var amt = n.amount != null ? n.amount : n.amount_due;
      return line(n.name || n.payer_name || n.contact_name || 'Unknown', [n.count ? C.plural(Number(n.count), 'invoice', 'invoices') : n.invoice_number, 'never chased'].filter(Boolean).join(' · '), amt != null ? C.money(amt) : '');
    });
  } else if (k === 'notdue') {
    title = 'Not due yet'; grey = true;
    li = C.notDueRows(ov).map(function (r) { return line(r.payer_label || r.payer_name || 'Unknown', [r.invoice_number, r.due_date ? 'due ' + C.dateWords(r.due_date) : ''].filter(Boolean).join(' · '), C.money(r.amount_due)); });
  }
  dwModal({ title: title, size: 'sm', body: li.length ? '<ul class="dw-mlist' + (grey ? ' grey' : '') + '">' + li.join('') + '</ul>' : '<div class="dw-empty">Nothing to show.</div>' });
}

// ── W2: the job screen ──
function dwJobSkeleton() {
  var col = function (n) { var h = ''; for (var i = 0; i < n; i++) h += dwSk(i % 3 === 2 ? '55%' : '90%', 12, 'margin-bottom:10px'); return '<section>' + dwSk('70px', 10, 'margin-bottom:16px') + h + '</section>'; };
  return '<div class="dw-card dw-loading" aria-busy="true"><div class="dw-strip"><div>' + dwSk('240px', 22) + dwSk('320px', 12, 'margin-top:10px') + '</div>' + dwSk('120px', 30) + '</div>' +
    '<div class="dw-ladder">' + dwSk('100%', 30) + '</div><div class="dw-ws">' + col(6) + col(9) + col(5) + '</div></div>';
}
function dwCrumbHtml() {
  var C = DebtWorkshopCore, from = DW.navFrom || {}, cat = C.catByKey(from.cat);
  var back = cat ? cat.name : from.jt === 'insurance' ? 'Insurance' : 'Debt';
  var i = DW.nav.indexOf(DW.jobId), n = DW.nav.length;
  return '<div class="dw-crumb"><button type="button" class="dw-nav" data-dw="back" id="dwBack">' + DW_IC.left + ' Back to ' + dwEsc(back) + '</button>' +
    '<span>' + (n > 1 && i >= 0 ? '<span class="pos">' + (i + 1) + ' of ' + n + '</span>' : '') +
    '<button type="button" class="dw-nav" data-dw="next" id="dwNext"' + dwDis(!(i >= 0 && i < n - 1)) + '>Next ' + DW_IC.right + '</button></span></div>';
}
// The PAYER is linked in GoHighLevel (on a shared fence, the neighbour's own contact, not the job's).
function dwLinked(J) {
  var job = J.job || {}, row = J.row || {};
  if (J.payer_contact) return !!J.payer_contact.ghl_contact_id;
  return !!(job.ghl_contact_id || (J.contact && J.contact.ghl_contact_id) || (row.ghl_linked && !('ghl_contact_id' in job)));
}
// The payer can be texted from here once linked: a neighbour on a shared fence is texted at
// their own contact, and the backend checks it is on this job's contact list.
function dwCanText(J) {
  return dwLinked(J);
}
function dwJobHtml() {
  var C = DebtWorkshopCore, crumb = dwCrumbHtml();
  if (!DW.job && !DW.jobErr) return '<div class="dw">' + crumb + dwJobSkeleton() + '</div>';
  if (!DW.job) return '<div class="dw">' + crumb + '<div class="dw-card">' + dwFailHtml('This job', DW.jobErr, 'job-reload') + '</div></div>';
  var J = DW.job, row = J.row || {}, job = J.job || {}, today = dwToday();
  var cat = C.catByKey(row.category), tk = C.typeKey(row.lane || row.job_type ? row : { job_type: job.type });
  var paid = row.open === false; // Xero shows it paid: nothing to chase or change
  var pill = paid ? '<span class="dw-pill paid">Paid</span>'
    : cat ? '<span class="dw-pill" style="background:' + cat.color + '">' + dwEsc(cat.name + (Number(row.day) > 0 ? ' · day ' + row.day : '')) + '</span>'
    : '<span class="dw-pill none">Not due yet</span>';
  if (!paid) pill += dwCatMenuHtml(row);
  var site = job.site_address ? String(job.site_address) + (job.site_suburb && String(job.site_address).indexOf(job.site_suburb) < 0 ? ', ' + job.site_suburb : '') : '';
  var inv = row.invoice_number ? C.kindWord(row.kind) + ' invoice ' + row.invoice_number + (row.invoice_date ? ' sent ' + C.dateWords(row.invoice_date) : '') : '';
  var sub = [site, job.job_number || row.job_number, inv].filter(Boolean).map(dwEsc).join(' · ');
  var paused = C.isPaused(row, today) ? '<div class="dw-paused">Follow-ups paused until ' + dwEsc(C.dateWords(row.paused_until)) + ', a promise to pay.</div>' : '';
  var shareLine = C.shareSummary(job.shares, C.payerOf(J).label);
  var shares = shareLine ? '<div class="dw-shares" id="dwShares">' + dwEsc(shareLine) + '</div>' : '';
  var ghlHint = C.ghlNameHint(J), ghlName = ghlHint ? ' <small class="dw-ghlname" id="dwGhlName">(' + dwEsc(ghlHint) + ')</small>' : '';
  var strip = '<div class="dw-strip" id="dwStrip"><div><h2>' + dwPayerHtml(row) + ghlName + ' ' + dwBadgeHtml(tk) + ' ' + pill + '</h2><div class="sub">' + sub + '</div>' + shares + paused + '</div>' +
    '<div class="dw-owing"><b id="dwOwing">' + dwEsc(C.money(row.amount_due)) + '</b><span>owing</span></div></div>';
  var nodes = Array.isArray(J.ladder) && J.ladder.length ? C.ladder(J.ladder, row.invoice_date) : [];
  var ladder = nodes.length ? '<div class="dw-ladder" id="dwLadder">' + nodes.map(function (n, i) {
    return (i ? '<span class="dw-bar' + (n.status === 'done' ? ' done' : '') + '"></span>' : '') +
      '<div class="dw-stp ' + dwEsc(n.status) + '" data-step="' + dwEsc(n.step) + '"><span class="b">' + (n.status === 'done' ? DW_IC.check : '') + '</span><b class="t">' + dwEsc(n.label) + '</b>' + dwEsc(n.when) + '</div>';
  }).join('') + '</div>' : '';
  return '<div class="dw">' + crumb + '<div class="dw-card" id="dwJob">' + strip + ladder + '<div class="dw-ws">' +
    '<section id="dwLeft">' + dwLeftHtml(J) + '</section>' +
    '<section id="dwMiddle">' + dwMiddleHtml(J) + '</section>' +
    '<section id="dwRight">' + dwNotesHtml(J) + '</section></div></div></div>';
}

// "Change" beside the category pill: set or clear a category by hand, agent or not (owner only).
// Each choice posts debt_ws_set_category {xero_invoice_id, category} with no suggestion_id.
function dwCatMenuHtml(row) {
  var s = dwSettings(), owner = !!s.viewer_is_owner;
  var btn = '<button type="button" class="dw-link dw-chg" data-dw="cat-menu" id="dwCatChange" aria-haspopup="menu" aria-expanded="' + !!DW.catMenu + '"' +
    dwDis(!owner || !!DW.busy) + (owner ? '' : ' title="Only an owner can change the category"') + '>' + (String(DW.busy || '').indexOf('cat:') === 0 ? 'Saving...' : 'Change') + '</button>';
  if (!DW.catMenu || !owner) return '<span class="dw-catm">' + btn + '</span>';
  var says = row.category === 'says_paid' || !!row.says_paid_since, items = [];
  if (says) items.push(['clear', 'Clear says paid']);
  else items.push(['says_paid', 'Says paid']);
  if (row.category !== 'rectification') items.push(['rectification', 'Move to Rectification']);
  return '<span class="dw-catm">' + btn + '<span class="dw-menu" role="menu" id="dwCatMenu">' + items.map(function (it) {
    return '<button type="button" role="menuitem" data-dw="cat-set" data-k="' + it[0] + '">' + dwEsc(it[1]) + '</button>';
  }).join('') + '</span></span>';
}

// Left: the job story in a few lines, the money, then the documents.
function dwLeftHtml(J) {
  var C = DebtWorkshopCore, st = C.storyLines(J.story, 4), row = J.row || {};
  var story = '<div class="dw-h">Job story</div><div class="dw-story" id="dwStory">';
  if (st && (st.now || st.recent.length)) {
    if (st.now) story += '<p>' + dwEsc(st.now) + '</p>';
    if (st.next) story += '<p class="next">Next: ' + dwEsc(st.next) + '</p>';
    st.blockers.forEach(function (b) { story += '<p class="blk">' + dwEsc(b) + '</p>'; });
    if (st.recent.length) story += '<ul class="dw-recent">' + st.recent.map(function (r) { return '<li><span>' + dwEsc(r.date) + '</span><div>' + dwEsc(r.what) + '</div></li>'; }).join('') + '</ul>';
  } else {
    story += '<p class="dw-quiet">No job story yet' + (typeof J.story_status === 'string' && J.story_status && J.story_status !== 'ok' ? ' (' + dwEsc(J.story_status.replace(/_/g, ' ')) + ')' : '') + '.</p>';
  }
  story += '</div>';
  var mr = C.moneyRows(J.invoices), money = '<div class="dw-money" id="dwMoney">';
  if (st && st.jobValue != null) money += '<span class="lbl">Job value</span><b>' + dwEsc(C.money(st.jobValue)) + '</b>';
  mr.rows.forEach(function (r) { money += '<span class="lbl">' + dwEsc(r.label) + (r.paid ? ', paid' : '') + '</span><span class="' + (r.paid ? 'paid' : 'owe') + '">' + dwEsc(r.value) + '</span>'; });
  if (!mr.rows.length) money += '<span class="lbl">This invoice</span><span class="owe">' + dwEsc(C.money(row.amount_due)) + '</span>';
  else money += '<span class="lbl tot">Owing on this job</span><span class="tot">' + dwEsc(C.money(mr.owing)) + '</span>';
  money += '</div>';
  var docs = '';
  (J.invoices || []).forEach(function (i) {
    var num = i.number || i.invoice_number; // ops-api sends number
    var id = i.xero_invoice_id || i.id || (num && num === row.invoice_number ? row.xero_invoice_id : null);
    if (!id) return;
    var paid = String(i.status || '').toUpperCase() === 'PAID' || Number(i.amount_due) <= 0;
    var part = !paid && C.num(i.amount_due) !== C.num(i.total); // part paid: show both figures
    var meta = [paid || part ? C.money(i.total) : '', paid ? 'paid' : C.money(i.amount_due) + ' owing', i.date || i.invoice_date ? C.dateWords(i.date || i.invoice_date) : ''].filter(Boolean).join(' · ');
    docs += '<button type="button" class="dw-doc" data-dw="inv" data-k="' + dwEsc(id) + '"><span class="ic">PDF</span><span><span class="n">' + dwEsc(C.kindWord(i.kind) + ' invoice ' + (num || '')) + '</span><span class="m">' + dwEsc(meta) + '</span></span></button>';
  });
  (J.documents || []).forEach(function (d) {
    var k = C.fileKind(d.mime, d.name);
    docs += '<button type="button" class="dw-doc" data-dw="doc" data-k="' + dwEsc(d.id) + '"><span class="ic ' + k + '">' + k + '</span><span><span class="n">' + dwEsc(d.name || 'Document') + '</span><span class="m">' + dwEsc(String(d.kind || '').replace(/_/g, ' ')) + '</span></span></button>';
  });
  return story + money + '<div class="dw-h">Documents and invoices</div><div id="dwDocs">' + (docs || '<div class="dw-quiet">No documents on this job.</div>') + '</div>';
}

// Middle: the conversation, newest at the bottom, then what to do next.
// The conversation is the PAYER's own (a neighbour's on a shared fence), with a quiet toggle
// to the whole job's thread, where other people's messages carry their name.
function dwMiddleHtml(J) {
  var C = DebtWorkshopCore, s = dwSettings(), linked = dwLinked(J), payer = C.payerOf(J), who = C.firstName(payer.name) || 'them';
  var conv = J.conversation && typeof J.conversation === 'object' ? J.conversation : {};
  var all = conv.mode === 'all';
  var items = C.thread(conv, dwToday());
  var phone = payer.phone ? '<span id="dwPayerPhone">' + dwEsc(payer.phone) + '</span>' : '';
  var empty = all ? 'No messages on this job yet.'
    : conv.reason === 'payer_not_linked' ? 'No conversation with ' + who + ' yet. Link ' + who + '\'s GoHighLevel contact to see it and text them.'
    : linked ? 'No messages with ' + who + ' yet.' : 'No GoHighLevel contact is linked, so there is no conversation to show.';
  var thread = items.length ? '<div class="dw-thread" id="dwThread">' + items.map(function (x) { return x.type === 'day' ? '<div class="dw-dayl">' + dwEsc(x.label) + '</div>' : dwMsgHtml(x.m); }).join('') + '</div>'
    : '<div class="dw-quiet" id="dwThreadEmpty">' + dwEsc(empty) + '</div>';
  // The toggle shows only when the job's thread holds more than the payer's own messages.
  var total = Number(conv.all_job_messages_count), mine = Array.isArray(conv.messages) ? conv.messages.length : 0;
  var toggle = all
    ? '<button type="button" class="dw-link dw-convt" data-dw="conv-payer" id="dwConvToggle">Show only ' + dwEsc(who) + '\'s messages</button>'
    : isFinite(total) && total > mine ? '<button type="button" class="dw-link dw-convt" data-dw="conv-all" id="dwConvToggle">Show the whole job\'s conversation (' + total + ' ' + (total === 1 ? 'message' : 'messages') + ')</button>' : '';
  var flags = (Array.isArray(J.flags) ? J.flags : []).map(function (f) {
    return '<div class="dw-notice" data-flag="' + dwEsc(f.id) + '"><div class="top"><div><b>' + dwEsc(f.text) + '</b>' + (f.why ? '<div class="w">' + dwEsc(f.why) + '</div>' : '') +
      '<div class="d">Agent notice' + (f.created_at ? ' · ' + dwEsc(C.dateWords(C.perthDay(f.created_at))) : '') + '</div></div>' +
      (s.viewer_is_owner ? '<button type="button" class="dw-link" data-dw="dismiss" data-k="' + dwEsc(f.id) + '"' + dwDis(!!DW.busy) + '>Dismiss</button>' : '') + '</div></div>';
  }).join('');
  var link = linked ? '' : dwLinkCardHtml(J, s);
  var owner = s.viewer_is_owner ? '' : '<div class="dw-gate" id="dwReadOnly">Only an owner can send, skip, move or link. You can still add notes.</div>';
  var refusal = DW.refusal ? '<div class="dw-refuse" id="dwRefusal" role="alert">' + dwEsc(DW.refusal) + '</div>' : '';
  return '<div class="dw-h">Conversation ' + phone + '</div>' + thread + toggle + flags + link + dwSuggestionHtml(J, s, linked) + refusal + owner;
}
function dwMsgHtml(m) {
  var C = DebtWorkshopCore, id = String(m.id || ''), time = C.perthTime(m.occurred_at || m.at), body = String(m.body || m.preview || '');
  var author = m.author && !DW_UUID.test(String(m.author)) ? String(m.author) : '';
  // Not filed on a job yet (the payer's own message, this job one it could belong to): a quiet label.
  var unpl = C.unplacedWords(m), unplTag = unpl ? '<span class="dw-unpl">' + dwEsc(unpl) + '</span>' : '';
  if (m.channel === 'call') {
    var open = !!DW.open[id], tr = body.trim();
    return '<div class="dw-msg call" data-msg="' + dwEsc(id) + '"><b>' + dwEsc(C.callTitle(m)) + '</b>' + (time ? ' <span class="meta" style="display:inline">' + dwEsc(time) + '</span>' : '') +
      (tr ? '<div><button type="button" class="dw-link" data-dw="transcript" data-k="' + dwEsc(id) + '" aria-expanded="' + open + '">' + (open ? 'Hide transcript' : 'Show transcript') + '</button></div>' + (open ? '<div class="tr">' + dwEsc(tr) + '</div>' : '') : '<span class="meta">No transcript</span>') + unplTag + '</div>';
  }
  if (m.channel === 'note') return '<div class="dw-msg note" data-msg="' + dwEsc(id) + '"><span class="meta">Staff note' + (author ? ' · ' + dwEsc(author) : '') + (time ? ' · ' + dwEsc(time) : '') + '</span>' + dwEsc(body) + '</div>';
  var out = m.direction === 'outbound';
  // On the whole job's thread, a message with someone other than the payer says who.
  var party = C.partyWords(m);
  var who = out ? (author || 'Us') + (party ? ' to ' + party : '') : (party || author || 'Client');
  var long = body.length > 600 && !DW.open[id];
  return '<div class="dw-msg ' + (out ? 'out' : 'in') + (m.is_payer === false ? ' other' : '') + '" data-msg="' + dwEsc(id) + '"><span class="meta">' + dwEsc(who + ' · ' + C.channelWord(m.channel) + (time ? ' · ' + time : '')) + '</span>' +
    (m.subject ? '<span class="subj">' + dwEsc(m.subject) + '</span>' : '') + dwEsc(long ? body.slice(0, 600).replace(/\s+\S*$/, '') + '...' : body) +
    (body.length > 600 ? '<br><button type="button" class="dw-link" data-dw="more" data-k="' + dwEsc(id) + '">' + (long ? 'Show all' : 'Show less') + '</button>' : '') + unplTag + '</div>';
}
// The payer's Link contact card: candidates are searched by the payer's own phone and email.
function dwLinkCardHtml(J, s) {
  var payer = DebtWorkshopCore.payerOf(J), who = DebtWorkshopCore.firstName(payer.name) || 'This person';
  var cands = (J.contact && Array.isArray(J.contact.candidates)) ? J.contact.candidates : [];
  var lead = payer.known ? who + ' has no GoHighLevel contact linked, so texts cannot be sent from here.' : 'This job has no GoHighLevel contact, so texts cannot be sent from here.';
  var html = '<div class="dw-linkc" id="dwLinkCard"><div class="dw-lab">Link contact</div><p>' + dwEsc(lead) + (cands.length ? ' Pick the right one:' : '') + '</p>';
  if (J.contact && J.contact.linkable === false) return html + '<p>' + dwEsc(who) + ' has no contact row on this job, so there is nowhere to link them. Add them to the job\'s contacts first.</p></div>';
  if (!cands.length) html += '<p>No likely match was found in GoHighLevel. Add the contact there, then read the job again.</p>';
  cands.forEach(function (c) {
    var d = [c.phone, c.email, c.match].filter(Boolean).join(' · ');
    html += '<div class="dw-cand"><div><b>' + dwEsc(c.name || 'Unnamed contact') + '</b>' + (d ? '<div class="d">' + dwEsc(d) + '</div>' : '') + '</div>' +
      '<button type="button" class="dw-btn g sm" data-dw="link" data-k="' + dwEsc(c.id) + '"' + dwDis(!s.viewer_is_owner || !!DW.busy) + '>' + (DW.busy === 'link:' + c.id ? 'Linking...' : 'Link') + '</button></div>';
  });
  return html + '</div>';
}
function dwDraftKey() { var J = DW.job || {}, s = J.suggestion || {}; return String(DW.jobId) + ':' + String(s.id || s.step || 'draft'); }
function dwDraftText() { var k = dwDraftKey(), s = (DW.job && DW.job.suggestion) || {}; return DW.drafts[k] != null ? DW.drafts[k] : String(s.text || ''); }
function dwSuggestionHtml(J, s, linked) {
  var C = DebtWorkshopCore, sug = J.suggestion, row = J.row || {}, today = dwToday();
  if (!sug) {
    var words;
    if (row.category === 'says_paid') words = 'They say they have paid. Follow-ups are paused while Xero catches up.';
    else if (row.category === 'rectification') words = 'In Rectification. Chasing stops until the fix is done.';
    else if (C.isPaused(row, today)) words = 'Follow-ups paused until ' + C.dateWords(row.paused_until) + ', a promise to pay.';
    else if (row.on_jan_list) words = 'On Jan\'s visit list. No more texts.';
    else if (row.next_step && row.next_step.step) words = 'Nothing to send today. Next: ' + C.stepLabel(row.next_step.step, row.kind) + ' ' + C.whenWords(row.next_step.date, today) + '.';
    else words = 'Nothing to send today.';
    return '<div class="dw-nothing" id="dwNothing">' + dwEsc(words) + '</div>';
  }
  var text = dwDraftText(), edited = text !== String(sug.text || '');
  var src = sug.source === 'agent' ? 'Written by the agent' : 'From the template';
  var editor = DW.editing ? '<textarea data-dw-in="draft" id="dwDraftEdit" aria-label="Edit the message">' + dwEsc(text) + '</textarea>' : '<div class="dw-txt" id="dwDraftText">' + dwEsc(text) + '</div>';
  var why = sug.why ? (DW.why ? '<div class="dw-why" id="dwWhy">' + dwEsc(sug.why) + '</div>' : '') : '';
  var whyLink = sug.why ? '<button type="button" class="dw-link" data-dw="why" aria-expanded="' + !!DW.why + '">' + (DW.why ? 'Hide why' : 'Why this one') + '</button>' : '';

  if (sug.kind === 'move') {
    var cat = C.catByKey(sug.proposed_category) || { name: 'Rectification', color: '#7B5EA7' };
    var canText = dwCanText(J);
    var replyOk = !!text.trim() && s.sending_on && canText;
    var label = 'Move to ' + cat.name + (replyOk ? ' + send reply' : '');
    var lab = sug.proposed_category === 'says_paid' ? 'Looks like they have paid' : 'Looks like something to fix';
    var gate = !s.viewer_is_owner ? '' : (text.trim() && !s.sending_on ? 'Sending is off until you switch it on, so only the move happens.' : text.trim() && !linked ? 'No contact is linked, so only the move happens.' : '');
    return '<div class="dw-move" id="dwMove"><div class="dw-lab"><span>' + dwEsc(lab) + '</span><span class="src">' + dwEsc(src) + '</span></div>' +
      (sug.why ? '<p>' + dwEsc(sug.why) + '</p>' : '') +
      '<p>Move this job to <b style="color:' + cat.color + '">' + dwEsc(cat.name) + '</b>? The follow-ups stop while it is there.</p>' +
      (sug.text ? '<div class="dw-reply"><div class="dw-lab"><span>Suggested reply</span>' + (edited ? '<span class="src">edited</span>' : '') + '</div>' + (DW.editing ? '<textarea data-dw-in="draft" id="dwDraftEdit" aria-label="Edit the reply" style="width:100%;min-height:120px;border:1px solid #DCCFEE;border-radius:3px;padding:8px;font:inherit;font-size:13px">' + dwEsc(text) + '</textarea>' : dwEsc(text)) + '</div>' : '') +
      '<div class="dw-acts"><button type="button" class="dw-btn p" data-dw="move" id="dwMoveBtn"' + dwDis(!s.viewer_is_owner || !!DW.busy) + '>' + dwEsc(DW.busy === 'move' ? 'Moving...' : label) + '</button>' +
      '<button type="button" class="dw-btn g" data-dw="keep" id="dwKeepBtn"' + dwDis(!s.viewer_is_owner || !!DW.busy) + '>Keep chasing</button>' +
      (sug.text ? '<button type="button" class="dw-link" data-dw="edit">' + (DW.editing ? 'Done editing' : 'Edit reply') + '</button>' : '') + '</div>' +
      (gate ? '<div class="dw-gate">' + dwEsc(gate) + '</div>' : '') + '</div>';
  }
  if (sug.kind === 'flag') {
    return '<div class="dw-flag" id="dwFlag"><div class="dw-lab" style="color:var(--dw-mid)"><span>Agent note</span></div><div class="dw-txt">' + dwEsc(sug.text || '') + '</div>' + (sug.why ? '<div class="dw-why">' + dwEsc(sug.why) + '</div>' : '') + '</div>';
  }
  var email = sug.channel === 'email';
  var stepWords = sug.step ? C.stepLabel(sug.step, row.kind) : '';
  if (email) stepWords = stepWords.replace(/ text/, ' email');
  var title = stepWords ? 'Suggested ' + stepWords.charAt(0).toLowerCase() + stepWords.slice(1) : 'Suggested reply';
  var possible = Array.isArray(J.possible_payments) ? J.possible_payments : [];
  var g = C.sendGate({ settings: s, channel: sug.channel, linked: linked, possible: possible, who: C.firstName(C.payerOf(J).name) });
  var warn = possible.length ? '<div class="dw-warn" id="dwPossible"><b>Possible payment in the bank feed</b>' + possible.map(function (p) { return dwEsc(C.paymentWords(p)) + (p.reason ? ' (' + dwEsc(p.reason) + ')' : ''); }).join('<br>') + '<br>Match it in Xero before chasing. If it is not theirs, you can send anyway.</div>' : '';
  var sendBtn;
  if (g.code === 'possible_payment') {
    sendBtn = '<button type="button" class="dw-btn g" data-dw="send-anyway" id="dwSendAnyway"' + dwDis(!!DW.busy) + '>' + (DW.busy === 'send' ? 'Sending...' : 'Send anyway') + '</button>';
  } else {
    var sendLabel = g.code === 'sending_off' ? g.reason : DW.busy === 'send' ? 'Sending...' : email ? 'Send email' : 'Send text';
    sendBtn = '<button type="button" class="dw-btn" data-dw="send" id="dwSend"' + dwDis(!g.ok || !!DW.busy) + '>' + dwEsc(sendLabel) + '</button>';
  }
  var gateLine = !g.ok && g.code !== 'sending_off' && g.code !== 'possible_payment' && g.code !== 'not_owner' ? '<div class="dw-gate">' + dwEsc(g.reason) + '.</div>' : '';
  var callLine = sug.step === 'd7' ? '<div class="dw-gate">Day 7 is a call too: ring them, then add a note on what was said.</div>' : '';
  return '<div class="dw-sug" id="dwSuggestion"><div class="dw-lab"><span>' + dwEsc(title) + '</span><span class="src">' + dwEsc(src + (edited ? ', edited' : '')) + '</span></div>' +
    editor + warn +
    '<div class="dw-acts">' + sendBtn +
    '<button type="button" class="dw-btn g" data-dw="edit" id="dwEdit">' + (DW.editing ? 'Done' : 'Edit') + '</button>' +
    '<button type="button" class="dw-link" data-dw="skip" id="dwSkip"' + dwDis(!s.viewer_is_owner || !!DW.busy) + '>Skip</button>' +
    '<span class="spacer"></span>' + whyLink + '</div>' + why + gateLine + callLine + '</div>';
}

// Right: notes only.
function dwNotesHtml(J) {
  var C = DebtWorkshopCore, notes = Array.isArray(J.notes) ? J.notes : [];
  var list = notes.map(function (n) {
    var v = C.noteView(n), meta = [v.at ? C.dateWords(C.perthDay(v.at)) : '', v.who].filter(Boolean).join(' · ');
    return '<div class="dw-note' + (v.auto ? ' auto' : '') + '">' + (meta ? '<div class="m">' + dwEsc(meta) + '</div>' : '') + dwEsc(v.text) + '</div>';
  }).join('');
  return '<div class="dw-h">Notes</div>' +
    '<textarea class="dw-note-in" data-dw-in="note" id="dwNoteIn" placeholder="Add a note, e.g. spoke to them, paying Friday" aria-label="New note">' + dwEsc(DW.noteText) + '</textarea>' +
    '<div class="dw-note-row"><label>Promised to pay by <input type="date" data-dw-in="promise" id="dwPromise" value="' + dwEsc(DW.promise) + '"></label>' +
    '<button type="button" class="dw-btn g sm" data-dw="note-save" id="dwNoteSave"' + dwDis(!!DW.busy) + '>' + (DW.busy === 'note' ? 'Saving...' : 'Save note') + '</button></div>' +
    (DW.noteMsg ? '<div class="dw-refuse" style="margin:-6px 0 12px">' + dwEsc(DW.noteMsg) + '</div>' : '') +
    '<div id="dwNotes">' + (list || '<div class="dw-quiet">No notes yet.</div>') + '</div>';
}

// ════════════════════════════════════════════════════════════
// MODAL (documents, invoices, statement previews and the footer lists)
// ════════════════════════════════════════════════════════════
function dwModal(o) {
  dwCloseModal(); dwCss(); dwBind();
  var m = document.createElement('div');
  m.className = 'dw-modal'; m.id = 'dwModal';
  m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', o.title || 'Details');
  m.innerHTML = '<div class="dw-sheet' + (o.size === 'sm' ? ' sm' : '') + '"><div class="hd"><span>' + dwEsc(o.title || '') + '</span><button type="button" class="dw-btn g sm" data-dw="modal-close">Close</button></div>' +
    '<div class="to"' + (o.top ? '' : ' hidden') + '>' + (o.top || '') + '</div><div class="bd">' + (o.body || '') + '</div>' +
    '<div class="ft"' + (o.foot ? '' : ' hidden') + '>' + (o.foot || '') + '</div></div>';
  document.body.appendChild(m);
  var c = m.querySelector('[data-dw="modal-close"]'); if (c) c.focus();
  return ++DW.modalGen;
}
function dwModalSet(part, html) {
  var el = document.querySelector('#dwModal .' + part); if (!el) return;
  el.innerHTML = html || ''; if (part !== 'bd') el.hidden = !html;
}
function dwCloseModal() {
  var m = document.getElementById('dwModal'); if (m) m.remove();
  if (DW.modalUrl) { try { URL.revokeObjectURL(DW.modalUrl); } catch (e) {} DW.modalUrl = null; }
  DW.modalCompany = null; DW.modalGen = (DW.modalGen || 0) + 1;
}
var DW_LOADING = '<div class="dw-empty">Fetching...</div>';
// Shows base64 bytes as a PDF, an image, or a download link.
function dwShowFile(b64, mime, name) {
  var bin = atob(b64), arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  var url = URL.createObjectURL(new Blob([arr], { type: mime || 'application/octet-stream' }));
  DW.modalUrl = url;
  var k = DebtWorkshopCore.fileKind(mime, name);
  if (k === 'PDF') return '<iframe src="' + dwEsc(url) + '" title="' + dwEsc(name || 'Document') + '"></iframe>';
  if (k === 'IMG') return '<div style="padding:12px;background:#F6F8F9"><img src="' + dwEsc(url) + '" alt="' + dwEsc(name || 'Photo') + '"></div>';
  return '<div class="dw-empty">This file cannot be shown here. <a href="' + dwEsc(url) + '" download="' + dwEsc(name || 'document') + '">Download it</a></div>';
}
async function dwOpenDoc(id) {
  var J = DW.job || {}, d = (J.documents || []).filter(function (x) { return String(x.id) === String(id); })[0] || {};
  var g = dwModal({ title: d.name || 'Document', body: DW_LOADING });
  try {
    var r = await opsFetch('debt_ws_document', { job_id: (J.job && J.job.id) || (J.row && J.row.job_id), document_id: id });
    if (g !== DW.modalGen) return;
    var c = (r && r.content) || r || {};
    var b64 = c.base64 || r.base64 || r.pdf_base64;
    if (!b64) throw new Error('No file came back');
    dwModalSet('bd', dwShowFile(b64, c.mime_type || r.mime_type || r.mime || d.mime, d.name || (r.document && r.document.name)));
  } catch (e) { if (g === DW.modalGen) dwModalSet('bd', dwFailHtml('This document', e)); }
}
async function dwOpenInvoice(xid) {
  var inv = ((DW.job && DW.job.invoices) || []).filter(function (i) { return String(i.xero_invoice_id || i.id) === String(xid); })[0] || {};
  var g = dwModal({ title: 'Invoice ' + (inv.number || inv.invoice_number || (DW.job && DW.job.row && DW.job.row.invoice_number) || ''), body: DW_LOADING });
  try {
    var r = await opsFetch('get_invoice_pdf', { xero_invoice_id: xid });
    if (g !== DW.modalGen) return;
    if (!r || !r.pdf_base64) throw new Error((r && r.error) || 'No PDF came back from Xero');
    dwModalSet('bd', dwShowFile(r.pdf_base64, r.content_type || 'application/pdf', r.filename || 'invoice.pdf'));
  } catch (e) { if (g === DW.modalGen) dwModalSet('bd', dwFailHtml('The invoice PDF', e)); }
}
function dwCompany(key) { return ((DW.ov && DW.ov.companies) || []).filter(function (c) { return String(c.company_key) === String(key); })[0] || null; }
// A statement refused for possible payments: the invoices it names, and Send anyway (owner only).
function dwStatementPossibleHtml(key) {
  var pp = DW.stmtPossible[key]; if (!pp) return '';
  var owner = !!dwSettings().viewer_is_owner;
  return '<div class="dw-warn" data-stmt-possible="' + dwEsc(key) + '"><b>Possible payment in the bank feed</b>' +
    (pp.length ? pp.map(function (p) { return dwEsc([p.invoice, p.words].filter(Boolean).join(': ')); }).join('<br>') + '<br>' : '') +
    'Match it in Xero first. If it is not theirs, you can send anyway.' +
    '<div class="dw-acts" style="margin-top:8px"><button type="button" class="dw-btn g sm" data-dw="approve-anyway" data-k="' + dwEsc(key) + '"' + dwDis(!owner || !!DW.busy) + '>' + (DW.busy === 'approve:' + key ? 'Sending...' : 'Send anyway') + '</button></div></div>';
}
function dwStatementFoot(c) {
  var gate = DebtWorkshopCore.statementGate(c, dwSettings()), key = String(c.company_key || '');
  var msg = DW.rowMsg[key];
  if (DW.stmtPossible[key]) return '<div style="flex:1 1 100%">' + dwStatementPossibleHtml(key) + '</div>';
  return (msg ? '<span class="why" style="color:#8E2B1E">' + dwEsc(msg) + '</span>' : gate.ok ? '' : '<span class="why">' + dwEsc(gate.reason) + '</span>') +
    '<button type="button" class="dw-btn" data-dw="approve" data-k="' + dwEsc(key) + '"' + dwDis(!gate.ok || !!DW.busy) + '>' + (DW.busy === 'approve:' + key ? 'Sending...' : 'Approve and send') + '</button>';
}
async function dwPreview(key) {
  var C = DebtWorkshopCore, c = dwCompany(key); if (!c) return;
  var g = dwModal({ title: 'Statement for ' + c.name, body: DW_LOADING, foot: dwStatementFoot(c) });
  DW.modalCompany = key;
  try {
    var r = await opsFetch('debt_ws_statement_preview', { company_key: key });
    if (g !== DW.modalGen) return;
    var invs = Array.isArray(r.invoices) ? r.invoices : [];
    var total = r.total != null ? r.total : invs.reduce(function (a, i) { return a + C.num(i.amount != null ? i.amount : i.amount_due); }, 0);
    dwModalSet('to', 'To: <b>' + dwEsc(r.to_email || 'no accounts email set') + '</b> · ' + dwEsc(C.plural(invs.length, 'invoice', 'invoices')) + ' · ' + dwEsc(C.money(total)));
    // The statement HTML is shown in a sandboxed frame: no scripts, no reach into this page.
    dwModalSet('bd', r.html ? '<iframe sandbox="" title="Statement preview" srcdoc="' + dwEsc(r.html) + '"></iframe>' : '<div class="dw-empty">Nothing on this statement yet.</div>');
  } catch (e) { if (g === DW.modalGen) dwModalSet('bd', dwFailHtml('The statement preview', e)); }
}

// ════════════════════════════════════════════════════════════
// ACTIONS (every write re-reads afterwards; every refusal is shown in words)
// ════════════════════════════════════════════════════════════
function dwRowId() { var J = DW.job || {}; return (J.row && J.row.xero_invoice_id) || DW.jobId; }
function dwAfterWrite() { dwLoadJob(true); dwLoadOverview(true); }

async function dwSend(override) {
  var C = DebtWorkshopCore, J = DW.job; if (!J || !J.suggestion || DW.busy) return;
  var sug = J.suggestion, text = dwDraftText();
  if (!text.trim()) { DW.refusal = 'Write the message first.'; return dwRender(); }
  if (C.hasBanned(text)) { DW.refusal = C.REFUSALS.text_not_allowed; return dwRender(); }
  DW.busy = 'send'; DW.refusal = null; dwRender();
  try {
    // amount: what the draft was written for, so the backend can refuse it after a part payment.
    var body = { xero_invoice_id: dwRowId(), step: sug.step || null, suggestion_id: sug.id || null, action: 'send', text: text, channel: sug.channel || 'sms', amount: C.draftAmount(sug, J.row) };
    if (override) body.override_possible_payment = true; // logged by the backend; owner only
    await dwPost('debt_ws_decide', body);
    DW.busy = null; delete DW.drafts[dwDraftKey()]; DW.editing = false; DW.why = false;
    dwToast((sug.channel === 'email' ? 'Email' : 'Text') + ' sent', 'success');
    dwAfterWrite();
  } catch (e) {
    DW.busy = null; DW.refusal = C.refusalText(e);
    var pp = e && e.body && e.body.possible_payments;
    if (Array.isArray(pp) && pp.length && DW.job) DW.job.possible_payments = pp;
  }
  dwRender();
}
async function dwSkip() {
  var C = DebtWorkshopCore, J = DW.job; if (!J || !J.suggestion || DW.busy) return;
  var sug = J.suggestion;
  DW.busy = 'skip'; DW.refusal = null; dwRender();
  try {
    await dwPost('debt_ws_decide', { xero_invoice_id: dwRowId(), step: sug.step || null, suggestion_id: sug.id || null, action: 'skip', text: dwDraftText() });
    DW.busy = null; DW.editing = false;
    dwToast((sug.step ? C.stepLabel(sug.step, J.row && J.row.kind) : 'Suggestion') + ' skipped', 'success');
    dwAfterWrite();
  } catch (e) { DW.busy = null; DW.refusal = C.refusalText(e); }
  dwRender();
}
// Move to the proposed category, then send the reply when sending is on and a contact is linked.
async function dwMove() {
  var C = DebtWorkshopCore, J = DW.job; if (!J || !J.suggestion || DW.busy) return;
  var sug = J.suggestion, cat = C.catByKey(sug.proposed_category) || { name: 'Rectification' }, s = dwSettings();
  var text = dwDraftText();
  if (text.trim() && C.hasBanned(text)) { DW.refusal = C.REFUSALS.text_not_allowed; return dwRender(); }
  DW.busy = 'move'; DW.refusal = null; dwRender();
  try {
    await dwPost('debt_ws_set_category', { xero_invoice_id: dwRowId(), category: sug.proposed_category || 'rectification', suggestion_id: sug.id || null });
  } catch (e) { DW.busy = null; DW.refusal = C.refusalText(e); return dwRender(); }
  var sent = false;
  if (text.trim() && s.sending_on && dwCanText(J)) {
    try {
      await dwPost('debt_ws_decide', { xero_invoice_id: dwRowId(), step: sug.step || null, suggestion_id: sug.id || null, action: 'send', text: text, channel: sug.channel || 'sms', amount: C.draftAmount(sug, J.row) });
      sent = true;
    } catch (e) { DW.refusal = 'Moved to ' + cat.name + '. The reply was not sent: ' + C.refusalText(e); }
  }
  DW.busy = null; DW.editing = false; delete DW.drafts[dwDraftKey()];
  dwToast('Moved to ' + cat.name + (sent ? ' and the reply was sent' : ''), 'success');
  dwRender(); dwAfterWrite();
}
// Change (beside the pill): set or clear a category by hand. Rectification moves the job card, so it asks first.
function dwCatChoose(cat) {
  DW.catMenu = false;
  if (cat !== 'rectification') return dwSetCategory(cat);
  dwRender();
  dwModal({ title: 'Move to Rectification', size: 'sm', body: '<div class="dw-confirm">This moves the job card to Rectification.</div>',
    foot: '<button type="button" class="dw-btn g" data-dw="modal-close">Cancel</button><button type="button" class="dw-btn p" data-dw="cat-confirm" data-k="rectification" id="dwCatConfirm">Move to Rectification</button>' });
}
async function dwSetCategory(cat) {
  var C = DebtWorkshopCore, J = DW.job; if (!J || DW.busy) return;
  dwCloseModal();
  DW.catMenu = false; DW.busy = 'cat:' + cat; DW.refusal = null; dwRender();
  try {
    var r = await dwPost('debt_ws_set_category', { xero_invoice_id: dwRowId(), category: cat });
    DW.busy = null;
    var done = { says_paid: 'Moved to Says paid', rectification: 'Moved to Rectification', clear: 'Cleared says paid' }[cat] || 'Category changed';
    dwToast(done + (r && typeof r.note === 'string' && r.note ? '. ' + r.note : ''), 'success');
    dwAfterWrite();
  } catch (e) { DW.busy = null; DW.refusal = C.refusalText(e); }
  dwRender();
}
// Keep chasing: turn the move down. set_category "clear" with the suggestion marks it dismissed.
async function dwKeep() {
  var C = DebtWorkshopCore, J = DW.job; if (!J || !J.suggestion || DW.busy) return;
  DW.busy = 'keep'; DW.refusal = null; dwRender();
  try {
    await dwPost('debt_ws_set_category', { xero_invoice_id: dwRowId(), category: 'clear', suggestion_id: J.suggestion.id || null });
    DW.busy = null; dwToast('Kept chasing', 'success'); dwAfterWrite();
  } catch (e) { DW.busy = null; DW.refusal = C.refusalText(e); }
  dwRender();
}
async function dwDismiss(id) {
  var C = DebtWorkshopCore, J = DW.job; if (!J || DW.busy) return;
  DW.busy = 'dismiss'; DW.refusal = null; dwRender();
  try {
    await dwPost('debt_ws_decide', { xero_invoice_id: dwRowId(), suggestion_id: id, action: 'dismiss' });
    DW.busy = null;
    if (DW.job && Array.isArray(DW.job.flags)) DW.job.flags = DW.job.flags.filter(function (f) { return String(f.id) !== String(id); });
    dwToast('Notice dismissed', 'success'); dwAfterWrite();
  } catch (e) { DW.busy = null; DW.refusal = C.refusalText(e); }
  dwRender();
}
async function dwLink(cid) {
  var C = DebtWorkshopCore, J = DW.job; if (!J || DW.busy) return;
  DW.busy = 'link:' + cid; DW.refusal = null; dwRender();
  try {
    // The invoice decides whose contact this is: a neighbour's goes on their own row, never the job.
    await dwPost('debt_ws_link_contact', { xero_invoice_id: dwRowId(), job_id: (J.job && J.job.id) || (J.row && J.row.job_id) || undefined, ghl_contact_id: cid });
    DW.busy = null; dwToast('Contact linked', 'success'); dwAfterWrite();
  } catch (e) { DW.busy = null; DW.refusal = C.refusalText(e); }
  dwRender();
}
async function dwSaveNote() {
  var C = DebtWorkshopCore, J = DW.job; if (!J || DW.busy) return;
  var text = String(DW.noteText || '').trim(), promise = String(DW.promise || '');
  DW.noteMsg = null;
  if (!text && !promise) { DW.noteMsg = 'Write the note first.'; return dwRender(); }
  if (promise && C.dayNum(promise) < C.dayNum(dwToday())) { DW.noteMsg = 'The promised date is in the past.'; return dwRender(); }
  DW.busy = 'note'; dwRender();
  try {
    var row = J.row || {};
    // The contract does not name the note field: note and body carry the same words.
    await dwPost('debt_ws_note', { xero_invoice_id: dwRowId(), share_key: row.share_key || null, job_id: row.job_id || (J.job && J.job.id) || null, note: text, body: text, promise_date: promise || null });
    DW.busy = null; DW.noteText = ''; DW.promise = '';
    dwToast(promise ? 'Note saved, follow-ups paused until ' + C.dateWords(promise) : 'Note saved', 'success');
    dwAfterWrite();
  } catch (e) { DW.busy = null; DW.noteMsg = C.refusalText(e); }
  dwRender();
}
// override: Send anyway after a possible_payment refusal (logged by the backend; owner only).
async function dwApprove(key, override) {
  var C = DebtWorkshopCore, c = dwCompany(key); if (!c || DW.busy) return;
  if (!C.statementGate(c, dwSettings()).ok) return;
  DW.busy = 'approve:' + key; DW.rowMsg[key] = null; dwRender(); dwModalFootRefresh();
  try {
    var body = { company_key: key };
    if (override) body.override_possible_payment = true;
    var r = await dwPost('debt_ws_statement_send', body);
    DW.busy = null; delete DW.stmtPossible[key];
    dwToast('Statement sent to ' + ((r && r.to_email) || c.name), 'success');
    if (DW.modalCompany === key) dwCloseModal();
    dwLoadOverview(true);
  } catch (e) {
    DW.busy = null;
    if (C.refusalCode(e) === 'possible_payment' && !override) { DW.stmtPossible[key] = C.statementPossible(e && e.body); }
    else { delete DW.stmtPossible[key]; DW.rowMsg[key] = C.refusalText(e); }
  }
  dwRender(); dwModalFootRefresh();
}
function dwModalFootRefresh() { if (DW.modalCompany) { var c = dwCompany(DW.modalCompany); if (c) dwModalSet('ft', dwStatementFoot(c)); } }
async function dwJanRemove(key) {
  var C = DebtWorkshopCore; if (DW.busy) return;
  DW.busy = 'jan:' + key; DW.janMsg = null; dwRender();
  try {
    await dwPost('debt_ws_jan_list_remove', { share_key: key });
    DW.busy = null; dwToast('Taken off Jan\'s list for this week', 'success');
    dwLoadJan(); dwLoadOverview(true);
  } catch (e) { DW.busy = null; DW.janMsg = C.refusalText(e); }
  dwRender();
}

// ════════════════════════════════════════════════════════════
// EVENTS (one delegated listener for the view and the modal, bound once)
// ════════════════════════════════════════════════════════════
function dwAct(a, k) {
  switch (a) {
    case 'jt':
      if (k === DW.jt) return;
      if (k === 'insurance' || DW.jt === 'insurance') DW.cat = null;
      DW.jt = k; return dwRender();
    case 'cat': DW.cat = k; return dwRender();
    case 'cats-all': DW.cat = null; return dwRender();
    case 'open': return dwOpenJob(k);
    case 'company': case 'preview': return dwPreview(k);
    case 'approve': return dwApprove(k, false);
    case 'approve-anyway': return dwApprove(k, true);
    case 'jan-remove': return dwJanRemove(k);
    case 'foot': return dwFootModal(k);
    case 'reload': return dwLoadOverview(false);
    case 'back':
      DW.view = 'list'; DW.jobGen++; DW.job = null; DW.jobId = null;
      if (DW.navFrom) { DW.jt = DW.navFrom.jt || DW.jt; DW.cat = DW.navFrom.cat || null; }
      dwRender(); try { window.scrollTo(0, 0); } catch (e) {} return;
    case 'next': { var i = DW.nav.indexOf(DW.jobId); if (i >= 0 && i < DW.nav.length - 1) dwShowJob(DW.nav[i + 1]); return; }
    case 'job-reload': DW.jobErr = null; dwRender(); return dwLoadJob(false);
    case 'doc': return dwOpenDoc(k);
    case 'inv': return dwOpenInvoice(k);
    case 'edit': DW.editing = !DW.editing; if (DW.editing) DW.focus = '#dwDraftEdit'; return dwRender();
    case 'why': DW.why = !DW.why; return dwRender();
    case 'send': return dwSend(false);
    case 'send-anyway': return dwSend(true);
    case 'skip': return dwSkip();
    case 'move': return dwMove();
    case 'keep': return dwKeep();
    case 'dismiss': return dwDismiss(k);
    case 'link': return dwLink(k);
    case 'note-save': return dwSaveNote();
    case 'cat-menu': DW.catMenu = !DW.catMenu; if (DW.catMenu) DW.focus = '#dwCatMenu button'; return dwRender();
    case 'cat-set': return dwCatChoose(k);
    case 'cat-confirm': return dwSetCategory(k);
    case 'transcript': case 'more': DW.open[k] = !DW.open[k]; return dwRender();
    case 'conv-all': DW.convAll = true; return dwLoadJob(true);
    case 'conv-payer': DW.convAll = false; return dwLoadJob(true);
    case 'modal-close': return dwCloseModal();
  }
}
function dwBind() {
  if (DW.bound || typeof document === 'undefined' || !document.addEventListener) return;
  DW.bound = true;
  document.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    if (t.id === 'dwModal') { dwCloseModal(); return; } // a click on the dimmed backdrop
    if (DW.catMenu && !t.closest('.dw-catm')) { DW.catMenu = false; dwRender(); } // a click anywhere else closes the Change menu
    var el = t.closest('[data-dw]'); if (!el) return;
    if (!el.closest('#viewDebt') && !el.closest('#dwModal')) return;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    dwAct(el.getAttribute('data-dw'), el.getAttribute('data-k'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('dwModal')) { dwCloseModal(); return; }
    if (e.key === 'Escape' && DW.catMenu) { DW.catMenu = false; DW.focus = '#dwCatChange'; dwRender(); return; }
    var t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t && t.getAttribute && t.getAttribute('role') === 'button' && t.hasAttribute('data-dw') && t.closest('#viewDebt')) {
      e.preventDefault(); dwAct(t.getAttribute('data-dw'), t.getAttribute('data-k'));
    }
  });
  var onInput = function (e) {
    var t = e.target, k = t && t.getAttribute && t.getAttribute('data-dw-in');
    if (!k || !t.closest('#viewDebt')) return;
    if (k === 'draft') DW.drafts[dwDraftKey()] = t.value;
    else if (k === 'note') DW.noteText = t.value;
    else if (k === 'promise') DW.promise = t.value;
  };
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
}

// On load: the URL or browser flag shows the tab at once. initApp also calls
// debtWsProbeVisibility() after login; if login already happened, probe now.
(function dwBoot() {
  try {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    if (debtWsFlagOn()) debtWsReveal(true);
    if (typeof window !== 'undefined' && window._opsAppStarted) debtWsProbeVisibility();
  } catch (e) { /* never break the dashboard over a hidden tab */ }
})();
