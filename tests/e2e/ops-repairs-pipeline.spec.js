// The Repairs board becomes a real pipeline.
//
// The sibling spec (ops-repairs-board.spec.js) guards the board's SHAPE by
// calling renderRepairKanban directly. This one guards its BEHAVIOUR through the
// page's own network code: the tab's feed request, the drag that persists a
// stage, the optimistic move, the revert when the server refuses, and the two
// card fields the SWR- type flip would otherwise have taken away.
//
// Everything is stubbed. installExternalRequestGuard stays armed for the whole
// run, so a mis-wired drag cannot reach production — which matters more here
// than anywhere else in the suite, because the subject IS a write.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');
const { installFeedStubs, installExternalRequestGuard } = require('../helpers/feed-stub');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const APP_ORIGIN = new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:4173').origin;

// Nine columns plus the Quote/Job group gap are wider than a standard viewport.
test.use({ viewport: { width: 2200, height: 950 } });

const SHOT_DIR = process.env.REPAIRS_SHOT_DIR ||
  path.resolve(__dirname, '..', '..', 'test-results', 'ops-repairs-pipeline');

// The feed shape ops-api returns for pipeline?type=repair: columns keyed by raw
// jobs.status, each row already carrying a TOP-LEVEL repair_stage.
function repairFeed() {
  return {
    columns: {
      accepted: [
        {
          id: 'r1', type: 'repair', job_type: 'repair', family: 'repair', ses_family: 'repair',
          source_type: 'repair', status: 'accepted', repair_stage: 'wo_in',
          job_number: 'SWR-261400', client_name: 'Vanessa Whitfield', site_suburb: 'Midland',
          site_address: '12 Great Eastern Hwy', value: 4820, days_in_stage: 1,
          assignment_count: 0, po_count: 0, wo_count: 0,
        },
        {
          id: 'r2', type: 'repair', job_type: 'repair', family: 'repair', ses_family: 'repair',
          source_type: 'repair', status: 'accepted', repair_stage: 'quoted',
          job_number: 'SWR-261402', client_name: 'Deniz Karaca', site_suburb: 'Scarborough',
          site_address: '8 Brighton Rd', value: 12750, days_in_stage: 6,
          assignment_count: 0, po_count: 1, wo_count: 1,
        },
      ],
      processing: [
        // Legacy card: no stamp at all, so the status map must place it On Site.
        {
          id: 'r3', type: 'repair', job_type: 'repair', family: 'repair', ses_family: 'repair',
          source_type: 'makesafe', status: 'processing',
          job_number: 'SWMS-261029', client_name: 'Peta Nguyen', site_suburb: 'Falcon',
          site_address: '3 Cormorant Way', value: 2310, days_in_stage: 19,
          assignment_count: 1, po_count: 0, wo_count: 1,
        },
        // A status this board has never had a column for: it must stay VISIBLE in
        // the red Unmapped lane rather than vanish.
        {
          id: 'r4', type: 'repair', job_type: 'repair', family: 'repair', ses_family: 'repair',
          source_type: 'repair', status: 'cancelled',
          job_number: 'SWR-261405', client_name: 'Hollis Trent', site_suburb: 'Boddington',
          site_address: '41 Bannister Rd', value: 0, days_in_stage: 3,
        },
      ],
      scheduled: [
        {
          id: 'r5', type: 'repair', job_type: 'repair', family: 'repair', ses_family: 'repair',
          source_type: 'repair', status: 'scheduled', repair_stage: 'materials',
          job_number: 'SWR-261407', client_name: 'Marguerite Oyelaran', site_suburb: 'Kalamunda',
          site_address: '7 Heath Rd', value: 8100, days_in_stage: 2,
          assignment_count: 1, po_count: 2, wo_count: 1, first_scheduled_date: '2026-09-02',
        },
      ],
    },
    total: 5,
  };
}

