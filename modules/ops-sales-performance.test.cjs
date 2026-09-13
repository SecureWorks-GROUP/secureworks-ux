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

/* Fencing Stratco week panel, the filed read of 20:04 Perth, 13 Sep 2026. */
const stratco=require('./ops-fencing-stratco-week.js');
const filed=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../docs/evidence/fencing-stratco-week-2026-09-13/stratco-week-filed-read.json'),'utf8'));
test('the panel states the four Stratco-week numbers the filed read published',()=>{
  const html=stratco.renderPerformanceHTML(null);
  assert.deepEqual(stratco.counts().map(c=>[c.key,c.value]),[['visits_agreed',8],['in_calendar',6],['initial_booking_threads_unanswered',5],['agreed_versus_calendar_breaches',2]]);
  ['Visits agreed','In calendar','Booking threads unanswered','Agreed versus calendar breaches'].forEach(label=>assert.ok(html.includes(label),label));
  assert.match(html,/Week of Monday 14 September 2026/);
  assert.doesNotMatch(html,/undefined|NaN/);
});
test('the checked-in module never drifts from the checked-in evidence file',()=>{
  assert.deepEqual(stratco.FILED.counts,filed.counts);
  assert.equal(stratco.FILED.week_start,filed.week_start);
  assert.equal(stratco.FILED.read_iso,filed.read_clock.perth_local);
  assert.equal(stratco.FILED.move_cancel_tool_present,filed.move_cancel_tool_present);
  assert.deepEqual(stratco.FILED.breaches.map(b=>[b.stratco_ref,b.event_id,b.calendar_start,b.agreed_start]),filed.breaches.map(b=>[b.stratco_ref,b.event_id,b.calendar_start,b.agreed_start]));
  assert.deepEqual(stratco.FILED.stratco_events.map(e=>e.event_id),filed.stratco_events.map(e=>e.event_id));
  assert.deepEqual(stratco.FILED.unmeasured.map(u=>u.key),filed.unmeasured.map(u=>u.key));
});
test('every number carries the read time and its evidence file, and no live claim is made',()=>{
  const html=stratco.renderPerformanceHTML(null);
  const stamps=html.split('Filed read 20:04 Perth, Sunday 13 September 2026').length-1;
  assert.equal(stamps,stratco.counts().length);
  assert.equal(html.split('docs/evidence/fencing-stratco-week-2026-09-13/stratco-week-filed-read.json').length-1,stratco.counts().length+1);
  assert.match(html,/Filed read, not live/);
  assert.match(html,/No live calendar read in this copy/);
  assert.match(html,/Calendar writes 0\. SMS sent 0\. Customer contact none\./);
});
test('a figure with no evidence reads unmeasured, never zero',()=>{
  const html=stratco.renderPerformanceHTML(null);
  assert.match(html,/Khairo.s own Stratco calendar:<\/b> unmeasured/);
  assert.match(html,/Which 2 agreed visits have no event at all:<\/b> unmeasured/);
  assert.equal(stratco.FILED.unmeasured.every(u=>u.reason && u.reason.length>10),true);
  const unmeasuredFigure=stratco.renderPerformanceHTML.call(null,null);
  assert.doesNotMatch(unmeasuredFigure,/<span class="fsw-n">0<\/span>/);
});
test('a live read that agrees is reported as agreeing; one that differs is named, not smoothed',()=>{
  const live=filed.stratco_events.map(e=>({event_id:e.event_id,start_iso:e.start,end_iso:e.end}));
  const agrees=stratco.reconcile(live);
  assert.equal(agrees.has_live,true);
  assert.equal(agrees.rows.filter(r=>r.status==='agrees').length,6);
  assert.match(agrees.summary,/6 of 6 filed Stratco events are confirmed unchanged/);
  const moved=live.map((e,i)=>i===0?{...e,start_iso:'2026-09-16T09:00:00',end_iso:'2026-09-16T10:00:00'}:e);
  const drift=stratco.reconcile(moved);
  assert.equal(drift.rows[0].status,'moved');
  assert.match(drift.rows[0].note,/Live read differs\. Filed Tuesday 15 September 08:30 to 09:30\. Live Wednesday 16 September 09:00 to 10:00\./);
  const absent=stratco.reconcile([]);
  assert.equal(absent.rows.every(r=>r.status==='absent'),true);
  assert.match(stratco.reconcile(null).summary,/No live calendar read in this copy/);
});
test('the panel names both breaches with full event ids and no desk fix',()=>{
  const html=stratco.renderPerformanceHTML(null);
  assert.match(html,/<b>Woodlands 231399\.<\/b> Wrong day and wrong time\. The customer agreed Friday 18 September 08:30\./);
  assert.match(html,/<b>Balga 231211\.<\/b> Fifteen minutes early\. The customer agreed 11:30\./);
  filed.breaches.forEach(b=>assert.ok(html.includes(stratco.escape(b.event_id)),b.stratco_ref));
  assert.match(html,/no move or cancel action for a scope event/);
  assert.match(html,/the captain.s call/);
});
test('no captain-facing Stratco copy carries an em dash and no client identity leaks',()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'ops-fencing-stratco-week.js'),'utf8');
  const evidence=fs.readFileSync(require('node:path').join(__dirname,'../docs/evidence/fencing-stratco-week-2026-09-13/stratco-week-filed-read.json'),'utf8');
  [source,evidence,stratco.renderPerformanceHTML(null),stratco.flagsHTML('2026-09-14','marnin',null)].forEach(text=>{
    assert.doesNotMatch(text,/—/);
    ['Lawrence Guo','Oliver Parks','Gareth Chapman','Bruce Reidy-Crofts','Melanie Nouchy','Basil Laing','Granich Gardens','Framfield Way','Martin Place','Providence Drive'].forEach(pii=>assert.equal(text.includes(pii),false,pii));
  });
});
