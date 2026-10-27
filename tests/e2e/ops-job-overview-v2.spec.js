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
async function boot(page, { url = '/ops.html?overview=v2', staff = true, overview = 'ok', overviewOpts = {}, overviewData = null, detailOpts = {}, storage = null, otherJob = false } = {}) {
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
  const ov = overviewData || buildJobOverview(overviewOpts);
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
  await expect(page.locator('#ov2Files')).toContainText('Draft in Xero, cannot be paid');
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
  await expect(page.locator('#ov2Story .ov2-story-head')).toContainText('Job story, built');
  await expect(page.locator('#ov2Story .ov2-story-now')).toContainText("Where it's at");
  await expect(page.locator('#ov2Story .ov2-story-moments li')).toHaveCount(4);
  await expect(page.locator('#ov2Story .ov2-story-money>div').first()).toContainText('Not recorded');
  await expect(page.locator('#ov2Story .ov2-story-money>div').nth(1)).toContainText('$0.00');
  await expect(page.locator('#ov2Story .ov2-story-last')).toContainText('Customer said');
  // No overview not_seen in this fixture: the standing lines still show, never "Nothing listed".
  await expect(page.locator('#ov2Story .ov2-story-unknown')).toContainText('Material orders and deliveries are not recorded here.');
  await expect(page.locator('#ov2Story .ov2-story-unknown')).toContainText('Crew tasks and GHL notes are not captured.');
  await expect(page.locator('#ov2Story .ov2-story-unknown')).not.toContainText('Nothing listed');
  await expect(page.locator('#ov2Paid')).toHaveText('Invoiced $0.00 \u00b7 Paid (Xero) $0.00 \u00b7 inc GST');
  await expect(page.locator('#ov2Cust')).toContainText('Draft INV-9002 $3,571.43, draft in Xero');
  const files = page.locator('#ov2Files .ov2-file');
  await expect(files).toHaveCount(9);
  await expect(files.first()).toContainText('opened 15 times');
  await expect(files.nth(1)).toContainText('Draft in Xero, cannot be paid');
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
  await page.locator('.ov2-story-more summary').click();
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
  const reads = await overviewFetches(page);
  await page.locator('#ov2Story .ov2-story-head').getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => overviewFetches(page)).toBe(reads + 1);
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


test('live quote envelope paints its recorded value and view count', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const fetch = window.opsFetch;
    window.opsFetch = async (...args) => {
      const data = await fetch(...args);
      if (args[0] === 'job_overview') data.files.quotes = { documents: data.files.quotes.map(q => ({ ...q, value_inc_gst: 1735.25 })) };
      return data;
    };
  });
  await openJob(page);
  await expect(page.locator('#ov2Story .ov2-story-money>div').first()).toContainText('$1,735.25');
  await expect(page.locator('#ov2Files .ov2-file').first()).toContainText('opened 15 times');
});

test('writer off is named without offering Rewrite; off response never says Asked', async ({ page }) => {
  await boot(page);
  await openJob(page);
  await page.evaluate(() => { window.opsPost = async () => ({ outcome: 'off' }); });
  await page.locator('#ov2Rewrite').click();
  await expect(page.locator('#ov2Asked')).toHaveText('Rewriting is not switched on yet.');
  await expect(page.locator('#ov2Asked')).not.toContainText('Asked at');
  await page.evaluate(() => {
    const entry = window.JobOverviewV2._state.cache[_currentJobData.job.id];
    entry.data.story_text.writer.on = false;
    renderOverviewView(_currentJobData);
  });
  await expect(page.locator('#ov2WriterOff')).toContainText('not switched on yet');
  await expect(page.locator('#ov2Rewrite')).toHaveCount(0);
});

test('partial source failure and a failed refresh are visible while the job stays usable', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const fetch = window.opsFetch;
    window.opsFetch = async (...args) => {
      const data = await fetch(...args);
      if (args[0] === 'job_overview') {
        data.messages = null;
        data.sources = { messages: { ok: false, state: 'failed' }, story_text: { ok: false, state: 'not_deployed' } };
      }
      return data;
    };
  });
  await openJob(page);
  await expect(page.locator('#ov2ReadNotice')).toContainText('Could not read: conversation, written story.');
  await expect(page.locator('#ov2Cust')).toContainText('Avery Lin');
  await page.evaluate(() => { window.opsFetch = async () => { throw new Error('offline'); }; });
  await page.locator('#ov2Story').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#ov2ReadNotice')).toContainText('Refresh failed. Showing the previous read.');
});

