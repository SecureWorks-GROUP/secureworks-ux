/* Stored weekly desk reports. Presentation only; no collector or business writes. */
(function (global) {
  'use strict';
  const lanes = ['patio', 'fencing'];
  const titles = {patio: 'Patio', fencing: 'Fencing'};
  const state = {data: null, week: null, section: 'week', loading: false, error: null, request: 0};
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const get = (obj, path) => path.split('.').reduce((v, key) => v && v[key], obj);
  const fmt = value => num(value) === null ? 'No reading' : value.toLocaleString('en-AU', {maximumFractionDigits: 2});
  const money = value => num(value) === null ? 'value not published' : '$' + fmt(value);
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(value + 'T00:00:00+08:00').toLocaleDateString('en-AU', {timeZone:'Australia/Perth', day:'numeric', month:'short', year:'numeric'}) : 'No week stored';
  const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-AU', {timeZone:'Australia/Perth', day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) + ' Perth' : 'Not available';
  const specs = [
    ['A1','Leads in','New enquiries / opportunity creations','enquiries'],
    ['A2','Speed to first contact','First inbound to substantive human reply','answered'],
    ['A3','Unanswered','Still open and answered late remain separate','unanswered_no_reply'],
    ['A4','Activity','Outbound activity by channel','activity'],
    ['B1','Scopes booked','Agreed visits with time and address','scopes_booked'],
    ['B2','Scopes done','Attendance evidence required','scopes_done'],
    ['B3','Stage vs calendar disagree','Board and calendar contradictions','hygiene'],
    ['C1','Quotes sent','Document send evidence in the week','quotes'],
    ['C2','Won','Accepted jobs with an acceptance stamp','cash_chain'],
    ['C3','Deposited','Deposit raised and paid are separate','cash_chain'],
    ['C4','Invoiced vs sold','Final invoices against quoted value','invoiced'],
    ['H','Pipeline hygiene','Contradictions for human review','hygiene'],
    ['R','Receivables','Overdue snapshot; not cash received','fencing_overdue']
  ];
  function adapt(row) {
    const m = row && row.metrics || {}, q = row && row.queues || {}, lane = row && row.lane;
    const patio = lane === 'patio';
    const value = path => num(get(m,path));
    const elapsed = patio ? {median:value('speed_to_lead_median_elapsed'),max:value('speed_to_lead_worst_elapsed'),n:Array.isArray(q.answered)?q.answered.length:null} : get(m,'quality_review.reply_time_hours.substantive_non_template') || {};
    const staffed = patio ? {median:value('speed_to_lead_median_staffed'),max:value('speed_to_lead_worst_staffed'),n:null} : get(m,'quality_review.reply_time_staffed_hours.substantive_non_template') || {};
    const measures = {
      A1:{value:patio?value('enquiries_in'):value('opportunity_creations_in_week.count'),sub:patio?'eligible enquiries':'opportunity creations; eligibility unmeasured',queueKey:patio?'enquiries':null},
      A2:{value:num(elapsed.median),sub:'hours median · elapsed',queueKey:patio?'answered':'quality_cases'},
      A3:{value:patio?value('unanswered_no_reply'):value('quality_review.unanswered_inbound.still_open'),sub:patio?'enquiry cohort · no human reply at run time':'customer texts still open · reviewed population',queueKey:patio?'unanswered_no_reply':'quality_cases'},
      A4:{value:null,sub:'Complete weekly activity not published'},
      B1:{value:patio?value('scopes_booked'):null,sub:'Booking evidence not published'},
      B2:{value:patio?value('scopes_done'):null,sub:'Attendance evidence not published'},
      B3:{value:null,sub:'Calendar comparison not published'},
      C1:{value:patio?value('quotes_sent'):value('quotes.sent_this_week_with_document_evidence.count'),sub:patio?'Quote send evidence not published':'document-evidenced sends · '+money(value('quotes.sent_this_week_with_document_evidence.amount_inc_sum')),queueKey:'quotes'},
      C2:{value:null,sub:'Weekly accepted-job measure not published'},
      C3:{value:null,sub:'Weekly deposit payment evidence not published'},
      C4:{value:patio?value('invoiced_value'):null,sub:'Final invoice comparison not published'},
      H:{value:null,sub:'Named contradictions; no combined rate',queueKey:'hygiene'},
      R:{value:patio?null:value('receivables.fencing_swf_overdue_count'),sub:patio?'Overdue snapshot not published':'overdue invoices · '+money(value('receivables.fencing_swf_overdue_total'))+' · synced '+time(get(m,'receivables.last_synced_at')),queueKey:patio?null:'fencing_overdue'}
    };
    return {row,m,q,lane,elapsed,staffed,measures,contacted:patio && row.coverage && row.coverage.collection_complete === true && Array.isArray(q.answered)?q.answered.length:null};
  }
  function rowsFor(data,week) { return lanes.map(lane => (data.rows || []).find(r => r.week_start === week && r.lane === lane) || null); }
  function rolling(data,lane,key) {
    const weeks = (data.week_starts || []).slice(0,4);
    const readings = weeks.map(week => (data.rows || []).find(r=>r.week_start===week && r.lane===lane)).filter(Boolean).map(adapt);
    const values = readings.map(r=>r.measures[key].value).filter(v=>num(v)!==null);
    return {value:values.length?values.reduce((a,b)=>a+b,0):null,n:values.length};
  }
  function rollingContact(data) {
    const rows = (data.rows || []).filter(r=>r.lane==='patio' && (data.week_starts || []).includes(r.week_start)).map(adapt);
    const parts = rows.filter(r=>num(r.measures.A1.value)!==null && num(r.contacted)!==null);
    const denominator = parts.reduce((s,r)=>s+r.measures.A1.value,0), numerator=parts.reduce((s,r)=>s+r.contacted,0);
    return {n:parts.length,numerator,denominator,value:parts.length===4 && denominator>0?100*numerator/denominator:null};
  }
  function drill(lane,key,row,extra) {
    return ' data-performance-drill="'+esc(key)+'" data-lane="'+lane+'"'+(extra || '');
  }
  function cell(a,key) {
    const v=a.measures[key];
    return '<button class="cellbtn '+(num(v.value)===null?'none':'')+'"'+drill(a.lane,key,a.row)+'><span class="v">'+(num(v.value)===null?'—':fmt(v.value))+'</span><span class="u">'+esc(a.row?v.sub:'No report for this lane and week')+'</span></button>';
  }
  function funnel(as) {
    const stages=[['Leads','A1'],['Contacted','contacted'],['Visits','B1'],['Quotes','C1'],['Won','C2'],['Deposited','C3']];
    const values=as.flatMap(a=>stages.map(s=>s[1]==='contacted'?a.contacted:a.measures[s[1]].value));
    const max=Math.max(1,...values.filter(v=>num(v)!==null));
    return '<div class="funnel-head"><span>Patio</span><span></span><span>Fencing</span></div>'+stages.map(([label,key])=>'<div class="funnel-row">'+as.map((a,i)=>{
      const v=key==='contacted'?a.contacted:a.measures[key].value;
      const reason=!a.row?'No lane report':key==='contacted'?'Different population / not published':a.measures[key].sub;
      const bar='<button class="funnel-cell '+a.lane+'"'+drill(a.lane,key==='contacted'?'A2':key,a.row)+'><span class="bar-track"><span class="bar '+(num(v)===null?'stub':'')+'" style="width:'+(num(v)===null?4:Math.max(0,v/max*100))+'%">'+(num(v)===null?'':'<span class="funnel-value">'+fmt(v)+'</span>')+'</span></span><span class="funnel-sub">'+esc(num(v)===null?reason:key==='A1'?a.measures.A1.sub:key==='C1'?a.measures.C1.sub:'')+'</span></button>' ;
      return i===0?bar+'<span class="funnel-stage">'+label+'</span>':bar;
    }).join('')+'</div>').join('');
  }
  function speed(as) {
    const max=Math.max(2,...as.flatMap(a=>[num(a.elapsed.max),num(a.staffed.max),num(a.elapsed.median),num(a.staffed.median)]).filter(v=>v!==null));
    const pct=v=>Math.max(0,Math.min(100,v/max*100));
    const ticks=Array.from({length:5},(_,i)=>'<span style="left:'+i*25+'%">'+fmt(max*i/4)+'</span>').join('');
    return '<p class="target-key">2 h target · both clocks shown separately</p>'+as.map(a=>['elapsed','staffed'].map(clock=>{
      const r=a[clock], med=num(r.median), worst=num(r.max);
      const pts=clock==='elapsed' && Array.isArray(a.q.answered)?a.q.answered.map(x=>num(x.response_hours)).filter(v=>v!==null):[];
      return '<button class="speed-row"'+drill(a.lane,'A2',a.row)+'><span class="speed-label"><b>'+titles[a.lane]+'</b><small>'+clock+' clock'+(num(r.n)!==null?' · n '+fmt(r.n):'')+'</small></span><span class="speed-plot"><span class="speed-summary">'+(med===null?'No '+clock+' reading published':'<strong>'+fmt(med)+' h</strong> median <span>'+fmt(worst)+' h worst</span>')+'</span><span class="speed-axis"><i class="target-line" style="left:'+pct(2)+'%"></i>'+[0,25,50,75,100].map(t=>'<i class="grid-tick" style="left:'+t+'%"></i>').join('')+(med===null?'':'<i class="speed-range '+a.lane+'" style="left:'+pct(med)+'%;width:'+Math.max(0,pct(worst===null?med:worst)-pct(med))+'%"></i>'+pts.map(v=>'<i class="speed-dot '+a.lane+'" style="left:'+pct(v)+'%"></i>').join('')+'<i class="median-dot '+a.lane+'" style="left:'+pct(med)+'%"></i>'+(worst===null?'':'<i class="worst-tick '+a.lane+'" style="left:'+pct(worst)+'%"></i>'))+'</span><span class="speed-ticks">'+ticks+'</span></span></button>';
    }).join('')).join('')+'<p class="axis-unit">Hours · one shared scale</p>';
  }
  function unanswered(a) {
    let distribution='';
    if(a.lane==='patio') {
      const queue=a.q.unanswered_no_reply;
      const ages=Array.isArray(queue)?queue.filter(r=>num(r.unanswered_age_hours)!==null):[];
      const max=Math.max(24,...ages.map(r=>r.unanswered_age_hours));
      distribution=ages.length?'<div class="age-bars">'+ages.map((r,i)=>'<button class="age-row"'+drill(a.lane,'A3',a.row)+'><span>'+esc(r.name || 'Enquiry '+(i+1))+'</span><span class="age-track"><i style="width:'+r.unanswered_age_hours/max*100+'%"></i></span><b>'+fmt(r.unanswered_age_hours)+' h</b></button>').join('')+'</div><p class="card-note">Elapsed hours since first inbound; '+ages.length+' of '+fmt(a.measures.A3.value)+' open enquiries have a retained age. Staffed-hour breaches are not published.</p>':'<p class="distribution-gap">Customer-age distribution unavailable: this report has no retained unanswered enquiry ages.</p>';
    } else {
      const cases=a.q.quality_cases;
      const opens=Array.isArray(cases)?cases.flatMap(c=>Array.isArray(c.unanswered_inbound)?c.unanswered_inbound.filter(u=>u.still_open===true):[]):[];
      const known=opens.filter(u=>num(u.staffed_hours_waiting)!==null);
      const total=a.measures.A3.value;
      if(num(total)!==null && opens.length===total && known.length===total && total<=200) {
        const breach=known.filter(u=>u.staffed_hours_waiting>24).length;
        distribution='<div class="unit-grid" aria-label="'+total+' open texts, '+breach+' beyond 24 staffed hours">'+known.map(u=>'<i class="'+(u.staffed_hours_waiting>24?'over':'')+'"></i>').join('')+'</div><p class="card-note">One square per open customer text. '+breach+' are beyond 24 staffed hours; '+(total-breach)+' are within it.</p>';
      } else distribution='<p class="distribution-gap">Open / over-threshold distribution unavailable: retained staffed ages do not cover every published open text.</p>';
      distribution+='<div class="unitstat"><strong>'+fmt(num(get(a.m,'quality_review.unanswered_inbound.oldest_open_staffed_hours')))+'</strong><span>staffed hours on oldest open text</span><strong>'+fmt(num(get(a.m,'quality_review.unanswered_inbound.answered_after_24_staffed_hours')))+'</strong><span>answered after 24 staffed hours</span></div>';
    }
    return '<section class="card"><h2>'+titles[a.lane]+', unanswered</h2><p class="card-note">'+esc(a.measures.A3.sub)+'</p>'+cell(a,'A3')+distribution+'</section>';
  }
  function opening(as) {
    return as.map(a=>{
      if(!a.row)return '<p>'+titles[a.lane]+' has no published report.</p>';
      const lead=a.measures.A1.value, wait=num(a.elapsed.median), open=a.measures.A3.value, quotes=a.measures.C1.value;
      const parts=[];
      if(num(lead)!==null)parts.push('<span class="n">'+fmt(lead)+'</span> '+(a.lane==='patio'?'eligible enquiries':'opportunity creations'));
      if(a.lane==='patio' && num(a.contacted)!==null)parts.push('<span class="n">'+fmt(a.contacted)+'</span> of the enquiry cohort answered');
      if(wait!==null)parts.push('<span class="n bad">'+fmt(wait)+' h</span> median elapsed reply'+(a.lane==='fencing'?' in reviewed threads':''));
      if(num(quotes)!==null)parts.push('<span class="n">'+fmt(quotes)+'</span> documented quotes sent'+(a.lane==='fencing' && num(get(a.m,'quotes.sent_this_week_with_document_evidence.amount_inc_sum'))!==null?' worth <span class="n">'+money(get(a.m,'quotes.sent_this_week_with_document_evidence.amount_inc_sum'))+'</span>':''));
      if(num(open)!==null)parts.push('<span class="n bad">'+fmt(open)+'</span> '+(a.lane==='patio'?'enquiries still unanswered':'open texts in the reviewed population'));
      return '<p>'+titles[a.lane]+': '+(parts.length?parts.join('; '):'has no comparable measures published')+'.</p>';
    }).join('');
  }
  function measureRows(as) {
    const tiers={A1:'Tier A · The conversation',B1:'Tier B · Booking truth',C1:'Tier C · Money',H:'Hygiene and receivables'};
    return specs.map(([key,label,def])=>(tiers[key]?'<tr class="tierrow"><td colspan="3">'+tiers[key]+'</td></tr>':'')+'<tr><td class="mcell"><span class="code">'+key+'</span><span class="mname">'+label+'</span><span class="mdef">'+def+'</span></td>'+as.map(a=>'<td data-lane-label="'+titles[a.lane]+'">'+cell(a,key)+'</td>').join('')+'</tr>').join('');
  }
  function coverage(as) {
    return '<div class="two">'+as.map(a=>'<section><h3>'+titles[a.lane]+'</h3>'+(!a.row?'<p>No report stored for this lane and week.</p>':'<p>Computed '+esc(time(a.row.computed_at))+'</p><ul>'+((a.row.coverage || {}).gaps || []).map(g=>'<li>'+esc(typeof g==='string'?g:JSON.stringify(g))+'</li>').join('')+'</ul><p class="provenance">Definition '+esc(a.row.definition_version)+'<br>Run '+esc(a.row.run_id)+'</p>')+'</section>').join('')+'</div>';
  }
  function renderHTML(data,section) {
    const week=data.week_start, as=rowsFor(data,week).map((r,i)=>adapt(r || {lane:lanes[i],week_start:week}));
    as.forEach((a,i)=>{if(!rowsFor(data,week)[i]) a.row=null;});
    const weeks=[...new Set([week,...(data.available_weeks || [])])].filter(Boolean).sort().reverse();
    const missing=as.filter(a=>!a.row).map(a=>titles[a.lane]);
    const notices=(data.missing_latest_closed_week?'<p class="notice">Latest closed week '+esc(date(data.latest_closed_week))+' has not been published. Showing '+esc(date(week))+'.</p>':'')+(missing.length?'<p class="notice">'+missing.join(' and ')+' has no report for this week.</p>':'')+(as.some(a=>a.m.partial_week || (a.row && a.row.coverage && a.row.coverage.period_kind==='partial'))?'<p class="notice">This week is partial. Counts can still move.</p>':'');
    const intro=opening(as);
    const contact=rollingContact(data);
    const four=lanes.map(lane=>'<section class="trend-lane"><h3>'+titles[lane]+'</h3>'+['A1','C1'].map(key=>{const r=rolling(data,lane,key);return '<div class="trend-item"><h3><i class="swatch '+lane+'"></i>'+(key==='A1'?'Leads in':'Quotes sent')+'</h3><p>'+r.n+' of 4 weeks published for this measure</p><strong class="fig">'+fmt(r.value)+'</strong><div class="week-slots">'+(data.week_starts || []).map(w=>{const row=(data.rows || []).find(x=>x.week_start===w&&x.lane===lane);const v=row?adapt(row).measures[key].value:null;return '<span>'+esc(date(w))+'<b>'+fmt(v)+'</b></span>';}).join('')+'</div></div>';}).join('')+(lane==='patio'?'<div class="trend-item"><h3>Contacted / eligible</h3><p>'+contact.n+' of 4 complete denominators</p><strong class="fig">'+(contact.value===null?'No rate':fmt(contact.value)+'%')+'</strong><p>'+(contact.n?contact.numerator+' answered / '+contact.denominator+' eligible in available weeks':'No complete denominator published')+'</p></div>':'<p class="card-note">Contact rate withheld: reviewed conversations are not the weekly lead cohort.</p>')+'</section>').join('');
    return '<main class="page"><div class="pagehead"><div><h1>Sales performance</h1><p class="week-line">Week of '+esc(date(week))+' · Australia/Perth</p></div><div class="headctl"><div class="seg" role="tablist" aria-label="Performance view"><button role="tab" data-performance-section="week" aria-selected="'+(section!=='coverage')+'">This week</button><button role="tab" data-performance-section="coverage" aria-selected="'+(section==='coverage')+'">Coverage map</button></div><div class="weeks" aria-label="Report week">'+weeks.map(w=>'<button data-performance-week="'+esc(w)+'" aria-pressed="'+(w===week)+'">'+esc(date(w).replace(/ \d{4}$/, ''))+'</button>').join('')+'</div></div></div>'+notices+'<section'+(section==='coverage'?' hidden':'')+'><div class="lede-wrap"><div><div class="lede">'+intro+'</div><p class="lede-sub">Each lane retains its published population and coverage. Empty stages are unmeasured, and these weekly counts are not a cohort conversion funnel.</p></div><div class="fresh"><h3>Where these numbers came from</h3><dl>'+as.map(a=>'<dt>'+titles[a.lane]+' run</dt><dd>'+esc(a.row?time(a.row.computed_at):'No report')+'</dd>').join('')+'<dt>Retrieved</dt><dd>'+esc(time(data.fetched_at))+'</dd><dt>Clock</dt><dd>Australia/Perth</dd></dl><p class="note">Run times show the source calculation. Retrieval time does not make an old report current.</p></div></div><section class="card"><div class="card-head"><h2>Where the week stopped</h2><div class="legend"><span><i class="swatch patio"></i>Patio</span><span><i class="swatch fencing"></i>Fencing</span><span>No reading —</span></div></div><p class="card-note">Both lanes use one count scale. Select a stage for its evidence and coverage.</p>'+funnel(as)+'<div class="two source-buckets">'+as.map(a=>{const buckets=a.lane==='patio'?a.m.enquiries_by_source:get(a.m,'opportunity_creations_in_week.by_source');return '<div><h3>'+titles[a.lane]+' · lead sources</h3><p>'+esc(buckets?Object.entries(buckets).map(([k,v])=>k+': '+fmt(num(v))).join(' · '):'Source buckets not published')+'</p></div>';}).join('')+'</div><p class="card-note">Fencing allocations not in CRM, last 28 days: '+fmt(num(get(as[1].m,'stratco.last_28_days.not_in_ghl')))+'</p></section><section class="card"><h2>Speed to first contact</h2><p class="card-note">Elapsed and staffed clocks remain separate. Points show retained customer waits where published; ranges show the published median and worst. Population limits stay in coverage.</p>'+speed(as)+'</section><div class="two unanswered">'+as.map(unanswered).join('')+'</div><section class="card"><h2>Four weeks back</h2><p class="card-note">Counts sum available published weeks; missing weeks remain empty. Rates use summed parts and require all four denominators. Snapshot queues and medians are not added.</p><div class="trendgrid">'+four+'</div></section><section class="card"><h2>Every measure in the build</h2><table class="tbl"><caption>Select a cell for the named list or the reason it cannot be read.</caption><thead><tr><th>Measure</th><th>Patio</th><th>Fencing</th></tr></thead><tbody>'+measureRows(as)+'</tbody></table></section><div id="salesPerformanceNotes" data-performance-notes></div></section><section'+(section==='coverage'?'':' hidden')+'><section class="card"><h2>Coverage of the published reports</h2><p class="card-note">Known gaps are preserved from each collector. A completed collection does not mean every measure is available.</p>'+coverage(as)+'</section></section></main>';
  }
  function root() { return global.document && global.document.getElementById('salesPerformanceRoot'); }
  function render() {
    const el=root(); if(!el) return;
    el.setAttribute('aria-busy',String(state.loading));
    el.innerHTML=state.loading?'<div class="page"><h1>Sales performance</h1><p role="status">Loading weekly reports…</p></div>':state.error?'<div class="page"><h1>Sales performance</h1><p role="alert">Could not load this week: '+esc(state.error)+'</p><button data-performance-retry>Retry report</button></div>':renderHTML(state.data,state.section);
    if(state.data && !state.loading && !state.error) el.dispatchEvent(new global.CustomEvent('sales-performance:render',{bubbles:true,detail:{data:state.data,week_start:state.week}}));
  }
  async function load(week) {
    if(state.loading && (week || null)===(state.week || null)) return;
    const request=++state.request; state.week=week || null;state.loading=true;state.error=null;render();
    try {
      const data=await global.opsFetch('sales_performance_read',week?{week_start:week}:{});
      if(request!==state.request)return;
      if(!data || !Array.isArray(data.rows) || !Array.isArray(data.week_starts)) throw new Error('Report response was incomplete. Retry the report.');
      state.data=data;state.week=data.week_start;
    } catch(e) {if(request!==state.request)return;state.error=e.message || 'Request failed';}
    finally {if(request===state.request){state.loading=false;render();}}
  }
  if(global.document) {
    global.document.addEventListener('change',e=>{if(e.target.matches('[data-performance-week]'))load(e.target.value);});
    global.document.addEventListener('click',e=>{
      const el=e.target.closest('[data-performance-retry],[data-performance-section],[data-performance-drill],[data-performance-week]');if(!el)return;
      if(el.hasAttribute('data-performance-week')){load(el.dataset.performanceWeek);return;}
      if(el.hasAttribute('data-performance-retry')){load(state.week);return;}
      if(el.hasAttribute('data-performance-section')){state.section=el.dataset.performanceSection;render();return;}
      const lane=el.dataset.lane,key=el.dataset.performanceDrill,row=(state.data.rows || []).find(r=>r.week_start===state.week&&r.lane===lane)||null;
      const a=adapt(row||{lane}),spec=specs.find(s=>s[0]===key);
      el.dispatchEvent(new global.CustomEvent('sales-performance:drill',{bubbles:true,detail:{lane,week_start:state.week,measure:key,label:spec&&spec[1],queueKey:a.measures[key].queueKey || (spec&&spec[3]),row,trigger:el}}));
    });
  }
  const api={state,load,render,renderHTML,adapt,rolling,rollingContact,escape:esc,specs};
  global.SalesPerformance=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
