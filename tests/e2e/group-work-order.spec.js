// Group work order. Flag off (unknown action or enabled: false) paints nothing.
// A trade sees Total and Your share only. The client page shows no pay.
// There is no Send control.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const NOTICE = 'These ratings go to the office. They are not viewed by the installers.';

const FAT_SHARE = {
  pot_total: 1000,
  my_share: 400,
  needs_hours: false,
  client_signed: true,
  group_id: 'group-1',
  agreed_labour_ex: 5000,
  shares: [{ user_id: 'other', share_ex: 7777 }],
  share_token: 'secret-token',
};

function unknownError() {
  const e = new Error('Unknown action');
  e.code = 'unknown_action';
  e.status = 400;
  return e;
}

test('a trade sees only the total and their share, and nothing while the action is unknown', async ({ page }) => {
  await page.goto('/trade.html');
  await page.evaluate((payload) => {
    window.__posts = [];
    const host = document.createElement('div');
    host.id = 'gwoMount';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:100000;background:#fff';
    document.body.appendChild(host);
    GroupWorkOrderTrade.use(async function (action, params, body) {
      window.__posts.push({ action: action, body: body });
      if (window.__mode === 'off') throw unknownError();
      if (window.__mode === 'disabled') return { enabled: false, pot_total: 99 };
      if (window.__mode === 'missing') {
        const e = new Error('There is no group work order for that job.');
        e.code = 'group_work_order_not_found';
        e.status = 404;
        throw e;
      }
      if (window.__mode === 'refused') {
        const e = new Error('An authorised operator session is required.');
        e.status = 403;
        e.code = 'access_denied';
        e.body = { code: 'operator_access_required', error: e.message };
        throw e;
      }
      if (window.__mode === 'join') return { enabled: true, participant: false };
      if (action === 'join_group_work_order') {
        window.__mode = 'share';
        return { ok: true, group_id: 'group-1', client_signed: false };
      }
      if (action === 'submit_group_work_order_hours') return payload;
      return payload;
    });
    function unknownError() {
      const e = new Error('Unknown action');
      e.code = 'unknown_action';
      e.status = 400;
      throw e;
    }
    window.__mode = 'off';
    host.innerHTML = GroupWorkOrderTrade.slotHtml('job-1');
  }, FAT_SHARE);

  expect(await page.evaluate(() => window.__posts.length)).toBe(0);
  await expect(page.locator('#gwoMount')).toBeEmpty();

  await page.evaluate(() => {
    GroupWorkOrderTrade.arm({ group_work_order_enabled: true });
    return GroupWorkOrderTrade.paint('job-1');
  });
  await expect.poll(() => page.evaluate(() => window.__posts.length)).toBe(1);
  await expect(page.locator('#gwoMount')).toBeEmpty();
  await expect(page.locator('#gwoMount')).not.toContainText('$');
  await expect(page.locator('#gwoMount')).not.toContainText('authorised operator');
  await expect(page.locator('#gwoMount')).not.toContainText('Send');

  await page.evaluate(() => {
    window.__mode = 'refused';
    window.__posts = [];
    GroupWorkOrderTrade.arm({ group_work_order_enabled: true });
    return GroupWorkOrderTrade.paint('job-1');
  });
  await expect(page.locator('#gwoMount')).toBeEmpty();
  await expect(page.locator('#gwoMount')).not.toContainText('An authorised operator session is required.');
  expect(await page.evaluate(() => {
    window.__posts = [];
    return GroupWorkOrderTrade.paint('job-1').then(function () { return window.__posts.length; });
  })).toBe(0);

  await page.evaluate(() => {
    window.__mode = 'missing';
    GroupWorkOrderTrade.arm({ group_work_order_enabled: true });
    return GroupWorkOrderTrade.paint('job-1');
  });
  await expect(page.locator('#gwoMount')).toBeEmpty();
  await expect(page.locator('[data-group-wo-action="create"]')).toHaveCount(0);

  await page.evaluate(() => {
    window.__mode = 'disabled';
    window.__posts = [];
    GroupWorkOrderTrade.arm({ group_work_order_enabled: true });
    return GroupWorkOrderTrade.paint('job-1');
  });
  await expect(page.locator('#gwoMount')).toBeEmpty();

  await page.evaluate(() => {
    window.__mode = 'share';
    window.__posts = [];
    GroupWorkOrderTrade.arm({ group_work_order_enabled: true });
    return GroupWorkOrderTrade.paint('job-1');
  });
  const card = page.locator('#gwoMount');
  await expect(card).toContainText('Total $1,000.00');
  await expect(card).toContainText('Your share $400.00');
  await expect(card).not.toContainText('5000');
  await expect(card).not.toContainText('7777');
  await expect(card).not.toContainText('Agreed labour');
  await expect(card).not.toContainText('secret-token');
  await expect(card.getByRole('button', { name: 'Send' })).toHaveCount(0);
  await expect(card).not.toContainText('Send');

  const quiet = await page.evaluate((payload) => {
    const needs = Object.assign({}, payload, { needs_hours: true, pot_total: 5000, my_share: 7777 });
    return GroupWorkOrderCore.tradeHtml('hours', needs);
  }, FAT_SHARE);
  expect(quiet).not.toContain('$');
  expect(quiet).not.toContain('5000');
  expect(quiet).not.toContain('7777');
  expect(quiet).not.toContain('Agreed labour');
  expect(quiet).toContain('Save hours');
  expect(quiet).not.toContain('Send');

  await page.evaluate(() => {
    window.__mode = 'join';
    window.__posts = [];
    GroupWorkOrderTrade.arm({ enabled: true });
    return GroupWorkOrderTrade.paint('job-1');
  });
  await page.locator('[data-group-wo-action="join"]').click();
  await expect.poll(() => page.evaluate(() => window.__posts.filter((p) => p.action === 'join_group_work_order').length)).toBe(1);
  const joined = await page.evaluate(() => window.__posts.find((p) => p.action === 'join_group_work_order'));
  expect(joined.body).toEqual({ job_id: 'job-1' });
});

