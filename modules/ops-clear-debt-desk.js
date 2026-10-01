// ════════════════════════════════════════════════════════════
// CLEAR DEBT DESK: the header, the tabs and the morning list. Layout B for Today (the To do today bar,
//   a left menu of sections, a table of the one picked and a detail panel) is preview-only, at
//   ops.html?view=clear-debt-preview, until CDD_LAYOUT_B_LIVE is switched on.
// Plan: secureworks-backend docs/debt-book/PLAN.md sections 5 and 6 steps 4 and 5,
//   captain's rulings in DECISIONS.md beside it. Screen contract: docs/clear-debt-desk.md.
// Reads: debt_book (live Xero read with the captain's rules) and debt_morning_list
//   (today's step per payer, holds, paused promises, waiting payers; drafts from step 3;
//   Jan's one morning text, jan_text, and what was sent today, sent_today, from step 5).
// Writes: debt_draft_decide (approve or skip a draft, Jan's text included), debt_log_outcome
//   (call outcome, what Jan reports, promise). Nothing here sends: the send button is fixed
//   off until Shaun says go.
// The Debt book tab is still ops-clear-debt-v2.js (bar, payer groups, payer record).
// ════════════════════════════════════════════════════════════

// <clear-debt-desk-core>
var ClearDebtDeskCore = (function () {
  var SENDING_ON = false; // Captain's go switch. Flip only in a reviewed PR after the old automatic texts are off and Shaun says start sending.
  var SEND_LABEL = 'Sending off until Shaun says go';
  var GROUPS = [
    { key: 'broken_promise', label: 'Broken promises' },
    { key: 'jan', label: 'Jan visits' },
    { key: 'call', label: 'Calls' },
    { key: 'text', label: 'Texts' },
    { key: 'statement', label: 'Builder statements' },
    { key: 'deposit_reminder', label: 'Deposit reminders' },
  ];
  var OUTCOMES = [
    { code: 'no_answer', label: 'No answer' },
    { code: 'spoke', label: 'Spoke' },
    { code: 'promised', label: 'Promised' },
    { code: 'disputed', label: 'Disputed' },
    { code: 'says_paid', label: 'Says paid' },
  ];
  var PAYERS = [
    { key: 'client', label: 'Clients' },
    { key: 'mlb', label: 'MLB' },
    { key: 'aj', label: 'AJ' },
    { key: 'other_builder', label: 'Other builders' },
  ];
  var AGES = [
    { key: 'not_due', label: 'Not due yet' },
    { key: '1_30', label: '1 to 30' },
    { key: '31_60', label: '31 to 60' },
    { key: '61_90', label: '61 to 90' },
    { key: '90_plus', label: '90+' },
    { key: 'no_due', label: 'No due date' },
  ];
  // What Jan reports from a visit: the same codes in Jan's words. The list's schedule.jan_visit_outcomes wins when sent.
  var JAN_OUTCOMES = [
    { code: 'says_paid', label: 'Visited: paid' },
    { code: 'promised', label: 'Visited: promised' },
    { code: 'no_answer', label: 'No one home' },
    { code: 'disputed', label: 'Visited: disputed' },
  ];
  // Steps a person carries out when the outcome is pressed; texts, statements and reminders are stamped by their send.
  var OUTCOME_STEPS = ['call', 'builder_call', 'jan_visit'];

  function perthDate(now) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now || new Date());
    var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
    return o.year + '-' + o.month + '-' + o.day;
  }
  function dayNum(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null;
  }
  // Days past the due date on the Perth calendar. The due date itself is day 0, not overdue.
  function daysPast(due, today) {
    var d = dayNum(due), t = dayNum(today);
    return d === null || t === null ? null : t - d;
  }
  function ageBucket(days) {
    if (days === null || days === undefined) return 'no_due';
    if (days <= 0) return 'not_due';
    if (days <= 30) return '1_30';
    if (days <= 60) return '31_60';
    if (days <= 90) return '61_90';
    return '90_plus';
  }
  function cents(n) { return Math.round(Number(n || 0) * 100); }
  function tally() { return { n: 0, c: 0 }; }
  function add(t, inv) { t.n += 1; t.c += cents(inv.amount_due); }
  function out(t) { return { n: t.n, amount: t.c / 100 }; }

  // Every header figure, summed from the invoice rows so one rule set applies throughout.
  function bookTotals(invoices, today) {
    var T = { open: tally(), debt: tally(), notDebt: tally(), overdue: tally(), overdueHeld: tally(), checkFirst: tally(), fixFirst: tally(), noDue: tally() };
    var payer = {}, age = {};
    PAYERS.forEach(function (p) { payer[p.key] = { n: 0, c: 0, oc: 0 }; });
    AGES.forEach(function (a) { age[a.key] = { all: 0 }; PAYERS.forEach(function (p) { age[a.key][p.key] = 0; }); });
    (invoices || []).forEach(function (inv) {
      add(T.open, inv);
      if (!inv.is_debt) { add(T.notDebt, inv); return; }
      add(T.debt, inv);
      var days = daysPast(inv.due_date, today), b = ageBucket(days);
      if (b === 'no_due') add(T.noDue, inv);
      if (inv.hold === 'check_first') add(T.checkFirst, inv);
      if (inv.hold === 'fix_first') add(T.fixFirst, inv);
      // Overdue is the whole debt past due, holds included, so it always matches Xero. Holds are shown beside it.
      if (days > 0) { add(T.overdue, inv); if (inv.hold) add(T.overdueHeld, inv); }
      var P = payer[inv.payer];
      if (P) { P.n += 1; P.c += cents(inv.amount_due); if (days > 0) P.oc += cents(inv.amount_due); }
      if (age[b][inv.payer] !== undefined) age[b][inv.payer] += cents(inv.amount_due);
      age[b].all += cents(inv.amount_due);
    });
    var res = {}; Object.keys(T).forEach(function (k) { res[k] = out(T[k]); });
    res.byPayer = {}; Object.keys(payer).forEach(function (k) { res.byPayer[k] = { n: payer[k].n, amount: payer[k].c / 100, overdue: payer[k].oc / 100 }; });
    res.byAge = {}; Object.keys(age).forEach(function (b) { res.byAge[b] = {}; Object.keys(age[b]).forEach(function (k) { res.byAge[b][k] = age[b][k] / 100; }); });
    return res;
  }

  function money(n) { return '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n) { return '$' + Math.round(Number(n || 0)).toLocaleString('en-AU'); }
  function perthTime(iso) {
    if (!iso) return '';
    var p = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
    var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
    return o.hour + ':' + o.minute;
  }
  function stampText(check, readAt) {
    if (check && check.stamp) return String(check.stamp); // debt_book words its own stamp
    if (!check) return readAt ? 'Read from Xero ' + perthTime(readAt) + ', not yet checked against our copy' : 'Not yet read from Xero';
    if (check.matches) return 'Matches Xero' + (readAt ? ', read ' + perthTime(readAt) : '');
    var n = Number(check.invoice_count || 0);
    return 'Differs by ' + money(check.differs_by) + ' on ' + n + ' invoice' + (n === 1 ? '' : 's');
  }
  function newestStamp(rows, field) {
    var s = (rows || []).map(function (r) { return String(r[field] || ''); }).filter(Boolean).sort();
    return s.length ? s[s.length - 1] : null;
  }

  function groupRank(g) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].key === g) return i; return GROUPS.length; }
  function byAmountThenAge(a, b) {
    var am = cents(b.amount) - cents(a.amount); if (am) return am;
    return (Number(b.days_overdue) || 0) - (Number(a.days_overdue) || 0);
  }
  function sortMorning(items) {
    return chaseItems(items).sort(function (a, b) {
      var ga = groupRank(a.group), gb = groupRank(b.group);
      return ga !== gb ? ga - gb : byAmountThenAge(a, b);
    });
  }
  // A hold is counted in the debt but never chased: shown with its reason, never drafted, ticked or approved.
  function isHeld(i) { return !!i.hold || i.group === 'hold'; }
  function chaseItems(items) { return (items || []).filter(function (i) { return !isHeld(i); }); }
  function heldItems(items) { return (items || []).filter(isHeld).sort(byAmountThenAge); }
  function waitingCount(items, janText) { return chaseItems(items).filter(function (i) { return needsDecision(i, janText); }).length + (janTextWaiting(janText) ? 1 : 0); }
  function janFromMorning(items) { return sortMorning(chaseItems(items).filter(function (i) { return i.step === 'jan_visit'; })); }
  function janHeldFromMorning(items) { return heldItems(items).filter(function (i) { return i.held_step === 'jan_visit'; }); }
  function outcomeScheduleStep(step) { return OUTCOME_STEPS.indexOf(step) >= 0 ? step : null; }
  function knownOutcome(code) { return OUTCOMES.some(function (x) { return x.code === code; }); }
  // The outcome buttons for a card: Jan's four on a Jan visit, the call outcomes everywhere else.
  function outcomesFor(step, schedule) {
    if (step !== 'jan_visit') return OUTCOMES;
    var sent = (schedule && Array.isArray(schedule.jan_visit_outcomes) ? schedule.jan_visit_outcomes : []).filter(function (x) { return x && knownOutcome(x.code) && x.label; });
    return sent.length ? sent : JAN_OUTCOMES;
  }
  function outcomeLabel(code, step, schedule) {
    var o = outcomesFor(step, schedule).filter(function (x) { return x.code === code; })[0] || OUTCOMES.filter(function (x) { return x.code === code; })[0];
    return o ? o.label : String(code || '');
  }
  // The backend labels an outcome by the step it was logged at; with no label that step is unknown, so the plain call words.
  function lastOutcomeLabel(lo) { return lo.label || outcomeLabel(lo.code, null); }
  function outcomeChannel(step) { return step === 'jan_visit' ? 'visit' : 'call'; }
  // A Jan visit listed in Jan's one morning text: the text is the decision, not the card.
  function inJanText(i, janText) { return !!janText && (janText.visits || []).some(function (v) { return v.item_id === i.id; }); }
  function janTextWaiting(janText) { return !!janText && janText.status === 'pending'; }

  // What one card asks of Shaun: one obvious button for its step, or nothing.
  //   text, email, jan, reminder, statement: approve the drafted message (a text step drafted as an email is an email);
  //   call: ring, then say what happened; wait: no draft yet; done: already decided; held: information only;
  //   in_jan_text: a Jan visit listed in Jan's one morning text, which is approved once on its own card;
  //   not_in_jan_text: a Jan visit today's Jan text does not list, which goes on tomorrow's.
  // A call script is help for the call, never approved, so calls are never waiting for a decision.
  var STEP_KIND = { friendly_text: 'text', firm_text: 'text', call: 'call', builder_call: 'call', jan_visit: 'jan', deposit_reminder: 'reminder', statement: 'statement' };
  var GROUP_KIND = { text: 'text', call: 'call', jan: 'jan', deposit_reminder: 'reminder', statement: 'statement' };
  var APPROVE_LABEL = { text: 'Approve text', email: 'Approve email', jan: 'Approve Jan\'s visit', reminder: 'Approve reminder', statement: 'Approve statement' };
  var WAIT_WORDS = 'Draft coming - nothing to do yet';
  var IN_JAN_WORDS = 'In Jan\'s text';
  var NOT_IN_JAN_WORDS = 'Not in today\'s text to Jan - goes on tomorrow\'s';
  function cardAction(i, janText) {
    if (isHeld(i)) return { kind: 'held' };
    var d = i.draft, k = STEP_KIND[i.step] || GROUP_KIND[i.group] || (d && d.channel === 'call_script' ? 'call' : 'text');
    if (k === 'call') return { kind: 'call', label: 'Call now' };
    if (k === 'jan' && inJanText(i, janText)) return { kind: 'in_jan_text', words: IN_JAN_WORDS };
    if (k === 'jan' && janText) return { kind: 'not_in_jan_text', words: NOT_IN_JAN_WORDS };
    if (!d) return { kind: 'wait', words: WAIT_WORDS };
    if (d.status !== 'pending') return { kind: 'done' };
    if (k === 'text' && d.channel === 'email') k = 'email';
    return { kind: k, label: APPROVE_LABEL[k], approve: APPROVE_LABEL[k] };
  }
  function needsDecision(i, janText) { var k = cardAction(i, janText).kind; return k === 'text' || k === 'email' || k === 'jan' || k === 'reminder' || k === 'statement'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function todoCounts(items, janText) {
    var n = { text: 0, email: 0, call: 0, jan: 0, reminder: 0, statement: 0, wait: 0, held: 0 };
    (items || []).forEach(function (i) { var k = cardAction(i, janText).kind; if (n[k] !== undefined) n[k] += 1; });
    return n;
  }
  // The chips on the dark "To do today" bar: one per kind of work, each naming its card kind
  // so a press can open the first such row. Jan's text counts once, however many visits it lists.
  function todoChips(items, janText) {
    var n = todoCounts(items, janText), chips = [];
    var push = function (kind, count, one, many) { if (count) chips.push({ kind: kind, n: count, words: count === 1 ? one : many }); };
    push('text', n.text, 'text to approve', 'texts to approve');
    push('email', n.email, 'email to approve', 'emails to approve');
    push('call', n.call, 'call to make', 'calls to make');
    if (janTextWaiting(janText)) chips.push(janText.approvable === false ? { kind: 'jan_text', n: null, words: 'Jan\'s text cannot be approved yet' } : { kind: 'jan_text', n: 1, words: 'Jan\'s text to approve' });
    push('jan', n.jan, 'Jan visit to approve', 'Jan visits to approve');
    push('statement', n.statement, 'builder statement to approve', 'builder statements to approve');
    push('reminder', n.reminder, 'deposit reminder to approve', 'deposit reminders to approve');
    return { chips: chips, wait: n.wait, held: n.held };
  }
  // The one line at the top of Today: what there is to do, counted from the list. Jan's text counts once.
  function todaySummary(items, janText) {
    var n = todoCounts(items, janText);
    var todo = [];
    if (n.text) todo.push(plural(n.text, 'text', 'texts') + ' to approve');
    if (n.email) todo.push(plural(n.email, 'email', 'emails') + ' to approve');
    if (n.call) todo.push(plural(n.call, 'call', 'calls') + ' to make');
    if (janTextWaiting(janText)) todo.push(janText.approvable === false ? 'Jan\'s text cannot be approved yet' : 'Jan\'s text to approve (' + plural((janText.visits || []).length, 'visit', 'visits') + ')');
    if (n.jan) todo.push(plural(n.jan, 'Jan visit', 'Jan visits') + ' to approve');
    if (n.reminder) todo.push(plural(n.reminder, 'deposit reminder', 'deposit reminders') + ' to approve');
    if (n.statement) todo.push(plural(n.statement, 'builder statement', 'builder statements') + ' to approve');
    var line = todo.length ? todo.join(', ') + '.' : 'Nothing to do right now.';
    if (n.wait) line += ' ' + n.wait + ' waiting for a draft, nothing to do yet.';
    if (n.held) line += ' ' + n.held + ' on hold, just so you know.';
    return line;
  }

  // The Today tab's left menu: the chase groups in chase order, then On hold and Done today.
  // Each section lists one row per payer: { id, section, type: item | jan_text | held | sent }.
  // Jan's morning text is the first row of Jan visits; Done today is what went out today (sent_today).
  // A group the screen does not know lands in Other (shown only when it has rows), never dropped.
  var WORK = GROUPS.concat([{ key: 'other', label: 'Other', hideEmpty: true }]);
  var SECTIONS = WORK.concat([{ key: 'hold', label: 'On hold', quiet: true }, { key: 'done', label: 'Done today', quiet: true }]);
  function todaySections(morning) {
    var m = morning || {}, items = sortMorning(m.items || []), jt = m.jan_text || null, rows = {};
    SECTIONS.forEach(function (s) { rows[s.key] = []; });
    if (jt) rows.jan.push({ id: 'jan_text', section: 'jan', type: 'jan_text', jt: jt });
    items.forEach(function (i) { var g = groupRank(i.group) < GROUPS.length ? i.group : 'other'; rows[g].push({ id: i.id, section: g, type: 'item', item: i }); });
    heldItems(m.items).forEach(function (i) { rows.hold.push({ id: i.id, section: 'hold', type: 'held', item: i }); });
    (m.sent_today || []).forEach(function (s, k) { rows.done.push({ id: 'sent:' + (s.draft_id || k), section: 'done', type: 'sent', sent: s }); });
    return rows;
  }
  function rowKind(r, janText) { return r.type === 'item' ? cardAction(r.item, janText).kind : r.type; }
  // Still something to press: a pending draft (Jan's text only when approvable), or a call not yet logged.
  // done is { item id: true } for outcomes logged on this screen since the list was read.
  function rowUnfinished(r, janText, done) {
    if (r.type === 'jan_text') return r.jt.status === 'pending' && r.jt.approvable !== false;
    if (r.type !== 'item') return false;
    var k = rowKind(r, janText);
    return k === 'call' ? !(done && done[r.id]) : needsDecision(r.item, janText);
  }
  function workRows(rows) { return WORK.reduce(function (a, g) { return a.concat(rows[g.key] || []); }, []); }
  function firstWorkSection(rows, janText, done) {
    var r = workRows(rows).filter(function (x) { return rowUnfinished(x, janText, done); })[0];
    if (r) return r.section;
    var any = SECTIONS.filter(function (s) { return (rows[s.key] || []).length; })[0];
    return any ? any.key : WORK[0].key;
  }
  // Next to do: the next unfinished row after the one selected, in menu order, wrapping round.
  function nextTodo(rows, currentId, janText, done) {
    var all = workRows(rows), at = -1;
    for (var i = 0; i < all.length; i++) if (all[i].id === currentId) at = i;
    for (var j = 1; j <= all.length; j++) { var r = all[(at + j) % all.length]; if (r.id !== currentId && rowUnfinished(r, janText, done)) return r; }
    return null;
  }

  function sendButtonHtml() {
    // No handler, no id: a disabled stamp with a handler is a send path waiting to be switched on by accident.
    return '<button type="button" class="cdd-btn send" disabled aria-disabled="true" title="' + SEND_LABEL + '">' + SEND_LABEL + '</button>';
  }

  function outcomeProblem(o, today) {
    var known = OUTCOMES.some(function (x) { return x.code === o.code; });
    if (!known) return 'Pick what happened first';
    if (o.code !== 'promised') return null;
    var amt = Number(o.amount);
    if (!(amt > 0) || !isFinite(amt)) return 'Put the promised amount in first';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.date || ''))) return 'Put the promised date in first';
    if (daysPast(o.date, today) > 0) return 'The promised date is in the past';
    return null;
  }

  var PROMISE_RANK = { broken: 0, open: 1, kept: 2 };
  // Promises live in two places on debt_morning_list: a broken (or kept) one rides on its item,
  // an open one pauses chasing and sits in the top-level paused[] list instead.
  function promiseRow(i, resumesOn) {
    return { payer_key: i.payer_key, payer_name: i.payer_name, invoice_numbers: (i.invoices || []).map(function (x) { return x.invoice_number; }), promised_amount: i.promise.amount == null ? null : i.promise.amount, promised_date: i.promise.date, status: i.promise.status || 'open', resumes_on: resumesOn || null };
  }
  function promisesFromMorning(morning) {
    var items = (morning && morning.items) || [];
    var paused = (morning && morning.paused) || [];
    var rows = items.filter(function (i) { return i.promise; }).map(function (i) { return promiseRow(i); })
      .concat(paused.filter(function (p) { return p.promise; }).map(function (p) { return promiseRow(p, p.resumes_on); }));
    return rows.sort(sortPromises);
  }
  function anyDrafts(items, janText) { return !!janText || (items || []).some(function (i) { return !!i.draft; }); }
  function sortPromises(a, b) {
    var r = (PROMISE_RANK[a.status] === undefined ? 1 : PROMISE_RANK[a.status]) - (PROMISE_RANK[b.status] === undefined ? 1 : PROMISE_RANK[b.status]);
    return r || String(a.promised_date || '').localeCompare(String(b.promised_date || ''));
  }
  // The backend's deposit set: a client's deposits and invoices before the job's first payment.
  // Those the morning list never chases (its not_chased[]) are set apart with its reason, outside the total.
  function depositsFromBook(invoices, today, notChased) {
    var why = {}; (notChased || []).forEach(function (n) { why[n.invoice_number] = n.reason || 'Not chased'; });
    var res = { rows: [], apart: [] };
    (invoices || []).filter(function (i) { return i.payer === 'client' && !i.is_debt && (i.kind === 'deposit' || i.not_debt_reason === 'before_first_payment'); }).map(function (i) {
      var copy = {}; Object.keys(i).forEach(function (k) { copy[k] = i[k]; });
      copy.days_since_invoice = daysPast(i.invoice_date, today);
      return copy;
    }).sort(function (a, b) { return String(a.invoice_date || '').localeCompare(String(b.invoice_date || '')); }).forEach(function (r) {
      if (Object.prototype.hasOwnProperty.call(why, r.invoice_number)) { r.not_chased_reason = why[r.invoice_number]; res.apart.push(r); } else res.rows.push(r);
    });
    return res;
  }
  function isNotDeployed(e) { return !!e && (/unknown action/i.test(String(e.message || '')) || e.status === 404); }

  return { SENDING_ON: SENDING_ON, SEND_LABEL: SEND_LABEL, GROUPS: GROUPS, OUTCOMES: OUTCOMES, JAN_OUTCOMES: JAN_OUTCOMES, OUTCOME_STEPS: OUTCOME_STEPS, outcomesFor: outcomesFor, outcomeLabel: outcomeLabel, lastOutcomeLabel: lastOutcomeLabel, outcomeChannel: outcomeChannel, inJanText: inJanText, janTextWaiting: janTextWaiting, IN_JAN_WORDS: IN_JAN_WORDS, NOT_IN_JAN_WORDS: NOT_IN_JAN_WORDS, groupRank: groupRank, PAYERS: PAYERS, AGES: AGES, perthDate: perthDate, daysPast: daysPast, ageBucket: ageBucket, bookTotals: bookTotals, money: money, money0: money0, perthTime: perthTime, stampText: stampText, newestStamp: newestStamp, sortMorning: sortMorning, isHeld: isHeld, chaseItems: chaseItems, heldItems: heldItems, waitingCount: waitingCount, janFromMorning: janFromMorning, janHeldFromMorning: janHeldFromMorning, outcomeScheduleStep: outcomeScheduleStep, cardAction: cardAction, needsDecision: needsDecision, todaySummary: todaySummary, todoChips: todoChips, SECTIONS: SECTIONS, todaySections: todaySections, rowKind: rowKind, rowUnfinished: rowUnfinished, firstWorkSection: firstWorkSection, nextTodo: nextTodo, WORK_KEYS: WORK.map(function (g) { return g.key; }), WAIT_WORDS: WAIT_WORDS, sendButtonHtml: sendButtonHtml, outcomeProblem: outcomeProblem, promisesFromMorning: promisesFromMorning, anyDrafts: anyDrafts, sortPromises: sortPromises, depositsFromBook: depositsFromBook, isNotDeployed: isNotDeployed };
})();
// </clear-debt-desk-core>

