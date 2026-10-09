// Job page Overview v2 (modules/ops-job-overview-v2.js, docs/job-overview-v2.md).
// Offline: ops-api is replaced by tests/fixtures/job-overview-v2.js (made-up people, dates from
// today's Perth date) and every edge-function request is answered here, so nothing reaches
// production. An action missing from the stub answers "Unknown action", exactly as ops-api does
// before the backend deploys.
//
// Contract under guard:
//  - Off by default: the classic Overview renders and staff see a small "Try the new Overview".
//    ?overview=v2 or localStorage sw_overview_v2 = '1' turn it on; ?overview=classic wins.
//  - The staff toggle flips both ways, remembers the choice and strips ?overview= from the URL.
//  - Header (customer, money, whose move), files strip, timeline, story and conversation render;
//    the buttons go through the page's own handlers (call bridge, name edit, invoice preview).
//  - job_overview not deployed or failing: header, files and a plain record still show, with
//    "The story is not switched on yet" or "Story not available right now", and no page error.
//  - Data rules: drafts are not invoiced, deleted invoices fade, quote views are a count, machine
//    rows and transcripts never show, Perth times in any browser time zone, no long dash anywhere.
//  - A late job_overview answer for another job paints nothing.
//  - Rewrite posts request_job_story; the reply box sends through ghl-proxy send_sms and refuses
//    a long dash.
//  - Layout: three columns on a desktop; on a phone customer, files, story, timeline, conversation,
//    with nothing in the Overview wider than the screen.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');
const { JOB_ID, OTHER_JOB_ID, IDS, buildJobDetail, buildJobOverview } = require('../fixtures/job-overview-v2');

test.use({ viewport: { width: 1360, height: 1000 } });

// Boots ops.html with every backend call stubbed. overview: 'ok' | 'notdeployed' | 'error' | 'pending'.
async function boot(page, { url = '/ops.html?overview=v2', staff = true, overview = 'ok', overviewOpts = {}, detailOpts = {}, storage = null, otherJob = false } = {}) {
  const sent = [];
  const stray = [];
  await page.route('**/functions/v1/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname.endsWith('/ghl-proxy') && u.searchParams.get('action') === 'send_sms' && req.method() === 'POST') {
      sent.push({ body: req.postDataJSON(), auth: req.headers().authorization || '' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, messageId: 'msg-e2e-1' }) });
    }
    stray.push(`${req.method()} ${u.pathname}?${u.searchParams.toString()}`);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not stubbed in this spec"}' });
  });
  if (storage) {
    await page.addInitScript((s) => { try { Object.keys(s).forEach((k) => window.localStorage.setItem(k, s[k])); } catch (e) { /* none */ } }, storage);
  }
  await page.goto(url);
  await revealOpsStaticFixture(page);
  const detail = buildJobDetail(detailOpts);
  const other = buildJobDetail();
  other.job = Object.assign({}, other.job, { id: OTHER_JOB_ID, job_number: 'SWF-990202', client_name: 'Riley Shaw', ghl_contact_id: 'ghl-contact-e2e-002' });
  const ov = buildJobOverview(overviewOpts);
  await page.evaluate(({ detail, other, ov, mode, staff, otherJob }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    window.__ov2 = { fetches: [], posts: [], pending: {}, calls: 0, edits: [], subviews: [], previews: [] };
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const unknown = () => Promise.reject(Object.assign(new Error('Unknown action'), { status: 400 }));
    window.opsFetch = (action, params) => {
      window.__ov2.fetches.push({ action, params: params || {} });
      const id = (params && (params.jobId || params.job_id)) || '';
      if (action === 'job_detail') return Promise.resolve(clone(otherJob && id === other.job.id ? other : detail));
      if (action === 'annotations') return Promise.resolve({ annotations: [] });
      if (action === 'list_job_actions') return Promise.resolve([]);
      if (action === 'job_overview') {
        if (mode === 'notdeployed') return unknown();
        if (mode === 'error') return Promise.reject(Object.assign(new Error('Something broke'), { status: 500 }));
        if (mode === 'pending') return new Promise((resolve) => { window.__ov2.pending[id] = () => resolve(clone(ov)); });
        return Promise.resolve(clone(ov));
      }
      return unknown();
    };
    window.opsPost = (action, body) => { window.__ov2.posts.push({ action, body }); return Promise.resolve({ ok: true, state: 'queued' }); };
    window.opsAuthHeaders = async (extra) => Object.assign({ Authorization: 'Bearer e2e-ops-token' }, extra || {});
    if (staff) window.JobOverviewV2.isStaffViewer = () => true;
  }, { detail, other, ov, mode: overview, staff, otherJob });
  return { sent, stray };
}
async function openJob(page, id = JOB_ID) {
  await page.evaluate((jobId) => openJobDetail(jobId), id);
  await expect(page.locator('#jobDetailView')).toHaveClass(/active/);
}
const overviewFetches = (page) => page.evaluate(() => window.__ov2.fetches.filter((f) => f.action === 'job_overview').length);
const filterButton = (page, name) => page.locator('.ov2-seg').getByRole('button', { name, exact: true });

