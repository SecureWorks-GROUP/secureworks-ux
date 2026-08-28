const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Regression guard + DOM/screenshot proof for the Insurance Repairs board — a NEW,
// parallel pipeline tab in ops.html that is NOT the make-safe (SES) board. See the
// <insurance-repairs-board> block in ops.html.
//
// Contract under guard (captain UI lock):
//  - A "Repairs" pipeline tab sits next to "Patio".
//  - The board is ONE cohesive LIGHT kanban with exactly nine columns, left to
//    right: WO In, Scoping, Quoted, Variation, Approved, Materials, Scheduled,
//    On Site, Complete. A quiet "Quote"/"Job" section label sits over the two
//    halves. There is NO dark Sales column / sales drawer.
//  - Repair-family rows land in this board; the make-safe board's own placement is
//    untouched (repair rows never render into Docs Ready / TRI here).

// The nine repair columns plus the "Quote"/"Job" group gap are wider than a
// standard viewport, so these proofs use a wide window and screenshot the full
// .repair-kanban element (Playwright captures its full bounding box).
test.use({ viewport: { width: 2200, height: 900 } });

// Screenshots go to test-results by default. They used to be written straight
// into the committed docs/evidence/insurance-repairs-board-2026-08-13/ folder,
// which meant every run of this suite — on any machine, with any font stack —
// rewrote two tracked PNGs and left the working tree dirty for the next person.
// That folder is DATED evidence of the board as it shipped on 2026-08-13, not a
// build artifact, so refreshing it is now a deliberate act:
//   REPAIRS_EVIDENCE_DIR=docs/evidence/insurance-repairs-board-<date> npx playwright test
const EVIDENCE_DIR = process.env.REPAIRS_EVIDENCE_DIR
  ? path.resolve(process.cwd(), process.env.REPAIRS_EVIDENCE_DIR)
  : path.resolve(__dirname, '../../test-results/ops-repairs-board');
const EXPECTED_LABELS = ['WO In', 'Scoping', 'Quoted', 'Variation', 'Approved', 'Materials', 'Scheduled', 'On Site', 'Complete'];

function ensureEvidenceDir() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

// Force the Jobs view + Repairs tab visible without the auth gate, then render the
// repair kanban straight from a payload — the same shape /pipeline returns
// (columns keyed by raw job.status). Returns a summary of what landed where.
async function renderRepairs(page, columns) {
  return page.evaluate((cols) => {
    // The auth gate injects a stylesheet that hides everything but itself with
    // !important; remove both so the shell is visible for the screenshot.
    var gateStyle = document.getElementById('swAuthGateStyle');
    if (gateStyle) gateStyle.remove();
    var gate = document.getElementById('swAuthGate');
    if (gate) gate.remove();
    var main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    // Force the Jobs view visible in normal flow (its shipped layout is
    // position:fixed behind the auth gate, which Playwright treats as not
    // visible for a screenshot).
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); v.style.display = 'none'; });
    var view = document.getElementById('viewJobs');
    if (view) {
      view.classList.add('active');
      view.style.cssText = 'display:flex;flex-direction:column;position:static;top:auto;left:auto;right:auto;bottom:auto;height:760px;z-index:1;padding:16px 24px 0;background:var(--sw-bg,#F4F1EE);';
    }
    window._pipelineTab = 'repairs';
    window._jobView = 'kanban';
    var container = document.getElementById('jobsBody');
    renderRepairKanban(container, cols);
    // Let the horizontal scroll container size to its full content so a single
    // element screenshot shows all nine columns + both section labels at once.
    container.style.overflow = 'visible';
    var board = container.querySelector('.repair-kanban');
    if (board) { board.style.overflow = 'visible'; board.style.width = 'max-content'; }
    var colEls = Array.prototype.slice.call(container.querySelectorAll('.kanban-col'));
    var placed = {};
    colEls.forEach(function (colEl) {
      var label = colEl.querySelector('.kanban-col-header') ? colEl.querySelector('.kanban-col-header').childNodes[0].textContent.trim() : '';
      var cards = Array.prototype.slice.call(colEl.querySelectorAll('.kanban-card'));
      cards.forEach(function (card) { placed[card.getAttribute('data-job-id')] = label; });
    });
    var groupLabels = Array.prototype.slice.call(container.querySelectorAll('.repair-group-label')).map(function (el) { return el.textContent.trim(); });
    var headerLabels = colEls.map(function (colEl) {
      var h = colEl.querySelector('.kanban-col-header');
      return h ? h.childNodes[0].textContent.trim() : '';
    });
    // The dark Sales drawer renders a vertical-writing "Sales" chip; it must be absent.
    var hasSalesDrawer = Array.prototype.slice.call(container.querySelectorAll('span'))
      .some(function (s) { return /vertical-rl/.test(s.getAttribute('style') || '') && /Sales/.test(s.textContent); });
    return {
      colCount: colEls.length,
      headerLabels: headerLabels,
      groupLabels: groupLabels,
      placed: placed,
      hasSalesDrawer: hasSalesDrawer,
    };
  }, columns);
}