var CDD = { tab: null, sec: null, sel: null, gen: 0, today: null, book: null, bookErr: null, morning: null, morningErr: null, edits: {}, ticked: {}, logged: {}, editing: {}, open: {}, promOpen: {}, outIn: {} };
var CDD_TABS = [
  { key: 'today', label: 'Today' },
  { key: 'book', label: 'Debt book' },
  { key: 'promises', label: 'Promises' },
  { key: 'jan', label: 'Jan' },
  { key: 'deposits', label: 'Deposits' },
];
// Layout B for Today, the captain's pick, is preview-only: ops.html?view=clear-debt-preview sets
// window.__SW_CLEAR_DEBT_PREVIEW. To make it what staff see, set CDD_LAYOUT_B_LIVE = true (one line).
var CDD_LAYOUT_B_LIVE = false;
function cddPreview() { return typeof window !== 'undefined' && !!window.__SW_CLEAR_DEBT_PREVIEW; }
function cddLayoutB() { return CDD_LAYOUT_B_LIVE || cddPreview(); }
function cddPreviewBannerHtml() {
  if (!cddPreview() || CDD_LAYOUT_B_LIVE) return '';
  return '<div class="cdd-preview" id="cddPreviewBanner" role="note"><b>PREVIEW - not what staff see.</b> This is the new Clear Debt layout on real data. The live Clear Debt tab is unchanged until Shaun says make it live. Buttons here are real: approving queues the text and logging saves it, just as on the live tab.</div>';
}
var CDD_PAYER_LABEL = { client: 'Client', mlb: 'MLB', aj: 'AJ', other_builder: 'Builder', not_chased: 'Not chased' };

function cddEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
// The backend's Perth date wins, so the screen and the rules it applied count the same day.
function cddToday() { return CDD.today || (CDD.book && CDD.book.perth_date) || (CDD.morning && CDD.morning.perth_date) || ClearDebtDeskCore.perthDate(new Date()); }
function cddDateWords(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}
function cddAgePill(days) {
  if (days === null || days === undefined) return '<span class="cd-pill n">no due date</span>';
  var c = days <= 0 ? 'ok' : days <= 30 ? 'n' : days <= 60 ? 'w' : 'b';
  return '<span class="cd-pill ' + c + '">' + (days > 0 ? days + (days === 1 ? ' day' : ' days') : 'not due') + '</span>';
}
function cddJanText() { return (CDD.morning && CDD.morning.jan_text) || null; }
// +61411222333 reads as 0411 222 333; anything else is shown as sent.
function cddPhoneWords(p) { var m = /^\+614(\d{2})(\d{3})(\d{3})$/.exec(String(p || '')); return m ? '04' + m[1] + ' ' + m[2] + ' ' + m[3] : String(p || ''); }
function cddXero(xid, label) { return '<a class="cd-lnk" target="_blank" rel="noopener" href="https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=' + cddEsc(xid) + '" title="Open in Xero">' + cddEsc(label) + '</a>'; }
function cddPend(title, body) { return '<div class="cd-pend"><b>' + cddEsc(title) + '</b> ' + cddEsc(body || '') + '</div>'; }
function cddFail(what, e) {
  return ClearDebtDeskCore.isNotDeployed(e)
    ? cddPend(what + ' is not live yet.', 'The backend part has not been deployed. Nothing is guessed in its place.')
    : '<div class="cd-err">' + cddEsc(what) + ' could not be read: ' + cddEsc(e && e.message) + '. <button class="cdd-link" onclick="loadClearDebt()">Read again</button></div>';
}