test('switch off: the classic Overview, no job_overview read, and the toggle only for staff', async ({ page }) => {
  await boot(page, { url: '/ops.html', staff: false });
  await openJob(page);
  await expect(page.locator('#jdOverview')).toContainText('Progress');
  await expect(page.locator('#ov2Root')).toHaveCount(0);
  await expect(page.locator('#jdOverview [data-ov2-act="try"]')).toHaveCount(0);
  expect(await overviewFetches(page)).toBe(0);
  await page.evaluate(() => { window.JobOverviewV2.isStaffViewer = () => true; renderOverviewView(_currentJobData); });
  await expect(page.locator('#jdOverview [data-ov2-act="try"]')).toHaveText('Try the new Overview');
  await expect(page.locator('#ov2Root')).toHaveCount(0);
});

test('?overview=v2 turns it on', async ({ page }) => {
  await boot(page, { url: '/ops.html?overview=v2', staff: false });
  await openJob(page);
  await expect(page.locator('#ov2Root')).toBeVisible();
  await expect(page.locator('#ov2Toggle')).toHaveCount(0); // not staff: no toggle
});

test('the browser setting turns it on, and ?overview=classic wins over it', async ({ page }) => {
  await boot(page, { url: '/ops.html', storage: { sw_overview_v2: '1' } });
  await openJob(page);
  await expect(page.locator('#ov2Root')).toBeVisible();
  await page.goto('/ops.html?overview=classic');
  await revealOpsStaticFixture(page);
  const on = await page.evaluate(() => window.JobOverviewV2.isOn());
  expect(on).toBe(false);
});