// A patio row that the feed must never be trusted to have filtered.
function feedWithPatio() {
  const feed = repairFeed();
  feed.columns.accepted.push({
    id: 'p1', type: 'patio', status: 'accepted', job_number: 'SWP-26100',
    client_name: 'Not A Repair', site_suburb: 'Fremantle', value: 30000, days_in_stage: 5,
  });
  return feed;
}

/**
 * Boot ops.html on a fully stubbed network with the external guard armed, sign
 * the operator in through the persisted-session stub, and open the Repairs tab
 * the way a user does — a real click on the tab.
 */
async function openRepairsBoard(page, options = {}) {
  const feed = options.feed || repairFeed();
  const requestLog = [];
  const stageWrites = [];
  const stageResponse = options.stageResponse || null;

  const guard = await installExternalRequestGuard(page, { allowedOrigins: [APP_ORIGIN] });
  await installOpsSessionStub(page);

  const stubs = await installFeedStubs(page, {
    endpoint: OPS_API,
    requestLog,
    allowedWriteActions: ['update_repair_stage'],
    actions: {
      pipeline: () => feed,
      update_repair_stage: ({ request }) => {
        const body = request.postDataJSON();
        stageWrites.push(body);
        if (stageResponse) return stageResponse;
        // Mirror the real handler: move the row in the feed so the reload after a
        // successful write shows the server's own answer, not the optimistic one.
        Object.values(feed.columns).forEach((rows) => {
          (rows || []).forEach((row) => {
            if (row.id === body.jobId) row.repair_stage = body.stage;
          });
        });
        return { success: true, job: { id: body.jobId, repair_stage: body.stage } };
      },
      // ops.html's own boot reads. Stubbed empty so the Repairs assertions are
      // never reading a page mid-error-toast.
      ops_summary: {
        stat_cards: { pipeline: {} }, kpis: {}, today_schedule: [], deliveries_today: [],
      },
      dashboard_summary: { summary: {} },
      list_users: { users: [] },
      ops_targets: { targets: [] },
      list_proposed_actions: { actions: [] },
      list_nudges: { nudges: [] },
    },
  });

  // The operator profile read ops.html makes on boot.
  await page.route(`${SUPABASE_ORIGIN}/functions/v1/ghl-proxy**`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      profile: {
        id: '00000000-0000-4000-8000-000000000099',
        email: 'ops-e2e@example.test',
        name: 'E2E Ops',
        role: 'ops_manager',
        org_id: '00000000-0000-0000-0000-000000000001',
      },
    }),
  }));

  // The three CDN scripts ops.html loads. Stubbed rather than blocked so the
  // external guard's ledger stays empty and a genuine leak still stands out.
  for (const pattern of [
    'https://cdn.jsdelivr.net/npm/chart.js@4',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdnjs.cloudflare.com/**',
  ]) {
    await page.route(pattern, (route) => route.fulfill({
      status: 200, contentType: 'application/javascript',
      body: 'window.jspdf = window.jspdf || {}; window.Chart = window.Chart || function () {};',
    }));
  }

  await page.goto('/ops.html');
  await page.evaluate(() => {
    // The auth gate injects a stylesheet that hides everything but itself with
    // !important. The persisted-session stub is what signs the operator in; this
    // just takes the overlay off so the shell is measurable. Same reveal the
    // sibling repairs spec uses.
    const gate = document.getElementById('swAuthGate');
    const style = document.getElementById('swAuthGateStyle');
    if (gate) gate.remove();
    if (style) style.remove();
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    // The Jobs view ships position:fixed behind that gate, which Playwright
    // treats as not visible. Put it in normal flow at a real height.
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.remove('active');
      v.style.display = 'none';
    });
    const jobs = document.getElementById('viewJobs');
    if (jobs) {
      jobs.classList.add('active');
      jobs.style.cssText = 'display:flex;flex-direction:column;position:static;top:auto;left:auto;right:auto;bottom:auto;height:820px;z-index:1;padding:16px 24px 0;background:var(--sw-bg,#F4F1EE);';
    }
  });

  await page.locator('[data-pipeline="repairs"]').click();
  await expect(page.locator('#jobsBody .repair-kanban')).toBeVisible();
  await expect(page.locator('.kanban-card[data-job-id="r1"]')).toBeVisible();

  return { feed, requestLog, stageWrites, guard, stubs };
}

function columnOf(page, jobId) {
  return page.evaluate((id) => {
    const card = document.querySelector('.kanban-card[data-job-id="' + id + '"]');
    if (!card) return null;
    const col = card.closest('.kanban-col');
    if (!col) return null;
    const header = col.querySelector('.kanban-col-header');
    return {
      column: header ? header.childNodes[0].textContent.trim() : '',
      dataStatus: col.getAttribute('data-status'),
      cardStatus: card.getAttribute('data-status'),
    };
  }, jobId);
}

// A REAL drag. Chromium's browser-side drag controller turns trusted pointer
// input into the native HTML5 dragstart/dragover/drop sequence — the same
// precedent cal-drag-real-input.spec.js set after synthetic events passed 15/15
// on a build no user could actually drag.
async function realDrag(page, source, target) {
  // Both endpoints must be settled before the press: a bounding box measured
  // mid-repaint produces a drag that starts nowhere and silently does nothing.
  await source.waitFor({ state: 'visible' });
  await target.waitFor({ state: 'visible' });
  const src = await source.boundingBox();
  const dst = await target.boundingBox();
  if (!src || !dst) throw new Error('drag endpoints are not visible');
  const sx = src.x + src.width / 2;
  const sy = src.y + src.height / 2;
  const dx = dst.x + dst.width / 2;
  const dy = dst.y + Math.min(dst.height / 2, 120);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let step = 1; step <= 25; step++) {
    await page.mouse.move(sx + ((dx - sx) * step) / 25, sy + ((dy - sy) * step) / 25);
  }
  await page.waitForTimeout(200);
  await page.mouse.up();
}

test('the Repairs tab asks the backend for the repair feed, signed in', async ({ page }) => {
  const { requestLog, guard } = await openRepairsBoard(page);

  const pipelineReads = requestLog.filter((entry) => entry.action === 'pipeline');
  expect(pipelineReads.length).toBeGreaterThan(0);
  const params = new URL(pipelineReads[pipelineReads.length - 1].url).searchParams;
  expect(params.get('action')).toBe('pipeline');
  expect(params.get('type')).toBe('repair');
  expect(pipelineReads[pipelineReads.length - 1].authorization).toBe('Bearer e2e-ops-access-token');
  expect(guard.blockedRequests).toEqual([]);
});

test('every repair row lands in the column its stage names, and nothing else does', async ({ page }) => {
  await openRepairsBoard(page, { feed: feedWithPatio() });

  // A persisted stage wins outright.
  expect((await columnOf(page, 'r1')).column).toBe('WO In');
  expect((await columnOf(page, 'r2')).column).toBe('Quoted');
  expect((await columnOf(page, 'r5')).column).toBe('Materials');
  // No stamp: the status map places it. 'processing' -> On Site.
  expect((await columnOf(page, 'r3')).column).toBe('On Site');
  // 'cancelled' has no repair column. It must stay visible, not vanish.
  expect((await columnOf(page, 'r4')).column).toBe('Stage unknown');
  // The patio row the feed included is not repair work and must be dropped.
  expect(await columnOf(page, 'p1')).toBeNull();

  const headers = await page.$$eval(
    '#jobsBody .repair-kanban .kanban-col-header',
    (els) => els.map((el) => el.childNodes[0].textContent.trim()),
  );
  expect(headers.slice(0, 9)).toEqual([
    'WO In', 'Scoping', 'Quoted', 'Variation', 'Approved',
    'Materials', 'Scheduled', 'On Site', 'Complete',
  ]);
});

test('a repair card shows its SWR- number and its suburb', async ({ page }) => {
  await openRepairsBoard(page);
  const card = page.locator('.kanban-card[data-job-id="r1"]');
  // jobs.type flipped from 'makesafe' to 'repair'; the suburb line was gated on
  // the old type and would silently have disappeared from every repair card.
  await expect(card.locator('.kanban-suburb')).toHaveText('Midland');
  // The operator reconciles against a builder work order, so the number is on
  // the card face rather than only in the list view and the drawer.
  await expect(card.locator('.kanban-jobnum')).toHaveText('SWR-261400');
  await expect(page.locator('.kanban-card[data-job-id="r3"] .kanban-jobnum'))
    .toHaveText('SWMS-261029');
});

test('dragging a repair card writes update_repair_stage and moves it', async ({ page }, testInfo) => {
  const { requestLog, stageWrites, guard, stubs } = await openRepairsBoard(page);

  await realDrag(
    page,
    page.locator('.kanban-card[data-job-id="r1"]'),
    page.locator('.kanban-col[data-status="repair_scoping"]'),
  );

  await expect.poll(() => stageWrites.length, {
    message: 'a real drag on the Repairs board must persist a stage',
  }).toBe(1);
  expect(stageWrites[0].jobId).toBe('r1');
  expect(stageWrites[0].stage).toBe('scoping');
  // opsPost stamps the operator onto every dashboard write, so the backend audit
  // entry gets attribution for free.
  expect(Object.prototype.hasOwnProperty.call(stageWrites[0], 'operator_email')).toBe(true);

  // The nine board stages must NEVER be pushed through jobs.status.
  expect(requestLog.filter((entry) => entry.action === 'update_job_status')).toEqual([]);
  expect(stubs.unexpectedWrites).toEqual([]);
  expect(guard.blockedRequests).toEqual([]);

  await expect.poll(async () => (await columnOf(page, 'r1'))?.column).toBe('Scoping');

  // Evidence shot. Let the horizontal scroller size to its content so all nine
  // columns, both section labels and the Unmapped lane land in one image.
  await page.evaluate(() => {
    const container = document.getElementById('jobsBody');
    if (container) container.style.overflow = 'visible';
    const board = container && container.querySelector('.repair-kanban');
    if (board) { board.style.overflow = 'visible'; board.style.width = 'max-content'; }
  });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.locator('#jobsBody .repair-kanban').screenshot({
    path: path.join(SHOT_DIR, 'ui-repairs-board.png'),
  });
  testInfo.attach && (await testInfo.attach('repairs-board', {
    path: path.join(SHOT_DIR, 'ui-repairs-board.png'),
    contentType: 'image/png',
  }));
});

test('a refused stage move puts the card back where the server says it lives', async ({ page }) => {
  const { stageWrites } = await openRepairsBoard(page, {
    stageResponse: {
      status: 409,
      body: { error: 'job SWR-261400 is not a repair-family job' },
    },
  });

  await realDrag(
    page,
    page.locator('.kanban-card[data-job-id="r1"]'),
    page.locator('.kanban-col[data-status="repair_quoted"]'),
  );

  await expect.poll(() => stageWrites.length).toBe(1);
  // Optimism is not a claim: a failed write must not leave the operator
  // believing the card moved.
  await expect.poll(async () => (await columnOf(page, 'r1'))?.column).toBe('WO In');
  // The operator is told why, in the server's own words.
  await expect(
    page.locator('.toast').filter({ hasText: 'Failed to move repair' }),
  ).toContainText('not a repair-family job');
});

test('a card whose stage and status disagree says so on its face', async ({ page }) => {
  // Once dragged, repair_stage beats jobs.status forever. A card moved to
  // Scoping and then completed by any other path would sit in Scoping with
  // nothing to say otherwise — drift nobody sees for six weeks. The column still
  // belongs to the human who dragged it; the card just stops hiding it.
  const drifting = repairFeed();
  drifting.columns.processing[0].repair_stage = 'scoping'; // r3, status 'processing'
  await openRepairsBoard(page, { feed: drifting });

  await expect(
    page.locator('.kanban-card[data-job-id="r3"] .kanban-stage-drift'),
  ).toHaveText('status: On Site');
  // The human's placement still wins.
  expect((await columnOf(page, 'r3')).column).toBe('Scoping');

  // CONTROL: agreement is silent, and no non-repair card ever grows the chip.
  const agreeing = repairFeed();
  agreeing.columns.accepted[0].status = 'scoping';
  agreeing.columns.accepted[0].repair_stage = 'scoping';
  await openRepairsBoard(page, { feed: agreeing });
  await expect(
    page.locator('.kanban-card[data-job-id="r1"] .kanban-stage-drift'),
  ).toHaveCount(0);
});

test('the Unmapped lane is a diagnosis, not a stage: nothing can be dropped into it', async ({ page }) => {
  await openRepairsBoard(page);
  const unmapped = page.locator('.kanban-col[data-status="repair_unmapped"]');
  await expect(unmapped).toHaveCount(1);
  const wired = await unmapped.evaluate((el) => ({
    over: !!el.getAttribute('ondragover'),
    drop: !!el.getAttribute('ondrop'),
  }));
  expect(wired).toEqual({ over: false, drop: false });

  const scoping = page.locator('.kanban-col[data-status="repair_scoping"]');
  const wiredScoping = await scoping.evaluate((el) => ({
    over: !!el.getAttribute('ondragover'),
    drop: !!el.getAttribute('ondrop'),
  }));
  expect(wiredScoping).toEqual({ over: true, drop: true });
});

test('the drawer offers a repair job no conflicting jobs.status buttons', async ({ page }) => {
  await openRepairsBoard(page);
  // getNextStatuses drove three separate button rows off the generic patio
  // ladder for anything it did not recognise. A repair job now gets none of
  // them, so the board columns are the only stage authority.
  const offered = await page.evaluate(() => ({
    repairAccepted: getNextStatuses('accepted', 'repair'),
    repairInProgress: getNextStatuses('in_progress', 'repair'),
    repairComplete: getNextStatuses('complete', 'repair'),
    patio: getNextStatuses('accepted', 'patio'),
    makesafe: getNextStatuses('accepted', 'makesafe'),
  }));
  // Repair gets its own small lawful spine, NOT the patio money ladder: no
  // approvals, no deposit, no get_review. Offering nothing at all would be its
  // own hole — complete_and_invoice refuses anything still at 'accepted', so a
  // repair with no status control could never be invoiced.
  expect(offered.repairAccepted).toEqual(['processing']);
  expect(offered.repairInProgress).toEqual(['complete']);
  expect(offered.repairComplete).toEqual(['invoiced']);
  const everyRepairOption = [
    ...offered.repairAccepted, ...offered.repairInProgress, ...offered.repairComplete,
  ];
  for (const patioOnly of ['approvals', 'awaiting_deposit', 'deposit', 'get_review']) {
    expect(everyRepairOption).not.toContain(patioOnly);
  }
  // CONTROL: every other type is untouched.
  expect(offered.patio).toEqual(['approvals', 'processing']);
  expect(offered.makesafe).toEqual(['approvals', 'processing']);

  const stages = await page.evaluate(() => ({
    repair: SW_STATE_MACHINE.getStagesForType('repair'),
    patio: SW_STATE_MACHINE.getStagesForType('patio'),
    fencing: SW_STATE_MACHINE.getStagesForType('fencing'),
  }));
  // No longer PATIO_STAGES: a repair job was being offered a patio money ladder.
  expect(stages.repair).not.toEqual(stages.patio);
  expect(stages.repair).toContain('accepted');
  expect(stages.repair).toContain('processing');
  expect(stages.repair).not.toContain('approvals');
  expect(stages.repair).not.toContain('get_review');
  // CONTROL: the two busiest verticals are unchanged.
  expect(stages.patio).toContain('approvals');
  expect(stages.fencing).toContain('order_confirmed');
});