function cddCss() {
  if (document.getElementById('cdd-css')) return;
  var s = document.createElement('style'); s.id = 'cdd-css';
  s.textContent = '\
#subCleardebt{--cddor:var(--sw-orange,#F15A29);--cddord:var(--sw-orange-hover,#C4481F);--cddort:var(--sw-orange-tint,#FDF2EE);--cdddark:var(--sw-dark,#293C46);--cdddeep:var(--sw-dark-deep,#1A272E);--cddmid:var(--sw-mid,#4C6A7C);--cddmidl:var(--sw-mid-light,#8FA4B2);--cddline:var(--sw-border,#D4DEE4);--cddcard:var(--sw-card,#FCFBFA);--cddwarm:var(--sw-warm-200,#F0ECE8);--cddsage:var(--sw-sage-deep,#4A7259);--cddsaget:var(--sw-sage-tint,#E7EFE8)}\
.cdd-head{display:grid;grid-template-columns:minmax(260px,1fr) 1.6fr;gap:28px;align-items:end}\
.cdd-h1{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--cddmid);margin:0 0 8px;font-weight:600;display:flex;gap:10px;align-items:center}\
.cdd-big{font-size:52px;font-weight:700;letter-spacing:-.03em;line-height:.95;color:var(--cdddeep);font-variant-numeric:tabular-nums}.cdd-big small{font-size:15px;font-weight:400;letter-spacing:0;color:var(--cddmid);margin-left:12px}\
.cdd-held{margin-top:8px;font-size:13px;color:var(--cddmid)}\
.cdd-stamp{display:inline-flex;align-items:center;gap:7px;margin-top:12px;padding:4px 11px;border-radius:100px;font-size:12.5px;font-weight:600}.cdd-stamp.ok{background:var(--cddsaget);color:var(--cddsage)}.cdd-stamp.warn{background:#FBEEDB;color:#B8741C}.cdd-stamp.n{background:var(--cddwarm);color:var(--cddmid)}\
.cdd-figs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--cddline);border:1px solid var(--cddline)}.cdd-fig{background:var(--cddcard);padding:12px 14px}.cdd-fig .l{font-size:12px;color:var(--cddmid);min-height:32px}.cdd-fig .v{font-size:19px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--cdddeep)}.cdd-fig .c{font-size:12px;color:var(--cddmidl)}.cdd-fig.hi .v{color:var(--cddor)}\
.cdd-tabs{display:flex;gap:2px;border-bottom:1px solid var(--cddline);margin:22px 0 0;flex-wrap:wrap}.cdd-tabs button{background:none;border:0;border-bottom:3px solid transparent;padding:10px 14px;font-size:14px;font-weight:600;color:var(--cddmid);cursor:pointer}.cdd-tabs button.on{color:var(--cdddeep);border-bottom-color:var(--cddor)}.cdd-tabs button em{font-style:normal;font-weight:400;color:var(--cddmidl);margin-left:6px}\
.cdd-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:16px 0 4px;flex-wrap:wrap}.cdd-bar .t{font-size:13px;color:var(--cddmid)}.cdd-bar .t b{color:var(--cdddeep)}\
.cdd-grp{display:flex;justify-content:space-between;align-items:baseline;margin:22px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--cddline)}.cdd-grp b{font-size:15px}.cdd-grp span{font-size:13px;color:var(--cddmid);font-variant-numeric:tabular-nums}\
.cdd-item{background:var(--cddcard);border:1px solid var(--cddline);box-shadow:var(--sw-shadow);margin-bottom:10px;padding:14px 16px}.cdd-item.hold{background:#FBFAF8;border-style:dashed}\
.cdd-top{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:start}.cdd-top input[type=checkbox]{margin-top:4px;width:16px;height:16px}\
.cdd-nm{font-size:16px;font-weight:700;color:var(--cdddeep)}.cdd-sub{font-size:12.5px;color:var(--cddmid);margin-top:2px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}\
.cdd-chip{display:inline-block;padding:1px 9px;border-radius:100px;font-size:11.5px;font-weight:600;background:var(--cddwarm);color:var(--cddmid)}.cdd-chip.step{background:var(--cddort);color:var(--cddord)}.cdd-chip.dark{background:var(--cdddark);color:#fff}\
.cdd-amt{text-align:right;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--cdddeep)}.cdd-amt small{display:block;font-size:12px;font-weight:400;color:var(--cddmid);margin-top:3px}\
.cdd-invs{font-size:13px;color:var(--cddmid);margin-top:8px;display:flex;gap:10px;flex-wrap:wrap}\
.cdd-why{margin-top:10px;padding:9px 12px;background:var(--cddwarm);font-size:13px;color:var(--cddmid)}.cdd-why b{color:var(--cdddeep)}\
.cdd-draft{margin-top:12px}.cdd-draft textarea{width:100%;border:1px solid var(--cddline);padding:9px 11px;font:inherit;font-size:14px;line-height:1.45;background:#fff;resize:vertical;border-radius:var(--sw-radius-sm,3px)}.cdd-draft textarea:focus{outline:0;border-color:var(--cddor)}.cdd-draft textarea[readonly]{background:var(--cddwarm);color:var(--cddmid)}\
.cdd-acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}.cdd-acts .st{font-size:12.5px;color:var(--cddmid)}\
.cdd-btn{border:1px solid var(--cdddark);background:var(--cdddark);color:#fff;padding:7px 13px;font-size:13px;font-weight:600;cursor:pointer;border-radius:var(--sw-radius-sm,3px)}.cdd-btn.o{background:var(--cddor);border-color:var(--cddor)}.cdd-btn.l{background:#fff;color:var(--cdddark)}.cdd-btn:disabled{cursor:default}#subCleardebt .cdd-btn:disabled:not(.send){background:#fff;color:var(--cddmidl);border-color:var(--cddline);opacity:1}.cdd-btn.send{background:#fff;color:var(--cddmid);border:1px dashed var(--cddmidl);opacity:1}\
.cdd-link{background:none;border:0;padding:0;color:inherit;text-decoration:underline;cursor:pointer;font:inherit}.cdd-link.sm{font-size:13px;color:var(--cddmid);padding:4px 2px}.cdd-link.sm:hover{color:var(--cddord)}\
.cdd-btn.big{padding:10px 20px;font-size:15px;text-decoration:none;display:inline-block}a.cdd-btn.o.big:hover,button.cdd-btn.o.big:hover:not(:disabled){background:var(--cddord);border-color:var(--cddord)}\
#subCleardebt .cdd-btn{color:#fff;font-weight:600;font-size:13px}#subCleardebt .cdd-btn.l{color:var(--cdddark)}#subCleardebt .cdd-btn.send{color:var(--cddmid)}#subCleardebt .cdd-btn.big{font-size:15px}#subCleardebt .cdd-link.sm{font-size:13px;color:var(--cddmid)}#subCleardebt .cdd-link.sm:hover{color:var(--cddord)}#subCleardebt .cdd-obtns button{color:var(--cdddark);font-size:12.5px;font-weight:600}\
.cdd-todo{margin:18px 0 0;font-size:17px;font-weight:700;color:var(--cdddeep);line-height:1.35}.cdd-off{margin-top:4px;font-size:13px;color:var(--cddmid)}\
.cdd-preview{margin:0 0 14px;padding:10px 14px;background:#FBEEDB;border:2px solid #B8741C;color:#7A4A0E;font-size:13.5px;line-height:1.45;border-radius:var(--sw-radius-sm,3px)}.cdd-preview b{font-size:14px;letter-spacing:.04em}\
.cdd-todobar{margin:2px 0 0;padding:12px 16px;background:var(--cdddeep);color:#fff;display:flex;gap:8px 10px;align-items:center;flex-wrap:wrap;border-radius:var(--sw-radius-sm,3px)}.cdd-todobar>b{font-size:15px;margin-right:4px}.cdd-offb{margin-top:6px;font-size:13px;color:var(--cddmid)}\
#subCleardebt .cdd-tchip{background:rgba(255,255,255,.12);border:0;color:#fff;border-radius:8px;padding:6px 11px;font-size:13.5px;font-weight:500;cursor:pointer;font-family:inherit}#subCleardebt .cdd-tchip:hover{background:rgba(255,255,255,.22)}.cdd-tchip strong{color:#FFB599;font-size:17px;margin-right:5px;font-variant-numeric:tabular-nums}.cdd-tnone{font-size:14px;color:#DCE4EA}.cdd-tnote{font-size:12.5px;color:#9FB3C0}\
#subCleardebt .cdd-go{margin-left:auto;background:var(--cddor);border:0;color:#fff;padding:8px 16px;font-size:14px;font-weight:700;cursor:pointer;border-radius:var(--sw-radius-sm,3px);font-family:inherit}#subCleardebt .cdd-go:hover:not(:disabled){background:var(--cddord)}#subCleardebt .cdd-go:disabled{background:rgba(255,255,255,.12);color:#9FB3C0;cursor:default}\
.cdd-desk{display:grid;grid-template-columns:200px minmax(0,1fr) 340px;margin-top:14px;background:var(--cddcard);border:1px solid var(--cddline);box-shadow:var(--sw-shadow);min-height:340px}\
.cdd-side{border-right:1px solid var(--cddline);padding:8px 0}#subCleardebt .cdd-side button{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;background:none;border:0;border-left:3px solid transparent;padding:9px 14px;font:inherit;font-size:14px;color:var(--cdddark);text-align:left;cursor:pointer}#subCleardebt .cdd-side button:hover{background:var(--cddwarm)}#subCleardebt .cdd-side button.on{background:var(--cddort);border-left-color:var(--cddor);font-weight:700;color:var(--cdddeep)}#subCleardebt .cdd-side button.quiet{color:var(--cddmidl)}#subCleardebt .cdd-side button.quiet.on{color:var(--cdddeep)}\
.cdd-cnt{background:var(--cddwarm);border-radius:100px;padding:0 8px;font-size:12px;font-weight:700;color:var(--cdddark);font-variant-numeric:tabular-nums}.cdd-side .on .cdd-cnt{background:var(--cddor);color:#fff}.cdd-sep{border-top:1px solid var(--cddline);margin:6px 0}\
.cdd-secsel{display:none;width:100%;padding:9px 10px;font:inherit;font-size:14px;border:0;border-bottom:1px solid var(--cddline);background:var(--cddort);color:var(--cdddeep);font-weight:700}\
.cdd-main{min-width:0;border-right:1px solid var(--cddline)}.cdd-tbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--cddline)}.cdd-tbar b{font-size:16px;color:var(--cdddeep)}.cdd-tsum{color:var(--cddmid);font-size:13px;margin-left:6px;font-variant-numeric:tabular-nums}.cdd-empty{padding:12px}\
.cdd-twrap{overflow-x:auto}.cdd-rows{width:100%;border-collapse:collapse;font-size:13.5px}.cdd-rows th{text-align:left;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--cddmid);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--cddline);background:var(--cddwarm);white-space:nowrap}.cdd-rows td{padding:9px 10px;border-bottom:1px solid var(--cddwarm);vertical-align:top;font-variant-numeric:tabular-nums}.cdd-rows th.r,.cdd-rows td.r{text-align:right}.cdd-rows td.amt{font-weight:700;color:var(--cdddeep);white-space:nowrap}.cdd-rows th.tk,.cdd-rows td.tk{width:28px;padding-right:0}.cdd-rows td.tk input{width:16px;height:16px;margin:2px 0 0}\
.cdd-rows tr[data-cdd-row]{cursor:pointer}.cdd-rows tr[data-cdd-row]:hover td{background:#FBF8F5}.cdd-rows tr.sel td,.cdd-rows tr.sel:hover td{background:var(--cddort)}.cdd-rows tr.sel td:first-child{box-shadow:inset 3px 0 0 var(--cddor)}.cdd-rows tr[data-cdd-row]:focus{outline:2px solid var(--cddor);outline-offset:-2px}\
.cdd-rows td.inv{white-space:nowrap}.cdd-rn{color:var(--cdddeep);white-space:nowrap}.cdd-rs{font-size:12px;color:var(--cddmid);margin-top:2px}.cdd-rst{font-weight:600;color:var(--cddsage)}.cdd-rows td.lc{font-size:12.5px;color:var(--cddmid)}.cdd-rows td.msgp{font-size:12.5px;color:var(--cddmid);min-width:160px}.cdd-rows td.msgp span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\
.cdd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}\
.cdd-detail{padding:14px 16px;min-width:0}.cdd-pane .cdd-top.p{grid-template-columns:minmax(0,1fr) auto}.cdd-pane .cdd-nm{font-size:17px}.cdd-pane.hold .cdd-why{background:#FBFAF8;border:1px dashed var(--cddline)}\
.cdd-out.inline{display:block;margin-top:14px}.cdd-wh{font-weight:700;color:var(--cdddark);font-size:14px}.cdd-out.inline .cdd-outin{margin-top:6px;padding-top:0;border-top:0}.cdd-out.inline .cdd-said{display:block;margin-top:6px}.cdd-hist{margin-top:14px;padding-top:10px;border-top:1px solid var(--cddline);font-size:12.5px;color:var(--cddmid)}\
.cdd-msg{padding:10px 12px;background:#fff;border:1px solid var(--cddline);border-left:3px solid var(--cddor);font-size:14px;line-height:1.45;color:var(--cdddark);white-space:pre-wrap;border-radius:var(--sw-radius-sm,3px)}\
.cdd-wait{margin-top:12px;font-size:13.5px;color:var(--cddmid);font-style:italic}\
.cdd-out{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}.cdd-out details{flex:1 1 100%}.cdd-out summary{list-style:none;cursor:pointer;display:inline-block}.cdd-out summary::-webkit-details-marker{display:none}\
.cdd-logl{font-size:12.5px;color:var(--cddmid);text-decoration:underline}.cdd-logl:hover{color:var(--cddord)}\
.cdd-outin{margin-top:10px;padding-top:10px;border-top:1px solid var(--cddline);display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}\
.cdd-prom[hidden]{display:none}\
.cdd-obtns{display:flex;gap:6px;flex-wrap:wrap}.cdd-obtns button{border:1px solid var(--cddline);background:#fff;font-size:12.5px;padding:5px 11px;border-radius:100px;color:var(--cdddark);cursor:pointer;font-weight:600}.cdd-obtns button:hover{border-color:var(--cddor);color:var(--cddord)}\
.cdd-prom{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:4px 8px;border:1px solid var(--cddline);background:#fff;border-radius:var(--sw-radius-sm,3px);font-size:13px;color:var(--cddmid)}.cdd-prom input{border:1px solid var(--cddline);padding:4px 7px;font:inherit;font-size:13px;width:110px;border-radius:var(--sw-radius-sm,3px)}.cdd-prom input[type=date]{width:140px}\
.cdd-note{flex:1 1 180px;min-width:150px;border:1px solid var(--cddline);padding:5px 8px;font:inherit;font-size:13px;border-radius:var(--sw-radius-sm,3px)}\
.cdd-said{font-size:12.5px;color:var(--cddsage);font-weight:600}.cdd-said.bad{color:#B93A2C}\
.cdd-tbl{width:100%;border-collapse:collapse;font-size:13.5px;background:var(--cddcard);border:1px solid var(--cddline)}.cdd-tbl th{text-align:left;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--cddmid);font-weight:600;padding:9px 12px;border-bottom:1px solid var(--cddline);background:var(--cddwarm)}.cdd-tbl td{padding:9px 12px;border-bottom:1px solid var(--cddwarm);font-variant-numeric:tabular-nums}.cdd-tbl td.r,.cdd-tbl th.r{text-align:right}.cdd-tbl tr.tot td{font-weight:700;border-top:1px solid var(--cddline)}\
.cdd-two{display:grid;grid-template-columns:1fr 1.4fr;gap:16px;margin-top:14px}.cdd-sec{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--cddmid);font-weight:600;margin:22px 0 8px}\
.cdd-foot{margin-top:14px;font-size:12.5px;color:var(--cddmidl)}\
.cdd-visits{margin:10px 0 0;padding-left:22px;font-size:13.5px;color:var(--cdddark);line-height:1.5}.cdd-visits li{margin-bottom:3px}.cdd-visits .m{color:var(--cddmid);font-variant-numeric:tabular-nums}\
@media(max-width:1180px){.cdd-desk{grid-template-columns:190px minmax(0,1fr)}.cdd-main{border-right:0}.cdd-detail{grid-column:2;border-top:1px solid var(--cddline)}}\
@media(max-width:760px){.cdd-desk{grid-template-columns:minmax(0,1fr)}.cdd-side{display:none}.cdd-secsel{display:block}.cdd-detail{grid-column:1}.cdd-rows .hn{display:none}.cdd-tbar b{font-size:15px}#subCleardebt .cdd-go{margin-left:0}}\
@media(max-width:900px){.cdd-head,.cdd-two{grid-template-columns:1fr}.cdd-figs{grid-template-columns:repeat(2,minmax(0,1fr))}.cdd-big{font-size:40px}.cdd-top{grid-template-columns:auto minmax(0,1fr)}.cdd-top .cdd-amt{grid-column:2;text-align:left}.cdd-tbl{font-size:12.5px}.cdd-tbl th,.cdd-tbl td{padding:7px 8px}}';
  document.head.appendChild(s);
}

