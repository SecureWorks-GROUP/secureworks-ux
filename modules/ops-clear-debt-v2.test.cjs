// Behavioural tests for the Clear Debt screen (modules/ops-clear-debt-v2.js)
// against the synthetic debt-worklist/v1 fixture. The browser spec
// tests/e2e/ops-clear-debt.spec.js covers trusted clicks and the request log.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const makeWorklist = require('../tests/fixtures/clear-debt/worklist.js');

// A tiny page: one root whose innerHTML the module writes. Nothing else.
const root = { innerHTML: '', addEventListener() {}, querySelector() { return null; }, contains() { return true; } };
globalThis.document = { getElementById: (id) => (id === 'clearDebtRoot' ? root : null), activeElement: null };
// Every way the module could reach the network or write is a recording spy.
const calls = [];
const outbound = [];
globalThis.opsFetch = async (action, params) => { calls.push({ action, params }); return globalThis.__answer(); };
globalThis.opsPost = async (action, body) => { outbound.push({ via: 'opsPost', action, body }); throw new Error('write attempted'); };
globalThis.opsPostJwt = async (action, body) => { outbound.push({ via: 'opsPostJwt', action, body }); throw new Error('write attempted'); };
globalThis.fetch = async (url, init) => { outbound.push({ via: 'fetch', url, init }); throw new Error('network attempted'); };
globalThis.XMLHttpRequest = function () { outbound.push({ via: 'XMLHttpRequest' }); throw new Error('network attempted'); };
globalThis.confirm = () => { outbound.push({ via: 'confirm' }); return false; };
const CD = require('./ops-clear-debt-v2.js');

function freshState() {
  Object.assign(CD.state, {
    data: null, loading: false, error: null, search: '', filter: 'all', owner: '',
    selectedKey: null, invoiceId: null, tlFilter: 'all', channel: null,
    drafts: {}, showDetails: false
  });
}
async function loaded(mutate) {
  const data = makeWorklist();
  if (mutate) mutate(data);
  globalThis.__answer = () => structuredClone(data);
  await CD.load();
  return CD.state.data;
}
function html() { CD.render(); return root.innerHTML; }
function text() { return html().replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' '); }
function pick(name) { const d = CD.state.data.debtors.find((x) => x.identity.name === name); CD.state.selectedKey = d.key; return d; }

beforeEach(() => { freshState(); calls.length = 0; outbound.length = 0; root.innerHTML = ''; });

// Walk every state a person can reach from the one payload: each debtor, each
// invoice, each channel with and without an edit, each timeline chip and scope,
// each list filter and owner, search, details. Returns every rendered page.
function walkEveryState(data) {
  const pages = [];
  const snap = () => { pages.push(html()); };
  CD.state.showDetails = true; snap(); CD.state.showDetails = false;
  for (const f of CD.FILTERS) { CD.state.filter = f.key; snap(); }
  CD.state.filter = 'all';
  for (const o of CD.ownersOf(data.debtors)) { CD.state.owner = o.owner; snap(); }
  CD.state.owner = '';
  CD.state.search = 'INV-S1003'; snap(); CD.state.search = '';
  for (const d of data.debtors) {
    CD.state.selectedKey = d.key; CD.state.invoiceId = null; CD.state.channel = null;
    for (const c of CD.TL_CHIPS) { CD.state.tlFilter = c.key; snap(); }
    CD.state.tlFilter = 'all';
    for (const inv of d.invoices) {
      CD.state.invoiceId = inv.xero_invoice_id;
      for (const ch of ['text', 'email', 'note']) {
        CD.state.channel = ch; snap();
        CD.state.drafts[inv.xero_invoice_id + '|' + ch] = 'Edited words.'; snap();
      }
    }
  }
  return pages;
}

test('the tab makes exactly one read, and nothing a person can do on the screen reads or writes again', async () => {
  const data = await loaded();
  assert.deepEqual(calls, [{ action: 'debt_worklist', params: { timeline: 'recent' } }]);
  const pages = walkEveryState(data);
  assert.ok(pages.length > 1000);
  assert.equal(calls.length, 1, 'no further read');
  assert.deepEqual(outbound, [], 'no write, send, network call or confirm prompt');
  // The one action on every draft is disabled and says why; no enabled send exists.
  for (const h of pages) {
    assert.equal(/<button[^>]*class="primary"(?![^>]*disabled)/.test(h), false);
  }
});