// Independent card audit regressions. People, ids and wording are invented;
// the issued/paid pairs retain the six audited arithmetic cases.
test('B1: held messages stay readable and explicitly uncertain, outside job facts', async ({ page }) => {
  const ov = buildJobOverview();
  const at = ov.messages[0].at;
  ov.story_text = { text: null, writer: { on: false } };
  ov.story.held_messages = { count: 28, shown: 3, certainty: 'job_not_certain', items: [
    { id: 'held-text', at, channel: 'sms', kind: 'message', from: 'Morgan Vale', from_role: 'customer', text: 'Please check the bank payment before asking again. <script>unsafe()</script>', held_because: 'the customer has several jobs', other_jobs: ['SWF-990303'], job_certain: false, cut: true },
    { id: 'held-summary', at, channel: 'call', kind: 'call.transcript_completed', from: 'Morgan Vale', text: 'RAW PRIVATE TRANSCRIPT', summary: 'Sam promised to send the formal quote.', held_because: 'the job is not certain', other_jobs: [], job_certain: false },
    { id: 'held-call', at, channel: 'call', kind: 'transcript', text: 'RAW PRIVATE TRANSCRIPT', job_certain: false },
  ] };
  // The backend also puts held rows into messages[], marked job_certain: false.
  ov.messages.push({ id: 'held-in-conv', at, channel: 'sms', direction: 'outbound', party: 'us', who: 'Us', text: 'Deposit for the other fencing project.', job_certain: false, label: 'Held message, job not certain' });
  await boot(page, { overviewData: ov });
  await openJob(page);
  const heldBubble = page.locator('#ov2Conv [data-ov2-msg="held-in-conv"]');
  await expect(heldBubble).toHaveClass(/held/);
  await expect(heldBubble).toContainText('Job not certain: may belong to another job');
  await expect(page.locator('.ov2-story-last')).not.toContainText('other fencing project');
  const held = page.locator('#ov2Held');
  await expect(held).toContainText('3 of 28 messages shown');
  await expect(held).toContainText('Job not certain');
  await expect(held).toContainText('Please check the bank payment');
  await expect(held).toContainText('Sam promised to send the formal quote');
  await expect(held).toContainText('Other possible jobs: SWF-990303');
  await expect(held).toContainText('Call summary unavailable');
  await expect(held).toContainText('Only part of this source was returned');
  await expect(held.locator('script')).toHaveCount(0);
  await expect(page.locator('#ov2Root')).not.toContainText('RAW PRIVATE TRANSCRIPT');
  await expect(page.locator('#ov2Conv')).not.toContainText('Please check the bank payment');
  expect(await page.locator('.ov2-open').allTextContents()).not.toEqual(expect.arrayContaining([expect.stringContaining('Sam promised to send the formal quote')]));
  await expect(page.locator('.ov2-story-last')).not.toContainText('Please check the bank payment');
  await expect(page.locator('#ov2WriterOff')).toBeVisible();
  expect(await page.evaluate(() => window.__ov2.posts)).toEqual([]);
  if (process.env.OV2_PROOF_DIR) await held.screenshot({ path: process.env.OV2_PROOF_DIR + '/held-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(held).toBeVisible();
  expect(await page.locator('#ov2Root').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  if (process.env.OV2_PROOF_DIR) await held.screenshot({ path: process.env.OV2_PROOF_DIR + '/held-phone.png' });
});

test('B2: future money keeps its hold and trigger visible, including an unknown amount', async ({ page }) => {
  for (const amount of [5248.69, 687.50, null]) {
    const ov = buildJobOverview();
    const why = 'Held until the work is complete. No completion invoice is owed now.';
    ov.story.loops = [{ key: 'future', rule: 'R8_not_yet_invoiced', status: 'not_due', group: 'blocking', owner: 'us', what: 'Future instalment', why, closes_when: 'Issued invoices reach the contract value' }];
    ov.story.money.not_yet_invoiced = { amount, unconfirmed: amount === null, held: true, status: 'not_due', basis: 'Completion instalment, held until the work is complete, not owed now' };
    await boot(page, { overviewData: ov });
    await openJob(page);
    await expect(page.locator('#ov2FutureMoney')).toContainText(amount === null ? 'Future amount unconfirmed' : amount.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' }));
    await expect(page.locator('#ov2FutureMoney')).toContainText('Held, not owed now');
    await expect(page.locator('#ov2FutureMoney')).toContainText('held until the work is complete');
    await expect(page.locator('[data-ov2-group="blocking"]')).toHaveCount(0);
    await expect(page.locator('[data-ov2-group="know"]')).toBeVisible();
    await expect(page.locator('.ov2-it > .ov2-im').filter({ hasText: why })).toBeVisible();
    await expect(page.locator('.ov2-own')).toHaveText('HELD');
    await expect(page.locator('#ov2Paid')).toContainText('Invoiced $0.00');
  }
});

test('B3: conflicting prices are qualified beside the value; all six issued and paid pairs survive', async ({ page }) => {
  test.setTimeout(60000);
  const pairs = [[4763, 2381.50, 1190.75], [10497.38, 5248.69, 5248.69], [6298.71, 3790.60, 3790.60], [1375, 687.50, 687.50], [22299.71, 7783.20, 7783.20], [4671.52, 0, 0]];
  for (const [value, issued, paid] of pairs) {
    const ov = buildJobOverview();
    ov.story.money.job_value = { amount: value, basis: 'pricing_json.totalIncGST' };
    ov.story.money.parties = [{ invoiced: issued, paid, invoices: [] }];
    const alternative = value === 6298.71 ? 3790.60 : value === 22299.71 ? 12972 : null;
    ov.story.checks = alternative ? [{ rule: 'C2_value_mismatch', what: `The recorded scope conflicts with the contract amount $${alternative.toFixed(2)} in the invoice evidence.`, cites: [{ t: 'xero_invoices', id: 'invented-invoice' }] }] : [];
    await boot(page, { overviewData: ov });
    await openJob(page);
    const money = (v) => v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
    await expect(page.locator('#ov2Value')).toHaveText(alternative ? 'Unconfirmed' : money(value));
    if (alternative) {
      await expect(page.locator('#ov2ValueCheck')).toContainText(money(value));
      await expect(page.locator('#ov2ValueCheck')).toContainText('Saved scope price');
      await expect(page.locator('#ov2ValueCheck')).toContainText(`$${alternative.toFixed(2)}`);
      await expect(page.locator('#ov2ValueCheck')).toContainText('not a confirmed contract value');
      if (value === 6298.71 && process.env.OV2_PROOF_DIR) await page.locator('#ov2Cust').screenshot({ path: process.env.OV2_PROOF_DIR + '/price-conflict.png' });
    }
    await expect(page.locator('#ov2Paid')).toHaveText(`Invoiced ${money(issued)} \u00b7 Paid (Xero) ${money(paid)} \u00b7 inc GST`);
    await expect(page.locator('.ov2-story-money > div').nth(1)).toContainText(money(issued));
    await expect(page.locator('.ov2-story-money > div').nth(2)).toContainText(money(paid));
  }
  for (const mode of ['pending', 'error']) {
    await boot(page, { overview: mode });
    await openJob(page);
    await expect(page.locator('#ov2Value')).toHaveText('Not checked');
    await expect(page.locator('#ov2ValueCheck')).toContainText('Recorded value $7,065.85');
    await expect(page.locator('#ov2ValueCheck')).toContainText('The story card has not checked this contract value');
  }
});

test('B4: Last word follows the customer exchange, never newer supplier or held words', async ({ page }) => {
  const ov = buildJobOverview();
  const at = ov.messages[0].at;
  ov.story.last_exchange = {
    customer_said: { at, channel: 'sms', text: 'Morgan asks about the agreed Wednesday visit.' },
    we_told_customer: { at, channel: 'sms', text: 'Sam will check the visit date with Morgan.' },
  };
  ov.messages.push(
    { id: 'supplier-in', at: new Date().toISOString(), channel: 'email', direction: 'inbound', party: 'other', who: 'Supplier', text: 'Cedar Supplies confirms delivery Thursday.' },
    { id: 'supplier-out', at: new Date().toISOString(), channel: 'email', direction: 'outbound', party: 'us', who: 'Us', text: 'Please confirm delivery, Cedar Supplies.' },
  );
  await boot(page, { overviewData: ov });
  await openJob(page);
  const last = page.locator('.ov2-story-last');
  await expect(last).toContainText('Morgan asks about the agreed Wednesday visit.');
  await expect(last).toContainText('Sam will check the visit date with Morgan.');
  await expect(last).not.toContainText('Cedar Supplies');
  await expect(page.locator('#ov2Conv')).toContainText('Cedar Supplies');
  const exchange = await page.evaluate(() => {
    const supplier = [{ channel: 'email', direction: 'outbound', party: 'us', text: 'Supplier order' }];
    return {
      missing: JobOverviewV2Core.customerExchange({}, supplier),
      explicitNull: JobOverviewV2Core.customerExchange({ last_exchange: { customer_said: null, we_told_customer: null } }, [{ channel: 'sms', direction: 'inbound', party: 'customer', text: 'Do not replace canonical null' }]),
      call: JobOverviewV2Core.customerExchange({ last_exchange: { customer_said: { event_type: 'call.transcript_completed', text: 'PRIVATE WORDS' } } }, supplier),
      known: JobOverviewV2Core.customerExchange({}, [{ channel: 'sms', direction: 'outbound', customer_party: true, text: 'Confirmed customer message' }]),
    };
  });
  expect(exchange.missing).toEqual({ customer: null, us: null });
  expect(exchange.explicitNull).toEqual({ customer: null, us: null });
  expect(exchange.call.customer.text).toContain('Transcript words are not shown');
  expect(exchange.known.us.text).toBe('Confirmed customer message');
});

test('CTX-T22: placed-by provenance, the Matching count with its way there, and the not-seen lines', async ({ page }) => {
  const ov = buildJobOverview();
  ov.not_seen = [
    { key: 'material_orders', text: 'Material orders and deliveries are not recorded here.' },
    { key: 'crew_tasks_and_crm_notes', text: 'Crew tasks and GHL notes are not captured.' },
  ];
  ov.matching = { waiting: 3, more: false, left_off_daily_list: 1 };
  ov.sources = Object.assign({}, ov.sources, { matching: { ok: true, state: 'ok', count: 3 } });
  const placed = ov.messages.find((x) => x.id === IDS.msgAcceptAndPay);
  placed.placed_by_person = {
    action: 'split', decision_id: 'dec-e2e-1', decided_at: '2026-10-21T01:40:00Z', decided_at_perth: 'Wed 21 Oct, 9:40am',
    decided_by_name: 'Sam Field', other_job_numbers: ['SWF-990202'], evidence_hash: 'sha256:abc123',
  };
  await boot(page, { overviewData: ov });
  await openJob(page);
  const bubble = page.locator(`#ov2Conv [data-ov2-msg="${IDS.msgAcceptAndPay}"] .ov2-bplaced`);
  await expect(bubble).toHaveText('Split onto this job by Sam Field in Matching, Wed 21 Oct, 9:40am. Also on SWF-990202.');
  await expect(bubble).toHaveAttribute('data-ov2-evidence', 'sha256:abc123');
  await expect(bubble).toHaveAttribute('data-ov2-decision', 'dec-e2e-1');
  await expect(page.locator('#ov2Conv .ov2-bplaced')).toHaveCount(1);
  await expect(page.locator('#ov2DecisionsUnread')).toHaveCount(0);
  const unknown = page.locator('#ov2Unknown');
  await expect(unknown.locator('[data-ov2-not-seen]')).toHaveCount(2);
  const matching = page.locator('#ov2Matching');
  await expect(matching).toHaveAttribute('data-ov2-matching', 'waiting');
  await expect(matching).toHaveAttribute('data-ov2-waiting', '3');
  await expect(matching).toContainText('3 messages wait in Matching for a person to say which job they belong to.');
  await expect(matching).toContainText('1 of them is not on the daily list; Find by job shows it.');
  await page.evaluate(() => { window.__reconOpened = []; window.reconOpenJob = (n) => window.__reconOpened.push(n); });
  await matching.getByRole('button', { name: 'Open in Matching' }).click();
  expect(await page.evaluate(() => window.__reconOpened)).toEqual(['SWF-990101']);
  expect(await page.evaluate(() => window.__ov2.posts)).toEqual([]);
});

test('CTX-T22: a failed Matching read and a failed decisions read say so, never nothing waiting', async ({ page }) => {
  const ov = buildJobOverview();
  ov.matching = null;
  ov.sources = Object.assign({}, ov.sources, {
    matching: { ok: false, state: 'failed', count: 0, code: 'rpc_failed' },
    messages: Object.assign({}, (ov.sources || {}).messages || { ok: true, state: 'ok', count: 9 }, { decisions: 'unread' }),
  });
  await boot(page, { overviewData: ov });
  await openJob(page);
  const matching = page.locator('#ov2Matching');
  await expect(matching).toHaveAttribute('data-ov2-matching', 'failed');
  await expect(matching).toHaveText('Could not read how many messages wait in Matching for this job.');
  await expect(matching.getByRole('button')).toHaveCount(0);
  await expect(page.locator('#ov2DecisionsUnread')).toContainText('Matching decisions could not be read.');
});
