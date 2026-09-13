const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const api=require('./ops-sales-performance.js');
const weeks=['2026-08-31','2026-08-24','2026-08-17','2026-08-10'];
function patio(week,leads=4,answered=2){return {lane:'patio',week_start:week,computed_at:'2026-09-07T00:00:00Z',definition_version:'synthetic-v1',run_id:'synthetic',coverage:{collection_complete:true,gaps:['Staffed hours unconfirmed']},metrics:{enquiries_in:leads,speed_to_lead_median_elapsed:6,speed_to_lead_worst_elapsed:12,unanswered_no_reply:1},queues:{answered:Array.from({length:answered},()=>({response_hours:6})),enquiries:[]}};}
function data(rows=[]){return {rows,week_start:weeks[0],week_starts:weeks,available_weeks:weeks,fetched_at:'2026-09-07T01:00:00Z'};}
test('empty rows name both missing lanes and never create zero readings',()=>{const html=api.renderHTML(data(),'week');assert.match(html,/Patio and Fencing has no report/);assert.match(html,/No reading/);assert.match(html,/0 of 4 weeks/);assert.doesNotMatch(html,/undefined|NaN/);});
test('partial lane and stale calendar expectation are independent',()=>{const d=data([patio(weeks[0])]);d.missing_latest_closed_week=true;d.latest_closed_week='2026-09-07';const html=api.renderHTML(d,'week');assert.match(html,/Latest closed week/);assert.match(html,/Fencing has no report/);assert.doesNotMatch(html,/Patio has no report for/);});
test('null and zero remain different; CRM wins never become accepted jobs',()=>{const a=api.adapt({lane:'fencing',metrics:{opportunity_creations_in_week:{count:0},wins_losses:{won:{count:99}}}});assert.equal(a.measures.A1.value,0);assert.equal(a.measures.C2.value,null);assert.equal(a.contacted,null);});
test('rolling counts sum available weeks; rates use summed parts and require four',()=>{const d=data([patio(weeks[0],10,2),patio(weeks[1],2,2)]);assert.deepEqual(api.rolling(d,'patio','A1'),{value:12,n:2});assert.equal(api.rollingContact(d).value,null);d.rows.push(patio(weeks[2],4,1),patio(weeks[3],4,1));assert.equal(api.rollingContact(d).value,30);assert.equal(api.rollingContact(d).denominator,20);});
test('selected week isolates lanes and coverage escapes source text',()=>{const a=patio(weeks[0]);a.coverage.gaps=['<img src=x onerror=alert(1)>'];a.run_id='<script>bad()</script>';const d=data([a,patio(weeks[1],999)]);const html=api.renderHTML(d,'coverage');assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<img|<script>/);assert.match(html,/data-performance-week="2026-08-31" aria-pressed="true"/);});
test('one authenticated opsFetch per requested week and recoverable errors',async()=>{const calls=[];global.opsFetch=async(action,params)=>{calls.push({action,params});return data([]);};await api.load(weeks[0]);assert.deepEqual(calls,[{action:'sales_performance_read',params:{week_start:weeks[0]}}]);global.opsFetch=async()=>{throw new Error('Sign in required');};await api.load(weeks[1]);assert.equal(api.state.error,'Sign in required');assert.equal(api.state.loading,false);});
test('slower old response cannot overwrite selected week',async()=>{let resolveOld;global.opsFetch=(_a,p)=>p.week_start===weeks[0]?new Promise(r=>resolveOld=r):Promise.resolve({...data([]),week_start:weeks[1]});const old=api.load(weeks[0]);await api.load(weeks[1]);resolveOld(data([]));await old;assert.equal(api.state.week,weeks[1]);});
test('host request uses signed-in token and no shared browser key',async()=>{const source=fs.readFileSync(require('node:path').join(__dirname,'../ops.html'),'utf8');const start=source.indexOf('async function opsAuthHeaders(');const end=source.indexOf('\nasync function opsPost',start);const slice=source.slice(start,end);assert.ok(end>start);const ctx={cloud:{auth:{getAccessToken:async()=>'synthetic-staff-token'}},_opsApiBase:'https://invalid.test/ops-api',fetch:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer synthetic-staff-token');assert.match(url,/sales_performance_read&week_start=2026-08-31/);return {ok:true,json:async()=>data([])};}};vm.createContext(ctx);vm.runInContext(slice,ctx);await ctx.opsFetch('sales_performance_read',{week_start:weeks[0]});});
module.exports={data,patio,weeks};
test('desktop and mobile nav, restore and module load use the same view',()=>{const s=fs.readFileSync(require.resolve('../ops.html'),'utf8');assert.equal((s.match(/data-view="sales"/g)||[]).length,2);assert.equal((s.match(/id="viewSales"/g)||[]).length,1);assert.match(s,/id="salesPerformanceRoot"/);assert.match(s,/SalesWorkspace.show\(salesTab\)/);assert.match(s,/'materials', 'performance', 'booking', 'sales', 'inbox'/);assert.ok(s.indexOf('modules/ops-sales-performance.js')<s.indexOf('function showView('));});
test('opening synthesises available measures with distinct population wording',()=>{const f={lane:'fencing',week_start:weeks[0],metrics:{opportunity_creations_in_week:{count:8},quality_review:{reply_time_hours:{substantive_non_template:{median:7,max:20,n:3}},unanswered_inbound:{still_open:2}},quotes:{sent_this_week_with_document_evidence:{count:3,amount_inc_sum:1234}}},queues:{}};const html=api.renderHTML(data([patio(weeks[0]),f]),'week');const opening=html.split('<div class="lede">')[1].split('</div>')[0];assert.match(opening,/7 h/);assert.match(opening,/\$1,234/);assert.match(opening,/reviewed population/);assert.match(html,/2 h target/);assert.match(html,/Tier B/);assert.doesNotMatch(html,/<select/);});
test('unanswered distributions require retained ages, and threshold cannot be inferred from count',()=>{const p=patio(weeks[0]);p.queues.unanswered_no_reply=[{name:'Synthetic enquiry',unanswered_age_hours:31}];const f={lane:'fencing',week_start:weeks[0],metrics:{quality_review:{unanswered_inbound:{still_open:2}}},queues:{quality_cases:[{unanswered_inbound:[{still_open:true,staffed_hours_waiting:25},{still_open:true,staffed_hours_waiting:5}]}]}};let html=api.renderHTML(data([p,f]),'week');assert.match(html,/31 h/);assert.match(html,/1 are beyond 24 staffed hours; 1 are within it/);f.queues.quality_cases=[];html=api.renderHTML(data([p,f]),'week');assert.match(html,/Open \/ over-threshold distribution unavailable/);assert.doesNotMatch(html,/1 are beyond 24 staffed hours/);});
test('patio raw arrivals are not qualified enquiries or quote zeros',()=>{
  const a=api.adapt({lane:'patio',metrics:{raw_arrivals:17,enquiries_in:null,quotes_sent:null,unanswered_no_reply:4},coverage:{collection_complete:false},queues:{}});
  assert.equal(a.measures.A1.value,17);
  assert.match(a.measures.A1.sub,/qualified eligible unmeasured/);
  assert.equal(a.measures.C1.value,null);
  assert.equal(a.measures.C2.value,null);
});
test('quote follow-up queue is not C1 document sends',()=>{
  const follow=Array.from({length:213},(_,i)=>({id:'q'+i}));
  const a=api.adapt({lane:'fencing',metrics:{opportunity_creations_in_week:{count:27}},queues:{quote_followup_queue:follow}});
  assert.equal(a.measures.C1.value,null);
  assert.equal(a.measures.C1.queueKey,'quotes');
  assert.equal(a.measures.Q.value,213);
  assert.equal(a.measures.Q.queueKey,'quote_followup_queue');
  const html=api.renderHTML(data([{lane:'fencing',week_start:weeks[0],metrics:{opportunity_creations_in_week:{count:27}},queues:{quote_followup_queue:follow}}]),'week');
  assert.match(html,/Quote follow-up/);
  assert.match(html,/not document-proven sends/);
});
test('unpublished rows populate the selected week without replacing stored rows',()=>{
  const stored={lane:'fencing',week_start:'2026-08-31',metrics:{opportunity_creations_in_week:{count:27}},queues:{quote_followup_queue:[{id:'old'}]}};
  const unpublished={lane:'patio',week_start:'2026-09-07',metrics:{enquiries_in:14,unanswered_no_reply:4,speed_to_lead_median_elapsed:56.6},coverage:{collection_complete:false,gaps:['partial']},queues:{unanswered_no_reply:[{unanswered_age_hours:40}]}};
  const d={rows:[stored],unpublished_rows:[unpublished],week_start:'2026-09-07',week_starts:['2026-09-07','2026-08-31','2026-08-24','2026-08-17'],fetched_at:'2026-09-13T00:00:00Z'};
  const html=api.renderHTML(d,'week');
  assert.match(html,/14/);
  assert.match(html,/Fencing has no report/);
});
const detail=require('./ops-sales-performance-detail.js');
test('detail C1 does not open the 213 follow-up records',()=>{
  const row={lane:'fencing',metrics:{period:['2026-08-31T00:00:00+08:00','2026-09-07T00:00:00+08:00']},queues:{quote_followup_queue:Array.from({length:213},(_,i)=>({id:i}))}};
  const c1=detail.evidence({lane:'fencing',measure:'C1',queueKey:'quotes',row});
  assert.equal(c1.available,false);
  assert.equal(c1.rows.length,0);
  assert.match(c1.scope,/different population/);
  const q=detail.evidence({lane:'fencing',measure:'Q',queueKey:'quote_followup_queue',row});
  assert.equal(q.available,true);
  assert.equal(q.rows.length,213);
  assert.match(q.scope,/not C1/);
});
