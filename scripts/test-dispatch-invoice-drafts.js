// Actual shipped Dispatch billing controller with captured transports; no providers or sends.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('modules/ops-dispatch.js', 'utf8');
const job = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const claimId = '00000000-0000-4000-8000-000000000003';
function boot() {
  const calls = [];
  let claims = [], reviews = [], post = { ok: true }, wrongJob = false, unreadable = false;
  const env = { document: { getElementById: () => null, querySelector: () => null },
    localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null }, setTimeout, clearTimeout,
    opsFetch: async (action, params) => {
      calls.push({ method: 'GET', action, params });
      if (unreadable) throw new Error('offline');
      return { ok: true, job_id: wrongJob ? other : params.job_id,
        ...(action === 'invoice_milestone_drafts' ? { drafts: claims } : { reviews }) };
    },
    opsPost: async (action, body) => { calls.push({ method: 'POST', action, body }); if (post instanceof Error) throw post; return post; },
  };
  env.window = env;
  vm.runInNewContext(source.replace('global.OpsDispatch = {',
    'global.billingCheck={state:state,html:invoiceDraftsHtml,read:loadInvoiceDrafts,act:actInvoiceDrafts};global.OpsDispatch = {'), env);
  const api = env.billingCheck;
  api.state.jobId = job;
  return { api, calls, set: (next) => { ({ claims = claims, reviews = reviews, post = post, wrongJob = wrongJob, unreadable = unreadable } = next); } };
}
(async () => {
  let groups = 0;
  const { api, calls, set } = boot();
  assert.match(api.html(), /Check billing records/);
  assert.equal(calls.length, 0); groups++;
  set({ reviews: [{ job_id: job, trigger_kind: 'scheduled', hold_reasons: ['previous_revision_invoice_claim_requires_review', 'existing_invoice_requires_review', 'invoice_inventory_unavailable'] }] });
  await api.read(job);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.method === 'GET' && c.params.job_id === job));
  assert.match(api.html(), /held requests, not invoices or debts/);
  assert.match(api.html(), /Prepare eligible draft/); groups++;
  assert.match(api.html(), /Recorded preparation check/);
  assert.match(api.html(), /earlier accepted revision/);
  assert.match(api.html(), /existing invoices could not all be confirmed/);
  set({ claims: [{ id: claimId, job_id: job, state: 'unknown', label: '<unsafe>' }] });
  await api.read(job);
  const unknown = api.html();
  assert.match(unknown, /Outcome unknown/); assert.match(unknown, /Check existing invoice/);
  assert.ok(!unknown.includes('<unsafe>')); assert.ok(!unknown.includes('data-dpc-billing-process'));
  const before = calls.length;
  await api.act('process'); assert.equal(calls.length, before); groups++;
  await api.act('reconcile', claimId);
  const writes = calls.filter((c) => c.method === 'POST');
  assert.equal(writes.length, 1); assert.equal(writes[0].action, 'invoice_milestone_drafts');
  assert.equal(writes[0].body.mode, 'reconcile'); assert.equal(writes[0].body.claim_id, claimId);
  assert.ok(!JSON.stringify(writes).includes('send_email')); groups++;
  set({ claims: [{ id: claimId, job_id: job, state: 'draft_confirmed', label: 'Accepted payment', provider_invoice_id: claimId }] });
  await api.read(job);
  assert.match(api.html(), /Draft creation confirmed/); assert.match(api.html(), /current issue and send status/);
  assert.match(api.html(), /Open invoice PDF/); assert.match(api.html(), /Original booking and council reviews/);
  assert.ok(!api.html().includes('data-dpc-billing-process')); groups++;
  set({ claims: [], post: new Error('provider reply lost') });
  await api.read(job); await api.act('process');
  assert.match(api.html(), /outcome is unconfirmed/); assert.ok(!api.html().includes('data-dpc-billing-process'));
  const afterFailure = calls.length; await api.act('process'); assert.equal(calls.length, afterFailure); groups++;
  set({ wrongJob: true }); await api.read(job);
  assert.match(api.html(), /Could not confirm billing records/); groups++;
  set({ wrongJob: false, unreadable: true }); await api.read(job);
  assert.match(api.html(), /no unpaid balance is inferred/); groups++;
  set({ unreadable: false, post: { ok: true }, claims: [{ job_id: other, state: 'draft_confirmed' }] });
  await api.read(job); assert.match(api.html(), /Could not confirm billing records/); groups++;
  api.state.jobId = other;
  assert.ok(!api.html().includes('Draft creation confirmed')); groups++;
  assert.ok(calls.every((c) => c.action === 'invoice_milestone_drafts' || c.action === 'invoice_milestone_reviews'));
  console.log(`PASS ${groups} billing controller groups; exact jobs, read-only open, unknown outcome hold, reconciliation and no sends`);
})().catch((err) => { console.error(err); process.exitCode = 1; });
