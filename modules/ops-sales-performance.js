/* Sales > Performance. Published weekly rows only; no provider calls or writes. */
(function (global) {
  'use strict';
  const state = {data:null, week:null, lane:'all', source:'all', showAllQuotes:false, loading:false, error:null, request:0};
  const LANES = ['fencing','patio'];
  const title = s => s ? s[0].toUpperCase()+s.slice(1) : '';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const fmt = v => num(v) === null ? '–' : Math.round(v).toLocaleString('en-AU');
  const money = v => num(v) === null ? '–' : '$'+fmt(v);
  const compact = v => num(v) === null ? '–' : Math.abs(v)>=1000 ? '$'+fmt(v/1000)+'k' : money(v);
  const hours = v => num(v) === null ? '–' : v.toFixed(1)+'h';
  const get = (o, path) => path.split('.').reduce((v,k)=>v == null ? undefined : v[k],o);
  const sum = values => values.length && values.every(v=>num(v)!==null) ? values.reduce((a,b)=>a+b,0) : null;
  const day = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? new Date(s+'T00:00:00Z') : null;
  const date = s => day(s)?.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}) || 'Unknown date';
  const plusDays = (s,n) => {const d=day(s);if(!d)return null;d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const age = (since,week) => day(since)&&day(week) ? Math.max(0,Math.round((day(plusDays(week,7))-day(since))/864e5)) : null;
  const gapAliases = {quoted_value:['quote_total'],quoted_jobs:['quote_total'],quote_rows:['quote_total'],wins:['accepted_jobs'],daily:['enquiries','new_enquiries'],reply:['reply_time'],actions:['customers_waiting']};
  function hasGap(row,path) {
    const candidates=[path,...(gapAliases[path.split('.')[0]] || [])];
    return (row?.coverage?.gaps || []).some(g=>{
      const key=typeof g==='string'?g:(g?.key || g?.measure || '');
      return candidates.some(p=>key===p || p.startsWith(key+'.') || key===row?.lane+'_'+p || (key===row?.lane+'_quote_total' && /^(quoted_|quote_rows)/.test(p)));
    });
  }
  function read(row,path) {return !row || hasGap(row,path) ? null : get(row.metrics,path) ?? null;}
  function list(row,path) {const v=read(row,path);return Array.isArray(v)?v:null;}
  const selected = (items,source) => items?.filter(x=>source==='all'||x.source===source) ?? null;
  function daily(row,source) {
    const data=read(row,'daily');
    const series=data?.[row?.lane];
    if(!series || typeof series!=='object')return null;
    const keys=source==='all'?Object.keys(series):[source];
    if(!keys.length || !keys.every(k=>Array.isArray(series[k])&&series[k].length===7))return null;
    return Array.from({length:7},(_,i)=>sum(keys.map(k=>series[k][i])));
  }
  function rowsFor(data,week) {return LANES.map(lane=>(data.rows||[]).find(r=>r.lane===lane&&r.week_start===week)||null);}
  function model(data,options={}) {
    const lane=options.lane || 'all',source=options.source || 'all',week=data.week_start;
    const rows=rowsFor(data,week), active=lane==='all'?rows:[rows[LANES.indexOf(lane)]];
    const scoped=lane==='all'?LANES:[lane];
    const fencing=rows[0],patio=rows[1];
    const actions=active.every(r=>list(r,'actions')!==null) ? active.flatMap(r=>selected(list(r,'actions').filter(a=>!a.lane||a.lane===r.lane),source).map(a=>({...a,lane:r.lane}))) : null;
    const wins=active.every(r=>list(r,'wins')!==null) ? active.flatMap(r=>selected(list(r,'wins'),source)) : null;
    // Published wins are the weekly accepted-with-proof population. No CRM/deposit inference.
    const proven=wins?.every(w=>typeof w.proof==='string' && w.proof.trim()) ? wins : null;
    const quoteRows=active.every(r=>list(r,'quote_rows')!==null) ? active.flatMap(r=>selected(list(r,'quote_rows'),source)) : null;
    const scalar=path=>source==='all'?sum(active.map(r=>num(read(r,path)))):null;
    const previous=path=>source==='all'?sum(active.map(r=>{
      const prior=read(r,'prior');
      if(!prior)return null;
      const direct=num(get(prior,path));if(direct!==null)return direct;
      if(path==='enquiries')return sum(daily({...r,metrics:prior},'all')||[]);
      if(path==='customers_waiting')return Array.isArray(prior.actions)?prior.actions.length:null;
      if(path==='won')return Array.isArray(prior.wins)&&prior.wins.every(w=>typeof w.proof==='string'&&w.proof.trim())?prior.wins.length:null;
      return null;
    })):null;
    const enquirySeries=Array.from({length:7},(_,i)=>sum(active.map(r=>daily(r,source)?.[i] ?? null)));
    const quotedJobs=active.some(r=>hasGap(r,'quoted_jobs'))?null:source==='all'?scalar('quoted_jobs'):quoteRows?.length ?? null;
    const quotedValue=active.some(r=>hasGap(r,'quoted_value'))?null:source==='all'?scalar('quoted_value'):quoteRows?quoteRows.length?sum(quoteRows.map(q=>q.value)):0:null;
    const replyLane=lane==='patio'?'patio':'fencing',replyRow=replyLane==='patio'?patio:fencing;
    const elapsed=source==='all'?num(read(replyRow,replyLane==='patio'?'reply.patio.elapsed':'reply.fencing_elapsed.median')):null;
    const staffed=source==='all'?num(read(replyRow,'reply.'+replyLane+'.median')):null;
    return {lane,source,week,rows,active,scoped,fencing,patio,actions,wins:proven,quoteRows,scalar,previous,enquirySeries,quotedJobs,quotedValue,elapsed,staffed,replyLane,
      enquiries:sum(enquirySeries),winCount:proven?.length ?? null,winValue:proven?proven.length?sum(proven.map(w=>w.value)):0:null,
      replyPrior:source==='all'?num(read(replyRow,'prior.reply_elapsed')):null};
  }
  function delta(now,prior,format=fmt) {
    if(num(now)===null || num(prior)===null)return '<div class="d">last week –</div>';
    const diff=now-prior;
    return '<div class="d">'+(diff===0?'same as last week':(diff>0?'up ':'down ')+format(Math.abs(diff))+' on last week')+' ('+format(prior)+')</div>';
  }
  const rowHTML=(label,value,note='')=>'<div class="srow"><span class="t"><b>'+esc(label)+'</b></span><span class="n">'+esc(value)+'</span><div class="m">'+note+'</div></div>';
  function identity(action,data) {
    // Names only from the authenticated read's explicit contact-id join, never metrics.
    const contact=action.contact_id && data.contacts_by_id?.[action.contact_id];
    return contact?.name || action.suburb || 'Customer';
  }
  function actionsHTML(m,data) {
    if(m.actions===null)return '<p class="sub">– Customer follow-ups not published for this selection.</p>';
    if(!m.actions.length)return '<p class="sub">No customers waiting in this published selection.</p>';
    const sorted=[...m.actions].sort((a,b)=>(age(b.since,m.week)??-1)-(age(a.since,m.week)??-1));
    const urgent=sorted.filter(a=>a.source==='Stratco' && age(a.since,m.week)>=30);
    const groups=new Map();sorted.forEach(a=>{const owner=a.owner || 'Unassigned';if(!groups.has(owner))groups.set(owner,[]);groups.get(owner).push(a);});
    const warning=urgent.length?'<div class="urgent"><h3>Promised '+fmt(age(urgent[0].since,m.week))+' days ago</h3>'+urgent.map(a=>'<p><b>'+esc(identity(a,data))+'</b> · '+esc(a.owed)+' <span>'+esc(a.owner)+'</span></p>').join('')+'</div>':'';
    return warning+[...groups].sort((a,b)=>b[1].length-a[1].length).map(([owner,items])=>'<h3 class="person">'+esc(owner)+'<span>'+items.length+' waiting · '+items.filter(a=>age(a.since,m.week)>=7).length+' over a week</span></h3>'+items.filter(a=>!urgent.includes(a)).map(a=>'<div class="act"><span class="age">'+fmt(age(a.since,m.week))+'d</span><span><b>'+esc(identity(a,data))+'</b> · '+esc(a.owed)+'</span></div>').join('')).join('');
  }
  function storyHTML(m) {
    const f=m.fencing,unfiltered=m.source==='all',fe=m.scoped.includes('fencing');
    const fv=p=>fe&&unfiltered?num(read(f,p)):null;
    const urgent=m.actions?.filter(a=>a.source==='Stratco'&&age(a.since,m.week)>=30) || [];
    const known=m.winCount!==null&&m.quotedValue!==null;
    const fencingModel=m.lane==='all'?model({rows:m.rows.filter(Boolean),week_start:m.week},{lane:'fencing',source:m.source}):null;
    const published=known?m:fencingModel?.winCount!==null&&fencingModel?.quotedValue!==null?fencingModel:null;
    const opening=published?'<b>'+(published!==m?'Fencing: ':'')+fmt(published.winCount)+' jobs won for '+money(published.winValue)+'</b> against '+compact(published.quotedValue)+' quoted; '+fmt(published.scalar('lost_week'))+' lost; '+fmt(published.scalar('tracked.accepted'))+' of '+fmt(published.scalar('tracked.count'))+' tracked quotes accepted online.'+(published!==m?' Patio quotes and wins: –.':''):'<b>'+fmt(m.enquiries)+' new enquiries</b>; quotes and accepted work are not fully published for this selection (–).';
    const middle=m.lane==='patio'?'<b>'+fmt(m.actions?.length??null)+' patio customers waiting on us</b>; reply time is '+hours(m.elapsed)+' on the customer’s clock.':m.source!=='all'?'<b>'+fmt(m.actions?.length??null)+' customers waiting through '+esc(m.source)+'</b>; follow through on the oldest commitments first.':'<b>'+fmt(fv('stratco_week.in_crm'))+' of '+fmt(fv('stratco_week.allocated'))+' Stratco allocations entered in the CRM</b>'+(urgent.length?', and '+urgent.length+' customers have waited '+fmt(age(urgent[0].since,m.week))+' days for a promised price.':'.');
    const closing=m.lane==='patio'?'<b>'+fmt(m.source==='all'?num(read(m.patio,'patio_uncontacted')):null)+' patio clients not yet contacted</b>; review the queue before adding more work.':m.source!=='all'?'Pipeline ageing and cash for this lead source are <b>not published (–)</b>.':'<b>'+fmt(fv('followup.count'))+' fencing quotes worth '+compact(fv('followup.value_sum_crm'))+' have no decision</b>; '+fmt(fv('followup.touched_last_14d'))+' were touched in the last fortnight.';
    return '<ul class="story">'+[['quotes',opening],['do',middle],['stuck',closing]].map(([id,text])=>'<li><a href="#sp-'+id+'" data-performance-jump="sp-'+id+'">'+text+'</a></li>').join('')+'</ul>';
  }

  function kpisHTML(m) {
    const K=[
      [fmt(m.enquiries),'New enquiries','First enquiries through each lead source',delta(m.enquiries,m.previous('enquiries'))],
      [hours(m.elapsed),'Reply time'+(m.lane==='all'?' (fencing)':''),"Customer’s clock · "+hours(m.staffed)+' working hours',delta(m.elapsed,m.replyPrior,hours)],
      [fmt(m.quotedJobs),'Quotes sent',m.lane==='all'?'Both lanes, when fully published':'Jobs with quote evidence',delta(m.quotedJobs,m.previous('quoted_jobs'))],
      [compact(m.quotedValue),'Quoted value','Including GST',delta(m.quotedValue,m.previous('quoted_value'),money)],
      [fmt(m.winCount),'Won',money(m.winValue)+' · accepted with proof',delta(m.winCount,m.previous('won'))],
      [fmt(m.actions?.length ?? null),'Customers waiting','Actions grouped by person below',delta(m.actions?.length ?? null,m.previous('customers_waiting'))]
    ];
    return '<section class="card kpis" aria-label="Last seven days">'+K.map(([v,l,s,d])=>'<div class="kpi"><div class="v">'+esc(v)+'</div><div class="l">'+esc(l)+'</div><div class="s">'+esc(s)+'</div>'+d+'</div>').join('')+'</section>';
  }
  function stuckHTML(m) {
    const f=m.fencing,all=m.source==='all',v=p=>all?num(read(f,p)):null,p=k=>all?num(read(f,'prior.'+k)):null;
    let h='';
    if(m.scoped.includes('fencing')) {
      h+=rowHTML('Quotes sent, no decision',fmt(v('followup.count')),money(v('followup.value_sum_crm'))+' · median age '+fmt(v('followup.median_days'))+' days'+delta(v('followup.count'),p('followup_count')));
      h+=rowHTML('Stale fencing leads',fmt(v('stale')),delta(v('stale'),p('stale')));
      h+=rowHTML('Overdue fencing invoices',fmt(v('overdue.count')),money(v('overdue.total'))+delta(v('overdue.total'),p('overdue_total'),money));
      h+=rowHTML('Promises missed in texts',fmt(v('promises.missed_in_thread')),'of '+fmt(v('promises.detected'))+' detected'+delta(v('promises.missed_in_thread'),p('promises_missed')));
      h+=rowHTML('Stratco leads not in the CRM',fmt(v('stratco_not_in_crm_28d')),'Last 28 days');
      const deposits=all?list(f,'deposit_unpaid'):null;
      h+=rowHTML('Deposit invoiced, not yet paid',fmt(deposits?.length ?? null),esc(deposits?.join(', ') || '–'));
    }
    if(m.scoped.includes('patio'))h+=rowHTML('Patio clients not yet contacted',fmt(all?num(read(m.patio,'patio_uncontacted')):null),'Sitting in the first stage');
    return h+rowHTML('Cash landed',money(m.scalar('cash_landed')),'Bank receipts matched to jobs. Separate from accepted work.');
  }
  // HTML bars keep labels at their CSS size on phones; no scaled-down SVG text.
  function chartHTML(m) {
    const series=m.active.map(r=>({s:daily(r,'Stratco'),g:daily(r,'Web'),p:daily(r,'Phone')}));
    const values=Array.from({length:7},(_,i)=>({s:m.source==='all'||m.source==='Stratco'?sum(series.map(x=>x.s?.[i]??null)):0,g:m.source==='all'?sum(series.flatMap(x=>[x.g?.[i]??null,x.p?.[i]??null])):m.source==='Web'?sum(series.map(x=>x.g?.[i]??null)):m.source==='Phone'?sum(series.map(x=>x.p?.[i]??null)):m.source==='Stratco'?0:m.enquirySeries[i]}));
    const max=Math.max(1,...m.enquirySeries.filter(v=>num(v)!==null));
    return '<div class="daily-chart" aria-label="New enquiries by day">'+values.map((v,i)=>{const total=m.enquirySeries[i],known=num(total)!==null;return '<div class="day-bar"><b>'+fmt(total)+'</b><div class="bar-space">'+(known?'<div class="general-bar" style="height:'+((v.g??0)/max*85)+'px"></div><div class="stratco-bar" style="height:'+((v.s??0)/max*85)+'px"></div>':'')+'</div><span>'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]+'</span></div>';}).join('')+'</div>';
  }
  function stratcoHTML(m) {
    if(!m.scoped.includes('fencing'))return '<p class="sub">– Stratco comparison is published for fencing.</p>';
    const f=m.fencing,unfiltered=m.source==='all',s=unfiltered?sum(daily(f,'Stratco')||[]):null,g=unfiltered?sum([sum(daily(f,'Web')||[]),sum(daily(f,'Phone')||[])]):null;
    const a=unfiltered?list(f,'actions'):null,candidates=unfiltered?list(f,'wins'):null,w=candidates?.every(x=>typeof x.proof==='string'&&x.proof.trim())?candidates:null;
    let html=rowHTML('Stratco new enquiries',fmt(s),fmt(unfiltered?num(read(f,'stratco_week.allocated')):null)+' allocated; allocations and first enquiries are different populations')+rowHTML('General new enquiries',fmt(g),'Website and phone');
    ['Stratco','General'].forEach(label=>{const match=x=>label==='Stratco'?x.source==='Stratco':['Web','Phone'].includes(x.source);html+=rowHTML(label+' customers waiting',fmt(a?.filter(match).length??null))+rowHTML(label+' wins',fmt(w?.filter(match).length??null));});
    const weeks=unfiltered?read(f,'stratco_weeks'):null;
    const entries=weeks && typeof weeks==='object'?Object.entries(weeks).sort(([a],[b])=>a.localeCompare(b)).slice(-7):[];
    const max=Math.max(1,...entries.map(([,v])=>num(v.allocated)??0));
    html+='<div class="strip-wrap"><h3>Stratco leads entered in the CRM, by week</h3><p class="legend">Orange: entered · grey: not entered</p><div class="weekly-strip">'+(entries.length?entries.map(([d,v])=>{const allocated=num(v.allocated),entered=num(v.in_ghl??v.in_crm),missing=allocated!==null&&entered!==null?Math.max(0,allocated-entered):null;return '<div class="week-bar"><b>'+fmt(entered)+'/'+fmt(allocated)+'</b><div class="bar-space"><div class="missing-bar" style="height:'+((missing??0)/max*64)+'px"></div><div class="stratco-bar" style="height:'+((entered??0)/max*64)+'px"></div></div><span>'+esc(date(d).replace(/ \d{4}$/, ''))+'</span></div>';}).join(''):'<p>– Weekly allocations not published for this selection.</p>')+'</div></div>';
    return html;
  }
  function quotesHTML(m,showAll) {
    if(m.quoteRows===null){
      if(m.lane==='all')return m.rows.map((r,i)=>'<h3 class="person">'+title(LANES[i])+'</h3>'+quotesHTML(model({rows:r?[r]:[],week_start:m.week},{lane:LANES[i],source:m.source}),showAll)).join('');
      return '<p class="sub">– Quote details not published for this lane.</p>';
    }
    if(!m.quoteRows.length)return '<p class="sub">No quotes sent in this published selection.</p>';
    const quotes=[...m.quoteRows].sort((a,b)=>(num(b.value)??-1)-(num(a.value)??-1)),max=Math.max(1,...quotes.map(q=>num(q.value)??0));
    return (showAll?quotes:quotes.slice(0,6)).map(q=>'<div class="row">'+(num(q.value)!==null?'<span class="fill" style="width:calc('+Math.max(0,q.value/max*100)+'% - 12px)"></span>':'')+'<span class="t"><b>'+esc(q.job)+'</b></span><span class="m">'+esc(q.source)+'</span><span class="n">'+money(q.value)+'</span></div>').join('')+(quotes.length>6?'<button class="more" data-performance-more>'+ (showAll?'Show fewer':'Show all '+quotes.length)+'</button>':'');
  }
  function detailHTML(m,data) {
    const definitions=[
      ['Won','Customer acceptance with retained proof, dated inside the reporting week. A CRM stage or an unpaid deposit is not added to weekly wins.'],
      ['Reply time','Median elapsed time on the customer’s clock; working hours are separate. All shows fencing explicitly because lane medians cannot be combined.'],
      ['Comparisons','Only like-for-like prior measures are compared. CRM creations are not first enquiries; tracked documents are not all quotes. Missing priors stay as a dash.'],
      ['Lead sources','The filter applies to enquiries, actions, quote rows and wins. Measures without a published source breakdown become a dash.'],
      ['Missing measures','A dash means absent or unreconciled, including a missing lane in All. A published zero remains zero.'],
      ['Cash landed','Bank receipts matched to jobs, separate from acceptance and deposit invoices.'],
      ['Visits completed',fmt(m.scalar('visits_completed'))+' · requires calendar evidence, not an offer or agreement in text.'],
      ['Action ages','Days waiting at the Monday after the selected week, so historic reports stay reproducible.'],
      ['Deposit evidence',(m.scoped.includes('fencing')&&m.source==='all'?list(m.fencing,'deposit_jobs'):null)?.map(j=>j.job+': '+(j.accepted?'accepted '+j.accepted:'acceptance date not recorded')+'; '+money(j.value)).join('. ') || '–'],
      ['Published evidence',m.active.map((r,i)=>r?title(r.lane)+' · '+(r.computed_at || 'calculation time unknown')+' · definition '+(r.definition_version || '–')+' · run '+(r.run_id || '–'):title(m.scoped[i])+' has no published row').join('\n')],
      ['Coverage gaps',m.active.flatMap(r=>(r?.coverage?.gaps || []).map(g=>title(r.lane)+': '+(typeof g==='string'?g:JSON.stringify(g)))).join('; ') || 'No declared gaps. Absent measures still remain unavailable.'],
      ['Retrieved',data.fetched_at || '–']
    ];
    return '<details class="card"><summary>How these numbers are counted, and what we cannot count yet</summary><table>'+definitions.map(([l,d])=>'<tr><td>'+esc(l)+'</td><td>'+esc(d)+'</td></tr>').join('')+'</table></details>';
  }
  function renderHTML(data,options={}) {
    if(!data?.rows?.length)return '<div class="wrap"><h1>Sales performance</h1><p role="status">No week published yet</p></div>';
    const m=model(data,options),weeks=[...new Set([data.week_start,...(data.available_weeks || [])])].filter(Boolean).sort().reverse();
    const sources=[...new Set(['Stratco','Web','Phone',...m.active.flatMap(r=>Object.keys(read(r,'daily')?.[r?.lane] || {})),...m.active.flatMap(r=>(list(r,'quote_rows')||[]).map(q=>q.source)),...m.active.flatMap(r=>(list(r,'actions')||[]).map(a=>a.source))])].filter(Boolean);
    const notice=(m.active.some(r=>!r)?'<p class="notice">'+m.scoped.filter((_,i)=>!m.active[i]).map(title).join(' and ')+' has no report for this week. Combined measures stay unavailable.</p>':'')+(data.missing_latest_closed_week?'<p class="notice">Latest closed week '+esc(date(data.latest_closed_week))+' has not been published. Showing '+esc(date(m.week))+'.</p>':'')+(m.active.some(r=>r?.coverage?.period_kind==='partial'||read(r,'partial_week')===true)?'<p class="notice">This week is partial. Counts can still move.</p>':'')+(m.source!=='all'?'<p class="notice">'+esc(m.source)+' only. Measures without a source breakdown are shown as a dash.</p>':'');
    const card=(id,h,sub,content)=>'<section class="card list" id="sp-'+id+'"><h2>'+h+'</h2><p class="sub">'+sub+'</p>'+content+'</section>';
    return '<div class="wrap"><div class="top"><h1>Sales performance</h1><label class="period">Week <select data-performance-week aria-label="Report week">'+weeks.map(w=>'<option value="'+esc(w)+'"'+(w===m.week?' selected':'')+'>'+esc(date(w))+'</option>').join('')+'</select></label><div class="seg" role="group" aria-label="Business line">'+['all',...LANES].map(l=>'<button data-performance-lane="'+l+'" aria-pressed="'+(l===m.lane)+'">'+title(l)+'</button>').join('')+'</div><label class="source">Lead source <select data-performance-source><option value="all">All sources</option>'+sources.map(s=>'<option value="'+esc(s)+'"'+(s===m.source?' selected':'')+'>'+esc(s)+'</option>').join('')+'</select></label></div><p class="period-note">'+esc(date(m.week))+' to '+esc(date(plusDays(m.week,6)))+' · Australia/Perth</p>'+notice+storyHTML(m)+kpisHTML(m)+'<div class="grid">'+card('do','Do this week','Customers waiting on us, by person, oldest first',actionsHTML(m,data))+'<div class="right-column">'+card('stuck','What is stuck','Against the week before',stuckHTML(m))+card('stratco','Stratco versus general','Fencing',stratcoHTML(m))+'<section class="card chart"><div class="chead"><h2>New enquiries by day</h2><div class="legend"><span><i class="stratco-bar"></i>Stratco</span><span><i class="general-bar"></i>General</span></div></div>'+chartHTML(m)+'</section>'+card('quotes','Quotes sent in the week','By value including GST',quotesHTML(m,options.showAllQuotes))+'</div></div>'+detailHTML(m,data)+'<div id="salesPerformanceNotes" data-performance-notes></div></div>';
  }
  function root(){return global.document?.getElementById('salesPerformanceRoot');}
  function render(){
    const el=root();if(!el)return;
    el.setAttribute('aria-busy',String(state.loading));
    el.innerHTML=state.loading?'<div class="wrap"><h1>Sales performance</h1><p role="status">Loading weekly reports…</p></div>':state.error?'<div class="wrap"><h1>Sales performance</h1><p role="alert">Could not load this week: '+esc(state.error)+'</p><button data-performance-retry>Retry report</button></div>':renderHTML(state.data,state);
    if(state.data&&!state.loading&&!state.error)el.dispatchEvent(new global.CustomEvent('sales-performance:render',{bubbles:true,detail:{data:state.data,week_start:state.week}}));
  }
  async function load(week){
    if(state.loading&&(week||null)===(state.week||null))return;
    const request=++state.request;state.week=week||null;state.loading=true;state.error=null;render();
    try {const data=await global.opsFetch('sales_performance_read',week?{week_start:week}:{});if(request!==state.request)return;if(!data||!Array.isArray(data.rows))throw new Error('Report response was incomplete. Retry the report.');state.data=data;state.week=data.week_start;state.showAllQuotes=false;}
    catch(e){if(request!==state.request)return;state.error=e.message||'Request failed';}
    finally{if(request===state.request){state.loading=false;render();}}
  }
  if(global.document){
    global.document.addEventListener('change',e=>{if(!root()?.contains(e.target))return;if(e.target.matches('[data-performance-week]'))load(e.target.value);if(e.target.matches('[data-performance-source]')){state.source=e.target.value;render();root()?.querySelector('[data-performance-source]')?.focus();}});
    global.document.addEventListener('click',e=>{const el=e.target.closest('[data-performance-lane],[data-performance-more],[data-performance-retry],[data-performance-jump]');if(!el||!root()?.contains(el))return;if(el.hasAttribute('data-performance-jump')){e.preventDefault();global.document.getElementById(el.dataset.performanceJump)?.scrollIntoView({block:'start'});return;}if(el.hasAttribute('data-performance-retry')){load(state.week);return;}if(el.hasAttribute('data-performance-lane')){state.lane=el.dataset.performanceLane;state.source='all';state.showAllQuotes=false;}else state.showAllQuotes=!state.showAllQuotes;render();root()?.querySelector(el.hasAttribute('data-performance-lane')?'[data-performance-lane="'+state.lane+'"]':'[data-performance-more]')?.focus();});
  }
  const api={state,load,render,renderHTML,model,read,hasGap,escape:esc};global.SalesPerformance=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
