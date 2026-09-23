// Behavioural tests for the Clear Debt screen (modules/ops-clear-debt-v2.js)
// against the synthetic debt-worklist/v1 fixture. The browser spec
// tests/e2e/ops-clear-debt.spec.js covers trusted clicks and the request log.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const makeWorklist = require('../tests/fixtures/clear-debt/worklist.js');

const SRC = fs.readFileSync(path.join(__dirname, 'ops-clear-debt-v2.js'), 'utf8');

// A tiny page: one root whose innerHTML the module writes. Nothing else.
const root = { innerHTML: '', addEventListener() {}, querySelector() { return null; }, contains() { return true; } };
globalThis.document = { getElementById: (id) => (id === 'clearDebtRoot' ? root : null), activeElement: null };
const calls = [];
globalThis.opsFetch = async (action, params) => { calls.push({ action, params }); return globalThis.__answer(); };
const CD = require('./ops-clear-debt-v2.js');

function freshState() {
  Object.assign(CD.state, {
    data: null, loading: false, error: null, search: '', filter: 'all', owner: '',
    selectedKey: null, invoiceId: null, onlyInvoice: false, tlFilter: 'all', channel: null,
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

beforeEach(() => { freshState(); calls.length = 0; root.innerHTML = ''; });

test('the tab makes exactly one read: GET debt_worklist with the recent timeline', async () => {
  await loaded();
  assert.deepEqual(calls, [{ action: 'debt_worklist', params: { timeline: 'recent' } }]);
  // Choosing a debtor, an invoice, a channel and timeline filters renders from memory.
  const d = pick('Debtor 001');
  html();
  CD.state.invoiceId = d.invoices[1].xero_invoice_id; html();
  for (const c of CD.TL_CHIPS) { CD.state.tlFilter = c.key; html(); }
  CD.state.onlyInvoice = true; html();
  CD.state.channel = 'email'; html();
  CD.state.search = 'INV-S1003'; html();
  assert.equal(calls.length, 1);
});

test('the module has no write, send, note, proposal or provider path', () => {
  for (const banned of ['opsPost', 'send_chase_sms', 'send_invoice_email', 'add_debt_note', "'debt_note'", 'debt_proposal_mark', 'get_invoice_pdf', 'invoice_context', 'debt_notes', 'list_debt_picture', 'fetch(', 'XMLHttpRequest', 'sendBeacon']) {
    assert.equal(SRC.includes(banned), false, 'found ' + banned);
  }
  const reads = SRC.match(/opsFetch\(/g) || [];
  assert.equal(reads.length, 1, 'one read call site');
});

test('no em dash in any user-facing text', () => {
  assert.equal(/—/.test(SRC), false);
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
    stale: all.filter((d) => d.faults.length > 0).length,
    unconfirmed: 1
  };
  for (const [key, n] of Object.entries(expect)) {
    CD.state.filter = key;
    assert.equal(CD.visibleDebtors().length, n, key);
    assert.match(text(), /101 open invoices/);
  }
  assert.ok(expect.overdue > 0 && expect.overdue < all.length);
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
  const groups = ['text', 'email', 'note', 'call', 'xero'];
  assert.equal(groups.reduce((a, g) => a + counts[g], 0) + counts.other + counts.facts, counts.all);
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
  assert.match(t, /Xero Invoice raised/);
  assert.match(t, /Preview, cut at 500 characters/);
  assert.match(t, /GHL stored copy, also in captured event/);
  assert.match(t, /1 copy of the same message shown once/);
  assert.match(t, /stored copies only: not a live GHL or Outlook read, and Outlook Sent Items are not captured/);
  assert.match(t, /emails read from inbound copies, sent ones not captured/);
});

test('timeline scope: picking an invoice can narrow the stream to entries touching it', async () => {
  await loaded();
  const d = pick('Debtor 001');
  const inv = d.invoices[1];
  CD.state.invoiceId = inv.xero_invoice_id;
  CD.state.onlyInvoice = true;
  const list = CD.timelineEntries(d);
  assert.ok(list.length > 0);
  assert.ok(list.every((e) => e.invoice_ids.includes(inv.xero_invoice_id)));
  assert.ok(list.length < d.timeline.entries.length);
});

test('truncated, capped and faulted timelines say so; missing sources are named, never "no messages"', async () => {
  const data = await loaded();
  pick('Debtor 002');
  let t = text();
  assert.match(t, /Showing the newest 12 of \d+ stored entries/);
  assert.match(t, /has more than 10 messages; only the newest 10 per job were read/);
  assert.match(t, /This timeline is incomplete: older or capped entries are not in this read/);
  pick('Debtor 004');
  t = text();
  assert.match(t, /ghl_cache: permission denied/);
  assert.match(t, /GHL texts could not be read/);
  assert.match(t, /This timeline is incomplete: a source could not be read/);
  // A debtor with no linked job: empty channels name the missing source.
  const noJob = data.debtors.find((d) => d.link_state.linked === 0);
  CD.state.selectedKey = noJob.key;
  CD.state.tlFilter = 'text';
  t = text();
  assert.match(t, /No texts in the newest \d+ stored copies for this debtor\./);
  assert.match(t, /No invoice on this debtor is linked to a job, so stored GHL texts cannot be read\./);
  for (const d of data.debtors) {
    CD.state.selectedKey = d.key;
    for (const c of CD.TL_CHIPS) {
      CD.state.tlFilter = c.key;
      assert.equal(/no messages/i.test(text()), false, d.key + ' ' + c.key);
    }
  }
});

test('facts: counted, not invented, until the read carries fact entries; then they are timeline entries', async () => {
  await loaded();
  let d = pick('Debtor 001');
  CD.state.tlFilter = 'facts';
  let t = text();
  assert.match(t, /Facts on 4 of 5 invoices\. This read says whether facts exist, not what they say/);
  assert.equal(/data-tl="facts"[^>]*>Facts<span class="count">/.test(html()), false, 'no zero badge while facts are not listed');
  // The CFO desk's later revision: fact entries with value, time, source, state and scope.
  await loaded((data) => {
    const x = data.debtors.find((q) => q.identity.name === 'Debtor 001');
    x.timeline.entries.unshift({ key: 'fact:1', kind: 'fact', channel: null, provider: 'secureworks', at: '2026-09-23T01:00:00.000Z', at_precision: 'time', direction: 'internal', source: 'job_facts', value: 'Synthetic fact value', captured_at: '2026-09-23T01:00:00.000Z', source_id: 'msg-synthetic-1', state: 'stale', job_id: x.invoices[0].link.job_id, invoice_ids: [x.invoices[0].xero_invoice_id], invoice_scope: 'job', seen_in: ['job_facts'], label: 'Promised to pay' },
      { key: 'fact:2', kind: 'fact', provider: 'secureworks', at: null, source: 'job_facts', read_fault: 'facts read failed', invoice_ids: [], seen_in: ['job_facts'] });
    x.sources.ghl.last_success_at = '2026-09-24T01:00:00.000Z';
    x.sources.ghl.stale_after = 6;
    x.sources.ghl.owner = 'CIO';
    x.sources.ghl.recovery_action = 'rerun the GHL reconcile';
  });
  d = pick('Debtor 001');
  CD.state.tlFilter = 'facts';
  t = text();
  assert.match(t, /Promised to pay/);
  assert.match(t, /Synthetic fact value/);
  assert.match(t, /Stale/);
  assert.match(t, /source msg-synthetic-1/);
  assert.match(t, /Could not be read: facts read failed/);
  assert.match(t, /capture time not in the read/);
  CD.state.tlFilter = 'all';
  assert.match(text(), /GHL: bound, last captured 1 hour before this read, stale after 6 hours, owner CIO, fix: rerun the GHL reconcile\./);
  assert.equal(CD.sourceHealthRows(d).length, 1);
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
