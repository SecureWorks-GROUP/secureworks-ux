// ════════════════════════════════════════════════════════════
// CLEAR DEBT: one debtor work list, one debtor card, one timeline, one draft.
// Design: Part B of the CFO desk's debt system review (24 Sep 2026), built to
// the approved booking screen's standard (modules/ops-sales-booking.*).
//
// Read: ONE GET ops-api?action=debt_worklist&timeline=recent when the tab
//   opens (and again only on an explicit Refresh). Choosing a debtor, picking
//   an invoice, filtering the timeline and drafting all render from that one
//   payload with no further request.
// Writes: none. This screen sends nothing, saves no note, marks no proposal and
//   records no approval. Sending arrives with a separate approval step.
// Contract: secureworks-backend supabase/functions/ops-api/debt_worklist_read_model.ts
//   (debt-worklist/v1). Styles: modules/ops-clear-debt-v2.css, scoped to #clearDebtRoot.
// ════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  var CONTRACT = 'debt-worklist/v1';
  var ROOT_ID = 'clearDebtRoot';
  var TZ = 'Australia/Perth';

  var state = {
    data: null,
    loading: false,
    error: null,
    search: '',
    filter: 'all',
    owner: '',
    selectedKey: null,
    invoiceId: null,
    tlFilter: 'all',
    channel: null,
    drafts: {},
    showDetails: false,
    requestSeq: 0
  };

  // ── formatting ──────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null || !isFinite(Number(n))) return 'amount not in the read';
    return '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function parts(iso, opts) {
    var d = new Date(iso);
    if (!isFinite(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-AU', Object.assign({ timeZone: TZ }, opts)).formatToParts(d)
      .reduce(function (o, p) { o[p.type] = p.value; return o; }, {});
  }
  function dayLabel(iso, withYear) {
    // A date-only value is a calendar day, not an instant: read it in UTC so
    // Perth never rolls it to the day before or after.
    var dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
    var p = dateOnly
      ? new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(new Date(iso + 'T12:00:00Z')).reduce(function (o, x) { o[x.type] = x.value; return o; }, {})
      : parts(iso, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (!p) return 'date unknown';
    return p.weekday + ' ' + p.day + ' ' + p.month + (withYear ? ' ' + p.year : '');
  }
  function timeLabel(iso) {
    var p = parts(iso, { hour: 'numeric', minute: '2-digit', hour12: true });
    if (!p) return '';
    return p.hour + ':' + p.minute + String(p.dayPeriod || '').toLowerCase().replace(/\s|\./g, '');
  }
  function whenLabel(iso, precision) {
    if (!iso) return 'time unknown';
    if (precision === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return dayLabel(String(iso).slice(0, 10));
    return dayLabel(iso) + ', ' + timeLabel(iso);
  }
  function ageBetween(fromIso, toIso) {
    var ms = Date.parse(toIso) - Date.parse(fromIso);
    if (!isFinite(ms)) return null;
    var min = Math.max(0, Math.round(ms / 60000));
    if (min < 60) return plural(min, 'min');
    var h = Math.round(min / 60);
    if (h < 48) return plural(h, 'hour');
    return plural(Math.round(h / 24), 'day');
  }
  function words(s) { return String(s || '').replace(/_/g, ' '); }

  // ── the one read ────────────────────────────────────────────
  function isUnknownAction(err) {
    var msg = String((err && err.message) || err || '');
    return /unknown action|no such action|unsupported action/i.test(msg);
  }

  function isCount(value) {
    return Boolean(value && typeof value.n === 'number' && isFinite(value.n) &&
      typeof value.of === 'number' && isFinite(value.of));
  }

  function checkContract(resp) {
    if (!resp || typeof resp !== 'object') return 'the read returned nothing';
    if (resp.version !== CONTRACT) return 'the read answered with contract ' + (resp.version ? '"' + resp.version + '"' : 'with no version') + ', and this screen reads ' + CONTRACT;
    if (!Array.isArray(resp.debtors)) return 'the read carried no debtor list';
    var summary = resp.summary;
    var invoices = summary && summary.invoices;
    var debtors = summary && summary.debtors;
    var counts = invoices && invoices.link && invoices.facts && [
      invoices.overdue, invoices.no_due_date, invoices.link.linked,
      invoices.link.ambiguous, invoices.link.none, invoices.link.unknown,
      invoices.facts.present, invoices.facts.missing, invoices.facts.no_job,
      invoices.facts.unknown, invoices.xero_stale, invoices.with_faults,
      debtors && debtors.verified, debtors && debtors.standing_alone
    ];
    var complete = Boolean(
      invoices && typeof invoices.denominator === 'string' &&
      typeof invoices.count === 'number' && isFinite(invoices.count) &&
      typeof invoices.amount_due === 'number' && isFinite(invoices.amount_due) &&
      isCount(invoices.overdue) && typeof invoices.overdue.amount_due === 'number' && isFinite(invoices.overdue.amount_due) &&
      debtors && typeof debtors.denominator === 'string' &&
      typeof debtors.count === 'number' && isFinite(debtors.count) &&
      typeof debtors.shown === 'number' && isFinite(debtors.shown) &&
      counts && counts.every(isCount)
    );
    if (!complete) return 'the read carried incomplete summary counts';
    return null;
  }

  function load() {
    var root = rootEl();
    if (!root) return Promise.resolve();
    var seq = ++state.requestSeq;
    state.loading = true;
    state.error = null;
    render();
    if (typeof global.opsFetch !== 'function') {
      state.loading = false;
      state.error = { kind: 'failed', message: 'the ops API reader is not on this page' };
      render();
      return Promise.resolve();
    }
    return Promise.resolve()
      .then(function () { return global.opsFetch('debt_worklist', { timeline: 'recent' }); })
      .then(function (resp) {
        if (seq !== state.requestSeq) return;
        var bad = checkContract(resp);
        state.loading = false;
        if (bad) { state.error = { kind: 'contract', message: bad }; state.data = null; render(); return; }
        state.data = resp;
        if (state.selectedKey && !findDebtor(state.selectedKey)) clearSelection();
        if (state.invoiceId && !findInvoice(currentDebtor(), state.invoiceId)) state.invoiceId = null;
        render();
      })
      .catch(function (err) {
        if (seq !== state.requestSeq) return;
        state.loading = false;
        state.data = null;
        state.error = isUnknownAction(err)
          ? { kind: 'unknown', message: 'debt_worklist' }
          : { kind: 'failed', message: String((err && err.message) || err || 'no answer') };
        render();
      });
  }

  // ── lookups ─────────────────────────────────────────────────
  function debtors() { return (state.data && state.data.debtors) || []; }
  function findDebtor(key) {
    var list = debtors();
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function currentDebtor() { return state.selectedKey ? findDebtor(state.selectedKey) : null; }
  function findInvoice(d, id) {
    if (!d || !id) return null;
    for (var i = 0; i < d.invoices.length; i++) if (d.invoices[i].xero_invoice_id === id) return d.invoices[i];
    return null;
  }
  function invoiceNumber(d, id) {
    var inv = findInvoice(d, id);
    return inv ? (inv.invoice_number || 'an invoice with no number') : 'an invoice not on this debtor';
  }
  function debtorName(d) {
    return (d.identity && d.identity.name) || 'Contact with no name in Xero';
  }
  function clearSelection() {
    state.selectedKey = null;
    state.invoiceId = null;
    state.channel = null;
    state.tlFilter = 'all';
  }

  // ── search and filters (work list) ──────────────────────────
  // Each field is searched on its own for the whole query, so "Debtor 020"
  // finds that name and never every row holding "debtor" and "020" apart.
  function searchFields(d) {
    var bits = [].concat((d.identity && d.identity.names) || []);
    (d.invoices || []).forEach(function (inv) {
      bits.push(inv.invoice_number, inv.reference);
      if (inv.link) {
        bits.push(inv.link.job_number);
        (inv.link.candidates || []).forEach(function (c) { bits.push(typeof c === 'string' ? c : c && c.job_number); });
      }
    });
    return bits.filter(Boolean).map(function (b) { return String(b).replace(/\s+/g, ' ').toLowerCase(); });
  }
  function matchesSearch(d, q) {
    var needle = String(q || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!needle) return true;
    return searchFields(d).some(function (f) { return f.indexOf(needle) >= 0; });
  }
  function anyInvoice(d, pred) { return (d.invoices || []).some(pred); }
  function classOf(inv) { return (inv.classification && inv.classification.class) || null; }
  function blockerOf(inv) { return (inv.classification && inv.classification.blocker) || null; }
  function hasPendingDraft(inv) { return Boolean(inv.proposal && inv.proposal.status === 'pending'); }

  // Each filter is answered by a field the read actually carries. Promise
  // dates and a ready-for-Captain verdict are not in debt-worklist/v1, so they
  // are named in Details as missing rather than guessed from a clean-looking row.
  var FILTERS = [
    { key: 'all', label: 'All debtors', test: function () { return true; } },
    { key: 'overdue', label: 'Overdue', test: function (d) { return d.overdue_count > 0; } },
    { key: 'over60', label: 'More than 60 days overdue', test: function (d) { return d.max_days_overdue > 60; } },
    { key: 'draft', label: 'Draft waiting', test: function (d) { return anyInvoice(d, hasPendingDraft); } },
    { key: 'ours_last', label: 'Our message was last', test: function (d) { var l = d.last_contact && d.last_contact.last; return Boolean(l && l.direction === 'outbound'); } },
    { key: 'not_linked', label: 'Invoice not linked to a job', test: function (d) { var s = d.link_state || {}; return (s.none || 0) + (s.ambiguous || 0) + (s.unknown || 0) > 0; } },
    { key: 'facts_missing', label: 'Facts missing', test: function (d) { var f = d.sources && d.sources.facts && d.sources.facts.status; return f === 'missing' || f === 'partial'; } },
    { key: 'stale', label: 'Stale or unreadable source', test: function (d) { return staleOrUnreadable(d); } },
    { key: 'unconfirmed', label: 'Contact not confirmed', test: function (d) { return !d.identity || d.identity.status !== 'verified'; } },
    { key: 'dispute', label: 'In dispute', test: function (d) { return anyInvoice(d, function (i) { return classOf(i) === 'in_dispute'; }); } },
    { key: 'blocked', label: 'Blocked by us', test: function (d) { return anyInvoice(d, function (i) { return classOf(i) === 'blocked_by_us' && !/paid_unallocated|payment_claimed/.test(blockerOf(i) || ''); }); } },
    { key: 'allocation', label: 'Paid, awaiting allocation', test: function (d) { return anyInvoice(d, function (i) { return /paid_unallocated|payment_claimed/.test(blockerOf(i) || ''); }); } },
    { key: 'not_owed', label: 'Not owed or bad debt', test: function (d) { return anyInvoice(d, function (i) { return classOf(i) === 'not_owed' || classOf(i) === 'bad_debt'; }); } },
    { key: 'unclassified', label: 'Not yet classified', test: function (d) { return anyInvoice(d, function (i) { return !classOf(i) || classOf(i) === 'unclassified'; }); } }
  ];
  // Any source the read marks stale or unreadable, plus stale Xero and faults.
  var STALE_SOURCES = ['ghl', 'email', 'notes', 'facts'];
  function staleOrUnreadable(d) {
    if (!(d.freshness && d.freshness.xero_fresh) || (d.faults || []).length > 0) return true;
    var s = d.sources || {};
    if (s.facts && s.facts.timeline_read === 'unreadable') return true;
    return STALE_SOURCES.some(function (k) { return /^(stale|unreadable)$/.test(String((s[k] && s[k].status) || '')); });
  }
  function filterByKey(key) {
    for (var i = 0; i < FILTERS.length; i++) if (FILTERS[i].key === key) return FILTERS[i];
    return FILTERS[0];
  }
  function ownersOf(list) {
    var seen = {};
    list.forEach(function (d) { (d.owners || []).forEach(function (o) { seen[o.owner] = (seen[o.owner] || 0) + 1; }); });
    return Object.keys(seen).sort().map(function (o) { return { owner: o, debtors: seen[o] }; });
  }
  function matchesOwner(d, owner) {
    if (!owner) return true;
    return (d.owners || []).some(function (o) { return o.owner === owner; });
  }
  function visibleDebtors(opts) {
    opts = opts || state;
    var f = filterByKey(opts.filter);
    return debtors().filter(function (d) { return f.test(d) && matchesOwner(d, opts.owner) && matchesSearch(d, opts.search); });
  }

  // ── timeline ───────────────────────────────────────────────
  var TL_CHIPS = [
    { key: 'all', label: 'All' },
    { key: 'text', label: 'Texts' },
    { key: 'email', label: 'Emails' },
    { key: 'note', label: 'Notes' },
    { key: 'call', label: 'Calls' },
    { key: 'xero', label: 'Invoices and Xero' },
    { key: 'facts', label: 'Facts' }
  ];
  // Captured facts are ordinary timeline entries with kind "fact" and a fact
  // block {kind, value, captured_at, source_id, state}; nothing else is a fact.
  function isFactEntry(e) { return Boolean(e) && e.kind === 'fact'; }
  function entryGroup(e) {
    if (isFactEntry(e)) return 'facts';
    if (e.provider === 'xero' || /^xero_/.test(e.kind || '')) return 'xero';
    if (e.kind === 'call' || e.channel === 'call') return 'call';
    if (e.channel === 'sms' || e.kind === 'sms') return 'text';
    if (e.channel === 'email' || e.kind === 'email') return 'email';
    if (e.channel === 'note' || /note|debt_log/.test(e.kind || '')) return 'note';
    if (e.kind === 'invoice_event') return 'xero';
    return 'other';
  }
  function timelineEntries(d, opts) {
    opts = opts || state;
    var entries = (d && d.timeline && d.timeline.entries) || [];
    return entries.filter(function (e) {
      if (opts.tlFilter && opts.tlFilter !== 'all' && entryGroup(e) !== opts.tlFilter) return false;
      return true;
    });
  }
  function chipCounts(d) {
    var counts = { all: 0, text: 0, email: 0, note: 0, call: 0, xero: 0, other: 0, facts: 0, factsListed: false };
    ((d && d.timeline && d.timeline.entries) || []).forEach(function (e) { counts.all += 1; counts[entryGroup(e)] += 1; });
    var f = d && d.sources && d.sources.facts;
    counts.factsListed = Boolean(f && f.timeline_read === 'read');
    return counts;
  }
  var PROVIDER_LABEL = { ghl: 'GHL', outlook: 'Outlook', xero: 'Xero', secureworks: 'SecureWorks', luna: 'Luna' };
  var SOURCE_LABEL = {
    ghl_cache: 'GHL stored copy',
    inbox: 'Inbox copy',
    business_events: 'captured event',
    job_events: 'job record',
    payment_chase_logs: 'debt desk log',
    xero_mirror: 'Xero copy',
    current_job_context_facts: 'captured facts'
  };
  var KIND_LABEL = {
    sms: 'Text', email: 'Email', ghl_note: 'GHL note', job_note: 'Job note', debt_note: 'Desk note',
    debt_log: 'Desk log', call: 'Call', invoice_event: 'Invoice event',
    xero_invoice_raised: 'Invoice raised', xero_payment: 'Payment', message: 'Message',
    fact: 'Captured fact'
  };
  function providerLabel(p) { return PROVIDER_LABEL[p] || (p ? String(p) : 'Unknown source'); }
  function sourceLabel(s) { return SOURCE_LABEL[s] || words(s || 'unknown'); }
  // Only messages have a direction worth saying; notes, calls and records do not.
  function directionWord(e) {
    if (e.kind === 'invoice_event' || e.direction === 'internal' || e.direction === 'system') return '';
    if (e.direction === 'inbound') return 'from them';
    if (e.direction === 'outbound') return 'from us';
    return '(direction unknown)';
  }
  function kindLabel(e) {
    var k = KIND_LABEL[e.kind] || words(e.kind || e.channel || 'entry');
    if (e.kind === 'invoice_event' && e.subject) k = words(e.subject).replace(/\./g, ' ');
    return k.charAt(0).toUpperCase() + k.slice(1);
  }
  function isRecord(e) { return e.direction === 'system' || e.kind === 'invoice_event'; }
  function previewCut(e) { return String(e.preview || '').length >= 500; }

  // ONE rule for every empty or partial view. A source that was not fully
  // read (unread, unreadable, partial, stale, capped or truncated) gets one
  // line naming it and its limit, and no absence claim. Absence is stated only
  // when every source behind the view was fully read, and then only for what
  // was read ("among the 7 stored items read"). Each condition is one line.
  var GROUP_SOURCES = {
    all: ['ghl', 'email', 'notes', 'xero', 'facts'],
    contact: ['ghl', 'email', 'notes'],
    text: ['ghl'], call: ['ghl', 'notes'], email: ['email'], note: ['notes', 'ghl'],
    xero: ['xero'], facts: ['facts'], other: []
  };
  var MESSAGE_GROUPS = { all: 1, contact: 1, text: 1, call: 1, email: 1, note: 1 };
  function withFix(v, text) {
    var bits = [];
    if (v && v.owner) bits.push('owner ' + v.owner);
    if (v && v.recovery_action) bits.push('fix: ' + v.recovery_action);
    if (!bits.length) return text;
    return text.replace(/\.$/, '') + ' (' + bits.join('; ') + ').';
  }
  function sourceLimit(d, key) {
    var s = (d.sources && d.sources[key]) || {};
    var st = s.status;
    var asOf = d.freshness && d.freshness.as_of;
    function line(bad, text, short) { return { key: key, bad: bad, text: withFix(s, text), short: short }; }
    if (key === 'ghl') {
      if (st === 'bound' || st === 'several') return null;
      if (st === 'stale') return line(true, 'Stored GHL texts are stale: last captured ' + (s.last_success_at ? (ageBetween(s.last_success_at, asOf) || 'some time') + ' before this read' : 'at a time the read did not give') + (s.stale_after ? ', stale after ' + s.stale_after : '') + '.', 'stored GHL texts are stale');
      if (st === 'unreadable') return line(true, 'Stored GHL texts could not be read.', 'stored GHL texts could not be read');
      if (st === 'no_job') return line(false, 'No invoice on this debtor is linked to a job, so stored GHL texts cannot be read.', 'no job is linked, so GHL texts cannot be read');
      if (st === 'no_contact') return line(false, 'The linked job has no GHL contact, so stored GHL texts cannot be found.', 'the job has no GHL contact');
      if (st === 'not_read') return line(false, 'Stored GHL texts were not read for this view.', 'GHL texts were not read');
      return line(false, 'The read did not say whether stored GHL texts were read.', 'GHL texts may not have been read');
    }
    if (key === 'email') {
      if (st === 'partial' || st === 'read' || st === 'current') return line(false, 'Stored emails are inbound copies only; sent emails are not captured.', 'sent emails are not captured');
      if (st === 'unreadable') return line(true, 'Stored emails could not be read.', 'stored emails could not be read');
      if (st === 'no_job') return line(false, 'No invoice on this debtor is linked to a job, so stored emails cannot be read.', 'no job is linked, so emails cannot be read');
      if (st === 'not_read') return line(false, 'Stored emails were not read for this view.', 'emails were not read');
      return line(false, 'The read did not say whether stored emails were read.', 'emails may not have been read');
    }
    if (key === 'notes') {
      if (st === 'read') return null;
      if (st === 'unreadable') return line(true, 'Notes and desk logs could not be read.', 'notes could not be read');
      if (st === 'not_read') return line(false, 'Notes and desk logs were not read for this view.', 'notes were not read');
      return line(false, 'The read did not say whether notes were read.', 'notes may not have been read');
    }
    if (key === 'xero') {
      if (st === 'current') return null;
      return line(true, 'The Xero copy is stale' + (s.stale_after_hours ? ' (older than ' + plural(s.stale_after_hours, 'hour') + ')' : '') + '.', 'the Xero copy is stale');
    }
    if (key === 'facts') {
      if (s.timeline_read === 'unreadable') return line(true, 'Captured facts could not be read for this timeline.', 'captured facts could not be read');
      if (s.timeline_read === 'not_read') return line(false, 'Captured facts were not read for this view.', 'captured facts were not read');
      if (s.timeline_read !== 'read') return line(false, 'This read does not list captured facts; it only counts them: ' + factsWords(s).toLowerCase() + '.', 'captured facts are counted, not listed');
      if (st === 'no_job') return line(false, 'No invoice on this debtor is linked to a job, so captured facts cannot be read.', 'no job is linked, so facts cannot be read');
      if (st === 'unreadable' || st === 'unknown') return line(true, 'Whether facts were captured for these invoices could not be read.', 'captured facts are unknown');
      return null;
    }
    return null;
  }
  function timelineLimits(d, group) {
    var tl = d.timeline || {};
    var out = [];
    (GROUP_SOURCES[group] || []).forEach(function (k) { var l = sourceLimit(d, k); if (l) out.push(l); });
    if (MESSAGE_GROUPS[group] && (tl.per_job_cap_reached || []).length) {
      out.push({ key: 'cap', bad: false, text: 'Job ' + tl.per_job_cap_reached.join(', ') + ' has more than ' + tl.per_job_cap + ' messages; only the newest ' + tl.per_job_cap + ' per job were read.', short: 'only the newest ' + tl.per_job_cap + ' messages per job were read' });
    }
    if ((group === 'facts' || group === 'all') && (tl.facts_cap_reached || []).length) {
      out.push({ key: 'facts_cap', bad: false, text: 'Job ' + tl.facts_cap_reached.join(', ') + ' has more than ' + tl.facts_per_job_cap + ' captured facts; only the newest ' + tl.facts_per_job_cap + ' per job were read.', short: 'only the newest ' + tl.facts_per_job_cap + ' facts per job were read' });
    }
    if (tl.truncated) {
      out.push({ key: 'truncated', bad: false, text: 'Only the newest ' + (tl.entries || []).length + ' of ' + tl.entries_read + ' stored entries are in this read.', short: 'only the newest ' + (tl.entries || []).length + ' of ' + tl.entries_read + ' stored entries were read' });
    }
    var seen = {};
    return out.filter(function (l) { if (seen[l.text]) return false; seen[l.text] = true; return true; });
  }
  // The absence line for an empty view, or null when a limit forbids one.
  function absenceLine(d, group, what) {
    if (timelineLimits(d, group).length) return null;
    var n = ((d.timeline && d.timeline.entries) || []).length;
    return 'No ' + what + ' among the ' + plural(n, 'stored item') + ' read for this debtor.';
  }

  // ── composer ────────────────────────────────────────────────
  var CHANNELS = [
    { key: 'text', label: 'Text' },
    { key: 'email', label: 'Email' },
    { key: 'note', label: 'Note' }
  ];
  function proposalChannel(p) {
    if (!p) return null;
    if (p.kind === 'sms') return 'text';
    if (p.kind === 'email' || p.kind === 'statement') return 'email';
    return null;
  }
  function looksLikeEmail(s) { return /@/.test(String(s || '')); }
  function draftKey(invoiceId, channel) { return invoiceId + '|' + channel; }

  // Everything the draft knows and everything it does not, for one invoice.
  function composerModel(d, invoiceId, channel, drafts) {
    var inv = findInvoice(d, invoiceId);
    if (!inv) return null;
    var p = inv.proposal || null;
    var pChannel = proposalChannel(p);
    var ch = channel || (p && p.status === 'pending' && pChannel) || 'text';
    var proposalFits = Boolean(p && p.status === 'pending' && pChannel === ch);
    var original = proposalFits ? String(p.text || '') : '';
    var key = draftKey(invoiceId, ch);
    var body = drafts && Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : original;
    var to = null;
    if (proposalFits && p.to) {
      if (ch === 'email' && looksLikeEmail(p.to)) to = p.to;
      if (ch === 'text' && !looksLikeEmail(p.to)) to = p.to;
    }
    var missing = [];
    if (ch === 'text') {
      if (!to) missing.push('the phone number to text');
      missing.push('the line the text is sent from');
    } else if (ch === 'email') {
      if (!to) missing.push('the email address');
      missing.push('the subject line');
      missing.push('which invoice PDF is attached');
      missing.push('the mailbox it is sent from');
    }
    if (proposalFits && !String(p.text || '').trim()) missing.push('the drafted words');
    return {
      invoice: inv,
      channel: ch,
      proposal: p,
      proposalFits: proposalFits,
      original: original,
      body: body,
      edited: body !== original,
      to: to,
      missing: missing
    };
  }

  // ── rendering ───────────────────────────────────────────────
  function rootEl() { return global.document ? global.document.getElementById(ROOT_ID) : null; }

  var ICON = {
    search: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
    back: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
    refresh: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    chevron: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    receipt: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    stream: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h14M5 12h9M5 19h12"/></svg>',
    pen: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/></svg>',
    lock: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
  };

  function render() {
    var root = rootEl();
    if (!root) return;
    var open = Boolean(currentDebtor());
    root.innerHTML = '<div class="db' + (open ? ' is-open' : '') + '">' +
      renderHead() +
      renderBody() +
      '</div>';
  }

  function renderHead() {
    var data = state.data;
    var sub = data
      ? 'Open receivables as of ' + esc(timeLabel(data.as_of)) + ' ' + esc(dayLabel(data.as_of)) + '. Read only: nothing is sent from this screen.'
      : 'Open receivables, one debtor at a time. Read only: nothing is sent from this screen.';
    return '<header class="db-head">' +
      '<div class="db-title"><h1>Clear Debt</h1><p>' + sub + '</p></div>' +
      '<button type="button" class="refresh" data-cd="refresh"' + (state.loading ? ' aria-busy="true" disabled' : '') + '>' + ICON.refresh + 'Refresh</button>' +
      '</header>';
  }

  function renderBody() {
    if (state.loading && !state.data) {
      return '<p class="db-loading" role="status">Reading the open invoice book…</p>' + skeleton();
    }
    if (state.error) return renderError();
    if (!state.data) return '';
    return renderCounts() + (state.showDetails ? renderDetails() : '') + renderAlerts() +
      '<div class="db-main">' + renderList() + renderCard() + '</div>';
  }

  function skeleton() {
    return '<div class="db-main" aria-hidden="true"><div class="db-list"><div class="skeleton">' +
      '<div class="sk-row"><i></i><i></i><i></i></div><div class="sk-row"><i></i><i></i><i></i></div><div class="sk-row"><i></i><i></i><i></i></div>' +
      '</div></div><div class="db-card is-empty"></div></div>';
  }

  function renderError() {
    var e = state.error;
    if (e.kind === 'unknown') {
      return '<p class="db-note" role="status" data-cd-state="not-connected">The debtor work list is not connected yet: the server does not have the debt_worklist read. No debts are shown, and this is not a zero balance.</p>';
    }
    if (e.kind === 'contract') {
      return '<p class="db-alert" role="alert" data-cd-state="contract">The debtor work list could not be shown: ' + esc(e.message) + '. Nothing is shown rather than a partial book.</p>';
    }
    return '<p class="db-alert" role="alert" data-cd-state="failed">The open invoice book could not be read: ' + esc(e.message) + '. Nothing is shown rather than an empty book.</p>';
  }

  function nOf(c) { return c ? '<b>' + c.n + '</b> of ' + c.of : '<b>?</b>'; }

  function renderCounts() {
    var s = state.data.summary;
    var inv = s.invoices;
    var link = inv.link || {};
    var facts = inv.facts || {};
    var overdue = inv.overdue || {};
    var items = [
      '<span><b>' + inv.count + '</b> open invoices</span>',
      '<span><b>' + esc(money(inv.amount_due)) + '</b> due</span>',
      '<span>' + nOf(overdue) + ' overdue' + (overdue.amount_due != null ? ', <b>' + esc(money(overdue.amount_due)) + '</b>' : '') + '</span>',
      '<span>' + nOf(link.linked) + ' linked to a job</span>',
      '<span><b>' + ((link.none && link.none.n) || 0) + '</b> not linked</span>',
      '<span>' + nOf(facts.present) + ' with facts</span>',
      '<span><b>' + (s.debtors ? s.debtors.count : '?') + '</b> debtors</span>'
    ];
    if (link.unknown && link.unknown.n) items.push('<span class="is-bad"><b>' + link.unknown.n + '</b> link unknown</span>');
    if (inv.with_faults && inv.with_faults.n) items.push('<span class="is-bad">' + nOf(inv.with_faults) + ' with read faults</span>');
    if (inv.xero_stale && inv.xero_stale.n) items.push('<span class="is-bad">' + nOf(inv.xero_stale) + ' Xero stale</span>');
    return '<section class="db-counts" aria-label="Counts">' +
      '<p class="counts">' + items.join('<i aria-hidden="true">·</i>') + '</p>' +
      '<button type="button" class="detailsbtn" data-cd="details" aria-expanded="' + state.showDetails + '" aria-controls="cd-details">Details' + ICON.chevron + '</button>' +
      '</section>';
  }

  function renderDetails() {
    var d = state.data;
    var s = d.summary;
    var inv = s.invoices;
    var facts = inv.facts || {};
    var rec = d.reconciliation || {};
    var src = d.sources || {};
    function srcLine(name, v) {
      if (!v) return '<li>' + esc(name) + ': not reported</li>';
      if (v.ok === false) return '<li class="is-bad">' + esc(name) + ': could not be read (' + esc(v.error || 'no reason given') + ')</li>';
      if (v.read === false) return '<li>' + esc(name) + ': not read in this view</li>';
      return '<li>' + esc(name) + ': read' + (v.count != null ? ', ' + v.count + ' rows' : '') + '</li>';
    }
    var recLine = rec.exactly_once
      ? 'Every one of the ' + rec.book_invoice_ids + ' open invoices is shown exactly once.'
      : 'Invoice check failed: ' + (rec.not_shown || []).length + ' not shown, ' + (rec.shown_more_than_once || []).length + ' shown more than once.';
    return '<section class="db-details" id="cd-details" aria-label="Details">' +
      '<div class="dgrid">' +
      '<div><h3>What the counts count</h3><ul>' +
      '<li>Invoices: ' + esc(inv.denominator) + '.</li>' +
      '<li>Debtors: ' + esc(String(s.debtors.denominator).replace(/^debtors:\s*/i, '')) + '. ' + s.debtors.verified.n + ' confirmed contacts, ' + s.debtors.standing_alone.n + ' standing alone.</li>' +
      '<li>Facts: ' + facts.present.n + ' present, ' + facts.missing.n + ' missing, ' + facts.no_job.n + ' with no job to read, ' + facts.unknown.n + ' unknown (of ' + inv.count + ').</li>' +
      '<li>No due date: ' + inv.no_due_date.n + ' of ' + inv.count + '. Xero stale: ' + inv.xero_stale.n + ' of ' + inv.count + '. Read faults: ' + inv.with_faults.n + ' of ' + inv.count + '.</li>' +
      '<li class="' + (rec.exactly_once ? '' : 'is-bad') + '">' + esc(recLine) + '</li>' +
      '</ul></div>' +
      '<div><h3>What was read</h3><ul>' +
      srcLine('Open invoice book', src.invoices) + srcLine('Invoice context', src.context) + srcLine('Linked jobs', src.jobs) + srcLine('Debt desk notes', src.notes) + srcLine('Invoice events', src.xero_events) +
      '<li>Messages are ' + esc(STORED_NOTE) + '.</li>' +
      '</ul></div>' +
      '<div><h3>Not in this read yet</h3><ul>' +
      '<li>Promised payment dates, so there is no promise-date filter.</li>' +
      '<li>A ready-for-Captain verdict, so no row is marked ready.</li>' +
      (factsListedAnywhere(d) ? '' : '<li>What the captured facts say (only whether they exist).</li>') +
      '<li>Sent emails: Outlook Sent Items are not captured, so stored emails are inbound only.</li>' +
      '<li>Links to each message in GHL or Outlook.</li>' +
      '<li>The phone line, mailbox, subject and attachment a draft would use.</li>' +
      '</ul></div>' +
      ((d.warnings || []).length ? '<div><h3>Warnings from the read</h3><ul>' + d.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') +
      '</div></section>';
  }
  function factsListedAnywhere(data) {
    return (data.debtors || []).some(function (x) { return x.sources && x.sources.facts && x.sources.facts.timeline_read === 'read'; });
  }
  var STORED_NOTE = 'stored copies, not a live GHL or Outlook read';

  function renderAlerts() {
    var d = state.data;
    var out = '';
    var faults = d.faults || [];
    if (faults.length) {
      out += '<div class="db-alert" role="alert"><p>Parts of the read failed. What they touch is marked unknown below.</p><ul>' +
        faults.map(function (f) { return '<li>' + esc(words(f.source)) + ': ' + esc(f.detail) + '</li>'; }).join('') + '</ul></div>';
    }
    var rec = d.reconciliation || {};
    if (rec.exactly_once === false) {
      out += '<p class="db-alert" role="alert">The book and this list disagree: ' + (rec.not_shown || []).length + ' invoices are not shown and ' + (rec.shown_more_than_once || []).length + ' are shown more than once.</p>';
    }
    return out;
  }

  function renderList() {
    return '<section class="db-list" aria-label="Debtors">' +
      '<label class="search">' + ICON.search + '<span class="sr">Search debtors</span>' +
      '<input type="search" data-cd="search" placeholder="Search name, invoice or job" value="' + esc(state.search) + '" autocomplete="off"></label>' +
      renderFilters() +
      '<div id="cd-list-body">' + renderListBody() + '</div>' +
      '</section>';
  }

  function renderFilters() {
    var all = debtors();
    var opts = FILTERS.map(function (f) {
      var n = all.filter(f.test).length;
      return '<option value="' + f.key + '"' + (state.filter === f.key ? ' selected' : '') + '>' + esc(f.label) + ' (' + n + ')</option>';
    }).join('');
    var owners = ownersOf(all);
    var ownerOpts = '<option value="">Any owner</option>' + owners.map(function (o) {
      return '<option value="' + esc(o.owner) + '"' + (state.owner === o.owner ? ' selected' : '') + '>' + esc(o.owner) + ' (' + o.debtors + ')</option>';
    }).join('');
    return '<div class="filters">' +
      '<label><span>Show</span><select data-cd="filter">' + opts + '</select></label>' +
      '<label><span>Owner</span><select data-cd="owner">' + ownerOpts + '</select></label>' +
      '</div>';
  }

  function renderListBody() {
    var all = debtors();
    var list = visibleDebtors();
    var narrowed = state.filter !== 'all' || state.owner || String(state.search).trim();
    var head = '<div class="grouphead"><span>Debtors</span><span class="count" data-cd-count>' + list.length + (narrowed ? ' of ' + all.length : '') + '</span>' +
      (narrowed ? '<button type="button" class="linklike clear" data-cd="clear">Show all</button>' : '') + '</div>';
    if (!all.length) {
      return head + '<p class="empty">The read returned no open debtors. The book above says ' + state.data.summary.invoices.count + ' open invoices.</p>';
    }
    if (!list.length) return head + '<p class="empty">No debtor matches. Counts above are for the whole book.</p>';
    return head + '<ul class="leads">' + list.map(renderLead).join('') + '</ul>';
  }

  function renderLead(d) {
    var on = d.key === state.selectedKey;
    var tags = [];
    if (anyInvoice(d, hasPendingDraft)) tags.push('<span class="pill accent">Draft waiting</span>');
    if (d.identity.status !== 'verified') tags.push('<span class="pill">Contact not confirmed</span>');
    var notLinked = (d.link_state.none || 0) + (d.link_state.ambiguous || 0) + (d.link_state.unknown || 0);
    if (notLinked) tags.push('<span class="pill">' + (notLinked === d.invoice_count ? 'Not linked to a job' : notLinked + ' of ' + d.invoice_count + ' not linked') + '</span>');
    if ((d.faults || []).length) tags.push('<span class="pill bad">Source unreadable</span>');
    if (!d.freshness.xero_fresh) tags.push('<span class="pill bad">Xero stale</span>');
    var age = d.max_days_overdue > 0 ? plural(d.max_days_overdue, 'day') + ' overdue' : (d.oldest_due_date ? 'not yet due' : 'no due date');
    var next = d.next_step
      ? esc(d.next_step.action) + ' <span class="muted">(' + esc(d.next_step.from_invoice_number || 'invoice') + (d.next_step.owner ? ', ' + esc(d.next_step.owner) : '') + ')</span>'
      : '<span class="muted">No next step recorded</span>';
    return '<li><button type="button" class="lead' + (on ? ' is-on' : '') + '" data-cd="debtor" data-key="' + esc(d.key) + '" aria-current="' + (on ? 'true' : 'false') + '">' +
      '<span class="lead-top"><span class="lead-name">' + esc(debtorName(d)) + '</span><span class="lead-amt">' + esc(money(d.total_due)) + '</span></span>' +
      '<span class="lead-place">' + plural(d.invoice_count, 'invoice') + ' · ' + esc(age) + '</span>' +
      '<span class="lead-words">' + next + '</span>' +
      (tags.length ? '<span class="lead-tags">' + tags.join('') + '</span>' : '') +
      '</button></li>';
  }

  function renderCard() {
    var d = currentDebtor();
    if (!d) {
      return '<section class="db-card is-empty" aria-label="Debtor"><div class="emptycard"><h2>Pick a debtor</h2>' +
        '<p>Their invoices, every stored text, email, note, call and Xero event, and a draft for one invoice appear here.</p></div></section>';
    }
    return '<section class="db-card" aria-label="' + esc(debtorName(d)) + '">' +
      '<button type="button" class="back" data-cd="back">' + ICON.back + 'All debtors</button>' +
      renderCardHead(d) +
      renderInvoices(d) +
      renderTimeline(d) +
      renderComposer(d) +
      '</section>';
  }

  function renderCardHead(d) {
    var id = d.identity;
    var badges = [];
    badges.push(id.status === 'verified'
      ? '<span class="badge ok">Xero contact confirmed</span>'
      : '<span class="badge warn">Contact not confirmed</span>');
    var ls = d.link_state;
    badges.push('<span class="badge' + (ls.linked === d.invoice_count ? ' ok' : '') + '">' + ls.linked + ' of ' + d.invoice_count + ' linked to a job</span>');
    var fr = d.freshness;
    var xeroAge = fr.xero_oldest_synced_at ? ageBetween(fr.xero_oldest_synced_at, fr.as_of) : null;
    badges.push(fr.xero_fresh
      ? '<span class="badge ok">Xero synced ' + esc(xeroAge || 'recently') + ' before this read</span>'
      : '<span class="badge bad">Xero stale' + (xeroAge ? ', oldest sync ' + esc(xeroAge) + ' old' : '') + '</span>');
    var facts = d.sources.facts;
    badges.push('<span class="badge">' + factsWords(facts) + '</span>');
    var s = d.sources || {};
    ['ghl', 'email', 'notes'].forEach(function (k) {
      var st = s[k] && s[k].status;
      var name = { ghl: 'GHL texts', email: 'Emails', notes: 'Notes' }[k];
      if (st === 'unreadable') badges.push('<span class="badge bad">' + name + ' could not be read</span>');
      else if (/stale|fail/.test(String(st || ''))) badges.push('<span class="badge bad">' + name + ' capture ' + esc(words(st)) + '</span>');
    });
    if (s.ghl && (s.ghl.status === 'bound' || s.ghl.status === 'several') && s.ghl.last_success_at) {
      badges.push('<span class="badge">GHL captured ' + esc(ageBetween(s.ghl.last_success_at, fr.as_of) || 'recently') + ' before this read</span>');
    }
    var names = id.name_variants ? '<p class="fine">Also written as ' + id.names.filter(function (n) { return n !== id.name; }).map(esc).join(', ') + ' on the same Xero contact.</p>' : '';
    var detail = id.detail ? '<p class="fine warn-text">' + esc(id.detail) + '.</p>' : '';
    var faults = (d.faults || []).length
      ? '<div class="db-alert"><p>Some sources for this debtor could not be read:</p><ul>' + d.faults.map(function (f) { return '<li>' + esc(words(f.source)) + ': ' + esc(f.detail) + '</li>'; }).join('') + '</ul></div>'
      : '';
    var next = d.next_step
      ? '<p class="nextstep"><span>Next step</span> ' + esc(d.next_step.action) + ' on ' + esc(d.next_step.from_invoice_number || 'one invoice') +
        (d.next_step.owner ? ', ' + esc(d.next_step.owner) : '') + (d.next_step.at ? ', by ' + esc(dayLabel(d.next_step.at)) : '') + '.</p>'
      : '<p class="nextstep is-quiet"><span>Next step</span> None recorded on any of these invoices.</p>';
    var last = d.last_contact && d.last_contact.last;
    var lastLine;
    if (last) {
      lastLine = 'Last contact in the stored copies: ' + esc(whenLabel(last.at)) + ', ' + esc(last.channel === 'call' ? 'a call' : (last.channel === 'email' ? 'an email' : 'a text')) + ' ' + (last.direction === 'inbound' ? 'from them' : 'from us') + ' (' + esc(providerLabel(last.provider)) + ').';
    } else {
      var lim = timelineLimits(d, 'contact');
      lastLine = lim.length
        ? 'Last contact unknown: ' + esc(lim.map(function (l) { return l.short; }).join('; ')) + '.'
        : esc(absenceLine(d, 'contact', 'text, email or call'));
    }
    return '<header class="cardhead">' +
      '<h2>' + esc(debtorName(d)) + '</h2>' +
      '<p class="figures"><b>' + esc(money(d.total_due)) + '</b> due on ' + plural(d.invoice_count, 'invoice') +
      (d.overdue_count ? ' · <b>' + esc(money(d.overdue_amount)) + '</b> overdue' : ' · none overdue') +
      (d.max_days_overdue > 0 ? ' · oldest ' + plural(d.max_days_overdue, 'day') : '') + '</p>' +
      '<p class="fine">' + lastLine + '</p>' +
      names + detail +
      '<div class="badges">' + badges.join('') + '</div>' +
      next + faults +
      '</header>';
  }

  function factsWords(f) {
    if (!f) return 'Facts not reported';
    if (f.status === 'present') return 'Facts captured on every linked invoice';
    if (f.status === 'partial') return 'Facts on ' + f.invoices_with_facts + ' of ' + f.of_invoices + ' invoices';
    if (f.status === 'missing') return 'No facts captured yet';
    if (f.status === 'no_job') return 'No job, so no facts to read';
    if (f.status === 'unreadable') return 'Facts could not be read';
    return 'Facts unknown';
  }

  var CLASS_LABEL = { genuine_debt: 'Genuine debt', blocked_by_us: 'Blocked by us', in_dispute: 'In dispute', bad_debt: 'Bad debt', not_owed: 'Not owed', unclassified: 'Not yet classified' };
  var BLOCKER_LABEL = { rectification: 'rectification not done', no_job_linked: 'no job linked', job_link_ambiguous: 'more than one job matches', invoice_wrong: 'invoice or contact wrong', pack_missing: 'report or PO pack missing', paid_unallocated: 'paid, awaiting allocation in Xero', payment_claimed: 'client says paid, bank check pending', context_pending: 'context pending' };

  function renderInvoices(d) {
    var picked = state.invoiceId && findInvoice(d, state.invoiceId);
    var rows = d.invoices.map(function (inv) {
      var id = inv.xero_invoice_id;
      var on = id === state.invoiceId;
      var due = inv.due_date
        ? (inv.overdue ? plural(inv.days_overdue, 'day') + ' overdue' : 'due ' + dayLabel(inv.due_date))
        : 'no due date';
      var link = inv.link.status === 'linked' ? 'Job ' + esc(inv.link.job_number || 'number not in the read')
        : inv.link.status === 'ambiguous' ? 'More than one job matches'
        : inv.link.status === 'unknown' ? '<span class="bad-text">Job link unknown</span>'
        : 'No job linked';
      var cls = classOf(inv);
      var clsWords = cls ? (CLASS_LABEL[cls] || words(cls)) + (blockerOf(inv) ? ', ' + (BLOCKER_LABEL[blockerOf(inv)] || words(blockerOf(inv))) : '') : 'Not yet classified';
      var tags = [];
      if (hasPendingDraft(inv)) tags.push('<span class="pill accent">Draft waiting</span>');
      if (inv.status === 'SUBMITTED') tags.push('<span class="pill">Submitted, not yet approved in Xero</span>');
      if (!inv.xero.fresh) tags.push('<span class="pill bad">Xero stale</span>');
      (inv.faults || []).forEach(function (f) { tags.push('<span class="pill bad">' + esc(f.detail) + '</span>'); });
      return '<li><label class="inv' + (on ? ' is-on' : '') + '">' +
        '<input type="radio" name="cd-invoice" data-cd="invoice" value="' + esc(id) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="inv-main">' +
        '<span class="inv-top"><span class="inv-no">' + esc(inv.invoice_number || 'No invoice number') + '</span><span class="inv-amt">' + esc(money(inv.amount_due)) + '</span></span>' +
        '<span class="inv-meta">' + esc(due) + ' · ' + link + (inv.reference ? ' · ' + esc(inv.reference) : '') + '</span>' +
        '<span class="inv-meta">' + esc(clsWords) + (inv.next_step.owner ? ' · ' + esc(inv.next_step.owner) : '') + (inv.amount_paid ? ' · ' + esc(money(inv.amount_paid)) + ' paid of ' + esc(money(inv.total)) : '') + '</span>' +
        (tags.length ? '<span class="lead-tags">' + tags.join('') + '</span>' : '') +
        '</span></label></li>';
    }).join('');
    return '<section class="block" aria-labelledby="cd-inv-h">' +
      '<h3 id="cd-inv-h">' + ICON.receipt + 'Open invoices<span class="count">' + d.invoice_count + '</span></h3>' +
      '<p class="fine" id="cd-inv-hint">' + (picked ? 'The draft below is about ' + esc(picked.invoice_number || 'this invoice') + ' only.' : 'Pick the invoice a message is about. Nothing is picked until you choose.') + '</p>' +
      '<ul class="invoices" role="radiogroup" aria-labelledby="cd-inv-h" aria-describedby="cd-inv-hint">' + rows + '</ul>' +
      '</section>';
  }

  function renderTimeline(d) {
    var tl = d.timeline;
    var head = '<h3 id="cd-tl-h">' + ICON.stream + 'Timeline</h3>';
    if (!tl) {
      return '<section class="block" aria-labelledby="cd-tl-h">' + head +
        '<p class="thread-note is-bad">The timeline was not part of this read, so no texts, emails, notes or calls are shown. This does not mean there were none.</p></section>';
    }
    var counts = chipCounts(d);
    var chips = TL_CHIPS.map(function (c) {
      // Facts the read did not list get no number: a zero would read as "none".
      var n = c.key === 'facts' && !counts.factsListed ? null : counts[c.key];
      return '<button type="button" class="chip" data-cd="tl" data-tl="' + c.key + '" aria-pressed="' + (state.tlFilter === c.key) + '">' + esc(c.label) + (n == null ? '' : '<span class="count">' + n + '</span>') + '</button>';
    }).join('');
    var status = timelineStatus(d);
    var list = timelineEntries(d);
    var body;
    if (!list.length) {
      var which = state.tlFilter === 'all' ? 'entries' : TL_CHIPS.filter(function (c) { return c.key === state.tlFilter; })[0].label.toLowerCase();
      var none = absenceLine(d, state.tlFilter, which);
      body = none ? '<p class="thread-note">' + esc(none) + '</p>' : '';
    } else {
      body = '<ol class="thread">' + list.map(function (e) { return renderEntry(d, e); }).join('') + '</ol>';
    }
    return '<section class="block" aria-labelledby="cd-tl-h">' + head +
      '<div class="chips" role="group" aria-label="Show in the timeline">' + chips + '</div>' +
      status +
      '<div id="cd-tl-body">' + body + '</div></section>';
  }

  function timelineStatus(d) {
    var tl = d.timeline;
    var lines = ['Newest first.'];
    if (tl.duplicates_merged) lines.push(plural(tl.duplicates_merged, 'copy', 'copies') + ' of the same message shown once.');
    lines.push('These are ' + STORED_NOTE + '.');
    var limits = timelineLimits(d, state.tlFilter);
    return '<p class="tl-status fine">' + esc(lines.join(' ')) + '</p>' +
      (limits.length ? '<ul class="limits" data-cd-limits>' + limits.map(function (l) { return '<li' + (l.bad ? ' class="is-bad"' : '') + '>' + esc(l.text) + '</li>'; }).join('') + '</ul>' : '');
  }

  function factValue(v) {
    if (v == null) return 'value not in the read';
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && typeof v.text === 'string') return v.text;
    try { return JSON.stringify(v); } catch (err) { return String(v); }
  }
  function renderFactEntry(d, e) {
    var f = e.fact || {};
    var scope = (e.invoice_ids || []).map(function (id) { return invoiceNumber(d, id); });
    var mine = state.invoiceId && (e.invoice_ids || []).indexOf(state.invoiceId) >= 0;
    var at = f.captured_at || e.at;
    var what = f.kind || e.subject;
    var st = f.state === 'current' ? '<span class="pill ok">Current</span>'
      : f.state === 'stale' ? '<span class="pill bad">Stale</span>'
      : '<span class="pill">Current or stale not stated</span>';
    return '<li class="tl is-fact' + (mine ? ' is-scope' : '') + '" data-group="facts">' +
      '<div class="tl-meta"><span class="src src-' + esc(e.provider || 'unknown') + '">' + esc(providerLabel(e.provider)) + '</span>' +
      '<span class="tl-kind">Captured fact' + (what ? ': ' + esc(words(what)) : '') + '</span>' +
      '<time datetime="' + esc(at || '') + '">' + (at ? 'captured ' + esc(whenLabel(at, e.at_precision)) : 'capture time not in the read') + '</time></div>' +
      '<div class="tl-body">' + esc(factValue(Object.prototype.hasOwnProperty.call(f, 'value') ? f.value : e.preview)) + '</div>' +
      '<div class="tl-foot">' + st + ' ' + esc(sourceLabel(e.source)) +
      (f.source_id || e.source_ref ? ' · source ' + esc(f.source_id || e.source_ref) : '') +
      (e.job_id ? ' · Job ' + esc(jobNumberFor(d, e.job_id) || 'record') : '') +
      (scope.length ? ' (' + esc(scope.join(', ')) + ')' : '') + '</div></li>';
  }

  function renderEntry(d, e) {
    if (isFactEntry(e)) return renderFactEntry(d, e);
    var dir = e.direction === 'inbound' ? 'is-in' : e.direction === 'outbound' ? 'is-out' : e.direction === 'system' ? 'is-sys' : 'is-note';
    var mine = state.invoiceId && (e.invoice_ids || []).indexOf(state.invoiceId) >= 0;
    var scope = (e.invoice_ids || []).map(function (id) { return invoiceNumber(d, id); });
    var scopeWords = e.invoice_scope === 'job'
      ? 'Job ' + (jobNumberFor(d, e.job_id) || 'record') + (scope.length ? ' (' + scope.join(', ') + ')' : '')
      : e.invoice_scope === 'debtor'
      ? 'Whole account' + (scope.length ? ' (' + scope.join(', ') + ')' : '')
      : scope.join(', ');
    var also = (e.seen_in || []).filter(function (s) { return s !== e.source; });
    var author = e.author ? esc(e.author) + ' · ' : '';
    return '<li class="tl ' + dir + (mine ? ' is-scope' : '') + '" data-group="' + entryGroup(e) + '">' +
      '<div class="tl-meta"><span class="src src-' + esc(e.provider || 'unknown') + '">' + esc(providerLabel(e.provider)) + '</span>' +
      '<span class="tl-kind">' + esc((kindLabel(e) + ' ' + directionWord(e)).trim()) + '</span>' +
      '<time datetime="' + esc(e.at || '') + '">' + esc(whenLabel(e.at, e.at_precision)) + '</time></div>' +
      (e.subject && e.kind !== 'invoice_event' ? '<div class="tl-subject">' + esc(e.subject) + '</div>' : '') +
      '<div class="tl-body">' + esc(e.preview || '') + '</div>' +
      '<div class="tl-foot">' + author +
      (isRecord(e) ? '' : '<span class="prev">' + (previewCut(e) ? 'Preview, cut at 500 characters' : 'Preview') + '</span> · ') +
      esc(sourceLabel(e.source)) + (also.length ? ', also in ' + esc(also.map(sourceLabel).join(', ')) : '') +
      (scopeWords ? ' · ' + esc(scopeWords) : '') + (e.label ? ' · ' + esc(e.label) : '') +
      '</div></li>';
  }
  function jobNumberFor(d, jobId) {
    if (!jobId) return null;
    for (var i = 0; i < d.invoices.length; i++) if (d.invoices[i].link && d.invoices[i].link.job_id === jobId) return d.invoices[i].link.job_number;
    return null;
  }

  function renderComposer(d) {
    var head = '<h3 id="cd-draft-h">' + ICON.pen + 'Draft</h3>';
    var m = state.invoiceId ? composerModel(d, state.invoiceId, state.channel, state.drafts) : null;
    if (!m) {
      return '<section class="compose" aria-labelledby="cd-draft-h">' + head +
        '<p class="thread-note">Pick an invoice above to draft a message about it. A draft is always about one invoice you chose.</p>' +
        '</section>';
    }
    var inv = m.invoice;
    var seg = CHANNELS.map(function (c) {
      return '<button type="button" data-cd="channel" data-channel="' + c.key + '" aria-pressed="' + (m.channel === c.key) + '">' + c.label + '</button>';
    }).join('');
    var p = m.proposal;
    var proposalLine = '';
    if (p) {
      var pc = proposalChannel(p);
      var pWhat = (pc === 'email' ? 'an email' : pc === 'text' ? 'a text' : 'a ' + words(p.kind || 'message'));
      if (p.status === 'pending') {
        proposalLine = m.proposalFits
          ? '<p class="fine">The desk drafted ' + pWhat + ' for this invoice' + (p.at ? ' on ' + esc(whenLabel(p.at)) : '') + '. It is shown below exactly as drafted.</p>'
          : '<p class="fine">The desk drafted ' + pWhat + ' for this invoice. Switch to ' + (pc === 'email' ? 'Email' : 'Text') + ' to see it.</p>';
      } else {
        proposalLine = '<p class="fine">An earlier draft is ' + esc(words(p.status)) + (p.at ? ' (' + esc(whenLabel(p.at)) + ')' : '') + ', so it is not loaded here.</p>';
      }
    }
    var fresh = inv.xero.synced_at ? 'Xero synced ' + (ageBetween(inv.xero.synced_at, state.data.as_of) || 'recently') + ' before this read' + (inv.xero.fresh ? '' : ', and that is stale') : 'Xero sync time not in the read';
    var scopeLine = '<p class="route">About <b>' + esc(inv.invoice_number || 'this invoice') + '</b> only: <b>' + esc(money(inv.amount_due)) + '</b> due' +
      (inv.overdue ? ', ' + plural(inv.days_overdue, 'day') + ' overdue' : '') + '. ' + esc(fresh) + '.</p>';
    var route = m.channel === 'note'
      ? '<p class="route">A note would sit on ' + esc(inv.invoice_number || 'this invoice') + '’s record for whoever opens it next.</p>'
      : '<p class="route" data-cd-route>' + (m.channel === 'email' ? 'Email to ' : 'Text to ') + (m.to ? '<b>' + esc(m.to) + '</b>' : '<span class="missing-word">recipient not in this read</span>') + '</p>';
    var missing = m.missing.length
      ? '<p class="missing" data-cd-missing>Not in this read yet: ' + esc(m.missing.join(', ')) + '.</p>'
      : '';
    var label = m.channel === 'email' ? 'Email body' : m.channel === 'note' ? 'Note' : 'Text';
    var btn = m.channel === 'note' ? 'Save note' : 'Approve and send';
    var why = m.channel === 'note'
      ? 'Saving notes from this screen arrives with the later approval step. Nothing is saved.'
      : 'Sending arrives with a later approval step. Nothing is sent, saved or approved from this screen.';
    return '<section class="compose" aria-labelledby="cd-draft-h">' + head +
      '<div class="seg" role="group" aria-label="Channel">' + seg + '</div>' +
      proposalLine + scopeLine + route +
      '<label class="sr" for="cd-draft">' + label + '</label>' +
      '<textarea id="cd-draft" data-cd="draft" rows="5" placeholder="' + (m.channel === 'note' ? 'For whoever opens this next' : 'Write the ' + (m.channel === 'email' ? 'email' : 'text') + ' here') + '">' + esc(m.body) + '</textarea>' +
      '<div id="cd-draft-foot">' + draftFoot(m) + '</div>' +
      missing +
      '<div class="actions"><button type="button" class="primary" disabled aria-describedby="cd-why">' + ICON.lock + btn + '</button></div>' +
      '<p class="why" id="cd-why">' + why + '</p>' +
      '</section>';
  }

  function draftFoot(m) {
    var len = String(m.body || '').length;
    var bits = [];
    bits.push(len + ' characters');
    if (m.edited) bits.push('<span class="edited">Edited here. Your changes stay in this tab and are not saved.</span>');
    if (m.edited && m.proposalFits) bits.push('<button type="button" class="linklike" data-cd="revert">Use the drafted words</button>');
    return '<p class="draftfoot fine">' + bits.join(' · ') + '</p>';
  }

  // ── events ──────────────────────────────────────────────────
  function scrollCardIntoView() {
    var root = rootEl();
    var card = root && root.querySelector('.db-card');
    if (!card || typeof global.matchMedia !== 'function') return;
    if (global.matchMedia('(max-width: 899px)').matches && card.scrollIntoView) card.scrollIntoView({ block: 'start' });
  }

  function onClick(ev) {
    var t = ev.target.closest ? ev.target.closest('[data-cd]') : null;
    if (!t || !rootEl().contains(t)) return;
    var act = t.getAttribute('data-cd');
    if (act === 'refresh') { load(); return; }
    if (act === 'details') { state.showDetails = !state.showDetails; render(); return; }
    if (act === 'clear') { state.filter = 'all'; state.owner = ''; state.search = ''; render(); return; }
    if (act === 'debtor') {
      var key = t.getAttribute('data-key');
      if (key !== state.selectedKey) {
        clearSelection();
        state.selectedKey = key;
      }
      render();
      scrollCardIntoView();
      return;
    }
    if (act === 'back') {
      var was = state.selectedKey;
      clearSelection();
      render();
      var row = was && rootEl().querySelector('.lead[data-key="' + cssEscape(was) + '"]');
      if (row) { if (row.scrollIntoView) row.scrollIntoView({ block: 'center' }); row.focus(); }
      return;
    }
    if (act === 'tl') { state.tlFilter = t.getAttribute('data-tl'); render(); focusSel('[data-cd="tl"][data-tl="' + state.tlFilter + '"]'); return; }
    if (act === 'channel') { state.channel = t.getAttribute('data-channel'); render(); focusSel('[data-cd="channel"][data-channel="' + state.channel + '"]'); return; }
    if (act === 'revert') {
      var d = currentDebtor();
      var m = composerModel(d, state.invoiceId, state.channel, state.drafts);
      if (m) delete state.drafts[draftKey(state.invoiceId, m.channel)];
      render();
      focusSel('#cd-draft');
    }
  }

  function onChange(ev) {
    var t = ev.target;
    var act = t && t.getAttribute && t.getAttribute('data-cd');
    if (!act) return;
    if (act === 'filter') { state.filter = t.value; repaintList(); return; }
    if (act === 'owner') { state.owner = t.value; repaintList(); return; }
    if (act === 'invoice') {
      if (state.invoiceId !== t.value) { state.invoiceId = t.value; state.channel = null; }
      render();
      focusSel('input[data-cd="invoice"][value="' + cssEscape(state.invoiceId) + '"]');
      return;
    }
  }

  function onInput(ev) {
    var t = ev.target;
    var act = t && t.getAttribute && t.getAttribute('data-cd');
    if (act === 'search') { state.search = t.value; repaintListBody(); return; }
    if (act === 'draft') {
      var d = currentDebtor();
      var m = composerModel(d, state.invoiceId, state.channel, state.drafts);
      if (!m) return;
      state.drafts[draftKey(state.invoiceId, m.channel)] = t.value;
      var foot = rootEl().querySelector('#cd-draft-foot');
      if (foot) foot.innerHTML = draftFoot(composerModel(d, state.invoiceId, state.channel, state.drafts));
    }
  }

  // Search and filter repaint only the list so the search box keeps its caret.
  function repaintListBody() {
    var body = rootEl() && rootEl().querySelector('#cd-list-body');
    if (body) body.innerHTML = renderListBody();
  }
  function repaintList() {
    var list = rootEl() && rootEl().querySelector('.db-list');
    var active = global.document.activeElement;
    var sel = active && active.getAttribute && active.getAttribute('data-cd');
    if (!list) { render(); return; }
    list.outerHTML = renderList();
    if (sel) focusSel('[data-cd="' + sel + '"]');
  }
  function focusSel(sel) {
    var el = rootEl() && rootEl().querySelector(sel);
    if (el && el.focus) el.focus({ preventScroll: true });
  }
  function cssEscape(s) {
    if (global.CSS && global.CSS.escape) return global.CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  var bound = false;
  function bind() {
    var root = rootEl();
    if (!root || bound) return;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    bound = true;
  }

  // Financials > Clear Debt calls this (modules/ops-financials.js showSubTab).
  function loadClearDebt() {
    bind();
    return load();
  }

  var api = {
    CONTRACT: CONTRACT,
    FILTERS: FILTERS,
    TL_CHIPS: TL_CHIPS,
    state: state,
    load: loadClearDebt,
    render: render,
    checkContract: checkContract,
    isUnknownAction: isUnknownAction,
    matchesSearch: matchesSearch,
    visibleDebtors: visibleDebtors,
    ownersOf: ownersOf,
    entryGroup: entryGroup,
    timelineEntries: timelineEntries,
    chipCounts: chipCounts,
    timelineLimits: timelineLimits,
    absenceLine: absenceLine,
    staleOrUnreadable: staleOrUnreadable,
    isFactEntry: isFactEntry,
    composerModel: composerModel,
    providerLabel: providerLabel,
    sourceLabel: sourceLabel,
    whenLabel: whenLabel,
    money: money
  };
  global.ClearDebt = api;
  global.loadClearDebt = loadClearDebt;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