test('no em dash in any rendered text, in any state', async () => {
  const data = await loaded();
  for (const h of walkEveryState(data)) assert.equal(h.includes('\u2014'), false);
  for (const answer of [() => { throw new Error('Unknown action'); }, () => { throw new Error('timeout'); }, () => ({ version: 'x' })]) {
    globalThis.__answer = answer;
    await CD.load();
    assert.equal(html().includes('\u2014'), false);
  }
});

test('counts come from the summary with named denominators and the as-of time', async () => {
  await loaded();
  const t = text();
  assert.match(t, /101 open invoices/);
  assert.match(t, /\$122,209\.52 due/);
  assert.match(t, /77 of 101 overdue, \$94,018\.88/);
  assert.match(t, /90 of 101 linked to a job/);
  assert.match(t, /11 not linked/);
  assert.match(t, /21 of 101 with facts/);
  assert.match(t, /78 debtors/);
  assert.match(t, /as of 10:00am Thu 24 Sept?\./);
  CD.state.showDetails = true;
  const d = text();
  assert.match(d, /open receivables: Xero ACCREC invoices with status AUTHORISED or SUBMITTED and amount due above zero/);
  assert.match(d, /Facts: 21 present, 69 missing, 11 with no job to read, 0 unknown \(of 101\)/);
  assert.match(d, /Every one of the 101 open invoices is shown exactly once/);
  assert.match(d, /77 confirmed contacts, 1 standing alone/);
  assert.match(d, /Promised payment dates, so there is no promise-date filter/);
});

