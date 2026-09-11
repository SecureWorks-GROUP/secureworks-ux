const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../../ops.html'), 'utf8');
const panel = source.split('// <context-pipeline-panel>')[1].split('// </context-pipeline-panel>')[0];
const auth = source.slice(source.indexOf('async function opsAuthHeaders('), source.indexOf('\n}', source.indexOf('async function opsPost(')) + 2);
const css = source.split('/* Scoped extension of the existing JARVIS Context panel. */')[1].split('</style>')[0];
const fact = {week_start:'2026-08-31',fact_id:'11111111-1111-4111-8111-111111111111',fact_store:'job_context',bucket:'scope',event_date:'2026-09-02',excerpt:'Synthetic source: replace the rear fence only.',source_event_ids:['22222222-2222-4222-8222-222222222222'],fact_snapshot:{job_number:'SAMPLE-001',kind:'scope',value:{text:'Replace the rear fence only.'}},verdict:null};
const status = {as_of:'2026-09-11T04:00:00Z',switches:{all_stop:false,capture:true,attribution:true,extraction:false},lanes:{capture:true,attribution:true,extraction:false},model_calls_used:83,model_call_cap:400,model_call_budget_state:'available',runs_used:12,run_cap:400,ready_jobs:400,ready_jobs_is_lower_bound:true,admin_bucket_size:9,missing_event_time:3,oldest_pending_event_at:'2026-09-08T04:00:00Z',last_pass_finished_at:'2026-09-10T04:00:00Z',evidence_by_attribution_status:{attributed:18,admin_bucket:9},coverage:{jobs:{total:30,with_current_fact:22,no_evidence_yet:8},invoices:{total:12,with_current_fact:7,no_evidence_yet:3,unlinked:2}},latest_accuracy_week:{week_start:'2026-08-31',n_sampled:1,n_true:0,n_false:0,n_wrong_job:0},accuracy_alerts:[{reason:'invented_payment',week_start:'2026-08-31',created_at:'2026-09-11T03:00:00Z'}]};
async function setup(page, options={}) {
  let rows = structuredClone(options.rows || [fact]);
  const requests=[];
  await page.route('**/*', route => route.abort());
  await page.route('https://context-fixture.test/**', async route => {
    const req=route.request(), action=new URL(req.url()).searchParams.get('action'); requests.push({action,method:req.method(),headers:req.headers(),body:req.postDataJSON()});
    if (options.fail) return route.fulfill({status:503,json:{error:'Synthetic unavailable'}});
    if (action==='context_pipeline_status') return route.fulfill({json:options.status || status});
    if (action==='context_accuracy_sample') return route.fulfill({json:{week_start:'2026-08-31',requested:40,sampled:rows.length,missing:40-rows.length,state:rows.length?'insufficient_sample':'not_drawn',samples:rows}});
    if (action==='context_accuracy_verdict') {
      const body=req.postDataJSON(); rows=rows.map(row=>row.fact_id===body.fact_id?{...row,...body,judged_by:'Synthetic operator',judged_at:'2026-09-11T04:00:00Z'}:row);
      return route.fulfill({json:{week:{}}});
    }
    throw new Error('Unexpected route '+action);
  });
  await page.setContent(`<style>:root{--sw-card:#fff;--sw-bg:#f7f8fa;--sw-dark:#202b3a;--sw-text-sec:#596579;--sw-border:#d5dbe3;--sw-orange:#d24618}body{margin:0;padding:16px;font-family:Arial,sans-serif;background:var(--sw-bg)}main{max-width:760px;margin:auto}${css}</style><main><p>Synthetic test fixture · JARVIS Context</p><div id="fixture"></div></main>`);
  await page.addScriptTag({content:`var _opsApiBase='https://context-fixture.test/ops-api',_opsUserEmail=null; var cloud={auth:{getAccessToken:async()=> 'synthetic-human-jwt'}};function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))} ${auth}\n${panel}\ndocument.getElementById('fixture').innerHTML=contextPanelMarkup();loadContextPipeline();`});
  return requests;
}
test('status separates actual calls, slots, accuracy, coverage and delivery', async ({page})=>{
  const requests=await setup(page);
  await expect(page.locator('#contextPipelineStatus')).toContainText('83 / 400');
  await expect(page.locator('#contextPipelineStatus')).toContainText('12 / 400');
  await expect(page.locator('#contextPipelineStatus')).toContainText('400 or more');
  await expect(page.locator('#contextPipelineStatus')).toContainText('Accuracy pending human review');
  await expect(page.locator('#contextPipelineStatus')).toContainText('delivery not confirmed');
  expect(requests.every(r=>r.method==='GET')).toBeTruthy();
  await page.evaluate(s=>document.getElementById('contextPipelineStatus').innerHTML=renderContextPipeline({...s,model_calls_used:null,model_call_budget_state:'unavailable'}),status);
  await expect(page.locator('#contextPipelineStatus')).toContainText('Unavailable / 400');
});
test('human verdict sends JWT, only explicit false can flag invented payment, then reads back', async ({page})=>{
  const requests=await setup(page);
  await page.getByText('Review weekly facts',{exact:true}).click();
  await page.getByRole('button',{name:'Load weekly review'}).click();
  await expect(page.locator('#contextAccuracyReview')).toContainText('1 sampled · 39 missing · 1 unjudged');
  await expect(page.locator('#ctx-payment-0')).toBeDisabled();
  await page.getByLabel('Your verdict').selectOption('false');
  await page.getByLabel('This false fact invented a payment').check();
  await page.getByRole('button',{name:'Save my verdict'}).click();
  await expect(page.locator('#contextAccuracyReview')).toContainText('Verdict saved and read back');
  const write=requests.find(r=>r.method==='POST');
  expect(write.action).toBe('context_accuracy_verdict');
  expect(write.headers.authorization).toBe('Bearer synthetic-human-jwt');
  expect(write.body).toMatchObject({fact_id:fact.fact_id,verdict:'false',invented_payment:true});
  expect(write.body).not.toHaveProperty('judged_by');
  await page.getByLabel('Your verdict').selectOption('wrong_job');
  await expect(page.locator('#ctx-payment-0')).not.toBeChecked();
  await expect(page.locator('#ctx-payment-0')).toBeDisabled();
});
test('unavailable status and undrawn sample stay honest; source HTML is escaped', async ({page})=>{
  await setup(page,{fail:true});
  await expect(page.locator('#contextPipelineStatus')).toContainText('Pipeline status unavailable');
  await page.unrouteAll();
  await setup(page,{rows:[]});
  await page.getByText('Review weekly facts',{exact:true}).click();await page.getByRole('button',{name:'Load weekly review'}).click();
  await expect(page.locator('#contextAccuracyReview')).toContainText('0 sampled · 40 missing');
  await expect(page.locator('#contextAccuracyReview')).toContainText('not been drawn');
  const escaped=await page.evaluate(()=>contextText('<img src=x onerror=alert(1)>'));
  expect(escaped).toContain('&lt;img');
});
test('40 actual samples remain 40 and no automatic verdict is posted',async({page})=>{
  const rows=Array.from({length:40},(_,i)=>({...fact,fact_id:`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`}));
  const requests=await setup(page,{rows});await page.getByText('Review weekly facts',{exact:true}).click();await page.getByRole('button',{name:'Load weekly review'}).click();
  await expect(page.locator('.ctx-fact')).toHaveCount(40);await expect(page.locator('#contextAccuracyReview')).toContainText('40 sampled · 0 missing · 40 unjudged');expect(requests.some(r=>r.method==='POST')).toBeFalsy();
});
for(const [name,width,height] of [['desktop',1280,1000],['mobile',390,844]]) test(`synthetic visual ${name}`,async({page})=>{
  await page.setViewportSize({width,height});await setup(page);await expect(page.locator('#contextPipelineStatus')).toContainText('83 / 400');await page.getByText('Review weekly facts',{exact:true}).click();await page.getByRole('button',{name:'Load weekly review'}).click();await expect(page.locator('.ctx-fact')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:path.join(__dirname,`../../.impeccable/review/${name}.png`),fullPage:true});
});

