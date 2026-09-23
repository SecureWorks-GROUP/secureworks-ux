/* Synthetic debt_worklist (debt-worklist/v1) response for the Clear Debt screen.
 *
 * Shape only: no customer names, addresses, phone numbers, emails, real ids or
 * message text. Debtors are "Debtor 001"..., ids are made-up UUIDs, phone
 * numbers come from the ACMA fictional range (0491 570 xxx), email addresses
 * use the reserved example.invalid domain and every message is a generic
 * placeholder sentence.
 *
 * It keeps the live book's 24 Sep 2026 shape so the screen is tested against
 * the real proportions: 101 open invoices, $122,209.52 due, 77 overdue,
 * 90 linked to a job, 11 not linked, 0 ambiguous, 21 with captured facts,
 * every Xero row fresh, one invoice whose contact could not be confirmed.
 *
 * Also carries the awkward cases the screen has to be honest about: debtors
 * with several invoices, two different contacts that share a display name,
 * one contact whose invoices carry two name spellings, a debtor whose stored
 * GHL copies could not be read, a truncated timeline that hit the per-job cap,
 * a preview cut at 500 characters and a message seen by two sources.
 *
 * The response is built by code so the totals stay exact; the summary is
 * computed the way the backend read model computes it
 * (secureworks-backend supabase/functions/ops-api/debt_worklist_read_model.ts).
 */
