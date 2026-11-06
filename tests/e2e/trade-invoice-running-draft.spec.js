// Running weekly invoice draft (Hugo, 2026-10-24).
//
// Save keeps what was typed and does not send the invoice. Closing the
// builder and dropping the phone's session still brings the same draft back,
// because it was stored by save_running_invoice_draft. An approved work order
// is added once. A work order already claimed on another week is not added.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({
  persona: 'installer',
  feedScenario: 'trade-invoice-running-draft',
  appWeekDay: 6,
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  timezoneId: 'Australia/Perth'
});

async function openWeek(page) {
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#invSaveBtn')).toBeVisible();
  await expect(page.locator('#invSubmitBtn')).toBeVisible();
}

async function openBuilder(page) {
  await openWeek(page);
  await expect(page.locator('.jc-card', { hasText: 'SWMS-261400' })).toHaveCount(1);
  await expect(page.locator('.jc-card', { hasText: 'SWF-CLAIMED' })).toHaveCount(0);
}

test('Save keeps the draft without sending, and it is still there after a fresh open', async ({ appPage: page, feedRequests }) => {
  await signIn(page, PERSONAS.installer);
  await openBuilder(page);

  await expect(page.locator('[data-invoice-agent-banner]')).toContainText('Only you can send it');
  await expect(page.locator('[data-invoice-save-note]')).toContainText('does not send it');
  await expect(page.locator('#invSaveBtn')).toHaveText('Save');
  await expect(page.locator('#invSubmitBtn')).toContainText('Submit Invoice');

  const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
  await card.locator('[data-carddesc]').fill('Hugo saved this line');
  await card.locator('[data-carddesc]').blur();
  await page.locator('#invSaveBtn').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '/opt/cursor/artifacts/invoice-save-vs-submit.png',
    fullPage: true
  });

  await page.locator('#invSaveBtn').click();
  await expect(page.locator('#toast')).toContainText('not been sent');
  await expect(page.getByText('Invoice Submitted')).toHaveCount(0);

  const saves = feedRequests.filter((entry) => entry.action === 'save_running_invoice_draft');
  expect(saves.length).toBeGreaterThan(0);
  const last = saves[saves.length - 1].body;
  expect(last.draft_builder.jobCards.some((row) => row.description === 'Hugo saved this line')).toBe(true);
  expect(last.draft_builder.jobCards.filter((row) => row.job_number === 'SWMS-261400')).toHaveLength(1);
  expect(last.submit).toBeUndefined();
  expect(last.xero).toBeUndefined();
  expect(last.status).toBeUndefined();
  expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);

  await page.evaluate(() => sessionStorage.clear());
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await openBuilder(page);

  await expect(page.locator('.jc-card').filter({ hasText: 'SWF-26767' }).locator('[data-carddesc]')).toHaveValue('Hugo saved this line');
  await expect(page.locator('.jc-card', { hasText: 'SWMS-261400' })).toHaveCount(1);
  await expect(page.locator('.jc-card', { hasText: 'SWF-CLAIMED' })).toHaveCount(0);
  await expect(page.locator('#invSaveBtn')).toBeVisible();
  await expect(page.locator('#invSubmitBtn')).toBeVisible();
  await page.locator('#invSaveBtn').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '/opt/cursor/artifacts/invoice-saved-draft-reloaded.png',
    fullPage: true
  });
  expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);
});

test('the owner can delete an auto line, and a reload keeps the edit and leaves the line off', async ({ appPage: page, feedRequests }) => {
  await signIn(page, PERSONAS.installer);
  await openBuilder(page);

  const hours = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
  const auto = page.locator('.jc-card').filter({ hasText: 'SWMS-261400' });
  await expect(hours.locator('[data-cardremove]')).toHaveText('Remove');
  await expect(auto.locator('[data-cardremove]')).toHaveText('Remove');

  await hours.locator('[data-carddesc]').fill('Hugo changed the auto line');
  await hours.locator('[data-carddesc]').blur();
  await auto.locator('[data-cardremove]').click();
  await expect(page.locator('.jc-card', { hasText: 'SWMS-261400' })).toHaveCount(0);

  await page.locator('#invSaveBtn').click();
  await expect(page.locator('#toast')).toContainText('not been sent');
  await expect(page.getByText('Invoice Submitted')).toHaveCount(0);

  const saves = feedRequests.filter((entry) => entry.action === 'save_running_invoice_draft');
  expect(saves.length).toBeGreaterThan(0);
  const last = saves[saves.length - 1].body;
  expect(last.draft_builder.manualLock).toBe(true);
  expect(last.draft_builder.dismissedKeys).toContain('wo:e2e-approved-wo');
  expect(last.draft_builder.jobCards.some((row) => row.job_number === 'SWMS-261400')).toBe(false);
  expect(last.draft_builder.jobCards.some((row) => row.description === 'Hugo changed the auto line')).toBe(true);
  expect(last.submit).toBeUndefined();
  expect(last.xero).toBeUndefined();
  expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);

  await page.evaluate(() => sessionStorage.clear());
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await openWeek(page);

  await expect(page.locator('.jc-card', { hasText: 'SWMS-261400' })).toHaveCount(0);
  await expect(page.locator('.jc-card', { hasText: 'SWF-CLAIMED' })).toHaveCount(0);
  const kept = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
  await expect(kept.locator('[data-carddesc]')).toHaveValue('Hugo changed the auto line');
  await expect(kept.locator('[data-carddesc]')).not.toHaveValue('Auto rebuilt this line');
  await expect(page.locator('#invSaveBtn')).toBeVisible();
  await expect(page.locator('#invSubmitBtn')).toBeVisible();
  expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);
});