test('create, join and save hours post those actions and never a send', async ({ page }) => {
  await page.goto('/trade.html');
  await page.evaluate(() => {
    window.__posts = [];
    const host = document.createElement('div');
    host.id = 'gwoMount';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:100000;background:#fff';
    document.body.appendChild(host);
    GroupWorkOrderTrade.use(async function (action, params, body) {
      window.__posts.push({ action: action, body: body });
      if (action === 'group_work_order_my_share' && !window.__joined) {
        return { enabled: true };
      }
      if (action === 'create_group_work_order') {
        window.__joined = true;
        return { ok: true, group_id: 'group-1', share_token: 'secret-token', client_signed: false };
      }
      if (action === 'group_work_order_my_share') {
        return { pot_total: null, my_share: null, needs_hours: true, client_signed: false, group_id: 'group-1', agreed_labour_ex: 5000 };
      }
      if (action === 'submit_group_work_order_hours') {
        return { pot_total: 1000, my_share: 400, needs_hours: false, client_signed: false, group_id: 'group-1', shares: [{ share_ex: 7777 }] };
      }
      return {};
    });
    GroupWorkOrderTrade.arm({ group_work_order_enabled: true });
    host.innerHTML = GroupWorkOrderTrade.slotHtml('job-1');
  });
  await expect(page.locator('[data-group-wo-action="create"]')).toBeVisible();
  await page.locator('[data-group-wo-action="create"]').click();
  await expect.poll(() => page.evaluate(() => window.__posts.filter((p) => p.action === 'create_group_work_order').length)).toBe(1);
  const created = await page.evaluate(() => window.__posts.find((p) => p.action === 'create_group_work_order'));
  expect(created.body).toEqual({ job_id: 'job-1' });
  await expect(page.locator('#gwoMount')).not.toContainText('secret-token');
  await expect(page.locator('#gwoMount')).not.toContainText('$');

  await page.locator('[data-group-wo-date]').fill('2026-10-20');
  await page.locator('[data-group-wo-start]').fill('07:30');
  await page.locator('[data-group-wo-finish]').fill('15:30');
  await page.locator('[data-group-wo-break]').fill('30');
  await page.locator('[data-group-wo-action="save-hours"]').click();
  await expect.poll(() => page.evaluate(() => window.__posts.filter((p) => p.action === 'submit_group_work_order_hours').length)).toBe(1);
  const hours = await page.evaluate(() => window.__posts.find((p) => p.action === 'submit_group_work_order_hours'));
  expect(hours.body).toEqual({
    group_id: 'group-1',
    work_date: '2026-10-20',
    start_time: '07:30',
    finish_time: '15:30',
    break_minutes: 30,
  });
  expect(hours.body.send).toBeUndefined();
  await expect(page.locator('#gwoMount')).toContainText('Your share $400.00');
  await expect(page.locator('#gwoMount')).not.toContainText('7777');
  await expect(page.locator('#gwoMount')).not.toContainText('Send');
  const actions = await page.evaluate(() => window.__posts.map((p) => p.action));
  expect(actions).not.toContain('group_work_order_preview_client_link');
});