// ── Load ──
function openClearDebt() {
  if (typeof showView === 'function') showView('financials');
  if (typeof showSubTab === 'function') showSubTab('cleardebt');
}
async function loadClearDebt() {
  if (typeof cdCss === 'function') cdCss();
  cddCss();
  if (!document.getElementById('clearDebtStats')) return;
  if (!CDD.tab) { var saved = null; try { saved = localStorage.getItem('sw_cd_tab'); } catch (e) {} CDD.tab = CDD_TABS.some(function (t) { return t.key === saved; }) ? saved : 'today'; }
  var gen = ++CDD.gen;
  CDD.loading = true;
  cddRender();
  var jobs = [
    opsFetch('debt_book').then(function (r) { return { book: r }; }, function (e) { return { bookErr: e }; }),
    opsFetch('debt_morning_list').then(function (r) { return { morning: r }; }, function (e) { return { morningErr: e }; }),
  ];
  var picture = typeof cdLoadPicture === 'function' ? cdLoadPicture() : null;
  var res = await Promise.all(jobs);
  if (gen !== CDD.gen) return; // a newer read superseded this one
  CDD.book = null; CDD.bookErr = null; CDD.morning = null; CDD.morningErr = null;
  CDD.ticked = {}; CDD.edits = {}; CDD.editing = {};
  res.forEach(function (r) { Object.keys(r).forEach(function (k) { CDD[k] = r[k]; }); });
  CDD.loading = false;
  cddRender();
  if (picture) { await picture; if (gen === CDD.gen && CDD.tab === 'book' && typeof cdRender === 'function') cdRender(); }
}
function cddTab(key) {
  CDD.tab = key; try { localStorage.setItem('sw_cd_tab', key); } catch (e) {}
  cddRender();
}

// ── Render ──
function cddRender() {
  var stats = document.getElementById('clearDebtStats'), tabs = document.getElementById('clearDebtFilters'), body = document.getElementById('clearDebtCards');
  if (!stats) return;
  stats.style.display = 'block'; tabs.style.display = 'block';
  stats.innerHTML = cddPreviewBannerHtml() + cddHeaderHtml();
  tabs.innerHTML = cddTabsHtml();
  body.innerHTML = cddBodyHtml();
  if (CDD.tab === 'book' && typeof cdRender === 'function') cdRender();
}

function cddHeaderHtml() {
  var C = ClearDebtDeskCore, today = cddToday();
  var dateLine = '<div class="cdd-h1">Clear Debt <span style="font-weight:400;letter-spacing:0;text-transform:none">' + cddEsc(cddDateWords(today)) + ', Perth</span> <button class="cdd-link" onclick="loadClearDebt()" style="font-size:12px;letter-spacing:0;text-transform:none;font-weight:400">Read again</button></div>';
  var waiting = CDD.morning ? String(C.waitingCount(CDD.morning.items, cddJanText())) : '–';
  var waitingSub = CDD.morning ? (C.anyDrafts(CDD.morning.items, cddJanText()) ? 'drafts to approve or skip' : 'no drafts written yet') : (CDD.loading ? 'reading' : 'morning list not live');
  if (!CDD.book) {
    var why = CDD.loading ? '<div class="cd-quiet">Reading the debt book from Xero…</div>' : cddFail('The live Xero read (debt_book)', CDD.bookErr);
    return '<div class="cdd-head"><div>' + dateLine + '<div class="cdd-h1" style="margin-top:14px">Overdue</div>' + why + '</div><div class="cdd-figs">' + cddFig('Waiting for Shaun', waiting, waitingSub, true) + '</div></div>';
  }
  var t = C.bookTotals(CDD.book.invoices, today), chk = CDD.book.copy_check || null, readAt = CDD.book.read_at || null;
  var stampCls = !chk ? 'n' : chk.matches ? 'ok' : 'warn';
  var held = t.overdueHeld.n ? '<div class="cdd-held">Of this, ' + C.money0(t.overdueHeld.amount) + ' on ' + t.overdueHeld.n + ' invoice' + (t.overdueHeld.n === 1 ? ' is' : 's is') + ' on hold (check first or fix first) and is not chased yet.</div>' : '<div class="cdd-held">Nothing overdue is on hold.</div>';
  return '<div class="cdd-head"><div>' + dateLine +
    '<div class="cdd-h1" style="margin-top:14px">Overdue</div><div class="cdd-big" id="cddOverdue">' + C.money0(t.overdue.amount) + '<small>' + t.overdue.n + ' invoice' + (t.overdue.n === 1 ? '' : 's') + '</small></div>' + held +
    '<div class="cdd-stamp ' + stampCls + '" id="cddStamp">' + (chk && chk.matches ? '&#10003; ' : '') + cddEsc(C.stampText(chk, readAt)) + '</div>' +
    (CDD.book.read_warning ? '<div class="cdd-held" id="cddReadWarning" style="color:#B8741C"><b>' + cddEsc(CDD.book.read_warning) + '.</b> Figures may be a few invoices out.</div>' : '') + '</div>' +
    '<div class="cdd-figs">' +
      cddFig('Debt, by your definition', C.money0(t.debt.amount), t.debt.n + ' invoices' + (t.noDue.n ? ', ' + t.noDue.n + ' with no due date' : '')) +
      cddFig('Open in Xero', C.money0(t.open.amount), t.open.n + ' invoices') +
      cddFig('Not debt', C.money0(t.notDebt.amount), t.notDebt.n + ' invoices, deposits and set aside') +
      cddFig('Check first', C.money0(t.checkFirst.amount), t.checkFirst.n + ' invoice' + (t.checkFirst.n === 1 ? '' : 's') + ', no draft until checked') +
      cddFig('Fix first', C.money0(t.fixFirst.amount), t.fixFirst.n + ' invoice' + (t.fixFirst.n === 1 ? '' : 's') + ', in rectification') +
      cddFig('Waiting for Shaun', waiting, waitingSub, true) +
    '</div></div>';
}
function cddFig(label, value, sub, hi) { return '<div class="cdd-fig' + (hi ? ' hi' : '') + '"><div class="l">' + cddEsc(label) + '</div><div class="v">' + cddEsc(value) + '</div><div class="c">' + cddEsc(sub || '') + '</div></div>'; }

function cddTabsHtml() {
  var C = ClearDebtDeskCore, items = CDD.morning ? CDD.morning.items || [] : null;
  var counts = {
    today: items ? C.chaseItems(items).length : null,
    promises: CDD.morning ? C.promisesFromMorning(CDD.morning).length : null,
    jan: items ? C.janFromMorning(items).length : null,
    deposits: CDD.book ? C.depositsFromBook(CDD.book.invoices, cddToday(), CDD.morning && CDD.morning.not_chased).rows.length : null,
  };
  return '<div class="cdd-tabs" role="tablist">' + CDD_TABS.map(function (t) {
    return '<button role="tab" data-cdd-tab="' + t.key + '" aria-selected="' + (CDD.tab === t.key) + '" class="' + (CDD.tab === t.key ? 'on' : '') + '" onclick="cddTab(\'' + t.key + '\')">' + t.label + (counts[t.key] != null ? '<em>' + counts[t.key] + '</em>' : '') + '</button>';
  }).join('') + '</div>';
}

function cddBodyHtml() {
  if (CDD.tab === 'book') return cddBookHtml();
  if (CDD.tab === 'promises') return cddPromisesHtml();
  if (CDD.tab === 'jan') return cddJanHtml();
  if (CDD.tab === 'deposits') return cddDepositsHtml();
  return cddLayoutB() ? cddTodayDeskHtml() : cddTodayHtml();
}