test('group route keeps every saved day and excluded hour through Save and reopening', async ({ appPage: page }) => {
  const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');
  const week = perthWeekMonday(), job = 'fixture-saved-patio';
  let grouped = false;
  const posts = [];
  let builder = {version:1,weekStart:week,weekEnd:addIsoDays(week,6),manualLock:true,invRows:[],invLumpLines:[],dismissedKeys:[],jobCards:[
    {job_id:job,job_number:'PATIO-SAVED',job_type:'patio',included:false,work_date:week,scheduled_date:week,hours:7,rate:31,start_time:'07:00',finish_time:'14:30',break_minutes:30,description:'Saved installation'},
    {job_id:job,job_number:'PATIO-SAVED',job_type:'patio',included:true,work_date:addIsoDays(week,1),scheduled_date:addIsoDays(week,1),hours:2.25,rate:31,description:'Second saved day'}
  ]};
  const original = JSON.parse(JSON.stringify(builder.jobCards));
  await page.route('**/functions/v1/ops-api?**', async route => {
    const req=route.request(), action=new URL(req.url()).searchParams.get('action');
    const reply=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(req.method()==='POST') posts.push({action,body:req.postDataJSON()});
    if(action==='my_hours')return reply({assignments:[],rate:50,rate_resolved:true,invoice_type:'hourly',running_invoice_draft:true,week_start:week,week_ending:addIsoDays(week,6)});
    if(action==='my_group_work_orders'){await new Promise(resolve=>setTimeout(resolve,150));return reply({enabled:true,groups:grouped?[{group_id:'fixture-group',job_id:job,job_number:'PATIO-SAVED',awaiting:'needs_hours',client_signed:false}]:[],payable_routes:[{job_id:job,route:grouped?'group':'group_setup_required',setup_reason:'group_missing',discovery:{state:'setup_required',message:'The office needs to check the group setup.'}}]});}
    if(action==='get_running_invoice_draft')return reply({draft_id:'fixture-draft',draft_builder:builder,suggested:[],claimed:[]});
    if(action==='save_running_invoice_draft'){builder=req.postDataJSON().draft_builder;return reply({draft_id:'fixture-draft',draft_builder:builder});}
    return route.fallback();
  });
  await signIn(page, PERSONAS.installer);
  await openWeek(page);
  const card=page.locator('[data-group-job-card]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-invoice-pay-route="group_setup_required"]')).toContainText('office needs to check');
  await expect(card.locator('[data-saved-group-entry]')).toHaveCount(2);
  await expect(card).toContainText('Not ticked');
  await expect(card).toContainText('7h');
  await expect(card).toContainText('2.25h');
  await page.locator('#invSaveBtn').click();
  await expect(page.locator('#invSaveState')).toContainText('Saved');
  for(let i=0;i<2;i++)for(const key of Object.keys(original[i]))expect(builder.jobCards[i][key]).toEqual(original[i][key]);
  grouped=true;
  // Back clears the in-memory builder; clearing the local copy forces the
  // reopen to use the server draft. Authentication reload is covered separately.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(()=>sessionStorage.clear());
  await openWeek(page);
  await expect(page.locator('[data-group-job-card]')).toHaveCount(1);
  await expect(page.locator('[data-saved-group-entry]')).toHaveCount(2);
  // The hours form is the group section's; the job card links to it.
  await expect(page.locator('section[data-invoice-groups] [data-group-hours-form]')).toHaveCount(1);
  await expect(page.locator('[data-group-job-card] [data-group-hours-form]')).toHaveCount(0);
  await expect(page.locator('[data-group-job-card]')).toContainText('Go to the group work order');
  await expect(page.locator('[data-group-job-card]')).toContainText('Not ticked');
  await page.locator('#invSaveBtn').click();
  await expect(page.locator('#invSaveState')).toContainText('Saved');
  for(let i=0;i<2;i++)for(const key of Object.keys(original[i]))expect(builder.jobCards[i][key]).toEqual(original[i][key]);
  expect(posts.some(p=>p.action==='generate_trade_invoice')).toBe(false);
  expect(posts.some(p=>p.action==='submit_group_work_order_hours')).toBe(false);
});