test('the client page stays empty when the action is unknown and never shows pay', async ({ page }) => {
  let reads = 0;
  await page.route('**/functions/v1/ops-api**', async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (action === 'group_work_order_public' && reads === 0) {
      reads += 1;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unknown action', code: 'unknown_action' }),
      });
      return;
    }
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'operator_access_required', error: 'An authorised operator session is required.' }),
    });
  });
  await page.goto('/group-sign.html?token=abc');
  await expect(page.locator('#groupSign')).toBeEmpty();
  await expect(page.locator('body')).not.toContainText('$');
  await expect(page.locator('body')).not.toContainText('Send');
  await page.goto('/group-sign.html?token=abc');
  await expect(page.locator('#groupSign')).toBeEmpty();
  await expect(page.locator('body')).not.toContainText('An authorised operator session is required.');
});

test('the client signs and rates, and the page shows no crew pay', async ({ page }) => {
  const posts = [];
  let signed = false;
  await page.route('**/functions/v1/ops-api**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action');
    let body = null;
    try { body = req.postDataJSON(); } catch (e) { body = null; }
    posts.push({ action: action, body: body });
    if (action === 'group_work_order_public') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          job_number: 'SWF-100',
          site_suburb: 'Dianella',
          job_type: 'fencing',
          client_signed: signed,
          feedback_submitted: false,
          office_only_notice: NOTICE,
          pot_total: 9999,
          my_share: 111,
          agreed_labour_ex: 5000,
          shares: [{ share_ex: 7777 }],
        }),
      });
      return;
    }
    if (action === 'group_work_order_client_sign') {
      signed = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, client_signed: true }) });
      return;
    }
    if (action === 'group_work_order_submit_feedback') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, office_only_notice: NOTICE, prompt_google_review: false }),
      });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown action', code: 'unknown_action' }) });
  });
  await page.goto('/group-sign.html?token=abc');
  await expect(page.locator('[data-group-sign-notice]')).toHaveText(NOTICE);
  await expect(page.locator('[data-group-sign]')).toContainText('SWF-100');
  await expect(page.locator('[data-group-sign]')).not.toContainText('$');
  await expect(page.locator('[data-group-sign]')).not.toContainText('9999');
  await expect(page.locator('[data-group-sign]')).not.toContainText('5000');
  await expect(page.locator('[data-group-sign]')).not.toContainText('7777');
  await expect(page.locator('[data-group-sign]')).not.toContainText('Agreed labour');
  await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);

  await page.locator('[data-group-sign-name]').fill('Pat Client');
  const pad = page.locator('[data-group-sign-pad]');
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 70);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Sign' }).click();
  await expect(page.locator('[data-group-sign-ratings]')).toBeVisible();
  const sign = posts.find((p) => p.action === 'group_work_order_client_sign');
  expect(sign.body.share_token).toBe('abc');
  expect(sign.body.signer_name).toBe('Pat Client');
  expect(sign.body.signed_via).toBe('share_link');
  expect(String(sign.body.signature_png || '')).toContain('data:image/png');
  expect(sign.body.pot_total).toBeUndefined();
  expect(sign.body.send).toBeUndefined();

  await page.getByRole('button', { name: 'Save ratings' }).click();
  await expect(page.locator('[data-group-sign-msg]')).toHaveText('Rate each one from 1 to 5.');
  for (const key of ['sales_process', 'communication', 'cleanliness', 'punctuality', 'crew']) {
    await page.locator('input[data-group-sign-rating="' + key + '"][value="5"]').check();
  }
  await page.locator('[data-group-sign-free]').fill('Left the site tidy');
  await page.getByRole('button', { name: 'Save ratings' }).click();
  await expect(page.locator('[data-group-sign-done]')).toHaveText('The office has your ratings.');
  const feedback = posts.find((p) => p.action === 'group_work_order_submit_feedback');
  expect(feedback.body.sales_process.rating).toBe(5);
  expect(feedback.body.communication.rating).toBe(5);
  expect(feedback.body.cleanliness.rating).toBe(5);
  expect(feedback.body.punctuality.rating).toBe(5);
  expect(feedback.body.crew.rating).toBe(5);
  expect(feedback.body.free_text).toBe('Left the site tidy');
  expect(feedback.body.send).toBeUndefined();
  await expect(page.locator('#groupSign')).not.toContainText('$');
  await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);
});