test('every returned invoice renders exactly once across the debtor cards; the list renders every debtor once', async () => {
  const data = await loaded();
  const listRows = html().match(/data-cd="debtor"/g) || [];
  assert.equal(listRows.length, 78);
  const seen = new Map();
  for (const d of data.debtors) {
    CD.state.selectedKey = d.key;
    const ids = [...html().matchAll(/data-cd="invoice" value="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, d.invoice_count);
    ids.forEach((id) => seen.set(id, (seen.get(id) || 0) + 1));
  }
  assert.equal(seen.size, 101);
  assert.ok([...seen.values()].every((n) => n === 1));
  const cents = Math.round(data.debtors.reduce((a, d) => a + d.total_due, 0) * 100);
  assert.equal(cents, 12220952);
});

test('identity: a shared name never joins contacts; a name variant stays on its one contact; an unconfirmed contact stands alone with its reason', async () => {
  const data = await loaded();
  const shared = data.debtors.filter((d) => d.identity.name === 'Debtor 020');
  assert.equal(shared.length, 2);
  assert.notEqual(shared[0].key, shared[1].key);
  CD.state.search = 'Debtor 020';
  assert.equal(CD.visibleDebtors().length, 2);
  const variant = pick('Debtor 001');
  assert.deepEqual(variant.identity.names, ['Debtor 001', 'Debtor 001 Pty Ltd']);
  assert.match(text(), /Also written as Debtor 001 Pty Ltd on the same Xero contact/);
  const alone = data.debtors.find((d) => d.identity.status !== 'verified');
  CD.state.selectedKey = alone.key;
  const t = text();
  assert.match(t, /Contact not confirmed/);
  assert.match(t, /stands alone until a Xero sync settles it/);
});

test('search finds by name, invoice number, reference and job number without moving the counts', async () => {
  const data = await loaded();
  const before = text().match(/101 open invoices[^D]*78 debtors/)[0];
  const byInvoice = data.debtors.find((d) => d.invoices.some((i) => i.invoice_number === 'INV-S1050'));
  CD.state.search = 'inv-s1050';
  assert.deepEqual(CD.visibleDebtors().map((d) => d.key), [byInvoice.key]);
  const withJob = data.debtors.find((d) => d.invoices.some((i) => i.link.job_number === 'SWF-90010'));
  CD.state.search = 'SWF-90010';
  assert.ok(CD.visibleDebtors().some((d) => d.key === withJob.key));
  CD.state.search = 'Progress claim';
  assert.ok(CD.visibleDebtors().length > 0);
  CD.state.search = 'Debtor 007';
  assert.equal(CD.visibleDebtors().length, 1);
  CD.state.search = 'nothing matches this';
  assert.equal(CD.visibleDebtors().length, 0);
  const t = text();
  assert.match(t, /No debtor matches\. Counts above are for the whole book\./);
  assert.ok(t.includes(before));
});

test('every filter answers from fields the read carries, and none drops the counts', async () => {
  const data = await loaded();
  const all = data.debtors;
  const expect = {
    all: all.length,
    overdue: all.filter((d) => d.overdue_count > 0).length,
    over60: all.filter((d) => d.max_days_overdue > 60).length,
    draft: all.filter((d) => d.invoices.some((i) => i.proposal && i.proposal.status === 'pending')).length,
    not_linked: all.filter((d) => d.link_state.none > 0).length,
    facts_missing: all.filter((d) => ['missing', 'partial'].includes(d.sources.facts.status)).length,
    stale: all.filter((d) => d.faults.length > 0 || ['ghl', 'email', 'notes', 'facts'].some((k) => ['stale', 'unreadable'].includes(d.sources[k].status))).length,
    unconfirmed: 1
  };
  for (const [key, n] of Object.entries(expect)) {
    CD.state.filter = key;
    assert.equal(CD.visibleDebtors().length, n, key);
    assert.match(text(), /101 open invoices/);
  }
  assert.ok(expect.overdue > 0 && expect.overdue < all.length);
  // A stale source with fresh Xero and no faults is still "stale or unreadable".
  CD.state.filter = 'stale';
  const staleGhl = all.find((d) => d.sources.ghl.status === 'stale');
  assert.equal(staleGhl.faults.length, 0);
  assert.equal(staleGhl.freshness.xero_fresh, true);
  assert.ok(CD.visibleDebtors().some((d) => d.key === staleGhl.key));
  const unreadableFacts = all.find((d) => d.sources.facts.timeline_read === 'unreadable');
  assert.ok(CD.visibleDebtors().some((d) => d.key === unreadableFacts.key));
  assert.equal(CD.staleOrUnreadable(all.find((d) => d.identity.name === 'Debtor 003')), false);
  assert.equal(expect.not_linked, 11);
  CD.state.filter = 'dispute';
  assert.ok(CD.visibleDebtors().every((d) => d.invoices.some((i) => i.classification.class === 'in_dispute')));
  CD.state.filter = 'allocation';
  assert.ok(CD.visibleDebtors().every((d) => d.invoices.some((i) => i.classification.blocker === 'paid_unallocated')));
  CD.state.filter = 'all';
  CD.state.owner = 'INSURANCE';
  assert.ok(CD.visibleDebtors().length > 0);
  assert.ok(CD.visibleDebtors().every((d) => d.owners.some((o) => o.owner === 'INSURANCE')));
  // No filter pretends to know promise dates or a ready-for-Captain verdict.
  assert.equal(CD.FILTERS.some((f) => /promise|ready/i.test(f.label)), false);
});

test('no invoice is picked until one is chosen; the draft is bound to exactly that invoice', async () => {
  const d = (await loaded(), pick('Debtor 001'));
  let h = html();
  assert.equal(/checked/.test(h), false);
  assert.match(text(), /Pick the invoice a message is about\. Nothing is picked until you choose\./);
  assert.match(text(), /Pick an invoice above to draft a message about it/);
  assert.equal(/id="cd-draft"/.test(h), false);
  assert.equal(CD.composerModel(d, null, null, {}), null);
  const a = d.invoices.find((i) => i.proposal && i.proposal.kind === 'sms');
  CD.state.invoiceId = a.xero_invoice_id;
  h = html();
  assert.equal((h.match(/ checked/g) || []).length, 1);
  const t = text();
  assert.ok(t.includes('About ' + a.invoice_number + ' only'));
  assert.ok(t.includes('Text to ' + a.proposal.to));
  assert.ok(h.includes('>' + a.proposal.text + '</textarea>'));
  const b = d.invoices.find((i) => i.xero_invoice_id !== a.xero_invoice_id);
  CD.state.invoiceId = b.xero_invoice_id;
  CD.state.channel = null;
  assert.ok(text().includes('About ' + b.invoice_number + ' only'));
  assert.equal(text().includes('About ' + a.invoice_number + ' only'), false);
});

test('the draft names what the read cannot supply, and sending stays unavailable', async () => {
  const data = await loaded();
  const all = data.debtors.flatMap((d) => d.invoices.map((i) => ({ d, i })));
  const noTo = all.find(({ i }) => i.proposal && i.proposal.status === 'pending' && !i.proposal.to);
  let m = CD.composerModel(noTo.d, noTo.i.xero_invoice_id, null, {});
  assert.equal(m.channel, 'text');
  assert.deepEqual(m.missing, ['the phone number to text', 'the line the text is sent from']);
  const email = all.find(({ i }) => i.proposal && i.proposal.kind === 'email');
  m = CD.composerModel(email.d, email.i.xero_invoice_id, null, {});
  assert.equal(m.channel, 'email');
  assert.equal(m.to, email.i.proposal.to);
  assert.deepEqual(m.missing, ['the subject line', 'which invoice PDF is attached', 'the mailbox it is sent from']);
  // A text channel never borrows an email address as a phone number.
  m = CD.composerModel(email.d, email.i.xero_invoice_id, 'text', {});
  assert.equal(m.to, null);
  assert.equal(m.body, '');
  const expired = all.find(({ i }) => i.proposal && i.proposal.status === 'expired');
  m = CD.composerModel(expired.d, expired.i.xero_invoice_id, null, {});
  assert.equal(m.proposalFits, false);
  assert.equal(m.body, '');
  // Rendered: the one action is disabled and says why in words.
  CD.state.selectedKey = noTo.d.key;
  CD.state.invoiceId = noTo.i.xero_invoice_id;
  const h = html();
  assert.match(h, /<button type="button" class="primary" disabled[^>]*>.*Approve and send<\/button>/);
  assert.match(text(), /Sending arrives with a later approval step\. Nothing is sent, saved or approved from this screen\./);
  assert.match(text(), /Not in this read yet: the phone number to text, the line the text is sent from\./);
  assert.equal(/<button[^>]*class="primary"(?![^>]*disabled)/.test(h), false);
  CD.state.channel = 'note';
  assert.match(html(), /disabled[^>]*>.*Save note<\/button>/);
  assert.match(text(), /Nothing is saved\./);
});

test('an edit stays local, is named as unsaved, and can go back to the drafted words', async () => {
  const data = await loaded();
  const { d, i } = data.debtors.flatMap((d) => d.invoices.map((i) => ({ d, i }))).find(({ i }) => i.proposal && i.proposal.kind === 'sms' && i.proposal.to);
  const drafts = { [i.xero_invoice_id + '|text']: i.proposal.text + ' Thanks.' };
  const m = CD.composerModel(d, i.xero_invoice_id, null, drafts);
  assert.equal(m.edited, true);
  assert.equal(m.body, i.proposal.text + ' Thanks.');
  CD.state.selectedKey = d.key; CD.state.invoiceId = i.xero_invoice_id; CD.state.drafts = drafts;
  assert.match(text(), /Edited here\. Your changes stay in this tab and are not saved\./);
  assert.match(html(), /data-cd="revert"/);
});

test('timeline: one stream, newest first, every entry source-labelled, chips filter that one stream', async () => {
  await loaded();
  const d = pick('Debtor 001');
  const entries = d.timeline.entries;
  const ats = entries.map((e) => e.at || '');
  assert.deepEqual(ats, [...ats].sort().reverse());
  let h = html();
  assert.equal((h.match(/<li class="tl /g) || []).length, entries.length);
  assert.equal((h.match(/class="src src-/g) || []).length, entries.length);
  const counts = CD.chipCounts(d);
  const groups = ['text', 'email', 'note', 'call', 'xero', 'facts'];
  assert.equal(groups.reduce((a, g) => a + counts[g], 0) + counts.other, counts.all);
  for (const g of groups) {
    CD.state.tlFilter = g;
    h = html();
    const shown = [...h.matchAll(/<li class="tl [^"]*" data-group="([a-z]+)"/g)].map((m) => m[1]);
    assert.equal(shown.length, counts[g], g);
    assert.ok(shown.every((x) => x === g));
  }
  CD.state.tlFilter = 'all';
  const t = text();
  assert.match(t, /GHL Text from them/);
  assert.match(t, /Outlook Email from them/);
  assert.match(t, /SecureWorks Invoice emailed/);
  const emailInvoiceEvent = d.timeline.entries.find((e) => e.kind === 'invoice_event' && e.channel === 'email');
  assert.ok(emailInvoiceEvent);
  assert.equal(CD.entryGroup(emailInvoiceEvent), 'email');
  assert.ok(CD.timelineEntries(d, { tlFilter: 'email' }).includes(emailInvoiceEvent));
  assert.equal(CD.timelineEntries(d, { tlFilter: 'xero' }).includes(emailInvoiceEvent), false);
  assert.match(t, /Preview, cut at 500 characters/);
  assert.match(t, /GHL stored copy, also in captured event/);
  assert.match(t, /1 copy of the same message shown once/);
  assert.match(t, /These are stored copies, not a live GHL or Outlook read\./);
  assert.match(t, /Stored emails are inbound copies only; sent emails are not captured \(owner CIO; fix: CIO email capture \(EM1\): capture Outlook Sent Items and inbound mail as stored events\)\./);
  assert.match(t, /Only the newest 12 of 32 stored entries are in this read\./);
  assert.match(t, /Luna Captured fact: [a-z ]+ captured/);
  assert.match(t, /GHL captured 1 hour before this read/);
});

test('picking an invoice does not narrow the debtor timeline', async () => {
  await loaded();
  const d = pick('Debtor 001');
  const inv = d.invoices[1];
  CD.state.invoiceId = inv.xero_invoice_id;
  const list = CD.timelineEntries(d);
  assert.deepEqual(list, d.timeline.entries);
  assert.doesNotMatch(html(), /Only INV-|data-cd="only"/);
});

// One rule for every empty or partial view: a source that was not fully read
// gets exactly one line naming it and its limit and there is no absence claim;
// absence is said only when every source behind the view was fully read, and
// only for what was read. Each row is one path through that rule.
test('every empty-state path follows the one rule', async () => {
  const data = await loaded();
  const base = data.debtors.find((x) => x.identity.name === 'Debtor 001');
  function fullyRead() {
    const d = structuredClone(base);
    d.key = 'xero:table-case';
    d.faults = [];
    d.last_contact = { last: null, last_inbound: null, last_outbound: null, complete: true, basis: 'stored timeline copies' };
    d.timeline = { ...d.timeline, entries: [], entries_read: 0, truncated: false, per_job_cap: 10, per_job_cap_reached: [], facts_per_job_cap: 10, facts_cap_reached: [], complete: true };
    d.sources = {
      xero: { status: 'current', stale_after_hours: 24 },
      ghl: { status: 'bound' },
      email: { status: 'partial' },
      notes: { status: 'read' },
      facts: { status: 'partial', invoices_with_facts: 4, of_invoices: 5, timeline_read: 'read', facts_shown: 0 }
    };
    return d;
  }
  const NONE = (what) => 'No ' + what + ' among the 0 stored items read for this debtor.';
  const cases = [
    ['texts, GHL fully read', 'text', () => {}, [], NONE('texts')],
    ['texts, GHL unreadable', 'text', (d) => { d.sources.ghl.status = 'unreadable'; }, ['Stored GHL texts could not be read.'], null],
    ['texts, GHL unreadable with owner and fix', 'text', (d) => { Object.assign(d.sources.ghl, { status: 'unreadable', owner: 'CIO', recovery_action: 'retry the read' }); }, ['Stored GHL texts could not be read (owner CIO; fix: retry the read).'], null],
    ['texts, no job linked', 'text', (d) => { d.sources.ghl.status = 'no_job'; }, ['No invoice on this debtor is linked to a job, so stored GHL texts cannot be read.'], null],
    ['texts, job has no GHL contact', 'text', (d) => { d.sources.ghl.status = 'no_contact'; }, ['The linked job has no GHL contact, so stored GHL texts cannot be found.'], null],
    ['texts, GHL stale', 'text', (d) => { Object.assign(d.sources.ghl, { status: 'stale', last_success_at: '2026-09-23T20:00:00.000Z', stale_after: '6h' }); }, ['Stored GHL texts are stale: last captured 6 hours before this read, stale after 6h.'], null],
    ['texts, GHL not read', 'text', (d) => { d.sources.ghl.status = 'not_read'; }, ['Stored GHL texts were not read for this view.'], null],
    ['texts, GHL status missing', 'text', (d) => { delete d.sources.ghl.status; }, ['The read did not say whether stored GHL texts were read.'], null],
    ['texts, truncated', 'text', (d) => { d.timeline.truncated = true; d.timeline.entries_read = 30; }, ['Only the newest 0 of 30 stored entries are in this read.'], null],
    ['texts, per-job cap', 'text', (d) => { d.timeline.per_job_cap_reached = ['SWF-90001']; }, ['Job SWF-90001 has more than 10 messages; only the newest 10 per job were read.'], null],
    ['emails, inbound only', 'email', () => {}, ['Stored emails are inbound copies only; sent emails are not captured.'], null],
    ['emails, unreadable', 'email', (d) => { d.sources.email.status = 'unreadable'; }, ['Stored emails could not be read.'], null],
    ['emails, no job', 'email', (d) => { d.sources.email.status = 'no_job'; }, ['No invoice on this debtor is linked to a job, so stored emails cannot be read.'], null],
    ['emails, not read', 'email', (d) => { d.sources.email.status = 'not_read'; }, ['Stored emails were not read for this view.'], null],
    ['notes, fully read', 'note', () => {}, [], NONE('notes')],
    ['notes, unreadable', 'note', (d) => { d.sources.notes.status = 'unreadable'; }, ['Notes and desk logs could not be read.'], null],
    ['notes, GHL half unreadable', 'note', (d) => { d.sources.ghl.status = 'unreadable'; }, ['Stored GHL texts could not be read.'], null],
    ['calls, fully read', 'call', () => {}, [], NONE('calls')],
    ['calls, notes not read', 'call', (d) => { d.sources.notes.status = 'not_read'; }, ['Notes and desk logs were not read for this view.'], null],
    ['Xero, current', 'xero', () => {}, [], NONE('invoices and xero')],
    ['Xero, stale', 'xero', (d) => { d.sources.xero.status = 'stale'; }, ['The Xero copy is stale (older than 24 hours).'], null],
    ['facts, fully read', 'facts', () => {}, [], NONE('facts')],
    ['facts, unreadable', 'facts', (d) => { d.sources.facts.timeline_read = 'unreadable'; }, ['Captured facts could not be read for this timeline.'], null],
    ['facts, not read', 'facts', (d) => { d.sources.facts.timeline_read = 'not_read'; }, ['Captured facts were not read for this view.'], null],
    ['facts, counted not listed', 'facts', (d) => { delete d.sources.facts.timeline_read; }, ['This read does not list captured facts; it only counts them: facts on 4 of 5 invoices.'], null],
    ['facts, no job', 'facts', (d) => { d.sources.facts.status = 'no_job'; }, ['No invoice on this debtor is linked to a job, so captured facts cannot be read.'], null],
    ['facts, capped', 'facts', (d) => { d.timeline.facts_cap_reached = ['SWF-90002']; }, ['Job SWF-90002 has more than 10 captured facts; only the newest 10 per job were read.'], null],
    ['all, sent emails never captured', 'all', () => {}, ['Stored emails are inbound copies only; sent emails are not captured.'], null],
    ['all, several limits each once', 'all', (d) => { d.sources.ghl.status = 'unreadable'; d.sources.xero.status = 'stale'; d.timeline.truncated = true; d.timeline.entries_read = 5; },
      ['Stored GHL texts could not be read.', 'Stored emails are inbound copies only; sent emails are not captured.', 'The Xero copy is stale (older than 24 hours).', 'Only the newest 0 of 5 stored entries are in this read.'], null]
  ];
  for (const [name, group, mutate, lines, absence] of cases) {
    const d = fullyRead();
    mutate(d);
    CD.state.data = { ...data, debtors: [d] };
    CD.state.selectedKey = d.key;
    CD.state.tlFilter = group;
    const h = html();
    const shown = [...(h.match(/<ul class="limits"[^>]*>([\s\S]*?)<\/ul>/) || ['', ''])[1].matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((m) => m[1].replace(/&#39;/g, "'"));
    assert.deepEqual(shown, lines, name + ': limit lines');
    const body = (h.match(/<div id="cd-tl-body">([\s\S]*?)<\/div><\/section>/) || ['', ''])[1].replace(/<[^>]+>/g, '').trim();
    assert.equal(body, absence || '', name + ': absence line');
    const whole = text();
    for (const l of lines) assert.equal(whole.split(l).length - 1, 1, name + ': "' + l + '" shown once');
    if (lines.length) assert.doesNotMatch(body, /\bNo \w+|\bnone\b/i, name + ': no absence claim beside a limit');
  }
  // The card's last-contact line obeys the same rule.
  const d = fullyRead();
  CD.state.data = { ...data, debtors: [d] };
  CD.state.selectedKey = d.key;
  assert.match(text(), /Last contact unknown: sent emails are not captured\./);
  d.sources.ghl.status = 'unreadable';
  d.timeline.truncated = true; d.timeline.entries_read = 9;
  assert.match(text(), /Last contact unknown: stored GHL texts could not be read; sent emails are not captured; only the newest 0 of 9 stored entries were read\./);
  assert.doesNotMatch(text(), /No text, email or call/);
  // With a last contact, the line is scoped to the stored copies.
  const withLast = data.debtors.find((x) => x.identity.name === 'Debtor 001');
  CD.state.data = data;
  CD.state.selectedKey = withLast.key;
  CD.state.tlFilter = 'all';
  assert.match(text(), /Last contact in the stored copies: Wed 23 Sept?, 9:00am, a text from them \(GHL\)\./);
  // Across the whole fixture: no view ever says "no messages".
  for (const x of data.debtors) {
    CD.state.selectedKey = x.key;
    for (const c of CD.TL_CHIPS) { CD.state.tlFilter = c.key; assert.equal(/no messages/i.test(text()), false, x.key + ' ' + c.key); }
  }
});

test('facts are kind "fact" entries in the one timeline; anything else is not a fact', async () => {
  const data = await loaded();
  const d = pick('Debtor 001');
  const facts = d.timeline.entries.filter((e) => e.kind === 'fact');
  assert.ok(facts.length > 0);
  assert.equal(CD.chipCounts(d).facts, facts.length);
  CD.state.tlFilter = 'facts';
  let h = html();
  const shown = [...h.matchAll(/<li class="tl [^"]*" data-group="([a-z]+)"/g)].map((m) => m[1]);
  assert.equal(shown.length, facts.length);
  assert.ok(shown.every((g) => g === 'facts'));
  let t = text();
  for (const f of facts) {
    assert.ok(t.includes(f.fact.value), f.key);
    assert.ok(t.includes('source ' + f.fact.source_id), f.key);
  }
  assert.match(t, /Captured fact: [a-z ]+ captured \w{3} \d+ Sept?, \d+:\d\dam|pm/);
  assert.match(h, /class="pill ok">Current<\/span>/);
  assert.match(t, /Stale captured facts|Stale/);
  // The facts are in the All stream too, not a separate panel.
  CD.state.tlFilter = 'all';
  h = html();
  assert.ok((h.match(/data-group="facts"/g) || []).length === facts.length);
  assert.equal(/This read says whether facts exist/.test(text()), false);
  // Only kind "fact" is a fact: look-alikes land in their own groups.
  assert.equal(CD.isFactEntry({ kind: 'captured_fact' }), false);
  assert.equal(CD.isFactEntry({ kind: 'note', channel: 'fact' }), false);
  assert.equal(CD.entryGroup({ kind: 'captured_fact', channel: null, provider: 'luna' }), 'other');
  assert.equal(CD.isFactEntry({ kind: 'fact' }), true);
  // An unreadable fact read is one honest line in the timeline, never a zero.
  const bad = data.debtors.find((x) => x.sources.facts.timeline_read === 'unreadable');
  CD.state.selectedKey = bad.key;
  CD.state.tlFilter = 'all';
  t = text();
  assert.match(t, /Captured facts could not be read for this timeline\./);
  assert.equal(/data-tl="facts"[^>]*>Facts<span class="count">/.test(html()), false, 'no count while facts were not read');
  CD.state.tlFilter = 'facts';
  assert.equal((text().match(/Captured facts could not be read/g) || []).length, 1);
  assert.doesNotMatch(text(), /No facts in the newest .*stored copies/);
  // A debtor with no job names that; one with no facts yet says so.
  const noJob = data.debtors.find((x) => x.sources.facts.status === 'no_job');
  CD.state.selectedKey = noJob.key;
  assert.match(text(), /No invoice on this debtor is linked to a job, so captured facts cannot be read\./);
  // Summary counts do not substitute for timeline fact entries.
  await loaded((x) => { const q = x.debtors.find((y) => y.identity.name === 'Debtor 001'); delete q.sources.facts.timeline_read; q.timeline.entries = q.timeline.entries.filter((e) => e.kind !== 'fact'); });
  pick('Debtor 001');
  assert.match(text(), /This read does not list captured facts; it only counts them: facts on 4 of 5 invoices\./);
  // A capped fact read names the job.
  await loaded((x) => { const q = x.debtors.find((y) => y.identity.name === 'Debtor 001'); q.timeline.facts_cap_reached = ['SWF-90001']; });
  pick('Debtor 001');
  assert.match(text(), /Job SWF-90001 has more than 10 captured facts; only the newest 10 per job were read\./);
});

test('a stale GHL capture shows once in the timeline with its age, owner and fix, and on the card badge', async () => {
  const data = await loaded();
  const d = data.debtors.find((x) => x.sources.ghl.status === 'stale');
  CD.state.selectedKey = d.key;
  const t = text();
  assert.match(t, /GHL texts capture stale/);
  const line = 'Stored GHL texts are stale: last captured 30 hours before this read, stale after 6h (owner CIO; fix: CIO: run the GHL message reconcile for the stale contact(s)).';
  assert.equal(t.split(line).length - 1, 1);
});

test('an undeployed action shows one honest not-connected line, never a zero', async () => {
  globalThis.__answer = () => { throw new Error('Unknown action'); };
  await CD.load();
  const h = html();
  assert.match(h, /data-cd-state="not-connected"/);
  assert.match(text(), /The debtor work list is not connected yet/);
  assert.match(text(), /this is not a zero balance/);
  assert.equal(/\$0\.00|0 open invoices|data-cd="debtor"/.test(h), false);
});

test('an unreadable book and a wrong contract are named failures, not empty books', async () => {
  globalThis.__answer = () => { const e = new Error('the open invoice book could not be read (timeout); nothing is shown rather than an empty book'); e.status = 503; throw e; };
  await CD.load();
  assert.match(html(), /data-cd-state="failed"/);
  assert.match(text(), /could not be read \(timeout\)/);
  globalThis.__answer = () => ({ version: 'debt-worklist/v2', debtors: [], summary: { invoices: {} } });
  await CD.load();
  assert.match(html(), /data-cd-state="contract"/);
  assert.match(text(), /contract "debt-worklist\/v2"/);
  assert.equal(CD.checkContract(makeWorklist()), null);
});

test('read faults and a broken exactly-once check are shown, not hidden', async () => {
  await loaded((data) => {
    data.faults = [{ source: 'notes', detail: 'payment_chase_logs read failed: timeout' }];
    data.reconciliation.exactly_once = false;
    data.reconciliation.not_shown = ['x'];
    data.summary.invoices.with_faults.n = 3;
  });
  const t = text();
  assert.match(t, /Parts of the read failed/);
  assert.match(t, /notes: payment_chase_logs read failed: timeout/);
  assert.match(t, /1 invoices are not shown and 0 are shown more than once/);
  assert.match(t, /3 of 101 with read faults/);
});

test('times are Perth, and date-only values never roll a day', () => {
  assert.equal(CD.whenLabel('2026-09-23T01:00:00.000Z'), 'Wed 23 Sept, 9:00am'.replace('Sept', CD.whenLabel('2026-09-23').includes('Sept') ? 'Sept' : 'Sep'));
  assert.match(CD.whenLabel('2026-09-01', 'date'), /^Tue 1 Sept?$/);
  assert.equal(CD.whenLabel(null), 'time unknown');
  assert.equal(CD.money(1234.5), '$1,234.50');
  assert.equal(CD.money(null), 'amount not in the read');
});