// ── Today: the morning list ──
function cddTodayHtml() {
  var C = ClearDebtDeskCore;
  if (!CDD.morning) return CDD.loading ? '<div class="cd-quiet" style="margin-top:16px">Building the morning list…</div>' : '<div style="margin-top:16px">' + cddFail('The morning list (debt_morning_list)', CDD.morningErr) + '</div>';
  var items = C.sortMorning(CDD.morning.items || []), jt = cddJanText(), sentHtml = cddSentTodayHtml(CDD.morning.sent_today), heldHtml = cddHeldHtml(C.heldItems(CDD.morning.items)) + cddAlsoHtml(CDD.morning);
  if (!items.length && !jt) return cddTodoHtml(CDD.morning.items) + '<div style="margin-top:16px">' + cddPend('Nobody to chase today.', 'Everyone is paid, promised, on hold or not due yet.') + '</div>' + sentHtml + heldHtml;
  var ticked = Object.keys(CDD.ticked).filter(function (k) { return CDD.ticked[k]; }).length;
  var h = cddTodoHtml(CDD.morning.items) +
    '<div class="cdd-bar"><span class="t">Morning list for <b>' + cddEsc(cddDateWords(cddToday())) + '</b>' + (CDD.morning.generated_at ? ', built ' + cddEsc(C.perthTime(CDD.morning.generated_at)) : '') + '.</span>' +
    '<span class="cdd-acts" style="margin:0"><button class="cdd-btn l" id="cddApproveTicked" ' + (ticked ? '' : 'disabled') + ' onclick="cddApproveTicked()">Approve ticked (' + ticked + ')</button>' + C.sendButtonHtml() + '</span></div>';
  // Jan's one morning text sits where the Jan visits start, before the cards it lists.
  var group = null, janDone = !jt;
  items.forEach(function (it) {
    var g = it.group;
    if (g !== group) {
      if (!janDone && C.groupRank(g) >= C.groupRank('jan')) { h += cddJanTextBlock(jt); janDone = true; }
      group = g;
      h += cddGroupHead(g, (C.GROUPS.filter(function (x) { return x.key === g; })[0] || { label: g }).label, items.filter(function (x) { return x.group === g; }));
    }
    h += cddItemHtml(it);
  });
  if (!janDone) h += cddJanTextBlock(jt);
  return h + sentHtml + heldHtml;
}
// The one line that says what to do this morning, and that approving only queues while sending is off.
function cddTodoHtml(items) {
  var C = ClearDebtDeskCore;
  return '<div class="cdd-todo" id="cddTodo">' + cddEsc(C.todaySummary(items, cddJanText())) + '</div>' +
    (C.SENDING_ON ? '' : '<div class="cdd-off" id="cddSendingOff">Sending is off until Shaun says go - approving now just queues them.</div>');
}
// What went out today. Once sent, a payer leaves today's list, so this is the only place it shows.
function cddSentTodayHtml(rows) {
  if (!rows || !rows.length) return '';
  return '<div class="cdd-sec">Sent today</div><table class="cdd-tbl" id="cddSentToday"><thead><tr><th>Time</th><th>To</th><th>Invoices</th><th>By</th></tr></thead><tbody>' + rows.map(function (r) {
    var who = r.to === 'jan' ? 'Jan\'s morning text' : (r.payer_name || 'No name');
    return '<tr data-cdd-sent="' + cddEsc(r.to || '') + '"><td>' + cddEsc(ClearDebtDeskCore.perthTime(r.at)) + '</td><td><b>' + cddEsc(who) + '</b>' + (r.text ? '<div class="cdd-foot" style="margin:2px 0 0;white-space:pre-wrap">' + cddEsc(r.text) + '</div>' : '') + '</td><td>' + cddEsc((r.invoice_numbers || []).join(', ')) + '</td><td>' + cddEsc(r.by || '') + '</td></tr>';
  }).join('') + '</tbody></table>';
}
function cddJanTextBlock(jt) {
  var n = (jt.visits || []).length;
  return '<div class="cdd-grp" data-cdd-group="jan_text"><b>Jan\'s morning text</b><span>one text to Jan · ' + n + ' visit' + (n === 1 ? '' : 's') + '</span></div>' + cddJanTextHtml(jt);
}
// ── Today, layout B (preview): the to-do bar, the section menu, the table and the detail panel ──
// The captain's pick. Shown only on the preview page (ops.html?view=clear-debt-preview) until
// CDD_LAYOUT_B_LIVE is switched on; the live Today tab is the morning list above, unchanged.
// The left menu picks a section, the table lists it one line per payer, and the panel on the right
// holds everything for the row picked: the message, its one button, what happened, the history.
function cddTodayDeskHtml() {
  var C = ClearDebtDeskCore;
  if (!CDD.morning) return CDD.loading ? '<div class="cd-quiet" style="margin-top:16px">Building the morning list…</div>' : '<div style="margin-top:16px">' + cddFail('The morning list (debt_morning_list)', CDD.morningErr) + '</div>';
  var rows = C.todaySections(CDD.morning), jt = cddJanText(), done = cddDoneIds();
  if (!CDD.sec || !rows[CDD.sec] || (CDD.sec === 'other' && !rows.other.length)) CDD.sec = C.firstWorkSection(rows, jt, done);
  var list = rows[CDD.sec], sel = list.filter(function (r) { return r.id === CDD.sel; })[0] || list[0] || null;
  CDD.sel = sel ? sel.id : null;
  return cddTodoBarHtml(CDD.morning.items, rows) +
    '<div class="cdd-desk" id="cddDesk">' + cddSideHtml(rows) +
      '<div class="cdd-main">' + cddSecTableHtml(CDD.sec, list, sel) + '</div>' +
      '<div class="cdd-detail" id="cddDetail">' + cddDetailHtml(sel) + '</div>' +
    '</div>' + cddAlsoHtml(CDD.morning);
}
// Calls logged on this screen since the list was read: they no longer count as still to do.
function cddDoneIds() { var d = {}; Object.keys(CDD.logged).forEach(function (k) { if (k.indexOf('i-') === 0) d[k.slice(2)] = true; }); return d; }
// The dark "To do today" bar: a chip per kind of work (press one to open its first row), Next to do,
// and the line that says approving only queues while sending is off.
function cddTodoBarHtml(items, rows) {
  var C = ClearDebtDeskCore, jt = cddJanText(), t = C.todoChips(items, jt), next = C.nextTodo(rows, CDD.sel, jt, cddDoneIds());
  var tail = [];
  if (t.wait) tail.push(t.wait + ' waiting for a draft');
  if (t.held) tail.push(t.held + ' on hold');
  return '<div class="cdd-todobar" id="cddTodo" role="region" aria-label="' + cddEsc(C.todaySummary(items, jt)) + '"><b>To do today:</b>' +
    (t.chips.length ? t.chips.map(function (c) { return '<button type="button" class="cdd-tchip" data-cdd-chip="' + c.kind + '" onclick="cddChip(this)">' + (c.n != null ? '<strong>' + c.n + '</strong>' : '') + cddEsc(c.words) + '</button>'; }).join('') : '<span class="cdd-tnone">Nothing to do right now.</span>') +
    (tail.length ? '<span class="cdd-tnote">' + cddEsc(tail.join(' · ')) + '</span>' : '') +
    '<button type="button" class="cdd-go" id="cddNext" ' + (next ? 'onclick="cddNextTodo()">Next to do &#8594;' : 'disabled>All done for now') + '</button></div>' +
    '<div class="cdd-offb"><span id="cddBuilt">Morning list for ' + cddEsc(cddDateWords(cddToday())) + (CDD.morning.generated_at ? ', built ' + cddEsc(C.perthTime(CDD.morning.generated_at)) : '') + '.</span>' +
    (C.SENDING_ON ? '' : ' <span id="cddSendingOff">Sending is off until Shaun says go - approving now just queues them.</span>') + '</div>';
}
function cddSecLabel(key) { return (ClearDebtDeskCore.SECTIONS.filter(function (s) { return s.key === key; })[0] || { label: key }).label; }
// The menu: a list on a wide screen, a select on a narrow one (CSS picks which shows).
function cddSideHtml(rows) {
  var secs = ClearDebtDeskCore.SECTIONS.filter(function (s) { return !s.hideEmpty || rows[s.key].length; });
  var btn = function (s) { return '<button type="button" role="tab" data-cdd-sec="' + s.key + '" aria-selected="' + (CDD.sec === s.key) + '" class="' + (CDD.sec === s.key ? 'on' : '') + (s.quiet ? ' quiet' : '') + '" onclick="cddPickSec(this.getAttribute(\'data-cdd-sec\'))"><span>' + cddEsc(s.label) + '</span><span class="cdd-cnt">' + rows[s.key].length + '</span></button>'; };
  return '<div class="cdd-side" role="tablist" aria-orientation="vertical" aria-label="Sections">' + secs.filter(function (s) { return !s.quiet; }).map(btn).join('') + '<div class="cdd-sep"></div>' + secs.filter(function (s) { return s.quiet; }).map(btn).join('') + '</div>' +
    '<select class="cdd-secsel" id="cddSecSelect" aria-label="Section" onchange="cddPickSec(this.value)">' + secs.map(function (s) { return '<option value="' + s.key + '"' + (CDD.sec === s.key ? ' selected' : '') + '>' + cddEsc(s.label) + ' (' + rows[s.key].length + ')</option>'; }).join('') + '</select>';
}
var CDD_MSG_SECTIONS = { broken_promise: 1, text: 1, statement: 1, deposit_reminder: 1, other: 1 };
var CDD_DRAFT_WORDS = { approved: 'Approved, queued', skipped: 'Skipped', sending: 'Sending not confirmed', sent: 'Sent' };
// One line per payer for the section picked. Texts and statements also show the start of the message.
function cddSecTableHtml(key, list, sel) {
  var C = ClearDebtDeskCore, jt = cddJanText(), done = cddDoneIds();
  var sum = list.reduce(function (a, r) { return a + Math.round(Number(cddRowAmount(r)) * 100); }, 0) / 100;
  var left = list.filter(function (r) { return C.rowUnfinished(r, jt, done); }).length;
  var ticked = Object.keys(CDD.ticked).filter(function (k) { return CDD.ticked[k]; }).length;
  var title = key === 'done' ? list.length + ' sent' : key === 'hold' ? list.length + ' held, no draft' : !list.length ? 'nobody today' : left ? left + ' to do' : 'nothing left to do';
  var h = '<div class="cdd-tbar"><span><b data-cdd-sec-title>' + cddEsc(cddSecLabel(key)) + ' - ' + cddEsc(title) + '</b>' + (key !== 'done' && list.length ? ' <span class="cdd-tsum">' + C.money0(sum) + '</span>' : '') + '</span>' +
    '<span class="cdd-acts" style="margin:0"><button class="cdd-btn l" id="cddApproveTicked" ' + (ticked ? '' : 'disabled') + ' onclick="cddApproveTicked()">Approve ticked (' + ticked + ')</button>' + C.sendButtonHtml() + '</span></div>';
  if (!list.length) return h + '<div class="cdd-empty">' + cddPend(key === 'done' ? 'Nothing sent yet today.' : key === 'hold' ? 'Nobody on hold.' : 'Nobody here today.', key === 'done' || key === 'hold' ? '' : 'Everyone is paid, promised, on hold or not due yet.') + '</div>';
  if (key === 'done') {
    return h + '<div class="cdd-twrap"><table class="cdd-rows" id="cddSentToday"><thead><tr><th>Time</th><th>To</th><th class="hn">Invoices</th><th>By</th></tr></thead><tbody>' + list.map(function (r) {
      var s = r.sent;
      return cddRowOpen(r, sel) + ' data-cdd-sent="' + cddEsc(s.to || '') + '"><td>' + cddEsc(C.perthTime(s.at)) + '</td><td><b>' + cddEsc(s.to === 'jan' ? 'Jan\'s morning text' : (s.payer_name || 'No name')) + '</b></td><td class="hn">' + cddEsc((s.invoice_numbers || []).join(', ')) + '</td><td>' + cddEsc(s.by || '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  var tick = list.some(function (r) { return cddRowTickId(r); }), msg = !!CDD_MSG_SECTIONS[key];
  return h + '<div class="cdd-twrap"><table class="cdd-rows" data-cdd-table="' + cddEsc(key) + '"><thead><tr>' + (tick ? '<th class="tk"><span class="cdd-sr">Tick</span></th>' : '') + '<th>Customer</th><th class="hn">Invoice</th><th>Overdue</th>' + (msg ? '<th class="hn">Message</th>' : '') + '<th class="hn">' + (key === 'hold' ? 'Why' : 'Last contact') + '</th><th class="r">Owing</th></tr></thead><tbody>' +
    list.map(function (r) { return cddRowHtml(r, sel, tick, msg); }).join('') + '</tbody></table></div>';
}
function cddRowAmount(r) {
  if (r.type === 'jan_text') return (r.jt.visits || []).reduce(function (a, v) { return a + Math.round(Number(v.amount || 0) * 100); }, 0) / 100;
  return r.item ? Number(r.item.amount || 0) : 0;
}
// The draft a row's tick approves: a pending draft that needs a decision, or Jan's text while approvable.
function cddRowTickId(r) {
  var jt = cddJanText();
  if (r.type === 'jan_text') return r.jt.status === 'pending' && r.jt.approvable !== false ? r.jt.id : null;
  return r.type === 'item' && ClearDebtDeskCore.needsDecision(r.item, jt) ? r.item.draft.id : null;
}
function cddRowOpen(r, sel) {
  var on = sel && sel.id === r.id;
  return '<tr data-cdd-row="' + cddEsc(r.id) + '" data-cdd-kind="' + cddEsc(ClearDebtDeskCore.rowKind(r, cddJanText())) + '" tabindex="0" aria-selected="' + !!on + '"' + (on ? ' class="sel"' : '') + ' onclick="cddPickRow(this)" onkeydown="cddRowKey(event,this)"';
}
// What a row is waiting on, in a word, under the payer's name.
function cddRowStatus(r) {
  var C = ClearDebtDeskCore, jt = cddJanText();
  if (r.type === 'jan_text') return r.jt.status === 'pending' ? (r.jt.approvable === false ? 'Cannot approve yet' : '') : (CDD_DRAFT_WORDS[r.jt.status] || r.jt.status);
  if (r.type === 'held') return r.item.hold === 'fix_first' ? 'Fix first' : r.item.hold === 'check_first' ? 'Check first' : 'On hold';
  var act = C.cardAction(r.item, jt), logged = CDD.logged['i-' + r.id];
  if (logged && !logged.bad) return logged.text;
  if (act.kind === 'done') return CDD_DRAFT_WORDS[r.item.draft.status] || r.item.draft.status;
  if (act.kind === 'wait') return 'Draft coming';
  if (act.kind === 'in_jan_text') return 'In Jan\'s text';
  if (act.kind === 'not_in_jan_text') return 'On tomorrow\'s Jan text';
  return '';
}
function cddRowHtml(r, sel, tick, msg) {
  var C = ClearDebtDeskCore, it = r.item, tid = cddRowTickId(r), st = cddRowStatus(r);
  var name = r.type === 'jan_text' ? 'Jan\'s morning text' : (it.payer_name || 'No name');
  var sub = r.type === 'jan_text' ? 'To Jan · ' + (r.jt.visits || []).length + ' visit' + ((r.jt.visits || []).length === 1 ? '' : 's') : r.type === 'held' ? '' : (it.step_label || '');
  var invs = r.type === 'jan_text' ? [].concat.apply([], (r.jt.visits || []).map(function (v) { return v.invoice_numbers || []; })) : (it.invoices || []).map(function (x) { return x.invoice_number; });
  var invWords = invs.slice(0, 2).join(', ') + (invs.length > 2 ? ' +' + (invs.length - 2) : '');
  var days = r.type === 'jan_text' ? null : (it.days_overdue === undefined ? null : it.days_overdue);
  var last = r.type === 'held' ? String(it.hold_reason || 'No reason given') : r.type === 'item' && it.last_outcome ? C.lastOutcomeLabel(it.last_outcome) + (it.last_outcome.at ? ', ' + cddDateWords(it.last_outcome.at) : '') : '–';
  var draft = r.type === 'jan_text' ? r.jt : it && it.draft, text = draft ? (CDD.edits[draft.id] != null ? CDD.edits[draft.id] : draft.text || '') : '';
  return cddRowOpen(r, sel) + '>' +
    (tick ? '<td class="tk">' + (tid ? '<input type="checkbox" aria-label="Tick to approve" ' + (CDD.ticked[tid] ? 'checked' : '') + ' data-draft="' + cddEsc(tid) + '" onclick="event.stopPropagation()" onchange="cddTick(this)">' : '') + '</td>' : '') +
    '<td class="cu"><b class="cdd-rn">' + cddEsc(name) + '</b>' + (sub || st ? '<div class="cdd-rs">' + cddEsc(sub) + (st ? (sub ? ' · ' : '') + '<span class="cdd-rst">' + cddEsc(st) + '</span>' : '') + '</div>' : '') + '</td>' +
    '<td class="hn inv">' + cddEsc(invWords) + '</td>' +
    '<td>' + (r.type === 'jan_text' ? '–' : cddAgePill(days)) + '</td>' +
    (msg ? '<td class="hn msgp"><span>' + cddEsc(text || '–') + '</span></td>' : '') +
    '<td class="hn lc">' + cddEsc(last) + '</td>' +
    '<td class="r amt">' + C.money(cddRowAmount(r)) + '</td></tr>';
}
// The panel for the row picked: the payer's card in full, with what happened laid open.
function cddDetailHtml(r) {
  if (!r) return '<div class="cdd-wait">Pick a row to see the message and what to do.</div>';
  if (r.type === 'jan_text') return cddJanTextHtml(r.jt, { panel: true });
  if (r.type === 'sent') {
    var s = r.sent;
    return '<div data-cdd-item="' + cddEsc(r.id) + '" data-cdd-kind="sent"><div class="cdd-nm">' + cddEsc(s.to === 'jan' ? 'Jan\'s morning text' : (s.payer_name || 'No name')) + '</div><div class="cdd-sub">Sent ' + cddEsc(ClearDebtDeskCore.perthTime(s.at)) + (s.by ? ' by ' + cddEsc(s.by) : '') + ((s.invoice_numbers || []).length ? ' · ' + cddEsc(s.invoice_numbers.join(', ')) : '') + '</div>' + (s.text ? '<div class="cdd-draft">' + cddMsgHtml(s.text) + '</div>' : '') + '</div>';
  }
  return cddItemHtml(r.item, { panel: true });
}
// The history line: what was last logged, as the list sends it (the promise has its own box above).
function cddHistoryHtml(it) {
  var C = ClearDebtDeskCore, lo = it.last_outcome;
  return '<div class="cdd-hist" data-cdd-history>History: ' + cddEsc(lo ? 'last time ' + C.lastOutcomeLabel(lo) + (lo.at ? ', ' + cddDateWords(lo.at) + ' ' + C.perthTime(lo.at) : '') + (lo.by ? ', ' + lo.by : '') : 'nothing logged yet') + '.</div>';
}
// What the list is not showing today, in one line: promises that pause chasing, payers waiting
// for a later step, invoices never chased, and the next builder statement day.
function cddAlsoHtml(m) {
  var bits = [], n;
  if ((n = (m.paused || []).length)) bits.push(n + (n === 1 ? ' is' : ' are') + ' paused on a promise to pay (see Promises)');
  if ((n = (m.waiting || []).length)) bits.push(n + ' waiting for a later chase or a due date');
  if ((n = (m.not_chased || []).length)) bits.push(n + ' invoice' + (n === 1 ? ' is' : 's are') + ' never chased (test, set aside or old contact)');
  if (m.next_statement_date) bits.push((m.is_statement_day ? 'builder statements are due today' : 'next builder statements ' + cddDateWords(m.next_statement_date)));
  return bits.length ? '<div class="cdd-foot" id="cddAlso">Not on today\'s list: ' + cddEsc(bits.join('; ')) + '.</div>' : '';
}
// ── Today: picking a section and a row ──
function cddPickSec(key) { CDD.sec = key; CDD.sel = null; cddRender(); }
function cddRowFocus() { var all = document.querySelectorAll('[data-cdd-row]'); for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-cdd-row') === CDD.sel) { all[i].focus(); return; } }
function cddPickRow(tr, focus) { CDD.sel = tr.getAttribute('data-cdd-row'); cddRender(); if (focus) cddRowFocus(); }
// Up and down walk the table, Enter or Space picks the row in focus.
function cddRowKey(e, tr) {
  if (e.target !== tr) return;
  var to = e.key === 'ArrowDown' ? tr.nextElementSibling : e.key === 'ArrowUp' ? tr.previousElementSibling : (e.key === 'Enter' || e.key === ' ') ? tr : null;
  if (!to) return;
  e.preventDefault(); cddPickRow(to, true);
}
function cddGoTo(r) { if (!r) return; CDD.sec = r.section; CDD.sel = r.id; cddRender(); cddRowFocus(); }
function cddNextTodo() { var C = ClearDebtDeskCore; cddGoTo(C.nextTodo(C.todaySections(CDD.morning), CDD.sel, cddJanText(), cddDoneIds())); }
// A chip opens the first row of its kind still to do (or the first of its kind when all are done).
function cddChip(btn) {
  var C = ClearDebtDeskCore, kind = btn.getAttribute('data-cdd-chip'), jt = cddJanText(), done = cddDoneIds(), rows = C.todaySections(CDD.morning);
  var all = C.WORK_KEYS.reduce(function (a, k) { return a.concat(rows[k]); }, []).filter(function (r) { return C.rowKind(r, jt) === kind; });
  cddGoTo(all.filter(function (r) { return C.rowUnfinished(r, jt, done); })[0] || all[0]);
}
// Jan's one morning text: who it goes to, the visits it lists, the words, and one Approve button.
// Not approvable (Jan's mobile not set, or too long for one text): the reason, and only Skip.
// opts.panel: drawn in the Today detail panel, where the tick lives on the table row instead.
function cddJanTextHtml(jt, opts) {
  var C = ClearDebtDeskCore, visits = jt.visits || [], pending = jt.status === 'pending', ok = jt.approvable !== false, panel = !!(opts && opts.panel);
  var total = visits.reduce(function (a, v) { return a + Math.round(Number(v.amount || 0) * 100); }, 0) / 100;
  var h = '<div class="' + (panel ? 'cdd-pane' : 'cdd-item') + '" data-cdd-jantext data-cdd-kind="jan_text"><div class="cdd-top' + (panel ? ' p' : '') + '">' +
    (panel ? '' : pending && ok ? '<input type="checkbox" aria-label="Tick to approve" ' + (CDD.ticked[jt.id] ? 'checked' : '') + ' data-draft="' + cddEsc(jt.id) + '" onchange="cddTick(this)">' : '<span></span>') +
    '<div><div class="cdd-nm">Jan\'s morning text</div><div class="cdd-sub"><span class="cdd-chip dark">To Jan</span><span data-cdd-jan-phone>' + cddEsc(jt.to_phone ? cddPhoneWords(jt.to_phone) : 'Jan\'s mobile not set') + '</span></div></div>' +
    '<div class="cdd-amt">' + C.money(total) + '<small>' + visits.length + ' visit' + (visits.length === 1 ? '' : 's') + '</small></div></div>';
  h += '<ol class="cdd-visits" data-cdd-visits>' + visits.map(function (v) {
    var d = Number(v.days_overdue);
    return '<li><b>' + cddEsc(v.payer_name || 'No name') + '</b>' + (v.site ? ', ' + cddEsc(v.site) : '') + ' <span class="m">' + cddEsc((v.invoice_numbers || []).join(', ')) + ' · ' + C.money(v.amount) + (isFinite(d) && v.days_overdue != null ? ' · ' + d + (d === 1 ? ' day' : ' days') + ' overdue' : '') + '</span>' + (v.broken_promise ? ' <span class="cdd-chip step">Promise broken</span>' : '') + '</li>';
  }).join('') + '</ol>';
  if (pending && !ok) h += '<div class="cdd-why" data-cdd-jan-problem><b>Cannot approve yet.</b> ' + cddEsc(String(jt.problem || 'The backend says this text cannot be approved').replace(/[.\s]*$/, '.')) + '</div>';
  return h + cddDraftHtml(jt, { kind: 'jan_text', approve: 'Approve Jan\'s text', blocked: !ok }) + '</div>';
}
function cddGroupHead(key, label, list) {
  var sum = list.reduce(function (a, x) { return a + Math.round(Number(x.amount || 0) * 100); }, 0) / 100;
  return '<div class="cdd-grp" data-cdd-group="' + cddEsc(key) + '"><b>' + cddEsc(label) + '</b><span>' + list.length + (key === 'hold' ? ' held' : ' to chase') + ' · ' + ClearDebtDeskCore.money0(sum) + '</span></div>';
}
function cddHeldHtml(held) { return held.length ? cddGroupHead('hold', 'On hold, no draft', held) + held.map(function (i) { return cddItemHtml(i); }).join('') : ''; }
// A payer's card: a Jan tab card, or (opts.panel) the Today detail panel, where the tick lives on the
// table row, What happened is laid open and the history line replaces Last time.
function cddItemHtml(it, opts) {
  var C = ClearDebtDeskCore, d = it.draft, jt = cddJanText(), held = C.isHeld(it), act = C.cardAction(it, jt), panel = !!(opts && opts.panel), tickable = !panel && C.needsDecision(it, jt);
  var invs = (it.invoices || []).map(function (x) { return x.xero_invoice_id ? cddXero(x.xero_invoice_id, x.invoice_number) + ' <span class="cd-num">' + C.money(x.amount_due) + '</span>' : cddEsc(x.invoice_number); }).join(' · ');
  var sub = '<span class="cdd-chip dark">' + cddEsc(CDD_PAYER_LABEL[it.payer] || it.payer || 'Other') + '</span>' + (it.step_label && !held ? '<span class="cdd-chip step">' + cddEsc(it.step_label) + '</span>' : '') + cddAgePill(it.days_overdue === undefined ? null : it.days_overdue);
  var h = '<div class="' + (panel ? 'cdd-pane' : 'cdd-item') + (held ? ' hold' : '') + '" data-cdd-item="' + cddEsc(it.id) + '" data-cdd-kind="' + act.kind + '"><div class="cdd-top' + (panel ? ' p' : '') + '">' +
    (panel ? '' : tickable ? '<input type="checkbox" aria-label="Tick to approve" ' + (CDD.ticked[d.id] ? 'checked' : '') + ' data-draft="' + cddEsc(d.id) + '" onchange="cddTick(this)">' : '<span></span>') +
    '<div><div class="cdd-nm">' + cddEsc(it.payer_name || 'No name') + '</div><div class="cdd-sub">' + sub + '</div></div>' +
    '<div class="cdd-amt">' + C.money(it.amount) + '<small>' + (it.invoices || []).length + ' invoice' + ((it.invoices || []).length === 1 ? '' : 's') + '</small></div></div>' +
    (invs ? '<div class="cdd-invs">' + invs + '</div>' : '');
  // Held cards are information only: the reason, and nothing to press.
  if (held) return h + '<div class="cdd-why"><b>' + (it.hold === 'fix_first' ? 'Fix first.' : it.hold === 'check_first' ? 'Check first.' : 'On hold.') + '</b> ' + cddEsc(String(it.hold_reason || 'No reason given').replace(/[.\s]*$/, '.')) + ' No draft until this is cleared.</div></div>';
  if (it.promise) h += '<div class="cdd-why"><b>Promise ' + cddEsc(it.promise.status || 'open') + ':</b> ' + (it.promise.amount == null ? 'payment' : C.money(it.promise.amount)) + ' by ' + cddEsc(cddDateWords(it.promise.date)) + '</div>';
  if (it.last_outcome && !panel) h += '<div class="cdd-foot">Last time: ' + cddEsc(C.lastOutcomeLabel(it.last_outcome)) + (it.last_outcome.at ? ', ' + cddEsc(cddDateWords(it.last_outcome.at)) + ' ' + cddEsc(C.perthTime(it.last_outcome.at)) : '') + (it.last_outcome.by ? ', ' + cddEsc(it.last_outcome.by) : '') + '</div>';
  h += cddActionHtml(it, act);
  h += cddOutcomeHtml({ payer_key: it.payer_key, ids: (it.invoices || []).map(function (x) { return x.xero_invoice_id; }).filter(Boolean), step: it.step, key: 'i-' + it.id, call: act.kind === 'call', inline: panel });
  return h + (panel ? cddHistoryHtml(it) : '') + '</div>';
}
var CDD_CHANNEL = { sms: 'Text', email: 'Email', call_script: 'What to say on the call' };
function cddMsgHtml(text) { return '<div class="cdd-msg">' + cddEsc(text) + '</div>'; }
// The card's one obvious button for its step, with the drafted message above it.
function cddActionHtml(it, act) {
  var d = it.draft;
  if (act.kind === 'wait' || act.kind === 'not_in_jan_text') return '<div class="cdd-wait">' + cddEsc(act.words) + '</div>';
  if (act.kind === 'in_jan_text') {
    var st = (cddJanText() || {}).status, more = { pending: 'waiting for your approval', approved: 'approved, queued until sending is switched on', skipped: 'skipped for today', sending: 'sending not confirmed', sent: 'sent to Jan' }[st];
    return '<div class="cdd-wait" data-cdd-injan>' + cddEsc(act.words + (more ? ', ' + more : '') + '.') + ' Log what Jan reports below.</div>';
  }
  if (act.kind === 'call') {
    var tel = String(it.phone || '').replace(/[^\d+]/g, '');
    return (d && d.text ? '<div class="cdd-draft"><div class="cd-k" style="margin-bottom:6px">' + CDD_CHANNEL.call_script + '</div>' + cddMsgHtml(d.text) + '</div>' : '') +
      '<div class="cdd-acts">' + (tel ? '<a class="cdd-btn o big" data-cdd-primary href="tel:' + cddEsc(tel) + '">Call now</a><span class="st">' + cddEsc(it.phone) + '</span>' : '<span class="st" data-cdd-nophone>No phone number on the list. Look it up in Xero, then ring.</span>') + '</div>';
  }
  return cddDraftHtml(d, act);
}
function cddDraftHtml(d, act) {
  var pending = d.status === 'pending', text = CDD.edits[d.id] != null ? CDD.edits[d.id] : (d.text || '');
  var channel = act.kind === 'jan_text' ? 'Text to Jan' : act.kind === 'jan' ? 'Jan\'s text' : act.kind === 'statement' ? 'Statement' : (CDD_CHANNEL[d.channel] || 'Draft');
  var h = '<div class="cdd-draft" data-draft="' + cddEsc(d.id) + '">';
  if (!pending) {
    var ls = d.last_send, status = {
      approved: 'Approved' + (d.approved_by ? ' by ' + d.approved_by : '') + '. Queued until sending is switched on.' + (ls && ls.reason ? ' Last try not sent: ' + ls.reason + '.' : ''),
      skipped: 'Skipped for today.',
      sending: 'Sending not confirmed' + (ls && ls.reason ? ': ' + ls.reason : '') + '. It will not be sent again today.',
      sent: 'Sent' + (d.decided_at ? ' ' + ClearDebtDeskCore.perthTime(d.decided_at) : '') + '.',
    }[d.status] || d.status;
    return h + '<div class="cd-k" style="margin-bottom:6px">' + cddEsc(channel) + '</div>' + cddMsgHtml(text) + '<div class="cdd-acts"><span class="st" data-cdd-said>' + cddEsc(status) + '</span></div></div>';
  }
  var editing = !act.blocked && (!!CDD.editing[d.id] || CDD.edits[d.id] != null);
  h += '<div class="cd-k" style="margin-bottom:6px">' + cddEsc(channel) + '</div>' +
    (editing ? '<textarea rows="3" oninput="cddEdit(this)" aria-label="' + cddEsc(channel) + ' draft">' + cddEsc(text) + '</textarea>' : cddMsgHtml(text));
  // A draft the backend will refuse gets a disabled button with no handler, so nothing can arm it.
  return h + '<div class="cdd-acts">' + (act.blocked ? '<button type="button" class="cdd-btn o big" disabled aria-disabled="true">' + cddEsc(act.approve) + '</button>' : '<button class="cdd-btn o big" data-cdd-primary onclick="cddDecide(this,\'approve\')">' + cddEsc(act.approve) + '</button>') +
    (editing || act.blocked ? '' : '<button class="cdd-link sm" onclick="cddEditOpen(this)">Edit</button>') +
    '<button class="cdd-link sm" onclick="cddDecide(this,\'skip\')">Skip</button><span class="st" data-cdd-said></span></div></div>';
}
// The morning list's own payer key for these invoices (clients: Xero contact id; builders: mlb,
// aj, other_builder:<label>), so an outcome logged from the Debt book matches the Today card's.
function cddPayerKeyFor(ids) {
  var m = CDD.morning; if (!m) return null;
  var want = {}; (ids || []).forEach(function (id) { want[String(id).toLowerCase()] = true; });
  var rows = (m.items || []).concat(m.paused || []);
  for (var i = 0; i < rows.length; i++) {
    var invs = rows[i].invoices || [];
    for (var j = 0; j < invs.length; j++) if (want[String(invs[j].xero_invoice_id || '').toLowerCase()]) return rows[i].payer_key || null;
  }
  return null;
}

// What happened: the outcome buttons, the promise box and a note, folded away behind one small
// link ("What happened?" as a button on a call card). The promise box opens only on Promised.
// A Jan visit offers what Jan reports (the list's schedule.jan_visit_outcomes). Shared with the Debt book payer record.
// o.inline (the Today detail panel): laid open under a "What happened?" heading, nothing folded.
function cddOutcomeHtml(o) {
  var k = o.key || 'x', key = cddEsc(k), said = CDD.logged[k], prom = !!CDD.promOpen[k], typed = CDD.outIn[k] || {};
  var btns = ClearDebtDeskCore.outcomesFor(o.step, CDD.morning && CDD.morning.schedule).map(function (x) {
    return x.code === 'promised'
      ? '<button type="button" data-cdd-promised aria-expanded="' + prom + '" onclick="cddPromiseOpen(this)">' + cddEsc(x.label) + '</button>'
      : '<button type="button" data-outcome="' + cddEsc(x.code) + '" onclick="cddOutcome(this,\'' + cddEsc(x.code) + '\')">' + cddEsc(x.label) + '</button>';
  }).join('');
  var inner = '<div class="cdd-outin"><span class="cdd-obtns">' + btns + '</span>' +
    '<span class="cdd-prom"' + (prom ? '' : ' hidden') + '>Promised $<input type="number" min="0" step="0.01" inputmode="decimal" aria-label="Promised amount" data-prom-amount value="' + cddEsc(typed.amount || '') + '" oninput="cddOutIn(this)"> by <input type="date" aria-label="Promised date" data-prom-date value="' + cddEsc(typed.date || '') + '" oninput="cddOutIn(this)"><span class="cdd-obtns"><button type="button" data-outcome="promised" onclick="cddOutcome(this,\'promised\')">Save promise</button></span></span>' +
    '<input class="cdd-note" type="text" placeholder="Note (optional)" aria-label="Note" data-out-note value="' + cddEsc(typed.note || '') + '" oninput="cddOutIn(this)"></div>';
  return '<div class="cdd-out' + (o.inline ? ' inline' : '') + '" data-cdd-out="' + key + '" data-payer="' + cddEsc(o.payer_key || '') + '" data-ids="' + cddEsc((o.ids || []).join(',')) + '" data-step="' + cddEsc(o.step || '') + '">' +
    (o.inline ? '<div class="cdd-wh">' + (o.step === 'jan_visit' ? 'What did Jan report?' : 'What happened?') + '</div>' + inner
      : '<details' + (CDD.open[k] ? ' open' : '') + ' ontoggle="cddLogToggle(this)"><summary class="' + (o.call ? 'cdd-btn l' : 'cdd-logl') + '">' + (o.call ? 'What happened?' : 'Log what happened') + '</summary>' + inner + '</details>') +
    '<span class="cdd-said' + (said && said.bad ? ' bad' : '') + '" data-cdd-said>' + cddEsc(said ? said.text : '') + '</span></div>';
}

// ── Actions ──
function cddEdit(ta) { var d = ta.closest('[data-draft]'); if (d) CDD.edits[d.getAttribute('data-draft')] = ta.value; }
function cddDraftBox(id) { var all = document.querySelectorAll('.cdd-draft[data-draft]'); for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-draft') === id) return all[i]; return null; }
function cddEditOpen(btn) {
  var box = btn.closest('[data-draft]'), id = box && box.getAttribute('data-draft'); if (!id) return;
  CDD.editing[id] = true; cddRender();
  var again = cddDraftBox(id), ta = again && again.querySelector('textarea'); if (ta) ta.focus();
}
function cddOutIn(el) {
  var box = el.closest('[data-cdd-out]'); if (!box) return;
  var v = function (sel) { return (box.querySelector(sel) || {}).value || ''; };
  CDD.outIn[box.getAttribute('data-cdd-out')] = { amount: v('[data-prom-amount]'), date: v('[data-prom-date]'), note: v('[data-out-note]') };
}
function cddLogToggle(el) { var box = el.closest('[data-cdd-out]'); if (box) CDD.open[box.getAttribute('data-cdd-out')] = el.open; }
function cddPromiseOpen(btn) {
  var box = btn.closest('[data-cdd-out]'), prom = box && box.querySelector('.cdd-prom'); if (!prom) return;
  CDD.promOpen[box.getAttribute('data-cdd-out')] = true; prom.hidden = false; btn.setAttribute('aria-expanded', 'true');
  var amt = prom.querySelector('[data-prom-amount]'); if (amt) amt.focus();
}
function cddTick(cb) { CDD.ticked[cb.getAttribute('data-draft')] = cb.checked; var b = document.getElementById('cddApproveTicked'), n = Object.keys(CDD.ticked).filter(function (k) { return CDD.ticked[k]; }).length; if (b) { b.disabled = !n; b.textContent = 'Approve ticked (' + n + ')'; } }
// Only a pending draft on the list now on screen can be decided: a chaseable item's draft, or Jan's
// morning text (approved against its own invoice ids, in its order, and only when approvable).
function cddPendingDraft(id) {
  var jt = cddJanText();
  if (jt && jt.id === id && jt.status === 'pending') return { draft: jt, jan: true, ids: jt.xero_invoice_ids || [], blocked: jt.approvable === false ? (jt.problem || 'this text cannot be approved') : null, keep: function (d) { CDD.morning.jan_text = Object.assign({}, jt, d); } };
  var it = ClearDebtDeskCore.chaseItems(CDD.morning && CDD.morning.items).filter(function (i) { return i.draft && i.draft.id === id && i.draft.status === 'pending'; })[0];
  return it ? { draft: it.draft, ids: (it.invoices || []).map(function (x) { return x.xero_invoice_id; }), blocked: null, keep: function (d) { it.draft = d; } } : null;
}
async function cddDecideOne(id, decision) {
  var p = cddPendingDraft(id);
  if (!p) { delete CDD.ticked[id]; delete CDD.edits[id]; throw new Error('that draft is no longer waiting on this list'); }
  if (decision === 'approve' && p.blocked) { delete CDD.ticked[id]; throw new Error(p.blocked); }
  var text = CDD.edits[id] != null ? CDD.edits[id] : p.draft.text;
  if (decision === 'approve' && /\u2014/.test(text || '')) throw new Error('remove the em dash first');
  var body = { draft_id: id, decision: decision, text: text, xero_invoice_ids: p.ids };
  // Approving Jan's text (an edit is an approval) also sends its standard wording from today's list:
  // the draft id is tied to that wording. Only then: template_text on a skip or a client draft is not a field.
  if (decision === 'approve' && p.jan) body.template_text = p.draft.template_text;
  var res = await opsPost('debt_draft_decide', body);
  p.keep((res && res.draft) || Object.assign({}, p.draft, { status: decision === 'approve' ? 'approved' : 'skipped', text: text }));
  delete CDD.edits[id]; delete CDD.ticked[id]; delete CDD.editing[id];
}
function cddDecideError(e) { return ClearDebtDeskCore.isNotDeployed(e) ? 'Approving is not live yet. Nothing was saved.' : 'Not saved: ' + e.message; }
async function cddDecide(btn, decision) {
  var box = btn.closest('[data-draft]'), id = box && box.getAttribute('data-draft'), said = box && box.querySelector('[data-cdd-said]');
  btn.disabled = true;
  try { await cddDecideOne(id, decision); cddRender(); }
  catch (e) { btn.disabled = false; if (said) said.textContent = cddDecideError(e); }
}
async function cddApproveTicked() {
  var ids = Object.keys(CDD.ticked).filter(function (k) { return CDD.ticked[k]; }), ok = 0, errs = [];
  for (var i = 0; i < ids.length; i++) { // one at a time, never fanned out
    try { await cddDecideOne(ids[i], 'approve'); ok += 1; } catch (e) { errs.push(e); if (ClearDebtDeskCore.isNotDeployed(e)) break; }
  }
  cddRender();
  if (typeof showToast === 'function') showToast(errs.length ? (ok ? ok + ' approved. ' : '') + cddDecideError(errs[0]) : ok + ' approved', errs.length ? 'warning' : 'success');
}
async function cddOutcome(btn, code) {
  var box = btn.closest('[data-cdd-out]'); if (!box) return;
  var key = box.getAttribute('data-cdd-out'), said = box.querySelector('[data-cdd-said]');
  var o = { code: code, amount: (box.querySelector('[data-prom-amount]') || {}).value, date: (box.querySelector('[data-prom-date]') || {}).value };
  var problem = ClearDebtDeskCore.outcomeProblem(o, cddToday());
  if (problem) { said.className = 'cdd-said bad'; said.textContent = problem; return; }
  var ids = (box.getAttribute('data-ids') || '').split(',').filter(Boolean);
  if (!ids.length) { said.className = 'cdd-said bad'; said.textContent = 'No invoice to log this against'; return; }
  var step = box.getAttribute('data-step'), C = ClearDebtDeskCore;
  var body = { payer_key: box.getAttribute('data-payer') || null, xero_invoice_ids: ids, outcome_code: code, channel: C.outcomeChannel(step), schedule_step: C.outcomeScheduleStep(step), note: ((box.querySelector('[data-out-note]') || {}).value || '').trim() || null };
  if (code === 'promised') { body.promised_amount = Number(o.amount); body.promised_date = o.date; }
  box.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  try {
    await opsPost('debt_log_outcome', body);
    CDD.logged[key] = { text: 'Logged: ' + C.outcomeLabel(code, step, CDD.morning && CDD.morning.schedule) + (code === 'promised' ? ' ' + ClearDebtDeskCore.money(o.amount) + ' by ' + cddDateWords(o.date) : '') + ', ' + ClearDebtDeskCore.perthTime(new Date().toISOString()) };
    said.className = 'cdd-said'; said.textContent = CDD.logged[key].text;
    delete CDD.outIn[key];
    box.querySelectorAll('[data-prom-amount], [data-prom-date], [data-out-note]').forEach(function (el) { el.value = ''; });
    if (box.closest('#cddDetail')) { cddRender(); return; } // the row and Next to do now count this call as done
  } catch (e) {
    said.className = 'cdd-said bad';
    said.textContent = ClearDebtDeskCore.isNotDeployed(e) ? 'Logging what happened is not live yet. Nothing was saved; use Add note for now.' : 'Not saved: ' + e.message;
  }
  box.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
}

// ── Debt book: the live split, then the existing bar and payer groups ──
function cddBookHtml() {
  var C = ClearDebtDeskCore, h = '';
  if (CDD.book) {
    var t = C.bookTotals(CDD.book.invoices, cddToday());
    var pay = C.PAYERS.map(function (p) { var P = t.byPayer[p.key]; return '<tr><td>' + p.label + '</td><td class="r">' + P.n + '</td><td class="r">' + C.money(P.amount) + '</td><td class="r">' + C.money(P.overdue) + '</td></tr>'; }).join('');
    var sumOver = C.PAYERS.reduce(function (a, p) { return a + Math.round(t.byPayer[p.key].overdue * 100); }, 0) / 100;
    pay += '<tr class="tot"><td>Total</td><td class="r">' + t.debt.n + '</td><td class="r">' + C.money(t.debt.amount) + '</td><td class="r">' + C.money(sumOver) + '</td></tr>';
    var ages = C.AGES.map(function (a) { var A = t.byAge[a.key]; return '<tr><td>' + a.label + '</td>' + C.PAYERS.map(function (p) { return '<td class="r">' + (A[p.key] ? C.money(A[p.key]) : '–') + '</td>'; }).join('') + '<td class="r"><b>' + (A.all ? C.money(A.all) : '–') + '</b></td></tr>'; }).join('');
    h += '<div class="cdd-sec">Live from Xero, by your definition</div><div class="cdd-two">' +
      '<table class="cdd-tbl"><thead><tr><th>Who owes</th><th class="r">Invoices</th><th class="r">Debt</th><th class="r">Overdue</th></tr></thead><tbody>' + pay + '</tbody></table>' +
      '<table class="cdd-tbl"><thead><tr><th>Days past due</th>' + C.PAYERS.map(function (p) { return '<th class="r">' + p.label + '</th>'; }).join('') + '<th class="r">All</th></tr></thead><tbody>' + ages + '</tbody></table></div>' +
      '<div class="cdd-foot">Overdue here includes invoices on hold. Ages count Perth calendar days.</div>';
  } else if (!CDD.loading) {
    h += '<div style="margin-top:16px">' + cddFail('The live Xero read (debt_book)', CDD.bookErr) + '</div>';
  }
  return h + '<div class="cdd-sec">Our copy, by kind (Clear Debt picture)</div><div id="clearDebtBookHead"></div><div id="clearDebtBookBody" style="display:flex;flex-direction:column;gap:12px"></div>';
}

// ── Promises: broken ones from the list's items, open ones from its paused[] ──
function cddPromisesHtml() {
  var C = ClearDebtDeskCore;
  if (!CDD.morning) return CDD.loading ? '<div class="cd-quiet" style="margin-top:16px">Reading promises…</div>' : '<div style="margin-top:16px">' + cddFail('Promises, from the morning list (debt_morning_list)', CDD.morningErr) + '</div>';
  var rows = C.promisesFromMorning(CDD.morning);
  if (!rows.length) return '<div style="margin-top:16px">' + cddPend('No promises to pay on record.', 'Log one on a card: Log what happened, then Promised.') + '</div>';
  return '<div style="margin-top:16px"><table class="cdd-tbl"><thead><tr><th>Who</th><th>Invoices</th><th class="r">Promised</th><th>By</th><th>Status</th></tr></thead><tbody>' + rows.map(function (p) {
    var cls = p.status === 'broken' ? 'b' : p.status === 'kept' ? 'ok' : 'n';
    var st = p.status === 'broken' ? 'broken, back on top' : p.status === 'open' && p.resumes_on ? 'open, chasing resumes ' + cddDateWords(p.resumes_on) : p.status;
    return '<tr data-cdd-promise="' + cddEsc(p.status) + '"><td><b>' + cddEsc(p.payer_name) + '</b></td><td>' + cddEsc((p.invoice_numbers || []).join(', ')) + '</td><td class="r">' + (p.promised_amount == null ? '<span class="cd-quiet">no amount</span>' : C.money(p.promised_amount)) + '</td><td>' + cddEsc(cddDateWords(p.promised_date)) + '</td><td><span class="cd-pill ' + cls + '">' + cddEsc(st) + '</span></td></tr>';
  }).join('') + '</tbody></table></div>';
}

// ── Jan ──
function cddJanHtml() {
  var C = ClearDebtDeskCore;
  if (!CDD.morning) return CDD.loading ? '<div class="cd-quiet" style="margin-top:16px">Reading Jan\'s list…</div>' : '<div style="margin-top:16px">' + cddFail('Jan\'s list, from the morning list (debt_morning_list)', CDD.morningErr) + '</div>';
  var rows = C.janFromMorning(CDD.morning.items || []), jt = cddJanText(), heldHtml = cddHeldHtml(C.janHeldFromMorning(CDD.morning.items));
  var intro = '<div class="cdd-bar"><span class="t">Day 7: Jan knocks on the door. <b>' + rows.length + '</b> visit' + (rows.length === 1 ? '' : 's') + ' for ' + cddEsc(cddDateWords(cddToday())) + '.</span></div>';
  if (!rows.length && !jt) return intro + cddPend('Nobody for Jan today.', '') + heldHtml;
  return intro + (jt ? cddJanTextHtml(jt) : '') + rows.map(function (i) { return cddItemHtml(i); }).join('') + heldHtml;
}

// ── Deposits ──
function cddDepositsHtml() {
  var C = ClearDebtDeskCore;
  if (!CDD.book) return CDD.loading ? '<div class="cd-quiet" style="margin-top:16px">Reading deposits from Xero…</div>' : '<div style="margin-top:16px">' + cddFail('The live Xero read (debt_book)', CDD.bookErr) + '</div>';
  var dep = C.depositsFromBook(CDD.book.invoices, cddToday(), CDD.morning && CDD.morning.not_chased), rows = dep.rows, known = !!CDD.morning;
  var sum = rows.reduce(function (a, r) { return a + Math.round(Number(r.amount_due || 0) * 100); }, 0) / 100;
  var h = '<div class="cdd-bar"><span class="t" id="cddDepositsTotal">Unpaid deposits and before-work invoices: <b>' + C.money(sum) + '</b> on ' + rows.length + ' invoice' + (rows.length === 1 ? '' : 's') + '. Not debt.</span></div>';
  if (!known) h += '<div class="cdd-held" id="cddDepositsUnsorted" style="color:#B8741C">The morning list is not read, so the invoices it never chases (late-made deposits, duplicates, leftover cents) cannot be set apart yet. This total may include them, and the 60-day marks are hidden until it is read.</div>';
  h += rows.length ? '<table class="cdd-tbl" id="cddDeposits"><thead><tr><th>Client</th><th>Invoice</th><th class="r">Owing</th><th>Invoiced</th><th class="r">Days</th><th>Why it is not debt</th></tr></thead><tbody>' + rows.map(function (r) {
    var d = r.days_since_invoice;
    return '<tr>' + cddDepositCells(r) + '<td>' + cddEsc(cddDateWords(r.invoice_date)) + '</td><td class="r">' + (d === null ? '–' : d >= 60 && known ? '<span class="cd-pill w">' + d + '</span>' : d) + '</td><td>' + cddEsc(r.reason || '') + '</td></tr>';
  }).join('') + '</tbody></table>' : cddPend('No unpaid deposits.', '');
  if (dep.apart.length) h += '<div class="cdd-sec">Never chased, left out of the total</div><table class="cdd-tbl" id="cddDepositsApart"><thead><tr><th>Client</th><th>Invoice</th><th class="r">Owing</th><th>Why it is not chased</th></tr></thead><tbody>' + dep.apart.map(function (r) {
    return '<tr>' + cddDepositCells(r) + '<td>' + cddEsc(r.not_chased_reason) + '</td></tr>';
  }).join('') + '</tbody></table>';
  return h + '<div class="cdd-foot">The one friendly reminder and the weekly 60-day cancel list come later. Nothing here is chased or cancelled from this screen.</div>';
}
function cddDepositCells(r) {
  return '<td><b>' + cddEsc(r.contact_name) + '</b>' + (r.job_number ? '<div class="cdd-foot" style="margin:0">' + cddEsc(r.job_number) + '</div>' : '') + '</td><td>' + (r.xero_invoice_id ? cddXero(r.xero_invoice_id, r.invoice_number) : cddEsc(r.invoice_number)) + '</td><td class="r">' + ClearDebtDeskCore.money(r.amount_due) + '</td>';
}