test('the office sees every share, and a trade role or an unknown action sees nothing', async ({ page }) => {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(() => {
    _currentJobId = 'job-1';
    window.__posts = [];
    document.getElementById('jobDetailView').classList.add('active');
    window.opsFetch = async function (action, params) {
      window.__posts.push({ method: 'GET', action: action, params: params });
      if (window.__mode === 'off') {
        const e = new Error('Unknown action');
        e.code = 'unknown_action';
        throw e;
      }
      return {
        ok: true,
        group_id: 'group-1',
        pot_total: 1000,
        client_signed: true,
        split_frozen: true,
        agreed_labour_ex: 5000,
        participants: [{ user_id: 'u-sam', signature_name: 'Sam Crew' }, { user_id: 'u-pat', signature_name: 'Pat Crew' }],
        shares: [{ user_id: 'u-sam', share_ex: 400 }, { user_id: 'u-pat', share_ex: 600 }],
        feedback: { sales_process_rating: 5, communication_rating: 4, cleanliness_rating: 5, punctuality_rating: 5, crew_rating: 3, free_text: 'On time' },
      };
    };
    window.opsPost = async function (action, body) {
      window.__posts.push({ method: 'POST', action: action, body: body });
      return { ok: true, split_frozen: false };
    };
    window.__mode = 'off';
    GroupWorkOrderOffice.paint({ job: { id: 'job-1' } });
  });
  expect(await page.evaluate(() => window.__posts.length)).toBe(0);
  await expect(page.locator('[data-office-group-wo]')).toBeEmpty();

  await page.evaluate(() => {
    window.__posts = [];
    GroupWorkOrderOffice.paint({ job: { id: 'job-1' }, group_work_order_enabled: true });
  });
  await expect.poll(() => page.evaluate(() => window.__posts.length)).toBe(1);
  await expect(page.locator('[data-office-group-wo]')).toBeEmpty();
  await expect(page.locator('[data-office-group-wo]')).not.toContainText('$');

  await page.evaluate(() => {
    window.SECUREWORKS_CLOUD = { auth: { getRole: function () { return 'installer'; } } };
    window.__posts = [];
    window.__mode = 'on';
    GroupWorkOrderOffice.paint({ job: { id: 'job-1' }, group_work_order_enabled: true });
  });
  expect(await page.evaluate(() => window.__posts.length)).toBe(0);
  await expect(page.locator('[data-office-group-wo]')).toBeEmpty();
  await expect(page.locator('#jdOverview')).not.toContainText('Agreed labour');

  await page.evaluate(() => {
    window.SECUREWORKS_CLOUD = { auth: { getRole: function () { return ''; } } };
    window.__posts = [];
    GroupWorkOrderOffice.paint({ job: { id: 'job-1' }, group_work_order_enabled: true });
  });
  const office = page.locator('[data-office-group-wo-card]');
  await expect(office).toContainText('Total $1,000.00');
  await expect(office).toContainText('Sam Crew');
  await expect(office).toContainText('$400.00');
  await expect(office).toContainText('Pat Crew');
  await expect(office).toContainText('$600.00');
  await expect(office).toContainText('Crew on site: 3');
  await expect(office).toContainText('On time');
  await expect(office).not.toContainText('Agreed labour');
  await expect(office.getByRole('button', { name: 'Send' })).toHaveCount(0);
  await office.getByRole('button', { name: 'Reopen the split' }).click();
  await expect.poll(() => page.evaluate(() => window.__posts.filter((p) => p.method === 'POST').length)).toBe(1);
  const post = await page.evaluate(() => window.__posts.find((p) => p.method === 'POST'));
  expect(post.action).toBe('unfreeze_group_work_order');
  expect(post.body).toEqual({ group_id: 'group-1' });
  expect(post.body.send).toBeUndefined();
});


