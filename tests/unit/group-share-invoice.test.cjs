const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(response, submit) {
  let click; const calls=[]; const msg={}; const controls=[];
  const card={appendChild(x){controls.push(x);}};
  const slot={attrs:{'data-group-wo-slot':'job'},innerHTML:'',getAttribute(k){return this.attrs[k]},setAttribute(k,v){this.attrs[k]=v},querySelector(k){return k==='[data-group-wo]'?card:k==='[data-group-wo-msg]'?msg:k==='[data-group-wo-gst]'?{checked:true}:null}};
  const document={addEventListener(_,fn){click=fn},querySelectorAll(){return [slot]},getElementById(){return {}},createElement(){return {innerHTML:'',setAttribute(){},querySelector(){return {checked:false}}}}};
  const window={GroupWorkOrderCore:{switchOn(){return true},isOff(){return false},tradeMode(){return 'share'},tradeHtml(){return '<card>'}}};
  vm.runInNewContext(fs.readFileSync('modules/trade-group-work-order.js','utf8'),{window,document,Promise,Error,Number,String});
  window.GroupWorkOrderTrade.use((action,params,body)=>{calls.push({action,body});return action==='group_work_order_my_share'?Promise.resolve(response):submit(action,body)});
  window.GroupWorkOrderTrade.arm({});
  return {slot,msg,calls,controls,paint:()=>window.GroupWorkOrderTrade.paint('job'),click(action){const btn={disabled:false,getAttribute(){return action},closest(){return slot}};click({target:{closest(){return btn}}});}};
}
const frozen={group_id:'group',awaiting:'frozen',my_share:123,client_signed:true,group_share_office_review_required:true};
const settle=()=>new Promise(r=>setImmediate(r));
test('old backend cannot offer or submit invoice',async()=>{const s=setup({...frozen,group_share_office_review_required:false},()=>{throw Error('unexpected')});await s.paint();s.click('invoice');assert.equal(s.calls.length,1);assert.equal(s.controls.length,0)});
test('own server-priced share submits once for review with explicit GST',async()=>{let resolve;const s=setup(frozen,()=>new Promise(r=>resolve=r));await s.paint();s.click('invoice');s.click('invoice');assert.equal(s.calls.length,2);assert.deepEqual(JSON.parse(JSON.stringify(s.calls[1])),{action:'generate_trade_invoice',body:{extra_items:[{type:'group share',group_id:'group'}],gst_on:true}});resolve({success:true,invoice_id:'inv',office_review:'held',xero_bill_id:null});await settle();assert.match(s.msg.textContent,/saved for office review/);s.click('invoice');assert.equal(s.calls.length,2)});
test('lost invoice response does not invite another submission',async()=>{const s=setup(frozen,()=>Promise.reject(Error('network')));await s.paint();s.click('invoice');await settle();assert.match(s.msg.textContent,/office check/);s.click('invoice');assert.equal(s.calls.length,2)});
test('missing signoff cannot freeze or invoice',async()=>{const s=setup({...frozen,awaiting:'awaiting_signoff',client_signed:false},()=>{throw Error('unexpected')});await s.paint();s.click('freeze');s.click('invoice');assert.equal(s.calls.length,1)});
test('ready split freezes only on explicit click and rereads server',async()=>{const s=setup({...frozen,awaiting:'ready'},()=>Promise.resolve({awaiting:'frozen'}));await s.paint();assert.equal(s.calls.length,1);s.click('freeze');await settle();assert.equal(s.calls[1].action,'freeze_group_work_order');assert.equal(s.calls[2].action,'group_work_order_my_share')});
