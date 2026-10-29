const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

test.describe.configure({timeout:60_000});
test.use({ persona: 'fencing_manager', feedScenario: 'henry-job-centric-submit', timezoneId: 'Australia/Perth', appWeekDay: 6, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const groupId = '33333333-3333-4333-8333-333333333333';
const groupJob = '44444444-4444-4444-8444-444444444444';
const base = { group_id: groupId, job_id: groupJob, job_number: 'SWP-GROUP-ZOO', client_name: 'Group fixture client', site_suburb: 'South Perth', pot_total: 2160, needs_hours: false, group_share_office_review_required: true };

async function fixtures(page, initial = 'ready', running = false) {
  let phase = initial, builder = null;
  const posts = [];
  await page.route('**/functions/v1/ops-api?**', async route => {
    const req = route.request(), action = new URL(req.url()).searchParams.get('action');
    const json = (obj,status=200) => route.fulfill({status, contentType:'application/json',body:JSON.stringify(obj)});
    if (action === 'my_group_work_orders') return json({enabled:true, group_job_ids:[groupJob], groups:[{...base, awaiting:phase, client_signed:phase !== 'awaiting_signoff', projected_my_share:phase === 'ready' ? 723.89 : null, my_share:phase === 'frozen' ? 723.89 : null}]});
    if (action === 'freeze_group_work_order') { posts.push({action,body:req.postDataJSON()}); phase = 'frozen'; return json({...base, awaiting:'frozen',client_signed:true,my_share:723.89}); }
    if (action === 'my_hours' && running) return json({assignments:[], rate:50,rate_resolved:true,is_per_metre:true,invoice_type:'per_metre',running_invoice_draft:true,week_start:perthWeekMonday(),week_ending:addIsoDays(perthWeekMonday(),6),super_rate:0.12,gst_on:false});
    if (action === 'get_running_invoice_draft' && running) return json({draft_builder:builder,draft_id:builder ? 'group-draft' : null,suggested:[],claimed:[]});
    if (action === 'save_running_invoice_draft' && running) { builder=req.postDataJSON().draft_builder; posts.push({action,body:req.postDataJSON()}); return json({draft_id:'group-draft',draft_builder:builder}); }
    if (action === 'generate_trade_invoice') { posts.push({action,body:req.postDataJSON()}); return json({ok:true,success:true,invoice_id:'group-invoice',invoice_number:'GROUP-FIXTURE-1',office_review:'held',pending_ops_review:true,xero_bill_id:null}); }
    return route.fallback();
  });
  return {posts};
}
async function open(page) {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button',{name:'Weekly Invoice'}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('[data-invoice-group]')).toContainText('SWP-GROUP-ZOO');
  await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toHaveCount(0);
}

test('Henry finalises an older group inline and submits its own share with an ordinary work order', async ({appPage:page}) => {
  const f = await fixtures(page);
  await open(page);
  const group = page.locator('[data-invoice-group]');
  await expect(group).toContainText('2,160.00');
  await expect(group).toContainText('estimated share: $723.89');
  await expect(group).toContainText('Sign-off accepted');
  await expect(group.locator('[data-invoice-group-select]')).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await group.getByRole('button',{name:'Finalise group shares',exact:true}).click();
  await expect(group.locator('[data-invoice-group-select]')).toBeChecked();
  await expect(page.locator('[data-invoice-money-summary]')).toContainText('Earned$783.89');
  // The other $60 is the existing Henry work order; it triggers the exclusive reread.
  await expect(page.locator('.jc-card').filter({hasText:'FENCE-HENRY-001'})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('group-invoice-proof.png'),fullPage:true});
  await page.locator('#invSubmitBtn').click();
  await page.locator('#confirmAck').check();
  await page.locator('#confirmOk').click();
  await expect.poll(() => f.posts.filter(p=>p.action==='generate_trade_invoice').length).toBe(1);
  const posted = f.posts.find(p=>p.action==='generate_trade_invoice').body;
  expect(posted.extra_items.filter(i=>i.type==='group share')).toEqual([{type:'group share',group_id:groupId,job_id:groupJob,job_number:'SWP-GROUP-ZOO',quantity:1,rate:723.89}]);
  expect(posted.extra_items.some(i=>i.work_order_id==='wo-fence-authorised')).toBe(true);
  expect(posted.manual_assignments.some(i=>i.job_id===groupJob)).toBe(false);
  await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
});

test('unsigned group appears in the normal invoice but cannot be finalised or selected', async ({appPage:page}) => {
  const f=await fixtures(page,'awaiting_signoff');
  await open(page);
  const group=page.locator('[data-invoice-group]');
  await expect(group).toContainText('Waiting for client sign-off');
  await expect(group.locator('[data-invoice-group-finalise]')).toHaveCount(0);
  await expect(group.locator('[data-invoice-group-select]')).toHaveCount(0);
  expect(f.posts).toEqual([]);
});

test('Save and reload retains selected group identity and rechecks the server share', async ({appPage:page}) => {
  const f=await fixtures(page,'frozen',true);
  await open(page);
  await page.locator('[data-invoice-group-select]').check();
  await page.locator('#invSaveBtn').click();
  await expect(page.locator('#invSaveState')).toContainText('Saved');
  expect(f.posts.filter(p=>p.action==='save_running_invoice_draft').at(-1).body.draft_builder.groupIds).toEqual([groupId]);
  await page.reload();
  await signIn(page,PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await expect(page.locator('[data-invoice-group-select]')).toBeChecked();
  await expect(page.locator('[data-invoice-money-summary]')).toContainText('783.89');
});


test('all-inclusive group shows cash and super and submits one separate share from the normal invoice', async ({appPage:page}) => {
  let phase='ready'; const posts=[], offsets=[];
  await page.route('**/functions/v1/ops-api?**', async route => {
    const req=route.request(),action=new URL(req.url()).searchParams.get('action');
    const reply=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    const share={...base,pot_total:2720,pay_basis:'all_in_12_6_v1',budget_includes_super:true,client_signed:true,awaiting:phase,
      projected_my_share:859.96,projected_my_budget:911.56,projected_cash_pay:808.36,projected_super:103.20,
      my_share:phase==='frozen'?859.96:null,my_budget:phase==='frozen'?911.56:null,my_cash_pay:phase==='frozen'?808.36:null,my_super:phase==='frozen'?103.20:null};
    if(action==='my_work_orders') {
      const q=new URL(req.url()).searchParams; expect(q.get('status')).toBe('complete'); expect(q.get('page_size')).toBe('500');
      const offset=Number(q.get('offset')); offsets.push(offset);
      const normal={id:'wo-fence-authorised',wo_number:'WO-FENCE-001',job_id:'fence-job-henry',job_number:'FENCE-HENRY-001',client_name:'Henry Client',job_type:'fencing',status:'complete',scheduled_date:addIsoDays(perthWeekMonday(),1),subtotal:100,scope_items:[{description:'Install fencing',quantity:10,rate:10,total:100}],negative_charges:[{line_id:'wo-fence-charge-israel',trade_name:'Israel',description:'Work Order - Israel',amount_ex:-40}],already_invoiced:false,can_invoice:true};
      return reply({work_orders:offset===0?[normal]:[{id:'old-claimed',already_invoiced:true,can_invoice:false,job_type:'fencing'}],total:2,truncated:offset===0,next_offset:offset===0?1:null});
    }
    if(action==='my_group_work_orders')return reply({enabled:true,group_job_ids:[groupJob],groups:[share]});
    if(action==='freeze_group_work_order'){phase='frozen';return reply({...share,awaiting:'frozen',my_share:859.96});}
    if(action==='generate_trade_invoice'){posts.push(req.postDataJSON());return reply({success:true,invoice_id:'all-in-group-invoice',office_review:'held',xero_bill_id:null});}
    return route.fallback();
  });
  await open(page);
  const card=page.locator('[data-invoice-group]');
  expect(offsets).toEqual([0,1]);
  await expect(page.locator('[data-pm-wo-hydrate="error"]')).toHaveCount(0);
  await expect(card).toContainText('pay + super pool: $2,720.00');
  await expect(card).toContainText('allocation: $911.56 including pay and super');
  await expect(card).toContainText('Your pay: $808.36 · Your super: $103.20');
  page.once('dialog',d=>d.accept()); await card.getByRole('button',{name:'Finalise group shares',exact:true}).click();
  await expect(card.locator('[data-invoice-group-select]')).toHaveCount(0);
  await expect(card.getByRole('button',{name:'Submit my group share',exact:true})).toBeVisible();
  page.once('dialog',d=>d.accept()); await card.getByRole('button',{name:'Submit my group share',exact:true}).click();
  await expect(card).toContainText('saved for office review');
  expect(posts).toEqual([{extra_items:[{type:'group share',group_id:groupId}],gst_on:false}]);
  await expect(page.locator('[data-invoice-money-summary]')).toContainText('Earned$60.00');
  await page.screenshot({path:test.info().outputPath('group-invoice-proof.png'),fullPage:true});
});
