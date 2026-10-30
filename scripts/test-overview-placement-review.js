// Actual staff renderer with synthetic page shell; no browser/auth/network acceptance.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const { buildJobDetail, buildJobOverview } = require('../tests/fixtures/job-overview-v2');
const baseline = process.argv.includes('--baseline');
const source = baseline ? cp.execFileSync('git',['show','45e80c3f:modules/ops-job-overview-v2.js'],{encoding:'utf8',cwd:repo}) : fs.readFileSync(path.join(repo,'modules/ops-job-overview-v2.js'),'utf8');
const now=Date.parse('2026-10-30T16:45:00Z');
const id='7e200000-0000-0000-0000-000000000005';
const text='Please confirm the promised delivery document';
function render(review, extra={}) {
 const el={innerHTML:'',addEventListener(){}};
 const detail=buildJobDetail({now}),ov=buildJobOverview({now});
 ov.story.placement_review=review;
 ov.story.loops=extra.loops||[];
 ov.story.meta.ledger={status:'live',unread_rows:0,needs_rebuild:true};
 ov.story.not_known=[{what:'1 reader item was hidden because messages it cited moved off this job; the story needs a rebuild.'},{what:'Bank statement has not been read.'}];
 ov.notes={items:[{id:'old-note',item_key:'request:confirmation',what:text,status:'open',item_type:'request',to_role:'us'}]};
 if (extra.story) { ov.story=extra.story; detail.job={...detail.job,...extra.story.job}; }
 if (extra.notes) ov.notes=extra.notes;
 const before=JSON.stringify(ov);
 const ctx={console,Intl,URLSearchParams,Date,setTimeout(){},clearTimeout(){},document:{getElementById(k){return k==='jdOverview'?el:k==='ov2-css'?{}:null;}},location:{search:'?overview=v2'},localStorage:{getItem(){return null;}},opsPost(){throw Error('No writes');},opsFetch(){throw Error('No originals access');},fetch(){throw Error('No network');}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.JobOverviewV2._state.cache[detail.job.id]={status:'ok',data:ov,at:now};
 assert.equal(ctx.JobOverviewV2.render(detail),true);assert.equal(JSON.stringify(ov),before);
 return {html:el.innerHTML,core:ctx.JobOverviewV2Core,story:ov.story,notes:ov.notes};
}
const review={state:'needs_review',items:[{item_key:'request:confirmation',what:text,status:'open',opened_by:[{table:'business_events',id,excerpt:'PROTECTED_TRANSCRIPT_WORDS'}]}]};
const r=render(review);
assert.match(r.html,/id="ov2PlacementReview"/);assert.match(r.html,/Retained source references/);assert.match(r.html,new RegExp(id));assert.match(r.html,/Original source opening is unavailable/);
assert.match(r.html,/need source-placement review before a fresh reading/);
assert.doesNotMatch(r.html,/PROTECTED_TRANSCRIPT_WORDS|story needs a rebuild|AI notes are due for a fresh read/);
assert.match(r.html,/Bank statement has not been read/);
const groups=r.core.openItems(r.story,{},r.notes,now);
assert.equal(Object.values(groups).flat().length,0,'old raw note must not reappear as currently assigned work');
const current={key:'invoice',what:'INV-999 unpaid 120',status:'open',source:'record',owner:'customer',counterparty:'us'};
const mixed=render(review,{loops:[current]});assert.match(mixed.html,/INV-999 unpaid 120/);assert.match(mixed.html,/Historical notes needing review/);
const missing=render({state:'needs_review'});assert.match(missing.html,/Review details could not be read/);
const missingSource=structuredClone(review);missingSource.items[0].opened_by=[];assert.match(render(missingSource).html,/Source references unavailable/);
const escaped=structuredClone(review);escaped.items[0].what='<script>alert(1)</script>';escaped.items[0].opened_by[0].id='<img src=x onerror=alert(1)>';
const safe=render(escaped).html;assert.doesNotMatch(safe,/<script>alert|<img src=x/);assert.match(safe,/&lt;img/);
const long=structuredClone(review);long.items[0].what='Document promise '+ 'Full wording '.repeat(200)+'FINAL_OBLIGATION';assert.match(render(long).html,/FINAL_OBLIGATION/);
const ordinary=render(undefined);assert.doesNotMatch(ordinary.html,/id="ov2PlacementReview"/);assert.match(ordinary.html,/story needs a rebuild/);
assert.equal(Object.values(ordinary.core.openItems(ordinary.story,{},ordinary.notes,now)).flat().length,1,'legacy fallback unchanged without review');
console.log(JSON.stringify({result:'PASS',scenarios:8,baseline,limits:'actual renderer in synthetic DOM shell; no signed-in browser, original access or production acceptance'}));

module.exports = { render };
