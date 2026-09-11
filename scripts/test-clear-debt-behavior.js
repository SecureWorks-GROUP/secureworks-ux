const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('modules/ops-clear-debt-v2.js', 'utf8');
const elements = new Map();
const el = id => { if (!elements.has(id)) elements.set(id, { innerHTML: '', style: {}, value: '' }); return elements.get(id); };
const calls = [];
const c = { document: { getElementById: el, querySelector: () => null, head: {appendChild(){}}, createElement: () => ({}) }, window: {scrollTo(){}}, console, opsFetch: async () => ({}), opsPost: async (...args) => { calls.push(args); return {}; }, showToast(){}, confirm: () => true };
vm.createContext(c); vm.runInContext(source, c);
const invoice = (id, extra = {}) => ({xero_invoice_id:id, invoice_number:'INV-'+id, xero_contact_id:'payer', contact_name:'Sample Company', amount_due:100, days_overdue:10, debt_classification:'genuine_debt', debt_type:'deposit', debt_owner:'DEBT', debt_classification_reason:'Delivered and unpaid', debt_next_action:'Prepare proposal', ...extra});
async function main() {
  c.CD.rows = [invoice('a'),invoice('b')]; c.CD.coverageAsOf='2026-09-11T00:00:00Z'; c.CD.coverage={a:{complete:true}};
  c.cdRender(); assert.match(el('clearDebtStats').innerHTML,/1 of 2/,'omitted coverage row must be incomplete');
  c.CD.coverage={a:{blockers:[]},b:{blockers:['facts_missing']}}; c.cdRender(); assert.match(el('clearDebtStats').innerHTML,/1 of 2/);
  const P=c.cdGroups().chase.subs[0].payers[0];
  const failed=c.cdRecordHtml(P,{}, {},null,'unavailable');
  assert.doesNotMatch(failed,/No payments allocated|No job linked to this invoice|No stored messages/,'failed read is not absence');
  assert.match(failed,/Marnin/); assert.doesNotMatch(failed,/Send text|Send invoice email/);
  assert.doesNotMatch(source,/send_chase_sms|send_invoice_email/,'screen cannot bypass individual terminal approval');
  assert.match(c.cdBriefHtml(invoice('a',{debt_brief:{promised:'Recorded scope',review_required:true,context_blockers:[{code:'bank_receipt_unverified',owner:'BOOKKEEPING',detail:'Receipt check pending'}]}}),null),/BOOKKEEPING: bank_receipt_unverified/);
  const ctx={invoice:{},job:null,conversation:{last_client_message:{at:'2026-09-11T00:00:00Z',preview:'Please check my receipt',channel:'email'},messages:[]},bank:{xero_payments:[]},sources:{conversation:{ok:true},job:{ok:true},invoice:{ok:true}},blockers:[]};
  assert.match(c.cdRecordHtml(P,{}, {},ctx,null),/Please check my receipt/,'door last client message must be visible');
  c.CD.seg='chase'; c.CD.open='deposit|payer'; c.cdSelectInvoice('b');
  assert.equal(c.cdLead(c.cdOpenPayer().P).xero_invoice_id,'b','each invoice has independent context');
  // A delayed invoice read cannot overwrite a newer invoice selection.
  let resolve; c.CD.ctx={}; c.CD.selectedInvoice='a'; c.opsFetch=async (action, args) => action==='invoice_context' && args.xero_invoice_id==='a' ? new Promise(r=>{resolve=r;}) : action==='debt_notes'?{thread:[]}:{...ctx,conversation:{...ctx.conversation,last_client_message:{preview:'Invoice B context'}}};
  const first=c.cdLoadRecord(); c.CD.selectedInvoice='b'; await c.cdLoadRecord(); resolve({...ctx,conversation:{...ctx.conversation,last_client_message:{preview:'Stale invoice A context'}}}); await first;
  assert.match(el('cd-rec-body').innerHTML,/Invoice B context/); assert.doesNotMatch(el('cd-rec-body').innerHTML,/Stale invoice A/);
  c.CD.ctx={}; c.opsFetch=async action=>{if(action==='debt_notes') throw Error('notes offline'); return ctx;}; await c.cdLoadRecord(); assert.match(el('cd-rec-body').innerHTML,/Notes unavailable/);
  console.log('PASS clear-debt behavior: coverage omissions, source failures, last client context, per-invoice selection, stale reads, notes errors, no sends');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