test('office records existing client approval without creating a signature or submitting pay', async ({ page }) => {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(() => {
    _currentJobId = 'job-office';
    _currentJobData = {job:{id:'job-office'},group_work_order_enabled:true};
    document.getElementById('jobDetailView').classList.add('active');
    window.SECUREWORKS_CLOUD = {auth:{getRole:()=> 'owner'}};
    window.__officeWrites = [];
    window.__approved = false;
    window.opsFetch = async () => ({group_id:'group-office',pot_total:2160,
      participants:[{user_id:'crew',name:'Test Crew'}],hours:[{user_id:'crew',hours:18}],
      client_signed:window.__approved,client_signoff_method:window.__approved?'office_waiver':null,
      client_signoff_reason:window.__approved?'Owner confirmed prior approval':null,shares:[]});
    window.opsPost = async (action,body) => {window.__officeWrites.push({action,body});window.__approved=true;return {ok:true};};
    GroupWorkOrderOffice.paint(_currentJobData);
  });
  await expect(page.locator('[data-office-group-wo-card]')).toContainText('Test Crew: 18 hours saved');
  await page.locator('[data-office-signoff-reason]').fill('Owner confirmed prior approval');
  await page.getByRole('button',{name:'Record office sign-off'}).click();
  await expect(page.locator('[data-office-group-override]')).toContainText('Owner confirmed prior approval');
  await expect(page.locator('[data-office-signoff-form]')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__officeWrites)).toEqual([{action:'waive_client_signoff',body:{job_id:'job-office',reason:'Owner confirmed prior approval'}}]);
});

test('office approves the crew’s hours for them with a reason, and a refusal is shown in words', async ({ page }) => {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(() => {
    _currentJobId = 'job-office';
    _currentJobData = {job:{id:'job-office'},group_work_order_enabled:true};
    document.getElementById('jobDetailView').classList.add('active');
    window.SECUREWORKS_CLOUD = {auth:{getRole:()=> 'owner'}};
    window.__officeWrites = [];
    window.__hoursApproved = false;
    window.__refuseOnce = true;
    window.opsFetch = async () => ({group_id:'group-office',pot_total:2720,pay_basis:'all_in_12_v2',split_frozen:false,
      participants:[{user_id:'henry',name:'Henry'},{user_id:'ryan',name:'Ryan'}],
      hours:[{user_id:'henry',hours:18},{user_id:'ryan',hours:18.5}],
      needs_approval: window.__hoursApproved ? [] : ['ryan'], hours_office_approved: window.__hoursApproved,
      client_signed:true,client_signoff_method:'office_waiver',client_signoff_reason:'Client happy, signed by phone',shares:[]});
    window.opsPost = async (action,body) => {
      window.__officeWrites.push({action,body});
      if (window.__refuseOnce) { window.__refuseOnce = false; const e = new Error('refused'); e.body = {error:'You are on this crew, so someone else in the office has to approve its hours.'}; throw e; }
      window.__hoursApproved = true; return {ok:true};
    };
    GroupWorkOrderOffice.paint(_currentJobData);
  });
  const card = page.locator('[data-office-group-wo-card]');
  await expect(card).toContainText('Henry: 18 hours saved · approved');
  await expect(card).toContainText('Ryan: 18.5 hours saved · not approved yet');
  await page.getByRole('button',{name:'Approve hours for the crew'}).click();
  // An empty reason is stopped by the form itself: nothing is sent.
  expect(await page.evaluate(()=>window.__officeWrites.length)).toBe(0);
  await page.locator('[data-office-hours-reason]').fill('Ryan confirmed his hours by phone');
  await page.getByRole('button',{name:'Approve hours for the crew'}).click();
  await expect(card).toContainText('someone else in the office has to approve');
  await page.getByRole('button',{name:'Approve hours for the crew'}).click();
  await expect(page.locator('[data-office-hours-approved]')).toContainText('Hours approved by the office for the crew.');
  await expect(card).toContainText('Ryan: 18.5 hours saved · approved by the office');
  await expect(page.locator('[data-office-hours-form]')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__officeWrites)).toEqual([
    {action:'office_approve_group_hours',body:{group_id:'group-office',reason:'Ryan confirmed his hours by phone'}},
    {action:'office_approve_group_hours',body:{group_id:'group-office',reason:'Ryan confirmed his hours by phone'}},
  ]);
});