test('Repairs tab sits next to Patio in the pipeline tab strip', async ({ page }) => {
  await page.goto('/ops.html');
  const order = await page.$$eval('[data-pipeline]', (els) => els.map((e) => e.getAttribute('data-pipeline')));
  expect(order).toContain('repairs');
  expect(order.indexOf('repairs')).toBe(order.indexOf('patio') + 1);
});

test('empty Repairs board renders exactly the nine cohesive light columns, no dark Sales', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await renderRepairs(page, { new: [], quoted: [], accepted: [] });
  expect(result.colCount).toBe(9);
  expect(result.headerLabels).toEqual(EXPECTED_LABELS);
  expect(result.groupLabels).toEqual(['Quote', 'Job']);
  expect(result.hasSalesDrawer).toBe(false);

  ensureEvidenceDir();
  await page.locator('#jobsBody .repair-kanban').screenshot({ path: path.join(EVIDENCE_DIR, '01-repairs-empty-columns.png') });
});

test('repair-family rows land in their repair stage; non-repair rows are ignored', async ({ page }) => {
  await page.goto('/ops.html');
  // Feed shape mirrors /pipeline: columns keyed by raw job.status. Repair rows are
  // deliberately mixed under arbitrary status buckets to prove re-bucketing.
  const columns = {
    new: [
      { id: 'r1', type: 'repair', status: 'new', client_name: 'Repair One', site_suburb: 'Cottesloe', value: 3200, days_in_stage: 1, repair_stage: 'wo_in' },
      { id: 'r2', type: 'repair', status: 'quoted', client_name: 'Repair Two', site_suburb: 'Scarborough', value: 5400, days_in_stage: 2 },
    ],
    quoted: [
      { id: 'r3', ses_family: 'repair', status: 'quoted', client_name: 'Repair Three', site_suburb: 'Joondalup', value: 1800, days_in_stage: 4 },
      { id: 'p1', type: 'patio', status: 'quoted', client_name: 'Not A Repair', site_suburb: 'Fremantle', value: 9000, days_in_stage: 3 },
    ],
    in_progress: [
      { id: 'r4', type: 'repair', status: 'in_progress', client_name: 'Repair Four', site_suburb: 'Midland', value: 4100, days_in_stage: 0, first_scheduled_date: '2026-08-15' },
    ],
  };
  const result = await renderRepairs(page, columns);
  // Explicit repair_stage wins.
  expect(result.placed.r1).toBe('WO In');
  // Fallback: status 'quoted' -> Quoted column.
  expect(result.placed.r2).toBe('Quoted');
  // Family=repair recognised even without a type; status 'quoted' -> Quoted.
  expect(result.placed.r3).toBe('Quoted');
  // Status 'in_progress' -> On Site (delivery half).
  expect(result.placed.r4).toBe('On Site');
  // The patio row is not a repair and must not appear on this board.
  expect(result.placed.p1).toBeUndefined();
  // Still exactly nine columns, no dark Sales drawer.
  expect(result.colCount).toBe(9);
  expect(result.hasSalesDrawer).toBe(false);

  ensureEvidenceDir();
  await page.locator('#jobsBody .repair-kanban').screenshot({ path: path.join(EVIDENCE_DIR, '02-repairs-with-cards.png') });
});
