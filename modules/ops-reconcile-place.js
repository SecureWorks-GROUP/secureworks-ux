// Cost lines to place (P2-03.10 and P2-03.11, the place, split and not-for-a-job part only).
// Bills, credits, receipts and card or bank lines the cost-line path could not place on its
// own wait on the Reconcile list (backend reconcile_items). Here a signed-in office person
// puts one on a job, splits its lines across jobs and not for a job, or marks it not for a
// job, each with a confirm, through ops-api reconcile_decide (P2-03.7). The person is the
// signed-in session; nothing here sends an actor. No undo, no division stock, no leave.
//
// A credit is shown under its bill: deciding the bill carries the credit with it. After every
// recorded decision the list is read again, so credits that followed their bill drop off.
// The cost screen is the default for admin, owner and ops_manager behind the server switch
// reconcile_list_v1 (ops-api reconcile_list answers { enabled: false } while it is off, so
// nothing renders and the old screen stays unchanged). Every other role keeps today's default.
// ?reconcile_place=0 (or localStorage sw_reconcile_place = '0') keeps the old screen;
// ?reconcile_place=1 (or sw_reconcile_place = '1') forces preview mode, the URL winning.
// The list is read when Matching opens, on login, after a decision and on Read again. No timer.
(function () {
  'use strict';
  var TABS = ['bills', 'card_bank', 'receipts']; // the tabs whose items can be cost documents
  var READ_LIMIT = 100;
  var MAX_PAGES = 20; // per tab: 2,000 items, far above the waiting list, then a plain notice
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // The split helper (modules/ops-reconcile-split.js), loaded first on the page.
  var Split = {};
  ['toCents', 'lineCents', 'left', 'valid', 'partsFor'].forEach(function (name) {
    Split[name] = function () {
      var S = typeof window !== 'undefined' && window.ReconcileSplit ? window.ReconcileSplit : require('./ops-reconcile-split.js');
      return S[name].apply(null, arguments);
    };
  });

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function str(v) { return typeof v === 'string' ? v.trim() : ''; }

  // ── The switch ──
  var DEFAULT_ROLES = ['admin', 'owner', 'ops_manager'];
  function isDefaultRole(role) {
    return DEFAULT_ROLES.indexOf(String(role || '').toLowerCase()) >= 0;
  }
  // 'on': explicit ?reconcile_place=1/on or localStorage sw_reconcile_place = '1'.
  // 'off': explicit ?reconcile_place=0/off, sw_reconcile_place = '0', or a non-default role.
  // 'server': default for admin, owner and ops_manager; shows only when reconcile_list_v1 is on.
  function switchMode(search, stored, role) {
    var m = /[?&]reconcile_place=([^&#]*)/.exec(String(search || ''));
    if (m) {
      var v = m[1].toLowerCase();
      if (v === '1' || v === 'on') return 'on';
      if (v === '0' || v === 'off') return 'off';
    }
    if (stored === '1') return 'on';
    if (stored === '0') return 'off';
    return isDefaultRole(role) ? 'server' : 'off';
  }
  function switchOn(search, stored, role) {
    return switchMode(search, stored, role) !== 'off';
  }

  // ── Words ──
  // Cents to "$1,240.00" (a credit "-$120.00"); null when the amount was not read.
  function dollars(cents) {
    if (cents == null) return null;
    var neg = cents < 0, a = Math.abs(cents);
    var whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + whole + '.' + String(a % 100).padStart(2, '0');
  }
  function amountWords(amount, credit) {
    var c = Split.lineCents(amount);
    if (c == null) return 'Amount not read';
    return credit || c < 0 ? 'Credit ' + dollars(Math.abs(c)) + ' ex GST' : dollars(c) + ' ex GST';
  }
  function dateWords(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso));
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return 'Date not read';
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1];
  }
  function waitWords(days) {
    var n = Number(days);
    if (typeof days !== 'number' || !isFinite(n) || n < 0) return '';
    n = Math.floor(n);
    return n === 0 ? 'Waiting since today' : n === 1 ? 'Waiting 1 day' : 'Waiting ' + n + ' days';
  }
  function jobLabel(j) {
    if (!j) return 'a job';
    return [str(j.job_number) || 'Job number not available', str(j.job_site)].filter(Boolean).join(', ');
  }
  var DIVISIONS = { patios: 'Patio', patio: 'Patio', fencing: 'Fencing', insurance: 'Insurance' };
  function suggestionWords(item) {
    var s = item.suggestion;
    if (item.held) return 'Held: ' + (str(item.held.words) || 'held for a check');
    if (s && s.job_id) return 'Suggested: ' + jobLabel(s);
    if (s && s.outcome === 'overhead') return 'Suggested: not for a job (overhead)';
    if (s && s.division) return 'Suggested: ' + (DIVISIONS[s.division] || s.division) + ' stock';
    return 'No suggestion';
  }
  // The server's words for a refusal; a bare machine code is never shown.
  function serverWords(err) {
    var body = (err && err.body) || {};
    var w = [body.message, body.userMessage, typeof body.error === 'string' ? body.error : null, err && err.message]
      .find(function (x) { return typeof x === 'string' && x.trim() && !/^[a-z0-9_]+$/.test(x.trim()); });
    return w ? w.trim() : '';
  }
  // No answer at all (the connection dropped): the request carries no status.
  function droppedConnection(err) { return !err || !err.status; }
  var DROPPED_DECIDE = 'The connection dropped before an answer came back. This may or may not have been recorded. Read the list again before choosing again.';
  function refusalWords(err) {
    if (droppedConnection(err)) return DROPPED_DECIDE;
    var words = serverWords(err);
    if (words) return words;
    if (err.status === 403) return 'You cannot record this. Sign in again as office staff.';
    if (err.status === 409) return 'This could not be recorded. The list has been read again, please choose again.';
    return 'This could not be recorded. Read the list again before choosing again.';
  }
  // Undo (backend #1682, reconcile_undo): the same door rules and words as decide.
  function undoRefusalWords(err) {
    if (droppedConnection(err)) return 'The connection dropped before an answer came back. This may or may not have been undone. Read the list again before trying again.';
    var words = serverWords(err);
    if (words) return words;
    if (err.status === 403) return 'You cannot undo this. Sign in again as office staff.';
    if (err.status === 409) return 'This could not be undone. The list has been read again.';
    return 'This could not be undone. Read the list again before trying again.';
  }
  // Only the newest decision on an item can be undone: an entry with a newer one on the same
  // item (nearer the top), an undone entry or one without its decision id shows no Undo.
  function canUndo(recent, i) {
    var d = recent[i];
    if (!d || !d.decision_id || d.undone || d.busy) return false;
    for (var k = 0; k < i; k++) if (recent[k].item_id === d.item_id) return false;
    return true;
  }
  function listErrorWords(err) {
    if (droppedConnection(err)) return 'The connection dropped while reading the list. Nothing is shown as placed. Read the list again.';
    if (err && err.status === 403) return serverWords(err) || 'You do not have permission to see this list.';
    var code = err && err.body && (err.body.code || err.body.error);
    if (code === 'reconcile_list_too_many_lines' || (err && err.status === 422)) {
      return 'This list has more cost lines on one page than it can show at once. Nothing is shown as placed. Tell the office lead.';
    }
    if (err && (err.status === 404 || (err.status === 400 && /unknown action/i.test(String(err.message || ''))))) {
      return 'The cost line list is not on the server yet.';
    }
    return 'The list could not be read. Nothing is shown as placed.';
  }

  // ── The list answer (ops-api reconcile_list, spec P2-03.6). Its shape lives here only. ──
  // A credit names the bills it follows (backend #1675): `bills` [{document_id, document_number,
  // item_id, state, job_id, job_number, job_site, division}] and `bill` (the one bill, null when
  // against none, {several: true} when it follows more than one). A state is waiting (the bill
  // waits for a decision; item_id its open item, or null), placed, split, overhead,
  // division_stock, not_loaded (the bill has no cost lines yet) or not_counted (every line of
  // the bill is set aside, for example as a duplicate: the bill counts for nothing).
  var BILL_STATES = { waiting: 1, placed: 1, split: 1, overhead: 1, division_stock: 1, not_loaded: 1, not_counted: 1 };
  function billFromList(b) {
    if (b === null) return { none: true };
    if (!b || typeof b !== 'object') return null; // not said
    if (b.several === true) return { several: true };
    return {
      document_number: str(b.document_number), item_id: str(b.item_id), state: BILL_STATES[b.state] ? b.state : '',
      job_id: str(b.job_id), job_number: str(b.job_number), job_site: str(b.job_site), division: str(b.division)
    };
  }
  // Several bills: every bill read from `bills`; null when the list said several but listed none.
  function billsFromList(raw) {
    if (!raw.bill || raw.bill.several !== true) return null;
    var list = Array.isArray(raw.bills) ? raw.bills.filter(function (b) { return b && typeof b === 'object'; }).map(billFromList) : [];
    return list.length > 1 ? list : null;
  }
  // The credits that follow a bill (backend #1678): read only, shown under the bill. amount_ex is
  // the size the credit takes off (never signed); null when not read.
  function billCreditsFromList(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (c) { return c && typeof c === 'object'; }).map(function (c) {
      var cents = Split.lineCents(c.amount_ex);
      return {
        document_number: str(c.document_number), cents: cents == null ? null : Math.abs(cents),
        line_ids: (Array.isArray(c.lines) ? c.lines : []).map(function (l) { return l && str(l.line_id); }).filter(Boolean),
        lines: (Array.isArray(c.lines) ? c.lines : []).filter(function (l) { return l && typeof l === 'object'; }).map(function (l) {
          var lc = Split.lineCents(l.amount_ex);
          return { description: str(l.description) || 'Line', cents: lc == null ? null : Math.abs(lc) };
        })
      };
    });
  }
  function creditSize(cents) { return cents == null ? 'Amount not read' : 'Credit ' + dollars(cents) + ' ex GST'; }
  var BILL_CARRIES = 'Deciding this bill carries these credits';
  function billCreditsHtml(item) {
    if (!item.bill_credits || !item.bill_credits.length) return '';
    return '<div class="rp-bill-credits" data-rp-bill-credits><p class="rp-note" data-rp-carries>' + BILL_CARRIES + '</p><ul>' +
      item.bill_credits.map(function (c) {
        return '<li><span class="rp-tag">Credit</span> ' + esc(c.document_number || 'Number not read') + ', ' + esc(creditSize(c.cents)) +
          (c.lines.length ? '<ul>' + c.lines.map(function (l) { return '<li>' + esc(l.description) + ', ' + esc(creditSize(l.cents)) + '</li>'; }).join('') + '</ul>' : '') +
          '</li>';
      }).join('') + '</ul></div>';
  }
  // Distinct credit documents a bill carries: its credit cards plus the read-only entries that are
  // not one of those cards (nest drops an entry sharing a line with a card).
  function carriedCount(item) { return (item.credits ? item.credits.length : 0) + (item.bill_credits ? item.bill_credits.length : 0); }
  function sameDocument(entry, card) {
    return entry.line_ids.some(function (id) { return card.line_ids.indexOf(id) >= 0; });
  }
  function shared(item) { return !!(item.is_credit && item.bill && item.bill.several); }
  function billNumber(b) { return b.document_number || '(number not read)'; }
  function billStateWords(b) {
    if (b.state === 'not_loaded') return 'waiting for its bill to load';
    if (b.state === 'not_counted') return 'not counted';
    if (b.state === 'waiting') return 'still waiting for a decision';
    if (b.state === 'placed') return 'on ' + jobLabel(b);
    if (b.state === 'split') return 'split across jobs';
    if (b.state === 'overhead') return 'not for a job';
    if (b.state === 'division_stock') return (DIVISIONS[b.division] || 'division') + ' stock';
    return 'its state was not read';
  }
  function billWords(item) {
    var b = item.bill;
    if (!item.is_credit) return '';
    if (!b) return 'The bill this credit is against was not read.';
    if (b.none) return 'Not against a bill.';
    if (b.several) {
      if (!item.bills) return 'Shared by several bills, but the list did not name them.';
      return 'Shared by ' + item.bills.length + ' bills: ' + item.bills.map(function (x) { return billNumber(x) + ' (' + billStateWords(x) + ')'; }).join(', ') + '.';
    }
    var name = 'Against bill ' + billNumber(b);
    if (b.state === 'not_loaded') return name + ': waiting for its bill to load.';
    if (b.state === 'not_counted') return name + ': the bill is not counted.';
    if (b.state === 'waiting') return name + ': the bill is still waiting for a decision.';
    if (b.state === 'placed') return name + ': the bill is on ' + jobLabel(b) + '.';
    if (b.state === 'split') return name + ': the bill is split across jobs.';
    if (b.state === 'overhead') return name + ': the bill is not for a job.';
    if (b.state === 'division_stock') return name + ': the bill is ' + (DIVISIONS[b.division] || 'division') + ' stock.';
    return name + ': the bill\'s state was not read.';
  }
  function itemFromList(raw) {
    if (!raw || typeof raw !== 'object' || !str(raw.id) || raw.card !== 'cost') return null;
    // A line with a null state is not counted (set aside, for example as a duplicate): it is
    // never placed here, and the card says how many there are.
    var notCounted = function (l) { return Object.prototype.hasOwnProperty.call(l, 'state') && l.state == null; };
    var listed = (Array.isArray(raw.lines) ? raw.lines : []).filter(function (l) { return l && str(l.line_id); });
    var lines = listed.filter(function (l) { return !notCounted(l); })
      .map(function (l) {
        return { line_id: l.line_id, description: str(l.description) || 'Line', amount_ex: l.amount_ex, cents: Split.lineCents(l.amount_ex), tag: str(l.tag) };
      });
    var sug = raw.suggestion && typeof raw.suggestion === 'object' ? raw.suggestion : null;
    return {
      id: raw.id, kind_words: str(raw.kind_words) || 'Document', party: str(raw.party) || 'Supplier not read',
      document_number: str(raw.document_number), document_date: raw.document_date, amount_ex: raw.amount_ex,
      cents: Split.lineCents(raw.amount_ex), waiting_days: raw.waiting_days, shown_hash: str(raw.shown_hash),
      reason_words: str(raw.reason_words),
      suggestion: sug ? { outcome: str(sug.outcome), job_id: str(sug.job_id), job_number: str(sug.job_number), job_site: str(sug.job_site), division: str(sug.division) } : null,
      clues: Array.isArray(raw.clues) ? raw.clues : [], against: Array.isArray(raw.against) ? raw.against : [],
      lines: lines, set_aside: listed.filter(notCounted).length, held: raw.held && typeof raw.held === 'object' ? raw.held : null,
      is_credit: raw.kind === 'credit' || (Split.lineCents(raw.amount_ex) || 0) < 0,
      bill: billFromList(raw.bill),
      bills: billsFromList(raw),
      bill_credits: raw.kind === 'credit' ? [] : billCreditsFromList(raw.credits),
      // Every line id the list sent, held or not: how a credit card is matched to a bill's credits entry.
      line_ids: (Array.isArray(raw.lines) ? raw.lines : []).map(function (l) { return l && str(l.line_id); }).filter(Boolean)
    };
  }
  // A document can be placed here only with its hash, every line read and an amount on each.
  function blockedWhy(item) {
    if (item.held) return 'Held for a check, so it is not placed from here.';
    if (item.is_credit && item.bill && item.bill.state === 'not_loaded') {
      return 'This credit waits for its bill to load into the cost lines. It is placed with its bill once the bill is here.';
    }
    if (item.is_credit && item.bill && item.bill.state === 'not_counted') {
      return 'This credit\'s bill is not counted (every line on it is set aside), so the credit is not placed from here. Tell the office lead.';
    }
    if (item.is_credit && !item.bill) return 'The bill this credit is against was not read, so it is not placed from here.';
    if (shared(item) && !item.bills) return 'The list did not name the bills this credit is shared by, so it is not placed from here.';
    if (shared(item) && item.bills.some(function (x) { return x.state === 'not_loaded'; })) {
      return 'This credit waits for one of its bills to load into the cost lines. It is placed once every bill is here.';
    }
    if (shared(item) && item.bills.some(function (x) { return x.state === 'not_counted'; })) {
      return 'One of the bills this credit is shared by is not counted (every line on it is set aside), so the credit is not placed from here. Tell the office lead.';
    }
    if (!item.shown_hash) return 'This one cannot be placed here: the list did not say what it was shown with.';
    if (!item.lines.length && item.set_aside) {
      return 'No line on this document counts (each one is set aside, for example as a duplicate), so there is nothing to place here.';
    }
    if (item.cents == null || !item.lines.length || item.lines.some(function (l) { return l.cents == null || l.cents === 0; })) {
      return 'A line on this document has no amount, so it cannot be placed here.';
    }
    if (item.cents === 0) return 'This document comes to $0.00, so there is nothing to place here.';
    if (linesCents(item.lines) !== item.cents) {
      return 'Its lines do not add up to the document\'s amount, so it is not placed from here. Read the list again later.';
    }
    return null;
  }

  // ── What a press sends: only the six fields reconcile_decide takes. ──
  function decideBody(item, action, parts, accepted) {
    return { item_id: item.id, shown_hash: item.shown_hash, action: action, parts: parts, note: null, accepted_suggestion: !!accepted };
  }
  // A credit whose bill sits on one job, and the credit has no job suggestion of its own.
  function billJob(item) {
    var b = item.is_credit && item.bill;
    if (!b || b.state !== 'placed' || !b.job_id || (item.suggestion && item.suggestion.job_id)) return null;
    return { job_id: b.job_id, job_number: b.job_number, job_site: b.job_site };
  }
  // Money is signed cents everywhere: a line's sign is its own (a discount on a bill is
  // negative, a charge on a credit is positive), never the document's.
  function linesCents(lines) { return lines.reduce(function (t, l) { return t + (l.cents || 0); }, 0); }
  function exGst(cents) { return dollars(Math.abs(cents)) + ' ex GST'; }
  // The document as one figure: a cost, or a credit when its signed total is below zero.
  function documentWords(cents) { return cents < 0 ? 'the ' + exGst(cents) + ' credit' : exGst(cents); }
  // One signed amount at one place (a job, or null for not for a job): a cost goes on it,
  // a credit is taken off it.
  function partWords(cents, job) {
    if (job == null) return cents < 0 ? 'take ' + exGst(cents) + ' off overhead (not for a job)' : exGst(cents) + ' not for a job (overhead)';
    return cents < 0 ? 'take ' + exGst(cents) + ' off ' + job : exGst(cents) + ' on ' + job;
  }
  // The document's lines split by their own sign.
  function signedTotals(item) {
    var plus = 0, minus = 0;
    item.lines.forEach(function (l) { if (l.cents > 0) plus += l.cents; else minus += l.cents; });
    return { plus: plus, minus: minus };
  }
  // withoutCarried: the words alone, without the credits that followed (the Undo confirm uses it).
  function confirmWords(item, pending, withoutCarried) {
    var carried = carriedCount(item) && !withoutCarried ? ' ' + carriedWords(carriedCount(item)) : '';
    var t = signedTotals(item), net = ' (net ' + documentWords(t.plus + t.minus) + ')';
    if (pending.action === 'place') {
      var job = jobLabel(pending.job);
      if (t.plus && t.minus) return 'Put ' + exGst(t.plus) + ' on ' + job + ' and take ' + exGst(t.minus) + ' off it' + net + '.' + carried;
      return (t.minus ? 'Take ' + exGst(t.minus) + ' off ' + job + ' (a credit).' : 'Put ' + exGst(t.plus) + ' on ' + job + '.') + carried;
    }
    if (pending.action === 'overhead') {
      if (t.plus && t.minus) return 'Mark ' + exGst(t.plus) + ' and a ' + exGst(t.minus) + ' credit as not for a job (overhead)' + net + '.' + carried;
      return 'Mark ' + documentWords(t.plus + t.minus) + ' as not for a job (overhead).' + carried;
    }
    // A split lists exactly the parts partsFor sends, in its order, each by its own sign.
    var bits = pending.summary.map(function (s) { return s.line + ', ' + partWords(s.cents, s.job); });
    return 'Split ' + documentWords(item.cents) + ': ' + bits.join('; ') + '.' + carried;
  }
  // The Undo confirm names exactly what was recorded: the document, the amount ex GST and the
  // job (or not for a job), in the words the confirm showed before it was recorded.
  function undoWords(d) {
    var head = d.document ? d.document + ', recorded as: ' : 'Recorded as: ';
    return 'Undo this? ' + head + d.recorded + ' Undoing puts it back on the list as it was before.';
  }
  function documentName(item) {
    return [item.kind_words, item.party, item.document_number].filter(Boolean).join(' ');
  }
  function carriedWords(n) { return n === 1 ? 'Its credit follows it.' : 'Its ' + n + ' credits follow it.'; }
  function doneWords(pending, item) {
    var c = item && item.is_credit ? 'Credit ' : '';
    if (pending.action === 'place') return c + (c ? 'put on ' : 'Put on ') + (pending.job && pending.job.job_number || 'the job') + ' by you, just now.';
    if (pending.action === 'overhead') return c + (c ? 'marked' : 'Marked') + ' not for a job by you, just now.';
    return c + (c ? 'split' : 'Split') + ' by you, just now.';
  }
  // The parts partsFor sends, in its order, as signed cents with where each goes.
  function splitSummary(item) {
    var names = {};
    item.split.lines.forEach(function (l) { names[l.line_id] = l.description; });
    return Split.partsFor(item.split.lines).map(function (part) {
      var job = part.target === 'job' ? item.split.jobs.filter(function (j) { return j.job_id === part.job_id; })[0] : null;
      return {
        cents: Math.round(part.amount_ex * 100),
        job: part.target === 'job' ? (job && job.job_number) || 'a job' : null,
        line: names[part.line_id] || 'a line'
      };
    });
  }

  // ── Render ──
  function partHtml(item, l, p, i) {
    var opts = '<option value="">Choose where</option><option value="overhead"' + (p.target === 'overhead' ? ' selected' : '') + '>Not for a job</option>' +
      item.split.jobs.map(function (j) {
        var on = p.target === 'job' && p.job_id === j.job_id;
        return '<option value="job:' + esc(j.job_id) + '"' + (on ? ' selected' : '') + '>' + esc(jobLabel(j)) + '</option>';
      }).join('');
    return '<div class="rp-part" data-rp-part="' + i + '"><select aria-label="Where part ' + (i + 1) + ' goes" data-rp-target>' + opts + '</select>' +
      '<input inputmode="decimal" aria-label="Amount of part ' + (i + 1) + '" placeholder="0.00" data-rp-amount value="' + esc(p.text) + '">' +
      (l.parts.length > 1 ? '<button type="button" data-rp="remove_part">Remove</button>' : '') + '</div>';
  }
  // What is still to place on one line (a size), or how far it is over.
  function lineLeft(l) { return Split.left(l.cents, l.parts.map(function (p) { return Split.toCents(p.text); })); }
  function leftHtml(l) {
    var lc = lineLeft(l);
    return '<span class="rp-left' + (lc !== 0 ? ' rp-off' : '') + '" data-rp-left>' +
      (lc < 0 ? 'Over by ' + exGst(lc) : 'Left ' + exGst(lc)) + '</span>';
  }
  // Signed totals, and each line checked on its own: an over on one line never hides an under
  // on another.
  function footerHtml(item) {
    var total = 0, alloc = 0, off = 0;
    item.split.lines.forEach(function (l) {
      var sign = l.cents < 0 ? -1 : 1;
      total += l.cents;
      l.parts.forEach(function (p) { alloc += sign * (Split.toCents(p.text) || 0); });
      if (lineLeft(l) !== 0) off += 1;
    });
    var label = function (c) { return c < 0 ? 'Credit ' + exGst(c) : exGst(c); };
    return 'Lines total ' + label(total) + '. Allocated ' + label(alloc) + '. ' +
      (off ? (off === 1 ? '1 line is' : off + ' lines are') + ' not fully placed yet.' : 'Every line is placed.');
  }
  function searchHtml(item, purpose) {
    var s = item.search;
    var h = '<form class="rp-search" data-rp-form="search"><label>' + (purpose === 'split' ? 'Add a job to choose from' : 'Find a job') +
      ' <input name="q" autocomplete="off" placeholder="Job number, name or suburb" value="' + esc(s.q) + '"></label>' +
      '<button type="submit">Search</button></form>';
    if (s.phase === 'reading') h += '<p role="status">Searching.</p>';
    else if (s.phase === 'error') h += '<p class="rp-msg" role="alert">The job search failed. Try again.</p>';
    else if (s.phase === 'done' && !s.results.length) h += '<p>No jobs found.</p>';
    else if (s.phase === 'done') {
      h += '<div class="rp-results">' + s.results.map(function (j, i) {
        return '<button type="button" data-rp="pick" data-rp-i="' + i + '">' + esc([j.job_number, j.client, j.job_site].filter(Boolean).join(', ')) + '</button>';
      }).join('') + '</div>';
    }
    return h;
  }
  // A bill with its credits under it, or one card on its own.
  // A credit shared by several bills is shown in full under the first of its bills on this list,
  // and as a marked line under each other one (one set of controls, never two).
  function groupHtml(item) {
    if (!item.credits || !item.credits.length) return cardHtml(item);
    return '<section class="rp-group" data-rp-group="' + esc(item.id) + '">' + cardHtml(item) +
      '<div class="rp-credits" aria-label="Credits against this bill">' + item.credits.map(function (c) {
        if (c.under === item.id) return cardHtml(c);
        return '<p class="rp-card rp-shared-ref" data-rp-shared="' + esc(c.id) + '"><span class="rp-tag">Credit, shared</span> ' +
          esc([c.party, c.document_number].filter(Boolean).join(' ')) + ', ' + esc(amountWords(c.amount_ex, true)) + '. Shown in full under bill ' +
          esc(c.under_number || 'its first bill') + '.</p>';
      }).join('') + '</div></section>';
  }
  function setAsideWords(n) {
    return (n === 1 ? '1 line on this document is' : n + ' lines on this document are') +
      ' not counted (set aside, for example as a duplicate). ' + (n === 1 ? 'It is' : 'They are') + ' not placed here and not in the amounts below.';
  }
  function cardHtml(item) {
    var dis = item.busy ? ' disabled' : '';
    var h = '<article class="rp-card" data-rp-id="' + esc(item.id) + '"><div class="rp-top"><span>' + esc(item.kind_words) + ' ' + esc(item.party) +
      (item.document_number ? ' ' + esc(item.document_number) : '') + '</span><span class="rp-amt">' + esc(amountWords(item.amount_ex, item.is_credit)) + '</span></div>' +
      '<div class="rp-meta"><span>' + esc(dateWords(item.document_date)) + '</span>' + (waitWords(item.waiting_days) ? '<span>' + esc(waitWords(item.waiting_days)) + '</span>' : '') +
      (item.reason_words ? '<span>' + esc(item.reason_words) + '</span>' : '') + '</div>' +
      (item.is_credit ? '<div class="rp-credit" data-rp-credit><span class="rp-tag">Credit</span> Takes cost off where it is put. ' + esc(billWords(item)) + '</div>' : '') +
      (item.under && !shared(item) ? '<p class="rp-note" data-rp-bill-waiting>Decide the bill and this credit follows it. Placing it alone fixes it here.</p>' : '') +
      (item.under && shared(item) ? '<p class="rp-note" data-rp-bill-waiting>Shared: decide its bills and this credit follows them. Placing it alone fixes it here.</p>' : '') +
      (item.is_credit && shared(item) ? '<p class="rp-note" data-rp-shared-mark><span class="rp-tag">Shared</span> This credit follows more than one bill.</p>' : '') +
      (item.bill_credits && item.bill_credits.length ? billCreditsHtml(item) : item.credits && item.credits.length ? '<p class="rp-note" data-rp-carries>' + BILL_CARRIES + '</p>' : '') +
      '<div class="rp-sug" data-rp-sug>' + esc(suggestionWords(item)) + '</div>' +
      (item.set_aside && item.lines.length ? '<p class="rp-note" data-rp-set-aside>' + esc(setAsideWords(item.set_aside)) + '</p>' : '');
    h += '<details class="rp-why"><summary>Why, and the lines</summary>';
    if (item.clues.length) {
      h += '<h4>Why</h4><ul>' + item.clues.map(function (c) {
        var seen = [str(c.seen_where), str(c.seen_value)].filter(Boolean).join(': ');
        return '<li>' + esc(str(c.words) || 'A clue') + (seen ? ' (' + esc(seen) + ')' : '') + (c.counts === false ? ' (a suggestion only)' : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (item.against.length) h += '<h4>Against</h4><ul>' + item.against.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>';
    h += '<h4>Lines</h4><ul>' + (item.lines.length ? item.lines.map(function (l) {
      return '<li>' + esc(l.description) + ', ' + esc(amountWords(l.amount_ex, false)) + (l.tag ? ' (' + esc(l.tag) + ')' : '') + '</li>';
    }).join('') : '<li>No lines read.</li>') + '</ul></details>';
    if (item.message) h += '<p class="rp-msg" role="alert">' + esc(item.message) +
      (item.dropped ? ' <button type="button" data-rp="reread">Read the list again</button>' : '') + '</p>';
    var why = blockedWhy(item);
    if (why) return h + '<p class="rp-note">' + esc(why) + '</p></article>';
    if (item.busy) return h + '<p role="status">Recording.</p></article>';
    if (item.mode === 'confirm') {
      return h + '<div class="rp-confirm" data-rp-confirm>' + esc(confirmWords(item, item.pending)) +
        '<div class="rp-acts"><button type="button" class="rp-yes" data-rp="record"' + dis + '>Yes, record it</button><button type="button" data-rp="back"' + dis + '>Back</button></div></div></article>';
    }
    var s = item.suggestion;
    h += '<div class="rp-acts">';
    if (s && s.job_id) h += '<button type="button" class="rp-main" data-rp="accept_job"' + dis + '>Put on ' + esc(s.job_number || 'the suggested job') + '</button>';
    if (s && !s.job_id && s.outcome === 'overhead') h += '<button type="button" class="rp-main" data-rp="accept_overhead"' + dis + '>Yes, not for a job</button>';
    var bj = billJob(item);
    if (bj) h += '<button type="button" class="rp-main" data-rp="bill_job"' + dis + '>Put on ' + esc(bj.job_number || 'the bill\'s job') + ', where its bill is</button>';
    h += '<button type="button" data-rp="another"' + dis + '>Another job</button><button type="button" data-rp="split"' + dis + '>Split</button>';
    if (!(s && !s.job_id && s.outcome === 'overhead')) h += '<button type="button" data-rp="overhead"' + dis + '>Not for a job</button>';
    h += '</div>';
    if (item.mode === 'another') h += '<div class="rp-panel">' + searchHtml(item, 'another') + '<button type="button" data-rp="back">Back</button></div>';
    if (item.mode === 'split') {
      h += '<div class="rp-panel" data-rp-split>' + searchHtml(item, 'split');
      item.split.lines.forEach(function (l, li) {
        h += '<div class="rp-line" data-rp-line="' + li + '"><div class="rp-line-head">' + esc(l.description) + ', ' + esc(amountWords(l.cents / 100, false)) + '</div>' +
          (l.cents < 0 ? '<div class="rp-note">A credit: each part is taken off where it goes.</div>' : item.is_credit ? '<div class="rp-note">A cost on this credit: each part is added where it goes.</div>' : '') +
          l.parts.map(function (p, i) { return partHtml(item, l, p, i); }).join('') +
          '<div class="rp-line-foot"><button type="button" data-rp="add_part">Add a part</button>' + leftHtml(l) + '</div></div>';
      });
      h += '<p class="rp-foot" data-rp-foot>' + esc(footerHtml(item)) + '</p><div class="rp-acts">' +
        '<button type="button" class="rp-main" data-rp="save_split"' + (Split.valid(item.split.lines) ? '' : ' disabled') + '>Save the split</button>' +
        '<button type="button" data-rp="back">Back</button></div></div>';
    }
    return h + '</article>';
  }
  function recentHtml(recent) {
    if (!recent || !recent.length) return '';
    return '<div class="rp-recent" role="status"><h3>Recorded</h3><ul>' + recent.map(function (d, i) {
      var h = '<li data-rp-decision="' + esc(d.decision_id) + '">' + esc(d.words);
      if (d.undone) h += ' <strong>Undone by you, just now. It is back on the list.</strong>';
      if (d.confirm && canUndo(recent, i)) {
        h += '<div class="rp-confirm" data-rp-undo-confirm>' + esc(d.recorded ? undoWords(d) : 'Undo this? It puts the item back on the list as it was before.') +
          '<div class="rp-acts"><button type="button" class="rp-yes" data-rp="undo_yes">Yes, undo it</button><button type="button" data-rp="undo_back">Keep it</button></div></div>';
      } else if (canUndo(recent, i)) {
        h += ' <button type="button" data-rp="undo">Undo</button>';
      }
      if (d.busy) h += ' <span role="status">Undoing.</span>';
      if (d.message) h += '<p class="rp-msg" role="alert">' + esc(d.message) + (d.dropped ? ' <button type="button" data-rp="reread">Read the list again</button>' : '') + '</p>';
      return h + '</li>';
    }).join('') + '</ul><p class="rp-note">Only the newest decision on an item can be undone here.</p></div>';
  }
  function render(state) {
    if (state.phase === 'old_screen') {
      return '<div class="rp-old-bar" data-rp-old-bar><span>Using the old bill screen.</span><div class="rp-head-acts">' +
        (state.canOpenBillRecon ? '<button type="button" data-rp="open_bill_recon">Open Bill Reconciliation</button>' : '') +
        '<button type="button" data-rp="use_new">Use Cost lines to place</button></div></div>';
    }
    var open = state.items.length;
    var h = '<div class="rp-wrap"><div class="rp-head"><h2>Cost lines to place' + (state.phase === 'list' && open ? ' <span class="rp-count">' + open + ' waiting</span>' : '') +
      '</h2><div class="rp-head-acts"><button type="button" data-rp="use_old">Old bill screen</button><button type="button" data-rp="reread"' + (state.phase === 'loading' ? ' disabled' : '') + '>Read again</button></div></div>' +
      '<p class="rp-lede">Bills, credits, receipts and card or bank lines the system could not place on its own. Put each on a job, split it, or mark it not for a job.</p>';
    h += recentHtml(state.recent);
    if (state.phase === 'loading') return h + '<p role="status">Reading the list.</p></div>';
    if (state.phase === 'off') return h + '<p class="rp-note" data-rp-off>The cost line list is not switched on yet. Nothing here is placed until it is.</p></div>';
    if (state.phase === 'error') return h + '<p class="rp-msg" role="alert">' + esc(state.error) + '</p><button type="button" data-rp="reread">Read the list again</button></div>';
    if (state.notice) h += '<p class="rp-msg" role="alert" data-rp-notice>' + esc(state.notice) + '</p>';
    if (state.more) h += '<p class="rp-note" data-rp-more>The list did not say it was complete, so more may be waiting. Read the list again after placing these.</p>';
    if (!state.items.length) return h + '<p>Nothing to place.</p></div>';
    return h + state.items.filter(function (i) { return !i.under; }).map(groupHtml).join('') + '</div>';
  }

  // Every page of one tab. The list's next cursor is `next` (assumed); it pages until the list
  // has no more, or MAX_PAGES. `more` is true only when the list did not say it was complete.
  async function readTab(host, tab, requireEnabled) {
    var items = [], after = null;
    for (var page = 0; page < MAX_PAGES; page++) {
      var params = { tab: tab, limit: READ_LIMIT };
      if (after) params.after = after;
      var res = await host.read('reconcile_list', params);
      if (res && res.enabled === false) return { off: true, items: [], more: false };
      if (requireEnabled && (!res || res.enabled !== true)) return { off: true, items: [], more: false };
      if (!res || !Array.isArray(res.items)) throw new Error('Missing items');
      items = items.concat(res.items);
      var next = typeof res.next === 'string' && res.next ? res.next : null;
      // No next: the list is complete when it speaks in cursors (#1675). Its counts can be above
      // what it lists (#1678 leaves pay documents out), so they never raise the notice.
      if (!next) return { items: items, more: !('next' in res) && res.items.length >= READ_LIMIT };
      after = next;
    }
    return { items: items, more: true };
  }
  // A credit whose bill is on this list is shown under that bill.
  function nest(items) {
    var byId = {};
    items.forEach(function (i) { byId[i.id] = i; i.credits = []; i.under = null; });
    items.forEach(function (i) {
      if (!i.is_credit || !i.bill) return;
      var own = shared(i) ? (i.bills || []) : [i.bill];
      own.forEach(function (b) {
        var bill = b.item_id && byId[b.item_id];
        if (!bill || bill === i || bill.is_credit || bill.credits.indexOf(i) >= 0) return;
        if (!i.under) { i.under = bill.id; i.under_number = bill.document_number || billNumber(b); }
        bill.credits.push(i);
      });
    });
    // A credit with its own card is shown once: the card, never also the read-only entry.
    items.forEach(function (bill) {
      if (!bill.credits.length || !bill.bill_credits || !bill.bill_credits.length) return;
      bill.bill_credits = bill.bill_credits.filter(function (entry) {
        return !bill.credits.some(function (card) { return sameDocument(entry, card); });
      });
    });
    return items;
  }

  // ── State and presses ──
  function create(host) {
    var root = null, state = { phase: 'loading', items: [], more: false, error: '', recent: [] }, generation = 0, owner = null, recent = [], serverOn = false, optedOut = false;
    function mode() { return typeof host.mode === 'function' ? host.mode() : 'on'; }
    function showOldBar() { return optedOut || (typeof host.showOldBar === 'function' && !!host.showOldBar()); }
    function canOpenBillRecon() {
      if (typeof host.canOpenBillRecon === 'function') return !!host.canOpenBillRecon();
      return typeof host.openBillRecon === 'function';
    }
    function active() { return !!(root && host.visible() && host.identity()); }
    function shouldHide() {
      if (!host.identity()) return true;
      if (state.phase === 'old_screen') return !showOldBar();
      var m = mode();
      if (m === 'off') return true;
      if (m === 'server' && !serverOn) return true;
      return false;
    }
    function paint() {
      if (!root) return;
      root.hidden = shouldHide();
      root.innerHTML = root.hidden ? '' : render(state);
    }
    async function refresh() {
      var who = host.identity();
      var m = mode();
      if (!active()) {
        generation++; owner = null; recent = []; serverOn = false; optedOut = false;
        state = { phase: 'loading', items: [], more: false, error: '', recent: recent };
        paint(); return;
      }
      if (owner !== who) { owner = who; recent = []; serverOn = false; optedOut = false; }
      if (m === 'off') {
        generation++;
        state = showOldBar()
          ? { phase: 'old_screen', items: [], more: false, error: '', recent: recent, canOpenBillRecon: canOpenBillRecon() }
          : { phase: 'off', items: [], more: false, error: '', recent: recent };
        paint(); return;
      }
      var gen = ++generation;
      var requireEnabled = m === 'server';
      state = { phase: 'loading', items: [], more: false, error: '', recent: recent }; paint();
      try {
        var first = await readTab(host, TABS[0], requireEnabled);
        var tabs = first.off ? [first] : [first].concat(await Promise.all(TABS.slice(1).map(function (tab) { return readTab(host, tab, requireEnabled); })));
        if (tabs.some(function (t) { return t.off; })) {
          if (gen !== generation || who !== host.identity()) return;
          serverOn = false;
          state = { phase: 'off', items: [], more: false, error: '', recent: recent };
          return paint();
        }
        var seen = {}, items = [], more = false;
        tabs.forEach(function (t) {
          if (t.more) more = true;
          t.items.forEach(function (raw) {
            var it = itemFromList(raw);
            if (it && !seen[it.id]) { seen[it.id] = true; items.push(it); }
          });
        });
        if (gen !== generation || who !== host.identity()) return;
        serverOn = true;
        state = { phase: 'list', items: nest(items), more: more, error: '', recent: recent };
      } catch (err) {
        if (gen !== generation || who !== host.identity()) return;
        state = { phase: 'error', items: [], more: false, error: listErrorWords(err), recent: recent };
      }
      paint();
    }
    function find(id) { return state.items.filter(function (i) { return i.id === id; })[0] || null; }
    function startSplit(item) {
      var s = item.suggestion;
      item.split = {
        jobs: s && s.job_id ? [{ job_id: s.job_id, job_number: s.job_number, job_site: s.job_site }] : [],
        lines: item.lines.map(function (l) { return { line_id: l.line_id, description: l.description, cents: l.cents, parts: [{ target: '', job_id: '', text: '' }] }; })
      };
    }
    async function search(item, q) {
      item.search.q = String(q || '').trim();
      if (item.search.q.length < 2) return;
      item.search.phase = 'reading'; paint();
      try {
        var res = await host.read('search_jobs', { q: item.search.q });
        if (!res || !Array.isArray(res.results)) throw new Error('Missing results');
        item.search.results = res.results.filter(function (j) { return j && str(j.id); }).slice(0, 10).map(function (j) {
          return { job_id: j.id, job_number: str(j.job_number), client: str(j.client_name), job_site: [str(j.site_address), str(j.site_suburb)].filter(Boolean).join(', ') };
        });
        item.search.phase = 'done';
      } catch (_) { item.search.phase = 'error'; }
      paint();
    }
    async function record(item) {
      var p = item.pending;
      if (!p || item.busy) return;
      var who = owner;
      item.busy = true; item.message = null; paint();
      var reread = false;
      try {
        var res = await host.post('reconcile_decide', decideBody(item, p.action, p.parts, p.accepted));
        if (!res || typeof res !== 'object' || !res.decision_id) {
          item.message = 'The answer did not confirm this was recorded. Read the list again before choosing again.';
          reread = true;
        } else {
          // Recorded: keep the decision id (Undo sends it), then read the list again so the
          // item and any credits that followed it drop off.
          recent.unshift({ decision_id: res.decision_id, item_id: item.id, words: doneWords(p, item),
            document: documentName(item), recorded: confirmWords(item, p, true) });
          if (recent.length > 10) recent.length = 10;
          item.busy = false;
          return refresh();
        }
      } catch (err) {
        item.message = refusalWords(err);
        reread = !!(err && err.status === 409);
        item.dropped = droppedConnection(err);
      }
      item.busy = false; item.mode = null; item.pending = null;
      if (who !== host.identity()) return refresh();
      paint();
      if (reread) {
        var keep = item.message;
        await refresh();
        var again = find(item.id);
        if (again) again.message = keep;
        // The item left the list (someone decided it): its refusal still shows, above the list.
        else if (state.phase === 'list') state.notice = keep + ' It is no longer on the list.';
        paint();
      }
    }
    async function undo(decisionId, what) {
      if (!active()) { paint(); return; }
      var i = -1;
      recent.forEach(function (d, k) { if (i < 0 && String(d.decision_id) === String(decisionId)) i = k; });
      var d = recent[i];
      if (!d) return;
      d.message = null; d.dropped = false;
      if (what === 'undo_back') { d.confirm = false; return paint(); }
      if (!canUndo(recent, i)) return paint();
      if (what === 'undo') { d.confirm = true; return paint(); }
      if (what !== 'undo_yes' || !d.confirm) return;
      var who = owner;
      d.confirm = false; d.busy = true; paint();
      try {
        var res = await host.post('reconcile_undo', { decision_id: d.decision_id });
        d.busy = false;
        if (!res || typeof res !== 'object' || res.undone !== true) {
          d.message = 'The answer did not confirm this was undone. Read the list again before trying again.';
          d.dropped = true;
          return paint();
        }
        d.undone = true;
        d.undo_decision_id = res.decision_id == null ? null : res.decision_id;
      } catch (err) {
        d.busy = false;
        d.message = undoRefusalWords(err);
        d.dropped = droppedConnection(err);
        if (!(err && err.status === 409)) return paint();
      }
      if (who !== host.identity()) return refresh();
      return refresh();
    }
    async function press(id, what, arg) {
      if (!active()) { paint(); return; }
      if (what === 'reread') return refresh();
      if (what === 'use_old') {
        optedOut = true;
        if (typeof host.setOldScreen === 'function') host.setOldScreen(true);
        generation++;
        state = { phase: 'old_screen', items: [], more: false, error: '', recent: recent, canOpenBillRecon: canOpenBillRecon() };
        return paint();
      }
      if (what === 'use_new') {
        optedOut = false;
        if (typeof host.setOldScreen === 'function') host.setOldScreen(false);
        return refresh();
      }
      if (what === 'open_bill_recon') {
        if (typeof host.openBillRecon === 'function') host.openBillRecon();
        return;
      }
      var item = find(id);
      if (!item || item.busy || blockedWhy(item)) return;
      var s = item.suggestion;
      item.message = null; item.dropped = false;
      if (what === 'back') { item.mode = null; item.pending = null; return paint(); }
      if (what === 'accept_job' && s && s.job_id) {
        item.pending = { action: 'place', parts: [{ job_id: s.job_id }], accepted: true, job: s };
      } else if (what === 'accept_overhead' && s && s.outcome === 'overhead') {
        item.pending = { action: 'overhead', parts: [], accepted: true };
      } else if (what === 'bill_job' && billJob(item)) {
        item.pending = { action: 'place', parts: [{ job_id: billJob(item).job_id }], accepted: false, job: billJob(item) };
      } else if (what === 'overhead') {
        item.pending = { action: 'overhead', parts: [], accepted: false };
      } else if (what === 'another') {
        item.mode = 'another'; item.search = { q: '', phase: 'idle', results: [] }; return paint();
      } else if (what === 'split') {
        item.mode = 'split'; item.search = { q: '', phase: 'idle', results: [] }; startSplit(item); return paint();
      } else if (what === 'search' && (item.mode === 'another' || item.mode === 'split')) {
        return search(item, arg);
      } else if (what === 'pick' && item.search && item.search.results[arg]) {
        var j = item.search.results[arg];
        if (item.mode === 'split') {
          if (!item.split.jobs.some(function (x) { return x.job_id === j.job_id; })) item.split.jobs.push(j);
          item.search = { q: '', phase: 'idle', results: [] };
          return paint();
        }
        if (item.mode !== 'another') return;
        item.pending = { action: 'place', parts: [{ job_id: j.job_id }], accepted: !!(s && s.job_id === j.job_id), job: j };
      } else if (what === 'save_split' && item.mode === 'split') {
        if (!Split.valid(item.split.lines)) return;
        item.pending = { action: 'split', parts: Split.partsFor(item.split.lines), accepted: false, summary: splitSummary(item) };
      } else if (what === 'record' && item.mode === 'confirm') {
        return record(item);
      } else return;
      item.mode = 'confirm'; paint();
    }
    // A split's part changed: keep the state, repaint only the add-ups so typing keeps focus.
    function partEdit(id, li, pi, field, value) {
      var item = find(id);
      if (!item || item.mode !== 'split' || item.busy) return;
      var l = item.split.lines[li], p = l && l.parts[pi];
      if (!p) return;
      if (field === 'target') {
        var v = String(value || '');
        p.target = v === 'overhead' ? 'overhead' : v.indexOf('job:') === 0 ? 'job' : '';
        p.job_id = p.target === 'job' ? v.slice(4) : '';
      } else p.text = String(value == null ? '' : value);
      if (!root) return;
      var card = root.querySelector('[data-rp-id="' + (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (!card) return;
      var leftEl = card.querySelector('[data-rp-line="' + li + '"] [data-rp-left]');
      if (leftEl) leftEl.outerHTML = leftHtml(l);
      var foot = card.querySelector('[data-rp-foot]');
      if (foot) foot.textContent = footerHtml(item);
      var save = card.querySelector('[data-rp="save_split"]');
      if (save) save.disabled = !Split.valid(item.split.lines);
    }
    function partCount(id, li, pi, add) {
      var item = find(id);
      if (!item || item.mode !== 'split' || item.busy) return;
      var l = item.split.lines[li];
      if (!l) return;
      if (add) l.parts.push({ target: '', job_id: '', text: '' });
      else if (l.parts.length > 1) l.parts.splice(pi, 1);
      paint();
    }
    function mount(el) {
      root = el;
      root.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-rp]');
        if (!b || !root.contains(b) || b.disabled || b.type === 'submit') return;
        var card = b.closest('[data-rp-id]'), id = card && card.getAttribute('data-rp-id');
        var what = b.getAttribute('data-rp');
        var decided = b.closest('[data-rp-decision]');
        if (decided && /^undo/.test(what)) return undo(decided.getAttribute('data-rp-decision'), what);
        var line = b.closest('[data-rp-line]'), part = b.closest('[data-rp-part]');
        if (what === 'add_part' || what === 'remove_part') return partCount(id, Number(line && line.getAttribute('data-rp-line')), Number(part && part.getAttribute('data-rp-part')), what === 'add_part');
        press(id, what, b.hasAttribute('data-rp-i') ? Number(b.getAttribute('data-rp-i')) : undefined);
      });
      root.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var card = ev.target.closest('[data-rp-id]');
        if (card && ev.target.getAttribute('data-rp-form') === 'search') press(card.getAttribute('data-rp-id'), 'search', ev.target.elements.q.value);
      });
      function edit(ev) {
        var t = ev.target, part = t.closest && t.closest('[data-rp-part]');
        if (!part) return;
        var card = t.closest('[data-rp-id]'), line = t.closest('[data-rp-line]');
        partEdit(card.getAttribute('data-rp-id'), Number(line.getAttribute('data-rp-line')), Number(part.getAttribute('data-rp-part')),
          t.hasAttribute('data-rp-target') ? 'target' : 'text', t.value);
      }
      root.addEventListener('input', edit);
      root.addEventListener('change', edit);
      paint();
    }
    return { mount: mount, refresh: refresh, press: press, undo: undo, partEdit: partEdit, partCount: partCount, state: function () { return state; } };
  }

  var core = {
    isDefaultRole: isDefaultRole, switchMode: switchMode, switchOn: switchOn, dollars: dollars, amountWords: amountWords, dateWords: dateWords, waitWords: waitWords,
    suggestionWords: suggestionWords, refusalWords: refusalWords, listErrorWords: listErrorWords, itemFromList: itemFromList,
    blockedWhy: blockedWhy, undoWords: undoWords, setAsideWords: setAsideWords, canUndo: canUndo, undoRefusalWords: undoRefusalWords, splitSummary: splitSummary, footerHtml: footerHtml, leftHtml: leftHtml, linesCents: linesCents, billWords: billWords, shared: shared, billCreditsFromList: billCreditsFromList, readTab: readTab, nest: nest, decideBody: decideBody, confirmWords: confirmWords, render: render, create: create
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ── The page ──
  var FLAG_KEY = 'sw_reconcile_place';
  function readStored() { try { return localStorage.getItem(FLAG_KEY); } catch (e) { return null; } }
  function writeStored(v) {
    try {
      if (v == null) localStorage.removeItem(FLAG_KEY);
      else localStorage.setItem(FLAG_KEY, v);
    } catch (e) { /* storage blocked */ }
  }
  function stripUrlFlag() {
    try {
      var url = new URL(window.location.href);
      if (url.searchParams.has('reconcile_place')) {
        url.searchParams.delete('reconcile_place');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
    } catch (e) { /* keep URL */ }
  }
  function currentRole() {
    var auth = window.SECUREWORKS_CLOUD && window.SECUREWORKS_CLOUD.auth;
    return auth && auth.isLoggedIn() ? auth.getRole() : null;
  }
  function urlParam() {
    var m = /[?&]reconcile_place=([^&#]*)/.exec(String(window.location ? window.location.search : ''));
    return m ? m[1].toLowerCase() : '';
  }
  var host = {
    identity: function () {
      var auth = window.SECUREWORKS_CLOUD && window.SECUREWORKS_CLOUD.auth;
      if (!auth || !auth.isLoggedIn() || !isDefaultRole(auth.getRole())) return null;
      var user = auth.getUser(); return user && user.id;
    },
    mode: function () {
      return switchMode(window.location ? window.location.search : '', readStored(), currentRole());
    },
    showOldBar: function () {
      var p = urlParam();
      if (p === '0' || p === 'off') return false;
      return readStored() === '0' && isDefaultRole(currentRole());
    },
    setOldScreen: function (off) {
      stripUrlFlag();
      if (off) writeStored('0');
      else writeStored(isDefaultRole(currentRole()) ? null : '1');
    },
    canOpenBillRecon: function () { return typeof window.jpOpenBillsToPlace === 'function'; },
    openBillRecon: function () { if (typeof window.jpOpenBillsToPlace === 'function') window.jpOpenBillsToPlace(); },
    visible: function () {
      var view = document.getElementById('viewRecon');
      return !!(view && view.classList.contains('active'));
    },
    read: function (action, params) { return window.opsFetch(action, params); },
    post: function (action, body) { return window.opsPost(action, body); }
  };
  var api = create(host), shown = false;
  window.ReconcilePlace = { refresh: api.refresh };
  function sync(force) {
    var now = !!(host.visible() && host.identity());
    if (now && (force === true || !shown)) api.refresh();
    shown = now;
  }
  function start() {
    var view = document.getElementById('viewRecon');
    if (!view || document.getElementById('reconcilePlaceRoot')) return;
    var root = document.createElement('div');
    root.id = 'reconcilePlaceRoot'; root.hidden = true;
    view.insertBefore(root, view.firstChild);
    var style = document.createElement('style');
    style.textContent = '.rp-wrap{max-width:880px;margin:0 auto;padding:16px 16px 24px;border-bottom:1px solid var(--sw-border,#ddd)}' +
      '.rp-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.rp-head h2{font-size:20px;margin:0}.rp-head-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
      '.rp-old-bar{max-width:880px;margin:0 auto;padding:10px 16px;border-bottom:1px solid var(--sw-border,#ddd);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;color:var(--sw-text-sec,#4a5560)}' +
      '.rp-old-bar button{font:inherit;font-size:13px;border:1px solid var(--sw-border,#bbb);border-radius:8px;padding:8px 12px;background:var(--sw-card,#fff);color:var(--sw-text,#222);cursor:pointer;min-height:44px}' +
      '.rp-old-bar :focus-visible{outline:2px solid #1f5fbf;outline-offset:3px}' +
      '.rp-count{font-size:12px;padding:3px 8px;background:#fff4e5;color:#8a4b00;border-radius:12px;font-weight:600}' +
      '.rp-lede,.rp-meta,.rp-note{color:var(--sw-text-sec,#4a5560);font-size:13px}.rp-lede{margin:4px 0 16px}' +
      '.rp-card{background:var(--sw-card,#fff);border:1px solid var(--sw-border,#e3e3e3);border-radius:10px;padding:12px 14px;margin-bottom:10px;overflow-wrap:anywhere}' +
      '.rp-top{display:flex;justify-content:space-between;gap:8px 12px;flex-wrap:wrap;font-weight:600}.rp-meta{display:flex;gap:4px 12px;flex-wrap:wrap;margin-top:2px}' +
      '.rp-sug{font-size:14px;margin-top:6px}.rp-credit{font-size:14px;margin-top:6px}.rp-tag{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:6px;background:#e7f1ff;color:#1f4f99;margin-right:4px}.rp-why{font-size:13px;margin-top:6px}.rp-why h4{font-size:13px;margin:8px 0 2px}.rp-why ul{margin:0;padding-left:18px}' +
      '.rp-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.rp-wrap button,.rp-wrap select,.rp-wrap input{font:inherit;font-size:14px;border:1px solid var(--sw-border,#bbb);border-radius:8px;padding:8px 12px;background:var(--sw-card,#fff);color:var(--sw-text,#222);max-width:100%;box-sizing:border-box}' +
      '.rp-wrap button{cursor:pointer;min-height:44px}.rp-wrap button:disabled{opacity:.5;cursor:default}.rp-wrap :focus-visible{outline:2px solid #1f5fbf;outline-offset:3px}' +
      '.rp-main,.rp-yes{background:#1f5fbf!important;color:#fff!important;border-color:#1f5fbf!important}' +
      '.rp-confirm{margin-top:10px;padding:12px;border-radius:8px;background:#f3f7ff;font-size:14px}.rp-panel{margin-top:10px;padding:12px;border-radius:8px;background:var(--sw-bg,#f6f7f9)}' +
      '.rp-search{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}.rp-search label{display:flex;flex-direction:column;gap:4px;font-size:13px;flex:1 1 220px}' +
      '.rp-results{display:flex;flex-direction:column;gap:6px;margin:8px 0}.rp-results button{text-align:left}' +
      '.rp-line{margin-top:12px;padding-top:10px;border-top:1px solid var(--sw-border,#ddd)}.rp-line-head{font-weight:600;font-size:14px}' +
      '.rp-part{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.rp-part select{flex:1 1 220px}.rp-part input{flex:0 1 130px}' +
      '.rp-line-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}.rp-left{font-size:14px;font-weight:600}.rp-off{color:#b42318}' +
      '.rp-foot{font-size:14px;margin:12px 0 0}.rp-msg{margin:10px 0 0;padding:10px;border-radius:8px;background:#fdecec;color:#8a1c1c;font-size:13px}' +
      '.rp-recent{margin:0 0 12px;padding:10px 12px;border-radius:8px;background:#eef8f1;color:#1d5b33;font-size:14px}.rp-recent h3{font-size:14px;margin:0 0 4px}.rp-recent ul{margin:0;padding-left:18px}.rp-recent .rp-note{margin:6px 0 0}' +
      '.rp-bill-credits{margin-top:8px;font-size:13px}.rp-bill-credits ul{margin:4px 0 0;padding-left:18px}.rp-shared-ref{font-size:13px;color:var(--sw-text-sec,#4a5560)}.rp-group{margin-bottom:10px}.rp-group>.rp-card{margin-bottom:0}.rp-credits{margin:0 0 0 18px;padding:8px 0 0 12px;border-left:3px solid #c9dcf7}.rp-credits .rp-card{margin-bottom:8px}' +
      '@media(max-width:599px){.rp-acts button{flex:1 1 100%}}';
    document.head.appendChild(style);
    api.mount(root);
    new MutationObserver(function () { sync(); }).observe(view, { attributes: true, attributeFilter: ['class'] });
    var cloud = window.SECUREWORKS_CLOUD;
    if (cloud && cloud.on) { cloud.on('auth:login', function () { sync(true); }); cloud.on('auth:logout', function () { shown = false; api.refresh(); }); }
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