(function (root) {
  'use strict';

  var AS_OF = '2026-09-24T02:00:00.000Z';
  var TODAY = AS_OF.slice(0, 10);
  var TARGET_CENTS = 12220952;
  var STORED_COPIES_NOTE = 'stored copies only (GHL cache, inbox and business events); not a live GHL or Outlook read, and Outlook Sent Items are not captured';
  var POPULATION_DENOMINATOR = 'open receivables: Xero ACCREC invoices with status AUTHORISED or SUBMITTED and amount due above zero';
  var DEBTOR_DENOMINATOR = 'debtors: one per verified Xero contact; an invoice whose contact cannot be verified stands alone';
  var PHONES = ['0491 570 006', '0491 570 156', '0491 570 157', '0491 570 158', '0491 570 159', '0491 570 110', '0491 570 313', '0491 570 737', '0491 571 266', '0491 571 491', '0491 571 804', '0491 572 549', '0491 572 665'];

  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function uuid(prefix, n) { return prefix + '0000000-0000-4000-8000-' + pad(n, 12); }
  function addDays(iso, days) {
    var d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function hoursBefore(h) { return new Date(Date.parse(AS_OF) - h * 3600000).toISOString(); }
  function money(n) { return Math.round(n * 100) / 100; }

  // Debtor plan: invoice counts per debtor. 15 multi-invoice debtors (38
  // invoices) then 63 single-invoice debtors = 101 invoices, 78 debtors.
  function plan() {
    var sizes = [5, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
    while (sizes.reduce(function (a, b) { return a + b; }, 0) < 101) sizes.push(1);
    return sizes;
  }

  function amountsCents() {
    var raw = [];
    for (var i = 0; i < 101; i++) raw.push(20000 + ((i * 7919) % 180000));
    var sum = raw.reduce(function (a, b) { return a + b; }, 0);
    var diff = TARGET_CENTS - sum;
    var each = Math.trunc(diff / 101);
    for (var j = 0; j < 101; j++) raw[j] += each;
    raw[100] += TARGET_CENTS - raw.reduce(function (a, b) { return a + b; }, 0);
    return raw;
  }

  var CLASSES = [
    { class: 'genuine_debt', blocker: null, owner: 'DEBT', action: 'Text a reminder about the balance' },
    { class: 'genuine_debt', blocker: null, owner: 'DEBT', action: 'Call about the overdue balance' },
    { class: 'genuine_debt', blocker: null, owner: 'DEBT', action: 'Email the invoice again' },
    { class: 'blocked_by_us', blocker: 'rectification', owner: 'OPERATIONS', action: 'Confirm the rectification visit is finished' },
    { class: 'genuine_debt', blocker: null, owner: 'DEBT', action: 'Text a reminder about the balance' },
    { class: 'blocked_by_us', blocker: 'paid_unallocated', owner: 'BOOKKEEPING', action: 'Match the bank deposit to this invoice in Xero' },
    { class: 'in_dispute', blocker: null, owner: 'INSURANCE', action: 'Answer the query about the work order' },
    { class: 'genuine_debt', blocker: null, owner: 'DEBT', action: 'Call about the overdue balance' },
    { class: 'not_owed', blocker: null, owner: 'MARNIN', action: 'Decide whether to void the residual' },
    { class: null, blocker: null, owner: null, action: null }
  ];

  function build() {
    var sizes = plan();
    var cents = amountsCents();
    var invoices = [];
    var n = 0;
    var jobSeq = 0;
    // Invoice-level choices, by global invoice index 0..100.
    var notOverdue = {};
    for (var k = 0; k < 101; k++) if (k % 4 === 3 && Object.keys(notOverdue).length < 24) notOverdue[k] = true;
    // 11 not linked: one on the 3-invoice Debtor 003, ten single-invoice debtors
    // (including the one whose contact is not confirmed).
    var unlinked = { 11: true };
    [40, 44, 48, 52, 56, 60, 64, 68, 72, 99].forEach(function (i) { unlinked[i] = true; });
    var conflictIndex = 99;
    var factsLeft = 21;

    sizes.forEach(function (size, d) {
      var debtorNo = d + 1;
      var contactId = uuid('c', debtorNo);
      var baseName = 'Debtor ' + pad(debtorNo, 3);
      // Debtor 021 is a different verified contact that shares Debtor 020's display name.
      if (debtorNo === 21) baseName = 'Debtor 020';
      var job = null;
      for (var s = 0; s < size; s++) {
        var i = n++;
        var amount = cents[i] / 100;
        var paidPart = i % 9 === 4 ? Math.round(cents[i] * 0.3) / 100 : 0;
        var overdue = !notOverdue[i];
        var days = overdue ? 3 + ((i * 37) % 180) : -((i * 5) % 28);
        var noDue = i === 7;
        var due = noDue ? null : addDays(TODAY, -days);
        var invDate = addDays(due || TODAY, -14);
        if (invDate > addDays(TODAY, -3)) invDate = addDays(TODAY, -3 - (i % 5));
        var linked = !unlinked[i];
        if (linked && (!job || s % 2 === 0)) {
          jobSeq += 1;
          job = { id: uuid('a', jobSeq), number: 'SWF-9' + pad(jobSeq, 4) };
        }
        var cls = CLASSES[i % CLASSES.length];
        if (!overdue && cls.class === 'genuine_debt') cls = { class: 'genuine_debt', blocker: null, owner: 'DEBT', action: 'Wait for the due date' };
        var facts = !linked ? 'no_job' : (factsLeft > 0 && i % 4 !== 1 ? (factsLeft--, 'present') : 'missing');
        var number = 'INV-S' + pad(1001 + i, 4);
        var name = baseName;
        // Debtor 001's invoices carry two spellings of one confirmed contact.
        if (debtorNo === 1 && s % 2 === 1) name = baseName + ' Pty Ltd';
        var identityStatus = i === conflictIndex ? 'contact_conflict' : 'verified';
        invoices.push({
          debtorNo: debtorNo,
          key: identityStatus === 'verified' ? 'xero:' + contactId : 'invoice:' + uuid('f', i + 1),
          identity: identityStatus,
          contactId: contactId,
          row: {
            xero_invoice_id: uuid('f', i + 1),
            invoice_number: number,
            reference: linked ? job.number + ' ' + ['Deposit', 'Final balance', 'Progress claim', 'Variation'][i % 4] : (i % 2 ? 'No reference' : null),
            status: i % 13 === 5 ? 'SUBMITTED' : 'AUTHORISED',
            total: money(amount + paidPart),
            amount_due: money(amount),
            amount_paid: money(paidPart),
            invoice_date: invDate,
            due_date: due,
            days_overdue: due ? Math.max(0, days) : null,
            overdue: Boolean(due) && days > 0,
            sent_to_contact: i % 6 !== 2,
            contact: { xero_contact_id: contactId, name: name, identity_status: identityStatus },
            link: linked
              ? { status: 'linked', method: i % 3 ? 'reference' : 'job_id', job_id: job.id, job_number: job.number, candidates: [] }
              : { status: 'none', method: null, job_id: null, job_number: null, candidates: [] },
            ghl_contact_id: linked && debtorNo % 7 !== 0 ? 'ghl-synthetic-' + pad(debtorNo, 3) : null,
            classification: {
              class: cls.class, type: ['deposit', 'final_balance', 'progress_claim', 'variation'][i % 4], blocker: cls.blocker,
              reason: cls.class ? 'Synthetic classification reason ' + (i % 5 + 1) + '.' : null,
              source: cls.class ? 'debt_refresh' : null, void_proposed: cls.class === 'not_owed' ? true : null,
              handoff_ref: null, handoff_at: null, as_of: cls.class ? hoursBefore(8) : null
            },
            next_step: {
              action: cls.action, at: cls.action ? addDays(TODAY, (i % 5) - 1) : null, owner: cls.owner,
              follow_up_date: i % 10 === 3 ? addDays(TODAY, 2) : null
            },
            proposal: null,
            has_brief: i % 8 === 0,
            context: linked
              ? { facts: facts, facts_count: facts === 'present' ? 2 + (i % 3) : 0, conversation: 'present', conversation_count: 3 + (i % 6), last_client_message_at: hoursBefore(24 * (2 + (i % 20))), extraction_queue: null, blockers: facts === 'missing' ? ['facts_missing'] : [], complete: facts === 'present' }
              : { facts: 'no_job', facts_count: 0, conversation: 'no_job', conversation_count: 0, last_client_message_at: null, extraction_queue: null, blockers: ['no_job_linked'], complete: false },
            chase: { count: i % 3, last_at: i % 3 ? hoursBefore(24 * (1 + (i % 9))) : null },
            xero: { synced_at: hoursBefore(0.5 + (i % 3) * 0.25), age_minutes: 30 + (i % 3) * 15, fresh: true },
            as_of: AS_OF,
            faults: []
          }
        });
      }
    });

    // Drafts the desk has proposed: texts with a fictional number, emails to
    // example.invalid, one text with no recipient on the read, one expired.
    var p = 0;
    invoices.forEach(function (inv, i) {
      var r = inv.row;
      if (!r.overdue || r.classification.class !== 'genuine_debt' || r.link.status !== 'linked') return;
      if (p < 12) r.proposal = { status: 'pending', kind: 'sms', to: PHONES[p], text: 'Synthetic draft text ' + (p + 1) + ' about invoice ' + r.invoice_number + ' and its balance of $' + r.amount_due.toFixed(2) + '.', at: hoursBefore(6 + p) };
      else if (p < 15) r.proposal = { status: 'pending', kind: 'email', to: 'debtor' + pad(inv.debtorNo, 3) + '@example.invalid', text: 'Synthetic draft email ' + (p - 11) + ' about invoice ' + r.invoice_number + '.\n\nIt names the balance of $' + r.amount_due.toFixed(2) + ' and asks when it will be paid.', at: hoursBefore(5) };
      else if (p === 15) r.proposal = { status: 'pending', kind: 'sms', to: null, text: 'Synthetic draft text with no recipient on the read, about ' + r.invoice_number + '.', at: hoursBefore(4) };
      else if (p === 16) r.proposal = { status: 'expired', kind: 'sms', to: PHONES[12], text: 'Synthetic draft text that expired, about ' + r.invoice_number + '.', at: hoursBefore(72) };
      p += 1;
    });

    // Group into debtors in debt order.
    var groups = {};
    var order = [];
    invoices.forEach(function (inv) {
      if (!groups[inv.key]) { groups[inv.key] = []; order.push(inv.key); }
      groups[inv.key].push(inv);
    });

    var debtors = order.map(function (key) { return debtorFor(key, groups[key]); });
    debtors.sort(function (a, b) {
      return b.max_days_overdue - a.max_days_overdue || b.total_due - a.total_due || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    });

    var all = invoices.map(function (inv) { return inv.row; });
    function countOf(nn, of) { return { n: nn, of: of, denominator: 'open_invoices' }; }
    var N = all.length;
    var overdueAll = all.filter(function (r) { return r.overdue; });
    var keys = Object.keys(groups);
    var summary = {
      invoices: {
        denominator: POPULATION_DENOMINATOR,
        count: N,
        amount_due: money(all.reduce(function (a, r) { return a + r.amount_due; }, 0)),
        overdue: Object.assign(countOf(overdueAll.length, N), { amount_due: money(overdueAll.reduce(function (a, r) { return a + r.amount_due; }, 0)) }),
        no_due_date: countOf(all.filter(function (r) { return !r.due_date; }).length, N),
        link: {
          linked: countOf(all.filter(function (r) { return r.link.status === 'linked'; }).length, N),
          ambiguous: countOf(0, N),
          none: countOf(all.filter(function (r) { return r.link.status === 'none'; }).length, N),
          unknown: countOf(0, N)
        },
        facts: {
          present: countOf(all.filter(function (r) { return r.context.facts === 'present'; }).length, N),
          missing: countOf(all.filter(function (r) { return r.context.facts === 'missing'; }).length, N),
          no_job: countOf(all.filter(function (r) { return r.context.facts === 'no_job'; }).length, N),
          unknown: countOf(0, N)
        },
        xero_stale: countOf(0, N),
        with_faults: countOf(0, N)
      },
      debtors: {
        denominator: DEBTOR_DENOMINATOR,
        count: keys.length,
        verified: { n: keys.filter(function (x) { return x.indexOf('xero:') === 0; }).length, of: keys.length, denominator: 'debtors' },
        standing_alone: { n: keys.filter(function (x) { return x.indexOf('invoice:') === 0; }).length, of: keys.length, denominator: 'debtors' },
        shown: debtors.length
      }
    };

    return {
      version: 'debt-worklist/v1',
      reads: { debt_picture: 'debt-picture/v1', invoice_context: 'invoice-context/v1' },
      as_of: AS_OF,
      filter: { debtor: null, timeline: 'recent' },
      summary: summary,
      reconciliation: {
        book_invoice_ids: N, shown_invoice_ids: N, exactly_once: true,
        not_shown: [], shown_more_than_once: [], missing_from_context: [], extra_in_context: []
      },
      sources: {
        invoices: { ok: true, count: N },
        context: { ok: true, facets: { job_link: { ok: true }, facts: { ok: true }, conversation: { ok: true } } },
        jobs: { ok: true, count: 72 },
        notes: { ok: true },
        xero_events: { ok: true }
      },
      debtors: debtors,
      faults: [],
      warnings: []
    };
  }

  // Timeline entries for one debtor, the way the read model shapes them.
  function timelineFor(debtorNo, rows) {
    var raw = [];
    var jobs = {};
    rows.forEach(function (r) {
      if (r.link.status === 'linked') (jobs[r.link.job_id] = jobs[r.link.job_id] || { number: r.link.job_number, invoices: [] }).invoices.push(r.xero_invoice_id);
      if (r.invoice_date) raw.push(entry({ key: 'xero:raised:' + r.xero_invoice_id, kind: 'xero_invoice_raised', provider: 'xero', provider_id: r.xero_invoice_id, at: r.invoice_date, at_precision: 'date', direction: 'system', source: 'xero_mirror', source_ref: r.xero_invoice_id, preview: r.invoice_number + ' raised for ' + r.total + (r.due_date ? ', due ' + r.due_date : ''), job_id: r.link.job_id, invoice_ids: [r.xero_invoice_id], invoice_scope: 'invoice' }));
      if (r.amount_paid > 0) raw.push(entry({ key: 'xero:payment:p-' + r.xero_invoice_id, kind: 'xero_payment', provider: 'xero', provider_id: 'p-' + r.xero_invoice_id, at: addDays(r.invoice_date, 5), at_precision: 'date', direction: 'system', source: 'xero_mirror', source_ref: 'p-' + r.xero_invoice_id, preview: 'Payment of ' + r.amount_paid + ' against ' + r.invoice_number, job_id: r.link.job_id, invoice_ids: [r.xero_invoice_id], invoice_scope: 'invoice' }));
      for (var c = 0; c < r.chase.count; c++) {
        var isCall = (debtorNo + c) % 2 === 0;
        raw.push(entry({ key: 'chase:' + r.xero_invoice_id + ':' + c, kind: isCall ? 'call' : 'debt_note', channel: isCall ? 'call' : 'note', provider: 'secureworks', at: hoursBefore(24 * (3 + c * 4 + (debtorNo % 5))), direction: 'internal', author: 'desk@example.invalid', source: 'payment_chase_logs', source_ref: 'chase-' + debtorNo + '-' + c, subject: isCall ? 'call back' : 'waiting on client', preview: isCall ? 'Synthetic call log: rang, no answer, left a message.' : 'Synthetic desk note ' + (c + 1) + ' for the next person who opens this.', job_id: r.link.job_id, invoice_ids: [r.xero_invoice_id], invoice_scope: 'invoice' }));
      }
      if (r.sent_to_contact) raw.push(entry({ key: 'bev:emailed-' + r.xero_invoice_id, kind: 'invoice_event', channel: 'email', provider: 'secureworks', at: r.invoice_date + 'T01:30:00.000Z', direction: 'outbound', author: 'accounts@example.invalid', source: 'business_events', source_ref: 'emailed-' + r.xero_invoice_id, subject: 'invoice.emailed', preview: 'invoice.emailed to debtor' + pad(debtorNo, 3) + '@example.invalid', job_id: r.link.job_id, invoice_ids: [r.xero_invoice_id], invoice_scope: 'invoice' }));
    });
    var perJob = debtorNo === 2 ? 10 : null;
    var capped = [];
    Object.keys(jobs).forEach(function (jobId, j) {
      var count = perJob || ((debtorNo + j) % 5) + 1;
      if (count >= 10) capped.push(jobs[jobId].number);
      for (var m = 0; m < count; m++) {
        var t = (m + debtorNo) % 5;
        var at = hoursBefore(24 * (1 + m * 3 + j) + (debtorNo % 7));
        var base = { job_id: jobId, invoice_ids: jobs[jobId].invoices.slice(), invoice_scope: 'job', at: at };
        if (t === 0) raw.push(entry(Object.assign(base, { key: 'ghl:msg-' + debtorNo + '-' + j + '-' + m, kind: 'sms', channel: 'sms', provider: 'ghl', provider_id: 'ghl:msg-' + debtorNo + '-' + j + '-' + m, direction: 'outbound', author: 'Office', source: 'ghl_cache', source_ref: 'ghl-cache-' + debtorNo, preview: 'Synthetic text ' + (m + 1) + ' from us about the balance.' })));
        else if (t === 1) raw.push(entry(Object.assign(base, { key: 'ghl:msg-' + debtorNo + '-' + j + '-' + m, kind: 'sms', channel: 'sms', provider: 'ghl', provider_id: 'ghl:msg-' + debtorNo + '-' + j + '-' + m, direction: 'inbound', author: 'Debtor ' + pad(debtorNo, 3), source: 'ghl_cache', source_ref: 'ghl-cache-' + debtorNo, preview: debtorNo === 1 && m === 0 && j === 1 ? longPreview() : 'Synthetic reply ' + (m + 1) + ' from the debtor.' })));
        else if (t === 2) raw.push(entry(Object.assign(base, { key: 'graph:mail-' + debtorNo + '-' + j + '-' + m, kind: 'email', channel: 'email', provider: 'outlook', provider_id: 'graph:mail-' + debtorNo + '-' + j + '-' + m, direction: 'inbound', author: 'debtor' + pad(debtorNo, 3) + '@example.invalid', source: 'inbox', source_ref: 'inbox-' + debtorNo + '-' + m, subject: 'Synthetic email subject ' + (m + 1), preview: 'Synthetic email body ' + (m + 1) + ' from the debtor.' })));
        else if (t === 3) raw.push(entry(Object.assign(base, { key: 'ghl:note-' + debtorNo + '-' + j + '-' + m, kind: 'ghl_note', channel: 'note', provider: 'ghl', provider_id: 'ghl:note-' + debtorNo + '-' + j + '-' + m, direction: 'internal', author: 'Office', source: 'ghl_cache', source_ref: 'ghl-cache-' + debtorNo, preview: 'Synthetic GHL note ' + (m + 1) + '.' })));
        else raw.push(entry(Object.assign(base, { key: 'job_events:note-' + debtorNo + '-' + j + '-' + m, kind: 'job_note', channel: 'note', provider: 'secureworks', direction: 'internal', author: 'ops@example.invalid', source: 'job_events', source_ref: 'note-' + debtorNo + '-' + m, preview: 'Synthetic job note ' + (m + 1) + '.', label: 'site note' })));
      }
    });
    // Debtor 001's newest message was seen by two sources and merged into one.
    if (debtorNo === 1) {
      var firstMsg = raw.filter(function (e) { return e.source === 'ghl_cache'; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; })[0];
      if (firstMsg) firstMsg.seen_in = ['ghl_cache', 'business_events'];
    }
    raw.sort(function (a, b) {
      var ax = a.at || '', bx = b.at || '';
      if (ax !== bx) return ax < bx ? 1 : -1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    var faulted = debtorNo === 4;
    var shown = raw.slice(0, 12);
    var faults = faulted ? [(rows[0].link.job_number || 'job') + ': ghl_cache: permission denied for table ghl_conversation_cache'] : [];
    return {
      faults: faults,
      timeline: {
        mode: 'recent', order: 'newest_first', entries: shown, entries_read: raw.length,
        truncated: shown.length < raw.length, duplicates_merged: debtorNo === 1 ? 1 : 0,
        per_job_cap: 10, per_job_cap_reached: capped,
        complete: !faulted && capped.length === 0 && shown.length === raw.length,
        note: STORED_COPIES_NOTE
      }
    };
  }

  function longPreview() {
    var s = 'Synthetic long reply from the debtor. ';
    var out = '';
    while (out.length < 500) out += s;
    return out.slice(0, 500);
  }

  function entry(e) {
    return {
      key: e.key, kind: e.kind, channel: e.channel === undefined ? null : e.channel, provider: e.provider,
      provider_id: e.provider_id || null, at: e.at, at_precision: e.at_precision || 'time', direction: e.direction,
      author: e.author || null, source: e.source, source_ref: e.source_ref || null, subject: e.subject || null,
      preview: e.preview, job_id: e.job_id || null, invoice_ids: e.invoice_ids, invoice_scope: e.invoice_scope,
      seen_in: e.seen_in || [e.source], label: e.label || null
    };
  }

  function debtorFor(key, group) {
    var rows = group.map(function (g) { return g.row; }).sort(function (a, b) {
      var ad = a.due_date || '9999', bd = b.due_date || '9999';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return String(a.invoice_number).localeCompare(String(b.invoice_number));
    });
    var first = group[0];
    var debtorNo = first.debtorNo;
    var names = rows.map(function (r) { return r.contact.name; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
    var tl = timelineFor(debtorNo, rows);
    var timeline = tl.timeline;
    var debtorFaults = tl.faults.map(function (f) { return { source: 'timeline', detail: f }; });
    var contactEntries = timeline.entries.filter(function (e) {
      return e.kind === 'call' || ((e.direction === 'inbound' || e.direction === 'outbound') && (e.channel === 'sms' || e.channel === 'email') && e.kind !== 'invoice_event');
    });
    function brief(e) { return e ? { at: e.at, channel: e.channel, direction: e.direction, provider: e.provider, source: e.source } : null; }
    var linkedRows = rows.filter(function (r) { return r.link.status === 'linked'; });
    var ghlIds = {};
    rows.forEach(function (r) { if (r.ghl_contact_id && r.link.job_id) (ghlIds[r.ghl_contact_id] = ghlIds[r.ghl_contact_id] || []).push(r.link.job_id); });
    var ghlCount = Object.keys(ghlIds).length;
    var factRows = rows.filter(function (r) { return r.context.facts !== 'no_job' && r.context.facts !== 'unknown'; });
    var factsStatus = !factRows.length ? 'no_job'
      : factRows.every(function (r) { return r.context.facts === 'present'; }) ? 'present'
      : factRows.some(function (r) { return r.context.facts === 'present'; }) ? 'partial' : 'missing';
    function countIn(pred) { return timeline.entries.filter(pred).length; }
    var linkedJobs = linkedRows.map(function (r) { return r.link.job_id; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
    var overdueRows = rows.filter(function (r) { return r.overdue; });
    var owners = {};
    rows.forEach(function (r) { if (r.next_step.owner) owners[r.next_step.owner] = (owners[r.next_step.owner] || 0) + 1; });
    var withAction = rows.filter(function (r) { return r.next_step.action; }).sort(function (a, b) {
      var ad = a.next_step.at || '', bd = b.next_step.at || '';
      if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return b.amount_due - a.amount_due;
    });
    var pick = withAction[0];
    var syncs = rows.map(function (r) { return r.xero.synced_at; }).sort();
    return {
      key: key,
      identity: {
        status: first.identity,
        xero_contact_id: first.contactId,
        name: names[0] || null,
        names: names,
        name_variants: names.length > 1,
        detail: first.identity === 'contact_conflict'
          ? "The mirror's contact id " + first.contactId + " differs from the Xero payload's ContactID " + uuid('e', 99) + '; it stands alone until a Xero sync settles it'
          : null
      },
      invoice_count: rows.length,
      total_due: money(rows.reduce(function (a, r) { return a + r.amount_due; }, 0)),
      overdue_count: overdueRows.length,
      overdue_amount: money(overdueRows.reduce(function (a, r) { return a + r.amount_due; }, 0)),
      oldest_due_date: rows.map(function (r) { return r.due_date; }).filter(Boolean).sort()[0] || null,
      max_days_overdue: rows.reduce(function (m, r) { return Math.max(m, r.days_overdue || 0); }, 0),
      no_due_date: rows.filter(function (r) { return !r.due_date; }).length,
      last_contact: {
        last: brief(contactEntries[0]),
        last_inbound: brief(contactEntries.filter(function (e) { return e.direction === 'inbound'; })[0]),
        last_outbound: brief(contactEntries.filter(function (e) { return e.direction === 'outbound'; })[0]),
        complete: timeline.complete,
        basis: 'stored timeline copies'
      },
      next_step: pick ? { action: pick.next_step.action, at: pick.next_step.at, owner: pick.next_step.owner, from_invoice_id: pick.xero_invoice_id, from_invoice_number: pick.invoice_number } : null,
      owners: Object.keys(owners).map(function (o) { return { owner: o, invoices: owners[o] }; }).sort(function (a, b) { return b.invoices - a.invoices || a.owner.localeCompare(b.owner); }),
      link_state: {
        linked: linkedRows.length,
        ambiguous: 0,
        none: rows.filter(function (r) { return r.link.status === 'none'; }).length,
        unknown: 0,
        job_ids: linkedJobs
      },
      freshness: { as_of: AS_OF, xero_oldest_synced_at: syncs[0], xero_fresh: true, picture_as_of: rows.map(function (r) { return r.classification.as_of; }).filter(Boolean).sort()[0] || null },
      sources: {
        xero: { status: 'current', oldest_synced_at: syncs[0], stale_invoice_ids: [], stale_after_hours: 24 },
        ghl: {
          status: tl.faults.length ? 'unreadable' : !linkedRows.length ? 'no_job' : ghlCount === 0 ? 'no_contact' : ghlCount === 1 ? 'bound' : 'several',
          contact_ids: Object.keys(ghlIds).map(function (id) { return { ghl_contact_id: id, via_job_ids: ghlIds[id].sort() }; }),
          messages_shown: countIn(function (e) { return e.provider === 'ghl'; }),
          read: 'stored GHL cache and captured business events'
        },
        email: { status: !linkedRows.length ? 'no_job' : 'read', messages_shown: countIn(function (e) { return e.channel === 'email' && e.kind !== 'invoice_event'; }), note: STORED_COPIES_NOTE },
        notes: {
          status: 'read',
          debt_notes: timeline.entries.filter(function (e) { return e.kind === 'debt_note'; }).length,
          chase_log_rows: rows.reduce(function (a, r) { return a + r.chase.count; }, 0),
          job_notes_shown: countIn(function (e) { return e.kind === 'job_note'; })
        },
        facts: { status: factsStatus, invoices_with_facts: rows.filter(function (r) { return r.context.facts === 'present'; }).length, of_invoices: rows.length }
      },
      faults: debtorFaults,
      invoices: rows,
      timeline: timeline
    };
  }

  function makeClearDebtWorklist() { return build(); }
  makeClearDebtWorklist.AS_OF = AS_OF;
  root.makeClearDebtWorklist = makeClearDebtWorklist;
  if (typeof module !== 'undefined' && module.exports) module.exports = makeClearDebtWorklist;
})(typeof window !== 'undefined' ? window : globalThis);
