const { test, expect } = require('@playwright/test');
const path = require('node:path');
const base = path.resolve(__dirname, '../..');
if (process.env.DISPATCH_BROWSER_CHANNEL) test.use({ channel: process.env.DISPATCH_BROWSER_CHANNEL });
async function setup(page) {
  await page.setContent('<!doctype html><html><head></head><body><div id="fixture-label">Isolated Dispatch behavior fixture — no provider connection</div><div id="dispatchRoot"></div></body></html>');
  await page.addStyleTag({ path: path.join(base, 'modules/ops-dispatch.css') });
  await page.addScriptTag({ path: path.join(base, 'modules/ops-dispatch-core.js') });
  await page.addScriptTag({ path: path.join(base, 'modules/ops-dispatch.js') });
  await page.evaluate(() => {
    let counter = 0;
    const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
    const a = { id:'a',job_number:'FIX-101',client_name:'Fixture Patio',site_address:'Fictional site A',work_type:'patio',eligibility:{state:'unresolved'},next_action:'Review material obligations' };
    const b = { id:'b',job_number:'FIX-102',client_name:'Fixture Fence',site_address:'Fictional site B',work_type:'fencing',eligibility:{state:'accepted'},next_action:'Review material obligations' };
    const record = job => ({ job,version:0,source_version:'source-1',reviewed_source_version:null,groups:[],requirements:[],notes:[],drafts:[],movements:[],allocations:[],receipts:[],purchase_orders:[],order_drafts:[],media:[],communications:[],coverage:{complete:true},live_actions_enabled:false });
    window.fixture = { records:{a:record(a),b:record(b)},commands:[], hold:false, failure:false, mailParams:null };
    const clone = value => JSON.parse(JSON.stringify(value));
    window.fixture.get = async (action,p) => {
      if(action==='dispatch_list')return {jobs:[a,b],next_cursor:null,coverage:{complete:true}};
      if(action==='dispatch_job')return clone(fixture.records[p.job_id]);
      if(action==='dispatch_calendar')return {events:[{id:'assignment:source-a',job_id:'a',job_number:'FIX-101',title:'Fixture crew',date:'2026-09-14',layer:'staff',status:'tentative'},{id:'po:source-b',job_id:'b',job_number:'FIX-102',title:'Fixture delivery request',date:'2026-09-15',layer:'materials',status:'requested'}],undated:[],coverage:{complete:true}};
      if(action==='dispatch_communications') { fixture.mailParams=p; return {records:[{id:'mail-b',job_id:'b',jobs:{job_number:'FIX-102'},subject:'Fixture original supplier thread',from_email:'supplier@example.test',body_text:'Original job B evidence',mailbox:'ops@example.test',thread_id:'thread-b'}],next_cursor:null,coverage:{complete:true,outlook:{available:false}}}; }
      if(action==='dispatch_supply')return {supply_lots:fixture.supply_lots||[],coverage:{complete:true}};
      throw Error('Unknown fixture action');
    };
    window.fixture.post = async (action, envelope) => {
      fixture.commands.push(clone(envelope));
      if(fixture.hold)await new Promise(resolve => { fixture.release=resolve; });
      const r=fixture.records[envelope.job_id], p=envelope.payload;
      if(envelope.expected_version!==r.version)throw Object.assign(Error('Version changed'),{status:409});
      const upsert=(rows,value)=>{const i=rows.findIndex(x=>x.id===value.id);if(i<0)rows.push(clone(value));else rows[i]=clone(value);};
      switch(envelope.command){
        case 'group_upsert':upsert(r.groups,p);break;
        case 'group_delete':r.groups=r.groups.filter(g=>g.id!==p.id);r.requirements.forEach(item=>{if(item.group_id===p.id)item.group_id=null;});break;
        case 'requirement_upsert':upsert(r.requirements,p);break;
        case 'requirement_move':r.requirements.find(x=>x.id===p.id).group_id=p.group_id;break;
        case 'allocation_upsert':upsert(r.allocations,{...p,unit:r.requirements.find(x=>x.id===p.requirement_id)?.unit||null});break;
        case 'receipt_upsert':upsert(r.receipts,p);break;
        case 'order_prepare':upsert(r.order_drafts,{...p,line_items:(p.requirement_ids||[]).map(id=>({dispatch_requirement_id:id,quantity:p.quantities?.[id]??null,unit_price:p.unit_prices?.[id]??null}))});break;
        case 'note_upsert':upsert(r.notes,p);break;
        case 'draft_upsert':upsert(r.drafts,{...p,status:'draft',content_hash:'fixture-hash:'+p.body});break;
        case 'draft_review':{const d=r.drafts.find(x=>x.id===p.id);d.status='reviewed';d.review={content_hash:d.content_hash,source_version:r.source_version};break;}
        case 'communication_link':r.communication_links=[p];break;
        case 'assess':r.assessment={source_version:r.source_version,obligations:[{owner:'Shaun',next_action:'Verify current scope'}]};break;
        default:throw Error('Unimplemented test fixture command: '+envelope.command);
      }
      r.version++;return clone(r);
    };
    window.mountFixture = () => {
      window.app?.destroy();
      window.core=DispatchCore.create({get:fixture.get,post:fixture.post,id:uuid});
      window.app=DispatchOps.mount(document.getElementById('dispatchRoot'),{core,now:new Date('2026-09-14T04:00:00Z')});
      return app.load();
    };
    return mountFixture();
  });
  await expect(page.getByRole('heading', { name:/FIX-101/ })).toBeVisible();
}
async function compose(page, body='Human draft A') {
  await page.getByRole('tab',{name:'Email',exact:true}).click();
  await page.getByRole('button',{name:'Compose email',exact:true}).click();
  await page.getByLabel('Sender mailbox',{exact:true}).fill('ops@example.test');
  await page.getByLabel('To',{exact:true}).fill('supplier@example.test');
  await page.getByLabel('Exact message',{exact:true}).fill(body);
}
test('History and scope disclosures retain search focus through refresh and job navigation', async ({ page }) => {
  await setup(page);
  await compose(page, 'Keep the open job draft');
  const history = page.locator('[data-disclosure="history"]');
  if (!(await history.evaluate(detail => detail.open))) await history.locator('summary').click();
  const search = history.getByLabel('Search captured correspondence');
  await search.fill('Original supplier history');
  await search.evaluate(input => input.setSelectionRange(4, 11));
  await page.evaluate(() => app.refresh());
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  expect(await search.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([4, 11]);
  await page.locator('.dp-job[data-id="b"]').click();
  await page.locator('.dp-job[data-id="a"]').click();
  await expect(search).toBeVisible();
  await expect(search).toHaveValue('Original supplier history');
  await expect(search).toBeFocused();
  await expect(page.getByLabel('Exact message', { exact: true })).toHaveValue('Keep the open job draft');
  await page.getByRole('tab', { name: 'Scope & quote', exact: true }).click();
  const context = page.locator('[data-disclosure="context"]');
  await context.locator('summary').click();
  await page.evaluate(() => app.refresh());
  await expect(context.getByRole('button', { name: 'Review current context evidence' })).toBeVisible();
});
test('arbitrary groups preserve requirement identity through rename, move and removal',async({page})=>{
  await setup(page);await page.getByRole('button',{name:'+ Your group'}).click();await page.getByLabel('Name',{exact:true}).fill('Shaun’s first run');await page.getByRole('button',{name:'Save group',exact:true}).click();
  await page.getByRole('button',{name:'+ Requirement',exact:true}).click();await page.getByLabel('Description',{exact:true}).fill('Operator chosen material');await page.getByRole('button',{name:'Save candidate'}).click();
  const identity=await page.locator('[data-requirement]').getAttribute('data-requirement');
  const group=await page.evaluate(()=>fixture.records.a.groups[0].id);await page.getByLabel('Group for Operator chosen material').selectOption(group);
  await page.locator(`[data-action="group"][data-id="${group}"]`).click();await page.getByRole('button',{name:'Rename group'}).click();await page.getByLabel('Name',{exact:true}).fill('Delivery batch · custom');await page.getByRole('button',{name:'Save group',exact:true}).click();await page.getByRole('button',{name:'Remove group · keep requirements'}).click();
  await expect(page.locator(`[data-requirement="${identity}"]`)).toBeVisible();await expect(page.getByLabel('Group for Operator chosen material')).toHaveValue('');
});
test('exact drafts persist and each job retains human edits during selection',async({page})=>{
  await setup(page);await compose(page);await page.getByRole('button',{name:'Save Dispatch draft',exact:true}).click();await expect(page.getByText('Dispatch draft saved. No message sent.',{exact:true})).toBeVisible();
  await page.getByLabel('Exact message',{exact:true}).fill('Unsaved newer A');await page.locator('.dp-job[data-id="b"]').click();await page.getByRole('button',{name:'Compose email',exact:true}).click();await page.getByLabel('Exact message',{exact:true}).fill('Job B buffer');await page.locator('.dp-job[data-id="a"]').click();await expect(page.getByLabel('Exact message',{exact:true})).toHaveValue('Unsaved newer A');
  await page.getByRole('button',{name:'Save Dispatch draft',exact:true}).click();await page.evaluate(()=>{document.getElementById('dispatchRoot').replaceWith(Object.assign(document.createElement('div'),{id:'dispatchRoot'}));return mountFixture();});await page.getByRole('tab',{name:'Email',exact:true}).click();await page.getByRole('button',{name:/Materials · FIX-101/}).click();await expect(page.getByLabel('Exact message',{exact:true})).toHaveValue('Unsaved newer A');
});
test('edits made during save never receive an older exact review',async({page})=>{
  await setup(page);await compose(page);await page.evaluate(()=>{fixture.hold=true;});await page.getByRole('button',{name:'Review exact draft',exact:true}).click();await page.getByLabel('Exact message',{exact:true}).fill('Changed while saving');await page.evaluate(()=>{fixture.hold=false;fixture.release();});await expect(page.getByText('New edits were preserved. Review the latest content again.',{exact:true})).toBeVisible();await expect(page.getByLabel('Exact message',{exact:true})).toHaveValue('Changed while saving');expect(await page.evaluate(()=>fixture.commands.filter(c=>c.command==='draft_review').length)).toBe(0);
});
test('broader mail search keeps original attribution and never imports recipients on reference link',async({page})=>{
  await setup(page);await page.getByRole('tab',{name:'Email',exact:true}).click();await page.getByLabel('Search scope',{exact:true}).selectOption('all');await page.getByLabel('Search captured correspondence',{exact:true}).fill('supplier');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('button',{name:/Fixture original supplier thread/}).click();await expect(page.getByText('Original job B evidence',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Link as a reference — keep original job',exact:true}).click();expect(await page.evaluate(()=>fixture.records.a.communication_links[0].source_job_id)).toBe('b');await page.getByRole('button',{name:'Compose email',exact:true}).click();await expect(page.getByLabel('To',{exact:true})).toHaveValue('');expect(await page.evaluate(()=>fixture.mailParams.scope)).toBe('all');
});
test('calendar layers keep event identity and link back to the original job',async({page})=>{
  await setup(page);await page.locator('input[data-layer="materials"]').uncheck();await expect(page.locator('[data-id="po:source-b"]')).toHaveCount(0);await page.locator('input[data-layer="materials"]').check();await page.locator('[data-id="po:source-b"]').click();await expect(page.getByRole('heading',{name:/FIX-102/})).toBeVisible();await page.getByRole('button',{name:'patio',exact:true}).click();await expect(page.locator('.dp-job')).toHaveCount(1);expect(await page.evaluate(()=>core.state.jobs.length)).toBe(2);
});
test('narrow workspace keeps exact compose usable without horizontal page overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await setup(page);await compose(page);await expect(page.getByLabel('Exact message',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);await page.getByRole('button',{name:'Review exact draft',exact:true}).click();await expect(page.getByText('Exact draft reviewed and persisted. No message sent.',{exact:true})).toBeVisible();
});

test('edits during the second review request cannot inherit the older approval',async({page})=>{await setup(page);await compose(page);await page.evaluate(()=>{const original=fixture.post;core=window.app.core;const review=core.command;core.command=async(...args)=>{if(args[1]==='draft_review')fixture.hold=true;return review(...args);};});await page.getByRole('button',{name:'Review exact draft',exact:true}).click();await expect.poll(()=>page.evaluate(()=>fixture.commands.some(c=>c.command==='draft_review'))).toBe(true);await page.getByLabel('Exact message',{exact:true}).fill('New text during review');await page.evaluate(()=>{fixture.hold=false;fixture.release();});await expect(page.getByText('New edits were preserved. Review the latest content again.',{exact:true})).toBeVisible();await expect(page.getByText('Exact draft reviewed and persisted. No message sent.',{exact:true})).toHaveCount(0);});
test('actual source fields and HTML-only mail render safely without invented links',async({page})=>{await setup(page);await page.evaluate(async()=>{fixture.records.a.job.scope_json={job:{runs:[{length:12.5}]}};fixture.records.a.job.pricing_json={customer_quote:{total:123}};fixture.records.a.media=[{id:'photo',name:'Captured site photo',storage_url:'https://example.test/photo.jpg'},{id:'missing',name:'Missing original'},{id:'script',name:'Unsafe source',storage_url:'javascript:alert(1)'}];fixture.records.a.communications=[{id:'html-mail',job_id:'a',subject:'HTML-only captured mail',snippet:'Only a truncated snippet',body_html:'<p>First paragraph</p><script>window.injected=true</script><p>Second paragraph</p>'}];await core.load('a');});await expect(page.getByText('Stored job scope',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Open original',exact:true})).toHaveCount(1);await expect(page.getByRole('link',{name:'Open original',exact:true})).toHaveAttribute('href','https://example.test/photo.jpg');await page.getByRole('tab',{name:'Email',exact:true}).click();await page.getByRole('button',{name:/HTML-only captured mail/}).click();await expect(page.getByText(/First paragraph/)).toBeVisible();await expect(page.getByText(/Second paragraph/)).toBeVisible();await expect(page.getByText('Only a truncated snippet')).toHaveCount(0);expect(await page.evaluate(()=>window.injected)).toBeUndefined();});



test('receipt allocation selection remains explicit after source removal', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    fixture.records.a.requirements = [
      { id: 'requirement-a', description: 'Removed panels', quantity: 4, unit: 'each', reviewed_source_version: 'source-1' },
      { id: 'requirement-b', description: 'Remaining panels', quantity: 6, unit: 'each', reviewed_source_version: 'source-1' }
    ];
    fixture.records.a.allocations = [
      { id: 'allocation-a', requirement_id: 'requirement-a', quantity: 4, unit: 'each', supply_id: 'stock:removed' },
      { id: 'allocation-b', requirement_id: 'requirement-b', quantity: 6, unit: 'each', supply_id: 'stock:remaining' }
    ];
    await core.load('a');
  });
  const allocations = page.locator('[data-disclosure="allocations"]');
  await allocations.locator('summary').click();
  await page.getByRole('button', { name: 'Verify receipt', exact: true }).click();
  await page.getByLabel('Allocation', { exact: true }).selectOption('allocation-a');
  await page.getByLabel('Usable quantity', { exact: true }).fill('2');
  await page.getByLabel('Damaged quantity', { exact: true }).fill('0');
  await page.getByLabel('Received location', { exact: true }).fill('yard');
  await page.getByLabel('Evidence', { exact: true }).fill('Initial docket');
  await page.evaluate(async () => {
    fixture.records.a.requirements = fixture.records.a.requirements.filter(item => item.id !== 'requirement-a');
    fixture.records.a.allocations = fixture.records.a.allocations.filter(item => item.id !== 'allocation-a');
    fixture.records.a.version += 1;
    await core.load('a');
  });
  const allocationSelect = page.getByLabel('Allocation', { exact: true });
  await expect(allocationSelect).toHaveValue('allocation-a');
  expect(await allocationSelect.locator('option:checked').textContent()).toContain('Unavailable allocation: allocation-a');
  await page.getByLabel('Received location', { exact: true }).fill('site');
  await page.getByRole('button', { name: 'Save verified custody', exact: true }).click();
  expect(await page.evaluate(() => fixture.commands.length)).toBe(0);
  await page.getByRole('button', { name: 'I reviewed changes · keep my edits', exact: true }).click();
  await expect(page.getByText('Changed evidence acknowledged. Your exact values remain for review and saving.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => fixture.commands.length)).toBe(0);
  await page.getByRole('button', { name: 'Save verified custody', exact: true }).click();
  expect(await page.evaluate(() => fixture.commands.length)).toBe(0);
  await allocationSelect.selectOption('allocation-b');
  await page.getByRole('button', { name: 'Save verified custody', exact: true }).click();
  const command = await page.evaluate(() => fixture.commands.at(-1));
  expect(command.command).toBe('receipt_upsert');
  expect(command.payload).toEqual({ id: command.payload.id, allocation_id: 'allocation-b', usable_quantity: 2, damaged_quantity: 0, location: 'site', evidence: 'Initial docket' });
});

test('allocation requirement selection remains explicit after source removal', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    fixture.records.a.requirements = [
      { id: 'requirement-a', description: 'Removed panels', quantity: 4, unit: 'each', reviewed_source_version: 'source-1' },
      { id: 'requirement-b', description: 'Remaining panels', quantity: 6, unit: 'each', reviewed_source_version: 'source-1' }
    ];
    fixture.supply_lots = [{ id: 'stock:shared-lot', description: 'Shared panels', quantity: 10, unit: 'each', location: 'yard' }];
    await core.load('a');
  });
  const allocations = page.locator('[data-disclosure="allocations"]');
  await allocations.locator('summary').click();
  await page.getByRole('button', { name: 'Allocate supply', exact: true }).click();
  await page.getByLabel('Requirement', { exact: true }).selectOption('requirement-a');
  await page.getByLabel('Recorded supply lot', { exact: true }).selectOption('stock:shared-lot');
  await page.getByLabel('Quantity', { exact: true }).fill('3');
  await page.evaluate(async () => {
    fixture.records.a.requirements = fixture.records.a.requirements.filter(item => item.id !== 'requirement-a');
    fixture.records.a.version += 1;
    await core.load('a');
  });
  const requirementSelect = page.getByLabel('Requirement', { exact: true });
  await expect(requirementSelect).toHaveValue('requirement-a');
  expect(await requirementSelect.locator('option:checked').textContent()).toContain('Unavailable requirement: requirement-a');
  await page.getByLabel('Quantity', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Save allocation', exact: true }).click();
  expect(await page.evaluate(() => fixture.commands.length)).toBe(0);
  await page.getByRole('button', { name: 'I reviewed changes · keep my edits', exact: true }).click();
  expect(await page.evaluate(() => fixture.commands.length)).toBe(0);
  await page.getByRole('button', { name: 'Save allocation', exact: true }).click();
  expect(await page.evaluate(() => fixture.commands.length)).toBe(0);
  await requirementSelect.selectOption('requirement-b');
  await page.getByRole('button', { name: 'Save allocation', exact: true }).click();
  const command = await page.evaluate(() => fixture.commands.at(-1));
  expect(command.command).toBe('allocation_upsert');
  expect(command.payload).toEqual({ id: command.payload.id, requirement_id: 'requirement-b', supply_id: 'stock:shared-lot', quantity: 4 });
});

test('purchase order destination cannot silently refill after being cleared', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    fixture.records.a.job.site_address = 'Original site address must not refill';
    fixture.records.a.requirements = [{ id: 'requirement-a', description: 'Reviewed panels', quantity: 4, unit: 'each', reviewed_source_version: 'source-1' }];
    await core.load('a');
  });
  await page.getByRole('button', { name: 'Prepare purchase order', exact: true }).click();
  await page.getByLabel('Supplier name', { exact: true }).fill('Supplier One');
  await page.getByLabel('Delivery destination', { exact: true }).fill('North yard');
  await page.getByLabel('Delivery destination', { exact: true }).fill('');
  await page.getByLabel('Reviewed panels · 4 each · Reviewed').check();
  await page.evaluate(() => core.load('a'));
  await page.locator('.dp-job[data-id="b"]').click();
  await page.locator('.dp-job[data-id="a"]').click();
  const destination = page.getByLabel('Delivery destination', { exact: true });
  await expect(destination).toHaveValue('');
  await page.getByRole('button', { name: 'Save purchase order draft', exact: true }).click();
  expect(await destination.evaluate(input => input.validity.valueMissing)).toBe(true);
  expect(await page.evaluate(() => fixture.commands.length)).toBe(0);
  await destination.fill('Replacement site gate');
  await page.getByLabel('I checked linked orders and existing supply for duplication.').check();
  await page.getByRole('button', { name: 'Save purchase order draft', exact: true }).click();
  const command = await page.evaluate(() => fixture.commands.at(-1));
  expect(command.command).toBe('order_prepare');
  expect(command.payload.delivery_address).toBe('Replacement site gate');
  expect(command.payload.supplier_name).toBe('Supplier One');
  expect(command.payload.requirement_ids).toEqual(['requirement-a']);
});