test('the staff toggle flips both ways, remembers the choice and strips ?overview=', async ({ page }) => {
  await boot(page, { url: '/ops.html?overview=v2' });
  await openJob(page);
  await expect(page.locator('#ov2Root')).toBeVisible();
  await page.locator('#ov2Toggle').click();
  await expect(page.locator('#ov2Root')).toHaveCount(0);
  await expect(page.locator('#jdOverview')).toContainText('Progress');
  expect(page.url()).not.toContain('overview=');
  expect(page.url()).toContain('#job/SWF-990101');
  expect(await page.evaluate(() => localStorage.getItem('sw_overview_v2'))).toBe('0');
  await page.locator('#jdOverview [data-ov2-act="try"]').click();
  await expect(page.locator('#ov2Root')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sw_overview_v2'))).toBe('1');
  expect(await overviewFetches(page)).toBe(1); // the answer is reused, not read again
});

test('header, files, three columns and the reply box; buttons use the page handlers', async ({ page }) => {
  await boot(page);
  await openJob(page);
  await expect(page.locator('#ov2Root')).toBeVisible();
  // Spies on the page's own handlers, installed after the job page has opened.
  await page.evaluate(() => {
    window.scheduleCallLog = () => { window.__ov2.calls++; };
    window.editClientName = (id, name) => { window.__ov2.edits.push([id, name]); };
    window.showJobSubView = (tab) => { window.__ov2.subviews.push(tab); };
    window.showGlobalInvoicePreview = (inv) => { window.__ov2.previews.push(inv && inv.invoice_number); };
  });
  const cust = page.locator('#ov2Cust');
  await expect(cust).toContainText('Avery Lin');
  await expect(cust).toContainText('12 Sample Street, Testville WA 6000');
  await expect(cust).toContainText('0400 000 001');
  await expect(cust).toContainText('avery@example.test');
  await expect(page.locator('#ov2Value')).toHaveText('$7,065.85');
  await expect(page.locator('#ov2Whose')).toHaveText('Our move');
  await expect(cust).toContainText('Avery $3,794.72');
  await expect(cust).toContainText('Jordan (neighbour) $3,271.13');
  await expect(cust.locator('a', { hasText: 'Email' })).toHaveAttribute('href', 'mailto:avery@example.test');
  await expect(cust.locator('a', { hasText: 'Navigate' })).toHaveAttribute('href', /maps\.google\.com\/\?q=12%20Sample%20Street/);
  await expect(cust.locator('a', { hasText: 'View in GHL' })).toHaveAttribute('href', /\/opportunities\/ghl-opp-e2e-001$/);
  await expect(page.locator('#ov2Timeline')).toBeVisible();
  await expect(page.locator('#ov2Story')).toBeVisible();
  await expect(page.locator('#ov2ConvCol')).toBeVisible();
  await expect(page.locator('#ov2Reply')).toBeVisible();
  // Files: the quote opens its PDF; the draft invoice opens the preview and links to Xero.
  await expect(page.locator('[data-ov2-file^="quote:"]').first().locator('a.ov2-fmain')).toHaveAttribute('href', 'https://example.test/quotes/q-9003.pdf');
  const draft = page.locator('[data-ov2-file^="inv:"]').first();
  await expect(draft.locator('.ov2-flink')).toHaveAttribute('href', `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${IDS.xero2}`);
  await draft.locator('button.ov2-fmain').click();
  await page.locator('[data-ov2-file="photos"] button.ov2-fmain').click();
  await cust.getByRole('button', { name: 'Call' }).click();
  await cust.getByRole('button', { name: 'Edit the customer name' }).click();
  await cust.getByRole('button', { name: 'SMS' }).click();
  await expect(page.locator('#ov2Reply')).toBeFocused();
  const seen = await page.evaluate(() => window.__ov2);
  expect(seen.calls).toBe(1);
  expect(seen.edits).toEqual([[JOB_ID, 'Avery Lin']]);
  expect(seen.subviews).toEqual(['files']);
  expect(seen.previews).toEqual(['INV-9002']);
});

test('job_overview not deployed: header, files and a plain record, "not switched on yet", no page error', async ({ page }) => {
  await boot(page, { overview: 'notdeployed' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openJob(page);
  await expect(page.locator('#ov2StoryState')).toHaveAttribute('data-state', 'notdeployed');
  await expect(page.locator('#ov2StoryState')).toContainText('The story is not switched on yet.');
  await expect(page.locator('#ov2Cust')).toContainText('Avery Lin');
  await expect(page.locator('#ov2Files')).toContainText('Quote Q-9003');
  await expect(page.locator('#ov2Files')).toContainText('Draft, cannot be paid');
  await expect(page.locator('#ov2Timeline')).toContainText('from the job record');
  await expect(page.locator('#ov2ConvBody')).toContainText('latest from the job record');
  await expect(page.locator('#ov2Conv')).toContainText('Will do.');
  await expect(page.locator('#ov2Conv')).not.toContainText('MUST NEVER SHOW');
  expect(errors).toEqual([]);
});

test('job_overview failing: "Story not available right now" with Try again, which reads again', async ({ page }) => {
  await boot(page, { overview: 'error' });
  await openJob(page);
  await expect(page.locator('#ov2StoryState')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#ov2StoryState')).toContainText('Story not available right now.');
  const before = await overviewFetches(page);
  await page.locator('#ov2StoryState').getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => overviewFetches(page)).toBe(before + 1);
});

test('data rules on screen: drafts, deleted invoices, view counts, no machine rows, no long dash', async ({ page }) => {
  await boot(page);
  await openJob(page);
  await expect(page.locator('#ov2Headline')).toHaveText('Deposit stage since today. 1 draft invoice not issued.');
  await expect(page.locator('#ov2Paid')).toHaveText('Invoiced $0.00 \u00b7 Paid $0.00 \u00b7 inc GST');
  await expect(page.locator('#ov2Cust')).toContainText('Draft INV-9002 $3,571.43, not issued');
  const files = page.locator('#ov2Files .ov2-file');
  await expect(files).toHaveCount(9);
  await expect(files.first()).toContainText('opened 15 times');
  await expect(files.nth(1)).toContainText('Draft, cannot be paid');
  await expect(files.last()).toHaveClass(/faded/);
  await expect(files.last()).toContainText('Deleted in Xero');
  const conv = page.locator('#ov2Conv');
  await expect(conv).toContainText('Call to Avery \u00b7 7 seconds \u00b7 8:03am');
  await expect(conv).not.toContainText('TRANSCRIPT');
  await expect(conv).not.toContainText('event listener');
  await expect(page.locator('#ov2ConvBody')).toContainText('9 messages');
  const tl = page.locator('#ov2Timeline');
  await expect(tl).not.toContainText('Document read');
  await expect(tl).not.toContainText('App recorded');
  await expect(tl).toContainText('Quote Q-9001 v1 sent \u00b7 $8,296.75');
  // Tapping a timeline item opens its detail.
  const item = tl.locator('li', { hasText: 'Quote Q-9001 v1 sent' });
  await item.locator('button.ov2-tli').click();
  await expect(item.locator('.ov2-more')).toBeVisible();
  await expect(item.locator('.ov2-more')).toContainText('Opened 6 times in all.');
  // Open items, grouped, with owner tags; the written story is not there yet.
  await expect(page.locator('#ov2Story [data-ov2-group="blocking"]')).toContainText('Blocking 2');
  await expect(page.locator('#ov2Story [data-ov2-group="waiting"]')).toContainText('Waiting on someone 2');
  await expect(page.locator('#ov2Story')).toContainText('REAR NEIGHBOUR');
  await expect(page.locator('#ov2NoText')).toContainText('No written story yet.');
  const text = await page.locator('#jdOverview').innerText();
  expect(text).not.toMatch(/[\u2013\u2014]/);
});

test('a written story shows its sections and when it was written', async ({ page }) => {
  await boot(page, { overviewOpts: { writtenStory: true } });
  await openJob(page);
  await expect(page.locator('#ov2Headline')).toHaveText('Avery has accepted the quote and wants to pay, but there is still no invoice they can pay.');
  await expect(page.locator('#ov2Story')).toContainText('Replace the 23m back and side fence, the old asbestos fence comes out');
  await expect(page.locator('#ov2Story [data-ov2-group="know"]')).toContainText('Good to know 2');
  await expect(page.locator('#ov2Stamp')).toContainText('Story as of');
  await expect(page.locator('#ov2Stamp')).toContainText('rewritten when something new happens');
  await expect(page.locator('#ov2Stamp')).toContainText('AI notes have read everything up to');
  const text = await page.locator('#jdOverview').innerText();
  expect(text).not.toMatch(/[\u2013\u2014]/);
});

test.describe('in a browser far from Perth', () => {
  test.use({ timezoneId: 'Europe/London' });
  test('times still show in Perth time', async ({ page }) => {
    await boot(page);
    await openJob(page);
    const conv = page.locator('#ov2Conv');
    await expect(conv).toContainText('Sam \u00b7 text \u00b7 9:22am');
    await expect(conv).toContainText('Avery \u00b7 text \u00b7 9:26am');
    await expect(conv.locator('.ov2-day').last()).toHaveText('Today');
    await expect(page.locator('#ov2Files .ov2-file').first()).toContainText('6:56am');
  });
});

test('a late job_overview answer for another job paints nothing', async ({ page }) => {
  await boot(page, { overview: 'pending', otherJob: true });
  await openJob(page, JOB_ID);
  await expect(page.locator('#ov2StoryState')).toHaveAttribute('data-state', 'loading');
  await openJob(page, OTHER_JOB_ID);
  await expect(page.locator('#ov2Root')).toHaveAttribute('data-job', OTHER_JOB_ID);
  await expect(page.locator('#ov2Cust')).toContainText('Riley Shaw');
  await page.evaluate((id) => window.__ov2.pending[id](), JOB_ID);
  await page.waitForTimeout(150);
  await expect(page.locator('#ov2Root')).toHaveAttribute('data-job', OTHER_JOB_ID);
  await expect(page.locator('#ov2StoryState')).toHaveAttribute('data-state', 'loading');
  await expect(page.locator('#ov2Headline')).toHaveCount(0);
  await expect(page.locator('#ov2Cust')).toContainText('Riley Shaw');
});

test('the conversation filters, and the choice is remembered', async ({ page }) => {
  await boot(page);
  await openJob(page);
  const conv = page.locator('#ov2Conv');
  await expect(conv.locator('.ov2-b')).toHaveCount(9);
  await filterButton(page, 'Calls').click();
  await expect(conv.locator('.ov2-b')).toHaveCount(1);
  await expect(conv.locator('.ov2-b')).toHaveText('Call to Avery \u00b7 7 seconds \u00b7 8:03am');
  await filterButton(page, 'Email').click();
  await expect(conv.locator('.ov2-b')).toHaveCount(1);
  await expect(conv.locator('.ov2-b.in')).toContainText('Thank you for sending the revised quote');
  await filterButton(page, 'Texts').click();
  await expect(conv.locator('.ov2-b')).toHaveCount(7);
  expect(await page.evaluate(() => localStorage.getItem('sw_ov2_conv_filter'))).toBe('sms');
  await filterButton(page, 'All').click();
  await expect(conv.locator('.ov2-b')).toHaveCount(9);
});

test('Next: "Show the message" finds the cited text; Rewrite asks for a new story', async ({ page }) => {
  await boot(page);
  await openJob(page);
  await filterButton(page, 'Calls').click();
  await page.locator('#ov2Next').getByRole('button', { name: 'Show the message' }).click();
  await expect(page.locator(`#ov2Conv [data-ov2-msg="${IDS.msgAcceptAndPay}"]`)).toHaveClass(/flash/);
  await expect(page.locator('#ov2Next a', { hasText: 'Open draft in Xero' })).toHaveAttribute('href', `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${IDS.xero2}`);
  await page.locator('#ov2Rewrite').click();
  await expect(page.locator('#ov2Asked')).toContainText('Asked at');
  const posts = await page.evaluate(() => window.__ov2.posts);
  expect(posts).toEqual([{ action: 'request_job_story', body: { jobId: JOB_ID } }]);
});

test('the reply box refuses a long dash and sends a plain text through ghl-proxy send_sms', async ({ page }) => {
  const { sent } = await boot(page);
  await openJob(page);
  const box = page.locator('#ov2Reply');
  const send = page.locator('#ov2ReplySend');
  await expect(send).toBeDisabled();
  await box.fill('Hi Avery \u2014 thanks for that');
  await expect(send).toBeDisabled();
  await expect(page.locator('#ov2Why')).toContainText('long dash');
  await box.fill('Hi Avery, thanks for that');
  await expect(send).toBeEnabled();
  await expect(page.locator('#ov2Count')).toHaveText('25/160');
  await send.click();
  await expect(page.locator('#ov2Conv .ov2-b.pending')).toContainText('Hi Avery, thanks for that');
  await expect(box).toHaveValue('');
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toEqual({ contactId: 'ghl-contact-e2e-001', message: 'Hi Avery, thanks for that', jobId: JOB_ID });
  expect(sent[0].auth).toBe('Bearer e2e-ops-token');
});

test('desktop layout: timeline, story and conversation side by side', async ({ page }) => {
  await boot(page);
  await openJob(page);
  await expect(page.locator('#ov2Headline')).toBeVisible();
  const tl = await page.locator('#ov2Timeline').boundingBox();
  const st = await page.locator('#ov2Story').boundingBox();
  const cv = await page.locator('#ov2ConvCol').boundingBox();
  expect(tl.x).toBeLessThan(st.x);
  expect(st.x).toBeLessThan(cv.x);
  expect(Math.abs(tl.y - st.y)).toBeLessThan(2);
  expect(Math.abs(st.y - cv.y)).toBeLessThan(2);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('customer, files, story, timeline, conversation, and nothing wider than the screen', async ({ page }) => {
    await boot(page);
    await openJob(page);
    await expect(page.locator('#ov2Headline')).toBeVisible();
    const y = async (sel) => (await page.locator(sel).boundingBox()).y;
    const order = [await y('#ov2Cust'), await y('#ov2Files'), await y('#ov2Story'), await y('#ov2Timeline'), await y('#ov2ConvCol')];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const overflow = await page.evaluate(() => {
      const root = document.getElementById('ov2Root');
      const out = [];
      root.querySelectorAll('*').forEach((el) => {
        if (el.closest('.ov2-strip')) return; // the files strip scrolls sideways on purpose
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1) out.push(el.className || el.tagName);
      });
      const ov = document.getElementById('jdOverview');
      return { out, wide: ov.scrollWidth > ov.clientWidth };
    });
    expect(overflow).toEqual({ out: [], wide: false });
    // The phone timeline shows the newest eight with a Show all.
    await expect(page.locator('#ov2Timeline .ov2-tlall')).toBeVisible();
    await expect(page.locator('#ov2Timeline li:visible')).toHaveCount(8);
    await page.locator('#ov2Timeline .ov2-tlall').click();
    await expect(page.locator('#ov2Timeline .ov2-tlall')).toHaveCount(0);
  });
});
