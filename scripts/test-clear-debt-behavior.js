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
  const gaps = [{code:'job_unavailable',owner:'CIO',detail:'Job source lookup failed'}, {code:'conversation_unavailable',owner:'CIO',detail:'Conversation source lookup failed'}];
  const gapsHtml = c.cdRecordHtml(P, {}, {}, {...ctx, blockers:gaps}, null);
  for (const gap of gaps) assert.equal(gapsHtml.split(gap.detail).length - 1, 1, 'each source gap appears once');

  c.opsFetch=async action => action==='debt_notes' ? {thread:[]} : ctx;
  c.cdSelectInvoice('a'); await c.cdLoadRecord();
  let finishNote;
  c.opsPost=async (action, args) => { calls.push([action,args]); return new Promise(resolve => {finishNote=resolve;}); };
  el('cd-note').value='Internal note for A';
  const savingNote=c.cdAddNote('a');
  c.cdSelectInvoice('b'); await c.cdLoadRecord();
  el('cd-sms').value='Unsaved proposal for B'; el('cd-sms-to').value='0400000000';
  const generation=c.CD.recordRequest, body=el('cd-rec-body').innerHTML;
  finishNote({thread:[{text:'Internal note for A'}]}); await savingNote;
  assert.equal(c.CD.recordRequest,generation,'stale note completion must not redraw the selected invoice');
  assert.equal(el('cd-rec-body').innerHTML,body);
  assert.equal(el('cd-sms').value,'Unsaved proposal for B');
  assert.equal(c.CD.notes.a[0].text,'Internal note for A');

  c.opsPost=async (action,args) => {calls.push([action,args]); return {status:'pending'};};
  await c.cdSaveProposal('b','sms',{});
  assert.equal(c.CD.rows[1].debt_proposal_status,'pending');
  assert.equal(c.CD.rows[1].debt_proposal_text,'Unsaved proposal for B');
  el('cd-email').value='Subject: receipt check. Please confirm receipt.'; el('cd-email-to').value='sample@example.test';
  await c.cdSaveProposal('b','email',{});
  assert.equal(c.CD.rows[1].debt_proposal_kind,'email');
  assert.equal(c.CD.rows[1].debt_proposal_status,'pending');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['add_debt_note',{xero_invoice_id:'a',note:'Internal note for A',tag:null}],
    ['debt_proposal_save',{xero_invoice_id:'b',kind:'sms',text:'Unsaved proposal for B',to:'0400000000'}],
    ['debt_proposal_save',{xero_invoice_id:'b',kind:'email',text:'Subject: receipt check. Please confirm receipt.',to:'sample@example.test'}]
  ], 'note and proposal interactions must only use their authorized endpoints, without sends or approvals');
  console.log('PASS clear-debt behavior: coverage, source gaps, selection, stale reads and note saves, pending proposals, no sends');

}
main().catch(e=>{console.error(e);process.exitCode=1;});