test('real JARVIS renderer mounts status through shared auth and readers', async ({page})=>{
  const requests=await setup(page);
  await page.route('https://context-fixture.test/functions/v1/reporting-api**',route=>route.fulfill({json:{}}));
  const render=source.slice(source.indexOf('async function renderJarvisView('),source.indexOf('// Runs a raw-source audit'));
  await page.addScriptTag({content:render});
  await page.evaluate(async()=>{ document.getElementById('fixture').innerHTML='<div id="jdJarvis"></div>';window.SUPABASE_URL='https://context-fixture.test';await renderJarvisView({job:{id:'synthetic-job',status:'new'},events:[],business_events:[]}); });
  await expect(page.locator('#jdJarvis #contextPipelinePanel')).toBeVisible();
  await expect(page.locator('#contextPipelineStatus')).toContainText('83 / 400');
  expect(requests.filter(r=>r.action==='context_pipeline_status').every(r=>r.headers.authorization==='Bearer synthetic-human-jwt')).toBeTruthy();
});
test('signed-out verdict fails closed and keeps selected review',async({page})=>{
  const requests=await setup(page);await page.getByText('Review weekly facts',{exact:true}).click();await page.getByRole('button',{name:'Load weekly review'}).click();await page.getByLabel('Your verdict').selectOption('true');
  await page.evaluate(()=>cloud.auth.getAccessToken=async()=>null);
  await page.getByRole('button',{name:'Save my verdict'}).click();await expect(page.locator('.ctx-fact [role=alert]')).toContainText('Sign in required');await expect(page.getByLabel('Your verdict')).toHaveValue('true');expect(requests.some(r=>r.method==='POST')).toBeFalsy();
});
test('unknown business source date never becomes ingestion time',async({page})=>{
  await setup(page);await page.route('https://context-fixture.test/functions/v1/reporting-api**',route=>route.fulfill({json:{}}));
  const render=source.slice(source.indexOf('async function renderJarvisView('),source.indexOf('// Runs a raw-source audit'));
  await page.addScriptTag({content:render});await page.evaluate(async()=>{document.getElementById('fixture').innerHTML='<div id="jdJarvis"></div>';window.SUPABASE_URL='https://context-fixture.test';await renderJarvisView({job:{id:'synthetic-job'},events:[],business_events:[{event_type:'email.received',event_at:null,occurred_at:'2026-09-11T04:00:00Z',created_at:'2026-09-11T04:00:00Z'}]});});
  await expect(page.locator('#jdJarvis')).toContainText('source date unknown');
});
